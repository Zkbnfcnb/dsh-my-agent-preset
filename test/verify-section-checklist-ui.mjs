/**
 * Regression: the prompt-section checklist in the editor.
 *
 * `custom` keeps exactly the sections the checklist leaves checked. This test
 * drives the real client bundle through the shared harness and pins:
 *   1. the checklist renders ONLY in `custom` mode;
 *   2. an UNMANAGED preset shows every optional row checked, with the required
 *      persona rows checked and disabled;
 *   3. toggling a row writes the keep list that reaches the save payload;
 *   4. 全选 / 取消全选 act on the optional half only, and an empty list is
 *      saved as `[]` (a decision), not dropped;
 *   5. the ADVANCED force-box stores `sectionsSuppressed` and flips the
 *      required row's readout;
 *   6. a stored list renders as the checked subset;
 *   7. `inspect` is asked against the DRAFT list, and the panel shows the
 *      kept / blocked counts and name lists.
 *
 * Run: node test/verify-section-checklist-ui.mjs
 */
import assert from 'node:assert/strict'
import { classNameOf, findNodes, mountStudio, textOf } from './_studio-harness.mjs'

const PLAIN = {
  id: 'custom-plain01',
  name: '普通',
  description: '',
  instructions: '你是助手。',
  instructionMode: 'append',
  contexts: undefined,
  skills: [],
  tools: { mode: 'all', names: [] },
  enabled: true,
  order: 0,
  status: {},
}

/** The same preset, already managing sections. */
const MANAGED = {
  ...PLAIN,
  id: 'custom-list01',
  name: '清单',
  instructionMode: 'custom',
  sections: ['third-party:notes'],
  sectionsSuppressed: ['deployment:persona-suffix'],
}

const META = {
  registryAvailable: true,
  contextCatalog: [],
  capabilities: ['snapshotContexts', 'requiredSuppression', 'contextRegistryTruth'],
  sectionCatalog: [
    { name: 'deployment:persona-prefix', required: true, present: true },
    { name: 'deployment:persona-suffix', required: true, present: false },
    { name: 'harness:identity', required: false, present: true },
    { name: 'third-party:notes', required: false, present: true },
  ],
}

/** An inspect answer that partitions the live sections. */
const SECTION_VIEW = {
  available: true,
  tools: [],
  blockedTools: [],
  skills: [],
  missingSkills: [],
  listedUnavailable: [],
  surfaceCount: 2,
  sectionFilter: {
    available: true,
    sections: 4,
    kept: 2,
    blocked: 2,
    managed: true,
    keptList: ['deployment:persona-prefix', 'third-party:notes'],
    blockedList: ['harness:identity', 'tool:bash'],
  },
}

const SECTION_LABEL = '注入的提示词段'
const FORCE_LABEL = '高级 · 强制屏蔽这一项（官方本不允许）'

const buttonsIn = (tree) => findNodes(tree, (n) => typeof n.props?.onClick === 'function')
const labelled = (tree, label) => buttonsIn(tree).filter((n) => textOf(n) === label)
const isCard = (n) => classNameOf(n).split(' ').includes('aps-card')
const saves = (studio) => studio.calls.filter((call) => call.endpoint === 'save').map((call) => call.body)
const inspects = (studio) => studio.calls.filter((call) => call.endpoint === 'inspect').map((call) => call.body)

/** The `aps-field` whose label is `label`. */
const fieldFor = (tree, label) =>
  findNodes(
    tree,
    (n) => classNameOf(n) === 'aps-field' && findNodes(n, (m) => classNameOf(m) === 'aps-label').some((m) => textOf(m) === label),
  )[0]

/** Checkbox rows inside the section field: `[{ name, checked, disabled, onChange }]`. */
const rowsOf = (tree) => {
  const field = fieldFor(tree, SECTION_LABEL)
  if (field === undefined) return []
  return findNodes(field, (n) => n.type === 'input' && n.props?.type === 'checkbox').map((node) => {
    const label = findNodes(tree, (n) => n.type === 'label' && n.children?.includes?.(node))[0]
    return {
      checked: node.props.checked,
      disabled: node.props.disabled,
      onChange: node.props.onChange,
      label: label === undefined ? '' : textOf(label),
    }
  })
}

/** The ordinary (non-force) checkboxes, one per catalog row. */
const sectionRows = (tree) => rowsOf(tree).filter((row) => row.label.includes(FORCE_LABEL) === false)

/** The ADVANCED force checkboxes (one per required row). */
const forceRows = (tree) => rowsOf(tree).filter((row) => row.label.includes(FORCE_LABEL))

/** Find one section checkbox by the section name in its row text. */
const rowFor = (tree, name) => sectionRows(tree).find((row) => row.label.includes(name))

/** Find the ADVANCED force checkbox for one persona row. */
const forceFor = (tree, name) => forceRows(tree).find((row) => row.label.includes(name))

const openEditor = async (studio, tree, cardIndex = 0) => {
  const card = findNodes(tree, isCard)[cardIndex]
  await findNodes(card, (n) => classNameOf(n).includes('aps-cardMain'))[0].props.onClick()
  return studio.root.flush()
}

const settleInspect = async (studio) => {
  // Render first so the debounced effect schedules its timer, then let it fire.
  await studio.root.flush()
  await new Promise((resolve) => setTimeout(resolve, 380))
  return studio.root.flush()
}

const inspectTextOf = (tree) => {
  const panel = findNodes(tree, (n) => classNameOf(n) === 'aps-inspect')[0]
  return panel === undefined ? '' : textOf(panel)
}

const selectedHint = (tree) => {
  const field = fieldFor(tree, SECTION_LABEL)
  return field === undefined ? '' : findNodes(field, (n) => classNameOf(n) === 'aps-hint').map(textOf).find((line) => line.startsWith('已选')) ?? ''
}

console.log('# 只在「自定义」下出现')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  assert.equal(fieldFor(tree, SECTION_LABEL), undefined, 'append mode hides the checklist')
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await studio.root.flush()
  assert.notEqual(fieldFor(tree, SECTION_LABEL), undefined, 'custom mode shows the checklist')
  await labelled(tree, '追加')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(fieldFor(tree, SECTION_LABEL), undefined, 'leaving custom hides it again')
}

console.log('# 未管理 = 全部勾选，人设段勾选且禁用')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await studio.root.flush()
  const rows = sectionRows(tree)
  assert.equal(rows.length, 4, `one checkbox per catalog row (got ${rows.length})`)
  assert.equal(forceRows(tree).length, 2, 'each required row carries one force-box')
  const persona = rowFor(tree, 'deployment:persona-prefix')
  assert.equal(persona?.checked, true, 'the persona prefix is checked')
  assert.equal(persona?.disabled, true, 'and disabled')
  const suffix = rowFor(tree, 'deployment:persona-suffix')
  assert.equal(suffix?.checked, true, 'the persona suffix is checked')
  assert.equal(suffix?.disabled, true, 'and disabled')
  const harness = rowFor(tree, 'harness:identity')
  assert.equal(harness?.checked, true, 'an optional row starts checked')
  assert.equal(harness?.disabled, false, 'and is editable')
  assert(selectedHint(tree).includes('4'), `the selected count includes the required rows (${selectedHint(tree)})`)
}

console.log('# 取消勾选 → 保存载荷 = 保留名单')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await studio.root.flush()
  await rowFor(tree, 'harness:identity').onChange()
  tree = await studio.root.flush()
  assert.equal(rowFor(tree, 'harness:identity').checked, false, 'the row is unchecked')
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const payload = saves(studio).at(-1)
  assert.deepEqual(payload?.sections, ['third-party:notes'], 'the unchecked row is absent from the keep list')
  assert.equal(payload?.sectionsSuppressed, undefined, 'and no force list is written')
}

console.log('# 取消全选只动普通行；空名单保存为 []')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await studio.root.flush()

  await labelled(tree, '取消全选')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(rowFor(tree, 'harness:identity').checked, false, 'clear-selection unchecks the optional row')
  assert.equal(rowFor(tree, 'deployment:persona-prefix').checked, true, 'but the persona stays checked')
  assert(selectedHint(tree).includes('2'), `the count drops to the required rows (${selectedHint(tree)})`)
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(saves(studio).at(-1)?.sections, [], 'an empty keep list is a decision, not an absent field')
}

console.log('# 全选保存全部普通行')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await studio.root.flush()
  await labelled(tree, '取消全选')[0].props.onClick()
  tree = await studio.root.flush()
  await labelled(tree, '全选')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(rowFor(tree, 'harness:identity').checked, true, 'select-all rechecks the optional row')
  assert.equal(rowFor(tree, 'deployment:persona-prefix').checked, true, 'and leaves the persona checked')
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(
    [...(saves(studio).at(-1)?.sections ?? [])].sort(),
    ['harness:identity', 'third-party:notes'],
    'select-all saves every optional row',
  )
}

console.log('# 高级 · 强制屏蔽 → sectionsSuppressed')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await studio.root.flush()
  const force = forceFor(tree, 'deployment:persona-prefix')
  assert.notEqual(force, undefined, 'a persona row carries the advanced force-box')
  assert.equal(force?.checked, false, 'it starts unchecked')
  await force.onChange()
  tree = await studio.root.flush()
  assert.equal(rowFor(tree, 'deployment:persona-prefix').checked, false, 'the persona readout flips to unchecked')
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(
    saves(studio).at(-1)?.sectionsSuppressed,
    ['deployment:persona-prefix'],
    'the force list reaches the save payload',
  )
}

console.log('# 已保存清单：部分勾选 + 已强制屏蔽')
{
  const studio = mountStudio({ presets: [MANAGED], meta: META, inspectView: SECTION_VIEW })
  const tree = await openEditor(studio, await studio.root.settle())
  assert.equal(rowFor(tree, 'third-party:notes').checked, true, 'a listed section is checked')
  assert.equal(rowFor(tree, 'harness:identity').checked, false, 'an unlisted section is unchecked')
  assert.equal(rowFor(tree, 'deployment:persona-suffix').checked, false, 'a force-blocked persona reads unchecked')
  assert.equal(forceFor(tree, 'deployment:persona-suffix')?.checked, true, 'and its force-box is checked')
}

console.log('# 自检按草稿计算，并显示保留/被屏蔽名单')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义')[0].props.onClick()
  tree = await settleInspect(studio)
  const first = inspects(studio).at(-1)
  assert.equal(first?.config?.sections, null, 'an unmanaged draft is sent as explicit null')

  await rowFor(tree, 'harness:identity').onChange()
  tree = await settleInspect(studio)
  const second = inspects(studio).at(-1)
  assert.deepEqual(second?.config?.sections, ['third-party:notes'], 'the draft keep list drives the inspect call')
  const panel = inspectTextOf(tree)
  assert(panel.includes('保留的提示词段 2 项'), `the panel shows the kept count (${panel})`)
  assert(panel.includes('被屏蔽的提示词段 2 项'), `the panel shows the blocked count (${panel})`)
  assert(panel.includes('third-party:notes'), 'and the kept names')
  assert(panel.includes('harness:identity'), 'and the blocked names')
}

console.log('\nall section-checklist UI regressions passed')
