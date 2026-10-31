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
const ASK_DISMISSED = { tell: undefined, confirm: false, prompt: null, choice: null };

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

// A line of text, or null when dismissed. An empty answer is '' rather than
// null, as prompt() returned it, so a caller can tell "left blank" from "no".
function askPrompt(message, opts = {}) {
    return ask({ kind: 'prompt', message, title: opts.title || '', value: opts.value == null ? '' : String(opts.value), ok: opts.ok })
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
    return ask({ kind: 'prompt', message, title: opts.title || '', value: opts.value == null ? '' : String(opts.value), ok: opts.ok,
        pick: { label: pick.label || '', options, value: first } })
        .then((v) => {
            if (v === null || v === undefined) return null;
            if (typeof v !== 'object') return { value: String(v), pick: first };
            return { value: v.value == null ? '' : String(v.value), pick: options.some((o) => o.id === v.pick) ? v.pick : first };
        });
}

// A line of text and a date, asked together: what is planned and the day
// (a scheduled finding, js/diagnostics.js). opts.date is { label, value,
// min } with dates as 'YYYY-MM-DD'. -> { value, date } or null when
// dismissed; date is '' when none was picked. A test's responder answers
// with that object.
function askPromptDate(message, opts = {}) {
    const d = opts.date || {};
    return ask({ kind: 'prompt', message, title: opts.title || '', value: opts.value == null ? '' : String(opts.value), ok: opts.ok,
        date: { label: d.label || '', value: d.value || '', min: d.min || '' } })
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
        input.hidden = req.kind !== 'prompt';
        input.value = req.kind === 'prompt' ? req.value : '';
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
        const answer = () => (picking ? { value: input.value, pick: pick.value } : dating ? { value: input.value, date: date.value } : input.value);

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            if (window.CarinoUI) CarinoUI.modal.close(scrim, 'answered');
            else scrim.hidden = true;
            input.onkeydown = null;
            if (pick) pick.onchange = null;
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
            main = button(req.ok || t('Continue'), req.kind === 'prompt' ? answer : true, true, req.danger);
        }
        if (req.kind === 'prompt') {
            input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(answer()); } };
        }

        const onDismiss = () => finish(ASK_DISMISSED[req.kind]);
        if (window.CarinoUI) CarinoUI.modal.open(scrim, { onDismiss });
        else scrim.hidden = false;
        // CarinoUI focuses the first control. A prompt wants its text selected
        // for retyping; a notice wants its one button; a question keeps the
        // focus on Cancel, so a stray Enter is the cautious answer.
        if (req.kind === 'prompt') { input.focus(); input.select(); }
        else if (req.kind === 'tell' && main) main.focus();
    });
}

// Published for the suites, which reach the app as bare globals anyway.
window.TopoDialog = { ask, tell, askConfirm, askPrompt, askPromptPick, askPromptDate, askChoice, setDialogResponder };
