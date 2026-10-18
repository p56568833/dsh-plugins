/**
 * translator.test.mjs —— lib/deepseek-translator.mjs 的离线单测。
 * 全部通过注入 fetchImpl mock，绝不联网。运行：
 *   <node> --test test/translator.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createTranslator, resolveApiKey, glossaryTranslate, usableDerivedTitle } from '../lib/deepseek-translator.mjs';

/* ------------------------------- 测试工具 ------------------------------- */

/** 记录所有日志行的 logger（便于断言 warn 次数）。 */
function makeLogger() {
  const lines = { warn: [], info: [] };
  return {
    lines,
    warn: (msg) => lines.warn.push(String(msg)),
    info: (msg) => lines.info.push(String(msg)),
  };
}

/** 成功的 fetch 响应（最小 mock，不依赖全局 Response）。 */
function okResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

/** DeepSeek chat/completions 形状的成功响应。 */
function chatResponse(obj) {
  return okResponse({ choices: [{ message: { content: JSON.stringify(obj) } }] });
}

/** 非 2xx 响应。 */
function httpError(status, body = 'boom') {
  return { ok: false, status, json: async () => ({ error: body }) };
}

/** 每个测试独立的临时目录。 */
async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-l10n-zh-'));
}

/** 计数 fetch mock，返回 { fetchImpl, calls }。 */
function countingFetch(handler) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return handler(calls.length, url, init);
    },
  };
}

const TITLE_ITEM = { kind: 'title', source: 'Toggle Sidebar' };
const DESC_ITEM = { kind: 'description', source: 'Show the sidebar panel.' };

/* --------------------------------- 缓存 --------------------------------- */

test('缓存命中不调 fetch；save() 后新建 translator 能复用缓存', async () => {
  const dir = await makeTempDir();
  const cachePath = path.join(dir, 'nested', 'cache.json'); // 目录不存在 → save 要 mkdir -p
  const logger = makeLogger();

  const first = countingFetch(() => chatResponse({ title: '切换侧边栏', description: '显示侧边栏面板。' }));
  const t1 = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl: first.fetchImpl, logger });
  const results = await t1.translate([TITLE_ITEM, DESC_ITEM]);

  assert.equal(first.calls.length, 1, '缓存为空时应发一次 API 请求');
  assert.deepEqual(
    results.map((r) => r.target),
    ['切换侧边栏', '显示侧边栏面板。'],
  );
  await t1.save();

  // 原子写：不带临时文件残留
  assert.deepEqual(readdirSync(path.join(dir, 'nested')), ['cache.json']);

  // 新建 translator：缓存命中，fetch 不应被调用
  const second = countingFetch(() => {
    throw new Error('缓存命中时不应发请求');
  });
  const t2 = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl: second.fetchImpl, logger });
  const cached = await t2.translate([TITLE_ITEM, DESC_ITEM]);

  assert.equal(second.calls.length, 0);
  assert.deepEqual(
    cached.map((r) => r.target),
    ['切换侧边栏', '显示侧边栏面板。'],
  );
  assert.ok(
    cached.every((r) => r.via === 'cache'),
    '缓存命中 via 应为 cache',
  );
  assert.equal(t2.stats().cache, 2);
  assert.equal(t2.stats().api, 0);

  // 落盘形状符合契约
  const onDisk = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.deepEqual(Object.keys(onDisk.entries).sort(), ['description\u0000Show the sidebar panel.', 'title\u0000Toggle Sidebar'].sort());
  assert.equal(onDisk.entries['title\u0000Toggle Sidebar'].target, '切换侧边栏');
  assert.equal(typeof onDisk.entries['title\u0000Toggle Sidebar'].at, 'string');
});

test('缓存文件损坏 / 结构非法时不崩：当空缓存并 warn', async () => {
  const dir = await makeTempDir();
  const cachePath = path.join(dir, 'cache.json');
  await fs.writeFile(cachePath, '{ this is not json ', 'utf8');
  const logger = makeLogger();
  const { fetchImpl, calls } = countingFetch(() => chatResponse({ title: '切换侧边栏' }));

  const t = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl, logger });
  const results = await t.translate([TITLE_ITEM]);

  assert.equal(results[0].target, '切换侧边栏');
  assert.equal(calls.length, 1);
  assert.ok(
    logger.lines.warn.some((m) => m.includes('损坏')),
    '损坏缓存应 warn',
  );

  // 结构非法（entries 不是对象）
  const cachePath2 = path.join(dir, 'cache2.json');
  await fs.writeFile(cachePath2, JSON.stringify({ version: 1, entries: 'nope' }), 'utf8');
  const t2 = createTranslator({ apiKey: 'sk-test', cachePath: cachePath2, fetchImpl, logger });
  const results2 = await t2.translate([TITLE_ITEM]);
  assert.equal(results2[0].via, 'api');
});

/* --------------------------------- 批量 --------------------------------- */

test('批量：2 个 item（title + description）只发 1 次 fetch', async () => {
  const { fetchImpl, calls } = countingFetch(() =>
    chatResponse({ title: '切换侧边栏', description: '显示侧边栏面板。' }),
  );
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger: makeLogger() });

  const results = await t.translate([TITLE_ITEM, DESC_ITEM]);

  assert.equal(calls.length, 1, '两个 item 必须合并成一次请求');
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions', '默认端点');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test');
  assert.ok(body.messages[0].content.includes('{"title"'), 'system prompt 要求返回 {"title":…,"description":…}');
  assert.ok(body.messages[1].content.includes('Toggle Sidebar'));
  assert.ok(body.messages[1].content.includes('Show the sidebar panel.'));

  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.via),
    ['api', 'api'],
  );
  assert.equal(t.stats().api, 2);
});

test('批量：同 kind 的多个 item 也只发 1 次 fetch', async () => {
  const { fetchImpl, calls } = countingFetch(() => chatResponse({ title_1: '标题一', title_2: '标题二' }));
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger: makeLogger() });

  const results = await t.translate([
    { kind: 'title', source: 'First Title' },
    { kind: 'title', source: 'Second Title' },
  ]);

  assert.equal(calls.length, 1);
  assert.deepEqual(
    results.map((r) => r.target),
    ['标题一', '标题二'],
  );
});

/* ------------------------------- 重试 / 降级 ------------------------------- */

test('失败重试：先 500 再 200，最终成功（共 2 次 fetch）', async () => {
  const { fetchImpl, calls } = countingFetch((n) =>
    n === 1 ? httpError(500, 'server error') : chatResponse({ title: '切换侧边栏' }),
  );
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger: makeLogger() });

  const started = Date.now();
  const results = await t.translate([TITLE_ITEM]);
  const elapsed = Date.now() - started;

  assert.equal(calls.length, 2, '第一次失败后应重试一次');
  assert.equal(results[0].via, 'api');
  assert.equal(results[0].target, '切换侧边栏');
  assert.equal(t.stats().failures, 0);
  assert.ok(elapsed >= 450, `退避应至少约 500ms，实际 ${elapsed}ms`);
});

test('一直失败：passthrough 且不 throw，重试 maxRetries(默认 2) 次', async () => {
  const { fetchImpl, calls } = countingFetch(() => httpError(503, 'down'));
  const logger = makeLogger();
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger, glossary: {} });

  const results = await t.translate([TITLE_ITEM, DESC_ITEM]);

  assert.equal(calls.length, 3, '1 次首发 + 2 次重试');
  assert.deepEqual(
    results.map((r) => r.via),
    ['passthrough', 'passthrough'],
  );
  assert.deepEqual(
    results.map((r) => r.target),
    [TITLE_ITEM.source, DESC_ITEM.source],
  );
  assert.equal(t.stats().failures, 2);
  assert.equal(t.stats().passthrough, 2);
  assert.ok(logger.lines.warn.some((m) => m.includes('翻译请求失败')));
});

test('响应 content 不是合法 JSON：重试后仍失败 → passthrough，不 throw', async () => {
  const { fetchImpl, calls } = countingFetch(() =>
    okResponse({ choices: [{ message: { content: '抱歉，我无法完成。' } }] }),
  );
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger: makeLogger() });

  const results = await t.translate([TITLE_ITEM]);

  assert.equal(calls.length, 3);
  assert.equal(results[0].via, 'passthrough');
  assert.equal(results[0].target, TITLE_ITEM.source);
});

test('超时（AbortSignal.timeout）→ 不算 caller abort，降级 passthrough 且不 throw', async () => {
  const logger = makeLogger();
  let calls = 0;
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      calls += 1;
      init.signal?.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')), { once: true });
    });
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger, timeoutMs: 40, maxRetries: 0 });

  const results = await t.translate([TITLE_ITEM]);

  assert.equal(calls, 1);
  assert.equal(results[0].via, 'passthrough');
  assert.equal(results[0].target, TITLE_ITEM.source);
  assert.ok(
    logger.lines.warn.some((m) => m.includes('超时')),
    `应记录超时原因，实际：${JSON.stringify(logger.lines.warn)}`,
  );

  // timeoutMs: false → 不设超时 signal（这里只验证不会因为 false 而崩）
  const t2 = createTranslator({
    apiKey: 'sk-test',
    timeoutMs: false,
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal, undefined);
      return chatResponse({ title: '切换侧边栏' });
    },
    logger: makeLogger(),
  });
  assert.equal((await t2.translate([TITLE_ITEM]))[0].target, '切换侧边栏');
});

test('API 不可用时术语表兜底：命中记 glossary，未命中记 passthrough', async () => {
  const { fetchImpl } = countingFetch(() => httpError(500, 'down'));
  const t = createTranslator({
    apiKey: 'sk-test',
    fetchImpl,
    logger: makeLogger(),
    maxRetries: 0, // 重试行为另有专测，这里只关心降级链
    glossary: { 'Toggle Sidebar': '切换侧边栏' },
  });

  const results = await t.translate([TITLE_ITEM, { kind: 'description', source: 'Totally unknown words' }]);

  assert.equal(results[0].via, 'glossary');
  assert.equal(results[0].target, '切换侧边栏');
  assert.equal(results[1].via, 'passthrough');
  assert.equal(t.stats().glossary, 1);
  assert.equal(t.stats().passthrough, 1);
  assert.equal(t.stats().failures, 1, '只有真正直通的那条计入 failures');
});

test('调用方 signal 已 abort → 抛 AbortError（唯一允许的抛出场景）', async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetchImpl, calls } = countingFetch(() => chatResponse({ title: '不该发生' }));
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger: makeLogger() });

  await assert.rejects(() => t.translate([TITLE_ITEM], { signal: controller.signal }), (err) => {
    assert.equal(err.name, 'AbortError');
    return true;
  });
  assert.equal(calls.length, 0);
});

/* ------------------------------ 中文 / 无 key ------------------------------ */

test('已是中文的串直通：不发 fetch，via 为 cache，内容原样', async () => {
  const { fetchImpl, calls } = countingFetch(() => {
    throw new Error('中文串不该发请求');
  });
  const t = createTranslator({ apiKey: 'sk-test', fetchImpl, logger: makeLogger() });

  const zhTitle = { kind: 'title', source: '侧边栏中文标题' };
  const results = await t.translate([zhTitle, { kind: 'description', source: '' }]);

  assert.equal(calls.length, 0);
  assert.deepEqual(
    results.map((r) => r.target),
    ['侧边栏中文标题', ''],
  );
  assert.deepEqual(
    results.map((r) => r.via),
    ['cache', 'cache'],
  );
  assert.equal(t.stats().cache, 2);
});

test('无 apiKey：不调 fetch、不 throw，走术语表 + passthrough，warn 只提醒一次', async () => {
  const logger = makeLogger();
  const { fetchImpl, calls } = countingFetch(() => {
    throw new Error('没有 key 不该发请求');
  });
  const t = createTranslator({
    apiKey: null,
    fetchImpl,
    logger,
    glossary: { 'Toggle Sidebar': '切换侧边栏' },
  });

  const first = await t.translate([TITLE_ITEM, { kind: 'description', source: 'Unknown phrase here' }]);
  const second = await t.translate([{ kind: 'title', source: 'Another Unknown Phrase' }]);

  assert.equal(calls.length, 0);
  assert.equal(first[0].via, 'glossary');
  assert.equal(first[0].target, '切换侧边栏');
  assert.equal(first[1].via, 'passthrough');
  assert.equal(second[0].via, 'passthrough');
  assert.equal(t.stats().failures, 2);
  assert.equal(
    logger.lines.warn.filter((m) => m.includes('DEEPSEEK_API_KEY')).length,
    1,
    '缺 key 只 warn 一次',
  );
});

/* ------------------------------- resolveApiKey ------------------------------- */

test('resolveApiKey：env 优先；否则从伪 ~/.dsh/.credentials.yaml 的 refs 段读取', async () => {
  const home = await makeTempDir();
  await fs.mkdir(path.join(home, '.dsh'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.dsh', '.credentials.yaml'),
    ['# DSH credentials', 'refs:', '  DEEPSEEK_API_KEY: sk-from-file-123', '  OTHER_KEY: nope', ''].join('\n'),
    'utf8',
  );

  assert.equal(resolveApiKey({}, home), 'sk-from-file-123', '从 refs 段读到 key');
  assert.equal(
    resolveApiKey({ DEEPSEEK_API_KEY: 'sk-from-env' }, home),
    'sk-from-env',
    'env 优先于文件',
  );
  assert.equal(resolveApiKey({}, await makeTempDir()), null, '文件不存在 → null');
  assert.equal(resolveApiKey({ DEEPSEEK_API_KEY: '   ' }, await makeTempDir()), null, '空 env 视为没有');

  // 带引号 / 行尾注释 / 无 refs 段也能读
  const home2 = await makeTempDir();
  await fs.mkdir(path.join(home2, '.dsh'), { recursive: true });
  await fs.writeFile(
    path.join(home2, '.dsh', '.credentials.yaml'),
    'DEEPSEEK_API_KEY: "sk-quoted" # 注释\n',
    'utf8',
  );
  assert.equal(resolveApiKey({}, home2), 'sk-quoted');

  // 真实环境缺省参数也要能用（读本机，可能为 null，但绝不能抛）
  const real = resolveApiKey();
  assert.ok(real === null || typeof real === 'string');
});

/* ------------------------------- 顺序 / 长度 ------------------------------- */

test('translate() 返回数组长度与顺序与输入完全一致（混合命中）', async () => {
  const dir = await makeTempDir();
  const cachePath = path.join(dir, 'cache.json');
  const { fetchImpl } = countingFetch(() => chatResponse({ title: '切换侧边栏', description: '显示侧边栏面板。' }));
  const t1 = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl, logger: makeLogger() });
  await t1.translate([TITLE_ITEM, DESC_ITEM]); // 预热缓存
  await t1.save();

  const t2 = createTranslator({
    apiKey: 'sk-test',
    cachePath,
    fetchImpl: () => httpError(500, 'down'), // 未缓存的那条会失败
    maxRetries: 0, // 重试行为另有专测，这里只关心顺序与长度
    logger: makeLogger(),
  });
  const input = [
    { kind: 'title', source: 'Toggle Sidebar' }, // 缓存
    { kind: 'title', source: '侧边栏' }, // 中文直通
    { kind: 'description', source: 'Brand New Description' }, // API 失败 → passthrough
    DESC_ITEM, // 缓存
    { kind: 'title', source: '' }, // 空串直通
  ];
  const results = await t2.translate(input);

  assert.equal(results.length, input.length);
  results.forEach((r, i) => {
    assert.equal(r.kind, input[i].kind, `第 ${i} 条 kind 顺序应一致`);
    assert.equal(r.source, input[i].source, `第 ${i} 条 source 顺序应一致`);
  });
  assert.deepEqual(
    results.map((r) => r.via),
    ['cache', 'cache', 'passthrough', 'cache', 'cache'],
  );
  assert.equal((await t2.translate([])).length, 0, '空数组返回空数组');
});

/* ------------------------------ glossaryTranslate ------------------------------ */

test('glossaryTranslate：整串精确命中优先、长词优先、大小写不敏感、不做二次替换', () => {
  const glossary = {
    DSH: 'DSH 框架',
    'Plugin Manager': '插件管理器',
    'plugin manager changed': '插件管理器变更',
    toggle: '切换',
  };

  assert.equal(glossaryTranslate('DSH', glossary), 'DSH 框架', '整串精确命中');
  assert.equal(glossaryTranslate('plugin manager changed', glossary), '插件管理器变更', '整串精确命中优先于词组替换');
  assert.equal(glossaryTranslate('Plugin Manager', glossary), '插件管理器');
  assert.equal(glossaryTranslate('Toggle the DSH plugin', glossary), '切换 the DSH 框架 plugin');
  assert.equal(glossaryTranslate('TOGGLE DSH', glossary), '切换 DSH 框架', '大小写不敏感');
  // 长词先替换：若先替换 DSH 会破坏不了；这里验证 "Plugin Manager" 不会被 plugin 等短词拆坏
  assert.equal(glossaryTranslate('x Plugin Manager y', glossary), 'x 插件管理器 y');
  assert.equal(glossaryTranslate('', glossary), '');
  assert.equal(glossaryTranslate('nothing here', glossary), 'nothing here');
  assert.equal(glossaryTranslate('anything', undefined), 'anything');
  // 替换结果不会被再次扫描替换（DSH 的译文里没有英文术语，构造一个会自伤的用例）
  const selfHarm = { A: 'AB', AB: 'X' };
  assert.equal(glossaryTranslate('AB', selfHarm), 'X');
  assert.equal(glossaryTranslate('A B', selfHarm), 'AB B');
  // 正则特殊字符术语
  assert.equal(glossaryTranslate('use a.b now', { 'a.b': 'A点B' }), 'use A点B now');
});

/* ---------------------------- 起中文短名校验 ---------------------------- */

const BAD_LONG_TITLE =
  'DeepSeek Harness GUI（网页版与桌面应用）的余额与费用小组件：侧边栏页脚卡片显示账户余额与今日费用。';
const BALANCE_DESC = 'Balance & cost widget for the DeepSeek Harness GUI (web and desktop app): a sidebar footer card.';

test('usableDerivedTitle：长度、标点、汉字数三重判据', () => {
  assert.equal(usableDerivedTitle('余额费用小组件'), true, '正常短名通过');
  assert.equal(usableDerivedTitle('跨会话记忆'), true);
  assert.equal(usableDerivedTitle('Claude Code 风格'), true, '中英混排、≤16 字符、无标点，可接受');
  assert.equal(usableDerivedTitle(BAD_LONG_TITLE), false, '整段描述必须被拒');
  assert.equal(usableDerivedTitle('余额与费用小组件：侧边栏卡片'), false, '带冒号被拒');
  assert.equal(usableDerivedTitle('Balance & cost widget'), false, '没有汉字被拒');
  assert.equal(usableDerivedTitle('  '), false);
  assert.equal(usableDerivedTitle('插件\n汉化'), false, '换行被拒');
  assert.equal(usableDerivedTitle(undefined), false);
});

test('deriveTitle：第一遍返回整段描述时，第二遍压缩成短名', async () => {
  const dir = await makeTempDir();
  const cachePath = path.join(dir, 'cache.json');
  const logger = makeLogger();
  const { fetchImpl, calls } = countingFetch((n) =>
    n === 1 ? chatResponse({ __title__: BAD_LONG_TITLE }) : chatResponse({ __title__: '余额费用小组件' }),
  );
  const t = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl, logger });

  const out = await t.deriveTitle([{ name: 'dsh-balance-widget', description: BALANCE_DESC }]);

  assert.equal(calls.length, 2, '不合格必须再试一次');
  assert.equal(out.get('dsh-balance-widget'), '余额费用小组件');
  await t.save();

  // 压缩后的短名按原始描述入缓存：下次直接命中，不再花钱。
  const again = countingFetch(() => chatResponse({ __title__: '不该被调用' }));
  const t2 = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl: again.fetchImpl, logger });
  const out2 = await t2.deriveTitle([{ name: 'dsh-balance-widget', description: BALANCE_DESC }]);
  assert.equal(again.calls.length, 0, '通过校验的短名应当命中缓存');
  assert.equal(out2.get('dsh-balance-widget'), '余额费用小组件');
});

test('deriveTitle：两遍都不合格时不起名（宁可用包名兜底）', async () => {
  const dir = await makeTempDir();
  const cachePath = path.join(dir, 'cache.json');
  const logger = makeLogger();
  const { fetchImpl, calls } = countingFetch(() => chatResponse({ __title__: BAD_LONG_TITLE }));
  const t = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl, logger });

  const out = await t.deriveTitle([{ name: 'x', description: BALANCE_DESC }]);

  assert.equal(calls.length, 2, '最多两遍');
  assert.equal(out.has('x'), false, '不合格的短名不进结果');
  assert.equal(t.stats().failures, 1);
});

test('deriveTitle：缓存里的超长名字视为未命中并重起', async () => {
  const dir = await makeTempDir();
  const cachePath = path.join(dir, 'cache.json');
  const logger = makeLogger();
  await fs.writeFile(
    cachePath,
    JSON.stringify({
      version: 1,
      entries: { [`__title__\u0000${BALANCE_DESC}`]: { target: BAD_LONG_TITLE, via: 'api', at: '2026-10-03T00:00:00.000Z' } },
    }),
    'utf8',
  );
  const { fetchImpl, calls } = countingFetch(() => chatResponse({ __title__: '余额费用小组件' }));
  const t = createTranslator({ apiKey: 'sk-test', cachePath, fetchImpl, logger });

  const out = await t.deriveTitle([{ name: 'dsh-balance-widget', description: BALANCE_DESC }]);

  assert.equal(calls.length, 1, '坏缓存不能被当成命中，必须重新问一次');
  assert.equal(out.get('dsh-balance-widget'), '余额费用小组件');
});
