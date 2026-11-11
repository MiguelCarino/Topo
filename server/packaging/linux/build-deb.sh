#!/usr/bin/env bash
# Builds the Topo server deb from an already built binary (D112).
#
#   packaging/linux/build-deb.sh VERSION ARCH      ARCH: amd64 | arm64
#
# Run from server/ (the Makefile's `deb` target does). Needs dpkg-deb only
# (no root: --root-owner-group). Writes dist/topo-server_VERSION_ARCH.deb.
# The deb is not signed (docs/SERVER.md, "Signing").
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 VERSION amd64|arm64" >&2; exit 2; }
VERSION="$1"; ARCH="$2"
case "$ARCH" in amd64|arm64) ;; *) echo "unknown arch $ARCH (amd64 or arm64)" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="$(cd "$HERE/../.." && pwd)"
BIN="$SERVER/dist/topo-server-linux-$ARCH"
[ -x "$BIN" ] || { echo "missing $BIN (make cross, or make deb builds it)" >&2; exit 1; }
command -v dpkg-deb >/dev/null || { echo "dpkg-deb is not installed" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/topo-deb.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
R="$WORK/root"
umask 022
install -D -m 0755 "$BIN" "$R/usr/bin/topo-server"
install -D -m 0644 "$HERE/topo-server.service" "$R/usr/lib/systemd/system/topo-server.service"
install -D -m 0644 "$HERE/topo.sysusers" "$R/usr/lib/sysusers.d/topo.conf"
install -D -m 0640 "$HERE/topo.env" "$R/etc/topo/topo.env"
install -D -m 0644 "$SERVER/../docs/SERVER.md" "$R/usr/share/doc/topo-server/SERVER.md"
install -D -m 0644 "$HERE/backup-folder.conf.example" "$R/usr/share/doc/topo-server/backup-folder.conf.example"
install -D -m 0644 "$SERVER/../LICENSE" "$R/usr/share/doc/topo-server/copyright"

mkdir -p "$R/DEBIAN"
SIZE="$(du -sk --exclude=DEBIAN "$R" | cut -f1)"
sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" -e "s/@SIZE@/$SIZE/" "$HERE/deb/control.in" > "$R/DEBIAN/control"
install -m 0644 "$HERE/deb/conffiles" "$R/DEBIAN/conffiles"
for s in postinst prerm postrm; do
    install -m 0755 "$HERE/deb/$s" "$R/DEBIAN/$s"
done

mkdir -p "$SERVER/dist"
OUT="$SERVER/dist/topo-server_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group -Zxz --build "$R" "$OUT" >/dev/null
echo "$OUT"
