/**
 * dsh-my-agent-preset — Host half.
 *
 * Owns the custom Agent presets the Settings page edits:
 * - persists them to one JSON document under `$DSH_HOME`,
 * - registers each enabled preset into `ctx.agentPresets` at runtime, so the
 *   preset appears in the New-Session roster without editing the profile,
 * - serves a loopback-only JSON API the Settings page calls.
 *
 * Two catalogs drive the editor and both are read live from the runtime —
 * and BOTH must be read through a preset's standing scope, because neither
 * the tools registry nor the skills registry lives on the Host's global
 * layer:
 * - skills: `skills.list({ scope: lease.key })` — the layered registry's
 *   winning catalog. The registry AND its filesystem provider mount inside
 *   every Agent preset's composition (the `dsh-base` rows), so a bare
 *   Host-side `skills.list({})` answers EMPTY. Every summary's `source` is
 *   the page's per-source grouping.
 * - tools:  `tools.schemas(lease.key)` through the registry's `acquireScope`
 *   lease — the exact standing scope Agents of that preset are parented to,
 *   which is how `dsh-tool-manager` reads a preset's real tool surface.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { PERSONA_SECTION_NAMES, resolveSectionSelection } from './capability.js'

/** Settings page API prefix; the Client half fetches these exact paths. */
const API_PREFIX = '/api/dsh-my-agent-preset'
/** Package-relative specifier of the preset capability row. */
const CAPABILITY_PLUGIN = 'dsh-my-agent-preset/capability'
/** Cordis row declaring one Agent preset. */
const PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'
/** Cordis row owning the preset registry and its deployment default. */
const REGISTRY_PLUGIN = '@deepseek-ai/dsh-agent-preset-registry'
/** Rows whose identity is the deployment persona; the page owns prompt text. */
const PERSONA_ROW_NAMES = new Set(['@deepseek-ai/dsh-persona'])
/** The tool through which the model loads a skill body; skills always keep it. */
const SKILL_TOOL = 'skill'
/** Reserved presentation transport `restrict` refuses to name. */
const RESERVED_TOOL = 'run_code'
/** Request bodies are small JSON documents. */
const MAX_BODY_BYTES = 512 * 1024

/** Read a trimmed string, or ''. */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Read one error message. */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}

/** DSH home: the preset document and the skill hints share it. */
function dshHome() {
  return text(process.env.DSH_HOME) || join(homedir(), '.dsh')
}

/** Default preset document: one file per DSH home, not per profile. */
function defaultDataFile() {
  return join(dshHome(), 'my-agent-preset', 'presets.json')
}

/** Accept only requests that arrived over the loopback interface. */
function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress
  if (typeof address !== 'string' || address === '') return false
  if (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1') return true
  if (address.startsWith('::ffff:')) return address.slice(7).startsWith('127.')
  return address.startsWith('127.')
}

/** Write one JSON response. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json;charset=UTF-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** Read a bounded JSON request body. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Success envelope. */
function ok(value) {
  return { ok: true, value }
}

/** Failure envelope; the Client half surfaces `error.message`. */
function fail(error) {
  return { ok: false, error: { code: 'my-agent-preset', message: message(error) } }
}

/** Generate a stable, ASCII, collision-free preset id. */
function generateId() {
  return `custom-${randomBytes(4).toString('hex')}`
}

/** Deep-copy one loader row, keeping `{ __jsExpr }` condition objects intact. */
function cloneRow(row) {
  try {
    return structuredClone(row)
  } catch {
    return JSON.parse(JSON.stringify(row))
  }
}

/** Read a list of non-empty trimmed strings. */
function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))]
    : []
}

/** Normalize a `{ mode, names }` tool selection. */
function normalizeToolSelection(value) {
  const mode = value?.mode === 'allow' || value?.mode === 'deny' ? value.mode : 'all'
  const names = stringList(value?.names)
  return { mode: names.length === 0 ? 'all' : mode, names }
}

/**
 * Recover the known restrictable names from a `restrict()` rejection.
 *
 * `restrict()` refuses a name it does not know as an inherited tool and
 * reports the full set in its error text. `dsh-tool-manager` parses that set
 * and retries with the intersection, so one stale name cannot silently void
 * the whole list — this mirrors its `parseKnownRestrictable`.
 * @param error - the thrown rejection.
 * @returns the known names, or undefined when the error carries no set.
 */
function parseKnownRestrictable(error) {
  const raw = message(error)
  const marker = 'known global tools: '
  const index = raw.lastIndexOf(marker)
  if (index < 0) return undefined
  const listed = raw.slice(index + marker.length).trim()
  if (listed === '' || listed === '(none)') return new Set()
  return new Set(
    listed
      .split(', ')
      .map((item) => item.trim())
      .filter((item) => item !== ''),
  )
}

/**
 * Whether an Agent's context can no longer host new effects.
 *
 * Cordis disposes a fiber asynchronously: the uid clears FIRST, and every
 * later `ctx.effect()` — `restrict()`, `guard()`, even `ctx.on()` — throws
 * `INACTIVE_EFFECT`. The Agent leaves the roster only after that, so a sweep
 * reading `agents.list()` can meet one whose fiber is already gone and crash
 * the Host on the next registration. Probing with the same `assertActive()`
 * the effect layer uses answers the question without private fields.
 * @param agent - the Agent to test.
 * @returns true when installing a scope on this Agent would throw.
 */
function agentScopeDead(agent) {
  const fiber = agent?.ctx?.fiber
  if (fiber === undefined || fiber === null) return true
  try {
    fiber.assertActive()
    return false
  } catch {
    return true
  }
}

/** Normalize one preset's prompt-injection mode. */
function normalizeInstructionMode(value) {
  return value === 'complete' || value === 'custom' ? value : 'append'
}

/**
 * The runtime-context (snapshot) contributions DSH's own rows register.
 *
 * The snapshot the model sees is `joinContextSections(assembly.contexts)`: a
 * `contexts` field, SEPARATE from `sections`. Neither `complete: true` nor the
 * custom section filter touches it, so today the snapshot injects in full no
 * matter which injection mode a preset picks. `CONTEXT_CATALOG` mirrors every
 * `systemPrompt.context()` registration in the bundled rows, with the exact
 * `name` each one uses, its `CONTEXT_ORDERS` sort key, and whether it is
 * `required`.
 *
 * `required` is not a preference — `dsh-system-prompt`'s `assemble()` and
 * `refreshContext()` force `required === true` entries back into every
 * assembly, so no plugin can suppress them. The page shows those checked and
 * DISABLED rather than offering a switch that cannot work.
 *
 * This table is a FALLBACK, not the authority. `readContextRegistry()` reads
 * the same `layers.merge(scope, …)` view `assemble()` uses, so `required` and
 * `order` come from the build that is running; the values here only answer for
 * a build whose registry cannot be read (and supply the Chinese labels, which
 * the registry does not carry). Keeping the two in sync by hand is exactly the
 * staleness this split avoids.
 *
 * `tool:<name>:depth` is registered per delegating tool, so its name is
 * dynamic; it is not a catalog row and reaches the list through the runtime
 * observation table (or straight from the live registry, when readable).
 */
const CONTEXT_CATALOG = [
  {
    name: 'working-directory:current',
    label: '当前工作区',
    description: '会话当前的工作目录（工作目录变更也会体现在这里）。',
    order: 100,
    required: true,
  },
  {
    name: 'sandbox:policy',
    label: '沙箱策略',
    description: '本会话的文件沙箱模式（受限写入 / 完全访问等）。',
    order: 110,
    required: false,
  },
  {
    name: 'approval:policy',
    label: '审批策略',
    description: '当前是否需要人工审批操作的提示语。',
    order: 115,
    required: false,
  },
  {
    name: 'subagent:delegation',
    label: '子 Agent 委派说明',
    description: '仅在该 Agent 是被委派的子 Agent 时才有内容。',
    order: 120,
    required: false,
  },
  {
    name: 'team:identity',
    label: '团队身份',
    description: '仅在加入 Agent 团队时才有内容，且官方标记为必需。',
    order: 125,
    required: true,
  },
  {
    name: 'harness:source',
    label: 'Harness 实现检出路径',
    description: '当前 DSH 实现的检出目录。',
    order: 200,
    required: false,
  },
  {
    name: 'app:web-surface',
    label: 'Web GUI 地址',
    description: '当前 DeepSeek Harness Web GUI 的 URL。',
    order: 210,
    required: false,
  },
]

/** Context names the registry restores by force; suppressible by nobody. */
const REQUIRED_CONTEXT_NAMES = new Set(
  CONTEXT_CATALOG.filter((entry) => entry.required === true).map((entry) => entry.name),
)

/** Catalog sort key per name, so a shadow re-registers at the official place. */
const CONTEXT_ORDERS = new Map(CONTEXT_CATALOG.map((entry) => [entry.name, entry.order]))

/**
 * Read the prompt registry's OWN context table through one scope.
 *
 * `CONTEXT_CATALOG` is a copy of the bundled rows taken at build time, so its
 * `required` and `order` columns go stale the moment a DSH build adds, removes
 * or re-flags a context — and `required` is not cosmetic: the registry's
 * `assemble()`/`refreshContext()` restore exactly the entries carrying
 * `required === true`. A stale table therefore shows a closable row that the
 * runtime keeps restoring (or a locked row that no longer exists).
 *
 * The registry keeps that table in `SystemPrompt.layers`, and
 * `ScopedLayers.merge(scope, pick)` is the exact view `assemble()` itself
 * reads — same chain, same shadowing. Reading it here makes the page and the
 * filter follow the RUNNING build instead of this plugin's release date.
 *
 * Every part of this is probed, never assumed: `layers`/`merge` are not
 * documented API, so a build that renames them must degrade to the static
 * table rather than break the page. `undefined` is that signal.
 * @param ctx - the Host plugin context.
 * @param scope - a scope key (a preset's standing scope), or undefined for
 *   the global view.
 * @returns `Map<name, { order, required }>` for every registered context, or
 *   undefined when the registry cannot be read.
 */
function readContextRegistry(ctx, scope) {
  let prompt
  try {
    prompt = ctx?.get?.('systemPrompt')
  } catch {
    return undefined
  }
  const layers = prompt?.layers
  if (layers === undefined || layers === null || typeof layers.merge !== 'function') return undefined
  try {
    const merged = layers.merge(scope, (layer) => layer.contexts)
    if (merged === null || merged === undefined || typeof merged.entries !== 'function') return undefined
    const table = new Map()
    for (const [name, entry] of merged.entries()) {
      if (typeof name !== 'string' || name === '') continue
      const order = typeof entry?.order === 'number' && Number.isFinite(entry.order) ? entry.order : undefined
      table.set(name, { order, required: entry?.required === true })
    }
    return table.size > 0 ? table : undefined
  } catch {
    return undefined
  }
}

/**
 * Every prompt-section name the registry knows through one scope.
 *
 * Used by the page's section catalog and by the self-check report: the
 * checklist selects exact names, so the editor must list the sections the
 * RUNNING build actually carries. Returns undefined when the registry cannot
 * be read (the same probe as above), which the report presents as unavailable
 * instead of claiming an empty surface.
 * @param ctx - the Host plugin context.
 * @param scope - a scope key, or undefined for the global view.
 * @returns the section names, or undefined.
 */
function readSectionNames(ctx, scope) {
  let prompt
  try {
    prompt = ctx?.get?.('systemPrompt')
  } catch {
    return undefined
  }
  const layers = prompt?.layers
  if (layers === undefined || layers === null || typeof layers.merge !== 'function') return undefined
  try {
    const merged = layers.merge(scope, (layer) => layer.sections)
    if (merged === null || merged === undefined || typeof merged.keys !== 'function') return undefined
    const names = new Set()
    for (const name of merged.keys()) if (typeof name === 'string' && name !== '') names.add(name)
    return names.size > 0 ? names : undefined
  } catch {
    return undefined
  }
}

/**
 * Normalize the ADVANCED force-suppress list for required contexts.
 *
 * DSH's own contract says a `required: true` context cannot be suppressed:
 * `assemble()` and `refreshContext()` restore it every step, and
 * `dsh-working-directory` re-`unshift`s it from a `prepend` assembly listener.
 * The page offers an OPT-IN escape hatch anyway, because the contract is not a
 * wall — two opposing moves defeat it, both verified against the live registry:
 *
 *   1. register a SAME-NAME context into the Agent's own scope WITHOUT the
 *      `required` flag — scoped entries shadow globals by name in the merge,
 *      so the registry no longer sees this contribution as required, and
 *      `refreshContext()` stops restoring it;
 *   2. run this plugin's assembly filter with `prepend: true` so its deletion
 *      lands OUTSIDE the official repair listener (which is also `prepend`, and
 *      every later `prepend` registration sits further out).
 *
 * Both rest on implementation details, not on any documented API: a DSH upgrade
 * that reorders the listeners or changes how `required` merges will silently
 * void the suppression — no error, just a context back in the prompt. Hence
 * default-off, and hence the page says so plainly.
 *
 * The list is NOT filtered against this plugin's shipped `required` table: a
 * DSH build may protect a context this release has never heard of, and the
 * page must still be able to force-suppress it. A name that turns out not to
 * be required lands in the same "blocked" bucket the ordinary whitelist
 * already produces, so the wider list cannot make anything inject.
 */
function normalizeRequiredSuppression(value) {
  if (!Array.isArray(value)) return undefined
  const names = stringList(value)
  return names.length > 0 ? names : undefined
}

/**
 * Normalize one stored runtime-context whitelist.
 *
 * ABSENT (not an array) means this preset manages nothing: the snapshot is
 * left exactly as DSH builds it, so presets saved before this feature keep
 * their behavior without a migration write. PRESENT means the array is the
 * whole truth — a name outside it is suppressed (required names excepted).
 */
function normalizeContexts(value) {
  return Array.isArray(value) ? stringList(value) : undefined
}

/**
 * Normalize one stored SECTION keep list.
 *
 * ABSENT (not an array) means this preset does not manage sections: the
 * assembled prompt is left untouched, which is what the page shows as
 * "everything checked". PRESENT means the array is the whole truth — a section
 * outside it is removed, except the preset's own persona sections (see
 * `PERSONA_SECTION_NAMES`).
 * @param value - the stored `sections` field.
 * @returns the deduplicated name list, or undefined when unmanaged.
 */
function normalizeSections(value) {
  return Array.isArray(value) ? [...new Set(stringList(value))] : undefined
}

/**
 * Normalize the ADVANCED force-suppress list for persona sections.
 *
 * Those two sections carry the prompt text the user authored, so the runtime
 * keeps them even when the checklist omits them. The escape hatch is offered
 * only for those exact names: any other section is already removed by leaving
 * it unchecked, so storing such a name would misreport what happened.
 * @param value - the stored `sectionsSuppressed` field.
 * @returns the deduplicated protected names, or undefined when empty.
 */
function normalizeSectionSuppression(value) {
  if (!Array.isArray(value)) return undefined
  const names = stringList(value).filter((name) => PERSONA_SECTION_NAMES.includes(name))
  return names.length > 0 ? [...new Set(names)] : undefined
}

/** Normalize one stored preset, merging the legacy call-level block list. */
export function normalizePreset(input) {
  if (input === null || typeof input !== 'object') return undefined
  const id = text(input.id)
  const name = text(input.name)
  if (id === '' || name === '') return undefined
  const now = new Date().toISOString()
  // One tool selection now drives both visibility and call refusal, so the
  // legacy `excludedTools` list is folded in: under `allow` a blocked name is
  // dropped from the list (it is refused by omission), under `deny` it joins
  // the list (both effects agree).
  const selection = normalizeToolSelection(input.tools)
  const legacyBlocked = stringList(input.excludedTools)
  let toolNames = selection.names
  if (selection.mode === 'allow') toolNames = toolNames.filter((name) => legacyBlocked.includes(name) === false)
  else if (selection.mode === 'deny') toolNames = [...new Set([...toolNames, ...legacyBlocked])]
  return {
    id,
    name,
    description: text(input.description),
    instructions: typeof input.instructions === 'string' ? input.instructions : '',
    instructionMode: normalizeInstructionMode(input.instructionMode),
    // The section checklist, carried ON the preset: an absent array means the
    // preset manages nothing (every section injects), while an array is the
    // strict keep list the runtime filter applies. The ADVANCED force list is
    // the only thing that can remove the preset's own persona sections.
    sections: normalizeSections(input.sections),
    sectionsSuppressed: normalizeSectionSuppression(input.sectionsSuppressed),
    // Absent (not an array) = this preset does not manage the runtime-context
    // snapshot at all; present = the array is the strict whitelist of
    // suppressible context names (required names are always injected anyway,
    // unless the field below force-suppresses them).
    contexts: normalizeContexts(input.contexts),
    // ADVANCED opt-in: required names to force-suppress against DSH's contract.
    // Absent/empty = the contract holds (the default). See
    // `normalizeRequiredSuppression` for why this is off by default.
    requiredSuppressed: normalizeRequiredSuppression(input.requiredSuppressed),
    skills: stringList(input.skills),
    tools: { mode: toolNames.length === 0 ? 'all' : selection.mode, names: toolNames },
    enabled: input.enabled !== false,
    order: Number.isFinite(input.order) ? input.order : 0,
    createdAt: text(input.createdAt) || now,
    updatedAt: text(input.updatedAt) || now,
  }
}

/**
 * Partition one context surface against a preset's whitelist.
 *
 * The answer is the same shape for the editor's live preview (the `inspect`
 * endpoint) and for the runtime filter: a name survives when the whitelist
 * lists it, or when the registry marks it required and the ADVANCED
 * force-suppress list does not name it. Names the whitelist carries that the
 * surface does not are simply kept invisible — they may reappear when the
 * plugin that registers them loads again.
 * @param surfaceNames - the context names visible for this preset.
 * @param allowed - the stored/draft whitelist, or undefined when the preset
 *   manages nothing (then nothing is blocked except a forced required name).
 * @param forced - required names the preset force-suppresses (the escape
 *   hatch); they land in `blocked` despite the registry's force-restore.
 * @returns `{ kept, blocked, managed }`, catalog-ordered (unknown observed
 *   names last, ties by name). `managed` is false only when NOTHING is being
 *   filtered, so the page can say so instead of implying an explicit choice.
 */
export function resolveContextSelection(
  surfaceNames,
  allowed,
  forced = [],
  requiredNames = REQUIRED_CONTEXT_NAMES,
  orders = CONTEXT_ORDERS,
) {
  // `requiredNames` and `orders` are supplied by the caller from the LIVE
  // registry when it could be read (see `readContextRegistry`), so the
  // question "is this row closable?" is answered by the build that is running
  // rather than by this plugin's build-time copy of the table. The defaults
  // keep every existing caller — and a Host whose registry cannot be read —
  // on the exact old behavior.
  const required = requiredNames instanceof Set ? requiredNames : new Set(requiredNames ?? [])
  const orderTable = orders instanceof Map ? orders : CONTEXT_ORDERS
  // A suppressed name is blocked only when the RUNTIME still protects it.
  // `required` is the live answer when the caller has one, so a row a newer
  // build protects is suppressible and a row it stopped protecting is ignored
  // here — the plain whitelist already blocks that one, and listing it as
  // "force-suppressed" would misreport what happened.
  const suppress = new Set(
    forced.filter((name) => typeof name === 'string' && name !== '' && required.has(name)),
  )
  const allow = allowed === undefined ? undefined : new Set(allowed)
  const names = [...new Set(surfaceNames.filter((name) => typeof name === 'string' && name !== ''))]
  const compare = (left, right) =>
    (orderTable.get(left) ?? Number.MAX_SAFE_INTEGER) - (orderTable.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    left.localeCompare(right)
  const keep = (name) =>
    suppress.has(name) === false && (required.has(name) || (allow === undefined ? true : allow.has(name)))
  const kept = names.filter(keep)
  const blocked = names.filter((name) => keep(name) === false)
  return {
    kept: kept.sort(compare),
    blocked: blocked.sort(compare),
    // False only when NOTHING is filtered: an unmanaged whitelist AND no forced
    // suppression. The page says so instead of implying an explicit choice.
    managed: allowed !== undefined || suppress.size > 0,
    // The required names this answer blocks against the registry's contract —
    // only ever non-empty when the opt-in escape hatch is on.
    forced: names.filter((name) => suppress.has(name)).sort(compare),
  }
}

/**
 * Insert one preset after its copy source and re-index every order.
 *
 * The page keeps presets in document order; the registry sorts rows by
 * `order` (ties by id), so a copy that must appear directly after its source
 * in BOTH lists gets inserted in the document and the whole column is then
 * re-indexed to the document position. Extracted as a pure function so the
 * regression test drives the exact code the endpoint uses.
 * @param presets - the store's current list (mutated in place).
 * @param next - the normalized preset to insert.
 * @param insertAfterId - source id; anything else appends at the end.
 * @returns nothing; the caller persists the mutated list.
 */
export function insertAndReindex(presets, next, insertAfterId) {
  const sourceIndex = presets.findIndex((preset) => preset.id === insertAfterId)
  if (sourceIndex >= 0) presets.splice(sourceIndex + 1, 0, next)
  else presets.push(next)
  presets.forEach((preset, index) => {
    preset.order = index
  })
}

/** A row's stable key inside its declaration. */
function rowKey(row) {
  return text(row?.id) || text(row?.name)
}

/**
 * Turn one stored preset into the registry definition the loader mounts.
 *
 * Every non-persona baseline row is copied, so a custom preset is never an
 * empty shell: its Agents keep the deployed built-in tools, and the page's
 * tool menu narrows that surface instead of rebuilding it row by row.
 * @param preset - a normalized preset.
 * @param baselineRows - rows of the deployed baseline preset.
 * @param skillIndex - name → `{ path, description }` for the selected skills.
 * @returns the definition handed to `ctx.agentPresets.register()`.
 */
export function toDefinition(preset, baselineRows = [], skillIndex = new Map()) {
  const plugins = []
  // Each selected skill is passed with its own source path, so the preset's
  // provider reads the skill document directly — the same way the skills
  // manager reads external skills — instead of borrowing the global catalog.
  const selectedSkills = preset.skills.map((name) => {
    const found = skillIndex.get(name)
    return { name, path: text(found?.path), description: text(found?.description) }
  })
  // Skills are managed independently of the tool list. Without this the allow
  // list would quietly refuse the `skill` tool and every checked skill with
  // it — the catalog would not even load. A preset that checks any skill
  // therefore always keeps `skill`, whatever the list says.
  const selection = preset.tools ?? { mode: 'all', names: [] }
  const toolSelection =
    selection.mode === 'allow' && selectedSkills.length > 0 && selection.names.includes(SKILL_TOOL) === false
      ? { mode: 'allow', names: [...selection.names, SKILL_TOOL] }
      : selection
  // The capability row is mounted for EVERY custom preset: its `skills` array
  // is a WHITELIST, and even an empty one must trim the discovered skills out
  // of the model's catalog ("nothing checked" means NONE, not "no trimming").
  // The former `needsCapability` short-circuit skipped the row for a preset
  // with no prompt, no skill and an open tool list — exactly the preset that
  // checked nothing — and every discovered skill marched straight back into
  // the Agent's Skill catalog.
  plugins.push({
    id: 'studio-capability',
    name: CAPABILITY_PLUGIN,
    config: {
      // The capability row installs per-Agent scope, and it can only know
      // which Agents joined this preset by matching this id against
      // `agentPresets.composedPreset(agent.ctx)`.
      presetId: preset.id,
      instructions: preset.instructions,
      instructionMode: preset.instructionMode,
      skills: selectedSkills,
      tools: toolSelection,
      // The checklist travels with the preset, so the filter a stored preset
      // runs is exactly what its own data file describes.
      ...(Array.isArray(preset.sections) ? { sections: preset.sections } : {}),
      ...(Array.isArray(preset.sectionsSuppressed) ? { sectionsSuppressed: preset.sectionsSuppressed } : {}),
    },
  })
  for (const row of Array.isArray(baselineRows) ? baselineRows : []) {
    const name = text(row?.name)
    if (PERSONA_ROW_NAMES.has(name) || rowKey(row) === 'persona') continue
    plugins.push(cloneRow(row))
  }
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    order: preset.order,
    plugins,
  }
}

/** Every loader entry's options, tolerating a missing service. */
function loaderEntries(ctx) {
  try {
    const entries = ctx.get('configEditor')?.entries?.()
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** One loader entry's options object. */
function entryOptions(entry) {
  const options = entry?.options
  if (options !== null && typeof options === 'object') return options
  return entry ?? {}
}

/** The deployment's default preset id, read from the registry row. */
function deploymentDefaultPreset(ctx) {
  for (const entry of loaderEntries(ctx)) {
    const options = entryOptions(entry)
    if (options?.name !== REGISTRY_PLUGIN) continue
    const id = text(options?.config?.default)
    if (id !== '') return id
  }
  return ''
}

/** The baseline preset's id and its declared rows. */
function baselinePreset(ctx) {
  const id = deploymentDefaultPreset(ctx)
  if (id === '') return { id: '', rows: [] }
  for (const entry of loaderEntries(ctx)) {
    const options = entryOptions(entry)
    if (options?.name !== PRESET_PLUGIN) continue
    if (text(options?.config?.id) !== id) continue
    const rows = options?.config?.plugins
    return { id, rows: Array.isArray(rows) ? rows : [] }
  }
  return { id, rows: [] }
}

/** Process-global tool catalog (no scope): the list `restrict` can filter. */
function globalToolCatalog(ctx) {
  try {
    const schemas = ctx.get('tools')?.schemas?.() ?? []
    return schemas
      .map((schema) => ({ name: schema.name, description: text(schema.description) }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return []
  }
}

/**
 * Tools registered per-Agent (delegation, model selection …).
 *
 * These never enter the global layer or any standing scope — each Agent's own
 * layer registers them — so only a live Agent reveals their names. They are
 * also the one category `restrict()` cannot hide, which the page shows by
 * marking them `global: false`.
 *
 * The union spans EVERY live Agent, not just the first: which plugins loaded
 * can differ per Agent (a probe, a resumed session), and one Agent's view is
 * no answer for another's. `observed` extends the union with schemas recorded
 * from Agents that have since been disposed, so a tool registered once does
 * not alternate between present and orphaned for the page.
 * @param ctx - the Host plugin context.
 * @param observed - optional per-preset observation map (`presetId → name → schema`).
 * @param presetId - limit the observation merge to one preset.
 */
function perAgentToolCatalog(ctx, observed, presetId) {
  const merged = new Map()
  const collect = (schemas) => {
    for (const schema of schemas ?? []) {
      const name = text(schema?.name)
      if (name === '') continue
      merged.set(name, { name, description: text(schema.description) })
    }
  }
  try {
    if (observed !== undefined && presetId !== undefined) {
      for (const schema of observed.get(presetId)?.values() ?? []) collect([schema])
    }
    const agents = ctx.get('agents')?.list?.()
    if (Array.isArray(agents)) {
      for (const agent of agents) {
        const scoped = agent.ctx?.get?.('tools')
        if (typeof scoped?.schemas !== 'function') continue
        collect(scoped.schemas(agent))
      }
    }
  } catch {
    /* an Agent whose tools are not enumerable yet simply contributes nothing */
  }
  return [...merged.values()]
}

/**
 * The full tool surface a custom preset inherits, built-ins included.
 *
 * A custom preset copies the baseline's rows, so the baseline scope is exactly
 * the candidate list the page must offer: a tool absent here cannot be named
 * in a preset's list at all. Per-Agent registrations are merged in, because
 * they exist at runtime yet are invisible to a standing-scope read. Each entry
 * carries `global` because only a global tool can be hidden by `restrict()` —
 * an inherited built-in or a per-Agent tool is narrowed at call time by the
 * guard instead.
 * @param ctx - the Host plugin context.
 * @param scopeKey - the baseline's acquired scope key, or undefined to fall
 *   back to the global catalog alone.
 * @param observed - optional per-preset tool observation map (see `perAgentToolCatalog`).
 * @param baselineId - the deployed baseline preset id (observation bucket).
 */
async function baselineToolSurface(ctx, scopeKey, observed, baselineId) {
  const global = globalToolCatalog(ctx)
  const asGlobalOnly = () => global.map((tool) => ({ ...tool, global: true }))
  if (scopeKey === undefined) return asGlobalOnly()
  try {
    const schemas = ctx.get('tools')?.schemas?.(scopeKey) ?? []
    const merged = new Map()
    for (const schema of schemas) {
      const name = text(schema.name)
      if (name === '') continue
      merged.set(name, {
        name,
        description: text(schema.description),
        global: global.some((tool) => tool.name === name),
      })
    }
    for (const tool of global) if (merged.has(tool.name) === false) merged.set(tool.name, { ...tool, global: true })
    for (const tool of perAgentToolCatalog(ctx, observed, baselineId)) {
      if (merged.has(tool.name) === false) merged.set(tool.name, { ...tool, global: false })
    }
    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return asGlobalOnly()
  }
}

/** Human labels for the skill registry's known source buckets. */
const SKILL_SOURCE_LABELS = {
  'project-dsh': '项目 DSH 技能',
  'project-agents': '项目 Agent 技能',
  'user-dsh': 'DSH 技能',
  'user-agents': '公共 Agent 技能',
  runtime: '运行时注册',
  custom: '自定义',
  bundled: '内置捆绑',
}

/**
 * Read the winning skill summaries through an already-borrowed scope key.
 *
 * The skills registry AND its filesystem provider mount inside every Agent
 * preset's composition (the `dsh-base` rows), not on the Host's global layer.
 * A bare Host-side `skills.list({})` therefore answers EMPTY — exactly like
 * the tool surface, the catalogue must be read through the preset's scope
 * key, the same `lease.key` that `tools.schemas()` consumes. Without this the
 * page shows "no skills" while every Agent happily loads them.
 * @param ctx - the Host plugin context.
 * @param scopeKey - an acquired scope key, or undefined for the global layer.
 * @returns `{ entries, error? }`.
 */
async function listSkillsInScope(ctx, scopeKey) {
  const skills = ctx.get('skills')
  if (skills === undefined || skills === null || typeof skills.list !== 'function') {
    return { entries: [], error: 'skills 服务不可用' }
  }
  try {
    return { entries: await skills.list(scopeKey === undefined ? {} : { scope: scopeKey }) }
  } catch (error) {
    return { entries: [], error: message(error) }
  }
}

/**
 * Borrow a preset's scope and read the skill catalogue through it.
 * @param ctx - the Host plugin context.
 * @param registry - the `agentPresets` service, when bound.
 * @param presetId - the preset whose scope hosts the catalog.
 * @returns `{ entries, scoped, error? }`.
 */
async function scopedSkillCatalog(ctx, registry, presetId) {
  if (registry === undefined || presetId === '' || typeof registry.acquireScope !== 'function') {
    // No scope to borrow; the global layer alone may still answer.
    const result = await listSkillsInScope(ctx, undefined)
    return { ...result, scoped: false }
  }
  let lease
  try {
    lease = await registry.acquireScope(presetId)
  } catch (error) {
    return { entries: [], scoped: true, error: message(error) }
  }
  try {
    const result = await listSkillsInScope(ctx, lease.key)
    return { ...result, scoped: true }
  } finally {
    await releaseLease(lease)
  }
}

/**
 * name → `{ path, description }` for every skill in the winning catalog.
 *
 * The path is the absolute instruction file the provider owns, which lets one
 * preset re-offer a skill from its own layer even when the global catalog no
 * longer lists it.
 * @param ctx - the Host plugin context.
 * @param registry - the `agentPresets` service, when bound.
 * @param presetId - whose scope should answer the catalog.
 */
async function skillCatalogMap(ctx, registry, presetId) {
  const index = new Map()
  try {
    const { entries } = await scopedSkillCatalog(ctx, registry, presetId)
    for (const skill of entries) {
      index.set(skill.name, { path: text(skill.path), description: text(skill.description) })
    }
  } catch {
    /* a missing registry simply yields an empty index */
  }
  return index
}

/** Group summaries by discovery source: one two-level menu per source. */
function skillGroupsFromEntries(ctx, entries) {
  try {
    const bySource = new Map()
    for (const skill of entries) {
      const source = text(skill.source) || 'runtime'
      if (!bySource.has(source)) bySource.set(source, [])
      bySource.get(source).push({
        name: skill.name,
        description: text(skill.description),
        path: text(skill.path),
        provider: text(skill.provider),
      })
    }
    const groups = []
    for (const [source, items] of bySource) {
      items.sort((left, right) => left.name.localeCompare(right.name))
      groups.push({ key: source, label: SKILL_SOURCE_LABELS[source] ?? source, skills: items })
    }
    groups.sort((left, right) => left.key.localeCompare(right.key))
    return groups
  } catch (error) {
    ctx.logger?.warn?.(`[my-agent-preset] 读取技能目录失败: ${message(error)}`)
    return []
  }
}

/**
 * The winning skill catalog grouped by discovery source.
 *
 * Each `SkillSummary.source` is the registry's origin bucket, so one group is
 * one source folder and the page renders them as a two-level menu.
 * @param ctx - the Host plugin context.
 * @param registry - the `agentPresets` service, when bound.
 * @param presetId - whose scope should answer the catalog.
 * @returns groups with their skills, sorted for stable rendering.
 */
async function skillGroups(ctx, registry, presetId) {
  const { entries } = await scopedSkillCatalog(ctx, registry, presetId)
  return skillGroupsFromEntries(ctx, entries)
}

/**
 * The folders the built-in filesystem skill provider discovers skills in.
 *
 * Mirrors `@deepseek-ai/dsh-skill-filesystem`'s default roots — two per
 * scope: project roots resolve against the session's workspace, user roots
 * against the DSH home. The page shows this list next to an empty menu so a
 * missing skill has an obvious destination.
 */
function skillRootsHint() {
  const home = dshHome()
  const agentsHome = text(process.env.DSH_AGENTS_HOME) || join(homedir(), '.agents')
  return [
    { key: 'project-dsh', path: '<工作区>/.dsh/skills', project: true },
    { key: 'project-agents', path: '<工作区>/.agents/skills', project: true },
    { key: 'user-dsh', path: join(home, 'skills') },
    { key: 'user-agents', path: join(agentsHome, 'skills') },
  ]
}

/** Release an `acquireScope` lease, whichever disposal shape it carries. */
async function releaseLease(lease) {
  try {
    if (typeof lease?.[Symbol.asyncDispose] === 'function') await lease[Symbol.asyncDispose]()
    else if (typeof lease?.dispose === 'function') await lease.dispose()
  } catch {
    /* already released */
  }
}

/** Serialized custom-preset document plus its registry side effects. */
// Exported for the regression tests: the registry-truth path (live `required`
// and `order` versus the shipped table) can only be driven through the store's
// own read model. `private: true` package, no consumer imports this by name.
export class PresetStore {
  constructor(ctx, config) {
    this.ctx = ctx
    // Kept because the official-section report answers from the SAME config
    // the capability rows were mounted with (prefixes may be widened there).
    this.config = config ?? {}
    this.file = text(config?.dataFile) || defaultDataFile()
    this.presets = []
    this.disposers = new Map()
    this.failures = new Map()
    this.registry = undefined
    this.closed = false
    this.queue = Promise.resolve()
    /** Live per-Agent scope registrations, keyed by the Agent they belong to. */
    this.agentStates = new Map()
    /** True while this store mutates registrations, so its own events are ignored. */
    this.mutating = false
    /** One queued `tools/change` refresh at a time, mirroring `dsh-tool-manager`. */
    this.refreshQueued = false
    /** Schemas observed per preset: `presetId → (tool name → schema)`. */
    this.observedTools = new Map()
    /**
     * Context names observed per preset: `presetId → Set<name>`.
     *
     * Memory-only and deliberately so: the page's list is the catalog ∪ the
     * names this process actually saw ∪ the names a preset already stores, so
     * a third-party or dynamically named context (`tool:<name>:depth`)
     * surfaces once an Agent of that preset has assembled a prompt — and a
     * restart never drops a stored selection or turns it into a silent block.
     */
    this.observedContexts = new Map()
    /** Baseline preset ids already composed early to pin the mount order. */
    this.composedBaselines = new Set()
    /** Standing scope key per preset id, recorded wherever a lease exposes it. */
    this.scopeKeys = new Map()
    /**
     * The registry's own view per preset (`''` = the global view):
     * `presetId → { contexts: Map<name, {order, required}>, sections: Set<name> }`.
     *
     * Cached because the page asks once per preset and the filter asks once
     * per install, while the table only moves on `system-prompt/change`.
     * `undefined` is cached too — a build whose registry cannot be read must
     * fall back to the static table EVERY time instead of retrying the probe
     * on each assembly.
     */
    this.promptViews = new Map()
    /** Disposer for the `system-prompt/change` invalidation listener. */
    this.promptWatcher = undefined
    /**
     * Scope warm-up state.
     *
     * Warming every preset's scope is what makes the FIRST `list` complete,
     * but it is also the only slow part of that call. The promise is shared by
     * every concurrent `list` (and by the boot-time call, if any), its result
     * is memoized, and presets that failed to compose are remembered so a
     * broken row cannot make every page load retry it. `reconcile()` resets
     * all three, so newly added presets are warmed on the next page load.
     */
    this.scopeWarmPromise = null
    this.scopesWarmed = false
    this.warmFailures = new Set()
    /** The registry wait is a FIRST-load concern only; later lists probe once. */
    this.promptServiceWaited = false
  }

  /**
   * Drop every cached registry read.
   *
   * `system-prompt/change` fires whenever a section/context layer changes —
   * an MCP server publishing a context, a plugin row registering one at
   * runtime. Without this the page would keep answering from a table that no
   * longer exists, which is the exact failure the live read was added to fix.
   */
  invalidatePromptViews() {
    this.promptViews.clear()
  }

  /** Subscribe to registry changes once `load()` runs. */
  watchPromptRegistry() {
    if (this.promptWatcher !== undefined || typeof this.ctx.on !== 'function') return
    try {
      this.promptWatcher = this.ctx.on('system-prompt/change', () => this.invalidatePromptViews())
    } catch {
      this.promptWatcher = undefined
    }
  }

  /**
   * Record a preset's standing scope key.
   *
   * The key is stable for the lifetime of a composed generation, which is
   * exactly what a registry read needs; a lease is not retained because the
   * read is synchronous and idempotent.
   * @param presetId - the preset the scope belongs to.
   * @param key - the `acquireScope` key, when the caller has one.
   */
  rememberScopeKey(presetId, key) {
    // A scope key is whatever `createScope`/`acquireScope` minted: a string in
    // the registry's generation keys, an object in the tests that compose a
    // scope by hand. Only absence is rejected.
    if (key === undefined || key === null) return
    if (this.scopeKeys.get(presetId) === key) return
    this.scopeKeys.set(presetId, key)
    // A new composition means new layers: drop the cached reads for this
    // preset (and the global view, which every chain also contains).
    this.promptViews.delete(presetId)
    this.promptViews.delete('')
  }

  /**
   * The registry's live view for one preset, or undefined when unreadable.
   *
   * `required` here is the flag `assemble()`/`refreshContext()` actually act
   * on, and `order` is the sort key the model sees — the two columns of the
   * static table that go stale across DSH builds.
   * @param presetId - the preset to read; undefined for the global view.
   * @returns `{ contexts, sections }`, or undefined.
   */
  promptView(presetId) {
    const id = presetId ?? ''
    if (this.promptViews.has(id)) return this.promptViews.get(id)
    const scope = this.scopeKeys.get(id)
    // A preset whose own scope was never acquired cannot be answered by the
    // GLOBAL layer: that view lacks every section/context the preset's own
    // capability row registers, and caching it under the preset's id would
    // pin the incomplete answer for the rest of the process. `list()` warms
    // one scope per preset before building the catalogs, so this branch is
    // the "registry unusable" case, not the normal first load.
    if (id !== '' && scope === undefined) return undefined
    const contexts = readContextRegistry(this.ctx, scope)
    // A FAILED read is not cached: `systemPrompt` mounts asynchronously, so a
    // read taken before the service landed must not pin "unreadable" for the
    // rest of the process. Successful reads are cached until the registry
    // announces a change, which is the only thing that can move the table.
    if (contexts === undefined) return undefined
    const view = { contexts, sections: readSectionNames(this.ctx, scope) }
    this.promptViews.set(id, view)
    return view
  }

  /**
   * Names the runtime refuses to drop for one preset.
   *
   * The live registry wins whenever it can be read; the shipped table is the
   * fallback for a build whose `layers` shape changed. That ordering is the
   * point of this file's registry probe: a row DSH newly marks `required`
   * must be protected the moment it exists, and a row DSH UNmarks must become
   * closable again — both without a release of this plugin.
   * @param presetId - the preset the answer is for.
   * @returns the set of context names to protect.
   */
  requiredContextNames(presetId) {
    const view = this.promptView(presetId)
    if (view === undefined) return REQUIRED_CONTEXT_NAMES
    const names = new Set()
    for (const [name, entry] of view.contexts) if (entry.required === true) names.add(name)
    return names
  }

  /**
   * Sort keys for context names, live values first.
   *
   * Unlike `required`, this never affects behavior — only the order the page
   * lists rows in — so a missing registry simply keeps the shipped values.
   * @param presetId - the preset the answer is for.
   * @returns a name → order map.
   */
  contextOrders(presetId) {
    const view = this.promptView(presetId)
    if (view === undefined) return CONTEXT_ORDERS
    const orders = new Map(CONTEXT_ORDERS)
    for (const [name, entry] of view.contexts) {
      if (entry.order !== undefined) orders.set(name, entry.order)
    }
    return orders
  }

  /**
   * Whether this Agent still needs a scope installation pass.
   *
   * The snapshot listener is installed even when the Agent's `tools` service
   * is not reachable yet, so a bare `agentStates.has()` check would mark such
   * an Agent finished and no sweep would ever come back for its tool list.
   * The state therefore records which halves actually landed.
   * @param agent - the roster entry to test.
   * @returns true when something is still missing.
   */
  needsScope(agent) {
    const state = this.agentStates.get(agent)
    return state === undefined || state.toolScopeDone !== true
  }

  /** Run one store operation after every previously queued one. */
  run(task) {
    const next = this.queue.then(task, task)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** Bind the registry service once the loader provides it. */
  bind(registry) {
    this.registry = registry
    return this.run(async () => {
      await this.reconcile()
    })
  }

  /** Drop the registry binding; registrations stay until the store disposes. */
  unbind() {
    this.registry = undefined
  }

  /** Read the document, tolerating absence and reporting corruption. */
  async load() {
    this.watchPromptRegistry()
    let raw
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      this.ctx.logger?.warn?.(`[my-agent-preset] 预设文件无法解析，已忽略: ${message(error)}`)
      return
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.presets) ? parsed.presets : []
    this.presets = list.map((entry) => normalizePreset(entry)).filter(Boolean)
  }

  /** Write the document atomically. */
  async persist() {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    const body = `${JSON.stringify({ version: 2, presets: this.presets }, null, 2)}\n`
    await writeFile(temporary, body, 'utf8')
    await rename(temporary, this.file)
  }

  /** The baseline rows every preset inherits from, read fresh from the loader. */
  baseline() {
    const { id, rows } = baselinePreset(this.ctx)
    return { id, rows }
  }

  /** Re-register every enabled preset from the current document. */
  async reconcile() {
    if (this.closed) return
    // The document changed: a previously warmed set may now be missing a
    // preset, and a previously broken preset deserves another attempt.
    this.scopesWarmed = false
    this.warmFailures.clear()
    for (const [, dispose] of this.disposers) {
      try {
        await dispose()
      } catch (error) {
        this.ctx.logger?.warn?.(`[my-agent-preset] 释放旧预设失败: ${message(error)}`)
      }
    }
    this.disposers.clear()
    this.failures.clear()
    const registry = this.registry
    if (registry === undefined) return
    const baseline = this.baseline()
    const rows = baseline.rows
    // Resolve the selected skills' source paths once per reconcile, so each
    // preset's provider can read its own documents after registration. The
    // read goes through the baseline's scope: the skills registry mounts in
    // the preset composition, not on the Host's global layer.
    let skillCatalogMapValue = await skillCatalogMap(this.ctx, registry, baseline.id)
    for (const preset of this.presets) {
      if (preset.enabled === false) continue
      try {
      const skillIndex =  preset.skills.length > 0
      ? skillCatalogMapValue
      : new Map()
        const dispose = await registry.register(toDefinition(preset, rows, skillIndex))
        this.disposers.set(preset.id, dispose)
      } catch (error) {
        this.failures.set(preset.id, message(error))
        this.ctx.logger?.warn?.(`[my-agent-preset] 注册预设 ${preset.id} 失败: ${message(error)}`)
      }
    }
    // The document changed, so every live Agent's scope must be rebuilt.
    this.refreshAgentScopes()
    // Pin the mount order for the whole Host run, then tell the deployment
    // the catalogs moved. Both are best-effort: neither may fail a save.
    this.composeBaseline().catch((error) => {
      this.ctx.logger?.warn?.(`[my-agent-preset] 预先挂载基准预设失败: ${message(error)}`)
    })
    this.notifyCatalogChange()
  }

  /** Re-apply every live Agent's scope from the current document. */
  refreshAgentScopes() {
    for (const agent of this.ctx.get('agents')?.list?.() ?? []) this.installAgentScope(agent)
  }

  /** Release one Agent's scope state; each piece may already be gone. */
  releaseScopeState(state) {
    try {
      state.restriction?.()
    } catch {
      /* already released */
    }
    try {
      state.assemblyFilter?.()
    } catch {
      /* already released */
    }
    try {
      state.contextFilter?.()
    } catch {
      /* already released */
    }
    // The escape-hatch shadows are per-Agent registrations of their own: a
    // refresh that left them behind would keep shadowing the official required
    // entry even after the preset stopped force-suppressing it.
    for (const dispose of state.contextShadows ?? []) {
      try {
        dispose?.()
      } catch {
        /* already released */
      }
    }
    for (const dispose of state.guards) {
      try {
        dispose?.()
      } catch {
        /* already released */
      }
    }
  }

  /** Remove one Agent's installed scope registrations. */
  uninstallAgentScope(agent) {
    const state = this.agentStates.get(agent)
    if (state === undefined) return
    this.agentStates.delete(agent)
    this.releaseScopeState(state)
  }

  /**
   * Install one Agent's tool and skill scope.
   *
   * This runs on the Host context, never inside the preset's mounted subtree:
   * Cordis keeps one hook list per Context instance (`dispatch` reads only
   * `this._hooks` of the emitting context), so a listener registered by a
   * mounted row would never see an event the root emits — the Agent scope
   * would silently never install. `dsh-tool-manager` installs its policy the
   * same way, from the Host.
   * @param agent - the Agent whose scope should match its preset.
   */
  /**
   * Which preset an Agent currently belongs to, by either available signal.
   *
   * The standing mount is authoritative but only resolves once the Agent has
   * actually joined; the session header is written at selection time and is
   * readable a beat earlier, which is exactly the window `agent/created`
   * fires in. Both are tried so the scope installs no matter which one has
   * landed.
   * @param agent - the Agent to identify.
   * @returns the preset id, or undefined when the Agent joined none.
   */
  presetIdOf(agent) {
    try {
      const composed = this.registry?.composedPreset?.(agent.ctx)
      if (typeof composed === 'string' && composed !== '') return composed
    } catch {
      /* the mount may not be resolvable yet; fall through to the header */
    }
    const header = agent.session?.header
    if (header !== null && typeof header === 'object' && typeof header.agentPreset === 'string') {
      return header.agentPreset
    }
    return undefined
  }

  /**
   * Apply one tool restriction, retrying with the names `restrict()` accepts.
   *
   * A name registered after this Agent joined, or one that lives only in the
   * Agent's own layer, makes `restrict()` throw for the WHOLE request. Like
   * `dsh-tool-manager`, the rejection is parsed for the known set and the
   * list is retried with the intersection, so a single stale name cannot void
   * the rest of the restriction.
   * @returns the restriction disposer, or undefined when nothing was applied.
   */
  applyRestriction(scopedTools, agent, names, mode) {
    const request = mode === 'allow' ? { allow: names } : { deny: names }
    try {
      return scopedTools.restrict(request)
    } catch (error) {
      const known = parseKnownRestrictable(error)
      if (known === undefined) {
        this.ctx.logger?.warn?.(`[my-agent-preset] 工具范围限制失败: ${message(error)}`)
        return undefined
      }
      const compatible = names.filter((name) => known.has(name))
      if (compatible.length === 0) return undefined
      try {
        return scopedTools.restrict(mode === 'allow' ? { allow: compatible } : { deny: compatible })
      } catch (retryError) {
        this.ctx.logger?.warn?.(`[my-agent-preset] 工具范围限制重试失败: ${message(retryError)}`)
        return undefined
      }
    }
  }

  /**
   * Record one Agent's inherited tool schemas for its preset.
   *
   * The union of these observations is what a standing-scope read cannot see:
   * tools each preset's plugins register per-Agent. The settings page and the
   * inspector both answer from that union, so a tool the page listed is never
   * reported as unavailable merely because its Agent has gone.
   */
  observeAgentTools(agent, presetId, scopedTools) {
    if (presetId === undefined) return
    try {
      const schemas = scopedTools.schemas(agent)
      let bucket = this.observedTools.get(presetId)
      if (bucket === undefined) {
        bucket = new Map()
        this.observedTools.set(presetId, bucket)
      }
      for (const schema of schemas ?? []) {
        const name = text(schema?.name)
        if (name === '') continue
        bucket.set(name, { name, description: text(schema.description) })
      }
    } catch {
      /* not enumerable yet; the next refresh observes it instead */
    }
  }

  installAgentScope(agent) {
    // The restriction and guard disposals below emit their own `tools/change`
    // events; `mutating` keeps that echo from queueing a refresh of ourselves.
    // It wraps the uninstall too — releasing yesterday's restriction is the
    // loudest echo of all.
    this.mutating = true
    let state
    try {
      this.uninstallAgentScope(agent)
      if (agent === undefined || this.closed) return
      // A roster entry can outlive its fiber by a beat: the uid clears
      // before the Agent is removed, and every effect below would then
      // throw INACTIVE_EFFECT. Probe first — a dead Agent needs no scope.
      if (agentScopeDead(agent)) return
      const presetId = this.presetIdOf(agent)
      const preset = this.presets.find((entry) => entry.id === presetId && entry.enabled !== false)
      if (preset === undefined) return
      const selection = preset.tools ?? { mode: 'all', names: [] }
      // The skill list is a WHITELIST: an empty one means NONE, so the skill
      // guard below installs even when nothing is checked — "no selection"
      // is a decision, not an opt-out.
      const allowedSkills = new Set(preset.skills ?? [])
      const scopedTools = agent.ctx.get('tools')
      // Observe the tool surface even when this preset narrows nothing: the
      // observation feeds the page's per-Agent catalog for THIS preset.
      if (scopedTools !== undefined && scopedTools !== null) this.observeAgentTools(agent, presetId, scopedTools)
      // The state object is created BEFORE the tools-service check: the
      // context listener below is installed either way, and a disposer that
      // is never recorded is a leak on the next refresh.
      state = { restriction: undefined, guards: [], presetId, toolScopeDone: false }
      // Runtime-context snapshot whitelist. `assembly.contexts` is the SEPARATE
      // field the model-facing `Current runtime context. This snapshot
      // supersedes…` block is built from, so neither `complete` nor the
      // custom section filter touches it. A preset that stores the
      // field gets its own waterfall listener here — the same place, and the
      // same proven-reachable context, the tool-assembly hygiene filter uses.
      //
      // The listener is installed for EVERY preset of this page, managing or
      // not, because it is also the observation point: whatever contexts the
      // live assembly carried is recorded into `observedContexts` so a
      // dynamically named contribution (`tool:<name>:depth`) or a third-party
      // plugin's own context can reach the page's catalog. An unmanaged preset
      // only records and passes the assembly through untouched — the same
      // always-observe, filter-only-when-configured split `observeAgentTools`
      // uses for the tool surface.
      const forcedRequired = new Set(preset.requiredSuppressed ?? [])
      const allowedContexts = Array.isArray(preset.contexts) ? new Set(preset.contexts) : undefined
      const filtersSomething = allowedContexts !== undefined || forcedRequired.size > 0
      // Which names the RUNNING registry refuses to drop, and where it sorts
      // them. Both come from the build's own context table when it can be
      // read; the shipped table is the fallback. This is the fix for a stale
      // `required` column: a row DSH newly protects is exempted here from the
      // first assembly, and a row DSH stopped protecting becomes closable
      // instead of being locked by this plugin forever.
      const requiredContexts = this.requiredContextNames(presetId)
      const contextOrders = this.contextOrders(presetId)
      // The ADVANCED escape hatch, opt-in and default-off: DSH's contract says
      // a `required` context cannot be suppressed, and three layers enforce it
      // (`assemble`, `refreshContext`, and `dsh-working-directory`'s own
      // `prepend` repair listener). Defeating it takes BOTH halves below — and
      // both are verified against the live registry, not assumed:
      //   a. a same-name registration in the AGENT's own scope without the
      //      `required` flag. Scoped entries shadow globals by name in the
      //      merge, so the registry stops treating the contribution as
      //      required and `refreshContext` stops restoring it;
      //   b. `prepend: true` on the filter below, which puts our deletion
      //      OUTSIDE the official repair listener (it is `prepend` too, and a
      //      later `prepend` registration sits further out).
      // Neither is a documented API, so an upgrade can void this silently.
      // Only names the RUNTIME still protects need a shadow: an ordinary name
      // in the list is already dropped by the whitelist, and registering an
      // empty context for it would add a layer entry for nothing (and could
      // collide with a same-named contribution).
      const shadowedRequired = [...forcedRequired].filter((name) => requiredContexts.has(name))
      if (shadowedRequired.length > 0 && typeof agent.ctx.get === 'function') {
        const scopedPrompt = agent.ctx.get('systemPrompt')
        if (scopedPrompt !== undefined && scopedPrompt !== null && typeof scopedPrompt.context === 'function') {
          for (const name of shadowedRequired) {
            try {
              state.contextShadows ??= []
              const dispose = scopedPrompt.context({
                name,
                order: contextOrders.get(name) ?? 100,
                // Empty text and no interpolation: the shadow carries nothing,
                // and its whole job is to outrank the official required entry
                // in the merge so the force-restore path (keyed on
                // `required === true`) no longer fires for this name.
                text: () => '',
                interpolate: false,
              })
              if (typeof dispose === 'function') state.contextShadows.push(dispose)
            } catch (error) {
              this.ctx.logger?.warn?.(
                `[my-agent-preset] 强制屏蔽必需项「${name}」注册同名覆盖失败: ${message(error)}`,
              )
            }
          }
        }
      }
      if (typeof agent.ctx.on === 'function') {
        state.contextFilter = agent.ctx.on(
          'system-prompt/assemble',
          async (...args) => {
            const next = args.at(-1)
            if (typeof next !== 'function') return args[0]
            let assembly
            try {
              assembly = await next()
            } catch (error) {
              // A failure downstream must not be turned into a filter verdict.
              throw error
            }
            try {
              if (assembly === null || typeof assembly !== 'object') return assembly
              if (Array.isArray(assembly.contexts) === false) return assembly
              const names = assembly.contexts.map((entry) => text(entry?.name)).filter((name) => name !== '')
              let bucket = this.observedContexts.get(presetId)
              if (bucket === undefined) {
                bucket = new Set()
                this.observedContexts.set(presetId, bucket)
              }
              for (const name of names) bucket.add(name)
              if (filtersSomething === false) return assembly
              const contexts = assembly.contexts.filter((entry) => {
                const name = text(entry?.name)
                // The forced list wins over the required exemption — that is the
                // entire point of the escape hatch (pair it with the same-name
                // shadow above, or `refreshContext` restores the entry anyway).
                if (forcedRequired.has(name)) return false
                if (requiredContexts.has(name)) return true
                return allowedContexts === undefined ? true : allowedContexts.has(name)
              })
              if (contexts.length === assembly.contexts.length) return assembly
              return { ...assembly, contexts }
            } catch (error) {
              // Fail open, never shut: a broken filter must not leave the model
              // without its runtime context — dropping the workspace or the
              // sandbox policy silently is worse than over-injecting.
              this.ctx.logger?.warn?.(`[my-agent-preset] 运行时上下文过滤失败，已放行全部: ${message(error)}`)
              return assembly
            }
          },
          // Only the escape hatch may reach OUTSIDE the official repair
          // listener; a plain whitelist stays inside, exactly as before.
          forcedRequired.size > 0 ? { prepend: true } : undefined,
        )
      }
      // Tool list. `restrict` hides the process-global tools; the guard refuses
      // the call for the rest, because an inherited built-in and a per-Agent
      // tool live in the Agent's own layer — the one surface `restrict` cannot
      // hide (its contract filters only what a scope INHERITS).
      if (scopedTools === undefined || scopedTools === null) {
        // An Agent whose tools service is not reachable yet still gets its
        // context listener, and the state IS recorded — otherwise every sweep
        // would re-add that listener. The next `tools/change` refresh re-runs
        // this install from scratch and adds the tool scope.
        state.toolScopeDone = false
        this.agentStates.set(agent, state)
        return
      }
      if (selection.mode !== 'all' && selection.names.length > 0) {
        const listed = new Set(selection.names)
        // Skills are managed apart from the tool list: any checked skill keeps
        // the `skill` tool, otherwise the list would disable every skill.
        const keepsSkillTool = allowedSkills.size > 0
        if (keepsSkillTool) {
        if (selection.mode === 'allow') listed.add(SKILL_TOOL)
        else listed.delete(SKILL_TOOL)          // 黑名单里显式移除，而不是加入
       }
        let restrictable = new Set()
        try {
          restrictable =
            typeof scopedTools.restrictableNames === 'function'
              ? new Set(scopedTools.restrictableNames(agent))
              : new Set(scopedTools.schemas(agent).map((schema) => schema.name))
        } catch {
          /* this Agent's tools are not enumerable yet; only the guard applies */
        }
        const globalNames = [...listed].filter((name) => restrictable.has(name) && name !== RESERVED_TOOL)
        if (globalNames.length > 0) {
          state.restriction = this.applyRestriction(scopedTools, agent, globalNames, selection.mode)
        }
        state.guards.push(
          scopedTools.guard((execution) => {
            const name = typeof execution?.name === 'string' ? execution.name : ''
            if (name === '') return undefined
            if (keepsSkillTool && name === SKILL_TOOL) return undefined
            const blocked = selection.mode === 'allow' ? listed.has(name) === false : listed.has(name)
            return blocked ? `该预设模式未启用工具 ${name}` : undefined
          }),
        )
        // Prompt assembly. `restrict` hides only what a scope INHERITS, so a
        // same-layer built-in or per-Agent tool this list refuses would still
        // ride along in the model's tool schemas — costing context on every
        // step and inviting calls the guard must then reject. Strip exactly
        // the refused tools (and their `tool:` guidance sections) from the
        // assembly. This is presentation hygiene, NOT access control: the
        // guard above remains the enforcement, because a caller can still
        // NAME a hidden tool even when its schema is gone.
        const refusedForPrompt = (name) => {
          if (typeof name !== 'string' || name === '') return false
          if (name === RESERVED_TOOL) return false
          if (keepsSkillTool && name === SKILL_TOOL) return false
          return selection.mode === 'allow' ? listed.has(name) === false : listed.has(name)
        }
        if (typeof agent.ctx.on === 'function') {
          state.assemblyFilter = agent.ctx.on('system-prompt/assemble', async (...args) => {
            const next = args.at(-1)
            if (typeof next !== 'function') return args[0]
            const assembly = await next()
            if (assembly === null || typeof assembly !== 'object') return assembly
            if (Array.isArray(assembly.tools) === false || Array.isArray(assembly.sections) === false) return assembly
            const tools = assembly.tools.filter((schema) => refusedForPrompt(schema?.name) === false)
            const sections = assembly.sections.filter((section) => {
              const name =
                typeof section?.name === 'string' && section.name.startsWith('tool:')
                  ? section.name.slice('tool:'.length)
                  : undefined
              return name === undefined || refusedForPrompt(name) === false
            })
            if (tools.length === assembly.tools.length && sections.length === assembly.sections.length) return assembly
            return { ...assembly, tools, sections }
          })
        }
      }
      // Skill whitelist. The catalog trims the discovered skills to model-
      // invisible (the capability row's provider), but two gaps remain that
      // only a call-time guard closes: a baseline skill without a source
      // file (no locator to override), and any caller that NAMES a hidden
      // skill directly. An empty whitelist refuses every skill call.
      state.guards.push(
        scopedTools.guard((execution) => {
          if (execution?.name !== SKILL_TOOL) return undefined
          const args = execution.arguments
          const skillName = args !== null && typeof args === 'object' ? String(args.name ?? '') : ''
          if (skillName === '' || allowedSkills.has(skillName)) return undefined
          return `该预设模式未启用技能 ${skillName}`
        }),
      )
      state.toolScopeDone = true
      this.agentStates.set(agent, state)
    } catch (error) {
      // The probe above can go stale mid-install: `restrict()` notifies by
      // default, and a listener may synchronously dispose this very Agent
      // before the next `guard()` runs. Release whatever already landed and
      // treat a dead fiber as "nothing to install", never as a Host crash.
      if (state !== undefined) this.releaseScopeState(state)
      if (error?.code !== 'INACTIVE_EFFECT') throw error
    } finally {
      this.mutating = false
    }
  }

  /**
   * Rebuild every Agent's scope after the tool registry changed.
   *
   * MCP servers publish tools dynamically and plugin HMR re-registers them, so
   * a restriction computed against yesterday's surface silently keeps names
   * that no longer exist — or misses names that just appeared. The refresh is
   * debounced and guarded exactly like `dsh-tool-manager`'s: one queued turn,
   * run on the next event-loop tick (scoped registrations settle
   * asynchronously), and never while this store itself is mutating.
   */
  queueScopeRefresh() {
    if (this.mutating || this.refreshQueued) return
    this.refreshQueued = true
    setImmediate(() => {
      this.refreshQueued = false
      this.refreshAllAgentScopes()
    })
  }

  /** Re-install scopes for every live Agent, installed or not. */
  refreshAllAgentScopes() {
    if (this.closed) return
    const agents = this.ctx.get('agents')?.list?.()
    if (!Array.isArray(agents)) return
    // Each install guards its own echo; the list itself is read once so an
    // Agent created mid-loop is picked up by its own event instead.
    for (const agent of agents) this.installAgentScope(agent)
  }

  /**
   * Compose the deployed baseline preset now, pinning the mount order.
   *
   * `agentPresets` keeps ONE standing composition per preset and every
   * composition reconciles its own per-Agent tool registrations on each
   * `tools/change`. A blank session always starts from the deployment default
   * and only then re-links to the picked preset, so the composition mounted
   * FIRST must be the default — otherwise a custom preset mounted earlier (by
   * a resumed session or this page's own scope read) makes the switch cost
   * every per-Agent tool the joining preset should install. This mirrors
   * `dsh-tool-manager`'s `DefaultPresetMount`: acquire the default's scope
   * once and release the lease immediately.
   */
  async composeBaseline() {
    const registry = this.registry
    if (registry === undefined || typeof registry.acquireScope !== 'function') return
    const target = this.baseline().id
    const key = target === '' ? '(session-default)' : target
    if (this.composedBaselines.has(key)) return
    this.composedBaselines.add(key)
    let lease
    try {
      lease = await registry.acquireScope(target === '' ? undefined : target)
      // Keep the key: the prompt registry's own context table is read through
      // the same standing scope `assemble()` uses, and this is the earliest
      // point in the Host's life where one exists.
      this.rememberScopeKey(target, lease?.key)
    } catch (error) {
      this.composedBaselines.delete(key)
      this.ctx.logger?.warn?.(`[my-agent-preset] 预先挂载基准预设失败: ${message(error)}`)
      return
    } finally {
      await releaseLease(lease)
    }
  }

  /**
   * Tell the rest of the deployment that the catalogs moved.
   *
   * `dsh-skills-manager` does exactly this after every write: the skills
   * layer is cached per provider, chat commands are cached per Host, and a
   * session re-reads its preset only when the selection event fires again.
   * Emitting both makes a saved preset take effect for live sessions without
   * a restart.
   */
  notifyCatalogChange() {
    try {
      this.ctx.emit?.('commands/change')
    } catch {
      /* no command catalog to refresh */
    }
    try {
      const sessions = this.ctx.get('sessions')
      const list = typeof sessions?.list === 'function' ? sessions.list() : []
      for (const session of list) {
        const id = session?.id ?? session?.header?.id
        const preset = typeof session?.header?.agentPreset === 'string' ? session.header.agentPreset : undefined
        if (typeof id === 'string' && id !== '' && preset !== undefined) {
          this.ctx.emit?.('agent-preset/selected', id, preset)
        }
      }
    } catch {
      /* sessions are not reachable from here; the sweep still repairs Agents */
    }
  }

  /** Release every registration this store owns. */
  dispose() {
    this.closed = true
    try {
      this.promptWatcher?.()
    } catch {
      /* an already-disposed Host context throws on release; nothing to undo */
    }
    this.promptWatcher = undefined
    this.promptViews.clear()
    const pending = [...this.disposers.values()]
    this.disposers.clear()
    for (const dispose of pending) {
      Promise.resolve()
        .then(() => dispose())
        .catch((error) => this.ctx.logger?.warn?.(`[my-agent-preset] 释放预设失败: ${message(error)}`))
    }
  }

  /** Registry diagnostics keyed by preset id. */
  async registryRows() {
    const registry = this.registry
    if (registry === undefined) return []
    try {
      return await registry.list()
    } catch {
      return []
    }
  }

  /**
   * Every registry view this build can read: the global one plus one per preset.
   *
   * The page draws ONE catalog for every preset, so a row is marked required
   * when ANY scope says so. That is the conservative direction: a wrongly
   * closable row is exactly the bug this table was fixed for, while a wrongly
   * locked row only over-explains itself.
   * @returns the views that could be read (possibly empty).
   */
  allPromptViews() {
    const views = []
    const global = this.promptView(undefined)
    if (global !== undefined) views.push(global)
    for (const preset of this.presets) {
      const view = this.promptView(preset.id)
      if (view !== undefined) views.push(view)
    }
    return views
  }

  /**
   * The snapshot-catalog the page renders.
   *
   * The known DSH rows come first in their live `order` (the sort key the
   * model itself sees), and every name merely OBSERVED — a third-party
   * plugin's contribution, or a per-tool `tool:<name>:depth` whose name is
   * dynamic — is appended after them, sorted the same way. An observed name
   * that duplicates a known one is not repeated.
   *
   * `order`, `required` and `present` are read from the RUNNING registry when
   * it can be read, and fall back to the shipped table (or to "unknown") when
   * it cannot — see `readContextRegistry` for why that distinction matters.
   * @param presetId - read one preset's own scope; omitted merges every scope.
   * @returns rows of `{ name, label, description, order, required, known, source, present? }`.
   */
  contextCatalog(presetId) {
    const views = presetId === undefined ? this.allPromptViews() : [this.promptView(presetId)].filter((v) => v !== undefined)
    const live = new Map()
    for (const view of views) for (const [name, entry] of view.contexts) live.set(name, entry)
    const required = new Set()
    for (const [name, entry] of live) if (entry.required === true) required.add(name)
    const orders = new Map(CONTEXT_ORDERS)
    for (const [name, entry] of live) if (entry.order !== undefined) orders.set(name, entry.order)
    // A build that cannot be read keeps the shipped `required` column, exactly
    // as before this change.
    const requiredOf = (name) =>
      views.length === 0 ? REQUIRED_CONTEXT_NAMES.has(name) : required.has(name)
    const byOrder = (left, right) =>
      (orders.get(left.name) ?? left.order ?? Number.MAX_SAFE_INTEGER) -
        (orders.get(right.name) ?? right.order ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name)
    const known = CONTEXT_CATALOG.map((entry) => ({
      ...entry,
      order: orders.get(entry.name) ?? entry.order,
      required: requiredOf(entry.name),
      known: true,
      // `registry` = the running build confirmed this row; `table` = only the
      // shipped catalog knows it. A `table` row without `present` may not
      // exist in this build at all.
      source: live.has(entry.name) ? 'registry' : 'table',
      ...(views.length > 0 ? { present: live.has(entry.name) } : {}),
    })).sort(byOrder)
    const names = new Set(known.map((entry) => entry.name))
    const observed = new Set()
    for (const bucket of this.observedContexts.values()) for (const name of bucket) observed.add(name)
    // A name the RUNNING registry carries but no Agent has assembled yet — a
    // row a newer DSH build added, in particular — must be listed too, or the
    // page would hide exactly the row whose `required` flag it most needs to
    // show. Observation stays as the fallback for a build whose table cannot
    // be read.
    for (const name of live.keys()) observed.add(name)
    const foreign = []
    for (const name of observed) {
      if (name === '' || names.has(name)) continue
      names.add(name)
      foreign.push({
        name,
        // No authored label exists for a name this plugin does not own: the
        // technical name IS the honest display, marked 第三方 by `known: false`.
        label: name,
        description: '',
        order: orders.get(name) ?? Number.MAX_SAFE_INTEGER,
        required: requiredOf(name),
        known: false,
        source: live.has(name) ? 'registry' : 'observed',
        ...(views.length > 0 ? { present: live.has(name) } : {}),
      })
    }
    return [...known, ...foreign.sort(byOrder)]
  }

  /**
   * The prompt-section catalog the page's checklist renders.
   *
   * Section names are read from the RUNNING registry through every scope this
   * process can see (the global layer plus each preset's standing scope), so a
   * section a newer build or a third-party plugin registers is selectable
   * without a release. The two persona sections are always listed and marked
   * `required`: they carry this preset's own prompt, the page shows them
   * checked and disabled, and only the ADVANCED force list may remove them.
   * `present` reports whether a live scope actually carries the name (a
   * persona suffix stays absent until the preset stores one).
   * @returns rows of `{ name, required, present }`, sorted by name.
   */
  sectionCatalog() {
    const present = new Set()
    for (const view of this.allPromptViews()) {
      for (const name of view.sections ?? []) present.add(name)
    }
    const names = new Set(present)
    for (const name of PERSONA_SECTION_NAMES) names.add(name)
    return [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({
        name,
        required: PERSONA_SECTION_NAMES.includes(name),
        present: present.has(name),
      }))
  }

  /**
   * What the section checklist keeps and removes among the LIVE sections.
   *
   * The same partition the capability row's runtime filter applies, so the
   * panel's two lists are the decision that will really run. Sections are read
   * through this preset's scope first (they are often registered inside the
   * preset's own composition); when that read is unavailable the union of
   * every readable scope answers instead, and an entirely unreadable registry
   * reports `available: false` rather than claiming an empty surface.
   * @param sections - the stored/draft keep list, or undefined when unmanaged.
   * @param suppressed - the stored/draft persona force-suppress list.
   * @param presetId - the preset whose scope is read.
   * @returns `{ available, sections, kept, blocked, managed, keptList, blockedList }`.
   */
  sectionFilterReport(sections, suppressed, presetId) {
    const baselineId = this.baseline().id
    let names = (
      (presetId === undefined ? undefined : this.promptView(presetId)) ??
      this.promptView(baselineId) ??
      this.promptView(undefined)
    )?.sections
    if (names === undefined) {
      const union = new Set()
      for (const view of this.allPromptViews()) {
        for (const name of view.sections ?? []) union.add(name)
      }
      if (union.size > 0) names = union
    }
    if (names === undefined) {
      return { available: false, sections: 0, kept: 0, blocked: 0, managed: sections !== undefined, keptList: [], blockedList: [] }
    }
    const selection = resolveSectionSelection([...names], sections, suppressed)
    return {
      available: true,
      sections: names.size,
      kept: selection.kept.length,
      blocked: selection.blocked.length,
      managed: selection.managed,
      keptList: selection.kept,
      blockedList: selection.blocked,
    }
  }

  /**
   * Wait (briefly) for the prompt registry service to land.
   *
   * `systemPrompt` mounts asynchronously, and the settings page asks `list`
   * the moment its web route answers — on the first load after a restart that
   * request can beat the service. Reading then yields no views at all, so the
   * checklist shrinks to the persona rows while the inspect panel (asked a
   * moment later) is complete. The wait is bounded and costs nothing once the
   * service is already there.
   * @param timeoutMs - how long to wait for `systemPrompt` to appear.
   * @returns true when the service is readable.
   */
  async waitForPromptService(timeoutMs = 800) {
    const readable = () => {
      try {
        return this.ctx.get?.('systemPrompt') !== undefined
      } catch {
        return false
      }
    }
    if (readable()) return true
    // Waited once: a deployment whose build never mounts `systemPrompt` would
    // otherwise add this timeout to EVERY page load. Later lists still probe
    // (the service can land late) but never block on it.
    if (this.promptServiceWaited) return false
    this.promptServiceWaited = true
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      if (readable()) return true
    }
    return readable()
  }

  /**
   * Borrow every preset's scope once so the catalogs are complete on the FIRST
   * page load, then release the leases.
   *
   * The borrows run CONCURRENTLY (bounded), so the page waits for the slowest
   * composition instead of their sum; the promise is shared, so two concurrent
   * `list` calls and the boot-time warm-up never compose the same preset twice.
   * The deployment default is composed first to keep the mount order intact
   * (see `composeBaseline`).
   * @returns a promise that settles when this round of warming is done.
   */
  async warmPresetScopes() {
    if (this.scopesWarmed) return
    if (this.scopeWarmPromise !== null) return this.scopeWarmPromise
    this.scopeWarmPromise = (async () => {
      await this.composeBaseline()
      const registry = this.registry
      if (registry === undefined || typeof registry.acquireScope !== 'function') return
      const pending = this.presets
        .map((preset) => preset.id)
        .filter(
          (id) =>
            id !== '' &&
            this.scopeKeys.has(id) === false &&
            this.warmFailures.has(id) === false,
        )
      if (pending.length === 0) {
        this.scopesWarmed = true
        return
      }
      const leases = []
      // Bounded concurrency: enough to hide the per-preset latency, few enough
      // that a large library cannot compose dozens of scopes at once.
      const limit = 4
      let cursor = 0
      const worker = async () => {
        while (cursor < pending.length) {
          const id = pending[cursor++]
          try {
            const lease = await registry.acquireScope(id)
            this.rememberScopeKey(id, lease?.key)
            if (lease !== undefined) leases.push(lease)
          } catch {
            // A preset that cannot compose is reported by its card status; its
            // rows are simply absent from the catalog. Remember the failure so
            // the next page load does not pay for it again; `reconcile()`
            // clears the set after a save/deploy change.
            this.warmFailures.add(id)
          }
        }
      }
      try {
        await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker))
      } finally {
        for (const lease of leases) await releaseLease(lease)
        this.scopesWarmed = this.warmFailures.size === 0
      }
    })().finally(() => {
      this.scopeWarmPromise = null
    })
    return this.scopeWarmPromise
  }

  /** The settings page's read model. */
  async list() {
    const rows = await this.registryRows()
    const byId = new Map(rows.map((row) => [row.id, row]))
    // The registry may not have mounted yet: without it every view is empty and
    // a scope warmed now would compose without its prompt rows.
    await this.waitForPromptService()
    // Warming the other presets below must not beat the deployment default into
    // the composition order (a blank session inherits the FIRST mounted
    // composition; see composeBaseline). Idempotent, so this is a no-op once
    // reconcile() ran.
    await this.composeBaseline()
    const baseline = this.baseline()
    // ONE lease serves both catalogues: the tool surface and the skill list
    // are both read through the baseline's standing scope, and borrowing it
    // twice would compose (and lease) the same standing mount for nothing.
    const registry = this.registry
    let lease
    if (registry !== undefined && baseline.id !== '' && typeof registry.acquireScope === 'function') {
      try {
        lease = await registry.acquireScope(baseline.id)
        this.rememberScopeKey(baseline.id, lease?.key)
      } catch {
        lease = undefined
      }
    }
    // Every preset's own scope carries the sections/contexts its capability
    // row registers during composition. Only the baseline used to be warmed,
    // so the FIRST list after a restart rendered a global-only catalog (a
    // nearly empty checklist) while the inspect panel — which acquires the
    // requested preset's scope — was complete. The warm-up is shared and
    // memoized: concurrent page loads await ONE round of borrows, later ones
    // pay nothing, and a broken preset cannot make every load retry it.
    await this.warmPresetScopes()
    const scopeKey = lease?.key
    try {
      // The page's candidate list must be the full inherited surface — built-ins
      // included — because a custom preset copies the baseline's rows and the
      // list narrows that surface rather than rebuilding it.
      const tools = await baselineToolSurface(this.ctx, scopeKey, this.observedTools, baseline.id)
      const { entries: skillEntries, error: skillError } = await listSkillsInScope(this.ctx, scopeKey)
      return {
        presets: this.presets.map((preset) => {
          const row = byId.get(preset.id)
          return {
            ...preset,
            status: {
              registered: this.disposers.has(preset.id),
              broken: this.failures.get(preset.id) ?? row?.broken,
              inRegistry: row !== undefined,
            },
          }
        }),
        meta: {
          dataFile: this.file,
          registryAvailable: this.registry !== undefined,
          baseline: baseline.id,
          tools,
          skillGroups: skillGroupsFromEntries(this.ctx, skillEntries),
          // An empty skill menu needs a reason and a destination: the probe
          // answers "can the catalog be read through the baseline's scope",
          // the roots answer "where do I put a skill so it shows up".
          skillDiagnostics: {
            available: this.ctx.get('skills') != null && skillError === undefined,
            count: skillEntries.length,
            scoped: scopeKey !== undefined,
            ...(skillError !== undefined ? { error: skillError } : {}),
          },
          skillRoots: skillRootsHint(),
          // What this Host build understands. `requiredSuppression` marks the
          // second-round escape hatch: a Host that predates it silently drops
          // the `requiredSuppressed` field on save, so the page must NOT offer
          // a box that would appear to work and do nothing. The Client gates
          // the advanced checkbox on this marker.
          capabilities: [
            'snapshotContexts',
            'presetDuplicate',
            'requiredSuppression',
            // `required`/`order` on every catalog row were read from the LIVE
            // prompt registry. A Client that predates the flag keeps working
            // (the fields are additive); a Client that reads it can say WHERE
            // the answer came from instead of trusting a shipped table.
            'contextRegistryTruth',
          ],
          // The snapshot list the page renders: every contribution DSH's own
          // rows register (with its `required` flag, because the registry
          // force-restores those and no plugin can suppress them), plus every
          // name this process has actually seen for some preset — which is the
          // only way a third-party plugin's context or a dynamically named one
          // (`tool:<name>:depth`) can appear at all.
          //
          // `required` and `order` are read from the running registry when it
          // can be read; `source` says which answer a row carries
          // (`registry` / `table` / `observed`) so the page never presents a
          // stale shipped row as current fact.
          contextCatalog: this.contextCatalog(),
          contextRegistry: {
            readable: this.allPromptViews().length > 0,
            scoped: this.scopeKeys.size > 0,
            // How many presets have their own scope key recorded — 0 means the
            // catalog answered from the global layer plus the shipped table.
            scopeKeys: this.scopeKeys.size,
          },
          // The prompt sections the checklist can offer, read live so a
          // section a newer build (or a third-party plugin) registers is
          // selectable without a release. The persona rows always appear and
          // are marked required.
          sectionCatalog: this.sectionCatalog(),
          registry: rows.map((row) => ({ id: row.id, name: row.name, isDefault: row.isDefault, broken: row.broken })),
        },
      }
    } finally {
      await releaseLease(lease)
    }
  }

  /** Create or update one preset, then re-register. */
  async save(input) {
    const payload = input !== null && typeof input === 'object' ? input : {}
    const requestedId = text(payload.id)
    const index = requestedId === '' ? -1 : this.presets.findIndex((preset) => preset.id === requestedId)
    const name = text(payload.name)
    if (name === '') throw new Error('预设名称不能为空')
    // A fresh preset with no snapshot list stays UNMANAGED: undefined means
    // "everything injects", which is exactly what the page showed. Writing the
    // shipped names here used to freeze them — every context a plugin (or a
    // running Agent's observation table) adds later opened UNCHECKED on this
    // preset while a new one showed it checked.
    const now = new Date().toISOString()
    // A list field the page does not submit (a hand-written profile, or a
    // Client built before the checklist existed) must be CARRIED forward:
    // rebuilding the preset from the payload alone would silently turn a
    // managed checklist into "manage nothing". A copy inherits its source's
    // checklists for the same reason. An explicit value in the payload still
    // wins, and an absent field on the SOURCE stays absent — that is the
    // unmanaged state, not an empty whitelist.
    const listSource =
      index >= 0
        ? this.presets[index]
        : this.presets.find((preset) => preset.id === text(payload.insertAfter))
    const carriedLists =
      listSource === undefined
        ? {}
        : {
            ...(Array.isArray(listSource.contexts) ? { contexts: listSource.contexts } : {}),
            ...(Array.isArray(listSource.sections) ? { sections: listSource.sections } : {}),
            ...(Array.isArray(listSource.sectionsSuppressed)
              ? { sectionsSuppressed: listSource.sectionsSuppressed }
              : {}),
          }
    const next = normalizePreset({
      ...carriedLists,
      ...payload,
      id: index >= 0 ? this.presets[index].id : requestedId === '' ? generateId() : requestedId,
      name,
      createdAt: index >= 0 ? this.presets[index].createdAt : now,
      updatedAt: now,
    })
    if (next === undefined) throw new Error('预设数据无效')
    // `insertAfter` is the copy path: the clone lands directly behind its
    // source and the WHOLE column is re-indexed to document order, so this
    // page's card grid and the New-Session roster (which sorts by `order`)
    // agree on the position. An update keeps its own slot.
    if (index >= 0) this.presets[index] = next
    else if (payload.insertAfter !== undefined && text(payload.insertAfter) !== '') {
      insertAndReindex(this.presets, next, text(payload.insertAfter))
    } else this.presets.push(next)
    await this.persist()
    await this.reconcile()
    return { id: next.id }
  }

  /** Delete one preset, then re-register the rest. */
  async remove(id) {
    const requestedId = text(id)
    const index = this.presets.findIndex((preset) => preset.id === requestedId)
    if (index < 0) throw new Error('未找到该预设模式')
    this.presets.splice(index, 1)
    await this.persist()
    await this.reconcile()
    return { id: requestedId }
  }

  /** Enable or disable one preset without editing it. */
  async toggle(id) {
    const requestedId = text(id)
    const preset = this.presets.find((entry) => entry.id === requestedId)
    if (preset === undefined) throw new Error('未找到该预设模式')
    preset.enabled = preset.enabled === false
    preset.updatedAt = new Date().toISOString()
    await this.persist()
    await this.reconcile()
    return { id: preset.id, enabled: preset.enabled }
  }

  /**
   * What one registered preset's Agents actually see at runtime.
   *
   * Reads through the registry's scope lease, so the answer comes from the
   * live composition the preset mounted — not from the stored draft.
   * @param id - the preset to inspect.
   * @param config - optional DRY-RUN override from the editor: `{ tools, skills }`
   *   replacing the stored selection for this answer only, so the page can
   *   refresh the panel live as the user edits, before saving.
   * @returns visible tool names and the skill catalog reachable in that scope.
   */
  async inspectPreset(id, config) {
    const requestedId = text(id)
    const preset = this.presets.find((entry) => entry.id === requestedId)
    if (preset === undefined) throw new Error('未找到该预设模式')
    const override = config !== null && typeof config === 'object' ? config : undefined
    const registry = this.registry
    if (registry === undefined || typeof registry.acquireScope !== 'function') {
      return { available: false, reason: 'agentPresets 服务不可用' }
    }
    let lease
    try {
      lease = await registry.acquireScope(requestedId)
      this.rememberScopeKey(requestedId, lease?.key)
    } catch (error) {
      return { available: false, reason: message(error) }
    }
    // The view below mirrors the stored configuration exactly: the standing
    // scope answers the full surface this preset inherits, and the preset's
    // own selection is then applied to it — the same filter the per-Agent
    // guard enforces at call time. A `config` override swaps in the editor's
    // unsaved selection so the panel previews the edits, not the last save.
    const selection =
      override?.tools !== undefined ? normalizeToolSelection(override.tools) : preset.tools ?? { mode: 'all', names: [] }
    const skills = Array.isArray(override?.skills) ? stringList(override.skills) : preset.skills
    // The snapshot view is the same recomputation the runtime listener does —
    // the catalog ∪ what this preset's Agents actually carried, partitioned
    // against the stored (or drafted) whitelist. Required names always land in
    // `kept`, because the registry force-restores them.
    const contextAllowed =
      override?.contexts !== undefined ? normalizeContexts(override.contexts) : preset.contexts
    // The advanced force-suppress list is previewed the same way: an editor
    // draft overrides the stored value, and the runtime filter reads the very
    // same names.
    // The section checklist is previewed the same way: a draft overrides the
    // stored value and the runtime filter reads the very same names. An
    // explicit draft value wins (including `null`, which means "unmanaged");
    // only a MISSING key falls back to the preset.
    const draftSections =
      override?.sections !== undefined ? normalizeSections(override.sections) : preset.sections
    const draftSectionSuppressed =
      override?.sectionsSuppressed !== undefined
        ? normalizeSectionSuppression(override.sectionsSuppressed) ?? []
        : preset.sectionsSuppressed ?? []
    const contextForced =
      override?.requiredSuppressed !== undefined
        ? normalizeRequiredSuppression(override.requiredSuppressed) ?? []
        : preset.requiredSuppressed ?? []
    // Mirror `toDefinition`: any preset that checks a skill keeps the `skill`
    // tool, so the panel answers what actually takes effect.
    const listed = new Set(selection.names)
    if (selection.mode === 'allow' && skills.length > 0) listed.add(SKILL_TOOL)
    const result = {
      available: true,
      enabled: preset.enabled !== false,
      mode: selection.mode,
      listed: [...listed].sort(),
      // True when the answer applied the editor's unsaved selection.
      ...(override !== undefined ? { draft: true } : {}),
      // What the checklist would keep / remove under the STORED or DRAFTED
      // selection for THIS preset, so the panel updates as boxes are clicked.
      sectionFilter: this.sectionFilterReport(draftSections, draftSectionSuppressed, requestedId),
    }
    try {
      const tools = this.ctx.get('tools')
      const surfaceNames = new Set()
      if (tools !== undefined && typeof tools.schemas === 'function') {
        for (const schema of tools.schemas(lease.key)) {
          const name = text(schema.name)
          if (name !== '') surfaceNames.add(name)
        }
      }
      // A standing-scope read misses the tools this preset's plugins register
      // per-Agent (`subagent`, `list_subagent_models` …). Without the union a
      // name the page listed — and the guard happily allows — would be
      // reported as unavailable. Same union the save path validates against
      // in `dsh-tool-manager`.
      for (const tool of perAgentToolCatalog(this.ctx, this.observedTools, requestedId)) {
        surfaceNames.add(tool.name)
      }
      const surface = [...surfaceNames].sort()
      if (selection.mode === 'allow') {
        result.tools = surface.filter((name) => listed.has(name))
        result.blockedTools = surface.filter((name) => listed.has(name) === false)
      } else if (selection.mode === 'deny') {
        result.tools = surface.filter((name) => listed.has(name) === false)
        result.blockedTools = surface.filter((name) => listed.has(name))
      } else {
        result.tools = surface
        result.blockedTools = []
      }
      result.surfaceCount = surface.length
      // A name the page listed but the inherited surface does not contain can
      // never be honoured — it is either misspelled, owned by a plugin that
      // is not part of this preset's composition, or hidden by another tool
      // manager's intersecting restriction (`tool_list` under `dsh-tool-manager`).
      const surfaceSet = new Set(surface)
      result.listedUnavailable = [...listed].filter((name) => surfaceSet.has(name) === false).sort()
      // Skills answer the preset's own list, so the panel matches what the
      // page configured rather than the deployment-wide catalogue. They no
      // longer depend on the tool list: `toDefinition` keeps the `skill` tool
      // for any preset that checks one.
      // Read through THIS preset's scope: the registry mounts in the preset
      // composition, so a Host-global read would call every real skill
      // "missing".
      const { entries: catalog, error: skillError } = await listSkillsInScope(this.ctx, lease.key)
      if (skillError !== undefined) result.skillCatalogError = skillError
      const known = new Set(catalog.map((skill) => skill.name))
      result.missingSkills = [...skills].filter((name) => known.has(name) === false).sort()
      result.skills = [...skills].sort()
      // False only when the deployment mounts no `skill` tool at all.
      result.skillsToolAvailable = surfaceSet.has(SKILL_TOOL)
      // The snapshot view recomputes the same partition the runtime listener
      // performs: the catalog ∪ the names this preset's Agents actually
      // carried, split against the stored (or drafted) whitelist. Required
      // names always land in `kept` because the registry force-restores them.
      const catalogRows = this.contextCatalog(requestedId)
      const contextSurface = [...new Set([...catalogRows.map((row) => row.name), ...(this.observedContexts.get(requestedId) ?? [])])]
      // Same FOUR inputs the runtime filter uses — surface, whitelist, forced
      // list, and the live required/order answer — so the panel's kept/blocked
      // split is the answer the model will actually get, including a forced
      // required name (which lands in `blocked` because it really is suppressed)
      // and a row this build newly protects (which lands in `kept`).
      const contextSplit = resolveContextSelection(
        contextSurface,
        contextAllowed,
        contextForced,
        new Set(catalogRows.filter((row) => row.required === true).map((row) => row.name)),
        new Map(catalogRows.map((row) => [row.name, row.order])),
      )
      result.contexts = contextSplit.kept
      result.blockedContexts = contextSplit.blocked
      result.forcedContexts = contextSplit.forced
      result.contextSurfaceCount = contextSurface.length
      // False when the preset does not manage the snapshot at all: the panel
      // then says so instead of implying every row was an explicit choice.
      result.contextsManaged = contextSplit.managed
    } catch (error) {
      result.error = message(error)
    } finally {
      await releaseLease(lease)
    }
    return result
  }

  /**
   * Diagnostic view of the per-Agent scope pipeline.
   *
   * Every step that could silently fail is reported instead: whether the
   * registry bound, how each live Agent identifies its preset, whether that
   * Agent has a tools service, and what this store installed on it. Use it to
   * see WHERE the scope stopped rather than guessing.
   */
  async diagnose() {
    const safe = (fn) => {
      try {
        const value = fn()
        return value === undefined ? null : value
      } catch (error) {
        return `error: ${message(error)}`
      }
    }
    const agentsService = this.ctx.get('agents')
    const list = typeof agentsService?.list === 'function' ? agentsService.list() : undefined
    const roots = typeof agentsService?.roots === 'function' ? agentsService.roots() : undefined
    const agents = Array.isArray(list) ? list : []
    return {
      registryAvailable: this.registry !== undefined,
      composedPresetAvailable: typeof this.registry?.composedPreset === 'function',
      // An empty `agents` array alone is ambiguous: it could mean the service
      // is unreachable from this context. Report the distinction explicitly.
      agentsServiceAvailable: agentsService !== undefined && agentsService !== null,
      agentListCount: Array.isArray(list) ? list.length : null,
      agentRootsCount: Array.isArray(roots) ? roots.length : null,
      toolsServiceAvailable:
        this.ctx.get('tools') !== undefined && this.ctx.get('tools') !== null,
      baseline: this.baseline().id,
      dataFile: this.file,
      presets: this.presets.map((preset) => {
        const catalog = this.contextCatalog(preset.id)
        const split = resolveContextSelection(
          [...new Set([...catalog.map((entry) => entry.name), ...(this.observedContexts.get(preset.id) ?? [])])],
          preset.contexts,
          preset.requiredSuppressed ?? [],
          new Set(catalog.filter((entry) => entry.required === true).map((entry) => entry.name)),
          new Map(catalog.map((entry) => [entry.name, entry.order])),
        )
        return {
          id: preset.id,
          enabled: preset.enabled !== false,
          mode: preset.tools?.mode ?? 'all',
          listed: preset.tools?.names ?? [],
          skills: preset.skills,
          // Whether this preset trims the runtime-context snapshot at all, and
          // what the trim yields against the names seen so far. A forced
          // required name counts as trimming — it is one.
          contextsManaged: split.managed,
          contexts: split,
          requiredSuppressed: preset.requiredSuppressed ?? [],
          observedContexts: [...(this.observedContexts.get(preset.id) ?? [])].sort(),
        }
      }),
      agents: agents.map((agent) => ({
        id: agent.id,
        composedPreset: safe(() => this.registry?.composedPreset?.(agent.ctx)),
        headerPreset: agent.session?.header?.agentPreset ?? null,
        presetIdOf: this.presetIdOf(agent),
        hasToolsService: agent.ctx?.get?.('tools') !== undefined && agent.ctx?.get?.('tools') !== null,
        scopeInstalled: this.agentStates.has(agent),
        installedOn: this.agentStates.get(agent)?.presetId ?? null,
        guardCount: this.agentStates.get(agent)?.guards.length ?? 0,
        hasRestriction: this.agentStates.get(agent)?.restriction !== undefined,
      })),
    }
  }
}

/** Register the settings page's loopback JSON endpoints. */
function registerWeb(ctx, store) {
  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.get('webServer')
    if (webServer === undefined || typeof webServer.register !== 'function') return
    const endpoints = {
      list: (body) => store.list(body),
      save: (body) => store.run(() => store.save(body)),
      delete: (body) => store.run(() => store.remove(body?.id)),
      toggle: (body) => store.run(() => store.toggle(body?.id)),
      inspect: (body) => store.run(() => store.inspectPreset(body?.id, body?.config)),
      diag: (body) => store.run(() => store.diagnose()),
      reload: (body) =>
        store.run(async () => {
          // Re-read the DOCUMENT, not just the in-memory list: this endpoint is
          // the way back from a hand-edited data file (the rule fields have no
          // page control), and re-registering the old list would make such an
          // edit look ignored until the Host restarted.
          await store.load()
          await store.reconcile()
          return store.list(body)
        }),
    }
    for (const [name, handler] of Object.entries(endpoints)) {
      scoped.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: `${API_PREFIX}/${name}`,
            handler: async (req, res) => {
              if (!isLoopbackRequest(req)) {
                sendJson(res, 403, fail(new Error('仅允许本地回环访问')))
                return
              }
              if (req.method !== 'POST' && req.method !== 'GET') {
                sendJson(res, 405, fail(new Error('不支持的请求方法')))
                return
              }
              try {
                const body = req.method === 'POST' ? await readJson(req) : {}
                sendJson(res, 200, ok(await handler(body ?? {})))
              } catch (error) {
                sendJson(res, 200, fail(error))
              }
            },
          }),
        `my-agent-preset: ${name} route`,
      )
    }
  })
}

/**
 * Mount the custom-preset studio.
 * @param ctx - the Host plugin context.
 * @param config - the bundle row config (`dataFile` overrides the document path).
 */
export function apply(ctx, config) {
  const store = new PresetStore(ctx, config)
  ctx.effect(
    () => () => {
      store.dispose()
    },
    'my-agent-preset: store',
  )
  ctx.inject(['agentPresets'], (scoped) => {
    scoped.effect(
      () => () => {
        store.unbind()
      },
      'my-agent-preset: registry binding',
    )
    store.bind(scoped.get('agentPresets')).catch((error) => {
      ctx.logger?.warn?.(`[my-agent-preset] 注册自定义预设失败: ${message(error)}`)
    })
  })
  // Per-Agent scope must be installed from the Host context: Cordis keeps one
  // hook list per Context instance and `dispatch` reads only the emitting
  // context's hooks, so a listener inside the preset's mounted subtree would
  // never see these events. Same shape as `dsh-tool-manager`.
  //
  // Four independent triggers, because an Agent joins its preset in a window
  // no single one of them covers: the live roster at startup, Agent creation,
  // the preset selection, and a cheap periodic sweep that repairs anything a
  // missed event left uninstalled.
  // Sweep that needs no injected service and no event: it polls the Host
  // context for the roster, so the scope still installs when `agents` is
  // reachable only later, or when every event above was missed.
  ctx.effect(
    () => {
      const timer = setInterval(() => {
        const service = ctx.get('agents')
        if (service === undefined || service === null) return
        if (typeof service.list !== 'function') return
        for (const agent of service.list()) {
          if (store.needsScope(agent)) store.installAgentScope(agent)
        }
      }, 4000)
      // A background sweep must never hold the Host's event loop open.
      timer.unref?.()
      return () => {
        clearInterval(timer)
      }
    },
    'my-agent-preset: agent scope sweep',
  )
  // The tool registry moves at runtime — MCP servers publish their tools
  // when a connection opens, plugin HMR re-registers on reload, and every
  // preset recomposition dispatches one `tools/change`. Rebuild each live
  // Agent's restriction and guards against the new surface; the store's own
  // echo is filtered by its `mutating` flag. Same edge `dsh-tool-manager`
  // listens on for its baseline refresh.
  ctx.effect(
    () =>
      ctx.on('tools/change', () => {
        store.queueScopeRefresh()
      }),
    'my-agent-preset: tools change refresh',
  )
  ctx.inject(['agents'], (scoped) => {
    /** Every Agent this Host can currently see. */
    const agentsOf = () => {
      const service = ctx.get('agents')
      return typeof service?.list === 'function' ? service.list() : []
    }
  const pending = new Set()
const pendingUninstall = new Set()
let sweeping = false

const install = (agent) => {
  if (agent === undefined || agent === null || typeof agent !== 'object') return
  if (agent.isDisposed) return
  if (pending.has(agent) || (store.agentStates.has(agent) && store.needsScope(agent) === false)) return

  pending.add(agent)
  store
    .run(() => store.installAgentScope(agent))
    .catch((error) => {
      ctx.logger?.warn?.(`[my-agent-preset] 应用 Agent 工具范围失败: ${message(error)}`)
    })
    .finally(() => {
      pending.delete(agent)
    })
}
const uninstall = (agent) => {
  if (agent === undefined || agent === null) return
  if (pendingUninstall.has(agent)) return
  pendingUninstall.add(agent)

  try {
    store.uninstallAgentScope(agent)
  } catch (error) {
    ctx.logger?.warn?.(`[my-agent-preset] 卸载 Agent 工具范围失败: ${message(error)}`)
  } finally {
    pendingUninstall.delete(agent)
  }
}
const sweep = async () => {
  if (sweeping) return
  sweeping = true
  try {
    for (const agent of agentsOf()) {
      if (store.needsScope(agent)) install(agent)
    }
  } finally {
    sweeping = false
  }
}

scoped.effect(
  () => {
    sweep().catch(e => ctx.logger?.error?.(`[my-agent-preset] initial sweep error: ${message(e)}`))
    const offCreated = ctx.on('agent/created', (payload) => install(payload?.agent))
    const offDisposed = ctx.on('agent/disposed', (payload) => uninstall(payload?.agent))
    // An Agent joins its preset after it is created, so the selection
    // event is the reliable moment its scope can be evaluated.
    const offSelected = ctx.on('agent-preset/selected', (sessionId) => {
      const service = ctx.get('agents')
      install(service?.get?.(typeof sessionId === 'string' ? sessionId : ''))
    })
    // Every pre-step re-checks, so the very first model request of a new
    // Agent already runs under its preset's scope. NOTE `agent/pre-step` is
    // a WATERFALL listener: it receives `next` and MUST call it and pass
    // the decision on. Returning without calling `next` breaks the chain,
    // and the loop then reads `decision.kind` off `undefined`.
    const offPreStep = ctx.on('agent/pre-step', (payload, next) => {
      const agent = payload?.agent
      if (
        agent !== undefined &&
        agent !== null &&
        typeof agent === 'object' &&
        store.needsScope(agent) &&
        !agent.isDisposed
      ) {
        install(agent)
      }
      return typeof next === 'function' ? next() : undefined
    })
    // Last resort sweep: covers an event that fired before the preset id
    // resolved, or an Agent the roster did not list yet.
    // 包捕获，防止async sweep异常静默丢失
    const timer = setInterval(() => sweep().catch(e => ctx.logger?.error?.(`[my-agent-preset] periodic sweep error: ${message(e)}`)), 4000)
    timer.unref?.()
    return () => {
      offCreated?.()
      offDisposed?.()
      offSelected?.()
      offPreStep?.()
      clearInterval(timer)
      for (const agent of [...store.agentStates.keys()]) {
        uninstall(agent)
      }
    }
  },
  'my-agent-preset: per-agent scope listeners',
)

  
  })
  const bootstrap = () =>
    store
      .run(async () => {
        await store.load()
        await store.reconcile()
      })
      .catch((error) => {
        ctx.logger?.warn?.(`[my-agent-preset] 读取预设文件失败: ${message(error)}`)
      })
  // The baseline rows live in loader entries, so wait until the loader service
  // is available instead of reading an empty catalog during startup.
  ctx.inject(['configEditor'], () => {
    bootstrap()
  })
  registerWeb(ctx, store)
}

export default apply
