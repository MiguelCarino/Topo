#!/bin/sh
# Topo desktop rpm %preun / deb prerm (tauri.conf.json bundle.linux).
# Removing the app (not upgrading it) stops and disables the server unit.
# rpm passes the number of copies left (0 on removal, 1 on upgrade); deb
# passes "remove" or "upgrade". The data in /var/lib/topo and the settings
# in /etc/topo stay (docs/SERVER.md, "Install").
case "$1" in
    0 | remove | deconfigure)
        if [ -d /run/systemd/system ]; then
            systemctl --no-reload disable --now topo-desktop-server.service >/dev/null 2>&1 || true
        fi
        ;;
esac
exit 0
