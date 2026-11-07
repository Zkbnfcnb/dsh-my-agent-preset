/**
 * Regression: the preset document lives at the renamed default path and the
 * pre-rename directory is not read at all.
 *
 * Behaviour pinned here:
 *   A. the default document is `$DSH_HOME/my-agent-preset/presets.json`.
 *   B. a document in the old `agent-preset-studio` directory is ignored.
 *   C. an explicit `dataFile` config is authoritative.
 *   D. a corrupt document is ignored without throwing.
 *
 * Run: node test/verify-default-data-path.mjs
 */
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PresetStore } from '../index.js'

// Literal for the pre-rename directory: this test proves it is NOT consulted.
const OLD_DIR = 'agent-preset-studio'
const NEW_DIR = 'my-agent-preset'

const logger = { warn: () => {} }
const store = (config) => new PresetStore({ logger }, config)

const document = (id, name) =>
  JSON.stringify({
    version: 2,
    presets: [{ id, name, instructions: '', skills: [], tools: { mode: 'all', names: [] } }],
  })

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function scenario(title, body) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-preset-path-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await body(home)
    console.log(`  ok   ${title}`)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

console.log('# 默认数据路径')

await scenario('读取新目录下的预设文件', async (home) => {
  const target = join(home, NEW_DIR, 'presets.json')
  await mkdir(join(home, NEW_DIR), { recursive: true })
  await writeFile(target, document('custom-new0001', '新预设'), 'utf8')

  const instance = store({})
  await instance.load()

  assert.equal(instance.file, target)
  assert.equal(instance.presets.length, 1)
  assert.equal(instance.presets[0].id, 'custom-new0001')
})

await scenario('旧目录文件不再被读取', async (home) => {
  await mkdir(join(home, OLD_DIR), { recursive: true })
  await writeFile(join(home, OLD_DIR, 'presets.json'), document('custom-legacy01', '旧预设'), 'utf8')

  const instance = store({})
  await instance.load()

  assert.equal(instance.presets.length, 0)
  assert.equal(await exists(join(home, NEW_DIR, 'presets.json')), false, 'load 不应创建新文件')
})

await scenario('显式 dataFile 覆盖默认路径', async (home) => {
  const explicit = join(home, 'custom', 'presets.json')
  await mkdir(join(home, 'custom'), { recursive: true })
  await writeFile(explicit, document('custom-explicit', '显式预设'), 'utf8')
  await mkdir(join(home, OLD_DIR), { recursive: true })
  await writeFile(join(home, OLD_DIR, 'presets.json'), document('custom-legacy01', '旧预设'), 'utf8')

  const instance = store({ dataFile: explicit })
  await instance.load()

  assert.equal(instance.presets.length, 1)
  assert.equal(instance.presets[0].id, 'custom-explicit')
})

await scenario('损坏的文件只告警不抛错', async (home) => {
  await mkdir(join(home, NEW_DIR), { recursive: true })
  await writeFile(join(home, NEW_DIR, 'presets.json'), '{', 'utf8')

  const instance = store({})
  await instance.load()

  assert.equal(instance.presets.length, 0)
})

console.log('all default-data-path regressions passed')
