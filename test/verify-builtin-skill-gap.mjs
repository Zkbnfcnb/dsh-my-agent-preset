/**
 * Regression: a built-in (bundled) skill that carries NO `path` must NOT
 * survive a preset's whitelist when it is not selected.
 *
 * Before the fix, capability.js only overrode unchecked skills that HAVE a
 * readable source path; a bundled skill (e.g. dsh-skill-office's `pdf`)
 * publishes no `path`, so it stayed model-visible despite the whitelist and
 * the model could load a skill the preset never checked.
 *
 * The real composition mounts baseline providers (filesystem, office…) in an
 * outer scope and the preset capability row in an inner scope that inherits
 * them. We replicate that with Cordis: the `skills` Service is mounted on the
 * root, a baseline plugin registers a built-in provider, and a child fiber
 * mounts capability.js; we then read the catalog through the child scope.
 *
 * Run: node test/verify-builtin-skill-gap.mjs
 */
import { Context } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import { SkillRegistry } from 'file:///root/node-v24.13.0-linux-arm64/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-skill/lib/index.js'
import { apply } from '../capability.js'

// Baseline provider emulating a built-in bundled skill (like dsh-skill-office):
// it advertises name/description/invocation BUT no `path` and no `locator`.
const builtinProvider = {
  name: 'dsh-office-mock',
  list: async () => [
    {
      name: 'pdf',
      description: 'Create, read, edit, merge, split PDF files.',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory', path: '/x' },
      provider: 'dsh-office-mock',
      // NOTE: no `path`, no `locator` — exactly what dsh-skill-office publishes.
    },
  ],
  get: async (candidate) => ({
    name: candidate.name,
    description: candidate.description,
    content: 'pdf body',
    source: candidate.source,
    resourceBase: candidate.resourceBase,
    invocation: candidate.invocation,
    provider: 'dsh-office-mock',
  }),
}

const root = new Context()
root.plugin(SkillRegistry)
root.plugin((ctx) => {
  ctx.inject(['skills'], (scoped) => {
    scoped.skills.registerProvider(() => builtinProvider)
  })
})
const presetFiber = root.plugin((ctx) => {
  apply(ctx, {
    presetId: 'p1',
    instructions: '',
    instructionMode: 'append',
    skills: [], // whitelist empty => nothing selected
    tools: { mode: 'all', names: [] },
  })
})

await new Promise((r) => setTimeout(r, 200))

const registry = presetFiber.ctx.get('skills')
const catalog = await registry.list({ scope: presetFiber.ctx })
const visibleToModel = catalog.filter((s) => s.invocation.modelInvocable !== false)
const leaked = visibleToModel.some((s) => s.name === 'pdf')

if (leaked) {
  console.log('FAIL: built-in "pdf" survives empty whitelist:', visibleToModel.map((s) => s.name))
  process.exit(1)
}
console.log('PASS: built-in pdf hidden under empty whitelist; model-visible =', visibleToModel.map((s) => s.name))
process.exit(0)
