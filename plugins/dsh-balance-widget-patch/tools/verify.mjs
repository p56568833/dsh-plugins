/**
 * 自检：payload / targets.json / patches 三者不许漂移。
 *
 *   node tools/verify.mjs [--pristine <解包的 dsh-balance-widget@<targets.version> 目录>]
 *
 * 有 --pristine 时会做最硬的那条断言：把 patches/ 里的补丁打到 pristine 副本上，
 * 结果必须和 payload/ 逐字节相同（SHA256 相等）。没给 --pristine 就跳过依赖
 * 官方原件的检查，只做静态断言（文件存在、标记齐全、哈希不同）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const at = args.indexOf("--pristine");
const pristineDir = at === -1 ? void 0 : resolve(args[at + 1] ?? "");
const targets = JSON.parse(readFileSync(join(ROOT, "targets.json"), "utf8"));
const patchFile = join(ROOT, "patches", `${targets.package}-${targets.version}.patch`);

let failures = 0;
function check(label, condition, detail) {
	console.log(`  ${condition ? "ok  " : "FAIL"} ${label}${condition || detail === void 0 ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const payloadPath = (relative) => join(ROOT, "payload", ...relative.split("/"));

console.log(`payload 与 targets.json（目标 ${targets.package}@${targets.version}）`);
for (const [relative, meta] of Object.entries(targets.files)) {
	const path = payloadPath(relative);
	check(`payload 存在 ${relative}`, existsSync(path), path);
	if (!existsSync(path)) continue;
	const hash = sha(path);
	check(`${relative} 与官方原版不同（确实打过补丁）`, hash !== meta.pristine, hash);
	check(`${relative} 不在 previous 列表里（没把旧成品当新成品）`, !(meta.previous ?? []).includes(hash), hash);
	// 这条会抓住"改了 payload 但忘了跑 build-patch"：那时 targets.json 的 payload 记录
	// 会过期，插件的 previous 也就没记上旧的成品哈希，升级路径会静默断掉。
	check(`${relative} 的 payload 记录是最新的（改过 payload 就要跑 build-patch）`, meta.payload === hash, `targets.json=${meta.payload} 实际=${hash}`);
}

const client = readFileSync(payloadPath("lib/client.js"), "utf8");
const host = readFileSync(payloadPath("lib/index.js"), "utf8");
console.log("payload 内容标记");
for (const marker of ["/api/dsh-quota/go", "dshbwq_switch", "dshbwq_segment", "\"mode.quota\"", "\"quota.fiveHour\"", "dshbw.mode", "dshbwq_barRow", "dshbwq_barFill", "dshbwq_today", "\"quota.pct\"", "\"todayUsed\""]) {
	check(`client.js 含 ${marker}`, client.includes(marker));
}
for (const marker of ["DSH_HOME", "USERPROFILE", "collectSubagentIndex", "subagents"]) {
	check(`index.js 含 ${marker}`, host.includes(marker));
}

if (pristineDir !== void 0) {
	console.log(`官方原件核对：${pristineDir}`);
	for (const [relative, meta] of Object.entries(targets.files)) {
		const path = join(pristineDir, ...relative.split("/"));
		check(`pristine 哈希 ${relative}`, existsSync(path) && sha(path) === meta.pristine, path);
	}
	console.log("补丁 ↔ payload 一致性（git apply 到 pristine 副本后逐字节比对）");
	check("补丁文件存在", existsSync(patchFile), patchFile);
	if (existsSync(patchFile)) {
		const work = mkdtempSync(join(tmpdir(), "dshbwp-verify-"));
		try {
			for (const relative of Object.keys(targets.files)) {
				const local = relative.split("/");
				mkdirSync(join(work, ...local.slice(0, -1)), { recursive: true });
				cpSync(join(pristineDir, ...local), join(work, ...local));
			}
			// Windows 上 core.autocrlf=true 会让 git apply 把 LF 补丁写成 CRLF，
			// 于是重建结果与 payload 的哈希对不上。这里显式关掉行尾转换。
			const applied = spawnSync("git", ["-c", "core.autocrlf=false", "apply", "-p1", patchFile], { cwd: work, encoding: "utf8" });
			check("git apply 成功", applied.status === 0, (applied.stderr ?? "").trim());
			if (applied.status === 0) {
				for (const relative of Object.keys(targets.files)) {
					const rebuilt = sha(join(work, ...relative.split("/")));
					check(`${relative} 重建结果 == payload`, rebuilt === sha(payloadPath(relative)), `${rebuilt} vs ${sha(payloadPath(relative))}`);
				}
			}
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}
} else {
	console.log("（未给 --pristine：跳过官方原件与补丁一致性检查）");
}

// 已装 profile 里现在是什么状态（只读报告，不写）
const profileDir = process.env.DSH_PROFILE_DIR ?? join(homedir(), ".dsh", "profiles", "desktop");
const installedDir = join(profileDir, "node_modules", targets.package);
if (existsSync(join(installedDir, "package.json"))) {
	console.log(`已装副本状态：${installedDir}`);
	const version = JSON.parse(readFileSync(join(installedDir, "package.json"), "utf8")).version;
	check(`已装版本 ${targets.version}`, version === targets.version, version);
	for (const [relative, meta] of Object.entries(targets.files)) {
		const path = join(installedDir, ...relative.split("/"));
		if (!existsSync(path)) {
			check(`${relative} 存在`, false, path);
			continue;
		}
		const hash = sha(path);
		const state = hash === sha(payloadPath(relative))
			? "payload（已打补丁）"
			: hash === meta.pristine
				? "pristine（官方原版，等待自愈写回）"
				: (meta.previous ?? []).includes(hash)
					? "previous（本插件旧成品，等待自愈升级）"
					: "unknown（既不是官方原版也不是我们的成品；插件会拒绝改动）";
		console.log(`  · ${relative}: ${state}`);
		if (state.startsWith("unknown")) failures += 1;
	}
} else {
	console.log(`（没找到已装副本 ${installedDir}：跳过安装状态检查）`);
}

console.log(failures === 0 ? "VERIFY PASSED" : `VERIFY FAILED（${failures} 项）`);
process.exit(failures === 0 ? 0 : 1);
