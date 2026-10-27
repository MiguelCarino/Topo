// What tests/suites/docpath.js asks of every shipped template, and
// tests/suites/register.js of its site: that the migration chain
// (migrateDoc, js/model.js) would change nothing about the document. Compared
// after normalizing both sides, so only what the migration itself did counts
// (a default filled in, or a key order, does not). A test's question, not the
// page's: it lived in js/model.js with no caller there.
window.docNeedsMigration = function docNeedsMigration(doc) {
  const asV1 = { ...doc, v: 1 };
  const norm = (d) => JSON.stringify({
    nodes: (d.nodes || []).map((n) => writeFields(NODE_FIELDS, readFields(NODE_FIELDS, n))),
    links: (d.links || []).map((l) => writeFields(LINK_FIELDS, readFields(LINK_FIELDS, l)))
  });
  return (doc.nodes || []).some((n) => n && 'ips' in n) || norm(asV1) !== norm(migrateDoc(asV1).doc);
};
