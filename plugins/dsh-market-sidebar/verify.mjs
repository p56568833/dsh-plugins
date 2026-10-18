#!/usr/bin/env node
/**
 * dsh-market-sidebar 离线验证。
 *
 * 不启动 GUI，按 DSH 真会做的那样跑：
 *
 *   1. package.json 的 `dsh.client` 声明按 DSH 自己的校验规则核一遍
 *      （platform 必填字符串、inject/external 必须是字符串数组、immediately 必须是
 *       布尔、exports["./client"] 必须存在）——规则抄自随包的
 *       @deepseek-ai/dsh-client-modules/lib/index.js 里的 parseDshClient；
 *   2. cordis.patch.yml 的 insert 行和 package.json 的 name 对得上；
 *   3. 用假的 window.__ModuleLoader__ 接住 client.js 的工厂并真的执行
 *      factory(require)（同时等于语法检查）；
 *   4. 用 app.asar 里随包的**真** @deepseek-ai/dsh-client-ui-slots 的 SlotCore
 *      当槽位表，按 DSH 的顺序先声明 root / sidebar / sidebar.panellist / main，
 *      并先登记「插件」那一行，再跑本插件的 apply(ctx)；
 *   5. 检查登记的形状（id / order / label 跟随语言 / main 的 key），以及图标和
 *      面板能不能构造出 React 元素、面板里是不是市场自己 render() 出来的那块。
 *
 * 另有反向路径：dshmarket 的 market 服务不在时，必须**一行都不登记**。
 *
 * 用法：node verify.mjs
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const SLOTS_IN_ASAR = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js'

const results = []
/**
 * @param {string} name - 检查项。
 * @param {() => unknown} body - 断言体。
 */
function check(name, body) {
  try {
    const detail = body()
    results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) })
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * @param {unknown} condition - 条件。
 * @param {string} message - 失败信息。
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/* ── 从 app.asar 取随包的 SlotCore ─────────────────────────────────────── */

/**
 * @param {string} asarPath - app.asar。
 * @param {string} internalPath - 包内路径。
 * @returns {string} 文本。
 */
function readFromAsar(asarPath, internalPath) {
  const fd = fs.openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const jsonLength = head.readUInt32LE(12)
    const headerBuf = Buffer.alloc(jsonLength)
    fs.readSync(fd, headerBuf, 0, jsonLength, 16)
    const header = JSON.parse(headerBuf.toString('utf8'))
    // 数据区从 8 + pickleSize 开始（不是 16 + jsonLength —— 差几个字节就是别人的尾巴）。
    const dataBase = 8 + head.readUInt32LE(4)
    let node = header
    for (const part of internalPath.split('/')) {
      node = node?.files?.[part]
      if (!node) throw new Error(`asar 里找不到 ${internalPath}`)
    }
    const body = Buffer.alloc(node.size)
    fs.readSync(fd, body, 0, node.size, dataBase + Number(node.offset))
    return body.toString('utf8').replace(/^\uFEFF/, '')
  } finally {
    fs.closeSync(fd)
  }
}

/* ── 替身 ──────────────────────────────────────────────────────────────── */

/** 元素替身。 */
function element(type, props, ...children) {
  const kids = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
  return { __el: true, type, props: { ...(props ?? {}), ...(kids === undefined ? {} : { children: kids }) } }
}

class StubComponent {
  constructor(props) { this.props = props ?? {} }
  render() { return null }
}

const reactStub = {
  Component: StubComponent,
  PureComponent: StubComponent,
  createElement: element,
  createRef: () => ({ current: null }),
  Fragment: Symbol.for('react.fragment'),
  useId: () => 'stub',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useReducer: (_r, init) => [init, () => {}],
  useSyncExternalStore: (_s, getSnapshot) => getSnapshot(),
}

/** 假的 market 服务，形状照抄 dshmarket 暴露的那一份。 */
function makeMarketStub() {
  const calls = []
  const visibility = []
  let visible = true
  return {
    calls,
    visibility,
    service: {
      version: 1,
      setSettingsVisible: (next) => { visibility.push(next); visible = next },
      settingsVisible: () => visible,
      render: (props = {}) => {
        calls.push(props)
        return element('MarketPanelStub', { props })
      },
    },
  }
}

/**
 * 造一个够真的 ctx：slots 挂真 SlotCore，locale 记账，get('market') 给市场替身。
 * @param {any} core - SlotCore 实例。
 * @param {any} market - 市场服务替身（undefined 模拟 dshmarket 不在）。
 * @returns {any} ctx 及记账。
 */
function makeContext(core, market) {
  const dictionaries = {}
  const bound = []
  const registered = []
  const disposers = []
  /** 嵌套 inject 的记账：哪些服务请求过、是否真的回调了。 */
  const nested = []
  return {
    registered,
    disposers,
    nested,
    ctx: {
      effect: (callback, label) => {
        const off = callback()
        const dispose = typeof off === 'function' ? off : () => {}
        disposers.push({ label, dispose })
        return dispose
      },
      on: () => () => {},
      get: (name) => (name === 'market' ? market : undefined),
      /**
       * 嵌套 ctx.inject：真 cordis 里「所有服务都可用才回调」，否则这个块就一直
       * 不跑（但插件本身仍然是 active）。这里照这个语义实现，并且把「没回调」
       * 记下来 —— 那正是「不会变成 pending 条目」的证据。
       */
      inject: (services, callback) => {
        const missing = services.filter((name) => (name === 'market' ? market === undefined : false))
        nested.push({ services, ran: missing.length === 0, missing })
        if (missing.length > 0) return () => {}
        const scoped = {
          get: (name) => (name === 'market' ? market : undefined),
          effect: (fn, label) => {
            const off = fn()
            const dispose = typeof off === 'function' ? off : () => {}
            disposers.push({ label, dispose })
            return dispose
          },
        }
        const off = callback(scoped)
        return typeof off === 'function' ? off : () => {}
      },
      locale: {
        register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} },
        bind: (ns) => {
          let active = 'zh'
          const t = (key) => dictionaries[ns]?.[active]?.[key] ?? dictionaries[ns]?.zh?.[key] ?? key
          t.setActive = (next) => { active = next }
          bound.push(t)
          return t
        },
        subscribe: () => () => {},
        getSnapshot: () => ({ active: 'zh', revision: 1 }),
      },
      slots: {
        inject: (name, callback) => { const off = callback(); return typeof off === 'function' ? off : () => {} },
        register: (options, component) => { registered.push({ options, component }); return core.register(options, component) },
        entries: (key) => core.entries(key),
        subscribe: (key, fn) => core.subscribe(key, fn),
      },
    },
    dictionaries,
    bound,
  }
}

/**
 * 按 DSH 的顺序把槽位声明好，并先登记「插件」那一行。
 * @param {any} SlotCoreClass - 真 SlotCore。
 * @returns {any} core。
 */
function seedHost(SlotCoreClass) {
  const core = new SlotCoreClass()
  core.record('root').spec = { kind: 'single', scope: 'root' }
  core.register({ name: 'root', locale: 'common', children: {
    main: { kind: 'keyed', scope: 'root' },
    sidebar: { kind: 'single', scope: 'root' },
  } }, () => null)
  core.register({ name: 'sidebar', locale: 'sidebar', children: {
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } }, () => null)
  core.register({ name: 'sidebar.panellist', id: 'plugins', order: 0, label: () => '插件' }, () => null)
  return core
}

/* ── 主流程 ────────────────────────────────────────────────────────────── */

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'))
const clientSource = fs.readFileSync(path.join(HERE, 'client.js'), 'utf8')
const patchYml = fs.readFileSync(path.join(HERE, 'cordis.patch.yml'), 'utf8')

check('package.json 的 dsh.client 声明符合 DSH 自己的校验规则', () => {
  const decl = manifest.dsh?.client
  assert(decl && typeof decl === 'object', '缺少 dsh.client')
  assert(typeof decl.platform === 'string', 'dsh.client.platform 必须是字符串')
  for (const field of ['inject', 'external']) {
    if (decl[field] !== undefined) {
      assert(Array.isArray(decl[field]) && decl[field].every((item) => typeof item === 'string'), `dsh.client.${field} 必须是字符串数组`)
    }
  }
  if (decl.immediately !== undefined) assert(typeof decl.immediately === 'boolean', 'dsh.client.immediately 必须是布尔')
  const entry = manifest.exports?.['./client']
  const target = typeof entry === 'string' ? entry : entry?.default
  assert(typeof target === 'string', 'exports["./client"] 必须是字符串或 { default: string }')
  assert(fs.existsSync(path.join(HERE, target)), `exports["./client"] 指向的文件不存在：${target}`)
  assert(decl.platform === 'web', 'platform 必须是 web')
  assert(decl.immediately === true, 'immediately 需要为 true（这一行要在 boot 阶段就登记，不能等首次点击）')
  assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch 必须指向 cordis.patch.yml')
  return `platform=${decl.platform}，inject=${JSON.stringify(decl.inject)}，immediately=${decl.immediately}，client=${target}`
})

check('cordis.patch.yml 的 insert 行指向本包', () => {
  assert(/^-\s*insert:/m.test(patchYml), '顶层不是 insert 数组')
  const row = patchYml.match(/-\s*id:\s*([\w-]+)\s*\n\s*name:\s*([\w@/.-]+)/)
  assert(row, '没解析出 id/name')
  assert(row[2] === manifest.name, `insert 的 name（${row[2]}）与 package.json 的 name（${manifest.name}）不一致`)
  return `id=${row[1]}，name=${row[2]}`
})

let mod = null
check('client.js 可编译，并且工厂导出了 cordis 插件', () => {
  let captured = null
  const fakeWindow = { __ModuleLoader__: { load: (definition) => { captured = definition } } }
  new Function('window', clientSource)(fakeWindow)
  assert(captured, '没有调用 window.__ModuleLoader__.load')
  assert(captured.id === manifest.name, `模块 id（${captured.id}）应等于包名`)
  mod = captured.factory((id) => {
    if (id === 'react') return reactStub
    throw new Error(`client.js 请求了意料之外的模块：${id}（本包不应该依赖 react 之外的任何模块）`)
  })
  assert(typeof mod.apply === 'function', 'exports.apply 不是函数')
  assert(mod.name === manifest.name, 'exports.name 应等于包名')
  // 关键：顶层 inject 里**不能**有 market。DSH 的启动审计要求每个 entry 最终都是
  // active，顶层必需依赖一旦等不到服务，整个界面启动就会失败（桌面端判 fatal）。
  assert(Array.isArray(mod.inject), 'exports.inject 必须是数组')
  assert(!mod.inject.includes('market'), "顶层 inject 里不能有 'market'（会让插件 pending 从而让界面启动失败）")
  for (const service of ['slots', 'locale']) assert(mod.inject.includes(service), `顶层 inject 里应有 ${service}`)
  return `id=${captured.id}，inject=[${mod.inject.join(', ')}]（market 走嵌套 inject）`
})

/**
 * 优先读 app.asar 里随包的 SlotCore；asar 读不到（比如不在这台 Mac 上跑）时，
 * 退回到工作区 _asar/slots-index.js 那份抽出来的副本（开头多出的两个字节要切掉）。
 * @returns {string} SlotCore 模块源码。
 */
function loadSlotsSource() {
  try {
    return readFromAsar(ASAR, SLOTS_IN_ASAR)
  } catch (error) {
    const copy = path.join(HERE, '..', '_asar', 'slots-index.js')
    if (!fs.existsSync(copy)) throw error
    const text = fs.readFileSync(copy, 'utf8')
    return text.slice(text.indexOf('\n') + 1)
  }
}
const slotsSource = loadSlotsSource()
const slotsFile = path.join(os.tmpdir(), `dsh-slots-market-sidebar-${process.pid}.mjs`)
fs.writeFileSync(slotsFile, slotsSource)
const { SlotCore } = await import(pathToFileURL(slotsFile).href)

check('市场服务在时：登记出「插件」下面的一行 + 对应的 main 面板', () => {
  const core = seedHost(SlotCore)
  const stub = makeMarketStub()
  const { ctx, dictionaries, bound, nested } = makeContext(core, stub.service)
  mod.apply(ctx)

  assert(nested.length === 1 && nested[0].ran, '嵌套 inject([market]) 应该跑起来了')
  const rows = core.entries('sidebar.panellist')
  const ids = rows.map((entry) => entry.options.id)
  assert(ids[0] === 'plugins' && ids[1] === 'market', `应紧跟「插件」：实际 [${ids.join(', ')}]`)
  const row = rows.find((entry) => entry.options.id === 'market')
  assert(row.options.order === 1, `order 应为 1，实际 ${row.options.order}`)
  assert(row.locale === 'market-sidebar', `locale 应为 market-sidebar，实际 ${row.locale}`)
  assert(row.options.label() === '插件市场', `zh 标签应为「插件市场」，实际「${row.options.label()}」`)
  const mains = core.entries('main').map((entry) => entry.options.key)
  assert(mains.includes('market'), `main 槽缺少 key=market：[${mains.join(', ')}]`)
  assert(dictionaries['market-sidebar'], '字典没注册')

  for (const t of bound) t.setActive('en')
  assert(row.options.label() === 'Plugin Market', `en 标签应为「Plugin Market」，实际「${row.options.label()}」`)
  for (const t of bound) t.setActive('zh')
  return `sidebar.panellist=[${ids.join(', ')}]，main keys=[${mains.join(', ')}]，label=「插件市场」/「Plugin Market」`
})

check('图标与面板能构造 React 元素，面板里是 market.render() 给的那块', () => {
  const core = seedHost(SlotCore)
  const stub = makeMarketStub()
  const { ctx } = makeContext(core, stub.service)
  mod.apply(ctx)

  const row = core.entries('sidebar.panellist').find((entry) => entry.options.id === 'market')
  const icon = row.component({ size: 18, active: true })
  assert(icon?.__el === true, '图标没返回元素')
  assert(icon.type === 'svg', `图标根节点应是 svg，实际 ${String(icon.type)}`)
  assert(icon.props.width === 18 && icon.props.height === 18, '图标应跟随槽位给的 size')
  const kids = icon.props.children ?? []
  const group = kids.find((child) => child?.type === 'g')
  const plug = kids.find((child) => child?.type === 'rect')
  assert(group && (group.props.children ?? []).length === 8, `品牌标记应有 8 格的 <g>，实际 ${(group?.props?.children ?? []).length}`)
  assert(group.props.fill === 'currentColor' && plug?.props?.fill === 'currentColor', '标记应该用 currentColor 跟随主题')
  assert(/^rotate\(/.test(String(plug?.props?.transform)), '斜插的那一块应带旋转')

  const main = core.entries('main').find((entry) => entry.options.key === 'market')
  const panel = main.component({})
  assert(panel?.__el === true, '面板没返回元素')
  assert(panel.props.children?.__el === true, '面板里没有包住市场元素')
  assert(panel.props.children.type === 'MarketPanelStub', '面板里的元素不是 market.render() 的产物')
  assert(stub.calls.length === 1, `market.render() 应被调用一次，实际 ${stub.calls.length} 次`)
  return 'icon=svg(9 rect, currentColor)，panel=…›MarketPanelStub'
})

check('设置里那份「插件市场」被请走，本插件关掉时又放回去', () => {
  const core = seedHost(SlotCore)
  const stub = makeMarketStub()
  const { ctx, disposers } = makeContext(core, stub.service)
  mod.apply(ctx)

  assert(stub.visibility.length === 1, `apply 时应调用一次 setSettingsVisible，实际 ${stub.visibility.length} 次`)
  assert(stub.visibility[0] === false, `应传 false（设置里不再出现），实际 ${String(stub.visibility[0])}`)
  assert(stub.service.settingsVisible() === false, '市场的设置入口应处于隐藏态')

  const own = disposers.find((entry) => String(entry.label).includes('市场只在侧边栏'))
  assert(own, '没找到负责可见性的 ctx.effect')
  for (const { dispose } of disposers) dispose()
  assert(stub.visibility.at(-1) === true, `本插件卸载后应把它放回设置里，实际最后一次是 ${String(stub.visibility.at(-1))}`)
  assert(stub.service.settingsVisible() === true, '卸载后市场的设置入口应恢复')
  return 'apply → setSettingsVisible(false)；卸载 → setSettingsVisible(true)'
})

check('反向 A：市场服务不在时，插件照样 active、不登记市场那一行（绝不会把界面启动搞崩）', () => {
  const core = seedHost(SlotCore)
  const { ctx, nested } = makeContext(core, undefined)
  let threw = null
  try {
    mod.apply(ctx)
  } catch (error) {
    threw = error
  }
  assert(threw === null, `apply 不该抛错（抛了就会变成启动失败）：${threw?.message ?? ''}`)
  assert(nested.length === 1 && nested[0].ran === false, '嵌套 inject([market]) 应该只是没跑，而不是让插件 pending')
  assert(nested[0].missing.join(',') === 'market', `应该正记着缺 market，实际缺 [${nested[0].missing.join(', ')}]`)
  const ids = core.entries('sidebar.panellist').map((entry) => entry.options.id)
  assert(ids.join(',') === 'plugins,account-subscriptions', `市场不在时只该有「订阅」这一行，实际 [${ids.join(', ')}]`)
  const mains = core.entries('main').map((entry) => entry.options.key)
  assert(mains.join(',') === 'account-subscriptions', `市场不在时不该登记市场面板，实际 [${mains.join(', ')}]`)
  return 'apply 正常返回；嵌套块未运行（等待 market，但不阻塞插件激活）'
})

check('反向 B：市场在但没有 render()（老版本形状）→ 只 warn，不登记空面板', () => {
  const core = seedHost(SlotCore)
  const { ctx } = makeContext(core, { version: 0 })
  const warnings = []
  const original = console.warn
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    mod.apply(ctx)
  } finally {
    console.warn = original
  }
  assert(warnings.some((line) => line.includes('market.render')), '应该有一条解释原因的 console.warn')
  const ids = core.entries('sidebar.panellist').map((entry) => entry.options.id)
  assert(ids.join(',') === 'plugins,account-subscriptions', `不该登记市场那一行，实际 [${ids.join(', ')}]`)
  return `市场那一行没登记，并 warn：${warnings[0] ?? ''}`
})

/** 订阅插件设置栏的替身组件：把 props 摊在元素上，方便断言。 */
const SubscriptionsSectionStub = (props) => element('SubscriptionsSectionOutput', { props })

/**
 * 在 seedHost 之上再补：sidebar.settings 外壳和它声明的 settings.section，
 * 可选地登记 DSH 账号插件的 account 栏、订阅插件的 subscriptions 栏。
 *
 * 「订阅」那一行**不再由这里伪造** —— 它现在是本插件自己登记的（order 2），
 * 再伪造一行会和真登记撞 id。
 * @param {boolean} signedIn - 是否模拟「已登录」（账号插件只在登录后登记那一栏）。
 * @param {boolean} [withSubscriptions] - 是否模拟订阅插件登记了它的设置栏。
 * @returns {{core:any, opened:string[], refreshes:number[]}} 夹具。
 */
function seedAccountHost(signedIn, withSubscriptions = false) {
  const core = seedHost(SlotCore)
  core.record('sidebar').spec // 已声明
  const opened = []
  const store = { create: () => ({ actions: { openSection: (id) => opened.push(id), open: () => opened.push('(open)') } }) }
  core.register({ name: 'sidebar', locale: 'sidebar2', priority: 1, children: {
    'sidebar.settings': { kind: 'single', scope: 'root' },
  } }, () => null)
  core.register({ name: 'sidebar.settings', store, children: {
    'settings.section': { kind: 'list', scope: 'root' },
  } }, () => null)
  const refreshes = []
  if (signedIn) {
    core.register({ name: 'settings.section', id: 'account', order: -10, label: () => '账号与余额',
      inject: () => ({ refreshAccount: async () => { refreshes.push(1) } }) }, () => null)
  }
  if (withSubscriptions) {
    core.register({ name: 'settings.section', id: 'subscriptions', order: 90, label: () => '订阅',
      inject: () => ({ rpc: { call: async () => ({}) }, t: (key) => `sub:${key}` }) }, SubscriptionsSectionStub)
  }
  return { core, opened, refreshes }
}

check('侧栏三行（默认）：插件 / 插件市场 / 订阅，order 0/1/2 且中英标签跟随', () => {
  const { core } = seedAccountHost(true)
  const { ctx, bound } = makeContext(core, makeMarketStub().service)
  mod.apply(ctx)
  const rows = [...core.entries('sidebar.panellist')].sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
  const ids = rows.map((entry) => entry.options.id)
  assert(ids.join(',') === 'plugins,market,account-subscriptions', `顺序应为 插件/插件市场/订阅，实际 [${ids.join(', ')}]`)
  assert(rows.map((entry) => entry.options.order).join(',') === '0,1,2', `order 应为 0,1,2，实际 [${rows.map((entry) => entry.options.order).join(', ')}]`)

  const subs = rows.find((entry) => entry.options.id === 'account-subscriptions')
  assert(subs.options.order === 2, `订阅的 order 应为 2，实际 ${subs.options.order}`)
  assert(subs.locale === 'market-sidebar' && subs.options.label() === '订阅', `订阅 zh 标签不对：${subs.options.label()}`)
  for (const t of bound) t.setActive('en')
  assert(subs.options.label() === 'Subscriptions', `订阅 en 标签不对：${subs.options.label()}`)
  for (const t of bound) t.setActive('zh')

  const mains = core.entries('main').map((entry) => entry.options.key)
  assert(mains.includes('account-subscriptions'), `main 缺 account-subscriptions：[${mains.join(', ')}]`)
  // 默认关掉的那一行：登记表和 main 里都不该出现（余额改由 dsh-balance-widget 的页脚卡片显示）。
  assert(!ids.includes('account-balance'), `「账号与余额」默认不该登记，实际 [${ids.join(', ')}]`)
  assert(!mains.includes('account-balance'), `默认不该登记 account-balance 面板：[${mains.join(', ')}]`)
  const subsIcon = subs.component({ size: 18 })
  assert(subsIcon?.type === 'svg' && subsIcon.props.width === 18, '订阅行图标应是跟随 size 的 svg')
  return `sidebar.panellist=[${ids.join(', ')}]，main keys=[${mains.join(', ')}]`
})

check('开关打开时：第四行「账号与余额」回到 order 3（实现保留，随时可恢复）', () => {
  mod.__testing.setAccountRowEnabled(true)
  try {
    const { core } = seedAccountHost(true)
    const { ctx, bound } = makeContext(core, makeMarketStub().service)
    mod.apply(ctx)
    const rows = [...core.entries('sidebar.panellist')].sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
    const ids = rows.map((entry) => entry.options.id)
    assert(ids.join(',') === 'plugins,market,account-subscriptions,account-balance', `顺序应为 插件/插件市场/订阅/账号与余额，实际 [${ids.join(', ')}]`)
    const account = rows.at(-1)
    assert(account.options.order === 3, `账号与余额的 order 应为 3，实际 ${account.options.order}`)
    assert(account.options.label() === '账号与余额', `账号与余额 zh 标签不对：${account.options.label()}`)
    for (const t of bound) t.setActive('en')
    assert(account.options.label() === 'Account & Balance', `账号与余额 en 标签不对：${account.options.label()}`)
    for (const t of bound) t.setActive('zh')
    const accountIcon = account.component({ size: 18 })
    assert(accountIcon?.type === 'svg' && accountIcon.props.width === 18, '账号行图标应是跟随 size 的 svg')
    const mains = core.entries('main').map((entry) => entry.options.key)
    assert(mains.includes('account-balance'), `main 缺 account-balance：[${mains.join(', ')}]`)
    return `sidebar.panellist=[${ids.join(', ')}]`
  } finally {
    mod.__testing.setAccountRowEnabled(false)
  }
})

/** 在替身元素树里找第一个满足条件的节点（函数组件会展开）。 */
function findNode(node, test) {
  if (!node || typeof node !== 'object') return null
  if (node.__el && test(node)) return node
  if (node.__el && typeof node.type === 'function' && !(node.type.prototype instanceof StubComponent)) return findNode(node.type(node.props ?? {}), test)
  const kids = node.__el ? node.props?.children : node
  for (const kid of [].concat(kids ?? [])) { const hit = findNode(kid, test); if (hit) return hit }
  return null
}

check('账号与余额（已登录）：直接渲染账号插件登记的组件，props 按槽位规则拼好', () => {
  mod.__testing.setAccountRowEnabled(true) // 这一行默认关，检查它的实现时临时打开
  try {
  const { core } = seedAccountHost(true)
  // 换成带 hooks 的真实形状
  const accountStore = { getSnapshot: () => ({ view: { status: 'credential-stored' } }), subscribe: () => () => {} }
  const themeStore = { getSnapshot: () => ({ active: { colorScheme: 'light' } }), subscribe: () => () => {} }
  const refreshes = []
  const AccountSectionStub = (props) => element('AccountSectionOutput', { props })
  core.entries('settings.section').find((e) => e.options.id === 'account') // 先确认存在
  const off = core.register({ name: 'settings.section', id: 'account', priority: -1, label: () => '账号与余额',
    inject: () => ({ start() {}, cancel() {}, refreshAccount: async () => { refreshes.push(1) }, hooks: { account: accountStore, theme: themeStore } }) }, AccountSectionStub)
  const { ctx } = makeContext(core, undefined)
  mod.apply(ctx)
  const main = core.entries('main').find((entry) => entry.options.key === 'account-balance')
  const page = main.component({})
  const node = findNode(page, (n) => n.type === AccountSectionStub)
  assert(node, '页面里没有账号插件的组件')
  const p = node.props
  for (const key of ['t', 'useAccount', 'useTheme', 'start', 'cancel']) assert(key in p, `props 缺 ${key}`)
  assert(!('hooks' in p), 'hooks 应被展开成 useXxx，而不是原样传')
  assert(p.useAccount((v) => v.view.status) === 'credential-stored', 'useAccount(selector) 结果不对')
  assert(p.useTheme((v) => v.active.colorScheme) === 'light', 'useTheme(selector) 结果不对')
  const text = JSON.stringify(page)
  assert(text.includes('账号与余额'), '页面缺标题')
  off()
  return 'AccountSection ← { t, useAccount, useTheme, start, cancel, … }'
  } finally {
    mod.__testing.setAccountRowEnabled(false)
  }
})

check('账号与余额（未登录）：显示提示 +「在设置里打开」，按钮会打开设置的 account 栏', () => {
  mod.__testing.setAccountRowEnabled(true)
  try {
  const { core, opened } = seedAccountHost(false)
  const { ctx } = makeContext(core, undefined)
  mod.apply(ctx)
  const main = core.entries('main').find((entry) => entry.options.key === 'account-balance')
  const page = main.component({})
  assert(JSON.stringify(page).includes('还没有登录'), '缺未登录提示')
  const button = findNode(page, (n) => n.type === 'button')
  assert(button, '没找到「在设置里打开」按钮')
  button.props.onClick()
  assert(opened.join(',') === 'account', `应打开设置的 account 栏，实际 [${opened.join(', ')}]`)
  return '提示 + 按钮 → openSection("account")'
  } finally {
    mod.__testing.setAccountRowEnabled(false)
  }
})

check('订阅（设置栏已登记）：直接渲染订阅插件登记的组件，props 带 rpc 与它自己的 t', () => {
  const { core } = seedAccountHost(false, true)
  const { ctx } = makeContext(core, undefined)
  mod.apply(ctx)
  const main = core.entries('main').find((entry) => entry.options.key === 'account-subscriptions')
  assert(main, 'main 里没有订阅面板')
  const page = main.component({})
  const node = findNode(page, (n) => n.type === SubscriptionsSectionStub)
  assert(node, '页面里没有订阅插件的组件')
  assert(node.props.rpc && typeof node.props.rpc.call === 'function', 'props 缺 rpc')
  assert(typeof node.props.t === 'function' && node.props.t('nav') === 'sub:nav',
    'props 的 t 应该是订阅插件自己命名空间那一份（不能被本插件覆盖）')
  assert(!node.props.hooks, 'hooks 不该原样传进组件')
  assert(JSON.stringify(page).includes('订阅'), '页面缺标题')
  return 'SubscriptionsSection ← { rpc, t }（订阅插件自己的 t）'
})

check('订阅（设置栏没登记）：入口照样在，页面显示提示 +「在设置里打开」', () => {
  const { core, opened } = seedAccountHost(false, false)
  const { ctx } = makeContext(core, undefined)
  mod.apply(ctx)
  const row = core.entries('sidebar.panellist').find((entry) => entry.options.id === 'account-subscriptions')
  assert(row, '订阅插件没装时也该有这一行（页内给提示，不是整行消失）')
  const main = core.entries('main').find((entry) => entry.options.key === 'account-subscriptions')
  const page = main.component({})
  assert(JSON.stringify(page).includes('没有找到订阅插件的设置页'), '缺「没找到订阅页」提示')
  const button = findNode(page, (n) => n.type === 'button')
  assert(button, '没找到「在设置里打开」按钮')
  button.props.onClick()
  assert(opened.join(',') === 'subscriptions', `应打开设置的 subscriptions 栏，实际 [${opened.join(', ')}]`)
  return '提示 + 按钮 → openSection("subscriptions")'
})

console.log(`\n验证对象：${HERE}\n`)
let failed = 0
for (const result of results) {
  console.log(`${result.ok ? '  ✅' : '  ❌'} ${result.name}${result.detail ? `\n      ${result.detail}` : ''}`)
  if (!result.ok) failed += 1
}
console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}\n`)
process.exit(failed === 0 ? 0 : 1)
