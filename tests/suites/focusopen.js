// Opening without a keyboard (Mobile review M17; js/dialog.js holdKeyboard,
// raisesKeyboard, focusForTyping, typingTarget). A dialog or a card that opens
// with its text field focused raises a touch screen's keyboard before anyone
// has read it, so on a coarse pointer the focus goes to the dialog's card and
// the field waits for a tap. This headless page has a mouse's fine pointer,
// so the touch branch is reached by stubbing window.matchMedia (touchfocus
// checks the same on a real touch screen). The suite holds:
//   1. this runner is not held (a fine pointer);
//   2. raisesKeyboard's classification: text-like inputs, a textarea and a
//      contenteditable raise a keyboard; a read-only or disabled field, a
//      tick, a date, a select and a button do not;
//   3. with a mouse, nothing changed: the report focuses Site, Save search
//      focuses and selects its name and gives the focus back to the search
//      box, unlock focuses the passphrase, Paste focuses its box, and a
//      subnet card's Edit focuses its name;
//   4. with a coarse pointer, the report focuses its card; a prompt shows its
//      text and leaves the focus on a button; unlock focuses its form; Save
//      search keeps the focus off its name and returns it to the Saved
//      button; a field that already has the focus keeps it and is selected;
//      reveal scrolls the field into view; typingTarget falls back.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const active = () => document.activeElement;
  // A transition that has not run to its end leaves its element hidden, and a
  // hidden element cannot take the focus: in a page whose clock is held (a
  // background tab) the search box would stay so. Each is ended first.
  const still = () => document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* an endless one */ } });
  const who = (e) => (e ? (e.id || e.className || e.tagName) : 'none');
  const heldResponder = setDialogResponder(null);
  const realMatchMedia = window.matchMedia;
  // A coarse pointer, as a phone reports it; every other query answers no.
  const coarse = () => {
    window.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q), media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  };
  const fine = () => { window.matchMedia = realMatchMedia; };

  const D = (id, x, ip) => ({ id, type: 'pc', name: 'PC ' + id.toUpperCase(), x, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const doc = { v: DOC_VERSION, nodes: [D('a', 0, '10.0.0.11/24'), D('b', 220, '10.0.0.12/24')], links: [], annotations: [],
    networks: [{ id: 'n_lan', name: 'LAN', cidr: '10.0.0.0/24' }] };

  try {
    replaceDocument(doc, { origin: 'file', docId: 'focus-open' });
    setView('map'); setQuery('');
    await tick();

    // ---- 1 ----
    ok('this runner has a fine pointer, so nothing is held', holdKeyboard() === false);

    // ---- 2. raisesKeyboard ----
    const make = (tag, attrs = {}) => { const e = document.createElement(tag); Object.assign(e, attrs); return e; };
    const yes = ['text', 'search', 'password', 'email', 'url', 'tel', 'number'].map((type) => make('input', { type }));
    ok('text, search, password, email, url, tel and number inputs raise a keyboard', yes.every(raisesKeyboard), yes.filter((e) => !raisesKeyboard(e)).map((e) => e.type).join(','));
    ok('so does a textarea', raisesKeyboard(make('textarea')));
    const ce = make('div'); ce.contentEditable = 'true'; document.body.appendChild(ce);
    ok('and a contenteditable', raisesKeyboard(ce));
    ce.remove();
    const no = [make('textarea', { readOnly: true }), make('input', { type: 'text', disabled: true }), make('input', { type: 'checkbox' }),
      make('input', { type: 'date' }), make('select'), make('button')];
    ok('a read-only textarea, a disabled field, a tick, a date, a select and a button do not', no.every((e) => !raisesKeyboard(e)),
      no.filter(raisesKeyboard).map((e) => e.tagName + ':' + e.type).join(','));
    ok('nor does nothing', raisesKeyboard(null) === false);

    // ---- 3. With a mouse, unchanged ----
    openReportDialog('site');
    ok('the report focuses Site', active() === el('report-site'), who(active()));
    closeReportDialog();

    // A query, so the name it suggests has text to select.
    setQuery('PC');
    el('querySaveBtn').focus();
    openSearchDialog();
    const sq = el('sqName');
    ok('the dialog suggests a name', sq.value.length > 0, JSON.stringify(sq.value));
    ok('Save search focuses its name', active() === sq, who(active()));
    ok('with all of it selected', sq.selectionStart === 0 && sq.selectionEnd === sq.value.length, `${sq.selectionStart}-${sq.selectionEnd}/${sq.value.length}`);
    still(); closeSearchDialog();
    ok('closing gives the focus back to the search box', active() === el('queryInput'), who(active()));

    askPassphrase();
    ok('unlock focuses the passphrase', active() === el('unlockPass'), who(active()));
    _answerUnlock(null); closeUnlockDialog();

    setView('table'); await tick();
    openPasteColumn();
    ok('Paste focuses its box', active() === el('pasteText'), who(active()));
    closePasteColumn();
    setView('map'); await tick();

    showConfigTab('networks');
    const card = () => document.querySelector('#networkList .net-card[data-net="n_lan"]');
    ok('the Subnets tab has the card', !!card());
    if (card()) {
      card().querySelector('[data-act="edit"]').click();
      const nameField = card().querySelector('[data-field="name"]');
      ok('a subnet card\'s Edit focuses its name', !!nameField && active() === nameField, who(active()));
      card().querySelector('[data-act="edit"]').click();   // closed again
    }

    // ---- 4. With a coarse pointer ----
    try {
      coarse();
      ok('the stub reads as a coarse pointer', holdKeyboard() === true);

      openReportDialog('site');
      const rp = el('reportDialog').querySelector('.rpv');
      ok('the report focuses its card, not Site', active() === rp && rp.getAttribute('tabindex') === '-1', who(active()));
      ok('so nothing that raises a keyboard has the focus', !raisesKeyboard(active()));
      closeReportDialog();

      let p = askPrompt('Name:', { value: 'Torre A' });
      await tick();
      const input = el('topoAskInput');
      ok('a prompt still shows its field, with the text', !input.hidden && input.value === 'Torre A', `${input.hidden} ${input.value}`);
      ok('but the focus is on one of its buttons', active() && active().tagName === 'BUTTON' && !!active().closest('.topo-ask') && active() !== input, who(active()));
      const cancel = [...document.querySelectorAll('#topoAskFoot button')].find((b) => b.textContent === t('Cancel'));
      if (cancel) cancel.click();
      ok('and Cancel still answers null', (await p) === null);

      askPassphrase();
      ok('unlock focuses its form, not the passphrase', active() === el('unlockForm'), who(active()));
      _answerUnlock(null); closeUnlockDialog();

      el('querySaveBtn').focus();
      openSearchDialog();
      const box = el('searchDialog').querySelector('.modal');
      ok('Save search keeps the focus off its name', active() !== el('sqName') && box.contains(active()) && !raisesKeyboard(active()), who(active()));
      // A field the visitor tapped into keeps the focus, and is selected.
      sq.focus();
      sq.setSelectionRange(0, 0);
      ok('a field that has the focus keeps it', focusForTyping(sq, box, { select: true }) === true && active() === sq, who(active()));
      ok('and is selected as asked', sq.selectionStart === 0 && sq.selectionEnd === sq.value.length, `${sq.selectionStart}-${sq.selectionEnd}`);
      still(); closeSearchDialog();
      ok('closing goes back to the ☆, not the search box', active() === el('querySaveBtn'), who(active()));

      // reveal stands in for the scroll a focus would have made.
      const field = make('input', { type: 'text' });
      document.body.appendChild(field);
      let scrolled = 0;
      field.scrollIntoView = () => { scrolled++; };
      still(); el('querySaveBtn').focus();
      ok('a held field is not focused', focusForTyping(field, null, { reveal: true }) === false && active() !== field);
      ok('reveal scrolls it into view instead', scrolled === 1, String(scrolled));
      ok('and with no box the focus stays where it was', active() === el('querySaveBtn'), who(active()));
      const tickBox = make('input', { type: 'checkbox' });
      ok('typingTarget falls back for a text field', typingTarget(field, tickBox) === tickBox);
      ok('and keeps a field that raises no keyboard', typingTarget(tickBox, field) === tickBox);
      field.remove();
    } finally {
      fine();
    }
    ok('the stub is gone again', holdKeyboard() === false);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.matchMedia = realMatchMedia;
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
