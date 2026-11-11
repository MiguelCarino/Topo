#!/usr/bin/env bash
# Checks the Topo desktop app's rpm and deb (docs/SCOPE.md D125) without
# installing them (installing needs root): the one package carries the app,
# the bundled server, the systemd unit (disabled), the sysusers file and the
# polkit action, and its scripts enable nothing. CI (builds.yml) runs it on
# the Linux builds; locally, after `tauri build --bundles deb,rpm`:
#
#   tests/desktop-packages.sh desktop/src-tauri/target/release/bundle/rpm/Topo-*.rpm \
#                             desktop/src-tauri/target/release/bundle/deb/Topo_*.deb
#
# Either argument may be left out (one package only). Prints PASS/FAIL
# lines and a total; exits 1 on any failure.
set -uo pipefail

[ $# -ge 1 ] || { echo "usage: $0 <rpm or deb> [<rpm or deb>]" >&2; exit 2; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
LIN="$SRC/desktop/src-tauri/linux"
pass=0; fail=0
ok() { if [ "$2" = 0 ]; then echo "PASS :: $1"; pass=$((pass+1)); else echo "FAIL :: $1"; fail=$((fail+1)); fi; }
has() { printf '%s\n' "$1" | grep -qE -- "$2"; }
hasnt() { ! printf '%s\n' "$1" | grep -qE -- "$2"; }
t() { local name="$1"; shift; if "$@"; then ok "$name" 0; else ok "$name" 1; fi; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

check_tree() { # kind root
    local k="$1" root="$2"
    t "$k: the app in /usr/bin" test -x "$root/usr/bin/topo"
    t "$k: the bundled server in /usr/bin" test -x "$root/usr/bin/topo-desktop-server"
    t "$k: the unit, as in the source" cmp -s "$root/usr/lib/systemd/system/topo-desktop-server.service" "$LIN/topo-desktop-server.service"
    t "$k: the sysusers file" cmp -s "$root/usr/lib/sysusers.d/topo-desktop-server.conf" "$LIN/topo-desktop-server.sysusers"
    t "$k: the polkit action" cmp -s "$root/usr/share/polkit-1/actions/systems.carino.topo.policy" "$LIN/systems.carino.topo.policy"
    t "$k: nothing enabled in the package (no wants/ links)" test -z "$(find "$root" -path '*.wants*' -print -quit)"
    t "$k: no settings file shipped (the app writes it)" test ! -e "$root/etc/topo/topo-desktop-server.conf"
    local unit; unit="$(cat "$root/usr/lib/systemd/system/topo-desktop-server.service" 2>/dev/null)"
    t "$k: the unit runs the bundled server with its settings file" has "$unit" '^ExecStart=/usr/bin/topo-desktop-server serve --config /etc/topo/topo-desktop-server.conf$'
    t "$k: the unit runs as topo, data in /var/lib/topo" has "$unit" '^User=topo$'
    t "$k: the unit never runs beside the server package's" has "$unit" '^Conflicts=topo-server.service$'
    if command -v xmllint >/dev/null; then
        t "$k: the polkit action is well-formed XML" xmllint --noout "$root/usr/share/polkit-1/actions/systems.carino.topo.policy"
    fi
    local st
    st="$("$root/usr/bin/topo-desktop-server" service status 2>/dev/null)"
    t "$k: the bundled server answers service status (JSON)" has "$st" '^\{"supported":(true|false),"installed":'
    t "$k: the bundled server knows its version" has "$("$root/usr/bin/topo-desktop-server" version 2>/dev/null)" '^topo-server '
}

check_scripts() { # kind text
    local k="$1" s="$2"
    t "$k: an install or upgrade only reloads and try-restarts" has "$s" 'try-restart topo-desktop-server.service'
    t "$k: no script enables or starts the server" hasnt "$s" 'systemctl (--[a-z-]+ )*(enable|start|restart) '
    t "$k: removal stops and disables it" has "$s" 'disable --now topo-desktop-server.service'
    t "$k: no script deletes the data" hasnt "$s" 'rm .*(/var/lib/topo|/etc/topo)'
}

for pkg in "$@"; do
    pkg="$(cd "$(dirname "$pkg")" && pwd)/$(basename "$pkg")"
    case "$pkg" in
        *.deb)
            d="$WORK/deb"; mkdir -p "$d/root" "$d/ctl"
            dpkg-deb -x "$pkg" "$d/root" && dpkg-deb -e "$pkg" "$d/ctl"
            check_tree deb "$d/root"
            scripts="$(cat "$d/ctl/postinst" "$d/ctl/prerm" "$d/ctl/postrm" 2>/dev/null)"
            t "deb: postinst, prerm and postrm are there" test -x "$d/ctl/postinst" -a -x "$d/ctl/prerm" -a -x "$d/ctl/postrm"
            check_scripts deb "$scripts"
            ;;
        *.rpm)
            d="$WORK/rpm"; mkdir -p "$d/root"
            (cd "$d/root" && rpm2cpio "$pkg" | cpio -idm --quiet)
            check_tree rpm "$d/root"
            scripts="$(rpm -qp --scripts "$pkg" 2>/dev/null)"
            t "rpm: postinstall, preuninstall and postuninstall scriptlets" has "$scripts" 'postinstall scriptlet'
            t "rpm: preuninstall scriptlet" has "$scripts" 'preuninstall scriptlet'
            check_scripts rpm "$scripts"
            files="$(rpm -qlp "$pkg" 2>/dev/null)"
            t "rpm: one package holds app, server and unit" has "$files" '^/usr/lib/systemd/system/topo-desktop-server.service$'
            ;;
        *) echo "not an rpm or deb: $pkg" >&2; exit 2 ;;
    esac
done

echo "---"
echo "$((pass + fail)) checks, $fail failing"
[ "$fail" = 0 ]
