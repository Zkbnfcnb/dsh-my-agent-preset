/**
 * Regression: an UNMANAGED prompt-section / snapshot list must stay unmanaged.
 *
 * The two checklists have a third state besides "checked" and "unchecked": an
 * absent field means "this preset does not manage the list, everything
 * injects". Saving used to materialise the fully-checked rows the panel showed
 * into an explicit whitelist, which froze the catalog of that moment. The
 * catalog keeps growing on its own (a plugin registers a section, a running
 * Agent reports a snapshot context), so the frozen preset opened with every
 * LATER row unchecked while a NEW preset showed it checked — the two editors
 * disagreed about the same list.
 *
 * This test pins the rule for all four lists:
 *   1. an untouched unmanaged list is saved WITHOUT its field (no whitelist);
 *   2. after the catalog grows, an existing unmanaged preset and a new preset
 *      show the SAME checked set (the user-visible symptom);
 *   3. only an explicit edit (a checkbox or a bulk action) turns the list into
 *      a strict whitelist — and that whitelist then does not auto-grow;
 *   4. skills and tools have no such dichotomy (empty skills = none; tools
 *      `all` = every tool), so their payloads never freeze the catalog either.
 *
 * Run: node test/verify-unmanaged-lists.mjs
 */
import assert from 'node:assert/strict'
import { classNameOf, findNodes, mountStudio, textOf } from './_studio-harness.mjs'

const SECTIONS_NOW = [
  { name: 'deployment:persona-prefix', required: true, present: true },
  { name: 'harness:identity', required: false, present: true },
  { name: 'third-party:notes', required: false, present: true },
]
const SECTIONS_LATER = [...SECTIONS_NOW, { name: 'later:section', required: false, present: true }]

const CONTEXTS_NOW = [
  { name: 'working-directory:current', label: '当前工作区', description: 'cwd', order: 100, required: true, known: true },
  { name: 'sandbox:policy', label: '沙箱策略', description: 'sandbox', order: 110, required: false, known: true },
]
const CONTEXTS_LATER = [
  ...CONTEXTS_NOW,
  { name: 'later:policy', label: '后注册项', description: 'later', order: 120, required: false, known: true },
]

const TOOLS = [
  { name: 'bash', description: 'shell', global: true },
  { name: 'read', description: 'read a file' },
]
const SKILLS = [{ key: 'local', label: '本地', skills: [{ name: 'pdf', description: 'PDF 处理' }] }]

const metaFor = (sections, contexts) => ({
  registryAvailable: true,
  capabilities: ['snapshotContexts', 'requiredSuppression'],
  sectionCatalog: sections,
  contextCatalog: contexts,
  tools: TOOLS,
  skillGroups: SKILLS,
})

/** A legacy/unmanaged preset: neither list field exists in its data file. */
const PRESET = {
  id: 'custom-old01',
  name: '旧预设',
  description: '',
  instructions: '',
  instructionMode: 'custom',
  includeWorkspace: true,
  contexts: undefined,
  sections: undefined,
  skills: [],
  tools: { mode: 'all', names: [] },
  enabled: true,
  order: 0,
  status: {},
}

const isCard = (node) => classNameOf(node).split(' ').includes('aps-card')
const saves = (studio) => studio.calls.filter((call) => call.endpoint === 'save').map((call) => call.body)
const labels = (tree, text) => findNodes(tree, (node) => node.type === 'button' && textOf(node) === text)

const openEditor = async (studio) => {
  const tree = await studio.root.flush()
  const card = findNodes(tree, isCard)[0]
  await findNodes(card, (node) => classNameOf(node).includes('aps-cardMain'))[0].props.onClick()
  return studio.root.flush()
}

const createEditor = async (studio) => {
  let tree = await studio.root.settle()
  await findNodes(tree, (node) => node.type === 'button' && textOf(node).includes('新建'))[0].props.onClick()
  tree = await studio.root.flush()
  await labels(tree, '自定义')[0].props.onClick()
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

/** `[{ text, checked }]` of the MAIN rows in one field. */
const rowsIn = (field) => {
  if (field === undefined) return []
  return findNodes(field, (node) => node.type === 'label' && classNameOf(node) === 'aps-checkRow').map((label) => ({
    text: textOf(label),
    checked: findNodes(label, (node) => node.type === 'input')[0]?.props.checked,
  }))
}

const sectionRows = (tree) => rowsIn(fieldFor(tree, '注入的提示词段'))
const contextRows = (tree) => rowsIn(fieldFor(tree, '注入的快照项'))
const checkedRows = (rows) => rows.filter((row) => row.checked === true).map((row) => row.text).sort()

console.log('# 未管理的清单保存后仍是未管理')
{
  const studio = mountStudio({ presets: [PRESET], meta: metaFor(SECTIONS_NOW, CONTEXTS_NOW) })
  const tree = await openEditor(studio)
  assert.equal(sectionRows(tree).length, 3, 'the section list renders')
  assert.equal(contextRows(tree).length, 2, 'the context list renders')
  await labels(tree, '保存')[0].props.onClick()
  const body = saves(studio)[0]
  assert.equal(body.sections, undefined, 'no section whitelist is materialised')
  assert.equal(body.contexts, undefined, 'no snapshot whitelist is materialised')
  // The other two lists are not whitelist-vs-unmanaged at all: an empty skill
  // list means "no skill" and tools `all` means "every tool", for a new and an
  // existing preset alike, so nothing is frozen here either.
  assert.deepEqual(body.tools, { mode: 'all', names: [] }, 'tools stay `all`, the catalog is not copied into names')
  assert.deepEqual(body.skills, [], 'skills stay empty, the catalog is not copied in')
}

console.log('# 目录增长后：已有未管理预设与新建预设勾选一致')
{
  // The stored preset is unchanged (still no `sections`/`contexts`), while the
  // catalog now carries a row that shipped after it was created.
  const studio = mountStudio({ presets: [PRESET], meta: metaFor(SECTIONS_LATER, CONTEXTS_LATER) })
  const existing = await openEditor(studio)
  const existingSections = checkedRows(sectionRows(existing))
  const existingContexts = checkedRows(contextRows(existing))
  assert(existingSections.some((text) => text.includes('later:section')), 'a later section opens checked on an unmanaged preset')
  assert(existingContexts.some((text) => text.includes('later:policy')), 'a later context opens checked on an unmanaged preset')

  const freshStudio = mountStudio({ presets: [PRESET], meta: metaFor(SECTIONS_LATER, CONTEXTS_LATER) })
  const fresh = await createEditor(freshStudio)
  assert.deepEqual(checkedRows(sectionRows(fresh)), existingSections, 'new and existing agree on the section set')
  assert.deepEqual(checkedRows(contextRows(fresh)), existingContexts, 'new and existing agree on the context set')
}

console.log('# 显式编辑才固化为严格白名单，白名单不再自动增长')
{
  const studio = mountStudio({ presets: [PRESET], meta: metaFor(SECTIONS_NOW, CONTEXTS_NOW) })
  let tree = await openEditor(studio)
  const harness = findNodes(fieldFor(tree, '注入的提示词段'), (node) => node.type === 'input' && node.props?.type === 'checkbox')
    .find((node) => {
      const label = findNodes(tree, (n) => n.type === 'label' && n.children?.includes?.(node))[0]
      return label !== undefined && textOf(label).includes('harness:identity')
    })
  await harness.props.onChange({ target: { checked: false } })
  tree = await studio.root.flush()
  await labels(tree, '保存')[0].props.onClick()
  const body = saves(studio)[0]
  assert.deepEqual(body.sections, ['third-party:notes'], 'a checked decision writes the strict keep list')
  assert.equal(body.contexts, undefined, 'the untouched snapshot list stays unmanaged')

  // Re-open what was just saved, under a GROWN catalog: the explicit keep list
  // is authoritative and does not pick up the later row.
  const stored = { ...PRESET, sections: body.sections }
  const reopened = mountStudio({ presets: [stored], meta: metaFor(SECTIONS_LATER, CONTEXTS_LATER) })
  const tree2 = await openEditor(reopened)
  const rows = sectionRows(tree2)
  assert.equal(rows.find((row) => row.text.includes('later:section'))?.checked, false, 'a strict keep list does not grow')
  assert.equal(rows.find((row) => row.text.includes('harness:identity'))?.checked, false, 'the unchecked decision persists')
  assert.equal(rows.find((row) => row.text.includes('third-party:notes'))?.checked, true, 'the kept row persists')
  assert.equal(rows.find((row) => row.text.includes('deployment:persona-prefix'))?.checked, true, 'required rows still inject')
}

console.log('OK — 未管理清单不再被物化，四类清单语义一致')
