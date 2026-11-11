-- Backups (docs/SCOPE.md step 5b, D99-D105). One destination at a time,
-- set by the server owner in the app (Account, Backups) and kept here, not in
-- environment settings. A backup file is the head revision exactly as stored
-- (ciphertext) plus what an owner needs to open it; the server never holds a
-- network in clear for it.

-- The destination (one row). fields is JSON of the non-secret fields;
-- secret_ct the sealed secrets (AES-GCM under a key derived from server.key,
-- D105), never returned to a browser. config_id is new each time the
-- destination changes: rows written to an older one are "on a previous
-- destination" and never pruned through the new one.
CREATE TABLE backup_config (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  enabled          INTEGER NOT NULL DEFAULT 0,
  kind             TEXT NOT NULL DEFAULT '',         -- folder | webdav (5c: s3, gdrive, onedrive)
  fields           TEXT NOT NULL DEFAULT '{}',
  secret_ct        TEXT,
  config_id        TEXT NOT NULL DEFAULT '',
  daily_at         TEXT NOT NULL DEFAULT '02:30',    -- server local time
  readable_allowed INTEGER NOT NULL DEFAULT 0,
  oauth_ref        TEXT,                             -- 5c: Drive folder id, OneDrive drive id
  marker_owed      INTEGER NOT NULL DEFAULT 0,       -- a folder saved with "Save anyway": its .topo-backups is written on the next save that finds it
  updated          INTEGER NOT NULL DEFAULT 0,
  updated_by       TEXT
);
INSERT INTO backup_config(id) VALUES (1);

-- What happened (one row). last_daily_date is a local YYYY-MM-DD, so a DST
-- day runs the daily backup exactly once (amendment 9). run_owner/run_until
-- is the lease one engine holds (amendment 11): `topo-server backup-now`
-- refuses while a running server holds it.
CREATE TABLE backup_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  last_ok          INTEGER,
  last_err_at      INTEGER,
  last_err         TEXT,                             -- a short code (unreachable, refused, ...)
  last_daily_date  TEXT,
  last_check_at    INTEGER,
  last_check_ok    INTEGER,
  last_check_err   TEXT,
  mailed_fail_day  TEXT,
  mailed_check_day TEXT,
  backoff_step     INTEGER NOT NULL DEFAULT 0,
  backoff_until    INTEGER NOT NULL DEFAULT 0,
  drop_note        TEXT,                             -- 5c: a store that keeps files locked
  run_owner        TEXT,
  run_until        INTEGER NOT NULL DEFAULT 0
);
INSERT INTO backup_state(id) VALUES (1);

-- Every file Topo wrote. No foreign key to sites: the backups of a deleted
-- network stay listed until the server owner deletes them (D103).
CREATE TABLE backups (
  id           TEXT PRIMARY KEY,                     -- b_...
  site_id      TEXT NOT NULL,
  config_id    TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('enc','readable')),
  name         TEXT NOT NULL,                        -- the file name (no folder)
  ref          TEXT,                                 -- 5c: the Drive / OneDrive item id
  rev_n        INTEGER NOT NULL,
  at           INTEGER NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL,                        -- hex of the exact bytes written
  checked_at   INTEGER,
  missing      INTEGER NOT NULL DEFAULT 0,
  drop_pending INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX backups_site ON backups(site_id, kind, at);

-- The owner allows a readable copy for this network (D106, stage 2), and
-- the name the browser made for file names when the name is shown in clear
-- (amendment 4: the server has no Unicode normalisation to make it).
ALTER TABLE sites ADD COLUMN backup_readable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN name_slug TEXT;

-- OAuth sign-ins in progress (5c): single use, 10 minutes. state is the
-- SHA-256 of the value sent to the provider.
CREATE TABLE oauth_states (
  state          TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  sess_hash      TEXT NOT NULL,
  verifier       TEXT NOT NULL,
  client_id_hash TEXT NOT NULL DEFAULT '',
  redirect_uri   TEXT NOT NULL DEFAULT '',
  pending_ct     TEXT,                                -- the settings typed before Connect, sealed (D105)
  created        INTEGER NOT NULL
);
