// Keeping backups (docs/SCOPE.md D103): the browser's port of the server's
// rule (js/backupdir.js backupKeep) against the same vectors as
// server/internal/backup/retention_test.go (tests/fixtures/retention.json,
// made by an independent implementation), each in its own time zone.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  try {
    const v = await (await fetch('tests/fixtures/retention.json')).json();
    ok('the shared vectors load', Array.isArray(v.cases) && v.cases.length >= 5, String(v.cases && v.cases.length));
    for (const c of v.cases) {
      const got = CarinoBackupDir.backupKeep(c.times.map((x) => Date.parse(x)), Date.parse(c.now), c.tz);
      const bad = got.map((k, i) => (k === c.keep[i] ? null : `${c.times[i]}: ${k}`)).filter(Boolean);
      ok(`${c.name} (${c.tz})`, bad.length === 0, bad.slice(0, 4).join(', '));
    }
    ok('nothing to keep from nothing', CarinoBackupDir.backupKeep([], Date.now(), 'UTC').length === 0);
    ok('the newest is always kept, even from the future', CarinoBackupDir.backupKeep([Date.now() + 864e5], Date.now(), 'UTC')[0] === true);
    ok('an unknown zone falls back to UTC rather than throwing', CarinoBackupDir.backupKeep([0, 1], 2, 'Not/AZone').length === 2);
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 300); });
