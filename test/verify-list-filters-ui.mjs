/**
 * Regression: the filter box on the prompt-section and runtime-context lists.
 *
 * The tool checklist has carried a one-keyword filter for a while; these two
 * lists now use the SAME construction (`aps-filter` + `aps-input` search box,
 * `匹配 x/y` count, `没有匹配的 …` empty state, bulk actions limited to the
 * rows the filter left visible). This test drives the real client bundle
 * through the shared harness and pins, for BOTH lists:
 *   1. the box renders inside the field, with the tool filter's classes and a
 *      `type="search"` input carrying the localized placeholder;
 *   2. a keyword narrows the rows and shows the `匹配 {shown}/{total}` count;
 *   3. no match shows the filter-specific empty line and hides the bulk
 *      actions (the tool checklist does the same);
 *   4. 全选 / 取消全选 move only the VISIBLE rows — a hidden row keeps the
 *      decision it opened with;
 *   5. the section keyword matches the row name, the context keyword matches
 *      name, label and description;
 *   6. required rows stay checked/disabled under a filter, and the saved
 *      payload still carries the optional whitelist alone.
 *
 * Run: node test/verify-list-filters-ui.mjs
 */
import assert from 'node:assert/strict'
import { classNameOf, findNodes, mountStudio, textOf } from './_studio-harness.mjs'

const SECTION_LABEL = '注入的提示词段'
const CONTEXT_LABEL = '注入的快照项'

/** A managed preset: some optional contexts off, the rest checked. */
const PRESET = {
  id: 'custom-filter01',
  name: '过滤',
  description: '',
  instructions: '你是助手。',
  instructionMode: 'custom',
  includeWorkspace: true,
  contexts: ['sandbox:policy', 'approval:policy', 'harness:source'],
  skills: [],
  tools: { mode: 'all', names: [] },
  enabled: true,
  order: 0,
  status: {},
}

/** Five known context rows: two of them required. */
const CONTEXT_CATALOG = [
  { name: 'working-directory:current', label: '当前工作区', description: '会话当前的工作目录。', order: 100, required: true, known: true },
  { name: 'sandbox:policy', label: '沙箱策略', description: '文件沙箱模式。', order: 110, required: false, known: true },
  { name: 'approval:policy', label: '审批策略', description: '审批提示。', order: 115, required: false, known: true },
  { name: 'team:identity', label: '团队身份', description: '仅组队。', order: 125, required: true, known: true },
  { name: 'harness:source', label: 'Harness 实现检出路径', description: '检出目录。', order: 200, required: false, known: true },
  { name: 'app:web-surface', label: 'Web GUI 地址', description: 'GUI URL。', order: 210, required: false, known: true },
]

const META = {
  registryAvailable: true,
  contextCatalog: CONTEXT_CATALOG,
  capabilities: ['snapshotContexts', 'requiredSuppression'],
  sectionCatalog: [
    { name: 'deployment:persona-prefix', required: true, present: true },
    { name: 'deployment:persona-suffix', required: true, present: false },
    { name: 'harness:identity', required: false, present: true },
    { name: 'third-party:notes', required: false, present: true },
  ],
}

const isCard = (node) => classNameOf(node).split(' ').includes('aps-card')
const saves = (studio) => studio.calls.filter((call) => call.endpoint === 'save').map((call) => call.body)

const openEditor = async (studio, tree) => {
  const card = findNodes(tree, isCard)[0]
  await findNodes(card, (node) => classNameOf(node).includes('aps-cardMain'))[0].props.onClick()
  return studio.root.flush()
}

/** The `aps-field` whose label is `label`. */
const fieldFor = (tree, label) =>
  findNodes(
    tree,
    (node) =>
      classNameOf(node) === 'aps-field' &&
      findNodes(node, (inner) => classNameOf(inner) === 'aps-label').some((inner) => textOf(inner) === label),
  )[0]

/** The keyword box of one field, or undefined when the field hides it. */
const filterOf = (tree, label) => {
  const field = fieldFor(tree, label)
  if (field === undefined) return undefined
  return findNodes(field, (node) => node.type === 'input' && node.props?.type === 'search')[0]
}

/** The `aps-filter` wrapper of one field. */
const filterBoxOf = (tree, label) => {
  const field = fieldFor(tree, label)
  return field === undefined ? undefined : findNodes(field, (node) => classNameOf(node).includes('aps-filter'))[0]
}

/**
 * Main checkbox rows of one field, `[{ text, checked, disabled }]`.
 *
 * A required row carries a nested force-box under the same field; its wrapper
 * is `aps-checkRow aps-checkNested`, so the exact-class match below picks the
 * MAIN row only.
 */
const mainRowsIn = (field) =>
  findNodes(field, (node) => node.type === 'label' && classNameOf(node) === 'aps-checkRow').map((label) => {
    const box = findNodes(label, (node) => node.type === 'input')[0]
    return { text: textOf(label), checked: box?.props.checked, disabled: box?.props.disabled }
  })

const hintsIn = (field) => findNodes(field, (node) => classNameOf(node) === 'aps-hint').map(textOf)

const buttonsIn = (field, label) =>
  findNodes(field, (node) => node.type === 'button' && textOf(node) === label)

/** Type a keyword into the field's filter box and settle the render. */
const typeFilter = async (studio, label, value) => {
  const tree = await studio.root.flush()
  await filterOf(tree, label).props.onChange({ target: { value } })
  return studio.root.flush()
}

const sectionRows = (tree) => mainRowsIn(fieldFor(tree, SECTION_LABEL))
const contextRows = (tree) => mainRowsIn(fieldFor(tree, CONTEXT_LABEL))

console.log('# 提示词段：过滤框与工具模块同款')
{
  const studio = mountStudio({ presets: [PRESET], meta: META })
  const tree = await openEditor(studio, await studio.root.settle())
  const box = filterBoxOf(tree, SECTION_LABEL)
  assert.notEqual(box, undefined, 'the section list carries a filter box')
  assert(classNameOf(box).includes('aps-sectionFilter'), 'its wrapper names the list, like aps-toolFilter')
  const filter = filterOf(tree, SECTION_LABEL)
  assert.equal(filter?.props.type, 'search', 'the input is a search box')
  assert.equal(filter?.props.className, 'aps-input', 'it reuses the tool filter input class')
  assert.equal(filter?.props.placeholder, '过滤提示词段：名称')
  assert.equal(filter?.props['aria-label'], '过滤提示词段：名称', 'the box is announced')
  assert.equal(sectionRows(tree).length, 4, 'every catalog row is shown without a keyword')
}

console.log('# 提示词段：关键字收窄 + 匹配计数 + 空态')
{
  const studio = mountStudio({ presets: [PRESET], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  tree = await typeFilter(studio, SECTION_LABEL, 'HARNESS')
  const field = fieldFor(tree, SECTION_LABEL)
  assert.equal(mainRowsIn(field).length, 1, 'one row survives the keyword')
  assert(mainRowsIn(field)[0].text.includes('harness:identity'), 'and it is the matching one')
  assert(hintsIn(field).includes('匹配 1/4 个提示词段'), 'the count reports shown/total')
  // A filtered-away required row is simply hidden; the filter is not a switch.
  assert.equal(mainRowsIn(field).some((row) => row.text.includes('deployment:persona-prefix')), false)

  tree = await typeFilter(studio, SECTION_LABEL, 'no-such-row')
  const empty = fieldFor(tree, SECTION_LABEL)
  assert.equal(mainRowsIn(empty).length, 0, 'nothing matches')
  assert(hintsIn(empty).includes('没有匹配的提示词段'), 'the empty state names the filter, not the catalog')
  assert.equal(buttonsIn(empty, '全选').length, 0, 'no bulk action over an empty visible set')
  assert.equal(buttonsIn(empty, '取消全选').length, 0)

  tree = await typeFilter(studio, SECTION_LABEL, '')
  assert.equal(sectionRows(tree).length, 4, 'clearing the keyword restores the whole list')
  assert.equal(hintsIn(fieldFor(tree, SECTION_LABEL)).some((line) => line.startsWith('匹配')), false)
}

console.log('# 提示词段：批量操作只作用于可见行')
{
  const studio = mountStudio({ presets: [PRESET], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  // Unmanaged sections = every optional row checked.
  const before = sectionRows(tree).find((row) => row.text.includes('third-party:notes'))
  assert.equal(before?.checked, true, 'the optional row starts checked')
  assert.equal(sectionRows(tree).find((row) => row.text.includes('deployment:persona-prefix'))?.disabled, true)

  tree = await typeFilter(studio, SECTION_LABEL, 'harness')
  await buttonsIn(fieldFor(tree, SECTION_LABEL), '取消全选')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(sectionRows(tree)[0].checked, false, 'the visible row is unchecked')

  tree = await typeFilter(studio, SECTION_LABEL, 'third-party')
  assert.equal(sectionRows(tree).length, 1)
  assert.equal(sectionRows(tree)[0].checked, true, 'the hidden row keeps its decision')

  tree = await typeFilter(studio, SECTION_LABEL, 'harness')
  await buttonsIn(fieldFor(tree, SECTION_LABEL), '全选')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(sectionRows(tree)[0].checked, true, 'select-all rechecks the visible row')

  await findNodes(tree, (node) => node.type === 'button' && textOf(node) === '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(
    [...(saves(studio).at(-1)?.sections ?? [])].sort(),
    ['harness:identity', 'third-party:notes'],
    'the optional whitelist survives a filtered bulk edit',
  )
}

console.log('# 运行时上下文：过滤框与工具模块同款')
{
  const studio = mountStudio({ presets: [PRESET], meta: META })
  const tree = await openEditor(studio, await studio.root.settle())
  const box = filterBoxOf(tree, CONTEXT_LABEL)
  assert.notEqual(box, undefined, 'the context list carries a filter box')
  assert(classNameOf(box).includes('aps-contextFilter'))
  const filter = filterOf(tree, CONTEXT_LABEL)
  assert.equal(filter?.props.type, 'search')
  assert.equal(filter?.props.placeholder, '过滤上下文：名称或描述')
  assert.equal(contextRows(tree).length, CONTEXT_CATALOG.length, 'every catalog row is shown without a keyword')
}

console.log('# 运行时上下文：名称 / 标签 / 描述都能命中')
{
  const studio = mountStudio({ presets: [PRESET], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())

  tree = await typeFilter(studio, CONTEXT_LABEL, '审批')
  assert.equal(contextRows(tree).length, 1, 'a Chinese label match narrows the list')
  assert(contextRows(tree)[0].text.includes('approval:policy'), 'the label names the row')
  assert(hintsIn(fieldFor(tree, CONTEXT_LABEL)).includes('匹配 1/6 个上下文'))

  tree = await typeFilter(studio, CONTEXT_LABEL, 'gui url')
  assert.equal(contextRows(tree).length, 1, 'a description match narrows the list')
  assert(contextRows(tree)[0].text.includes('app:web-surface'))

  tree = await typeFilter(studio, CONTEXT_LABEL, 'working')
  assert.equal(contextRows(tree).length, 1, 'a technical-name match narrows the list')
  assert(contextRows(tree)[0].text.includes('working-directory:current'))

  tree = await typeFilter(studio, CONTEXT_LABEL, 'no-such-row')
  const empty = fieldFor(tree, CONTEXT_LABEL)
  assert.equal(mainRowsIn(empty).length, 0)
  assert(hintsIn(empty).includes('没有匹配的上下文'))
  assert.equal(buttonsIn(empty, '全选').length, 0, 'no bulk action over an empty visible set')
}

console.log('# 运行时上下文：批量操作只作用于可见行，必填行不受影响')
{
  const studio = mountStudio({ presets: [PRESET], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())

  tree = await typeFilter(studio, CONTEXT_LABEL, 'policy')
  assert.equal(contextRows(tree).length, 2, 'the keyword matches both policy rows')
  await buttonsIn(fieldFor(tree, CONTEXT_LABEL), '取消全选')[0].props.onClick()
  tree = await studio.root.flush()
  assert(contextRows(tree).every((row) => row.checked === false), 'the visible optional rows are cleared')

  tree = await typeFilter(studio, CONTEXT_LABEL, 'harness')
  assert.equal(contextRows(tree)[0].checked, true, 'a hidden optional row keeps its decision')

  tree = await typeFilter(studio, CONTEXT_LABEL, 'working')
  assert.equal(contextRows(tree).length, 1, 'the required row is filterable too')
  assert.equal(contextRows(tree)[0].checked, true, 'it stays checked')
  assert.equal(contextRows(tree)[0].disabled, true, 'and disabled — it is a readout')
  await buttonsIn(fieldFor(tree, CONTEXT_LABEL), '取消全选')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(contextRows(tree)[0].checked, true, 'a bulk clear cannot touch it')

  tree = await typeFilter(studio, CONTEXT_LABEL, '')
  await findNodes(tree, (node) => node.type === 'button' && textOf(node) === '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(saves(studio).at(-1)?.contexts, ['harness:source'], 'only the surviving optional row is saved')
}

console.log('OK — 两个过滤框与工具模块同款逻辑与 UI')
