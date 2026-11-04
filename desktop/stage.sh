#!/usr/bin/env bash
# Copies the files Topo ships into <outdir>, then checks the copy.
#
#   desktop/stage.sh <outdir>             # the offline zip: byte for byte the website
#   desktop/stage.sh <outdir> --desktop   # the Tauri app's frontendDist
#
# An allow-list, not a sweep: only what index.html needs (and the licence)
# is copied, so tests/, docs/, CLAUDE.md, the fleet's site files (CNAME,
# robots.txt, sitemap.xml, 404.html, og.jpg) and the dotfiles a test run
# leaves behind never reach a build. carino-diag.js is left out on purpose:
# the status probe asks other sites how they are, which an offline copy
# cannot do.
#
# --desktop patches the copied index.html and nothing else: the meta CSP's
# connect-src gains Tauri's IPC origins (ipc: on macOS and Linux,
# http://ipc.localhost on Windows). The zip never gets them, because
# *.localhost is loopback in a browser.
#
# Portable to macOS bash 3.2 and Git Bash: no arrays past the basics, no
# sed -i, no GNU-only flags.
set -euo pipefail

usage() { echo "usage: $0 <outdir> [--desktop]" >&2; exit 2; }
[ $# -ge 1 ] || usage
OUT="$1"; shift
DESKTOP=0
while [ $# -gt 0 ]; do
    case "$1" in
        --desktop) DESKTOP=1 ;;
        *) usage ;;
    esac
    shift
done
case "$OUT" in ''|/|.|..) echo "refusing to stage into '$OUT'" >&2; exit 2 ;; esac

SRC="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC/index.html" ] || { echo "no index.html in $SRC" >&2; exit 1; }

ITEMS="index.html css js fonts vendor
carino-clock.js carino-lang.js carino-navbar.js carino-theme.css carino-theme.js carino-ui.css carino-ui.js
logo.svg logo-color.svg logo.webp
LICENSE"

rm -rf "$OUT"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
case "$OUT" in "$SRC"|"$SRC/") echo "refusing to stage over the source" >&2; exit 2 ;; esac

for item in $ITEMS; do
    [ -e "$SRC/$item" ] || { echo "missing from the source: $item" >&2; exit 1; }
    cp -R "$SRC/$item" "$OUT/$item"
done
# Nothing hidden rides along inside the copied folders.
find "$OUT" -mindepth 1 -name '.*' -exec rm -rf {} + 2>/dev/null || true

CSP_FROM="connect-src 'self';"
CSP_TO="connect-src 'self' ipc: http://ipc.localhost;"
if [ "$DESKTOP" = 1 ]; then
    sed "s|$CSP_FROM|$CSP_TO|" "$OUT/index.html" > "$OUT/index.html.tmp"
    mv "$OUT/index.html.tmp" "$OUT/index.html"
fi

fail=0
bad() { echo "stage check: $*" >&2; fail=1; }

# 1. Everything index.html points at is there (and the clock the navbar
#    loads on its own).
refs="$(grep -oE '(src|href)="[^"]*"' "$OUT/index.html" | sed -E 's/^(src|href)="//; s/"$//' | sort -u || true)"
for ref in $refs carino-clock.js; do
    case "$ref" in
        ''|\#*|*:*|//*) continue ;;
    esac
    path="${ref%%\?*}"; path="${path%%#*}"
    [ -e "$OUT/$path" ] || bad "index.html needs $path, which is not staged"
done

# 2. The fleet status probe stays out.
[ ! -e "$OUT/carino-diag.js" ] || bad "carino-diag.js was staged"
grep -q 'carino-diag.js' "$OUT/index.html" && bad "index.html loads carino-diag.js" || true

# 3. Every file is the source's, byte for byte (index.html aside on --desktop).
count=0
while IFS= read -r f; do
    rel="${f#"$OUT"/}"
    count=$((count + 1))
    if [ "$DESKTOP" = 1 ] && [ "$rel" = index.html ]; then continue; fi
    cmp -s "$f" "$SRC/$rel" || bad "$rel differs from the source"
done <<EOF_FILES
$(find "$OUT" -type f)
EOF_FILES

# 4. The CSP patch: exactly once on --desktop, never otherwise.
if [ "$DESKTOP" = 1 ]; then
    n="$(grep -o "connect-src 'self' ipc: http://ipc.localhost;" "$OUT/index.html" | wc -l | tr -d ' ' || true)"
    [ "$n" = 1 ] || bad "the desktop CSP patch matched $n times, not once"
    m="$(grep -o "$CSP_FROM" "$SRC/index.html" | wc -l | tr -d ' ' || true)"
    [ "$m" = 1 ] || bad "the source CSP has connect-src 'self'; $m times, not once"
else
    cmp -s "$OUT/index.html" "$SRC/index.html" || bad "index.html is not the website's"
fi

# 5. No script or stylesheet (or icon, preload, manifest) from another site.
#    A <link rel="canonical"> or rel="alternate" is an address, not a load.
if grep -rhoE '<script[^>]*[[:space:]]src="(https?:)?//[^"]*"' "$OUT" --include='*.html' >/dev/null; then
    bad "a <script> loads from another site"
fi
if grep -rhoE '<link[^>]*>' "$OUT" --include='*.html' | grep -vE 'rel="(canonical|alternate)"' | grep -qE 'href="(https?:)?//'; then
    bad "a <link> loads from another site"
fi

[ "$fail" = 0 ] || { echo "stage check failed for $OUT" >&2; exit 1; }

# 6. What was staged.
size="$(du -sk "$OUT" | cut -f1)"
mode=web; [ "$DESKTOP" = 1 ] && mode=desktop
echo "staged $count files, ${size} KB ($mode) into $OUT"
