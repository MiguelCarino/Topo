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
- **Backups (steps 5b, 5c):** off until the server owner turns them on in
  the app (Account, Backups): an encrypted copy of every network to a folder
  on the server, a WebDAV server (Nextcloud, ownCloud, Synology, QNAP),
  S3-compatible storage, Google Drive or OneDrive, daily and after edits,
  kept 24 hours + 7 days + 4 weeks + 12 months, checked weekly. See
  "Backups" below.
- **Installed how you like (5c):** a container, an rpm or deb with a systemd
  unit, a Windows service, a macOS LaunchDaemon, or the desktop app on a PC
  on site ("Install"). Only the Linux packages were built and inspected
  here; the Windows and macOS installers are build-tested recipes.
- **What it does not do (yet):** Postgres or blob stores (later; the
  settings are reserved), signed installers.

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

### c) The desktop app, or the server's own packages

For a site, the usual server is a PC with the Topo desktop app: its
installer (Windows) or its first start (Linux, macOS) offers to make that PC
the server, as a service that starts with the PC ("Install" below, D125).
The server's own rpm, deb, MSI and pkg recipes are not offered to clients;
they stay for an advanced host who builds them. `make cross` builds the bare
`topo-server` for Linux, macOS and Windows (amd64 and arm64), to run in a
terminal with its settings in the environment or in a file named by
`--config`. Data then goes to `%LOCALAPPDATA%\Topo` and
`~/Library/Application Support/Topo`.

### Commands

    topo-server [serve]          run the server (the default)
    topo-server healthcheck      exit 0 when the server on this machine answers
    topo-server version
    topo-server setup-token      mint a new first sign-in token (only while there is no owner)
    topo-server mail-test TO     send one test email through the mail settings
    topo-server backup-now       back up every changed network now (--check: then read
                                 the newest backups back); refused while a running
                                 server is backing up the same data folder
    topo-server lan-addresses    this PC's IPv4 addresses other PCs can reach, one per line
    topo-server service CMD      install, uninstall, start, stop, configure, status or log the
                                 service that starts with the computer (below, "Install")
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
| TOPO_DATA | container `/data`; Linux `$XDG_DATA_HOME/topo` (`~/.local/share/topo`); macOS `~/Library/Application Support/Topo`; Windows `%LOCALAPPDATA%\Topo`, as a Windows service `%ProgramData%\Topo` | the data folder, made 0700: `topo.db`, `server.key`, `mail/` |
| TOPO_LISTEN | `127.0.0.1:7380` (container `:7380`) | the address to listen on |
| TOPO_PUBLIC_URL | `http://<listen>` when that is loopback; required otherwise | the address people open (scheme, host, port, no path). Links in emails, the Origin check, the cookies' Secure flag and the allowed Host come from it |
| TOPO_ALLOWED_HOSTS | | more Host header values to accept (comma separated) |
| TOPO_TLS_CERT, TOPO_TLS_KEY | | built-in https: PEM files, read again every hour and on SIGHUP |
| TOPO_TLS_SELF | 0 | 1: built-in https with a certificate the server signs itself, in `$TOPO_DATA/tls` (see "TLS"); not with TOPO_TLS_CERT |
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
| TOPO_BACKUP_FOLDERS | `$TOPO_DATA/backups` (made at start) | the folders a "folder on the server" backup may be in, as an OS path list (`:` on Linux and macOS, `;` on Windows). Set by whoever installs the server, so an owner's session cannot make the server write anywhere else |
| TOPO_BACKUP_DEBOUNCE | 2m | how long a network must be quiet after an edit before it is backed up (30 s after a visit; at most 15 minutes after the first edit). 0s writes at the next tick |
| TOPO_BACKUP_TICK | 30s | how often the backup engine looks for work (1s to 1h) |
| TOPO_SERVER_KEY | `$TOPO_DATA/server.key` | where `server.key` is. Set, the file must exist: a missing file stops the start (a new key is never made there) |

The backup destination itself is not an environment setting: the server
owner sets it in the app (D99). The keys reserved for it before 5b
(TOPO_BACKUP_DEST, TOPO_BACKUP_SCHEDULE, TOPO_BACKUP_KEEP,
TOPO_BACKUP_WEBDAV_\*, TOPO_BACKUP_S3_\*) are accepted and logged as ignored.
Reserved for later steps, accepted and logged as "not yet used": TOPO_DB,
TOPO_BLOBS.

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
refuses to start. A PC on site without a name to get a certificate for can
sign its own:

**Self-signed (`TOPO_TLS_SELF=1`, D113).** At start the server makes an ECDSA
certificate in `$TOPO_DATA/tls/` (`cert.pem`, `key.pem` 0600, and
`cert.sha256` with its fingerprint), valid 825 days, covering `localhost`,
127.0.0.1, ::1, the PC's name (and `<name>.local`), every IPv4 address of
the PC that is up and not loopback or link-local, the public URL's host and
TOPO_ALLOWED_HOSTS. It is kept at the next start, and made again when an
address is no longer covered (the PC got a new address: restart the server),
30 days before it expires, or when the files do not load. The log prints its
SHA-256 fingerprint at every start. Settings for a PC on 192.168.1.20:

```sh
TOPO_LISTEN=0.0.0.0:7380
TOPO_PUBLIC_URL=https://192.168.1.20:7380
TOPO_TLS_SELF=1
```

Each other PC's browser warns once ("Your connection is not private"). Open
the certificate from the warning (the padlock or "Not secure", then the
certificate), check that its SHA-256 fingerprint is the one in the server's
log (or the desktop app's Settings), then go on (Advanced, Proceed). Checked
in Chromium (stage 4, 2026-11-10): after going on, the page is a secure
context and the encryption (WebCrypto) works. Firefox and Safari were not
checked here. To get no warning at all, trust the certificate on each PC:

- **Windows**: copy `cert.pem` over, rename it `topo.crt`, double-click,
  Install Certificate, Local Machine, "Place all certificates in the
  following store", Trusted Root Certification Authorities.
- **macOS**: open `cert.pem` in Keychain Access (System keychain), open the
  certificate, Trust, "When using this certificate: Always Trust".
- **Linux** (Chrome and Chromium use the system store on Fedora and Debian):
  `sudo cp cert.pem /etc/pki/ca-trust/source/anchors/topo.pem && sudo update-ca-trust`
  (Fedora), or `/usr/local/share/ca-certificates/topo.crt` and
  `sudo update-ca-certificates` (Debian, Ubuntu). Firefox keeps its own list:
  Settings, Privacy & Security, Certificates, View Certificates, Authorities,
  Import.

Give the PC a fixed address (a DHCP reservation in the router): the address
is in every sign-in link and invitation, and a new address means a new
certificate to accept.

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

## Data and server backups

The data folder holds:

- `topo.db` (and `topo.db-wal`, `topo.db-shm` while it runs): SQLite with the
  accounts, sessions, sites, member lists, wrapped keys and encrypted
  revisions, the email queue, and the backup settings and list;
- `server.key` (unless `TOPO_SERVER_KEY` puts it elsewhere): 32 random bytes
  that check sign-in codes and lock the backup destination's password
  (losing it voids codes in flight and means typing that password again);
- `backups/`: the default folder for folder backups;
- `mail/`: only with `TOPO_MAIL=file`.

The backups below (step 5b) save the networks. To also keep the server
itself (accounts, members, pending invitations) copy the data folder:

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

## Backups

Off until the server owner turns them on: Account, Backups in the app (the
settings live in the database, D99). One destination at a time:

- **A folder on the server**: a USB disk, a network share mounted on the
  server, or a folder that the OneDrive, Google Drive or Nextcloud desktop
  client syncs (no outside sign-in at all). The folder must be inside one of
  `TOPO_BACKUP_FOLDERS` and must already exist: Topo never makes it. Saving a
  new or changed folder (after its test passes) writes a `.topo-backups` file
  in it, and every later run, test and save of that same folder requires that
  file, so an unplugged USB disk (whose mount point is an empty folder on the
  system disk) gives "The backup folder is not there (is the disk
  connected?)" instead of filling the system disk. "Save anyway" (for a disk
  not plugged in yet) writes no marker, so nothing is backed up there until
  you connect the disk and press Save again; the status says so. The systemd unit's
  `ReadWritePaths` must include the folder (the packaged unit: a drop-in,
  see "Install on Linux"); a Windows service runs as Local Service, which
  cannot reach a share or a mapped drive (see "Install on Windows").
- **WebDAV**: the folder's address, a user name and an app password.
  - Nextcloud and ownCloud: `https://cloud.example.com/remote.php/dav/files/<user>/Topo`
    (make an app password under Settings, Security).
  - Synology (WebDAV Server package): `https://nas.local:5006/<shared folder>/Topo`.
  - QNAP (WebDAV on in Control Panel, Network & File Services):
    `https://nas.local/<shared folder>/Topo`.
  - https only; plain http only to this machine (the password would cross the
    network in clear). A NAS with its own (self-signed) certificate: press
    Test, compare the fingerprint it shows with the one the NAS shows, and
    paste it in "Certificate fingerprint (SHA-256)"; then exactly that
    certificate is accepted. Redirects are never followed.
- **S3-compatible storage** (Backblaze B2, Wasabi, MinIO, AWS), **Google
  Drive** and **OneDrive** (5c, D109-D111): see the sections below. Topo
  talks to them with small clients of its own on Go's standard library
  (no rclone, D109), and never follows a redirect, except OneDrive's own
  download and upload addresses, which never get the sign-in token.

What is written (D100-D103): one folder per network, `<site id>/`, holding
`topo_<name>_<date>.json` (the name only when the network's owner shows it
in clear, else `network-<the last 8 characters of the id>`; later files of
the same day get `_HHMM`, server local time). A file is the network's latest
encrypted revision exactly as the server holds it, the member list in force
and the newest one, the members' public keys, and each owner's locked site
key and locked recovery copy. The drive company (and anyone who can read the
folder) sees the members' emails, the site id, the dates and the rough size,
not the network. An owner opens a file in Topo, with or without this server,
with their recovery key (see "Restoring" below). A file is
written about 2 minutes after the last edit (30 seconds after a visit, at
most 15 minutes into a long session), and every day at the set time (default
02:30, server time) for networks that changed; a network that did not change
is not written again. Kept: everything from the last 24 hours (up to 24),
then the newest of each of the 7 latest days, 4 latest weeks and 12 latest
months that have one. Topo deletes only files it wrote. A deleted network's
backups stay until the server owner deletes them (Account, Backups).

- **After a key reset or a new recovery key** a fresh backup is written at
  once. Older files still open only with the recovery key their owners had
  then, so keep an old recovery key until the backups made before it have
  aged out (12 months at most). The useful side: a sole owner who reset their
  keys can still open an older backup with the old recovery key.
- **Checks** (D104): every week the server reads each network's newest backup
  back and checks its fingerprint (SHA-256), its ciphertext hash and its
  signature, then writes, reads and deletes a test file. It cannot check that
  a file decrypts (it has no key): "Open the latest backup here" in the app
  does that. A failed backup or check emails the server owners, at most once
  a day each, with the reason and no network detail. After a failure that
  means the destination is down (no answer, refused, full, not there) the
  server waits 5, 15, then 60 minutes, then until the next daily time; Back
  up now ignores the wait.
- `topo-server backup-now [--check]` does the same from a shell (cron,
  debugging). A lease in the database stops it while a running server is
  backing up the same data folder. Run it as the user the service runs as,
  never as root, or the folders and files it makes belong to root and the
  service can no longer write or read them (it refuses to run as root when
  the data folder belongs to another user):
  - packaged Linux: `sudo -u topo env TOPO_DATA=/var/lib/topo topo-server backup-now`
    (or `sudo systemd-run --uid=topo --pipe -E TOPO_DATA=/var/lib/topo /usr/bin/topo-server backup-now`);
  - the desktop app's service on Linux (D125): `sudo -u topo env TOPO_DATA=/var/lib/topo topo-desktop-server backup-now --config /etc/topo/topo-desktop-server.conf`;
  - Windows (an elevated prompt): `"C:\Program Files\Topo\topo-desktop-server.exe" backup-now --config C:\ProgramData\Topo\topo.conf`
    (the desktop app's server; `topo-server.exe` wherever a hand install put it);
  - macOS: `sudo -u _topo /usr/local/bin/topo-server backup-now --config /Library/Application\ Support/Topo/topo.conf`
    (the desktop app's: `/Applications/Topo.app/Contents/MacOS/topo-desktop-server`).

### WebDAV

The address, user name and app password are in the list above. Test shows the
certificate a self-hosted NAS presents when it is not trusted, to compare and
paste.

### S3-compatible storage

Fields: **Endpoint** (https; plain http only to this machine), **Region**
(empty: `us-east-1`), **Bucket**, **Folder in the bucket** (empty: `topo/`),
**Access key ID**, **Secret access key**, **Path-style addresses**, and the
optional certificate fingerprint for a store with its own certificate.

- **Backblaze B2**: endpoint `https://s3.<region>.backblazeb2.com` (for
  example `https://s3.us-west-004.backblazeb2.com`, region `us-west-004`).
  Make an application key limited to the bucket, with read and write.
- **Wasabi**: `https://s3.<region>.wasabisys.com`, region as in the address.
- **MinIO** and other self-hosted stores: `https://minio.example.lan:9000`,
  tick **Path-style addresses**; a self-signed certificate: paste its
  fingerprint.
- **AWS**: `https://s3.<region>.amazonaws.com` and that region. A bucket
  name with a dot always uses path-style addresses (it would not match the
  certificate as a host name).
- Give the key list, read, write and delete on the bucket (or on the folder).
  Uploads carry `Content-MD5`, so buckets with object lock (B2, Wasabi)
  accept them. If the bucket keeps files locked, Topo cannot delete old
  backups; the status says so once ("The bucket keeps files locked") and the
  files stay until the lock lets them go.
- Requests are signed with AWS Signature V4 with this server's clock: a clock
  off by more than 15 minutes is refused, and the status says "This server's
  clock is wrong".

### Google Drive

Topo writes into a folder **Topo** in the Drive of the Google account that
presses Connect, with the `drive.file` scope: Google lets Topo see only the
files Topo itself made, nothing else in the Drive. Set up once:

1. In the Google Cloud console (console.cloud.google.com), make a project
   (or use one), and enable the **Google Drive API** (APIs & Services,
   Library).
2. **OAuth consent screen**: with Google Workspace, choose **Internal**.
   Otherwise choose **External**, fill in the app name and your email, add the
   scope `.../auth/drive.file`, and then **Publish app** (In production). Left
   in "Testing", Google ends the sign-in after 7 days and backups stop with
   "press Connect again" (`invalid_grant`). `drive.file` is a non-sensitive
   scope, so publishing should need no Google review; that is per Google's
   documentation, not checked here.
3. **Credentials, Create credentials, OAuth client ID**, type **Web
   application**. Under **Authorized redirect URIs** add the address the
   Backups sheet shows under "Redirect address to register in the app":
   `<TOPO_PUBLIC_URL>/api/backups/oauth/callback`, or
   `http://localhost:<port>/api/backups/oauth/callback` (see below).
4. Copy the **Client ID** and **Client secret** into Account, Backups, Google
   Drive, and press **Connect**. Sign in, allow Topo, and the page comes back
   saying "Connected as <the account>". Save turns backups on (Connect saves
   what was typed, with backups on or off as the sheet had it).

`drive.file` ties the files to that OAuth client: a new client ID starts a
new Topo folder, and backups in the old one can then only be opened by
downloading them from Drive's web page and opening them in Topo.

### OneDrive

Topo writes into its **app folder** (`Apps/<your app's name>` in the OneDrive
of the account that presses Connect), with `Files.ReadWrite.AppFolder`:
nothing else in the OneDrive. Set up once:

1. In the Microsoft Entra admin center (entra.microsoft.com), **App
   registrations, New registration**. Supported accounts: personal Microsoft
   accounts and/or your organisation, as needed.
2. **Authentication, Add a platform, Web**, redirect URI as the Backups
   sheet shows it (as for Google above).
3. **Certificates & secrets, New client secret**. Microsoft secrets expire
   (24 months at most): put a reminder in your calendar. An expired secret
   shows "The app's client ID or client secret was refused" and sends the
   failure email; make a new one, paste it, and Save.
4. **API permissions, Add, Microsoft Graph, Delegated**:
   `Files.ReadWrite.AppFolder` and `offline_access`.
5. Copy the **Application (client) ID** and the secret's **Value** into
   Account, Backups, OneDrive. **Tenant**: empty (`common`, personal and work
   accounts), `consumers` (personal only), or your organisation's tenant ID.
   Press **Connect**.

Microsoft's documentation describes the app folder for personal OneDrive
accounts; work or school accounts were not tried here. Microsoft replaces
the refresh token from time to time; the server saves each new one before
using it.

### Connect: how the sign-in works

- Connect posts what was typed to `POST /api/admin/backups/oauth/start`. The
  server keeps it locked for 10 minutes with a random state and a PKCE
  verifier, tied to this sign-in session, the provider, the app's client ID
  and the redirect address, and answers the provider's sign-in page.
- The provider sends the browser back to `GET
  /api/backups/oauth/callback?code=…&state=…`, which changes nothing: it
  redirects (303) to `/#backup-connect=…`. The app takes that off the address
  and posts `oauth/finish`. The server checks the state (once only, same
  session, in time), trades the code for tokens, locks the refresh token with
  the other drive passwords, makes or finds the folder, tests it, and saves.
- **Servers without a public name.** Google and Microsoft accept a redirect
  address only on a public domain with https, or `http://localhost`. A LAN
  address such as `https://192.168.1.20` cannot be registered. Then open the
  app **in a browser on the server machine itself** at
  `http://localhost:<port>`, sign in there as the server owner, and press
  Connect: the server uses `http://localhost:<port>/api/backups/oauth/callback`
  for a request that came from this machine. Register that address.
- Access tokens stay in the server's memory only. The refresh token, client
  secret and Drive folder id are in `backup_config` (the token and secret
  locked, D105). Changing the client ID (or the tenant) forgets the sign-in:
  Connect again.

**The backup routes** (JSON, the usual `X-Topo` header and same-origin
check on every change; the app's sheets use them):

| Route | Who | What |
|---|---|---|
| `GET /api/admin/backups` | server owner | the destination (no secret: `secretsSet` names the saved ones), `allowedFolders`, the status (`lastOk`, `lastError {at, code}`, `nextRun`, `lastCheck {at, ok, code}`, `backoffUntil`), per-network counts, deleted networks' counts, files on a previous destination |
| `PUT /api/admin/backups[?force=1]` | server owner | `{enabled, kind, fields, secrets, dailyAt, readableAllowed}`; with backups on the destination is checked first (20 s) and saved only when that works (`force=1` saves anyway); 422 `backup-dest` with `code` (and `fingerprint` for a certificate), 422 `backup-folder-not-allowed`. A secret left out is kept, `""` clears it |
| `POST /api/admin/backups/test` | server owner | the same check, nothing saved |
| `POST /api/admin/backups/oauth/start` | server owner | Connect for Google Drive or OneDrive: the Save body (with the client secret, typed or saved); answers `{url, redirect}`; 400 `oauth-kind` for another kind |
| `GET /api/backups/oauth/callback` | anyone | the provider's return: only a 303 to `/#backup-connect=<state, code or error>`; changes nothing |
| `POST /api/admin/backups/oauth/finish` | server owner | `{state, code}` or `{state, error}`: 400 `oauth-state` (unknown, used, another session's, older than 10 minutes), 422 `oauth-denied`, 422 `backup-dest` when the code exchange fails; else saves and answers the GET view plus `connect {account, code}` (`code`: the test's problem, if any) |
| `POST /api/admin/backups/run`, `…/check` | server owner | Back up now, Check now: 202, the status shows the outcome; 409 `backup-off` while off |
| `GET /api/admin/backups/deleted/{site}`, `DELETE …` | server owner | a deleted network's files: list, delete (at the destination too) |
| `GET /api/admin/backups/files/{id}` | server owner | a deleted network's file |
| `GET /api/sites/{site}/backups` | the network's owners | its files (`id, name, kind, at, revN, size, missing, previousDest`) |
| `GET /api/sites/{site}/backups/{id}` | the network's owners | the file's bytes, from the destination (`X-Topo-Backup-Sha256`); 410 for a previous destination |
| `POST /api/sites/{site}/backups/readable` | the network's owners | a readable copy made by an owner's browser: only while the server owner allows them and the network's owner turned them on (`PATCH /api/sites/{site}` `backupReadable`), and only of the head (409 `stale`) |
| `DELETE /api/sites/{site}/backups/readable` | the network's owners | deletes the network's readable copies (at the destination too); the encrypted backups stay |

The failure email reasons (`code`): `unreachable`, `refused`, `not-found`,
`full`, `too-large`, `conflict`, `bad-answer`, `certificate`, `secrets`,
`mismatch`, `damaged`, `connect` (the drive's sign-in ended: Connect again),
`client-secret` (the app's client ID or secret refused), `clock` (this
server's clock is wrong for S3), `other`. The GET view also has
`config.connected` and `config.account` (Drive, OneDrive; the refresh token
itself is never returned), `status.dropNote` (`locked`: a bucket that keeps
files locked) and `oauthRedirect`.

**In the app** (D99, D106-D107; translated, phone-sized):

- **Account, Backups…** (server owner only): Where (Off, a folder on the
  server, Google Drive, OneDrive, S3, WebDAV), the fields of that kind (the
  folder's path with the allowed folders under it; WebDAV's address, user,
  app password and certificate fingerprint; S3's fields and path-style tick;
  Drive's and OneDrive's client ID and secret, OneDrive's tenant, the
  connection with Connect / Connect again and the redirect address to
  register), a "How to set this up" link to this file, Every day at, Also allow readable copies (with
  its warning), Save (which tests first and asks "Save anyway?" when the test
  fails), Test, Back up now, Check now; then the status in words (last
  backup, last problem, next daily backup, the wait after a failure, the last
  check, files missing at the destination, files on an earlier destination),
  each network with its count and, for networks you own, **Open the latest
  backup here** (opens it for real and says how many devices it holds), and
  deleted networks with Download the latest and Delete. A saved password
  shows as an empty field saying "Saved (type to replace)".
- **Members, Backups…** (each network's owners, while backups are on): the
  network's files, newest first (date and time, Encrypted or Readable, size,
  Missing, On an earlier destination), each with **Restore…** and
  **Download** (the file as it is), and **Keep a readable copy too** when
  the server owner allows readable copies.

**Restoring** (D107). Restore… in Members, Backups, or opening a backup
file in Topo (Open a file, dropping it, on any Topo: this server, another
one, topo.carino.systems, the offline zip, the desktop app). The browser
checks the file (ciphertext hash, chain hash, the member list against the
one it already trusts when it is on the same server, the author's signature
while the author's key is still the one on the list), then unlocks it:

- on this server, signed in as one of the network's owners: with this
  browser's own keys, no question;
- anywhere else: it asks for **the recovery key of one of its owners** and
  lists them (an owner who skipped the recovery key is listed "no recovery
  key"). The key never leaves the page and nothing is stored. A wrong key
  says "This backup is from {date}. It needs the recovery key its owners had
  then." With no owner who kept a recovery key, a file opens only in a
  browser on this server that still holds an owner's keys.

Then it is offered like any copy of the network: **Merge** (the review,
a restore point "Before restoring a backup", the log says "a backup"),
**Replace with this copy** (a restore point first) or **Open as a copy**; a
network not in that browser opens as its own or merges into one. To go back
to how it was, use Replace with this copy (a merge never removes). On a
network kept on this server the restored copy is pushed as one new revision
on top of the newest, never a rewind of the history.

**Readable copies** (D106), off unless both the server owner allows them and
a network's owner turns them on. The server cannot read a network, so an
owner's browser makes the copy: after it saves to or takes from the server,
at most every 10 minutes per network, it sends the file Download a back-up
gives, and the server writes it under `<site id>/readable/` (same naming and
keeping rules). Plainly: a readable copy is **not end-to-end encrypted**.
Anyone with the drive can read it, passwords in notes included; it passes
through this server in clear (whoever runs the server could read it); with
the folder destination it is a readable file on the server's own disk. It is
only as recent as the last time an owner opened the network. Turning it off
offers to delete the copies made.

**Without a server** (D108): on Chrome and Edge, Settings, Back-ups in the
app picks a folder (for example one the OneDrive or Nextcloud desktop client
syncs) that Download a back-up and a daily copy of changed networks are
written to, kept by the same rule. That is the browser's own feature; this
server is not involved.

**The destination's password at rest** (D105; the same for S3's secret,
the Drive/OneDrive client secret and refresh token). It is stored locked
(AES-256-GCM) with a key derived from `server.key`, and never sent back to a
browser (the sheet shows "Saved"; typing replaces it; changing the address
clears it). This protects a database that leaks on its own: a copied
`topo.db`, a database backup. It does **not** protect against someone who has
the whole data folder (`server.key` sits beside `topo.db`) or root on the
server. For more, keep `server.key` elsewhere with `TOPO_SERVER_KEY` (another
disk, a credentials mount). Losing `server.key` means typing the password
again; the backups themselves stay openable, since they are locked with the
networks' own keys, not with `server.key`.

## Install

**One package per computer: the Topo desktop app** (D125). It carries the
server, and the PC it is installed on can become the server for the site:
then the server runs as a service, always, from startup, even when Topo is
closed or nobody is signed in. **Nothing is signed yet** (see "Signing").

### This PC as the server (the desktop app)

| | Where the choice is | What it sets up |
|---|---|---|
| **Windows** | the installer's first page: **Use this PC as the server for your network** (off unless the PC already is the server) | the service `TopoServer`: automatic (delayed) start, Local Service, restarted on failure; data and settings in `C:\ProgramData\Topo` (Local Service, SYSTEM and Administrators only); a firewall rule "Topo server" for the program on private and domain networks, never public ones |
| **Linux** (rpm, deb) | Topo's first start: **Use this PC as the server for your network?** | the unit `topo-desktop-server.service` (shipped disabled), enabled and started; the `topo` user; data in `/var/lib/topo`, settings in `/etc/topo/topo-desktop-server.conf` (root:topo 0640) |
| **macOS** | Topo's first start, the same question (a copy in Applications only) | the LaunchDaemon `systems.carino.topo-server` as the hidden `_topo` user; settings in `/Library/Application Support/Topo/topo.conf`, data in its `data` folder, log in `/Library/Logs/Topo/topo-server.log` |

Then, in the app, Settings, **This PC as the server**: fill in the owner's
email (and the mail settings, which other PCs need for their sign-in codes),
choose **This PC only** or **Other PCs on this network**, and press **Run it
in the background from startup**. One administrator prompt (UAC, the Linux
password prompt, the Mac's) writes the settings and starts it. From then on
the section shows whether it runs, the addresses to give people, the
certificate's fingerprint (other PCs, below) and, when this account may
read it, its log. **Save**, **Start** and **Stop** go through the service
manager, each with an administrator prompt (Stop lasts until the next
startup). **Stop using this PC as the server** removes the service and
keeps its data. A PC that said "Not now" sets it up from the same section
later.

- **Windows installer, for IT**: `Topo_<version>_x64-setup.exe /S /SERVER`
  installs silently and makes the PC the server; `/NOSERVER` removes it;
  neither keeps what the PC has. The installer installs for every user of
  the PC (Program Files), so it asks for an administrator: a service must
  run a program ordinary users cannot change. An update stops the service,
  replaces the files and starts it again. Uninstalling removes the service
  and its firewall rule; `C:\ProgramData\Topo` stays. There is no MSI any
  more (it could not ask).
- **Linux packages** enable nothing when installed: an upgrade restarts a
  server that already runs, and removal stops and disables it (the data in
  `/var/lib/topo` and `/etc/topo` stay). The admin prompt is polkit's
  (`pkexec`, action `systems.carino.topo.server`, remembered for a few
  minutes). The AppImage cannot be a service (its files vanish when it
  closes): it offers only "while Topo is open" (below). Another firewall
  than the default may need the port opened (`sudo firewall-cmd
  --add-port=7380/tcp --permanent && sudo firewall-cmd --reload`).
- **By hand**, the same commands the app runs (as an administrator):

      topo-desktop-server service install [--start] [--config FILE] [--smtp-pass FILE]
      topo-desktop-server service configure FILE [--smtp-pass FILE] [--start]
      topo-desktop-server service start | stop | uninstall
      topo-desktop-server service status [--port 7380]   # JSON, no administrator needed
      topo-desktop-server service log                    # when this account may read it

  `configure` takes only the settings the app writes (TOPO_LISTEN,
  TOPO_PUBLIC_URL, TOPO_ALLOWED_HOSTS, TOPO_TLS_SELF, TOPO_OWNER_EMAIL,
  TOPO_MAIL, TOPO_SMTP_HOST/PORT/SECURITY/USER/FROM, TOPO_BACKUP_FOLDERS),
  checks them as the server will and keeps the old file if the server would
  refuse them. The SMTP password goes into the service's own folder
  (`smtp.pass`), never into the settings file. The Windows exe is
  `C:\Program Files\Topo\topo-desktop-server.exe`; on Linux
  `/usr/bin/topo-desktop-server`; on macOS inside `Topo.app/Contents/MacOS`.

What was run where: the service commands have Go tests (Linux against a
stand-in systemd); the Linux rpm and deb are built and inspected
(`tests/desktop-packages.sh`: the files, the scripts, nothing enabled).
**Not run here**: the Windows installer (no makensis on Linux; CI builds it
and runs it silently on a Windows runner, `tests/desktop-installer-windows.ps1`:
install with `/SERVER`, the service, ACL, firewall rule and an answer on
127.0.0.1:7380, a reinstall, an uninstall that keeps the data), installing
the Linux packages and the pkexec prompt (root), the macOS daemon (no Mac),
and the running app talking to a real service.

### Advanced hosts: the server's own packages

Not offered to clients (D125): a client installs the desktop app. These
recipes stay for a host who builds them, for a server without the app.
What was built and checked where: the rpm and deb are built and inspected
on Linux; the Windows service and the macOS LaunchDaemon are cross-compiled
and their files checked by tests, but have not been run on Windows or macOS.

#### Install on Linux (rpm, deb)

    cd server
    make rpm ARCH=amd64          # dist/topo-server-<version>-1.x86_64.rpm  (rpmbuild)
    make deb ARCH=amd64          # dist/topo-server_<version>_amd64.deb     (dpkg-deb)
    make packages                # both, for amd64 and arm64
    make packages-test           # builds the amd64 pair and checks them (tests/packaging.sh)

They are built from the static binary by `packaging/linux/build-rpm.sh` and
`build-deb.sh` (no nfpm needed; no root to build). Installed:

| Path | What |
|---|---|
| `/usr/bin/topo-server` | the server |
| `/usr/lib/systemd/system/topo-server.service` | the unit (`packaging/linux/topo-server.service`) |
| `/usr/lib/sysusers.d/topo.conf` | the `topo` user and group |
| `/etc/topo/topo.env` | the settings, every line a comment as shipped (root:topo 0640; kept on upgrade and removal) |
| `/usr/share/doc/topo-server/` | this file and `backup-folder.conf.example` |
| `/var/lib/topo` | the data, made by systemd at the first start (never deleted, not even on purge) |

    sudo dnf install ./topo-server-<version>-1.x86_64.rpm      # or: sudo apt install ./topo-server_<version>_amd64.deb
    sudo editor /etc/topo/topo.env                             # TOPO_PUBLIC_URL, owner, SMTP
    sudo systemctl enable --now topo-server
    journalctl -u topo-server                                  # the log (and the setup token)

The service is **not** enabled or started on install: it needs its settings
first. Upgrades restart a running server; removal stops and disables it. The
packaged unit is the hand-install unit with one difference: a fixed user
`topo` instead of systemd's DynamicUser, so a backup folder on a USB disk or
a share can be given to it:

    sudo mkdir -p /mnt/backup/topo && sudo chown topo:topo /mnt/backup/topo
    sudo mkdir -p /etc/systemd/system/topo-server.service.d
    sudo cp /usr/share/doc/topo-server/backup-folder.conf.example \
            /etc/systemd/system/topo-server.service.d/backup-folder.conf
    # edit its ReadWritePaths= line; add the folder to TOPO_BACKUP_FOLDERS in topo.env
    sudo systemctl daemon-reload && sudo systemctl restart topo-server

The drop-in is needed because the unit sees the system read-only
(`ProtectSystem=strict`) and no home folders.

Checked here (`make packages-test`, 35 checks): files, modes and owners,
`topo.env` as a config file (rpm `noreplace`, deb conffile), the scripts
(the user made, nothing enabled on install, stop and disable on removal,
restart on upgrade, the data kept), `systemd-analyze verify` on the unit,
and the binary inside runs. **Not checked here**: installing them (needs
root), rpmlint and lintian (not installed).

#### Install on Windows

**Build-tested only**: the code is compiled and vetted for Windows
(`make windows`), and the WiX source and settings file are checked by Go
tests, but nothing below has been run on Windows. (Under Wine, `service
install` and `service uninstall` worked and the server answered when run
directly; Wine's service manager did not start the service, so the service
start itself is untested.)

**Without an installer**, in an administrator prompt:

    topo-server.exe service install     :: the service TopoServer, C:\ProgramData\Topo and a first topo.conf
    notepad C:\ProgramData\Topo\topo.conf
    topo-server.exe service start
    topo-server.exe service stop
    topo-server.exe service uninstall   :: the data stays

`service install` registers the service with automatic (delayed) start as
**Local Service**, restart on failure (5 s, 30 s, 2 min), and the command
line `serve --config C:\ProgramData\Topo\topo.conf`; it makes
`C:\ProgramData\Topo` readable only by Local Service, SYSTEM and
Administrators, and writes a first `topo.conf` (every line a comment) if
there is none. The data goes in `C:\ProgramData\Topo`. The log goes to
Event Viewer, Windows Logs, Application, source TopoServer. The exe stays
where it was when installed: put it somewhere fixed first (Program Files).

**The MSI** (WiX Toolset v4 or later, on Windows):

    dotnet tool install --global wix
    wix extension add -g WixToolset.Util.wixext
    powershell -File server\packaging\windows\build-msi.ps1 -Version 1.2.3 -Arch x64

`packaging/windows/topo-server.wxs` installs `topo-server.exe` in Program
Files\Topo, the same service (not started), and `C:\ProgramData\Topo` with
the same access and the same first `topo.conf`, kept on upgrade and
uninstall.

**Backups to a share or a mapped drive.** Local Service has no network
credentials and cannot see drive letters a user mapped, so a folder
destination on `\\nas\share` or `Z:` fails. Use a WebDAV or S3 destination
instead, or run the service as an account that can reach the share:
`sc config TopoServer obj= "DOMAIN\topo-svc" password= "…"` (that account
then also needs full control of `C:\ProgramData\Topo`).

#### Install on macOS

**Build-tested only**: `make macos` cross-compiles both architectures and a
Go test parses the LaunchDaemon; `build-pkg.sh` has not been run (it needs a
Mac).

    cd server && make macos
    packaging/macos/build-pkg.sh 1.2.3       # on a Mac: dist/topo-server-1.2.3.pkg (universal binary)

The pkg installs `/usr/local/bin/topo-server` and the LaunchDaemon
`/Library/LaunchDaemons/systems.carino.topo-server.plist`, makes a hidden
`_topo` user, `/Library/Application Support/Topo/topo.conf` (from
`topo.conf.default`, never overwritten) and its `data` folder (0700), logs to
`/Library/Logs/Topo/topo-server.log`, and loads the daemon. As shipped it
answers only on this Mac (127.0.0.1:7380). After editing `topo.conf`:

    sudo launchctl kickstart -k system/systems.carino.topo-server

To remove it: `sudo launchctl bootout system/systems.carino.topo-server`,
then delete the plist and the binary (the data stays).

### Only while the app is open

The desktop app (desktop/, Tauri) bundles `topo-server` and can also run it
as its own child, only while Topo is open (D113): the second choice in
Settings, **This PC as the server**, for a PC that cannot run the service
(the AppImage, a Mac copy outside Applications) or a trial. Off by default;
it stops when the app closes. When the service is set up (above), the
section talks to the service instead and this way is not offered.

- **This PC only**: `http://127.0.0.1:<port>` (7380 by default). Sign-in
  codes can be sent by email or shown in the section's log.
- **Other PCs on this network**: https on every address of the PC, with the
  self-signed certificate above (`TOPO_TLS_SELF`). The section lists each
  address (`https://192.168.1.20:7380`) with Copy and Open in browser, and
  the certificate's fingerprint to compare. Sign-in codes must go by email
  (SMTP), since nobody on another PC can read this PC's log. The OS firewall
  may ask to let "topo-desktop-server" in. Give the PC a fixed address.
  **Address to give people** picks the one that goes into sign-in links and
  invitations; Automatic takes the first the server lists, which puts real
  network cards before virtual ones (WSL, Hyper-V, Docker, VirtualBox, VPNs
  and tunnels, recognised by name). Pick it by hand when the PC has several
  real networks.
- The owner's email is required; the SMTP password is kept in
  `<app data>/server/smtp.pass` (0600) and never shown again. The server's data
  is `<app data>/server` (on Linux `~/.local/share/systems.carino.topo/server`,
  on Windows `%APPDATA%\systems.carino.topo\server`, on macOS
  `~/Library/Application Support/systems.carino.topo/server`), with
  `server.pid` so a second copy of the app (or this one after a crash) never
  starts a second server on the same data.
- The app's own window does not sync with its server (its page may talk only
  to the app): open the address in a browser on this PC too.
- "Start it when Topo opens" starts it with the app.
- Its data folder is the app's, not the service's: a server tried this way
  first does not carry over to the service.

How it is built: `desktop/sidecar.sh [target]` stages the app into the
server and builds `topo-server` for the target into
`desktop/src-tauri/binaries/topo-desktop-server-<target triple>`; `tauri.conf.json`
names it in `bundle.externalBin`. It has its own name so the desktop app's
deb/rpm (which puts it in `/usr/bin`) never conflicts with the topo-server
package's `/usr/bin/topo-server`; and `tauri-build` refuses to compile until
it exists (CI's builds.yml runs it before the Tauri build). What was tested
here: the Linux debug build (`cargo build --offline`) and its Rust unit
tests, the Settings section against a stub of the app's commands
(`tests/suites/desktopserver.js`), and the bundled binary with
`TOPO_TLS_SELF` in Chromium. **Not tested**: starting the server from the
running desktop app, the bundled layout in a real installer (no tauri-cli
here), and the Windows and macOS desktop builds.

### Signing (later)

Nothing is signed yet: rpm (`rpmsign` with a GPG key) and deb (a signed apt
repository or `debsigs`), the MSI and the exe (Authenticode with `signtool`),
the macOS binary and pkg (Developer ID with `codesign` and `productsign`, then
`notarytool` and `stapler`), and the desktop app (desktop/release-notes.md).
Until then Windows SmartScreen and macOS Gatekeeper warn on first run, and
packages are installed from a file the client trusts by its source.

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
