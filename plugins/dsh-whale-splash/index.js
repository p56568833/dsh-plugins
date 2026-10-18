/**
 * dsh-whale-splash —— 像素风开场动画（宿主半边）：鲸鱼标拼好、等加载，主界面好了重组成
 * dsh-claude-style 正在用的那只吉祥物（Clawd 螃蟹 / Deepy），最后落回它的原位交班。
 *
 * 只做一件事：在宿主收集「页面注入行」时（`webserver/index-inject` 事件）交上四行：
 *   · style  开场样式
 *   · script（head）早脚本：判断这次是「打开」还是「刷新」，是打开就挂类名开演
 *   · html  （body）开场节点：一层纯色 + 一张 canvas
 *   · script（body）编排脚本
 *
 * 为什么不用 `webServer.tapIndex`：DSH 桌面版不经 web server 出 index.html（Electron 走 file:// + IPC），
 * 只会把这张「注入行」表通过 IPC 交给页面、由页面自己逐行执行 —— tapIndex 在桌面版上根本不跑。
 * 注入行在两边都生效：网页版由 web server 渲染进 index.html，桌面版由页面在启动时执行。
 * （桌面版要等宿主把这张表送过来才执行，所以开窗口时 DSH 自己的「HARNESS / Loading plugins…」会先露一下。）
 *
 * 不注册路由、不读写任何文件、不联网。停用插件，下次打开就是原样。
 *
 * 「只在打开时播」：看浏览器的导航类型 —— Cmd+R / 程序里 reload 都是 `reload`，跳过；
 * 打开 DSH 是一次全新导航，就播。
 *
 * 页面侧：assets/splash.css（样式）、assets/splash.js（编排）、assets/logo.svg（鲸鱼标）。改完要重启 DSH。
 *
 * @module dsh-whale-splash
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAME = 'dsh-whale-splash'
const ROOT = dirname(fileURLToPath(import.meta.url))

/** 早脚本：这次是刷新就什么都不做；是打开就挂类名开演。8 秒兜底，绝不卡住主界面。 */
export const EARLY = '(function(){var h=document.documentElement;'
  + 'if(window.__dwspEarly)return;window.__dwspEarly=1;'
  + 'try{var n=performance.getEntriesByType("navigation")[0];if(n&&n.type==="reload")return}catch(e){}'
  + 'h.classList.add("dwsp-boot","dwsp-hold");'
  + 'setTimeout(function(){h.classList.remove("dwsp-boot","dwsp-hold");var b=document.getElementById("dwsp");if(b&&b.parentNode)b.parentNode.removeChild(b)},8e3)})()'

const MARKUP = '<div id="dwsp" aria-hidden="true"><div class="dwsp-veil"></div><canvas class="dwsp-cv"></canvas></div>'

export function asset(name) {
  return readFileSync(join(ROOT, 'assets', name), 'utf8')
}

/**
 * 交给宿主的注入行（顺序要紧：样式 → 早脚本 → 节点 → 编排脚本）。
 * @param css - assets/splash.css
 * @param js - assets/splash.js
 * @param logo - assets/logo.svg（取它的 path 填进脚本，页面把它切成像素）
 */
export function rows(css, js, logo) {
  const path = (logo.match(/\sd="([^"]+)"/) || [])[1] || ''
  const script = js.replace("'%LOGO_PATH%'", () => JSON.stringify(path)).replace(/<\/script/gi, '<\\/script')
  return [
    { kind: 'style', text: css },
    { kind: 'script', placement: 'head', text: EARLY },
    { kind: 'html', placement: 'body', html: MARKUP },
    { kind: 'script', placement: 'body', text: script },
  ]
}

/**
 * 按网页版宿主的规则把注入行渲染进一份 HTML（head 行紧跟 <head>，body 行紧跟 <body>）。
 * 插件本身不用它，只给 verify.mjs 的自检和本地预览用。
 */
export function render(html, list) {
  const markup = (row) => row.kind === 'style' ? '<style>' + row.text + '</style>'
    : row.kind === 'script' ? '<script>' + row.text + '</script>'
      : row.html
  const head = list.filter((r) => r.kind === 'style' || r.placement === 'head').map(markup).join('')
  const body = list.filter((r) => r.kind !== 'style' && r.placement !== 'head').map(markup).join('')
  return html.replace(/<head(\s[^>]*)?>/i, (tag) => tag + head).replace(/<body(\s[^>]*)?>/i, (tag) => tag + body)
}

export const name = NAME

export default {
  name: NAME,
  apply(ctx) {
    const logger = ctx.logger?.(NAME) ?? console
    const table = rows(asset('splash.css'), asset('splash.js'), asset('logo.svg'))
    ctx.on('webserver/index-inject', (list) => {
      list.push(...table)
    })
    logger.info?.(`${NAME}: 像素鲸鱼开场已挂载`)
  },
}
