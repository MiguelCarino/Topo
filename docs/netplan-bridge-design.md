# Design note — Topology → netplan bridge (toggle + URL handoff)

**Status:** approved design, not yet implemented.
**Decision:** a per-node **toggle** plus a **cross-site URL handoff** to
`netplan.carino.systems`. This supersedes the earlier draft's 19-type capability-tier
map and the embedded-module option — both evaluated and rejected (see §7).

---

## 1. The idea in one line

A node gets a checkbox: *"references a network config file."* When on, an
**Open config** button derives the node's netplan intent from its existing fields
at click time and opens `https://netplan.carino.systems/#<encoded-intent>`, where
the netplan app hydrates its interface forms and renders all three backends
(netplan / systemd-networkd / NetworkManager).

Nothing but one boolean is stored. The config is always a **projection of the
current node**, computed on demand.

## 2. Semantics: seed, not sync

- **Derive at click time, never store a snapshot.** The link reflects the node as
  it is *now*. Re-clicking regenerates; edits made in the netplan forms do **not**
  flow back. The button means "seed the generator with this node," not
  "synced config."
- **Zero URL cost when off.** Serialize conditionally — `netcfg: n.netcfg || undefined`
  (same trick `sourceIface` uses at `js/app.js:250`) — so every document that never
  uses the toggle stays byte-identical to today. A toggled node costs ~19 raw chars
  (~2–4 after deflate).
- **Only the deployed pair must agree on the encoding.** Because URLs are generated
  fresh at click time, there are no historical links to keep compatible.

## 3. Sender — NetworkTopology changes (~60–80 LOC)

All cloned from existing patterns:

| Piece | Clone target | Where |
|---|---|---|
| Checkbox row | `natRow` / `propNat` | `index.html:172-175`, after the NAT row in `#nodeNetworkProps` |
| Show / restore / onchange | `propNat` wiring in `select()` | `js/ui.js:768-773` |
| **Open config** button | `jumpGwBtn` (hidden, revealed conditionally) | `index.html:169`, `js/ui.js:774-784` |
| Reset on deselect | `clearPropertyInputs` | `js/ui.js:737-747` |
| Serialization | allowlist + normalizer | `js/app.js:247` (`serializeNode`) and `js/app.js:398` (`normalizeLoadedNode`) |
| Fragment encoding | `encodeShareFragment` | `js/app.js:292-306` — reuse verbatim as the wire codec |

The toggle is **visible on every node type, default off** — explicit user intent,
no gating.

### 3.1 Advisory note (all that survives of the tier map)

One static array, no tiers, no regexes: when `node.type` is in
`['switch', 'camera', 'printer', 'cloud']`, show a one-line hint under the toggle —
*"these usually run vendor firmware, not netplan."* ~3 LOC; keeps the tool from
appearing to endorse config for devices that almost never take one, without ever
blocking the user.

### 3.2 `bridgeIntent(node)` — the derivation (~35–40 LOC)

Maps node fields onto netplan's intent model
`{ name, type, dhcp4, dhcp6, addr, gw, dns, search, routes, ssid, psk }`:

- Skip implicit faceplate ports and folded bond members.
- `type`: `ifaceIsWireless(i)` (`js/model.js:34-35`) → `'wifi'`, else `'ethernet'`.
- `addr`: `iface.ip`; if the topology IP lacks a prefix, append `/24` and **mark it
  as guessed**.
- `dhcp4`: inferred — blank IP → `true` (a guess; blank could also mean L2-only).
- `gw` + `dns`: node-level values pinned to the interface whose subnet contains the
  gateway, else the first addressed interface (heuristic — flag for user review).
- `search`, `routes`: empty (not modeled on the node).
- `ssid`: placeholder from the node name; **`psk` is always omitted — never put a
  secret in a URL fragment** (fragments land in browser history).

Envelope: `{ v: 1, ifaces: [...], fam: [v4, v6] }`, deflate-raw + base64url with the
existing `~` prefix. Measured size for a realistic 2-iface node: **~270-char full
URL** (≤900 even under the legacy base64 fallback) — far below any browser limit.

Open in a new tab via a pre-encoded `<a href>` refreshed in `select()`, so no async
work runs in the click handler (avoids popup blocking).

## 4. Receiver — NetplanConfig changes (~40–60 LOC)

NetplanConfig currently has **no inbound-URL support at all** (no `location.hash`
reads anywhere in first-party code) — and that's good: no collisions, no router,
nothing to fight.

- Insert `hydrateFromHash()` in the bottom-of-body init sequence **between
  `renderTemplateGrid()` and `renderIfaces()`** (`index.html:1533/1534`).
- Decode the `~` fragment (mirror of NetworkTopology's `decodeFragment`; keep the
  ~20-LOC helper **byte-identical** in both repos, with a comment in each pointing
  at the other file).
- Sanitize every entry through the existing `loadExample` defaults-merge
  (`index.html:1073-1076`) — it is already the exact normalizer needed. Ignore
  unknown keys; treat `psk` as absent.
- Assign to `ifaces`; existing rendering handles the rest — `buildNetplanFiles`
  (`index.html:874-886`) already suppresses example modules when custom ifaces
  exist, and all three backends consume the same array.
- `history.replaceState` to clear the hash after successful hydration, so reloads
  don't re-trigger and the URL doesn't linger with intent in it.

## 5. What the user gets

Design the network visually → toggle a node → one click opens the full netplan
generator pre-filled with that host: three backends side by side, validation,
multi-file tabs, download-all. Multi-homing is free: two NICs on a shared subnet
trigger `backends.js`'s source-policy-routing plan automatically, because the
trigger is computed from addresses the node already carries.

Hydrated fields that were guessed (invented `/24`, gw-owner heuristic, inferred
DHCP, placeholder SSID) should be visually marked for review on the netplan side.

## 6. Known limits (accepted)

- **One-way.** No round-trip; netplan-side refinements are discarded on re-click.
- **Ethernet + wifi only.** `backends.js` parameterizes only these two custom
  types; bond/VLAN/VRF/bridge/tunnel are hardcoded example modules. A bonded or
  VLAN-named topology interface degrades to a generic example. Extending
  `backends.js` is deferred until there's demand.
- **Codec duplication.** ~20 LOC copied across two repos with no CI to catch drift;
  mitigated by generate-at-click (only the deployed pair must agree) and the
  byte-identical-helper convention.

## 7. Roads not taken

- **19-type capability-tier map** (native/conditional/unsupported + os-regex
  overrides — the earlier draft's §5): rejected. It gated an *always-present*
  affordance; an opt-in toggle never volunteers, so the problem it solved
  disappeared. It also carried real upkeep (19 rows, two world-taxonomy regexes)
  and already contradicted shipped defaults (`pc` ships `os:'Windows 11'` yet
  tiered *native*; `edge` ships `os:'Omada'`, caught by neither regex). The §3.1
  advisory array recovers its entire credibility payoff at ~3 LOC.
- **Embedded netplan module** (Option B): rejected as the first move. The netplan
  YAML renderer is *not* in `backends.js` (`render()` returns `null` for netplan) —
  it is woven into NetplanConfig's `index.html` with ~35 references to module
  globals (`fam4`/`fam6`/`currentTemplate`), so embedding demands a real upstream
  refactor (~350 LOC, 1.5–2 days vs ~130 LOC, 0.5–1 day), creates the fleet's first
  cross-repo JS-sync dependency, and still leaves both subdomains alive. If a full
  merge is ever committed to, extracting `CarinoNet.renderNetplan(ctx)` is step one
  of *that* project — not a prerequisite for this bridge.

## 8. Implementation checklist

1. NetworkTopology: toggle row + advisory hint + Open-config `<a>` (clone
   `natRow`/`jumpGwBtn`), `select()`/`clearPropertyInputs` wiring, 2-line
   serialization edit, `bridgeIntent()` + envelope encoder.
2. NetplanConfig: `hydrateFromHash()` + shared decode helper + `replaceState`.
3. Test: multi-homed node (policy routing fires), wifi node (ssid placeholder, no
   psk), prefix-less IP (guessed `/24` marked), untoggled doc byte-identity, legacy
   base64 fallback path, reload-after-hydration.
