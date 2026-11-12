// Connections, the page's side (docs/SCOPE.md D376-D379, step 8f;
// js/connections.js; the server's side is server/internal/api/
// connections_test.go, the app's desktop/src-tauri/src/connwatch.rs):
//   1. a watched PC lost: the banner line, one notification with Show
//      alarms on (none twice, none without), back: the line goes and the
//      toast says when and for how long;
//   2. this app's server not answering: the banner line, back: the toast;
//   3. what the server says now (a lost PC listed) on opening a site; a PC
//      that went away is not lost;
//   4. Settings: Watch this PC's connection, the app only on a server;
//      turning it on sends the PC's name and the words the app says alone;
//   5. the report's Connections: connected over watched, the server's gaps
//      counted, the PC's own listed, seen by whom, a monitor's row, only for
//      the site on a server;
//   6. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const el = (id) => document.getElementById(id);
  const CN = window.TopoConnections;
  const TS = window.TopoServer;
  const held = { ready: TS && TS.ready, api: TS && TS.api, info: window.TopoChecks && TopoChecks.state.info, toast: window.showToast };
  const asked = [];
  const toasts = [];
  try {
    setLocale('en');
    CN.state.invoke = async (cmd, args) => {
      asked.push([cmd, args]);
      if (cmd === 'this_computer') return { hostname: 'reception-pc' };
      if (cmd === 'connection_watch_set') return { on: args.args.on, name: args.args.name, silentSince: 0 };
      if (cmd === 'connection_watch_info') return { on: false, name: '', silentSince: 0 };
      return null;
    };
    window.showToast = (text, kind) => { toasts.push([text, kind]); };
    TopoChecks.state.info = { on: true, alarms: true };
    const at = new Date(2026, 10, 12, 10, 42).getTime();
    const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const banner = () => [...el('srvIssueBanner').querySelectorAll('.srv-ib-line')].map((b) => b.textContent);

    // ---- 1. A watched PC lost, then back ----
    CN.onConnection({ device: 'd1', name: 'Reception PC', lost: true, at });
    await tick();
    ok('lost: the banner says so', banner().includes(`Reception PC lost its connection to the server at ${clock(at)}`) && !el('srvIssueBanner').hidden, show(banner()));
    const notes = () => asked.filter((a) => a[0] === 'alarm_notify');
    ok('…a notification with Show alarms on, never the card', notes().length === 1 && /Reception PC lost its connection/.test(notes()[0][1].text) && !asked.some((a) => a[0] === 'alarm_test'));
    CN.onConnection({ device: 'd1', name: 'Reception PC', lost: true, at });
    await tick();
    ok('…said once', notes().length === 1);
    CN.onConnection({ device: 'd1', name: 'Reception PC', back: true, from: at, to: at + 23 * 60000 });
    await tick();
    ok('back: the line goes, the toast says when and how long', !banner().some((x) => /Reception PC/.test(x))
      && toasts.some(([text]) => text === `Reception PC connected again at ${clock(at + 23 * 60000)} (23 min)`), show(toasts));
    TopoChecks.state.info = { on: true, alarms: false };
    CN.onConnection({ device: 'd2', name: 'Lab PC', lost: true, at: at + 1 });
    ok('Show alarms off: no notification', notes().length === 1);
    CN.onConnection({ device: 'd2', name: 'Lab PC', back: true, from: at, to: at + 60000 });

    // ---- 2. This app: the server not answering ----
    CN.onSilent(at);
    await tick();
    ok('the server not answering: said in this window\'s banner', banner().includes(`The Topo server is not answering since ${clock(at)}`), show(banner()));
    CN.onBack(at, at + 5 * 60000);
    await tick();
    ok('…answering again: the line goes, said once', !banner().some((x) => /not answering since/.test(x))
      && toasts.some(([text]) => text === 'The Topo server is answering again (not answering for 5 min).'));

    // ---- 3. What the server says now ----
    TS.ready = () => true;
    TS.api = async (method, path) => {
      if (/\/connections/.test(path)) return { clients: [
        { id: 'd3', kind: 'pc', name: 'Front desk', lost: true, away: false, lastBeat: at },
        { id: 'd4', kind: 'pc', name: 'Gone home', lost: true, away: true, lastBeat: at },
        { id: 'm1', kind: 'monitor', name: 'Building B', lost: true, lastBeat: at }] };
      return {};
    };
    await CN.loadSite('s1');
    await tick();
    ok('opening a site: a lost PC is listed; one that went away is not; a monitor is the monitors\' line', CN.state.lost.has('d3') && !CN.state.lost.has('d4') && !CN.state.lost.has('m1'));
    CN.state.lost.clear();

    // ---- 4. Settings ----
    await CN.refreshInfo();
    CN.renderSettings();
    ok('in the app on a server: Watch this PC\'s connection, off', !el('setConnWatch').hidden && !el('setConnWatchOn').checked && /A browser tab is never watched/.test(el('setConnWatchStatus').textContent));
    await CN.setWatch(true);
    const set = asked.filter((a) => a[0] === 'connection_watch_set').pop();
    ok('on: its name and the words the app says alone', !!set && set[1].args.on === true && set[1].args.name === 'reception-pc'
      && set[1].args.silent === 'The Topo server has not answered this PC for {min} min.' && /\{min\}/.test(set[1].args.back), show(set && set[1]));
    ok('…and says how it is watched', el('setConnWatchOn').checked && /Watched as "reception-pc"/.test(el('setConnWatchStatus').textContent));
    TS.ready = () => false;
    CN.renderSettings();
    ok('no server: not offered', el('setConnWatch').hidden);

    // ---- 5. The report's Connections ----
    const RP = window.TopoReports;
    const HOUR = 3600000, TO = Math.floor(Date.now() / HOUR) * HOUR;
    const range = { kind: 'week', from: TO - 168 * HOUR, to: TO, now: TO };
    const data = { source: 'server', streams: [], statsDays: 360, connections: [
      { id: 'd1', kind: 'pc', name: 'Reception PC', email: 'ana@x.example', since: 0, gaps: [{ from: TO - 10 * HOUR, to: TO - 9 * HOUR, seenBy: 'server' }, { from: TO - 5 * HOUR, to: TO - 4.5 * HOUR, seenBy: 'client' }] },
      { id: 'm1', kind: 'monitor', name: 'Building B', since: TO - 24 * HOUR, gaps: [] }] };
    const m = RP.buildModel({ v: DOC_VERSION, nodes: [], links: [] }, data, { scope: 'site', period: 'week', range, parts: RP.PARTS });
    const r1 = m.connections && m.connections[0];
    ok('Connections: connected over the time watched, the server\'s gap counted, the PC\'s listed', !!r1 && Math.abs(r1.connected - 167 / 168) < 1e-9 && r1.gaps.length === 2
      && r1.gaps[1].seenBy === 'client', show(r1));
    ok('…a monitor watched from when it was made', m.connections[1].kind === 'monitor' && m.connections[1].watchedMs === 24 * HOUR && m.connections[1].connected === 1);
    const html = RP.reportHtml(m);
    ok('…drawn: the PC, its share, who saw each gap', /<h2>Connections<\/h2>/.test(html) && html.includes('Reception PC') && html.includes('99.4 %')
      && html.includes('seen by the server: lost') && html.includes('seen by the PC: the server not answering') && html.includes('Site monitor'), html.slice(html.indexOf('Connections'), html.indexOf('Connections') + 400));
    const mg = RP.buildModel({ v: DOC_VERSION, nodes: [], links: [] }, data, { scope: 'group', id: 'g', period: 'week', range, parts: RP.PARTS });
    ok('…only for the whole site', mg.connections === null && !/<h2>Connections<\/h2>/.test(RP.reportHtml(mg)));
    const mn = RP.buildModel({ v: DOC_VERSION, nodes: [], links: [] }, { source: 'local', streams: [] }, { scope: 'site', period: 'week', range, parts: RP.PARTS });
    ok('…and only on a server', mn.connections === null && !/<h2>Connections<\/h2>/.test(RP.reportHtml(mn)));

    // ---- 6. The strings ----
    const { has, locales } = window.CarinoI18N;
    const strs = ['{pc} lost its connection to the server at {time}', '{pc} connected again at {time} ({n} min)', 'The Topo server is not answering since {time}',
      'The Topo server is answering again (not answering for {n} min).', 'The Topo server has not answered this PC for {min} min.',
      'The Topo server is answering again (not answering for {min} min).', 'Watch this PC\'s connection',
      'Watched as "{name}". The people who share a site with you are told if it loses its connection; quitting or signing out is not losing it.',
      'Off. Turn it on for a PC that should always be connected (a reception desk, a modality\'s workstation). A browser tab is never watched.',
      'This PC\'s connection could not be watched: {error}', 'Connections', 'No PC\'s connection is watched on this site, and it has no monitor.',
      'Site monitor', 'Watched PC', 'the PC: the server not answering', 'the server: lost', 'PC', 'Connected', 'Gaps', 'lost its connection',
      '{from}, {time}, seen by {who}', 'None'];
    locales.forEach((loc) => { const missing = strs.filter((s) => !has(loc, s)); ok(`${loc} carries the strings`, !missing.length, missing.join(' | ')); });
    setLocale('ja');
    const ja = strs.map((s) => t(s)).join(' ');
    setLocale('en');
    ok('Japanese says PC, never パソコン', !ja.includes('パソコン') && ja.includes('この PC の接続を見守る'), ja.slice(0, 120));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    if (TS) { TS.ready = held.ready; TS.api = held.api; }
    if (window.TopoChecks) TopoChecks.state.info = held.info;
    window.showToast = held.toast;
    CN.state.invoke = null; CN.state.lost.clear(); CN.state.silentSince = 0;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
