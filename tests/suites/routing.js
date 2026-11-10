// Routing a problem report to its providers (js/routing.js, docs/SCOPE.md
// step 4 stage 2):
//   1. every symptom on a hand-made network: the services each asks for, in
//      order, nothing hidden (one result per provider), each with a reason;
//   2. distance: a provider on a cable nearer than the cloud's ranks first;
//      the way up is a breadth-first walk to the internet edge, not the
//      faceplate (a VPN is not a way out); a VM through its host; a group
//      three deep; the whole place and a group as the place; a provider tied
//      to nothing ("listed for this network"); "other" puts IT support first;
//      a power cut finds the device naming a Power / UPS provider;
//   3. support hours: every sample's text as written, the day words of the
//      five locales, en and em dashes, past midnight, open and closed now at
//      fixed dates; unknown hours never hide a provider;
//   4. every sample (full and simple), every symptom: the same answer twice,
//      a reason on every row, every provider listed once; the way up from an
//      end device reaches the nearest internet cloud; both lines of a site
//      with two; known top picks;
//   5. no provider at all: the sentence, nothing else; reasons in es.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (x) => JSON.stringify(x);
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [] }, extra);
  const SUN = new Date(2026, 10, 8, 12, 0), WED = new Date(2026, 10, 11, 10, 0), WED_NIGHT = new Date(2026, 10, 11, 23, 30);
  const site = () => ({
    providers: [
      { id: 'pI2', name: 'Backup Fibre', service: 'internet', hours: 'Mon-Fri 9-18' },
      { id: 'pI', name: 'Fibra Norte', service: 'internet', hours: '24/7 by phone' },
      { id: 'pT', name: 'Andes IT', service: 'it', hours: 'L-V 9:00-18:00' },
      { id: 'pS', name: 'Casa Segura', service: 'security' },
      { id: 'pV', name: 'Print Co', service: 'vendor', hours: 'Next business day parts' },
      { id: 'pP', name: 'Power Plus', service: 'power' },
      { id: 'pX', name: 'Helper' },
      { id: 'pF', name: 'VozClara', service: 'phone', hours: '24/7' }
    ],
    groups: [
      { id: 'gB', name: 'Office', kind: 'building', providers: ['pT'] },
      { id: 'gF', name: 'First floor', kind: 'floor', parent: 'gB' },
      { id: 'gR', name: 'Back room', kind: 'room', parent: 'gF', providers: ['pS'] }
    ],
    nodes: [
      N('isp', 'cloud', { name: 'Internet', providers: ['pI'] }),
      N('rt', 'router', { name: 'Router' }),
      N('sw', 'switch', { name: 'Switch' }),
      N('pc', 'pc', { name: 'Reception PC', group: 'gR' }),
      N('cam', 'camera', { name: 'Door cam', group: 'gB', providers: ['pS'] }),
      N('prn', 'printer', { name: 'Printer', group: 'gB', providers: ['pV'] }),
      N('srv', 'server', { name: 'Host' }),
      N('vm', 'vm', { name: 'VM1', host: 'srv' }),
      N('tel', 'voip', { name: 'Desk phone', group: 'gB' }),
      N('ups', 'custom', { name: 'UPS', group: 'gF', providers: ['pP'] })
    ],
    links: [
      { id: 'w1', source: 'isp', target: 'rt', medium: 'fiber' },
      { id: 'l_rs', source: 'rt', target: 'sw', providers: ['pI2'] },
      { id: 'l_pc', source: 'sw', target: 'pc' },
      { id: 'l_cam', source: 'sw', target: 'cam' },
      { id: 'l_prn', source: 'sw', target: 'prn' },
      { id: 'l_srv', source: 'sw', target: 'srv' },
      { id: 'l_tel', source: 'sw', target: 'tel' },
      { id: 'l_vpn', source: 'pc', target: 'isp', medium: 'vpn' }
    ]
  });
  const route = (doc, q, now = SUN) => routeIncident(doc, q, { now });
  const ids = (r) => r.results.map((x) => x.provider.id).join();
  const byId = (r, id) => r.results.find((x) => x.provider.id === id);
  try {
    setLocale('en');
    const doc = site();
    const all = doc.providers.length;

    // ---- 1. Every symptom ----
    ok('the seven symptoms and their services', show(SYMPTOMS) === show(['internet', 'wifi', 'phone', 'camera', 'printer', 'power', 'other'])
       && show(SYMPTOM_SERVICES.internet) === '["internet","it"]' && show(SYMPTOM_SERVICES.camera) === '["security","it"]'
       && show(SYMPTOM_SERVICES.printer) === '["it","vendor"]' && show(SYMPTOM_SERVICES.power) === '["power"]');
    ok('every symptom has a label', SYMPTOMS.every((s) => symptomLabel(s) && symptomLabel(s) !== 'undefined'), SYMPTOMS.map(symptomLabel).join());
    const internet = route(doc, { nodeIds: ['pc'], symptom: 'internet' });
    ok('no internet: the two ISPs, then IT support, then everyone else', ids(internet).startsWith('pI2,pI,pT,') && internet.results.length === all, ids(internet));
    ok('nothing is hidden: one row per provider, each with a reason', new Set(internet.results.map((x) => x.provider.id)).size === all
       && internet.results.every((x) => typeof x.reason === 'string' && x.reason.length > 5), internet.results.map((x) => x.reason).join(' | '));
    ok('the reasons: a cable two steps up, the cloud three, the group for this device',
       byId(internet, 'pI2').reason === 'Internet for the cable to Router, 2 steps upstream'
       && byId(internet, 'pI').reason === 'Internet for Internet, 3 steps upstream'
       && byId(internet, 'pT').reason === 'IT support for this device (through Office)',
       [byId(internet, 'pI2').reason, byId(internet, 'pI').reason, byId(internet, 'pT').reason].join(' | '));
    ok('the way up skips the VPN tunnel straight to the cloud', byId(internet, 'pI').distance === 3 && byId(internet, 'pI2').distance === 2);
    const wifi = route(doc, { nodeIds: ['pc'], symptom: 'wifi' });
    ok('Wi-Fi: IT support first, then the ISPs', ids(wifi).startsWith('pT,pI2,pI,'), ids(wifi));
    const phone = route(doc, { nodeIds: ['tel'], symptom: 'phone' });
    ok('phones: the phone company tied to nothing still comes first, then IT', ids(phone).startsWith('pF,pT,')
       && byId(phone, 'pF').reason === 'Phone / VoIP, listed for this network' && byId(phone, 'pF').distance === Infinity, ids(phone) + ' ' + byId(phone, 'pF').reason);
    const camera = route(doc, { nodeIds: ['cam'], symptom: 'camera' });
    ok('cameras: the alarm company on the camera, then IT', ids(camera).startsWith('pS,pT,') && byId(camera, 'pS').reason === 'CCTV / alarm for this device', ids(camera));
    const printer = route(doc, { nodeIds: ['prn'], symptom: 'printer' });
    ok('printer: IT support, then the vendor', ids(printer).startsWith('pT,pV,') && byId(printer, 'pV').distance === 0, ids(printer));
    const power = route(doc, { nodeIds: ['pc'], symptom: 'power' });
    ok('a power cut: the provider of the UPS in the same building first', ids(power).startsWith('pP,') && byId(power, 'pP').via.kind === 'power'
       && byId(power, 'pP').reason === 'Power / UPS for UPS, in the same place' && byId(power, 'pP').distance === 4, ids(power) + ' ' + byId(power, 'pP').reason);
    const other = route(doc, { nodeIds: ['pc'], symptom: 'other' });
    ok('something else: IT support, then anyone, nearest first', ids(other).startsWith('pT,pS,pI2,pI,'), ids(other));
    ok('a provider with no service is a "Provider" in its sentence', /^Provider, listed for this network$/.test(byId(other, 'pX').reason), byId(other, 'pX').reason);
    ok('an unknown symptom reads as something else', ids(route(doc, { nodeIds: ['pc'], symptom: 'bogus' })) === ids(other));

    // ---- 2. Distance, hosts, groups, places ----
    const vm = route(doc, { nodeIds: ['vm'], symptom: 'internet' });
    ok('a VM: through its host, one step each', byId(vm, 'pI2').distance === 3 && byId(vm, 'pI').distance === 4, `${byId(vm, 'pI2').distance} ${byId(vm, 'pI').distance}`);
    const vmPath = routePaths(doc, { nodeIds: ['vm'] })[0];
    ok('the VM\'s way up: VM, host, switch, router, cloud', vmPath.devices.map((d) => d.node.id + d.distance).join('>') === 'vm0>srv1>sw2>rt3>isp4',
       vmPath.devices.map((d) => d.node.id + d.distance).join('>'));
    ok('a group three deep: the building\'s IT reaches a room device', byId(internet, 'pT').via.how === 'group' && byId(internet, 'pT').via.from === 'Office');
    const whole = route(doc, { nodeIds: [], symptom: 'internet' });
    ok('the whole place: from its routing devices, the ISP on the cloud first', ids(whole).startsWith('pI,') && byId(whole, 'pI').reason === 'Internet for Internet'
       && byId(whole, 'pI2').distance === Infinity, ids(whole) + ' ' + byId(whole, 'pI').reason);
    const room = route(doc, { nodeIds: [], groupId: 'gR', symptom: 'camera' });
    ok('a group as the place: its own provider, then the building\'s', ids(room).startsWith('pS,pT,') && byId(room, 'pS').reason === 'CCTV / alarm for Back room (its group)'
       && byId(room, 'pT').via.label === 'Office', ids(room) + ' ' + byId(room, 'pS').reason);
    {
      const d2 = site();
      d2.links.find((l) => l.id === 'l_rs').providers = undefined;
      d2.links.find((l) => l.id === 'w1').providers = ['pI2'];
      const sun = route(d2, { nodeIds: ['pc'], symptom: 'internet' }, SUN), wed = route(d2, { nodeIds: ['pc'], symptom: 'internet' }, WED);
      ok('same distance: open now ranks first (Sunday: the 24/7 line)', ids(sun).startsWith('pI,pI2,') && byId(sun, 'pI2').open === false && byId(sun, 'pI').open === true, ids(sun));
      ok('same distance, both open: the network\'s order', ids(wed).startsWith('pI2,pI,') && byId(wed, 'pI2').open === true, ids(wed));
      ok('unknown hours are neither open nor closed, and still listed', byId(wed, 'pS').open === null && byId(wed, 'pV').open === null);
      ok('the open-now words', routeOpenText({ open: true }) === 'Open now' && routeOpenText({ open: false }) === 'Closed now' && routeOpenText({ open: null }) === '');
    }
    {
      const d3 = site();
      d3.nodes.find((n) => n.id === 'rt').providers = ['pT'];
      const r3 = route(d3, { nodeIds: ['pc'], symptom: 'wifi' });
      ok('the nearest place wins, the rest are "also for"', byId(r3, 'pT').distance === 0 && byId(r3, 'pT').alsoFor.some((a) => a.id === 'rt' && a.distance === 2),
         show(byId(r3, 'pT').alsoFor));
    }
    {
      const d4 = site();
      d4.nodes.push(N('isp2', 'cloud', { name: 'Old line', status: 'retired', providers: ['pI2'] }), N('rem', 'cloud', { name: 'Branch', siteRef: 'branch' }));
      d4.links.push({ id: 'w2', source: 'sw', target: 'isp2' }, { id: 'w3', source: 'sw', target: 'rem' });
      const p4 = routePaths(d4, { nodeIds: ['pc'] })[0];
      ok('a retired cloud and one standing for another site are not the way out', p4.edges.map((e) => e.node.id).join() === 'isp', p4.edges.map((e) => e.node.id).join());
      const d5 = site();
      d5.nodes = d5.nodes.filter((n) => n.id !== 'isp'); d5.links = d5.links.filter((l) => l.source !== 'isp' && l.target !== 'isp');
      const p5 = routePaths(d5, { nodeIds: ['pc'] })[0];
      ok('no cloud: the routing devices are the edge', p5.edges.map((e) => e.node.id).join() === 'rt', p5.edges.map((e) => e.node.id).join());
      // No way out at all: the switch next door still counts by distance.
      const swPv = (d) => { d.providers.push({ id: 'pW', name: 'Wire Co', service: 'it' }); d.nodes.find((n) => n.id === 'sw').providers = ['pW']; return d; };
      const d6 = swPv(site());
      d6.links = d6.links.filter((l) => l.id !== 'w1');   // the cloud drawn, not cabled
      const r6 = route(d6, { nodeIds: ['pc'], symptom: 'wifi' });
      ok('an unwired cloud: the switch\'s provider is one step up, not "listed for this network"', byId(r6, 'pW').distance === 1 && byId(r6, 'pW').via.kind === 'device'
         && ids(r6).startsWith('pT,pW,'), ids(r6) + ' ' + byId(r6, 'pW').distance);
      const d7 = swPv(site());
      d7.nodes = d7.nodes.filter((n) => n.id !== 'isp' && n.id !== 'rt'); d7.links = d7.links.filter((l) => !['w1', 'l_rs', 'l_vpn'].includes(l.id));
      const r7 = route(d7, { nodeIds: ['pc'], symptom: 'wifi' });
      ok('a site with no router: the switch\'s provider by distance', byId(r7, 'pW').distance === 1 && byId(r7, 'pW').via.kind === 'device', show(byId(r7, 'pW').via) + byId(r7, 'pW').distance);
      const d8 = swPv(site());
      d8.nodes.find((n) => n.id === 'rt').status = 'retired';
      const p8 = routePaths(d8, { nodeIds: ['pc'] })[0], r8 = route(d8, { nodeIds: ['pc'], symptom: 'wifi' });
      ok('a retired router: no edge, the switch still on the path', p8.edges.length === 0 && p8.devices.some((d) => d.node.id === 'sw' && d.distance === 1)
         && byId(r8, 'pW').distance === 1, p8.devices.map((d) => d.node.id + d.distance).join('>'));
    }

    // ---- 3. Support hours ----
    const H = (s) => show(parseHours(s));
    const ALL = [0, 1, 2, 3, 4, 5, 6], MF = [1, 2, 3, 4, 5], MS = [1, 2, 3, 4, 5, 6];
    const span = (days, from, to) => show({ spans: [{ days, from, to }] });
    const ALWAYS = show({ always: true });
    const table = [
      ['24/7 by phone', ALWAYS], ['Mon–Sat 8–20', span(MS, 480, 1200)], ['24/7 NOC · 4 h restore', ALWAYS],
      ['Mon–Fri 8–19 · on-site next business day', span(MF, 480, 1140)], ['24/7 remote hands', ALWAYS], ['Next business day parts', 'null'],
      ['24/7 on call', ALWAYS], ['Every day 7–23', span(ALL, 420, 1380)], ['Every day 8–22', span(ALL, 480, 1320)],
      ['Every day 6–22 · 8 h on-site', span(ALL, 360, 1320)], ['Mon–Sat 7–21', span(MS, 420, 1260)], ['Mon–Sat 6–22', span(MS, 360, 1320)],
      ['Mon–Fri 8–19', span(MF, 480, 1140)], ['24/7 · 2 h restore', ALWAYS], ['24/7 · 4 h on-site', ALWAYS], ['24/7 · 6 h on-site', ALWAYS],
      ['24/7 · 1 h response', ALWAYS], ['24/7 NOC · SLA 99.95%', ALWAYS], ['24/7 hotline', ALWAYS], ['24/7 monitoring', ALWAYS], ['24/7', ALWAYS],
      ['Reads 24/7', ALWAYS], ['In port: next day', 'null'], ['24/7 NOC', ALWAYS]
    ];
    const wrong = table.filter(([s, want]) => H(s) !== want).map(([s]) => `${s} => ${H(s)}`);
    ok('every hours text in the samples reads as written', !wrong.length, wrong.join(' | '));
    const sampleHours = [...new Set(Object.values(templatesData).flatMap((d) => (d.providers || []).map((p) => p.hours)).filter(Boolean))];
    ok('the table covers every hours text the samples hold', sampleHours.every((h) => table.some(([s]) => s === h)), sampleHours.filter((h) => !table.some(([s]) => s === h)).join(' | '));
    const words = [
      ['L-V 9:00-18:00', span(MF, 540, 1080)], ['Lunes a viernes 9 a 18', span(MF, 540, 1080)], ['Lun-Sáb 8:00-20:00', span(MS, 480, 1200)],
      ['todos los días 7-22', span(ALL, 420, 1320)], ['Seg a Sex 8h-17h', span(MF, 480, 1020)], ['segunda-feira a sexta-feira 8h às 18h', span(MF, 480, 1080)],
      ['Seg a Sex 8h às 18h', span(MF, 480, 1080)], ['Mon-Fri 9-5', span(MF, 540, 1020)], ['8:00-17:00 L-V', span(MF, 480, 1020)],
      ['Mon-Fri 8:30-17:30 (2-4 h response)', span(MF, 510, 1050)], ['8-17 L-V, 9-13 S', show({ spans: [{ days: MF, from: 480, to: 1020 }, { days: [6], from: 540, to: 780 }] })],
      ['9-13 15-19 L-V', show({ spans: [{ days: MF, from: 540, to: 780 }, { days: MF, from: 900, to: 1140 }] })],
      ['todos os dias 8-20', span(ALL, 480, 1200)], ['пн-пт 9:00-18:00', span(MF, 540, 1080)], ['Пн–Сб с 9 до 18', span(MS, 540, 1080)],
      ['ежедневно 8-22', span(ALL, 480, 1320)], ['月〜金 9:00〜18:00', span(MF, 540, 1080)], ['毎日 9時〜18時', span(ALL, 540, 1080)],
      ['Mon—Fri 9—18', span(MF, 540, 1080)], ['Mon-Fri 9am-6pm', span(MF, 540, 1080)], ['Mon, Wed 18.00-20.30', span([1, 3], 1080, 1230)],
      ['Mon-Fri 9-13 15-19', show({ spans: [{ days: MF, from: 540, to: 780 }, { days: MF, from: 900, to: 1140 }] })],
      ['Mon-Fri 9-18, Sat 9-13', show({ spans: [{ days: MF, from: 540, to: 1080 }, { days: [6], from: 540, to: 780 }] })],
      ['Fri-Mon 10-14', span([0, 1, 5, 6], 600, 840)], ['9-17', span(ALL, 540, 1020)], ['24h', ALWAYS], ['siempre', ALWAYS],
      ['круглосуточно', ALWAYS], ['24時間', ALWAYS], ['4 h restore', 'null'], ['8 h on-site', 'null'], ['on call', 'null'], ['', 'null']
    ].filter(([, w]) => w !== 'x');
    const wrongW = words.filter(([s, want]) => H(s) !== want).map(([s]) => `${s} => ${H(s)}`);
    ok('the five locales\' day words, every-day words, dashes, am/pm, several spans', !wrongW.length, wrongW.join(' | '));
    ok('Portuguese weekday names with -feira read', show(parseHours('segunda-feira a sexta-feira 8h-18h')) === span(MF, 480, 1080), H('segunda-feira a sexta-feira 8h-18h'));
    ok('"4 h restore" is not a 24 h form', parseHours('4 h restore') === null && parseHours('14 h') === null);
    ok('"Mon-Fri 9-5" is the afternoon: closed Wednesday 3:00, open 15:00; days after the hours count: "8:00-17:00 L-V" closed Saturday noon',
       hoursOpenAt(parseHours('Mon-Fri 9-5'), new Date(2026, 10, 11, 3, 0)) === false && hoursOpenAt(parseHours('Mon-Fri 9-5'), new Date(2026, 10, 11, 15, 0)) === true
       && hoursOpenAt(parseHours('8:00-17:00 L-V'), new Date(2026, 10, 14, 12, 0)) === false);
    const night = parseHours('Mon-Fri 22-6');
    ok('past midnight: open Wednesday 23:30, open Saturday 5:00 (Friday night), closed Sunday 5:00',
       hoursOpenAt(night, WED_NIGHT) === true && hoursOpenAt(night, new Date(2026, 10, 14, 5, 0)) === true && hoursOpenAt(night, new Date(2026, 10, 15, 5, 0)) === false
       && hoursOpenAt(night, WED) === false);
    ok('open and closed at fixed dates', hoursOpenAt(parseHours('L-V 9:00-18:00'), WED) === true && hoursOpenAt(parseHours('L-V 9:00-18:00'), SUN) === false
       && hoursOpenAt(parseHours('24/7'), SUN) === true && hoursOpenAt(null, SUN) === null && hoursOpenAt(parseHours('Mon-Fri 9-18'), new Date(2026, 10, 11, 18, 0)) === false);

    // ---- 4. Every sample ----
    const keys = Object.keys(templatesData);
    ok('every sample is here, full and simple', keys.length >= 36 && keys.includes('showcase') && keys.includes('house_simple'), keys.length + '');
    const firstEnd = (d) => d.nodes.find((n) => ['pc', 'printer', 'camera', 'voip', 'iot', 'dicom', 'server'].includes(n.type) && n.status !== 'retired');
    const bad = [], noReach = [];
    let checked = 0;
    keys.forEach((k) => {
      const d = cloneData(templatesData[k]);
      const pv = (d.providers || []).length;
      SYMPTOMS.forEach((s) => {
        const types = SYMPTOM_DEVICE_TYPES[s];
        const seed = d.nodes.find((n) => types.includes(n.type)) || null;
        const q = { nodeIds: seed ? [seed.id] : [], symptom: s };
        const a = route(d, q, WED), b = route(d, q, WED);
        const sa = show(a.results.map((x) => [x.provider.id, x.distance, x.reason, x.open, x.alsoFor]));
        if (sa !== show(b.results.map((x) => [x.provider.id, x.distance, x.reason, x.open, x.alsoFor]))) bad.push(`${k}/${s}: not the same twice`);
        if (a.results.some((x) => !x.reason)) bad.push(`${k}/${s}: a row with no reason`);
        if (pv && a.results.length !== pv) bad.push(`${k}/${s}: ${a.results.length} of ${pv}`);
        if (!pv && !a.empty) bad.push(`${k}/${s}: no provider but not empty`);
        const svc = a.results.map((x) => x.serviceRank);
        if (svc.some((v, i) => i && v < svc[i - 1])) bad.push(`${k}/${s}: service order`);
        checked++;
      });
      const clouds = d.nodes.filter((n) => n.type === 'cloud' && !n.siteRef && n.status !== 'retired');
      const end = firstEnd(d);
      if (clouds.length && end) {
        const p = routePaths(d, { nodeIds: [end.id] })[0];
        if (!p.devices.some((x) => x.node.type === 'cloud' && clouds.includes(x.node))) noReach.push(`${k}: ${p.devices.map((x) => x.node.id).join('>')}`);
      }
    });
    ok('every sample, every symptom: the same twice, a reason each, every provider once, services in order', !bad.length && checked === keys.length * 7, bad.slice(0, 5).join(' | '));
    ok('from each sample\'s first end device the way up reaches an internet cloud', !noReach.length, noReach.join(' | '));
    {
      const d = templatesData.military;
      const p = routePaths(d, { nodeIds: [firstEnd(d).id] })[0];
      ok('the military base (two clouds): the nearest one', p.edges.length >= 1 && p.edges[0].node.id === 'm_net' && p.devices.some((x) => x.node.id === 'm_net'), p.edges.map((e) => e.node.id + '@' + e.distance).join());
      const ob = routePaths(templatesData.offlineBalanced, { nodeIds: ['ob-node'] })[0];
      ok('two lines out (fibre and LTE): both listed', ['ob-wan', 'ob-lte'].every((id) => ob.edges.some((e) => e.node.id === id)), ob.edges.map((e) => e.node.id).join());
      const errs = routePaths(templatesData.errors, { nodeIds: [firstEnd(templatesData.errors).id] })[0];
      ok('a sample with no cloud: the router is the edge', errs.edges.some((e) => isRoutingDevice(e.node.type)), errs.edges.map((e) => e.node.id).join());
    }
    const top = (k, s, type) => {
      const d = templatesData[k];
      const seed = d.nodes.find((n) => n.type === type);
      return route(d, { nodeIds: [seed.id], symptom: s }, WED).results[0].provider.id;
    };
    ok('the bank: no internet at a teller PC goes to the WAN carrier', top('bank', 'internet', 'pc') === 'pv_wan', top('bank', 'internet', 'pc'));
    ok('the call centre: a phone goes to the SIP trunk company', top('callcenter', 'phone', 'voip') === 'pv_voip', top('callcenter', 'phone', 'voip'));
    ok('the retail store: no IT firm, so the printer goes to the POS vendor', top('retail', 'printer', 'printer') === 'pv_pos', top('retail', 'printer', 'printer'));
    ok('the imaging centre: something else goes to IT support', top('imaging', 'other', 'dicom') === 'pv_it', top('imaging', 'other', 'dicom'));
    ok('the Smart Home: no internet goes to the ISP, one step above the router', top('house', 'internet', 'pc') === 'pv_isp');

    // ---- 5. No provider; Spanish ----
    const none = site(); none.providers = [];
    none.nodes.forEach((n) => delete n.providers); none.links.forEach((l) => delete l.providers); none.groups.forEach((g) => delete g.providers);
    const rn = route(none, { nodeIds: ['pc'], symptom: 'internet' });
    ok('no provider at all: empty, and the sentence', rn.empty === true && !rn.results.length && /No provider is listed for this network yet/.test(rn.sentence), rn.sentence);
    ok('the live document is the default', (() => { replaceDocument(Object.assign({ v: DOC_VERSION }, site()), { origin: 'file' }); return ids(routeIncident(undefined, { nodeIds: ['pc'], symptom: 'internet' }, { now: SUN })) === ids(internet); })());
    setLocale('es');
    const es = route(doc, { nodeIds: ['pc'], symptom: 'internet' });
    ok('es: the reasons are Spanish', byId(es, 'pI2').reason.endsWith(' del cable a Router, 2 pasos hacia arriba')
       && byId(es, 'pT').reason.endsWith('de este dispositivo (por Office)') && symptomLabel('internet') === 'Sin internet', byId(es, 'pI2').reason + ' | ' + byId(es, 'pT').reason);
    ok('es: the empty sentence and open now', /^Todavía no hay ningún proveedor/.test(route(none, { symptom: 'internet' }).sentence) && routeOpenText({ open: true }) === 'Abierto ahora');
    const locs = ['es', 'pt-BR', 'ru', 'ja'];
    const untranslated = [];
    locs.forEach((l) => { setLocale(l); SYMPTOMS.filter((x) => x !== 'wifi').forEach((x) => { if (symptomLabel(x) === SYMPTOM_LABEL[x]) untranslated.push(l + ':' + x); }); });
    ok('every symptom label is translated in es, pt-BR, ru and ja', !untranslated.length, untranslated.join());
    setLocale('ru');
    const ru = route(doc, { nodeIds: ['pc'], symptom: 'internet' }).results[0].reason;
    ok('ru: steps said without declension', /кабель — Router, шагов вверх: 2$/.test(ru), ru);
    setLocale('ja');
    ok('ja: the reason in Japanese', /Router へのケーブルの.+（2 段上流）$/.test(route(doc, { nodeIds: ['pc'], symptom: 'internet' }).results[0].reason));
    setLocale('en');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
