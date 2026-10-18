/** Regression against the installed DSH registry/locale, not permissive mocks. */
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {loadClient, source, asarReader} from './test/helpers.mjs'
const read=asarReader(process.env.DSH_APP_ASAR??'/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
const prefix='dsh/node_modules/@deepseek-ai/'
const {SlotCore}=await import('data:text/javascript;base64,'+Buffer.from(read(prefix+'dsh-client-ui-slots/lib/index.js')).toString('base64'))
const {LocaleRuntime}=loadClient(read(prefix+'dsh-client-locale/lib/client.js'))
const native=loadClient(read(prefix+'dsh-client-ui-approval/lib/client.js'))
const React={createElement:(type,props,...children)=>({type,props,children})}
const plugin=loadClient(source,React)
for(const sequence of [[plugin,native],[native,plugin]]) {
  const slots=new SlotCore(), disposers=[], remoteEvents=[]
  slots.register({name:'root',children:{'conversation.composer':{kind:'chain',scope:'session'}}},()=>null)
  const ctx={
    effect(fn){const d=fn();if(typeof d==='function')disposers.push(d)},
    inject(){},
    uiSession:{registerPendingInteraction:()=>()=>()=>{}},
    remote:{$on:(name)=>remoteEvents.push(name)},
    slots:{inject:(name,fn)=>{const d=fn();disposers.push(d)},register:(opts,fn)=>slots.register(opts,fn)},
    emit(){},
  }
  ctx.locale=new LocaleRuntime(ctx,undefined,{languages:['zh']})
  const lifetimes=new Map()
  for(const p of sequence) {const start=disposers.length;p.apply(ctx);lifetimes.set(p,disposers.slice(start))}
  assert.equal(ctx.locale.bind('approval')('waiting'),'等待审批')
  assert.equal(ctx.locale.bind('dsh-approval-clear')('title'),'需要你确认')
  assert.ok(remoteEvents.includes('approval/request'))
  const entries=slots.entriesOfSlot('conversation.composer')
  assert.equal(entries.length,2)
  assert.equal(entries[0].registrant,'dsh-approval-clear')
  assert.equal(entries[0].children,undefined)
  const inject=entries[0].inject()
  const pending={key:'first',reason:'fallback',displayReason:{zh:'安装插件',en:'Install plugin'}}
  const first=entries[0].component({matched:pending,...inject})
  const second=entries[0].component({matched:{...pending,key:'second'},...inject})
  assert.equal(first.props.reason,'安装插件')
  assert.notEqual(first.props.key,second.props.key)
  assert.equal(first.children.length,0)
  assert.deepEqual(Object.keys(plugin.__internals.zh).sort(),Object.keys(plugin.__internals.en).sort())
  lifetimes.get(plugin).reverse().forEach(fn=>fn?.())
  const remaining=slots.entriesOfSlot('conversation.composer')
  assert.equal(remaining.length,1)
  assert.equal(remaining[0].locale,'approval')
  assert.equal(ctx.locale.bind('approval')('waiting'),'等待审批')
  lifetimes.get(native).reverse().forEach(fn=>fn?.())
  assert.equal(slots.entriesOfSlot('conversation.composer').length,0)
  console.log('✓ Real host registration, locale, localization, remount, disposal:',sequence[0]===plugin?'plugin first':'host first')
}
// Reproduce both old failure mechanisms to keep the test sensitive to them.
const slots=new SlotCore()
slots.register({name:'root',children:{'conversation.composer':{kind:'chain',scope:'session'}}},()=>null)
slots.register({name:'conversation.composer',select:()=>null,children:{'conversation.approval.detail':{kind:'single',scope:'session'}}},()=>null)
assert.throws(()=>slots.register({name:'conversation.composer',select:()=>null,children:{'conversation.approval.detail':{kind:'single',scope:'session'}}},()=>null),/already declared/)
const locale=new LocaleRuntime({emit(){}},undefined,{languages:['zh']})
locale.register('approval',{zh:{waiting:'old'}})
assert.throws(()=>locale.register('approval',{zh:{waiting:'new'}}),/already has locale/)
console.log('✓ Old slot and locale collisions reproduced with real host code')
const build=spawnSync(process.execPath,[fileURLToPath(new URL('./tools/build.mjs',import.meta.url)),'--check'],{stdio:'inherit'})
process.exitCode=build.status??1
