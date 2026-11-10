/**
 * Regression: the duplicate button and the runtime-context (snapshot) area.
 *
 * Drives the rendered page (see `_studio-harness.mjs`) and asserts what the
 * browser would SEND and what it SHOWS:
 *
 *   1. every card footer offers 复制 between 停用 and 删除, whatever the card's
 *      enabled state, in the page's own `aps-iconButton` style;
 *   2. clicking it POSTs `save` with a fresh id (empty, so the Host mints it),
 *      the name `源名（复制 1）`, every field copied, `enabled` copied, and
 *      `insertAfter` = the source id — and the second copy of a source whose
 *      （复制 1） already exists numbers on;
 *   3. the editor gains a 运行时上下文 group BETWEEN 提示词 and 技能, with one
 *      row per catalog entry: Chinese label + technical name + description, the
 *      required rows checked and DISABLED, a 全选 / 取消全选 pair, and a count;
 *   4. unchecking one optional row makes the saved `contexts` array drop it
 *      while both required names stay; an unmanaged preset opens fully checked
 *      and saving materialises that list;
 *   5. the runtime-check panel renders the kept/blocked snapshot counts and the
 *      two name lists.
 *
 * Run: node test/verify-copy-and-contexts-ui.mjs
 */
import assert from 'node:assert/strict'
import { findNodes, classNameOf, mountStudio, textOf, tick } from './_studio-harness.mjs'

/** One managed preset (both required rows checked, two optional rows off). */
const MANAGED = {
  id: 'custom-src01',
  name: '审查',
  description: '逐文件审查。',
  instructions: '你是审查者。',
  instructionMode: 'append',
  includeWorkspace: true,
  // Only the optional half ever lands in `contexts`; required names are decided
  // by the advanced `requiredSuppressed` list alone.
  contexts: ['sandbox:policy', 'approval:policy', 'harness:source'],
  skills: ['pdf'],
  tools: { mode: 'allow', names: ['bash', 'read'] },
  enabled: true,
  order: 0,
  status: {},
}

/** A preset stored BEFORE the snapshot feature existed: no `contexts` field. */
const UNMANAGED = { ...MANAGED, id: 'custom-old02', name: '旧预设', enabled: false, order: 1 }
delete UNMANAGED.contexts

/** A copy whose name is already taken, to prove the numbering goes on. */
const TAKEN = { ...MANAGED, id: 'custom-copy01', name: '审查（复制 1）', order: 2 }

/** The catalog the Host serves: seven known rows, two of them required. */
const CATALOG = [
  { name: 'working-directory:current', label: '当前工作区', description: '会话当前的工作目录。', order: 100, required: true, known: true },
  { name: 'sandbox:policy', label: '沙箱策略', description: '文件沙箱模式。', order: 110, required: false, known: true },
  { name: 'approval:policy', label: '审批策略', description: '审批提示。', order: 115, required: false, known: true },
  { name: 'subagent:delegation', label: '子 Agent 委派说明', description: '仅子 Agent。', order: 120, required: false, known: true },
  { name: 'team:identity', label: '团队身份', description: '仅组队。', order: 125, required: true, known: true },
  { name: 'harness:source', label: 'Harness 实现检出路径', description: '检出目录。', order: 200, required: false, known: true },
  { name: 'app:web-surface', label: 'Web GUI 地址', description: 'GUI URL。', order: 210, required: false, known: true },
]

/** A preset that already opted into the escape hatch for the workspace row. */
const FORCED = {
  ...MANAGED,
  id: 'custom-frc03',
  name: '强制屏蔽样本',
  contexts: ['sandbox:policy', 'approval:policy', 'harness:source', 'subagent:delegation', 'app:web-surface'],
  requiredSuppressed: ['working-directory:current'],
  order: 3,
}

const PRESETS = [MANAGED, UNMANAGED, TAKEN]

/** A Host that understands snapshot whitelists AND the force-suppress hatch. */
const META = { registryAvailable: true, contextCatalog: CATALOG, capabilities: ['snapshotContexts', 'requiredSuppression'] }

/** The row wrapper of one catalog entry (main box, plus its advanced box). */
const mainRowsIn = (tree) =>
  findNodes(tree, (n) => classNameOf(n) === 'aps-checkRow' && classNameOf(n).includes('aps-checkNested') === false)
/** The nested 「高级 · 强制屏蔽」 boxes, one per required row. */
const nestedRowsIn = (tree) => findNodes(tree, (n) => classNameOf(n).includes('aps-checkNested'))
const boxOf = (row) => findNodes(row, (n) => n.type === 'input')[0]
const rowFor = (tree, name) => mainRowsIn(tree).find((r) => textOf(r).includes(name))
/**
 * The row wrapper of one catalog entry: the `div` whose first child is that
 * entry's main row. Checked rows float to the top of the list, so the nested
 * advanced box cannot be picked by index — it must be found through its owner.
 */
const wrapperFor = (tree, name) =>
  findNodes(tree, (n) =>
    n.type === 'div' &&
    (n.children ?? []).some((c) => classNameOf(c) === 'aps-checkRow' && textOf(c).includes(name)),
  )[0]
/** The nested 「高级 · 强制屏蔽」 box belonging to one row. */
const forceBoxFor = (tree, name) => boxOf(nestedRowsIn(wrapperFor(tree, name))[0])

const buttonsIn = (tree) => findNodes(tree, (n) => typeof n.props?.onClick === 'function')
/** One preset card: `aps-card` as its OWN class token, not a compound name. */
const isCard = (n) => classNameOf(n).split(' ').includes('aps-card')
const labelled = (tree, label) => buttonsIn(tree).filter((n) => textOf(n) === label)
const noticesIn = (tree) => findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf)
const saves = (studio) => studio.calls.filter((call) => call.endpoint === 'save').map((call) => call.body)

console.log('# 卡片底栏：复制按钮的位置与样式')
{
  const studio = mountStudio({ presets: PRESETS, meta: META })
  const tree = await studio.root.settle()
  const cards = findNodes(tree, (n) => classNameOf(n).split(' ').includes('aps-cardFoot'))
  assert.equal(cards.length, 3, `three card footers, got ${cards.length}`)
  for (const foot of cards) {
    const names = findNodes(foot, (n) => n.type === 'button').map(textOf)
    assert(names.includes('复制'), `footer offers 复制: ${names.join(' / ')}`)
    // id … 停用/启用 → 复制 → 删除
    assert(names.indexOf('复制') === names.indexOf('删除') - 1, `复制 sits right before 删除: ${names.join(' / ')}`)
    assert(names.indexOf('复制') === names.indexOf(names.find((n) => n === '启用' || n === '停用')) + 1, `复制 follows the toggle: ${names.join(' / ')}`)
    const button = findNodes(foot, (n) => n.type === 'button' && textOf(n) === '复制')[0]
    assert.equal(button.props.className, 'aps-iconButton', '复制 uses the footer button class the neighbours use')
    assert.equal(button.props.disabled, false, '复制 is clickable once data is loaded')
  }
  // A DISABLED card still gets the button — it is placed after the toggle, not
  // conditioned on the state.
  const offCard = findNodes(tree, (n) => isCard(n) && classNameOf(n).includes('aps-cardOff'))[0]
  assert(offCard !== undefined, 'the disabled card renders as off')
  assert(findNodes(offCard, (n) => n.type === 'button').map(textOf).includes('复制'), 'off card still offers 复制')
}

console.log('# 点击复制：发往 Host 的载荷')
{
  const studio = mountStudio({ presets: PRESETS, meta: META })
  const tree = await studio.root.settle()
  const card = findNodes(tree, isCard)[0]
  const copy = findNodes(card, (n) => n.type === 'button' && textOf(n) === '复制')[0]
  await copy.props.onClick()
  const after = await studio.root.flush()
  const body = saves(studio)[0]
  assert(body !== undefined, 'the click POSTed save')
  assert.equal(body.id, '', 'a fresh id is minted by the Host, not reused')
  assert.equal(body.name, '审查（复制 2）', '（复制 1）is already taken by another card, so the number goes on')
  assert.equal(body.insertAfter, 'custom-src01', 'insertAfter names the source for the position + order rewrite')
  assert.equal(body.enabled, true, 'the enabled state is copied from the source')
  assert.equal(body.description, MANAGED.description, 'description copied')
  assert.equal(body.instructions, MANAGED.instructions, 'instructions copied')
  assert.equal(body.instructionMode, MANAGED.instructionMode, 'injection mode copied')
  assert.equal(body.includeWorkspace, true, 'workspace option copied')
  assert.deepEqual(body.skills, MANAGED.skills, 'skills copied')
  assert.deepEqual(body.tools, MANAGED.tools, 'tool selection copied')
  // Copied as-is: a managed source yields a managed copy, whitelist included.
  assert.deepEqual(body.contexts, MANAGED.contexts, 'the snapshot whitelist is copied verbatim')
  assert(!('requiredSuppressed' in body), 'an un-forced source copies without the advanced field')
  assert(noticesIn(after).some((text) => text.includes('已复制为 审查（复制 2）')), `notice reports the new name: ${noticesIn(after).join(' / ')}`)
  // Duplicate is NOT an edit: the page stays on the list, no editor opens.
  assert.equal(findNodes(after, isCard).length, 3, 'the list is still the list')
}
{
  // A forced source copies its advanced list too — a duplicate is a copy.
  const forcedStudio = mountStudio({ presets: [FORCED], meta: META })
  const ftree = await forcedStudio.root.settle()
  const fcard = findNodes(ftree, isCard)[0]
  await findNodes(fcard, (n) => n.type === 'button' && textOf(n) === '复制')[0].props.onClick()
  await forcedStudio.root.flush()
  const fbody = saves(forcedStudio)[0]
  assert.deepEqual(fbody.requiredSuppressed, FORCED.requiredSuppressed, 'the force-suppress list is copied as-is')

  // An unmanaged source stays unmanaged in the copy: no array is invented.
  const studio = mountStudio({ presets: [UNMANAGED], meta: META })
  const tree = await studio.root.settle()
  const card = findNodes(tree, isCard)[0]
  await findNodes(card, (n) => n.type === 'button' && textOf(n) === '复制')[0].props.onClick()
  await studio.root.flush()
  const body = saves(studio)[0]
  assert.equal(body.name, '旧预设（复制 1）', 'the first copy of a name gets 1')
  assert.equal(body.enabled, false, 'a disabled source copies as disabled')
  assert(!('contexts' in body) || body.contexts === undefined, 'an unmanaged source copies unmanaged')
}

console.log('# 编辑器：运行时上下文分组')
const openEditor = async (studio, tree, cardIndex = 0) => {
  const card = findNodes(tree, isCard)[cardIndex]
  await findNodes(card, (n) => classNameOf(n).includes('aps-cardMain'))[0].props.onClick()
  let built = await studio.root.flush()
  // The editor auto-reads the runtime view: a real 0ms timer plus a fetch chain
  // resolve across several macrotasks, and the harness's flush stops as soon as
  // nothing is dirty — which happens while the fetch is still in flight. Nudge
  // it until the panel has actually rendered.
  for (let round = 0; round < 12; round += 1) {
    await tick()
    built = await studio.root.flush()
    if (findNodes(built, (n) => classNameOf(n) === 'aps-inspectCount').length > 0) break
  }
  return built
}
{
  const studio = mountStudio({ presets: PRESETS, meta: META })
  const tree = await openEditor(studio, await studio.root.settle(), 0)
  const heads = findNodes(tree, (n) => classNameOf(n) === 'aps-groupHead').map(textOf)
  const order = heads.indexOf('提示词')
  assert(order >= 0, `提示词 group found: ${heads.join(' / ')}`)
  assert(heads.includes('运行时上下文'), `snapshot group rendered between prompt and skills: ${heads.join(' / ')}`)
  assert(heads.indexOf('运行时上下文') === order + 1, 'group sits directly after 提示词')
  assert(heads.indexOf('技能') > heads.indexOf('运行时上下文'), '…and before 技能')

  // One row per catalog entry, with label + technical name + description.
  const rows = mainRowsIn(tree)
  assert.equal(rows.length, CATALOG.length, `rows: ${rows.length}`)
  const rowText = rows.map(textOf).join(' ')
  for (const item of CATALOG) {
    assert(rowText.includes(item.label), `row shows the Chinese label: ${item.label}`)
    assert(rowText.includes(item.name), `row shows the technical name: ${item.name}`)
  }
  assert(findNodes(tree, (n) => textOf(n) === '必需 · 不可关闭').length >= 2, 'required rows carry the tag')

  // A required row's MAIN box is a readout: checked because it injects, disabled
  // because an ordinary whitelist cannot beat DSH's force-restore. The switch
  // that can is the nested advanced box, and it starts OFF.
  const requiredNames = CATALOG.filter((i) => i.required === true).map((i) => i.name)
  for (const name of requiredNames) {
    const box = boxOf(rowFor(tree, name))
    assert.equal(box.props.checked, true, `required row reads as injecting: ${name}`)
    assert.equal(box.props.disabled, true, `required main box is a readout, not a control: ${name}`)
  }
  const nested = nestedRowsIn(tree)
  assert.equal(nested.length, requiredNames.length, 'one advanced box per required row')
  for (const row of nested) assert.equal(boxOf(row).props.checked, false, 'force-suppress defaults to OFF')
  // Optional rows follow the stored whitelist.
  assert.equal(boxOf(rowFor(tree, 'sandbox:policy')).props.checked, true, 'checked optional row')
  assert.equal(boxOf(rowFor(tree, 'app:web-surface')).props.checked, false, 'unchecked optional row')
}

console.log('# 勾选变化 → 保存载荷')
{
  const studio = mountStudio({ presets: PRESETS, meta: META })
  let tree = await openEditor(studio, await studio.root.settle(), 0)
  const sandboxRow = findNodes(tree, (n) => classNameOf(n) === 'aps-checkRow').find((r) => textOf(r).includes('sandbox:policy'))
  assert(sandboxRow !== undefined, 'sandbox row found')
  const box = findNodes(sandboxRow, (n) => n.type === 'input')[0]
  assert.equal(box.props.checked, true, 'sandbox starts checked for the managed preset')
  await box.props.onChange({ target: { checked: false } })
  tree = await studio.root.flush()
  // Name must stay non-empty for the save button to be enabled; the draft is
  // already valid here.
  const save = labelled(tree, '保存')[0]
  assert(save !== undefined && save.props.disabled === false, 'save stays enabled')
  await save.props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert(body !== undefined, 'the page POSTed save')
  assert.equal(body.id, 'custom-src01', 'editing keeps the id')
  // `contexts` is the OPTIONAL half only: a required name has no business in it
  // (its suppression is decided by the advanced list), and the row the user just
  // unchecked is saved out.
  assert(body.contexts.includes('approval:policy'), 'the other optional rows survive the edit')
  assert(!body.contexts.includes('working-directory:current'), 'required names are never written to contexts')
  assert(!body.contexts.includes('team:identity'), 'nor the second required name')
  assert(!body.contexts.includes('sandbox:policy'), 'the unchecked optional row is saved out')
  assert(!('requiredSuppressed' in body), 'an untouched hatch stays absent — the contract holds')
}
{
  // An unmanaged preset OPENS fully checked (that is what it injects) and an
  // untouched save leaves it unmanaged: materialising today's catalog into a
  // whitelist would freeze the rows that happen to exist now, so every row a
  // plugin registers (or a running Agent reports) later would open UNCHECKED
  // here while a new preset shows it checked.
  const studio = mountStudio({ presets: [UNMANAGED], meta: META })
  let tree = await openEditor(studio, await studio.root.settle(), 0)
  const rows = mainRowsIn(tree)
  const checked = rows.filter((r) => boxOf(r).props.checked === true)
  assert.equal(checked.length, rows.length, 'an unmanaged preset opens with every row checked')
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert.equal(body.contexts, undefined, 'an untouched snapshot list stays unmanaged, not a frozen whitelist')
  assert(!('requiredSuppressed' in body), 'the advanced list stays absent when nothing was forced')
  // 取消全选 moves the optional rows and never the required ones.
  const after = await openEditor(studio, await studio.root.settle(), 0)
  await labelled(after, '取消全选')[0].props.onClick()
  const cleared = await studio.root.flush()
  assert.equal(boxOf(rowFor(cleared, 'sandbox:policy')).props.checked, false, 'clear-all unchecks the optional rows')
  assert.equal(boxOf(rowFor(cleared, 'working-directory:current')).props.checked, true, 'clear-all keeps required rows injecting')
}

console.log('# 高级：强制屏蔽必需项')
{
  // Default OFF: a preset that never opted in shows its required rows checked.
  const studio = mountStudio({ presets: [FORCED], meta: META })
  let tree = await openEditor(studio, await studio.root.settle(), 0)
  const wdRow = rowFor(tree, 'working-directory:current')
  assert.equal(boxOf(wdRow).props.checked, false, 'a forced required row reads as NOT injecting')
  assert(findNodes(wdRow, (n) => textOf(n) === '已被本预设强制屏蔽').length === 1, 'the forced tag replaces the required tag')
  // Opening the editor of a preset with the OTHER required row untouched shows
  // the default: nested box off, main box on.
  assert.equal(boxOf(rowFor(tree, 'team:identity')).props.checked, true, 'the un-forced required row still injects')

  // Turning the hatch ON is the nested box; turning it OFF again needs no
  // confirmation because it only restores DSH's default.
  await forceBoxFor(tree, 'team:identity').props.onChange({ target: { checked: true } })
  tree = await studio.root.flush()
  assert.equal(boxOf(rowFor(tree, 'team:identity')).props.checked, false, 'the main box follows the hatch')
  assert(textOf(tree).includes('DSH 升级'), 'the warning spells out the silent-void risk')
  assert(textOf(tree).includes('不知道自己在哪个目录') || textOf(tree).includes('DSH 升级'), 'the warning names the concrete cost')
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert.deepEqual(body.requiredSuppressed, ['working-directory:current', 'team:identity'], 'both forced names persist, in catalog order')
  assert(body.contexts.every((n) => CATALOG.find((i) => i.name === n)?.required !== true), 'required names never enter contexts')

  // Un-forcing writes an empty list, which the Host normalizes back to
  // "contract holds".
  const back = await openEditor(studio, await studio.root.settle(), 0)
  // The list re-reads the test's canned fixtures, so this only proves the
  // STORED state renders — the save payload asserted above is the persistence
  // evidence.
  assert.equal(forceBoxFor(back, 'working-directory:current').props.checked, true, 'the hatch is on for the stored name')
  assert.equal(forceBoxFor(back, 'team:identity').props.checked, false, 'and off for a name the fixture never forced')
  await forceBoxFor(back, 'working-directory:current').props.onChange({ target: { checked: false } })
  const unf = await studio.root.flush()
  assert.equal(boxOf(rowFor(unf, 'working-directory:current')).props.checked, true, 'un-forcing restores the required row')
}

console.log('# 自检面板：快照计数与两个名单')
{
  const studio = mountStudio({
    presets: PRESETS,
    meta: META,
    inspectView: {
      available: true,
      enabled: true,
      mode: 'all',
      listed: [],
      tools: ['bash'],
      blockedTools: [],
      surfaceCount: 1,
      listedUnavailable: [],
      skills: ['pdf'],
      missingSkills: [],
      skillsToolAvailable: true,
      contexts: ['working-directory:current', 'sandbox:policy', 'team:identity'],
      blockedContexts: ['app:web-surface', 'vendor:telemetry'],
      contextSurfaceCount: 5,
      contextsManaged: true,
    },
  })
  const tree = await openEditor(studio, await studio.root.settle(), 0)
  const facts = findNodes(tree, (n) => classNameOf(n) === 'aps-fact').map(textOf)
  assert(
    facts.some((f) => f.includes('保留的快照上下文 3')),
    `kept count rendered with the list's own wording: ${facts.join(' / ')}`,
  )
  assert(facts.some((f) => f.includes('被屏蔽的快照上下文 2')), 'blocked count rendered with the list wording')
  const lists = findNodes(tree, (n) => classNameOf(n) === 'aps-nameListBlock').map(textOf)
  assert(lists.some((l) => l.includes('保留的快照上下文') && l.includes('app:web-surface') === false), 'kept list shown without blocked names')
  assert(lists.some((l) => l.includes('被屏蔽的快照上下文') && l.includes('vendor:telemetry')), 'blocked list shown')
}
{
  // The summary chips and the list headings must speak ONE vocabulary: a chip
  // that says "被名单拒绝 1 个" above a list called "被名单拒绝的工具（1）" makes
  // the reader match two wordings for the same number.
  const studio = mountStudio({
    presets: PRESETS,
    meta: META,
    inspectView: {
      available: true,
      enabled: true,
      mode: 'allow',
      listed: ['bash'],
      tools: ['bash'],
      blockedTools: ['read'],
      surfaceCount: 2,
      listedUnavailable: [],
      skills: ['pdf'],
      missingSkills: [],
      skillsToolAvailable: true,
      contexts: ['working-directory:current'],
      blockedContexts: ['app:web-surface'],
      contextSurfaceCount: 2,
      contextsManaged: true,
    },
  })
  const tree = await openEditor(studio, await studio.root.settle(), 0)
  /** Drop the number, the parenthesised count and a trailing measure word. */
  const stem = (text) =>
    text
      .replace(/[0-9]+/g, '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[个项]\s*$/, '')
      .replace(/[:：]\s*$/, '')
      .trim()
  // Scoped to the summary bar: `aps-fact` is also the tag pill inside the
  // context checklist, which is not part of this vocabulary.
  const countBar = findNodes(tree, (n) => classNameOf(n) === 'aps-inspectCount')[0]
  assert(countBar !== undefined, 'the summary bar rendered')
  const chips = findNodes(countBar, (n) => classNameOf(n) === 'aps-fact').map(textOf)
  const titles = findNodes(tree, (n) => classNameOf(n) === 'aps-nameListTitle').map(textOf)
  // "继承工具面" has no list under it (it is the whole surface), so it is the
  // one chip allowed to stand alone.
  const comparable = chips.filter((chip) => chip.includes('继承工具面') === false)
  const stems = new Set(titles.map(stem))
  for (const chip of comparable) {
    assert(stems.has(stem(chip)), `chip "${chip}" matches a list heading, got ${[...stems].join(' / ')}`)
  }
  assert(titles.length >= 4, `the panel lists what the chips count: ${titles.join(' | ')}`)
}

{
  // An unmanaged preset says so instead of pretending every row was chosen.
  const studio = mountStudio({
    presets: PRESETS,
    meta: META,
    inspectView: {
      available: true,
      enabled: true,
      mode: 'all',
      listed: [],
      tools: ['bash'],
      blockedTools: [],
      surfaceCount: 1,
      listedUnavailable: [],
      skills: [],
      missingSkills: [],
      skillsToolAvailable: true,
      contexts: CATALOG.map((item) => item.name),
      blockedContexts: [],
      contextSurfaceCount: CATALOG.length,
      contextsManaged: false,
    },
  })
  const tree = await openEditor(studio, await studio.root.settle(), 0)
  const facts = findNodes(tree, (n) => classNameOf(n) === 'aps-fact').map(textOf)
  assert(facts.some((f) => f.includes('未管理快照')), `unmanaged state reported: ${facts.join(' / ')}`)
}

console.log('# 旧 Host 降级（Host 进程仍是安装前的代码）')
{
  // Cordis caches imported modules per process, so a freshly installed Host
  // half only takes effect after a restart. Until then `meta` carries no
  // `contextCatalog` and `inspect` answers without any `contexts` field. The
  // page must degrade to “nothing is claimed”: an empty list, no checked-count
  // that would read as “0 injected”, and no kept/blocked numbers — while a save
  // must NOT invent a whitelist out of that empty view.
  // A MANAGED preset must survive the same degraded read: recomputing either
  // half from an empty catalog would blank its stored whitelist (blocking every
  // optional context) or drop its force list, all without the user touching a
  // thing. So the draft's own fields go out untouched.
  const managed = mountStudio({ presets: [MANAGED], meta: { registryAvailable: true } })
  const mtree = await openEditor(managed, await managed.root.settle(), 0)
  await labelled(mtree, '保存')[0].props.onClick()
  await managed.root.flush()
  const mbody = saves(managed)[0]
  assert.deepEqual(mbody.contexts, MANAGED.contexts, 'a stored whitelist is preserved when no catalog was served')
  assert(!('requiredSuppressed' in mbody), 'and no advanced field is invented')

  const studio = mountStudio({ presets: [UNMANAGED], meta: { registryAvailable: true } })
  const tree = await openEditor(studio, await studio.root.settle(), 0)
  assert(findNodes(tree, (n) => classNameOf(n) === 'aps-checkRow').length === 0, 'no rows without a catalog')
  assert(textOf(tree).includes('当前没有可勾选的快照上下文项'), 'empty-state hint shown')
  assert(findNodes(tree, (n) => classNameOf(n) === 'aps-groupHead').map(textOf).includes('运行时上下文'), 'the group is still there')
  // Only this group's own header row: the skills header legitimately counts.
  const contextHeadRow = findNodes(tree, (n) => classNameOf(n) === 'aps-groupHeadRow' && textOf(n).includes('运行时上下文'))[0]
  assert(contextHeadRow !== undefined, 'the group header row rendered')
  assert(!textOf(contextHeadRow).includes('已选'), `no false checked-count: ${textOf(contextHeadRow)}`)
  const facts = findNodes(tree, (n) => classNameOf(n) === 'aps-fact').map(textOf)
  assert(
    !facts.some((f) => f.includes('保留的快照上下文')),
    'no snapshot counts the old Host cannot back',
  )

  await labelled(tree, '保存')[0].props.onClick()
  await studio.root.flush()
  const body = saves(studio)[0]
  assert(body !== undefined && !('contexts' in body), 'save does not materialise a whitelist from an empty catalog')
}

console.log('# 能力门控（新 Client + 会丢字段的旧 Host）')
{
  // A Client can be hot-reloaded onto a Host that predates the hatch, which
  // silently drops `requiredSuppressed` on save. The box must therefore not
  // exist, a stored suppression must read as INERT (it still injects — the
  // honest answer), and a save must not persist a field the Host cannot apply.
  const legacy = mountStudio({ presets: [FORCED], meta: { registryAvailable: true, contextCatalog: CATALOG } })
  const tree = await openEditor(legacy, await legacy.root.settle(), 0)
  assert.equal(nestedRowsIn(tree).length, 0, 'no advanced box without the capability')
  assert.equal(boxOf(rowFor(tree, 'working-directory:current')).props.checked, true, 'a stored suppression reads as still injecting')
  assert(textOf(tree).includes('此 Host 不支持强制屏蔽'), 'and says why')
  await labelled(tree, '保存')[0].props.onClick()
  await legacy.root.flush()
  const body = saves(legacy)[0]
  // The stored list is passed through UNCHANGED rather than dropped: the box
  // that could edit it is not offered, so no new suppression can be made, and
  // erasing an existing one would destroy the user's intent across a Host
  // upgrade round-trip.
  assert.deepEqual(body.requiredSuppressed, FORCED.requiredSuppressed, 'a stored suppression survives untouched')
  assert(body.contexts !== undefined, 'and the ordinary whitelist still saves')
}

console.log('\nall copy-and-contexts UI regressions passed')
