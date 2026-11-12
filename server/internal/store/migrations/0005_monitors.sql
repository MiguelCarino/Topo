-- Monitors through the server (docs/SCOPE.md step 7h, D146-D151, D158,
-- D159, D161, D162). A site monitor is a PC an owner turned on: a
-- credential that is not a person. It has a users row (id m_…, its email
-- column holds that id, which has no "@" and so never signs in; its keys
-- are the PC's device keys) so the site key is wrapped to it and the
-- signed roster names it like any member, with the new role 'monitor'.
-- It reads the site and writes records only: status, statistics, issues.
--
-- SQLite cannot change a CHECK in place, so members is made again with
-- 'monitor' in its role CHECK (nothing references members).
CREATE TABLE members_new (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('owner','provider','viewer','monitor')),
  status  TEXT NOT NULL CHECK (status IN ('granted','waiting')),
  added   INTEGER NOT NULL,
  granted INTEGER,
  muted   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, user_id)
);
INSERT INTO members_new(site_id, user_id, role, status, added, granted, muted)
  SELECT site_id, user_id, role, status, added, granted, muted FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_user ON members(user_id);

-- Keep statistics (D162), per site, set by an owner: days, 0 = Off (no
-- statistics kept anywhere). Applied here and by every monitor.
ALTER TABLE sites ADD COLUMN stats_days INTEGER NOT NULL DEFAULT 360;

-- One row per monitor. The token is the monitor's credential (only its
-- SHA-256 here); it is independent of any person's session, so the
-- monitor keeps working after the owner who turned it on signs out (D129).
-- last_report is the heartbeat (D151): the server sees it without reading
-- anything; stale is set once it missed 3 intervals and cleared when it
-- reports again, so each change is announced once.
CREATE TABLE monitors (
  id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  by_user     TEXT NOT NULL,
  created     INTEGER NOT NULL,
  token_hash  BLOB NOT NULL UNIQUE,
  interval_ms INTEGER NOT NULL DEFAULT 60000,
  last_report INTEGER,
  stale       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX monitors_site ON monitors(site_id);

-- Records (D158, D159): encrypted with the site key and signed by their
-- author, checked against the author's key here, read only by browsers.
-- kind: 'status' (a monitor's latest, one per monitor), 'issue' (a
-- monitor's outage), 'act' (a person's act on an issue), 'quiet' (a quiet
-- window). One row per (site, kind, id); a newer record from the same
-- author replaces it with a new n, so a reader asks for n > the last it saw.
-- folded: an owner's browser has put it into the document; folded records
-- go after 30 days, unfolded ones stay (and go into the backups, D159).
CREATE TABLE site_records (
  n        INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id  TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('status','issue','act','quiet')),
  id       TEXT NOT NULL,
  author   TEXT NOT NULL,
  epoch    INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  received INTEGER NOT NULL,
  folded   INTEGER NOT NULL DEFAULT 0,
  record   TEXT NOT NULL
);
CREATE UNIQUE INDEX site_records_key ON site_records(site_id, kind, id);
CREATE INDEX site_records_since ON site_records(site_id, n);

-- Statistics (D161): one encrypted blob of hourly figures per monitor and
-- UTC day (day = the day's first ms). Applied retention: stats_days.
CREATE TABLE monitor_stats (
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL,                  -- kept after a revoke: history
  day        INTEGER NOT NULL,
  received   INTEGER NOT NULL,
  record     TEXT NOT NULL,
  PRIMARY KEY (site_id, monitor_id, day)
);
