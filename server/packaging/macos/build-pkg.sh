#!/usr/bin/env bash
# Builds the Topo server pkg on macOS (pkgbuild and productbuild come with
# Xcode's command line tools). A recipe: not run on the Linux machine that
# wrote it; docs/SERVER.md, "Install on macOS", says so.
#
#   cd server && make macos
#   packaging/macos/build-pkg.sh 1.2.3
#
# Makes a universal binary with lipo (amd64 + arm64), lays out
#   /usr/local/bin/topo-server
#   /Library/LaunchDaemons/systems.carino.topo-server.plist
#   /Library/Application Support/Topo/topo.conf.default
# and writes dist/topo-server-<version>.pkg. Not signed or notarized:
# Developer ID signing (productsign) and notarytool are a later step.
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: $0 VERSION" >&2; exit 2; }
VERSION="$1"
[ "$(uname -s)" = Darwin ] || { echo "build-pkg.sh runs on macOS (pkgbuild, productbuild, lipo)" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="$(cd "$HERE/../.." && pwd)"
for a in amd64 arm64; do
    [ -x "$SERVER/dist/topo-server-darwin-$a" ] || { echo "missing dist/topo-server-darwin-$a (make macos)" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
R="$WORK/root"
mkdir -p "$R/usr/local/bin" "$R/Library/LaunchDaemons" "$R/Library/Application Support/Topo"
lipo -create -output "$R/usr/local/bin/topo-server" "$SERVER/dist/topo-server-darwin-amd64" "$SERVER/dist/topo-server-darwin-arm64"
chmod 0755 "$R/usr/local/bin/topo-server"
install -m 0644 "$HERE/systems.carino.topo-server.plist" "$R/Library/LaunchDaemons/"
install -m 0644 "$HERE/topo.conf" "$R/Library/Application Support/Topo/topo.conf.default"
plutil -lint "$R/Library/LaunchDaemons/systems.carino.topo-server.plist"

mkdir -p "$WORK/scripts"
install -m 0755 "$HERE/scripts/postinstall" "$WORK/scripts/postinstall"

pkgbuild --root "$R" --scripts "$WORK/scripts" \
    --identifier systems.carino.topo-server --version "$VERSION" \
    --install-location / "$WORK/topo-server-component.pkg"
productbuild --package "$WORK/topo-server-component.pkg" \
    --identifier systems.carino.topo-server.installer --version "$VERSION" \
    "$SERVER/dist/topo-server-$VERSION.pkg"
echo "$SERVER/dist/topo-server-$VERSION.pkg"
