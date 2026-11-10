/**
 * dsh-my-agent-preset — capability row.
 *
 * This module is not mounted by the bundle patch. The Host half builds one
 * `PresetDefinition` per custom preset and puts this row inside it, so the
 * loader mounts it in that preset's own scope: everything registered here is
 * visible to Agents joined to that preset and to nothing else.
 *
 * It contributes the two capabilities that MUST live in the preset's scope:
 * - persona text → a scoped `deployment:persona-prefix` section, which shadows
 *                  the deployment persona exactly as an Agent preset should.
 * - skills       → a scoped `skills` provider. The skill registry is layered:
 *                  a provider registered from a preset's standing composition
 *                  lands in that preset's own layer, so the selected skill
 *                  documents are offered to Agents of this preset (the same
 *                  read-and-inject shape `dsh-skills-manager` uses).
 *                  Documents are read through an mtime cache, the provider
 *                  consumes the registry's `control` record (abort signal +
 *                  invalidation), and candidates carry a structured locator
 *                  so `get` can refuse a stale candidate.
 *
 * The tool list and the skill call-list are deliberately NOT here. They are
 * per-Agent work installed from the Host (`installAgentScope` in the Host
 * half): Cordis keeps one hook list per Context instance and `dispatch` reads
 * only the emitting context's hooks, so a listener registered by a mounted row
 * never sees an event the root emits — the Agent scope would silently never
 * install. `tools.restrict()` also rejects any context that is not an Agent's
 * own, which a mounted row's context is not.
 */

import { readFile, stat } from 'node:fs/promises'

/** Section name the prompt registry reserves for the deployment persona. */
const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'
/** Section name the prompt registry reserves for the deployment persona suffix. */
const PERSONA_SUFFIX_SECTION = 'deployment:persona-suffix'
/**
 * Sections this preset registers itself and keeps no matter what the page's
 * checklist says: the persona prefix and suffix ARE the preset's prompt, so
 * dropping them would silently discard the text the user authored.
 *
 * They are shown checked-and-disabled in the page's section list, exactly like
 * the runtime-context `required` rows, and the ADVANCED force-suppress list
 * (`sectionsSuppressed`) is the only thing that may remove them.
 */
export const PERSONA_SECTION_NAMES = Object.freeze([PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION])
/** Provider name published into the preset's skill layer. */
const SKILL_PROVIDER = 'dsh-my-agent-preset'
/**
 * Rank used for injected skills inside the preset's own layer.
 *
 * The registry picks ONE winner per name, sorted by rank ascending — lower
 * rank wins, and losers are dropped. Discovery sources sit at 100–600
 * (project 100/200, runtime 250, custom 300, user-dsh 400, user-agents 500,
 * bundled 600). A checked skill is an EXPLICIT user decision for this preset,
 * so it outranks every discovery source: at 600 this provider used to lose
 * the in-layer tie to `user-agents` (500), and a source document declaring
 * `disable-model-invocation: true` (pptx-generator) then entered the catalog
 * as model-invisible — checked, injected, yet missing from the Skill catalog.
 */
const SKILL_RANK = 10
/** The registry's skill-name grammar; a candidate outside it throws the whole provider out. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Parsed skill documents keyed by their source path.
 *
 * Every model step re-assembles the prompt, which asks the registry for the
 * catalog, which asks each provider — a read-per-step of every selected skill
 * would be wasted IO. The document is cached against its `mtimeMs` + size, so
 * a file edited (or re-imported by the skills manager) is picked up on the
 * next list while unchanged files are never re-read. Same read-and-inject
 * shape `dsh-skills-manager` uses for external skill directories.
 * @type {Map<string, { mtimeMs: number, size: number, doc: { description: string, content: string } }>}
 */
const skillDocumentCache = new Map()

/** Read a non-empty string field, or ''. */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** Read one string list from config, dropping non-strings and blanks. */
function configList(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item !== '') : []
}

/**
 * Partition a prompt-section surface against a preset's checklist.
 *
 * The page's section list is the OPPOSITE polarity of the old rule-based
 * filter: `sections` is a KEEP list (checked = injected), and an absent array
 * means the preset does not manage the list at all, so every section survives.
 * The only protected names are the preset's own persona sections; they stay
 * checked and disabled in the page and may only be removed by the ADVANCED
 * `sectionsSuppressed` list.
 *
 * The same function answers the editor's dry-run report and the runtime
 * filter, so the "kept / blocked" lists the page shows are exactly the
 * decision the capability row makes.
 * @param names - every section name the surface carries.
 * @param allowed - the stored/draft keep list, or undefined when unmanaged.
 * @param suppressed - persona sections the ADVANCED list force-removes.
 * @returns `{ kept, blocked, managed, suppressed }` sorted name arrays.
 */
export function resolveSectionSelection(names, allowed, suppressed = []) {
  const required = new Set(PERSONA_SECTION_NAMES)
  const force = new Set(configList(suppressed).filter((name) => required.has(name)))
  const whitelist = Array.isArray(allowed) ? new Set(configList(allowed)) : undefined
  const compare = (left, right) => left.localeCompare(right)
  const valid = [...new Set((Array.isArray(names) ? names : []).map(text).filter((name) => name !== ''))]
  const keep = (name) =>
    required.has(name) ? force.has(name) === false : whitelist === undefined || whitelist.has(name)
  return {
    kept: valid.filter(keep).sort(compare),
    blocked: valid.filter((name) => keep(name) === false).sort(compare),
    managed: whitelist !== undefined,
    suppressed: [...force].sort(compare),
  }
}

/** Normalize the page's `[{ name, path }]` skill selection. */
function skillEntries(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item !== null && typeof item === 'object' && text(item.name) !== '')
        .map((item) => ({ name: text(item.name), path: text(item.path), description: text(item.description) }))
    : []
}

/** Split one skill document into its frontmatter description and body. */
function parseSkillDoc(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (match === null) return { description: '', content: raw }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (pair !== null) meta[pair[1].toLowerCase()] = pair[2].trim()
  }
  return {
    description: typeof meta.description === 'string' ? meta.description : '',
    content: raw.slice(match[0].length),
  }
}

/**
 * Read one skill document through the mtime cache.
 * @param path - the absolute instruction file.
 * @returns the parsed `{ description, content }`, or undefined when unreadable.
 */
async function readCachedSkillDocument(path) {
  let meta
  try {
    meta = await stat(path)
  } catch {
    // The document is gone (deleted, moved, source uninstalled). Drop the
    // stale entry so this preset stops offering a ghost.
    skillDocumentCache.delete(path)
    return undefined
  }
  const cached = skillDocumentCache.get(path)
  if (cached !== undefined && cached.mtimeMs === meta.mtimeMs && cached.size === meta.size) return cached.doc
  try {
    const doc = parseSkillDoc(await readFile(path, 'utf8'))
    skillDocumentCache.set(path, { mtimeMs: meta.mtimeMs, size: meta.size, doc })
    return doc
  } catch {
    skillDocumentCache.delete(path)
    return undefined
  }
}

/**
 * Load one selected skill for the preset's provider.
 *
 * The source document wins: reading the file keeps the skill available to this
 * preset alone even when its global source is switched off. A missing or
 * unreadable document falls back to the registry's global layer, so a virtual
 * skill (one with no file) still injects.
 * @param entry - one `{ name, path, description }` selection entry.
 * @param registry - the skills registry instance this fiber sees.
 * @param options - caller lookup options (`cwd`, `signal`).
 * @returns the definition to publish, or undefined when nothing can load it.
 */
async function loadSkillEntry(entry, registry, options) {
  if (options?.signal?.aborted === true) return undefined
  // Checking a skill in the page is an explicit "this preset USES it" — the
  // invocation policy is forced open whatever the source document declares.
  // A document like pptx-generator carries `disable-model-invocation: true`,
  // which is right for passive discovery but wrong for an explicit choice.
  const invocation = { modelInvocable: true, userInvocable: true }
  if (entry.path !== '') {
    const doc = await readCachedSkillDocument(entry.path)
    if (doc !== undefined) {
      return {
        name: entry.name,
        // The registry rejects an empty description outright — never publish one.
        description: doc.description || entry.description || `${entry.name} (preset skill)`,
        content: doc.content,
        source: 'custom',
        resourceBase: { kind: 'directory', path: entry.path.replace(/[/\\][^/\\]+$/, '') },
        invocation,
      }
    }
    /* fall back to the registry's global layer */
  }
  try {
    const loaded = await registry.get(entry.name, { cwd: options?.cwd, signal: options?.signal })
    if (loaded === undefined) return undefined
    return {
      name: loaded.name,
      description: loaded.description || entry.description || `${entry.name} (preset skill)`,
      content: loaded.content,
      source: loaded.source,
      resourceBase: loaded.resourceBase,
      invocation,
    }
  } catch {
    return undefined
  }
}

/**
 * Mount the preset's capability contributions.
 * @param ctx - the preset-scoped plugin context.
 * @param config - the row config written by the settings page.
 */
export function apply(ctx, config) {
  const settings = config ?? {}

  // --- persona text -------------------------------------------------------
  const instructions = text(settings.instructions)
  const instructionMode =
    settings.instructionMode === 'complete' || settings.instructionMode === 'custom'
      ? settings.instructionMode
      : 'append'
  const complete = instructionMode === 'complete'
  // `custom` keeps exactly the sections the page's checklist leaves checked and
  // drops the rest. An absent `sections` array means "this preset does not
  // manage the list", so nothing is dropped — the page shows every row checked
  // in that state. The persona sections keep themselves; only the ADVANCED
  // force list may remove them.
  const custom = instructionMode === 'custom'
  const sectionAllowed =
    custom && Array.isArray(settings.sections) ? new Set(configList(settings.sections)) : undefined
  const sectionSuppressed = new Set(
    custom ? configList(settings.sectionsSuppressed).filter((name) => PERSONA_SECTION_NAMES.includes(name)) : [],
  )
  const managesSections = custom && (sectionAllowed !== undefined || sectionSuppressed.size > 0)
  const suffix = text(settings.instructionsSuffix)
  // A preset with no authored text still registers the section in `custom`
  // mode: the section name is what the checklist filter recognises as this
  // preset's own, so the keep / suppress lists still apply.
  const personaRegistered = instructions !== '' || custom
  if (personaRegistered) {
    ctx.inject(['systemPrompt'], (scoped) => {
      scoped.effect(
        () =>
          scoped.systemPrompt.section({
            name: PERSONA_PREFIX_SECTION,
            order: 0,
            text: instructions,
            ...(complete ? { complete: true } : {}),
          }),
        'my-agent-preset: persona prefix',
      )
      const suffixRegistered = !complete && suffix !== ''
      if (suffixRegistered) {
        scoped.effect(
          () =>
            scoped.systemPrompt.section({
              name: PERSONA_SUFFIX_SECTION,
              order: 0,
              text: suffix,
            }),
          'my-agent-preset: persona suffix',
        )
      }
      if (managesSections) {
        // `prepend` puts this listener first in the waterfall, and calling
        // `next()` lets every downstream listener (including the Host's tool
        // filter on the Agent scope) finish before the final section list is
        // filtered. Only `sections` change: tools, contexts, and variables are
        // untouched, so tool schemas and runtime context still work.
        scoped.effect(
          () =>
            scoped.on(
              'system-prompt/assemble',
              async (...args) => {
                const next = args.at(-1)
                if (typeof next !== 'function') return args[0]
                const assembly = await next()
                if (assembly === null || typeof assembly !== 'object') return assembly
                if (Array.isArray(assembly.sections) === false) return assembly
                const sections = assembly.sections.filter((section) => {
                  const name = typeof section?.name === 'string' ? section.name : ''
                  if (name === PERSONA_PREFIX_SECTION)
                    return personaRegistered && sectionSuppressed.has(name) === false
                  if (name === PERSONA_SUFFIX_SECTION)
                    return suffixRegistered && sectionSuppressed.has(name) === false
                  return sectionAllowed === undefined || sectionAllowed.has(name)
                })
                if (sections.length === assembly.sections.length) return assembly
                return { ...assembly, sections }
              },
              { prepend: true },
            ),
          'my-agent-preset: section checklist filter',
        )
      }
    })
  }

  // --- injected skills (a WHITELIST) --------------------------------------
  // The page stores one `{ name, path }` entry per selected skill. The body
  // stays in its own source document: this provider re-reads that file, so a
  // preset keeps offering its skills from its own layer even when the global
  // catalog changes — the same read-and-inject shape the skills manager uses
  // for external skill directories.
  //
  // The checked list is a WHITELIST, and an EMPTY whitelist means NONE: the
  // registry MERGES layers, so the discovered copies of unchecked skills
  // would still ride into this preset's Skill catalog. The provider therefore
  // publishes both halves from its own layer (rank beats every discovery
  // source): checked skills as model-invocable, and every unchecked skill
  // WITH a source file as model-invisible — the model's Skill catalog is
  // built from model-invocable summaries only, so an unchecked skill leaves
  // the context entirely while the guard still refuses its call. The row
  // declares skill management simply by carrying a `skills` ARRAY, even an
  // empty one: "nothing checked" must trim, not opt out of trimming.
  const managesSkills = Array.isArray(settings.skills)
  const injectedSkills = skillEntries(settings.skills)
  if (managesSkills) {
    ctx.inject(['skills'], (scoped) => {
      // `scoped.skills` is the registry instance this preset's fiber sees;
      // registering through it files the provider into the PRESET's layer.
      const registry = scoped.skills ?? scoped.get('skills')
      if (registry === undefined || typeof registry.registerProvider !== 'function') return
      // The registry calls the factory with a control record — the same shape
      // `dsh-skills-manager` consumes. `signal` marks a lookup the caller
      // abandoned (skip the reads); `invalidate` tells the layered registry to
      // re-merge, which matters when a source document disappears and a global
      // copy of the same skill should win again.
      const invalidators = new Set()
      // Re-entrancy guard: reading the baseline through `registry.list` asks
      // every provider again — including this one. The nested call must
      // answer empty so the baseline stays exactly "the catalog without this
      // provider's overlays".
      let readingBaseline = false
      scoped.effect(
        () =>
          registry.registerProvider((control) => {
            if (typeof control?.invalidate === 'function') invalidators.add(control.invalidate)
            const signal = control?.signal
            if (signal !== undefined && typeof signal.addEventListener === 'function') {
              signal.addEventListener(
                'abort',
                () => {
                  invalidators.delete(control.invalidate)
                },
                { once: true },
              )
            }
            const hiddenInvocation = { modelInvocable: false, userInvocable: true }
            /** The merged catalog WITHOUT this provider's candidates. */
            const baselineSummaries = async (options, lookup) => {
              if (readingBaseline) return []
              readingBaseline = true
              try {
                const collected = await registry.list({
                  scope: options?.scope,
                  cwd: lookup.cwd,
                  signal: lookup.signal,
                })
                return Array.isArray(collected) ? collected : []
              } catch {
                return []
              } finally {
                readingBaseline = false
              }
            }
            return {
              name: SKILL_PROVIDER,
              list: async (options) => {
                // The factory-level abort signal outranks the caller's: the
                // registry abandons a lookup by aborting it.
                const lookup = { cwd: options?.cwd, signal: signal ?? options?.signal }
                const baseline = await baselineSummaries(options, lookup)
                const checked = new Set(injectedSkills.map((item) => item.name))
                const candidates = []
                // Checked skills: the source document wins, invocable again.
                for (const entry of injectedSkills) {
                  if (signal?.aborted === true) break
                  // The registry VALIDATES every candidate and rethrows, which
                  // skips this whole provider — one malformed selection must
                  // not take down every other checked skill with it.
                  if (SKILL_NAME.test(entry.name) === false) continue
                  let definition
                  try {
                    definition = await loadSkillEntry(entry, registry, lookup)
                  } catch {
                    continue
                  }
                  if (definition === undefined) continue
                  candidates.push({
                    name: definition.name,
                    description: definition.description,
                    invocation: definition.invocation,
                    source: definition.source,
                    resourceBase: definition.resourceBase,
                    rank: SKILL_RANK,
                    // A structured locator lets `get` verify the candidate
                    // still points at the document this preset saved — a
                    // stale candidate from an older mount cannot pull a body
                    // from a different file. Same strictness the skills
                    // manager applies to its own locators.
                    locator: { name: entry.name, path: entry.path },
                    provider: SKILL_PROVIDER,
                  })
                }
                // Unchecked skills: override them to model-invisible so they
                // leave the model's context entirely. This MUST cover every
                // baseline skill regardless of whether it carries a source
                // file — including bundled/built-in skills (e.g. the `pdf`
                // skill from dsh-skill-office) that advertise a body through
                // their own provider's `get` and therefore publish NO `path`.
                // Skipping those left them model-visible despite the whitelist,
                // so the model could still load a skill this preset never
                // checked. The override wins by rank (SKILL_RANK=10 < every
                // discovery source) and its `get` returns nothing, so the body
                // is unreachable even if a caller tries to load it.
                for (const summary of baseline) {
                  if (signal?.aborted === true) break
                  const name = text(summary?.name)
                  const path = text(summary?.path)
                  if (name === '' || checked.has(name)) continue
                  if (SKILL_NAME.test(name) === false) continue
                  // A baseline skill with no readable source path: hide it by
                  // rank alone and answer `get` with undefined — there is no
                  // document to read, and routing `get` back into this provider
                  // for a name we never selected must not resurrect a body.
                  if (path === '') {
                    candidates.push({
                      name,
                      description: text(summary.description) || `${name} (hidden by preset)`,
                      invocation: hiddenInvocation,
                      source: text(summary.source) || 'runtime',
                      resourceBase: summary.resourceBase,
                      rank: SKILL_RANK,
                      // No locator: `get` below recognizes it and returns nothing.
                      provider: SKILL_PROVIDER,
                    })
                    continue
                  }
                  candidates.push({
                    name,
                    description: text(summary.description) || `${name} (hidden by preset)`,
                    invocation: hiddenInvocation,
                    source: text(summary.source) || 'runtime',
                    resourceBase: summary.resourceBase,
                    rank: SKILL_RANK,
                    locator: { name, path },
                    provider: SKILL_PROVIDER,
                  })
                }
                return candidates
              },
              // Load the winning body for a candidate this provider listed.
              get: async (candidate, options) => {
                if (signal?.aborted === true) return undefined
                const lookup = { cwd: options?.cwd, signal: signal ?? options?.signal }
                const locator = candidate?.locator
                const wanted =
                  locator !== null && typeof locator === 'object'
                    ? text(locator.name) || text(candidate?.name)
                    : text(candidate?.name)
                const wantedPath = locator !== null && typeof locator === 'object' ? text(locator.path) : ''
                const entry = injectedSkills.find(
                  (item) => item.name === wanted && (wantedPath === '' || item.path === wantedPath),
                )
                if (entry !== undefined) {
                  const definition = await loadSkillEntry(entry, registry, lookup)
                  if (definition === undefined) {
                    // A source document vanished between list and get. Forget
                    // every cached layer so the registry re-merges and a global
                    // copy of this skill can win again, exactly like the skills
                    // manager's invalidation after a directory change.
                    for (const invalidate of invalidators) {
                      try {
                        invalidate()
                      } catch {
                        /* the registry may already be tearing this layer down */
                      }
                    }
                    return undefined
                  }
                  return { ...definition, provider: SKILL_PROVIDER }
                }
                // An unchecked override: read its document directly. Asking
                // `registry.get` would select THIS candidate again (it won
                // the layer) and recurse — the locator already names the file.
                if (wanted === '' || wantedPath === '') return undefined
                const doc = await readCachedSkillDocument(wantedPath)
                if (doc === undefined) return undefined
                return {
                  name: wanted,
                  description: doc.description || text(candidate?.description) || `${wanted} (hidden by preset)`,
                  content: doc.content,
                  source: text(candidate?.source) || 'custom',
                  resourceBase: candidate?.resourceBase,
                  invocation: hiddenInvocation,
                  provider: SKILL_PROVIDER,
                }
              },
            }
          }),
        'my-agent-preset: injected skills provider',
      )
    })
  }
}

export default apply
