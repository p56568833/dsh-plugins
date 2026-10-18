# 安装 / 卸载脚本共用：找 node 和 dsh 命令（从访达双击时 PATH 很短，这里补全）
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$HOME/.dsh/bin:$PATH"
APP="/Applications/DeepSeek Harness.app"

find_node() {
  local bundled="$APP/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
  if [ -x "$bundled" ]; then echo "$bundled"; return; fi
  command -v node 2>/dev/null
}

# 输出一条能跑 dsh 的命令（可能是好几个词），找不到就输出空
find_dsh() {
  if command -v dsh >/dev/null 2>&1; then echo "dsh"; return; fi
  local hit
  hit=$(find "$APP/Contents" -maxdepth 7 \( -name dsh -o -name dsh.js \) -perm -u+x 2>/dev/null | head -1)
  if [ -n "$hit" ]; then echo "$hit"; return; fi
  if command -v npm >/dev/null 2>&1 && npm exec --offline --yes @deepseek-ai/dsh -- --version >/dev/null 2>&1; then
    echo "npm exec --offline --yes @deepseek-ai/dsh --"; return
  fi
}

pause() { echo; read -n 1 -s -r -p "按任意键关闭这个窗口…"; echo; }
