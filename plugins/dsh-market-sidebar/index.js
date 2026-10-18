/**
 * 服务端半边：什么都不做，只为让这个包在 Loader 里占一行。
 *
 * DSH 的客户端插件必须由 Loader 里的一行「激活」:客户端模块系统扫描 Loader
 * 各行，把声明了 `dsh.client` 的包的浏览器半边（./client）编进 boot graph 送到
 * 页面。所以这个空 apply 是必需品，不是一个可以删掉的空文件
 * —— `@deepseek-ai/dsh-client-ui-settings-plugins` 的说明里写的是同一件事。
 *
 * 真正干活的都在 client.js。
 *
 * @module dsh-market-sidebar
 */

export const name = 'dsh-market-sidebar'

/** 服务端零行为。 */
export function apply() {}
