#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const assets=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/whale-maid/manifest.json'),'utf8'))
for(const sheet of Object.values(assets.sheets))sheet.url='data:image/png;base64,'+fs.readFileSync(path.join(ROOT,'assets/whale-maid',sheet.file)).toString('base64')
const runtimeSource=fs.readFileSync(path.join(ROOT,'mascot/runtime.js'),'utf8')
const {resolveState,sample,hasRoom,createRuntime}=new Function(runtimeSource+';return {resolveState:maidResolveState,sample:maidSample,hasRoom:maidHasRoom,createRuntime:createMaidRuntime}')()
let failed=0,total=0
async function test(name,fn){total++;try{await fn();console.log('✓ '+name)}catch(e){failed++;console.error('✗ '+name+'\n  '+e.stack)}}

await test('18 个接口覆盖本机 Deepy；已完成 7 个，其他 11 个回退到会动的待机',()=>{
  const skin=fs.readFileSync('/Users/andychen/.dsh/profiles/desktop/node_modules/dsh-claude-style/lib/client.js','utf8')
  const start=skin.indexOf('const DEEPY_SHEETS = {')
  const block=skin.slice(start,skin.indexOf('\n    }',start))
  const keys=[...block.matchAll(/'([^']+)': \{ frames:/g)].map(m=>m[1])
  assert.deepEqual(Object.keys(assets.states).sort(),keys.sort())
  assert.equal(Object.values(assets.states).filter(s=>s.status==='ready').length,7)
  for(const key of keys){const r=resolveState(assets,key);assert(assets.clips[r.clip]);if(assets.states[key].status==='pending')assert(!r.still&&r.clip==='idle')}
  assert.deepEqual(resolveState(assets,'future-new-state'),{clip:'idle',still:false,pending:true})
})
await test('78 张载入帧；透明边界、眨眼、腿、转头、攀爬与正面打字有实质变化',async()=>{
  const require=createRequire(import.meta.url)
  let sharp;try{sharp=require('sharp')}catch{sharp=require('/Users/andychen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp')}
  const frames={}
  for(const [key,sheet] of Object.entries(assets.sheets)){
    const {data,info}=await sharp(path.join(ROOT,'assets/whale-maid',sheet.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    assert.equal(info.width,sheet.frames*128);assert.equal(info.height,128)
    frames[key]=[]
    for(let f=0;f<sheet.frames;f++){
      const tile=Buffer.alloc(128*128*4);let opaque=0
      for(let y=0;y<128;y++)for(let x=0;x<128;x++){
        const p=(y*info.width+f*128+x)*4,q=(y*128+x)*4
        data.copy(tile,q,p,p+4)
        assert(data[p+3]===0||data[p+3]===255,'Alpha 应收口为透明 / 不透明')
        if(data[p+3]){opaque++;assert(x>=7&&x<=120&&y>=7&&y<=120,'角色碰到格子边界')}
      }
      // 道具只占格子的一小部分，不能套用整个人物的面积下限。
      assert(opaque>(key==='props'?50:2000));frames[key].push(tile)
    }
  }
  const diff=(a,b,x0,y0,x1,y1)=>{let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){let p=(y*128+x)*4;if(a.subarray(p,p+4).compare(b.subarray(p,p+4)))n++}return n}
  assert(diff(frames.idle[0],frames.blink[1],30,38,82,76)>80,'眨眼区域没有实际变化')
  // 派生眨眼帧只改眼睛：眼框外与待机第 0 帧逐像素一致，眨眼时不会闪出接缝。
  for(const f of frames.blink)assert.equal(diff(frames.idle[0],f,0,0,128,128)-diff(frames.idle[0],f,34,49,70,62),0,'眨眼帧改到了眼睛以外')
  // 派生张望头接上待机身体：第 78 行以下与待机第 0 帧一致。
  for(const f of frames['look-head'])assert.equal(diff(frames.idle[0],f,0,78,128,128),0,'张望帧改到了身体')
  assert(diff(frames.idle[0],frames.idle[3],18,92,83,120)>70,'腿部没有实际变化')
  assert(diff(frames['look-head'][3],frames['look-head'][7],20,26,95,82)>200,'张望没有实际转头')
  assert(diff(frames['turn-v2'][0],frames['turn-v2'][7],0,0,128,128)>500,'转身没有改变姿势')
  assert(diff(frames['lower-a-v2'][0],frames['lower-b-v2'][5],0,0,128,128)>500,'下降没有改变姿势')
  assert(diff(frames['climb-a-v2'][0],frames['push-v2'][7],0,0,128,128)>500,'撑回没有改变姿势')
  assert.equal(Object.values(frames).reduce((n,v)=>n+v.length,0),78)
  // 表情帧同样只改脸：第 78 行以下与待机第 0 帧一致。
  for(const f of frames.face)assert.equal(diff(frames.idle[0],f,0,78,128,128),0,'表情帧改到了身体')
  const cap=assets.props?.nightcap
  assert(cap&&frames[cap.sheet]?.[cap.frame],'睡帽必须登记且有实际透明素材')
  for(const name of ['sleep','wake'])assert(assets.clips[name].props.some(p=>p.prop==='nightcap'),'睡觉和醒来都应接上睡帽')
  assert(diff(frames.idle[0],frames.face[1],32,45,74,70)>20,'思考的眼睛和嘴应有实际变化')
  assert(diff(frames.idle[0],frames.typing[8],0,0,128,128)>1000,'打字应使用完整新绘的身体')
  assert(diff(frames.typing[8],frames.typing[9],47,77,87,93)>30,'双手必须实际交替敲键')
  assert(diff(frames.typing[8],frames.typing[10],40,48,86,74)>20,'打字应有眨眼')
  for(const f of [9,10,11])assert.equal(diff(frames.typing[8],frames.typing[f],0,0,128,128)-diff(frames.typing[8],frames.typing[f],40,48,86,74)-diff(frames.typing[8],frames.typing[f],47,77,87,93),0,'打字循环不应让头发、电脑和身体闪烁')
  const laptop=assets.props[assets.restingLaptop?.prop]
  assert(laptop&&frames[laptop.sheet]?.[laptop.frame],'待机时应有放在身旁的实体电脑')
  assert(assets.clips['typing-transition'].poses[0].restingLaptop,'拿起电脑的过渡不能先让电脑消失')
})
await test('时序索引有效、所有动作落在画布内、抓握点始终留在输入框边缘',()=>{
  for(const [name,clip] of Object.entries(assets.clips)){
    let previous=-1
    for(const p of clip.poses){assert(p.at>previous&&p.at<clip.duration);previous=p.at;assert(assets.sheets[p.sheet]);assert(p.frame>=0&&p.frame<assets.sheets[p.sheet].frames)}
    for(let t=0;t<clip.duration;t+=50){const p=sample(assets,name,t);assert(p.x>=0&&p.x+p.size<=128);assert(p.y>=0&&p.y+p.size<=176);if(p.grip)assert(Math.abs(p.y+p.anchor[1]*p.size/128-assets.edgeY)<1)}
  }
  assert.equal(sample(assets,'idle',3000).sheet,'blink');assert.equal(sample(assets,'idle',3000).frame,1)
  assert.equal(sample(assets,'idle',3050,true).frame,0)
  assert(hasRoom({left:0,right:104,top:0,width:104,height:104},{width:500,height:500}))
  assert(!hasRoom({left:0,right:104,top:450,width:104,height:104},{width:500,height:500}))
})

function harness({badImage=false,loading=false,forceSpace=true}={}){
  const events=new Map(),observers=new Set(),timers=new Map(),calls=[]
  let time=100000,id=0
  function on(target,type,fn){const k=target+':'+type;if(!events.has(k))events.set(k,new Set());events.get(k).add(fn)}
  function off(target,type,fn){events.get(target+':'+type)?.delete(fn)}
  function fire(target,type,event={}){for(const fn of events.get(target+':'+type)||[])fn({type,...event})}
  class Node{
    constructor(tag){this.tagName=tag;this.children=[];this.attrs=new Map();this.dataset={};this.className='';this.rect={left:400,right:504,top:400,bottom:504,width:104,height:104};this.classList={contains:k=>this.className.split(' ').includes(k)};const css=new Map();this.style={setProperty:(k,v)=>css.set(k,v),removeProperty:k=>css.delete(k)}}
    setAttribute(k,v){this.attrs.set(k,String(v))}getAttribute(k){return this.attrs.get(k)??null}hasAttribute(k){return this.attrs.has(k)}removeAttribute(k){this.attrs.delete(k)}
    appendChild(n){n.remove();n.parentElement=this;n.parentNode=this;this.children.push(n);return n}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;this.parentNode=null}
    get isConnected(){let n=this;while(n.parentElement)n=n.parentElement;return n===doc.base}
    contains(n){while(n){if(n===this)return true;n=n.parentElement}return false}
    getBoundingClientRect(){return this.rect}
    closest(selector){let n=this;while(n){if(selector==='[data-composer-card]'&&n.hasAttribute('data-composer-card'))return n;n=n.parentElement}return null}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    querySelectorAll(selector){const all=[];function walk(n){for(const c of n.children){all.push(c);walk(c)}}walk(this);if(selector==='button, select, [role="button"]')return all.filter(n=>n.tagName==='button');return all.filter(n=>n.classList.contains(selector.slice(1)))}
    getContext(){return {setTransform(){},transform(){},translate(){},scale(){},rotate(){},clearRect(){},fillRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},ellipse(){},fill(){},moveTo(){},lineTo(){},closePath(){},drawImage(...args){calls.push(args)}}}
  }
  const doc={hidden:false,createElement:tag=>new Node(tag),addEventListener:(t,f)=>on('doc',t,f),removeEventListener:(t,f)=>off('doc',t,f)}
  doc.base=new Node('html');doc.body=doc.base.appendChild(new Node('body'));doc.head=doc.base.appendChild(new Node('head'))
  doc.querySelectorAll=selector=>doc.base.querySelectorAll(selector)
  doc.body.setAttribute('data-dsh-claude-style','skin');doc.body.setAttribute('data-dsh-claude-brand','deepseek');doc.body.setAttribute('data-dsh-claude-motion','full')
  const parent=doc.body.appendChild(new Node('div')),root=parent.appendChild(new Node('span'))
  root.className='dsh-claude-deepy';root.setAttribute('data-animation','idle');root.setAttribute('data-ready','')
  const original=root.appendChild(new Node('span'));original.className='dsh-claude-deepy-sprite'
  const hit=root.appendChild(new Node('span'));hit.className='dsh-claude-deepy-hit'
  const win={innerWidth:1200,innerHeight:900,devicePixelRatio:2,addEventListener:(t,f)=>on('win',t,f),removeEventListener:(t,f)=>off('win',t,f)}
  class Observer{constructor(fn){this.fn=fn}observe(){observers.add(this)}disconnect(){observers.delete(this)}}
  class Image{set src(v){const b=Buffer.from(v.split(',')[1],'base64');this.naturalWidth=b.readUInt32BE(16);this.naturalHeight=b.readUInt32BE(20);if(!loading)queueMicrotask(()=>badImage?this.onerror?.():this.onload?.())}}
  const env={document:doc,window:win,MutationObserver:Observer,Image,forceSpace,now:()=>time,setTimeout(fn,ms){const n=++id;timers.set(n,{fn,at:time+ms});return n},clearTimeout(n){timers.delete(n)}}
  async function flush(){for(const o of observers)o.fn();await new Promise(r=>setImmediate(r))}
  function advance(ms){const end=time+ms;let limit=10000;while(limit--){const entries=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at);if(!entries.length)break;const [n,v]=entries[0];time=v.at;timers.delete(n);v.fn()}assert(limit>0);time=end}
  return {env,doc,win,root,original,hit,parent,calls,timers,observers,events,flush,advance,fire,Node}
}

await test('加载后覆盖；切回时保留原始节点、动画键并移除所有资源',async()=>{
  const h=harness(),r=createRuntime(assets,h.env);assert(!h.root.hasAttribute('data-dsh-csa-maid'));assert(await r.ready)
  assert.equal(r.count(),1);assert(h.root.hasAttribute('data-dsh-csa-maid'));assert(h.original.isConnected&&h.hit.isConnected)
  assert(h.calls.length>0);r.dispose();r.dispose()
  assert.equal(h.root.children.length,2);assert.equal(h.root.getAttribute('data-animation'),'idle');assert(!h.root.hasAttribute('data-dsh-csa-maid'))
  assert.equal(h.timers.size,0);assert.equal(h.observers.size,0);assert.equal(h.doc.head.children.length,0)
  assert.equal([...h.events.values()].reduce((n,s)=>n+s.size,0),0)
})
await test('原版状态驱动；悬挂播完才回待机；工作到来立即中断并安静承接',async()=>{
  const h=harness(),r=createRuntime(assets,h.env);await r.ready;h.advance(9000)
  h.root.setAttribute('data-animation','idle-spout');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'hang')
  h.advance(3300);h.root.setAttribute('data-animation','idle');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'hang')
  h.advance(2600);assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'idle')
  h.root.setAttribute('data-animation','idle-spout');await h.flush();h.advance(1000)
  h.root.setAttribute('data-animation','thinking');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'think')
  const calls=h.calls.length;h.advance(6000);assert(h.calls.length>calls,'思考应循环播放，不能冻住');r.dispose()
})
await test('打字与思考 / 待机通过打开收起电脑衔接；中途反向与最新目标不会丢失',async()=>{
  const h=harness(),r=createRuntime(assets,h.env);await r.ready
  const clip=()=>h.root.getAttribute('data-dsh-csa-maid-clip')
  const change=async key=>{h.root.setAttribute('data-animation',key);await h.flush()}
  await change('thinking');assert.equal(clip(),'think')
  await change('typing');assert.equal(clip(),'typing-transition');assert.equal(h.root.getAttribute('data-dsh-csa-maid-transition'),'enter')
  h.advance(220);await change('thinking');assert.equal(h.root.getAttribute('data-dsh-csa-maid-transition'),'exit')
  h.advance(80);await change('typing');assert.equal(h.root.getAttribute('data-dsh-csa-maid-transition'),'enter')
  h.advance(900);assert.equal(clip(),'typing')
  await change('thinking');assert.equal(clip(),'typing-transition')
  h.advance(200);await change('idle');h.advance(800);assert.equal(clip(),'idle','收起期间应记住最新目的状态')
  await change('typing');h.advance(1000);await change('thinking');h.advance(1000);assert.equal(clip(),'think')
  r.dispose()
})
await test('急迫状态可立即中断打字过渡；减弱动画跳过过渡并停在合理姿势',async()=>{
  const h=harness(),r=createRuntime(assets,h.env);await r.ready
  h.root.setAttribute('data-animation','typing');await h.flush();h.advance(200)
  h.root.setAttribute('data-animation','notification');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-state'),'notification');assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'idle');assert(!h.root.hasAttribute('data-dsh-csa-maid-transition'))
  h.root.setAttribute('data-animation','typing');await h.flush();h.advance(100)
  h.doc.body.setAttribute('data-dsh-claude-motion','reduced');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'typing');assert(!h.root.hasAttribute('data-dsh-csa-maid-transition'))
  const n=h.calls.length;h.advance(1500);assert.equal(h.calls.length,n)
  h.root.setAttribute('data-animation','thinking');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'think')
  r.dispose()
})
await test('输入即时收回；减弱动画与隐藏窗口停止播放；恢复后不重复挂载',async()=>{
  const h=harness(),r=createRuntime(assets,h.env);await r.ready;h.advance(9000)
  h.root.setAttribute('data-animation','idle-spout');await h.flush();h.advance(1600)
  h.fire('doc','input');assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'idle')
  h.root.setAttribute('data-animation','idle');await h.flush()
  h.doc.body.setAttribute('data-dsh-claude-motion','reduced');await h.flush();const n=h.calls.length;h.advance(10000);assert.equal(h.calls.length,n)
  h.doc.body.setAttribute('data-dsh-claude-motion','full');await h.flush()
  h.doc.hidden=true;h.fire('doc','visibilitychange');assert.equal(h.timers.size,0)
  h.doc.hidden=false;h.fire('doc','visibilitychange');await h.flush();assert.equal(r.count(),1);r.dispose()
})
await test('空间不够改张望；品牌切换 / 页面卸载 / 重挂载均可恢复原版',async()=>{
  const h=harness({forceSpace:false}),r=createRuntime(assets,h.env);await r.ready;h.advance(9000)
  h.win.innerHeight=520;h.root.setAttribute('data-animation','idle-spout');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'look')
  h.doc.body.setAttribute('data-dsh-claude-brand','claude');await h.flush();assert.equal(r.count(),0);assert.equal(h.root.children.length,2)
  h.doc.body.setAttribute('data-dsh-claude-brand','deepseek');await h.flush();assert.equal(r.count(),1)
  h.root.remove();await h.flush();assert.equal(r.count(),0);h.parent.appendChild(h.root);await h.flush();assert.equal(r.count(),1);r.dispose()
})
await test('睡觉 / 醒来：按键不打断；醒来播完回待机；闲置动作仍会给输入让路',async()=>{
  const h=harness(),r=createRuntime(assets,h.env);await r.ready;h.advance(9000)
  h.root.setAttribute('data-animation','sleeping');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'sleep')
  h.advance(4000);assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'sleep','睡觉应循环')
  h.fire('doc','keydown',{});h.root.setAttribute('data-animation','waking');await h.flush()
  assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'wake','刚按过键也要播醒来')
  h.advance(200);h.root.setAttribute('data-animation','idle');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'wake','醒来播完才回待机')
  h.advance(1400);assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'idle')
  h.fire('doc','keydown',{});h.root.setAttribute('data-animation','idle-look');await h.flush();assert.equal(h.root.getAttribute('data-dsh-csa-maid-clip'),'idle','刚输入时不插闲置张望')
  r.dispose()
})
await test('素材失败与加载中切回，都不隐藏 / 删除原版',async()=>{
  const h=harness({badImage:true}),r=createRuntime(assets,h.env);assert.equal(await r.ready,false);assert.equal(h.root.children.length,2);assert(!h.root.hasAttribute('data-dsh-csa-maid'));r.dispose()
  const slow=harness({loading:true}),s=createRuntime(assets,slow.env);s.dispose();assert.equal(await s.ready,false);assert.equal(slow.timers.size,0);assert.equal(slow.root.children.length,2)
})
await test('重复更新不重复挂载；热更新旧实例卸载不破坏新实例',async()=>{
  const h=harness(),a=createRuntime(assets,h.env);await a.ready;for(let i=0;i<10;i++)await h.flush();assert.equal(h.root.children.length,3)
  const b=createRuntime(assets,h.env);await b.ready;const owner=h.root.getAttribute('data-dsh-csa-maid');a.dispose();assert.equal(h.root.getAttribute('data-dsh-csa-maid'),owner);assert.equal(h.root.children.length,3);b.dispose();assert.equal(h.root.children.length,2)
})
console.log(`\n${total-failed}/${total} 通过`)
if(failed)process.exitCode=1
