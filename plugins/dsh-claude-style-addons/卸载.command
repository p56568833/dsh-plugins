#!/bin/bash
# 双击卸载 dsh-claude-style-addons。想临时关掉某一项，不用卸载：「设置 → Claude Style」里单独关。
cd "$(dirname "$0")" || exit 1
source tools/common.sh
PROFILE="${1:-desktop}"

NODE=$(find_node)
if [ -z "$NODE" ]; then echo "✗ 没找到 node"; pause; exit 1; fi
"$NODE" tools/profile.mjs remove --profile "$PROFILE" || { pause; exit 1; }
DSH=$(find_dsh)
if [ -n "$DSH" ]; then $DSH plugin --profile "$PROFILE" install --offline; fi
echo
echo "✓ 已卸载。完全退出 DeepSeek Harness 再打开，首页问候语回到皮肤原来的英文。"
pause
