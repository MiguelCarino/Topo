#!/bin/sh
# Topo desktop rpm %postun / deb postrm (tauri.conf.json bundle.linux).
# The data in /var/lib/topo is never deleted, not even on purge: it holds
# the networks and the server key.
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
fi
exit 0
