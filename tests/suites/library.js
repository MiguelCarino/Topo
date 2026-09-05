// The library is the first thing in Topo that keeps something after the tab
// closes, so the assertions that matter here are the ones about not losing or
// mixing up a customer's work: that a saved network comes back byte-identical,
// that saving twice updates one card instead of breeding two, that summarising a
// stored network cannot leave the editor holding it, and that a card cannot
// inject markup through a site name.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // Dialogs would hang a headless run, and every answer here is part of the
  // assertion anyway — "the user said yes" is a precondition, not a result.
  // Assertions whose answer only arrives from a promise; drained at the end.
  const late = [];
  const realConfirm = window.confirm, realAlert = window.alert, realPrompt = window.prompt;
  let answer = true, prompted = null, promptWith = 'Torre B';
  window.confirm = () => answer;
  window.alert = () => {};
  window.prompt = (msg, def) => { prompted = { msg, def }; return promptWith; };

  // The suite writes to the real store, so hold whatever was there and put it
  // back at the end — a test run must not eat the tester's saved networks.
  const heldStore = localStorage.getItem(LIBRARY_KEY);
  const heldHash = window.location.hash;
  localStorage.removeItem(LIBRARY_KEY);

  // ---- Nothing of the editor shows before boot has decided ----
  // The editor used to paint in full — toolbar, sidebar, empty canvas — and the
  // landing dropped over it a beat later, which on a slow machine was more than
  // a second of Undo and Export offering to act on a document nobody had
  // chosen. The guard is a class in the static markup, so both halves have to
  // hold: it must be in the file that ships, and boot must take it off again.
  ok('the editor has already been revealed by the time a suite runs',
     !document.body.classList.contains('chrome-pending'));
  fetch('index.html').then((r) => r.text()).then((html) => {
    const body = (html.match(/<body[^>]*>/) || [''])[0];
    late.push(['the markup ships with the editor hidden', /\bchrome-pending\b/.test(body), body.slice(0, 80)]);
  }).catch(() => late.push(['the markup ships with the editor hidden', false, 'could not read index.html']));

  // ---- The store round-trips the document ----
  loadTemplateState(templatesData.hospital); autoBindLinks(); renderCanvasOnly();
  const expected = JSON.stringify(serializeDoc());
  const idA = librarySave('Hospital San José — Torre A');
  ok('saving returns an id', !!idA, String(idA));
  ok('the stored document is the one the canvas serializes',
     JSON.stringify(loadLibrary()[idA].doc) === expected);
  ok('and it is the same payload a shared link would carry',
     JSON.stringify(loadLibrary()[idA].doc) === JSON.stringify(serializeDoc()));

  // Saving again with the id is the "Save" button on an open card: one entry,
  // not "Torre A (2)". This is the assertion that stops a week of surveys
  // turning into forty near-identical cards.
  spawnNode('pc');
  const idA2 = librarySave('Hospital San José — Torre A', idA);
  ok('saving an open card updates it in place', idA2 === idA && Object.keys(loadLibrary()).length === 1,
     `${Object.keys(loadLibrary()).length} entries`);
  ok('and the update carries the new document',
     loadLibrary()[idA].doc.nodes.length === state.nodes.length,
     `${loadLibrary()[idA].doc.nodes.length} vs ${state.nodes.length}`);
  ok('while created is kept and updated moves',
     loadLibrary()[idA].created <= loadLibrary()[idA].updated);

  // Saving without an id is a different network, even under the same name.
  const idB = librarySave('Hospital San José — Torre A');
  ok('saving without an id makes a second entry', idB !== idA && Object.keys(loadLibrary()).length === 2);
  ok('deleting removes only that one', libraryDelete(idB) && Object.keys(loadLibrary()).length === 1);
  ok('deleting something absent is a no-op, not a throw', libraryDelete('nope') === false);

  const beforeRename = loadLibrary()[idA].updated;
  ok('renaming keeps the document', libraryRename(idA, 'Torre A — planta baja')
     && loadLibrary()[idA].name === 'Torre A — planta baja'
     && loadLibrary()[idA].doc.nodes.length === state.nodes.length);
  ok('renaming ages the entry, because the entry changed',
     loadLibrary()[idA].updated > beforeRename, `${loadLibrary()[idA].updated} vs ${beforeRename}`);
  ok('an empty new name is refused rather than blanking the card',
     libraryRename(idA, '   ') && loadLibrary()[idA].name === 'Torre A — planta baja');
  // Two saves in the same millisecond must still be ordered, or the newest card
  // is whichever one the sort happened to pick.
  const t1 = librarySave('Tick', idA) && loadLibrary()[idA].updated;
  const t2 = librarySave('Tick', idA) && loadLibrary()[idA].updated;
  ok('two saves in the same tick still order', t2 > t1, `${t1} then ${t2}`);

  // ---- Ordering and bad data ----
  const lib = loadLibrary();
  lib.older = { id: 'older', name: 'Older', doc: { nodes: [], links: [] }, created: 1, updated: 1 };
  lib.broken = { id: 'broken', name: 'Broken', doc: null, created: 2, updated: 2 };
  persistLibrary(lib);
  const entries = libraryEntries();
  ok('the most recently touched network is first', entries[0].id === idA, entries.map((e) => e.id).join(','));
  ok('an entry whose document did not survive is not offered',
     !entries.some((e) => e.id === 'broken'), entries.map((e) => e.id).join(','));

  localStorage.setItem(LIBRARY_KEY, '["not", "an", "object"]');
  ok('a store of the wrong shape reads as empty, not as a crash',
     Object.keys(loadLibrary()).length === 0);
  localStorage.setItem(LIBRARY_KEY, '{oh no');
  ok('and so does unparseable JSON', Object.keys(loadLibrary()).length === 0);

  // ---- Summarising a document that is not on screen ----
  // The card claims a device count and a finding count for a network the editor
  // is not holding. If withDoc() leaked, the editor would be showing one
  // network and the diagnostics panel would be describing another.
  localStorage.removeItem(LIBRARY_KEY);
  loadTemplateState(templatesData.errors); autoBindLinks(); renderCanvasOnly();
  const onCanvas = {
    nodes: state.nodes.length,
    doc: JSON.stringify(serializeDoc()),
    critical: topologyFindings().filter((f) => f.level === 'bad').length,
    advisory: topologyFindings().filter((f) => f.level === 'warn').length
  };
  const summary = librarySummary(templatesData.hospital);
  ok('the editor still holds its own document afterwards',
     JSON.stringify(serializeDoc()) === onCanvas.doc && state.nodes.length === onCanvas.nodes,
     `${state.nodes.length} vs ${onCanvas.nodes}`);
  ok('its findings are unchanged too',
     topologyFindings().filter((f) => f.level === 'bad').length === onCanvas.critical);
  // A throwing check must not strand the editor holding the stored network —
  // the restore is in a finally, and this is the assertion that proves it.
  let threw = false;
  try { withDoc(templatesData.hospital, () => { throw new Error('boom'); }); } catch (e) { threw = true; }
  ok('a check that throws still hands the editor back its document',
     threw && JSON.stringify(serializeDoc()) === onCanvas.doc);

  // The counts on a card have to be the counts the panel would show, because a
  // card that under-reports is a survey someone thinks is finished.
  loadTemplateState(templatesData.hospital); autoBindLinks(); renderCanvasOnly();
  const live = topologyFindings();
  ok('a card counts the devices the canvas would', summary.devices === state.nodes.length,
     `${summary.devices} vs ${state.nodes.length}`);
  ok('a card counts the subnets the report would', summary.subnets === reportSubnets().length,
     `${summary.subnets} vs ${reportSubnets().length}`);
  ok('and the findings the Diagnostics panel would',
     summary.critical === live.filter((f) => f.level === 'bad').length
     && summary.advisory === live.filter((f) => f.level === 'warn').length,
     `${summary.critical}/${summary.advisory}`);
  const broken = librarySummary({ nodes: 'not an array' });
  ok('an unreadable document is marked, not silently reported as clean', broken.unreadable === true);

  // ---- The landing ----
  localStorage.removeItem(LIBRARY_KEY);
  openLanding(false);
  ok('with nothing saved the landing says so',
     !document.getElementById('landingEmpty').classList.contains('hidden')
     && document.getElementById('landingSaved').classList.contains('hidden'));

  loadTemplateState(templatesData.errors); autoBindLinks();
  const idBad = librarySave('Bodega Sur');
  loadTemplateState(templatesData.house); autoBindLinks();
  const idOk = librarySave('<img src=x onerror=alert(1)>');
  renderLanding();
  const cards = document.querySelectorAll('#landing .landing-card');
  ok('one card per saved network', cards.length === 2, String(cards.length));
  ok('the empty note steps aside once there is something to show',
     document.getElementById('landingEmpty').classList.contains('hidden')
     && !document.getElementById('landingSaved').classList.contains('hidden'));

  // A site name is customer-supplied text on a page the customer is looking at.
  // Asserted on the element rather than on the payload firing: with escapeHtml()
  // removed this name really does run its onerror, and a dialog would hang the
  // headless run instead of reporting a failure. No element children at all is
  // also the assertion that holds for a payload that executes nothing.
  const injected = document.querySelector(`#landing .landing-card[data-id="${idOk}"]`);
  const nameEl = injected.querySelector('.landing-card-name');
  ok('a name that looks like markup is rendered as text',
     nameEl.children.length === 0 && nameEl.textContent === '<img src=x onerror=alert(1)>',
     nameEl.children.length ? `${nameEl.children[0].tagName} reached the DOM` : nameEl.textContent);

  const badCard = document.querySelector(`#landing .landing-card[data-id="${idBad}"]`);
  ok('a network with errors shows a critical badge', !!badCard.querySelector('.landing-badge.bad'));
  ok('a clean network says so instead',
     !!injected.querySelector('.landing-badge.good') && !injected.querySelector('.landing-badge.bad'));

  // ---- Opening a card puts the document back in the URL ----
  // A hash left over from an earlier save() would make "there is a hash" true
  // for free, so park a foreign one first. The claim is not that a URL exists,
  // it is that the URL carries *this* document — that is what makes a card a
  // bookmark rather than a private copy.
  answer = true;
  window.history.replaceState(null, '', window.location.pathname + window.location.search + '#stale');
  openFromLibrary(idBad);
  ok('opening a card closes the landing',
     document.getElementById('landing').classList.contains('hidden')
     && !document.body.classList.contains('landing-open'));
  ok('and loads that network', state.nodes.length === templatesData.errors.nodes.length,
     `${state.nodes.length} vs ${templatesData.errors.nodes.length}`);
  ok('the network is a link again, and it is this network',
     window.location.hash === '#' + encodeDoc(serializeDoc()), window.location.hash.slice(0, 20));
  ok('and the canvas remembers which card it came from', state.libraryId === idBad, String(state.libraryId));
  ok('so Save updates that card without asking for a name',
     (prompted = null, saveCurrentToLibrary(), prompted === null && Object.keys(loadLibrary()).length === 2),
     `${Object.keys(loadLibrary()).length} entries`);

  // Declining the replace has to leave the open diagram exactly as it was.
  const beforeDecline = JSON.stringify(serializeDoc());
  answer = false;
  openLanding(false);
  openFromLibrary(idOk);
  ok('declining the replace keeps the diagram on screen',
     JSON.stringify(serializeDoc()) === beforeDecline);
  answer = true;

  // ---- A new network is a document from the first moment ----
  window.history.replaceState(null, '', window.location.pathname + window.location.search + '#stale');
  startNewNetwork();
  ok('starting new empties the canvas', state.nodes.length === 0 && state.links.length === 0);
  // The point of "#seed": a blank canvas is already a document, shareable and
  // reloadable before the first device lands on it.
  ok('and a blank canvas still gets its own link',
     window.location.hash === '#' + encodeDoc(serializeDoc()) && window.location.hash !== '#stale',
     window.location.hash.slice(0, 20));
  ok('a blank canvas is not somebody else’s card', state.libraryId === null, String(state.libraryId));
  ok('an empty canvas has nothing to save', (prompted = null, saveCurrentToLibrary(), prompted === null));
  spawnNode('router');
  prompted = null; promptWith = 'Nueva sede';
  saveCurrentToLibrary();
  ok('a network with no card behind it asks for a name', prompted !== null,
     prompted && prompted.msg);
  ok('and the name it was given is the one on the card',
     libraryEntries().some((e) => e.name === 'Nueva sede'),
     libraryEntries().map((e) => e.name).join(' | '));
  // The report header is the one place a site name has already been typed.
  state.libraryId = null;
  state.report = { site: 'Clínica Norte' };
  prompted = null; saveCurrentToLibrary();
  ok('and the report header is what it offers as the default',
     prompted && prompted.def === 'Clínica Norte', prompted && String(prompted.def));
  state.report = null;

  // ---- The editor's controls are actually off the screen ----
  // Asserted on the computed style, not on the class that is supposed to cause
  // it. carino-navbar.js lifts .cs-right out of .cs-header into its own bar and
  // styles it '#carinoNav .cn-actions{display:flex}' — a rule with an id in it,
  // living in a file shared across the fleet and changed independently of this
  // one. Our rule only wins because it is !important, so this checks the
  // outcome: Undo and Export must not be sitting above a document nobody has
  // chosen. The relocation is asserted first, or a run where the navbar never
  // booted would pass this for the wrong reason.
  // The overlay itself, on computed style. Asserting classList.contains('hidden')
  // is what let `#landing { display: flex }` — an ID beating Tailwind's .hidden —
  // leave this overlay painted over the editor with the class correctly applied
  // and every test green.
  closeLanding();
  ok('a closed landing is actually off the screen',
     getComputedStyle(document.getElementById('landing')).display === 'none',
     getComputedStyle(document.getElementById('landing')).display);
  openLanding(false);
  ok('and an open one is actually on it',
     getComputedStyle(document.getElementById('landing')).display !== 'none');
  closeLanding();
  ok('the canvas is reachable once it closes',
     document.elementFromPoint(Math.round(innerWidth * 0.7), Math.round(innerHeight * 0.5)) !== null
     && !document.getElementById('landing').contains(
        document.elementFromPoint(Math.round(innerWidth * 0.7), Math.round(innerHeight * 0.5))),
     String(document.elementFromPoint(Math.round(innerWidth * 0.7), Math.round(innerHeight * 0.5))?.id));

  const csRight = document.querySelector('.cs-right');
  const exportBtn = document.getElementById('exportMenuBtn');
  // Deliberately not asserting *where* the controls live. They get relocated by
  // whichever shell claims them — carino-navbar.js lifts them into its own bar
  // on a desktop, js/mobile.js pulls them into the drawer in a narrow window
  // (which is what this harness is) — so the container is not a stable fact.
  // Visibility is. The open/closed pair is its own vacuity guard: if anything
  // else were hiding these, the "closed" half would fail.
  //
  // Both shells are actually exercised, which is worth knowing before anyone
  // "simplifies" one of the runners away: run.sh opens a 780px window and the
  // controls land in the mobile drawer, run-cross.mjs opens 1280px and they land
  // in #carinoNav .cn-right. A rule that only wins in one of them fails here.
  closeLanding();
  ok('the editor keeps its controls when the landing is not up',
     getComputedStyle(csRight).display !== 'none' && exportBtn.getBoundingClientRect().width > 0,
     getComputedStyle(csRight).display);
  openLanding(false);
  ok('and the landing takes them away',
     getComputedStyle(csRight).display === 'none', getComputedStyle(csRight).display);
  ok('Export is not reachable behind it', exportBtn.getBoundingClientRect().width === 0);
  closeLanding();
  ok('closing the landing gives them back',
     getComputedStyle(csRight).display !== 'none' && exportBtn.getBoundingClientRect().width > 0,
     getComputedStyle(csRight).display);

  // ---- The drop zone's highlight ----
  // dragenter/dragleave fire for every child the pointer crosses, so the zone
  // counts depth instead of trusting the last event. Moving from the box onto
  // its heading is enter(child) + leave(box) — a net zero the naive version
  // gets wrong, flickering the border off while the file is still in the air.
  // The file-loading half of the drop is applyImportedDoc(), covered by
  // `sharing`; what is asserted here is the part only this zone has.
  openLanding(false);
  const zone = document.getElementById('landingDrop');
  const drag = (type, target) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true }));
  drag('dragenter', zone);
  ok('dragging a file over the box lights it up', zone.classList.contains('drag'));
  drag('dragenter', zone.querySelector('h2'));   // the browser's real pair, in order
  drag('dragleave', zone);
  ok('crossing a child inside it does not put the light out', zone.classList.contains('drag'));
  drag('dragleave', zone.querySelector('h2'));
  ok('leaving the box for good does', !zone.classList.contains('drag'));
  // A drop that carries no file must still reset the border rather than leaving
  // the page looking like something is mid-flight.
  drag('dragenter', zone);
  drag('drop', zone);
  ok('a drop with nothing in it still resets the box', !zone.classList.contains('drag'));
  closeLanding();

  // ---- Replacing the document drops the card it came from ----
  // Otherwise Save takes the "update the open card" branch, skips the name
  // prompt, and overwrites a surveyed network with a template. There is no undo
  // for a library entry.
  localStorage.removeItem(LIBRARY_KEY);
  loadTemplateState(templatesData.hospital); autoBindLinks();
  const survey = librarySave('Torre A — surveyed');
  state.libraryId = survey;
  applyTemplate(templatesData.house);
  ok('loading a template drops the card the canvas came from', state.libraryId === null, String(state.libraryId));
  ok('so the surveyed network is still what the card holds',
     loadLibrary()[survey].doc.nodes.length === templatesData.hospital.nodes.length,
     `${loadLibrary()[survey].doc.nodes.length} nodes`);
  state.libraryId = survey;
  buildSetupNetwork();
  ok('and so does the setup wizard', state.libraryId === null, String(state.libraryId));
  ok('leaving the card untouched there too',
     loadLibrary()[survey].doc.nodes.length === templatesData.hospital.nodes.length);
  localStorage.removeItem(LIBRARY_KEY);

  // ---- Inter-site links ----
  // A change to the document model, so the first thing to prove is that it did
  // not change any document that does not use it. Everything else about the
  // feature is downstream of that.
  loadTemplateState(templatesData.hospital); autoBindLinks();
  ok('a document that names no site is byte-identical to its pre-feature form',
     !JSON.stringify(serializeDoc()).includes('siteRef'));

  localStorage.removeItem(LIBRARY_KEY);
  loadTemplateState(templatesData.campus); autoBindLinks();
  const torreA = librarySave('Torre A');
  loadTemplateState(templatesData.hospital); autoBindLinks();

  const cloud = state.nodes.find((n) => n.type === 'cloud') || spawnNode('cloud');
  cloud.siteRef = { id: torreA, name: 'Torre A' };
  save();
  await load();
  const reloaded = getNode(cloud.id);
  ok('a cloud\u2019s site reference survives the URL round trip',
     reloaded && reloaded.siteRef && reloaded.siteRef.id === torreA && reloaded.siteRef.name === 'Torre A',
     JSON.stringify(reloaded && reloaded.siteRef));

  // Only a cloud may stand for another site — enforced in one place, so one
  // load is enough to clean a hand-edited document.
  const host = state.nodes.find((n) => n.type === 'pc');
  host.siteRef = { id: torreA, name: 'Torre A' };
  save(); await load();
  ok('a site reference on anything but a cloud is dropped by one load',
     !getNode(host.id).siteRef, JSON.stringify(getNode(host.id).siteRef));

  ok('a reference with neither an id nor a name is not a claim about anything',
     normalizeSiteRef({ id: '   ', name: '' }) === null);
  ok('but a name on its own is — that is what a shared link carries',
     JSON.stringify(normalizeSiteRef({ name: 'Torre A' })) === '{"id":"","name":"Torre A"}',
     JSON.stringify(normalizeSiteRef({ name: 'Torre A' })));

  // The caption is the deliverable's half of this feature, and it must not
  // depend on whether the reader happens to hold the binder.
  renderCanvasOnly();
  const captionOf = (id) => [...document.querySelectorAll(`#ui-node-${id} text`)].map((n) => n.textContent).find((x) => x.startsWith('↗'));
  ok('the canvas captions the cloud with the site it stands for',
     captionOf(cloud.id) === '↗ Torre A', String(captionOf(cloud.id)));
  localStorage.removeItem(LIBRARY_KEY);   // the binder is gone; the claim is not
  renderCanvasOnly();
  ok('and captions it identically when the site is not in this browser',
     captionOf(cloud.id) === '↗ Torre A', String(captionOf(cloud.id)));

  // The checks read state.nodes/state.links only. A field they do not know
  // about must not perturb them, or a card and a report could disagree.
  const withRef = topologyFindings().map((f) => f.line).join('|');
  delete getNode(cloud.id).siteRef;
  renderCanvasOnly();
  ok('the diagnostics are indifferent to it',
     topologyFindings().map((f) => f.line).join('|') === withRef);

  // ---- The binder ----
  // The file is the copy that outlives the browser, so the two things that
  // matter are that it carries the documents intact and that bringing it back
  // does not destroy work that is already here.
  localStorage.removeItem(LIBRARY_KEY);
  localStorage.removeItem(BINDER_EXPORT_KEY);
  loadTemplateState(templatesData.hospital); autoBindLinks();
  const bId = librarySave('Torre A');
  loadTemplateState(templatesData.errors); autoBindLinks();
  const bId2 = librarySave('Bodega Sur');

  const file = binderFile();
  ok('the binder names itself so it can be told apart on the way back in',
     file.kind === 'nettopo-binder' && file.version === 1, `${file.kind} v${file.version}`);
  ok('it carries every saved network', file.sites.length === 2, String(file.sites.length));
  // Guarded rather than dereferenced: a binder written without ids would throw
  // here and the suite would report nothing at all, which says far less than a
  // named failure does.
  ok('and each one is the document the library holds',
     file.sites.every((st) => loadLibrary()[st.id] && JSON.stringify(st.doc) === JSON.stringify(loadLibrary()[st.id].doc)),
     file.sites.filter((st) => !loadLibrary()[st.id]).length + ' with no matching entry');
  ok('with the identity that makes a re-import a no-op',
     file.sites.every((st) => st.id && st.name && Number.isFinite(st.updated)));

  // A binder is JSON on a disk: it has to survive the round trip through a file
  // rather than through the object it was built from.
  const onDisk = JSON.parse(JSON.stringify(file));
  ok('a single build file is not mistaken for an empty binder',
     binderFromImported({ kind: 'nettopology', version: 1, doc: serializeDoc() }) === null);
  ok('and neither is a bare document', binderFromImported({ nodes: [], links: [] }) === null);
  ok('a binder is recognised', !!binderFromImported(onDisk));

  // Re-importing your own binder must change nothing. This is the assertion
  // that stops a week of surveys becoming two of everything.
  const again = importBinderSites(binderFromImported(onDisk).sites);
  ok('re-importing your own binder adds nothing',
     again.added === 0 && again.kept === 2 && Object.keys(loadLibrary()).length === 2,
     `+${again.added} ~${again.updated} =${again.kept}`);

  // A colleague's binder merges into yours; it never replaces it.
  const theirs = { kind: 'nettopo-binder', version: 1, sites: [
      { id: 'theirs1', name: 'Clínica Norte', created: 1, updated: 2, doc: { nodes: templatesData.campus.nodes, links: templatesData.campus.links } }] };
  const merged = importBinderSites(binderFromImported(theirs).sites);
  ok('someone else\u2019s binder is added to yours, not swapped for it',
     merged.added === 1 && Object.keys(loadLibrary()).length === 3
     && !!loadLibrary()[bId] && !!loadLibrary()[bId2],
     Object.keys(loadLibrary()).join(','));

  // The same network coming back newer is an update; coming back older is not.
  const newer = { kind: 'nettopo-binder', version: 1, sites: [
      { id: bId, name: 'Torre A — revisada', created: 1, updated: Date.now() + 60000, doc: { nodes: [], links: [] } }] };
  ok('a newer copy of a network you already have wins',
     importBinderSites(binderFromImported(newer).sites).updated === 1
     && loadLibrary()[bId].name === 'Torre A — revisada');
  const older = { kind: 'nettopo-binder', version: 1, sites: [
      { id: bId, name: 'Torre A — vieja', created: 1, updated: 1, doc: { nodes: [], links: [] } }] };
  ok('an older one does not', importBinderSites(binderFromImported(older).sites).kept === 1
     && loadLibrary()[bId].name === 'Torre A — revisada', loadLibrary()[bId].name);
  // A hand-written file, or a stranger's link, can carry no timestamp at all.
  // That is the LEAST information about recency — it must lose, not win.
  // On a fresh entry stamped normally: the one above carries a deliberately
  // future `updated` from the newer-wins fixture, which a "now" stamp could not
  // beat either — so it could not tell the two behaviours apart.
  const fresh = librarySave('Torre C — mine');
  // Aged deliberately: librarySave stamps Date.now(), and an import in the same
  // millisecond is not GREATER than it, so a "stamp it now" regression would
  // still lose the comparison and the assertion would prove nothing.
  const aged = loadLibrary(); aged[fresh].updated = Date.now() - 86400000; persistLibrary(aged);
  const undated = { kind: 'nettopo-binder', version: 1, sites: [
      { id: fresh, name: 'Torre C — sin fecha', doc: { nodes: [], links: [] } }] };
  ok('a site with no timestamp does not silently replace one you have',
     importBinderSites(binderFromImported(undated).sites).kept === 1
     && loadLibrary()[fresh].name === 'Torre C — mine', loadLibrary()[fresh].name);
  libraryDelete(fresh);

  // A file with one unreadable entry should give up that entry, not the import.
  const partly = binderFromImported({ kind: 'nettopo-binder', version: 1,
      sites: [{ id: 'ok1', name: 'Fine', updated: 5, doc: { nodes: [], links: [] } }, { id: 'bad1', name: 'Broken', doc: null }] });
  ok('an unreadable entry is skipped and counted, not fatal',
     partly.sites.length === 1 && partly.dropped === 1, `${partly.sites.length}/${partly.dropped}`);
  // The merge is also reachable straight from the guest shelf's Keep, where the
  // input has not been through that filter, so it defends itself too.
  const junk = importBinderSites([null, { id: 'x', name: 'No doc' }, { id: 'y', name: 'Fine', updated: 9, doc: { nodes: [], links: [] } }]);
  ok('and the merge itself survives junk without losing the good entries',
     junk && junk.added === 1 && junk.skipped === 2, JSON.stringify(junk));
  libraryDelete('y');

  // ---- "You have not backed this up" ----
  // Fresh state, not whatever the merge assertions left behind: one of them
  // imports a network stamped a minute into the future to prove "newer wins",
  // and an entry dated after the export is legitimately "changed since" for as
  // long as that clock is ahead. Correct behaviour, useless starting point.
  localStorage.removeItem(LIBRARY_KEY);
  localStorage.removeItem(BINDER_EXPORT_KEY);
  loadTemplateState(templatesData.house); autoBindLinks();
  const sId = librarySave('Casa Coyoacán');
  ok('with no export on record the landing says so outright',
     /never|not exported/i.test(binderStatus()), binderStatus());
  recordBinderExport();
  ok('straight after an export it says only when', !/changed since/i.test(binderStatus()), binderStatus());
  // A network added since the export is "changed" too, which a bare timestamp
  // could not distinguish from one that was in the file.
  loadTemplateState(templatesData.bank); autoBindLinks();
  const addedAfter = librarySave('Sucursal Centro');
  ok('a network added since the export counts as changed',
     /changed since/i.test(binderStatus()), binderStatus());
  libraryDelete(addedAfter);
  ok('and removing it settles the line again', !/changed since/i.test(binderStatus()), binderStatus());
  // Touching a network has to be enough to bring the warning back.
  librarySave('Casa Coyoacán', sId);
  ok('and a network saved since brings the warning back',
     /changed since/i.test(binderStatus()), binderStatus());
  // Renaming is the edit most likely to happen right before handing the file
  // over, and it used to leave the line saying everything was current.
  recordBinderExport();
  libraryRename(sId, 'Casa Coyoacán — planta alta');
  ok('so does renaming one', /changed since/i.test(binderStatus()), binderStatus());
  recordBinderExport();
  libraryRename(sId, 'Casa Coyoacán — planta alta');
  ok('but renaming it to what it already was is not a change',
     !/changed since/i.test(binderStatus()), binderStatus());
  ok('the line disappears entirely when there is nothing saved',
     (localStorage.removeItem(LIBRARY_KEY), binderStatus() === null), String(binderStatus()));

  // ---- Which URLs are the front door ----
  // shouldShowLanding() reads only the URL, so it can be asked about each shape
  // without a reload. The rule it encodes: a bare URL is the landing, and
  // anything naming a document or a job goes straight in.
  const asked = (search, hash) => {
    const held = window.location.search + window.location.hash;
    window.history.replaceState(null, '', window.location.pathname + search + hash);
    const answerNow = shouldShowLanding();
    window.history.replaceState(null, '', window.location.pathname + held);
    return answerNow;
  };
  ok('a bare URL opens the landing', asked('', '') === true);
  ok('a shared diagram does not', asked('', '#eyJub2RlcyI6W119') === false);
  ok('a compressed shared diagram does not', asked('', '#~abc') === false);
  ok('a profile entry does not', asked('', '#simple') === false);
  ok('the setup wizard does not', asked('', '#setup') === false);
  ok('an intake link naming a profile does not', asked('?profile=imagenology', '') === false);
  ok('nor does the legacy ?simple', asked('?simple', '') === false);
  ok('but a language choice is not a destination', asked('?lang=es', '') === true);

  // ---- Cleanup ----
  localStorage.removeItem(LIBRARY_KEY);
  localStorage.removeItem(BINDER_EXPORT_KEY);
  if (heldStore !== null) localStorage.setItem(LIBRARY_KEY, heldStore);
  window.history.replaceState(null, '', window.location.pathname + window.location.search + heldHash);
  window.confirm = realConfirm; window.alert = realAlert; window.prompt = realPrompt;

  // Drain the async assertions before reporting. One extra tick is enough for a
  // same-origin fetch of a file the page already has in cache.
  setTimeout(() => {
    late.forEach(([n, c, e]) => ok(n, c, e));
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }, 250);
}, 400); });
