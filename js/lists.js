// ---- Address lists and who may reach whom (docs/SCOPE.md step 9h, D444) ----
// The dialog behind Export -> Address lists: the document's lists
// (doc.lists, "Address lists" in js/model.js), each a name, its addresses and
// subnets, and the lists it may not reach (or is recorded as allowed to).
// "Does A reach B?" (js/tracetarget.js) stops at a blocked pair and names the
// two lists; the report prints the table. It documents a firewall. Topo
// reads and writes none, and nothing here is checked against a live one.
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    let _left = 0;   // entries the last edit left out because they were not addresses

    const devicesIn = (l) => state.nodes.filter((n) => n && listsHolding(n, [l]).length).length;
    // An edit: one undo step, the map redrawn (a trace on screen follows), the dialog too.
    function change(fn) {
        if (typeof readOnlyRefuses === 'function' && readOnlyRefuses()) return;
        fn();
        state.lists = normalizeLists(serializeLists(state.lists) || []);
        save(); renderCanvasOnly();
        if (window.TopoTraceTarget && TopoTraceTarget.refresh) TopoTraceTarget.refresh();
        render();
    }
    // "10.0.1.0/24, 10.0.2.5" or one per line -> the members the format takes.
    function membersFromText(text) {
        const raw = String(text || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
        const kept = asListMembers(raw) || [];
        _left = new Set(raw).size - kept.length;
        return kept;
    }
    function addList() {
        if (state.lists.length >= LIST_MAX) return null;
        let n = state.lists.length + 1, name;
        do { name = t('List {n}', { n: n++ }); } while (state.lists.some((l) => l.name === name));
        const id = nextId('al');
        change(() => { state.lists.push({ id, name }); });
        return id;
    }

    function refsPicker(list, key, label) {
        const others = state.lists.filter((o) => o.id !== list.id);
        const box = document.createElement('fieldset');
        box.className = 'al-refs'; box.dataset.key = key;
        const legend = document.createElement('legend'); legend.className = 'prop-lbl'; legend.textContent = t(label);
        box.appendChild(legend);
        if (!others.length) {
            const none = document.createElement('span'); none.className = 'dlg-dim'; none.textContent = t('Add a second list to say what this one may not reach.');
            box.appendChild(none);
            return box;
        }
        others.forEach((o) => {
            const lab = document.createElement('label'); lab.className = 'prop-check al-ref';
            const tick = document.createElement('input'); tick.type = 'checkbox'; tick.value = o.id; tick.checked = (list[key] || []).includes(o.id);
            tick.onchange = () => change(() => {
                const set = new Set(list[key] || []);
                if (tick.checked) set.add(o.id); else set.delete(o.id);
                if (set.size) list[key] = [...set]; else delete list[key];
            });
            const word = document.createElement('span'); word.textContent = listLabel(o);
            lab.append(tick, word);
            box.appendChild(lab);
        });
        return box;
    }
    function card(list, ro) {
        const el = document.createElement('div');
        el.className = 'net-card al-card'; el.dataset.list = list.id;
        const head = document.createElement('div'); head.className = 'al-head';
        const name = document.createElement('input');
        name.type = 'text'; name.className = 'input al-name'; name.value = list.name || ''; name.maxLength = LIST_NAME_MAX; name.disabled = ro; name.setAttribute('aria-label', t('Name'));
        name.onchange = () => { const v = name.value.trim(); if (!v) { name.value = list.name; return; } change(() => { list.name = v; }); };
        const count = document.createElement('span'); count.className = 'al-count';
        count.textContent = tn(devicesIn(list), '1 device on the map', '{n} devices on the map');
        head.append(name, count);
        const lab = document.createElement('label'); lab.className = 'prop-lbl'; lab.textContent = t('Addresses and subnets');
        const members = document.createElement('textarea');
        members.className = 'input al-members'; members.rows = 2; members.spellcheck = false; members.disabled = ro; members.placeholder = '192.168.1.20, 10.0.20.0/24';
        members.value = (list.members || []).join(', ');
        members.setAttribute('aria-label', t('Addresses and subnets'));
        members.onchange = () => change(() => { const kept = membersFromText(members.value); if (kept.length) list.members = kept; else delete list.members; });
        el.append(head, lab, members);
        if (!ro) {
            el.append(refsPicker(list, 'blocked', 'May not reach'), refsPicker(list, 'allowed', 'May reach'));
            const del = document.createElement('button');
            del.type = 'button'; del.className = 'link-btn quiet al-del'; del.textContent = t('Delete');
            del.onclick = () => change(() => { state.lists = state.lists.filter((l) => l.id !== list.id); });
            el.append(del);
        }
        return el;
    }
    function render() {
        const body = $('listsBody');
        if (!body) return;
        const ro = !!state.readOnly;
        const focus = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.al-card') : null;
        const at = focus ? focus.dataset.list : null;
        body.textContent = '';
        state.lists.forEach((l) => body.appendChild(card(l, ro)));
        $('listsEmpty').classList.toggle('hidden', state.lists.length > 0);
        const add = $('listsAddBtn');
        add.classList.toggle('hidden', ro);
        add.disabled = state.lists.length >= LIST_MAX;
        const note = $('listsStatus');
        note.textContent = _left > 0 ? tn(_left, '1 entry was not an address or a subnet and was left out.', '{n} entries were not addresses or subnets and were left out.') : '';
        note.classList.toggle('hidden', !(_left > 0));
        _left = 0;
        if (at) { const again = body.querySelector(`.al-card[data-list="${CSS.escape(at)}"] .al-name`); if (again) again.focus(); }
    }
    function open() {
        const scrim = $('listsDialog');
        if (window.CarinoUI) CarinoUI.modal.open(scrim, {}); else scrim.hidden = false;
        render();
    }
    function close() {
        const scrim = $('listsDialog');
        if (!scrim) return;
        if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered'); else scrim.hidden = true;
    }
    const scrim = $('listsDialog');
    if (scrim) {
        scrim.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
        $('listsAddBtn').onclick = () => addList();
        const item = $('listsBtn');
        if (item) item.onclick = () => open();
    }
    window.TopoLists = { open, close, render, add: addList, membersFromText, devicesIn };
})();
