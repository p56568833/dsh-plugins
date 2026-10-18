/**
 * deepseek-translator.mjs —— DSH 插件中文本地化的翻译器。
 *
 * 用途：把插件元信息里的英文 title / description 翻成简体中文，供 lib/localize.mjs 落盘到
 * locale/en.json 与 locale/zh.json。设计目标只有三条：**绝不抛错**、**尽量少发请求**、**离线也能用**。
 *
 * 行为要点：
 * - 缓存优先：cachePath 为 JSON 文件，key = kind + "\u0000" + source，命中不发 API；save() 原子写。
 * - 批量：一次 translate() 内所有待译条目合并成**一次** API 请求（响应键见 SYSTEM_PROMPT）。
 * - 降级链：缓存 → API → 术语表 → 原文直通（passthrough，计入 failures），永不 reject。
 * - 已是中文（含 CJK）的串直接原样返回，不发 API。
 * - 无 apiKey：只用术语表 + passthrough，warn 一次。
 *
 * 无任何第三方依赖，仅用 node 内置模块。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 默认端点 / 模型 / 超时 / 重试次数（见 SPEC 第 3 节）。 */
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-flash';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
/** 指数退避基数：500ms、1000ms、2000ms … */
const RETRY_BASE_MS = 500;

/** CJK 判定（含扩展 A 区与兼容区）。 */
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

/** 缓存文件版本号，读到别的版本只警告，不崩。 */
const CACHE_VERSION = 1;

/** 「从描述起中文短名」这个特殊任务的缓存 kind，与 title/description 分开。 */
const DERIVED_TITLE_KIND = '__title__';

/**
 * 短名的硬上限（字符数，中英混排按字符算）。
 *
 * 为什么要有这道闸：模型偶尔不听「2 到 8 个汉字、名词短语」的约束，直接把整段
 * 描述当成名字返回，于是插件页的标题变成一整段话。坏值一旦写进缓存就会一直生效
 * （命中只看「是不是中文」），所以校验必须两处都做：缓存命中和新译文。
 */
const DERIVED_TITLE_MAX_CHARS = 16;

/** 短名里不该出现的句读标点与换行。 */
const DERIVED_TITLE_PUNCT = /[：:；;。，,、！!？?…—－\n\r]/;

/**
 * 一个短名是否可用：非空、≤ 16 字符、不带句读标点、至少 2 个汉字。
 * @param {unknown} text 模型给出的名字或缓存里的名字。
 * @returns {boolean} 可用即 true。
 */
export function usableDerivedTitle(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > DERIVED_TITLE_MAX_CHARS) return false;
  if (DERIVED_TITLE_PUNCT.test(trimmed)) return false;
  const han = trimmed.match(/[\u3400-\u9fff\uf900-\ufaff]/gu);
  return han !== null && han.length >= 2;
}

/** system prompt：只返回 JSON 对象，键名与请求键名一一对应。 */
const TITLE_PROMPT = [
  '你在给 DeepSeek Harness（DSH）的插件页起中文短名，用户会在开关列表里看到它。',
  '要求：2 到 8 个汉字，名词短语，不要标点、不要句号、不要引号、不要 emoji；不要出现 DSH / plugin 这类通用词，也不要出现 @scope/ 包名前缀。',
  '从插件功能里抓最核心的一个概念命名（例如「跨会话记忆」「图像生成」「插件市场」）。',
  '只返回一个 JSON 对象，不要解释、不要 markdown 代码块，键名与输入完全一致。',
].join('\n');

/** 第二遍用的 system prompt：上一遍把描述整段抄了回来，这一次只许压缩。 */
const COMPRESS_PROMPT = [
  '你上一次给 DeepSeek Harness（DSH）的插件起的名字太长了，用户看到的是一整段话。',
  '这一次只输出 2 到 8 个汉字的名词短语：不许整句、不许标点、不许解释、不许重复描述。',
  '从功能里抓最核心的一个概念（例如「跨会话记忆」「图像生成」「插件市场」）。',
  '只返回一个 JSON 对象，键名与输入完全一致。',
].join('\n');

const SYSTEM_PROMPT = [
  '你是 DSH 插件元信息本地化助手，负责把英文插件 title / description 翻译成简体中文。',
  '要求：译文简洁、专业，符合开发者工具的语气；产品名、包名、命令、代码标识符与占位符（如 {name}）保持原样不译。',
  '只返回一个 JSON 对象，不要解释、不要 markdown 代码块。',
  '键名与输入完全一致：通常是 {"title":"…","description":"…"}；同一字段有多项时输入会用 title_1 / title_2 这类键名，按原键名返回。',
].join('\n');

/** 缓存键：kind + NUL + source。 */
function cacheKey(kind, source) {
  return `${kind}\u0000${source}`;
}

/** 归一化 logger，缺省为静默，避免调用方必须传。 */
function normalizeLogger(logger) {
  const raw = logger ?? {};
  return {
    warn: typeof raw.warn === 'function' ? raw.warn.bind(raw) : () => {},
    info: typeof raw.info === 'function' ? raw.info.bind(raw) : () => {},
  };
}

/** 是否已含中日韩字符（视为「已是中文」，不必翻译）。 */
function isChinese(text) {
  return typeof text === 'string' && CJK_RE.test(text);
}

/** 构造 AbortError（优先用 DOMException，保持与 fetch 一致）。 */
function abortError(message = '翻译已被调用方中止') {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function isAbortError(err) {
  return Boolean(err) && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
}

/** AbortSignal.timeout / undici 的超时错误名是 TimeoutError，与 caller abort 区分开。 */
function isTimeoutError(err) {
  return Boolean(err) && (err.name === 'TimeoutError' || err.code === 23 || err.code === 'UND_ERR_CONNECT_TIMEOUT');
}

/** 可被 abort 打断的 sleep。 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/** 合并调用方 signal 与超时 signal（timeoutMs<=0 表示不设超时），并回传超时 signal 便于归因。 */
function buildSignals(signal, timeoutMs) {
  const timeoutSignal =
    timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : null;
  const list = [];
  if (signal) list.push(signal);
  if (timeoutSignal) list.push(timeoutSignal);
  let combined;
  if (list.length === 0) combined = undefined;
  else if (list.length === 1) combined = list[0];
  else combined = typeof AbortSignal.any === 'function' ? AbortSignal.any(list) : list[0];
  return { signal: combined, timeoutSignal };
}

/** 剥离 ```json 包裹后解析；失败再退回「第一个 { 到最后一个 }」。 */
function parseContentJson(content) {
  if (typeof content !== 'string' || content.trim() === '') throw new Error('响应 content 为空');
  let text = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('响应 content 不是合法 JSON');
    parsed = JSON.parse(text.slice(start, end + 1)); // 仍失败则抛给重试逻辑
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('响应 JSON 不是对象');
  }
  return parsed;
}

/** 读取响应体：优先 json()，退化为 text()+JSON.parse。 */
async function readResponseJson(res) {
  if (res && typeof res.json === 'function') return await res.json();
  if (res && typeof res.text === 'function') return JSON.parse(await res.text());
  throw new Error('响应体无法解析');
}

/** 去掉 YAML 行尾注释与包裹引号。 */
function cleanYamlValue(value) {
  let str = String(value ?? '').trim();
  const hash = str.search(/\s#/);
  if (hash !== -1) str = str.slice(0, hash).trim();
  if (str.length >= 2) {
    const first = str[0];
    const last = str[str.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) str = str.slice(1, -1);
  }
  return str.trim();
}

const KEY_LINE_RE = /^[ \t]*DEEPSEEK_API_KEY[ \t]*:[ \t]*(.*)$/;

/** 从 credentials.yaml 文本里取 DEEPSEEK_API_KEY：先限定 refs: 段，再整文件兜底。 */
function extractKeyFromYaml(raw) {
  const lines = String(raw ?? '').split(/\r?\n/);
  let inRefs = false;
  for (const line of lines) {
    if (/^refs[ \t]*:/.test(line)) {
      inRefs = true;
      continue;
    }
    if (!inRefs) continue;
    if (/^[^\s#]/.test(line)) inRefs = false; // 回到顶层键，refs 段结束
    if (!inRefs || /^[ \t]*#/.test(line)) continue;
    const matched = KEY_LINE_RE.exec(line);
    if (matched) {
      const value = cleanYamlValue(matched[1]);
      if (value) return value;
    }
  }
  for (const line of lines) {
    if (/^[ \t]*#/.test(line)) continue;
    const matched = KEY_LINE_RE.exec(line);
    if (matched) {
      const value = cleanYamlValue(matched[1]);
      if (value) return value;
    }
  }
  return null;
}

/**
 * 直接找 API key：env DEEPSEEK_API_KEY → ~/.dsh/.credentials.yaml 的 refs。
 * @param {Record<string,string|undefined>} [env]
 * @param {string} [home]
 * @returns {string|null}
 */
export function resolveApiKey(env = process.env, home = os.homedir()) {
  const fromEnv = typeof env?.DEEPSEEK_API_KEY === 'string' ? env.DEEPSEEK_API_KEY.trim() : '';
  if (fromEnv) return fromEnv;
  if (!home) return null;
  try {
    const raw = fs.readFileSync(path.join(home, '.dsh', '.credentials.yaml'), 'utf8');
    return extractKeyFromYaml(raw);
  } catch {
    return null; // 文件不存在 / 不可读都当作没有 key
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 术语表命中替换：整串精确命中优先，否则按术语逐个替换（长词优先，单次扫描，避免互相破坏）。
 * @param {string} text
 * @param {Record<string,string>} glossary
 * @returns {string}
 */
export function glossaryTranslate(text, glossary) {
  if (typeof text !== 'string' || text === '') return text;
  if (!glossary || typeof glossary !== 'object') return text;
  const has = (key) => Object.prototype.hasOwnProperty.call(glossary, key);
  if (has(text) && typeof glossary[text] === 'string') return glossary[text];

  const trimmed = text.trim();
  if (trimmed !== text && has(trimmed) && typeof glossary[trimmed] === 'string') return glossary[trimmed];

  const terms = Object.keys(glossary).filter(
    (key) => key.length > 0 && typeof glossary[key] === 'string' && glossary[key] !== '',
  );
  if (terms.length === 0) return text;

  // 长词优先排在前，正则分支从左到右匹配 → 自然取最长命中；替换结果不再进入下一轮，故不会二次破坏。
  terms.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const lookup = new Map();
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (!lookup.has(lower)) lookup.set(lower, glossary[term]);
  }
  const pattern = new RegExp(terms.map(escapeRegExp).join('|'), 'gi');
  return text.replace(pattern, (matched) => {
    const value = lookup.get(matched.toLowerCase());
    return value === undefined ? matched : value;
  });
}

/** 读取缓存文件；损坏 / 非法结构一律当空缓存并 warn。 */
function loadCache(cachePath, logger) {
  const entries = new Map();
  if (!cachePath) return entries;
  let raw;
  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      logger.warn(`读取翻译缓存失败，按空缓存处理：${cachePath}（${err.message}）`);
    }
    return entries;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(`翻译缓存 JSON 损坏，按空缓存处理：${cachePath}`);
    return entries;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn(`翻译缓存结构非法，按空缓存处理：${cachePath}`);
    return entries;
  }
  if (parsed.version !== CACHE_VERSION) {
    logger.warn(`翻译缓存版本为 ${String(parsed.version)}（期望 ${CACHE_VERSION}），仍尝试读取`);
  }
  const rawEntries = parsed.entries;
  if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) {
    logger.warn(`翻译缓存缺少 entries 对象，按空缓存处理：${cachePath}`);
    return entries;
  }
  for (const [key, value] of Object.entries(rawEntries)) {
    if (value && typeof value === 'object' && typeof value.target === 'string' && value.target !== '') {
      entries.set(key, {
        target: value.target,
        via: typeof value.via === 'string' ? value.via : 'cache',
        at: typeof value.at === 'string' ? value.at : new Date().toISOString(),
      });
    }
  }
  return entries;
}

/**
 * 创建翻译器。
 * @param {{
 *   apiKey?: string|null,
 *   model?: string,
 *   endpoint?: string,
 *   cachePath?: string,
 *   glossary?: Record<string,string>,
 *   timeoutMs?: number|false,
 *   fetchImpl?: typeof fetch,
 *   logger?: { warn(msg:string):void, info(msg:string):void },
 *   maxRetries?: number,
 * }} [options]
 * @returns {{
 *   translate(items: Array<{kind:string, source:string}>, opts?: { signal?: AbortSignal }): Promise<Array<{kind:string, source:string, target:string, via:string}>>,
 *   stats(): { api:number, cache:number, glossary:number, passthrough:number, failures:number },
 *   save(): Promise<void>,
 * }}
 */
export function createTranslator(options = {}) {
  const opts = options ?? {};
  const logger = normalizeLogger(opts.logger);
  const endpoint = typeof opts.endpoint === 'string' && opts.endpoint !== '' ? opts.endpoint : DEFAULT_ENDPOINT;
  const model = typeof opts.model === 'string' && opts.model !== '' ? opts.model : DEFAULT_MODEL;
  const glossary = opts.glossary && typeof opts.glossary === 'object' ? opts.glossary : {};
  const cachePath = typeof opts.cachePath === 'string' && opts.cachePath !== '' ? opts.cachePath : null;

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (opts.timeoutMs === false || opts.timeoutMs === 0) timeoutMs = 0;
  else if (typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) {
    timeoutMs = opts.timeoutMs;
  }

  const maxRetries =
    Number.isInteger(opts.maxRetries) && opts.maxRetries >= 0 ? opts.maxRetries : DEFAULT_MAX_RETRIES;

  // apiKey 显式传 null / '' → 视为「没有 key」（不发请求）；完全不传才去 env / credentials.yaml 解析。
  const apiKey =
    opts.apiKey === undefined
      ? resolveApiKey(process.env, os.homedir())
      : typeof opts.apiKey === 'string' && opts.apiKey.trim() !== ''
        ? opts.apiKey.trim()
        : null;

  const fetchImpl =
    typeof opts.fetchImpl === 'function'
      ? opts.fetchImpl
      : typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null;

  const entries = loadCache(cachePath, logger);
  const counters = { api: 0, cache: 0, glossary: 0, passthrough: 0, failures: 0 };
  let warnedMissingKey = false;
  let warnedMissingFetch = false;

  /** 单条最终失败时的降级：术语表 → 原文直通。 */
  function fallback(entry) {
    const translated = glossaryTranslate(entry.source, glossary);
    if (typeof translated === 'string' && translated !== entry.source) {
      counters.glossary += 1;
      return { ...entry, target: translated, via: 'glossary' };
    }
    counters.passthrough += 1;
    counters.failures += 1;
    return { ...entry, target: entry.source, via: 'passthrough' };
  }

  /** 把一批待译条目合成一次请求；返回 Map<index, target>，失败返回空 Map（绝不抛，除非 caller abort）。 */
  async function requestBatch(pending, signal, systemPrompt = SYSTEM_PROMPT) {
    const empty = new Map();
    if (!apiKey) {
      if (!warnedMissingKey) {
        warnedMissingKey = true;
        logger.warn('未找到 DEEPSEEK_API_KEY（env 与 ~/.dsh/.credentials.yaml 都没有），翻译退化为术语表 / 原文直通');
      }
      return empty;
    }
    if (!fetchImpl) {
      if (!warnedMissingFetch) {
        warnedMissingFetch = true;
        logger.warn('当前运行环境没有可用的 fetch，翻译退化为术语表 / 原文直通');
      }
      return empty;
    }

    // 同 kind 只有一个时用 kind 本身作为键；同 kind 多个时用 kind_1 / kind_2 … 保证一一对应。
    const total = new Map();
    for (const item of pending) total.set(item.entry.kind, (total.get(item.entry.kind) ?? 0) + 1);
    const seq = new Map();
    const keyed = pending.map((item) => {
      const kind = String(item.entry.kind);
      let key = kind;
      if ((total.get(item.entry.kind) ?? 0) > 1) {
        const next = (seq.get(item.entry.kind) ?? 0) + 1;
        seq.set(item.entry.kind, next);
        key = `${kind}_${next}`;
      }
      return { ...item, key };
    });

    const payload = {};
    for (const item of keyed) payload[item.key] = item.entry.source;
    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `把下面 JSON 里每个值翻译成简体中文，键名保持不变：\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    };

    let attempt = 0;
    let lastError = null;
    while (attempt <= maxRetries) {
      if (signal?.aborted) throw abortError();
      const { signal: requestSignal, timeoutSignal } = buildSignals(signal, timeoutMs);
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        });
        const status = typeof res?.status === 'number' ? res.status : 0;
        const ok = res?.ok === true || (res?.ok === undefined && status >= 200 && status < 300);
        if (!ok) throw new Error(`HTTP ${status}`);
        const parsed = await readResponseJson(res);
        const content = parsed?.choices?.[0]?.message?.content;
        const translated = parseContentJson(content);
        const out = new Map();
        for (const item of keyed) {
          const value = translated[item.key];
          if (typeof value === 'string' && value.trim() !== '') out.set(item.index, value.trim());
        }
        if (out.size === 0) throw new Error('响应里没有可用的翻译字段');
        counters.api += out.size;
        logger.info(`翻译请求成功：${out.size} 条（第 ${attempt + 1} 次尝试）`);
        return out;
      } catch (err) {
        // 调用方主动 abort → 直接冒泡（契约允许的唯一抛出场景）。
        if (signal?.aborted) throw abortError();
        // 超时 signal 触发 / undici 超时错误 → 归因成超时，便于日志与重试计数
        const timedOut = (timeoutSignal && timeoutSignal.aborted) || isTimeoutError(err);
        lastError = timedOut
          ? new Error(`请求超时（${timeoutMs}ms）`)
          : isAbortError(err)
            ? new Error('请求被中止（非调用方 signal）')
            : err;
        attempt += 1;
        if (attempt > maxRetries) break;
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1), signal);
      }
    }
    logger.warn(`翻译请求失败（已重试 ${maxRetries} 次）：${lastError?.message ?? String(lastError)}`);
    return empty;
  }

  /**
   * 翻译一批条目：顺序与入参一一对应，长度相同；除 caller abort 外绝不 reject。
   * @param {Array<{kind:string, source:string}>} items
   * @param {{ signal?: AbortSignal }} [callOpts]
   */
  async function translate(items, callOpts) {
    const list = Array.isArray(items) ? items : [];
    const { signal } = callOpts ?? {};
    if (signal?.aborted) throw abortError();

    const results = new Array(list.length);
    const pending = [];

    for (let index = 0; index < list.length; index += 1) {
      const raw = list[index] ?? {};
      const kind = raw.kind;
      const source =
        typeof raw.source === 'string' ? raw.source : raw.source === undefined || raw.source === null ? '' : String(raw.source);
      const entry = { kind, source };

      // 空串 / 已是中文 → 不调 API，原样返回（cache 语义）。
      if (source.trim() === '' || isChinese(source)) {
        counters.cache += 1;
        results[index] = { ...entry, target: source, via: 'cache' };
        continue;
      }
      const hit = entries.get(cacheKey(kind, source));
      if (hit) {
        counters.cache += 1;
        results[index] = { ...entry, target: hit.target, via: 'cache' };
        continue;
      }
      pending.push({ index, entry });
    }

    if (pending.length > 0) {
      const translated = await requestBatch(pending, signal);
      for (const item of pending) {
        const target = translated.get(item.index);
        if (typeof target === 'string' && target.trim() !== '') {
          entries.set(cacheKey(item.entry.kind, item.entry.source), {
            target,
            via: 'api',
            at: new Date().toISOString(),
          });
          results[item.index] = { ...item.entry, target, via: 'api' };
        } else {
          results[item.index] = fallback(item.entry);
        }
      }
    }

    return results;
  }

  /** 计数器快照。 */
  function stats() {
    return { ...counters };
  }

  /** 原子落盘：临时文件 + rename；目录不存在则 mkdir -p；失败只 warn，不抛。 */
  async function save() {
    if (!cachePath) return;
    const data = { version: CACHE_VERSION, entries: {} };
    for (const [key, value] of entries) {
      data.entries[key] = { target: value.target, via: value.via, at: value.at };
    }
    const dir = path.dirname(cachePath);
    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      await fsp.rename(tmpPath, cachePath);
    } catch (err) {
      logger.warn(`写入翻译缓存失败：${cachePath}（${err?.message ?? err}）`);
      try {
        await fsp.unlink(tmpPath);
      } catch {
        /* 临时文件可能压根没建起来，忽略 */
      }
    }
  }

  /**
   * 从描述里起一个中文短名，给「标题就是包名」的插件用（包名不是能给人看的标题）。
   * 缓存键是 `__title__ + \0 + 描述`，与普通 title/description 互不干扰；同一描述只花一次钱。
   * @param {Array<{name:string, description:string}>} wanted 需要起名的插件。
   * @param {{signal?:AbortSignal}} [callOpts] 调用方信号。
   * @returns {Promise<Map<string,string>>} 插件名 → 中文短名（没有的不会出现在 Map 里）。
   */
  async function deriveTitle(wanted, callOpts) {
    const list = (Array.isArray(wanted) ? wanted : []).filter(
      (item) => item && typeof item.description === 'string' && item.description.trim() !== '',
    );
    const out = new Map();
    if (list.length === 0) return out;
    const { signal } = callOpts ?? {};
    if (signal?.aborted) throw abortError();

    const pending = [];
    for (const item of list) {
      const description = item.description.trim();
      const entry = { kind: DERIVED_TITLE_KIND, source: description };
      const hit = entries.get(cacheKey(entry.kind, entry.source));
      // 缓存命中也要过短名校验：旧版本把整段描述当名字缓存过，只看「是不是中文」
      // 会让坏值永久钉死（2026-10-03 的 dsh-balance-widget 就是这样）。
      if (hit && usableDerivedTitle(hit.target)) {
        counters.cache += 1;
        out.set(String(item.name), hit.target);
        continue;
      }
      pending.push({ index: pending.length, entry, name: String(item.name) });
    }
    if (pending.length === 0) return out;
    const translated = await requestBatch(pending, signal, TITLE_PROMPT);
    const tooLong = [];
    for (const item of pending) {
      const target = translated.get(item.index);
      if (usableDerivedTitle(target)) {
        store(item.entry.source, target);
        out.set(item.name, target);
      } else {
        tooLong.push({ ...item, previous: typeof target === 'string' ? target : '' });
      }
    }
    if (tooLong.length === 0) return out;

    // 第二遍：把上一条不合规的结果贴回去，明确要求压缩。插件页标题变成一整段话
    // 只有这一个来源，值得多花一次调用把它掰回来。
    const retry = tooLong.map((item, index) => ({
      index,
      name: item.name,
      entry: {
        kind: DERIVED_TITLE_KIND,
        source: `${item.entry.source}\n\n（你上一次给出的名字是「${item.previous}」，太长了；这次只回一个 2 到 8 个字的名词短语。）`,
      },
    }));
    const compressed = await requestBatch(retry, signal, COMPRESS_PROMPT);
    for (const item of retry) {
      const target = compressed.get(item.index);
      if (usableDerivedTitle(target)) {
        store(tooLong[item.index].entry.source, target);
        out.set(item.name, target);
      } else {
        counters.failures += 1;
      }
    }
    return out;

    /**
     * 把一个通过的短名写进缓存（键仍是原始描述，与重试提示无关）。
     * @param {string} source 原始描述。
     * @param {string} target 通过校验的短名。
     */
    function store(source, target) {
      entries.set(cacheKey(DERIVED_TITLE_KIND, source), {
        target,
        via: 'api',
        at: new Date().toISOString(),
      });
    }
  }

  return { translate, deriveTitle, stats, save };
}
