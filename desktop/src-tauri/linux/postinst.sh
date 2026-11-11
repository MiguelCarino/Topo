#!/bin/sh
# Topo desktop rpm %post / deb postinst (tauri.conf.json bundle.linux).
# Enables and starts NOTHING: the server unit stays off until the person
# says "Use this PC as the server" in the app (docs/SCOPE.md D125). An
# upgrade restarts a server that is already running, so it runs the new
# binary (try-restart does nothing to a stopped unit).
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl try-restart topo-desktop-server.service >/dev/null 2>&1 || true
fi
exit 0
