// Age and upkeep (js/model.js "Age and upkeep", document v14). What is held:
//   1. the model: the service dates are as much as is known (a year, a
//      month or a day), typed or imported in the ways people write them,
//      and a date that is not one refused; the interval is months, or years
//      said as years; nothing stored that the readers would not keep;
//   2. the arithmetic: the age counts a month once its day is reached, a
//      year alone reads "about" and counts from mid-year, a start after
//      today is no age; the next service is the interval after the last one
//      (or after going into service), the 31st becomes the month's last day;
//   3. the document: the three fields travel through the serializer and
//      back, are left out when unset, and a v13 document opens as v14;
//   4. the side panel: the fields show the device's, typing sets them as
//      one undo step, what cannot be read is marked and not stored, and the
//      line under them says the age and the next service;
//   5. the table: the columns are there, typed into like any other, and Age
//      sorts by months, not by its text;
//   6. the spreadsheet and the bulk panel: devices.csv carries the fields
//      and reads back unchanged, a client's headings ("Purchase date",
//      "Last maintenance") find them, a network's own column of that name
//      still wins, and a set of devices takes a date in one go;
//   7. the report: the inventory line, as of the report's date;
//   8. the words are translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const typeInto = (input, text) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const heldResponder = setDialogResponder(null);
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'n10', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1' }],
    nodes: [
      { id: 'sw', type: 'switch', name: 'Core', x: 200, y: 100, portCount: 8, inService: '2019', serviceEvery: 12, serviced: '2026-01-31', interfaces: [] },
      { id: 'pc1', type: 'pc', name: 'Reception PC', x: 200, y: 300, inService: '2021-03-15', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'pc2', type: 'pc', name: 'Lab PC', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] }
    ],
    links: [] });
  const open = (doc) => { replaceDocument(doc || lab(), { origin: 'file' }); };
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));
  const field = (key) => NODE_FIELDS.find((f) => f.key === key);

  try {
    // ---- 1: the model ----
    ok('the document is version 14', DOC_VERSION === 14);
    const read = (text) => field('inService').fromText(text);
    ok('a year, a month or a day is a date', read('2019') === '2019' && read('2019-3') === '2019-03' && read('03/2019') === '2019-03'
       && read('2019-03-15') === '2019-03-15' && read('03/15/2019') === '2019-03-15', show([read('2019'), read('2019-3'), read('03/2019'), read('03/15/2019')]));
    // Slashed days are month first in English and day first otherwise, as
    // a custom date column reads them (customDate).
    setLocale('es');
    ok('day first in the other languages', read('15/03/2019') === '2019-03-15' && read('03/15/2019') === null);
    setLocale('en');
    ok('what is not a date is refused, not rolled over', read('02/31/2019') === null && read('2019-13') === null && read('13/2019') === null
       && read('soon') === null && read('1800') === null && read('') === null);
    const months = (text) => field('serviceEvery').fromText(text);
    ok('the interval is months, or years said as years', months('12') === 12 && months('6 months') === 6 && months('1 year') === 12
       && months('2 años') === 24 && months('3 мес') === 3 && months('6か月') === 6, show([months('12'), months('1 year'), months('2 años'), months('6か月')]));
    ok('an interval that is not one is refused', months('0') === null && months('241') === null && months('12 weeks') === null && months('1.5') === null && months('x') === null);
    ok('the readers keep only what they write', asLooseDate('2019-02-30') === undefined && asLooseDate('2019-00') === undefined && asLooseDate(2019) === undefined
       && asLooseDate(' 2019-03 ') === '2019-03' && asServiceMonths('12') === undefined && asServiceMonths(12.5) === undefined && asServiceMonths(12) === 12);

    // ---- 2: the arithmetic ----
    const age = (inService, today) => deviceAge({ inService }, today);
    ok('a month counts once its day is reached', age('2021-03-15', '2026-05-14').months === 61 && age('2021-03-15', '2026-05-15').months === 62,
       show([age('2021-03-15', '2026-05-14'), age('2021-03-15', '2026-05-15')]));
    ok('a year alone counts from mid-year and reads "about"', age('2019', '2026-10-31').months === 87 && age('2019', '2026-10-31').approx
       && ageText(age('2019', '2026-10-31')) === 'about 7 y', ageText(age('2019', '2026-10-31')));
    ok('the age reads as years and months', ageText({ months: 74 }) === '6 y 2 m' && ageText({ months: 72 }) === '6 y' && ageText({ months: 5 }) === '5 m'
       && ageText({ months: 0 }) === 'under a month' && ageText({ months: 4, approx: true }) === 'under a year' && ageText(null) === '');
    ok('a start after today, or none, is no age', age('2027-01-01', '2026-10-31') === null && deviceAge({}, '2026-10-31') === null && deviceAge(null) === null);
    ok('the next service is the interval after the last one', nextServiceDate({ serviced: '2026-05-14', serviceEvery: 12 }) === '2027-05-14'
       && nextServiceDate({ serviced: '2026-11-02', serviceEvery: 3 }) === '2027-02-02');
    ok('or after going into service, when it never was', nextServiceDate({ inService: '2021-03-15', serviceEvery: 6 }) === '2021-09-15'
       && nextServiceDate({ inService: '2021-03', serviceEvery: 6 }) === '2021-09-01');
    ok('the 31st becomes the month\'s last day', nextServiceDate({ serviced: '2026-01-31', serviceEvery: 1 }) === '2026-02-28'
       && nextServiceDate({ serviced: '2027-12-31', serviceEvery: 2 }) === '2028-02-29');
    ok('no interval, or nothing to count from, is no date', nextServiceDate({ serviced: '2026-01-01' }) === null && nextServiceDate({ serviceEvery: 12 }) === null);
    ok('today is the local date', todayISO(new Date(2026, 9, 31, 23, 30)) === '2026-10-31');

    // ---- 3: the document ----
    open();
    const doc = saved();
    const sw = doc.nodes.find((n) => n.id === 'sw'), pc2 = doc.nodes.find((n) => n.id === 'pc2');
    ok('a device keeps its dates and interval', sw.inService === '2019' && sw.serviced === '2026-01-31' && sw.serviceEvery === 12, show(sw));
    ok('a device that never had them carries no key for them', !['inService', 'serviced', 'serviceEvery'].some((k) => k in pc2), Object.keys(pc2).join(','));
    open({ v: DOC_VERSION, nodes: [{ id: 'a', type: 'pc', name: 'A', x: 0, y: 0, inService: '15/03/2019', serviced: 'yesterday', serviceEvery: '12', interfaces: [] }], links: [] });
    ok('a hand-edited file\'s values that are not ours are dropped', !['inService', 'serviced', 'serviceEvery'].some((k) => k in saved().nodes[0]), show(saved().nodes[0]));
    const v13 = lab(); v13.v = 13;
    const m = migrateDoc(v13);
    ok('a v13 document opens as v14, its devices as they were', m.doc.v === 14 && !m.newer && m.from === 13);
    open(v13);
    ok('and its fields stay', getNode('sw').serviceEvery === 12 && !state.readOnly && saved().v === 14);

    // ---- 4: the side panel ----
    open();
    select('pc1', 'node');
    ok('the panel shows the device\'s fields', el('propInService').value === '2021-03-15' && el('propServiced').value === '' && el('propServiceEvery').value === '');
    ok('and its age under them', /^Age \d+ y/.test(el('upkeepNote').textContent) && !el('upkeepNote').classList.contains('hidden'), el('upkeepNote').textContent);
    initHistory();
    typeInto(el('propServiceEvery'), '6 months');
    typeInto(el('propServiced'), '05/14/2026');
    commitTyping();
    ok('typing sets them, read as written in the file', getNode('pc1').serviceEvery === 6 && getNode('pc1').serviced === '2026-05-14', show(getNode('pc1')));
    ok('as one undo step each', steps() === 2, String(steps()));
    ok('and the line says the next service', /Next service 2026-11-14/.test(el('upkeepNote').textContent), el('upkeepNote').textContent);
    typeInto(el('propServiced'), '02/31/2026');
    ok('what cannot be read is marked and not stored', el('propServiced').classList.contains('bad') && getNode('pc1').serviced === '2026-05-14');
    el('propServiced').dispatchEvent(new Event('change'));
    ok('leaving the field shows what is kept', el('propServiced').value === '2026-05-14' && !el('propServiced').classList.contains('bad'));
    // The calendar: the browser's picker on a hidden date input; what is
    // picked lands in the field as if typed.
    const pick = el('propServiced').parentElement;
    ok('each date field has a calendar button', !!pick.querySelector('.date-pick-btn') && !!el('propInService').parentElement.querySelector('.date-pick-native'));
    ok('it opens on the field\'s date, a month or a year on its first day', pickerStart('2026-05-14') === '2026-05-14' && pickerStart('2019-03') === '2019-03-01'
       && pickerStart('2019') === '2019-01-01' && pickerStart('soon') === '');
    const native = pick.querySelector('.date-pick-native');
    const before = steps();
    native.value = '2026-10-30';
    native.dispatchEvent(new Event('change'));
    ok('a picked day is stored and shown, as one undo step', getNode('pc1').serviced === '2026-10-30' && el('propServiced').value === '2026-10-30' && steps() === before + 1,
       `${getNode('pc1').serviced} ${steps()}`);
    typeInto(el('propInService'), '');
    commitTyping();
    ok('emptying a field removes the key', !('inService' in getNode('pc1')) && !('inService' in saved().nodes.find((n) => n.id === 'pc1')));
    select('pc2', 'node');
    ok('a device with none shows none, and no line', el('propInService').value === '' && el('upkeepNote').classList.contains('hidden'));
    select(null, null);

    // ---- 5: the table ----
    open();
    const cols = tvCols('devices');
    const col = (key) => cols.find((c) => c.key === key);
    ok('the Devices table has the columns', ['inService', 'serviced', 'serviceEvery', 'age', 'nextService'].every((k) => !!col(k)), cols.map((c) => c.key).join(','));
    commitValue({ key: 'n:pc2', rec: 'node', ref: { nodeId: 'pc2' } }, col('inService'), '2018-06');
    ok('a cell is typed into, read as the field reads it', getNode('pc2').inService === '2018-06', show(getNode('pc2')));
    const row = (id) => ({ key: `n:${id}`, rec: 'node', ref: { nodeId: id }, data: {} });
    ok('a cell shows the stored value and the worked-out ones', col('serviceEvery').show(row('sw')).text === '12' && col('nextService').show(row('sw')).text === '2027-01-31'
       && /y/.test(col('age').show(row('pc2')).text));
    // 2018-06 is older than 2021-03-15 and than mid-2019, and "8 y 4 m"
    // before "about 7 y" is not the order of the text.
    getNode('pc1').inService = '2025-01-10';
    const order = [row('sw'), row('pc1'), row('pc2')].sort((a, b) => compareRows(col('age'), a, b)).map((r) => r.ref.nodeId).join(',');
    ok('Age sorts by months, not by its text', order === 'pc1,sw,pc2', order);

    // ---- 6: the spreadsheet and the bulk panel ----
    open();
    const sheet = csvDevicesSheet();
    ok('devices.csv carries the three fields', ['in_service', 'last_serviced', 'service_every_months'].every((h) => sheet.headers.includes(h)), sheet.headers.join(','));
    const back = csvSheet(csvParse(csvText(sheet)), true);
    const plan = csvPlan(back, csvAutoMap(back));
    ok('and reads back unchanged', plan.counts.change === 0 && plan.counts.add === 0 && !plan.errors.length, show(plan.counts));
    const client = csvSheet(csvParse('Name,Purchase date,Last maintenance,Maintenance interval\nLab PC,03/2020,09/01/2026,1 year\nReception PC,soon,,\n'), true);
    const cmap = csvAutoMap(client);
    ok('a client\'s headings find the fields', cmap.join(',') === 'name,inService,serviced,serviceEvery', cmap.join(','));
    const cplan = csvPlan(client, cmap);
    ok('their values are read as the panel reads them, a bad one is a conflict', cplan.rows[0].status === 'change' && cplan.rows[1].status === 'conflict', show(cplan.rows.map((r) => r.status + ' ' + r.why)));
    applyCsvPlan(cplan);
    ok('applied, the device holds them', getNode('pc2').inService === '2020-03' && getNode('pc2').serviced === '2026-09-01' && getNode('pc2').serviceEvery === 12, show(getNode('pc2')));
    const withOwn = lab(); withOwn.columns = [{ id: 'c1', name: 'Purchase date', kind: 'date' }];
    open(withOwn);
    const own = csvAutoMap(csvSheet(csvParse('Name,Purchase date\nLab PC,2020-03-01\n'), true));
    ok('a network\'s own column of that name still wins', own.join(',') === 'name,x:c1', own.join(','));
    ok('and no new column can take a name Topo has now', !!customNameProblem('Install date'));
    open();
    selectEntries([{ type: 'node', id: 'pc1' }, { type: 'node', id: 'pc2' }]);
    ok('the bulk panel offers the three fields', !!el('bulkF-inService') && !!el('bulkF-serviced') && !!el('bulkF-serviceEvery'));
    const setPlan = bulkPlanSet(['pc1', 'pc2'], { serviced: { text: '10/30/2026' }, serviceEvery: { text: '2 years' } });
    ok('a set takes a date and an interval in one go', setPlan.counts.change === 2 && !setPlan.errors.length, show(setPlan));
    bulkWrite(setPlan, state);
    ok('written as the file writes them', getNode('pc1').serviced === '2026-10-30' && getNode('pc2').serviceEvery === 24 && saved().nodes.find((n) => n.id === 'pc2').serviceEvery === 24);
    ok('a date that is not one is refused for all', bulkPlanSet(['pc1', 'pc2'], { serviced: { text: 'last week' } }).errors.length === 1);
    bulkWrite(bulkPlanSet(['pc1', 'pc2'], { serviceEvery: { clear: true } }), state);
    ok('clearing it drops the key from the file', !saved().nodes.some((n) => 'serviceEvery' in n && n.id !== 'sw'), show(saved().nodes.map((n) => n.serviceEvery)));
    select(null, null);

    // ---- 7: the report ----
    open();
    state.report = Object.assign({}, state.report, { date: '2026-10-31' });
    const dev = reportDevices().find((d) => d.id === 'sw');
    ok('the inventory says it, as of the report\'s date', dev.upkeep === 'In service since 2019 (about 7 y) · Last serviced 2026-01-31 · Next service 2027-01-31', dev.upkeep);
    state.report = Object.assign({}, state.report, { date: '2030-10-31' });
    ok('a report dated later is older by as much', /about 11 y/.test(reportDevices().find((d) => d.id === 'sw').upkeep));
    ok('a device with none has no line', reportDevices().find((d) => d.id === 'pc2').upkeep === '');

    // ---- 7b: the alerts (js/diagnostics.js upkeepFindings) ----
    // Dates relative to today, so the suite means the same any day it runs.
    const day = (n) => todayISO(new Date(Date.now() + n * 86400000));
    ok('a type has its usual life, a device may say its own, a VM none', expectedLifeOf({ type: 'pc' }) === 5 && expectedLifeOf({ type: 'switch' }) === 8
       && expectedLifeOf({ type: 'pc', lifeYears: 9 }) === 9 && expectedLifeOf({ type: 'vm' }) === null && expectedLifeOf({ type: 'pc', lifeYears: '9' }) === 5);
    ok('the expected life is typed in years', lifeYearsFromText('7') === 7 && lifeYearsFromText('7 years') === 7 && lifeYearsFromText('7 años') === 7
       && lifeYearsFromText('0') === null && lifeYearsFromText('7 months') === null && lifeYearsFromText('51') === null);
    const st = (n) => upkeepState(Object.assign({ id: 'z', type: 'pc', name: 'Z' }, n));
    ok('in service past its expected life is old', !!st({ inService: day(-6 * 366) }).old && st({ inService: day(-6 * 366) }).old.life === 5
       && !st({ inService: day(-4 * 366) }).old && !!st({ inService: day(-4 * 366), lifeYears: 3 }).old);
    ok('a retired or planned device is neither old nor due', !st({ inService: day(-9 * 366), status: 'retired', serviced: day(-800), serviceEvery: 12 }).old
       && !st({ inService: day(-9 * 366), status: 'planned', serviced: day(-800), serviceEvery: 12 }).service);
    ok('a service past due is overdue, missed twice over is critical', st({ serviced: day(-400), serviceEvery: 12 }).service.level === 'warn'
       && st({ serviced: day(-760), serviceEvery: 12 }).service.level === 'bad' && st({ serviced: day(-400), serviceEvery: 12 }).service.days < 0);
    ok('due within a month is a note, later is nothing', st({ serviced: day(-350), serviceEvery: 12 }).service.level === 'info'
       && st({ serviced: day(-30), serviceEvery: 12 }).service.level === null && st({ serviced: day(-30) }).service === null);
    open({ v: DOC_VERSION, nodes: [
      { id: 'old', type: 'switch', name: 'Old Switch', x: 0, y: 0, inService: day(-9 * 366), interfaces: [] },
      { id: 'late', type: 'server', name: 'Late Server', x: 0, y: 0, serviced: day(-400), serviceEvery: 12, interfaces: [] },
      { id: 'lost', type: 'server', name: 'Lost Server', x: 0, y: 0, serviced: day(-800), serviceEvery: 12, interfaces: [] },
      { id: 'soon', type: 'printer', name: 'Soon Printer', x: 0, y: 0, serviced: day(-170), serviceEvery: 6, interfaces: [] },
      { id: 'fine', type: 'pc', name: 'Fine PC', x: 0, y: 0, inService: day(-400), serviced: day(-10), serviceEvery: 12, interfaces: [] }
    ], links: [] });
    const fs = () => topologyFindings().filter((f) => ['age', 'service', 'service-due'].includes(f.key));
    const of = (id) => fs().filter((f) => f.nodeIds.includes(id)).map((f) => `${f.key}:${f.level}`).join(',');
    ok('each device gets the finding it should', of('old') === 'age:warn' && of('late') === 'service:warn' && of('lost') === 'service:bad'
       && of('soon') === 'service-due:info' && of('fine') === '', show(fs().map((f) => f.subject + ' ' + f.key + ':' + f.level)));
    ok('the sentence says when, and what to do', /^In service for (about )?9 y/.test(fs().find((f) => f.key === 'age').detail)
       && /Plan its replacement/.test(fs().find((f) => f.key === 'age').detail)
       && new RegExp('^Was due for service on ' + nextServiceDate(getNode('late'))).test(fs().find((f) => f.nodeIds[0] === 'late').detail),
       show(fs().map((f) => f.detail)));
    ok('due soon is listed, not counted', !isCountedFinding(fs().find((f) => f.key === 'service-due')) && isCountedFinding(fs().find((f) => f.key === 'service')));
    ok('the report lists the open ones', reportModel().findings.some((f) => f.key === 'age') && !reportModel().findings.some((f) => f.key === 'service-due'));
    // Accepting a service covers that date only: the next is a finding again.
    acceptFindings(fs().filter((f) => f.nodeIds[0] === 'late'), 'The vendor comes on Monday');
    ok('an overdue service can be accepted, with its reason', fs().find((f) => f.nodeIds[0] === 'late').accepted.reason === 'The vendor comes on Monday');
    getNode('late').serviced = day(-370); save();
    ok('recorded, its next date is another service, and not accepted', !!fs().find((f) => f.nodeIds[0] === 'late' && !f.accepted), show(fs().filter((f) => f.nodeIds[0] === 'late')));
    // The table and the panel say it too.
    const tcols = tvCols('devices'), tcol = (k) => tcols.find((c) => c.key === k);
    const trow = (id) => ({ key: `n:${id}`, rec: 'node', ref: { nodeId: id }, data: {} });
    ok('the table colours an overdue date and an old age', tcol('nextService').show(trow('lost')).sev === 'bad' && tcol('nextService').show(trow('late')).sev === 'warn'
       && !tcol('nextService').show(trow('fine')).sev && tcol('age').show(trow('old')).sev === 'warn');
    ok('the expected life shows its type\'s, greyed, when it has none', tcol('lifeYears').show(trow('old')).text === '8' && tcol('lifeYears').show(trow('old')).muted);
    select('lost', 'node');
    ok('the panel says it is overdue, in red', /overdue/.test(el('upkeepNote').textContent) && el('upkeepNote').classList.contains('upkeep-bad'), el('upkeepNote').textContent);
    select('old', 'node');
    ok('and that it is past its expected life, with the usual one as the hint', /past its expected life/.test(el('upkeepNote').textContent)
       && el('upkeepNote').classList.contains('upkeep-warn') && el('propLifeYears').placeholder === '8');
    typeInto(el('propLifeYears'), '12 years');
    commitTyping();
    ok('an expected life of its own clears the finding', getNode('old').lifeYears === 12 && !fs().some((f) => f.key === 'age'));
    select(null, null);

    // ---- 7c: expected life by type, for this network (doc.expectedLife) ----
    open({ v: DOC_VERSION, nodes: [
      { id: 'p1', type: 'pc', name: 'PC One', x: 0, y: 0, inService: day(-4 * 366 - 20), interfaces: [] },
      { id: 'p2', type: 'pc', name: 'PC Two', x: 0, y: 0, inService: day(-4 * 366 - 20), lifeYears: 6, interfaces: [] },
      { id: 's1', type: 'switch', name: 'Switch', x: 0, y: 0, inService: day(-4 * 366 - 20), interfaces: [] }
    ], links: [] });
    initHistory();
    ok('with Topo\'s usual, a four-year-old PC is not old', !fs().some((f) => f.key === 'age'));
    select('p1', 'node');
    el('lifeTypesBtn').click();
    const lifeIn = (type) => el(`lifeY-${type}`);
    ok('By type… opens the dialog: the network\'s types first, Topo\'s usual as the hint', !el('lifeDialog').hidden && !!lifeIn('pc')
       && el('lifeList').firstElementChild.contains(lifeIn('pc')) && lifeIn('pc').placeholder === '5' && lifeIn('pc').value === ''
       && /2 here/.test(el('lifeList').firstElementChild.textContent), el('lifeList').textContent.slice(0, 80));
    lifeIn('pc').value = '4'; lifeIn('pc').dispatchEvent(new Event('change', { bubbles: true }));
    ok('PCs last four years in this network: one undo step', show(state.expectedLife) === show({ pc: 4 }) && steps() === 1, show(state.expectedLife));
    ok('the PC that follows its type is old now; the one with its own life and the switch are not', of('p1') === 'age:warn' && of('p2') === '' && of('s1') === '',
       show(fs().map((f) => f.subject)));
    ok('the age sentence says the network\'s life', /expected to last 4 years/.test(fs().find((f) => f.key === 'age').detail));
    ok('the panel\'s hint and the table say it too', el('propLifeYears').placeholder === '4'
       && tvCols('devices').find((c) => c.key === 'lifeYears').show({ ref: { nodeId: 'p1' }, data: {} }).text === '4');
    ok('it travels with the file, and a damaged value is dropped', show(saved().expectedLife) === show({ pc: 4 })
       && show(normalizeExpectedLife({ pc: '4', switch: 0, vm: 3, router: 9, junk: 2 })) === show({ router: 9 }) && show(normalizeExpectedLife([4])) === '{}');
    lifeIn('switch').value = 'soon'; lifeIn('switch').dispatchEvent(new Event('change', { bubbles: true }));
    ok('what cannot be read is marked and not kept', lifeIn('switch').classList.contains('bad') && !('switch' in state.expectedLife));
    lifeIn('pc').value = '5'; lifeIn('pc').dispatchEvent(new Event('change', { bubbles: true }));
    ok('typing the usual back is no setting', !('expectedLife' in saved()) || saved().expectedLife === undefined);
    undo();
    ok('undo brings the setting back', show(state.expectedLife) === show({ pc: 4 }));
    el('lifeResetBtn').click();
    ok('Back to Topo\'s usual clears them all', show(state.expectedLife) === '{}' && !fs().some((f) => f.key === 'age'));
    closeLifeDialog();
    select(null, null);

    // ---- 8: words ----
    setLocale('es'); applyLocale();
    ok('the fields and the age are translated', t('In service since') === 'En servicio desde' && ageText({ months: 74 }) === '6 a 2 m'
       && t('Next service {date}', { date: 'x' }) === 'Próximo mantenimiento x');
    setLocale('ja'); applyLocale();
    ok('and in Japanese', ageText({ months: 74 }) === '6年2か月' && ageText({ months: 90, approx: true }) === '約7年');
    setLocale('en'); applyLocale();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
