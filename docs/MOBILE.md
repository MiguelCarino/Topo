# Topo mobile review (M1-M60)

The phone and tablet work list that `docs/BACKLOG.md` calls "the mobile review
(M1-M60)". The original list was kept in `Topo/CLAUDE.md` and in a review note
from 2026-10-31. Neither survived, so this list was **rebuilt on 2026-11-06**
from:

- the two mobile batches already landed (commits `a36dd73` and `8bc28c8`),
  which become M1-M15;
- an audit of the live app at 360 × 780 and 780 × 360 in Chromium's phone
  emulation (touch, `pointer: coarse`, `hover: none`), on the example network,
  the Datacenter template and the `#simple` view, which supplies M16-M60.

The numbers are new. They do not match the lost list, and no commit referred
to an M number, so nothing points at the old ones.

**What the audit could not see.** It used an emulator, not a phone. Items
marked **verify** describe something a real device has to confirm (iOS
Safari's keyboard, printing, downloads, storage eviction) before anyone builds
a fix. The rest come from measurements on the page, and the evidence column
says which.

**House rules the items assume**, taken from the CSS already in place: a touch
target is at least 44 × 44 px under `(max-width: 900px)` or
`(pointer: coarse)`. A form field on a phone is at least 16 px, the size below
which iOS Safari zooms the page on focus and does not zoom back. Phone layouts
are checked at 360 and 390 wide.

---

## Done

### Batch 1: map navigation on phones (`a36dd73`)

| # | Item | Status |
|---|---|---|
| M1 | One finger pans the map, two fingers pinch-zoom about their midpoint, and a gesture on the map never zooms the page. | done |
| M2 | A second finger landing during a device drag cancels the drag (no move, no undo step) and becomes a pinch. Lifting one finger carries on as a pan. | done |
| M3 | Double-tap on empty map zooms in. A mouse double-click still drops a note. | done |
| M4 | Overlays (zoom buttons, document bar, banners) pinch the map too. `overscroll-behavior-y` stops pull-to-refresh. | done |
| M5 | How to use gains a Touch line on touch screens. | done |
| M6 | Fit uses the part of the map no bar covers. The first view never drops below zoom 0.7 and shows the top of the map. | done |
| M7 | Fit button in the zoom controls. On a phone, 1:1 keeps the centre and the minimum zoom drops to 0.1. | done |
| M8 | `#setup` and Add devices lay out rows sized to the phone (4 columns). | done |

### Batch 2: editing on the map by touch (`8bc28c8`)

| # | Item | Status |
|---|---|---|
| M9 | Selection bar on phones: name plus 44 px Edit, Connect, Select more, Delete. Notes get Edit text, Link, A-, A+. | done |
| M10 | Touch connect: Connect (or an Android long-press) then a tap on the target files the cable as one undo step. Notes link the same way. | done |
| M11 | The drawer is one scroller with a sticky header, tabs and a 44 px close button, with nothing clipped at 360. | done |
| M12 | Palette Text and Note close the drawer and place the item in the visible map with its editor open. Device adds keep the drawer open. | done |
| M13 | Double-tap on a note opens its text. The on-map delete and size discs are hidden on touch; they live in the selection bar. | done |
| M14 | Select more: tap devices and cables in and out of a selection. Dragging a member moves the set as one undo step. | done |
| M15 | Navbar on phones: hidden by default, shown by a swipe down from the top edge or a tap on the handle. | done |

---

## Open

Grouped into proposed batches in the order they are worth doing. Within a
batch, items are independent unless one names another.

### Batch 3: typing on a phone (landed 2026-11-06, uncommitted)

The biggest gap the audit found. Every form field in the app renders at
12.8 px, so on an iPhone each tap into a field zooms the page and leaves it
zoomed.

| # | Item | Evidence | Status |
|---|---|---|---|
| M16 | Form fields at 16 px on phones: the search box, the table's cell editor (`input.tv-in`), the device panel (27 fields), Add devices (21), Settings, the report dialog, Save search, Paste a column. One rule under `(pointer: coarse)` rather than per field. | Measured: all at 12.8 px (13.3 px for one select in the device panel). | done, verify on a phone |
| M17 | The report dialog focuses Site on open (`js/report.js:3076`), so on a phone the keyboard comes up before anyone has read the dialog. Do not focus a field on touch. | Code, and seen at 360. | done, verify on a phone |
| M18 | The on-screen keyboard: nothing follows `visualViewport` except the navbar's swipe (`js/mobile.js:686`). Keep the focused field and the dialog's primary button above the keyboard, and keep the selection bar and handy bar from riding up over the field being typed in. | **verify** on iOS Safari and Android Chrome. | done, verify on a phone |
| M19 | Keyboard hints: no field sets `enterkeyhint` (0 uses). The table editor moves down on Enter and across on Tab; on a phone, Enter should read "Next" and Tab is not on the keyboard at all. Give the table editor `enterkeyhint="next"` and a way to move across. | Code: 0 uses of `enterkeyhint`. 14 `inputmode` uses exist; check that addresses, MACs, VLAN lists, watts, U counts and port counts all have one. | done, verify on a phone |
| M20 | Table editing by touch: the first tap selects the row, a second tap on the same cell edits it. It works, but nothing says so. Add a hint line under the table on touch screens, as the patch schedule already has ("Tap a row to trace its cable"). | Tested at 360. | done, verify on a phone |

**How batch 3 landed.** Every field is 16px under `(pointer: coarse)`. Device-panel pairs stack, and the interface row, port VLAN box and table editor are refitted so the bigger text fits and an opened row keeps its height (M16). Dialogs and cards focus their card instead of a text field on touch (`focusForTyping`, js/dialog.js), and the unlock form is now a named dialog (M17). While a field has the focus on a phone, `topo-kb` on `<html>` hides the floating bars, and each dialog's scrim follows the visual viewport (js/mobile.js, css/app.css) (M18). Fields get their keyboard from one table (`KEYBOARDS`, js/ui.js): capitals and corrections off for addresses, MACs and VLAN lists, `enterkeyhint` Next/Done/Search. A table cell on a phone gets a 44px → that opens the next cell taking typing, skipping selects and read-only cells so the keyboard stays up (M19). The table shows "Tap a cell to select its row. Tap the same cell again to edit it." on touch screens in all five languages. The row count now has its own line on touch screens, because the first tap's "Selected: 1" used to wrap the toolbar and move the grid, so the second tap hit the row above (M20).

**What only a phone can confirm** (the new `@touch` suites need Playwright, which was not installed on the machine that built this): no zoom on focus in iOS Safari, including the note editor's scaled 16px overlay; no keyboard flash when dialogs open; the dialog fit above the keyboard on iOS and Android; the keyboard staying up when → or Enter chains cells; iOS's conversion Enter not chaining. Run `cd tests && npm install && npx playwright install chromium && node run-cross.mjs touchfields touchfocus touchkeyboard touchkeys touchtablehint`, then check on a real iPhone and Android phone.

### Batch 4: touch targets (landed 2026-11-10, uncommitted)

Every control below measured smaller than 44 px with the drawer, table, rack
or dialog open at 360 × 780.

| # | Item | Evidence | Status |
|---|---|---|---|
| M21 | Drawer section tabs: Configuration, Diagnostics, Subnets, Groups, Wi-Fi, Providers, Findings. | 27 px tall. | done 2026-11-10, verify on a phone: `.cfg-tab` 44 tall, Problems and Problem report included (touchsizes) |
| M22 | Map / Table / Rack switch, and the search box. | Switch 27 px tall; search box 29 px tall. | done 2026-11-10, verify on a phone: switch 44 tall (glyphs at 640 and under, M36), `#queryInput` and its ✕ 44 (touchsizes2, phonetools) |
| M23 | Zoom column (+, 1:1, −, Fit, background) and the handy bar's buttons. | Zoom 35 × 32-36 px; handy bar 38 × 38 px. | done 2026-11-10, verify on a phone: zoom column and handy bar 44 × 44; the column stands on the handy bar (touchsizes, phonespace) |
| M24 | Table: row checkboxes, the expand twist, sortable column headings, sub-tabs (Devices, Interfaces, Cables, Ports, Subnets, Groups), Paste a column and Columns. | Checkboxes 13 × 13; twist 16 × 20; headings 15 px tall; sub-tabs 33 px; buttons 32 px. | done 2026-11-10, verify on a phone: tick and twist columns 46 wide (the cell is the target), sort heads fill their th, sub-tabs and buttons 44, rows 46 (touchsizes2) |
| M25 | Every dialog's ✕, Settings switches, the report dialog's ticks, Add devices − / +. | ✕ 29 × 25; switches 20 × 20; ticks 13 × 13; − / + 33 × 32. | done 2026-11-10, verify on a phone: every `.modal-x` and `.rpv-x` 44; Settings rows 48; ticks reach through 44px labels; − / + and counts 44 (touchsizes3) |
| M26 | Device panel interface rows: the per-interface plug and ✖ icons, and the Bond NICs, + MAC / VLAN, + Add Interface links. | About 14 px icons; text links in small type. Seen at 360. | done 2026-11-10, verify on a phone: plug and ✖ 44 on a touch screen; the links 44 tall (touchsizes) |
| M27 | The drawer's action row: Undo, Redo, Tidy, the Tidy ▾ menu, Export, Settings. Library tabs (Nodes, Templates, Blocks) and + Add devices. | Actions 32 px tall, Tidy ▾ 25 px wide; library tabs and Add devices 38 px. | done 2026-11-10, verify on a phone: actions, Tidy ▾, library tabs and cards, Add devices, menu items 44 (touchsizes) |
| M28 | Rack view controls: Size, Front / Rear, 1× / 2× / 3×, All / Selected / One cable, and the unit slots at 1×. | Toggles 27 px; slots 26 px tall. | done 2026-11-10, verify on a phone: head buttons and toggles 44, picker 44, sort and schedule links 44; a unit is at least 46 px tall on a touch screen at every zoom (touchsizes2) |
| M29 | The document bar's Keep this network, and the navbar handle's hit area. | Keep 32 px tall; handle 72 × 14 (the swipe is the main way in, but the tap target should still be 44). | done 2026-11-10, verify on a phone: Keep 44 (and folded into a chip, M30). Handle: 72 × 44 where the top centre is free (Simple, Imagenology, landing); in the full editor it stays a 14px swipe strip over the search box, and the drawer header's ⌃ is its 44 × 44 tap (decision D4 below) |

### Batch 5: screen space (landed 2026-11-10, uncommitted)

| # | Item | Evidence | Status |
|---|---|---|---|
| M30 | The bottom of the screen fills up. With a device selected on the example, the document banner, selection bar and handy bar stack up and the zoom column sits beside them, covering about a third of a 780 px screen. Fold the banner into a chip after its first showing, or into the handy bar. | Screenshot at 360 × 780. | done 2026-11-10, verify on a phone: on a phone the banner shows in full once per network, then folds into a 44px chip (Keep, or the name when kept) after 6 s, a map tap or a selection; the chip steps aside under the selection bar. 360: 16.2% folded, 16.7% with a device selected (phonespace) |
| M31 | Landscape phones get the desktop layout. At 780 × 360 the navbar stays pinned (the phone rules key on width), and with the banner and handy bar about 120 px of map is left. The zoom column runs off the bottom. Apply the phone layout under `(max-height: 500px)` and `(pointer: coarse)` too. | Screenshot at 780 × 360. No `max-height` media query exists in `css/app.css`. | done 2026-11-10, verify on a phone: the drawer, handy bar and hidden navbar apply under `(max-height: 500px) and (max-width: 1000px) and (pointer: coarse)` too, with carino-ui's drawer copied into css/app.css for 901-1000 wide; one row of bars; table and rack get their height back (touchland at 780 × 360 and 932 × 430) |
| M32 | The table's sub-tabs scroll sideways with no sign that more exist: at 360 the row ends in "GROU". Add an edge fade or an overflow menu. | Measured: Groups tab's right edge at 362. | done 2026-11-10, verify on a phone: edge fade (`.tv-tabs[data-more]` mask) and the chosen tab scrolled fully into the row (phonespace) |
| M33 | The table scrolls sideways inside its box and the Name column scrolls away with it, so past the second column no row says which device it is. Make the select and Name columns sticky on phones. | Seen at 360. | done 2026-11-10, verify on a phone: tick, twist and Name sticky; Name 6rem on a touch phone so the pinned block is under 60% of the box (phonespace) |
| M34 | Report dialog: the Close / Print / Download footer sits over the last lines of the body with no opaque background, and the dialog has no ✕ in its header, unlike every other dialog. | Screenshot at 360. | done 2026-11-10, verify on a phone: the ✕ is in the header and 44 on any touch screen; Print and Download on an opaque foot at 700 and under and in landscape (touchland) |
| M35 | Rack view at 360: the elevation gets about 190 px of height between its controls and the patch schedule. Device names are cut to about eight characters, and the cable manager is too dense to follow. Give elevation and schedule a switch of their own, each taking the full height. | Screenshot, Datacenter, rack A01. | done 2026-11-10, verify on a phone: Elevation / Patch schedule switch on a phone and a landscape phone, each pane the full height; the lists to drag from stay with the elevation (phonetools, touchland) |
| M36 | The search bar's tools: the backlog's open crowding decision (Zoom, Select, Locate, ☆ Save, ★ Saved beside the count at 360) has not been taken. Take it once (an overflow menu or wrapping) and test it at 360 and 390. In the rack view the search box is already down to 143 px. | `docs/BACKLOG.md`, Cross-feature collisions. | done 2026-11-10, verify on a phone: decision taken: at 640 and under the tools are one row, the count and a 44px ⋯ menu holding Zoom, Select, Locate and Save; ★ Saved stays in the search box. The view switch shows glyphs, so the rack view's box is 140px or more at 360 (phonetools) |
| M37 | First view of a large network in the Simple view: the 0.7 zoom floor from M6 shows the Datacenter template with its left edge cut off, so a non-technician never sees the whole network at once. **Decision for the owner:** keep the floor, or open on an overview when the map would fit at, say, 0.4 or more. | Screenshot, `#simple`, Datacenter. | done 2026-11-10, owner decision: in `#simple` and `#imagenology` on a phone the first view is the whole map when it fits at 0.33 or more (`SIMPLE_OVERVIEW_ZOOM`, js/app.js frameCamera's `overview`), else the 0.7 floor stays; the full editor is unchanged (test: phonefit, phonetools). Measured fits: Datacenter 0.353 at 360 and 0.385 at 390, imaging_simple 0.377 / 0.411, Hospital 0.586 / 0.639: all now open whole. |
| M38 | Map text at phone zoom: the address lines under each device are about 5 px at Fit. Hide them below a zoom level on phones, or show them only for the selected device. | Screenshot at 360. | done 2026-11-10, verify on a phone: on a touch phone the address lines hide below zoom 0.7 (the first view's floor still shows them), the selected device keeps its own; exports unchanged (phonespace) |

**How batches 4 and 5 landed.** Targets come from three sections of css/app.css after the M17 block. "Touch targets (Mobile review M21-M29, M57)" under `(max-width: 900px), (pointer: coarse)` grows buttons, tabs, menu items, every dialog ✕, the rail's links and fields, the landing's buttons and chips and `#conflictPill` to 44 (fields 44 tall as well as 16px: decision D2). A `(pointer: coarse)`-only section holds what would change a layout a narrow mouse window keeps: the interface icons, the view switch and search box, the zoom column and handy bar, the docbar, the rack head, and the table (tick and twist columns 46 wide with no padding, sort heads filling their th, rows 46 tall: D3). Ticks reach through their labels rather than through `::after`: a table tick's `<label class="tv-tick">` fills its 46px `[data-hitbox]` cell on a touch screen (`display: contents` with a mouse), and since Chromium's touch adjustment steered a tap 4px inside a cell's top or bottom edge to the row beside it, js/table.js takes the finger's real point at pointerdown and ticks the cell under it. A rack unit is `max(46px, u0) + (zoom − 1) × u0` on a touch screen: 46/68/90 on a tablet, 46/74/102 on a phone, so 2× is always taller than 1× and never shorter than the mouse's `u0 × zoom` that rvPortsFit counts on. On a touch screen the fleet navbar's left side (theme switch, brand, product, clock) is 44 tall, by Topo's own rules over carino-navbar.js's markup. Screen space shares four media queries, written out the same way in CSS and as constants in js/state.js (`DRAWER_MQ`, `PHONE_LAYOUT_MQ`, `NAV_AWAY_MQ`); every height clause carries `(max-width: 932px)`, the widest phone on its side, so a tablet whose page shrinks for the keyboard keeps its side panel (touchland checks 960 × 430). Residual: a tablet 901-932px wide whose browser shrinks the page for the keyboard still turns its rail into a drawer while typing. `phoneView()` stays width-only: a phone held sideways opens on the Map with no 0.7 floor, but frames under the bars. The landscape drawer for 901-932 wide is a copy of carino-ui.css's drawer rules, marked "keep in step"; carino-ui.js still closes an open drawer when a rotation crosses 900px, which is accepted (☰ opens it again). The docbar chip (M30) remembers the networks it has shown in full in sessionStorage, in memory when that fails, and a failed save never folds; opening the rack view on a phone folds it at once. On a phone on its side the findings pill sits left of the zoom column (`right: 72px`), which reaches up past the top bar's row, and the merge review lays its counts, kind and Use … for all on one row under a one-line title and mode sentence, so a conflict row shows above the foot at 780 × 360. Below 360px wide the rack's face, zoom and cable controls share one row that scrolls sideways (`.rk-viewctl`, `display: contents` elsewhere), so at 320 × 640 the head is three rows and the elevation pane half the height between the top bar and the handy bar. The rack's pane switch, the search ⋯ menu (its items click the real buttons, mirroring their hidden, disabled and ☆/★ state as it opens), the merge review's compact header and provider mode opening on the Map with the report's devices ringed and in view all key on `PHONE_LAYOUT_MQ`. Share links keep only `profile` and `simple` from the query, so `?lang=` and `?theme=` no longer reach the recipient. Leftovers from steps 1, 2 and 4: count strings with one count say "1 conflict", "1 earlier entry" and "2 entries … were skipped" (`tn()` in js/i18n.js picks the key; Russian and Japanese are written to read after any numeral, the convention at MESSAGES, decision D5); translated sentences are joined by `joinSentences()`, with no space after 。 (D6); file names in modal titles show as typed (`.modal-title .fname`); the three unused restore-point keys are gone; the drawer header has a 44px 🗂️ My networks in every profile, so the Simple views reach it without Export ▾; an open drawer hides the navbar handle, whose 44px band in Simple sat over that header.

**How the sizes are held (M60).** tests/fixtures/touchaudit.js measures every visible button, link, field, summary, tab and tabindex control on screen. It samples `elementFromPoint` at the edges of a 44px box around each control's centre (±21.5px); the point belongs to the control through itself, its label or a `[data-hitbox]` ancestor, a `::after` counts, and a point on another control fails as stolen. Controls under a covering layer, a floating bar that is really on top there (an `elementFromPoint` check, so a dialog's foot over the docbar behind its scrim is still measured) or their scroller's sticky bar are skipped and measured again once scrolled clear; a clip skips a control only when it scrolls and could show the 44px box, so a non-scrolling `overflow: hidden` (the zoom column, the navbar's left side) is no excuse. touchsizes and touchsizes3 each hold a self-test: zoom buttons or a dialog's foot button shrunk by an injected style must fail. Fields must be 16px and 44 tall, nothing may pass the right edge, and the page may not scroll sideways. A screen that measures nothing fails as not reached. `TOUCH_EXEMPT` is the one commented allow-list: the map's SVG (drawn in map units; touchmap owns its taps), the rack's cable lines, inline prose links (named: the inherit note, `.rail-note` and model-split links, the vendor Use; a standalone button that happens to sit in a `<p>`, Fill vendor from MAC, is measured), and `.nav-handle` only while the full editor's top bar shows (D4). touchsizes covers the landing, the map, the drawer's panes, tabs and menus; touchsizes2 the table's tabs, the search tools and the rack at 1×, 2× and 3×; touchsizes3 every dialog closed by a tap on its ✕, the pick pill, provider mode, Simple, then 390 × 844, 320 × 640 (the drawer's nine provider-mode tabs, each 44 × 44, and the rack's head), 1024 × 768 and 1366 × 1024. phonespace, touchland and phonetools hold batch 5. The desktop at 1280 with a mouse was checked unchanged by a geometry diff of 44 screens in both themes, outside the suites (a touch suite cannot make the pointer fine).

**Known, not fixed here.** Older i18n keys no code uses, left for a later sweep: "📋 Open report", "Open binder report", "Open report", "Copy this binder link:", 'Update "{name}" ({n} change)' and its plural, "Map or table", "— As its group or host", "Automatic (this browser's language)", "The same choice applies on every carino.systems site.", "The diagram is too large to read on one page: …", the four greetings and "How to use — mouse & keyboard (press ?)". In a landscape phone the rack's pane switch fits, but the head still takes about a third of the height. At 320 × 640 the rack's units get about 210px (the elevation pane about half the free height): the pane switch and the picker each keep a row. The schedule's hint "Tap a row to trace its cable on the rack" shows in the schedule pane, where the trace is one switch away.

### Decisions for the owner (taken as defaults 2026-11-10)

- **M37 (decided 2026-11-10):** the reduced views open on the whole map when it fits at 0.33 or more (owner: "first view at 0.33 if the screen is too small"), so the Datacenter opens whole at 360 and 390.
- **M29 / D4:** in the full editor the navbar handle stays a 14px swipe strip, since a 44px band would lie over the search box. Its tap is the drawer header's ⌃ (44 × 44, "Show the menu bar"). Elsewhere the handle is 72 × 44.
- **D2:** fields on a touch screen are 44 tall as well as 16px, in the drawer, search, Add devices and table as in dialogs.
- **D3:** table rows are 46 tall on a touch screen (44 left the collapsed border's pixel to the neighbour cell).
- **D5:** plurals stay two English keys per count; Russian is written to read after any numeral ("конфликтов: 3") rather than with three forms.
- **M38:** addresses hide below 0.7, the first view's floor, so a phone's first view still shows them; Fit and landscape fits hide them.
- **M36:** saved searches stay as ★ in the search box, where they are reachable with no search typed; the ⋯ holds Zoom, Select, Locate and Save.

### Batch 6: things only a mouse or keyboard can do

| # | Item | Evidence | Status |
|---|---|---|---|
| M39 | Box (marquee) selection is Shift + drag only (`js/app.js:2111`). On touch, Select more picks one item per tap. Add a box-select mode to the Select more state. | Code. | open |
| M40 | Table range select is Shift + click or Shift + Space only (`js/table.js:1956`, `:1993`). On touch, rows are ticked one by one. Add a "tick everything matching the search" action, or a range mode. | Code. | open |
| M41 | Select everything is Ctrl + A only. Add it to the Select more state and to the table's toolbar on touch. | `SHORTCUTS`, `js/app.js`. | open |
| M42 | Information that lives only in hover tooltips: port tooltips on the faceplate, rack tips ("Untagged 1 · Tagged 10,20", "PoE+ 30 W"), the table's muted "not saved" Vendor cell, and the map's provider hover (Settings, "Show the provider on hover"). Touch has no hover. Give each a tap-to-show, or put the text on the element. | `index.html` has 41 `title=` attributes before the JS adds more. | open |
| M43 | Keyboard-only hints on touch screens: hide the `?` shortcut list and the key letters in tooltips ("(T)", "(W)") when `(hover: none)`. M5 already added a Touch line; the rest of How to use still lists keys. | Code, `SHORTCUTS`. | open |
| M44 | Palette drag and drop uses HTML5 `dragstart` (`js/ui.js:178`, `:202`), which touch browsers do not fire. Tapping a palette item adds the device. Confirm where it lands (in view, not under the drawer) and that the Templates and Blocks tabs have a tap path too. | **verify**. | open |
| M45 | Rack device moves: the arrow keys move a device up, down and between front and rear (`js/rackview.js:2895`). There are on-screen buttons for +1U and −1U (`:1527`). Check that up, down and front/rear have buttons too, at 44 px, and that they can be reached without scrolling the device out of view. | **verify**. | open |
| M46 | Port faceplate in the device panel: ticking a run of ports for Set on ports, at 360, by touch. | **verify**. | open |
| M47 | iOS long-press on the map: Connect on long-press is Android only (M10). On iOS a long-press may bring up the callout or text selection instead. The map is `user-select: none`; check `-webkit-touch-callout: none` and whether iOS should get the long-press too. | **verify** on iOS Safari. | open |

### Batch 7: files, sharing and printing from a phone

| # | Item | Evidence | Status |
|---|---|---|---|
| M48 | Back-ups and exports on phones: `.json`, CSV, PNG/SVG and labels download through an `<a download>`. On iOS that is a trip through the Files app, and in-app browsers often refuse it. Use `navigator.share` with files where the browser supports it, and keep the download as the fallback. | Code: 0 uses of `navigator.share`. **verify** downloads on iOS Safari. | open |
| M49 | Share links: the share dialog copies the link and the passphrase. On a phone, the system share sheet is the natural place for the link (sent apart from the passphrase, as the dialog already advises). | Code. | open |
| M50 | The landing page says "drop a `.json` build file" on a phone, which cannot drop. Say "open" on touch screens. Small: the Open a file button's 📂 has no space before its text. | Screenshot at 360. | done 2026-11-10, verify on a phone: on a touch screen the line reads "Or open a .json build, or a whole binder, with Open a file." in all five languages; 📂 already had its space (touchsizes, library, i18n) |
| M51 | Printing from a phone: the site report, labels (62 × 29 mm), the Locate sheet and rack elevations. Check that Print gives something usable on iOS and Android, or make Download the phone path and say so in the dialog. | **verify**. | open |
| M52 | The report dialog's preview at 360: readable, scrollable, and the sheet picker usable. | **verify**. | open |

### Batch 8: platform and robustness

| # | Item | Evidence | Status |
|---|---|---|---|
| M53 | Safe areas: nothing uses `env(safe-area-inset-*)`. The handy bar and selection bar sit at the bottom next to the iPhone home indicator, and in landscape the notch side has no padding. | Code: 0 uses. | open |
| M54 | Storage eviction on iOS: Safari deletes a site's storage after seven days without a visit unless it is on the home screen. The library and address history live in IndexedDB. Ask for `navigator.storage.persist()`, and on iOS say plainly that back-ups are the only safe copy. | Code: 0 uses of `storage.persist`. | open |
| M55 | A phone discarding the tab: `visibilitychange` already flushes a kept network (`js/app.js:1530`). An example, a template or a link that has not been kept "stays in this tab until you keep it". Check that it survives the browser discarding the tab while another app is open. | **verify** on a real phone. | open |
| M56 | Rotation mid-edit: keep the selection, the camera centre and an open editor across a portrait/landscape switch. | **verify**. | open |
| M57 | Tablets: under 900 px wide (iPad portrait) the phone drawer applies. Above it (iPad landscape, Windows tablets running the desktop app) the desktop layout applies with a finger as the pointer, and most 44 px rules are inside `max-width` queries. Key the target sizes on `(pointer: coarse)` as well. | Code, `css/app.css` media queries. | partly done 2026-11-10: target sizes are keyed on `(pointer: coarse)` as well as width, so a tablet of any width gets them (touchsizes3 at 1024 × 768 and 1366 × 1024); a large tablet keeps the desktop layout, which is the rest of this item |
| M58 | The Simple and Imagenology views, end to end by touch at 360 and 390. These are for staff who are not technicians, so most phone use will be here. Add a device, connect it, name the room, read the Locate sentence (the backlog notes it has no test at 360), hand over the report. | Backlog gap list, and M37. | open |
| M59 | Very small phones (320 wide, iPhone SE first generation, small Android). Check the drawer, dialogs and selection bar do not clip. | Not measured. | open |
| M60 | A test that holds the rules: a suite that opens each dialog, drawer tab, the table and the rack view at 360 × 780 with touch emulation, and fails on a control under 44 px, a field under 16 px, or anything past the right edge. The audit's probe did this by hand and found every item in Batches 3 and 4. | `tests/suites/` has `touch*.js`, `phonefit.js`, `navnarrow.js`; none checks sizes across dialogs. | done 2026-11-10: `touchsizes`, `touchsizes2`, `touchsizes3` (tests/fixtures/touchaudit.js), see below |

---

## Suggested order

Batches 1 to 5 have landed (3, 4 and 5 uncommitted on 2026-11-10), with M50 and part of M57. Next: the owner's answers to the decisions above (M37 first), then batches 6 to 8. Every **verify** item waits on a real device; the touch suites need Playwright (`cd tests && node run-cross.mjs touchsizes touchsizes2 touchsizes3 phonespace touchland phonetools`).
