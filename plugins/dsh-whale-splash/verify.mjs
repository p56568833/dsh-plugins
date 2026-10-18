/**
 * 自检 + 生成本地预览：node verify.mjs
 *
 * 1. 注入行的顺序与类型、宿主半边在 webserver/index-inject 里交行
 * 2. 两段脚本语法能过；早脚本「打开就播、刷新跳过」
 * 3. 预览里摆的是 dsh-claude-style 现在真在用的那只吉祥物（Clawd 螃蟹，真帧图），
 *    开屏会把它放大画成大号、最后落回原位交班 —— 双击 preview/index.html 就能看完整过场。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Script } from 'node:vm'
import plugin, { asset, render, rows } from './index.js'

let failed = 0
const ok = (cond, label) => {
  console.log((cond ? '✓ ' : '✗ ') + label)
  if (!cond) failed++
}

const css = asset('splash.css')
const js = asset('splash.js')
const table = rows(css, js, asset('logo.svg'))
const host = '<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title></head><body><div id="root"></div></body></html>'

ok(table.map((r) => r.kind + ':' + (r.placement || '')).join(',') === 'style:,script:head,html:body,script:body', '注入行顺序：样式 → 早脚本 → 节点 → 编排脚本')
ok(table.every((r) => ['style', 'script', 'html'].includes(r.kind)), '只用宿主认识的行类型（style / script / html）')
ok(table[3].text.indexOf("'%LOGO_PATH%'") === -1 && /var LOGO_PATH = "M[\d.]/.test(table[3].text), '鲸鱼标的 path 已经填进脚本')
ok(css.indexOf('/* dsh-whale-splash') === 0, '样式以标记注释开头（收尾时靠它找到并移除）')
for (const name of ['dwsp-veil', 'dwsp-cv']) ok(css.indexOf('.' + name) !== -1 && table[2].html.indexOf('class="' + name + '"') !== -1, `.${name} 节点和样式都在`)
ok(css.indexOf('.dsh-claude-crab') !== -1, '开场期间会藏起螃蟹吉祥物（Clawd）')
ok(js.indexOf('.dsh-claude-crab[data-ready]') !== -1, '编排脚本会找页面上的螃蟹吉祥物')
ok(js.indexOf("'--dsh-claude-crab-'") !== -1 && js.indexOf('--dsh-claude-mascot-h') !== -1, '编排脚本从它的 CSS 变量里读帧图和格子')
for (const [label, code] of [['编排脚本', table[3].text], ['早脚本', table[1].text]]) {
  try { new Script(code); ok(true, label + ' 语法通过') } catch (e) { ok(false, label + ' 语法错误：' + e.message) }
}

// 宿主半边：在 webserver/index-inject 事件里交行，不依赖 webServer 服务
let listener = null
plugin.apply({ on: (event, fn) => { if (event === 'webserver/index-inject') listener = fn }, logger: () => ({ info() {} }) })
const collected = []
if (listener) listener(collected)
ok(collected.length === 4, '宿主收集注入行时交上 4 行')
ok(!('inject' in plugin), '不声明依赖服务（桌面版也能挂上）')

// 早脚本：刷新跳过、打开开演
const fakeRun = (type) => {
  const classes = new Set()
  const sandbox = { window: {}, document: { documentElement: { classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove() {} } }, getElementById: () => null }, performance: { getEntriesByType: () => [{ type }] }, setTimeout() {} }
  new Script(table[1].text).runInNewContext(sandbox)
  return classes.has('dwsp-boot')
}
ok(fakeRun('navigate') === true, '打开（navigate）时开演')
ok(fakeRun('reload') === false, '刷新（reload）时跳过')

/* ── 预览页：用 dsh-claude-style 真在用的 Clawd 帧图 ───────── */

function findCrabSheet() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dirs = [process.env.SKIN_DIR, ...['desktop', 'web'].map((p) => join(home, 'profiles', p, 'node_modules', 'dsh-claude-style'))].filter(Boolean)
  for (const dir of dirs) {
    const file = join(dir, 'lib', 'client.js')
    if (!existsSync(file)) continue
    const src = readFileSync(file, 'utf8')
    // 螃蟹帧表是 data URI，直接搬进预览页就能画
    const m = src.match(/W3=\{idle:\{body:"(data:image\/png;base64,[^"]+)",ink:"(data:image\/png;base64,[^"]+)"/)
    if (m) return { sheet: m[1], ink: m[2] }
  }
  return null
}

const crab = findCrabSheet()
const crabVars = crab
  ? '--dsh-claude-crab-x:24;--dsh-claude-crab-y:20;--dsh-claude-crab-w:24;--dsh-claude-mascot-h:16;--dsh-claude-crab-cell-w:24;--dsh-claude-crab-strip-h:48;'
    + '--dsh-claude-crab-sheet:url(&quot;' + crab.sheet + '&quot;);--dsh-claude-crab-ink:url(&quot;' + crab.ink + '&quot;)'
  : ''

const MOCK = `
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 -apple-system, "PingFang SC", sans-serif; background: #f4f4f2; color: #1f2329; height: 100vh; --dsw-alias-label-tertiary: #8f8a7e; }
  .app { display: flex; height: 100vh; }
  .side { width: 260px; background: #ececea; padding: 22px 18px; }
  .side b { color: #4d6bfe; font-size: 22px; letter-spacing: .5px; }
  .side p { margin: 14px 0; color: #444; }
  .main { flex: 1; display: flex; flex-direction: column; padding: 28px 40px; }
  .chat { flex: 1; color: #555; }
  .stack { position: relative; width: min(720px, 100%); margin: 0 auto; }
  textarea { width: 100%; height: 64px; border: 1px solid #ddd; border-radius: 14px; padding: 16px; font: inherit; resize: none; background: #fff; }
  /* 跟 dsh-claude-style 的螃蟹样式同一套（预览只需要外框和帧表） */
  .dsh-claude-crab { position: absolute; right: 16px; bottom: 100%; z-index: 1; width: 104px; height: 72px; pointer-events: none; visibility: hidden; }
  .dsh-claude-crab[data-ready] { visibility: visible; }
  .dsh-claude-crab-sprite { position: absolute; left: calc(var(--dsh-claude-crab-x, 0) * 2px); top: calc(var(--dsh-claude-crab-y, 0) * 2px); width: calc(var(--dsh-claude-crab-w, 0) * 2px); height: calc(var(--dsh-claude-mascot-h, 0) * 2px); overflow: hidden; }
  .dsh-claude-crab-strip { position: relative; display: block; width: calc(var(--dsh-claude-crab-cell-w, 0) * 16px); height: calc(var(--dsh-claude-crab-strip-h, 0) * 2px); background-image: var(--dsh-claude-crab-sheet, none); background-repeat: no-repeat; background-size: 100% 100%; image-rendering: pixelated; }
  .loading { position: fixed; inset: 0; display: grid; place-items: center; letter-spacing: 4px; color: #888; }
  #replay { position: fixed; left: 16px; bottom: 16px; z-index: 1; border: 1px solid #ccd; background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
</style>
<script>
  document.body.setAttribute('data-dsh-claude-style', '')
  const CRAB_STYLE = ${JSON.stringify(crabVars)}
  const root = document.getElementById('root')
  setTimeout(() => { root.innerHTML = '<div class="loading">HARNESS · Loading plugins…</div>' }, 300)
  setTimeout(() => {
    root.innerHTML = '<div class="app"><div class="side"><b>deepseek</b><p>＋ 新会话</p><p>插件</p><p>插件市场</p><p>记忆</p></div>'
      + '<div class="main"><div class="chat"><p>这里是模拟的 DSH 主界面（预览用）。</p><p>输入框上沿那只小螃蟹，就是 dsh-claude-style 现在真在用的 Clawd（这里用它的真帧图摆着）。</p></div>'
      + '<div class="stack"><div class="dsh-claude-crab" style="' + CRAB_STYLE + '">'
      + '<span class="dsh-claude-crab-sprite"><span class="dsh-claude-crab-strip"></span></span></div>'
      + '<textarea placeholder="Type / for commands"></textarea></div></div></div>'
    setTimeout(() => document.querySelector('.dsh-claude-crab').setAttribute('data-ready', ''), 250)
  }, 1300)
</script>
<button id="replay" onclick="location.href = location.pathname + '?r=' + Date.now()">重播</button>`

const page = render(host, table).replace('</body>', MOCK + '</body>')
writeFileSync(new URL('./preview/index.html', import.meta.url), page)
ok(true, '预览已生成：preview/index.html（双击打开，每次都会重播）')
if (!crab) console.log('… 本机没找到 dsh-claude-style 的螃蟹帧图，预览里只会跑「没有吉祥物」的兜底版本（设 SKIN_DIR 指向它的包目录也行）')

if (failed) {
  console.log(`\n${failed} 项没通过`)
  process.exit(1)
}
console.log('\n全部通过')
