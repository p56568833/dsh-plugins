# dsh-balance-widget-patch — 余额卡片补丁

给第三方插件 [`dsh-balance-widget`](https://github.com/LL-cmyk-so/dsh-balance-widget)（0.6.3）打的**本机补丁**，做成一个独立插件：

1. **「余额 ⇄ OpenCode Go 额度」模式切换** —— 侧栏底部那张卡片的弹层顶部多一个小切换按钮。切到「额度」后卡片不再显示 DeepSeek 的 ¥ 余额，也不再显示 Go 额度的美元数字，改为**已用百分比 + 绿色进度条**：弹层里三档（5 小时 / 本周 / 账期）各是「标签 … 16%」加一条绿色进度条（进度条右侧是小字的重置倒计时），底下再补一行「今日已用 ¥x.xx」（读今日所有工作区的费用合计）；侧栏那张卡片本身则在 5 小时额度上显示百分比 + 一条迷你进度条。
2. **补丁自愈** —— 补丁以成品文件（`payload/`）随本包发布。`dsh-balance-widget` 被重装或更新后，`node_modules` 里的文件会被换回官方原版，本插件会在启动时 / 安装事件后 / 每 10 分钟巡检一次，把成品文件写回去。**上游发新版也不会被静默覆盖**：文件指纹既不是官方原版、也不是我们自己的成品时，插件一概不碰，只把状态记下来。
3. **Go 额度接口** —— 注册 `GET /api/dsh-quota/go`（仅回环地址可访问），用本机凭据里的 `OPENCODE_GO_API_KEY` 读 OpenCode Console 用量接口，算出三条窗口的已用 / 上限。

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
    goPeriodStart: ""        # 留空 = 月窗口按 UTC 自然月；填账期起点（ISO）可精确对齐账期
    goFiveHourLimitUsd: 16   # Flash：月 $80 的 20% / 50% / 100% = 16 / 40 / 80
    goWeekLimitUsd: 40       # 换成 V4 Pro（月 $15）时改成 3 / 7.5 / 15
    goMonthLimitUsd: 80
    requestTimeoutMs: 8000
    autoHeal: true           # false = 关掉自动写回，只保留额度接口
```

额度口径（OpenCode Go 官方文档 + Console bundle 里的 `allowance` 实测）：

- **5 小时窗口**：Flash $16、Pro $3。DSH 没有 Console 会话，读不到官方窗口的真实起点，所以按**最近 5 小时滚动**统计 —— 只会偏保守（不会少报）。
- **本周**：Flash $40、Pro $7.5，按 **UTC 日历周**（周一 00:00Z 起算）精确对齐。
- **账期**：Flash $80、Pro $15。账期起点用推理密钥读不到，默认按 UTC 自然月；想在 Console 上看真实账期起点，用 `goPeriodStart` 填进去。
- 数值来自 `https://opencode.ai/console/api/usage/models?since=<ISO>` 的 `totalCostMicroCents`（1 USD = 1e8），按 provider `opencode-go` 汇总；档位（Flash / Pro）由账期里花钱最多的模型决定。

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
- 网络只请求 `https://opencode.ai/console/api/usage/models`，用本机凭据服务里的 `OPENCODE_GO_API_KEY`（密钥不出宿主进程）。
- 三条自有路由都做 loopback 守卫（非回环地址 403），与 dsh-balance-widget 的做法一致。
- 本插件只读 `dsh-balance-widget` 的两个 lib 文件并（在允许的情形下）写这两个文件，不碰该插件的 `package.json`（版本号保持与官方一致）。
