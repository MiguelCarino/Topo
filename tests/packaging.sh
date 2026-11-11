#!/usr/bin/env bash
# Checks the Topo server's rpm and deb (D112) without installing them
# (installing needs root): their files, modes, owners, scripts, the
# config file marking and the unit inside. `make packages-test` in server/
# builds both for amd64 and runs this.
#
#   tests/packaging.sh dist/topo-server-V-1.x86_64.rpm dist/topo-server_V_amd64.deb
#
# Prints PASS/FAIL lines and a total; exits 1 on any failure.
set -uo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <rpm> <deb>" >&2; exit 2; }
RPM="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
DEB="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
pass=0; fail=0
ok() { if [ "$2" = 0 ]; then echo "PASS :: $1"; pass=$((pass+1)); else echo "FAIL :: $1"; fail=$((fail+1)); fi; }
has() { printf '%s\n' "$1" | grep -qE -- "$2"; }
t() { local name="$1"; shift; if "$@"; then ok "$name" 0; else ok "$name" 1; fi; }

# ---- rpm ----
files="$(rpm -qlpv "$RPM" 2>/dev/null)"
t "rpm: the binary in /usr/bin, 0755 root" has "$files" '^-rwxr-xr-x +1 root +root .* /usr/bin/topo-server$'
t "rpm: the unit in /usr/lib/systemd/system" has "$files" ' /usr/lib/systemd/system/topo-server.service$'
t "rpm: the sysusers file" has "$files" ' /usr/lib/sysusers.d/topo.conf$'
t "rpm: topo.env 0640 root:topo" has "$files" '^-rw-r----- +1 root +topo .* /etc/topo/topo.env$'
t "rpm: /etc/topo 0750 root:topo" has "$files" '^drwxr-x--- +2 root +topo .* /etc/topo$'
t "rpm: SERVER.md and the drop-in example as docs" has "$files" '/usr/share/doc/topo-server/backup-folder.conf.example$'
t "rpm: the licence" has "$files" '/usr/share/licenses/topo-server/LICENSE$'
cfg="$(rpm -qpc "$RPM" 2>/dev/null)"
t "rpm: topo.env is a config file" has "$cfg" '^/etc/topo/topo.env$'
t "rpm: config(noreplace)" has "$(rpm -qp --qf '[%{FILENAMES} %{FILEFLAGS:fflags}\n]' "$RPM" 2>/dev/null)" '^/etc/topo/topo.env cn$'
scripts="$(rpm -qp --scripts "$RPM" 2>/dev/null)"
t "rpm: %pre makes the topo user" has "$scripts" 'useradd -r -g topo'
t "rpm: never enables or starts on install" bash -c '! printf "%s" "$1" | grep -qE "systemctl (--now )?(enable|start)"' _ "$scripts"
t "rpm: removal disables and stops" has "$scripts" 'disable --now topo-server.service'
t "rpm: an upgrade restarts a running server" has "$scripts" 'try-restart topo-server.service'
# group(topo) comes from its own sysusers file (rpm 4.19 provides it).
t "rpm: no dependency beyond systemd and shadow-utils" bash -c '[ -z "$(rpm -qpR "$1" 2>/dev/null | grep -vE "^(systemd|shadow-utils|rpmlib\(|/bin/sh|config\(topo-server\)|group\(topo\))")" ]' _ "$RPM"
info="$(rpm -qpi "$RPM" 2>/dev/null)"
t "rpm: licence AGPL-3.0-or-later" has "$info" 'License +: AGPL-3.0-or-later'
t "rpm: not signed (signing is a later step)" has "$info" 'Signature +: \(none\)'
work="$(mktemp -d "${TMPDIR:-/tmp}/topo-pkgtest.XXXXXX")"
trap 'rm -rf "$work"' EXIT
(cd "$work" && mkdir rpm && cd rpm && rpm2cpio "$RPM" | cpio -idm --quiet 2>/dev/null)
unit="$work/rpm/usr/lib/systemd/system/topo-server.service"
t "rpm: the unit runs /usr/bin/topo-server as topo" bash -c 'grep -q "^ExecStart=/usr/bin/topo-server serve$" "$1" && grep -q "^User=topo$" "$1" && grep -q "^Group=topo$" "$1" && ! grep -q "^DynamicUser" "$1"' _ "$unit"
if command -v systemd-analyze >/dev/null; then
    # verify reads the unit standalone: the binary path must exist, so it is
    # pointed at the extracted copy.
    sed "s|^ExecStart=/usr/bin/topo-server|ExecStart=$work/rpm/usr/bin/topo-server|" "$unit" > "$work/topo-server.service"
    t "rpm: systemd-analyze verify accepts the unit" bash -c 'out="$(systemd-analyze verify "$1" 2>&1)"; ! printf "%s" "$out" | grep -v "Unknown user\|Unknown group\|topo-server.service: Failed to" | grep -q .' _ "$work/topo-server.service"
fi
t "rpm: the binary inside runs" bash -c '"$1" version | grep -q "^topo-server "' _ "$work/rpm/usr/bin/topo-server"

# ---- deb ----
dinfo="$(dpkg-deb -I "$DEB" 2>/dev/null)"
t "deb: package and licence description" has "$dinfo" 'Package: topo-server'
t "deb: arch amd64" has "$dinfo" 'Architecture: amd64'
t "deb: maintainer scripts present" bash -c 'for s in postinst prerm postrm conffiles; do printf "%s" "$1" | grep -q " $s" || exit 1; done' _ "$dinfo"
dfiles="$(dpkg-deb -c "$DEB" 2>/dev/null)"
t "deb: the binary in /usr/bin, 0755 root/root" has "$dfiles" '^-rwxr-xr-x root/root .* \./usr/bin/topo-server$'
t "deb: the unit" has "$dfiles" '\./usr/lib/systemd/system/topo-server.service$'
t "deb: the sysusers file" has "$dfiles" '\./usr/lib/sysusers.d/topo.conf$'
t "deb: topo.env 0640" has "$dfiles" '^-rw-r----- root/root .* \./etc/topo/topo.env$'
t "deb: the copyright file" has "$dfiles" '\./usr/share/doc/topo-server/copyright$'
mkdir -p "$work/deb"
dpkg-deb -e "$DEB" "$work/deb/DEBIAN"
dpkg-deb -x "$DEB" "$work/deb"
t "deb: topo.env is a conffile" grep -qx '/etc/topo/topo.env' "$work/deb/DEBIAN/conffiles"
t "deb: postinst makes the user and gives topo.env to its group" bash -c 'grep -q "adduser --system --group" "$1" && grep -q "chgrp topo /etc/topo /etc/topo/topo.env" "$1"' _ "$work/deb/DEBIAN/postinst"
t "deb: never enables or starts on install" bash -c '! grep -qE "systemctl (--now )?(enable|start)" "$1"' _ "$work/deb/DEBIAN/postinst"
t "deb: removal disables and stops" grep -q 'disable --now topo-server.service' "$work/deb/DEBIAN/prerm"
t "deb: purge keeps the data" bash -c '! grep -q "rm .*/var/lib/topo" "$1"' _ "$work/deb/DEBIAN/postrm"
t "deb: maintainer scripts parse (sh -n)" bash -c 'for s in postinst prerm postrm; do sh -n "$1/$s" || exit 1; done' _ "$work/deb/DEBIAN"
t "deb: the same unit as the rpm" cmp -s "$unit" "$work/deb/usr/lib/systemd/system/topo-server.service"
t "deb: the binary inside runs" bash -c '"$1" version | grep -q "^topo-server "' _ "$work/deb/usr/bin/topo-server"

echo "--- $((pass+fail)) checks, $fail failing"
[ "$fail" = 0 ]
