# Topo scope: the shared infrastructure register

Written 2026-11-09 from the owner's review. This is the contract for what Topo
becomes next; FEATURES.md says what it does today, BACKLOG.md holds the finished
Netdisco series and its specs.

## Goal

A universal infrastructure register that becomes the standard: it imports from
other tools, and it lets the client (usually not technical) and their providers
agree on what the network is, what went wrong and what was changed.

The loop it must support:

1. A client has a problem and makes a report in Topo.
2. Topo says who to contact (from the topology and the providers) and sends the
   report, with the network's context and configuration, to that provider or
   those providers.
3. The providers arrive, make the changes, and record them in a provider section.
4. Topo keeps the change, the report and a history.

A second way in: a technician maps part of a site in a fresh Topo session,
downloads the file, and wants it merged into the site's main network.

## Decisions

- **No agents (LLM) for now.** Routing, change capture, merging and history are
  plain, deterministic, tested code. An assistant may be reconsidered later, only
  as an optional layer (vendor-neutral, through Cerberus), never required.
- **History moves into the document.** An append-only, hash-chained log of
  incidents, visits and change records (who, when, the diff, the report it
  answers). This reverses the reasoning at the top of js/changes.js, which kept
  history out of the file for privacy; outgoing links and reports will need a
  redaction choice instead.
- **Several providers per item, each with a role** (the ISP for the circuit, IT
  support for the router), replacing one provider per item.
- **The provider view is translated** (en, es, pt-BR, ja, ru). "The Advanced
  editor stays English" still holds for the full editor.
- **The format is published as an open spec** (versioned JSON Schema, a
  validator, a permissive licence for the format).
- **Every way in goes through one merge** (section 3): technician files, provider
  visits, colleagues' edited copies, CSV and other tools' exports.
- **Technician features are frozen** (VLAN, PoE, racks, inventory are deep
  enough) until the client-provider loop ships.

## 1. Data-safety problems in today's code (step 1)

- **A. "Update" replaces the whole network.** Opening a file whose id is already
  a card (js/app.js applyImportedDoc, js/library.js askAboutKnownCopy) offers
  Update, which keeps the newer copy whole and drops the other. A provider's
  file sent Monday and returned Wednesday overwrites the client's Tuesday edits.
  Nothing is saved before the overwrite.
- **B. Some edits are dropped silently.** docChangeCount (js/library.js) compares
  nodes, links, annotations, the report header, accepted, pinned and searches,
  but not subnets (networks), groups, Wi-Fi, providers or the table columns. A
  file that differs only in those counts as "the same", and the card is opened
  instead of the file.
- **C. One backup point per network.** The baseline behind "changes since the
  last back-up" (js/changes.js) is the only earlier copy kept, and each back-up
  replaces it. Undo does not survive a reload.

## 2. Restore points (step 1)

- Before anything replaces or changes a kept network from outside, a restore
  point is saved: opening a file onto a card (Update), a binder import that
  updates cards, a CSV/paste import applied to a kept network, a share link kept
  onto an existing card, and (later) every merge.
- Each holds the whole previous document, the time, the reason ("Before opening
  tech-visit.json") and a size. At most 20 per network and a total size cap,
  oldest dropped first, in an IndexedDB database of their own so they can never
  take the space the networks need.
- A network's **Restore points** list: Restore (which first saves a restore
  point of the current state, so a restore can be undone) and Download (.json).
- If a restore point cannot be saved, the load does not go ahead silently: it
  offers to download a back-up first, continue anyway, or cancel.
- With a server, restore points are also kept server-side.

## 3. Merge into another network (step 2)

- **Merge into…** for an opened file (or from the library): pick the target.
- Matching reuses the CSV importer's (id, asset tag, serial, MAC, IP, name; an
  ambiguous match is a conflict, never a guess). Subnets match by range and are
  never relocated (unlike inserting a block). Groups match by path
  (Building / Floor / Room / Rack). Cables by both ends and ports. Providers by
  name.
- The review is the CSV import's (added / changed / unchanged / conflict),
  extended to every kind of item, with "theirs / mine" per conflicting field and
  the findings the result would have.
- Existing devices keep their place; new ones go beside what they are cabled to,
  or inside their group's frame.
- Restore point first, one undo step, and a history entry ("Merged from
  closet-2F.json, prepared by X, date").
- The bound binder file (read at Back up all, or when binding a file that
  already holds a binder) still updates newer-wins after a restore point,
  without step 1's "Yours has N changes" question, which the binder file and
  binder link doors ask. The three-way merge replaces it there too.
- **Three-way merge for edited copies.** A file records the version it was taken
  from (a base revision), so a copy coming back is merged against that base and
  edits on both sides survive. This replaces the newer-wins Update. Format v17.

## 4. The client-provider loop (step 4)

- **Report a problem** in Simple view (translated): tap the affected device or
  area, pick a symptom (No internet, Wi-Fi, Phone, Camera, Printer, Other).
- Routing: follow the path upstream (locatePath, uplinkOf: device, switch,
  router, modem, ISP), collect the providers along it, rank them by service and
  support hours. Deterministic and offline.
- Sent as a sealed link or file (mailto or the browser's share sheet before
  there is a server).
- **`#provider` mode**: the incident and what this provider covers. They edit;
  **Record visit** captures the diff, notes and a sign-off, and returns a file
  that goes back in through the merge (section 3).
- Format v17 adds `incidents` and `log`, with the base revision from section 3.
- Mobile batches B4 and B5 (docs/MOBILE.md) come first: providers work on phones.

## 5. Server (step 5)

- Portable and hosted anywhere: one self-contained Go program, shipped as a
  container image, installers (Windows service, rpm/deb, macOS) and as an option
  inside the desktop apps so a PC on site can be the server.
- No cloud dependency: SQLite by default, Postgres optional; files on disk or any
  S3-compatible store; email through any SMTP server; configured by environment
  or one file.
- Serves the same static app. Without a server Topo works as today; with one it
  syncs.
- End-to-end encrypted, so it does not matter who hosts it (Carino, the
  client's NAS, a provider's VPS). It holds sites, invites, roles (owner;
  provider, limited to what they cover; viewer), the log, restore points and
  notifications. The "no outside requests" rule then allows only the server the
  user configured (one connect-src entry, set at deploy).
- Legal: privacy page and LFPDPPP review before it ships.

## 6. Imports and exports (step 6)

NetBox first, both ways (so clients are not afraid of lock-in). Then nmap XML,
UniFi/Omada, MikroTik `/export`, Cisco CDP and MAC tables, Lansweeper and
phpIPAM. Every import goes through the merge.

## Order

1. Fix A and B, add restore points (no format change).
2. Merge into…, plus the three-way merge for edited copies (format v17).
3. Mobile batches B4 and B5.
4. The client-provider loop without a server.
5. The portable server.
6. Importers and the published format spec.

## Status

- [x] 1. Data safety: A, B, restore points (built 2026-11-09, not yet committed).
  Follow-up: "Changes since the last back-up" (js/changes.js docChanges) still
  ignores providers, columns, tableView, searches, expectedLife and fields
  outside each kind's list; it needs new changeRows kinds and translations.
- [ ] 2. Merge.
- [ ] 3. Mobile B4, B5.
- [ ] 4. Client-provider loop.
- [ ] 5. Server.
- [ ] 6. Importers and spec.
