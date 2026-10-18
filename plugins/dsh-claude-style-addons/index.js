/**
 * dsh-claude-style-addons —— 宿主半边。
 *
 * 干活的地方全在浏览器里（见 client.js）。宿主半边只做两件事：
 *
 *   1. 让 cordis.patch.yml 里那一行 `insert` 有个真实的包可以指向 —— DSH 的客户端模块系统扫描
 *      profile 各行，把声明了 `dsh.client` 的包的浏览器半边编进页面（和合并前两个插件同一个理由）。
 *   2. 声明本插件的设置（导出 Config）。宿主 0.1.7+ 从 profile 条目的 Config 派生设置命名空间，
 *      只暴露标了 `.volatile()` 的字段；命名空间名就是这一行的 id（claude-style-addons）。
 *      浏览器半边通过 configForms 服务读写它，值最后写进 profile 的 cordis.patch.yml。
 *      再用 `settings.configure({ auto: false })` 告诉宿主「我的设置页我自己画」—— 这几项画在
 *      皮肤的 Claude Style 设置页里，宿主不要再另外按 schema 生成一页。
 *
 * 和皮肤一样写得很保守：拿不到 schemastery、没有 settings 服务，插件都照常挂载，只是设置
 * 退回到浏览器本地缓存（功能本身不受影响）。宿主半边一旦抛错，浏览器半边也会跟着从页面上掉下去，
 * 所以这里任何一步失败都只记一条警告。
 *
 * @module dsh-claude-style-addons
 */

export const name = 'dsh-claude-style-addons'

/** 默认值 —— 和 client.js 的 PREFS_DEFAULT 是同一份（verify/settings.mjs 会对一遍）。 */
export const PREFS_DEFAULT = Object.freeze({
  greeting: true,
  greetingFont: 'pixel',
  mascotVariant: 'deepy',
  keepBalanceCard: true,
  deepseekInlineCode: true,
})

/**
 * 宿主自己用的那份 schemastery。
 *
 * 照抄皮肤 host/settings.js 的理由：本插件是 `link:` 装的，真实路径在 profile 目录外面，
 * 普通 import 找不到 profile 的 node_modules；宿主的 bin 旁边永远带着一份 schemastery，
 * 而且设置域校验表单用的正是那一份，所以先问它，普通解析留作兜底。
 * @returns {Promise<any|null>} schema 工厂；都解析不到返回 null。
 */
async function resolveSchemaFactory() {
  try {
    const { createRequire } = await import('node:module')
    const anchor = typeof process.argv[1] === 'string' && process.argv[1] !== '' ? process.argv[1] : process.execPath
    const factory = createRequire(anchor)('@deepseek-ai/schemastery')
    if (factory !== null && factory !== undefined && typeof factory.object === 'function') return factory
  } catch { /* 锚点旁边没有：试普通解析 */ }
  try {
    const module = await import('@deepseek-ai/schemastery')
    return module?.default ?? module?.Schema ?? null
  } catch {
    return null
  }
}

const Schema = await resolveSchemaFactory()

/** 标成「设置页可改」（旧版 schemastery 没有 volatile() 就原样返回）。 */
function volatileField(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field
}

/**
 * 本插件的设置（拆成 buildConfig 是为了让 verify 拿 profile 里那份 schemastery 也能造一遍）。
 * 字段类型故意宽松（string / boolean）：union 是靠「拒绝」来解析的，
 * profile 里留下一个旧值就会让整行解析失败。取值范围在浏览器半边的 normalizePrefs() 里收口。
 */
export function buildConfig(S) {
  return S.object({
    greeting: volatileField(S.boolean().default(PREFS_DEFAULT.greeting)),
    greetingFont: volatileField(S.string().default(PREFS_DEFAULT.greetingFont)),
    mascotVariant: volatileField(S.string().default(PREFS_DEFAULT.mascotVariant)),
    keepBalanceCard: volatileField(S.boolean().default(PREFS_DEFAULT.keepBalanceCard)),
    deepseekInlineCode: volatileField(S.boolean().default(PREFS_DEFAULT.deepseekInlineCode)),
  })
}

export const Config = Schema === null ? undefined : buildConfig(Schema)

/**
 * @param {any} ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const logger = ctx.logger?.(name) ?? console
  logger.info?.(`${name}: 已挂载（浏览器半边负责问候语、皮肤修补和设置页）`)
  if (Config === undefined) {
    logger.warn?.(`${name}: 没解析到 @deepseek-ai/schemastery，设置只能记在浏览器本地`)
  }
  if (typeof ctx.inject !== 'function') return
  // settings 服务可能比本插件晚挂上，所以声明式地等它。回调里什么都不返回 ——
  // 返回一个普通对象会抛 "Invalid effect"，把整个插件带下去（皮肤踩过）。
  ctx.inject(['settings'], (scope) => {
    const settings = scope.settings
    if (settings === undefined || settings === null || typeof settings.configure !== 'function') return
    try {
      scope.effect(() => settings.configure({ auto: false }, ctx.fiber), `${name}: settings presentation`)
    } catch (error) {
      logger.warn?.(`${name}: settings presentation unavailable: ${error?.message ?? error}`)
    }
  })
}
