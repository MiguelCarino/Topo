#!/usr/bin/env node
// Checks, without a browser, what the report previews' PDF | HTML switch
// stands on (reportFormat in js/report.js, js/sheetpreview.js; the fleet's
// carino-pdf.js). The switch itself, the busy state and the saved files are
// the sheetpreview and summary suites' (run.sh).
//
//   node tests/report-pdf-check.mjs
//
//   1. the paper each printed output gets in its PDF, read by carino-pdf.js's
//      own pageSetup from the @page rule the output carries: a label 62 x 29
//      mm with no margin, the Locate sheet and the site report A4 with their
//      16 x 14 mm margins (the report names no paper on purpose: A4 is the
//      engine's default); the map sheets' <use href="#topo-dg"/> given the
//      picture itself in the PDF's copy (inlineDiagramUses);
//   2. index.html loads carino-pdf.js (deferred, from this site), and the
//      desktop stage ships it with the html2canvas it loads itself;
//   3. both previews: Print then one Download (btn btn-primary, last), the
//      Download not relabelled by data-i18n (the switch labels it);
//   4. the new strings in es, pt-BR, ja and ru, PDF and HTML in Latin.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
let failed = 0, total = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'} :: ${name}${extra ? ' :: ' + extra : ''}`); };

try {
  // ---- 1: the paper ----
  const box = { window: {} };
  vm.runInNewContext(read('carino-pdf.js'), box);
  const P = box.window.CarinoPdf;
  ok('carino-pdf.js loads its pure half without a page', !!P && typeof P.pageSetup === 'function' && typeof P.fileName === 'function');
  // Each output's @page rules, as its source writes them into the document.
  const pages = (file) => (read(file).match(/@page[^{]*\{[^}]*\}/g) || []).join('\n');
  const lbl = P.pageSetup(pages('js/assets.js'));
  ok('labels: a 62 x 29 mm page, no margin', Math.abs(lbl.w - 62) < 1e-6 && Math.abs(lbl.h - 29) < 1e-6 && lbl.margin.every((m) => m === 0), JSON.stringify(lbl));
  ok('and one label per page (break-after: page on .lbl)', /\.lbl \{[^}]*break-after: page/.test(read('js/assets.js')));
  const loc = P.pageSetup(pages('js/locate.js'));
  ok('Locate: A4, 16 mm top and bottom, 14 mm at the sides', loc.w === 210 && loc.h === 297 && loc.margin.join() === '16,14,16,14', JSON.stringify(loc));
  const rep = P.pageSetup(pages('js/report.js'));
  ok('site report: A4 (it names no paper), its 16 x 14 mm margins', rep.w === 210 && rep.h === 297 && rep.margin.join() === '16,14,16,14', JSON.stringify(rep));
  // The large map's landscape sheets are a named page (page: topo-land),
  // which the engine does not read: they land on the report's A4 portrait
  // pages (an open request on carino-pdf.js, not Topo's to change).
  ok('the large map\'s named landscape page does not change the report\'s paper', /@page topo-land \{/.test(pages('js/report.js')) && rep.w < rep.h);
  ok('file names: the stem kept, the extension the format\'s', P.fileName('topo_acme_site_2026-11-10_labels.html', 'pdf') === 'topo_acme_site_2026-11-10_labels.pdf'
    && P.fileName('topo_acme_site_2026-11-10_report.html', 'html') === 'topo_acme_site_2026-11-10_report.html');

  // The map sheets draw one picture through <use href="#id"/> (diagramSheets),
  // which html2canvas cannot follow out of its <svg>: those sheets came out
  // blank. The PDF's copy (makeReportPdf) gets the picture in each <use>.
  {
    const src = read('js/report.js');
    const fn = /function inlineDiagramUses\(html\) \{[\s\S]*?\n\}/.exec(src);
    const inline = fn && vm.runInNewContext(`(${fn[0]})`, {});
    const doc = '<svg class="dg-src"><defs><image id="topo-dg" href="data:image/png;base64,AAA=" width="30" height="20"/></defs></svg>'
      + '<svg class="dg" viewBox="0 0 30 20"><rect/><use href="#topo-dg"/></svg><svg class="dg" viewBox="0 0 15 10"><use href="#topo-dg"/></svg><svg><use href="#other"/></svg>';
    const got = inline ? inline(doc) : '';
    ok('PDF copy: each map <use> carries the picture itself', !!inline && (got.match(/<image href="data:image\/png;base64,AAA=" width="30" height="20"\/>/g) || []).length === 2
      && !/<use href="#topo-dg"\/>/.test(got) && /<use href="#other"\/>/.test(got), got.slice(0, 120));
    ok('and a document without such a picture is left as it is', !!inline && inline('<p>x</p><use href="#a"/>') === '<p>x</p><use href="#a"/>');
    ok('makeReportPdf hands the engine that copy', /P\.pdf\(inlineDiagramUses\(html\)/.test(src));
  }

  // ---- 2: loaded and shipped ----
  const html = read('index.html');
  ok('index.html loads carino-pdf.js, deferred, from this site', /<script src="carino-pdf\.js" defer><\/script>/.test(html));
  const tag = html.indexOf('<script src="carino-pdf.js"');
  ok('and after the scripts that call it (it is read only when a preview opens)', tag > html.indexOf('<script src="js/sheetpreview.js"') && tag > html.indexOf('<script src="js/report.js"'));
  const stage = read('desktop/stage.sh');
  ok('the desktop stage ships carino-pdf.js and carino-html2canvas.js', /carino-pdf\.js carino-html2canvas\.js/.test(stage) && /carino-clock\.js carino-html2canvas\.js; do/.test(stage));
  ok('carino-html2canvas.js is next to carino-pdf.js (it loads it from there)', read('carino-html2canvas.js').length > 10000);

  // ---- 3: the buttons ----
  for (const [dlg, print, dl] of [['reportDialog', 'reportPrintBtn', 'reportBuildBtn'], ['sheetPreviewDialog', 'sheetPreviewPrint', 'sheetPreviewDownload']]) {
    const start = html.indexOf(`id="${dlg}"`);
    const acts = /<div class="rpv-actions">([\s\S]*?)<\/div>/.exec(html.slice(start));
    const btns = acts ? [...acts[1].matchAll(/<button\b[^>]*>/g)].map((m) => m[0]) : [];
    ok(`${dlg}: Print, then one Download (btn btn-primary, last)`, btns.length === 2 && btns[0].includes(`id="${print}"`) && /class="btn"/.test(btns[0])
      && btns[1].includes(`id="${dl}"`) && /class="btn btn-primary"/.test(btns[1]), btns.join(' '));
    ok(`${dlg}: the Download labelled by the switch, not data-i18n`, btns.length === 2 && !/data-i18n/.test(btns[1]));
    const side = html.slice(start, html.indexOf('</aside>', start));
    ok(`${dlg}: no switch written in the options (it goes above the name)`, !/rpv-format/.test(side));
  }

  // ---- 4: the words ----
  const keys = ['File', 'PDF', 'HTML', 'Download PDF', 'Download HTML', 'Creating the PDF…', 'Could not create the PDF.'];
  const listeners = [];
  const doc = { documentElement: { lang: 'en' }, readyState: 'loading', addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null };
  const win = { addEventListener: (...a) => listeners.push(a), location: { search: '' }, navigator: { language: 'en' }, localStorage: { getItem: () => null, setItem: () => {} } };
  const ctx = Object.assign({ window: win, document: doc, navigator: win.navigator, location: win.location, localStorage: win.localStorage, console }, {});
  win.window = win;
  vm.runInNewContext(read('js/i18n.js'), ctx);
  const I = win.CarinoI18N;
  ok('js/i18n.js loads without a page', !!I && typeof I.has === 'function');
  for (const loc of ['es', 'pt-BR', 'ja', 'ru']) {
    const miss = keys.filter((k) => !I.has(loc, k));
    ok(`${loc} has the PDF | HTML strings`, miss.length === 0, miss.join(' | '));
  }
  const src = read('js/i18n.js');
  ok('PDF and HTML stay Latin in every language', (src.match(/"PDF": "PDF",/g) || []).length === 4 && (src.match(/"HTML": "HTML",/g) || []).length === 4);
  ok('Japanese downloads say PDF and HTML', /"Download PDF": "PDFをダウンロード"/.test(src) && /"Download HTML": "HTMLをダウンロード"/.test(src));
} catch (e) {
  ok('the check ran to the end', false, String(e && e.stack || e).slice(0, 400));
}
console.log(`---\n${total} checks, ${failed ? failed + ' failing' : 'all passing'}`);
process.exit(failed ? 1 : 0);
