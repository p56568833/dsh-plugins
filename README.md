# dsh-plugins · 我的 DeepSeek Harness 插件合集

把这台 Mac 上的 **8 个自写 DSH 插件**打包成源码，配合 DSH 自带的插件管理器，在另一台电脑（Windows / macOS）上还原同一套插件环境；另外附带 8 个第三方插件的「按名字 + 版本重装」清单和配置文件样例。

> 仓库里**没有** `node_modules`、**没有**任何 API Key / 登录态、**没有**插件数据（记忆库、缓存、设置）。原因见下文。

---

## 一、先看结论：Windows 能不能用？

| 维度 | 结论 |
| --- | --- |
| 这 8 个插件能不能在 Windows 跑 | **能。** 全部是纯 JavaScript + Web 客户端 UI，没有 `.node` 原生模块，没有调用 macOS 命令（`osascript` / `sips` / `open` 等都没有）。宿主半边只用 Node 内置模块（`fs` / `path` / `os` / `fetch`），路径全部走 `path.join` / `homedir()`。 |
| 安装方式要不要改 | **要。** 插件目录里的 `安装.command` 是 macOS 专用；Windows 用 DSH 插件页「添加插件 → 绝对本地路径」，或 `dsh plugin add`。仓库里给了 PowerShell 一键脚本。 |
| 真正的适配风险在哪 | **不是 Windows，是 DSH 版本。** 这些插件都是在桌面版 `0.2.1-rc.2` 上做的，DSH 还在 rc 阶段，插件靠 `@deepseek-ai/dsh*` 的 peer 版本范围和内部 UI 结构工作。Windows 端如果装到别的版本（尤其升到 0.3），可能被插件管理器判为不兼容，或者界面补丁悄悄失效。 |
| 第三方插件怎么办 | **不重打包。** 它们在 npm 上，按「名字@版本」装即可（macOS 与 Windows 同一份包，平台相关依赖由 pnpm 按平台取）。只有 `dsh-balance-widget` 在本机打过补丁，重装后要重打，补丁已放进仓库。 |
| 凭据 / 数据能不能带 | **不能，也不该上传。** API Key、订阅账号 token、生图 OAuth 登录态、记忆库、各插件设置缓存都不在仓库里，需要在 Windows 上重新登录/重建。 |

**一句话：能做到，跨平台本身不是障碍；要盯的是「DSH 版本对齐」和「安装方式别用 macOS 脚本」。**

---

## 二、为什么不是直接打包 `~/.dsh` 或 `node_modules`

1. **绝对路径写死。** 你现在每个插件在 profile 里都是 `"link:/Users/andychen/Desktop/有趣的东西/DSH插件/..."`。Windows 上这个路径不存在，整份拷贝过去必然装不上。
2. **平台二进制。** 第三方插件里有些会按平台取原生依赖（例如 `@modusensus/dsh-mneme` 的可选本地向量运行时 `onnxruntime`）。Mac 上下载的是 darwin-arm64 的二进制，Windows 用不了；从 npm 重装才会取到 win32 的版本。
3. **体积和漂移。** 整个 profile 的 `node_modules` 几百 MB，而且会和上游插件版本越走越偏。
4. **安全问题。** `~/.dsh/.credentials.yaml` 里有 API Key，`~/.dsh/plugins/subscriptions/auth.json` 里有订阅账号 token。把整个 `~/.dsh` 推到 GitHub 等于公开密钥。

所以本仓库只放**运行时真正需要的源码**：自写插件 + 第三方清单 + 配置样例。

---

## 三、仓库内容

```
dsh-plugins/
├─ plugins/                 # 8 个自写插件（可直接装）
│  ├─ dsh-approval-clear/
│  ├─ dsh-claude-style-addons/
│  ├─ dsh-cost-balance/
│  ├─ dsh-market-sidebar/
│  ├─ dsh-plugin-groups/
│  ├─ dsh-plugin-l10n-zh/
│  ├─ dsh-todo-bar/
│  └─ dsh-whale-splash/
├─ install/
│  ├─ install-windows.ps1   # Windows 一键安装
│  ├─ install-macos.sh      # macOS 一键安装
│  └─ apply-balance-patch.ps1  # 给 dsh-balance-widget 打本机补丁
├─ third-party/
│  ├─ plugins.json          # 第三方插件清单（名字 + 精确版本 + 说明）
│  └─ patches/
│     └─ dsh-balance-widget-0.6.3-subagent-cost.patch
└─ profile/
   ├─ cordis.patch.yml.example   # 本机 profile 配置片段（按需合并，别整份覆盖）
   └─ compatibility.json.example # 版本豁免样例
```

### 自写插件一览

| 插件 | 版本 | 作用 |
| --- | --- | --- |
| `dsh-approval-clear` | 0.2.0 | 审批卡片简化：操作说明、查看详情、拒绝/允许一次 |
| `dsh-claude-style-addons` | 0.6.0 | Claude Style 皮肤补丁：中文问候语、鲸鱼娘吉祥物、余额卡片、行内代码配色（依赖 `dsh-claude-style`） |
| `dsh-cost-balance` | 0.1.0 | 输入框上方实时显示本次对话花费与账户余额 |
| `dsh-market-sidebar` | 0.1.0 | 侧栏「插件市场」「订阅」入口 |
| `dsh-plugin-groups` | 0.1.0 | 插件页「已安装」列表的分类 Tab |
| `dsh-plugin-l10n-zh` | 0.1.0 | 新装/更新插件的标题与描述自动汉化 |
| `dsh-todo-bar` | 0.1.0 | 对话顶部任务进度条（3/5 分段） |
| `dsh-whale-splash` | 0.2.0 | 启动像素开场动画（装了皮肤才会变身吉祥物，没装会自行跳过） |

---

## 四、Windows 安装（每台机器约 3 分钟）

### 0. 先确认 DSH 版本

打开 DSH → 应用菜单 →「关于 DeepSeek Harness」，确认版本。**目标是与本机一致：`0.2.1-rc.2`。**
Windows 官方安装包：<https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe>（Windows 10/11 x64）。

### 1. 把仓库放到一个短英文路径

**推荐 `C:\dsh-plugins`。** 原因：

- 必须和 `C:\Users\<你>` 在**同一个盘**。链接安装（`link:`）在 Windows 上是目录 junction，跨盘会失败或退化成需要开发者模式的符号链接。
- 路径尽量短且纯英文，避开 Windows 260 字符路径上限（`node_modules` 会套很多层）。

两种拿法：

```powershell
# A. 有 Git：直接 clone
git clone https://github.com/p56568833/dsh-plugins.git C:\dsh-plugins

# B. 没 Git：在 GitHub 页面点 Code → Download ZIP，解压后把文件夹放到 C:\dsh-plugins
```

> GitHub 直连不稳时优先用 ZIP；插件安装阶段不联网（这 8 个都是本地目录安装）。

### 2. 注册 `dsh` 命令（只需一次）

DSH → 应用菜单 →「管理 dsh 命令…」→ 安装。然后**新开**一个 PowerShell：

```powershell
dsh --version    # 应输出 0.2.1-rc.2
```

### 3. 一键安装

```powershell
cd C:\dsh-plugins
powershell -ExecutionPolicy Bypass -File .\install\install-windows.ps1
```

脚本会：

1. 确认 `%USERPROFILE%\.dsh\profiles\desktop` 存在（DSH 至少启动过一次）；
2. 确认 `dsh` 命令在 PATH 上；
3. 调用 `dsh plugin --profile desktop add <8 个绝对路径>`，把 8 个插件以 `link:` 方式装进 profile，并自动加入 `dsh.profile.bundles`（等于在插件页逐个「安装 + 启用」）；
4. 打印结果。

装完后**从托盘完全退出 DSH 再打开**（不是关窗口）。

### 不想跑脚本：插件页手动装

侧栏「插件」→ 右上「添加插件」→ 选「安装第三方插件」→ 粘贴一个绝对路径 → 安装。对下面 8 行各做一次：

| 插件 | 粘贴这个路径 |
| --- | --- |
| dsh-approval-clear | `C:\dsh-plugins\plugins\dsh-approval-clear` |
| dsh-claude-style-addons | `C:\dsh-plugins\plugins\dsh-claude-style-addons` |
| dsh-cost-balance | `C:\dsh-plugins\plugins\dsh-cost-balance` |
| dsh-market-sidebar | `C:\dsh-plugins\plugins\dsh-market-sidebar` |
| dsh-plugin-groups | `C:\dsh-plugins\plugins\dsh-plugin-groups` |
| dsh-plugin-l10n-zh | `C:\dsh-plugins\plugins\dsh-plugin-l10n-zh` |
| dsh-todo-bar | `C:\dsh-plugins\plugins\dsh-todo-bar` |
| dsh-whale-splash | `C:\dsh-plugins\plugins\dsh-whale-splash` |

安装成功后插件页会多出卡片，默认已启用。

---

## 五、macOS 安装

```bash
cd ~/Desktop/dsh-plugins     # 或 clone 到任意位置
./install/install-macos.sh          # 默认 profile = desktop
# 也可以传入别的 profile 名：./install/install-macos.sh web
```

前置条件与 Windows 相同：`dsh` 命令已注册（菜单 → 管理 dsh 命令…）、profile 已初始化。装完完全退出 DSH 再打开。

各插件目录里原有的 `安装.command` 仍然可用（macOS 专用），效果与脚本一致。

---

## 六、8 个第三方插件（从 npm 装，不要拷贝）

装完自写插件后，在插件页「添加插件」里逐个输入 `名字@版本`。**顺序建议：先 `dsh-claude-style`，再装依赖它的 addons / whale-splash。**

| 包名 | 版本 | 作用 | 备注 |
| --- | --- | --- | --- |
| `dsh-claude-style` | 0.16.2 | Claude 风格皮肤 | addons / whale-splash 的前置 |
| `dsh-better-sidebar` | 0.26.1 | 右侧栏增强 | |
| `dsh-image-gen` | 0.9.1 | 生图/改图工作台 | `chatgpt-sub` 需要在新机器重新 OAuth 登录 |
| `dsh-plugin-subscriptions` | 0.9.9 | 订阅账号中转 | 在 `0.2.1-rc.2` 上需要版本豁免，见下 |
| `dsh-status-rotator` | 0.37.0 | 状态轮播 | 设置不随仓库迁移 |
| `dsh-balance-widget` | 0.6.3 | 余额/花费卡片 | **本机打过补丁**，重装后需重打 |
| `dshmarket` | 1.66.35 | 可视化插件市场 | 也可用它装上面的插件 |
| `@modusensus/dsh-mneme` | 0.9.0 | 跨会话记忆库 | 本地向量运行时可选，首次启用会下载模型（体积较大） |

> 版本对齐很重要：上面是这台 Mac 实测可用的组合。新机器如果 DSH 版本相同，照抄最稳；如果 DSH 已经升级，优先装这些插件的最新版，而不是硬装旧版。

### 6.1 `dsh-plugin-subscriptions` 的版本豁免

插件页安装时如果报 **不兼容 / incompatible-version**，把 `profile/compatibility.json.example` 复制成：

- Windows：`%USERPROFILE%\.dsh\profiles\desktop\compatibility.json`
- macOS：`~/.dsh/profiles/desktop/compatibility.json`

内容含义是「允许 `dsh-plugin-subscriptions@0.9.9` 在 `0.2.1-rc.2` 上运行」。也可以按插件页提示走「版本豁免 → 接受风险」。豁免只影响这一对版本，升级后要重新确认。

### 6.2 `dsh-balance-widget` 的本机补丁

补丁内容：修复会话锚定（DSH 0.2.x 去掉了 sessions 快照的 `current` 字段）+ 把子代理/团队成员的花费并入「本会话 / 今日」。

重装或升级 `dsh-balance-widget` 之后补丁会丢，需要重打。需要 Git for Windows（`git apply`）：

```powershell
cd C:\dsh-plugins
powershell -ExecutionPolicy Bypass -File .\install\apply-balance-patch.ps1
```

手工等价命令：

```powershell
git -C "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-balance-widget" apply "C:\dsh-plugins\third-party\patches\dsh-balance-widget-0.6.3-subagent-cost.patch"
```

> 只对 `0.6.3` 有效。该补丁已在本机验证：对 npm 上的 `dsh-balance-widget@0.6.3` 原始包可干净应用。

---

## 七、配置（可选，按需合并）

`profile/cordis.patch.yml.example` 是这台 Mac 的 profile 补丁层，包含：

- 默认模型（`deepseek-account` / `deepseek-flash` / `reasoningEffort: max`）
- 权限预设（默认 `danger-full-access`）
- 皮肤 `dsh-claude-style` 的外观参数（品牌、调色板、吉祥物）
- 生图 `dsh-image-gen` 的 `provider: chatgpt-sub`
- 各插件的少量开关

**不要整份覆盖新机器的 `cordis.patch.yml`**，只把需要的行合并进去。里面没有路径和密钥，但 `provider` 这类值和新机器的登录方式有关，照抄后要在设置里重新选。

---

## 八、不会带过去的东西（也绝对不能上传）

| 路径 | 内容 | 处理 |
| --- | --- | --- |
| `~/.dsh/.credentials.yaml` | API Key（DeepSeek 等） | 新机器重新填 |
| `~/.dsh/plugins/subscriptions/auth.json` | 订阅账号 token | 新机器重新登录 |
| 生图 OAuth 登录态 | `chatgpt-sub` 等 | 新机器重新授权 |
| `~/.dsh/memory/` | `dsh-mneme` 记忆库数据 | 要搬记忆需单独导出 |
| `~/.dsh/status-rotator/`、`plugin-l10n-zh/` 等 | 各插件设置与缓存 | 不用搬，重装后重新配置 |
| `~/.dsh/profiles/**/node_modules/` | 依赖树（含平台二进制） | 由 pnpm 在目标机重装 |

---

## 九、更新与卸载

**更新本仓库的插件：**

```powershell
cd C:\dsh-plugins
git pull
# 完全退出 DSH 再打开（link: 安装，代码是即时的）
```

**卸载单个插件：** 插件页 → 对应卡片 → 移除；或

```powershell
dsh plugin --profile desktop remove dsh-todo-bar
```

**整仓弃用：** 移除全部 8 个后直接删掉 `C:\dsh-plugins` 即可（`link:` 指向的源目录没了，插件也随之失效——先移除再删目录更干净）。

---

## 十、已知限制 / 尚未验证

- **没有 Windows 实机验证。** 上面的判断基于 DSH `0.2.1-rc.2` 的插件加载/安装代码和这 8 个插件的实现（纯 JS、无原生依赖、跨平台路径 API）。首次安装如果失败，把插件页的报错原文或 PowerShell 输出发回来即可定位。
- **`.command` 脚本仅 macOS。** Windows 请用 `install/install-windows.ps1` 或插件页。
- **第三方插件不重打包**：一是版权/维护，二是它们本来就从 npm 按平台分发，重打包反而会把 macOS 的依赖带到 Windows。
- **GitHub 直连**：仓库很小（约 5 MB），ZIP 下载即可；插件安装阶段不访问 GitHub。
- **DSH 版本漂移**：DSH 升级到 0.3+ 后，这些 UI 补丁插件可能需要跟着改（内部组件/属性名变化），届时以插件页报错为准。

---

## 十一、它们原本装在哪（给未来的自己）

macOS 上这套环境的实际位置：

- 插件源码：`~/Desktop/有趣的东西/DSH插件/`
- profile：`~/.dsh/profiles/desktop/`（`package.json` 的 `dsh.profile.bundles` + `cordis.patch.yml`）
- 第三方插件装在 `~/.dsh/profiles/desktop/node_modules/`
- 本仓库是上述自写插件的一份**可分发快照**（去掉了 `preview/`、鲸鱼娘原画 `assets/whale-maid/source/`、`.DS_Store` 等非运行时文件）。
