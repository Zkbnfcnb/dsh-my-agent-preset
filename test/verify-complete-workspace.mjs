/**
 * Regression: `includeWorkspace` (default on) appends the live session working
 * directory to the preset's persona section in EVERY injection mode — append,
 * complete, and custom — and that line disappears when the switch is
 * off or the cwd is empty.
 *
 * capability.js registers the `deployment:persona-prefix` section through the
 * scoped `systemPrompt` service. Its `text` is a FUNCTION that re-reads
 * `context.agent.session.header.cwd` on every assemble and appends
 * `\n\n当前任务工作区：<cwd>`. We replicate the real assembly by mounting the
 * `SystemPrompt` service on the root (its constructor registers harness +
 * persona sections globally), creating a preset scope, mounting capability.js
 * inside it (so its same-named section lands in the preset's layer and SHADOWS
 * the global persona), then creating an agent scope parented to that preset
 * scope and assembling with the agent as the scope key.
 *
 * `complete` still nukes every other section (that is the mode's contract);
 * this test only asserts the persona section's text, so it also covers the
 * custom mode where the rest of the prompt is filtered instead.
 *
 * Run: node test/verify-complete-workspace.mjs
 */
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { SystemPrompt } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { createScope } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js'
import { apply } from '../capability.js'

const WORKSPACE_LABEL = '当前任务工作区：'
const PERSONA_SECTION = 'deployment:persona-prefix'
const AUTHORED = '你是一个专注的代码助手。'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Build a root -> preset scope -> agent scope tree and mount the capability row
 * in the preset scope, exactly where the preset registry mounts it.
 * @param config - capability row config overrides.
 * @returns the agent scope key and the agent handle used as `assemble` context.
 */
function buildPreset(config) {
  const root = new Context()
  root.plugin(SystemPrompt)
  const presetKey = {}
  const presetScope = createScope(root, presetKey)
  presetScope.ctx.plugin((ctx) => {
    apply(ctx, {
      presetId: 'p1',
      instructions: AUTHORED,
      instructionMode: 'complete',
      skills: [],
      tools: { mode: 'all', names: [] },
      ...config,
    })
  })
  const agent = { session: { header: { cwd: '' } } }
  const agentScope = createScope(presetScope.ctx, agent, { parent: presetKey })
  return { root, presetScope, agentScope, agent }
}

/** Extract the `deployment:persona-prefix` section text from an assembly. */
async function personaText(bundle, cwd) {
  bundle.agent.session.header.cwd = cwd
  const sp = bundle.agentScope.ctx.get('systemPrompt')
  const assembly = await sp.assemble({
    agent: bundle.agent,
    scope: bundle.agent,
  })
  const persona = assembly.sections.find((section) => section.name === PERSONA_SECTION)
  return persona ? persona.text : undefined
}

let failures = 0
function assert(cond, msg) {
  if (!cond) {
    console.log('FAIL:', msg)
    failures++
  } else {
    console.log('PASS:', msg)
  }
}

// 1. complete + includeWorkspace (default on) + cwd present => appended line.
{
  const bundle = buildPreset({})
  await sleep(150)
  const text = await personaText(bundle, '/tmp/ws')
  assert(typeof text === 'string', 'persona section present in assembly')
  assert(text.startsWith(AUTHORED), 'complete keeps the authored instructions')
  assert(text.endsWith(`${WORKSPACE_LABEL}/tmp/ws`), `complete appends real cwd (got="${text}")`)
}

// 2. complete + includeWorkspace explicitly true (same as default).
{
  const bundle = buildPreset({ includeWorkspace: true })
  await sleep(150)
  const text = await personaText(bundle, '/home/user/proj')
  assert(text.endsWith(`${WORKSPACE_LABEL}/home/user/proj`), 'explicit includeWorkspace:true appends cwd')
}

// 3. complete + includeWorkspace:false => NO workspace line.
{
  const bundle = buildPreset({ includeWorkspace: false })
  await sleep(150)
  const text = await personaText(bundle, '/tmp/ws')
  assert(!text.includes(WORKSPACE_LABEL), 'includeWorkspace:false omits the workspace line')
  assert(text === AUTHORED, 'includeWorkspace:false keeps only authored text')
}

// 4. complete + cwd empty => NO workspace line (no dirty output).
{
  const bundle = buildPreset({})
  await sleep(150)
  const text = await personaText(bundle, '')
  assert(!text.includes(WORKSPACE_LABEL), 'empty cwd omits the workspace line')
  assert(text === AUTHORED, 'empty cwd keeps only authored text')
}

// 5. append mode now appends workspace too (the option is prompt-wide).
{
  const bundle = buildPreset({ instructionMode: 'append' })
  await sleep(150)
  const text = await personaText(bundle, '/tmp/ws')
  assert(text.endsWith(`${WORKSPACE_LABEL}/tmp/ws`), 'append mode appends the workspace line')
  assert(text.startsWith(AUTHORED), 'append mode keeps the authored instructions')
}

// 6. custom mode appends workspace as well.
{
  const bundle = buildPreset({ instructionMode: 'custom' })
  await sleep(150)
  const text = await personaText(bundle, '/tmp/ws')
  assert(text.endsWith(`${WORKSPACE_LABEL}/tmp/ws`), 'custom mode appends the workspace line')
  assert(text.startsWith(AUTHORED), 'custom mode keeps the authored instructions')
}

if (failures > 0) {
  console.log(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll workspace-append assertions passed')
process.exit(0)
