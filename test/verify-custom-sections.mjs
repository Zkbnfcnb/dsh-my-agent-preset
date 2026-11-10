/**
 * Regression: `custom` prompt injection keeps exactly the sections its
 * checklist lists and removes the rest.
 *
 * The capability row installs a `system-prompt/assemble` waterfall listener in
 * the preset scope. This test mounts the real `SystemPrompt` service plus a mix
 * of sections, a tool provider, and contexts, then assembles for an agent scope
 * parented to the preset scope.
 *
 * Asserts:
 *   1. an UNMANAGED preset (no `sections` array) keeps every section;
 *   2. a keep list removes every section it does not list — official and
 *      third-party alike, because the checklist selects names, not namespaces;
 *   3. an EMPTY keep list removes every optional section;
 *   4. the preset's own persona section survives the checklist and carries the
 *      authored text;
 *   5. the ADVANCED force list may remove a persona section;
 *   6. tools and contexts are untouched by the section filter;
 *   7. `append` ignores a stored list, and `complete` still collapses to the
 *      preset persona.
 *
 * Run: node test/verify-custom-sections.mjs
 */
import assert from 'node:assert/strict'
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { SystemPrompt } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { createScope } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js'
import { apply } from '../capability.js'

const PERSONA_SECTION = 'deployment:persona-prefix'
const PERSONA_SUFFIX = 'deployment:persona-suffix'
const AUTHORED = '你是一个专注的代码助手。'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Sections the checklist can keep or drop. */
const SURFACE = [
  'harness:plan',
  'plan:policy',
  'team:policy',
  'tool:bash',
  'tools:ptc-only',
  'tools:sdk',
  'context:file-reference',
  'ui:deliverable-file-references',
  'harness:source',
  'app:web-surface',
  'mcp-resource-servers',
  'third-party:notes',
  'vendor:another',
  'mcp:demo-server',
]

/**
 * Build one root -> preset scope -> agent scope tree and register the mixed
 * prompt surface used by the assertions.
 * @param config - capability row config.
 * @param agentSections - extra sections registered in the AGENT scope.
 */
async function build(config, agentSections = []) {
  const root = new Context()
  root.plugin(SystemPrompt, { personaPrefix: 'OFFICIAL PERSONA', personaSuffix: 'OFFICIAL SUFFIX' })
  root.plugin((ctx) => {
    ctx.inject(['systemPrompt'], (scoped) => {
      for (const name of SURFACE) {
        scoped.systemPrompt.section({ name, order: 100, text: `SECTION:${name}` })
      }
      scoped.systemPrompt.context({ name: 'sandbox-policy', order: 110, text: 'SANDBOX' })
      scoped.systemPrompt.context({ name: 'vendor:context', order: 120, text: 'VENDOR CONTEXT' })
      scoped.systemPrompt.tools(() => ({
        schemas: [{ name: 'demo_tool', description: 'demo', parameters: { type: 'object', properties: {} } }],
      }))
    })
  })
  const presetKey = {}
  const presetScope = createScope(root, presetKey)
  presetScope.ctx.plugin((ctx) => {
    apply(ctx, {
      presetId: 'p1',
      instructions: AUTHORED,
      instructionMode: 'custom',
      skills: [],
      tools: { mode: 'all', names: [] },
      ...config,
    })
  })
  const agent = { session: { header: {} } }
  const agentScope = createScope(presetScope.ctx, agent, { parent: presetKey })
  for (const name of agentSections) {
    agentScope.ctx.plugin((ctx) => {
      ctx.inject(['systemPrompt'], (scoped) => {
        scoped.systemPrompt.section({ name, order: 120, text: `AGENT:${name}` })
      })
    })
  }
  await sleep(150)
  return { root, presetScope, agentScope, agent }
}

/** Assemble for the bundle's agent scope. */
async function assembleWith(bundle) {
  const sp = bundle.agentScope.ctx.get('systemPrompt')
  return sp.assemble({ agent: bundle.agent, scope: bundle.agent })
}

const namesOf = (assembly) => new Set(assembly.sections.map((section) => section.name))
const sectionOf = (assembly, name) => assembly.sections.find((section) => section.name === name)

// 1. No checklist => nothing is filtered.
{
  const bundle = await build({})
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  for (const name of SURFACE) assert(names.has(name) === true, `unmanaged keeps section: ${name}`)
  assert(names.has('agent-plugin:rules') === false, 'agent section only registers when built with one')
  const persona = sectionOf(assembly, PERSONA_SECTION)
  assert(persona !== undefined, 'preset persona section present')
  assert.equal(persona.text, AUTHORED, 'preset persona text is exactly the authored text')
}

// 2-3. A keep list selects exact names; everything else is removed.
{
  const kept = ['third-party:notes', 'vendor:another', 'mcp:demo-server', 'agent-plugin:rules']
  const bundle = await build({ sections: kept }, ['agent-plugin:rules'])
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  for (const name of SURFACE) {
    const expected = name === 'third-party:notes' || name === 'vendor:another' || name === 'mcp:demo-server'
    assert(names.has(name) === expected, `checklist ${expected ? 'keeps' : 'drops'} ${name}`)
  }
  assert(names.has('agent-plugin:rules'), 'agent-scope section listed in the checklist survives')
  assert(names.has(PERSONA_SECTION), 'the preset persona is not controlled by the optional half')
  // Tools and contexts are outside the filter's scope.
  assert(assembly.tools.some((tool) => tool.name === 'demo_tool'), 'tool schemas untouched')
  const contextNames = new Set(assembly.contexts.map((context) => context.name))
  assert(contextNames.has('sandbox-policy'), 'runtime context untouched')
  assert(contextNames.has('vendor:context'), 'third-party runtime context untouched')
}

// 4. An empty keep list removes every optional section.
{
  const bundle = await build({ sections: [] })
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  assert(names.size === 1, `empty checklist leaves only the persona (got ${[...names].join(',')})`)
  assert(names.has(PERSONA_SECTION), 'empty checklist keeps the preset persona')
}

// 5. The ADVANCED force list removes a persona section.
{
  const bundle = await build({ sections: SURFACE, sectionsSuppressed: [PERSONA_SECTION] })
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  assert(names.has(PERSONA_SECTION) === false, 'force-suppressed persona prefix is removed')
  // The preset registers no suffix, so the deployment suffix is removed too:
  // the persona half belongs to this preset, not to the deployment.
  assert(names.has(PERSONA_SUFFIX) === false, 'the deployment suffix is not borrowed when the preset stores none')
  assert(names.has('harness:plan'), 'other checked sections still inject')
}

// 5b. Suppressing a name that is not a persona section is inert.
{
  const bundle = await build({ sections: [], sectionsSuppressed: ['third-party:notes'] })
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  assert(names.has('third-party:notes') === false, 'unlisted sections stay removed')
  assert(names.has(PERSONA_SECTION), 'a non-persona suppression does not leak into the filter')
}

// 6. `append` ignores a stored checklist.
{
  const bundle = await build({ instructionMode: 'append', sections: [] })
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  assert(names.has('harness:plan'), 'append keeps every section even with a stored list')
  assert(names.has(PERSONA_SECTION), 'append keeps the preset persona')
}

// 7. `complete` still collapses every section to the preset persona.
{
  const bundle = await build({ instructionMode: 'complete' })
  const assembly = await assembleWith(bundle)
  assert(assembly.sections.length === 1, `complete collapses to one section (got ${assembly.sections.length})`)
  assert(assembly.sections[0].name === PERSONA_SECTION, 'complete keeps only the preset persona')
}

console.log('\nAll custom-section assertions passed')
process.exit(0)
