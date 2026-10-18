window.__ModuleLoader__.load({
	id: "dsh-balance-widget",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		/**
		* Glyph of the popover's refresh button. DSH 0.1.7 renamed product icons to
		* size-neutral weights (`IconRefreshOutlineRegular` plus a `size` prop —
		* primitives README, decision 2026-09-16); 0.1.5 exported only the
		* artboard-sized `IconRefreshOutline14`. Resolve once and fall back to a
		* local glyph: rendering `undefined` as a component throws React #130, and
		* the slot answers by dropping the whole card.
		*/
		const RefreshGlyph = [
			_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular,
			_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineMedium,
			_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline14
		].find((glyph) => typeof glyph === "function" || typeof glyph === "object" && glyph !== null);
		/** Refresh glyph element, stroke-matched to the card's own 16px icon. */
		function refreshGlyph() {
			if (RefreshGlyph !== void 0) return (0, react_jsx_runtime.jsx)(RefreshGlyph, {
				size: 14
			});
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [(0, react_jsx_runtime.jsx)("polyline", {
					points: "23 4 23 10 17 10"
				}), (0, react_jsx_runtime.jsx)("path", {
					d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
				})]
			});
		}
		//#region lib/types/client/styles.js
		const css = ".dshbw_row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 0}.dshbw_label{display:inline-flex;align-items:center;min-width:0}.dshbw_val{font-weight:600;color:var(--dsw-alias-label-primary)}.dshbw_val[data-tier=\"sec\"]{font-weight:400;color:var(--dsw-alias-label-secondary)}.dshbw_val[data-tier=\"ter\"]{font-weight:400;color:var(--dsw-alias-label-tertiary)}.dshbw_val[data-level=\"1\"]{color:var(--dsw-alias-state-warn-primary)}.dshbw_val[data-level=\"2\"]{color:var(--dsw-alias-state-error-primary)}.dshbw_err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;margin-top:6px}.dshbw_link{background:none;border:none;cursor:pointer;color:var(--dsw-alias-state-business-primary);display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;font-size:12px;line-height:18px;font-family:inherit;text-decoration:none}.dshbw_link:hover{color:var(--dsw-alias-state-business-primary);text-decoration:underline}.dshbw_sideTop{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;line-height:20px}.dshbw_sideAmount{font-weight:600}.dshbw_sideAmount[data-level=\"1\"]{color:var(--dsw-alias-state-warn-primary);font-weight:600}.dshbw_sideAmount[data-level=\"2\"]{color:var(--dsw-alias-state-error-primary)}.dshbw_sideFoot{display:flex;justify-content:space-between;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}.dshbw_sideWrap{position:relative;flex:1 1 auto;min-width:0}.dshbw_sideWrap[data-compact=\"true\"]{flex:0 0 auto}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_side{width:36px;height:36px;padding:0;margin:0;gap:0;justify-content:center;align-items:center;border-radius:var(--dsw-radius-md,10px);background:transparent;color:var(--dsw-alias-label-primary)}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_side:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_sideTop{justify-content:center;gap:0}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_sideAmount,.dshbw_sideWrap[data-compact=\"true\"] .dshbw_sideFoot{display:none}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_side::after{content:\"\";position:absolute;top:5px;right:5px;width:6px;height:6px;border-radius:50%;display:none}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_side[data-peak=\"true\"]::after{display:block;background:var(--dsw-alias-state-warn-primary)}.dshbw_sideWrap[data-compact=\"true\"] .dshbw_side[data-peak=\"false\"]::after{display:block;background:var(--dsw-alias-state-success-primary)}.dshbw_side{position:relative;display:flex;flex-direction:column;gap:4px;width:100%;padding:6px 8px;margin:0 0 2px;border:none;border-radius:12px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;text-align:left;transition:transform 120ms cubic-bezier(0.23,1,0.32,1),background 120ms cubic-bezier(0.23,1,0.32,1)}.dshbw_side:active{transform:scale(.97)}.dshbw_side:hover{background:var(--dsw-alias-interactive-bg-active)}.dshbw_sidePop{position:fixed;z-index:70;box-sizing:border-box;min-width:240px;max-width:calc(100vw - 16px);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 0 1px 0 #0003,0 0 4px 0 #00000005,0 12px 32px 0 #00000014);padding:12px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);animation:dshbw-pop-in 160ms cubic-bezier(0.23,1,0.32,1) backwards}.dshbw_sidePopHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.dshbw_sidePopTitle{font-weight:600}.dshbw_sidePopClose{background:none;border:none;cursor:pointer;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;padding:0 2px;font-family:inherit}.dshbw_sidePopClose:hover{color:var(--dsw-alias-label-primary)}.dshbw_sidePopFoot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.dshbw_sidePopRefresh{background:none;border:1px solid var(--dsw-alias-border-l2);cursor:pointer;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;padding:0;font-family:inherit}.dshbw_sidePopRefresh:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.dshbw_sideAmount::before{content:\"\";display:none;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle}.dshbw_side[data-peak=\"true\"] .dshbw_sideAmount::before{display:inline-block;background:var(--dsw-alias-state-warn-primary)}.dshbw_side[data-peak=\"false\"] .dshbw_sideAmount::before{display:inline-block;background:var(--dsw-alias-state-success-primary)}.dshbw_peakTag{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:16px;padding:1px 7px;border-radius:6px}.dshbw_peakTag[data-peak=\"true\"]{color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}.dshbw_peakTag[data-peak=\"false\"]{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary)}.dshbw_sessionNote{display:flex;align-items:center;gap:4px;margin-top:6px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);min-width:0}.dshbw_sessionName{max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshbw_ico{color:var(--dsw-alias-state-business-primary);display:inline-flex;align-items:center}@keyframes dshbw-pop-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}.dshbw_sidePopRefresh,.dshbw_sidePopClose{transition:transform 120ms cubic-bezier(0.23,1,0.32,1),color 120ms cubic-bezier(0.23,1,0.32,1)}.dshbw_sidePopRefresh:active{transform:scale(.92)}.dshbw_sidePopClose:active{transform:scale(.92)}.dshbw_side:focus-visible,.dshbw_link:focus-visible,.dshbw_sidePopClose:focus-visible,.dshbw_sidePopRefresh:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}";
		const tagId = "dsh-balance-widget/styles.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance-widget";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var styles = {
			"row": "dshbw_row",
			"label": "dshbw_label",
			"val": "dshbw_val",
			"err": "dshbw_err",
			"link": "dshbw_link",
			"side": "dshbw_side",
			"sideWrap": "dshbw_sideWrap",
			"sideTop": "dshbw_sideTop",
			"sideAmount": "dshbw_sideAmount",
			"sideFoot": "dshbw_sideFoot",
			"sidePop": "dshbw_sidePop",
			"sidePopHead": "dshbw_sidePopHead",
			"sidePopTitle": "dshbw_sidePopTitle",
			"sidePopClose": "dshbw_sidePopClose",
			"sidePopFoot": "dshbw_sidePopFoot",
			"sidePopRefresh": "dshbw_sidePopRefresh",
			"peakTag": "dshbw_peakTag",
			"sessionNote": "dshbw_sessionNote",
			"sessionName": "dshbw_sessionName"
		};
		//#endregion
		/** Format a CNY amount: ¥ + 3 significant decimals (drop trailing zeros). */
		function formatCny(value) {
			if (value === void 0 || value === null || !Number.isFinite(value)) return "—";
			const rounded = Math.round(value * 1e4) / 1e4;
			return `¥${rounded.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 4 })}`;
		}
		//#endregion
		//#region lib/types/client/balance-api.js
		/** Same-origin balance route (host half registers it over ctx.webServer). */
		const BALANCE_ROUTE = "/api/dsh-balance/balance";
		/** Same-origin cost routes. */
		const LAST_COST_ROUTE = "/api/dsh-balance/last-cost";
		const TODAY_COST_ROUTE = "/api/dsh-balance/today-cost";
		const ACTIVE_COST_ROUTE = "/api/dsh-balance/active-cost";
		/** Official DeepSeek platform top-up page (opens in a new tab). */
		const TOP_UP_URL = "https://platform.deepseek.com/top_up";
		//#region go-quota (added by dsh-balance-widget-patch)
		/** Same-origin quota route served by the dsh-balance-widget-patch plugin. */
		const QUOTA_ROUTE = "/api/dsh-quota/go";
		/** OpenCode console usage page (opens in a new tab). */
		const USAGE_URL = "https://opencode.ai/console";
		/** localStorage key remembering which mode the user picked. */
		const MODE_KEY = "dshbw.mode";
		/** Persisted mode, or null when the user never switched. */
		function readStoredMode() {
			try {
				const stored = window.localStorage.getItem(MODE_KEY);
				return stored === "quota" || stored === "balance" ? stored : null;
			} catch {
				return null;
			}
		}
		/** Persist the chosen mode (private-mode failures are irrelevant). */
		function storeMode(mode) {
			try {
				window.localStorage.setItem(MODE_KEY, mode);
			} catch { /* ignore */ }
		}
		/** Console's own countdown shape: `Xd Yh` above a day, else `Xh Ym`. */
		function formatCountdown(iso) {
			if (typeof iso !== "string" || iso === "") return null;
			const remaining = Date.parse(iso) - Date.now();
			if (!Number.isFinite(remaining)) return null;
			if (remaining <= 0) return "0m";
			const minutes = Math.ceil(remaining / 60000);
			const hours = Math.floor(minutes / 60);
			if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
			return `${hours}h ${minutes % 60}m`;
		}
		/** Used fraction of one window (0…1). */
		function windowFraction(window) {
			if (window === void 0 || window === null || !Number.isFinite(window.limitUsd) || window.limitUsd <= 0) return 0;
			return Math.min(1, Math.max(0, window.usedUsd / window.limitUsd));
		}
		/** 0 = fine, 1 = warn (>=75%), 2 = error (>=90%). */
		function levelOf(fraction) {
			return fraction >= 0.9 ? 2 : fraction >= 0.75 ? 1 : 0;
		}
		/**
		* Fetch the OpenCode Go quota windows from the patch plugin.
		* @param {boolean} force - bypass the host's 3-minute cache.
		* @returns { ok, windows?, mode?, hostPatch?, error? }
		*/
		async function fetchQuota(force) {
			try {
				const response = await fetch(force === true ? `${QUOTA_ROUTE}?fresh=1` : QUOTA_ROUTE, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || payload.ok !== true) {
					return { ok: false, error: payload.error ?? `quota responded ${response.status}` };
				}
				return {
					ok: true,
					windows: Array.isArray(payload.windows) ? payload.windows : [],
					mode: payload.mode === "quota" ? "quota" : "balance",
					hostPatch: payload.hostPatch ?? null,
					source: payload.source ?? null
				};
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		/** The window rows the popover lists, in plan order. */
		const QUOTA_ROWS = [
			{ id: "fiveHour", labelKey: "quota.fiveHour" },
			{ id: "week", labelKey: "quota.week" },
			{ id: "month", labelKey: "quota.month" }
		];
		/**
		* Gauge glyph for the card's quota face — the wallet icon would read as
		* "money", which is exactly what this mode stops showing.
		*/
		function quotaCardGlyph() {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [
					(0, react_jsx_runtime.jsx)("path", { d: "M4 18a8 8 0 1 1 16 0" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M12 18l4.6-5.6" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M3 21h18" })
				]
			});
		}
		/** Class names owned by this patch (prefixed to stay out of the widget's way). */
		const qStyles = {
			"switch": "dshbwq_switch",
			"segment": "dshbwq_segment",
			"note": "dshbwq_note",
			"pct": "dshbwq_pct",
			"barRow": "dshbwq_barRow",
			"bar": "dshbwq_bar",
			"barFill": "dshbwq_barFill",
			"barHint": "dshbwq_barHint",
			"mini": "dshbwq_mini",
			"miniFill": "dshbwq_miniFill",
			"today": "dshbwq_today"
		};
		/** Own stylesheet: the widget's own `css` string is left untouched. */
		const QUOTA_CSS = [
			".dshbwq_switch{display:inline-flex;align-items:center;gap:2px;margin-left:auto;margin-right:6px;flex:0 0 auto}",
			".dshbwq_segment{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11px;line-height:16px;padding:2px 7px;border-radius:6px;color:var(--dsw-alias-label-tertiary)}",
			".dshbwq_segment:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".dshbwq_segment[data-on=\"true\"]{color:var(--dsw-alias-state-business-primary);font-weight:600}",
			".dshbwq_note{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:-2px 0 6px}",
			".dshbwq_pct{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
			".dshbwq_pct[data-level=\"1\"]{color:var(--dsw-alias-state-warn-primary)}",
			".dshbwq_pct[data-level=\"2\"]{color:var(--dsw-alias-state-error-primary)}",
			".dshbwq_barRow{display:flex;align-items:center;gap:8px;margin:-3px 0 7px}",
			".dshbwq_bar{flex:1 1 auto;height:6px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden}",
			".dshbwq_barFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary);transition:width 240ms cubic-bezier(0.23,1,0.32,1)}",
			".dshbwq_barFill[data-level=\"1\"]{background:var(--dsw-alias-state-warn-primary)}",
			".dshbwq_barFill[data-level=\"2\"]{background:var(--dsw-alias-state-error-primary)}",
			".dshbwq_barHint{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}",
			".dshbwq_mini{flex:0 0 54px;height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;align-self:center}",
			".dshbwq_miniFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary)}",
			".dshbwq_miniFill[data-level=\"1\"]{background:var(--dsw-alias-state-warn-primary)}",
			".dshbwq_miniFill[data-level=\"2\"]{background:var(--dsw-alias-state-error-primary)}",
			".dshbwq_today{border-top:1px solid var(--dsw-alias-border-l1);margin-top:6px;padding-top:8px}"
		].join("");
		const QUOTA_CSS_ID = "dsh-balance-widget-patch/quota-mode.css";
		if (typeof document !== "undefined") {
			// Reuse the tag across client-HMR reloads, but always rewrite its text:
			// a reload re-runs this module while the previous revision's <head> tag
			// is still mounted, so an "already injected, skip" guard would keep the
			// old stylesheet and the new classes would simply not exist.
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(QUOTA_CSS_ID) + "]");
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = "dsh-balance-widget-patch";
				tag.dataset.pluginCss = QUOTA_CSS_ID;
				document.head.appendChild(tag);
			}
			tag.textContent = QUOTA_CSS;
		}
		//#endregion
		/**
		* Fetch the active session's costs (last prompt + today's session total).
		* @param {string} [sessionId] - the currently selected session; when omitted
		*   the host falls back to its most recently active session.
		* @returns { ok, lastPrompt?, todaySession?, sessionTitle?, workspaceName?, peak?, error? }
		*/
		async function fetchActiveCost(sessionId) {
			try {
				const url = sessionId === void 0 || sessionId === ""
					? ACTIVE_COST_ROUTE
					: `${ACTIVE_COST_ROUTE}?session=${encodeURIComponent(sessionId)}`;
				const response = await fetch(url, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) return { ok: false, error: payload.error ?? `active-cost responded ${response.status}` };
				return {
					ok: true,
					lastPrompt: payload.lastPrompt?.cost ?? 0,
					todaySession: payload.todaySession?.cost ?? 0,
					sessionTitle: payload.title,
					workspaceName: payload.workspaceName,
					cwd: payload.cwd,
					sessionId: payload.sessionId,
					peak: payload.peak
				};
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		/**
		* Fetch the account balance from the host proxy.
		* @returns { ok, balanceInfos?, modelId?, error? }
		*/
		async function fetchBalance() {
			try {
				const response = await fetch(BALANCE_ROUTE, { headers: { accept: "application/json" } });
				if (!response.ok) {
					let detail = "";
					try {
						detail = (await response.json()).error ?? "";
					} catch (_error) {
						/* ignore body parse failure */
					}
					return { ok: false, error: detail || `balance endpoint responded ${response.status}` };
				}
				const payload = await response.json();
				if (payload.ok === false) return { ok: false, error: payload.error ?? "unknown balance error" };
				return {
					ok: true,
					balanceInfos: payload.balance_infos ?? [],
					modelId: payload.modelId,
					lowThreshold: payload.lowThreshold,
					criticalThreshold: payload.criticalThreshold
				};
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		/**
		* Fetch a cost figure from the host (last turn or today's total).
		* @param {string} route - LAST_COST_ROUTE or TODAY_COST_ROUTE.
		* @param {string} [sessionId] - required for last-cost.
		* @returns { ok, cost?, inputTokens?, outputTokens?, error? }
		*/
		async function fetchCost(route, sessionId) {
			try {
				const url = sessionId === void 0 || sessionId === ""
					? route
					: `${route}?session=${encodeURIComponent(sessionId)}`;
				const response = await fetch(url, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) return { ok: false, error: payload.error ?? `cost endpoint responded ${response.status}` };
				return { ok: true, cost: payload.cost ?? 0, inputTokens: payload.inputTokens ?? 0, outputTokens: payload.outputTokens ?? 0 };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		}
		/** Pick the display balance from balance_infos (prefer CNY, else first). */
		function displayBalance(balanceInfos) {
			if (!Array.isArray(balanceInfos) || balanceInfos.length === 0) return null;
			const cny = balanceInfos.find((entry) => (entry.currency ?? "").toUpperCase() === "CNY");
			const entry = cny ?? balanceInfos[0];
			const total = Number(entry.total_balance);
			if (!Number.isFinite(total)) return null;
			const symbol = (entry.currency ?? "").toUpperCase() === "CNY" ? "¥" : (entry.currency ?? "") + " ";
			return { symbol, total, currency: entry.currency };
		}
		//#endregion
		//#region lib/types/client/ExplainIcon.js
		/**
		* A small ⓘ marker with a hover tooltip explaining a term. Wraps the
		* official DSH Tooltip so the popover stays visually consistent.
		* @param {Object} props - label (tooltip text), t (locale).
		*/
		function ExplainIcon({ label, t }) {
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: label,
				side: "top",
				delayMs: 300,
				children: (0, react_jsx_runtime.jsx)("span", {
					role: "img",
					"aria-label": t("explain.aria"),
					style: { cursor: "help", color: "var(--dsw-alias-label-tertiary)", marginLeft: 3, fontSize: 11, lineHeight: 1 },
					children: (0, react_jsx_runtime.jsx)("span", {
						children: "ⓘ"
					})
				})
			});
		}
		//#endregion
		//#region lib/types/client/SidebarBalanceCard.js
		/**
		* Sidebar footer card: balance + remaining-ratio bar + today cost.
		* Root-scoped (global, not per-session) — fetches balance itself and
		* refreshes every 60s. Clicking opens a detail popover (balance, today
		* cost, top-up, refresh) using only global data.
		* @param {Object} props - wide (sidebar expanded), t (locale).
		*/
		function SidebarBalanceCard({ wide, t, useSessions }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [balance, setBalance] = (0, react.useState)(null);
			const [lastPrompt, setLastPrompt] = (0, react.useState)(null);
			const [todaySession, setTodaySession] = (0, react.useState)(null);
			const [sessionTitle, setSessionTitle] = (0, react.useState)(null);
			const [todayWs, setTodayWs] = (0, react.useState)(null);
			const [todayAll, setTodayAll] = (0, react.useState)(null);
			const [lowThreshold, setLowThreshold] = (0, react.useState)(5);
			const [criticalThreshold, setCriticalThreshold] = (0, react.useState)(1);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [peak, setPeak] = (0, react.useState)(null);
			//#region go-quota state (dsh-balance-widget-patch)
			/** Which face the card shows: "balance" (¥ wallet) or "quota" (Go). */
			const [mode, setMode] = (0, react.useState)(() => readStoredMode());
			const [quota, setQuota] = (0, react.useState)(null);
			const [quotaError, setQuotaError] = (0, react.useState)(null);
			const [hostPatch, setHostPatch] = (0, react.useState)(null);
			//#endregion
			/**
			* Viewport position of the popover. The panel is portalled into
			* document.body because the sidebar column clips its children
			* (`overflow:hidden`), which cut the panel off at the sidebar edge once
			* the shell collapsed into its 56px rail. Body still carries the theme
			* tokens, so a portalled panel keeps its surface colors.
			*/
			const [popPos, setPopPos] = (0, react.useState)(null);
			// The currently selected session id (the session the user is viewing).
			// This anchors "today · this workspace" to the actual current workspace.
			// DSH 0.2.x removed the `current` field from the sessions snapshot;
			// the current session is the one the main view retains.
			const currentSessionId = typeof useSessions === "function"
				? (0, useSessions)((s) => {
					const row = Object.values(s.byId ?? {}).find((session) => (session.retainedBy?.mainView ?? 0) > 0);
					return row?.id;
				})
				: void 0;
			/** Fetch today's costs (workspace + all) from the dual-value route. */
			const fetchTodayCosts = async () => {
				const url = currentSessionId !== void 0 && currentSessionId !== ""
					? `${TODAY_COST_ROUTE}?session=${encodeURIComponent(currentSessionId)}`
					: TODAY_COST_ROUTE;
				const response = await fetch(url, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) return { ok: false, error: payload.error ?? `today-cost responded ${response.status}` };
				return {
					ok: true,
					workspace: payload.workspace?.cost ?? 0,
					all: payload.all?.cost ?? 0
				};
			};
			const refresh = async (showLoading) => {
				if (showLoading) setLoading(true);
				setError(null);
				const [bResult, aResult, tResult, qResult] = await Promise.all([
					fetchBalance(),
					fetchActiveCost(currentSessionId),
					fetchTodayCosts(),
					// Opening the popover (showLoading) also refreshes the quota,
					// so the switch always lands on fresh numbers.
					fetchQuota(showLoading === true)
				]);
				const failures = [];
				if (bResult.ok) {
					setBalance(displayBalance(bResult.balanceInfos));
					if (typeof bResult.lowThreshold === "number" && bResult.lowThreshold >= 0) setLowThreshold(bResult.lowThreshold);
					if (typeof bResult.criticalThreshold === "number" && bResult.criticalThreshold >= 0) setCriticalThreshold(bResult.criticalThreshold);
				} else {
					failures.push(`余额: ${bResult.error}`);
				}
				if (aResult.ok) {
					setLastPrompt(aResult.lastPrompt);
					setTodaySession(aResult.todaySession);
					setSessionTitle(aResult.sessionTitle ?? null);
					setPeak(aResult.peak ?? null);
				} else {
					failures.push(`会话: ${aResult.error}`);
				}
				if (tResult.ok) {
					setTodayWs(tResult.workspace);
					setTodayAll(tResult.all);
				} else {
					failures.push(`今日: ${tResult.error}`);
				}
				if (qResult.ok) {
					setQuota(qResult.windows);
					setQuotaError(null);
					setHostPatch(qResult.hostPatch ?? null);
					// No local preference yet: adopt the host's configured default.
					setMode((previous) => previous ?? (qResult.mode === "quota" ? "quota" : "balance"));
				} else {
					setQuotaError(qResult.error);
				}
				setError(failures.length > 0 ? failures.join("；") : null);
				if (showLoading) setLoading(false);
			};
			(0, react.useEffect)(() => {
				refresh(false);
				const timer = setInterval(() => refresh(false), 60000);
				return () => clearInterval(timer);
			}, [currentSessionId]);
			// Close the popover when clicking outside the card or its portalled panel.
			const wrapRef = (0, react.useRef)(null);
			const popRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDocClick = (event) => {
					const el = wrapRef.current;
					const panel = popRef.current;
					if (el !== null && el.contains(event.target)) return;
					if (panel !== null && panel.contains(event.target)) return;
					setOpen(false);
				};
				document.addEventListener("mousedown", onDocClick);
				return () => document.removeEventListener("mousedown", onDocClick);
			}, [open]);
			/**
			* Anchor the panel just above the card: same width as the card (never
			* narrower than PANEL_MIN_WIDTH), kept inside the viewport.
			*/
			const placePopover = () => {
				const el = wrapRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				// The panel matches the card it drops out of, so the two line up
				// whatever width the user gave the sidebar; 240px is the floor for
				// the collapsed rail, where the card is only 36px wide.
				const PANEL_MIN_WIDTH = 240;
				const width = Math.max(PANEL_MIN_WIDTH, Math.round(rect.width));
				setPopPos({
					left: Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8)),
					bottom: Math.max(8, Math.round(window.innerHeight - rect.top + 8)),
					width: Math.min(width, window.innerWidth - 16)
				});
			};
			// Keep the portalled panel glued to the card while the layout moves:
			// the sidebar can be dragged wider, collapsed or the window resized
			// with the panel still open, and a fixed-position panel cannot follow
			// on its own.
			(0, react.useEffect)(() => {
				if (!open) return;
				const reposition = () => placePopover();
				window.addEventListener("resize", reposition);
				const el = wrapRef.current;
				const observer = typeof ResizeObserver === "function" && el !== null ? new ResizeObserver(reposition) : null;
				if (observer !== null) observer.observe(el);
				return () => {
					window.removeEventListener("resize", reposition);
					if (observer !== null) observer.disconnect();
				};
			}, [open]);
			const level = balance === null ? 0 : balance.total < criticalThreshold ? 2 : balance.total < lowThreshold ? 1 : 0;
			//#region go-quota derived (dsh-balance-widget-patch)
			/** The face the card renders before the host has answered. */
			const effectiveMode = mode ?? "balance";
			const quotaWindows = quota ?? [];
			const fiveHourWindow = quotaWindows.find((window) => window.id === "fiveHour") ?? null;
			const fiveHourFraction = windowFraction(fiveHourWindow);
			const fiveHourLevel = levelOf(fiveHourFraction);
			/**
			* Flip the card between the ¥ wallet and the Go quota. The choice is
			* remembered locally; the host config only supplies the first default.
			*/
			const switchMode = (next) => {
				if (next === effectiveMode) return;
				storeMode(next);
				setMode(next);
				if (next === "quota" && quota === null) {
					void fetchQuota(true).then((result) => {
						if (result.ok) {
							setQuota(result.windows);
							setQuotaError(null);
						} else {
							setQuotaError(result.error);
						}
					});
				}
			};
			//#endregion
			const toggle = async () => {
				const next = !open;
				if (next) placePopover();
				setOpen(next);
				if (next) await refresh(true);
			};
			return (0, react_jsx_runtime.jsx)("div", {
				ref: wrapRef,
				className: styles.sideWrap,
				// The sidebar shell hands the slot a `wide` flag: collapsed, the
				// foot becomes a 56px icon rail, so the card shrinks to one glyph.
				"data-compact": wide === false ? "true" : undefined,
				children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
					children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: styles.side,
						"data-peak": peak !== null ? String(peak.active) : undefined,
						title: t("title"),
						onClick: toggle,
						children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
							children: [(0, react_jsx_runtime.jsx)("div", {
								className: styles.sideTop,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", { className: "dshbw_ico",
										children: effectiveMode === "quota"
											? quotaCardGlyph()
											: (0, react_jsx_runtime.jsx)("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", children: [(0, react_jsx_runtime.jsx)("rect", { x: 3, y: 6, width: 18, height: 13, rx: 2 }), (0, react_jsx_runtime.jsx)("path", { d: "M3 10h18" })] })
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.sideAmount,
										"data-level": (effectiveMode === "quota" ? fiveHourLevel : level) > 0 ? (effectiveMode === "quota" ? fiveHourLevel : level) : undefined,
										children: effectiveMode === "quota"
											? (fiveHourWindow !== null ? t("quota.pct", { pct: String(Math.round(fiveHourFraction * 100)) }) : "—")
											: (balance !== null ? `${balance.symbol}${balance.total.toFixed(2)}` : "—")
									})]
								})
							}), (0, react_jsx_runtime.jsx)("div", {
								className: styles.sideFoot,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										children: effectiveMode === "quota" ? t("quota.fiveHour") : t("todayCostShort")
									}), effectiveMode === "quota"
										? (fiveHourWindow === null
											? (0, react_jsx_runtime.jsx)("span", { children: "—" })
											: (0, react_jsx_runtime.jsx)("span", {
												className: qStyles.mini,
												role: "progressbar",
												"aria-label": t("quota.fiveHour"),
												"aria-valuemin": 0,
												"aria-valuemax": 100,
												"aria-valuenow": Math.round(fiveHourFraction * 100),
												children: (0, react_jsx_runtime.jsx)("span", {
													className: qStyles.miniFill,
													"data-level": fiveHourLevel > 0 ? fiveHourLevel : undefined,
													style: { width: `${Math.round(fiveHourFraction * 100)}%` }
												})
											}))
										: (0, react_jsx_runtime.jsx)("span", {
											children: todayAll !== null ? formatCny(todayAll) : "—"
										})]
								})
							})]
						})
					}), open && popPos !== null && (0, react_dom.createPortal)((0, react_jsx_runtime.jsx)("div", {
						ref: popRef,
						className: styles.sidePop,
						"data-peak": peak !== null ? String(peak.active) : undefined,
						role: "dialog",
						style: { left: popPos.left, bottom: popPos.bottom, width: popPos.width },
						children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
							children: [(0, react_jsx_runtime.jsx)("div", {
								className: styles.sidePopHead,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: styles.sidePopTitle,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [t("title"), peak !== null && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
												label: peak.active
													? t("peak.tooltip.active", { input: peak.inputMiss, output: peak.output })
													: t("peak.tooltip.offpeak", { input: peak.inputMiss, output: peak.output }),
												side: "top",
												delayMs: 200,
												children: (0, react_jsx_runtime.jsx)("span", {
													className: styles.peakTag,
													"data-peak": String(peak.active),
													children: peak.active ? t("peak.active") : t("peak.offpeak")
												})
											})]
										})
									}), (0, react_jsx_runtime.jsx)("div", {
										className: qStyles.switch,
										role: "group",
										"aria-label": t("mode.aria"),
										children: [(0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: qStyles.segment,
											"data-on": String(effectiveMode === "balance"),
											onClick: () => switchMode("balance"),
											children: t("mode.balance")
										}), (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: qStyles.segment,
											"data-on": String(effectiveMode === "quota"),
											onClick: () => switchMode("quota"),
											children: t("mode.quota")
										})]
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: styles.sidePopClose,
										"aria-label": t("close"),
										onClick: () => setOpen(false),
										children: "×"
									})]
								})
							}), effectiveMode !== "quota" && (0, react_jsx_runtime.jsx)("div", {
								className: styles.row,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: styles.label,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [t("balance"), (0, react_jsx_runtime.jsx)(ExplainIcon, {
												label: t("explain.balance"),
												t
											})]
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.val,
										"data-level": level > 0 ? level : undefined,
										children: loading ? "…" : balance !== null ? `${balance.symbol}${balance.total.toFixed(2)}` : "—"
									})]
								})
							}), effectiveMode !== "quota" && level > 0 && (0, react_jsx_runtime.jsx)("div", {
								className: styles.err,
								role: "status",
								children: t(`warn.text.${level}`)
							}), effectiveMode !== "quota" && (0, react_jsx_runtime.jsx)("div", {
								className: styles.row,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: styles.label,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [t("lastPrompt"), (0, react_jsx_runtime.jsx)(ExplainIcon, {
												label: t("explain.lastPrompt"),
												t
											})]
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.val, "data-tier": "ter",
										children: loading ? "…" : lastPrompt !== null ? formatCny(lastPrompt) : "—"
									})]
								})
							}), effectiveMode !== "quota" && sessionTitle !== null && sessionTitle !== "" && (0, react_jsx_runtime.jsx)("div", {
								className: styles.sessionNote,
								title: sessionTitle,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										children: t("sessionNote")
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.sessionName,
										children: sessionTitle
									})]
								})
							}), effectiveMode !== "quota" && (0, react_jsx_runtime.jsx)("div", {
								className: styles.row,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: styles.label,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [t("todaySession"), (0, react_jsx_runtime.jsx)(ExplainIcon, {
												label: t("explain.todaySession"),
												t
											})]
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.val,
										children: loading ? "…" : todaySession !== null ? formatCny(todaySession) : "—"
									})]
								})
							}), effectiveMode !== "quota" && (0, react_jsx_runtime.jsx)("div", {
								className: styles.row,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: styles.label,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [t("todayWs"), (0, react_jsx_runtime.jsx)(ExplainIcon, {
												label: t("explain.todayWs"),
												t
											})]
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.val, "data-tier": "sec",
										children: loading ? "…" : todayWs !== null ? formatCny(todayWs) : "—"
									})]
								})
							}), effectiveMode !== "quota" && (0, react_jsx_runtime.jsx)("div", {
								className: styles.row,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: styles.label,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [t("todayAll"), (0, react_jsx_runtime.jsx)(ExplainIcon, {
												label: t("explain.todayAll"),
												t
											})]
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: styles.val, "data-tier": "sec",
										children: loading ? "…" : todayAll !== null ? formatCny(todayAll) : "—"
									})]
								})
							}), effectiveMode === "quota" && QUOTA_ROWS.map((entry) => {
								const row = quotaWindows.find((candidate) => candidate.id === entry.id) ?? null;
								const fraction = windowFraction(row);
								const pct = Math.round(fraction * 100);
								const windowLevel = levelOf(fraction);
								const countdown = row === null ? null : formatCountdown(row.resetsAt);
								return (0, react_jsx_runtime.jsxs)("div", {
									key: entry.id,
									children: [(0, react_jsx_runtime.jsx)("div", {
										className: styles.row,
										children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: styles.label,
												children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
													children: [t(entry.labelKey), (0, react_jsx_runtime.jsx)(ExplainIcon, {
														label: t(`${entry.labelKey}.explain`),
														t
													})]
												})
											}), (0, react_jsx_runtime.jsx)("span", {
												className: qStyles.pct,
												"data-level": windowLevel > 0 ? windowLevel : undefined,
												children: loading ? "…" : row !== null ? t("quota.pct", { pct: String(pct) }) : "—"
											})]
										})
									}), row === null
										? (0, react_jsx_runtime.jsx)("div", {
											className: qStyles.note,
											children: t("quota.unavailable")
										})
										: (0, react_jsx_runtime.jsxs)("div", {
											className: qStyles.barRow,
											role: "progressbar",
											"aria-label": t(entry.labelKey),
											"aria-valuemin": 0,
											"aria-valuemax": 100,
											"aria-valuenow": pct,
											children: [(0, react_jsx_runtime.jsx)("div", {
												className: qStyles.bar,
												children: (0, react_jsx_runtime.jsx)("div", {
													className: qStyles.barFill,
													"data-level": windowLevel > 0 ? windowLevel : undefined,
													style: { width: `${pct}%` }
												})
											}), (0, react_jsx_runtime.jsx)("span", {
												className: qStyles.barHint,
												children: countdown === null ? t("quota.barRolling") : t("quota.barReset", { reset: countdown })
											})]
										})]
								});
							}), effectiveMode === "quota" && (0, react_jsx_runtime.jsxs)("div", {
								className: `${qStyles.today} ${styles.row}`,
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: styles.label,
									children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
										children: [t("todayUsed"), (0, react_jsx_runtime.jsx)(ExplainIcon, {
											label: t("explain.todayAll"),
											t
										})]
									})
								}), (0, react_jsx_runtime.jsx)("span", {
									className: styles.val,
									children: loading ? "…" : todayAll !== null ? formatCny(todayAll) : "—"
								})]
							}), effectiveMode === "quota" && hostPatch === "pending-restart" && (0, react_jsx_runtime.jsx)("div", {
								className: qStyles.note,
								role: "status",
								children: t("hostPatch.pending")
							}), effectiveMode === "quota" && quotaError !== null && (0, react_jsx_runtime.jsx)("div", {
								className: styles.err,
								role: "status",
								children: quotaError
							}), effectiveMode !== "quota" && error !== null && (0, react_jsx_runtime.jsx)("div", {
								className: styles.err,
								role: "status",
								children: error
							}), (0, react_jsx_runtime.jsx)("div", {
								className: styles.sidePopFoot,
								children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
									children: [effectiveMode === "quota" ? (0, react_jsx_runtime.jsx)("a", {
										className: styles.link,
										href: USAGE_URL,
										target: "_blank",
										rel: "noreferrer",
										children: t("quota.link")
									}) : (0, react_jsx_runtime.jsx)("a", {
										className: styles.link,
										href: TOP_UP_URL,
										target: "_blank",
										rel: "noreferrer",
										children: t("topUp")
									}), (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: styles.sidePopRefresh,
										"aria-label": t("refresh.aria"),
										title: t("refresh.title"),
										onClick: () => refresh(true),
										children: refreshGlyph()
									})]
								})
							})]
						})
					}), document.body)]
				})
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "balance-widget";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"aria": "查看账户余额与成本",
			"title": "余额与成本",
			"refresh.aria": "刷新数据",
			"refresh.title": "刷新余额与成本",
			"balance": "账户余额",
			"lastPrompt": "最近一次提问",
			"todaySession": "今日·本会话",
			"todayWs": "今日·本工作区",
			"todayAll": "今日·所有工作区",
			"explain.aria": "解释",
			"explain.balance": "DeepSeek 账户可用余额，实时查询官方接口。",
			"explain.lastPrompt": "当前会话最后一个问题（含 AI 回复及该轮子代理）的费用估算。",
			"explain.todaySession": "当前会话今天产生的费用估算（含该会话派生的子代理/团队成员）。",
			"explain.todayWs": "当前工作区今天所有会话的费用合计估算。",
			"explain.todayAll": "所有工作区今天所有会话的费用合计估算（含其他项目）。",
			"warn.title.1": "余额不足 ¥5，建议及时充值",
			"warn.title.2": "余额低于 ¥1，即将耗尽！",
			"warn.text.1": "⚠️ 余额不足 ¥5，建议及时充值。",
			"warn.text.2": "⛔ 余额低于 ¥1，即将耗尽，请立即充值！",
			"todayCostShort": "今日·全部",
			"peak.active": "峰时",
			"peak.offpeak": "谷时",
			"peak.tooltip.active": "当前为峰时（周一至周五 09:00-12:00、14:00-18:00，不含法定节假日，价格翻倍）：输入 ¥{input}/M · 输出 ¥{output}/M",
			"peak.tooltip.offpeak": "当前为谷时（其余时段：周末含调休上班日、法定节假日全天，半价）：输入 ¥{input}/M · 输出 ¥{output}/M",
			"sessionNote": "基于最近活跃会话：",
			"hint": "价格为估算值，实际以官方账单为准。",
			"topUp": "去充值",
			"close": "关闭",
			"mode.aria": "切换余额与 Go 额度",
			"mode.balance": "余额",
			"mode.quota": "额度",
			"quota.fiveHour": "Go 5 小时额度",
			"quota.fiveHour.explain": "OpenCode Go 的 5 小时窗口额度（Flash 为月额度 $80 的 20% = $16）。DSH 没有 Console 会话、读不到窗口的真实起点，这里按最近 5 小时滚动统计，只会偏保守。",
			"quota.week": "Go 本周额度",
			"quota.week.explain": "UTC 日历周（每周一 00:00Z 起算）的 Go 额度上限，为月额度的 50%（Flash $40）。",
			"quota.month": "Go 账期额度",
			"quota.month.explain": "Go 订阅账期内的额度上限（Flash 每月 $80）。DSH 读不到账期起点，默认按 UTC 自然月统计；可在插件配置里用 goPeriodStart 填真实账期起点。",
			"quota.pct": "{pct}%",
			"quota.barRolling": "滚动 5 小时窗口",
			"quota.barReset": "{reset} 后重置",
			"quota.unavailable": "额度数据暂不可用",
			"quota.link": "OpenCode 用量",
			"todayUsed": "今日已用",
			"hostPatch.pending": "补丁的 host 半边已写回，重启 DSH 后生效"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"aria": "View account balance and costs",
			"title": "Balance & cost",
			"refresh.aria": "Refresh data",
			"refresh.title": "Refresh balance and costs",
			"balance": "Account balance",
			"lastPrompt": "Last prompt",
			"todaySession": "Today · this session",
			"todayWs": "Today · this workspace",
			"todayAll": "Today · all workspaces",
			"explain.aria": "Explain",
			"explain.balance": "DeepSeek account balance, fetched live from the official API.",
			"explain.lastPrompt": "Estimated cost of the last question in the current session (incl. the reply and that turn's subagents).",
			"explain.todaySession": "Estimated cost of today's usage in the current session, including subagents/team members it spawned.",
			"explain.todayWs": "Estimated total cost of today's sessions in the current workspace.",
			"explain.todayAll": "Estimated total cost of today's sessions across all workspaces.",
			"warn.title.1": "Balance below ¥5, consider topping up",
			"warn.title.2": "Balance below ¥1, almost exhausted!",
			"warn.text.1": "⚠️ Balance below ¥5, consider topping up.",
			"warn.text.2": "⛔ Balance below ¥1, almost exhausted — top up now!",
			"todayCostShort": "Today · all",
			"peak.active": "Peak",
			"peak.offpeak": "Off-peak",
			"peak.tooltip.active": "Peak hours now (Mon-Fri 09:00-12:00, 14:00-18:00, statutory holidays excluded, 2× price): input ¥{input}/M · output ¥{output}/M",
			"peak.tooltip.offpeak": "Off-peak hours now (everything else: weekends incl. make-up workdays, statutory holidays all day, half price): input ¥{input}/M · output ¥{output}/M",
			"sessionNote": "Based on most recent session:",
			"hint": "Prices are estimates; actual billing from the provider is authoritative.",
			"topUp": "Top up",
			"close": "Close",
			"mode.aria": "Switch between balance and Go quota",
			"mode.balance": "Balance",
			"mode.quota": "Quota",
			"quota.fiveHour": "Go 5-hour quota",
			"quota.fiveHour.explain": "The OpenCode Go 5-hour window (20% of Flash's $80 monthly allowance = $16). Without a Console session DSH cannot read the window's real start, so this counts the last 5 hours — a conservative reading.",
			"quota.week": "Go weekly quota",
			"quota.week.explain": "The Go cap for the UTC calendar week (from Monday 00:00Z): 50% of the monthly allowance (Flash $40).",
			"quota.month": "Go period quota",
			"quota.month.explain": "The Go cap for the billing period (Flash: $80/month). The period start is not readable with an inference key, so this defaults to the UTC calendar month; pin it with goPeriodStart in the plugin config.",
			"quota.pct": "{pct}%",
			"quota.barRolling": "rolling 5-hour window",
			"quota.barReset": "resets in {reset}",
			"quota.unavailable": "Quota data unavailable",
			"quota.link": "OpenCode usage",
			"todayUsed": "Used today",
			"hostPatch.pending": "The host half of the patch was re-applied; restart DSH to activate it"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Required services: the seat's slot registry and locale registry. */
		const inject = [
			"slots",
			"locale"
		];
		/**
		* Client plugin body: register the sidebar footer balance card (the
		* single entry point since v0.4.1; the former header widget is removed
		* to avoid duplicate always-visible balances).
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-balance-widget: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "balance-widget",
				order: 10,
				locale: NS
			}, SidebarBalanceCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
