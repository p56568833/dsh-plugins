(() => {
  const React=window.PreviewReact, h=React.createElement
  const {ApprovalCard,CSS}=window.previewPlugin.__internals
  const style=document.createElement('style');style.textContent=CSS;document.head.appendChild(style)
  const examples=[
    {reason:'允许本次操作使用 danger-full-access 权限：把桌面的 DeepSeek Harness 快捷方式移到废纸篓，保留软件本体。',command:'mv "$SRC" "$HOME/.Trash/DeepSeek Harness.app"'},
    {reason:'删除“旧项目”目录及其中所有文件。没有备份，删除后可能无法恢复。',command:'rm -rf "/example/旧项目"'},
    {reason:'安装审批插件，让确认提示更简洁。',args:'{"plugin":"dsh-approval-clear","enabled":true}'},
    {reason:'这个示例用于检查提交失败后能否重试。',command:'custom-tool --check',fail:true},
  ]
  function Preview(){
    const [round,setRound]=React.useState(0),[results,setResults]=React.useState([])
    return h(React.Fragment,null,
      examples.map((example,i)=>h('div',{key:round+':'+i},
        h('p',{className:'case'},['移动文件','删除文件','安装插件','提交失败'][i]),
        h(ApprovalCard,{pending:{key:round+':'+i,answerable:true,toolName:i===2?'plugin-manager':'bash',answer:async value=>{
          setResults(previous=>[...previous,`${i+1}：${value==='allowed-once'?'已允许':'已拒绝'}`]);if(example.fail)throw Error('simulation')
        }},reason:example.reason,rawArgs:example.args??JSON.stringify({command:example.command})}))),
      h('div',{className:'test-tools'},h('button',{onClick:()=>{setRound(v=>v+1);setResults([])}},'重置演示'),
        h('button',{onClick:()=>document.body.classList.toggle('dark')},'切换深浅色')),
      h('div',{id:'results',role:'status'},results.join('\n')))
  }
  window.PreviewCreateRoot(document.getElementById('root')).render(h(Preview))
})()
