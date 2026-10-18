/**
 * 服务端半边：什么都不做，只为让这个包在 Loader 里占一行。
 *
 * DSH 的客户端插件必须由 Loader 里的一行「激活」：客户端模块系统扫描 Loader 各行，
 * 把声明了 `dsh.client` 的包的浏览器半边（./client）编进 boot graph 送到页面。
 * 真正干活的都在 client.js。
 *
 * @module dsh-todo-bar
 */

export const name = 'dsh-todo-bar'

/** 服务端零行为。 */
export function apply() {}
