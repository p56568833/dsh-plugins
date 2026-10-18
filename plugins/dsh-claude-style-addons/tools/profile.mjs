/**
 * 安装 / 卸载用的小工具：改 ~/.dsh/profiles/<profile>/package.json，改之前先备份。
 *
 *   add：
 *     ① dependencies[NAME] = link:<本目录>（让包能被解析到）；
 *     ② dsh.profile.bundles 里加上 NAME —— **这一处才决定会不会被加载**
 *        （dsh-app-boot 只按 bundles 名单逐个加载 bundle）；
 *     ③ 顺手把合并前的两个旧插件（dsh-cn-greeting、dsh-skin-fixes）从这两处摘掉 ——
 *        它们的功能都已经在本插件里了，留着就是同一件事做两遍。
 *   remove：把 NAME 从两处摘掉（不会把旧插件加回来）。
 *
 *   node tools/profile.mjs add    [--profile desktop]
 *   node tools/profile.mjs remove [--profile desktop]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'dsh-claude-style-addons'
/** 合并进本插件的旧插件。 */
const REPLACES = ['dsh-cn-greeting', 'dsh-skin-fixes']
const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const action = args[0]
const at = args.indexOf('--profile')
const profile = at !== -1 && args[at + 1] ? args[at + 1] : 'desktop'
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const file = join(home, 'profiles', profile, 'package.json')

if (action !== 'add' && action !== 'remove') {
  console.error('用法：node tools/profile.mjs add|remove [--profile desktop]')
  process.exit(2)
}
if (!existsSync(file)) {
  console.error(`找不到 ${file}，确认一下 DSH 的配置名（默认 desktop）`)
  process.exit(1)
}

const raw = readFileSync(file, 'utf8')
const pkg = JSON.parse(raw)
const indent = (raw.match(/^[ \t]+(?=")/m) || ['  '])[0]
const deps = pkg.dependencies || (pkg.dependencies = {})
const profileSection = (pkg.dsh = pkg.dsh || {}).profile = pkg.dsh.profile || {}
const bundles = (profileSection.bundles = profileSection.bundles || [])
const notes = []
let changed = false

function drop(name) {
  if (name in deps) {
    delete deps[name]
    notes.push(`dependencies 已移除 ${name}`)
    changed = true
  }
  const index = bundles.indexOf(name)
  if (index !== -1) {
    bundles.splice(index, 1)
    notes.push(`bundles 名单已移除 ${name}`)
    changed = true
  }
}

if (action === 'add') {
  const want = 'link:' + PLUGIN_DIR
  if (deps[NAME] !== want) {
    deps[NAME] = want
    notes.push(`dependencies 已登记 ${NAME}`)
    changed = true
  }
  if (!bundles.includes(NAME)) {
    bundles.push(NAME)
    notes.push(`已加进 dsh.profile.bundles（这一处才决定会不会被加载）`)
    changed = true
  }
  for (const old of REPLACES) drop(old)
} else {
  drop(NAME)
}

if (!changed) {
  console.log('profile 已经是想要的样子，不用改')
  process.exit(0)
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const backup = `${file}.before-${NAME}-${action}-${stamp}`
copyFileSync(file, backup)
writeFileSync(file, JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''))
console.log(`${action === 'add' ? '已登记' : '已移除'}：${NAME}`)
for (const note of notes) console.log(`  · ${note}`)
console.log(`  备份：${backup}`)
