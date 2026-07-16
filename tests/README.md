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
