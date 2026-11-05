# Topo

A network register you draw. Put down the devices, their addresses and the cables between them; Topo checks the network as you go (address conflicts, switching loops, gateways and DNS servers a device cannot reach) and turns it into a printable site report.

**[Open it →](https://topo.carino.systems/)** — runs in your browser, nothing to install, no account.

![Topo editor showing a small home network with its subnet and the device palette](docs/screenshot.webp)

## What it is for

Most small networks (a clinic, an imaging centre, an office, a home) were never written down. Topo is where they get written down once, properly, by the person who knows them:

- **Record** what is there: every device, address, subnet, cable, port, rack and Wi-Fi network, in one document.
- **Check** it while you draw, so a wrong gateway or a duplicate address is found on the map rather than on site.
- **Hand it over** as a site report, cable and asset labels, a spreadsheet or a file someone else can open.

It is for the technician documenting a site and, through the simple view, for staff who are not technicians and only need to say what is plugged into what.

## Features at a glance

Every feature is described in full in **[docs/FEATURES.md](docs/FEATURES.md)**.

- **Three views of one document.** Simple (`#simple`, `#imagenology`) for non-technicians, in five languages; the Full editor (`#advanced`) with every field; and Setup (`#setup`), which draws a network from a count of devices. Switching loses nothing.
- **The register.** About twenty device types with interfaces, MACs and asset details; subnets as objects that devices inherit gateway and DNS from, with Renumber; groups for buildings, floors, rooms and racks; VMs and containers on their hosts; Wi-Fi networks, radios and links; named ports with labels, untagged and tagged VLANs and PoE, PoE budgets and draws; cables with tag, colour, length and run.
- **Rack view.** Front and rear elevations numbered as the rails are, with each device's ports, cables routed through the manager, drag-and-drop placing, and a patch schedule.
- **Checks.** Duplicate IPs and MACs, unreachable gateways and DNS, switching loops, mismatched cable ends, rack overlaps, and Wi-Fi faults (bands, channels, overlap, weak security, weak signal). One set of findings feeds the map, the Findings tab and the report; a finding can be accepted with a reason. Trace shows what a device can reach, one VLAN at a time. Locate shows where a device is plugged in: NIC, cable, switch port and jack, rack units and room, with every unrecorded link named rather than guessed, and a print sheet to take on site; the simple views say it in one plain sentence.
- **Many devices at once.** Multi-select, Change all with a preview of what the checks would find afterwards, a sortable editable Table, a search language (`ip:`, `vlan:`, `group:`, `has:finding`…) with saved searches kept in the network, Add devices by pattern, reusable Blocks, Tidy, and undo per action.
- **Spreadsheets in and out.** CSV/TSV export of every sheet (saved searches included) that round-trips unchanged; import by heading or by what the values look like; paste ARP tables, DHCP leases and network scans (nmap, arp-scan, netdiscover, Advanced/Angry IP Scanner exports) from common vendors. Every import is reviewed before it applies. Columns of your own (text, number, date, yes/no) on the Devices table, carried in the file and the spreadsheet; an unknown heading in an imported sheet can become one.
- **Output.** A printable site report: a one-page summary in plain words for the client (is the network fine, what needs attention and why, what there is), the technical details (findings, inventory, counts by vendor, model and firmware, rack elevations, patch schedules, port maps, Wi-Fi, saved searches as tables of their own, changes, diagram, each section with a tick of its own), or both; 62 × 29 mm labels with QR asset links, a Locate sheet of where each selected device is plugged in, PNG/WEBP/SVG, and a hand-off to [Netplan](https://netplan.carino.systems/).
- **Keeping your work.** Autosaves in this browser; `.nettopo` back-ups and binders; changes counted since the last back-up; older files upgraded, newer ones opened read-only.
- **Private by design.** No server, no upload. The network is kept out of the URL, share links are passphrase-locked (AES-GCM), and there is no field for a Wi-Fi key.
- **Scale.** A 300-device site redraws, checks and previews a bulk change in tens of milliseconds, held to a budget by a test.

## What it is not

- **Not a scanner or a monitor.** It knows what you draw, type or paste; it never probes the network. Use [Ping](https://ping.carino.systems/) for live checks.
- **VLANs are checked and traced.** Ports, interfaces and subnets carry untagged and tagged VLANs (trunks) and PoE, shown in the editor, the table and the report. The checks find a VLAN that does not reach its gateway over the switches, the two ends of a cable that disagree on their VLANs, and an access VLAN no subnet has; an end with nothing recorded carries every VLAN. The Trace follows one VLAN at a time (its VLAN tick, on by default), and unticked walks every VLAN. PoE is checked: a powered device on a port that gives none, a draw more than the port gives, and a switch over its PoE budget.
- **Not a full DCIM.** Patch panels and wall jacks are written on the cable's run rather than drawn; power, weight and device models are not drawn.
- **Not a password store.** It warns when notes look like they hold a password, and has nowhere to keep a Wi-Fi passphrase.

## Development

Static files, no build step. `tests/run.sh` runs every suite in headless Chromium; see [tests/README.md](tests/README.md).

**Related tools:** [Hardware](https://hardware.carino.systems/) · [Netplan](https://netplan.carino.systems/) · [Ping](https://ping.carino.systems/)

## Offline and desktop builds

Topo also comes as desktop apps (Windows, macOS and Linux, on x64 and Arm) and as a plain offline zip, from [GitHub Releases](https://github.com/MiguelCarino/Topo/releases). The `Builds` workflow (`.github/workflows/builds.yml`) makes all of them into one **draft** release; nothing is public until the owner publishes it.

- **Zip:** unzip, open `index.html` in a desktop browser. It is the website's files byte for byte.
- **Desktop apps** ([Tauri v2](https://v2.tauri.app/), the system webview): `.dmg` for macOS, `.msi` and `-setup.exe` for Windows, `.deb`, `.rpm` and `.AppImage` for Linux. They run the same files as the website; only the staged copy's CSP adds the app's IPC origins (`ipc:`, `http://ipc.localhost`).
- **Unsigned.** macOS: the app is signed ad hoc; approve it under System Settings > Privacy & Security > Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Topo.app`. Windows: SmartScreen shows "More info > Run anyway"; WebView2 ships inside the installers (Tauri's `offlineInstaller` mode), so they install with no internet, as on an intranet. Linux: the AppImage needs FUSE, or `--appimage-extract-and-run`.
- **Where work is kept.** The app keeps its library in its own data folder, separate from the website's. Uninstalling it (or the Windows uninstaller's "delete app data") can delete it: Export first. A network that has not been kept is lost when the app quits, because the live document lives in the page's history: keep it before quitting.
- The app opens on a short intro animation (`desktop/intro.html`), then the editor. Saved files go to the Downloads folder. On macOS, Print opens the report in the default browser, which prints it. Share links and label QR codes open the website; the app cannot take links yet.

Building locally (Rust, Node and the Tauri system packages; on Linux `webkit2gtk-4.1` and `libsoup-3.0` with their `-devel` packages):

    desktop/stage.sh desktop/dist --desktop
    cd desktop
    npx @tauri-apps/cli@2.12.4 icon ../logo.svg -o src-tauri/icons
    npx @tauri-apps/cli@2.12.4 build

The icons are generated from `logo.svg` and never committed; `cargo check` needs them too, so stage and make the icons first. `desktop/stage.sh <dir>` alone makes the zip's folder. `node tests/stage-check.mjs` checks the stage script.

## Licensing

**Mine — GNU Affero General Public License v3.0 or later.** Everything in this
repository *except* the paths listed below. Copyright © 2026 Miguel Carino.
Full terms in [LICENSE](LICENSE).

**Not mine.** The files below are third-party works redistributed here. This
project's licence does not cover them and could not: they are not mine to
relicense. Each keeps its own terms, and each carries its own notice.

| Path | What it is | Licence | Notice |
| --- | --- | --- | --- |
| [`fonts/`](fonts/) | IBM Plex Mono, IBM Plex Sans, Red Hat Display | SIL OFL 1.1 | [`fonts/OFL.txt`](fonts/OFL.txt) |
| [`vendor/`](vendor/) | third-party JavaScript | per package — see the notice | [`vendor/README.md`](vendor/README.md) |

Those files travel with any fork, mirror or repackaging of this repository, and
their notices must travel with them.
