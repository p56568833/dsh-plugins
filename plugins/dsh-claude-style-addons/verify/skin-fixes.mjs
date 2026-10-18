#!/usr/bin/env node
/**
 * dsh-claude-style-addons · 二、皮肤修补（原 dsh-skin-fixes）离线验证。
 *
 * 不启动 GUI，按 DSH 真会做的那样跑：
 *
 *   1. package.json 的 `dsh.client` 声明按 DSH 自己的校验规则核一遍
 *      （platform 必填字符串、inject/external 必须是字符串数组、immediately 必须是
 *       布尔、exports["./client"] 必须存在）；
 *   2. cordis.patch.yml 的 insert 行和 package.json 的 name 对得上；
 *   3. 用假的 window.__ModuleLoader__ 接住 client.js 的工厂并真的执行
 *      factory(require)（同时等于语法检查），再用假 document 跑一遍 apply(ctx)：
 *      确认它真的创建了那个 style 标签、内容里两段补丁都在、卸载能把标签摘掉；
 *   4. **契约检查**：读已装的 dsh-claude-style，确认本插件依赖的属性名/class 前缀还在；
 *   5. **优先级检查**：把皮肤里同目标的那几条选择器抠出来，与本插件的选择器各算一次
 *      优先级，断言本插件压得住（否则界面上根本不会生效，而这一步不需要开浏览器就能查出来）。
 *
 * 皮肤没装时第 4、5 步跳过（本插件的 CSS 那时本来也是空转）。
 *
 * 用法：node verify/skin-fixes.mjs [--profile desktop]（或在包根目录 node verify.mjs 一次跑全部）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 合并进 dsh-claude-style-addons 后，本文件住在 verify/ 下：包根目录是上一级。
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 合并后的 client.js 导出两个部分；这份自检只测「二、皮肤修补」那一部分（原 dsh-skin-fixes 的全部导出）。 */
const partOf = (merged) => merged.__parts.skinFixes

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
const WIDGET_DIR = path.join(NODE_MODULES, 'dsh-balance-widget')

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

/** 一个只够用的假 document：接住 style 标签的创建与移除。 */
function makeFakeDocument() {
  const tags = []
  const head = {
    appendChild(node) {
      node.parentNode = head
      tags.push(node)
      return node
    },
    removeChild(node) {
      const index = tags.indexOf(node)
      if (index >= 0) tags.splice(index, 1)
      node.parentNode = null
      return node
    },
  }
  return {
    tags,
    document: {
      head,
      createElement(tagName) {
        return { tagName, dataset: {}, textContent: '', parentNode: null }
      },
      querySelector(selector) {
        const matched = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
        if (matched === null) throw new Error(`验证脚本没实现这个查询：${selector}`)
        return tags.find((tag) => tag.dataset.pluginCss === matched[1]) ?? null
      },
    },
  }
}

const clientSource = fs.readFileSync(path.join(HERE, 'client.js'), 'utf8')
let mod
let fake
const disposers = []

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
  assert(typeof mod.apply === 'function', 'exports.apply 不是函数')
  assert(mod.name === manifest.name, 'exports.name 应等于包名')
  assert(Array.isArray(mod.inject), 'exports.inject 必须是数组')
  assert(mod.inject.length === 0, `本插件不需要任何服务，inject 应为空，实际 [${mod.inject.join(', ')}]`)
  assert(typeof mod.__testing?.css === 'string' && mod.__testing.css.length > 200, 'exports.__testing.css 没露出来')
  return `id=${captured.id}，inject=[]，CSS ${mod.__testing.css.length} 字节`
})

check('apply(ctx) 真的创建了那个 style 标签，内容里两段补丁都在', () => {
  fake = makeFakeDocument()
  const originalDocument = globalThis.document
  globalThis.document = fake.document
  try {
    const ctx = {
      effect(fn) {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
    }
    mod.apply(ctx)
  } finally {
    globalThis.document = originalDocument
  }
  assert(fake.tags.length === 1, `应该只创建一个 style 标签，实际 ${fake.tags.length}`)
  const tag = fake.tags[0]
  assert(tag.tagName === 'style', '创建的不是 style 元素')
  assert(tag.dataset.plugin === manifest.name, `dataset.plugin 应为包名，实际 ${tag.dataset.plugin}`)
  assert(tag.dataset.pluginCss === mod.__testing.styleTagId, 'dataset.pluginCss 与 __testing.styleTagId 不一致')
  const css = tag.textContent
  for (const fragment of [
    'data-dsh-claude-footer-takeover',
    'dshbw_sideWrap',
    'data-dsh-claude-footer-hidden',
    'data-dsh-claude-footer-entry',
    'data-dsh-claude-brand="deepseek"',
    '--dsh-claude-inline-code-bg',
    '--dsh-claude-inline-code-fg',
  ]) {
    assert(css.includes(fragment), `注入的 CSS 缺片段：${fragment}`)
  }
  return `${css.length} 字节，含余额卡片位置与 DeepSeek 代码配色两段`
})

check('注入的 CSS 花括号平衡，且四条规则都在', () => {
  const css = mod.__testing.css
  const open = (css.match(/\{/g) ?? []).length
  const close = (css.match(/\}/g) ?? []).length
  assert(open === close, `花括号不平衡：{ ${open} 个，} ${close} 个（一段坏 CSS 会静默失效）`)
  assert(open === 4, `应当正好 4 条规则（容器 / 条目 / 品牌浅色 / 品牌深色），实际 ${open} 条`)
  return `4 条规则，{ } 各 ${open} 个`
})

check('重复注入复用同一个标签；disposer 能把标签摘掉，之后还能重新装上', () => {
  const originalDocument = globalThis.document
  globalThis.document = fake.document
  let second
  try {
    second = mod.__testing.installStyles()
  } finally {
    globalThis.document = originalDocument
  }
  assert(fake.tags.length === 1, `重复注入不该新建标签，实际 ${fake.tags.length}`)
  second()
  assert(fake.tags.length === 0, 'disposer 应该把标签摘掉')
  const originalDocumentAgain = globalThis.document
  globalThis.document = fake.document
  let third
  try {
    third = mod.__testing.installStyles()
  } finally {
    globalThis.document = originalDocumentAgain
  }
  assert(fake.tags.length === 1, `重新装上应当只有一个标签，实际 ${fake.tags.length}`)
  third()
  assert(fake.tags.length === 0, '重新装上的那个也该能摘掉')
  // 已经被摘掉的节点再摘一次不该出事（effect 可能被销毁两次）。
  for (const dispose of disposers) dispose()
  assert(fake.tags.length === 0, '重复销毁应当是空操作')
  return '复用 + 摘除 + 重装 + 重复销毁都对'
})

/* ───────────────── 契约 + 优先级（对着已装皮肤算） ───────────────── */

/**
 * 从一个选择器里算 (id, class/attr/pseudo-class, type) 三元组。
 * `:is()` / `:has()` / `:not()` 按规范取参数里最具体的一项计入，自身不额外加分。
 * @param {string} selector - 选择器（可含组合器）。
 * @returns {[number, number, number]} 三元组。
 */
function specificity(selector) {
  let rest = String(selector)
  let ids = 0
  let mids = 0
  let types = 0
  for (const fn of [':is(', ':has(', ':not(']) {
    let index = rest.indexOf(fn)
    while (index !== -1) {
      const start = index + fn.length
      let depth = 1
      let cursor = start
      while (cursor < rest.length && depth > 0) {
        if (rest[cursor] === '(') depth += 1
        else if (rest[cursor] === ')') depth -= 1
        cursor += 1
      }
      const inner = rest.slice(start, cursor - 1)
      let best = [0, 0, 0]
      for (const alternative of inner.split(',')) {
        const trimmed = alternative.trim()
        if (trimmed === '') continue
        const current = specificity(trimmed)
        if (compare(current, best) > 0) best = current
      }
      ids += best[0]
      mids += best[1]
      types += best[2]
      rest = `${rest.slice(0, index)} ${rest.slice(cursor)}`
      index = rest.indexOf(fn)
    }
  }
  rest = rest.replace(/::[\w-]+/g, ' ')
  ids += (rest.match(/#[\w-]+/g) ?? []).length
  mids += (rest.match(/\[[^\]]*\]/g) ?? []).length
  mids += (rest.match(/:(?!:)[\w-]+/g) ?? []).length
  mids += (rest.match(/\.[\w-]+/g) ?? []).length
  const withoutClasses = rest.replace(/\.[\w-]+/g, ' ')
  const withoutAttrs = withoutClasses.replace(/\[[^\]]*\]/g, ' ')
  const withoutPseudos = withoutAttrs.replace(/:(?!:)[\w-]+/g, ' ')
  for (const token of withoutPseudos.split(/[\s>+~,]+/)) {
    if (token !== '' && /^[a-zA-Z][\w-]*$/.test(token)) types += 1
  }
  return [ids, mids, types]
}

/**
 * @param {[number,number,number]} a - 三元组。
 * @param {[number,number,number]} b - 三元组。
 * @returns {number} a 比 b 具体返回正数。
 */
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** 把 CSS 文本拆成 { selector, body } 列表（注释去掉，够用即止）。 */
function cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let matched = pattern.exec(clean)
  while (matched !== null) {
    rules.push({ selector: matched[1].trim().replace(/\s+/g, ' '), body: matched[2].trim() })
    matched = pattern.exec(clean)
  }
  return rules
}

/** 皮肤 bundle 里那堆 CSS 字符串行，还原成选择器列表。 */
function skinSelectors(source) {
  const out = []
  // 皮肤把 CSS 写成 JS 字符串数组，选择器里的双引号是转义过的（[class*=\"footArea\"]），
  // 所以必须按「JS 字符串字面量」整体抠，不能按 " 硬切。
  const pattern = /"((?:[^"\\]|\\.)*)"/g
  let matched = pattern.exec(source)
  while (matched !== null) {
    const text = matched[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    if ((text.startsWith('body') || text.startsWith('html')) && text.includes('{')) {
      out.push(text.replace(/\s*\{\s*$/, '').replace(/\s+/g, ' ').trim())
    }
    matched = pattern.exec(source)
  }
  return out
}

/**
 * 在候选里挑同时含全部片段（并可要求结尾/排除）的那一条。
 *
 * 同类里挑**最具体**的一条，不挑第一条：皮肤对同一个目标可能写好几条声明
 * （0.11.x 的 DeepSeek 品牌块就既有带 `[data-dsh-claude-palette="claude"]` 的
 * 四属性版，也有别的主题版本），真正压住本插件的只有最具体的那条；拿一条更弱的
 * 去比，会算出「本插件压得住」的假通过。
 * @param {string[]} list - 候选选择器。
 * @param {string[]} fragments - 必须同时出现的片段。
 * @param {string} label - 报错用的名字。
 * @param {{endsWith?: string, exclude?: string}} [options] - 结尾 / 排除条件。
 * @returns {string} 选中的选择器。
 */
function pick(list, fragments, label, options = {}) {
  const matches = list.filter((item) => fragments.every((fragment) => item.includes(fragment))
    && (options.endsWith === undefined || item.endsWith(options.endsWith))
    && (options.exclude === undefined || !item.includes(options.exclude)))
  assert(matches.length > 0,
    `没找到目标选择器（${label}）：需要含 ${fragments.join(' + ')}`
    + `${options.endsWith === undefined ? '' : `，以 ${options.endsWith} 结尾`}`
    + `${options.exclude === undefined ? '' : `，且不含 ${options.exclude}`}`)
  return matches.reduce((best, item) => (compare(specificity(item), specificity(best)) > 0 ? item : best))
}

check('契约检查：已装皮肤 / 余额组件里，本插件依赖的属性名与 class 前缀都还在', () => {
  if (!fs.existsSync(SKIN_DIR)) return `跳过：${SKIN_DIR} 不存在（皮肤没装，CSS 本来也是空转）`
  const skin = fs.readFileSync(path.join(SKIN_DIR, 'lib', 'client.js'), 'utf8')
  const skinVersion = JSON.parse(fs.readFileSync(path.join(SKIN_DIR, 'package.json'), 'utf8')).version
  for (const fragment of [
    'data-dsh-claude-footer-takeover',
    'data-dsh-claude-footer-entry',
    'data-dsh-claude-footer-hidden',
    '[class*=\\"footerActions\\"]',
    '[class*=\\"footArea\\"]',
    'data-dsh-claude-brand=\\"deepseek\\"',
    '--dsh-claude-inline-code-fg',
    '--dsh-claude-inline-code-bg',
  ]) {
    assert(skin.includes(fragment), `皮肤 ${skinVersion} 里找不到契约片段：${fragment}`)
  }
  let widgetNote = '（余额组件没装，跳过它的 class 检查）'
  if (fs.existsSync(WIDGET_DIR)) {
    const widget = fs.readFileSync(path.join(WIDGET_DIR, 'lib', 'client.js'), 'utf8')
    const widgetVersion = JSON.parse(fs.readFileSync(path.join(WIDGET_DIR, 'package.json'), 'utf8')).version
    assert(widget.includes('dshbw_sideWrap'), `dsh-balance-widget ${widgetVersion} 里没有 dshbw_sideWrap`)
    widgetNote = `dsh-balance-widget ${widgetVersion} 的 dshbw_sideWrap ✓`
  }
  return `dsh-claude-style ${skinVersion} 的 8 项契约齐 ✓；${widgetNote}`
})

check('优先级检查：本插件的选择器压得住皮肤里同目标的那几条', () => {
  if (!fs.existsSync(SKIN_DIR)) return `跳过：${SKIN_DIR} 不存在`
  const skinSelectorsAll = skinSelectors(fs.readFileSync(path.join(SKIN_DIR, 'lib', 'client.js'), 'utf8'))
  assert(skinSelectorsAll.length > 10, `从皮肤里只抠出 ${skinSelectorsAll.length} 条选择器，抽取规则大概失效了`)
  const mine = cssRules(mod.__testing.css)

  const pairs = [
    {
      label: '页脚容器（footerActions 的 0×0）',
      skin: pick(skinSelectorsAll, ['footerActions', 'footArea', '>'], '皮肤·容器',
        { endsWith: '[class*="footerActions"]' }),
      mine: pick(mine.map((rule) => rule.selector), ['footerActions', 'footArea', ':has('], '本插件·容器',
        { endsWith: ':has([class*="dshbw_sideWrap"])' }),
      skinProperty: 'width: 0',
      mineProperty: 'width: 100%',
    },
    {
      label: '条目被打上 hidden（display:none）',
      skin: pick(skinSelectorsAll, ['data-dsh-claude-footer-hidden'], '皮肤·隐藏',
        { endsWith: '[data-dsh-claude-footer-hidden]' }),
      mine: pick(mine.map((rule) => rule.selector), ['data-dsh-claude-footer-hidden', ':has('], '本插件·解隐藏'),
      skinProperty: 'display: none',
      mineProperty: 'display: block',
    },
    {
      label: '条目盒子被归零（data-dsh-claude-footer-entry）',
      skin: pick(skinSelectorsAll, ['data-dsh-claude-footer-entry'], '皮肤·归零',
        { endsWith: '[data-dsh-claude-footer-entry]' }),
      mine: pick(mine.map((rule) => rule.selector), ['data-dsh-claude-footer-entry', ':has('], '本插件·还盒子'),
      skinProperty: 'width: 0',
      mineProperty: 'width: auto',
    },
    {
      label: 'DeepSeek 品牌·浅色（行内代码变量）',
      skin: pick(skinSelectorsAll, ['data-dsh-claude-brand="deepseek"', ':not([data-ds-dark-theme])'], '皮肤·浅色',
        { endsWith: ':not([data-ds-dark-theme])' }),
      mine: pick(mine.map((rule) => rule.selector), ['data-dsh-claude-brand="deepseek"', ':not([data-ds-dark-theme])'], '本插件·浅色',
        { endsWith: ':not([data-ds-dark-theme])' }),
      skinProperty: '--dsh-claude-inline-code-fg',
      mineProperty: '--dsh-claude-inline-code-bg',
    },
    {
      label: 'DeepSeek 品牌·深色（行内代码变量）',
      skin: pick(skinSelectorsAll, ['data-dsh-claude-brand="deepseek"', '[data-ds-dark-theme]'], '皮肤·深色',
        { exclude: ':not(', endsWith: '[data-ds-dark-theme]' }),
      mine: pick(mine.map((rule) => rule.selector), ['data-dsh-claude-brand="deepseek"', '[data-ds-dark-theme]'], '本插件·深色',
        { exclude: ':not(', endsWith: '[data-ds-dark-theme]' }),
      skinProperty: '--dsh-claude-inline-code-fg',
      mineProperty: '--dsh-claude-inline-code-bg',
    },
  ]

  const detail = []
  const failures = []
  for (const pair of pairs) {
    // 一组不通过也要把后面几组都比完：早先第一组失败就抛，深色那组根本没跑过，
    // 于是「浅色修好了、深色还坏着」这种情况会被这一步放过去。
    try {
      // 皮肤那条同时要含「归零/隐藏」属性，否则说明抽到的是别的规则。
      const skinRule = cssRules(skinSelectorsAll.map((selector) => `${selector} {${pair.skinProperty}}`).join('\n'))
        .find((rule) => rule.selector === pair.skin)
      assert(skinRule !== undefined, `${pair.label}：皮肤那条规则里没有「${pair.skinProperty}」，抽取出的选择器可能不对`)
      const mineRule = mine.find((rule) => rule.selector === pair.mine)
      assert(mineRule !== undefined, `${pair.label}：找不到本插件的规则`)
      assert(mineRule.body.includes(pair.mineProperty), `${pair.label}：本插件的规则里没有「${pair.mineProperty}」`)
      const skinSpec = specificity(pair.skin)
      const mineSpec = specificity(pair.mine)
      assert(compare(mineSpec, skinSpec) > 0,
        `${pair.label}：优先级不够压过皮肤（本插件 ${mineSpec.join('-')} vs 皮肤 ${skinSpec.join('-')}）`)
      detail.push(`${pair.label} ${mineSpec.join('-')}>${skinSpec.join('-')}`)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  assert(failures.length === 0, failures.join('；'))
  return detail.join('；')
})

/* ───────────────── 页脚守卫：用迷你 DOM 真跑一遍判定逻辑 ───────────────── */

/**
 * 一个只够本插件用的迷你 DOM：支持 [attr] / [attr*="v"] / .class / tag
 * 四种简单选择器（含逗号分隔）与子树增删。
 * @returns {{doc:any, refs:Record<string,any>}} 迷你 document 与关键节点。
 */
function makeDomDocument() {
  const compile = (selector) => selector.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const tests = []
    let rest = part
    rest = rest.replace(/\[([\w-]+)\*="([^"]*)"\]/g, (_, name, value) => {
      tests.push((node) => String(node.attributes[name] ?? '').includes(value))
      return ''
    })
    rest = rest.replace(/\[([\w-]+)\]/g, (_, name) => {
      tests.push((node) => Object.hasOwn(node.attributes, name))
      return ''
    })
    rest = rest.replace(/\.([\w-]+)/g, (_, cls) => {
      tests.push((node) => String(node.attributes.class ?? '').split(/\s+/).includes(cls))
      return ''
    })
    const tag = rest.trim()
    if (tag !== '') tests.push((node) => node.tagName === tag)
    return (node) => tests.every((test) => test(node))
  })

  const matches = (node, selector) => compile(selector).some((test) => test(node))
  const descendants = (node) => {
    const out = []
    const walk = (current) => {
      for (const child of current.children) {
        out.push(child)
        walk(child)
      }
    }
    walk(node)
    return out
  }

  const makeNode = (tagName, attributes = {}, ownText = '') => {
    const element = {
      tagName,
      attributes: { ...attributes },
      children: [],
      parentElement: null,
      parentNode: null,
      isConnected: true,
      ownText,
      get textContent() {
        let text = element.ownText
        for (const child of element.children) text += child.textContent
        return text
      },
      hasAttribute(name) {
        return Object.hasOwn(element.attributes, name)
      },
      setAttribute(name, value) {
        element.attributes[name] = String(value)
      },
      removeAttribute(name) {
        delete element.attributes[name]
      },
      matches(selector) {
        return matches(element, selector)
      },
      querySelector(selector) {
        return descendants(element).find((node) => matches(node, selector)) ?? null
      },
      querySelectorAll(selector) {
        return descendants(element).filter((node) => matches(node, selector))
      },
      appendChild(child) {
        child.parentElement = element
        child.parentNode = element
        child.isConnected = true
        element.children.push(child)
        return child
      },
      removeChild(child) {
        const index = element.children.indexOf(child)
        if (index >= 0) element.children.splice(index, 1)
        child.parentElement = null
        child.parentNode = null
        child.isConnected = false
        return child
      },
    }
    return element
  }

  const body = makeNode('body', { 'data-dsh-claude-style': '', 'data-dsh-claude-footer-takeover': '' })
  const footArea = makeNode('div', { class: 'x_footArea_y' })
  const actions = makeNode('div', { class: 'x_footerActions_y' })
  const anchor = makeNode('div', { 'data-slot': 'sidebar.footer.action' })
  const card = makeNode('div', { class: 'dshbw_sideWrap' })
  const cardButton = makeNode('button', { class: 'dshbw_side' }, '¥15.99今日·全部¥1.7864')
  const mirror = makeNode('div', { class: 'dsh-claude-popover-item' }, '¥15.99今日·全部¥1.7864')
  const otherMirror = makeNode('div', { class: 'dsh-claude-popover-item' }, '设置')

  body.appendChild(footArea)
  footArea.appendChild(actions)
  actions.appendChild(anchor)
  anchor.appendChild(card)
  card.appendChild(cardButton)
  body.appendChild(mirror)
  body.appendChild(otherMirror)

  const head = makeNode('head')
  const doc = {
    body,
    head,
    createElement: (tagName) => makeNode(tagName),
    querySelector(selector) {
      if (matches(body, selector)) return body
      return descendants(body).find((node) => matches(node, selector)) ?? null
    },
    querySelectorAll(selector) {
      const out = descendants(body).filter((node) => matches(node, selector))
      if (matches(body, selector)) out.unshift(body)
      return out
    },
  }
  return { doc, refs: { body, footArea, actions, anchor, card, cardButton, mirror, otherMirror } }
}

check('守卫：接管开着时给余额卡片那一条打跳过标记，并摘掉皮肤已镜像的那一份', () => {
  const { doc, refs } = makeDomDocument()
  const report = mod.__testing.runFooterGuard(doc)
  assert(report.marked === 1, `应当标记 1 条，实际 ${report.marked}`)
  assert(refs.card.hasAttribute('data-slot-error'), '卡片那一条没拿到跳过标记')
  assert(report.pruned === 1, `应当摘掉 1 份镜像，实际 ${report.pruned}`)
  assert(refs.mirror.isConnected === false, '余额那一份镜像没被摘掉')
  assert(refs.otherMirror.isConnected === true, '不该动别的镜像条目')
  // 标记之后，皮肤那边就再也看不到这一条 → 不会再折叠、也不会再镜像。
  const visible = mod.__testing.collectEntries(refs.actions)
  assert(!visible.includes(refs.card), '标记之后卡片不该还在皮肤的条目列表里')
  const second = mod.__testing.runFooterGuard(doc)
  assert(second.marked === 0 && second.pruned === 0, `第二遍不该再动手：${JSON.stringify(second)}`)
  return '标记 1 条、摘掉 1 份镜像、重复跑不动手'
})

check('守卫：接管关着时撤掉自己打的标记；没有皮肤的界面上一动不动', () => {
  const { doc, refs } = makeDomDocument()
  const guard = mod.__testing.runFooterGuard
  guard(doc)
  assert(refs.card.hasAttribute('data-slot-error'), '前置条件：先标记上')
  refs.body.removeAttribute('data-dsh-claude-footer-takeover')
  const report = guard(doc)
  assert(report.cleared === 1, `应当撤掉 1 个标记，实际 ${report.cleared}`)
  assert(!refs.card.hasAttribute('data-slot-error'), '标记没撤掉')

  const clean = makeDomDocument()
  clean.refs.body.removeAttribute('data-dsh-claude-style')
  const noop = guard(clean.doc)
  assert(noop.marked === 0 && noop.cleared === 0 && noop.pruned === 0, '没有皮肤时不该有任何动作')
  assert(!clean.refs.card.hasAttribute('data-slot-error'), '没有皮肤时不该打标记')
  return '撤标记 + 空转都对'
})

check('守卫判定函数：认得「哪一条是它」、认得「同一份余额」', () => {
  const { refs } = makeDomDocument()
  const { entryNodeFor, sameBalanceText, normalizeText } = mod.__testing
  assert(entryNodeFor(refs.card, refs.actions) === refs.card, '锚点子节点形状：条目就是卡片自己')
  assert(entryNodeFor(refs.mirror, refs.actions) === null, '不在 footerActions 里的节点不该认成条目')
  assert(sameBalanceText('¥15.99 今日·全部 ¥1.7864', refs.card.textContent), '同一份余额应当认得出（空白无关）')
  assert(!sameBalanceText('¥16.01 今日·全部 ¥1.7864', refs.card.textContent), '金额不同不该认成同一份')
  assert(!sameBalanceText('¥1', '¥1'), '太短的串不当命中')
  assert(normalizeText('  余额 ¥5  ') === '余额¥5', '归一化应当去掉所有空白')
  return '条目识别 + 文本比对都对'
})

check('守卫真的挂上了观察者，卸载时会断开并撤标记', () => {
  const { doc, refs } = makeDomDocument()
  const observed = []
  const disconnects = []
  const OriginalObserver = globalThis.MutationObserver
  globalThis.MutationObserver = class {
    observe(target, options) {
      observed.push({ target, options })
    }

    disconnect() {
      disconnects.push(1)
    }
  }
  const originalDocument = globalThis.document
  globalThis.document = doc
  let dispose
  try {
    dispose = mod.__testing.installFooterGuard()
  } finally {
    globalThis.document = originalDocument
    globalThis.MutationObserver = OriginalObserver
  }
  assert(observed.length === 1, `应当 observe 一次，实际 ${observed.length}`)
  assert(observed[0].target === doc.body, '应当观察 body')
  assert(observed[0].options?.childList === true && observed[0].options?.subtree === true, 'options 缺 childList/subtree')
  assert(Array.isArray(observed[0].options?.attributeFilter), 'options 缺 attributeFilter')
  assert(refs.card.hasAttribute('data-slot-error'), '挂上时应当立刻跑一遍并打上标记')
  dispose()
  assert(disconnects.length === 1, '卸载时应当断开观察者')
  assert(!refs.card.hasAttribute('data-slot-error'), '卸载时应当撤掉自己打的标记')
  return 'observe 参数 + 立即执行 + 卸载清理都对'
})

/* ───────────────────────────── 输出 ───────────────────────────── */

console.log(`验证对象：${HERE}`)
console.log(`profile：${PROFILE}\n`)
for (const item of results) {
  console.log(`  ${item.ok ? '✅' : '❌'} ${item.name}`)
  if (item.detail !== '') console.log(`      ${item.detail}`)
}
const failed = results.filter((item) => !item.ok)
console.log(`\n${failed.length === 0 ? '全部通过' : `${failed.length} 项未通过`}`)
process.exitCode = failed.length === 0 ? 0 : 1
