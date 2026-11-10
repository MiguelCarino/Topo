-- Topo server schema, version 1 (step 5a). docs/SERVER.md describes it.
-- Times are INTEGER unix milliseconds. Ids are TEXT: a prefix (u_ d_ s_ i_
-- c_ l_ o_) and 16 random bytes in base64url. The server never holds a
-- document in clear: revision bodies, wraps, rosters and escrows are
-- ciphertext or signed blobs made by the browsers.

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: created_at, owner_exists ('1' once ever set; never cleared),
-- setup_token_hash, app_hash_last

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,                 -- as typed first, for display
  email_norm  TEXT NOT NULL UNIQUE,          -- lowercased, trimmed
  lang        TEXT NOT NULL DEFAULT 'en',    -- en|es|pt-BR|ja|ru, email language
  server_role TEXT NOT NULL DEFAULT 'member' CHECK (server_role IN ('owner','staff','member')),
  enc_pub     TEXT,                          -- b64url raw 65 bytes, NULL until key setup
  sig_pub     TEXT,
  keys_at     INTEGER,                       -- last key setup/reset
  escrow      TEXT,                          -- JSON blob, NULL when skipped
  notify      TEXT NOT NULL DEFAULT '{}',
  created     INTEGER NOT NULL,
  disabled    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE devices (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dev_pub    TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  created    INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  wrap       TEXT,                           -- user bundle wrapped to dev_pub; NULL = not linked yet
  wrapped_by TEXT                            -- device id, or 'recovery' / 'setup'
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE link_requests (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created   INTEGER NOT NULL,
  expires   INTEGER NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired'))
);
CREATE INDEX link_requests_user ON link_requests(user_id, status);

CREATE TABLE sessions (
  id_hash   BLOB PRIMARY KEY,                -- SHA-256 of the cookie value
  id        TEXT NOT NULL UNIQUE,            -- public handle for list/revoke (l_...)
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  created   INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires   INTEGER NOT NULL,                -- absolute
  ip        TEXT NOT NULL DEFAULT '',
  ua        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE challenges (
  id         TEXT PRIMARY KEY,               -- c_...
  email_norm TEXT NOT NULL,
  real       INTEGER NOT NULL,               -- 0 = decoy (never verifies)
  code_mac   BLOB NOT NULL,                  -- HMAC(server key, id|code); decoys get random bytes
  link_hash  BLOB NOT NULL,                  -- SHA-256(link token)
  bind_hash  BLOB NOT NULL,                  -- SHA-256(challenge cookie value)
  lang       TEXT NOT NULL,
  setup      INTEGER NOT NULL DEFAULT 0,
  invite_id  TEXT,
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  used       INTEGER NOT NULL DEFAULT 0,
  ip         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX challenges_email ON challenges(email_norm, created);
CREATE INDEX challenges_link ON challenges(link_hash);

CREATE TABLE sites (
  id          TEXT PRIMARY KEY,              -- s_... (minted by the creating browser)
  created     INTEGER NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  epoch       INTEGER NOT NULL DEFAULT 1,
  head_n      INTEGER NOT NULL DEFAULT 0,
  head_h      TEXT NOT NULL,                 -- genesis hash at creation
  roster_seq  INTEGER NOT NULL DEFAULT 1,
  name_ct     TEXT,                          -- JSON {v,epoch,iv,ct}
  name_clear  TEXT,                          -- only when show_name = 1
  show_name   INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0     -- sum of stored body ciphertext
);

CREATE TABLE site_rosters (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  epoch   INTEGER NOT NULL,
  by_user TEXT NOT NULL,
  roster  TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (site_id, seq)
);

CREATE TABLE members (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('owner','provider','viewer')),
  status  TEXT NOT NULL CHECK (status IN ('granted','waiting')),
  added   INTEGER NOT NULL,
  granted INTEGER,
  muted   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, user_id)
);
CREATE INDEX members_user ON members(user_id);

CREATE TABLE site_wraps (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  epoch   INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrap    TEXT NOT NULL,
  by_user TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (site_id, epoch, user_id)
);

CREATE TABLE invites (
  id          TEXT PRIMARY KEY,              -- i_...
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email_norm  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner','provider','viewer')),
  lang        TEXT NOT NULL,
  token_hash  BLOB NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by  TEXT NOT NULL REFERENCES users(id),
  created     INTEGER NOT NULL,
  expires     INTEGER NOT NULL,
  accepted_by TEXT REFERENCES users(id),
  accepted_at INTEGER
);
CREATE INDEX invites_site ON invites(site_id, status);
CREATE INDEX invites_email ON invites(email_norm, status);

-- Revision headers. Bodies live in rev_bodies (amendment D3), behind the
-- store's Blobs interface, which is where 5b/5c storage plugs in.
CREATE TABLE revisions (
  site_id  TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  n        INTEGER NOT NULL,
  base     INTEGER NOT NULL,                 -- always n-1 in 5a
  prev     TEXT NOT NULL,                    -- h of base
  epoch    INTEGER NOT NULL,
  rseq     INTEGER NOT NULL,
  author   TEXT NOT NULL,                    -- user id (no FK: history outlives users)
  device   TEXT NOT NULL,
  at       INTEGER NOT NULL,                 -- client-claimed ms, signed
  received INTEGER NOT NULL,                 -- server time
  size     INTEGER NOT NULL,                 -- ciphertext bytes
  ct_hash  TEXT NOT NULL,                    -- b64url SHA-256(iv||ct)
  sig      TEXT NOT NULL,                    -- b64url 64 bytes (P1363)
  h        TEXT NOT NULL,
  pruned   INTEGER NOT NULL DEFAULT 0,       -- 1 once the body was dropped by TOPO_REV_CAP
  PRIMARY KEY (site_id, n)
);

CREATE TABLE rev_bodies (
  site_id TEXT NOT NULL,
  n       INTEGER NOT NULL,
  iv      TEXT NOT NULL,
  ct      BLOB NOT NULL,
  PRIMARY KEY (site_id, n),
  FOREIGN KEY (site_id, n) REFERENCES revisions(site_id, n) ON DELETE CASCADE
);

CREATE TABLE outbox (
  id         TEXT PRIMARY KEY,               -- o_...
  kind       TEXT NOT NULL,
  to_email   TEXT NOT NULL,
  user_id    TEXT,
  site_id    TEXT,
  lang       TEXT NOT NULL,
  data       TEXT NOT NULL,                  -- JSON template data, blanked once sent
  dedupe     TEXT,                           -- user|site|kind for digests
  count      INTEGER NOT NULL DEFAULT 1,
  created    INTEGER NOT NULL,
  send_after INTEGER NOT NULL,
  sent       INTEGER,                        -- ms; -1 failed for good; -2 decoy (never sent)
  tries      INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);
CREATE UNIQUE INDEX outbox_dedupe ON outbox(dedupe) WHERE sent IS NULL AND dedupe IS NOT NULL;
CREATE INDEX outbox_due ON outbox(sent, send_after);

-- Per-email sign-in requests (survives restarts).
-- kind 'req' counts every request; 'own' counts the requests made from the
-- browser that already holds a recent challenge for that address (amendment
-- B2), so a flood from elsewhere cannot lock the real person out.
CREATE TABLE mail_rate (
  email_norm TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'req',
  at         INTEGER NOT NULL
);
CREATE INDEX mail_rate_email ON mail_rate(email_norm, kind, at);

-- Per-email failed code verifies, across challenges (amendment B1).
CREATE TABLE verify_fail (
  email_norm TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX verify_fail_email ON verify_fail(email_norm, at);

-- Revision digest window.
CREATE TABLE last_sent (
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, site_id, kind)
);

-- Events a member declared in a push, per recipient (amendment F2: an
-- author may declare incident-sent to one person at most 5 times per site
-- per hour). Pruned after a day.
CREATE TABLE declared (
  site_id TEXT NOT NULL,
  author  TEXT NOT NULL,
  kind    TEXT NOT NULL,
  to_user TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX declared_key ON declared(site_id, author, kind, to_user, at);

-- Invitation emails sent (amendment B8: per inviter, per recipient and per
-- invitation caps). Pruned after a day.
CREATE TABLE invite_sends (
  inviter    TEXT NOT NULL,
  site_id    TEXT NOT NULL,
  invite_id  TEXT NOT NULL,
  email_norm TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE INDEX invite_sends_inviter ON invite_sends(inviter, at);
CREATE INDEX invite_sends_email ON invite_sends(email_norm, at);
CREATE INDEX invite_sends_invite ON invite_sends(invite_id, at);
