/**
 * Regression: the per-preset runtime-context (snapshot) whitelist.
 *
 * The model-facing `Current runtime context. This snapshot supersedes…` block
 * is `joinContextSections(assembly.contexts)` — a field SEPARATE from
 * `sections`, so neither `complete` nor `official-only` ever trimmed it. A
 * preset that stores the `contexts` array now installs a
 * `system-prompt/assemble` listener on its Agent's own scope (the same proven
 * placement the tool-assembly hygiene filter uses) and filters THAT field.
 *
 * Part 1 drives the REAL runtime: root → preset scope → agent scope with the
 * real `SystemPrompt` service, installs the store's agent scope the way the
 * Host's sweep does, then assembles and asserts which contexts survive — and
 * that `refreshContext()` (what agent-loop calls on every step) restores the
 * `required` rows whatever the whitelist says, which is exactly why the page
 * shows those two checked and disabled.
 *
 * Part 2 pins the pure decisions the three features rest on: an ABSENT
 * `contexts` field means "not managed, inject everything" while an array is
 * the strict whitelist; the copy insert re-indexes the whole order column;
 * the client's duplicate-name rule starts at （复制 1） and stacks.
 *
 * Run: node test/verify-context-snapshot.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { createScope } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js'
import { SystemPrompt } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { apply, insertAndReindex, normalizePreset, resolveContextSelection } from '../index.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const turn = () => new Promise((resolve) => setImmediate(resolve))

/** Every official contribution the bundled rows register. */
const OFFICIAL_CONTEXTS = [
  { name: 'working-directory:current', order: 100, required: true },
  { name: 'sandbox:policy', order: 110 },
  { name: 'approval:policy', order: 115 },
  { name: 'subagent:delegation', order: 120 },
  { name: 'team:identity', order: 125, required: true },
  { name: 'harness:source', order: 200 },
  { name: 'app:web-surface', order: 210 },
]

/** The optional rows a managed preset below keeps; everything else is off. */
const KEPT = ['sandbox:policy', 'approval:policy', 'harness:source']

/**
 * Boot the plugin against a real prompt registry: register every official
 * context globally, mount one preset with a whitelist, join one Agent to its
 * scope, and fire the refresh that installs the Agent's scope.
 * @param contexts - the stored whitelist, or undefined for an unmanaged preset.
 * @returns `{ agent, assemble, names, dispose }`.
 */
async function boot(contexts, forced) {
  const dir = await mkdtemp(join(tmpdir(), 'aps-contexts-'))
  const dataFile = join(dir, 'presets.json')
  const preset = {
    id: 'p1',
    name: 'P1',
    instructions: 'persona',
    tools: { mode: 'all', names: [] },
    skills: [],
    ...(contexts === undefined ? {} : { contexts }),
    ...(forced === undefined ? {} : { requiredSuppressed: forced }),
  }
  await writeFile(dataFile, JSON.stringify({ version: 2, presets: [preset] }), 'utf8')

  const root = new Context()
  root.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '' })
  root.plugin((ctx) => {
    ctx.inject(['systemPrompt'], (scoped) => {
      for (const row of OFFICIAL_CONTEXTS) {
        scoped.systemPrompt.context({
          name: row.name,
          order: row.order,
          required: row.required,
          text: `TEXT:${row.name}`,
        })
      }
      // A third-party contribution the whitelist has never heard of: a
      // managed preset must block it (strict whitelist), an unmanaged one
      // must leave it alone.
      scoped.systemPrompt.context({ name: 'vendor:telemetry', order: 300, text: 'VENDOR' })
    })
    // The THIRD layer DSH builds against suppression, reproduced verbatim from
    // `dsh-working-directory/lib/index.js:48-61`: a `prepend` assembly listener
    // that re-`unshift`s the required workspace whenever a filter drops it. A
    // plain whitelist cannot get past this — only the opt-in hatch's own
    // `prepend` (further out) plus the same-name shadow can.
    ctx.on(
      'system-prompt/assemble',
      async (_assembly, context, next) => {
        if (context.agent === undefined) return next()
        const assembly = await next()
        const found = assembly.contexts.find((entry) => entry.name === 'working-directory:current')
        if (found === undefined) {
          assembly.contexts.unshift({ name: 'working-directory:current', text: 'REPAIRED WORKDIR', interpolate: false })
        } else {
          found.text = 'REPAIRED WORKDIR'
        }
        return assembly
      },
      { prepend: true },
    )
  })

  const roster = []
  const handle = {}
  root.provide('agents', { list: () => [...roster], get: () => roster[0] })
  root.provide('agentPresets', { register: async () => () => {}, composedPreset: () => 'p1' })
  root.provide('configEditor', { entries: () => [] })
  root.provide('tools', {
    schemas: () => [],
    restrictableNames: () => new Set(),
    restrict: () => () => {},
    guard: () => () => {},
  })
  apply(root, { dataFile })
  await sleep(250)

  // root → preset scope → agent scope, exactly as the registry and agent-loop
  // compose them. The agent's OWN scope is what lets the hatch register a
  // same-name shadow at all: an untagged context would hit the global layer and
  // throw a duplicate against the official entry.
  const presetKey = {}
  const presetScope = createScope(root, presetKey)
  const agent = { session: { header: { agentPreset: 'p1' } } }
  const agentScope = createScope(presetScope.ctx, agent, { parent: presetKey })
  // The agent object doubles as its scope key AND carries `ctx`, exactly like
  // `dsh-agent-loop`, which does `this.scope = createScope(loopCtx, this)` then
  // `this.ctx = this.scope.ctx`. Without `ctx` the store cannot install the
  // per-Agent listeners at all.
  agent.ctx = agentScope.ctx
  handle.agent = agent
  handle.agentScope = agentScope
  handle.presetScope = presetScope
  roster.push(agent)
  root.emit('tools/change')
  await turn()
  await turn()

  const systemPrompt = agentScope.ctx.get('systemPrompt')
  const assemble = () => systemPrompt.assemble({ agent, scope: agent })
  return {
    agent,
    assemble,
    systemPrompt,
    dispose: async () => {
      await agentScope.dispose()
      await presetScope.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const namesOf = (assembly) => assembly.contexts.map((entry) => entry.name)

console.log('# 运行时过滤（真实 SystemPrompt 组装）')
{
  // 1. A managed preset: only the checked optional rows survive, the two
  //    required rows survive NO MATTER WHAT (they were checked anyway — the
  //    page cannot offer an unchecked box for them), and neither an unchecked
  //    official row nor an unknown third-party row gets through.
  const bundle = await boot(KEPT)
  try {
    const assembly = await bundle.assemble()
    const names = namesOf(assembly)
    for (const name of KEPT) assert(names.includes(name), `checked row injected: ${name}`)
    assert(names.includes('working-directory:current'), 'required workspace survives a whitelist that omits it')
    assert(names.includes('team:identity'), 'required team identity survives')
    assert(!names.includes('subagent:delegation'), 'unchecked official row suppressed')
    assert(!names.includes('app:web-surface'), 'unchecked web-surface row suppressed')
    assert(!names.includes('vendor:telemetry'), 'unknown third-party row blocked by the strict whitelist')
    // The sections (persona etc.) are outside the context filter's remit.
    assert(Array.isArray(assembly.sections) && assembly.sections.length > 0, 'sections untouched')

    // 2. agent-loop refreshes the accepted assembly every step; that path must
    //    restore the required rows and must NOT resurrect the blocked ones.
    const refreshed = bundle.systemPrompt.refreshContext(assembly, { agent: bundle.agent, scope: bundle.agent })
    const rNames = namesOf(refreshed)
    assert(rNames.includes('working-directory:current'), 'refresh keeps the required workspace')
    assert(!rNames.includes('subagent:delegation'), 'refresh does not resurrect a blocked optional row')
  } finally {
    await bundle.dispose()
  }
}
{
  // 3. An unmanaged preset (field absent — every preset saved before this
  //    feature) changes NOTHING: every context, official or third-party,
  //    still injects. This is the no-silent-blocking guarantee on upgrade.
  const bundle = await boot(undefined)
  try {
    const names = namesOf(await bundle.assemble())
    for (const row of OFFICIAL_CONTEXTS) assert(names.includes(row.name), `unmanaged preset still injects: ${row.name}`)
    assert(names.includes('vendor:telemetry'), 'unmanaged preset injects third-party contexts too')
  } finally {
    await bundle.dispose()
  }
}

{
  // 4. THE ESCAPE HATCH, against all three official layers. Forcing the
  //    workspace row must survive the repair listener AND `refreshContext`.
  const bundle = await boot(KEPT, ['working-directory:current'])
  try {
    const assembly = await bundle.assemble()
    const names = namesOf(assembly)
    assert(!names.includes('working-directory:current'), 'forced: the required workspace is gone despite the repair listener')
    assert(!names.some((n) => n === 'working-directory:current'), 'forced: no shadow of it remains')
    assert(names.includes('team:identity'), 'forced: the OTHER required row still injects')
    assert(names.includes('sandbox:policy'), 'forced: the ordinary whitelist still applies unchanged')
    assert(!names.includes('app:web-surface'), 'forced: an unchecked optional row stays blocked')
    // agent-loop re-renders every step: the hatch must hold across a refresh.
    const refreshed = bundle.systemPrompt.refreshContext(assembly, { agent: bundle.agent, scope: bundle.agent })
    assert(!namesOf(refreshed).includes('working-directory:current'), 'forced: refreshContext does not restore it either')
  } finally {
    await bundle.dispose()
  }
}
{
  // 5. Default OFF: with the hatch untouched the repair listener wins, which is
  //    exactly why the box starts unchecked and the page warns.
  const bundle = await boot(KEPT)
  try {
    const names = namesOf(await bundle.assemble())
    assert(names.includes('working-directory:current'), 'unforced: the required workspace injects as DSH intends')
    assert(names.includes('approval:policy'), 'unforced: an optional row the whitelist keeps still injects')
    assert(!names.includes('app:web-surface'), 'unforced: an optional row left out is still blocked')
  } finally {
    await bundle.dispose()
  }
}

console.log('# 数据模型与排序的纯决策')
{
  // normalizePreset: absent = undefined (not managed); present = trimmed,
  // de-duplicated strings.
  assert.equal(normalizePreset({ id: 'a', name: 'A' }).contexts, undefined, 'absent field stays unmanaged')
  assert.deepEqual(normalizePreset({ id: 'a', name: 'A', contexts: [' x ', 'x', '', 'y'] }).contexts, ['x', 'y'], 'array normalized')
  assert.equal(normalizePreset({ id: 'a', name: 'A', contexts: 'sandbox:policy' }).contexts, undefined, 'non-array is not a whitelist')

  // The ADVANCED list is NOT filtered against the shipped `required` table:
  // a newer DSH build can protect a context this release never heard of, and
  // the page must still be able to force-suppress it. An empty or malformed
  // list still normalizes to ABSENT (DSH's own contract left intact), and the
  // list is deduped. A name that turns out not to be required is harmless: it
  // lands in the same blocked bucket the ordinary whitelist produces.
  assert.equal(normalizePreset({ id: 'a', name: 'A' }).requiredSuppressed, undefined, 'absent hatch stays absent')
  assert.equal(normalizePreset({ id: 'a', name: 'A', requiredSuppressed: [] }).requiredSuppressed, undefined, 'an empty list is not a decision')
  assert.deepEqual(
    normalizePreset({ id: 'a', name: 'A', requiredSuppressed: ['sandbox:policy'] }).requiredSuppressed,
    ['sandbox:policy'],
    'the hatch is not narrowed by a build-time table — an unknown protected row stays suppressible',
  )
  assert.deepEqual(
    normalizePreset({ id: 'a', name: 'A', requiredSuppressed: ['team:identity', 'nope', 'team:identity'] }).requiredSuppressed,
    ['team:identity', 'nope'],
    'names are deduped, not filtered',
  )

  // resolveContextSelection mirrors the runtime partition the panel previews.
  const surface = OFFICIAL_CONTEXTS.map((row) => row.name).concat('vendor:telemetry')
  const managed = resolveContextSelection(surface, KEPT)
  assert.deepEqual(managed.blocked.filter((n) => n !== 'vendor:telemetry').sort(), ['app:web-surface', 'subagent:delegation'], 'unchecked optional blocked')
  assert(managed.kept.includes('team:identity'), 'required always kept')
  const unmanaged = resolveContextSelection(surface, undefined)
  assert.equal(unmanaged.blocked.length, 0, 'unmanaged blocks nothing')
  assert.equal(unmanaged.kept.length, surface.length, 'unmanaged keeps everything')
  // Catalog order first, observed strangers last.
  assert.deepEqual(managed.kept, ['working-directory:current', 'sandbox:policy', 'approval:policy', 'team:identity', 'harness:source'], 'kept rows follow the CONTEXT_ORDERS the model sees')
  assert.equal(managed.blocked[managed.blocked.length - 1], 'vendor:telemetry', 'an observed stranger sorts after the known rows')
  assert.equal(managed.managed, true, 'a whitelist is management')
  assert.deepEqual(managed.forced, [], 'nothing forced by default')

  // The escape hatch: a required name in `forced` moves to `blocked` — that is
  // the whole point of opting in — and is reported as forced so the page can
  // label it. Everything else is unchanged.
  const hatch = resolveContextSelection(surface, KEPT, ['working-directory:current'])
  assert(!hatch.kept.includes('working-directory:current'), 'a forced required name is blocked')
  assert(hatch.blocked.includes('working-directory:current'), 'and it lands in the blocked list')
  assert.deepEqual(hatch.forced, ['working-directory:current'], 'and is reported as forced')
  assert(hatch.kept.includes('team:identity'), 'the other required row still injects')
  // A forced name counts as managing even without any optional whitelist.
  const forcedOnly = resolveContextSelection(surface, undefined, ['team:identity'])
  assert.equal(forcedOnly.managed, true, 'forcing alone is management')
  assert.deepEqual(forcedOnly.blocked, ['team:identity'], 'and blocks exactly that row')
  // Non-required names in the forced list are inert (normalize drops them, but
  // the partition must not block them either).
  const bogus = resolveContextSelection(surface, KEPT, ['sandbox:policy'])
  assert(bogus.kept.includes('sandbox:policy'), 'forcing an optional name does nothing')
  assert.deepEqual(bogus.forced, [], 'and is not reported as forced')

  // insertAndReindex: the copy lands right behind its source and the WHOLE
  // column becomes the document position — this page's order and the roster's
  // `sort(order)` agree.
  const list = [
    { id: 'a', name: 'A', order: 7 },
    { id: 'b', name: 'B', order: 3 },
  ]
  insertAndReindex(list, { id: 'c', name: 'C', order: 0 }, 'a')
  assert.deepEqual(list.map((p) => p.id), ['a', 'c', 'b'], 'copy inserted after source')
  assert.deepEqual(list.map((p) => p.order), [0, 1, 2], 'order re-indexed to document positions')
  insertAndReindex(list, { id: 'd', name: 'D', order: 9 }, 'missing')
  assert.deepEqual(list.map((p) => p.id), ['a', 'c', 'b', 'd'], 'unknown source appends')
  assert.deepEqual(list.map((p) => p.order), [0, 1, 2, 3], 'append re-indexes too')
}

console.log('# 副本命名规则（与 client 同式的纯约定）')
{
  /** The client's rule, asserted here against the spec's examples. */
  const taken = new Set(['甲（复制 1）', '乙'])
  const next = (base) => {
    let index = 1
    let candidate = `${base}（复制 ${index}）`
    while (taken.has(candidate)) {
      index += 1
      candidate = `${base}（复制 ${index}）`
    }
    return candidate
  }
  // 复制 N starts at 1 and stacks for a copy of a copy; a name already taken
  // by a DISABLED preset still pushes the number on.
  assert.equal(next('乙'), '乙（复制 1）', 'first copy gets 1 even when the suffix-free name exists')
  taken.add('乙（复制 1）')
  assert.equal(next('乙'), '乙（复制 2）', 'second copy of the same source gets 2')
  assert.equal(next('甲'), '甲（复制 2）', 'disabled presets also occupy names')
  assert.equal(next('甲（复制 1）'), '甲（复制 1）（复制 1）', 'a copy of a copy stacks')
}

console.log('\nall context-snapshot regressions passed')
