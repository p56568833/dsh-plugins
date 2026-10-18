#!/usr/bin/env node
/**
 * dsh-approval-clear 的打包步骤：把 src/core.js 内联进 client.js。
 *
 * 为什么需要这一步：DSH 的客户端插件半边是一个**单文件闭包工厂**，
 * 页面上的 `require` 只认识共享基线（react 等），不认识插件自己的相对路径。
 * 所以纯逻辑不能直接 `require('./core.js')`——那样在页面上会解析失败。
 *
 * 做法：把 core.js 去掉 ESM 语法后原样裹进一个函数，在 client.js 里就地调用。
 * 这样磁盘上仍然只有一份逻辑源码（可离线单测），页面上拿到的也是同一份代码，
 * 不存在"复制一份手改"的漂移。
 *
 * 用法：node tools/build.mjs        （改完 src/core.js 后跑一次）
 *       node tools/build.mjs --check（只检查 client.js 是否已是最新，不写文件）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const CORE = path.join(ROOT, 'src', 'core.js')
const CLIENT = path.join(ROOT, 'client.js')

const START = '    // ══ BEGIN inlined src/core.js（由 tools/build.mjs 生成，不要手改这一段）══'
const END = '    // ══ END inlined src/core.js ══'

/** 去掉 ESM 语法后的 core.js 正文。 */
function coreBody() {
  const source = fs.readFileSync(CORE, 'utf8')
  const lines = []
  for (const line of source.split('\n')) {
    if (/^export\s+(const|function|class)\s/.test(line)) {
      lines.push(line.replace(/^export\s+/, ''))
      continue
    }
    if (/^export\s*\{/.test(line)) continue // 不需要 barrel 导出
    lines.push(line)
  }
  return lines.join('\n')
}

/** 生成要嵌进 client.js 的那一段。 */
function inlined() {
  return [
    START,
    '    /**',
    '     * src/core.js 的内联副本。改逻辑请改 src/core.js 再跑 tools/build.mjs，',
    '     * 不要在这里手改——verify 会比对两边是否一致。',
    '     */',
    '    function loadCore() {',
    ...coreBody().split('\n').map((line) => (line.length > 0 ? `      ${line}` : '')),
    '      return {',
    '        cleanReason, summaryOf, rawCommandOf, argsForCall, resolveReasonText, selectApproval,',
    '      }',
    '    }',
    END,
  ].join('\n')
}

const declaration = "    const core = require('./core.js')"
const call = '    const core = loadCore()'

const current = fs.readFileSync(CLIENT, 'utf8')
const first = current.indexOf(START)
if (first === -1 && !current.includes(declaration)) {
  console.error("✗ client.js 里既没有内联段，也找不到 `const core = require('./core.js')`，无法内联")
  process.exit(1)
}

let next
if (first === -1) {
  next = current.replace(declaration, `${inlined()}\n\n${call}`)
} else {
  const last = current.indexOf(END)
  if (last === -1) {
    console.error('✗ client.js 里有 inlined 起始标记却没有结束标记')
    process.exit(1)
  }
  next = current.slice(0, first) + inlined() + current.slice(last + END.length)
}

if (process.argv.includes('--check')) {
  if (next !== current) {
    console.error('✗ client.js 的内联副本不是最新：请跑 node tools/build.mjs')
    process.exit(1)
  }
  console.log('✓ client.js 的内联副本是最新的')
  process.exit(0)
}

fs.writeFileSync(CLIENT, next)
console.log(`✓ 已把 src/core.js（${String(coreBody().split('\n').length)} 行）内联进 client.js`)
