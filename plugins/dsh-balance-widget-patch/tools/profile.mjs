/**
 * 安装 / 卸载用的小工具：改 ~/.dsh/profiles/<profile>/package.json，改之前先备份。
 *
 *   add：
 *     ① dependencies[NAME] = link:<本目录>（让包能被解析到）；
 *     ② dsh.profile.bundles 里加上 NAME —— **这一处才决定会不会被加载**；
 *     ③ 把补丁插件的 id 登记进 dsh-plugin-groups 的 PARENTS 由人工步骤完成（见 README）。
 *
 *   node tools/profile.mjs add    [--profile desktop]
 *   node tools/profile.mjs remove [--profile desktop]
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "dsh-balance-widget-patch";
const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const action = args[0];
const at = args.indexOf("--profile");
const profile = at !== -1 && args[at + 1] ? args[at + 1] : "desktop";
const home = process.env.DSH_HOME || join(homedir(), ".dsh");
const file = join(home, "profiles", profile, "package.json");

if (action !== "add" && action !== "remove") {
	console.error("用法：node tools/profile.mjs add|remove [--profile desktop]");
	process.exit(2);
}
if (!existsSync(file)) {
	console.error(`找不到 ${file}，确认一下 DSH 的配置名（默认 desktop）`);
	process.exit(1);
}

const raw = readFileSync(file, "utf8");
const pkg = JSON.parse(raw);
const indent = (raw.match(/^[ \t]+(?=")/m) || ["  "])[0];
const deps = pkg.dependencies || (pkg.dependencies = {});
const profileSection = (pkg.dsh = pkg.dsh || {}).profile = pkg.dsh.profile || {};
const bundles = (profileSection.bundles = profileSection.bundles || []);
const notes = [];
let changed = false;

if (action === "add") {
	const want = `link:${PLUGIN_DIR}`;
	if (deps[NAME] !== want) {
		deps[NAME] = want;
		notes.push(`dependencies 已登记 ${NAME}`);
		changed = true;
	}
	if (!bundles.includes(NAME)) {
		bundles.push(NAME);
		notes.push("已加进 dsh.profile.bundles（这一处才决定会不会被加载）");
		changed = true;
	}
} else {
	if (NAME in deps) {
		delete deps[NAME];
		notes.push(`dependencies 已移除 ${NAME}`);
		changed = true;
	}
	const index = bundles.indexOf(NAME);
	if (index !== -1) {
		bundles.splice(index, 1);
		notes.push("bundles 名单已移除");
		changed = true;
	}
}

if (!changed) {
	console.log("profile 已经是想要的样子，不用改");
	process.exit(0);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const backup = `${file}.before-${NAME}-${action}-${stamp}`;
copyFileSync(file, backup);
writeFileSync(file, JSON.stringify(pkg, null, indent) + (raw.endsWith("\n") ? "\n" : ""));
console.log(`${action === "add" ? "已登记" : "已移除"}：${NAME}`);
for (const note of notes) console.log(`  · ${note}`);
console.log(`  备份：${backup}`);
