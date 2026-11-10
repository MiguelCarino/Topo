// The samples' two versions (js/data.js SIMPLE_SAMPLES, sampleItem and
// renderLibrary in js/app.js): every sample but the Full Showcase has a
// simple one, easy to read, and the full one, every feature.
//   1. the simple versions: the internet and its ISP, one box at the edge, a
//      switch per part of the site, each part its own named subnet (Smart
//      Home one, the rest more), one or two providers, between three and
//      fourteen devices, and none of groups, racks, Wi-Fi or dates; each
//      opens with no finding at all, not even an info note, but the simple
//      Common Errors, with exactly its two easy faults (an address two devices
//      share, a gateway nobody has);
//   2. the full ones carry the features (providers, dates, groups or Wi-Fi)
//      and are never the smaller;
//   3. the cards: Simple and Full on each, each saying how many devices it
//      opens with, each opening its version; the Full Showcase one card at
//      the end of the list, after the Examples; Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  try {
    state.settings.advanced = true; applyProfile();

    // ---- 1. The simple versions ----
    const keys = TEMPLATE_META.map((m) => m.key);
    const withSimple = keys.filter((k) => k !== 'showcase');
    const missing = withSimple.filter((k) => !templatesData[k + SIMPLE_SUFFIX]);
    ok('every sample but the Full Showcase has a simple version', !missing.length && withSimple.length >= 18 && !templatesData['showcase' + SIMPLE_SUFFIX], missing.join(','));
    const bad = [];
    let multi = 0, two = 0;
    withSimple.forEach((k) => {
      const doc = templatesData[k + SIMPLE_SUFFIX];
      if (!doc) return;
      replaceDocument(cloneData(doc), { origin: 'template' }); renderCanvasOnly();
      const devices = state.nodes.filter((n) => !['cloud', 'router', 'firewall', 'switch'].includes(n.type));
      const parts = SIMPLE_SAMPLES[k].parts.length;
      if (devices.length < 3 || devices.length > 14) bad.push(`${k}: ${devices.length} devices`);
      if ((state.groups || []).length || (state.wifi || []).length) bad.push(`${k}: groups or Wi-Fi`);
      if (state.nodes.some((n) => n.inService || n.serial || n.group)) bad.push(`${k}: register fields`);
      // A named subnet per part (the edge's WAN link is the other, unnamed).
      const named = state.networks.filter((x) => x.name).length;
      if (named !== parts || state.networks.length > parts + 1) bad.push(`${k}: ${named} named subnets for ${parts} parts`);
      if (state.nodes.filter((n) => n.type === 'switch').length !== parts) bad.push(`${k}: a switch per part`);
      const pv = (state.providers || []).length;
      if (pv < 1 || pv > 2 || !(getNode('s_net').providers || []).length) bad.push(`${k}: ${pv} providers`);
      if (parts > 1) multi++;
      if (pv === 2) two++;
      const fs = topologyFindings();
      if (k === 'errors') {
        const kinds = [...new Set(fs.map((f) => f.key))].sort().join();
        if (kinds !== 'gateway,ip-conflict') bad.push(`errors: ${fs.map((f) => `${f.key} ${f.subject}`).join(' / ')}`);
      } else if (fs.length) bad.push(`${k}: ${fs.map((f) => `${f.key} ${f.subject}`).join(' / ')}`);
    });
    ok('each is easy to read, and opens clean (Common Errors with its two faults)', !bad.length, bad.slice(0, 4).join(' | '));
    ok('Smart Home is one subnet, most of the others more, and most name a second provider',
       SIMPLE_SAMPLES.house.parts.length === 1 && multi >= 12 && two >= 12, `${multi} with several subnets, ${two} with two providers`);

    // ---- 2. The full versions ----
    const teach = ['errors', 'military', 'offlineLean', 'offlineBalanced', 'offlineExtended'];
    const featured = keys.filter((k) => !teach.includes(k)).filter((k) => {
      const d = templatesData[k];
      return !((d.providers || []).length && d.nodes.some((n) => n.inService) && ((d.groups || []).length || (d.wifi || []).length || d.nodes.length >= 8));
    });
    ok('the full ones carry providers, dates and groups or Wi-Fi', !featured.length, featured.join(','));
    const smaller = withSimple.filter((k) => !teach.includes(k) && !(templatesData[k].nodes.length >= templatesData[k + SIMPLE_SUFFIX].nodes.length));
    ok('and are never the smaller', !smaller.length, smaller.join(','));

    // ---- 3. The cards ----
    renderLibrary();
    const card = (key) => document.querySelector(`#tabPanel-templates .tpl-item[data-sample="${key}"]`);
    const house = card('house');
    const btns = house ? [...house.querySelectorAll('.tpl-btn')] : [];
    ok('a card has Simple and Full, each with its device count', btns.map((b) => b.dataset.version).join() === 'simple,full'
       && btns[0].textContent.includes(String(templatesData.house_simple.nodes.length)) && btns[1].textContent.includes(String(templatesData.house.nodes.length)),
       btns.map((b) => b.textContent).join(' | '));
    ok('on every sample but the Full Showcase', withSimple.every((k) => card(k) && card(k).querySelectorAll('.tpl-btn').length === 2));
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    card('retail').querySelector('[data-version="simple"]').click();
    for (let i = 0; i < 20 && !getNode('s_net'); i++) await tick();
    ok('Simple opens the simple version', !!getNode('s_net') && state.nodes.length === templatesData.retail_simple.nodes.length);
    card('retail').querySelector('[data-version="full"]').click();
    for (let i = 0; i < 20 && !getNode('r1'); i++) await tick();
    ok('Full opens the full one', !!getNode('r1') && state.nodes.length === templatesData.retail.nodes.length);
    const lastRows = [...el('lastTemplateList').querySelectorAll('.lib-item')];
    const allRows = [...el('tabPanel-templates').querySelectorAll('#templateList .lib-item, #exampleTemplateList .lib-item, #lastTemplateList .lib-item')];
    ok('the Full Showcase is one card, at the end, after the Examples', lastRows.length === 1 && lastRows[0].textContent.includes('Full Showcase') && !lastRows[0].querySelector('.tpl-btn')
       && allRows[allRows.length - 1] === lastRows[0] && !el('exampleTemplateList').textContent.includes('Full Showcase')
       && !!(el('exampleTemplates').compareDocumentPosition(el('lastTemplateList')) & Node.DOCUMENT_POSITION_FOLLOWING));
    setLocale('es'); applyLocale();
    const es = card('house');
    ok('es: the buttons', !!es && es.querySelector('[data-version="simple"] b').textContent === 'Simple' && es.querySelector('[data-version="full"] b').textContent === 'Completo'
       && /versión sencilla/.test(es.querySelector('[data-version="simple"]').title), es && es.textContent);
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
