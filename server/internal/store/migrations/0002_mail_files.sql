-- A file a "report" mail carries (docs/SCOPE.md D97): the provider report a
-- client chose to attach. Kept once however many addresses it goes to, and
-- only until every row that names it is sent or given up.
CREATE TABLE mail_files (
  id      TEXT PRIMARY KEY,              -- mf_...
  site_id TEXT,
  name    TEXT NOT NULL,                 -- cleaned (CleanAttachName)
  type    TEXT NOT NULL,                 -- application/pdf
  data    BLOB NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX mail_files_site ON mail_files(site_id);
ALTER TABLE outbox ADD COLUMN file_id TEXT;
CREATE INDEX outbox_file ON outbox(file_id) WHERE file_id IS NOT NULL;
