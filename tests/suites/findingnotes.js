// Accepted entries and pins share their mechanics (js/diagnostics.js
// noteIds/noteScope, serializeFindingNotes, findingEntries, dropFindingNotes,
// namesSomething). What is held:
//   1. the bytes: serializeAccepted, serializePinned and serializeDoc write
//      what they wrote before the two kinds shared a serializer (literals
//      captured from that code), key order and all;
//   2. reading: a reason is required and cut, a bad until is left out, ids are
//      strings once each, a scope is cut and a blank one left out, an entry
//      naming nothing goes, a pin has a note only when it says something and
//      never an until; writing drops what is gone, an entry left empty, and
//      the whole key when nothing is left; pruning keeps the same list when
//      nothing changed;
//   3. the actions: Accept writes one entry per scope, schedules, replaces a
//      lapsed entry that covered the line, and refuses without a reason or on
//      a read-only network; Pin skips what is pinned and the note is optional;
//      Reopen and Unpin refuse a bad index; each is one undo step;
//   4. the drifts fixed: a finding that names nothing is pinned by nothing
//      (as it is accepted by nothing); Unpin takes every pin covering the
//      line, not the first one each finding met; a copy differing only by a
//      pin is one change on Update, and a pin is a change since the back-up.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const el = (id) => document.getElementById(id);
  const steps = () => { const m = /\((\d+)\)/.exec(el('undoBtn').title); return el('undoBtn').disabled ? 0 : (m ? Number(m[1]) : -1); };
  const day = (n) => todayISO(new Date(Date.now() + n * 86400000));
  const heldResponder = setDialogResponder(() => undefined);

  const fx = () => ({ v: DOC_VERSION, nodes: [
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [] },
      { id: 'b', type: 'pc', name: 'B', x: 100, y: 0, interfaces: [] },
      { id: 'c', type: 'pc', name: 'C', x: 200, y: 0, interfaces: [] }
    ], links: [{ id: 'l1', source: 'a', target: 'b' }],
    accepted: [
      { until: '2030-01-02', reason: ' Known ', linkIds: ['l1', 'gone'], nodeIds: ['a', 'b', 'a'], scope: ' 10.0.0.5 ', check: 'ip-conflict', junk: 1 },
      { check: 'age', nodeIds: ['c'], reason: 'Old' },
      { check: 'age', nodeIds: ['gone'], reason: 'Gone' }
    ],
    pinned: [
      { note: ' Look ', linkIds: ['l1'], nodeIds: ['b', 'a'], scope: '10.0.0.5', check: 'ip-conflict', until: '2030-01-01' },
      { check: 'age', nodeIds: ['c', 'gone'], note: '' },
      { check: 'age', linkIds: ['gone'] }
    ] });
  const open = (doc) => { replaceDocument(doc || fx(), { origin: 'file' }); initHistory(); };

  try {
    // ---- 1: the bytes, as written before the serializers were shared ----
    open();
    const raw = fx();
    ok('serializeAccepted writes the same bytes', show(serializeAccepted(raw.accepted))
       === '[{"check":"ip-conflict","scope":"10.0.0.5","nodeIds":["a","b"],"linkIds":["l1"],"reason":"Known","until":"2030-01-02"},{"check":"age","nodeIds":["c"],"reason":"Old"}]',
       show(serializeAccepted(raw.accepted)));
    ok('serializePinned writes the same bytes', show(serializePinned(raw.pinned))
       === '[{"check":"ip-conflict","scope":"10.0.0.5","nodeIds":["b","a"],"linkIds":["l1"],"note":"Look"},{"check":"age","nodeIds":["c"]}]',
       show(serializePinned(raw.pinned)));
    ok('normalizeAccepted keeps its key order', show(normalizeAccepted(raw.accepted))
       === '[{"check":"ip-conflict","nodeIds":["a","b"],"linkIds":["l1","gone"],"reason":"Known","scope":"10.0.0.5","until":"2030-01-02"},{"check":"age","nodeIds":["c"],"linkIds":[],"reason":"Old"},{"check":"age","nodeIds":["gone"],"linkIds":[],"reason":"Gone"}]',
       show(normalizeAccepted(raw.accepted)));
    ok('normalizePinned keeps its key order', show(normalizePinned(raw.pinned))
       === '[{"check":"ip-conflict","nodeIds":["b","a"],"linkIds":["l1"],"scope":"10.0.0.5","note":"Look"},{"check":"age","nodeIds":["c","gone"],"linkIds":[]},{"check":"age","nodeIds":[],"linkIds":["gone"]}]',
       show(normalizePinned(raw.pinned)));
    const docText = show(serializeDoc());
    ok('and serializeDoc writes the same document', docText.endsWith(',"links":[{"id":"l1","source":"a","target":"b"}],'
       + '"accepted":[{"check":"ip-conflict","scope":"10.0.0.5","nodeIds":["a","b"],"linkIds":["l1"],"reason":"Known","until":"2030-01-02"},{"check":"age","nodeIds":["c"],"reason":"Old"}],'
       + '"pinned":[{"check":"ip-conflict","scope":"10.0.0.5","nodeIds":["b","a"],"linkIds":["l1"],"note":"Look"},{"check":"age","nodeIds":["c"]}]}')
       && docText.startsWith('{"v":14,"nodes":[{"id":"a","type":"pc","name":"A","x":0,"y":0,"gw":"","dns":"","os":"","ports":"","notes":"","nat":false,"interfaces":[]}'), docText);

    // ---- 2: reading and writing ----
    const longScope = 'x'.repeat(70);
    const na = normalizeAccepted([
      { check: 'age', nodeIds: ['a'], reason: '   ' },
      { check: 'age', nodeIds: ['a'], reason: 'r'.repeat(301) },
      { check: 'age', nodeIds: ['a'], reason: 'r', until: '2030-1-2' },
      { check: 'age', nodeIds: ['a', 'a', 7, '', 'b'], reason: 'r', scope: longScope },
      { check: 'age', nodeIds: ['a'], reason: 'r', scope: '   ' },
      { check: 'age', nodeIds: [], linkIds: [], reason: 'r' },
      { check: '', nodeIds: ['a'], reason: 'r' }, null, 'x'
    ]);
    ok('an empty reason is dropped, a long one cut to 300', na.length === 4 && na[0].reason.length === 300, show(na.map((a) => a.reason.length)));
    ok('a bad until is left out', !('until' in na[1]), show(na[1]));
    ok('ids are strings, once each', show(na[2].nodeIds) === '["a","b"]', show(na[2]));
    ok('a scope is cut to 64, a blank one left out', na[2].scope === longScope.slice(0, 64) && !('scope' in na[3]), show([na[2].scope.length, na[3]]));
    ok('a list that is not a list is none', show(normalizeAccepted({ check: 'age' })) === '[]' && show(normalizePinned('x')) === '[]');
    const np = normalizePinned([
      { check: 'age', nodeIds: ['a'], note: '  ', until: '2030-01-01', scope: longScope },
      { check: 'age', linkIds: ['l1', 'l1'], note: 'n'.repeat(301) },
      { check: 'age', nodeIds: ['', 3] }
    ]);
    ok('a pin with an empty note has no note, and never an until', np.length === 2 && show(np[0]) === `{"check":"age","nodeIds":["a"],"linkIds":[],"scope":"${longScope.slice(0, 64)}"}`, show(np));
    ok('a pin note is cut to 300, its ids once each', np[1].note.length === 300 && show(np[1].linkIds) === '["l1"]', show(np[1].linkIds));
    ok('writing drops the ids that are gone and an entry left empty',
       show(serializeAccepted([{ check: 'age', nodeIds: ['gone', 'c'], linkIds: ['gone'], reason: 'r' }, { check: 'age', nodeIds: ['gone'], reason: 'r' }]))
       === '[{"check":"age","nodeIds":["c"],"reason":"r"}]');
    ok('and nothing left to write is no key', serializeAccepted([{ check: 'age', nodeIds: ['gone'], reason: 'r' }]) === undefined
       && serializePinned([]) === undefined && serializePinned(null) === undefined);
    const accHeld = state.accepted, pinHeld = state.pinned;
    pruneFindingNotes();
    ok('pruning an unchanged list keeps the same list', state.accepted === accHeld && state.pinned === pinHeld);
    state.pinned = pinHeld.concat([{ check: 'age', nodeIds: ['gone'], linkIds: [] }]);
    const grown = state.pinned;
    pruneFindingNotes();
    ok('and a changed one is replaced, without what is gone', state.pinned !== grown && state.pinned.length === pinHeld.length && state.accepted === accHeld);

    // ---- 3: the actions ----
    open({ v: DOC_VERSION, nodes: fx().nodes, links: fx().links });
    const two = [{ key: 'ip-conflict', nodeIds: ['a', 'b'], linkIds: [], scope: '10.0.0.5' },
                 { key: 'ip-conflict', nodeIds: ['b', 'c'], linkIds: ['l1'], scope: '10.0.0.6' },
                 { key: 'ip-conflict', nodeIds: ['c'], linkIds: [], scope: '10.0.0.5' }];
    ok('Accept with no reason refuses, and nothing is written', acceptFindings(two, '  ') === false && state.accepted.length === 0 && steps() === 0);
    ok('Accept writes one entry per scope, as one undo step', acceptFindings(two, ' Known ', day(30)) === true && steps() === 1
       && show(state.accepted) === `[{"check":"ip-conflict","nodeIds":["a","b","c"],"linkIds":[],"reason":"Known","scope":"10.0.0.5","until":"${day(30)}"},`
       + `{"check":"ip-conflict","nodeIds":["b","c"],"linkIds":["l1"],"reason":"Known","scope":"10.0.0.6","until":"${day(30)}"}]`, show(state.accepted));
    open({ v: DOC_VERSION, nodes: fx().nodes, links: fx().links,
      accepted: [{ check: 'age', nodeIds: ['a', 'b'], reason: 'Planned', until: day(-1) }, { check: 'age', nodeIds: ['c'], reason: 'Other', until: day(-1) }] });
    const aged = [{ key: 'age', nodeIds: ['a'], linkIds: [] }];
    ok('Accept replaces a lapsed schedule that covered the line', acceptFindings(aged, 'Now known') === true
       && show(state.accepted) === `[{"check":"age","nodeIds":["c"],"linkIds":[],"reason":"Other","until":"${day(-1)}"},{"check":"age","nodeIds":["a"],"linkIds":[],"reason":"Now known"}]`, show(state.accepted));
    ok('a bad until refuses', acceptFindings(aged, 'r', 'soon') === false && state.accepted.length === 2);
    state.readOnly = true;
    const roHeld = show(state.accepted);
    ok('a read-only network refuses Accept, Pin, Reopen and Unpin', acceptFindings(aged, 'r') === false && pinFindings(aged, 'n') === false
       && reopenAccepted(0) === false && unpin(0) === false && show(state.accepted) === roHeld && state.pinned.length === 0);
    state.readOnly = false;

    open({ v: DOC_VERSION, nodes: fx().nodes, links: fx().links });
    ok('Pin writes one entry per scope, the note when given', pinFindings(two, ' Look ') === true && steps() === 1
       && show(state.pinned) === '[{"check":"ip-conflict","nodeIds":["a","b","c"],"linkIds":[],"scope":"10.0.0.5","note":"Look"},'
       + '{"check":"ip-conflict","nodeIds":["b","c"],"linkIds":["l1"],"scope":"10.0.0.6","note":"Look"}]', show(state.pinned));
    ok('what is pinned is not pinned again', pinFindings(two, 'again') === false && state.pinned.length === 2 && steps() === 1);
    ok('a pin with no note has no note key', pinFindings(aged, '') === true && show(state.pinned[2]) === '{"check":"age","nodeIds":["a"],"linkIds":[]}', show(state.pinned[2]));
    ok('Unpin a bad index refuses', unpin(9) === false && unpin(-1) === false && state.pinned.length === 3 && steps() === 2);
    ok('Unpin takes that pin, as one undo step', unpin(0) === true && state.pinned.length === 2 && state.pinned[0].scope === '10.0.0.6' && steps() === 3);
    acceptFindings(aged, 'r');
    ok('Reopen a bad index refuses', reopenAccepted(5) === false && state.accepted.length === 1 && steps() === 4);
    ok('Reopen takes that entry, as one undo step', reopenAccepted(0) === true && state.accepted.length === 0 && steps() === 5);
    undo();
    ok('and undo puts it back', state.accepted.length === 1 && state.accepted[0].reason === 'r');

    // ---- 4: the drifts ----
    // A finding naming nothing: entryCovers() is true of any same-check
    // entry ("every one of none"), so pinEntryFor found a pin for it.
    open({ v: DOC_VERSION, nodes: fx().nodes, links: fx().links, pinned: [{ check: 'age', nodeIds: ['a'] }], accepted: [{ check: 'age', nodeIds: ['a'], reason: 'r' }] });
    const none = { key: 'age', nodeIds: [], linkIds: [] };
    ok('a finding naming nothing is pinned by nothing, as it is accepted by nothing',
       pinEntryFor(none) === null && acceptedEntryFor(state.accepted, 'age', [], [], '') === null && pinEntryFor({ key: 'age', nodeIds: ['a'], linkIds: [] }) === state.pinned[0]);
    // And it cannot be pinned or accepted: the entry would name nobody, so
    // the line never read as pinned, every click added another empty pin
    // and undo step, and the visit list showed it covering every finding of
    // the check.
    const pinsBefore = show(state.pinned), acceptsBefore = show(state.accepted), stepsBefore = steps();
    ok('a finding naming nothing is refused by Pin and Accept, and nothing is written',
       pinFindings([{ key: 'group', nodeIds: [], linkIds: [] }], 'x') === false && acceptFindings([{ key: 'group', nodeIds: [], linkIds: [] }], 'r') === false
       && show(state.pinned) === pinsBefore && show(state.accepted) === acceptsBefore && steps() === stepsBefore);
    ok('and the visit list does not count it as covered', pinnedGroups([none]).every((g) => !g.findings.length));

    // Two pins covering one line: A and B share 10.0.0.5 and are pinned; C
    // takes the address and the conflict (now A, B, C) is pinned again; C
    // leaves. Both pins cover A and B's conflict, and Unpin used to drop only
    // the first one each finding met, so the line stayed pinned.
    const iface = (ip) => [{ id: 'i1', name: 'eth0', ip }];
    open({ v: DOC_VERSION, links: [], nodes: [
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: iface('10.0.0.5/24') },
      { id: 'b', type: 'pc', name: 'B', x: 100, y: 0, interfaces: iface('10.0.0.5/24') },
      { id: 'c', type: 'pc', name: 'C', x: 200, y: 0, interfaces: iface('10.0.0.9/24') }] });
    const conflict = () => topologyFindings().filter((f) => f.key === 'ip-conflict');
    pinFindings(conflict(), 'first');
    getNode('c').interfaces[0].ip = '10.0.0.5/24'; save();
    ok('the conflict with C is not covered by the first pin', conflict().length === 1 && conflict()[0].nodeIds.length === 3 && !pinEntryFor(conflict()[0]), show(conflict()));
    pinFindings(conflict(), 'second');
    getNode('c').interfaces[0].ip = '10.0.0.9/24'; save();
    ok('with C gone both pins cover the line', state.pinned.length === 2 && state.pinned.every((a) => entryCovers(a, 'ip-conflict', conflict()[0].nodeIds, conflict()[0].linkIds, conflict()[0].scope)), show(state.pinned));
    validateTopology();
    const lineAt = () => {
      for (let gi = 0; gi < panelGroups.length; gi++) {
        const ii = panelGroups[gi].items.findIndex((it) => it.findings.some((f) => f.key === 'ip-conflict'));
        if (ii >= 0) return { gi, ii, item: panelGroups[gi].items[ii] };
      }
      return null;
    };
    const before = steps();
    ok('Unpin on the line', (await togglePin(lineAt().item)) === true && steps() === before + 1);
    ok('takes every pin covering it', state.pinned.length === 0 && !conflict().some(pinEntryFor), show(state.pinned));
    validateTopology();
    const at = lineAt();
    const pinBtn = document.querySelector(`#conflictMsgList .ca-pin[data-g="${at.gi}"][data-i="${at.ii}"]`);
    ok('and the line says it is not pinned', pinBtn && pinBtn.getAttribute('aria-pressed') === 'false' && pinBtn.textContent === 'Pin', pinBtn && pinBtn.outerHTML);

    // A copy differing only by a pin: docChangeCount compared the accepted
    // findings but not the pins, so Update said "same" and dropped it.
    open({ v: DOC_VERSION, nodes: fx().nodes, links: fx().links });
    const base = serializeDoc();
    pinFindings(aged, 'Bring the ladder');
    const pinnedDoc = serializeDoc();
    ok('a copy differing by a pin is one change on Update', docChangeCount(base, pinnedDoc) === 1 && docChangeCount(pinnedDoc, base) === 1
       && docChangeCount(base, base) === 0, `${docChangeCount(base, pinnedDoc)}`);
    // And docChanges counted the accepted findings, never the pins.
    const ch = docChanges(base, pinnedDoc);
    ok('a pin is a change since the back-up', ch.pinned && ch.pinned.added === 1 && ch.pinned.removed === 0 && ch.total === 1, show(ch.pinned) + ' ' + ch.total);
    ok('listed as Pinned findings', changeRows(ch).some((r) => r.what === 'Pinned findings' && r.detail === '1 pinned, 0 unpinned'), show(changeRows(ch)));
    const back = docChanges(pinnedDoc, base);
    ok('and the other way round, unpinned', back.pinned.removed === 1 && back.pinned.added === 0 && back.total === 1 && back.accepted.reopened === 0, show(back.pinned));
    ok('a note changed is one unpinned and one pinned', (() => { const d = JSON.parse(JSON.stringify(pinnedDoc)); d.pinned[0].note = 'Other'; const c = docChanges(pinnedDoc, d); return c.pinned.added === 1 && c.pinned.removed === 1; })());
    ok('no pin, no row', !changeRows(docChanges(base, base)).some((r) => r.what === 'Pinned findings'));
    setLocale('es'); applyLocale();
    ok('in Spanish', changeRows(ch).some((r) => r.what === 'Hallazgos fijados' && r.detail === '1 fijados, 0 desfijados'), show(changeRows(ch).map((r) => r.what)));
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
