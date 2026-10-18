// 术语表结构与一致性校验。
//
// 术语表是 DeepSeek API 不可用时的本地兜底翻译来源（见 lib/deepseek-translator.mjs
// 的 glossaryTranslate），所以它必须是一个「小写英文 key → 非空中文 value」的扁平
// 对象，并且不能有重复键（重复键在 JSON.parse 后会被静默吞掉，只有扫原文才发现）。
//
// 运行："/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" \
//         --test test/glossary.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GLOSSARY_PATH = fileURLToPath(new URL('../lib/glossary.json', import.meta.url))

/** 术语表要求的最小条目数。 */
const MIN_ENTRIES = 120

/** key 允许的字符：小写字母、数字、空格、/、-、+。 */
const KEY_PATTERN = /^[a-z0-9 /+-]+$/

/** 译文里出现 CJK 即为「确实翻了」。 */
const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

/** 原文，用于同时做「原文扫描」类断言（重复键、缩进、末尾换行）。 */
const raw = readFileSync(GLOSSARY_PATH, 'utf8')
const glossary = JSON.parse(raw)

/** 用正则扫原文里的顶层键，用来发现 JSON.parse 之后被吞掉的重复键。 */
function scanRawTopLevelKeys(text) {
  // 顶层键固定是 2 空格缩进 + 引号（write 出来的文件就是 2 空格缩进）。
  const matches = text.match(/^ {2}"((?:[^"\\]|\\.)*)"\s*:/gm) ?? []
  return matches.map((line) => line.trim().replace(/:$/, '').replace(/^"|"$/g, ''))
}

test('glossary.json 存在、是 UTF-8、可被 JSON.parse 解析', () => {
  assert.equal(typeof glossary, 'object', 'JSON 根必须是对象')
  assert.notEqual(glossary, null, 'JSON 根不能是 null')
  assert.ok(!Array.isArray(glossary), 'JSON 根必须是扁平对象，不是数组')
})

test('文件是 2 空格缩进且以换行结尾', () => {
  // 缩进硬约束：第 2 行（第一个条目）必须以恰好 2 个空格开头。
  const secondLine = raw.split('\n')[1]
  assert.match(secondLine, /^ {2}"/, `第一条应缩进 2 空格，实际: ${JSON.stringify(secondLine)}`)
  assert.ok(!/^\t/m.test(raw), '不能使用 Tab 缩进')
  assert.ok(raw.endsWith('\n'), '文件必须以换行结尾')
  assert.ok(!raw.endsWith('\n\n'), '文件不应有多余的空行结尾')
})

test('顶层是「字符串 → 非空字符串」的扁平映射', () => {
  const entries = Object.entries(glossary)
  assert.ok(entries.length > 0, '不能是空对象')
  for (const [key, value] of entries) {
    assert.equal(typeof key, 'string', `key 必须是字符串: ${key}`)
    assert.equal(typeof value, 'string', `value 必须是字符串: ${key} → ${JSON.stringify(value)}`)
    assert.notEqual(value.trim(), '', `value 不能为空或纯空白: ${key}`)
  }
  // 扁平：任何 value 都不能是对象 / 数组（嵌套结构会让 glossaryTranslate 失效）。
  for (const [key, value] of entries) {
    assert.ok(!(value instanceof Object), `value 不能是对象/数组（必须扁平）: ${key}`)
  }
})

test(`条目总数 >= ${MIN_ENTRIES}`, () => {
  const count = Object.keys(glossary).length
  assert.ok(
    count >= MIN_ENTRIES,
    `术语表至少需要 ${MIN_ENTRIES} 条，当前只有 ${count} 条`,
  )
})

test('key 全是小写，且只含字母/数字/空格/slash/连字符/加号', () => {
  for (const key of Object.keys(glossary)) {
    assert.equal(key, key.toLowerCase(), `key 必须小写: ${JSON.stringify(key)}`)
    assert.match(key, KEY_PATTERN, `key 含非法字符: ${JSON.stringify(key)}`)
    assert.equal(key, key.trim(), `key 不能有首尾空白: ${JSON.stringify(key)}`)
    assert.ok(!key.includes('  '), `key 不应有连续空格: ${JSON.stringify(key)}`)
  }
})

test('原文里没有重复 key（JSON.parse 会静默去重，必须扫源码）', () => {
  // 先自证扫描器本身有效：造一份含重复键的样例，必须能报出来。
  const selfCheck = scanRawTopLevelKeys('{\n  "api": "API",\n  "api": "接口",\n  "dsh": "DSH"\n}\n')
  assert.deepEqual(selfCheck, ['api', 'api', 'dsh'], '顶层键扫描器应原样扫出重复键')

  const rawKeys = scanRawTopLevelKeys(raw)
  assert.ok(rawKeys.length >= MIN_ENTRIES, `原文顶层键应 >= ${MIN_ENTRIES}，实际 ${rawKeys.length}`)

  const seen = new Set()
  const duplicates = new Set()
  for (const key of rawKeys) {
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  assert.deepEqual(
    [...duplicates],
    [],
    `发现重复 key（JSON.parse 会静默丢弃后者）：${[...duplicates].join(', ')}`,
  )
  // 同时确认「扫出来的键」和「解析出来的键」数量一致 —— 数量不等说明有键被吞了。
  assert.equal(
    rawKeys.length,
    Object.keys(glossary).length,
    '原文键数与解析后键数不一致，可能存在重复键或非法顶层结构',
  )
})

test('所有 value 无首尾空白，且不被英文引号包裹', () => {
  for (const [key, value] of Object.entries(glossary)) {
    assert.equal(value, value.trim(), `译文不能有首尾空白: ${key} → ${JSON.stringify(value)}`)
    assert.ok(
      !(/^["'`].*["'`]$/.test(value) && value.length > 1),
      `译文不应被引号包裹: ${key} → ${JSON.stringify(value)}`,
    )
    assert.ok(!value.includes('\n'), `译文不能含换行: ${key}`)
  }
})

test('产品名与技术专名保持英文原样（value 与 key 一致或为规范大写）', () => {
  // 这些必须「原样保留」，否则会让 DSH 生态里的专名变形。
  const exact = {
    dsh: 'DSH',
    api: 'API',
    comfyui: 'ComfyUI',
    gemini: 'Gemini',
    github: 'GitHub',
    json: 'JSON',
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    seedream: 'Seedream',
    dashscope: 'DashScope',
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    sqlite: 'SQLite',
    webdav: 'WebDAV',
  }
  for (const [key, expected] of Object.entries(exact)) {
    assert.equal(glossary[key], expected, `${key} 应保持专名 ${expected}`)
  }
  // 专名类 value 不含 CJK（就是英文原文 / 规范大小写）。
  for (const key of Object.keys(exact)) {
    assert.ok(!CJK_PATTERN.test(glossary[key]), `${key} 是专名，不应翻译成中文`)
  }
})

test('抽查译文正确性（与 DSH 生态既有译法一致）', () => {
  // —— UI 骨架词 —— 这些是插件页出现频率最高、译法最固定的词。
  assert.equal(glossary.sidebar, '侧边栏', 'DSH 官方右侧栏文案统一用「侧边栏」')
  assert.equal(glossary.session, '会话', '官方会话相关文案统一用「会话」（如「新会话」）')
  assert.equal(glossary.settings, '设置', '官方设置入口统一用「设置」')
  assert.equal(glossary.theme, '主题', '主题/皮肤统一用「主题」')
  assert.equal(glossary['status line'], '状态行', 'dsh-status-rotator 的中文标题即「状态行」')
  assert.equal(glossary['plugin market'], '插件市场', 'dsh-market-sidebar 描述里的既有译法')
  assert.equal(glossary.plugin, '插件', '插件页核心词')
  assert.equal(glossary.market, '插件市场', 'DSH 语境下的 market 即插件市场')
  assert.equal(glossary['file tree'], '文件树', 'dsh-better-sidebar 既有译法')
  assert.equal(glossary['side chat'], '侧边对话', 'dsh-better-sidebar 既有译法')
  assert.equal(glossary['background task'], '后台任务', 'dsh-better-sidebar 既有译法')
  assert.equal(glossary.task, '任务', '任务列表统一用「任务」')
  assert.equal(glossary.job, '后台任务', '官方把 job 译作「后台任务」')
  assert.equal(glossary.workspace, '工作区', '官方工作区文案')
  assert.equal(glossary.terminal, '终端', '官方终端文案')
  assert.equal(glossary.subagent, '子智能体', '官方 subagent 译法')
  assert.equal(glossary.agent, '智能体', '官方 agent 译法')
  assert.equal(glossary.skill, '技能', '官方 skill 译法')
  assert.equal(glossary.diff, '改动对比', '官方改动视图文案')
  assert.equal(glossary.preview, '预览', '官方「预览」按钮文案')
  assert.equal(glossary['search'], '搜索', '官方搜索框文案')
  assert.equal(glossary.approval, '审批', '官方「待审批」')
  assert.equal(glossary.permission, '权限', '官方权限预设')
  assert.equal(glossary.sandbox, '沙箱', '官方沙箱文案')
  assert.equal(glossary['voice input'], '语音输入', '官方语音输入插件文案')
  assert.equal(glossary['speech to text'], '语音转文字', '官方语音转写文案')
  assert.equal(glossary.tab, '标签页', '官方「新标签页」')
  assert.equal(glossary['one-click install'], '一键安装', 'market 文案「一键安装」')
  assert.equal(glossary['one-click'], '一键', '复合词前缀')
  // —— 插件特性词 —— 描述里高频出现的功能名。
  assert.equal(glossary.typewriter, '打字机', 'dsh-status-rotator 中文文案即「打字机」')
  assert.equal(glossary.danmaku, '弹幕', 'dsh-status-rotator 中文文案即「弹幕」')
  assert.equal(glossary.gradient, '渐变', 'dsh-status-rotator「炫彩渐变」')
  assert.equal(glossary['theme pack'], '主题包', 'dsh-status-rotator「主题词库包」')
  assert.equal(glossary.prompt, '提示词', 'dsh-image-gen 中文文案即「提示词」')
  assert.equal(glossary.gallery, '图库', 'dsh-image-gen 中文文案即「图库」')
  assert.equal(glossary.canvas, '画布', 'dsh-image-gen「无限画布」')
  assert.equal(glossary.workflow, '工作流', 'dsh-image-gen / ComfyUI 统一用「工作流」')
  assert.equal(glossary.provider, '服务商', '模型/图像服务商用「服务商」')
  assert.equal(glossary['hot reload'], '热重载', '前端生态统称')
  assert.equal(glossary.stream, '流式输出', 'LLM 语境下 stream 即流式输出')
  assert.equal(glossary.token, 'token', '官方 UI 保留英文 token（如「已达输出 token 上限」）')
  assert.equal(glossary['peak/off-peak'], '高峰/低谷时段', 'DeepSeek 计价时段术语')
  assert.equal(glossary['off-peak'], '低谷时段', 'DeepSeek 计价时段术语')
  assert.equal(glossary['peak'], '高峰时段', 'DeepSeek 计价时段术语')
})

test('UI 骨架词全部已翻成中文（不能是英文原样）', () => {
  // 这些词若 value 仍是纯英文，说明术语表没起作用。
  const mustBeChinese = [
    'plugin', 'plugin market', 'market', 'sidebar', 'session', 'settings', 'theme',
    'status line', 'status bar', 'file tree', 'file viewer', 'workspace', 'terminal',
    'subagent', 'agent', 'skill', 'task', 'diff', 'preview', 'search', 'approval',
    'permission', 'sandbox', 'voice input', 'speech to text', 'tab', 'panel',
    'typewriter', 'danmaku', 'gallery', 'canvas', 'workflow', 'prompt', 'provider',
    'hot reload', 'stream', 'cost', 'usage', 'balance', 'install', 'update',
    'uninstall', 'backup', 'restore', 'favorite', 'comment', 'note', 'group',
    'notification', 'shortcut', 'locale', 'language', 'editor', 'explorer',
    'file manager', 'workbench', 'toolbar', 'tooltip', 'modal', 'thumbnail',
    'screenshot', 'batch', 'compare', 'history', 'preset', 'template', 'log',
    'cache', 'config', 'configuration', 'export', 'import', 'download', 'upload',
    'drag', 'refresh', 'reload', 'restart', 'retry', 'reset', 'restore', 'roll back',
    'revert', 'disable', 'disabled', 'enable', 'enabled', 'filter', 'sort', 'browse',
    'comment', 'community', 'dashboard', 'release', 'repository', 'render', 'setup',
    'shell', 'snippet', 'state', 'timeout', 'tool', 'ui', 'version', 'viewer',
    'zoom', 'live', 'live preview', 'live progress', 'local', 'local storage',
    'cloud', 'cloud sync', 'auto backup', 'one-click', 'one-click install',
    'one-click update', 'dark mode', 'light mode', 'external link', 'fallback',
    'folder', 'directory', 'file', 'image', 'image generation', 'icon', 'logo',
    'brand', 'category', 'discover', 'bookmark', 'badge', 'layout', 'library',
    'message', 'model', 'multi model', 'provider', 'schedule', 'seed', 'subscription',
    'aspect ratio', 'merge', 'note', 'phase', 'meme', 'access key', 'api key',
    'key', 'proxy', 'goal', 'host', 'patch', 'patch layer', 'profile', 'plugin page',
    'plugin card', 'plugin list', 'plugin management', 'plugin manager',
    'plugin settings', 'plugin ecosystem', 'settings page', 'sidebar tab',
    'file viewer', 'workflow', 'peak', 'off-peak', 'peak/off-peak',
  ]
  const missing = mustBeChinese.filter((key) => !(key in glossary))
  assert.deepEqual(missing, [], `以下 UI 词条缺失：${missing.join(', ')}`)

  const stillEnglish = mustBeChinese.filter((key) => !CJK_PATTERN.test(glossary[key]))
  assert.deepEqual(stillEnglish, [], `以下 UI 词条没有译成中文：${stillEnglish.join(', ')}`)
})

test('key 按字母序排列（便于维护）', () => {
  const keys = Object.keys(glossary)
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  assert.deepEqual(keys, sorted, '术语表 key 必须按字母序排列')
})
