/**
 * Regression: a roster entry whose fiber is already dead must never crash
 * the Host when its scope is (re)installed.
 *
 * Cordis disposes a fiber asynchronously: `uid` clears FIRST, and every
 * later `ctx.effect()` throws INACTIVE_EFFECT. The Agent leaves
 * `agents.list()` only afterwards, so `refreshAllAgentScopes()` — which runs
 * on a `setImmediate` after `tools/change` — can meet a half-disposed Agent
 * and previously crashed with an uncaught INACTIVE_EFFECT at
 * `installAgentScope` → `tools.guard()`.
 *
 * Scenarios:
 *   A. dead Agent still listed → refresh skips it (the original crash stack).
 *   B. Agent disposed MID-install (a `restrict()` notify listener) → the
 *      partial restriction is released, not leaked, and nothing crashes.
 *   C. live Agent → refresh installs, and a second refresh releases the old
 *      registrations before installing fresh ones.
 *
 * Run: node test/regression-scope-lifecycle.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Absolute ESM specifier: this checkout's dsh installation owns cordis.
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { apply } from '../index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** One macrotask: `queueScopeRefresh` schedules its work with setImmediate. */
const turn = () => new Promise((resolve) => setImmediate(resolve))

/** One enabled preset whose tool list drives restrict + guard. */
const PRESET = {
  id: 'p1',
  name: 'P1',
  prompt: 'test persona',
  tools: { mode: 'allow', names: ['foo'] },
  skills: [],
}

/** Collect every uncaught exception emitted while `body` runs. */
async function guarded(body) {
  const errors = []
  const onUncaught = (error) => errors.push(error)
  process.on('uncaughtException', onUncaught)
  try {
    await body()
  } finally {
    process.off('uncaughtException', onUncaught)
  }
  return errors
}

/**
 * Boot the plugin against a minimal fake runtime: a roster, a preset
 * registry answering `p1`, a loader stub, and the `tools` surface the
 * scenario supplies. The Agent joins the roster only AFTER apply(), so no
 * early sweep sees it.
 * @returns the root context, the Agent handle, and a trigger for refreshes.
 */
async function boot(makeTools) {
  const dir = await mkdtemp(join(tmpdir(), 'aps-regression-'))
  const dataFile = join(dir, 'presets.json')
  await writeFile(dataFile, JSON.stringify({ version: 2, presets: [PRESET] }), 'utf8')
  const root = new Context()
  /** Every Agent this Host can currently see. */
  const roster = []
  /** The Agent handle under test; each scenario's `makeTools` closes over it. */
  const handle = {}
  root.provide('agents', { list: () => [...roster], get: () => roster[0] })
  root.provide('agentPresets', { register: async () => () => {}, composedPreset: () => 'p1' })
  root.provide('configEditor', { entries: () => [] })
  root.provide('tools', makeTools(handle))
  apply(root, { dataFile })
  // bootstrap() runs load + reconcile behind store.run(); give it a beat.
  await sleep(250)
  const fiber = root.plugin(() => {})
  handle.fiber = fiber
  handle.agent = { ctx: fiber.ctx, session: { header: { agentPreset: 'p1' } } }
  roster.push(handle.agent)
  /** Fire the refresh queue exactly like a `tools/change` event would. */
  handle.refresh = () => {
    root.emit('tools/change')
    return turn()
  }
  return { root, handle, dir }
}

/** A. Dead Agent still on the roster: the refresh must skip it, not throw. */
async function scenarioA() {
  const { handle, dir } = await boot((h) => ({
    restrictableNames: () => new Set(),
    schemas: () => [],
    restrict: () => () => {},
    // The real guard registers an effect on the Agent's scope; a dead scope
    // throws INACTIVE_EFFECT here — exactly the original crash site.
    guard: () => h.agent.ctx.effect(() => () => {}, 'tools.guard()'),
  }))
  try {
    await handle.fiber.dispose() // uid → null; roster still lists the Agent
    const errors = await guarded(() => handle.refresh())
    assert.equal(errors.length, 0, `refresh crashed the Host: ${errors[0]?.stack}`)
    console.log('  A. dead roster entry skipped without crash — ok')
  } finally {
    // Root contexts own no dispose(); the agent fiber does, and both sweep
    // timers are unref()'d so they cannot hold the process open.
    await handle.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

/** B. Agent disposed mid-install: partial state released, no crash. */
async function scenarioB() {
  let released = 0
  const { handle, dir } = await boot((h) => ({
    restrictableNames: () => new Set(['foo']),
    schemas: () => [{ name: 'foo', description: '' }],
    // A notify listener disposing this very Agent between restrict and
    // guard: `dispose()` clears the uid synchronously, so the next effect
    // on this scope throws — the TOCTOU window the probe cannot see.
    restrict: () => {
      void h.fiber.dispose()
      return () => {
        released++
      }
    },
    guard: () => h.agent.ctx.effect(() => () => {}, 'tools.guard()'),
  }))
  try {
    const errors = await guarded(() => handle.refresh())
    assert.equal(errors.length, 0, `mid-install dispose crashed the Host: ${errors[0]?.stack}`)
    assert.equal(released, 1, `partial restriction must be released, saw ${released}`)
    console.log('  B. mid-install dispose releases partial state — ok')
  } finally {
    // Root contexts own no dispose(); the agent fiber does, and both sweep
    // timers are unref()'d so they cannot hold the process open.
    await handle.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

/** C. Live Agent: refresh installs; a second refresh swaps registrations. */
async function scenarioC() {
  let restrictions = 0
  let restrictionDisposals = 0
  let guards = 0
  let guardDisposals = 0
  const { handle, dir } = await boot(() => ({
    restrictableNames: () => new Set(['foo']),
    schemas: () => [{ name: 'foo', description: '' }],
    restrict: () => {
      restrictions++
      return () => {
        restrictionDisposals++
      }
    },
    guard: () => {
      guards++
      return () => {
        guardDisposals++
      }
    },
  }))
  try {
    await handle.refresh()
    assert.equal(restrictions, 1, 'one restriction applied for the live Agent')
    assert.equal(guards, 2, 'tool guard + skill guard installed')
    // A second refresh must uninstall the old registrations first.
    await handle.refresh()
    assert.equal(restrictionDisposals, 1, 'old restriction released on re-install')
    assert.equal(guardDisposals, 2, 'both old guards released on re-install')
    assert.equal(restrictions, 2, 'fresh restriction applied on re-install')
    assert.equal(guards, 4, 'fresh guards applied on re-install')
    console.log('  C. live Agent installs and re-installs — ok')
  } finally {
    // Root contexts own no dispose(); the agent fiber does, and both sweep
    // timers are unref()'d so they cannot hold the process open.
    await handle.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

await scenarioA()
await scenarioB()
await scenarioC()
console.log('all scope-lifecycle regressions passed')
