/**
 * Regression: the runtime-context catalog must answer from the RUNNING prompt
 * registry, not from the table this plugin was built against.
 *
 * The shipped `CONTEXT_CATALOG` copies two columns of DSH's context table —
 * `required` and `order` — and both go stale the moment a DSH build adds,
 * removes or re-flags a context. `required` is not cosmetic: `assemble()` and
 * `refreshContext()` restore exactly the entries carrying `required === true`,
 * so a stale table shows a closable row the runtime keeps putting back (and a
 * locked row nobody protects).
 *
 * What this pins:
 *   1. `requiredContextNames` / `contextCatalog` read the registry's own
 *      `required` and `order` through a preset's standing scope;
 *   2. a newly protected row the shipped table never heard of is treated as
 *      required — protected by the filter and listed as required in the page;
 *   3. a row the table calls required but the registry does not is closable —
 *      the live answer wins in that direction too;
 *   4. a live-only row reaches the page without any Agent having assembled;
 *   5. the section checklist is a keep list of exact names, reports which live
 *      sections it keeps and drops, and protects the preset's persona sections;
 *   6. with no readable registry everything falls back to the shipped table.
 *
 * Run: node test/verify-context-registry-truth.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { createScope } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/lib/index.js'
import { SystemPrompt } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'
import { PresetStore, normalizePreset, resolveContextSelection, toDefinition } from '../index.js'
import { resolveSectionSelection } from '../capability.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const turn = () => new Promise((resolve) => setImmediate(resolve))

/**
 * Boot a real prompt registry plus a preset scope, and hand back the store.
 *
 * The preset scope registers the rows a NEWER DSH build would: a protected row
 * this plugin's table has never seen (`app:freshly-required`), a plain row at
 * an order the table does not have (`sandbox:policy` at 111), and a row the
 * table still calls required but the runtime no longer protects
 * (`team:identity`, registered without the flag).
 * @param options - `{ withPrompt }`: false mounts no systemPrompt service.
 * @returns `{ root, store, presetKey, presetScope, dispose }`.
 */
async function boot(options = {}) {
  const withPrompt = options.withPrompt !== false
  const dir = await mkdtemp(join(tmpdir(), 'aps-registry-'))
  const root = new Context()
  if (withPrompt) root.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '' })
  const presetKey = {}
  const presetScope = createScope(root, presetKey)
  // Cordis mounts plugins asynchronously: the scoped ctx inherits
  // `systemPrompt` a beat after `root.plugin()` returned.
  await sleep(20)
  if (withPrompt) {
    const systemPrompt = presetScope.ctx.get('systemPrompt')
    // Required rows the shipped table knows about.
    systemPrompt.context({
      name: 'working-directory:current',
      order: 100,
      required: true,
      text: 'CWD',
    })
    // A row the shipped table calls required. The live registry does not.
    systemPrompt.context({ name: 'team:identity', order: 125, text: 'TEAM' })
    // A row that only exists in this build, and IS protected.
    systemPrompt.context({
      name: 'app:freshly-required',
      order: 250,
      required: true,
      text: 'NEW',
    })
    // A row at a live order the table has never carried.
    systemPrompt.context({ name: 'sandbox:policy', order: 111, text: 'SANDBOX' })
  }
  const store = new PresetStore(root, { dataFile: join(dir, 'presets.json') })
  store.presets = [{ id: 'p1', name: 'P1', contexts: ['sandbox:policy'], tools: { mode: 'all', names: [] }, skills: [] }]
  store.rememberScopeKey('p1', presetKey)
  // One Agent parented to the preset scope, exactly as `dsh-agent-loop` builds
  // it — the scope the runtime filter is installed on.
  const agent = { session: { header: { agentPreset: 'p1' } } }
  const agentScope = createScope(presetScope.ctx, agent, { parent: presetKey })
  agent.ctx = agentScope.ctx
  store.installAgentScope(agent)
  return {
    root,
    store,
    agent,
    presetKey,
    presetScope,
    assemble: () => root.get('systemPrompt').assemble({ agent, scope: agent }),
    dispose: async () => {
      store.uninstallAgentScope(agent)
      store.dispose()
      await agentScope.dispose()
      await presetScope.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

console.log('# 注册表真值（required / order）')
{
  const bundle = await boot()
  try {
    const required = bundle.store.requiredContextNames('p1')
    assert(required.has('working-directory:current'), 'a row the build protects stays protected')
    assert(required.has('app:freshly-required'), 'a row this plugin has never heard of is protected too')
    assert(!required.has('team:identity'), 'a row the build stopped protecting is no longer required')
    assert(!required.has('sandbox:policy'), 'an optional row is not required')

    const catalog = bundle.store.contextCatalog('p1')
    const byName = new Map(catalog.map((row) => [row.name, row]))
    assert.equal(byName.get('app:freshly-required')?.required, true, 'the new protected row is listed as required')
    assert.equal(byName.get('app:freshly-required')?.known, false, 'and is flagged as a row this plugin does not own')
    assert.equal(byName.get('app:freshly-required')?.present, true, 'and is present in the running build')
    assert.equal(byName.get('team:identity')?.required, false, 'the no-longer-protected row is closable')
    assert.equal(byName.get('sandbox:policy')?.order, 111, 'the live order wins over the shipped one')
    // The page must surface a live-only row even though no Agent assembled.
    assert(byName.has('app:freshly-required'), 'a live-only row reaches the catalog without observation')
    // Ordering follows the live sort keys, not the shipped ones.
    const orders = catalog.filter((row) => row.known === true).map((row) => row.order)
    assert.deepEqual(
      orders,
      [...orders].sort((left, right) => left - right),
      'known rows are sorted by their live order',
    )
  } finally {
    await bundle.dispose()
  }
}

console.log('# 过滤与真值一致（真实组装）')
{
  // The preset keeps only `sandbox:policy`. The live-required row must survive
  // a whitelist that omits it, and the live-optional `team:identity` must NOT
  // survive — the whitelist omits it and nothing restores it.
  const bundle = await boot()
  try {
    const assembly = await bundle.assemble()
    const names = assembly.contexts.map((entry) => entry.name)
    assert(names.includes('app:freshly-required'), 'live-required row survives the whitelist')
    assert(names.includes('working-directory:current'), 'shipped-required row survives')
    assert(!names.includes('team:identity'), 'a row the build stopped protecting is really gone')
    assert(names.includes('sandbox:policy'), 'the kept optional row survives')
    // And the same answer is what the page reports.
    const split = resolveContextSelection(
      ['working-directory:current', 'team:identity', 'app:freshly-required', 'sandbox:policy'],
      ['sandbox:policy'],
      [],
      bundle.store.requiredContextNames('p1'),
      bundle.store.contextOrders('p1'),
    )
    assert.deepEqual(split.blocked, ['team:identity'], 'the page blocks exactly the row the runtime drops')
    assert(split.kept.includes('app:freshly-required'), 'and keeps exactly the rows the runtime keeps')
  } finally {
    await bundle.dispose()
  }
}

console.log('# 无法读取时的回退')
{
  const bundle = await boot({ withPrompt: false })
  try {
    assert.deepEqual(
      [...bundle.store.requiredContextNames('p1')].sort(),
      ['team:identity', 'working-directory:current'],
      'no registry means the shipped table, unchanged',
    )
    const catalog = bundle.store.contextCatalog('p1')
    assert.equal(catalog.find((row) => row.name === 'team:identity')?.required, true, 'the shipped flag still applies')
    assert.equal(catalog.find((row) => row.name === 'sandbox:policy')?.order, 110, 'and the shipped order still applies')

    // The section checklist can render without a readable registry: the
    // preset's own persona rows are always offered, checked-and-disabled.
    const listed = await bundle.store.list()
    const sectionRows = listed.meta.sectionCatalog ?? []
    const sectionNames = sectionRows.map((row) => row.name)
    assert(sectionNames.includes('deployment:persona-prefix'), 'the persona prefix reaches the page')
    assert(sectionNames.includes('deployment:persona-suffix'), 'the persona suffix is offered too')
    assert.equal(
      sectionRows.filter((row) => row.required === true).length,
      2,
      'both persona rows are marked required',
    )
  } finally {
    await bundle.dispose()
  }
}

console.log('# 段清单分区：勾选即保留，人设段受保护')
{
  const names = ['deployment:persona-prefix', 'harness:identity', 'mcp:github', 'vendor:thing']
  const all = resolveSectionSelection(names, undefined, [])
  assert.deepEqual(all.kept, [...names].sort(), 'an unmanaged preset keeps every section')
  assert.deepEqual(all.blocked, [], 'and blocks nothing')
  assert.equal(all.managed, false, 'the caller can tell "unmanaged" from "kept everything"')

  const listed = resolveSectionSelection(names, ['vendor:thing', 'mcp:github'], [])
  assert.deepEqual(
    listed.kept,
    ['deployment:persona-prefix', 'mcp:github', 'vendor:thing'],
    'listed names plus the persona survive',
  )
  assert.deepEqual(listed.blocked, ['harness:identity'], 'every unlisted optional section is dropped')

  const none = resolveSectionSelection(names, [], [])
  assert.deepEqual(none.kept, ['deployment:persona-prefix'], 'an empty keep list keeps only the persona')
  assert.deepEqual(
    none.blocked,
    ['harness:identity', 'mcp:github', 'vendor:thing'],
    'an empty keep list is a decision, not "unmanaged"',
  )

  const forced = resolveSectionSelection(names, undefined, ['deployment:persona-prefix', 'harness:identity'])
  assert.deepEqual(forced.blocked, ['deployment:persona-prefix'], 'the ADVANCED list may force the persona out')
  assert.deepEqual(
    forced.kept,
    ['harness:identity', 'mcp:github', 'vendor:thing'],
    'a non-persona name in the force list is inert — unchecking is the ordinary control',
  )
}

console.log('# 预设自身承载段清单')
{
  const normalized = normalizePreset({
    id: 'p9',
    name: 'P9',
    sections: ['harness:identity', 'harness:identity', ''],
    sectionsSuppressed: ['deployment:persona-prefix', 'harness:identity'],
  })
  assert.deepEqual(normalized.sections, ['harness:identity'], 'the keep list is trimmed and deduped')
  assert.deepEqual(
    normalized.sectionsSuppressed,
    ['deployment:persona-prefix'],
    'only persona names may be force-suppressed',
  )
  // The capability row must receive them, or the filter would never see them.
  const definition = toDefinition(normalized, [])
  const capability = definition.plugins.find((row) => row.id === 'studio-capability')
  assert.deepEqual(capability.config.sections, ['harness:identity'], 'the keep list travels into the capability row')
  assert.deepEqual(
    capability.config.sectionsSuppressed,
    ['deployment:persona-prefix'],
    'and so does the force list',
  )
  // A preset that never mentions the list carries neither field.
  const plain = toDefinition(normalizePreset({ id: 'p10', name: 'P10' }), [])
  const plainCapability = plain.plugins.find((row) => row.id === 'studio-capability')
  assert.equal(plainCapability.config.sections, undefined, 'an unmanaged preset keeps its old behavior')
  assert.equal(plainCapability.config.sectionsSuppressed, undefined, 'and carries no force list')
}

console.log('# 数据文件里的段清单：读到、保存不丢、复制继承')
{
  const dir = await mkdtemp(join(tmpdir(), 'aps-sections-'))
  const dataFile = join(dir, 'presets.json')
  const seeded = {
    version: 2,
    presets: [
      {
        id: 'p1',
        name: 'P1',
        instructionMode: 'custom',
        sections: ['harness:identity'],
        sectionsSuppressed: ['deployment:persona-prefix'],
        contexts: ['sandbox:policy'],
        tools: { mode: 'all', names: [] },
        skills: [],
      },
    ],
  }
  await writeFile(dataFile, JSON.stringify(seeded))
  const root = new Context()
  const store = new PresetStore(root, { dataFile })
  try {
    await store.load()
    assert.deepEqual(store.presets[0].sections, ['harness:identity'], 'the keep list is read from the document')
    assert.deepEqual(
      store.presets[0].sectionsSuppressed,
      ['deployment:persona-prefix'],
      'the force list survives the load',
    )

    // A page edit that does NOT submit the fields must carry them forward.
    await store.save({
      id: 'p1',
      name: 'P1 renamed',
      tools: { mode: 'all', names: [] },
      skills: [],
      contexts: ['sandbox:policy'],
    })
    assert.deepEqual(store.presets[0].sections, ['harness:identity'], 'a page save carries the keep list')
    assert.deepEqual(
      store.presets[0].sectionsSuppressed,
      ['deployment:persona-prefix'],
      'and leaves the force list alone',
    )

    // A duplicate of that preset inherits both.
    const copy = await store.save({ name: 'P1 copy', insertAfter: 'p1', tools: { mode: 'all', names: [] }, skills: [] })
    const copied = store.presets.find((preset) => preset.id === copy.id)
    assert.deepEqual(copied?.sections, ['harness:identity'], 'a copy inherits the keep list')
    assert.deepEqual(
      copied?.sectionsSuppressed,
      ['deployment:persona-prefix'],
      'and the force list',
    )
    assert.deepEqual(copied?.contexts, ['sandbox:policy'], 'a copy inherits the snapshot whitelist')

    // A NEW preset that submits no snapshot list stays UNMANAGED: undefined
    // means "every context injects", so a plugin's later row keeps injecting.
    // Writing the shipped names here would freeze the catalog of today and
    // open the row unchecked tomorrow.
    const fresh = await store.save({ name: 'P2', tools: { mode: 'all', names: [] }, skills: [] })
    const freshRow = store.presets.find((preset) => preset.id === fresh.id)
    assert.equal(freshRow?.contexts, undefined, 'a new preset without a list stays unmanaged')

    // Hand-editing the document and reloading is how the field reaches the Host.
    seeded.presets[0].sections = ['harness:identity', 'vendor:thing']
    await writeFile(dataFile, JSON.stringify(seeded))
    await store.load()
    assert.deepEqual(
      store.presets[0].sections,
      ['harness:identity', 'vendor:thing'],
      'a reload reads the edited document',
    )
    const definition = toDefinition(store.presets[0], [])
    assert.deepEqual(
      definition.plugins.find((row) => row.id === 'studio-capability').config.sections,
      ['harness:identity', 'vendor:thing'],
      'the reloaded list reaches the capability row',
    )

    // An explicit empty list is a decision (block every optional section) and
    // must be stored as such — not confused with an omitted field.
    await store.save({
      id: 'p1',
      name: 'P1',
      sections: [],
      tools: { mode: 'all', names: [] },
      skills: [],
      contexts: ['sandbox:policy'],
    })
    assert.deepEqual(store.presets[0].sections, [], 'an explicit empty keep list is kept')
  } finally {
    store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

console.log('# 自检按草稿段清单计算')
{
  const bundle = await boot()
  try {
    const store = bundle.store
    // Seed the live section view. `boot()` already pinned the scope key, so
    // `inspect` reuses this cached view instead of re-reading the registry.
    store.promptViews.set('p1', {
      contexts: new Map(),
      sections: new Set([
        'deployment:persona-prefix',
        'harness:identity',
        'dsh-context:prompt-prefix',
        'vendor:thing',
      ]),
    })
    store.presets[0] = { ...store.presets[0], sections: ['vendor:thing'] }
    // `inspect` only needs the standing-scope lease from the registry.
    store.registry = { acquireScope: async () => ({ key: bundle.presetKey }) }

    const stored = await store.inspectPreset('p1', {})
    assert(stored.sectionFilter?.available === true, 'the live section list is readable')
    assert.deepEqual(
      stored.sectionFilter?.blockedList?.sort(),
      ['dsh-context:prompt-prefix', 'harness:identity'],
      'the stored keep list blocks every section it does not name',
    )
    assert(
      stored.sectionFilter?.keptList?.includes('deployment:persona-prefix'),
      'the persona is kept without being listed',
    )

    // A draft that manages nothing overrides the stored list instead of
    // falling back to it.
    const unmanaged = await store.inspectPreset('p1', { sections: null })
    assert.equal(unmanaged.sectionFilter?.managed, false, 'the draft unmanages the list')
    assert.equal(unmanaged.sectionFilter?.blocked, 0, 'and nothing is blocked')

    // An empty draft list blocks every optional section.
    const empty = await store.inspectPreset('p1', { sections: [] })
    assert.deepEqual(
      empty.sectionFilter?.blockedList?.sort(),
      ['dsh-context:prompt-prefix', 'harness:identity', 'vendor:thing'],
      'an empty draft blocks every optional section',
    )
    assert.deepEqual(
      empty.sectionFilter?.keptList,
      ['deployment:persona-prefix'],
      'the persona is the only survivor',
    )

    // The ADVANCED force list follows the draft too.
    const forced = await store.inspectPreset('p1', {
      sections: null,
      sectionsSuppressed: ['deployment:persona-prefix'],
    })
    assert(
      forced.sectionFilter?.blockedList?.includes('deployment:persona-prefix'),
      'the force list moves the persona into the blocked list',
    )
    // The panel lists the concrete names behind the counts, so the answer must
    // carry them — a count alone cannot show which section moved.
    assert.equal(
      forced.sectionFilter?.blocked,
      forced.sectionFilter?.blockedList?.length,
      'the blocked count matches its list',
    )
    assert.equal(
      forced.sectionFilter?.kept,
      forced.sectionFilter?.keptList?.length,
      'the kept count matches its list',
    )
  } finally {
    await bundle.dispose()
  }
}

console.log('# 重启后首次 list：每个预设自己的 scope 都进目录')
{
  const bundle = await boot()
  try {
    const { store, presetScope, presetKey } = bundle
    // A section that exists ONLY inside this preset's composition.
    presetScope.ctx.get('systemPrompt').section({ name: 'vendor:first-load', order: 500, text: 'VENDOR' })
    await turn()
    // Simulate a restart: the store has never acquired p1's scope and holds no
    // cached views. The first `list` must warm it before building the catalogs;
    // otherwise the page shows a global-only checklist while `inspect` (which
    // acquires the requested scope) is complete.
    store.scopeKeys.delete('p1')
    store.promptViews.clear()
    assert.equal(
      store.promptView('p1'),
      undefined,
      'a preset view is never faked from the global layer when its scope is unknown',
    )
    let acquires = 0
    store.registry = {
      list: async () => [{ id: 'p1', name: 'P1' }],
      acquireScope: async (id) => {
        acquires += 1
        return { key: id === 'p1' ? presetKey : undefined }
      },
    }
    const view = await store.list()
    assert(store.scopeKeys.has('p1'), 'the first list acquires the preset scope')
    assert(
      view.meta.sectionCatalog.map((row) => row.name).includes('vendor:first-load'),
      'a preset-scope section reaches the first list',
    )
    assert(
      view.meta.contextCatalog.map((row) => row.name).includes('app:freshly-required'),
      'a preset-scope context reaches the first list',
    )
    // The warm-up is memoized: the next page load reuses the scopes and pays
    // no second composition for the same presets.
    const warmed = acquires
    const again = await store.list()
    assert.equal(acquires, warmed, 'a later list reuses the warmed scopes')
    assert(
      again.meta.contextCatalog.map((row) => row.name).includes('app:freshly-required'),
      'and still reports the full catalog',
    )

    // A preset that cannot compose is attempted once, then remembered until
    // `reconcile()` invalidates the warm-up — a broken row must not slow every
    // page load down.
    store.presets.push({ id: 'p2', name: 'P2', contexts: undefined, tools: { mode: 'all', names: [] }, skills: [] })
    store.scopesWarmed = false
    let brokenAttempts = 0
    const acquire = store.registry.acquireScope
    store.registry.acquireScope = async (id) => {
      if (id === 'p2') {
        brokenAttempts += 1
        throw new Error('broken preset')
      }
      return acquire(id)
    }
    await store.list()
    await store.list()
    assert.equal(brokenAttempts, 1, 'a broken preset is attempted once, not on every load')
  } finally {
    await bundle.dispose()
  }
}

console.log('\nall context-registry regressions passed')
