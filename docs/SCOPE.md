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
  already holds a binder) goes through the same binder merge as the binder
  file and binder link doors (js/mergedoors.js): this browser's own older
  copies are up to date, an edit made in the file is merged on its own when it
  merges three-way with nothing to decide (a restore point and a log entry
  each), and the rest are listed in one summary (Review…, Replace with theirs,
  Keep as a copy, Skip). Skip writes yours over the file's copy (D5); Cancel
  cancels the back-up. Newer-wins is gone from every door.
- **Three-way merge for edited copies.** A file records the version it was taken
  from (a base revision), so a copy coming back is merged against that base and
  edits on both sides survive. This replaces the newer-wins Update. Format v17.

### Decisions made building step 2 (2026-11-09), for the owner

Design decisions (the design and its review, D1–D17):

- **D1.** The network log is identity for change counting: docChangeParts and
  "changes since" ignore it, and a merge unions the two logs (by entry id)
  instead of reviewing them. Otherwise every merge would make every other copy
  look different.
- **D2.** One landing tool, **⇄ Merge…**, with two answers (a file into this
  network, this network into another), on network cards only: templates and
  blocks are never merged or merged into (the spec's "on any card" narrowed).
- **D3 (corrected).** The known-copy question keeps **Open mine**: Cancel does
  not open yours, it leaves everything as it was.
- **D4.** The review names fields by the table's column labels, translated.
- **D5.** At Back up all, a bound-file copy skipped in the summary is replaced
  in the file by yours (the button says so). Blocking the back-up would be worse.
- **D6.** Serial number is a matcher for the merge only; the CSV importer could
  take it later (one line).
- **D7.** Added devices keep their own layout as a block, anchored on their
  group's frame first, then the cable to one of yours, then beside the map; a
  single device takes the ring spot beside its anchor.
- **D8.** A device that matches several of yours is a conflict that defaults to
  Skip, offering each candidate or Add as new. Never a guess.
- **D9.** At binder doors only a three-way merge with nothing to decide goes
  through on its own; everything else is a summary row defaulting to Skip.
- **D10.** The revision store is its own IndexedDB database
  (`nettopo_revisions`): 30 per network, about 40 MB in all, a card's own rev and
  base never dropped; dropped with the card. A network nobody kept keeps its
  revisions in the tab only.
- **D11.** The log's hash chain is per document: entries brought in are chained
  again here. It shows an entry was edited after it entered this network, not
  where it came from.
- **D13.** A copy also carries `prior`, the up to 8 revs it carried before, so a
  second file from the same technician session still finds the first as its base
  (otherwise it merged two-way and the technician's corrections lost by default).
  Built ahead of the owner's answer; it can be dropped.
- **D14.** Links (single and binder) carry the newest 50 log entries (binder
  links are capped at 12000 characters); files carry up to 500. The entries left
  out come back by id at the next merge.
- **D15.** The base a copy goes out with is derived from the log (the newest
  merged rev this network holds), so undo and restore points move it with the
  merge. A card's own `base` is only where it started.
- **D16.** A copy your network already has everything of is never merged (it
  replaced D12's "already merged"): it left from here unchanged, or its merge is
  still in your log, or its content is a revision that left from here, or it is
  your last back-up. Undo the merge and the copy is offered again.
- **D17.** A copy from before revisions (no rev, no base) edited after your last
  back-up is compared with that back-up; older, it merges two-way. Built this way
  it is never merged on its own at a binder door (a guessed base could remove
  things): it is always a summary row.

Decisions made in the build:

- **D18. Replace with this copy** is the old Update, renamed, without a count
  (the review's counts are the merge's): step 1's warning and restore point stay.
  It is offered for every copy, including an ancestor (to roll back on purpose).
- **D19.** The unknown-file question (Open as its own network / Merge into a
  network…) is asked only when there is a network to merge into. Dismissing it
  cancels the open, as every question's dismissal does.
- **D20.** From a file or a link, the target opens only when the merge is
  applied, and its restore point is taken before it opens: Cancel in the review
  (or in the restore-point question) leaves the screen as it was.
- **D21.** A base is only ever a revision held under the network merged into
  that it grew from (emitted, opened as, or merged and still logged), never one
  held under another network or only in the tab: a wrong base would read their
  missing devices as removals.
- **D22.** A copy whose `rev` is yours but whose content changed after it left
  (edited by hand) is compared with that rev, not treated as yours.
- **D23.** Binder rows for a template newer than yours, a site from a newer
  Topo, or a network of yours from a newer Topo offer Replace, Keep as a copy
  and Skip only (no review). An older or equal template copy is left as it is.
- **D24.** A network's name is not merged: a copy whose content is the same as
  yours is up to date whatever it is called (a rename made only on another
  machine stays there).
- **D25.** The binder summary's Cancel writes nothing (merges already reviewed
  stay); when binding a file it does not bind; at Back up all it cancels the
  back-up. A site skipped from the link shelf stays on the shelf.
- **D26.** After a binder, the offer to read older copies into the address
  history covers only the copies left as they were (skipped or up to date).
- **D27.** (Review fixes, 2026-11-09.) Pointing at a record is editing it, for
  the removal rules: a group, custom column, provider, Wi-Fi network or subnet
  one side removed while the other started using it (a device put in the
  group, a custom value filled, a provider assigned, a cable on the SSID) is a
  "removed on one side, edited on the other" conflict that keeps it by
  default. The same for an interface one side removed while the other plugged
  a cable into it. A cable the other side removed only along with its device
  follows that device's answer (kept with it, or gone with it).
- **D28.** A range or name that must stay unique (a subnet's range, a saved
  search's or a custom column's name) never takes theirs where the result
  would hold it twice: that field is a conflict defaulting to yours, and if
  theirs is chosen anyway yours stays and a note says why. A record of theirs
  to add whose range or name one of yours has is not added, with a note. So a
  merge never drops a record of yours behind its counts.
- **D29.** A returning copy's base is the NEAREST revision it names that this
  network grew from (the one held here last), not the first it names: after a
  cross-merge a copy's own older rev (prior) and the merged copy (base) can
  both be held here, and the older one would bring back deletions.
- **D30.** In two-way, an id match is also contradicted for providers (another
  name: the simple samples' pv_isp is a different ISP in each), Wi-Fi networks
  (another SSID) and groups (another kind, or another name under another
  parent). A contradicted one is added under a new id. A group renamed in place
  (same kind, same parent) is still the same group, its name a conflict.
- **D31.** A link visited, edited and then merged at Keep: the revision it
  arrived with is recorded as the link was when it arrived, never as the
  edited canvas, so a later copy naming it does not read the edits as removed.

- **D32** (owner, 2026-11-09). In a two-way merge a field filled in yours and
  blank in theirs keeps yours quietly: no conflict row. A technician's partial
  file only says what it says.
- **D33** (owner, 2026-11-09). In a two-way merge an interface of theirs with
  no name, address or MAC is the device's next interface of yours with no
  cable on it, not an extra one; with none free it is added.

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
  Follow-up done 2026-11-09: "Changes since the last back-up" (js/changes.js
  docChanges) now has rows for providers, custom columns, saved searches,
  expected lives and the table layout, names a field outside a kind's list as
  "changed: <field>", and says any part docChangeCount counts that no kind
  describes; tests/suites/changecount.js cross-checks every top-level key.
- [x] 2. Merge (built 2026-11-09, not yet committed). Format v17 (rev, base,
  prior, log) and the revision store (js/revisions.js); the merge engine
  (js/merge.js); apply, the network log and its report tick (js/mergeapply.js);
  the review (js/mergeui.js); every door (js/mergedoors.js, js/library.js,
  js/app.js). Decisions D1–D33 above.
- [ ] 3. Mobile B4, B5.
- [ ] 4. Client-provider loop.
- [ ] 5. Server.
- [ ] 6. Importers and spec.
