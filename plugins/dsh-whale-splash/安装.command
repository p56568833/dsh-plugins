#!/bin/bash
# 双击安装 dsh-whale-splash（鲸鱼开场动画）到 DSH 桌面版
cd "$(dirname "$0")" || exit 1
source tools/common.sh
PROFILE="${1:-desktop}"

NODE=$(find_node)
if [ -z "$NODE" ]; then echo "✗ 没找到 node"; pause; exit 1; fi
DSH=$(find_dsh)
if [ -z "$DSH" ]; then
  echo "✗ 没找到 dsh 命令，没有做任何改动。"
  echo "  可以在终端里跑：dsh plugin --profile $PROFILE add \"link:$(pwd)\""
  pause; exit 1
fi

echo "① 登记到 ~/.dsh/profiles/$PROFILE/package.json"
"$NODE" tools/profile.mjs add --profile "$PROFILE" || { pause; exit 1; }
echo
echo "② 让 DSH 建链接、加进插件列表（$DSH plugin --profile $PROFILE install --offline）"
$DSH plugin --profile "$PROFILE" install --offline || echo "… 这一步报错了（上面是原因），接着试手动补链接"
echo
# ③ 兜底：有些情况下 install 只登记了插件、没建 node_modules 里的链接（DSH 就会报 cannot resolve profile bundle）。
#    跟其他自制插件一样，手动补一条指向本文件夹的软链。
LINK="$HOME/.dsh/profiles/$PROFILE/node_modules/dsh-whale-splash"
if [ -e "$LINK/package.json" ]; then
  echo "③ node_modules 链接已就位：$LINK"
else
  echo "③ node_modules 里没有链接，补一条：$LINK → $(pwd)"
  mkdir -p "$(dirname "$LINK")"
  [ -L "$LINK" ] && rm "$LINK"  # 只删坏掉的软链，不碰真文件夹
  if [ -e "$LINK" ]; then echo "✗ $LINK 已经存在且不是软链，没敢动它"; pause; exit 1; fi
  ln -s "$(pwd)" "$LINK" || { echo "✗ 建软链失败"; pause; exit 1; }
fi
echo
if [ -e "$LINK/package.json" ] && $DSH --profile "$PROFILE" --dump-config 2>/dev/null | grep -q "dsh-whale-splash"; then
  echo "✓ 装好了。完全退出 DeepSeek Harness（Cmd+Q）再打开，就能看到鲸鱼开场。"
else
  echo "… 链接已就位，但没能确认它进了插件列表。重开 DSH 看看，不行就把这个窗口的内容发给 Claude。"
fi
pause
