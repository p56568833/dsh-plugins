/**
 * 额度口径自检：官方 /console/api/go/status 的 meters 能不能被正确翻译成三条窗口。
 *
 *   node tools/quota-selftest.mjs          只跑静态用例（离线，不联网）
 *   node tools/quota-selftest.mjs --live   再用本机密钥真打一次官方接口（只读 GET）
 *
 * 为什么单独测这一块：5 小时窗口「没和官方同步」这个 bug 的根因是本地按
 * 「锚点 + 5h × k」推算，而官方口径是「从第一次使用起算 5 小时」。所以真正的
 * 回归点是「窗口的 resetsAt / limit / used 一律取自官方 meters，一个都不许自己算」。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { goStatusWindows } from "../index.js";

let failures = 0;
function check(label, condition, detail) {
	console.log(`  ${condition ? "ok  " : "FAIL"} ${label}${condition || detail === void 0 ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

/** 2026-10-19 11:10Z 从真机抓到的响应（裁剪成只有本插件用到的字段）。 */
const FIXTURE = {
	product: "go",
	access: {
		startsAt: "2026-10-18T08:11:37.000Z",
		endsAt: "2026-11-18T08:11:37.000Z",
		meters: {
			fiveHour: {
				startsAt: "2026-10-19T06:42:16.000Z",
				resetsAt: "2026-10-19T11:42:16.000Z",
				limitMicroCents: "1200000000",
				usedMicroCents: "68282072"
			},
			week: {
				startsAt: "2026-10-19T00:00:00.000Z",
				resetsAt: "2026-10-26T00:00:00.000Z",
				limitMicroCents: "3000000000",
				usedMicroCents: "160105002"
			},
			month: {
				resetsAt: "2026-11-18T08:11:37.000Z",
				limitMicroCents: "6000000000",
				usedMicroCents: "645432924"
			}
		}
	}
};

console.log("官方 meters → 窗口（静态用例）");
const windows = goStatusWindows(FIXTURE);
check("三条窗口都翻译出来", Array.isArray(windows) && windows.length === 3, JSON.stringify(windows));
if (Array.isArray(windows) && windows.length === 3) {
	const [fiveHour, week, month] = windows;
	check("5 小时窗口用官方的 startsAt", fiveHour.since === "2026-10-19T06:42:16.000Z", fiveHour.since);
	check("5 小时窗口用官方的 resetsAt", fiveHour.resetsAt === "2026-10-19T11:42:16.000Z", fiveHour.resetsAt);
	check("5 小时上限 = $12（go-v1），不是配置里的 16", fiveHour.limitUsd === 12, String(fiveHour.limitUsd));
	check("5 小时已用 = $0.682821（保留 6 位小数）", Math.abs(fiveHour.usedUsd - 0.682821) < 1e-9, String(fiveHour.usedUsd));
	check("5 小时百分比取整 = 6（官方网页同值）", Math.round((fiveHour.usedUsd / fiveHour.limitUsd) * 100) === 6);
	check("每周上限 = $30", week.limitUsd === 30, String(week.limitUsd));
	check("每周 resetsAt = 下周一 00:00Z", week.resetsAt === "2026-10-26T00:00:00.000Z", week.resetsAt);
	check("账期上限 = $60", month.limitUsd === 60, String(month.limitUsd));
	check("账期没有 startsAt 时 since 为 null（不瞎编）", month.since === null, String(month.since));
	check("账期 resetsAt = 续费日", month.resetsAt === "2026-11-18T08:11:37.000Z", month.resetsAt);
}

console.log("缺字段时退回旧算法（不许拿半套数据冒充官方）");
check("没有 access.meters → null", goStatusWindows({ access: {} }) === null);
check("少一条窗口 → null", goStatusWindows({ access: { meters: { fiveHour: FIXTURE.access.meters.fiveHour } } }) === null);
check("上限为 0 → null", goStatusWindows({ access: { meters: { ...FIXTURE.access.meters, week: { ...FIXTURE.access.meters.week, limitMicroCents: "0" } } } }) === null);

if (process.argv.includes("--live")) {
	console.log("真打官方接口（只读）");
	const key = process.env.OPENCODE_GO_API_KEY ?? readCredential("OPENCODE_GO_API_KEY");
	if (key === void 0) {
		console.log("  skip  没找到 OPENCODE_GO_API_KEY（环境变量或 ~/.dsh/.credentials.yaml）");
	} else {
		const response = await fetch("https://opencode.ai/console/api/go/status", { headers: { accept: "application/json", authorization: `Bearer ${key}` } });
		check("官方接口 200", response.status === 200, String(response.status));
		if (response.status === 200) {
			const live = goStatusWindows(await response.json());
			check("官方响应能翻译成三条窗口", live !== null);
			for (const window of live ?? []) {
				const remaining = Date.parse(window.resetsAt) - Date.now();
				console.log(`  · ${window.id.padEnd(8)} ${Math.round((window.usedUsd / window.limitUsd) * 100)}%  重置 ${window.resetsAt}（${(remaining / 3600000).toFixed(2)}h 后）`);
			}
			const fiveHour = (live ?? []).find((window) => window.id === "fiveHour");
			if (fiveHour !== void 0) {
				check("5 小时窗口在未来的 5 小时内", Date.parse(fiveHour.resetsAt) > Date.now() && Date.parse(fiveHour.resetsAt) <= Date.now() + 5 * 3600000);
				check("5 小时已用不超过上限", fiveHour.usedUsd <= fiveHour.limitUsd);
			}
		}
	}
}

/** 从 ~/.dsh/.credentials.yaml 里抠出 refs 下的明文密钥（和宿主同样的来源）。 */
function readCredential(name) {
	try {
		const text = readFileSync(join(homedir(), ".dsh", ".credentials.yaml"), "utf8");
		const match = text.match(new RegExp(`${name}:\\s*['"]?([^\\s'"]+)`));
		return match?.[1];
	} catch {
		return void 0;
	}
}

console.log(failures === 0 ? "QUOTA SELFTEST PASSED" : `QUOTA SELFTEST FAILED（${failures} 项）`);
process.exit(failures === 0 ? 0 : 1);
