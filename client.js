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
.aps-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}
.aps-notice{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:1.5}
.aps-group{display:flex;flex-direction:column;gap:10px}
.aps-group+.aps-group{margin-top:20px}
.aps-groupHead{letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;font-weight:600}
.aps-groupHeadRow{display:flex;align-items:center;justify-content:space-between;gap:8px}
.aps-groupHeadRow .aps-hint{flex:none;white-space:nowrap}
.aps-groupHeadActions{display:flex;align-items:center;gap:8px;flex:none}
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
.aps-creator{box-sizing:border-box;border:1px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);height:44px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;display:flex;align-items:center;justify-content:center;gap:6px;font-size:14px;line-height:22px}
.aps-creator:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.aps-creator:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.aps-creator:disabled{opacity:.4;cursor:default}
.aps-empty{border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6}
.aps-cardPanel{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));padding:4px 16px 16px}
.aps-field{display:flex;flex-direction:column;gap:6px;padding:12px 0}
.aps-field+.aps-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.aps-fieldHead{display:flex;align-items:center;gap:8px}
.aps-label{flex:1;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.aps-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.aps-example{margin:0;padding-left:8px;border-left:2px solid var(--dsw-alias-border-l2);font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.aps-input,.aps-textarea,.aps-select{box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.aps-input,.aps-select{height:34px;padding:0 12px}
.aps-select{appearance:none;cursor:pointer}
.aps-textarea{padding:8px 12px;min-height:92px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px}
.aps-input:focus-visible,.aps-textarea:focus-visible,.aps-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
/* Chip editor: the same 34px box/border metrics as .aps-input, with the chips
   and the caret sharing one row. Focus lives on the inner input, so the ring is
   drawn by :focus-within on the shell. */
.aps-tagEditor{box-sizing:border-box;width:100%;min-height:34px;display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:3px 6px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);cursor:text}
.aps-tagEditor:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.aps-tag{display:inline-flex;align-items:center;max-width:100%;gap:3px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:1px 2px 1px 6px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:17px}
.aps-tagText{min-width:0;overflow-wrap:anywhere}
.aps-tagRemove{appearance:none;border:0;background:0 0;font:inherit;font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));border-radius:var(--dsw-radius-sm);padding:0 4px;cursor:pointer}
.aps-tagRemove:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
.aps-tagRemove:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-tagInput{flex:1 1 96px;min-width:96px;box-sizing:border-box;border:0;background:0 0;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);height:26px;padding:0 4px}
.aps-tagInput:focus-visible{outline:none}
.aps-tagInput::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.aps-seg{display:inline-flex;gap:2px;background:var(--dsw-alias-bg-layer-3);border-radius:var(--dsw-radius-md);padding:2px}
.aps-segItem{appearance:none;border:0;background:0 0;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);padding:4px 12px;cursor:pointer}
.aps-segItem[aria-pressed='true']{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
.aps-segItem:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-filter{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.aps-toolFilter{margin-top:10px}
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
.aps-mcpList{display:flex;flex-direction:column;gap:10px}
.aps-mcpItem{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:10px 12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2)}
.aps-mcpHead{display:flex;align-items:center;gap:8px}
.aps-mcpTitle{flex:1;min-width:0;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aps-subGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.aps-subField{display:flex;flex-direction:column;gap:4px}
.aps-subLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}
.aps-footer{display:flex;align-items:center;gap:8px;padding-top:16px}
.aps-footerSpacer{flex:1}
.aps-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-md);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.aps-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.aps-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-btn:disabled{opacity:.4;cursor:default}
.aps-btnPrimary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));border-color:transparent;color:var(--dsw-alias-bg-layer-3)}
.aps-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-label-primary))}
.aps-btnDanger{color:var(--dsw-alias-state-error-primary)}
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
.aps-switchRow{display:flex;align-items:center;gap:8px}
.aps-switchText{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.aps-switch{appearance:none;flex:none;width:34px;height:20px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);cursor:pointer;padding:2px;display:inline-flex;align-items:center;transition:background .16s}
.aps-switchThumb{width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .16s,background .16s}
.aps-switchOn{background:var(--dsw-alias-brand-primary);border-color:transparent}
.aps-switchOn .aps-switchThumb{transform:translateX(14px);background:var(--dsw-alias-bg-layer-1)}
.aps-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.aps-switch:disabled{opacity:.4;cursor:default}
.aps-toolTags{display:flex;flex-wrap:wrap;gap:4px}
.aps-toolTag{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:17px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);padding:1px 6px;overflow-wrap:anywhere}
.aps-toolTagOff{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:17px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));padding:1px 6px;text-decoration:line-through;overflow-wrap:anywhere}
.aps-warn{margin:2px 0 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere}
.aps-warnBlock{margin:8px 0 0;border:.5px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md);padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:6px}
.aps-warnTitle{font-size:13px;line-height:1.5;font-weight:500;color:var(--dsw-alias-state-warn-primary)}
.aps-warnBody{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.aps-inspect{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:10px 12px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:8px}
.aps-toggle{display:flex;font-size:12px;align-items:center;gap:2px;flex-wrap:wrap}
.aps-inspectHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.aps-inspectCount{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.aps-nameListBlock{margin-top:10px}
.aps-nameListTitle{margin:0 0 4px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.aps-nameList{margin:0;padding:0;list-style:none;max-height:190px;overflow:auto;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}
.aps-nameList li{padding:3px 10px;font-size:12px;line-height:1.6;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;border-top:.5px solid var(--dsw-alias-border-l1)}
.aps-nameList li:first-child{border-top:0}
.aps-codePath{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:1.7;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;display:block}`

    /** Chinese dictionary. */
    const zh = {
      nav: '自定义预设模式',
      title: '自定义预设模式',
      description: '新增、编辑、复制与删除自定义 Agent 预设模式，并管理其提示词、运行时上下文、技能与工具。',
      create: '新建预设模式',
      createTitle: '新建预设模式',
      exportList: '导出预设列表',
      exportSelectTitle: '选择要导出的预设',
      exportSelectHint: '勾选要导出的预设，复制为 JSON 到剪贴板。',
      exportCopy: '复制到剪贴板',
      exportHint: '已复制 {count} 个预设（id / name / description）到剪贴板。',
      exportEmpty: '还没有可导出的预设。',
      exportFailed: '复制失败：{message}',
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
      instructionsHint: '写入该模式的系统提示词；留空则沿用部署人设（在「自定义屏蔽（默认官方）」下留空 = 不注入人设）。',
      instructionMode: '注入方式',
      modeAppend: '追加',
      modeComplete: '完全替换',
      modeCustomBlock: '自定义屏蔽（默认官方）',
      modeAppendHint: '只用这段文字替换人设前缀，保留 DSH 其它系统提示词（工具指导等）。',
      modeCompleteHint: '只使用这段文字，移除所有其它系统提示词（含第三方插件注入）。',
      modeCustomBlockHint: '只用这段文字作为人设，按下方三栏规则屏蔽提示词：默认屏蔽 DSH 官方段，可补充屏蔽前缀或完整段名，也可点名保留某些段；第三方插件与外部 MCP 注入的提示词默认保留。',
      includeWorkspace: '附带工作区',
      includeWorkspaceHint: '在提示词末尾自动附上当前会话工作区路径；追加、完全替换、自定义屏蔽（默认官方）三种方式都生效（默认开启）。',
      includeWorkspaceOn: '在提示词末尾附带当前会话工作区',
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
      officialPrefixes: '补充屏蔽提示词前缀',
      officialPrefixesHint: '按普通前缀屏蔽：添加 api 会屏蔽所有以 api 开头的段（api:docs、api-schema…），添加 a:b 会屏蔽 a:b:c 等以 a:b 开头的段。不用写冒号结尾，也不要求写满冒号分隔的完整层级；只想精确命中某一段请用下一栏。内置 {count} 个前缀始终生效，这里只做追加，删掉某一项也不会关闭内置规则。',
      officialPrefixesExample: '添加：输入后按回车、逗号或移出焦点；删除：点标签上的 × 或按退格。',
      officialPrefixesPlaceholder: '输入前缀后按回车添加，如 api 或 a:b',
      officialNames: '补充屏蔽提示词段名（完整名称）',
      officialNamesHint: '按完整段名精确屏蔽，不做前缀展开——名字必须一模一样。适合没有冒号分层的段，或只想点名屏蔽某一段。',
      officialNamesExample: '如 mcp-resource-servers 只命中同名段；tool:bash 只屏蔽 bash 的指导段，不会连带 tool:read。',
      officialNamesPlaceholder: '输入完整段名后按回车添加，如 tool:bash',
      officialKeep: '保留（不屏蔽）提示词段名（完整名称）',
      officialKeepHint: '保留名单优先于上面的屏蔽规则：命中完整段名后，即使它落在被屏蔽的前缀范围内也照样保留。只认完整名称，填前缀无效。',
      officialKeepExample: '如 tool:bash 会保住 bash 的指导段；想放过自己的某个段，就填它的完整名字。',
      officialKeepPlaceholder: '输入要保留的完整段名，如 tool:bash',
      officialRulesSectionHint: '这三栏只影响「自定义屏蔽（默认官方）」的人设注入：工具、技能、运行时上下文不受影响，另外两种注入方式也不读取它们。补充项与内置规则叠加，不会替代内置规则。',
      officialDefaultsList: '内置规则（始终生效，与上面三栏叠加）：前缀 {prefixes}；段名 {names}。',
      officialDroppedHint: '以下内置项不在上面的标签里，但仍然生效（这里是追加，不会替换内置规则）：{names}。要放过其中某个具体段，请把它的完整段名加进「保留（不屏蔽）提示词命名段」。',
      tagRemove: '删除 {name}',
      contextsClearHint: '取消全部非必需勾选后，快照只剩必需项。',
      noContexts: '当前没有可勾选的快照上下文项。',
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
      inspectSectionRules: '段规则：{prefixes} 个前缀 · {names} 个精确段名 · {keep} 个保留规则',
      inspectBlockedSections: '屏蔽段 {count} 个',
      inspectKeptSections: '保留段 {count} 个',
      inspectSectionRulesHint: '段规则按上方三栏的当前标签计算（默认官方规则已计入），保存后才会改变运行时注入。',
      inspectSectionRulesUnavailable: '未能读取运行时 section 列表，屏蔽/保留分区暂不可用；上面的规则计数仍然有效。',
      inspectBlockedSectionsList: '屏蔽段（{count}）',
      inspectKeptSectionsList: '保留段（{count}）',
      inspectSurface: '继承工具面 {count} 个',
      inspectTools: '可用工具 {count} 个',
      inspectBlocked: '被名单拒绝的工具 {count} 个',
      inspectSkills: '启用的技能 {count} 个',
      inspectSkillsOff: '技能工具未启用，该预设的技能全部不可用',
      inspectSkillsMissing: '{count} 个技能已不在当前技能目录中',
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
      statePending: '未注册',
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
      factBlocked: '拒 {count} 工具',
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
      exportSelectTitle: 'Choose presets to export',
      exportSelectHint: 'Check the presets to export; they are copied to the clipboard as JSON.',
      exportCopy: 'Copy to clipboard',
      exportHint: 'Copied {count} presets (id / name / description) to the clipboard.',
      exportEmpty: 'No preset to export yet.',
      exportFailed: 'Copy failed: {message}',
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
      instructionsHint: 'Written into this mode\u2019s system prompt; empty keeps the deployment persona (empty in Official only means no persona at all).',
      instructionMode: 'Injection',
      modeAppend: 'Prepend',
      modeComplete: 'Replace',
      modeCustomBlock: 'Custom blocking (DSH defaults)',
      modeAppendHint: 'Uses this text as the persona prefix (replacing the deployment persona) while keeping the rest of DSH\u2019s system prompt, such as tool guidance.',
      modeCompleteHint: 'Uses only this text, removing every other system-prompt section (including third-party contributions).',
      modeCustomBlockHint: 'Uses this text as the persona and filters sections with the three fields below: DSH\u2019s own sections are blocked by default, extra prefixes or exact names can be blocked, and specific sections can be kept; third-party plugin and external MCP contributions stay by default.',
      includeWorkspace: 'Include workspace',
      includeWorkspaceHint: 'Append the current session working directory to the end of the prompt; applies to Prepend, Replace, and Official only (on by default).',
      includeWorkspaceOn: 'Append the current session working directory',
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
      officialPrefixes: 'Also block these prompt prefixes',
      officialPrefixesHint: 'Blocks by plain prefix: adding api blocks every section starting with api (api:docs, api-schema…), and a:b blocks a:b:c. No trailing colon is required and no namespace boundary is assumed; use the next field for an exact single section. The {count} built-in prefixes always apply; this list only adds to them.',
      officialPrefixesExample: 'Add: type a value, then press Enter, a comma, or leave the field. Remove: click the × on a chip, or press Backspace.',
      officialPrefixesPlaceholder: 'Type a prefix and press Enter, e.g. api or a:b',
      officialNames: 'Also block these prompt sections (exact name)',
      officialNamesHint: 'Matches the whole section name exactly — no prefix expansion, the name must match character for character. Use it for sections without a namespace, or to single one out.',
      officialNamesExample: 'mcp-resource-servers matches that one section; tool:bash blocks only the bash guidance, leaving tool:read alone.',
      officialNamesPlaceholder: 'Type an exact section name and press Enter, e.g. tool:bash',
      officialKeep: 'Keep these prompt sections (exact name)',
      officialKeepHint: 'Exemptions outrank the block rules above: a hit stays even inside a blocked namespace. Exact names only — a prefix does nothing here.',
      officialKeepExample: 'tool:bash keeps the bash guidance; to keep one of your own sections, give its full name.',
      officialKeepPlaceholder: 'Type an exact section name to keep, e.g. tool:bash',
      officialRulesSectionHint: 'These three fields only affect the “custom-official” persona filter: tools, skills and the runtime-context snapshot are untouched, and the other two injection modes never read them. Entries add to the built-in rules and never replace them.',
      officialDefaultsList: 'Built-in rules (always in force, added to the fields above): prefixes {prefixes}; names {names}.',
      officialDroppedHint: 'These built-in entries are not in the chips above but still apply (the fields add to the built-in rules; they never replace them): {names}. To let one of them through, add its full section name to “Keep these prompt sections”.',
      tagRemove: 'Remove {name}',
      contextsClearHint: 'Unchecking every optional row leaves only the required ones.',
      noContexts: 'No snapshot context contribution is available to choose from.',
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
      inspectSectionRules: 'Section rules: {prefixes} prefixes · {names} exact names · {keep} keep rules',
      inspectBlockedSections: 'Sections blocked: {count}',
      inspectKeptSections: 'Sections kept: {count}',
      inspectSectionRulesHint: 'Section rules use the chips above (DSH defaults included); only saving changes runtime injection.',
      inspectSectionRulesUnavailable: 'The live section list could not be read, so the blocked/kept split is unavailable; the rule counts above still hold.',
      inspectBlockedSectionsList: 'Sections blocked ({count})',
      inspectKeptSectionsList: 'Sections kept ({count})',
      inspectSurface: 'Inherited tool surface: {count}',
      inspectTools: 'Usable tools: {count}',
      inspectBlocked: 'Tools refused by the list: {count}',
      inspectSkills: 'Enabled skills: {count}',
      inspectSkillsOff: 'The skill tool is disabled, so no skill can load',
      inspectSkillsMissing: '{count} skills are no longer in the catalogue',
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
      statePending: 'Not registered',
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
      factBlocked: 'Refuse {count}',
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
        includeWorkspace: true,
        // LEFT UNDEFINED on purpose. `undefined` means "this preset does not
        // manage the snapshot", which is exactly what an unopened snapshot list
        // should stay: a NEW preset gets the fully-checked default from the
        // Host, and saving an old preset whose list was never touched keeps the
        // runtime behaving as it does today. Only an edit of this area turns it
        // into an array, and an array is then the strict whitelist.
        contexts: undefined,
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
    function copyName(source, taken) {
      const base = String(source?.name ?? '').trim()
      let index = 1
      let candidate = `${base}（复制 ${index}）`
      while (taken(candidate)) {
        index += 1
        candidate = `${base}（复制 ${index}）`
      }
      return candidate
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

    /** Split a rule list typed with commas (either width), `、`, or newlines. */
    function parseRuleList(raw) {
      return [
        ...new Set(
          String(raw ?? '')
            .split(/[,，、\n]/)
            .map((entry) => entry.trim())
            .filter((entry) => entry !== ''),
        ),
      ]
    }

    /**
     * The value a prefix is compared by: the verbatim string.
     *
     * The field is a PLAIN PREFIX list, not a namespace list: `a:b` matches
     * `a:b:c` (and anything else starting with `a:b`), and `api` matches
     * `api:docs` as well as `api-extra`. Nothing is appended or truncated, so
     * a chip shows exactly what will be compared; only surrounding whitespace
     * is dropped.
     */
    function normalizePrefix(entry) {
      return String(entry ?? '').trim()
    }

    /**
     * Chip editor for the three `custom-official` rule lists.
     *
     * The value IS the parsed list the draft carries, so adding or removing a
     * chip writes the array directly; there is no raw-text side state that
     * could drift from the save payload (the old comma box kept one, and its
     * trailing comma or half-typed namespace lived only in the input).
     *
     * Typing a separator commits the finished entries at once and keeps the
     * half-typed tail in the box; Enter and blur commit the tail as well.
     * Backspace on an empty box removes the last chip, and every chip has its
     * own `×`. The remove button cancels mousedown so the input keeps focus —
     * otherwise blur would commit pending text and the click would then compute
     * its removal from the pre-commit list, silently dropping one of the edits.
     */
    function TagInput(props) {
      const [text, setText] = useState('')
      const inputRef = useRef(null)
      // An IME's intermediate value must not be split on its punctuation: keep
      // the raw composition in the box and parse it once composition ends.
      const composing = useRef(false)
      const values = Array.isArray(props.value) ? props.value : []
      const keyOf = props.keyOf ?? ((entry) => entry)
      const emit = (next) => {
        const unchanged =
          next.length === values.length && next.every((entry, index) => entry === values[index])
        if (unchanged === false) props.onChange(next)
      }
      const append = (raw) => {
        const seen = new Set(values.map(keyOf))
        const next = [...values]
        for (const entry of parseRuleList(raw)) {
          const key = keyOf(entry)
          if (seen.has(key)) continue
          seen.add(key)
          next.push(entry)
        }
        emit(next)
      }
      const commit = (raw) => {
        append(raw)
        setText('')
      }
      const removeAt = (index) => emit(values.filter((_, position) => position !== index))
      const handleText = (raw) => {
        if (composing.current) {
          setText(String(raw ?? ''))
          return
        }
        // Everything before the last separator is a finished entry; whatever
        // follows it is still being typed.
        const pieces = String(raw ?? '').split(/[,，、\n]/)
        const tail = pieces.pop() ?? ''
        if (pieces.length > 0) append(pieces.join(','))
        setText(tail.replace(/^\s+/, ''))
      }
      const onKeyDown = (event) => {
        // An IME confirming a candidate must not submit the half-converted
        // text, so composing Enter/Backspace are ignored.
        if (event?.nativeEvent?.isComposing || event?.keyCode === 229) return
        if (event.key === 'Enter') {
          event.preventDefault?.()
          commit(text)
          return
        }
        if (event.key === 'Escape') {
          setText('')
          return
        }
        if (event.key === 'Backspace' && text === '' && values.length > 0) {
          event.preventDefault?.()
          removeAt(values.length - 1)
        }
      }
      return h(
        'div',
        { className: 'aps-tagEditor', onClick: () => inputRef.current?.focus() },
        values.map((entry, index) =>
          h(
            'span',
            { key: `${String(entry)}\u0000${index}`, className: 'aps-tag' },
            h('span', { className: 'aps-tagText' }, String(entry)),
            h(
              'button',
              {
                type: 'button',
                className: 'aps-tagRemove',
                'aria-label': format(props.t('tagRemove'), { name: String(entry) }),
                onMouseDown: (event) => event.preventDefault(),
                onClick: (event) => {
                  event.stopPropagation?.()
                  removeAt(index)
                },
              },
              '\u00d7',
            ),
          ),
        ),
        h('input', {
          ref: inputRef,
          className: 'aps-tagInput',
          type: 'text',
          value: text,
          placeholder: props.placeholder,
          'aria-label': props.ariaLabel,
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => handleText(event.target.value),
          onCompositionStart: () => {
            composing.current = true
          },
          onCompositionEnd: (event) => {
            composing.current = false
            handleText(event.target.value)
          },
          onPaste: (event) => {
            // A pasted list normally has no trailing separator, so the default
            // caret insertion would leave every item but the last in the box
            // until Enter. Paste-with-separators commits the whole list.
            const pasted = event?.clipboardData?.getData?.('text') ?? ''
            if (/[,，、\n]/.test(pasted) === false) return
            event.preventDefault?.()
            commit(pasted)
          },
          onKeyDown,
          onBlur: () => commit(text),
        }),
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
      // The custom-blocking filter is part of the runtime view: the Host
      // classifies live sections against the DRAFT rule set, so the panel must
      // show that partition next to the tool and context counts. Append/replace
      // never filter sections, so the block is silent there. An answer without
      // `sectionFilter` (an older Host) renders nothing rather than claiming 0.
      const sectionRules = props.customBlock === true ? view?.sectionFilter : undefined
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
                // The `custom-official` rule partition, shown with the same fact
                // chips as the tool and context counts. The rule counts are the
                // MERGED set (built-ins + the draft chips), which is what the
                // filter will really run with after a save.
                sectionRules === undefined
                  ? null
                  : h(
                      'div',
                      { className: 'aps-inspectCount' },
                      h(
                        'span',
                        { className: 'aps-fact' },
                        format(t('inspectSectionRules'), {
                          prefixes: sectionRules.rules?.prefixes ?? 0,
                          names: sectionRules.rules?.names ?? 0,
                          keep: sectionRules.rules?.keep ?? 0,
                        }),
                      ),
                      sectionRules.available === true
                        ? h(
                            'span',
                            { className: 'aps-fact' },
                            format(t('inspectBlockedSections'), { count: sectionRules.blocked ?? 0 }),
                          )
                        : null,
                      sectionRules.available === true
                        ? h(
                            'span',
                            { className: 'aps-fact' },
                            format(t('inspectKeptSections'), { count: sectionRules.kept ?? 0 }),
                          )
                        : null,
                    ),
                sectionRules === undefined
                  ? null
                  : h(
                      'p',
                      { className: 'aps-hint' },
                      sectionRules.available === true
                        ? t('inspectSectionRulesHint')
                        : t('inspectSectionRulesUnavailable'),
                    ),
                // The names behind the counts, in the same scrollable list as
                // tools and contexts: a count alone cannot tell an operator
                // whether the section they meant to block actually moved.
                sectionRules === undefined
                  ? null
                  : h(NameList, {
                      title: t('inspectBlockedSectionsList'),
                      names: sectionRules.blockedList,
                    }),
                sectionRules === undefined
                  ? null
                  : h(NameList, {
                      title: t('inspectKeptSectionsList'),
                      names: sectionRules.keptList,
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
     * The export dialog: check the presets to copy, with select-all controls.
     *
     * Its chrome is the shell's own `Modal`/`Button` primitives — the same
     * dialog surface every other DSH dialog uses — while the rows reuse the
     * page's own list styling, so nothing here invents a look. Copying runs
     * here; a failure stays in the dialog, a success closes it and lets the
     * page show the notice.
     * @param props - the roster rows, the locale resolver, and the close/done hooks.
     * @returns the open dialog element.
     */
    function ExportDialog(props) {
      const t = props.t
      const rows = props.rows
      // Everything is checked by default: the old behaviour exported all of
      // them, and one deselect is cheaper than re-picking each one.
      const [selected, setSelected] = useState(() => new Set(rows.map((row) => row.id)))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      // A copy in flight owns the dialog: it cannot be closed under itself.
      const close = () => {
        if (busy === false) props.onClose()
      }
      const shownIds = rows.map((row) => row.id)
      const chosen = rows.filter((row) => selected.has(row.id))
      const toggle = (id) => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelected(next)
      }
      const copy = async () => {
        setBusy(true)
        setError('')
        try {
          await copyText(JSON.stringify(chosen, null, 2))
        } catch (err) {
          setError(format(t('exportFailed'), { message: String(err?.message ?? err) }))
          setBusy(false)
          return
        }
        setBusy(false)
        props.onDone(chosen.length)
      }
      const body =
        rows.length === 0
          ? h('p', { className: 'aps-hint' }, t('exportEmpty'))
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
                  { type: 'button', className: 'aps-linkButton', disabled: busy, onClick: () => setSelected(new Set(shownIds)) },
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
                      { key: row.id, className: 'aps-row' },
                      h('input', { type: 'checkbox', checked: selected.has(row.id), disabled: busy, onChange: () => toggle(row.id) }),
                      h(
                        'span',
                        { className: 'aps-rowBody' },
                        h('span', { className: 'aps-rowName' }, row.name),
                        h('span', { className: 'aps-rowMeta' }, row.description !== '' ? row.description : row.id),
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
          title: t('exportSelectTitle'),
          description: t('exportSelectHint'),
          footer: h(
            React.Fragment,
            null,
            h(UI.Button, { variant: 'outline', disabled: busy, onClick: close }, t('cancel')),
            h(UI.Button, { variant: 'primary', disabled: busy || chosen.length === 0, onClick: copy }, t('exportCopy')),
          ),
        },
        body,
      )
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
      const [orderBasis] = useState(() => [...checked])
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
      const ranked = [...rows].sort((left, right) => {
        const leftRank = orderBasis.includes(left.name) ? 0 : 1
        const rightRank = orderBasis.includes(right.name) ? 0 : 1
        return leftRank - rightRank
      })
      const optional = ranked.filter((row) => row.required !== true).map((row) => row.name)
      // `checked` also carries the required rows that currently inject; the two
      // bulk actions move only the optional half, so required names are
      // narrowed out here rather than relying on the caller to drop them.
      const writeOptional = (next) => props.onChange(next.filter((name) => optional.includes(name)))
      return h(
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
              onClick: () => writeOptional([...checked, ...optional]),
            },
            t('selectAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'aps-linkButton',
              onClick: () => writeOptional([]),
            },
            t('clearSelection'),
          ),
          h('span', { className: 'aps-hint' }, format(t('selectedCount'), { count: checked.length })),
        ),
        registryHint,
        runtimeHint,
        h(
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
      // --- the `custom-official` rule set -----------------------------------
      // Three optional lists on the preset, edited as chips. An EMPTY or ABSENT
      // field means "the built-in namespaces", so an untouched field shows no
      // chips and the built-in lists are stated in the note below the fields —
      // pre-filling them would make an unedited field look edited. A chip
      // writes the PARSED array the Host stores; removing every chip writes
      // `[]`, which the Host reads as "no override", never as "inherit the
      // previous value".
      const ruleDefaults = meta.sectionRuleDefaults ?? {}
      const ruleValuesOf = (field) => (Array.isArray(draft[field]) ? draft[field] : [])
      // The rule is ADDITIVE: the built-in namespaces are merged in by the Host
      // no matter what these fields say, so removing one chip cannot switch it
      // off. Say it out loud the moment a field stops listing one — otherwise
      // "I removed ui: and it still gets filtered" looks like a bug.
      // An EMPTY field is not "I dropped everything" — it is "use the built-in
      // list", which is exactly what the Host does. Only a field that carries
      // entries can be missing one, so the notice is silent while it is empty.
      const typedPrefixes = ruleValuesOf('sectionRulePrefixes')
      const typedNames = ruleValuesOf('sectionRuleNames')
      const typedNameSet = new Set(typedNames)
      // Prefixes are PLAIN prefixes, so a typed prefix COVERS a built-in entry
      // when the built-in starts with it: `deployment` covers the built-in
      // `deployment:` (and anything else with that prefix). Comparing verbatim
      // would wrongly report the built-in as missing.
      const coversDefaultPrefix = (prefix) =>
        typedPrefixes.some((typed) => {
          const value = normalizePrefix(typed)
          return value !== '' && normalizePrefix(prefix).startsWith(value)
        })
      const droppedDefaults = [
        ...(typedPrefixes.length === 0
          ? []
          : (ruleDefaults.prefixes ?? []).filter((prefix) => coversDefaultPrefix(prefix) === false)),
        ...(typedNames.length === 0
          ? []
          : (ruleDefaults.names ?? []).filter((name) => typedNameSet.has(name) === false)),
      ]
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
          // The `custom-official` rules ride along for the same reason: the Host
          // re-classifies live sections against THESE chips, so the leak
          // warning follows every add/remove instead of the last save. An
          // emptied field is sent as `[]` and the Host falls back to the
          // built-ins, exactly as saving would.
          const value = await callApi('inspect', {
            id: draft.id,
            config: {
              tools: selection,
              skills: draft.skills ?? [],
              contexts: contextState.checked,
              requiredSuppressed: contextState.forced,
              sectionRulePrefixes: ruleValuesOf('sectionRulePrefixes'),
              sectionRuleNames: ruleValuesOf('sectionRuleNames'),
              sectionRuleKeep: ruleValuesOf('sectionRuleKeep'),
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
      // hint. The snapshot part of the key uses the DERIVED checked names, the
      // same list `runInspect` sends, so an unmanaged → managed transition and
      // every individual toggle both re-read exactly once.
      const inspectKey = `${draft.id}\u0000${selection.mode}\u0000${selection.names.join(',')}\u0000${(draft.skills ?? []).join(',')}\u0000${checkedContexts.join(',')}\u0000${contextState.forced.join(',')}\u0000${(draft.sectionRulePrefixes ?? []).join(',')}\u0000${(draft.sectionRuleNames ?? []).join(',')}\u0000${(draft.sectionRuleKeep ?? []).join(',')}`
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
                    : draft.instructionMode === 'custom-official'
                      ? t('modeCustomBlockHint')
                      : t('modeAppendHint'),
              },
              h(Segmented, {
                label: t('instructionMode'),
                value: draft.instructionMode,
                options: [
                  { value: 'append', label: t('modeAppend') },
                  { value: 'complete', label: t('modeComplete') },
                  { value: 'custom-official', label: t('modeCustomBlock') },
                ],
                onChange: (value) => patch({ instructionMode: value }),
              }),
            ),
            // The rule set only means anything in `custom-official` mode, so its
            // three chip fields appear exactly then — the same place the mode
            // is chosen, using the same Field scaffold as every other row.
            ...(draft.instructionMode === 'custom-official'
              ? [
                  h(
                    Field,
                    {
                      key: 'official-prefixes',
                      label: t('officialPrefixes'),
                      hint: format(t('officialPrefixesHint'), { count: (ruleDefaults.prefixes ?? []).length }),
                      example: t('officialPrefixesExample'),
                    },
                    h(TagInput, {
                      t,
                      value: ruleValuesOf('sectionRulePrefixes'),
                      keyOf: normalizePrefix,
                      onChange: (next) => patch({ sectionRulePrefixes: next }),
                      placeholder: t('officialPrefixesPlaceholder'),
                      ariaLabel: t('officialPrefixes'),
                    }),
                  ),
                  h(
                    Field,
                    {
                      key: 'official-names',
                      label: t('officialNames'),
                      hint: t('officialNamesHint'),
                      example: t('officialNamesExample'),
                    },
                    h(TagInput, {
                      t,
                      value: ruleValuesOf('sectionRuleNames'),
                      onChange: (next) => patch({ sectionRuleNames: next }),
                      placeholder: t('officialNamesPlaceholder'),
                      ariaLabel: t('officialNames'),
                    }),
                  ),
                  h(
                    Field,
                    {
                      key: 'official-keep',
                      label: t('officialKeep'),
                      hint: t('officialKeepHint'),
                      example: t('officialKeepExample'),
                    },
                    h(TagInput, {
                      t,
                      value: ruleValuesOf('sectionRuleKeep'),
                      onChange: (next) => patch({ sectionRuleKeep: next }),
                      placeholder: t('officialKeepPlaceholder'),
                      ariaLabel: t('officialKeep'),
                    }),
                  ),
                  ...(droppedDefaults.length === 0
                    ? []
                    : [
                        h(
                          'p',
                          { key: 'official-dropped-note', className: 'aps-hint' },
                          format(t('officialDroppedHint'), {
                            names: droppedDefaults.join(t('contextsNameSeparator')),
                          }),
                        ),
                      ]),
                  h(
                    'p',
                    { key: 'official-rules-note', className: 'aps-hint' },
                    t('officialRulesSectionHint'),
                  ),
                  // The chip fields do not prefill, so the built-in lists are
                  // stated here instead: an operator can still see what the
                  // filter does by default without the page pretending the
                  // field has been edited.
                  h(
                    'p',
                    { key: 'official-defaults-note', className: 'aps-hint' },
                    format(t('officialDefaultsList'), {
                      prefixes: (ruleDefaults.prefixes ?? []).join(t('contextsNameSeparator')),
                      names: (ruleDefaults.names ?? []).join(t('contextsNameSeparator')),
                    }),
                  ),
                ]
              : []),
            h(
              Field,
              { label: t('includeWorkspace'), hint: t('includeWorkspaceHint') },
              h('label', { className: 'aps-toggle' },
                h('input', {
                  type: 'checkbox',
                  checked: draft.includeWorkspace !== false,
                  onChange: (event) => patch({ includeWorkspace: event.target.checked }),
                }),
                h('span', {}, t('includeWorkspaceOn')),
              ),
            ),
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
            customBlock: draft.instructionMode === 'custom-official',
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
          // The snapshot list is saved as what the panel SHOWED (its derived
          // checked names), for a new and an existing preset alike. An
          // unmanaged preset therefore persists the fully-checked list it was
          // displaying — the same behavior, now explicit and editable — instead
          // of silently staying unmanaged behind the user's back. The catalog
          // already folds in every name observed for any preset, so a
          // third-party row that exists in this process cannot be dropped by
          // the write. When the catalog is empty the field is left exactly as
          // the draft has it: writing an empty whitelist from a page that was
          // shown no rows would block every optional context by accident.
          const catalog = state.meta?.contextCatalog ?? []
          // NO catalog means the page never saw which names are optional and
          // which are required, so it cannot recompute either half — rewriting
          // them from an empty view would silently blank a stored whitelist
          // (blocking every optional context) or drop an existing force list.
          // Send the draft's own fields untouched and let the Host keep them.
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
          const payload = {
            ...draft,
            ...(catalogKnown ? { contexts: contextWhitelistOf(draft, catalog) } : {}),
            ...(catalogKnown &&
              (draftForced.length > 0 || Array.isArray(draft.requiredSuppressed)) &&
              forceSupported
              ? { requiredSuppressed: draftForced }
              : {}),
          }
          const result = await callApi('save', payload)
          setNotice(zh.saved)
          setDraft(null)
          await refresh()
          return result
        }, zh.saveFailed)
      const remove = (preset) =>
        run(async () => {
          await callApi('delete', { id: preset.id })
          setConfirming(null)
          await refresh()
        }, zh.deleteFailed)
      const toggle = (preset) =>
        run(async () => {
          await callApi('toggle', { id: preset.id })
          await refresh()
        }, zh.saveFailed)
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
            includeWorkspace: preset.includeWorkspace !== false,
            // Copied as-is, array or absence: an unmanaged source yields an
            // unmanaged copy, a managed one keeps its exact whitelist. The
            // advanced force-suppress list rides along for the same reason — a
            // duplicate is a copy, not a fresh default.
            contexts: Array.isArray(preset.contexts) ? [...preset.contexts] : preset.contexts,
            requiredSuppressed: Array.isArray(preset.requiredSuppressed)
              ? [...preset.requiredSuppressed]
              : preset.requiredSuppressed,
            skills: [...(preset.skills ?? [])],
            tools: { mode: 'all', names: [], ...(preset.tools ?? {}) },
            enabled: preset.enabled !== false,
            insertAfter: preset.id,
          }
          const result = await callApi('save', copy)
          setNotice(format(t('copyDone'), { name: copy.name }))
          await refresh()
          return result
        }, zh.copyFailed)
      /** The export dialog finished its copy; close it and report the count. */
      const exportDone = (count) => {
        setExporting(false)
        setNotice(format(t('exportHint'), { count }))
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
        error ? h('p', { className: 'aps-error' }, error) : null,
        notice ? h('p', { className: 'aps-notice' }, notice) : null,
        state.meta?.registryAvailable === false ? h('p', { className: 'aps-warn' }, t('registryMissing')) : null,
        h(
          'div',
          { className: 'aps-groupHeadRow' },
          h('h3', { className: 'aps-groupHead' }, t('nav')),
          h(
            'div',
            { className: 'aps-groupHeadActions' },
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
          ),
        ),
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
                        includeWorkspace: target.includeWorkspace !== false,
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
              rows: toExportRoster(presets),
              onClose: () => setExporting(false),
              onDone: exportDone,
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
