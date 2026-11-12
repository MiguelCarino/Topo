// Topo to keep on this computer (js/download.js): the landing's download card
// and the About window's line, only on the website on a computer. The card
// links the release page at once, and the installer for this computer's
// system once GitHub says which release is the latest (here, a fake release:
// the test page never asks GitHub).
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

  ok('Windows on the website: offered', site(UA.win) === 'windows');
  ok('a Mac: offered', site(UA.mac) === 'mac');
  ok('Linux: offered', site(UA.linux) === 'linux');
  ok('a Chromebook: offered, no system named', site(UA.chromebook) === '');
  ok('a phone: not offered', site(UA.android) === null && site(UA.iphone) === null);
  ok('an iPad asking for the desktop site: not offered', site(UA.mac, { touch: true }) === null);
  ok('the desktop app: not offered', site(UA.win, { desktopApp: true }) === null);
  ok('the offline zip (a file) and a Topo server (another host): not offered',
     offlineOffer({ host: '', ua: UA.win, desktopApp: false }) === null && offlineOffer({ host: 'topo.example.lan', ua: UA.win, desktopApp: false }) === null);

  // ---- The plan for a release, as Tauri names its files ----
  const dl = (n) => 'https://github.com/MiguelCarino/Topo/releases/download/v0.0.3/' + n;
  const names = ['Topo_0.0.3_aarch64.dmg', 'Topo_0.0.3_x64.dmg', 'Topo_0.0.3_aarch64.app.tar.gz', 'Topo_0.0.3_x64.app.tar.gz',
    'Topo_0.0.3_x64-setup.exe', 'Topo_0.0.3_arm64-setup.exe', 'Topo_0.0.3_amd64.AppImage', 'Topo_0.0.3_aarch64.AppImage',
    'Topo_0.0.3_amd64.deb', 'Topo_0.0.3_arm64.deb', 'Topo-0.0.3-1.x86_64.rpm', 'Topo-0.0.3-1.aarch64.rpm',
    'Topo-0.0.3-offline.zip', 'topo-server-linux-amd64', 'SHA256SUMS'];
  const release = { tag_name: 'v0.0.3', assets: names.map((n, i) => ({ name: n, browser_download_url: dl(n), size: (i + 2) * 1048576 })) };
  const mac = downloadPlan(release, 'mac', 'MacIntel');
  ok('a Mac gets the Apple silicon .dmg', mac.primary && mac.primary.url === dl('Topo_0.0.3_aarch64.dmg') && mac.primary.label === 'Apple silicon', JSON.stringify(mac.primary));
  ok('and Intel is the first other link', mac.others[0].url === dl('Topo_0.0.3_x64.dmg') && mac.others[0].label === 'macOS Intel', JSON.stringify(mac.others[0]));
  ok('the version has no v', mac.version === '0.0.3');
  const win = downloadPlan(release, 'windows', 'Win32');
  ok('Windows gets the x64 setup.exe, Arm64 next', win.primary.url === dl('Topo_0.0.3_x64-setup.exe') && win.others[0].url === dl('Topo_0.0.3_arm64-setup.exe'));
  const lin = downloadPlan(release, 'linux', 'Linux x86_64');
  ok('Linux on x86_64 gets the x64 AppImage', lin.primary.url === dl('Topo_0.0.3_amd64.AppImage') && lin.primary.label === 'AppImage x64', JSON.stringify(lin.primary));
  ok('Linux on Arm gets the Arm64 AppImage', downloadPlan(release, 'linux', 'Linux aarch64').primary.url === dl('Topo_0.0.3_aarch64.AppImage'));
  ok('the .deb and .rpm are listed for Linux', ['Topo_0.0.3_amd64.deb', 'Topo-0.0.3-1.x86_64.rpm', 'Topo_0.0.3_arm64.deb', 'Topo-0.0.3-1.aarch64.rpm'].every((n) => lin.others.some((o) => o.url === dl(n))));
  const urls = mac.others.map((o) => o.url).concat(mac.primary.url);
  ok('every installer and the zip are offered, once', names.filter((n) => !/app\.tar\.gz|topo-server|SHA256/.test(n)).every((n) => urls.filter((u) => u === dl(n)).length === 1), urls.length);
  ok('the bare app archives, the servers and the sums are not', !urls.some((u) => /app\.tar\.gz|topo-server|SHA256/.test(u)));
  ok('the zip comes last', mac.others[mac.others.length - 1].sys === 'zip');
  const nomac = downloadPlan({ tag_name: 'v0.0.3', assets: release.assets.filter((a) => !/\.dmg$/.test(a.name)) }, 'mac', '');
  ok('a release with no build for this system has no primary', nomac.primary === null && nomac.others.length > 0);
  const evil = downloadPlan({ tag_name: 'v1', assets: [{ name: 'Topo_1_x64-setup.exe', browser_download_url: 'javascript:alert(1)', size: 1 }] }, 'windows', '');
  ok('a link that is not GitHub is dropped', evil.primary === null && evil.others.length === 0);

  // ---- On the page ----
  const card = document.getElementById('landingGet'), about = document.getElementById('aboutOffline');
  const github = document.getElementById('aboutGithub');
  const link = document.getElementById('landingGetLink');
  ok('hidden on this test page (not the website)', card.hidden && about.hidden && github.hidden);
  ok('it sits beside the way in', card.parentElement === document.getElementById('landingDrop').parentElement);
  renderOfflineOffer({ host: 'topo.carino.systems', ua: UA.win, desktopApp: false, touch: false, platform: 'Win32' });
  ok('on the website the card, the About line and the GitHub notice show', !card.hidden && !about.hidden && !github.hidden);
  const latest = 'https://github.com/MiguelCarino/Topo/releases/latest';
  ok('before GitHub answers it links the latest release, in a new tab', link.href === latest && link.target === '_blank' && /noopener/.test(link.rel)
     && /Get Topo for this computer/.test(link.textContent));
  _downloadRelease = release;
  renderDownloadCard('windows', 'Win32');
  ok('with the release it downloads the installer itself', link.href === dl('Topo_0.0.3_x64-setup.exe') && /Download for Windows/.test(link.textContent), link.textContent);
  ok('and names the version, the machine and the size', /^0\.0\.3 · x64 · \d+ MB$/.test(document.getElementById('landingGetMeta').textContent), document.getElementById('landingGetMeta').textContent);
  const others = [...document.getElementById('landingGetOthers').querySelectorAll('a')];
  ok('the other builds are listed, then All downloads', others.length > 5 && others[others.length - 1].href === latest
     && others[0].textContent === 'Windows Arm64', others.map((a) => a.textContent).join(' | '));
  _downloadRelease = null;
  renderOfflineOffer({ host: 'topo.carino.systems', ua: UA.android, desktopApp: false });
  ok('and all of it hides again for a phone', card.hidden && about.hidden && github.hidden);

  // Every string it shows is translated.
  const words = ['Working where there is no internet?', '⤓ Get Topo for this computer', 'To use it with no internet:',
    'download Topo for Windows, Mac or Linux', '⤓ Download for {os}', 'Offline folder (.zip)', 'All downloads',
    'This site also asks GitHub for the latest desktop version.',
    'An installer for Windows, Mac and Linux, or a folder to open in a browser. It works with no internet, and your networks stay on this computer.'];
  ['es', 'pt-BR', 'ru', 'ja'].forEach((loc) => {
    const missing = words.filter((w) => !window.CarinoI18N.MESSAGES[loc][w]);
    ok(`${loc} has its words`, !missing.length, missing[0] || '');
  });

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
