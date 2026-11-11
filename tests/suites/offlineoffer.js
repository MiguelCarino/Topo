// Topo to keep on this computer (js/library.js offlineOffer): the landing's
// "Get Topo for this computer" and the About window's line link to the latest
// release, only on the website on a computer, with the file to pick named for
// the computer's system.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const UA = {
    win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    linux: 'Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 15000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  };
  const site = (ua, extra) => offlineOffer(Object.assign({ host: 'topo.carino.systems', ua, desktopApp: false, touch: false }, extra || {}));

  ok('Windows on the website: offered, the setup.exe named', site(UA.win) === 'windows');
  ok('a Mac: offered, the .dmg named', site(UA.mac) === 'mac');
  ok('Linux: offered, the .rpm/.deb/.AppImage named', site(UA.linux) === 'linux');
  ok('a Chromebook: offered, no file named', site(UA.chromebook) === '');
  ok('a phone: not offered', site(UA.android) === null && site(UA.iphone) === null);
  ok('an iPad asking for the desktop site: not offered', site(UA.mac, { touch: true }) === null);
  ok('the desktop app: not offered', site(UA.win, { desktopApp: true }) === null);
  ok('the offline zip (a file) and a Topo server (another host): not offered',
     offlineOffer({ host: '', ua: UA.win, desktopApp: false }) === null && offlineOffer({ host: 'topo.example.lan', ua: UA.win, desktopApp: false }) === null);

  const box = document.getElementById('landingOffline'), about = document.getElementById('aboutOffline');
  const link = document.getElementById('landingOfflineGet');
  ok('hidden on this test page (not the website)', box.hidden && about.hidden);
  renderOfflineOffer({ host: 'topo.carino.systems', ua: UA.win, desktopApp: false, touch: false });
  ok('on the website both show', !box.hidden && !about.hidden);
  ok('the file to pick is named', /setup\.exe/.test(document.getElementById('landingOfflinePick').textContent));
  const latest = 'https://github.com/MiguelCarino/Topo/releases/latest';
  ok('both link to the latest release, in a new tab', link.href === latest && about.querySelector('a').href === latest
     && link.target === '_blank' && /noopener/.test(link.rel));
  ok('the link reads as a chip a finger can press', link.classList.contains('landing-chip'));
  renderOfflineOffer({ host: 'topo.carino.systems', ua: UA.android, desktopApp: false });
  ok('and hide again for a phone', box.hidden && about.hidden && !document.getElementById('landingOfflinePick').textContent);

  // Every string it shows is translated.
  const words = ['Working where there is no internet?', '⤓ Get Topo for this computer', 'To use it with no internet:',
    'download Topo for Windows, Mac or Linux', ...Object.values(OFFLINE_PICK)];
  ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
    const missing = words.filter((w) => !window.CarinoI18N.MESSAGES[loc][w]);
    ok(`${loc} has its words`, !missing.length, missing[0] || '');
  });

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
