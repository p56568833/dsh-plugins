/** Build an offline preview using real React, with decisions simulated locally. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const cache=path.join(os.homedir(),'.npm/_npx')
const candidates=[process.env.DSH_PREVIEW_NODE_MODULES,...(fs.existsSync(cache)?fs.readdirSync(cache).map(d=>path.join(cache,d,'node_modules')):[])].filter(Boolean)
const locate=name=>{const dir=candidates.find(p=>fs.existsSync(path.join(p,name.split('/')[0],'package.json')));if(!dir)throw Error(`Preview needs ${name}; set DSH_PREVIEW_NODE_MODULES to a development node_modules folder.`);return createRequire(path.join(dir,'_preview.cjs')).resolve(name)}
const {build}=await import(pathToFileURL(locate('esbuild')))
const result=await build({stdin:{contents:`import React from ${JSON.stringify(locate('react'))}; import {createRoot} from ${JSON.stringify(locate('react-dom/client'))}; window.PreviewReact=React; window.PreviewCreateRoot=createRoot;`,resolveDir:root},bundle:true,write:false,minify:true,define:{'process.env.NODE_ENV':'"production"'},format:'iife'})
const runtime=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')
const source=fs.readFileSync(path.join(root,'client.js'),'utf8').replace(/<\/script/gi,'<\\/script')
const boot=fs.readFileSync(path.join(root,'tools/preview-src/boot.js'),'utf8')
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>简洁审批 · 预览</title>
<style>body{background:#f7f7f5;color:#222;font:14px/1.6 -apple-system,sans-serif;margin:0;padding:32px 16px}main{max-width:760px;margin:auto}h1{font-size:22px;margin:0 0 4px}.note{color:#777;margin:0 0 24px}.case{margin:22px 0 6px;color:#777;font-size:12px}#results{padding:12px;font-size:13px;white-space:pre-wrap}button{font:inherit}.test-tools{margin-top:20px}.dark{--dsw-alias-label-primary:#eee;--dsw-alias-label-secondary:#bbb;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-border-l2:#444;--dsw-specific-input-major:#262626;--dsw-alias-bg-layer-2:#333;background:#191919;color:#eee}.dark .note,.dark .case{color:#aaa}</style>
<main><h1>简洁审批</h1><p class="note">插件真实组件。此页仅演示界面，按钮不会执行命令。</p><div id="root"></div></main>
<script>${runtime}</script><script>window.__ModuleLoader__={load:({factory})=>{window.previewPlugin=factory(name=>name==='react'?window.PreviewReact:null)}};</script><script>${source}</script><script>${boot}</script></html>`
fs.mkdirSync(path.join(root,'preview'),{recursive:true})
fs.writeFileSync(path.join(root,'preview/cards.html'),html)
fs.writeFileSync(path.join(root,'preview/cards-dark.html'),html.replace('<main>','<script>document.body.classList.add("dark")</script><main>'))
console.log('✓ Light and dark previews built with real React')
