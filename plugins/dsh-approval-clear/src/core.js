/** Presentation helpers only. Approval policy and execution stay with DSH. */
export function cleanReason(reason) {
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
export function summaryOf(reason, fallback = '是否允许执行这次操作？') {
  const text = cleanReason(reason).replace(/\s+/g, ' ')
  if (!text) return fallback
  const chars = Array.from(text)
  return chars.length <= 120 ? text : chars.slice(0, 120).join('') + '…'
}

export function rawCommandOf(rawArgs) {
  try {
    const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
    if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
    const command = args.command ?? args.cmd
    return typeof command === 'string' && command.trim() ? command : undefined
  } catch { return undefined }
}

/** Return a stable string to the host's useChat selector. */
export function argsForCall(snapshot, callId) {
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

export function resolveReasonText(props) {
  const pending = props.matched
  if (pending?.displayReason != null) {
    try {
      const text = props.resolveReason?.(pending.displayReason)
      if (typeof text === 'string' && text.trim()) return text
    } catch { /* Keep the original reason when a locale is missing. */ }
  }
  return typeof pending?.reason === 'string' ? pending.reason : ''
}

export function selectApproval({ pendingInteraction }) {
  return pendingInteraction?.kind === 'approval' && typeof pendingInteraction.answer === 'function'
    ? pendingInteraction : null
}
