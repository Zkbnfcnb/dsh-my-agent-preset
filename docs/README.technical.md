# dsh-my-agent-preset

在 DSH（DeepSeek Harness）Web 设置页中管理**自定义 Agent 预设模式**：新增、编辑、启用/停用与删除多个预设，并管理每个模式的**提示词、技能（按来源二级菜单）与工具范围**。

界面沿用官方设置页规范：与官方「预设」页相同的卡片网格结构、设置表单字段度量，只使用 `--dsw-alias-*` 主题 token，不引入任何 Harness Client 包。


参照官方插件的成熟机制：

| 功能 | 参照 | 实现 |
|---|---|---|
| 技能读取与注入 | `@michengai/dsh-skills-manager` | 技能目录按 `SkillSummary.source` 分组；注入走**分层 skills 注册表**：预设 scoped context 注册 provider → 落入该预设专属 layer。provider 对齐 skills-manager 的三件套：**mtime 缓存**读源文件、**`control` 接入**（abort signal + invalidate）、**结构化 locator**（`get` 校验路径防 stale） |
| 工具读取 | `dsh-tool-manager` | `agentPresets.acquireScope(id)` → `tools.schemas(scope.key)`，读取该预设**真实可见**的工具面；再并入 **per-Agent 观测表**（standing scope 读不到、只有活着的 Agent 能暴露的 `subagent` 等）。运行时侧对齐 tool-manager：启动即预挂载 baseline 固定 mount 顺序、`tools/change` 触发范围重装、`restrict` 失败按错误文本交集重试、`system-prompt/assemble` 过滤被拒工具的 schema |

## 功能

- **多个预设**：卡片网格列表，显示名称、描述、启用/异常状态、提示词、技能数、工具模式与稳定 id。
- **新增 / 编辑 / 删除 / 启停**：删除为两段式内联确认；停用后立即从注册表移除。
- **复制预设**：每张卡片底栏在「停用/启用」之后、「删除」之前常驻「复制」按钮（`aps-iconButton`，与相邻按钮同款；不论该预设启用还是停用都提供）。点击 = **完全副本**：提示词、注入方式、快照勾选（含高级强制屏蔽名单）、技能、工具名单原样带过，**启用状态跟随源**（源停用 → 副本也停用）；`id` 留空交由 Host 生成全新的 `custom-xxxxxxxx`，与源无任何关联；名字 = `源名（复制 N）`，**N 从 1 起**，逐个试到无人占用（含停用预设的名字一律算占用；副本的副本直接叠加成 `XX（复制 1）（复制 1）`；不限长、不截断）。副本**紧接源预设之后**入列：Client 组装载荷调现有 `save`，载荷带 `insertAfter` = 源 id，Host 据此插入并把**整列 `order` 重写为文档下标**（一次 persist、一次 reconcile），于是本页卡片顺序与「新建会话」预设列表（注册表按 `order` 排序）完全一致。复制后**不跳转编辑器**，反馈复用页面顶部 `aps-notice` 单行提示「已复制为 ××（复制 1）」，失败走 `aps-error` 行。
- **运行时上下文（快照）逐项勾选**：编辑器在「提示词」与「技能」之间新增独立分组，逐项控制每轮注入的 `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.` 那段。它是 `assembly.contexts`——与 `sections` **独立的字段**，所以「完全替换」和「自定义」都不曾动过它（那两者只过滤 sections），此前快照在任何注入方式下都全量注入。清单是**白名单**（同技能区语义，不做三模式；带与工具名单同款的过滤搜索框）：勾上 = 注入，未勾 = 屏蔽；带「全选 / 取消全选 + 已选计数」（`aps-linkButton`，只作用于可选项）。上方**过滤搜索框**按名称 / 中文标签 / 描述实时过滤（不区分大小写），显示「匹配 x/y」计数；无匹配时显示专用空态（「没有匹配的上下文」）并隐藏全选 / 取消全选，批量动作只作用于**可见行**——隐藏行保持打开编辑器时的勾选，过滤词是纯视图状态，不写入草稿、不触发自检。目录来自 Host 的 `CONTEXT_CATALOG`（对齐官方 `systemPrompt.context()` 的全部注册点）：`working-directory:current`、`sandbox:policy`、`approval:policy`、`subagent:delegation`、`team:identity`、`harness:source`、`app:web-surface`；此外 Host 在每次组装时**观测**该预设 Agent 实际携带的 context 名（内存观测表，对齐 per-Agent 工具观测表），于是第三方插件注册的项与按工具名动态生成的 `tool:<name>:depth` 也能进清单、标「第三方」。每行 = 中文标签 + 灰色等宽技术名 + 一句说明；排序为已勾选靠前、其余按官方 `CONTEXT_ORDERS`（也就是模型看到的顺序），观测项殿后。排序基准是**打开编辑器时的勾选集合**：编辑途中勾选/取消不会让行跳动，保存后重进才按新的勾选重排。**未管理 ≠ 空白名单**：字段缺失表示「全部注入」，保存时不会把当前目录物化成白名单——否则目录随后增长（插件新注册的段 / 运行中观测到的 context）时，旧预设只显示旧行勾选、新建预设显示新行勾选，两者对不上；只有用户真的点过一次复选框或批量按钮，数组才会写入并成为严格白名单。
- **必需项的「高级 · 强制屏蔽」（默认关闭）**：DSH 把 `working-directory:current` 与 `team:identity` 标为 `required: true` 并在**三层**强制注入——`assemble()` 的 required 通道、agent-loop 每步调用的 `refreshContext()`、以及 `dsh-working-directory` 自己那个 `prepend` 修复监听器（发现该项不见了就 `unshift` 补回，见其 `lib/index.js:48-61`）。普通白名单穿透不了，所以这两行的**主复选框是只读呈现**（勾选 = 正在注入，`disabled` = 这个开关管不到它），行下另挂一个**默认不勾**的「高级 · 强制屏蔽这一项」。勾上它，Host 用两个对抗手段真正关掉：① 在**该 Agent 自己的作用域**注册**同名但不带 `required`** 的 context——scoped 同名项在 merge 中遮蔽全局项，`refreshContext()` 因此不再把它当 required 补回；② 把本插件的组装过滤器注册成 `prepend`，让删除落在官方修复监听器**之外**。两者叠加经实测有效（见「验证状态」）。之所以做成默认关闭的高级项：它依赖实现细节而非公开契约，**DSH 升级可能让它悄悄失效且不报错**；且屏蔽「当前工作区」会让模型失去位置感、可能猜错路径——勾选后页面就地显示这段警告。这个勾选框只在当前 Host 声明支持时出现（`meta.capabilities` 含 `requiredSuppression`）：Client 可以热更新到一个尚未重启的旧 Host 上，而旧 Host 会静默丢弃该字段——与其给一个「勾了没反应」的开关，不如让它不出现，并把文档里已存的屏蔽如实读成「此 Host 不支持强制屏蔽（该项仍会注入）」。取消勾选是恢复官方默认，无需确认。`contexts` 数组里**永远不会**出现必需项名字：它是否注入只由这个高级名单决定。
- **导出 / 导入预设列表**：列表页简介小字下方一行依次是「+ 新建预设模式」「导出预设列表」「导入预设列表」（`aps-btn` / `aps-btnPrimary`，都在 `aps-listActions` 里，不再挤在组标题右侧）。导出弹窗复用共享的 `PresetSelectDialog`（shell `Modal` + `Button`，行样式沿用 `aps-row`），默认全选、支持全选/取消全选与已选计数。底部两个动作：**复制基础信息到剪贴板**仍只写 `[{ id, name, description }]`（列表顺序、含停用、提示词/技能/工具不外泄，优先 `navigator.clipboard.writeText`，非安全上下文回落临时 `textarea` + `execCommand`）；**导出到本地**把勾选预设的完整可移植信息（`name / description / instructions / instructionMode / contexts / requiredSuppressed / sections / sectionsSuppressed / skills / tools / enabled`，刻意不带 `id / order / status / 时间戳`）序列化为带缩进的 JSON，通过 Blob + 临时 `<a download>` 下载（文件名 `agent-presets-YYYYMMDD-HHmmss.json`）。导入按钮触发隐藏的 `<input type="file" accept=".json,application/json">`，读取后校验为 JSON 数组（也容忍 `{ presets: [...] }`），逐条只保留已知字段、丢弃 id/order，文件内同名条目也全部保留；没有可用预设或 JSON 非法时 `window.alert` 提示格式不正确。确认导入后逐条调用 Host `save`（`id: ''` 让 Host 重新生成 id，`order` 从当前最大值往后排），与已有名称（trim + 小写）相同的条目自动重命名为 `原名（导入 N）`（N 从 1 起，扫描已存名称与本批次已分配名称，停用预设也算占用）；`finally` 中 `refresh()`，有重命名时提示「已导入 N 个预设，其中 M 个同名预设已自动重命名」，否则提示「已导入 N 个预设」。
- **提示词**：写入该模式的系统提示词，注入方式三选一：**追加**（只用这段文字替换人设前缀，保留 DSH 其它系统提示词）、**完全替换**（仅用这段文字，移除所有其它提示词）、**自定义**（只用这段文字作为人设，并按下方勾选决定注入哪些提示词段：勾选 = 保留，未勾选 = 屏蔽；不再默认屏蔽 DSH 官方段，预设自身的人设段始终保留）。注意「自定义」下提示词留空 = 不注入人设。
- **技能（按来源二级菜单）**：目录来自 `ctx.skills.list()`，按 `source` 分组（如 `agent-trae`、`agent-opencode`、`agent-agents`），每个来源一个折叠菜单，菜单头显示 `已选/总数`，含「全选此来源 / 清空此来源」。勾选即注入，未勾选的技能在该预设内调用会被拒绝。**组内排序**：打开编辑器时已勾选的技能排在最前，其余按首字母（`localeCompare`）排序；勾选途中不重排，只有过滤词变化或保存后重进才按新选择重排。菜单上方带**过滤搜索框**：按技能名称或描述实时过滤（不区分大小写），有匹配的来源菜单**自动展开**、空组隐藏，清空过滤词恢复手动管理的展开状态；过滤时菜单头计数与「全选/清空此来源」只作用于**可见（匹配）技能**——所见即所选。搜索框是纯视图状态，不写入草稿、不触发自检。
- **工具范围**：`全部 / 仅白名单 / 排除名单` 三选一。名单对**该预设的全部工具生效**——内置工具（`read`/`bash`/`glob`…）与全局工具一并收窄，被名单拒绝的工具其**调用也会被拒绝**。**清单排序**：打开编辑器时已勾选的工具排在最前，其余按首字母排序；勾选途中不重排，只有过滤词变化或保存后重进才按新选择重排。名单带**过滤搜索框**：按工具名称或描述实时过滤（不区分大小写），显示匹配计数；切回「全部」时自动清空过滤词。
- **运行时自检**：读取该预设继承的完整工具面（standing scope ∪ per-Agent 观测并集）后**套用本页配置**，给出与配置一一对应的结果：可用工具、被名单拒绝的工具、启用的技能、已不在目录中的技能、**保留 / 已屏蔽的快照上下文**（两个名单 + 计数；预设未管理快照时显示「该预设未管理快照（全部注入）」，Host 应答不含该字段时整块不显示，绝不谎报 0）。**自动加载**：进入编辑器立即读取；工具名单、工具模式、技能勾选、快照勾选**或提示词段勾选**每变动一次，350ms 防抖后自动重读，无需手动点击（「重新读取」按钮保留作强制刷新）。自检把编辑器**当前未保存的配置**作为 dry-run 覆盖传给 Host（`inspect` 端点的 `config` 参数），因此结果**实时跟随编辑内容**、标注「预览：按当前编辑内容计算，保存后才生效」；**保存预设才真正改变运行时**。Host 忽略 `config` 参数（未重启加载新 Host 代码）时，client 用 `previewSelection` **本地重算**：旧 Host 返回的 tools/blockedTools 恰好划分了继承面，据此重建 surface 并套用草稿选择——任何 Host 版本下面板都同步展示编辑效果，仅「已不在目录中的技能」因目录在 Host 侧而按已保存配置窄化显示。并发请求按序号丢弃过期响应。**段清单分区**：`custom` 模式下，自检面板在工具/上下文计数旁展示**保留段与被屏蔽段**的计数及具体段名名单（与工具/上下文同一套可滚动列表），分区与运行时过滤共用 `resolveSectionSelection`，勾选每变一次就随 350ms 防抖重读一起更新；`append` / `complete` 模式不过滤 section，因此不显示该分区；`available: false` 时说明 section 列表不可读，`managed: false` 时显示「该预设未管理提示词段（全部注入）」，绝不谎报 0。

## 技能如何生效

勾选的技能以 `[{ name, path }]` 形式写入 capability row 的 config，三步生效：

1. **注入**——capability row 在**预设自己的 scope** 里调用 `scoped.skills.registerProvider(...)`。分层注册表规则：*scoped context 注册的 provider 落入该预设的 layer*。provider 的 `list/get` **直接读取技能来源文件**（`SkillSummary.path`）并解析 frontmatter，与 skills-manager 读取外部技能目录的方式一致，因此即使某个全局来源被关闭，该预设仍保有它勾选的技能；`path` 为空的虚拟技能回退到全局层按名读取。
2. **目录级裁剪**——注册表按作用域**合并**各层，filesystem provider 发现的**未勾选**技能本来照样进目录。本 provider 因此在自己的层里同时发布另一半：list 前先经**递归保护**读一份「不含本 provider 的基线目录」（`registry.list`，嵌套调用直接返回 `[]`），再为基线中**未勾选**的技能发布覆盖候选——`invocation: { modelInvocable: false }`。模型的 Skill catalog 只收录 `modelInvocable` 的技能，**未勾选的技能因此整体退出模型上下文**（不再占目录条目），`get` 直接按 locator 读文件、不回 registry（回 registry 会再次选中自己而递归）。覆盖**不论基线技能是否带源文件**：带 `path` 的走 locator 直读文档；**不带 `path` 的内置/bundled 技能**（如 `dsh-skill-office` 的 `pdf`，其正文由自身 provider 的 `get` 解析、目录项里没有 path）则只靠 `rank`（SKILL_RANK=10 远低于 bundled 600）取胜、且不带 locator——`get` 对这类候选直接返回 `undefined`，正文永不可达，模型既看不见也加载不了。早期版本对「无 path」的未勾选技能**跳过覆盖**（理由是无法回读正文），结果内置技能漏出白名单、空勾选仍会载入 `pdf`；现已改为一律覆盖。
3. **调用级限制**——`skill` 工具的 guard 拒绝未勾选技能的调用：`该预设模式未启用技能 <name>`。目录级裁剪（步骤 2）已覆盖所有未勾选基线技能（含无 path 的内置技能），guard 作为调用级兜底，确保即使未来有名字漏进目录也无法真正加载。

### 技能列表是白名单：什么都不勾 = 该预设没有任何技能

早期实现有两处「空勾选短路」，导致「什么都不选」时发现型技能（如 `pdf`）原样回到 Skill catalog：

1. `toDefinition` 的 `needsCapability`——无提示词、无技能、工具全开时干脆**不装 capability row**，裁剪逻辑根本不存在；
2. capability row 只在 `skills.length > 0` 时注册 provider；`installAgentScope` 也只在勾选数 >0 时安装技能 guard。

现在语义统一为**白名单**：capability row 对**每个自定义预设**都挂载（`config.skills` 数组存在即声明「本预设管理技能」，空数组 = 白名单为空），provider 把基线技能**全部**压成 `modelInvocable: false`，技能 guard 无条件安装并拒绝名单外的一切 `skill` 调用。只有当 config **根本没有 `skills` 字段**（非本页写入的行）才不做裁剪。

provider 的实现对齐 skills-manager 的三个机制：

| 机制 | 作用 |
|---|---|
| **mtime + size 缓存** | 每个模型步都重新组装提示词 → 注册表问 provider → provider 读文件。文档按 `mtimeMs + size` 缓存，未变的文件不再重读；文件被 skills-manager 导入/更新后 mtime 前进，下一个 `list` 立即反映。技能文件被删除时缓存条目即刻作废 |
| **`control` 接入** | 注册表以 `(control) => provider` 形式调用工厂：`control.signal` abort 时 provider 跳过剩余读取；`control.invalidate` 被收集，当某个源文件消失且**全局层也无同名副本**可回退时调用，让分层注册表重新合并（全局副本得以顶上 winner） |
| **结构化 locator** | 候选携带 `locator: { name, path }`；`get` 校验路径与本预设保存的条目一致，旧挂载留下的 stale 候选无法把正文从别的文件里拉出来——与 skills-manager 对自身 locator 的严格校验同理 |

### 勾选即启用：rank 与 invocation 语义（「勾了 pptx 却只见 pdf」的根因）

注册表对每个技能名只保留**一个 winner**，同层内按 `rank` **升序**排序、先见者胜，后来的同名候选被直接丢弃。发现型来源的 rank：project 100/200、runtime 250、custom 300、user-dsh 400、**user-agents 500**、bundled 600。

两个坑曾经叠加成「勾选的技能没进 Skill catalog」：

1. **rank 输给发现源**——本 provider 原来用 `rank: 600`，在预设自己的层里排在 `user-agents`（500）之后，filesystem provider 的同名候选先被看见并赢走 winner；
2. **源文件的 `disable-model-invocation: true`**——像 `pptx-generator` 这样的技能带这个标记（对被动发现是对的），它赢了 winner 后以 `modelInvocable: false` 进入目录：技能存在、注入也成功，**但模型的 Skill catalog 不显示它**。而 `pdf` 的源文件没有这个标记，所以谁赢都无所谓——于是用户只看见 pdf。

修复（capability row）：

- `SKILL_RANK = 10`：预设里**显式勾选**是对该预设使用此技能的用户决定，对一切发现型来源（≥100）绝对优先；
- **invocation 强制 `{ modelInvocable: true, userInvocable: true }`**：勾选即启用，覆盖源文件的 `disable-model-invocation`（该标记继续对全局被动发现生效）；
- 候选隔离：非法技能名（不匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`）被跳过、空 description 落占位文案——注册表对候选是**校验即抛错**，一个坏技能原本会把整个 provider（连同其他勾选技能）拖下水。

注意 `frontend-design` 这类**不在任何技能根**的勾选项：目录里没有它、全局层也按名读不到，就不会注入——先把技能文件夹放进 `~/.agents/skills/` 或 `$DSH_HOME/skills/` 再重新保存预设。

配置变更保存后，Host 侧还会复刻 skills-manager 的 `notifyChatCatalog`：`emit('commands/change')` 刷新聊天命令目录，并对每个带 `agentPreset` 的会话补发 `agent-preset/selected`，让技能目录与预设范围在**不重启**的情况下对活跃会话生效。

**技能与工具名单相互独立。** 没有这条规则时，`allow: ["tool_list"]` 这类窄名单会连 `skill` 工具一起拒掉，于是勾选的技能既加载不了、技能目录也不会载入。因此只要预设勾选了任何技能，`toDefinition` 就把 `skill` 并入 allow 名单（`inspect` 用同一规则复算，保证自检与实际一致），`capability` 的工具 guard 也对 `skill` 放行。

### 自定义：提示词段勾选

`custom` 模式与「完全替换」的 `complete: true` 不同：它**不使用 complete 核弹**，而是在预设 scope 注册一个 `system-prompt/assemble` waterfall 监听器（`prepend: true`，先调用 `next()` 让所有下游贡献完成，再过滤最终结果），只从 `assembly.sections` 中按**精确段名**过滤，`tools` / `contexts` / `variables` 一概不动。

- `sections` 字段**缺失** = 不管理（全部段注入）；**数组** = 严格保留名单；**空数组** = 只留预设人设段。
- 预设自身的人设段（`deployment:persona-prefix`）由 capability 注册，永远保留；`sectionsSuppressed` 是页面「高级 · 强制屏蔽」写下的逃逸口，只接受这个名字。
- `deployment:persona-suffix` 是 DSH 官方注册的普通段，本插件不再特殊处理：它按清单勾选注入或屏蔽。
- 没有内置的官方命名空间表：段清单完全由勾选决定，第三方插件与 `mcp:<server>` 段默认保留，直到用户取消勾选。

**段目录来自运行中的注册表**（`readSectionNames` 读 `systemPrompt.layers.merge(scope).sections` 的 keys），与运行时上下文是同一套 `layers.merge` 探针；`list` 的 `meta.sectionCatalog` 合并全局层与每个预设 scope，并固定补上预设自己的人设前缀段（`required: true`，`present` 表示该名字是否真的注册过）；官方 `persona-suffix` 若在 live registry 中，则作为普通行列出。页面用与 `ContextPicker` 完全相同的勾选组件（`SectionPicker`）：全选 / 取消全选 / 已选计数、已勾选靠前、普通行可切换；两者共用同一套过滤搜索框（`aps-filter` + `aps-input` 搜索输入）——段清单按名称、上下文清单按名称 / 标签 / 描述实时过滤，显示「匹配 x/y」计数，无匹配时显示「没有匹配的提示词段」/「没有匹配的上下文」并隐藏批量按钮，全选 / 取消全选只作用于可见行，过滤词变化时按当前勾选重新排序。人设行勾选且禁用，旁边一行「高级 · 强制屏蔽这一项（官方本不允许）」。

**自检与运行时同源**：`resolveSectionSelection(names, allowed, suppressed)` 同时服务 `inspect` 的 dry-run 与 capability 的运行时过滤，因此面板里的 `kept` / `blocked` 计数与两个名单就是真正会执行的决定。`inspect` 接受草稿覆盖（`sections: null` = 不管理，显式覆盖存储值），勾选变化并入 `inspectKey`，350ms 防抖后重读。`available: false` 表示注册表不可读，不会谎报 0；`managed: false` 表示该预设不管理段清单（全部注入）。

**白名单的边界**：之后新装插件注册的段不在已存名单里，默认不注入，需要在页面上重新勾选；自检的「被屏蔽」名单会列出它们，便于发现。

### 目录读取必须走预设 scope（曾经「没有可注入的技能」的根因）

**skills 注册表与它的 filesystem provider 都挂载在每个 Agent 预设的 composition 里**（`dsh-base` 的 `skill` / `skill-filesystem` / `tool-skill` 行），**不在 Host root 的 global 层**。因此 Host 侧直接 `skills.list({})` 只会查 global 层——**永远返回空目录**，而每个 Agent 明明都能正常加载技能。这与工具面是同一个教训：目录必须通过 `acquireScope(id)` 租到的 `lease.key` 读取。

| 读取点 | 旧（错误） | 新（正确） |
|---|---|---|
| 设置页技能菜单 | `skills.list({})` → 永远 `[]` | `list()` 租一次 baseline scope，`skills.list({ scope: lease.key })` |
| 保存时解析技能 path（`skillIndex`） | 同上 → 所有 `path` 为空，注入退化为全局层按名读取 | 经 baseline scope 读取，`path` 指向真实源文件 |
| `inspect` 的 `missingSkills` | Host 全局读 → **目录里的技能全被误报缺失** | 经该预设自己的 scope 复算 |

`list()` 的一次租约同时服务工具面与技能目录（重复租约会白白重挂 standing mount）。技能目录为空时页面不再只显示一句「没有可注入的技能」，而是给出诊断（`skillDiagnostics`：服务是否可达、是否走了 scope、条目数、错误）与技能发现根（`skillRoots`，共 **4 个**，与 `dsh-skill-filesystem` 的默认根一致：`<工作区>/.dsh/skills`、`<工作区>/.agents/skills`、`$DSH_HOME/skills`、`~/.agents/skills`），照着放技能文件夹即可。

## 工具范围如何生效

由 **Host 半（`index.js`）在 root 上下文**监听 Agent 生命周期，再在**每个加入该预设的 Agent** 的 `agent.ctx` 上安装（`dsh-tool-manager` 采用同一模式）：

| 管理项 | 机制 | 作用范围 |
|---|---|---|
| 白名单 / 排除名单（可见性） | `agent.ctx` 上的 `tools.restrict({ allow })` / `{ deny }` | 过滤**进程全局**工具的可见性；非全局工具名在注册时被剔除（`restrict` 的契约）。名单里出现未知名字时按 `restrict` 错误文本中的 `known global tools:` 集合**取交集重试**，一个过期名字不再让整份名单失效（同 `dsh-tool-manager` 的 `parseKnownRestrictable`） |
| 同一份名单（调用级） | `agent.ctx` 上的 `tools.guard()` | 拒绝名单外工具的调用，**覆盖该预设继承的内置工具与 per-Agent 工具** |
| 同一份名单（提示词组装） | `agent.ctx` 上的 `system-prompt/assemble` waterfall | `restrict` 只能隐藏作用域**继承**的层；同层注册的内置工具与 per-Agent 工具被名单拒绝时，从 `assembly.tools` 与对应 `tool:` guidance 段中剔除——模型的工具清单不再携带注定被拒的 schema（同 `dsh-tool-manager` 的 assemblyFilter）。**这是提示词卫生，不是权限控制**：调用级仍由 guard 兜底 |

`restrict` 抛出 unknown-name 错误后的重试与 assemble 过滤的剔除集合都以「本 Agent 当前真实工具面」为准，因此 MCP 动态工具、插件 HMR 等运行时变化由 `tools/change` 触发的全量重装统一吸收。

为什么两层都要装：`restrict` 的契约是 *Restrictions intersect; scoped registrations remain visible* ——它只能过滤作用域**继承**的层，而预设每一行都注册在 Agent **自己那一层**，所以单靠 `restrict` 无法让内置工具受名单影响。

### 六重触发与一个 waterfall 陷阱

`installAgentScope` 由六个独立时机驱动，任何单一机制失效都不影响其余：启动时扫描活跃 roster、`agent/created`、`agent/preset/selected`、`agent/pre-step`，以及一个 4 秒周期扫描（不依赖任何 inject 或事件）。周期扫描直接读 Host 上下文的 roster，因此即使 `agents` 服务晚些才出现、或某个事件被错过，范围仍会补装。

第六个时机是 **`tools/change`**（同 `dsh-tool-manager` 的 baseline 刷新）：MCP 服务器连上时才发布自己的工具、插件 HMR 会重注册、每次 preset recomposition 也派发一次——名单必须对着**新**工具面重算。刷新做了四层防护：`mutating` 标志过滤本插件自己 restrict/guard 释放产生的回声、`refreshQueued` 把并发触发合并成一轮、`setImmediate` 延后到下一个事件循环刻度（scoped 注册的装/卸是异步落定的，立刻快照只会拍到中间态）、`agentScopeDead()` 在安装前探测 Agent fiber 是否仍然存活（Cordis 异步 dispose fiber 时**先**清 uid——此后任何 `ctx.effect()` 都抛 `INACTIVE_EFFECT`——而 Agent 从 roster 移除在这之后，setImmediate 回调可能撞上「fiber 已死、roster 未除」的窗口直接崩掉 Host）。安装主体另有一层兜底 catch：`restrict()` 默认 notify，监听器可在 restrict 与 guard 之间同步 dispose 该 Agent，此时已落地的部分注册会被释放而非泄漏，`INACTIVE_EFFECT` 被视为「无需安装」而非崩溃。两个 4 秒扫描 timer 均 `unref()`，不会拖住 Host 事件循环。

**baseline 预挂载**也在启动时完成：`agentPresets` 为每个预设保留**一份** standing composition，而 blank 会话总是先由部署默认预设组成、再被模式选择器重链。若自定义预设先被 compose（恢复的会话、或本页自己的读取），默认→自定义的切换会让后挂载 composition 的 per-Agent 注册（`subagent` 等）在竞态中丢失且被 DSH 缓存。因此本插件在首次 reconcile 后立刻 `acquireScope(baselineId)` 租一次即释放——把 mount 顺序钉在 `[default, …]`，与 `dsh-tool-manager` 的 `DefaultPresetMount` 完全一致。

`agent/pre-step` 是 **waterfall** 事件（`dispatch.waterfall`），不是普通 emit——它的监听器签名是 `(payload, next)`，**必须调用 `next()` 并把 decision 传下去**：

```js
ctx.on('agent/pre-step', (payload, next) => {
  /* …检查并安装… */
  return next()          // 漏掉这一行，整条链就断了
})
```

漏掉 `next()` 时 waterfall 返回 `undefined`，Agent 循环随后读 `decision.kind` 抛出 `Cannot read properties of undefined (reading 'kind')`。`dsh-agent` 自己的监听器（`async ({ agent }, next) => { const decision = await next(); … return decision }`）正是这个形状。

### 为什么必须在 Host 而不是 capability row 里装

这是第一版真正失效的原因。预设的 mounted 子树是一个独立 fiber，其上下文并不与 Host 处于同一条事件链上——`dispatch()` 读的是**发起 emit 的那个上下文**自己的 hook 表：

```js
dispatch(type, args) { ... return (this._hooks[name] || []).filter(...) }
```

`agent/created`、`agent/preset/selected` 由 root 发出，因此挂在**预设 mount 子树**里的监听器根本收不到——guard 从未安装，名单自然「不生效」。`tools.restrict()` 同样拒绝非 Agent 自己的上下文（`scopeOf(this.ctx)` 为空时直接抛异常）。`dsh-tool-manager` 与 `dsh-skills-manager` 都把这类监听放在 Host root，本插件现已一致：`installAgentScope` 在 Host 侧，覆盖 `agent/created`、`agent/disposed`、`agent/preset/selected` 三个时机，并在配置变更（`reconcile`）后为所有活跃 Agent 重装。

### 三类工具，名单的效力不同

设置页的候选清单是**完整继承面**，每项标注来源，因为它决定了名单能管到什么程度：

| 类别 | 例子 | 注册位置 | 名单能否隐藏 | 名单能否拒绝调用 |
|---|---|---|---|---|
| 全局工具（标「全局」） | `config_backup`、`tool_list`、`session_search` | Host/global 层 | ✅ `restrict` | ✅ guard |
| 继承的内置工具（标「内置」） | `read`、`bash`、`skill`、`glob` | 预设 standing scope | ❌ 同层注册，`restrict` 无法隐藏 | ✅ guard |
| per-Agent 工具（标「内置」） | `subagent`、`list_subagent_models`、`subagent_fork` | 每个 Agent 自己的层 | ❌ 同上 | ✅ guard |

第三类既不在全局层也不在任何 standing scope——由 `dsh-tool-subagent` 之类的插件在每个 Agent 上调用 `runtimeCtx.tools.register()` 注册，所以 `acquireScope()` 读不到它们，只有活着的 Agent 能暴露其名字。本插件维护一张**per-preset 观测表**：每次给 Agent 装 scope 时顺手记录它的完整工具面（`observeAgentTools`），候选清单取「standing scope ∪ 活跃 Agent 的并集 ∪ 观测表」——不再只看第一个活跃 Agent，Agent 消失后其工具也不会在目录里闪烁。运行时自检的 `listedUnavailable` 用同一张并集面复算，per-Agent 工具不再被误报为「不在继承面内」。

Agent 加入预设发生在创建之后，因此安装时机覆盖三种：`agent/created`（已加入的直接安装）、`agent-preset/selected`（选择事件时重装）、`agent/disposed`（卸载并释放两个注册）。

预设继承基准预设（默认 `standard`）的全部非 persona 行，因此其 Agent 天然拥有部署的内置工具；本插件的工具菜单是**在这个面上做收窄**，而不是逐行重建。设置页的候选清单就是这个完整继承面（内置工具标「内置」、可被 restrict 隐藏的标「全局」）。

## 运行时上下文（快照）如何生效

模型每轮看到的 `Current runtime context…` 那段不是提示词 section，而是 **`assembly.contexts`**：`dsh-agent-loop` 每步 `assemble()` 后取 `renderContextSections()` 拼成文本，作为 user 消息注入会话（`RuntimeContextProjection.project`）。因为它与 `sections` 是两个字段，本插件此前的「完全替换」（`complete: true`）和「自定义」（section 过滤）都碰不到它——快照永远全量注入。现在勾选清单直接过滤这个字段：

| 环节 | 机制 |
|---|---|
| 屏蔽 | `installAgentScope` 在 **Agent 自己的 ctx** 上注册 `system-prompt/assemble` waterfall 监听器（与工具 assemblyFilter 同一位置、同一已验证可达的上下文），按白名单过滤 `assembly.contexts`。Cordis 的 scope filter 允许祖先 scope 的 listener 命中后代事件（`dsh-scope` 的 `scopeTarget`），因此预设行的 Agent 能收到该 Agent 的组装。该监听器随 `installAgentScope` 的全部六个触发时机（启动扫描、`agent/created`、`agent/preset/selected`、`agent/pre-step`、4 秒周期扫描、`tools/change`）一并安装/重装，disposer 记进 scope state，刷新时先释放再重装，不泄漏。 |
| 必需项（默认关不动） | `required: true` 的 context 由 `assemble()` 与 agent-loop 每步的 `refreshContext()` 强制补回（`dsh-system-prompt/lib/index.js`），`dsh-working-directory` 还在自己的 `prepend` 监听器里 `unshift` 兜底（其 `lib/index.js:48-61`）。**普通白名单穿透不了这三层**——监听器对 runtime 认定的 required 名恒定放行，页面把这些行的主复选框做成勾选且禁用（只读呈现注入状态）。**哪些名字是 required 不来自本插件的表**：`readContextRegistry()` 通过 `systemPrompt.layers.merge(scope, layer => layer.contexts)` 读注册表自己的表项——这正是 `assemble()` 读的同一份视图——`required` 与 `order` 都取运行时的值。因此新版 DSH 新增一个必需项会立刻被保护并在面板标「运行时必需」，旧版撤销某个必需项也会立刻变成可关闭；两者都不需要升级本插件。读不到（`layers` 形状变了）时回退内置表，面板提示「未能读取运行时提示词注册表」。 |
| 必需项（高级强制屏蔽，默认关） | 勾选行下的「高级 · 强制屏蔽」后，Host 用两个实测有效的手段对抗三层防护：① `installAgentScope` 在**该 Agent 自己的 ctx** 上经 `systemPrompt.context()` 注册**同名不带 `required`** 的 shadow（scoped 同名项遮蔽全局项，`refreshContext()` 不再把它当 required 补回；shadow 文本恒为空、`interpolate: false`）；② 本插件的组装过滤器改以 `prepend` 注册，删除落在官方修复监听器**之外**。两者缺一不可（实测：只有①会被修复监听器补回文本，只有②会被 `refreshContext` 复活）。disposer 记进 `state.contextShadows`，随每次刷新先释放再重装。两个前提：shadow 必须注册在**有作用域标签的 ctx** 上（`agent.ctx.get('systemPrompt')` 返回按访问者 ctx 绑定的视图，注册才落进 Agent 自己的层；换成无标签 ctx 会撞进 global 层、被官方同名项挤掉并抛 duplicate——该异常被就地 `logger.warn`，届时高级勾选表现为"勾了没反应"而非崩溃），且该 Agent 的作用域必须挂在预设作用域之下（与 `dsh-agent-loop` 的 `createScope(loopCtx, this)` 一致）。它依赖实现细节而非公开契约，DSH 升级可能**静默失效**，因此默认关、页面就地警告。 |
| 观测 | 同一个监听器顺手把本次组装实际携带的 context 名记进 `observedContexts`（内存，`presetId → Set`）。清单 = 内置目录 ∪ **注册表实存名** ∪ 观测名：注册表读得到时，第三方插件的项与动态命名的 `tool:<name>:depth` 即使还没有任何 Agent 组装过也已经出现在清单上；读不到时退回观测。内存而非落盘：预设里已存的勾选名永远在清单上，重启不会让一项已勾选的能力被误屏蔽。 |
| 降级 | 过滤逻辑自身抛错时**放行全部**并 `logger.warn`——丢工作区/沙箱策略比多注入危险得多。监听器抛错绝不吞掉 `next()` 的结果链。 |
| 预览 | `inspect` 用与运行时**同一个**分区函数 `resolveContextSelection(surface, contexts, requiredSuppressed)` 复算「保留 / 已屏蔽」，dry-run 覆盖同样接受 `config.contexts` 与 `config.requiredSuppressed`；被强制屏蔽的必需项会出现在「已屏蔽」名单里并标 `forcedContexts`。快照勾选（含高级名单）并入 `inspectKey`，350ms 防抖自动重读，与工具/技能完全一致。 |

**语义要点**：快照勾选与三种注入方式**互不干扰**（它过滤的是 contexts，那两者动的是 sections）；屏蔽**只影响该预设自己的 Agent**，不递归到它派生的子 Agent；屏蔽**不回改会话历史**里已注入的旧快照，只影响此后每一轮组装。复制预设时 `contexts` 与 `requiredSuppressed` 都原样带过：未管理的源复制出未管理的副本，已管理的副本继承同一份白名单与同一份强制屏蔽名单。数据文件里 `contexts` **只写可选项名字**——必需项是否注入完全由 `requiredSuppressed` 决定，两处不重复记账。

## 与其他工具管理插件冲突（重要）

`tools.restrict()` 的契约是 **Restrictions intersect**——多个来源的限制取**交集**，谁都无法单独放宽别人收紧的部分。本 profile 里启用的 `dsh-tool-manager` 同样会对每个 Agent 装 restrict：对**未配置按需工具组**的预设，它会 `deny` 掉 `tool_list`（见其 `denyNames()`：`groups.length === 0` 时把 `DISCOVERY_TOOL_NAME` 加入 deny）。

结果就是实测到的现象：本插件设 `allow: ["tool_list"]`、tool-manager 又 `deny: ["tool_list"]`，交集为空——继承面（51 个工具）被清空，只剩那些不在任何 restriction 约束内的 per-Agent 注册工具（如 `subagent`、`list_subagent_model`），`tool_list` 自己反而消失了。

**工具管理只能有一个所有者**。要用本插件管理预设的工具范围，请禁用 `dsh-tool-manager`（设置 → 插件）；反之亦然。运行时自检里的「名单中有 N 个工具不在该预设的继承面内」就是这类冲突的信号。

## 数据文件

```json
{
  "version": 2,
  "presets": [
    {
      "id": "custom-1a2b3c4d",
      "name": "只读分析模式",
      "description": "只阅读与总结，不修改任何文件",
      "instructions": "你是一名只读分析助手……",
      "instructionMode": "append",
      "contexts": ["sandbox:policy", "approval:policy", "harness:source"],
      "requiredSuppressed": ["working-directory:current"],
      "skills": ["pdf", "frontend-design"],
      "tools": { "mode": "allow", "names": ["read", "grep"] },
      "enabled": true,
      "order": 0,
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

`contexts` 有**三种状态**，语义不同：字段**缺失** = 该预设不管理快照，`assembly.contexts` 原样注入（本功能之前保存的旧预设正是这种状态，升级瞬间行为零变化）；字段是**数组** = 严格白名单，数组里的名字注入、没进数组的名字一律屏蔽；数组**为空** = 只剩必需项注入。`contexts` 里**只写可选项**，`required: true` 的名字从不写入——它们是否注入由 `requiredSuppressed` 单独决定：字段缺失或为空数组 = 高级开关关（官方契约保持，两项照常注入，这是默认）；数组里列出某个必需项名字 = 走上面那套对抗手段强制屏蔽它。两个名单各管一半，互不重复记账。旧版（version 1，含 `builtins` / `mcpServers` 字段）的数据会被自动兼容读取，废弃字段被忽略。文件使用「临时文件 + rename」原子写入。可用 bundle 行 config 的 `dataFile` 覆盖路径。

插件从 `dsh-agent-preset-studio` 改名为 `dsh-my-agent-preset` 后，默认目录同步改为 `$DSH_HOME/my-agent-preset/`。旧目录 `$DSH_HOME/agent-preset-studio/` 不再读取；需要沿用旧预设时，请手工把 `presets.json` 移到新路径。`test/verify-default-data-path.mjs` 固定了新路径读取、旧目录被忽略、显式 `dataFile` 覆盖与损坏文件容错四种行为。

## 本地 HTTP API

仅接受回环地址，前缀 `/api/dsh-my-agent-preset`，POST JSON，统一返回 `{ ok: true, value }` 或 `{ ok: false, error: { message } }`。

| 端点 | 请求体 | 说明 |
|---|---|---|
| `list` | `{}` | 预设与状态、全局工具目录、按来源分组的技能目录、**快照上下文目录 `meta.contextCatalog`**（每行带 `required` / `order` / `known` / `source`：`registry` 表示读自运行时注册表，`table`/`observed` 表示回退到内置表或观测表）、`meta.contextRegistry`（`readable` / `scoped` / `scopeKeys`）、**段目录 `meta.sectionCatalog`**（每行 `{ name, required, present }`，固定包含人设前缀段，`present` 表示该名字是否真的注册过）、**能力标记 `meta.capabilities`**（`snapshotContexts` / `presetDuplicate` / `requiredSuppression` / `contextRegistryTruth`，供 Client 判断当前 Host 到底懂哪些字段） |
| `save` | 预设对象（无 `id` 表示新建；可选 `insertAfter: <源 id>` 把新预设插在该预设之后并把整列 `order` 重写为文档下标——复制预设用） | 校验并落盘，随后重新注册 |
| `delete` | `{ id }` | 删除并重新注册其余预设 |
| `toggle` | `{ id }` | 启用/停用 |
| `inspect` | `{ id, config? }` | 读取该预设继承的工具面并套用本页配置，返回可用/被拒工具、启用技能、**保留/已屏蔽的快照上下文（`contexts` / `blockedContexts` / `forcedContexts` / `contextsManaged`）**——分区用的是与该预设运行时过滤**同一份** live `required` / `order`；`sectionFilter` 按 `config` 里的草稿清单重算（`blocked` / `kept` / `managed` 计数 + `blockedList` / `keptList` 名单），编辑器每勾选一次就能看到分区变化；可选 `config: { tools, skills, contexts, requiredSuppressed, sections, sectionsSuppressed }` 为编辑器未保存内容的 dry-run 覆盖（结果带 `draft: true`；`sections: null` 表示草稿不管理，显式覆盖存储值） |
| `reload` | `{}` | 从数据文件重新注册全部预设 |

## 验证状态

机制单测（模拟 ctx 与 Cordis 事件形状，全部通过）：

- **工具侧（对齐 dsh-tool-manager）**
  - `restrict` 容错重试：名单含 unknown 名时按错误文本 `known global tools:` 取交集重试，restriction 确实以交集装上。
  - `tools/change` 防抖：连续 3 次触发合并为恰好 1 轮全量重装；本插件自身 restrict/guard 释放的回声被 `mutating` 吞掉。
  - `system-prompt/assemble` 过滤：被拒工具与其 `tool:` guidance 段从组装结果剔除，名单内工具与普通段保留。
  - baseline 预挂载：启动（无需打开设置页）即 `acquireScope(default)`；重复 reconcile 不重复 compose。
  - per-Agent 观测表：`subagent` 进入候选目录并标记 `global:false`；inspect 的 `listedUnavailable` 不再误报 per-Agent 工具。
- **运行时上下文真值（`verify-context-registry-truth.mjs`）**
  - 真实 `SystemPrompt` + `createScope` 下，`requiredContextNames` / `contextCatalog` 读到注册表的 `required` 与 `order`，而非内置表。
  - 新版新增的必需项（内置表根本没听过）既被过滤放行、也在面板标 `required`/`known:false`；旧版撤销必需性的行反而变成可关闭。
  - 注册表实存但从未被任何 Agent 观测到的 context 也进入目录（否则面板恰好藏起最该展示的那一行）。
  - 组装侧与面板分区一致：被白名单排除的行里，只有 runtime 不再保护的那一行真的消失。
  - 读不到注册表时整条链路回退内置表（`required`/`order` 均保持旧值）。
  - **重启后首次 `list`**：先等待 `systemPrompt` 就绪（仅首次等待）、确保默认预设最先组合，再**并发（上限 4）**为每个预设借一次 scope 预热，因此每个预设 capability/base 行注册的段与上下文都进入目录——不会出现「编辑器只有几个人设段、自检却有完整清单」的首次加载差异；未知 scope 的预设视图不再降级成全局视图并缓存。预热 promise 由并发请求共享、结果记忆化（后续 `list` 零组合成本），损坏预设每次进程只尝试一次（`reconcile()` 后重试），挂载顺序仍由默认预设先行保证。
  - 段清单分区：`sections` 缺失 = 全部保留、数组 = 严格保留名单、空数组 = 只留人设段；`sectionsSuppressed` 只接受人设段；实存段的 blocked/kept 分区。
- **段清单 UI（`verify-section-checklist-ui.mjs`）**
  - 段清单只在「自定义」下渲染，切回「追加」立即消失；未管理时全部普通段勾选、人设段勾选且禁用。
  - 每行人设段带「始终保留 · 不可屏蔽」标签与「高级 · 强制屏蔽这一项（官方本不允许）」逃逸口，勾选后写入 `sectionsSuppressed` 并翻转人设行的只读勾选。
  - 全选 / 取消全选只作用于普通段；空名单保存为 `[]`（显式决定，不是「不管理」）；普通行取消勾选后保存的数组只含剩余段。
  - 自检返回的 `sectionFilter` 计数与名单跟随草稿（未管理草稿发 `null`），在自检面板直接展示「保留 / 被屏蔽」计数与两个名单。
- **未管理清单不被物化（`verify-unmanaged-lists.mjs`）**
  - 未管理的段 / 上下文清单保存后**不带字段**（保持「全部注入」），工具保持 `mode:'all'`、技能保持 `[]`，目录不会被复制成名单。
  - 目录随后增长时，已有未管理预设与新建预设勾选的行**完全一致**（新增行同样勾选）；只有显式勾选或批量操作才写入严格白名单，且该白名单不再自动增长。
- **列表过滤框 UI（`verify-list-filters-ui.mjs`）**
  - 段清单与上下文清单各带与工具名单同款的搜索框（`aps-input` + `type="search"`，`aps-sectionFilter` / `aps-contextFilter`）：中文占位文案、`匹配 x/y` 计数、无匹配空态并隐藏全选 / 取消全选。
  - 段清单按名称匹配（不区分大小写），上下文清单按名称 / 中文标签 / 描述匹配；过滤后必填行可被隐藏，但主复选框仍勾选且禁用。
  - 全选 / 取消全选只作用于可见行：隐藏行保持原勾选，保存载荷只含存活的可见可选项；过滤是纯视图状态。
- **自检面板用语一致（`verify-copy-and-contexts-ui.mjs`）**
  - 摘要条上的每个计数与它下方列表的标题用**同一套措辞**（如「被名单拒绝的工具 133 个」↔「被名单拒绝的工具（133）」），测试用"去掉数字/括号/量词后主干相同"来钉住这一点；「继承工具面 N 个」是唯一没有对应列表的一项（它就是全部继承面）。
- **技能侧（对齐 dsh-skills-manager）**
  - 目录经 baseline scope 读取：`skills.list` 收到 `{ scope: lease.key }`，按来源分组正确返回（Host 全局读为空的回归）。
  - `inspect.missingSkills` 经 scope 复算：目录内的技能不再误报缺失。
  - **目录级裁剪**：未勾选的技能被覆盖为 `modelInvocable: false`（退出模型上下文），`get` 直接读文件且不再回 registry；`registry.list` 只由外层调用一次（递归保护生效）。
  - **白名单语义**：空白名单仍生成 capability row 并注册 provider（基线技能全部压为不可见）；`skill(pdf)` 被技能 guard 拒绝；config 无 `skills` 字段时才不裁剪。
  - 无 path 的内置/bundled 基线技能也覆盖为 `modelInvocable: false`（靠 rank 取胜，正文不可达），不再漏出白名单。
  - 勾选技能 rank（10）小于一切发现源，invocation 强制模型可调用（覆盖源文件的 `disable-model-invocation`）。
  - 坏候选隔离：非法技能名被跳过、空 description 落占位，单个坏技能不再拖垮整个 provider。
  - provider 读源文件 frontmatter；`mtimeMs + size` 未变命中缓存（同字节改动不重读），mtime 前进立即重读。
  - 结构化 locator：`path` 不匹配的 stale 候选被 `get` 拒绝。
  - 源文件删除：无全局副本时 `get` 触发一次 `invalidate`；有全局副本时按名回退且不再 invalidate。
  - `control.signal` abort：`list`/`get` 跳过读取。
  - 目录变更通知：保存预设后恰好 1 次 `commands/change`，且只有带 `agentPreset` 的会话收到 `agent-preset/selected`。
- **回归**：`toDefinition` 技能带 path、勾选技能时 `skill` 并入 allow 名单。
- **自检 dry-run 覆盖（模拟 store 冒烟 19 项全部通过）**：`inspect` 传 `config` 后按编辑器未保存的选择计算——deny 名单只拒列出的名字、allow+技能自动并入 `skill`、空名单回落 `all`、`skills` 空数组即全部不可用且不误报缺失、结果带 `draft: true`；不传 `config` 行为与旧版逐项一致；非法 `config`（非对象）回落存储配置；未知 id 仍报错。
- **草稿本地重算 `previewSelection`（client 侧单测 20 项全部通过）**：对旧 Host（忽略 `config`、无 `draft` 标志）的应答，从 tools∪blockedTools 重建继承面并套用草稿选择——deny/allow/all 三种模式分区正确、allow+技能自动并入 `skill`、面外名字进 `listedUnavailable`、`missingSkills` 窄化为草稿仍勾选的技能；新 Host 的 `draft:true` 应答、失败应答、空面应答原样透传。
- **Client 侧模块级检查 6 项通过**：factory 可执行、`zh/en` 词典键集合一致、全部 84 处 `t()` 引用可解析。
- **React 渲染级测试（`react-test-renderer` 18，模拟输入与勾选）共 40 项全部通过**：技能过滤——搜索框渲染、名称/描述匹配（不区分大小写）、匹配组自动展开、空组隐藏、计数 `匹配 N/M`、清空恢复手动展开态、空目录诊断分支不渲染搜索框且 hook 顺序安全；工具过滤——allow 模式下过滤收窄清单、计数提示、切 `all` 清空关键词并隐藏清单；**排序**——工具清单与技能组内均「已勾选在前 + 其余首字母」，且不受目录原始顺序影响；**同步展示（旧 Host mock）**——进入编辑器立即携带 dry-run `config` 调用一次 `inspect`，勾选工具或技能各触发恰好一次防抖重读且携带最新选择，面板在**未保存**时即同步展示草稿效果（勾选 grep 后可用工具 1→3、被拒 3→1；取消唯一勾选技能后 skill 工具退出可用集）。

已实测（安装时、重启前）：`list` 技能目录按来源分 3 组共 43 个技能、全局工具 26 个；scope lease 读取成功；旧版 version 1 数据被兼容且预设成功注册进 registry。

- **导出预设列表 → 基础信息/本地文件（`node test/verify-export-clipboard.mjs`）**：不依赖浏览器——用最小 React shim 挂载 `StudioSection`，把渲染树当数据驱动（找按钮、`await onClick`、读剪贴板日志）。覆盖：「+ 新建预设模式 / 导出预设列表 / 导入预设列表」三个按钮位于同一个 `aps-listActions` 动作组、按新建→导出→导入排序、次级按钮样式 `aps-btn`、加载中禁用；导出内容严格等于 `[{id,name,description}]`（顺序一致、含停用预设、空描述保留为空串、提示词/技能/工具不外泄、带 2 空格缩进）、成功提示带条目数且无错误行；`navigator.clipboard` 缺失时走 `textarea` + `execCommand` 且临时节点被删除；复制失败显示错误行且**不**显示成功提示；空列表不写剪贴板并提示无可导出；`zh`/`en` 两本词典键集与 `{}` 占位符一致。
- **导入 / 本地导出（`node test/verify-import-export.mjs`）**：覆盖「导出到本地」下载的 JSON 是完整可移植信息且不含 id/order/status/时间戳；文件选择后打开同一勾选弹窗、文件内同名条目全部保留、无名称条目忽略；确认导入对每条选中项调用 `save`（`id: ''`、`order` 接在最大值后、字段完整），同名项改名为「原名（导入 N）」；重命名计数提示、导入完成关闭弹窗；非法 JSON 与无可用预设数组都触发 `window.alert` 且不写 Host。

- **自定义段清单（`node test/verify-custom-sections.mjs`、`node test/verify-section-checklist-ui.mjs`）**：模拟 root → preset scope → agent scope 的真实层级。覆盖：未管理时全部段注入；保留名单外的段（含官方与第三方）被移除；空名单只留人设段；「高级 · 强制屏蔽」移除人设段；`tools` / `contexts` 原样保留；预设人设段保留且文本与用户输入一致；`complete` 仍只留人设段。

- **复制预设 + 运行时上下文分组（`node test/verify-copy-and-contexts-ui.mjs`，Client 渲染级，全部通过）**：与导出测试共用 `_studio-harness.mjs`（浏览器桩 + React shim + 弹窗桩 + Host API 录制）。覆盖：三张卡片底栏都有「复制」、位置严格是「停用/启用 → 复制 → 删除」、样式 `aps-iconButton`、**停用卡片同样提供**；点击复制的载荷 = `id:''` + 名字 `审查（复制 2）`（源名的（复制 1）已被别的卡片占用时继续递增）+ `insertAfter` 指向源 + 启用状态与各字段逐项一致 + `contexts` 原样带过，成功提示含新名字，页面**停留在列表**；未管理的源复制出的载荷不带 `contexts`。编辑器分组顺序「提示词 → 运行时上下文 → 技能」；每个目录项一行（中文标签 + 技术名 + 说明），两个 required 行勾选且**禁用**、带「必需 · 不可关闭」标签；取消一个可选项后保存的数组不含它但两个必需名仍在；**未管理预设打开时全勾**，直接保存**保持未管理**（不把目录物化成白名单）；「取消全选」只清空可选项、必需项仍勾选。自检面板渲染「保留快照 3」「已屏蔽 2」计数与两个名单（屏蔽名单含观测到的第三方项），未管理预设显示「未管理快照」而不是计数。
- **快照白名单端到端（`node test/verify-context-snapshot.mjs`）**：驱动**真实** `SystemPrompt` 服务 + root → preset scope → agent scope 三层，装上 store 的 Agent scope 后组装。覆盖：托管预设只注入勾选的可选项，**白名单里没写的两个 required 项照样注入**，未勾选的官方项与未知第三方项一律屏蔽；`refreshContext()`（agent-loop 每步都调）保留 required 且**不复活**被屏蔽项；未管理预设（字段缺失）注入**全部**官方项与第三方项，升级零行为变化。纯函数侧：`normalizePreset` 缺失字段 = `undefined`、数组去重裁剪、非数组不算白名单；`resolveContextSelection` 的保留/屏蔽分区与 `CONTEXT_ORDERS` 顺序（观测项殿后）；`insertAndReindex` 副本插到源之后且整列 order 重写为下标、未知源回落追加；副本命名从「（复制 1）」起、被占用则递增、副本的副本直接叠加。
- **既有测试修复**：`verify-export-clipboard.mjs` 此前已因导出改为弹窗 + 引入 `dsh-client-ui-primitives` 而**完全跑不起来**（`unexpected require`）。现改为共用 harness，并驱动两步（开弹窗 → 按「复制基础信息到剪贴板」）；新增断言覆盖失败路径留在弹窗内不关闭、空列表时复制按钮禁用。
- **旧 Host 降级（同一测试内）**：Cordis 进程内缓存已 import 的模块，Host 半的代码**要重启 dsh 进程才生效**，所以「新 Client + 旧 Host」是安装后、重启前的真实状态。此时 `meta` 没有 `contextCatalog`：页面显示空态提示、隐藏分组头的已选计数（空目录谎报「已选 0 项」比不显示更糟），自检面板整块不显示快照计数，`save` **不**从空目录凭空生成白名单。新 Host 的 `CONTEXT_CATALOG` 是硬编码的，永不为空，因此该降级路径不会影响正常语义。
- 回归：`node test/regression-scope-lifecycle.mjs`（含 tools 服务缺失时的 state 记账）、`verify-custom-sections` / `verify-section-checklist-ui` / `verify-builtin-skill-gap` 全部保持通过。

已实测（重启 Host 后的端到端 A/B 对照，2026-10-23）：

- **新 Host 生效**：`list` 的 `meta.contextCatalog` 返回官方 7 项（含 `required` 标记与中文标签）。重启前它不存在——Cordis 进程内缓存已 import 的模块，Host 半改动**必须重启 dsh 进程**才生效。
- **未管理预设 = 零行为变化**：`inspect` 对无 `contexts` 字段的预设答 `contextsManaged: false`、kept = 全部 7 项、blocked = 0。现存 10 个预设升级后 9 个仍为未管理，全部注册成功。
- **屏蔽真实生效（A/B 对照，读会话日志里的快照原文）**：临时建两个除 `contexts` 外完全相同的预设各开一个会话——白名单只留 `working-directory:current`（+ 必需但无内容的 `team:identity`）的实验组，注入的快照**只剩一行工作目录**；全量勾选的对照组注入完整 5 段（工作目录 / 沙箱策略 / 审批策略 / 实现检出路径 / GUI URL）。被屏蔽项在真实模型上下文里确实消失，且排除了"这些项本来就没文本"的解释。测试预设已删除、测试会话已归档，数据恢复原状。
- **复制路径（API 级，载荷与 Client 实际发送的一致）**：`insertAfter` + `id: ''` 的 save 返回全新 `custom-xxxxxxxx`；副本落在源之后（order 4），其余预设 order 整体重写为 0..10；`enabled: false` 与 `contexts` 白名单原样带过；删除后列表恢复 10 项、全部注册。
- **观测表为懒填充**：`diag` 显示重启后尚未跑过新 turn 的预设 `observedContexts` 为空——符合设计（清单 = 官方目录 ∪ 观测名，官方 7 项始终在列）。跑过一轮后实测补上了两个动态名 `tool:subagent:depth` / `tool:subagent_fork:depth`，第三方与动态命名的项进清单这条路径得到验证。

已实测（高级强制屏蔽，2026-10-23 第二轮）：

- **三层防护全部穿透（读会话日志里的快照原文）**：临时预设 `contexts: [sandbox:policy, approval:policy]` + `requiredSuppressed: [working-directory:current]`，开会话后注入的快照只剩**沙箱策略 + 审批策略两段**——`Current working directory…` 确实消失，尽管 `dsh-working-directory` 的 `prepend` 修复监听器与每步 `refreshContext()` 都在跑。
- **分区如实**：`inspect` 报 kept `[sandbox:policy, approval:policy, team:identity]`、blocked 含 `working-directory:current`、`forcedContexts: ['working-directory:current']`——未被点名的必需项 `team:identity` 仍留在 kept，符合"只屏蔽勾选的那一项"。
- **可逆**：把 `requiredSuppressed` 改回空数组后 `inspect`，kept 立刻恢复含 `working-directory:current`、`forcedContexts` 归空——取消勾选就是回到官方默认，无残留。
- **能力门控（新 Client + 会丢字段的旧 Host）**：本轮实现期实测到——Client 热更新后 Host 若未重启，`list` 无 `capabilities` 标记，旧 Host 会静默丢弃 `requiredSuppressed`。页面据此**不显示**高级勾选框、把已存的屏蔽读成"仍会注入"并标注原因，且保存时原样透传该字段（不新增、也不抹掉用户既有意图）。此组合由 `verify-copy-and-contexts-ui.mjs` 的门控场景钉住。
- 实验预设已删除（列表恢复 10 项、全部注册）、实验会话已归档。

未做：浏览器内的像素级外观与交互确认（本 profile 的 Web GUI 需登录令牌，自动化浏览器无会话；页面行为以 React shim 渲染级测试 + 上述 API / 会话日志级验证代替）。

## 已知限制

- `required: true` 的快照项**默认关不掉**：官方三层机制强制注入（`assemble` 的 required 通道、每步 `refreshContext()`、`dsh-working-directory` 自己的 `prepend` 修复监听器）。现在可以关，但要走行下那个**默认不勾**的「高级 · 强制屏蔽」，代价是这条路依赖实现细节而非公开契约：DSH 升级可能让它**静默失效**（不报错，只是该项又出现了）。屏蔽「当前工作区」还会让模型失去位置感、可能猜错路径。主复选框仍是只读呈现（禁用），高级开关才是控制点。
  - 哪些名字算 required 已经从「内置表」改成「运行时注册表」：`systemPrompt.layers.merge(scope, layer => layer.contexts)` 是 `assemble()` 自己读的同一份视图，`required` / `order` 都取运行时的值。前提是 `layers` 与 `merge` 的字段名不变（未文档化 API，但只是**读**，失败即回退内置表，不会破坏组装）。
  - 若某预设尚未记录到 standing scope key（`meta.contextRegistry.scopeKeys` 为 0），读取退化为全局层视图：全局注册的必需项仍然准确，预设层额外注册的 required 项要等一次 `acquireScope` 之后才被看见。
- 段清单**按精确段名**：清单来自运行中的注册表（`layers.merge(scope).sections` 的 keys），页面把可勾选的段整体列出，屏蔽哪些完全由勾选决定，不再猜测段归属，也没有内置命名空间表。之后新装插件注册的段不在已存名单里，默认不注入，需要在页面上重新勾选；自检的「被屏蔽」名单会列出它们。
- 快照清单里的**第三方项不再完全依赖观测**：注册表读得到时，实存的每一条 context 都会进入清单；只有读不到时才回退到「已被某个 Agent 组装过才出现」。已保存的勾选名始终不受影响。

- 工具名单对**内置工具**的收窄原本只能停留在调用级（guard）：DSH 的 `restrict` 契约无法隐藏同一作用域层注册的工具。现在 `system-prompt/assemble` 过滤会把被拒工具连同其 `tool:` guidance 段一并从提示词组装中剔除，模型的工具清单不再携带它们——但这仍是**提示词卫生**：`schemas()` 层面这些工具依旧可见，调用级由 guard 拒绝兜底。
- 技能的目录级裁剪覆盖**全部**未勾选的基线技能（被压成 `modelInvocable: false`，退出模型上下文）：有源文件的走 locator 直读，无 path 的内置/bundled 技能靠 rank 取胜、正文不可达——两者都不再出现在模型目录里；调用级仍由 `skill` guard 兜底拒绝。
- 技能来源路径在**保存/重载时**解析一次；技能文件被移动后需重新保存该预设。
- 预设只在**新建会话**时绑定；已存在的会话保留创建时的 revision，改完预设请新建会话。
- 预设不是安全沙箱：预设行在 Host 进程内执行。

## 目录结构

| 文件 | 职责 |
|---|---|
| `index.js` | Host 半：数据文件读写、基准行读取、预设注册、技能来源目录、**运行时注册表视图（`required`/`order` 真值）**、快照上下文目录与过滤监听、复制插入（`insertAfter` + order 重写）、运行时自检、本地 HTTP API |
| `capability.js` | 预设内挂载的能力行：提示词 section、技能 provider 注入、**段勾选过滤（`resolveSectionSelection` + `system-prompt/assemble` 监听器）**（快照过滤不在这里——它是 per-Agent 工作，与工具 restrict/guard 同侧放 Host） |
| `client.js` | Client 半：设置页 section（列表 + 复制 + 编辑器 + 运行时上下文勾选清单 + 技能二级菜单 + 运行时自检），自带 CSS |
| `cordis.patch.yml` | bundle 补丁：插入 Host 行 |
| `locale/*.json` | 插件清单中显示的中英文标题与描述 |
| `icon.svg` | 插件图标 |
| `docs/specs/*.md` | 设计规范（决策链与验收标准） |
| `test/*.mjs` | 回归测试：`_studio-harness.mjs` 为共享的浏览器桩 + React shim + Host API 录制；其余脚本各自驱动一个功能面，`node test/<name>.mjs` 直接运行 |
