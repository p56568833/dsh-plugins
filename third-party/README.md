# 第三方插件说明

这 8 个插件不是我的代码，**不在本仓库里重新打包**。原因：

- 它们已经从 npm 分发，Windows / macOS 装的是同一份包，平台相关的可选依赖由 pnpm 按平台解析；
- 重打包会把 macOS 上下载的原生二进制带到 Windows，反而装不上；
- 也避免和上游版本分叉。

## 安装方法

在 DSH 侧栏「插件」→「添加插件」里输入 `名字@版本`，例如：

```
dsh-claude-style@0.16.2
dsh-better-sidebar@0.26.1
dsh-image-gen@0.9.1
dsh-plugin-subscriptions@0.9.9
dsh-status-rotator@0.37.0
dsh-balance-widget@0.6.3
dshmarket@1.66.35
@modusensus/dsh-mneme@0.9.0
```

顺序：先 `dsh-claude-style`，再装本地那两个依赖它的插件（`dsh-claude-style-addons`、`dsh-whale-splash`）。其余顺序无所谓。

完整清单（含用途、备注、补丁信息）见 [`plugins.json`](plugins.json)。

## 两个需要额外处理的

1. **`dsh-plugin-subscriptions@0.9.9`** —— 在 DSH `0.2.1-rc.2` 上需要版本豁免，见 [`../profile/compatibility.json.example`](../profile/compatibility.json.example)。
2. **`dsh-balance-widget@0.6.3`** —— 装完由本地插件 [`dsh-balance-widget-patch`](../plugins/dsh-balance-widget-patch) 负责打补丁（**不要再手工跑下面的旧脚本**）。补丁做四件事：Windows 上会话目录改用 `DSH_HOME` / `USERPROFILE`（原来只认 `HOME`，Windows 上会话永远查不到，面板会报 `会话: no session files found` 且今日花费恒为 ¥0）；适配 DSH 0.2.x 的当前会话读取；把子代理/团队成员花费并入「今日·本会话」；加一个「余额 ⇄ OpenCode Go 额度」模式切换。

   ```powershell
   # Windows：登记插件 + 落 junction（补丁由插件自己在启动时写回，无需手动打）
   node plugins\dsh-balance-widget-patch\tools\profile.mjs add --profile desktop
   dsh plugin --profile desktop install
   ```

   ```bash
   # macOS
   node plugins/dsh-balance-widget-patch/tools/profile.mjs add --profile desktop
   dsh plugin --profile desktop install
   ```

   补丁成品在 `plugins/dsh-balance-widget-patch/payload/`，人可读 diff 在 `plugins/dsh-balance-widget-patch/patches/`；自检 `node plugins/dsh-balance-widget-patch/tools/verify.mjs --pristine <官方 0.6.3 解包目录>`。下面的旧脚本与旧补丁保留为历史记录，**对已经打上新补丁的安装会直接报错退出**（`git apply` 失败），不会破坏任何东西。

## 关于版本

上面的版本是这台 Mac 上实测可用的组合。新机器的 DSH 版本如果一致，照抄最稳；如果 DSH 已经升级，先装最新版，不要硬装旧版——旧插件的 peer 范围可能不接受新 DSH。
