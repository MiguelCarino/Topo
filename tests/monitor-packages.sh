#!/usr/bin/env bash
# Checks topo-monitor's release packages (docs/SCOPE.md D461) without
# installing them (installing needs root): the tar.gz, the rpm and the deb,
# their files, modes, owners, scripts and the unit inside. `make
# packages-test` in desktop/monitor builds them and runs this.
#
#   tests/monitor-packages.sh DIST VERSION ARCH        ARCH: amd64 | arm64
#
# A package whose tool is not on this machine (rpm, dpkg-deb) is said and
# skipped. Prints PASS/FAIL lines and a total; exits 1 on any failure.
set -uo pipefail

[ $# -eq 3 ] || { echo "usage: $0 <dist folder> <version> amd64|arm64" >&2; exit 2; }
DIST="$(cd "$1" && pwd)"; VERSION="$2"; ARCH="$3"
case "$ARCH" in amd64) RPMARCH=x86_64 ;; arm64) RPMARCH=aarch64 ;; *) echo "unknown arch $ARCH" >&2; exit 2 ;; esac
TAR="$DIST/topo-monitor-$VERSION-linux-$ARCH.tar.gz"
RPM="$DIST/topo-monitor-$VERSION-1.$RPMARCH.rpm"
DEB="$DIST/topo-monitor_${VERSION}_${ARCH}.deb"
pass=0; fail=0
ok() { if [ "$2" = 0 ]; then echo "PASS :: $1"; pass=$((pass+1)); else echo "FAIL :: $1"; fail=$((fail+1)); fi; }
has() { printf '%s\n' "$1" | grep -qE -- "$2"; }
t() { local name="$1"; shift; if "$@"; then ok "$name" 0; else ok "$name" 1; fi; }
work="$(mktemp -d "${TMPDIR:-/tmp}/topo-monitor-pkgtest.XXXXXX")"
trap 'rm -rf "$work"' EXIT
runs() { [ "$("$1" --version 2>/dev/null)" = "topo-monitor $VERSION" ]; }
# A unit as packed: what it runs, as whom, where it keeps its files, and
# that it waits for the box to be enrolled.
unit_ok() {
    grep -q '^ExecStart=/usr/bin/topo-monitor run$' "$1" && grep -q '^User=topo-monitor$' "$1" && grep -q '^Group=topo-monitor$' "$1" \
        && grep -q '^StateDirectory=topo-monitor$' "$1" && grep -q '^Environment=TOPO_MONITOR_DIR=%S/topo-monitor$' "$1" \
        && grep -q '^ConditionPathExists=/var/lib/topo-monitor/link.json$' "$1" && grep -q '^NoNewPrivileges=yes$' "$1" \
        && grep -q '^CapabilityBoundingSet=$' "$1" && ! grep -q '^DynamicUser' "$1"
}

# systemd-analyze verify on a unit file: what it says about this unit must be
# nothing. It also loads the machine's other units and reports their faults
# (a build runner has some), so only the lines naming this file count; and
# the user and group are not on this machine, nor the folder the unit waits
# for, which is said and is no fault. What is left is printed.
unit_verifies() {
    local out left
    out="$(systemd-analyze verify "$1" "$2" 2>&1)"
    left="$(printf '%s\n' "$out" | grep -F "$(basename "$2")" | grep -v 'Unknown user\|Unknown group\|Failed to\|not found')"
    [ -z "$left" ] && return 0
    printf '       %s\n' "$left" | head -5
    return 1
}

# ---- tar.gz ----
t "tar: the file is there" test -f "$TAR"
tfiles="$(tar -tvzf "$TAR" 2>/dev/null)"
top="topo-monitor-$VERSION-linux-$ARCH"
t "tar: one folder named for the version and the system" bash -c '[ "$(tar -tzf "$1" | cut -d/ -f1 | sort -u)" = "$2" ]' _ "$TAR" "$top"
t "tar: the binary, 0755, owned by nobody in particular" has "$tfiles" "^-rwxr-xr-x 0/0 .* $top/topo-monitor$"
t "tar: the unit for one user and the system one" bash -c 'printf "%s" "$1" | grep -q "/topo-monitor.user.service$" && printf "%s" "$1" | grep -q "/topo-monitor.service$"' _ "$tfiles"
t "tar: the README and the licence" bash -c 'printf "%s" "$1" | grep -q "/README.txt$" && printf "%s" "$1" | grep -q "/LICENSE$"' _ "$tfiles"
t "tar: nothing else" bash -c '[ "$(tar -tzf "$1" | grep -vc "/$")" = 5 ]' _ "$TAR"
mkdir -p "$work/tar" && tar -xzf "$TAR" -C "$work/tar" 2>/dev/null
t "tar: the binary inside runs and says its version" runs "$work/tar/$top/topo-monitor"
t "tar: the README says how to enrol" grep -q 'topo-monitor enroll FILE' "$work/tar/$top/README.txt"
t "tar: the user unit runs it from ~/.local/bin" grep -q '^ExecStart=%h/.local/bin/topo-monitor run$' "$work/tar/$top/topo-monitor.user.service"
if command -v systemd-analyze >/dev/null; then
    sed "s|^ExecStart=%h/.local/bin/topo-monitor|ExecStart=$work/tar/$top/topo-monitor|" "$work/tar/$top/topo-monitor.user.service" > "$work/topo-monitor-user.service"
    t "tar: systemd-analyze verify accepts the user unit" unit_verifies --user "$work/topo-monitor-user.service"
fi
# Packed twice from the same files, the archive is the same bytes.
t "tar: no time of packing inside (the same files give the same archive)" bash -c '[ "$(TZ=UTC tar -tvzf "$1" | awk "{print \$4}" | sort -u)" = "2020-01-01" ]' _ "$TAR"

# ---- rpm ----
if ! command -v rpm >/dev/null || ! command -v rpm2cpio >/dev/null; then
    echo "SKIP :: rpm: rpm is not on this machine"
elif [ ! -f "$RPM" ]; then
    ok "rpm: the file is there" 1
else
    files="$(rpm -qlpv "$RPM" 2>/dev/null)"
    t "rpm: the binary in /usr/bin, 0755 root" has "$files" '^-rwxr-xr-x +1 root +root .* /usr/bin/topo-monitor$'
    t "rpm: the unit in /usr/lib/systemd/system" has "$files" ' /usr/lib/systemd/system/topo-monitor.service$'
    t "rpm: the sysusers file" has "$files" ' /usr/lib/sysusers.d/topo-monitor.conf$'
    t "rpm: /var/lib/topo-monitor 0700, the monitor's own" has "$files" '^drwx------ +2 topo-mon[a-z]* +topo-mon[a-z]* .* /var/lib/topo-monitor$'
    t "rpm: the README as a doc, the licence" bash -c 'printf "%s" "$1" | grep -q "/usr/share/doc/topo-monitor/README.txt$" && printf "%s" "$1" | grep -q "/usr/share/licenses/topo-monitor/LICENSE$"' _ "$files"
    t "rpm: no settings file (it has none)" bash -c '[ -z "$(rpm -qpc "$1" 2>/dev/null)" ]' _ "$RPM"
    scripts="$(rpm -qp --scripts "$RPM" 2>/dev/null)"
    t "rpm: %pre makes the topo-monitor user" has "$scripts" 'useradd -r -g topo-monitor'
    t "rpm: never enables or starts on install" bash -c '! printf "%s" "$1" | grep -qE "systemctl (--now )?(enable|start)"' _ "$scripts"
    t "rpm: removal disables and stops" has "$scripts" 'disable --now topo-monitor.service'
    t "rpm: an upgrade restarts a running monitor" has "$scripts" 'try-restart topo-monitor.service'
    t "rpm: no script deletes its files" bash -c '! printf "%s" "$1" | grep -q "rm .*topo-monitor"' _ "$scripts"
    # The C library it was built against, found by rpmbuild; nothing of a desktop.
    reqs="$(rpm -qpR "$RPM" 2>/dev/null)"
    t "rpm: it needs the C library it was built against" has "$reqs" '^libc\.so\.6\(GLIBC_'
    t "rpm: nothing of a desktop is needed (no GTK, no WebKit, no X)" bash -c '! printf "%s" "$1" | grep -qiE "gtk|webkit|libX|wayland|glib-2|soup"' _ "$reqs"
    t "rpm: nothing beyond systemd, shadow-utils and the C libraries" bash -c '[ -z "$(printf "%s\n" "$1" | grep -vE "^(systemd|shadow-utils|rpmlib\(|/bin/sh|rtld\(|user\(topo-monitor\)|group\(topo-monitor\)|lib(c|m|gcc_s|pthread|dl|rt)\.so|ld-linux)")" ]' _ "$reqs"
    info="$(rpm -qpi "$RPM" 2>/dev/null)"
    t "rpm: this version, this architecture" bash -c 'printf "%s" "$1" | grep -q "Version *: $2\$" && printf "%s" "$1" | grep -q "Architecture *: $3\$"' _ "$info" "$VERSION" "$RPMARCH"
    t "rpm: licence AGPL-3.0-or-later" has "$info" 'License +: AGPL-3.0-or-later'
    t "rpm: not signed (signing is a later step)" has "$info" 'Signature +: \(none\)'
    (cd "$work" && mkdir rpm && cd rpm && rpm2cpio "$RPM" | cpio -idm --quiet 2>/dev/null)
    unit="$work/rpm/usr/lib/systemd/system/topo-monitor.service"
    t "rpm: the unit runs it as topo-monitor from /var/lib/topo-monitor, once enrolled, with no privilege" unit_ok "$unit"
    if command -v systemd-analyze >/dev/null; then
        sed "s|^ExecStart=/usr/bin/topo-monitor|ExecStart=$work/rpm/usr/bin/topo-monitor|" "$unit" > "$work/topo-monitor.service"
        t "rpm: systemd-analyze verify accepts the unit" unit_verifies --system "$work/topo-monitor.service"
    fi
    t "rpm: the binary inside runs and says its version" runs "$work/rpm/usr/bin/topo-monitor"
    t "rpm: the same binary as the tar.gz" cmp -s "$work/rpm/usr/bin/topo-monitor" "$work/tar/$top/topo-monitor"
fi

# ---- deb ----
if ! command -v dpkg-deb >/dev/null; then
    echo "SKIP :: deb: dpkg-deb is not on this machine"
elif [ ! -f "$DEB" ]; then
    ok "deb: the file is there" 1
else
    dinfo="$(dpkg-deb -I "$DEB" 2>/dev/null)"
    t "deb: the package, this version and architecture" bash -c 'printf "%s" "$1" | grep -q "Package: topo-monitor" && printf "%s" "$1" | grep -q "Version: $2\$" && printf "%s" "$1" | grep -q "Architecture: $3\$"' _ "$dinfo" "$VERSION" "$ARCH"
    t "deb: it depends on the C library it was built against, systemd and adduser" has "$dinfo" 'Depends: libc6 \(>= [0-9]+\.[0-9]+\), systemd, adduser$'
    t "deb: maintainer scripts present, no conffiles" bash -c 'for s in postinst prerm postrm; do printf "%s" "$1" | grep -q " $s" || exit 1; done; ! printf "%s" "$1" | grep -q " conffiles"' _ "$dinfo"
    dfiles="$(dpkg-deb -c "$DEB" 2>/dev/null)"
    t "deb: the binary in /usr/bin, 0755 root/root" has "$dfiles" '^-rwxr-xr-x root/root .* \./usr/bin/topo-monitor$'
    t "deb: the unit and the sysusers file" bash -c 'printf "%s" "$1" | grep -q "\./usr/lib/systemd/system/topo-monitor.service$" && printf "%s" "$1" | grep -q "\./usr/lib/sysusers.d/topo-monitor.conf$"' _ "$dfiles"
    t "deb: the README and the copyright file" bash -c 'printf "%s" "$1" | grep -q "\./usr/share/doc/topo-monitor/README.txt$" && printf "%s" "$1" | grep -q "\./usr/share/doc/topo-monitor/copyright$"' _ "$dfiles"
    mkdir -p "$work/deb"
    dpkg-deb -e "$DEB" "$work/deb/DEBIAN"
    dpkg-deb -x "$DEB" "$work/deb"
    t "deb: postinst makes the user and its folder, 0700" bash -c 'grep -q "adduser --system --group" "$1" && grep -q "install -d -o topo-monitor -g topo-monitor -m 0700 /var/lib/topo-monitor" "$1"' _ "$work/deb/DEBIAN/postinst"
    t "deb: never enables or starts on install" bash -c '! grep -qE "systemctl (--now )?(enable|start)" "$1"' _ "$work/deb/DEBIAN/postinst"
    t "deb: removal disables and stops" grep -q 'disable --now topo-monitor.service' "$work/deb/DEBIAN/prerm"
    t "deb: purge keeps its files" bash -c '! grep -q "^[^#]*rm .*topo-monitor" "$1"' _ "$work/deb/DEBIAN/postrm"
    t "deb: maintainer scripts parse (sh -n)" bash -c 'for s in postinst prerm postrm; do sh -n "$1/$s" || exit 1; done' _ "$work/deb/DEBIAN"
    t "deb: the unit runs it as topo-monitor from /var/lib/topo-monitor, once enrolled, with no privilege" unit_ok "$work/deb/usr/lib/systemd/system/topo-monitor.service"
    t "deb: the binary inside runs and says its version" runs "$work/deb/usr/bin/topo-monitor"
    t "deb: the same binary as the tar.gz" cmp -s "$work/deb/usr/bin/topo-monitor" "$work/tar/$top/topo-monitor"
    [ -f "$work/rpm/usr/lib/systemd/system/topo-monitor.service" ] && t "deb: the same unit as the rpm" cmp -s "$work/rpm/usr/lib/systemd/system/topo-monitor.service" "$work/deb/usr/lib/systemd/system/topo-monitor.service"
fi

echo "--- $((pass+fail)) checks, $fail failing"
[ "$fail" = 0 ]
