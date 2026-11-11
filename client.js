/**
 * dsh-my-agent-preset — Client half (Web).
 *
 * Renders the "自定义预设模式" page in DSH Settings. The page is a management
 * list plus an inline editor over the Host half's loopback JSON API:
 *
 * - list:    one card per custom preset (name, description, id, state)
 * - editor:  name/description, persona prompt, injected skills (grouped by
 *            source, a second-level menu per source), and the tool scope
 * - actions: create, edit, enable/disable, delete, export roster to clipboard
 *
 * Styling follows the host's own preset page card grid and the settings form
 * field metrics, using theme tokens only. No Harness Client package is
 * imported.
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-agent-preset',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { useState, useEffect, useCallback, useRef, createElement: h } = React
    // The host's own UI primitives (seeded into the browser module table): the
    // export dialog reuses the shell's Modal and Button so its chrome matches
    // every other dialog in the app instead of inventing a style.
    const UI = require('@deepseek-ai/dsh-client-ui-primitives')

    /** Settings page API prefix served by the Host half. */
    const API_PREFIX = '/api/dsh-my-agent-preset'
    /** Dictionary namespace owned by this plugin. */
    const LOCALE_NS = 'settings.myAgentPreset'

    /** Page styles: host card grid + host field metrics, theme tokens only. */
    const CSS = `.aps-section{max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.aps-title{margin:0;font-size:18px;font-weight:600;line-height:1.4}
.aps-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:1.6}
.aps-listActions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.aps-fileInput{display:none}
.aps-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}
.aps-notice{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:1.5}
.aps-group{display:flex;flex-direction:column;gap:10px}
.aps-group+.aps-group{margin-top:20px}
.aps-groupHead{letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;font-weight:600}
.aps-groupHeadRow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.aps-groupHeadRow .aps-hint{flex:none;white-space:nowrap}
.aps-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px;margin:0;padding:0;list-style:none}
.aps-card{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));display:flex;flex-direction:column;transition:border-color .16s,background .16s}
.aps-card:hover{background:var(--dsw-alias-interactive-bg-hover)}
.aps-cardBroken{border-color:var(--dsw-alias-state-error-primary)}
.aps-cardOff{opacity:.72}
.aps-cardMain{appearance:none;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;display:flex;flex-direction:column;gap:10px;flex:1;padding:14px 16px 12px;border-radius:var(--dsw-radius-lg) var(--dsw-radius-lg) 0 0}
.aps-cardMain:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.aps-cardHead{display:flex;align-items:center;gap:8px;min-width:0}
.aps-cardName{font-size:15px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.aps-pill{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.aps-pillQuiet{color:var(--dsw-alias-label-tertiary)}
.aps-pillError{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-layer-3)}
.aps-cardDesc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.55;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.aps-cardFacts{display:flex;flex-wrap:wrap;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
.aps-fact{border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);padding:1px 6px}
.aps-cardFoot{border-top:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:2px;padding:6px 10px}
.aps-cardFootAsk{margin-right:auto;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.aps-cardFootId{margin-right:auto;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%}
.aps-iconButton{appearance:none;font:inherit;font-size:12px;line-height:1;border:0;background:0 0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:6px}
.aps-iconButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.aps-iconButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}
.aps-iconButton:disabled{opacity:.4;cursor:default}
.aps-iconButtonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-state-error-primary)}
.aps-empty{border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}
.aps-cardPanel{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));padding:4px 16px 16px}
.aps-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.aps-field+.aps-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.aps-fieldHead{display:flex;align-items:center;gap:8px}
.aps-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.aps-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.aps-example{margin:0;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.aps-input,.aps-textarea{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.aps-input{height:34px;padding:0 12px}
.aps-textarea{padding:8px 12px;min-height:92px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px}
.aps-input:focus-visible,.aps-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
/* Chip editor: the same 34px box/border metrics as .aps-input, with the chips
   and the caret sharing one row. Focus lives on the inner input, so the ring is
   drawn by :focus-within on the shell. */
.aps-seg{display:inline-flex;gap:2px;background:var(--dsw-alias-bg-layer-3);border-radius:var(--dsw-radius-md);padding:2px}
.aps-segItem{appearance:none;border:0;background:0 0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);padding:4px 12px;cursor:pointer}
.aps-segItem[aria-pressed='true']{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
.aps-segItem:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-filter{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.aps-toolFilter,.aps-sectionFilter,.aps-contextFilter{margin-top:10px}
.aps-input[type='search']{-webkit-appearance:none;appearance:none}
.aps-input[type='search']::-webkit-search-cancel-button{cursor:pointer}
.aps-checklist{max-height:232px;overflow:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:6px}
.aps-checkRow{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--dsw-radius-sm);cursor:pointer}
.aps-checkRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.aps-checkRow input{margin:0}
.aps-checkNested{margin-left:22px;padding-left:6px}
.aps-checkBody{display:flex;flex-direction:column;gap:1px;min-width:0}
.aps-checkName{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.aps-checkDesc{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.aps-footer{display:flex;align-items:center;gap:8px;padding-top:16px}
.aps-footerSpacer{flex:1}
.aps-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.aps-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.aps-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-btn:disabled{opacity:.4;cursor:default}
.aps-btnPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));border-color:transparent;color:var(--dsw-alias-bg-layer-3)}
.aps-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-label-primary))}
.aps-disc{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}
.aps-disc+.aps-disc{margin-top:8px}
.aps-discHead{appearance:none;border:0;background:0 0;font:inherit;display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 12px;cursor:pointer;color:var(--dsw-alias-label-primary)}
.aps-discHead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.aps-discHead:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.aps-discCaret{flex:none;width:12px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:1}
.aps-discTitle{flex:1;min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aps-discCount{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-3);border-radius:999px;padding:1px 7px}
.aps-discBody{padding:4px 12px 12px;border-top:.5px solid var(--dsw-alias-border-l2)}
.aps-rowList{display:flex;flex-direction:column}
.aps-row{display:flex;align-items:center;gap:8px;padding:6px;border-radius:var(--dsw-radius-sm);cursor:pointer}
.aps-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.aps-row input{margin:0}
.aps-rowBody{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.aps-rowName{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.aps-rowMeta{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);overflow-wrap:anywhere}
.aps-inlineActions{display:flex;flex-wrap:nowrap;align-items:center;gap:6px;padding:6px 0 2px}
.aps-inlineActions .aps-hint{margin-left:auto;white-space:nowrap}
.aps-linkButton{appearance:none;border:0;background:0 0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 6px;border-radius:var(--dsw-radius-sm)}
.aps-linkButton:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.aps-linkButton:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-warn{margin:2px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere}
.aps-warnBlock{margin:8px 0 0;border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md);padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:6px}
.aps-warnTitle{font-size:13px;line-height:1.5;font-weight:500;color:var(--dsw-alias-state-warn-primary)}
.aps-warnBody{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.aps-inspect{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:8px}
.aps-inspectHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.aps-inspectCount{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.aps-nameListBlock{margin-top:10px}
.aps-nameListTitle{margin:0 0 4px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.aps-nameList{margin:0;padding:0;list-style:none;max-height:190px;overflow:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}
.aps-nameList li{padding:3px 10px;font-size:12px;line-height:1.6;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;border-top:.5px solid var(--dsw-alias-border-l1)}
.aps-nameList li:first-child{border-top:0}`

    /** Chinese dictionary. */
    const zh = {
      nav: '自定义预设模式',
      title: '自定义预设模式',
      description: '新增、编辑、复制与删除自定义 Agent 预设模式，并管理其提示词、运行时上下文、技能与工具。',
      create: '新建预设模式',
      createTitle: '新建预设模式',
      exportList: '导出预设列表',
      importList: '导入预设列表',
      exportSelectTitle: '选择要导出的预设',
      exportSelectHint: '勾选要导出的预设，可复制基础信息到剪贴板，或导出完整预设信息到本地 JSON 文件。',
      exportCopy: '复制基础信息',
      exportLocal: '导出到本地',
      exportHint: '已复制 {count} 个预设的基础信息（id / name / description）到剪贴板。',
      downloadHint: '已导出 {count} 个预设到本地 JSON 文件。',
      downloadFailed: '导出失败：{message}',
      exportEmpty: '还没有可导出的预设。',
      exportFailed: '复制失败：{message}',
      importSelectTitle: '选择要导入的预设',
      importSelectHint: '勾选要导入的预设；确认后会追加到列表末尾，与已有预设同名的条目会自动重命名为「原名（导入 N）」后导入。',
      importConfirm: '确认导入',
      importing: '导入中…',
      importInvalid: '文件格式不正确：请选择由「导出到本地」生成的 JSON 文件。',
      importFailed: '导入失败：{message}',
      importHint: '已导入 {added} 个预设，其中 {renamed} 个同名预设已自动重命名。',
      importHintPlain: '已导入 {count} 个预设。',
      importEmpty: '文件中没有可导入的预设。',
      editTitle: '编辑预设模式',
      loading: '加载中…',
      empty: '还没有自定义预设模式',
      emptyHint: '新建一个预设模式，为它指定提示词、要注入的技能与工具范围。',
      name: '名称',
      nameHint: '显示在新建会话的预设列表里。',
      descLabel: '描述',
      descHint: '一句话说明这个模式做什么。',
      groupBasic: '基本信息',
      groupPrompt: '提示词',
      instructions: '系统提示词',
      instructionsHint: '写入该模式的系统提示词；留空则沿用部署人设（在「自定义」下留空 = 不注入人设）。',
      instructionMode: '注入方式',
      modeAppend: '追加',
      modeComplete: '完全替换',
      modeCustom: '自定义',
      modeAppendHint: '只用这段文字替换人设前缀，保留 DSH 其它系统提示词（工具指导等）。',
      modeCompleteHint: '只使用这段文字，移除所有其它系统提示词（含第三方插件注入）。',
      modeCustomHint: '只用这段文字作为人设，并按下方勾选决定注入哪些提示词段：勾选 = 保留，未勾选 = 屏蔽。DSH 官方段不再默认屏蔽，预设自身的人设段始终保留。',
      groupContexts: '运行时上下文',
      contexts: '注入的快照项',
      contextsHint: '逐项勾选每轮注入的「Current runtime context」快照里允许出现哪些上下文；未勾选的项对该预设不再注入。标记「必需 · 不可关闭」的项由官方强制注入，无法关闭。',
      contextsRequiredTag: '必需 · 不可关闭',
      contextsForcedTag: '已被本预设强制屏蔽',
      contextsForceUnavailable: '此 Host 不支持强制屏蔽（该项仍会注入）',
      contextsForceLabel: '高级 · 强制屏蔽这一项（官方本不允许）',
      contextsForceWarn: '官方在三层机制里强制注入这一项。本插件用两个依赖实现细节的手段对抗它——同名覆盖 + 更外层过滤——DSH 升级可能让它悄悄失效且不报错。屏蔽「当前工作区」后模型将不知道自己在哪个目录，可能猜错路径；确认要这样吗？',
      contextsForeignTag: '第三方',
      contextsRuntimeRequiredTag: '运行时必需',
      contextsNameSeparator: '、',
      contextsRuntimeRequiredHint: '运行时的提示词注册表声明这些项为必需（本插件的目录里没有）：{names}。它们由官方每个步骤强制补回，因此保持勾选且不可关闭。',
      contextsRegistryUnavailable: '未能读取运行时的提示词注册表，以上目录来自本插件内置的表，可能与当前 DSH 版本不一致（必需项可能显示得不准确）。',
      sections: '注入的提示词段',
      sectionsHint: '逐项勾选要注入的提示词段；未勾选的段对该预设不再注入。标记「始终保留 · 不可屏蔽」的项承载本预设自己的提示词，默认无法取消，可用下方高级选项强制屏蔽。',
      sectionsRequiredTag: '始终保留 · 不可屏蔽',
      sectionsSuppressedTag: '已被本预设强制屏蔽',
      sectionsForceLabel: '高级 · 强制屏蔽这一项（官方本不允许）',
      sectionsForceHint: '人设段承载本预设自己的提示词，默认始终保留；强制屏蔽后该段不再注入，等同没有这段文字。',
      sectionsRegistryUnavailable: '未能读取运行时的提示词段列表，以上目录可能不完整。',
      noSections: '当前没有可勾选的提示词段。',
      sectionFilterPlaceholder: '过滤提示词段：名称',
      sectionFilterNone: '没有匹配的提示词段',
      sectionFilterCount: '匹配 {shown}/{total} 个提示词段',
      sectionsClearHint: '取消全部普通勾选后，只保留预设自身的人设段。',
      contextsClearHint: '取消全部非必需勾选后，快照只剩必需项。',
      noContexts: '当前没有可勾选的快照上下文项。',
      contextFilterPlaceholder: '过滤上下文：名称或描述',
      contextFilterNone: '没有匹配的上下文',
      contextFilterCount: '匹配 {shown}/{total} 个上下文',
      copy: '复制',
      copyDone: '已复制为 {name}。',
      copyFailed: '复制失败：{message}',
      inspectContexts: '保留的快照上下文 {count} 项',
      inspectContextsBlocked: '被屏蔽的快照上下文 {count} 项',
      inspectContextsUnmanaged: '该预设未管理快照（全部注入）',
      inspectContextsList: '保留的快照上下文（{count}）',
      inspectContextsBlockedList: '被屏蔽的快照上下文（{count}）',
      groupSkills: '技能',
      skills: '注入的技能',
      skillsHint: '技能白名单：只有勾选的技能进入该预设的 Skill 目录并可被调用；未勾选的技能对该预设的模型不可见。什么都不勾选 = 该预设没有任何技能。',
      skillsAll: '全选此来源',
      skillsNone: '清空此来源',
      noSkills: '当前没有可注入的技能',
      skillSource: '来源：{source}',
      skillFilterPlaceholder: '过滤技能：名称或描述',
      skillFilterNone: '没有匹配的技能',
      skillFilterCount: '匹配 {shown}/{total} 个技能',
      groupTools: '工具',
      toolMode: '工具范围',
      modeAll: '全部',
      modeAllow: '仅白名单',
      modeDeny: '排除名单',
      toolsHint: '名单对该预设的全部工具生效：内置工具与全局工具一并收窄，被拒绝的工具其调用也会被拒绝。',
      noTools: '当前没有可勾选的工具',
      toolFilterPlaceholder: '过滤工具：名称或描述',
      toolFilterNone: '没有匹配的工具',
      toolFilterCount: '匹配 {shown}/{total} 个工具',
      toolScopeGlobal: '全局',
      toolScopeBuiltin: '内置',
      selectedCount: '已选 {count} 项',
      warnSkillsNeedToolTitle: '已自动保留 skill 工具',
      warnSkillsNeedToolBody: '技能与工具名单相互独立：只要勾选了技能，本预设就始终保留 skill 工具，工具名单不会禁用它们。',
      groupInspect: '运行时自检',
      inspectRun: '重新读取',
      inspectRunning: '读取中…',
      inspectAutoHint: '进入本页与配置改动后会自动重新读取。',
      inspectDraftPreview: '预览：按当前编辑内容计算，保存后才生效',
      inspectSections: '保留的提示词段 {count} 项',
      inspectSectionsBlocked: '被屏蔽的提示词段 {count} 项',
      inspectSectionsUnmanaged: '该预设未管理提示词段（全部注入）',
      inspectSectionsList: '保留的提示词段（{count}）',
      inspectSectionsBlockedList: '被屏蔽的提示词段（{count}）',
      inspectSectionsUnavailable: '未能读取运行时 section 列表，保留/屏蔽分区暂不可用。',
      inspectSurface: '继承工具面 {count} 个',
      inspectTools: '可用工具 {count} 个',
      inspectBlocked: '被名单拒绝的工具 {count} 个',
      inspectSkills: '启用的技能 {count} 个',
      inspectSkillsOff: '技能工具未启用，该预设的技能全部不可用',
      inspectListedUnavailable: '这些名字写进了名单，但该预设的继承面里没有它们，因此不会生效——多半是拼写不对，或提供该工具的插件没有装进这个预设。',
      inspectEmpty: '该预设没有任何可用工具',
      inspectUnavailable: '无法读取运行时视图：{reason}',
      inspectSaveFirst: '先保存预设，再读取运行时视图。',
      inspectToolsList: '可用工具（{count}）',
      inspectBlockedList: '被名单拒绝的工具（{count}）',
      inspectSkillsList: '启用的技能（{count}）',
      inspectSkillsMissingList: '已不在技能目录中的技能（{count}）',
      inspectListedUnavailableList: '名单中不在继承面内的工具（{count}）',
      noSkillsRoots: '技能从这些文件夹发现，把技能文件夹（含 SKILL.md）放进去即可出现在此列表：',
      skillDiagUnavailable: 'Host 上下文没有 skills 服务，技能目录不可读。',
      skillDiagEmpty: '注册表返回了 0 个技能。',
      skillDiagError: '读取技能目录出错：{message}',
      stateOn: '已启用',
      stateOff: '已停用',
      stateBroken: '异常',
      enable: '启用',
      disable: '停用',
      remove: '删除',
      close: '关闭',
      selectAll: '全选',
      clearSelection: '取消全选',
      cancel: '取消',
      confirmShort: '确认删除？',
      confirmYes: '删除',
      save: '保存',
      saved: '已保存',
      saving: '保存中…',
      registryMissing: '预设注册表不可用：修改不会生效。',
      factPrompt: '有提示词',
      factSkills: '技能 {count}',
      factToolsAll: '工具：全部',
      factToolsAllow: '工具：白名单 {count}',
      factToolsDeny: '工具：黑名单 {count}',
      loadFailed: '读取失败：{message}',
      saveFailed: '保存失败：{message}',
      deleteFailed: '删除失败：{message}',
    }

    /** English dictionary. */
    const en = {
      nav: 'Custom Presets',
      title: 'Custom Presets',
      description: 'Create, edit, duplicate and delete custom Agent presets and manage their prompt, runtime context, skills and tools.',
      create: 'New preset',
      createTitle: 'New preset',
      exportList: 'Export preset list',
      importList: 'Import preset list',
      exportSelectTitle: 'Choose presets to export',
      exportSelectHint: 'Check the presets to export; copy their basic info to the clipboard, or save their full info as a local JSON file.',
      exportCopy: 'Copy basic info',
      exportLocal: 'Export to local file',
      exportHint: 'Copied basic info (id / name / description) of {count} presets to the clipboard.',
      downloadHint: 'Exported {count} presets to a local JSON file.',
      downloadFailed: 'Export failed: {message}',
      exportEmpty: 'No preset to export yet.',
      exportFailed: 'Copy failed: {message}',
      importSelectTitle: 'Choose presets to import',
      importSelectHint: 'Check the presets to import; they are appended to the end of the list, and presets whose name already exists are renamed to “name (import N)”.',
      importConfirm: 'Import selected',
      importing: 'Importing…',
      importInvalid: 'Unsupported file format: choose a JSON file produced by “Export to local file”.',
      importFailed: 'Import failed: {message}',
      importHint: 'Imported {added} presets; {renamed} with an existing name were renamed automatically.',
      importHintPlain: 'Imported {count} presets.',
      importEmpty: 'The file contains no importable preset.',
      editTitle: 'Edit preset',
      loading: 'Loading…',
      empty: 'No custom preset yet',
      emptyHint: 'Create one to give it a prompt, injected skills and a tool scope.',
      name: 'Name',
      nameHint: 'Shown in the New Session preset roster.',
      descLabel: 'Description',
      descHint: 'One line describing what this mode does.',
      groupBasic: 'Basics',
      groupPrompt: 'Prompt',
      instructions: 'System prompt',
      instructionsHint: 'The preset\u2019s system prompt; empty falls back to the deployment persona (empty under \u201cCustom\u201d = no persona injected).',
      instructionMode: 'Injection',
      modeAppend: 'Prepend',
      modeComplete: 'Replace',
      modeCustom: 'Custom',
      modeAppendHint: 'Uses this text as the persona prefix (replacing the deployment persona) while keeping the rest of DSH\u2019s system prompt, such as tool guidance.',
      modeCompleteHint: 'Uses only this text, removing every other system-prompt section (including third-party contributions).',
      modeCustomHint: 'Uses this text as the persona and decides which prompt sections are injected from the checklist below: checked = kept, unchecked = blocked. DSH\u2019s own sections are no longer blocked by default; the preset\u2019s own persona sections are always kept.',
      groupContexts: 'Runtime context',
      contexts: 'Snapshot contributions',
      contextsHint: 'Pick which contributions the per-step “Current runtime context” snapshot may carry; unchecked ones stop being injected for this preset. Rows marked “required” are force-injected by DSH itself and cannot be turned off.',
      contextsRequiredTag: 'required · cannot disable',
      contextsForcedTag: 'force-suppressed by this preset',
      contextsForceUnavailable: 'this Host cannot force-suppress (it still injects)',
      contextsForceLabel: 'Advanced · force-suppress anyway (officially not allowed)',
      contextsForceWarn: 'DSH force-injects this row at three layers. The plugin fights back with two implementation-detail tricks — a same-name shadow plus an outer filter — which a DSH upgrade can silently void. Suppressing the working directory leaves the model without a sense of where it is and can make it guess wrong paths. Are you sure?',
      contextsForeignTag: 'third-party',
      contextsRuntimeRequiredTag: 'runtime-required',
      contextsNameSeparator: ', ',
      contextsRuntimeRequiredHint: 'The live prompt registry marks these entries as required (they are not in this plugin’s catalog): {names}. DSH restores them every step, so they stay checked and cannot be turned off.',
      contextsRegistryUnavailable: 'The live prompt registry could not be read, so this catalog comes from the table shipped with this plugin and may not match the running DSH build (required rows can be wrong).',
      sections: 'Injected prompt sections',
      sectionsHint: 'Check every prompt section this preset should inject; unchecked sections are removed for this preset. Rows marked \u201calways kept \u00b7 not blockable\u201d carry the preset\u2019s own prompt and are disabled by default; the advanced option below can force-block them.',
      sectionsRequiredTag: 'Always kept \u00b7 not blockable',
      sectionsSuppressedTag: 'Force-blocked by this preset',
      sectionsForceLabel: 'Advanced \u00b7 force-block this row (the official contract does not allow it)',
      sectionsForceHint: 'The persona section carries the prompt you wrote and is always kept by default; force-blocking it removes that text from the prompt.',
      sectionsRegistryUnavailable: 'The runtime section list could not be read; this catalog may be incomplete.',
      noSections: 'No prompt section is available to choose from.',
      sectionFilterPlaceholder: 'Filter sections: name',
      sectionFilterNone: 'No matching section',
      sectionFilterCount: '{shown}/{total} sections match',
      sectionsClearHint: 'Clearing the ordinary checks keeps only the preset\u2019s own persona sections.',
      contextsClearHint: 'Unchecking every optional row leaves only the required ones.',
      noContexts: 'No snapshot context contribution is available to choose from.',
      contextFilterPlaceholder: 'Filter contexts: name or description',
      contextFilterNone: 'No matching context',
      contextFilterCount: '{shown}/{total} contexts match',
      copy: 'Duplicate',
      copyDone: 'Duplicated as {name}.',
      copyFailed: 'Duplicate failed: {message}',
      inspectContexts: 'Snapshot contexts kept: {count}',
      inspectContextsBlocked: 'Snapshot contexts blocked: {count}',
      inspectContextsUnmanaged: 'This preset does not manage the snapshot (everything injected)',
      inspectContextsList: 'Snapshot contexts kept ({count})',
      inspectContextsBlockedList: 'Snapshot contexts blocked ({count})',
      groupSkills: 'Skills',
      skills: 'Injected skills',
      skillsHint: 'Skill whitelist: only checked skills enter this preset\u2019s Skill catalog and can be called; unchecked skills are invisible to this preset\u2019s model. Checking nothing = this preset has no skill.',
      skillsAll: 'Select source',
      skillsNone: 'Clear source',
      noSkills: 'No skill available',
      skillSource: 'Source: {source}',
      skillFilterPlaceholder: 'Filter skills: name or description',
      skillFilterNone: 'No matching skill',
      skillFilterCount: '{shown}/{total} skills match',
      groupTools: 'Tools',
      toolMode: 'Tool scope',
      modeAll: 'All',
      modeAllow: 'Allow list',
      modeDeny: 'Deny list',
      toolsHint: 'The list governs every tool of this preset: built-ins and global tools alike are narrowed, and a refused tool has its call refused too.',
      noTools: 'No tool to filter',
      toolFilterPlaceholder: 'Filter tools: name or description',
      toolFilterNone: 'No matching tool',
      toolFilterCount: '{shown}/{total} tools match',
      toolScopeGlobal: 'global',
      toolScopeBuiltin: 'built-in',
      selectedCount: '{count} selected',
      warnSkillsNeedToolTitle: 'The skill tool is kept automatically',
      warnSkillsNeedToolBody: 'Skills are managed apart from the tool list: checking any skill always keeps the skill tool, so the list cannot disable them.',
      groupInspect: 'Runtime check',
      inspectRun: 'Re-read',
      inspectRunning: 'Reading…',
      inspectAutoHint: 'Re-reads automatically on page entry and after every configuration change.',
      inspectDraftPreview: 'Preview: computed from the current edits; takes effect after saving',
      inspectSections: 'Prompt sections kept: {count}',
      inspectSectionsBlocked: 'Prompt sections blocked: {count}',
      inspectSectionsUnmanaged: 'This preset does not manage prompt sections (everything injected)',
      inspectSectionsList: 'Prompt sections kept ({count})',
      inspectSectionsBlockedList: 'Prompt sections blocked ({count})',
      inspectSectionsUnavailable: 'The runtime section list could not be read; the kept/blocked partition is unavailable.',
      inspectSurface: 'Inherited tool surface: {count}',
      inspectTools: 'Usable tools: {count}',
      inspectBlocked: 'Tools refused by the list: {count}',
      inspectSkills: 'Enabled skills: {count}',
      inspectSkillsOff: 'The skill tool is disabled, so no skill can load',
      inspectListedUnavailable: 'These names are in the list but not in this preset\u2019s inherited surface, so they cannot apply — usually a typo, or the plugin that provides them is not mounted in this preset.',
      inspectEmpty: 'This preset has no usable tool',
      inspectUnavailable: 'Runtime view unavailable: {reason}',
      inspectSaveFirst: 'Save the preset before reading its runtime view.',
      inspectToolsList: 'Usable tools ({count})',
      inspectBlockedList: 'Tools refused by the list ({count})',
      inspectSkillsList: 'Enabled skills ({count})',
      inspectSkillsMissingList: 'Skills missing from the catalogue ({count})',
      inspectListedUnavailableList: 'Listed tools outside the inherited surface ({count})',
      noSkillsRoots: 'Skills are discovered from these folders; drop a folder containing SKILL.md into one of them to make it appear here:',
      skillDiagUnavailable: 'The Host context exposes no skills service, so the catalogue cannot be read.',
      skillDiagEmpty: 'The registry answered with 0 skills.',
      skillDiagError: 'Reading the skill catalogue failed: {message}',
      stateOn: 'On',
      stateOff: 'Off',
      stateBroken: 'Broken',
      enable: 'Enable',
      disable: 'Disable',
      remove: 'Delete',
      close: 'Close',
      selectAll: 'Select all',
      clearSelection: 'Deselect all',
      cancel: 'Cancel',
      confirmShort: 'Delete?',
      confirmYes: 'Delete',
      save: 'Save',
      saved: 'Saved',
      saving: 'Saving…',
      registryMissing: 'Preset registry unavailable: edits will not take effect.',
      factPrompt: 'Prompt',
      factSkills: '{count} skills',
      factToolsAll: 'Tools: all',
      factToolsAllow: 'Tool: whitelist {count}',
      factToolsDeny: 'Tool: blacklist {count}',
      loadFailed: 'Load failed: {message}',
      saveFailed: 'Save failed: {message}',
      deleteFailed: 'Delete failed: {message}',
    }

    /**
     * Copy text to the clipboard: the async Clipboard API when available,
     * otherwise a throwaway textarea + `execCommand` (non-secure contexts).
     * @param text - the payload to place on the clipboard.
     * @returns resolves when the clipboard accepted the text; rejects otherwise.
     */
    async function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          return
        }
      } catch {
        // fall through to the legacy path below
      }
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.top = '-1000px'
      area.style.opacity = '0'
      document.body.appendChild(area)
      try {
        area.select()
        area.setSelectionRange(0, text.length)
        if (document.execCommand?.('copy') !== true) throw new Error('execCommand(copy)')
      } finally {
        area.remove()
      }
    }

    /**
     * Project the preset list onto the portable roster shape.
     * @param presets - the Host's preset rows.
     * @returns an array of `{ id, name, description }` in list order.
     */
    function toExportRoster(presets) {
      return (Array.isArray(presets) ? presets : []).map((preset) => ({
        id: String(preset?.id ?? ''),
        name: String(preset?.name ?? ''),
        description: String(preset?.description ?? ''),
      }))
    }

    /** Trim a JSON value into a string list, dropping non-strings. */
    function asStringList(value) {
      return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter((item) => item !== '')
        : []
    }

    /** The name key used to de-duplicate imports (trimmed, case-insensitive). */
    function presetNameKey(name) {
      return String(name ?? '').trim().toLowerCase()
    }

    /**
     * Project one preset onto the portable FULL info shape the local export
     * writes. Runtime identity and placement (`id`, `order`, timestamps,
     * `status`) stay behind: the Host mints a fresh id on import and appends
     * the preset, so carrying them would only invite collisions.
     * @param preset - a Host preset row.
     * @returns the portable object accepted by the import parser.
     */
    function toPortablePreset(preset) {
      const source = preset !== null && typeof preset === 'object' ? preset : {}
      const portable = {
        name: String(source.name ?? ''),
        description: String(source.description ?? ''),
        instructions: String(source.instructions ?? ''),
        instructionMode: ['append', 'complete', 'custom'].includes(source.instructionMode)
          ? source.instructionMode
          : 'append',
        skills: asStringList(source.skills),
        tools: {
          mode: ['all', 'allow', 'deny'].includes(source.tools?.mode) ? source.tools.mode : 'all',
          names: asStringList(source.tools?.names),
        },
        enabled: source.enabled !== false,
      }
      // PRESENT means the array is the whole truth, so an empty array must be
      // exported as-is (it suppresses every optional context). The same rule
      // applies to the advanced force-suppress list.
      if (Array.isArray(source.contexts)) portable.contexts = asStringList(source.contexts)
      if (Array.isArray(source.requiredSuppressed)) portable.requiredSuppressed = asStringList(source.requiredSuppressed)
      if (Array.isArray(source.sections)) portable.sections = asStringList(source.sections)
      if (Array.isArray(source.sectionsSuppressed))
        portable.sectionsSuppressed = asStringList(source.sectionsSuppressed)
      return portable
    }

    /**
     * Rows for the export dialog: the portable roster fields plus the full
     * payload the local file writes.
     * @param presets - the Host's preset rows.
     * @returns an array of `{ key, id, name, description, payload }`.
     */
    function toExportRows(presets) {
      return (Array.isArray(presets) ? presets : []).map((preset) => ({
        key: String(preset?.id ?? ''),
        id: String(preset?.id ?? ''),
        name: String(preset?.name ?? ''),
        description: String(preset?.description ?? ''),
        payload: toPortablePreset(preset),
      }))
    }

    /**
     * Normalize one imported object. Only known, portable fields survive;
     * `id`/`order`/`status` are deliberately ignored so every import becomes a
     * new preset at the end of the list.
     * @param input - one JSON entry.
     * @returns the save payload, or undefined when it carries no usable name.
     */
    function normalizeImportedPreset(input) {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name === '') return undefined
      const preset = {
        name,
        description: typeof input.description === 'string' ? input.description : '',
        instructions: typeof input.instructions === 'string' ? input.instructions : '',
        instructionMode: ['append', 'complete', 'custom'].includes(input.instructionMode)
          ? input.instructionMode
          : 'append',
        skills: asStringList(input.skills),
        tools: {
          mode: ['all', 'allow', 'deny'].includes(input.tools?.mode) ? input.tools.mode : 'all',
          names: asStringList(input.tools?.names),
        },
        enabled: input.enabled !== false,
      }
      if (Array.isArray(input.contexts)) preset.contexts = asStringList(input.contexts)
      if (Array.isArray(input.requiredSuppressed)) preset.requiredSuppressed = asStringList(input.requiredSuppressed)
      if (Array.isArray(input.sections)) preset.sections = asStringList(input.sections)
      if (Array.isArray(input.sectionsSuppressed)) preset.sectionsSuppressed = asStringList(input.sectionsSuppressed)
      return preset
    }

    /**
     * Parse an uploaded file into picker rows. A JSON array is the expected
     * shape; an object with a `presets` array is tolerated so a hand-wrapped
     * export still imports. Malformed JSON, a non-array shape, or a file with
     * no usable preset yields `undefined` — the caller alerts the user.
     * @param text - the file's UTF-8 text.
     * @returns rows `{ key, name, description, payload }`, or undefined.
     */
    function parseImportedPresets(text) {
      let parsed
      try {
        // A UTF-8 BOM is common in Windows-authored files and JSON.parse
        // rejects it, so strip it before parsing.
        parsed = JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''))
      } catch {
        return undefined
      }
      const list = Array.isArray(parsed)
        ? parsed
        : parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.presets)
          ? parsed.presets
          : undefined
      if (list === undefined) return undefined
      const rows = []
      list.forEach((entry, index) => {
        const payload = normalizeImportedPreset(entry)
        if (payload === undefined) return
        // Duplicates inside the file are kept: the page renames every name
        // that is already taken, so two same-name entries both import as
        // `原名（导入 1）` / `原名（导入 2）` instead of one being dropped.
        rows.push({
          key: `import-${index}`,
          name: payload.name,
          description: payload.description,
          payload,
        })
      })
      return rows.length === 0 ? undefined : rows
    }

    /** Read a picked file as text, with a FileReader fallback for old WebViews. */
    async function readFileText(file) {
      if (file !== null && typeof file?.text === 'function') return await file.text()
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(reader.error ?? new Error('FileReader'))
        reader.readAsText(file)
      })
    }

    /** A timestamped, filesystem-safe name for the local export. */
    function exportFileName() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      return `agent-presets-${stamp}.json`
    }

    /** Download one JSON payload through a throwaway anchor. */
    function downloadJsonFile(fileName, value) {
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      try {
        anchor.click()
      } finally {
        anchor.remove()
        // Revoke on the next task: some browsers cancel a download whose URL
        // disappears in the same task as the click.
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
    }

    /** Bound dictionary resolver; `apply` rebinds it to the locale service. */
    let T = (key) => zh[key] ?? key

    /** Replace `{name}` placeholders in a template. */
    function format(template, params) {
      return String(template ?? '').replace(/\{(\w+)\}/g, (whole, key) =>
        params !== null && typeof params === 'object' && key in params ? String(params[key]) : whole,
      )
    }

    /** Call one Host endpoint, returning its `value` or throwing its message. */
    async function callApi(name, body) {
      const response = await fetch(`${API_PREFIX}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
        throw new Error(payload?.error?.message ?? `HTTP ${response.status}`)
      }
      return payload.value
    }

    /**
     * Re-apply the editor's unsaved selection on the Host's answer locally.
     *
     * The Host applies the dry-run `config` override itself when it knows the
     * parameter (result carries `draft: true`). A Host that predates it answers
     * from the STORED selection — but its tools/blockedTools partition the
     * inherited surface, so the surface can be rebuilt and the editor's
     * selection re-applied here. The panel then follows the edits on any Host
     * version; saving is still what makes them take effect at runtime.
     * Missing skills cannot be recomputed locally (the catalogue is Host-side),
     * so they are kept, narrowed to the skills the draft still checks.
     * @param view - the Host's answer for this preset.
     * @param selection - the editor's `{ mode, names }`.
     * @param skills - the editor's checked skill names.
     * @returns the view, recomputed from the draft when the Host ignored it.
     */
    function previewSelection(view, selection, skills) {
      if (view === null || typeof view !== 'object' || view.available !== true || view.draft === true) return view
      const surface = new Set([...(view.tools ?? []), ...(view.blockedTools ?? [])])
      if (surface.size === 0) return view
      const listed = new Set(selection.names)
      // Mirror the Host's rule: a checked skill always keeps the skill tool.
      if (selection.mode === 'allow' && skills.length > 0) listed.add('skill')
      const tools = []
      const blocked = []
      for (const name of surface) {
        if (selection.mode === 'allow') (listed.has(name) ? tools : blocked).push(name)
        else if (selection.mode === 'deny') (listed.has(name) ? blocked : tools).push(name)
        else tools.push(name)
      }
      return {
        ...view,
        draft: true,
        mode: selection.mode,
        listed: [...listed].sort(),
        tools: tools.sort(),
        blockedTools: selection.mode === 'all' ? [] : blocked.sort(),
        surfaceCount: surface.size,
        listedUnavailable: [...listed].filter((name) => surface.has(name) === false).sort(),
        skills: [...skills].sort(),
        missingSkills: (view.missingSkills ?? []).filter((name) => skills.includes(name)),
      }
    }

    /** A fresh, empty preset draft. */
    function blankPreset() {
      return {
        id: '',
        name: '',
        description: '',
        instructions: '',
        instructionMode: 'append',
        // LEFT UNDEFINED on purpose. `undefined` means "this preset does not
        // manage the snapshot", which is exactly what an unopened snapshot list
        // should stay: a NEW preset gets the fully-checked default from the
        // Host, and saving an old preset whose list was never touched keeps the
        // runtime behaving as it does today. Only an edit of this area turns it
        // into an array, and an array is then the strict whitelist.
        contexts: undefined,
        // LEFT UNDEFINED for the same reason: absent = this preset does not
        // manage prompt sections, so every section injects and the editor shows
        // the fully-checked list. Only editing this area turns it into an array.
        sections: undefined,
        skills: [],
        tools: { mode: 'all', names: [] },
        enabled: true,
        order: 0,
      }
    }

    /**
     * The name a copy of `source` should take, given every existing name.
     *
     * One unified rule, whatever the source is already called: `（复制 N）`,
     * starting at 1. A copy of a copy therefore stacks the suffix
     * (`XX（复制 1）` → `XX（复制 1）（复制 1）`) rather than trying to parse and
     * re-number its tail, and the scan covers DISABLED presets too — an off
     * preset still occupies its name in the roster.
     * @param source - the preset being duplicated.
     * @param taken - a set-like predicate over existing names.
     * @returns the next free display name.
     */
    function suffixedName(source, suffix, taken) {
      const base = String(source?.name ?? '').trim()
      let index = 1
      let candidate = `${base}（${suffix} ${index}）`
      while (taken(candidate)) {
        index += 1
        candidate = `${base}（${suffix} ${index}）`
      }
      return candidate
    }

    /** The duplicate action's suffix (`（复制 N）`). */
    function copyName(source, taken) {
      return suffixedName(source, '复制', taken)
    }

    /** The import action's suffix (`（导入 N）`), used only on name conflicts. */
    function importName(source, taken) {
      return suffixedName(source, '导入', taken)
    }

    /** One label + control + hint row, matching the host settings form. */
    function Field(props) {
      return h(
        'div',
        { className: 'aps-field' },
        h(
          'div',
          { className: 'aps-fieldHead' },
          h('span', { className: 'aps-label' }, props.label),
          props.aside ?? null,
        ),
        props.children,
        props.hint === undefined ? null : h('p', { className: 'aps-hint' }, props.hint),
        // A concrete case, visually set apart from the rule: "how do I fill
        // several of these?" is the question a bare rule cannot answer.
        props.example === undefined ? null : h('p', { className: 'aps-example' }, props.example),
      )
    }

    /**
     * The prompt-section checklist state one draft presents.
     *
     * `checked` is what the runtime injects: an UNMANAGED preset (absent
     * `sections`) shows every optional row checked, a managed one follows its
     * array. `forced` is the ADVANCED persona force-block list — the only way
     * to remove a required row, because those rows carry the prompt text the
     * user authored for this preset.
     * @param preset - the draft or stored preset.
     * @param catalog - the Host's section catalog rows.
     * @returns `{ checked, forced, optional }`.
     */
    function sectionSelectionState(preset, catalog) {
      const rows = Array.isArray(catalog) ? catalog : []
      const requiredRows = rows.filter((row) => row.required === true)
      const optionalNames = rows.filter((row) => row.required !== true).map((row) => row.name)
      const forced = Array.isArray(preset?.sectionsSuppressed)
        ? requiredRows.map((row) => row.name).filter((name) => preset.sectionsSuppressed.includes(name))
        : []
      const optionalChecked = Array.isArray(preset?.sections)
        ? preset.sections.filter((name) => optionalNames.includes(name))
        : optionalNames
      const requiredOn = requiredRows
        .map((row) => row.name)
        .filter((name) => forced.includes(name) === false)
      return { checked: [...new Set([...optionalChecked, ...requiredOn])], forced, optional: optionalNames }
    }

    /**
     * The optional-only keep list a draft should persist.
     *
     * Required names are written to neither half unless they are force-blocked,
     * so the stored arrays carry exactly the decisions the user made. Both
     * arrays are deliberately not filtered against the shipped catalog: the
     * page saves what it showed, and a section that disappears from the build
     * simply becomes invisible until it comes back.
     * @param preset - the draft or stored preset.
     * @param catalog - the Host's section catalog rows.
     * @returns the optional names that inject.
     */
    function sectionWhitelistOf(preset, catalog) {
      const optionalNames = (Array.isArray(catalog) ? catalog : [])
        .filter((row) => row.required !== true)
        .map((row) => row.name)
      return sectionSelectionState(preset, catalog).checked.filter((name) => optionalNames.includes(name))
    }

    /**
     * The prompt-section checklist — one checkbox row per live section.
     *
     * Deliberately the same construction as {@link ContextPicker}: the row
     * markup, the 全选 / 取消全选 `aps-linkButton` pair acting on the visible
     * optional rows, the 已选 count, and checked-first ordering all come from
     * the same classes, so the two lists read as one page. Checked = injected.
     *
     * A required row (the preset's own persona sections) shows checked and
     * DISABLED; its ADVANCED force-box is the only control that may remove it.
     * @param props - rows, selection, and change hooks.
     * @returns the checklist element.
     */
    function SectionPicker(props) {
      const t = props.t
      const rows = props.rows ?? []
      const checked = props.checked ?? []
      const forced = props.forced ?? []
      const [orderBasis, setOrderBasis] = useState(() => [...checked])
      // Same filter box the tool checklist carries: one keyword matched against
      // the row name (a section row has no description), with the visible set
      // re-ranked against the live selection whenever the keyword changes.
      const [filter, setFilter] = useState('')
      if (rows.length === 0) return h('p', { className: 'aps-hint' }, t('noSections'))
      const filterKey = filter.trim().toLowerCase()
      const visibleRows =
        filterKey === ''
          ? rows
          : rows.filter((row) => String(row.name ?? '').toLowerCase().includes(filterKey))
      const ranked = [...visibleRows].sort((left, right) => {
        const leftRank = orderBasis.includes(left.name) ? 0 : 1
        const rightRank = orderBasis.includes(right.name) ? 0 : 1
        return leftRank - rightRank || left.name.localeCompare(right.name)
      })
      // Two optional halves: `optional` is every optional row (the keep list a
      // bulk action may write), `visibleOptional` only what the filter left
      // shown (the rows a bulk action may move) — so a keyword never clears a
      // hidden row's decision.
      const optional = rows.filter((row) => row.required !== true).map((row) => row.name)
      const visibleOptional = ranked.filter((row) => row.required !== true).map((row) => row.name)
      // `checked` also carries the required rows that currently inject; the two
      // bulk actions move only the optional half, so required names are
      // narrowed out here rather than relying on the caller to drop them.
      const writeOptional = (next) => props.onChange(next.filter((name) => optional.includes(name)))
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'aps-filter aps-sectionFilter' },
          h('input', {
            className: 'aps-input',
            type: 'search',
            value: filter,
            placeholder: t('sectionFilterPlaceholder'),
            'aria-label': t('sectionFilterPlaceholder'),
            onChange: (event) => {
              setFilter(event.target.value)
              // A new keyword re-shuffles the visible set, so re-rank it
              // against the current selection.
              setOrderBasis([...checked])
            },
          }),
          filterKey === ''
            ? null
            : h(
                'p',
                { className: 'aps-hint' },
                format(t('sectionFilterCount'), { shown: ranked.length, total: rows.length }),
              ),
        ),
        // Select-all / deselect-all act on the SHOWN rows only: with a filter
        // active they touch what the filter left visible and never the hidden
        // rest — the same rule the tool checklist follows.
        ranked.length === 0
          ? null
          : h(
              'div',
              { className: 'aps-inlineActions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'aps-linkButton',
                  onClick: () => writeOptional([...checked, ...visibleOptional]),
                },
                t('selectAll'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'aps-linkButton',
                  onClick: () => writeOptional(checked.filter((name) => visibleOptional.includes(name) === false)),
                },
                t('clearSelection'),
              ),
              h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: checked.length })),
            ),
        props.registryReadable === false
          ? h('p', { className: 'aps-hint' }, t('sectionsRegistryUnavailable'))
          : null,
        ranked.length === 0
          ? h('p', { className: 'aps-hint' }, t('sectionFilterNone'))
          : h(
              'div',
              { className: 'aps-checklist' },
              ranked.map((row) =>
                h('div', { key: row.name },
                  h(
                    'label',
                    { className: 'aps-checkRow' },
                    h('input', {
                      type: 'checkbox',
                      // A required row reports whether it INJECTS — false once the
                      // force-box below removes it; it stays disabled because this
                      // box is a readout, not the control.
                      checked:
                        row.required !== true
                          ? checked.includes(row.name)
                          : forced.includes(row.name) === false,
                      disabled: row.required === true,
                      onChange: () => props.onToggle(row.name),
                    }),
                    h(
                      'span',
                      { className: 'aps-checkBody' },
                      h('span', { className: 'aps-rowName' }, row.name),
                      // The same `aps-fact` pill the context list uses for its
                      // required rows: a section name is a technical identifier, and
                      // the pill is what says why it cannot be unchecked.
                      row.required !== true
                        ? null
                        : h(
                            'span',
                            { className: 'aps-rowMeta' },
                            h('span', { className: 'aps-fact' }, t('sectionsRequiredTag')),
                            forced.includes(row.name)
                              ? h('span', { className: 'aps-fact' }, t('sectionsSuppressedTag'))
                              : null,
                          ),
                    ),
                  ),
                  // The opt-in escape hatch, offered exactly where the runtime
                  // protects a name: a required persona row.
                  row.required !== true
                    ? null
                    : h(
                        'label',
                        { className: 'aps-checkRow aps-checkNested' },
                        h('input', {
                          type: 'checkbox',
                          checked: forced.includes(row.name),
                          onChange: () => props.onToggleForce(row.name),
                        }),
                        h(
                          'span',
                          { className: 'aps-checkBody' },
                          // The control names its row: every required row gets one
                          // of these, and without the name the operator cannot tell
                          // which persona section they are about to remove.
                          h('span', { className: 'aps-rowMeta' }, `${t('sectionsForceLabel')} · ${row.name}`),
                          forced.includes(row.name) ? h('span', { className: 'aps-warn' }, t('sectionsForceHint')) : null,
                        ),
                      ),
                ),
            ),
        ),
        h('p', { className: 'aps-hint' }, t('sectionsClearHint')),
      )
    }

    /** Host-styled segmented control. */
    function Segmented(props) {
      return h(
        'div',
        { className: 'aps-seg', role: 'group', 'aria-label': props.label },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              className: 'aps-segItem',
              'aria-pressed': props.value === option.value ? 'true' : 'false',
              onClick: () => props.onChange(option.value),
            },
            option.label,
          ),
        ),
      )
    }

    /** One collapsible second-level menu. */
    function Disclosure(props) {
      return h(
        'div',
        { className: 'aps-disc' },
        h(
          'button',
          {
            type: 'button',
            className: 'aps-discHead',
            'aria-expanded': props.open ? 'true' : 'false',
            onClick: props.onToggle,
          },
          h('span', { className: 'aps-discCaret' }, props.open ? '\u25bc' : '\u25b6'),
          h('span', { className: 'aps-discTitle' }, props.title),
          h('span', { className: 'aps-discCount' }, String(props.count)),
        ),
        props.open ? h('div', { className: 'aps-discBody' }, props.children) : null,
      )
    }

    /** Multi-select checklist of named options. */
    function Checklist(props) {
      const selected = props.selected ?? []
      if (props.options.length === 0) return h('p', { className: 'aps-hint' }, props.emptyLabel)
      return h(
        'div',
        { className: 'aps-checklist' },
        props.options.map((option) => {
          const checked = selected.includes(option.name)
          return h(
            'label',
            { key: option.name, className: 'aps-checkRow' },
            h('input', {
              type: 'checkbox',
              checked,
              onChange: () => props.onToggle(option.name),
            }),
            h(
              'span',
              { className: 'aps-checkBody' },
              h(
                'span',
                { className: 'aps-checkName' },
                option.name,
                // A global tool is hideable by `restrict()`; an inherited
                // built-in is narrowed at call time. Show which one it is.
                typeof option.global === 'boolean' && props.t
                  ? h(
                      'span',
                      { className: 'aps-fact' },
                      props.t(option.global ? 'toolScopeGlobal' : 'toolScopeBuiltin'),
                    )
                  : null,
              ),
              option.description ? h('span', { className: 'aps-checkDesc' }, option.description) : null,
            ),
          )
        }),
      )
    }

    /** Skills grouped by discovery source: one second-level menu per source. */
    function SkillGroupPicker(props) {
      const t = props.t
      const selected = props.selected ?? []
      const groups = props.groups ?? []
      // A filter is pure view state: it never touches the draft, so it never
      // triggers the auto-inspect. It must be declared before the empty-
      // catalogue early return below, or React hook order would break.
      const [filter, setFilter] = useState('')
      // Rows keep the order they were built with: sorting on the LIVE selection
      // would lift a row to the top the moment its box is ticked, sliding the
      // next row out from under the pointer. The basis refreshes when the
      // filter changes (the visible set is re-shuffled anyway) and on mount —
      // i.e. the next time the editor opens after a save.
      const [orderBasis, setOrderBasis] = useState(() => [...selected])
      const filterKey = filter.trim().toLowerCase()
      if (groups.length === 0) {
        // An empty catalogue needs a reason and a destination: say whether the
        // registry answered at all, and name the folders skills are found in.
        const diag = props.diag ?? {}
        const roots = props.roots ?? []
        const reason =
          diag.available === false
            ? t('skillDiagUnavailable')
            : typeof diag.error === 'string' && diag.error !== ''
              ? format(t('skillDiagError'), { message: diag.error })
              : format(t('skillDiagEmpty'), {})
        return h(
          'div',
          { className: 'aps-warnBlock' },
          h('p', { className: 'aps-warnBody' }, t('noSkills')),
          h('p', { className: 'aps-warnBody' }, reason),
          roots.length > 0
            ? h(
                'div',
                null,
                h('p', { className: 'aps-warnBody' }, t('noSkillsRoots')),
                h(
                  'ul',
                  { className: 'aps-nameList' },
                  roots.map((root) => h('li', { key: root.key }, root.path)),
                ),
              )
            : null,
        )
      }
      const setSelected = (next) => props.onChange([...new Set(next)])
      const toggle = (name) => {
        setSelected(selected.includes(name) ? selected.filter((entry) => entry !== name) : [...selected, name])
      }
      // Filter groups down to the matching skills and drop the empty ones;
      // the filtered groups also drive the header counts and the select-all /
      // clear buttons, so what the user sees is exactly what those act on.
      // Within every group checked-then-name ordering is applied ONCE, against
      // `orderBasis`, so toggling a box never reorders the rows mid-session.
      const matches = (skill) =>
        filterKey === '' ||
        String(skill.name ?? '').toLowerCase().includes(filterKey) ||
        String(skill.description ?? '').toLowerCase().includes(filterKey)
      const byCheckedThenName = (left, right) => {
        const leftRank = orderBasis.includes(left.name) ? 0 : 1
        const rightRank = orderBasis.includes(right.name) ? 0 : 1
        return leftRank - rightRank || String(left.name).localeCompare(String(right.name))
      }
      const viewGroups = groups
        .map((group) => ({ ...group, skills: (group.skills ?? []).filter(matches).sort(byCheckedThenName) }))
        .filter((group) => filterKey === '' || group.skills.length > 0)
      const visibleCount = viewGroups.reduce((sum, group) => sum + group.skills.length, 0)
      const totalCount = groups.reduce((sum, group) => sum + (group.skills ?? []).length, 0)
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'aps-filter' },
          h('input', {
            className: 'aps-input',
            type: 'search',
            value: filter,
            placeholder: t('skillFilterPlaceholder'),
            'aria-label': t('skillFilterPlaceholder'),
            onChange: (event) => {
              setFilter(event.target.value)
              // A new keyword re-shuffles the visible set, so re-rank it against
              // the current selection instead of the one the list opened with.
              setOrderBasis([...selected])
            },
          }),
          filterKey !== ''
            ? h('p', { className: 'aps-hint' }, format(t('skillFilterCount'), { shown: visibleCount, total: totalCount }))
            : null,
        ),
        // Filtering auto-expands every group that still has a match — the
        // user would otherwise search, then click each menu open by hand.
        // Clearing the filter restores the manually managed open state.
        viewGroups.length === 0
          ? h('p', { className: 'aps-hint' }, t('skillFilterNone'))
          : viewGroups.map((group) =>
              h(
                Disclosure,
                {
                  key: group.key,
                  title: format(t('skillSource'), { source: group.label }),
                  count: `${group.skills.filter((skill) => selected.includes(skill.name)).length}/${group.skills.length}`,
                  open: filterKey !== '' || props.openGroups.includes(group.key),
                  onToggle: () => props.onToggleGroup(group.key),
                },
                h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'aps-inlineActions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'aps-linkButton',
                        onClick: () => setSelected([...selected, ...group.skills.map((skill) => skill.name)]),
                      },
                      t('skillsAll'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'aps-linkButton',
                        onClick: () =>
                          setSelected(selected.filter((name) => !group.skills.some((skill) => skill.name === name))),
                      },
                      t('skillsNone'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'aps-rowList' },
                    group.skills.map((skill) =>
                      h(
                        'label',
                        { key: skill.name, className: 'aps-row' },
                        h('input', {
                          type: 'checkbox',
                          checked: selected.includes(skill.name),
                          onChange: () => toggle(skill.name),
                        }),
                        h(
                          'span',
                          { className: 'aps-rowBody' },
                          h('span', { className: 'aps-rowName' }, skill.name),
                          skill.description ? h('span', { className: 'aps-rowMeta' }, skill.description) : null,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
      )
    }

    /**
     * A titled, scrollable list of exact names — counts alone hide the details.
     * @param props.forced - names to tag: a suppressed contribution the registry
     *   marks required came here through the opt-in escape hatch, and a bare
     *   name in a "blocked" list would otherwise read like an ordinary choice.
     */
    function NameList(props) {
      const names = props.names ?? []
      const forced = props.forced ?? []
      if (names.length === 0) return null
      return h(
        'div',
        { className: 'aps-nameListBlock' },
        h('p', { className: 'aps-nameListTitle' }, format(props.title, { count: names.length })),
        h(
          'ul',
          { className: 'aps-nameList' },
          names.map((name) =>
            h(
              'li',
              { key: name },
              name,
              forced.includes(name) ? h('span', { className: 'aps-fact' }, props.t('contextsForcedTag')) : null,
            ),
          ),
        ),
      )
    }

    /** The runtime view of one saved preset, read through the scope lease. */
    function InspectPanel(props) {
      const t = props.t
      const view = props.view
      // The section checklist is part of the runtime view: the Host partitions
      // live sections against the DRAFT keep list, so the panel shows that
      // partition next to the tool and context counts. Append/replace never
      // filter sections, so the block is silent there. An answer without
      // `sectionFilter` renders nothing rather than claiming 0.
      const sectionFilter = props.custom === true ? view?.sectionFilter : undefined
      return h(
        'div',
        { className: 'aps-inspect' },
        h(
          'div',
          { className: 'aps-inspectHead' },
          h(
            'button',
            {
              type: 'button',
              className: 'aps-btn',
              disabled: props.busy || props.unsaved,
              onClick: props.onRun,
            },
            props.busy ? t('inspectRunning') : t('inspectRun'),
          ),
          props.unsaved ? h('span', { className: 'aps-hint' }, t('inspectSaveFirst')) : h('span', { className: 'aps-hint' }, t('inspectAutoHint')),
          // A dry-run answer is computed from the editor's current edits, so
          // the counts below may differ from the last save until it is saved.
          view?.draft === true ? h('span', { className: 'aps-hint' }, t('inspectDraftPreview')) : null,
        ),
        view === null
          ? null
          : view.available === false
            ? h('p', { className: 'aps-error' }, format(t('inspectUnavailable'), { reason: view.reason ?? '' }))
            : h(
                'div',
                null,
                h(
                  'div',
                  { className: 'aps-inspectCount' },
                  h(
                    'span',
                    { className: 'aps-fact' },
                    format(t('inspectSurface'), { count: view.surfaceCount ?? (view.tools ?? []).length }),
                  ),
                  h(
                    'span',
                    { className: 'aps-fact' },
                    format(t('inspectTools'), { count: (view.tools ?? []).length }),
                  ),
                  (view.blockedTools ?? []).length > 0
                    ? h(
                        'span',
                        { className: 'aps-fact' },
                        format(t('inspectBlocked'), { count: view.blockedTools.length }),
                      )
                    : null,
                  h(
                    'span',
                    { className: 'aps-fact' },
                    format(t('inspectSkills'), { count: (view.skills ?? []).length }),
                  ),
                  // The snapshot partition, read the same way the runtime
                  // listener computes it, so the panel and the prompt agree.
                  // Absent from the answer = the Host did not report it, so
                  // nothing is claimed: a "0 kept" here would read as a total
                  // block the runtime never applied.
                  view.contexts === undefined
                    ? null
                    : view.contextsManaged === false
                      ? h('span', { className: 'aps-fact' }, t('inspectContextsUnmanaged'))
                      : h(
                          'span',
                          { className: 'aps-fact' },
                          format(t('inspectContexts'), { count: (view.contexts ?? []).length }),
                        ),
                  (view.blockedContexts ?? []).length > 0
                    ? h(
                        'span',
                        { className: 'aps-fact' },
                        format(t('inspectContextsBlocked'), { count: view.blockedContexts.length }),
                      )
                    : null,
                  (view.tools ?? []).length === 0 ? h('p', { className: 'aps-hint' }, t('inspectEmpty')) : null,
                  view.skillsToolAvailable === false && (view.skills ?? []).length === 0
                    ? h('p', { className: 'aps-hint' }, t('inspectSkillsOff'))
                    : null,
                ),
                // The section partition, shown with the same fact chips as
                // the tool and context counts. `managed: false` is the honest
                // "everything injects" answer an untouched preset produces;
                // an unreadable registry says so instead of claiming 0.
                sectionFilter === undefined
                  ? null
                  : h(
                      'div',
                      { className: 'aps-inspectCount' },
                      sectionFilter.available === false
                        ? h('span', { className: 'aps-fact' }, t('inspectSectionsUnavailable'))
                        : sectionFilter.managed === false
                          ? h('span', { className: 'aps-fact' }, t('inspectSectionsUnmanaged'))
                          : h(
                              'span',
                              { className: 'aps-fact' },
                              format(t('inspectSections'), { count: sectionFilter.kept ?? 0 }),
                            ),
                      sectionFilter.available === true &&
                      sectionFilter.managed === true &&
                      (sectionFilter.blocked ?? 0) > 0
                        ? h(
                            'span',
                            { className: 'aps-fact' },
                            format(t('inspectSectionsBlocked'), { count: sectionFilter.blocked }),
                          )
                        : null,
                    ),
                // The names behind the counts, in the same scrollable list as
                // tools and contexts: a count alone cannot tell an operator
                // whether the section they meant to block actually moved.
                sectionFilter === undefined ||
                sectionFilter.available !== true ||
                sectionFilter.managed !== true ||
                (sectionFilter.blocked ?? 0) === 0
                  ? null
                  : h(NameList, {
                      title: t('inspectSectionsBlockedList'),
                      names: sectionFilter.blockedList,
                    }),
                sectionFilter === undefined || sectionFilter.available !== true
                  ? null
                  : h(NameList, {
                      title: t('inspectSectionsList'),
                      names: sectionFilter.keptList,
                    }),
                (view.listedUnavailable ?? []).length > 0
                  ? h(
                      'div',
                      { className: 'aps-warnBlock' },
                      // The card heading uses the SAME wording as every list
                      // below it (`inspectListedUnavailableList`), with the
                      // sentence that explains the consequence under it — one
                      // vocabulary for the summary, the headings and the card.
                      h(
                        'div',
                        { className: 'aps-warnTitle' },
                        format(t('inspectListedUnavailableList'), { count: view.listedUnavailable.length }),
                      ),
                      h('p', { className: 'aps-hint' }, t('inspectListedUnavailable')),
                      h(
                        'ul',
                        { className: 'aps-nameList' },
                        view.listedUnavailable.map((name) => h('li', { key: name }, name)),
                      ),
                    )
                  : null,
                h(NameList, { title: t('inspectToolsList'), names: view.tools }),
                h(NameList, { title: t('inspectBlockedList'), names: view.blockedTools }),
                h(NameList, { title: t('inspectSkillsList'), names: view.skills }),
                h(NameList, { title: t('inspectSkillsMissingList'), names: view.missingSkills }),
                h(NameList, { title: t('inspectContextsList'), names: view.contexts }),
                h(NameList, {
                  title: t('inspectContextsBlockedList'),
                  names: view.blockedContexts,
                  forced: view.forcedContexts ?? [],
                  t,
                }),
              ),
      )
    }

    /** The list card of one custom preset. */
    function PresetCard(props) {
      const t = props.t
      const preset = props.preset
      const status = preset.status ?? {}
      const broken = typeof status.broken === 'string' && status.broken !== ''
      const off = preset.enabled === false
      const confirming = props.confirming === true
      const facts = []
      if (preset.instructions.trim() !== '') facts.push(t('factPrompt'))
      if ((preset.skills ?? []).length > 0) facts.push(format(t('factSkills'), { count: preset.skills.length }))
      const tools = preset.tools ?? { mode: 'all', names: [] }
      if (tools.mode === 'allow') facts.push(format(t('factToolsAllow'), { count: tools.names.length }))
      else if (tools.mode === 'deny') facts.push(format(t('factToolsDeny'), { count: tools.names.length }))
      else facts.push(t('factToolsAll'))
      return h(
        'li',
        { className: `aps-card${broken ? ' aps-cardBroken' : ''}${off ? ' aps-cardOff' : ''}` },
        h(
          'button',
          {
            type: 'button',
            className: 'aps-cardMain',
            onClick: () => props.onEdit(preset),
            disabled: props.busy,
          },
          h(
            'div',
            { className: 'aps-cardHead' },
            h('span', { className: 'aps-cardName' }, preset.name),
            broken
              ? h('span', { className: 'aps-pill aps-pillError', title: String(status.broken) }, t('stateBroken'))
              : null,
            h(
              'span',
              { className: `aps-pill${off ? ' aps-pillQuiet' : ''}` },
              off ? t('stateOff') : t('stateOn'),
            ),
          ),
          h(
            'p',
            { className: 'aps-cardDesc' },
            preset.description !== '' ? preset.description : preset.instructions.trim().split('\n')[0] || '\u2014',
          ),
          facts.length === 0
            ? null
            : h(
                'div',
                { className: 'aps-cardFacts' },
                facts.map((fact) => h('span', { key: fact, className: 'aps-fact' }, fact)),
              ),
        ),
        h(
          'div',
          { className: 'aps-cardFoot' },
          confirming
            ? [
                h('span', { key: 'ask', className: 'aps-cardFootAsk' }, t('confirmShort')),
                h(
                  'button',
                  {
                    key: 'cancel',
                    type: 'button',
                    className: 'aps-iconButton',
                    disabled: props.busy,
                    onClick: props.onCancelDelete,
                  },
                  t('cancel'),
                ),
                h(
                  'button',
                  {
                    key: 'confirm',
                    type: 'button',
                    className: 'aps-iconButton aps-iconButtonDanger',
                    disabled: props.busy,
                    onClick: () => props.onRemove(preset),
                  },
                  t('confirmYes'),
                ),
              ]
            : [
                h('span', { key: 'id', className: 'aps-cardFootId', title: preset.id }, preset.id),
                h(
                  'button',
                  {
                    key: 'toggle',
                    type: 'button',
                    className: 'aps-iconButton',
                    disabled: props.busy,
                    onClick: () => props.onToggle(preset),
                  },
                  off ? t('enable') : t('disable'),
                ),
                // Duplicate sits right after the enable/disable it follows in
                // the footer, uses the same aps-iconButton text style as its
                // neighbours, and is offered whatever the preset's own state.
                h(
                  'button',
                  {
                    key: 'duplicate',
                    type: 'button',
                    className: 'aps-iconButton',
                    disabled: props.busy,
                    onClick: () => props.onDuplicate(preset),
                  },
                  t('copy'),
                ),
                h(
                  'button',
                  {
                    key: 'remove',
                    type: 'button',
                    className: 'aps-iconButton aps-iconButtonDanger',
                    disabled: props.busy,
                    onClick: props.onAskDelete,
                  },
                  t('remove'),
                ),
              ],
        ),
      )
    }

    /**
     * The shared picker dialog behind export and import: check rows, run one
     * footer action per configured button.
     *
     * Its chrome is the shell's own `Modal`/`Button` primitives — the same
     * dialog surface every other DSH dialog uses — while the rows reuse the
     * page's own list styling, so both flows look like one component. An
     * action runs here; a failure stays in the dialog, a success lets the
     * action's `done` hook close it and let the page show the notice.
     * @param props - `{ t, title, hint, empty, rows, actions, onClose }`; each
     *   action is `{ key, label, busyLabel?, primary?, failText, run, done? }`.
     * @returns the open dialog element.
     */
    function PresetSelectDialog(props) {
      const t = props.t
      const rows = props.rows
      // Everything is checked by default: a deselection is cheaper than
      // re-picking each row for the common "all of them" case.
      const [selected, setSelected] = useState(() => new Set(rows.map((row) => row.key)))
      const [busy, setBusy] = useState(false)
      const [running, setRunning] = useState('')
      const [error, setError] = useState('')
      // An action in flight owns the dialog: it cannot be closed under itself.
      const close = () => {
        if (busy === false) props.onClose()
      }
      const shownKeys = rows.map((row) => row.key)
      const chosen = rows.filter((row) => selected.has(row.key))
      const toggle = (key) => {
        const next = new Set(selected)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        setSelected(next)
      }
      const trigger = async (action) => {
        setBusy(true)
        setRunning(action.key)
        setError('')
        let result
        try {
          result = await action.run(chosen)
        } catch (err) {
          setError(format(action.failText, { message: String(err?.message ?? err) }))
          setBusy(false)
          setRunning('')
          return
        }
        setBusy(false)
        setRunning('')
        if (typeof action.done === 'function') action.done(result, chosen)
      }
      const body =
        rows.length === 0
          ? h('p', { className: 'aps-hint' }, props.empty)
          : h(
              'div',
              null,
              // Same single-row scaffold as the tool / context checklists: the
              // two bulk actions sit on the left and the count is pushed to the
              // right by `.aps-inlineActions .aps-hint`, so nothing wraps.
              h(
                'div',
                { className: 'aps-inlineActions' },
                h(
                  'button',
                  { type: 'button', className: 'aps-linkButton', disabled: busy, onClick: () => setSelected(new Set(shownKeys)) },
                  t('selectAll'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'aps-linkButton', disabled: busy, onClick: () => setSelected(new Set()) },
                  t('clearSelection'),
                ),
                h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: chosen.length })),
              ),
              h(
                'div',
                { className: 'aps-checklist' },
                h(
                  'div',
                  { className: 'aps-rowList' },
                  rows.map((row) =>
                    h(
                      'label',
                      { key: row.key, className: 'aps-row' },
                      h('input', { type: 'checkbox', checked: selected.has(row.key), disabled: busy, onChange: () => toggle(row.key) }),
                      h(
                        'span',
                        { className: 'aps-rowBody' },
                        h('span', { className: 'aps-rowName' }, row.name),
                        h('span', { className: 'aps-rowMeta' }, row.description !== '' ? row.description : (row.id ?? '')),
                      ),
                    ),
                  ),
                ),
              ),
              error === '' ? null : h('p', { className: 'aps-error' }, error),
            )
      return h(
        UI.Modal,
        {
          open: true,
          onClose: close,
          closeLabel: t('close'),
          title: props.title,
          description: props.hint,
          footer: h(
            React.Fragment,
            null,
            h(UI.Button, { variant: 'outline', disabled: busy, onClick: close }, t('cancel')),
            (props.actions ?? []).map((action) =>
              h(
                UI.Button,
                {
                  key: action.key,
                  variant: action.primary === true ? 'primary' : 'outline',
                  disabled: busy || chosen.length === 0,
                  onClick: () => trigger(action),
                },
                running === action.key && action.busyLabel ? action.busyLabel : action.label,
              ),
            ),
          ),
        },
        body,
      )
    }

    /**
     * The export dialog: copy basic roster info, or download the full preset
     * info of the checked rows as one JSON file.
     * @param props - the roster rows plus close/done hooks.
     * @returns the open dialog element.
     */
    function ExportDialog(props) {
      const t = props.t
      const actions = [
        {
          key: 'copy',
          label: t('exportCopy'),
          primary: true,
          failText: t('exportFailed'),
          run: (chosen) => copyText(JSON.stringify(toExportRoster(chosen), null, 2)),
          done: (_result, chosen) => props.onDone(chosen.length),
        },
        {
          key: 'download',
          label: t('exportLocal'),
          failText: t('downloadFailed'),
          run: (chosen) => downloadJsonFile(exportFileName(), chosen.map((row) => row.payload)),
          done: (_result, chosen) => props.onDownloaded(chosen.length),
        },
      ]
      return h(PresetSelectDialog, {
        t,
        title: t('exportSelectTitle'),
        hint: t('exportSelectHint'),
        empty: t('exportEmpty'),
        rows: props.rows,
        actions,
        onClose: props.onClose,
      })
    }

    /**
     * The import dialog: the same picker as export, but its primary action
     * appends the checked presets to the end of the stored list.
     * @param props - the imported rows plus close/done hooks.
     * @returns the open dialog element.
     */
    function ImportDialog(props) {
      const t = props.t
      const actions = [
        {
          key: 'import',
          label: t('importConfirm'),
          busyLabel: t('importing'),
          primary: true,
          failText: t('importFailed'),
          run: (chosen) => props.onImport(chosen),
          done: (result) => props.onDone(result),
        },
      ]
      return h(PresetSelectDialog, {
        t,
        title: t('importSelectTitle'),
        hint: t('importSelectHint'),
        empty: t('importEmpty'),
        rows: props.rows,
        actions,
        onClose: props.onClose,
      })
    }

    /**
     * The snapshot state one draft presents, split into its two halves.
     *
     * Two independent fields back the list because the two halves mean
     * different things. `contexts` is the ordinary whitelist for the OPTIONAL
     * rows — absent means "not managed", which today injects every optional
     * row, so such a preset reads fully checked and opening it never shows a
     * state the runtime disagrees with. `requiredSuppressed` is the ADVANCED
     * opt-in list for the rows DSH marks `required`: a name in it is force-
     * suppressed against the registry's own force-restore, so its main box
     * reads unchecked. Forcing is the ONLY way a required row goes off, and it
     * is off by default everywhere.
     * @param preset - the draft or stored preset.
     * @param catalog - the Host's snapshot catalog rows.
     * @returns `{ checked, forced }` — `checked` lists every name that
     *   INJECTS (both kinds), `forced` the required names suppressed.
     */
    function contextSelectionState(preset, catalog) {
      const rows = Array.isArray(catalog) ? catalog : []
      const requiredRows = rows.filter((row) => row.required === true)
      const optionalNames = rows.filter((row) => row.required !== true).map((row) => row.name)
      const forced = Array.isArray(preset?.requiredSuppressed)
        ? requiredRows.map((row) => row.name).filter((name) => preset.requiredSuppressed.includes(name))
        : []
      // An unmanaged preset injects every optional row; a managed one follows
      // its array. Required names stored in the old `contexts` array are simply
      // not carried over — suppression there is decided by `requiredSuppressed`
      // alone, so a legacy array cannot accidentally read as a suppression.
      const optionalChecked = Array.isArray(preset?.contexts)
        ? preset.contexts.filter((name) => optionalNames.includes(name))
        : optionalNames
      const requiredOn = requiredRows.map((row) => row.name).filter((name) => forced.includes(name) === false)
      return { checked: [...new Set([...optionalChecked, ...requiredOn])], forced }
    }

    /**
     * The optional-only whitelist a draft should persist.
     *
     * Required names are written to neither half unless they are forced, so the
     * stored arrays carry exactly the decisions the user made — and a preset
     * saved before this feature existed keeps behaving as before until someone
     * edits it.
     * @param preset - the draft or stored preset.
     * @param catalog - the Host's snapshot catalog rows.
     * @returns the optional names that inject.
     */
    function contextWhitelistOf(preset, catalog) {
      const optionalNames = (Array.isArray(catalog) ? catalog : [])
        .filter((row) => row.required !== true)
        .map((row) => row.name)
      return contextSelectionState(preset, catalog).checked.filter((name) => optionalNames.includes(name))
    }

    /**
     * The snapshot contribution whitelist — one checkbox row per context.
     *
     * Deliberately the same construction as the tool checklist below: the row
     * markup, the 全选 / 取消全选 `aps-linkButton` pair acting on the visible
     * rows, and the 已选 count all come from classes this page already defines,
     * so the new area reads as one more section of the same page rather than a
     * component with its own look.
     *
     * The rows arrive from the Host already ordered the way the model sees them
     * (its `CONTEXT_ORDERS` sort key, third-party observations last); checked
     * rows float to the top, and the catalog order breaks the tie — the same
     * checked-first rule the skill and tool lists use.
     *
     * A `required` row's MAIN box shows the truth (checked = it injects) and is
     * DISABLED, because DSH force-injects required contributions at three
     * layers — `assemble`, `refreshContext` (called every model step), and
     * `dsh-working-directory`'s own `prepend` repair listener — none of which an
     * ordinary whitelist can outvote. What it CAN do is opt into the adversarial
     * path the Host implements: a same-name registration without the `required`
     * flag (a scope shadow beats the global entry in the merge, which stops the
     * force-restore) plus a filter running OUTSIDE the official repair listener.
     * That is the nested 「高级 · 强制屏蔽」 box below, DEFAULT OFF. It is opt-in
     * because it is not free: it rests on implementation details a DSH upgrade
     * can silently void, and for the working directory it removes the model's
     * sense of where it is — which is why the warning line names that cost.
     * @param props - `{ t, rows, checked, forced, onChange, onToggle, onToggleForce }`.
     * @returns the checklist element, or the empty-state hint.
     */
    function ContextPicker(props) {
      const t = props.t
      const rows = props.rows ?? []
      const checked = props.checked ?? []
      const forced = props.forced ?? []
      // The escape hatch is a HOST capability: an older Host silently drops the
      // `requiredSuppressed` field on save, so offering a box that appears to
      // work and does nothing would be a lie. It renders only when the running
      // Host advertises support (a Client can be hot-reloaded onto a Host that
      // predates the feature, so this combination is real, not theoretical).
      const canForce = props.canForce === true
      // Toggling a box re-orders nothing: the list keeps the order of the
      // selection it opened with, and a save (which remounts the editor) is
      // what makes the newly checked rows float back to the top.
      const [orderBasis, setOrderBasis] = useState(() => [...checked])
      // Same filter box the tool checklist carries: one keyword matched against
      // the readable label, the technical name and the description, with the
      // visible set re-ranked against the live selection on every change.
      const [filter, setFilter] = useState('')
      if (rows.length === 0) return h('p', { className: 'aps-hint' }, t('noContexts'))
      // Two facts the list cannot show by itself: a required row this plugin's
      // catalog never carried (the running registry protects it anyway), and a
      // catalog that could not be read from that registry at all.
      const runtimeRequired = rows.filter((row) => row.required === true && row.known === false).map((row) => row.name)
      const registryHint =
        props.registryReadable === false
          ? h('p', { className: 'aps-hint' }, t('contextsRegistryUnavailable'))
          : null
      const runtimeHint =
        runtimeRequired.length === 0
          ? null
          : h(
              'p',
              { className: 'aps-hint' },
              format(t('contextsRuntimeRequiredHint'), { names: runtimeRequired.join(t('contextsNameSeparator')) }),
            )
      // Checked rows float to the top — ranked against `orderBasis` rather than
      // the live `checked` array so the list holds still while it is edited.
      const filterKey = filter.trim().toLowerCase()
      const visibleRows =
        filterKey === ''
          ? rows
          : rows.filter(
              (row) =>
                String(row.name ?? '').toLowerCase().includes(filterKey) ||
                String(row.label ?? '').toLowerCase().includes(filterKey) ||
                String(row.description ?? '').toLowerCase().includes(filterKey),
            )
      const ranked = [...visibleRows].sort((left, right) => {
        const leftRank = orderBasis.includes(left.name) ? 0 : 1
        const rightRank = orderBasis.includes(right.name) ? 0 : 1
        return leftRank - rightRank
      })
      // Two optional halves: `optional` is every optional row (the keep list a
      // bulk action may write), `visibleOptional` only what the filter left
      // shown (the rows a bulk action may move) — so a keyword never clears a
      // hidden row's decision.
      const optional = rows.filter((row) => row.required !== true).map((row) => row.name)
      const visibleOptional = ranked.filter((row) => row.required !== true).map((row) => row.name)
      // `checked` also carries the required rows that currently inject; the two
      // bulk actions move only the optional half, so required names are
      // narrowed out here rather than relying on the caller to drop them.
      const writeOptional = (next) => props.onChange(next.filter((name) => optional.includes(name)))
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'aps-filter aps-contextFilter' },
          h('input', {
            className: 'aps-input',
            type: 'search',
            value: filter,
            placeholder: t('contextFilterPlaceholder'),
            'aria-label': t('contextFilterPlaceholder'),
            onChange: (event) => {
              setFilter(event.target.value)
              // A new keyword re-shuffles the visible set, so re-rank it
              // against the current selection.
              setOrderBasis([...checked])
            },
          }),
          filterKey === ''
            ? null
            : h(
                'p',
                { className: 'aps-hint' },
                format(t('contextFilterCount'), { shown: ranked.length, total: rows.length }),
              ),
        ),
        // Select-all / deselect-all act on the SHOWN rows only: with a filter
        // active they touch what the filter left visible and never the hidden
        // rest — the same rule the tool checklist follows.
        ranked.length === 0
          ? null
          : h(
              'div',
              { className: 'aps-inlineActions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'aps-linkButton',
                  onClick: () => writeOptional([...checked, ...visibleOptional]),
                },
                t('selectAll'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'aps-linkButton',
                  onClick: () => writeOptional(checked.filter((name) => visibleOptional.includes(name) === false)),
                },
                t('clearSelection'),
              ),
              h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: checked.length })),
            ),
        registryHint,
        runtimeHint,
        ranked.length === 0
          ? h('p', { className: 'aps-hint' }, t('contextFilterNone'))
          : h(
              'div',
              { className: 'aps-checklist' },
              ranked.map((row) =>
                h(
                  'div',
                  { key: row.name },
                  h(
                    'label',
                    { className: 'aps-checkRow' },
                    h('input', {
                      type: 'checkbox',
                      // A required row reports whether it INJECTS — false once the
                      // hatch below forces it off. It stays disabled because this
                      // box is a readout, not the control: the control is the
                      // 「高级」 box, which is the only thing that can beat DSH's
                      // force-restore.
                      // A required row reports whether it INJECTS. Under a Host that
                      // cannot force, a stored suppression is inert — so it still
                      // injects, and the readout says so rather than echoing the
                      // stored field.
                      checked:
                        row.required !== true
                          ? checked.includes(row.name)
                          : canForce === false || forced.includes(row.name) === false,
                      disabled: row.required === true,
                      onChange: () => props.onToggle(row.name),
                    }),
                    h(
                      'span',
                      { className: 'aps-checkBody' },
                      // Every class here is one this page already ships: the row
                      // scaffold is the tool checklist's (`aps-checkRow` /
                      // `aps-checkBody` / `aps-checkDesc`), and the two text lines are
                      // the skill list's (`aps-rowName` for the readable label,
                      // `aps-rowMeta` for the mono technical name). The tag pill
                      // reuses `aps-fact`, exactly how the tool rows mark 全局/内置.
                      h('span', { className: 'aps-rowName' }, row.label !== '' ? row.label : row.name),
                      h(
                        'span',
                        { className: 'aps-rowMeta' },
                        row.name,
                        ' ',
                        row.required !== true
                          ? row.known === false
                            ? h('span', { className: 'aps-fact' }, t('contextsForeignTag'))
                            : null
                          : forced.includes(row.name) && canForce === false
                            ? // Stored suppression the running Host cannot apply:
                              // say so instead of showing a checked box that lies.
                              h('span', { className: 'aps-fact' }, t('contextsForceUnavailable'))
                            : forced.includes(row.name)
                              ? h('span', { className: 'aps-fact' }, t('contextsForcedTag'))
                            : row.known === false
                              ? // Protected by the RUNNING registry, not by this
                                // plugin's catalog: name that fact, because the row
                                // appeared without the operator adding anything.
                                h('span', { className: 'aps-fact' }, t('contextsRuntimeRequiredTag'))
                              : h('span', { className: 'aps-fact' }, t('contextsRequiredTag')),
                      ),
                      row.description !== '' ? h('span', { className: 'aps-checkDesc' }, row.description) : null,
                    ),
                  ),
                  // The opt-in escape hatch, and the honest cost next to it. Only a
                  // required row gets one — anything else is already switchable
                  // above.
                  row.required !== true || canForce === false
                    ? null
                    : h(
                        'label',
                        { className: 'aps-checkRow aps-checkNested' },
                        h('input', {
                          type: 'checkbox',
                          checked: forced.includes(row.name),
                          onChange: () => props.onToggleForce(row.name),
                        }),
                        h(
                          'span',
                          { className: 'aps-checkBody' },
                          h('span', { className: 'aps-rowMeta' }, t('contextsForceLabel')),
                          forced.includes(row.name) ? h('span', { className: 'aps-warn' }, t('contextsForceWarn')) : null,
                        ),
                      ),
                ),
              ),
            ),
        h('p', { className: 'aps-hint' }, t('contextsClearHint')),
      )
    }

    /** The inline editor for one preset. */
    function PresetEditor(props) {
      const t = props.t
      const draft = props.draft
      const meta = props.meta ?? {}
      const skillGroups = meta.skillGroups ?? []
      const toolCatalog = meta.tools ?? []
      const [openGroups, setOpenGroups] = useState([])
      const [view, setView] = useState(null)
      const [inspecting, setInspecting] = useState(false)
      const [toolFilter, setToolFilter] = useState('')
      // The panel auto-refreshes on every configuration change; a monotonically
      // rising sequence drops a slow stale answer so the newest edit always wins.
      const inspectSeq = useRef(0)
      const firstInspect = useRef(true)
      const patch = (change) => props.onChange({ ...draft, ...change })
      // --- the section checklist ---------------------------------------------
      // Checked = injected. The catalog is read live from the running build,
      // and an ABSENT `sections` field means "this preset manages nothing",
      // which shows as the fully-checked list the runtime actually injects.
      // Required rows are the preset's own persona sections; only the ADVANCED
      // force list may remove them.
      const sectionCatalog = meta.sectionCatalog ?? []
      const sectionState = sectionSelectionState(draft, sectionCatalog)
      const checkedSections = sectionState.checked
      // Only the optional half is written to `sections`: a required name parked
      // there would be a dead entry, since its removal is decided by the
      // advanced list alone. That also keeps 全选 / 取消全选 honest.
      const setSectionNames = (next) =>
        patch({ sections: [...new Set(next.filter((name) => sectionState.optional.includes(name)))] })
      const toggleSection = (name) =>
        setSectionNames(
          checkedSections.includes(name)
            ? checkedSections.filter((entry) => entry !== name)
            : [...checkedSections, name],
        )
      const toggleSectionForce = (name) =>
        patch({
          sectionsSuppressed: sectionState.forced.includes(name)
            ? sectionState.forced.filter((entry) => entry !== name)
            : [...sectionState.forced, name],
        })
      const toggleGroup = (key) =>
        setOpenGroups((current) =>
          current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
        )
      const selection = draft.tools ?? { mode: 'all', names: [] }
      // Ticking a tool must not move it: the checklist is ranked against the
      // selection it opened with (or the selection as of the last filter edit),
      // never the live draft. Saving remounts the editor, so the stored
      // selection is what floats to the top on the next open.
      const [toolOrderBasis, setToolOrderBasis] = useState(() => [...(selection.names ?? [])])
      // The snapshot area holds TWO independent halves and derives its view
      // state from them (nothing is stored twice): the optional whitelist
      // `contexts`, and the ADVANCED `requiredSuppressed` list that forces a
      // DSH-required contribution off. An unmanaged preset reads as
      // fully-checked because that is what the runtime actually injects; the
      // first toggle materialises the explicit array the Host then treats as
      // the truth.
      const contextCatalog = meta.contextCatalog ?? []
      const contextState = contextSelectionState(draft, contextCatalog)
      const checkedContexts = contextState.checked
      const optionalContextNames = contextCatalog
        .filter((row) => row.required !== true)
        .map((row) => row.name)
      // Only the optional half is ever written to `contexts`: a required name
      // parked there would be a dead entry, since its suppression is decided
      // by the advanced list alone. That also keeps 全选 / 取消全选 honest — they
      // move the optional rows and never the required ones.
      const setContextNames = (next) =>
        patch({ contexts: [...new Set(next.filter((name) => optionalContextNames.includes(name)))] })
      const toggleContext = (name) =>
        setContextNames(
          checkedContexts.includes(name)
            ? checkedContexts.filter((entry) => entry !== name)
            : [...checkedContexts, name],
        )
      const toggleContextForce = (name) =>
        patch({
          requiredSuppressed: contextState.forced.includes(name)
            ? contextState.forced.filter((entry) => entry !== name)
            : [...contextState.forced, name],
        })
      const setToolNames = (next) =>
        patch({ tools: { ...selection, names: [...new Set(next)], mode: [...new Set(next)].length === 0 ? 'all' : selection.mode } })
      const toggleTool = (name) =>
        setToolNames(selection.names.includes(name) ? selection.names.filter((entry) => entry !== name) : [...selection.names, name])
      const runInspect = async () => {
        const seq = ++inspectSeq.current
        setInspecting(true)
        try {
          // Pass the editor's current (unsaved) selection as a dry-run
          // override: the Host answers from the live scope surface but with
          // THESE tools and skills applied, so the panel follows the edits.
          // The snapshot row is sent as the DERIVED checked list, never the raw
          // field: an unmanaged preset derives "everything", which is exactly
          // what it injects, so the panel's kept/blocked split matches the
          // runtime instead of falling back to the last save.
          // The section checklist rides along for the same reason: the Host
          // re-partitions live sections against THESE names, so the kept /
          // blocked split follows every toggle instead of the last save. A
          // draft that manages nothing sends `null`, which overrides the
          // stored list instead of falling back to it.
          const value = await callApi('inspect', {
            id: draft.id,
            config: {
              tools: selection,
              skills: draft.skills ?? [],
              contexts: contextState.checked,
              requiredSuppressed: contextState.forced,
              // `null` is explicit: the draft does not manage sections, and
              // must NOT fall back to the stored list inside the Host.
              sections: Array.isArray(draft.sections) ? sectionWhitelistOf(draft, sectionCatalog) : null,
              sectionsSuppressed: sectionState.forced,
            },
          })
          if (seq !== inspectSeq.current) return
          // A Host that ignores the `config` override still gets the draft
          // view recomputed locally, so the panel follows the edits anyway.
          setView(previewSelection(value, selection, draft.skills ?? []))
        } catch (error) {
          if (seq !== inspectSeq.current) return
          setView({ available: false, reason: String(error?.message ?? error) })
        } finally {
          if (seq === inspectSeq.current) setInspecting(false)
        }
      }
      // Auto-load the runtime view on entry, then re-read (debounced) after
      // every tool-list, skill or snapshot change — no manual click needed. A
      // brand-new preset has no id yet, so there is no scope to read: keep the
      // hint. The snapshot and section parts of the key use the DERIVED checked
      // names, the same lists `runInspect` sends, so an unmanaged → managed
      // transition and every individual toggle both re-read exactly once.
      const inspectKey = `${draft.id}\u0000${selection.mode}\u0000${selection.names.join(',')}\u0000${(draft.skills ?? []).join(',')}\u0000${checkedContexts.join(',')}\u0000${contextState.forced.join(',')}\u0000${draft.instructionMode}\u0000${checkedSections.join(',')}\u0000${sectionState.forced.join(',')}`
      useEffect(() => {
        if (draft.id === '') {
          setView(null)
          firstInspect.current = true
          return
        }
        const delay = firstInspect.current ? 0 : 350
        firstInspect.current = false
        const timer = setTimeout(() => {
          runInspect()
        }, delay)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runInspect closes over this render's draft; the key pins every input it reads.
      }, [inspectKey])
      // A tool filter only makes sense against a visible list; reset it when
      // the list collapses back to `all`.
      const filterKey = toolFilter.trim().toLowerCase()
      const visibleTools =
        filterKey === ''
          ? toolCatalog
          : toolCatalog.filter(
              (tool) =>
                String(tool.name ?? '').toLowerCase().includes(filterKey) ||
                String(tool.description ?? '').toLowerCase().includes(filterKey),
            )
      // Checked tools first, then the rest alphabetically — ranked against
      // `toolOrderBasis`, not the live selection: a row stays put while its box
      // is ticked, and the order is refreshed by a filter change or a save.
      const sortedTools = [...visibleTools].sort((left, right) => {
        const leftRank = toolOrderBasis.includes(left.name) ? 0 : 1
        const rightRank = toolOrderBasis.includes(right.name) ? 0 : 1
        return leftRank - rightRank || String(left.name).localeCompare(String(right.name))
      })
      return h(
        'div',
        { className: 'aps-section' },
        h(
          'div',
          null,
          h('h2', { className: 'aps-title' }, draft.id === '' ? t('createTitle') : t('editTitle')),
          h('p', { className: 'aps-intro' }, draft.id === '' ? t('description') : draft.id),
        ),
        props.error ? h('p', { className: 'aps-error' }, props.error) : null,
        h(
          'div',
          { className: 'aps-group' },
          h('h3', { className: 'aps-groupHead' }, t('groupBasic')),
          h(
            'div',
            { className: 'aps-cardPanel' },
            h(
              Field,
              { label: t('name'), hint: t('nameHint') },
              h('input', {
                className: 'aps-input',
                type: 'text',
                value: draft.name,
                onChange: (event) => patch({ name: event.target.value }),
              }),
            ),
            h(
              Field,
              { label: t('descLabel'), hint: t('descHint') },
              h('input', {
                className: 'aps-input',
                type: 'text',
                value: draft.description,
                onChange: (event) => patch({ description: event.target.value }),
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'aps-group' },
          h('h3', { className: 'aps-groupHead' }, t('groupPrompt')),
          h(
            'div',
            { className: 'aps-cardPanel' },
            h(
              Field,
              {
                label: t('instructionMode'),
                hint:
                  draft.instructionMode === 'complete'
                    ? t('modeCompleteHint')
                    : draft.instructionMode === 'custom'
                      ? t('modeCustomHint')
                      : t('modeAppendHint'),
              },
              h(Segmented, {
                label: t('instructionMode'),
                value: draft.instructionMode,
                options: [
                  { value: 'append', label: t('modeAppend') },
                  { value: 'complete', label: t('modeComplete') },
                  { value: 'custom', label: t('modeCustom') },
                ],
                onChange: (value) => patch({ instructionMode: value }),
              }),
            ),
            // The checklist only means anything in `custom` mode, so it appears
            // exactly then — the same place the mode is chosen, using the same
            // Field scaffold and checklist markup as the runtime-context list.
            ...(draft.instructionMode === 'custom'
              ? [
                  h(
                    Field,
                    {
                      key: 'sections',
                      label: t('sections'),
                      hint: t('sectionsHint'),
                    },
                    h(SectionPicker, {
                      t,
                      rows: sectionCatalog,
                      checked: checkedSections,
                      forced: sectionState.forced,
                      onChange: setSectionNames,
                      onToggle: toggleSection,
                      onToggleForce: toggleSectionForce,
                    }),
                  ),
                ]
              : []),
            h(
              Field,
              { label: t('instructions'), hint: t('instructionsHint') },
              h('textarea', {
                className: 'aps-textarea',
                rows: 6,
                value: draft.instructions,
                onChange: (event) => patch({ instructions: event.target.value }),
              }),
            ),
          ),
        ),
        // Between the prompt and the skills: the snapshot is a prompt-layer
        // contribution (it is injected as a message, not a section), so it
        // follows the prompt group, but it is selected item-by-item like the
        // skills and tools below it.
        h(
          'div',
          { className: 'aps-group' },
          h(
            'div',
            { className: 'aps-groupHeadRow' },
            h('h3', { className: 'aps-groupHead' }, t('groupContexts')),
            // A count over an EMPTY catalog would read as "nothing is injected",
            // which is the opposite of the truth: no catalog means the Host
            // never reported one (an older Host, for instance), so nothing here
            // is being managed and everything still injects.
            contextCatalog.length === 0
              ? null
              : h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: checkedContexts.length })),
          ),
          h(
            'div',
            { className: 'aps-cardPanel' },
            h(
              Field,
              { label: t('contexts'), hint: t('contextsHint') },
              h(ContextPicker, {
                t,
                rows: contextCatalog,
                checked: checkedContexts,
                forced: contextState.forced,
                canForce: (meta.capabilities ?? []).includes('requiredSuppression'),
                // Absent on an older Host: `!== false` keeps that Host's answer
                // ("I cannot say") from rendering as a failure warning.
                registryReadable: meta.contextRegistry?.readable !== false,
                onChange: setContextNames,
                onToggle: toggleContext,
                onToggleForce: toggleContextForce,
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'aps-group' },
          h(
            'div',
            { className: 'aps-groupHeadRow' },
            h('h3', { className: 'aps-groupHead' }, t('groupSkills')),
            h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: draft.skills.length })),
          ),
          h(
            'div',
            { className: 'aps-cardPanel' },
            h(
              Field,
              { label: t('skills'), hint: t('skillsHint') },
              h(SkillGroupPicker, {
                t,
                groups: skillGroups,
                diag: meta.skillDiagnostics,
                roots: meta.skillRoots,
                selected: draft.skills,
                openGroups,
                onToggleGroup: toggleGroup,
                onChange: (next) => patch({ skills: next }),
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'aps-group' },
          h('h3', { className: 'aps-groupHead' }, t('groupTools')),
          h(
            'div',
            { className: 'aps-cardPanel' },
            h(
              Field,
              { label: t('toolMode'), hint: t('toolsHint') },
              h(
                'div',
                null,
                h(Segmented, {
                  label: t('toolMode'),
                  value: selection.mode,
                  options: [
                    { value: 'all', label: t('modeAll') },
                    { value: 'allow', label: t('modeAllow') },
                    { value: 'deny', label: t('modeDeny') },
                  ],
                  // The filter narrows a visible list; `all` shows no list at
                  // all, so drop the stale keyword when the list collapses.
                  onChange: (value) => {
                    setToolFilter('')
                    patch({ tools: { ...selection, mode: value } })
                  },
                }),
                selection.mode === 'all'
                  ? null
                  : h(
                      'div',
                      { className: 'aps-filter aps-toolFilter' },
                      h('input', {
                        className: 'aps-input',
                        type: 'search',
                        value: toolFilter,
                        placeholder: t('toolFilterPlaceholder'),
                        'aria-label': t('toolFilterPlaceholder'),
                        onChange: (event) => {
                          setToolFilter(event.target.value)
                          // A new keyword re-shuffles the visible set, so re-rank
                          // it against the current selection.
                          setToolOrderBasis([...selection.names])
                        },
                      }),
                      filterKey !== ''
                        ? h(
                            'p',
                            { className: 'aps-hint' },
                            format(t('toolFilterCount'), { shown: visibleTools.length, total: toolCatalog.length }),
                          )
                        : null,
                    ),
                // Select-all / deselect-all act on the SHOWN tools only: with
                // a filter active they touch what the filter left visible and
                // never the hidden rest — same rule as the skill source groups.
                selection.mode === 'all' || sortedTools.length === 0
                  ? null
                  : h(
                      'div',
                      { className: 'aps-inlineActions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'aps-linkButton',
                          onClick: () => setToolNames([...selection.names, ...sortedTools.map((tool) => tool.name)]),
                        },
                        t('selectAll'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'aps-linkButton',
                          onClick: () => {
                            const shown = new Set(sortedTools.map((tool) => tool.name))
                            setToolNames(selection.names.filter((name) => shown.has(name) === false))
                          },
                        },
                        t('clearSelection'),
                      ),
                      h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: selection.names.length })),
                    ),
                selection.mode === 'all'
                  ? null
                  : h(Checklist, {
                      t,
                      options: sortedTools,
                      selected: selection.names,
                      emptyLabel: filterKey !== '' ? t('toolFilterNone') : t('noTools'),
                      onToggle: toggleTool,
                    }),
                // An allow list without `skill` refuses every skill load, so
                // the checked skills would silently do nothing.
                selection.mode === 'allow' &&
                selection.names.includes('skill') === false &&
                (draft.skills ?? []).length > 0
                  ? h(
                      'div',
                      { className: 'aps-warnBlock' },
                      h('div', { className: 'aps-warnTitle' }, t('warnSkillsNeedToolTitle')),
                      h('p', { className: 'aps-warnBody' }, t('warnSkillsNeedToolBody')),
                    )
                  : null,
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'aps-group' },
          h('h3', { className: 'aps-groupHead' }, t('groupInspect')),
          h(InspectPanel, {
            t,
            view,
            busy: inspecting,
            unsaved: draft.id === '',
            custom: draft.instructionMode === 'custom',
            onRun: runInspect,
          }),
        ),
        h(
          'div',
          { className: 'aps-footer' },
          h('span', { className: 'aps-footerSpacer' }),
          h(
            'button',
            { type: 'button', className: 'aps-btn', onClick: props.onCancel, disabled: props.busy },
            t('cancel'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aps-btn aps-btnPrimary',
              onClick: props.onSave,
              disabled: props.busy || draft.name.trim() === '',
            },
            props.busy ? t('saving') : t('save'),
          ),
        ),
      )
    }

    /** The settings section: list view or editor view. */
    function StudioSection() {
      const [state, setState] = useState({ loading: true, presets: [], meta: {} })
      const [draft, setDraft] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const [exporting, setExporting] = useState(false)
      const [importing, setImporting] = useState(null)
      const importInputRef = useRef(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const t = T
      const refresh = useCallback(async () => {
        try {
          const value = await callApi('list')
          setState({ loading: false, presets: value.presets ?? [], meta: value.meta ?? {} })
        } catch (err) {
          setState((current) => ({ ...current, loading: false }))
          setError(format(zh.loadFailed, { message: String(err?.message ?? err) }))
        }
      }, [])
      useEffect(() => {
        refresh()
      }, [refresh])
      const run = async (task, failText) => {
        setBusy(true)
        setError('')
        setNotice('')
        try {
          await task()
        } catch (err) {
          setError(format(failText, { message: String(err?.message ?? err) }))
        } finally {
          setBusy(false)
        }
      }
      const save = () =>
        run(async () => {
          // An UNMANAGED list stays unmanaged. Saving used to write the
          // fully-checked list the panel showed, which turned "everything
          // injects" into a frozen snapshot of the rows that happened to exist
          // at that moment. The catalog grows on its own (a plugin registers a
          // section, a running Agent reports a new snapshot context), so the
          // frozen list silently excluded every later row — an existing preset
          // then opened with those rows unchecked while a NEW preset showed
          // them checked. Only an explicit edit (a checkbox or a bulk action,
          // both of which write the array) makes the list strict; undefined
          // keeps meaning "inject everything", for old and new presets alike.
          // When the catalog is empty the page cannot tell optional from
          // required, so it must not compute either half at all.
          const catalog = state.meta?.contextCatalog ?? []
          const catalogKnown = catalog.length > 0
          const forceSupported = (state.meta?.capabilities ?? []).includes('requiredSuppression')
          const forcedRows = catalog.filter((row) => row.required === true).map((row) => row.name)
          const draftForced = (Array.isArray(draft.requiredSuppressed) ? draft.requiredSuppressed : []).filter(
            (name) => forcedRows.includes(name),
          )
          // The advanced half is only written when something is actually forced
          // or was forced before: an absent field is the plain,
          // contract-respecting state, and leaving it absent keeps legacy
          // documents clean.
          // The section checklist follows the same rule as the snapshot list:
          // undefined stays undefined, an array stays a strict keep list. An
          // empty catalog means the page could not tell optional from required,
          // so nothing is computed at all.
          const sectionCatalog = state.meta?.sectionCatalog ?? []
          const sectionKnown = sectionCatalog.length > 0
          const sectionRequired = sectionCatalog.filter((row) => row.required === true).map((row) => row.name)
          const draftSectionForced = (Array.isArray(draft.sectionsSuppressed) ? draft.sectionsSuppressed : []).filter(
            (name) => sectionRequired.includes(name),
          )
          const payload = {
            ...draft,
            ...(catalogKnown && Array.isArray(draft.contexts)
              ? { contexts: contextWhitelistOf(draft, catalog) }
              : {}),
            ...(catalogKnown &&
              (draftForced.length > 0 || Array.isArray(draft.requiredSuppressed)) &&
              forceSupported
              ? { requiredSuppressed: draftForced }
              : {}),
            ...(sectionKnown && Array.isArray(draft.sections)
              ? { sections: sectionWhitelistOf(draft, sectionCatalog) }
              : {}),
            ...(sectionKnown && (draftSectionForced.length > 0 || Array.isArray(draft.sectionsSuppressed))
              ? { sectionsSuppressed: draftSectionForced }
              : {}),
          }
          const result = await callApi('save', payload)
          setNotice(zh.saved)
          setDraft(null)
          await refresh()
          return result
        }, t('saveFailed'))
      const remove = (preset) =>
        run(async () => {
          await callApi('delete', { id: preset.id })
          setConfirming(null)
          await refresh()
        }, t('deleteFailed'))
      const toggle = (preset) =>
        run(async () => {
          await callApi('toggle', { id: preset.id })
          await refresh()
        }, t('saveFailed'))
      /**
       * Duplicate one preset card in place.
       *
       * The page assembles the copy (the Host only stores what it is told):
       * `id: ''` makes the Host mint a fresh `custom-xxxxxxxx`, so the copy
       * shares nothing with its source; the name takes `（复制 N）`, numbered
       * against EVERY existing name — disabled presets included, since an off
       * preset still occupies its slot in the roster; and `insertAfter` places
       * the copy directly behind the source while the Host re-indexes the whole
       * `order` column, which is what makes this card grid and the New-Session
       * roster agree. Everything else, the enabled state first, is carried
       * over verbatim: a duplicate is a copy, not a template.
       * @param preset - the card that was clicked.
       */
      const duplicate = (preset) =>
        run(async () => {
          const taken = new Set(state.presets.map((entry) => String(entry.name ?? '').trim()))
          const copy = {
            id: '',
            name: copyName(preset, (candidate) => taken.has(candidate)),
            description: preset.description ?? '',
            instructions: preset.instructions ?? '',
            instructionMode: preset.instructionMode ?? 'append',
            // Copied as-is, array or absence: an unmanaged source yields an
            // unmanaged copy, a managed one keeps its exact whitelist. The
            // advanced force-suppress list rides along for the same reason — a
            // duplicate is a copy, not a fresh default.
            contexts: Array.isArray(preset.contexts) ? [...preset.contexts] : preset.contexts,
            requiredSuppressed: Array.isArray(preset.requiredSuppressed)
              ? [...preset.requiredSuppressed]
              : preset.requiredSuppressed,
            sections: Array.isArray(preset.sections) ? [...preset.sections] : preset.sections,
            sectionsSuppressed: Array.isArray(preset.sectionsSuppressed)
              ? [...preset.sectionsSuppressed]
              : preset.sectionsSuppressed,
            skills: [...(preset.skills ?? [])],
            tools: { mode: 'all', names: [], ...(preset.tools ?? {}) },
            enabled: preset.enabled !== false,
            insertAfter: preset.id,
          }
          const result = await callApi('save', copy)
          setNotice(format(t('copyDone'), { name: copy.name }))
          await refresh()
          return result
        }, t('copyFailed'))
      /** The export dialog finished its copy; close it and report the count. */
      const exportDone = (count) => {
        setExporting(false)
        setNotice(format(t('exportHint'), { count }))
      }
      /** The export dialog wrote a local file; close it and report the count. */
      const exportDownloaded = (count) => {
        setExporting(false)
        setNotice(format(t('downloadHint'), { count }))
      }
      /**
       * Read the picked file and open the import picker. An unreadable or
       * malformed file leaves the page untouched and alerts the user, per the
       * "wrong file format" contract; valid presets are checked by default in
       * the same dialog export uses.
       */
      const pickImportFile = async (event) => {
        const reportInvalid = () => {
          if (typeof window.alert === 'function') window.alert(t('importInvalid'))
          // A host that suppresses modal alerts still gets a visible reason.
          else setError(t('importInvalid'))
        }
        const file = event?.target?.files?.[0]
        if (file !== null && file !== undefined) {
          try {
            const rows = parseImportedPresets(await readFileText(file))
            if (rows === undefined) {
              reportInvalid()
            } else {
              setError('')
              setNotice('')
              setImporting(rows)
            }
          } catch {
            reportInvalid()
          }
        }
        // Clear the value so picking the SAME file again still fires a change.
        if (event?.target !== null && event?.target !== undefined) event.target.value = ''
      }
      /**
       * Append the checked imports to the stored list. Names already present
       * (trimmed, case-insensitive) are renamed to `原名（导入 N）`, and the
       * Host mints fresh ids; each save carries a running `order` so the new
       * cards land at the end in the picker's order. `finally` refreshes even
       * after a mid-way failure so the page never shows a list the Host no
       * longer has.
       */
      const importSelected = async (rows) => {
        // Conflict lookup is name-based (trimmed, case-insensitive) and covers
        // every stored preset, disabled ones included. A conflict is no longer
        // a skip: the preset imports under `原名（导入 N）`, with N scanning
        // the stored names AND the names assigned earlier in this same batch.
        const taken = new Set(state.presets.map((preset) => presetNameKey(preset.name)))
        const orders = state.presets
          .map((preset) => Number(preset.order))
          .filter((order) => Number.isFinite(order))
        const baseOrder = orders.length > 0 ? Math.max(...orders) + 1 : 0
        let added = 0
        let renamed = 0
        try {
          for (const row of rows) {
            let name = row.name
            if (taken.has(presetNameKey(name))) {
              name = importName({ name }, (candidate) => taken.has(presetNameKey(candidate)))
              renamed += 1
            }
            await callApi('save', {
              ...row.payload,
              id: '',
              name,
              order: baseOrder + added,
            })
            taken.add(presetNameKey(name))
            added += 1
          }
        } finally {
          await refresh()
        }
        return { added, renamed }
      }
      /** The import dialog finished; close it and report added/renamed counts. */
      const importDone = (result) => {
        setImporting(null)
        const added = result?.added ?? 0
        const renamed = result?.renamed ?? 0
        setNotice(
          renamed > 0
            ? format(t('importHint'), { added, renamed })
            : format(t('importHintPlain'), { count: added }),
        )
      }
      if (draft !== null) {
        return h(PresetEditor, {
          t,
          draft,
          meta: state.meta,
          busy,
          error,
          onChange: setDraft,
          onCancel: () => {
            setDraft(null)
            setError('')
          },
          onSave: save,
        })
      }
      const presets = state.presets
      return h(
        'div',
        { className: 'aps-section' },
        h('h2', { className: 'aps-title' }, t('title')),
        h('p', { className: 'aps-intro' }, t('description')),
        // The three list-level actions live under the intro line (not in the
        // group heading) so they fit on one row without squeezing the label.
        h(
          'div',
          { className: 'aps-listActions' },
          h(
            'button',
            {
              type: 'button',
              className: 'aps-btn aps-btnPrimary',
              disabled: busy,
              onClick: () => {
                setError('')
                setNotice('')
                setDraft(blankPreset())
              },
            },
            `+ ${t('create')}`,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aps-btn',
              disabled: busy || state.loading,
              onClick: () => {
                setError('')
                setNotice('')
                setExporting(true)
              },
            },
            t('exportList'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aps-btn',
              disabled: busy || state.loading,
              onClick: () => importInputRef.current?.click(),
            },
            t('importList'),
          ),
          h('input', {
            ref: importInputRef,
            className: 'aps-fileInput',
            type: 'file',
            accept: '.json,application/json',
            tabIndex: -1,
            'aria-hidden': 'true',
            onChange: pickImportFile,
          }),
        ),
        error ? h('p', { className: 'aps-error' }, error) : null,
        notice ? h('p', { className: 'aps-notice' }, notice) : null,
        state.meta?.registryAvailable === false ? h('p', { className: 'aps-warn' }, t('registryMissing')) : null,
        h('h3', { className: 'aps-groupHead' }, t('nav')),
        state.loading
          ? h('p', { className: 'aps-hint' }, t('loading'))
          : presets.length === 0
            ? h(
                'div',
                { className: 'aps-empty' },
                h('p', { className: 'aps-intro' }, t('empty')),
                h('p', { className: 'aps-hint' }, t('emptyHint')),
              )
            : h(
                'ul',
                { className: 'aps-cards' },
                presets.map((preset) =>
                  h(PresetCard, {
                    key: preset.id,
                    t,
                    preset,
                    busy,
                    confirming: confirming === preset.id,
                    onEdit: (target) => {
                      setError('')
                      setNotice('')
                      setDraft({
                        ...blankPreset(),
                        ...target,
                        tools: { mode: 'all', names: [], ...(target.tools ?? {}) },
                        skills: [...(target.skills ?? [])],
                      })
                    },
                    onToggle: toggle,
                    onAskDelete: () => setConfirming(preset.id),
                    onCancelDelete: () => setConfirming(null),
                    onRemove: remove,
                    onDuplicate: duplicate,
                  }),
                ),
              ),
        // The dialog is a portal by itself (the shell's Modal), so rendering
        // it here only borrows this view's lifetime.
        exporting
          ? h(ExportDialog, {
              t,
              rows: toExportRows(presets),
              onClose: () => setExporting(false),
              onDone: exportDone,
              onDownloaded: exportDownloaded,
            })
          : null,
        importing !== null
          ? h(ImportDialog, {
              t,
              rows: importing,
              onClose: () => setImporting(null),
              onImport: importSelected,
              onDone: importDone,
            })
          : null,
      )
    }

    /** Required Client services (cordis fiber inject). */
    const inject = ['slots', 'locale']

    /**
     * Mount the custom-preset settings page.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(
        () => {
          const tag = document.createElement('style')
          tag.dataset.pluginCss = 'dsh-my-agent-preset/settings.css'
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        },
        'my-agent-preset: styles',
      )
      let t = (key) => zh[key] ?? key
      try {
        ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'my-agent-preset: dictionaries')
        t = ctx.locale.bind(LOCALE_NS)
        T = t
      } catch (err) {
        ctx.logger?.warn?.(`[my-agent-preset] 注册文案失败: ${String(err?.message ?? err)}`)
      }
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'my-agent-preset',
            order: 21,
            label: () => t('nav'),
            locale: LOCALE_NS,
          },
          StudioSection,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.LOCALE_NS = LOCALE_NS
    return module.exports
  },
})
