# dsh-balance-widget-patch — 余额卡片补丁

给第三方插件 [`dsh-balance-widget`](https://github.com/LL-cmyk-so/dsh-balance-widget)（0.6.3）打的**本机补丁**，做成一个独立插件：

1. **「余额 ⇄ OpenCode Go 额度」模式切换** —— 侧栏底部那张卡片的弹层顶部多一个小切换按钮。切到「额度」后卡片不再显示 DeepSeek 的 ¥ 余额，也不再显示 Go 额度的美元数字，改为**已用百分比 + 绿色进度条**：弹层里三档（5 小时 / 本周 / 账期）各是「标签 … 16%」加一条绿色进度条（进度条右侧是小字的重置倒计时），底下再补一行「今日已用 ¥x.xx」（读今日所有工作区的费用合计）；侧栏那张卡片本身则在 5 小时额度上显示百分比 + 一条迷你进度条。
2. **补丁自愈** —— 补丁以成品文件（`payload/`）随本包发布。`dsh-balance-widget` 被重装或更新后，`node_modules` 里的文件会被换回官方原版，本插件会在启动时 / 安装事件后 / 每 10 分钟巡检一次，把成品文件写回去。**上游发新版也不会被静默覆盖**：文件指纹既不是官方原版、也不是我们自己的成品时，插件一概不碰，只把状态记下来。
3. **Go 额度接口** —— 注册 `GET /api/dsh-quota/go`（仅回环地址可访问），用本机凭据里的 `OPENCODE_GO_API_KEY` 读官方订阅状态 `GET /console/api/go/status`（和 Console 网页同一接口、同一口径：三条窗口的起点 / 重置时刻 / 上限 / 已用都由官方给）；读不到才退回用量接口 + 本地推算。

---

## 装了什么

| 位置 | 内容 |
| --- | --- |
| `payload/lib/index.js` | dsh-balance-widget 0.6.3 + 原有补丁（Windows 会话目录、会话锚定、子代理成本） |
| `payload/lib/client.js` | 同上 + 额度模式界面（切换按钮、额度行、文案） |
| `patches/dsh-balance-widget-0.6.3.patch` | 上面两份相对 npm 官方 0.6.3 的统一 diff（给人看 / 给人 rebase） |
| `targets.json` | 官方原版（`pristine`）与旧成品（`previous`）的 SHA256；决定"什么情况下才允许写回" |
| `index.js` | 自愈 + `/api/dsh-quota/go` + `/api/dsh-quota/status` + `/api/dsh-quota/probe` |
| `tools/verify.mjs` | 自检：payload / targets.json / patch 不许漂移；补丁打到官方原版上必须逐字节还原 payload |
| `tools/quota-selftest.mjs` | 自检：官方 `access.meters` 翻译成三条窗口（离线用例）；加 `--live` 再真打一次官方接口 |
| `tools/build-patch.mjs` | 由官方原版 + payload 重新生成 `patches/*.patch` |
| `tools/profile.mjs` | 把本插件登记进 / 移出 profile（改 `dependencies` 与 `dsh.profile.bundles`，改前备份） |

界面在**被补的那个插件**里（`payload/lib/client.js`），本插件**没有** client 半边 —— 浏览器侧不需要额外模块。

## 安装

```powershell
# 1) 登记进 profile（会先备份 package.json）
node tools/profile.mjs add --profile desktop
# 2) 落 node_modules 的 junction
dsh plugin --profile desktop install
```

然后在 DSH 里把本插件**重新应用一次**（插件页开关一下，或重启桌面版）让 host 半边进进程；`dsh-balance-widget` 的 client 半边由 client-hmr 自动热重载，**不需要刷新页面**（首次把新 bundle 带进浏览器时才需要 Ctrl+R）。

补丁本身不用手动打：插件启动后 2.5 秒会自己比对并写回。想手动确认：

```powershell
# profile 目录下的 node_modules 最近一次巡检的结果
curl.exe -s http://127.0.0.1:63676/api/dsh-quota/status
# 加 ?fresh=1 = 现场立刻重扫一遍（默认返回的是最近一次巡检的快照，最长可能差 10 分钟）
curl.exe -s "http://127.0.0.1:63676/api/dsh-quota/status?fresh=1"
# Go 额度三条窗口
curl.exe -s http://127.0.0.1:63676/api/dsh-quota/go
```

`status` 的取值：`ok` / `degraded`（有文件缺成品）/ `file-missing`（目标文件不见了）/ `unknown-version`（既非官方原版也非我们的成品，**一个字节都没动**）/ `version-mismatch`（上游换版本号了）/ `no-profile`（认不出自己在哪个 profile，宁可不修）/ `no-targets` / `error`。

> 提示：日志与这些 JSON 都是 UTF-8。用 Windows PowerShell 5.1 的 `Get-Content` 直接看会乱码，那是控制台编码问题，不是文件坏了；用 `pwsh` 或按字节 UTF-8 读。

## 配置

写在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的 `- id: balance-widget-patch` 下面（桌面版默认已给 `goMode: quota`）：

```yaml
- id: balance-widget-patch
  name: dsh-balance-widget-patch
  config:
    goMode: quota            # 卡片默认档：balance | quota（弹层切换会记住用户选择，盖过这里）
    goBaseURL: https://opencode.ai
    goApiKeyEnv: OPENCODE_GO_API_KEY
    goConsoleLive: true      # true = 账期实时读 Console 账单（下面两个 goPeriod* 只当兜底）
    goPeriodStart: ""        # 兜底：账期起点（ISO）
    goPeriodEnd: ""          # 兜底：真实续费日（ISO）。过了就按月往前滚，不用改配置
    goFiveHourResetAt: ""    # 仅兜底：读不到官方接口时 5 小时窗口的锚点（会漂，别手填）
    goOAuthTokenFile: ""     # 空 = ~/.dsh/balance-widget-patch/oauth.json
    goOAuthClientId: ""      # 令牌文件里没写 client_id 时用它 refresh
    goFiveHourLimitUsd: 16   # 仅兜底：/usage/models 的价目表价 ≈ 官方折后价 × 4/3
    goWeekLimitUsd: 40       #   官方 go-v1 meters 是 $12 / $30 / $60，go-plus 是 $48 / $120 / $240
    goMonthLimitUsd: 80      #   能读 /console/api/go/status 时这三行不参与计算
    requestTimeoutMs: 8000
    autoHeal: true           # false = 关掉自动写回，只保留额度接口
```

额度口径（**以官方接口为准**，下面第 1 条是主路径，后三条只在读不到官方接口时兜底）：

- **官方订阅状态**：`GET /console/api/go/status`（Bearer `OPENCODE_GO_API_KEY`，推理密钥就能读）返回
  `access.meters.{fiveHour,week,month}`，每条带 `startsAt` / `resetsAt` / `limitMicroCents` / `usedMicroCents`。
  `/api/dsh-quota/go` 的 `source` 会是 `console-go-status`，三条窗口的 `anchor` 是 `official-go-status`。
  官方 `usedMicroCents` 是 Go 折后价（1 USD = 1e8 micro-cents），百分比 = 已用 / 上限，和网页上的「% used」同值。
- **5 小时窗口**：官方口径是**从第一次使用起算 5 小时**（Console 字段名 `fiveHoursFromFirstUse`），
  不是「锚点 + 5h×k」的固定接力链 —— 窗口终点只有官方知道，所以**不再自己推**。
  早期版本按固定锚点推，会出现「网页还剩 33 分钟、卡片显示还剩 3 小时 20 分」这种错位（2026-10-19 修）。
- **本周**：UTC 日历周（周一 00:00Z 起算），官方给的就是这个边界。
- **账期（月）**：起点来自 Console 账单（见下一节），官方 `month` 只给 `resetsAt`，没有 `startsAt`。
- **兜底路径**（`source: "console-api"`，响应里带 `officialError` 写明原因）：已用金额来自
  `https://opencode.ai/console/api/usage/models?since=<ISO>` 的 `totalCostMicroCents` 汇总；上限用
  `go*LimitUsd`，5 小时窗口用 `goFiveHourResetAt` 锚点推或退回「最近 5 小时」——这条路径会偏，只是别让卡片空掉。

## 账期实时读取与令牌（2026-10-18 加）

账期起点/终点直接读 Console 的账单记录：

```
GET /console/api/billing/payment-attempts        （Bearer <OAuth 令牌>）
→ 最新一笔成功的 go_initial / go_renewal / go_upgrade 的
  lifecycleAppliedAt（或 settledAt / paidAt）= 本账期起点，终点 = 下月同日
```

续费会产生新的 `go_renewal` 记录，所以**不需要人工维护**。`/api/dsh-quota/go` 的 `period.source`
会写 `billing-period-live`（实时）或 `billing-period` / `utc-month`（兜底），`period.live` 写明实时那一路的结果
（`console-billing` = 成功；`no-token` / `disabled` / `attempts-403` … = 失败原因）。

**窗口数字现在能直接读了**（2026-10-19 实测）：`GET /console/api/go/status` 用**推理密钥**
（`oc_sk_…`）就能返回，不必是浏览器会话；`access.meters` 里三条窗口的起点 / 重置时刻 / 上限 / 已用全都有。
（`internal/orgs/<id>/go/status` 与 `billing/drawer/*` 仍旧只认浏览器会话：推理密钥 403，2026-10-18 实测。）
所以主路径是照抄官方数字，只有这个接口失败时才退回「用量接口 + 本地推算」。

### 令牌怎么来（device flow，一次性）

1. 注册一个本地公共客户端（RFC 7591，无密钥、可随时撤销）：
   `POST https://opencode.ai/console/auth/oauth/register`
   → `client_id`
2. 取设备码：`POST https://opencode.ai/console/auth/device/code`
   `{client_id, scope, supports_org_scope}` → `user_code` + `verification_uri_complete`
3. 浏览器打开链接批准（`user_code` 10 分钟内有效）。
4. 换令牌：`POST https://opencode.ai/console/auth/device/token`
   `{grant_type:"urn:ietf:params:oauth:grant-type:device_code", device_code, client_id}`
5. 把响应连同 `client_id` 存成 `~/.dsh/balance-widget-patch/oauth.json`（0600）。

令牌 30 天有效；过期时插件用 `refresh_token` 自动续（`POST /console/auth/oauth/token`，
`refresh_token` 会轮换并原子写回同一个文件）。不想要了就吊销：把该 `client_id` 从 Console 撤掉，
或把 `goConsoleLive` 设成 `false`（插件退回手工配置，不报错）。

## 自愈怎么判定

对 `targets.json` 里每个文件比 SHA256：

| 装的那份是 | 动作 |
| --- | --- |
| 我们的成品（payload） | 什么都不做 |
| npm 官方原版（pristine） | 写回成品（`lib/client.js` 约 0.5s 热重载；`lib/index.js` 要重启 DSH 才生效，插件会写日志说明） |
| 我们**上一版**成品（previous） | 写回新版成品（升级本插件自己的补丁时用） |
| 其它（上游真发了新版） | **一个字节都不动**，`/api/dsh-quota/status` 里报 `unknown-version` |

写回是「写临时文件 + 改名」（失败会把临时文件删掉，不留 `.dshbwp.tmp`），不会留下半截文件；同一份内容不会重复写（避免 HMR 因为 mtime 变化反复重载）。日志在 `~/.dsh/balance-widget-patch/log.ndjson`。

`previous` 不用手填：**跑一次 `tools/build-patch.mjs`，上一次的成品哈希会自动记进 `previous`**，并把 `payload` 记录刷新成当前值。`tools/verify.mjs` 会检查 `payload` 记录是否与文件一致 —— 这条就是"改了 payload 但忘了跑 build-patch"的拦截线（那时升级路径会静默断掉）。

## 上游更新了怎么办（rebase 流程）

1. 解包新版：`npm pack dsh-balance-widget@<新版本>`，解到临时目录。
2. 在 `payload/lib/` 里把我们的改动重新落一遍（对照 `patches/` 里那份 diff；改动只有 client.js 的额度模式 + index.js 的三处旧修复）。
3. `node tools/build-patch.mjs --pristine <新解包目录>` —— 它会核对 pristine 哈希、**把旧成品哈希自动记进 `previous`**、刷新 `payload` 记录并重新生成 patch。
4. `node tools/verify.mjs --pristine <新解包目录>` 必须 PASS（它会用 git apply 把补丁打到官方原版上，逐字节比对 payload）。
5. 重启 DSH，看一眼卡片。

> 注：`tools/verify.mjs` 是**手动闸门**；运行时只信 `payload/`。所以第 3 步别省 —— 省了的话补丁文件会变成过期记录（插件的日志里会有一条 `stale-targets` 警告）。

## macOS 呢？

**补丁本体是平台无关的**，唯一一处平台分支在 `payload/lib/index.js` 的 `sessionsRoot()`：

```js
const base = process.env.DSH_HOME
	?? (process.env.HOME !== void 0 && process.env.HOME !== "" ? `${process.env.HOME}/.dsh` : `${process.env.USERPROFILE ?? ""}/.dsh`);
```

macOS 上 `HOME` 一定有值 → 走的正是官方原版那条 `${HOME}/.dsh`，**行为与不打补丁时完全一致**；`USERPROFILE` 那支只在 Windows 生效。其余改动（会话锚定、子代理成本、额度模式）全是纯 JS：`node:fs` / `node:path` / `fetch` / `localStorage`，没有 `win32` 判断、没有反斜杠硬编码、没有 shell 调用。

插件半边同样只用跨平台 API（`os.homedir()`、`path.join()`、`realpathSync`、`node:fs`），安装命令一致：

```bash
node plugins/dsh-balance-widget-patch/tools/profile.mjs add --profile desktop
dsh plugin --profile desktop install      # dsh 命令：应用菜单 → Manage dsh command… → Install
```

**唯一要留意的一件事：pnpm 的链接布局。**

- profile 里 `node_modules/dsh-balance-widget` 是**真目录** → 补丁只落在这个 profile（本机 Windows 就是这种，`pnpm-workspace.yaml` 写着 `nodeLinker: hoisted`）。
- 若是**指向 pnpm store 的链接**（pnpm 默认的 isolated linker；macOS 上是 symlink）→ 写回会落进共享 store，同一个 store 的其他 profile 也会带上这个补丁。插件照常工作，但会写一条警告，`/api/dsh-quota/status` 里 `storeLinked: true`。想让补丁只作用于本 profile，就在 profile 的 `pnpm-workspace.yaml` 里加 `nodeLinker: hoisted` 后重装。

> 说明：这份补丁是在 Windows 机器上做的，**没有 macOS 真机实测**；上面的结论来自逐行核对代码路径（平台分支 + 全部用到的 API）以及上面那条自动检测。记忆里"Mac 上实测可用"的组合指的是仓库里那批自写插件，不是这份补丁。

## 依赖与边界

- 零 npm 依赖；host 半边只用 `node:crypto` / `node:fs` / `node:os` / `node:path` / `node:url`。
- 网络只请求 `https://opencode.ai/console/api/go/status`（主路径）与 `…/console/api/usage/models`、`…/console/api/billing/payment-attempts`（兜底），用本机凭据服务里的 `OPENCODE_GO_API_KEY`（密钥不出宿主进程）。
- 三条自有路由都做 loopback 守卫（非回环地址 403），与 dsh-balance-widget 的做法一致。
- 本插件只读 `dsh-balance-widget` 的两个 lib 文件并（在允许的情形下）写这两个文件，不碰该插件的 `package.json`（版本号保持与官方一致）。
