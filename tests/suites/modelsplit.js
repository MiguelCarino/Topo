// Inventory, stage 2 (docs/BACKLOG.md feature 3, landing order step 13): the
// split review. Before document v16 a device's model and its firmware shared
// one field, and the upgrade left that text in os (now Firmware / OS). The
// split is offered, never done by itself. What is held here:
//   1. planModelSplit, pure, on the spec's table: a model / firmware pair
//      split on its one spaced separator, a leading maker's word moved to
//      vendor, a known maker's model with no firmware moved whole, firmware
//      text and the type seeds kept, "IOS-XE" and "Gi1/0" never split, two
//      separators or text it cannot read left as it is; devices with a
//      vendor or a model, or no os, not looked at; nothing typed lost;
//   2. the review (askTicks): one tick per device that changes, all ticked,
//      the ones left as they are named under the list; Apply writes only the
//      ticked rows, in one undo step, and Undo restores the exact text;
//      dismissing writes nothing; a row whose device changed while the
//      question was open is not written; a read-only network refuses;
//   3. the real modal: the ticks drawn as text, Apply disabled with none
//      ticked, the answer the ticked ids, Esc null;
//   4. the device editor's note and Split button (one undo step, the note
//      following the typed Firmware / OS text, none on a read-only network);
//   5. the Table toolbar's "Split model and firmware…", offered on Devices
//      only while there is something to split;
//   6. the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const steps = () => _undoStack.length;
  let answer = null;
  const asked = [];
  const heldResponder = setDialogResponder((req) => { asked.push(req); return typeof answer === 'function' ? answer(req) : answer; });
  const heldToast = window.showToast;
  const toasts = [];
  window.showToast = (m) => toasts.push(m);
  const dev = (id, name, os, extra) => ({ id, type: 'switch', name, x: 0, y: 0, os, interfaces: [], ...(extra || {}) });
  const lab = () => ({ v: 15, links: [], nodes: [
    dev('a', 'SW-A', 'C9200L-24P / IOS-XE 17.9.4'),
    dev('b', 'SW-B', 'Cisco C9200L / 17.9'),
    { ...dev('c', 'PRN-1', 'HP LaserJet M404dn'), type: 'printer' },
    dev('d', 'RTR-1', 'RouterOS 7.14'),
    { ...dev('e', 'PC-1', 'Windows 11'), type: 'pc' },
    dev('f', 'SW-F', 'IOS-XE'),
    dev('g', 'SW-G', 'Gi1/0'),
    dev('h', 'BOX', 'my old box'),
    dev('i', 'SW-I', 'C9300 / IOS-XE 17.6.1 / spare'),
    dev('j', 'SW-J', 'C9300 / IOS-XE 17.6.1', { model: 'C9300' }),
    dev('k', 'SW-K', 'Aruba 2930F, WC.16.11.0012', { vendor: '  ' }),
    dev('l', 'SW-L', ''),
    dev('m', 'NAS', 'Synology DSM 7.2')
  ] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); initHistory(); };
  setLocale('en');

  try {
    // ---- 1. The planner ----
    open();
    const plan = planModelSplit();
    const row = (id) => plan.rows.find((r) => r.nodeId === id);
    const rowText = (id) => { const r = row(id); return r ? `${r.kind}|${r.vendor}|${r.model}|${r.os}` : 'none'; };
    ok('"C9200L-24P / IOS-XE 17.9.4": model left, firmware right', rowText('a') === 'split||C9200L-24P|IOS-XE 17.9.4', rowText('a'));
    ok('"Cisco C9200L / 17.9": the maker to vendor', rowText('b') === 'split|Cisco|C9200L|17.9', rowText('b'));
    ok('"HP LaserJet M404dn": a maker\'s model, no firmware', rowText('c') === 'model|HP|LaserJet M404dn|', rowText('c'));
    ok('"RouterOS 7.14" and "Windows 11" (a type seed) are kept as firmware', plan.kept.includes('d') && plan.kept.includes('e') && !row('d') && !row('e'));
    ok('"IOS-XE" is not split on its hyphen', plan.kept.includes('f'));
    ok('"Gi1/0" is not split on its slash', plan.left.includes('g') && !row('g'));
    ok('"my old box" is left as it is', plan.left.includes('h'));
    ok('two separators: left as it is', plan.left.includes('i'));
    ok('a device with a model already is not looked at', ![...plan.kept, ...plan.left, ...plan.rows.map((r) => r.nodeId)].includes('j'));
    ok('a vendor of blank space is blank: ", " splits with the maker moved', rowText('k') === 'split|Aruba|2930F|WC.16.11.0012', rowText('k'));
    ok('no os, nothing to plan', ![...plan.kept, ...plan.left].includes('l') && !row('l'));
    ok('a maker before a system\'s name is firmware ("Synology DSM 7.2")', plan.kept.includes('m'));
    ok('lowercase maker words count, kept as typed', planModelSplit([dev('x', 'X', 'cisco c9200l')]).rows[0].vendor === 'cisco');
    ok('a model on the right of a separator is not taken for firmware', planModelSplit([dev('x', 'X', '17.9 / C9200L')]).rows.length === 0);
    ok('a version on the left keeps it from splitting', planModelSplit([dev('x', 'X', 'v2.1 / 7.14')]).rows.length === 0);
    const one = (os) => planModelSplit([dev('x', 'X', os)]);
    const oneRow = (os) => { const r = one(os).rows[0]; return r ? [r.kind, r.vendor, r.model, r.os].join('|') : 'none'; };
    const isLeft = (os) => { const p = one(os); return !p.rows.length && p.left.includes('x'); };
    ok('a maker before a system and its version is kept ("Cisco IOS 15.2")', one('Cisco IOS 15.2').kept.includes('x'));
    ok('a maker\'s model with a dotted version in it is not a model-only row', isLeft('HP LaserJet M404dn 2.1'), oneRow('HP LaserJet M404dn 2.1'));
    // A product line named like a system is a model, not firmware: only the
    // whole text being a system's name and its versions keeps it.
    ok('"UniFi Switch 24 PoE / 6.5.55" splits (UniFi names the product line)', oneRow('UniFi Switch 24 PoE / 6.5.55') === 'split||UniFi Switch 24 PoE|6.5.55', oneRow('UniFi Switch 24 PoE / 6.5.55'));
    ok('"Ubiquiti UniFi AP AC Pro, 6.0.21" splits with the maker moved', oneRow('Ubiquiti UniFi AP AC Pro, 6.0.21') === 'split|Ubiquiti|UniFi AP AC Pro|6.0.21', oneRow('Ubiquiti UniFi AP AC Pro, 6.0.21'));
    ok('a system with its edition and version is still kept ("Windows Server 2019", "Ubuntu 22.04 LTS", "UniFi")',
       ['Windows Server 2019', 'Ubuntu 22.04 LTS', 'UniFi', 'Juniper Junos OS 21.4R3'].every((t) => one(t).kept.includes('x')));
    // Firmware words after the model keep a text from being a model-only row.
    ok('"Dell OptiPlex 7090 Windows 11" is not a model-only row (a type seed at its end)', isLeft('Dell OptiPlex 7090 Windows 11'), oneRow('Dell OptiPlex 7090 Windows 11'));
    ok('"Cisco C9200L IOS-XE" is not a model-only row', isLeft('Cisco C9200L IOS-XE'), oneRow('Cisco C9200L IOS-XE'));
    ok('"MikroTik hAP ac2 RouterOS" is not a model-only row', isLeft('MikroTik hAP ac2 RouterOS'), oneRow('MikroTik hAP ac2 RouterOS'));
    // Separators that did not split leave the text, whatever their count.
    ok('one separator, no firmware on the right: left ("HP LaserJet M404dn, Floor 2")', isLeft('HP LaserJet M404dn, Floor 2'), oneRow('HP LaserJet M404dn, Floor 2'));
    ok('no firmware on either side: left ("C9200L-24P / spare")', isLeft('C9200L-24P / spare'), oneRow('C9200L-24P / spare'));
    ok('two separators, no firmware: left too ("HP LaserJet M404dn, Floor 2, duplex")', isLeft('HP LaserJet M404dn, Floor 2, duplex'), oneRow('HP LaserJet M404dn, Floor 2, duplex'));
    ok('"Cisco C9200L / IOS-XE / spare" is left', isLeft('Cisco C9200L / IOS-XE / spare'), oneRow('Cisco C9200L / IOS-XE / spare'));
    ok('a proposed model never starts with a separator ("HP / LaserJet / M404", "Dell | OptiPlex | 7090")',
       isLeft('HP / LaserJet / M404') && isLeft('Dell | OptiPlex | 7090'), oneRow('HP / LaserJet / M404') + ' ' + oneRow('Dell | OptiPlex | 7090'));
    ok('a maker\'s word alone is not a model-only row', isLeft('HP'), oneRow('HP'));
    const words = (s) => s.split(/[\s/·|;,]+/).filter(Boolean).join(' ');
    const lost = plan.rows.filter((r) => words([r.vendor, r.model, r.os].join(' ')) !== words(getNode(r.nodeId).os));
    ok('nothing typed is lost: vendor, model and os hold the original words', !lost.length, show(lost));
    ok('the planner writes nothing', getNode('a').os === 'C9200L-24P / IOS-XE 17.9.4' && getNode('a').model === undefined);

    // ---- 2. The review ----
    open();
    answer = (req) => (req.kind === 'ticks' ? req.rows.map((r) => r.id).filter((id) => id !== 'c') : null);
    asked.length = 0;
    let n0 = steps();
    let done = await reviewModelSplit();
    const req = asked.find((r) => r.kind === 'ticks') || {};
    ok('the review asks with a tick per device that changes, all ticked', show((req.rows || []).map((r) => r.id)) === show(['a', 'b', 'c', 'k'])
       && (req.rows || []).every((r) => r.checked), show(req.rows));
    ok('its question, title and button', req.message === 'Split model and firmware for 4 devices?' && req.title === 'Split model and firmware' && req.ok === 'Apply split', `${req.message} ${req.title} ${req.ok}`);
    ok('each row shows the text and what it becomes', (req.rows || [])[1] && req.rows[1].label === 'SW-B'
       && req.rows[1].detail === '“Cisco C9200L / 17.9” → Vendor: Cisco · Model: C9200L · Firmware / OS: 17.9', req.rows && req.rows[1].detail);
    ok('the ones left as they are are named under the list', /^Left as it is: SW-G, BOX, SW-I\n/.test(req.after || ''), req.after);
    ok('only the ticked rows are written', done && done.length === 3 && getNode('a').model === 'C9200L-24P' && getNode('a').os === 'IOS-XE 17.9.4' && getNode('a').vendor === undefined
       && getNode('b').vendor === 'Cisco' && getNode('b').model === 'C9200L' && getNode('b').os === '17.9'
       && getNode('k').vendor === 'Aruba' && getNode('k').model === '2930F' && getNode('k').os === 'WC.16.11.0012', show(state.nodes.slice(0, 3)));
    ok('the unticked one stays as it is', getNode('c').os === 'HP LaserJet M404dn' && getNode('c').model === undefined && getNode('c').vendor === undefined);
    ok('in one undo step', steps() === n0 + 1, String(steps() - n0));
    ok('with a toast saying how many', toasts[toasts.length - 1] === 'Model and firmware split on 3 devices.', toasts[toasts.length - 1]);
    const sv = serializeDoc().nodes.find((n) => n.id === 'b');
    ok('saved as vendor, model, os', sv.vendor === 'Cisco' && sv.model === 'C9200L' && sv.os === '17.9');
    undo();
    ok('Undo restores the exact text', getNode('a').os === 'C9200L-24P / IOS-XE 17.9.4' && getNode('b').os === 'Cisco C9200L / 17.9' && getNode('k').os === 'Aruba 2930F, WC.16.11.0012'
       && !('model' in getNode('a')) && !('vendor' in getNode('b')) && !('model' in getNode('k')), show(getNode('k')));
    open();
    const v15 = JSON.stringify(serializeDoc().nodes);
    answer = null; n0 = steps();
    done = await reviewModelSplit();
    ok('dismissing writes nothing', done === null && steps() === n0 && JSON.stringify(serializeDoc().nodes) === v15);
    answer = [];
    done = await reviewModelSplit();
    ok('nothing ticked writes nothing', done === null && steps() === n0);
    // The question is open while the device changes: its row is not written.
    answer = (r) => { if (r.kind === 'ticks') { getNode('a').os = 'C9200L-48P / IOS-XE 17.9.5'; return r.rows.map((x) => x.id); } return null; };
    done = await reviewModelSplit();
    ok('a device changed while the question was open is not written', getNode('a').os === 'C9200L-48P / IOS-XE 17.9.5' && getNode('a').model === undefined
       && done.length === 3 && getNode('b').model === 'C9200L', show(getNode('a')));
    open({ v: 15, links: [], nodes: [dev('a', 'SW-A', 'C9200L-24P / IOS-XE 17.9.4')] });
    answer = (r) => { if (r.kind === 'ticks') { getNode('a').os = 'changed'; return ['a']; } return null; };
    toasts.length = 0;
    done = await reviewModelSplit();
    ok('and when that was every row, it says nothing was split', done.length === 0 && toasts[0] === 'Nothing was split: those devices changed while the question was open.', toasts[0]);
    open({ v: 15, links: [], nodes: [dev('a', 'SW-A', 'C9200L / 17.9'), dev('b', 'SW-B', 'C9300 / 17.6')] });
    answer = (r) => (r.kind === 'ticks' ? ['b'] : null);
    asked.length = 0;
    await reviewModelSplit();
    ok('one ticked of two: only that one', getNode('b').model === 'C9300' && getNode('a').model === undefined);
    open({ v: 15, links: [], nodes: [dev('a', 'SW-A', 'C9200L / 17.9')] });
    asked.length = 0; answer = (r) => (r.kind === 'ticks' ? ['a'] : null);
    await reviewModelSplit();
    ok('one device: the singular question', (asked.find((r) => r.kind === 'ticks') || {}).message === 'Split model and firmware for one device?');
    asked.length = 0;
    ok('nothing to split: no question at all', (await reviewModelSplit()) === null && !asked.length);
    replaceDocument({ v: DOC_VERSION + 1, links: [], nodes: [dev('a', 'SW-A', 'C9200L / 17.9')] }, { origin: 'file' });
    asked.length = 0;
    ok('a read-only network refuses, asking nothing', (await reviewModelSplit()) === null && !asked.length && getNode('a').model === undefined);
    ok('and applyModelSplit writes nothing there', applyModelSplit(planModelSplit().rows).length === 0 && getNode('a').model === undefined);

    // ---- 3. The real modal ----
    setDialogResponder(null);
    const p = askTicks('Pick?', { title: 'T', ok: 'Apply', after: 'Below', rows: [{ id: 'x', label: '<b>X</b>', detail: 'd1' }, { id: 'y', label: 'Y', checked: false }] });
    await tick();
    const boxes = [...document.querySelectorAll('#topoAskTicks input[type=checkbox]')];
    const applyBtn = [...document.querySelectorAll('#topoAskFoot button')].find((b) => b.textContent === 'Apply');
    ok('the modal draws a tick per row, as text', boxes.length === 2 && boxes[0].checked && !boxes[1].checked
       && el('topoAskTicks').querySelector('.ask-tick-name').textContent === '<b>X</b>' && !el('topoAskTicks').querySelector('b'));
    ok('with the line under it', !el('topoAskAfter').hidden && el('topoAskAfter').textContent === 'Below');
    boxes[0].click();
    ok('Apply is disabled with nothing ticked', applyBtn.disabled);
    boxes[1].click();
    ok('and enabled again with a tick', !applyBtn.disabled);
    applyBtn.click();
    ok('the answer is the ticked ids', show(await p) === '["y"]');
    const p2 = askTicks('Pick?', { rows: [{ id: 'x', label: 'X' }] });
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok('Esc answers null', (await p2) === null);
    const p3 = askConfirm('Sure?');
    await tick();
    ok('another question shows no ticks', el('topoAskTicks').hidden && el('topoAskAfter').hidden);
    [...document.querySelectorAll('#topoAskFoot button')].find((b) => b.textContent === 'Cancel').click();
    await p3;
    setDialogResponder((r) => { asked.push(r); return typeof answer === 'function' ? answer(r) : answer; });

    // ---- 4. The device editor ----
    open();
    select('a', 'node');
    const noteOn = () => !el('modelSplitNote').classList.contains('hidden');
    ok('a device whose Firmware / OS reads as a model shows the note', noteOn() && el('assetGroup').contains(el('modelSplitNote')));
    ok('the Split button says what it does', el('modelSplitBtn').title === 'Model: C9200L-24P · Firmware / OS: IOS-XE 17.9.4', el('modelSplitBtn').title);
    n0 = steps();
    el('modelSplitBtn').click();
    ok('Split applies that row in one undo step', getNode('a').model === 'C9200L-24P' && getNode('a').os === 'IOS-XE 17.9.4' && steps() === n0 + 1);
    ok('the fields show it and the note goes', el('propModel').value === 'C9200L-24P' && el('propOs').value === 'IOS-XE 17.9.4' && !noteOn(), [el('propModel').value, el('propOs').value, noteOn()].join('|'));
    undo();
    select('a', 'node');
    ok('Undo brings the text and the note back', getNode('a').os === 'C9200L-24P / IOS-XE 17.9.4' && el('propOs').value === 'C9200L-24P / IOS-XE 17.9.4' && noteOn());
    select('d', 'node');
    ok('firmware text shows no note', !noteOn());
    const typeInto = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
    typeInto(el('propOs'), 'Dell PowerEdge R740');
    ok('typing a model into Firmware / OS brings the note', noteOn());
    typeInto(el('propVendor'), 'Dell');
    ok('typing a vendor takes it away', !noteOn());
    commitTyping();
    select('h', 'node');
    ok('text it cannot read shows no note', !noteOn());
    replaceDocument({ v: DOC_VERSION + 1, links: [], nodes: [dev('a', 'SW-A', 'C9200L / 17.9')] }, { origin: 'file' });
    select('a', 'node');
    ok('a read-only network shows no note', !noteOn());

    // ---- 5. The Table toolbar ----
    open();
    setView('table'); showTableTab('devices');
    const btnOn = () => !el('tvSplitBtn').classList.contains('hidden');
    ok('the Devices tab offers Split model and firmware…', btnOn() && el('tvSplitBtn').textContent === 'Split model and firmware…');
    showTableTab('cables');
    ok('another tab does not', !btnOn());
    showTableTab('devices');
    answer = (r) => (r.kind === 'ticks' ? r.rows.map((x) => x.id) : null);
    asked.length = 0;
    el('tvSplitBtn').click();
    for (let i = 0; i < 5; i++) await tick();
    ok('the button opens the review and applies it', asked.some((r) => r.kind === 'ticks') && getNode('c').vendor === 'HP' && getNode('c').model === 'LaserJet M404dn' && getNode('c').os === '');
    renderTableView(true);
    ok('with nothing left to split it is not offered', !btnOn());
    const cell = el('tvGrid').querySelector('tbody tr[data-row="n:b"] td[data-col="model"]');
    ok('the table shows the split values', cell && cell.textContent === 'C9200L');
    replaceDocument({ v: DOC_VERSION + 1, links: [], nodes: [dev('a', 'SW-A', 'C9200L / 17.9')] }, { origin: 'file' });
    renderTableView(true);
    ok('nor on a read-only network', !btnOn());
    setView('map');

    // ---- 6. Words ----
    const { MESSAGES } = window.CarinoI18N;
    const keys = ['Model and firmware are in one field.', 'Split', 'Split model and firmware…', 'Split model and firmware',
      'Split model and firmware for one device?', 'Split model and firmware for {n} devices?', 'Left as it is', 'Apply split',
      'Nothing typed is lost: the words only move between the fields. One Undo takes all of it back.',
      'Model and firmware split on one device.', 'Model and firmware split on {n} devices.',
      'Move a model typed in Firmware / OS into the Vendor and Model fields, with a review first',
      'Nothing was split: those devices changed while the question was open.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const missing = keys.filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k);
      ok(`${loc} translates the split's words`, !missing.length, missing.join(' | '));
    });
    ok('Japanese says PC, never コンピューター', !keys.some((k) => /コンピューター/.test(MESSAGES.ja[k])));
    ok('Russian counts with "Устройств: {n}", no number agreement to get wrong', /Устройств: \{n\}/.test(MESSAGES.ru['Split model and firmware for {n} devices?'])
       && /Устройств: \{n\}/.test(MESSAGES.ru['Model and firmware split on {n} devices.']));
    open({ v: 15, links: [], nodes: [dev('a', 'SW-A', 'Cisco C9200L / 17.9'), dev('b', 'SW-B', 'my old box')] });
    setLocale('es');
    asked.length = 0; answer = null;
    await reviewModelSplit();
    const es = asked.find((r) => r.kind === 'ticks') || {};
    ok('the review in Spanish', es.message === '¿Separar modelo y firmware en un dispositivo?' && es.ok === 'Aplicar separación'
       && es.rows[0].detail === '“Cisco C9200L / 17.9” → Fabricante: Cisco · Modelo: C9200L · Firmware / SO: 17.9' && /^Se deja como está: SW-B\n/.test(es.after), show(es));
    select('a', 'node');
    applyStaticI18n();
    ok('the note in Spanish', el('modelSplitNote').textContent.trim() === 'El modelo y el firmware están en un solo campo. Separar', el('modelSplitNote').textContent);
    setLocale('en'); applyStaticI18n();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    window.showToast = heldToast;
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 50); });
