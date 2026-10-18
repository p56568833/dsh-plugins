/**
 * Whale-maid renderer. Source of truth: this file + assets/whale-maid/manifest.json.
 * build-maid.mjs embeds both in client.js, so Electron needs no extra asset route.
 * The original Deepy remains the state machine. We only observe its public DOM
 * animation key; switching off removes our nodes/CSS and reveals it intact.
 */
function maidResolveState(assets, key) {
  const state = assets.states[key]
  if (state?.status === 'ready' && assets.clips[state.clip]) return { clip: state.clip, still: false, pending: false }
  // A state without its own clip yet keeps the LIVING idle (breathing, blinking,
  // swinging legs). Freezing her made the most common states — thinking,
  // typing, sleeping — look like the mascot had hung.
  return { clip: assets.clips[state?.fallback] ? state.fallback : 'idle', still: false, pending: true }
}

function maidSample(assets, clipName, elapsed, still = false) {
  const clip = assets.clips[clipName] || assets.clips.idle
  const time = still ? (clip.stillAt || 0) : clip.loop ? Math.max(0, elapsed) % clip.duration : Math.min(Math.max(0, elapsed), clip.duration - 1)
  let index = 0
  for (let i=1;i<clip.poses.length;i++) { if (clip.poses[i].at > time) break; index=i }
  const pose=clip.poses[index]
  // Raised arms make a taller silhouette. Match the head's apparent size
  // across sheets instead of shrinking the whole character to fit that height.
  const position=p=>{
    const size=assets.displaySize*(assets.sheets[p.sheet].renderScale||1)
    return {...p,size,x:p.targetX-p.anchor[0]*size/assets.frameSize,y:assets.edgeY-p.anchor[1]*size/assets.frameSize}
  }
  const fade=still?0:Math.min(clip.blendMs||0,clip.duration-pose.at)
  const blend=index>0&&fade>0?Math.min(1,(time-pose.at)/fade):1
  return { ...position(pose), time,
    ...(blend<1?{blend,previous:position(clip.poses[index-1])}:{}) }
}

function maidHasRoom(rect, viewport, bottom = 62) {
  return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= viewport.width
    && rect.top + 97 + bottom <= viewport.height - 10
}

function createMaidRuntime(assets, env = {}) {
  const doc = env.document || (typeof document !== 'undefined' ? document : null)
  const win = env.window || (typeof window !== 'undefined' ? window : null)
  const Observer = env.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null)
  const ResizeObserverClass = env.ResizeObserver || win?.ResizeObserver
  const ImageClass = env.Image || win?.Image
  const now = env.now || (() => Date.now())
  const later = env.setTimeout || ((fn, ms) => setTimeout(fn, ms))
  const cancel = env.clearTimeout || ((id) => clearTimeout(id))
  const requestFrame = env.requestAnimationFrame || (win?.requestAnimationFrame
    ? fn=>win.requestAnimationFrame(fn) : fn=>later(fn,1000/60))
  const cancelFrame = env.cancelAnimationFrame || (win?.cancelAnimationFrame
    ? id=>win.cancelAnimationFrame(id) : cancel)
  const inert = { dispose() {}, refresh() {}, preview() {}, ready: Promise.resolve(false), count: () => 0 }
  if (!doc?.body || !win || !Observer || !ImageClass) return inert

  const OWNER = 'maid-' + Math.random().toString(36).slice(2)
  const ROOT_SELECTOR = '.dsh-claude-deepy'
  const ROOT_ATTR = 'data-dsh-csa-maid'
  const STYLE_ID = 'dsh-claude-style-addons/whale-maid.css'
  const records = new Map()
  const images = {}
  const pendingImages = new Set()
  let alive = true, loaded = false, timer = null, queued = false, style = null
  let lastInput = now(), lastGeometry = 0
  const CSS = `
body[data-dsh-claude-style][data-dsh-claude-brand="deepseek"] .dsh-claude-deepy[${ROOT_ATTR}] > .dsh-claude-deepy-sprite { visibility: hidden !important; }
/* The conversation card is z-index:2. Legs must sit in front of its face,
   just as they do when the home-page mascot is a child of the card. */
body[data-dsh-claude-style] .dsh-claude-deepy[${ROOT_ATTR}] { overflow: visible; z-index:3; }
body[data-dsh-claude-style] .dsh-claude-deepy[${ROOT_ATTR}] > .dsh-csa-maid-canvas { position:absolute; left:0; top:var(--dsh-csa-maid-edge-offset,0px); width:128px; height:176px; pointer-events:none !important; image-rendering:pixelated; }
body[data-dsh-claude-style] .dsh-claude-deepy[${ROOT_ATTR}] > .dsh-claude-deepy-hit { left:30px; top:calc(43px + var(--dsh-csa-maid-edge-offset,0px)); width:52px; height:50px; }
`

  function enabled() {
    return doc.body.hasAttribute('data-dsh-claude-style') && doc.body.getAttribute('data-dsh-claude-brand') === 'deepseek'
  }
  function reduced() { return doc.body.getAttribute('data-dsh-claude-motion') === 'reduced' }
  function ensureStyle() {
    if (style?.isConnected) return
    style = doc.createElement('style')
    style.dataset.plugin = 'dsh-claude-style-addons'
    style.dataset.pluginCss = STYLE_ID
    style.dataset.maidOwner = OWNER
    style.textContent = CSS
    doc.head.appendChild(style)
  }
  function remove(record) {
    record.resizeObserver?.disconnect()
    record.canvas.remove()
    if (record.root.getAttribute(ROOT_ATTR) === OWNER) {
      record.root.removeAttribute(ROOT_ATTR)
      record.root.removeAttribute('data-dsh-csa-maid-state')
      record.root.removeAttribute('data-dsh-csa-maid-clip')
      record.root.removeAttribute('data-dsh-csa-maid-transition')
      record.root.style.removeProperty('--dsh-csa-maid-edge-offset')
    }
    records.delete(record.root)
  }
  function align(record) {
    // Home uses the card itself as anchor; conversations use an outer stack.
    // Measure the real rim so attachments and growing text cannot move the seat.
    const card = record.root.closest('[data-composer-card]')
      || record.root.parentElement?.querySelector('[data-composer-card]')
    if (record.card !== card) {
      record.resizeObserver?.disconnect()
      record.card = card
      if (card) record.resizeObserver?.observe(card)
      if (record.root.parentElement) record.resizeObserver?.observe(record.root.parentElement)
    }
    const r = record.root.getBoundingClientRect(), c = card?.getBoundingClientRect()
    const offset = c?.width && c?.height ? Math.round(c.top - r.top - assets.edgeY) : 0
    if (record.offset !== offset) {
      record.offset = offset
      record.root.style.setProperty('--dsh-csa-maid-edge-offset', offset + 'px')
    }
  }
  function spaceFor(record) {
    if (env.forceSpace === true) return true
    const r = record.root.getBoundingClientRect()
    const top = r.top + (record.offset || 0)
    if (!maidHasRoom({ ...r, width:r.width, height:r.height, left:r.left, right:r.right, top }, { width: win.innerWidth, height: win.innerHeight }, assets.clips.hang.needsSpaceBelow)) return false
    // The small hanging body sits left of the send control. Do not enter any
    // actionable control's rectangle below the rim, even in a narrow composer.
    const region = { left:r.left+8, right:r.left+78, top:top+99, bottom:top+157 }
    const parent = record.root.parentElement
    const controls = parent?.querySelectorAll('button, select, [role="button"]') || []
    for (const control of controls) {
      if (record.root.contains(control)) continue
      const b=control.getBoundingClientRect()
      if (b.width && b.height && b.left<region.right && b.right>region.left && b.top<region.bottom && b.bottom>region.top) return false
    }
    return true
  }
  function begin(record, clip, t, still = false) {
    record.clip = clip
    record.start = t
    record.still = still
    record.paintKey = ''
    record.root.setAttribute('data-dsh-csa-maid-clip', clip)
  }
  function stopTravel(record) {
    record.travel=null
    record.root.removeAttribute('data-dsh-csa-maid-transition')
  }
  function advanceTravel(record,t) {
    const travel=record.travel
    if(!travel)return
    const duration=assets.clips[travel.clip].duration
    travel.position=Math.max(0,Math.min(duration,travel.position+(t-travel.at)*travel.direction))
    travel.at=t
    if((travel.direction>0&&travel.position>=duration)||(travel.direction<0&&travel.position<=0)) {
      const destination=travel.destination
      stopTravel(record);begin(record,destination,t)
    }
  }
  function route(record,next,t,key,initial=false) {
    const bridge=assets.transitions?.typing
    // Reactions and urgent host states retain their original priority.
    const urgent=['notification','error','drag','poke-left','poke-right','tickle','compacting','music','building','conducting'].includes(key)
    if(initial||reduced()||urgent||!bridge) {
      stopTravel(record);begin(record,next,t);return
    }
    if(record.travel) {
      record.travel.direction=next==='typing'?1:-1
      record.travel.destination=next
      record.root.setAttribute('data-dsh-csa-maid-transition',record.travel.direction>0?'enter':'exit')
      record.paintKey=''
      return
    }
    const entering=next==='typing'&&['idle','think'].includes(record.clip)
    const leaving=record.clip==='typing'&&next!=='typing'
    if(entering||leaving) {
      const duration=assets.clips[bridge].duration
      record.travel={clip:bridge,position:entering?0:duration-0.001,direction:entering?1:-1,at:t,destination:next}
      begin(record,bridge,t)
      record.root.setAttribute('data-dsh-csa-maid-transition',entering?'enter':'exit')
      return
    }
    if(next!==record.clip)begin(record,next,t)
  }
  function select(record, t) {
    advanceTravel(record,t)
    const key = record.root.getAttribute('data-animation') || 'idle'
    if (key !== record.host) {
      const initial=record.host===null
      record.host = key
      record.root.setAttribute('data-dsh-csa-maid-state', key)
      // Let a longer idle extra finish after the original 3.2s sheet returns
      // to idle. Real work or user interaction always interrupts immediately.
      const finishingExtra = !record.travel && key === 'idle' && record.clip !== 'idle'
        && !assets.clips[record.clip].loop && t < record.start + assets.clips[record.clip].duration
      if (!finishingExtra) {
        const chosen = maidResolveState(assets, key)
        let next = chosen.clip
        // Only idle extras (look / hang) give way to a reader who just typed or
        // clicked. Work states and waking must play right away.
        if (assets.clips[next]?.extra && t - lastInput < 8000) next = 'idle'
        if (next === 'hang' && !spaceFor(record)) next = 'look'
        route(record,next,t,key,initial)
      }
    }
    if(record.travel&&reduced()) {
      const destination=record.travel.destination
      stopTravel(record);begin(record,destination,t)
    }
    if (!record.travel && record.clip !== 'idle' && !assets.clips[record.clip].loop && t >= record.start + assets.clips[record.clip].duration) begin(record, 'idle', t)
    // Reduced motion: extras are skipped; every other state shows its still pose.
    if (reduced() && assets.clips[record.clip]?.extra) begin(record, 'idle', t)
  }
  // Seated body + replaceable head ("face" layer). Head sheets (blink, face,
  // look-head) are derived from idle frame 0 by tools/build-maid.mjs --derive,
  // so everything outside the changed face/head is pixel-identical to the body.
  function drawIdle(ctx, pose, t, frozen, unit, motion) {
    const fs=assets.frameSize, img=images.idle
    const headImg=pose.part==='head'?images[pose.sheet]:img, headFrame=pose.part==='head'?pose.frame:0
    const phase=frozen?0:t/1000
    // Breathing lifts the head by exactly one device pixel; a fractional stretch
    // made nearest-neighbour sampling re-pick rows every frame (shimmer).
    const breathPeriod=motion.breath===undefined?3.2:motion.breath
    const lift=frozen||!breathPeriod?0:((1-Math.cos(phase*Math.PI*2/breathPeriod))/2>=0.5?1:0)
    // pose.head: whole device pixels, [right, down] — a doze nod, a startle.
    const headX=(pose.head?.[0]||0)*unit, headY=((pose.head?.[1]||0)-lift)*unit
    const NECK=64, BODY=78
    const legs=[[38,102,15,21,45,102],[54,102,14,21,60,102]]
    ctx.save();ctx.translate(pose.x,pose.y);ctx.scale(pose.size/fs,pose.size/fs)
    ctx.save();ctx.beginPath();ctx.rect(0,0,fs,fs)
    for(const [x,y,w,h] of legs)ctx.rect(x,y,w,h)
    ctx.clip('evenodd')
    // Head moves rigidly; only the short neck/collar band absorbs the offset.
    ctx.drawImage(headImg,headFrame*fs,0,fs,NECK,headX,headY,fs,NECK)
    ctx.drawImage(headImg,headFrame*fs,NECK,fs,BODY-NECK,headX,NECK+headY,fs,BODY-NECK-headY)
    ctx.drawImage(img,0,BODY,fs,fs-BODY,0,BODY,fs,fs-BODY)
    ctx.restore()
    // Rotate lower legs around the knees; palms and hips never translate.
    const legAmp=motion.legs===undefined?1:motion.legs, legPeriod=motion.legPeriod||2.1
    for(let i=0;i<legs.length;i++) {
      const [x,y,w,h,px,py]=legs[i]
      const angle=frozen?0:Math.sin(phase*Math.PI*2/legPeriod)*(.13+i*.025)*(i?-0.85:1)*legAmp
      ctx.save();ctx.translate(px,py);ctx.rotate(angle);ctx.translate(-px,-py)
      ctx.drawImage(img,x,y,w,h,x,y,w,h);ctx.restore()
    }
    ctx.restore()
    return {headX,headY}
  }
  // Prop layer: small things around her (Z, "!", bubbles, hats). A prop is
  // either a code-drawn glyph (manifest "glyphs") or a drawn sprite from the
  // "props" sheet (manifest "props"). Missing art is skipped, so a clip may
  // reference a prop before its picture exists.
  const glyphCache=new Map()
  function glyphCells(glyph) {
    if(glyphCache.has(glyph))return glyphCache.get(glyph)
    const rows=glyph.rows, pad=glyph.outline?1:0, list=[]
    const filled=(c,r)=>r>=0&&r<rows.length&&c>=0&&c<rows[r].length&&!!glyph.colors[rows[r][c]]
    const w=rows[0].length+pad*2, h=rows.length+pad*2
    for(let r=-pad;r<rows.length+pad;r++)for(let c=-pad;c<rows[0].length+pad;c++){
      if(filled(c,r)){list.push([c+pad,r+pad,glyph.colors[rows[r][c]]]);continue}
      if(!pad)continue
      let near=false;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)if(filled(c+dc,r+dr))near=true
      if(near)list.push([c+pad,r+pad,glyph.outline])
    }
    const out={w,h,list};glyphCache.set(glyph,out);return out
  }
  function propActive(item, clip, time) {
    const life=item.until-item.at
    let local=time-item.at
    if(clip.loop&&local<0)local+=clip.duration
    return local>=0&&local<life?local/life:-1
  }
  function drawProps(ctx, clip, pose, time, frozen, head, ratio) {
    const fs=assets.frameSize, k=pose.size/fs
    for(const item of clip.props||[]) {
      const f=propActive(item,clip,time)
      if(f<0)continue
      const glyph=assets.glyphs?.[item.prop], sprite=assets.props?.[item.prop]
      if(!glyph&&!(sprite&&images[sprite.sheet]))continue
      // Movement in whole steps so the pixels never land between device pixels.
      const steps=item.steps||8, q=frozen?0:Math.min(steps,Math.floor(f*steps))/steps
      const from=item.from, to=item.to||item.from
      let ax=from[0]+(to[0]-from[0])*q, ay=from[1]+(to[1]-from[1])*q
      let x=pose.x+ax*k, y=pose.y+ay*k
      if(item.follow==='head'){x+=head.headX*k;y+=head.headY*k}
      ctx.save()
      if(item.fadeFrom!==undefined&&f>=item.fadeFrom)ctx.globalAlpha=0.5
      if(glyph) {
        // One glyph cell = one CSS pixel (whole device pixels), with an
        // optional 1-cell outline so it reads on light and dark composers.
        const cells=glyphCells(glyph), cell=glyph.cell||1
        x=Math.round((x-cells.w*cell/2)*ratio)/ratio;y=Math.round((y-cells.h*cell)*ratio)/ratio
        for(const [c,r,color] of cells.list){ctx.fillStyle='#'+color;ctx.fillRect(x+c*cell,y+r*cell,cell,cell)}
      } else {
        // Drawn props share the character's pixel size; anchor = attach point.
        const [px,py]=sprite.anchor||[64,64]
        x=Math.round((x-px*k)*ratio)/ratio;y=Math.round((y-py*k)*ratio)/ratio
        ctx.drawImage(images[sprite.sheet],sprite.frame*fs,0,fs,fs,x,y,fs*k,fs*k)
      }
      ctx.restore()
    }
  }
  function drawRestingLaptop(ctx,ratio) {
    if(!assets.restingLaptop)return
    const base=maidSample(assets,'idle',0,true)
    base.x=Math.round(base.x*ratio)/ratio;base.y=Math.round(base.y*ratio)/ratio
    drawProps(ctx,{duration:1,loop:true,props:[{...assets.restingLaptop,at:0,until:1,steps:1}]},base,0,true,{headX:0,headY:0},ratio)
  }
  function paint(record, t) {
    const frozen = record.still || reduced()
    const clip = assets.clips[record.clip] || assets.clips.idle
    const sampled = maidSample(assets, record.clip, record.travel?.position??(t-record.start), frozen)
    // Snap the sprite origin to the device-pixel grid so every pose samples
    // its pixel art the same way instead of drifting by sub-pixel offsets.
    // pose.body: whole-device-pixel offset of the entire figure (a hop).
    const ratio=record.ratio
    const pose={...sampled,
      x:Math.round(sampled.x*ratio)/ratio+(sampled.body?.[0]||0)/ratio,
      y:Math.round(sampled.y*ratio)/ratio+(sampled.body?.[1]||0)/ratio}
    const motionTime=frozen?0:t-record.start
    const livePose=!frozen&&(pose.sheet==='idle'||pose.part==='head'||clip.props?.length||clip.blendMs)
    const phase=livePose?Math.floor((record.travel?.position??motionTime)/(1000/60)):0
    const signature = [record.clip,pose.sheet,pose.frame,pose.x,pose.y,phase,ratio].join(':')
    if (record.paintKey === signature) return
    record.paintKey = signature
    const ctx=record.ctx, fs=assets.frameSize, size=pose.size
    ctx.setTransform(ratio,0,0,ratio,0,0)
    ctx.clearRect(0,0,128,176)
    ctx.imageSmoothingEnabled=false
    // Mask only rear hair/tail below the actual rim. Feet, apron and hands stay
    // in the foreground; the input's own surface shows through the rear mask.
    ctx.save()
    ctx.beginPath();ctx.rect(0,0,128,176)
    for(const [x,y,w,h] of pose.rear || []) {
      const left=pose.x+x*size/fs, top=Math.max(assets.edgeY+1,pose.y+y*size/fs)
      const bottom=pose.y+(y+h)*size/fs
      if(bottom>top)ctx.rect(left,top,w*size/fs,bottom-top)
    }
    ctx.clip('evenodd')
    // A soft, shallow contact shadow gives the narrow rim some depth without
    // adding a platform to the artwork or changing the real input box.
    ctx.fillStyle='rgba(20,30,64,0.13)'
    ctx.beginPath()
    ctx.ellipse(pose.targetX+1,assets.edgeY+2,18,2.2,0,0,Math.PI*2)
    ctx.fill()
    ctx.fillStyle='rgba(20,30,64,0.18)'
    const contacts=pose.contacts || (pose.grip ? [[pose.anchor[0]-28,pose.anchor[1]],[pose.anchor[0]+25,pose.anchor[1]]] : [pose.anchor])
    // Only marks for points that actually touch the rim (raised hands do not).
    for(const [x,y] of contacts)if(Math.abs(pose.y+y*size/fs-assets.edgeY)<1.5)ctx.fillRect(Math.round(pose.x+x*size/fs)-3,assets.edgeY,6,1)
    const draw=(target,p,freeze)=>{
      let offsets={headX:0,headY:0}
      if(p.sheet==='idle'||p.part==='head')offsets=drawIdle(target,p,motionTime,freeze,fs/(p.size*ratio),clip.motion||{})
      else target.drawImage(images[p.sheet],p.frame*fs,0,fs,fs,p.x,p.y,p.size,p.size)
      if(p.restingLaptop)drawRestingLaptop(target,ratio)
      return offsets
    }
    let head
    if(sampled.previous) {
      // Brief pose changes blend aligned drawings. Accumulate onto
      // a transparent layer so overlapping pixels stay opaque (no dark dip).
      if(!record.blendCanvas)record.blendCanvas=doc.createElement('canvas')
      const layer=record.blendCanvas
      if(layer.width!==record.canvas.width||layer.height!==record.canvas.height){layer.width=record.canvas.width;layer.height=record.canvas.height}
      const mix=layer.getContext('2d')
      mix.setTransform(ratio,0,0,ratio,0,0);mix.clearRect(0,0,128,176);mix.imageSmoothingEnabled=false
      const previous={...sampled.previous,x:Math.round(sampled.previous.x*ratio)/ratio,y:Math.round(sampled.previous.y*ratio)/ratio}
      mix.save();mix.globalAlpha=1-sampled.blend;draw(mix,previous,true)
      mix.globalCompositeOperation='lighter';mix.globalAlpha=sampled.blend;head=draw(mix,pose,true);mix.restore()
      ctx.drawImage(layer,0,0,layer.width,layer.height,0,0,128,176)
    } else head=draw(ctx,pose,frozen)
    ctx.restore()
    if(clip.props?.length)drawProps(ctx,clip,pose,sampled.time,frozen,head,ratio)
    // A closed computer has a persistent home on the ledge. The drawn pickup
    // sequence takes over ownership; it returns to this same spot on exit.
    if(!record.clip.startsWith('typing'))drawRestingLaptop(ctx,ratio)
  }
  function tick() {
    timer=null
    if(!alive || !loaded || doc.hidden || !enabled())return
    const t=now()
    if(t-lastGeometry>250){lastGeometry=t;for(const record of records.values())align(record)}
    let animate=false
    for(const record of records.values()) {
      if(!record.root.isConnected){remove(record);continue}
      select(record,t)
      paint(record,t)
      if(!record.still && !reduced())animate=true
    }
    if(animate && records.size)timer=requestFrame(tick)
  }
  function wake() {
    if(doc.hidden||!enabled()) {if(timer!==null)cancelFrame(timer);timer=null;return}
    // Streaming chat mutations must not repeatedly cancel and restart the clock.
    if(timer===null){tick();return}
    const t=now()
    for(const record of records.values()) {
      if(record.host!==(record.root.getAttribute('data-animation')||'idle')||record.paintKey===''||reduced()) {
        select(record,t);paint(record,t)
      }
    }
    if(reduced()||Array.from(records.values()).every(r=>r.still)){cancelFrame(timer);timer=null}
  }
  function scan() {
    queued=false
    if(!alive || !loaded)return
    if(!enabled()) {
      for(const record of Array.from(records.values()))remove(record)
      if(timer!==null)cancelFrame(timer);timer=null
      style?.remove();style=null
      return
    }
    ensureStyle()
    const roots=Array.from(doc.querySelectorAll(ROOT_SELECTOR))
    for(const record of Array.from(records.values()))if(!roots.includes(record.root)||!record.root.isConnected)remove(record)
    for(const root of roots) {
      if(records.has(root)){align(records.get(root));continue}
      // A newer HMR generation owns its own canvas. Taking over is reversible;
      // an old instance's cleanup may only remove its own owner attribute.
      for(const child of Array.from(root.children))if(child.classList.contains('dsh-csa-maid-canvas'))child.remove()
      const canvas=doc.createElement('canvas')
      canvas.className='dsh-csa-maid-canvas'
      canvas.setAttribute('aria-hidden','true')
      const ratio=Math.min(3,Math.max(1,win.devicePixelRatio||1))
      canvas.width=128*ratio;canvas.height=176*ratio
      const ctx=canvas.getContext('2d')
      if(!ctx)continue
      const record={root,canvas,ctx,ratio,host:null,clip:'idle',start:now(),still:false,paintKey:'',offset:null,card:null}
      if(ResizeObserverClass)record.resizeObserver=new ResizeObserverClass(()=>{if(alive){align(record);geometry()}})
      records.set(root,record)
      root.appendChild(canvas)
      align(record)
      select(record,now());paint(record,now())
      // Hide original only after assets have loaded AND the first frame painted.
      root.setAttribute(ROOT_ATTR,OWNER)
    }
    wake()
  }
  function schedule() {
    if(queued||!alive)return
    queued=true
    Promise.resolve().then(scan)
  }
  const observer=new Observer(schedule)
  observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-animation','data-ready','data-dsh-claude-style','data-dsh-claude-brand','data-dsh-claude-motion']})
  function activity(event) {
    if(event.type==='keydown' && (event.metaKey||event.ctrlKey||event.altKey))return
    lastInput=now()
    for(const record of records.values())if(assets.clips[record.clip]?.extra)begin(record,'idle',now())
    wake()
  }
  function geometry() {
    if(now()-lastGeometry<80)return
    lastGeometry=now()
    for(const record of records.values()) {
      align(record)
      if(record.clip==='hang'&&!spaceFor(record))begin(record,'idle',now())
      const ratio=Math.min(3,Math.max(1,win.devicePixelRatio||1))
      if(record.ratio!==ratio){record.ratio=ratio;record.canvas.width=128*ratio;record.canvas.height=176*ratio;record.paintKey=''}
    }
    wake()
  }
  for(const type of ['input','keydown','pointerdown'])doc.addEventListener(type,activity,true)
  doc.addEventListener('visibilitychange',wake)
  win.addEventListener('resize',geometry)
  win.addEventListener('scroll',geometry,true)

  const ready=Promise.all(Object.entries(assets.sheets).map(([name,sheet])=>new Promise((resolve,reject)=>{
    const img=new ImageClass()
    const pending={img,finish:null,timer:null}
    const finish=(error)=>{
      if(!pendingImages.delete(pending))return
      cancel(pending.timer);img.onload=null;img.onerror=null
      if(error)reject(error);else{images[name]=img;resolve()}
    }
    pending.finish=finish;pendingImages.add(pending)
    pending.timer=later(()=>finish(new Error('鲸鱼娘图集加载超时')),15000)
    img.onload=()=>img.naturalWidth===assets.frameSize*sheet.frames && img.naturalHeight===assets.frameSize
      ? finish() : finish(new Error('鲸鱼娘图集尺寸不匹配'))
    img.onerror=()=>finish(new Error('鲸鱼娘图集加载失败'))
    img.src=sheet.url
  }))).then(()=>{if(!alive)return false;loaded=true;scan();return true}).catch(error=>{
    if(alive && typeof console!=='undefined')console.warn('[dsh-claude-style-addons] 鲸鱼娘素材未就绪，保留原版 Deepy：',error.message)
    return false
  })

  return {
    ready, refresh:schedule, count:()=>records.size,
    // Used by the standalone preview; production follows only Deepy's events.
    preview(clip, elapsed=0){if(!assets.clips[clip])return;lastInput=0;for(const record of records.values()){stopTravel(record);begin(record,clip,now()-elapsed)}wake()},
    dispose(){
      if(!alive)return
      alive=false;observer.disconnect()
      if(timer!==null)cancelFrame(timer);timer=null
      for(const pending of Array.from(pendingImages))pending.finish(new Error('disposed'))
      for(const record of Array.from(records.values()))remove(record)
      style?.remove();style=null
      for(const type of ['input','keydown','pointerdown'])doc.removeEventListener(type,activity,true)
      doc.removeEventListener('visibilitychange',wake)
      win.removeEventListener('resize',geometry)
      win.removeEventListener('scroll',geometry,true)
    },
  }
}

function installMaidCompanion() {
  const runtime=createMaidRuntime(MAID_ASSETS)
  return ()=>runtime.dispose()
}
