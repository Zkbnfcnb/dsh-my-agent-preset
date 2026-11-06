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
 *   5. the `official-only` rule set is extensible and reports section names that
 *      look official but sit outside it;
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
import { classifySections, resolveOfficialRules } from '../capability.js'

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

    // The page prefills its rule boxes from this: an empty field means "the
    // built-in namespaces", so the reader must be told what those ARE.
    const listed = await bundle.store.list()
    assert(
      listed.meta.officialSectionDefaults.prefixes.includes('harness:'),
      'the shipped namespace list is reported to the page',
    )
    assert(
      listed.meta.officialSectionDefaults.names.includes('mcp-resource-servers'),
      'and the shipped exact-name list',
    )
  } finally {
    await bundle.dispose()
  }
}

console.log('# official-only 规则可扩展且能报出疑似漏网段')
{
  const names = ['deployment:persona-prefix', 'harness:identity', 'dsh:new-surface', 'mcp:github', 'vendor:thing']
  const base = classifySections(names)
  assert.deepEqual(base.official.sort(), ['deployment:persona-prefix', 'harness:identity'], 'known namespaces are official')
  assert.deepEqual(base.thirdParty.sort(), ['dsh:new-surface', 'mcp:github', 'vendor:thing'], 'the rest survives')
  assert.deepEqual(base.suspect, ['dsh:new-surface'], 'a reserved-looking namespace is reported as a possible leak')

  const widened = classifySections(names, { officialSectionPrefixes: ['vendor'] })
  assert.deepEqual(widened.official.sort(), ['deployment:persona-prefix', 'harness:identity', 'vendor:thing'], 'config widens the rule')
  assert(!widened.thirdParty.includes('vendor:thing'), 'and moves the row out of third-party')

  const exempt = classifySections(names, { officialSectionKeep: ['deployment:persona-prefix'] })
  assert.deepEqual(exempt.kept, ['deployment:persona-prefix'], 'an exemption outranks a reserved namespace')

  const rules = resolveOfficialRules({ officialSectionPrefixes: ['harness'] })
  assert(rules.prefixes.includes('harness:'), 'a bare prefix is normalised to a namespace')
  assert.equal(new Set(rules.prefixes).size, rules.prefixes.length, 'a repeated namespace is merged, not duplicated')
  assert(rules.prefixes.includes('deployment:'), 'the default namespaces remain in place')
}

console.log('# 预设自身承载官方段规则')
{
  const normalized = normalizePreset({
    id: 'p9',
    name: 'P9',
    officialSectionPrefixes: [' api ', 'api', ''],
    officialSectionNames: ['mcp-resource-servers-x'],
    officialSectionKeep: [],
  })
  assert.deepEqual(normalized.officialSectionPrefixes, ['api'], 'prefixes are trimmed and deduped')
  assert.deepEqual(normalized.officialSectionNames, ['mcp-resource-servers-x'], 'exact names are kept')
  assert.equal(normalized.officialSectionKeep, undefined, 'an empty list is not a decision')
  // The capability row must receive them, or the filter would never see them.
  const definition = toDefinition({ ...normalized, skills: [], tools: { mode: 'all', names: [] } }, [])
  const capability = definition.plugins.find((row) => row.id === 'studio-capability')
  assert.deepEqual(capability.config.officialSectionPrefixes, ['api'], 'the rule travels into the capability row')
  assert.deepEqual(capability.config.officialSectionKeep, undefined, 'and an absent rule stays absent')
  // A preset that never mentions the rules carries none of them.
  const plain = toDefinition(
    normalizePreset({ id: 'p10', name: 'P10', skills: [], tools: { mode: 'all', names: [] } }),
    [],
  )
  assert.equal(plain.plugins.find((row) => row.id === 'studio-capability').config.officialSectionPrefixes, undefined,
    'a legacy preset keeps running on the built-in namespaces')
}

console.log('# 数据文件里的规则：读到、保存不丢、复制继承')
{
  const dir = await mkdtemp(join(tmpdir(), 'aps-rules-'))
  const dataFile = join(dir, 'presets.json')
  const seeded = {
    version: 2,
    presets: [
      {
        id: 'p1',
        name: 'P1',
        instructionMode: 'official-only',
        officialSectionPrefixes: ['api'],
        officialSectionKeep: ['tool:mine'],
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
    assert.deepEqual(store.presets[0].officialSectionPrefixes, ['api'], 'the rule is read from the document')
    assert.deepEqual(store.presets[0].officialSectionKeep, ['tool:mine'], 'every stored rule field survives the load')

    // A page edit (the page has no rule control) must carry the rules forward.
    await store.save({
      id: 'p1',
      name: 'P1 renamed',
      tools: { mode: 'all', names: [] },
      skills: [],
      contexts: ['sandbox:policy'],
    })
    assert.deepEqual(store.presets[0].officialSectionPrefixes, ['api'], 'a page save carries the stored rule')
    assert.deepEqual(store.presets[0].officialSectionKeep, ['tool:mine'], 'and leaves the other fields alone')

    // A duplicate of that preset inherits them too.
    const copy = await store.save({ name: 'P1 copy', insertAfter: 'p1', tools: { mode: 'all', names: [] }, skills: [] })
    const copied = store.presets.find((preset) => preset.id === copy.id)
    assert.deepEqual(copied?.officialSectionPrefixes, ['api'], 'a copy inherits the rule')

    // Hand-editing the document and reloading is how the field reaches the Host.
    seeded.presets[0].officialSectionPrefixes = ['api', 'skill']
    await writeFile(dataFile, JSON.stringify(seeded))
    await store.load()
    assert.deepEqual(store.presets[0].officialSectionPrefixes, ['api', 'skill'], 'a reload reads the edited document')
    // ...and the capability row the preset composes carries it.
    const definition = toDefinition(store.presets[0], [])
    assert.deepEqual(
      definition.plugins.find((row) => row.id === 'studio-capability').config.officialSectionPrefixes,
      ['api', 'skill'],
      'the reloaded rule reaches the capability row',
    )
  } finally {
    store.dispose()
    await rm(dir, { recursive: true, force: true })
  }
}

console.log('\nall context-registry regressions passed')
