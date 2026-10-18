#!/usr/bin/env bash
# Install the 8 self-authored DSH plugins from this repository into a DSH profile.
#
# Usage:
#   ./install/install-macos.sh            # profile "desktop"
#   ./install/install-macos.sh web        # another profile name
#
# Requirements:
#   * DeepSeek Harness installed and started at least once.
#   * The "dsh" command registered (app menu -> "Manage dsh command..." -> Install).
set -euo pipefail

PROFILE="${1:-desktop}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"

PLUGINS=(
  dsh-approval-clear
  dsh-claude-style-addons
  dsh-cost-balance
  dsh-market-sidebar
  dsh-plugin-groups
  dsh-plugin-l10n-zh
  dsh-todo-bar
  dsh-whale-splash
)

if [ ! -d "$PROFILE_DIR" ]; then
  echo "error: DSH profile not found: $PROFILE_DIR" >&2
  echo "Start DeepSeek Harness once on this machine first." >&2
  exit 1
fi

if ! command -v dsh >/dev/null 2>&1; then
  echo "error: 'dsh' command not found on PATH." >&2
  echo "In DSH open the app menu, choose 'Manage dsh command...', install it, then retry." >&2
  exit 1
fi

paths=()
for name in "${PLUGINS[@]}"; do
  dir="$ROOT/plugins/$name"
  if [ ! -f "$dir/package.json" ]; then
    echo "error: plugin package is missing or incomplete: $dir" >&2
    exit 1
  fi
  paths+=("$dir")
done

echo "Repo root : $ROOT"
echo "Profile   : $PROFILE_DIR"
echo "Plugins   : ${#paths[@]}"
for p in "${paths[@]}"; do echo "            $p"; done
echo ""
echo "Running: dsh plugin --profile $PROFILE add <8 paths>"

dsh plugin --profile "$PROFILE" add "${paths[@]}"

echo ""
echo "Done."
echo "Quit DeepSeek Harness completely (Cmd+Q), then start it again."
echo "Optional: install the third-party plugins listed in third-party/plugins.json."
