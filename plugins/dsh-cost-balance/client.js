/**
 * Browser half of `dsh-cost-balance`.
 *
 * Hand-written bundle in the loader's closure-factory format (no tsdown pass):
 * `window.__ModuleLoader__.load({ id, factory })`, CJS inside the factory, the
 * returned `module.exports` is an ordinary cordis plugin (`inject` + `apply`).
 *
 * It contributes ONE entry to the `conversation.composer.dock` list slot — the
 * ambient line under the composer where the shipped `stats` row already lives —
 * and renders:
 *
 *   本次消费 ¥0.0234 ｜ 余额 ¥18.32
 *
 * Cost is folded client-side from the durable `tokenUsage` session projection
 * (cache-miss input, cache-read input and output are already disjoint counts),
 * so it updates on every render with no polling. Only the account balance is
 * fetched, from the host half's `/cost-balance/state` route.
 *
 * @module dsh-cost-balance/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-cost-balance',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React

    /** Host route serving the balance, the live tariff, and the price table. */
    const ENDPOINT = '/cost-balance/state'
    /**
     * Identity of this browser half. Bump it whenever this file changes: every
     * poll carries it, so the host route's `client.build` says exactly which
     * revision the live page is running (`curl <gui>/cost-balance/state`).
     */
    const BUILD = 'r5'
    /** Balance refresh cadence; the balance is a slowly moving number. */
    const POLL_MS = 60_000
    /**
     * Last-resort price table used until the host route answers (and if it
     * never does). KEEP IN SYNC with `prices.js` — that file is authoritative
     * and overrides this one as soon as the first response lands.
     */
    const FALLBACK = {
      currency: 'CNY',
      unit: 1_000_000,
      fallbackModel: 'deepseek-flash',
      models: {
        'deepseek-flash': {
          cacheHit: { peak: 0.04, offPeak: 0.02 },
          cacheMiss: { peak: 2, offPeak: 1 },
          output: { peak: 8, offPeak: 4 },
        },
      },
    }

    /**
     * Last-resort tariff policy: used for the moment before the host answers,
     * and for a host whose payload predates `tariffPolicy`. Once the payload
     * carries a policy the served copy wins — but this built-in copy still has
     * to be right today, because "peak unless weekend" doubles the cost of a
     * statutory holiday (a mistake this plugin made until 2026-09-25).
     */
    const FALLBACK_TARIFF_POLICY = {
      peakHours: { timeZone: 'Asia/Shanghai', weekdays: [1, 2, 3, 4, 5], ranges: [[9, 12], [14, 18]] },
      holidays: [
        '2026-01-01', '2026-01-02', '2026-01-03',
        '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
        '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
        '2026-04-04', '2026-04-05', '2026-04-06',
        '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
        '2026-06-19', '2026-06-20', '2026-06-21',
        '2026-09-25', '2026-09-26', '2026-09-27',
        '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
        '2026-10-06', '2026-10-07',
      ],
      calendarYear: 2026,
    }

    /** Beijing wall-clock formatter, built once. */
    const BEIJING_CLOCK = typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function'
      ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false, weekday: 'short',
        year: 'numeric', month: '2-digit', day: '2-digit',
      })
      : null

    /**
     * Beijing wall-clock parts of one instant.
     * @param date - instant to decompose.
     * @returns local hour (0-23), ISO weekday (1-7), and `YYYY-MM-DD`.
     */
    function beijingParts(date) {
      const parts = BEIJING_CLOCK.formatToParts(date)
      const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
      const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const hour = Number(pick('hour') || '0')
      return {
        hour: hour === 24 ? 0 : hour,
        weekday: names.indexOf(pick('weekday') || 'Mon') + 1,
        dateKey: `${pick('year')}-${pick('month')}-${pick('day')}`,
      }
    }

    /**
     * Which tariff column an instant falls in — the same rule the host applies:
     * a Chinese statutory holiday is off-peak ALL DAY, a weekend is off-peak,
     * and only a plain Beijing working day inside a peak window bills at peak.
     * @param date - instant to classify.
     * @param policy - tariff policy from the host payload, when it carries one.
     * @returns 'peak' or 'offPeak'.
     */
    function tariffAt(date, policy) {
      const peakHours = policy?.peakHours ?? FALLBACK_TARIFF_POLICY.peakHours
      const holidays = policy?.holidays ?? FALLBACK_TARIFF_POLICY.holidays
      const { hour, weekday, dateKey } = beijingParts(date)
      if (holidays.includes(dateKey)) return 'offPeak'
      if (!peakHours.weekdays.includes(weekday)) return 'offPeak'
      return peakHours.ranges.some(([from, to]) => hour >= from && hour < to) ? 'peak' : 'offPeak'
    }

    /**
     * Whether one instant is a Beijing statutory holiday (drives the tooltip).
     * @param date - instant to test.
     * @param policy - tariff policy from the host payload, when it carries one.
     * @returns true when the whole day bills at off-peak rates.
     */
    function isHoliday(date, policy) {
      const holidays = policy?.holidays ?? FALLBACK_TARIFF_POLICY.holidays
      return holidays.includes(beijingParts(date).dateKey)
    }

    /** localStorage key holding one wallet baseline per conversation. */
    const BASELINE_KEY = 'dsh-cost-balance/wallet-baselines.v1'
    /** How many conversations keep a stored baseline. */
    const BASELINE_KEEP = 50

    /**
     * Read the stored wallet baselines.
     * @returns a sessionId → { balance, currency, at } map (empty when unreadable).
     */
    function readBaselines() {
      try {
        const raw = globalThis.localStorage?.getItem(BASELINE_KEY)
        const parsed = raw === null || raw === undefined ? null : JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /**
     * Persist the wallet baselines, keeping the most recent entries.
     * @param store - the map to persist.
     */
    function writeBaselines(store) {
      try {
        const entries = Object.entries(store).sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0)).slice(0, BASELINE_KEEP)
        globalThis.localStorage?.setItem(BASELINE_KEY, JSON.stringify(Object.fromEntries(entries)))
      } catch {
        // A browser with storage disabled still shows the token estimate.
      }
    }

    /**
     * Resolve the wallet baseline for one conversation.
     *
     * The provider reports no per-conversation money figure, so the only
     * official number is the wallet delta: the balance before the conversation
     * minus the balance now. A conversation the plugin watched from its first
     * token has a real baseline; one that started earlier is seeded with
     * `current + estimated cost so far`, which makes the delta start at the
     * estimate and follow the wallet from there.
     *
     * @param store - the persisted baseline map.
     * @param sessionId - conversation key.
     * @param balance - the served balance frame.
     * @param estimatedCost - token-priced cost of this conversation so far.
     * @returns the baseline entry and whether it was just seeded.
     */
    function resolveBaseline(store, sessionId, balance, estimatedCost) {
      const key = String(sessionId ?? 'unknown')
      const existing = store[key]
      if (existing !== undefined && existing.currency === balance.currency && Number.isFinite(existing.balance)) {
        return { entry: existing, seeded: false }
      }
      return {
        entry: {
          balance: Math.round((balance.total + estimatedCost) * 10_000) / 10_000,
          currency: balance.currency,
          at: Date.now(),
        },
        seeded: true,
      }
    }

    /**
     * Money actually taken from the wallet since the baseline, in the wallet's
     * currency. Settlement is asynchronous, so this can read low for a while.
     * @param entry - the stored baseline entry.
     * @param balance - the served balance frame.
     * @returns the delta, or null when it cannot be computed.
     */
    function spentFrom(entry, balance) {
      if (entry === undefined || balance?.ok !== true) return null
      if (entry.currency !== balance.currency || !Number.isFinite(balance.total)) return null
      return Math.max(0, Math.round((entry.balance - balance.total) * 10_000) / 10_000)
    }

    /**
     * Marks the dock row this entry shares with the shipped session-stats line
     * and the context-occupancy meter. Set by the component from the DOM (the
     * nearest row-direction flex ancestor), because the shipped class name is a
     * build-hashed CSS-module key that this out-of-tree plugin cannot know.
     */
    const DOCK_ATTR = 'data-dsh-cost-dock'

    const CSS = `
/* This row, the shipped session-stats line, and the context-occupancy meter
   share one dock: a centered flex row with a 12px gap (shipped). What pushes
   them apart is each child's own \`width: 100%\` box, which the flex algorithm
   stretches into thirds and then ellipsizes. Sizing every child to its content
   makes the three read as one centered group instead of three columns. */
.dsh-cost-balance {
  display: inline-flex;
  align-items: center;
  flex: none;
  width: auto;
  max-width: none;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.dsh-cost-balance-sep {
  color: var(--dsw-alias-separator-primary, var(--dsw-alias-label-tertiary));
  margin: 0 10px;
}
.dsh-cost-balance-value {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-cost-balance-warn {
  color: var(--dsw-alias-state-warn-primary);
}
[${DOCK_ATTR}] {
  flex-wrap: wrap;
  row-gap: 2px;
}
[${DOCK_ATTR}] > * {
  flex: 0 0 auto !important;
  width: auto !important;
  max-width: none !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
}
[${DOCK_ATTR}] > *:not(.dsh-cost-balance) {
  padding-left: 0 !important;
  padding-right: 0 !important;
  overflow: visible !important;
  text-overflow: clip !important;
}
`

    const STYLE_KEY = 'dsh-cost-balance/client.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_KEY)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-cost-balance'
      tag.dataset.pluginCss = STYLE_KEY
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Describe the dock row for the host route (`client.dock`), so the actual
     * rendered structure is inspectable from a terminal: tag/class of the row,
     * then each child's tag, class, and leading text.
     * @param dock - the marked dock row.
     * @returns a short diagnostic string.
     */
    function describeDock(dock) {
      const short = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 28)
      const kids = [...dock.children].map((child) => `${child.tagName.toLowerCase()}.${short(child.className)}«${short(child.textContent)}»`)
      return `${dock.tagName.toLowerCase()}.${short(dock.className)}[${dock.children.length}]{${kids.join(' ')}}`.slice(0, 320)
    }

    /**
     * Compact token count: 517 / 12.2K / 1.2M.
     * @param n - token count.
     * @returns display string.
     */
    function formatTokens(n) {
      const scaled = (value) => (value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10))
      if (n < 1_000) return String(n)
      if (n < 1_000_000) return `${scaled(n / 1_000)}K`
      return `${scaled(n / 1_000_000)}M`
    }

    /**
     * Money string: 4 decimals while the amount is small, 2 once it is not.
     * @param n - amount in the table's currency.
     * @returns display string.
     */
    function formatMoney(n) {
      if (!Number.isFinite(n)) return '—'
      return n < 0.1 ? n.toFixed(4) : n.toFixed(2)
    }

    /**
     * Resolve the per-million prices of one model under one tariff column.
     * @param prices - served or fallback price table.
     * @param modelId - selected model id.
     * @param tariff - 'peak' or 'offPeak'.
     * @returns the three unit prices, or null when nothing can price the model.
     */
    function unitPrices(prices, modelId, tariff) {
      const models = prices?.models ?? {}
      const row = models[modelId] ?? models[prices?.fallbackModel]
      if (row === undefined) return null
      const column = tariff === 'offPeak' ? 'offPeak' : 'peak'
      return {
        hit: Number(row.cacheHit?.[column] ?? 0),
        miss: Number(row.cacheMiss?.[column] ?? 0),
        output: Number(row.output?.[column] ?? 0),
      }
    }

    /** The four durable token buckets, as plain numbers. */
    function buckets(usage) {
      return {
        miss: usage?.uncachedInputTokens ?? 0,
        hit: usage?.cacheReadTokens ?? 0,
        // DeepSeek reports no cache-write bucket; priced at the miss rate if one ever appears.
        write: usage?.cacheWriteTokens ?? 0,
        output: usage?.outputTokens ?? 0,
      }
    }

    /**
     * Price one bucket delta under one unit price row.
     * @param delta - token counts to price.
     * @param units - CNY-per-million prices for the three charged buckets.
     * @param unit - tokens per price unit.
     * @returns the money for that delta.
     */
    function priceDelta(delta, units, unit) {
      return ((delta.miss + delta.write) * units.miss + delta.hit * units.hit + delta.output * units.output) / unit
    }

    /**
     * Bucket-wise difference, floored at zero: a compaction rewrites the durable
     * log and can shrink a projection total, which must never price negatively.
     * @param now - current buckets.
     * @param base - baseline buckets.
     * @returns the non-negative delta.
     */
    function subtractBuckets(now, base) {
      return {
        miss: Math.max(0, now.miss - base.miss),
        hit: Math.max(0, now.hit - base.hit),
        write: Math.max(0, now.write - base.write),
        output: Math.max(0, now.output - base.output),
      }
    }

    /** Zero buckets: the baseline a conversation starts from. */
    const ZERO_BUCKETS = { miss: 0, hit: 0, write: 0, output: 0 }

    /**
     * Money for one conversation, accumulated across tariff changes.
     *
     * The durable `tokenUsage` projection is a running total with no timestamps,
     * so a single fold would retroactively re-price the whole conversation every
     * time the peak/off-peak window flips (a 2x jump). Instead the growth since
     * the last re-base is priced at the tariff in effect now, and a flip freezes
     * that growth into the total before re-basing, so already-priced tokens are
     * never re-priced.
     *
     * @param memory - mutable per-conversation accumulator (one object per session).
     * @param usage - current durable projection value.
     * @param prices - served price table.
     * @param tariff - current tariff column.
     * @param modelId - selected model id.
     * @returns the accumulated cost, the current buckets, and the resolved unit prices.
     */
    function accumulatedCost(memory, usage, prices, tariff, modelId) {
      const now = buckets(usage)
      const units = unitPrices(prices, modelId, tariff)
      if (units === null) return { cost: 0, now, units: null }
      const unit = Number(prices?.unit ?? 1_000_000)
      if (memory.tariff !== tariff) {
        const baseUnits = unitPrices(prices, modelId, memory.tariff)
        if (baseUnits !== null) memory.cost += priceDelta(subtractBuckets(now, memory.baseline), baseUnits, unit)
        memory.tariff = tariff
        memory.baseline = now
      }
      const delta = subtractBuckets(now, memory.baseline)
      return { cost: memory.cost + priceDelta(delta, units, unit), now, units }
    }

    /** Money label: ¥ when the currency is CNY, else the code. */
    function moneyLabel(amount, currency) {
      const symbol = currency === 'CNY' ? '¥' : ''
      return symbol === '' ? `${amount} ${currency ?? ''}`.trim() : `${symbol}${amount}`
    }

    /**
     * The dock row: conversation cost folded from the durable usage projection,
     * plus the account balance polled from the host half.
     * @param props - slot props (standard props carry `useProjection`).
     * @returns the row element, or null while there is nothing to say.
     */
    function CostBalanceLine(props) {
      const useProjection = props?.useProjection
      const sessionId = props?.sessionId
      const usage = typeof useProjection === 'function' ? useProjection('tokenUsage') : undefined
      const [remote, setRemote] = useState(null)
      const memoryRef = useRef(null)
      /** Per-conversation wallet baseline; resolved once, then kept. */
      const walletRef = useRef(null)
      const rootRef = useRef(null)
      /** Diagnostic description of the shared dock row, filled on mount. */
      const dockRef = useRef('')

      // Mark the dock row this entry shares with the shipped stats line and the
      // context meter, so the injected CSS can size all three to their content.
      useEffect(() => {
        const el = rootRef.current
        if (el === null || el === undefined) return
        let node = el.parentElement
        while (node !== null) {
          const style = getComputedStyle(node)
          if (style.display === 'flex' && style.flexDirection === 'row') {
            node.setAttribute(DOCK_ATTR, '')
            dockRef.current = typeof describeDock === 'function' ? describeDock(node) : ''
            return
          }
          node = node.parentElement
        }
      }, [])

      const refresh = useCallback(() => {
        let alive = true
        const query = `build=${encodeURIComponent(BUILD)}&dock=${encodeURIComponent(dockRef.current)}`
        fetch(`${ENDPOINT}?${query}`, { cache: 'no-store', headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((body) => { if (alive) setRemote({ ok: true, body }) })
          .catch((error) => { if (alive) setRemote({ ok: false, error: String(error?.message ?? error) }) })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        const stop = refresh()
        const timer = setInterval(refresh, POLL_MS)
        return () => { stop(); clearInterval(timer) }
      }, [refresh])

      const prices = remote?.ok === true ? remote.body?.prices ?? FALLBACK : FALLBACK
      const policy = remote?.ok === true ? remote.body?.tariffPolicy : undefined
      const modelId = remote?.ok === true ? remote.body?.model?.model : undefined
      // The tariff is evaluated HERE, from the served policy: the client flips
      // at the boundary itself instead of up to one poll late, and a host that
      // predates `tariffPolicy` in its payload still gets holiday-aware pricing
      // from the built-in copy.
      let tariff = 'peak'
      let holidayNow = false
      try {
        tariff = tariffAt(new Date(), policy)
        holidayNow = isHoliday(new Date(), policy)
      } catch {
        tariff = remote?.ok === true ? remote.body?.tariff ?? 'peak' : 'peak'
      }
      // One accumulator per conversation: switching sessions starts a new one.
      if (memoryRef.current === null || memoryRef.current.sessionId !== sessionId) {
        memoryRef.current = { sessionId, tariff, cost: 0, baseline: ZERO_BUCKETS }
      }
      const priced = accumulatedCost(memoryRef.current, usage, prices, tariff, modelId)
      if (priced.units === null) return null
      const totals = priced.now
      const units = priced.units
      const hasUsage = (totals.miss + totals.hit + totals.output) > 0

      const balance = remote?.ok === true ? remote.body?.balance : undefined
      const balanceText = balance?.ok === true
        ? moneyLabel(formatMoney(balance.total), balance.currency)
        : remote?.ok === false ? '余额读取失败' : '余额读取中…'
      const balanceWarn = balance?.ok === true ? '' : ' dsh-cost-balance-warn'

      // Wallet delta: the official money number. The baseline is resolved once
      // per conversation and persisted, so a page refresh (or a later visit to
      // this conversation) keeps counting from the same starting balance.
      if (walletRef.current === null || walletRef.current.sessionId !== sessionId) {
        walletRef.current = { sessionId, entry: undefined, seeded: false }
      }
      if (walletRef.current.entry === undefined && balance?.ok === true) {
        const store = readBaselines()
        const resolved = resolveBaseline(store, sessionId, balance, priced.cost)
        walletRef.current = { sessionId, entry: resolved.entry, seeded: resolved.seeded }
        if (resolved.seeded) {
          store[String(sessionId ?? 'unknown')] = resolved.entry
          writeBaselines(store)
        }
      }
      const spent = spentFrom(walletRef.current.entry, balance)

      const currency = prices?.currency ?? balance?.currency ?? 'CNY'
      const headline = spent ?? (hasUsage ? priced.cost : null)
      // The wallet settles asynchronously, so the delta can legitimately sit at
      // zero for a while even though tokens are already burning; say so instead
      // of leaving the reader to wonder whether the number is broken.
      const settling = spent !== null && hasUsage && spent === 0
      const costNode = headline === null
        ? React.createElement('span', null, '本次消费 ', React.createElement('span', { className: 'dsh-cost-balance-value' }, '—'))
        : React.createElement('span', null,
          '本次消费 ',
          React.createElement('span', { className: 'dsh-cost-balance-value' }, moneyLabel(formatMoney(headline), spent === null ? currency : balance.currency)),
          settling ? `（结算中，token 估算 ${moneyLabel(formatMoney(priced.cost), currency)}）` : null,
          headline > 0 && headline < 0.0001 ? '（不足 ¥0.0001）' : null)

      const title = [
        `模型 ${modelId ?? prices?.fallbackModel ?? '未知'} · ${tariff === 'offPeak' ? '空闲时段价' : '高峰时段价'}${holidayNow ? '（法定节假日全天）' : ''}`,
        spent !== null
          ? `余额实扣 ¥${spent.toFixed(4)} = 对话开始时余额 ${moneyLabel(formatMoney(walletRef.current.entry.balance), walletRef.current.entry.currency)} − 现在 ${balanceText}`
            + `\n（含本次对话派生的子代理等消耗；DeepSeek 扣费异步结算，数字会滞后地追上来）`
          : '余额实扣不可用，暂按 token 估算显示',
        `token 估算 ¥${priced.cost.toFixed(4)}：未命中 ${formatTokens(totals.miss)} × ${unitPricesText(units.miss)} + 命中 ${formatTokens(totals.hit)} × ${unitPricesText(units.hit)} + 输出 ${formatTokens(totals.output)} × ${unitPricesText(units.output)}`,
        'token 估算只含本会话的模型调用；子代理会话、标题生成与联网搜索调用不在其中。',
        '时段切换后，切换前已计的费用不会按新单价重算。',
        `余额每 60 秒刷新 · 价格表 ${prices?.updatedAt ?? '内置'}${prices?.source ? ` (${prices.source})` : ''}`,
      ].join('\n')

      return React.createElement('div', { className: 'dsh-cost-balance', ref: rootRef, title },
        costNode,
        React.createElement('span', { className: 'dsh-cost-balance-sep' }, '|'),
        React.createElement('span', { className: balanceWarn.trim() },
          '余额 ',
          React.createElement('span', { className: 'dsh-cost-balance-value' }, balanceText)),
      )
    }

    /**
     * Per-million price as it appears in the hover tooltip.
     * @param value - CNY per million tokens.
     * @returns display string.
     */
    function unitPricesText(value) {
      const rounded = value < 0.1 ? value.toFixed(2) : String(value)
      return `¥${rounded}/M`
    }

    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'cost-balance',
        // After the shipped `stats` row: usage facts first, money second.
        order: 10,
      }, CostBalanceLine))
    }

    /**
     * Pure helpers, exported for the node-side unit test only (see test.mjs);
     * nothing in the browser path reads this.
     */
    exports.__internals = {
      BUILD, FALLBACK, FALLBACK_TARIFF_POLICY, formatMoney, formatTokens, unitPrices, unitPricesText,
      buckets, subtractBuckets, priceDelta, accumulatedCost, beijingParts, tariffAt, isHoliday,
      resolveBaseline, spentFrom,
    }

    return module.exports
  },
})
