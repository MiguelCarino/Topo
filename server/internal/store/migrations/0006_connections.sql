-- Connections (docs/SCOPE.md step 8f, D376-D379): the desktop apps whose
-- connection to this server is watched, and the gaps in it. Server
-- metadata, not site data: when a PC reported, never what it holds, so it
-- is kept in the clear (docs/SERVER.md, "What the server can see").
--
-- One row per watched PC (its device): watched since `since`, a heartbeat
-- every interval_ms (60 s), last_beat the last one. lost is set once it
-- missed 3 intervals and cleared when it beats again, so each change is
-- announced once. away: it said it was going (quit, signed out), so its
-- silence is not lost. A browser tab is never a row (D376).
CREATE TABLE connections (
  device_id   TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  since       INTEGER NOT NULL,
  interval_ms INTEGER NOT NULL DEFAULT 60000,
  last_beat   INTEGER,
  lost        INTEGER NOT NULL DEFAULT 0,
  away        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX connections_user ON connections(user_id);

-- The gaps: a watched PC's (client_id its device id) or a site monitor's
-- (its m_ id), with who saw it: 'server' (it stopped beating) or 'client'
-- (the PC could not reach the server, told once it could, D378). to_ms is
-- NULL while it goes on.
CREATE TABLE connection_gaps (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  from_ms   INTEGER NOT NULL,
  to_ms     INTEGER,
  seen_by   TEXT NOT NULL CHECK (seen_by IN ('server', 'client'))
);
CREATE INDEX connection_gaps_client ON connection_gaps(client_id, from_ms);
