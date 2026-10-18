#!/usr/bin/env node
/**
 * dsh-claude-style-addons 离线自检 —— 一次跑完三份：
 *
 *   verify/greeting.mjs    一、中文问候语（原 dsh-cn-greeting 的 24 项，含「皮肤的每条英文模板都有中文台词」）
 *   verify/skin-fixes.mjs  二、皮肤修补（原 dsh-skin-fixes 的 12 项，含选择器优先级压得住皮肤）
 *   verify/settings.mjs    三~五、偏好 / 开关 / Claude Style 设置页（合并后新增）
 *
 * 三份都会对着**已装的** dsh-claude-style 现场核契约：皮肤升级之后跑一遍，哪条契约变了当场报红。
 *
 * 用法：node verify.mjs [--profile desktop]
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const parts = [
  ['一、中文问候语', 'verify/greeting.mjs'],
  ['二、皮肤修补', 'verify/skin-fixes.mjs'],
  ['三~五、偏好 / 开关 / 设置页', 'verify/settings.mjs'],
  ['六、鲸鱼娘素材 / 状态 / 卸载', 'verify/mascot.mjs'],
]

const failed = []
for (const [label, file] of parts) {
  console.log(`\n━━━ ${label}（${file}）━━━`)
  const run = spawnSync(process.execPath, [path.join(HERE, file), ...process.argv.slice(2)], { stdio: 'inherit', cwd: HERE })
  if (run.status !== 0) failed.push(label)
}
console.log(failed.length === 0 ? '\n✅ 全部自检通过' : `\n❌ 没通过：${failed.join('、')}`)
process.exitCode = failed.length === 0 ? 0 : 1
