/**
 * Node-side test for the host half: mounts the plugin against a stub Cordis
 * context, then drives its route handler with fake node:http request/response
 * objects. Proves the route contract, the loopback fence, the method gate, the
 * balance mapping, and the failure posture without touching a running app.
 *
 * Run: node test.host.mjs
 */
import assert from 'node:assert/strict'
import { apply, inject, name, ROUTE_PATH } from './index.js'

assert.equal(name, 'dsh-cost-balance')
assert.deepEqual(inject, ['webServer'], 'webServer is the only hard dependency')

/** Minimal stand-in for a node:http ServerResponse. */
function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(text = '') { this.body = text },
  }
}

/** Minimal stand-in for a node:http IncomingMessage. */
function fakeRequest(method = 'GET', host = '127.0.0.1:19387', url = ROUTE_PATH) {
  return { method, url, headers: { host } }
}

/** Mount the plugin and capture the registered route. */
function mount({ credentials = { resolve: async () => ({ value: 'sk-test', source: 'file' }) }, selection } = {}) {
  let route = null
  const disposed = []
  const ctx = {
    get(key) {
      if (key === 'credentials') return credentials
      if (key === 'agentDefaultModel') return selection === undefined ? undefined : { currentSelection: () => selection }
      return undefined
    },
    effect(body, label) {
      assert.equal(typeof label, 'string', 'every effect carries a label')
      disposed.push(body())
    },
    webServer: { register(candidate) { route = candidate; return () => disposed.push('route-disposed') } },
  }
  apply(ctx)
  assert.equal(route.path, ROUTE_PATH)
  assert.equal(route.kind, 'exact')
  assert.equal(disposed.length, 1, 'registration is owned by an effect')
  return { route, disposed }
}

const realFetch = globalThis.fetch
/** Serve one canned balance response. */
function stubFetch(payload, { status = 200, throws = false } = {}) {
  globalThis.fetch = async () => {
    if (throws) throw new Error('network down')
    return { ok: status >= 200 && status < 300, status, json: async () => payload }
  }
}

const balancePayload = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '17.21', granted_balance: '0.00', topped_up_balance: '17.21' }],
}

// --- happy path -------------------------------------------------------------
stubFetch(balancePayload)
const { route, disposed } = mount({ selection: { provider: 'deepseek-official', model: 'deepseek-flash' } })
{
  const res = fakeResponse()
  await route.handler(fakeRequest('GET', '127.0.0.1:19387', `${ROUTE_PATH}?build=r2`), res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.deepEqual(body.model, { provider: 'deepseek-official', model: 'deepseek-flash' })
  assert.equal(body.balance.ok, true)
  assert.equal(body.balance.currency, 'CNY')
  assert.equal(body.balance.total, 17.21)
  assert.equal(body.balance.granted, 0)
  assert.equal(body.balance.toppedUp, 17.21)
  assert.equal(body.client.build, 'r2', 'the browser half identifies itself')
  assert.equal(typeof body.fetchedAt, 'number')
  assert.ok(['peak', 'offPeak'].includes(body.tariff))
  assert.equal(body.tariffPolicy.calendarYear, 2026, 'the tariff policy rides the payload')
  assert.ok(body.tariffPolicy.holidays.includes('2026-09-25'), 'mid-autumn is in the served calendar')
  assert.deepEqual(body.tariffPolicy.peakHours.ranges, [[9, 12], [14, 18]])
  assert.equal(body.prices.currency, 'CNY')
  assert.equal(body.prices.models['deepseek-flash'].cacheMiss.peak, 2)
  assert.equal(body.prices.models['deepseek-v4-pro'].output.peak, 27)
  assert.equal(JSON.stringify(body).includes('sk-test'), false, 'the API key never leaves the host half')
}

// --- fences -----------------------------------------------------------------
{
  const res = fakeResponse()
  await route.handler(fakeRequest('GET', 'evil.example.com'), res)
  assert.equal(res.status, 403, 'non-loopback Host is refused')

  const post = fakeResponse()
  await route.handler(fakeRequest('POST'), post)
  assert.equal(post.status, 405, 'non-GET is refused')

  const head = fakeResponse()
  await route.handler(fakeRequest('HEAD'), head)
  assert.equal(head.status, 200, 'HEAD is allowed')
}

// --- balance failures degrade, never throw ----------------------------------
{
  stubFetch(balancePayload, { status: 401 })
  const { route: r2 } = mount()
  const res = fakeResponse()
  await r2.handler(fakeRequest(), res)
  const body = JSON.parse(res.body)
  assert.equal(res.status, 200)
  assert.equal(body.balance.ok, false)
  assert.match(body.balance.error, /HTTP 401/)

  stubFetch(null, { throws: true })
  const { route: r3 } = mount()
  const res3 = fakeResponse()
  await r3.handler(fakeRequest(), res3)
  assert.equal(JSON.parse(res3.body).balance.error, 'network down')

  const { route: r4 } = mount({ credentials: { resolve: async () => undefined } })
  const res4 = fakeResponse()
  await r4.handler(fakeRequest(), res4)
  assert.match(JSON.parse(res4.body).balance.error, /DEEPSEEK_API_KEY is not stored/)

  const { route: r5 } = mount({ credentials: { resolve: async () => { throw new Error('store unreadable') } } })
  const res5 = fakeResponse()
  await r5.handler(fakeRequest(), res5)
  assert.match(JSON.parse(res5.body).balance.error, /store unreadable/)
}

// --- optional services may be absent ---------------------------------------
{
  stubFetch(balancePayload)
  const { route: r6, disposed: d6 } = mount({ selection: undefined })
  const res = fakeResponse()
  await r6.handler(fakeRequest(), res)
  assert.equal(JSON.parse(res.body).model, null, 'an absent model service degrades to null')
  d6.forEach((entry) => { if (typeof entry === 'function') entry() })
}

// --- disposal ---------------------------------------------------------------
{
  const { disposed: d7 } = mount()
  d7[0]()
  assert.ok(d7.includes('route-disposed'), 'the effect disposes the route registration')
}

globalThis.fetch = realFetch
console.log('ok — host half: route contract, loopback fence, method gate, balance mapping, failure posture, disposal')
