// The map at an earlier time (js/history.js; docs/SCOPE.md step 9b, D439):
//   1. the points: a network with nothing kept has only Now; its restore
//      points come oldest first, Now last;
//   2. a point against the one before it: what was added has a green ring on
//      the picture, what changed an amber one, what is gone is drawn where
//      it was as a ghost with its name; an added cable is green; the list
//      says each in words; the oldest point has nothing to compare with;
//   3. a point against the network now: the picture is the network now,
//      marked with what changed since that point;
//   4. the dialog: opened from Export, it starts at Now against the point
//      before, Older and Newer step and stop at the ends, the pick follows,
//      the sentence and the key are shown, the picture is an image;
//   5. the open network is untouched: the same document, no undo step, the
//      selection and the camera kept, nothing left borrowed;
//   6. a file: one network's back-up is added as a point and compared with
//      now; a binder or junk is refused in words;
//   6b. a network on a Topo server: the versions it still keeps are listed
//      with the rest (the server client stood in for), each read only when
//      looked at; a server that does not answer leaves the local points;
//   7. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const N = (id, type, x, y, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x, y, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const base = () => ({ v: DOC_VERSION,
    nodes: [N('rt', 'router', 300, 0), N('sw', 'switch', 300, 150, { portCount: 8, interfaces: [] }), N('pc1', 'pc', 150, 300), N('old', 'printer', 450, 300)],
    links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc1' }, { id: 'l3', source: 'sw', target: 'old' }] });
  const edit = (fn) => { batch(() => { fn(); save(); renderCanvasOnly(); }); flushAutosave(); };
  const parse = (markup) => new DOMParser().parseFromString(markup, 'image/svg+xml');
  const ringOf = (svg, id) => { const g = svg.getElementById(`ui-node-${id}`); const r = g && g.querySelector('.hx-ring'); return r ? r.getAttribute('stroke') : null; };
  const H = window.TopoHistory;
  try {
    setLocale('en');
    // ---- 1. The points ----
    replaceDocument(base(), { origin: 'file', docId: 'doc-history' }); renderCanvasOnly();
    ok('nothing kept: only Now', H.points(state.libraryId).length === 1 && H.points(state.libraryId)[0].now === true);
    // Kept without the name question: a claimed document becomes a card with its first change.
    replaceDocument(base(), { origin: 'file', claim: true }); renderCanvasOnly();
    edit(() => { getNode('rt').os = 'RouterOS 7'; });
    const card = state.libraryId;
    ok('the network is kept', !!card && !!libraryEntry(card));
    recordRestorePoint(card, 'Before a file changed it');           // point A: the base
    edit(() => {
      state.nodes.push(N('pc2', 'pc', 300, 300)); state.links.push(bindLink({ id: 'l4', source: 'sw', target: 'pc2' }));   // added
      getNode('pc1').name = 'Front desk';                                                                                   // changed
      state.nodes = state.nodes.filter((n) => n.id !== 'old'); state.links = state.links.filter((l) => l.id !== 'l3');      // removed
    });
    recordRestorePoint(card, 'Before a link changed it');           // point B
    edit(() => { state.nodes.push(N('cam', 'camera', 600, 150)); });   // now
    const pts = H.points(card);
    ok('two restore points and Now, oldest first', pts.length === 3 && pts[0].at < pts[1].at && pts[2].now === true && /^r:/.test(pts[0].key), pts.map((p) => p.key).join());

    // ---- 2. A point against the one before ----
    const held = JSON.stringify(serializeDoc()), undoAt = _undoStack.length, cam = JSON.stringify(state.camera);
    select('rt', 'node');
    const first = await H.view(pts, 0, 'before');
    ok('the oldest point has nothing to compare with', first.from === null && !first.changes && !!first.picture && !/hx-ring/.test(first.picture));
    const v = await H.view(pts, 1, 'before');
    const svg = parse(v.picture);
    ok('what was added has a green ring', ringOf(svg, 'pc2') === '#16a34a');
    ok('what changed has an amber ring', ringOf(svg, 'pc1') === '#d97706');
    ok('what did not change has none', ringOf(svg, 'rt') === null && ringOf(svg, 'sw') === null);
    const gone = svg.querySelector('.hx-gone');
    ok('what is gone is drawn where it was, with its name', !!gone && gone.getAttribute('transform') === 'translate(450, 300)' && /OLD/.test(gone.textContent) && !svg.getElementById('ui-node-old'), gone && gone.getAttribute('transform'));
    // A ghost outside what is drawn now is still inside the picture.
    const edgeDoc = base(); edgeDoc.nodes.push(N('far', 'pc', 2000, -900));
    const edge = parse(H.mark(canvasSvgMarkup(1).markup, docChanges(edgeDoc, serializeDoc()), edgeDoc));
    const vb = edge.documentElement.getAttribute('viewBox').split(' ').map(Number), mv = /translate\((-?[\d.]+), (-?[\d.]+)\)/.exec(edge.getElementById('workspace').getAttribute('transform'));
    ok('the frame grows to hold a ghost outside it', 2000 + Number(mv[1]) + 40 <= vb[2] && -900 + Number(mv[2]) - 30 >= 0 && Number(edge.documentElement.getAttribute('width')) === vb[2], JSON.stringify([vb, mv && mv.slice(1)]));
    ok('an added cable is green', svg.getElementById('ui-link-l4').getAttribute('stroke') === '#16a34a' && svg.getElementById('ui-link-l1').getAttribute('stroke') !== '#16a34a');
    ok('the picture is the point, not the network now', !svg.getElementById('ui-node-cam'));
    const words = v.rows.map((r) => [r.op, r.what, r.name, r.detail].join(' ')).join(' | ');
    ok('the list says each in words', /Added Device PC2/.test(words) && /Removed Device OLD/.test(words) && /Front desk[^|]*renamed from PC1/.test(words) && v.changes.total >= 5, words);

    // ---- 3. Against the network now ----
    const n = await H.view(pts, 1, 'now');
    const nsvg = parse(n.picture);
    ok('against now: the picture is the network now, the camera added since', n.to.now === true && ringOf(nsvg, 'cam') === '#16a34a' && ringOf(nsvg, 'pc2') === null && !nsvg.querySelector('.hx-gone'));
    const far = await H.view(pts, 0, 'now');
    ok('…from the oldest point, everything since', ringOf(parse(far.picture), 'pc2') === '#16a34a' && ringOf(parse(far.picture), 'pc1') === '#d97706' && !!parse(far.picture).querySelector('.hx-gone'));
    ok('Now against now is said, not drawn', (await H.view(pts, 2, 'now')).same === true);

    // ---- 5 (first half). The open network is untouched ----
    ok('the document is what it was', JSON.stringify(serializeDoc()) === held);
    ok('no undo step, the selection and the camera kept', _undoStack.length === undoAt && state.selectedId === 'rt' && JSON.stringify(state.camera) === cam);
    ok('the map is the user\'s again', canvasIsBorrowed() === false && !!document.getElementById('ui-node-cam') && !document.getElementById('ui-node-old'));

    // ---- 4. The dialog ----
    ok('History is in the Export menu', !!el('historyBtn') && /History…/.test(el('historyBtn').textContent));
    await H.open();
    const dlg = el('historyDialog');
    ok('it opens at Now against the point before', !dlg.hidden && H.at() === 2 && H.mode() === 'before' && el('historyPoint').value === 'now' && el('historyNewer').disabled && !el('historyOlder').disabled);
    ok('the pick lists the points, newest first', el('historyPoint').options.length === 3 && el('historyPoint').options[0].value === 'now' && /Before a link changed it/.test(el('historyPoint').options[1].textContent));
    ok('the sentence says what changed since the point before', /^Since .*: 1 change\.$/.test(el('historySay').textContent), el('historySay').textContent);
    ok('the picture is an image, with the key', !el('historyPic').hidden && /^blob:/.test(el('historyPic').src) && !el('historyKey').classList.contains('hidden'));
    ok('the rows are listed', el('historyRows').children.length === 1 && /Added/.test(el('historyRows').textContent) && /CAM/.test(el('historyRows').textContent), el('historyRows').textContent);
    el('historyOlder').click(); await wait(80);
    ok('Older steps back', H.at() === 1 && /^r:/.test(el('historyPoint').value) && /^From .* to .*: \d+ changes\.$/.test(el('historySay').textContent), el('historySay').textContent);
    el('historyOlder').click(); await wait(80);
    ok('…and stops at the oldest', H.at() === 0 && el('historyOlder').disabled && /The oldest point kept/.test(el('historySay').textContent) && el('historyRows').children.length === 0 && el('historyKey').classList.contains('hidden'));
    el('historyMode').value = 'now'; el('historyMode').dispatchEvent(new Event('change', { bubbles: true })); await wait(80);
    ok('Compare with the network now', H.mode() === 'now' && /^Since .*: \d+ changes\.$/.test(el('historySay').textContent) && el('historyRows').children.length >= 4, el('historySay').textContent);
    el('historyPoint').value = 'now'; el('historyPoint').dispatchEvent(new Event('change', { bubbles: true })); await wait(80);
    ok('Now against now says so', /This is the network as it is now\./.test(el('historySay').textContent) && el('historyPic').hidden);

    // ---- 6. A file ----
    const backup = JSON.stringify({ kind: 'nettopology', version: 1, name: 'Old copy', doc: base() });
    ok('a back-up file is taken', (await H.addFile('old-copy.json', backup, Date.now() - 86400000)) === true);
    ok('…as the oldest point, compared with now', H.list().length === 4 && /^f:/.test(H.list()[0].key) && H.at() === 0 && H.mode() === 'now' && /File: old-copy\.json/.test(el('historyPoint').selectedOptions[0].textContent));
    ok('…and its difference is drawn and listed', /changes\.$/.test(el('historySay').textContent) && /Removed/.test(el('historyRows').textContent) && /OLD/.test(el('historyRows').textContent) && !el('historyPic').hidden);
    ok('a binder is refused in words', (await H.addFile('binder.json', JSON.stringify({ kind: 'nettopology-binder', networks: [] }), 1)) === false && /not one network/.test(el('historyStatus').textContent) && !el('historyStatus').classList.contains('hidden'));
    ok('junk is refused too', (await H.addFile('x.json', '{nope', 1)) === false && H.list().length === 4);
    dlg.querySelector('.modal-foot [data-close]').click(); await wait(50);
    ok('Close closes it and forgets the files', (dlg.hidden || !CarinoUI.modal.isOpen(dlg)) && H.points(card).length === 3);

    // ---- 5 (second half) ----
    ok('after the dialog: the same document, no undo step', JSON.stringify(serializeDoc()) === held && _undoStack.length === undoAt && canvasIsBorrowed() === false);

    // ---- 6b. Versions on a Topo server ----
    // The server client is stood in for: what History asks of it, and what it does with the answers.
    const realSync = window.TopoServerSync;
    const asked = [];
    const v1 = base(), v2 = base(); v2.nodes.push(N('srvnew', 'server', 600, 300));
    window.TopoServerSync = { rec: (id) => (id === card ? { siteId: 'site-1', cardId: id } : null),
      history: async (siteId) => { asked.push('history ' + siteId); return { head: { n: 3, h: 'h3' }, revs: [{ n: 3, h: 'h3', received: Date.now() - 1000, pruned: true }, { n: 2, h: 'h2', received: Date.now() - 2000 }, { n: 1, h: 'h1', received: Date.now() - 86400000 * 3 }] }; },
      revisionAt: async (siteId, hd) => { asked.push('rev ' + hd.n); return hd.n === 1 ? v1 : hd.n === 2 ? v2 : null; } };
    try {
      await H.open(); await wait(120);
      const keys = H.list().map((p) => p.key);
      ok('a network on a server lists the versions it keeps, oldest first, with the rest', keys.includes('s:1') && keys.includes('s:2') && keys.indexOf('s:1') < keys.indexOf('s:2') && keys[keys.length - 1] === 'now', keys.join());
      ok('…not one the server no longer keeps', !keys.includes('s:3'));
      ok('…and the point on screen stayed Now', H.at() === keys.length - 1 && el('historyPoint').value === 'now');
      ok('listing reads no version', asked.join() === 'history site-1', asked.join());
      el('historyPoint').value = 's:2'; el('historyPoint').dispatchEvent(new Event('change', { bubbles: true })); await wait(120);
      ok('looking at one reads it and the one before', /Version 2 on the server/.test(el('historyPoint').selectedOptions[0].textContent) && asked.includes('rev 2') && !el('historyPic').hidden, asked.join());
      el('historyMode').value = 'now'; el('historyMode').dispatchEvent(new Event('change', { bubbles: true })); await wait(120);
      ok('…and it compares with the network now', /^Since .*: \d+ changes\.$/.test(el('historySay').textContent) && el('historyRows').children.length > 0, el('historySay').textContent);
      dlg.querySelector('.modal-foot [data-close]').click(); await wait(50);
      ok('closing forgets them', H.points(card).every((p) => !/^s:/.test(p.key)));
      window.TopoServerSync = { rec: () => ({ siteId: 'site-1' }), history: async () => { throw new Error('offline'); }, revisionAt: async () => null };
      await H.open(); await wait(120);
      ok('a server that does not answer leaves the local points', H.list().length === 3 && !el('historyDialog').hidden);
      dlg.querySelector('.modal-foot [data-close]').click(); await wait(50);
    } finally { window.TopoServerSync = realSync; }
    ok('the real server client can read an earlier version', !!realSync && typeof realSync.revisionAt === 'function' && typeof realSync.history === 'function');

    // ---- 7. Translations ----
    const { has, locales } = window.CarinoI18N;
    const strings = ['History', 'History…', '◂ Older', 'Newer ▸', 'Saved point', 'Compare with', 'the point before', 'the network now', 'Compare with a file…', 'Now',
      'A copy that left this browser', 'File: {name}', 'This is the network as it is now.', 'This point could not be read.', 'The oldest point kept. Nothing to compare it with.',
      'Since {date}:', 'From {from} to {to}:', '1 change.', '{n} changes.', 'nothing changed.', 'Nothing was drawn at this point.',
      'That file is not one network. A binder holds several: open the one you want first.', 'Version {n} on the server'];
    locales.forEach((loc) => ok(`${loc} carries the strings`, strings.every((s) => has(loc, s)), strings.filter((s) => !has(loc, s)).join(' | ')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
