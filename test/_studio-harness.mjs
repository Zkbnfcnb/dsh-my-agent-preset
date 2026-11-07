/**
 * Shared harness for the client.js (browser bundle) tests.
 *
 * client.js is a browser bundle (`window.__ModuleLoader__.load(...)`), so any
 * test of its page must install browser stubs, load the factory, and mount
 * `StudioSection` under a small React shim (working `useState`/`useRef`,
 * run-once `useEffect`) that renders the tree as plain data. This module owns
 * that machinery; each test then drives the rendered tree — click handlers,
 * clipboard writes, and the save/inspect payloads the page sends.
 *
 * `mountStudio` answers the Host API from canned data and RECORDS every call,
 * so a test can assert what the page would persist without a running Host.
 * The clipboard is faked two ways to cover both code paths the page uses: the
 * async `navigator.clipboard.writeText`, and the legacy textarea +
 * `document.execCommand` fallback.
 */
import { readFileSync } from 'node:fs'

const SOURCE = new URL('../client.js', import.meta.url).pathname

/** Let queued microtasks (an awaited click handler) settle. */
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Minimal `createElement`: a serialisable node descriptor. */
function createElement(type, props, ...children) {
  return {
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
  }
}

/**
 * The fragment marker the bundle uses for a dialog footer.
 *
 * `React.Fragment` groups the footer buttons without a DOM wrapper, so the shim
 * needs a type the tree walker can flatten instead of a real component.
 */
const FRAGMENT = Symbol('fragment')

/**
 * Render a function component tree with the smallest shim this page needs.
 *
 * Hook slots are keyed per component function (each component here mounts once),
 * so re-renders keep state by call order. `settle()` renders, runs the queued
 * effects once each, and re-renders while something still calls `setState`.
 * @param Component - the root function component.
 * @param props - props for the root.
 * @returns `{ react, settle, flush, tree }`.
 */
export function mountRoot(Component, props) {
  const frames = new Map()
  const effectQueue = []
  const effectsSeen = new WeakMap()
  let current = null
  let dirty = true
  let latest = null

  const frameFor = (fn) => {
    if (!frames.has(fn)) frames.set(fn, { slots: [], index: 0 })
    const entry = frames.get(fn)
    entry.index = 0
    return entry
  }

  const react = {
    createElement,
    Fragment: FRAGMENT,
    useState: (initial) => {
      const entry = current
      const i = entry.index++
      if (!(i in entry.slots)) entry.slots[i] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        entry.slots[i] = typeof next === 'function' ? next(entry.slots[i]) : next
        dirty = true
      }
      return [entry.slots[i], set]
    },
    useRef: (initial) => {
      const entry = current
      const i = entry.index++
      if (!(i in entry.slots)) entry.slots[i] = { current: initial }
      return entry.slots[i]
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      const entry = current
      const i = entry.index++
      const seen = effectsSeen.get(entry) ?? 0
      effectsSeen.set(entry, seen + 1)
      if (seen === 0) effectQueue.push(fn)
    },
  }

  const render = (fn, ownProps) => {
    const outer = current
    current = frameFor(fn)
    try {
      return expand(fn(ownProps))
    } finally {
      current = outer
    }
  }

  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand)
    if (node === null || typeof node !== 'object') return node
    // A fragment contributes its children and nothing else.
    if (node.type === FRAGMENT) return (node.children ?? []).map(expand)
    if (typeof node.type === 'function') {
      // React hands a component its children through `props.children`; passing
      // them the same way keeps `Field`/`Disclosure`/the dialog's body
      // reachable inside the rendered tree.
      const built = render(node.type, { ...node.props, children: node.children })
      return built === null || typeof built !== 'object' ? built : { ...built, type: node.type }
    }
    return { ...node, children: (node.children ?? []).map(expand) }
  }

  const runEffects = async () => {
    const queued = effectQueue.splice(0, effectQueue.length)
    for (const fn of queued) await fn()
    return queued.length
  }

  return {
    react,
    async settle(rounds = 8) {
      for (let round = 0; round < rounds; round += 1) {
        if (dirty) {
          dirty = false
          latest = render(Component, props)
        }
        if (await runEffects() > 0) {
          await tick()
          continue
        }
        if (!dirty) break
      }
      return latest
    },
    async flush(rounds = 4) {
      for (let round = 0; round < rounds; round += 1) {
        await tick()
        // A render can MOUNT a new component whose `useEffect` lands in the
        // queue (opening the editor schedules the auto-inspect there). Draining
        // effects is part of flushing, or a page that fetches on mount would
        // never fetch under test.
        const ran = await runEffects()
        if (!dirty && ran === 0) break
        if (dirty) {
          dirty = false
          latest = render(Component, props)
        }
      }
      return latest
    },
    get tree() {
      return latest
    },
  }
}

/** Recursively collect rendered nodes matching `predicate`. */
export function findNodes(node, predicate, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) findNodes(child, predicate, out)
    return out
  }
  if (node === null || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findNodes(child, predicate, out)
  return out
}

/** Visible text of a rendered subtree. */
export function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node !== 'object') return String(node)
  return (node.children ?? []).map(textOf).join('')
}

/** Rendered class name, when present. */
export const classNameOf = (node) => String(node?.props?.className ?? '')

/**
 * Load client.js against browser stubs and mount the settings section.
 * @param options - `{ presets, meta, inspectView, asyncClipboard, copySucceeds }`.
 *   `meta` feeds the `list` answer's meta (catalogs); `inspectView` the
 *   `inspect` answer; every request is recorded in `calls`.
 * @returns the mount plus the clipboard log, textarea log, recorded calls, and
 *   the dictionaries the bundle registered.
 */
export function mountStudio({
  presets = [],
  meta = { registryAvailable: true },
  inspectView = { available: true },
  asyncClipboard = true,
  copySucceeds = true,
} = {}) {
  const writes = []
  const textareas = []
  const removed = []
  /** Every `{ endpoint, body }` the page POSTed, in order. */
  const calls = []

  // The bundle grabs the hooks off `React` once, at load; delegate to whatever
  // mount is live so the same wrappers work in every scenario.
  let live = null
  const react = {
    createElement,
    Fragment: FRAGMENT,
    useState: (initial) => live.useState(initial),
    useRef: (initial) => live.useRef(initial),
    useCallback: (fn) => fn,
    useEffect: (fn) => live.useEffect(fn),
  }

  let def
  globalThis.window = {
    __ModuleLoader__: {
      load: (d) => {
        def = d
      },
    },
  }
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'textarea') return { style: {}, dataset: {}, textContent: '', setAttribute() {}, remove() {} }
      const el = {
        value: '',
        style: {},
        setAttribute() {},
        select() {},
        setSelectionRange() {},
        remove() {
          removed.push(el)
        },
      }
      textareas.push(el)
      return el
    },
    execCommand: (name) => {
      if (name !== 'copy' || !copySucceeds) return false
      const last = textareas[textareas.length - 1]
      if (last === undefined) return false
      writes.push(last.value)
      return true
    },
    body: { appendChild() {} },
    head: { appendChild() {} },
  }
  const nav = {
    clipboard: asyncClipboard ? { writeText: async (text) => writes.push(text) } : undefined,
  }
  // Node ships a read-only `navigator` getter; redefine it for this scenario.
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
  const fetchStub = async (url, init) => {
    const endpoint = String(url).split('/').pop()
    let body = {}
    try {
      body = JSON.parse(init?.body ?? '{}')
    } catch {
      body = {}
    }
    calls.push({ endpoint, body })
    let value = {}
    if (endpoint === 'list') value = { presets, meta }
    else if (endpoint === 'inspect') value = inspectView
    else if (endpoint === 'save') value = { id: body.id === '' ? 'custom-new0001' : String(body.id ?? '') }
    return { json: async () => ({ ok: true, value }) }
  }

  new Function('window', 'document', 'navigator', 'fetch', readFileSync(SOURCE, 'utf8'))(
    globalThis.window,
    globalThis.document,
    nav,
    fetchStub,
  )
  if (def?.id !== 'dsh-my-agent-preset') throw new Error(`unexpected module id: ${def?.id}`)

  const exports_ = def.factory((id) => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      // The dialog chrome is stubbed into plain descriptors: `Modal` yields its
      // title/description/body AND its `footer` prop (the shell passes the
      // buttons that way, not as children) as one reachable subtree, and
      // `Button` becomes a button node carrying its own `onClick`.
      return {
        Modal: (props) => ({
          type: 'modal-stub',
          props: { className: 'modal-stub' },
          children: [props.title, props.description, ...(props.children ?? []), props.footer ?? null],
        }),
        Button: (props) => ({ type: 'button', props, children: props.children ?? [] }),
      }
    }
    if (id !== 'react') throw new Error(`unexpected require: ${id}`)
    return react
  })

  // Dictionaries live inside the bundle; capture zh through the locale stub so
  // the assertions read the real copy instead of a hardcoded duplicate.
  let zh = null
  let en = null
  let StudioSection
  exports_.apply({
    effect: (fn) => fn(),
    locale: {
      register: (_ns, dicts) => {
        zh = dicts.zh
        en = dicts.en
      },
      bind: () => (key) => zh?.[key] ?? key,
    },
    logger: { warn: () => {} },
    slots: {
      inject: (_slot, fn) => fn(),
      register: (meta_, component) => {
        if (meta_?.id === 'my-agent-preset') StudioSection = component
      },
    },
  })
  if (!StudioSection) throw new Error('settings.section was not registered')

  const root = mountRoot(StudioSection, {})
  live = root.react
  return { root, writes, textareas, removed, calls, zh, en, copy: (key) => zh?.[key] ?? key }
}
