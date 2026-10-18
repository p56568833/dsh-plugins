#!/usr/bin/env node
/**
 * dsh-todo-bar 离线验证（不启动 GUI）：
 *   1. package.json 的 dsh.client 声明、cordis.patch.yml 的 insert 行和包名对得上；
 *   2. 用假的 window.__ModuleLoader__ 接住 client.js 的工厂并执行（同时是语法检查）；
 *   3. apply(ctx) 往 conversation.input.dock 登记一行（和原生 TodoDock 同一个槽，拿得到 useProjection）；
 *   4. summarize() 对各种 todos 投影值算得对。
 * 用法：node verify.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const results = []
const check = (name, body) => {
  try { const d = body(); results.push([true, name, d ?? '']) } catch (e) { results.push([false, name, e.message]) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'))
check('package.json dsh.client', () => {
  const c = pkg.dsh && pkg.dsh.client
  assert(c && typeof c.platform === 'string', 'platform 缺失')
  assert(Array.isArray(c.inject) && typeof c.immediately === 'boolean', 'inject / immediately 形状不对')
  assert(pkg.exports['./client'] === './client.js', 'exports["./client"] 缺失')
})
check('cordis.patch.yml 行名 = 包名', () => {
  const y = fs.readFileSync(path.join(HERE, 'cordis.patch.yml'), 'utf8')
  assert(new RegExp(`name:\\s*${pkg.name}\\b`).test(y), 'insert 行的 name 和包名不一致')
})

let plugin = null
check('client.js 工厂可执行', () => {
  const React = { createElement: (...a) => a, Fragment: 'F', useEffect() {}, useLayoutEffect() {}, useRef: () => ({}), useState: (v) => [v, () => {}] }
  const sandbox = { window: { __ModuleLoader__: { load: ({ id, factory }) => { assert(id === pkg.name, `模块 id ${id}`); plugin = factory((n) => ({ react: React, 'react-dom': {} })[n]) } } }, document: undefined, localStorage: undefined }
  sandbox.window.window = sandbox.window
  vm.runInNewContext(fs.readFileSync(path.join(HERE, 'client.js'), 'utf8'), { ...sandbox.window, console })
  assert(plugin && typeof plugin.apply === 'function', '没有 apply')
})

check('apply 登记 conversation.input.dock', () => {
  const regs = []
  const ctx = { slots: { inject: (name, fn) => { regs.push(['inject', name]); fn() }, register: (opts, comp) => regs.push(['register', opts, comp]) } }
  plugin.apply(ctx)
  const r = regs.find((x) => x[0] === 'register')
  assert(r && r[1].name === 'conversation.input.dock' && r[1].id === 'dsh-todo-bar', JSON.stringify(regs))
  assert(typeof r[2] === 'function', '组件不是函数')
  assert(JSON.stringify(plugin.inject) === '["slots"]', 'inject 应为 ["slots"]')
  return `order ${r[1].order}`
})

const { summarize, countsLabel } = plugin ? plugin.__internals : {}
const T = (status, content) => ({ status, content })
check('summarize：空 / null / 坏数据', () => {
  for (const v of [null, undefined, [], [{}], [{ content: 'x', status: 'weird' }]]) assert(summarize(v).total === 0, JSON.stringify(v))
})
check('summarize：进行中优先', () => {
  const s = summarize([T('completed', 'a'), T('in_progress', 'b'), T('pending', 'c')])
  assert(s.total === 3 && s.done === 1 && s.current.content === 'b' && s.currentIsActive && !s.allDone, JSON.stringify(s))
  assert(countsLabel(s) === '已完成 1 · 进行中 1 · 待办 1', countsLabel(s))
})
check('summarize：没有进行中 → 下一项待办', () => {
  const s = summarize([T('completed', 'a'), T('pending', 'c')])
  assert(s.current.content === 'c' && !s.currentIsActive, JSON.stringify(s))
})
check('summarize：全部完成 + 签名随内容变化', () => {
  const a = summarize([T('completed', 'a'), T('completed', 'b')])
  const b = summarize([T('completed', 'a'), T('completed', 'c')])
  assert(a.allDone && a.sig !== b.sig, 'sig')
  assert(countsLabel(a) === '已完成 2', countsLabel(a))
})
check('summarize：多项并行', () => {
  const s = summarize([T('in_progress', 'a'), T('in_progress', 'b')])
  assert(s.activeCount === 2 && s.current.content === 'a', JSON.stringify(s))
})

let fail = 0
for (const [ok, name, d] of results) { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${name}${d ? ` — ${d}` : ''}`) }
console.log(fail ? `结论：失败 ${fail}/${results.length}` : `结论：通过 ${results.length}/${results.length}`)
process.exit(fail ? 1 : 0)
