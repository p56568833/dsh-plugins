#!/usr/bin/env node
/**
 * dsh-claude-style-addons · 三、偏好 / 四、开关 / 五、设置页 —— 离线验证。
 *
 * 合并之后新加的部分都在这里测（问候语、皮肤修补两部分各有自己的 verify）：
 *
 *   1. 声明：package.json 的 dsh.client、cordis.patch.yml 的 insert 行（id 就是设置命名空间）；
 *   2. host 半边：导出 Config / apply；默认值和 client 的是同一份；拿 profile 里那份 schemastery
 *      真造一遍 Config，确认四个字段都标了 volatile（不标，设置页写不进去）；
 *   3. **契约（对着已装的皮肤）**：设置页根容器的 class、行 / 开关 / 分段按钮的 class 和状态属性、
 *      configForms 这条存设置的通道、body 上两个状态属性 —— 皮肤升级改了其中任何一个，这里报红；
 *   4. 偏好：normalizePrefs 把乱七八糟的值收口；
 *   5. 设置表单：目录晚到也能绑上、读到真值、写入逐字段 set()、被拒恢复、服务不在就记本地；
 *   6. 开关：每个选项真的挂上 / 摘下对应功能（替身函数计数）；
 *   7. 设置页（迷你假 DOM）：皮肤设置页出现 → 末尾追加一块；重复跑不重复加；点开关 → 写入并刷新；
 *      问候语关掉 → 字体那一行藏起来；页脚接管关着 / 品牌不是 DeepSeek → 对应行出提示；卸载摘干净。
 *
 * 用法：node verify/settings.mjs [--profile desktop]
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const results = []
async function check(name, body) {
  try {
    const detail = await body()
    results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) })
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const argv = process.argv.slice(2)
const profileIndex = argv.indexOf('--profile')
const PROFILE = profileIndex >= 0 ? (argv[profileIndex + 1] ?? 'desktop') : (process.env.DSH_PROFILE ?? 'desktop')
const PROFILE_DIR = path.join(os.homedir(), '.dsh', 'profiles', PROFILE)
const SKIN_DIR = path.join(PROFILE_DIR, 'node_modules', 'dsh-claude-style')

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'))
const clientSource = fs.readFileSync(path.join(HERE, 'client.js'), 'utf8')

/** 每个场景一份全新的模块实例（模块里有状态：偏好、绑定）。 */
function freshModule(globals = {}) {
  const names = ['window', 'document', 'MutationObserver', 'localStorage', 'console', 'Promise', 'setTimeout', 'clearTimeout']
  const values = names.map((key) => (key in globals ? globals[key] : key === 'window' ? undefined : globalThis[key]))
  let captured = null
  values[0] = { __ModuleLoader__: { load: (definition) => { captured = definition } } }
  // eslint-disable-next-line no-new-func
  new Function(...names, clientSource)(...values)
  return { id: captured.id, mod: captured.factory(() => { throw new Error('本包不应该 require 任何模块') }) }
}

/* ───────────────────────── 1. 声明 ───────────────────────── */

await check('package.json 的 dsh.client 声明完整，exports 指得到两半', () => {
  const decl = manifest.dsh?.client
  assert(decl && typeof decl.platform === 'string' && decl.platform !== '', 'dsh.client.platform 缺失')
  assert(Array.isArray(decl.inject ?? []), 'dsh.client.inject 必须是数组')
  assert(manifest.exports?.['.'] === './index.js' && manifest.exports?.['./client'] === './client.js', 'exports 的 . / ./client 不对')
  assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 缺失（不声明 bundle，profile 名单里的这一行会让启动直接报错）')
  return `platform=${decl.platform}`
})

let T
await check('client.js 可执行；导出两个部分 + 偏好 / 设置页的测试钩子', () => {
  const { id, mod } = freshModule()
  assert(id === manifest.name, `模块 id（${id}）应等于包名`)
  assert(typeof mod.apply === 'function' && Array.isArray(mod.inject) && mod.name === manifest.name, 'apply / inject / name 不对')
  assert(mod.__parts?.greeting?.__testing && mod.__parts?.skinFixes?.__testing, '__parts 少了一个部分')
  T = mod.__testing
  for (const key of ['normalizePrefs', 'savePrefs', 'bindPrefs', 'startFeatures', 'installSettingsInjector', 'PREFS_DEFAULT', 'ENTRY_ID']) {
    assert(T[key] !== undefined, `__testing.${key} 缺失`)
  }
  return `id=${id}`
})

await check('cordis.patch.yml 的 insert 行：name 是本包，id 就是 client 认的设置命名空间', () => {
  const text = fs.readFileSync(path.join(HERE, 'cordis.patch.yml'), 'utf8')
  const id = /-\s*id:\s*'?"?([\w@/.-]+)/.exec(text)?.[1]
  const name = /name:\s*'?"?([\w@/.-]+)/.exec(text)?.[1]
  assert(name === manifest.name, `insert 的 name（${name}）应等于包名`)
  assert(id === T.ENTRY_ID, `insert 的 id（${id}）应等于 client 的 ENTRY_ID（${T.ENTRY_ID}）—— 不一致就绑不上设置`)
  return `id=${id}，name=${name}`
})

/* ───────────────────────── 2. host 半边 ───────────────────────── */

const host = await import(pathToFileURL(path.join(HERE, 'index.js')).href)

await check('host 半边：导出 name / apply / Config 构造；默认值与 client 完全一致', () => {
  assert(host.name === manifest.name, 'host 的 name 应等于包名')
  assert(typeof host.apply === 'function', 'host 没导出 apply')
  assert(typeof host.buildConfig === 'function', 'host 没导出 buildConfig')
  assert(JSON.stringify(host.PREFS_DEFAULT) === JSON.stringify(T.PREFS_DEFAULT),
    `默认值两边不一致：host ${JSON.stringify(host.PREFS_DEFAULT)} / client ${JSON.stringify(T.PREFS_DEFAULT)}`)
  return JSON.stringify(host.PREFS_DEFAULT)
})

await check('host 半边：拿 profile 里的 schemastery 造一遍 Config，四个字段都可在设置页改（volatile）', () => {
  let S = null
  for (const base of [path.join(PROFILE_DIR, 'package.json'), path.join(SKIN_DIR, 'package.json')]) {
    try {
      S = createRequire(base)('@deepseek-ai/schemastery')
      if (S) break
    } catch { /* 下一个 */ }
  }
  if (S === null) return '（这台机器的 profile 里没有 schemastery，跳过 —— 运行时用的是 DSH 自带那份）'
  const config = host.buildConfig(S)
  const json = config.toJSON()
  const root = json.refs[json.uid]
  const keys = Object.keys(root.dict)
  assert(JSON.stringify(keys) === JSON.stringify(Object.keys(T.PREFS_DEFAULT)), `字段不对：${keys.join(', ')}`)
  if (typeof S.boolean().volatile === 'function') {
    const notVolatile = keys.filter((key) => json.refs[root.dict[key]]?.meta?.volatile !== true)
    assert(notVolatile.length === 0, `这些字段没标 volatile，设置页写不进去：${notVolatile.join(', ')}`)
  }
  const resolved = config({})
  for (const key of keys) {
    const value = typeof resolved[key]?.get === 'function' ? resolved[key].get() : resolved[key]
    assert(value === T.PREFS_DEFAULT[key], `${key} 的默认值解析成了 ${JSON.stringify(value)}`)
  }
  return `${keys.length} 个字段，volatile ✓，默认值 ✓`
})

/* ───────────────────────── 3. 契约 ───────────────────────── */

if (!fs.existsSync(path.join(SKIN_DIR, 'lib', 'client.js'))) {
  results.push({ name: '契约检查（皮肤设置页）', ok: true, detail: `没装 dsh-claude-style（${SKIN_DIR}），跳过` })
} else {
  const skin = fs.readFileSync(path.join(SKIN_DIR, 'lib', 'client.js'), 'utf8')
  const skinVersion = JSON.parse(fs.readFileSync(path.join(SKIN_DIR, 'package.json'), 'utf8')).version
  const skinHost = fs.existsSync(path.join(SKIN_DIR, 'host', 'settings.js'))
    ? fs.readFileSync(path.join(SKIN_DIR, 'host', 'settings.js'), 'utf8')
    : ''

  await check(`契约 S1：皮肤设置页的根容器还是 .${T.SETTINGS_ROOT_CLASS}（本插件往它末尾追加）`, () => {
    assert(skin.includes(`'dsh-claude-settings dsh-claude-settings-embedded' : 'dsh-claude-settings'`),
      '皮肤的设置页根容器 class 变了 —— 本插件找不到设置页，块就不会出现')
    assert(skin.includes('"body[data-dsh-claude-style] .dsh-claude-settings {"'), '根容器的样式没了')
    return `dsh-claude-style ${skinVersion}`
  })

  await check('契约 S2：行 / 开关 / 分段按钮的 class 与状态属性都还在（本插件借它们长成一样）', () => {
    const need = {
      'dsh-claude-settings-row': '"body[data-dsh-claude-style] .dsh-claude-settings-row {"',
      'dsh-claude-settings-row-text': '"body[data-dsh-claude-style] .dsh-claude-settings-row-text {"',
      'dsh-claude-settings-row-title': '"body[data-dsh-claude-style] .dsh-claude-settings-row-title {"',
      'dsh-claude-settings-row-desc': '"body[data-dsh-claude-style] .dsh-claude-settings-row-desc {"',
      'dsh-claude-settings-switch': '"body[data-dsh-claude-style] .dsh-claude-settings-switch {"',
      '开关打开（data-on）': '"body[data-dsh-claude-style] .dsh-claude-settings-switch[data-on] {"',
      'dsh-claude-settings-switch-knob': '"body[data-dsh-claude-style] .dsh-claude-settings-switch-knob {"',
      'dsh-claude-segments': '"body[data-dsh-claude-style] .dsh-claude-segments {"',
      'dsh-claude-segment': '"body[data-dsh-claude-style] .dsh-claude-segment {"',
      '选中段（data-active）': '"body[data-dsh-claude-style] .dsh-claude-segment[data-active] {"',
      'dsh-claude-settings-error': '"body[data-dsh-claude-style] .dsh-claude-settings-error {"',
    }
    const missing = Object.entries(need).filter(([, rule]) => !skin.includes(rule)).map(([label]) => label)
    assert(missing.length === 0, `皮肤里找不到这些样式：${missing.join('、')} —— 块会长得和皮肤的行不一样`)
    // 本插件实际用的皮肤 class 必须在皮肤里都有样式
    const used = new Set(clientSource.match(/'dsh-claude-(?:settings|segment)[a-z-]*'/g).map((s) => s.slice(1, -1)))
    const unknown = [...used].filter((cls) => cls !== T.SETTINGS_ROOT_CLASS && !skin.includes(`.${cls} {`) && !skin.includes(`.${cls}[`))
    assert(unknown.length === 0, `本插件用了皮肤里没有样式的 class：${unknown.join(', ')}`)
    return `${Object.keys(need).length} 条样式 ✓；本插件借用 ${used.size} 个皮肤 class`
  })

  await check('契约 S3：存设置的通道 —— 皮肤自己就是走 configForms + configure({ auto: false })', () => {
    for (const fragment of ["ctx?.get('configForms')", 'forms.describe?.()?.getSnapshot?.()?.view?.namespaces', 'served?.ns === candidate', 'prefsForm.set(name, patch[name])', "snapshot?.status !== 'ready'"]) {
      assert(skin.includes(fragment), `皮肤的 client 里没有 ${fragment} 了 —— 宿主的设置表单接口可能变了，本插件照抄的绑定方式要跟着改`)
    }
    if (skinHost) {
      assert(skinHost.includes('settings.configure({ auto: false }, ctx.fiber)'), '皮肤 host 不再用 configure({ auto: false }) —— 宿主的设置声明方式可能变了')
      assert(skinHost.includes('.volatile()'), '皮肤 host 不再标 volatile —— 宿主暴露设置字段的方式可能变了')
    }
    return 'configForms.get / describe / set、configure({auto:false})、volatile 都还是这套'
  })

  await check('契约 S4：body 上的两个状态属性（页脚接管、品牌）名字没变', () => {
    assert(skin.includes("'data-dsh-claude-footer-takeover'"), '页脚接管属性名变了')
    assert(skin.includes("'data-dsh-claude-brand'"), '品牌属性名变了')
    return 'data-dsh-claude-footer-takeover、data-dsh-claude-brand'
  })
}

/* ───────────────────────── 4. 偏好 ───────────────────────── */

await check('偏好：乱值收口（不认识的字体回点阵、只有 false 才算关）', () => {
  const n = T.normalizePrefs
  assert(JSON.stringify(n(undefined)) === JSON.stringify(T.PREFS_DEFAULT), '空值应得到默认值')
  const odd = n({ greeting: 0, greetingFont: 'comic-sans', keepBalanceCard: false, deepseekInlineCode: 'no', junk: 1 })
  assert(odd.greeting === true && odd.greetingFont === 'pixel' && odd.keepBalanceCard === false && odd.deepseekInlineCode === true, JSON.stringify(odd))
  assert(n({ greetingFont: 'hei' }).greetingFont === 'hei', '注册表里有的字体（hei）应保留，哪怕设置页上没列')
  assert(!('junk' in odd), '多余字段不该带进来')
  for (const choice of T.FONT_CHOICES) assert(T.greeting.FONTS[choice.value], `设置页上的字体 ${choice.value} 不在字体注册表里`)
  return `字体选项 ${T.FONT_CHOICES.map((c) => c.label).join(' / ')}`
})

/* ───────────────────────── 5. 设置表单 ───────────────────────── */

/** 假的 configForms：目录可以晚到；表单可以拒绝写入。 */
function fakeForms({ served = true, value = {}, refuse = false } = {}) {
  const mirrorListeners = new Set()
  const formListeners = new Set()
  const state = { served, value: Object.assign({}, value), sets: [], gets: [] }
  const form = {
    getSnapshot: () => ({ status: 'ready', value: state.value }),
    subscribe: (fn) => { formListeners.add(fn); return () => formListeners.delete(fn) },
    set: (key, v) => {
      state.sets.push([key, v])
      if (refuse) return Promise.resolve(false)
      state.value = Object.assign({}, state.value, { [key]: v })
      for (const fn of formListeners) fn()
      return Promise.resolve(true)
    },
  }
  const forms = {
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: state.served ? [{ ns: 'ui-skin-claude-style' }, { ns: 'claude-style-addons' }] : [{ ns: 'ui-skin-claude-style' }] } }),
      subscribe: (fn) => { mirrorListeners.add(fn); return () => mirrorListeners.delete(fn) },
      ensure: () => {},
    }),
    get: (ns) => { state.gets.push(ns); return form },
  }
  return {
    forms, state, form,
    serveNow() { state.served = true; for (const fn of Array.from(mirrorListeners)) fn() },
    hostChanges(patch) { state.value = Object.assign({}, state.value, patch); for (const fn of formListeners) fn() },
    listenerCount: () => mirrorListeners.size + formListeners.size,
  }
}
const ctxWith = (forms) => ({ get: (name) => (name === 'configForms' ? forms : undefined), fiber: { entry: { id: 'include:Xr4nd0m' } } })

await check('设置表单：目录晚到也能绑上；读到的是配置文件里的真值；宿主那边改了界面跟着变', () => {
  const { mod } = freshModule({ localStorage: undefined })
  const t = mod.__testing
  const fake = fakeForms({ served: false, value: { greeting: false, greetingFont: 'kai' } })
  assert(t.bindPrefs(ctxWith(fake.forms)) === false, '目录里还没有本插件的命名空间时不该说绑上了')
  assert(fake.state.gets.length === 0, '目录里没有的命名空间不许去要表单（会拿到没人认领的那个）')
  fake.serveNow()
  assert(t.state().bound, '目录到了应当自动绑上')
  assert(fake.state.gets[0] === 'claude-style-addons', `应当绑 claude-style-addons，实际 ${fake.state.gets[0]}`)
  assert(t.readPrefs().greeting === false && t.readPrefs().greetingFont === 'kai', `没读到真值：${JSON.stringify(t.readPrefs())}`)
  fake.hostChanges({ greeting: true })
  assert(t.readPrefs().greeting === true, '宿主那边的改动没跟上')
  t.unbindPrefs()
  assert(fake.listenerCount() === 0, `解绑后还挂着 ${fake.listenerCount()} 个订阅`)
  return '晚到 → 绑上 → 真值 → 跟随 → 解绑干净'
})

await check('设置表单：写入逐字段 set()；被拒就恢复成真值；服务不在就记在本地', async () => {
  const store = new Map()
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
  // ① 正常写入
  let { mod } = freshModule({ localStorage })
  let t = mod.__testing
  let fake = fakeForms({ value: {} })
  t.bindPrefs(ctxWith(fake.forms))
  t.setBindingCtx(ctxWith(fake.forms))
  const r1 = await t.savePrefs({ greeting: false, greetingFont: 'song' })
  assert(r1 === 'saved', `应当 saved，实际 ${r1}`)
  assert(JSON.stringify(fake.state.sets) === JSON.stringify([['greeting', false], ['greetingFont', 'song']]), `set() 调用不对：${JSON.stringify(fake.state.sets)}`)
  assert(JSON.parse(store.get(t.CACHE_KEY)).greetingFont === 'song', '本地缓存没更新')
  // ② 被拒
  ;({ mod } = freshModule({ localStorage }))
  t = mod.__testing
  fake = fakeForms({ value: { keepBalanceCard: true }, refuse: true })
  t.bindPrefs(ctxWith(fake.forms))
  const r2 = await t.savePrefs({ keepBalanceCard: false })
  assert(r2 === 'refused', `应当 refused，实际 ${r2}`)
  assert(t.readPrefs().keepBalanceCard === true, '被拒后应恢复成宿主的值')
  // 缓存跟着宿主的真值走（②里宿主说的是默认值，所以缓存里不再是 song）
  assert(JSON.parse(store.get(t.CACHE_KEY)).greetingFont === 'pixel', '缓存应跟着宿主的真值')
  // ③ 没有设置服务：只记本地，下次启动从缓存读回来
  ;({ mod } = freshModule({ localStorage }))
  t = mod.__testing
  const r3 = await t.savePrefs({ deepseekInlineCode: false, greetingFont: 'yuan' })
  assert(r3 === 'local', `没有设置服务时应当 local，实际 ${r3}`)
  ;({ mod } = freshModule({ localStorage }))
  const reborn = mod.__testing.readPrefs()
  assert(reborn.deepseekInlineCode === false && reborn.greetingFont === 'yuan', `缓存没把改动带到下一次启动：${JSON.stringify(reborn)}`)
  return 'saved / refused / local 三条路都对'
})

/* ───────────────────────── 6. 开关 ───────────────────────── */

await check('开关：每个选项真的挂上 / 摘下对应功能，两段 CSS 按开关拼', () => {
  const { mod } = freshModule({ localStorage: undefined })
  const t = mod.__testing
  const log = []
  t.greeting.installGreeting = () => { log.push('greeting+'); return () => log.push('greeting-') }
  t.greeting.setFont = (key) => { log.push(`font=${key}`); return true }
  t.skinFixes.installStyles = (parts) => { log.push(`css:${parts.footer ? 'F' : ''}${parts.code ? 'C' : ''}`); return () => log.push('css-') }
  t.skinFixes.installFooterGuard = () => { log.push('guard+'); return () => log.push('guard-') }
  const stop = t.startFeatures()
  assert(log.join(' ') === 'font=pixel greeting+ css:FC guard+', `默认全开：${log.join(' ')}`)
  log.length = 0
  t.adoptPrefs({ greeting: false, greetingFont: 'kai', keepBalanceCard: true, deepseekInlineCode: true })
  assert(log.join(' ') === 'font=kai greeting- css:FC', `关问候语：${log.join(' ')}`)
  log.length = 0
  t.adoptPrefs({ greeting: false, greetingFont: 'kai', keepBalanceCard: false, deepseekInlineCode: true })
  assert(log.join(' ') === 'font=kai css:C guard-', `关余额卡片：${log.join(' ')}`)
  log.length = 0
  t.adoptPrefs({ greeting: false, greetingFont: 'kai', keepBalanceCard: false, deepseekInlineCode: false })
  assert(log.join(' ') === 'font=kai css-', `两段 CSS 都关：${log.join(' ')}`)
  log.length = 0
  t.adoptPrefs({ greeting: true, greetingFont: 'kai', keepBalanceCard: false, deepseekInlineCode: false })
  assert(log.join(' ') === 'font=kai greeting+', `再开问候语：${log.join(' ')}`)
  log.length = 0
  stop()
  assert(log.join(' ') === 'greeting-', `卸载应摘掉还挂着的：${log.join(' ')}`)
  return '挂 / 摘 / 拼 CSS / 卸载都对'
})

await check('开关：真实的两段 CSS —— 只开一段时另一段不出现；字体换了样式当场跟着换', () => {
  const { mod } = freshModule({ localStorage: undefined })
  const s = mod.__testing.skinFixes
  assert(s.cssFor({ footer: true, code: false }) === s.cssFooter, '只开余额卡片时应只有页脚那段')
  assert(s.cssFor({ footer: false, code: true }) === s.cssCode, '只开代码配色时应只有品牌那段')
  assert(s.cssFor() === s.css, '缺省应是两段都要（旧接口）')
  assert(!s.cssFooter.includes('inline-code') && s.cssCode.includes('--dsh-claude-inline-code-bg'), '两段没切干净')
  const g = mod.__testing.greeting
  assert(g.getFont() === 'pixel', '默认字体应是点阵')
  assert(g.setFont('song') === true && g.getFont() === 'song', 'setFont 没生效')
  assert(g.setFont('不存在') === true && g.getFont() === 'pixel', '认不出的字体应回默认')
  assert(g.setFont('pixel') === false, '同一个字体不该算「换了」')
  return '切段 ✓ 换字体 ✓'
})

/* ───────────────────────── 7. 设置页（迷你假 DOM） ───────────────────────── */

function makeDom() {
  const observers = new Set()
  let pending = false
  const notify = () => { pending = true }
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase()
      this.attrs = new Map()
      this.children = []
      this.parentNode = null
      this._text = ''
      this.listeners = new Map()
      const self = this
      const attrName = (key) => 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
      this.dataset = new Proxy({}, {
        set(_, key, value) { self.setAttribute(attrName(key), value); return true },
        get(_, key) { return self.getAttribute(attrName(key)) ?? undefined },
      })
    }
    get className() { return this.getAttribute('class') ?? '' }
    set className(v) { this.setAttribute('class', v) }
    get hidden() { return this.attrs.has('hidden') }
    set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden') }
    get type() { return this.getAttribute('type') }
    set type(v) { this.setAttribute('type', v) }
    setAttribute(k, v) { this.attrs.set(k, String(v)); notify() }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
    hasAttribute(k) { return this.attrs.has(k) }
    removeAttribute(k) { this.attrs.delete(k); notify() }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
    set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this._text = String(v); notify() }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); notify(); return c }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; notify(); return c }
    get lastElementChild() { return this.children[this.children.length - 1] ?? null }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === doc.root }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn) }
    click() { for (const fn of this.listeners.get('click') ?? []) fn({ target: this }) }
    *walk() { for (const c of this.children) { yield c; yield* c.walk() } }
    matches(sel) {
      const m = /^([a-z]*)((?:\[[^\]]+\])*)(?:\.([\w-]+))?((?:\[[^\]]+\])*)$/.exec(sel)
      if (!m) throw new Error('假 DOM 不认这个选择器：' + sel)
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false
      if (m[3] && !this.className.split(/\s+/).includes(m[3])) return false
      for (const [, k, v] of (m[2] + m[4]).matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(k)) return false
        if (v !== undefined && this.getAttribute(k) !== v) return false
      }
      return true
    }
    querySelectorAll(sel) { return [...this.walk()].filter((n) => n.matches(sel)) }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null }
  }
  const doc = {
    root: new Node('html'),
    createElement: (tag) => new Node(tag),
  }
  doc.head = doc.root.appendChild(new Node('head'))
  doc.body = doc.root.appendChild(new Node('body'))
  doc.querySelector = (sel) => doc.root.querySelector(sel)
  doc.querySelectorAll = (sel) => doc.root.querySelectorAll(sel)
  doc.getElementsByClassName = (cls) => ({
    [Symbol.iterator]: function* () { yield* doc.root.querySelectorAll('.' + cls) },
    get length() { return doc.root.querySelectorAll('.' + cls).length },
  })
  class FakeObserver {
    constructor(fn) { this.fn = fn }
    observe(target, options) { this.options = options; observers.add(this) }
    disconnect() { observers.delete(this) }
  }
  /** 跑完所有挂起的「变动 → 回调 → 微任务」，直到安静。 */
  async function settle() {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r))
      if (!pending) return
      pending = false
      for (const o of Array.from(observers)) o.fn([])
    }
    throw new Error('设置页注入器停不下来（自己唤醒自己）')
  }
  return { doc, Node, FakeObserver, observers, settle }
}

/** 皮肤设置页：一个 .dsh-claude-settings 容器，里面放几行皮肤自己的。 */
function mountSkinPage(dom, className = 'dsh-claude-settings', rows = 2) {
  const page = dom.doc.createElement('div')
  page.className = className
  for (let i = 0; i < rows; i++) {
    const row = dom.doc.createElement('div')
    row.className = 'dsh-claude-settings-row'
    page.appendChild(row)
  }
  dom.doc.body.appendChild(page)
  return page
}

await check('设置页：皮肤的设置页出现 → 末尾追加一块（行、开关、分段按钮都用皮肤的 class）；重复跑不重复加', async () => {
  const dom = makeDom()
  dom.doc.body.setAttribute('data-dsh-claude-style', 'x')
  dom.doc.body.setAttribute('data-dsh-claude-brand', 'deepseek')
  dom.doc.body.setAttribute('data-dsh-claude-footer-takeover', '')
  const { mod } = freshModule({ document: dom.doc, MutationObserver: dom.FakeObserver, localStorage: undefined })
  const t = mod.__testing
  const stop = t.installSettingsInjector()
  assert(dom.doc.querySelectorAll(`[${t.BLOCK_ATTR}]`).length === 0, '没打开设置页时不该加任何东西')
  assert(dom.doc.head.children.length === 0, '没打开设置页时不该插样式')
  const page = mountSkinPage(dom)
  await dom.settle()
  const blocks = page.querySelectorAll(`[${t.BLOCK_ATTR}]`)
  assert(blocks.length === 1, `应当追加 1 块，实际 ${blocks.length}`)
  assert(page.children[page.children.length - 1] === blocks[0], '块应在皮肤那些行的后面')
  assert(page.children[0].className === 'dsh-claude-settings-row', '皮肤自己的行不该被动')
  const block = blocks[0]
  assert(block.querySelectorAll('.dsh-claude-settings-row').length === 5, '应当有 5 行（含吉祥物选择）')
  assert(block.querySelectorAll('.dsh-claude-settings-switch').length === 3, '应当有 3 个开关')
  assert(block.querySelectorAll('.dsh-claude-segment').length === t.FONT_CHOICES.length + t.MASCOT_CHOICES.length, '字体 / 吉祥物分段按钮数不对')
  assert(block.querySelectorAll('.dsh-claude-settings-switch[data-on]').length === 3, '默认 3 个开关都该是开的')
  assert(block.querySelector('.dsh-claude-segment[data-active]')?.getAttribute('data-value') === 'pixel', '默认选中点阵')
  assert(dom.doc.head.querySelectorAll(`style[data-plugin-css="${t.SETTINGS_STYLE_ID}"]`).length === 1, '块的样式没插')
  // 再来几轮无关变动：不重复加
  dom.doc.body.appendChild(dom.doc.createElement('div'))
  await dom.settle()
  assert(page.querySelectorAll(`[${t.BLOCK_ATTR}]`).length === 1, '重复跑加了第二块')
  // 皮肤（React）往它自己的列表末尾添一行（比如出错提示）：本块挪回最后，皮肤的行一个不动
  const late = dom.doc.createElement('div')
  late.className = 'dsh-claude-settings-error'
  page.appendChild(late)
  await dom.settle()
  assert(page.children[page.children.length - 1] === blocks[0], '皮肤添了新行后本块应挪回最后')
  assert(page.children[page.children.length - 2] === late, '皮肤新添的那行应留在本块前面')
  // 插件页上嵌入的那一份也加
  const embedded = mountSkinPage(dom, 'dsh-claude-settings dsh-claude-settings-embedded', 1)
  await dom.settle()
  assert(embedded.querySelectorAll(`[${t.BLOCK_ATTR}]`).length === 1, '插件页嵌入的那份设置页没加上')
  // 设置页关掉再打开（React 卸载 / 重新挂载）：新的那页也有
  dom.doc.body.removeChild(page)
  const reopened = mountSkinPage(dom)
  await dom.settle()
  assert(reopened.querySelectorAll(`[${t.BLOCK_ATTR}]`).length === 1, '重新打开的设置页没加上')
  stop()
  assert(dom.doc.querySelectorAll(`[${t.BLOCK_ATTR}]`).length === 0, '卸载后块应摘干净')
  assert(dom.doc.head.children.length === 0, '卸载后样式应摘干净')
  assert(dom.observers.size === 0, '卸载后观察者应断开')
  return '追加 ✓ 不重复 ✓ 始终在最后 ✓ 两处设置页都有 ✓ 重开 ✓ 卸载干净 ✓'
})

await check('设置页：点开关 / 分段 → 写入并刷新；问候语关掉藏字体行；页脚接管关着、品牌不是 DeepSeek 时出提示', async () => {
  const dom = makeDom()
  dom.doc.body.setAttribute('data-dsh-claude-style', 'x')
  dom.doc.body.setAttribute('data-dsh-claude-brand', 'claude')
  const { mod } = freshModule({ document: dom.doc, MutationObserver: dom.FakeObserver, localStorage: undefined })
  const t = mod.__testing
  const fake = fakeForms({ value: {} })
  t.bindPrefs(ctxWith(fake.forms))
  const stop = t.installSettingsInjector()
  const page = mountSkinPage(dom)
  await dom.settle()
  const block = page.querySelector(`[${t.BLOCK_ATTR}]`)
  const note = (name) => block.querySelector(`[data-dsh-csa-note="${name}"]`)
  assert(!note('keepBalanceCard').hidden && note('keepBalanceCard').textContent === t.COPY.balanceIdle, '页脚接管关着时余额那行应出提示')
  assert(!note('deepseekInlineCode').hidden && note('deepseekInlineCode').textContent === t.COPY.codeIdle, '品牌是 Claude 时代码配色那行应出提示')
  assert(note('greeting').hidden, '问候语那行不该有提示')
  // 皮肤那边切到 DeepSeek、打开页脚接管 → 提示消失
  dom.doc.body.setAttribute('data-dsh-claude-brand', 'deepseek')
  dom.doc.body.setAttribute('data-dsh-claude-footer-takeover', '')
  await dom.settle()
  assert(note('keepBalanceCard').hidden && note('deepseekInlineCode').hidden, '状态变了提示没跟着消失')
  // 点「中文问候语」开关 → 关掉
  block.querySelector('[data-dsh-csa-switch="greeting"]').click()
  await dom.settle()
  assert(JSON.stringify(fake.state.sets) === '[["greeting",false]]', `写入不对：${JSON.stringify(fake.state.sets)}`)
  assert(block.querySelector('[data-dsh-csa-switch="greeting"]').getAttribute('aria-checked') === 'false', '开关没变成关')
  assert(block.querySelector('[data-dsh-csa-row="greetingFont"]').hidden, '问候语关掉后字体那一行应藏起来')
  // 再打开，点「楷体」
  block.querySelector('[data-dsh-csa-switch="greeting"]').click()
  await dom.settle()
  block.querySelector('.dsh-claude-segment[data-value="kai"]').click()
  await dom.settle()
  assert(t.readPrefs().greetingFont === 'kai', '字体没写进去')
  assert(block.querySelector('.dsh-claude-segment[data-active]').getAttribute('data-value') === 'kai', '分段按钮没跟着选中楷体')
  assert(!block.querySelector('[data-dsh-csa-row="greetingFont"]').hidden, '问候语打开后字体行应回来')
  // 点已选中的那一段：不写
  const before = fake.state.sets.length
  block.querySelector('.dsh-claude-segment[data-value="kai"]').click()
  await dom.settle()
  assert(fake.state.sets.length === before, '点已选中的段不该再写一次')
  assert(block.querySelector('[data-dsh-csa-error]').hidden, '写成功时不该有报错')
  stop()
  return '开关 ✓ 分段 ✓ 字体行隐藏 ✓ 提示跟随皮肤状态 ✓'
})

await check('设置页：宿主的设置服务不在 → 改动照样生效，块底部说明「只记在本机」', async () => {
  const dom = makeDom()
  dom.doc.body.setAttribute('data-dsh-claude-style', 'x')
  const { mod } = freshModule({ document: dom.doc, MutationObserver: dom.FakeObserver, localStorage: undefined })
  const t = mod.__testing
  const stop = t.installSettingsInjector()
  const page = mountSkinPage(dom)
  await dom.settle()
  const block = page.querySelector(`[${t.BLOCK_ATTR}]`)
  block.querySelector('[data-dsh-csa-switch="deepseekInlineCode"]').click()
  await dom.settle()
  assert(t.readPrefs().deepseekInlineCode === false, '改动没生效')
  const error = block.querySelector('[data-dsh-csa-error]')
  assert(!error.hidden && error.textContent === t.COPY.local, `应当提示只记在本机，实际「${error.textContent}」`)
  stop()
  return '生效 ✓ 提示 ✓'
})

await check('吉祥物设置：默认保留原版；选择鲸鱼娘可保存、重读、切回；未完成动作有说明', async () => {
  const dom = makeDom()
  dom.doc.body.setAttribute('data-dsh-claude-style', 'x')
  dom.doc.body.setAttribute('data-dsh-claude-brand', 'deepseek')
  const { mod } = freshModule({ document: dom.doc, MutationObserver: dom.FakeObserver, localStorage: undefined })
  const t = mod.__testing
  assert(t.normalizePrefs({}).mascotVariant === 'deepy', '旧配置升级必须保留原版')
  assert(t.normalizePrefs({ mascotVariant:'unknown' }).mascotVariant === 'deepy', '未知值应回原版')
  const fake = fakeForms({ value: {} })
  t.bindPrefs(ctxWith(fake.forms))
  const stop = t.installSettingsInjector()
  const page = mountSkinPage(dom)
  await dom.settle()
  const row = page.querySelector('[data-dsh-csa-row="mascotVariant"]')
  const pick = value => row.querySelector(`.dsh-claude-segment[data-value="${value}"]`)
  assert(pick('deepy').getAttribute('aria-pressed') === 'true', '默认选择原版')
  pick('whale-maid').click()
  await dom.settle()
  assert(fake.state.value.mascotVariant === 'whale-maid', '没有保存到宿主表单')
  assert(pick('whale-maid').getAttribute('aria-pressed') === 'true', '选中态没更新')
  assert(row.querySelector('[data-dsh-csa-note="mascotVariant"]').textContent === t.COPY.mascotPending, '未说明其他动作待补')
  const second = freshModule({ localStorage: undefined }).mod.__testing
  second.bindPrefs(ctxWith(fake.forms))
  assert(second.readPrefs().mascotVariant === 'whale-maid', '重读没有恢复选择')
  second.unbindPrefs()
  pick('deepy').click()
  await dom.settle()
  assert(fake.state.value.mascotVariant === 'deepy', '没切回原版')
  stop();t.unbindPrefs()
  return '默认保留 ✓ 保存 ✓ 重读 ✓ 切回 ✓ 待补说明 ✓'
})

/* ───────────────────────── 汇总 ───────────────────────── */

let passed = 0
for (const r of results) {
  if (r.ok) passed += 1
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}`)
  if (r.detail) console.log(`    ${r.detail}`)
}
console.log(`\n${passed}/${results.length} 通过`)
if (passed !== results.length) process.exitCode = 1
