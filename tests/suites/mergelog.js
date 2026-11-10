// @realtime — the network log's hash chain on real Web Crypto (js/merge.js
// "The network log"). run.sh's --dump-dom clock never lets crypto.subtle
// answer, so tests/suites/merge.js uses a stand-in digest; here the real one:
// SHA-256 of a known text, an appended entry's prev is the SHA-256 of the
// entry before it, an untouched log verifies, an edited entry shows.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const TM = window.TopoMerge;
  try {
    TM.setDigest(null);
    ok('the digest is SHA-256 (the "abc" vector)', await TM.digest('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const e = (id, at) => ({ id, at, kind: 'merge', source: 'x.json', counts: { added: 1, changed: 0, removed: 0, conflicts: 0 }, mode: 'two-way' });
    const doc = await TM.appendLogEntry({ nodes: [], log: [e('a', 1)] }, TM.mergeLogEntry({ id: 'lg_1', at: 2, source: 'closet.json', counts: { added: 2 }, mode: 'two-way' }));
    const first = doc.log[0];
    // Keys sorted at every level: the entry as text whatever order it was written in.
    const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o, k) => { o[k] = sorted(v[k]); return o; }, {}) : v);
    const text = JSON.stringify(sorted(first));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
    ok('an appended entry\'s prev is the SHA-256 of the entry before it', doc.log[1].prev === hex, doc.log[1].prev);
    ok('an untouched log verifies', await TM.verifyLog(doc.log) === -1);
    const edited = JSON.parse(JSON.stringify(doc.log));
    edited[0].source = 'forged.json';
    ok('an entry edited by hand shows', await TM.verifyLog(edited) === 1);
  } catch (err) {
    ok('the suite ran to the end', false, err && (err.stack || err.message));
  }
  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 0); });
