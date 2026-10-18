/**
 * dsh-balance-widget-patch — host half.
 *
 * 两件事：
 *
 *   1. **守住补丁**。本地补丁以 `payload/lib/*` 的成品文件形式随包发布，
 *      内容 = npm 官方 dsh-balance-widget 0.6.3 + 本机补丁。pnpm 重装/升级会把
 *      node_modules 里的文件换回官方原版，于是这里在启动时、安装事件后和定时
 *      巡检时比一次 SHA256：目标文件等于官方原版就写回我们的成品；已经是我们的
 *      成品就什么都不做；**既不是官方原版也不是我们的成品就一概不碰**（那是上游
 *      发了新版），只记状态并让面板显示出来。
 *
 *   2. **Go 额度**。注册 `/api/dsh-quota/go`，用本机凭据里的 OpenCode 推理密钥读
 *      Console 用量接口，算出 5 小时 / UTC 本周 / 账期三条窗口的已用与上限，
 *      供卡片上的「额度」模式显示。
 *
 * 设计约束：绝不阻塞、绝不抛错；任何异常只写日志，不影响 DSH 主流程。
 *
 * @module dsh-balance-widget-patch
 */

import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "balance-widget-patch";

/** 只要 webServer 就能活；凭据服务按需 ctx.get，缺了也只是额度读不到。 */
export const inject = ["webServer"];

const HERE = dirname(fileURLToPath(import.meta.url));
/** 成品文件根目录：payload/lib/index.js 对应目标的 lib/index.js。 */
const PAYLOAD_ROOT = join(HERE, "payload");
const LOG_DIR = join(homedir(), ".dsh", "balance-widget-patch");
const LOG_FILE = join(LOG_DIR, "log.ndjson");

/** 被补的目标包。 */
const TARGET_PACKAGE = "dsh-balance-widget";
/** 本插件自己的包名：用来反查"我在哪个 profile 里"。 */
const SELF_PACKAGE = "dsh-balance-widget-patch";

/** 两条自有路由（与 dsh-balance-widget 的 /api/dsh-balance/* 不重叠）。 */
const QUOTA_ROUTE = "/api/dsh-quota/go";
const STATUS_ROUTE = "/api/dsh-quota/status";
/**
 * 浏览器端探针把看到的 DOM 事实回传到这里（只读诊断，回环限定）。
 * 只留在内存里、不落盘：这样本机任何进程乱灌也不会把日志写爆。
 */
const PROBE_ROUTE = "/api/dsh-quota/probe";
/** 最近一份探针报告（内存，重启即失）。 */
let lastProbe = null;

/** 巡检间隔：10 分钟两次读文件 + 两次哈希，代价可以忽略。 */
const HEAL_INTERVAL_MS = 600000;
/** 安装事件后的去抖。 */
const HEAL_DEBOUNCE_MS = 1500;

//#region 配置
/**
 * 配置声明。与 dsh-balance-widget 同样的手法：手写 Standard Schema，
 * 不 import 任何 @deepseek-ai/*，这样 link: 布局下也一定解析得到。
 */
const CONFIG_FIELDS = {
	goMode: "string",
	goBaseURL: "string",
	goApiKeyEnv: "string",
	goPeriodStart: "string",
	goPeriodEnd: "string",
	goFiveHourResetAt: "string",
	goOAuthTokenFile: "string",
	goOAuthClientId: "string",
	goConsoleLive: "boolean",
	goFiveHourLimitUsd: "number",
	goWeekLimitUsd: "number",
	goMonthLimitUsd: "number",
	requestTimeoutMs: "number",
	autoHeal: "boolean"
};
const CONFIG_DEFAULTS = {
	// 卡片默认落在哪一档；弹层里的切换按钮会记住用户自己的选择（localStorage）。
	goMode: "balance",
	goBaseURL: "https://opencode.ai",
	goApiKeyEnv: "OPENCODE_GO_API_KEY",
	// 账期：默认由 goConsoleLive 实时读 Console 账单（payment-attempts），续费自动跟随；
	// 读不到才退回这两个手工值，都没有就按 UTC 自然月。goPeriodEnd 优先于 goPeriodStart。
	goPeriodStart: "",
	goPeriodEnd: "",
	// 5 小时窗口：Console 上是「接力式固定窗口」，给一个见过的窗口终点就能一路推下去；
	// 留空则退回「最近 5 小时」——换窗之后会明显高估。
	goFiveHourResetAt: "",
	// Console OAuth 令牌文件（device flow 的 access_token / refresh_token）；空 = 默认位置。
	goOAuthTokenFile: "",
	// 令牌文件里没写 client_id 时，用它来 refresh。
	goOAuthClientId: "",
	// 总开关：关掉就只用手工配置，完全不去读账单。
	goConsoleLive: true,
	// OpenCode Go 每模型上限：Flash 16 / 40 / 80（月 $80 的 20% / 50% / 100%）。
	// 切到 V4 Pro（月 $15）时把三条改成 3 / 7.5 / 15。
	goFiveHourLimitUsd: 16,
	goWeekLimitUsd: 40,
	goMonthLimitUsd: 80,
	requestTimeoutMs: 8000,
	autoHeal: true
};

export const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-balance-widget-patch",
		validate(value) {
			if (value === void 0 || value === null) value = {};
			if (typeof value !== "object") return { issues: [{ message: "config must be an object", path: [] }] };
			const out = {};
			for (const [key, type] of Object.entries(CONFIG_FIELDS)) {
				const raw = value[key];
				const fallback = CONFIG_DEFAULTS[key];
				if (raw === void 0 || raw === null) {
					out[key] = fallback;
					continue;
				}
				if (type === "string") out[key] = typeof raw === "string" ? raw : fallback;
				else if (type === "number") out[key] = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : fallback;
				else if (type === "boolean") out[key] = typeof raw === "boolean" ? raw : fallback;
				else out[key] = fallback;
			}
			return { value: out };
		}
	},
	shape: CONFIG_FIELDS,
	defaults: CONFIG_DEFAULTS
};

/** 补上缺省值并做一次范围收敛。 */
function resolveConfig(raw) {
	const value = typeof raw === "object" && raw !== null ? raw : {};
	const string = (key) => (typeof value[key] === "string" ? value[key] : Config.defaults[key]);
	const number = (key) => (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] > 0 ? value[key] : Config.defaults[key]);
	return {
		goMode: value.goMode === "quota" ? "quota" : "balance",
		goBaseURL: string("goBaseURL") === "" ? Config.defaults.goBaseURL : string("goBaseURL"),
		goApiKeyEnv: string("goApiKeyEnv") === "" ? Config.defaults.goApiKeyEnv : string("goApiKeyEnv"),
		goPeriodStart: string("goPeriodStart"),
		goPeriodEnd: string("goPeriodEnd"),
		goFiveHourResetAt: string("goFiveHourResetAt"),
		goOAuthTokenFile: string("goOAuthTokenFile"),
		goOAuthClientId: string("goOAuthClientId"),
		goConsoleLive: typeof value.goConsoleLive === "boolean" ? value.goConsoleLive : Config.defaults.goConsoleLive,
		goFiveHourLimitUsd: number("goFiveHourLimitUsd"),
		goWeekLimitUsd: number("goWeekLimitUsd"),
		goMonthLimitUsd: number("goMonthLimitUsd"),
		requestTimeoutMs: number("requestTimeoutMs"),
		autoHeal: typeof value.autoHeal === "boolean" ? value.autoHeal : Config.defaults.autoHeal
	};
}
//#endregion

//#region 小工具
/** 追加一行 NDJSON 日志；写不进去就算了。 */
function logLine(record) {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, "utf8");
	} catch {
		/* 日志不是故障点 */
	}
}

/** 文件 SHA256（小写十六进制）。 */
function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/** 读 JSON，失败返回 undefined。 */
function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return void 0;
	}
}

/** loopback 守卫（与 dsh-balance-widget 同款）。 */
function isLoopbackRequest(req) {
	const address = req.socket?.remoteAddress ?? "";
	return address === "::1"
		|| address === "::ffff:127.0.0.1"
		|| address === "127.0.0.1"
		|| address === "localhost"
		|| address.startsWith("::ffff:127.");
}

/** 守卫：只允许回环地址 + 指定方法。 */
function guard(req, res, method) {
	if (!isLoopbackRequest(req)) {
		writeJson(res, 403, { error: "forbidden: loopback-only" });
		return false;
	}
	if ((req.method ?? "GET") !== method) {
		writeJson(res, 405, { error: `method not allowed: ${req.method}` });
		return false;
	}
	return true;
}

/** 输出 JSON。 */
function writeJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead?.(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end?.(body);
}
//#endregion

//#region 补丁自愈
/** 真实路径的小写形式（比不出结果就返回 null，不抛）。 */
function safeRealpath(path) {
	try {
		return realpathSync(path).toLowerCase();
	} catch {
		return null;
	}
}

/**
 * 哪些 profile 的 node_modules 里装着我们自己。
 * link: 布局下 import.meta.url 已经解析到仓库真身，但 profile 里那个 junction
 * 指向同一个真身 —— 用真实路径比对就能确定"我在哪个 profile 里"，不用猜。
 */
function profilesHostingSelf(profilesRoot) {
	let names = [];
	try {
		names = readdirSync(profilesRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
	const selfReal = safeRealpath(HERE);
	if (selfReal === null) return [];
	const found = [];
	for (const name of names) {
		const link = join(profilesRoot, name, "node_modules", SELF_PACKAGE);
		if (existsSync(link) && safeRealpath(link) === selfReal) {
			found.push(join(profilesRoot, name, "node_modules", TARGET_PACKAGE));
		}
	}
	return found;
}

/**
 * 目标包安装目录；判不出来就返回 null（宁可不修，也不去动别的 profile）。
 *
 * profile 判定顺序：
 *   1. 环境变量 DSH_PROFILE_DIR（宿主给的，最准）；
 *   2. ctx.get("profileContext").name；
 *   3. 反查哪个 profile 的 node_modules 里装着我们自己。
 */
function resolveTargetDir(ctx) {
	const profilesRoot = join(process.env.DSH_HOME || join(homedir(), ".dsh"), "profiles");
	const explicit = [];
	const profileDir = process.env.DSH_PROFILE_DIR;
	if (typeof profileDir === "string" && profileDir !== "") explicit.push(profileDir);
	let profileName;
	try {
		profileName = ctx.get?.("profileContext")?.name;
	} catch {
		profileName = void 0;
	}
	if (typeof profileName === "string" && profileName !== "") explicit.push(join(profilesRoot, profileName));
	const candidates = explicit.map((dir) => join(dir, "node_modules", TARGET_PACKAGE));
	candidates.push(...profilesHostingSelf(profilesRoot));
	for (const dir of candidates) {
		if (existsSync(join(dir, "package.json"))) return dir;
	}
	return null;
}

/**
 * 自愈状态（也通过 /status 暴露给面板）。
 * @type {{at:string|null, reason:string|null, targetDir:string|null, version:string|null, status:string, files:object, applied:string[], needsRestart:boolean}}
 */
const healState = {
	at: null,
	reason: null,
	targetDir: null,
	version: null,
	status: "unknown",
	files: {},
	applied: [],
	needsRestart: false,
	/** 目标包目录是否只是指向 pnpm store 的链接（macOS 用 isolated linker 时会为 true）。 */
	storeLinked: false
};

/**
 * 目标包目录是不是指向别处（pnpm 的 isolated linker 会把 <profile>/node_modules/<pkg>
 * 做成指到 store 的链接；macOS 上是 symlink，Windows 上是 junction）。
 *
 * 为什么关心：那样写回会落进 **pnpm store**，被所有共用这个 store 的 profile 看到。
 * 本机 desktop profile 是 `nodeLinker: hoisted`（真目录），所以这里是 false。
 */
function targetIsStoreLinked(targetDir) {
	const real = safeRealpath(targetDir);
	return real !== null && real !== targetDir.toLowerCase();
}

/**
 * 把一个目标文件对齐到成品。
 *
 * 允许写回的情形只有两种：文件是 npm 官方原版（pristine），或者是我们自己
 * 上一版补丁的成品（previous）——后者让 payload 升级能自动顶掉旧补丁。
 * 其余一律不碰（那是上游发了新版）。
 *
 * @returns {{status:string}} ok=已是成品｜applied=刚写回｜missing｜unknown
 */
function healFile(targetPath, payloadPath, pristineHash, previousHashes, payloadHash) {
	if (!existsSync(targetPath)) return { status: "missing" };
	const payload = readFileSync(payloadPath);
	const current = readFileSync(targetPath);
	const currentHash = sha256(current);
	if (currentHash === payloadHash) return { status: "ok" };
	if (currentHash !== pristineHash && !previousHashes.includes(currentHash)) {
		return { status: "unknown", found: currentHash };
	}
	// 原子替换：先写临时文件再改名，避免半截文件被 HMR 读到。
	const temp = `${targetPath}.dshbwp.tmp`;
	try {
		writeFileSync(temp, payload);
		renameSync(temp, targetPath);
	} catch (error) {
		// 极端情况下（例如 pnpm 正占着文件）rename 可能失败，别把临时文件留在包里。
		try {
			rmSync(temp, { force: true });
		} catch { /* 尽力而为 */ }
		return { status: "write-failed", error: error instanceof Error ? error.message : String(error) };
	}
	return { status: "applied", from: currentHash === pristineHash ? "pristine" : "previous-payload" };
}

/**
 * 跑一遍自愈。
 * @param {object} ctx 宿主上下文。
 * @param {string} reason 触发原因。
 * @returns {object} 本次状态。
 */
function heal(ctx, reason) {
	const targets = readJson(join(HERE, "targets.json"));
	if (targets === void 0) {
		healState.status = "no-targets";
		return healState;
	}
	const targetDir = resolveTargetDir(ctx);
	const files = {};
	const applied = [];
	/** payload 改了却忘了跑 build-patch 时，targets.json 里的 payload 记录会过期。 */
	const staleRecords = [];
	let needsRestart = false;
	let storeLinked = false;
	let status = "ok";
	/** 状态优先级：error > unknown-version > file-missing > degraded > ok。 */
	const raise = (next) => {
		const rank = { ok: 0, degraded: 1, "file-missing": 2, "unknown-version": 3, error: 4 };
		if (rank[next] > rank[status]) status = next;
	};
	try {
		if (targetDir === null) {
			healState.at = new Date().toISOString();
			healState.reason = reason;
			healState.targetDir = null;
			healState.version = null;
			healState.files = {};
			healState.applied = [];
			healState.needsRestart = false;
			healState.status = "no-profile";
			return healState;
		}
		const manifest = readJson(join(targetDir, "package.json"));
		const version = typeof manifest?.version === "string" ? manifest.version : null;
		healState.targetDir = targetDir;
		healState.version = version;
		storeLinked = targetIsStoreLinked(targetDir);
		if (version !== targets.version) {
			healState.status = "version-mismatch";
			healState.at = new Date().toISOString();
			healState.reason = reason;
			healState.files = {};
			healState.applied = [];
			healState.needsRestart = false;
			return healState;
		}
		for (const [relative, meta] of Object.entries(targets.files ?? {})) {
			const targetPath = join(targetDir, ...relative.split("/"));
			const payloadPath = join(PAYLOAD_ROOT, ...relative.split("/"));
			if (!existsSync(payloadPath)) {
				files[relative] = { status: "no-payload" };
				raise("degraded");
				continue;
			}
			const payloadHash = sha256(readFileSync(payloadPath));
			if (typeof meta.payload === "string" && meta.payload !== payloadHash) staleRecords.push(relative);
			const result = healFile(targetPath, payloadPath, meta.pristine, Array.isArray(meta.previous) ? meta.previous : [], payloadHash);
			files[relative] = { ...result, payload: payloadHash, pristine: meta.pristine };
			if (result.status === "applied") {
				applied.push(relative);
				// host 半边的补丁必须重启才生效；client.js 有 client-hmr 会自己热重载。
				if (relative.startsWith("lib/index")) needsRestart = true;
			} else if (result.status === "unknown") raise("unknown-version");
			else if (result.status === "missing") raise("file-missing");
			else if (result.status === "write-failed" || result.status === "no-payload") raise("degraded");
		}
	} catch (error) {
		status = "error";
		files.error = String(error instanceof Error ? error.message : error);
	}
	healState.at = new Date().toISOString();
	healState.reason = reason;
	healState.files = files;
	healState.applied = applied;
	healState.needsRestart = needsRestart;
	healState.storeLinked = storeLinked;
	healState.status = status;
	if (applied.length > 0) {
		logLine({ event: "heal", reason, targetDir, applied, needsRestart, storeLinked });
		ctx.logger?.info?.(`dsh-balance-widget-patch: 已写回补丁 ${applied.join("、")}${needsRestart ? "（host 半边刚被写回：若当前进程加载的是官方原版，重启 DSH 后才生效）" : "（浏览器半边约 0.5s 内热重载）"}`);
		if (storeLinked) {
			ctx.logger?.warn?.(`dsh-balance-widget-patch: ${TARGET_PACKAGE} 在 profile 里是指向 pnpm store 的链接目录 —— 补丁写进了共享 store（同一 store 的其他 profile 也会带上它）。想让补丁只作用于本 profile，请在 profile 的 pnpm-workspace.yaml 里设 nodeLinker: hoisted 后重装。`);
		}
	} else if (status !== "ok") {
		logLine({ event: "heal", reason, targetDir, status, files });
		ctx.logger?.warn?.(`dsh-balance-widget-patch: 补丁未对齐（${status}），未改动任何文件`);
	}
	if (staleRecords.length > 0) {
		logLine({ event: "stale-targets", files: staleRecords });
		ctx.logger?.warn?.(`dsh-balance-widget-patch: targets.json 的 payload 记录已过期（${staleRecords.join("、")}）—— 改过 payload 后请跑 tools/build-patch.mjs 刷新 previous / payload 记录`);
	}
	return healState;
}
//#endregion

//#region OpenCode Go 额度
const GO_PROVIDER_RE = /opencode/i;
const GO_TIER_RE = /pro/i;

/** UTC 周一 00:00Z。 */
function utcWeekStart(now) {
	const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	return midnight - ((now.getUTCDay() + 6) % 7) * 86400000;
}

/** UTC 月初。 */
function utcMonthStart(now) {
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/** 下个 UTC 月初（月窗口按自然月时，用它当重置时刻）。 */
function nextUtcMonthStart(now) {
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/** Console 的 microcents → USD。 */
function microcentsToUsd(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed / 1e8 : 0;
}

/** 凭据服务 → 启动环境 → process.env。 */
async function resolveKey(ctx, envName) {
	try {
		const credentials = ctx.get?.("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(envName);
			if (hit !== void 0 && hit.value !== void 0 && hit.value !== "") return hit.value;
		}
	} catch {
		/* 没有凭据服务就走下一档 */
	}
	try {
		const environment = ctx.get?.("launchEnvironment");
		if (environment !== void 0) {
			const entry = environment.get(envName);
			if (entry !== void 0 && entry.value.length > 0) return entry.value;
		}
	} catch {
		/* ignore */
	}
	const ambient = process.env[envName];
	return ambient !== void 0 && ambient !== "" ? ambient : void 0;
}

/** Go 每模型的月额度，以及 5 小时 20% / 周 50% / 账期 100% 三条窗口。 */
const GO_TIER_LIMITS = {
	flash: { fiveHour: 16, week: 40, month: 80 },
	pro: { fiveHour: 3, week: 7.5, month: 15 }
};

/** 5 小时窗口的长度。 */
const FIVE_HOUR_MS = 5 * 3600000;

//#region Console 账单（OAuth）

/** 令牌文件默认位置：和日志同目录。 */
function defaultTokenFile() {
	return join(LOG_DIR, "oauth.json");
}

/** 一次带令牌的 Console 读取。 */
async function consoleGet(config, token, path) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
	try {
		const response = await fetch(`${config.goBaseURL.replace(/\/+$/, "")}${path}`, {
			method: "GET",
			headers: { accept: "application/json", authorization: `Bearer ${token}` },
			signal: controller.signal
		});
		let body;
		try {
			body = await response.json();
		} catch {
			body = null;
		}
		return { status: response.status, body };
	} catch (error) {
		return { status: 0, body: null, error: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
}

/** 原子写回令牌文件（0600）：先写临时文件再改名，别留半截。 */
function writeTokenFile(file, tokens) {
	const temp = `${file}.tmp`;
	try {
		writeFileSync(temp, JSON.stringify(tokens, null, "\t"));
		chmodSync(temp, 0o600);
		renameSync(temp, file);
		return true;
	} catch {
		try {
			rmSync(temp, { force: true });
		} catch { /* 尽力而为 */ }
		return false;
	}
}

/** 用 refresh_token 换新令牌；成功就写回文件（refresh_token 会轮换）。 */
async function refreshTokens(config, file, tokens) {
	const clientId = typeof tokens.client_id === "string" && tokens.client_id !== "" ? tokens.client_id : config.goOAuthClientId;
	if (clientId === "" || typeof tokens.refresh_token !== "string" || tokens.refresh_token === "") return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
	try {
		const response = await fetch(`${config.goBaseURL.replace(/\/+$/, "")}/console/auth/oauth/token`, {
			method: "POST",
			headers: { accept: "application/json", "content-type": "application/json" },
			body: JSON.stringify({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }),
			signal: controller.signal
		});
		if (!response.ok) return null;
		const next = await response.json();
		if (typeof next?.access_token !== "string") return null;
		// refresh 的响应不带 org_id，别把它弄丢。
		const merged = { ...next, client_id: clientId, org_id: next.org_id ?? tokens.org_id, obtainedAt: new Date().toISOString() };
		writeTokenFile(file, merged);
		return merged;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Go 订阅的付款记录类型；账期从最新一笔成功付款开始。 */
const GO_ATTEMPT_TYPES = ["go_initial", "go_renewal", "go_upgrade"];

/** 一条付款记录上的时间戳，取第一个能解析的。 */
function attemptStampMs(attempt) {
	for (const key of ["lifecycleAppliedAt", "settledAt", "paidAt", "createdAt"]) {
		const value = Date.parse(String(attempt?.[key] ?? ""));
		if (Number.isFinite(value)) return value;
	}
	return Number.NaN;
}

/**
 * 账期起点/终点优先从 Console 的账单记录实时取：
 *   GET /console/api/billing/payment-attempts → 最新一笔 go_* 成功付款的
 *   lifecycleAppliedAt / settledAt 就是本账期起点，终点 = 下月同日。
 * 续费会产生新的 go_renewal 记录，所以这个值不需要人工维护。
 *
 * 令牌过期时用 refresh_token 续一次并写回文件。任何一步失败都返回 { error }，
 * 交给调用方退回配置值 —— 账单读不到绝不能让卡片空掉。
 */
async function fetchLivePeriod(config) {
	if (!config.goConsoleLive) return { error: "disabled" };
	const file = config.goOAuthTokenFile === "" ? defaultTokenFile() : config.goOAuthTokenFile;
	let tokens = readJson(file);
	if (tokens === void 0 || typeof tokens?.access_token !== "string" || tokens.access_token === "") return { error: "no-token" };
	let read = await consoleGet(config, tokens.access_token, "/console/api/billing/payment-attempts");
	if (read.status === 401) {
		tokens = await refreshTokens(config, file, tokens);
		if (tokens === null) return { error: "refresh-failed" };
		read = await consoleGet(config, tokens.access_token, "/console/api/billing/payment-attempts");
	}
	if (read.status !== 200 || !Array.isArray(read.body)) return { error: `attempts-${read.status}` };
	const paid = read.body.filter((attempt) => GO_ATTEMPT_TYPES.includes(String(attempt?.attemptType)) && (attempt?.status === "succeeded" || attempt?.status === "paid"));
	let startMs = Number.NaN;
	for (const attempt of paid) {
		const stamp = attemptStampMs(attempt);
		if (Number.isFinite(stamp) && (!Number.isFinite(startMs) || stamp > startMs)) startMs = stamp;
	}
	if (!Number.isFinite(startMs)) return { error: "no-attempt" };
	const end = new Date(startMs);
	end.setUTCMonth(end.getUTCMonth() + 1);
	return { sinceMs: startMs, resetsAtMs: end.getTime(), source: "console-billing" };
}

/** 5 小时窗口：Console 上是接力式固定窗口，终点落在 anchor + 5h×k 上。 */
function fixedFiveHourWindow(anchorMs, nowMs) {
	const steps = Math.ceil((nowMs - anchorMs) / FIVE_HOUR_MS);
	const resetsAtMs = anchorMs + steps * FIVE_HOUR_MS;
	return { sinceMs: resetsAtMs - FIVE_HOUR_MS, resetsAtMs };
}

/** 账期窗口（毫秒）：实时账单 > goPeriodEnd > goPeriodStart+30 天 > UTC 自然月。 */
function billingPeriodWindow(config, live, now) {
	if (live?.source !== void 0) return { sinceMs: live.sinceMs, resetsAtMs: live.resetsAtMs, anchor: "billing-period-live" };
	const periodEndMs = config.goPeriodEnd === "" ? Number.NaN : Date.parse(config.goPeriodEnd);
	if (Number.isFinite(periodEndMs)) {
		const explicitStart = config.goPeriodStart === "" ? Number.NaN : Date.parse(config.goPeriodStart);
		let start = Number.isFinite(explicitStart) ? explicitStart : periodEndMs - 30 * 86400000;
		let end = periodEndMs;
		// 手工填的终点是一次性的：过了续费日就按月往前滚，配置不用改。
		for (let i = 0; i < 240 && end <= now.getTime(); i += 1) {
			const s = new Date(start);
			const e = new Date(end);
			s.setUTCMonth(s.getUTCMonth() + 1);
			e.setUTCMonth(e.getUTCMonth() + 1);
			start = s.getTime();
			end = e.getTime();
		}
		return { sinceMs: start, resetsAtMs: end, anchor: "billing-period" };
	}
	const periodStartMs = config.goPeriodStart === "" ? Number.NaN : Date.parse(config.goPeriodStart);
	if (Number.isFinite(periodStartMs)) return { sinceMs: periodStartMs, resetsAtMs: periodStartMs + 30 * 86400000, anchor: "billing-period" };
	return { sinceMs: utcMonthStart(now), resetsAtMs: nextUtcMonthStart(now), anchor: "utc-month" };
}
//#endregion

/** 一次用量调用：返回该区间里的 provider 行。 */
async function fetchRows(ctx, config, sinceMs) {
	const key = await resolveKey(ctx, config.goApiKeyEnv);
	if (key === void 0) return { ok: false, error: `no API key for ${config.goApiKeyEnv}` };
	const base = config.goBaseURL.replace(/\/+$/, "");
	const url = `${base}/console/api/usage/models?since=${encodeURIComponent(new Date(sinceMs).toISOString())}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
	try {
		const response = await fetch(url, {
			method: "GET",
			headers: { accept: "application/json", authorization: `Bearer ${key}` },
			signal: controller.signal
		});
		if (!response.ok) return { ok: false, error: `usage responded ${response.status}` };
		const payload = await response.json();
		const items = Array.isArray(payload?.items) ? payload.items : [];
		// 优先 opencode 的 provider 行；provider 写法变了就退回全部行。
		const goRows = items.filter((item) => GO_PROVIDER_RE.test(String(item?.provider ?? "")));
		return { ok: true, rows: goRows.length > 0 ? goRows : items };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	} finally {
		clearTimeout(timer);
	}
}

/** 账期里花钱最多的模型决定档位 —— Go 的额度是按模型给的。 */
function tierOf(rows) {
	if (rows.length === 0) return "flash";
	let heaviest = rows[0];
	for (const row of rows) {
		if (Number(row?.totalCostMicroCents) > Number(heaviest?.totalCostMicroCents)) heaviest = row;
	}
	return GO_TIER_RE.test(String(heaviest?.model ?? "")) ? "pro" : "flash";
}

/** 同一档位模型在该区间的合计。 */
function usedOf(rows, tier) {
	const wanted = tier === "pro";
	let selected = rows.filter((row) => GO_TIER_RE.test(String(row?.model ?? "")) === wanted);
	// 同档位一行都没有时，只有"整个窗口只有一个模型"才退回全部行（模型命名变了
	// 时的兜底）；否则会把另一档的用量算进本档上限，不如如实显示 0。
	const distinct = new Set(rows.map((row) => String(row?.model ?? "")));
	if (selected.length === 0 && distinct.size <= 1) selected = rows;
	return {
		usedUsd: selected.reduce((total, row) => total + microcentsToUsd(row?.totalCostMicroCents), 0),
		requests: selected.reduce((total, row) => total + (Number(row?.totalRequests) || 0), 0),
		models: [...new Set(selected.map((row) => String(row?.model ?? "")))].filter((entry) => entry !== "")
	};
}

/** 上限：配置里显式改过就用配置值，否则按档位默认（Flash 16/40/80，Pro 3/7.5/15）。 */
function limitOf(config, tier, definition) {
	const configured = config[definition.limitField];
	if (configured !== Config.defaults[definition.limitField]) return configured;
	return GO_TIER_LIMITS[tier][definition.limitKey];
}

/** 三条窗口的已用/上限，或第一个错误。 */
async function fetchQuota(ctx, config) {
	const now = new Date();
	// 账期：先试实时账单，失败就退回配置/UTC 自然月（见 billingPeriodWindow）。
	const live = await fetchLivePeriod(config);
	const period = billingPeriodWindow(config, live, now);
	const anchorMs = config.goFiveHourResetAt === "" ? Number.NaN : Date.parse(config.goFiveHourResetAt);
	const fiveHour = Number.isFinite(anchorMs) ? fixedFiveHourWindow(anchorMs, now.getTime()) : null;
	const definitions = [
		{
			id: "fiveHour",
			limitField: "goFiveHourLimitUsd",
			limitKey: "fiveHour",
			// 没给锚点就退回「最近 5 小时」：只会偏保守，但换窗之后会明显高估。
			sinceMs: fiveHour !== null ? fiveHour.sinceMs : now.getTime() - FIVE_HOUR_MS,
			anchor: fiveHour !== null ? "fixed-5h" : "rolling5h",
			resetsAt: fiveHour !== null ? new Date(fiveHour.resetsAtMs).toISOString() : null
		},
		{
			id: "week",
			limitField: "goWeekLimitUsd",
			limitKey: "week",
			sinceMs: utcWeekStart(now),
			anchor: "utc-week",
			resetsAt: new Date(utcWeekStart(now) + 7 * 86400000).toISOString()
		},
		{
			id: "month",
			limitField: "goMonthLimitUsd",
			limitKey: "month",
			sinceMs: period.sinceMs,
			anchor: period.anchor,
			resetsAt: new Date(period.resetsAtMs).toISOString()
		}
	];
	// 账期窗口先读一次：花钱最多的模型决定档位，另外两条窗口按同一档位汇总。
	const monthRead = await fetchRows(ctx, config, definitions[2].sinceMs);
	if (!monthRead.ok) return { ok: false, error: monthRead.error };
	const tier = tierOf(monthRead.rows);
	const windows = [];
	for (const definition of definitions) {
		const read = definition.id === "month" ? monthRead : await fetchRows(ctx, config, definition.sinceMs);
		if (!read.ok) return { ok: false, error: read.error };
		const used = usedOf(read.rows, tier);
		windows.push({
			id: definition.id,
			usedUsd: Math.round(used.usedUsd * 1e6) / 1e6,
			limitUsd: limitOf(config, tier, definition),
			requests: used.requests,
			models: used.models,
			anchor: definition.anchor,
			since: new Date(definition.sinceMs).toISOString(),
			resetsAt: definition.resetsAt
		});
	}
	return {
		ok: true,
		windows,
		tier,
		limits: GO_TIER_LIMITS[tier],
		source: "console-api",
		period: {
			source: period.anchor,
			start: new Date(period.sinceMs).toISOString(),
			end: new Date(period.resetsAtMs).toISOString(),
			// console-billing = 实时读到账单；其余值是失败原因（no-token / disabled / attempts-403 …）。
			live: live?.source !== void 0 ? live.source : (live?.error ?? "unknown")
		},
		fetchedAt: new Date().toISOString()
	};
}

/** 额度缓存：Console 用量不是热路径，3 分钟足够。 */
const QUOTA_CACHE_TTL_MS = 180000;
let quotaCache;

/** 带缓存（或强制刷新）的额度读取。 */
async function cachedQuota(ctx, config, force) {
	const now = Date.now();
	if (!force && quotaCache !== void 0 && quotaCache.key === config.goBaseURL && now - quotaCache.at < QUOTA_CACHE_TTL_MS) {
		return quotaCache.value;
	}
	const value = await fetchQuota(ctx, config);
	quotaCache = { at: now, key: config.goBaseURL, value };
	return value;
}
//#endregion

/**
 * 宿主插件主体。
 * @param {object} ctx 宿主上下文。
 * @param {object} rawConfig profile 里的 config。
 */
export function apply(ctx, rawConfig) {
	const config = resolveConfig(rawConfig);

	const routes = [
		{
			kind: "exact",
			path: QUOTA_ROUTE,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const url = new URL(req.url ?? "/", "http://localhost");
				const force = url.searchParams.get("fresh") === "1";
				const outcome = await cachedQuota(ctx, config, force);
				if (outcome.ok) {
					writeJson(res, 200, {
						...outcome,
						mode: config.goMode,
						hostPatch: healState.needsRestart ? "pending-restart" : healState.status
					});
					return;
				}
				writeJson(res, 502, { ok: false, error: outcome.error, mode: config.goMode, hostPatch: healState.needsRestart ? "pending-restart" : healState.status });
			}
		},
		{
			kind: "exact",
			path: STATUS_ROUTE,
			handler: async (req, res) => {
				if (!guard(req, res, "GET")) return;
				const url = new URL(req.url ?? "/", "http://localhost");
				// 默认是最近一次巡检的快照；?fresh=1 现场重扫一遍（改完文件想立刻看结果时用）。
				if (url.searchParams.get("fresh") === "1") {
					try {
						heal(ctx, "status");
					} catch (error) {
						logLine({ event: "error", reason: "status", message: String(error instanceof Error ? error.message : error) });
					}
				}
				writeJson(res, 200, { ok: true, ...healState, payloadDir: PAYLOAD_ROOT, lastProbe });
			}
		},
		{
			kind: "exact",
			path: PROBE_ROUTE,
			handler: async (req, res) => {
				if (!guard(req, res, "POST")) return;
				try {
					let body = "";
					for await (const chunk of req) {
						body += chunk;
						if (body.length > 8192) break;
					}
					// 只留在内存里（/status 能读到），不落盘：本机任何进程乱灌也写不爆日志。
					lastProbe = { at: new Date().toISOString(), report: JSON.parse(body === "" ? "{}" : body) };
					writeJson(res, 200, { ok: true });
				} catch (error) {
					writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
			}
		}
	];
	const disposers = routes.map((route) => ctx.webServer.register(route));

	// 自愈：启动后补跑一次（等 Loader 把树装好）、安装事件后去抖跑、定时巡检。
	let timer;
	const schedule = (reason) => {
		if (timer !== void 0) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = void 0;
			try {
				heal(ctx, reason);
			} catch (error) {
				logLine({ event: "error", reason, message: String(error instanceof Error ? error.message : error) });
			}
		}, HEAL_DEBOUNCE_MS);
		timer.unref?.();
	};
	if (config.autoHeal) {
		const bootTimer = setTimeout(() => schedule("boot"), 2500);
		bootTimer.unref?.();
		const interval = setInterval(() => schedule("tick"), HEAL_INTERVAL_MS);
		interval.unref?.();
		ctx.on?.("plugin-manager/changed", () => schedule("plugin-manager"));
		ctx.effect(() => () => {
			clearTimeout(bootTimer);
			clearInterval(interval);
			if (timer !== void 0) clearTimeout(timer);
		}, "dsh-balance-widget-patch: healing");
	}

	ctx.effect(() => () => {
		for (const dispose of disposers) dispose();
	}, "dsh-balance-widget-patch: routes");

	// 手动入口：会话里可以直接调，便于诊断。
	ctx.provide?.("balanceWidgetPatch", {
		heal: (reason) => heal(ctx, reason ?? "manual"),
		status: () => ({ ...healState, config: { ...config, goApiKeyEnv: config.goApiKeyEnv } }),
		quota: (force) => cachedQuota(ctx, config, force === true)
	});

	logLine({ event: "apply", pid: process.pid, node: process.version, profileDir: process.env.DSH_PROFILE_DIR ?? null, autoHeal: config.autoHeal });
}
