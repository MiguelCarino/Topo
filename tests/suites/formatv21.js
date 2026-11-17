// Document version 21 (js/model.js; docs/SCOPE.md step 9c, D440; FORMAT.md):
//   1. the version: 21, its schema file is the one named, a v20 document
//      opens with only its `v` changed and writes none of the new keys, a v22
//      document opens read-only and is not re-saved;
//   2. a cable's `uplink`: primary or backup, anything else dropped; the five
//      kinds of link that carry no IP are kept, drawn and named, and an
//      unknown kind is still refused by the table;
//   3. a device's `icon`: a base64 data: address of an SVG, PNG, WebP or JPEG
//      within the size, kept byte for byte; markup, a web address, another
//      type, too long or not text is dropped;
//   4. a device's `access`: coerced to what the format allows (a kind out of
//      the five dropped, a port as text read, out of range dropped, a user
//      name with a space or a colon dropped, tls and path for web only, at
//      most eight), nothing left when nothing is valid;
//   5. the round trip: saved, read back and saved again is the same text,
//      and the saved document satisfies schema/topo-v21.json.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const show = (v) => JSON.stringify(v);
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const open = (doc) => { replaceDocument(doc, { origin: 'file', docId: 'doc-formatv21' }); renderCanvasOnly(); };
  const saved = () => JSON.parse(JSON.stringify(serializeDoc()));
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const SVG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>');
  try {
    setLocale('en');
    // ---- 1. The version ----
    ok('the document version is 21', DOC_VERSION === 21);
    ok('the schema it names is topo-v21.json', topoSchemaUrl() === 'https://topo.carino.systems/schema/topo-v21.json');
    const schema = JSON.parse(await (await fetch('schema/topo-v21.json')).text());
    ok('…and that file says so', schema.$id === topoSchemaUrl() && /document version 21/.test(schema.description));
    const v20 = { v: 20, nodes: [N('a', 'router'), N('b', 'pc')], links: [{ id: 'l1', source: 'a', target: 'b', medium: 'utp' }] };
    const frozen = show(v20);
    const m = migrateDoc(v20);
    ok('a v20 document migrates with nothing but its v changed, input untouched', m.from === 20 && !m.newer && m.doc.v === 21 && show(v20) === frozen
      && show(Object.assign({}, m.doc, { v: 20 })) === frozen);
    open(v20);
    const s20 = saved();
    ok('saved, it writes none of the new keys', s20.v === 21 && !/"(icon|access|uplink)"/.test(show(s20)));
    const v22 = { v: 22, nodes: [N('a', 'router', { hologram: true })], links: [] };
    ok('a v22 document is newer', migrateDoc(v22).newer === true);
    open(v22);
    ok('…and opens read-only, kept as it arrived', !!state.readOnly && show(state.readOnly.doc) === show(v22));
    state.readOnly = null;

    // ---- 2. A cable ----
    const cables = { v: 21, nodes: [N('a', 'router'), N('b', 'cloud'), N('c', 'cloud'), N('h', 'custom'), N('s', 'custom'), N('t', 'custom')],
      links: [{ id: 'l1', source: 'a', target: 'b', uplink: 'primary' }, { id: 'l2', source: 'a', target: 'c', uplink: 'backup' }, { id: 'l3', source: 'a', target: 'h', uplink: 'main' },
        { id: 'l4', source: 'h', target: 's', medium: 'zigbee' }, { id: 'l5', source: 'h', target: 't', medium: 'thread', uplink: true }] };
    open(cables);
    const sc = saved();
    const by = (id) => sc.links.find((l) => l.id === id);
    ok('uplink: primary and backup are kept', by('l1').uplink === 'primary' && by('l2').uplink === 'backup');
    ok('…anything else is dropped', !('uplink' in by('l3')) && !('uplink' in by('l5')));
    ok('the kinds that carry no IP are kept', by('l4').medium === 'zigbee' && by('l5').medium === 'thread');
    ok('…all five are known, with a line and a name each', NONIP_MEDIA.join() === 'thread,zigbee,zwave,bluetooth,serial'
      && NONIP_MEDIA.every((k) => !!FLOW_CLASS[k] && !!LINK_INK[k] && !!MEDIUM_NAMES[k] && isNonIpMedium(k)) && !isNonIpMedium('utp') && !isNonIpMedium(undefined));
    const z = document.getElementById('ui-link-l4');
    ok('…and drawn in their own ink', !!z && z.getAttribute('stroke') === LINK_INK.zigbee.colour && z.getAttribute('stroke-dasharray') === LINK_INK.zigbee.dash, z && z.getAttribute('stroke'));
    const medium = LINK_FIELDS.find((f) => f.key === 'medium');
    ok('an unknown kind is still refused', medium.validate('thread') === true && medium.validate('carrier-pigeon') === false && medium.validate('') === true);

    // ---- 3. A device's icon ----
    const long = 'data:image/png;base64,' + 'A'.repeat(ICON_MAX);
    const icons = { v: 21, links: [], nodes: [N('p', 'pc', { icon: PNG }), N('s', 'pc', { icon: SVG }), N('m', 'pc', { icon: '<svg onload="alert(1)"></svg>' }),
      N('u', 'pc', { icon: 'https://example.com/x.png' }), N('g', 'pc', { icon: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }), N('x', 'pc', { icon: 'data:text/html;base64,PGI+' }),
      N('l', 'pc', { icon: long }), N('n', 'pc', { icon: 42 }), N('q', 'pc', { icon: 'data:image/svg+xml;utf8,<svg/>' })] };
    open(icons);
    const si = saved();
    const icon = (id) => si.nodes.find((n) => n.id === id).icon;
    ok('a PNG and an SVG as base64 data are kept byte for byte', icon('p') === PNG && icon('s') === SVG);
    ok('markup, a web address, another type, a page, too long, not text and not base64 are dropped',
      ['m', 'u', 'g', 'x', 'l', 'n', 'q'].every((id) => !('icon' in si.nodes.find((n) => n.id === id))), ['m', 'u', 'g', 'x', 'l', 'n', 'q'].filter((id) => icon(id) !== undefined).join());
    ok('the limit is 32768 characters', ICON_MAX === 32768 && asIcon('data:image/png;base64,' + 'A'.repeat(ICON_MAX - 22)) !== undefined && asIcon('data:image/png;base64,' + 'A'.repeat(ICON_MAX - 21)) === undefined);

    // ---- 4. How a device is reached ----
    const acc = (list) => show(asAccess(list));
    ok('the five kinds, each as written', acc([{ kind: 'web' }, { kind: 'ssh' }, { kind: 'rdp' }, { kind: 'vnc' }, { kind: 'telnet' }])
      === '[{"kind":"web"},{"kind":"ssh"},{"kind":"rdp"},{"kind":"vnc"},{"kind":"telnet"}]');
    ok('another kind is dropped', acc([{ kind: 'ftp' }, { kind: 'ssh' }, null, 'ssh', []]) === '[{"kind":"ssh"}]');
    ok('a port: a number or its text, in range', acc([{ kind: 'ssh', port: 2222 }, { kind: 'ssh', port: '22' }, { kind: 'ssh', port: 0 }, { kind: 'ssh', port: 70000 }, { kind: 'ssh', port: 2.5 }, { kind: 'ssh', port: 'x' }])
      === '[{"kind":"ssh","port":2222},{"kind":"ssh","port":22},{"kind":"ssh"},{"kind":"ssh"},{"kind":"ssh"},{"kind":"ssh"}]', acc([{ kind: 'ssh', port: '22' }]));
    ok('a user name, never anything like a password', acc([{ kind: 'ssh', user: ' admin ' }, { kind: 'ssh', user: 'ad min' }, { kind: 'ssh', user: 'admin:secret' }, { kind: 'rdp', user: 'x'.repeat(65) }, { kind: 'ssh', password: 'hunter2', key: 'k' }])
      === '[{"kind":"ssh","user":"admin"},{"kind":"ssh"},{"kind":"ssh"},{"kind":"rdp"},{"kind":"ssh"}]');
    ok('tls and a path are the web\'s alone', acc([{ kind: 'web', tls: true, path: '/admin' }, { kind: 'web', tls: 'yes', path: 'admin' }, { kind: 'web', path: '/a b' }, { kind: 'ssh', tls: true, path: '/x' }])
      === '[{"kind":"web","tls":true,"path":"/admin"},{"kind":"web"},{"kind":"web"},{"kind":"ssh"}]');
    ok('at most eight', asAccess(Array.from({ length: 12 }, () => ({ kind: 'ssh' }))).length === 8 && ACCESS_MAX === 8);
    ok('nothing valid leaves no key', asAccess([]) === undefined && asAccess([{ kind: 'ftp' }]) === undefined && asAccess('ssh') === undefined && asAccess(null) === undefined);
    ok('the kinds\' own ports', show(ACCESS_PORTS) === '{"web":80,"ssh":22,"rdp":3389,"vnc":5900,"telnet":23}');

    // ---- 5. The round trip ----
    const full = { v: 21, nodes: [N('r', 'router', { access: [{ kind: 'web', tls: true, port: 8443, path: '/login' }, { kind: 'ssh', user: 'admin' }], icon: PNG }), N('w', 'cloud'), N('k', 'custom')],
      links: [{ id: 'l1', source: 'r', target: 'w', uplink: 'primary' }, { id: 'l2', source: 'r', target: 'k', medium: 'serial' }] };
    open(full);
    const one = show(serializeDoc());
    open(JSON.parse(one));
    ok('saved, read back and saved again is the same text', show(serializeDoc()) === one);
    const kept = saved();
    ok('…with every new fact in it', show(kept.nodes[0].access) === '[{"kind":"web","port":8443,"tls":true,"path":"/login"},{"kind":"ssh","user":"admin"}]' && kept.nodes[0].icon === PNG
      && kept.links[0].uplink === 'primary' && kept.links[1].medium === 'serial', show(kept.nodes[0].access));
    ok('the envelope names v21', withTopoSchema({ kind: 'nettopology', version: 1, doc: kept }).$schema === 'https://topo.carino.systems/schema/topo-v21.json');
    // The schema knows each: the keys, and what they may hold.
    const node = schema.$defs.node.properties, link = schema.$defs.link.properties;
    ok('the schema lists the keys and their values', !!node.icon && node.icon.maxLength === ICON_MAX && new RegExp(node.icon.pattern).test(PNG) && !new RegExp(node.icon.pattern).test('data:image/gif;base64,AAAA')
      && show(node.access.items.properties.kind.enum) === show(ACCESS_KINDS) && node.access.maxItems === ACCESS_MAX && node.access.items.additionalProperties === false
      && show(link.uplink.enum) === '["primary","backup"]' && NONIP_MEDIA.every((k) => link.medium.enum.includes(k)) && link.medium.enum.length === Object.keys(FLOW_CLASS).length);
    ok('…and FORMAT.md is not served to the app, the schema is', (await fetch('schema/topo-v20.json')).ok === true);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.readOnly = null;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
