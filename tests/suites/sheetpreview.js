// The sheets' print preview (js/sheetpreview.js): Print labels
// (printAssetLabels, js/assets.js) and Print where they are plugged in
// (printLocate, js/locate.js) show the sheet first, as the site report's
// dialog does. What is held:
//   1. labels: no tab and no download on the click; the dialog open below
//      the pinned navbar, titled as the sheet, its note, the file name and a
//      label count; the frame showing that sheet, one page per label, its
//      toolbar hidden; what is printed or saved is labelsHtml's page byte for
//      byte (the preview's paper never reaches it);
//   2. Print prints the frame (its own print(), stubbed) and the dialog stays;
//      nothing is downloaded;
//   3. Close, Esc and the backdrop each drop it, save nothing and give the
//      focus back to the button that opened it;
//   4. Download saves the same bytes under the old name (-labels-<date>.html)
//      and closes;
//   5. Locate: the sheet on an A4 page (its own print rules on screen, white
//      paper), a dashed line where each page ends and the count saying A4;
//      the sheet carries its @page margins; the marks hidden under print;
//   6. a stage narrower than a page shows the page scaled, never reflowed;
//   7. the new strings in es, pt-BR, ja and ru, Japanese never コンピューター.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const shown = () => !el('sheetPreviewDialog').classList.contains('hidden');
  const key = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const heldOpen = window.open;
  const realClick = HTMLAnchorElement.prototype.click;
  let opened = 0, downloads = [];
  window.open = () => { opened++; return null; };
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push(this.download); else realClick.call(this); };
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: [{ id: 'e1', name: 'eth0', ip: '' }] }, extra);
  setLocale('en');

  try {
    const pcs = [];
    for (let k = 1; k <= 60; k++) pcs.push(N(`pc${k}`, 'pc', { name: `PC-${k}`, assetTag: `CS-${1000 + k}` }));
    replaceDocument({ v: DOC_VERSION,
      nodes: [N('sw', 'switch', { name: 'SW', interfaces: [], portCount: 64 }), ...pcs],
      links: pcs.map((p, k) => ({ id: `l${k + 1}`, source: p.id, target: 'sw', sourceIface: 'e1', targetIface: `p${k + 1}`, cable: { label: `C-${k + 1}` } })) },
    { origin: 'file' });
    setView('map');

    // ---- 1. Labels: previewed, not handed over ----
    selectEntries([{ type: 'node', id: 'pc1' }, { type: 'link', id: 'l1' }]);
    // A button of the page's own, focused as the rail's would be.
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    const set = labelsFor([{ type: 'node', id: 'pc1' }, { type: 'link', id: 'l1' }]);
    const r = printAssetLabels([{ type: 'node', id: 'pc1' }, { type: 'link', id: 'l1' }]);
    ok('no tab and no download on the click', opened === 0 && downloads.length === 0, `${opened} / ${downloads.join()}`);
    ok('the preview opens', !!r && r.previewed === true && shown());
    await r.ready;
    const dlg = el('sheetPreviewDialog');
    const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 0;
    ok('below the pinned navbar (top: var(--nav-h))', Math.abs(dlg.getBoundingClientRect().top - navH) < 1, `${dlg.getBoundingClientRect().top} vs ${navH}`);
    ok('titled as the sheet, with its note', el('sheetPreviewTitle').textContent === 'Labels' && /62 × 29 mm/.test(el('sheetPreviewBlurb').textContent), el('sheetPreviewTitle').textContent);
    ok('the file name it saves under', el('sheetPreviewName').textContent === r.name && /-labels-\d{4}-\d{2}-\d{2}\.html$/.test(r.name), r.name);
    ok('a label count (a cable gets two)', el('sheetPreviewStatus').textContent === '3 labels', el('sheetPreviewStatus').textContent);
    const fdoc = el('sheetPreviewFrame').contentDocument;
    ok('the frame shows the sheet, a page per label', !!fdoc && fdoc.querySelectorAll('.lbl').length === 3 && fdoc.querySelectorAll('.lbl.cable').length === 2);
    ok('its own toolbar hidden (the dialog\'s buttons do its job)', !!fdoc && getComputedStyle(fdoc.querySelector('.toolbar')).display === 'none');
    ok('what is printed or saved is the sheet, byte for byte', r.html === labelsHtml(set) && sheetPreviewBuilt().html === r.html);
    ok('the preview\'s paper never reaches it', !/sp-break|@media screen/.test(r.html) && /@media print/.test(r.html));
    ok('Print and Download ready', !el('sheetPreviewPrint').disabled && !el('sheetPreviewDownload').disabled);

    // ---- 2. Print: the frame printed, the dialog stays ----
    {
      const win = el('sheetPreviewFrame').contentWindow;
      let printed = 0;
      win.print = () => { printed++; };
      el('sheetPreviewPrint').click();
      await new Promise((d) => setTimeout(d, 50));
      ok('Print prints the frame', printed === 1, String(printed));
      ok('the dialog stays and nothing is downloaded', shown() && downloads.length === 0);
    }

    // ---- 3. Close, Esc, the backdrop: dropped, nothing saved ----
    el('sheetPreviewClose').click();
    ok('Close drops it and saves nothing', !shown() && downloads.length === 0 && sheetPreviewBuilt() === null
      && !el('sheetPreviewFrame').hasAttribute('src') && !el('sheetPreviewFrame').hasAttribute('srcdoc'));
    ok('the focus goes back to the opener', document.activeElement === opener, document.activeElement && document.activeElement.id);
    printAssetLabels([{ type: 'node', id: 'pc1' }]);
    key('Escape');
    ok('Esc closes it', !shown() && downloads.length === 0);
    printAssetLabels([{ type: 'node', id: 'pc1' }]);
    dlg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('the backdrop closes it', !shown() && downloads.length === 0);
    printAssetLabels([{ type: 'node', id: 'pc1' }]);
    dlg.querySelector('.rpv').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok('a click on the card does not', shown());
    closeSheetPreview();

    // ---- 4. Download: the same bytes, the old name ----
    {
      const r2 = printAssetLabels([{ type: 'node', id: 'pc1' }]);
      await r2.ready;
      let saved = null;
      const heldSave = window.saveBlob;
      window.saveBlob = (blob, name) => { saved = { blob, name }; return heldSave(blob, name); };
      el('sheetPreviewDownload').click();
      window.saveBlob = heldSave;
      const text = saved ? await saved.blob.text() : '';
      ok('Download saves the sheet under its name and closes', !!saved && saved.name === r2.name && downloads.includes(r2.name) && !shown(), saved && saved.name);
      ok('the bytes are the sheet\'s', text === r2.html);
      downloads = [];
    }

    // ---- 5. Locate: A4 pages, marked ----
    {
      const entries = pcs.map((p) => ({ type: 'node', id: p.id }));
      const r3 = printLocate(entries);
      ok('Locate: previewed, nothing saved', !!r3 && r3.previewed === true && shown() && downloads.length === 0 && opened === 0);
      await r3.ready;
      ok('titled as the sheet', el('sheetPreviewTitle').textContent === 'Where they are plugged in');
      ok('saved as -locate-<date>.html', /-locate-\d{4}-\d{2}-\d{2}\.html$/.test(el('sheetPreviewName').textContent));
      const d = el('sheetPreviewFrame').contentDocument;
      const m = /^(\d+) pages \(A4\)$/.exec(el('sheetPreviewStatus').textContent);
      const pages = m ? Number(m[1]) : 0;
      ok('60 devices: several A4 pages, counted', pages > 1, el('sheetPreviewStatus').textContent);
      ok('a dashed line where each page ends', !!d && d.querySelectorAll('.sp-break').length === pages - 1 && d.querySelector('.sp-break span').textContent === 'Page 2');
      ok('on white paper, a page wide (its print rules on screen)', !!d && getComputedStyle(d.body).backgroundColor === 'rgb(255, 255, 255)'
        && Math.abs(d.body.getBoundingClientRect().width - 210 * 96 / 25.4) < 2, d && d.body.getBoundingClientRect().width);
      ok('no page line inside a device\'s block', !!d && [...d.querySelectorAll('.sp-break')].every((line) => {
        const y = line.getBoundingClientRect().top;
        return ![...d.querySelectorAll('.dev-block')].some((b) => { const br = b.getBoundingClientRect(); return y > br.top + 1 && y < br.bottom - 1; });
      }));
      ok('the sheet carries its page margins', /@page \{ margin: 16mm 14mm; \}/.test(r3.html));
      ok('what is printed is locateHtml\'s page', r3.html === sheetPreviewBuilt().html && !/sp-break/.test(r3.html));
      // Print prints this frame: its page-end marks must not reach the paper.
      const printHides = !!d && [...d.styleSheets].some((ss) => [...ss.cssRules].some((rule) =>
        rule instanceof d.defaultView.CSSMediaRule && rule.media.mediaText === 'print'
        && [...rule.cssRules].some((x) => x.selectorText === '.sp-break' && x.style.display === 'none' && x.style.getPropertyPriority('display') === 'important')));
      ok('the page-end marks are hidden when the frame prints', printHides);

      // ---- 6. A narrow stage: scaled, not reflowed ----
      const stage = el('sheetPreviewStage');
      stage.style.width = '300px'; stage.style.flex = 'none';
      fitSheetPreview();
      const tf = el('sheetPreviewFrame').style.transform;
      const k = /scale\(([\d.]+)\)/.exec(tf);
      ok('a stage narrower than a page: the frame scaled', !!k && Number(k[1]) < 1 && Math.abs(parseFloat(el('sheetPreviewFrame').style.width) * Number(k[1]) - 300) < 2, tf);
      ok('the sheet keeps its page width inside', Math.abs(d.body.getBoundingClientRect().width - 210 * 96 / 25.4) < 2);
      stage.style.width = ''; stage.style.flex = '';
      closeSheetPreview();
    }

    // ---- 7. The words ----
    const keys = ['Print preview', '1 label', '{n} labels', '1 page (A4)', '{n} pages (A4)', 'Page {n}'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = keys.filter((k) => !CarinoI18N.has(loc, k));
      ok(`${loc} has the preview's strings`, miss.length === 0, miss.join(' | '));
    });
    setLocale('ja');
    ok('Japanese never says コンピューター', !keys.some((k) => /コンピュータ/.test(t(k))));
    ok('a count keeps its number', t('{n} labels', { n: 7 }).includes('7'));
    setLocale('en');
  } catch (e) {
    ok('sheetpreview suite ran without throwing', false, e && (e.stack || e.message));
  } finally {
    closeSheetPreview();
    document.querySelectorAll('body > button').forEach((b) => { if (b.textContent === 'opener') b.remove(); });
    window.open = heldOpen;
    HTMLAnchorElement.prototype.click = realClick;
    setLocale('en');
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
