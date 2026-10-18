#!/bin/bash
# 双击安装 dsh-claude-style-addons（Claude Style 补丁）到 DSH 桌面版。
#
# 它是 dsh-claude-style 皮肤的补丁合集，替代原来的两个补丁插件 dsh-cn-greeting、dsh-skin-fixes ——
# 安装时会顺手把那两个从 profile 里摘掉（文件不删）。装好后选项在「设置 → Claude Style」最下面。
cd "$(dirname "$0")" || exit 1
source tools/common.sh
PROFILE="${1:-desktop}"

NODE=$(find_node)
if [ -z "$NODE" ]; then echo "✗ 没找到 node"; pause; exit 1; fi

echo "① 先跑一遍离线自检（对着已装的皮肤核契约）"
"$NODE" verify.mjs --profile "$PROFILE" || { echo "✗ 自检没过，先别装。把上面的红字发出来。"; pause; exit 1; }
echo

echo "② 登记到 ~/.dsh/profiles/$PROFILE/package.json（并摘掉合并前的两个旧补丁）"
"$NODE" tools/profile.mjs add --profile "$PROFILE" || { pause; exit 1; }
echo

DSH=$(find_dsh)
if [ -n "$DSH" ]; then
  echo "③ 让 DSH 建链接、更新锁文件（$DSH plugin --profile $PROFILE install --offline）"
  $DSH plugin --profile "$PROFILE" install --offline || echo "… 这一步报错了（上面是原因），接着试手动补链接"
else
  echo "③ 没找到 dsh 命令，跳过，直接手动补链接"
fi
echo
LINK="$HOME/.dsh/profiles/$PROFILE/node_modules/dsh-claude-style-addons"
if [ -e "$LINK/package.json" ]; then
  echo "④ node_modules 链接已就位：$LINK"
else
  echo "④ node_modules 里没有链接，补一条：$LINK → $(pwd)"
  mkdir -p "$(dirname "$LINK")"
  [ -L "$LINK" ] && rm "$LINK"  # 只删坏掉的软链，不碰真文件夹
  if [ -e "$LINK" ]; then echo "✗ $LINK 已经存在且不是软链，没敢动它"; pause; exit 1; fi
  ln -s "$(pwd)" "$LINK" || { echo "✗ 建软链失败"; pause; exit 1; }
fi
echo
echo "✓ 装好了。完全退出 DeepSeek Harness（Cmd+Q）再打开，选项在「设置 → Claude Style」最下面。"
pause
