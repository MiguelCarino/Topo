// ---- The map at an earlier time (docs/SCOPE.md step 9b, D439) ----
// History steps through the saved points of the open network, oldest to
// newest, and shows the map as it was at each one with what changed marked on
// it. The points are what this browser already keeps:
//   - the network's restore points (js/restore.js), taken before a file, a
//     binder, a link or a sheet changed it;
//   - the copies that left this browser (js/revisions.js): a back-up, a link,
//     a part sent to a provider;
//   - the versions kept on a Topo server, when the network is on one: listed
//     when the dialog opens and each read only when it is looked at
//     (revisionAt, js/serversync.js); one the server no longer keeps is not
//     offered;
//   - any file compared with here, for as long as the dialog stays open;
//   - and the network as it is now.
// A point is drawn the way the report draws another network (withDocRendered,
// js/report.js): the map borrows it for one drawing, the picture is taken
// (canvasSvgMarkup, js/app.js) and the open network is put back. So what is
// shown is a picture, never the open network swapped for an old one: nothing
// can be edited by mistake, nothing is saved, and there is no undo step.
//
// The marks are put on the picture itself, from docChanges (js/changes.js),
// the comparison the merge and the report already trust: a device added
// since the point compared with has a green ring, one that changed an amber
// one, and one that is gone is drawn where it was as a red ghost. The list
// under the picture is changeRows, in words.
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const ADDED = '#16a34a', CHANGED = '#d97706', GONE = '#dc2626';
    const ROWS_MAX = 200;
    let _points = [];       // oldest first; the last is Now
    let _at = 0;            // the point shown
    let _mode = 'before';   // 'before': against the point before it; 'now': against the network as it is
    let _files = [];        // { key, at, name, doc } compared with in this sitting
    let _server = [];       // { key, at, n, load } the versions on the server, for this sitting
    let _seq = 0, _busy = false, _again = false, _url = null;

    const copy = (v) => JSON.parse(JSON.stringify(v));
    const whenText = (at) => {
        const lang = document.documentElement.lang || undefined;
        try { return new Date(at).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(at).toLocaleString(); }
    };

    // The saved points of card `cardId`, oldest first, Now last.
    function historyPoints(cardId) {
        const pts = [];
        if (cardId && typeof restorePointsOf === 'function') restorePointsOf(cardId).forEach((m) => pts.push({
            key: `r:${m.id}`, at: m.at, label: typeof restoreReasonText === 'function' ? restoreReasonText(m) : '', load: () => restorePointDoc(m.id) }));
        if (cardId && typeof revisionsOf === 'function') revisionsOf(cardId).forEach((m) => pts.push({
            key: `v:${m.rev}`, at: m.at, label: t('A copy that left this browser'), load: () => revisionDoc(cardId, m.rev) }));
        _files.forEach((f) => pts.push({ key: f.key, at: f.at, label: t('File: {name}', { name: f.name }), load: () => Promise.resolve(copy(f.doc)) }));
        _server.forEach((v) => pts.push({ key: v.key, at: v.at, label: t('Version {n} on the server', { n: v.n }), load: v.load }));
        pts.sort((a, b) => (a.at || 0) - (b.at || 0));
        pts.push({ key: 'now', at: Date.now(), label: t('Now'), now: true, load: () => Promise.resolve(copy(serializeDoc())) });
        return pts;
    }

    // The picture of document B with what changed since A marked on it.
    // -> an SVG as text, or null when B draws nothing.
    function markPicture(markup, ch, docA) {
        if (!markup) return null;
        const svg = new DOMParser().parseFromString(markup, 'image/svg+xml');
        const NS = 'http://www.w3.org/2000/svg';
        const make = (name, attrs) => { const e = svg.createElementNS(NS, name); Object.keys(attrs).forEach((k) => e.setAttribute(k, String(attrs[k]))); return e; };
        const ring = (id, colour, dash) => {
            const g = svg.getElementById(`ui-node-${id}`);
            if (!g) return;   // folded into a collapsed group: the list still names it
            g.insertBefore(make('rect', Object.assign({ x: -31, y: -31, width: 62, height: 62, rx: 14, fill: 'none', stroke: colour, 'stroke-width': 3, class: 'hx-ring' },
                dash ? { 'stroke-dasharray': '6 4' } : {})), g.firstChild);
        };
        ch.devices.added.forEach((d) => ring(d.id, ADDED, false));
        ch.devices.changed.forEach((d) => ring(d.id, CHANGED, true));
        ch.cables.added.forEach((c) => {
            const p = svg.getElementById(`ui-link-${c.id}`);
            if (p) { p.setAttribute('stroke', ADDED); p.setAttribute('class', `${p.getAttribute('class') || ''} hx-new`.trim()); }
        });
        // What is gone is drawn where it was, over the rest.
        const space = svg.getElementById('workspace');
        const was = new Map(((docA && docA.nodes) || []).filter(Boolean).map((n) => [n.id, n]));
        const ghosts = [];
        if (space) ch.devices.removed.forEach((d) => {
            const n = was.get(d.id);
            if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
            const g = make('g', { transform: `translate(${n.x}, ${n.y})`, class: 'hx-gone', opacity: 0.85 });
            g.appendChild(make('rect', { x: -24, y: -24, width: 48, height: 48, rx: 10, fill: '#ffffff', 'fill-opacity': 0.7, stroke: GONE, 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
            g.appendChild(make('path', { d: 'M -10 -10 L 10 10 M 10 -10 L -10 10', stroke: GONE, 'stroke-width': 2.5, 'stroke-linecap': 'round', fill: 'none' }));
            const label = make('text', { y: 40, 'text-anchor': 'middle', 'font-size': 11, 'font-family': 'sans-serif', 'font-weight': 700, fill: GONE });
            label.textContent = d.name || d.id;
            g.appendChild(label);
            space.appendChild(g);
            ghosts.push(n);
        });
        // The picture is framed round what is drawn now: a ghost outside that
        // frame would be cut, so the frame grows to hold it.
        const root = svg.documentElement;
        const box = (root.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const move = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec((space && space.getAttribute('transform')) || '');
        if (ghosts.length && box.length === 4 && box.every(Number.isFinite) && move) {
            let tx = Number(move[1]), ty = Number(move[2]), w = box[2], h = box[3];
            const left = Math.min(...ghosts.map((n) => n.x + tx - 70)), top = Math.min(...ghosts.map((n) => n.y + ty - 50));
            const dx = left < 0 ? -left : 0, dy = top < 0 ? -top : 0;
            tx += dx; ty += dy; w += dx; h += dy;
            w = Math.ceil(Math.max(w, ...ghosts.map((n) => n.x + tx + 70))); h = Math.ceil(Math.max(h, ...ghosts.map((n) => n.y + ty + 70)));
            space.setAttribute('transform', `translate(${tx}, ${ty}) scale(1)`);
            root.setAttribute('viewBox', `0 0 ${w} ${h}`); root.setAttribute('width', w); root.setAttribute('height', h);
        }
        return new XMLSerializer().serializeToString(svg);
    }

    // What the dialog shows for point `i` in mode `mode`:
    // -> Promise<{ from, to, changes, picture, rows }>, from null for the oldest point.
    function historyView(points, i, mode) {
        const to = mode === 'now' ? points[points.length - 1] : points[i];
        const from = mode === 'now' ? points[i] : points[i - 1] || null;
        if (mode === 'now' && to === from) return Promise.resolve({ from: null, to, same: true });
        return Promise.all([from ? from.load() : Promise.resolve(null), to.load()]).then(([a, b]) => {
            if (!b) return { from, to, missing: true };
            const ch = a ? docChanges(a, b) : null;
            // canvasSvgMarkup -> { markup, … } or null when nothing is drawn.
            const draw = to.now ? Promise.resolve(canvasSvgMarkup(1)) : withDocRendered(b, () => canvasSvgMarkup(1));
            return draw.then((drawn) => (drawn ? drawn.markup : null)).then((markup) => ({ from, to, changes: ch, missing: from && !a, rows: ch ? changeRows(ch) : [],
                picture: ch ? markPicture(markup, ch, a) : markup }));
        });
    }

    function setPicture(markup) {
        const img = $('historyPic'), none = $('historyNoPic');
        if (_url) { URL.revokeObjectURL(_url); _url = null; }
        if (!markup) { img.hidden = true; img.removeAttribute('src'); none.hidden = false; return; }
        _url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
        img.src = _url; img.hidden = false; none.hidden = true;
    }
    function renderHead() {
        const pick = $('historyPoint');
        pick.textContent = '';
        _points.slice().reverse().forEach((p) => {
            const o = document.createElement('option');
            o.value = p.key;
            o.textContent = p.now ? p.label : `${whenText(p.at)} · ${p.label}`;
            pick.appendChild(o);
        });
        pick.value = _points[_at].key;
        $('historyOlder').disabled = _at <= 0;
        $('historyNewer').disabled = _at >= _points.length - 1;
        $('historyMode').value = _mode;
        $('historyEmpty').classList.toggle('hidden', _points.length > 1);
    }
    function renderView(v) {
        const say = $('historySay'), list = $('historyRows');
        list.textContent = '';
        let line;
        if (v.same) line = t('This is the network as it is now.');
        else if (v.missing) line = t('This point could not be read.');
        else if (!v.from) line = t('The oldest point kept. Nothing to compare it with.');
        else {
            const n = v.changes.total;
            const span = v.to.now ? t('Since {date}:', { date: whenText(v.from.at) }) : t('From {from} to {to}:', { from: whenText(v.from.at), to: whenText(v.to.at) });
            line = joinSentences([span, n ? tn(n, '1 change.', '{n} changes.') : t('nothing changed.')]);
        }
        say.textContent = line;
        setPicture(v.same || v.missing ? null : v.picture);
        $('historyNoPic').textContent = v.same || v.missing ? '' : t('Nothing was drawn at this point.');
        (v.rows || []).slice(0, ROWS_MAX).forEach((r) => {
            const li = document.createElement('li');
            li.className = 'hx-row';
            const op = document.createElement('span'); op.className = 'hx-op'; op.textContent = r.op;
            const what = document.createElement('span'); what.className = 'hx-what'; what.textContent = [r.what, r.name].filter(Boolean).join(' ');
            const detail = document.createElement('span'); detail.className = 'hx-detail'; detail.textContent = r.detail || '';
            li.append(op, what, detail);
            list.appendChild(li);
        });
        if ((v.rows || []).length > ROWS_MAX) {
            const li = document.createElement('li'); li.className = 'hx-row'; li.textContent = t('…and {n} more.', { n: v.rows.length - ROWS_MAX });
            list.appendChild(li);
        }
        $('historyKey').classList.toggle('hidden', !(v.changes && v.picture));
    }
    // One drawing at a time: the map is lent out while a point is drawn.
    function show() {
        renderHead();
        if (_busy) { _again = true; return Promise.resolve(); }
        _busy = true;
        const seq = ++_seq;
        const body = $('historyBody');
        body.setAttribute('aria-busy', 'true');
        return historyView(_points, _at, _mode).then((v) => { if (seq === _seq) renderView(v); })
            .catch(() => { if (seq === _seq) renderView({ missing: true }); })
            .then(() => {
                _busy = false; body.setAttribute('aria-busy', 'false');
                if (_again) { _again = false; return show(); }
                return null;
            });
    }
    function go(i) {
        _at = Math.max(0, Math.min(_points.length - 1, i));
        return show();
    }
    // The versions a Topo server keeps of card `cardId`, newest last; none
    // when it is on no server, the server does not answer, or it keeps none.
    function serverVersions(cardId) {
        const Y = window.TopoServerSync;
        const r = Y && cardId && typeof Y.rec === 'function' ? Y.rec(cardId) : null;
        if (!r || !r.siteId || typeof Y.history !== 'function' || typeof Y.revisionAt !== 'function') return Promise.resolve([]);
        return Promise.resolve().then(() => Y.history(r.siteId)).then((res) => ((res && res.revs) || []).filter((hd) => hd && !hd.pruned && Number.isInteger(hd.n))
            .map((hd) => ({ key: `s:${hd.n}`, n: hd.n, at: Number(hd.received || hd.at) || 0, load: () => Y.revisionAt(r.siteId, hd) })).reverse()).catch(() => []);
    }
    function openHistory() {
        const card = state.libraryId;
        _server = [];
        _points = historyPoints(card);
        _mode = 'before';
        // The newest saved point first: what changed since is the usual question.
        _at = Math.max(0, _points.length - 1);
        const scrim = $('historyDialog');
        if (window.CarinoUI) CarinoUI.modal.open(scrim, {}); else scrim.hidden = false;
        const shown = show();
        // The server's versions arrive after: the point on screen stays the one shown.
        return shown.then(() => serverVersions(card)).then((list) => {
            if (!list.length || state.libraryId !== card || scrim.hidden) return null;
            const key = _points[_at].key;
            _server = list;
            _points = historyPoints(card);
            _at = Math.max(0, _points.findIndex((p) => p.key === key));
            return show();
        });
    }
    function closeHistory() {
        const scrim = $('historyDialog');
        if (!scrim) return;
        if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered'); else scrim.hidden = true;
        setPicture(null);
        _files = []; _server = [];
    }
    // A file to compare with: one network (its envelope or the bare document).
    function addFile(name, text, at) {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
        const doc = parsed && parsed.kind === 'nettopology' && parsed.doc ? parsed.doc : parsed;
        const status = $('historyStatus');
        // One network: its devices as a list, and no other kind of file (a binder says its own).
        const one = !!doc && typeof doc === 'object' && Array.isArray(doc.nodes) && (!parsed.kind || parsed.kind === 'nettopology');
        if (!one || typeof isDocShape !== 'function' || !isDocShape(doc)) {
            status.textContent = t('That file is not one network. A binder holds several: open the one you want first.');
            status.classList.remove('hidden');
            return Promise.resolve(false);
        }
        status.classList.add('hidden');
        const key = `f:${_files.length + 1}`;
        _files.push({ key, at: Number.isFinite(at) ? at : Date.now() - 1, name, doc });
        _points = historyPoints(state.libraryId);
        _mode = 'now';
        return go(_points.findIndex((p) => p.key === key)).then(() => true);
    }

    function wire() {
        const scrim = $('historyDialog');
        if (!scrim) return;
        $('historyPoint').addEventListener('change', (e) => go(_points.findIndex((p) => p.key === e.target.value)));
        $('historyOlder').onclick = () => go(_at - 1);
        $('historyNewer').onclick = () => go(_at + 1);
        $('historyMode').addEventListener('change', (e) => { _mode = e.target.value === 'now' ? 'now' : 'before'; show(); });
        $('historyFileBtn').onclick = () => $('historyFile').click();
        $('historyFile').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            if (f) f.text().then((text) => addFile(f.name, text, f.lastModified));
        });
        scrim.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeHistory(); });
        const item = $('historyBtn');
        if (item) item.onclick = () => openHistory();
    }
    wire();

    window.TopoHistory = { open: openHistory, close: closeHistory, points: historyPoints, view: historyView, mark: markPicture, addFile, go,
        at: () => _at, mode: () => _mode, list: () => _points.slice() };
})();
