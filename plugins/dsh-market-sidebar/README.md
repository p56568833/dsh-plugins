# dsh-market-sidebar

在 DSH 侧边栏 **插件** 那一行下面，加一行 **插件市场**：点一下，中间主区域直接就是
设置里那块一模一样的市场面板（发现 / 主题 / 收藏 / 已安装 / 高级 / 任务 / 评论），
不用再 `设置 → 插件市场`。

**它和市场插件 dshmarket 是两个独立的包**：升级/重装 dshmarket 不会碰它，
所以不会再有「更新完市场插件，入口又没了」这件事。

## 它怎么工作（没有改任何别人的文件）

| 登记 | 槽位 | 说明 |
| --- | --- | --- |
| `{id:"market", order:1}` | `sidebar.panellist`（DSH 本体的侧边栏平级列表） | 「插件」那一行就是 `{id:"plugins", order:0}`，所以 1 = 紧跟在它下面 |
| `{key:"market"}` | `main`（DSH 本体的键槽） | 侧边栏点击后主区域挂载面板 |
| `market.setSettingsVisible(false)` | dshmarket 自己暴露的控制面 | 把设置里那份隐藏掉，入口只留侧边栏这一处；本插件被关掉时自动放回去 |

面板本体**不自己画**：dshmarket 暴露了 `market.render()` —— 把整块市场面板交给宿主
容器的接口（它自己注释里写明是给「宿主 shell 自己渲染市场」准备的，issue #602）。
本插件拿到服务后每帧调 `render({})`，所以市场长什么样、有哪些子页、怎么改版，
全由 dshmarket 自己决定 —— 市场插件升级，这个包一行都不用改。

`market` 用**嵌套** `ctx.inject(['market'], …)` 等，**不放在顶层 inject 里**。
这不是风格问题：DSH 的 web 启动审计要求每个 Loader entry 最终都是 active，
任何顶层必需依赖等不到服务的 entry 都会让整个界面启动失败
（`web boot: N entry did not activate` → 桌面端判 fatal，见
[`../dsh-image-gen-web-boot-fix/README.md`](../dsh-image-gen-web-boot-fix/README.md) 的真实案例）。
嵌套写法下，dshmarket 不在时本插件照样 active、只是什么都不登记：侧边栏不会凭空多一行，
设置里那份也原样留着。`verify.mjs` 的「反向 A」专门守这条。

图标用的是市场自己的品牌标记（8 格 + 斜插一块），几何数字抄自 dshmarket 的
`src/client/market-mark.ts` —— 那个组件是它 bundle 的内部实现、不对外导出，所以按同一份
几何重画了一次，好让侧边栏这一行和设置里那一行看起来是同一个东西。

## 账号与余额（2026-09-27 加）

侧边栏 **订阅** 下面多一行 **账号与余额**：点一下，主区域就是设置里第一栏那块账号页
（头像/手机号、充值余额、赠金余额、查询用量、充值），不用再点头像 → 设置。

| 登记 | 槽位 | 说明 |
| --- | --- | --- |
| `{id:"account-balance", order:3}` | `sidebar.panellist` | 插件 0、插件市场 1、订阅 2，所以 3 = 订阅下面 |
| `{key:"account-balance"}` | `main` | 面板从槽位账本里取出 DSH 账号插件登记在 `settings.section`（id `account`）的组件，按槽位运行时的规则拼好 props（`hooks.xxx`→`useXxx`、`t`）后直接渲染 |

- 账号页**不自己画**，是 `@deepseek-ai/dsh-client-ui-settings-account` 自己那块，余额格式、按钮、登录态都跟着 DSH 走；
- 每次打开这一页会读一次最新余额（和打开设置时一样）；
- 不能用 `renderSlot` 渲染：DSH 只允许一行渲染自己声明过的子槽，越界抛 `SlotOwnershipError`（第二版踩过，渲出一片空白）；
- 没登录时账号插件不登记那一栏，这里显示一句提示和「在设置里打开」；
- 渲染出错只影响这一块，会换成「在设置里打开」按钮；
- 设置里那份原样保留，没有被隐藏；
- 这一行不依赖 dshmarket，市场插件不在也照样出现。

改之前的文件备份在 `../_备份与存档/dsh-market-sidebar/before-account-20260927/`。

## 安装

这个 profile（desktop）由桌面 App 独占管理，`dsh` 命令行会直接拒绝
（`profile "desktop" is managed exclusively by the Electron application`），
所以安装走 App 自己的插件管理器：

1. 左侧点 **插件**（不是「插件市场」）；
2. **添加插件** → 填这个包所在目录的**绝对路径**：

   ```
   /Users/andychen/Desktop/有趣的东西/DSH插件/dsh-market-sidebar
   ```

3. 安装 → 完成后点 **立即启用**。

App 的安装器会自己跑 pnpm、写 `pnpm-lock.yaml`、把 `dsh-market-sidebar` 加进 profile 的
`dsh.profile.bundles`，不需要手工编辑配置。

装完侧边栏就会出现「插件市场」（清单变化会触发热重组合，通常刷新页面即可；
没出现就 ⌘Q 重开 App）。

> 包目录**别移动/删除**：本地路径安装是 `link:` 到工作区里这个目录的
> （和 profile 里已有的 `dsh-cost-balance` 一个做法），目录没了插件就加载不了。

## 验证

```bash
node verify.mjs
```

不启动 GUI，按 DSH 真会做的那样跑六项：

- `package.json` 的 `dsh.client` 声明按 DSH 自己的校验规则核对（规则抄自随包的
  `dsh-client-modules` 的 `parseDshClient`：`platform` 必须字符串、
  `inject`/`external` 必须字符串数组、`immediately` 必须布尔、
  `exports["./client"]` 必须存在）；
- `cordis.patch.yml` 的 insert 行指向本包；
- `client.js` 能编译，工厂导出的 cordis 插件带 `name` / `inject` / `apply`；
- 用 app.asar 里随包的**真** `SlotCore` 当槽位表（先按 DSH 的顺序声明
  `root` / `sidebar` / `sidebar.panellist` / `main` 并登记「插件」那一行），
  跑 `apply(ctx)` 后确认：`sidebar.panellist=[plugins, market]`、`order=1`、
  标签中英跟随、`main` 里有 `key=market`；
- 图标与面板能构造 React 元素，且面板里正是 `market.render()` 给的那块；
- **反向**：`market` 服务不在时一行都不登记（只留 console.warn）。

实测输出：

```
✅ package.json 的 dsh.client 声明符合 DSH 自己的校验规则
✅ cordis.patch.yml 的 insert 行指向本包
✅ client.js 可编译，并且工厂导出了 cordis 插件
✅ 市场服务在时：登记出「插件」下面的一行 + 对应的 main 面板
     sidebar.panellist=[plugins, market]，main keys=[market]，label=「插件市场」/「Plugin Market」
✅ 图标与面板能构造 React 元素，面板里是 market.render() 给的那块
✅ 反向：市场服务不在时一行都不登记
```

## 卸载

在 **插件** 页里移除 `dsh-market-sidebar`（App 会连带清掉 profile 里的依赖和 bundle 行）。

## 和 `dsh-market-sidebar-patch` 的关系

工作区里另一个目录 `dsh-market-sidebar-patch` 是更早的做法：直接给 dshmarket 已构建的
`client.js` 打补丁。它每次 dshmarket 升级都会被覆盖，**现在只是备用/回退方案**，
当前已还原成原文件。

**不要同时用两套**：两边登记的都是 `id: "market"`，同时生效会让后登记的那个抛
「list slot already has an entry with id "market"」，进而把市场插件自己的
apply 弄失败。
