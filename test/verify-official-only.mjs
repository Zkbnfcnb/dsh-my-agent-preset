/**
 * Regression: `custom-official` prompt injection removes only DSH's own system
 * prompt sections and keeps contributions injected by third-party plugins and
 * external MCP servers.
 *
 * The capability row installs a `system-prompt/assemble` waterfall listener in
 * the preset scope. This test mounts the real `SystemPrompt` service plus a
 * mix of official and vendor sections, a tool provider, and contexts, then
 * assembles for an agent scope parented to the preset scope.
 *
 * Asserts:
 *   1. official sections (harness/plan/team/tool/tools/context/ui/app/
 *      mcp-resource-servers, plus the deployment persona suffix) disappear;
 *   2. third-party sections and `mcp:<server>` instructions survive, at both
 *      the global and the agent scope;
 *   3. tools and contexts are untouched;
 *   4. the preset's own persona section survives (with the workspace line);
 *   5. empty instructions + Include workspace still emits a workspace-only
 *      section, and empty + off leaves no persona;
 *   6. `complete` still collapses everything to the preset persona section.
 *
 * Run: node test/verify-official-only.mjs
 */
import assert from 'node:assert/strict'
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { SystemPrompt } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { createScope } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js'
import { apply } from '../capability.js'

const PERSONA_SECTION = 'deployment:persona-prefix'
const PERSONA_SUFFIX = 'deployment:persona-suffix'
const AUTHORED = '你是一个专注的代码助手。'
const WORKSPACE_LABEL = '当前任务工作区：'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Official section names the filter must remove. */
const OFFICIAL = [
  'harness:identity',
  PERSONA_SUFFIX,
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
]

/** Third-party sections the filter must keep. */
const THIRD_PARTY = ['third-party:notes', 'vendor:another', 'mcp:demo-server']

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
      for (const name of OFFICIAL) {
        if (name === 'harness:identity' || name === PERSONA_SUFFIX) continue
        scoped.systemPrompt.section({ name, order: 100, text: `OFFICIAL:${name}` })
      }
      for (const name of THIRD_PARTY) {
        scoped.systemPrompt.section({ name, order: 110, text: `THIRD:${name}` })
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
      instructionMode: 'custom-official',
      includeWorkspace: true,
      skills: [],
      tools: { mode: 'all', names: [] },
      ...config,
    })
  })
  const agent = { session: { header: { cwd: '' } } }
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
async function assembleWith(bundle, cwd = '/tmp/ws') {
  bundle.agent.session.header.cwd = cwd
  const sp = bundle.agentScope.ctx.get('systemPrompt')
  return sp.assemble({ agent: bundle.agent, scope: bundle.agent })
}

const namesOf = (assembly) => new Set(assembly.sections.map((section) => section.name))
const sectionOf = (assembly, name) => assembly.sections.find((section) => section.name === name)

// 1-4. Official removed, third-party kept, tools/contexts untouched.
{
  const bundle = await build({}, ['agent-plugin:rules'])
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  for (const name of OFFICIAL) assert(names.has(name) === false, `official section removed: ${name}`)
  for (const name of THIRD_PARTY) assert(names.has(name) === true, `third-party section kept: ${name}`)
  assert(names.has('agent-plugin:rules'), 'agent-scope third-party section kept')
  const persona = sectionOf(assembly, PERSONA_SECTION)
  assert(persona !== undefined, 'preset persona section present')
  assert(persona.text.startsWith(AUTHORED), 'preset persona keeps the authored text')
  assert(persona.text.endsWith(`${WORKSPACE_LABEL}/tmp/ws`), 'preset persona appends the workspace line')
  // Tools and contexts are outside the filter's scope.
  assert(assembly.tools.some((tool) => tool.name === 'demo_tool'), 'tool schemas untouched')
  const contextNames = new Set(assembly.contexts.map((context) => context.name))
  assert(contextNames.has('sandbox-policy'), 'official runtime context untouched')
  assert(contextNames.has('vendor:context'), 'third-party runtime context untouched')
}

// 5a. Empty instructions + workspace on => only the workspace line.
{
  const bundle = await build({ instructions: '', includeWorkspace: true })
  const assembly = await assembleWith(bundle, '/tmp/only-ws')
  const names = namesOf(assembly)
  for (const name of OFFICIAL) assert(names.has(name) === false, `empty preset still removes official: ${name}`)
  assert(names.has('third-party:notes'), 'empty preset still keeps third-party')
  const persona = sectionOf(assembly, PERSONA_SECTION)
  assert(persona !== undefined, 'workspace-only persona section present')
  assert(persona.text === `${WORKSPACE_LABEL}/tmp/only-ws`, `workspace line stands alone (got="${persona.text}")`)
}

// 5b. Empty instructions + workspace off => no persona section at all.
{
  const bundle = await build({ instructions: '', includeWorkspace: false })
  const assembly = await assembleWith(bundle)
  const names = namesOf(assembly)
  for (const name of OFFICIAL) assert(names.has(name) === false, `empty preset still removes official: ${name}`)
  assert(names.has('third-party:notes'), 'empty preset still keeps third-party')
  const persona = sectionOf(assembly, PERSONA_SECTION)
  assert(persona === undefined || persona.text === '', 'empty instructions + workspace off leave no persona')
}

// 6. `complete` still collapses every section to the preset persona.
{
  const bundle = await build({ instructionMode: 'complete' })
  const assembly = await assembleWith(bundle)
  assert(assembly.sections.length === 1, `complete collapses to one section (got ${assembly.sections.length})`)
  assert(assembly.sections[0].name === PERSONA_SECTION, 'complete keeps only the preset persona')
}

console.log('\nAll custom-official assertions passed')
process.exit(0)
