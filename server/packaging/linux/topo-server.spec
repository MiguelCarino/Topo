# rpm for the Topo server, built by build-rpm.sh from an already built,
# static binary (dist/topo-server-linux-<arch>): nothing is compiled here.
# Defines passed in: topo_version, topo_src (the folder holding the files).
%global debug_package %{nil}
%global __os_install_post %{nil}

Name:           topo-server
Version:        %{topo_version}
Release:        1
Summary:        Topo server: network documentation with email sign-in and encrypted sync
License:        AGPL-3.0-or-later
URL:            https://topo.carino.systems
Requires(pre):  shadow-utils
Requires:       systemd

%description
The Topo server serves the Topo app and its API: email sign-in, sites with
roles and invitations, end-to-end encrypted sync and backups. One static
binary; data in /var/lib/topo; settings in /etc/topo/topo.env. The service
is not started on install: edit /etc/topo/topo.env, then
systemctl enable --now topo-server.

%install
install -D -m 0755 %{topo_src}/topo-server %{buildroot}%{_bindir}/topo-server
install -D -m 0644 %{topo_src}/topo-server.service %{buildroot}/usr/lib/systemd/system/topo-server.service
install -D -m 0644 %{topo_src}/topo.sysusers %{buildroot}/usr/lib/sysusers.d/topo.conf
install -D -m 0640 %{topo_src}/topo.env %{buildroot}%{_sysconfdir}/topo/topo.env
install -D -m 0644 %{topo_src}/SERVER.md %{buildroot}%{_docdir}/topo-server/SERVER.md
install -D -m 0644 %{topo_src}/backup-folder.conf.example %{buildroot}%{_docdir}/topo-server/backup-folder.conf.example
install -D -m 0644 %{topo_src}/LICENSE %{buildroot}%{_licensedir}/topo-server/LICENSE

%pre
# The user first, so /etc/topo/topo.env can belong to its group.
getent group topo >/dev/null || groupadd -r topo
getent passwd topo >/dev/null || useradd -r -g topo -d /var/lib/topo -s /usr/sbin/nologin -c "Topo server" topo
exit 0

%post
systemctl daemon-reload >/dev/null 2>&1 || :
exit 0

%preun
# Removal (not upgrade): stop and disable.
if [ "$1" -eq 0 ]; then
    systemctl --no-reload disable --now topo-server.service >/dev/null 2>&1 || :
fi
exit 0

%postun
systemctl daemon-reload >/dev/null 2>&1 || :
# Upgrade: a running server restarts on the new binary.
if [ "$1" -ge 1 ]; then
    systemctl try-restart topo-server.service >/dev/null 2>&1 || :
fi
exit 0

%files
%{_bindir}/topo-server
/usr/lib/systemd/system/topo-server.service
/usr/lib/sysusers.d/topo.conf
%dir %attr(0750,root,topo) %{_sysconfdir}/topo
%config(noreplace) %attr(0640,root,topo) %{_sysconfdir}/topo/topo.env
%doc %{_docdir}/topo-server/SERVER.md
%doc %{_docdir}/topo-server/backup-folder.conf.example
%license %{_licensedir}/topo-server/LICENSE
