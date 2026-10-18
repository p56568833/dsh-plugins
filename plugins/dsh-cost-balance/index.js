/**
 * Host half of `dsh-cost-balance`.
 *
 * Serves one same-origin JSON route, `/cost-balance/state`, that the browser
 * half polls:
 *
 *   {
 *     ok: true,
 *     model: { provider, model },
 *     prices: <the table in ./prices.js>,
 *     balance: { ok, currency, total, granted, toppedUp, error? },
 *     fetchedAt: <epoch ms>
 *   }
 *
 * The route is deliberately NOT under `/api`: that prefix is the authenticated
 * RPC fence, while a plugin-owned named route is ordinary static-style HTTP and
 * is served to the page without any credential. It is therefore fenced by hand
 * to loopback authorities only — the same reachability rule `/api` uses — and
 * it never echoes the API key, only the balance numbers the key can read.
 *
 * @module dsh-cost-balance
 */

import { BALANCE_URL, API_KEY_REF, PRICES, BALANCE_CACHE_MS, TARIFF_POLICY, tariffAt } from './prices.js'

export const name = 'dsh-cost-balance'

/** `webServer` is the only hard dependency; the other two are probed optionally. */
export const inject = ['webServer']

/** Route pathname owned by this plugin (exact match). */
export const ROUTE_PATH = '/cost-balance/state'

/** Loopback authorities are the only Host values this route answers. */
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(?::\d+)?$/i

/**
 * Answer one JSON payload.
 * @param res - the response owning the lifecycle.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Read the executable balance for one API key.
 * @param apiKey - the resolved DeepSeek API key.
 * @returns the balance frame, or a frame carrying the failure reason.
 */
async function fetchBalance(apiKey) {
  try {
    const response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} from ${BALANCE_URL}` }
    }
    const body = await response.json()
    const info = Array.isArray(body?.balance_infos) ? body.balance_infos[0] : undefined
    if (info === undefined) return { ok: false, error: 'no balance_infos in response' }
    return {
      ok: true,
      available: body?.is_available !== false,
      currency: String(info.currency ?? 'CNY'),
      total: Number(info.total_balance ?? 0),
      granted: Number(info.granted_balance ?? 0),
      toppedUp: Number(info.topped_up_balance ?? 0),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Host plugin body: one cached balance reader plus the owned HTTP route.
 * @param ctx - host root context.
 */
export function apply(ctx) {
  /** Last good balance frame, so a polling page never blanks on one hiccup. */
  let cached = null
  let cachedAt = 0
  let inFlight = null
  /**
   * Last browser half that reached this route, as it identified itself. Makes
   * "which bundle is the live page running?" answerable from outside the page.
   */
  let lastClient = null

  const resolveBalance = async () => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return { ok: false, error: 'credentials service is not composed' }
    let apiKey
    try {
      const hit = await credentials.resolve(API_KEY_REF)
      apiKey = hit?.value
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (apiKey === undefined || apiKey === '') {
      return { ok: false, error: `credential ${API_KEY_REF} is not stored` }
    }
    return fetchBalance(apiKey)
  }

  const balance = async () => {
    const now = Date.now()
    if (cached !== null && now - cachedAt < BALANCE_CACHE_MS) return cached
    inFlight ??= resolveBalance()
      .then((frame) => {
        // A failure keeps the previous good frame rather than replacing it with
        // an error the page would otherwise show as a balance of zero.
        if (frame.ok) {
          cached = frame
          cachedAt = Date.now()
        } else if (cached === null) {
          cached = frame
          cachedAt = Date.now()
        }
        return cached
      })
      .finally(() => { inFlight = null })
    return inFlight
  }

  const modelSelection = () => {
    const selection = ctx.get('agentDefaultModel')
    try {
      const current = selection?.currentSelection()
      if (current === undefined || current === null) return null
      return { provider: String(current.provider), model: String(current.model) }
    } catch {
      return null
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      if (!LOOPBACK_HOST.test(String(req.headers.host ?? ''))) {
        sendJson(res, 403, { ok: false, error: 'loopback only' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'GET only' })
        return
      }
      // The browser half identifies itself on every poll: that makes "which
      // bundle is the live page actually running?" answerable from a terminal.
      const query = new URL(req.url ?? ROUTE_PATH, 'http://localhost').searchParams
      const build = query.get('build')
      if (build !== null && build !== '') {
        lastClient = { build, at: Date.now(), dock: (query.get('dock') ?? '').slice(0, 320) }
      }
      const frame = await balance()
      sendJson(res, 200, {
        ok: true,
        model: modelSelection(),
        tariff: tariffAt(),
        // The browser half evaluates the tariff itself from this policy (so it
        // flips exactly at the boundary, and so a holiday does not double the
        // cost when this half is running older code than prices.js).
        tariffPolicy: TARIFF_POLICY,
        prices: PRICES,
        balance: frame ?? { ok: false, error: 'unavailable' },
        client: lastClient,
        fetchedAt: Date.now(),      })
    },
  }), 'dsh-cost-balance: /cost-balance/state route')
}
