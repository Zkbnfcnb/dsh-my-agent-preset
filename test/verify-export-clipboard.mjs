/**
 * Regression: the preset list header must offer 「+ 新建预设模式」,
 * 「导出预设列表」 and 「导入预设列表」 in one action row under the intro, and
 * the export dialog must copy the roster's BASIC info as a JSON array of
 * `{ id, name, description }` — in list order, enabled or not, and nothing
 * beyond those three fields — plus offer a full-info local JSON download.
 *
 * The page machinery (browser stubs, the React shim, the dialog stub, the
 * recorded Host API) lives in `_studio-harness.mjs` and is shared with the
 * copy/snapshot UI regression. Export is not a one-click clipboard write: the
 * click opens a selection dialog whose rows are all checked by default, and
 * the copy happens on the 「复制基础信息」 footer button — `runExport`
 * drives both steps.
 *
 * Run: node test/verify-export-clipboard.mjs
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

/** Presets carrying every field the card renders, incl. one with no description. */
const PRESETS = [
  {
    id: 'custom-1fc50261',
    name: '任务拆解大师｜多会话编排',
    description: '使用 session_bridge 系列工具创建、发送、等待、监控、恢复、归档多个子会话，将复杂任务拆解为多会话协作并汇总结果。',
    instructions: '你是编排者。\n第二行不该出现在导出里。',
    instructionMode: 'complete',
    includeWorkspace: true,
    skills: ['pdf', 'univer'],
    tools: { mode: 'allow', names: ['bash', 'read'] },
    enabled: true,
    order: 0,
    status: {},
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
  {
    id: 'custom-bbb222',
    name: '无描述',
    description: '',
    instructions: '',
    instructionMode: 'append',
    skills: [],
    tools: { mode: 'deny', names: [] },
    enabled: true,
    order: 2,
    status: {},
  },
]

/** The roster shape the export must produce. */
const EXPECTED = PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description }))

/** The 「导出预设列表」 button in a rendered tree. */
const exportButtonIn = (tree) =>
  findNodes(tree, (n) => n.type === 'button' && textOf(n) === '导出预设列表')[0]

/**
 * The dialog's 「复制基础信息」 button, matched by label plus a live `onClick`
 * rather than by `type === 'button'`: a component's rendered type is the
 * component function under this shim.
 * @param tree - a rendered tree.
 * @returns the button node, or undefined when the dialog is not open.
 */
const copyButtonIn = (tree) =>
  findNodes(tree, (n) => textOf(n) === '复制基础信息' && typeof n.props?.onClick === 'function')[0]

/** The dialog's 「导出到本地」 button. */
const downloadButtonIn = (tree) =>
  findNodes(tree, (n) => textOf(n) === '导出到本地' && typeof n.props?.onClick === 'function')[0]

/**
 * Drive the whole export: open the dialog, then press its copy button.
 * @param root - the studio root.
 * @param tree - the rendered list page.
 * @returns the tree after the copy resolved.
 */
async function runExport(root, tree) {
  await exportButtonIn(tree).props.onClick()
  const open = await root.flush()
  const button = copyButtonIn(open)
  if (button === undefined) throw new Error('导出弹窗没有出现「复制基础信息」按钮')
  await button.props.onClick()
  return root.flush()
}

console.log('# 列表页头部：导出按钮')
const studio = mountStudio({ presets: PRESETS })
let tree = await studio.root.settle()

const labels = () => findNodes(tree, (n) => n.type === 'button').map(textOf)
const exportButton = () => exportButtonIn(tree)

check('出现「导出预设列表」按钮', labels().includes('导出预设列表'), `按钮: ${labels().join(' / ')}`)
check('「+ 新建预设模式」仍然保留', labels().includes('+ 新建预设模式'), `按钮: ${labels().join(' / ')}`)
check('出现「导入预设列表」按钮', labels().includes('导入预设列表'), `按钮: ${labels().join(' / ')}`)
check(
  '三个按钮的排列为新建、导出、导入',
  labels().indexOf('+ 新建预设模式') < labels().indexOf('导出预设列表') &&
    labels().indexOf('导出预设列表') < labels().indexOf('导入预设列表'),
  labels().join(' / '),
)
const headerActionGroups = () =>
  findNodes(tree, (n) => {
    if (classNameOf(n) !== 'aps-listActions') return false
    const names = findNodes(n, (node) => node.type === 'button').map(textOf)
    return (
      names.includes('导出预设列表') &&
      names.includes('导入预设列表') &&
      names.includes('+ 新建预设模式')
    )
  })
check('三个按钮在同一个动作组里（同一行）', headerActionGroups().length === 1, JSON.stringify(headerActionGroups().length))
check(
  '动作组位于简介小字下方、列表标题上方',
  findNodes(tree, (n) => classNameOf(n) === 'aps-listActions').length === 1,
  JSON.stringify(findNodes(tree, (n) => classNameOf(n) === 'aps-listActions').length),
)
check('导出按钮用次要样式 aps-btn', classNameOf(exportButton()) === 'aps-btn', `class=${classNameOf(exportButton())}`)
check('导出按钮是 type=button', exportButton()?.props?.type === 'button')
check('数据就绪后可点击', exportButton()?.props?.disabled === false, `disabled=${String(exportButton()?.props?.disabled)}`)

console.log('# 文案：中英对齐')
{
  const keys = ['exportList', 'exportCopy', 'exportLocal', 'exportHint', 'downloadHint', 'exportEmpty', 'exportFailed', 'importList', 'importConfirm', 'importInvalid', 'importHint']
  const zhKeys = Object.keys(studio.zh ?? {})
  const enKeys = Object.keys(studio.en ?? {})
  check('新增文案在 zh / en 都存在', keys.every((k) => studio.zh?.[k] && studio.en?.[k]), keys.map((k) => `${k}: ${studio.zh?.[k] ?? '-'} | ${studio.en?.[k] ?? '-'}`).join('  '))
  check('两本词典键集完全一致', zhKeys.length === enKeys.length && zhKeys.every((k) => enKeys.includes(k)), `zh=${zhKeys.length} en=${enKeys.length}`)
  check(
    '占位符两本词典一致',
    keys.every(
      (k) =>
        (String(studio.zh?.[k]).match(/\{\w+\}/g) ?? []).join() ===
        (String(studio.en?.[k]).match(/\{\w+\}/g) ?? []).join(),
    ),
    keys.map((k) => `${k}:{${String(studio.zh?.[k]).match(/\{\w+\}/g)}} vs {${String(studio.en?.[k]).match(/\{\w+\}/g)}}`).join(' '),
  )
  check('按钮文案不依赖未定义的键', studio.copy('exportList') === '导出预设列表', studio.copy('exportList'))
check('复制按钮文案为「复制基础信息」', studio.copy('exportCopy') === '复制基础信息', studio.copy('exportCopy'))
}

console.log('# 点击导出 → 弹窗 → 剪贴板内容')
tree = await runExport(studio.root, tree)

check('剪贴板写入一次', studio.writes.length === 1, `writes=${studio.writes.length}`)
const payload = studio.writes[0] === undefined ? undefined : JSON.parse(studio.writes[0])
check('导出的是 JSON 数组', Array.isArray(payload))
check('条目数与列表一致', payload?.length === PRESETS.length, `len=${payload?.length}`)
check(
  '每项只有 id / name / description 三个字段，顺序如约定',
  payload?.every((row) => JSON.stringify(Object.keys(row)) === JSON.stringify(['id', 'name', 'description'])),
  JSON.stringify(payload?.[0]),
)
check(
  '按列表顺序导出，且不泄漏提示词/技能/工具',
  JSON.stringify(payload) === JSON.stringify(EXPECTED),
  payload === undefined ? '' : JSON.stringify(payload),
)
check('停用中的预设同样导出', payload?.some((row) => row.id === 'custom-aaa111'))
check('空描述保留为空字符串', payload?.[2]?.description === '')
check(
  '写的是带缩进的可读 JSON',
  typeof studio.writes[0] === 'string' && studio.writes[0].includes('\n  {'),
  String(studio.writes[0] ?? '').slice(0, 40),
)

const notices = () => findNodes(tree, (n) => classNameOf(n) === 'aps-notice').map(textOf)
const errors = () => findNodes(tree, (n) => classNameOf(n) === 'aps-error').map(textOf)
check('提示已复制并带条目数', notices().some((t) => t.includes('已复制') && t.includes('3')), notices().join(' / '))
check('成功时没有错误行', errors().length === 0, errors().join(' / '))

console.log('# 兜底与失败路径')
{
  const second = mountStudio({ presets: PRESETS, asyncClipboard: false, copySucceeds: true })
  let t2 = await second.root.settle()
  t2 = await runExport(second.root, t2)
  check(
    '无异步剪贴板时走 textarea + execCommand',
    second.textareas.length === 1 && second.writes.length === 1,
    `textarea=${second.textareas.length} writes=${second.writes.length}`,
  )
  check(
    '兜底写入的是同一份预设清单',
    second.writes[0] !== undefined && JSON.stringify(JSON.parse(second.writes[0])) === JSON.stringify(EXPECTED),
  )
  const notice2 = findNodes(t2, (n) => classNameOf(n) === 'aps-notice').map(textOf)
  check('兜底路径也提示成功', notice2.some((t) => t.includes('已复制')), notice2.join(' / '))
  check('临时 textarea 用完即删', second.removed.length === 1, `removed=${second.removed.length}`)
}
{
  const third = mountStudio({ presets: PRESETS, asyncClipboard: false, copySucceeds: false })
  let t3 = await third.root.settle()
  await exportButtonIn(t3).props.onClick()
  const opened = await third.root.flush()
  const dialogCopy = copyButtonIn(opened)
  if (dialogCopy !== undefined) await dialogCopy.props.onClick()
  t3 = await third.root.flush()
  // A failed copy stays INSIDE the dialog: the user keeps the selection and
  // sees why nothing landed, instead of the dialog closing on an unconfirmed
  // action. The error line lives in the dialog body, so it is read after the
  // click re-rendered — before it there is nothing to report.
  const err3 = findNodes(t3, (n) => classNameOf(n) === 'aps-error').map(textOf)
  const ok3 = findNodes(t3, (n) => classNameOf(n) === 'aps-notice').map(textOf)
  check('弹窗仍在（失败不关闭）', copyButtonIn(t3) !== undefined, JSON.stringify(findNodes(t3, (n) => n.type === 'modal-stub').length))
  check('兜底失败时在弹窗内显示复制失败', err3.some((t) => t.includes('复制失败')), err3.join(' / '))
  check('复制失败时不显示成功提示', ok3.length === 0, ok3.join(' / '))
  check('复制失败时剪贴板确实没写成功', third.writes.length === 0, `writes=${third.writes.length}`)
}
{
  const fourth = mountStudio({ presets: [] })
  let t4 = await fourth.root.settle()
  await exportButtonIn(t4).props.onClick()
  t4 = await fourth.root.flush()
  const button = copyButtonIn(t4)
  check('空列表时弹窗的复制按钮不可用', button?.props?.disabled === true, `disabled=${String(button?.props?.disabled)}`)
  check('空列表不写剪贴板', fourth.writes.length === 0, fourth.writes.join(' , '))
  const notice4 = findNodes(t4, (n) => classNameOf(n) === 'aps-hint').map(textOf)
  check('空列表提示「还没有可导出的预设」', notice4.some((t) => t.includes('还没有可导出的预设')), notice4.join(' / '))
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
