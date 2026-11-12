// @realtime @touch 360x740
// The monitoring report (js/reports.js; docs/SCOPE.md D163, D164, step 7j,
// D298-D311), on hourly figures made by hand (the shape stats.rs writes):
//   1. the period: the last 24 h, 7 days, 30 days and 91 days end at the last
//      whole hour; since the last visit starts at the first whole hour
//      after it (a provider's own visit for their report), none or less
//      than an hour said;
//   2. availability: up / (up + down), maintenance and unknown left out,
//      the coverage beside it (an hour no monitor wrote counts as not
//      measured); two monitors on one check pooled over both their spans;
//      the time down because of a device upstream named after the outage
//      whose devices behind it hold it ("down because R1") and left out of
//      the figure a target is judged on; the device's target, else its
//      provider's; met and missed; a provider's support hours (v19
//      targetHours) leave the closed hours out of the figures and the span;
//      pooled per device, group, provider and the report;
//   3. response times: the median and 95th percentile weighted by answers,
//      the jitter, loss, the chart's steps (24 for a day, 28 for a week, 30
//      for 30 days, 13 for a quarter), "TCP, not ping" from the hours'
//      tcp, the slow hours of the day;
//   4. outages: each issue in the period with its start, time down, root
//      cause (its own with the devices behind it, or "down because R1" for
//      a device behind it), who acted and the time to acknowledge; MTTR and
//      MTBF per device, Expected left out as maintenance;
//   5. the CSV: English columns, a row per check, device, group, provider
//      and the total, per step and per outage; numbers with a dot, ISO times;
//   6. where the figures come from: a server's site (every monitor's blobs,
//      read page after page past 400), this PC's own monitor when it
//      monitors the open network (monitor_figures with every check's key),
//      nothing on the website (said, outages still listed), statistics Off;
//   7. the preview: the menu's Monitoring report opens it with its choices
//      in the left column (on what, the period, the hours, what goes in),
//      Print, CSV and Download; a choice rebuilds it; the CSV button saves
//      the file; the device's Answer checks link opens its own report; the
//      provider card's Monitoring report opens theirs;
//   8. the provider's v19 target and support-hours tick: one undo step each,
//      in the schema, in providers.csv and back; their report (and so the
//      file a Report a problem attaches) carries the monitoring section;
//   9. the network report's Problems and visits prints an outage as an
//      outage (times down, behind it, who acted, the time to acknowledge);
//  10. translated (es, pt-BR, ru, ja; Japanese says PC), the choices 44px
//      at 360 and no sideways scroll; no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, n = 300) => { for (let i = 0; i < n && !(await cond()); i++) await wait(25); return cond(); };
  const show = (v) => JSON.stringify(v);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  await until(() => !!window.TopoReports && !!window.TopoChecks && !!window.TopoMonitors && typeof openSheetPreview === 'function');
  const RP = window.TopoReports, CK = window.TopoChecks, MON = window.TopoMonitors;
  const held = { siteOfOpen: MON.siteOfOpen, loadMonitors: MON.loadMonitors, stats: MON.stats, info: CK.state.info, saveBlob: window.saveBlob };
  const saved = [];
  window.saveBlob = (blob, name) => { saved.push({ blob, name }); return 'blob:x'; };
  const HOUR = 3600000, DAY = 24 * HOUR;
  // A Wednesday 12:30 local: the hours of the day line up with a work week.
  const base = new Date(2026, 10, 11, 12, 30, 0, 0).getTime();
  const NOW = base;
  const TO = Math.floor(NOW / HOUR) * HOUR;
  RP.state.now = () => NOW;
  const H = (hour, f = {}) => Object.assign({ hour, checks: 60, ok: 60, fail: 0, rttMin: 1, rttMed: 4, rttP95: 9, rttMax: 20, jitter: 0.5,
    sUp: 3600, sSlow: 0, sDown: 0, sUpstream: 0, sMaint: 0, sUnknown: 0 }, f);

  try {
    setLocale('en');
    const N = (id, type, ip, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra);
    const site = () => ({
      v: DOC_VERSION,
      report: { client: 'Clinica Sol', site: 'Reception' },
      providers: [{ id: 'pI', name: 'Fibra Norte', service: 'internet', target: 99.5, hours: 'Mon-Fri 9-17', targetHours: true },
        { id: 'pT', name: 'Andes IT', service: 'it', target: 99 }],
      groups: [{ id: 'gB', name: 'Office', kind: 'building', providers: ['pT'] }],
      nodes: [
        N('rt', 'router', '10.0.0.1/24', { name: 'R1', providers: ['pI'], checks: [{ id: 'p', proto: 'ping' }, { id: 'w', proto: 'http' }] }),
        N('sw', 'switch', '10.0.0.2/24', { name: 'SW1', group: 'gB', target: 99.9, checks: [{ id: 'p', proto: 'ping', slowMs: 50 }] }),
        N('pc', 'pc', '10.0.0.9/24', { name: 'PC1', group: 'gB' })],
      links: [{ id: 'l1', source: 'rt', target: 'sw' }, { id: 'l2', source: 'sw', target: 'pc' }],
      incidents: [
        // R1 down 10:00-10:30 two days ago, SW1 behind it; acknowledged 10:05 by Ana.
        { id: 'inaaaaaaaaaa', kind: 'outage', at: TO - 2 * DAY - 2 * HOUR, status: 'closed', symptom: 'internet', nodeIds: ['rt'], behind: ['sw'], monitor: 'Building B',
          outages: [{ from: TO - 2 * DAY - 2 * HOUR, to: TO - 2 * DAY - 2 * HOUR + 30 * 60000 }], acts: [{ act: 'ack', at: TO - 2 * DAY - 2 * HOUR + 5 * 60000, by: 'Ana' }],
          closedAt: TO - 2 * DAY - 2 * HOUR + 5 * 60000, reporter: {}, routedTo: [], visits: [] },
        // R1 again yesterday, 20 min, expected (maintenance).
        { id: 'inbbbbbbbbbb', kind: 'outage', at: TO - DAY, status: 'closed', symptom: 'internet', nodeIds: ['rt'],
          outages: [{ from: TO - DAY, to: TO - DAY + 20 * 60000 }], acts: [{ act: 'expected', at: TO - DAY + 60000, by: 'Bo' }], closedAt: TO - DAY + 60000, reporter: {}, routedTo: [], visits: [] },
        // SW1 itself, now, not acted on.
        { id: 'incccccccccc', kind: 'outage', at: NOW - 15 * 60000, status: 'open', symptom: 'other', nodeIds: ['sw'], outages: [{ from: NOW - 15 * 60000 }], reporter: {}, routedTo: [], visits: [] }]
    });
    replaceDocument(clone(site()), { origin: 'file', docId: 'rp-1' });
    const doc = () => serializeDoc();

    // ---- 1. the period ----
    {
      const w = RP.periodRange('week', { now: NOW });
      const d = RP.periodRange('day', { now: NOW });
      const q = RP.periodRange('quarter', { now: NOW });
      ok('1.1 the periods end at the last whole hour and are 24 h, 7, 30 and 91 days long',
        w.to === TO && w.from === TO - 7 * DAY && d.from === TO - DAY && q.from === TO - 91 * DAY && RP.periodRange('month', { now: NOW }).from === TO - 30 * DAY, show([w, d]));
      const none = RP.periodRange('visit', { now: NOW, doc: doc() });
      const withVisit = Object.assign(doc(), { log: [{ id: 'v1', kind: 'visit', at: TO - 3 * DAY - 20 * 60000, providerId: 'pT' }, { id: 'v2', kind: 'visit', at: TO - 5 * DAY, left: TO - 5 * DAY + 10 * 60000, providerId: 'pI' }] });
      const v = RP.periodRange('visit', { now: NOW, doc: withVisit });
      const vI = RP.periodRange('visit', { now: NOW, doc: withVisit, providerIds: ['pI'] });
      const soon = RP.periodRange('visit', { now: NOW, doc: Object.assign(doc(), { log: [{ id: 'v3', kind: 'visit', at: NOW - 60000 }] }) });
      ok('1.2 since the last visit: from the first whole hour after it (a provider\'s own for theirs); none, and less than an hour, said',
        none.none === 'visit' && v.from === TO - 3 * DAY && vI.from === TO - 5 * DAY + HOUR && soon.none === 'soon', show([none, v.from - TO, vI.from - TO, soon]));
      ok('1.3 the chart\'s steps: 24 for a day, 28 for a week, 30 for 30 days, 13 for a quarter',
        RP.stepFor(d) === HOUR && (w.to - w.from) / RP.stepFor(w) === 28 && RP.stepFor(RP.periodRange('month', { now: NOW })) === DAY && Math.ceil((q.to - q.from) / RP.stepFor(q)) === 13);
    }

    // ---- 2-4. the model on known figures ----
    const range = RP.periodRange('week', { now: NOW });
    // R1 ping: every hour of the week measured, except 24 hours nobody
    // wrote; one hour 10:00 two days ago with 30 min down (its own), one
    // hour yesterday quiet (maintenance), 40 of its checks asked over TCP.
    const rtHours = [];
    for (let h = range.from; h < range.to; h += HOUR) {
      if (h >= range.from && h < range.from + DAY) continue;   // not measured
      if (h === TO - 2 * DAY - 2 * HOUR) rtHours.push(H(h, { ok: 30, fail: 30, sUp: 1800, sDown: 1800, tcp: 40 }));
      else if (h === TO - DAY) rtHours.push(H(h, { sUp: 2400, sMaint: 1200 }));
      else rtHours.push(H(h, { rttMed: 4, rttP95: 9 }));
    }
    // SW1: two monitors; A every hour, down 30 min because of R1 in that
    // hour and slow for 10 min an hour at 09:00 each day; B only the last
    // two days.
    const swA = [], swB = [];
    for (let h = range.from; h < range.to; h += HOUR) {
      const f = h === TO - 2 * DAY - 2 * HOUR ? { ok: 30, fail: 30, sUp: 1800, sDown: 1800, sUpstream: 1800 } : {};
      if (new Date(h).getHours() === 9) Object.assign(f, { sUp: 3000, sSlow: 600, rttMed: 80, rttP95: 120 });
      swA.push(H(h, Object.assign({ rttMed: 2, rttP95: 3 }, f)));
      if (h >= TO - 2 * DAY) swB.push(H(h, { rttMed: 6, rttP95: 7 }));
    }
    const data = { source: 'server', statsDays: 360, streams: [
      { key: 'rt/p', monitor: 'mA', name: 'Building B', hours: rtHours },
      { key: 'sw/p', monitor: 'mA', name: 'Building B', hours: swA },
      { key: 'sw/p', monitor: 'mB', name: 'Office PC', hours: swB.concat([H(TO + HOUR)]) }] };
    const m = RP.buildModel(doc(), data, { scope: 'site', period: 'week', range, parts: RP.PARTS });
    const row = (k) => m.rows.find((r) => r.key === k);
    const rt = row('rt/p'), sw = row('sw/p'), rw = row('rt/w');
    {
      const up = (6 * 24 - 2) * 3600 + 1800 + 2400, down = 1800;
      ok('2.1 availability: up / (up + down), maintenance and unknown left out', Math.abs(rt.avail - up / (up + down)) < 1e-9 && rt.down === 1800 && rt.maint === 1200, show([rt.avail, up / (up + down)]));
      ok('2.2 the coverage: 6 days of 7 measured (the day nobody wrote is not measured)', Math.abs(rt.coverage - 6 / 7) < 1e-9, String(rt.coverage));
      ok('2.3 a check with no figures has no availability (never 100 %) and no coverage', rw && rw.avail === null && rw.coverage === 0 && rw.checks === 0, show(rw && [rw.avail, rw.coverage]));
      ok('2.4 two monitors on one check: pooled, over both their spans', sw.monitors.length === 2 && Math.abs(sw.coverage - (7 * 24 + 48) / (2 * 7 * 24)) < 1e-9 && !sw.monitors.includes(undefined), show([sw.coverage, sw.monitors]));
      ok('2.5 an hour after the period is left out', sw.hours === 7 * 24 + 48, String(sw.hours));
      ok('2.6 down because of a device upstream is named after the outage that had it behind ("down because R1")',
        sw.causes.length === 1 && sw.causes[0].id === 'rt' && sw.causes[0].name === 'R1' && sw.causes[0].s === 1800 && sw.upstream === 1800, show(sw.causes));
      ok('2.7 ...and left out of the figure the target is judged on', sw.ownAvail === 1 && sw.avail < 1 && sw.target === 99.9 && sw.met === true, show([sw.avail, sw.ownAvail, sw.met]));
      ok('2.8 the device\'s target, else its provider\'s: R1 99.5 (Fibra Norte), met at 99.65 % with 30 min down', rt.target === 99.5 && rt.targetFrom === 'provider' && rt.met === true
        && Math.abs(rt.ownAvail - 515400 / 517200) < 1e-9, show([rt.target, rt.targetFrom, rt.ownAvail, rt.met]));
      const strict = clone(doc()); strict.providers[0].target = 99.9;
      const ms = RP.buildModel(strict, data, { scope: 'site', range, parts: RP.PARTS });
      const rs = ms.rows.find((r) => r.key === 'rt/p');
      ok('2.8b a target missed: R1 at 99.65 % against 99.9, said in red', rs.met === false && /<span class="bad">missed<\/span>/.test(RP.reportHtml(ms))
        && RP.csvOf(ms).text.split(/\r?\n/).some((l) => l.startsWith('availability,R1,rt,Ping') && /,99\.9,false,/.test(l)), show([rs.ownAvail, rs.met]));
      ok('2.9 pooled per device, group (Office: SW1) and provider (Fibra Norte: R1; Andes IT: SW1 through its group), and the report',
        m.devices.length === 2 && m.groups.length === 1 && m.groups[0].name === 'Office' && m.groups[0].rows === 1
        && m.providers.map((p) => p.name).join() === 'Fibra Norte,Andes IT' && m.total.rows === 3 && m.total.down === 3600, show([m.groups, m.providers.map((p) => [p.name, p.rows])]));
      // The provider's support hours: Mon-Fri 9-17 only.
      const mp = RP.buildModel(doc(), data, { scope: 'provider', id: 'pI', period: 'week', range, basis: 'hours', parts: RP.PARTS });
      const mpAll = RP.buildModel(doc(), data, { scope: 'provider', id: 'pI', period: 'week', range, basis: 'all', parts: RP.PARTS });
      let open = 0;
      for (let h = range.from; h < range.to; h += HOUR) { const d = new Date(h + HOUR / 2); if (d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 9 && d.getHours() < 17) open++; }
      ok('2.10 a provider\'s support hours: only their hours count, in the figures and the span; around the clock when asked',
        mp.basis === 'hours' && mp.rows.length === 2 && mp.rows[0].spanS === open * 3600 && mp.rows[0].hours <= open && mpAll.basis === 'all' && mpAll.rows[0].spanS === 7 * DAY / 1000,
        show([mp.basis, mp.rows[0].spanS / 3600, open, mp.rows[0].hours]));
      ok('2.11 a provider\'s report covers only their devices, with their target', mp.rows.every((r) => r.node === 'rt') && mp.total.target === 99.5, show(mp.rows.map((r) => r.key)));
      const bad = clone(doc()); bad.providers[0].hours = 'when they feel like it';
      const mb = RP.buildModel(bad, data, { scope: 'provider', id: 'pI', range, basis: 'hours', parts: RP.PARTS });
      ok('2.12 support hours that do not read: the whole day counts, and it says so', mb.basis === 'all' && mb.hoursAsked && !mb.hoursRead && /whole day counts/.test(RP.reportHtml(mb)));
      const always = clone(doc()); always.providers[0].hours = '24/7';
      const ma = RP.buildModel(always, data, { scope: 'provider', id: 'pI', range, basis: 'hours', parts: RP.PARTS });
      const maHtml = RP.reportHtml(ma);
      ok('2.13 support hours of 24/7 read as around the clock, never "do not read"', ma.basis === 'all' && ma.hoursAlways && /their support hours are 24\/7/.test(maHtml) && !/whole day counts/.test(maHtml));
      const dsw = m.devices.find((d) => d.node === 'sw'), pvI = m.providers.find((p) => p.id === 'pI'), pvT = m.providers.find((p) => p.id === 'pT');
      ok('2.14 the per-device rows carry their verdict; a provider judged in their support hours gets none on around-the-clock figures',
        dsw.target === 99.9 && dsw.met === true && pvI.hoursOnly && pvI.met === null && pvI.target === 99.5 && pvT.met === true, show([dsw.met, pvI.met, pvT.met]));
      // Several providers (a Report a problem sent to two): each device on
      // its own provider's target, no pooled target, no one's hours.
      const two = clone(doc()); delete two.nodes.find((n) => n.id === 'sw').target;
      const m2 = RP.buildModel(two, data, { scope: 'provider', id: ['pI', 'pT'], range, basis: 'hours', parts: RP.PARTS });
      const r2 = (k) => m2.rows.find((r) => r.key === k);
      ok('2.15 a report on several providers: each device on its own provider\'s target (SW1 99 from Andes IT, R1 99.5), no pooled target, around the clock, per provider',
        r2('sw/p').target === 99 && r2('rt/p').target === 99.5 && m2.total.target === undefined && m2.basis === 'all' && m2.providers.length === 2
        && /judged on its own provider/.test(RP.reportHtml(m2)), show([r2('sw/p').target, m2.total.target, m2.basis, m2.providers.length]));
    }
    {
      ok('3.1 the median and 95th percentile weighted by answers, the jitter, the extremes', rt.med === 4 && rt.p95 === 9 && rt.jitter === 0.5 && rt.min === 1 && rt.max === 20, show([rt.med, rt.p95, rt.jitter]));
      ok('3.2 loss: the failed checks of the asked', Math.abs(rt.loss - 30 / rt.checks) < 1e-12, String(rt.loss));
      ok('3.3 "TCP, not ping" from the hours\' tcp', rt.via === 'tcp' && sw.via === '', show([rt.via, rt.tcp]));
      ok('3.4 the chart: 28 steps of 6 hours, each with its state (a red step where it was down)', rt.series.length === 28 && rt.series.some((b) => b.state === 'd') && rt.series[0].state === '-', show(rt.series.map((b) => b.state).join('')));
      ok('3.5 the slow hours of the day: 09:00, 10 min each of 7 days', m.slowByHour[9] === 7 * 600 && m.slowByHour.filter((x) => x > 0).length === 1, show(m.slowByHour));
    }
    {
      const o = m.outages;
      const a = o.find((x) => x.id === 'inaaaaaaaaaa'), c = o.find((x) => x.id === 'incccccccccc');
      ok('4.1 the outages of the period, oldest first, the one going on included', o.length === 3 && o[0].id === 'inaaaaaaaaaa' && c && c.to === null, show(o.map((x) => x.id)));
      ok('4.2 its time down, root cause (its own, a device behind it), who acted and the time to acknowledge',
        a.downMs === 30 * 60000 && a.own && a.behind.join() === 'SW1' && a.acts[0].by === 'Ana' && a.ackMs === 5 * 60000 && c.downMs === 15 * 60000 && c.ackMs === null, show([a, c]));
      const mg = RP.buildModel(doc(), data, { scope: 'group', id: 'gB', range, parts: RP.PARTS });
      const behind = mg.outages.find((x) => x.id === 'inaaaaaaaaaa');
      ok('4.3 a group\'s report lists the outage of a device it was behind, as "down because R1"', behind && !behind.own && behind.behindHere.join() === 'SW1'
        && /down because R1/.test(RP.reportHtml(mg)), show(behind));
      const rr = m.reliability.find((x) => x.node === 'rt'), rs = m.reliability.find((x) => x.node === 'sw');
      ok('4.4 MTTR and MTBF per device; Expected is maintenance, not a failure', rr.failures === 1 && rr.mttr === 30 * 60000 && Math.abs(rr.mtbf - (NOW - range.from - 30 * 60000)) < 1
        && rs.failures === 1 && rs.mttr === null, show([rr, rs]));
      // A group inside a group inside a building: its report lists the
      // groups inside it only, never itself or the building it is in.
      const nest = clone(doc());
      nest.groups = [{ id: 'gP', name: 'Building A', kind: 'building' }, { id: 'gB', name: 'Office', kind: 'room', parent: 'gP', providers: ['pT'] }, { id: 'gC', name: 'Desk row', kind: 'room', parent: 'gB' }];
      nest.nodes.find((n) => n.id === 'sw').group = 'gC';
      const mn = RP.buildModel(nest, data, { scope: 'group', id: 'gB', range, parts: RP.PARTS });
      const mns = RP.buildModel(nest, data, { scope: 'site', range, parts: RP.PARTS });
      ok('4.5 a nested group\'s report: only the groups inside it, never the building it is in', mn.groups.map((g) => g.id).join() === 'gC' && mns.groups.map((g) => g.id).sort().join() === 'gB,gC,gP',
        show([mn.groups.map((g) => g.id), mns.groups.map((g) => g.id)]));
      // No period: no outage listed, counted or written.
      const rn = RP.periodRange('visit', { now: NOW, doc: doc() });
      const mnone = RP.buildModel(doc(), data, { scope: 'site', period: 'visit', range: rn, parts: RP.PARTS });
      const csvNone = RP.csvOf(mnone).text.split(/\r?\n/).filter((l) => l.startsWith('outage,'));
      ok('4.6 since the last visit with no visit: no outage listed, in the tile or the CSV', rn.none === 'visit' && mnone.outages.length === 0 && mnone.reliability.length === 0 && !csvNone.length
        && /No visit has been recorded/.test(RP.reportHtml(mnone)), show([mnone.outages.length, csvNone.length]));
      ok('4.7 the period line says the outages run on to now (the one going on in this hour is listed)', /The outages are listed up to/.test(RP.reportHtml(m)));
      // A blob pushed before Expected was chosen still holds the time as
      // down: the report counts it as maintenance, as this PC's figures do.
      const pushed = rtHours.map((h) => (h.hour === TO - DAY ? Object.assign({}, h, { sUp: 2400, sDown: 1200, sMaint: 0 }) : h));
      const me = RP.buildModel(doc(), Object.assign({}, data, { streams: [Object.assign({}, data.streams[0], { hours: pushed })].concat(data.streams.slice(1)) }), { scope: 'site', range, parts: RP.PARTS });
      const re = me.rows.find((r) => r.key === 'rt/p');
      ok('4.8 Expected on an earlier day\'s server blob: its down time counted as maintenance, never twice', re.down === 1800 && re.maint === 1200 && Math.abs(re.avail - rt.avail) < 1e-12, show([re.down, re.maint]));
    }

    // ---- 5. the CSV ----
    {
      const c = RP.csvOf(m);
      const lines = c.text.replace(/^﻿/, '').trim().split(/\r?\n/);
      const head = lines[0].split(',');
      const sections = lines.slice(1).map((l) => l.split(',')[0]);
      const count = (s) => sections.filter((x) => x === s).length;
      ok('5.1 the CSV: English columns, a .csv named as the network\'s files', head[0] === 'section' && head.includes('availability_without_upstream') && head.includes('time_to_acknowledge_s') && /_monitoring\.csv$/.test(c.name), c.name);
      ok('5.2 a row per check, device, group, provider and total; per step; per outage',
        count('availability') === 3 && count('availability-device') === 2 && count('availability-group') === 1 && count('availability-provider') === 2 && count('availability-total') === 1
        && count('response') === 3 * 28 && count('outage') === 3, show([count('availability'), count('response'), count('outage')]));
      const rtLine = lines.find((l) => l.startsWith('availability,R1,rt,Ping'));
      ok('5.3 numbers with a dot, times in ISO', rtLine && /,0\.99\d*,/.test(rtLine) && /\d{4}-\d\d-\d\dT\d\d:00:00\.000Z/.test(rtLine), rtLine);
      const only = RP.csvOf(Object.assign({}, m, { parts: ['outages'] }));
      ok('5.4 only what goes in', only.rows === 3, String(only.rows));
      const acts2 = clone(doc());
      acts2.incidents[0].acts.push({ act: 'report', at: TO - 2 * DAY - 2 * HOUR + 9 * 60000, by: 'Bo' });
      const twoActs = RP.csvOf(RP.buildModel(acts2, data, { scope: 'site', range, parts: ['outages'] })).text;
      ok('5.5 an outage row carries every act, in order', /,ack; report,Ana; Bo,\d{4}-[^,]*Z; \d{4}-[^,]*Z,/.test(twoActs), twoActs.split(/\r?\n/)[1]);
    }

    // ---- 6. where the figures come from ----
    {
      MON.siteOfOpen = () => null;
      CK.state.info = null;
      const g0 = await RP.gather(range, doc());
      ok('6.1 the website, no server: no figures, said; the outages still listed', g0.source === 'none' && /No figures/.test(RP.reportHtml(RP.buildModel(doc(), g0, { scope: 'site', range, parts: RP.PARTS })))
        && RP.buildModel(doc(), g0, { scope: 'site', range, parts: RP.PARTS }).outages.length === 3, show(g0));
      // This PC's own monitor of the open network.
      const asked = [];
      RP.state.invoke = (cmd, a) => { asked.push([cmd, a]); return cmd === 'monitor_figures' ? { 'rt/p': rtHours.slice(0, 5) } : null; };
      const lib = state.libraryId;
      state.libraryId = 'k-rp';
      CK.state.info = { on: true, networkId: 'k-rp', retentionDays: 90, monitorName: 'FRONT-PC' };
      const g1 = await RP.gather(range, doc());
      ok('6.2 this PC\'s monitor: monitor_figures asked with every check\'s key over the period', g1.source === 'local' && asked.length === 1 && asked[0][1].keys.join() === 'rt/p,rt/w,sw/p'
        && asked[0][1].from === range.from && asked[0][1].to === range.to && g1.streams[0].name === 'FRONT-PC' && g1.statsDays === 90, show([asked, g1.streams.length]));
      CK.state.info = { on: true, networkId: 'other', retentionDays: 90 };
      const g2 = await RP.gather(range, doc());
      CK.state.info = { on: true, networkId: 'k-rp', retentionDays: 0 };
      const g3 = await RP.gather(range, doc());
      ok('6.3 another network monitored: nothing asked; statistics Off: said', g2.source === 'none' && asked.length === 1 && g3.off && /Statistics are off/.test(RP.reportHtml(RP.buildModel(doc(), g3, { scope: 'site', range, parts: RP.PARTS }))), show([g2, g3]));
      CK.state.info = { on: true, networkId: 'k-rp', retentionDays: 30 };
      const kept = RP.buildModel(doc(), { source: 'local', streams: [], statsDays: 30 }, { scope: 'site', range: RP.periodRange('quarter', { now: NOW }), parts: RP.PARTS });
      ok('6.4 a period longer than statistics are kept says so', /kept 30 days/.test(RP.reportHtml(kept)));
      state.libraryId = lib;
      RP.state.invoke = null;
      // A server's site: every monitor's blobs.
      MON.siteOfOpen = () => 's_1';
      MON.loadMonitors = async () => ({ statsDays: 360, monitors: [{ id: 'mA', name: 'Building B' }] });
      let statArgs = null;
      MON.stats = async (s, from, to) => { statArgs = [s, from, to]; return [{ monitor: 'mA', name: '', day: 1, checks: { 'rt/p': { node: 'rt', hours: rtHours.slice(0, 3) } } }, { monitor: 'mA', name: '', day: 2, checks: { 'rt/p': { node: 'rt', hours: rtHours.slice(3, 5) } } }]; };
      const g4 = await RP.gather(range, doc());
      ok('6.5 a server\'s site: the blobs of every day of the period, one stream per check and monitor, named', g4.source === 'server' && g4.streams.length === 1 && g4.streams[0].hours.length === 5
        && g4.streams[0].name === 'Building B' && statArgs[1] === Math.floor(range.from / DAY) * DAY, show([g4.streams.length, statArgs]));
      MON.loadMonitors = async () => ({ statsDays: 0, monitors: [] });
      const g5 = await RP.gather(range, doc());
      MON.loadMonitors = async () => { throw new Error('offline'); };
      const g6 = await RP.gather(range, doc());
      ok('6.6 the site\'s statistics Off, and a server that cannot be read, said', g5.off && g6.error && /could not be read from the server/.test(RP.reportHtml(RP.buildModel(doc(), g6, { scope: 'site', range, parts: RP.PARTS }))));
      Object.assign(MON, { siteOfOpen: held.siteOfOpen, loadMonitors: held.loadMonitors, stats: held.stats });
      // TopoMonitors.stats reads on past the server's 400.
      const TS = window.TopoServer, TY = window.TopoServerSync;
      const heldApi = TS.api, heldWalk = TY.walkRosters;
      const calls = [];
      TS.api = async (method, path) => {
        calls.push(path);
        const from = +/from=(\d+)/.exec(path)[1];
        const list = [];
        for (let d = from; list.length < 400 && d < from + 3; d++) for (let k = 0; k < 250 && list.length < 400; k++) list.push({ monitor: 'm' + k, day: d, record: {} });
        return { stats: from >= 2 ? list.slice(0, 120) : list };
      };
      TY.walkRosters = async () => ({ rosters: [], pubs: {} });
      try { await MON.stats('s_1', 0, 9); } catch (e) { calls.push('error ' + e.message); }
      TS.api = heldApi; TY.walkRosters = heldWalk;
      ok('6.7 the statistics are read on past 400 blobs, from the last day answered', calls.length === 3 && /from=0&/.test(calls[0]) && /from=1&/.test(calls[1]) && /from=2&/.test(calls[2]), show(calls));
    }

    // ---- 7. the preview ----
    {
      MON.siteOfOpen = () => 's_1';
      MON.loadMonitors = async () => ({ statsDays: 360, monitors: [] });
      MON.stats = async () => [{ monitor: 'mA', name: 'Building B', day: 0, checks: { 'rt/p': { node: 'rt', hours: rtHours }, 'sw/p': { node: 'sw', hours: swA } } }];
      el('monitorReportBtn').click();
      await until(() => sheetPreviewOpen() && !!sheetPreviewBuilt());
      await wait(400);
      const b = sheetPreviewBuilt();
      const ctl = el('sheetPreviewControls');
      ok('7.1 the menu\'s Monitoring report opens the preview: the week, the whole network, its charts and tables',
        b && /Monitoring report/.test(b.html) && (b.html.match(/<svg /g) || []).length === 4 && /Last 7 days/.test(b.html) && /_monitoring\.html$/.test(b.name), b && b.name);
      ok('7.2 its choices in the left column: on what, the period, what goes in (Connections too, on a server: step 8f); Print, CSV and Download',
        !ctl.hidden && !!ctl.querySelector('[data-rp="scope"]') && !!ctl.querySelector('[data-rp="period"]') && ctl.querySelectorAll('[data-rp="part"]').length === 4 && !!ctl.querySelector('[data-rp="part"][value="connections"]')
        && !el('sheetPreviewCsv').hidden && !el('sheetPreviewOpts').hidden, ctl.innerHTML.slice(0, 120));
      const per = ctl.querySelector('[data-rp="period"]');
      per.value = 'day'; per.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => /Last 24 hours/.test((sheetPreviewBuilt() || {}).html || ''));
      ok('7.3 a choice rebuilds it (the last 24 hours)', /Last 24 hours/.test(sheetPreviewBuilt().html));
      const tick = ctl.querySelector('[data-rp="part"][value="response"]');
      tick.checked = false; tick.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => !/<svg /.test((sheetPreviewBuilt() || {}).html || 'x<svg '));
      ok('7.4 what goes in: without Response times, no chart', !/<svg /.test(sheetPreviewBuilt().html) && /Outages/.test(sheetPreviewBuilt().html));
      saved.length = 0;
      await until(() => !el('sheetPreviewCsv').disabled);
      el('sheetPreviewCsv').click();
      ok('7.5 CSV saves the spreadsheet; the preview stays', saved.length === 1 && /_monitoring\.csv$/.test(saved[0].name) && sheetPreviewOpen(), show(saved.map((x) => x.name)));
      const sc = ctl.querySelector('[data-rp="scope"]');
      sc.value = 'provider'; sc.dispatchEvent(new Event('change', { bubbles: true }));
      await until(() => /Fibra Norte/.test((sheetPreviewBuilt() || {}).html || ''));
      ok('7.6 on a provider: their name, their hours offered, their own support hours first', !!ctl.querySelector('[data-rp="id"]') && ctl.querySelector('input[data-rp="basis"][value="hours"]').checked
        && /Only during their support hours/.test(sheetPreviewBuilt().html), ctl.textContent.slice(0, 200));
      // At 360: the choices 44px, nothing sideways.
      const small = [...ctl.querySelectorAll('select, label:has(input)')].map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0 && r.height < 44);
      ok('7.7 at 360: the choices are 44px, no sideways scroll', innerWidth > 500 || (small.length === 0 && document.documentElement.scrollWidth <= innerWidth), show([innerWidth, small.length]));
      closeSheetPreview();
      ok('7.8 closed: the choices and CSV go with it', ctl.hidden && !ctl.childElementCount && el('sheetPreviewCsv').hidden);
      // The device's Answer checks link (the website's read-only section on a server's site).
      select('sw', 'node');
      await wait(50);
      const grp = el('checkGroup');
      if (grp) grp.open = true;
      if (typeof renderCheckSection === 'function') renderCheckSection(getNode('sw'));
      const link = el('checkBody') && el('checkBody').querySelector('[data-ck="report"]');
      if (link) link.click();
      await until(() => sheetPreviewOpen() && /SW1/.test((sheetPreviewBuilt() || {}).html || ''));
      ok('7.9 the device\'s Answer checks link opens its own report', !!link && sheetPreviewOpen() && /Monitoring report: SW1/.test(sheetPreviewBuilt().html), String(!!link));
      closeSheetPreview();
      Object.assign(MON, { siteOfOpen: held.siteOfOpen, loadMonitors: held.loadMonitors, stats: held.stats });
    }

    // ---- 8. the provider's target ----
    {
      const noTarget = clone(site()); delete noTarget.providers[1].target;
      replaceDocument(noTarget, { origin: 'file', docId: 'rp-2' });
      const before = state.undoStack ? state.undoStack.length : null;
      showConfigTab('providers');
      await wait(100);
      if (typeof renderProvidersPanel === 'function') renderProvidersPanel(true);
      const edit = document.querySelector('[data-act="edit"][data-pv="pT"]');
      if (edit) edit.click();
      await wait(50);
      const f = document.querySelector('[data-field="target"][data-pv="pT"]');
      const tk = document.querySelector('[data-field="targetHours"][data-pv="pT"]');
      if (f) { f.value = '99,95'; f.dispatchEvent(new Event('change', { bubbles: true })); }
      const afterTarget = state.providers[1].target;
      const tk2 = document.querySelector('[data-field="targetHours"][data-pv="pT"]');
      if (tk2) { tk2.checked = true; tk2.dispatchEvent(new Event('change', { bubbles: true })); }
      if (!tk2 && tk) { tk.checked = true; tk.dispatchEvent(new Event('change', { bubbles: true })); }
      ok('8.1 the provider card: the target (99,95 reads as 99.95) and the support-hours tick', afterTarget === 99.95 && state.providers[1].targetHours === true, show(state.providers[1]));
      undo();
      ok('8.2 one undo step each', state.providers[1].target === 99.95 && !state.providers[1].targetHours, show(state.providers[1]));
      undo();
      ok('8.3 ...and the target\'s', state.providers[1].target === undefined, show(state.providers[1]));
      const ser = canonicalDoc(Object.assign(clone(site()), {}));
      ok('8.4 kept as v19 writes it', ser.providers[0].target === 99.5 && ser.providers[0].targetHours === true && ser.providers[1].targetHours === undefined, show(ser.providers));
      const bad = canonicalDoc(Object.assign(clone(site()), { providers: [{ id: 'p', name: 'X', target: 100, targetHours: 'yes' }] }));
      ok('8.5 a target out of range is dropped', bad.providers[0].target === undefined && bad.providers[0].targetHours === true, show(bad.providers));
      const sheet = csvProvidersSheet();
      ok('8.6 providers.csv carries them', sheet && sheet.headers.includes('availability_target') && sheet.headers.includes('target_support_hours')
        && sheet.rows[0][sheet.headers.indexOf('availability_target')] === '99.5', show(sheet && sheet.headers));
      // The provider's report carries the section.
      MON.siteOfOpen = () => 's_1';
      MON.loadMonitors = async () => ({ statsDays: 360, monitors: [] });
      MON.stats = async () => [{ monitor: 'mA', name: 'Building B', day: 0, checks: { 'rt/p': { node: 'rt', hours: rtHours } } }];
      const file = await TopoProviderReport.providerReportFile(['pI'], { format: 'html', audience: 'client' });
      const html = file ? await file.blob.text() : '';
      ok('8.7 their report (the file a Report a problem attaches) carries their monitoring section', /Monitoring/.test(html) && /R1 · Ping/.test(html) && /Target/.test(html) && !/SW1 · Ping/.test(html), html.length);
      const none = await TopoProviderReport.providerReportFile(['pT'], { format: 'html', audience: 'client' });
      Object.assign(MON, { siteOfOpen: held.siteOfOpen, loadMonitors: held.loadMonitors, stats: held.stats });
      const noneHtml = none ? await none.blob.text() : '';
      ok('8.8 a provider whose devices have no figures gets the section saying so, never a failure', !!none && /Monitoring/.test(noneHtml) && /SW1 · Ping/.test(noneHtml) && /0 % measured/.test(noneHtml),
        noneHtml.length);
      // Their section's period: since their last visit within 91 days, else
      // the last 30 days.
      MON.siteOfOpen = () => 's_1';
      MON.loadMonitors = async () => ({ statsDays: 360, monitors: [] });
      MON.stats = async () => [];
      const withLog = (ago) => Object.assign(serializeDoc(), { log: ago == null ? [] : [{ id: 'vx', kind: 'visit', at: NOW - ago, providerId: 'pT' }] });
      const p10 = await RP.providerMonitoring(withLog(10 * DAY), ['pT']);
      const p120 = await RP.providerMonitoring(withLog(120 * DAY), ['pT']);
      const p0 = await RP.providerMonitoring(withLog(null), ['pT']);
      const pBoth = await RP.providerMonitoring(withLog(null), ['pI', 'pT']);
      Object.assign(MON, { siteOfOpen: held.siteOfOpen, loadMonitors: held.loadMonitors, stats: held.stats });
      ok('8.9 their section: since their visit 10 days ago; the last 30 days for one 120 days ago or none; no one\'s hours for two providers',
        p10.period === 'visit' && p10.range.from === Math.ceil((NOW - 10 * DAY) / HOUR) * HOUR && p120.period === 'month' && p0.period === 'month' && pBoth.basis === 'all' && pBoth.several,
        show([p10.period, p120.period, p0.period, pBoth.basis]));
    }

    // ---- 9. the network report's outages ----
    {
      const sec = incidentsReportSection(state.incidents, state.log);
      ok('9.1 the network report prints an outage as an outage: times down, behind it, who acted, the time to acknowledge',
        /Not answering: R1/.test(sec) && /Behind it/.test(sec) && /SW1/.test(sec) && /Acknowledged by Ana/.test(sec) && /Time to acknowledge/.test(sec) && /5 min/.test(sec) && /still not answering/.test(sec), sec.slice(0, 300));
    }

    // ---- 10. translated ----
    {
      const words = ['Availability', 'Outages', 'Who acted', 'Time to acknowledge', 'Not counting upstream'];
      const res = [];
      ['es', 'pt-BR', 'ru', 'ja'].forEach((l) => {
        setLocale(l);
        const h = RP.reportHtml(m);
        res.push([l, words.filter((w) => h.includes('>' + w + '<')), /パソコン/.test(h)]);
      });
      setLocale('en');
      ok('10.1 the report in every language, none of its words left in English; Japanese never パソコン', res.every((x) => !x[1].length && !x[2]), show(res));
      setLocale('ja');
      const ja = RP.reportHtml(RP.buildModel(doc(), { source: 'local', streams: [], error: true }, { scope: 'site', range, parts: RP.PARTS }));
      setLocale('en');
      ok('10.2 Japanese says PC', /このPC/.test(ja), '');
    }
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 500));
  } finally {
    RP.state.now = null; RP.state.invoke = null;
    Object.assign(MON, { siteOfOpen: held.siteOfOpen, loadMonitors: held.loadMonitors, stats: held.stats });
    CK.state.info = held.info;
    window.saveBlob = held.saveBlob;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
  }
}, 300); });
