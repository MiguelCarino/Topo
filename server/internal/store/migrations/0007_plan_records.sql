-- A fifth kind of record (docs/SCOPE.md D457, step 9k): 'plan', the checks an
-- owner's browser sends a monitor with no screen (desktop/monitor), sealed
-- with the site key and signed like every record. One row per (site, kind,
-- id) as before; the id is "<monitor>|<owner>|<part>".
--
-- SQLite cannot change a CHECK in place, so the table is made again and its
-- rows copied. The counter behind n goes with them: a reader asks for
-- n > the last it saw, so n must never go back, even when the newest rows
-- were deleted before this ran.
CREATE TABLE site_records_new (
  n        INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id  TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL CHECK (kind IN ('status','issue','act','quiet','plan')),
  id       TEXT NOT NULL,
  author   TEXT NOT NULL,
  epoch    INTEGER NOT NULL,
  at       INTEGER NOT NULL,
  received INTEGER NOT NULL,
  folded   INTEGER NOT NULL DEFAULT 0,
  record   TEXT NOT NULL
);
INSERT INTO site_records_new(n, site_id, kind, id, author, epoch, at, received, folded, record)
  SELECT n, site_id, kind, id, author, epoch, at, received, folded, record FROM site_records;
DELETE FROM sqlite_sequence WHERE name = 'site_records_new';
INSERT INTO sqlite_sequence(name, seq) SELECT 'site_records_new', seq FROM sqlite_sequence WHERE name = 'site_records';
DROP TABLE site_records;
ALTER TABLE site_records_new RENAME TO site_records;
CREATE UNIQUE INDEX site_records_key ON site_records(site_id, kind, id);
CREATE INDEX site_records_since ON site_records(site_id, n);
