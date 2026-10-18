import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanReason, summaryOf, rawCommandOf, argsForCall, resolveReasonText, selectApproval } from '../src/core.js'

test('display strips only the known permission prefix; details remain separate', () => {
  const reason = '允许本次操作使用 danger-full-access 权限：删除旧目录。没有备份，无法恢复。'
  assert.equal(cleanReason(reason), '删除旧目录。没有备份，无法恢复。')
  assert.equal(summaryOf(reason), '删除旧目录。没有备份，无法恢复。')
  assert.equal(summaryOf(null), '是否允许执行这次操作？')
  assert.equal(cleanReason('需要 workspace-write 权限'), '需要 可修改工作目录内的文件 权限')
})
test('long excerpts retain their source wording and explicitly show truncation', () => {
  const reason = '请确认' + '很长的说明。'.repeat(30)
  const summary = summaryOf(reason)
  assert.equal(Array.from(summary).length, 121)
  assert.ok(summary.endsWith('…'))
  assert.ok(reason.startsWith(summary.slice(0, -1)))
})
test('command extraction preserves every operator, quote, newline, and space', () => {
  const command = '  false || echo "a;b";\ncat <<\'EOF\'\na && b\nEOF\n'
  assert.equal(rawCommandOf(JSON.stringify({command})), command)
  assert.equal(rawCommandOf({cmd: command}), command)
  for (const input of ['', 'null', '{broken', '[]', '{}']) assert.equal(rawCommandOf(input), undefined)
})
test('call lookup ignores result/aggregate/malformed/unrelated nodes', () => {
  const nodes = new Map([
    [1, {kind:'tool-call', data:{root:null}}],
    [2, {kind:'tool-call', data:{root:{callId:'a', phase:'finish', argsRaw:'wrong'}}}],
    [3, {kind:'tool-call', data:{root:{callId:'b', phase:'start', argsRaw:'wrong'}}}],
    [4, {kind:'tool-call', data:{root:{callId:'a', phase:'start', argsRaw:'{"command":"ls"}'}}}],
  ])
  assert.equal(argsForCall({nodes}, 'a'), '{"command":"ls"}')
  assert.equal(argsForCall({nodes}, undefined), undefined)
  assert.equal(argsForCall(null, 'a'), undefined)
})
test('localized host reason is resolved; unavailable translations fall back safely', () => {
  assert.equal(resolveReasonText({matched:{displayReason:{zh:'中文',en:'English'}},resolveReason:r=>r.zh}), '中文')
  assert.equal(resolveReasonText({matched:{displayReason:{},reason:'原文'},resolveReason:()=>{throw Error()}}), '原文')
  assert.equal(resolveReasonText({matched:{displayReason:{}}}), '')
})
test('only approvals are selected; plan review and questions retain host behavior', () => {
  for (const kind of ['question','plan-review']) assert.equal(selectApproval({pendingInteraction:{kind,answer(){}}}), null)
  assert.equal(selectApproval({pendingInteraction:{kind:'approval'}}), null)
  assert.equal(selectApproval({}), null)
  const pending = {kind:'approval',answer(){}}
  assert.equal(selectApproval({pendingInteraction:pending}), pending)
})
