import test from 'node:test'
import assert from 'node:assert/strict'
import {harness, all, button, flush} from './helpers.mjs'
const pending = (answer = async()=>{})=>({kind:'approval',key:'approval:1',toolName:'bash',answerable:true,answer})

test('details show an unknown command verbatim, not just recognized commands', () => {
  const f=harness(), raw='mystery-tool "a;b" || echo no;\necho yes', props={pending:pending(),reason:'执行工具',rawArgs:JSON.stringify({command:raw})}
  let tree=f.render(props)
  assert.equal(all(tree).some(n=>n.type==='pre'),false)
  button(tree,'查看详情').props.onClick()
  tree=f.render(props)
  assert.equal(all(tree).find(n=>n.type==='pre').children[0],raw)
  button(tree,'复制').props.onClick()
  assert.equal(f.copied(),raw)
})
test('non-shell arguments and complete long reason remain inspectable', () => {
  const f=harness(), reason='原始说明。'.repeat(40), raw='{"plugin":"example","enabled":true}', props={pending:pending(),reason,rawArgs:raw}
  button(f.render(props),'查看详情').props.onClick()
  const tree=f.render(props)
  assert.ok(all(tree).some(n=>n.children.includes(reason)))
  assert.ok(all(tree).some(n=>n.type==='pre'&&n.children[0]===raw))
})
test('Enter on reject/details/copy is never intercepted as approval', async () => {
  const outcomes=[], f=harness(), props={pending:pending(v=>outcomes.push(v))}, tree=f.render(props)
  tree.props.onKeyDown({key:'Enter',preventDefault(){throw Error('intercepted')}})
  await flush()
  assert.deepEqual(outcomes,[])
  button(tree,'拒绝').props.onClick()
  await flush()
  assert.deepEqual(outcomes,['rejected'])
})
test('double click submits once and disables both decision buttons', async () => {
  const outcomes=[], f=harness(), props={pending:pending(v=>outcomes.push(v))}
  const tree=f.render(props)
  button(tree,'允许一次').props.onClick();button(tree,'拒绝').props.onClick()
  await flush()
  assert.deepEqual(outcomes,['allowed-once'])
  assert.equal(button(f.render(props),'拒绝').props.disabled,true)
})
test('host failure becomes a visible error with retry', async () => {
  let attempts=0
  const f=harness(), props={pending:pending(()=>{if(++attempts===1) throw Error('offline')})}
  button(f.render(props),'允许一次').props.onClick();await flush()
  let tree=f.render(props)
  assert.ok(all(tree).some(n=>n.props.role==='alert'&&n.children.includes('提交失败，请重试。')))
  assert.equal(button(tree,'允许一次').props.disabled,false)
  button(tree,'允许一次').props.onClick();await flush();assert.equal(attempts,2)
})
test('withdrawn requests cannot submit; unmount also cancels a queued submit', async () => {
  let count=0
  const f=harness(), p=pending(()=>count++), props={pending:p}
  p.answerable=false
  let tree=f.render(props);assert.equal(button(tree,'允许一次').props.disabled,true)
  button(tree,'允许一次').props.onClick();await flush();assert.equal(count,0)
  p.answerable=true;tree=f.render(props);button(tree,'允许一次').props.onClick();f.unmount();await flush();assert.equal(count,0)
})
test('Esc rejects only inside this card and respects IME composition', async () => {
  const outcomes=[],f=harness(),tree=f.render({pending:pending(v=>outcomes.push(v))})
  const event={key:'Escape',currentTarget:{contains:()=>true},target:{closest:()=>null},preventDefault(){},stopPropagation(){}}
  tree.props.onKeyDown({...event,nativeEvent:{isComposing:true}})
  tree.props.onKeyDown({...event,repeat:true})
  tree.props.onKeyDown({...event,currentTarget:{contains:()=>false}})
  await flush();assert.deepEqual(outcomes,[])
  tree.props.onKeyDown(event);await flush();assert.deepEqual(outcomes,['rejected'])
})
