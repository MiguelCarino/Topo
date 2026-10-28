// What tests/suites/docpath.js asks of every shipped template, and
// tests/suites/register.js of its site: that the migration chain
// (migrateDoc, js/model.js) would change nothing about the document. Compared
// after normalizing both sides, so only what the migration itself did counts
// (a default filled in, or a key order, does not). A test's question, not the
// page's: it lived in js/model.js with no caller there.
//
// rackDepth is left out of the comparison: replaying the chain from v1 runs
// the v8 step, which drops every rackDepth because before v8 it meant the
// opposite ('full'); a template that ships today's 'half' would read as
// migrated when nothing about it is old (js/data.js puts it back the same
// way after its own migration).
window.docNeedsMigration = function docNeedsMigration(doc) {
  const asV1 = { ...doc, v: 1 };
  const noDepth = (n) => { const o = writeFields(NODE_FIELDS, readFields(NODE_FIELDS, n)); delete o.rackDepth; return o; };
  const norm = (d) => JSON.stringify({
    nodes: (d.nodes || []).map(noDepth),
    links: (d.links || []).map((l) => writeFields(LINK_FIELDS, readFields(LINK_FIELDS, l)))
  });
  return (doc.nodes || []).some((n) => n && 'ips' in n) || norm(asV1) !== norm(migrateDoc(asV1).doc);
};
