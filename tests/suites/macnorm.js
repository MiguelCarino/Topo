// The shared MAC readers (js/model.js '---- MAC addresses ----'): normMac,
// fmtColonSafe, macIsGroup / macIsLocal and macShaped, which replaced a copy
// of each in the sidebar, diagnostics, the report, the search box, CSV and the
// secrets check. What is held here:
//   1. the readers themselves, on every paste format and on nothing at all;
//   2. each former call site still answering as it did: duplicates and the
//      node check, the MAC conflict finding, the report's row, the table's
//      and CSV's parsers, the CSV column guess, the search box;
//   3. the two copies that had drifted, now one behaviour everywhere: a
//      password with twelve hex digits in it is a password, not a MAC; and a
//      macOS/BSD address with unpadded octets ('0:1b:2c:3d:4e:5f'), which the
//      Seen import always read, is read by the field check, CSV, the sidebar
//      and duplicate detection too.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  function reset(nodes, links) {
    state.nodes = nodes.map(normalizeLoadedNode);
    state.links = (links || []).map(normalizeLoadedLink);
    autoBindLinks();
  }
  const pc = (id, mac, extra) => Object.assign({ id, type: 'pc', name: id.toUpperCase(), x: 0, y: 0,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '', mac }] }, extra || {});

  try {
    // ---- 1: the readers ----
    const forms = ['3C:07:54:11:22:33', '3c-07-54-11-22-33', '3c07.5411.2233', '3C0754112233'];
    ok('normMac reads every paste format alike', forms.every((f) => normMac(f) === '3C0754112233'), forms.map(normMac).join(' '));
    ok('normMac of nothing is empty', normMac(undefined) === '' && normMac(null) === '' && normMac(0) === '');
    ok('an unpadded colon address is padded', normMac('0:1b:2c:3d:4e:5f') === '001B2C3D4E5F', normMac('0:1b:2c:3d:4e:5f'));
    ok('and an unpadded hyphen one', normMac('0-1b-2c-3d-4e-5f') === '001B2C3D4E5F', normMac('0-1b-2c-3d-4e-5f'));
    ok('mixed separators are not padded', normMac('0:1b-2c:3d:4e:5f').length === 11, normMac('0:1b-2c:3d:4e:5f'));
    ok('fmtColonSafe writes the colon form', fmtColonSafe('3c0754112233') === '3C:07:54:11:22:33', fmtColonSafe('3c0754112233'));
    ok('and leaves a non-address as typed', fmtColonSafe('zz') === 'zz' && fmtColonSafe('') === '' && fmtColonSafe(undefined) === '');
    ok('macIsGroup: multicast and broadcast', macIsGroup('01:00:5E:00:00:01') && macIsGroup('FF:FF:FF:FF:FF:FF'));
    ok('macIsGroup: not a unicast address, not nothing', !macIsGroup('3C:07:54:11:22:33') && !macIsGroup(''));
    ok('macIsLocal reads the U/L bit', macIsLocal('02:11:22:33:44:55') && !macIsLocal('3C:07:54:11:22:33') && !macIsLocal(''));
    ok('macShaped: the formats devices print',
       ['aa:bb:cc:dd:ee:ff', 'aabb.ccdd.eeff', 'AABBCCDDEEFF', 'aa-bb-cc-dd-ee-ff'].every(macShaped));
    ok('macShaped: not a word with twelve hex digits in it, not a long address',
       !macShaped('Fa2024-Bcde-Fa!x') && !macShaped('AA:BB:CC:DD:EE:FF:GG') && !macShaped('') && !macShaped(null));

    // ---- 2: the former call sites ----
    reset([pc('a', '01:00:5E:00:00:01'), pc('b', '01:00:5e:00:00:01'),
           pc('c', '3C:07:54:11:22:33'), pc('d', '3c-07-54-11-22-33')]);
    const dups = duplicateMacs(state.nodes);
    ok('duplicateMacs ignores a shared multicast address and reports a shared unicast one',
       dups.length === 1 && dups[0].hex === '3C0754112233' && dups[0].holders.length === 2, JSON.stringify(dups.map((d) => d.hex)));
    ok('evaluateMac: a group address is its own fault', evaluateMac(getNode('a')).code === 'group');
    const dupText = evaluateMac(getNode('c'));
    ok('evaluateMac: a duplicate names the address in colon form',
       dupText.code === 'duplicate' && dupText.text.includes('3C:07:54:11:22:33'), dupText.text.slice(0, 60));
    const conflict = topologyFindings().filter((f) => f.key === 'mac-conflict');
    ok('the MAC conflict finding says the address in colon form',
       conflict.length === 1 && conflict[0].detail.includes('3C:07:54:11:22:33') && conflict[0].scope === '3C0754112233',
       conflict.map((f) => f.detail).join(' | '));
    reset([pc('a', '02:11:22:33:44:55'), pc('b', '3C:07:54:11:22:33')]);
    ok('evaluateMac: a locally administered address is a warning', evaluateMac(getNode('a')).level === 'warn');
    ok('evaluateMac: a burned-in one names its vendor', /Apple/.test(evaluateMac(getNode('b')).text), evaluateMac(getNode('b')).text);

    const node = getNode('b');
    ok('reportInterface: the address in colon form, and its vendor',
       reportInterface(node, { id: 'x', name: 'eth0', mac: '3c-07-54-11-22-33' }).mac === '3C:07:54:11:22:33'
       && reportInterface(node, { id: 'x', name: 'eth0', mac: '3c-07-54-11-22-33' }).vendor === 'Apple');
    ok('reportInterface: no address shown for one that is not', reportInterface(node, { id: 'x', name: 'eth0', mac: 'zz' }).mac === '');

    const tableMac = tvCols('interfaces').find((c) => c.key === 'mac');
    ok('the table\'s MAC cell stores the colon form', tableMac.parse('3c-07-54-11-22-33').value === '3C:07:54:11:22:33',
       JSON.stringify(tableMac.parse('3c-07-54-11-22-33')));
    ok('CSV\'s if:mac stores the colon form', CSV_PARSERS['if:mac']('3c-07-54-11-22-33').value === '3C:07:54:11:22:33');
    ok('CSV\'s if:mac refuses a short address', !!CSV_PARSERS['if:mac']('3c-07-54').error);
    ok('csvGuessByValues: a column of MACs', csvGuessByValues(['aa:bb:cc:dd:ee:01', 'aabb.ccdd.ee02', 'AABBCCDDEE03']) === 'if:mac');
    ok('csvGuessByValues: a column of addresses', csvGuessByValues(['10.0.0.1', '10.0.0.2/24']) === 'if:ip');
    ok('csvGuessByValues: words are neither', csvGuessByValues(['Fa2024-Bcde-Fa', 'printer']) === '');

    reset([pc('a', 'AA:BB:CC:00:00:01'), pc('b', '3C:07:54:11:22:33'), pc('c', '')]);
    const matches = (text) => { const q = parseQuery(text); return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(','); };
    ok('search: a MAC fragment in any spelling', matches('aa-bb') === 'a' && matches('aa:bb:cc') === 'a', matches('aa-bb'));
    ok('search: mac: by hex', matches('mac:3c07') === 'b' && matches('mac:3C.07') === 'b', matches('mac:3c07'));
    ok('search: mac: by vendor still works', matches('mac:apple') === 'b', matches('mac:apple'));

    // ---- 3a: drift, the secrets check ----
    // looksLikeKey used to exempt any word with twelve hex digits in it, so a
    // generated password of hex-ish letters passed as a MAC.
    ok('a password with twelve hex digits in it is flagged', notesSecretHit('Fa2024-Bcde-Fa!x') === true);
    ok('nor is a mixed-case MAC that ends a sentence', notesSecretHit('new NIC 3c:07:54:AB:CD:EF.') === false && notesSecretHit('MAC 3c:07:54:AB:cd:ef:') === false);
    ok('a MAC is still not a password', !notesSecretHit('AA:BB:CC:DD:EE:FF') && !notesSecretHit('aabb.ccdd.eeff') && !notesSecretHit('mac 3c-07-54-11-22-33'));

    // ---- 3b: drift, unpadded octets ----
    ok('the field check accepts an unpadded address', fieldOk.mac('0:1b:2c:3d:4e:5f') === true);
    ok('and still refuses a short one', fieldOk.mac('0:1b:2c:3d:4e') === false);
    ok('CSV\'s if:mac pads it', CSV_PARSERS['if:mac']('0:1b:2c:3d:4e:5f').value === '00:1B:2C:3D:4E:5F',
       JSON.stringify(CSV_PARSERS['if:mac']('0:1b:2c:3d:4e:5f')));
    ok('the table pads it too', tableMac.parse('0:1b:2c:3d:4e:5f').value === '00:1B:2C:3D:4E:5F');
    ok('the Seen import and normMac agree', seenMac('0:1b:2c:3d:4e:5f').mac === normMac('0:1b:2c:3d:4e:5f'));

    replaceDocument({ v: DOC_VERSION, networks: [], links: [],
      nodes: [pc('pc1', '00:1b:2c:3d:4e:5f'), Object.assign(pc('pc2', ''), { x: 100 })] }, { origin: 'file' });
    initHistory();
    const sheetOf = (text) => { const p = csvParse(text); return csvSheet(p, csvHasHeadingRow(p.rows)); };
    const planOf = (text) => { const s = sheetOf(text); return csvPlan(s, csvAutoMap(s)); };
    let plan = planOf('mac,os\n0:1b:2c:3d:4e:5f,macOS');
    ok('a CSV row keyed on an unpadded address finds the device holding it',
       plan.rows[0].nodeId === 'pc1' && plan.rows[0].status === 'change', JSON.stringify({ id: plan.rows[0].nodeId, s: plan.rows[0].status, why: plan.rows[0].why }));
    plan = planOf('device_id,interface_id,mac\npc2,i1,0:1b:2c:3d:4e:5f');
    applyCsvPlan(plan);
    ok('CSV import stores it padded', getNode('pc2').interfaces[0].mac === '00:1B:2C:3D:4E:5F', JSON.stringify(getNode('pc2').interfaces[0]));
    const d2 = duplicateMacs(state.nodes);
    ok('and it is a duplicate of the other device\'s lower-case spelling',
       d2.length === 1 && d2[0].holders.map((h) => h.node.id).sort().join(',') === 'pc1,pc2', JSON.stringify(d2.map((d) => d.hex)));

    reset([pc('a', '0:1b:2c:3d:4e:5f'), pc('b', '00:1B:2C:3D:4E:5F')]);
    ok('report reads an unpadded address', reportInterface(getNode('a'), getNode('a').interfaces[0]).mac === '00:1B:2C:3D:4E:5F');
    ok('evaluateMac sees the duplicate', evaluateMac(getNode('a')).code === 'duplicate');
    ok('search mac: finds both spellings', matches('mac:0:1b:2c:3d:4e:5f') === 'a,b', matches('mac:0:1b:2c:3d:4e:5f'));
    ok('and the padded form finds the unpadded one', matches('mac:001b2c3d4e5f') === 'a,b', matches('mac:001b2c3d4e5f'));
    reset([pc('a', '3c:7:54:11:22:33')]);
    ok('a prefix typed unpadded still finds it', matches('mac:3c:7:54') === 'a' && matches('3c:7:54') === 'a', matches('mac:3c:7:54') + '|' + matches('3c:7:54'));
    reset([pc('a', '0:1b:2c:3d:4e:5f'), pc('b', '00:1B:2C:3D:4E:5F')]);
    select('a', 'node');
    const macOut = document.querySelector('#ifaceListContainer .if-mac-out');
    ok('the sidebar does not call it invalid',
       !!macOut && !/Need exactly 12 hex digits/.test(macOut.textContent) && /Also on/.test(macOut.textContent), macOut ? macOut.textContent.slice(0, 80) : 'no MAC line');
    select(null, null);
  } catch (e) {
    ok('suite ran without throwing', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : String(e));
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
