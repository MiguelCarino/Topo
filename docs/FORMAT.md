# The Topo file format (document version 18)

This is the published description of the files Topo writes and reads, for
anyone writing another tool that reads or produces them. The machine-readable
schema is [`schema/topo-v18.json`](../schema/topo-v18.json) (JSON Schema 2020-12),
and a server backup is described by [`schema/topo-backup-v1.json`](../schema/topo-backup-v1.json).
Every sample network, built-in block, migrated old document and importer result
is checked against the schema by `tests/suites/formatschema.js`, and a new field
in Topo fails that suite until the schema and this page say what it is.

Where this page and the code disagree, the code (`js/model.js`, `FIELDS` tables)
is right and this page is a bug.

## 1. What the file is

- Plain JSON, UTF-8, saved with the extension `.json`. The media type is
  `application/vnd.carino.topo+json`.
- The first key is `"$schema"`, the address of the schema for the document
  version it was written at: `https://topo.carino.systems/schema/topo-v18.json`.
  Readers ignore it, and nothing fetches it. A file without it still opens.
- File names are `topo_<organization>_<site>_<date>[_<kind>].json`, each part
  lower case, accents folded, other scripts kept, `_` inside a part turned into
  `-`, empty parts left out (`topo_acme_casa-roma_2026-11-09.json`). `network`
  stands in when there is nothing, `networks` for a binder naming no single
  organization. A browser's ` (1)` suffix is not part of the name.
- The document carries its version in `v` (18 here). A reader migrates an
  older one on opening (section 10). A document from a newer Topo is opened
  read-only and is never re-saved by an older build, because saving it would
  drop what the newer build added.

## 2. Envelopes

Three outer shapes, recognised by `kind`:

**One network** (Back up this network):

```json
{ "$schema": "https://topo.carino.systems/schema/topo-v18.json",
  "kind": "nettopology", "version": 1, "name": "Casa Roma", "doc": { "v": 18, "nodes": [], "links": [] } }
```

`version` is the envelope's own version (1). `name` is the network's name in the
list of networks. A bare document (`{ "nodes": [...], "links": [...] }`) is read
as a network too.

**A binder** (several networks in one file):

```json
{ "$schema": "…", "kind": "nettopo-binder", "version": 1, "exported": "2026-11-09T10:00:00Z",
  "sites": [ { "id": "…", "name": "…", "created": 0, "updated": 0, "template": false, "block": false,
               "rev": "…", "base": "…", "doc": { … } } ] }
```

**A server backup** (`topo-backup`, version 1; docs/SCOPE.md D100): written by a
Topo server to a drive. The network inside is end-to-end encrypted, so the
server and the drive company cannot read it:

- `rev`: the head revision exactly as the server stores it: its number `n`,
  `epoch`, `author`, `at`, `ctHash` (SHA-256 of the ciphertext), the author's
  signature `sig`, and `iv` and `ct`, the AES-GCM ciphertext of a document;
- `rosters`: the signed member lists in force, `pubs`: the members' public
  keys that match them;
- `owners`: for each owner at backup time, their wrap of the network's key for
  that epoch and their locked recovery copy (`escrow`, or null);
- `name` in clear only when the owner allowed it, `originHash` (SHA-256 of the
  server's address) so a browser knows it is on the same server.

**Opening one with no server**: Open a file in Topo checks `ctHash` and the
chain, trusts the head roster (or compares it with what this browser already
trusts when it is the same server), unwraps the network's key with this
browser's own keys or with *the recovery key of one of its owners* (the owner's
escrow is opened with it), checks the author's signature (a backup whose
author's keys changed since still opens, with a note), decrypts, and offers the
document as any copy of a network: Merge, Replace (a restore point first) or
Open as a copy. An owner who never saved a recovery key can open a backup only
in their own browser on that server. A key reset or a new recovery key does not
re-lock older backups: they open with the recovery key the owners had then.

## 3. The document

Top-level keys, in the order Topo writes them. Every list may be absent (an
empty one is not written), except `nodes` and `links`.

| Key | Holds |
|---|---|
| `v` | The document version, 18. |
| `id`, `updated`, `rev`, `base`, `prior` | Identity (section 8). Not content. |
| `nodes` | Devices. |
| `links` | Cables, radio associations and VPN links. |
| `networks` | Subnets. |
| `groups` | Buildings, floors, rooms, racks and other groups. |
| `wifi` | Wi-Fi networks. |
| `providers` | Who is responsible for what (at most 100). |
| `accepted` | Findings accepted with a reason: `{ check, scope, nodeIds, linkIds, reason, until }`. |
| `pinned` | Findings pinned with a note: `{ check, scope, nodeIds, linkIds, note }`. |
| `expectedLife` | Expected life in years by device type, where the network says otherwise than Topo. |
| `annotations` | Notes on the map: `{ id, x, y, text, style ("note"), size, targets }`. |
| `report` | The report header: `site`, `client`, `engineer`, `ref`, `date`, `scope`. |
| `columns` | Custom columns (at most 40). |
| `tableView` | How the Devices table is arranged. |
| `searches` | Saved searches (at most 30): `{ id, name, query, columns, sort, desc, print }`. |
| `incidents` | Problem reports (section 6). |
| `log` | The network log (section 7). |

Records allow only their listed keys. Topo drops any other key when it reads a
record, so a tool that adds its own keys loses them at the next save; use a
custom column (`columns` and a device's `extra`) for data of your own.

### Devices (`nodes`)

| Key | Spreadsheet column | Value |
|---|---|---|
| `id` | `id` | Text, unique among devices. |
| `type` | `type` | `cloud`, `router`, `loadbalancer`, `l3switch`, `edge`, `firewall`, `vpn`, `switch`, `ap`, `server`, `vm`, `container`, `pc`, `voip`, `iot`, `printer`, `camera`, `dicom`, `custom`. Absent: `custom`. |
| `name` | `name` | Text. Absent or empty: "Unnamed Node". |
| `x`, `y` | `x`, `y` | Position on the map. |
| `gw`, `dns` | `gateway`, `dns` | Gateway, DNS servers (comma separated). Written even when empty. |
| `vendor`, `model` | `vendor`, `model` | Make and model (v16). Omitted when empty. |
| `os` | `os` | Firmware or operating system. |
| `ports` | `allowed_ports` | Allowed ports as text. |
| `notes` | `notes` | Free text. |
| `nat` | `nat` | `true` when it does NAT. |
| `siteRef` | | A cloud only: `{ id, name }`, the client's other site it stands for. |
| `portCount` | `port_count` | A switch or AP: its number of faceplate ports, 0 to 4096. Absent: the type's usual size, or the highest port in use. |
| `portScheme` | `first_port` | `{ prefix, start }`: port n is named `prefix + (start + n − 1)` ("Gi1/0/" from 1). The prefix never ends in a digit. Absent: ports are named by their number. |
| `portAttrs` | (ports sheet) | By port id `p1`, `p2`…: `{ label, vlan, tagged, poe }`. `vlan` the untagged VLAN, `tagged` the tagged ones as canonical text, `poe` `af`, `at`, `bt3`, `bt4` or watts (0.5 to 100). A port nobody wrote anything about has no entry. |
| `poeBudget` | `poe_budget` | Watts all its PoE ports can give together (a switch or AP). |
| `poeDraw` | `poe_draw` | Watts it draws over PoE (not a cloud, VM or container). |
| `interfaces` | (interfaces sheet) | Its interfaces (below). |
| `serial`, `assetTag`, `location` | `serial`, `asset_tag`, `location` | Text, omitted when empty. |
| `status` | `status` | `planned`, `active` or `retired`. |
| `inService`, `serviced` | `in_service`, `last_serviced` | A date as much as is known: `2021`, `2021-03`, `2021-03-15`. |
| `serviceEvery` | `service_every_months` | Months between services. |
| `lifeYears` | `expected_life_years` | Its own expected life in years. |
| `extra` | (one column each) | Custom column values, by column id. |
| `group` | `group` | The group it is in (a spreadsheet writes the group's path). |
| `rackU` | `rack_u` | In a rack: the lowest unit it occupies, **counted from the bottom** whatever the rack's numbering (−99 to 99). |
| `rackHeight` | `rack_height` | Units it takes; absent is 1. |
| `rackFace` | `rack_face` | `front` or `rear`. |
| `rackDepth` | `rack_depth` | `half`; absent is full depth. |
| `portsFace` | `ports_face` | `front` or `rear`, when not its type's side. |
| `host` | `runs_on` | A VM or container: the device it runs on. |
| `providers` | `provider` | Provider ids (a list since v18). |

### Interfaces (`nodes[].interfaces`)

| Key | Value |
|---|---|
| `id` | Unique on its device. Port grid ports are `p<n>`; a port appears in `interfaces` only once it has something of its own (a name, an address, a MAC). |
| `name` | The name the device gives it. May be empty. |
| `ip` | The address **with its prefix length** (`192.168.1.10/24`, or IPv6). Text that does not parse is kept and reported as "Invalid CIDR". |
| `mac` | Omitted when empty. Compared as 12 hex digits. |
| `wireless` | `true`, `false`, or absent (guessed from the name). |
| `bond` | `{ mode: "active-backup" \| "802.3ad", members: [interface ids] }`. |
| `vlan`, `tagged` | A wired interface's untagged VLAN (1 to 4094) and tagged VLANs. |
| `radio` | A wireless interface: `{ standard: n \| ac \| ax \| axe \| be, bands: [{ band: "2.4" \| "5" \| "6", channel, width, power, ssids }] }`. `ssids` absent: every Wi-Fi network; empty: none. |

VLAN lists are canonical text: `all`, or the numbers ascending with runs of
three or more as a range (`10,11,20-23`).

### Links (`links`)

| Key | Value |
|---|---|
| `id` | Unique among links. |
| `source`, `target` | Device ids. |
| `sourceIface`, `targetIface` | Interface ids on each end (a port is `p<n>`). Absent: not bound to an interface. |
| `attachment` | How it attaches (`passthrough`, or absent). |
| `medium` | `utp`, `fiber`, `wireless`, `powerline` or `vpn`. Absent: guessed. |
| `cable` | `{ label, length, color, via }`. `length` is `"2.5 m"` or `"8 ft"` (other text is kept as written); `via` what it runs through. |
| `wifi` | A wireless association: `{ ssid: Wi-Fi id, band, signal (dBm, −100 to 0) }`. |
| `providers` | Provider ids. |

### Subnets (`networks`)

`id`, `cidr` (unique; a range that no longer parses keeps its text), `name`,
`vlan`, `purpose`, `gateway`, `dns`, `dhcp` (true/false), `dhcpFirst`,
`dhcpLast` (the pool), `drawZone` (true, false, or absent: private ranges only).

### Groups (`groups`)

`id`, `name` (absent: shown as its kind), `kind` (`building`, `floor`, `room`,
`rack`, `custom`), `parent` (a group id; no loops), `providers`. A rack also has
`uHeight` (1 to 99, absent 42), `width` (`10in`, `19in`, `23in`), `depthMm` and
`numbering` (`top` for units numbered from the top; absent from the bottom).

### Wi-Fi networks (`wifi`)

`id`, `ssid`, `security` (`open`, `owe`, `wpa2`, `wpa3`, `wpa2/3`, `wpa2-ent`,
`wpa3-ent`, `wep`, `wpa`), `bands` (absent: all), `network` (a subnet id),
`hidden`. There is no password field, on purpose.

### Providers (`providers`)

`id`, `name`, `service` (`internet`, `phone`, `it`, `security`, `power`,
`vendor`, `cloud`, `other`), `contact`, `phone`, `email`, `account`, `hours`,
`notes`.

### Custom columns (`columns`) and `extra`

`{ id: "c<n>", name, kind }`, at most 40, names unique in any case. `kind` is
`number`, `date` or `yesno`; absent is text. A device's `extra` holds its values
by column id: text, a number, `YYYY-MM-DD`, or true/false.

## 4. Ids

- Ids are text. Topo mints `n_…`, `i…`, `l_…`, `net_…`, `g_…`, `wf_…`, `pv_…`
  (a prefix, then a clock and a counter in base 36), `c<n>` for columns, `sq_<n>`
  for searches, random tokens for log entries and problem reports. Any unique
  text is accepted; a repeated one is minted again on reading.
- References (a link's ends, a device's group and host, a Wi-Fi network's
  subnet, provider lists) are by id. A reference to nothing is dropped on reading.
- **To the merge, an id is an identity only when the file carried it.** Two
  copies of one network match their records by id first. In a two-way merge
  an id match is checked for contradiction (another MAC, or another name and
  type), because unrelated documents reuse short ids (`h1`, `i1`); a
  contradicted id is unrelated (docs/SCOPE.md D30).
- Ids starting `imp-` are **transient**: an importer's stand-in for a record
  whose source had no key. They are never an identity and are replaced when
  the record is added. Do not write them unless you mean that.
- Importers keep a source's stable key, prefixed with the source
  (`nb-<src>-d12` for NetBox device 12), so importing the same export again
  updates instead of duplicating. The other prefixes: `uf-<_id>` (UniFi),
  `om-<id>` (Omada; a device or client with no id, its MAC), `ls-<src>-<AssetID>`
  (Lansweeper), `ip-<src>-s7`, `-a42`, `-d5` (phpIPAM subnets, addresses and
  devices from its API). nmap, MikroTik and Cisco files carry no stable key,
  so their records are transient and match by MAC, address or name.

## 5. Providers and the provider part

A device, cable or group names its providers (`providers`). A service a device
names nobody for comes from its host, then its group and the group's parents.
A **provider part** is a copy of only what one provider looks after, sent to
them with a problem report; it comes back through the merge, which knows it is
a part and leaves alone what the provider never saw (docs/SCOPE.md D93).

## 6. Problem reports (`incidents`)

At most 200, oldest first. `{ id, at, status, symptom, … }`: `status` is `open`,
`sent`, `visited` or `closed` and only moves forward (a reopen goes back to
open); `symptom` is `internet`, `wifi`, `phone`, `camera`, `printer`, `power` or
`other`; it names the devices and groups affected, the providers it was sent
to, and the ids of its visits (`visit` log entries). The schema lists every key.

## 7. The network log (`log`)

What was done to the network from outside, oldest first, at most 500. Every
entry is `{ id, at (ms since 1970), kind }` and the keys of its kind:

- `merge`: `source`, `by`, `counts` (`added`, `changed`, `removed`,
  `conflicts`), `summary`, `mode` (`two-way` or `three-way`), `rev`;
- `incident`: `incidentId`, `event` (`opened`, `sent`, `closed`, `reopened`),
  `symptom`, `routedTo`, `summary`;
- `visit`: `incidentId`, `providerId`, `provider`, `by`, `arrived`, `left`,
  `outcome` (`fixed`, `partly`, `not-fixed`, `follow-up`), `notes`, `changes`,
  `signoff`, `summary`.

**The hash chain**: from the second entry on, `prev` is the SHA-256 (64 hex
digits) of the previous entry's stable JSON (keys sorted, absent values left
out). A log edited outside Topo shows where the chain breaks; Topo says so and
keeps reading. Two copies' logs are unioned by id when they are merged, never
reviewed.

## 8. Revisions

- `id`: the network's id (unique across machines), `updated`: when it was last
  saved (ms).
- `rev`: a token for this copy as it left; a new one whenever the content
  changed since the last copy that left. `base`: the revision this copy was
  started from. `prior`: earlier revisions this document carried, newest first,
  at most 8.
- These are identity, not content: two copies with the same content are the
  same whatever they say here. The content hash of a document is taken over the
  canonical document without them.
- A copy coming back is merged three-way against `base` when Topo still holds
  that revision, else two-way.

## 9. Merge semantics

- **Matching**, strongest first: devices by id, asset tag, serial, MAC,
  address, name; interfaces (inside a matched device) by id, MAC, address, a
  unique name; cables by id, then by both ends and their ports; subnets by id,
  then range; groups by id, then path (Building / Floor / Room / Rack); Wi-Fi by
  id, then SSID; providers, searches and columns by id, then name. An ambiguous
  match is asked, never guessed.
- **Two-way** (no common copy): something only in the copy is added; nothing is
  ever removed; a field empty on one side takes the other; a field that differs
  is a conflict that keeps yours unless chosen otherwise.
- **Three-way**: a field changed on one side takes that side; changed on both
  differently is a conflict; something removed on one side and untouched on
  the other is removed; removed on one side and edited on the other is asked.
- Sets (providers lists, a report's devices) are unioned, three-way per element.
- **Every merge** takes a restore point of the network first, is one undo step
  and leaves a `merge` log entry naming its source.
- Imports from other tools (NetBox and others) are merged two-way as a copy:
  importing adds and updates, never deletes.

## 10. Migrations

| Version | Added |
|---|---|
| 1 → 2 | Interfaces with ids (the old `ips` list), cables bound to interfaces. |
| 2 → 3 | Subnets declared (`networks`); the zone flag moves from interfaces to subnets. |
| 4 | Asset fields (serial, asset tag, location, status) and the cable's own facts. |
| 5 | Accepted findings. |
| 6 | Port names and port facts (`portScheme`, `portAttrs`). |
| 7 | Groups and rack placement. |
| 8 | Full depth becomes the default (`rackDepth: half` is the only value). |
| 9 | A rack's width, depth and numbering. |
| 10 | A virtual device's host. |
| 11 | A device's ports face. |
| 12 | Wi-Fi networks, radios and associations. |
| 13 | Custom columns and the table's view. |
| 14 | Service dates and intervals, expected life. |
| 15 | Providers. |
| 16 | DHCP pools, saved searches, vendor and model, tagged VLANs and PoE. |
| 17 | The network log; `rev`, `base` and `prior`. |
| 18 | Provider lists (`provider: "pv_1"` becomes `providers: ["pv_1"]`); problem reports. |

## 11. Writing files for Topo

- Write `$schema` first and `v: 18`. Leave out what you do not know; do not
  write empty strings for absent facts where the table says "omitted".
- Give every record an id, and make references by id. If your records have
  stable keys of their own, use them (prefixed with your tool's name) so a
  second import updates the first.
- Addresses always carry their prefix length.
- Never put passwords or keys in any field: a network file travels.
- Validate against `schema/topo-v18.json`. Topo reads anything the schema
  allows, and a file it opens is what it will save back, so a key the schema
  does not list is dropped.
- A newer version of this format will have a new schema address
  (`topo-v19.json`); Topo opens a newer document read-only.
