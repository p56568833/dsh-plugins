#!/usr/bin/env bash
# Re-apply the local patch to dsh-balance-widget 0.6.3 (macOS / Linux).
set -euo pipefail

PROFILE="${1:-desktop}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$HOME/.dsh/profiles/$PROFILE/node_modules/dsh-balance-widget"
PATCH_FILE="$ROOT/third-party/patches/dsh-balance-widget-0.6.3-subagent-cost.patch"

[ -f "$PKG/package.json" ] || { echo "error: dsh-balance-widget is not installed in profile '$PROFILE'" >&2; exit 1; }
VERSION="$(node -p "require('$PKG/package.json').version")"
[ "$VERSION" = "0.6.3" ] || { echo "error: this patch targets 0.6.3, found $VERSION" >&2; exit 1; }

if git -C "$PKG" apply -R --check "$PATCH_FILE" >/dev/null 2>&1; then
  echo "already patched"
  exit 0
fi

git -C "$PKG" apply "$PATCH_FILE"
echo "patch applied to dsh-balance-widget $VERSION; restart DSH completely"
