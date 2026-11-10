/**
 * Regression: the export dialog's 「导出到本地」 writes the checked presets'
 * FULL info as a JSON array, and 「导入预设列表」 reads such a file, shows the
 * same picker, appends the checked presets to the end of the stored list,
 * renames names that already exist to `原名（导入 N）`, and alerts on a
 * malformed file.
 *
 * Run: node test/verify-import-export.mjs
 */
import { findNodes, classNameOf, textOf, mountStudio } from './_studio-harness.mjs'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined || detail === '' ? '' : `\n         ${detail}`}`)
}

const PRESETS = [
  {
    id: 'custom-1fc50261',
    name: '任务拆解大师',
    description: '拆解复杂任务。',
    instructions: '你是编排者。',
    instructionMode: 'complete',
    includeWorkspace: true,
    contexts: ['dsh-working-directory'],
    requiredSuppressed: [],
    sectionRulePrefixes: ['dsh-official-'],
    skills: ['pdf', 'univer'],
    tools: { mode: 'allow', names: ['bash', 'read'] },
    enabled: true,
    order: 0,
    status: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'custom-aaa111',
    name: '代码审查',
    description: '逐文件审查改动并给出结论。',
    instructions: '',
    instructionMode: 'append',
    skills: [],
    tools: { mode: 'all', names: [] },
    enabled: false,
    order: 1,
    status: {},
  },
]

// Dialog footer buttons are the shell's `Button` component, so the shim keeps
// the function as the node type; match by label + live handler instead.
const findByText = (tree, label) =>
  findNodes(tree, (n) => textOf(n) === label && typeof n.props?.onClick === 'function')[0]
const dialogOpen = (tree, title) =>
  findNodes(tree, (n) => textOf(n).includes(title)).length > 0
const fileInputIn = (tree) => findNodes(tree, (n) => n.type === 'input' && n.props?.type === 'file')[0]
const importRows = (tree) =>
  findNodes(tree, (n) => classNameOf(n) === 'aps-row' && n.props?.key !== undefined)

/** A fake File whose async text() returns the given payload. */
const fakeFile = (content) => ({ text: async () => content })

async function runExportDownload(studio, tree) {
  await findByText(tree, '导出预设列表').props.onClick()
  const open = await studio.root.flush()
  const button = findByText(open, '导出到本地')
  if (button === undefined) throw new Error('导出弹窗没有出现「导出到本地」按钮')
  await button.props.onClick()
  return await studio.root.flush()
}

async function pickImportFile(studio, tree, content) {
  const input = fileInputIn(tree)
  if (input === undefined) throw new Error('页面没有渲染文件选择框')
  const event = { target: { files: [fakeFile(content)], value: 'C:\\fakepath\\presets.json' } }
  await input.props.onChange(event)
  return { tree: await studio.root.flush(), event }
}

console.log('# 导出到本地：完整预设信息')
{
  const studio = mountStudio({ presets: PRESETS })
  let tree = await studio.root.settle()
  tree = await runExportDownload(studio, tree)

  check('点击后触发一次下载', studio.downloads.length === 1, JSON.stringify(studio.downloads))
  check('下载文件名是 JSON', String(studio.downloads[0]?.download ?? '').endsWith('.json'), String(studio.downloads[0]?.download ?? ''))
  const blob = studio.blobs[0]
  const text = blob === undefined ? '' : await blob.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = undefined
  }
  check('文件内容是 JSON 数组', Array.isArray(payload), text.slice(0, 80))
  check('默认导出全部预设', payload?.length === PRESETS.length, `len=${payload?.length}`)
  check(
    '包含提示词、技能、工具、上下文与开关状态',
    payload?.[0]?.instructions === '你是编排者。' &&
      payload?.[0]?.instructionMode === 'complete' &&
      JSON.stringify(payload?.[0]?.skills) === JSON.stringify(['pdf', 'univer']) &&
      payload?.[0]?.tools?.mode === 'allow' &&
      JSON.stringify(payload?.[0]?.contexts) === JSON.stringify(['dsh-working-directory']) &&
      payload?.[0]?.enabled === true &&
      payload?.[1]?.enabled === false,
    JSON.stringify(payload?.[0]),
  )
  check(
    '不写运行时身份与位置（id / order / status / 时间戳）',
    payload?.every(
      (row) =>
        !('id' in row) &&
        !('order' in row) &&
        !('status' in row) &&
        !('createdAt' in row) &&
        !('updatedAt' in row),
    ),
    JSON.stringify(payload?.[0]),
  )
  check('提示已导出到本地', findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf).some((t) => t.includes('已导出 2 个预设')))
}

console.log('# 导入：文件选择 → 同名自动重命名 → 追加到末尾')
{
  const studio = mountStudio({ presets: PRESETS })
  let tree = await studio.root.settle()
  const imported = [
    {
      name: '导入一',
      description: '来自文件。',
      instructions: '导入的提示词。',
      instructionMode: 'complete',
      skills: ['pdf'],
      tools: { mode: 'allow', names: ['bash'] },
      contexts: [],
      enabled: false,
    },
    { name: '代码审查', description: '同名，应重命名。' },
    { name: '导入二', description: '' },
    { name: '导入一', description: '文件内重复，应合并。' },
    { name: '', description: '没有名称，应忽略。' },
  ]
  const picked = await pickImportFile(studio, tree, JSON.stringify(imported))
  tree = picked.tree
  check('选择文件后打开导入弹窗', dialogOpen(tree, '选择要导入的预设'))
  check('文件内同名条目全部保留，无名称条目被忽略', importRows(tree).length === 4, `rows=${importRows(tree).length}`)
  check(
    '待导入行按文件顺序排列',
    importRows(tree).map((row) => findNodes(row, (n) => classNameOf(n) === 'aps-rowName').map(textOf)[0]).join(' / ') ===
      '导入一 / 代码审查 / 导入二 / 导入一',
    importRows(tree).map((row) => findNodes(row, (n) => classNameOf(n) === 'aps-rowName').map(textOf)[0]).join(' / '),
  )
  check('文件输入值已清空以便再次选择同一文件', picked.event.target.value === '', String(picked.event.target.value))

  const confirm = findByText(tree, '确认导入')
  check('出现「确认导入」按钮', confirm !== undefined)
  await confirm.props.onClick()
  tree = await studio.root.flush()

  const saves = studio.calls.filter((call) => call.endpoint === 'save')
  check('全部选中的四条都会保存', saves.length === 4, saves.map((call) => call.body.name).join(' / '))
  check(
    '同名条目自动重命名为「原名（导入 N）」',
    saves.map((call) => call.body.name).join(' / ') ===
      '导入一 / 代码审查（导入 1） / 导入二 / 导入一（导入 1）',
    saves.map((call) => call.body.name).join(' / '),
  )
  check('导入条目重新分配 id', saves.every((call) => call.body.id === ''), JSON.stringify(saves.map((call) => call.body.id)))
  check(
    '追加到列表末尾（order 接在现有最大值之后）',
    saves.map((call) => call.body.order).join(',') === '2,3,4,5',
    JSON.stringify(saves.map((call) => call.body.order)),
  )
  check(
    '完整导入提示词、技能、工具、上下文与开关',
    saves[0]?.body.instructions === '导入的提示词。' &&
      saves[0]?.body.instructionMode === 'complete' &&
      JSON.stringify(saves[0]?.body.skills) === JSON.stringify(['pdf']) &&
      saves[0]?.body.tools?.mode === 'allow' &&
      JSON.stringify(saves[0]?.body.contexts) === JSON.stringify([]) &&
      saves[0]?.body.enabled === false,
    JSON.stringify(saves[0]?.body),
  )
  check(
    '提示导入与自动重命名数量',
    findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf).some((t) => t.includes('已导入 4 个预设，其中 2 个同名预设已自动重命名')),
    findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf).join(' / '),
  )
  check('导入完成后弹窗关闭', dialogOpen(tree, '选择要导入的预设') === false)
}

console.log('# 导入：无同名时保持原名')
{
  const studio = mountStudio({ presets: [] })
  let tree = await studio.root.settle()
  tree = (await pickImportFile(studio, tree, JSON.stringify([{ name: '独立预设', description: '' }]))).tree
  await findByText(tree, '确认导入').props.onClick()
  tree = await studio.root.flush()
  const saves = studio.calls.filter((call) => call.endpoint === 'save')
  check('无冲突时名称不变', saves[0]?.body.name === '独立预设', JSON.stringify(saves.map((call) => call.body.name)))
  check(
    '无冲突提示不出现重命名字样',
    findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf).some((t) => t === '已导入 1 个预设。'),
    findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf).join(' / '),
  )
}

console.log('# 导入：重命名会避开已存在的后缀名')
{
  const studio = mountStudio({
    presets: [
      { ...PRESETS[1], id: 'custom-base', name: '导入一', order: 0 },
      { ...PRESETS[1], id: 'custom-suffix', name: '导入一（导入 1）', order: 1 },
    ],
  })
  let tree = await studio.root.settle()
  tree = (await pickImportFile(studio, tree, JSON.stringify([{ name: '导入一' }]))).tree
  await findByText(tree, '确认导入').props.onClick()
  tree = await studio.root.flush()
  const saves = studio.calls.filter((call) => call.endpoint === 'save')
  check('已占用「（导入 1）」时改用「（导入 2）」', saves[0]?.body.name === '导入一（导入 2）', JSON.stringify(saves.map((call) => call.body.name)))
}

console.log('# 导入：格式错误时 alert')
{
  const studio = mountStudio({ presets: PRESETS })
  let tree = await studio.root.settle()
  const alerts = []
  globalThis.window.alert = (message) => alerts.push(String(message))
  await pickImportFile(studio, tree, '这不是 JSON')
  check('非法 JSON 触发 alert', alerts.length === 1, JSON.stringify(alerts))
  check('alert 说明文件格式不正确', alerts[0]?.includes('文件格式不正确'), alerts[0])
  check('格式错误时不打开导入弹窗', dialogOpen(tree, '选择要导入的预设') === false)

  await pickImportFile(studio, tree, '[1, 2, 3]')
  check('没有可用预设的数组同样 alert', alerts.length === 2, JSON.stringify(alerts))
  check('没有可用预设时不写入 Host', studio.calls.filter((call) => call.endpoint === 'save').length === 0)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
