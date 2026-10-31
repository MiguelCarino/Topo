// Every field a person can type into or pick from has a name a screen reader
// can say, so a placeholder ("eth0", "CIDR", "e.g. 10.0.0.1") is never the
// only thing telling anyone what the field is: it goes the moment something
// is typed, and it is not a name to begin with.
//   1. the editor's captions are tied to their fields (<label for>), and the
//      fields built in code (interfaces, MACs, bond members, the port count)
//      carry an aria-label, which follows a rename of the interface;
//   2. a sweep over the editor, for a router, a switch, a cloud and a cable,
//      finds every visible field named and every visible button saying what
//      it does in words (or a port's number), an aria-label or a title: a
//      button that is only an emoji or a symbol says nothing;
//   3. the passphrase and link fields of the share and unlock dialogs, and the
//      line a prompt asks for, are named;
//   4. the names follow the language.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 30));
  // The accessible name, in the order a browser looks for one: what
  // aria-labelledby points at, then aria-label, then the field's <label>s,
  // then its title. Never the placeholder.
  const accName = (node) => {
    if (!node) return '';
    const by = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map((id) => (el(id) ? el(id).textContent : '')).join(' ').trim();
    if (by) return by;
    const aria = (node.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labels = [...(node.labels || [])].map((l) => l.textContent).join(' ').trim();
    if (labels) return labels;
    return (node.getAttribute('title') || '').trim();
  };
  // Shown, and not taken out of the accessibility tree on purpose: the
  // calendar's native date input sits under its field aria-hidden, since the
  // field and its button are what a person uses.
  const shown = (node) => node.getClientRects().length > 0 && !node.closest('[aria-hidden="true"]');
  const unnamedFields = (root) => [...root.querySelectorAll('input, select, textarea')]
    .filter((f) => f.type !== 'hidden' && shown(f) && !accName(f))
    .map((f) => f.id || f.className || f.tagName.toLowerCase());
  const wordlessButtons = (root) => [...root.querySelectorAll('button')]
    .filter((b) => shown(b) && !/[\p{L}\p{N}]/u.test(b.textContent) && !(b.getAttribute('aria-label') || '').trim() && !(b.getAttribute('title') || '').trim())
    .map((b) => b.id || b.className || b.textContent);
  const savedProfile = state.settings.profile, savedAdvanced = state.settings.advanced;
  try {
    state.settings.advanced = true; applyProfile();
    replaceDocument({
      v: DOC_VERSION,
      nodes: [
        { id: 'r', type: 'router', name: 'Router', x: 100, y: 100, interfaces: [
          { id: 'i0', name: 'eth0', ip: '' },
          { id: 'i1', name: 'eth1', ip: '10.0.0.1/24', mac: '00:11:22:33:44:55' }
        ] },
        { id: 's', type: 'switch', name: 'Switch', x: 300, y: 100, portCount: 8, interfaces: [] },
        { id: 'c', type: 'cloud', name: 'Internet', x: 100, y: 300, interfaces: [] }
      ],
      links: [{ id: 'a', source: 'r', target: 's', attachment: 'bridged' }],
      annotations: [], groups: []
    }, { origin: 'file' });

    // ---- 1. Captions and built fields ----
    select('r', 'node');
    ok('the name field is named', accName(el('propName')) === t('Name'), accName(el('propName')));
    ok('the gateway field is named', !!accName(el('propGw')), accName(el('propGw')));
    ok('the DNS field is named', !!accName(el('propDns')), accName(el('propDns')));
    const ifaces = el('ifaceListContainer');
    const ifaceUnnamed = unnamedFields(ifaces);
    ok('every interface field is named', ifaceUnnamed.length === 0, ifaceUnnamed.join(', '));
    const ip0 = ifaces.querySelector('.if-row .if-ip');
    ok("eth0's address field says it is an address", !!ip0 && accName(ip0).includes(t('Address')), ip0 && accName(ip0));
    ok("eth0's address field says whose", !!ip0 && accName(ip0).includes('eth0'), ip0 && accName(ip0));
    ok('the MAC field is named', [...ifaces.querySelectorAll('.if-mac input')].some((f) => /MAC/.test(accName(f)) && accName(f).includes('eth1')));
    // A rename renames both fields named after the interface, with no rebuild.
    const eth1 = [...ifaces.querySelectorAll('.if-name')].find((f) => f.value === 'eth1');
    const eth1Ip = eth1 && eth1.parentElement.querySelector('.if-ip');
    const macs = () => [...ifaces.querySelectorAll('.if-mac input')].map(accName);
    if (eth1) { eth1.value = 'wan'; eth1.dispatchEvent(new Event('input', { bubbles: true })); }
    ok('renaming eth1 renames its address field and its MAC field alike', !!eth1Ip && accName(eth1Ip).includes('wan')
       && macs().some((n) => /MAC/.test(n) && n.includes('wan')) && !macs().some((n) => n.includes('eth1')),
       `${eth1Ip && accName(eth1Ip)} / ${macs().join(' | ')}`);

    select('s', 'node');
    ok("the switch's port count is named", accName(el('portCountInput')) === t('Ports'), accName(el('portCountInput')));

    select('a', 'link');
    ok("the cable's material is named", !!accName(el('propMedium')), accName(el('propMedium')));
    ok("the cable's attachment is named", !!accName(el('propAttachment')), accName(el('propAttachment')));

    select('c', 'node');
    ok("the cloud's other-site pick is named", !!accName(el('propSiteRef')), accName(el('propSiteRef')));

    // ---- 2. The sweep ----
    for (const [id, type, what] of [['r', 'node', 'router'], ['s', 'node', 'switch'], ['c', 'node', 'cloud'], ['a', 'link', 'cable']]) {
      select(id, type);
      const pane = el('propertiesPane');
      const fields = unnamedFields(pane), buttons = wordlessButtons(pane);
      ok(`every visible field is named (${what})`, fields.length === 0, fields.join(', '));
      ok(`every visible button says what it does (${what})`, buttons.length === 0, buttons.join(', '));
    }
    select(null);

    // ---- 3. Dialogs ----
    openShareDialog('doc');
    ok('the share passphrase is named', accName(el('sharePass')) === 'Passphrase', accName(el('sharePass')));
    ok('the share link is named', accName(el('shareLink')) === 'Link to share', accName(el('shareLink')));
    closeShareDialog();

    askPassphrase();
    ok('the unlock passphrase is named', accName(el('unlockPass')) === 'Passphrase', accName(el('unlockPass')));
    abandonUnlock();

    const p = askPrompt('Name the closet', '');
    await tick();
    ok("a prompt's line is named by its question", accName(el('topoAskInput')) === 'Name the closet', accName(el('topoAskInput')));
    const cancel = [...document.querySelectorAll('#topoAskFoot button')].find((b) => b.textContent === t('Cancel'));
    if (cancel) cancel.click();
    ok('the prompt was dismissed', (await p) === null);

    // ---- 4. In Spanish ----
    setLocale('es'); applyLocale();
    openShareDialog('doc');
    const passEs = accName(el('sharePass'));
    ok('the passphrase name is translated', passEs === t('Passphrase') && passEs !== 'Passphrase', passEs);
    closeShareDialog();
    select('r', 'node');
    ok('the name field is named in Spanish', accName(el('propName')) === 'Nombre', accName(el('propName')));
    select(null);
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && (e.stack || e.message) || e));
  }
  setLocale('en'); applyLocale();
  state.settings.profile = savedProfile; state.settings.advanced = savedAdvanced; applyProfile();
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
