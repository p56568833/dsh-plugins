#!/bin/bash
# 一键回滚 dsh-whale-splash 到改动前的备份。
# 用法：
#   · 双击运行：自动找最近的一份备份盖回来；
#   · 终端里：  ./回滚.command 某个备份目录
# 只覆盖备份里有的文件，不会删掉现在多出来的文件。回滚后要完全退出 DSH（Cmd+Q）再打开才会生效。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 1

pause() { read -r -p "按回车关闭这个窗口" _; }

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # 先找插件旁边那份（肉眼可见），再找 ~/.dsh/backups
  for dir in "$HERE"/../dsh-whale-splash-备份-* "$HOME"/.dsh/backups/whale-splash-*; do
    [ -d "$dir" ] || continue
    if [ -z "${LATEST:-}" ] || [ "$dir" -nt "$LATEST" ]; then LATEST="$dir"; fi
  done
  TARGET="$LATEST"
fi

if [ -z "${TARGET:-}" ] || [ ! -d "$TARGET" ]; then
  echo "✗ 没找到可用的备份。"
  echo "  插件旁边应该有 dsh-whale-splash-备份-* 或 ~/.dsh/backups/whale-splash-*；"
  echo "  也可以直接把备份目录作为参数给它： ./回滚.command ~/.dsh/backups/whale-splash-20261018-000825"
  pause; exit 1
fi

if [ ! -f "$TARGET/index.js" ] && [ ! -f "$TARGET/assets/splash.js" ]; then
  echo "✗ $TARGET 看起来不像 dsh-whale-splash 的备份（里面没有 index.js / assets/splash.js），没敢动。"
  pause; exit 1
fi

echo "插件目录：$HERE"
echo "还原自：  $TARGET"
echo
read -r -p "确认把这几个文件盖回去？回车继续，Ctrl+C 取消。" _
rsync -a --exclude '.DS_Store' "$TARGET"/ "$HERE"/ || { echo "✗ rsync 失败"; pause; exit 1; }

echo
echo "✓ 已还原。"
echo "  完全退出 DeepSeek Harness（Cmd+Q）再打开，就会变回旧的开屏。"
pause
