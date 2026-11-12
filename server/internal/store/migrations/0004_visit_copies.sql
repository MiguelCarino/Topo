-- Provider visits through the owner (docs/SCOPE.md step 7, D139, D154).
-- A provider member never writes a revision of a site any more: their
-- Record visit uploads a visit copy, the encrypted network they edited and
-- the server revision they started from (base_n), which waits here until an
-- owner's browser reviews it, approves or rejects it, and says so (state).
-- The server cannot read it, as it cannot read a revision. One copy per
-- provider and report: slot is an opaque name the browser gives the report
-- (a hash), and a new copy for the same slot replaces the one waiting
-- (replaced counts how many it replaced); a decided copy stays beside it
-- until its author has taken the answer (D191). The provider's browser
-- deletes its copy once it has taken the decision; removing the provider
-- (or changing their role) deletes their copies; housekeeping drops
-- decided copies after 90 days.
CREATE TABLE visit_copies (
  id         TEXT PRIMARY KEY,                 -- v_...
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,                    -- user id
  device     TEXT NOT NULL,
  slot       TEXT NOT NULL,
  base_n     INTEGER NOT NULL,
  epoch      INTEGER NOT NULL,
  rseq       INTEGER NOT NULL,
  at         INTEGER NOT NULL,                 -- client-claimed ms, signed
  received   INTEGER NOT NULL,
  replaced   INTEGER NOT NULL DEFAULT 0,
  size       INTEGER NOT NULL,
  ct_hash    TEXT NOT NULL,
  sig        TEXT NOT NULL,
  iv         TEXT NOT NULL,
  ct         BLOB NOT NULL,
  state      TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting','approved','rejected')),
  decided_at INTEGER,
  decided_by TEXT,
  decided_n  INTEGER
);
CREATE UNIQUE INDEX visit_copies_slot ON visit_copies(site_id, author, slot) WHERE state = 'waiting';
CREATE INDEX visit_copies_site ON visit_copies(site_id, state, received);
