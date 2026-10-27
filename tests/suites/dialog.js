// The page's own questions (js/dialog.js), which replaced every native
// alert / confirm / prompt. Every other suite answers them through
// setDialogResponder(), so this is the one place the real modal is driven:
// opened, clicked, typed into, dismissed and queued, without the stand-in.
//
// And the rule the replacement exists for, checked in the source: no native
// dialog is left in js/. One would block the whole tab, speak the browser's
// language instead of the page's, and hang a headless run outright.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const scrim = document.getElementById('topoAsk');
  const isOpen = () => !scrim.hidden;
  const buttons = () => [...document.querySelectorAll('#topoAskFoot button')];
  const press = (label) => { const b = buttons().find((x) => x.textContent === label); if (b) b.click(); return !!b; };
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  // A native dialog that slipped through would hang the run, so it is counted
  // instead: none of the calls below may reach one.
  const realAlert = window.alert, realConfirm = window.confirm, realPrompt = window.prompt;
  let natives = 0;
  window.alert = () => { natives++; }; window.confirm = () => { natives++; return false; }; window.prompt = () => { natives++; return null; };
  const heldResponder = setDialogResponder(null);

  try {
    // ---- A yes/no question ----
    ok('nothing is open before anything is asked', !isOpen());
    let p = askConfirm('Delete it?', { ok: 'Delete', danger: true, title: 'Delete' });
    await tick();
    ok('a question opens the modal', isOpen());
    ok('with its message and title', document.getElementById('topoAskMsg').textContent === 'Delete it?'
       && document.getElementById('topoAskTitle').textContent === 'Delete' && !document.getElementById('topoAskHead').hidden);
    ok('Cancel first, the named answer last', buttons().map((b) => b.textContent).join('|') === 'Cancel|Delete',
       buttons().map((b) => b.textContent).join('|'));
    ok('a destructive answer is marked as one', buttons()[1].classList.contains('ask-danger'));
    ok('the focus waits on Cancel, so a stray Enter is the cautious answer', document.activeElement === buttons()[0],
       document.activeElement && document.activeElement.textContent);
    ok('the text input stays hidden for a question', document.getElementById('topoAskInput').hidden);
    press('Delete');
    ok('answering yes resolves true', (await p) === true);
    ok('and closes the modal', !isOpen());

    p = askConfirm('Replace it?');
    await tick();
    ok('a question with no named answer still has one', buttons().map((b) => b.textContent).join('|') === 'Cancel|Continue',
       buttons().map((b) => b.textContent).join('|'));
    ok('and no title bar when none is given', document.getElementById('topoAskHead').hidden);
    esc();
    ok('Esc is the cautious answer: false', (await p) === false && !isOpen());

    p = askConfirm('Replace it?');
    await tick();
    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('so is a click on the scrim', (await p) === false && !isOpen());

    // ---- A line of text ----
    p = askPrompt('Name this network:', { value: 'Torre A', ok: 'Keep' });
    await tick();
    const input = document.getElementById('topoAskInput');
    ok('a prompt shows the input, filled in and selected for retyping', !input.hidden && input.value === 'Torre A'
       && document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === 7);
    input.value = 'Torre B';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok('Enter answers with what was typed', (await p) === 'Torre B' && !isOpen());

    p = askPrompt('Name this network:');
    await tick();
    press('Continue');
    ok('an empty answer is "", not "no"', (await p) === '');
    p = askPrompt('Name this network:', { value: 'x' });
    await tick();
    press('Cancel');
    ok('Cancel is null', (await p) === null);

    // ---- One of several answers ----
    p = askChoice('You already have "Casa".', { choices: [{ id: 'copy', label: 'Open as a copy' }, { id: 'update', label: 'Update "Casa" (2 changes)', primary: true }] });
    await tick();
    ok('a choice lists Cancel and then each answer', buttons().map((b) => b.textContent).join('|') === 'Cancel|Open as a copy|Update "Casa" (2 changes)',
       buttons().map((b) => b.textContent).join('|'));
    ok('the primary answer looks like one', buttons()[2].classList.contains('btn-primary') && !buttons()[1].classList.contains('btn-primary'));
    press('Update "Casa" (2 changes)');
    ok('and the answer is its id', (await p) === 'update');
    p = askChoice('You already have "Casa".', { choices: [{ id: 'copy', label: 'Open as a copy' }] });
    await tick();
    esc();
    ok('dismissing a choice chooses nothing', (await p) === null);

    // ---- A notice ----
    p = tell('Something happened.');
    await tick();
    ok('a notice has its one button, focused', buttons().length === 1 && buttons()[0].textContent === 'Got it' && document.activeElement === buttons()[0]);
    press('Got it');
    ok('and resolves once read', (await p) === undefined && !isOpen());

    // ---- Questions queue ----
    const first = askConfirm('First?', { ok: 'Yes' });
    const second = askConfirm('Second?', { ok: 'Yes' });
    await tick();
    ok('a second question waits for the first', document.getElementById('topoAskMsg').textContent === 'First?');
    press('Yes');
    ok('the first gets its own answer', (await first) === true);
    await tick();
    ok('then the second is asked', isOpen() && document.getElementById('topoAskMsg').textContent === 'Second?');
    press('Cancel');
    ok('and gets its own', (await second) === false);

    // ---- In the page's language ----
    setLocale('es'); applyLocale();
    p = askConfirm('¿Reemplazar?');
    await tick();
    ok('the buttons speak the page’s language, not the browser’s',
       buttons().map((b) => b.textContent).join('|') === 'Cancelar|Continuar', buttons().map((b) => b.textContent).join('|'));
    press('Cancelar'); await p;
    p = tell('Algo pasó.');
    await tick();
    ok('a notice too, and not as the diagnostics’ "OK"', buttons()[0].textContent === 'Entendido', buttons()[0].textContent);
    press('Entendido'); await p;
    setLocale('ja'); applyLocale();
    p = tell('x'); await tick();
    ok('Japanese does not say 正常 on a notice', buttons()[0].textContent === '了解', buttons()[0].textContent);
    buttons()[0].click(); await p;
    setLocale('en'); applyLocale();

    // ---- A real flow through it: Delete on a card ----
    const heldLib = CarinoLibrary.loadLibrary();
    CarinoLibrary.persistLibrary({});
    loadDocState(templatesData.house);
    const id = librarySave('Casa');
    openLanding(false);
    const del = document.querySelector(`#landing .landing-card[data-id="${id}"] .landing-tool[aria-label^="Delete"]`);
    del.click();
    await tick();
    ok('Delete on a card asks in the page', isOpen() && /Casa/.test(document.getElementById('topoAskMsg').textContent));
    press('Cancel'); await tick();
    ok('Cancel keeps the card', !!CarinoLibrary.loadLibrary()[id]);
    del.click(); await tick();
    press('Delete'); await tick(); await tick();
    ok('Delete removes it', !CarinoLibrary.loadLibrary()[id]);
    closeLanding();
    CarinoLibrary.persistLibrary(heldLib);
    ok('no native dialog was raised along the way', natives === 0, String(natives));

    // ---- None left in the source ----
    // Comments are stripped first: several explain why there is no alert()
    // here, and those are not calls.
    const files = ['app', 'library', 'share', 'report', 'ui', 'mobile', 'model', 'data', 'diagnostics', 'state', 'i18n', 'dialog', 'oui'];
    const offenders = [];
    for (const f of files) {
      const src = await (await fetch(`js/${f}.js`)).text();
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
      const hit = code.match(/(^|[^.\w$])(alert|confirm|prompt)\s*\(/gm);
      if (hit) offenders.push(`${f}.js: ${hit.length}`);
    }
    ok('no native alert, confirm or prompt is left in js/', offenders.length === 0, offenders.join(', '));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    window.alert = realAlert; window.confirm = realConfirm; window.prompt = realPrompt;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
