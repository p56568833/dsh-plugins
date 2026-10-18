# dsh-plugin-l10n-zh — 内部接口契约（冻结，改前先改这里）

一句话：DSH 装上/更新任何插件后，**自动**给它补中文 `title` / `description`，让插件页直接显示中文。

## 0. 事实基础（已实测，别推翻）

1. 插件页每行的文字来自官方 `readPluginMeta(specifier, parentURL)`
   （`.../app.asar/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`）。
2. 它先解析 `<包>/locale/en.json`；**存在**则把该目录下所有 `.json` 按文件名当语言读进字典，
   每份读 `meta.title` / `meta.description`。`en.json` 是必需锚点：没有它，整个 `locale/` 目录都被忽略。
3. 解析走 Node `exports`：包必须显式放行 `"./locale/*.json": "./locale/*.json"`，否则读不到。
   （实测 `dshmarket` 就是这种情况：有 `description` 没 `locale` 出口 → 只能显示英文 package.json 原文。）
4. 缺字段时回退到 `package.json` 的 `name`（title）/ `description`。
5. 客户端 `resolveText()` 的兜底链**最后一定是 `en`**：
   `fallbackChain(active).reduceRight((r, k) => text[k] ?? r, text.en)`。
   所以 `zh.json` 生效的前提是 UI 语言 = zh；否则看到的是 `en`。**要让任何语言下都显示中文，`en.json` 也得是中文。**
6. `listBundles()` 每次调用都重新读盘，**没有缓存** → 落盘后客户端刷新即可生效，不用重启 DSH。

## 1. 目录与写权（一个文件只有一个作者，别越界）

| 文件 | 作者 | 说明 |
| --- | --- | --- |
| `SPEC.md` | lead | 本契约 |
| `lib/localize.mjs` | lead | 扫描 / 计划 / 落盘 / 校验 |
| `lib/index.js` | lead | DSH 宿主插件入口（事件钩子 + 启动补齐） |
| `lib/cli.mjs` | lead | 手动 CLI（scan / apply / check / revert） |
| `lib/deepseek-translator.mjs` | translator | 翻译器（缓存 + API + 术语表回退） |
| `test/translator.test.mjs` | translator | 翻译器单测（离线 mock fetch） |
| `lib/glossary.json` | glossary | 术语表：`{ "<英文原文>": "<中文>" }` |
| `test/glossary.test.mjs` | glossary | 术语表结构/一致性校验 |
| `README.md` | lead | 用户交付文档 |
| `verify.mjs` | lead | 用官方 `readPluginMeta` 端到端验证 |

## 2. 数据形状

```js
/** 一份要翻译的元信息。 */
/** @typedef {{ title?: string, description?: string }} MetaText */

/** 扫描出的一行。 */
/** @typedef {{
 *   name: string,              // 包名，如 "dsh-image-gen"
 *   dir: string,               // 绝对路径 <profile>/node_modules/<name>
 *   source: 'locale'|'manifest'|'none',
 *   sourceLang: string|null,   // 'en' | null
 *   title: string|null,        // 已经算好的「当前会显示的文字」，无则 null
 *   description: string|null,
 *   titleIsChinese: boolean,   // 是否已含 CJK
 *   descriptionIsChinese: boolean,
 *   needsTitle: boolean,       // 缺中文标题
 *   needsDescription: boolean, // 缺中文描述
 *   localeExport: boolean,     // package.json exports 是否放行 ./locale/*.json
 *   hasEnglishAnchor: boolean, // locale/en.json 是否存在
 *   writes: string[],          // 计划要写的文件（相对 dir）
 * }>} ScanRow
 */

/** 一条翻译请求/结果。 */
/** @typedef {{ kind: 'title'|'description', source: string }} TextItem */
/** @typedef {{ kind: 'title'|'description', source: string, target: string, via: 'cache'|'api'|'glossary'|'passthrough' }} TextResult */
```

## 3. 翻译器契约：`lib/deepseek-translator.mjs`

```js
/**
 * @param {{
 *   apiKey?: string|null,        // 缺省从 env / ~/.dsh/.credentials.yaml 解析
 *   model?: string,              // 默认 'deepseek-flash'
 *   endpoint?: string,           // 默认 'https://api.deepseek.com/chat/completions'
 *   cachePath?: string,          // 缺失则退化为纯内存缓存
 *   glossary?: Record<string,string>,
 *   timeoutMs?: number,          // 默认 30000
 *   fetchImpl?: typeof fetch,    // 注入用（测试传 mock）
 *   logger?: { warn(msg:string):void, info(msg:string):void },
 *   maxRetries?: number,         // 默认 2
 * }} [options]
 * @returns {{
 *   translate(items: TextItem[], opts?: { signal?: AbortSignal }): Promise<TextResult[]>,
 *   stats(): { api:number, cache:number, glossary:number, passthrough:number, failures:number },
 *   save(): Promise<void>,
 * }}
 */
export function createTranslator(options)
/** 直接找 API key：env DEEPSEEK_API_KEY → ~/.dsh/.credentials.yaml 的 refs。 */
export function resolveApiKey(env = process.env, home = os.homedir())
/** 术语表命中替换：整串精确命中优先，否则做「词组替换」兜底。导出给测试用。 */
export function glossaryTranslate(text, glossary)
```

行为要求（验收点）：

1. **缓存优先**，`cachePath` 是 JSON：`{ "version":1, "entries": { "<key>": { "target": "...", "via": "...", "at": "<iso>" } } }`，
   `key = kind + "\u0000" + source`。启动读，命中不调 API。`save()` 原子写（临时文件 + rename）。
2. **API 批量**：多个 item 合成一次请求（按 kind 分组），system prompt 要求只回
   `{"title":"…","description":"…"}` JSON；用 `response_format: {type:'json_object'}`。
   解析失败/超时/非 2xx → 重试 `maxRetries` 次（指数退避 ~500ms 起）→ 仍失败则该条走术语表。
3. **绝不抛错**：函数整体不得 reject（除非 caller 的 `signal` 主动 abort）；单条失败降级为
   `{ target: source, via: 'passthrough' }` 并计入 `stats().failures`。
4. **不翻译已是中文的串**（含 CJK 正则检测）→ 直接 `via:'cache'` 语义的直通，不入 API。
5. **术语表回退**：API 不可用时，用 glossary 做整串命中/词组替换；结果仍含未译英文也可接受。
6. 无 apiKey 时不报错，全部走术语表 + passthrough，并在 `logger.warn` 说明一次。

## 4. 落盘契约：`lib/localize.mjs`（lead 实现）

- 目标语言固定 `zh`。
- 对每个 `needsTitle/needsDescription` 的包：
  1. 确保 `package.json` 的 `exports` 里有 `"./locale/*.json": "./locale/*.json"`（对象式 exports 才加；数组/字符串式跳过并记录）。
  2. 写 `locale/en.json`：`{ "meta": { "title": "<中文>", "description": "<中文>" } }`（合并既有内容，不删别的键）。
  3. 写 `locale/zh.json`：同样内容。
  4. 首次改动前把原文件备份到 `<packagesDir>/.dsh-plugin-l10n-zh-backup/<包名>/…`，并写 `manifest.json` 记录新建文件，供 `revert` 用。
- **只写 `meta.title` / `meta.description` 两个键**，其它键原样保留；空描述不写 `description`。
- 幂等：已是中文则跳过；重复跑不产生 diff。
- 不碰 `package.json` 的其它任何字段（尤其 `name` / `dependencies` / `version`）。

## 5. 宿主插件契约：`lib/index.js`（lead 实现）

- 标准 cordis 宿主插件：`export const name`、`export const inject`、`export function apply(ctx)`。
- 监听 `plugin-manager/changed`（安装 / 更新 / 卸载都会发）→ 延迟 ~800ms 去抖 → 后台跑一次 `run({reason:'changed'})`。
- 启动时（`ctx.effect` / `apply` 内）跑一次 `run({reason:'boot'})` 补齐离线期间装的插件。
- 单飞：同一时刻只有一个 run；运行中再来事件 → 记 pending，结束后补跑一次。
- 运行结果写日志文件 `~/.dsh/plugin-l10n-zh/log.ndjson`；失败只 warn，绝不影响 DSH 主流程。
- 提供 `ctx.pluginL10nZh` 服务（`run()` / `scan()`），便于手动触发。
