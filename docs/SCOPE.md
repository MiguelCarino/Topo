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
  link this is the usual path. *Amended 2026-11-10 by D86:* the `mailto:`
  never carries the link, long or short (the long/short split is gone); Email
  always copies it, as a hyperlink, and the body has an "Infrastructure link:"
  line to paste under. Words over 1900 characters are still shortened in the
  email only.
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
  and OneDrive directly through small clients of Topo's own (D109; this line
  said "rclone's Go backends" before), asking only for access to Topo's own
  folder (`drive.file`; OneDrive's app folder), not the whole drive.
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
  from an owner or provider in force. *Replaced for providers by D154 (built in
  step 7b, 2026-11-11): revisions only from an owner; a provider uploads a
  visit copy.* The server checks wrap and roster
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
  *Replaced for providers by D154 (built in step 7b, 2026-11-11): a
  provider's browser no longer merges a 409 and pushes; it syncs read-only.*
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

**The infrastructure link (owner's decisions, 2026-11-10)**

The owner: "On web, when sending an issue report, should open the mail
client and paste THE link in the message. The link should be an hyperlink in
the text 'Follow the infrastructure link'." Then: "On client side, open the
mail program. On server, send the mail; if no SMTP config is registered,
open the mail program." And the link, tapped on a phone, opens the network
in Topo on that phone.

- **D86. Client side: the mail program, the hyperlink by the clipboard.**
  (Amended by D94: the copy runs on every press.) A
  `mailto:` carries plain text only, and a page can neither paste into the
  mail program nor put "text with a hidden URL" in a `mailto:` body. So
  **Email** (the report's, and the visit's **Email the client**) first copies
  the link as rich content: `text/html` `<a href="URL">Follow the
  infrastructure link</a>` (translated) and `text/plain` the URL, one
  ClipboardItem (`writeText(URL)` where ClipboardItem or `clipboard.write` is
  missing or refused), then opens the `mailto:` with To, the subject and the
  plain message. The body never carries the raw link: in its place a line
  "Infrastructure link:" and an empty line under it, where the client pastes
  (D43's long/short split is gone). The passphrase line stays ("comes
  separately"). The send step then says: "Your mail program is open and the
  infrastructure link is copied. Paste it under "Infrastructure link:"
  (Ctrl+V, or on a phone press and hold, then Paste)." A copy that fails keeps
  the old behaviour: the link is shown and selected, and the next press opens
  the mail program. **Copy message** copies the whole message rich (the
  subject in bold, the hyperlink, the reporter's phone as `tel:` and email as
  `mailto:`) and plain (the raw URL, "Follow the infrastructure link: URL").
  **Share…** stays plain text with the raw URL (share sheets take text). A
  visit's **Copy link** stays the plain URL. The clipboard is a hook
  (`TopoIncidents.hooks.copyRich`) the suites stub.
- **D87. On a Topo server: the server sends the email.** (Amended by D95:
  it waits for a press of Send by email; D97 adds the attachment.) When the chosen
  providers are not all members (so D75's "Sent through the server" does not
  apply), **Save and send** makes the locked link as before, then, if the
  server can send mail, one request `POST /api/sites/{id}/report-mail` emails
  it to the chosen providers' addresses; the step says "Sent by email from
  the server to {names}. Send the passphrase another way, such as a call or a
  text." and keeps **Copy passphrase** (the passphrase never goes by the
  server). Whether the server can send is `/api/me`'s `mailRelay` (true for
  `TOPO_MAIL` smtp or file, false for log). No relay, more than five
  addresses, a refusal (429) or no answer: the step stays the mail-program
  one (D86) and says why in one line ("This server cannot send email, so
  Email opens your mail program.", "The server has sent all the reports it
  may for now, …", "The server cannot be reached, …", "The server could not
  send the email, …", "The server sends to five addresses at most, …"). A
  file (a network too big for a link, a page that cannot lock one) is never
  mailed by the server: the mail-program path, to attach it.
  The endpoint (Writer: a granted owner or provider; a viewer 403, anyone
  else 404, D83; the usual CSRF and Origin checks): `{ to: [1–5 bare
  addresses], subject (≤200 characters, control characters flattened),
  lines: [plain text, ≤60 lines, ≤6000 characters], link, phone? (≤40,
  becomes a tel: link), passphraseNote?, lang }`, 202 `{queued}`. The server
  builds the text and HTML itself from a fixed template (internal/mail
  `renderReport`): the lines escaped, the link as a hyperlink "Follow the
  infrastructure link" (plain part "Follow the infrastructure link: URL"),
  the phone as `tel:`, the passphrase note, and the footer "This email was
  sent by the Topo server at {url} on behalf of {email}. Reply to write to
  them." No client HTML is ever sent. **The link must start with the
  server's own public origin** (`TOPO_PUBLIC_URL` + `/`, same scheme and
  host:port, no user info) or the request is refused (400 `link`): the
  server cannot be used to mail anyone an arbitrary link. From is the
  server's configured From, **Reply-To the signed-in person**. Limits: 10
  sends per person per hour and 30 per site per day (one request is one send,
  whatever the number of addresses); 429 with Retry-After and `limit`
  (`user` or `site`); in memory, so a restart refills them. One outbox row
  per address (kind `report`), sent by the worker like every other email
  (never from the request), the data blanked once sent; a log line names the
  site, the person and the masked addresses. The client's lines leave out
  the link and the reporter's phone (the template adds both).
- **D88. Members' notification names the link the same way.** The
  `incident-sent` email (D67, to providers who are members) reads "Follow
  the infrastructure link" in all five languages: a hyperlink in HTML,
  "Follow the infrastructure link: URL" in text. Its link is the server's
  address (a member signs in and opens the site there); still no network
  content.
- **D89. The link is a public web address.** Share links are built on
  `publicBase()` (js/state.js): the page's own http(s) address, or
  https://topo.carino.systems/ from a `file:` page or the desktop app
  (`tauri:`, `http://tauri.localhost`), so the link a client sends opens in
  a phone's browser. Checked: the link opens on a 390×844 touch phone in
  provider mode on the Map. A link made on an intranet copy opens only where
  that intranet is reachable (as before). On a server page the link is the
  server's own address, which is what D87 requires.
- **D90.** Server emails say *usted* in Spanish and the client's sheet says
  *tú*, so the anchor text differs by register ("Siga el enlace de la
  infraestructura" in the server's email, "Sigue el enlace de la
  infraestructura" in the client's own clipboard). Japanese: インフラのリンクを開く.

**The provider's part (owner's decisions, 2026-11-10)**

The owner: "At least copy the link when the user presses the mail button, so
the user doesn't have to copy and paste the link manually (if he decides to
mail it), only the password. Client chooses what the link carries." On the
part: "Inherited coverage: yes, give the provider all the items within the
group. Linked devices: include two hops." On the report and the
attachment: "Do as you suggested", "Do attach on servers".

- **D91. The part rule** (js/providerpart.js `providerPart(doc, ids,
  {incidentId})`, pure: it reads a serialized document, never `state`). For
  each chosen provider, their **items**, in full: every device, cable and
  group they answer for, named on it, through its host chain (D35, per
  service) or through a group; and **a group naming them brings all its
  members, nested groups included**, even a member a nearer provider of the
  same service covers (D35 would give it to that one; the part does not).
  Every cable between two items is an item. A host override is not extended:
  a provider named on a physical server gets its guests only through D35, a
  group or a cable hop. Several providers: the union. No chosen provider in
  the network: there is no part, and the whole network goes (as before).
  Ids are the network's own everywhere (the merge back matches by them).
- **D92. Linked devices: two cable hops.** Counted in cables from the items:
  the far end of their cables is hop 1, one cable further hop 2. A VPN tunnel
  is not a hop; a radio association and a patch panel are. No cap: a core
  switch at hop 1 can bring most of a site at hop 2, and the send step shows
  the counts. Also kept as context, at no hop: the hosts every kept device
  runs on (or the loader would drop `host`), and every device a kept report
  names, at any distance ("Where the problem is"; or the report would lose
  where it is). Guests of an item's host are not context. A **linked
  device** keeps only id, type, name, place (x, y, group, `host` when kept),
  its port layout (count, scheme, face), the ports facing a kept cable
  (`portAttrs` and the interface in full: address, MAC, VLANs) and, of its
  other interfaces, those with an address as `{id, name, ip}`. Never its
  notes, vendor, model, OS, serial, asset tag, location, status, upkeep,
  custom fields, rack place, PoE, NAT or providers. **Cables**: every cable
  whose two ends are kept; one between two linked devices goes reduced (ends,
  ports, medium, Wi-Fi). **Groups**: the items' groups and every group (with
  its parents) needed to place a kept device or a kept report. **Providers**:
  only the chosen ones, without the client's notes about them. **Reports**:
  the one being sent, and the chosen providers' reports on their items that
  are open or have a visit of theirs; `routedTo` cut to them, their visits
  only, a visit's changes cut to the part. **Log**: those reports' entries
  and their visits, the "(to n)" summaries recounted, no merge entry (its
  revision would offer a full base and it names sources), chained again from
  the first dropped entry so the provider's copy verifies. **Header**: the
  site and the client only (not the engineer, the reference, the date or
  the scope notes); subnets the kept devices use (by address, VLAN or Wi-Fi),
  their Wi-Fi networks, custom columns the items use, expected lives.
  Accepted findings, pins, annotations, saved searches and the table layout
  stay home.
- **D93. The part's base: absent is not removed.** The part leaves canonical
  (as the provider's loader reads it), recorded here as a revision held as
  `part` with its context ids (linked devices and placing-only groups), and
  named on the card (`card.partRevs`, so a copy naming it is known for a part
  even after its revision is dropped). Its identity is the network's id and
  updated, the new revision, and as base and prior the network's own full
  revisions (so a provider holding an older full copy merges the part
  three-way and does not send stale values back). The card's own revision,
  base and prior are untouched. On the way back (js/mergedoors.js
  `mergeContext`): a copy naming a part may only merge against a `part`
  revision, else two-way, never against a full one (which would read
  everything outside the part as removed). Then: a record the part did not
  carry is unchanged, never removed; a field a linked device went without is
  blank in base and theirs, so the client's value stays; ports and custom
  fields merge per key, so an edit to a facing port merges alone; a provider
  filling a field the client never filled is taken, and one the client has is
  a conflict that defaults to the client's; removing a linked device or a
  context group is a conflict that defaults to keep, and its cables (also to
  devices the provider never saw) stay with it; a record only the provider's
  copy holds whose id any held revision of the card knew (the client deleted
  it since) does not come back. A record the provider adds is matched with
  one of the client's only by id, or (by name, address, MAC, serial, path or
  ends) with one the client added after the part left: never with one outside
  the part the provider never saw (the part keeps every id the network held
  when it left, `part.all`), so a new "AP-9" is added as new beside the
  client's own AP-9 elsewhere. A copy is a part only while a part is the
  newest thing it grew from: one that names an old part in its prior but also
  a full revision held here after it (a whole link the provider merged since),
  which that part did not carry as base or prior (`part.from`), is the whole
  network again and merges against that full revision; a part whose revision
  is gone stays a part (two-way). A part merged back is held as `part` (the
  base of their next return); a whole-network link never names a part as its
  base (`outgoingBase` skips them); the newest 8 parts survive the per-card
  cap of 30 (since 7a, every part until it is answered: D152.1, D176). A part sent from a network not kept is held in the tab and
  adopted with it when it is kept. "Replace with this copy" is never offered
  for a part. What the owner should know: a provider who opens the part on a
  device holding their older full copy ends with the part: merged three-way
  there against that full copy, what the part leaves out reads as removed,
  so their copy shrinks to the part (the client's network loses nothing:
  their copy coming back is still a part).
- **D94. Email copies the link on every press** (amends D86). Every press of
  **Email** (the send step's, and provider mode's **Email the client**)
  copies the link first (the rich "Follow the infrastructure link" and the
  plain URL), then opens the mail program; the client handles only the
  passphrase. The copy is the first await of the press, so it runs inside the
  user's activation in Chromium and Firefox (both checked by
  tests/email-copy-check.mjs). The step then says "Link copied: paste it in
  the email under "Infrastructure link:" (Ctrl+V, or on a phone press and
  hold, then Paste). The passphrase goes another way, such as a call or a
  text." (provider mode: "The client already has the passphrase."). A
  failed copy shows and selects the link and stops once ("The link could
  not be copied. Copy it from the box below; Email opens your mail program
  on the next press."); the next press tries the copy again and opens the
  mail program whatever happens. A press after **Copy passphrase** copies
  the link again.
- **D95. The send step chooses what the link carries.** A row "What the link
  carries": **Only what {names} look(s) after** ({n} devices of theirs, {m}
  linked devices around them), the default every time and never remembered,
  or **The whole network** (as before the part). Hidden when no provider is
  chosen or the send goes through the server to members (D75). Changing it
  makes a new link with no new commit (one undo step for the send), runs
  the password-in-notes check again on the copy as it leaves (a linked
  device's notes do not travel, so they do not warn for the part), and a
  file fallback (too big, no lock) carries the part, never the whole
  network. **Amends D87:** on a Topo server that sends mail, nothing is
  mailed when the step opens; the button reads **✉ Send by email** and the
  server mails the link on that press ("Press Send by email: the server
  emails the locked link to {names}."). After a refusal or no answer it is
  the mail-program Email again.
- **D96. The provider's report, "Your part of this network"**
  (js/providerreport.js, one builder for provider mode, the attachment and
  the Providers tab). A4, 16 x 14 mm margins, in the existing sheet preview
  (Print, Download PDF or HTML by the report format; HTML only without the
  PDF engine), named `topo_<org>_<site>_<date>_<provider>.pdf|.html`.
  Sections: the header (the site, the client, the reporter as the client's
  contact, the date, the provider's own record: service, contact, phone,
  email, contract, hours; the counts); this problem; their devices in full
  (model, serial, asset tag, OS, group path, rack, location, host,
  interfaces with address, MAC and VLANs, ports and VLANs, upkeep, notes,
  and how they answer for it: named on it, through its host, through the
  group); linked devices (Hop 1, Hop 2, "Runs their devices" for a host
  with no hop, "Where the problem is"), with the ports facing theirs and
  their addresses; cables, theirs first, ports both ends; the diagram of the
  part only (drawn before the preview opens); their other open problems;
  their own past visits. No findings: worked out on a part they would be
  false. Titled "Your part of this network" for the provider, "{name}'s part
  of this network" for the client, "The part of this network {names} look
  after" for several (one union report). **CSV**: Devices CSV (their devices)
  and Cables CSV (their cables and every cable at one of their devices),
  `…_<provider>-devices.csv` / `…_<provider>-cables.csv` with the BOM, as
  Topo's CSV importer reads them. The `provider` and `cable_provider`
  columns are left out: the part names only this provider, so read back into
  the whole network they would take other providers off shared devices.
  Read back into the network or into the part, they plan no change. In
  provider mode: "Your part of this network", "Devices CSV" and "Cables CSV"
  under "You look after". Translated (es, pt-BR, ja, ru; Japanese says PC).
- **D97. Also attach the report** (off by default, in the send step's row).
  Ticking it builds the report once (never inside Email's press, which must
  keep its activation: "Preparing the report…", Email disabled meanwhile);
  several providers get one union report. **Mail program**: Email copies the
  link, downloads the report once per build, then opens the mail program;
  the body says "Report: attached ({file})" and the step says to attach the
  file that just downloaded. **Topo server**: the server attaches it, as a
  PDF only, 6 MB at most (an HTML file from the server's own address to any
  five recipients would get around D87's "only this server's link" rule, and
  mail filters hold .html); an HTML report or a bigger PDF is downloaded for
  the client to send. `POST …/report-mail` takes an optional `attachment
  {name, type: application/pdf, dataBase64}` (docs/SERVER.md), stored once
  (not per recipient) until sent, and sent as `multipart/mixed`. **The
  end-to-end exception, chosen by the owner**: the server sends the report
  unlocked, so the dialog says, once the box is ticked on the server route:
  "The server sends the report unlocked, so the server (and whoever runs
  it) can read it. The link stays locked." Rate limits are unchanged.
- **D98. Report for this provider, Share their part.** Each provider card in
  the full editor's Providers tab has **Report for this provider** (the D96
  report, titled for the client; a read-only network still prints it) and
  **Share their part** (the share dialog, mode `doc` with a scope, not a new
  mode: titled "Share their part", the counts in its blurb, no reports row;
  Copy makes a part as in D93 and seals it with a passphrase), any time, not
  only with a problem. A way in from the Simple view is deferred: it has no
  provider line with actions to hang it on.

Left for later (not in 5a): a per-session list with revoke in the account
sheet (only "sign out everywhere else"); "Keep my copy as a separate network"
for a viewer; the Problems tab line naming a provider who is not on the server
(mixed sends fall back to links for everyone); the "Undid changes from the
server" toast and "Newer changes arrived: review again" during a review;
prompting Rotate on `roster-needed`; a two-tab test of the leader tab with a
real IndexedDB; padding of revision sizes.

### Decisions made building step 5b (2026-11-10), for the owner

The server side of backups (stage 1 of 5b). How a client sets it up:
docs/SERVER.md, Backups. The browser side (the settings sheet, restoring,
readable copies, the folder save without a server) follows as D106-D108.

- **D99. Off until turned on, set in the app.** Backups are off until the
  server owner turns them on in Account, Backups. One destination at a time
  (a folder on the server or WebDAV now; S3, Google Drive and OneDrive in
  5c). The settings live in the server's database, not in environment
  settings. The only environment setting is which folders the server may
  write to (`TOPO_BACKUP_FOLDERS`, by default the data folder's `backups`),
  set by whoever installs the server, so a stolen owner session cannot make
  the server write anywhere else. The old reserved `TOPO_BACKUP_*` keys are
  ignored with a log line. Saving checks the destination first (write, read
  back, delete a test file); "save anyway" exists for a disk not plugged in
  yet.
- **D100. What a backup file is.** The network's latest encrypted copy
  exactly as the server holds it, plus each owner's locked key and locked
  recovery copy, the member list in force for that copy and the newest one,
  and the members' public keys. An owner opens it in Topo, with or without a
  server, by typing their recovery key (the browser side comes next). An
  owner who never saved a recovery key can open it only in their own browser
  on that server. The drive company sees the members' emails, the site's id,
  the dates and the rough size, not the network; the server's address is not
  in the file. After a key reset or a new recovery key a fresh file is
  written at once; older files still need the recovery key their owners had
  then, so keep an old recovery key until those files have aged out (12
  months at most). The useful side: a sole owner who reset their keys can
  still open an older backup with the old recovery key.
- **D101. Names.** One folder per network (its id), holding
  `topo_<name>_<date>.json`. `<name>` is the network's name only while the
  owner shows it to the server in clear (the browser sends the file-name form
  of it), otherwise `network-<the last 8 characters of the id>`. Later files
  of the same day get the time (`_HHMM`, then `_HHMMSS`), server local time.
- **D102. When.** About 2 minutes after someone stops editing (30 seconds
  after a visit), and at least every 15 minutes during a long session; every
  day at a set time (02:30 by default, server time) for the networks that
  changed; and at start, for networks behind (a restart loses nothing). A
  network that did not change is not written again. One network at a time,
  never in parallel; a push never waits for a backup.
- **D103. Keeping.** Everything from the last 24 hours (up to 24 files), then
  the newest of each of the last 7 days, 4 weeks and 12 months that have one
  (a network left alone for months still keeps its last files). Topo only
  deletes files it wrote. The backups of a deleted network stay until the
  server owner deletes them. A file missing at the destination is marked and
  shown.
- **D104. Checks and failure mail.** Every week the server reads the newest
  backup of each network back and checks its fingerprint, its ciphertext
  hash and its signature, then writes and deletes a test file. It cannot
  check that a file decrypts, so the owner gets "Open the latest backup here"
  for a full test. A failed backup or check emails the server owners, at most
  once a day each, with a one-sentence reason and no network details. When
  the destination as a whole is down, the server waits 5, 15 and 60 minutes,
  then until the next daily time; Back up now does not wait.
  `topo-server backup-now` does the same from a shell, and refuses while a
  running server is backing up the same data.
- **D105. Drive passwords.** Kept locked with a key derived from
  `server.key`, never sent back to the browser, cleared when the address
  changes. That protects a copied database, not a stolen data folder or
  server (`TOPO_SERVER_KEY` can keep `server.key` elsewhere; set, a missing
  file stops the start instead of making a new key). Losing `server.key`
  means typing the password again; the backups themselves stay openable.

The browser side (stage 2 of 5b):

- **D106. Readable copies, and what they mean.** Off unless two people turn
  them on: the server owner allows them (Account, Backups, "Also allow
  readable copies"), then each network's owner turns them on for that network
  (Members, Backups, "Keep a readable copy too"), after a question that says
  plainly who could read it. The server cannot read a network, so an owner's
  browser makes the readable copy: after it saves a change to the server or
  takes one from it, at most every 10 minutes per network, it sends the same
  file Download a back-up gives, of the copy the server holds now; the server
  writes it under `readable/` beside the encrypted backups and keeps only its
  name and date. What that means, said plainly: a readable copy is **not**
  end-to-end encrypted. The drive company and anyone with access to the
  drive can read it, passwords in notes included; it passes through the
  server in clear, so whoever runs the server could read it too; with the
  folder destination it is a readable file on the server's own disk, next to
  a database that holds only ciphertext. It is only as recent as the last
  time an owner opened the network (nobody opens it, nothing new is sent).
  Turning it off stops new copies and offers to delete the ones made
  (`DELETE /api/sites/{site}/backups/readable`); retention deletes the rest
  over the following days. A switch on the server is enough: the server
  already serves the app's code, so a second consent kept in the browser
  would add nothing.
- **D107. Restoring.** Two doors, one path. From the server: Members,
  Backups lists the network's files (date, Encrypted or Readable, size,
  Missing), each with Restore… and Download. From a file: Open a file (or
  dropping it) recognises a backup file. Either way the file is unlocked in
  the browser (this browser's own keys on its server; otherwise the recovery
  key of one of the owners the file lists, typed in a box that says which
  owners have none), checked (the ciphertext hash, the chain hash, the member
  list against the one this browser trusts on the same server, the author's
  signature when their key is still the one on the list), and then offered
  as any copy of a network is: Merge (through the review, with a restore
  point "Before restoring a backup", logged as "a backup"), Replace with this
  copy (a restore point first), or Open as a copy; a network not in this
  browser opens as its own or merges into one. Nothing is written without
  the review or a restore point. Going back in time is Replace with this copy
  or Open as a copy, because a merge never removes. On a network kept on a
  server, the restored copy is pushed as one new revision on top of the
  newest, never a rewind of the server's history, and a co-owner's later
  edit merges on top of it. An author whose keys changed since: the file
  still opens (the network's key proves it was not changed) and the review
  says the signature could not be checked. Who made the file is checked from
  whoever opens it: every member list in the file whose signer's key is in it
  must verify, and trust starts from the owner whose keys or recovery key
  opened it (and the lists this browser already trusts on that server); a
  list signed by a trusted owner makes its owners trusted. When the network
  key's wrap or the member list in force cannot be tied to that chain (for
  example a file someone wrote to the drive naming you as an owner), it
  still opens with your recovery key, and the review says plainly "Topo could
  not confirm who made this backup". A list newer than this browser's trust
  record is checked this way rather than refused. "Open the latest backup here"
  (the server owner's sheet, for networks they own) opens the newest file
  for real and says how many devices it holds: the full test the server
  cannot do.
- **D108. A back-up folder without a server.** On Chrome and Edge (the File
  System Access API), Settings, Back-ups lets a person pick a folder once (a
  OneDrive, Google Drive or Nextcloud folder whose own app uploads it, a USB
  disk, a share). Download a back-up (and a restore point's back-up) is then
  written there under the same name a download gets, and the browser asks for
  the folder's permission only on that click; refused, or no folder, it is
  the download as before. With "Also back up a network I change, once a day"
  (on once a folder is picked) a kept network that changed is written there a
  minute after the last edit, as one file per day, but only while the browser
  still grants the folder (it never asks outside a click). Topo keeps those
  files as the server keeps its backups (D103) and deletes only files it
  wrote and recorded itself; picking another folder starts a new list. Two
  networks with the same name and client never write over each other: the
  second one's files carry a short piece of its id after the name
  (`topo_office-3f9k2a_2026-11-10.json`), and each network's files are kept
  apart. Safari and Firefox have no such API: the section does not show and the
  download stays. Nothing leaves the browser.

### Decisions made building step 5c (2026-11-10), for the owner

- **D109. Topo talks to the drives itself, not through rclone.** This
  changes the approved line above ("through rclone's Go backends"). Topo
  needs five things from a drive: write a file, read it, list a folder,
  delete a file, and a quick test. For S3, Google Drive and OneDrive that is
  a few hundred lines each on Go's standard library (request signing, the
  sign-in, the uploads), every one tested against a local fake. rclone would
  bring well over a hundred other modules and tens of MB to a 17-19 MB
  server that today depends on one library, and its drive code is not meant
  to be used as a library (its supported way in is a separate program). Those
  rclone figures are from memory, not measured here. The server still has
  one outside dependency.
- **D110. Google Drive and OneDrive.** The client registers its own app with
  Google or Microsoft (docs/SERVER.md has the steps) and pastes the client
  ID and secret into Account, Backups; Topo is not a registered app of its
  own. Topo asks only for its own folder: Drive's `drive.file` (only files
  Topo made, in a folder "Topo") and OneDrive's app folder
  (`Files.ReadWrite.AppFolder`, plus `offline_access` to keep working). Press
  **Connect**: the server keeps what was typed for 10 minutes, tied to that
  sign-in session, the app and the return address, and opens the provider's
  page; the provider sends the browser back to the server, which only
  redirects to the app; the app then finishes it with a normal request, so a
  plain link can never change the settings. The provider's long-lived
  sign-in (refresh token) is kept locked like the other drive passwords
  (D105) and is never sent to a browser; Microsoft replaces it now and then,
  and the new one is saved before it is used. A server with no public name
  (a LAN address) cannot be registered with Google or Microsoft: press
  Connect from a browser on the server machine itself, at `http://localhost`.
  When the sign-in ends (revoked, or a Google app left in "Testing" after 7
  days) the status and the failure email say "press Connect again"; an
  expired Microsoft client secret says so too. Drive names are not unique,
  so Topo keeps each file's id; writing a name again leaves one file.
- **D111. S3-compatible stores** (Backblaze B2, Wasabi, MinIO, AWS): endpoint,
  region, bucket, a folder in the bucket (default `topo/`), key ID and
  secret, and a "path-style addresses" tick for MinIO and most self-hosted
  stores (a bucket name with a dot uses it anyway). Requests are signed with
  AWS Signature V4, checked against AWS's own published example; uploads
  carry Content-MD5 so buckets with object lock accept them. A bucket that
  keeps files locked is said once in the status ("Topo cannot delete old
  backups there") rather than as an error every run. A server clock that is
  off by more than 15 minutes is named as the problem. The same optional
  certificate fingerprint as WebDAV works for a self-hosted store with its
  own certificate.

- **D112. Installers: packages and services, not enabled until set up
  (except on macOS, where it starts answering only on that Mac).**
  *Changed by D125 (2026-11-11): clients install one package, the desktop
  app; these server packages are no longer offered to them, and stay only
  as recipes for an advanced host who builds them.*
  - **Linux**: an rpm and a deb, built by two small scripts on rpmbuild and
    dpkg-deb (nfpm is not needed). They install the binary, a systemd unit,
    a `topo` user (sysusers) and `/etc/topo/topo.env` with every line a
    comment. The service is not started on install, because it needs its
    settings first. The packaged unit uses a fixed `topo` user instead of
    systemd's throwaway user, so a backup disk or share can be given to it;
    a backup folder outside `/var/lib/topo` also needs a one-line drop-in,
    shipped as an example. Removing the package never deletes the data.
  - **Windows**: `topo-server service install|uninstall|start|stop`, a
    service running as Local Service with its data and settings in
    `C:\ProgramData\Topo` (readable only by Local Service, SYSTEM and
    Administrators), restarted on failure, logging to the Event Viewer.
    Local Service cannot reach network shares or mapped drives: a backup to
    a share needs WebDAV or S3, or the service run as another account. A WiX
    recipe makes the MSI on Windows; it locks the data folder the same way
    `service install` does (no access inherited from ProgramData). The
    sidecar the desktop app bundles is called `topo-desktop-server`, so the
    desktop app's packages never clash with these.
  - **macOS**: a LaunchDaemon running as a hidden `_topo` user, and a
    pkgbuild recipe that makes a universal pkg on a Mac. The one exception
    to "not enabled": the pkg loads the daemon at once, and with its
    all-comment settings it answers only on 127.0.0.1 of that Mac (no other
    computer can reach it) until the settings are filled in.
  - **Nothing is signed yet** (GPG for rpm and deb, Authenticode for
    Windows, Developer ID and notarization for macOS); that is a later step.
  - What was really run: the Linux packages are built and inspected here
    (35 checks), but not installed (that needs root). The Windows and macOS
    parts are cross-compiled and their files checked by tests, but never run
    on those systems.
- **D113. The desktop app can be the server.** Settings, **This PC as the
  server**, only in the desktop app, off by default. The app carries
  `topo-server` inside it and starts it when asked (or when the app opens,
  if ticked), and stops it when the app closes.
  *Extended by D125: the usual way is now a service that starts with the
  PC; this "only while Topo is open" way stays as the second choice.*
  - **This PC only** is `http://127.0.0.1`, which browsers already treat as
    safe.
  - **Other PCs on this network** need https, which a PC on a LAN has no
    certificate for. So the server makes its own certificate
    (`TOPO_TLS_SELF`), covering every address of the PC, and the app shows
    each address and the certificate's fingerprint. Each other PC's browser
    warns once; the person compares the fingerprint and goes on, or trusts
    the certificate for good (steps in SERVER.md). Checked in Chromium:
    after going on, the page can do the encryption. Not checked in Firefox
    or Safari.
  - Sign-in codes for other PCs must go by email, since only this PC can
    read its log. The PC needs a fixed address, because sign-in links carry
    it.
  - The app's own window does not sync with that server; its address is
    opened in a browser. *Replaced by D144 (step 7c, built 2026-11-11): the
    window becomes a client of the server through Rust.*
  - Not tested: starting the server from the running app, and the Windows
    and macOS app builds. The Linux app builds and its settings section is
    tested against a stand-in.
- **D125. One package, and it can make this PC the server (owner,
  2026-11-11: "I want the installer to offer becoming the server. Only one
  package is meant to be installed.").** A client installs the Topo desktop
  app and nothing else, on Windows, Linux or macOS. The app carries the
  server (`topo-desktop-server`). When the PC becomes the server, the server
  runs as a service: always, from startup, even when Topo is closed or
  nobody is signed in.
  *Changed by D170 (built in step 7l, D332): on Linux and macOS the
  first-start question is the welcome's step 3 choice "Make this PC the
  server"; the prompt described here is kept only for a start where the
  welcome does not run. Since 7o (D353) Setup (the welcome's new name)
  sets the server up itself when that choice is made.*
  - **Windows** (the main case): the installer is the NSIS `-setup.exe`
    only (the MSI is no longer built: it could not ask). It now installs
    for every user of the PC, in Program Files, so it asks for an
    administrator; a service must run a program that ordinary users cannot
    change. Its first page has one more tick box, "Use this PC as the
    server for your network", off unless the PC already is the server, in
    English, Spanish, Portuguese (Brazil), Japanese or Russian as Windows
    is. Ticked, the installer runs `topo-desktop-server service install
    --start`: the service TopoServer, automatic (delayed) start, Local
    Service, data and settings in `C:\ProgramData\Topo` (Local Service,
    SYSTEM and Administrators only), restarted on failure. It also adds one
    firewall rule letting that program in on private and domain networks,
    never public ones (a service cannot show Windows' own "allow?" prompt;
    the program still answers only on 127.0.0.1 until its settings say
    other PCs may reach it). The owner's email and the mail settings are
    left to the app (below). An update stops the service, replaces the
    files and starts it again; unticking on a reinstall removes it;
    uninstalling removes it and the firewall rule, and keeps the data.
    Silent installs: `/S /SERVER` turns it on, `/NOSERVER` off, neither
    keeps what the PC has.
  - **Linux**: an rpm or deb cannot ask while it installs. The package
    carries the unit `topo-desktop-server.service`, a sysusers file for the
    `topo` user and a polkit action, and enables nothing: its scripts only
    reload systemd and restart a server that already runs (on an upgrade),
    and on removal stop and disable it; the data in `/var/lib/topo` and the
    settings in `/etc/topo` stay. The app asks instead (below), and sets
    it up through the system's administrator prompt (`pkexec`, with Topo's
    own message). An AppImage cannot be a service (its files vanish when it
    closes), so it only offers "while Topo is open".
  - **macOS**: the app asks on first start too, and installs a
    LaunchDaemon (the same label, `_topo` user and folders as the server's
    own pkg recipe, D112) through the Mac's administrator prompt. Only from
    a copy in Applications. Built for, not run (no Mac here).
  - **The app.** On its first start, once, on a PC that can run the
    service and does not yet, and unless the Windows installer already
    asked, Topo asks "Use this PC as the server for your network?" (only
    the desktop app; phones never see it). Yes opens Settings at **This PC
    as the server** with the owner's email to fill in (and the mail
    settings for other PCs), then **Run it in the background from
    startup**: one administrator prompt sets it up and starts it. When the
    service is there, the section talks to it: running or not, the
    addresses to give people, the certificate's fingerprint, its log when
    the account may read it; Save, Start and Stop go through the service
    manager, each with an administrator prompt (Stop stops it until the next
    startup); **Stop using this PC as the server** removes it, data kept.
    The tick "Start it when Topo opens" is for the other way, which stays:
    the server as the app's own child, only while Topo is open (D113).
    Their data folders differ, so a server tried that way first does not
    carry over to the service.
  - **One set of service commands** in the server itself, the same on every
    OS: `service install|uninstall|start|stop|configure|status|log`.
    `configure` accepts only the settings the app writes (never the data
    folder or a password file), checks them the way the server will, and
    keeps the old file if the server would refuse them. The SMTP password
    reaches the service once, through a private temporary file, and is kept
    only in the service's own folder.
  - **The server's own packages** (D112's rpm, deb, MSI and pkg recipes)
    are no longer offered to clients. The plain `topo-server` binary and
    the container stay for an advanced host; the recipes stay in the tree
    for one who builds them, unchanged.
  - What was really run: the Go service commands (unit tests with a stand-in
    systemd), the app's Rust unit tests, the Settings section and the
    question against a stand-in (`desktopserver` suite), and the Linux rpm
    and deb built here and inspected (`tests/desktop-packages.sh`). Not run:
    the Windows installer (no makensis here: CI builds it and runs it
    silently on a Windows runner, `tests/desktop-installer-windows.ps1`),
    installing the Linux packages and the pkexec prompt (they need root),
    the macOS LaunchDaemon, and the running app talking to a real service.

## 6. Imports and exports (step 6)

NetBox first, both ways (so clients are not afraid of lock-in). Then nmap XML,
UniFi/Omada, MikroTik `/export`, Cisco CDP and MAC tables, Lansweeper and
phpIPAM. Every import goes through the merge.

What shipped (2026-11-10, not yet committed):

- **One Import… entry** (Export menu; Open a file and the landing's drop send
  anything that is not a Topo file there too). It reads the format from the
  file, with a "Not right?" picker, shows what was understood (counts, what
  could not be read by file and row or line, notes), lets the user leave out
  passing devices (wireless clients, DHCP leases), then merges it as a copy:
  the review, a restore point first, the log entry and one undo step. It
  never deletes.
- **Formats read:** NetBox (REST JSON and both CSV header styles), nmap XML,
  UniFi (API JSON and the client and device CSV lists), Omada (Open API JSON
  and CSV lists), MikroTik `/export` (v6 and v7, with "/ip neighbor print
  detail" pasted in), Cisco "show cdp neighbors detail" and "show mac
  address-table" (IOS, IOS-XE, NX-OS), Lansweeper asset CSV, phpIPAM (CSV
  and API JSON). Parsers are pure functions in js/importers/*.js with
  hand-written fixtures in tests/fixtures/import/ and a suite each.
- **Export to NetBox:** a zip of NetBox bulk-import CSV files in import
  order with a README; a round trip on every sample keeps everything NetBox
  can hold.
- **The format is published:** docs/FORMAT.md, schema/topo-v18.json and
  schema/topo-backup-v1.json, checked against every sample.

Left for later: pulling from a live NetBox, UniFi or Omada API (files only
for now); checking the NetBox headers and the Omada field names against live
systems; reading a MikroTik `.backup` or a running Cisco switch directly.

### Decisions made building step 6 (2026-11-10), for the owner

- **D114. One Import… entry.** Export, **Import…** takes any number of files
  at once (an export is often a set). Each file shows what Topo read it as,
  with a "Not right?" picker to choose another format or leave it out. The
  next step, **What was understood**, shows the counts (devices, interfaces,
  cables, subnets, VLANs, groups, racks, Wi-Fi, providers, columns), what
  could not be read with its file and row (the first 50, then "and N more"),
  and notes such as "VLAN 30 has no subnet: it stays on its ports". Then where
  it goes: merged into the open network (the default when it is kept),
  merged into another one, or opened as its own network. A merge is the
  usual review, as a copy of a network, two-way: a restore point first, a log
  entry naming the files, one undo step. **Importing adds and updates; it
  never deletes**, and the dialog says so. Topo's own files keep their own
  doors: a Topo .json opens as a network, a Topo spreadsheet goes to
  Spreadsheet. Open a file and a drop on the landing send a file that is not
  Topo's (a CSV, a NetBox page, a zip) to Import… instead of saying "not
  valid JSON". The parsers return codes and the dialog says them in the
  page's language; passwords and keys are never read, and the count of what
  was left out is said once.
- **D115. Imported records keep the source's own ids** (NetBox's,
  `nb-<source>-d12`), so importing the same export again updates instead of
  duplicating. `<source>` is a short tag of the NetBox address (or, for CSV,
  of its site names), so two NetBox servers' device 12 stay two devices; it
  is a plain FNV hash, not SHA-256, because the parsers are synchronous.
  A record whose source has no key gets a stand-in id starting `imp-`. The
  merge never treats an `imp-` id as an identity and gives the record an id
  of its own when it is added (one rule in js/merge.js, rather than an option
  passed to every merge: it holds on every re-plan of the review too). So an
  imported device that happens to be called `n1` is never matched with your
  `n1` by id; it is matched by asset tag, serial, MAC, address or name like
  any copy. Topo's own ids that come back from a NetBox export (`topo_id`) are
  identities, so a round trip matches everything to itself.
- **D116. NetBox to Topo.** The REST API's JSON saved to files (a page, a
  list, or several pages in one file), the list views' CSV export (verbose
  headers) and the bulk-import CSV (field names) are all read. Sites (when
  there are several) and locations become groups (floor, building or room by
  their words in five languages), racks become rack groups (height, width,
  depth, numbering), devices and virtual machines become devices (role to
  type, make, model, platform, serial, asset tag, rack position and face),
  a switch's or AP's numbered ports become its port grid (labels, VLANs,
  PoE), LAGs become bonds, addresses go on their interfaces, prefixes become
  subnets named by their VLANs, cables and wireless links become cables
  (label, colour, length, medium), wireless LANs become Wi-Fi networks,
  providers become providers, virtual machines run on the device their
  cluster names when only one does. Tags become a "Tags" column and custom
  fields become custom columns (at most 40). Statuses map to active, planned
  (planned, staged, inventory) or retired (offline, failed,
  decommissioning); staged, inventory, offline and failed are also kept in a
  "NetBox status" column. A VLAN with no subnet is noted and stays on its
  ports. An address on no interface is skipped and listed, because Topo keeps
  addresses on interfaces. Power and console cables are listed and left out.
  Regions, tenants, contacts, power, inventory items and the like are counted
  as "not read". NetBox 4.2's separate MAC addresses are read.
- **D117. Topo to NetBox.** Export, **Export to NetBox…** asks which NetBox
  (4.2 to 4.4, the default, or 4.1: they differ in where MAC addresses and a
  prefix's site go) and downloads one zip, `topo_<org>_<site>_<date>_netbox.zip`:
  NetBox's own bulk-import CSV files, numbered in the order NetBox must import
  them, and a README with the order and what is not carried. NetBox gets its
  own columns for everything it holds; what it does not (the map position,
  gateway, DNS, service dates, PoE budget...) rides in custom fields named
  `topo_*`, and `topo_more` keeps each record exactly as Topo holds it. So
  Topo to NetBox to Topo gives back the same network (tested on every sample
  and on a fixture with every field filled), and changes made in NetBox to
  names, serials, asset tags, comments, platforms, makes, models, MACs and
  cable labels are read back. NetBox refuses some things Topo allows, so the
  export makes names unique where NetBox needs it ("AP (2)", the original
  kept), gives a second cable on one port and a cable bound to no port a
  generated interface ("to <device>"), and keeps VPN links and links to
  virtual machines in the device's `topo_more` (listed in the README). Not
  carried: map notes, the report header, saved searches, the table layout,
  accepted findings and pins, problem reports and the log. **The column lists
  were written from NetBox's documented import forms and were not checked
  against a live NetBox**; the README says to check the first file first.
  The zip is written by Topo itself (stored, no compression), because the
  page may not fetch a library.
- **D118. UniFi and Omada controller backups (.unf, .cfg) are locked binary
  files and are not read.** Import… recognises them and says to export the
  device and client lists instead. (Their JSON and CSV exports come with the
  other importers.)
- **D119. From a Cisco MAC table, an uplink's addresses are left out.** A
  port with more than 3 addresses, a port-channel, or a port with a switch,
  router or AP behind it (from CDP) is an uplink: the addresses seen there
  belong to devices further away, so cabling them to that port would be
  wrong. They are left out and the ports are named in one note. A phone with
  a PC behind it does not make an uplink: that port is in two VLANs, takes
  the one with more addresses as its access VLAN and carries the other
  tagged, and the note says which ports. Addresses on access ports become
  devices named after their maker ("Dell 0003"), cabled to the port, so the
  merge finds the ones already in the network by their MAC. Interface names
  are written long (Gi1/0/5 is GigabitEthernet1/0/5) so CDP and the MAC table
  agree; the switch's name comes from its prompt, and the dialog asks for it
  when the capture has none.
- **D120. The file format is published.** docs/FORMAT.md describes the .json
  format (version 18): the envelopes, every field, ids, providers, problem
  reports, the log and its hash chain, revisions, merge rules, the migrations
  and rules for other tools. schema/topo-v18.json is now field-level and no
  longer a draft, beside schema/topo-backup-v1.json for server backups. Every
  sample, block, migrated old document and import result is checked against
  it, and a new field fails the check until the schema and FORMAT.md describe
  it. The About tab links it (the GitHub page, which is a link, not a
  request).
- **D121. Passing devices can be left out, and start left out.** UniFi and
  Omada client lists and MikroTik DHCP leases can add hundreds of phones and
  laptops that come and go. "What was understood" has a tick for each kind
  with its count: wired clients are ticked, wireless clients and DHCP leases
  are not. Leaving them out drops them and their cables from the import, and
  the counts follow the ticks.
- **D122. Discovery tools give devices, not decisions.** nmap writes what it
  saw: the address (with the scan's subnet prefix, else /32 and a note),
  MAC and maker, the host name (a reverse-DNS name without its domain), the
  open ports as a notes line, and the OS only when nmap is 85% sure (else a
  notes line with the guess). Nothing goes in Allowed Ports, which is a rule
  Topo checks, not what a scan saw. A scan has no stable ids, so a second
  scan finds devices by MAC, then address, then name. The same goes for
  MikroTik exports, Cisco captures and Lansweeper or phpIPAM files without
  ids; UniFi, Omada, Lansweeper (AssetID) and phpIPAM (API ids) keep the
  source's ids, so importing again updates instead of duplicating (D115).
- **D123. Controllers and routers: what is read.** UniFi and Omada: devices
  (gateways are routers; switches and APs get their port grid with labels,
  PoE and native VLAN), uplinks as cables to the parent's port (a mesh AP as a
  wireless link), clients wired to their switch port or associated with their
  AP on their SSID with band and signal, subnets with gateway, VLAN and DHCP
  range, Wi-Fi with security and hidden. MikroTik: one export is one device
  (name, model, RouterOS version, serial), its interfaces, VLANs, bonds,
  addresses, DHCP networks and pools, Wi-Fi (v6 and v7), leases as clients,
  and neighbours from a pasted "/ip neighbor print detail"; a CRS or CSS
  switch's etherN ports are its port grid with access and tagged VLANs.
  Sections it does not read are named in a note. **The Omada and UniFi field
  names, and the Lansweeper and phpIPAM CSV headers, are written from
  knowledge of those products and checked only against hand-written samples,
  not live systems.**
- **D124. Dates the local way are read only when the file settles them.**
  Lansweeper and phpIPAM exports made with Excel write dates as 03/04/2024.
  Topo decides the order per column across the whole file: a first part over
  12 means day-first, a second part over 12 means month-first. A column that
  never says is left empty with one note, never guessed. ISO dates are always
  read. Passwords, keys and community strings are never read from any file,
  and the count of what was left out is said once.

## 7. Answer checks, monitors, statistics, the idle lock and This computer (step 7)

Written 2026-11-11 from the owner's step 7 plan and their answers. Phase 7.0
is this section and the wording in README.md, docs/FEATURES.md and
docs/SERVER.md; no code. Each later phase adds its own decisions under
"Decisions made building step 7" below, numbered on from the last one here.

### What changes in Topo's promise

README said: "Not a scanner or a monitor … it never probes the network." The
new wording keeps the first half and narrows the second:

- **Still not a scanner.** Topo never discovers anything: no sweeps, ARP,
  SNMP, LLDP or port scans, and nothing that reads another device's
  configuration.
- **New: an answer check.** A Topo desktop app can ask the devices and
  services already documented one question: "Are you answering?" (a ping, a
  DICOM C-ECHO, an SMTP greeting and similar request-and-reply checks). It
  runs only on a PC someone has turned into a monitor, and only for items
  marked to be checked.
- **New: statistics and reports.** Response times and availability, collected
  automatically while checks run.
- **New: This computer.** The desktop app can read the PC it runs on (its own
  interfaces, addresses and default gateway) and offer to add it to the map.

### How it fits together

- **The page decides, Rust does the I/O.** The page (JS) knows the document,
  so it decides what to check: each marked item, with its protocol, address,
  port and options, and its upstream chain from the trace's reachability walk
  (js/diagnostics.js). Rust runs the schedule on a background thread, does the
  network I/O, keeps the samples, computes the hourly figures, and sends state
  changes back to the page as Tauri events.
- **It keeps running with the window closed.** Monitoring needs the tray icon
  and "Open Topo at sign-in", both offered when the switch is turned on. Rust
  keeps the monitor's own credential, so neither a signed-in person nor an
  open window is needed.
- **Three kinds of data, three paths.** Results never go through the merge or
  the hash-chained log; if they did, every check would make a revision, a log
  entry and a backup.

| What | Where | Path |
|---|---|---|
| Check settings | the document (v19 `check` blocks) | the normal merge |
| Live status (latest state per item) | an encrypted record per monitor; the server keeps only the latest | `/api/events` |
| Statistics (hourly figures) | encrypted blobs per monitor and day on the server, kept out of the document | pushed by the monitor, pulled by any viewer |
| Outages and who acted on them | encrypted issue records on the server, shown at once | `/api/events`; folded into the document's incidents by the next owner's browser that is open |
| A provider's visit | an encrypted visit copy on the server | waits in the owner's "Visits waiting" list |

- **Only owners write versions of the site.** Monitors (Rust) never build,
  hash, sign or merge a document: that would mean a second copy of the
  canonical serializer, the content hash, the log's hash chain and the merge,
  which could drift apart. A monitor writes small encrypted records only
  (status, statistics, issues). The server enforces this without reading
  anything: a revision push from any role but owner is refused (403, "update
  Topo" for an older app).
- **Root cause.** When an item's upstream device is also down, it gets no
  issue of its own. Router R1's issue says "R1 and 12 items behind it are not
  answering", and the items behind it are listed on R1's issue. Optionally,
  when two monitors check the same item, "down from A, up from B" points at
  the path between them, not at the device.

### Decisions for step 7 (owner, 2026-11-11)

The owner's fixed decisions, not to be reopened:

- **D126. Server and clients, no mesh.** topo-server is the hub: the desktop
  app's built-in server (D113, D125) or a separate install. Every Topo install
  is a client of it. Installs never talk to each other directly or look for
  each other. Without a server, one desktop app still monitors on its own (the
  same code, local only).
- **D127. Only the desktop app checks.** The website and the offline zip never
  probe, and their pages make no outside requests. They still see the status,
  the issues and the reports through the server.
- **D128. No network discovery, and no reading of other devices.** A check
  sends one fixed request to an address and port already in the document, and
  records only: answered or not, the time taken, and the reply's status code.
  Excluded: SNMP, banners kept as data, configuration, and anything that
  enumerates.
- **D129. Any install can be a monitor**, turned on by someone signed in on
  that PC. Two kinds:
  - **Site monitor (owner):** permanent; it keeps monitoring after the person
    who turned it on signs out, and stops only when turned off on that PC or
    revoked by an owner.
  - **Visit monitor (provider):** only the items the provider covers, for one
    session; its statistics are kept only for that session and added to the
    provider's visit report when the visit is recorded.
- **D130. Alerts are on screen only.** No email, call, SMS or push service.
  The alarm copies the layout of Atrium's card()
  (~/Github/Atrium/home/.config/hypr/scripts/emergency-alerts.py), not its
  hazard alerts: a full-screen card on every monitor, above other windows; a
  big title, the headline, the details and a short note; one large OK button;
  Escape closes it. *The plan's D160 gives the card three buttons instead;
  see D172.*
- **D131. Opt-in from Settings, off as shipped:** "Monitor from this PC"
  (checks) and "Show alarms on this PC" (the card).
- **D132. An outage becomes an issue**, which stays open until a person acts
  on it.
- **D133. Statistics are collected automatically** whenever checks run.
  Reports cover response times and availability.
- **D134. The interface locks after idle time:** *(as shipped, by where
  Topo runs: D426)* 30 minutes by default; the
  user changes the time, or turns the lock off, in Settings. While locked, the
  alarm card still shows the item's name.
- **D135. Statistics are kept 360 days by default.** The user changes this in
  Settings, or turns it off.
- **D136. The monitor's encryption is rewritten in Rust**, matching
  js/servercrypto.js byte for byte, with shared test vectors.
- **D137. Every listed check ships:** ping, TCP, HTTP(S), DNS, SMTP, DICOM
  C-ECHO, NTP, RTSP, SIP, HL7 MLLP, IPP, IMAP and POP.
- **D138. A first-run welcome**, shown the first time Topo starts.
- **D139. Provider members propose; owners approve.** On a server, a
  provider's edits never become a version of the site directly. A visit is
  uploaded as a visit copy and waits for an owner, every time, even when
  nothing needs deciding. The owner approves the changes and judges whether
  the visit succeeded.
- **D140. Merge fixes first.** The three weaknesses found in today's merge
  (D152) are fixed in their own phase (7a), before anything else, because
  v0.0.1 already ships them.

Proposed in the plan and accepted by the owner (2026-11-11). The plan's two
open questions were answered "1. Yes. 2. No, let user disable it from
settings.": D144 and D145. Settled earlier the same day: This computer adds
the PC only (D166), statistics Off saves nothing (D162), a visit monitor's
outages stay on the provider's screen (D148), every visit waits for the owner
(D139, D153), the merge fixes come first (D140).

- **D141. The welcome: when it shows.** *Changed by D425: the desktop app
  only; the website has none.* The desktop app: after the intro
  animation (desktop/intro.html) on the first start, and from Settings, "Run
  the welcome again". The website: a lighter version on the first visit,
  without the server, monitoring and This computer steps. It is skipped for
  share links, `#provider` links and intake links (`#setup`, `?profile=`),
  which already know where to go.
- **D142. The welcome's steps.** Every step can be skipped, and each choice
  can be changed later in Settings:
  1. Theme (Gold or Colourful). No language step: the language stays in the
     About window.
  2. How Topo is used: Simple (report problems) or Full (document the
     network). This sets the profile exactly as the mode picker does.
  3. Where networks live: on this PC only; connect to a Topo server (desktop
     app: the address, then sign in, D144); or make this PC the server
     (desktop app, "This PC as the server", D113, D125). On
     topo.carino.systems the website cannot reach a client's server (D66):
     this step offers "on this browser" and says that a Topo server is opened
     at its own address. A page served by a Topo server skips this step.
  4. The idle lock: the time (30 min by default) or Off, and the PIN.
  5. Desktop app only: "Add this computer to the map?" (This computer, through
     the Import… review), and "Monitor from this PC?", off by default, with
     one sentence on what it does and what it never does.
  6. Start: open an existing file; map the network now (hands over to the
     `#setup` intake); or an empty network.
- **D143. The welcome's rules.** It reuses the existing pieces (the intro, the
  profile picker, the `#setup` intake, the server's sign-in in js/serverui.js,
  "This PC as the server" in js/desktopserver.js) and adds no second way to do
  any of them. It runs once per PC or browser, which keeps a "done" mark in
  local storage. Translated, phone-first, 44 px targets. It is named "Welcome"
  in code and text, so it does not collide with the `#setup` intake.
- **D144. The desktop app becomes a server client (owner: yes).** Today it
  cannot be one: the page talks only to the server that served it (D66: same
  origin, `connect-src 'self'`), and D113 opens the built-in server's address
  in a browser. Settings gets "Connect to a Topo server" (the address), in the
  desktop app only:
  - all server traffic goes through Rust: Tauri commands carry the requests
    and the event stream, with the same client the monitor uses;
  - the page's existing code is reused: js/server.js already takes
    `_hooks.fetch`, `_hooks.EventSource` and `_hooks.origin`, so it runs
    unchanged on a Tauri-backed fetch and event source;
  - Rust holds the session cookie, so signing in from the app is the existing
    email sign-in;
  - a self-signed server (`TOPO_TLS_SELF`, D113) is pinned by fingerprint in
    rustls: the person compares it once, as in a browser, and a changed
    fingerprint is refused;
  - no CORS and no CSP change: the webview never fetches the server;
  - the app's own built-in server is reached the same way at 127.0.0.1,
    replacing "open its address in a browser".

  This supersedes D113's "the app's own window does not sync with that
  server".
- **D145. No status board (owner: no).** A PC used as a wall display of the
  status is not given a separate view that never locks. Its user sets the idle
  lock to Off in Settings (D134, D165).
- **D146. Turning a PC into a site monitor.** A signed-in owner turns on
  "Monitor from this PC" and picks the sites and the groups to watch. The app
  then:
  - makes a device key pair and keeps it in the OS keychain; on Linux without
    a Secret Service (a bare Wayland session), a file readable only by the
    user, and Settings says so;
  - adds the monitor to the signed roster as an owner's act, so every browser
    trusts its key;
  - wraps the current site key for it from the owner's browser, as for a new
    member (js/servercrypto.js);
  - registers it with the server as a **monitor**: a credential that is not a
    person. This adds `monitor` to the role CHECK, a server migration tested
    from a v0.0.1 database.
- **D147. What a monitor may do.** It may read the site and push status,
  statistics and issue records; it never writes a revision. It is shown
  everywhere as "Monitor: PC name (turned on by X on date)". Signing out does
  not stop a site monitor (D129).
- **D148. The visit monitor (provider).** In provider mode, on the desktop
  app, "Monitor during this visit" starts checks of the items the provider
  covers. It runs under the provider's own sign-in: no device key and no
  `monitor` role. It collects samples and figures for this session only, on
  the provider's PC. The provider sees status and outages on their screen; it
  opens no issues for the client, because work in progress takes devices down
  on purpose. Record visit adds a monitoring section to the report and to the
  `visit` log entry: per item, availability, the median and 95th-percentile
  response time and loss during the session; the outages seen; charts in the
  report. If the site has a site monitor, the section compares the visit with
  the 7 days before it ("R1's median went from 38 ms to 4 ms"). The session's
  raw data is deleted when it ends: at Record visit, at Stop, or when the
  provider signs out. *See D174: Stop deletes the samples but keeps the
  session's figures until Record visit or sign-out.*
- **D149. Turning off and revoking a monitor.** Owners see every monitor in
  the site's members list, with when each last reported, and can revoke one.
  Revoking deletes the server credential and rotates the site key epoch, as
  removing a member does. A browser that rotates the key re-wraps the new key
  for the remaining monitors.
- **D150. Assignment.** Each monitor checks the items in the groups it was
  given, so two PCs do not check the same item by accident. Checking one item
  from two monitors is a deliberate choice, made per item.
- **D151. Heartbeat.** The server sees, without decrypting, when each monitor
  last reported. If a monitor misses 3 intervals, every install showing alarms
  raises "Monitor at Building B stopped reporting", which covers a site gone
  dark whose own monitor cannot say so.
- **D152. The merge fixes (phase 7a), each with a failing test first.**
  1. **Sent parts are kept until answered.** Today only the newest 8 parts
     survive the per-card cap of 30, and a ninth outstanding copy merges
     two-way (more questions, the provider's removals ignored). A part's
     revision is kept until its copy is merged or its report is closed, with
     no count limit. *See D175 for the card's 64-entry part list and the
     40 MB budget.*
  2. **Two providers' new records are never joined by name alone.**
     mergePartPool (js/merge.js) excludes only the records known when the part
     left, so a record another provider's merge added since can match a new
     one by name or address, and two different "AP-9"s become one. Such
     records match only by id, MAC or serial; anything else is a question in
     the review, defaulting to Add as new.
  3. **New ids get a random part.** nextId (js/model.js) is milliseconds plus
     a counter from 0 per page load, so two PCs can make the same id. It adds
     4 random base-36 characters. Ids are opaque strings, so the format does
     not change; withFixedIds stays deterministic for the tests.
- **D153. Visits waiting (link, file and server).** One list for the owner:
  copies back by link or file, and visit copies on the server, oldest first,
  with the provider, the report and a count of changes. Every visit opens the
  review; nothing merges on its own (D139). The review's foot asks two things:
  - **The changes:** apply as reviewed, or reject (nothing applied).
  - **The visit:** Successful (the report goes to Fixed); Not successful (the
    report stays open, a round up as Reopen does, D38, with a note to the
    provider); or Undecided (the report stays Visited).

  A rejected visit is kept in the log ("Visit by X rejected: note") and its
  copy is kept as a file; the provider is told by the existing visit event
  (D67, email if on), as for an approved one. Waiting copies queue up: with n
  providers waiting, each merges in turn against the network as the earlier
  approvals left it, and a field two of them changed is a question in the
  second review, never an overwrite. One waiting copy per provider and report:
  a second Record visit before the first is decided replaces the first copy
  (it already holds the first visit's edits plus the new ones); the list says
  "2 visits", and the review shows the visit entries of both. The owner never
  reviews the same edits twice, or rejects one copy only to see its edits come
  back inside the next.
- **D154. Provider visits on a server.** A provider member's Record visit
  uploads a **visit copy**: the encrypted document they edited, its base (the
  server revision they started from), the visit entry and, when on, the
  monitoring section. Any owner's browser reviews it three-way against that
  base, which the server holds, so no browser-held part revision is needed.
  Changes to items outside the provider's items are marked "outside what X
  covers" in the review, defaulting to not applied. The server refuses a
  revision push from a provider (and from viewers and monitors, as before); a
  provider's browser no longer pushes, and syncs read-only. Once their copy is
  approved or rejected, the provider's browser takes the server's version; a
  rejected copy is offered as a file before it is replaced. A provider member
  can still read the whole site, because the site key opens it all; limiting
  reading needs per-provider keys, which is out of scope (docs/SERVER.md's
  threat model says so). A server holding pushes from v0.0.1 providers keeps
  them as valid history; only new pushes are refused. This supersedes D60's
  "revisions from any owner or provider" and D64's provider-side merge of a
  409.
- **D155. The checks, first version.** Each check is one request and its
  reply; nothing beyond the outcome is kept.
  - **ICMP echo:** unprivileged datagram ICMP on Linux and macOS, IcmpSendEcho
    on Windows. Where the system refuses ICMP, a TCP connect on a port the
    item documents, labelled "TCP, not ping" wherever it shows, the reports
    included.
  - **TCP connect** to a documented port.
  - **HTTP(S):** the status code, and the days until the TLS certificate
    expires (a warning at 14 days).
  - **DNS:** ask the item, as a resolver, for one name the owner gives, and
    check that an answer comes back.
  - **SMTP**, only when the item documents an SMTP service: connect, read the
    220 greeting, EHLO, then QUIT; optionally STARTTLS to read the
    certificate's expiry; never AUTH, never MAIL FROM, nothing is ever sent.
  - **DICOM C-ECHO:** an A-ASSOCIATE-RQ with Verification (1.2.840.10008.1.1),
    then C-ECHO-RQ and a release; calling and called AE titles per item,
    default calling AE "TOPO".
  - **NTP:** one client request; the reply, the stratum and the clock offset,
    with a warning above 1 s.
  - **RTSP:** OPTIONS (cameras, recorders), the status code only.
  - **SIP:** OPTIONS over UDP or TCP (phone systems), the status code only.
  - **HL7 MLLP:** a TCP connect to the listener only. No message is sent,
    because a test message could reach a real RIS.
  - **IPP:** Get-Printer-Attributes asking only for printer-state and
    printer-state-reasons.
  - **IMAP and POP:** read the greeting, optionally STARTTLS or TLS for the
    certificate's expiry, then LOGOUT or QUIT. Never LOGIN, AUTH or USER.
- **D156. Check settings: format v19**, with a migration in js/model.js and
  schema/topo-v19.json. A `check` block per device, or per service on a
  device: the protocol, port and options (AE titles, the DNS name, SMTP
  STARTTLS); the interval (60 s by default, 30 s to 15 min); "slow above" in
  ms (optional); which monitor or monitors check it. An availability target
  per item and per provider (for example 99.5 %, optionally only during the
  provider's service hours, which v18 already records); the reports compare
  against it. No secrets: no check takes a password.
- **D157. States.** **Down** after 3 failures in a row; **Up** after 2
  successes. **Slow:** the median of the last 5 checks is above "slow above";
  it shows on the map and in the reports but raises no alarm. **Flapping:** 4
  changes in 30 min; it stays one issue, marked flapping. **Quiet until…:**
  maintenance, per item, group or site; no issue is raised, and the time
  counts as maintenance in the reports, not as down. **Unknown:** the monitor
  itself was off, asleep or unable to reach the server; unknown time never
  counts as down.
- **D158. Issues.** A confirmed outage opens an issue record, encrypted,
  pushed by the monitor and shown at once on every install. It records the
  item (or the root cause and the items behind it), when it was first seen
  down, and which monitor saw it. The next owner's browser that is open folds
  open and closed issue records into the document's incidents (kind "outage")
  with a log entry each and no review, since they only add incidents; until
  then they live as records. Without a server, the app's own page does the
  same (how those local records are trusted: D173). Owners act on issues,
  and providers on the items they cover (their acts are records too, folded
  the same way); viewers only see. An issue stays
  open until a person does one of: **Acknowledge** (who and when, with an
  optional note); **Report a problem** (opens the prefilled report; the step-4
  routing names the provider; nothing is sent automatically); **Expected**
  (maintenance or planned work, counted as maintenance). Recovery does not
  close it: it is marked "answering again since 10:56 (down 14 min)", in a
  softer colour, and still waits for someone to act. The same item going down
  again while its issue is open adds the outage to that issue. It shows in the
  Problems tab, the Simple view's list and the map marker, the landing line,
  and on every install with "Show alarms on this PC" on. On the website (no
  card) signed-in pages show it as a banner.
- **D159. Issue records are signed.** Every record is signed by its author's
  key: the monitor's device key or the person's user key. When folding, the
  owner's browser checks the signature against the trusted roster and the
  author's role and scope: only a monitor may open an issue, and a provider's
  act on an item they do not cover is refused. A forged or out-of-scope record
  is dropped and shown to the owner. This applies to records that come
  through the server, from 7h; local records on a PC with no server are
  D173. Records not yet folded go into the
  server's backups (5b) beside the document, so a restore loses no open issue.
- **D160. The alarm card.** Atrium's card design, in amber: "NOT ANSWERING",
  the item and how long it has been down; for a root cause, its chain ("Router
  R1 and 12 items behind it"); the note "Checked by monitor <PC name>"; the
  buttons Acknowledge, Report a problem and Later (Later closes the card and
  leaves the issue open; Escape works like Later). A short chime, with the
  system volume untouched and nothing spoken. Recovery is a small
  notification, not a card. The card is a separate Tauri window (alarm.html
  beside intro.html, staged by desktop/stage.sh --desktop): always on top, on
  every monitor, focused. On Wayland "always on top" is not guaranteed, so a
  system notification is sent too, and the setting's help says so. "Test the
  alarm" in Settings shows the card marked DRILL.
- **D161. Statistics.** One sample per check (time, outcome, round-trip time,
  the reply's status), kept on the monitor PC (Rust, a local SQLite) for 7
  days. Hourly figures per item and per monitor: checks, successes and
  failures (loss); minimum, median, 95th percentile and maximum round-trip
  time; jitter (the mean difference between consecutive round-trip times);
  seconds in each state (up, down, slow, maintenance, unknown). The hourly
  figures are pushed to the server as one encrypted blob per monitor per day,
  and also kept on the monitor PC, so it works without a server. Daily figures
  are computed from the hourly ones. Downtime caused upstream is shown as
  "down because R1", so a switch is not blamed for its router.
- **D162. Retention.** "Keep statistics: 360 days", set per site by an owner
  and applied by the server and by every monitor PC. Off saves no statistics
  at all (no samples, no hourly or daily figures, on the monitor PC or the
  server); live status and issues still work, and visit reports carry no
  monitoring section. Otherwise samples stay 7 days on the monitor PC whatever
  the setting, as the source of the hourly figures. Shortening the period
  deletes the older figures after a confirmation that names how much will go.
  Visit monitors ignore the setting: their figures live only in the visit
  record.
- **D163. Availability is measured, not assumed.** Availability = up ÷ (up +
  down), leaving out maintenance and unknown time. The coverage (the share of
  time actually measured) is printed next to every figure: 99.9 % with 40 %
  coverage is not 99.9 %.
- **D164. Reports**, through the .rpv report preview (Print, Download, and
  CSV), charts following Branding's Data Viz section with the numbers always
  available as a table:
  - **Availability:** per item, group, site and provider; for a day, week,
    month, quarter, or since the last visit; against the target, during
    service hours or around the clock.
  - **Response times:** the median and 95th percentile over time per item, as
    a chart with a table beside it; loss and jitter; the "slow" hours.
  - **Outages:** each issue with its start, duration, root cause and who
    acted, with the time to acknowledge; the mean time to repair (MTTR) and
    between failures (MTBF) per item.
  - **Provider report:** that provider's items only, availability against the
    target, and their outages with response times; it fits the step-4 provider
    view and can be attached to a Report a problem.
  - **On an item:** its Check section shows the last 24 h (a small
    response-time chart and the state bar) and links to the full report.
- **D165. The idle lock.** *Changed by D426: 30 min as shipped only in the
  app, with a server sign-in or with a PIN; Off elsewhere.* Settings: "Lock after: off / 5 / 15 / 30 / 60 min /
  custom", per PC (browser or app storage, never the document), 30 min by
  default, on the desktop app and the website alike. Locking saves first (the
  open document, and any open dialog's draft such as Record visit or Report a
  problem, as a server update already does, D64 C3), covers the interface, and
  clears the open network from the screen and the page's memory. Monitoring
  keeps running, because the Rust side and its own credential are separate.
  Unlocking: a PIN set on this PC, stored as a slow hash, or the person's
  server sign-in; after 5 wrong PINs, only the sign-in works (where there is
  no PIN, or no sign-in to fall back on, see D169). It stops someone
  walking up to an unattended screen; it is not encryption at rest of the
  browser's library, and the help says so. While locked, the alarm card still
  appears with the item's name and how long it has been down; Acknowledge and
  Report a problem ask to unlock first, and Later works without unlocking.
- **D166. This computer.** A Tauri command reads, from this PC only, its
  interfaces (names, MACs, IPv4 and IPv6 addresses with prefixes, MTU), the
  default gateway, and the DNS servers (/etc/resolv.conf on Linux,
  GetAdaptersAddresses on Windows, scutil on macOS), with the netdev crate or
  the standard library; nothing goes onto the network. One button, in the Add
  menu and in Settings, goes through the Import… review: the PC as a device,
  its interfaces, and its subnet worked out from address and prefix. Nothing
  else: the default gateway is not added (the owner's decision), and the
  review shows its address only as information. Nothing applies without the
  review, and a second run merges instead of duplicating. A monitor PC that is
  on the map is linked to its item, so its issues and statistics name where it
  sits.
- **D167. Dependencies are approved one by one.** Each Rust dependency is put
  to the owner with its licence and size in the phase that needs it: netdev
  (MIT); socket2 (MIT/Apache-2.0) and windows-sys (MIT/Apache-2.0) for ICMP;
  ureq or hyper with rustls (MIT/Apache/ISC) for HTTP(S) checks and the
  server; rusqlite with bundled SQLite (MIT); keyring (MIT/Apache-2.0); the
  Tauri tray, notification and autostart plugins (MIT/Apache); aes-gcm, p256,
  hkdf and sha2 from RustCrypto (MIT/Apache-2.0) for D136. DICOM PDUs and the
  SMTP and DNS packets are hand-written, with no crate.

### Decisions made building step 7, for the owner

Phase 7.0 (2026-11-11), choices the plan left open:

- **D168. The new promise is written now, marked as coming.** README's "What
  it is not" and docs/FEATURES.md carry the new wording (still not a scanner;
  answer checks from a desktop app turned into a monitor; statistics and
  reports; This computer) under "Coming in step 7", and docs/SERVER.md's
  threat model says now that a provider member can read the whole site and
  that provider pushes go through the owner from 7b. Phase 7m replaces the
  "coming" notes with the final wording once the pieces ship. Until then the
  website, the zip and the app still never probe, and the old "Use Ping for
  live checks" pointer stays. *Done in 7m: D337.*
- **D169. The lock with no way to unlock yet.** The lock is on at 30 min as
  shipped (D134), but a PC may have no PIN and no server sign-in. There it
  still locks (it saves, covers the screen and clears the network from the
  page) and unlocks with a plain **Unlock** that reopens the network, saying
  "Set a PIN in Settings so only you can unlock". Said plainly: with no PIN,
  the lock only hides the screen and protects nothing, and the help says so.
  With a PIN but no server sign-in to fall back on (the website at
  topo.carino.systems, D66, or an app that is not a server client), 5 wrong
  PINs do not lock out: each further wrong PIN waits longer before the next
  try (30 s, doubling, at most 15 min), and **Forget the PIN** stays offered.
  It removes the PIN and keeps the library's networks, since the lock is not
  encryption at rest; it is logged nowhere and says so. Where a sign-in
  exists, D165's rule stands (only the sign-in after 5 wrong PINs). The lock
  is never left with no way back. For the owner to confirm in 7e, together
  with D165's note.
- **D170. The D125 first-start question folds into the welcome.** On Linux and
  macOS the desktop app's one-time "make this PC the server?" question (D125)
  becomes the welcome's step 3 choice "make this PC the server", asked once;
  the Windows installer's tick box stays, and an app whose PC already is the
  server skips the choice. This keeps one way to do it (D143). Until 7l
  ships, D125's own first-start prompt stays unchanged. Skipping step 3 (D142)
  counts as the answer "not now": it is not asked again, and the choice stays
  in Settings (This PC as the server). The 7l tests cover a skipped step 3
  and an app updated from 0.0.1 that already answered D125's prompt (not
  asked again).
- **D171. Phase names.** The phases are 7.0 and 7a–7m as listed below; each
  records its decisions here, numbered on from the last, and ticks its line in
  the Status list.

Phase 7.0 review (2026-11-11), conflicts in the plan made explicit:

- **D172. The alarm card's buttons.** The owner's fixed D130 says "one large
  OK button"; the plan's accepted D160 gives the card Acknowledge, Report a
  problem and Later. Proposed: D160's three buttons replace the single OK,
  since an issue stays open until a person acts (D132) and the card is where
  they act; Later plays the OK's part, and Escape works like Later, as D130's
  "Escape closes it". For the owner to confirm before 7g; if not, the card
  has one OK (as Later) and acting happens in the Problems tab.
- **D173. Local issue records (no server).** Issue records and folding come
  in 7g, before the device key, the `monitor` role and the Rust signing
  (7h). On a PC with no server, issue records come straight from the app's
  own Rust side over Tauri events, inside one process, and are trusted as
  local: they are not signed and skip D159's roster and role checks, as
  there is no roster. A person's acts on them are the page's own edits. From
  7h, every record that goes through the server is signed and checked as
  D159 says; local records are never pushed to a server as they are (turning
  the PC into a monitor starts signing new records, and records already
  folded are already incidents in the document).
- **D174. Stop keeps the visit's figures.** In the visit monitor (D148),
  Stop ends the checks and deletes the samples, but keeps the session's
  figures (availability, median, 95th percentile, loss, the outages seen)
  on the provider's PC until Record visit adds them to the report, or the
  provider signs out or starts a new session. So the usual order, Stop then
  Record visit, still has a monitoring section.
- **D175. Held parts and the revision limits (7a).** D152.1's "no count
  limit" also covers today's two other limits in js/revisions.js:
  `PART_REVS_MAX` (64 part tokens per card) goes with the held set, so a
  card lists every outstanding part, however many; and when the 40 MB
  budget (`REVISION_LIMITS.totalBytes`) is over with only held revisions
  left, enforceRevisionCaps stops evicting (as now) and the library warns
  "Old sent copies are taking up space: close or merge them" instead of
  dropping a held part. Tests in 7a cover a ninth and a sixty-fifth
  outstanding part, and an over-budget store of held parts only.

Phase 7a (2026-11-11), choices the plan left open:

- **D176. What "answered" and "closed" mean for a held part.** A part's
  revision (js/revisions.js heldParts) now records the report it went out
  for (`incidents`, the report being sent; none from the Share dialog) and
  the providers it went to. A copy merged back on it is held as a part too
  (as before) and records the part it answers (`answers`, `back`) and that
  part's reports. A part, sent or merged back, is held until as many copies
  have been merged on it as providers it went to (one at least), or until
  every report it went out for is closed or gone; a part sent for no report
  waits for its copy. A copy merged back is the base of that provider's next
  return, so it is held the same way, by the same reports. The copies merged
  back since the oldest part still out left are held with it (D177 needs
  them). *Bounded by D179:* parts recorded before 0.0.2 and copies back for
  no report are held as the newest 8 only, the copies held "since" are the
  newest 16, and a part for several providers needs a copy from each.
  card.partRevs names
  every part still out, and of the others (answered, or gone from the store)
  the newest 64. The tab's bucket for a network not kept
  (`REVISION_LIMITS.session`, 30) counts only the copies opened, never a
  part sent from it. The warning sits under "Your networks" on the landing,
  beside the back-up line, translated.
- **D177. Which records are "another provider's" (D152.2).** Computed at
  the merge back (js/providerpart.js partMergeInfo, `others`): the devices,
  cables and groups of every copy merged back as a part after the returning
  part left, less what that copy's own part held when it left and less what
  the returning part held. A two-way part merge (its revision gone) counts
  every copy merged back. Strong keys: id, serial and MAC (the plan's
  list); the asset tag, the address and the name of a device, a group's
  place and a cable's ends only ask. The question reads "Another provider
  added one with the same {how} since this part left: is it the same one?"
  with the candidates, Add as new (the default) and Skip; Skip leaves it out
  with the note "Skipped: it may be one another provider added since." A
  record of yours added since (not from a provider's copy) still joins by
  name, as before. Such a record that a later full revision also holds
  (an export after the merge) is now matched by serial or MAC and asked by
  name, where before it was never matched. A record whose id was reminted
  when the other copy merged (an id clash) is not recognised and is matched
  as before; with D178 such clashes are rare. *Since D179,* a weak hit on
  another provider's record waits until every finder has run, so a serial or
  MAC that also matches still pairs it with no question.
- **D178. The random part of an id.** nextId appends 4 base-36 characters
  from crypto.getRandomValues after the clock and the counter
  (`n_<ms><seq><4>`); withFixedIds mints the form of before, with no random
  part, so canonical comparisons and the suites stay deterministic. Two
  suites that froze the clock to compare two runs (datacost, schema) also
  freeze crypto.getRandomValues.
- **D179. Bounds on what holds a part (7a review).** What nothing can
  answer or close is no longer held without end:
  - **Before 0.0.2.** A part recorded before 0.0.2 (no providers, no
    report, sent or merged back) cannot say whether it was answered. Such
    parts, and copies merged back for no report (from the Share dialog or a
    two-way merge), are held as the old rule held parts: the newest 8
    (`PART_LOOSE_HELD`), until a copy merged on one answers it.
  - **Copies held "since".** Of the copies merged back since the oldest
    unanswered part sent from 0.0.2 on left (D176, read by D177), only the
    newest 16 (`PART_SINCE_HELD`) are held for it, so one Share-dialog part
    that never comes back does not pin every later copy.
  - **Whose copy.** A copy merged back records the provider it came from
    (`by`): the part's one provider, or of several, the one whose visit
    entries are new in it. A part for several providers is answered by a
    copy from each; a copy that does not say whose counts as one more, as
    in D176.
  - **The budget.** Over the 40 MB budget with only held revisions left, a
    part held with no open report (a Share-dialog part still out, a part
    from before 0.0.2, a copy held "since") is let go, oldest first; a part
    whose report is open never is, and D175's warning ("close or merge
    them") is then about those, which can be closed or merged. A
    Share-dialog part let go this way merges back two-way, as a part whose
    revision is gone did before.
  - **A card's part list from outside** (a binder, a back-up, a server
    site) keeps at most the newest 1024 (`PART_REVS_HARD_MAX`); the card's
    own sends still keep every outstanding part (trimPartRevs).
  - **Strong keys first.** In the device match, a weak key (asset tag,
    address, name) that hits another provider's new record is held back
    until every finder has run: a serial or MAC that also matches pairs it,
    and only otherwise is it asked, Add as new by default (D177).

Phase 7b (2026-11-11), choices the plan left open:

- **D180. The owner's answer is a log entry: format v19.** The plan asks
  for the rejection to be "kept in the log" and for the visit's outcome to
  be recorded; v18's log kinds (merge, incident, visit) have no place for
  either, and an unknown kind in a v18 build is dropped (breaking the log's
  chain). So 7b opens format v19 with one new log kind, `decision`:
  `visits` (the ids of the visit entries it answers), `incidentId`,
  `providerId`, `provider`, `visitBy` (the technician), `by` (who decided),
  `result` (`approved` | `rejected`), `outcome` (`successful` |
  `not-successful` | `undecided`), `note` (to the provider), `file` (the
  file a rejected copy was kept as), `summary`. The v18 -> v19 migration
  converts nothing; schema/topo-v19.json is v18's with the new kind
  (schema/topo-v18.json stays); a v18 build opens a v19 document read-only.
  v19 is not released yet: phase 7f adds its `check` blocks to the same v19
  (D156) and its migration test then covers both.
- **D181. What the judgement does (D153).** Successful: the report is
  closed now, the owner's note its close note. Not successful: the report
  is open again one round up (`reopened` + 1, the close cleared), as Reopen
  does (D38); the note is in the decision entry, which the provider's copy
  gets with the site's version (and the Problems tab shows under the
  visit). Undecided: the report is left as the copy left it (Visited when
  approved). The decision entry is the record: no separate `incident`
  closed or reopened entry. A rejected copy's judgement applies to the
  report as the owner's network has it. The merge, the report's state and
  the decision entry are one undo step (commitMerge's `finish`).
- **D182. Every visit opens the review, wherever it comes in.** A copy is a
  visit when it brings a `visit` entry the network has not got and no
  `decision` entry answers (js/visits.js visitReviewInfo); any copy but a
  server's revision or a backup (the site's history) then opens the review
  with the visit's foot. The banner's button reads **Review the visit** and
  goes straight to the review (no Keep question first). A binder site with
  such a visit is never merged on its own ("A visit to review"). The foot's
  defaults are **Apply as reviewed** and **Undecided**, and Apply is enabled
  even when nothing else is to merge ("Save the decision"): the visit is
  still to be judged (D139). A note for the provider is always offered.
- **D183. Visits waiting by link or file is per browser.** The copy is kept
  in this browser's key store (IndexedDB, as the server's sync documents
  are) when it arrives and when its review is cancelled, keyed by the
  network, the provider (id, else name) and the report; a newer copy for the
  same key replaces it. It goes when it is decided, or when it turns out to
  be older than the network ("already has everything"). An undo of the
  decision does not bring it back: the link or file can be opened again.
  The list shows in the Problems tab (which shows while one waits, even on a
  network with no report), the Simple view with nothing selected, and the
  landing card ("Visits waiting: 2"); oldest first; the provider, the
  problem, the count of visits and of changes, where it came from.
- **D184. A rejected copy is downloaded at once** as
  `<the network's file name>_rejected-visit.json` (the copy as it came, with
  its identity), its name kept in the decision's `file`. Same on a server.
- **D185. The server's side (migration 0004).** `visit_copies` holds each
  copy sealed, with its header (id, author, device, slot, base revision,
  epoch, roster, client time, ciphertext hash, signature), its state
  (waiting, approved, rejected) and the decision (when, by whom, the
  revision written). Routes: `POST /api/sites/{site}/visits` (providers
  only; the same checks as a push: device, ciphertext hash, the author's
  signature over `topo-visit-v1` (server/internal/tcrypto VisitHeader,
  js/servercrypto.js sealVisit), a base that exists, epoch and roster in
  force), `GET …/visits` (owners every copy, a provider their own, a viewer
  an empty list), `GET …/visits/{id}` (the body), `POST
  …/visits/{id}/decide` (owners; `{decision, n}`, n the revision written,
  at least the copy's base), `DELETE …/visits/{id}` (the author or an
  owner). The slot is a hash of the site, the report and the provider (the
  server learns neither); one waiting copy per author and slot, a new one
  replacing the waiting one (a decided one stays beside it, D191),
  `replaced` counting how many it replaced; at most
  64 waiting per site. A waiting copy's base revision is never pruned
  (TOPO_REV_CAP). Decided copies are deleted by the provider's browser once
  taken, or by housekeeping after 90 days. The owners get the
  visit-recorded email when a copy arrives; the author gets it when it is
  decided, with its own subject and sentence ("The owner approved your
  visit", "… did not accept your visit", in the five languages, under their
  "visit" switch). Both are told live by a `visits` event. Revision pushes:
  owners only (403 `owners-only` with `update: true` and a message); a
  v0.0.1 database's provider revisions are untouched and still verify.
- **D186. The answer goes after what it wrote.** The owner's browser
  writes the decision into the network, pushes it, and only then sends
  `decide` with the revision pushed; until then the answer waits on the
  card (offline included) and goes after the next push. A copy already
  decided (409) or gone (404) drops the answer.
- **D187. The provider's read-only sync.** A provider's card never pushes.
  Each sync first reads the owner's answers on its copies (below); the
  server's newer versions then merge in under its edits (three-way, quietly
  when nothing conflicts, Needs merge otherwise), so its edits stay on the
  newest revision; Record visit pulls first and uploads the card as it is,
  on the revision it is built on. Its card says "Your changes go to the
  owner when you record a visit" (chip **Proposed**) and, while a copy
  waits, "Your visit is waiting for the owner's review" (**With the
  owner**). When none of its copies is waiting any more and one was
  answered, it takes the server's version (one undo step on screen) and
  deletes its copies, without merging the head in first (a merge about to
  be replaced could only stop it with a question). First
  it offers its card as a file (`…_my-visit.json`) when a copy was
  rejected, or when taking the server's version would lose something
  (D192). While another copy of theirs still waits, the
  card keeps its edits. A push refused as `owners-only` (a role changed
  meanwhile) turns the card into a provider's.
- **D188. Outside what they cover (server copies only).** The provider is
  the copy's own (`providerId` in the sealed copy, else the newest visit's).
  Inside: the devices, cables and groups they cover in the copy or its base
  (providerPart, D91), anything new of those kinds and new reports, the
  reports routed to them, their own provider record. Everything else that
  changed is outside: an existing item they do not cover, another
  provider, and every other kind (subnets, Wi-Fi, notes, columns, searches,
  findings, the report header, the lives, the table view). A provider the
  network does not list covers nothing. Each outside row asks **Leave it
  out** (the default) or **Apply it**; the visit's own log entries always
  come in. A copy by link or file keeps D91-D93's part rules instead.
- **D189. Opening a server copy is checked.** The owner's browser opens a
  copy only when its signature verifies with the key the trusted roster
  names for its author, that roster lists the author as a provider, and
  the newest trusted roster still does (D191; else `not-provider`); its
  base revision only when its chain hash and signature check out, else the
  review is two-way. A copy that fails is listed as "A visit copy that
  could not be opened", with no Review.
- **D190. Not in 7b.** A provider who sent a copy by link or file is not
  told of the decision by Topo (there is no server to tell them; the owner
  writes to them as before). Waiting server copies are not in the server's
  backups (5b): they are proposals, and the site's history is whole without
  them. Undoing a decision does not put the copy back in Visits waiting,
  and an answer already sent to the server is not withdrawn. A waiting
  copy never expires on its own (it holds its base from pruning until it
  is answered or its provider leaves).
- **D191. A rejected copy's edits do not come back unseen (review of 7b).**
  A provider's card keeps every edit until the owner has answered all of
  its copies, so a later copy (another report, or one uploaded before the
  provider's browser took a rejection) carries a rejected copy's edits
  too. The server therefore replaces only a *waiting* copy in the slot: a
  decided one stays until its author's browser takes the answer and
  deletes it (the unique slot index is on waiting copies only). When an
  owner reviews a copy, their browser also opens the same author's
  rejected copies still on the server (the newest 4) and marks each item
  the copy still carries exactly as a rejected copy changed it: "This
  change came in a visit you rejected before.", left out unless applied,
  inside what the provider covers or not (js/visits.js visitRejectedKeys,
  js/merge.js scope.rejected). A provider made a viewer or owner, removed,
  or leaving takes their copies with them (store.SetMemberRole,
  DeleteMember), and an owner's browser opens a copy only while the newest
  trusted roster still lists its author as a provider. A link or file copy
  that is reviewed after its visits were answered through a newer copy is
  dropped from the list ("This visit was already answered."), and a
  decision drops every local copy it answered. A rejected copy's file is
  downloaded once the decision is written, so a review retried after a
  stale result downloads it once.
- **D192. What taking the server's version would lose.** Before a
  provider's card becomes the server's version after an approval, it
  counts the parts (docChangeParts: one per device, cable, group, report…)
  it changed since the revision it is built on that the server's version
  does not have as the card does, leaving out reports the owner judged in
  those revisions, plus visit entries the server's version lacks. Edits
  made after the upload with no new Record visit, and rows the owner left
  out, are both caught; any count above zero offers the `…_my-visit.json`
  file first. A rejected copy always offers it.

Phase 7c (2026-11-11), choices the plan left open:

- **D193. The client's crates (D167, for the owner to confirm).** ureq 2.12
  (MIT/Apache-2.0) with its default features off but `tls`: rustls 0.23
  (Apache-2.0/ISC/MIT) on ring 0.17 (Apache-2.0/ISC), webpki-roots 0.26
  (the public authorities; the 1.0 data it carries is CDLA-Permissive-2.0)
  and base64 (MIT/Apache-2.0); sha2 0.10 and url 2 were already in
  Cargo.lock through tauri. No gzip, cookie, proxy or native-certs feature,
  so nothing else comes in (the lock gains rustls, rustls-webpki,
  rustls-pki-types, ring, untrusted, ureq, webpki-roots, getrandom, subtle,
  zeroize, base64 and windows-sys/windows-targets for ring on Windows). The
  same client serves the monitors' HTTP(S) checks in 7f, so 7f adds no
  HTTP crate. Built offline from crates already on this PC; the release
  size difference was not measured (no release build in 7c).
- **D194. Which certificate is trusted.** One a public authority signed
  (webpki-roots) connects with no question and is not pinned, so its
  renewals keep working. Any other (a self-signed `TOPO_TLS_SELF`, a
  company's own authority, a wrong name) is shown as its SHA-256
  fingerprint, in the AB:CD:… form the server logs and the browsers show,
  to compare once; "They are the same: connect" pins it. A pinned
  certificate is the identity: its name and dates are not checked (the
  self-signed one lists the PC's LAN addresses, not 127.0.0.1), and any
  other certificate is refused, also when an authority signed it. The
  refusal is said once as a toast, and Settings says why and offers
  **Check the certificate again**, which compares the new fingerprint;
  the same address keeps its session, another address starts signed out.
  Plain http is accepted only to this PC (127.0.0.1, ::1, localhost), as
  the server itself allows (D52); a bare address means https.
- **D195. What the app sends, and to where.** Only the connected server's
  `/api/` (a path, never a URL; no `..`, `//`, `#`, spaces), with GET,
  POST, PUT, PATCH and DELETE, no redirects followed, answers up to
  256 MB. Each request carries `X-Topo: 1` and `Sec-Fetch-Site:
  same-origin` and no `Origin`: the server's CSRF check (D57) takes that,
  as from its own page, and the app is not a page another site can drive,
  so the check loses nothing. No server change was needed. Any HTTP status
  is handed to the page as an answer; only no answer is an error
  ("offline", "untrusted:<fp>", "pin-changed:<fp>"), which js/server.js
  sees as its own "offline". Bodies that are not UTF-8 cross as base64.
- **D196. The session.** The cookies are kept by the app per server in
  `<app data>/client/session.json` (written readable by this user only),
  the address and the pin in `<app config>/client.json`, so a restart of
  the app stays signed in as a browser would. The page never sees the
  cookie. The sign-in link in the email signs in a browser, not the app
  (it is bound to the browser that asked, D54): in the app the person types
  the code. Connecting backups to Google Drive or OneDrive (D110) finishes
  in a browser on the server's address, where the provider sends it back.
  **Disconnect** asks, signs out on the server, then forgets the address,
  the pin and the session; the networks stay on the server and the ones in
  the window stay on this PC.
- **D197. The page side.** js/server.js, js/serversync.js and
  js/serverui.js are unchanged; js/desktopclient.js sets
  `TopoServer._hooks` (`force`, `origin`, `fetch`, `EventSource`). The
  address is mirrored in the window's localStorage so the hooks are in
  place before the boot opens the server client; the app's own answer
  (`client_info`) wins, with one reload when they differ, never a loop.
  Connecting and disconnecting reload the page, so it always boots as what
  it is. The stream reconnects in Rust after the server's `retry:` time
  (a browser's EventSource does the same) and is closed for good on any
  status but 200; a reload or a page that leaves stops its streams
  (`on_page_load`). A server that does not answer is tried again after 5 s,
  then doubling to once a minute, and at once when the network comes back.
  The section shows only in the app (a `__TAURI__` that answers
  `client_info`), never on the website or in the zip, and the CSP is
  unchanged.
- **D198. This PC's own server in its window.** "Open in browser" is gone
  from This PC as the server; **Open it in this window** connects the
  window to the running server at 127.0.0.1 (https with the fingerprint
  the server wrote, so there is nothing to compare, in "Other PCs on this
  network"; http in "This PC only"), and once the window uses it the
  section says so instead. The `server_open` command stays in the app for
  an older page and is not offered. The welcome (7l) reaches "Connect to a
  Topo server" through this Settings section.
- **D199. How 7c is tested.** The Tauri window itself is not driven by a
  test (no webview automation here). The Rust transport (src/client.rs)
  has unit tests against loopback servers, with a test certificate pair in
  src/testdata (a test-only key). The page side runs against a stub of the
  commands whose requests are answered by the in-page fake server
  (tests/suites/desktopclient.js). And the two meet in
  tests/desktop-client-e2e.mjs: the page in Chromium, its commands sent to
  examples/client-bridge.rs (the same src/client.rs over stdin and stdout;
  an example is never bundled), against the real topo-server with
  `TOPO_TLS_SELF`.

Review of 7c (2026-11-11):

- **D200. What only a browser can finish, from the app's window.** The
  window is not a browser on the server's address, so js/serverui.js
  (otherwise unchanged, D197) words two things for it when
  js/desktopclient.js sets `TopoServer._hooks.desktop`: the sign-in sheet
  asks only for the code (the email's link signs in a browser, D196); and
  Backups to Google Drive or OneDrive offers no Connect, which could not
  finish (the provider brings a browser back, and the server ties the
  sign-in to the session that started it, so the app's session cannot
  finish it in a browser). It says to finish in a browser signed in on the
  server, with **Open the server in a browser** (the server's address,
  opened outside the app). The redirect address shown is the server's
  (from `_hooks.origin`, http(s)://localhost:<port> for this PC's own
  server, as backups_oauth.go makes it), never the window's
  tauri://localhost.
- **D201. A certificate nobody vouches for any more.** A server connected
  with no pin (its certificate from a public authority) whose certificate
  then fails the check (expired, a proxy's own, someone in the way) is
  treated as a refused certificate, not as a server that does not answer:
  said once, not retried, and Settings says the certificate cannot be
  checked and offers **Check the certificate again** (compare and pin it,
  or disconnect). Its event stream closes for good too. A server that
  answers again restarts the retry wait at 5 s (D197).
- **D202. One keeper of the app's files.** The address, the pin and the
  cookies are kept by src/client.rs `Store` (no Tauri), which the app's
  commands and the tests' bridge both use, so the e2e restarts the bridge
  on the same folder as the app restarting. Writes happen one at a time
  under one lock and go to a temporary file renamed into place, so two
  answers saving the cookies at once leave the newer jar, whole; only the
  connected server's cookies are written (a late answer from a server just
  left or disconnected writes nothing).
- **D203. Each refusal reaches the thread that met it.** The certificate
  check keeps its verdict per thread (ureq makes the handshake on the
  calling thread), so a page request and the event stream refused at once
  both say "pin-changed" (or "untrusted"), never "offline" for one of them.

Phase 7d (2026-11-11), choices the plan left open:

- **D204. No crate for This computer (D167).** netdev was not taken: the
  standard library and libc (MIT/Apache-2.0, already in Cargo.lock through
  tauri, now a direct dependency on Linux and macOS) read everything, so
  nothing new comes in. Linux: getifaddrs for IPv4, /proc/net/if_inet6 for
  IPv6 (its flags say which address is a temporary privacy one),
  /sys/class/net for the MAC, the MTU, whether a card is physical (it has a
  `device`) and Wi-Fi, /proc/net/route and /proc/net/ipv6_route for the
  default gateways, /etc/resolv.conf for the DNS servers (and
  systemd-resolved's own list when resolv.conf names only its 127.0.0.53
  stub), /etc/os-release for the system's name. macOS: getifaddrs (the MAC
  and MTU from the link entry; en* are the cards), `route -n get default`
  and `scutil --dns`, `sw_vers`. Windows: GetAdaptersAddresses from
  iphlpapi, declared in src/thiscomputer.rs (no windows-sys feature),
  Ethernet and Wi-Fi adapters as cards except Hyper-V's vEthernet. The
  macOS and Windows readers are written and not built or run here (no
  such target on this PC); their text parsers are tested on every OS.
- **D205. One address per interface.** Topo keeps one address on an
  interface (amendment 29, as the importers do), so each card keeps the
  first of: an IPv4 address that is not link-local, a stable IPv6 one (not
  temporary, not fe80::), an IPv4 link-local one. Other stable addresses
  are listed in the review as not added; temporary and link-local IPv6
  addresses are not mentioned, since they change on their own and would
  make every run differ. A subnet is added for the kept address only, and
  never for a link-local one or a /32 or /128.
- **D206. Which interfaces.** Loopback is never added, nor a card that is
  not connected and has no address (said in the review). Virtual
  interfaces (bridges, container links, VPN tunnels) are left out by
  default and listed; the review's tick **Also add the virtual interfaces**
  adds them and their subnets. On Windows the interface takes the name
  people see ("Ethernet 2"), not the adapter's GUID.
- **D207. What the device carries.** Type PC; its name is the host name
  without its domain (the merge finds it again by MAC first, then name);
  `os` is the system's name; `dns` holds the DNS servers (the PC's own
  setting, in the field Topo already has). `gw` stays empty: the gateway is
  not added (D166), so the review shows every default gateway, IPv4 first,
  as information only, with the MTUs (Topo has no MTU field and 7d adds no
  format change).
- **D208. Where the button is.** The plan's "Add menu" is the Nodes panel,
  where **＋ Add devices…** is: **＋ Add this computer…** sits under it in
  the full editor (Import… is a full-editor tool), and Settings has a
  **This computer** section with the same action, closing Settings first.
  Both go to the Import… review through a new `openResult` that starts at
  "What was understood" with no Back and the title **Add this computer**;
  everything after it (the targets, the merge review, the restore point,
  the log entry "This computer: <name>", one undo step) is the Import…
  path unchanged. Hidden wherever there is no `window.__TAURI__`.

Phase 7d review fixes (2026-11-11):

- **D209. "Connected" means a link, not only switched on.** An interface's
  `up` is true only when it is switched on and has a link: Linux and macOS
  need IFF_UP and IFF_RUNNING (Linux sets IFF_RUNNING only when the card's
  operational state is up, so NetworkManager's unplugged cards, which it
  keeps IFF_UP, are not connected); macOS also reads `ifconfig -a`'s
  `status: inactive` (unused Thunderbolt and Ethernet ports, Wi-Fi not
  joined); Windows keeps OperStatus up. On the page a card that is not
  connected is left out ("Not connected") unless it has an address that is
  not loopback, link-local or temporary (a static address kept on an
  unplugged card is documentation and stays). macOS reads its temporary
  IPv6 addresses from `ifconfig -a` ("temporary") and which cards are
  Wi-Fi from `networksetup -listallhardwareports`, both local commands
  that read this PC's own tables; Windows' temporary addresses are the
  ones whose suffix origin is NlsoRandom (5), never NlsoDhcp (3).
- **D210. The DNS servers written are real ones.** systemd-resolved's stub
  (127.0.0.53, 127.0.0.54) is replaced by resolved's own list and dropped
  when that list cannot be read, so it is never the PC's DNS. Windows
  leaves out the fec0:0:0:ffff::1/2/3 placeholders and takes the network
  cards' servers (another adapter's, a VPN's say, only when no card has
  any). The page also drops any loopback or placeholder server it is
  given; with none left, the review says the PC lists no DNS servers.
- **D211. A labelled address belongs to its card.** Linux lists an IPv4
  address added with a label ("eth0:1") under that label; it is read as
  an address of eth0 (and so listed as not added, D205), never as a
  separate virtual interface.
- **D212. The stored label stays English.** The log entry and the merge's
  source say "This computer: <name>" in English whatever the editor's
  language, as the importers' labels do; only the review's heading is
  translated.

Phase 7e (2026-11-11), the idle lock, choices the plan left open:

- **D213. D169 confirmed, with no way to slip past it quietly.** The 7.0
  review asked what happens after 5 wrong PINs where no sign-in exists.
  Built: there, each further try waits (30 s after the fifth, doubling, at
  most 15 min), and **Forget the PIN** appears only after the fifth wrong
  PIN (not from the start). Its first tap says what it does; the second
  removes the PIN and unlocks. The networks stay, since the lock never
  encrypted them. "Logged nowhere" is narrowed: nothing goes into a
  document or its log, but this browser notes it (D219), so the person
  whose PIN it was learns that it happened. A server that does not answer
  is still a sign-in (changed after review, D223). Where the server
  answers, D165's rule stands: after 5 wrong PINs only the sign-in
  unlocks. With no PIN but a sign-in,
  the sign-in is asked for (a PIN gives a quicker unlock). Nobody is ever
  left without a way back.
- **D214. Locking clears the page by reloading it.** Clearing the network
  from the page's memory piece by piece (the document, the undo history,
  the library's cards, sync and history caches) would leave something
  behind. So locking saves (the open document into its card and the tab's
  history entry, the library's writes settled, a server card's pending push
  sent, waiting at most 8 s), writes the lock, and reloads. The page that
  comes back stops in the boot before it reads the library, the tab's
  network or the server (js/app.js awaits `TopoLock.gate()`). The open
  question from 7.0, where an unkept network goes while locked: in the
  tab's history entry, where a reload already finds it, and it comes back
  after the unlock as it was. The undo history does not survive a lock,
  as it does not survive a reload. When the network could not be written
  anywhere a reload finds it (the history entry refusing it, a draft too
  big for the tab's storage), the cover goes up without the reload and
  says "The open network could not be saved, so it stays open under the
  lock."
- **D215. One lock per browser.** The lock is kept in localStorage, so
  every tab of Topo in that browser (or the desktop app's window) locks
  with it: another tab locks (saving first) when one does, a tab opened
  while locked boots locked, and unlocking in one unlocks them all.
- **D216. Idle time is shared by the tabs.** A key press, a tap, a pointer
  move, a scroll or a wheel in any tab counts; the last use is written for
  the other tabs at most every 15 s. The time is looked at again each
  minute and on coming back to the tab (a background tab's and a sleeping
  PC's timers are late), so a PC woken after an hour locks at once.
- **D217. The PIN.** 4 to 12 digits, kept as PBKDF2-SHA-256 with 600,000
  rounds and a 16-byte random salt in this browser's storage, never the
  PIN itself. Setting, changing or removing it in Settings asks for no old
  PIN (whoever is in Settings has the screen unlocked already). A page
  without Web Crypto (not a secure page) says it cannot keep a PIN, and
  the lock then works as with no PIN.
- **D218. The drafts.** What is typed in Report a problem and Record visit
  (their form step) is kept in the tab's sessionStorage at the lock and the
  dialog reopens with it after the unlock, when the same network comes
  back; otherwise it is dropped. Their send steps are not kept: by then the
  report or visit is already saved in the network.
- **D219. Unlocked without the PIN or the sign-in: said afterwards.** A
  forgotten PIN, or an Unlock because the server did not answer, is noted
  in this browser with its time. Settings, Screen lock, shows it until OK
  is pressed, and a notice says it once at that unlock.
- **D220. Unlocking by sign-in.** The cover offers a code sent to the email
  that was signed in when it locked, shown masked (o***r@example.com). It
  checks only the code (`TopoServer.verifyCodeOnly`: `/api/auth/verify`
  with this browser's device, as at sign-in), and reads no keys, sites or
  networks until the boot carries on. A sign-in that is not the same person
  is refused. The cover asks the server's health once to know whether the
  sign-in can work ("Try the server again" after a failure). The code
  makes a new session, as any sign-in does; the old one is then closed
  (D226). A sign-in link from the email opens a
  tab that boots locked like the others; its link is used after the
  unlock, as before.
- **D221. The setting.** "Lock after": Off, 5, 15, 30, 60 min or Custom
  (1 to 1440 min), kept as its own key in this browser (absent is 30), not
  in the settings carried with anything; plus **Lock now**. The same code on
  the website, the offline zip, a server's page and the desktop app (the
  window's own storage); no Rust or Go change in this phase, and the
  monitor (from 7f) is not touched by a locked window.
- **D222. The alarm card's hooks, for 7g.** `TopoLock.showOver(el)` puts an
  element in a layer above the cover (the in-page card while locked);
  `TopoLock.requestUnlock(text)` shows why on the cover with Not now and
  answers true once unlocked, false for Not now (Acknowledge and Report a
  problem); Later needs neither. `isLocked()` and `onChange(fn)` follow the
  lock. The desktop app's card window (alarm.html, 7g) is a separate window
  and is not covered by the page's lock.

Phase 7e review fixes (2026-11-11):

- **D223. A sign-in whose server does not answer is still a sign-in.**
  D213 as first built let a server that did not answer count as no sign-in,
  so anyone at the PC could cut the network (Wi-Fi off, cable out) and get
  Forget the PIN after five wrong PINs, or a plain Unlock with no PIN, past
  a lock that a sign-in protects. Now, when the lock names a person who was
  signed in, a silent server offers neither: the PIN keeps working, with
  D169's growing waits after the fifth wrong one, plus "Try the server
  again". So that nobody is stuck for good (D169: the lock is never left
  with no way back) when the server is gone for good, this browser keeps
  when the server first stopped answering (`topo-lock-down`, cleared when
  it answers and at the unlock); once it has not answered for 24 h, asked
  again with Try the server again, Forget the PIN (after 5 wrong PINs) or
  the plain Unlock (no PIN) appears, noted as D219 says. The cover says
  when that will be. Cutting the network for a day at an unattended PC
  remains a way past a lock without a PIN; with a PIN it still needs the
  PIN or that day plus five wrong tries. For the owner to confirm with
  D213.
- **D224. Covered in place, held for real.** The cover also goes up
  without the reload (D214's fallback) when this browser refuses to keep
  the lock itself (site data blocked, storage full: a reload would boot
  unlocked) and when edits wait for a history entry Back or Forward left
  (a reload would forget them); the cover says which. Such a lock is held
  in the page: another tab's storage news does not end it, and it ends at
  the unlock or with the tab. While anything is locked, no key, Ctrl+Z/Y,
  shortcut, copy, cut or paste reaches the page under the cover (a
  capture guard registered in <head>, before any other script's, plus a
  check at the top of the editor's own keyboard handler); the cover's and
  the alarm card's own fields keep their keys.
- **D225. A locked window does not open the server.** `openServerClient`
  returns at once while the window is locked, being locked or about to
  boot locked (`TopoLock.held()`), so the desktop app's client
  (js/desktopclient.js, which may open it before the boot's gate) and its
  retries read no keys, sites or sync state; the boot after the unlock
  opens it.
- **D226. Unlocking by sign-in closes the session from before the lock.**
  `verifyCodeOnly` notes the current session (`GET /api/me/sessions`)
  before verifying the code and, once the new session exists, ends the old
  one (`DELETE /api/me/sessions/{id}`, which refuses another person's).
  Each unlock by sign-in leaves one session, not one more.

Phase 7f (2026-11-11), checks on one PC with no server, choices the plan
left open:

- **D227. Quiet windows are kept by the monitoring PC, not the document.**
  "Quiet until…" on a device, on a group (from the device's Check section)
  or on the whole site (Settings) is an operational act, like an issue's
  Acknowledge: in the document it would make a revision, a log entry and a
  merge question for every maintenance hour. So the app keeps them
  (`monitor_quiet`, `<app config>/monitor.json`), they end on their own, and
  an item in one is "quiet": no outage, its time counted as maintenance.
  Offered: for 1 hour, 4 hours, 24 hours, until 08:00 tomorrow, or End the
  quiet. From 7h a quiet window set on one install reaches the site's
  monitors as a signed record, as the issue acts do.
- **D228. The upstream chain and root cause.** The chain is the cable path
  to the device (VPN tunnels and retired devices carry nothing), nearest to
  this PC first. When this PC is on the map (found by one of its MACs, read
  with `this_computer`, D166), the path runs from it; when not, from the
  device's own router (the nearest routing device that is not the Internet
  cloud), which is where any PC reaches it from. The page works the chains
  out (js/checks.js monitorChains, under 200 ms on site300) and sends them
  in the plan; the app decides the cause (src/monitor.rs root_causes): a
  down item is down "because" the nearest device in its chain whose every
  check is down. A router whose ping fails while its web page answers is
  not down, so nothing behind it is blamed on it. The cause is kept with
  every sample ("down because R1", D161).
- **D229. The check blocks (D156).** `node.checks`, a list of at most 8 per
  device (the device itself, or one service each), with the keys and order
  of docs/FORMAT.md "Answer checks", absent keys left out, so a device with
  none serializes as before; `node.target` the device's availability target.
  Not in the spreadsheet: they are what the monitors ask, not facts of the
  register, and the devices sheet's round trip is unchanged. The merge
  compares a device's checks as one field (both sides changing them is a
  question). Nothing to convert from v18; v19 was not released, so this
  phase adds to the v19 that 7b opened (D180), and the provider's target
  with its service hours waits for the reports (7j), which are what read
  it, in the same v19. Which monitor checks a block (`monitors`) is in the
  format now and read from 7h; a PC with no server checks every block.
- **D230. One network monitored, chosen when it is turned on.** "Monitor
  from this PC" needs a kept network (a card in My networks) and monitors
  that one: the plan carries its id and name, the app keeps the plan
  (`<app data>/monitor/plan.json`), so monitoring goes on with the window
  closed or another network open. The dots and the Check section's states
  show only while that network is open; Settings offers **Monitor this
  network instead** for another. Ticking the switch opens the offer under
  it: the network's name, **Keep Topo in the system tray when the window is
  closed** and **Open Topo at sign-in**, both ticked (monitoring with the
  window closed needs them), then **Turn on**. Turning it off also takes
  Open Topo at sign-in away.
- **D231. The crates (D167, for the owner to confirm).** rusqlite 0.40.2
  (MIT) with SQLite bundled (public domain; compiled in, so no system
  SQLite is needed); it brings libsqlite3-sys, hashlink, hashbrown,
  fallible-iterator and fallible-streaming-iterator (MIT/Apache-2.0), and
  vcpkg and sqlite-wasm-rs/rsqlite-vfs in the lock only (an MSVC build
  helper and the wasm target, never built here). ring, already in the lock
  through rustls, is now named for the checks' random ids. Tauri's
  `tray-icon` feature (its crates were already in the lock). Not taken:
  socket2 and windows-sys (the ICMP socket through libc, already a direct
  dependency; IcmpCreateFile and IcmpSendEcho declared by hand, as
  thiscomputer.rs declares GetAdaptersAddresses), the autostart plugin
  (Open Topo at sign-in is a desktop entry in ~/.config/autostart on Linux,
  a LaunchAgent on macOS and the HKCU Run value through reg.exe on Windows,
  each starting the app with `--background`), and an HTTP crate for the
  checks: HTTP(S) is one GET written by hand over rustls, reading the
  status line only, so ureq's redirects and body handling are not in the
  way (D193 named ureq for this; it stays the server client's). The release
  size difference was not measured.
- **D232. What answers, protocol by protocol (D155).** A TCP check refused
  is not answering; a ping asked over TCP ("TCP, not ping") and refused is
  answering, since the device itself said no. HTTP: 2xx, 3xx (never
  followed) and 4xx answer, 5xx does not. DNS: NOERROR with an answer (or
  truncated); NXDOMAIN and an empty answer are said and count as failures.
  SMTP: the 220 greeting and a 250 to EHLO, which names this PC by its own
  address literal and nothing else; STARTTLS asked for and not offered still
  answers, and says so. DICOM: status 0000; a rejection is said as its
  result/source/reason (1/1/7 is an AE title the SCP does not know). The
  checks never judge a certificate (any is accepted, its end date read)
  and never look a name up: addresses are the document's IP literals.
  Timeouts: 5 s, 10 s for SMTP and DICOM. A check that cannot be asked from
  this PC (no ICMP and no TCP port documented, no address, no DNS name, a
  TCP check with no port) is unknown, never down. Windows asks IPv6 devices
  over TCP (no Icmp6SendEcho2).
- **D233. The states in detail (D157).** Up needs 2 answers in a row also
  from unknown; slow needs at least 3 of the last 5 answers, their median
  above "slow above"; flapping counts changes between up and down only
  (not from unknown); more than 2.5 intervals with no result (the PC asleep
  or off) is unknown, and counting starts again. The first round is spread
  over at most 15 s; at most 8 checks run at once (8 worker threads); a
  plan holds at most 4000 items. The map's dot is the worst of a device's
  checks (down, down because of a device upstream, flapping, slow, unknown,
  quiet, answering), top centre, a class of its own so no export carries
  it. The Check section is the device panel's (Full editor) but translated,
  as the plan's tests ask, unlike the Advanced editor's own vocabulary.
- **D234. The statistics on the PC (D161, D162).** Each sample keeps the
  state after it, whether it was down because of something upstream, the
  check's interval and how it was asked. The time between two samples is
  the first one's state, unless it is longer than 2.5 intervals: then one
  interval is that state and the rest unknown. The hourly figures of ended
  hours are worked out once a minute; an hour no sample reaches is not
  written (a report counts it as unknown). Each figure carries the monitor
  ("local" until 7h names it). The retention is this PC's setting in 7f
  (Keep statistics: Off, 30, 90, 180, 360, 720 days or 10 years; 360 as
  shipped); from 7h the site's owner sets it and every monitor follows.
  Shortening asks first, counting the hourly figures and the items that
  will go; Off counts the samples too and empties the file. The file is
  `<app data>/monitor/stats.sqlite`, readable by this user only. The Check
  section's last 24 h come from the samples: a response-time line over a
  bar of 288 five-minute states, with the numbers in words beside it
  (answered of asked, median, 95th percentile, availability and its
  coverage).
- **D235. One monitor per PC, and the tray.** The monitor runs in one Topo
  at a time (a lock file, `<app data>/monitor/monitor.lock`); a second
  window says it runs in the other. The tray has **Open Topo** and **Quit
  Topo**, in the page's language, and its tooltip says how many items are
  not answering. Closing the window keeps the app running while it
  monitors with the tray icon; the tray's Open Topo opens the window again
  on index.html. On Wayland and some desktops the tray may not show
  (Settings says so): then monitoring lasts while the window is open.
- **D236. The DICOM cross-check, by hand.** Carino DICOM's virtual
  environment on this PC points at a Python 3.14 the system no longer has,
  so the cross-check ran against pynetdicom 3.0.4 (the library Carino DICOM
  is built on) as an SCP with the AE title TOPOTEST on 127.0.0.1:7397:
  C-ECHO answered 0000 in 6.6 ms, and a wrong called AE was rejected 1/1/7.
  It is the ignored test `dicom_cross_check` in src/checks.rs, to run again
  against Carino DICOM's `./run.sh receive --port <port>`.

From the review of 7f (2026-11-11):
- **D237. Root cause never loops.** When this PC is not on the map, a
  routing device that is checked has no upstream chain: the search from it
  has no direction, so it would find a neighbouring router, maybe one
  behind it, and two routers side by side would each be the other's cause.
  Other devices keep the chain from their own router (D228). The app also
  drops a cause whose own cause is this device, so a loop from any plan
  leaves both as their own outage.
- **D238. Retention holds while the monitor runs.** The scheduler deletes
  samples past 7 days and figures past the retention once an hour, not
  only at start and when the setting changes. The retention is read under
  the statistics' lock both when a sample is written and when Off empties
  the file, so no sample lands after Off. The monitor's folder is 0700 and
  the file is made 0600 before SQLite opens it, so its -wal and -shm files
  (which hold the latest samples) are private too.
- **D239. A backlog is served oldest first.** When more checks are due
  than 8 can run (an upstream outage with many timing out), the scheduler
  hands out the ones due longest first, not the first in the plan, so the
  last items of a long plan do not turn unknown.
- **D240. Two Topos on one PC.** Open Topo at sign-in starts one Topo
  with `--background`, and opening the app starts a second; only one runs
  the monitor (D235). Each re-reads monitor.json and plan.json when they
  change (every 2 s), so what the second window sets (the switch, Keep
  statistics, a quiet window, the checks, the tray's words) reaches the
  one that monitors, which applies it; the second shows no states or dots,
  since the states go only to the window of the Topo that monitors, and no
  tray icon (one icon, the monitoring Topo's). A Topo
  whose monitor is on takes it over when the other quits. `--background`
  opens no window only when the tray icon was really made; otherwise the
  window opens. The tray's menu is made again when the page's language
  changes.
- **D241. SMTP only where the device documents it (D155).** An SMTP check
  runs only when the device's Allowed ports hold the check's port (25
  unless set) over TCP. The Asks list offers SMTP only on a device that
  documents 25, 587 or 465, and picking it takes the documented port. A
  block that does not match (from a file, or a port typed later) stays in
  the document, the card says why, and the plan leaves it out.
- **D242. Small fixes to the check fields.** The availability target is
  rounded to 3 decimals before its range is checked, so 99.9999 is refused
  instead of becoming 100. The Every list shows an interval it does not
  hold (45 s from a file) as itself, not as its first choice.

Phase 7g (2026-11-11), issues and the alarm, choices the plan left open.
The owner's later answers (the app becomes a server client, D144; no status
board, D145) change nothing here. D172 (three buttons on the card instead of
D130's one OK) was not answered; 7g builds it as D172 proposes, and the
fallback (one OK as Later, acting in the Problems tab) is a change to
desktop/alarm.html alone.

- **D243. One issue per device, opened by the app.** An issue belongs to a
  device, not to one of its checks: it opens when a check of the device is
  down and nothing upstream is down (the device is its own outage, D161,
  D228), and lists as `behind` the devices down because of it. A device
  that is then down because of one upstream keeps its own outage going (it
  is not answering again). It answers again when none of its checks is down
  and at least one answers: unknown (the PC asleep) and quiet are not
  answering again. A device taken out of the checks while down ends its
  outage unseen (`gone`), with no notification. Issues are worked out in
  Rust from every status change (src/issues.rs), so they open with the
  window closed, and kept in `<app data>/monitor/issues.json` (read again
  when the other Topo on this PC changed it, D240); their id is
  "in" and 10 base-36 characters, the incident's form, so the record and the
  incident are the same id.
- **D244. After an act, the outage stays on its issue.** Acting closes the
  issue but the device may still be down: that outage stays on the closed
  issue (no new issue, no second alarm) until the device answers; down again
  after that is a new issue. A repeat while the issue is open raises the
  card again, unless the issue is flapping (D157: one issue, marked).
- **D245. Expected, in the statistics.** Expected relabels the device's own
  down samples from the outage's start to the act as maintenance (quiet)
  and works their hours out again (stats.rs `mark_maintenance`); hours
  older than the samples (7 days) have their down seconds moved to
  maintenance as they stand. Down because of a device upstream is left as
  it is. Until the device answers again it shows and records as quiet
  ("Expected (maintenance): quiet until it answers again"), so the rest of
  that outage is maintenance too.
- **D246. Folding.** Any editable, unlocked page with the record's network
  open folds every record of it (js/issues.js): one undo step for what it
  folds at once, an `incident` log entry `outage` for a new outage and one
  per act (`acknowledged`, `reported`, `expected`); a recovery or a repeat
  updates the outage with no entry. The outage is an incident with `kind:
  "outage"` and its own fields (`outages`, `behind`, `monitor`, `flapping`,
  `gone`, `acts`; docs/FORMAT.md section 6), added to the unreleased v19
  as 7b and 7f did, with a symptom from the device's type so the lists,
  the marker, the landing line and step-4 routing read it as any report. A
  read-only network folds nothing. The app is told which records were
  folded; a closed record whose outage has ended goes once folded, any
  closed one after 30 days, at most 500 kept.
- **D247. Acting.** An act goes into the document first (one undo step, its
  entry), then to the app's record. Report a problem is the step-4 report,
  prefilled with the device, its symptom and what the monitor saw; the act
  is its save (with the report's id), so closing the report unsaved leaves
  the issue open, and nothing is sent until the person sends it. "Who" is
  Settings' reporter name, else nobody named. Acts the document holds that
  the record lacks (made on the website, in a file, in another window) are
  sent back to the app at the next fold, so its record closes too. Who may
  act: an editable network's owner; in provider mode or as a provider
  member, only on devices `providerCovers` gives the provider they act as;
  a viewer (read-only) sees no buttons. Signatures and the server's role
  checks are 7h (D159).
- **D248. Two installs acting at once.** The merge takes an outage's acts
  and times down as unions (an act is the same act by its kind, time and
  author; a time down by its start, its end the later one known), `behind`
  as a set, and two closes as the earlier one, never as a question.
- **D249. The card window.** One card at a time; the next waits (the card
  says how many). Each monitor gets a window placed on it and made full
  screen, always on top, out of the taskbar, the primary's focused. On
  Wayland a window cannot place itself on a monitor, so the windows may all
  land on one; the notification covers that. The card is amber (#b45309,
  white text) in both themes, Atrium's layout; its words live in
  desktop/alarm.html in the five languages (it does not load js/i18n.js),
  and its language is the page's (sent with the tray's words). Acknowledge
  with the window unlocked opens a note on the card and writes the act on
  the record (who: the name the page sent); while locked (the lock's key in
  the shared storage) it is handed to Topo's window, which asks to unlock
  first (D222's `requestUnlock`), as is Report a problem always, since the
  report is a dialog of the main window: it opens the issue's network (asked
  like any Open when another one has unsaved work) and the prefilled
  report. Later and Escape need no unlock. The window is not under the
  page's lock, so `TopoLock.showOver` is not used. Its capability grants
  event listening only (capabilities/alarm.json).
- **D250. The chime and the notifications, with no crate.** The chime is two
  short tones from Web Audio in the first card window, once per card, at
  the page's own level; the system volume is never touched and nothing is
  spoken. A webview may hold back sound until a click; then the card shows
  silently (not seen in a desktop session here). The system notification
  goes through the desktop's own tools: `gdbus` to
  org.freedesktop.Notifications on Linux (critical for an outage, so it
  stays; normal for answering again), `osascript` on macOS and a PowerShell
  balloon on Windows, fire and forget; the words are the page's, sent with
  the tray's. Answering again is that small notification, plus a toast when
  the network is open.
- **D251. The setting.** Show alarms on this PC is this PC's (monitor.json
  `alarms`, off as shipped), in Settings under Monitor from this PC, with
  the Wayland caveat. Turning it off drops the waiting cards. Test the alarm
  sends the page's words first, then shows the card marked DRILL (its
  buttons only close it) and a notification. Until 7h the alarms come only
  from this PC's own monitor; the website's banner for signed-in pages
  (D158) needs the records through the server and comes with 7h.
- **D252. "Checked by monitor".** Until 7h names monitors, the PC's host name
  (`this_computer`) is the monitor's name on an issue.

The 7g review (2026-11-11) settled these:

- **D253. A record's end without a person.** When the monitor's plan moves
  to another network (or to none), the outages of every other network
  still going on end unseen, `gone`, as for a device taken out of the plan
  (D243): none stays "not answering since" for ever, and a closed one can
  go. Expected masks a device only on the network watched (a copy of a
  network shares its node ids). The page tells the app which records have
  a device that is no longer in the document (`monitor_issues_folded`
  `dropped`); the app drops them once their outage is over (one still going
  on ends as `gone` when the plan loses the device, then goes).
- **D254. Undoing a fold.** A fold stays one undo step, and Undo may take it
  back: the page then folds a record again only when its `rev` changes (or
  the network is opened anew), not on every redraw, so the redo stack is
  kept. The app forgets a closed, ended record only when a page finds it in
  the document as the record says without having folded it there itself in
  this undo history (D246's "goes once folded" now reads "goes once found
  folded"); a record this page just folded waits for the next opening of
  the network or start of the app. Nothing is lost by an Undo: the record
  stays until then, and the next fold brings it back.
- **D255. Expected covers the whole issue.** Expected relabels every outage
  of the issue (repeats included) as maintenance, over every check of the
  device in the plan and the checks down when the issue opened, each from
  its start to its end (the act's time for one going on). Hourly figures
  older than the samples are relabelled only within each span.
- **D256. A report made from an outage is one step.** Saving it adds the
  report, the outage's `report` act and both log entries (`opened`, then
  `reported`) in one commit, so one Undo takes both back; the act goes to
  the app after the commit. Its "by" is the report's reporter name (the one
  Settings then keeps), else Settings'. An issue someone already acted on
  is not acted on again: a late hand-over from the card, Acknowledge,
  Expected or Report a problem on a closed outage says "Someone has already
  acted on this issue." A hand-over heard live clears the app's copy
  (`alarm_take`), and the same hand-over twice within 5 s is taken once.
- **D257. Limits in characters, and the notifications' numbers.** The app
  cuts "by" (120) and the note (2000) by characters, never inside one, and
  before it compares an act with those it holds, so an act cut on one side
  is still the same act (`act|at|by`) on the other. A notification for one
  device behind the root cause has its own sentence ("{name} and 1 device
  behind it are not answering"); Russian sentences with a count read right
  after any numeral. Turning Show alarms on this PC off closes the card
  windows (a drill shown stays). The Wayland caveat in Settings and
  FEATURES also says the card may show on one screen only.

Left for the phase that builds it (not decided here): how the welcome
reaches "Connect to a Topo server" on an app that is not yet a client (7l,
after 7c; decided in D330). The heartbeat's interval, left to 7h, is D264.

Phase 7h (2026-11-11), monitors through the server, choices the plan left
open. The owner's later answers (the app is a server client, D144; no status
board, D145) are what this phase builds on: a site monitor is an app
connected to its server.

- **D258. The Rust encryption's crates (D136, D167, for the owner to
  confirm).** p256 0.13 (MIT/Apache-2.0, RustCrypto) with `ecdh`, `ecdsa`,
  `pkcs8` and `std`, for ECDH and ECDSA on P-256 (ring, already here, cannot
  keep a static ECDH key, which a monitor needs to open the site key wrapped
  to it). AES-256-GCM, HKDF-SHA-256 and the random bytes are ring's, so
  aes-gcm is not added; hkdf, hmac, ecdsa, elliptic-curve, primeorder,
  crypto-bigint, rfc6979, sec1, der, pkcs8, spki, ff, group, rand_core,
  signature, base16ct, base64ct and const-oid come into the lock with p256
  (all MIT/Apache-2.0). Fetched from crates.io; the release size difference
  was not measured. src/servercrypto.rs reimplements the wraps, rosters,
  signatures (P1363) and the new records. The vectors go both ways:
  server/internal/tcrypto/testdata/record_vectors.json is made by
  js/servercrypto.js (`node tests/crypto-cross.mjs --write`) and opened by
  Rust and verified by Go; src/testdata/rust_vectors.json is made by Rust
  (`TOPO_WRITE_VECTORS=1 cargo test rust_vectors`) and opened by
  js/servercrypto.js (`node tests/crypto-cross.mjs`); the existing WebCrypto
  vectors (rosters, a site wrap, a revision) open in Rust too.
- **D259. Records.** One shape for everything a monitor or a person writes
  beside the document: `{v, site, kind, id, epoch, author, at, ctHash, sig,
  iv, ct}`, AES-GCM with the site key of `epoch`, its AAD
  `topo-record-v1\nsite\nkind\nid\nepoch\nauthor\nat`, signed (P1363) over
  the AAD and the ciphertext's hash by the author's key (a monitor's device
  key, a person's U_sig). Kinds: `status` (one per monitor, kept alone),
  `issue` (a monitor's; its plaintext is the app's issue record), `act`
  (a person's Acknowledge, Report a problem or Expected: `{issue, act, at,
  by, note, reportId, as}`), `quiet` (an owner's quiet window: `{scope, id,
  until}`), `stats` (a monitor's day of hourly figures, kept apart). The
  server checks the shape, that the author is the caller, the signature
  under the key it registered and that the epoch is the site's (409
  `stale-epoch` after a rotation); it never reads the plaintext. One record
  per kind and id; a newer one from the same author replaces it with a new
  number, which readers ask for (`?since=n`).
- **D260. A monitor on the server (D146, migration 0005).** A users row with
  the id `m_` and 22 lowercase hex digits, which is also its email (so its
  roster line is `m_…|m_…|monitor|enc|sig`, lowercase and with no "@", and
  it can never sign in), carrying the PC's keys; a member with the new role
  `monitor` (the members table is made again with it in its CHECK, tested
  from a v0.0.1 database); a `monitors` row with its name, who turned it on,
  when, the token's SHA-256 and its heartbeat. It is given access through
  the existing grant (the roster and the wrap), gets no email, is never in
  the server's list of people, its role cannot be changed and no one can be
  made a monitor; removing it from Members revokes it as Revoke does. Its
  users row stays (disabled) after a revoke, so the records it signed can
  still be checked. `sites.stats_days` (360) is the site's Keep statistics.
- **D261. The monitor's credential.** A random token, answered once by
  `POST /monitors` and kept on the PC; it is sent as `Authorization:
  Topo-Monitor <token>` with no cookie (src/client.rs `set_monitor_token`),
  so it does not depend on anyone's session (D129). A monitor session may
  only read its own site (GET of the Member and Reader routes: the summary,
  rosters, its wraps, revisions, records, monitors, statistics), write its
  status and statistics (the new class Monitor) and post issue records.
  Everything else (a revision, a visit copy, leaving, /api/me, the event
  stream, another site) is 403 or 404.
- **D262. The keychain with no crate.** The secret (the device keys and the
  token, one JSON text) goes to the system's own keychain through its own
  tool, as the notifications do (D250): `secret-tool` (Secret Service) on
  Linux, read back to be sure; `security` on macOS; CredWriteW/CredReadW
  declared by hand on Windows. Where none takes it, a file only this user
  can read (`<app data>/monitor/monitor-key.json`, 0600 in a 0700 folder),
  and Settings says so. `TOPO_KEYSTORE_DIR` makes the tests use the file
  only, so no test touches the real keyring. The macOS and Windows code is
  built only there and was not compiled here.
- **D263. What the monitor trusts.** The roster the enrolling owner's page
  trusts (after its own walk) is handed to the app with the token; from it
  the link walks every newer roster as js/servercrypto.js acceptRoster does
  (the signer an owner of the one before, with the key its line names) and
  opens a site key only when an owner of the trusted roster signed its wrap.
  A roster it cannot accept stops it ("roster N not trusted" in Settings);
  it never trusts the server's word alone.
- **D264. The heartbeat (D151).** A monitor sends its status at least once
  a minute (sooner, at most every 5 s, when a state changes), whatever its
  checks' intervals, and the server records 60 s as its interval; 3 missed
  (3 minutes) is "stopped reporting". The server sweeps every 30 s and says
  each change once (the event `monitor`, stale true or false). An issue
  record counts as a report too.
- **D265. What a monitor takes from people.** Owners' acts close its issues
  and owners' quiet windows reach its checks (D227 now travels). It cannot
  read the network, so it cannot check what a provider covers: a provider's
  act reaches it once an owner's page, which checked it (D266), passes it on
  as an act record of its own (its id and `|o`), which is what D247's "acts
  the document holds that the record lacks are sent back" does through the
  server. A forged record, or one from someone the trusted roster does not
  name with that key, is ignored.
- **D266. A provider's scope on a server.** A provider member's act counts
  on the devices covered by the document's provider whose email is the
  member's (case-insensitive, providerCovers); with no such provider, or on
  another device, it is refused and shown to the owners.
- **D267. Folding through the server (D158).** Only an owner's page with the
  site's network open (and editable, unlocked) folds; the server is told
  which records are in the document (`records/folded`): they leave the
  backups and go after 30 days. Records waiting are kept with no time limit,
  at most 5000 per site. Refused records (forged, a role not allowed to
  write them, a provider out of scope) are never folded; the owners see "N
  records were refused" in the banner.
- **D268. Status on any signed-in page.** The map's dots and the device's
  Answer checks (read only, by monitor) show the monitors' latest status on
  every page signed in to the site that is not itself monitoring that
  network, the website included (D127: it still asks nothing). Per check, a
  monitor that stopped reporting is left out; one saying down and another up
  is "split" (purple): "Not answering from A, answering from B: look at the
  path between them, not the device" (D150).
- **D269. Assignment (D150).** The groups a monitor checks are chosen when it
  is turned on (none: the whole site) and kept on that PC
  (`monitor-link.json`), not in the document; a check's `monitors` list
  (Checked by, in the app's card, on a site with monitors) overrides them,
  and two make the deliberate two-monitor item. docs/FORMAT.md and the
  schema now say that an absent list means the monitors whose groups hold
  the device.
- **D270. The plan is still the page's (D230).** A site monitor reports with
  its window closed and no one signed in, but the checks it runs are the
  plan its own window last sent: a check changed on another PC reaches it
  the next time the network is open in that PC's window. Building the plan
  in Rust would mean reading the document there, a second copy of the
  page's logic ("Only owners write versions of the site" above).
- **D271. Keep statistics through the server (D162, D234).** The site's
  value, set by an owner in Members (Settings): shortening it when days would
  go answers 409 `confirm` with how many, and the page asks before sending it
  again with confirm; Off deletes every blob at once. The server also
  applies it every 10 minutes, refuses a day while Off or past it, and every
  monitor sets its own Keep statistics from it (`/api/monitor`).
- **D272. "Monitor at X stopped reporting" (D151).** A banner line on every
  page signed in to the site, the members list's row in red, and a system
  notification (not the card, which stays for a device's issue, D160) on
  every app with Show alarms on: from its page while open (`alarm_notify`),
  and from a monitor PC's own link with the window closed. Said once per
  episode.
- **D273. The monitor's name** is the PC's host name (D252), registered with
  the server when it is turned on and shown everywhere as "Monitor: PC name
  (turned on by X on date)". It is not editable in 7h.
- **D274. The backups' records (D159).** The backup file carries the
  unfolded records as stored (`records`, schema/topo-backup-v1.json,
  docs/FORMAT.md); opening one checks each issue (its author a monitor on
  the file's rosters, with the key that signed it) and folds it into the
  network before the usual review.
- **D275. Not done in 7h.** The Rust link (src/monitorlink.rs) is
  unit-tested against a fake server; since the review it also runs against
  the real binary (tests/server-e2e.mjs step 15k, through
  desktop/src-tauri/examples/monitor-link.rs: the app's link, crypto and
  transport with a stand-in for the checks), and a record the Rust seals
  verifies in Go (tcrypto TestVectorRustRecord). The app was not started in
  a desktop session (the real keychain, the thread with the window closed,
  the notification from Rust), and the macOS and Windows keychain code was
  not compiled here. The website does not yet draw the pulled hourly
  figures (TopoMonitors.stats reads them, for 7j's reports).

Decided in the 7h review (2026-11-11):

- **D276. One site per monitor PC (D146).** A PC is the monitor of one site
  in 7h: one link (`monitor-link.json`), enrolled from the network open in
  the window. D146 says the owner picks the sites; several links would need
  a plan per site from the page, and the app runs one monitor (D235), which
  checks one network. Another site needs another PC, or this one turned off
  and on again there.
- **D277. Records stay bounded.** Folding an issue folds the acts on it too:
  the server does it by id (an act's id is `<issue>|<act>|<at>[|o]`, which
  it can read), and the owner's page also reports the acts it folded after
  their issue. An owner's page passes a provider's act on (`|o`, D265) once
  per page, with the act's own time, so a repeat is an older record the
  server refuses with no new event; not when an owner's own record of that
  act is there, nor while the issue's monitor is revoked or stopped
  reporting. At the 5000-record cap the server first deletes the oldest
  folded records; a monitor's issue is never refused for the cap (acts and
  quiet windows are). The link runs each step whatever another one met, so
  a refused issue does not stop it taking acts or sending statistics.
- **D278. A monitor reports only the site's network.** The link keeps the
  site's network (its library card id) from the enrolment; turning on is
  refused while this PC's monitor watches another network, and while it
  does later (Settings, the other network), the heartbeat still goes with no
  items and no issue or statistics goes.
- **D279. A revoke is taken only from the server.** A failed credential
  lookup (the database) is 503, never 401. The app takes a revoke (and
  forgets its keys) only on the server's own `{"error":"unauthorized"}`
  seen on two turns in a row; any other 401 (a proxy's page) is an error
  that passes.
- **D280. Records after a rotation are not passed over.** A record whose
  author the trusted roster does not name yet, or whose epoch has no key
  here, makes the link read the site again at once (once per pull) and try
  it again before moving past it.
- **D281. Quiet windows through the server (D227, D265).** An owner's quiet
  window (a device, its group, the whole site) is a signed `quiet` record,
  one per scope and id, from the app and from the website alike: owners get
  the Quiet control in the device's read-only section on any signed-in
  page. The page shows this PC's and the site's windows (the later of
  each). A provider's quiet record is refused (only owners). A window that
  ended is folded.
- **D282. Keep statistics on a monitor PC is the site's (D271).** While the
  PC is the site's monitor, Settings shows the value as set by the site's
  owners and does not change it; the link applies the site's value on its
  first read (the link starts at -1) and whenever this PC's differs.
- **D283. Turning on and off cleanly.** A turn-on that fails after the
  server made the monitor takes it away again. The server's sweep counts
  only granted monitors as stopped reporting. Off while not signed in as an
  owner of the site says plainly that the server cannot be told: only this
  PC forgets, and the site lists the monitor until an owner revokes it.
- **D284. Status of revoked monitors; split in words.** An open page drops
  a revoked monitor's last status at the next read. A device that reads
  "split" now says so in the banner and on its Problems row ("not answering
  from A, answering from B"); the issue stays the monitor's own (per
  monitor, D150).
- **D285. TOPO_MONITOR_SWEEP** (default 30s, 100ms to 10m) is the sweep's
  period, a configuration key like the others (the end-to-end test sets
  200ms). The environment name of the first build was refused by the
  configuration check as unknown, so it never worked.

Phase 7i (2026-11-11), the visit monitor, choices the plan left open:

- **D286. Where it runs and what it asks (D148).** "Monitor during this
  visit" is a section of the report's tab in provider mode, in the desktop
  app only (the website and the zip show nothing, D127), once the provider
  has chosen which provider they are. It asks the v19 check blocks of the
  devices `providerCovers` gives that provider, with the site monitor's
  upstream chains (js/checks.js monitorPlan): a covered device with no
  check block is not asked (the tab says to add one in its Answer checks,
  which becomes part of the visit's proposed changes; D128 "only items
  marked to be checked" holds). It runs in the app's process beside any
  site monitor (src/visitmon.rs `Session`, its own schedule and states,
  src/visitcmd.rs the commands `visit_monitor_start`, `_plan`, `_info`,
  `_figures`, `_stop`, `_end`); D235's one-monitor lock is the site
  monitor's and does not apply, so both may ask the same device. At most
  400 checks per visit. A check added while it runs joins it.
- **D287. Where its data lives (D148, D174).** The samples are kept in an
  in-memory SQLite only, never on disk, never pushed: a Topo that quits
  while it runs keeps nothing. Stop ends the checks and drops the samples;
  the figures it made stay in memory and in `<app data>/monitor/visit.json`
  (0600), so a Topo closed between Stop and Record visit still has them.
  Everything goes at Record visit (once the visit is saved), at Discard,
  when a new session starts (Start again asks first) and at the person's
  own sign-out from the server (js/server.js now says `signed-out`; an
  expired session, a lock or a reload is not a sign-out). Leaving provider
  mode is a Stop. Its figures belong to the network it was started on
  (the page's docId); another network's Record visit does not take them.
- **D288. Statistics Off (D162).** Off is the site's Keep statistics on a
  server card and this PC's own otherwise; a link or file copy cannot know
  the client's, so the provider's PC's setting stands. Off: no sample and no
  figures (the session starts with nothing kept), the states and outages
  still show, the dialog says so and the visit gets no section. The number
  of days is ignored (D162: a visit's figures live only in the visit).
- **D289. The section in the document.** The visit entry's `monitoring`
  (format v19, which is still unreleased, so no migration; js/model.js
  visitMonitoring, schema/topo-v19.json, docs/FORMAT.md): the span, per
  check answered of asked, loss, availability with its coverage (D163),
  median and 95th percentile, a chart of at most 48 points (the median
  answer and the worst state of each), and the outages, at most 60 checks
  (the rest counted) and 100 outages. Being in the log entry it is in the
  hash chain, saved in the same undo step as the visit, and travels with no
  change in the link or file back and in the server's visit copy (7b),
  where the owner reviews it with the visit. The entry's English summary
  adds "monitored N checks, M outages".
- **D290. Before and after (D148).** When the site has a monitor whose
  figures this page can read, each check is compared with that monitor's
  hourly figures of the 7 days before the visit's start: on a server card,
  every site monitor's blobs (TopoMonitors.stats) pooled; else this PC's own
  when it monitors the same kept network (the new `monitor_figures`). The
  medians and 95th percentiles are the hours' weighted by their answers
  (as stats.rs daily), availability up / (up + down), coverage of the 7
  days. A link or file copy has none: the section says "No site monitor:
  nothing to compare with", and the owner's review does not add it later.
  Building it found that js/monitors.js availability counted time down
  because of a device upstream twice (`sDown` already holds `sUpstream`);
  fixed.
- **D291. Outages on the provider's screen only.** A device is down while
  any of its checks is down; the outage names the device upstream when
  every check of it that is down names that one. A new outage is a toast
  and a line in the tab; the map's dots follow the visit monitor while it
  runs on the open network (over the site's states for those checks). No
  issue record, card, notification, incident or log entry, and nothing is
  folded.
- **D292. Its report.** The visit's own **Visit report**, a sheet in the
  report preview (.rpv) offered once the visit is saved: the visit (who,
  when, how it went, notes, sign-off, changes) and the monitoring section
  with a chart per check (response time over a state bar, its scale and
  colours said under it) and the numbers as tables. The network report's
  Problems and visits shows the section's tables (no charts) under the
  visit; the message back to the client and the provider panel's past
  visits get one line.
- **D293. Not done in 7i.** The app was not started in a desktop session:
  the checks' network I/O is 7f's (its loopback tests), and visitmon.rs is
  tested with a stand-in for the checks; the page's side against a stub of
  the commands and in Playwright.

7i review fixes (2026-11-11):

- **D294. Stop is final; the 7 days before are whole hours.** A check
  still running at Stop (a timeout takes seconds) changes nothing when it
  finishes: src/monitor.rs drops a result that comes after `stop()` (no
  state, no sample, no change sent, for the site monitor too), and the
  visit session ignores any change once stopped or dropped, so no outage
  opens after Stop, no sample outlives it and no toast says it. Each event
  carries its session's start, and the page drops a late event of an
  earlier session. Stopped, the tab shows the outages Stop kept. A check
  that leaves the plan while down (its device deleted or replaced, the
  check removed, no longer covered) ends its device's outage at that moment
  instead of at Stop. The comparison's "7 days before" (D290) takes only
  hours that ended by the visit's start: the hour it starts in holds
  minutes of the visit and is left out, on a server card and in this PC's
  own `monitor_figures` alike. Its coverage is printed under the before
  figures ("{pct} measured"), as D163 asks of every availability.
- **D295. Statistics Off fails closed.** On a server card the site's Keep
  statistics is read before anything is kept: Start reads it when this
  page has not yet (`statsAt`, set by TopoMonitors.load and loadMonitors),
  and a setting that cannot be read (offline, an error) counts as Off. Save
  in Record visit checks again, so an owner turning statistics Off during
  the visit leaves the visit with no section. When the site's monitors
  cannot be read for the comparison, the section says "The site monitor's
  figures could not be read: no comparison" (format v19 `unread`), never
  "No site monitor".
- **D296. Whose the session is; leaving provider mode ends it.** Leaving
  provider mode ends the session (it was a Stop, D287): the provider
  session goes with it, so the visit can no longer be recorded and nothing
  is kept for it. It asks first when the session runs or holds figures. A
  session started under a server sign-in belongs to that person: another
  person signed in on this PC neither sees it nor records it, and it is
  dropped when they sign in (the earlier sign-out was missed, for example
  with the app closed). With statistics Off, Stop writes no visit.json and
  removes an earlier one: D288's Off keeps nothing, not even who and what.
- **D297. A new start names the session it drops.** Any session on this
  PC goes at a new start (D287). Start now asks first whenever one runs or
  holds figures, for any network, and names the other network when it is
  not the open one.

Phase 7j (2026-11-11), the reports, choices the plan left open:

- **D298. Where a report's figures come from.** A network that is a Topo
  server's site reads its monitors' daily blobs (TopoMonitors.stats) on any
  signed-in page, the website included, which still asks nothing of any
  device (D127); otherwise the desktop app reads this PC's own hourly
  figures (`monitor_figures`, every check's key) when it monitors the open
  network (a copy of a network shares its node ids, D253, so another
  network's figures are never taken). The server's come first: a monitor PC
  pushes its own there, so reading both would count it twice. With neither
  (the website with no server, the offline zip, an app that does not
  monitor this network) the report says why and still lists the outages,
  which the document holds. The server answers 400 blobs at once; a long
  period is read on from the last day it answered (js/monitors.js stats).
- **D299. A provider's target (format v19, no migration: v19 is still
  unreleased).** A provider record gains `target` (a percent as a device's,
  D229) and `targetHours` (true: judged only during their support hours).
  Unlike a device's checks they are a contract's facts, so providers.csv
  carries them (`availability_target`, `target_support_hours`) and reads
  them back; the provider card edits them, one undo step each. "During
  their support hours" uses the hours text Topo already reads for routing
  (js/routing.js parseHours): an hour counts when its middle is inside them,
  in this browser's time (the document has no time zone); hours that do not
  read, or read as 24/7, count around the clock, and the report says so.
  Only a provider's own report is cut to their hours, with a choice in the
  left column (their own setting first); the whole network's per-provider
  rows stay around the clock and say where to look.
- **D300. Two availabilities, one judged.** Each figure is printed as seen
  (every second down counts) and "not counting upstream" (the time down
  only because a device upstream was, `sUpstream`, left out); a target is
  met or missed on the second, so a switch is not blamed for its router
  (D161). That upstream time is named per check: the outage whose devices
  behind it (`behind`) hold the device during that hour gives "down because
  R1: 30 min"; with no such outage folded yet it is "down because of a
  device upstream". A device's target comes first, else that of the
  report's provider, else of any provider covering it that has one.
- **D301. The periods.** The last 24 hours, 7 days, 30 days and 91 days (a
  quarter), rolling, ending at the last whole hour (an hour's figures are
  made once it has ended), and since the last visit (the newest `visit`
  entry's `left`, else its time; in a provider's report their own visit),
  from the first whole hour after it. Calendar months were not taken: a
  rolling period reads the same whichever day it is printed. The coverage
  of each figure is the hours measured over the period's hours (or their
  support hours).
- **D302. Pooling.** Several monitors on one check (D150), the checks of a
  device, a group (every group a device is in, at any depth, up to 50), a
  provider and the whole report are pooled: their seconds and checks are
  added and the coverage is over every stream's span. A device's figure is
  therefore the time-weighted mean of its checks, not "down while any check
  is down": the hourly figures cannot say whether two checks were down at
  the same moment. The medians and 95th percentiles are the hours' weighted
  by their answers, as stats.rs daily does.
- **D303. Outages, MTTR and MTBF.** An outage is listed when its device or
  a device behind it is in the report and one of its times down overlaps
  the period: its first start in the period, its time down cut to the
  period, its root cause (its own, with the devices behind it; or "down
  because R1" in a report of a device behind it), every act with who and
  when, and the time to acknowledge (the first act less the first time
  down). Per device, from its own outages that started in the period:
  MTTR is the mean length of the ones that ended, MTBF the period's time
  less the time down, divided by the failures. An issue whose first act is
  Expected is maintenance (D158, D245), not a failure, and is left out of
  both (and of the Outages tile, which counts it apart). (D313: any act
  Expected, not only the first.)
- **D304. The provider's section.** Their report (js/providerreport.js),
  and so the file a Report a problem attaches (D97), carries a Monitoring
  section after their devices when one of their devices has a check: their
  devices only, availability against their target (in their hours when
  they ask for it), response times as a table and their outages; since
  their last visit when it ended within 91 days, else the last 30 days. No
  charts there: their report stays phone-first with no wide figure. A
  section that cannot be made is left out, never a reason for the report to
  fail. The full report with charts is their card's **Monitoring report**.
- **D305. One CSV.** The preview's CSV button saves one file
  (`topo_<org>_<site>_<date>_monitoring.csv`) whose `section` column says
  what each row is: `availability` per check, `availability-device`,
  `-group`, `-provider`, `-total`, `response` per check per step of the
  chart, and `outage`. English column names, numbers with a dot, times in
  ISO 8601 (UTC), only the parts ticked. It is an export: nothing reads it
  back. An outage row carries every act in order, joined with "; " in
  `acted`, `acted_by` and `acted_at` alike (D314).
- **D306. An outage in the network report.** The site report's Problems and
  visits prints an outage (step 7g) as one: its device, the devices behind
  it, each time down with its length, the time down in all, the monitor,
  who acted and how long it took to acknowledge; never the empty reporter
  and Sent to rows a problem report has. This was the outage section 7g
  left for the reports.
- **D307. The charts.** One per check with figures, its table of the same
  steps beside it (under it on a phone): the median solid and the 95th
  percentile dashed in one blue, over a bar of each step's worst state
  (green, amber, red, grey), as the visit report and the Check section draw
  them (Branding Data Viz: inline SVG, no library). A step is the shortest
  of an hour, 6 hours, a day and a week that gives at most 31 points. The
  slow hours are the slow time of every check by the hour of the day it
  fell in, in this browser's time. The tiles at the top follow Branding's
  .stat-tile: availability with its coverage, the target, the outages, the
  median.
- **D308. "TCP, not ping" in the figures.** The hourly figures did not say
  how a ping was asked, so a report could not label it (D155). stats.rs
  adds `tcp` (how many of the hour's checks were asked over TCP), carried
  in `monitor_figures` and the server's blobs when not 0; the statistics
  file goes to version 2 (an existing file gains the column, its hours read
  0, tested from a version 1 file).
- **D309. The preview's choices and CSV.** The sheet preview
  (js/sheetpreview.js) takes `controls(box)`, which fills the left column
  under the note, and `csv()`, which shows a CSV button between Print and
  Download; the labels and Locate sheets show neither, as before. The
  choices: on what (the whole network, a group, a device, a provider), the
  period, the hours (a provider with hours) and what goes in (availability,
  response times, outages; at least one). The report opens from the file
  menu's **📈 Monitoring report** (under Site report), a device's Answer
  checks (**📈 Full report…**, the app's section and the website's read-only
  one) and a provider card's **Monitoring report**.
- **D310. Retention in the reports.** Keep statistics was built in 7f (this
  PC, D234) and 7h (the site's, D271, D282): 7j adds no setting. A period
  longer than the figures are kept says so ("Statistics are kept 30 days,
  so the start of this period has no figures"), and statistics Off says
  that no figures are kept; the coverage shows the rest.
- **D311. Not done in 7j.** The app was not started in a desktop session:
  the report's local path is tested against a stub of `monitor_figures`
  (tests/suites/reports.js, tests/reports-e2e.mjs), and the column `tcp`
  in cargo tests. No Go change: the server stores blobs it cannot read.
  (After the review: the server path is now tested against the real binary,
  tests/server-e2e.mjs 15f2.)
- **D312. Whose target, on several providers.** A report on several
  providers (Report a problem sent to more than one, whose attachment is
  built for all of them) judges each device on its own target, else the
  target of the first of those providers that covers it and has one, else
  of any provider covering it: never a provider that does not cover it. It
  has no pooled target and no support hours (around the clock, said), and
  shows a Per provider table as the whole network's report does. In that
  table a provider judged only in their support hours (`targetHours` with
  hours that read) gets no met or missed on the around-the-clock figures:
  their own report gives it. The Per device rows carry their verdict.
  Support hours that read as around the clock ("24/7") are said as such,
  never as unreadable.
- **D313. Expected in the server's blobs.** The monitor PC rewrites its own
  hours as maintenance when Expected is chosen (stats.rs
  mark_maintenance), but re-pushes only today's blob (and yesterday's in
  the first two hours), so a blob of an earlier day keeps that time as
  down. The report therefore moves a device's own time down inside an
  Expected outage's spans (to its end, or the Expected act while it was
  still down) to maintenance, per hour and per check of the root device,
  never the upstream time, as mark_maintenance does. An hour already
  rewritten has no own time down left, so nothing moves twice. An issue is
  Expected when any of its acts is (the monitor marks the time whenever
  Expected is chosen), for the figures, MTTR, MTBF and the Outages tile
  alike. Re-pushing the changed days from monitorlink.rs was not taken: it
  would fix only the monitors updated, and the report must read old blobs
  anyway.
- **D314. Outage list and period edges.** The outages run on to now, not
  to the last whole hour, so an outage going on in this hour is listed;
  the period line says so ("The outages are listed up to ..."). A period
  that has no hours (no visit recorded, or less than an hour since it)
  lists no outage, in the list, the tile and the CSV. A group's report
  lists, under Per group, only the groups inside it, never itself or the
  groups it is in. providers.csv: a target out of range is a conflict on
  its row (never dropped unsaid), a "no" under `target_support_hours`
  clears the tick, and a blank cell leaves either as it is, as everywhere.

Phase 7k (2026-11-11), the remaining checks, choices the plan left open:

- **D315. Their names, ports and keys (D156, D229).** The protocols are
  `ntp` (UDP 123), `rtsp` (554), `sip` (5060), `mllp` (HL7 MLLP, 2575),
  `ipp` (631), `imap` (143, or 993 with TLS from the start) and `pop` (110,
  or 995). Two keys join the check block, in this order after `starttls`:
  `tls` (imap and pop: `starttls`, which is STLS for POP, or `implicit`)
  and `transport` (sip: `tcp`; absent, UDP). `path` serves RTSP (the
  stream, / as shipped) and IPP (the printer, /ipp/print as shipped). A
  value that is not one is dropped, as every option is. SMTP keeps its
  boolean `starttls` (7f). v19 was not released, so this phase adds to it
  with nothing to convert, as D229 did; schema/topo-v19.json and
  docs/FORMAT.md say so. The Rust checks are a child module of checks.rs
  (src/checks_more.rs), sharing its connect, line reader and the TLS
  handshake that reads a certificate's end date without judging it (D232).
- **D316. NTP.** One 48-byte client request (version 4, mode 3), every
  field zero but the transmit time, which is random (RFC 9109: it only
  matches the reply and says nothing of this PC's clock); a reply is ours
  when it is mode 4 with our time as its origin, anything else is ignored
  until the timeout. The offset is ((T2 - T1) + (T3 - T4)) / 2 with T1 and
  T4 from one reading of this PC's clock and the monotonic time between
  them, so a clock step during the check does not count, and the
  differences signed so it holds past 2036. A kiss-o'-death (stratum 0,
  said as "KoD RATE") or an unsynchronised server (leap 3 or stratum 16)
  is not answering: it serves no time. The status is "stratum N"; the
  offset (`offsetMs`, the server ahead positive) goes with the outcome and
  the page's status, and the card warns above 1 s either way ("This PC's
  clock is 3.2 s behind this server"): a warning, never a state or an
  alarm. It is not kept in the samples or the hourly figures.
- **D317. RTSP.** `OPTIONS rtsp://<address>[:port]<path> RTSP/1.0` with
  CSeq 1 and nothing else; the status line only. 2xx to 4xx answer (a
  camera asking for a login is there), 5xx does not, as HTTP (D232).
- **D318. SIP.** One OPTIONS with this PC's own address in Via, From and
  Call-ID (where the reply comes back), random branch, tag and Call-ID,
  Max-Forwards 70, no body. Over UDP it is one datagram and never sent
  again (RFC 3261's retransmissions are not used: the next check is the
  retry, and down needs 3 failures); the reply is matched by its Call-ID.
  Provisional replies (1xx) are passed. 2xx to 4xx and 6xx answer (a 404
  or 401 is the phone system saying so), 5xx does not. TCP when the block
  says so; TLS (5061) is not asked in 7k.
- **D319. HL7 MLLP.** A TCP connect closed at once: no byte written, none
  read (D155). Refused is not answering, as a TCP check. Unlike SMTP
  (D241) it is not tied to the device's Allowed ports, since it sends
  nothing; nor are IMAP, POP, NTP, RTSP, SIP or IPP, which send no message
  and no login.
- **D320. IPP.** Get-Printer-Attributes in IPP/1.1 over plain HTTP
  (`ipp://`, POST to the path), with attributes-charset,
  attributes-natural-language, printer-uri and requested-attributes
  printer-state and printer-state-reasons, and nothing that names a person
  (no requesting-user-name) or a job. A reply by length, chunked or to the
  end, at most 64 KiB. HTTP other than 200 is judged as HTTP and said as
  "http 401"; inside a 200, an IPP status below 0x0500 answers (a client
  error is the IPP service speaking) and a server error does not. The
  status is the IPP status, the state and up to 4 reasons as the printer's
  own keywords ("0000 stopped media-empty-error"); the card says "Printer
  stopped (media-empty-error)" in the page's language with the keywords as
  they are, as a warning. A stopped printer still answers: the check asks
  whether it answers, not whether it prints. ipps (IPP over TLS) is not
  asked in 7k.
- **D321. IMAP and POP.** The greeting is the answer: IMAP's `* OK` or
  `* PREAUTH` answer, `* BYE` does not; POP's `+OK` answers, `-ERR` does
  not; anything else is "bad-reply". With `starttls` the check sends
  `a1 STARTTLS` or `STLS`; refused, it answers and says so ("OK no
  STARTTLS"); agreed, the handshake on the same socket (lines are read a
  byte at a time, so nothing past the yes is lost) and the certificate's
  end date. With `implicit`, TLS first, then the greeting. Then `a2 LOGOUT`
  or `QUIT`, inside TLS when it was started. Nothing else: no CAPABILITY,
  and never LOGIN, AUTHENTICATE, USER, PASS, APOP or AUTH (the fakes fail
  the test on any). Timeouts of 10 s, as SMTP's.
- **D322. The check section.** Asks offers every protocol (SMTP still only
  where documented, D241), named NTP, RTSP, SIP, HL7 MLLP, IPP, IMAP and
  POP. Each new one shows its own fields (Stream path, Printer path, Over
  UDP or TCP, Encryption None / STARTTLS or STLS / TLS from the start) and
  one sentence of what it asks and never does, translated. The port shown
  follows the encryption (993, 995). Its line adds the NTP offset and the
  printer's state; the NTP offset above 1 s and a stopped printer colour
  the line as a certificate near its end does (D155), nothing more.
- **D323. The first check of a device.** Add a check asks what the device
  is for: a printer documenting 631 is asked IPP, a camera documenting 554
  RTSP, a phone system documenting 5060 SIP (UDP when it documents
  udp/5060 or 5060 with no protocol, TCP when only tcp/5060), as a DICOM
  node is asked C-ECHO (7f); anything else a ping.
- **D324. Not tested against real devices.** As the plan's Tests ask, every
  new check runs only against loopback fakes in `cargo test`; none was run
  against a real time server, camera, phone system, RIS, printer or mail
  server here. The website and the zip still never probe (D127): the new
  checks are Rust, reached only through the app's monitor.
- **D325. 7k review fixes.** Every TCP check that reads lines (RTSP, SIP
  over TCP, IPP, IMAP, POP, and SMTP from 7f) has one deadline for the
  whole check, its timeout from the start: before each read or write the
  socket's timeout is set to the time left, and then it is "timeout". A
  device that drips a byte at a time can no longer hold one of the
  monitor's workers for hours. IPP passes interim HTTP answers (1xx, such
  as "100 Continue"), up to 4, and reads the answer after them. NTP: a
  reply whose receive or transmit time is zero (RFC 5905's sanity check)
  is "bad-reply", not answering, so no era-long offset is shown. SIP over
  UDP leaves its socket unconnected and takes the answer from any address
  or port, matched by the random Call-ID alone, so a multi-homed phone
  system that answers from elsewhere is not marked down; this PC's
  address for Via comes from a second socket's connect, which sends
  nothing. The tests now count the datagrams a silent NTP or SIP server
  received over 1.2 s (past SIP's T1), so a resend would fail them.

Phase 7l (2026-11-11), the welcome, choices the plan left open. The owner's
later answers stand: the app is a server client (D144), and there is no
status board, so a wall display turns the screen lock Off (D145); the
welcome's lock step offers Off for that.

- **D326. When the welcome shows.** *Changed by D425: in the desktop app
  only.* On a plain start only: the page
  arrived with no fragment at all (no share, binder, sealed or asset link,
  no `#setup`, `#provider`, `#simple`, `#imagenology` or `#advanced`, no
  server sign-in or invitation link) and no `?profile=` or `?simple`, and
  boot ended on the landing (so a reload of an open network, whose
  document is in the tab's history entry, does not show it either). The
  way in is read as the page arrived, before load() takes an entry off the
  URL (js/welcome.js ARRIVAL). Test runs (`?lang=en#advanced`) never see
  it, and the plain-URL rule is untouched when it is skipped. It shows over
  the landing, which stays behind it; boot does not wait for it. The e2e
  scripts that drive a plain start (tests/server-e2e.mjs,
  tests/desktop-client-e2e.mjs) mark it done in their browsers, since
  tests/suites/welcome.js is where it is tested.
- **D327. An install already in use is not welcomed.** A browser or app
  whose library holds a network (not a template) at its first plain start
  after this phase counts as done: the mark is written ("existing") and
  nothing shows, so a person updating from 0.0.1 is not walked through
  questions they answered by using it. Run the welcome again shows it to
  them. The mark is localStorage `topo-welcome` ({ v, at, how }), this
  PC's or browser's, never the document's.
- **D328. Next, Skip and closing.** Next applies what the step shows;
  Skip this step applies nothing (a theme only looked at goes back); ✕,
  Esc or a click beside it end the welcome, keeping what earlier Nexts
  applied and nothing more. The mark is written when it ends, however it
  ends, and not before: a page closed half way asks again next time. The
  last step's Skip reads Not now and leaves the landing as it is.
- **D329. The mode, and the plain URL (for the owner).** Report problems
  then General or Imagenology, or Document the network, set
  `state.settings` exactly as the mode picker does (D142). The rule that a
  plain URL opens the full editor is unchanged, so the next plain start
  (every start of the desktop app) opens the full editor even after Report
  problems was chosen; the welcome's note points at the mode button. Open
  for the owner: whether Report problems chosen in the welcome should make
  that PC's plain start open the simple view. Not built, since it changes
  the plain-URL rule.
- **D330. A server chosen in step 3 ends in Settings.** Connect to a Topo
  server and Make this PC the server do not ask for an address or the
  owner's email in the welcome: its last step becomes "One more thing" with
  Open Settings, which opens Settings at that section (the address field
  focused; or, for this PC, the section filled from the app and the owner's
  email focused, the same as D125's Yes, now `dsOpenSetUp` in
  js/desktopserver.js). The address, the certificate compare, the sign-in
  and the service set-up stay where they are (D143: no second way), and the
  start page that follows is the server's. Step 3 is not asked on a page a
  Topo server served, nor in an app window already connected to one. On
  the website it shows On this browser as the only choice, and the note,
  and applies nothing.
  *Changed by D353 (7o): in the app, a server chosen in step 3 is set up
  in Setup itself, step by step, by the functions Settings uses; there is
  no hand-over to Settings any more. The website and a page a Topo server
  served are as above.*
- **D331. This PC's two ticks wait for an open network.** Add this
  computer adds to the open network and Monitor from this PC checks a kept
  one, while the welcome runs over the landing with none. Ticked, they are
  queued for the tab (sessionStorage `topo-welcome-next`, so the reload
  that Connect makes keeps them) and run in that order once a network is
  open and nothing else is on screen (no landing, no dialog, not locked):
  Add this computer opens its review; Monitor from this PC opens Settings
  and ticks its switch, which opens the offer under it (or says the
  network must be kept first). Turning the monitor on stays the person's
  click, with its tray and sign-in ticks (D131). Given up after 30 minutes.
- **D332. D125's question, once on every path (D170).** The welcome asks
  the app (`server_question`) whether to offer Make this PC the server: a
  PC that can run the service and does not, whose Windows installer did
  not ask, and that has not answered before (an app updated from 0.0.1
  that answered is not asked). The answer is sent when the welcome ends,
  so Back can change it: "yes" only when chosen, "no" when skipped or
  closed; nothing when it was not offered. The old prompt (`dsFirstRun`)
  stays only for a start where the welcome does not run (an install in
  use, a start by a link): the welcome calls it then, instead of it
  running on its own timer, so no start asks twice. *Changed by D336:*
  the choice is offered wherever the service can run and is not set up,
  and "yes" is sent only through Open Settings. *Changed by D353 (7o):*
  "yes" is sent once Setup has set the service up (its Set it up worked);
  any other ending is "not now", as before.
- **D333. The lock step.** Off, 5, 15, 30 (as shipped) or 60 minutes; a
  custom time already set shows as it is, and a new custom time stays in
  Settings. The PIN (4 to 12 digits, twice, optional) is asked only when
  none is set; changing one stays in Settings. The step says that without
  a PIN the lock only hides the screen and is not encryption (D169).
- **D334. Theme through the navbar's switch.** Choosing a look shows it
  at once; Next keeps it by the navbar's own switch (carino-theme.js: this
  origin's storage and the fleet cookie), so it is the same choice as a
  click there. Without the switch (no navbar), it is written to this
  origin's storage and applied.
- **D335. How 7l is tested.** tests/suites/welcome.js (real clock, the
  app's commands stubbed as in desktopserver.js and thiscomputer.js), and
  a Playwright pass of a real plain start at 360, 390 and 1280 in Gold and
  Colourful (every step: no sideways scroll, 44 px targets on a phone, the
  mark written, not shown after a reload, no console error). The Tauri
  window and its intro are not driven (D199); the welcome runs on the
  page the intro hands over to, which is a plain start. The Playwright
  pass is kept as `node tests/welcome-e2e.mjs` (D336).
- **D336. The 7l review's fixes.**
  - *The theme step measures against the kept theme.* The welcome keeps
    the theme it opened with, then the one each Next kept; Next on a
    second visit (Back) keeps a new choice through the navbar's switch,
    and a Skip, ✕ or Esc puts the kept theme back on screen, not the one
    the welcome opened with.
  - *D125's "yes" only through Open Settings.* Make this PC the server
    chosen in step 3 sends "yes" only when the hand-over's Open Settings
    is pressed (Settings then opens at This PC as the server). Not now, ✕,
    Esc or a click beside the card send "no" (not now), as D170 reads: the
    PC is never recorded as having said yes with nothing set up.
  - *Make this PC the server is offered wherever it can be done.* D142
    lists it among step 3's three app choices, and D170 limits only the
    question to once. So the app's welcome offers it whenever the app's
    `server_info` says the service can run on this PC and is not set up,
    also on Windows (where the installer asked), after the question was
    answered, and on Run the welcome again. Only when `server_question`
    said to ask is an answer sent (D332); otherwise choosing it just
    opens Settings at that section.
  - *Next waits.* While a Next is applied (the PIN's hash), Next, Skip,
    Back and Enter do nothing, and the step moves on only if the welcome
    is still open at that step, so one Next never moves two steps or
    ends the welcome early.
  - *The 30 minutes of D331 run from the queueing.* The waiting tasks are
    stored with the time the welcome queued them (`{ at, tasks }`), so a
    tab that reloads (Connect does) gives them up 30 minutes after the
    welcome ended, not 30 minutes after its latest load.
  - *Tests.* The welcome suite also checks: the fleet cookie and the
    switch's state after Next; Back then a new theme kept, and a preview
    skipped there undone; Skip, Back and Enter waiting while the PIN is
    kept; server chosen then Not now or ✕ answering "no" with Settings
    not opened; the choice offered after an answer (no second answer) and
    not on a PC already running the service; a queue older than 30
    minutes given up. `node tests/welcome-e2e.mjs` loads real `#setup`,
    `#provider`, `#simple`, `#imagenology`, `?profile=`, `?simple`, a share
    link the page made and `#advanced` with no mark, and the plain start
    at 360, 390 and 1280 in Gold and Colourful.

Phase 7m (2026-11-11), the docs, the i18n review, the release note and the
audit of this section, choices the plan left open:

- **D337. The final wording (D168 done).** The "coming in step 7" notes
  are gone. README: what step 7 built is now in "Features at a glance"
  (problems, providers and a server; answer checks and alarms; statistics
  and reports; This computer, the screen lock and the welcome), "What it
  is not" keeps **Not a scanner** with the answer check as the one way
  Topo touches the network, and gains **Not a paging service** (alarms on
  screen only, D130); the file-format paragraph names v19 and
  docs/FORMAT.md; "Private by design" says the website and the zip have
  no server and a Topo server you host gets only ciphertext; the desktop
  section says what only the app does and points at the open items below.
  docs/FEATURES.md: "Step 7: built and still coming" becomes "Answer
  checks, monitors and statistics (step 7)", the promise as built with
  links to the sections below it; the file format names topo-v19.json
  and what v19 adds. docs/SERVER.md: the intro names steps 5 and 7, says
  only owners save versions and what a site monitor sends; the threat
  model adds what the host sees of monitors (the PC's name, who turned it
  on, the interval, the heartbeat, each record's kind, author, time and
  size, a statistics blob per monitor and day, and a quiet window's
  record id, which names the scope and the Topo id of what it quiets, never
  a name or address), that a stolen monitor PC reads the site until it is
  revoked, and that a visit monitor sends nothing while it runs; the
  provider read limit (D154) was already there. docs/FORMAT.md: "step 7h"
  dropped, the v19 migration row lists every v19 addition (the provider's
  `target` and `targetHours`, outages and their events were missing), and
  the next format's address is topo-v20.json (it said v19). js/model.js's
  v19 migration note lists the same.
- **D338. The release note.** desktop/release-notes.md is the body every
  release reuses, so the entry is a "New in 0.0.2" section at its top, in
  the client's words, saying that providers on 0.0.1 must update to work
  with a 0.0.2 server (D154) and that the new desktop pieces were not run
  on Windows or macOS. 0.0.2 is the next version (desktop/tauri.conf.json
  is set by the workflow from the tag). If the owner ships 7a alone as
  0.0.2 with the macOS icon (the plan's note), the heading of everything
  but the first item moves to 0.0.3. .github/workflows/builds.yml was not
  touched.
- **D339. The i18n review.** Every key added to js/i18n.js since 0.0.1
  (583, in both dictionaries) was read out of the file in Node and checked
  in es, pt-BR, ru and ja: present in all four, the same placeholders, no
  コンピュータ in Japanese and "PC" wherever the English says PC; the
  1397 keys the changed files use (t(), tn(), data-i18n) all have the four
  translations, and desktop/alarm.html's own dictionary covers its 22
  keys in all four. Values equal to the English ("5 min", "{pct} %",
  "⬇ CSV", "Jitter (ms)" in es and pt-BR) are deliberate. Fixed: Russian
  said "компьютер" for "PC" in five lock strings while every other new
  string says "ПК" (now ПК; "This computer" stays "Этот компьютер", as
  the English says computer there); Japanese called Expected 予定済み once
  in the report's availability note (now 予定どおり, as everywhere else);
  Spanish "Time to acknowledge" now matches Acknowledge's "Enterado"
  ("Tiempo hasta marcarlo como enterado"). Left as it is: Japanese spaces
  around "PC" both ways (この PC, このPC), as the strings before step 7
  mostly did not.
- **D340. tests/README.md complete.** Every suite in tests/suites has its
  row: the eight from before step 7 that had none (`rackports`,
  `rackpatch`, `rackschedule`, `rack5exit`, `groupfixes`, `simple`,
  `offline`, `mac`) got one, and `tests/gen-vectors.mjs` is described
  beside crypto-cross.mjs.
- **D341. The audit of this section.** Every decision from D126 and every
  phase item was walked against the code. Checked in the code: the
  numbers (down after 3, up after 2, slow over the median of 5, flapping
  at 4 changes in 30 min, samples 7 days, statistics 360 days, the
  certificate warned at 14 days, the heartbeat's 3 missed intervals, the
  lock's 30 minutes and 5 PINs, at most 8 checks of 30 s to 15 min),
  both settings off as shipped (monitor.json's defaults), no status board
  (D145), the page's CSP still `connect-src 'self'` (D127, D144), the
  card's Escape as Later and its own four-language dictionary, nextId's
  random part and withFixedIds (D178), the v19 schema's outage, target,
  targetHours and monitoring. Fixed directly: the docs above, and two
  tests that the final run showed flaky: TestMonitorLookupFaultIs503
  made its "unknown" token by putting an x first, which was the same
  token when the random one began with x (now y then); and
  tests/desktop-client-e2e.mjs wrote to the bridge it was restarting
  (a page's call during the app's restart is now answered offline, as
  the app's would be). Larger gaps are the open items below. Its review
  found two narrowings of accepted decisions the audit had not flagged,
  D179 (of D152.1) and D276 (of D146); both are now in "Waiting for the
  owner to confirm".
- **D342. One English key, one meaning (7m review).** Step 7 reused "The
  whole network" (the share dialog's "What the link carries", accusative in
  Russian: "Всю сеть") as the report's scope (nominative: "Вся сеть"). A
  key written twice in one locale keeps only its later value, so the share
  dialog read "Вся сеть". The report's scope is now its own key, "Whole
  network", in all four languages, and the second copy of "The whole
  network" is gone from each. tests/suites/i18n.js reads js/i18n.js as text
  and fails on any key written twice in one locale with two different
  translations. The 13 such keys from before step 7 (Change, Past the
  {total}-port faceplate, Back up now, Status, Where, Type, in some
  locales) are listed in the test as known and left as they were: each is
  a place where one screen shows the other's wording (for example
  Japanese "Where" as 保存先 everywhere); fixed by D350.

Owner's answers to the open list (2026-11-12):

- **D343. Ten PINs, Forget from the fifth (changes D169, D213).** Each
  wrong PIN says how many of its 10 tries are left ("Wrong PIN. 9 tries
  left.", down to "1 try left"). Forget the PIN appears from the fifth
  wrong PIN, where no sign-in can unlock (D223 unchanged: a sign-in whose
  server is silent is still a sign-in for 24 h). After the tenth: with a
  sign-in, only the sign-in unlocks ("10 wrong PINs: only signing in
  unlocks now."); with none, each further try waits 30 s, doubling, at most
  15 min, and Forget stays offered. From five to nine wrong there is no
  wait. js/idlelock.js `PIN_TRIES = 10`, `FORGET_AT = 5`;
  tests/suites/idlelock.js covers each step.
- **D344. The crates are accepted (D193, D231, D258).** ureq, rustls, ring,
  webpki-roots, base64, rusqlite with bundled SQLite, Tauri's tray-icon
  feature and p256 stay. The built app now carries their notices:
  desktop/THIRD-PARTY.txt, made by `node desktop/third-party.mjs` from
  Cargo.lock (the six build targets, no dev-dependencies) and server/go.mod
  (the modules topo-server's packages come from), lists every crate and
  module with its licence and each distinct licence text once; a crate that
  ships no licence file gets the standard text of the licence it names,
  with its authors as the copyright line. desktop/stage.sh --desktop copies
  it into the app (never the zip, which has no Rust or Go in it), and
  tests/stage-check.mjs checks that. The README's Licensing section says
  so. ring's clang need on Windows Arm (D193) still waits for a
  builds.yml change, which belongs to 0.0.2's release work.
- **D345. The alarm card's three buttons (D172 confirmed).** Before (D130):
  one large OK that closed the card, Escape the same, and acting on the
  issue happened in the Problems tab. Now: Acknowledge, Report a problem
  and Later, as built in 7g; Later plays the old OK's part and Escape works
  like Later.
- **D346. A silent server never lets the PIN go; after 72 h the network
  goes instead (changes D223).** When the lock names a person who was
  signed in to a Topo server, a server that does not answer changes
  nothing: the PIN keeps working with its waits, and Forget the PIN and the
  plain Unlock never appear, however long the silence. Losing the network
  on this PC is better than showing it, so once the server has not
  answered for 72 h (`downGraceMs`), asked again with Try the server again,
  the one way past the sign-in is **Forget the network and unlock**: the
  library card open when it locked (the lock record now keeps its id,
  `doc`), every card of that server kept in this browser, their sync
  copies, this person's keys in this browser and the tab's network not
  kept are deleted, the page is signed out (`TopoServer.forgetHere`) and
  the desktop app forgets its server connection (`dcForget`). Nothing on
  the cover, the confirmation or Settings' note names the network, so the
  person at the PC does not learn which one was open. The networks stay on
  the server; only changes not yet sent are lost. Other tabs locked with
  it drop their own unkept network too. Without a sign-in (the website, the
  zip, an app that is not a client) D343 stands.
- **D347. D179's limits confirmed** as they are.
- **D348. 0.0.3.** There is no 0.0.2: the release after 0.0.1 is 0.0.3,
  built as a draft (the Builds workflow from the tag v0.0.3) and
  published only by the owner. "0.0.2" in this section and in
  js/revisions.js means that release. desktop/release-notes.md says "New
  in 0.0.3"; the macOS Dock icon (desktop/icon-macos.svg, builds.yml) goes
  in it, and builds.yml puts the runner's clang on the PATH for ring on
  Windows Arm (D193).
- **D349. Several sites per monitor PC is a later update (D276 stands).**
  One link per PC for now; D146's several sites are not in step 7.
- **D350. A context key for one English word with two meanings (7n; ends
  D342's 13 known keys).** t() takes `'ctx::English'`: English, and any
  locale that lacks the key, shows the text after `::`, so the English on
  screen is unchanged; only a context named in I18N_CONTEXTS counts (D351),
  so an IPv6 address is never one. Markup gets `data-i18n-ctx="ctx"`, which
  makes the same key for the element's text and its marked attributes.
  Every call site of the 13 keys was sorted by meaning, and each meaning
  keeps the translation its own copy had:
  - "Change": the changes list's column is the noun, `changes::Change`
    (Cambio, Alteração, Изменение, 変更; js/changes.js); the rack view's
    "Change" (index.html, the place dialog) stays the plain key, the verb
    (Cambiar, Alterar, Изменить, 変更).
  - "Back up now", "Where", "Status" in the server's Backups sheet
    (js/serverui.js) are `backups::…`: Hacer copia ahora; Куда, 保存先
    (a destination); Состояние, 状態 (the backups' state). The plain keys
    keep the other places' words: the storage banner's Respaldar ahora;
    the summary's Где, 場所 (a place); an asset's, a problem's and an
    outage's Status as Статус, ステータス (a record's status, as in the
    Asset group, Print labels, incidents and the reports).
  - "Past the {total}-port faceplate" meant the same thing in every place
    (a port past the faceplate, in the port grid, the table and the rack
    view), so it stays one key with the translation every screen already
    showed (the later copy: "Fuera del frontal de {total} puertos"), and
    the earlier, never-shown copy is gone: two phrasings of one fact would
    only make the screens disagree.
  - "Type": the technical report's Device inventory column is
    `report::Type` with the word written for it (Tipo, Tipo, Тип, 種別,
    D351); the rack view's type picker and the CSV review keep the plain
    key (種類).
  English is unchanged. tests/suites/i18n.js has no known list any more
  (any key written twice in one locale with two translations fails) and
  checks each place's word in es, ru and ja; tests/suites/backupsettings.js
  checks the sheet's own words.

- **D351. Contexts are a fixed list, and the report keeps its own "Type"
  (7n review).** A context counts only when it is in I18N_CONTEXTS
  (js/i18n.js: changes, backups, report), not any lowercase word before
  `::`, because an IPv6 address can start with hex letters only
  ("dead::beef", "fe::1") and would have been cut; a new context is added
  to the list, and the i18n suite fails on any key with `::` whose context
  is not listed. The Japanese 種別 written for the report's inventory
  column is kept there as `report::Type` instead of being dropped for the
  rack view's 種類 (D350 asked each place to keep its own word). The
  faceplate sentence stays one key (D350). Checks now render the places:
  the summary's Where column, the report inventory's Type column, and the
  faceplate sentence against a fixed string per locale.

Phase 7o (2026-11-12), Setup does the server set-up itself, step by step
(the owner's answer to D170 and D332), choices the plan left open:

- **D352. A server only this PC reaches writes the sign-in code to its
  log.** The desktop app's "This PC only" runs topo-server with
  `TOPO_MAIL=log`, and Settings said its codes are "shown in the log
  below", but the log transport wrote the code at debug only, so at the
  default info level nobody could read it and the owner could not sign
  in. The log transport now writes the code (and the sign-in link) at info
  when the server answers only on this computer: its listen address and
  its public address are both loopback. Anywhere else (a LAN server, a
  server behind a proxy or a public name) it stays at debug only, as
  before; the address stays masked either way. The service settings file's
  comment ("writes sign-in codes to its log") is now true. Go:
  `TestLogTransportCodesOnThisPCOnly` (server/internal/mail), and
  `TestLogTransportHidesCodes` now runs on a server other computers
  reach. *Replaced by D358 (7o review): the service's log cannot be read
  by the app on a Mac or by a person outside wheel/adm/systemd-journal on
  Linux, and on Windows (and for those groups) it can be read by other
  accounts, who could then sign in as the owner. Codes are back at debug
  only; the app fetches them with its own key.*
- **D353. The server in Setup, step by step (changes D330, D332).** In the
  desktop app, a server chosen in step 3 is set up in Setup; Settings stays
  the other way to the same set-up, and every step calls Settings' own
  function, so there is one implementation:
  - *Connect to a Topo server:* the address (srvAddr: js/desktopclient.js
    `dcConnect`, with the address Setup asked); a server that signs its
    own certificate shows its address and fingerprint to compare
    (srvCompare: Settings' words; Next is "They are the same: connect",
    `dcTrust` pins it; Back is `dcCancel`, nothing pinned); the window
    reloads as the server's client; then the sign-in.
  - *Make this PC the server:* the owner's email and who opens it (This PC
    only, or Other PCs on this network with the email server's fields:
    SMTP server, port, security, user, password, Send from). Set it up
    puts these over the saved settings into the This PC as the server
    section's own form and presses its own "Run it in the background from
    startup" (js/desktopserver.js `dsSetUpWith`, which is
    `dsInstallService`; on a PC where the service is already set up, the
    section's Save, as Settings offers then). The app's refusals are said
    in Settings' words (`dsErrText`). D125's "yes" goes once this worked.
    Then the wait (srvWait, no Next): `server_info` every second until it
    runs (and, for other PCs, has its certificate's fingerprint), up to 90
    seconds; then `dcConnectOwn` connects this window and it reloads. A
    service that does not start, or an error from it, is said with Try
    again, which is Settings' Start (`dsStart`), then the wait again.
    "This PC only" sends no email: the app fetches the codes (D358);
    sending them by email for this PC alone, the port and the address to
    give people stay in Settings.
  - *The sign-in, both ways:* the email (srvEmail, js/server.js
    `requestCode`; the setup code field only when the server has no owner
    yet and is not this PC's own) and the code (srvCode, `verifyCode`). On
    this PC's own server with no email the owner's email is filled in and
    the app fetches the new code from this PC's server with its own key
    (D358; only a code sent after Send) and Setup fills it in; Sign in
    stays the person's press. A first owner's keys and
    recovery key follow as at any sign-in (the server sheet over Setup); a
    locked device opens the unlock, as the sign-in sheet does.
  - *The end:* the last step says "All set": connected to the server, and
    signed in as whom (or to sign in from the start page), with Finish;
    the three ways to start are not shown, since the start page behind is
    the server's (D330).
  - Each server step says its error on the step (in Settings' or the
    server's words, as an alert) and Next tries again; Next, Skip and Back
    wait while a step runs (D336). The step count follows what is chosen
    and done (the comparison only when there is a certificate to compare).
- **D354. Back and Skip in the server walk.** Back on a server step goes
  to the step before, with the error cleared; from the comparison it is
  `dcCancel`, back to the address. Skip this step on any server step ends
  the walk (the next step is the lock): what was done stays done (a
  connected window stays connected, a service set up stays set up), the
  rest is in Settings, and each server step says so. A window Setup has
  connected shows step 3 as "Connected to a Topo server" with its
  address (Disconnect is in Settings), so Back to it changes nothing.
- **D355. A reload in the middle resumes Setup.** Connecting reloads the
  window (D144). Just before it, Setup keeps its place for this tab
  (sessionStorage `topo-welcome-resume`: the step to go on at, the
  server choice, this PC's own server and its mail, the email, D125's
  state), and the boot's `atBoot` opens Setup there, whatever else that
  start is, once the server client has opened: at the sign-in, or at the
  lock when the window is already signed in; a reload that did not connect
  goes back to the address, or to the wait with Try again. The place is
  dropped when Setup ends, when the walk is skipped or signed in, when a
  connect fails, and after 30 minutes. The done mark is still written only
  when Setup ends (D328). The desktop app's own window pointed at a server
  is not "a page a Topo server served" (D330), so its steps stay.
- **D356. "The welcome" is called Setup on screen.** The dialog's title is
  "Set up Topo", ✕ is "Skip the setup", and Settings' section is
  "Setup" with "Run the setup again" (es Configuración inicial, pt-BR
  Configuração inicial, ru Начальная настройка, ja セットアップ). The code
  keeps the name welcome (js/welcome.js, `TopoWelcome`, the `topo-welcome`
  mark) to avoid churn; the old keys are gone from js/i18n.js. Every new
  string is in es, pt-BR, ru and ja; Japanese says PC.
- **D357. How 7o is tested.** tests/suites/welcome.js (real clock) stubs
  the app's commands as tests/suites/desktopserver.js and desktopclient.js
  do, with the server's requests answered by tests/fixtures/fakeserver.js,
  and simulates the reload by the boot's own steps (`DC.boot`,
  `openServerClient`, `atBoot`). `node tests/welcome-e2e.mjs` adds the app
  with `window.__TAURI__` stubbed (kept across reloads in sessionStorage),
  so the reload is real, both ways through at 360, 390 and 1280 in Gold and
  Colourful, the owner's first sign-in through the real recovery-key
  sheet. The running app, a real service and a real server were not used
  (D199): the service's set-up, start and log reading in the app are
  tested through their stubs only.

7o review (2026-11-12), the findings fixed:

- **D358. The app fetches the "This PC only" sign-in code with its own
  key, never from a log (replaces D352).** D352 wrote the code to the
  service's log at info, but the app runs as the signed-in person: on a
  Mac the log (/Library/Logs/Topo, _topo 0750) is not readable by them,
  on Linux nobody outside wheel, adm or systemd-journal reads the journal,
  so the owner still could not sign in; and on Windows (the Application
  log) and for those Linux groups any other account on the PC could ask
  127.0.0.1 for a code for the owner's email and read it, so the owner's
  account was open to every user of a shared PC. Now:
  - the app makes a 256-bit key once (`<app data>/server/local.key`,
    0600, its own account's), and writes it as `TOPO_LOCAL_CODE_KEY` into
    the server's settings (the child's environment, or the service's
    settings file, root:topo 0640 / the ProgramData ACL) whenever it sets
    up or saves "This PC only" with no email; never for other PCs;
  - the server (config `LocalCodes()`: the key, `TOPO_MAIL=log`, listen
    and public address both loopback, no TLS) keeps each address's newest
    sign-in code in memory (`mail.CodeBox`; sign-in codes only, not
    invitation links; 30 minutes; taken once) and answers
    `GET /api/local/signin-code` (key in `X-Topo-Local-Key`, address in
    `X-Topo-Email`, so neither is in a logged URL) only to a TCP peer on
    loopback with no X-Forwarded-For and the key (compared in constant
    time): 200 {code, at}, 404 `no-code` when the key matched and nothing
    waits, 404 `not-found` for anything else, as if the route were not
    there;
  - the app's `server_signin_code` command asks it (ureq, 127.0.0.1, 5 s);
    a 404 that is not `no-code` is `no-code-key` (a server set up before
    the key: Setup says to save it again in Settings and stops asking);
    js/desktopserver.js `dsSignInCode` wraps it; Setup's srvCode polls it
    for 30 s and takes only a code whose `at` is after Send (less a
    second), so an older code from another attempt is never filled in;
  - the log transport writes codes at debug only again, everywhere.
  Settings' own option is now "No email: Setup gets the sign-in codes
  (this PC only)". Not done: Settings' sign-in sheet (js/serverui.js) does
  not fetch the code itself; on such a server the person signs in through
  Setup (Run the setup again).
- **D359. Closing Setup while a step is applied waits for it.** ✕ or Esc
  (the modal's onDismiss) while a step is being applied (the PIN's hash,
  an administrator prompt, a connect, including the wait's `dcConnectOwn`)
  no longer ends Setup under it: Setup says "Setup closes once this step
  is done", drops its resume place and writes the done mark at once (a
  connect may reload the window first; Setup then neither resumes nor
  shows again), and closes as soon as the step ends. So a set-up that
  succeeds sends D125's "yes" (not "no" from the close), and nothing
  waits for the service after the close. Closing (or Skip, or Back) while
  comparing a certificate Setup's Connect asked for cancels it
  (`dcCancel`): nothing pinned, and Settings does not later show a
  comparison for a server the person walked away from.
- **D360. Two error sentences translated; the Save path tested the real
  way.** "Settings is still busy with the server. Try again." replaces the
  English code word in "Something went wrong: busy"; a missing desktop
  client says "This window is not connected to the server. Try again."
  The welcome suite reaches Settings' Save by Back from the wait to the
  owner step and Set it up again (the service already set up), instead of
  forcing the offer on.
- **D361. Settings in section tabs, as the About window (7p, the owner,
  2026-11-12).** The long Settings scroll is now six tabs down the side of
  the dialog (on a phone, 640px and under, a row across its top that
  scrolls sideways inside itself, each tab 44px tall), in the look of the
  navbar's About window. Its classes are scoped to #carinoNav and
  carino-ui.css has no such tabs, so css/app.css matches the look
  (`.set-tabs`, `.set-tab`, `.set-panels`, `.set-panel`); carino-navbar.js
  is not touched. The groups:
  - **Map and reports**: Map, Reports, History, Problem reports (the
    preferences every view has; "General" was not used because that key is
    already the General profile's name, Russian Общий);
  - **Screen lock**;
  - **Topo server**: Connect to a Topo server, This PC as the server (the
    server's members stay in the server sheet, js/serverui.js, which is not
    Settings);
  - **Monitoring**: Monitor from this PC with the site's monitor, Show
    alarms on this PC and the statistics kept;
  - **Back-ups**: the back-up folder;
  - **Setup**: Run the setup again, then This computer.
  Every section, control and id is kept; only their places in the markup
  moved. A tab is hidden while all its sections are (a MutationObserver on
  the sections' `hidden`), so the website and the zip show Map and
  reports, Screen lock, Setup and, on Chrome and Edge, Back-ups. The tab
  shown is kept for the browser tab (sessionStorage `topo.settings.tab`)
  and Settings opens there again; a Screen lock note not yet read (D219)
  wins over it, so it is seen. `openSettings(where)` takes a tab or a
  Settings element (or its id): it opens that tab, scrolls inside the
  panel (never `scrollIntoView`, which would also scroll the dialog's
  clipped frame) and focuses a control; `revealInSettings(el)` does the
  same once Settings is open. The tab asked for is remembered for that
  opening: while the app has not yet shown its section the first tab with
  something stands in, and the asked-for tab comes back when its section
  shows. The deep links now pass their place: the check section's
  Settings… (`setMonOn`), Setup's Monitor from this PC (Monitoring, the
  section), the server prompt's Yes, set it up (`dsOpenSetUp`: Topo
  server, This PC as the server); toasts that only name a place in
  Settings stay words. Keys: the arrows both ways (wrapping, skipping
  hidden tabs), Home and End; roles tablist, tab and tabpanel, with
  aria-orientation following the layout. No sideways swipe between tabs,
  unlike the About window: the panels hold fields and selects. The dialog
  keeps one height (min(90vh, 640px); the whole screen less 8px on a phone)
  so changing tab does not make it jump. New strings "Map and reports" and
  "Topo server" in es, pt-BR, ru and ja; the others were already
  translated.
- **D362. 7p review: the tab in view, a waiting certificate, every tab
  measured (2026-11-12).** On a phone the tab Settings opens at is brought
  into the sideways row once the dialog shows (before, it was worked out
  while the dialog was hidden and the row had no size, so a kept or asked-for
  tab at the end of the row, Back-ups or Setup, sat off the right edge).
  A server certificate waiting for a decision (Connect to a Topo server's
  Check again after a refused certificate, or a fingerprint shown to
  compare) wins over the kept tab like the Screen lock note (D219): the
  toast that announces it says "Open Settings, Connect to a Topo server",
  and the gear now opens there. The touch-size and phone-field audits
  (touchsizes3, touchfields) measure each tab that has something in it, not
  only the one shown; the check section's own Settings… button is clicked
  in the checks suite, Setup's Monitor from this PC is checked to open at
  the Monitoring tab, and settingstabs checks that Colourful was applied.
  FEATURES.md no longer gives Settings an About part (the document version,
  licence, contact and legal page are in the navbar's About window).

### Step 7: open items, for the owner

**Open items (larger gaps found by the 7m audit, not built):**

1. **D166's last sentence.** "A monitor PC that is on the map is linked to
   its item, so its issues and statistics name where it sits": the PC on
   the map is found (by its MACs) and used as the start of the upstream
   chains (D228), but an outage and the statistics carry only the
   monitor's name (`incident.monitor`, a text), never the map item, so
   neither names where the PC sits. Doing it needs a v19 field on the
   outage (the item's id), the site monitor sending it through its
   records, and the rows and reports showing it.
2. **The app was never started in a desktop session here.** Everything
   the app does was tested through cargo tests, loopback fakes, stubs of
   the commands in the browser and examples/*.rs against the real server,
   but not as the running app (see the list below).
3. **No check was run against a real device** (D324), except the DICOM
   C-ECHO cross-check by hand against pynetdicom (D236); the plan's
   cross-check against Carino DICOM itself was not run.
4. **Release size.** The new crates' effect on the installers' size was
   never measured (D193, D231, D258).
5. **Several sites per monitor PC** (D146): a later update (D349).

**Waiting for the owner to confirm:**

- D169 (and D165's note, D213): answered by D343 (10 tries, the count
  shown, Forget from the fifth). Still to confirm: the lock with no PIN
  and no sign-in gives a plain Unlock.
- D170 and D332: answered; the welcome becomes Setup and sets up the
  server itself, step by step: built in 7o (D352-D357; review D358-D360).
- D329: whether Report problems chosen in the welcome should make that
  PC's plain start open the simple view (not built: it changes the
  plain-URL rule).

**Not verified on a real desktop session, or on Windows or macOS:**

- The desktop app was built (Linux, debug) but never started in a GUI
  session for step 7: the tray and Open Topo at sign-in, `--background`
  and monitoring with the window closed (7f); two Topos on one PC
  watching each other's files (D240, no automated test either); the alarm
  card windows on real monitors, always on top, the chime under the
  webview's autoplay policy, and the gdbus notification (7g, D250); the
  real keychain through secret-tool, the monitor's thread with the window
  closed and its notifications (7h, D275); the visit monitor and the
  local monitoring report from the running app (D293, D311); the welcome
  after the intro animation in the app (7l's tests use the page with
  stubs); Connect to a Topo server from the running window (7c's tests
  drive the page through examples/client-bridge.rs).
- Built only on their own systems and never compiled here: Windows'
  IcmpSendEcho and autostart (HKCU Run), the PowerShell notification,
  CredWriteW/CredReadW and This computer's GetAdaptersAddresses reader;
  macOS's LaunchAgent, osascript notification, `security` keychain and
  This computer's reader (type-checked in a scratch crate only, the 7d
  review).
- Datagram ICMP was answered on 127.0.0.1 here (Linux); macOS's datagram
  ICMP was not run.
- Wayland: whether the card stays above other windows varies by
  compositor (the notification always goes too, D160); not seen.
- From earlier steps, still standing: "This PC as the server" started
  from the running app and the installers' bundled layout (D113, D125),
  and the Windows and macOS server installers (build-tested only).

### Phases

Stop after each phase and report the counts and failures as they are.

- **7.0** Scope only, no code: this section, and the README, FEATURES and
  SERVER wording (D168).
- **7a. Merge fixes** (D140, D152, D175): sent parts kept until answered; no
  name-only joins across providers; random id suffix. Each with a failing test
  first. This phase can ship as 0.0.2 with the macOS icon.
- **7b. Provider visits through the owner** (D139, D153, D154): Visits waiting
  with its two questions; visit copies on the server; the server refusing
  non-owner revision pushes; the provider's read-only sync; one waiting copy
  per provider and report; the outside-their-items marking.
- **7c. The desktop app as a server client** (D144): the Rust transport, the
  hooks, the certificate pin, the built-in server reached from the window.
- **7d. This computer** (D166): the Tauri command, the importer and its
  review, and tests.
- **7e. The idle lock** (D134, D165, D169): settings, saving first, the cover,
  the PIN, unlocking by sign-in, on the website and in the app.
- **7f. Checks on one PC, no server:** ping, TCP, HTTP(S), DNS, SMTP and DICOM
  C-ECHO; the scheduler, the states and root cause; format v19; the local
  samples and hourly figures; the item's Check section; tray and autostart.
- **7g. Issues and the alarm** (D172, D173): issue records, folding,
  Acknowledge, Report a problem and Expected, repeats, the card window, the
  chime, the drill and recovery notifications.
- **7h. Monitors through the server:** the Rust encryption and its shared test
  vectors first (D136); the `monitor` role and its migration; signed records
  and the fold's checks; turning a PC on as a monitor, and revoking it; the
  device key in the keychain; the status channel over `/api/events`;
  heartbeats and "monitor stopped reporting"; statistics pushed and pulled;
  two monitors on one item.
- **7i. The visit monitor** (D148, D174): "Monitor during this visit" in
  provider mode, and the monitoring section in the visit copy, its report
  and the log entry, with the before-and-after comparison.
- **7j. Reports** (D163, D164): availability, response times, outages, the
  provider report, CSV, and the retention setting (D162).
- **7k. The remaining checks:** NTP, RTSP, SIP, HL7 MLLP, IPP, IMAP and POP,
  each with its loopback fake.
- **7l. The welcome** (D141–D143, D170): the desktop app and website versions,
  and "Run the welcome again". It comes last, so it links to pieces that
  already exist.
- **7m** (D337-D342). The i18n review; docs (README, FEATURES, SERVER with
  the provider read limit, FORMAT.md for v19); a release note; the audit of
  this section and its open items ("Step 7: open items, for the owner").
- **7n. Translation clashes** (D342, D350): a context form for t() and
  data-i18n-ctx; the 13 keys written twice in one locale sorted by
  meaning; the i18n suite's known list removed.
- **7o. Setup does the server set-up** (D170, D332, D352-D360): the
  welcome renamed Setup; Connect to a Topo server and Make this PC the
  server walked through in it, step by step, with Settings' own functions;
  a reload in the middle resumes it.
- **7p. Settings in sections** (D361, D362, the owner, 2026-11-12): the Settings
  dialog in section tabs like the About window, every deep link opening at
  its tab and control.

Tests, per phase, are the plan's list: Rust unit tests against loopback fakes
only (no real devices, internet or email), ICMP on 127.0.0.1 where the system
allows it, one DICOM cross-check against Carino DICOM by hand, the states and
statistics on tests/fixtures/site300.js, the server's Go tests and
tests/server-e2e.mjs, the merge fixes, provider visits, the app as a client
against the e2e server, issue records, the encryption vectors, the visit
monitor, retention, the welcome, the v18 → v19 migration with the suite count
before and after, the idle lock, and the alarm card, the Check section and the
reports in the browser at 360, 390 and 1280 in both themes and every language.

## 8. The provider loop, links back, watched addresses and connections (step 8)

Written 2026-11-12 from the owner's review of the provider workflow and
their answers ("will follow your recommendations"). Phase 8.0 is this
section; no code. Each later phase adds its own decisions under
"Decisions made building step 8", numbered on from the last one here.

### What the review found

1. **A provider's part is a neighbourhood, not a path.** providerPart
   (js/providerpart.js) keeps every device up to two cables from the
   provider's items, in every direction, and every far end of their own
   cables. A provider who looks after a switch receives every PC plugged
   into it; one who looks after the router receives every device on the
   core switch. The two hops were meant to show what the provider's
   devices go through.
2. **"Report for this provider" is a dead end beside Report a problem.**
   The provider card's button prints the provider report on its own, while
   Report a problem's send step already offers to attach that same report.
3. **A link back cannot reach the desktop app.** The provider's copy back
   is a link on topo.carino.systems (publicBase, js/state.js) locked with
   the passphrase that opened it (D44). The desktop app has no way in for a
   link: no deep link and no field to paste one, so the link opens the
   website in a browser, which holds none of the app's networks; the visit
   opens there as a new network and never merges. Only the file merges
   (Open a file, three-way). On the website, in the browser that sent the
   report, it works: a link pasted into an open tab is read through
   popstate (js/app.js), the passphrase is asked, and Keep offers the merge.
4. **The client is asked for a passphrase it made.** No passphrase is kept
   anywhere (js/providermode.js "never stored"), so the client types back
   the passphrase their own Topo generated.

The owner then asked for two more things: a panel to check chosen addresses
(ping, DICOM C-ECHO and the rest) whether or not they are on the map, each
either raising the alarm or only going into the monitoring report; and
knowing when a Topo client of the server has lost its connection.

### What changes in Topo's promise

D128 said a check goes only to an address and port already in the
document. It becomes: **a check goes only to an address someone wrote
down**, on a device or in the network's watched addresses. Still not a
scanner: one address per entry, never a range, a subnet or a wildcard, and
still one fixed request per check. The website and the offline zip still
never probe (D127).

The owner's rule (2026-11-12): **checking is an auxiliary, opt-in, manual
tool, not an automatic scanner.** Nothing is checked unless someone asked
for it, and **an item that is not checked is never said to be down,
offline or unknown**: it has no state at all. A check answers for the item
it asked, from the PC that asked, and for nothing else.

### Decisions for step 8 (owner, 2026-11-12)

**The provider's part (8b)**

- **D363. The context is the path, not the neighbourhood.** For each item
  device, the context is the devices on its way to the network: the chain
  monitorChains (js/checks.js) walks from the device to its nearest routing
  device, and for a routing device the chain toward the Internet (a cloud
  node) or its upstream router, the nearest **two** devices of it. The
  cables kept are the cables of those chains. The hosts of kept devices
  and the devices a kept problem report names stay context as before (D92).
  A group naming the provider still brings all its members (the owner,
  2026-11-10): those are items, not context.
- **D364. What hangs below an item is left out, its ports are not shown
  free.** The far end of an item's own cable that is not on a chain (the
  PCs on their switch, the phones on their PoE ports) is left out, with
  its cable. Each port of an item that such a cable used goes out marked
  **in use (not in your part)**: a part-only mark, never written into the
  client's network, so the provider does not see a busy port as free. The
  part's counts and the send step say "12 devices on their ports left
  out". The merge back is three-way against the part as it left (D152), so
  what was left out is never read as deleted.

**Report for this provider (8c)**

- **D365. The card's button opens Report a problem.** **Report for this
  provider** becomes **Report a problem to them**: the Report a problem
  sheet with this provider ticked as the recipient and no device picked
  (the form asks for the device or group as usual; the routing may tick
  others, which the client can untick), and, on the send step, **Attach
  their report** ticked. The printable provider report stays on that send
  step (**Print their report**) and in Export, next to Site report, as
  **Provider report…** (pick the provider), for a report with no problem
  attached. The card keeps Monitoring report and Share their part.

**Links back (8a)**

- **D366. Open a link… in the desktop app and on the website.** Export and
  My networks get **Open a link…**: paste a Topo link (any origin: the
  link's fragment is what counts, so a topo.carino.systems link opens in
  the app, and a bare fragment is accepted), then the same route a link
  takes at boot (sealed, binder, plain, the merge questions). In the
  desktop app it is the only way a link comes in; a deep link that opens
  the app on a click is not built (a Tauri plugin and installer changes on
  three systems), a later update.
- **D367. The client keeps the passphrase of what it sent (amends D44).**
  A sealed link sent from Report a problem or Share their part keeps its
  passphrase with the part revision it left as (js/revisions.js), in the
  same storage as the network itself (this browser's, or the app's), which
  already holds the network unencrypted, so nothing is weakened: the
  passphrase protects the link while it travels, as before. It goes when
  the part revision goes (its copy merged or its report closed, D152). A
  whole-network report link keeps it the same way under its share
  revision. The provider side does not change: memory only, as D44 says.
- **D368. The reply tag.** A sealed link gets a new version (2): an
  8-byte random **reply tag** in its header, outside the ciphertext and in
  the AES-GCM additional data, so it cannot be swapped. The client's link
  carries a new tag; the provider's Topo copies the tag of the link it
  opened into the copy back. The client looks the tag up, takes the
  passphrase, the report and the provider from it, and unlocks once. Not
  "try every passphrase": each try costs 600,000 PBKDF2 rounds
  (SEAL_ITERATIONS), about half a second, so twenty open reports would be
  ten seconds per link. The tag says nothing about the network; it only
  ties two links together, which anyone seeing both on one channel could
  do anyway. Version 1 links still open; a version 2 link in a Topo from
  before step 8 says it was made by a newer Topo (not "damaged").
- **D369. Three answers, never "wrong network".** A link that is:
  - **malformed** (bad characters, cut short, an unknown version): "This
    is not a Topo link, or it was cut short." The only one called invalid:
    AES-GCM cannot tell a wrong passphrase from tampering, so "invalid" can
    only ever mean malformed;
  - **tagged with a reply this app or browser knows:** no passphrase asked;
    it opens straight at "Visit from {provider} on {problem}: Merge into
    '{network}'" (the merge question of mergedoors, three-way against the
    part revision);
  - **untagged, or with a tag not known here:** the passphrase is asked,
    then the usual questions. This covers a provider whose page reloaded
    (D44 then locks the copy back with a new passphrase), a report sent from
    the app and opened in a browser or the other way round, and any link
    that is not a reply at all. It is never refused.

  A known tag whose report is closed or whose network is gone says so and
  still opens ("This visit answers a problem closed on {date}").
- **D370. The provider's message says how to open it.** The copy back's
  message (composeVisitMessage) adds: "Open it in Topo: in the app, Export,
  Open a link…, and paste it; or click it in the browser you sent the
  report from." With the same passphrase: "You already have the passphrase"
  (the client's Topo will not ask). With a new one: "A new passphrase:
  {how it is sent}".

**Watched addresses (8d, 8e)**

- **D371. Watched addresses, in the document (format v20).** A network
  can list up to 64 **watched addresses**, beside its devices: a name, one
  address (IPv4, IPv6 or a host name; never a range, a subnet or a
  wildcard), notes, an optional provider (routing, availability targets and
  the provider report work as for a device), an optional **reached
  through** device on the map (for root cause: down because that device is
  down), and up to 8 answer checks with the same settings as a device's
  (D156). They live in the document, so the merge, the server, the site
  monitors' groups (a watched address names its group, or none for the
  whole site) and the reports all see them. Format v20 adds `watch`; a v19
  document migrates with an empty list. Not a sheet; the CSV export gains a
  watched-addresses sheet once the network has one.
- **D372. The panel.** A **Watched** tab in the full editor's rail (and a
  section in Simple's Problems view, read-only): one row per address, its
  state dot by monitor, the last 24 h, **Add an address**, and on each row
  Edit, Checks, **Add to the map** (it becomes a device with the same
  checks, and leaves the list), Quiet and Delete. Editing works everywhere
  the network is editable; checking happens only in the desktop app (D127).
  The website and the zip show the state through a Topo server.
- **D373. Alarm or record only, per item.** Each checked device and each
  watched address says what an outage does: **Raise an issue** (as now: an
  issue, the banner, the alarm on PCs with Show alarms on) or **Record
  only**: no issue, no banner, no alarm; the outage still goes into the
  statistics and the monitoring report's outage table, marked "recorded
  only". The default stays Raise an issue for devices; a new watched
  address starts at Record only. A recorded-only device that is upstream of
  a raised one is still the root cause named.
- **D374. Outages of a watched address.** An outage incident names
  `watchIds` instead of (or beside) `nodeIds`; the Problems tab, the Simple
  list, Report a problem (prefilled with the address and routed to its
  provider) and the outage report read both. On the map there is no item to
  mark: the issue shows in the rail's Watched tab and the banner.
- **D375. The checks offered.** The 13 of D155, plus **TLS certificate**
  on any port (the days until expiry, warned at 14; for LDAPS, RDP, a
  PACS's DICOM TLS and the rest; one handshake, nothing sent after it).
  Addresses outside the network (a public resolver, the ISP's gateway, a
  cloud service) are allowed: the owner wrote them down, and the request
  goes from the desktop app, never from a page. A **Check the Internet**
  preset adds three watched addresses in one step: a ping to the ISP's
  gateway (asked), a DNS question to a public resolver (asked) and an HTTPS
  check to an address the owner gives. Still excluded (D128): SNMP,
  anything that reads configuration, and port ranges.
- **D380. Not checked is not down.** An item with no answer check has no
  state: no dot on the map, no row in the availability tables, no
  "unknown", and it is never counted in a figure ("12 of 40 devices
  answering" is never written; "12 checked, 12 answering" is). The
  monitoring report names its scope ("Checked: 12 devices and 3 watched
  addresses"), and a device behind one that is down is said to be down
  only when it is checked itself; an unchecked one behind it is named as
  "behind it, not checked". The Watched tab and the Answer checks section
  say once: "Topo checks only what you ask it to. Anything not checked has
  no state." A test holds that a network with no checks shows no state
  anywhere, and that the report's figures count checked items only.
- **D381. Check now: one question, once.** Every device's Answer checks
  and every watched address get **Check now** (desktop app only): it runs
  the item's checks once from this PC, or a ping when it has none, and
  shows the answer beside it ("Answered in 3 ms, from this PC, 10:42").
  Nothing is kept: no sample, no state, no issue, no statistics, and the
  item stays unchecked afterwards. It needs no monitor and no watch, so the
  check is a manual tool first; watching (D371-D373) is the opt-in for
  doing it on a schedule.

**Connections (8f)**

- **D376. Which clients are watched.** On a Topo server, a desktop app
  can be marked **Watch this PC's connection** (Settings, Topo server; or
  by an owner in Members, on that PC's device). A browser tab never is:
  closing a tab is not an outage. A site monitor (D151) is always watched.
  A watched PC's app sends a heartbeat every 60 s from Rust, with the
  window closed too (the tray, as monitoring does).
- **D377. "Lost connection".** The server sees each watched PC's last
  heartbeat without decrypting anything (as D151). Three missed: every
  signed-in page shows "{PC} lost its connection to the server at 10:42"
  in the banner, PCs with Show alarms on get the notification (not the full
  card: a PC going home is not a device down), and the gap is recorded.
  When it is back: "{PC} connected again at 11:05 (23 min)". A PC whose
  user signed out or that was turned off from Topo (the app sends "going
  away" on quit and on sign-out) is not lost.
- **D378. The other side: the server not answering.** A connected app that
  cannot reach the server for 3 minutes shows "The Topo server is not
  answering since 10:42" in its own window and, with Show alarms on, the
  notification. A monitor goes on checking and keeps its records to send
  later (D157's unknown time is the server's, not the devices'). When it
  is back, the app sends its own gap, so a server that was down is
  recorded by the clients that saw it.
- **D379. Connections in the monitoring report.** The report gets a
  **Connections** section (ticked by default on a server): per watched PC,
  the time connected over the time watched, and each gap with its start,
  length and who saw it (the server: lost; the PC: the server not
  answering). These are server metadata (when a PC reported), not site
  data: the server keeps them in the clear, for as long as the site's Keep
  statistics, and docs/SERVER.md's "What the server can see" says so.

**Trace to a target (8h, the owner, 2026-11-12)**

- **D382. A second right-click asks "does it reach this?".** Today a
  right-click on a device arms link mode (the next left click files a
  cable), and a right-click on another device arms it again from there.
  The second right-click changes: right-click A, then right-click B asks
  **Does A reach B?** A left click on B still files the cable, as now. On a
  touch screen, a long-press on A then a long-press on B. Without a mouse:
  the selection's **Trace to…** (the command list and the device panel's
  Trace section), then a click or a tap on the target. Esc, or a click on
  empty map, clears it. Starting again from another device is Esc then a
  right-click, or the link banner's **Start from here**.
- **D383. It edits nothing, so it works everywhere a map is.** No undo
  step, nothing stored, nothing in the URL. It works on a read-only
  document and a shared link (where a long-press arms the trace target
  instead of link mode, which a read-only document refuses), and in the
  full editor. The simple views get it later, if at all (their long-press
  is not link mode).
- **D384. The answer comes from the trace's own walk.** The same
  calculateReachability as Trace (js/diagnostics.js), the VLAN tick
  honoured, so Trace and the target never disagree. It reaches: the map
  lights one path, the shortest through the links the walk reached, and
  the line says "PC-1 reaches NAS through SW1 · R1 · VLAN 10 → 20 at R1".
  It does not: "PC-1 does not reach NAS", where the walk stops (the
  reached device nearest the target, by cables), and the first reason the
  register gives: no cable, a cable that does not carry the VLAN (in the
  VLAN path finding's words), no gateway or a router with no subnet toward
  it, the target's Allowed ports, a retired device on the way, or inbound
  through NAT. Only what is recorded: with no recorded reason it says
  "Nothing recorded explains it", never a guess.
- **D385. A port, and the way back.** **On port** (empty: any) asks about
  one service, through the Trace port filter and the target's Allowed
  ports (DICOM on 104, HTTPS on 443). The answer is one way, A to B;
  **And back?** asks B to A too, which differs behind NAT or one-way
  rules, and both lines show.
- **D386. From the map, not a live test.** The line says "From the map,
  not a live test." Topo cannot ask anything from another device, so a
  live answer is offered only when A is this PC (the desktop app, A
  matched by This computer's MACs, D166): **Check now** on B (D381), its
  answer beside the map's ("From the map: reaches. From this PC: answered
  in 3 ms"). They can disagree, and both are shown as they are.
- **D387. Tests.** A suite (tracetarget) over the samples: reach and not,
  each reason, the port, the way back, a VLAN-crossing path, read-only,
  the second right-click versus the left click's cable, and that
  re-arming from another device now needs Esc; the mobile long-press pair
  through Playwright.

### Decisions made building step 8, for the owner

**8a. Links back (2026-11-12)**

- **D388. Where the passphrase is kept, and for how long (amends D367).**
  Not with the part revision: in one small list of its own in this
  browser's (or the app's) local storage, `topo_reply_tags`, a record per
  reply tag: the passphrase, the card, the network's id, the report and the
  names of the providers it went to. One list covers a part, the whole
  network and Share their part alike, and a report sent from a network not
  kept yet. It is kept while the network's card is kept (a card that is gone
  takes its records with it, the next time a link is sent) and the newest
  200; not dropped when the report closes, because a provider's second visit
  can come back after that. With storage blocked nothing is kept and the
  reply asks, as before.
- **D389. Which links carry a tag.** A problem report's link (part or
  whole) and Share their part when locked: a new tag per link made. The
  share dialog's own links and binder links carry none and stay version 1,
  so Topo 0.0.1 reads them as before. A version 2 link in 0.0.1 reads as
  "damaged", not "made by a newer Topo" as D368 hoped: it was released
  before the word existed. (Step 8 ships in 0.0.3, D424.) From this build on, a version
  above 2 says "This link was made by a newer Topo. Update Topo to open it."
- **D390. The provider's side.** The tag is held in memory beside the
  passphrase that opened the link (D44), and goes back only with that
  passphrase. After a reload both are gone: the copy back is a version 1
  link with a new passphrase, which the client's Topo asks for. A copy back
  under a known tag that the kept passphrase does not open asks with "This
  reply was locked with a new passphrase. Ask whoever sent it for it."
- **D391. What "opens straight at the merge" is.** A reply that opens
  unasked goes on exactly as a typed passphrase did: the visited banner
  with **Review the visit**, Visits waiting, the three-way merge (D153). It
  adds one line, "A reply from {provider}: opened with the passphrase you
  sent it with." D369's note for a reply to a closed report is not built:
  the review already shows the report's state.
- **D392. Open a link… goes through the address.** The pasted link's
  fragment is put in this page's address, as a paste into the address bar
  would, so one reader (load, popstate) handles every kind of link and a
  new history entry is made: Back returns to what was open. Offered in
  the Export menu in every view and on the landing beside Open a file.
  Text with no fragment, an entry word ("#simple") or a locked link too
  short to be one: "This is not a Topo link, or it was cut short.", nothing
  opened. A locked link that is malformed says it is damaged without
  asking for a passphrase first (it asked, then said so).
- **D393. The message.** One line is added to the provider's message,
  after the passphrase line: "In the Topo app: Export, Open a link…, and
  paste the link." The two passphrase lines are as they were.
- **D394. Not done in 8a.** The link back was not opened in the running
  desktop app (no GUI session here, as step 7's open items say): the app
  runs the same page, and Open a link… was tested in the browser only.

**8b. The part is the path (2026-11-12)**

- **D395. "The nearest two" are the nearest two that are not theirs.**
  Each item device's way is walked as monitorChains walks it (breadth
  first, cables only, a VPN tunnel never, through any device in service),
  and the two devices on it nearest the item that are not items are kept,
  as Hop 1 and Hop 2 (the provider report's marks keep their names). So
  their server behind their own core switch still shows the access switch
  and the router past it. A way stops at the first routing device; a cloud
  item's way is its router. A router's way goes to the nearest cloud, and
  only with none drawn to the nearest other routing device. With no
  routing device to reach, an item has no way and no context of its own.
- **D396. The far end of a cable they answer for stays.** A cable named
  on them (the fibre into the building, the NAS run) is an item, so its far
  end comes as context at Hop 1, on a way or not. Only a cable of the
  client's at an item, to something off every way, is left out.
- **D397. The in-use mark is `portAttrs.pN.partUsed`.** It rides on the
  item's own port record (the loader keeps it; it adds no dot and no
  "noted" count), so the provider's Topo counts the port used everywhere
  portUsedTest is read (the faceplate, Add devices, the capacity notes, Move
  to switch) and the faceplate chip says "Port 5: in use (not in your
  part)". Only an item's faceplate ports are marked; a context device shows
  only its facing ports anyway. The merge strips the mark from every side
  before planning (mergeInput, js/merge.js), so a two-way merge cannot
  bring it in either. A copy opened as a network of its own (not merged)
  keeps it: it is the provider's view. The table's Ports tab still lists
  a marked port with no peer.
- **D398. The count.** "12 devices on their ports left out" is every
  device at the far end of an item's left-out cable, wireless clients of
  their AP included (no port, no mark). It follows the other counts on the
  send step and in brackets after Share their part's sentence. The
  provider report's linked-devices list is now the way only.
- **D399. A suite's fixture changed (loop, section 7).** The distribution
  switch and the camera were "around" the provider's switch; they are now
  on its way to the router (the direct cable to the router removed), so the
  section still tests linked devices edited, removed and filled in.

**8c. Report a problem to them (2026-11-12)**

- **D400. The sheet.** The card's button opens the Report a problem sheet
  with that provider ticked and listed first, nothing picked even when a
  device is selected. The routing's own ticks are added after it while no
  tick has been touched, as D365 allows. A provider the routing does not
  list for the problem is listed all the same, "Chosen from their card".
  Read-only refuses it, as Report a problem.
- **D401. Attached unless they were unticked.** On the send step the
  report is attached (as if Also attach the report were ticked) when the
  link carries a part and the provider is still among the recipients; it
  can be unticked. **Print their report** sits under it and opens the
  recipients' report (one report of all their parts) in the preview. The
  sheet steps aside while the preview is open (its focus trap would hold
  the preview's controls) and comes back as it was, nothing in flight
  dropped. The link and the report file are made one after the other,
  the link first: the file borrows the page's document while it draws, and
  a link made meanwhile carried a part of that part (found in the browser
  pass, fixed, tested in providerreport).
- **D402. Export's Provider report…** follows Monitoring report: with one
  provider it opens at once, with several it asks "Whose report?", with
  none it says so. Read-only prints too. The card has no report button now.

**8d. Watched addresses (2026-11-12)**

- **D403. The record.** `doc.watch`, at most 64: `{ id ('wa'), name,
  address, group, via, providers, outage ('raise' or absent), target,
  notes, checks }`. The address is one IP or one host name whose last label
  has a letter, so "10.0.0.1-20" or "10.0.0.*" is never read as a name. Its
  checks are a device's without `ip`. `via` is the device on the map it is
  reached through (D371's "reached through"). A device's mode is `outage:
  'record'` (absent: raise); a watched address's is `outage: 'raise'`
  (absent: record), so each default writes nothing. Schema
  schema/topo-v20.json, docs/FORMAT.md updated.
- **D404. One id space, prefixed.** In the monitor's plan, its states, its
  statistics and its issue records a watched address goes by `w:<id>` (its
  checks `w:<id>/<check>`), so nothing in the Rust monitor changed but
  Record only, and a watched address can never meet a device's id. Its
  chain is the chain of the device it is reached through, then that device.
- **D405. Record only in the monitor.** The plan item carries `recordOnly`;
  the status carries it on; an issue record whose device has no raising
  check opens **closed** (`closed` = when it went down) with `recordOnly`,
  so no card, no banner and nothing to act on, and a second outage is a
  record of its own. "Answering again" is not said either (no note, no
  toast). The page folds it as an outage with `recordOnly`, status closed.
- **D406. Routing.** A report about a watched address starts from the
  device it is reached through, and its own providers come first
  whatever their service ("Internet for Public DNS").
- **D407. The tab and the sheet.** A Watched tab beside Providers (full
  editor; a read-only network shows the rows). The sheet uses the device
  panel's check cards and field parser (js/checks.js applyCheckField) on
  a stand-in holder; Save is one undo step. Quiet for… is on the row, sent
  under the `w:` id. Add to the map makes a cloud (public address) or a
  server (private), cabled to its "reached through" device, and moves its
  outages' `watchIds` to `nodeIds`; its statistics stay under the old key
  (a new key from then on). A host name cannot go on the map.
- **D408. The report and D380.** The report treats each checked watched
  address as a row-holder like a device (its group, its providers, its
  target), names what was checked ("Checked: 12 devices and 3 watched
  addresses. Anything not checked has no figures here.") and marks an
  outage "Recorded only". An unchecked device or address is in no table,
  no count and no figure.
- **D409. watched.csv.** Exported once there is one, read back by
  `watch_id` then by address; the checks are not in it (D229), a group by
  its path, the device by name or id, raise_issue true or false. A sheet
  with a `watch_id` heading is never taken for devices.
- **D410. Not done in 8d.** Check now (D381) and the TLS check (8e) are
  later phases; the running desktop app was not driven (no GUI session),
  so the alarm skipping a Record only outage is tested in Rust and the
  page with a stand-in monitor only.

**8e. TLS certificate and Check the Internet (2026-11-12)**

- **D411. Host names, looked up (fixes 8d).** The monitor took only an IP
  literal and skipped anything else as "address", so a watched address
  given as a name was never checked. The app now looks a name up with the
  system's resolver at each check (an IPv4 address first), sends it as the
  TLS server name (SNI) and the HTTP Host, and a name that does not resolve
  is a failure ("resolve": "The name does not resolve from this PC."), not
  a skip. Still never a range or a URL. The page sends a device's own
  addresses only, so a device's check never looks a name up; the step 7
  test "names are never looked up" now says the opposite for a name.
- **D412. The TLS certificate check.** Protocol `tls` (v20, the schema's
  list grew in the same version, unreleased until this commit), port 443
  when none is given: connect, one handshake, the end date, close_notify.
  Nothing else is sent. It answers whatever the certificate's trust (as
  HTTPS's does); 14 days before its end the line warns. Tested against a
  loopback TLS server: the end date read, nothing received after the
  handshake, a plain TCP port and a closed one not answering.
- **D413. Check the Internet.** Three prompts (the gateway, the resolver,
  the HTTPS address), each skippable, Cancel adds nothing; the gateway
  offered from the internet-facing router's own gateway field, the resolver
  1.1.1.1. The DNS question asks the HTTPS service's name when it is one,
  else example.com. Reached through the router linked to a cloud (else the
  first routing device), the HTTPS one and the gateway on the internet
  providers. More than room left (64): the first that fit.

**8f. Connections (2026-11-12)**

- **D414. Where it is kept.** Server tables `connections` (one row per
  watched PC, by its device: name, since, interval, last beat, lost, away)
  and `connection_gaps` (a PC's device id or a monitor's m_ id, from, to,
  seen by 'server' or 'client'), migration 0006. A beat from a session
  with no device (a browser that never set up keys) or a monitor's token
  is refused. Gaps are pruned past ten years; a site sees them only within
  its Keep statistics, none with it Off.
- **D415. Who is told.** Everyone who is a granted person member of any
  site the PC's person is in (the person included); the banner shows the
  lines on every signed-in page of the app or the website, with or without
  a site open. The site's list for the report holds its members' PCs and
  its monitors. The monitors' existing "stopped reporting" keeps its own
  line; their gaps now go in connection_gaps too. On a phone the banner
  sat under the floating search (its first line could not be tapped, a
  monitor's outage line too); it now starts below it (css, found in the
  browser pass).
- **D416. Going away.** The app says it on quit (RunEvent::Exit) and when
  the server is forgotten; the server marks it on sign-out itself. A PC
  that went away is not lost until it beats again and stops.
- **D417. The app's side.** A thread from setup beats every 60 s while
  on; a 401/403 is nobody signed in (no failure, nothing said). Three
  minutes of failures say "not answering" once (the event to the page,
  and with alarms on a notification in the page's words, {min} put in);
  the next beat that reaches the server is followed at once by one
  carrying the gap. A single failed beat is no gap. Turning it off tells
  the server to stop watching (DELETE).
- **D418. Not done in 8f.** An owner turning it on for someone else's PC
  in Members (D376's second way) is not built: the heartbeat comes from the
  PC's own app, which only its person sets; the notification for another
  PC's loss needs the page open (the server's events reach the page, not
  the tray). The running desktop app was not driven (no GUI session): the
  Rust state machine, the Go server and the page are tested apart.

**8h. Trace to a target (2026-11-12)**

- **D419. The path.** The shortest way through the cables the trace's
  walk reached, as traffic goes: only switches, access points and routers
  are hops (a host is an end), and with the VLAN tick one VLAN at a time
  (an end lets it through as endPassesVlan reads it; only a router changes
  it). The line names the hops and the VLANs: "VLAN 10 → 20 at R1", the
  router where it changed. Where the walk reached B but no such way is
  found, the VLAN-blind way is drawn. On every sample Trace and the answer
  agree (the suite asks 12 × 11 pairs each).
- **D420. Why not, in this order.** No cable at all (any way over any
  cable), a retired device on that way, the target's Allowed ports (with a
  port asked), the first VLAN the start walks on that a cable does not
  carry (vlanPath's stop, in its words), then on another subnet: the start
  has no gateway, a NAT router the walk reached on the way, a routing device
  where it stops; else "Nothing recorded explains it." Plus "It stops at
  {name}.", the reached device nearest the target by cables. Inbound
  through NAT is said only where the walk reached the NAT router and not
  past it; the map has no port forwards, so nothing is guessed.
- **D421. The gestures and the bar.** The second right-click (or the
  long-press's contextmenu) of a pair asks; a third device after an answer
  arms link mode from it, and the right-click after that asks from there.
  A right-click then a left click still files a cable. Trace to… is a
  button in the Trace box and the key G; it waits for a click or a tap.
  Esc and a click on empty map clear it, and the port with it. Read-only:
  the first right-click arms the target. The answer is a bar at the top
  of the map under the search (the bottom held the docbar, the zoom and a
  phone's bars), with On port, And back? and Check now. The link banner's
  Start from here is not built: Esc then a right-click starts anew.
- **D422. Check now (D381).** One Rust command, `check_now`, runs a
  check once (checks.rs run) on a blocking thread and keeps nothing. The
  page builds the spec as the plan does: a device's checks or, with none,
  a ping (its first address, its documented TCP port as the fallback); a
  watched address's checks; the trace target's B (a ping, or TCP on the
  port asked). Offered in a device's Answer checks and the watched sheet
  (the desktop app only), and on the bar only when A is this PC (its MAC on
  the map, D166). The answer says when ("answered in 3 ms, 10:42").
- **D423. Not done in 8h.** A real finger's long-press could not be driven
  (headless Chromium sends no contextmenu for one, and lifting a CDP finger
  adds a tap a phone does not): the pass dispatches the long-press's
  contextmenu at the finger's point, as the touch suite does. Check now was
  not run against a real device (no app session): the Rust check is the
  monitor's, tested there.

**8g. The release (2026-11-12)**

- **D424. Step 8 ships in 0.0.3.** The v0.0.3 draft (step 7) was never
  published, so it and its tag were deleted, as were the v0.0.4 tag and
  draft built for a moment, and 0.0.3 is rebuilt from step 8's commit with
  one "New in 0.0.3" note: step 7's items, then step 8's, files at version
  20 (0.0.1 opens them read-only). The Builds workflow's dispatch gained
  `tag` (build that version into its draft without pushing the tag; the
  owner's publishing makes it) and `platforms` (all, x64 or arm64). 0.0.3's
  x64 apps (macOS, Linux, Windows) and the zip are built there; the Arm
  apps are built on an Arm Mac and uploaded to the same draft (`gh release
  upload v0.0.3 <files>`).

**After step 8: one start per place Topo runs (2026-11-12)**

The owner's review of how Topo starts on the website, the offline zip, a
page a Topo server served and the desktop app: "web version should not run
the setup, should not lock by default (unless loading a file that has lock
or the user enables it)". Three decisions, each reversing an earlier one
where it says so.

- **D425. Setup is the desktop app's alone.** Reverses D141's "a lighter
  version on the first visit" and D326's "once per PC or browser". On the
  website, the zip and a server's page Setup asked nothing those places
  could act on: "where networks are kept" had one fixed answer, the look is
  the navbar's switch, and the last step repeated the landing's buttons
  behind it; on a server's page it stood in front of the sign-in and
  offered only networks kept in the browser. So a browser never shows it
  (`atBoot` answers `web` and writes no mark), Settings has no Setup tab
  there (Run the setup again is the app's; the tab hides with its
  sections, D361), and the website's "On this browser" choice and its three
  strings are removed. The app is unchanged: the same steps, the same
  mark, D327's "an install in use is not welcomed". A page a Topo server
  served starts on the server: **On this server** and its **Sign in** come
  before the ways to start a network in this browser (the landing's
  `served` class, set by js/serverui.js), and the hero's "It runs in this
  tab — no server, no upload, no account" is not shown there, since it is
  not true of that page. An app window connected to a server gets the same
  order.
- **D426. The screen lock as shipped depends on where Topo runs.** Reverses
  D134's and D165's "30 min by default, on the desktop app and the website
  alike". As shipped it is 30 minutes in the desktop app, on a page signed
  in to a Topo server (the sign-in is a real way to unlock) and wherever a
  PIN is set on this PC; Off on the website, the zip and a server's page
  with nobody signed in. There D169's plain Unlock protected nothing, and
  locking reloads the page (D214), which threw away the undo history every
  30 idle minutes. "As shipped" is the absence of `topo-lock-after`; a time
  chosen in Settings (Off and 30 included) is now always stored and wins
  everywhere, so 30 chosen on the website stays 30. While it is Off as
  shipped the page looks again each minute, so a sign-in or a PIN set in
  another tab turns it on. For an install from before: a browser that
  never chose a time goes from 30 to Off (unless it has a PIN); one that
  had chosen 30 also reads as "never chose", since 30 was stored as no key.
  The owner's "unless loading a file that has lock" is read as a network
  opened from a Topo server by its signed-in member; no document carries a
  lock, and adding one would be a new document version, not done here.
  *Open for the owner:* whether the desktop app should keep 30 minutes as
  shipped (kept).
- **D427. The checks show wherever the network is edited.** The device
  panel's Answer checks was hidden with no desktop app behind the page (on
  a server's site: shown read only, and only for a device that had one,
  step 7h), while the Watched tab showed and edited the same check cards
  there; a file made in the app carried checks a website user could not
  see or remove. Now the full editor shows the section on any page: the
  rule (D380), the line "Only a Topo desktop app that monitors this
  network runs these checks. This page never checks." (es, pt-BR, ja, ru),
  the cards, ＋ Add a check, the availability target and the report link;
  nothing that needs the app (no Check now, no link to Settings). On a
  server's site each card also carries the site monitors' lines in place
  of this PC's own state, and an owner's quiet window as before. A network
  that cannot be edited shows the cards disabled, and no section for a
  device with no check. The Watched tab and its sheet say the same line
  where there is no app. Still not a scanner, and the promise is
  unchanged: a page never checks.

- **D428. These ship in 0.0.4.** 0.0.3 was published (2026-11-12, tag
  v0.0.3 at 90e09f3) before them, so its files are left as they are and
  the note gains "New in 0.0.4" above "New in 0.0.3", whose lines stay as
  published (Setup on every first start, the lock at 30 minutes). The
  website is the main branch, so it has them at once. Built as D424
  builds: a dispatch with `tag` v0.0.4 and `platforms` x64 into a draft
  the owner publishes; the Arm apps from the owner's Mac.

Not changed by these, and still open from the same review: Report problems
chosen in Setup does not last past the next plain start (D329); Setup's
note names a mode button the full editor shows only in the keyboard help;
Setup's last step and the landing name the same starts differently;
Settings cannot be opened from the landing; the screen lock's text names a
server sign-in on a page that has none; the landing's "this browser"
wording in the desktop app; the back-up folder exists only where the
browser has the folder picker.

### Phases

Stop after each phase and report the counts and failures as they are.

- **8.0** This section; no code.
- **8a. Links back** (D366-D370): Open a link…; the passphrase kept with
  the part revision; the sealed link's version 2 and its reply tag (tests
  with vectors for both versions); the three answers; the provider's
  message. First, because a client on the desktop app cannot get a visit
  back at all today.
- **8b. The part is the path** (D363, D364): providerPart's context from
  the chains; the in-use marks; the counts; the part suites updated and a
  switch-with-forty-PCs fixture.
- **8c. Report a problem to them** (D365).
- **8d. Watched addresses** (D371-D374): format v20 and schema, the
  migration with the suite count before and after, the Watched tab, the
  checks fed to the scheduler, alarm or record only, outages with
  `watchIds`, the reports and the CSV sheet.
- **8e. TLS certificate and Check the Internet** (D375), with a loopback
  fake.
- **8f. Connections** (D376-D379): the server's heartbeat route and
  migration, the app's heartbeat and going-away, the banner and
  notification, the server-not-answering side, the report section, and
  docs/SERVER.md.
- **8h. Trace to a target** (D382-D387): the second right-click, the
  long-press pair, Trace to…, the answer and its reason, the port, the way
  back, Check now from this PC.
- **8g.** i18n (es, pt-BR, ja, ru), README, FEATURES, SERVER and FORMAT
  (v20), the release note, and the browser pass at 360, 390 and 1280 in both
  themes.

## Order

1. Fix A and B, add restore points (no format change).
2. Merge into…, plus the three-way merge for edited copies (format v17).
3. Mobile batches B4 and B5.
4. The client-provider loop without a server.
5. The portable server.
6. Importers and the published format spec.
7. Answer checks, monitors, statistics, the idle lock and This computer
   (section 7: merge fixes first, the welcome last).
8. The provider loop, links back, watched addresses and connections
   (section 8: links back first).

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
- [x] 5. Server. 5a done 2026-11-10 (not yet committed): `topo-server`
  (server/, Go, SQLite), email sign-in, sites with roles and invitations,
  end-to-end encryption in the browser (js/servercrypto.js), sync through the
  merge (js/serversync.js), email notifications, the client (js/server.js,
  js/serverui.js), docs/SERVER.md, tests/server-e2e.mjs. Decisions D51–D85
  above; the infrastructure link and the server's report email D86–D90
  (2026-11-10); the provider's part, its report and the attachment D91–D98
  (2026-11-10). 5b stage 1 done 2026-11-10 (not yet committed): the backup
  engine in the server (server/internal/backup: a folder and WebDAV, the
  encrypted file, when it writes, keeping, the weekly check, failure mail,
  locked drive passwords, the owner's routes, `backup-now`), D99–D105. 5b
  stage 2 done 2026-11-10 (not yet committed): the server owner's Backups
  sheet and the network owner's Backups list (js/serverui.js), opening and
  restoring a backup file with or without a server (js/backupfile.js),
  readable copies (js/serversync.js, and `DELETE …/backups/readable`), the
  back-up folder without a server (js/backupdir.js), D106–D108. 5c stage 3
  done 2026-11-10 (not yet committed): S3-compatible stores, Google Drive and
  OneDrive with Connect (server/internal/backup s3.go, sigv4.go, oauth.go,
  gdrive.go, onedrive.go; the `oauth/start`, `oauth/finish` and callback
  routes; the Backups sheet's new kinds), tested against local fakes only
  (no real cloud call), D109–D111. 5c stage 4 done 2026-11-10 (not yet
  committed): the rpm and deb (server/packaging/linux, `make rpm deb
  packages packages-test`, tests/packaging.sh), the Windows service
  (`topo-server service …`, a WiX recipe) and the macOS LaunchDaemon and pkg
  recipe, both build-tested only; `TOPO_TLS_SELF` (server/internal/selfcert)
  and "This PC as the server" in the desktop app (desktop/sidecar.sh,
  desktop/src-tauri/src/server.rs, js/desktopserver.js), D112–D113.
- [x] 5b. Backups (2026-11-10, not yet committed): off until the server
  owner turns them on; a folder on the server or WebDAV; the encrypted
  topo-backup file opened with an owner's keys or recovery key with no
  server; daily and after-edit writes, keeping 7 daily, 4 weekly and 12
  monthly; the weekly check and failure mail; readable copies made by an
  owner's browser on purpose; restore through restore points and the merge;
  the back-up folder without a server on Chrome and Edge. D99–D108.
- [x] 5c. More destinations, installers, desktop server (2026-11-10, not yet
  committed): S3-compatible stores, Google Drive and OneDrive with Connect
  (Topo's own small clients, D109; tested against local fakes only); Linux
  rpm and deb, the Windows service and macOS LaunchDaemon (build-tested only,
  nothing signed); "This PC as the server" in the desktop app (wired and
  build-tested, not run in a GUI session). D109–D113. 2026-11-11 (not yet
  committed): one package per OS, the desktop app, which offers to make
  the PC the server as a service from startup (the Windows installer's
  tick box, the app's first-run question on Linux and macOS; D125).
- [x] 6. Importers and spec (2026-11-10, not yet committed): the Import…
  framework (js/importui.js, js/importers/registry.js and common.js), NetBox
  both ways (js/importers/netbox.js, js/netboxexport.js, a round trip on every
  sample), nmap, UniFi, Omada, MikroTik, Cisco, Lansweeper and phpIPAM
  (js/importers/*.js, a suite and hand-written fixtures each), docs/FORMAT.md
  and the field-level schema/topo-v18.json with schema/topo-backup-v1.json.
  D114–D124. Not checked against live NetBox, UniFi, Omada, Lansweeper or
  phpIPAM systems (D117, D123).
- [x] 7. Answer checks, monitors, statistics, the idle lock and This computer
  (section 7; its open items are listed there, "Step 7: open items, for the
  owner"). 7.0 done 2026-11-11 (not yet committed): section 7 with
  D126–D175 (D172–D175 from its review), the phase list, and the new
  promise in README.md, docs/FEATURES.md and docs/SERVER.md marked "Coming
  in step 7" (D168); no code. D169, D170 and D172 wait for the owner.
  7a done 2026-11-11 (not yet committed): sent parts held until answered
  or their report is closed, with no count limit, and the library's space
  warning (js/revisions.js heldParts, D175, D176); another provider's new
  records matched only by id, serial or MAC, otherwise a question that
  defaults to Add as new (js/merge.js, js/providerpart.js partMergeInfo,
  D177); four random base-36 characters in nextId (D178). Each fix had its
  failing test first (tests/suites/mergefixes.js, 42 checks). Full run
  before: 235 suites, 12950 checks, 4 failing (touchfields, font layout,
  already failing); after: 236 suites, 12992 checks, the same 4 failing.
  Its review (D179): strong keys pair before a weak hit on another
  provider's record is asked; parts from before 0.0.2 and copies back for no
  report held as the newest 8, the copies held "since" as the newest 16, a
  part for several providers answered by a copy from each, parts with no
  open report let go over the budget, a card's part list from outside
  bounded; mergefixes now 60 checks: before the fix 12 failed (11 of the 18
  new checks and the extended 1.8; the other 7 guard wiring that already
  worked). Full run after the review: 236 suites, 13010 checks, the same 4
  touchfields failures.
  7b done 2026-11-11 (not yet committed): provider visits through the
  owner (D180-D190). Format v19 (the log's `decision` kind,
  schema/topo-v19.json); Visits waiting (js/visits.js) for copies by link,
  file and binder and for server visit copies, the review's foot (the
  changes, the visit, the note; js/mergeui.js), the judgement and the
  decision in one undo step, a rejected copy kept as a file; on the server
  (migration 0004, server/internal/api/visits.go) visit copies stored,
  listed, answered and deleted, revision pushes from owners only (403
  `owners-only`), the decision emails; the provider's read-only sync and
  upload (js/serversync.js), the outside-their-items marking (js/merge.js
  scope). Tests: `go test ./...` all packages ok (new TestVisitCopies,
  TestVisitBaseHeldFromPruning, TestV001ProviderRevisionsStillVerify,
  TestVisitCopiesMigrationOnAV001Database, TestVisitDecisionMail);
  tests/suites/visitswaiting.js (46 checks) and visitsserver.js (31);
  tests/server-e2e.mjs steps 7, 8 and 10 rewritten for a provider that
  never pushes (171 checks, 0 failing, run on port 7397: 7381 was taken).
  Full run: 238 suites, 13087 checks, 18 failing: 14 in keyboards (the
  new note field had no data-keys; fixed, keyboards then 103/103) and the
  same 4 touchfields failures as before.
  Review of 7b (2026-11-11): D191 and D192. A decided copy stays beside
  a new one until taken; rejected edits carried by a later copy are marked
  and left out by default; a provider's sync reads the answers before it
  pulls and takes the server's version without merging it first; a provider removed or made a viewer takes
  their copies; the landing counts server copies of cards not open; a link
  copy answered through a newer one leaves the list; the rejected file is
  downloaded once. New Go tests TestVisitDecidedCopyKeptBesideNewOne,
  TestVisitCopiesGoWithTheProvider, TestVisitsFull (go test: every
  package ok, 238 PASS, 0 FAIL); visitswaiting 49 and visitsserver 43
  checks; server-e2e 172 checks, 0 failing (B answers the D192 file
  offer); full web run 238 suites, 13102 checks, the same 4 touchfields
  failures.
  7c built 2026-11-11 (D193-D199): Settings, Connect to a Topo server, in
  the desktop app only (js/desktopclient.js); every request and the event
  stream through Rust (desktop/src-tauri/src/client.rs on ureq and rustls,
  src/clientcmd.rs the commands) with the session cookie kept by the app;
  js/server.js unchanged on the app's fetch, EventSource and origin; a
  self-signed server pinned by its fingerprint and a changed one refused;
  This PC as the server's "Open it in this window" at 127.0.0.1 replacing
  Open in browser; no CSP or server change. Tests: `cargo test` 19 passed,
  0 failed (13 new for the client); tests/suites/desktopclient.js (65
  checks) and desktopserver.js (55); tests/desktop-client-e2e.mjs, the
  page through examples/client-bridge.rs against the real topo-server
  with TOPO_TLS_SELF (31 checks, 0 failing, port 7397); server-e2e 172
  checks, 0 failing (port 7397: 7381 was taken); no Go change, Go tests
  not rerun. Full web run: 239 suites, 13170 checks, the same 4
  touchfields failures as before.
  Review of 7c (2026-11-11): D200-D203. The app window words the sign-in
  and Google Drive / OneDrive backups for what it can do and shows the
  server's redirect address; a certificate that stops being trusted is
  refused, said and not retried; the retry wait starts again at 5 s; the
  app's files are kept by one `Store` (atomic, ordered writes) shared with
  the bridge; refusals are per thread. Tests: `cargo test` 23 passed, 0
  failed (an authority-signed certificate with and without a pin, a
  redirect not followed, concurrent refusals, the session across a
  restart and the concurrent writes); desktopclient 88 checks, 0 failing; backupsettings 112 and desktopserver 55, 0 failing;
  desktop-client-e2e 38 checks, 0 failing (adds the app
  restarted from its files and this PC's server on plain http);
  full web run (port 7397, 7398 was taken) 239 suites, 13193 checks, the same 4 touchfields failures.
  7d built 2026-11-11 (D204-D208): This computer. The `this_computer`
  command (desktop/src-tauri/src/thiscomputer.rs; libc only, no new
  crate) reads this PC's interfaces, default gateways and DNS servers and
  nothing on the network; js/thiscomputer.js turns them into the PC, its
  cards with one address each and their subnets, the gateway shown only,
  through the Import… review (js/importui.js openResult), from the Nodes
  panel and Settings, in the desktop app only. Tests: `cargo test` 32
  passed, 0 failed (9 new: the system's texts parsed, and this PC read for
  real on Linux); tests/suites/thiscomputer.js 56 checks, 0 failing;
  importframework 60, i18n 114, 0 failing; the review and Settings in
  Playwright at 360, 390 and 1280 in Gold and Colourful, no sideways
  scroll and no console error. The macOS and Windows readers are not built
  or run here (D204). Full web run (port 7397): 240 suites, 13249
  checks, the same 4 touchfields failures as before.
  7d review fixes 2026-11-11 (D209-D212): connected means a link (IFF_RUNNING,
  macOS media status), Windows' temporary suffix is NlsoRandom (5), the
  DNS stub and Windows' placeholders never written, labelled addresses
  belong to their card, the log label stays English; macOS temporary
  addresses and Wi-Fi read. The suite now drives window.__TAURI__.core.invoke
  and checks one undo step per run. The Windows and macOS readers were
  type-checked on Linux in a scratch crate (cfg forced; the macOS link
  entry, which needs macOS's own libc, excluded) but never built for
  or run on those systems.
  7e built 2026-11-11 (D213-D222): the idle lock (js/idlelock.js, loaded
  in <head>). Settings, Screen lock: Lock after Off / 5 / 15 / 30 / 60 min /
  custom (1-1440), 30 as shipped, per browser or app window; Lock now; a
  PIN of 4-12 digits kept as PBKDF2-SHA-256 (600,000 rounds). Locking
  saves (the card, the tab's entry, the library's writes, a server card's
  push, the Report a problem and Record visit drafts) and reloads; the
  boot waits in TopoLock.gate() before it reads anything; every tab of the
  browser locks and unlocks together. Unlock by the PIN, or by a code sent
  to the email signed in when it locked (TopoServer.verifyCodeOnly);
  after 5 wrong PINs only the sign-in, or, with no sign-in or no answer
  from the server, the waits and Forget the PIN, said in Settings after.
  The alarm card's hooks (showOver, requestUnlock) wait for 7g. No format,
  Rust or Go change. Review fixes (D223-D226): a silent server no longer
  counts as no sign-in (24 h of silence before the PIN-less ways); the
  lock held in place when the browser will not keep it or edits are
  parked for another entry; no key or paste reaches the page while
  locked; a locked window does not open the server client; the session
  from before the lock is closed at a sign-in unlock. After the fixes:
  tests/suites/idlelock.js 153 checks, 0 failing; tests/idlelock-e2e.mjs
  42, 0 failing; full web run (port 7398) 241 suites, 13409 checks, the
  same 4 touchfields failures. Tests: tests/suites/idlelock.js 140 checks, 0
  failing; tests/idlelock-e2e.mjs (real reloads, Playwright's clock; the
  cover and Settings at 360, 390 and 1280 in Gold and Colourful, no
  sideways scroll, no console error) 42 checks, 0 failing; stage-check
  23, 0 failing. Full web run (port 7397): 241 suites, 13396 checks, the
  same 4 touchfields failures as before.
  7f built 2026-11-11 (D227-D236): checks on one PC, no server. The
  checks ping (datagram ICMP on Linux and macOS, IcmpSendEcho on Windows,
  "TCP, not ping" where ICMP is refused), TCP, HTTP(S) with the
  certificate's end date, DNS, SMTP (greeting, EHLO, optional STARTTLS,
  QUIT) and DICOM C-ECHO (desktop/src-tauri/src/checks.rs); the schedule
  on a background thread with at most 8 at once, the states and root
  cause (src/monitor.rs); the samples and hourly figures in a local SQLite,
  Keep statistics 360 days as shipped, Off keeps nothing (src/stats.rs);
  the app's commands, the tray icon and Open Topo at sign-in, one monitor
  per PC (src/monitorcmd.rs); format v19's check blocks and availability
  target (js/model.js, schema/topo-v19.json, docs/FORMAT.md); the page's
  side (js/checks.js): the plan with the upstream chains, Settings'
  Monitor from this PC (off as shipped), the device panel's Answer checks
  with its last 24 h, the map's dots. Tests: `cargo test` 71 passed, 0
  failed, 1 ignored (39 new: every check against a loopback fake, ICMP on
  127.0.0.1 answered here, the states, root cause, the scheduler, the
  hourly figures, retention, the sign-in files; the ignored one is the
  DICOM cross-check, run by hand against pynetdicom: 1 passed, D236);
  `cargo build` with no warning; tests/suites/checks.js 86 checks, 0
  failing; the Check section and Settings in Playwright at 360, 390 and
  1280 in Gold and Colourful (30 checks, 0 failing: no sideways scroll, no
  console error). Full web run (port 7397) before: 241 suites, 13409
  checks, 5 failing (the 4 touchfields and 1 desktopserver, which passes
  alone); after: 242 suites, 13495 checks, 5 failing (the same 4
  touchfields and 1 in selbar, which passes alone twice). No Go change;
  the Go tests and tests/server-e2e.mjs were not rerun. The app was built
  but not started in a desktop session here (the tray, sign-in and
  --background were not seen running); the Windows ICMP and autostart code
  is built only on Windows and was not compiled here.
  7f reviewed 2026-11-11 (D237-D242): root cause with no loop between
  routers; pruning while the monitor runs, Off ordered under the
  statistics' lock, the -wal and -shm files private; a backlog served
  oldest first; two Topos on one PC (the files read again, the second shows
  no states and no tray, --background opens the window when no tray was
  made, the tray's words follow the language); SMTP only where documented;
  the target rounded first; an unlisted interval shown as itself; the
  ping's TCP fallback tested through ping()'s own code; HTTPS and SMTP
  STARTTLS against a certificate that has ended; README and FEATURES say
  what 7f built. Tests: `cargo test` 75 passed, 0 failed, 1 ignored;
  `cargo build` with no warning; tests/suites/checks.js 97 checks, 0
  failing; i18n, formatschema, schema, thiscomputer, desktopserver,
  desktopclient and idlelock all passing; the Check section (with an
  SMTP note) and Settings in Playwright at 360, 390 and 1280 in Gold and
  Colourful, 30 checks, 0 failing. Full web run (port 7398): 242 suites,
  13506 checks, 6 failing (the same 4 touchfields, and 1 desktopserver and
  1 selbar, both passing alone on a rerun). The two-Topo file watching
  (D240) has no automated test and was not seen running in a desktop
  session.
  7g built 2026-11-11 (D243-D252): issues and the alarm on one PC with no
  server. Issue records worked out in Rust from every status change, one
  per root-cause outage with the devices behind it, repeats joined to an
  open issue, recovery leaving it open, kept in issues.json
  (src/issues.rs); Expected relabelling the outage's time as maintenance
  and showing the device quiet until it answers (src/stats.rs,
  src/monitor.rs); the card windows, their queue, the chime, the
  notifications and the commands (src/alarm.rs, src/monitorcmd.rs,
  capabilities/alarm.json); desktop/alarm.html, staged by stage.sh
  --desktop and checked by it; the page's side (js/issues.js): folding into
  outages (v19 incident fields, js/model.js, schema/topo-v19.json,
  docs/FORMAT.md), Acknowledge, Report a problem and Expected, who may act,
  the outage rows, the card's hand-over with the unlock first, Settings'
  Show alarms on this PC and Test the alarm; the merge of acts (js/merge.js);
  translated (es, pt-BR, ja, ru). Tests: `cargo test` 86 passed, 0 failed,
  1 ignored (11 new); `cargo build` with no warning;
  tests/suites/issues.js 66 checks, 0 failing; `node tests/alarm-e2e.mjs`
  105 checks, 0 failing (the card at 360, 390 and 1280, Gold and Colourful,
  five languages; the app's Problems row and Settings at the same sizes
  and themes; no console error); `node tests/stage-check.mjs` 26, 0
  failing; checks, incident, i18n, formatschema, schema, merge, mergefixes,
  mergelog, mergeui, idlelock, providermode, providersmulti, visitswaiting,
  visitsserver, library, desktopserver, desktopclient, thiscomputer, loop
  and revisions all passing (1614 checks). Full web run (port 7398): 243
  suites, 13572 checks, 4 failing (the same 4 touchfields as before 7g);
  issues, checks, idlelock and incident rerun after the last edit (430,
  0 failing). No Go change; the
  Go tests and tests/server-e2e.mjs were not rerun. The app was built but
  not started in a desktop session: the card windows on real monitors,
  always on top, the chime under the webview's autoplay policy and the
  gdbus notification were not seen; the macOS and Windows notification
  code is built only there and was not compiled here.
  7g review fixes 2026-11-11 (D253-D257): the act's "by" and note cut by
  characters (a non-ASCII name or note panicked with the issues' lock held,
  and a byte cut made the page and the app disagree on an act, a fold
  loop); Undo of a fold kept (no refold on redraw, the app keeps the record
  until it is found folded in a later undo history); a report from an
  outage one undo step; a hand-over cleared once heard, taken once, and
  never acting on a closed outage; another network watched ends the old
  outages, Expected masking only the network watched, records of devices
  gone from the document dropped; Expected over every outage of the issue;
  Show alarms off closes the cards; the raise decision a pure, tested
  function; the notification for one device behind; Russian counts; the
  Wayland caveat. D172 (three buttons on the card) still waits for the
  owner; declining it changes desktop/alarm.html only.
  Tests after the fixes: `cargo test` 91 passed, 0 failed, 1 ignored (5
  new); `cargo build` with no warning; issues 79 checks, 0 failing;
  `node tests/alarm-e2e.mjs` 106, 0 failing; `node tests/stage-check.mjs`
  26, 0 failing; issues, checks, incident, i18n, idlelock, merge,
  mergefixes, mergelog, mergeui, providermode, providersmulti,
  formatschema and schema 1127 checks, 0 failing. Full web run (port
  7398): 243 suites, 13585 checks, 4 failing (the same 4 touchfields). No
  Go change; Go tests and server-e2e not rerun. Still not seen in a desktop
  session.
  7h built 2026-11-11 (D258-D275): monitors through the server. The Rust
  encryption (src/servercrypto.rs, p256 and ring) with the vectors both
  ways; the server's `monitor` role (migration 0005 from a v0.0.1
  database), the monitor's credential and gate, its status (the heartbeat
  and the 30 s sweep), records, statistics with the site's Keep statistics,
  revoke with the key rotation, the unfolded records in the backups
  (server/internal/api/monitors.go, store/monitors.go, tcrypto/record.go);
  the app's side: the device key in the keychain or a private file
  (src/keystore.rs), the link that walks the rosters, opens the key, pushes
  status, issues and statistics and takes owners' acts and quiet windows
  (src/monitorlink.rs, monitorcmd.rs `monitor_device_key`,
  `monitor_enroll`, `monitor_link_info`, `monitor_unenroll`,
  `alarm_notify`); the page's side (js/monitors.js): turning a PC on and off
  in Settings, the records checked and folded, acts pushed and passed on,
  the status on the map and in the device section of any signed-in page,
  "split" for two monitors, the banner, the members list's monitors with
  Revoke and the site's Keep statistics, the plan by groups and Checked
  by, a backup's records folded on open; translated (es, pt-BR, ru, ja).
  Tests: `cargo test` 105 passed, 0 failed, 1 ignored (14 new);
  `cargo build` with no warning; `go test ./...` all packages ok (new:
  TestSiteMonitor, TestRevokeMonitorRotates, TestMonitorRoleMigrationOnAV001Database,
  TestVectorRecords; TestRoutesMatrixSites updated for the Monitor class);
  `node tests/crypto-cross.mjs` 12, 0 failing; `node tests/server-e2e.mjs
  --port 7397` 180 checks, 0 failing (step 15 new); tests/suites/monitors.js
  42 checks, 0 failing; the related suites (issues, checks, i18n, idlelock,
  incident, backuprestore, backupsettings, desktopclient, desktop,
  desktopserver, formatschema, schema, servercrypto, server, serverkeys,
  serversync, serverui, visit, visitsserver, visitswaiting, library, loop,
  providermode) 1710 checks, 0 failing; `node tests/alarm-e2e.mjs` 106, 0
  failing; `node tests/stage-check.mjs` 26, 0 failing; the banner, the
  read-only device section, the members list's monitors and Keep statistics
  in Playwright at 360, 390 and 1280 in Gold and Colourful, 48 checks, 0
  failing, no console error, no sideways scroll. Full web run (port
  7398): 244 suites, 13627 checks, 4 failing (the same 4 touchfields as
  before 7h). The Rust link was not run against the real server, and the
  app was not started in a desktop session (D275).
  7h review fixes 2026-11-11 (D276-D285): the relay loop, quiet windows
  through the server (website owners too), acts folded with their issue and
  the cap, the link's last record after a rotation, 503 not 401 on a lookup
  fault and a revoke only on two server 401s, Keep statistics applied on the
  first read and locked on a monitor PC, a half-made monitor taken away, Off
  while signed out said plainly, a revoked monitor's status dropped, the
  network a monitor reports, split in the banner and Problems, a backup's
  acts restored through unlockBackup, the sweep as a configuration key with
  an end-to-end check, a Go check of a Rust-sealed record, README and
  FEATURES reworded. Counts are in the review report.
  7i built 2026-11-11 (D286-D293): Monitor during this visit. The
  session in Rust (src/visitmon.rs: the schedule and states of the site
  monitor, samples in memory only, the outages per device with root cause,
  the figures and their chart; src/visitcmd.rs: the commands, the
  "topo-visit-monitor" event, Stop's figures kept in visit.json;
  monitorcmd.rs `monitor_figures`), the page's side (js/visitmonitor.js:
  the plan of the provider's devices, the tab, the map's dots, the
  section of the visit entry with the before-and-after, the Visit report),
  format v19's `monitoring` (js/model.js, schema/topo-v19.json,
  docs/FORMAT.md), Record visit and the copy back (js/providermode.js), the
  network report (js/incidents.js), sign-out said (js/server.js),
  translated (es, pt-BR, ru, ja). Counts are in the phase report.
  7i reviewed 2026-11-11 (D294-D297): Stop is final (monitor.rs drops a
  late result; the session ignores changes once stopped), a check leaving
  the plan ends its outage, the 7 days before are whole hours with their
  coverage printed, statistics Off fails closed on a server card and is
  checked again at Save, leaving provider mode ends the session (asked
  first), a session belongs to whoever started it, a new start names the
  session it drops, Off writes no visit.json; cargo tests for the file, the
  late finish and monitor_figures, the schema checked with a full section.
  7j built 2026-11-11 (D298-D311): the monitoring report (js/reports.js):
  availability per check, device, group, provider and the whole network
  with the coverage beside every figure, "not counting upstream" and "down
  because R1", against the device's or the provider's target (v19 provider
  `target` and `targetHours`, in their support hours when asked); response
  times as charts with their tables, loss, jitter and the slow hours;
  outages with who acted and the time to acknowledge, MTTR and MTBF; one
  CSV; through the sheet preview with its choices (js/sheetpreview.js);
  from the server's blobs (read past 400) or this PC's monitor; the
  provider's section in their report and its attachment; the outage block
  of the network report; the Check section's and provider card's links;
  stats.rs `tcp` (file version 2); translated (es, pt-BR, ru, ja). Counts
  are in the phase report. Reviewed 2026-11-11 (D312-D314): whose target
  on several providers, nested groups, no period lists no outage, the
  outages run on to now, Expected in older server blobs counted as
  maintenance, every act in the CSV, providers.csv's target conflicts and
  "no", 24/7 hours; the server path tested against the real binary.
  7k built 2026-11-11 (D315-D324): the remaining checks. NTP (one
  request, the stratum and the clock offset, warned above 1 s), RTSP
  OPTIONS, SIP OPTIONS over UDP or TCP, HL7 MLLP (a connect, nothing sent),
  IPP (printer-state and printer-state-reasons only), IMAP and POP (the
  greeting, optional STARTTLS/STLS or TLS from the start, LOGOUT or QUIT,
  never a login) in desktop/src-tauri/src/checks_more.rs, the offset
  through monitor.rs's status; format v19's `tls` and `transport` and the
  new protocols (js/model.js, schema/topo-v19.json, docs/FORMAT.md); the
  check section's fields, sentences, lines and first checks (js/checks.js);
  translated (es, pt-BR, ru, ja). Tests: `cargo test` 138 passed, 0
  failed, 1 ignored (10 new: a loopback fake for each check, the MLLP
  listener failing on any byte, the IMAP and POP fakes on any login);
  `cargo build` with no warning; tests/suites/checksmore.js 56 checks, 0
  failing; checks 97, 0 failing; the Check section in Playwright at 360,
  390 and 1280 in Gold and Colourful, in English, Japanese and Russian
  (42 checks each, 0 failing: no sideways scroll, 44 px targets on a
  phone, no console error). Full web run (port 7398): 247 suites, 13839
  checks, 4 failing (the same 4 touchfields). No Go change; the Go tests
  and server-e2e were not rerun. No new check was run against a real
  device (D324). Reviewed 2026-11-11 (D325): one deadline per check for
  the line-reading TCP checks (SMTP too), IPP past "100 Continue", NTP's
  zero times as bad-reply, SIP over UDP answered from any address, the
  resend tests that could not fail now count datagrams; FEATURES and
  README list 7j as built. `cargo test` 139 passed, 0 failed, 1 ignored;
  `cargo build` with no warning; checksmore 56 and checks 97, 0 failing;
  full web run 247 suites, 13839 checks, 5 failing (the same 4
  touchfields, and visitmonitor 6.4 once, which passed 67/67 alone).
  7l built 2026-11-11 (D326-D335): the welcome (js/welcome.js, its
  markup and Settings' Run the welcome again in index.html, css/app.css,
  translated in es, pt-BR, ru and ja): theme, mode, where networks are
  kept, the screen lock, This PC's two ticks in the app, and the start;
  once per PC or browser on a plain start only; D125's question folded in
  (D170, D332). Tests: tests/suites/welcome.js 97 checks, 0 failing; a
  Playwright pass of a real plain start at 360, 390 and 1280 in Gold and
  Colourful, 74 checks, 0 failing; i18n, desktopserver, desktopclient,
  library, idlelock, thiscomputer, checks, monitors, smoke, privacy,
  touchsizes 1-3, a11ynames and navload (the plain URL) all passing;
  server-e2e 183 checks and desktop-client-e2e 38 checks, 0 failing (port
  7397; server-e2e with --no-rust, no Rust changed). Full web run (port
  7397): 248 suites, 13936 checks, 4 failing (the same 4 touchfields). No
  Rust or Go change, so cargo and the Go tests were not rerun.
  Reviewed 2026-11-11 (D336): a theme chosen after Back kept, D125's
  "yes" only through Open Settings (Not now, ✕ and Esc are "no"), Make
  this PC the server offered wherever the service can run and is not set
  up, Next waiting while the PIN is kept, the 30 minutes of D331 timed
  from the queueing; the Playwright pass kept as tests/welcome-e2e.mjs
  with real link and entry loads. Tests: welcome 109 checks, 0 failing;
  welcome-e2e 84 checks, 0 failing; desktopserver, desktopclient,
  thiscomputer, idlelock, i18n, navload, smoke, checks and monitors all
  passing (954 with welcome); full web run (port 7397, 7398 was taken):
  248 suites, 13948 checks, 4 failing (the same 4 touchfields). server-e2e
  and desktop-client-e2e not rerun (they mark the welcome done; nothing on
  that path changed).
  7m done 2026-11-11 (D337-D341): the final wording in README.md,
  docs/FEATURES.md, docs/SERVER.md (the monitors' metadata and a stolen
  monitor PC in the threat model) and docs/FORMAT.md (v19's row, topo-v20
  as the next address); tests/README.md rows for every suite; the "New in
  0.0.2" entry in desktop/release-notes.md; the i18n review (583 new
  keys, all four languages, three fixes); the audit of D126-D336 with
  "Step 7: open items, for the owner" (one open gap, D166's last
  sentence; the decisions waiting for the owner; what was never seen on a
  real desktop, Windows or macOS). Final run: web suites (port 7397)
  248 suites, 13948 checks, 5 failing (the same 4 touchfields, and 1
  selbar, which passed alone: 69/69); `go test ./...` every package ok,
  245 top-level tests passing (one flaky, fixed, D341);
  `node tests/server-e2e.mjs --port 7397` 187 checks, 0 failing;
  `cargo test` 139 passed, 0 failed, 1 ignored (the DICOM cross-check);
  `cargo build` with no warning; desktop-client-e2e 38, 0 failing (after
  the harness fix; the first run crashed at step 6); stage-check 26,
  crypto-cross 12, alarm-e2e 106, idlelock-e2e 42, welcome-e2e 84,
  reports-e2e 41, visitmonitor-e2e 31, all passing.
  Reviewed 2026-11-12 (D342, and D341's note): the report's scope got its
  own key "Whole network" (step 7 had written "The whole network" twice in
  Russian, changing the share dialog's text), with a duplicate-key check in
  the i18n suite; D179 and D276 added to "Waiting for the owner to
  confirm", and open items 5 (13 keys translated twice from before step 7)
  and 6 (several sites per monitor PC, if D276 is declined). Tests: i18n
  116, reports 66, providerpart 47, all passing; reports-e2e 41, 0
  failing; `go test -count=1 ./...` every package ok; full web run (port
  7397, 7398 was held by another process): 248 suites, 13950 checks, 6
  failing: the same 4 touchfields, and desktopserver 1 and revisions 1,
  which both passed when rerun alone (55/55, 71/71). server-e2e,
  desktop-client-e2e and cargo were not rerun (no server or Rust change).
  7n done 2026-11-12 (D350): t()'s context keys and data-i18n-ctx; the 13
  keys written twice sorted by meaning (Change, and the Backups sheet's
  Back up now, Where and Status, as context keys; Past the
  {total}-port faceplate and Type one translation each); the i18n suite's
  known list removed; open item 5 closed. Tests: i18n 140,
  backupsettings 115, changes 77, rackplace 17, all passing; incident,
  providerreport, reports, assets, table, rackview, rackports, ports, ui,
  portcapacity, locatesimple, summary, sitereport, plurals, serverui,
  backupdir, routing, csv, issues and report 1641 checks, all passing; a
  Playwright pass (es, ru, ja at 360, 390 and 1280, Gold and Colourful:
  each place's word, no sideways scroll, no console error) 54 checks, 0
  failing; full web run (port 7397): 248 suites, 13995 checks, 4 failing
  (the same 4 touchfields). No Go, server or Rust change, so those were
  not rerun. 7n review (D351): a fixed context list (hex-only IPv6 such
  as "dead::beef" is no longer cut), `report::Type` keeps the report's
  種別, and the checks render the summary's Where, the inventory's Type and
  a fixed faceplate sentence. Tests: i18n 141, sitereport 49, columns 71,
  report 51, summary 82, all passing; full web run (port 7397, 7398 held
  by another process): 13996 checks, 5 failing, no suite missing: the same
  4 touchfields, and desktopserver 1, which passed 55/55 rerun alone.
  7o done 2026-11-12 (D352-D357): the welcome is Setup on screen; in the
  app a server chosen in step 3 is set up in Setup step by step (Connect:
  the address, the certificate compared and pinned, the reload, the
  sign-in; Make this PC the server: the owner and who opens it, the
  service set up through Settings' own form, the wait, this window
  connected, the reload, the code read from the server's log, the
  sign-in), each step with Back, its error and Next to retry, skippable; a
  reload in the middle resumes it; a server only this PC reaches writes
  sign-in codes to its log at info (Go). Tests: welcome 223, keyboards 103,
  i18n 141, desktopserver 55, desktopclient 88, desktop 29, thiscomputer
  63, backupsettings 115, all passing; `node tests/welcome-e2e.mjs` 310
  checks, 0 failing (the app both ways at 360, 390 and 1280 in Gold and
  Colourful, with real reloads); `go test ./...` every package ok (mail:
  the new `TestLogTransportCodesOnThisPCOnly`); full web run (port 7398):
  14110 checks, 18 failing: keyboards 14 (Setup's new fields had no
  data-keys; fixed, 103/103 rerun) and the same 4 touchfields. No Rust
  change, so cargo was not run; server-e2e and desktop-client-e2e (file
  mail, no log transport) were not rerun.
  7o review 2026-11-12 (D358-D360): the "This PC only" code is fetched by
  the app with its own key (Go route and code box, Rust
  `server_signin_code`), never logged above debug; closing Setup while a
  step runs waits for it; closing while comparing cancels it; two error
  sentences translated. Tests: welcome 232, desktopclient 88, i18n 141,
  keyboards 103, desktop 29, desktopserver 55 (54/55 once in a combined
  run, the known "Yes removes it" check; 55/55 twice alone);
  `node tests/welcome-e2e.mjs` 310 checks, 0 failing; `go test ./...`
  every package ok (new `TestLocalSigninCode`, `TestLocalSigninCodeEndToEnd`,
  `TestLogTransportCodeBox`); `cargo test` 139 passed, 1 ignored (new
  `signin_code_fetch`), `cargo build` clean; `node tests/server-e2e.mjs
  --port 7397` 187 checks, 0 failing (7381 held by another process);
  `node tests/desktop-client-e2e.mjs --port 7397` 38 checks, 0 failing;
  full web run (port 7398): 14119 checks, 4 failing, all touchfields, the
  same 4 failing on an unmodified export of HEAD (118/122). Not run in the
  real app with a real service (D199).
  7p done 2026-11-12 (not yet committed; the owner's request of the day,
  D361): Settings in six section tabs like the About window (Map and
  reports, Screen lock, Topo server, Monitoring, Back-ups, Setup), the tab
  kept per browser tab, every deep link opening at its tab and control
  (openSettings(where), revealInSettings). Tests: new settingstabs 124;
  the suites and e2e scripts that open Settings now open the tab they test
  (desktopclient, desktopserver, checks, issues, thiscomputer, idlelock,
  welcome, backupsettings; alarm-e2e, idlelock-e2e, desktop-client-e2e).
  Full web run (port 7398) before those test edits: 14243 checks, 9
  failing: idlelock 4 and desktopclient 1 (they opened Settings without a
  tab and read controls now on another tab; fixed by passing the tab) and
  the same 4 touchfields that fail on an unmodified copy of the tree
  (baseline 14112 checks, those 4 plus servercrypto's vectors file, absent
  from that copy). Rerun of the 13 affected suites (desktopclient 88,
  desktopserver 55, checks 97, issues 79, thiscomputer 63, idlelock 171,
  welcome 232, backupsettings 115, settingstabs 124, i18n 141, trailpanel
  100, touchsizes3 85, navedge 41): 1391 checks, all passing.
  Full web run again after them: 14243 checks, 4 failing, the same 4
  touchfields only.
  `node tests/idlelock-e2e.mjs` 42, `node tests/alarm-e2e.mjs` 106,
  `node tests/welcome-e2e.mjs` 310, `node tests/desktop-client-e2e.mjs
  --port 7397` 38, all passing; a Playwright pass over every tab at 360,
  390 and 1280 in Gold and Colourful: no sideways scroll, no console
  error. No Go or Rust change.
  7p review 2026-11-12 (D362): the tab opened at is brought into the
  phone's row once the dialog shows; a server certificate waiting for a
  decision opens Settings at Topo server; touchsizes3 and touchfields
  measure every tab; the check section's Settings… button, Setup's Monitor
  from this PC tab and the Colourful theme are now asserted. Tests listed
  in the review report below the full run.
  - [x] 7.0 Scope.
  - [x] 7a. Merge fixes.
  - [x] 7b. Provider visits through the owner.
  - [x] 7c. The desktop app as a server client.
  - [x] 7d. This computer.
  - [x] 7e. The idle lock.
  - [x] 7f. Checks on one PC, no server.
  - [x] 7g. Issues and the alarm.
  - [x] 7h. Monitors through the server.
  - [x] 7i. The visit monitor.
  - [x] 7j. Reports.
  - [x] 7k. The remaining checks.
  - [x] 7l. The welcome.
  - [x] 7n. Translation clashes (D350).
  - [x] 7o. Setup does the server set-up itself (D352-D357; review D358-D360).
  - [x] 7m. i18n review, docs and the release note.
  - [x] 7p. Settings in sections (D361; review D362).
- [ ] 8. The provider loop, links back, watched addresses and connections
  (section 8). 8.0 written 2026-11-12: D363-D387, the phase list.
  - [x] 8.0 Scope.
  - [x] 8a. Links back (2026-11-12, eccd1bc; D388-D394).
  - [x] 8b. The part is the path (2026-11-12, eccd1bc; D395-D399).
  - [x] 8c. Report a problem to them (2026-11-12, eccd1bc; D400-D402).
  - [x] 8d. Watched addresses (2026-11-12; D403-D410).
  - [x] 8e. TLS certificate and Check the Internet (2026-11-12; D411-D413).
  - [x] 8f. Connections (2026-11-12; D414-D418).
  - [x] 8h. Trace to a target (2026-11-12; D419-D423).
  - [x] 8g. i18n, docs and the browser pass (2026-11-12). The i18n: every
    literal t() of watch.js, connections.js, tracetarget.js, issues.js and
    changes.js is in es, pt-BR, ja and ru (tests/suites/i18n.js sweeps
    them), and the step's clock times follow the page's language. The docs:
    FEATURES, SERVER and FORMAT (v20) were written with their phases; the
    README gains step 8 and its scanner promise reads "an address someone
    wrote down". The release note and the build: D424.
    The browser pass: every phase's pass (8a, 8b-8c, 8d, 8f, 8h) rerun on
    the finished tree at 360, 390 and 1280 in Gold and Colourful.
