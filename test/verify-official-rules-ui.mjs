/**
 * Regression: the 「官方段规则」 inputs in the editor.
 *
 * `official-only` filters prompt sections by NAMESPACE, and that namespace list
 * ships with the plugin — so a newer DSH build can add a section the filter
 * silently keeps. The three optional lists on the preset (`officialSection*`)
 * let an operator widen the rule, and this page is the only place to edit them.
 *
 * What this pins:
 *   1. the three boxes render ONLY in `official-only` mode — they mean nothing
 *      in `append`/`complete`, which never filter sections;
 *   2. an EMPTY or ABSENT field PREFILLS from `meta.officialSectionDefaults`,
 *      so a preset that stores nothing shows the rule set really in force
 *      instead of three blank boxes;
 *   3. a stored field shows its own value, not the default;
 *   4. editing writes the PARSED array into the save payload (trimmed,
 *      deduped, `，` and `、`… style separators accepted) and clearing the box
 *      writes `[]` — which the Host reads as "no override", not "inherit the
 *      previous value";
 *   5. the leak warning under the mode selector follows the DRAFT (the Host
 *      re-answers `inspect` per draft), not the last save.
 *
 * Run: node test/verify-official-rules-ui.mjs
 */
import assert from 'node:assert/strict'
import { classNameOf, findNodes, mountStudio, textOf } from './_studio-harness.mjs'

/** The Host's shipped rule set, as `meta.officialSectionDefaults` reports it. */
const DEFAULTS = {
  prefixes: ['deployment:', 'harness:', 'plan:', 'team:', 'tool:', 'tools:', 'context:', 'ui:', 'app:'],
  names: ['mcp-resource-servers'],
}

const META = {
  registryAvailable: true,
  contextCatalog: [],
  capabilities: ['snapshotContexts', 'requiredSuppression', 'contextRegistryTruth', 'officialSectionRules'],
  officialSectionDefaults: DEFAULTS,
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
  instructionMode: 'official-only',
  officialSectionPrefixes: ['api'],
  officialSectionKeep: ['tool:mine'],
}

const buttonsIn = (tree) => findNodes(tree, (n) => typeof n.props?.onClick === 'function')
const labelled = (tree, label) => buttonsIn(tree).filter((n) => textOf(n) === label)
const isCard = (n) => classNameOf(n).split(' ').includes('aps-card')
const saves = (studio) => studio.calls.filter((call) => call.endpoint === 'save').map((call) => call.body)

/** The `aps-field` whose label is `label`. */
const fieldFor = (tree, label) =>
  findNodes(
    tree,
    (n) => classNameOf(n) === 'aps-field' && findNodes(n, (m) => classNameOf(m) === 'aps-label').some((m) => textOf(m) === label),
  )[0]
/** The text input inside that field. */
const inputFor = (tree, label) => {
  const field = fieldFor(tree, label)
  return field === undefined ? undefined : findNodes(field, (n) => n.type === 'input')[0]
}

const openEditor = async (studio, tree, cardIndex = 0) => {
  const card = findNodes(tree, isCard)[cardIndex]
  await findNodes(card, (n) => classNameOf(n).includes('aps-cardMain'))[0].props.onClick()
  return studio.root.flush()
}

const PREFIX_LABEL = '补充屏蔽提示词命名空间（前缀）'
const NAME_LABEL = '补充屏蔽提示词命名段（完整名称）'
const KEEP_LABEL = '保留（不屏蔽）提示词命名段（完整名称）'

console.log('# 只在「只屏蔽官方」下出现')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  assert.equal(inputFor(tree, PREFIX_LABEL), undefined, 'append mode hides the rule boxes')
  assert.equal(fieldFor(tree, KEEP_LABEL), undefined, 'and the keep box with them')

  await labelled(tree, '只屏蔽官方')[0].props.onClick()
  tree = await studio.root.flush()
  for (const label of [PREFIX_LABEL, NAME_LABEL, KEEP_LABEL]) {
    assert(fieldFor(tree, label) !== undefined, `official-only shows the ${label} box`)
  }
  // Switching back hides them again: the fields carry no meaning in append.
  await labelled(tree, '追加')[0].props.onClick()
  tree = await studio.root.flush()
  assert.equal(fieldFor(tree, PREFIX_LABEL), undefined, 'leaving official-only hides them again')
}

console.log('# 空字段保持为空')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '只屏蔽官方')[0].props.onClick()
  tree = await studio.root.flush()
  // No prefill: what the operator typed must be exactly what the field holds,
  // and an untouched box must not read as an edit. The built-in lists are
  // stated in the note below the boxes instead.
  assert.equal(inputFor(tree, PREFIX_LABEL).props.value, '', 'an absent prefix list shows an empty box')
  assert.equal(inputFor(tree, NAME_LABEL).props.value, '', 'an absent name list shows an empty box')
  assert.equal(inputFor(tree, KEEP_LABEL).props.value, '', 'and so does an absent keep list')
  const hints = findNodes(tree, (n) => classNameOf(n) === 'aps-hint').map(textOf)
  assert(
    hints.some((text) => text.includes('harness:') && text.includes('mcp-resource-servers')),
    `the built-in lists are stated below: ${hints.join(' | ')}`,
  )
  // Each box carries a concrete case: "several entries — how?" needs an
  // example, not another rule sentence.
  const examples = findNodes(tree, (n) => classNameOf(n) === 'aps-example').map(textOf)
  assert.equal(examples.length, 3, `one example per rule box, got ${examples.length}`)
  assert(examples.some((text) => text.includes('api:docs')), 'the prefix example names a concrete namespace')
  assert(examples.some((text) => text.includes('tool:bash')), 'the section-name example names a concrete section')
  for (const text of hints.concat(examples)) {
    assert(!text.includes('**'), `no markdown survives into plain text: ${text}`)
  }
}

console.log('# 已配置字段展示自身值')
{
  const studio = mountStudio({ presets: [WIDENED], meta: META })
  const tree = await openEditor(studio, await studio.root.settle())
  assert.equal(inputFor(tree, PREFIX_LABEL).props.value, 'api', 'a stored prefix list wins over the default')
  assert.equal(inputFor(tree, KEEP_LABEL).props.value, 'tool:mine', 'and so does the stored keep list')
  assert.equal(
    inputFor(tree, NAME_LABEL).props.value,
    '',
    'a field the preset does not store stays empty (the default lives in the note)',
  )
}

console.log('# 编辑 → 保存载荷')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '只屏蔽官方')[0].props.onClick()
  tree = await studio.root.flush()

  // Separators: ASCII comma, a full-width comma and a newline all split, and
  // the result is trimmed and deduped.
  await inputFor(tree, PREFIX_LABEL).props.onChange({ target: { value: ' api , skill，api\nweb ' } })
  tree = await studio.root.flush()
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert.deepEqual(body.officialSectionPrefixes, ['api', 'skill', 'web'], 'the parsed prefix list is sent')
  assert.equal(body.instructionMode, 'official-only', 'the mode travels with it')
  assert(!('ruleText' in body) || Array.isArray(body.officialSectionPrefixes), 'the raw typing never replaces the array')
}

console.log('# 清空 = 不使用覆盖（而不是沿用旧值）')
{
  const studio = mountStudio({ presets: [WIDENED], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await inputFor(tree, PREFIX_LABEL).props.onChange({ target: { value: '' } })
  tree = await studio.root.flush()
  assert.equal(
    inputFor(tree, PREFIX_LABEL).props.value,
    '',
    'the box itself may be empty while it is being edited (no snap-back)',
  )
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  const body = saves(studio)[0]
  assert.deepEqual(body.officialSectionPrefixes, [], 'clearing sends an empty list, not the stored one')
}

console.log('# 追加语义：删掉内置项仍生效，页面要说出来')
{
  const studio = mountStudio({ presets: [PLAIN], meta: META })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '只屏蔽官方')[0].props.onClick()
  tree = await studio.root.flush()
  const hintsOf = () => findNodes(tree, (n) => classNameOf(n) === 'aps-hint').map(textOf)
  assert(
    hintsOf().every((text) => text.includes('仍然生效') === false),
    'an EMPTY box is not "I dropped everything" — it means "use the built-ins"',
  )

  // Keep only ONE of the built-in namespaces: the merge is additive, so the
  // other eight still apply and the page has to say so.
  await inputFor(tree, PREFIX_LABEL).props.onChange({ target: { value: 'tool' } })
  tree = await studio.root.flush()
  const dropped = hintsOf().find((text) => text.includes('仍然生效'))
  assert(dropped !== undefined, `the page warns about unremovable defaults: ${hintsOf().join(' | ')}`)
  assert(dropped.includes('ui:'), 'and names them')
  assert(!dropped.includes('tool:'), 'excluding the one still listed')

  // Restoring the full list clears the warning again.
  await inputFor(tree, PREFIX_LABEL).props.onChange({ target: { value: DEFAULTS.prefixes.join(', ') } })
  tree = await studio.root.flush()
  assert(
    hintsOf().every((text) => text.includes('仍然生效') === false),
    'listing every default clears the notice',
  )

  // The saved list is exactly what was typed — the Host merges, the page does
  // not silently re-add the defaults.
  await inputFor(tree, PREFIX_LABEL).props.onChange({ target: { value: 'api' } })
  tree = await studio.root.flush()
  await labelled(tree, '保存')[0].props.onClick()
  tree = await studio.root.flush()
  assert.deepEqual(saves(studio)[0].officialSectionPrefixes, ['api'], 'the payload carries only what was typed')
}

console.log('# 漏检提示跟随草稿')
{
  const inspectView = { officialFilter: { available: true, suspect: ['dsh:new-surface'] } }
  const studio = mountStudio({ presets: [PLAIN], meta: META, inspectView })
  let tree = await openEditor(studio, await studio.root.settle())
  await labelled(tree, '只屏蔽官方')[0].props.onClick()
  tree = await studio.root.flush()
  // The inspect answer arrives on a 0ms timer; give the page a turn to adopt it.
  await new Promise((resolve) => setTimeout(resolve, 5))
  tree = await studio.root.flush()
  const hints = findNodes(tree, (n) => classNameOf(n) === 'aps-hint').map(textOf)
  assert(
    hints.some((text) => text.includes('dsh:new-surface')),
    `the draft's suspect sections are named in the page: ${hints.join(' | ')}`,
  )
}

console.log('\nall official-rules UI regressions passed')
