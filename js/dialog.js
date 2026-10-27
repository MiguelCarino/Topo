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
// to whatever asked), and four ways to ask it something. Each returns a
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

        title.textContent = req.title || '';
        head.hidden = !req.title;
        msg.textContent = req.message || '';
        input.hidden = req.kind !== 'prompt';
        input.value = req.kind === 'prompt' ? req.value : '';
        foot.innerHTML = '';

        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            if (window.CarinoUI) CarinoUI.modal.close(scrim, 'answered');
            else scrim.hidden = true;
            input.onkeydown = null;
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
            main = button(req.ok || t('Continue'), req.kind === 'prompt' ? () => input.value : true, true, req.danger);
        }
        if (req.kind === 'prompt') {
            input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } };
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
window.TopoDialog = { ask, tell, askConfirm, askPrompt, askChoice, setDialogResponder };
