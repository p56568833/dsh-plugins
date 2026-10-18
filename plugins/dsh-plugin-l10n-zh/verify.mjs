/**
 * 端到端验证：**用 DSH 官方的 readPluginMeta()** 真跑一遍，看插件页会显示什么。
 *
 * 为什么必须用 Electron 跑：要读 `app.asar` 里的 `@deepseek-ai/dsh-app-boot`。
 * 为什么权威校验要另起进程：Node 会把「第一次解析到的 locale/en.json」缓存在模块解析器里，
 * 同一进程里改完盘再读会拿到旧值 —— 那是校验脚本的假象，不是工具的问题。
 * 所以：父进程负责「造夹具 + 汉化」，子进程（`--verify-only`）负责读官方结果。
 *
 * 用法：
 *   ELECTRON_RUN_AS_NODE=1 "<app>" verify.mjs [--fixture] [--json] [--keep]
 *
 * @module dsh-plugin-l10n-zh/verify
 */

import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveProfileDir, run, scan } from './lib/localize.mjs'
import { createTranslator } from './lib/deepseek-translator.mjs'

const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const ENTRY = `${ASAR}/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`
const { readPluginMeta } = await import(pathToFileURL(ENTRY).href)

const args = new Set(process.argv.slice(2))
const useFixture = args.has('--fixture')
const json = args.has('--json')
const keep = args.has('--keep')
const verifyOnlyIndex = process.argv.indexOf('--verify-only')

/**
 * 调用官方元信息读取，异常兜成对象。
 * @param {string} specifier 包名。
 * @param {string} parentURL 解析基准。
 * @returns {object|null} 元信息。
 */
function metaOf(specifier, parentURL) {
  try {
    return readPluginMeta(specifier, parentURL) ?? null
  } catch (error) {
    return { error: String(error?.message ?? error) }
  }
}

/**
 * 元信息里 title / description 是否已是中文（映射形式看 `zh`）。
 * @param {object|null} meta 元信息。
 * @returns {{title:boolean, description:boolean}} 判定。
 */
function chineseState(meta) {
  // 官方返回的可能是纯字符串，也可能是 {en, zh, …} 映射；
  // 映射里只有 en 一条（作者只写了中文 en.json）时，就给那一份定语言。
  const pick = (value) => {
    const chinese = (text) => typeof text === 'string' && /[\u3400-\u9fff]/.test(text)
    if (chinese(value)) return true
    if (value && typeof value === 'object') {
      if (chinese(value.zh)) return true
      return Object.values(value).some(chinese)
    }
    return false
  }
  return { title: pick(meta?.title), description: pick(meta?.description) }
}

/**
 * 写一个包的 package.json。
 * @param {string} packages node_modules 目录。
 * @param {string} name 包名。
 * @param {object} manifest 内容。
 * @returns {Promise<void>} 完成即写完。
 */
async function writePackage(packages, name, manifest) {
  await mkdir(join(packages, name), { recursive: true })
  await writeFile(join(packages, name, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * 写一个语言文件。
 * @param {string} packages node_modules 目录。
 * @param {string} name 包名。
 * @param {string} language 语言 id。
 * @param {object} value 内容。
 * @returns {Promise<void>} 完成即写完。
 */
async function writeLocale(packages, name, language, value) {
  await mkdir(join(packages, name, 'locale'), { recursive: true })
  await writeFile(join(packages, name, 'locale', `${language}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * 造夹具：三种真实形态各一个 —— 没 locale、有 locale 但没放行 exports、本来就中文。
 * @param {string} dir 夹具目录。
 * @returns {Promise<string>} 夹具 profile 目录。
 */
async function makeFixture(dir) {
  const packages = join(dir, 'node_modules')
  await mkdir(packages, { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'dsh-profile-fixture',
        private: true,
        dependencies: { 'fixture-plain': '1.0.0', 'fixture-locale': '1.0.0', 'fixture-done': '1.0.0' },
        dsh: { profile: { bundles: ['fixture-plain', 'fixture-locale', 'fixture-done'] } },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await writePackage(packages, 'fixture-plain', {
    name: 'fixture-plain',
    version: '1.0.0',
    description: 'Read the conversation cost and your API balance in real time.',
    main: 'index.js',
    exports: { '.': './index.js', './package.json': './package.json' },
  })
  await writePackage(packages, 'fixture-locale', {
    name: 'fixture-locale',
    version: '1.0.0',
    main: 'index.js',
    exports: { '.': './index.js', './package.json': './package.json' },
    description: 'fallback description',
  })
  await writeLocale(packages, 'fixture-locale', 'en', {
    meta: {
      title: 'Local ComfyUI Bridge',
      description: 'Queue prompts and stream generated images into the chat.',
    },
  })
  await writePackage(packages, 'fixture-done', {
    name: 'fixture-done',
    version: '1.0.0',
    main: 'index.js',
    exports: { '.': './index.js', './package.json': './package.json', './locale/*.json': './locale/*.json' },
  })
  await writeLocale(packages, 'fixture-done', 'en', {
    meta: { title: '已经中文的插件', description: '这段描述本来就是中文，不该被改动。' },
  })
  return dir
}

/**
 * `--verify-only`：子进程模式，只读官方元信息并输出一行 JSON。
 * @param {string} profileDir profile 目录。
 * @returns {number} 退出码。
 */
function verifyOnly(profileDir) {
  const parentURL = pathToFileURL(join(profileDir, 'package.json')).href
  const rows = JSON.parse(process.env.DSH_L10N_ZH_ROWS ?? '[]')
  const out = rows.map((name) => ({ name, meta: metaOf(name, parentURL) }))
  console.log(`DSH_L10N_ZH_RESULT ${JSON.stringify(out)}`)
  return 0
}

/**
 * 主流程。
 * @returns {Promise<number>} 退出码。
 */
async function main() {
  if (verifyOnlyIndex >= 0) return verifyOnly(process.argv[verifyOnlyIndex + 1])

  let profileDir = resolveProfileDir()
  let fixtureDir
  if (useFixture) {
    fixtureDir = await mkdtemp(join(tmpdir(), 'dsh-l10n-zh-fixture-'))
    profileDir = await makeFixture(fixtureDir)
  }
  const parentURL = pathToFileURL(join(profileDir, 'package.json')).href
  const translator = createTranslator({
    logger: { info: () => {}, warn: console.warn },
    cachePath: process.env.DSH_PLUGIN_L10N_ZH_CACHE ?? join(homedir(), '.dsh', 'plugin-l10n-zh', 'cache.json'),
  })
  const before = await scan({ profileDir })

  console.log(`profile: ${profileDir}`)
  console.log(`\n== 汉化前（官方 readPluginMeta）==`)
  for (const row of before.rows) {
    const meta = metaOf(row.name, parentURL)
    const state = chineseState(meta)
    console.log(
      `  ${row.name.padEnd(18)} title=${state.title ? '中文' : '英文'} description=${state.description ? '中文' : '英文'}`,
    )
  }
  if (useFixture) {
    console.log('  （此刻「未放行 exports」的包读不到 locale，只能回退 package.json 原文 —— 这正是要修的病）')
  }

  // 夹具跑在沙箱里也要能过：备份放夹具目录内；真实 profile 用 ~/.dsh 下的默认位置。
  const backupRoot = useFixture ? join(fixtureDir, 'backup') : undefined
  const report = await run({ translator, profileDir, backupRoot, logger: { info: () => {}, warn: console.warn } })
  await translator.save()
  console.log(`\n== 汉化 ==`)
  console.log(`  处理 ${report.translated.length} 个插件，失败 ${report.failed.length} 个`)
  for (const row of report.translated) console.log(`  ✓ ${row.name}: ${row.title ?? ''}`)
  for (const row of report.failed) console.log(`  ✗ ${row.name}: ${row.reason}`)

  // 权威校验：另起一个进程读官方结果（避开模块解析缓存）
  const names = before.rows.map((row) => row.name)
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--verify-only', profileDir], {
    env: { ...process.env, DSH_L10N_ZH_ROWS: JSON.stringify(names) },
    encoding: 'utf8',
  })
  const line = (child.stdout ?? '').split('\n').find((text) => text.startsWith('DSH_L10N_ZH_RESULT '))
  if (line === undefined) {
    console.error('子进程校验失败：', child.stderr || child.stdout)
    return 1
  }
  const checked = JSON.parse(line.slice('DSH_L10N_ZH_RESULT '.length))

  console.log(`\n== 汉化后（新进程里的官方 readPluginMeta）==`)
  const problems = []
  for (const { name, meta } of checked) {
    const state = chineseState(meta)
    const row = before.rows.find((candidate) => candidate.name === name)
    // 标题占位（title === 包名）的行，只要有中文短名就算过；描述本来就没文案可译时也不强求。
    const wanted = row === undefined ? { title: true, description: true } : row
    const ok = (wanted.needsTitle ? state.title : true) && (wanted.needsDescription ? state.description : true)
    if (!ok) problems.push(name)
    console.log(`  ${name.padEnd(18)} ${ok ? '✓ 中文' : '✗ 仍非中文'}`)
    if (json) console.log(`      ${JSON.stringify(meta)}`)
    else {
      console.log(`      title       = ${JSON.stringify(meta?.title)}`)
      console.log(`      description = ${JSON.stringify(meta?.description)}`)
      if (meta?.error) console.log(`      ⚠ error: ${meta.error}`)
    }
  }

  const again = await run({ translator, profileDir, backupRoot, logger: { info: () => {}, warn: console.warn } })
  const idempotent = again.translated.length === 0
  console.log(`\n幂等复跑：${idempotent ? '✓ 无新增改动' : `✗ 又改了 ${again.translated.length} 个`}`)

  if (fixtureDir !== undefined && keep) {
    for (const name of ['fixture-plain', 'fixture-locale']) {
      const file = join(fixtureDir, 'node_modules', name, 'locale', 'en.json')
      const text = await readFile(file, 'utf8').catch(() => '(未生成)')
      console.log(`\n-- ${name}/locale/en.json\n${text}`)
    }
    console.log(`夹具保留在：${fixtureDir}`)
  } else if (fixtureDir !== undefined) {
    await rm(fixtureDir, { recursive: true, force: true })
  }

  const ok = problems.length === 0 && idempotent
  console.log(`\n结论：${ok ? '通过' : '未通过'}`)
  return ok ? 0 : 1
}

/**
 * 收尾：用 `process.exitCode` 而不是 `process.exit()`。
 *
 * 官方 meta 里带着各插件 `icon` 的 data:URL，子进程那一行 `DSH_L10N_ZH_RESULT` 有
 * 60KB 以上；`process.exit()` 不等待 stdout 的异步写入，管道（macOS 上 64KB）里
 * 还没送出去的部分会被丢掉，父进程 JSON.parse 就报 `Unterminated string`。
 * 设 exitCode 让 Node 自己刷完再退出。
 */
process.exitCode = await main()
