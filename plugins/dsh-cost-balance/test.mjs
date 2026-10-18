/**
 * Node-side unit test for the browser half's pure helpers.
 *
 * The bundle is a plain closure factory, so it can be loaded outside a browser:
 * stub `window.__ModuleLoader__`, stub the two platform modules the factory
 * requires, then drive the exported `__internals` directly.
 *
 * Run: node test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let handoff = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) { handoff = { id, factory } },
  },
}

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}
const requireStub = (spec) => {
  if (spec === 'react') return reactStub
  throw new Error(`unexpected require(${spec})`)
}

// eslint-disable-next-line no-eval
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
new Function('require', 'document', source)(requireStub, undefined)
assert.equal(handoff.id, 'dsh-cost-balance', 'bundle registers under its package id')

const plugin = handoff.factory(requireStub)
assert.deepEqual(plugin.inject, ['slots'], 'plugin declares the slots service')
assert.equal(typeof plugin.apply, 'function', 'plugin exports apply')
const api = plugin.__internals

// --- registration shape -----------------------------------------------------
let registered = null
plugin.apply({
  slots: {
    inject: (slot, callback) => callback(),
    register: (options, component) => { registered = { options, component } },
  },
})
assert.equal(registered.options.name, 'conversation.composer.dock')
assert.equal(registered.options.id, 'cost-balance')
assert.equal(registered.options.order, 10)
assert.equal(typeof registered.component, 'function', 'registers a component')

// --- price lookup -----------------------------------------------------------
const prices = api.FALLBACK
assert.deepEqual(api.unitPrices(prices, 'deepseek-flash', 'peak'), { hit: 0.04, miss: 2, output: 8 })
assert.deepEqual(api.unitPrices(prices, 'deepseek-flash', 'offPeak'), { hit: 0.02, miss: 1, output: 4 })
// Unknown model falls back to the table's fallback row.
assert.deepEqual(api.unitPrices(prices, 'nope', 'peak'), { hit: 0.04, miss: 2, output: 8 })
assert.equal(api.unitPrices({ models: {} }, 'nope', 'peak'), null)

// --- one fold, peak ---------------------------------------------------------
const memory = { sessionId: 's1', tariff: 'peak', cost: 0, baseline: api.buckets(undefined) }
const usage = { uncachedInputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 50_000 }
const peak = api.accumulatedCost(memory, usage, prices, 'peak', 'deepseek-flash')
// 0.1M * 2 + 1M * 0.04 + 0.05M * 8 = 0.2 + 0.04 + 0.4
assert.equal(Number(peak.cost.toFixed(6)), 0.64, 'peak fold')
assert.equal(api.formatMoney(peak.cost), '0.64')

// --- growth is charged at the tariff in effect ------------------------------
// A tariff flip must NOT retroactively re-price what was already charged: the
// first 0.64 stays, only the growth is priced at the off-peak column.
const flipped = api.accumulatedCost(memory, usage, prices, 'offPeak', 'deepseek-flash')
assert.equal(Number(flipped.cost.toFixed(6)), 0.64, 'no retroactive re-pricing on flip')
const grown = api.accumulatedCost(memory, {
  ...usage,
  uncachedInputTokens: usage.uncachedInputTokens + 100_000,
  outputTokens: usage.outputTokens + 50_000,
}, prices, 'offPeak', 'deepseek-flash')
// growth: 0.1M * 1 + 0.05M * 4 = 0.1 + 0.2
assert.equal(Number(grown.cost.toFixed(6)), 0.94, 'growth priced at the new tariff')

// --- off-peak is half of peak ----------------------------------------------
const offMemory = { sessionId: 's2', tariff: 'offPeak', cost: 0, baseline: api.buckets(undefined) }
const off = api.accumulatedCost(offMemory, usage, prices, 'offPeak', 'deepseek-flash')
assert.equal(Number(off.cost.toFixed(6)), 0.32, 'off-peak fold is half the peak fold')

// --- compaction shrinkage floors at zero ------------------------------------
const shrunk = api.subtractBuckets(api.buckets({ uncachedInputTokens: 10 }), api.buckets({ uncachedInputTokens: 999 }))
assert.deepEqual(shrunk, { miss: 0, hit: 0, write: 0, output: 0 }, 'shrinkage never prices negatively')

// --- tariff: a statutory holiday bills off-peak ALL DAY ---------------------
// Regression for the 2026-09-25 bug: that Friday was 中秋节, a statutory
// holiday, so the whole day is off-peak. A "peak unless weekend" rule doubled
// every number the user saw.
assert.equal(api.tariffAt(new Date('2026-09-25T07:00:00Z'), undefined), 'offPeak', 'mid-autumn 15:00 Beijing is off-peak')
assert.equal(api.tariffAt(new Date('2026-09-25T02:00:00Z'), undefined), 'offPeak', 'mid-autumn 10:00 Beijing is off-peak')
assert.equal(api.isHoliday(new Date('2026-09-25T07:00:00Z'), undefined), true, 'mid-autumn is a holiday')
assert.equal(api.tariffAt(new Date('2026-09-21T07:00:00Z'), undefined), 'peak', 'ordinary Monday 15:00 is peak')
assert.equal(api.tariffAt(new Date('2026-09-21T05:00:00Z'), undefined), 'offPeak', 'ordinary Monday 13:00 is off-peak')
assert.equal(api.tariffAt(new Date('2026-09-20T07:00:00Z'), undefined), 'offPeak', 'makeup-workday Sunday is off-peak')
assert.equal(api.tariffAt(new Date('2026-10-05T07:00:00Z'), undefined), 'offPeak', 'national day is off-peak')
assert.equal(api.tariffAt(new Date('2026-12-25T07:00:00Z'), undefined), 'peak', 'ordinary Friday 15:00 is peak')
// A policy served by the host wins over the built-in copy.
const servedPolicy = { peakHours: { weekdays: [1, 2, 3, 4, 5], ranges: [[9, 12], [14, 18]] }, holidays: ['2026-12-25'] }
assert.equal(api.tariffAt(new Date('2026-12-25T07:00:00Z'), servedPolicy), 'offPeak', 'served policy wins')

// --- wallet delta: the official money number --------------------------------
const seeded = api.resolveBaseline({}, 's1', { ok: true, total: 15.5, currency: 'CNY' }, 2.7)
assert.equal(seeded.seeded, true, 'a conversation with no baseline is seeded')
assert.equal(seeded.entry.balance, 18.2, 'seeded from current balance + estimate so far')
assert.equal(seeded.entry.currency, 'CNY')
const reused = api.resolveBaseline({ s1: seeded.entry }, 's1', { ok: true, total: 15.0, currency: 'CNY' }, 9)
assert.equal(reused.seeded, false, 'an existing baseline is reused, not re-seeded')
assert.equal(reused.entry.balance, 18.2, 'a later estimate cannot move the baseline')
assert.equal(api.spentFrom(seeded.entry, { ok: true, total: 15.5, currency: 'CNY' }), 2.7, 'spent is the wallet delta')
assert.equal(api.spentFrom(seeded.entry, { ok: true, total: 19, currency: 'CNY' }), 0, 'a topped-up wallet never reports negative spend')
assert.equal(api.spentFrom(seeded.entry, { ok: true, total: 15.5, currency: 'USD' }), null, 'currency mismatch yields no delta')
assert.equal(api.spentFrom(seeded.entry, { ok: false, error: 'x' }), null, 'a failed reading yields no delta')
assert.equal(api.spentFrom(undefined, { ok: true, total: 1, currency: 'CNY' }), null, 'no baseline yields no delta')
assert.equal(api.resolveBaseline({ s1: seeded.entry }, 's1', { ok: true, total: 15, currency: 'USD' }, 1).seeded, true, 'a currency change re-seeds')

// --- formatting -------------------------------------------------------------
assert.equal(api.formatMoney(0.00004), '0.0000')
assert.equal(api.formatMoney(1.234), '1.23')
assert.equal(api.formatMoney(Number.NaN), '—')
assert.equal(api.formatTokens(999), '999')
assert.equal(api.formatTokens(12_345), '12.3K')
assert.equal(api.formatTokens(1_234_567), '1.2M')
assert.equal(api.unitPricesText(0.04), '¥0.04/M')
assert.equal(api.unitPricesText(8), '¥8/M')

console.log('ok — client half: registration, price lookup, tariff accumulation, compaction floor, formatting')
