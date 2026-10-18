# dsh-whale-splash

打开 DeepSeek Harness 时的**像素风**开场。整场画在一张 canvas 上，按 24 帧/秒一格一格地走，有 8-bit 的顿挫感：

1. **拼 logo**：DeepSeek 鲸鱼标被切成 28×28 的像素，一列一列从上面掉下来拼好，落地弹一下。按像素画上色：蓝身体、深蓝描边、白肚皮。下面的像素字 **deepseek** 一个字母一个字母打出来，后面跟着一个闪烁的方块光标。
2. **等加载**：logo 原地 8-bit 蹦跶，循环做「蓄力压扁 → 起跳拉长 → 落地再压扁」。四周冒方块泡泡，泡泡破成碎像素，还会闪十字星。
3. **变身**：主界面好了，logo 的像素炸开，绕一圈飞回来，重组成一只大号的 **Clawd**——dsh-claude-style 现在摆在输入框上沿的那只 Claude 像素小螃蟹。同时像素字从左到右蒸发：一颗颗往上飘、变小、变淡，最后消散。
4. **打招呼**：大 Clawd 原地蹦两下、吐一串像素泡泡，同时底色从中间往外碎成方块消失，露出主界面（这时已经能点了）。
5. **空翻**：大 Clawd 起跳，空中翻个跟头，带着拖影一路缩小，正好落在输入框上沿真 Clawd 的位置上，溅几颗像素水花，然后交班。

**开屏这只和输入框上沿那只是同一只**：帧图不另带一份，直接读页面上的真吉祥物（`.dsh-claude-crab` 螃蟹 / `.dsh-claude-deepy` 鲸鱼）写在身上的 CSS 变量——帧图地址、格子尺寸、这一帧在格子里的位置——用同一张图放大画大号，最后再缩回同一个格子上。所以风格天然一致，dsh-claude-style 以后换帧图也不用跟着改。

还有几条规则：

- **只在打开 DSH 时播**：Cmd+R 刷新不播，完全退出（Cmd+Q）再打开才会重播。
- **跳过**：点一下或按任意键，后面的戏 2.6 倍速快进。
- **兜底**：主界面迟迟不好，最多等 3.6 秒就开演。8 秒后无论如何都会撤掉开场层。
- **没装 dsh-claude-style、或者它把吉祥物关了 / 帧图读不到**：跳过变身和打招呼，logo 自己跳到输入框右上角，碎成像素散掉。
- **系统开了「减少动态效果」**：只摆一个静止的像素 logo，好了就淡掉。
- **深色 / 浅色**：底色跟着系统设置走。
- **不卡顿**：画面在后台线程里画（Web Worker + OffscreenCanvas）。DSH 启动时主线程忙着解析、执行插件包，开场动画不会跟着卡。浏览器不支持、或 Worker 被拦时，自动退回主线程照跑。

预览：双击 `preview/index.html`。这是一个模拟的 DSH 界面，输入框上沿摆着一只静止的 Clawd（真帧图）。打开预览每次都会重播。

## 安装 / 卸载

- 安装：双击 `安装.command`。它会做两件事：
  1. 在 `~/.dsh/profiles/desktop/package.json` 里加一行 `"dsh-whale-splash": "link:…/DSH插件/dsh-whale-splash"`，改之前先备份；
  2. 跑一次 `dsh plugin --profile desktop install --offline`，让 DSH 自己建链接、加进插件列表。

  装完后完全退出 DSH 再打开。
- 卸载：在 DSH 插件页停用它，或者双击 `卸载.command`。
- 这个文件夹别挪也别改名，profile 是通过 `link:` 指向这里的。

## 改坏了想换回来

2026-10-18 大改（Deepy → Clawd、修落点）之前，整份原版备份在：

- `DSH插件/dsh-whale-splash-备份-20261018-000825/`（插件旁边，肉眼可见）
- `~/.dsh/backups/whale-splash-20261018-000825/`（同一份）

双击插件里的 **`回滚.command`** 就会把最近那份备份盖回来（只覆盖备份里有的文件，不删新文件），然后完全退出 DSH 再打开即可。想回滚到别的版本，把文件夹名给它也行：`./回滚.command 备份目录`。

## 怎么接上的

不改 DSH 本体，也不改 dsh-claude-style：

- **宿主半边**（`index.js`）：在宿主收集页面注入行时（`webserver/index-inject` 事件）交上四行，依次是样式、早脚本、开场节点（一层纯色 + 一张 canvas）、编排脚本。
  - 网页版：web server 把这四行渲染进 index.html，页面一开始解析就跑。
  - 桌面版：Electron 走 file:// + IPC，不经过 web server，页面拿到注入表后逐行执行。所以开窗口时 DSH 自己的「HARNESS / Loading plugins…」会先露一下，紧接着被开场盖住。
  - 不注册路由、不读写文件、不联网，也不依赖任何服务。鲸鱼标的形状取自 `assets/logo.svg`。
- **「打开」还是「刷新」**：看浏览器的导航类型。Cmd+R 是 `reload`，跳过；打开 DSH 是全新导航，就播。
- **落点**：找 `.dsh-claude-crab[data-ready]`（没有就 `.dsh-claude-deepy[data-ready]`），读它身上的 CSS 变量：`--dsh-claude-crab-x/y/w`、`--dsh-claude-mascot-h`、`--dsh-claude-crab-cell-w`、`--dsh-claude-crab-strip-h`、`--dsh-claude-crab-sheet`（螃蟹还有 `--dsh-claude-crab-ink`）。元素框宽 ÷ 52 就是一格几 px，身体在 52 格网格里的位置照样搬，所以大 Clawd 缩到一格 2px 时和真 Clawd 一像素不差。
- **交接**：开场期间 `html.dwsp-hold` 只把真吉祥物的 `opacity` 压成 0，不碰它自己的 `visibility` 和 `data-ready`。落地那一格撤掉这个类，真 Clawd 就接着演它自己的动画。

## 想自己调

| 想改 | 改哪里 |
|---|---|
| 各段时长、起跳高度、像素大小、帧率 | `assets/splash.js` 里 `ENGINE` 开头的常量（`ASSEMBLE_MS`、`HOP_MS`、`MORPH_MS`、`CHEER_MS`、`JUMP_MS`、`LIFT`、`CELL`、`TICK`…） |
| 像素字的内容、字形、大小、打字速度 | `WORD`、`GLYPHS`、`TEXT_CELL`、`TYPE_AT` / `TYPE_STEP` |
| 空翻转几圈 | `assets/splash.js` 里 `jump` 段的 `var rot = j * Math.PI * 2` |
| logo 的颜色 | `BLUE`、`NAVY`、`WHITE`、`FOAM` |
| 底色（浅 / 深） | `assets/splash.css` 的 `--dwsp-canvas` |
| 底色碎块大小 | `BLOCK` |

改完跑 `node verify.mjs`（自检，并重新生成预览），再重启 DSH。
