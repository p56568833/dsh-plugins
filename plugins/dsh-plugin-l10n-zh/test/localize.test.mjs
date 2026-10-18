/**
 * localize.mjs 的落盘单测（离线，用桩 translator，不联网）。
 *
 * 重点锁死两条真实踩过的坑：
 *   1. 标题就是包名（没有可译文案）时，绝不能写空的 `locale/en.json` ——
 *      空 meta 会让官方 readPluginMeta 不再回退到 package.json，显示反而更差。
 *   2. 原生中英双语描述（dshmarket 那种）不该被当成「待汉化」，更不该被覆盖。
 *
 * 运行：
 *   node --test test/localize.test.mjs
 *
 * @module dsh-plugin-l10n-zh/test/localize
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRow, isChinese, rowSources, run, scan, titleIsPlaceholder } from '../lib/localize.mjs'

/**
 * 造一个夹具 profile。
 * @param {Record<string, {manifest:object, locale?:Record<string,object>}>} packages 包定义。
 * @returns {Promise<string>} profile 目录。
 */
async function fixture(packages) {
  const dir = await mkdtemp(join(tmpdir(), 'l10n-localize-'))
  const names = Object.keys(packages)
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      { name: 'fixture', private: true, dependencies: Object.fromEntries(names.map((n) => [n, '1.0.0'])), dsh: { profile: { bundles: names } } },
      null,
      2,
    )}\n`,
    'utf8',
  )
  for (const [name, definition] of Object.entries(packages)) {
    const pkgDir = join(dir, 'node_modules', name)
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), `${JSON.stringify(definition.manifest, null, 2)}\n`, 'utf8')
    for (const [language, value] of Object.entries(definition.locale ?? {})) {
      await mkdir(join(pkgDir, 'locale'), { recursive: true })
      await writeFile(join(pkgDir, 'locale', `${language}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }
  }
  return dir
}

/**
 * 一个把原文加前缀的桩翻译器：确定性、离线、可按 kind 决定是否产出中文。
 * @param {(item:{kind:string,source:string})=>string|undefined} [produce] 产出函数。
 * @returns {object} 桩 translator。
 */
function stubTranslator(produce = (item) => `中文:${item.source}`) {
  return {
    /** 逐条调用 produce；返回 undefined 记为未译（不能当中文用）。 */
    async translate(items) {
      return items.map((item) => {
        const target = produce(item)
        if (target === undefined) return { ...item, target: item.source, via: 'passthrough' }
        return { ...item, target, via: 'api' }
      })
    },
    /** 从描述起中文短名；桩实现固定返回「短名:<包名>」。 */
    async deriveTitle(wanted) {
      const out = new Map()
      for (const item of wanted) out.set(item.name, `短名:${item.name}`)
      return out
    },
    stats: () => ({ api: 1, cache: 0, glossary: 0, passthrough: 0, failures: 0 }),
    save: async () => {},
  }
}

test('原生中英双语描述 + 标题是包名：起出短名，绝不写空 meta', async () => {
  const dir = await fixture({
    'demo-market': {
      manifest: {
        name: 'demo-market',
        version: '1.0.0',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        description: 'Visual plugin market · DSH 可视化插件市场',
      },
    },
  })
  try {
    const report = await run({ translator: stubTranslator(), profileDir: dir, backupRoot: join(dir, 'backup') })
    assert.equal(report.translated.length, 1, '标题占位是包名，应该去起名')
    assert.equal(report.derivedTitles['demo-market'], '短名:demo-market')
    const en = JSON.parse(await readFile(join(dir, 'node_modules/demo-market/locale/en.json'), 'utf8'))
    // 回归护栏：空 meta 会让官方 readPluginMeta 不再回退 package.json，把原生描述挤掉。
    assert.ok(Object.keys(en.meta).length > 0, '绝不能写空 meta')
    assert.equal(en.meta.title, '短名:demo-market')
    assert.equal(en.meta.description, undefined, '原生描述已经是中文，不该被覆写')
    const manifest = JSON.parse(await readFile(join(dir, 'node_modules/demo-market/package.json'), 'utf8'))
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('titleIsPlaceholder 能认出「标题=包名」的占位行', () => {
  assert.equal(titleIsPlaceholder({ needsTitle: true, title: 'dsh-image-gen', name: 'dsh-image-gen' }), true)
  assert.equal(titleIsPlaceholder({ needsTitle: true, title: null, name: 'x' }), true)
  assert.equal(titleIsPlaceholder({ needsTitle: true, title: 'Cost & Balance', name: 'dsh-cost-balance' }), false)
  assert.equal(titleIsPlaceholder({ needsTitle: false, title: '任意', name: 'y' }), false)
})

test('有可译标题和描述时：en/zh 都写中文，并放行 exports', async () => {
  const dir = await fixture({
    'demo-image': {
      manifest: {
        name: 'demo-image',
        version: '1.0.0',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
      },
      locale: { en: { meta: { title: 'Local ComfyUI Bridge', description: 'Queue prompts into ComfyUI.' } } },
    },
  })
  try {
    const report = await run({ translator: stubTranslator(), profileDir: dir, backupRoot: join(dir, 'backup') })
    assert.equal(report.translated.length, 1)
    assert.deepEqual(report.translated[0].changed.sort(), ['locale/en.json', 'locale/zh.json', 'package.json'])
    const en = JSON.parse(await readFile(join(dir, 'node_modules/demo-image/locale/en.json'), 'utf8'))
    const zh = JSON.parse(await readFile(join(dir, 'node_modules/demo-image/locale/zh.json'), 'utf8'))
    assert.equal(en.meta.title, '中文:Local ComfyUI Bridge')
    assert.equal(zh.meta.title, '中文:Local ComfyUI Bridge')
    assert.equal(en.meta.description, '中文:Queue prompts into ComfyUI.')
    const manifest = JSON.parse(await readFile(join(dir, 'node_modules/demo-image/package.json'), 'utf8'))
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('passthrough（没翻出来）不算中文，不落盘', async () => {
  const dir = await fixture({
    'demo-x': {
      manifest: {
        name: 'demo-x',
        version: '1.0.0',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
      },
      locale: { en: { meta: { title: 'Some Untranslatable Thing', description: 'A description.' } } },
    },
  })
  try {
    const report = await run({
      translator: stubTranslator(() => undefined),
      profileDir: dir,
      backupRoot: join(dir, 'backup'),
    })
    assert.equal(report.translated.length, 0)
    assert.equal(report.failed.length, 1)
    assert.equal(report.failed[0].reason, 'no-chinese-title')
    const written = JSON.parse(await readFile(join(dir, 'node_modules/demo-x/locale/en.json'), 'utf8'))
    assert.deepEqual(written.meta, { title: 'Some Untranslatable Thing', description: 'A description.' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('已是中文的包整体跳过（幂等基础）', async () => {
  const dir = await fixture({
    'demo-cn': {
      manifest: {
        name: 'demo-cn',
        version: '1.0.0',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
      },
      locale: { en: { meta: { title: '已经中文的插件', description: '这段描述本来就是中文。' } } },
    },
  })
  try {
    const before = await scan({ profileDir: dir })
    assert.equal(before.rows[0].needsTitle, false)
    assert.equal(before.rows[0].needsDescription, false)
    const report = await run({ translator: stubTranslator(), profileDir: dir, backupRoot: join(dir, 'backup') })
    assert.equal(report.pending, 0)
    assert.equal(report.items, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyRow 幂等：同内容重复调用不产生第二次写入', async () => {
  const dir = await fixture({
    'demo-idem': {
      manifest: {
        name: 'demo-idem',
        version: '1.0.0',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
      },
      locale: { en: { meta: { title: 'Idempotent Plugin' } } },
    },
  })
  try {
    const [row] = (await scan({ profileDir: dir })).rows
    const first = await applyRow(row, { title: '幂等插件' }, { backupRoot: join(dir, 'backup') })
    assert.deepEqual(first, ['locale/en.json', 'locale/zh.json'])
    const second = await applyRow(row, { title: '幂等插件' }, { backupRoot: join(dir, 'backup') })
    assert.deepEqual(second, [], '第二次不该再写')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('标题是包名但描述可译时：从描述起中文短名，并放行 exports', async () => {
  const dir = await fixture({
    'demo-desc-only': {
      manifest: {
        name: 'demo-desc-only',
        version: '1.0.0',
        main: 'index.js',
        exports: { '.': './index.js', './package.json': './package.json' },
        description: 'Bring paints to the sidebar.',
      },
    },
  })
  try {
    const report = await run({ translator: stubTranslator(), profileDir: dir, backupRoot: join(dir, 'backup') })
    assert.equal(report.translated.length, 1)
    const en = JSON.parse(await readFile(join(dir, 'node_modules/demo-desc-only/locale/en.json'), 'utf8'))
    assert.equal(en.meta.title, '短名:demo-desc-only', '标题占位是包名，必须从描述起一个中文短名')
    assert.equal(en.meta.description, '中文:Bring paints to the sidebar.')
    const manifest = JSON.parse(await readFile(join(dir, 'node_modules/demo-desc-only/package.json'), 'utf8'))
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', '写了 locale 就必须放行 exports')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('rowSources：没有标题时回退包名，并被标记为不可译', async () => {
  const sources = rowSources({ name: 'dsh-image-gen', title: null, description: 'x' })
  assert.equal(sources.title, 'dsh-image-gen')
  assert.equal(sources.titleFallback, true)
  assert.equal(isChinese('图像生成'), true)
  assert.equal(isChinese('dsh-image-gen'), false)
})

test('作者写的中文短名不动：只有长度/标点不合短名规矩的标题才当占位重起', async () => {
  const dir = await fixture({
    'dsh-cost-balance': {
      manifest: { name: 'dsh-cost-balance', description: 'Read the conversation cost in real time.', exports: { './locale/*.json': './locale/*.json' } },
      locale: { zh: { meta: { title: '消费与余额', description: '实时查看对话费用与你的 API 余额。' } } },
    },
  })
  const row = (await scan({ profileDir: dir })).rows[0]
  assert.equal(row.title, '消费与余额', '短名原样保留')
  assert.equal(row.needsTitle, false, '合法中文短名不该被重新起名')
  assert.equal(row.titleIsBrokenPlaceholder, false)
})

test('已写坏的中文长标题（模型把整段描述抄成名字）被当占位重新起名', async () => {
  const broken =
    'DeepSeek Harness GUI（网页版与桌面应用）的余额与费用小组件：侧边栏页脚卡片显示 DeepSeek 账户余额与今日费用。'
  const dir = await fixture({
    'dsh-balance-widget': {
      manifest: {
        name: 'dsh-balance-widget',
        description: 'Balance & cost widget for the DeepSeek Harness GUI.',
        exports: { './locale/*.json': './locale/*.json' },
      },
      locale: {
        en: { meta: { title: broken, description: '余额与费用小组件：侧边栏页脚卡片显示账户余额与今日费用。' } },
        zh: { meta: { title: broken, description: '余额与费用小组件：侧边栏页脚卡片显示账户余额与今日费用。' } },
      },
    },
  })
  const row = (await scan({ profileDir: dir })).rows[0]
  assert.equal(row.titleIsBrokenPlaceholder, true, '长标题要认出来')
  assert.equal(row.title, null, '当成占位，交给起名那条路')
  assert.equal(row.needsTitle, true)

  const report = await run({ translator: stubTranslator(), profileDir: dir, backupRoot: join(dir, 'backup') })
  const zh = JSON.parse(await readFile(join(dir, 'node_modules/dsh-balance-widget/locale/zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(join(dir, 'node_modules/dsh-balance-widget/locale/en.json'), 'utf8'))
  assert.equal(zh.meta.title, '短名:dsh-balance-widget', '中文短名要落盘')
  assert.equal(en.meta.title, '短名:dsh-balance-widget', 'en 兜底也要是同一个短名')
  assert.equal(zh.meta.description, '余额与费用小组件：侧边栏页脚卡片显示账户余额与今日费用。', '原描述不动')
  assert.equal(report.derivedTitles['dsh-balance-widget'], '短名:dsh-balance-widget')
})
