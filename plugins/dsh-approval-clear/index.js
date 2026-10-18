/**
 * dsh-approval-clear —— 宿主半边。
 *
 * 真正干活的都在浏览器里（client.js）。宿主半边只做一件事：让 cordis.patch.yml
 * 里那一行 `insert` 有个真实的包可以指向——DSH 的客户端模块系统会扫描 Loader 各行，
 * 把声明了 `dsh.client` 的包的浏览器半边编进页面。
 *
 * 与 dsh-todo-bar 同样的取舍：这里零行为、零设置项。审批卡片是"显示器"，
 * 它不该有自己的开关状态需要持久化——出问题就在插件页停用整包，比留一个
 * 半开的开关更好排查。
 *
 * @module dsh-approval-clear
 */

export const name = 'dsh-approval-clear'

/** 宿主零行为。 */
export function apply() {}
