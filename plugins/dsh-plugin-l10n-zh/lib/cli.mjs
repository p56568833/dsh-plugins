#!/usr/bin/env node
/**
 * dsh-plugin-l10n-zh 的命令行：手动跑一遍汉化、看状态、回滚。
 *
 *   node lib/cli.mjs scan              # 只看：哪些插件没有中文，会写哪些文件
 *   node lib/cli.mjs check             # 看：每个插件的当前状态（中文/英文/待处理）
 *   node lib/cli.mjs apply [--dry-run] # 补中文（--dry-run 只显示译文不落盘）
 *   node lib/cli.mjs revert            # 从备份还原
 *
 * 通常不需要手动跑：宿主插件会在安装/更新后与启动时自动执行。
 *
 * @module dsh-plugin-l10n-zh/cli
 */

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createTranslator } from './deepseek-translator.mjs'
import { homedir } from 'node:os'
import {
  BACKUP_DIR_NAME,
  pendingItems,
  resolveProfileDir,
  revertPackage,
  run,
  scan,
} from './localize.mjs'

/** 默认备份根目录：放在 ~/.dsh 下，插件重装不会连备份一起删。 */
const DEFAULT_BACKUP_ROOT = join(homedir(), '.dsh', BACKUP_DIR_NAME)

/** 翻译缓存：同一句英文只花一次 API 钱。 */
const DEFAULT_CACHE_PATH = join(homedir(), '.dsh', 'plugin-l10n-zh', 'cache.json')

const argv = process.argv.slice(2)
const command = argv.find((arg) => !arg.startsWith('-')) ?? 'scan'
const dryRun = argv.includes('--dry-run')
const json = argv.includes('--json')
const profileArgIndex = argv.indexOf('--profile')
const profileDir = profileArgIndex >= 0 ? argv[profileArgIndex + 1] : undefined

const logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
}

/**
 * 读术语表（缺失时退化为空表）。
 * @returns {Promise<Record<string,string>>} 术语表。
 */
async function glossary() {
  const file = new URL('./glossary.json', import.meta.url)
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * `scan`：打印待处理清单。
 * @returns {Promise<number>} 退出码。
 */
async function commandScan() {
  const result = await scan({ profileDir })
  const rows = result.rows
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return 0
  }
  console.log(`profile: ${result.profileDir}`)
  console.log(`共 ${rows.length} 个候选包\n`)
  for (const row of rows) {
    // 标题就是包名时没有可译文案，工具按设计不动它 —— 不该显示成「待处理」。
    const titleTranslatable = row.needsTitle && row.title !== row.name
    const needs = [titleTranslatable ? '标题' : null, row.needsDescription ? '描述' : null].filter(Boolean)
    const badge =
      needs.length === 0
        ? row.needsTitle && row.title === row.name
          ? '✓ 无需处理'
          : '✓ 已中文'
        : `待处理: ${needs.join('+')}`
    const extra = []
    if (needs.length > 0 && !row.localeExport) extra.push('需放行 exports')
    if (needs.length > 0) extra.push(`写 ${row.writes.join(' ')}`)
    const note = needs.length === 0 && row.needsTitle && row.title === row.name ? '  （标题即包名，无文案可译）' : ''
    console.log(`  ${badge.padEnd(14)} ${row.name}${extra.length > 0 ? `  → ${extra.join('；')}` : ''}${note}`)
  }
  return 0
}

/**
 * `check`：打印每个插件的展示文字现状。
 * @returns {Promise<number>} 退出码。
 */
async function commandCheck() {
  const result = await scan({ profileDir })
  console.log(`profile: ${result.profileDir}\n`)
  for (const row of result.rows) {
    const state = row.titleIsChinese && (row.descriptionIsChinese || row.description === null) ? '中文' : '英文/其它'
    console.log(`── ${row.name}  [${state}]`)
    console.log(`   title       = ${JSON.stringify(row.title)}`)
    console.log(`   description = ${JSON.stringify(row.description)}`)
  }
  return 0
}

/**
 * `apply`：真正补上中文。
 * @returns {Promise<number>} 退出码。
 */
async function commandApply() {
  const translator = createTranslator({ logger, glossary: await glossary(), cachePath: DEFAULT_CACHE_PATH })
  const report = await run({ translator, profileDir, dryRun, logger, backupRoot: DEFAULT_BACKUP_ROOT })
  await translator.save()
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`待处理 ${report.pending} 个插件 / ${report.items} 条文本`)
    for (const row of report.translated) {
      console.log(`  ${dryRun ? '·' : '✓'} ${row.name}`)
      if (row.title !== undefined) console.log(`      title       → ${row.title}`)
      if (row.description !== undefined) console.log(`      description → ${row.description}`)
      if (!dryRun && row.changed) console.log(`      写入: ${row.changed.join(', ')}`)
    }
    for (const row of report.failed) console.log(`  ✗ ${row.name}: ${row.reason}`)
    for (const row of report.skipped) console.log(`  · 跳过 ${row.name}（${row.reason}）`)
    console.log('stats:', JSON.stringify(report.stats ?? {}))
    if (!dryRun && report.translated.length > 0) console.log('\n刷新插件页（Cmd+R）即可看到中文。')
  }
  return report.failed.length > 0 && report.translated.length === 0 ? 1 : 0
}

/**
 * `revert`：从备份还原。
 * @returns {Promise<number>} 退出码。
 */
async function commandRevert() {
  const result = await scan({ profileDir: resolveProfileDir(profileDir) })
  const backupRoot = DEFAULT_BACKUP_ROOT
  if (!existsSync(backupRoot)) {
    console.log('没有备份目录，无需还原。')
    return 0
  }
  const names = await readdir(backupRoot, { withFileTypes: true })
  for (const entry of names) {
    if (!entry.isDirectory()) continue
    const packageDir = join(result.packagesDir, entry.name)
    const outcome = await revertPackage(backupRoot, packageDir)
    console.log(`✓ ${entry.name}: 还原 ${outcome.restored.length} 个文件，删除 ${outcome.removed.length} 个新建文件`)
  }
  return 0
}

/**
 * `pending`：只列待翻译条目（调试用）。
 * @returns {Promise<number>} 退出码。
 */
async function commandPending() {
  const result = await scan({ profileDir })
  const { title, description } = pendingItems(result.rows)
  console.log(JSON.stringify({ title, description }, null, 2))
  return 0
}

const commands = {
  scan: commandScan,
  check: commandCheck,
  apply: commandApply,
  revert: commandRevert,
  pending: commandPending,
}

const handler = commands[command]
if (handler === undefined) {
  console.error(`未知命令：${command}\n可用：${Object.keys(commands).join(' / ')}`)
  process.exit(2)
}
process.exit(await handler())
