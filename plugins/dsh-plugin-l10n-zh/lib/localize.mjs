/**
 * dsh-plugin-l10n-zh 的核心：扫描已装插件的展示元信息、算出要补的中文、落盘、可回滚。
 *
 * 为什么是「补文件」而不是「改内存」
 * --------------------------------
 * 插件页每一行的文字来自官方 `readPluginMeta()`，它**每次调用都重新读盘**：
 *   1. 先解析 `<包>/locale/en.json`；存在才把同目录所有 `.json` 按文件名当语言读进来，
 *      每份读 `meta.title` / `meta.description`；
 *   2. 缺字段则回退到 `package.json` 的 `name` / `description`。
 * 而客户端 `resolveText()` 的兜底链**最后一定是 `en`**，所以光写 `zh.json` 只在
 * UI 语言是中文时才显示中文。要保证任何语言下都是中文，`en.json` 也必须写中文。
 *
 * 于是本模块对每个「还没有中文元信息」的包做三件事：
 *   · 放行 `exports["./locale/*.json"]`（没有它，整个 locale 目录读不到）；
 *   · 写 `locale/en.json` 与 `locale/zh.json` 的 `meta.title` / `meta.description`；
 *   · 改动前备份到 `<packagesDir>/.dsh-plugin-l10n-zh-backup/<包名>/`，支持 `revert`。
 *
 * 只碰 `meta.title` / `meta.description` 两个键，幂等，可反复运行。
 *
 * @module dsh-plugin-l10n-zh/localize
 */

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { usableDerivedTitle } from './deepseek-translator.mjs'

/** 目标语言固定简体中文。 */
export const TARGET_LANGUAGE = 'zh'

/** 需要放行的 exports 键。 */
export const LOCALE_EXPORT_KEY = './locale/*.json'

/** 备份 / 回滚清单所在目录名（默认放在 ~/.dsh 下，不在 node_modules 里 —— 插件重装不会连备份一起删）。 */
export const BACKUP_DIR_NAME = 'dsh-plugin-l10n-zh-backup'

/** 含 CJK 即视为已是中文。 */
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

/**
 * 找一个 profile 的目录：显式参数 > `DSH_PROFILE_DIR` > `~/.dsh/profiles/<profile>`。
 * @param {string} [profileDir] 显式目录。
 * @param {Record<string,string|undefined>} [env] 环境变量来源。
 * @param {string} [home] 家目录。
 * @returns {string} 绝对路径。
 */
export function resolveProfileDir(profileDir, env = process.env, home = homedir()) {
  if (profileDir) return resolve(profileDir)
  if (env.DSH_PROFILE_DIR) return resolve(env.DSH_PROFILE_DIR)
  const profile = env.DSH_PROFILE ?? 'desktop'
  return join(home, '.dsh', 'profiles', profile)
}

/**
 * 文本是否已是中文。
 * @param {unknown} text 待检查文本。
 * @returns {boolean} 含 CJK 即 true。
 */
export function isChinese(text) {
  return typeof text === 'string' && CJK.test(text)
}

/**
 * 去掉可能的 BOM 后解析 JSON；失败返回 undefined。
 * @param {string} file 路径。
 * @returns {Promise<any|undefined>} 解析结果。
 */
async function readJson(file) {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  } catch {
    return undefined
  }
}

/**
 * 原子写 JSON（2 空格缩进、保留非 ASCII 原文、末尾换行）。
 * @param {string} file 目标路径。
 * @param {unknown} value 可序列化值。
 * @returns {Promise<void>} 完成即落盘。
 */
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const text = `${JSON.stringify(value, null, 2)}\n`
  const tmp = `${file}.l10n-zh.${process.pid}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, file)
}

/**
 * 从 profile 的 package.json / 安装锚点里收集候选包名，顺序稳定且去重。
 * @param {string} profileDir profile 目录。
 * @returns {Promise<string[]>} 包名数组。
 */
export async function collectPackageNames(profileDir) {
  const names = []
  const push = (name) => {
    if (typeof name === 'string' && name !== '' && !names.includes(name)) names.push(name)
  }
  const manifest = await readJson(join(profileDir, 'package.json'))
  for (const name of manifest?.dsh?.profile?.bundles ?? []) push(name)
  for (const name of Object.keys(manifest?.dependencies ?? {})) push(name)
  return names
}

/**
 * 读一个包的 package.json。
 * @param {string} dir 包目录。
 * @returns {Promise<any|undefined>} 解析结果。
 */
async function readPackageManifest(dir) {
  return readJson(join(dir, 'package.json'))
}

/**
 * exports 是否放行了 locale 目录。
 * @param {any} manifest package.json。
 * @returns {{supported:boolean, exported:boolean}} supported 表示该 exports 形状能被本工具修补。
 */
function localeExportState(manifest) {
  const exports = manifest?.exports
  if (exports === undefined) return { supported: true, exported: false }
  if (typeof exports !== 'object' || exports === null || Array.isArray(exports)) {
    return { supported: false, exported: false }
  }
  // 子路径形式的 exports：根 "." 上的条件也要看，但 locale 放行必须在顶层键。
  return { supported: true, exported: Object.hasOwn(exports, LOCALE_EXPORT_KEY) }
}

/**
 * 读 `locale/` 下所有语言文件里的 meta。
 * @param {string} dir 包目录。
 * @returns {Promise<Record<string,{title?:string,description?:string}>>} 语言 → meta。
 */
async function readLocaleMetas(dir) {
  const localeDir = join(dir, 'locale')
  if (!existsSync(localeDir)) return {}
  let entries
  try {
    entries = await readdir(localeDir, { withFileTypes: true })
  } catch {
    return {}
  }
  const out = {}
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const language = entry.name.slice(0, -5)
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language)) continue
    const parsed = await readJson(join(localeDir, entry.name))
    const meta = parsed?.meta
    if (typeof meta !== 'object' || meta === null) continue
    const value = {}
    if (typeof meta.title === 'string' && meta.title.trim() !== '') value.title = meta.title
    if (typeof meta.description === 'string' && meta.description.trim() !== '') value.description = meta.description
    out[language.toLowerCase()] = value
  }
  return out
}

/**
 * 扫描一个 profile 里所有候选插件的展示元信息状态。
 * @param {{profileDir?:string, names?:string[]}} [options] 扫描选项。
 * @returns {Promise<{profileDir:string, packagesDir:string, rows:ScanRow[]}>} 扫描结果。
 */
export async function scan(options = {}) {
  const profileDir = resolveProfileDir(options.profileDir)
  const packagesDir = join(profileDir, 'node_modules')
  const names = options.names ?? (await collectPackageNames(profileDir))
  const rows = []
  for (const name of names) {
    const dir = join(packagesDir, name)
    if (!existsSync(join(dir, 'package.json'))) continue
    const manifest = await readPackageManifest(dir)
    if (manifest === undefined) continue
    const { supported, exported } = localeExportState(manifest)
    const metas = await readLocaleMetas(dir)
    const hasEnglishAnchor = Object.hasOwn(metas, 'en')
    const zh = metas[TARGET_LANGUAGE]
    const en = metas.en

    // 「现在会显示什么」= 中文优先，其次英文锚点，最后 package.json 原文。
    const title = zh?.title ?? en?.title ?? (typeof manifest.name === 'string' ? manifest.name : null)
    const description =
      zh?.description ?? en?.description ?? (typeof manifest.description === 'string' ? manifest.description : null)

    // 已经写坏的中文标题（模型把整段描述抄成了名字）要当占位重新起名：
    // 它不是能给人看的标题，但「是中文」所以老判据会一直放过它。
    // 只对「长度/标点不合短名规矩」的中文标题生效，作者自己写的短名不动；
    // package.json 自己声明了 title 的包也不碰（那是作者的原始文案）。
    const manifestOwnsTitle = typeof manifest.title === 'string' && manifest.title.trim() !== ''
    const titleIsBrokenPlaceholder =
      !manifestOwnsTitle && typeof title === 'string' && isChinese(title) && !usableDerivedTitle(title)

    // 来源：决定「英文原文」从哪取，用来送去翻译。
    const titleSource = zh?.title !== undefined ? 'locale' : en?.title !== undefined ? 'locale' : manifest.name !== undefined ? 'manifest' : 'none'
    const needsTitle = titleIsBrokenPlaceholder || !isChinese(title)
    const needsDescription = !isChinese(description)
    const writes = []
    if (needsTitle || needsDescription) {
      if (!exported && supported) writes.push('package.json')
      writes.push('locale/en.json', `locale/${TARGET_LANGUAGE}.json`)
    }
    rows.push({
      name,
      dir,
      supported,
      localeExport: exported,
      hasEnglishAnchor,
      source: titleSource,
      title: titleIsBrokenPlaceholder || typeof title !== 'string' ? null : title,
      description: typeof description === 'string' ? description : null,
      titleIsChinese: isChinese(title),
      descriptionIsChinese: isChinese(description),
      titleIsBrokenPlaceholder,
      needsTitle,
      needsDescription,
      writes,
    })
  }
  return { profileDir, packagesDir, rows }
}

/**
 * 备份一次即将改动的文件（只备份一次，已存在的备份不覆盖）。
 * @param {string} backupRoot 备份根目录。
 * @param {string} packageDir 包目录。
 * @param {string[]} rels 相对包目录的文件路径。
 * @returns {Promise<void>} 完成即备份。
 */
async function backupFiles(backupRoot, packageDir, rels) {
  const name = packageDir.slice(packageDir.lastIndexOf('/') + 1)
  const created = []
  for (const rel of rels) {
    const src = join(packageDir, rel)
    const dst = join(backupRoot, name, rel)
    if (existsSync(dst)) continue
    if (!existsSync(src)) {
      created.push(rel)
      continue
    }
    await mkdir(dirname(dst), { recursive: true })
    await cp(src, dst)
  }
  if (created.length > 0) {
    const file = join(backupRoot, name, '_created.json')
    const previous = (await readJson(file)) ?? []
    const next = [...new Set([...previous, ...created])].sort()
    await writeJsonAtomic(file, next)
  }
}

/**
 * 把一个包的中文元信息落到磁盘。
 * @param {ScanRow} row 扫描行。
 * @param {{title?:string, description?:string}} translated 中文译文。
 * @param {{backupRoot:string}} options 备份根目录。
 * @returns {Promise<string[]>} 实际发生变化的文件（相对包目录）。
 */
export async function applyRow(row, translated, options) {
  const changed = []
  const packageFile = join(row.dir, 'package.json')
  const manifest = await readPackageManifest(row.dir)
  if (manifest === undefined) throw new Error(`${row.name}: package.json 读不了`)

  const needExports = !row.localeExport
  const { supported } = localeExportState(manifest)
  if (needExports && !supported) {
    throw new Error(`${row.name}: exports 不是对象形状，无法放行 ${LOCALE_EXPORT_KEY}`)
  }

  // 先算「要写什么」，没内容就一个文件都不碰（尤其是别放空 meta 文件）。
  const meta = {}
  if (translated.title !== undefined && translated.title !== null) meta.title = translated.title
  if (translated.description !== undefined && translated.description !== null && translated.description !== '') {
    meta.description = translated.description
  }
  // 空的 meta 会让 readPluginMeta 认定该包「有 locale」，从此不再回退到 package.json，
  // 显示反而比汉化前更差（实测踩过：dshmarket 的原生中英描述被挤掉）。
  if (Object.keys(meta).length === 0) return []

  const rels = []
  if (needExports) rels.push('package.json')
  rels.push('locale/en.json', `locale/${TARGET_LANGUAGE}.json`)
  await backupFiles(options.backupRoot, row.dir, rels)

  for (const language of ['en', TARGET_LANGUAGE]) {
    const file = join(row.dir, 'locale', `${language}.json`)
    const current = (await readJson(file)) ?? {}
    const next = { ...current, meta: { ...(current.meta ?? {}), ...meta } }
    const before = JSON.stringify(current)
    if (before === JSON.stringify(next)) continue
    await writeJsonAtomic(file, next)
    changed.push(`locale/${language}.json`)
  }

  // 确实写了 locale 才值得放行 exports（否则只是白改 package.json）。
  if (needExports && changed.length > 0) {
    manifest.exports[LOCALE_EXPORT_KEY] = LOCALE_EXPORT_KEY
    await writeJsonAtomic(packageFile, manifest)
    changed.push('package.json')
  }
  return changed
}

/**
 * 从备份还原一个包。
 * @param {string} backupRoot 备份根目录。
 * @param {string} packageDir 包目录。
 * @returns {Promise<{restored:string[], removed:string[], existed:boolean}>} 还原结果。
 */
export async function revertPackage(backupRoot, packageDir) {
  const name = packageDir.slice(packageDir.lastIndexOf('/') + 1)
  const root = join(backupRoot, name)
  if (!existsSync(root)) return { restored: [], removed: [], existed: false }
  const restored = []
  const walk = async (dir, rel) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '_created.json') continue
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await walk(join(dir, entry.name), next)
      else {
        const dst = join(packageDir, next)
        await mkdir(dirname(dst), { recursive: true })
        await cp(join(dir, entry.name), dst)
        restored.push(next)
      }
    }
  }
  await walk(root, '')
  const created = (await readJson(join(root, '_created.json'))) ?? []
  const removed = []
  for (const rel of created) {
    const target = join(packageDir, rel)
    if (existsSync(target) && !existsSync(join(root, rel))) {
      await rm(target, { force: true })
      removed.push(rel)
    }
  }
  return { restored, removed, existed: true }
}

/**
 * 给定扫描结果，算出还需要翻译的条目。
 * @param {ScanRow[]} rows 扫描行。
 * @returns {{title:TextItem[], description:TextItem[]}} 待翻译条目。
 */
export function pendingItems(rows) {
  const title = []
  const description = []
  for (const row of rows) {
    if (row.needsTitle && row.title !== null && row.title.trim() !== '') {
      title.push({ kind: 'title', source: row.title })
    }
    if (row.needsDescription && row.description !== null && row.description.trim() !== '') {
      description.push({ kind: 'description', source: row.description })
    }
  }
  return { title, description }
}

/**
 * 把译文按 (kind, source) 建索引，方便回填到扫描行。
 *
 * 注意：`via === 'passthrough'` 的条目 target 就是英文原文，**不能当中文用**；
 * 译文里必须至少含一个 CJK 字符才认为真的翻译成功。
 * @param {TextResult[]} results 翻译结果。
 * @returns {Map<string,string>} 索引。
 */
export function indexTranslations(results) {
  const map = new Map()
  for (const result of results) {
    if (result?.via === 'passthrough') continue
    if (typeof result?.target !== 'string' || !isChinese(result.target)) continue
    map.set(`${result.kind}\u0000${result.source}`, result.target)
  }
  return map
}

/**
 * 运行报告里的一条「插件待办」。
 * @typedef {{name:string, dir:string, needsTitle:boolean, needsDescription:boolean, title:string|null, description:string|null}} PendingRow
 */

/**
 * 读一行的「原文」，用于翻译；没有可用原文时回退到包名（标题）。
 * @param {ScanRow} row 扫描行。
 * @returns {{title:string|null, description:string|null, titleFallback:boolean}} 原文。
 */
export function rowSources(row) {
  const title = row.title !== null && row.title.trim() !== '' ? row.title : row.name
  return { title, description: row.description, titleFallback: row.title === null || row.title.trim() === '' }
}

/**
 * 这一行的标题是不是「包名占位」——插件页当时会把包名当标题显示，那不是给人看的标题。
 * @param {ScanRow} row 扫描行。
 * @returns {boolean} 是包名占位即 true。
 */
export function titleIsPlaceholder(row) {
  return row.needsTitle && (row.title === null || row.title === row.name)
}

/**
 * 在一个 profile 上跑一遍完整的「扫描 → 翻译 → 落盘」。
 * @param {{translator:ReturnType<import('./deepseek-translator.mjs').createTranslator>, profileDir?:string, names?:string[], dryRun?:boolean, backupRoot?:string, logger?:{info:Function,warn:Function}, onProgress?:Function}} options 运行选项。
 * @returns {Promise<object>} 运行报告。
 */
export async function run(options) {
  const log = options.logger ?? { info: () => {}, warn: () => {} }
  const scanned = await scan({ profileDir: options.profileDir, names: options.names })
  const rows = scanned.rows.filter((row) => row.needsTitle || row.needsDescription)
  const items = []
  /** 标题是包名占位、但有描述可以借来起名的行。 */
  const needDerivedTitle = []
  for (const row of rows) {
    const { title, description } = rowSources(row)
    if (row.needsTitle && title !== null) {
      // 包名本身不是「文案」：不送翻译，改从描述里起一个中文短名。
      if (title === row.name) {
        if (description !== null && description.trim() !== '') {
          needDerivedTitle.push({ name: row.name, description, row })
        }
      } else {
        items.push({ kind: 'title', source: title })
      }
    }
    if (row.needsDescription && description !== null) items.push({ kind: 'description', source: description })
  }
  const backupRoot = options.backupRoot ?? join(homedir(), '.dsh', BACKUP_DIR_NAME)

  const report = {
    profileDir: scanned.profileDir,
    scanned: scanned.rows.length,
    pending: rows.length,
    items: items.length + needDerivedTitle.length,
    translated: [],
    failed: [],
    skipped: [],
    derivedTitles: {},
    dryRun: options.dryRun === true,
    at: new Date().toISOString(),
  }
  if (items.length === 0 && needDerivedTitle.length === 0) {
    log.info('dsh-plugin-l10n-zh: 没有需要汉化的插件')
    return report
  }
  const results = await options.translator.translate(items)
  const index = indexTranslations(results)

  // 标题是包名占位的行：从描述里起一个中文短名（包名不该出现在插件页标题上）。
  const derived = new Map()
  if (needDerivedTitle.length > 0 && typeof options.translator.deriveTitle === 'function') {
    try {
      const named = await options.translator.deriveTitle(
        needDerivedTitle.map(({ name, description }) => ({ name, description })),
      )
      for (const [name, title] of named) derived.set(name, title)
    } catch (error) {
      log.warn(`dsh-plugin-l10n-zh: 起中文短名失败：${String(error?.message ?? error)}`)
    }
  } else if (needDerivedTitle.length > 0) {
    // 翻译器不支持起名时退一步：把描述当标题翻译（比包名强，但不保证短）。
    const start = items.length
    for (const { description } of needDerivedTitle) items.push({ kind: 'title', source: description })
    const extra = await options.translator.translate(items.slice(start))
    for (const [position, result] of extra.entries()) {
      if (result?.target !== undefined && result.via !== 'passthrough' && isChinese(result.target)) {
        derived.set(needDerivedTitle[position].name, result.target)
      }
    }
  }
  report.derivedTitles = Object.fromEntries(derived)

  for (const row of rows) {
    const { title: titleSource, description: descriptionSource } = rowSources(row)
    const translated = {
      title: row.needsTitle && titleSource !== null ? index.get(`title\u0000${titleSource}`) : undefined,
      description:
        row.needsDescription && descriptionSource !== null
          ? index.get(`description\u0000${descriptionSource}`)
          : undefined,
    }
    // 包名占位的标题改用「从描述起的中文短名」。
    if (translated.title === undefined && derived.has(row.name)) translated.title = derived.get(row.name)
    // 只要这一行有任意一处变成中文就落盘；标题确实没起出来时，保持包名兜底即可。
    const usable =
      (row.needsTitle ? translated.title !== undefined : true) &&
      (row.needsDescription ? translated.description !== undefined : true)
    const partial = !usable && (translated.title !== undefined || translated.description !== undefined)
    if (!usable && !partial) {
      report.failed.push({
        name: row.name,
        reason: row.needsTitle && translated.title === undefined ? 'no-chinese-title' : 'no-chinese-description',
      })
      continue
    }
    if (report.dryRun) {
      report.translated.push({ name: row.name, ...translated, dryRun: true })
      continue
    }
    try {
      const changed = await applyRow(row, translated, { backupRoot })
      // 没有可写内容（例如标题就是包名、没有可译文案）时记 skipped，不算“汉化过”。
      if (changed.length === 0) {
        report.skipped.push({ name: row.name, reason: 'nothing-translatable' })
      } else {
        report.translated.push({ name: row.name, ...translated, changed })
      }
    } catch (error) {
      report.failed.push({ name: row.name, reason: String(error?.message ?? error) })
      log.warn(`dsh-plugin-l10n-zh: ${row.name} 落盘失败：${String(error?.message ?? error)}`)
    }
    if (typeof options.onProgress === 'function') options.onProgress(report)
  }
  const stats = options.translator.stats()
  report.stats = stats
  return report
}

/** 当前时间戳字符串，用于日志文件名。 */
export function stamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 供宿主插件调用的日志路径。
 * @param {string} [home] 家目录。
 * @returns {string} 日志目录。
 */
export function logDir(home = homedir()) {
  return join(home, '.dsh', 'plugin-l10n-zh')
}

/**
 * 文件是否可写（用于 CLI 提示权限问题）。
 * @param {string} file 路径。
 * @returns {Promise<boolean>} 可写即 true。
 */
export async function writable(file) {
  try {
    await stat(dirname(file))
    return true
  } catch {
    return false
  }
}

/** @typedef {{title?:string, description?:string}} MetaText */
/** @typedef {{kind:'title'|'description', source:string}} TextItem */
/** @typedef {{kind:'title'|'description', source:string, target:string, via:string}} TextResult */
/** @typedef {Awaited<ReturnType<typeof scan>>['rows'][number]} ScanRow */
