// A phone field's country (js/phone.js): the pick in front of every phone
// field, the country read off a typed code, the code written by a pick, a
// local number given its country's code when the field is left. The number
// stays the plain text it was, so nothing else (file, CSV, report) changes.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  try { localStorage.removeItem('nettopo_phone_country'); } catch (e) { /* storage blocked */ }

  // ---- The country of a number ----
  const of = (v, prefer) => phoneCountryOf(v, prefer);
  ok('+52 is Mexico', of('+52 55 1234 5678') === 'MX');
  ok('0052 is Mexico too', of('0052 55 1234 5678') === 'MX');
  ok('a +1 number is the US', of('+1 212 555 0100') === 'US');
  ok('a +1 number with a Canadian area code is Canada', of('+1 416 555 0100') === 'CA');
  ok('a Caribbean area code is its own country', of('+1 809 555 0100') === 'DO' && of('+1 876 555 0100') === 'JM');
  ok('+7 is Russia, +7 6/7 Kazakhstan', of('+7 495 123 4567') === 'RU' && of('+7 701 123 4567') === 'KZ');
  ok('a shared code keeps the country picked', of('+44 1534 123456', 'JE') === 'JE' && of('+44 20 7946 0000') === 'GB');
  ok('half a code, a local number and nothing have no country', of('+5') === '' && of('55 1234 5678') === '' && of('') === '');

  // ---- The code a pick writes ----
  const w = (v, cc) => phoneWithCountry(v, cc);
  ok('a pick replaces the code, the rest as written', w('+52 55 1234 5678', 'JP') === '+81 55 1234 5678', w('+52 55 1234 5678', 'JP'));
  ok('0052 is replaced as +52 is', w('0052 55 1234', 'AR') === '+54 55 1234', w('0052 55 1234', 'AR'));
  ok('a North American area code stays with the number', w('+1 809 555 0100', 'MX') === '+52 809 555 0100', w('+1 809 555 0100', 'MX'));
  ok('and is not written twice', w('+1 809 555 0100', 'DO') === '+1 809 555 0100', w('+1 809 555 0100', 'DO'));
  ok('a local number gets the code, its trunk 0 dropped', w('020 7946 0000', 'GB') === '+44 20 7946 0000' && w('55 1234 5678', 'MX') === '+52 55 1234 5678');
  ok('Italy keeps its 0', w('06 1234 5678', 'IT') === '+39 06 1234 5678');
  ok('an empty field gets the code and a space', w('', 'BR') === '+55 ');

  // ---- The fields ----
  const field = (id) => document.getElementById(id);
  const boxOf = (i) => i.closest('.phone-field');
  ok('your phone in Settings has a country pick', !!boxOf(field('setReporterPhone')));
  ok('so does the problem report\'s', !!boxOf(field('problemPhone')));
  const inp = field('setReporterPhone'), box = boxOf(inp), sel = box.querySelector('select'), txt = box.querySelector('.phone-cc-txt');
  ok('the pick is named for a screen reader', sel.getAttribute('aria-label') === 'Country code');
  // Typed: the country follows the code.
  inp.value = ''; inp.focus();
  const typed = (v) => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
  typed('+8'); typed('+81'); typed('+81 3 1234');
  ok('typing +81 picks Japan', txt.textContent === 'JP +81', txt.textContent);
  ok('and saves the number as typed', state.settings.reporter && state.settings.reporter.phone === '+81 3 1234');
  // Picked: the code is written.
  sel.dispatchEvent(new Event('focus'));
  ok('the list has every country once, and No country first', sel.options[0].value === '' && sel.options.length > 230
     && new Set([...sel.options].map((o) => o.value)).size === sel.options.length);
  sel.value = 'MX'; sel.dispatchEvent(new Event('change'));
  ok('picking Mexico writes +52 in place of +81', inp.value === '+52 3 1234', inp.value);
  ok('and saves it', state.settings.reporter.phone === '+52 3 1234');
  // A local number, left: it takes the code.
  typed('55 9876 5432');
  ok('a local number keeps the country shown', txt.textContent === 'MX +52' && box.classList.contains('phone-hint'));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  ok('leaving it writes the code in front', inp.value === '+52 55 9876 5432' && state.settings.reporter.phone === '+52 55 9876 5432', inp.value);
  // Set by its owner (a redraw): the pick follows.
  inp.value = '+34 91 123 4567';
  ok('a number set by the page shows its country', txt.textContent === 'ES +34' && sel.value === 'ES', txt.textContent);
  // No country: the code goes.
  sel.value = ''; sel.dispatchEvent(new Event('change'));
  ok('No country takes the + off', inp.value === '34 91 123 4567', inp.value);
  ok('the last country picked is the default of an empty field', phoneDefaultCountry() === 'MX');

  // A provider's phone, drawn with its card.
  state.providers = [{ id: 'pvT', name: 'Carrier', phone: '+1 416 555 0100' }];
  const tab = document.getElementById('providerTabBtn');
  if (tab) tab.click();
  _pvEditOpen.add('pvT');
  renderProvidersPanel(true);
  const pv = document.getElementById('pv-pvT-phone');
  ok('a provider\'s phone has the pick, its country read', !!pv && !!boxOf(pv) && boxOf(pv).querySelector('.phone-cc-txt').textContent === 'CA +1',
     pv && boxOf(pv) ? boxOf(pv).querySelector('.phone-cc-txt').textContent : 'none');
  renderProvidersPanel(true);
  const again = document.getElementById('pv-pvT-phone');
  ok('a redrawn card has one pick, not two', again && again.closest('.phone-field').querySelectorAll('select').length === 1);
  const ps = boxOf(again).querySelector('select');
  ps.dispatchEvent(new Event('focus')); ps.value = 'GB'; ps.dispatchEvent(new Event('change'));
  ok('a pick on it saves the provider\'s phone', state.providers[0].phone === '+44 416 555 0100', state.providers[0].phone);

  try { localStorage.removeItem('nettopo_phone_country'); } catch (e) { /* storage blocked */ }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
