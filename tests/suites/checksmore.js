// @realtime @touch 360x740
// The remaining answer checks (step 7k; docs/SCOPE.md D155, D315-D324): NTP,
// RTSP, SIP, HL7 MLLP, IPP, IMAP and POP, the page's side (js/model.js's
// check blocks, js/checks.js's plan, Check section and lines), against a
// stub of the app's monitor commands. The checks themselves are Rust
// (desktop/src-tauri/src/checks_more.rs), with their own cargo tests against
// loopback fakes. Covered:
//   - format v19: each new protocol read and written with its own options
//     only (path for rtsp and ipp, tls for imap and pop, transport for sip),
//     a value that is not one dropped, one key order, the schema's enum and
//     keys, the port each asks (993 and 995 with TLS from the start);
//   - the plan carries the options to the app;
//   - in the app: the Asks list offers the 14 protocols; each new one shows
//     its own fields and the sentence saying what it never does; the
//     encryption and the transport are one undo step each and change the
//     port shown; a printer, a camera and a phone system get IPP, RTSP and
//     SIP as their first check by what they document;
//   - the lines: the NTP offset (a warning above 1 s, either way), the
//     printer's state (stopped is a warning), a certificate read over IMAP;
//   - every new sentence translated, Japanese says PC; the section at 360
//     (44px targets, 16px fields, no sideways scroll); no console error.
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
  const CK = window.TopoChecks;
  const NEW = ['ntp', 'rtsp', 'sip', 'mllp', 'ipp', 'imap', 'pop'];

  const info = { on: true, running: true, elsewhere: false, retentionDays: 360, tray: true, autostart: true, networkId: 'k7', networkName: 'Ward', count: 0,
    quiet: { site: 0, nodes: {}, groups: {} }, platform: 'linux', statsFile: '' };
  let lastPlan = null;
  const invoke = async (cmd, args) => {
    await wait(2);
    switch (cmd) {
      case 'monitor_info': case 'monitor_set': case 'monitor_quiet': return clone(info);
      case 'monitor_plan': lastPlan = clone(args.plan); return clone(info);
      case 'monitor_status': return [];
      case 'monitor_history': return { kept: true, samples: [] };
      case 'monitor_older': return { hours: 0, items: 0, samples: 0 };
      case 'this_computer': return { hostname: 'mon', interfaces: [] };
      default: return null;
    }
  };

  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');

    // ---- Format v19 ----
    const cs = asChecks([
      { id: 'n', proto: 'NTP', path: '/x', tls: 'implicit', transport: 'tcp' },
      { id: 'r', proto: 'rtsp', path: '/stream1', port: '8554' },
      { id: 's', proto: 'sip', transport: 'tcp' },
      { id: 's2', proto: 'sip', transport: 'sctp' },
      { id: 'h', proto: 'mllp', port: 2575, path: '/x' },
      { id: 'i', proto: 'ipp', path: '/printers/front' },
      { id: 'm', proto: 'imap', tls: 'implicit', starttls: true },
      { id: 'p', proto: 'pop', tls: 'starttls' },
      { id: 'q', proto: 'pop', tls: 'ssl' }
    ], true);
    const by = (id) => cs.find((c) => c.id === id) || {};
    ok('the new protocols are read (8 kept of 9, at most 8)', cs.length === 8 && cs.map((c) => c.proto).join() === 'ntp,rtsp,sip,sip,mllp,ipp,imap,pop', cs.map((c) => c.proto).join());
    ok('NTP and MLLP take no options', JSON.stringify(by('n')) === '{"id":"n","proto":"ntp"}' && JSON.stringify(by('h')) === '{"id":"h","proto":"mllp","port":2575}', JSON.stringify([by('n'), by('h')]));
    ok('RTSP and IPP keep their path', by('r').path === '/stream1' && by('r').port === 8554 && by('i').path === '/printers/front');
    ok('SIP over TCP kept, another transport dropped (UDP)', by('s').transport === 'tcp' && by('s2').transport === undefined);
    ok('IMAP and POP keep their encryption; STARTTLS is SMTP\'s key only', by('m').tls === 'implicit' && by('m').starttls === undefined && by('p').tls === 'starttls');
    const nine = asChecks([{ id: 'q', proto: 'pop', tls: 'ssl' }], true)[0];
    ok('an encryption that is not one is dropped', JSON.stringify(nine) === '{"id":"q","proto":"pop"}', JSON.stringify(nine));
    ok('keys in one order', JSON.stringify((asChecks([{ id: 'x', proto: 'imap', slowMs: 9, tls: 'starttls', port: 143, ip: '10.0.0.1' },
      { id: 'y', proto: 'sip', interval: 120, transport: 'tcp', port: 5061 }], false).map((c) => Object.keys(c))))
      === JSON.stringify([['id', 'proto', 'ip', 'port', 'tls', 'slowMs'], ['id', 'proto', 'port', 'transport', 'interval']]));
    ok('the port each asks', [checkPortOf({ proto: 'ntp' }), checkPortOf({ proto: 'rtsp' }), checkPortOf({ proto: 'sip' }), checkPortOf({ proto: 'mllp' }), checkPortOf({ proto: 'ipp' }),
      checkPortOf({ proto: 'imap' }), checkPortOf({ proto: 'imap', tls: 'starttls' }), checkPortOf({ proto: 'imap', tls: 'implicit' }), checkPortOf({ proto: 'pop', tls: 'implicit' }), checkPortOf({ proto: 'pop', tls: 'implicit', port: 1995 })].join()
      === '123,554,5060,2575,631,143,143,993,995,1995');
    ok('no password anywhere', !JSON.stringify(cs).match(/pass|secret|user/i));
    const schema = JSON.parse(await (await fetch(`schema/topo-v${DOC_VERSION}.json`)).text());
    const chk = schema.$defs.check;
    ok('the schema names every protocol Topo asks', JSON.stringify(chk.properties.proto.enum) === JSON.stringify(CHECK_PROTOCOLS) && CHECK_PROTOCOLS.length === 15, JSON.stringify(chk.properties.proto.enum));
    ok('…and the new keys with their values', JSON.stringify(chk.properties.tls.enum) === '["starttls","implicit"]' && chk.properties.transport.const === 'tcp');
    const fmt = await (await fetch('docs/FORMAT.md')).text();
    ok('docs/FORMAT.md names them', /`ntp`, `rtsp`, `sip`, `mllp`/.test(fmt) && /\| `tls` \|/.test(fmt) && /\| `transport` \|/.test(fmt));
    ok('v18 -> v19: still nothing to convert', migrateDoc({ v: 18, nodes: [{ id: 'a', type: 'server', name: 'A', x: 0, y: 0, interfaces: [], checks: [{ id: 'c', proto: 'imap', tls: 'starttls' }] }], links: [] }).doc.nodes[0].checks[0].tls === 'starttls');

    // ---- The plan ----
    const doc = {
      v: 19, nodes: [
        { id: 'prn', type: 'printer', name: 'Front printer', x: 0, y: 0, interfaces: [{ ip: '10.0.0.20/24' }], ports: '631, 9100' },
        { id: 'cam', type: 'camera', name: 'Door camera', x: 120, y: 0, interfaces: [{ ip: '10.0.0.21/24' }], ports: '554' },
        { id: 'pbx', type: 'voip', name: 'PBX', x: 240, y: 0, interfaces: [{ ip: '10.0.0.22/24' }], ports: 'udp/5060' },
        { id: 'pbx2', type: 'voip', name: 'PBX2', x: 240, y: 120, interfaces: [{ ip: '10.0.0.25/24' }], ports: 'tcp/5060' },
        { id: 'ris', type: 'server', name: 'RIS', x: 360, y: 0, interfaces: [{ ip: '10.0.0.23/24' }], ports: '2575',
          checks: [{ id: 'h', proto: 'mllp' }, { id: 'n', proto: 'ntp' }, { id: 'm', proto: 'imap', tls: 'implicit' }, { id: 'p', proto: 'pop', tls: 'starttls' },
            { id: 's', proto: 'sip', transport: 'tcp' }, { id: 'r', proto: 'rtsp', path: '/live' }, { id: 'i', proto: 'ipp' }] }
      ], links: [] };
    const plan = CK.monitorPlan(doc, {});
    const spec = (k) => (plan.items.find((i) => i.key === k) || {}).spec || {};
    ok('the plan carries every new check', plan.items.length === 7 && plan.items.every((i) => i.spec.host === '10.0.0.23'));
    ok('…with its options', spec('ris/m').tls === 'implicit' && spec('ris/p').tls === 'starttls' && spec('ris/s').transport === 'tcp' && spec('ris/r').path === '/live'
      && spec('ris/h').tls === '' && spec('ris/h').transport === '' && spec('ris/i').path === '', JSON.stringify([spec('ris/m'), spec('ris/s')]));
    ok('…and its port left to the app when the block names none', spec('ris/m').port === 0 && spec('ris/n').port === 0);
    ok('…named for people', plan.items.find((i) => i.key === 'ris/h').name === 'RIS · HL7 MLLP');

    // ---- In the app ----
    window.__TAURI__ = { core: { invoke }, event: { listen: async () => () => {} } };
    persistLibrary({ k7: { id: 'k7', name: 'Ward', doc: clone(doc), created: 1, updated: Date.now() - 1000 } });
    replaceDocument(libraryEntry('k7').doc, { libraryId: 'k7', origin: 'library' });
    await CK.refreshInfo();
    const open = async (id) => { select(id, 'node'); await settle(); el('checkGroup').open = true; await settle(); await until(() => el('checkBody').children.length > 0); };
    const cardOf = (cid) => el('checkBody').querySelector(`.ck-card[data-check="${cid}"]`);

    // First checks by what the device documents.
    const firstOf = async (id) => { await open(id); const n0 = (getNode(id).checks || []).length; el('checkBody').querySelector('[data-ck="add"]').click(); await settle(); return getNode(id).checks[n0]; };
    const fp = await firstOf('prn'), fc = await firstOf('cam'), fs = await firstOf('pbx'), ft = await firstOf('pbx2');
    ok('a printer documenting 631 is asked IPP first', fp && fp.proto === 'ipp', JSON.stringify(fp));
    ok('a camera documenting 554 is asked RTSP first', fc && fc.proto === 'rtsp', JSON.stringify(fc));
    ok('a phone system on udp/5060 is asked SIP over UDP, on tcp/5060 over TCP', fs && fs.proto === 'sip' && !fs.transport && ft && ft.proto === 'sip' && ft.transport === 'tcp', JSON.stringify([fs, ft]));

    await open('ris');
    const protoSel = cardOf('h').querySelector('[data-f="proto"]');
    const offered = [...protoSel.options].map((o) => o.value);
    ok('Asks offers the 15 protocols (SMTP only where documented; TLS certificate since step 8e)', NEW.every((p) => offered.includes(p)) && offered.length === 14 && offered.includes('tls') && !offered.includes('smtp'), offered.join());
    ok('…named for people', [...protoSel.options].find((o) => o.value === 'mllp').textContent === 'HL7 MLLP' && [...protoSel.options].find((o) => o.value === 'pop').textContent === 'POP');
    const notes = {
      ntp: /stratum and how far this PC's clock is/, rtsp: /status code only\. No video is opened/, sip: /Never a call or a registration/, mllp: /no message is sent, so nothing can reach the RIS/,
      ipp: /Never a print job/, imap: /then LOGOUT\. Never a login/, pop: /then QUIT\. Never a login/ };
    const cidOf = { ntp: 'n', rtsp: 'r', sip: 's', mllp: 'h', ipp: 'i', imap: 'm', pop: 'p' };
    NEW.forEach((p) => ok(`${p}: the sentence saying what it never does`, notes[p].test(cardOf(cidOf[p]).textContent), cardOf(cidOf[p]).textContent.slice(0, 200)));
    ok('RTSP and IPP ask for a path, IPP\'s placeholder /ipp/print', cardOf('r').querySelector('[data-f="path"]').value === '/live' && cardOf('i').querySelector('[data-f="path"]').placeholder === '/ipp/print'
      && /Stream path/.test(cardOf('r').textContent) && /Printer path/.test(cardOf('i').textContent));
    ok('NTP and MLLP have no path, no encryption, no transport', ['n', 'h'].every((c) => !cardOf(c).querySelector('[data-f="path"],[data-f="tls"],[data-f="transport"]')));
    ok('the port shown: 993 with TLS from the start, 2575 for MLLP', cardOf('m').querySelector('[data-f="port"]').placeholder === '993' && cardOf('h').querySelector('[data-f="port"]').placeholder === '2575'
      && /10\.0\.0\.23:993/.test(cardOf('m').querySelector('.ck-port').textContent));
    ok('POP names STLS, IMAP STARTTLS', [...cardOf('p').querySelector('[data-f="tls"]').options].map((o) => o.textContent).join() === 'None,STLS,TLS from the start'
      && [...cardOf('m').querySelector('[data-f="tls"]').options].map((o) => o.textContent).join() === 'None,STARTTLS,TLS from the start');

    const base = JSON.stringify(serializeDoc());
    change(cardOf('p').querySelector('[data-f="tls"]'), 'implicit'); await settle();
    ok('the encryption is kept, and the port follows', getNode('ris').checks.find((c) => c.id === 'p').tls === 'implicit' && cardOf('p').querySelector('[data-f="port"]').placeholder === '995');
    ok('…and the plan sent again carries it', await until(() => lastPlan && lastPlan.items.some((i) => i.key === 'ris/p' && i.spec.tls === 'implicit')));
    undo(); flushAutosave(); await settle();
    ok('…in one undo step', JSON.stringify(serializeDoc()) === base);
    await open('ris');
    change(cardOf('m').querySelector('[data-f="tls"]'), ''); await settle();
    ok('None takes the key away', getNode('ris').checks.find((c) => c.id === 'm').tls === undefined && cardOf('m').querySelector('[data-f="port"]').placeholder === '143');
    undo(); flushAutosave(); await settle(); await open('ris');
    change(cardOf('s').querySelector('[data-f="transport"]'), ''); await settle();
    ok('SIP back to UDP takes the key away', getNode('ris').checks.find((c) => c.id === 's').transport === undefined);
    undo(); flushAutosave(); await settle();
    ok('…in one undo step', JSON.stringify(serializeDoc()) === base);
    await open('ris');
    change(cardOf('i').querySelector('[data-f="path"]'), 'not a path'); await settle();
    ok('a printer path that is not one is refused and marked', cardOf('i').querySelector('[data-f="path"]').classList.contains('bad') && getNode('ris').checks.find((c) => c.id === 'i').path === undefined);
    await open('ris');
    change(cardOf('h').querySelector('[data-f="proto"]'), 'imap'); await settle();
    ok('MLLP made IMAP: its own fields', !!cardOf('h').querySelector('[data-f="tls"]') && getNode('ris').checks.find((c) => c.id === 'h').proto === 'imap');
    undo(); flushAutosave(); await settle();
    ok('…in one undo step', JSON.stringify(serializeDoc()) === base);

    // ---- The lines ----
    await open('ris');
    const now = Date.now();
    const st = (cid, extra) => Object.assign({ key: `ris/${cid}`, nodeId: 'ris', state: 'up', slow: false, flapping: false, since: now - 3600000, checked: now, rttMs: 3, status: '', via: '', certNotAfter: null, quietUntil: null }, extra);
    CK.onStatuses([
      st('n', { status: 'stratum 2', offsetMs: 12.4 }),
      st('i', { status: '0000 stopped media-empty-error,toner-low-report' }),
      st('m', { status: 'OK', certNotAfter: Math.floor(now / 1000) + 40 * 86400 + 43200 }),
      st('h', { status: 'open' }),
      st('s', { state: 'down', status: '503', rttMs: null }),
      st('p', { status: '+OK no STLS' })]);
    await settle();
    const line = (cid) => cardOf(cid).querySelector('.ck-now');
    ok('NTP: the clock offset, no warning under 1 s', /Clock offset \+12 ms/.test(line('n').textContent) && !line('n').classList.contains('ck-warn'), line('n').textContent);
    ok('IPP: a stopped printer is said, with its reasons, as a warning', /Printer stopped \(media-empty-error, toner-low-report\)/.test(line('i').textContent) && line('i').classList.contains('ck-warn'), line('i').textContent);
    ok('IMAP: the certificate read over TLS', /The certificate ends in 40 days/.test(line('m').textContent) && !line('m').classList.contains('ck-warn'), line('m').textContent);
    ok('SIP: not answering says its status code', /Not answering since/.test(line('s').textContent) && /503/.test(line('s').textContent), line('s').textContent);
    CK.onStatuses([st('n', { status: 'stratum 2', offsetMs: 3200 }), st('i', { status: '0000 idle' })]); await settle();
    ok('NTP above 1 s: this PC\'s clock is behind, a warning', /This PC's clock is 3\.2 s behind this server/.test(line('n').textContent) && line('n').classList.contains('ck-warn'), line('n').textContent);
    ok('IPP idle: no warning', /Printer idle/.test(line('i').textContent) && !line('i').classList.contains('ck-warn'), line('i').textContent);
    CK.onStatuses([st('n', { status: 'stratum 2', offsetMs: -1500 })]); await settle();
    ok('…or ahead', /This PC's clock is 1\.5 s ahead of this server/.test(line('n').textContent) && line('n').classList.contains('ck-warn'), line('n').textContent);
    CK.onStatuses([st('n', { state: 'down', status: 'KoD RATE', rttMs: null, offsetMs: null })]); await settle();
    ok('NTP kiss-o\'-death: not answering, said', /Not answering since/.test(line('n').textContent) && /KoD RATE/.test(line('n').textContent), line('n').textContent);
    setLocale('es'); await settle(); await open('ris');
    CK.onStatuses([st('n', { status: 'stratum 2', offsetMs: 3200 })]); await settle();
    ok('in Spanish, with the decimal comma', /El reloj de este PC va 3,2 s por detrás de este servidor/.test(line('n').textContent), line('n').textContent);
    setLocale('en'); await settle();

    // ---- Translated ----
    const strings = ['Printer path', 'Stream path', 'Over', 'Encryption', 'TLS from the start', 'Clock offset {ms} ms', 'Printer idle', 'Printer printing', 'Printer stopped',
      'This PC\'s clock is {s} s behind this server', 'This PC\'s clock is {s} s ahead of this server',
      ...Object.values({
        ntp: 'One time request: the server\'s stratum and how far this PC\'s clock is from it (a warning above 1 s).',
        rtsp: 'One OPTIONS request: the status code only. No video is opened.',
        sip: 'One OPTIONS request: the status code only. Never a call or a registration.',
        mllp: 'Connects and leaves: no message is sent, so nothing can reach the RIS.',
        ipp: 'Asks only the printer\'s state and its reasons. Never a print job.',
        imap: 'Reads the greeting, then LOGOUT. Never a login; with encryption, also the certificate\'s end date.',
        pop: 'Reads the greeting, then QUIT. Never a login; with encryption, also the certificate\'s end date.' })];
    const missing = [];
    CarinoI18N.locales.filter((l) => l !== 'en').forEach((l) => strings.forEach((s) => { if (!CarinoI18N.has(l, s)) missing.push(`${l}: ${s.slice(0, 40)}`); }));
    ok('every new sentence is translated', !missing.length, `${missing.length}: ${missing.slice(0, 3).join(' | ')}`);
    setLocale('ja');
    const ja = strings.map((s) => t(s)).join('');
    ok('Japanese says PC', /PC/.test(t('This PC\'s clock is {s} s behind this server')) && ja.match(/パソコン|コンピューター/) === null);
    setLocale('en'); await settle();

    // ---- At 360 ----
    await open('ris');
    await settle();
    const r = window.touchAudit('The remaining checks');
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`the section @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`the section @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
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
