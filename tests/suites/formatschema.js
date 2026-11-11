// The published format (docs/FORMAT.md, schema/topo-v18.json,
// schema/topo-backup-v1.json; docs/SCOPE.md D120). A small validator (type,
// const, enum, required, properties, patternProperties, additionalProperties
// false or a schema, items, maxItems, minimum, maximum, pattern, $ref,
// anyOf; no dependency) checks against the full schema:
//   - every sample network and its simple view, as the file Topo writes;
//   - every built-in block;
//   - a version 1 document and a version 17 one, after migrating;
//   - the rich NetBox fixture, every NetBox fixture's import result, and
//     every other importer's (nmap, UniFi, Omada, MikroTik, Cisco,
//     Lansweeper, phpIPAM) with every part ticked;
//   - a document with a log, problem reports, notes, searches and findings
//     accepted and pinned (built here through the app's own writers);
//   - and that it refuses what is not one (an unknown key on a device, a
//     status that is not one, a VLAN out of range).
// The guard: every key of every *_FIELDS table, LOG_FIELDS and the report
// header is in the schema's matching $defs, so a new field fails here until
// the schema (and docs/FORMAT.md) says what it is. The backup schema
// parses and names its kind; docs/FORMAT.md is not served to the app.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  try {
    const schema = JSON.parse(await (await fetch(`schema/topo-v${DOC_VERSION}.json`)).text());
    const backupSchema = JSON.parse(await (await fetch('schema/topo-backup-v1.json')).text());
    const typeOk = (t, v) => (Array.isArray(t) ? t : [t]).some((x) => (x === 'integer' ? Number.isInteger(v) : x === 'array' ? Array.isArray(v)
      : x === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) : x === 'null' ? v === null : x === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === x));
    const mk = (root) => {
      const check = (s, v, path = '$') => {
        if (s === true || s === undefined) return [];
        if (s.$ref) return check(s.$ref.replace('#/$defs/', '').split('/').reduce((o, k) => o[k], root.$defs), v, path);
        if (s.anyOf) { const errs = s.anyOf.map((x) => check(x, v, path)); return errs.some((e) => !e.length) ? [] : [`${path}: none of anyOf (${errs.map((e) => e[0]).join(' / ')})`]; }
        if ('const' in s && v !== s.const) return [`${path}: not ${s.const}`];
        if (s.enum && !s.enum.includes(v)) return [`${path}: ${JSON.stringify(v)} not in ${s.enum.join('|')}`];
        if (s.type && !typeOk(s.type, v)) return [`${path}: ${JSON.stringify(v)} not ${s.type}`];
        const errs = [];
        if (typeof v === 'number') {
          if (s.minimum !== undefined && v < s.minimum) errs.push(`${path}: below ${s.minimum}`);
          if (s.maximum !== undefined && v > s.maximum) errs.push(`${path}: above ${s.maximum}`);
        }
        if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${path}: not /${s.pattern}/`);
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          (s.required || []).forEach((k) => { if (!(k in v)) errs.push(`${path}: no ${k}`); });
          Object.keys(v).forEach((k) => {
            if (v[k] === undefined) return;
            if (s.properties && k in s.properties) { errs.push(...check(s.properties[k], v[k], `${path}.${k}`)); return; }
            const pp = s.patternProperties && Object.keys(s.patternProperties).find((re) => new RegExp(re).test(k));
            if (pp) { errs.push(...check(s.patternProperties[pp], v[k], `${path}.${k}`)); return; }
            if (s.additionalProperties === false && (s.properties || s.patternProperties)) errs.push(`${path}: extra ${k}`);
            else if (s.additionalProperties && typeof s.additionalProperties === 'object') errs.push(...check(s.additionalProperties, v[k], `${path}.${k}`));
          });
        }
        if (Array.isArray(v)) {
          if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems}`);
          if (s.items) v.forEach((x, i) => errs.push(...check(s.items, x, `${path}[${i}]`)));
        }
        return errs;
      };
      return check;
    };
    const check = mk(schema);
    const docOk = (doc) => check(schema.$defs.document, doc);
    const fileOk = (doc) => { const f = withTopoSchema({ kind: 'nettopology', version: 1, name: 'X', doc }); return check(schema, f).concat(check(schema.$defs.networkFile, f)); };

    ok('the schema is final: not a draft, names docs/FORMAT.md', !/DRAFT/.test(schema.description) && /docs\/FORMAT\.md/.test(schema.description));
    const defs = ['node', 'iface', 'link', 'cable', 'network', 'group', 'wifi', 'provider', 'column', 'search', 'annotation', 'findingNote', 'logEntry'];
    ok('field-level definitions for every record', defs.every((d) => schema.$defs[d] && schema.$defs[d].properties), defs.filter((d) => !schema.$defs[d]).join());

    // ---- The guard ----
    const tables = [['node', NODE_FIELDS], ['iface', IFACE_FIELDS], ['link', LINK_FIELDS], ['cable', CABLE_FIELDS], ['network', NETWORK_FIELDS], ['group', GROUP_FIELDS],
      ['wifi', WIFI_FIELDS], ['provider', PROVIDER_FIELDS], ['search', SEARCH_FIELDS]];
    const missing = [];
    tables.forEach(([d, fields]) => fields.forEach((f) => { if (!(f.key in schema.$defs[d].properties)) missing.push(`${d}.${f.key}`); }));
    Object.keys(LOG_FIELDS).forEach((kind) => Object.keys(LOG_FIELDS[kind]).forEach((k) => { if (!(k in schema.$defs.logEntry.properties)) missing.push(`logEntry.${k}`); }));
    ok('every field of every table is in the schema', !missing.length, missing.join(', '));
    ok('so is every top-level key the writer can give', Object.keys(canonicalDoc(templatesData.showcase || templatesData.house)).every((k) => k in schema.$defs.document.properties)
      && ['v', 'id', 'updated', 'rev', 'base', 'prior', 'nodes', 'links', 'networks', 'groups', 'wifi', 'providers', 'accepted', 'pinned', 'expectedLife', 'annotations', 'report', 'columns', 'tableView', 'searches', 'incidents', 'log']
        .every((k) => k in schema.$defs.document.properties));

    // ---- The validator refuses ----
    const base = canonicalDoc(templatesData.house);
    const bad1 = clone(base); bad1.nodes[0].colour = 'red';
    const bad2 = clone(base); bad2.nodes[0].status = 'broken';
    const bad3 = clone(base); (bad3.networks = bad3.networks || [{ id: 'n', cidr: '10.0.0.0/24' }])[0].vlan = 5000;
    ok('it refuses an unknown key, a status that is not one, a VLAN out of range', docOk(bad1).length > 0 && docOk(bad2).length > 0 && docOk(bad3).length > 0);
    function clone(x) { return JSON.parse(JSON.stringify(x)); }

    // ---- Every sample ----
    const bad = [];
    Object.keys(templatesData).forEach((key) => { const e = fileOk(canonicalDoc(templatesData[key])); if (e.length) bad.push(`${key}: ${e.slice(0, 2).join('; ')}`); });
    ok(`every sample (${Object.keys(templatesData).length}, simple views included) satisfies it`, !bad.length && Object.keys(templatesData).some((k) => /_simple$/.test(k)), bad.slice(0, 3).join(' ## '));
    const blocks = Object.keys(BUILTIN_BLOCKS).map((k) => [k, docOk(canonicalDoc(BUILTIN_BLOCKS[k]))]).filter(([, e]) => e.length);
    ok(`every built-in block (${Object.keys(BUILTIN_BLOCKS).length}) satisfies it`, !blocks.length, blocks.slice(0, 2).map(([k, e]) => `${k}: ${e[0]}`).join(' ## '));
    const v1 = { nodes: [{ id: 'r', type: 'router', name: 'R', x: 0, y: 0, ips: ['192.168.1.1/24'] }, { id: 'a', type: 'ap', name: 'AP', x: 100, y: 0, ips: ['192.168.1.2/24'] }], links: [{ id: 'l', source: 'r', target: 'a' }] };
    const v17 = { v: 17, nodes: [{ id: 's', type: 'server', name: 'S', x: 0, y: 0, provider: 'pv1', interfaces: [] }], links: [], providers: [{ id: 'pv1', name: 'IT', service: 'it' }] };
    ok('a version 1 and a version 17 document, migrated, satisfy it', !docOk(canonicalDoc(v1)).length && !docOk(canonicalDoc(v17)).length, docOk(canonicalDoc(v1)).concat(docOk(canonicalDoc(v17))).slice(0, 2).join('; '));

    // ---- A document using every list ----
    {
      replaceDocument(templatesData.house, { origin: 'file' });
      const n0 = state.nodes[0];
      state.annotations = [{ id: 'a1', x: 10, y: 10, text: 'Closet', style: 'note', targets: [n0.id] }];
      state.searches = normalizeSearches([{ name: 'Printers', query: 'type:printer', print: true }]);
      const doc = serializeDoc();
      doc.accepted = [{ check: 'x', scope: '', nodeIds: [n0.id], reason: 'Known', until: '2027-01-01' }];
      doc.pinned = [{ check: 'y', nodeIds: [n0.id], note: 'Watch' }];
      doc.report = { site: 'Casa', client: 'Ana' };
      doc.expectedLife = { pc: 5 };
      const withLog = await appendLogEntry(doc, mergeLogEntry({ id: 'lg_abc123', at: Date.now(), source: 'f.json', by: 'Ana', counts: { added: 1, changed: 0, removed: 0 }, mode: 'two-way' }));
      const withLog2 = await appendLogEntry(withLog, mergeLogEntry({ id: 'lg_abc124', at: Date.now(), source: 'g.json', by: 'Ana', counts: { added: 0, changed: 1, removed: 0 }, mode: 'two-way' }));
      const e = fileOk(canonicalDoc(withLog2));
      ok('a document with notes, searches, findings, report, lives and a chained log satisfies it', !e.length && (canonicalDoc(withLog2).log || []).length === 2, e.slice(0, 3).join('; '));

      // A problem report through the app's writers: opened, sent, visited, closed.
      const prov = { id: 'pv_it', name: 'IT Soporte', service: 'it' };
      const withProv = Object.assign(clone(withLog2), { providers: (withLog2.providers || []).concat([prov]) });
      const at = Date.now();
      const visitId = 'lg_visit01';
      const full = normalizeIncident({ id: 'in' + 'abcdefghij', at, status: 'closed', symptom: 'internet', nodeIds: [n0.id], text: 'No internet at reception', reporter: { name: 'Ana', phone: '555 0100', email: 'ana@example.test' },
        routedTo: [prov.id], sentAt: at + 1, visits: [visitId], closedAt: at + 3, closedNote: 'Router replaced', reopened: 1 }, { nodes: withProv.nodes, groups: withProv.groups, providers: withProv.providers });
      const incKeys = Object.keys(schema.$defs.document.properties.incidents.items.properties);
      ok('every key normalizeIncident writes is in the schema', !!full && Object.keys(full).concat(Object.keys(full.reporter).map((k) => 'reporter.' + k)).every((k) => k.startsWith('reporter.') ? k.slice(9) in schema.$defs.document.properties.incidents.items.properties.reporter.properties : incKeys.includes(k)),
        full && Object.keys(full).filter((k) => !incKeys.includes(k)).join());
      withProv.incidents = [full];
      let d2 = await appendLogEntry(withProv, incidentLogEntry({ id: 'lg_inc001', at, incident: full, event: 'opened' }));
      d2 = await appendLogEntry(d2, incidentLogEntry({ id: 'lg_inc002', at: at + 1, incident: full, event: 'sent', routedTo: [prov.id] }));
      d2 = await appendLogEntry(d2, visitLogEntry({ id: visitId, at: at + 2, incidentId: full.id, providerId: prov.id, provider: prov.name, by: 'Luis', arrived: at + 2, left: at + 2,
        outcome: 'fixed', notes: 'Swapped the router', changes: { counts: { added: 1, changed: 1, removed: 0 }, items: [{ kind: 'nodes', id: n0.id, name: n0.name, status: 'changed' }] } }));
      d2 = await appendLogEntry(d2, incidentLogEntry({ id: 'lg_inc003', at: at + 3, incident: full, event: 'closed' }));
      const c2 = canonicalDoc(d2);
      const e2 = fileOk(c2);
      ok('a problem report and its incident and visit log entries satisfy it', !e2.length && (c2.incidents || []).length === 1 && (c2.log || []).filter((x) => x.kind === 'incident').length === 3
        && (c2.log || []).some((x) => x.kind === 'visit'), e2.slice(0, 3).join('; ') + ' ' + JSON.stringify((c2.log || []).map((x) => x.kind)));
      const badInc = clone(c2); badInc.incidents[0].colour = 'red';
      const badInc2 = clone(c2); badInc2.incidents[0].status = 'lost';
      const badInc3 = clone(c2); badInc3.incidents[0].reporter.fax = '1';
      ok('it refuses an unknown key on a report, a status that is not one, an unknown reporter field', docOk(badInc).length > 0 && docOk(badInc2).length > 0 && docOk(badInc3).length > 0);
    }

    // ---- Imported documents ----
    const rich = JSON.parse(await (await fetch('tests/fixtures/import/netbox-rich.json')).text()).doc;
    ok('the rich NetBox fixture satisfies it', !fileOk(canonicalDoc(rich)).length, fileOk(canonicalDoc(rich)).slice(0, 3).join('; '));
    const sets = { 'csv-verbose': ['devices.csv', 'interfaces.csv', 'cables.csv', 'ip-addresses.csv', 'prefixes.csv', 'vlans.csv', 'locations.csv', 'racks.csv'],
      'csv-fields': ['devices.csv', 'interfaces.csv', 'mac-addresses.csv', 'virtual-machines.csv', 'vm-interfaces.csv', 'wireless-lans.csv', 'ip-addresses.csv'],
      api: ['devices.json', 'interfaces.json', 'mac-addresses.json', 'cables.json', 'ip-addresses.json', 'prefixes.json', 'vlans.json', 'locations.json', 'wireless-lans.json'] };
    for (const dir of Object.keys(sets)) {
      const files = await Promise.all(sets[dir].map(async (n) => { const text = await (await fetch(`tests/fixtures/import/netbox/${dir}/${n}`)).text(); return { name: n, text, bytes: new TextEncoder().encode(text) }; }));
      const res = TopoImporters.parse('netbox', files);
      const canon = fileOk(canonicalDoc(TopoImporters.withoutTransientIds(res.doc)));
      ok(`the NetBox ${dir} import satisfies it as it is kept`, !canon.length, canon.slice(0, 3).join('; '));
    }
    // The other importers (stage 6), everything ticked, as each would be kept.
    const others = { nmap: ['nmap-basic.xml', 'nmap-os.xml'], unifi: ['unifi/device.json', 'unifi/sta.json', 'unifi/networkconf.json', 'unifi/wlanconf.json', 'unifi-clients.csv'],
      omada: ['omada/devices.json', 'omada/clients.json', 'omada/networks.json', 'omada-clients.csv'], mikrotik: ['mikrotik-hex.rsc', 'mikrotik-crs-vlans.rsc', 'mikrotik-hapax-v7.rsc'],
      cisco: ['cisco-cdp.txt', 'cisco-mac-ios.txt', 'cisco-mac-nxos.txt'], lansweeper: ['lansweeper.csv'], phpipam: ['phpipam-subnets.csv', 'phpipam-addresses.csv', 'phpipam-api.json'] };
    for (const id of Object.keys(others)) {
      const files = await Promise.all(others[id].map(async (n) => { const text = await (await fetch(`tests/fixtures/import/${n}`)).text(); return { name: n.split('/').pop(), text, bytes: new TextEncoder().encode(text) }; }));
      const res = TopoImporters.parse(id, files);
      res.parts.forEach((p) => { p.on = true; });
      TopoImporters.applyParts(res);
      const canon = fileOk(canonicalDoc(TopoImporters.withoutTransientIds(res.doc)));
      ok(`the ${id} import satisfies it as it is kept`, !canon.length && res.doc.nodes.length > 0, canon.slice(0, 3).join('; '));
    }
    const nb = TopoNetbox.buildNetboxSet(rich, { version: '4.2', siteName: 'S' });
    const back = TopoImporters.parse('netbox', nb.files.filter((f) => f.name !== 'README.txt').map((f) => ({ name: f.name, text: f.text, bytes: new TextEncoder().encode(f.text) })));
    ok('and what comes back from Topo\'s own NetBox export', !docOk(back.doc).length, docOk(back.doc).slice(0, 3).join('; '));

    // ---- The backup schema ----
    ok('the backup schema: kind topo-backup, version 1, the revision and its owners', backupSchema.properties.kind.const === 'topo-backup' && backupSchema.properties.v.const === 1
      && backupSchema.required.includes('rev') && backupSchema.required.includes('owners') && /docs\/FORMAT\.md/.test(backupSchema.description));
    const fakeBackup = { kind: 'topo-backup', v: 1, site: 's1', made: '2026-11-10T02:30:00Z', originHash: 'ab', name: null, rev: { n: 3, ctHash: 'x', iv: 'y', ct: 'z' }, rosters: [], pubs: {}, owners: [{ u: 'u1', wrap: null, escrow: null }] };
    ok('a backup file\'s outline satisfies it', !mk(backupSchema)(backupSchema, fakeBackup).length && isBackupFile(fakeBackup));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
