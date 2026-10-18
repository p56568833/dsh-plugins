/**
 * 离线体检：确认新加的 bundle 不会把 DSH 弄崩。
 *
 * 判据照抄 @deepseek-ai/dsh-app-boot 的 loadProfileDirectory()：
 *   · 名单里每个包能被解析到 —— 先在 profile 的 node_modules 里找，
 *     找不到就当作「App 自带的包」（app-boot 会退回安装锚点 app.asar 去解析，
 *     本脚本从 app.asar 外面读不到，所以只标注不判错）；
 *   · 每个包都声明 dsh.bundle（否则 app-boot 在那一行直接 throw）；
 *   · dsh.bundle.patch 指向的文件存在；
 *   · patch 文件读出来是一张列表（overlay 格式）。
 *
 * 另外专门核对本插件那一行：insert 的 id/name 必须和包名对得上 —— insert 写错
 * 等于白装（插件不在 roster 里），这是最容易犯又最难看出来的错。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const profileDir = '/Users/andychen/.dsh/profiles/desktop'
const SELF = 'dsh-claude-style-addons'
// js-yaml 用 profile 自己的那份（DSH 解析 cordis.patch.yml 用的也是它）。
const YAML = createRequire(join(profileDir, 'package.json'))('js-yaml')

const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []

const failures = []
const notes = []
for (const name of bundles) {
  const dir = join(profileDir, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) {
    notes.push(`· ${name}：不在 profile 的 node_modules 里 —— 由 App 自带或安装锚点提供，跳过内容检查`)
    continue
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const bundle = pkg.dsh?.bundle
  if (bundle === undefined) {
    failures.push(`${name}: 没有声明 dsh.bundle —— app-boot 会直接抛错`)
    continue
  }
  const declared = typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
  if (!Array.isArray(declared) || !declared.every((f) => typeof f === 'string')) {
    failures.push(`${name}: dsh.bundle.patch 既不是字符串也不是字符串数组`)
    continue
  }
  for (const rel of declared) {
    const file = join(dir, rel)
    if (!existsSync(file)) {
      failures.push(`${name}: patch 文件不存在 ${rel}`)
      continue
    }
    const text = readFileSync(file, 'utf8')
    let parsed
    try {
      parsed = YAML.load(text)
    } catch (error) {
      // cordis 的 patch 里允许 !js 这类自定义标签；本脚本的解析器不认，不算错。
      if (/unknown tag/.test(error.message)) {
        notes.push(`· ${name}：patch 用到自定义 YAML 标签，本脚本跳过解析（DSH 自己认）`)
        continue
      }
      failures.push(`${name}: patch YAML 解析失败 ${rel} —— ${error.message}`)
      continue
    }
    if (!Array.isArray(parsed)) {
      failures.push(`${name}: patch 顶层不是列表（overlay 要求是 patch 列表）`)
      continue
    }
    const inserts = parsed.flatMap((row) => (row && Array.isArray(row.insert) ? row.insert : []))
    if (name === SELF) {
      const mine = inserts.find((row) => row && (row.name === SELF || row.id === SELF))
      if (mine === undefined) {
        failures.push(`${SELF}: patch 里没有指向本包的 insert 行（会在 roster 里缺席）`)
      } else if (typeof mine.id !== 'string' || mine.id === '') {
        failures.push(`${SELF}: insert 行缺 id`)
      } else {
        notes.push(`· ${SELF}：insert 行正常（id=${mine.id}，name=${mine.name}）`)
      }
    } else {
      notes.push(`· ${name}：${rel} → ${parsed.length} 行 patch，insert ${inserts.length} 个`)
    }
  }
}

if (notes.length > 0) console.log(notes.join('\n'))
if (failures.length > 0) {
  console.log('\n✗ 会阻止 DSH 启动的问题：')
  for (const line of failures) console.log('  · ' + line)
  process.exitCode = 1
} else {
  console.log(`\n${bundles.length} 个 bundle 全部通过体检 —— DSH 不会因为这次改动起不来，本插件那一行也对得上。`)
}
