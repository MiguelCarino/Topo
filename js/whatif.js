// ---- What if this fails? (docs/SCOPE.md step 9a, D438) ----
// Pick a device or a cable and ask what would go dark without it. The answer
// is read off the drawing alone, in the page, with nothing monitored: the
// cables are walked from the way out (the Internet cloud, or the router that
// faces it) with the failed thing taken away, and every device the walk no
// longer reaches is dimmed on the map and named in a bar. Two cables to the
// same place, a ring and a second uplink are ways round, because the walk
// finds them. A VM or a container goes with its host. A VPN tunnel carries
// nothing here, as for the monitors' upstream chains (js/checks.js): it
// depends on the way out it is asking about.
//
// Nothing is written to the document and nothing leaves the page. It ends
// when the selection moves off the thing asked about (Esc, a click on the
// map), when the button is pressed again or the bar is closed.
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    let _asked = null;    // { type: 'node' | 'link', id }
    let _plan = null;     // the answer for the drawing as it is now
    const LIST_MAX = 24;

    const working = (n) => !!n && n.status !== 'retired' && n.status !== 'planned';

    // The answer for a document: pure, so the suite and the report can ask it.
    // -> { kind: 'internet' | 'router' | 'rest', where (a device, for 'router'),
    //      failed: { type, id }, dark: Set of device ids, total: devices asked about }
    function whatIfPlan(nodes, links, failed) {
        const byId = new Map(nodes.filter(working).map((n) => [n.id, n]));
        const cables = (links || []).filter((l) => l && l.medium !== 'vpn' && l.source !== l.target && byId.has(l.source) && byId.has(l.target));
        const gone = failed.type === 'node' ? failed.id : null, cut = failed.type === 'link' ? failed.id : null;
        const adjOf = (skipNode, skipLink) => {
            const adj = new Map();
            const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
            cables.forEach((l) => {
                if (l.id === skipLink || l.source === skipNode || l.target === skipNode) return;
                add(l.source, l.target); add(l.target, l.source);
            });
            return adj;
        };
        const walk = (adj, from) => {
            const seen = new Set(from);
            const queue = [...from];
            while (queue.length) (adj.get(queue.shift()) || []).forEach((nx) => { if (!seen.has(nx)) { seen.add(nx); queue.push(nx); } });
            return seen;
        };
        const before = adjOf(null, null), after = adjOf(gone, cut);
        const clouds = [...byId.values()].filter((n) => n.type === 'cloud').map((n) => n.id);
        const routers = [...byId.values()].filter((n) => n.type !== 'cloud' && isRoutingDevice(n.type)).map((n) => n.id);
        let kind, where = null, dark;
        const lost = (roots) => {
            const had = walk(before, roots), has = walk(after, roots.filter((id) => id !== gone));
            return new Set([...had].filter((id) => !has.has(id) && id !== gone));
        };
        if (clouds.length) { kind = 'internet'; dark = lost(clouds); }
        else if (routers.length && !(routers.length === 1 && routers[0] === gone)) {
            // No cloud drawn: the first router that is not the failed thing stands for the way out.
            const root = routers.find((id) => id !== gone);
            kind = 'router'; where = byId.get(root); dark = lost([root]);
        } else {
            // Nothing to be cut off from but each other: the largest piece left is "the rest".
            kind = 'rest';
            const start = gone || (cut && (cables.find((l) => l.id === cut) || {}).source);
            const comp = start && byId.has(start) ? walk(before, [start]) : new Set();
            const pieces = [], left = new Set([...comp].filter((id) => id !== gone));
            while (left.size) {
                const piece = walk(after, [left.values().next().value]);
                piece.forEach((id) => left.delete(id));
                pieces.push(piece);
            }
            pieces.sort((a, b) => b.size - a.size || ([...a].sort()[0] < [...b].sort()[0] ? -1 : 1));
            dark = new Set(pieces.slice(1).flatMap((p) => [...p]));
        }
        // A VM or a container goes with its host, however it is cabled.
        let grew = true;
        while (grew) {
            grew = false;
            byId.forEach((n) => {
                if (n.host && n.id !== gone && !dark.has(n.id) && (n.host === gone || dark.has(n.host))) { dark.add(n.id); grew = true; }
            });
        }
        return { kind, where, failed, dark, total: byId.size - (gone ? 1 : 0) };
    }

    const nameOf = (n) => (n && (n.name || n.id)) || '';
    function failedName(failed) {
        if (failed.type === 'node') return nameOf(getNode(failed.id));
        const l = getLink(failed.id);
        return l ? t('the cable between {a} and {b}', { a: nameOf(getNode(l.source)), b: nameOf(getNode(l.target)) }) : '';
    }
    // The answer in words: the sentence, then the devices by group.
    function whatIfWords(plan) {
        const n = plan.dark.size;
        const head = t('If {name} fails:', { name: failedName(plan.failed) });
        let line;
        if (!n) line = t('nothing else is affected.');
        else if (plan.kind === 'rest') line = tn(n, '1 device is cut off from the rest.', '{n} devices are cut off from the rest.');
        else line = tn(n, '1 device loses its way to {where}.', '{n} devices lose their way to {where}.',
            { where: plan.kind === 'internet' ? t('the internet') : nameOf(plan.where) });
        const byGroup = new Map();
        state.nodes.forEach((d) => {
            if (!d || !plan.dark.has(d.id)) return;
            const g = d.group && typeof groupById === 'function' ? groupById(d.group) : null;
            const key = g ? g.name || g.id : '';
            if (!byGroup.has(key)) byGroup.set(key, []);
            byGroup.get(key).push(nameOf(d));
        });
        let room = LIST_MAX;
        const rows = [];
        [...byGroup.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).forEach((key) => {
            if (room <= 0) return;
            const names = byGroup.get(key).slice(0, room);
            room -= names.length;
            rows.push((key ? `${key}: ` : '') + names.join(', '));
        });
        if (n > LIST_MAX) rows.push(t('…and {n} more.', { n: n - LIST_MAX }));
        return { head, line, rows };
    }

    function bar() {
        let b = $('whatIfBar');
        if (b) return b;
        b = document.createElement('div');
        b.id = 'whatIfBar';
        b.className = 'tt-bar wi-bar';
        b.setAttribute('role', 'status');
        b.setAttribute('aria-live', 'polite');
        b.hidden = true;
        b.addEventListener('click', (e) => { if (e.target.closest('[data-wi="close"]')) stop(); });
        document.body.appendChild(b);
        return b;
    }
    function renderBar() {
        const b = bar();
        if (!_plan) { if (!b.hidden) { b.hidden = true; b.innerHTML = ''; } return; }
        const w = whatIfWords(_plan);
        const x = `<button type="button" class="tt-x" data-wi="close" aria-label="${escapeHtml(t('Close'))}" title="${escapeHtml(t('Close'))}">✕</button>`;
        const html = `<div class="tt-head"><div class="tt-lines"><p class="tt-line ${_plan.dark.size ? 'tt-no' : 'tt-ok'}">${escapeHtml(joinSentences([w.head, w.line]))}</p>`
            + w.rows.map((r) => `<p class="tt-why">${escapeHtml(r)}</p>`).join('') + `</div>${x}</div>`
            + `<p class="tt-note">${escapeHtml(t('From the map, not a live test.'))}</p>`;
        if (b.dataset.html !== html) { b.innerHTML = html; b.dataset.html = html; }
        b.hidden = false;
    }
    function renderButton() {
        const btn = $('whatIfBtn');
        if (!btn) return;
        const on = state.selection.size === 1 && (state.selectedType === 'node' || state.selectedType === 'link') && !!state.selectedId;
        btn.classList.toggle('hidden', !on);
        btn.textContent = t(_asked ? 'Stop asking' : 'What if this fails?');
        btn.setAttribute('aria-pressed', _asked ? 'true' : 'false');
    }

    // Every drawing asks first (drawCanvas, js/ui.js): the answer follows the
    // document as it is edited, and ends with the selection.
    function refresh() {
        if (_asked) {
            const there = _asked.type === 'node' ? getNode(_asked.id) : getLink(_asked.id);
            const held = state.selection.size === 1 && state.selectedType === _asked.type && state.selectedId === _asked.id;
            if (!there || !held) _asked = null;
        }
        _plan = _asked ? whatIfPlan(state.nodes, state.links, _asked) : null;
        renderBar();
        renderButton();
        return _plan;
    }
    function start(type, id) {
        if (type !== 'node' && type !== 'link') return null;
        if (window.TopoTraceTarget) TopoTraceTarget.clear();
        _asked = { type, id };
        if (typeof renderCanvasOnly === 'function') renderCanvasOnly(); else refresh();
        return _plan;
    }
    function stop() {
        if (!_asked) return;
        _asked = null;
        if (typeof renderCanvasOnly === 'function') renderCanvasOnly(); else refresh();
    }
    function toggle() {
        if (_asked) { stop(); return; }
        if (state.selection.size === 1 && state.selectedId) start(state.selectedType, state.selectedId);
    }

    window.TopoWhatIf = {
        plan: whatIfPlan, words: whatIfWords, start, stop, toggle, refresh,
        asked: () => _asked,
        now: () => _plan,
        // How the map draws a device and a cable while an answer is up.
        nodeClass: (id, folded) => {
            if (!_plan) return '';
            if (_plan.failed.type === 'node' && _plan.failed.id === id) return ' wi-failed';
            if (_plan.dark.has(id) || (folded && folded.length && folded.every((x) => _plan.dark.has(x.id)))) return ' wi-dark';
            return '';
        },
        linkClass: (link) => {
            if (!_plan) return '';
            if (_plan.failed.type === 'link' && _plan.failed.id === link.id) return 'wi-failed-link';
            const out = (id) => _plan.dark.has(id) || (_plan.failed.type === 'node' && _plan.failed.id === id);
            return out(link.source) || out(link.target) ? 'wi-dark-link' : '';
        }
    };
    const btn = $('whatIfBtn');
    if (btn) btn.onclick = () => toggle();
})();
