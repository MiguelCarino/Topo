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

### Batch 4: touch targets

Every control below measured smaller than 44 px with the drawer, table, rack
or dialog open at 360 × 780.

| # | Item | Evidence | Status |
|---|---|---|---|
| M21 | Drawer section tabs: Configuration, Diagnostics, Subnets, Groups, Wi-Fi, Providers, Findings. | 27 px tall. | open |
| M22 | Map / Table / Rack switch, and the search box. | Switch 27 px tall; search box 29 px tall. | open |
| M23 | Zoom column (+, 1:1, −, Fit, background) and the handy bar's buttons. | Zoom 35 × 32-36 px; handy bar 38 × 38 px. | open |
| M24 | Table: row checkboxes, the expand twist, sortable column headings, sub-tabs (Devices, Interfaces, Cables, Ports, Subnets, Groups), Paste a column and Columns. | Checkboxes 13 × 13; twist 16 × 20; headings 15 px tall; sub-tabs 33 px; buttons 32 px. | open |
| M25 | Every dialog's ✕, Settings switches, the report dialog's ticks, Add devices − / +. | ✕ 29 × 25; switches 20 × 20; ticks 13 × 13; − / + 33 × 32. | open |
| M26 | Device panel interface rows: the per-interface plug and ✖ icons, and the Bond NICs, + MAC / VLAN, + Add Interface links. | About 14 px icons; text links in small type. Seen at 360. | open |
| M27 | The drawer's action row: Undo, Redo, Tidy, the Tidy ▾ menu, Export, Settings. Library tabs (Nodes, Templates, Blocks) and + Add devices. | Actions 32 px tall, Tidy ▾ 25 px wide; library tabs and Add devices 38 px. | open |
| M28 | Rack view controls: Size, Front / Rear, 1× / 2× / 3×, All / Selected / One cable, and the unit slots at 1×. | Toggles 27 px; slots 26 px tall. | open |
| M29 | The document bar's Keep this network, and the navbar handle's hit area. | Keep 32 px tall; handle 72 × 14 (the swipe is the main way in, but the tap target should still be 44). | open |

### Batch 5: screen space

| # | Item | Evidence | Status |
|---|---|---|---|
| M30 | The bottom of the screen fills up. With a device selected on the example, the document banner, selection bar and handy bar stack up and the zoom column sits beside them, covering about a third of a 780 px screen. Fold the banner into a chip after its first showing, or into the handy bar. | Screenshot at 360 × 780. | open |
| M31 | Landscape phones get the desktop layout. At 780 × 360 the navbar stays pinned (the phone rules key on width), and with the banner and handy bar about 120 px of map is left. The zoom column runs off the bottom. Apply the phone layout under `(max-height: 500px)` and `(pointer: coarse)` too. | Screenshot at 780 × 360. No `max-height` media query exists in `css/app.css`. | open |
| M32 | The table's sub-tabs scroll sideways with no sign that more exist: at 360 the row ends in "GROU". Add an edge fade or an overflow menu. | Measured: Groups tab's right edge at 362. | open |
| M33 | The table scrolls sideways inside its box and the Name column scrolls away with it, so past the second column no row says which device it is. Make the select and Name columns sticky on phones. | Seen at 360. | open |
| M34 | Report dialog: the Close / Print / Download footer sits over the last lines of the body with no opaque background, and the dialog has no ✕ in its header, unlike every other dialog. | Screenshot at 360. | open |
| M35 | Rack view at 360: the elevation gets about 190 px of height between its controls and the patch schedule. Device names are cut to about eight characters, and the cable manager is too dense to follow. Give elevation and schedule a switch of their own, each taking the full height. | Screenshot, Datacenter, rack A01. | open |
| M36 | The search bar's tools: the backlog's open crowding decision (Zoom, Select, Locate, ☆ Save, ★ Saved beside the count at 360) has not been taken. Take it once (an overflow menu or wrapping) and test it at 360 and 390. In the rack view the search box is already down to 143 px. | `docs/BACKLOG.md`, Cross-feature collisions. | open |
| M37 | First view of a large network in the Simple view: the 0.7 zoom floor from M6 shows the Datacenter template with its left edge cut off, so a non-technician never sees the whole network at once. **Decision for the owner:** keep the floor, or open on an overview when the map would fit at, say, 0.4 or more. | Screenshot, `#simple`, Datacenter. | open |
| M38 | Map text at phone zoom: the address lines under each device are about 5 px at Fit. Hide them below a zoom level on phones, or show them only for the selected device. | Screenshot at 360. | open |

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
| M50 | The landing page says "drop a `.json` build file" on a phone, which cannot drop. Say "open" on touch screens. Small: the Open a file button's 📂 has no space before its text. | Screenshot at 360. | open |
| M51 | Printing from a phone: the site report, labels (62 × 29 mm), the Locate sheet and rack elevations. Check that Print gives something usable on iOS and Android, or make Download the phone path and say so in the dialog. | **verify**. | open |
| M52 | The report dialog's preview at 360: readable, scrollable, and the sheet picker usable. | **verify**. | open |

### Batch 8: platform and robustness

| # | Item | Evidence | Status |
|---|---|---|---|
| M53 | Safe areas: nothing uses `env(safe-area-inset-*)`. The handy bar and selection bar sit at the bottom next to the iPhone home indicator, and in landscape the notch side has no padding. | Code: 0 uses. | open |
| M54 | Storage eviction on iOS: Safari deletes a site's storage after seven days without a visit unless it is on the home screen. The library and address history live in IndexedDB. Ask for `navigator.storage.persist()`, and on iOS say plainly that back-ups are the only safe copy. | Code: 0 uses of `storage.persist`. | open |
| M55 | A phone discarding the tab: `visibilitychange` already flushes a kept network (`js/app.js:1530`). An example, a template or a link that has not been kept "stays in this tab until you keep it". Check that it survives the browser discarding the tab while another app is open. | **verify** on a real phone. | open |
| M56 | Rotation mid-edit: keep the selection, the camera centre and an open editor across a portrait/landscape switch. | **verify**. | open |
| M57 | Tablets: under 900 px wide (iPad portrait) the phone drawer applies. Above it (iPad landscape, Windows tablets running the desktop app) the desktop layout applies with a finger as the pointer, and most 44 px rules are inside `max-width` queries. Key the target sizes on `(pointer: coarse)` as well. | Code, `css/app.css` media queries. | open |
| M58 | The Simple and Imagenology views, end to end by touch at 360 and 390. These are for staff who are not technicians, so most phone use will be here. Add a device, connect it, name the room, read the Locate sentence (the backlog notes it has no test at 360), hand over the report. | Backlog gap list, and M37. | open |
| M59 | Very small phones (320 wide, iPhone SE first generation, small Android). Check the drawer, dialogs and selection bar do not clip. | Not measured. | open |
| M60 | A test that holds the rules: a suite that opens each dialog, drawer tab, the table and the rack view at 360 × 780 with touch emulation, and fails on a control under 44 px, a field under 16 px, or anything past the right edge. The audit's probe did this by hand and found every item in Batches 3 and 4. | `tests/suites/` has `touch*.js`, `phonefit.js`, `navnarrow.js`; none checks sizes across dialogs. | open |

---

## Suggested order

Batch 3 first: the 16 px fields are one rule and change every typing task on
an iPhone. Batch 4 next, with M60, so the target sizes are held by a test from
the moment they are fixed. Then batches 5 to 8. M37 waits on the owner's
decision, and every **verify** item waits on a real device.
