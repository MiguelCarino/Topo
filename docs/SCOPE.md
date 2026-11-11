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
  cap of 30. A part sent from a network not kept is held in the tab and
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
    opened in a browser.
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
