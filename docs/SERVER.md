# The Topo server

`topo-server` is one program that serves the Topo app and keeps networks in
step between the people who work on them: the client, their providers, and
anyone they invite. It is step 5a of docs/SCOPE.md; the decisions behind it
are D51 onward there.

- **You host it.** Carino does not run a shared server. The client (or a
  provider for them) runs it on a PC, a NAS, a VPS or in a container.
- **Sign-in is by email**: a six-digit code or a link, sent through your own
  SMTP account. There are no passwords.
- **End-to-end encrypted.** Networks are encrypted in each browser before they
  are sent, with keys the server never sees. The server stores ciphertext,
  wrapped keys, public keys and a little metadata (who, when, sizes, roles,
  member emails). It cannot read a network, so it cannot merge one either: a
  browser pulls the newer revision, merges it with Topo's own merge and
  pushes again.
- **Notifications by email only**, with no network content in them; and,
  for a client reporting a problem to providers who are not on the server,
  the problem report itself (below, "Problem reports by email"), with the
  provider's report attached when the client asks: that PDF is the one
  piece of network content the server reads in clear (the owner's choice,
  D97; the browser warns).
- **What it does not do (yet):** backups of its data (step 5b/5c; until then,
  see "Data and backups" below), installers and a server inside the desktop
  apps (later), Postgres or blob stores (later; the settings are reserved).

Without a server Topo works exactly as before: the same app served by any
static host never talks to a server and shows nothing of this.

## Before you start

1. **An SMTP account** for the server to send from. Sign-in cannot work
   without it. Microsoft 365, Google Workspace and most ISPs and mail hosts
   offer one; see "Email" below.
2. **An https address** for people to open, for example
   `https://topo.example.com`. Browsers allow the encryption Topo needs only
   in a secure context: https, or `http://localhost` / `http://127.0.0.1` on
   the same PC. The server refuses to start on a network address with plain
   http.
3. **The owner's email**: the person who runs the server and creates the
   first sites.

## Run it

### a) A container (podman or docker)

Build the image from the repository (the build stages the app itself):

    cd server && make container          # localhost/topo-server:latest

Run it with its data in a named volume. Settings go in an env file, one
`KEY=VALUE` per line (see "Configuration"):

    podman run -d --name topo --restart=on-failure \
      -p 127.0.0.1:7380:7380 -v topo-data:/data \
      --env-file ~/.config/topo/topo.env localhost/topo-server:latest

The port is published on 127.0.0.1 only: put https in front of it (below).
The image runs as a non-root user (65532), has no shell, keeps everything in
the `/data` volume and has a health check (`topo-server healthcheck`).

As a systemd service through podman, use the Quadlet in
`server/packaging/container/topo.container`: copy it to
`~/.config/containers/systemd/` (or `/etc/containers/systemd/` for the whole
machine), then `systemctl --user daemon-reload && systemctl --user start topo`.
A rootless service that keeps running after you log out also needs
`loginctl enable-linger $USER`.

A compose file is the same in other words:

```yaml
services:
  topo:
    image: localhost/topo-server:latest
    ports: ["127.0.0.1:7380:7380"]
    volumes: ["topo-data:/data"]
    env_file: ./topo.env
    restart: on-failure
volumes:
  topo-data: {}
```

### b) The binary with systemd (Linux)

    cd server && make build              # dist/topo-server, static, no dependencies
    sudo install -m 0755 dist/topo-server /usr/local/bin/topo-server
    sudo install -m 0644 packaging/topo-server.service /etc/systemd/system/
    sudo mkdir -p /etc/topo && sudo editor /etc/topo/topo.env
    sudo systemctl daemon-reload && sudo systemctl enable --now topo-server

The unit runs the server as a user systemd makes for it, keeps the data in
`/var/lib/topo`, reads `/etc/topo/topo.env` and is locked down (no home, a
read-only system, only the network). `packaging/topo-server.user.service` is
the same as a user service (data in `~/.local/share/topo`).

### c) Windows and macOS

`make cross` builds `topo-server` for Linux, macOS and Windows (amd64 and
arm64). For now run it in a terminal with its settings in the environment or
in a file named by `--config`; services and installers come later. Data goes to
`%LOCALAPPDATA%\Topo` and `~/Library/Application Support/Topo`.

### Commands

    topo-server [serve]          run the server (the default)
    topo-server healthcheck      exit 0 when the server on this machine answers
    topo-server version
    topo-server setup-token      mint a new first sign-in token (only while there is no owner)
    topo-server mail-test TO     send one test email through the mail settings
    flags: --config FILE  --static DIR  --listen ADDR

## Configuration

Settings come from a file (`TOPO_CONFIG` or `--config`) and then from the
environment, which wins. The file is `KEY=VALUE` lines in systemd
EnvironmentFile syntax (`#` comments, optional quotes), so one file works for
the binary, systemd and `podman --env-file`. An unknown `TOPO_*` key stops the
server (it catches typos). The secret keys also come as `*_FILE`, naming a file
that holds the value (podman and docker secrets).

| Key | Default | Meaning |
|---|---|---|
| TOPO_DATA | container `/data`; Linux `$XDG_DATA_HOME/topo` (`~/.local/share/topo`); macOS `~/Library/Application Support/Topo`; Windows `%LOCALAPPDATA%\Topo` | the data folder, made 0700: `topo.db`, `server.key`, `mail/` |
| TOPO_LISTEN | `127.0.0.1:7380` (container `:7380`) | the address to listen on |
| TOPO_PUBLIC_URL | `http://<listen>` when that is loopback; required otherwise | the address people open (scheme, host, port, no path). Links in emails, the Origin check, the cookies' Secure flag and the allowed Host come from it |
| TOPO_ALLOWED_HOSTS | | more Host header values to accept (comma separated) |
| TOPO_TLS_CERT, TOPO_TLS_KEY | | built-in https: PEM files, read again every hour and on SIGHUP |
| TOPO_TRUSTED_PROXIES | | CIDRs (e.g. `127.0.0.1/32`) whose X-Forwarded-For is believed for the per-address limits |
| TOPO_OWNER_EMAIL (\_FILE) | | the server owner (see "First sign-in") |
| TOPO_MAIL | `smtp` when TOPO_SMTP_HOST is set, else `log` | `smtp`, `file` (one .eml per message plus `outbox.jsonl`, for tests) or `log` |
| TOPO_MAIL_DIR | `$TOPO_DATA/mail` | the `file` sink's folder |
| TOPO_SMTP_HOST, TOPO_SMTP_PORT | –, 587 | the SMTP server |
| TOPO_SMTP_SECURITY | `starttls` (`tls` on port 465) | `starttls`, `tls`, or `none` (a relay on this machine only) |
| TOPO_SMTP_USER, TOPO_SMTP_PASS (\_FILE) | | SMTP AUTH (PLAIN, or LOGIN when that is all the server offers) |
| TOPO_SMTP_FROM | required for smtp | `Topo <topo@example.com>` |
| TOPO_SMTP_HELO | the public URL's host | the EHLO name |
| TOPO_MAIL_PER_MINUTE | 30 | emails sent per minute at most (the rest wait) |
| TOPO_STATIC | | serve the app from this folder instead of the built-in copy (development; never the repository: a folder with `.git` is refused) |
| TOPO_MAX_REV_BYTES | 8388608 | the largest encrypted revision |
| TOPO_REV_CAP | 500 | revision bodies kept per site (0 = all); older bodies go, their headers stay |
| TOPO_SITE_MAX_BYTES | 2147483648 | stored bytes per site; old bodies are dropped first, then pushes are refused |
| TOPO_SESSION_IDLE, TOPO_SESSION_MAX | 720h, 2160h | a session ends after 30 days unused, or 90 days in all |
| TOPO_CODE_TTL | 10m | how long a sign-in code or link works (1 h at most) |
| TOPO_NOTIFY_REVISION_MINUTES | 60 | at most one "changes on one of your sites" email per person and site in this many minutes |
| TOPO_NOTIFY_EVENT_SECONDS | 120 | how long an event email (a report sent, a visit, someone waiting) waits and merges repeats; 0 sends at once |
| TOPO_LOG_LEVEL, TOPO_LOG_FORMAT | info, text | `debug`/`info`/`warn`/`error`; `text` or `json`, to stderr |

Reserved for later steps, accepted and logged as "not yet used": TOPO_DB,
TOPO_BLOBS, TOPO_BACKUP_DEST, TOPO_BACKUP_SCHEDULE, TOPO_BACKUP_KEEP,
TOPO_BACKUP_WEBDAV_\*, TOPO_BACKUP_S3_\*.

The server stops at start with a clear message for: plain http on a
non-loopback address (no TLS and no https public URL), `smtp` without a host
or From, `TOPO_SMTP_SECURITY=none` to another machine, a public URL with a
path, only one of TLS cert and key, and a TLS cert or key it cannot read. It
warns loudly when it listens with plain http on every interface behind a
loopback public URL (a container): publish the port on 127.0.0.1 only. It also
warns at every start when it has an https address but no SMTP server: sign-in
codes then only reach the log (set `TOPO_MAIL=log` to say that is meant).

A minimal `topo.env` for the binary behind a reverse proxy on the same
machine (for a container, see "Trusted proxies and containers" below):

```sh
TOPO_PUBLIC_URL=https://topo.example.com
TOPO_TRUSTED_PROXIES=127.0.0.1/32
TOPO_OWNER_EMAIL=it@example.com
TOPO_SMTP_HOST=smtp.office365.com
TOPO_SMTP_PORT=587
TOPO_SMTP_USER=topo@example.com
TOPO_SMTP_PASS_FILE=/run/secrets/topo_smtp
TOPO_SMTP_FROM=Topo <topo@example.com>
```

## TLS (https)

**Recommended: a reverse proxy** that gets and renews certificates for you.
The server listens on 127.0.0.1 and the proxy serves https. With Caddy:

```
topo.example.com {
    reverse_proxy 127.0.0.1:7380
}
```

and `TOPO_PUBLIC_URL=https://topo.example.com`,
`TOPO_TRUSTED_PROXIES=127.0.0.1/32`. With nginx, live updates (Server-Sent
Events) need buffering off and a long read timeout:

```nginx
location / {
    proxy_pass http://127.0.0.1:7380;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

`tailscale serve --https=443 http://127.0.0.1:7380` works the same way inside
a tailnet.

**Trusted proxies and containers.** The per-address sign-in limits use the
address of whoever connects, or, when that is a trusted proxy, the address it
puts in X-Forwarded-For. `127.0.0.1/32` is right for the binary with a proxy on
the same machine. A container sees its port forwarding instead, never
127.0.0.1: rootless podman (pasta) shows the host's own address, rootful
podman and Docker the bridge gateway (often `10.88.0.1` for podman,
`172.17.0.1` for Docker). Trust that range, for example
`TOPO_TRUSTED_PROXIES=10.88.0.0/16,172.16.0.0/12` (or the host's address for
pasta), and only with the port published on 127.0.0.1, so that nothing but the
proxy reaches it. When a request carries X-Forwarded-For from a peer that is
not trusted, the server logs it once with that peer's address: add it if it is
your proxy. Left untrusted, every client behind the proxy shares one limit,
and one person failing sign-ins slows everyone.

**Or built in:** set `TOPO_TLS_CERT` and `TOPO_TLS_KEY` to PEM files (from
certbot, `tailscale cert`, or your own CA) and an https `TOPO_PUBLIC_URL`. The
files are read again every hour and on SIGHUP, so a renewal needs no restart
(a reload that fails keeps the previous pair). The first read must work: a
missing or unreadable file stops the start. The files must be readable by the
user the server runs as: the system unit runs as a user systemd makes for it,
which cannot read certbot's root-only `/etc/letsencrypt/live/…/privkey.pem`;
copy the pair somewhere it can read (a certbot deploy hook), or use
`LoadCredential=` in a drop-in. The server does not fetch certificates itself
(no ACME).

A server on a LAN address without https cannot do the encryption, so it
refuses to start; a PC on site as the server needs a certificate (a tailnet
name, or a local CA) until a later step solves this.

## Email

Test the settings with `topo-server mail-test you@example.com` (with the same
config as the server). Sign-in emails go out in the language of the page that
asked; the others in each person's chosen language (en, es, pt-BR, ja, ru).
Every email is plain text plus simple HTML, with no images and no outside
content.

- **Microsoft 365**: `smtp.office365.com`, port 587, `starttls`. The mailbox
  needs *Authenticated SMTP* turned on (Microsoft 365 admin centre, the user,
  Mail, Manage email apps), which many tenants turn off by default; with MFA,
  use an app password where your tenant allows it. TOPO_SMTP_FROM must be that
  mailbox or one it may send as.
- **Google Workspace**: `smtp.gmail.com`, port 587, `starttls`, the account
  and an app password (it needs 2-step verification). Or the SMTP relay
  `smtp-relay.gmail.com` (587) with the server's IP allowed in the admin
  console and no user or password.
- **Another provider or your ISP**: their host on 587 with `starttls`, or on
  465 with `tls`. Plain SMTP (`none`) is allowed only to a relay on the same
  machine (127.0.0.1).
- Set **SPF and DKIM** for the From domain, or the emails will land in spam.

### Problem reports by email

When a client reports a problem to providers who are not members of the
site, the browser makes the locked link as without a server and, when the
client presses **Send by email**, asks the server to email it
(docs/SCOPE.md D87, D95: nothing is mailed before that press). Members are told through the
server instead (D75), with the usual "a problem was reported to you" email,
whose link reads "Follow the infrastructure link".

`POST /api/sites/{id}/report-mail`, for a signed-in owner or provider of the
site (a viewer gets 403, anyone else 404), with the usual `X-Topo` header
and same-origin check:

```json
{ "to": ["noc@isp.example"], "subject": "Network problem at Office: No internet",
  "lines": ["Nothing loads since 9.", "", "Problem: No internet", "Where: Reception PC"],
  "link": "https://topo.example.com/#e~…", "phone": "+52 55 1234 5678",
  "passphraseNote": true, "lang": "es",
  "attachment": { "name": "topo_clinica-sol_reception_2026-11-10_fibra-norte.pdf",
                  "type": "application/pdf", "dataBase64": "JVBERi0xLjQK…" } }
```

- **Limits**: 1 to 5 addresses (bare, no display names), a subject of 200
  characters at most, 60 lines and 6000 characters at most, a phone of 40;
  the body 9 MiB (room for an attachment in base64), read with the
  2-minute deadline revision pushes get. 10 sends per person per hour and 30 per site per day (a
  send is one request); then 429 with `Retry-After` and `limit` (`user` or
  `site`). The limits live in memory: a restart refills them.
- **The link rule**: the link must start with this server's public address
  (`TOPO_PUBLIC_URL` and `/`, the same scheme, host and port, no user info),
  or the answer is 400 (`field: link`). The server will not mail anyone a
  link to anywhere else.
- **The email** is built by the server from a fixed template, in the
  language asked: the lines (plain text, escaped), the link as a hyperlink
  "Follow the infrastructure link" ("Follow the infrastructure link: URL" in
  the plain part), the phone as a `tel:` link, "the passphrase comes
  separately" when asked, and a footer: "This email was sent by the Topo
  server at {url} on behalf of {email}." From is `TOPO_SMTP_FROM`; Reply-To
  is the signed-in person, so a provider's answer goes to the client.
- **Without a relay**: `GET /api/me` says `"mailRelay": true` with
  `TOPO_MAIL=smtp` (or `file`, for tests) and false with `log`; then, or when
  the request is refused or fails, the browser opens the client's mail
  program instead (the link copied as a hyperlink, pasted under
  "Infrastructure link:") and says why. The endpoint answers 503 without a
  relay.
- It is queued in the outbox and sent by the mail worker like every other
  email (one message per address, kind `report`), never from the request.
- **The attachment** (optional, D97): the provider's report the client
  chose to attach, `{ name, type, dataBase64 }`. Only `application/pdf`
  (an HTML file from the server's own address would get around the link
  rule, and mail filters hold .html; the browser downloads an HTML report
  for the client to send), standard base64, 1 byte to 6 MiB decoded, and
  it must start with `%PDF-`. Otherwise 400 (`field: attachment`), or 413
  (`field: attachment`) when empty or too big. Both rate limits are checked
  without spending first (429 before the body is read), then the
  `Content-Length` (over 9 MiB: 413 before reading); a refused request
  spends no send. The name is cleaned (`mail.CleanAttachName`: no folder
  part, quotes, `;<>|*?:` or control characters, no leading dots, 120
  characters at most, `.pdf` forced, `report.pdf` when nothing is left).
  The 202 answer adds `"attachment": <the cleaned name>`.
- **Stored once, until sent**: the file goes in a `mail_files` row
  (migration `0002_mail_files.sql`) in the same transaction as the outbox
  rows, which name it by `file_id` (their data says `"attach": name`). The
  worker loads it for each address; once no unsent row names it (each one
  sent, given up or skipped) it is deleted. Deleting the site deletes its
  files, and the housekeeping (also at start) sweeps any left orphaned. A
  file missing at send time is logged and the email goes without it (and
  without the "attached" line).
- **The message**: without an attachment, byte for byte as before
  (`multipart/alternative`). With one, `multipart/mixed`: the
  `multipart/alternative` text and HTML, then the file (`Content-Type` and
  `Content-Disposition: attachment` with the name per RFC 2231, base64 in
  76-column lines). The text says "The report is attached: {name}" in the
  recipient's language. The file sink's line (`outbox.jsonl`) adds
  `attachment` and `attachmentBytes`, and so does the request's log line.
- **Unlocked through the server.** The attached report is not end-to-end
  encrypted: the server (and whoever runs it) can read it while it is held
  and sent. The owner chose this exception; the browser says so whenever
  the box is ticked on the server route. The link itself stays locked.

## First sign-in: the server owner

- **TOPO_OWNER_EMAIL** names the owner. That address can sign in from the start
  and becomes the owner at its first sign-in; the server also makes sure of it
  at every start (it promotes and re-enables, never demotes). The admin screen
  cannot demote or disable that address.
- **Without it**, while there is no owner the server prints a one-time setup
  token in its log at every start. `topo-server setup-token` mints a new one
  into the server's data folder; run it with the server's own `TOPO_DATA`, as
  the server's settings name it, not the shell's default. It refuses a folder
  with no Topo data (it never makes a new, empty one) and prints the folder it
  used:
  - system unit: `sudo env TOPO_DATA=/var/lib/topo topo-server setup-token`
    (the unit sets `TOPO_DATA` itself, not in `/etc/topo/topo.env`);
  - user unit: `topo-server setup-token` (its default `~/.local/share/topo`);
  - container: `podman exec topo-server /topo-server setup-token` (or
    `podman logs` for the token printed at start).
  The sign-in sheet asks for it; whoever signs in with it becomes the owner and
  the token is burnt. "The first person to sign in on an empty server becomes
  the owner" was rejected: whoever reached a newly exposed server first would
  own it.

At the owner's first sign-in the browser makes its keys and shows the
**recovery key** once (28 letters and digits in groups of four). Print it or
write it down: it is the only way back into the encrypted sites if every
browser is lost. Make a second site owner as well.

## People, sites and access

- **On the server**: the owner runs it (Account, People on this server: add
  someone as *staff*, who may put networks on the server, or *member*;
  disable). Someone invited to a site comes in as a member.
- **A site** is one network. Its roles: **owner** (invites, removes, changes
  roles, deletes), **provider** (may push changes, gets the problems routed to
  them, records visits), **viewer** (reads only).
- **Invite** by email from the site's Members. The invitation lasts 14 days;
  accepting needs a sign-in as that address. The newcomer then waits ("Waiting
  for the owner to give you access", with their safety code) until an owner's
  browser **gives access**, which encrypts the site key for them: the server
  cannot do that. The owner is told by an email, a dot on the site's card and
  account, and the row in Members. Give access shows the newcomer's 24-digit
  safety code to compare with theirs (read out on the phone); giving access
  without checking is allowed and marked "Not checked".
- **Removing someone** makes a new site key, so they cannot read anything
  pushed after; what they already opened stays with them. Someone who
  **leaves** keeps the old key until an owner presses Rotate in Members.

## Threat model

What the host (whoever runs the server, or someone who breaks into it) **can**
do, and what it **cannot**.

It **cannot**:

- **read a network**, its name (unless an owner allowed the name in emails),
  reports, visits or notes: they are AES-256-GCM encrypted in the browsers
  with a site key the server never holds;
- **forge or change content** without the browsers noticing: every revision is
  signed (ECDSA P-256) by its author and chained to the one before; a browser
  accepts a revision only from someone who was an owner or provider in the
  owner-signed member list (the roster) in force, and a roster only when an
  owner of the previous one signed it;
- **give itself or anyone access**: only an owner's browser wraps the site key
  for a member, and wraps are signed by an owner. When an owner's browser
  writes a new member list (a grant, a role change, a removal, a rotation),
  it checks every member who stays against the keys the trusted list already
  names, and refuses if the server swapped any; a member whose keys really
  changed waits and is given access again with the code comparison;
- **swap keys on a new browser unseen**: linking a browser shows a code that
  covers the new browser's key and the person's own keys, and after unwrapping
  the browser checks that the keys it got are the ones the code covered.

It **can**:

- **see who and when**: member emails, roles, sign-in times and addresses,
  which browsers, when revisions were pushed and their sizes, and when a
  member joined or was removed;
- **see the kinds of events** a browser declares so the right people get an
  email: that a report was sent, a visit recorded or a report closed on a
  site, and to which members. Not what, where or why;
- **withhold or roll back**: refuse to serve the newest revisions, or serve an
  older history. Each browser pins the last revision it saw and shows "The
  server sent an older or different history" when served less, and stops
  pushing; but a **new** browser trusts whatever history it is first given,
  and the host could show different members different histories (a fork) that
  each look whole;
- **show a forged site to a newcomer**: someone joining trusts the first owner
  key they are shown (trust on first use). Comparing safety codes in Members
  (every member's code is shown) is what catches it;
- **substitute a newcomer's keys** before they are given access: the owner's
  code comparison catches it. The code is 80 bits, too long to grind a match.
  A **re-grant after someone's keys changed** (a key reset, maybe by someone
  who took over their mailbox) is shown in red and cannot be given without
  the comparison;
- **serve different JavaScript**. The browser runs the app the server sends.
  A dishonest host could serve an app that leaks keys. `/api/health` reports
  `appHash`, the SHA-256 of the app it serves, to compare with a release; the
  desktop apps (later) carry their own copy;
- **send a client-written message under its own name**: a problem report
  (`report-mail`) is the one email whose words a member wrote. It goes out
  From the server's address with Reply-To the member, so the recipient sees
  the server vouching for it. What keeps that from being a spam relay: only
  a granted owner or provider of a site can send, to 5 addresses at a time,
  10 times an hour per person and 30 a day per site; the words are plain
  text in a fixed template (no HTML from the browser, every line escaped);
  the only link is one to this server's own address; the footer names the
  member it was sent for. An attached report (D97) is a PDF only, so the
  server does not send arbitrary HTML either, and the server reads that
  report in clear (the one end-to-end exception). A member can still write
  anything in those lines to anyone, under the server's From; the owner who invites providers
  accepts that, as with any shared mail account;
- **lock someone out of codes**: the per-email limits that stop guessing also
  let someone who floods requests for an address delay that person's codes. A
  browser that already asked has its own allowance, and the emailed link keeps
  working.

What members can do to each other:

- a **provider** can change the whole network (as in Topo without a server),
  and it is signed and in the history; a **viewer** cannot push (the server
  refuses, and the browser does not try);
- a **removed** member keeps whatever they downloaded and the old keys; they
  cannot read revisions after the rotation. A member who **left** can read new
  revisions until an owner rotates;
- a **stolen browser** holds the person's own keys (the user keys every site
  key is wrapped to), not just a session. Removing the browser under Account
  ends its sessions, but its keys still open every site key wrapped to that
  person and still sign as them, and a rotation alone wraps the new key to
  the same user key. What locks it out, in this order: **Reset my keys** on a
  browser the person still has (new user keys; every other session of theirs
  is signed out at once, and every membership waits again), then each site's
  owners **give access again** (comparing the new safety code) and **rotate**
  (Members, Settings, "Lock out anyone who left from new changes"), so new
  revisions use a key the old user key cannot open. An owner who removes the
  person instead rotates at the same time. What the stolen browser already downloaded
  stays readable to it. A sign-out alone does not delete the keys from that
  browser;
- **private windows** (and browsers without IndexedDB) keep keys in memory
  only: every visit is a new browser that has to be linked again. The account
  sheet says so;
- **losing every browser without the recovery key** means "Reset my keys":
  new keys, and each site's owners must give access again. If a site's only
  owner loses everything, nobody can read that site again.

## Data and backups (until step 5b)

The data folder holds:

- `topo.db` (and `topo.db-wal`, `topo.db-shm` while it runs): SQLite with the
  accounts, sessions, sites, member lists, wrapped keys and encrypted
  revisions, and the email queue;
- `server.key`: 32 random bytes that check sign-in codes (losing it only voids
  codes in flight);
- `mail/`: only with `TOPO_MAIL=file`.

A backup holds ciphertext, member emails and the metadata above, not readable
networks. Until the server makes its own backups (5b):

- **stop and copy**: stop the server (or the container), copy the whole data
  folder, start it again; or
- **while it runs**: `sqlite3 /var/lib/topo/topo.db ".backup '/backups/topo-$(date +%F).db'"`
  (or `VACUUM INTO`), plus a copy of `server.key`.

To restore, stop the server, put `topo.db` (named `topo.db`, with no `-wal`
or `-shm` beside it) and `server.key` back in the data folder, and start it.
Browsers whose last revision is newer than the restored one will say "The
server sent an older or different history"; **Trust the server's history**
on the card merges that browser's copy onto the restored head and pushes it,
so nothing a browser still holds is lost.

## Upgrading, logs, health

- **Upgrade** by replacing the binary or the image tag and restarting. Database
  migrations run by themselves at start and only forward; a server older than
  its data refuses to start. Back up first.
- **Logs** go to stderr (the journal, `podman logs`): one line per request
  with the route (never a token), status, time and user id. Email addresses
  are masked and codes are never logged (except at debug with `TOPO_MAIL=log`,
  for development).
- **Health**: `GET /api/health` answers
  `{"ok":true,"server":"topo","api":1,"version","appHash","app","secure","setup","maxRevBytes","signedIn"}`;
  `topo-server healthcheck` uses it.
- **Stopping** (SIGTERM): live streams end, requests finish (45 s at most),
  queued emails stay queued, the database closes cleanly.

## Privacy and legal

A privacy page and a review under Mexico's LFPDPPP are pending before the
server is offered publicly (docs/SCOPE.md §5). The host is the data
controller of the accounts and metadata it holds.

## Development

    cd server && make dev        # app staged into a temp folder, mail to files, 127.0.0.1:7381
    cd server && make test       # Go unit and integration tests (and -race with a C compiler)
    node tests/server-e2e.mjs    # the real binary + Chromium: tests/README.md
