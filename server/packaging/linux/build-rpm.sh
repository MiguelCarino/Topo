#!/usr/bin/env bash
# Builds the Topo server rpm from an already built binary (D112).
#
#   packaging/linux/build-rpm.sh VERSION ARCH      ARCH: amd64 | arm64
#
# Run from server/ (the Makefile's `rpm` target does). Needs rpmbuild only:
# nothing is compiled, the static binary dist/topo-server-linux-ARCH is
# packed as it is. Writes dist/topo-server-VERSION-1.<rpm arch>.rpm. The
# rpm is not signed (docs/SERVER.md, "Signing").
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 VERSION amd64|arm64" >&2; exit 2; }
VERSION="$1"; ARCH="$2"
case "$ARCH" in
    amd64) RPMARCH=x86_64 ;;
    arm64) RPMARCH=aarch64 ;;
    *) echo "unknown arch $ARCH (amd64 or arm64)" >&2; exit 2 ;;
esac
case "$VERSION" in *-*|'') echo "bad rpm version '$VERSION' (no dashes)" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="$(cd "$HERE/../.." && pwd)"
BIN="$SERVER/dist/topo-server-linux-$ARCH"
[ -x "$BIN" ] || { echo "missing $BIN (make cross, or make rpm builds it)" >&2; exit 1; }
command -v rpmbuild >/dev/null || { echo "rpmbuild is not installed" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/topo-rpm.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
SRC="$WORK/src"
mkdir -p "$SRC" "$WORK/top"
cp "$BIN" "$SRC/topo-server"
cp "$HERE/topo-server.service" "$HERE/topo.sysusers" "$HERE/topo.env" "$HERE/backup-folder.conf.example" "$SRC/"
cp "$SERVER/../docs/SERVER.md" "$SERVER/../LICENSE" "$SRC/"

rpmbuild -bb --quiet \
    --target "$RPMARCH" \
    --define "_topdir $WORK/top" \
    --define "topo_version $VERSION" \
    --define "topo_src $SRC" \
    --define "source_date_epoch_from_changelog 0" \
    "$HERE/topo-server.spec"

OUT="$(find "$WORK/top/RPMS" -name '*.rpm' | head -n1)"
[ -n "$OUT" ] || { echo "rpmbuild made no rpm" >&2; exit 1; }
mkdir -p "$SERVER/dist"
cp "$OUT" "$SERVER/dist/"
echo "$SERVER/dist/$(basename "$OUT")"
