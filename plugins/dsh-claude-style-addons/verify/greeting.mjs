#!/usr/bin/env node
/**
 * dsh-claude-style-addons · 一、中文问候语（原 dsh-cn-greeting）离线验证 —— 「契约考试」。
 *
 * 不启动 GUI，按 DSH 真会做的那样跑：
 *
 *   1. package.json 的 `dsh.client` 声明按 DSH 自己的校验规则核一遍；
 *   2. cordis.patch.yml 的 insert 行和 package.json 的 name 对得上；
 *   3. 用假的 window.__ModuleLoader__ 接住 client.js 的工厂并真的执行
 *      factory(require)（同时等于语法检查），再确认它导出了 cordis 插件与测试钩子；
 *   4. **契约检查 A（class 契约）**：读已装的 dsh-claude-style，确认首页标题组的
 *      `titleGroup` class 片段还在 —— 这是本插件找 DOM 的唯一依赖；
 *   4b. **契约检查 D（门禁契约）**：本插件只在「皮肤模式」下干活，判断依据是 `<body>` 上的
 *      `data-dsh-claude-style`。这里拿皮肤自己的 `skin.json` 的 `bodyAttr` 对一遍，并确认
 *      皮肤源码里确实在 `apply()` 打上它、在 `teardown()` 里摘掉它。
 *   5. **契约检查 B（台词表，这是重点）**：从已装的 dsh-claude-style/lib/client.js
 *      **现场**抽出它全部问候语模板（HERO_GREETING_SLOTS + HERO_GREETING_ANYTIME），
 *      逐条断言中文表里有对应台词。皮肤作者改了或加了问候语 → 这里立刻报红并指名缺哪几条，
 *      而不是某天在界面上撞见一句漏网的英文。这就是「绑定更新」：绑的是它的模板清单。
 *   6. **星期必须是动态的**：断言中文台词里不允许出现写死的「周日/周一/…」，
 *      必须走 %W 占位符（否则周一到周六都会说错）。
 *   7. 行为测试：把皮肤可能真的写出来的 27 条原句（含 7 个星期 × 各时段）逐条喂给
 *      translate()，断言输出是中文台词、星期随输入变化、认不出的英文一律返回 null 不碰。
 *   8. 门禁行为（假 DOM）：皮肤不在 → 零动作；皮肤后到 → 跟着亮；皮肤中途关掉 → 样式与
 *      印记摘干净、英文不再被改。
 *
 * 皮肤没装时第 4~7 步跳过（那时本插件本来也是空转）。
 *
 * 用法：node verify/greeting.mjs [--profile desktop]（或在包根目录 node verify.mjs 一次跑全部）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 合并进 dsh-claude-style-addons 后，本文件住在 verify/ 下：包根目录是上一级。
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 合并后的 client.js 导出两个部分；这份自检只测「一、中文问候语」那一部分（原 dsh-cn-greeting 的全部导出）。 */
const partOf = (merged) => merged.__parts.greeting

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

const argv = process.argv.slice(2)
const profileIndex = argv.indexOf('--profile')
const PROFILE = profileIndex >= 0 ? (argv[profileIndex + 1] ?? 'desktop') : (process.env.DSH_PROFILE ?? 'desktop')
const NODE_MODULES = path.join(os.homedir(), '.dsh', 'profiles', PROFILE, 'node_modules')
const SKIN_DIR = path.join(NODE_MODULES, 'dsh-claude-style')
const SKIN_CLIENT = path.join(SKIN_DIR, 'lib', 'client.js')

/* ───────────────────────── 静态声明检查 ───────────────────────── */

const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'))

check('package.json 的 dsh.client 声明符合 DSH 自己的校验规则', () => {
  const decl = manifest.dsh?.client
  assert(decl !== undefined && typeof decl === 'object' && decl !== null, 'dsh.client 缺失')
  assert(typeof decl.platform === 'string' && decl.platform !== '', 'dsh.client.platform 必须是字符串')
  for (const key of ['inject', 'external']) {
    if (decl[key] === undefined) continue
    assert(Array.isArray(decl[key]) && decl[key].every((item) => typeof item === 'string'),
      `dsh.client.${key} 必须是字符串数组`)
  }
  if (decl.immediately !== undefined) assert(typeof decl.immediately === 'boolean', 'dsh.client.immediately 必须是布尔')
  assert(typeof manifest.exports?.['./client'] === 'string', 'exports["./client"] 必须存在（浏览器半边要能加载）')
  return `platform=${decl.platform}，inject=${JSON.stringify(decl.inject ?? [])}，immediately=${decl.immediately}`
})

check('cordis.patch.yml 的 insert 行指向本包', () => {
  const text = fs.readFileSync(path.join(HERE, 'cordis.patch.yml'), 'utf8')
  assert(/-\s*insert:/.test(text), 'patch 里没有 insert 列表')
  const nameLine = /name:\s*'?"?([\w@/.-]+)'?"?/.exec(text)
  assert(nameLine !== null, 'patch 里没有 name')
  assert(nameLine[1] === manifest.name, `patch 的 name（${nameLine[1]}）应等于包名（${manifest.name}）`)
  return `name=${nameLine[1]}`
})

/* ───────────────────── 真的跑一遍 client.js ───────────────────── */

const clientSource = fs.readFileSync(path.join(HERE, 'client.js'), 'utf8')
let mod

check('client.js 可执行，工厂导出了 cordis 插件（同时等于语法检查）', () => {
  let captured = null
  const fakeWindow = { __ModuleLoader__: { load: (definition) => { captured = definition } } }
  // eslint-disable-next-line no-new-func
  new Function('window', clientSource)(fakeWindow)
  assert(captured !== null, '没有调用 window.__ModuleLoader__.load')
  assert(captured.id === manifest.name, `模块 id（${captured.id}）应等于包名`)
  mod = partOf(captured.factory(() => {
    throw new Error('本包不应该 require 任何模块')
  }))
  assert(mod && typeof mod.name === 'string', 'exports.name 缺失')
  assert(Array.isArray(mod.inject), 'exports.inject 必须是数组')
  assert(typeof mod.apply === 'function', 'exports.apply 必须是函数')
  return `name=${mod.name}，inject=${JSON.stringify(mod.inject)}`
})

const T = mod?.__testing

check('测试钩子齐备（verify 直接读表，不抠源码）', () => {
  assert(T !== undefined, 'exports.__testing 缺失')
  for (const key of ['LINES', 'WEEKDAYS', 'translate', 'chineseWeekdayFor', 'sweep', 'installGreeting',
    'SKIN_ATTR', 'skinModeOn', 'releaseStamps', 'ensureStyles', 'releaseStyles', 'INSTANCE']) {
    assert(T[key] !== undefined, `__testing.${key} 缺失`)
  }
  return `LINES=${Object.keys(T.LINES).length} 条，WEEKDAYS=${Object.keys(T.WEEKDAYS).length} 天`
})

check('没有任何中文台词留了空值或未定义的占位符', () => {
  const bad = []
  for (const [key, value] of Object.entries(T?.LINES ?? {})) {
    if (typeof value !== 'string' || value.trim() === '') { bad.push(`${key} → 空`); continue }
    const leftovers = value.replace(/%[NW]/g, '')
    if (/%[A-Za-z]/.test(leftovers)) bad.push(`${key} → 未定义占位符`)
    if (/\{name\}|\{weekday\}/.test(value)) bad.push(`${key} → 中文里残留英文占位符`)
  }
  assert(bad.length === 0, bad.join('；'))
  return `${Object.keys(T.LINES).length} 条全部有中文台词`
})

/* ─────────────────── 契约检查：对着已装的皮肤 ─────────────────── */

const skinInstalled = fs.existsSync(SKIN_CLIENT)

/**
 * 从皮肤源码里抽出一段以 `const NAME = [` 开头的数组字面量（配平方括号）。
 * @param {string} source - 皮肤 client.js 源码。
 * @param {string} name - 变量名。
 * @returns {string} 数组字面量文本。
 */
function arrayLiteral(source, name) {
  const start = source.indexOf(`const ${name} = [`)
  assert(start !== -1, `皮肤源码里找不到 ${name} —— 契约变了`)
  const open = source.indexOf('[', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1
    else if (source[i] === ']') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  throw new Error(`${name} 的数组没有闭合`)
}

/** 皮肤的全部问候语模板（现场抽出，不是抄来的）。 */
let skinTemplates = []

if (skinInstalled) {
  const skinSource = fs.readFileSync(SKIN_CLIENT, 'utf8')

  check('契约 A：皮肤仍用 titleGroup 这个 class 片段（本插件找 DOM 的唯一依赖）', () => {
    assert(skinSource.includes('titleGroup'), '皮肤源码里已经没有 titleGroup 了 —— 本插件会找不到标题组')
    const query = /querySelectorAll\('\[class\*="titleGroup"\]'\)/.test(skinSource)
    return query ? '皮肤用 [class*="titleGroup"] 查询' : '皮肤仍含 titleGroup（查询写法变了，但片段还在）'
  })

  check('契约 B：皮肤的问候语模板能被抽出来', () => {
    // eslint-disable-next-line no-new-func
    const slots = new Function(`return ${arrayLiteral(skinSource, 'HERO_GREETING_SLOTS')}`)()
    // eslint-disable-next-line no-new-func
    const anytime = new Function(`return ${arrayLiteral(skinSource, 'HERO_GREETING_ANYTIME')}`)()
    assert(Array.isArray(slots) && slots.length > 0, 'HERO_GREETING_SLOTS 抽出来不是数组')
    assert(Array.isArray(anytime) && anytime.length > 0, 'HERO_GREETING_ANYTIME 抽出来不是数组')
    skinTemplates = []
    for (const slot of slots) {
      assert(Array.isArray(slot.lines), '某个时段槽没有 lines 数组')
      skinTemplates.push(...slot.lines)
    }
    skinTemplates.push(...anytime)
    assert(skinTemplates.length > 0, '一条模板都没抽到')
    return `${slots.length} 个时段槽 + 通用池 ${anytime.length} 条 = 唯一模板 ${new Set(skinTemplates).size} 条`
  })

  check('契约 C【重点】：皮肤的每一条模板，中文表里都有对应台词', () => {
    const missing = skinTemplates.filter((template) => T.LINES[template] === undefined)
    assert(missing.length === 0,
      `皮肤有 ${missing.length} 条模板没有中文台词，需要补表：\n    ` + missing.join('\n    '))
    return `${new Set(skinTemplates).size}/${new Set(skinTemplates).size} 条模板全部有中文台词`
  })

  check('中文表里没有多余的死条目（皮肤已经不用的模板）', () => {
    const live = new Set(skinTemplates)
    const extra = Object.keys(T.LINES).filter((key) => !live.has(key))
    // 多余条目不算错（皮肤回滚时还用得上），报出来提醒一句。
    return extra.length === 0 ? '没有多余条目' : `注意：${extra.length} 条中文台词已不被皮肤引用 -> ${extra.join(' / ')}`
  })

  check('契约 D：门禁认的就是皮肤声明的 bodyAttr，且皮肤自己打上 / 摘掉它', () => {
    const skinJsonPath = path.join(SKIN_DIR, 'skin.json')
    assert(fs.existsSync(skinJsonPath), `皮肤没有 skin.json：${skinJsonPath}`)
    const skinJson = JSON.parse(fs.readFileSync(skinJsonPath, 'utf8'))
    assert(typeof skinJson.bodyAttr === 'string' && skinJson.bodyAttr !== '', 'skin.json 里没有 bodyAttr')
    assert(skinJson.bodyAttr === T.SKIN_ATTR,
      `门禁认的标记（${T.SKIN_ATTR}）与皮肤声明的 bodyAttr（${skinJson.bodyAttr}）不一致`)
    const setter = new RegExp(`\\.setAttribute\\(\\s*['"]${skinJson.bodyAttr}['"]`)
    const remover = new RegExp(`\\.removeAttribute\\(\\s*['"]${skinJson.bodyAttr}['"]`)
    assert(setter.test(skinSource), `皮肤源码里没有 setAttribute('${skinJson.bodyAttr}', …) —— 门禁永远判断不到`)
    assert(remover.test(skinSource), `皮肤源码里没有 removeAttribute('${skinJson.bodyAttr}') —— 皮肤关掉后本插件不会放手`)
    return `${skinJson.bodyAttr}（skin.json 声明 + 源码 set/remove 都在）`
  })
} else {
  results.push({ name: '皮肤未安装（跳过契约 A/B/C/D）', ok: true, detail: SKIN_DIR })
}

/* ───────────────────── 星期必须动态 ───────────────────── */

check('星期不是写死的：中文台词里不许出现「周日/周一/…」', () => {
  const hardcoded = []
  for (const [key, value] of Object.entries(T.LINES)) {
    if (/周[一二三四五六日天]/.test(value) && !/%W/.test(value)) hardcoded.push(key)
  }
  assert(hardcoded.length === 0,
    `这些台词把星期写死了，周一到周六都会说错：\n    ` + hardcoded.join('\n    '))
  const usesPlaceholder = Object.values(T.LINES).filter((value) => /%W/.test(value)).length
  return `含 %W 占位符的台词 ${usesPlaceholder} 条，写死的 0 条`
})

/* ───────────────────── 行为测试 ───────────────────── */

/** 皮肤可能真的写出来的原句：把每条模板按模板自己出现过的占位符填满。 */
function skinOutput(template, { name = 'andychen', weekday = 'Sunday' } = {}) {
  return template
    .replace('{name}', name)
    .replace('{weekday}', weekday)
}

check('行为：把皮肤真会写出的 27 条原句逐条喂进去，全部翻成中文', () => {
  const slots = [
    { from: 5, to: 12 }, { from: 12, to: 14 }, { from: 14, to: 18 }, { from: 18, to: 22 }, { from: 22, to: 29 },
  ]
  // 与皮肤一致的「本槽 + 通用池」候选，逐槽展开成 27 条实际原句。
  const anytime = skinTemplates.slice(-4)
  const slotLines = skinTemplates.slice(0, skinTemplates.length - 4)
  const cases = []
  let cursor = 0
  for (const slot of slots) {
    const count = [5, 3, 4, 4, 4][slots.indexOf(slot)]
    const own = slotLines.slice(cursor, cursor + count)
    cursor += count
    for (const template of own.concat(anytime)) cases.push(skinOutput(template))
  }
  // 皮肤没装时退回到「用中文表的键当模板」自测。
  const list = cases.length > 0 ? cases : Object.keys(T.LINES).map((template) => skinOutput(template))

  const failures = []
  for (const english of list) {
    const cn = T.translate(english, 'andychen')
    if (cn === null) failures.push(`翻不出来：${english}`)
    else if (!/[\u4e00-\u9fa5]/.test(cn)) failures.push(`翻出来不是中文：${english} → ${cn}`)
    else if (/[A-Za-z]/.test(cn)) failures.push(`翻出来还带英文：${english} → ${cn}`)
    else if (/%(N|W)/.test(cn)) failures.push(`占位符没填：${english} → ${cn}`)
  }
  assert(failures.length === 0, `\n    ` + failures.join('\n    '))
  return `${list.length} 条全部翻成中文，无残留占位符`
})

check('行为：星期随输入变化，7 天各不相同（抓「永远说周日」这类回归）', () => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const expected = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const got = days.map((day) => {
    const cn = T.translate(`Happy ${day}, andychen.`, 'andychen')
    assert(cn !== null, `Happy ${day} 翻不出来`)
    return { day, cn }
  })
  const failures = got
    .map((row, index) => (row.cn.includes(expected[index]) ? null : `${row.day} → ${row.cn}（应含 ${expected[index]}）`))
    .filter(Boolean)
  assert(failures.length === 0, `\n    ` + failures.join('\n    '))
  assert(new Set(got.map((row) => row.cn)).size === 7, '7 天的中文台词有重复，说明星期没跟输入走')
  return got.map((row) => `${row.day}→${row.cn.slice(0, 6)}…`).join('，')
})

check('行为：%N 只在认得出账号时才填；账号名一个字都不许漏到界面上', () => {
  // 通用池那条现在用写死的「主人」，不是 %N —— 但夜里那条仍走 %N → 烁丞，必须真的填得进去。
  const known = T.translate('Back at it, andychen?', 'andychen')
  assert(known === '欢迎回来 主人想我没', `认得账号名时这条应翻成主人那句，得到：${known}`)

  const byName = T.translate('Good evening, andychen.', 'andychen')
  assert(byName === '夜里好 烁丞 我陪你游', `「烁丞」必须能被填进 %N，得到：${byName}`)

  // 换一个账号：%N 那条必须把称呼整个去掉（不是留个空位、更不是塞默认名）。
  const stranger = 'zzz999'
  const noName = T.translate('Good evening, zzz999.', stranger)
  assert(noName !== null, '%N 那条应该仍能翻（只是不带称呼）')
  assert(!noName.includes('烁丞'), `认不出账号时不该出现「烁丞」：${noName}`)
  assert(!/[，,、]\s*[。！？；]/.test(noName), `去掉称呼后不该留空标点：${noName}`)
  assert(!/%(N|W)/.test(noName), `残留占位符：${noName}`)

  // 所有模板跑一遍陌生账号：账号名本身绝不许漏出，占位符绝不许残留。
  const leaked = []
  for (const template of Object.keys(T.LINES)) {
    const english = template.replace('{name}', stranger).replace('{weekday}', 'Monday')
    const cn = T.translate(english, stranger)
    if (cn === null) { leaked.push(`${english} → 翻不出来`); continue }
    if (cn.includes(stranger)) leaked.push(`${english} → ${cn}（账号名漏到界面上）`)
    if (/%(N|W)/.test(cn)) leaked.push(`${english} → ${cn}（残留占位符）`)
  }
  assert(leaked.length === 0, `\n    ` + leaked.join('\n    '))

  // 写死的称呼（主人 / 烁丞）是有意为之：它们不依赖账号名，换账号也照样显示。
  const hardcoded = Object.entries(T.LINES)
    .filter(([, cn]) => cn.includes('主人') || cn.includes('烁丞'))
    .map(([, cn]) => cn)
  return `认得→${known}；%N→${byName}；陌生账号→${noName}；写死的称呼 ${hardcoded.length} 条（有意为之）`
})

check('行为：不认识的英文一律不碰（返回 null，绝不乱改界面）', () => {
  const strangers = [
    'How can I help you today?',
    'Type / for commands',
    'What are you working on??',
    '',
    '   ',
  ]
  const touched = strangers.filter((text) => T.translate(text, 'andychen') !== null)
  assert(touched.length === 0, `这些不该被改写：${JSON.stringify(touched)}`)
  return `${strangers.length} 条陌生文本全部返回 null`
})

/**
 * 一个刚好够用的假 DOM，只为把「皮肤写英文 → 本插件改中文」这条链路离线跑通。
 * 不引入 jsdom（本插件零依赖）。
 *
 * 关键是要**如实**模拟两件事，否则测出来的是假绿：
 *   ① 观察记录在当前任务结束时同步投递给回调，`disconnect()` 之后不再投递；
 *   ② 排出去的微任务/定时器不会自己跑，必须 settle() 才落地。
 *
 * `options.skin === false` 造一个「皮肤还没接管」的页面（body 上没有 data-dsh-claude-style），
 * 用来测门禁；之后可以随时 `mountSkin()` / `unmountSkin()` 模拟皮肤亮 / 灭。
 * @param {{skin?: boolean}} [options] 初始状态。
 * @returns {any} 假环境。
 */
function makeFakeEnv(options = {}) {
  const micro = []
  const timers = []
  const microTask = () => ({ then(fn) { micro.push(fn); return this }, catch() { return this } })
  const fakePromise = { resolve: () => microTask() }
  const fakeSetTimeout = (fn) => { timers.push(fn); return 0 }

  /** 门禁认的那个标记：从插件自己的测试钩子里拿，避免和源码两处写死。 */
  const skinAttr = T?.SKIN_ATTR ?? 'data-dsh-claude-style'

  const makeNode = (attrs = {}, text = '') => {
    const listeners = []
    const node = {
      nodeType: 1,
      attributes: { ...attrs },
      textContent: text,
      children: [],
      parentElement: null,
      getAttribute(name) { return name in this.attributes ? this.attributes[name] : null },
      setAttribute(name, value) { this.attributes[name] = String(value); for (const fn of listeners) fn() },
      removeAttribute(name) { delete this.attributes[name]; for (const fn of listeners) fn() },
      hasAttribute(name) { return name in this.attributes },
      onAttributeChange(fn) { listeners.push(fn) },
    }
    return node
  }

  const span = makeNode({ class: 'skin_titleSpan' }, '')
  const group = makeNode({ class: 'skin_titleGroup' })
  group.children = [span]
  span.parentElement = group

  const root = {
    /** body 上的属性：门禁（data-dsh-claude-style）就住在这儿。 */
    attributes: {},
    querySelectorAll(selector) {
      if (selector.includes('titleGroup')) return [group]
      if (selector.includes('data-cn-greeting')) {
        return Object.keys(span.attributes).some((key) => key === 'data-cn-greeting') ? [span] : []
      }
      return []
    },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null },
    hasAttribute(name) { return name in this.attributes },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    removeAttribute(name) { delete this.attributes[name] },
  }
  if (options.skin !== false) root.attributes[skinAttr] = 'fake-build-id'

  const callbacks = []
  const connections = new Set()
  /** 至少还有一个观察者连着（`disconnected` 断言用它）。 */
  let connected = false
  /** 把一次变异如实投递给所有还连着的观察者（多代实例各有一个，head/body 也各一个）。 */
  const notify = (records) => {
    for (const cb of [...callbacks]) cb(records)
  }
  const MutationObserver = function (cb) {
    callbacks.push(cb)
    let alive = false
    connections.add(this)
    this.observe = () => { alive = true; connected = true }
    this.disconnect = () => {
      alive = false
      const index = callbacks.indexOf(cb)
      if (index >= 0) callbacks.splice(index, 1)
      if (!connections.has(this)) return
      connections.delete(this)
      connected = connections.size > 0
    }
    this.__alive = () => alive
  }

  /** 假 head：够 ensureStyles 建/摘一个 style 标签，并如实投递 head 的增删。 */
  const styleTags = []
  const fakeHead = {
    appendChild(node) {
      node.parentNode = fakeHead
      styleTags.push(node)
      notify([{ type: 'childList', target: fakeHead }])
      return node
    },
    removeChild(node) {
      const index = styleTags.indexOf(node)
      if (index >= 0) styleTags.splice(index, 1)
      node.parentNode = null
      notify([{ type: 'childList', target: fakeHead }])
      return node
    },
  }
  const createElement = (tagName) => ({ tagName, dataset: {}, textContent: '', parentNode: null })
  /** 让 root.querySelectorAll 也能按 data-plugin-css 找到 style 标签。 */
  const baseQuery = root.querySelectorAll.bind(root)
  root.querySelectorAll = (selector) => {
    const matched = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
    if (matched) return styleTags.filter((tag) => tag.dataset.pluginCss === matched[1])
    return baseQuery(selector)
  }

  const drain = (queue) => {
    let guard = 0
    while (queue.length > 0 && guard < 200) {
      guard += 1
      const fn = queue.shift()
      try { fn() } catch (error) { /* 断言失败会在主流程里报出来 */ }
    }
  }

  return {
    span,
    group,
    document: {
      body: root,
      head: fakeHead,
      querySelectorAll: (sel) => root.querySelectorAll(sel),
      querySelector: (sel) => root.querySelectorAll(sel)[0] ?? null,
      createElement,
    },
    /**
     * 「背地里」把某份样式标签抹掉，**不投递任何观察记录**。
     * 用来测第二道保险（body 那一轮里的 ensureStyles）：真发生过的场景是标签在
     * 观察者挂上之前/之外被回收（例如换代时的样式回收），head 那条路看不到它。
     * @param {string} tagId - `data-plugin-css` 标识。
     * @returns {boolean} 抹掉了没有。
     */
    evictStyleTagSilently(tagId) {
      const index = styleTags.findIndex((tag) => tag.dataset.pluginCss === tagId)
      if (index < 0) return false
      styleTags[index].parentNode = null
      styleTags.splice(index, 1)
      return true
    },
    MutationObserver,
    fakePromise,
    fakeSetTimeout,
    /** 皮肤这一代进来：打上接管标记，并如实投递一次属性观察记录。 */
    mountSkin() {
      root.attributes[skinAttr] = 'fake-build-id'
      notify([{ type: 'attributes', attributeName: skinAttr }])
    },
    /** 皮肤这一代走了：摘掉标记（teardown 里那一下），如实投递。 */
    unmountSkin() {
      delete root.attributes[skinAttr]
      notify([{ type: 'attributes', attributeName: skinAttr }])
    },
    /** 现在 body 上有没有那个标记（断言用）。 */
    get skinMounted() { return skinAttr in root.attributes },
    /**
     * 皮肤往标题组写一句英文（模拟它那一行 textContent 赋值）。
     * 真浏览器的语义：观察记录在**当前任务结束时**同步投递给回调；
     * `disconnect()` 之后不再投递。
     */
    skinWrites(text) {
      span.textContent = text
      notify([{ type: 'characterData' }])
    },
    /**
     * 让排出去的微任务/定时器落地。本插件把改写排进微任务（早于浏览器绘制），
     * 所以断言前必须先 flush，否则「此刻还没改」会被误读成「失败了」。
     */
    settle() {
      drain(micro)
      drain(timers)
    },
    get disconnected() { return !connected },
  }
}

check('机制：皮肤写英文 → 本插件在微任务里改成中文（不抢绘制，也不打架）', () => {
  const env = makeFakeEnv()
  const install = new Function('window', 'document', 'MutationObserver', 'fetch', 'console', 'Promise', 'setTimeout', clientSource)
  let captured = null
  install(
    { __ModuleLoader__: { load: (definition) => { captured = definition } } },
    env.document,
    env.MutationObserver,
    () => Promise.reject(new Error('离线验证不联网')),
    { warn() {}, info() {} },
    env.fakePromise,
    env.fakeSetTimeout,
  )
  const live = partOf(captured.factory(() => { throw new Error('本包不应该 require 任何模块') }))
  const dispose = live.__testing.installGreeting()

  env.skinWrites('Back at it, andychen?')
  // 关键：改写必须**排在微任务里**（这样它早于绘制，英文不会闪一下），所以这一刻还没改。
  assert(env.span.textContent === 'Back at it, andychen?', '皮肤刚写完就立刻改了？应该排到微任务，否则可能闪英文')
  env.settle()
  assert(env.span.textContent === '欢迎回来 主人想我没', `第一次改写失败：${env.span.textContent}`)
  assert(env.span.hasAttribute('data-cn-greeting'), '改写后应打上自己的印记')

  // 皮肤 60 秒兜底又写了**另一句**英文：同一个 span 被复用，也必须再翻一次。
  env.skinWrites('Hello, night owl.')
  env.settle()
  assert(env.span.textContent === '月亮不睡我不睡', `复写新句子时失败：${env.span.textContent}`)

  // 皮肤「文本相同就不写」：它再看到中文时不会再动我们。
  env.skinWrites('月亮不睡我不睡')
  assert(env.span.textContent === '月亮不睡我不睡', '中文是陌生的英文？不该被误判')
  env.settle()
  assert(env.span.textContent === '月亮不睡我不睡', '中文被误改')

  // 卸载：观察者断开，皮肤随后写的英文不再被翻译（这就是「关掉即回英文」）。
  dispose()
  assert(env.disconnected, '卸载时没有断开观察者')
  env.skinWrites('Hey there, andychen.')
  env.settle()
  assert(env.span.textContent === 'Hey there, andychen.', '卸载后仍在改写（应该放手）')
  return '写入→微任务改写、同一节点复写→再改写、卸载→放手，三个环节都对'
})

/**
 * 把 client.js 装进一个假环境，并把 installGreeting 挂上。
 * 只为下面两条门禁测试服务（免得再抄一遍 new Function 的参数表），
 * `calls.fetch` 用来抓「皮肤没在时居然去探账号名」。
 * @param {any} env - makeFakeEnv() 的产物。
 * @returns {any} { live, dispose, calls }。
 */
function bootGreeting(env) {
  const calls = { fetch: 0 }
  const install = new Function('window', 'document', 'MutationObserver', 'fetch', 'console', 'Promise', 'setTimeout', clientSource)
  let captured = null
  install(
    { __ModuleLoader__: { load: (definition) => { captured = definition } } },
    env.document,
    env.MutationObserver,
    () => { calls.fetch += 1; return Promise.reject(new Error('离线验证不联网')) },
    { warn() {}, info() {} },
    env.fakePromise,
    env.fakeSetTimeout,
  )
  const live = partOf(captured.factory(() => { throw new Error('本包不应该 require 任何模块') }))
  return { live, calls, dispose: live.__testing.installGreeting() }
}

check('门禁：皮肤没在（不是 Claude Code Style 模式）→ 零动作：不注入样式、不探账号名、一个英文都不改', () => {
  const env = makeFakeEnv({ skin: false })
  const boot = bootGreeting(env)
  const styleCount = () => env.document
    .querySelectorAll(`style[data-plugin-css="${boot.live.__testing.STYLE_TAG_ID}"]`).length

  assert(styleCount() === 0, '皮肤没在，竟然注入了字体样式（会在别人界面上留一份覆盖）')
  env.skinWrites('Back at it, andychen?')
  env.settle()
  assert(env.span.textContent === 'Back at it, andychen?', `皮肤没在，竟然改了英文：${env.span.textContent}`)
  assert(!env.span.hasAttribute('data-cn-greeting'), '皮肤没在，竟然打了印记')

  // 皮肤一直不来：观察者也一个字都不该动（它只是「盯一眼」）
  env.skinWrites('Hello, night owl.')
  env.settle()
  assert(env.span.textContent === 'Hello, night owl.', '皮肤没在，英文被吃掉了')
  assert(styleCount() === 0, '皮肤没在，样式标签还是冒出来了')
  assert(boot.calls.fetch === 0, '皮肤没在，竟然去探账号名（那条路由是皮肤的）')

  boot.dispose()
  return '样式 0 个、账号名探测 0 次、英文原样、无印记'
})

check('门禁：皮肤后到（谁先 apply 不保证）→ 跟着亮；皮肤中途关掉 → 样式与印记收干净、立刻放手', () => {
  const env = makeFakeEnv({ skin: false })
  const boot = bootGreeting(env)
  const STAMP = boot.live.__testing.STAMP
  const styleCount = () => env.document
    .querySelectorAll(`style[data-plugin-css="${boot.live.__testing.STYLE_TAG_ID}"]`).length

  // 首屏这种顺序是真会出现的：皮肤还没打标记，英文已经写进标题组。
  env.skinWrites('Back at it, andychen?')
  env.settle()
  assert(env.span.textContent === 'Back at it, andychen?', '皮肤没在时不该翻译')

  // 皮肤这一代进来：标记一打上，立刻挂上 + 把已经写在页面上的那句补翻。
  env.mountSkin()
  env.settle()
  assert(styleCount() === 1, `皮肤进来后应注入 1 个样式标签，实际 ${styleCount()}`)
  assert(boot.calls.fetch === 1, `皮肤进来后应探一次账号名，实际 ${boot.calls.fetch} 次`)
  assert(env.span.textContent === '欢迎回来\u2002主人想我没', `皮肤进来后没有补翻：${env.span.textContent}`)
  assert(env.span.hasAttribute(STAMP), '补翻后应打上印记')

  // 皮肤关掉（teardown 摘掉标记）：样式与印记都得收干净。
  env.unmountSkin()
  env.settle()
  assert(styleCount() === 0, '皮肤关掉后样式标签还留着（这就是「没人认领的字体覆盖」）')
  assert(!env.span.hasAttribute(STAMP), '皮肤关掉后印记没摘')
  // 既定口径：不写「还原文本」逻辑 —— 皮肤卸载 / 宿主重渲染会把这一行一起带走。
  assert(env.span.textContent === '欢迎回来\u2002主人想我没', '不该在这里自作主张把文本改回英文')

  // 皮肤再回来：那一句还是我们写的中文，印记要自己补回来（字体 CSS 认的就是印记）。
  env.mountSkin()
  env.settle()
  assert(styleCount() === 1, '皮肤回来后样式没有重新注入')
  assert(env.span.hasAttribute(STAMP), '皮肤回来后印记没补回来（字体 CSS 会认不到那一行）')
  assert(env.span.textContent === '欢迎回来\u2002主人想我没', '已经是中文的那句不该被再翻一次')

  // 再关一次：这一回皮肤写了新英文，必须真的放手。
  env.unmountSkin()
  env.settle()
  env.skinWrites('Hey there, andychen.')
  env.settle()
  assert(env.span.textContent === 'Hey there, andychen.', '皮肤关掉后还在改写（应该放手）')

  boot.dispose()
  assert(env.disconnected, '卸载时没有断开观察者')
  return '皮肤不在→零动作；皮肤后到→补翻；皮肤关掉→样式与印记摘干净且放手'
})

check('台词长度与分隔符：≤14 字、零标点、停顿只用 U+2002（点阵里没有「同源形状的标点」）', () => {
  const LIMIT = 14
  const SEP = '\u2002'
  const over = []
  const stats = { withSep: 0, bare: 0 }
  for (const value of Object.values(T.LINES)) {
    // 按「用户真会看到的形态」量：占位符换成真实内容再数。
    const real = value.replace(/%W/g, '周三').replace(/%N/g, '烁丞')
    const length = [...real].length
    if (length > LIMIT) over.push(`${real}（${length} 字）`)
    // 任何标点都不许出现：这个点阵字体把逗号/顿号/小逗号都画成同一个曲线小圆圈，
    // 句点/中点/半角句点都画成同一个空心小圆圈 —— 换标点解决不了「形状不同源」。
    // 而全角逗号与普通空格宽度相同（都是 20px），所以留标点并不能省地方，只添乱。
    const withoutSep = real.split(SEP).join(String())
    if (/[。，！？；：、·・]/.test(withoutSep)) over.push(`${real}（混进了标点）`)
    if (/[,.!?;:]/.test(real)) over.push(`${real}（混进了半角标点）`)
    // 停顿只许用 U+2002（半角空格，实测 10px＝半个字）；普通空格 20px 会把句子切成两截。
    if (/\u0020/.test(real)) over.push(`${real}（用了普通空格，应为 U+2002）`)
    if (/\u2009/.test(real)) over.push(`${real}（U+2009 只有 4px，太紧）`)
    if (real.startsWith(SEP) || real.endsWith(SEP)) over.push(`${real}（首尾不该有分隔符）`)
    if (real.includes(SEP + SEP)) over.push(`${real}（连续两个分隔符）`)
    if (real.includes(SEP)) stats.withSep += 1
    else stats.bare += 1
  }
  assert(over.length === 0, `这些台词不合格：\n    ` + over.join('\n    '))
  const lengths = Object.values(T.LINES).map((v) => [...v.replace(/%W/g, '周三').replace(/%N/g, '烁丞')].length)
  return `全部在 ${LIMIT} 字内，最长 ${Math.max(...lengths)} 字，平均 ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} 字；`
    + `带停顿 ${stats.withSep} 条、一口气说完 ${stats.bare} 条、标点 0`
})

check('字体开关与鱼标间距：样式齐备、压得过皮肤、且只作用于首页那一行', () => {
  assert(typeof T.GREETING_FONT === 'string', 'GREETING_FONT 未导出')
  assert(T.FONTS[T.GREETING_FONT] !== undefined, `GREETING_FONT（${T.GREETING_FONT}）不在 FONTS 注册表里`)
  const missing = ['pixel', 'song', 'kai', 'ping', 'hei', 'yuan', 'skin'].filter((k) => T.FONTS[k] === undefined)
  assert(missing.length === 0, `字体注册表缺项：${missing.join(', ')}`)
  for (const key of ['pixel', 'song', 'kai', 'ping', 'hei', 'yuan']) {
    const css = T.stylesFor(key)
    assert(css.includes('!important'), `${key} 的样式没带 !important，会被皮肤的规则压掉`)
    assert(css.includes(`[${T.STAMP}]`), `${key} 的样式没作用于本插件改写的那个 span`)
    const primary = T.FONTS[key].stack.split(',')[0].replace(/"/g, '')
    assert(css.includes(primary), `${key} 的样式里没有主选字体名`)
    // 鱼标间距：只认「含本插件印记的 headline」，否则会改到工作室布局或别处的 headline。
    assert(css.includes(`[class*="headline"]:has([${T.STAMP}])`),
      `${key} 的样式里没有把鱼标间距限定在首页那一行`)
    assert(css.includes(`gap: ${T.MARK_GAP}px !important`),
      `${key} 的鱼标间距没带 !important 或数值不对（皮肤给的是 8px，本插件要 ${T.MARK_GAP}px）`)
  }
  assert(T.MARK_GAP > 8, `鱼标间距（${T.MARK_GAP}px）没有比皮肤的 8px 更宽，改了个寂寞`)
  assert(T.stylesFor('skin') === '', "'skin' 表示跟随皮肤，不该产出覆盖样式")
  assert(T.stylesFor('不存在的字体') !== '', '未知字体名应退回默认字体而不是不输出样式')
  return `当前 = ${T.GREETING_FONT}（${T.FONTS[T.GREETING_FONT].label}），注册表 7 项，鱼标间距 ${T.MARK_GAP}px（皮肤 8px）`
})

check('机制：字体 CSS 真的插进了 head，停用时真的被摘掉', () => {
  const env = makeFakeEnv()
  const install = new Function('window', 'document', 'MutationObserver', 'fetch', 'console', 'Promise', 'setTimeout', clientSource)
  let captured = null
  install(
    { __ModuleLoader__: { load: (definition) => { captured = definition } } },
    env.document,
    env.MutationObserver,
    () => Promise.reject(new Error('离线验证不联网')),
    { warn() {}, info() {} },
    env.fakePromise,
    env.fakeSetTimeout,
  )
  const live = partOf(captured.factory(() => { throw new Error('本包不应该 require 任何模块') }))
  const dispose = live.__testing.installStyles()

  const tags = env.document.querySelectorAll(`style[data-plugin-css="${live.__testing.STYLE_TAG_ID}"]`)
  assert(tags.length === 1, `应有 1 个 style 标签，实际 ${tags.length}`)
  const css = tags[0].textContent
  assert(css.includes('!important'), 'CSS 没带 !important，压不过皮肤的 20px 规则')
  assert(css.includes(`[${live.__testing.STAMP}]`), 'CSS 没作用于本插件改写的那个 span')
  assert(css.includes('GB18030 Bitmap'), `CSS 里没有点阵字体名：${css.split('\n')[1]}`)

  // 重复注入不应该产生第二个标签。
  const again = live.__testing.installStyles()
  const after = env.document.querySelectorAll(`style[data-plugin-css="${live.__testing.STYLE_TAG_ID}"]`)
  assert(after.length === 1, `重复注入产生了 ${after.length} 个标签`)
  again()

  // 停用：标签被摘掉，字体覆盖随之消失（界面回到皮肤自己的字体）。
  dispose()
  const gone = env.document.querySelectorAll(`style[data-plugin-css="${live.__testing.STYLE_TAG_ID}"]`)
  assert(gone.length === 0, '停用后 style 标签没被摘掉，字体会残留在界面上')
  return '注入 1 个（重复注入不叠加）、带 !important、停用即摘除'
})

check('机制：样式标签被回收（DSH 换代）→ 当场 / 下一轮自己补回来（「中文还在、像素字体没了」那条）', () => {
  const env = makeFakeEnv()
  const boot = bootGreeting(env)
  const T2 = boot.live.__testing
  const sel = `style[data-plugin-css="${T2.STYLE_TAG_ID}"]`
  assert(env.document.querySelectorAll(sel).length === 1, '挂上时应当有 1 个样式标签')

  // ① 正常路径：DSH 换代时回收旧 entry 的样式 —— <head> 一变就当场补回来（不轮询、不等下一次 body 变动）。
  const tag = env.document.querySelectorAll(sel)[0]
  tag.parentNode.removeChild(tag)
  assert(env.document.querySelectorAll(sel).length === 1,
    'head 里的样式标签被回收后没当场补回来 —— 界面就会停在「中文还在、像素字体没了」')

  // ② 第二道保险：标签在观察者看不到的地方没了（挂上之前/之外被回收），也该在下一轮 DOM 变动里补回来。
  assert(env.evictStyleTagSilently(T2.STYLE_TAG_ID) === true, '前置条件：应当抹掉了一份样式')
  assert(env.document.querySelectorAll(sel).length === 0, '前置条件：标签确实没了')
  env.skinWrites('Back at it, andychen?')
  env.settle()
  assert(env.document.querySelectorAll(sel).length === 1, 'body 那一轮没有把样式补回来')
  assert(env.span.textContent === '欢迎回来\u2002主人想我没', `顺手也该把英文翻掉：${env.span.textContent}`)

  boot.dispose()
  assert(env.document.querySelectorAll(sel).length === 0, '停用后仍要摘干净')
  assert(env.disconnected, '停用后两个观察者都该断开')
  return 'head 变动 → 当场补回；body 变动 → 下一轮补回；停用 → 摘干净'
})

check('机制：样式标签记归属 —— 别的实例正在用的那份，本实例的清理不许摘（HMR 接力掉棒）', () => {
  const env = makeFakeEnv()
  const boot = bootGreeting(env)
  const T2 = boot.live.__testing
  const sel = `style[data-plugin-css="${T2.STYLE_TAG_ID}"]`
  const tag = env.document.querySelectorAll(sel)[0]
  assert(tag !== undefined, '挂上时应当有 1 个样式标签')
  assert(tag.dataset.plugin === T2.PLUGIN_ID, `标签上的 data-plugin 应为包名，实际 ${tag.dataset.plugin}`)

  // 归到「另一代实例」名下：这时本实例必须放手（否则新实例的字体就没了）。
  tag.dataset.cnGreetingOwner = 'older-generation'
  assert(T2.releaseStyles() === false, '归属不是自己却把它摘了 —— 新旧实例重叠时正是这么掉棒的')
  assert(env.document.querySelectorAll(sel).length === 1, '别人的样式被摘掉了')

  // 本实例挂载/自愈时会「认领」这份样式，认领之后才有权摘。
  assert(T2.ensureStyles() === true, 'ensureStyles 应返回 true')
  assert(tag.dataset.cnGreetingOwner === T2.INSTANCE, '认领后归属应写成本实例')
  assert(T2.releaseStyles() === true, '自己那份应当能摘掉')
  assert(env.document.querySelectorAll(sel).length === 1,
    '挂载中摘掉自己那份后应当立刻自愈回来（否则又是一次「中文还在、字体没了」）')

  // 停用（mounted 先落 false）之后才真摘干净。
  boot.dispose()
  assert(env.document.querySelectorAll(sel).length === 0, '停用后应当摘干净')

  // 印记同理：另一代实例写进去的那句（不是我写的），清理时不许摘它的印记。
  const otherEnv = makeFakeEnv()
  const otherBoot = bootGreeting(otherEnv)
  otherEnv.span.setAttribute(otherBoot.live.__testing.STAMP, '1')
  otherEnv.span.textContent = '这不是本实例写的句子'
  assert(otherBoot.live.__testing.releaseStamps() === 0, '别人写的内容的印记不该被摘')
  assert(otherEnv.span.hasAttribute(otherBoot.live.__testing.STAMP), '别人那句的印记被摘掉了（它就拿不到字体了）')
  otherBoot.dispose()

  return '归属别人的不动；自己那份摘了会自愈；停用才摘干净'
})

check('行为：installGreeting 在没有 MutationObserver 的环境里安全退场', () => {
  const dispose = T.installGreeting.call(null)
  assert(typeof dispose === 'function', 'installGreeting 必须返回卸载函数')
  dispose()
  return '返回了卸载函数，未抛异常'
})

/* ───────────────────────── 汇总 ───────────────────────── */

// 有一项异步（DOM 机制那条），所以结果表要在微任务都落地之后再汇总。
await new Promise((resolve) => setTimeout(resolve, 0))

let passed = 0
for (const row of results) {
  if (row.ok) passed += 1
  const mark = row.ok ? '✓' : '✗'
  console.log(`${mark} ${row.name}${row.detail ? `\n    ${row.detail}` : ''}`)
}
console.log(`\n${passed}/${results.length} 通过`)

if (passed !== results.length) process.exitCode = 1
