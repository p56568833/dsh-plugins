#!/usr/bin/env node
/** AI 绘制关键姿势；这里只做透明通道收口、统一画幅、拼图与打包，不生成新的姿势。 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'assets/whale-maid')
const require = createRequire(import.meta.url)
const FRAME = 128
const PALETTE = ['101633','172650','263774','21469e','2c59c8','367eea','29a9f3','63caff','b6e1ff','fff9f0','ece9f4','cccbe6','a0a4ce','ffe4cb','ffcfb4','ffa9a1','e68088','864953','27253e','435894','7b91cb','151e48','6880c2','eef7ff'].map(hex => [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)))

async function prepareAssets() {
  const sharpPath = process.env.MAID_SHARP_MODULE || '/Users/andychen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'
  let sharp
  try { sharp = require('sharp') } catch { sharp = require(sharpPath) }
  const sources = { idle: [2,2], look: [2,2], hang: [4,2] }
  const report = {}
  for (const [key,[cols,rows]] of Object.entries(sources)) {
    const {data,info} = await sharp(path.join(DIR,'source',key+'.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    // Generated sheets can place the row gap a few pixels off the midpoint.
    // Cut idle at its empty gutter, not through the top row's dangling shoes.
    let rowCut=Math.round(info.height/2)
    if(key==='idle') {
      let best=Infinity
      for(let y=Math.round(info.height*.46);y<info.height*.54;y++) {
        let count=0
        for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>=160)count++
        const score=count+Math.abs(y-info.height/2)/info.height
        if(score<best){best=score;rowCut=y}
      }
    }
    const tiles = []
    report[key] = []
    for (let i=0;i<cols*rows;i++) {
      const x0=Math.round(i%cols*info.width/cols), x1=Math.round((i%cols+1)*info.width/cols)
      const y0=Math.floor(i/cols)===0?0:rowCut, y1=Math.floor(i/cols)===0?rowCut:info.height
      let minX=x1,minY=y1,maxX=x0,maxY=y0
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(data[(y*info.width+x)*4+3]>=160){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
      if(maxX<=minX||maxY<=minY)throw new Error(`Empty frame ${key}/${i}`)
      const w=maxX-minX+1,h=maxY-minY+1
      const scale=Math.min(112/w,112/h)
      const tw=Math.round(w*scale),th=Math.round(h*scale)
      const crop=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).extract({left:minX,top:minY,width:w,height:h}).resize(tw,th,{kernel:'nearest'}).raw().toBuffer()
      const pixels=Buffer.alloc(FRAME*FRAME*4), left=Math.floor((FRAME-tw)/2),top=FRAME-th-8
      for(let y=0;y<th;y++)for(let x=0;x<tw;x++) {
        const p=(y*tw+x)*4;if(crop[p+3]<160)continue
        let best=PALETTE[0],distance=Infinity
        for(const c of PALETTE){const d=2*(c[0]-crop[p])**2+3*(c[1]-crop[p+1])**2+(c[2]-crop[p+2])**2;if(d<distance){distance=d;best=c}}
        const q=((y+top)*FRAME+x+left)*4
        pixels[q]=best[0];pixels[q+1]=best[1];pixels[q+2]=best[2];pixels[q+3]=255
      }
      tiles.push({input:pixels,raw:{width:FRAME,height:FRAME,channels:4},left:i*FRAME,top:0})
      report[key].push({frame:i,bounds:[left,top,tw,th],sourceBounds:[minX,minY,w,h]})
    }
    await sharp({create:{width:FRAME*tiles.length,height:FRAME,channels:4,background:'#00000000'}}).composite(tiles).png({palette:true,colours:32,dither:0}).toFile(path.join(DIR,key+'.png'))
  }
  fs.writeFileSync(path.join(DIR,'asset-report.json'),JSON.stringify(report,null,2)+'\n')
}

/** Pack the newly DRAWN sequences without touching the approved idle sheet.
 * Use a common scale within each sequence so crouching never grows the head.
 * Per-pose contact landmarks also survive cropping in the generated manifest.
 */
async function prepareDrawnAssets() {
  const sharpPath=process.env.MAID_SHARP_MODULE||'/Users/andychen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'
  let sharp;try{sharp=require('sharp')}catch{sharp=require(sharpPath)}
  const plan=JSON.parse(fs.readFileSync(path.join(DIR,'source/drawn-layout.json'),'utf8'))
  const report={}
  for(const [name,spec] of Object.entries(plan.sheets)) {
    const {data,info}=await sharp(path.join(DIR,'source',spec.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    const overrides={}
    for(const file of new Set(Object.values(spec.overrides||{}))) {
      const alternative=await sharp(path.join(DIR,'source',file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
      if(alternative.info.width!==info.width||alternative.info.height!==info.height)throw Error('Override grid dimensions differ: '+file)
      overrides[file]=alternative.data
    }
    const cols=spec.columns||4,rows=spec.rows||2,boxes=[]
    const cuts=(length,count,axis)=>Array.from({length:count+1},(_,i)=>{
      if(i===0)return 0;if(i===count)return length
      const expected=Math.round(i*length/count),radius=Math.round(length/count*.08)
      let best=Infinity,cut=expected
      for(let p=expected-radius;p<=expected+radius;p++) {
        let count=0
        for(let q=0;q<(axis==='x'?info.height:info.width);q++) {
          const x=axis==='x'?p:q,y=axis==='y'?p:q
          if(data[(y*info.width+x)*4+3]>=160)count++
        }
        const score=count+Math.abs(p-expected)/length
        if(score<best){best=score;cut=p}
      }
      return cut
    })
    const xs=cuts(info.width,cols,'x'),ys=cuts(info.height,rows,'y')
    for(let frame=0;frame<cols*rows;frame++) {
      const col=frame%cols,row=Math.floor(frame/cols)
      const pixels=overrides[spec.overrides?.[frame]]||data
      let l=xs[col+1],r=xs[col],t=ys[row+1],b=ys[row]
      for(let y=ys[row];y<ys[row+1];y++)for(let x=xs[col];x<xs[col+1];x++)if(pixels[(y*info.width+x)*4+3]>=160){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
      if(r<=l||b<=t)throw Error('Empty drawing: '+name+'/'+frame)
      boxes.push({l,t,w:r-l+1,h:b-t+1,col,row,pixels})
    }
    const scale=spec.scale||Math.min(...boxes.map(b=>Math.min(112/b.w,112/b.h)))
    const tiles=[];report[name]=[]
    for(const [frame,box] of boxes.entries()) {
      const w=Math.round(box.w*scale),h=Math.round(box.h*scale),left=Math.floor((128-w)/2),top=120-h
      if(w>120||h>120)throw Error('Drawing exceeds tile: '+name+'/'+frame)
      const crop=await sharp(box.pixels,{raw:{width:info.width,height:info.height,channels:4}}).extract({left:box.l,top:box.t,width:box.w,height:box.h}).resize(w,h,{kernel:'nearest'}).raw().toBuffer()
      const pixels=Buffer.alloc(128*128*4)
      for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const p=(y*w+x)*4;if(crop[p+3]<160)continue
        let best=PALETTE[0],distance=Infinity
        for(const c of PALETTE){const d=2*(c[0]-crop[p])**2+3*(c[1]-crop[p+1])**2+(c[2]-crop[p+2])**2;if(d<distance){distance=d;best=c}}
        const q=((top+y)*128+left+x)*4;pixels[q]=best[0];pixels[q+1]=best[1];pixels[q+2]=best[2];pixels[q+3]=255
      }
      tiles.push({input:pixels,raw:{width:128,height:128,channels:4},left:frame*128,top:0})
      report[name].push({frame,bounds:[left,top,w,h],sourceBounds:[box.l,box.t,box.w,box.h],scale})
    }
    await sharp({create:{width:128*tiles.length,height:128,channels:4,background:'#00000000'}}).composite(tiles).png({palette:true,colours:32,dither:0}).toFile(path.join(DIR,name+'.png'))
  }
  fs.writeFileSync(path.join(DIR,'drawn-report.json'),JSON.stringify(report,null,2)+'\n')
}

/* ── 派生素材（0.4.1）──────────────────────────────────────────────
 * 不画新姿势，只把已有素材修成能无缝拼接的样子：
 *  1. 去掉绘制图集里与人物不相连的游离像素（张望 5–7、下探 A7 头顶的小横杠等）。
 *  2. blink.png：在待机第 0 帧上原位重画眼皮。旧做法是把另一张单独生成的图里
 *     42×20 的眼部矩形贴过来，刘海、脸颊、侧发在矩形边上对不齐，眨眼时会闪出接缝。
 *  3. look-head.png：张望头像比待机头小约 5%、低约 6 像素，开始和结束张望时
 *     头会突然缩小下沉。这里先统一缩放对齐到待机头，再沿两图最接近的位置
 *     找一条接缝把待机身体接上，避免在第 78 行硬切断侧发和衣领。
 */
function loadSharp(){
  const sharpPath=process.env.MAID_SHARP_MODULE||'/Users/andychen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'
  try{return require('sharp')}catch{return require(sharpPath)}
}
const DRAWN_SHEETS=['look-v2','turn-v2','lower-a-v2','lower-b-v2','climb-a-v2','climb-b-v2','push-v2']
async function readSheet(sharp,file){
  const {data,info}=await sharp(path.join(DIR,file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const frames=[]
  for(let f=0;f<info.width/FRAME;f++){
    const tile=Buffer.alloc(FRAME*FRAME*4)
    for(let y=0;y<FRAME;y++)data.copy(tile,y*FRAME*4,(y*info.width+f*FRAME)*4,(y*info.width+f*FRAME+FRAME)*4)
    frames.push(tile)
  }
  return frames
}
async function writeSheet(sharp,file,frames){
  const tiles=frames.map((input,i)=>({input,raw:{width:FRAME,height:FRAME,channels:4},left:i*FRAME,top:0}))
  await sharp({create:{width:FRAME*frames.length,height:FRAME,channels:4,background:'#00000000'}}).composite(tiles).png({palette:true,colours:32,dither:0}).toFile(path.join(DIR,file))
}
const px=(t,x,y)=>(y*FRAME+x)*4
const opaque=(t,x,y)=>x>=0&&y>=0&&x<FRAME&&y<FRAME&&t[px(t,x,y)+3]>0
function despeckle(tile,minSize=40){
  const seen=new Uint8Array(FRAME*FRAME);let removed=0
  for(let y=0;y<FRAME;y++)for(let x=0;x<FRAME;x++){
    if(seen[y*FRAME+x]||!opaque(tile,x,y))continue
    const stack=[[x,y]],part=[];seen[y*FRAME+x]=1
    while(stack.length){const [cx,cy]=stack.pop();part.push([cx,cy])
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=cx+dx,ny=cy+dy
        if(opaque(tile,nx,ny)&&!seen[ny*FRAME+nx]){seen[ny*FRAME+nx]=1;stack.push([nx,ny])}}}
    if(part.length<minSize)for(const [cx,cy] of part){tile.fill(0,px(tile,cx,cy),px(tile,cx,cy)+4);removed++}
  }
  return removed
}
const hex=h=>[0,2,4].map(i=>parseInt(h.slice(i,i+2),16))
const SKIN=['ffe4cb','ffcfb4','ffa9a1','e68088'].map(hex)
const isSkin=(t,x,y)=>{const p=px(t,x,y);return SKIN.some(c=>c[0]===t[p]&&c[1]===t[p+1]&&c[2]===t[p+2])}
const setColor=(t,x,y,c)=>{const p=px(t,x,y);t[p]=c[0];t[p+1]=c[1];t[p+2]=c[2];t[p+3]=255}
/** Eye shapes of idle frame 0: non-skin pixels grown from the pupil inside a
 * tight box. 4-connectivity keeps bangs and side hair out of the mask. */
const EYE_BOXES=[[35,46],[56,68]],EYE_ROWS=[50,60]
function eyeMask(t){
  const mask=new Uint8Array(FRAME*FRAME)
  for(const [x0,x1] of EYE_BOXES){
    const ok=(x,y)=>x>=x0&&x<=x1&&y>=EYE_ROWS[0]&&y<=EYE_ROWS[1]&&opaque(t,x,y)&&!isSkin(t,x,y)
    const cx=(x0+x1)>>1,stack=[]
    for(let y=52;y<58;y++)for(let x=cx-3;x<=cx+3;x++)if(ok(x,y)){mask[y*FRAME+x]=1;stack.push([x,y])}
    while(stack.length){const [x,y]=stack.pop()
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy
        if(ok(nx,ny)&&!mask[ny*FRAME+nx]){mask[ny*FRAME+nx]=1;stack.push([nx,ny])}}}
  }
  return mask
}
function deriveBlink(idle){
  const open=idle[0],closedArt=idle[2],mask=eyeMask(open)
  const W=hex('ffe4cb'),V=hex('ffcfb4'),LASH=hex('101633')
  const half=Buffer.from(open),closed=Buffer.from(open)
  for(let y=EYE_ROWS[0];y<=EYE_ROWS[1];y++)for(let x=0;x<FRAME;x++){
    if(!mask[y*FRAME+x])continue
    setColor(closed,x,y,W)
    if(y<54)setColor(half,x,y,W);else if(y===54)setColor(half,x,y,V)
  }
  for(const [x0,x1] of EYE_BOXES){
    // Half-closed: the same iris as the open eye under a lowered lash line.
    const row=[];for(let x=x0;x<=x1;x++)if(mask[55*FRAME+x])row.push(x)
    for(let x=Math.min(...row);x<=Math.max(...row);x++)setColor(half,x,55,LASH)
    // Closed: the lid arc already approved in idle frame 2, without its face.
    for(let y=55;y<=58;y++)for(let x=x0;x<=x1;x++)if(opaque(closedArt,x,y)&&!isSkin(closedArt,x,y)){
      const p=px(closedArt,x,y);setColor(closed,x,y,[closedArt[p],closedArt[p+1],closedArt[p+2]])}
  }
  return [half,closed]
}
/** Nearest-neighbour scale about a pivot, then shift; destination-sampled. */
function placeTile(src,s,pivotX,pivotY,dx,dy){
  const out=Buffer.alloc(FRAME*FRAME*4)
  for(let y=0;y<FRAME;y++)for(let x=0;x<FRAME;x++){
    const sx=Math.floor((x-dx-pivotX)/s+pivotX+1e-6),sy=Math.floor((y-dy-pivotY)/s+pivotY+1e-6)
    if(sx<0||sy<0||sx>=FRAME||sy>=FRAME)continue
    src.copy(out,px(out,x,y),px(src,sx,sy),px(src,sx,sy)+4)
  }
  return out
}
function fitHead(src,ref){
  let best=null
  for(let s=0.98;s<=1.121;s+=0.01)for(let dx=-6;dx<=6;dx++)for(let dy=-10;dy<=7;dy++){
    const t=placeTile(src,s,64,102,dx,dy);let both=0,any=0
    for(let y=8;y<62;y++)for(let x=0;x<FRAME;x++){const a=opaque(t,x,y),b=opaque(ref,x,y);if(a&&b)both++;if(a||b)any++}
    const iou=both/any
    if(!best||iou>best.iou)best={iou,s:Math.round(s*100)/100,dx,dy}
  }
  return best
}
function colorGap(a,b,x,y){
  const p=px(a,x,y),oa=a[p+3]>0,ob=b[p+3]>0
  if(!oa&&!ob)return 0
  if(oa!==ob)return 600
  return Math.abs(a[p]-b[p])+Math.abs(a[p+1]-b[p+1])+Math.abs(a[p+2]-b[p+2])
}
/** One cut row per column, continuous within ±1 row, where the aligned look
 * head and the idle body differ least. Below the jaw only near the neck. */
function seamCut(head,body){
  const top=58,bottom=77,rows=bottom-top+1
  const minRow=x=>x>=30&&x<=86?70:top
  const cost=[],from=[]
  for(let x=0;x<FRAME;x++){
    cost.push(new Float64Array(rows).fill(Infinity));from.push(new Int8Array(rows))
    for(let r=0;r<rows;r++){
      const y=top+r;if(y<minRow(x))continue
      const local=colorGap(head,body,x,y-1)+colorGap(head,body,x,y)
      if(x===0){cost[x][r]=local;continue}
      for(const d of [-1,0,1]){const pr=r+d;if(pr<0||pr>=rows)continue
        const c=cost[x-1][pr]+local+(d?20:0);if(c<cost[x][r]){cost[x][r]=c;from[x][r]=d}}
    }
  }
  let r=0;for(let i=1;i<rows;i++)if(cost[FRAME-1][i]<cost[FRAME-1][r])r=i
  const cut=new Array(FRAME)
  for(let x=FRAME-1;x>=0;x--){cut[x]=top+r;r+=from[x][r]}
  return cut
}
function deriveLookHead(idle0,looks){
  const fit=fitHead(looks[0],idle0)
  const frames=looks.map(look=>{
    const head=placeTile(look,fit.s,64,102,fit.dx,fit.dy),cut=seamCut(head,idle0),out=Buffer.from(idle0)
    for(let x=0;x<FRAME;x++)for(let y=0;y<cut[x];y++)head.copy(out,px(out,x,y),px(head,x,y),px(head,x,y)+4)
    return {out,cut}
  })
  return {fit,frames}
}
/* ── 表情层 face.png（0.5.0）──────────────────────────────────────
 * 第 0 帧「睡眼」由程序在待机第 0 帧上画；之后各帧来自 GPT 画的表情图
 * source/expressions.png（布局见 source/expressions-layout.json）。
 * GPT 会把整个人重画一遍，这里只取脸：先把它对齐到待机头，再只拿
 * 「待机图里属于脸的像素」（肤色、眼睛、嘴）＋新画的眼睛，头发和身体
 * 一律保留待机第 0 帧，所以不会有接缝。
 */
function cutGrid(data,info,cols,rows){
  const cuts=(length,count,axis)=>Array.from({length:count+1},(_,i)=>{
    if(i===0)return 0;if(i===count)return length
    const expected=Math.round(i*length/count),radius=Math.round(length/count*.08)
    let best=Infinity,cut=expected
    for(let p=expected-radius;p<=expected+radius;p++){
      let n=0
      for(let q=0;q<(axis==='x'?info.height:info.width);q++){const x=axis==='x'?p:q,y=axis==='y'?p:q;if(data[(y*info.width+x)*4+3]>=160)n++}
      const score=n+Math.abs(p-expected)/length;if(score<best){best=score;cut=p}
    }
    return cut
  })
  const xs=cuts(info.width,cols,'x'),ys=cuts(info.height,rows,'y'),boxes=[]
  for(let i=0;i<cols*rows;i++){
    const col=i%cols,row=Math.floor(i/cols)
    let l=xs[col+1],r=xs[col],t=ys[row+1],b=ys[row]
    for(let y=ys[row];y<ys[row+1];y++)for(let x=xs[col];x<xs[col+1];x++)if(data[(y*info.width+x)*4+3]>=160){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}
    boxes.push(r>l&&b>t?{l,t,w:r-l+1,h:b-t+1}:null)
  }
  return boxes
}
/** Crop → nearest resize → snap to the maid palette → place into a 128 tile. */
// Props need a few accent colours the maid herself never uses.
const PROP_PALETTE=[...PALETTE,...['ffd84a','f5a623','e5484d','3fb950','ff8fb1','a78bfa','ffffff'].map(hex)]
async function toTile(sharp,data,info,box,w,h,left,top,{kernel='nearest',palette=PALETTE}={}){
  const crop=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).extract({left:box.l,top:box.t,width:box.w,height:box.h}).resize(w,h,{kernel}).raw().toBuffer()
  const tile=Buffer.alloc(FRAME*FRAME*4)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4;if(crop[p+3]<160)continue
    const tx=left+x,ty=top+y;if(tx<0||ty<0||tx>=FRAME||ty>=FRAME)continue
    let best=palette[0],distance=Infinity
    for(const c of palette){const d=2*(c[0]-crop[p])**2+3*(c[1]-crop[p+1])**2+(c[2]-crop[p+2])**2;if(d<distance){distance=d;best=c}}
    setColor(tile,tx,ty,best)
  }
  return tile
}
function deriveSleepEyes(open){
  const out=Buffer.from(open),mask=eyeMask(open),W=hex('ffe4cb'),LASH=hex('101633'),SOFT=hex('864953')
  for(let i=0;i<FRAME*FRAME;i++)if(mask[i])setColor(out,i%FRAME,Math.floor(i/FRAME),W)
  for(const [x0,x1] of EYE_BOXES){
    const xs=[];for(let y=EYE_ROWS[0];y<=EYE_ROWS[1];y++)for(let x=x0;x<=x1;x++)if(mask[y*FRAME+x])xs.push(x)
    const l=Math.min(...xs)+1,r=Math.max(...xs)-1
    // A relaxed downward arc "‿": ends one row higher than the middle.
    for(let x=l;x<=r;x++){const end=x<l+2||x>r-2;setColor(out,x,end?56:57,LASH);if(!end)setColor(out,x,58,SOFT)}
  }
  return out
}
/** Face pixels of idle frame 0: skin, eyes and mouth inside the face box. */
function faceMask(idle0){
  const mask=eyeMask(idle0)
  for(let y=44;y<=70;y++)for(let x=30;x<=72;x++)if(opaque(idle0,x,y)&&isSkin(idle0,x,y))mask[y*FRAME+x]=1
  // Mouth / nose marks are enclosed by skin: fill non-skin holes whose 4
  // neighbours within 3 px are all skin-or-mask.
  for(let y=50;y<=68;y++)for(let x=36;x<=66;x++){
    if(mask[y*FRAME+x])continue
    const hit=d=>{for(let k=1;k<=3;k++){const nx=x+d[0]*k,ny=y+d[1]*k;if(mask[ny*FRAME+nx])return true}return false}
    if([[1,0],[-1,0],[0,1],[0,-1]].every(hit))mask[y*FRAME+x]=1
  }
  return mask
}
async function deriveFaces(sharp,idle0,report){
  const frames=[deriveSleepEyes(idle0)],names=['sleep']
  const layoutFile=path.join(DIR,'source/expressions-layout.json')
  if(fs.existsSync(layoutFile)){
    const layout=JSON.parse(fs.readFileSync(layoutFile,'utf8'))
    const {data,info}=await sharp(path.join(DIR,'source',layout.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    const boxes=cutGrid(data,info,layout.columns,layout.rows)
    // Same figure height as idle frame 0 (rows 8–119), bottom at row 120.
    const idleBounds=[8,119]
    const base=faceMask(idle0)
    for(const [i,name] of layout.names.entries()){
      const box=boxes[i];if(!box||!name)continue
      const scale=(idleBounds[1]-idleBounds[0]+1)/box.h
      const w=Math.round(box.w*scale),h=Math.round(box.h*scale)
      let drawn=await toTile(sharp,data,info,box,w,h,Math.floor((FRAME-w)/2),120-h)
      despeckle(drawn)
      const fit=fitHead(drawn,idle0)
      drawn=placeTile(drawn,fit.s,64,102,fit.dx,fit.dy)
      const mask=Uint8Array.from(base),own=eyeMask(drawn)
      for(let k=0;k<mask.length;k++)if(own[k])mask[k]=1
      const out=Buffer.from(idle0)
      for(let k=0;k<mask.length;k++)if(mask[k]&&opaque(drawn,k%FRAME,Math.floor(k/FRAME)))drawn.copy(out,k*4,k*4,k*4+4)
      frames.push(out);names.push(name)
      report.faces=report.faces||{};report.faces[name]={fit:{s:fit.s,dx:fit.dx,dy:fit.dy,iou:Math.round(fit.iou*1000)/1000}}
    }
  }
  await writeSheet(sharp,'face.png',frames)
  report.faceNames=names
  // Keep the manifest's face frame list in step with what was derived.
  const manifestFile=path.join(DIR,'manifest.json'),m=JSON.parse(fs.readFileSync(manifestFile,'utf8'))
  if(m.sheets.face){m.sheets.face.frames=frames.length;m.sheets.face.names=names;fs.writeFileSync(manifestFile,JSON.stringify(m,null,2)+'\n')}
  return names
}
/* ── 道具层 props.png（0.5.0）─────────────────────────────────────
 * GPT 把道具画在 source/props.png 的格子里（布局见 source/props-layout.json，
 * 每项写名字和目标宽度 width，单位是鲸鱼娘原画像素，人物头宽约 50）。
 * 这里切格、按目标宽度最近邻缩小、换成鲸鱼娘调色板、去碎点，每个道具
 * 放进一个 128×128 格子的正中，挂点 = 道具下边缘中点。
 */
async function prepareProps(sharp,report){
  const layoutFile=path.join(DIR,'source/props-layout.json')
  if(!fs.existsSync(layoutFile))return null
  const layout=JSON.parse(fs.readFileSync(layoutFile,'utf8'))
  const {data,info}=await sharp(path.join(DIR,'source',layout.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const boxes=cutGrid(data,info,layout.columns,layout.rows),tiles=[],props={}
  for(const [i,item] of layout.items.entries()){
    if(!item?.name)continue
    let pixels=data,meta=info,box=boxes[i]
    if(item.file){
      const source=await sharp(path.join(DIR,'source',item.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
      pixels=source.data;meta=source.info;box=cutGrid(pixels,meta,1,1)[0]
    }
    if(!box)continue
    const scale=item.width/box.w,w=item.width,h=item.height||Math.max(1,Math.round(box.h*scale))
    if(w>120||h>120)throw Error('道具太大：'+item.name)
    const left=Math.floor((FRAME-w)/2),top=Math.floor((FRAME-h)/2)
    // GPT's "pixel art" is not on an exact grid, so shrink with a proper
    // resampling filter (not nearest) before snapping to the palette.
    const tile=await toTile(sharp,pixels,meta,box,w,h,left,top,{kernel:'lanczos3',palette:PROP_PALETTE});despeckle(tile,Math.min(40,Math.floor(w*h/20)))
    props[item.name]={sheet:'props',frame:tiles.length,anchor:item.anchor||[64,top+h]}
    tiles.push(tile)
  }
  await writeSheet(sharp,'props.png',tiles)
  fs.writeFileSync(path.join(DIR,'props.generated.json'),JSON.stringify({frames:tiles.length,props},null,2)+'\n')
  report.props=Object.keys(props)
  return props
}
async function deriveAssets(){
  const sharp=loadSharp(),report={despeckled:{}}
  for(const name of DRAWN_SHEETS){
    const file=name+'.png';if(!fs.existsSync(path.join(DIR,file)))continue
    const frames=await readSheet(sharp,file),counts=frames.map(t=>despeckle(t))
    if(counts.some(Boolean)){await writeSheet(sharp,file,frames);report.despeckled[name]=counts}
  }
  const idle=await readSheet(sharp,'idle.png'),looks=await readSheet(sharp,'look-v2.png')
  await writeSheet(sharp,'blink.png',deriveBlink(idle))
  const look=deriveLookHead(idle[0],looks)
  await writeSheet(sharp,'look-head.png',look.frames.map(f=>f.out))
  report.lookHeadFit=look.fit
  report.lookHeadSeam=look.frames.map(f=>[Math.min(...f.cut),Math.max(...f.cut)])
  await deriveFaces(sharp,idle[0],report)
  await prepareProps(sharp,report)
  fs.writeFileSync(path.join(DIR,'derive-report.json'),JSON.stringify(report,null,2)+'\n')
  console.log('鲸鱼娘派生素材：blink.png、look-head.png、face.png（'+report.faceNames.join('、')+'）'+(report.props?'、props.png（'+report.props.join('、')+'）':'')+'；头部对齐',JSON.stringify(look.fit))
}

/** Pack the newly painted full-body laptop sequence. The stable pixels come
 * from this new drawing, never from the old idle body. Only the face/hands
 * are allowed to vary inside the typing loop, avoiding redraw shimmer. */
async function prepareTyping(){
  const sharp=loadSharp()
  const spec=JSON.parse(fs.readFileSync(path.join(DIR,'source/typing-layout.json'),'utf8'))
  const {data,info}=await sharp(path.join(DIR,'source',spec.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  const boxes=cutGrid(data,info,spec.columns,spec.rows)
  if(boxes.some(b=>!b))throw Error('打字原画有空格')
  const scale=112/Math.max(...boxes.map(b=>b.h)),frames=[]
  const cellW=info.width/spec.columns,cellH=info.height/spec.rows
  const baseline=Math.max(...boxes.map((b,i)=>b.t-Math.floor(i/spec.columns)*cellH+b.h))
  for(const [i,box] of boxes.entries()){
    const w=Math.round(box.w*scale),h=Math.round(box.h*scale)
    // Preserve the camera while the computer moves from ledge to lap. Centering
    // each crop would move the girl's entire body as the prop changes sides.
    const left=spec.preserveCellPlacement?Math.round((128-cellW*scale)/2+(box.l-i%spec.columns*cellW)*scale):Math.floor((128-w)/2)
    const top=spec.preserveCellPlacement?Math.round(120-baseline*scale+(box.t-Math.floor(i/spec.columns)*cellH)*scale):120-h
    const tile=await toTile(sharp,data,info,box,w,h,left,top,{kernel:'lanczos3'})
    despeckle(tile);frames.push(tile)
  }
  const idle=(await readSheet(sharp,'idle.png'))[0]
  const fit=spec.fit||fitHead(frames[0],idle)
  let aligned=frames.map(f=>placeTile(f,fit.s,64,102,fit.dx,fit.dy))
  const overrideFits={}
  // Locally corrected artwork shares the same head landmarks. Replace only
  // the newly painted arms/prop area, retaining the sequence's stable camera.
  for(const [index,override] of Object.entries(spec.overrides||{})){
    const source=await sharp(path.join(DIR,'source',override.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    const box=cutGrid(source.data,source.info,1,1)[0]
    const scale=112/box.h,w=Math.round(box.w*scale),h=112
    const tile=await toTile(sharp,source.data,source.info,box,w,h,Math.floor((128-w)/2),120-h,{kernel:'lanczos3'})
    const match=override.fit||fitHead(tile,aligned[index]);overrideFits[index]=match
    const corrected=placeTile(tile,match.s,64,102,match.dx,match.dy)
    for(const [x,y,w,h] of override.regions)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)corrected.copy(aligned[index],px(tile,xx,yy),px(tile,xx,yy),px(tile,xx,yy)+4)
  }
  if(spec.fixedRegions?.length){
    const stable=Buffer.from(aligned[spec.fixedFrame||0])
    for(const frame of aligned)for(const [x,y,w,h] of spec.fixedRegions)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)stable.copy(frame,px(frame,xx,yy),px(stable,xx,yy),px(stable,xx,yy)+4)
  }
  // Optional fixed regions are documented in the source layout and inspected
  // at the final 72px display size. Preserve expression changes separately.
  if(spec.stableFrame!==undefined){
    const stable=aligned[spec.stableFrame]
    aligned=aligned.map((frame,i)=>{
      const out=Buffer.from(stable)
      for(const [x,y,w,h] of spec.changingRegions||[])for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)frame.copy(out,px(out,xx,yy),px(frame,xx,yy),px(frame,xx,yy)+4)
      return out
    })
  }
  if(spec.loopStableFrame!==undefined){
    const stable=Buffer.from(aligned[spec.loopStableFrame])
    for(const i of spec.loopFrames||[]){
      const frame=aligned[i],out=Buffer.from(stable)
      const regions=[...(spec.handRegions||[]),...((spec.expressionFrames||[spec.blinkFrame]).includes(i)?spec.eyeRegions||[]:[])]
      for(const [x,y,w,h] of regions)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)frame.copy(out,px(out,xx,yy),px(frame,xx,yy),px(frame,xx,yy)+4)
      aligned[i]=out
    }
  }
  await writeSheet(sharp,'typing.png',aligned)
  const bounds=aligned.map(tile=>{let l=128,r=0,t=128,b=0;for(let y=0;y<128;y++)for(let x=0;x<128;x++)if(opaque(tile,x,y)){l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y)}return[l,t,r-l+1,b-t+1]})
  fs.writeFileSync(path.join(DIR,'typing-report.json'),JSON.stringify({source:spec.file,frames:aligned.length,fit,overrideFits,bounds,stabilizedFrom:spec.loopStableFrame??spec.stableFrame??null,changingRegions:spec.changingRegions||spec.handRegions||[]},null,2)+'\n')
  console.log('全新打字原画：'+aligned.length+' 帧；对齐 '+JSON.stringify(fit))
}

if(process.argv.includes('--assets'))await prepareAssets()
if(process.argv.includes('--drawn-assets'))await prepareDrawnAssets()
if(process.argv.includes('--drawn-assets')||process.argv.includes('--derive'))await deriveAssets()
if(process.argv.includes('--typing-assets'))await prepareTyping()
if(process.argv.includes('--pack-only'))process.exit(0)
const manifest=JSON.parse(fs.readFileSync(path.join(DIR,'manifest.json'),'utf8'))
// Props packed from GPT's drawing register themselves; manifest entries win.
const generatedProps=path.join(DIR,'props.generated.json')
if(fs.existsSync(generatedProps)&&fs.existsSync(path.join(DIR,'props.png'))){
  const g=JSON.parse(fs.readFileSync(generatedProps,'utf8'))
  manifest.sheets.props={file:'props.png',frames:g.frames,derived:true}
  manifest.props={...g.props,...(manifest.props||{})}
}
const sheets={}
for(const [name,info] of Object.entries(manifest.sheets)){
  const bytes=fs.readFileSync(path.join(DIR,info.file))
  // Derived sheets grow when new expressions / props are added: read the
  // frame count from the PNG header instead of trusting a stale number.
  const frames=bytes.readUInt32BE(16)/FRAME
  if(!Number.isInteger(frames)||bytes.readUInt32BE(20)!==FRAME)throw Error(info.file+' 不是 128 高、128 整数倍宽的图集')
  if(info.derived)info.frames=frames
  else if(info.frames!==frames)throw Error(info.file+' 帧数与 manifest 不符')
  sheets[name]={...info,url:'data:image/png;base64,'+bytes.toString('base64')}
}
const payload={...manifest,sheets}
const runtime=fs.readFileSync(path.join(ROOT,'mascot/runtime.js'),'utf8')
const chunk=`    // BEGIN GENERATED WHALE MAID — tools/build-maid.mjs\n    const MAID_ASSETS = ${JSON.stringify(payload)}\n${runtime.split('\n').map(l=>'    '+l).join('\n')}\n    // END GENERATED WHALE MAID`
const clientFile=path.join(ROOT,'client.js')
let source=fs.readFileSync(clientFile,'utf8')
if(source.includes('// BEGIN GENERATED WHALE MAID'))source=source.replace(/    \/\/ BEGIN GENERATED WHALE MAID[^]*?    \/\/ END GENERATED WHALE MAID/,()=>chunk)
else source=source.replace('    // ══ 四、选项',()=>chunk+'\n\n    // ══ 四、选项')
if(!process.argv.includes('--preview-only'))fs.writeFileSync(clientFile,source)
// Standalone preview uses the exact same implementation and bundled bytes as the plugin.
fs.writeFileSync(path.join(ROOT,'preview/maid-bundle.js'),`const MAID_ASSETS = ${JSON.stringify(payload)};\n${runtime}\n`)
console.log(`鲸鱼娘：${Object.keys(manifest.states).length} 个动作接口，${Object.keys(sheets).length} 张图集，${process.argv.includes('--preview-only')?'仅更新独立预览':'已嵌入 client.js'}`)
