# dsh-cost-balance

在输入框下方那一行状态里（现有 `2 轮 2 步 | 耗时 | 缓存命中 | 输入/输出 token` 的下面）再补一行：

```
本次消费 ¥1.2043 ｜ 余额 ¥17.21
```

鼠标悬停可以看明细：模型、高峰/空闲时段价、余额实扣的算式、三个计费桶各自的 token 数与单价。

- **本次消费**：本次对话的累计花费，默认显示**余额实扣**（官方口径，见下），拿不到余额时回退到 token 估算。
- **余额**：这个 DeepSeek API key 账户的实时余额，每 60 秒刷新一次。

## 本次消费 = 余额实扣（主口径）

DeepSeek 的 API **不返回任何金额字段**——`usage` 里只有 token（`inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `totalTokens`，我用这段对话的会话日志逐条核对过，官方文档的 schema 也一样）。整个 API 里跟钱有关的只有一个接口：`GET /user/balance`。

所以"官方口径的钱"只能这样算：

```
本次消费 = 这段对话开始时的余额 − 现在的余额
```

实现细节：

- 每个对话的**起始余额**记在浏览器的 `localStorage`（键 `dsh-cost-balance/wallet-baselines.v1`），所以刷新页面、甚至过一会儿再回到这个对话，都从同一个起点继续算。
- 插件从对话第一个 token 就在场时，起点是真实余额；**对话早于插件存在**时（比如这次安装），起点用"当前余额 + 已经算出来的 token 估算"来播种 —— 数字会从估算值起步，然后跟着余额走。
- 余额**异步结算**，所以这个差值会滞后地追上来；差值还停在 0 而 token 已经在烧时，界面上会写 `（结算中，token 估算 ¥x）`，不会让你以为是坏了。
- 这个口径天然包含这次对话派生的子代理等消耗，但也会把同一时间段里**其它会话**的消耗一起算进来。

## token 估算（兜底与对照）

拿不到余额时（或余额刚失败），这一行回退到 token 估算；估算值也写在悬停明细里做对照。它由浏览器半边直接从会话的 `tokenUsage` 持久投影（整段对话的权威累计值，不受分页/压缩影响）折算，不额外发请求：

```
花费 = 缓存未命中输入 token × 未命中单价
     + 缓存命中输入 token × 命中单价
     + 缓存写入 token   × 未命中单价   （DeepSeek 目前恒为 0）
     + 输出 token       × 输出单价      （思考 token 已含在输出里，不再加）
```

单价来自官方价格页，写在 [`prices.js`](./prices.js) 里（宿主半边把整张表原样发给浏览器半边，**改价格只需要改这一个文件**）：

| 模型 | 缓存命中 | 缓存未命中 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash` | ¥0.02 / ¥0.04 | ¥1 / ¥2 | ¥4 / ¥8 |
| `deepseek-v4-pro` | ¥0.15 / ¥0.30 | ¥4.5 / ¥9 | ¥13.5 / ¥27 |

（空闲时段 / 高峰时段，单位：元 / 百万 token。空闲价是高峰价的一半。）

**时段判定规则（这里是坑）**：只有"北京时间周一至周五 09:00–12:00、14:00–18:00 **且不是中国法定节假日**"才按高峰价；其余一切情况——周末、调休上班的周末、**以及法定节假日全天**——都按空闲价。节假日不是"落在高峰窗口里才免费"，而是**整整一天都算空闲**。

> 这个插件第一版漏了假期表，只按"工作日 + 时段窗口"判断。结果 2026-09-25（周五，**中秋节**，法定节假日）这天，所有数字都被算成高峰价，**整整高估一倍**——用户看到的"本次消费 ¥4.5"里有 ¥2.25 是凭空多出来的。现在 [`prices.js`](./prices.js) 里的 `HOLIDAYS` 带上 2026 年全年的法定假日（来自[国务院办公厅关于2026年部分节假日安排的通知](http://society.yunnan.cn/system/2025/11/04/033713397.shtml)），并且浏览器半边也内置同一份（这样**只刷新页面**就能修正，不用重启 Harness）。DeepSeek 对"调休上班的周末"同样按空闲计费（[IT之家报道](https://www.ithome.com/0/100/4494.htm)），所以周末统一算空闲即可。

⚠️ **假期表需要每年更新**：`HOLIDAYS` 目前覆盖 2026 年（`HOLIDAY_CALENDAR_YEAR = 2026`）。每年 11 月国务院公布下一年安排后，把新日期补进去、把年份改掉即可；这一年没覆盖到的日期会按普通工作日算，可能高估一倍。

时段切换时**不会**把已经算过的钱按新单价重算：切换点会把已计费用冻结进总数，之后的增量按新单价累加。时段由**浏览器半边**判定（宿主把 `tariffPolicy` 随请求下发，浏览器据此计算，切换时机因此精确到秒而不是等下一次轮询）；宿主算的 `tariff` 字段只用于终端调试。

## 余额从哪来

宿主半边用 `ctx.credentials` 解析凭证引用 `DEEPSEEK_API_KEY`，再调用官方账户接口：

```
GET https://api.deepseek.com/user/balance
Authorization: Bearer <key>
→ { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
```

- 结果缓存 30 秒，失败时保留上一次成功的读数，不会把余额显示成 0。
- API key 只在宿主进程内使用，**永远不会**出现在返回给页面的 JSON 里（`test.host.mjs` 里有断言）。
- 想换凭证引用，改 [`prices.js`](./prices.js) 里的 `API_KEY_REF`。

## 接线方式

| 半边 | 文件 | 作用 |
| --- | --- | --- |
| 宿主 | [`index.js`](./index.js) | 注册同源 GET 路由 `/cost-balance/state`（余额 + 当前模型 + 时段 + 价格表），只接受 loopback 的 Host，非 GET 返回 405 |
| 浏览器 | [`client.js`](./client.js) | 手写 bundle（`window.__ModuleLoader__.load({id, factory})` 闭包工厂格式，无需构建），向 `conversation.composer.dock` 槽注册 `id: cost-balance`、`order: 10` 的条目 |
| 共享 | [`prices.js`](./prices.js) | 单价表、时段规则、凭证引用、余额接口地址 |

生命周期由 cordis 管理：宿主用 `ctx.effect(() => ctx.webServer.register(...))` 注册路由，插件卸载时路由自动摘除。

## 排版：三个条目紧挨着居中

输入框下面那个 dock 容器（运行版 CSS：`display:flex; justify-content:center; gap:12px`）里其实住着三个东西：

| 顺序 | 内容 | 归属 |
| --- | --- | --- |
| 1 | 会话统计药丸（`1 轮 N 步` / 耗时 / 用量，运行版渲染的是 `StatsPills`） | 官方 `dsh-client-ui-chat` |
| 2 | `本次消费 ¥x ｜ 余额 ¥y` | 本插件 |
| 3 | 上下文占用环 + 百分比（`ContextMeter`） | 官方 `dsh-client-ui-conversation` |

它们本来是"左中右"三分：容器里第 2 个条目（本行）原来带 `width:100%`，flex 会按 100% 基准给它撑满，于是把左边的统计挤到省略号、自己居中、占用环推到最右。

现在改成三个都按内容宽度排：本行是 `flex:none; width:auto`，并用运行时标记的 `data-dsh-cost-dock` 属性把容器上其它子元素一起改成 `flex:0 0 auto; width:auto; overflow:visible; text-overflow:clip`，于是三者紧挨着居中，最左边那条也完整显示、不再出省略号；窗口太窄时整行换行，而不是截断。

为什么用属性标记而不是类名：官方那个容器的类名是构建期哈希出来的 CSS Module 键（当前是 `QJwAZG_dock`，升级后会变），插件只能从 DOM 侧找"最近的 row 方向 flex 祖先"再打标记，这样升级也不会失效。

## 插件页里显示的名字：`locale/<lang>.json`

设置 → 插件 / 已安装列表里那一行的**标题与描述**，来源是**插件展示元信息（Plugin display metadata）** —— 包内一个 `locale/<lang>.json`：

```json
{ "meta": { "title": "消费与余额", "description": "实时显示本次对话消费与 API 账户余额；…" } }
```

宿主侧的读取入口是 `readPluginMeta(specifier, parentURL)`（`@deepseek-ai/dsh-app-boot` 导出，服务面是 `ctx.pluginPackages.metaOf()`）。它**不导入、不激活插件**，只按 Node 解析规则找到文件读文本。v0.1.7-rc.2 的实现：

```js
const englishPath = optionalResourcePath(`${specifier}/locale/en.json`, parentURL);
const dictionaries = dictionariesOf(englishPath, specifier, parentURL);  // 同目录其它 .json 按文件名当语言
const title       = localizedText('title',       dictionaries, manifest?.name, specifier);
const description = localizedText('description', dictionaries, manifest?.description, '');
```

### 三个必踩的点

| 点 | 说明 |
| --- | --- |
| 锚点必须是 `locale/en.json` | 这个文件**必须存在**，`zh.json` 是从**同一目录**发现的（文件名即语言码）。只放 `zh.json` 不会被读到。 |
| 路径必须走 **Node `exports`** | 这些包都有 `exports` 映射，会**封装**包内路径。必须显式加 `"./locale/*.json": "./locale/*.json"` —— 否则文件在、却解析不到。 |
| 可以只补一个字段 | 缺 `title` 才回退到 `package.json.name`，缺 `description` 才回退到 `description`。所以只汉化标题、保留作者原文描述是可行的。 |

返回值是**多语言对象**，由 Client 按界面语言选：

```jsonc
{
  "title":       { "en": "Cost & Balance", "zh": "消费与余额" },
  "description": { "en": "Live spend and API balance…", "zh": "实时显示本次对话消费与…" }
}
```

`package.json.icon` 也走同一套读取（相对清单、realpath 后仍在包内、SVG/PNG/JPEG/WebP、≤256 KiB），读成 data URL 给卡片用。

### 为什么不是别的做法

- **包名不能用中文**：pnpm 直接拒绝非 ASCII 名 —— `[ERR_PNPM_INVALID_DEPENDENCY_NAME] Refusing to place a dependency … with the invalid alias "消費餘額"`。但把包名改成拼音（如 `dsh-xiaofei-yue`）是一条**错的路**：没必要，还要同步改 `cordis.patch.yml` 的条目名和 `client.js` 里 `__ModuleLoader__.load({ id })` 的 id。
- **`package.json` 里写 `title` / `displayName` 没用**：`readPluginMeta` 只认 `name` / `description` / `icon`，不认这两个字段。本文件早先的实验只测了这两个字段，因此得出了"唯一办法是改包名"的**错误结论**（已在本节更正）。

### 验证方法

别靠肉眼看界面 —— 直接调官方那个函数。用 Electron 当 node 跑：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  ../dsh-plugin-locale-zh/verify-meta.mjs dsh-cost-balance
```

输出里的 `title` / `description` 多语言对象，就是宿主实际拿到的那一份；拿它跟界面逐字对照，不会有解释空间。

## 自检

```sh
cd ~/Desktop/有趣的东西/DSH插件/dsh-cost-balance
node test.mjs        # 浏览器半边：注册形状、单价查找、时段累加、压缩收缩下限、格式化
node test.host.mjs   # 宿主半边：路由契约、loopback 栅栏、方法门、余额映射、故障降级、释放

curl -s http://127.0.0.1:19387/cost-balance/state | python3 -m json.tool
```

`curl` 返回里的 `client.build` 是**当前页面实际加载的浏览器半边版本号**（`client.js` 顶部的 `BUILD` 常量，改动该文件后请一并 +1），用来确认页面跑的到底是哪一版。

## 已知边界

- **主口径是余额实扣，余额是异步结算的**：DeepSeek 的账户扣费不是即时的——实测在完全没有模型调用、全部 66 个会话日志的 token 总量一个字节都没变的 200 秒里，余额仍然下降了 ¥0.23。所以"余额实扣"会滞后地追上来（差值先偏小），界面上用 `（结算中，…)` 标出来。
- **token 估算只统计本会话**：子代理会各自写一份会话日志，不并入估算值；会话标题生成、联网搜索的模型调用也不在会话日志里。估算值只作为兜底和对照（余额实扣天然包含这些）。
- **余额实扣会把同期其它会话也算进来**：它是钱包口径的差值，同一时间段里别的窗口/子代理花的钱也在里面。
- 会话里如果中途换过模型，token 估算会把整段用量按**当前**模型的单价折算。
- token 估算的累计基线在内存里，刷新后从"当前读数按当时单价折算"重新起算；余额实扣的起点则持久保存（localStorage），刷新不丢。
- 页面加载时余额会先显示"余额读取中…"，读失败显示 `余额读取失败`；这时消费数字回退到 token 估算。

## 卸载

```sh
# 在 GUI 的 设置 → 插件 里停用，或：
cd ~/.dsh/profiles/desktop && pnpm remove dsh-cost-balance
```

（该插件已作为 bundle 装进 `desktop` profile：`package.json` 的 `dependencies` 与 `dsh.profile.bundles`，所以 `pnpm remove` 或插件页的卸载会同时清掉依赖和激活层。）
