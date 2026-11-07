# Topo backlog: features inspired by Netdisco

Added 2026-11-04. [Netdisco](https://github.com/netdisco/netdisco) discovers live networks over SNMP; Topo records them by hand and never probes. These six features take what Netdisco shows from the switches and show it from what the register already holds. Polling, port control, users/roles, a server API and plugins are out of scope on purpose.

Each spec below was written against the code by one agent and then cross-checked by a critic; the critic's corrections are folded in under **Amendments**. Line numbers are as of commit 1b3fe85.

## The six features

| # | Feature | Size | Format change |
|---|---|---|---|
| 1 | [Locate: where a device is physically plugged in](#1-locate) | medium | none (a view) |
| 2 | [Capacity reports: address use per subnet (with a DHCP pool) and port use per switch](#2-capacity) | medium | stage 4 only (DHCP pool fields) |
| 3 | [Inventory by vendor, model and firmware/OS](#3-inventory) | large | yes (vendor/model fields) |
| 4 | [VLANs, trunks and PoE modelled](#4-vlan) | large | yes (tagged VLANs, PoE) |
| 5 | [Address and location history (per-device trail kept beside the card, recorded at back-up and report)](#5-history) | large | none (browser-only store) |
| 6 | [Saved searches, printed as report sections](#6-reports) | medium | yes (doc.searches) |

## Landing order

One order across every stage of every feature, from the cross-check. Status is kept here as stages land.

- [x] 0. Owner gate: confirm these go ahead of, or interleaved with, the M1-M60 mobile batches (now [docs/MOBILE.md](MOBILE.md); Topo/CLAUDE.md is gone), because several stages add phone UI.
- [x] 1. Shared refactor: uplinkOf(node, {skipNoPort, links, nodes}) in js/model.js, with csvUplink and patchPoint on top of it and a byte-identical guard on devices.csv and BULK_ORDERS.port on every template. Both locate and history depend on it, and it is pure. (done 2026-11-04)
- [x] 2. capacity stage 1 (subnetCapacity/portCapacity; networkStats, portUsage, reportPortMaps and evaluatePorts all read them). It fixes a real gateway off-by-one with no format change, and settles the 'used port' definition that vlan and locate later read. (done 2026-11-04)
- [x] 3. locate stage 1 (pure locatePath with typed gaps). No format, nothing visible, and it exercises uplinkOf. (done 2026-11-04)
- [x] 4. locate stages 2-5 (Full panel + W, search button + asset link, Simple sentence, print). Stage 2 (Full panel + W) done 2026-11-04. Stage 3 (search button + asset link, Full side) done 2026-11-04. Stage 4 (Simple sentence, Simple summary socket, W in the reduced views) done 2026-11-04. Stage 5 (print sheet from the section and the rail) done 2026-11-04. Read-only and no format: a low-risk user-visible win. It decides the #queryTools layout that reports reuses. (done 2026-11-04)
- [x] 5. capacity stages 2-3 (port-capacity and address-capacity info notes, Capacity report section; stop dropping cable-less switches from the port map). Still no format change. Stage 2 (port-capacity note, has:full, cable-less switches in the port map, Capacity section with a Ports table of the noted switches only, the switch half of Room to grow) done 2026-11-04. Stage 3 (address-capacity note on whole subnets, the Addresses table of every subnet in the Capacity section, the subnet half of Room to grow, In use / Free columns in the table's Subnets tab) done 2026-11-04. (done 2026-11-04)
- [x] 6. Managed-switch L2 forwarding fix in reachL2Domain/reachWalk, as a separate change with its own trace/findings tests and the owner's agreement. It is a prerequisite for any VLAN check. Owner approved. isL2Forwarder (js/model.js: a switch or AP, whatever its address) beside isDumbDevice (a switch or AP with no address). Forwards L2 (isL2Forwarder): reachL2Domain, reachWalk's and calculateReachability's neighbour tests, the trace port filter's keep rule (a managed switch on the path keeps the links through it lit), l2DomainOf/segmentKeyOf (the MAC-flapping segment). Has no address (isDumbDevice, unchanged): partsOf's and calculateReachability's dumb-start seeding (a managed switch starts as a host on its management subnet, so the tails key id+viaNet is unchanged: a switch is never handed on), evaluateInterfaces/MultiHoming/Gateway/Dns, getPortStatus's transit rule (an addressed switch/AP is an endpoint for its own services: evaluateDns's port 53 and the node tab's Trace port row judge its Allowed Ports), updateTraceStatus's count, the map's address labels, addContext (js/add.js), and loopFindings (a managed switch is where STP runs, so a ring of managed switches is not a loop finding). Membership is kept apart from traversal: the walk crosses every switch/AP, but one with an address is reached itself only from a device sharing its subnet and not hidden by NAT (reachWalk, the same test as the candidate devices), so a switch managed on an unrouted VLAN is not reachable from the PCs it forwards for, and an inside management address stays hidden from the WAN side. reachL2Domain skips VPN links as l2DomainOf does, so a tunnel ending on a managed switch stays the routed overlay. A retired switch still forwards nothing; passthrough unchanged. No template, sample or block has a switch or AP with an address, and their findings and every device's trace were byte-identical before and after (snapshot diff over templatesData and BUILTIN_BLOCKS); perf.js on site300 within budget. tests/suites/managedl2.js. Release note: existing files with a managed switch or access point (one with a management address) lose their false 'Gateway ... is not reachable' and DNS 'not reachable' findings for the devices behind it, the Trace now runs through it, two NICs on one subnet through one managed switch now read as one broadcast domain (MAC flapping, critical, where it was the ARP flux advisory); a ring of managed switches stays without an L2 loop finding, as before. (done 2026-11-04)
- [x] 7. capacity stage 4: dhcpFirst/dhcpLast, which take the first format bump (v16). It is two omit:true network fields with no shape change, the smallest bump, and it makes the bump procedure concrete, including the missing v15 log entry. (done 2026-11-04)
- [x] 8. reports stage 1 (doc.searches): v17, or folded into v16 if it lands in the same unpushed series. Every held-state list must be updated (library.js:682 canonicalDoc, :989 withDoc, report.js:2174, csv.js:2866). Folded into v16 (same unpushed series as the DHCP pool), so the next free version is still 17. (done 2026-11-04)
- [x] 9. reports stages 2-4 (save/list UI in the bar set up by locate, report section, searches.csv). Print must refuse browser-local terms ahead of history's was:. Stage 2 (the ☆ Save search in #queryTools after Locate, the ★ Saved ▾ menu in the box, the Save/Edit dialog, setQuery on click, was:/has:history refused on save and flagged in the menu) done 2026-11-04. Stage 3 (reportSearches in reportModelNow, the Saved searches section after Capacity, the report dialog's ticks and parts.searches, the binder printing each site's marked ones, the TV_COLS override map and the age/next-service cells counting to checksDay, was:/has:history printed as a muted 'Not printed' line) done 2026-11-04. Stage 4 (searches.csv export/import, the sqdef family, csvPlanSearches, csvWrite, the review strings in five locales, tests/suites/searchescsv.js as searches.js part 5) done 2026-11-04. (done 2026-11-04)
- [x] 10. history stages 1-3 (trail store hooked into takeSnapshot, panel section after Locate, was:/has:history). Stage 1 (js/trail.js: the nettopo_trail store, observeDoc on canonicalDoc with the shared uplinkOf, the spans and bounds, recordPoint hooked into takeSnapshot, dropTrail on card delete, the state.settings.trailRecording preference with no Settings toggle yet) done 2026-11-04. Stage 2 (the History section in the Full device panel after Locate, #historyGroup with its open state kept as nettopo_history_open, renderHistoryFields with the value now and each past value with its dates and kind, the address-reuse hint, Forget this device's history, the landing card's Clear history, the plain empty-state text and the browser-only note, i18n in five locales, tests/suites/trailpanel.js and tests/suites/trailedge.js) done 2026-11-04. Stage 3 (was:<value> and has:history in js/query.js, marked browser-local by def.local/q.local, the past-value lines as buttons putting was: in the box, the removed-holder and no-history lines under the box (#queryNote), the box tooltip naming was: in five locales, querySavedMatches and queryLocalTerms refusing them by word and by parsed term, tests/suites/trailsearch.js and the perf.js extension) done 2026-11-04. No format change, and it reuses uplinkOf. It lands after reports so the saved-search exclusion of was: exists from day one. (done 2026-11-04) Follow-up: the Settings toggle 'Keep address history at back-ups and reports' (a data-adv History section after Reports in the Settings dialog, #setTrailRecording, on by default, off kept as trailRecording:false through saveSettings/loadSettings, off stops recording and keeps the stored trail, its hint in five locales, tests/suites/trailpanel.js part 9; review fixes: the History section's off note and empty line, the switch followed across tabs through the storage event) (done 2026-11-04)
- [x] 11. history stage 4 (read older back-ups in), then the optional stage 5 only on the owner's call. Stage 4 done; stage 5 built on the owner's call (2026-11-05, "Do build optional address history"). Stage 4 (insertObservation placing an older 'file' point among the recorded ones, 'Add to its history' in askAboutKnownCopy/applyImportedDoc, the binder's one question after its merge for sites whose card is newer, any document version 1-16 as a source, tests/suites/trailreadin.js) done 2026-11-04. Review fixes (done 2026-11-05): 'known' also when the point after the file's time holds exactly what it holds (a back-up's own point is stamped at export, after the edit time the file carries); templates and blocks take no read-in through either door (trailReadInCard; the implementer's deviation, now one rule); a re-opened binder asks nothing about copies already held; a point older than a full record changes nothing; a device missing at an older point between its last sighting and its removal is gone from that point. Stage 5 (the technical sheet's Address history section: trailReportHistory in js/trail.js reading the card's trail since the newest 'report' point, or the whole trail with none, against the document handed in; addressHistorySection in js/report.js after Changes, a device per run of rows on the inventory's row rules so the report stylesheet is unchanged, the value now then each past one with dates and kind, a removed device last with the date it went, 'Nothing has changed since then.' for a quiet window; REPORT_SECTIONS 'history' no longer reserved, off by default, its tick with a note in the dialog, site and binder (each site its own card's trail); nothing for a network not kept, a read-only one or an empty trail; never in the Simple summary; i18n in five locales; tests/suites/addresshistory.js and the reportsections.js updates) (done 2026-11-05). Stage 5 review fixes (done 2026-11-05): a device deleted since the newest point says "removed after {date}"; a removed device's NICs and several removed NICs are numbered; a value typed back after a point that held none is not listed twice; a swapped NIC's new address prints beside the removed one; a hand-over with Address history but not Changes records a trail 'report' point (recordPoint alone, the Changes baseline unmoved), so the next history counts from it; one canonicalDoc pass per history. Owner follow-up (2026-11-05, "Add optional history on simple view"): the History settings in every view and Show address history in Simple view (off by default), the reduced views' read-only #historySimple sentences after the Locate sentence (historySimpleLines/historySimpleHtml/renderHistorySimple in js/trail.js), i18n in five locales, tests/suites/trailsimple.js and the trailpanel.js Settings updates (done 2026-11-05). Its review fixes (done 2026-11-05): a past radio link (a port span with no port, which the recorder keeps only for Wi-Fi, or one on a peer's radio interface) reads 'Was on Wi-Fi through {ap} until {date}.' as the Locate sentence does, never "plugged into", and the no-port fallback is the neutral 'Was connected to {value} until {date}.'; an address the device still holds on any NIC is no past address and one past address on two NICs is one line (the lines name no NIC); the switch and its port are split by the map's current port label or switch name, else at the first ' · '; the off check compares every simple sample's whole device panel with no history at all.
- [x] 12. inventory stage 1 (vendor/model fields, relabel to Firmware / OS, CSV aliases): the next format bump. It lands before vlan so the devices.csv header changes are separate. Folded into v16 (same unpushed series as the DHCP pool and the saved searches), so the next free version is still 17. (done 2026-11-04)
- [x] 13. inventory stages 2-5 (split review, vendor from MAC, firmware finding, Inventory tab/report). They are independent of each other, in the spec's order. Stage 2 (planModelSplit/applyModelSplit/reviewModelSplit in js/assets.js, the device editor's 'Model and firmware are in one field.' note with Split, the Table Devices toolbar's 'Split model and firmware…' review through the new askTicks dialog with a tick per row, one undo step, a stale row not written, read-only refused, i18n in five locales, tests/suites/modelsplit.js) done 2026-11-04. The Inventory tab's toolbar copy of the button waits for stage 5. Stage 3 (macVendorRead/macVendorSuggestion in js/assets.js on the shared js/oui.js table, no Topo-side OUI table; the Vendor field's '{value} · from the MAC' grey text with a Use button (one undo step, none read-only); the Table's muted Vendor cell with its not-saved title; Change all's 'Fill vendor from MAC' under Set fields with a reason per refused device, the unknown-maker one naming the ~35-maker coverage; HP / HPE by device type as specced; i18n in five locales, tests/suites/vendormac.js) done 2026-11-04. Stage 4 (firmwareFindings in js/diagnostics.js wired after labelFindings, check name 'Firmware', PLAIN_FINDINGS.firmware, warn level, scoped to the vendor|model key with long keys cut to 64 and hashed, a blank vendor joining the model's one vendor and grouped alone under two, no template or sample raising it, the perf.js budget on site300, i18n in five locales, tests/suites/firmware.js) done 2026-11-05. Review fixes (done 2026-11-05): the finding's line is 'Firmware: <detail>', so the Findings tab and the Accepted list name the model once; the scope carries the vendor only when the model is under two or more vendors, so filling in or clearing a model's one vendor (Fill vendor from MAC, Use) keeps an accepted finding accepted; the long-scope hash tested on the same devices moved to another long model; a reportdate test (a dated report and a binder site hold the same firmware finding). Stage 5 (reportInventory in js/report.js shared by the Table's Inventory tab and the report; the tab offered while a device has a vendor, model or firmware, its By vendor / By model / By firmware / OS switch per visit, read-only rows with Not recorded last and retired counted apart, a model's firmware versions marked while its firmware finding is open, a row click selecting its devices for Change all of them, the search keeping a row while one of its devices matches, Split model and firmware… on the tab too; the report's Inventory section after the device inventory with three tables, print-safe, a binder site's own and the mismatch following the report's date; no Simple summary list, per the decision that Makes and models stays technical; i18n in five locales, tests/suites/inventorytab.js, binder.js and reportdate.js additions) done 2026-11-04. (done 2026-11-04)
- [x] 14. vlan stage 1a (port tagged/poe, iface vlan/tagged, poeBudget/poeDraw, CSV with no bare 'poe' alias): the last format bump. It is the largest data change and lands after the other NODE_FIELDS/CSV edits are settled. Folded into v16 (same unpushed series as the DHCP pool, the saved searches and the vendor/model), so the next free version is still 17. Landed: parseVlanList/vlanListText/asVlanList, POE_CLASSES, portPoeFromText, poeDrawFromText (class 0-8), poeBudgetFromText, portVlans and endCarries (unknown ends carry every VLAN) in js/model.js; portAttrs.pN.tagged/poe; IFACE_FIELDS vlan/tagged (wired only, csv untagged_vlan/tagged_vlans); NODE_FIELDS poeBudget (switch/AP only, csv poe_budget) and poeDraw (not cloud/VM/container, csv poe_draw) after portAttrs, relabelled 'Port labels, VLANs and PoE'; ports.csv port_tagged/port_poe; vlan: matching tagged, has:trunk, has:poe; tests/suites/vlanmodel.js, vlancsv.js and the dhcpseal.js extension. Left for stage 1b: bulk:true / table:'edit' on poeBudget/poeDraw (both would surface UI), the editor, table, report and tooltip text. Review fixes (2026-11-05): parseVlanList reads "10 - 20"; portVlans lets a switch LAG's member ports read the LAG's VLANs when it records any (query port rows too); poeDraw aliases are only 'poe draw'/'poe draw w' (no 'power draw'/'poe watts'); 'tagged vlans', 'trunk vlans', 'allowed vlans' and 'native vlan' are the port's (pt:tagged/pt:vlan) on a sheet that names a port and nothing of an interface's (csvPortShapedVlans), the interface's otherwise; a wireless interface's VLAN cells get a review note; the faceplate's noted dots and count and the report's free-port rows read hasPortLabelOrVlan until stage 1b, which moves them back to hasPortAttrs. (done 2026-11-04)
- [x] 15. vlan stage 1b (editor UI, report columns, VLANs section), then 2a (VLAN checks, which need step 6), then 2b (PoE checks; the near-budget note goes through capacityFindings), then 3 (VLAN-aware Trace). The riskiest last, with locate updated to show tagged/untagged and the vlan-mismatch cross-check. Stage 1b done (2026-11-04): the faceplate, its list and the report's free-port rows back on hasPortAttrs (hasPortLabelOrVlan removed); the port list's ⋯ second line (Tagged, PoE pick with Watts…) open by itself on a port with either, the VLAN field's 'Untagged' placeholder, Set on ports (Untagged/Tagged/PoE on a run, one undo step, a port the box lacks refusing the run by faceplatePortIds); the summary 'Port labels, VLANs and PoE (n · k trunks · m PoE)'; PoE budget (W) under the port count with the live 'PoE: x of y W' line (poeLoad: PoE ports only, retired not counted) and PoE draw (W) under Gateway/DNS; + MAC / VLAN opening a wired interface's VLAN line (Auto · subnet's VLAN greyed, Tagged); the link panel's end VLANs once either end records one; port tooltip, rack tip ('Untagged 1 · Tagged 10,20', 'PoE+ 30 W') and tint; Locate's hop saying untagged/tagged on a trunk; Table: Ports Tagged/PoE, Interfaces VLAN (greyed when derived)/Tagged, Devices PoE budget/draw (offered once PoE is recorded), Change all for both (bulk:true, table:'edit'); report: port-map Untagged/Tagged/PoE columns and the heading's PoE budget, the VLANs section after Addressing (only with a tagged list), Capacity's PoE table (the amendment's PoE budget in Capacity), 'PoE 6.5 W' on a powered device's inventory line; i18n in five locales; tests/suites/vlanui.js. No VLAN or PoE checks (2a waited for step 6, now done; 2b and 3 not started); the locate vlan-mismatch cross-check waits for 2a. Stage 1b review fixes (2026-11-05): Set on ports reads a range's ends and a bare number alike on the box's own numbers (portIdByText; 0-3 on a scheme from 0, 25-26 on one from 25); the PoE budget/draw and Interfaces VLAN columns sort by sortKey; a custom-watts PoE cell shows '15.4 W' so it is not read back as 802.3af; Watts... holds and restores the port's whole PoE, blank keeps it, and the pick follows on leaving; the interface's greyed VLAN follows a typed address; no VLAN line or editable VLAN cells on a bond member or a named pN on a port-grid device, and reportVlans skips them as portVlans does; an all-only trunk prints one All VLANs row; 'Trunk' stays English in es/pt-BR/ja/ru per Translations; the unused 'Port labels and VLANs' key removed. Stage 2b done (2026-11-04): poeFindings in js/diagnostics.js (after capacityFindings) with poe-none (critical, one per bare cable of a powered device on a PoE-documented switch or AP, none when another of its cables is powered) and its advisory sister as its own key poe-class (draw over the best port's pd, or a custom port's watts), poe-budget (critical, the box and its powered devices, scoped to the budget), the 90-100% note poe-near in capacityFindings (info, not counted, scoped to the budget); check names 'PoE power' and 'PoE budget'; PLAIN_FINDINGS for all four with no 'PoE' or 'VLAN'; the Full Showcase's Hospital Switch (65 W, the Ward Camera on an af port) and Call Center Switch (120 W, both agent phones on at ports) with no finding; perf.js budget on site300; i18n in five locales; tests/suites/poechecks.js, the vlanui/vlanmodel 'no findings' assertions narrowed to the VLAN facts. Review fixes (2026-11-05): poe-class allows 0.05 W of slack (POE_CLASS_SLACK) so class 0/3 (held as 13 W) and 13 W on an af port (12.95 W) are not flagged; a custom port stays compared on its own watts at the switch (documented, Topo does not guess cable loss); poeLoad skips a device that may not hold a draw (canDrawPoe: a camera retyped as a VM); a device cabled to the PoE ports of two boxes is charged in full to each on purpose (documented and tested); perf.js counts the expected over-budget boxes itself; FEATURES says ports.csv is needed for the whole-network round trip. Stage 2b done; 2a and 3 waited for step 6, which is done (2026-11-04), so they can proceed. Stage 2a done (2026-11-04): vlanPath in js/model.js (BFS over cables, radio links and passthrough into every switch/AP whatever its address, VPN skipped, retired forwarding nothing; crossing a link only when both ends carry the VLAN; on failure the first non-carrying link on the shortest VLAN-blind path, null when there is none), portVlans' new derived flag (an interface's untagged VLAN taken from its subnet) and its SVI-on-a-trunk rule (an address whose VLAN is in the interface's tagged list is not its native VLAN); vlanFindings in js/diagnostics.js after cablingFindings: vlan-path (critical, scope vlan:N, only for devices whose gateway check is good, not routing devices or switches/APs, folded per VLAN + gateway + stopping cable, nodeIds hosts + gateway + the device where it stops, linkIds the cable), vlan-mismatch (per cable: (a) port vs NIC and (b) port vs port native VLANs critical, else (c) tagged at one end only / tagged vs untagged advisory, one finding per cable; radio, VPN, bridged and passthrough skipped), vlan-subnet (advisory, scope vlan:N, access ports only); check names 'VLAN path', 'VLAN mismatch', 'VLAN subnet'; PLAIN_FINDINGS for the three with no 'VLAN' or 'PoE'; the Full Showcase's Studio uplink a clean trunk (ssw p1 and l3 eth2 tagged 20, ssw p2/p3 VLAN 20); Locate's cross-check (an open vlan-mismatch or poe-none on a hop's cable shown on the hop in the finding's words, gone once accepted; Locate's untagged/tagged on a hop landed with 1b); perf.js budgets on site300 (the whole diagnosis with trunks everywhere, vlanPath from every switch for every VLAN); i18n in five locales; tests/suites/vlanchecks.js and the vlanmodel.js part 5 narrowing. Deviations from the spec text: an interface whose only VLAN is its subnet's (nothing typed on it) lets every VLAN through in vlanPath, as an unknown end does, because templates draw a router with one cable for several subnets (Retail's Store Router) and would otherwise get a vlan-path finding; a trunk's native VLAN is not judged by vlan-subnet (like a transit VLAN); the original cross-check list (duplicate MAC/IP, two cables on a port) is still not shown in Locate. Release note: files that wrote an access VLAN on an uplink port as a label (rather than as the cable's native VLAN), or typed a VLAN on a router interface whose cable carries other subnets' devices, may now get VLAN path or VLAN mismatch findings; files that record access VLANs on their ports but no VLAN on their subnets get one VLAN subnet advisory per such VLAN (set the subnet's VLAN, or Accept it scoped to the VLAN); a file with no VLAN facts on its ports and interfaces gets none, and every template stays finding-free. Stage 2a review fixes (2026-11-05): vlan-mismatch leaves out an end with nothing typed on it (its VLAN only its subnet's) from the tagged comparison (c), and from the wrong-port case (a) when the port carries that VLAN tagged (an AP or router on a stick with a bare uplink facing a documented trunk), as vlanPath walks through such an end; vlanPath names the link that alone keeps the VLAN out (between what the VLAN reaches from each side, a trunk first) before falling back to the first non-carrying link on the VLAN-blind path, so a router with one leg per VLAN is not blamed on the other VLAN's access leg; ifaceVlanAuto (the editor's greyed Auto VLAN, the Interfaces tab's VLAN column) follows portVlans' SVI-on-a-trunk rule and the greyed VLAN follows a typed tagged list; vlanchecks.js tests the gatewayGood gate on its own; perf.js times the VLAN finders alone (60 ms budget; measured 4 ms, the whole diagnosis 41 ms, every vlanPath sweep 2 ms), asserts no vlan-mismatch or vlan-subnet and the exact devices worked out apart from the finders. Stage 3 done (2026-11-05): reachL2Domain(originId, vlan) crossing a link only when both ends let the VLAN through (endPassesVlan in js/model.js, vlanPath's end rule shared: an unknown end, or one whose only VLAN is its subnet's, passes every VLAN); reachWalk's VLANs per entry (reachVlansOf: at the start the device's own per cable as vlan-path reads it, the access port's untagged VLAN, else its NIC's, a Wi-Fi client's SSID subnet's, a managed switch's management VLAN; after a hop the VLAN of the declared subnet viaNet names, so reachContext's tails key id+viaNet stays valid; after VPN or the cloud blind); a device reached only through a link carrying the VLAN and on a subnet that VLAN is (vlanSubnetOn), a router held to each subnet's own VLAN; calculateReachability opts.vlan (left out, the trace's own state.settings.traceVlan only when the port is left out too, so every check call stays VLAN-blind) returning the start's vlans; one L2 domain per (node, VLAN) and each end's portVlans and each subnet's VLAN read once per walk; the Trace box's VLAN tick beside Port filter (#traceVlan, on by default, state.settings.traceVlan, not persisted, syncTraceControls and its listener); the status line '→ 5 devices · VLAN 10' ('VLAN 10,20' from a router, no VLAN part when none is known); i18n in five locales; tests/suites/vlantrace.js and the perf.js extension (site300 with trunks: from the router within 100 ms, every device within budget; measured on plain site300 about 3.6 ms a trace against 1 ms VLAN-blind, 2 ms from the router). Deviation from the spec text: every routing device (not only a start router) walks each of its subnets on that subnet's VLAN, which is how 'after a router hop the VLAN of the declared subnet it hops into' is applied, so a router reached on VLAN 10 still routes into VLAN 20; a non-router walker also needs the shared subnet's VLAN to be the walked one (or none), so a PC on Staff on a VLAN 20 port does not reach its gateway's Staff address; a host with several cables walks each cable's VLAN; a dumb switch start lights its whole fabric VLAN-blind and each device cabled to it then walks its own VLAN. Stage 3 review fixes (2026-11-05): a managed switch/AP in the walked domain is reached through vlanSubnetOn (its management subnet on a VLAN whose domain holds it), not the VLAN-blind shared-subnet test; a routing device walks a subnet with no VLAN as REACH_UNTAGGED (crossing ends that record nothing, access ports and trunks with a native VLAN, never a tagged-only trunk) instead of VLAN-blind, so an undeclared WAN no longer lights every trunk's VLANs; a retired start's status line names no VLAN. Out of scope as specced: STP, VTP/pruning, private VLANs, QinQ, voice VLAN by LLDP, native-VLAN tagging. (done 2026-11-04)

## Document versions

- v16 landed with capacity stage 4 (2026-11-04); reports stage 1 (doc.searches), inventory stage 1 (nodes[].vendor/model, os relabelled 'Firmware / OS') and vlan stage 1a (portAttrs.pN.tagged/poe, interfaces[].vlan/tagged, nodes[].poeBudget/poeDraw) were folded into the same step and log entry, because all four landed in one unpushed series, so the next free version is 17 and no further bump is planned. Before that: today DOC_VERSION is 15 (js/model.js:4227) and the last step is 14→15 (:4371). First add the missing 'v 15' entry for providers to the version log (:3794-3886).
- No bump: locate (a view), history (browser IndexedDB 'nettopo_trail', never in the document), and capacity stages 1-3 (derived only).
- One bump was needed in the end (four data stages, all four folded into v16; two were planned), a no-op step '{from:N,to:N+1,run:(doc)=>({...doc,v:N+1})}' with a log entry saying what an N-1 build would drop:
  - v16 (landed): capacity stage 4 (networks[].dhcpFirst/dhcpLast), reports stage 1 (doc.searches; 'searches' in isDocShape's list keys), inventory stage 1 (nodes[].vendor/model, os relabel only) and vlan stage 1a (portAttrs.pN.tagged/poe, interfaces[].vlan/tagged, nodes[].poeBudget/poeDraw), one step and one log entry;
  - v17: no longer needed (vlan stage 1a was folded into v16); the number is free for the next format change.
- Allocate the number at landing time, never in the spec: each spec's 'v16' text becomes 'next free version'.
- If two of these data stages land in the same unpushed series, they may share one step and one log entry. Once a step is pushed (live on topo.carino.systems) it is never edited, and the next feature appends N+1.
- Every bump stamps every saved file (serializeDoc writes v: DOC_VERSION). A cached or offline older build therefore opens all new files read-only, even ones that use none of the new fields. That is accepted policy, but it is a reason not to spread the bumps over many separate pushes.
- Each bump ships with these tests:
  - compat/schema: an N-1 file opens as N with byte-identical content when the new keys are absent;
  - brokenlink.js:77 pattern: an N+1 file opens read-only;
  - a sealed-link round trip;
  - once two or more bumps exist, one chain test that opens a v15 fixture at the final version unchanged.

## Decisions taken (defaults, owner may change)

- **Locate.** No new "where each device is plugged in" table in the technical report; the Locate print sheet covers it. Key **W**. The Simple view says "wall socket" where the Full editor says "jack label".
- **Locate.** Multi-hop follows only a wired uplink from an access point reached by radio; AP-to-AP radio links stop with the gap "which access point is upstream is not recorded".
- **Capacity: DHCP pool handout (owner chose option C, 2026-11-05).** When a subnet's DHCP pool counts (dhcpPoolOf().valid), Add devices, bulk Move and a single device dropped onto a switch keep the fixed-address device types (FIXED_ADDRESS_TYPES in js/model.js: router, firewall, l3switch, edge, vpn, loadbalancer, cloud, switch, ap, server, printer, camera, dicom) out of the pool: the lowest free address outside it, and the pool only when nothing is left outside, which the preview warns about. Clients (pc, voip, iot, vm, container, custom) take the lowest free address as before, pool or not. The Add devices and bulk previews name who was kept out (poolDealer in js/model.js, dealPool/poolNotes in js/add.js). With no pool, or one that does not count, handout is byte-identical to before (tests/suites/addpool.js on every template). Blocks need nothing: readdressBlock moves a block's subnets to a free range, so they never land in a pool. Still no per-interface "fixed / DHCP" field. Thresholds are constants (10% free, at least 1 port or 2 addresses).
- **Capacity.** No separate Ports table: the port map lists every switch and AP (cable-less ones too) with used/total/free; the Capacity section holds addresses (and PoE budget once VLAN/PoE lands).
- **Reports (owner, 2026-11-04).** "Make ports table optional, we will make check marks for more specific reports now, including inventory, cable, etc." The Capacity Ports table stays, as an optional table off by default (this replaces the Capacity decision above and settles its open question). The report dialog has a tick per technical-sheet section (REPORT_SECTIONS in js/report.js: findings, providers, diagram, devices, inventory, racks, ports, cables, wifi, addressing, vlans, capAddresses, capPorts, capPoe, searches, changes), all on but capPorts, under Technical details, site and binder alike; reportParts.sections carries them (unknown keys ignored, absent = default), so callers that pass nothing print as before minus the Ports table. Start from defaults each time the dialog opens: nothing is remembered (the dialog persisted nothing per visit; Settings' report defaults hold only the two part ticks). The summary stats and Scope and method always print; the Simple summary is untouched. A key 'history' is reserved for the Address history section (off, no tick yet). (done 2026-11-04) The 'history' key got its tick with history stage 5 (off by default; no longer reserved). (done 2026-11-05) Review follow-up: the binder cover's estate findings, addressing and topology follow the Findings, Addressing and Topology ticks; a report printed or downloaded with neither the summary nor Changes leaves a kept network's report baseline where it was (reportShowsChanges), so no change goes unreported; the Large map's note prints under a Topology heading when Topology is unticked; the Ports table's intro drops its pointer to Switch ports when that section is unticked. (done 2026-11-05)
- **Inventory.** The split of old "Model / firmware" text is offered from the Table toolbar and the device editor only, no banner. "Makes and models" stays in the technical report. Vendor suggestions cover only the ~35 vendors in js/oui.js (shared with Hardware; no Topo-side table).
- **VLAN/PoE.** A port or NIC with no VLAN recorded carries every VLAN, so no existing file gains findings. Over the PoE budget is critical; 90-100% is a capacity note. The Trace VLAN filter is on by default.
- **VLAN/PoE.** **Needs the owner:** managed switches (a switch with a management IP) should forward L2 in the reachability walk. Today they do not (reachL2Domain/isDumbDevice), so VLAN checks would be dead on managed networks. It changes today's Trace and gateway findings on such files, so it lands as its own change only after the owner agrees. (Resolved: landing order step 6, done 2026-11-04.)
- **History.** Never travels: kept in this browser only, not in files, links, binders or sheets. Recording is on by default, with an off switch in Settings. Full editor by default; the Simple views show it only on request (below). No history.csv. The report section (stage 5) was built on the owner's call (2026-11-05, "Do build optional address history"): off by default behind the report dialog's Address history tick, so a report prints the trail only when someone ticks it.
- **History in the Simple views (owner, 2026-11-05).** "Add optional history on simple view." This settles history's open question on the Simple view: optional, off by default. Settings' History section (the recording switch) shows in every view, not only Full, and gains **Show address history in Simple view** (state.settings.trailSimple, saved only when on, followed across tabs like the recording switch). Ticked, the reduced views' device panel shows #historySimple after the Locate sentence: plain read-only sentences, newest first ('Was 192.168.1.20 until 2026-10-03.', plugged into, in, called), at most four then 'Earlier changes are in the Full editor.'; no MAC, no was: buttons, no Forget or Clear, no kinds, no edit and no undo step; dates by localDateOf as in the Full section. Unticked, the reduced views, SIMPLE_SAMPLES and every report are as before; the Simple summary never prints history either way. (done 2026-11-05)
- **Reports.** Saved searches print in the technical sheet only, are not counted in "changes since the last back-up" (they are a view), and are capped at 30 per network. Browser-local terms (was:, has:history) cannot be printed.
- **Order.** These go ahead of the mobile review batches (M1-M60, [docs/MOBILE.md](MOBILE.md)) because the owner asked to start them on 2026-11-04; phone layouts of each new UI are still checked at 360 and 390.

## Cross-feature collisions (resolved)

- uplink helper, two names for one refactor: locate wants csvUplink (js/csv.js:279) and patchPoint (js/bulk.js:322) merged into uplinkOf(node,{skipNoPort}) in model.js, reading state. history wants the same choice lifted into a pure uplinkIn(node, linksByNode, nodesById, forSheet) that works on a document. Ship one helper: uplinkOf(node, {skipNoPort, links, nodes}), defaulting to state, landed once by whichever feature goes first, and have both specs reference it.
- Device panel slot: locate (#locateGroup) and history (#historyGroup) both go 'right after #assetGroup' (index.html:537). Fix the order as Asset, then Locate, then History, with separate localStorage open-state keys next to ASSET_OPEN_KEY (js/assets.js:173).
- #queryTools / #queryBar crowding: locate adds a 'Locate' button, and reports adds a star 'Save search' to #queryTools plus a 'Saved' menu button to #queryBar (index.html:901-915). At 360px that makes Zoom + Select + Locate + Save beside the count. One layout decision is needed (an overflow menu, or wrapping) and it should be tested once, not per feature.
- Report technical sheet slot: capacity ('Capacity' after Addressing, before Changes), reports ('Saved searches' after Addressing, before Changes) and vlan ('VLANs' after Subnets/Addressing) all claim the same gap in reportSheet (js/report.js:1918-1921). Fix it as Addressing, then VLANs, then Capacity, then Saved searches, then Changes.
- Simple summary 'What you have' (js/report.js:1772-1810): locate adds socket text to the device list's Where cell, capacity adds a 'Room to grow' paragraph and inventory adds a 'Makes and models' list. All three land on the one-page summary with no shared budget. The Where cell also appears only when anyPlace (js/report.js:1779), so a device that has a socket but no place shows no Where column at all.
- reportPortMaps (js/report.js:609-675): capacity re-sources used/total from portCapacity and wants the switches it drops at :674 (.filter(m => m.rows.length)), and vlan adds Tagged/PoE columns plus a 'PoE: x of y W' heading in the same function and in portMapsSection. Capacity's separate Ports table then duplicates the port map's used/total/free. Better to stop dropping cable-less switches in the port map and keep only the Addresses table under Capacity.
- Port 'used' semantics: capacity's portCapacity counts bond ports as used (like freePorts, js/model.js:2104), but evaluatePorts (js/diagnostics.js:305-307) and portUsage (js/report.js:103) count only pN ids that have a cable. The inventory 'Ports: u/t' line, the node panel's good line and the capacity note would disagree unless evaluatePorts reads portCapacity too, and the spec does not change it.
- NODE_FIELDS order, devices.csv header: inventory inserts vendor and model before os (js/model.js:1401) and vlan inserts poeBudget/poeDraw after portAttrs (:1444). Both shift csvDevicesSheet columns (csvNodeFields order), so both break the same fixed-header assertions in csv.js/schema.js. Land them one after the other and update the expected headers once per feature.
- CSV aliases: vlan proposes a bare 'poe' alias for pt:poe, which the csv.js:530-532 rule forbids ('Not a bare "vlan" or "jack": an inventory with a VLAN column … would turn into a sheet of ports'). An asset inventory with a PoE column, or inventory's devices.csv with poe_draw, would be classified as a ports sheet. Inventory also moves 'model'/'modelo' off os (csv.js:525), so a vendor spreadsheet headed 'Model' changes destination. Both features edit CSV_ALIASES, PLAIN (csv.js:889) and apartKeys (csv.js:1403).
- Search language: Q_HAS (js/query.js:185) gains full (capacity), vendor/model/fw (inventory), trunk/poe (vlan) and history (history), and Q_PREFIXES gains vendor/model/fw plus the make/firmware/os aliases (inventory) and was (history). The keys do not collide, but all of them edit the same object, the same header comment and the same input tooltip (index.html:905), which none of the specs updates.
- history x reports: a saved search such as 'was:10.0.0.5' or 'has:history' printed in the site report or a binder makes the report depend on one browser's local trail. That breaks history's own rule that the report is byte for byte the same and recipient-independent, and a shared file's saved search would match differently in each browser. Reports must refuse, or mark and skip, browser-local terms when printing.
- DOC_VERSION 16 is claimed by four specs: capacity stage 4 (dhcpFirst/dhcpLast), inventory stage 1 (vendor/model), vlan stage 1a (tagged/poe/poeBudget/poeDraw/iface vlan) and reports stage 1 (doc.searches). All four write '{from:15,to:16}' and 'v 16' in the version log (js/model.js:3794-3886).
- locate x vlan: locate's leg reads portAttrOf(far,pN).{label,vlan} (js/model.js:215). Vlan widens portAttrOf to {label, vlan(untagged), tagged, poe}, so once vlan lands, locate's VLAN step must say untagged or tagged, and locate's cross-check list of findings that matter (duplicate MAC/IP, two cables on a port) should gain vlan-mismatch and poe-none.
- capacity x vlan: capacity's port-capacity info note and vlan's 'PoE 90-100% of budget' info note are two separate capacity notes on the same switch, built by two different finders. Put the PoE near-budget note in capacityFindings and the PoE budget in the Capacity section, or decide explicitly to keep them apart.
- inventory x report devicesSection: inventory replaces the single 'Model / firmware' report.column with a joined 'Model' (vendor + model) plus 'Firmware / OS'. reportColumns()/reportFieldsOf (js/report.js:356-364) print one schema field per column, so the join needs a special case, and vlan wants a 'PoE 6.5 W' entry in the same row's extra line (js/report.js:1407-1411).

## Gaps the specs had to cover

- Status gate (the list itself, rebuilt 2026-11-06 after Topo/CLAUDE.md and the memory note were lost, is [docs/MOBILE.md](MOBILE.md)): Topo/CLAUDE.md said 'no more features for now … the mobile review (M1-M60) comes next', and memory topo-review-2026-10-31 says the same. The user's 'add them to the backlog and start doing them' adds these to the backlog. Implementation should confirm whether they go before or after the M1-M60 batches, especially for the four that add phone UI (locate, reports, vlan port editor, inventory table tab).
- The version log entry for v15 (providers) is missing from js/model.js:3794-3886. Add it before any v16 entry.
- A prerequisite fix that no spec owns: managed switches forward L2 in the reachability walk (reachL2Domain/isDumbDevice). Without it, vlan-path is dead on managed networks, and Trace already under-reports today. It needs its own suite (trace.js) and the owner's agreement, because it changes today's Trace and gateway findings on files that have a switch with a management IP. (Resolved: landing order step 6, done 2026-11-04.)
- Search discoverability: the #queryInput tooltip (index.html:905) and the How-to-use cheatsheet list prefixes, and no spec updates them for vendor:/model:/fw:/was:/has:full|trunk|poe|history, or their i18n.
- Upgrade path tests for the chain: each bump needs compat/brokenlink tests where a vN-1 file opens as vN and a vN+1 file opens read-only (brokenlink.js:77 pattern). When bumps stack (16, 17, 18), one test should open a v15 file through all of them, and sealed links (groupseal/wifiseal pattern) are only specified for vlan.
- CSV: vlan changes the ports sheet's fixed header (csv.js:420), which rackschedule/csv suites may assert. An older ports.csv without port_tagged/port_poe must still import, and that is untested. Vlan's interfaces sheet gains a 'vlan' heading that the sheet-kind classifier may read as subnet or network data; untested. Reports' searches.csv needs a csvSafety (formula guard) test for the query cell, which can start with '-' or '='.
- i18n: inventory needs a new 'Firmware / OS' key in four locales. Capacity and vlan need Russian three-form plurals checked against tests/suites/plurals.js. Locate's 'wall socket' term must be fixed once for all four locales before Simple strings are written. No spec lists its new MESSAGES vs I18N split, apart from reports.
- Simple view: capacity's info notes and vlan's PLAIN_FINDINGS reach Simple only on Full-built files, and there is no Simple test for capacity (an info note must not break the SIMPLE_SAMPLES 'no finding at all' promise, FEATURES.md:86). Locate's Simple sentence has no test at 360px. The summary has no shared one-page budget test for locate's socket text, Room to grow and Makes and models together.
- Report/binder: capacity's Capacity section and inventory's inventorySection have no binder test (binder.js), and both are built in reportModelNow, which must run inside withDoc per site. Neither has a reportdate test, although capacity info notes count the documented state and the firmware finding is diagnosis-memoised by date.
- Perf budgets: only locate and history name the 300-device fixture (tests/fixtures/site300.js). Capacity's capacityFindings, inventory's firmwareFindings, vlan's per-cable vlan-mismatch plus the vlanPath BFS, and reports' O(searches x devices) report build have no perf.js extension, and vlan stage 3's per-VLAN L2 walks are the biggest risk.
- Changes since back-up: the relabel of os changes the label printed for an os edit. Vlan's portAttrs relabel ('Port labels, VLANs and PoE') does the same, and so do new iface fields (interfaceChanges). No changes.js test is listed for capacity's pool fields (NETWORK_FIELDS labels 'DHCP first/last').
- Accept identity: capacity's port-capacity finding has nodeIds [switch], so accepting it never reopens when a port count changes; the spec says it does, but entryCovers matches by key + ids + scope. A scope (for example the port count) is needed for that claim to hold. Inventory's firmware scope is the model key cut to 64 characters, which could make two long model names collide.
- History: no test that a binder back-up (library.js:940, takeSnapshot per card) records every site within a budget, and no handling of the two-tab merge beyond the risk note. A read-only network: takeSnapshot itself does not check readOnly, so the recorder must check it.
- Locate: the multi-hop direction for mesh/AP-to-AP and switch-to-AP needs a rule, because the register records none. Either stop at the first port-grid device reached by radio with a named gap ('which AP is upstream is not recorded'), or use the wired cable only.

---

## 1. locate

### Locate: where a device is physically plugged in

Type or pick a device by name, IP, MAC or asset tag and Topo shows where it is plugged in: its NIC, the cable (tag, colour, length, via text as written), the switch or AP port with its jack label, then that box's rack units, room, floor and building from its groups. Over Wi-Fi it goes one more step, from the AP to the switch port the AP is on. Locate works this out from what is already recorded, so it adds no fields, stores nothing and needs no new file version. Any link the register does not hold is shown as a named gap ("no port picked at SW-2", "no jack label"), never filled in by a guess.

**Already in Topo**

- Where a cable lands on a switch/AP: csvUplink(node, forSheet) js/csv.js:277 and its near-duplicate patchPoint(node) js/bulk.js:322 both pick the first cable onto a hasPortGrid peer (js/model.js:41: switch or ap only)
- Port names and jack labels: portNameOf js/model.js:208, portAttrOf (label, vlan) js/model.js:215, ifaceLabel js/model.js:147 (a pN past the faceplate still reads as a number); the comment at js/model.js:155-170 says the label is 'the jack or the desk at the other end of the run'
- Cable facts: cableOf(link,'label'|'color'|'length'|'via') js/model.js:1622; via is free text (LINK_FIELDS js/model.js:1606, csv 'cable_via'), e.g. 'PP-A:12 > WJ-3B' (docs/FEATURES.md:26)
- Physical place: nodePlaceText js/model.js:3286 (group path + rackSpanText), groupPathOf js/model.js:3281, groupChain js/model.js:2902, rackSpanText js/model.js:3089 (reads the outermost host's units for a VM/container via hostRootOf js/model.js:3459), rackOfNode js/model.js:2970
- Wireless ends: wifiLinkEnds js/model.js:2643 ({ap, client}, null when not wireless, neither end ranked between two clients), effectiveMedium js/model.js:515, linkWifiSsid
- Rack hand-off: openRackView(id) js/rackview.js:166 and rvTraceCable(id) js/rackview.js:1715 (One cable mode, ends scrolled into sight); rackScheduleEnd js/model.js:3274 already words an end as 'SW-1 · 24' / 'PC-12 · no port'; openCablePorts(link) js/rackview.js:1912 is the existing 'Pick a port'
- Finding a device by text: the search language js/query.js (name:, ip:, mac:, tag:, plain text; parseQuery js/query.js:369, queryMapMatches, updateQueryBar js/query.js:529 with queryCount/querySelectBtn/queryZoomBtn index.html:909-913)
- Asset link: openAssetLink(tag) js/assets.js:506 selects the device a printed QR label names; applyArrivalFocus centres it
- Printing a small self-contained sheet: labelsFor/labelsHtml + deliverReport(html, meta, kind) js/assets.js:564-640, js/report.js:2072
- Shortcut table SHORTCUTS js/app.js:2287 (T trace, F, A, L, 1-3, /, 0, +/-, Del, Ctrl+A, Esc, ?): W is free; simpleHidden flag for keys
- Trace (Diagnostics tab, index.html:721, calculateReachability, updateTraceStatus js/diagnostics.js:1003) is reachability only; Locate stays separate from it
- Selection/focus: select js/ui.js:2545, selectEntries, focusOnMap js/ui.js:2412

**Data model**

None. Locate is a view, worked out from fields that already exist (links with sourceIface/targetIface, link.cable.{label,color,length,via}, node.portScheme/portAttrs, node.group, rackU/rackFace, hostOf chain, link.wifi). DOC_VERSION stays 15 (js/model.js:4227), so there is no upgrade step and no CSV column. A file from any version that opens today can be located. A read-only newer file can be located too, since nothing is written. state is not touched beyond the existing selection: there is no state.locate in the document, history.state, the share seal or changes.js tracking. The only thing kept is one per-browser localStorage key for whether the Locate section is open, wrapped in try/catch like ASSET_OPEN_KEY (js/assets.js:177-180). One code change counts as a refactor, not a data change: csvUplink and patchPoint merge into one pure model helper, uplinkOf(node, {skipNoPort}), in js/model.js, which both callers then use. The devices sheet's switch/port columns must stay byte-identical, and the csv and bulk suites check that.

**Interface**

Core, pure and in js/model.js next to rackSchedule: locatePath(node, {nodes, links, groups}) returns { start, legs: [leg], gaps: [gap] }. Steps:
1) A VM or container first adds a 'runs on' step up hostChainOf to its outermost host (it has no cable of its own in the rack sense, per rackSpanText).
2) Every wired or wireless link at the device is a candidate leg; a bonded server or a dual-homed box shows one leg per cable, the uplinkOf one first. VPN legs are skipped.
3) Each leg is { nic: ifaceLabel(own end), cable: {tag, color, length, via}, far: device, farPort: ifaceLabel or '' , jack: portAttrOf(far, pN).label, vlan, medium, wifi: {band, signal, ssid} when the link records or infers them, place: {groups: groupChain(far), rack, units: rackSpanText(far)} }.
4) Multi-hop: when the far end is not a faceplate device (hasPortGrid), or is an AP reached by radio, follow that far device's own uplinkOf. This covers a PC behind an IP phone, a laptop on Wi-Fi to an AP then the AP's switch port, and a mesh AP to its root AP. The walk stops at the first switch reached by a wire, at a routing device (isRoutingDevice), after 4 hops, or on a device it has already visited (a loop), and says why it stopped. It never walks switch-to-switch uplinks: that is topology, which Trace and the map already show.
5) Gaps are typed records, never guesses:
- noCable: no link recorded.
- noPort: a cable is recorded but no port is picked at the switch. This is the rack view's no-port spot, and it offers Pick a port via openCablePorts.
- noJack: a port with no label.
- noVia: a cable with no via written. Shown quietly, since many runs are direct patches.
- notGrouped: the far device is in no group. Its typed location (node.location) is shown if there is one, labelled as typed text.
- notPlaced: in a rack but rackU is not set; it reads as 'Not placed yet' in the rack's words.
- radioUnknown: wifiLinkEnds gives no AP (two clients or a bridge), so Topo cannot say which side serves.
- retired: the start device or a hop is status retired; it is shown dimmed, and the walk continues because a retired device still has a physical place.
The via text is printed exactly as typed and is never split or reordered, because Topo cannot know which end of 'PP-A:12 > WJ-3B' faces the device.

Full editor (#advanced):
(a) A collapsible section 'Locate' in the device's Config panel, right after the Asset details (index.html:537). It is a <details id="locateGroup" data-adv> and its open state is remembered per browser. It shows the chain as a vertical list of steps: device NIC, then cable, then port with its jack, then rack units, then the group path (each group kind and name). Each gap shows as a muted line saying what is missing. Each step is a button: a device step selects that device; a cable step selects the cable; 'Open in rack' calls openRackView(rack.id) then rvTraceCable(link.id); a noPort gap offers 'Pick a port'. 'Show on map' puts the path's devices and cables into the selection (selectEntries, one view action, not an undo step) and fits them in view.
(b) Key W, 'Where is it plugged in?', added to SHORTCUTS with simpleHidden false. With a device selected it opens and scrolls to the Locate section. With nothing selected it focuses #queryInput, as / does.
(c) The search box: when the active query matches exactly one device, #queryTools gains a 'Locate' button next to Zoom/Select that selects the device and opens the section. That way name, ip:, mac: (hex or OUI vendor), tag: and plain text all work through the existing language. With several matches the button is disabled with the tooltip 'Narrow the search to one device'; Topo never picks the first match. A MAC typed as plain text already matches whatever separators it has (query.js header).
(d) Several devices selected: the bulk rail gets 'Print where they are plugged in'.

Simple view (#simple/#imagenology): the device panel gets one translated, read-only plain sentence built from the same locatePath. Examples:
- 'Plugged into the Office switch, socket 12 (wall socket Reception 2), in the Server room.'
- 'On Wi-Fi through Living room AP, which is plugged into Switch, socket 4.'
- 'Not plugged into anything yet.'
Gaps use plain words such as 'Which socket is not written down.' There is no via, no VLAN and no rack units in Simple. Groups appear only by name, because Simple has no Groups tab, but documents made in Full show their rooms.

Asset link: openAssetLink already selects the device. Additionally, a #asset/<tag> arrival opens the Locate section (full) or shows the sentence (simple), so scanning a QR label on a box answers 'where is this plugged in'. It stays inside the browser and no fetch is added.

Printing: Print in the Locate section, and the bulk button, go through deliverReport(locateHtml(rows), {site, date}, 'locate'). This is one self-contained page, like labelsHtml (no outside font or stylesheet), with one block per device: name, tag, address, MAC, then the chain and its gaps, under the network's name and date. Phone: the section is a single column, the step buttons are at least 44px, long via and group paths wrap with no horizontal scroll at 360 and 390, and the dark and Colourful themes use existing tokens.

**Checks**

None. Locate raises no new finding and changes no count. Every gap it shows is either already a finding or is not a fault on the network: a cable with no port at the switch is already the rack view's no-port case; untagged cables in a rack are already the info-only count; a duplicate cable label or asset tag is already a finding. A missing jack label or via is incomplete paperwork, not a problem, and adding it to the findings would put noise on every sample. One cross-check: where a step's device carries open findings that matter to Locate (duplicate MAC or IP on the start device, two cables on a port that takes one at the far port), the step shows the existing finding's mark and text from diagnoseDoc. That way a duplicate MAC is flagged as ambiguous, not hidden. The findings are read, never re-derived.

**Report**

Simple summary (one page in plain words): the device list already gives 'where they are' (nodePlaceText). For end devices, that line gains the socket in Simple words when the register holds one, e.g. 'Server room · Office switch, socket 12 (Reception 2)', and nothing when it does not. There is no new section, the one-page limit and the 60-device kinds-only rule stay as they are, and the date logic is untouched. Technical details: no new section by default. The port map per switch/AP (labels, VLANs, free ranges) and each rack's patch schedule already print both directions of the path. An optional third table, 'Where each device is plugged in', is an open question for the owner (see open_questions); if it is wanted, it reuses locateHtml's rows under each group heading, after Connections. The separate Locate print sheet (above) is the on-site printout.

**Translations**

About 35 new strings. Full editor: the section and button labels stay English like the rest of Full's vocabulary ('Locate', 'Open in rack', 'Show on map', 'Pick a port' already exists). The gap sentences, the tooltip, the W cheatsheet line and the print sheet are translated, as Full's sentences and findings are. Examples: 'No cable recorded.', 'No port picked at {switch}.', 'Port {port} has no jack label.', 'No via written for this cable.', '{device} is in no group.', 'In {rack}, not placed yet.', 'Which side is the access point is not recorded.', 'Stopped after {n} steps.', 'Narrow the search to one device', 'Where is it plugged in?', 'Print where they are plugged in'. Simple: about 12 plain sentences with placeholders, e.g. 'Plugged into {switch}, socket {port}.', '(wall socket {jack})', 'On Wi-Fi through {ap}.', 'Not plugged into anything yet.', 'Which socket is not written down.' Tricky ones:
- The trade word for a wall jack or socket: es 'roseta'/'toma de red', pt-BR 'ponto de rede'/'tomada de rede', ja '情報コンセント' (with Japanese saying 'PC' for computers), ru 'розетка'. Use one term consistently.
- Word order with three placeholders in ja and ru: keep each step its own sentence rather than one long concatenation.
- Plural 'Stopped after {n} steps' needs the singular form ('a count of one reads in the singular', FEATURES.md:9).
- The via text and port names are data and are never translated.

**Files**

- js/model.js: add uplinkOf(node, opts) (moved out of csvUplink/patchPoint), locatePath(node, opts), locateGapText/locateStepText (Full wording) and locatePlainSentence (Simple wording); add them to the lookupPass memo pattern used by rackCableLinks so a 300-device selection prints within the scale budget
- js/csv.js: csvUplink becomes a thin wrapper over uplinkOf(node, {skipNoPort: forSheet}); the output must not change
- js/bulk.js: patchPoint uses uplinkOf (the natural sort over peer name and port is kept)
- index.html: <details id="locateGroup" data-adv> after #assetGroup (index.html:537); a Simple-only <p id="locateSentence"> in #nodeGeneralProps; a 'Locate' button in #queryTools (index.html:909-913); 'Print where they are plugged in' in the bulk rail
- js/assets.js (or a new js/locate.js loaded after rackview, before query, following the load-order note at js/query.js:73): renderLocate(node) called from renderSidebarData (js/ui.js:1767), localStorage open state, the step click handlers (select, selectEntries, openRackView + rvTraceCable, openCablePorts), locateHtml and printLocate via deliverReport; openAssetLink (js/assets.js:506) opens the section after select
- js/query.js: updateQueryBar (js/query.js:529) toggles and enables the Locate button on exactly one device match (n from _queryLastMap.nodes; on the table, only the Devices tab)
- js/app.js: a SHORTCUTS entry for W (js/app.js:2287) and its How-to-use cheatsheet line
- js/report.js: the Simple summary device line gains the socket text from locatePlainSentence parts (only where there is a port or jack)
- css/app.css: .locate-steps list, gap lines, 44px step buttons, wrapping
- js/i18n.js: the new strings in es, pt-BR, ja, ru
- docs/FEATURES.md (a Locate bullet under The register or Checks, next to Trace at line 38), README.md feature map, tests/README.md table rows

**Tests**

- New suite tests/suites/locate.js plus its row in tests/README.md.
- (1) Pure locatePath on the Data Centre and Showcase samples: a server in a 42U rack gives NIC, cable tag, switch port name from portScheme, jack label from portAttrs, then rackSpanText and the full groupChain. A bonded server gives two legs, the uplinkOf one first. A VM gives 'runs on' to its host, then the host's legs.
- (2) Wi-Fi multi-hop on the Smart Home: TV, Wi-Fi band/SSID as recorded or inferred (linkWifiSsid), the AP, the AP's cable, the switch port. A mesh AP to its root AP goes on to the switch. Two wireless clients give radioUnknown and stop.
- (3) PC behind an IP phone: PC to phone to switch port. A loop of non-switch devices stops with 'already visited'. A depth cap of 4 stops and says so.
- (4) Every gap type in turn: no cable, a cable with no port at the switch (with Pick a port offered, and opening it does what openCablePorts does), a port with no label, no via, a far device in no group with and without a typed location, in a rack with no units, and a retired hop. Assert no gap is ever replaced by a guessed value: for example, a blank port never reads as port 1, and the via is printed byte for byte, never split.
- (5) Refactor guard: csvDevicesSheet switch/port/local_port cells and BULK_ORDERS.port order are identical before and after uplinkOf on every template.
- (6) UI: the section renders for a selected device and is hidden in reduced views. W opens it with a selection and focuses the search box without one. The search Locate button is enabled only on exactly one match (tag:, mac: with odd separators, ip:) and disabled with the tooltip on two. Step clicks select the device or cable; Open in rack lands in One cable mode on that link. Locate adds no undo step, a document diff before and after is empty, and the changes count is unchanged.
- (7) Simple: #simple shows the plain sentence and no via or VLAN. #asset/<tag> arrival opens the section (full) or the sentence (simple).
- (8) Print: locateHtml for a 3-device selection holds every step and gap, with no external URL in the HTML (same assertion style as labels).
- (9) Report: the Simple summary device line gains the socket only when known.
- (10) i18n: every new string present in es, pt-BR, ja and ru (the i18n suite's missing-key check), and the singular form for one step.
- (11) Scale: locatePath over every device of the 300-device fixture stays within the perf suite's budget.
- Extend tests/suites/smoke.js so every template and block can locate every device without throwing.

**Stages**

- 1. Pure core: uplinkOf extracted with csvUplink and patchPoint on top of it and no change to their output, then locatePath with typed gaps, plus locate.js parts 1-5 and 11. Nothing visible changes.
- 2. Full editor: the Locate section in the device panel (steps, gaps, select, Show on map, Open in rack, Pick a port) and the W key, with the Full-side i18n strings and tests part 6.
- 3. Search and asset link: the Locate button in #queryTools on exactly one match, and #asset/<tag> opening the section. Tests part 6 (search) and part 7 (asset).
- 4. Simple view: the plain sentence in the device panel and the Simple summary socket text, with the Simple i18n strings and tests parts 7 and 9. Also switch the W shortcut (js/app.js SHORTCUTS) from simpleHidden: true to false, as (b) says: stage 2 shipped it hidden in the reduced views because they had nothing for W to show yet, and the locatepanel suite's 'W does nothing there' check must change with it.
- 5. Print: locateHtml/printLocate from the section and the bulk rail, tests part 8, then docs/FEATURES.md, README and tests/README rows. Browser check at 360, 390 and 1280 in both themes.

**Risks**

- Topo/CLAUDE.md says 'The owner said no more features for now… the mobile review (M1-M60) comes next', and the memory note topo-review-2026-10-31 says no more features. The user's relayed request ('add them to the backlog and start doing them') may override that, but whoever implements this should confirm it is not jumping ahead of the M1-M60 batches.
- Refactoring csvUplink and patchPoint touches the CSV round trip, which must stay lossless, and the bulk port order. Stage 1 must prove the output is byte-identical on every template before anything uses uplinkOf.
- hasPortGrid is switch or ap only (js/model.js:41), while query.js counts l3switch as a switch (Q_SWITCH_TYPES js/query.js:266). Locate follows hasPortGrid, so a device cabled into an l3switch or router reads 'plugged into R1 · eth1' with no jack label, and the walk stops there as a routing device. That is correct, but it may surprise users. The tests should hold this behaviour so nobody 'fixes' it by guessing.
- Multi-hop through non-switch devices could invent a physical meaning a drawing never intended, such as a map that draws a PC 'connected' to a server as an abstract line. Mitigations: the depth cap, stopping at routing devices, labelling each hop with its medium, and never claiming 'same room' unless a hop's own groups say so.
- Locate's choice of primary leg must agree with the devices sheet's switch/port columns (both use uplinkOf), or the sheet and the panel would disagree.
- The phone layout of a long chain in the rail: wrap, do not scroll, at 360px.
- Work in Simple view stays read-only, so Locate adds no new edits to the reporter path.

**Amendments (from the cross-check; these win over the text above)**

- locate: 'csvUplink js/csv.js:277 and its near-duplicate patchPoint … both pick the first cable onto a hasPortGrid peer'. csvUplink is at js/csv.js:279, and neither function picks the first cable. Both pick the lowest-named port-grid peer by naturalCompare, then the lowest port. They also differ: csvUplink with forSheet skips a wired cable with no port (csv.js:285) and returns {peer, port: ifaceLabel, own}, while patchPoint (bulk.js:322-332) never skips, compares peer.name||peer.id, and returns {peer: string, port: number}. A merge has to keep both behaviours behind options, so it is not a pure move.
- locate step 4 / tests (2): 'a mesh AP to its root AP goes on to the switch' via the AP's uplinkOf. uplinkOf on a port-grid device returns its lowest-named port-grid neighbour (csv.js:282-289), which can be a downstream switch or a mesh child AP rather than the uplink. wifiLinkEnds (js/model.js:2649-2650) ranks two APs equally and returns the link's source as 'ap', so which AP is the root is not recorded. The walk direction is not derivable from what the register holds.
- locate: 'radioUnknown: wifiLinkEnds gives no AP (two clients or a bridge)'. wifiLinkEnds ranks a routing device as the serving side (rank 1, js/model.js:2648), so a laptop on a wireless router gets ap = router, never radioUnknown. Two APs (a bridge) also return an AP, the source end. radioUnknown only arises between two non-AP, non-routing ends.
- Replace 'both pick the first cable' with the real rule: lowest-named port-grid peer, then lowest port. uplinkOf must keep csvUplink's forSheet skip and patchPoint's name||id fallback behind options, and return {peer, link, portId, label, own}. Make it doc-capable ({links, nodes}) so history can share it.
- Multi-hop: follow only a wired uplink from an AP reached by radio. For AP-to-AP radio links (mesh/bridge) stop with a new typed gap, 'which access point is upstream is not recorded', because wifiLinkEnds returns the link's source for two APs. Rename radioUnknown's trigger to 'neither end is an AP or routing device' (js/model.js:2648-2649).
- Fix the Simple summary's Where column so a device with a socket but no place still shows it (anyPlace, js/report.js:1779). After vlan lands, show the untagged/tagged VLAN in the leg and add vlan-mismatch and poe-none to the findings that matter in the cross-check. Agree the #queryTools layout with reports, tested at 360/390.

**Open questions (defaults in "Decisions taken")**

- Should the Technical details report gain a 'Where each device is plugged in' table, or is the port map plus each rack's patch schedule enough? Default proposed: no new table; the Locate print sheet covers on-site use.
- Is W the right key, or should Locate be reached only from the panel, the search box and the asset link?
- Should the Simple view say 'wall socket' (plain words) where Full says 'jack label'? This sets the term in all four translations.

---

## 2. capacity

### Capacity reports: address use per subnet (with a DHCP pool) and port use per switch

Each subnet can record its DHCP pool (first and last address). Topo then shows how much of the subnet is used and free, split into pool and fixed addresses. Each switch or access point whose port count is known shows used and free ports, and gets a note when it is nearly full. All of it is worked out from what the register already says: one shared helper per side feeds the Subnets card, the table, the findings, a new Capacity section in the site report and one plain line in the Simple summary. Nothing is probed, and Topo never claims to know DHCP leases it was not told about.

**Already in Topo**

- Subnet use numbers: networkStats(net) at js/model.js:2119 returns used / size / free / next. size and free are null past 2^24 addresses, so IPv6 is shown as 2^bits. The Subnets card shows '{used} of {size} used · {free} free · next free {ip}' (networkCardHtml, js/networks.js:83-95).
- Usable host range: usableRange(p) at js/model.js:2056 (RFC 3021 /31 and /32, and IPv6 without its anycast address). takenAddresses(net) at js/model.js:2069 also counts the subnet's gateway and DNS, and leaves out retired devices.
- Inconsistency to fix: networkStats.used counts members' addresses only (js/model.js:2123-2127), while nextFreeAddress/freeAddresses skip the gateway and DNS too (js/model.js:2069-2097). With a gateway that is not drawn, 'free' is one higher than what Add devices can actually hand out.
- DHCP today is a flag only: NETWORK_FIELDS { key: 'dhcp', kind: 'flag', csv: 'dhcp', table: 'edit' } at js/model.js:1766-1768, commented 'Nothing infers addresses from it'. There is no pool or range field anywhere. The card has a DHCP checkbox (js/networks.js:135), the table has a DHCP column (js/table.js:592-594), and the report prints 'DHCP' in Addressing (subnetsSection, js/report.js:1525-1548).
- NETWORK_FIELDS drives everything automatically: the CSV subnets sheet (csvSubnetsSheet js/csv.js:426-429, import targets js/csv.js:912), plain-text search (query.js:148 Q_PLAIN.net via qFieldsHave), Changes since the last back-up (changes.js:285 changedLabels(NETWORK_FIELDS, …)) and the card's validation (fieldBad, js/networks.js:142-146).
- Port size model: DEFAULT_PORT_COUNT { switch: 8, ap: 1 } (js/model.js:40). hasExplicitPortCount/portCountOf (js/model.js:61-63): an implicit count is max(default, highest port in use), so an implicit switch is 'full' by construction and its real size is unknown.
- freePorts(node, count) at js/model.js:2104: free means not ifaceIsOccupied and not a bond. 'past' counts ports beyond an explicit faceplate.
- evaluatePorts (js/diagnostics.js:243-323) already reports more cables than ports as 'bad' ('{used} cables on a {total}-port switch…', :286-295) and 'good: {used} of {total} ports in use[, n wireless clients]' (:305-319). Over capacity is covered; nearly full is not.
- Report port use: portUsage(node) at js/report.js:103 ({used,total}, sockets only) is printed in the inventory. reportPortMaps (js/report.js:609-675) builds the free ranges ('Free: p3–p8') and used/total per switch, but drops a switch with no rows (:674). portMapsSection prints '{used} of {total} ports used' and 'Free: {ports}' (js/report.js:1342-1359). Add devices warns when devices would not fit (js/add.js:547).
- Findings pipeline: runDiagnosis (js/diagnostics.js:1093-1145) pushes whole-map checks (labelFindings, upkeepFindings, providerFindings…). Info findings ('rack-tag' :1754, 'wifi-plan' :1975, 'provider' :1775, 'service-due') are listed but not counted (isCountedFinding :1216), and the report leaves them out (reportModelNow js/report.js:814). Accept and pin need nodeIds or linkIds (namesSomething :1199, used in acceptFindings :1308). scope keeps acceptance per network (findingscope).
- FINDING_CHECK_NAMES at js/diagnostics.js:1294 and PLAIN_FINDINGS (plain what/why per key) at js/report.js:1664 are where a new key gets its names.
- The diagnosis memo key already includes JSON of state.networks (js/diagnostics.js:2084), so new subnet fields invalidate it with no extra work.
- Renumber rewrites every gateway and DNS reference into the old range through ref()/refText (js/model.js:2221-2240). A pool would need the same.
- Report shape: reportModelNow (js/report.js:806-873) builds subnets/portMaps. reportSheet orders the sections Summary, Findings, …, Switch ports, Connections, Wi-Fi, Addressing, Changes, Scope (js/report.js:1845-1932). summarySheet 'What you have' (js/report.js:1734-1822) is where the plain line goes.
- DOC_VERSION = 15 (js/model.js:4227). The no-op step pattern { from: 14, to: 15, run: (doc) => ({ ...doc, v: 15 }) } is at js/model.js:4371, and the version history comment is at js/model.js:3800-3880.

**Data model**

Two new NETWORK_FIELDS rows, placed straight after 'dhcp' (js/model.js:1768):
  { key: 'dhcpFirst', kind: 'text', omit: true, label: 'DHCP first', csv: 'dhcp_first', table: 'edit', validate: fieldOk.ip }
  { key: 'dhcpLast',  kind: 'text', omit: true, label: 'DHCP last',  csv: 'dhcp_last',  table: 'edit', validate: fieldOk.ip }
Both are stored as typed text, the way readNetworkCidr keeps a bad CIDR, so nothing is lost on save. Absent means no pool, and a subnet without one serializes byte-identical to today.

When the pool counts: dhcp is true, both ends parse, they are the same family as the CIDR, both sit inside usableRange, and first <= last. Anything else is an invalid pool. It is shown on the card and raised as a 'dhcp-pool' finding, but never counted. A pool with DHCP unticked is kept but ignored, and the card says so.

Derived only, never stored: a new pure helper subnetCapacity(net | implied cidr) in js/model.js next to networkStats returns
  { size, used, free, reserved: [gateway/DNS inside the subnet not held by a member],
    pool: null | { first, last, size, used, free, valid, problem },
    fixed: { size, used, free } }
Used is the set of in-service member addresses plus the subnet's own gateway and DNS (the takenAddresses rule), so 'free' equals what freeAddresses can hand out. networkStats() then reads its used/free from this helper. Sizes stay null past 2^24, as today.

A second pure helper portCapacity(node) sits next to freePorts. It returns { total, explicit, used, free, freeIds, nearlyFull, full }. A port counts as used when ifaceIsOccupied or it is a bond, and wireless clients are not counted. report.js portUsage() and the reportPortMaps total/used read from it, so the three places agree.

Document version 15 to 16: append { from: 15, to: 16, run: (doc) => ({ ...doc, v: 16 }) }, raise DOC_VERSION and add a 'v 16' paragraph to the history comment. There is nothing to convert, because older subnets simply have no pool. A v15 build would drop the pool on save, so it opens a v16 file read-only (the existing newer path).

CSV: subnets.csv gains the columns dhcp_first and dhcp_last, automatically through NETWORK_FIELDS. Import validates each cell with fieldOk.ip. A cross-field problem, such as an address outside the CIDR, is imported as written and then shown by the finding, which is the same policy as an off-subnet gateway. Nothing is added to devices.csv or ports.csv, and capacity numbers are never exported as columns, because they are derived (the findings sheet carries the notes).

Renumber: planRenumber (js/model.js:2239-2240) adds ref(n, 'dhcpFirst'), ref(n, 'dhcpLast') beside gateway/dns, so a moved subnet keeps its pool at the same host bits. Block insertion re-bases a block's networks the same way.

No per-interface 'static / DHCP' field is added; see open questions.

**Interface**

Full editor (#advanced):
- Subnets card (networkCardHtml, js/networks.js:83). The use line shows one consistent count: '{used} of {size} used · {free} free'. When a valid pool exists, a second line reads 'Pool 10.0.1.100–10.0.1.199 · {n} recorded of {size} · fixed {free} free'. In the edit grid, when DHCP is ticked, two mono fields 'DHCP first' and 'DHCP last' appear (field('dhcpFirst', 'DHCP first') with placeholder from the subnet, e.g. '10.0.1.100'). They are validated by fieldBad, and a pool advice line works like gatewayAdvice (js/networks.js:150) with messages such as 'The pool is outside {cidr}.', 'The pool ends before it starts.', 'The gateway {gw} is inside the pool.' and 'DHCP is off: the pool is not counted.' onNetworkField needs no new branch, because text fields already go through net[key] = el.value. Vocabulary stays English (DHCP, Pool), as the tab's comment requires.
- Table, Subnets tab (js/table.js:583-598): add schemaColumn rows for dhcpFirst and dhcpLast (mono, sort 'ip', editable, shown only on declared rows), plus three read-only derived columns, Used, Free and Pool used ('12 / 100'). These come from the reportSubnets row, so undeclared subnets show used/free too. Ports tab: no change, since the Free rows are already there.
- Node panel for a switch or AP: evaluatePorts' 'good' line gains ' · {free} free' when the count is explicit. When the count is implicit it says 'size not set' so the user knows why no capacity note can appear. The existing port-count field is the way to make it explicit.
- Findings tab: 'Port capacity' and 'Address capacity' notes (info) and the 'DHCP pool' finding (warn) are listed, grouped, and can be accepted, scheduled or pinned like every other. Clicking one flies to the switch, or to the subnet's members.
- Search: the pool addresses are plain text of the subnet automatically (query.js:148). Optionally a has:full device term (Q_HAS, query.js:181) for switches with portCapacity().nearlyFull, so 'type:switch has:full' lists them. This is one entry in Q_HAS plus the line in the header comment.

Simple view: no new panel. The Simple summary (report) gets the plain line. The info notes reach the reduced Findings list in plain words through the translated detail text. No pool fields appear in the Simple view, which has no Subnets tab.

**Checks**

Three new finding keys in a new capacityFindings() called from runDiagnosis after labelFindings (js/diagnostics.js:1129). Each is added to FINDING_CHECK_NAMES and PLAIN_FINDINGS.

1. 'port-capacity' is INFO, a note that is not counted, like rack-tag and wifi-plan. A nearly full switch is planning, not a fault, and the real fault (more cables than ports) is already 'bad' in evaluatePorts. It applies to a switch or AP that is in service or planned (not retired), whose portCount is EXPLICIT (an implicit count grows and so is never full), with total >= 4 (this excludes an AP's 1-port uplink and 2-port boxes). It fires when free <= max(1, floor(total / 10)): 1 free on 8 or 16 ports, 2 on 24, 4 on 48. full (0 free) has its own wording: '{name} has no free port: {used} of {total} in use. Raise the port count if it is bigger, or plan another switch.' Nearly full reads '{name} has {free} free port of {total}: {ports}.' (plural form for 'ports', and the free list as reportPortMaps prints it). Its nodeIds are [switch] and linkIds are none, so it can be accepted ('the closet only ever has 8 phones') and reopens when a port count changes the finding's identity. It is not raised while evaluatePorts already says 'bad' overflow on the same device, to avoid two findings for one problem.

2. 'address-capacity' is INFO. It applies to a countable IPv4 subnet (size not null) with usable size >= 8 (this excludes /29-and-smaller transit links). With a valid pool it measures the fixed part, size minus pool; otherwise the whole subnet. It fires when free <= max(2, ceil(size / 10)). The wording is '{cidr} has {free} free addresses of {size}.' or '… {free} fixed addresses free outside the pool.' The scope is net.id, or the CIDR for an implied subnet. nodeIds are the in-service members, so accepting it reopens when another device joins. IPv6 never fires. There is no note on pool fullness, because Topo cannot see leases and saying '90% of the pool is used' from recorded devices would be a guess.

3. 'dhcp-pool' is WARN (Advisory, counted). The pool is set, DHCP is on, and the pool is invalid: outside the subnet, reversed, the wrong family, or containing the subnet's network/broadcast address. It also fires when the subnet's gateway or DNS server address lies inside the pool, which is the classic way a server hands out the router's address. nodeIds are the holders of those addresses when drawn, else the subnet's members; it is scoped to net.id. Accepting it is the documented way to say 'excluded on the server'. An undrawn gateway with no members gives a finding that names nothing, which cannot be accepted, matching the existing rule.

Not added: 'fixed device inside the pool'. Without an addressing-mode field Topo cannot tell a reservation or lease from a static address (see open questions). These checks are document-only, so they are memoised with everything else and cost one pass over subnets plus one over port-grid nodes.

**Report**

Technical sheet: a new 'Capacity' h2 in reportSheet after 'Addressing' and before Changes (js/report.js:1918-1921). It is left out when both tables are empty. reportModelNow gains model.capacity = { subnets, ports }, built from subnetCapacity/portCapacity.

(a) Addresses table: Subnet (CIDR + name), Size, Used, Free, DHCP pool (range or '—'), In pool (recorded / size), Fixed free. Implied subnets are included and muted, as in Addressing. IPv6 rows say '2^64' with Used only. A row with an address-capacity note is marked with the 'adv' style without counting it.
(b) Ports table: every switch and AP with total >= 2, including those reportPortMaps drops because they have no rows. Columns are Device, Ports, Used, Free and Free ports (the same range text as reportPortMaps.free). An implicit count reads 'size not set' instead of a total, and nearly-full rows are marked.

The existing Addressing table keeps its 'DHCP' word and gains 'pool a–b' after it (subnetsSection js/report.js:1531-1535). reportSubnets rows carry dhcpFirst/dhcpLast/size/used/free so the table view reuses them. The binder reuses reportSheet per site, so site sheets get the section for free; the estate cover is unchanged.

Simple summary (summarySheet, js/report.js:1734): under 'What you have', one plain paragraph 'Room to grow', built from model.capacity. Examples: 'The switches have 14 free ports. Office Switch is almost full: 1 free port of 8.' and 'The office network has 40 addresses left; the guest network is almost full.' Only the nearly-full items are named, at most SUMMARY_WHERE_MAX with '…and {n} more'. When nothing is known (no explicit port counts, no countable subnets) the line is omitted. The 'dhcp-pool' warn enters 'What needs attention' through PLAIN_FINDINGS: 'The automatic address range clashes with a fixed address' / 'Devices may be handed an address already in use, and lose their connection.'

**Translations**

About 30 to 35 new MESSAGES keys, each in es, pt-BR, ja and ru. They cover the finding details (nearly full and full, each with a singular/plural form: '{free} free port of {total}' and '{free} free ports of {total}'; address free with and without a pool; the pool problems: outside, reversed, gateway in pool, DNS in pool), check names (Port capacity, Address capacity, DHCP pool), card lines (pool line, 'fixed {free} free', 'DHCP is off: the pool is not counted.'), report headings and columns (Capacity, Addresses, Ports, Size, Used, Free, In pool, Fixed free, Free ports, size not set), the summary sentences (Room to grow, '{name} is almost full: {free} free port of {total}.', 'The {name} network has {n} addresses left.', '…is almost full'), and the PLAIN_FINDINGS pairs for the three keys.

Tricky points:
(1) Plurals. Every count needs separate singular and plural keys; tests/suites/plurals.js checks the singular. Russian has three plural forms, so check how existing '{n} devices' keys handle it and follow the same scheme.
(2) Full editor vocabulary: 'DHCP first'/'DHCP last' and 'Pool' as field labels stay English, while their sentences are translated.
(3) Summary plain words: 'automatic address range' rather than 'DHCP pool', and 'network' for a subnet as the Simple samples do. Japanese says 'PC' wherever a device is named generically.
(4) Free-port lists are names from portNameOf, not translated.

**Files**

- js/model.js: NETWORK_FIELDS (+dhcpFirst, dhcpLast); new subnetCapacity() and dhcpPoolOf() near networkStats (:2119), and networkStats reads used/free from subnetCapacity; new portCapacity() near freePorts (:2104); planRenumber refs (:2239-2240); DOC_VERSION 16 (:4227), migration step after :4371, version history comment (:3800-3880).
- js/diagnostics.js: new capacityFindings() called in runDiagnosis (:1129); FINDING_CHECK_NAMES (:1294) += 'port-capacity': 'Port capacity', 'address-capacity': 'Address capacity', 'dhcp-pool': 'DHCP pool'; evaluatePorts 'good' text (:305-319) gains free / 'size not set'.
- js/networks.js: networkCardHtml (:83) pool line, fields, poolAdvice() beside gatewayAdvice (:150); no change needed in onNetworkField.
- js/table.js: subnets columns (:583-598): dhcpFirst/dhcpLast schemaColumns, plus derived Used/Free/Pool-used columns.
- js/report.js: portUsage (:103) via portCapacity; reportSubnets (:453) row gains capacity numbers + pool; new reportCapacity() + capacitySection(); reportModelNow (:806) model.capacity; reportSheet (:1918) Capacity h2; subnetsSection (:1525) prints the pool; summarySheet (:1734) 'Room to grow' line; PLAIN_FINDINGS (:1664) += three keys.
- js/csv.js: nothing structural (NETWORK_FIELDS-driven at :426/:912); check csvPlanSubnets (:2483) applies text fields with validate, and add pool cells to the round-trip test.
- js/query.js: optional Q_HAS.full + header comment (:44).
- js/i18n.js: all new MESSAGES in es, pt-BR, ja, ru.
- docs/FEATURES.md: Subnets bullet (pool, consistent used/free), Checks section (three keys and their levels), Site report bullet (Capacity section, Room to grow line), Spreadsheet bullet (dhcp_first/dhcp_last); README.md document version line if it lists versions.

**Tests**

- New tests/suites/capacity.js: subnetCapacity counts members plus the undrawn gateway/DNS, so free equals freeAddresses' count (fixes the off-by-one); a retired member's address is free; a /30 and a /31 have the right sizes; an IPv6 /64 gives size null; a valid pool splits into pool and fixed; an invalid pool (outside, reversed, wrong family, network address) has valid:false and is not counted; DHCP unticked means the pool is ignored.
- capacity.js: portCapacity agrees with freePorts (the same free ids) and with report portUsage and reportPortMaps used/total; a bond port counts as used; wireless clients do not; an implicit switch has explicit:false and is never nearlyFull.
- capacity.js thresholds: 8 explicit ports with 7 used is nearly full (info), with 8 used is full (info), with 6 used gives nothing; 24 ports with 22 used gives info; 9 used of 8 gives only the existing 'bad' overflow and no port-capacity; an AP with portCount 1 gives nothing; a retired switch gives nothing. Address: /24 with 230 used gives info, 200 used gives nothing, a /29 gives nothing, IPv6 gives nothing; a pool .100-.199 with 90 fixed used of 153 fixed gives nothing, and with 150 gives info.
- capacity.js dhcp-pool: a gateway inside the pool gives warn, counted (findingCounts advisory +1), naming the router; an accept with a reason makes it accepted and keeps it out of the counts; a pool outside the CIDR gives warn; the scope is net.id, so accepting on one subnet does not cover another.
- networks.js additions: the card shows the pool line and the fields only when DHCP is ticked; typing a pool is one undo step; Renumber 10.0.1.0/24 to 10.0.9.0/24 moves the pool to .9.100-.9.199.
- csv.js / wificsv-style round trip: subnets.csv exports dhcp_first/dhcp_last; export then import into an empty map gives an identical document; an invalid cell such as 'abc' is refused on its row; a formula-looking cell is escaped as today.
- schema.js / compat.js: a v15 document opens and upgrades to v16 unchanged (a subnet with no pool stays byte-identical on save); a v17 document opens read-only; serializeDoc omits the pool fields when they are absent.
- report.js / sitereport.js: the Capacity section appears with both tables, is absent on a network with no subnets and no port-grid devices, includes a switch with no cables (which reportPortMaps drops), and an implicit switch reads 'size not set'; info notes still leave model.counts unchanged.
- summary.js: the Room to grow line names only nearly-full items, is omitted when nothing is known, and the dhcp-pool warn appears under What needs attention with its plain wording.
- i18n.js and plurals.js suites pass with the new keys in all five locales; query.js: 'has:full' matches only a nearly-full explicit switch (if Q_HAS.full ships).

**Stages**

- 1. Shared counters, no new data. Add subnetCapacity() and portCapacity() in model.js. networkStats, report portUsage and reportPortMaps read from them, which fixes the gateway off-by-one in 'free'. evaluatePorts' good line adds the free count / 'size not set'. Tests for the agreement. No version bump.
- 2. Port capacity. capacityFindings() with 'port-capacity' (info) only, its check name and its i18n. A Ports table in a new report Capacity section, and the switch half of the Simple summary's Room to grow line. Optional has:full. No data change.
- 3. Address capacity without pools. 'address-capacity' (info) on whole subnets, the Addresses table in the Capacity section, and the subnet half of Room to grow, plus Used/Free columns in the table's Subnets tab. No data change.
- 4. DHCP pool. Add the dhcpFirst/dhcpLast NETWORK_FIELDS and DOC_VERSION 16 with its no-op step. Card fields and pool advice, table columns, subnets.csv round trip, Renumber/block re-base. Pool split in subnetCapacity, address-capacity measured on the fixed part, the 'dhcp-pool' warn finding with its PLAIN_FINDINGS entry, and pool columns in the report. Update FEATURES.md.

**Risks**

- Changing networkStats.used to count the subnet's own gateway and DNS changes numbers on existing Subnets cards and may break assertions in tests/suites/networks.js. Check every networkStats caller (cards, report, any card test) in stage 1 and say in FEATURES that 'used' includes the gateway.
- Info notes on the shipped samples and Showcase: the samples promise 'no finding at all' in Simple (SIMPLE_SAMPLES). Info is not counted, so the promise holds, but samples.js/showcase.js may assert an empty findings list. An 8-port sample switch with 7 cables would now show a note, so check the samples (many are explicit portCount: 8, js/data.js) and adjust the sample or the test, not the threshold.
- False confidence about DHCP: Topo only knows recorded devices, so 'In pool' must read as 'recorded', never as leases in use. Keep the wording 'recorded' and do not raise a pool-full note.
- A new Simple summary paragraph could crowd the one-page summary. It stays one paragraph and is omitted when there is nothing known.
- The version bump means a v15 build (an older cached tab or offline copy) opens new files read-only even when no pool is set. That is accepted by the existing policy, but serializeDoc always stamps v16, so it affects every saved file, not only those with pools.
- Performance: subnetCapacity over a /16 must not enumerate addresses. Count with set sizes and range arithmetic (BigInt), never loops; only the existing next-free lookup stays bounded at 65536 tries.

**Amendments (from the cross-check; these win over the text above)**

- capacity: 'may break assertions in tests/suites/networks.js'. The networkStats assertion is at tests/suites/assets.js:139 ('and the Subnets tab counts it free', used === 2), and networkStats' only app caller is js/networks.js:84.
- capacity, inventory, vlan, reports: 'add a v 16 paragraph to the version history comment (js/model.js:3800-3880)'. The log has no v15 entry at all. It ends at v14 (js/model.js:3865-3876), although the 14→15 step exists at :4371 and v15 providers are documented at :3653. The v15 entry is missing and must be written first.
- capacity: 'evaluatePorts good text gains free / size not set' as the way the panel agrees with portCapacity. evaluatePorts computes its own used (js/diagnostics.js:306, pN ids with a cable, bonds not counted) and returns early on unbound, doubled or orphaned cables (:250-300). The 'good' line, portUsage and portCapacity only agree if evaluatePorts is rewritten to read portCapacity, and the spec does not say so.
- capacity: 'NETWORK_FIELDS drives … import targets js/csv.js:912 automatically'. The targets are generated there (csv.js:910), but per-field parsers are hand-listed in the 'net:*' map (csv.js:816-821: net:cidr, net:id, net:vlan, net:dhcp, net:drawZone). Whether a text field with validate:fieldOk.ip gets a parser by default has to be checked; it is not shown.
- Stage 1 must also make evaluatePorts (js/diagnostics.js:305-319) and portUsage read portCapacity, so bonds count as used in all three places. Note that the networkStats assertion to update is tests/suites/assets.js:139.
- Drop the separate Ports table. Instead, stop filtering cable-less switches out of reportPortMaps (:674), so the port map lists every switch/AP with used/total/free, and keep only the Addresses table under 'Capacity'. Give port-capacity a scope that includes the port count, so a changed count really reopens an acceptance. Absorb vlan's PoE near-budget info note into capacityFindings.
- Stage 4 takes 'the next free version', not v16, and checks that subnets.csv import needs explicit 'net:dhcpFirst'/'net:dhcpLast' parsers in the hand-listed map (js/csv.js:816-821). Add a samples/showcase check that the new info notes do not break the SIMPLE_SAMPLES promise, plus binder and reportdate tests for the Capacity section.

**Open questions (defaults in "Decisions taken")**

- Should Add devices, bulk Move and block insertion keep handing out addresses from the bottom of the subnet, or skip the DHCP pool once one is declared, so fixed devices land outside it? Skipping is safer for printers and servers, but phones and PCs that really use DHCP would then get fixed addresses outside the pool. The proposal is to skip the pool, behind the spec's stage 4, and to say so in the Add devices preview. Ruled 2026-11-05: the owner chose option C, skip the pool for fixed-address device types only, clients may still take pool addresses (see "Decisions taken", Capacity: DHCP pool handout). (done 2026-11-05)
- Should a device's interface say how it gets its address (fixed, reserved, DHCP), as a new IFACE_FIELDS tristate filled by the DHCP-lease paste? That would allow 'a fixed server inside the pool' as a real finding and exact pool counts, but it is another field in every interface sheet. It is left out of this spec.
- The Capacity section still holds a Ports table of the nearly full switches only (landed that way in step 5), while "Decisions taken" and the Amendments say to keep only the Addresses table there. Owner to rule: drop it, or keep it and record that as an amendment. Ruled 2026-11-04: kept as an optional table, off by default, behind the report dialog's Capacity: ports table tick (see "Decisions taken", Reports (owner)). (done 2026-11-04)
- The thresholds are fixed constants (10%, at least 1 port or 2 addresses). Should they be settable per network or in Settings? The proposal is constants now and to reconsider only if users accept many notes.

---

## 3. inventory

### Inventory by vendor, model and firmware/OS

Split the single "Model / firmware" field (node.os) into Vendor, Model and Firmware / OS. Old files keep their text where it is, and an optional review dialog splits it, the same way "Make groups from locations" works. Inventory is then grouped by each of the three in a new Table tab and a report section. A new advisory finding fires when devices of the same model run different firmware. The vendor can be suggested from a device's MACs through js/oui.js. The suggestion is only a hint until the user takes it, and is never offered for randomised or multicast addresses.

**Already in Topo**

- js/model.js:1398-1402 NODE_FIELDS row { key: 'os', label: 'Model / firmware', csv: 'os', bulk: true, table: 'edit', report: { key: 'os', column: 'Model / firmware' } }: the one combined field. Its comment says it was the OS field, relabelled at v4.
- js/model.js:1453-1465 Asset group fields (serial, assetTag, location, status) use kind 'text', omit: true, read: asOmittedText. This is the pattern the new vendor/model fields follow.
- js/model.js:3794-3886 the version-chain doc and its rules: append { from: N, to: N+1 }, never edit a shipped step, and a newer file opens read-only. js/model.js:4227 DOC_VERSION = 15; js/model.js:4371 the last step is 14→15 (bump only); js/model.js:4386 migrateDoc.
- js/model.js:3826-3831 (v7 note): 'the free-text location stays as it was, and making groups from it is a step the user confirms'. This is the precedent for not auto-splitting text in a migration.
- js/groups.js:455 planGroupsFromLocations + groupsFromLocationsText/makeGroupsFromLocations (js/groups.js:485-510): a pure planner, an askConfirm preview, then one undo step. The model/firmware split copies this shape.
- js/oui.js:122 lookupVendor, :132 decodeMac (returns isLocal, isMulticast, vendor.kind 'oui'|'special'|'unknown'), :161 window.CarinoOUI. The header says it is shared with hardware.carino.systems ('so the two tools cannot drift apart'), so Topo must not edit it. Its vendor names include NIC-chip makers (Intel Corporate, Realtek, Espressif (ESP8266/32)) and '(virtual)' entries (VMware, QEMU/KVM, Docker...).
- js/model.js:315 normMac, :322 hasMac, :333 macIsGroup, :334 macIsLocal: the bit tests for the 'never for randomised/multicast' rule.
- js/report.js:112 reportInterface already decodes each MAC's vendor for the inventory's MAC column. js/ui.js:1965-1994 paint() shows the decoded vendor under the MAC input. js/query.js:245 qMacMatch already lets mac:dell match by the OUI vendor.
- js/diagnostics.js:1596 labelFindings (duplicate asset tag/cable label) is the model for a whole-document register finding. js/diagnostics.js:1093 runDiagnosis wires each *Findings() in (labelFindings at :1129). js/diagnostics.js:1294 FINDING_CHECK_NAMES. Accepted entries can carry a scope (ACCEPT_SCOPE_MAX 64, acceptedEntryFor at :1200).
- js/report.js:1664 PLAIN_FINDINGS (plain what/why for the Simple summary), :1701 summaryProblems, :1734 summarySheet ('What you have' kind stats), :1400 devicesSection (columns from NODE_FIELDS report.column), :355-364 reportFieldsOf/REPORT_EFFECTIVE, :130 reportDevices.
- js/table.js:54 TV_TABS (tabs with `when`), :190 schemaColumn, :221 assetColumn, :386 the Devices tab's os column, :750-770 tvDevicesOrder (a column the saved doc.tableView order does not name goes after the named ones).
- js/csv.js:519-525 CSV_ALIASES.os = ['firmware','os firmware','model','modelo','operating system']. 'model' and 'modelo' must move to the new model field. js/csv.js:263 csvNodeFields (every NODE_FIELDS row with csv). js/csv.js:889 PLAIN set (translated headings). js/csv.js:1403 apartKeys (rows that disagree on these are different devices).
- js/bulk.js:5-11 'Set fields' is built from NODE_FIELDS rows with bulk: true, with the findings-delta preview and one batch(). New fields get Change all for free.
- js/query.js:306 Q_PREFIXES (with the `field:` gate in qKnown at :354), :185 Q_HAS (has `os`), :109 Q_SKIP. Plain text already searches every NODE_FIELDS text field.
- js/changes.js:224-259 changedLabels walks NODE_FIELDS, so new fields show in changes-since-baseline with no new code.
- js/app.js:813 updateOsDatalist (suggestions from values already typed), :2758 propertyBindings { key: 'os', id: 'propOs' }, :204 fieldHints (the 'e.g. {value}' / '{value} · from {network}' grey-hint pattern), :106 spawnNode (os seeded only in the reduced profiles). js/data.js:5-25 type seeds are OS-like ('Windows 11', 'pfSense', 'Cisco IOS', 'Firmware').
- index.html:533-543 the Asset group's 'Model / firmware' input propOs + osDatalist. js/assets.js:141 ASSET_INPUTS, :152 renderAssetFields, :576 labelsFor prints model: n.os on QR labels.

**Data model**

Document v16 (DOC_VERSION 15 → 16; take whatever number is free when this lands, because other backlog features may bump too).

NODE_FIELDS (js/model.js, Asset group, in this order just before 'os'):
- { key: 'vendor', kind: 'text', omit: true, read: asOmittedText, label: 'Vendor', csv: 'vendor', bulk: true, table: 'edit', report: { key: 'vendor' } }
- { key: 'model', kind: 'text', omit: true, read: asOmittedText, label: 'Model', csv: 'model', bulk: true, table: 'edit', report: { key: 'model', column: 'Model' } }. The report column prints "vendor model" joined (see report).
- 'os' keeps its key and its csv name 'os', so every file, sealed link and sheet from before still reads. Only its label changes to 'Firmware / OS' (report.column too). It is still written when empty (legacy byte-stability, js/app.js:816-822).
Both new fields are left out when blank, so a device that never used them serializes byte-identically to v15.

Migration: { from: 15, to: 16, run: (doc) => ({ ...doc, v: 16 }) }. It only bumps the version; text is not moved, following the v7 precedent. Reasons: (a) a pure step can't tell 'HP LaserJet M404' (a model) from 'RouterOS 7.14' (firmware) with certainty; (b) it would show up as changes against every stored baseline; (c) shipped steps can never be fixed later. A v15 build would drop vendor/model on save, so it opens a v16 file read-only, as before.

Splitting existing text is done by the user: planModelSplit(nodes), a pure function (js/assets.js, shaped like planGroupsFromLocations). For each node with a non-blank os and blank model and vendor:
(1) keep: the whole text is firmware or OS vocabulary. That means a version token /\bv?\d+(\.\d+)+\b/ alone, a FW_WORDS family (IOS, IOS-XE, NX-OS, JunOS, RouterOS, SwitchOS, FortiOS, ArubaOS, EdgeOS, UniFi, OpenWrt, pfSense, OPNsense, DSM, QTS, ESXi, Windows, Ubuntu, Debian, RHEL, macOS, iOS, Android, Linux, FreeRTOS, firmware, fw), or a value of initialDataDefaults[*].os.
(2) split: exactly one separator among ' / ', ' · ', ' | ', ' ; ', ', ' (with spaces, so 'IOS-XE' and 'Gi1/0' never split). The right side must look like firmware (rule 1, or it contains a version token) and the left side must not. Then model = left, os = right.
(3) model-only: no firmware-like part and the text starts with a known vendor word. Then vendor = that word, model = the rest, os = ''.
For (2) and (3), a leading known vendor word (VENDOR_WORDS: the OUI display names below plus Aruba, Juniper, Fortinet, Synology, QNAP, Hikvision, Dahua, Axis, Brother, Canon, Epson, Lexmark, Xerox, Siemens, Philips, GE, Supermicro, APC, Eaton, Yealink, Polycom, Grandstream) is moved to vendor.
(4) anything else is left as it is and listed as such. Nothing is lost: model + ' ' + os always holds the original words.

Vendor from MAC: macVendorSuggestion(node) is pure and stored nowhere. It looks at interfaces where hasMac && !macIsGroup && !macIsLocal, with decodeMac(...).vendor.kind === 'oui'. It drops '(virtual)' vendors and NIC-chip makers (OUI_CHIP_ONLY = Intel Corporate, Realtek, Espressif (ESP8266/32)), because the chip maker is not the box maker. All remaining MACs must agree on one vendor. Topo-side display names: 'Intel Corporate'→not suggested, 'ASUSTek'→'ASUS', 'MSI (Micro-Star)'→'MSI', 'HP / HPE'→'HPE' for server/switch/l3switch/ap/firewall and 'HP' otherwise. Returns { vendor, from: [iface names] } or null. Used only when node.vendor is blank.

Firmware comparison key: lowercase, whitespace removed, a leading 'v'/'version'/'fw' before a digit stripped (so 'v17.9.4' = '17.9.4'). Model grouping key: vendor (when set) + model, lowercase with collapsed whitespace. Displayed with the most common spelling.

CSV (devices.csv, from NODE_FIELDS order): new columns vendor, model, then os.
- CSV_ALIASES.vendor = ['manufacturer', 'make', 'brand', 'maker', 'mfr', 'fabricante', 'marca', 'производитель', 'メーカー', '製造元'].
- CSV_ALIASES.model = ['model', 'modelo', 'model name', 'model number', 'product', 'модель', 'モデル', '型番', '機種'] ('model' and 'modelo' are removed from os).
- CSV_ALIASES.os keeps 'firmware', 'os firmware', 'operating system' and adds 'model firmware' (an old sheet headed 'Model / firmware' still lands in os, since csvNorm makes it 'model firmware'), 'firmware version', 'fw', 'os version', 'software version', 'sistema operativo', 'прошивка', 'ファームウェア'.
- Add 'vendor' and 'model' to PLAIN (csv.js:889) and to apartKeys (csv.js:1403).
- Suggestions are never exported.

**Interface**

Full editor (#advanced). The technical labels stay English like 'Model / firmware' did (index.html:533-535 comment), and the sentences are translated.
- Device editor, Asset group (index.html:538-543): the one 'Model / firmware' input becomes three inputs: Vendor, Model (span 2), Firmware / OS (span 2, still id propOs). They get datalists (vendorDatalist, modelDatalist filtered to the typed vendor, osDatalist) built by generalising updateOsDatalist (js/app.js:813). When vendor is blank and macVendorSuggestion(node) is not null, the Vendor input's placeholder is '{value} · from the MAC' (the fieldHints pattern, js/app.js:204), next to a small Use button that writes it as one undo step. Nothing is written until Use is pressed or the user types. When planModelSplit has a split or model-only row for this device, a one-line note shows under the inputs ('Model and firmware are in one field.') with a Split button that applies that row (one undo step).
- Table (js/table.js): Devices tab gains Vendor and Model columns via assetColumn next to os (table.js:386). The Vendor cell shows a muted suggestion when blank (like inheritedCell), with a title saying it comes from the MAC and is not saved. tvDevicesOrder gains an `after: 'os'` placement so a saved doc.tableView order puts the new columns beside Firmware / OS instead of last. A new tab, TV_TABS { key: 'inventory', label: 'Inventory', plain: true, when: () => any node has vendor/model/os }, has a By: Vendor | Model | Firmware / OS switch (per visit, not stored). One row per value: the value, a count, the devices, and on By model the firmware versions with counts (a mismatch is ringed like a finding). Blank values make one 'Not recorded' row. Rows are read-only. Clicking a row selects its devices (state.selection), which opens Change all on them. The tab's toolbar has 'Split model and firmware…' while planModelSplit finds candidates. That opens an askConfirm-style review listing each device's proposed vendor / model / firmware with a tick per row (unticked rows stay as they are) and applies as one batch().
- Change all (js/bulk.js): Vendor and Model appear in Set fields automatically (bulk: true). A 'Fill vendor from MAC' action (button in Set fields) plans the suggestion only onto devices of the set whose vendor is blank. The preview lists which devices get which vendor and which have none (randomised, chip maker, no MAC, MACs disagree), and nothing typed is overwritten.
- Search (js/query.js Q_PREFIXES): vendor: (alias make:), model:, fw: (aliases firmware:, os:). Each matches its field as text, has a `field:` gate, and the words stay English. vendor: matches only what was typed; mac:dell already finds by OUI. has: gains vendor, model, fw (alias for the existing has:os, Q_HAS_ALIAS).
- QR labels (js/assets.js:576): model prints '[vendor] [model]', falling back to os when both are blank.
Simple view: no new inputs. The reduced profiles never show the Asset group (index.html:529-531), and their seeded os ('Windows 11', 'Firmware') is never compared, because the finding needs a model.

**Checks**

New finding 'firmware', level 'warn' (advisory), check name 'Firmware' (FINDING_CHECK_NAMES), in a new firmwareFindings() in js/diagnostics.js wired into runDiagnosis next to labelFindings (diagnostics.js:1129). It groups non-retired devices (isRetired) that have a non-blank model and firmware by the model grouping key. Vendors that are both set and differ count as different models; a blank vendor joins the model's group. It fires when one model has two or more distinct firmware comparison keys. nodeIds lists every device of that model with firmware recorded, and the subject is the model's display name. Detail: '{model} runs {k} different firmware versions: {list}.' where list is '17.9.4 on SW-1, SW-2; 17.6.1 on SW-3' (no claim about which is newest, since Topo cannot know). scope is the model key (cut to ACCEPT_SCOPE_MAX 64). Accepting covers those devices for that model, and a further device of the model reopens it, which is the existing "what was accepted was those devices" rule. Devices with a blank model or blank firmware never count, so the seeded firmware text of the reduced profiles and older files that never split cannot raise it. There is no finding for a missing vendor/model and none for a suggested vendor differing from a typed one. The OUI says only who made the NIC, and evaluateMac (diagnostics.js:487) already says when that is meaningless.

**Report**

Technical sheet: devicesSection's columns become 'Model' (vendor + model joined; the vendor-only row has report.key but no column) and 'Firmware / OS', instead of the single 'Model / firmware' column. A new inventorySection(model.inventory) follows Devices, printed only when some device has a vendor, model or firmware. It has three compact tables: By vendor (vendor, count), By model (vendor, model, count, firmware versions with counts, mismatched ones marked as the finding marks them) and By firmware / OS (value, count). The data comes from reportInventory() in js/report.js, which the Table's Inventory tab also reads, so the two cannot disagree (the rule at js/table.js:12-16). Retired devices are counted in a separate muted column. Suggested vendors are not printed. The firmware finding appears in Findings and Accepted as usual. Simple summary (summarySheet, report.js:1734): 'What you have' gains, when any model is recorded, a plain 'Makes and models' list (vendor model × n, the 8 most common, then '…and {n} more.'). PLAIN_FINDINGS gains firmware: ['Devices of the same model run different software versions', 'They can behave differently, and the older ones may miss security fixes.'].

**Translations**

About 32 new keys, each in es, pt-BR, ja and ru:
- Labels: 'Vendor', 'Model', 'Firmware / OS'.
- Table and report: 'Inventory', 'By vendor', 'By model', 'By firmware / OS', 'Not recorded', 'Retired', 'Makes and models'.
- Finding: 'Firmware', '{model} runs {k} different firmware versions: {list}.', '{version} on {names}', plus the two PLAIN_FINDINGS sentences.
- Suggestion: '{value} · from the MAC', 'Use', 'Suggested from the network card's MAC address. Not saved until you use it or type a vendor.'
- Split: 'Model and firmware are in one field.', 'Split', 'Split model and firmware…', 'Split model and firmware for {n} devices?', 'Left as it is', 'Apply split'.
- Bulk: 'Fill vendor from MAC', 'No vendor from the MAC: randomised, a chip maker, or none recorded.', 'Already has a vendor: kept.'
Tricky ones:
- ru plurals for '{k} versions' and '{n} devices' go through the existing singular/plural pairs (plurals suite).
- ja: 'ベンダー' vs 'メーカー'. Use メーカー for Vendor (what a Japanese inventory heads the column with) and 'ファームウェア / OS' for Firmware / OS.
- es/pt: 'Fabricante' for Vendor.
- 'Model' must not collide with an existing 'Kind'/'Type' translation.
- '{list}' is built with ', ' and '; ' (no English conjunction, the rule at diagnostics.js:509-510).
- The search prefixes stay English.

**Files**

- js/model.js: NODE_FIELDS (add vendor, model; relabel os), MIGRATIONS (15→16 bump), DOC_VERSION, the version doc comment block (add the v16 line)
- js/assets.js: ASSET_INPUTS (+vendor, model), renderAssetFields, new planModelSplit/applyModelSplit, macVendorSuggestion, VENDOR_DISPLAY/OUI_CHIP_ONLY/FW_WORDS/VENDOR_WORDS tables, labelsFor (QR model text)
- index.html: Asset group markup (three inputs + datalists, suggestion Use button, split note)
- js/app.js: propertyBindings (+vendor, model), updateOsDatalist → updateAssetDatalists, fieldHints (vendor hint)
- js/diagnostics.js: firmwareFindings(), runDiagnosis wiring, FINDING_CHECK_NAMES.firmware
- js/report.js: reportInventory(), inventorySection(), devicesSection model column text, reportModelNow (inventory), summarySheet ('Makes and models'), PLAIN_FINDINGS.firmware
- js/table.js: TV_COLS.devices (vendor/model columns with suggestion cell), tvDevicesOrder (after: placement), TV_TABS inventory tab + its rows/columns and row-click selection, Split toolbar button
- js/csv.js: CSV_ALIASES (vendor, model; move model/modelo off os; add old-label alias), PLAIN set, apartKeys
- js/bulk.js: 'Fill vendor from MAC' plan (bulkPlanVendorFromMac) in Set fields, preview rows
- js/query.js: Q_PREFIXES vendor/model/fw (+Q_ALIAS make, firmware, os), Q_HAS vendor/model (+fw alias), header comment
- js/i18n.js: new strings in es, pt-BR, ja, ru; drop the unused 'Model / firmware' key
- docs/FEATURES.md and README.md: Asset group line (FEATURES.md:16), search keys, findings list, CSV columns, report sections

**Tests**

- tests/suites/inventory.js (new). Fields: vendor and model round-trip through serializeNode/normalize; when blank they are absent, so a device without them serializes byte-identically to v15. A v15 document opens as v16 with os unchanged and no vendor or model. A v17 document opens read-only (DOC_VERSION + 1, as in brokenlink.js:77).
- inventory.js, planModelSplit table: 'C9200L-24P / IOS-XE 17.9.4' → model C9200L-24P, os IOS-XE 17.9.4; 'Cisco C9200L / 17.9' → vendor Cisco, model C9200L, os 17.9; 'HP LaserJet M404dn' → vendor HP, model LaserJet M404dn; 'RouterOS 7.14' kept; 'Windows 11' kept (a type seed); 'IOS-XE' not split on its hyphen; 'Gi1/0' text not split; 'my old box' left as it is. Applying is one undo step and Undo restores the exact text.
- inventory.js, macVendorSuggestion: a Dell OUI gives 'Dell'. A locally-administered MAC (02:…) gives null, and so do a multicast MAC, an Intel Corporate (chip maker) NIC, VMware (virtual), two NICs from different vendors, and a MAC not in the table. A typed vendor is never replaced: the suggestion shows only as a placeholder and the node keeps vendor undefined until Use.
- inventory.js, firmwareFindings: two C9200L at 17.9.4 and one at 17.6.1 give one 'firmware' warn naming all three. 'v17.9.4' and '17.9.4' count as one version. A retired device is excluded, and so are devices with no model or no firmware. A different vendor with the same model is a separate group. Accepting it, then adding a fourth device of the model, reopens it. The finding is in the Findings tab, the report, and has:finding.
- tests/suites/csv.js additions: export headers include vendor and model before os. Importing a sheet headed 'Model' lands in model, not os; 'Manufacturer' lands in vendor; 'Model / firmware' still lands in os. The NIC-per-row merge refuses to merge rows that disagree on model.
- tests/suites/query.js additions: vendor:dell, model:c9200, fw:17.9, firmware: and os: aliases, has:vendor, has:model, has:fw. -vendor:cisco excludes. A suggested-only vendor does not match vendor: (mac:dell still does).
- tests/suites/bulk.js additions: Set fields lists Vendor and Model. 'Fill vendor from MAC' fills only blank vendors, its preview names the refused devices with reasons, and it is one undo step.
- tests/suites/table.js / columns.js additions: the Vendor and Model columns edit and validate. A saved tableView order without them shows them after Firmware / OS. The Inventory tab is offered only when a value exists, counts per value, and a row click selects those devices.
- tests/suites/sitereport.js / summary.js additions: inventorySection is printed only with data. The Model column joins vendor and model. Makes and models appear in the summary, translated. PLAIN_FINDINGS has firmware.
- tests/suites/i18n.js already enforces locale parity and placeholders for the new keys. changes.js: editing model shows 'Model' in changes since baseline.

**Stages**

- 1. Fields and upgrade: vendor/model in NODE_FIELDS, os relabelled 'Firmware / OS', v16 bump step, editor inputs and datalists, Devices table columns, CSV aliases/PLAIN/apartKeys, search prefixes and has:, QR label text, i18n, FEATURES.md. Change all works through bulk: true.
- 2. Split review: planModelSplit/applyModelSplit, the device editor's Split note, the Table toolbar's review dialog (one undo step), tests.
- 3. Vendor from MAC: macVendorSuggestion, the editor placeholder + Use, the muted table cell, the bulk 'Fill vendor from MAC' action, tests.
- 4. Firmware finding: firmwareFindings, check name, PLAIN_FINDINGS, accept/scope behaviour, tests.
- 5. Grouped inventory: reportInventory shared model, Table Inventory tab with By switch and row selection, report inventorySection, summary 'Makes and models', tests.

**Risks**

- The label on existing text changes. After the upgrade, an old file's combined 'Model / firmware' text sits under 'Firmware / OS' until the user runs Split. The Split note and the toolbar offer reduce this, but a model shown under the firmware label is possible until then. The alternative (auto-split in the migration) is rejected for data safety (Topo review G1, v7 precedent).
- Other backlog features may also raise DOC_VERSION. Whichever lands second must take the next number and append its step after this one. Never renumber a shipped step.
- Moving the 'model'/'modelo' CSV aliases off os changes how an existing sheet with a 'Model' column imports: it now lands in model instead of firmware. This is the intended behaviour, but worth a line in the import review.
- OUI misattribution: the curated table names NIC makers. Excluding chip makers and virtual prefixes keeps out the worst cases, but e.g. a Dell OUI on a USB dongle in a Lenovo still suggests Dell. That is why it stays a hint and is never written by itself.
- Firmware text varies ('17.09.04a' vs '17.9.4a'). The comparison key stays deliberately simple (case, spaces, a leading v), so some look-alike versions will count as different. The finding is advisory and acceptable with a reason.
- Table width: two more Devices columns. They are hideable through the existing Columns dialog. Phone layouts (stickycols, mobile review M-batches) need the 360/390 check.
- tests/suites list ~40 files touching os/'Model / firmware' (many through data.js seeds). Relabelling breaks label-string assertions in a few of them (schema.js, assets.js, table.js).

**Amendments (from the cross-check; these win over the text above)**

- inventory: 'VENDOR_WORDS: the OUI display names below plus Aruba, Juniper, …'. js/oui.js registers only about 35 vendor names (Apple … Docker (virtual)). There is no HPE/HP split, no Aruba, Hikvision, Axis, Supermicro, Fortinet, Juniper, Yealink or Synology, so macVendorSuggestion can only suggest those ~35. Printers, cameras and phones (the bulk of a register) mostly get no suggestion, and the spec's examples imply more coverage than exists. Topo cannot extend oui.js, which is shared with Hardware (oui.js:1-3).
- inventory: 'drop the unused Model / firmware key'. It is not unused today: it is translated in all four locales (js/i18n.js:1343, 2884, 4420, 5953), shown through t(label) in the table header and report column, and asserted in tests/suites/assets.js, csv.js and schema.js. It becomes unused only after the relabel, and the 'Firmware / OS' key is new and needs translating.
- Treat macVendorSuggestion as covering only the ~35 vendors in js/oui.js. Say so in the empty-suggestion text, and drop the implication that cameras, printers and phones get suggestions. Do not add a Topo-side OUI table (oui.js is shared with Hardware). Keep 'Model / firmware' as a CSV alias to os (as specced), add 'Firmware / OS' as a new i18n key in four locales, and update assets/csv/schema tests that assert the old label.
- The joined 'Model' report column needs an explicit override in reportColumns/devicesSection, because reportFieldsOf prints one field per column. Firmware finding scope: hash or prefix the model key so two long models cut to 64 characters cannot collide. Version: the next free number after capacity and reports.

**Open questions (defaults in "Decisions taken")**

- When the split runs, should it also be offered once, automatically, as a banner on opening a pre-v16 file that has candidates, or only from the Table toolbar and the device editor?
- Should the Simple summary's 'Makes and models' list appear at all, or stay technical-only?
- How should 'HP / HPE' OUIs be suggested: by device type ('HPE' for servers and network gear, 'HP' otherwise, as specced), or always as one name?

---

## 4. vlan

### VLANs, trunks and PoE modelled

Ports and NICs gain an untagged (native) VLAN and a list of tagged VLANs, which is what makes a trunk. Switch ports gain a PoE class or wattage, switches a PoE budget, and powered devices a PoE draw. Five new checks use these facts: a VLAN that cannot reach its gateway, an access VLAN with no subnet, two ends of a cable that disagree, a PoE device on a port that gives no power, and a switch over its budget. Trace can then follow one VLAN at a time. Any end with nothing recorded passes every VLAN, so existing files open with no new findings, and the Simple view gets no new fields.

**Already in Topo**

- js/model.js:154-170: the comment for port names, labels and access VLANs says outright that trunks, tagged VLANs and PoE are not modelled and nothing splits L2 by VLAN. This feature replaces that comment.
- js/model.js:192-205 normalizePortAttrs(): rebuilds each pN record key by key (label, vlan). New port facts go in here.
- js/model.js:215-221 portAttrOf()/hasPortAttrs(), and js/model.js:224-231 setPortAttr(), which only lets 'label' and 'vlan' through.
- js/model.js:1444: the NODE_FIELDS portAttrs field ('Port labels and VLANs'), read and written only while hasPortGrid() is true (js/model.js:41).
- js/model.js:1741 asVlan(): 1..4094, digits as text are read as a number. js/model.js:1761: NETWORK_FIELDS vlan, so a subnet already carries its VLAN.
- js/model.js:1352-1386 IFACE_FIELDS (id, name, ip, mac, wireless, bond, radio): the precedent for a raw field with omit, toText/fromText and a CSV cell (bond).
- js/model.js:1476-1481 serviceEvery/lifeYears: the precedent for a numeric raw NODE_FIELD with fromText, csv and bulk:true.
- js/model.js:380 bondOf(), js/model.js:378 isBond(): a cable lands on a member and the bond speaks for it.
- js/model.js:3794-3885: the version log and the rule for adding a step. js/model.js:4227 DOC_VERSION = 15. js/model.js:4371: last step 14->15. migrateDoc() at js/model.js:4386 opens a newer file read-only.
- js/model.js:15 isDumbDevice() (a switch or AP with no address) and js/model.js:16 isRoutingDevice().
- js/diagnostics.js:833 reachL2Domain(), :876 reachWalk() (queue entries {id, viaNet}), :952 calculateReachability(opts.port), :36 reachContext() (shared tails keyed by id plus viaNet at :41), :1003 updateTraceStatus().
- js/diagnostics.js:1129-1138: the relational findings list (ipConflictFindings ... providerFindings), the place new finders go. :1552 cablingFindings() is the sibling of the cable mismatch check. :544 evaluateGateway() resolves the gateway node with ctx.nodeByIp.
- js/diagnostics.js:1200 acceptedEntryFor() and the scope mechanism (v12/v14, comment at :1170-1190), used to scope a finding to a VLAN.
- js/report.js:609 reportPortMaps() and :1346 the port-map table, which adds Label and VLAN columns only when present (hasLabels/hasVlans at :648). js/report.js:1664 PLAIN_FINDINGS, the plain words for the Simple summary. js/report.js:448: the subnets section.
- js/csv.js:409-421 csvPortsSheet(), headers port_label and port_vlan. :534 heading aliases 'pt:vlan'. :740 'pt:vlan' parser. :909-910 port targets. :2399 csvPlanPorts(), with the label/vlan loop at :2445. :328-329 csvInterfacesSheet() with a hard-coded keys list. :293 csvDevicesSheet() (NODE_FIELDS with csv).
- js/query.js:254-264 qIfaceVlan/qPortVlan/qNodeVlan, :311-315 the vlan: prefix, :185 Q_HAS, :212 Q_HAS_IFACE.
- js/table.js:571-582: the Ports tab columns, with portColumn('vlan') as the precedent for new editable port columns.
- js/ui.js:1666 renderPortAttrs() (one line per port: name, label, VLAN), :1566 portAttrsSummary(), :1543 the port tooltip, :2213-2221 the facts on an interface row.
- js/rackview.js:660: the rk-pvlan tint on a port with an access VLAN. :675: the VLAN line in the port tip.
- js/changes.js:224 DIFF_SKIP and changedLabels(), and js/changes.js:355 interfaceChanges(), which already diff every NODE_FIELD and IFACE_FIELD by label.
- js/app.js:2843 syncTraceControls(), js/state.js:83 settings (traceMode, tracePort, tracePortOn, not persisted), index.html:721 #traceBox.
- js/data.js:605 and :652/:736: the samples draw an SVI per VLAN, one cable per VLAN interface. js/data.js:852-860: netNames sets network.vlan.

**Data model**

Document v16. Add MIGRATIONS {from:15,to:16,run:(doc)=>({...doc,v:16})}, raise DOC_VERSION to 16 and add a "v 16" entry to the version log. There is nothing to convert. A v15 build would drop every tagged list, PoE fact and budget on its next save, so it must open a v16 file read-only, which migrateDoc already does.

PORT (node.portAttrs.pN, switch/AP only, through normalizePortAttrs/setPortAttr/portAttrOf):
- `vlan` keeps its key and widens in meaning to "untagged / native VLAN". No migration is needed: an access port and a trunk's native VLAN are the same field.
- New `tagged`: the tagged VLANs as one canonical string, `"10,20,30-39"` (sorted, unique, ranges compressed, each 1..4094), or `"all"`. It is stored as text, not an array, so "1-4094" stays small in sealed links. A new `parseVlanList(text) -> {all:true} | Set | null` and `vlanListText(set|all)` sit beside asVlan (model.js:1741). A port with `tagged` is a trunk; there is no separate mode field ("trunk" is derived).
- New `poe`: what the port can give. One of `'af'` (15.4 W at the switch, 12.95 W at the device), `'at'` (30 / 25.5), `'bt3'` (60 / 51), `'bt4'` (90 / 71.3), or a number of watts at the switch (0.5..100, one decimal) for a non-standard port. Absent means no PoE is recorded on that port. A table `POE_CLASSES` holds both figures.
- portAttrOf returns {label, vlan, tagged:null|string, poe:null|value}. hasPortAttrs counts the new facts. setPortAttr's whitelist gains 'tagged' and 'poe'.

INTERFACE (IFACE_FIELDS, wired interfaces only, read/write gated on !ifaceIsWireless as radio is gated the other way):
- `vlan` (raw, omit, asVlan): the untagged VLAN when its address does not say. When unset, the effective untagged VLAN is the declared network's vlan for its IP. A bond member reads its bond's (bondOf).
- `tagged` (raw, omit, the same canonical string): router-on-a-stick, a hypervisor uplink, a NAS on a trunk. Its VLAN subinterfaces stay ordinary interfaces with addresses, as the SVIs at js/data.js:605 are. Nothing new is needed for them: a device "has" VLAN v when any of its interfaces is on a subnet whose vlan is v.

NODE (NODE_FIELDS, after portAttrs):
- `poeBudget` (raw, asPoeWatts 1..10000, written only while hasPortGrid; csv `poe_budget`, label 'PoE budget (W)', bulk:true, table:'edit').
- `poeDraw` (raw, 0.1..100 W; csv `poe_draw`, label 'PoE draw (W)', bulk:true, table:'edit'; not written on cloud, vm or container). Setting it is what makes a device PoE-powered. fromText takes "12", "12,5", "12 W" and "class 0".."class 8" (stored as the device-side maximum: 13, 3.84, 6.49, 13, 25.5, 40, 51, 62, 71.3).
- portAttrs label becomes 'Port labels, VLANs and PoE', which is the word js/changes.js prints.

Shared readers in model.js: `portVlans(node, ifaceId) -> {untagged:int|null, tagged:Set|'all'|null, known:bool}` for any end (port, NIC, bond member). `endCarries(node, ifaceId, v)` is true when the end is not known, untagged===v, or tagged has v.

CSV:
- ports sheet: headers become device_id, device, port, port_label, port_vlan, port_tagged, port_poe, connected_device, connected_port. Aliases: 'pt:tagged' (tagged vlans, trunk vlans, allowed vlans), 'pt:poe' (port poe, poe). A port_poe cell is written as af/at/bt3/bt4 or a number; it reads 802.3af, poe, poe+, poe++, type 3/4 and bare watts.
- interfaces sheet keys (csv.js:329) gain vlan and tagged_vlans.
- devices sheet gains poe_budget and poe_draw through NODE_FIELDS csv.
- A blank cell leaves a fact as it is, which is the existing rule.
- Export followed by import changes nothing. That has to hold for "all", for a range, and for a custom wattage.

**Interface**

SIMPLE VIEW: nothing new to see or type. The Simple samples have no VLANs (FEATURES.md:86), and none of these fields are offered there. The new findings reach a Simple user only the way relational findings already do: on a file built in the Full editor, through the map's marks, and in plain words in the Simple summary (new PLAIN_FINDINGS entries).

FULL EDITOR:
- Ports section (renderPortAttrs, js/ui.js:1666): each port line keeps name | label | VLAN (placeholder 'Untagged'). A ⋯ toggle opens a second line under the port with Tagged (text, e.g. "10,20,30-39" or "all"; red while invalid, put back on blur exactly as the VLAN field is at ui.js:1725) and PoE (a select: —, 802.3af, 802.3at (PoE+), 802.3bt Type 3, 802.3bt Type 4, Watts…). That line is open by itself on a port that already has either fact, so a 48-port list stays short at 360px.
- At the top of the open list, one line "Set on ports [1-24] [Tagged|PoE|Untagged] [value] Apply" is a single undo step and refuses a port the box does not have, using the same rule as csvPlanPorts at csv.js:2440.
- The summary line (portAttrsSummary, ui.js:1566) counts trunks and PoE ports: "Port labels, VLANs and PoE (12 · 2 trunks · 8 PoE)".
- Device section, switch or AP: 'PoE budget (W)' below the port count, with a live line "PoE: 47 of 120 W". Any powered type: 'PoE draw (W)'.
- Interface row (ui.js:2213): VLAN shows the subnet's value greyed ("Auto · 10 Staff", the same pattern as the Wi-Fi selects) until it is typed over. Tagged sits in the row's details. Wired interfaces only.
- Port tooltip (ui.js:1543) and rack tip (rackview.js:675) add "Tagged 10,20" and "PoE+ 30 W". The rk-pvlan tint (rackview.js:660) applies to a port with untagged or tagged facts.
- Link panel: both ends' VLANs, read-only, so a mismatch can be seen where it is.
- Table: Ports tab adds Tagged and PoE columns (portColumn, table.js:577). Interfaces tab adds VLAN (muted when derived) and Tagged. Devices tab adds PoE budget and PoE draw (table:'edit'). Change all edits poeDraw and poeBudget (bulk:true).
- Search: vlan:N also matches a port or NIC that carries N tagged (qPortVlan/qIfaceVlan, query.js:254-264). New has:trunk (a port or interface with tagged VLANs, and the device holding one) and has:poe (a PoE port, a device with a budget, a device with a draw), added to Q_HAS / Q_HAS_IFACE.
- Trace box (index.html:721, stage 3): a 'VLAN' tick next to Port filter, on by default, kept in state.settings.traceVlan and not persisted (js/state.js:83 rule). The status line reads "→ 5 devices · VLAN 10".
- Keys: no new shortcut.

**Checks**

New finding keys. Each goes in runDiagnosis's relational list (diagnostics.js:1129-1138), and each needs a PLAIN_FINDINGS entry and a check name. Retired devices are skipped in every one. A port or NIC with nothing recorded never takes part: it carries every VLAN, and a switch that records no PoE anywhere is never judged on PoE.

1. vlan-path (critical; scope = the VLAN number; nodeIds = the hosts, the gateway and the device where it stops; linkIds = the cable where it stops). The host's VLAN v is the untagged VLAN of the switch port it is cabled into, else its NIC's effective VLAN. A wireless client's v is its SSID's subnet VLAN, and its walk starts at its AP. From there, a BFS (`vlanPath`, model.js, no DOM) runs over cables between port-grid devices and passthrough links. It crosses a cable only when endCarries holds at both ends, and switches are crossed whether or not they have a management address. It succeeds on reaching the gateway node (ctx.nodeByIp(effectiveGw)) on an interface that carries v. The check only runs when evaluateGateway already says good, so it explains a VLAN problem rather than repeating an IP one. Hosts that fail at the same cable for the same VLAN are folded into one finding: "VLAN 20 does not reach its gateway Core L3: Switch A · Gi1/0/24 ↔ Core L3 · Gi1/0/1 does not carry it. On it: PC-1, PC-2."

2. vlan-subnet (advisory; scope = VLAN): an untagged VLAN on a port that no declared subnet has (state.networks[].vlan). There is one finding per VLAN, naming the switches and ports. Tagged-only VLANs without a subnet are left alone, because a transit VLAN is legitimate.

3. vlan-mismatch (per cable; linkIds = [link]):
- (a) switch port ↔ host NIC where both untagged VLANs are known and differ: critical. "PC-3 is on Staff (VLAN 10) but plugged into Switch A · 5, which is VLAN 20." This is the VLAN sibling of cablingFindings.
- (b) port ↔ port with different native VLANs: critical.
- (c) a VLAN tagged at one end and not the other, or one end tagging what the other end sends untagged: advisory, listing the VLANs.
- Wireless and VPN links are skipped, as effectiveMedium is in cablingFindings.

4. poe-none (critical): a device with poeDraw, cabled exclusively (isExclusiveLink) to a port on a switch or AP that has a poeBudget or any port with poe, where that port has no poe. A sister message at advisory: the draw is more than the port class gives at the device ("asks 25.5 W; Switch A · 7 is 802.3af, 12.95 W at the device"). A device cabled to a router NIC or a non-PoE-documented switch is not judged; injectors are what Accept is for.

5. poe-budget (critical; nodeIds = the switch plus its powered devices): the sum of poeDraw over non-retired devices cabled to the switch's PoE ports is more than poeBudget. Detail: "Switch A: 134 W drawn of a 120 W budget (8 devices)." A further note, info only and not counted: between 90% and 100% of the budget, the way service-due works.

**Report**

Technical details:
- The port map (reportPortMaps, report.js:609; table at :1346) adds Tagged and PoE columns, each only on a switch whose ports have them (the hasLabels/hasVlans pattern). The VLAN header reads 'Untagged' only when the Tagged column is also there.
- The block heading gains "PoE: 47 of 120 W budget" when the switch has a budget.
- A new 'VLANs' section after Subnets, printed only when any port or interface has tagged VLANs: one row per VLAN with its subnet (name and CIDR), its gateway, how many access ports it has, and the trunks that carry it, listed by switch and port.
- The inventory line of a powered device adds "PoE 6.5 W".
- The findings list carries the new keys like any other.
- The changes section picks the new fields up by label (changes.js changedLabels/interfaceChanges).

Simple summary: no new section. PLAIN_FINDINGS gets five entries, for example:
- vlan-path: "Part of the network cannot reach its way out" / "The devices on it cannot reach the internet or the other networks, because a link between the switches does not carry it."
- vlan-mismatch: "A device is plugged into a port set up for another network".
- poe-none: "A device that takes its power from the network cable is on a port that gives none".
- poe-budget: "A switch is asked for more power than it can give" / "Some devices will switch off or restart."

**Translations**

About 75 new strings in each of the four non-English locales.
- About 12 field and UI labels: 'Tagged', 'Untagged', 'PoE', 'PoE budget (W)', 'PoE draw (W)', 'Trunk', 'All VLANs', 'Set on ports', 'Apply', 'Watts…', 'Port labels, VLANs and PoE', 'PoE: {used} of {budget} W'.
- About 8 sentences: the invalid tagged list, port range errors, and the CSV review messages.
- About 30 MESSAGES finding texts. Each has a singular and plural form ('{n} device' / '{n} devices'), as the existing keys do (diagnostics.js:249).
- 5 check names: 'VLAN path', 'VLAN subnet', 'VLAN mismatch', 'PoE power', 'PoE budget'.
- 10 PLAIN_FINDINGS sentences.
- About 10 report strings: 'VLANs' section headers, 'Access ports', 'Carried on'.

The tricky parts:
- VLAN, PoE, 802.3af/at/bt, 'Gi1/0/1' and 'Trunk' stay English in the Full editor (FEATURES.md:9). The sentences around them are translated, and so are the PLAIN_FINDINGS, which must avoid the words VLAN and PoE altogether.
- Russian needs the three plural forms for device counts.
- Japanese says "PC".
- Watts are written with a space and the locale's decimal comma, as cable lengths already are.
- tests/suites/i18n.js already enforces that every MESSAGES key is in every locale with its placeholders.

**Files**

- js/model.js: parseVlanList, vlanListText, POE_CLASSES, asPoeWatts and poeFromText next to asVlan (:1741). normalizePortAttrs (:192), portAttrOf (:215), hasPortAttrs (:221), setPortAttr (:224). IFACE_FIELDS vlan/tagged (:1352). NODE_FIELDS poeBudget/poeDraw and the portAttrs label (:1444). portVlans/endCarries/vlanPath helpers. DOC_VERSION 16 and the MIGRATIONS step (:4227, :4371), with the version log entry (:3794-3885). Rewrite the comment at :154-170.
- js/diagnostics.js: vlanFindings() and poeFindings(), added to runDiagnosis (:1129-1138). Stage 3: reachL2Domain(originId, vlan) (:833), the VLAN on each entry in reachWalk (:876), from viaNet through the declared network, so the tails key in reachContext (:41) stays valid. calculateReachability opts.vlan (:952). updateTraceStatus (:1003).
- js/ui.js: renderPortAttrs (:1666) second line and 'Set on ports' row, portAttrsSummary (:1566), port tooltip (:1543), interface row facts (:2213), device section PoE fields, link panel end VLANs.
- js/table.js: Ports tab Tagged/PoE (:571-582), Interfaces VLAN/Tagged, Devices PoE columns via schemaColumn.
- js/csv.js: csvPortsSheet headers and rows (:409-421), aliases (:534), parsers (:740), targets (:909-910), csvPlanPorts field loop (:2445) and its CSV_MIXED_PORTS sentence (:1318), csvInterfacesSheet keys (:329), interfaces import.
- js/query.js: qPortVlan/qIfaceVlan carry tagged (:254-264), Q_HAS trunk/poe (:185), Q_HAS_IFACE trunk (:212), header comment (:19-44).
- js/rackview.js: port tip lines (:675), tint class (:660).
- js/report.js: reportPortMaps (:609) and its table (:1346), a new reportVlans() section after subnets (:448), PLAIN_FINDINGS (:1664), the inventory PoE line.
- js/app.js: syncTraceControls (:2843) plus a #traceVlan listener (stage 3). js/state.js:83 traceVlan default true. index.html:729 the trace-port-row gains the VLAN tick.
- js/i18n.js: every new string in es, pt-BR, ja, ru (MESSAGES for findings and report).
- js/data.js: the Full Showcase (or Imaging) gains one trunk between two switches, a router-on-a-stick or SVI uplink with tagged VLANs, and PoE phones or cameras on a budgeted switch, still with no findings.
- README.md:24 and :37 (drop 'Not a VLAN model'), docs/FEATURES.md:28 (Ports), :30 (Checks), :38 (Trace), :57 (Search), :69-70 (CSV), :77 (report).

**Tests**

- New tests/suites/vlanmodel.js: parseVlanList/vlanListText round trip ('30-39,10,20,20' -> '10,20,30-39', 'all', '0' and '4095' refused). normalizePortAttrs keeps tagged and poe and drops junk. Wireless interfaces never write vlan/tagged. poeBudget is not written on a PC. A v15 file opens at v16 unchanged. A v16 file in a build pretending to be v15 opens read-only (compat.js pattern). Sealed link round trip (groupseal/wifiseal pattern).
- New tests/suites/vlancsv.js: export then import of the ports, interfaces and devices sheets changes nothing (tagged 'all', ranges, custom watts, class-to-watts). 'poe+' reads as 'at'. A port the box does not have is a conflict. Two rows that disagree on tagged are a conflict.
- New tests/suites/vlanchecks.js: an untagged-only file gets no vlan findings. A trunk without the VLAN gives one vlan-path finding, scoped, naming the stopping cable and folding hosts. Adding the VLAN to the trunk clears it. A wireless client's SSID VLAN missing on the AP uplink is flagged. A host on the wrong access port gives vlan-mismatch (a). A native mismatch gives (b). vlan-subnet appears once per VLAN. Accepting with a scope covers only that VLAN.
- New tests/suites/poechecks.js: a device with a draw on a non-PoE port of a PoE-documented switch is critical. On an undocumented switch there is no finding. An af port with a 25.5 W device is advisory. A budget over is critical, the 90% note is not counted, and a retired device's draw is not counted.
- New tests/suites/vlantrace.js: with no VLAN facts, a VLAN-aware trace equals today's trace on every template (the findings.js comparison pattern). With facts, the trace from a VLAN 20 host does not light VLAN 10 hosts behind a trunk that lacks 20. Unticking VLAN gives today's result. The checks' reachContext is unchanged (findings.js composed-versus-single walk assertion still holds).
- Extend tests/suites/samples.js: the updated Full samples still open with zero findings. Extend tests/suites/query.js: vlan:20 matches a trunk carrying 20, plus has:trunk and has:poe. Extend tests/suites/report.js and sitereport.js: Tagged and PoE columns appear only when present, and the VLANs section appears only with tagged VLANs. Extend tests/suites/ports.js and table.js: the second port line, Set on ports as one undo step, and Ports tab columns that are editable and refuse bad input. Extend tests/suites/changes.js: a tagged change is listed under the interface and port labels.

**Stages**

- Stage 1a (model and file format, no UI): v16, the port, interface and node fields, normalize, write and read, CSV columns for all three sheets, changes labels, and the search additions (vlan: matches tagged, has:trunk, has:poe). It can ship alone: files and sheets round-trip, nothing visible changes, and there are no checks yet.
- Stage 1b (editor UI): switch ui.js (faceplate noted dots, portAttrsSummary) and report.js (free-port rows in reportPortMaps) from hasPortLabelOrVlan back to hasPortAttrs once the tagged/PoE columns show; the port editor's second line and 'Set on ports', the PoE fields on the device, VLAN/Tagged on wired interface rows, table columns, tooltips, rack tip and tint, the link panel's end VLANs, report port-map columns, the PoE budget line, the report VLANs section, the README and FEATURES text, and the i18n for all of these.
- Stage 2a (VLAN checks): vlanPath/endCarries, the vlan-path, vlan-subnet and vlan-mismatch finders, PLAIN_FINDINGS, and the Full sample gaining a clean trunk. Unknown ends stay transparent, so existing files and every template stay finding-free.
- Stage 2b (PoE checks): poe-none, poe-budget and the near-budget note, plus PoE devices in the Full sample.
- Stage 3 (VLAN-aware Trace): reachL2Domain and reachWalk take the VLAN being walked. It is the start's access VLAN, and after a router hop the VLAN of the declared subnet it hops into (viaNet), so the tail cache key is unchanged. A router or L3 neighbour is reached only through an interface that carries that VLAN. A start router walks each interface with its own VLANs. This is used by the Trace only, behind the VLAN tick (on by default). The findings' reachContext stays VLAN-blind, so VLAN breaks are reported once, by vlan-path, and the gateway and DNS checks do not change. Out of scope: STP blocking, VTP/pruning, private VLANs, QinQ, voice-VLAN by LLDP, and native-VLAN tagging.

**Risks**

- Already in the code, not verified in a browser: isDumbDevice (js/model.js:15) treats a switch or AP that has a management address as not dumb. reachL2Domain (js/diagnostics.js:833) then stops at it, and reachWalk never passes the walk on through a non-routing neighbour (onward is false for type 'switch'). So hosts behind a switch with a management IP probably fail their gateway check today. No sample has such a switch (grep of js/data.js), so tests would not catch it. vlanPath must cross every port-grid device whatever its address, and stage 3 has to decide whether the Trace does the same. That would change today's trace, so it needs its own test and the owner's agreement. (Resolved: landing order step 6, done 2026-11-04.)
- Existing files that wrote an access VLAN on an uplink port (as a label rather than a native VLAN) will get new vlan-path or vlan-mismatch findings once stage 2a lands. Mitigation: unknown ends are transparent, findings can be scoped and accepted, and the release note should say this.
- The samples model a VLAN-capable router as one cable per VLAN interface (js/data.js:605, :652, :736). The derived untagged VLAN of each such interface must equal the far port's, or the samples get findings. The samples suite is the guard.
- Stage 3 performance: walking one VLAN at a time multiplies L2 walks on trunked networks. Mitigation: cache each L2 domain by (node, VLAN) inside one pass, and keep the checks on the VLAN-blind walk.
- Port editor density at 360px: a second line per port could make a 48-port list unusable. It stays folded unless the port has the facts, and 'Set on ports' covers bulk edits.
- Keeping `tagged` as canonical text means every reader must go through parseVlanList. A reader that splits the string itself would bring back the formula and ';' traps (FEATURES.md:69).

**Amendments (from the cross-check; these win over the text above)**

- vlan: 'pt:poe aliases (port poe, poe)'. The bare 'poe' alias contradicts the explicit rule at js/csv.js:530-532 against bare aliases that turn an inventory sheet into a ports sheet.
- vlan risk 1 is confirmed by code, not just plausible: reachL2Domain crosses only isDumbDevice nodes (js/diagnostics.js:846; isDumbDevice = switch/ap with no valid IP, js/model.js:15). reachWalk then makes a managed switch a candidate (:907) whose onward is false (:929-932: non-routing, and hostRoutesFor needs a virtual guest). As a result, vlan-path, which 'only runs when evaluateGateway already says good', can never run behind a switch with a management address, which is the normal case on exactly the VLAN networks it targets. (Resolved: landing order step 6, done 2026-11-04.)
- Remove the bare 'poe' alias, and keep only 'port poe', 'poe class' and 'port power' for pt:poe, per js/csv.js:530-532. Check that an interfaces.csv 'vlan' heading is not classified as subnet data. Make the managed-switch L2 forwarding fix a separate prerequisite (order step 6), and do not run vlan-path only behind evaluateGateway=good until it lands.
- Put the PoE 90-100% note in capacity's capacityFindings and show the PoE budget in the Capacity section. Coordinate the reportPortMaps edits with capacity (they share :609-675). Update locate's leg to read tagged/untagged. Version: the last bump in the chain.

**Open questions (defaults in "Decisions taken")**

- Should a port or NIC with no VLAN recorded carry every VLAN (proposed: yes, so no existing file gains findings), or should a switch with any VLAN facts treat its unrecorded ports as untagged VLAN 1, which is stricter but would flag half-documented sites?
- Should going over the PoE budget be critical (proposed: devices will lose power) or advisory? And should the Trace's VLAN filter be on by default (proposed: yes, with today's behaviour one untick away)?
- Should a switch with a management address count as a forwarding switch in the Trace too (fixing the reachL2Domain/isDumbDevice gap above), as part of stage 3 or as a separate fix first? (Resolved: landing order step 6, done 2026-11-04.)

---

## 5. history

### Address and location history (per-device trail kept beside the card, recorded at back-up and report)

Each time a kept network is backed up or its report is handed over, Topo notes, for every device, its addresses, MACs, the switch and port it is plugged into, its group and its name. These notes are stored as compact "spans" (value, first seen, last seen) in a browser-only store next to the existing change baseline, never in the document, a link, a binder or a sheet. The Full editor's device panel gains a History section, and search gains `was:` (plus `has:history`) for past values. Older back-up files of the same network can be read into the history without changing the card.

**Already in Topo**

- js/changes.js:1-29: design note that rejects a change log written into the document (doc.log) for privacy, because it would travel in every link, file and binder. This feature follows the same rule.
- js/changes.js:31-41 + idbSnapshotAdapter() :54 + openSnapshotStore() :103 + adoptSnapshotStore() :113 + listenForSnapshots() :158: IndexedDB database of its own (nettopo_snapshots), tab-only fallback when IndexedDB is missing, BroadcastChannel sync between tabs, validSnapshot() :44 treats disk records as outside input. The trail store copies this pattern exactly.
- js/changes.js:191 takeSnapshot(id, kind, doc) and :205 dropSnapshot(id): the single moment a baseline is taken (kinds 'backup' | 'report'). The trail recorder hooks the same calls.
- Callers of takeSnapshot: js/app.js:2920 exportJsonFile() (single back-up), js/library.js:940 recordBinderExport() (binder back-up), js/report.js:2133 and :2232 buildSiteReport()/binder report onKept (report handed over). Card delete: js/library.js:593 calls dropSnapshot.
- js/changes.js:234 docChanges() + :346 interfaceChanges(): match by id through canonicalDoc(), so older baselines migrate before comparing. The recorder uses canonicalDoc() the same way.
- js/library.js:1674 askAboutKnownCopy(): 'update' / 'copy' / 'mine' choices when a file of a known card is opened. js/app.js:2950-2972 applyImportedDoc() acts on them. This is where an older back-up file can be read into the history.
- js/library.js:1716 docIdentity() / :1724 stripIdentity(): a file carries the card id, which ties older .nettopo files to the card's trail.
- js/csv.js:279 csvUplink(node, forSheet): the 'switch' + 'port' a device is plugged into (lowest-named peer with a port grid, then lowest port). It reads state (linksAtNode/getNode), so the recorder needs a version that works on a document.
- js/model.js:147 ifaceLabel(node, ifaceId), :3286 nodePlaceText()/groupPathOf(node, groups), :315 normMac(), :1352 IFACE_FIELDS (ip, mac), :1631 LINK_FIELDS (sourceIface/targetIface): all usable on a plain document node.
- js/query.js:306 Q_PREFIXES, :352 qKnown, :369 parseQuery, :185 Q_HAS, :215 qIpPrep/:222 qIpMatch, :241 qMacPrep/:245 qMacMatch: the new prefix plugs in here. Prefixes stay English (comment at :50-53).
- js/ui.js:2545 select() → renderAssetFields (js/assets.js:152) and index.html:537 <details id="assetGroup" class="asset-group" data-adv open>: the collapsible, Full-editor-only panel group the History section copies.
- js/library.js:1472/1525 card line and '±' tool (cardChangesText/showCardChanges): where 'Clear history' sits on the landing card.
- js/app.js:1431-1500 _undoStack/undo()/redo() go through save() and hold document states only. The trail is outside them.
- tests/suites/changes.js, changesidb.js, perf.js (300-device fixture tests/fixtures/site300.js), privacy.js: the suites the new ones are modelled on. Note that tests/suites/history.js is the undo suite, so the new module and suite must not be called history.js.

**Data model**

DOCUMENT: no change. DOC_VERSION stays 15 (js/model.js:4227), and serializeDoc, the card, the binder, share links and the sheets carry nothing new, by the same decision js/changes.js:1-17 made. So there is no upgrade step for older files. An older file still matters as a source: it can be read into the trail (stage 4).

NEW BROWSER STORE: IndexedDB database 'nettopo_trail', object store 'trails', key = card id, in its own database so the library and the snapshot schemas are untouched. Without IndexedDB it lives in an in-memory Map for this tab only (never the localStorage fallback, for the quota reason at js/changes.js:21-24). Record:
{ v: 1, points: [{ at, kind }], devices: { [nodeId]: { name, gone: at|null, spans: [ { f, k, val, txt, first, last, kind } ] } } }
- points: when something was recorded. kind is 'backup' | 'report' | 'file' (an older back-up read in). Sorted. At most 200 kept; trimming the oldest point drops spans whose `last` is before the oldest kept point.
- f: field. 'ip' (interface address as typed, CIDR included), 'mac' (normMac), 'port' (uplink), 'group' (group id), 'name'.
- k: sub-key. Interface id for ip/mac (so a NIC's address history follows the NIC, not its position); '' for the others.
- val: the value compared and searched. For ip/mac, the normalised value. For port, `${peerId}|${portId}` (pN), so a switch rename is not a move. For group, the group id. For name, the text.
- txt: how it read at that time, for display and text search. For port, 'SW-02 · Gi1/0/12' (peer name + ifaceLabel). For group, the path from groupPathOf.
- first/last: timestamps of the first and last points that saw this value. kind: the point kind of `last`.
Recording a point at T: build an observation of the document as it went out (canonicalDoc, then per node: interfaces → ip/mac, a doc-level uplink, group path, name). For each (node, f, k): if the newest span has the same val, extend `last = T`; else push a new span {first: T, last: T}. Inserting an older point (stage 4) does the same at the right place: it extends a neighbour with the same val, or splits a span with a different val around T. A node missing from the observation gets `gone = T`; one that comes back clears it.
Retention: at most 16 spans per (node, f, k), the oldest dropped first. A gone device is pruned 400 days after its last span. A hard cap of 6,000 spans per card prunes gone devices first, then the oldest spans. Estimate for 300 devices × 5 fields × a few changes: about 100-300 KB per card. A card's trail goes when the card is deleted (next to dropSnapshot at js/library.js:593).
CSV: no new column. History is not a document field, and an import never writes the trail; the 'round-trips through CSV and .nettopo' rule covers document fields. An export-only history sheet is an open question.
UNDO: the trail is never an undo step and undo never changes it. A point records what went out in a file or a handed-over report, which is a fact undo cannot take back. Edits between points are not recorded, so typing an address and undoing it leaves no trace, and the panel shows the current value from the document with the recorded past below it.

**Interface**

FULL EDITOR, device panel: a new <details id="historyGroup" class="asset-group" data-adv> after #assetGroup (index.html:537). Its open/closed state is kept in this browser, like the Asset group. The summary reads 'History' plus a note '{n} past values'. In the body, one block per field that has more than one value or a value different from today's: 'IP / CIDR (eth0)', 'MAC (eth0)', 'Switch port', 'Group', 'Name'. Field labels come from the schema and stay English in the full editor, as js/changes.js changeRows does. Each past value is one line: '192.168.1.20 · 2026-03-02 → 2026-09-14', with the kind as a muted word ('back-up' / 'report' / 'file'). A value line is a button that puts `was:"<value>"` in the search box (setQuery, js/query.js:491). When another current device's history holds this device's current address or MAC, one line under the IP block says 'Was {name}'s until {date}' (address reuse, a hint only). Empty state: 'Nothing recorded yet: Topo notes this device's addresses, MAC, switch port and group each time the network is backed up or reported.' A network that is not kept, or is read-only, shows 'History is kept only for networks kept in this browser.' A 'Forget this device's history' button opens a confirm dialog (dialog.js) and is not an undo step. In a multi-selection the section is hidden.
SIMPLE VIEW: no History section by default. The reduced views drop data-adv blocks (tests/suites/simple.js), which keeps Simple as it is. Whether Simple gets a plain one-liner is an open question.
SEARCH (full editor): `was:<value>` matches a current device whose trail holds a value that matches but is no longer its value for that field. The value is read the way plain text is: an IPv4/IPv6 address or network goes through qIpPrep/qIpMatch on ip spans; hex with separators goes through qMacPrep/qMacMatch on mac spans; anything else is matched with qHas against the txt of port, group and name spans. `has:history` finds devices with any past value. When `was:` matches a removed device (gone), the line under the box says 'Also held by removed device {name} until {date}.' That device cannot be drawn, so it is not a match on the map. On a network that is not kept, `was:` is understood and matches nothing, and the line says 'No history is kept for this network.'
LANDING card: the card's '⋯' tools gain 'Clear history', with a confirm. Nothing new shows on the card face, which keeps the 'silent at zero' rule (js/changes.js:458).
SETTINGS (browser preference, js/settings.js): 'Keep address history at back-ups and reports', on by default; see the open question. Off stops recording and keeps what is there.
OPENING AN OLDER FILE of a known card (askAboutKnownCopy, the 'yours is newer' branch): a third choice 'Add to its history' records the file as a 'file' point at its doc.updated and leaves the card and the canvas alone.

**Checks**

None. No new finding, on purpose. The findings pipeline (diagnostics.js) is worked out from the document, so a recipient of the file or link sees the same findings and accepted/pinned findings match by check (js/changes.js:322 noteKey). A finding built from browser-only history would differ from one browser to the next, could not be accepted in a way that travels, and would make the report depend on local state. Address reuse ('this address was CAM-03's until …') is shown only as a hint line in the History section, not in the Findings tab, on the map or in the report.

**Report**

By default, nothing: the site report and the Simple summary are byte for byte as before. 'Changes since the last back-up/report' (js/report.js:1920, changesSection) already says which devices changed their IP/MAC/port. Stage 5 (optional) adds a technical-part-only 'Address history' section that is off by default (a reportParts toggle, js/report.js), listing per device the spans recorded since the previous report point. It appears only when the network is kept and has a trail, as reportChanges does at js/report.js:2123. The Simple summary never gains it.

**Translations**

About 30 new strings, each in en/es/pt-BR/ja/ru with the English as the key: 'History', '{n} past value'/'{n} past values' (plural forms, which ru needs three of, through the existing plural mechanism in tests/suites/plurals.js), 'back-up', 'report', 'file', 'Switch port', 'Was {name}'s until {date}', 'Nothing recorded yet: …' (long), 'History is kept only for networks kept in this browser.', 'Forget this device's history', its confirm text, 'Clear history', its confirm text, 'Add to its history', 'Also held by removed device {name} until {date}.', 'No history is kept for this network.', 'Keep address history at back-ups and reports', a settings hint, the date-range format '{from} → {to}', 'since {date}', and the optional report heading 'Address history' with its lead sentence. Field labels (IP / CIDR, MAC, Group, Name) reuse the existing schema labels and stay English in the full editor. Tricky parts: the possessive in 'Was {name}'s until {date}' needs a different word order in ja/ru ({name} の…, принадлежал {name}), so write it as one whole-sentence template; dates use localDateOf (js/changes.js:427) so they read the same in every locale; the 'was:' prefix itself is syntax and is not translated.

**Files**

- js/trail.js (new, loaded after js/changes.js at index.html:1650): idbTrailAdapter(), openTrailStore(adapter, ms), adoptTrailStore(), listenForTrails() (BroadcastChannel 'nettopo_trail'), validTrail(), observeDoc(doc) (pure: canonicalDoc → per-node observation, with a doc-level uplink index), recordPoint(id, kind, doc, at), mergeObservation(trail, obs, at, kind), pruneTrail(trail), dropTrail(id), forgetDevice(id, nodeId), trailOf(id), deviceTrail(id, nodeId), trailValueIndex(id) (memo by trail's newest point), window.CarinoTrail for the suites
- js/changes.js: takeSnapshot() :191 also calls recordPoint(id, kind, doc), so every existing back-up and report caller records with no new call sites. dropSnapshot() :205 is joined by dropTrail().
- js/csv.js: lift the uplink choice out of csvUplink() :279 into a pure uplinkIn(node, linksByNode, nodesById, forSheet) that both csvUplink and observeDoc call, so the sheet's 'switch/port' and the history's 'Switch port' cannot drift apart. The function moves to js/model.js, since trail.js loads before csv.js.
- js/app.js: boot next to openSnapshotStore() :3347 calls openTrailStore(). applyImportedDoc() :2950-2972 handles the 'history' choice by calling recordPoint(known.id, 'file', doc, ident.updated).
- js/library.js: askAboutKnownCopy() :1674 gains the 'Add to its history' choice in the older-copy branch. Card delete (:593) calls dropTrail. The card tools (:1525) gain 'Clear history'.
- js/ui.js: select() :2545 calls renderHistoryFields(node) for type 'node'. renderHistoryFields lives in js/trail.js.
- index.html: the #historyGroup details after #assetGroup (:537), and the script tag
- js/query.js: Q_PREFIXES :306 gains `was` (prep that detects ip/mac/text, node predicate reading trailValueIndex), Q_HAS :185 gains 'history', updateQueryBar :529 gets the removed-device and 'no history kept' lines, and the header comment :8-45 is updated
- js/settings.js: the 'Keep address history' toggle
- js/report.js (stage 5 only): a reportParts toggle and an addressHistorySection()
- js/i18n.js: the strings for the five locales
- css/app.css: .hist-line, .hist-kind (reusing the .asset-group styles)
- docs/FEATURES.md: a History bullet next to the 'Back up … changes since' bullet (:95), the Search bullet (:57) gains was:/has:history, and the Privacy paragraph (:116) says where history lives
- tests/README.md: list the new suites

**Tests**

- tests/suites/trail.js: observeDoc() on a fixture gives ip/mac per interface id, a port as peerId|pN with txt 'SW · Gi1/0/12', a group path and a name. Two points with an address change give two spans with the right first/last; an unchanged value only extends last. Renaming a switch is not a port change (val stays the same, txt keeps the old label). A device removed gets gone set, and one re-added clears it. Retention: 17 changes keep 16 spans; 201 points keep 200 and drop stale spans; the 6,000-span cap prunes gone devices first. An older point inserted between two spans with different values splits/extends correctly, and inserting the same point twice is idempotent.
- tests/suites/trail.js (hooks): exportJsonFile, recordBinderExport and a report's onKept each record exactly one point of the right kind. A report that is only previewed records none. A network that is not kept, a read-only document or the setting off record none. Deleting a card drops its trail. Undo/redo after a back-up leave the trail unchanged, and _undoStack holds no trail data.
- tests/suites/trailidb.js (modelled on changesidb.js): IndexedDB adapter round-trip, the open deadline (tab-only fallback), BroadcastChannel delivery to a second store instance, invalid disk records skipped by validTrail, and the library and snapshot databases untouched.
- tests/suites/privacy.js (extend): after recording, serializeDoc(), identifiedDoc(), the binder file, a share link payload and every CSV sheet contain no trail key and none of the past-only values planted in it.
- tests/suites/query.js (extend): was:192.168.1.20 finds the device that had it and not the device that has it now; was:10.0.0.0/24 works as a network; was:aa-bb-cc… matches a MAC with any separators; was:"rack 3" matches a past group path; has:history; on a network that is not kept, was: is understood (no error) and matches nothing; a removed holder produces the line under the box.
- tests/suites/simple.js (extend): #historyGroup is absent or hidden in #simple/#imagenology.
- tests/suites/perf.js (extend, @realtime): on site300, recordPoint takes under 30 ms, select() with the History section stays inside the existing panel budget, and a was: query over 300 devices with a 20-point trail stays inside the search budget.
- tests/suites/i18n.js: the new keys exist in all five locales (the existing completeness check).

**Stages**

- 1. Store and recorder: js/trail.js (adapter, open/adopt/listen, observeDoc, recordPoint, retention, dropTrail), uplinkIn() lifted out of csvUplink, and the hook in takeSnapshot/dropSnapshot plus the Settings toggle. Users see nothing yet; trails start filling at back-ups and reports. Suites: trail.js, trailidb.js, the privacy extension.
- 2. Device panel History section (#historyGroup, renderHistoryFields, the address-reuse hint, Forget this device's history) and the landing card's Clear history, with i18n for those strings.
- 3. Search: the was: prefix, has:history, the removed-device and no-history lines under the box, and the FEATURES.md Search bullet. Suites: query and perf extensions.
- 4. Reading older back-ups: 'Add to its history' in askAboutKnownCopy/applyImportedDoc (and the same choice in the binder import path for sites whose card is newer), inserting 'file' points in time order.
- 5. (Optional, owner's call) The technical-report 'Address history' section, off by default.

**Risks**

- History lives in one browser. Moving to another machine with a binder or file brings the networks but not their history, the same trade-off the change baseline already makes (FEATURES.md:95). Stage 4 helps (old back-ups can be read in), but users may expect it to travel. FEATURES.md and the empty-state text must say so plainly.
- Address points come only from back-ups and reports, so an address changed and changed back between two back-ups leaves no trace. The panel says 'recorded at back-ups and reports' so it is not taken for a full log.
- uplinkIn() refactor: csvUplink feeds the devices sheet, and a change in its tie-breaking would change CSV output. The csv suites must pass unchanged, and the lift should be a pure move.
- Two tabs backing up at once: last-writer-wins on the whole record could lose a point. Merge on adopt (union of points, re-merge spans) the way adoptSnapshotStore compares `at`, or accept the loss of one point.
- Storage: about 300 KB per large card in IndexedDB is fine, but many cards in a near-full quota could make the trail write fail. A failed write only warns (like writeSnapshot) and must never raise the networks' storage banner.
- IDs: history follows node and interface ids. A device deleted and redrawn (new id) starts a new trail, and a CSV import that matches by MAC/IP keeps the id. That is expected but may surprise people.
- Name collision: tests/suites/history.js is the undo suite, so the new code must use 'trail' for files and globals to avoid confusion.

**Amendments (from the cross-check; these win over the text above)**

- Use the shared uplinkOf (locate's), not a separate uplinkIn. Mark the 'was' prefix and has:history as browser-local (for example def.local = true) so saved searches (reports) can refuse to print them. Check state.readOnly in recordPoint, since takeSnapshot does not. Add a perf test for a binder back-up recording every card.

**Open questions (defaults in "Decisions taken")**

- Should history ever travel? Options: never (this spec, matching the changes baseline's privacy rule), or an opt-in 'include history' in Back up that writes a doc v16 `trail` key and is stripped from share links. The second makes a new DOC_VERSION, an upgrade step and privacy-suite exceptions.
- Is history recording on by default (this spec) or off until the user turns it on in Settings?
- Should the Simple view show a plain one-line 'Before: 192.168.1.20 (until 14 Sep)' under the device, or keep history Full-editor only (this spec)? Ruled 2026-11-05: optional, off by default, a few plain sentences behind a Settings box (see "Decisions taken", History in the Simple views). (done 2026-11-05)
- Should there be an export-only history sheet (history.csv) in the spreadsheet export, ignored on import, and the optional report section (stage 5)?

---

## 6. reports

### Saved searches, printed as report sections

A search typed in the full editor's box can be saved under a name in the network (doc.searches). Each saved search keeps its query in the existing search language, the Devices-table columns to print, an optional sort, and a "print in the site report" flag. The technical sheet then prints each flagged search as its own section: a table of the matching devices, counted to the report's date like everything else in the report. Saved searches round-trip through .nettopo (document v16), share links, binders and a new searches.csv sheet.

**Already in Topo**

- js/query.js:369 parseQuery(text) -> { terms, errors } and js/query.js:433 queryMatch(query, 'node', n) match one device and do not depend on state.query, so a saved query is evaluated without touching the live box. js/query.js:442 activeQuery() returns null in a reduced view (isReduced), which is why report code must call parseQuery/queryMatch directly instead
- js/query.js:161-200 has:finding/critical/advisory read currentDiagnosis() through qLevels(), counting open findings only (isCountedFinding). js/diagnostics.js:2075 currentDiagnosisNow() bypasses its memo when checksDay is not today, so inside reportModel's onChecksDay (js/report.js:805) a saved has:finding counts to the report's date
- js/query.js:491 setQuery(text) applies a query from code and drops the coalescer's pending draw, so opening a saved search is a single call
- js/query.js:529 updateQueryBar() (count, the 'Not understood' line, the buttons) and index.html:901-915 #queryBar/#queryTools/#queryError (data-adv, full editor only)
- js/table.js:374 TV_COLS.devices: every Devices column with a stable key (name, type, ifaces, gw, dns, os, assetTag, serial, group, host, location, status, inService, serviced, serviceEvery, lifeYears, age, nextService, ports, nat, notes...) and a show(row) cell renderer. js/table.js:737 customColumn(def) gives custom columns the key x:<id>
- js/table.js:856 tvBuildRows('devices') builds rows straight from reportDevices() ({ rec:'node', ref:{nodeId}, data:d }), so the report model's device rows are exactly what the table's cell renderers read
- js/table.js:880-898 compareRows(col, a, b) and js/table.js:901 tvSortedRows: the table's sort by text/ip/num/port with blanks last (the global _tvSortDir)
- js/model.js:4213 TABLE_VIEW_KEY_RE and normalizeTableView/serializeTableView: the precedent for a validated list of column keys stored in the document (doc.tableView, v13)
- js/report.js:197 reportCustomColumns(): custom columns follow the Devices table's order and hidden set, the rule for the default column list
- js/report.js:806 reportModelNow() builds every section inside withDoc/withLookupPass. The comment at js/report.js:836-840 says binder sheets are drawn after their documents are put back, so per-site section data must be computed in the model, not at HTML time
- js/report.js:1845 reportSheet(): the h2 sections in order (Findings, visit, accepted, Providers, Topology, Device inventory, Racks, Switch ports, Connections, Wi-Fi, Addressing, Changes, Scope and method). js/report.js:1400 devicesSection() and its table.inv markup are the visual precedent
- js/report.js:2302 renderReportDialog, 2331 openReportDialog, 2363 readReportParts/reportParts (js/report.js:1936), index.html:1264-1300 the 'What goes in' fieldset with #reportSummary/#reportTechnical/#reportLargeMapRow, and scheduleReportPreview (js/report.js:2457) for the live preview
- js/model.js:3685-3735 Providers (doc v15): PROVIDER_MAX, PROVIDER_FIELDS read/write through readFields/writeFields, normalizeProviders with keepIdsUnique(…, 'pv'), serializeProviders writing no key when empty. This is the template for a small document-level list
- js/model.js:4227 DOC_VERSION = 15, js/model.js:4279-4376 MIGRATIONS (each 'new key, not a new shape' step), js/model.js:4236 isDocShape list of array keys, js/model.js:4386 migrateDoc returning newer -> read-only
- js/app.js:869 serializeDoc() allowlist, js/app.js:1560-1585 load normalization (providers, columns, tableView), js/state.js:62 the state defaults
- js/csv.js:440-475 CSV_SHEETS with shown() gating (providers.csv only once there is one), js/csv.js:460 csvProvidersSheet, js/csv.js:1023-1027 csvIsProviderSheet/csvSheetFamily, js/csv.js:1094 the sheet-kind classifier, js/csv.js:2775 csvPlanProviders (by id, then by name, conflicts, capacity), js/csv.js:2866 csvWrite's held/scratch document, js/csv.js:3517 the review's family list
- js/table.js:1779 deleteCustomColumn strips x:<id> from tableView, and saved searches must have it stripped the same way
- js/library.js:987 withDoc, js/library.js:682 and js/report.js:2174 withDocRendered hold and restore an explicit list of state keys. js/library.js:1698 docChangeCount counts report/accepted/pinned as one change each

**Data model**

New document key `searches` (named apart from doc.report, the report header). It is a list, at most SEARCH_MAX = 30 entries, each read through a new SEARCH_FIELDS table in js/model.js, placed after Providers and built like PROVIDER_FIELDS:
  { id: 'sq_…' (keepIdsUnique(list,'sq'), minted by nextId('sq') when missing),
    name: string, trimmed, 1..60 chars, unique in any case (a later duplicate is dropped on load, as normalizeCustomColumns does),
    query: string, trimmed, 1..500 chars, stored exactly as typed (prefixes stay English syntax),
    columns?: [column keys], each matching TABLE_VIEW_KEY_RE, deduplicated, max 20, 'name' never stored (it is always first). Absent means 'as the Devices table shows them' (tvDevicesArranged at print time),
    sort?: a column key, desc?: true (absent means ascending; absent sort means document order, i.e. reportDevices order),
    print?: true (ticked in the report dialog by default) }.
normalizeSearches(list) drops damaged entries (no name, no query, not an object) and never guesses. A query that does not parse cleanly (parseQuery(q).errors non-empty) is still KEPT on load, because a future Topo may add prefixes and a read-only newer file is never rewritten anyway. It shows as 'Not understood' in the list and prints a muted line instead of a table. normalizeSearchRefs(searches, columns) runs after normalizeCustomColumns (js/app.js:1575) and drops x:<id> keys whose column is gone. Unknown Topo keys are kept (harmless, skipped when drawn, as normalizeTableView's comment says). serializeSearches writes no key when the list is empty, so an untouched document is byte-identical to v15 output and share links do not grow.
Version: DOC_VERSION 15 -> 16, with a MIGRATIONS step { from: 15, to: 16, run: (doc) => ({ ...doc, v: 16 }) } ('Saved searches are a new key, not a new shape'), documented in the version comment block at js/model.js:3794. A v15 build opens a v16 file read-only, so it cannot drop the searches. isDocShape (js/model.js:4238) gains 'searches' in its list-keys array. state.js:62 gains searches: [] with a comment that it is a document key: serialized, an undo step, carried by files and links.
Plumbing: serializeDoc (js/app.js:869) adds searches: serializeSearches(state.searches). The loader near js/app.js:1577 adds state.searches = normalizeSearches(d.searches); normalizeSearchRefs(...). The held/restore lists in js/library.js:682, js/library.js:989 (withDoc) and js/report.js:2174 (withDocRendered) add searches. docChangeCount (js/library.js:1698) counts the list as one change, like pinned. deleteCustomColumn (js/table.js:1779) also strips x:<id> from every search's columns and sort in the same batch.
CSV: new sheet searches.csv (CSV_SHEETS key 'searches', label 'Saved searches', plain, shown only when state.searches.length > 0). Columns: search_id, name, query, columns, sort, descending (yes/no), in_report (yes/no). The columns cell holds Topo's column keys and custom columns by name, separated by '; '. A custom column whose name contains ';' is written as its x:<id> key. On import the cell resolves a key, a table label in English or the page language (as tvColumnByLabel near js/table.js:1743 does), or a custom column's name, case-insensitively. A token naming nothing makes the row a conflict that names the token. New target family 'sqdef' (fields sq:*), detected by the search_id heading. csvPlanSearches is modelled on csvPlanProviders: matched by id, then by name; a new row needs a name and a query; a query with parse errors is refused on its row ('{query} is not understood: {terms}'); SEARCH_MAX is enforced. Ops { sq: { create } | { id, set } } are applied in csvWrite (js/csv.js:2866), whose held/scratch lists gain searches. The findings sheet is unchanged.

**Interface**

Full editor only (data-adv). The Simple view and #simple/#imagenology/#setup show none of it, the same as the search box.
1. Search bar: a ☆ 'Save search' button joins #queryTools (index.html:910). It is enabled only while activeQuery() is on and has no errors. It opens a small dialog with Name (the box's text is the suggested name), the query (editable, parsed live with the same 'Not understood' line), Columns (a checkbox list in the Devices table's order with ↑/↓, Name fixed first and greyed, built from tvDevicesOrder() at js/table.js:758 so custom columns appear), Sort by (select of the ticked columns, plus 'As listed') with Descending, and 'Print in the site report' (ticked by default). Save is one undo step through batch()+save(); readOnlyRefuses() blocks it on a read-only network.
2. Listing: a ▾ 'Saved' button at the end of #queryBar (beside ✕), shown when the network has saved searches. It opens a menu, one row per search: its name, a muted count ('12 devices', worked out live with parseQuery+queryMatch in one withLookupPass), a 🖨 mark when it prints, and Edit and Delete. A click on the name runs setQuery(search.query), so the map dims and the table filters exactly as a typed search would, and the box then shows the query. When the box's text equals a saved query, the ☆ becomes ★ and the button reads 'Update saved search'. Delete asks first (askConfirm). Each edit is one undo step. On a phone the menu is a sheet under the bar, like the existing Export menu.
3. Report dialog: inside #reportParts, under Technical details and hidden with it (as #reportLargeMapRow is at js/report.js:2378), a 'Saved searches' group with one tick per search, each starting from its print flag. Ticking changes only this report (it is read by readReportParts as parts.searches = [ids]) and is never written back, so it works on a read-only network. The preview refreshes through scheduleReportPreview. The row is absent when the network has none.
No new keyboard shortcut; Enter in the box still zooms. Nothing is added to the rail, so phones keep their space.

**Checks**

None. A saved search is a view of the register, not a fact about the network, so no finding is added and nothing changes in the Findings tab, the pill or the counts. Two edge cases are handled in the UI and the report instead of as findings: a query that is not understood shows the existing 'Not understood' wording in the Saved menu and in the report, and a search matching no device prints 'No devices match.' in the report.

**Report**

Technical sheet (reportSheet, js/report.js:1845): after Addressing and before Changes since the last back-up, an h2 'Saved searches' appears when at least one search is ticked. Under it, one block per ticked search in document order:
- an h3 with its name;
- a muted line: 'Search: <query in mono> · {n} of {total} devices';
- a table.inv with Device first, then the chosen columns, one row per matching device (not per interface). A guest is listed under its host as hostOrdered() (js/report.js:1381) does, but only when no explicit sort is set.
Cells come from TV_COLS.devices[key].show(row).text with row = { rec:'node', ref:{nodeId}, data:d } over model.devices, with a small report override map: ifaces prints every address, not the table's '+N'; a ✓ or yes/no prints t('Yes')/t('No'), as reportCustomOf does; age uses deviceAge(n, checksDay()). Headings are t(col.label), as the inventory's are.
reportModelNow (js/report.js:806) gains searches: reportSearches(ids) -> [{ name, query, error?, total, columns: [label], rows: [[text]] }], computed inside the model so binder sheets (built after withDoc restores the document) and the date (onChecksDay) are right. has:finding therefore counts to the report's date and leaves accepted and info findings out, matching the Findings section. reportParts (js/report.js:1936) gains searches: a list of ids. When a caller says nothing (generateSiteReport from code, the binder), the ids default to every search with print:true, so a binder prints each site's flagged searches in that site's sheet. A query that is not understood prints its muted 'Not understood, so nothing matches: …' line and no table. The Simple summary gains nothing, because the client page stays plain words. The binder cover gains nothing.

**Translations**

About 30 new strings, all in five locales.
MESSAGES (they print in the report, so the i18n suite's parity check applies): 'Saved searches', 'Search: {query}', '{n} of {total} devices', 'No devices match.', and the reused 'Not understood, so nothing matches: {terms}', which must also be in MESSAGES if today it is only in I18N.
I18N (chrome): 'Save search', 'Update saved search', 'Saved', 'Saved searches', 'Name', 'Columns', 'Sort by', 'As listed', 'Descending', 'Print in the site report', 'Delete the saved search {name}?', 'Delete saved search', 'A network can keep at most {n} saved searches.', 'A saved search with this name already exists.', '{n} device'/'{n} devices' (reuse the existing plurals), the CSV review messages ('A new saved search needs a name and a search.', '{query} is not understood: {terms}', 'No column is called {name}.', 'Another row is this saved search.'), and the sheet label 'Saved searches'.
Tricky points:
- The query text is never translated and is printed in mono, because prefixes are syntax.
- A query that uses translated type names (type:Cámara) matches only in that language, because qTypeName compares t(typeName) (js/query.js:307). The dialog should nudge toward keys (type:camera) with a hint.
- Russian and Portuguese need plural-aware '{n} of {total} devices'; follow the existing 'Devices: {n} of {total}' pattern to avoid plural forms.
- Japanese keeps 'PC' wherever a type name appears.

**Files**

- js/model.js: SEARCH_MAX/SEARCH_FIELDS, normalizeSearches, serializeSearches, normalizeSearchRefs, makeSearch, searchById near the Providers block (~3685-3740); DOC_VERSION 16 and the v16 MIGRATIONS step plus its comment (~3794-3885, 4227, 4376); isDocShape (4238)
- js/state.js: searches: [] in the defaults (line 62) and its comment
- js/app.js: serializeDoc (869) and the loader (~1575-1585)
- js/library.js: withDoc held list (989-1006), the held list at 682-691, docChangeCount (1698)
- js/query.js: queryMatchCount(text) and querySavedMatches(text) helpers that use parseQuery+queryMatch without state.query; the ☆/▾ wiring in wireQuery (590) and updateQueryBar (529): enable ☆ only on a clean query, ★ when it equals a saved one
- js/searches.js (new, loaded after query.js and before bulk.js): the Save/Edit dialog, the Saved menu, saveSearch/updateSearch/deleteSearch each one batch()+save(), readOnlyRefuses
- js/table.js: export a column lookup for the report (tvDeviceColumn(key)); compareRows takes an explicit direction instead of reading _tvSortDir, or the report sets and restores it; age's show uses deviceAge(n, checksDay()); deleteCustomColumn (1779) also strips x:<id> from state.searches
- js/report.js: reportSearches() and its use in reportModelNow (806); searchesSection() rendering; the h2 slot in reportSheet (1845); reportParts (1936) and readReportParts (2363) gaining searches; the dialog's ticks in renderReportDialog/openReportDialog (2302/2331); withDocRendered held list (2174)
- js/csv.js: csvSearchesSheet, its CSV_SHEETS entry (~466), sq:* targets next to pv:* (~918), CSV_OWN_FAMILIES (997), csvIsSearchSheet/csvSheetFamily (1023-1027), the sheet-kind branch (~1094), csvPlanSearches (after 2775), csvWrite held/scratch and op apply (2866), the review family list (3517)
- index.html: ☆ and ▾ buttons in #queryBar/#queryTools (901-915), the Save search dialog markup, the 'Saved searches' group in #reportParts (1264-1300), the <script src=js/searches.js> tag between query.js and bulk.js (1661)
- css/app.css: the Saved menu, the ★ state, and report-dialog tick list spacing (reusing dlg-parts/dlg-blurb)
- js/i18n.js: the new strings in es, pt-BR, ja, ru (I18N for chrome, MESSAGES for the report strings)
- docs/FEATURES.md: extend the Search bullet (line 57) and the Site report bullet (line 77); add searches.csv to the spreadsheet list
- README.md: one line under reports

**Tests**

- tests/suites/searches.js (new), part 1, model: a v15 document opens as v16 with no searches key; a v16 document with searches round-trips serializeDoc byte for byte; an empty list writes no key; a v17 document opens read-only and its searches are untouched (state.readOnly.doc); damaged entries (no name, no query, a non-object, a duplicate name in another case) are dropped; a repeated id is reminted; more than 30 are cut to 30; an x:<id> column of a deleted custom column is dropped on load and by deleteCustomColumn (one undo step)
- searches.js part 2, matching: a saved 'type:camera has:finding' counts the same devices as setQuery of the same text (queryMapMatches().nodes); it still evaluates in a reduced view where activeQuery() is null; an accepted finding is not matched by has:finding
- searches.js part 3, UI: ☆ disabled on an empty or 'Not understood' query; Save with a name adds one search in one undo step (undo removes it); the ▾ menu lists it with its count; clicking it sets the box and dims the map; ★ shows when the box equals it; Edit renames; Delete asks, then removes in one step; a read-only network refuses; none of it is visible in #simple
- searches.js part 4, report: with one search print:true, reportHtml contains h2 'Saved searches', the h3 name, the query in mono and a table with exactly the matching device names in the chosen column order; an unticked search is absent; with sort 'name' desc the rows are reversed; the ifaces column prints every address; a yes/no custom column prints Yes/No; zero matches prints 'No devices match.'; a not-understood query prints the muted line and no table; with the report date set a year ahead, 'has:finding' picks up a device whose service falls due (onChecksDay), as the Findings section does; the binder report prints each site's own flagged searches in its sheet; the summary-only report has no Saved searches section
- searches.js part 5, CSV: searches.csv is listed only once a search exists; export then import into a blank map recreates the searches (by id) with columns resolved, custom columns by name; a row matching an existing search by name updates its query; a row with an unknown column token or a not-understood query is a conflict on its row; past 30 is refused
- tests/suites/i18n.js covers the MESSAGES parity automatically; add the new keys to the ja 'PC' check only if any type name appears
- Existing suites to re-run: query.js, report.js, sitereport.js, reportdate.js, columns.js, csv.js, compat.js, schema.js, binder.js, privacy.js (a sealed link carries the searches), changes.js (Update counts one change)

**Stages**

- 1. Model: SEARCH_FIELDS, normalize/serialize, DOC_VERSION 16 with its step, state/serializeDoc/loader/withDoc/withDocRendered/docChangeCount plumbing, deleteCustomColumn cleanup, and searches.js part 1. Nothing is visible yet, but files keep searches written by hand
- 2. Save and list: ☆/▾ in the search bar, the Save/Edit dialog, the Saved menu, setQuery on click, chrome strings in five locales, and searches.js parts 2-3. Usable as named searches without printing
- 3. Report: reportSearches in reportModelNow, the 'Saved searches' section, the dialog ticks and parts.searches, the binder default, MESSAGES strings, searches.js part 4, and the FEATURES.md report bullet
- 4. Spreadsheet: searches.csv export/import, the sqdef family, csvPlanSearches, csvWrite, the review strings, and searches.js part 5

**Risks**

- DOC_VERSION collision: other backlog features that add document keys will also want v16. Whichever lands first takes 16 and the others rebase to 17 or later; never edit a shipped step (js/model.js:3883).
- The held-state lists are duplicated (js/library.js:682, js/library.js:989, js/report.js:2174, js/csv.js:2866). Missing one makes a binder sheet print the live network's searches, or a CSV dry-run lose them. Test the binder case explicitly.
- Reusing TV_COLS show() in the report: cells meant for the screen (the ifaces '+N' truncation, ✓ marks, age counted to today via deviceAge's default) would print wrong. The override map and the checksDay fix must land with stage 3.
- compareRows reads the global _tvSortDir (js/table.js:899). Calling it from the report without passing the direction can flip the table's blank-last order.
- has:finding in a binder: qLevels caches by diag identity (js/query.js:162). Each site gets its own diag inside withDoc+withLookupPass, but a regression there would leak one site's findings into another's section.
- Translated words in a saved query (type names, statuses by label) match only in the language they were typed in; the report printed in another locale would show fewer devices.
- A large network with many flagged searches lengthens the report and the preview build; matching is O(searches × devices) inside one lookup pass, which is acceptable, but keep SEARCH_MAX small.

**Amendments (from the cross-check; these win over the text above)**

- reports: 'serializeDoc (js/app.js:869)'. serializeDoc starts at js/app.js:848, and 869 is its return line. Also, 'the held lists in js/library.js:682' is canonicalDoc, not a generic held list: if searches are not held and restored there, every canonicalDoc call (docChanges, docChangeCount, takeSnapshot diffs) overwrites the live state.searches via loadDocState. There are more scratch/held copies at js/diagnostics.js:1078 (diagnoseDoc), js/bulk.js:805 and js/table.js:1489 that the spec does not list.
- List every held/scratch copy of state: js/library.js:682 (canonicalDoc, critical: without it the live searches are overwritten), :989 (withDoc), js/report.js:2174, js/csv.js:2866, js/diagnostics.js:1078, js/bulk.js:805 and js/table.js:1489. Refuse to save, or print as a muted line, any query using a browser-local term (was:, has:history). Add a formula-guard test for the query cell in searches.csv and a perf test for many flagged searches on site300. Version: the next free number after capacity's pool.

**Open questions (defaults in "Decisions taken")**

- Should the Simple summary ever print a saved search (for example a per-search 'show to the client' flag), or do saved searches stay technical-sheet only as specced?
- Should saved searches count in 'Changes since the last back-up' (js/changes.js)? The spec treats them like doc.tableView, as a view that is not counted there, but counts them in docChangeCount so Update notices them.
- Is SEARCH_MAX = 30 the right ceiling?
