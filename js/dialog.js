// ---- Questions in the page: the native alert / confirm / prompt, replaced ----
// Topo used about forty native dialogs, and each was wrong in a way the page
// could not fix:
//
//   * They block the whole tab. Boot awaits load(), so one raised during boot
//     froze a blank page (openBinderLink and the unlock dialog already avoided
//     them for that reason).
//   * Their buttons speak the browser's language, not the page's. A Spanish
//     reporter got a Spanish question with "OK / Cancel" under it, and nothing
//     the dictionary could do about it.
//   * Chromium lets the visitor tick "don't let this page ask again", after
//     which confirm() answers false on its own. A replace or a delete that
//     silently never happens is worse than one that asks.
//   * They cannot offer a third answer. Re-importing a network you already
//     have needs "Update it / Open as a copy / Cancel", which no native dialog
//     can say.
//
// So there is one modal (#topoAsk in index.html), opened through the fleet's
// CarinoUI.modal (focus kept inside, Esc and the scrim dismiss, focus returned
// to whatever asked), and five ways to ask it something. Each returns a
// Promise. Dismissing is always the cautious answer: false, null, or no choice.
//
// Questions queue. A second one asked while the first is open (a storage
// failure reported in the middle of a rename, say) waits its turn instead of
// replacing it, so no answer is ever given to the wrong question.
//
// Tests cannot click through a modal under the headless runner's virtual clock
// any more than they could answer a native one, and every answer in a suite is
// a precondition rather than a result. setDialogResponder(fn) answers instead
// of the modal: fn receives the request ({ kind, message, title, value,
// choices }) and returns the answer. tests/suites/dialog.js drives the real
// modal once, so the stand-in does not hide a broken one.

let _askResponder = null;
let _askQueue = Promise.resolve();

// -> the previous responder, so a suite can put it back.
function setDialogResponder(fn) {
    const prev = _askResponder;
    _askResponder = typeof fn === 'function' ? fn : null;
    return prev;
}

// What dismissing answers, per kind: never the answer that does something.
const ASK_DISMISSED = { tell: undefined, confirm: false, prompt: null, choice: null, ticks: null, pick: null };

function ask(req) {
    if (_askResponder) {
        const responder = _askResponder;
        return Promise.resolve().then(() => responder(req));
    }
    const run = _askQueue.then(() => showAsk(req));
    _askQueue = run.catch(() => {});
    return run;
}

// An acknowledgement: something happened that the visitor has to read before
// carrying on. A one-line notice that needs no answer is a toast (showToast in
// js/app.js), not this.
function tell(message, opts = {}) {
    return ask({ kind: 'tell', message, title: opts.title || '', ok: opts.ok }).then(() => undefined);
}

// Yes or no. opts.ok names the yes (a verb is clearer than "OK"), opts.danger
// marks it as destructive.
function askConfirm(message, opts = {}) {
    return ask({ kind: 'confirm', message, title: opts.title || '', ok: opts.ok, cancel: opts.cancel, danger: !!opts.danger })
        .then((v) => v === true);
}

// opts.keys names the phone keyboard the line is typed on (KEYBOARDS,
// js/ui.js): 'code' for a CIDR, 'name' for a name. It joins the request only
// when given, so a test's responder sees the same request as before.
const promptKeys = (req, opts) => (opts.keys ? Object.assign(req, { keys: opts.keys }) : req);

// A line of text, or null when dismissed. An empty answer is '' rather than
// null, as prompt() returned it, so a caller can tell "left blank" from "no".
function askPrompt(message, opts = {}) {
    return ask(promptKeys({ kind: 'prompt', message, title: opts.title || '', value: opts.value == null ? '' : String(opts.value), ok: opts.ok }, opts))
        .then((v) => (v === null || v === undefined ? null : String(v)));
}

// A line of text and one choice from a list, asked together: a new group's
// name and its kind (js/groupmap.js, "A new group from two devices"). opts.pick
// is { label, options: [{ id, label, text? }], value }. An option's `text` is
// the line it suggests: choosing that option retypes the line, unless the
// visitor has typed one of their own (the line no longer reads as the last
// suggestion). -> { value, pick } or null when dismissed. A test's responder
// may answer with that object, or with a string (the pick left as it was).
function askPromptPick(message, opts = {}) {
    const pick = opts.pick || {};
    const options = (pick.options || []).filter((o) => o && o.id);
    const first = options.some((o) => o.id === pick.value) ? pick.value : (options[0] ? options[0].id : '');
    return ask(promptKeys({ kind: 'prompt', message, title: opts.title || '', value: opts.value == null ? '' : String(opts.value), ok: opts.ok,
        pick: { label: pick.label || '', options, value: first } }, opts))
        .then((v) => {
            if (v === null || v === undefined) return null;
            if (typeof v !== 'object') return { value: String(v), pick: first };
            return { value: v.value == null ? '' : String(v.value), pick: options.some((o) => o.id === v.pick) ? v.pick : first };
        });
}

// A line of text and a date, asked together: the reason and, optionally,
// the day it may wait until (Accept on a finding, js/diagnostics.js). opts.date is { label, value,
// min } with dates as 'YYYY-MM-DD'. -> { value, date } or null when
// dismissed; date is '' when none was picked and '!' when one was typed
// only in part. A test's responder answers with that object.
function askPromptDate(message, opts = {}) {
    const d = opts.date || {};
    return ask(promptKeys({ kind: 'prompt', message, title: opts.title || '', value: opts.value == null ? '' : String(opts.value), ok: opts.ok,
        date: { label: d.label || '', value: d.value || '', min: d.min || '' } }, opts))
        .then((v) => {
            if (v === null || v === undefined) return null;
            if (typeof v !== 'object') return { value: String(v), date: '' };
            return { value: v.value == null ? '' : String(v.value), date: v.date == null ? '' : String(v.date) };
        });
}

// One of several answers, by id, or null. choices: [{ id, label, primary? }],
// in the order they should read; Cancel is added after them.
function askChoice(message, opts = {}) {
    const choices = (opts.choices || []).filter((c) => c && c.id);
    return ask({ kind: 'choice', message, title: opts.title || '', choices })
        .then((v) => (choices.some((c) => c.id === v) ? v : null));
}

// A review: rows to tick under the message, each on unless it says
// otherwise, and the answer applies only what is ticked (Split model and
// firmware, js/assets.js). opts.rows is [{ id, label, detail?, checked? }];
// opts.after is a line under the list (what is left out, and why). The yes
// is disabled while nothing is ticked. -> the ticked ids in row order, or
// null when dismissed. A test's responder answers with an array of ids.
function askTicks(message, opts = {}) {
    const rows = (opts.rows || []).filter((r) => r && r.id)
        .map((r) => ({ id: String(r.id), label: String(r.label || ''), detail: r.detail ? String(r.detail) : '', checked: r.checked !== false }));
    return ask({ kind: 'ticks', message, title: opts.title || '', ok: opts.ok, rows, after: opts.after ? String(opts.after) : '' })
        .then((v) => (Array.isArray(v) ? rows.map((r) => r.id).filter((id) => v.includes(id)) : null));
}

// One of a list, by id, or null: a row each, one picked at a time (the
// network a file is merged into, js/mergeui.js). opts.rows is [{ id, label,
// detail? }], opts.value the one picked at first (none when omitted: the yes
// waits for a pick). A test's responder answers with an id.
function askPick(message, opts = {}) {
    const rows = (opts.rows || []).filter((r) => r && r.id)
        .map((r) => ({ id: String(r.id), label: String(r.label || ''), detail: r.detail ? String(r.detail) : '' }));
    const value = rows.some((r) => r.id === opts.value) ? String(opts.value) : '';
    return ask({ kind: 'pick', message, title: opts.title || '', ok: opts.ok, rows, value })
        .then((v) => (rows.some((r) => r.id === v) ? v : null));
}

function showAsk(req) {
    return new Promise((resolve) => {
        const scrim = document.getElementById('topoAsk');
        if (!scrim) { resolve(ASK_DISMISSED[req.kind]); return; }
        const title = document.getElementById('topoAskTitle');
        const head = document.getElementById('topoAskHead');
        const msg = document.getElementById('topoAskMsg');
        const input = document.getElementById('topoAskInput');
        const foot = document.getElementById('topoAskFoot');
        const pickRow = document.getElementById('topoAskPickRow');
        const pick = document.getElementById('topoAskPick');

        title.textContent = req.title || '';
        head.hidden = !req.title;
        msg.textContent = req.message || '';
        // CarinoUI.modal.open focuses the card's first control, which for a
        // prompt is this field. On a touch screen that focus would bring the
        // keyboard up before the question is read, so there the field joins
        // the card only after the focus has landed on one of its buttons.
        const holdField = req.kind === 'prompt' && holdKeyboard();
        input.hidden = req.kind !== 'prompt' || holdField;
        input.value = req.kind === 'prompt' ? req.value : '';
        // Every prompt sets its own keyboard, so one asking for a CIDR never
        // leaves its capitals-off keyboard on the next one asking for a name.
        if (req.kind === 'prompt') setKeyboard(input, req.keys || 'prose', { enter: 'done' });
        foot.innerHTML = '';
        // The list under the line, for askPromptPick; hidden for every other
        // question. Its options are text nodes, never markup: a group's kind
        // is a word of ours, but the rule costs nothing.
        const picking = !!(req.pick && pickRow && pick);
        if (pickRow) pickRow.hidden = !picking;
        if (pick) { pick.innerHTML = ''; pick.onchange = null; }
        if (picking) {
            document.getElementById('topoAskPickLabel').textContent = req.pick.label;
            req.pick.options.forEach((o) => {
                const el = document.createElement('option');
                el.value = o.id;
                el.textContent = o.label;
                pick.appendChild(el);
            });
            pick.value = req.pick.value;
            let suggested = (req.pick.options.find((o) => o.id === pick.value) || {}).text;
            pick.onchange = () => {
                const o = req.pick.options.find((x) => x.id === pick.value);
                if (o && o.text != null && (input.value === suggested || !input.value.trim())) input.value = o.text;
                suggested = o ? o.text : suggested;
            };
        }
        // The date under the line, for askPromptDate.
        const dateRow = document.getElementById('topoAskDateRow');
        const date = document.getElementById('topoAskDate');
        const dating = !!(req.date && dateRow && date);
        if (dateRow) dateRow.hidden = !dating;
        if (dating) {
            document.getElementById('topoAskDateLabel').textContent = req.date.label;
            date.value = req.date.value;
            date.min = req.date.min || '';
        }
        // A day typed in part (or one that does not exist) reads as '' from
        // a date input, the same as none picked, and would accept for good
        // what was meant to wait. It answers '!' instead, which no caller
        // reads as a day, so it is refused rather than taken as "no date".
        // The rows to tick, for askTicks: text nodes, never markup, since a
        // row names a device and its typed text.
        const ticksEl = document.getElementById('topoAskTicks');
        const afterEl = document.getElementById('topoAskAfter');
        const ticking = (req.kind === 'ticks' || req.kind === 'pick') && !!ticksEl;
        const radios = req.kind === 'pick';
        if (ticksEl) { ticksEl.hidden = !ticking; ticksEl.textContent = ''; }
        if (afterEl) { afterEl.hidden = !(ticking && req.after); afterEl.textContent = ticking ? req.after : ''; }
        if (ticking) {
            req.rows.forEach((r) => {
                const li = document.createElement('li');
                const lab = document.createElement('label');
                lab.className = 'ask-tick';
                const box = document.createElement('input');
                if (radios) { box.type = 'radio'; box.name = 'topoAskPickRow'; box.value = r.id; box.checked = r.id === req.value; } else { box.type = 'checkbox'; box.value = r.id; box.checked = r.checked; }
                const text = document.createElement('span');
                const name = document.createElement('span');
                name.className = 'ask-tick-name'; name.textContent = r.label;
                text.appendChild(name);
                if (r.detail) {
                    const d = document.createElement('span');
                    d.className = 'ask-tick-detail'; d.textContent = r.detail;
                    text.appendChild(d);
                }
                lab.append(box, text);
                li.appendChild(lab);
                ticksEl.appendChild(li);
            });
        }
        const tickedIds = () => [...ticksEl.querySelectorAll('input[type=checkbox], input[type=radio]')].filter((b) => b.checked).map((b) => b.value);
        const pickedId = () => tickedIds()[0] || null;
        const dayTyped = () => (date.validity && date.validity.badInput ? '!' : date.value);
        const answer = () => (picking ? { value: input.value, pick: pick.value } : dating ? { value: input.value, date: dayTyped() } : input.value);

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            if (window.CarinoUI) CarinoUI.modal.close(scrim, 'answered');
            else scrim.hidden = true;
            input.onkeydown = null;
            if (pick) pick.onchange = null;
            if (ticksEl) ticksEl.onchange = null;
            resolve(value);
        };
        const button = (label, value, primary, danger) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `btn${primary ? ' btn-primary' : ''}${danger ? ' ask-danger' : ''}`;
            b.textContent = label;
            b.onclick = () => finish(typeof value === 'function' ? value() : value);
            foot.appendChild(b);
            return b;
        };

        let main = null;
        if (req.kind === 'tell') {
            // Not t('OK'): that key is the diagnostics' status word, and
            // Japanese translates it as 正常 ("normal").
            main = button(req.ok || t('Got it'), undefined, true);
        } else if (req.kind === 'choice') {
            // Cancel first in the markup, as on every other dialog here, so the
            // answers read left to right with the one that does most last.
            button(t('Cancel'), null, false);
            req.choices.forEach((c) => { const b = button(c.label, c.id, !!c.primary); if (c.primary) main = b; });
        } else {
            button(req.cancel || t('Cancel'), ASK_DISMISSED[req.kind], false);
            main = button(req.ok || t('Continue'), req.kind === 'prompt' ? answer : radios ? pickedId : ticking ? tickedIds : true, true, req.danger);
        }
        if (ticking && main) {
            const sync = () => { main.disabled = !tickedIds().length; };
            ticksEl.onchange = sync;
            sync();
        }
        if (req.kind === 'prompt') {
            input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(answer()); } };
        }

        const onDismiss = () => finish(ASK_DISMISSED[req.kind]);
        if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss });
        else scrim.hidden = false;
        if (holdField) input.hidden = false;
        // CarinoUI focuses the first control. A prompt wants its text selected
        // for retyping; a notice wants its one button; a question keeps the
        // focus on Cancel, so a stray Enter is the cautious answer. On a touch
        // screen the prompt's field waits for a tap (focusForTyping), and the
        // button CarinoUI focused keeps the focus.
        if (req.kind === 'prompt') focusForTyping(input, scrim.querySelector('.modal'), { select: true });
        else if (req.kind === 'tell' && main) main.focus();
    });
}

// Opening without a keyboard (Mobile review M17). A dialog or a card that
// opens with its text field focused saves a mouse user a click. On a touch
// screen the same focus raises the on-screen keyboard over half the phone
// before anyone has read what opened. So on a coarse pointer nothing opens
// into a text field: the focus goes to the dialog's card instead, so that a
// screen reader starts at its title and a hardware keyboard's Esc and Tab
// still work there, and the field waits for a tap. A field the visitor asked
// for by name (a table cell, a note's text, '/', W, Custom watts) is focused
// as before, at its own call site, not through these helpers.
function holdKeyboard() {
    try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
}
const KEYBOARD_INPUTS = new Set(['text', 'search', 'password', 'email', 'url', 'tel', 'number']);
// Would focusing el bring up a touch screen's keyboard? A date, a tick, a
// select or a read-only field does not.
function raisesKeyboard(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && KEYBOARD_INPUTS.has(el.type);
}
// Focuses field as a mouse's screen always has (and selects its text when
// opts.select), unless that would raise a touch screen's keyboard; then the
// focus goes to box, the dialog's card, when there is one. -> true when the
// field got the focus.
function focusForTyping(field, box, opts = {}) {
    if (!field) return false;
    // A field that already has the focus keeps it: its keyboard is already up,
    // from the visitor's own tap. This keeps Enter-to-add in Columns and an
    // Enter retry on the unlock dialog from dropping the keyboard.
    if (!holdKeyboard() || !raisesKeyboard(field) || document.activeElement === field) {
        field.focus();
        if (opts.select && field.select) field.select();
        return true;
    }
    // reveal stands in for the scroll that focus() would have done.
    if (opts.reveal && field.scrollIntoView) field.scrollIntoView({ block: 'nearest' });
    // A non-text control CarinoUI already focused inside the box (the ✕,
    // Cancel) is left where it is.
    const a = document.activeElement;
    if (box && (!a || !box.contains(a) || raisesKeyboard(a))) {
        if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
        box.focus({ preventScroll: true });
    }
    return false;
}
// Where a closing dialog should send the focus back: the field, unless that
// would raise a touch screen's keyboard, and then fallback.
const typingTarget = (field, fallback) => (holdKeyboard() && raisesKeyboard(field) ? fallback : field);

// Published for the suites, which reach the app as bare globals anyway.
window.TopoDialog = { ask, tell, askConfirm, askPrompt, askPromptPick, askPromptDate, askChoice, askTicks, askPick, setDialogResponder,
    holdKeyboard, raisesKeyboard, focusForTyping, typingTarget };
