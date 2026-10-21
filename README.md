# Topo

Draw a network (devices, addresses, cables) and Topo checks it for address conflicts, switching loops and unreachable gateways, then turns it into a printable site report.

**[Open it →](https://topo.carino.systems/)** — runs in your browser, nothing to install, no account.

![Topo editor showing a small home network with its subnet and the device palette](docs/screenshot.webp)

## What it does

- About twenty device types (router, switch, firewall, wireless AP, server, VM, printer, IP camera and more) to place on a canvas. Each device holds interfaces with IP/CIDR and MAC address, plus gateway, DNS, OS and open ports.
- Checks the map as you draw: duplicate IP addresses, gateways outside the device's subnet, cables whose two ends disagree, switching loops that need STP, and duplicate MAC addresses.
- Trace mode shows everything the selected device can reach, optionally filtered by a port.
- Start from the example, from one of 15 templates (home, bank, data center, campus, factory, hotel and others), or from a setup wizard where you just count the devices you have.
- Export a PNG or WEBP image, a `.nettopo` build file to import later, or a printable site report with the findings, the inventory and the diagram.
- Undo/redo, and Tidy to arrange the map into tiers. The simplified view and the setup wizard are also in Spanish, Portuguese (Brazil), Japanese and Russian.

There is no server and no upload. Networks you save stay in this browser's local storage, and the one you are working on is kept in the page's history rather than in the URL. To share a network as a link, the share dialog locks it with a passphrase by default (AES-GCM encryption). The only outside requests come from the optional Sys. Status panel, which looks up your public IP address, and only when you open it.

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
