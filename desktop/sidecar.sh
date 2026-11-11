#!/usr/bin/env bash
# Builds the topo-server the desktop app bundles (D113, "This PC as the
# server") and puts it where Tauri's bundle.externalBin looks:
#
#   desktop/src-tauri/binaries/topo-desktop-server-<target triple>[.exe]
#
# Its own name, not topo-server: Tauri's Linux bundler puts a sidecar in
# /usr/bin, where the topo-server rpm/deb installs its own binary.
#
#   desktop/sidecar.sh                      # this machine's Rust target
#   desktop/sidecar.sh aarch64-apple-darwin # another target (CI's matrix)
#
# tauri-build checks at compile time that the file exists, so this runs
# before `cargo build` / `tauri build` (CI does it in builds.yml). Needs Go
# (server/go.mod's version). The server embeds the app's files, staged the
# same way as the desktop app's own copy (desktop/stage.sh, without
# --desktop: the server serves the website's files byte for byte).
#
# Portable to macOS bash 3.2 and Git Bash.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="${1:-}"
if [ -z "$TRIPLE" ]; then
    TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
fi
[ -n "$TRIPLE" ] || { echo "no target triple (is rustc installed?)" >&2; exit 1; }

case "$TRIPLE" in
    x86_64-*-linux-*) GOOS=linux; GOARCH=amd64 ;;
    aarch64-*-linux-*) GOOS=linux; GOARCH=arm64 ;;
    x86_64-apple-darwin) GOOS=darwin; GOARCH=amd64 ;;
    aarch64-apple-darwin) GOOS=darwin; GOARCH=arm64 ;;
    x86_64-pc-windows-*) GOOS=windows; GOARCH=amd64 ;;
    aarch64-pc-windows-*) GOOS=windows; GOARCH=arm64 ;;
    *) echo "unsupported target $TRIPLE" >&2; exit 2 ;;
esac
EXT=""
[ "$GOOS" = windows ] && EXT=".exe"

OUT_DIR="$SRC/desktop/src-tauri/binaries"
OUT="$OUT_DIR/topo-desktop-server-$TRIPLE$EXT"
mkdir -p "$OUT_DIR"

"$SRC/desktop/stage.sh" "$SRC/server/web/dist"
touch "$SRC/server/web/dist/.gitkeep"

VERSION="$(node -p "require('$SRC/desktop/src-tauri/tauri.conf.json').version" 2>/dev/null || echo 0.0.0)"
BUILD="$(git -C "$SRC" describe --always --dirty 2>/dev/null || echo desktop)"
(
    cd "$SRC/server"
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" GOFLAGS=-p=4 \
        go build -trimpath -ldflags "-s -w -X main.version=$VERSION -X main.build=$BUILD" \
        -o "$OUT" ./cmd/topo-server
)
echo "$OUT"
