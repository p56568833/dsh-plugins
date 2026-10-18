/** DSH approval presentation. Own namespace; no host slot declarations or policy changes. */
window.__ModuleLoader__.load({
  id: 'dsh-approval-clear',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useRef, useState } = React
    const h = React.createElement
    // ══ BEGIN inlined src/core.js（由 tools/build.mjs 生成，不要手改这一段）══
    /**
     * src/core.js 的内联副本。改逻辑请改 src/core.js 再跑 tools/build.mjs，
     * 不要在这里手改——verify 会比对两边是否一致。
     */
    function loadCore() {
      /** Presentation helpers only. Approval policy and execution stay with DSH. */
      function cleanReason(reason) {
        if (typeof reason !== 'string') return ''
        return reason.trim()
          .replace(/^允许本次操作使用\s*[\w-]+\s*权限\s*[：:]\s*/, '')
          .replace(/\bdanger-full-access\b/g, '不受工作目录限制')
          .replace(/\bworkspace-write\b/g, '可修改工作目录内的文件')
          .replace(/\b(?:read-only|workspace-read)\b/g, '只读权限')
          .replace(/^\s*[,，、]+\s*/, '')
          .trim()
      }

      /** A shortened excerpt, never an invented action or safety assessment. */
      function summaryOf(reason, fallback = '是否允许执行这次操作？') {
        const text = cleanReason(reason).replace(/\s+/g, ' ')
        if (!text) return fallback
        const chars = Array.from(text)
        return chars.length <= 120 ? text : chars.slice(0, 120).join('') + '…'
      }

      function rawCommandOf(rawArgs) {
        try {
          const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
          if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
          const command = args.command ?? args.cmd
          return typeof command === 'string' && command.trim() ? command : undefined
        } catch { return undefined }
      }

      /** Return a stable string to the host's useChat selector. */
      function argsForCall(snapshot, callId) {
        if (!callId || typeof snapshot?.nodes?.values !== 'function') return undefined
        for (const node of snapshot.nodes.values()) {
          const root = node?.kind === 'tool-call' ? node.data?.root : undefined
          if (!root || typeof root !== 'object' || 'kind' in root) continue
          if (root.callId === callId && root.phase === 'start') {
            return typeof root.argsRaw === 'string' ? root.argsRaw : undefined
          }
        }
        return undefined
      }

      function resolveReasonText(props) {
        const pending = props.matched
        if (pending?.displayReason != null) {
          try {
            const text = props.resolveReason?.(pending.displayReason)
            if (typeof text === 'string' && text.trim()) return text
          } catch { /* Keep the original reason when a locale is missing. */ }
        }
        return typeof pending?.reason === 'string' ? pending.reason : ''
      }

      function selectApproval({ pendingInteraction }) {
        return pendingInteraction?.kind === 'approval' && typeof pendingInteraction.answer === 'function'
          ? pendingInteraction : null
      }

      return {
        cleanReason, summaryOf, rawCommandOf, argsForCall, resolveReasonText, selectApproval,
      }
    }
    // ══ END inlined src/core.js ══

    const core = loadCore()
    const { summaryOf, rawCommandOf, argsForCall, resolveReasonText, selectApproval } = core
    const BUILD = '0.2.0'
    const NS = 'dsh-approval-clear'
    const CSS = `
.dac-root { padding: 8px calc(var(--dsh-composer-side-clearance, 0px) + 16px) 12px; display: flex; justify-content: center; }
.dac-card { box-sizing: border-box; width: 100%; max-width: var(--dsh-chat-content-width, 748px); padding: 16px; border: 1px solid var(--dsw-alias-border-l2, #dedede); border-radius: 14px; background: var(--dsw-specific-input-major, #fff); color: var(--dsw-alias-label-primary, #222); font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.dac-title { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.dac-reason { margin: 0; font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; white-space: pre-wrap; }
.dac-scope { margin: 6px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }
.dac-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
.dac-actions { display: flex; gap: 8px; margin-left: auto; flex-shrink: 0; }
.dac-card button { font: inherit; cursor: pointer; }
.dac-button { padding: 6px 14px; border: 1px solid var(--dsw-alias-border-l2, #ddd); border-radius: 8px; background: transparent; color: inherit; }
.dac-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f5f5f5); }
.dac-button.dac-allow { border-color: transparent; background: var(--dsw-alias-button-primary-fill, #4d6bfe); color: var(--dsw-alias-label-primary-inverted, #fff); }
.dac-button.dac-allow:hover:not(:disabled) { filter: brightness(.94); }
.dac-card button:disabled { opacity: .5; cursor: default; }
.dac-card button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: 3px; }
.dac-toggle, .dac-copy { padding: 4px 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #666); font-size: 12px !important; }
.dac-toggle:hover, .dac-copy:hover { color: var(--dsw-alias-label-primary, #222); }
.dac-detail { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2, #dedede); max-height: min(40vh, 360px); overflow: auto; overflow-wrap: anywhere; }
.dac-detail p { margin: 0 0 8px; white-space: pre-wrap; }
.dac-detail-label { margin: 8px 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }
.dac-raw-bar { display: flex; align-items: center; justify-content: space-between; }
.dac-raw { margin: 4px 0 0; padding: 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #f5f5f5); color: inherit; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
.dac-error { margin: 10px 0 0; font-size: 12px; color: var(--dsw-alias-state-error-primary, #b42318); }
@media (max-width: 420px) { .dac-root { padding-left: 10px; padding-right: 10px; } .dac-card { padding: 12px; } .dac-button { padding: 6px 10px; } }
`
    const zh = {
      title: '需要你确认', fallback: '是否允许执行这次操作？',
      reject: '拒绝', allow: '允许一次', sending: '正在提交…',
      details: '查看详情', hide: '收起详情', reason: '完整说明',
      command: '原始命令', args: '操作参数', tool: '调用工具',
      copy: '复制', copied: '已复制', copyFailed: '复制失败，请手动选择',
      failed: '提交失败，请重试。', expired: '这次请求已结束。',
      scope: '本次操作不受工作目录限制', noDetails: '此请求未提供更多详情。',
    }
    const en = {
      title: 'Approval needed', fallback: 'Allow this operation?',
      reject: 'Reject', allow: 'Allow once', sending: 'Submitting…',
      details: 'View details', hide: 'Hide details', reason: 'Full explanation',
      command: 'Original command', args: 'Arguments', tool: 'Tool',
      copy: 'Copy', copied: 'Copied', copyFailed: 'Copy failed. Select the text manually.',
      failed: 'Could not submit. Try again.', expired: 'This request has ended.',
      scope: 'This operation is not restricted to the workspace', noDetails: 'No further details were provided.',
    }
    const fallbackT = (key) => zh[key] ?? key

    function ApprovalCard({ pending, reason = '', rawArgs, t = fallbackT }) {
      const [sending, setSending] = useState(false)
      const [expanded, setExpanded] = useState(false)
      const [error, setError] = useState('')
      const [copyStatus, setCopyStatus] = useState('copy')
      const waiting = useRef(false)
      const alive = useRef(true)
      const composing = useRef(false)
      const justComposed = useRef(false)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])
      const command = rawCommandOf(rawArgs)
      const raw = command ?? rawArgs
      const disabled = sending || !pending.answerable
      const answer = (outcome) => {
        if (waiting.current || !pending.answerable) return
        waiting.current = true
        setSending(true)
        setError('')
        Promise.resolve().then(() => {
          if (!alive.current || !pending.answerable) throw new Error('expired')
          return pending.answer(outcome)
        }).catch(() => {
          if (!alive.current) return
          waiting.current = false
          setSending(false)
          setError(t(pending.answerable ? 'failed' : 'expired'))
        })
      }
      // Let Enter/Space activate the focused button normally. Never turn a
      // details, copy, or reject keypress into approval. Esc only acts here.
      const onKeyDown = (event) => {
        if (event.defaultPrevented || event.repeat || event.key !== 'Escape') return
        if (composing.current || justComposed.current || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
        if (!event.currentTarget.contains(document.activeElement)) return
        if (event.target.closest?.('input, textarea, select, [contenteditable]')) return
        event.preventDefault()
        event.stopPropagation()
        answer('rejected')
      }
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(raw)
          if (alive.current) setCopyStatus('copied')
        } catch {
          if (alive.current) setCopyStatus('copyFailed')
        }
      }
      const detailId = 'dac-detail-' + pending.key
      return h('div', {
        className: 'dac-root', 'data-dac-build': BUILD, 'data-approval-key': pending.key,
        'aria-busy': sending, onKeyDown,
        onCompositionStartCapture: () => { composing.current = true },
        onCompositionEndCapture: () => { composing.current = false; justComposed.current = true },
        onKeyUpCapture: () => { justComposed.current = false },
      }, h('section', { className: 'dac-card', 'aria-label': t('title') },
        h('h2', { className: 'dac-title' }, t('title')),
        h('p', { className: 'dac-reason' }, summaryOf(reason, t('fallback'))),
        /\bdanger-full-access\b/.test(reason) && h('p', { className: 'dac-scope' }, t('scope')),
        h('div', { className: 'dac-footer' },
          h('button', { type: 'button', className: 'dac-toggle', 'aria-expanded': expanded, 'aria-controls': detailId,
            onClick: () => setExpanded((v) => !v) }, t(expanded ? 'hide' : 'details')),
          h('div', { className: 'dac-actions' },
            h('button', { type: 'button', className: 'dac-button dac-reject', disabled,
              onClick: () => answer('rejected') }, t('reject')),
            h('button', { type: 'button', className: 'dac-button dac-allow', disabled,
              onClick: () => answer('allowed-once') }, t(sending ? 'sending' : 'allow')))),
        error && h('p', { className: 'dac-error', role: 'alert' }, error),
        !pending.answerable && !sending && h('p', { className: 'dac-scope', role: 'status' }, t('expired')),
        expanded && h('div', { className: 'dac-detail', id: detailId },
          reason && h(React.Fragment, null,
            h('div', { className: 'dac-detail-label' }, t('reason')), h('p', null, reason)),
          pending.toolName && h('p', { className: 'dac-detail-label' }, t('tool') + '：' + pending.toolName),
          raw ? h(React.Fragment, null,
            h('div', { className: 'dac-raw-bar' },
              h('span', { className: 'dac-detail-label' }, t(command ? 'command' : 'args')),
              h('button', { type: 'button', className: 'dac-copy', onClick: copy }, t(copyStatus))),
            h('pre', { className: 'dac-raw' }, raw))
            : !reason && h('p', null, t('noDetails')))))
    }

    function ConnectedApprovalCard(props) {
      // Always call this hook in this component, even for approvals without a callId.
      const rawArgs = props.useChat((snapshot) => argsForCall(snapshot, props.pending.callId))
      return h(ApprovalCard, { ...props, rawArgs })
    }

    function apply(ctx) {
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = NS + '/approval.css'
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'approval-clear: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'approval-clear: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer', priority: -1, registrant: NS, locale: NS,
        select: selectApproval,
        inject: () => ({ resolveReason: (reason) => ctx.locale.resolveText(reason) }),
        // The host owns conversation.approval.detail. Never redeclare or shadow it.
      }, (props) => h(typeof props.useChat === 'function' ? ConnectedApprovalCard : ApprovalCard, {
        key: props.matched.key, pending: props.matched, reason: resolveReasonText(props),
        t: props.t ?? t, useChat: props.useChat,
      })))
    }
    return {
      inject: ['slots', 'locale'], apply,
      __internals: { BUILD, CSS, zh, en, ApprovalCard, ConnectedApprovalCard, ...core },
    }
  },
})
