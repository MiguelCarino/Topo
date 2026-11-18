topo-monitor: a Topo site's monitor with no screen (Windows)
============================================================

The desktop app's "Monitor from this PC" as a program with no window. It
asks the devices of one network whether they answer, keeps statistics, and
reports through a Topo server, sealed with the network's key: the server
cannot read what it sends. It asks for no device's password and scans
nothing.

It is a command-line program. Unzip it anywhere (for example
C:\Program Files\topo-monitor) and run it from PowerShell or Command Prompt.

Set it up
---------

1. On this PC:             topo-monitor.exe request
   It prints one line (this PC's name and public keys).
2. In Topo, signed in to the server as an owner, with the network open:
   Settings, Monitoring, "A monitor with no screen". Paste the line.
   Topo downloads an enrolment file.
3. On this PC:             topo-monitor.exe enroll FILE
   It checks the file was made for this PC, asks the server once, keeps it
   and deletes the file (it holds the monitor's credential).
   A server with a self-signed certificate: the command prints the
   certificate's fingerprint to compare with the one the server's Settings
   shows; run it again with --pin FINGERPRINT.
4. Start it:               topo-monitor.exe run

Its checks come from an owner's browser with the network open; it keeps the
last ones and goes on with no browser open. Until an owner has opened the
network once, it reports that it is there and checks nothing.

    topo-monitor.exe status     what is kept here
    topo-monitor.exe forget     forget the keys and the site here
    topo-monitor.exe --version

Its files are in %LOCALAPPDATA%\topo-monitor, which belongs to the Windows
user that ran the commands (or in TOPO_MONITOR_DIR, or --dir DIR on any
command). The same user must run every command and the program itself.

Keeping it running
------------------

This build is not a Windows service: it runs for as long as its window, or
the task that started it, does. To start it with Windows and with nobody
signed in, make a scheduled task for the user that enrolled it, from an
administrator PowerShell (it asks for that user's password once):

    schtasks /Create /TN "Topo monitor" /SC ONSTART /RU "%USERNAME%" /RP * ^
        /TR "\"C:\Program Files\topo-monitor\topo-monitor.exe\" run"

    schtasks /Run /TN "Topo monitor"        start it now
    schtasks /End /TN "Topo monitor"        stop it
    schtasks /Delete /TN "Topo monitor"     remove the task

In Task Scheduler, on the task's Settings tab, untick "Stop the task if it
runs longer than" so Windows does not end it after three days. The task
above was written from Windows' documentation and has not been tried.

Not signed: Windows SmartScreen may ask before it runs the first time.
AGPL-3.0-or-later. https://topo.carino.systems
