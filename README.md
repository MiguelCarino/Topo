# Topo

A network register you draw. Put down the devices, their addresses and the cables between them; Topo checks the network as you go (address conflicts, switching loops, gateways and DNS servers a device cannot reach) and turns it into a printable site report.

**[Open it →](https://topo.carino.systems/)** — runs in your browser, nothing to install, no account.

![Topo editor showing a small home network with its subnet and the device palette](docs/screenshot.webp)

## Two views

- **Simple** (`#simple`, or `#imagenology` for a medical imaging site) is for someone who is not a network technician: plain words, a short device palette, and only names and connections to fill in. A problem the checks find shows as a mark on the device. It is in English, Spanish, Portuguese (Brazil), Japanese and Russian.
- **Full editor** (`#advanced`) has every field, the Subnets, Findings and Table views, bulk editing and the spreadsheet round-trip. Its technical vocabulary (Gateway, DNS, VLAN, Interfaces…) stays in English on purpose; its sentences, the findings and the site report are translated.
- **Setup** (`#setup`) asks how many of each kind of device you have and draws a network around a router.

Switching views never loses anything; they show the same document.

## The register

- **Devices.** About twenty types (router, switch, firewall, access point, server, VM, PC, printer, IP camera, phone, imaging modality and more). Each device has interfaces with an address and a MAC, a gateway, DNS servers, open ports and an asset group: model / firmware, serial number, asset tag, location, status (planned, active, retired) and notes. In the full editor a new device starts with nothing it was not given: no address, gateway, DNS server, model, allowed ports or NAT. Its address comes from the subnet it is cabled into, and its gateway and DNS from that subnet.
- **Retired devices** stay in the register, dimmed on the map. Nothing reaches them or passes through them, their own checks are skipped, and their address is free for a replacement without raising a conflict.
- **Subnets** (full editor, Subnets tab) are objects with an address, a name, VLAN, purpose, gateway, DNS servers and DHCP on or off, and show their size, use, next free address and members. A device belongs to a subnet by its address and inherits the subnet's gateway and DNS unless it sets its own; routers and firewalls keep their own. **Renumber** moves a subnet to another range in one step and refuses when the new range overlaps another subnet, is too small, or would put two devices on one address. Subnets in use that nobody declared are listed with **Declare**. Each subnet's zone can be drawn on the map: always, never or automatically for private ranges; a private subnet nobody declared is drawn automatically too. A zone is drawn round its own devices (a router on several subnets does not stretch them), and two automatic zones whose devices interleave are not drawn. In the full editor "subnet" is always one of these, and "network" the whole document.
- **Cables** carry a label, length, colour and what they run through (`PP-A:12 > WJ-3B`), since patch panels and wall jacks are not drawn as devices.
- **Ports** (full editor). A switch or access point can name its ports the way the box does (`Gi1/0/` from 1 makes port 12 `Gi1/0/12`). A prefix cannot end in a digit. Each port can carry a label (the jack or desk at the other end) and an access VLAN. A port's VLAN is recorded, not modelled: trunks, tagged VLANs and PoE are not, and the checks do not split the network by VLAN.

## Checks

- Duplicate IP and MAC addresses, gateways outside the device's subnet or out of its reach, DNS servers it cannot reach, cables whose two ends disagree (IPv4 and IPv6), switching loops that need STP, a cable label or asset tag used twice, and notes that look like a password.
- One set of checks feeds the marks on the map and, in the full editor, the device's Diagnostics tab, the **Findings** tab and the report, so they agree. The Findings tab groups findings by check and folds the same finding on many devices into one line; clicking a line selects the device and centres the map on it. A pill on the map counts what is open; A opens the tab and goes back.
- **Accept…** keeps a finding you know about, with a required reason. It stops counting everywhere (tab, pill, badge, saved card, report totals, bulk previews) and is listed under Accepted with its reason; Reopen takes it back. What is accepted is those devices: a new device joining the same conflict is open again.
- **Trace** (full editor: Diagnostics tab, or T) shows everything the selected device can reach, optionally through one port.

## Working with many devices

- **Selection.** Shift- or Ctrl-click adds or removes a device or cable, Shift-drag boxes devices in, Ctrl+A takes everything, and a subnet's **Select members** takes everyone on it. A selection moves, deletes and undoes as one step.
- **Change all of them** (full editor, two or more devices): set a field on all of them (a field they differ on says "mixed"; blank leaves it alone; Clear empties it so the subnet's value applies again); rename them with a pattern such as `CAM-{n:02}` or find and replace; move them to a subnet (each takes the next free address); re-cable them onto another switch or access point (each moves to the next free port, keeping its cable's label and its own address); or delete them. Every change shows first what would change and what the checks would find afterwards (for example "+2 Duplicate IP, −24 Gateway"), then applies as one undo step. Selected cables get the same treatment for their own fields.
- **Map | Table** (full editor): the same network as rows on five tabs (Devices, Interfaces, Cables, Ports, Subnets). Edit a cell in place; a value that is not valid for its column is refused. Sort by any column, move with the arrows and Tab, and click a row to find it on the map. **Paste a column** lays a spreadsheet column down the ticked rows, or from the cursor's row downward, with a preview first. On a phone the table opens first.
- **Search** (full editor) works on the map and the table: plain words match any field, and `type:`, `ip:` (an address or a network such as `10.10.30.0/24`), `mac:`, `vlan:`, `switch:`, `status:`, `loc:`, `tag:` and `has:finding` narrow it; `-` leaves a word out. A word it does not understand is reported under the box. **Zoom to matches** and **Select matches** act on the result.
- **Add devices**: count each kind, give a name pattern (`Phone-{n:02}`, numbered after the names already on the map) and choose the switch or access point. The new devices take its next free ports and the next free addresses of its subnet, inherit the subnet's gateway and DNS, and arrive selected as one undo step. The dialog says first which names, ports and addresses they will get, warns when they would not fit on the switch, and warns when a pattern without `{type}` would number every kind in one run. A switch on a router port with no address gets no addresses from the router's other ports. Started from the landing, it builds a new network around a router whose LAN every switch is cabled to.
- **Blocks** (full editor) are saved selections: shipped ones (a DMZ, a VoIP closet, a Wi-Fi cell…) or your own. Inserting one moves each of its subnets to the next free one of the same size, so a second copy never conflicts with the first.
- **Tidy** lays the map out in tiers (internet, router, switches), then each switch's devices in port order, at most 12 to a row, with each switch above its own devices and each tier above the one it serves. With two or more devices selected it arranges only those.
- Undo and redo work per action: a typed field, an inserted block, a batch of added devices or a Tidy is one step each.

## Spreadsheets and pasted output

- **Export** (full editor, File → Spreadsheet): six CSV sheets (devices, interfaces, cables, ports, subnets, findings) in UTF-8, or the same rows copied as TSV. The subnets sheet carries each subnet's name, VLAN, gateway and DNS, which devices inherit, so subnets, devices, interfaces (with bonds) and cables imported into an empty map give the whole network back. A cell that would start a formula (`=`, `+`, `-`, `@`) goes out with an apostrophe in front and comes back without it. A sheet exported and imported back changes nothing.
- **Import** takes a CSV file or rows pasted from a spreadsheet. Columns are matched by heading (`Hostname`, `IP Address`, `MAC Address`, `Switch`, `Port`…) or, without headings, by what the values look like, and you can change any match. Rows are matched to devices by id, then asset tag, then MAC, then IP, then name (a name two devices share is a conflict, not a guess). A row found only by its address or name that names another device (another asset tag or serial, or two of another MAC, name and type) is a conflict, not an edit of the device that holds that address. Only mapped columns are applied and a blank cell changes nothing. A row that matches nothing adds a device, cabled to the switch and port it names. A sheet of ports sets labels and VLANs on ports already drawn and never cables anything. A sheet of subnets (a `cidr` or `network_id` column) declares or edits subnets; it never moves one to another range, which is Renumber's job.
- **Paste anything**: the same box reads an ARP table or a DHCP lease list (Linux, macOS, Windows, Cisco, HP/Aruba, Juniper, MikroTik, dnsmasq, ISC dhcpd, Fortinet…) and takes each address with its MAC and, when given, a name. A name seen on the network never renames a device you named, and is never used to match one, because DHCP names repeat.
- Every import goes through a review that lists each row as added, changed, unchanged or a conflict, with what the checks would find afterwards. Apply is one undo step.

## Reports, labels and exports

- **Site report**: a printable document with a header you fill in (site, client, author, reference, date, scope; a blank site is the name the network is kept under), the findings with accepted ones listed separately with their reasons, an inventory with one line per interface, a port map for every switch and access point (with labels and VLANs when the ports have them, and free ports as ranges), what changed since the last back-up, and the diagram (on its own page past 40 devices).
- **Print labels**: 62 × 29 mm labels for a selection. Each tagged device gets its tag, name, address and MAC with a QR code of its asset link, drawn in the page; each labelled cable gets two, one per end.
- **Asset links**: `topo.carino.systems/#asset/<tag>` opens the network in this browser that holds that asset tag and selects the device.
- **Images**: PNG, WEBP, and SVG (full editor) with the site's name as its title and nothing in it that reaches outside the file.
- **Netplan**: on a PC, server, VM or container, **Open in Netplan ↗** opens [Netplan](https://netplan.carino.systems/) filled in with that device's interfaces.
- Downloads are named after the site and the date (`clinica-norte-2026-10-26.nettopo.json`).

## Keeping your work

- A network you start here (New network, Add devices, a file you open, a saved card) is kept in this browser and saves itself as you work; the bar on the map says when it last saved. The example and a link someone sent you are not stored until you press **Keep this network**.
- **Back up** saves one network as a `.nettopo` file, or all of them in one binder file. After a back-up or a report, each card says how much has changed since ("± 3 changes since the last back-up") and lists the changes on request. That comparison copy stays in this browser and never goes into a file, link or binder.
- If the browser refuses to save (storage full or blocked), a banner stays up with **Back up now** until a save gets through.
- Opening a file of a network you already have offers to update it (the newer one wins) or to open it as a copy.
- Saved templates are cards in the same library, with Duplicate to start a network from one.
- Every saved network records the version of the format it was written in. Older ones are upgraded when opened; one from a newer Topo opens read-only, so saving it here cannot drop what this version does not know. A read-only network can still be inspected, reported on and exported as it arrived.
- Two tabs open on the library see each other's saves.

## Privacy

Topo has no server and uploads nothing. Kept networks live in this browser's storage (IndexedDB, falling back to local storage where IndexedDB is not offered), and the network you are working on is held in the page's history, not in the URL. A share link carries the whole network and is locked with a passphrase by default (AES-GCM); before a network leaves as a link or a report, Topo names any device whose notes look like they hold a password. The only outside request comes from the optional status panel, which looks up your public IP address when you open it.

## Scale

A 300-device site (a fixture of one ships with the tests) redraws, checks itself, fills the table and previews a bulk change in tens of milliseconds, and a test holds it to a time budget.

## Development

Static files, no build step. `tests/run.sh` runs every suite in headless Chromium; see [tests/README.md](tests/README.md).

**Related tools:** [Hardware](https://hardware.carino.systems/) · [Netplan](https://netplan.carino.systems/) · [Ping](https://ping.carino.systems/)

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
