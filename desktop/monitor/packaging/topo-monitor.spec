# rpm for topo-monitor, built by build-rpm.sh from an already built binary
# (target/release/topo-monitor): nothing is compiled here.
# Defines passed in: topo_version, topo_src (the folder holding the files).
%global debug_package %{nil}
%global __os_install_post %{nil}

Name:           topo-monitor
Version:        %{topo_version}
Release:        1
Summary:        Topo site monitor with no screen
License:        AGPL-3.0-or-later
URL:            https://topo.carino.systems
Requires(pre):  shadow-utils
Requires:       systemd

%description
The Topo desktop app's monitor as a service for a box with no desktop: it
asks the devices of one network whether they answer and reports through a
Topo server, sealed with the network's key. Its files are in
/var/lib/topo-monitor. The service is not started on install: enrol the box
first (sudo -u topo-monitor topo-monitor request), then
systemctl enable --now topo-monitor.

%install
install -D -m 0755 %{topo_src}/topo-monitor %{buildroot}%{_bindir}/topo-monitor
install -D -m 0644 %{topo_src}/topo-monitor.service %{buildroot}/usr/lib/systemd/system/topo-monitor.service
install -D -m 0644 %{topo_src}/topo-monitor.sysusers %{buildroot}/usr/lib/sysusers.d/topo-monitor.conf
install -d -m 0700 %{buildroot}%{_sharedstatedir}/topo-monitor
install -D -m 0644 %{topo_src}/README.txt %{buildroot}%{_docdir}/topo-monitor/README.txt
install -D -m 0644 %{topo_src}/LICENSE %{buildroot}%{_licensedir}/topo-monitor/LICENSE

%pre
# The user first, so /var/lib/topo-monitor can belong to it.
getent group topo-monitor >/dev/null || groupadd -r topo-monitor
getent passwd topo-monitor >/dev/null || useradd -r -g topo-monitor -d /var/lib/topo-monitor -s /usr/sbin/nologin -c "Topo site monitor" topo-monitor
exit 0

%post
systemctl daemon-reload >/dev/null 2>&1 || :
exit 0

%preun
# Removal (not upgrade): stop and disable.
if [ "$1" -eq 0 ]; then
    systemctl --no-reload disable --now topo-monitor.service >/dev/null 2>&1 || :
fi
exit 0

%postun
systemctl daemon-reload >/dev/null 2>&1 || :
# Upgrade: a running monitor restarts on the new binary.
if [ "$1" -ge 1 ]; then
    systemctl try-restart topo-monitor.service >/dev/null 2>&1 || :
fi
exit 0

%files
%{_bindir}/topo-monitor
/usr/lib/systemd/system/topo-monitor.service
/usr/lib/sysusers.d/topo-monitor.conf
%dir %attr(0700,topo-monitor,topo-monitor) %{_sharedstatedir}/topo-monitor
%doc %{_docdir}/topo-monitor/README.txt
%license %{_licensedir}/topo-monitor/LICENSE
