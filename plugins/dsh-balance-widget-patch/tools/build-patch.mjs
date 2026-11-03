/**
 * 从「npm 官方 dsh-balance-widget 解包目录」与 payload/ 生成人可读的统一 diff。
 *
 *   node tools/build-patch.mjs --pristine <解包后的 dsh-balance-widget@<targets.version> 目录> [--out patches/xxx.patch]
 *
 * 先用 targets.json 里的 pristine 哈希核对 <dir>：对不上就拒绝生成，免得拿错版本
 * 做出一个看着对、其实错的补丁。再用 git diff --no-index 出统一 diff（仓库既有的
 * 补丁脚本本来就依赖 git，这里保持一致）。
 *
 * 注意：补丁是给人看 / 给人 rebase 用的**记录**；插件真正写回 node_modules 用的是
 * payload/ 里的成品文件（见 index.js 的自愈逻辑），不依赖 git、也不怕补丁 fuzz。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const at = args.indexOf("--pristine");
const pristineDir = at === -1 ? void 0 : resolve(args[at + 1] ?? "");
const outAt = args.indexOf("--out");
const targets = JSON.parse(readFileSync(join(ROOT, "targets.json"), "utf8"));
const outFile = outAt === -1
	? join(ROOT, "patches", `${targets.package}-${targets.version}.patch`)
	: resolve(args[outAt + 1]);

if (pristineDir === void 0 || !existsSync(join(pristineDir, "package.json"))) {
	console.error(`用法：node tools/build-patch.mjs --pristine <dsh-balance-widget@${targets.version} 解包目录> [--out <补丁路径>]`);
	process.exit(2);
}

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// 1) 版本与哈希核对
const manifest = JSON.parse(readFileSync(join(pristineDir, "package.json"), "utf8"));
if (manifest.version !== targets.version) {
	console.error(`pristine 目录是 ${manifest.version}，targets.json 记的是 ${targets.version} —— 拒绝生成`);
	process.exit(1);
}
const files = Object.keys(targets.files);
for (const relative of files) {
	const actual = sha(join(pristineDir, ...relative.split("/")));
	const expected = targets.files[relative].pristine;
	if (actual !== expected) {
		console.error(`${relative} 的 pristine 哈希对不上\n  期望 ${expected}\n  实际 ${actual}`);
		process.exit(1);
	}
}
console.log(`pristine 校验通过：${targets.package}@${targets.version}，${files.length} 个文件`);

// 2) 维护 targets.json 的 payload / previous 记录。
//    改过 payload 之后跑这一趟，**上一次的成品哈希会自动进 previous** —— 插件在别的
//    机器上把"我们的旧成品"升级成新成品时才认得出来，不会误判成"上游发了新版"而停手。
//    （这一步就是 issue：host 文件 previous 为空导致升级路径断掉 的修复。）
let recordsChanged = false;
for (const relative of files) {
	const meta = targets.files[relative];
	const current = sha(join(ROOT, "payload", ...relative.split("/")));
	if (!Array.isArray(meta.previous)) {
		meta.previous = [];
		recordsChanged = true;
	}
	if (typeof meta.payload === "string" && meta.payload !== current && !meta.previous.includes(meta.payload)) {
		meta.previous.push(meta.payload);
		recordsChanged = true;
		console.log(`  · ${relative}: 旧成品 ${meta.payload.slice(0, 12)}… 已记入 previous`);
	}
	if (meta.payload !== current) {
		meta.payload = current;
		recordsChanged = true;
	}
}
if (recordsChanged) {
	writeFileSync(join(ROOT, "targets.json"), `${JSON.stringify(targets, null, 2)}\n`, "utf8");
	console.log("targets.json 已刷新（payload / previous 记录）");
}

// 3) 摆成 a/ 与 b/ 两棵树，让 diff 里的路径是 a/lib/index.js → b/lib/index.js
const work = mkdtempSync(join(tmpdir(), "dshbwp-patch-"));
try {
	for (const relative of files) {
		const local = relative.split("/");
		mkdirSync(join(work, "a", ...local.slice(0, -1)), { recursive: true });
		mkdirSync(join(work, "b", ...local.slice(0, -1)), { recursive: true });
		cpSync(join(pristineDir, ...local), join(work, "a", ...local));
		cpSync(join(ROOT, "payload", ...local), join(work, "b", ...local));
	}
	// -c core.autocrlf=false：不让行尾转换混进 diff（Windows 上默认是 true，
	// 会把 CRLF 当成"内容相同"而吞掉，或者反过来把行尾差异写进补丁）。
	const diff = spawnSync("git", ["-c", "core.autocrlf=false", "diff", "--no-index", "--no-color", "--src-prefix=", "--dst-prefix=", "a", "b"], {
		cwd: work,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024
	});
	if (diff.error !== void 0) {
		console.error(`调用 git 失败：${diff.error.message}`);
		process.exit(1);
	}
	if ((diff.stdout ?? "") === "") {
		console.error("payload 与 pristine 完全相同，没有可生成的补丁");
		process.exit(1);
	}
	const header = [
		`# ${targets.package} ${targets.version} — 本机补丁（Windows 会话目录 + 会话锚定 + 子代理成本 + Go 额度模式）`,
		"#",
		`# 这是给人看的记录：内容 = payload/ 相对 npm 官方 ${targets.version} 的差异。`,
		"# 应用方式（等价于插件在启动时自动做的事，插件用成品文件直接写回，不依赖 git）：",
		`#   git apply -p1 -d <profile>/node_modules/${targets.package} < 本文件`,
		"#",
		`# 生成：node tools/build-patch.mjs --pristine <解包的 ${targets.package}@${targets.version}>`,
		"# 改动只涉及 lib/index.js 与 lib/client.js，不改 package.json（版本号与官方一致）。",
		""
	].join("\n");
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, header + diff.stdout, "utf8");
	console.log(`已写出 ${outFile}（${diff.stdout.length} 字节 diff）`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
