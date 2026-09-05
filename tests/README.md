# Tests

    ./tests/run.sh            # every suite
    ./tests/run.sh wifi wave  # named suites

Needs `chromium-browser` on PATH (override with `CHROME=...`). No npm, no build
step — the app is static files and the tests run it as the browser would.

## How it works

`run.sh` injects one suite into a copy of `index.html`, renders it in headless
Chromium, and reads results back out of the dumped DOM. A suite reports by
appending a `<pre id="TESTOUT">` of `PASS :: name` / `FAIL :: name` lines. Any
FAIL, or a suite that reports nothing at all, exits non-zero.

The instrumented copy is written to the repo root as `.testrun.html`, not to
`/tmp`, because `index.html` pulls `css/` and `js/` by relative path. Run it from
elsewhere and you get a blank page with no app on it, and every assertion fails
for the wrong reason.

## Cross-engine (Chromium + Gecko + WebKit)

`run.sh` proves the suites on Chromium only — it depends on `--dump-dom`, which
Firefox and WebKit have no equivalent for. `run-cross.mjs` runs the **same**
suites on every Playwright engine that will launch, so "works cross-browser" is
checked, not hoped:

    cd tests
    npm install
    npx playwright install chromium firefox webkit   # one-time engine download
    node run-cross.mjs             # every suite on every available engine
    node run-cross.mjs wifi bonds  # named suites only

An engine that will not start is reported **skipped, not failed** — Playwright's
WebKit needs system libraries it ships for Ubuntu, so on other distros (Fedora,
etc.) it may not launch; Chromium and Firefox do. This is how the wave suite's
`getComputedTextLength()` tolerance was found: Gecko reports a textPath's clamped
length a pixel under Chromium, and the strict assertion caught it.

`tests/node_modules/` and the transient `.crossrun.html` are gitignored.

## The suites

| Suite | Covers |
|---|---|
| `interfaces` | The ARP-flux / MAC-flapping model: auto-binding, two-tier warn→bad escalation, port growth, L2 loops, hash round-trip, legacy diagrams with no interface refs |
| `wifi` | Wirelessness as a property of the interface: radios vs sockets, name inference, medium/interface agreement |
| `ui` | Sidebar, faceplate, interface editor rows |
| `wave` | Per-medium flow animation, the `)))` wireless wave, dash attributes on export |
| `errors` | The deliberately-broken `errors` template raises what it should |
| `showcase` | The featured template exercises every feature |
| `industry` | The industry templates (imaging, hotel, vessel, warehouse…) |
| `military` | NIPR/SIPR air gap — asserted as a negative, in both directions |
| `tabs` | Library tabs, keyboard shortcuts, settings persistence |
| `smoke` | Every template and snippet loads, renders, traces, and stays clean |
| `bonds` | NIC bonding: folding NICs into one MAC/IP, mode + member survival, the flapping cure |
| `persistence` | "Save as template" round-trips the network intact — portCount, socket bindings, and the nat field that used to invert |
| `history` | Undo/redo on the shared serializer: the timeline rides `save()`, identical saves add no step, a fresh edit forks the future, Ctrl+Z acts on the canvas |
| `trace` | The trace port-filter toggle: `activeTracePort()` gates reachability pruning, a suspended port is kept not cleared, the three diagnostic messages |
| `compat` | Cross-engine safeguards: image export named for the MIME the canvas produced (old-WebKit WebP→PNG), storage writes that survive a throwing `setItem`, every SVG label carries an explicit font-family |
| `i18n` | Translation coverage: every locale carries every diagnostic, report and landing message, placeholders survive translation, every evaluator, the rendered report and the landing page come out in the chosen language while the customer's own names are left alone, and English comes back afterwards |
| `library` | Saved networks: the store round-trips the document byte-for-byte, saving an open card updates it instead of breeding a copy, summarising a stored network never leaves the editor holding it (even when a check throws), a card's counts are the panel's counts, a site name that looks like markup renders as text, opening a card puts *that* document in the URL, the drop zone's highlight survives the cursor crossing its own children, the binder file names itself and carries the documents intact, re-importing your own binder is a no-op while a colleague's merges into your work rather than replacing it, newer wins and older does not, `updated` always moves so two saves in one millisecond still order, the "changed since you exported" line tracks what actually went in the file, the editor's own controls are measurably off the screen while the landing is up and back when it is not, no part of the editor is on screen before boot has decided which way in this is, the merge survives junk entries without losing the good ones, a cloud can stand for another site and that reference survives the URL, is dropped on any other node type and captions the canvas identically whether or not it resolves, a closed landing is measurably off the screen and the canvas is clickable again, replacing the document drops the card it came from so Save cannot overwrite a survey with a template, and only a bare URL is the landing |
| `binder` | The estate document: the cover's totals are the sites' own totals, a site inside the estate reports exactly what it reports alone, subnets are counted once across the estate, a network documented in two buildings is named as a fact and never graded as a finding, a site header that differs from the cover prints and one that agrees stays quiet, the image sweep hands the canvas back byte-identical and adds no undo step, a reference cycle between sites terminates, the estate graph puts a hub above the branches that reach it and draws every one inside the viewBox, no sheet prints a date its document never recorded, and a save() during the sweep cannot write the borrowed document into the URL or the undo timeline |
| `binderfile` | Save to binder: without the File System Access API everything still downloads, a handle round-trips through the store, an already-granted permission is not re-requested and a refused one falls back to a download, a failed write aborts its stream, and binding to a file that already holds someone's networks merges rather than obliterates. The real picker, a handle surviving a browser restart, and the browser's permission prompt are hand-verified only — as is the IndexedDB store itself, whose callbacks never fire under run.sh's virtual clock |
| `report` | The site report: the findings split says exactly what the alert panel says, severity ordering, the model against the canvas, customer-supplied text escaped, and a header that rides the document without touching untouched diagrams |
| `sharing` | Transmitting a build: the compressed `~` share fragment round-trips and is far shorter, legacy links still decode, unicode survives, `load()` restores both formats, the portable `.nettopo` file exports/imports intact, and a `b~` binder link carries many networks in one URL — bundled smaller than the sites compressed separately, opening onto a guest shelf that touches neither the canvas nor this browser's library until Keep, and never silently decoding as a document |

## Writing one

Suites are plain scripts run against the live app — `state`, `getNode`,
`validateTopology` and friends are all in scope. Follow an existing suite:
build state with `loadTemplateState` or by assigning `state.nodes` directly,
call `autoBindLinks()`, assert, then append the `TESTOUT` pre.

Two rules learned the hard way:

- **Assert, don't report.** `smoke` originally printed `house: nodes=5 badged=none`
  for a human to read, which meant it could not fail. A suite that always passes
  looks like coverage and isn't.
- **Watch it fail before you trust it.** Break the thing on purpose and confirm
  the suite goes red. Several of these caught real bugs that screenshots could
  not — a stray `*/` that silently killed the UTP keyframes, an AP radio counted
  as a faceplate port, ID collisions from `Date.now()`.
