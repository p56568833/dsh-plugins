/**
 * 安装 / 卸载用的小工具：只改 ~/.dsh/profiles/<profile>/package.json 的 dependencies 一行，
 * 改之前先备份。bundles 和 node_modules 链接交给 DSH 自己的 `dsh plugin install --offline` 去建。
 *
 *   node tools/profile.mjs add    [--profile desktop]
 *   node tools/profile.mjs remove [--profile desktop]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'dsh-whale-splash'
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
const want = 'link:' + PLUGIN_DIR

if (action === 'add') {
  if (deps[NAME] === want) {
    console.log('已经登记过了，不用改')
    process.exit(0)
  }
  deps[NAME] = want
} else {
  if (!(NAME in deps)) {
    console.log('本来就没登记，不用改')
    process.exit(0)
  }
  delete deps[NAME]
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const backup = `${file}.before-${NAME}-${action}-${stamp}`
copyFileSync(file, backup)
writeFileSync(file, JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''))
console.log(`${action === 'add' ? '已登记' : '已移除'}：${NAME}（备份在 ${backup}）`)
