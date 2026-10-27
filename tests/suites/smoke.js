// Every template and every snippet, loaded and rendered. Guards against a change
// that quietly breaks one of the shipped diagrams: each must render, survive a
// trace from every node, and raise no interface-level complaint.
window.addEventListener('load', () => {
  const out = [];
  const ok = (name, cond, extra) => out.push(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`);

  Object.keys(templatesData).forEach((key) => {
    try {
      loadDocState(templatesData[key]); autoBindLinks();
      renderCanvasOnly();
      const alerts = topologyFindings();
      // Only the interface-level checks count here; a template's own gateway/IP
      // alerts are its business, and some are deliberate. Picked by check key,
      // not by wording: a gateway finding that happens to say "interface" is
      // not an interface complaint.
      const MINE = ['interfaces', 'multihoming', 'bond', 'ports', 'radio', 'loop', 'cabling'];
      const mine = alerts.filter((f) => MINE.includes(f.key)).map((f) => f.line);
      const badges = state.nodes.filter((n) => nodeSeverity(n)).map((n) => `${n.name}[${nodeSeverity(n)}]`);
      state.nodes.forEach((n) => calculateReachability(n.id)); // trace must not throw on bound links

      if (key === 'errors') {
        // Broken by design: here silence would be the bug.
        ok(`${key}: stays broken on purpose`, alerts.length >= 6 && badges.length === 2,
           `${alerts.length} alerts, ${badges.length} badges`);
        return;
      }
      ok(`${key}: no interface complaints`, mine.length === 0,
         `nodes=${state.nodes.length} links=${state.links.length}` + (mine.length ? ' | ' + mine[0].slice(0, 90) : ''));
      ok(`${key}: no node badged`, badges.length === 0, badges.join(',') || 'none');
    } catch (e) {
      ok(`${key}: loads`, false, `THREW ${e.message}`);
    }
  });

  Object.keys(SNIPPETS).forEach((key) => {
    try {
      state.nodes = []; state.links = [];
      insertBlock(builtinBlock(key));
      const badged = state.nodes.filter((n) => nodeSeverity(n)).map((n) => `${n.name}[${nodeSeverity(n)}]`);
      if (key === 'errors') {
        // The common-errors block is the one snippet that must badge — it is the demo.
        ok(`snippet ${key}: stays broken on purpose`, badged.length >= 2, badged.join(',') || 'none');
        return;
      }
      ok(`snippet ${key}: stamps clean`, badged.length === 0 && state.nodes.length > 0,
         `nodes=${state.nodes.length} badged=${badged.join(',') || 'none'}`);
    } catch (e) {
      ok(`snippet ${key}: stamps`, false, `THREW ${e.message}`);
    }
  });

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
