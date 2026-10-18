# dsh-plugin-l10n-zh

DSH 的「插件自动汉化」插件：**你以后每装一个插件、每更新一个插件，它的标题和描述会自动变成简体中文**，不需要你再说一句话。

配合 [dshmarket](../)（可视化插件市场）用，装完刷新一下插件页就是中文。

## 它到底做什么

DSH 插件页每一行的文字来自官方 `readPluginMeta()`：

1. 先找 `<包>/locale/en.json`；**找到了**才把同目录下所有 `.json` 按文件名当语言读进来，每份读 `meta.title` / `meta.description`；
2. 找不到就回退到 `package.json` 的 `name` / `description`。

所以一个插件要显示中文，得同时满足三件事：**有 `locale/*.json`**、**`package.json` 放行了 `./locale/*.json`**、**里面有中文**。

本插件就是自动补齐这三件事：

| 步骤 | 说明 |
| --- | --- |
| 扫描 | 读 profile 的 `package.json`，列出所有已装 plugin / bundle |
| 判断 | 缺中文标题或描述的行才算「待处理」；已有中文的行直接跳过 |
| 翻译 | 走 DeepSeek API（`deepseek-flash`），结果按 `kind + 原文` 缓存，同一句英文只花一次钱 |
| 起标题 | 标题是包名占位（`dsh-image-gen`、`@modusensus/dsh-mneme` 这种）时，从描述里另起一个 2–8 字中文短名 |
| 落盘 | 写 `locale/en.json` + `locale/zh.json`，必要时给 `package.json` 的 `exports` 加一行 `"./locale/*.json"` |

过程中只写 `meta.title` / `meta.description` 两个键，**绝不碰插件本身的代码与其它字段**，改动前先备份，一条命令可回滚。

### 标题从哪来

| 情况 | 标题 |
| --- | --- |
| 作者写了 `locale/*.json` 的 `meta.title` | 翻它（例：`Better Sidebar` → 增强侧边栏） |
| 标题就是包名（官方只回退到 `package.json.name`） | **按描述另起一个短名**（例：`@modusensus/dsh-mneme` → 跨会话记忆、`dsh-image-gen` → 图像生成） |
| 描述里也没有内容可借 | 保持包名兜底，绝不硬造 |

短名由模型按「2–8 字、名词短语、不要标点/包名前缀」的约束生成，和正文翻译共用同一套缓存与重试。

## 为什么 `en.json` 写成中文

客户端挑语言的兜底链**最后一定是 `en`**（`resolveText()` 的 `reduceRight(..., text.en)`）。
也就是说：只写 `zh.json`，当你的界面语言是英文时看到的还是英文。

所以本插件把中文同时写进 `en.json` 与 `zh.json` —— 界面语言无论中英，插件页都是中文。
如果你希望「英文界面下也保留英文原文」，把 `lib/localize.mjs` 里 `applyRow()` 的
`for (const language of ['en', TARGET_LANGUAGE])` 改成 `[TARGET_LANGUAGE]` 即可。

## 触发时机

| 时机 | 说明 |
| --- | --- |
| 插件安装 / 更新 / 卸载后 | 监听 `plugin-manager/changed`，去抖 800ms 后自动跑一遍 |
| DSH 启动后约 2.5 秒 | 补齐「离线期间装的」和「上次没跑完的」 |
| 手动 | 见下面 CLI |

同一个时刻只有一个任务在跑；运行中再来事件会排队，结束后补跑一次。
**所有失败只写日志，不会影响 DSH 本身。**

日志：`~/.dsh/plugin-l10n-zh/log.ndjson`
翻译缓存：`~/.dsh/plugin-l10n-zh/cache.json`
备份：`~/.dsh/plugin-l10n-zh/backup/`

## 手动使用

`node` 不在 PATH 里，用 DSH 自带的：

```sh
NODE="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
cd ~/Desktop/有趣的东西/DSH插件/dsh-plugin-l10n-zh

"$NODE" lib/cli.mjs scan          # 看哪些插件没有中文、会写哪些文件
"$NODE" lib/cli.mjs check         # 看每个插件当前会显示什么
"$NODE" lib/cli.mjs apply         # 补中文（幂等，可反复跑）
"$NODE" lib/cli.mjs apply --dry-run   # 只显示译文，不落盘
"$NODE" lib/cli.mjs revert        # 从备份还原
```

## 翻译通道

| 通道 | 何时用 |
| --- | --- |
| DeepSeek API | 有 `DEEPSEEK_API_KEY`（或 `~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY`）时优先；一次请求翻一批，`temperature 0.2` + JSON 输出 |
| 本地术语表 | API 不可用时兜底，`lib/glossary.json` 321 条 DSH 生态术语，与官方中文译法对齐 |
| 原文直通 | 术语表也没命中就保留英文，**不写垃圾中文**（`via:'passthrough'` 的结果一律丢弃） |

改模型：`DSH_PLUGIN_L10N_ZH_MODEL=mimo-v2.6-flash`（默认 `deepseek-flash`）。
临时关掉整个插件：`DSH_PLUGIN_L10N_ZH=0`。

## 装 / 卸

已经装在 `desktop` profile 里了（`~/.dsh/profiles/desktop/package.json` 的
`dsh.profile.bundles` 里有 `dsh-plugin-l10n-zh`，依赖是 `link:` 到本目录）。

临时停用：在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里加

```yaml
- id: plugin-l10n-zh
  disabled: true
```

彻底移除：

```sh
NODE="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
PNPM="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
cd ~/.dsh/profiles/desktop && "$NODE" "$PNPM" remove dsh-plugin-l10n-zh
"$NODE" ~/Desktop/有趣的东西/DSH插件/dsh-plugin-l10n-zh/lib/cli.mjs revert   # 顺手把汉化还原成英文
```

## 验证（不靠肉眼）

```sh
# 1) 全部单测（32 个，离线）
"$NODE" --test 'test/*.test.mjs'

# 2) 用官方 readPluginMeta 端到端验证（必须用 Electron 当 node 跑，才能读 app.asar）
#    父进程汉化，子进程新起一个进程读官方结果 —— 避开 Node 的模块解析缓存
cd ~/Desktop/有趣的东西/DSH插件/dsh-plugin-l10n-zh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" verify.mjs
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" verify.mjs --fixture
```

`--fixture` 会造三种真实形态（没 locale / 有 locale 但没放行 exports / 本来就中文），
跑完汉化后由**另一个进程**用官方函数读一遍，再检查幂等。

## 目录

| 文件 | 作用 |
| --- | --- |
| `lib/index.js` | 宿主插件入口：事件钩子 + 启动补齐 |
| `lib/localize.mjs` | 扫描 / 计划 / 落盘 / 回滚（纯逻辑，无网络） |
| `lib/deepseek-translator.mjs` | 翻译器：缓存 + 批量 API + 术语表降级 |
| `lib/glossary.json` | 321 条 DSH 术语表（API 不可用时兜底） |
| `lib/cli.mjs` | 手动 CLI |
| `cordis.patch.yml` | 把插件插进 profile 插件树 |
| `SPEC.md` | 内部接口契约 |
| `test/` | 34 个单测 |

## 已知边界

- **只汉化插件页显示的两个字段**（标题、描述）。插件自己的界面文案由作者提供，不在本插件范围。
- **短名是模型起的**，可能与你心里的叫法略有差别；不满意就直接改 `locale/zh.json` 的 `meta.title`，
  并在 `~/.dsh/plugin-l10n-zh/cache.json` 里删掉对应那条 `__title__` 记录（否则下次会沿用缓存）。
- **更新插件会覆盖本插件的改动**：`pnpm` 重装后 `locale/` 被作者的版本覆盖，
  这时靠「启动补齐 / 安装事件」再跑一遍；这也是本插件存在的意义。
- **`exports` 是数组或字符串形式的包**无法放行 `./locale/*.json`，会被跳过并记进日志。

## 设计取舍

- **用官方 `readPluginMeta` 的真行为做验收**，而不是自己写一套断言 —— 官方逻辑就是这个插件的规格。
- **不碰 `app.asar`**：官方代码在应用包里，随应用更新会被替换；改 profile 里的插件数据才是长久的。
- **写 `en.json` 而非只写 `zh.json`**：见上文「为什么 en.json 写成中文」。
- **空 meta 文件是毒药**：`scan` 一旦发现有 `locale/en.json` 就会认为该包「有本地化」，
  于是不再回退 `package.json`。所以 `applyRow()` 在没有可写内容时**一个文件都不写**（这条有单测锁死）。
