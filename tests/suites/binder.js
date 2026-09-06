// The estate document is the deliverable an engagement is actually sold on, so
// the assertions here are about it telling the truth: that every number on the
// cover is the number the site's own sheet prints, that a subnet appearing in
// two buildings is named as a fact and never graded as a finding, and that
// rendering N sites to capture their pictures hands the editor back exactly the
// canvas it was holding.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const realAlert = window.alert, realConfirm = window.confirm, realPrompt = window.prompt;
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => 'x';

  const heldStore = localStorage.getItem(LIBRARY_KEY);
  const heldHash = window.location.hash;
  localStorage.removeItem(LIBRARY_KEY);

  // Three buildings. Two share a network on purpose, so the estate addressing
  // table has something only a multi-site document can find.
  const save2 = (name, key, report) => {
    loadTemplateState(templatesData[key]); autoBindLinks();
    state.report = report || null;
    return librarySave(name);
  };
  const idErr = save2('Bodega Sur', 'errors', { site: 'Bodega Sur', client: 'Grupo Marín', engineer: '', ref: '', date: '', scope: '' });
  const idHouse = save2('Casa Coyoacán', 'house', { site: 'Casa Coyoacán', client: 'Grupo Marín', engineer: '', ref: '', date: '', scope: '' });
  const idBank = save2('Sucursal Centro', 'bank', { site: 'Sucursal Centro', client: 'Banco del Norte', engineer: '', ref: '', date: '', scope: '' });
  // A second branch documented on the same default LAN — the commonest reason a
  // network appears twice in an estate, and the row this table exists to print.
  save2('Casa Roma', 'house', { site: 'Casa Roma', client: 'Grupo Marín', engineer: '', ref: '', date: '', scope: '' });
  // No shipped template raises an ADVISORY, so the register's severity ordering
  // had nothing to order. A bond of one member is the cheapest real one: it is a
  // NIC with extra steps, which the checks call an advisory rather than a fault.
  loadTemplateState(templatesData.datacenter); autoBindLinks();
  const bondHost = state.nodes.find((n) => (n.interfaces || []).length > 1) || state.nodes[0];
  bondHost.interfaces.push({ id: 'b1', name: 'bond0', ip: '10.77.0.9/24',
                             bond: { mode: '802.3ad', members: [bondHost.interfaces[0].id] } });
  state.report = { site: 'Sala de máquinas', client: 'Grupo Marín', engineer: '', ref: '', date: '', scope: '' };
  librarySave('Sala de máquinas');
  state.report = null;

  const entries = libraryEntries();
  const binder = binderModel(entries, { site: 'Grupo Marín', client: 'Grupo Marín', engineer: '', ref: 'CS-77', date: '2019-03-04', scope: '' });

  // ---- The cover is arithmetic over the sites, never a new opinion ----
  ok('every saved network gets a sheet', binder.sites.length === 5, String(binder.sites.length));
  ok('sheets are alphabetical, not library order — a regenerated report is the same document',
     binder.sites.map((s) => s.name).join('|') === 'Bodega Sur|Casa Coyoacán|Casa Roma|Sala de máquinas|Sucursal Centro',
     binder.sites.map((s) => s.name).join('|'));
  ok('the device total is the sum of the sites',
     binder.counts.devices === binder.sites.reduce((n, s) => n + s.counts.devices, 0));
  ok('the critical total is the sum of the sites',
     binder.counts.critical === binder.sites.reduce((n, s) => n + s.counts.critical, 0),
     `${binder.counts.critical} vs ${binder.sites.reduce((n, s) => n + s.counts.critical, 0)}`);
  ok('the register holds every finding in the estate, and no more',
     binder.findings.length === binder.counts.critical + binder.counts.advisory);
  ok('every register row names the site it came from',
     binder.findings.every((f) => f.site), JSON.stringify(binder.findings.find((f) => !f.site)));
  // The fixture has to contain BOTH severities or "worst-first" is a claim about
  // a list that only has one kind of thing in it.
  ok('the fixture actually raises both severities',
     binder.counts.critical > 0 && binder.counts.advisory > 0,
     `${binder.counts.critical} critical, ${binder.counts.advisory} advisory`);
  ok('and the register is worst-first across sites',
     binder.findings.every((f, i, a) => i === 0 || !(a[i - 1].level === 'warn' && f.level === 'bad')));
  ok('with every critical ahead of every advisory',
     binder.findings.findIndex((f) => f.level === 'warn') === -1
     || binder.findings.findIndex((f) => f.level === 'warn') === binder.counts.critical,
     `first advisory at ${binder.findings.findIndex((f) => f.level === 'warn')} of ${binder.counts.critical} critical`);

  // A site's own numbers must be the numbers its own report would print — that
  // is the whole no-second-generator argument.
  const bodega = binder.sites.find((s) => s.name === 'Bodega Sur');
  loadTemplateState(templatesData.errors); autoBindLinks();
  const alone = reportModel();
  ok('a site inside the estate reports exactly what it reports on its own',
     bodega.counts.devices === alone.counts.devices && bodega.counts.critical === alone.counts.critical,
     `${bodega.counts.critical} vs ${alone.counts.critical}`);
  ok('and its findings read the same, word for word',
     bodega.model.findings.map((f) => f.line).join('|') === alone.findings.map((f) => f.line).join('|'));

  // ---- Subnets are counted once, and a shared one is a fact ----
  const summed = binder.sites.reduce((n, s) => n + s.counts.subnets, 0);
  ok('the fixture really does share a network between two sites', summed > binder.subnets.length,
     `${summed} summed vs ${binder.subnets.length} distinct`);
  ok('the subnet total is distinct across the estate, not the sum of the sites',
     binder.counts.subnets === binder.subnets.length && binder.counts.subnets < summed,
     `${binder.counts.subnets} distinct vs ${summed} summed`);
  const shared = binder.subnets.filter((r) => r.sites.length > 1);
  ok('a network documented in two buildings is one row naming both', shared.length > 0
     && shared.every((r) => r.sites.length === new Set(r.sites.map((x) => x.site)).size),
     `${shared.length} shared`);
  ok('shared networks sort to the top, which is why the table exists',
     binder.subnets.every((r, i, a) => i === 0 || a[i - 1].sites.length >= r.sites.length));
  // The load-bearing one: naming it must not grade it.
  ok('a shared network adds nothing to the findings register',
     binder.findings.length === binder.sites.reduce((n, s) => n + (s.model ? s.model.findings.length : 0), 0));
  const html = binderHtml(binder, {});
  ok('and nothing in the addressing table carries a severity badge',
     !html.slice(html.indexOf('Estate addressing')).split('</table>')[0].includes('class="sev'));

  // ---- The document ----
  ok('one sheet per site, plus the cover',
     html.split('class="sheet"').length - 1 === binder.sites.length + 1,
     String(html.split('class="sheet"').length - 1));
  const links = [...html.matchAll(/href="#(site-[^"]+)"/g)];
  ok('the index links every site', links.length === binder.sites.length, `${links.length} links`);
  ok('and every one points at a sheet that exists',
     links.every((m) => html.includes(`id="${m[1]}"`)));
  ok('the estate still pulls nothing over the network',
     !/<script|<link|src="http|href="http/i.test(html.replace(/onclick="window\.print\(\)"/g, '')));
  ok('a site whose header names a different client says so',
     html.includes('Banco del Norte'));
  // No fixture site records a date, so no site sheet may print one: the header
  // is normalized for rendering (which invents today's), and comparing the
  // normalized value against the cover printed that invention on every sheet.
  // The estate date is deliberately not today's: normalizeReportMeta invents
  // today's for a site that recorded none, and comparing that invention against
  // a cover that also said today made this indistinguishable.
  const dateLabel = '<dt>Date</dt>';
  ok('and no sheet prints a date its document never recorded',
     (html.split(dateLabel).length - 1) === 1, `${html.split(dateLabel).length - 1} date rows`);

  // The card name and the name the DOCUMENT records can differ — saving before
  // filling the header is the ordinary way it happens. The document's own name
  // is the one that must print, or the estate report contradicts the single-site
  // report of the very same document.
  const renamedId = librarySave('torre b lower case');
  const lib9 = loadLibrary();
  lib9[renamedId].doc.report = { site: 'Hospital San José — Torre B', client: 'Grupo Marín' };
  persistLibrary(lib9);
  const withNames = binderHtml(binderModel(libraryEntries(), { site: 'Grupo Marín', client: 'Grupo Marín', date: '2019-03-04' }), {});
  ok('a sheet prints the site name its document records, not the card label',
     withNames.includes('Hospital San José — Torre B'), 'recorded name missing');
  ok('while the card label still heads the sheet and the index',
     withNames.includes('torre b lower case'));
  // And where the two agree, the row is dropped: the heading already said it.
  const agreeing = html.slice(html.indexOf('class="sheet" id='));
  ok('a sheet whose recorded name matches its card prints no Site row',
     !agreeing.includes('<dt>Site</dt>'), 'a redundant Site row survived');
  libraryDelete(renamedId);
  // Stated as "nowhere past the cover" rather than as a count: a count would
  // pass for the wrong reason the moment the cover's own wording changed.
  // Guarded: a missed indexOf gives -1, and slice(-1) is the last CHARACTER of
  // the document — an assertion that then passes for every possible input.
  const coverEnd = html.indexOf('class="sheet" id=');
  ok('the document really has site sheets after the cover', coverEnd > 0, String(coverEnd));
  const pastCover = coverEnd > 0 ? html.slice(coverEnd) : '';
  ok('and one that agrees with the cover does not repeat it on its own sheet',
     coverEnd > 0 && !pastCover.includes('Grupo Marín'),
     pastCover.slice(Math.max(0, pastCover.indexOf('Grupo Marín') - 60), 60));
  // The other half of the same rule: one that DIFFERS must print.
  ok('while a site whose client differs prints it on its own sheet',
     pastCover.includes('Banco del Norte'));

  // A site name is customer text on a page the customer reads.
  libraryRename(idBank, '<img src=x onerror=alert(1)>');
  const nasty = binderHtml(binderModel(libraryEntries(), { site: 'x' }), {});
  ok('a name shaped like markup is escaped everywhere it appears',
     !nasty.includes('<img src=x') && nasty.includes('&lt;img src=x'));
  libraryRename(idBank, 'Sucursal Centro');

  // ---- The estate graph draws every site it is given ----
  // A fixed 720-wide viewBox put every box past the fifth in a rank outside the
  // drawing and the browser clipped it away silently: a site missing from an
  // estate report is worse than an ugly diagram.
  // Built through estateGraph() rather than hand-writing rows, so the layout the
  // renderer is handed is the layout the model actually produces — a hand-made
  // fixture drifts the moment the ranking changes.
  const wideSites = [{ id: 'hub', name: 'HQ', siteRefs: [] }].concat(
    Array.from({ length: 7 }, (_, i) => ({ id: 's' + i, name: 'Branch ' + i,
      siteRefs: [{ from: 'WAN', ref: { id: 'hub', name: 'HQ' } }] })));
  const wideGraph = estateGraph(wideSites);
  ok('the hub is ranked above the branches that reach it',
     wideGraph.rows[0].length === 1 && wideGraph.rows[0][0].name === 'HQ',
     wideGraph.rows.map((r) => r.map((n) => n.name).join('+')).join(' / '));
  const svg = estateGraphSvg(wideGraph);
  const vbWidth = Number((svg.match(/viewBox="0 0 (\d+(?:\.\d+)?)/) || [])[1]);
  const rects = [...svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="(\d+)"/g)]
    .map((m) => ({ left: Number(m[1]), right: Number(m[1]) + Number(m[2]) }));
  ok('every site in a wide rank gets a box', rects.length === 8, String(rects.length));
  ok('and every box is inside the drawing rather than clipped off it',
     rects.every((r) => r.left >= 0 && r.right <= vbWidth),
     `viewBox ${vbWidth}, boxes ${Math.min(...rects.map((r) => r.left))}..${Math.max(...rects.map((r) => r.right))}`);
  // Ranks put the referencing site above its target, so an arrow must leave the
  // source's bottom and arrive at the target's top — drawn the other way round
  // every arrowhead pointed back at the site it came from.
  const line = (svg.match(/<line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/) || []);
  ok('the site it reaches is drawn above it, as upstream is on the canvas',
     Number(line[1]) > Number(line[2]), `source edge y=${line[1]}, target edge y=${line[2]}`);

  // ---- The image sweep must not edit anything ----
  loadTemplateState(templatesData.hospital); autoBindLinks(); save(); renderCanvasOnly(); initHistory();
  const before = { doc: JSON.stringify(serializeDoc()), hash: window.location.hash,
                   cam: JSON.stringify(state.camera), undo: document.getElementById('undoBtn').disabled };
  const sites = binderModel(libraryEntries(), {}).sites;
  const byId = new Map(libraryEntries().map((e) => [e.id, e.doc]));
  sites.forEach((s) => { s.doc = byId.get(s.id); });
  let rendered = 0;
  // A stub capture, not a real rasterisation: run.sh drives the page under a
  // virtual-time budget, and what is being asserted is the swap, not canvg.
  await captureBinderImages(sites, null, (doc) => withDocRendered(doc, () => { rendered++; return Promise.resolve(null); }));
  ok('every readable site was rendered in turn', rendered === sites.length, `${rendered} of ${sites.length}`);
  // And an unreadable one is skipped rather than failing the sweep.
  const withBroken = sites.concat([{ id: 'broken', name: 'Broken', model: null, doc: null }]);
  let rendered2 = 0;
  await captureBinderImages(withBroken, null, (doc) => withDocRendered(doc, () => { rendered2++; return Promise.resolve(null); }));
  ok('a site that cannot be modelled is skipped, not fatal',
     rendered2 === sites.length, `${rendered2} of ${withBroken.length}`);
  ok('the canvas is handed back byte-identical', JSON.stringify(serializeDoc()) === before.doc);
  ok('the URL is untouched — a report is not an edit', window.location.hash === before.hash);
  ok('so is the camera', JSON.stringify(state.camera) === before.cam);
  ok('and the undo timeline gained no steps', document.getElementById('undoBtn').disabled === before.undo);

  // The sweep leaves a foreign document on the live canvas across an await —
  // captureCanvasImage waits on an image load. Any handler that fires in that
  // window (a drag ending, a delete) reaches save(), which writes the URL and
  // pushes an undo step, and the sweep's finally can restore state but cannot
  // un-write either. So save() refuses while the canvas is borrowed.
  const url0 = window.location.hash, doc0 = JSON.stringify(serializeDoc());
  await withDocRendered(sites[0].doc, async () => {
    ok('the borrowed document really is on the canvas during the sweep',
       JSON.stringify(serializeDoc()) !== doc0);
    spawnNode('pc');          // exactly what a stray click would do — and it calls save()
    save();
    return null;
  });
  ok('a save during the sweep does not write the foreign document into the URL',
     window.location.hash === url0, window.location.hash.slice(0, 14));
  ok('nor into the undo timeline', document.getElementById('undoBtn').disabled === before.undo);
  ok('and the canvas still holds the user\u2019s own document afterwards',
     JSON.stringify(serializeDoc()) === doc0);

  // ---- Site references, drawn and stated ----
  loadTemplateState(templatesData.campus); autoBindLinks();
  const cloud = state.nodes.find((n) => n.type === 'cloud') || spawnNode('cloud');
  cloud.siteRef = { id: idErr, name: 'Bodega Sur' };
  const idCampus = librarySave('Campus Norte');
  const linked = binderModel(libraryEntries(), { site: 'x' });
  ok('a cloud naming another site becomes an estate edge',
     linked.graph.edges.some((e) => e.resolved && e.toName === 'Bodega Sur'),
     JSON.stringify(linked.graph.edges.map((e) => `${e.fromName}->${e.toName}:${e.resolved}`)));
  const linkedHtml = binderHtml(linked, {});
  // On the Site-links table specifically, not on the document: 'Bodega Sur' is
  // one of the binder's own sites and appears in the index and as its own sheet,
  // so looking for it anywhere in the HTML passes with the table absent.
  const linksTable = linkedHtml.slice(linkedHtml.indexOf('Estate topology'), linkedHtml.indexOf('Scope and method'));
  ok('and it is stated in words, not only drawn',
     /Campus Norte/.test(linksTable) && /Bodega Sur/.test(linksTable),
     linksTable.slice(0, 0) || `${linksTable.length} chars of topology section`);
  // An unresolvable reference is the normal state of a diagram someone was
  // sent; it must appear as a fact and never as a fault.
  getNode(cloud.id).siteRef = { id: 'gone', name: 'Torre Z' };
  librarySave('Campus Norte', idCampus);
  const dangling = binderModel(libraryEntries(), { site: 'x' });
  ok('a reference to a site not in the binder is still reported',
     dangling.graph.edges.some((e) => !e.resolved && e.toName === 'Torre Z'));
  ok('but it raises no finding', dangling.findings.every((f) => !/Torre Z/.test(f.detail || '')));

  // A reference cycle is something a user can absolutely draw, and the rank
  // relaxation is capped precisely so it terminates. The previous version of
  // this block re-read the same acyclic library and proved nothing — the cycle
  // has to be built.
  loadTemplateState(templatesData.campus); autoBindLinks();
  const c1 = state.nodes.find((n) => n.type === 'cloud') || spawnNode('cloud');
  c1.siteRef = { id: idErr, name: 'Bodega Sur' };
  const idA = librarySave('Cycle A');
  loadTemplateState(templatesData.errors); autoBindLinks();
  const c2 = state.nodes.find((n) => n.type === 'cloud') || spawnNode('cloud');
  c2.siteRef = { id: idA, name: 'Cycle A' };
  librarySave('Bodega Sur', idErr);
  const cyc = binderModel(libraryEntries(), { site: 'x' });
  ok('the fixture really is a cycle',
     cyc.graph.edges.filter((e) => e.resolved).length >= 2
     && cyc.graph.edges.some((e) => e.resolved && e.fromName === 'Cycle A')
     && cyc.graph.edges.some((e) => e.resolved && e.fromName === 'Bodega Sur'),
     cyc.graph.edges.map((e) => `${e.fromName}->${e.toName}`).join(','));
  ok('the graph terminates and draws each site exactly once',
     cyc.graph.rows.reduce((n, r) => n + r.length, 0) === cyc.sites.length,
     `${cyc.graph.rows.reduce((n, r) => n + r.length, 0)} vs ${cyc.sites.length}`);
  ok('and the document builds', binderHtml(cyc, {}).length > 0);

  // ---- The estate header is a property of the document, not of any network ----
  const seeded = binderHeaderDefaults(binderSiteModels(libraryEntries()));
  ok('the header offers the client the most sites already agree on',
     seeded.client === 'Grupo Marín', JSON.stringify(seeded));
  // The claim is that the BINDER path never writes the estate header onto the
  // canvas. Asserting a value the test just set proves nothing, so the header
  // is put somewhere recognisable first and the estate document is built with a
  // different one.
  state.report = { site: 'On the canvas', client: '', engineer: '', ref: '', date: '', scope: '' };
  const canvasDocBefore = JSON.stringify(serializeDoc());
  binderHtml(binderModel(libraryEntries(), { site: 'The estate', client: 'Somebody else' }), {});
  ok('building an estate document leaves the open canvas\u2019s own header alone',
     state.report && state.report.site === 'On the canvas', JSON.stringify(state.report));
  ok('and does not touch the document either', JSON.stringify(serializeDoc()) === canvasDocBefore);
  state.report = null;

  localStorage.removeItem(LIBRARY_KEY);
  if (heldStore !== null) localStorage.setItem(LIBRARY_KEY, heldStore);
  window.history.replaceState(null, '', window.location.pathname + window.location.search + heldHash);
  window.alert = realAlert; window.confirm = realConfirm; window.prompt = realPrompt;

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
