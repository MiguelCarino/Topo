topo-monitor: a Topo site's monitor with no screen
===================================================

The desktop app's "Monitor from this PC" as a program that needs no desktop.
It asks the devices of one network whether they answer, keeps statistics, and
reports through a Topo server, sealed with the network's key: the server
cannot read what it sends. It asks for no device's password and scans
nothing.

Set it up
---------

1. On this box:            topo-monitor request
   It prints one line (this box's name and public keys).
2. In Topo, signed in to the server as an owner, with the network open:
   Settings, Monitoring, "A monitor with no screen". Paste the line.
   Topo downloads an enrolment file.
3. On this box:            topo-monitor enroll FILE
   It checks the file was made for this box, asks the server once, keeps it
   and deletes the file (it holds the monitor's credential).
   A server with a self-signed certificate: the command prints the
   certificate's fingerprint to compare with the one the server's Settings
   shows; run it again with --pin FINGERPRINT.
4. Start it:               topo-monitor run

Its checks come from an owner's browser with the network open; it keeps the
last ones and goes on with no browser open. Until an owner has opened the
network once, it reports that it is there and checks nothing.

    topo-monitor status     what is kept here
    topo-monitor forget     forget the keys and the site here
    topo-monitor --version

As a service
------------

From the rpm or deb: it runs as the user topo-monitor with its files in
/var/lib/topo-monitor. Run the three commands above as that user, then
enable it:

    sudo -u topo-monitor topo-monitor request
    sudo -u topo-monitor topo-monitor enroll FILE
    sudo systemctl enable --now topo-monitor

The enrolment file must be readable by that user (put it in /tmp).

From the tar.gz, for one user with no administrator: copy topo-monitor to
~/.local/bin and topo-monitor.user.service to
~/.config/systemd/user/topo-monitor.service, then

    systemctl --user enable --now topo-monitor
    loginctl enable-linger "$USER"

Its files are then in ~/.local/state/topo-monitor (or TOPO_MONITOR_DIR, or
--dir DIR on any command).

Not signed. AGPL-3.0-or-later. https://topo.carino.systems
