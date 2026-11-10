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
- Format v17 added the `log` and the base revision (section 3); format v18
  adds `incidents` and the log's `incident` and `visit` kinds, and makes an
  item's provider a list (several providers per item).
- Mobile batches B4 and B5 (docs/MOBILE.md) were to come first: step 4 was
  built before them, every new surface phone-first (D34).

### Decisions made building step 4 (2026-11-09), for the owner

- **D34** (owner to confirm). Step 4 was built before Mobile B4 and B5, against
  the Order below: every new sheet, banner, strip and list is phone-first
  (targets of 44px or more on touch screens, no horizontal scroll at 360 and
  390, checked in a browser), and the map overlays are registered with the
  map's overlay list.
- **D35.** Several providers per item (`providers: [id]` on devices, cables
  and groups; no "main" one: the role is the service). Inheritance is per
  service: an item's own, then for each service it names nobody for the host
  chain (container, VM, server), then the group chain innermost first, of the
  outermost host. A provider with no service counts as Other, so it never hides
  the group's ISP. A cable inherits nothing.
- **D36.** The list is stored in `doc.providers` order, no key when empty; the
  field is `providers` everywhere (bulk, CSV target keys), the CSV headers stay
  `provider` and `cable_provider`, the cell joins names with "; ", a name with
  a ";" or shared by two providers is written as its id, and a single-name
  sheet from before v18 still reads. Bulk Set fields offers Add one, Remove
  one, Only one and None (no multi-pick "set exactly").
- **D37.** Provider lists and a report's devices, providers and visits merge as
  sets: two-way their union, three-way each side's additions and removals; a
  row that combines both says "Both: …". Never a question: removing a provider
  record the other side still uses stays the J4 conflict.
- **D38.** A report's state is ordered by (reopened, status): Reported < Sent <
  Visited < Fixed within a round, and Reopen starts a round up (`reopened` + 1,
  status open, the close date and note cleared). A merge takes the higher
  state without asking, so an older closed copy cannot undo a reopen; the
  earliest first send wins.
- **D39.** A merge never removes a report; only the cap of 200 does (oldest
  closed first), and a report the cap dropped does not come back with an older
  copy. There is no Delete for reports: closing is the end, history only grows.
- **D40.** A visit's log entry carries the provider's name as it was, because
  log entries are never remapped; what changed is stored in no language
  (`{kind, id, name, status}`, at most 200, with counts), translated when shown,
  and leaves the reports and the log out. A second visit in one session
  compares with the copy the first sent back.
- **D41.** Routing walks the cables breadth-first from each device to the
  network's edges (internet clouds not standing for another site; with none,
  the routers and firewalls), the shortest path to each edge, so both lines of
  a multi-WAN site show; it does not chain locatePath, which walks down from a
  router (amendment 1). VPN links and host-guest ties are not walked; a VM
  starts at its host. Then the power providers for a power cut (no UPS device
  kind exists: a device naming a Power / UPS provider stands for it), the
  place's groups, and every other provider of the network ("listed for this
  network"). Nothing is hidden: another service ranks after, unknown hours
  never drop a provider. Hours are read in this browser's local time.
- **D42.** A report always leaves locked (AES-GCM link with a new passphrase)
  or as a file: a network link over 16,000 characters (`DOC_URL_MAX`; the
  samples' locked links measure about 980 to 4,400) or a page that cannot lock
  one sends `…_incident.json` to attach. The share dialog gets an **Include
  problem reports and visits** tick, off each time (it drops the reports and
  their log entries, and an entry whose predecessor is dropped loses its
  `prev`); a back-up file keeps them.
- **D43.** A `mailto:` over 1900 characters leaves the link out ("The link is
  in your clipboard: paste it here") and Email copies the link; if still too
  long the client's words are shortened in the email only. With a real locked
  link this is the usual path.
- **D44.** The copy back is locked with the passphrase that opened the
  incoming link, held in memory only; with none held (a reload, a file), a new
  one is shown to send another way.
- **D45.** The copy back names as its base the revision the provider received:
  set when a link arrival enters provider mode and is not kept here; a kept
  card already names it.
- **D46.** The v18 bump changes each network's content hash once (it includes
  the version), so the first copy of a kept network that leaves gets a new
  `rev` with no edit. Harmless: the old one goes to `prior`.
- **D47.** The arrival banner shows for link and file arrivals only (and for a
  merge that brings a report not open here before). A copy of a network kept
  here whose report is further on, or carries a visit the card has not got (a
  second provider's), gets the visited banner with **Merge into my network**.
- **D48.** Saving a report keeps the network in this browser first, so a visit
  sent back has a card to merge into; a link's copy of a network already kept
  is not claimed (Keep this network asks about the merge).
- **D49.** Provider mode borrows the full editor for the tab and never saves
  it as the view; it comes back on a reload from the tab's session; `#provider`
  typed is consumed and does nothing else (a fresh load would open the
  example). The technician's name is the report's Prepared by name.
- **D50.** The client's side: a **Problems** tab in the full editor (shown once
  a report exists, counting the ones not closed), lists in the Simple views
  (every open one with nothing selected, the device's own when one is), an
  amber ! at a device's bottom-left on the map (not exported), the landing
  card's Open problems line with a ⚠ tool, and the report's **Problems and
  visits** tick, off by default because it prints the reporter's contact. Mark
  fixed asks for an optional note. The network log tells report and visit
  entries in the reader's language; their stored `summary` stays English.


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
- **Owner decisions (2026-11-10).** The client always hosts it (Carino does
  not run a shared one). Sign-in is by email (a one-time code or link sent
  through the client's own SMTP). Notifications go by email only, through the
  same SMTP.
- **What E2E means for these** (2026-11-10). An email sign-in proves who someone
  is; it never carries the encryption key. Each browser holds its own key pair;
  an owner prints a recovery key at setup; access to a site is granted by an
  owner's browser wrapping the site key for the new member, never by the
  server. The server cannot read a network, so it cannot merge: a browser pulls
  the latest revision, merges with the existing engine and pushes; the server
  only refuses a push whose base is stale. Notification emails carry no network
  content ("A provider recorded a visit. Open Topo to see it."), and the site's
  name only if the owner allows it. Setup asks for the client's SMTP (Microsoft
  365, Google Workspace, the ISP's), without which sign-in cannot work.

### Backups and drives (opt-in, owner-approved 2026-11-10)

- **Sync and backup are separate.** The server is the live copy and the only
  sync path (every edit, visit and merge goes through it and the merge). A
  drive never is: Drive, OneDrive and Nextcloud resolve two writers with
  "conflicted copy" files and would lose or duplicate work. A drive only
  receives backups, one way.
- **Destinations**, one setting, off by default: a folder on the server (a USB
  disk, a share, or a folder the OneDrive / Google Drive / Nextcloud desktop
  client syncs, so no outside sign-in at all); WebDAV (Nextcloud, ownCloud,
  Synology, QNAP); S3-compatible (Backblaze, Wasabi, MinIO, AWS); Google Drive
  and OneDrive directly through rclone's Go backends, asking only for access
  to Topo's own folder (`drive.file`), not the whole drive.
- **What is written:** an encrypted snapshot of each site on a schedule and
  after every merge or visit, named `topo_<org>_<site>_<date>.json`, kept 7
  daily, 4 weekly and 12 monthly, encrypted with the client's key so the drive
  company cannot read it either. A readable copy is a separate opt-in with a
  warning (anyone with the drive could read it, passwords in notes included).
- **Restore** from the server's backup list or by opening the file in Topo;
  both go through the restore points and the merge, never a silent overwrite.
- **Checks:** a weekly test that the latest backup opens and its hash matches;
  a failed backup emails the owner.
- **Without a server:** on Chromium browsers (Chrome, Edge) the app can write
  its back-ups to a folder the user picks (File System Access API); a OneDrive,
  Drive or Nextcloud folder is then uploaded by its own sync client. No outside
  request, so it fits today's rules. Safari and Firefox keep the download.
- **Order:** 5a the server itself (sites, roles, email sign-in, sync through
  the merge, email notifications); 5b backups to a folder and WebDAV; 5c S3,
  then Drive and OneDrive direct; installers and the desktop app's built-in
  server alongside. The serverless folder save can ship on its own at any time.

### Decisions made building step 5a (2026-11-10), for the owner

How a client runs it: docs/SERVER.md (hosting, TLS, SMTP, backups until 5b,
the threat model). What a client sees: docs/FEATURES.md, The Topo server.
Tests: tests/README.md, The Topo server.

**The program**

- **D51.** One static Go binary, `topo-server`, in `server/` (module
  `carino.systems/topo/server`): the standard library plus the pure-Go
  `modernc.org/sqlite` v1.62.0, so `CGO_ENABLED=0` builds work for Linux,
  macOS and Windows on amd64 and arm64 (`make cross`, one at a time). `go mod
  tidy` sets the directive to `go 1.26.0` (sqlite's own minimum); the builder
  image is `golang:1.27-alpine`. Subcommands: serve, healthcheck, version,
  setup-token, mail-test.
- **D52.** E2E needs a secure context, so plain http is allowed only on
  loopback. The server refuses to start on another address unless built-in
  TLS is set (TOPO_TLS_CERT/KEY, read again hourly and on SIGHUP) or
  TOPO_PUBLIC_URL is https (a reverse proxy, recommended: Caddy and nginx
  examples in SERVER.md). No ACME. A container listening on `:7380` with a
  loopback public URL starts with a loud warning to publish on 127.0.0.1 only.
- **D53.** The server owner is TOPO_OWNER_EMAIL, made sure of at every start
  and sign-in (promotes and re-enables, never demotes; the admin API refuses
  to demote or disable it). Without it, while there is no owner, a new setup
  token is logged at every start (and `topo-server setup-token` mints one); the
  sign-in that presents it becomes the owner and burns it. "First sign-in on an
  empty server wins" was rejected: whoever reached a newly exposed server first
  would own it.
- **D54.** Sign-in codes: 6 digits, 10 minutes, single use, 5 tries, a newer
  request supersedes; stored as HMAC-SHA256 under `server.key`, compared in
  constant time. At most 10 failed codes per email per 24 h across all codes
  (B1). The magic link is a separate token in a fragment (`/#signin=`),
  consumed only by a POST after a tap and only in the browser that asked (a
  challenge cookie), so mail scanners consume nothing. A code needs no cookie:
  it can be typed anywhere the email is read.
- **D55.** No user enumeration: every request answers 202 with a challenge
  id; an address that may not sign in gets a decoy that never verifies, does
  the same database work, counts against the same limits and sends nothing
  (responses equal byte for byte but the id). Who may get a code: users, an
  address with a pending invitation, the owner email, the setup token's
  holder. Limits: 5 per 15 min and 20 per day per email, 20 requests and 30
  failures per hour per IP (IPv6 by /64), 60 invitation peeks; the browser
  that already asked has its own allowance (B2), so a flood from elsewhere
  delays but does not lock out (the link still works; SERVER.md says so).
- **D56.** Sessions: 32 random bytes, only the SHA-256 kept; cookie
  `__Host-topo_s` (HttpOnly, Secure, SameSite=Lax) or `topo_s` without Secure
  on a loopback http server; 30 days idle, 90 days in all, touched at most
  hourly; list, revoke, sign out everywhere else. Signing in drops the
  browser's other session and the challenge cookie (B4).
- **D57.** CSRF: every non-GET `/api` request needs `X-Topo: 1`, a JSON body,
  and an Origin equal to the public origin (loopback: any loopback host on
  the same port), or with no Origin a `Sec-Fetch-Site` of same-origin or none.
  No CORS headers at all. A Host allowlist (421) guards against DNS
  rebinding. GET never changes anything.

**Keys and access** (the browser: js/servercrypto.js, WebCrypto only)

- **D58.** Each person has one user key pair (ECDH P-256 to unwrap, ECDSA
  P-256 to sign); each browser a device key (ECDH P-256, non-extractable, in
  IndexedDB `topo_keys`). The server holds the user keys wrapped once per
  browser and, optionally, escrowed under a 128-bit recovery code (26 symbols
  of the passphrase alphabet plus 2 check symbols, HKDF, not PBKDF2). Long-lived
  CryptoKeys are never extractable. Everything is ECDH, HKDF-SHA256, AES-GCM-256
  (no AES-KW); signatures are P1363 and checked by Go too (shared test vectors,
  tests/gen-vectors.mjs). Linking a browser shows a code over the new
  browser's key **and** the person's own keys, and after any unwrap the browser
  derives the public keys from the bundle and refuses ones that differ (A2).
  Wraps sign `by` and the salt (A4).
- **D59.** Site keys are wrapped to a member's user key, not to each browser:
  linking a browser re-wraps one bundle, not every site.
- **D60.** The member list (roster: members, roles, key fingerprints, epoch,
  seq) is signed by an owner and kept by the server as a blob it checks but
  is not trusted for; browsers walk it from seq 1 and accept each only when an
  owner of the previous one signed it. Revisions and wraps are accepted only
  from an owner or provider in force. The server checks wrap and roster
  signatures as well (cheap, so a bad one fails early), and `GET /rosters`
  also returns the members' current public keys, used only when they match a
  trusted roster line.
- **D61.** Give access is an owner's tap, never automatic. The newcomer's card
  shows their safety code (80 bits, 24 digits, A1; every member row shows one
  too); the owner's sheet asks "Does {email} see the same code?" with **Yes,
  give access** and **Give access without checking** (marked "Not checked").
  The newcomer sees "Waiting for the owner to give you access". The owner is
  told by the member-joined email, a dot on the card and the account, and the
  row in Members. A re-grant after someone's keys changed is red and needs the
  check (A6). "Also the older history" is ticked by default (all epochs).
- **D62.** Removing a granted member rotates the site key (a new epoch); the
  server deletes their wraps and refuses pushes under the old epoch. Only new
  revisions are protected: what they downloaded stays with them. Removing
  someone still waiting needs no rotation (they hold no key). A role change
  needs only a new roster. Someone who leaves keeps the old key until an owner
  presses Rotate (always offered in Members; not prompted yet).

**Sync**

- **D63.** Revisions are full encrypted snapshots in a signed hash chain. The
  server's numbers and hashes never enter the document (no format change, no
  v19): the ciphertext carries `{v, id, name, rev, base, prior, doc}` so the
  v17 rev token is the same in every browser, and the browser maps server
  numbers to rev tokens in its own sync record (index in localStorage, base
  documents in IndexedDB). The merge base is the plaintext of the last server
  revision, never looked up through the revision store. 'server' records in
  js/revisions.js are evicted first and kept to 3 per card (C1), so binder and
  link merges keep their bases. Middle revisions whose author's key is unknown
  are checked by the chain only; the head's signature always.
- **D64.** A push on a stale base gets 409; the browser pulls and then: no
  local changes, a fast-forward (one undo step, no log entry, no restore
  point); changes that merge cleanly, a quiet merge (one log entry from "the
  server", no restore point) and a push; conflicts, the card says Needs merge
  and the existing review opens only on a tap (with a restore point), always
  against the newest server copy (C5). Whether a card has changes is judged by
  content hash (C2). The open document is saved first and an update waits
  while someone types or drags, at most 15 s (C3). A lost base is fetched
  again, or the review is two-way (C4). A document newer than this build shows
  "update needed" (C7). Rollback or a fork shows "The server sent an older or
  different history" and stops pushing; **Trust the server's history** merges
  this copy onto the server's head and pushes (A3: rseq and epoch only rise).
- **D65.** Live updates by Server-Sent Events (`/api/events`, 20 s ping), not
  long-polling; plus a check on coming online, on the tab showing, after a
  save. One sync per site at a time (navigator.locks); the server's 409 keeps
  it correct regardless.
- **D66.** Detection makes no request on a static host: the server injects
  `<meta name="topo-server">` into index.html and js/server.js does nothing
  without it (no fetch, no listener, no UI; `#signin=` and `#invite=` behave as
  before, E1). Same origin, so the meta CSP keeps `connect-src 'self'` and
  needs no per-deploy entry (this replaces "one connect-src entry, set at
  deploy" above). The header CSP is the page's own policy plus
  `frame-ancestors 'none'` (E2). `/api/health` also says `signedIn`, so a
  signed-out page makes no 401 call.
- **D67.** Notification events are declared by the browser at push time from
  the base and the pushed document (one function, `deriveEvents`):
  incident-sent and incident-closed to the routed providers who are members
  (matched by email), visit-recorded to the reporter's member; member-invited,
  member-joined and granted come from the server only. An author may declare a
  problem to the same person at most 5 times per site per hour (F2), and an
  event never fails a push.
- **D68.** The site name is encrypted with the epoch key; an owner may allow
  it in clear for emails, with the warning that the host can read it. The
  decrypted name always wins for display (A8). No email carries network
  content.
- **D69.** Storage: SQLite in the data folder (WAL, one writer, a read-only
  pool; check-then-write in the driver's immediate transactions, D2),
  migrations embedded and numbered (PRAGMA user_version; a newer database
  stops an older server). Revision bodies in their own table behind a
  `store.Blobs` interface where 5b/5c plug in (D3). TOPO_REV_CAP (500) bodies
  kept per site, headers forever; TOPO_SITE_MAX_BYTES (2 GiB) drops old bodies,
  then refuses (`site-full`). Signature and hash checks run before the write
  transaction (D1). 20 concurrent pushes on one base: exactly one wins.
- **D70.** The app is embedded from `desktop/stage.sh`'s output (the offline
  zip's allow-list), every file with an ETag and `no-cache`; `/api/health`
  reports `appHash` to compare with a release. The run.sh suites never reach
  the binary; tests/server-e2e.mjs does.
- **D71.** Client addresses come from X-Forwarded-For only from
  TOPO_TRUSTED_PROXIES.
- **D72.** Server roles: owner (runs it), staff (may put networks on the
  server), member (came by invitation, may not). Site roles are separate:
  owner, provider, viewer.
- **D73.** Container: `distroless/static-debian12:nonroot`, `VOLUME /data`,
  HEALTHCHECK `topo-server healthcheck`, podman first (`--format docker` keeps
  the health check), a Quadlet and system and user systemd units in
  `server/packaging/`.
- **D74.** Mail: `smtp` (STARTTLS on 587 refused if not offered, implicit TLS
  on 465, plain only to a loopback relay; AUTH PLAIN, LOGIN when that is all
  there is), `file` (one .eml each plus `mail/outbox.jsonl`, for tests) and
  `log`. Sent from a durable outbox, never from a request; a global cap per
  minute; retries 1, 5, 15, 60 min, given up after 8. Header injection guarded
  (B7). Sign-in emails in the language of the page that asked, others in the
  person's chosen one.
- **D75.** A provider member needs no links: "who am I" is the document's
  provider whose email is theirs; Send to providers who are all members is
  "Sent through the server", a visit is "Saved to the server". Otherwise the
  link and file path stays, for everyone on that send.
- **D76.** Private windows and browsers without IndexedDB keep keys in
  memory, a new browser each time; the account sheet says so.
- **D77.** Losing every browser without the recovery code is "Reset my keys":
  new keys, memberships back to waiting, owners told. A site whose only owner
  loses everything cannot be read again; setup makes owners keep the code (a
  tick) and suggests a second owner.
- **D78.** One tab per browser holds the live stream and passes events to the
  others (navigator.locks and BroadcastChannel, C8); the server allows 12
  streams per person and 500 in all.
- **D79.** Pushes are grouped: 5 s of quiet, at most a minute apart (C6),
  checked against the server's size limit first.

**Found while building**

- **D80.** Six email choices, not five: "revision" for sites you own (on) and
  "revisionShared" for sites shared with you (off), then visit, incident,
  closed and join (on). A per-site mute. A push's revision digest skips anyone
  who got an event email from the same push; a digest due while the person has
  a stream open is skipped. Event emails wait TOPO_NOTIFY_EVENT_SECONDS (120)
  and merge repeats; the end-to-end test sets 0.
- **D81.** Footers: emails a person can turn off end "Change them under
  Account, Notifications"; the others "This email was sent by the Topo server
  at {url}"; the sign-in email has none.
- **D82.** Site ids are minted by the browser (D4: the roster and the wraps
  must name the site before it exists); `POST /api/sites/new-id` was dropped.
  An invitation can be accepted by token or, signed in as its address, by id.
- **D83.** Not a member is 404 (ids are not confirmed); a member without the
  role is 403. Errors are short codes the browser shows as translated
  sentences (E4).
- **D84.** No Cross-Origin-Opener-Policy (js/report.js keeps a handle to the
  report tab it opens).
- **D85.** One generic sheet (`#serverSheet`) serves every server dialog, a
  full-height sheet on phones; every string a client sees is in all five
  languages.

Left for later (not in 5a): a per-session list with revoke in the account
sheet (only "sign out everywhere else"); "Keep my copy as a separate network"
for a viewer; the Problems tab line naming a provider who is not on the server
(mixed sends fall back to links for everyone); the "Undid changes from the
server" toast and "Newer changes arrived: review again" during a review;
prompting Rotate on `roster-needed`; a two-tab test of the leader tab with a
real IndexedDB; padding of revision sizes.

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

- [x] 1. Data safety: A, B, restore points (2026-11-09, 4c17d69, 749ecce).
  Follow-up done 2026-11-09: "Changes since the last back-up" (js/changes.js
  docChanges) now has rows for providers, custom columns, saved searches,
  expected lives and the table layout, names a field outside a kind's list as
  "changed: <field>", and says any part docChangeCount counts that no kind
  describes; tests/suites/changecount.js cross-checks every top-level key.
- [x] 2. Merge (2026-11-09, d465707). Format v17 (rev, base,
  prior, log) and the revision store (js/revisions.js); the merge engine
  (js/merge.js); apply, the network log and its report tick (js/mergeapply.js);
  the review (js/mergeui.js); every door (js/mergedoors.js, js/library.js,
  js/app.js). Decisions D1–D33 above.
- [x] 3. Mobile B4, B5 (2026-11-10, 370dabc). Touch targets
  M21-M29 on any touch screen and held by the touchsizes suites (M60); screen
  space M30-M38 (the docbar chip, landscape phones, the rack's pane switch, the
  search ⋯ menu); M50; leftovers from steps 1, 2 and 4 (singular counts,
  Japanese sentence joining, file names as typed in titles, My networks in the
  drawer header, provider mode on the Map, share links without `?lang=`).
  docs/MOBILE.md "How batches 4 and 5 landed" and its decisions for the owner
  (M37 decided: whole map when it fits at 0.33).
- [x] 4. Client-provider loop (2026-11-10, 370dabc). Format
  v18 (several providers per item, `incidents`, the log's `incident` and
  `visit` kinds; schema/topo-v18.json); routing (js/routing.js); Report a
  problem and Send (js/incidents.js); provider mode, Record visit and the copy
  back (js/providermode.js); the client's side: the merge review's rows, the
  Problems tab, the Simple lists and marker, the landing line, the report's
  tick. Built before step 3 (D34, owner to confirm). Decisions D34–D50 above.
- [~] 5. Server. 5a done 2026-11-10 (not yet committed): `topo-server`
  (server/, Go, SQLite), email sign-in, sites with roles and invitations,
  end-to-end encryption in the browser (js/servercrypto.js), sync through the
  merge (js/serversync.js), email notifications, the client (js/server.js,
  js/serverui.js), docs/SERVER.md, tests/server-e2e.mjs. Decisions D51–D85
  above. Next: 5b (backups to a folder and WebDAV), then 5c.
- [ ] 6. Importers and spec.
