import fs from 'node:fs'
import vm from 'node:vm'
export const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
export function loadClient(code, React = {}, globals = {}) {
  let plugin
  vm.runInNewContext(code, {
    console, queueMicrotask, setTimeout, clearTimeout,
    window: {__ModuleLoader__:{load:({factory})=>{plugin=factory(name=>name==='react'?React:{})}}},
    ...globals,
  })
  return plugin
}
export function harness() {
  const states = []
  let cursor = 0
  const effects = []
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({type, props:props??{}, children:children.flat(Infinity).filter(x=>x!==false && x!=null)}),
    useState(value) { const i=cursor++; if (!(i in states)) states[i]=value; return [states[i], value=>{states[i]=typeof value==='function'?value(states[i]):value}] },
    useRef(value) { const i=cursor++; return states[i]??(states[i]={current:value}) },
    useEffect(fn) { const i=cursor++; if (!(i in states)) {states[i]=true; effects.push(fn())} },
  }
  const document = {activeElement:{}}
  let copied
  const plugin = loadClient(source, React, {document,navigator:{clipboard:{writeText:async text=>{copied=text}}}})
  return {plugin, document, render(props) {cursor=0;return plugin.__internals.ApprovalCard(props)}, unmount(){effects.forEach(f=>f?.())}, copied:()=>copied}
}
export function all(tree) {
  if (!tree || typeof tree!=='object') return []
  return [tree,...tree.children.flatMap(all)]
}
export function button(tree, label) { return all(tree).find(n=>n.type==='button'&&n.children.includes(label)) }
export const flush = async()=>{for(let i=0;i<8;i++) await Promise.resolve()}
export function asarReader(file) {
  const fd=fs.openSync(file,'r'), head=Buffer.alloc(16)
  fs.readSync(fd,head,0,16,0)
  const buf=Buffer.alloc(head.readUInt32LE(12))
  fs.readSync(fd,buf,0,buf.length,16)
  const header=JSON.parse(buf), base=8+head.readUInt32LE(4)
  return name=>{let entry=header;for(const part of name.split('/')) entry=entry.files[part]
    if(entry.unpacked) return fs.readFileSync(file+'.unpacked/'+name,'utf8')
    const data=Buffer.alloc(entry.size);fs.readSync(fd,data,0,data.length,base+Number(entry.offset));return data.toString('utf8')}
}
