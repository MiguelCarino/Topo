// @realtime @touch 360x740
// Answer checks and Monitor from this PC (js/checks.js, node.checks and
// node.target in js/model.js; docs/SCOPE.md D155-D157, D161-D163, step 7f,
// D227-D242), against a stub of the app's monitor commands
// (desktop/src-tauri/src/monitorcmd.rs, which, with monitor.rs, checks.rs
// and stats.rs, has its own cargo tests against loopback fakes). Covered:
//   - format v19: the check blocks read and written (an unknown protocol
//     dropped, the interval kept within 30 s to 15 min and 60 s left out,
//     ids minted and kept unique, at most 8, AE titles, the DNS name and
//     the page checked), the availability target; a v18 document with no
//     checks serializes as before, and one with checks comes through the
//     migration; the schema's check block names the same keys;
//   - the plan on tests/fixtures/site300.js: one item per check of a device
//     in service (a retired or planned one is not asked), the address, the
//     ping's TCP port from what the device documents, the interval, the
//     groups innermost first, and the upstream chain for root cause: from
//     the device's own router when this PC is not on the map, from this PC
//     (found by its MAC) when it is;
//   - on the website (no window.__TAURI__) the Check section and Settings'
//     Monitor from this PC stay hidden, no dot is drawn, nothing is asked;
//   - in the app (window.__TAURI__ stubbed): Settings shows the switch off
//     as shipped and Keep statistics at 360 days; Add a check is one undo
//     step, as is each field; a bad port is refused; the target is kept;
//   - turning it on: a network not kept is refused in words; the offer
//     names the network with the tray and sign-in both ticked; Turn on sends
//     the plan, then the switch with the tray's words in the page's language;
//   - the app's events: the dot on the map (down, down because of a device
//     upstream, quiet), the Check section's line, no dot in an export;
//   - the last 24 h: the chart, the state bar and the numbers; "Statistics
//     are off" with retention Off;
//   - Keep statistics: a shorter period says what goes and deletes only
//     after a yes; Quiet for… on the device;
//   - turning it off takes the dots away;
//   - every sentence translated; Japanese says PC;
//   - the section and Settings at 360 (44px targets, 16px fields, no
//     sideways scroll); no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const change = (x, v) => { if (v !== undefined) { if (x.type === 'checkbox') x.checked = v; else x.value = v; } x.dispatchEvent(new Event('change', { bubbles: true })); };
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const CK = window.TopoChecks;
  const asked = [];
  let confirmAnswer = true;
  const dialogs = [];
  setDialogResponder((q) => { dialogs.push(q); return q.kind === 'confirm' ? confirmAnswer : undefined; });

  // ---- The app's monitor, as monitorcmd.rs answers ----
  const info = { on: false, running: false, elsewhere: false, retentionDays: 360, tray: false, autostart: false, networkId: '', networkName: '', count: 0,
    quiet: { site: 0, nodes: {}, groups: {} }, platform: 'linux', statsFile: '' };
  let statuses = [];
  const history = {};
  let listener = null;
  let lastPlan = null;
  const invoke = async (cmd, args) => {
    await wait(2);
    if (!/^monitor_|^this_computer$/.test(cmd)) return null;
    asked.push({ cmd, args: clone(args || {}) });
    switch (cmd) {
      case 'monitor_info': return clone(info);
      case 'monitor_set': {
        const a = args.args || {};
        ['on', 'tray', 'autostart', 'retentionDays'].forEach((k) => { if (a[k] !== undefined) info[k] = a[k]; });
        info.running = info.on;
        return clone(info);
      }
      case 'monitor_plan': lastPlan = clone(args.plan); info.networkId = args.plan.networkId; info.networkName = args.plan.networkName; info.count = args.plan.items.length; return clone(info);
      case 'monitor_status': return clone(statuses);
      case 'monitor_history': return clone(history[args.key] || { kept: info.retentionDays > 0, samples: [] });
      case 'monitor_quiet': {
        if (args.scope === 'site') info.quiet.site = args.until;
        else info.quiet[args.scope === 'node' ? 'nodes' : 'groups'][args.id] = args.until;
        return clone(info);
      }
      case 'monitor_older': return { hours: 12, items: 2, oldest: Date.now() - 100 * 86400000, samples: args.days === 0 ? 40 : 0 };
      case 'this_computer': return { hostname: 'mon', interfaces: [{ name: 'eth0', mac: '52:54:00:02:00:2A', addresses: [] }] };
      default: return null;
    }
  };
  const listen = async (name, cb) => { if (name === 'topo-monitor') listener = cb; return () => {}; };
  const lastSet = () => asked.filter((x) => x.cmd === 'monitor_set').pop();

  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await loadScript('tests/fixtures/site300.js');

    // ---- Format v19 ----
    const cs = asChecks([
      { proto: 'PING' },
      { id: 'ck_a', proto: 'tcp', port: '9100', interval: 5 },
      { id: 'ck_a', proto: 'https', path: '/status', interval: 60, slowMs: 250 },
      { id: 'ck_b', proto: 'snmp' },
      { id: 'ck_c', proto: 'dns', name: 'pacs.clinic.local.', interval: 99999 },
      { id: 'ck_d', proto: 'dicom', calledAe: 'PACS', callingAe: 'A\\B', port: 11112 },
      { id: 'ck_e', proto: 'smtp', starttls: true, name: 'not for smtp' },
      { id: 'ck_f', proto: 'http', path: 'no-slash' }
    ], true);
    ok('an unknown protocol is dropped; the others kept in order', cs.map((c) => c.proto).join() === 'ping,tcp,https,dns,dicom,smtp,http', cs.map((c) => c.proto).join());
    ok('a block with no id gets one; a repeated id is reminted', /^ck_/.test(cs[0].id) && cs[1].id === 'ck_a' && cs[2].id !== 'ck_a' && new Set(cs.map((c) => c.id)).size === cs.length);
    ok('the interval within 30 s to 15 min; 60 s left out', cs[1].interval === 30 && cs[2].interval === undefined && cs[3].interval === 900);
    ok('the port read from text; slow above; the path', cs[1].port === 9100 && cs[2].slowMs === 250 && cs[2].path === '/status' && cs[6].path === undefined);
    ok('the DNS name without its dot; options only where they mean something', cs[3].name === 'pacs.clinic.local' && cs[5].name === undefined && cs[5].starttls === true);
    ok('AE titles: a backslash is not one', cs[4].calledAe === 'PACS' && cs[4].callingAe === undefined && cs[4].port === 11112);
    ok('keys in one order', JSON.stringify(Object.keys(asChecks([{ id: 'x', proto: 'dicom', slowMs: 9, interval: 120, callingAe: 'B', calledAe: 'A', port: 104, ip: '10.0.0.1' }], false)[0]))
      === '["id","proto","ip","port","calledAe","callingAe","interval","slowMs"]');
    ok('at most 8 a device', asChecks(Array.from({ length: 12 }, () => ({ proto: 'ping' })), true).length === CHECKS_MAX);
    ok('writing never mints an id', asChecks([{ proto: 'ping' }], false) === undefined);
    ok('no password anywhere', !JSON.stringify(cs).match(/pass|secret|auth/i));
    ok('the availability target', asTarget('99,5') === 99.5 && asTarget('99.95%') === 99.95 && asTarget(100) === undefined && asTarget(0) === undefined && asTarget('x') === undefined);
    ok('…rounded before its range is checked, so it never becomes 0 or 100', asTarget('99.9999') === undefined && asTarget('0.0001') === undefined
      && asTarget('99.9994') === 99.999 && asTarget('0.0006') === 0.001, [asTarget('99.9999'), asTarget('0.0001')].join());
    const v18 = { v: 18, nodes: [{ id: 'a', type: 'server', name: 'A', x: 0, y: 0, interfaces: [], checks: [{ id: 'c1', proto: 'ping' }], target: 99.5 }, { id: 'b', type: 'pc', name: 'B', x: 0, y: 0, interfaces: [] }], links: [] };
    const mig = migrateDoc(clone(v18));
    ok('v18 -> v19: nothing to convert', mig.from === 18 && mig.doc.v === 19 && !mig.newer && JSON.stringify(mig.doc.nodes[0].checks) === '[{"id":"c1","proto":"ping"}]');
    replaceDocument(clone(v18), { origin: 'file' });
    const ser = serializeDoc();
    ok('a device with checks keeps them; one without writes no key', JSON.stringify(ser.nodes[0].checks) === '[{"id":"c1","proto":"ping"}]' && ser.nodes[0].target === 99.5
      && !/checks|target/.test(JSON.stringify(ser.nodes[1])) && ser.v === 19, JSON.stringify(ser.nodes));
    const schema = JSON.parse(await (await fetch(`schema/topo-v${DOC_VERSION}.json`)).text());
    const keysOf = Object.keys(schema.$defs.check.properties).sort().join();
    ok('the schema names the check block\'s keys', keysOf === ['id', 'proto', 'ip', 'port', 'path', 'name', 'starttls', 'tls', 'transport', 'calledAe', 'callingAe', 'interval', 'slowMs', 'monitors'].sort().join(), keysOf);

    // ---- The plan, on a 300-device site ----
    const site = canonicalDoc(topoSite300());
    const nodeOf = (d, id) => d.nodes.find((n) => n.id === id);
    nodeOf(site, 'rt').checks = [{ id: 'p', proto: 'ping' }, { id: 'w', proto: 'https' }];
    nodeOf(site, 'sw1').checks = [{ id: 'p', proto: 'ping' }];
    nodeOf(site, 'core').checks = [{ id: 'p', proto: 'ping' }];
    const prn = site.nodes.find((n) => n.type === 'printer' && site.links.some((l) => (l.source === 'sw1' && l.target === n.id)));
    prn.ports = '9100, 631/udp';
    prn.checks = [{ id: 'p', proto: 'ping', interval: 120, slowMs: 80 }];
    nodeOf(site, 'h200').checks = [{ id: 'p', proto: 'ping' }];   // retired
    const plannedPc = site.nodes.find((n) => n.type === 'pc' && n.id !== 'h200' && n.id !== prn.id);
    plannedPc.status = 'planned'; plannedPc.checks = [{ id: 'p', proto: 'ping' }];
    const plan = CK.monitorPlan(site, { networkId: 'k1', networkName: 'HQ' });
    const item = (key) => plan.items.find((i) => i.key === key);
    ok('one item per check of a device in service', plan.items.map((i) => i.key).sort().join() === ['rt/p', 'rt/w', 'sw1/p', 'core/p', `${prn.id}/p`].sort().join(), plan.items.map((i) => i.key).join());
    const pi = item(`${prn.id}/p`);
    ok('its address, interval and slow above', pi.spec.host === prn.interfaces[0].ip.split('/')[0] && pi.intervalS === 120 && pi.slowMs === 80 && pi.spec.proto === 'ping');
    ok('a ping\'s TCP port is the first TCP port the device documents', pi.spec.fallbackPort === 9100 && pi.spec.port === 0);
    ok('the interval is 60 s when the block says none', item('core/p').intervalS === 60);
    ok('the groups it is in, innermost first', JSON.stringify(item('core/p').groups) === '["g-mdf-r1","g-mdf","g-hq"]', JSON.stringify(item('core/p').groups));
    ok('this PC not on the map: the chain runs from the device\'s router', JSON.stringify(pi.chain) === '["rt","core","sw1"]', JSON.stringify(pi.chain));
    ok('…a switch behind the router', JSON.stringify(item('sw1/p').chain) === '["rt","core"]', JSON.stringify(item('sw1/p').chain));
    ok('…a router itself has none (D237)', JSON.stringify(item('rt/p').chain) === '[]', JSON.stringify(item('rt/p').chain));
    const pair = { nodes: [
      { id: 'fw', type: 'firewall', name: 'FW', x: 0, y: 0, interfaces: [{ ip: '10.0.0.1/24' }], checks: [{ id: 'p', proto: 'ping' }] },
      { id: 'l3', type: 'l3switch', name: 'L3', x: 0, y: 0, interfaces: [{ ip: '10.0.0.2/24' }], checks: [{ id: 'p', proto: 'ping' }] },
      { id: 'pc', type: 'pc', name: 'PC', x: 0, y: 0, interfaces: [{ ip: '10.0.1.5/24' }], checks: [{ id: 'p', proto: 'ping' }] }],
      links: [{ id: 'l1', source: 'fw', target: 'l3' }, { id: 'l2', source: 'l3', target: 'pc' }] };
    const pp = CK.monitorPlan(pair, {});
    const ch = (k) => JSON.stringify(pp.items.find((i) => i.key === k).chain);
    ok('two routers side by side are not each other\'s cause', ch('fw/p') === '[]' && ch('l3/p') === '[]' && ch('pc/p') === '["l3"]', [ch('fw/p'), ch('l3/p'), ch('pc/p')].join(' '));
    // SMTP only where the device documents it (D155, D241).
    const mail = { nodes: [
      { id: 'm1', type: 'server', name: 'M1', x: 0, y: 0, interfaces: [{ ip: '10.0.0.9/24' }], ports: '25, 443', checks: [{ id: 's', proto: 'smtp' }] },
      { id: 'm2', type: 'server', name: 'M2', x: 0, y: 0, interfaces: [{ ip: '10.0.0.10/24' }], ports: '443', checks: [{ id: 's', proto: 'smtp' }] },
      { id: 'm3', type: 'server', name: 'M3', x: 0, y: 0, interfaces: [{ ip: '10.0.0.11/24' }], ports: '587', checks: [{ id: 's', proto: 'smtp', port: 587 }] }], links: [] };
    ok('an SMTP check runs only where the device documents SMTP on its port', CK.monitorPlan(mail, {}).items.map((i) => i.key).join() === 'm1/s,m3/s',
      CK.monitorPlan(mail, {}).items.map((i) => i.key).join());
    const me = site.nodes.find((n) => n.type === 'pc' && site.links.some((l) => l.source === 'sw2' && l.target === n.id));
    const plan2 = CK.monitorPlan(site, { me: me.id });
    ok('this PC on the map: the chain runs from it, nearest first', JSON.stringify(plan2.items.find((i) => i.key === `${prn.id}/p`).chain) === '["sw2","core","sw1"]',
      JSON.stringify(plan2.items.find((i) => i.key === `${prn.id}/p`).chain));
    ok('…and the router is behind the core from here', JSON.stringify(plan2.items.find((i) => i.key === 'rt/p').chain) === '["sw2","core"]');
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) CK.monitorPlan(site, { me: me.id });
    ok('worked out quickly on 300 devices', (performance.now() - t0) / 5 < 200, `${Math.round((performance.now() - t0) / 5)} ms`);

    // ---- The website ----
    persistLibrary({ k1: { id: 'k1', name: 'HQ', doc: clone(site), created: 1, updated: Date.now() - 1000 } });
    replaceDocument(libraryEntry('k1').doc, { libraryId: 'k1', origin: 'library' });
    select(prn.id, 'node'); await settle();
    ok('on the website: no host', !window.__TAURI__ && !CK.hasHost());
    ok('…no Answer checks in the device panel', el('checkGroup').hidden === true);
    ok('…no dot on the map', !document.querySelector('#layer-nodes .node-status') && checkMarkEl(getNode(prn.id)) === null);
    openSettings(); await settle();
    ok('…no Monitor from this PC in Settings', el('setMonSec').hidden === true);
    closeSettings();
    ok('…and nothing was asked of an app', asked.length === 0);

    // ---- In the app ----
    window.__TAURI__ = { core: { invoke }, event: { listen } };
    await CK.refreshInfo();
    openSettings(); await settle();
    ok('in the app, Settings shows Monitor from this PC', el('setMonSec').hidden === false);
    ok('off as shipped', el('setMonOn').checked === false && el('setMonOnBox').hidden && el('setMonOffer').hidden);
    ok('Keep statistics: 360 days', el('setMonKeep').value === '360' && el('setMonKeep').selectedOptions[0].textContent === '360 days (default)');
    ok('the line says it is off', el('setMonStatus').textContent === 'Off. Nothing is checked from this PC.');
    closeSettings();
    select(prn.id, 'node'); await settle();
    ok('the device panel offers Answer checks', el('checkGroup').hidden === false);
    el('checkGroup').open = true; await settle(); await until(() => el('checkBody').children.length > 0);
    ok('the section shows its check, and says the monitor is off', el('checkBody').querySelectorAll('.ck-card').length === 1
      && /Monitor from this PC is off/.test(el('checkBody').textContent));
    const before = JSON.stringify(serializeDoc());
    el('checkBody').querySelector('[data-ck="add"]').click(); await settle();
    const added = getNode(prn.id).checks;
    ok('Add a check adds a ping', added.length === 2 && added[1].proto === 'ping' && /^ck_/.test(added[1].id));
    undo(); flushAutosave(); await settle();
    ok('…in one undo step', JSON.stringify(serializeDoc()) === before && getNode(prn.id).checks.length === 1);
    select(prn.id, 'node'); await settle();
    const card = () => el('checkBody').querySelector('.ck-card');
    const field = (f) => card().querySelector(`[data-f="${f}"]`);
    change(field('port'), 'abc'); await settle();
    ok('a port that is not one is refused and kept as typed, marked', field('port').classList.contains('bad') && getNode(prn.id).checks[0].port === undefined);
    change(field('port'), '9100'); await settle();
    ok('a port is kept', getNode(prn.id).checks[0].port === 9100);
    const afterPort = JSON.stringify(serializeDoc());
    change(field('proto'), 'https'); await settle();
    ok('another protocol: its own fields, the port its own again', getNode(prn.id).checks[0].proto === 'https' && getNode(prn.id).checks[0].port === undefined
      && getNode(prn.id).checks[0].interval === 120 && !!field('path'));
    undo(); flushAutosave(); await settle();
    ok('…one undo step each', JSON.stringify(serializeDoc()) === afterPort);
    select(prn.id, 'node'); await settle();
    change(el('ckTarget'), '99,5'); await settle();
    ok('the availability target is kept', getNode(prn.id).target === 99.5);
    change(field('slowMs'), '150'); await settle();
    ok('slow above is kept', getNode(prn.id).checks[0].slowMs === 150);

    // ---- Turning it on ----
    replaceDocument(clone(site), { origin: 'file' });
    openSettings(); await settle();
    change(el('setMonOn'), true); await settle();
    ok('a network not kept is refused in words', await until(() => dialogs.some((d) => /Keep this network in My networks first/.test(d.message))) && el('setMonOn').checked === false
      && !asked.some((a) => a.cmd === 'monitor_set'));
    closeSettings();
    replaceDocument(libraryEntry('k1').doc, { libraryId: 'k1', origin: 'library' });
    getNode(prn.id).checks = [{ id: 'p', proto: 'ping' }]; save();
    openSettings(); await settle();
    change(el('setMonOn'), true); await settle();
    ok('the offer names the network, with the tray and sign-in ticked', !el('setMonOffer').hidden && /It checks HQ/.test(el('setMonOfferText').textContent)
      && el('setMonOfferTray').checked && el('setMonOfferAuto').checked);
    await audit('Settings, the offer');
    el('setMonOfferGo').click();
    ok('Turn on sends the plan, then the switch', await until(() => info.on) && asked.findIndex((a) => a.cmd === 'monitor_plan') < asked.findIndex((a) => a.cmd === 'monitor_set'));
    const s1 = lastSet().args.args;
    ok('…with the tray and sign-in, and the tray\'s words', s1.on === true && s1.tray === true && s1.autostart === true && s1.labels.open === 'Open Topo' && s1.labels.tipDown === 'Topo: {n} not answering');
    ok('the plan is the open network\'s', lastPlan.networkId === 'k1' && lastPlan.networkName === 'HQ' && lastPlan.items.some((i) => i.key === `${prn.id}/p`));
    await settle();
    ok('Settings says what it monitors', /Monitoring HQ: 5 checks\./.test(el('setMonStatus').textContent) && !el('setMonOnBox').hidden, el('setMonStatus').textContent);
    ok('this PC found on the map by its MAC (this_computer)', asked.some((a) => a.cmd === 'this_computer'));
    await audit('Settings, monitoring');
    closeSettings();
    // An edit of the network sends the plan again, a moment later.
    getNode('sw1').checks = [{ id: 'p', proto: 'ping' }]; save(); renderCanvasOnly();
    ok('an edit sends the plan again', await until(() => lastPlan.items.some((i) => i.key === 'sw1/p')));

    // ---- The app's events ----
    ok('the app\'s events are listened to', typeof listener === 'function');
    const now = Date.now();
    const st = (key, nodeId, state, extra) => Object.assign({ key, nodeId, state, slow: false, flapping: false, since: now - 14 * 60000, checked: now, rttMs: null, status: '', via: 'icmp', certNotAfter: null, quietUntil: null }, extra || {});
    listener({ payload: [st(`${prn.id}/p`, prn.id, 'up', { rttMs: 3.2, status: 'echo' }), st('sw1/p', 'sw1', 'up', { rttMs: 1, status: 'echo' })] });
    const look = (id) => { const g = document.getElementById('ui-node-' + id); const m = g && g.querySelector('.node-status'); return m ? m.getAttribute('data-look') : null; };
    ok('answering: a dot on the map', await until(() => look(prn.id) === 'up') && document.querySelectorAll('#layer-nodes .node-status').length >= 2,
      String(look(prn.id)) + ' ' + document.querySelectorAll('#layer-nodes .node-status').length);
    select(prn.id, 'node'); await settle(); el('checkGroup').open = true; await settle();
    ok('the Check section says it answers', /Answering · 3\.2 ms/.test(card().querySelector('.ck-now').textContent), card().querySelector('.ck-now').textContent);
    listener({ payload: [st('sw1/p', 'sw1', 'down', { status: 'timeout' }), st(`${prn.id}/p`, prn.id, 'down', { cause: 'sw1', status: 'timeout' })] });
    await wait(400);
    ok('down, and down because of the switch upstream', CK.nodeLook(getNode('sw1')) === 'down' && CK.nodeLook(getNode(prn.id)) === 'cause'
      && document.querySelectorAll('#layer-nodes .node-status[data-look="down"]').length === 1 && document.querySelectorAll('#layer-nodes .node-status[data-look="cause"]').length === 1);
    ok('the line names the device upstream', /Not answering since .*, because SW-ACC-1 is not answering/.test(card().querySelector('.ck-now').textContent), card().querySelector('.ck-now').textContent);
    ok('no dot in an export of the map', !canvasSvgMarkup().markup.includes('node-status'));
    listener({ payload: [st('sw1/p', 'sw1', 'quiet', { quietUntil: now + 3600000 })] });
    await wait(400);
    ok('quiet is its own look', CK.nodeLook(getNode('sw1')) === 'quiet');
    listener({ payload: [st(`${prn.id}/p`, prn.id, 'up', { flapping: true, rttMs: 2 })] });
    ok('flapping is said', CK.nodeLook(getNode(prn.id)) === 'flapping' && /Flapping: 4 changes in 30 min/.test(CK.nowText(CK.state.status.get(`${prn.id}/p`), getNode(prn.id))));
    ok('TCP, not ping, is said', /TCP, not ping/.test(CK.nowText(st('x/y', 'x', 'up', { via: 'tcp', status: 'open', rttMs: 1 }))));
    ok('a certificate near its end is said', /The certificate ends in 9 days/.test(CK.nowText(st('x/y', 'x', 'up', { certNotAfter: Math.floor(now / 1000) + 9 * 86400 + 3600, status: '200' }))));
    ok('a ping this PC may not ask, with no TCP port, says so', /may not ping/.test(CK.nowText(st('x/y', 'x', 'unknown', { status: 'no-icmp', via: 'tcp' }))));

    // ---- The last 24 h ----
    const key = `${prn.id}/p`;
    history[key] = { kept: true, samples: [
      { t: now - 3 * 3600000, ok: true, rtt: 4, status: 'echo', state: 'up', upstream: false, iv: 60000, via: 'icmp' },
      { t: now - 3 * 3600000 + 60000, ok: true, rtt: 6, status: 'echo', state: 'up', upstream: false, iv: 60000, via: 'icmp' },
      { t: now - 3 * 3600000 + 120000, ok: false, rtt: null, status: 'timeout', state: 'up', upstream: false, iv: 60000, via: 'icmp' },
      { t: now - 3 * 3600000 + 180000, ok: true, rtt: 30, status: 'echo', state: 'slow', upstream: false, iv: 60000, via: 'icmp' }] };
    CK.state.hist.clear();
    select(prn.id, 'node'); await settle();
    const day = () => el('checkBody').querySelector('.ck-day');
    ok('the last 24 h: a chart and a state bar', await until(() => !!day().querySelector('.ck-chart path')) && /^M/.test(day().querySelector('.ck-chart path').getAttribute('d'))
      && day().querySelectorAll('.ck-bar rect').length === 288 && day().querySelectorAll('.ck-bar .ck-bar-slow').length === 1);
    ok('…and its numbers in words', /3 of 4 answered · median 6 ms · 95th 30 ms · availability 100 % \([\d.]+ % measured\)/.test(day().querySelector('.ck-day-sum').textContent), day().querySelector('.ck-day-sum').textContent);
    const b = CK.dayBuckets(history[key].samples, now);
    ok('five-minute buckets: the median answer and the worst state', b.length === 288 && b.filter((x) => x.state !== 'none').length === 1 && b.find((x) => x.state !== 'none').med === 6);
    const sum = CK.daySummary([
      { t: now - 3600000, ok: true, rtt: 5, state: 'up', iv: 60000 }, { t: now - 3600000 + 60000, ok: false, rtt: null, state: 'down', iv: 60000 },
      { t: now - 3600000 + 120000, ok: true, rtt: 5, state: 'quiet', iv: 60000 }], now);
    ok('availability leaves out quiet time; the coverage is said', sum.avail === 0.5 && sum.coverage > 0 && sum.coverage < 0.05, JSON.stringify(sum));

    // ---- Another Topo runs the monitor ----
    info.elsewhere = true; await CK.refreshInfo();
    ok('when the monitor runs in another Topo, no dot is drawn here', checkMarkEl(getNode(prn.id)) === null);
    info.elsewhere = false; await CK.refreshInfo();
    ok('…and it is back once it runs here', checkMarkEl(getNode(prn.id)) !== null);
    // An interval from a file that the list does not hold shows as itself.
    getNode(prn.id).checks[0].interval = 45; select(prn.id, 'node'); await settle();
    ok('an unlisted interval shows as itself', card().querySelector('[data-f="interval"]').selectedOptions[0].textContent === '45 s', card().querySelector('[data-f="interval"]').selectedOptions[0].textContent);
    delete getNode(prn.id).checks[0].interval;
    // SMTP is offered only where the device documents it.
    const was = getNode(prn.id).ports;
    select(prn.id, 'node'); await settle();
    ok('no SMTP offered on a device with no SMTP port', ![...card().querySelector('[data-f="proto"]').options].some((o) => o.value === 'smtp'));
    getNode(prn.id).ports = '9100, 587'; select(prn.id, 'node'); await settle();
    ok('…offered once it documents 587', [...card().querySelector('[data-f="proto"]').options].some((o) => o.value === 'smtp'));
    change(card().querySelector('[data-f="proto"]'), 'smtp'); await settle();
    ok('…and picked, it asks the documented port', getNode(prn.id).checks[0].proto === 'smtp' && getNode(prn.id).checks[0].port === 587 && !/does not document SMTP/.test(card().textContent));
    change(card().querySelector('[data-f="port"]'), '25'); await settle();
    ok('an SMTP port the device does not document is said, and not checked', /does not document SMTP on port 25/.test(card().textContent));
    undo(); undo(); flushAutosave(); getNode(prn.id).ports = was; save(); select(prn.id, 'node'); await settle();

    // ---- Keep statistics ----
    openSettings(); await settle();
    confirmAnswer = false;
    const sets = asked.filter((a) => a.cmd === 'monitor_set').length;
    change(el('setMonKeep'), '30');
    ok('a shorter period says what goes first', await until(() => dialogs.some((d) => /Keep 30 days\? 12 hourly figures of 2 checks are older than that/.test(d.message))));
    ok('…and No keeps them', await until(() => el('setMonKeep').value === '360') && asked.filter((a) => a.cmd === 'monitor_set').length === sets);
    confirmAnswer = true;
    change(el('setMonKeep'), '0');
    ok('Off says everything goes, samples too', await until(() => dialogs.some((d) => /Turn statistics off\? .*12 hourly figures of 2 checks and 40 samples/.test(d.message))));
    ok('…and Yes turns it off', await until(() => info.retentionDays === 0) && lastSet().args.args.retentionDays === 0);
    closeSettings();
    CK.state.hist.clear();
    delete history[key];
    select(prn.id, 'node'); await settle();
    ok('with Off, the section says nothing is kept', await until(() => /Statistics are off on this PC: nothing is kept\./.test(el('checkBody').textContent)));

    // ---- Quiet ----
    const q = el('ckQuiet');
    ok('Quiet for… offers the device and its group', !!q && [...q.querySelectorAll('optgroup')].length === 2);
    change(q, 'node:1h');
    ok('quiet for an hour asks the app for the device', await until(() => asked.some((a) => a.cmd === 'monitor_quiet' && a.args.scope === 'node' && a.args.id === prn.id
      && Math.abs(a.args.until - (Date.now() + 3600000)) < 60000)));
    ok('the morning is 08:00 tomorrow', new Date(CK.quietUntil('morning', new Date(2026, 10, 11, 22, 30).getTime())).toString() === new Date(2026, 10, 12, 8, 0, 0, 0).toString());
    await audit('Answer checks');

    // ---- Translated ----
    const strings = ['Answer checks', 'Monitor from this PC', 'Not answering since {time}', 'Not answering since {time}, because {name} is not answering', 'TCP, not ping',
      'Open Topo at sign-in', 'Keep Topo in the system tray when the window is closed', 'Keep statistics', 'Statistics are off on this PC: nothing is kept.',
      'Topo: {n} not answering', 'Quiet (maintenance)', 'This device does not document SMTP on port {port} (Allowed ports), so this check is not run.', 'Availability target (%)', 'Monitor this network instead', 'Last 24 h', 'availability {pct} ({cov} measured)',
      'Asks each device and service with an answer check one question, "are you answering?", from this PC, and keeps how long they take. It never scans or discovers anything, and never reads a device\'s settings.'];
    const missing = [];
    CarinoI18N.locales.filter((l) => l !== 'en').forEach((l) => strings.forEach((s) => { if (!CarinoI18N.has(l, s)) missing.push(`${l}: ${s.slice(0, 40)}`); }));
    ok('every sentence of the checks is translated', !missing.length, `${missing.length}: ${missing.slice(0, 3).join(' | ')}`);
    setLocale('ja');
    ok('Japanese says PC', /PC/.test(t('Monitor from this PC')) && strings.map((s) => t(s)).join('').match(/パソコン|コンピューター/) === null);
    setLocale('es');
    ok('in Spanish', t('Answer checks') === 'Comprobaciones de respuesta');
    setLocale('en');

    // ---- Turning it off ----
    openSettings(); await settle();
    change(el('setMonOn'), false);
    ok('off: the app is told', await until(() => info.on === false) && lastSet().args.args.on === false);
    closeSettings();
    renderCanvasOnly(); await settle();
    ok('…and the dots go', !document.querySelector('#layer-nodes .node-status'));
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (err) {
    ok('the suite ran to the end', false, err && (err.stack || err.message));
  }
  delete window.__TAURI__;
  CK.state.info = null; CK.state.status.clear();
  if (window.renderCheckSection) renderCheckSection(null);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
