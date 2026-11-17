#!/usr/bin/env bash
# Builds topo-monitor's release packages from an already built binary
# (docs/SCOPE.md D459, D461):
#
#   packaging/build.sh VERSION ARCH [tar|rpm|deb ...]     ARCH: amd64 | arm64
#
# Run from desktop/monitor (the Makefile does). Nothing is compiled here:
# target/release/topo-monitor is packed as it is, so ARCH must be the
# machine's that built it. With no kind named, every package whose tool is
# here is made (tar always; rpm needs rpmbuild, deb needs dpkg-deb). No root.
# Writes into dist/:
#
#   topo-monitor-VERSION-linux-ARCH.tar.gz    the binary, both units, README
#   topo-monitor-VERSION-1.<rpm arch>.rpm     a system service, user topo-monitor
#   topo-monitor_VERSION_ARCH.deb             the same
#
# Nothing is signed (docs/SERVER.md, "Signing").
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: $0 VERSION amd64|arm64 [tar|rpm|deb ...]" >&2; exit 2; }
VERSION="$1"; ARCH="$2"; shift 2
case "$ARCH" in
    amd64) RPMARCH=x86_64 ;;
    arm64) RPMARCH=aarch64 ;;
    *) echo "unknown arch $ARCH (amd64 or arm64)" >&2; exit 2 ;;
esac
case "$VERSION" in *-*|'') echo "bad version '$VERSION' (no dashes)" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
MON="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$MON/../.." && pwd)"
BIN="$MON/target/release/topo-monitor"
[ -x "$BIN" ] || { echo "missing $BIN (make build)" >&2; exit 1; }
# The binary must be this version and this machine's architecture.
said="$("$BIN" --version)"
[ "$said" = "topo-monitor $VERSION" ] || { echo "the binary says '$said', not 'topo-monitor $VERSION': build it with TOPO_MONITOR_VERSION=$VERSION" >&2; exit 1; }
case "$(uname -m)" in x86_64) HOST=amd64 ;; aarch64|arm64) HOST=arm64 ;; *) HOST=other ;; esac
[ "$HOST" = "$ARCH" ] || { echo "this machine is $HOST: it cannot pack a $ARCH binary it did not build" >&2; exit 1; }

KINDS=("$@")
if [ ${#KINDS[@]} -eq 0 ]; then
    KINDS=(tar)
    command -v rpmbuild >/dev/null && KINDS+=(rpm)
    command -v dpkg-deb >/dev/null && KINDS+=(deb)
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/topo-monitor-pkg.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
umask 022
mkdir -p "$MON/dist"

# The oldest glibc the binary runs on, from the symbols it asks for.
glibc_floor() {
    objdump -T "$BIN" 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -n1
}

for kind in "${KINDS[@]}"; do
    case "$kind" in
    tar)
        name="topo-monitor-$VERSION-linux-$ARCH"
        d="$WORK/$name"
        mkdir -p "$d"
        install -m 0755 "$BIN" "$d/topo-monitor"
        install -m 0644 "$HERE/topo-monitor.user.service" "$HERE/topo-monitor.service" "$HERE/README.txt" "$ROOT/LICENSE" "$d/"
        # The same bytes for the same files: names in order, no owner, no time of packing.
        tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2020-01-01 00:00:00Z' -C "$WORK" -cf - "$name" | gzip -n -9 > "$MON/dist/$name.tar.gz"
        echo "$MON/dist/$name.tar.gz"
        ;;
    rpm)
        command -v rpmbuild >/dev/null || { echo "rpmbuild is not installed" >&2; exit 1; }
        SRC="$WORK/rpmsrc"
        mkdir -p "$SRC" "$WORK/top"
        cp "$BIN" "$HERE/topo-monitor.service" "$HERE/topo-monitor.sysusers" "$HERE/README.txt" "$ROOT/LICENSE" "$SRC/"
        rpmbuild -bb --quiet \
            --target "$RPMARCH" \
            --define "_topdir $WORK/top" \
            --define "topo_version $VERSION" \
            --define "topo_src $SRC" \
            --define "source_date_epoch_from_changelog 0" \
            "$HERE/topo-monitor.spec"
        OUT="$(find "$WORK/top/RPMS" -name '*.rpm' | head -n1)"
        [ -n "$OUT" ] || { echo "rpmbuild made no rpm" >&2; exit 1; }
        cp "$OUT" "$MON/dist/"
        echo "$MON/dist/$(basename "$OUT")"
        ;;
    deb)
        command -v dpkg-deb >/dev/null || { echo "dpkg-deb is not installed" >&2; exit 1; }
        R="$WORK/debroot"
        install -D -m 0755 "$BIN" "$R/usr/bin/topo-monitor"
        install -D -m 0644 "$HERE/topo-monitor.service" "$R/usr/lib/systemd/system/topo-monitor.service"
        install -D -m 0644 "$HERE/topo-monitor.sysusers" "$R/usr/lib/sysusers.d/topo-monitor.conf"
        install -D -m 0644 "$HERE/README.txt" "$R/usr/share/doc/topo-monitor/README.txt"
        install -D -m 0644 "$ROOT/LICENSE" "$R/usr/share/doc/topo-monitor/copyright"
        mkdir -p "$R/DEBIAN"
        SIZE="$(du -sk --exclude=DEBIAN "$R" | cut -f1)"
        GLIBC="$(glibc_floor)"
        [ -n "$GLIBC" ] || { echo "could not read the binary's glibc version (objdump)" >&2; exit 1; }
        sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" -e "s/@SIZE@/$SIZE/" -e "s/@GLIBC@/$GLIBC/" "$HERE/deb/control.in" > "$R/DEBIAN/control"
        for s in postinst prerm postrm; do
            install -m 0755 "$HERE/deb/$s" "$R/DEBIAN/$s"
        done
        OUT="$MON/dist/topo-monitor_${VERSION}_${ARCH}.deb"
        dpkg-deb --root-owner-group -Zxz --build "$R" "$OUT" >/dev/null
        echo "$OUT"
        ;;
    *) echo "unknown package kind '$kind' (tar, rpm or deb)" >&2; exit 2 ;;
    esac
done
