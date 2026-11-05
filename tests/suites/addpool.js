// Add devices, bulk Move and a dropped device round a subnet's DHCP pool:
// the owner's option C (docs/BACKLOG.md "Decisions taken", 2026-11-05).
// What is held here:
//   1. FIXED_ADDRESS_TYPES is one named list of real type ids, and the
//      clients are not in it;
//   2. Add devices on a subnet whose pool counts: the fixed-address devices
//      (printer, server, camera, router…) step round it to the lowest free
//      address outside, the clients (PCs, phones, IoT) take the lowest free
//      address as ever, pool or not; nothing is kept out when the lowest free
//      address is outside the pool anyway; the outside cursor jumps the pool
//      and passes a taken address; with no room outside, the pool is used and
//      the device marked;
//   3. the preview: the address range low to high, the plain line naming
//      who was kept out with their addresses, the warning when the pool had
//      to be used, the fourth-and-more cut, Spanish, Russian and Japanese;
//   4. bulk Move: the same rule in name order, the row's why, the kept-out
//      line as information (info), the fallback as a warning (notes); the
//      preview draws them so, says the rule in its blurb and shows the row's
//      why on the row; a device with no name is named by its id;
//   5. a device dropped onto a switch (spawnNode with connectTo) follows it,
//      and says so in a toast when it has to take a pool address;
//   6. no pool, or one that does not count (reversed, DHCP off, outside the
//      subnet, one end, unreadable, the other family, on the network or the
//      broadcast address), is byte-identical to today: the same plan, the
//      same preview, the same bulk plan, on a small site and on every
//      template with every network given each such pool, Wi-Fi targets
//      included; and on every template, plans for a mix of every kind hand
//      out exactly freeAddresses()' run, in order, with none of the pool keys;
//   7. a block inserted onto a taken range moves to a free subnet, and its
//      own network's pool moves with it, still a pool that counts;
//   8. an AP whose SSID is on its own pooled LAN: the cabled and the radio
//      devices never share an address, fixed ones outside, clients inside;
//   9. an AP whose SSID is on another pooled subnet: each pool line names
//      only its own pool.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const heldResponder = setDialogResponder((req) => (req.kind === 'confirm' ? true : null));
  const bare = (ip) => (ip || '').split('/')[0];
  const site = (net, extraNodes) => replaceDocument({ v: DOC_VERSION, nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 400, y: 80, interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.1.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 400, y: 240, portCount: 48, interfaces: [] },
      ...(extraNodes || [])],
    links: [{ id: 'l1', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }],
    networks: net ? [net] : [] }, { origin: 'file' });
  const lan = (extra) => ({ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true, dhcpFirst: '10.0.1.2', dhcpLast: '10.0.1.99', ...(extra || {}) });
  const noPool = () => ({ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true });
  const mix = [{ type: 'pc', count: 1 }, { type: 'printer', count: 1 }, { type: 'pc', count: 1 }, { type: 'server', count: 1 }];
  const plan = (items) => planAddDevices({ items, pattern: '', targetId: 'sw' });
  const ips = (p) => p.devices.map((d) => bare(d.ip));
  const summaryOf = (items, target = 'sw') => {
    openAddDevices({ mode: 'add' });
    el('addTarget').value = target;
    if (el('addTarget').value !== target) { closeAddDevices(); return null; }
    document.querySelectorAll('#addRows .add-count').forEach((i) => { i.value = '0'; });
    items.forEach(({ type, count }) => { const i = document.querySelector(`#addRows .add-count[data-type="${type}"]`); i.value = String(count); });
    renderAddSummary();
    const s = { text: el('addSummary').textContent, html: el('addSummary').innerHTML,
      warn: [...el('addSummary').querySelectorAll('.add-warn')].map((p) => p.textContent) };
    closeAddDevices();
    return s;
  };
  setLocale('en');

  try {
    // ---- 1. The list ----
    const real = new Set(Object.keys(initialDataDefaults));
    ok('FIXED_ADDRESS_TYPES is a named list of real type ids', FIXED_ADDRESS_TYPES instanceof Set && [...FIXED_ADDRESS_TYPES].every((t) => real.has(t)),
       [...FIXED_ADDRESS_TYPES].filter((t) => !real.has(t)).join(','));
    ok('printers, servers, cameras, switches, APs, routers, firewalls and the routing gear keep a fixed address',
       ['printer', 'server', 'camera', 'dicom', 'switch', 'l3switch', 'ap', 'router', 'firewall', 'edge', 'vpn', 'loadbalancer', 'cloud'].every(keepsFixedAddress));
    ok('PCs, phones, IoT, VMs, containers and custom devices are clients', !['pc', 'voip', 'iot', 'vm', 'container', 'custom'].some(keepsFixedAddress));

    // ---- 2. Add devices round the pool ----
    site(lan());
    let p = plan(mix);
    ok('with a pool at the bottom, the PCs take the lowest free addresses, inside the pool', ips(p)[0] === '10.0.1.2' && ips(p)[2] === '10.0.1.3', show(ips(p)));
    ok('and the printer and the server go to the first free addresses past it', ips(p)[1] === '10.0.1.100' && ips(p)[3] === '10.0.1.101', show(ips(p)));
    ok('the two are marked kept out of the pool, the PCs not', p.devices[1].keptOut && p.devices[3].keptOut && !p.devices[0].keptOut && !p.devices[2].keptOut && !p.devices.some((d) => d.inPool));
    ok('the plan names the pool', show(p.pools) === show(['10.0.1.2–10.0.1.99']), show(p.pools));
    p = plan([{ type: 'camera', count: 2 }, { type: 'voip', count: 2 }, { type: 'iot', count: 1 }]);
    ok('cameras kept out, phones and IoT in the pool, lowest first', show(ips(p)) === show(['10.0.1.100', '10.0.1.101', '10.0.1.2', '10.0.1.3', '10.0.1.4']), show(ips(p)));

    site(lan({ dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }));
    p = plan(mix);
    ok('a pool higher up changes nothing when the lowest free address is outside it', show(ips(p)) === show(['10.0.1.2', '10.0.1.3', '10.0.1.4', '10.0.1.5']), show(ips(p)));
    ok('and nobody is said to be kept out', !p.devices.some((d) => d.keptOut || d.inPool));

    // The fixed part below the pool is full: a server goes above it.
    const low = []; for (let k = 2; k <= 99; k++) low.push({ id: `h${k}`, type: 'pc', name: `H${k}`, x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: `10.0.1.${k}/24` }] });
    low.push({ id: 'h200', type: 'pc', name: 'H200', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.200/24' }] });
    site(lan({ dhcpFirst: '10.0.1.100', dhcpLast: '10.0.1.199' }), low);
    p = plan([{ type: 'server', count: 2 }, { type: 'pc', count: 1 }]);
    ok('the outside cursor jumps the pool and steps past a taken address', show(ips(p)) === show(['10.0.1.201', '10.0.1.202', '10.0.1.100']), show(ips(p)));

    // No room outside: a /28 whose pool takes all but the gateway.
    replaceDocument({ v: DOC_VERSION, nodes: [
        { id: 'rt', type: 'router', name: 'Core', x: 400, y: 80, interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.2.1/28' }] },
        { id: 'sw', type: 'switch', name: 'SW-1', x: 400, y: 240, portCount: 48, interfaces: [] }],
      links: [{ id: 'l1', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }],
      networks: [{ id: 'n2', cidr: '10.0.2.0/28', gateway: '10.0.2.1', dhcp: true, dhcpFirst: '10.0.2.2', dhcpLast: '10.0.2.14' }] }, { origin: 'file' });
    p = plan([{ type: 'printer', count: 1 }, { type: 'pc', count: 1 }]);
    ok('with no free address outside the pool, the printer falls back to the pool', ips(p)[0] === '10.0.2.2' && p.devices[0].inPool && !p.devices[0].keptOut, show(p.devices));
    ok('and the PC takes the next one', ips(p)[1] === '10.0.2.3');
    let s = summaryOf([{ type: 'printer', count: 1 }, { type: 'pc', count: 1 }]);
    // The dialog plans in its tiles' order: the PC first, at the pool's bottom.
    ok('the preview warns that the printer takes a pool address',
       s.warn.some((w) => w === '⚠ No address is left outside the DHCP pool 10.0.2.2–10.0.2.14, so Printer (10.0.2.3) takes one from inside it.'), show(s.warn));
    s = summaryOf([{ type: 'printer', count: 1 }, { type: 'server', count: 1 }]);
    ok('two say "take addresses"', s.warn.some((w) => /so \w+ \(10\.0\.2\.2\), \w+ \(10\.0\.2\.3\) take addresses from inside it\.$/.test(w)), show(s.warn));

    // ---- 3. The preview ----
    site(lan());
    s = summaryOf(mix);
    ok('the preview says who was kept out of the pool, with their addresses',
       s.text.includes('Kept out of the DHCP pool 10.0.1.2–10.0.1.99, because they keep fixed addresses: Printer (10.0.1.100), Server (10.0.1.101).'), s.text);
    ok('as a plain line, not a warning', !s.warn.some((w) => /Kept out/.test(w)));
    ok('the address range runs low to high', s.text.includes('Addresses 10.0.1.2 – 10.0.1.101 on Office.'), s.text);
    s = summaryOf([{ type: 'printer', count: 1 }]);
    ok('one says "it keeps a fixed address"', s.text.includes('Kept out of the DHCP pool 10.0.1.2–10.0.1.99, because it keeps a fixed address: Printer (10.0.1.100).'), s.text);
    s = summaryOf([{ type: 'camera', count: 6 }]);
    ok('six are cut after four, with how many more', s.text.includes('IP Camera 1 (10.0.1.100), IP Camera 2 (10.0.1.101), IP Camera 3 (10.0.1.102), IP Camera 4 (10.0.1.103) and 2 more.'), s.text);
    s = summaryOf([{ type: 'pc', count: 3 }]);
    ok('only clients: no pool line', !/DHCP pool/.test(s.text), s.text);
    const words = {};
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => { setLocale(loc); words[loc] = summaryOf([{ type: 'printer', count: 1 }, { type: 'server', count: 1 }]).text; });
    setLocale('en');
    ok('Spanish', words.es.includes('Fuera del pool DHCP 10.0.1.2–10.0.1.99, porque usan direcciones fijas:'), words.es);
    ok('Portuguese', words['pt-BR'].includes('Fora do pool DHCP 10.0.1.2–10.0.1.99, porque usam endereços fixos:'), words['pt-BR']);
    ok('Russian', words.ru.includes('Вне пула DHCP 10.0.1.2–10.0.1.99, потому что у этих устройств постоянные адреса:'), words.ru);
    ok('Japanese', words.ja.includes('固定アドレスを使う機器なので、DHCP プール 10.0.1.2–10.0.1.99 の外にしました:'), words.ja);
    const keys = ['Kept out of the DHCP pool {pool}, because it keeps a fixed address: {names}.',
      'Kept out of the DHCP pool {pool}, because they keep fixed addresses: {names}.',
      'No address is left outside the DHCP pool {pool}, so {names} takes one from inside it.',
      'No address is left outside the DHCP pool {pool}, so {names} take addresses from inside it.',
      'Kept out of the DHCP pool {pool}.', 'No address is left outside the DHCP pool {pool}.'];
    const missing = [];
    ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => { setLocale(loc); keys.forEach((k) => { if (t(k) === k) missing.push(`${loc}: ${k}`); }); });
    setLocale('en');
    ok('every new sentence is translated in es, pt-BR, ru and ja', !missing.length, missing.join(' | '));

    // ---- 4. Bulk Move ----
    const movers = [
      { id: 'a', type: 'pc', name: 'A PC', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.5/24' }] },
      { id: 'b', type: 'printer', name: 'B Printer', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.6/24' }] },
      { id: 'c', type: 'voip', name: 'C Phone', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.7/24' }] },
      { id: 'd', type: 'server', name: 'D Server', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.8/24' }] }];
    site(lan(), movers);
    let bp = bulkPlanMove(['a', 'b', 'c', 'd'], 'n1');
    const after = (id) => (bp.rows.find((r) => r.nodeId === id && r.field === 'IP / CIDR') || {}).after;
    ok('bulk Move: clients from the bottom, fixed ones past the pool, in name order',
       show(['a', 'b', 'c', 'd'].map(after)) === show(['10.0.1.2/24', '10.0.1.100/24', '10.0.1.3/24', '10.0.1.101/24']), show(['a', 'b', 'c', 'd'].map(after)));
    ok('the printer\'s row says why', (bp.rows.find((r) => r.nodeId === 'b') || {}).why === 'Kept out of the DHCP pool 10.0.1.2–10.0.1.99.');
    ok('a client\'s row says nothing', !(bp.rows.find((r) => r.nodeId === 'a') || {}).why);
    ok('the information line names them, and nothing is a warning', show(bp.info) === show(['Kept out of the DHCP pool 10.0.1.2–10.0.1.99, because they keep fixed addresses: B Printer (10.0.1.100), D Server (10.0.1.101).'])
       && !bp.notes.length, show([bp.info, bp.notes]));
    renderBulkPreview(bp);
    ok('the bulk preview draws the kept-out line as information, not a warning',
       [...el('bulkMsgs').querySelectorAll('.alert.info')].some((a) => /^Kept out of the DHCP pool 10\.0\.1\.2–10\.0\.1\.99, because they keep/.test(a.textContent))
       && !el('bulkMsgs').querySelector('.alert.warn'), el('bulkMsgs').innerHTML);
    ok('its blurb says fixed-address devices step past the pool',
       el('bulkBlurb').textContent.includes('Devices that keep a fixed address (printers, servers, cameras, network gear) take the next free one outside the DHCP pool 10.0.1.2–10.0.1.99.'), el('bulkBlurb').textContent);
    const prRow = [...el('bulkPreview').querySelectorAll('tr')].find((tr) => tr.textContent.includes('B Printer'));
    ok('the printer\'s row shows why on the row itself, not only in a tooltip', !!prRow && prRow.cells[3].textContent.includes('Kept out of the DHCP pool 10.0.1.2–10.0.1.99.'), prRow && prRow.innerHTML);
    site(noPool(), movers);
    renderBulkPreview(bulkPlanMove(['a', 'b'], 'n1'));
    ok('with no pool, the blurb and the messages are as before', el('bulkBlurb').textContent === 'Each one takes the next free address there, and its gateway and DNS come from the subnet.'
       && !el('bulkMsgs').querySelector('.alert'), el('bulkBlurb').textContent);
    site(lan(), [{ id: 'nameless', type: 'printer', name: '', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.9.0.6/24' }] }]);
    getNode('nameless').name = '';   // loading names a blank one; the editor can still clear it
    bp = bulkPlanMove(['nameless'], 'n1');
    ok('a device with no name is named by its id', show(bp.info) === show(['Kept out of the DHCP pool 10.0.1.2–10.0.1.99, because it keeps a fixed address: nameless (10.0.1.100).']), show(bp.info));
    replaceDocument({ v: DOC_VERSION, nodes: movers.slice(), links: [],
      networks: [{ id: 'n2', cidr: '10.0.2.0/28', gateway: '10.0.2.1', dhcp: true, dhcpFirst: '10.0.2.2', dhcpLast: '10.0.2.14' }] }, { origin: 'file' });
    bp = bulkPlanMove(['b'], 'n2');
    ok('bulk Move falls back to the pool and says so', after('b') === '10.0.2.2/28'
       && (bp.rows.find((r) => r.nodeId === 'b') || {}).why === 'No address is left outside the DHCP pool 10.0.2.2–10.0.2.14.'
       && show(bp.notes) === show(['No address is left outside the DHCP pool 10.0.2.2–10.0.2.14, so B Printer (10.0.2.2) takes one from inside it.']) && !(bp.info || []).length, show(bp.notes));
    renderBulkPreview(bp);
    ok('and the preview draws that one as a warning', !!el('bulkMsgs').querySelector('.alert.warn') && !el('bulkMsgs').querySelector('.alert.info'), el('bulkMsgs').innerHTML);
    setLocale('es');
    site(lan(), movers);
    bp = bulkPlanMove(['b'], 'n1');
    ok('bulk Move\'s note in Spanish', /^Fuera del pool DHCP 10\.0\.1\.2–10\.0\.1\.99, porque usa una dirección fija: B Printer \(10\.0\.1\.100\)\.$/.test(bp.info[0] || ''), show(bp.info));
    const blurbKey = 'Devices that keep a fixed address (printers, servers, cameras, network gear) take the next free one outside the DHCP pool {pool}.';
    const blurbMissing = ['es', 'pt-BR', 'ru', 'ja'].filter((loc) => { setLocale(loc); return t(blurbKey) === blurbKey; });
    ok('the blurb\'s sentence is translated in es, pt-BR, ru and ja', !blurbMissing.length, blurbMissing.join(','));
    setLocale('en');

    // ---- 5. One device dropped onto the switch ----
    site(lan());
    const pr = spawnNode('printer', { connectTo: 'sw' });
    const pc = spawnNode('pc', { connectTo: 'sw' });
    ok('a printer dropped onto the switch is kept out of the pool', bare(pr.interfaces[0].ip) === '10.0.1.100', pr.interfaces[0].ip);
    ok('a PC dropped onto it takes the lowest free address', bare(pc.interfaces[0].ip) === '10.0.1.2', pc.interfaces[0].ip);
    site(noPool());
    ok('with no pool, a dropped printer takes the bottom as before', bare(spawnNode('printer', { connectTo: 'sw' }).interfaces[0].ip) === '10.0.1.2');
    const toast = () => el('topoToast');
    const fullPool = () => replaceDocument({ v: DOC_VERSION, nodes: [
        { id: 'rt', type: 'router', name: 'Core', x: 400, y: 80, interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.2.1/28' }] },
        { id: 'sw', type: 'switch', name: 'SW-1', x: 400, y: 240, portCount: 48, interfaces: [] }],
      links: [{ id: 'l1', source: 'rt', target: 'sw', sourceIface: 'i1', targetIface: 'p1' }],
      networks: [{ id: 'n2', cidr: '10.0.2.0/28', gateway: '10.0.2.1', dhcp: true, dhcpFirst: '10.0.2.2', dhcpLast: '10.0.2.14' }] }, { origin: 'file' });
    fullPool();
    toast().textContent = ''; toast().className = 'toast';
    const prIn = spawnNode('printer', { connectTo: 'sw' });
    ok('a printer dropped where nothing is left outside the pool takes a pool address and a toast says so', bare(prIn.interfaces[0].ip) === '10.0.2.2'
       && toast().classList.contains('show') && toast().textContent === `No address is left outside the DHCP pool 10.0.2.2–10.0.2.14, so ${prIn.name} (10.0.2.2) takes one from inside it.`,
       `${prIn.interfaces[0].ip} :: ${toast().textContent}`);
    toast().textContent = ''; toast().className = 'toast';
    spawnNode('pc', { connectTo: 'sw' });
    ok('a PC there takes its pool address with nothing said', !toast().textContent, toast().textContent);
    site(lan());
    spawnNode('printer', { connectTo: 'sw' });
    ok('nor is anything said when the printer is kept out', !toast().textContent, toast().textContent);

    // ---- 6. No pool, or one that does not count: byte-identical ----
    // The plan holds the network itself, whose pool fields are what differ;
    // it is compared by id, everything else as it is.
    const flat = (pl) => show({ ...pl, network: pl.network && pl.network.id, target: pl.target && pl.target.id });
    site(noPool());
    const basePlan = flat(plan(mix)), baseSummary = summaryOf(mix).html;
    site(noPool(), movers);
    const baseBulk = flat(bulkPlanMove(['a', 'b', 'c', 'd'], 'n1'));
    const invalid = {
      reversed: lan({ dhcpFirst: '10.0.1.99', dhcpLast: '10.0.1.2' }),
      'DHCP off': lan({ dhcp: false }),
      outside: lan({ dhcpFirst: '10.0.5.2', dhcpLast: '10.0.5.99' }),
      'one end': lan({ dhcpLast: '' }),
      'not an address': lan({ dhcpFirst: 'abc' }),
      'network address': lan({ dhcpFirst: '10.0.1.0' })
    };
    const drift = [];
    Object.entries(invalid).forEach(([why, net]) => {
      site(net);
      if (flat(plan(mix)) !== basePlan) drift.push(`${why}: plan`);
      if (summaryOf(mix).html !== baseSummary) drift.push(`${why}: preview`);
      site(net, movers);
      if (flat(bulkPlanMove(['a', 'b', 'c', 'd'], 'n1')) !== baseBulk) drift.push(`${why}: bulk`);
    });
    ok('a pool that does not count gives the very same plan, preview and bulk plan as none', !drift.length, drift.join(' | '));
    ok('and the no-pool plan has no pool keys', !/pools|keptOut|inPool/.test(basePlan) && !/"pool"/.test(baseBulk));

    const kinds = Object.keys(initialDataDefaults).map((type) => ({ type, count: 1 }));
    const odd = [];
    let checked = 0, moved = 0;
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'file' });
      const targets = state.nodes.filter((n) => hasPortGrid(n) && !isRetired(n)).slice(0, 3);
      targets.forEach((tg) => {
        const pl = planAddDevices({ items: kinds, pattern: '', targetId: tg.id });
        if (pl.pools || pl.devices.some((d) => 'keptOut' in d || 'inPool' in d)) odd.push(`${k}:${tg.name}: pool keys`);
        if (!pl.cidr || pl.wifiCidr) return;
        const got = pl.devices.filter((d) => d.ip).map((d) => bare(d.ip));
        const want = freeAddresses(pl.cidr, got.length);
        if (show(got) !== show(want)) odd.push(`${k}:${tg.name}: ${show(got)} vs ${show(want)}`);
        checked++;
      });
      state.networks.forEach((net) => {
        const ids = state.nodes.filter((n) => !isRoutingDevice(n.type)).slice(0, 12).map((n) => n.id);
        const bpl = bulkPlanMove(ids, net.id);
        const handed = bpl.rows.filter((r) => r.status === 'change' && r.field === 'IP / CIDR').map((r) => bare(r.after));
        // Taken grows only by what the plan hands out, so the run is the
        // lowest free addresses in order.
        const want = freeAddresses(net.cidr, handed.length, net);
        if (handed.length && show(handed) !== show(want)) odd.push(`${k}:${net.cidr} bulk: ${show(handed)} vs ${show(want)}`);
        if (bpl.pool || bpl.notes.length) odd.push(`${k}:${net.cidr} bulk notes`);
        if (handed.length) moved++;
      });
    });
    ok('on every template, Add devices and bulk Move hand out freeAddresses()\' run, in order, with no pool keys', !odd.length && checked > 10 && moved > 10,
       `${odd.slice(0, 4).join(' | ')} (checked ${checked}, moved ${moved})`);

    // Every template again, each network given each pool that does not
    // count, against the template as shipped: plans (Wi-Fi targets too), the
    // first target's preview and the bulk plans must not move a byte.
    const flatAll = (pl) => show({ ...pl, network: pl.network && pl.network.id, wifiNetwork: pl.wifiNetwork && pl.wifiNetwork.id,
      target: pl.target && pl.target.id });
    const shapes = {
      reversed: (r, p) => ({ dhcp: true, dhcpFirst: bigToIp(r.first + 3n, p.kind).toString(), dhcpLast: bigToIp(r.first + 1n, p.kind).toString() }),
      off: (r, p) => ({ dhcp: false, dhcpFirst: bigToIp(r.first, p.kind).toString(), dhcpLast: bigToIp(r.last, p.kind).toString() }),
      outside: (r, p) => ({ dhcp: true, dhcpFirst: p.kind === 'ipv4' ? '198.51.100.10' : '2001:db8:ffff::10', dhcpLast: p.kind === 'ipv4' ? '198.51.100.20' : '2001:db8:ffff::20' }),
      half: (r, p) => ({ dhcp: true, dhcpFirst: bigToIp(r.first, p.kind).toString(), dhcpLast: '' }),
      unreadable: () => ({ dhcp: true, dhcpFirst: 'abc', dhcpLast: 'def' }),
      family: (r, p) => ({ dhcp: true, dhcpFirst: p.kind === 'ipv4' ? 'fd00::10' : '10.0.0.10', dhcpLast: p.kind === 'ipv4' ? 'fd00::20' : '10.0.0.20' }),
      'network address': (r, p) => ({ dhcp: true, dhcpFirst: bigToIp(r.first - 1n, p.kind).toString(), dhcpLast: bigToIp(r.last, p.kind).toString() }),
      broadcast: (r, p) => ({ dhcp: true, dhcpFirst: bigToIp(r.first, p.kind).toString(), dhcpLast: bigToIp(r.last + 1n, p.kind).toString() })
    };
    const runTemplate = (doc) => {
      replaceDocument(doc, { origin: 'file' });
      const targets = state.nodes.filter((n) => hasPortGrid(n) && !isRetired(n)).slice(0, 3);
      const res = { plans: targets.map((tg) => flatAll(planAddDevices({ items: kinds, pattern: '', targetId: tg.id }))),
        wifi: targets.some((tg) => planAddDevices({ items: kinds, pattern: '', targetId: tg.id }).wifiCidr),
        preview: targets.length ? (summaryOf([{ type: 'pc', count: 2 }, { type: 'printer', count: 2 }, { type: 'server', count: 1 }], targets[0].id) || {}).html : '',
        bulk: state.networks.map((net) => flat(bulkPlanMove(state.nodes.filter((n) => !isRoutingDevice(n.type)).slice(0, 12).map((n) => n.id), net.id))) };
      return res;
    };
    const shapeDrift = [];
    let shaped = 0, wifiTemplates = 0, badShape = 0;
    Object.keys(templatesData).forEach((k) => {
      const base = runTemplate(cloneData(templatesData[k]));
      if (base.wifi) wifiTemplates++;
      Object.entries(shapes).forEach(([why, shape]) => {
        const doc = cloneData(templatesData[k]);
        let any = false;
        (doc.networks || []).forEach((net) => {
          const p = parseValidCIDR(net.cidr);
          if (!p) return;
          const r = usableRange(p);
          if (r.last - r.first < 4n) return;
          Object.assign(net, shape(r, p));
          if (dhcpPoolOf(net, p) && dhcpPoolOf(net, p).valid) badShape++;
          any = true;
        });
        if (!any) return;
        shaped++;
        const got = runTemplate(doc);
        if (show(got.plans) !== show(base.plans)) shapeDrift.push(`${k} ${why}: plan`);
        if (got.preview !== base.preview) shapeDrift.push(`${k} ${why}: preview`);
        if (show(got.bulk) !== show(base.bulk)) shapeDrift.push(`${k} ${why}: bulk`);
      });
    });
    ok('every pool shape used on the templates is one that does not count', !badShape, `${badShape} counted`);
    ok('on every template, a pool that does not count on every network changes no plan, preview or bulk plan, Wi-Fi targets included',
       !shapeDrift.length && shaped >= Object.keys(templatesData).length && wifiTemplates > 0, `${shapeDrift.slice(0, 6).join(' | ')} (shaped ${shaped}, with Wi-Fi ${wifiTemplates})`);

    // With no pool, a Wi-Fi target's radio devices take the old run: the
    // lowest free addresses of the SSID's subnet less the cabled ones.
    const wifiOdd = [];
    let wifiChecked = 0;
    Object.keys(templatesData).forEach((k) => {
      replaceDocument(cloneData(templatesData[k]), { origin: 'file' });
      state.nodes.filter((n) => hasPortGrid(n) && !isRetired(n)).forEach((tg) => {
        const pl = planAddDevices({ items: kinds, pattern: '', targetId: tg.id });
        if (!pl.wifiCidr) return;
        const cabled = new Set(pl.devices.filter((d) => d.ip && !d.wireless).map((d) => bare(d.ip)));
        const radio = pl.devices.filter((d) => d.ip && d.wireless).map((d) => bare(d.ip));
        const want = freeAddresses(pl.wifiCidr, radio.length + cabled.size).filter((ip) => !cabled.has(ip)).slice(0, radio.length);
        if (show(radio) !== show(want)) wifiOdd.push(`${k}:${tg.name}: ${show(radio)} vs ${show(want)}`);
        if (radio.length) wifiChecked++;
      });
    });
    ok('with no pool, Wi-Fi targets on the templates hand out the old run', !wifiOdd.length && wifiChecked > 0, `${wifiOdd.slice(0, 3).join(' | ')} (checked ${wifiChecked})`);

    // ---- 7. A block whose network has a pool, onto a taken range ----
    site(lan({ cidr: '10.80.0.0/24', gateway: '10.80.0.1', dhcpFirst: '10.80.0.2', dhcpLast: '10.80.0.99' }));
    const blockDoc = { nodes: [{ id: 'x', type: 'printer', name: 'Block printer', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.80.0.5/24' }] }], links: [],
      networks: [{ id: 'bn', cidr: '10.80.0.0/24', name: 'Block net', gateway: '10.80.0.1', dhcp: true, dhcpFirst: '10.80.0.150', dhcpLast: '10.80.0.199' }] };
    const done = insertBlock({ key: 'test', name: 'Test', doc: blockDoc });
    const bpNode = done && getNode(done.nodeIds[0]);
    ok('a block onto a taken range moves to a free subnet', !!bpNode && !bare(bpNode.interfaces[0].ip).startsWith('10.80.0.'), bpNode && bpNode.interfaces[0].ip);
    const movedNet = bpNode && networkOfIp(bare(bpNode.interfaces[0].ip));
    const movedP = movedNet && parseValidCIDR(movedNet.cidr);
    const base3 = movedP && movedP.networkStr.split('/')[0].split('.').slice(0, 3).join('.');
    ok('its network\'s pool moves with it, at the same host bits, and still counts', !!movedNet && movedNet.name === 'Block net'
       && movedNet.dhcpFirst === `${base3}.150` && movedNet.dhcpLast === `${base3}.199` && dhcpPoolOf(movedNet).valid,
       movedNet && show([movedNet.cidr, movedNet.dhcpFirst, movedNet.dhcpLast]));

    // ---- 8. An AP whose SSID is on its own pooled LAN ----
    const apSite = (wifiNet) => replaceDocument({ v: DOC_VERSION,
      networks: [{ id: 'n1', cidr: '10.0.1.0/24', name: 'Office', gateway: '10.0.1.1', dhcp: true, dhcpFirst: '10.0.1.2', dhcpLast: '10.0.1.99' },
        { id: 'n2', cidr: '10.0.2.0/24', name: 'Guest', gateway: '10.0.2.1', dhcp: true, dhcpFirst: '10.0.2.2', dhcpLast: '10.0.2.99' }],
      wifi: [{ id: 'wS', ssid: 'Office', security: 'wpa2', network: wifiNet }],
      nodes: [
        { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'lan', ip: '10.0.1.1/24' }] },
        { id: 'ap', type: 'ap', name: 'AP-1', x: 0, y: 120, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.200/24' },
          { id: 'w1', name: 'wlan0', ip: '', radio: { standard: 'ax', bands: [{ band: '2.4', channel: 1 }, { band: '5', channel: 36 }] } }] }],
      links: [{ id: 'l0', source: 'rt', target: 'ap', sourceIface: 'i1', targetIface: 'i1' }] }, { origin: 'file' });
    apSite('n1');
    const apMix = [{ type: 'firewall', count: 1 }, { type: 'server', count: 1 }, { type: 'pc', count: 2 }];
    p = planAddDevices({ items: apMix, pattern: '', targetId: 'ap', ssid: 'wS' });
    const byType = (ty) => p.devices.filter((d) => d.type === ty);
    const inLan = (ip) => { const n = Number(bare(ip).split('.')[3]); return n >= 2 && n <= 99; };
    ok('the add has a cabled firewall and radio devices on the one pooled LAN', p.wifiCidr === p.cidr && !byType('firewall')[0].wireless && byType('server')[0].wireless, show(p.devices));
    ok('the cabled and the radio devices never share an address', new Set(ips(p)).size === 4 && ips(p).every(Boolean), show(ips(p)));
    ok('the firewall and the server are kept out of the pool, the PCs inside it', show([byType('firewall')[0].ip, byType('server')[0].ip].map(bare)) === show(['10.0.1.100', '10.0.1.101'])
       && byType('pc').every((d) => inLan(d.ip)), show(ips(p)));

    // ---- 9. An AP whose SSID is on another pooled subnet ----
    apSite('n2');
    p = planAddDevices({ items: [{ type: 'printer', count: 1 }], pattern: '', targetId: 'ap', ssid: 'wS' });
    ok('a printer joining by radio is kept out of the SSID subnet\'s pool', bare(p.devices[0].ip) === '10.0.2.100' && p.devices[0].wireless, show(p.devices));
    s = summaryOf([{ type: 'printer', count: 1 }], 'ap');
    ok('the pool line names only the pool it was kept out of', !!s && s.text.includes('Kept out of the DHCP pool 10.0.2.2–10.0.2.99, because it keeps a fixed address: Printer (10.0.2.100).')
       && !s.text.includes('10.0.1.2–10.0.1.99'), s && s.text);
    s = summaryOf([{ type: 'printer', count: 1 }, { type: 'firewall', count: 1 }], 'ap');
    ok('one line per pool when devices are kept out of both', !!s && s.text.includes('Kept out of the DHCP pool 10.0.1.2–10.0.1.99, because it keeps a fixed address: Firewall (10.0.1.100).')
       && s.text.includes('Kept out of the DHCP pool 10.0.2.2–10.0.2.99, because it keeps a fixed address: Printer (10.0.2.100).'), s && s.text);
  } catch (e) {
    ok('the suite ran', false, e && (e.stack || e.message));
  }
  setLocale('en');
  setDialogResponder(heldResponder);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 50); });
