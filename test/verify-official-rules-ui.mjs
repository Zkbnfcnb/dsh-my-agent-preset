/**
 * Regression: the 「段规则」 chip fields in the editor.
 *
 * `custom-official` filters prompt sections by NAMESPACE, and that namespace list
 * ships with the plugin — so a newer DSH build can add a section the filter
 * silently keeps. The three optional lists on the preset (`sectionRule*`)
 * let an operator widen the rule, and this page is the only place to edit them.
 *
 * What this pins:
 *   1. the three chip fields render ONLY in `custom-official` mode — they mean
 *      nothing in `append`/`complete`, which never filter sections;
 *   2. an EMPTY or ABSENT field renders NO chips: what the operator typed is
 *      exactly what the field holds, and the built-in lists are stated in the
 *      note below the fields instead of being pre-filled;
 *   3. a stored field renders its own chips, not the default;
 *   4. typing a separator (ASCII/full-width comma, `、`, newline) commits the
 *      finished entries at once — trimmed, deduped, and with `api`/`api:`
 *      treated as the same namespace; the half-typed tail stays in the box
 *      until Enter or blur commits it;
 *   5. × and Backspace remove chips; removing every chip writes `[]`, which
 *      the Host reads as "no override", not "inherit the previous value";
 *   6. `inspect` is asked against the DRAFT chips, so the leak warning follows
 *      every add/remove instead of the last save.
 *
 * Run: node test/verify-official-rules-ui.mjs
 */
import assert from 'node:assert/strict'
import { classNameOf, findNodes, mountStudio, textOf } from './_studio-harness.mjs'

/** The Host's shipped rule set, as `meta.sectionRuleDefaults` reports it. */
const DEFAULTS = {
  prefixes: ['deployment:', 'harness:', 'plan:', 'team:', 'tool:', 'tools:', 'context:', 'ui:', 'app:'],
  names: ['mcp-resource-servers'],
}

const META = {
  registryAvailable: true,
  contextCatalog: [],
  capabilities: ['snapshotContexts', 'requiredSuppression', 'contextRegistryTruth', 'sectionRules'],
  sectionRuleDefaults: DEFAULTS,
}

/** A preset stored before the rule fields existed. */
const PLAIN = {
  id: 'custom-rule01',
  name: '规则',
  description: '',
  instructions: '你是助手。',
  instructionMode: 'append',
  includeWorkspace: true,
  skills: [],
  tools: { mode: 'all', names: [] },
  enabled: true,
  order: 0,
  status: {},
}

/** The same preset, already carrying an override. */
const WIDENED = {
  ...PLAIN,
  id: 'custom-rule02',
  name: '规则2',
  instructionMode: 'custom-official',
  sectionRulePrefixes: ['api'],
  sectionRuleKeep: ['tool:mine'],
}

/** An inspect answer that classifies live sections on both sides. */
const SECTION_VIEW = {
  available: true,
  sectionFilter: {
    available: true,
    sections: 5,
    blocked: 2,
    kept: 3,
    blockedList: ['deployment:persona-prefix', 'harness:identity'],
    keptList: ['mcp:github', 'vendor:thing', 'tool:bash'],
    rules: { prefixes: 10, names: 2, keep: 1 },
  },
}

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

/** The chip input inside that field. */
const inputFor = (tree, label) => {
  const field = fieldFor(tree, label)
  return field === undefined
    ? undefined
    : findNodes(field, (n) => n.type === 'input' && classNameOf(n) === 'aps-tagInput')[0]
}

/** The chip labels inside that field, in order. */
const chipsOf = (tree, label) => {
  const field = fieldFor(tree, label)
  return field === undefined
    ? []
    : findNodes(field, (n) => classNameOf(n) === 'aps-tagText').map(textOf)
}

/** The `×` buttons inside that field. */
const removeButtonsFor = (tree, label) => {
  const field = fieldFor(tree, label)
  return field === undefined ? [] : findNodes(field, (n) => classNameOf(n) === 'aps-tagRemove')
}

const openEditor = async (studio, tree, cardIndex = 0) => {
  const card = findNodes(tree, isCard)[cardIndex]
  await findNodes(card, (n) => classNameOf(n).includes('aps-cardMain'))[0].props.onClick()
  return studio.root.flush()
}

/** Type into a chip box; separators commit at once, a plain tail stays. */
const type = async (studio, tree, label, value) => {
  inputFor(tree, label).props.onChange({ target: { value } })
  return studio.root.flush()
}

/** Send one key to a chip box. */
const press = async (studio, tree, label, key) => {
  inputFor(tree, label).props.onKeyDown({ key, preventDefault() {} })
  return studio.root.flush()
}

/** Wait out the editor's debounce, then settle the async inspect answer. */
const settleInspect = async (studio) => {
  await new Promise((resolve) => setTimeout(resolve, 380))
  return studio.root.flush()
}

const hintsOf = (tree) => findNodes(tree, (n) => classNameOf(n) === 'aps-hint').map(textOf)
/** All rendered text inside the runtime-view panel. */
const inspectTextOf = (tree) => {
  const panel = findNodes(tree, (n) => classNameOf(n) === 'aps-inspect')[0]
  return panel === undefined ? '' : textOf(panel)
}

const PREFIX_LABEL = '补充屏蔽提示词前缀'
const NAME_LABEL = '补充屏蔽提示词段名（完整名称）'
const KEEP_LABEL = '保留（不屏蔽）提示词段名（完整名称）'

console.log('# 只在「自定义屏蔽（默认官方）」下出现')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  assert.equal(fieldFor(tree, PREFIX_LABEL), undefined, 'append mode hides the rule fields')
  assert.equal(fieldFor(tree, KEEP_LABEL), undefined, 'and the keep field with them')

  await labelled(tree, '自定义屏蔽（默认官方）')[0].props.onClick()
  tree = await studio.root.flush()
  for (const label of [PREFIX_LABEL, NAME_LABEL, KEEP_LABEL]) {
    assert(fieldFor(tree, label) !== undefined, `custom-official shows the ${label} field`)
  }
  // Switching back hides them again: the fields carry no meaning in append.
  await labelled(tree, '追加')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(fieldFor(tree, PREFIX_LABEL), undefined, 'leaving custom-official hides them again')
}

console.log('# 空字段 = 无标签 + 占位提示')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义屏蔽（默认官方）')[0].props.onClick()
  tree = await studio.root.flush()
  // No prefill: an untouched field must not read as an edit, and the built-in
  // lists are stated in the note below the fields instead.
  for (const label of [PREFIX_LABEL, NAME_LABEL, KEEP_LABEL]) {
    assert.deepEqual(chipsOf(tree, label), [], `${label} starts with no chips`)
    assert.equal(inputFor(tree, label).props.value, '', `${label} has an empty input`)
  }
  assert(inputFor(tree, PREFIX_LABEL).props.placeholder.includes('api'), 'the prefix box shows a concrete hint')
  assert(inputFor(tree, NAME_LABEL).props.placeholder.includes('tool:bash'), 'the name box shows a concrete hint')
  const hints = hintsOf(tree)
  assert(
    hints.some((text) => text.includes('harness:') && text.includes('mcp-resource-servers')),
    `the built-in lists are stated below: ${hints.join(' | ')}`,
  )
  // The concrete case moved into the hint for the prefix field (the chip
  // interaction is the example now), while the two exact-name fields keep one.
  assert(hints.some((text) => text.includes('api:docs')), 'the prefix hint names a concrete section')
  const examples = findNodes(tree, (n) => classNameOf(n) === 'aps-example').map(textOf)
  assert.equal(examples.length, 3, `one example per rule field, got ${examples.length}`)
  assert(examples.some((text) => text.includes('tool:bash')), 'the section-name example names a concrete section')
  for (const text of hints.concat(examples)) {
    assert(!text.includes('**'), `no markdown survives into plain text: ${text}`)
  }
}

console.log('# 已配置字段展示自身标签')
{
  const studio = mountStudio({ presets: [WIDENED], meta: META })
  const tree = await openEditor(studio, await studio.root.settle())
  assert.deepEqual(chipsOf(tree, PREFIX_LABEL), ['api'], 'a stored prefix list wins over the default')
  assert.deepEqual(chipsOf(tree, KEEP_LABEL), ['tool:mine'], 'and so does the stored keep list')
  assert.deepEqual(chipsOf(tree, NAME_LABEL), [], 'a field the preset does not store stays empty')
  assert.equal(
    removeButtonsFor(tree, PREFIX_LABEL)[0].props['aria-label'],
    '删除 api',
    'the remove button names the chip it removes',
  )
}

console.log('# 分隔符即时提交、去重与尾部保留')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义屏蔽（默认官方）')[0].props.onClick()
  tree = await studio.root.flush()

  // ASCII comma, a full-width comma, a newline and `、` all split; entries are
  // trimmed and deduped (`api` appears twice).
  tree = await type(studio, tree, PREFIX_LABEL, ' api , skill，api\nweb,')
  assert.deepEqual(chipsOf(tree, PREFIX_LABEL), ['api', 'skill', 'web'], 'finished entries commit at once')
  // Prefixes are compared VERBATIM (plain string prefixes), so `api` and
  // `api:` are different entries: the latter only matches names that already
  // carry the colon.
  tree = await type(studio, tree, PREFIX_LABEL, 'api:,')
  assert.deepEqual(
    chipsOf(tree, PREFIX_LABEL),
    ['api', 'skill', 'web', 'api:'],
    'prefixes are compared verbatim, not namespace-normalised',
  )
  tree = await type(studio, tree, PREFIX_LABEL, 'one、two,')
  assert.deepEqual(
    chipsOf(tree, PREFIX_LABEL),
    ['api', 'skill', 'web', 'api:', 'one', 'two'],
    '`、` also splits',
  )

  // A tail without a separator is still being typed: no chip, text kept.
  tree = await type(studio, tree, PREFIX_LABEL, 'other')
  assert.deepEqual(
    chipsOf(tree, PREFIX_LABEL),
    ['api', 'skill', 'web', 'api:', 'one', 'two'],
    'the tail waits for a commit',
  )
  assert.equal(inputFor(tree, PREFIX_LABEL).props.value, 'other', 'and stays in the box')
  assert.equal(inputFor(tree, NAME_LABEL).props.value, '', 'each chip field keeps its own input text')
  tree = await press(studio, tree, PREFIX_LABEL, 'Enter')
  assert.deepEqual(
    chipsOf(tree, PREFIX_LABEL),
    ['api', 'skill', 'web', 'api:', 'one', 'two', 'other'],
    'Enter commits the tail',
  )
  assert.equal(inputFor(tree, PREFIX_LABEL).props.value, '', 'and clears the box')

  // IME composition is not split on the punctuation it produces: the raw text
  // waits until composition ends.
  const composingInput = inputFor(tree, PREFIX_LABEL)
  composingInput.props.onCompositionStart()
  composingInput.props.onChange({ target: { value: 'pin,' } })
  tree = await studio.root.flush()
  assert.deepEqual(chipsOf(tree, PREFIX_LABEL).includes('pin'), false, 'a composing value is not committed')
  assert.equal(inputFor(tree, PREFIX_LABEL).props.value, 'pin,', 'and stays whole in the box')
  inputFor(tree, PREFIX_LABEL).props.onCompositionEnd({ target: { value: 'pin,' } })
  tree = await studio.root.flush()
  assert.deepEqual(chipsOf(tree, PREFIX_LABEL).at(-1), 'pin', 'composition end commits the entry')

  // Pasting a separated list commits every item, including the last one.
  inputFor(tree, PREFIX_LABEL).props.onPaste({
    clipboardData: { getData: () => 'p,q,' },
    preventDefault() {},
  })
  tree = await studio.root.flush()
  assert.deepEqual(chipsOf(tree, PREFIX_LABEL).slice(-2), ['p', 'q'], 'a pasted list becomes chips')

  // A full section name in the PREFIX field stays verbatim: plain prefix
  // matching makes `dsh-context:prompt-prefix` a valid prefix for exactly that
  // section (and anything extending it).
  tree = await type(studio, tree, PREFIX_LABEL, 'dsh-context:prompt-prefix,')
  assert.deepEqual(
    chipsOf(tree, PREFIX_LABEL).at(-1),
    'dsh-context:prompt-prefix',
    'a multi-segment prefix is kept verbatim',
  )
}

console.log('# 删除标签 → 保存载荷')
{
  const studio = mountStudio({ presets: [WIDENED], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  // `×` removes the chip it belongs to.
  removeButtonsFor(tree, KEEP_LABEL)[0].props.onClick({})
  tree = await studio.root.flush()
  assert.deepEqual(chipsOf(tree, KEEP_LABEL), [], '× removes the chip')
  // Backspace on an empty box removes the last chip.
  tree = await press(studio, tree, PREFIX_LABEL, 'Backspace')
  assert.deepEqual(chipsOf(tree, PREFIX_LABEL), [], 'Backspace removes the last chip')

  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert.deepEqual(body.sectionRulePrefixes, [], 'an emptied field is sent as [] (no override)')
  assert.deepEqual(body.sectionRuleKeep, [], 'and so is an emptied keep field')
  assert(!('ruleText' in body), 'the raw typing never leaks into the payload')
}

console.log('# 保存载荷 = 标签数组')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义屏蔽（默认官方）')[0].props.onClick()
  tree = await studio.root.flush()
  tree = await type(studio, tree, PREFIX_LABEL, ' api , skill，api\nweb,')
  tree = await type(studio, tree, NAME_LABEL, 'tool:bash,mcp-resource-servers,')
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert.deepEqual(body.sectionRulePrefixes, ['api', 'skill', 'web'], 'the parsed prefix chips are sent')
  assert.deepEqual(body.sectionRuleNames, ['tool:bash', 'mcp-resource-servers'], 'and the parsed name chips')
  assert.equal(body.instructionMode, 'custom-official', 'the mode travels with it')
}

console.log('# 内置规则仍生效的提示只在该栏有内容时出现')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义屏蔽（默认官方）')[0].props.onClick()
  tree = await studio.root.flush()
  assert(!hintsOf(tree).some((text) => text.includes('不会替换内置规则')), 'an empty field does not warn about dropped defaults')

  tree = await type(studio, tree, PREFIX_LABEL, 'tool,')
  assert(
    hintsOf(tree).some((text) => text.includes('不会替换内置规则') && text.includes('harness:')),
    'adding an entry states that the built-in namespaces still apply',
  )
  // Adding every built-in prefix silences the note: nothing is missing.
  tree = await type(studio, tree, PREFIX_LABEL, `${DEFAULTS.prefixes.join(',')},`)
  assert(!hintsOf(tree).some((text) => text.includes('不会替换内置规则')), 'a complete override list clears the note')
}

console.log('# 运行时自检跟随草稿标签')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '自定义屏蔽（默认官方）')[0].props.onClick()
  tree = await settleInspect(studio)
  // The runtime-view panel carries the rule partition: the merged counts
  // (built-ins + draft chips), the official/third-party split and both lists.
  const panelText = inspectTextOf(tree)
  assert(
    panelText.includes('段规则：10 个前缀 · 2 个精确段名 · 1 个保留规则'),
    `the panel states the effective rule counts: ${panelText}`,
  )
  assert(panelText.includes('屏蔽段 2 个'), 'blocked sections are counted')
  assert(panelText.includes('保留段 3 个'), 'kept sections are counted')
  assert(panelText.includes('段规则按上方三栏的当前标签计算'), 'the panel says the rules follow the draft chips')
  // The counts are backed by the same scrollable lists as tools and contexts.
  assert(panelText.includes('屏蔽段（2）'), 'the blocked sections have a list')
  assert(panelText.includes('deployment:persona-prefix'), 'with the concrete blocked names')
  assert(panelText.includes('保留段（3）'), 'the kept sections have a list')
  assert(panelText.includes('mcp:github'), 'with the concrete third-party names')
  assert(panelText.includes('tool:bash'), 'with the concrete kept names')

  const before = inspects(studio).length
  tree = await type(studio, tree, PREFIX_LABEL, 'api,')
  tree = await settleInspect(studio)
  const calls = inspects(studio)
  assert(calls.length > before, 'a chip edit triggers a fresh inspect')
  const last = calls[calls.length - 1]
  assert.deepEqual(last.config.sectionRulePrefixes, ['api'], 'inspect runs against the draft prefix chips')
  assert.deepEqual(last.config.sectionRuleNames, [], 'and the draft name chips')
  assert.deepEqual(last.config.sectionRuleKeep, [], 'and the draft keep chips')

  // The same draft list reaches the save payload, so the self-check and the
  // write cannot disagree.
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(saves(studio)[0].sectionRulePrefixes, ['api'], 'the inspected draft is what gets saved')
}

console.log('# 自检面板的段规则分区只在「自定义屏蔽（默认官方）」下出现')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView: SECTION_VIEW })
  let tree = await openEditor(studio, await studio.root.settle())
  tree = await settleInspect(studio)
  assert.equal(findNodes(tree, (n) => classNameOf(n) === 'aps-inspect').length, 1, 'the runtime panel is rendered')
  assert(!inspectTextOf(tree).includes('段规则'), 'append mode does not show the section-rule block')
}

console.log('# 无法读取 section 列表时，自检仍展示规则计数')
{
  const view = {
    available: true,
    sectionFilter: { available: false, rules: { prefixes: 9, names: 1, keep: 0 } },
  }
  const studio = mountStudio({ presets: [WIDENED], meta: META, inspectView: view })
  let tree = await openEditor(studio, await studio.root.settle())
  tree = await settleInspect(studio)
  const text = inspectTextOf(tree)
  assert(text.includes('段规则：9 个前缀'), 'rule counts still render')
  assert(!text.includes('屏蔽段 0 个'), 'no blocked/kept partition is invented')
  assert(text.includes('未能读取运行时 section 列表'), 'and the reason is stated')
}
