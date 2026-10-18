# dsh-todo-bar

把 DSH 自带的「任务」卡片（输入框上方那张，`@deepseek-ai/dsh-tool-todo` 的清单）换成**对话顶部的一条分段进度条**。

- **顶部一条**：`2/5 · 当前正在做的那一项`，下面一排小格，一格一个任务（完成 = DeepSeek 蓝，进行中 = 带流光的半格，待办 = 灰）
- **点一下才展开**：完整清单以浮窗形式向下展开；鼠标悬停只变色、不弹出。点浮窗外面或按 Esc 关闭
- **全部完成**：整条变绿、显示 `✓ 5/5 全部完成`，停 6 秒后淡出（鼠标停在上面或浮窗开着时不走）。同一份已完成清单刷新页面后不会再冒出来
- 没有任务时整条不显示；发下一条消息时 DSH 会清空清单，进度条也跟着消失
- 原来输入框上方的卡片被隐藏；**停用本插件，原卡片自动回来**（隐藏规则只在本插件在场时生效）
- 和 dsh-story-progress 共存：它右上角的卡片会自动挪到进度条下面，不重叠
- 用 DSH 自己的设计变量，深色 / 浅色跟随主题；配 dsh-claude-style 的 DeepSeek 品牌时就是 #4D6BFE

预览：`docs/run.png`（进行中）、`docs/open.png`（展开）、`docs/done.png`（完成）、`docs/dark-open.png`（深色）

## 怎么接上的

不改 DSH 本体，也不改任何别人的包：

- 数据：在 `conversation.input.dock` 槽里登记一行（和原生 `TodoDock` 同一个槽），从槽位给的 `useProjection('todos')` 读同一份 `todos` 投影
- 位置：从槽里的隐藏锚点找到本会话的聊天区 `[data-conversation-region="chat"]`，把进度条挂进去，宽度跟随 `--dsh-chat-content-width`
- 隐藏原卡片：聊天区带 `data-dtb-alive` 时，样式表隐藏 `[data-testid="todo-panel"]`

## 安装（已经装好）

`~/.dsh/profiles/desktop/package.json` 里加了依赖 `"dsh-todo-bar": "link:…/DSH插件/dsh-todo-bar"` 和 `dsh.profile.bundles` 一项，`node_modules/dsh-todo-bar` 是指向本文件夹的软链。新加的插件要**完全退出再重开 DeepSeek Harness** 才会加载；之后改 client.js 按 Cmd+R 刷新即可。

想换回原样：在插件页停用「任务进度条」，或者把上面两处删掉。

## 测试

```
node verify.mjs
```
