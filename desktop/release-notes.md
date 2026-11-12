Topo for working offline: the same editor as https://topo.carino.systems/, as a desktop app or as a folder to open in a browser.

## New in 0.0.3

There was no 0.0.2: this release follows 0.0.1.

- **Safer merges.** A part sent to a provider is kept until its copy comes back or its report is closed, however many are out, so every copy back merges against what was sent. Two providers' new devices are never joined by name alone: the review asks, with Add as new as the answer if you do nothing. New records get ids that two PCs cannot both make.
- **Every visit waits for the owner.** A provider's copy back (by link, file, or on a Topo server) waits in **Visits waiting** until an owner reviews it: apply or reject the changes, and say whether the visit succeeded. On a Topo server a provider no longer saves versions of the site; their visit is uploaded as a copy for the owners. Providers on Topo 0.0.1 must update to keep working with a 0.0.3 server.
- **Connect to a Topo server** (Settings): the app's own window keeps networks on a Topo server, this PC's or another's, with the email sign-in. A server that signs its own certificate is checked once by its fingerprint and pinned.
- **Add this computer** (the Nodes panel and Settings): this PC, its network cards and their subnets, read from the PC alone and added through the Import… review.
- **Screen lock** (Settings): Topo saves and covers the screen after 30 minutes without use (Off or another time); a PIN or the server sign-in unlocks it. It hides an unattended screen; it is not encryption.
- **Monitor from this PC** (Settings, off as shipped): the app asks the devices you mark "are you answering?" (ping, TCP, HTTP(S), DNS, SMTP, DICOM C-ECHO, NTP, RTSP, SIP, HL7 MLLP, IPP, IMAP, POP), one fixed request each, and keeps how long they take. It never scans, discovers, logs in or sends a message. Offered with the system tray and Open Topo at sign-in so it goes on with the window closed. Statistics are kept 360 days on this PC (or Off).
- **Issues and alarms.** A device that stops answering becomes an issue in Problems until someone acknowledges it, reports it or marks it expected. **Show alarms on this PC** (off as shipped) adds a full-screen card with a short chime and a system notification; on Wayland the card may not stay above other windows, so the notification always goes too. Nothing is sent by email, SMS or push.
- **Site monitors on a Topo server.** An owner can make a PC the site's monitor: it keeps checking and reporting with no one signed in, and every signed-in page, the website too, sees the status and the issues. Owners revoke it in Members.
- **Monitor during this visit** (provider mode): checks only the provider's devices for the visit, and Record visit adds the figures to the visit report.
- **Monitoring report** (the file menu): availability against a target with how much was measured, response times, outages with MTTR and MTBF, and the provider's report, through the print preview with CSV.
- **Setup**: a few skippable questions the first time Topo starts; in the app it connects to a Topo server or makes this PC the server step by step, and signs you in; Settings, **Run the setup again**.
- **The Mac app icon** sits on the map's blueprint blue in the Dock, the size of its neighbours.
- **Watched addresses** (the Watched tab): check addresses that are not on the map, such as the internet provider's gateway, a public resolver or a cloud service, with the same answer checks as a device. **Check the Internet…** adds those three in one step. A host name is looked up by this PC each time it is checked.
- **Record only**: a device or watched address can record its outages in the statistics and the monitoring report without raising an issue, a banner or an alarm. A new watched address starts this way.
- **TLS certificate** check: one handshake on any port (443 by default) that reads the certificate's end date, warned 14 days before.
- **Anything not checked has no state.** Topo never shows an unchecked device as down, unknown or offline, and the reports count only what was checked.
- **Does A reach B?** Right-click a device, then right-click another (a long-press on each on a phone, or **Trace to…** in the Trace box): the map lights the path, or says where it stops and the first reason it records (no cable, a retired device, the port, the VLAN, no gateway, NAT, no route). **On port** and **And back?** ask about one service and the way back. It is the map's answer, not a live test.
- **Check now** (the desktop app): asks a device, a watched address or the target of Does A reach B? once from this PC, and keeps nothing.
- **Watch this PC's connection** (Settings, Monitoring, off as shipped; on a Topo server): the people who share a site are told when a PC loses its connection to the server and when it comes back, the PC says when the server stops answering, and the monitoring report has a **Connections** section.
- **Providers.** A provider's part of the network is now the path from the problem to the router, not the whole network around it. **Report a problem to them** is on each provider's card, and **Provider report…** is in the Export menu. **Open a link…** opens a link back from a provider in the desktop app.
- Files are now document version 20. Topo 0.0.1 opens them read-only.
- A Topo server's database gains two tables the first time 0.0.3 starts it (the connections).
- Built and tested on Linux. The Windows and macOS builds of the new desktop pieces (ICMP, notifications, the keychain, This computer's readers, Open Topo at sign-in, the TLS check, host-name lookup, Check now, the connection heartbeat) were not run on those systems before this release.

## Which file

The architecture is in each file name: `x64`, `amd64` or `x86_64` is for Intel and AMD processors, `arm64` or `aarch64` for Arm (Apple silicon, Windows on Arm, Arm Linux).

| You have | Download |
| --- | --- |
| Any computer, nothing to install | `Topo-<version>-offline.zip`: unzip, open `index.html` in Chrome, Edge, Firefox or Safari |
| Windows | the `-setup.exe` for `x64` or `arm64`; needs no internet to install |
| Mac with Apple silicon (M1 and later) | the `aarch64` `.dmg` |
| Mac with Intel | the `x64` `.dmg` |
| Debian, Ubuntu, Mint | the `amd64` or `arm64` `.deb` |
| Fedora, RHEL, openSUSE | the `x86_64` or `aarch64` `.rpm` |
| Any other Linux | the `.AppImage` for your architecture |

The `.app.tar.gz` files are the macOS app without the disk image.

## This PC as the server

Install Topo on one PC and it can be the Topo server for the others on site, running in the background from startup, even when Topo is closed. On Windows, tick **Use this PC as the server for your network** on the installer's first page (silent installs: `/S /SERVER`). With the `.deb`, `.rpm` or the Mac app (in Applications), Topo asks the first time it opens. Then fill in the owner's email in Settings, **This PC as the server**. The AppImage can run the server only while Topo is open.

Phones and tablets: use the website. iOS Files and Android cannot run a local `index.html`, and there is no mobile app.

## These builds are not signed

- **macOS:** the app is signed ad hoc only. The first time, macOS says it cannot check the developer: open System Settings > Privacy & Security and choose Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Topo.app`.
- **Windows:** SmartScreen may warn about an unknown publisher: choose More info > Run anyway. Topo uses Microsoft Edge WebView2. The installers carry its offline installer, so a PC with no internet (an intranet) gets it from the installer itself if it is missing; Windows 10 and 11 normally have it already.
- **Linux:** the AppImage needs FUSE; without it, run it with `--appimage-extract-and-run`.

## Where your work is kept

- **Desktop app:** in the app's own data folder on this computer. It is separate from the website's and the zip's. Uninstalling the app (or ticking "delete app data" in the Windows uninstaller) can delete it, so Export a back-up first.
- **Zip:** in the browser you open it with, for that folder only.
- A network you have not kept is lost when you quit: keep it (or Export it) first.
- Files you save (JSON, CSV, images, reports) go to your Downloads folder. On macOS, Print opens the report in your default browser, which prints it.
- Share links and label QR codes point at the website; the app does not open links yet.
