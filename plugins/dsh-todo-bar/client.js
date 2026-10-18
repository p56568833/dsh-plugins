/**
 * Browser half of `dsh-todo-bar`.
 *
 * Replaces DSH's native todo dock (the "任务 · N 已完成" card that sits on top
 * of the composer) with a slim, segmented progress strip pinned to the TOP of
 * the conversation column. Click the strip to open the full list as a popover;
 * hover only highlights it.
 *
 * How it plugs in (no upstream code is modified):
 *
 *   - Registers ONE entry in `conversation.input.dock` — the same session-scoped
 *     list slot the native `TodoDock` uses (ui-conversation, id "todo"). Entries
 *     in that slot receive the standard `useProjection` hook, so we read the very
 *     same `todos` projection (latest `todo/write` snapshot; null before the first
 *     write, cleared when the next turn starts, kept after `turn/end`).
 *   - In the dock itself we render only a hidden anchor. From it we find our
 *     conversation's chat body (`[data-conversation-region="chat"]`, which is
 *     `position: relative` and carries `--dsh-chat-content-width`) and portal the
 *     strip into a layer appended there — so it follows the column width and does
 *     not scroll with the transcript.
 *   - While our entry is mounted the chat body carries `data-dtb-alive`, and a
 *     stylesheet rule hides the native `[data-testid="todo-panel"]` underneath it.
 *     If this plugin is disabled or its entry crashes, the attribute goes away and
 *     the native card comes back by itself.
 *
 * Coexists with dsh-story-progress: its card is pushed below the strip instead
 * of overlapping it.
 *
 * Hand-written bundle in the loader's closure-factory format (same as
 * dsh-story-progress / dsh-cost-balance).
 *
 * @module dsh-todo-bar/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-todo-bar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { useEffect, useLayoutEffect, useRef, useState } = React
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }
    const h = React.createElement

    /** Bump on every change (shown as data-dtb-build on the strip, for diagnostics). */
    const BUILD = 'r1'
    /** An all-done list stays up this long (paused while hovered / open), then fades. */
    const DONE_LINGER_MS = 6000
    const FADE_MS = 320
    /** Remembers which finished lists were already shown, so a reload does not replay them. */
    const SEEN_KEY = 'dsh-todo-bar/seen.v1'
    const SEEN_CAP = 80

    // ══ pure helpers ═════════════════════════════════════════════════════

    const STATUSES = ['completed', 'in_progress', 'pending']

    /** Small stable string hash (djb2). */
    function hash(text) {
      let x = 5381
      for (let i = 0; i < text.length; i++) x = ((x << 5) + x + text.charCodeAt(i)) | 0
      return (x >>> 0).toString(36)
    }

    /**
     * Everything the UI shows, derived from one `todos` projection value. Pure.
     * @param todos - projection value: TodoItem[] | null | undefined.
     */
    function summarize(todos) {
      const list = Array.isArray(todos)
        ? todos.filter((t) => t && typeof t.content === 'string' && STATUSES.includes(t.status))
        : []
      const total = list.length
      const done = list.filter((t) => t.status === 'completed').length
      const active = list.filter((t) => t.status === 'in_progress')
      const pending = total - done - active.length
      const nextPending = list.find((t) => t.status === 'pending') || null
      const current = active[0] || nextPending
      const allDone = total > 0 && done === total
      const sig = hash(list.map((t) => `${t.status[0]}${t.content}`).join('\n'))
      return { list, total, done, activeCount: active.length, pending, current, currentIsActive: active.length > 0, allDone, sig }
    }

    /** Header line of the popover: "已完成 3 · 进行中 1 · 待办 1" (zero counts omitted). */
    function countsLabel(s) {
      return [
        s.done > 0 ? `已完成 ${s.done}` : null,
        s.activeCount > 0 ? `进行中 ${s.activeCount}` : null,
        s.pending > 0 ? `待办 ${s.pending}` : null,
      ].filter(Boolean).join(' · ')
    }

    function readSeen() {
      try {
        const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')
        return Array.isArray(v) ? v : []
      } catch { return [] }
    }
    function hasSeen(key) { return readSeen().includes(key) }
    function markSeen(key) {
      try {
        const next = readSeen().filter((k) => k !== key)
        next.push(key)
        localStorage.setItem(SEEN_KEY, JSON.stringify(next.slice(-SEEN_CAP)))
      } catch { /* ignore */ }
    }

    // ══ styles ═══════════════════════════════════════════════════════════

    const CSS = `
/* Native todo dock: hidden only while this plugin's entry is alive in that conversation. */
[data-dtb-alive] [data-testid="todo-panel"] { display: none !important; }

/* Room for the strip above the first message when scrolled to the very top. */
[data-dtb-visible] > [data-conversation-scroll] { padding-top: 62px; }

/* dsh-story-progress card sits under the header's right corner: stack it below the strip. */
body:has([data-dtb-visible]) .dsp-card { margin-top: 54px; }

.dtb-layer {
  position: absolute; top: 0; left: 0; right: 0; height: 0;
  z-index: 8; display: flex; align-items: flex-start; justify-content: center; pointer-events: none;
}
.dtb-root {
  --dtb-tone: var(--dsw-alias-state-business-primary, #4d6bfe);
  --dtb-surface: var(--dsw-alias-bg-layer-2, #fff);
  position: relative; pointer-events: auto;
  margin-top: 10px;
  width: min(var(--dsh-chat-content-width, 760px), calc(100% - 32px));
  font-family: var(--dsw-font-family, system-ui);
  transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
  animation: dtb-in .22s ease-out;
}
.dtb-root[data-tone="success"] { --dtb-tone: var(--dsw-alias-state-success-primary, #22c55e); }
.dtb-root[data-leaving="true"] { opacity: 0; transform: translateY(-6px); }

.dtb-bar {
  all: unset; box-sizing: border-box; display: block; width: 100%;
  cursor: pointer; padding: 7px 12px 8px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--dtb-surface) 86%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.4); backdrop-filter: blur(14px) saturate(1.4);
  border: .5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  box-shadow: var(--dsw-shadow-lv1, 0 2px 4px rgba(0,0,0,.05)), 0 6px 18px rgba(0,0,0,.04);
  transition: border-color .15s ease, background-color .15s ease;
}
.dtb-bar:hover { border-color: var(--dsw-alias-border-l4, rgba(0,0,0,.16)); background: color-mix(in srgb, var(--dtb-surface) 96%, transparent); }
.dtb-bar:focus-visible { outline: 2px solid color-mix(in srgb, var(--dtb-tone) 55%, transparent); outline-offset: 2px; }
.dtb-root[data-open="true"] .dtb-bar { border-color: color-mix(in srgb, var(--dtb-tone) 45%, transparent); }

.dtb-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; line-height: 18px; }
.dtb-count {
  flex: none; display: inline-flex; align-items: center; gap: 4px;
  font-weight: 600; font-variant-numeric: tabular-nums; color: var(--dtb-tone);
}
.dtb-count svg { width: 14px; height: 14px; }
.dtb-sep { flex: none; color: var(--dsw-alias-label-caption, #adb2b8); }
.dtb-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #0f1115); }
.dtb-dim { color: var(--dsw-alias-label-tertiary, #81858c); }
.dtb-more {
  flex: none; font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 999px;
  color: var(--dtb-tone); background: color-mix(in srgb, var(--dtb-tone) 12%, transparent);
}
.dtb-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary, #81858c); transition: transform .2s ease; }
.dtb-chevron svg { width: 14px; height: 14px; }
.dtb-root[data-open="true"] .dtb-chevron { transform: rotate(180deg); }

.dtb-segs { display: flex; gap: 3px; height: 4px; margin-top: 6px; }
.dtb-seg {
  position: relative; overflow: hidden; flex: 1 1 0; min-width: 2px; border-radius: 2px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 8%, transparent);
  transition: background-color .3s ease;
}
.dtb-seg[data-status="completed"] { background: var(--dtb-tone); }
.dtb-seg[data-status="in_progress"] { background: color-mix(in srgb, var(--dtb-tone) 26%, transparent); }
.dtb-seg[data-status="in_progress"]::after {
  content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 45%;
  border-radius: 2px; background: var(--dtb-tone);
  animation: dtb-run 1.5s ease-in-out infinite;
}

.dtb-pop {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0;
  max-height: min(52vh, 440px); overflow: auto; overscroll-behavior: contain;
  padding: 10px 6px 6px; box-sizing: border-box;
  border-radius: 12px;
  background: var(--dtb-surface);
  border: .5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1));
  box-shadow: var(--dsw-shadow-lv3, 0 0 1px rgba(0,0,0,.2), 0 12px 32px rgba(0,0,0,.08));
  animation: dtb-pop .16s ease-out; transform-origin: top center;
}
.dtb-pop-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 0 10px 8px; }
.dtb-pop-title { font-size: 12px; line-height: 18px; font-weight: 600; color: var(--dsw-alias-label-secondary, #61666b); }
.dtb-pop-sum { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, #81858c); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dtb-list { list-style: none; margin: 0; padding: 0; }
.dtb-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 6px 10px; border-radius: 8px;
  font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #61666b);
}
.dtb-item[data-status="completed"] { color: var(--dsw-alias-label-tertiary, #81858c); }
.dtb-item[data-status="in_progress"] {
  color: var(--dsw-alias-label-primary, #0f1115); font-weight: 500;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 8%, transparent);
}
.dtb-item-text { min-width: 0; overflow-wrap: anywhere; }
.dtb-glyph { flex: none; width: 16px; height: 20px; display: inline-flex; align-items: center; justify-content: center; }
.dtb-glyph svg { width: 16px; height: 16px; display: block; }
.dtb-g-done { color: var(--dsw-alias-state-success-primary, #22c55e); }
.dtb-g-now { color: var(--dsw-alias-state-business-primary, #4d6bfe); }
.dtb-g-now .dtb-spin { transform-origin: 8px 8px; animation: dtb-spin 1s linear infinite; }
.dtb-g-todo { color: var(--dsw-alias-label-caption, #adb2b8); }

@keyframes dtb-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes dtb-pop { from { opacity: 0; transform: translateY(-4px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes dtb-run { 0% { transform: translateX(-100%); } 100% { transform: translateX(230%); } }
@keyframes dtb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dtb-root, .dtb-pop { animation: none; transition: none; }
  .dtb-seg[data-status="in_progress"]::after, .dtb-g-now .dtb-spin { animation: none; }
}
`
    const STYLE_KEY = 'dsh-todo-bar/client.css'
    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${STYLE_KEY}"]`)) return
      const tag = document.createElement('style')
      tag.textContent = CSS
      tag.dataset.pluginCss = STYLE_KEY
      document.head.appendChild(tag)
    }

    // ══ icons ════════════════════════════════════════════════════════════

    const svg = (props, ...kids) => h('svg', { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, ...props }, ...kids)
    const Icon = {
      check: () => svg(null, h('path', { d: 'M3.5 8.5l3 3 6-7', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      chevron: () => svg(null, h('path', { d: 'M4 6l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      done: () => svg({ className: 'dtb-g-done' },
        h('circle', { cx: 8, cy: 8, r: 7, fill: 'currentColor' }),
        h('path', { d: 'M5 8.2l2 2 4-4.4', stroke: '#fff', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' })),
      now: () => svg({ className: 'dtb-g-now' },
        h('circle', { cx: 8, cy: 8, r: 6.25, stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 1.5 }),
        h('path', { className: 'dtb-spin', d: 'M8 1.75a6.25 6.25 0 0 1 6.25 6.25', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('circle', { cx: 8, cy: 8, r: 2.25, fill: 'currentColor' })),
      todo: () => svg({ className: 'dtb-g-todo' },
        h('circle', { cx: 8, cy: 8, r: 6.25, stroke: 'currentColor', strokeWidth: 1.5 })),
    }
    const GLYPH = { completed: Icon.done, in_progress: Icon.now, pending: Icon.todo }
    const STATUS_LABEL = { completed: '已完成', in_progress: '进行中', pending: '待办' }

    // ══ view ═════════════════════════════════════════════════════════════

    /** The strip + (optional) popover. Pure render from props. */
    function Strip({ s, open, leaving, onToggle, onHover }) {
      const tone = s.allDone ? 'success' : 'brand'
      let text
      if (s.allDone) text = h('span', { className: 'dtb-text' }, '全部完成')
      else if (s.current && s.currentIsActive) text = h('span', { className: 'dtb-text', title: s.current.content }, s.current.content)
      else if (s.current) text = h('span', { className: 'dtb-text', title: s.current.content }, h('span', { className: 'dtb-dim' }, '下一项：'), s.current.content)
      else text = h('span', { className: 'dtb-text' }, '任务清单')

      const label = s.allDone
        ? `任务全部完成，共 ${s.total} 项。点击查看清单`
        : `任务进度 ${s.done}/${s.total}${s.current ? `，${s.currentIsActive ? '正在' : '下一项'}：${s.current.content}` : ''}。点击查看清单`

      const bar = h('button', {
        type: 'button',
        className: 'dtb-bar',
        'aria-expanded': open ? 'true' : 'false',
        'aria-haspopup': 'dialog',
        'aria-label': label,
        onClick: onToggle,
        onMouseEnter: () => onHover(true),
        onMouseLeave: () => onHover(false),
      },
      h('div', { className: 'dtb-row' },
        h('span', { className: 'dtb-count' }, s.allDone ? h(Icon.check) : null, `${s.done}/${s.total}`),
        h('span', { className: 'dtb-sep', 'aria-hidden': true }, '·'),
        text,
        s.activeCount > 1 ? h('span', { className: 'dtb-more' }, `+${s.activeCount - 1} 项同时进行`) : null,
        h('span', { className: 'dtb-chevron', 'aria-hidden': true }, h(Icon.chevron))),
      h('div', { className: 'dtb-segs', 'aria-hidden': true },
        s.list.map((t, i) => h('span', { key: i, className: 'dtb-seg', 'data-status': t.status }))))

      const pop = open
        ? h('div', { className: 'dtb-pop', role: 'dialog', 'aria-label': '任务清单' },
          h('div', { className: 'dtb-pop-head' },
            h('span', { className: 'dtb-pop-title' }, '任务清单'),
            h('span', { className: 'dtb-pop-sum' }, countsLabel(s))),
          h('ol', { className: 'dtb-list' },
            s.list.map((t, i) => h('li', { key: `${i}:${t.content}`, className: 'dtb-item', 'data-status': t.status },
              h('span', { className: 'dtb-glyph', role: 'img', 'aria-label': STATUS_LABEL[t.status] }, h(GLYPH[t.status])),
              h('span', { className: 'dtb-item-text' }, t.content)))))
        : null

      return h('div', {
        className: 'dtb-root',
        'data-tone': tone,
        'data-open': open ? 'true' : 'false',
        'data-leaving': leaving ? 'true' : 'false',
        'data-dtb-build': BUILD,
      }, bar, pop)
    }

    // ══ slot entry ═══════════════════════════════════════════════════════

    const CHAT_BODY = '[data-conversation-region="chat"]'

    function TodoBar(props) {
      const useProjection = props && props.useProjection
      const todos = typeof useProjection === 'function' ? useProjection('todos') : null
      const s = summarize(todos)

      const anchorRef = useRef(null)
      const [host, setHost] = useState(null)
      const [open, setOpen] = useState(false)
      const [hover, setHover] = useState(false)
      const [leaving, setLeaving] = useState(false)
      const [goneKey, setGoneKey] = useState(null)

      // Find our conversation's chat body and hang a layer in it.
      useLayoutEffect(() => {
        ensureStyle()
        const anchor = anchorRef.current
        const body = anchor && anchor.closest ? anchor.closest(CHAT_BODY) : null
        if (!body) return undefined
        const layer = document.createElement('div')
        layer.className = 'dtb-layer'
        body.appendChild(layer)
        body.setAttribute('data-dtb-alive', '')
        setHost({ body, layer, sid: body.getAttribute('data-conversation-session') || '' })
        return () => {
          body.removeAttribute('data-dtb-alive')
          body.removeAttribute('data-dtb-visible')
          layer.remove()
          setHost(null)
        }
      }, [])

      const key = `${host ? host.sid : ''}:${s.sig}`
      const seen = s.allDone && (goneKey === key || hasSeen(key))
      const visible = Boolean(host && s.total > 0 && !seen)

      useEffect(() => {
        if (!host) return
        if (visible) host.body.setAttribute('data-dtb-visible', '')
        else host.body.removeAttribute('data-dtb-visible')
      }, [host, visible])

      // A new list (or the list going away) closes the popover.
      useEffect(() => { if (!visible) setOpen(false) }, [visible])

      // Finished list: linger, then fade out and remember it.
      useEffect(() => {
        if (!visible || !s.allDone || open || hover) { setLeaving(false); return undefined }
        let t2 = null
        const t1 = setTimeout(() => {
          setLeaving(true)
          t2 = setTimeout(() => { markSeen(key); setGoneKey(key); setLeaving(false) }, FADE_MS)
        }, DONE_LINGER_MS)
        return () => { clearTimeout(t1); if (t2) clearTimeout(t2) }
      }, [visible, s.allDone, key, open, hover])

      // Popover: closes on outside press and on Escape.
      useEffect(() => {
        if (!open || !host) return undefined
        const onDown = (e) => { if (!host.layer.contains(e.target)) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open, host])

      const anchor = h('span', { ref: anchorRef, hidden: true, 'data-dtb-anchor': '' })
      if (!visible) return anchor

      const strip = h(Strip, { s, open, leaving, onToggle: () => setOpen((v) => !v), onHover: setHover })
      if (ReactDOM && typeof ReactDOM.createPortal === 'function') {
        return h(React.Fragment, null, anchor, ReactDOM.createPortal(strip, host.layer))
      }
      // No portal available: degrade to the dock position rather than show nothing.
      return h(React.Fragment, null, anchor, strip)
    }

    exports.inject = ['slots']
    exports.apply = function apply(ctx) {
      ensureStyle()
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'dsh-todo-bar',
        order: 1,
        registrant: 'dsh-todo-bar',
      }, TodoBar))
    }

    /** Pure helpers + view for the node-side test and the preview page. */
    exports.__internals = { BUILD, summarize, countsLabel, hash, Strip, CSS, TodoBar }

    return module.exports
  },
})
