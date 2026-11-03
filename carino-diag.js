/* ============================================================
   carino-diag.js — the "Sys. Status" button and panel for the shared navbar.
   ------------------------------------------------------------
   Drop this file into any Carino project and add it AFTER carino-navbar.js:

     <script src="carino-navbar.js" data-app="AppName" defer></script>
     <script src="carino-diag.js" defer></script>

   It adds a "Sys. Status" button to the navbar's right cluster and the
   same panel carino.systems has in its header (assets/js/clock-network.js
   in Carino-Systems), section for section:
     Last check · Reachability (15 well-known endpoints, up/down + latency)
     Network    IPv4, IPv6, LAN, NAT, paths (WebRTC), ISP, ping, jitter,
                connection, speed
     Hardware   CPU, RAM, GPU, screen, battery
     System     client, UTC, epoch
     Certificate  what carino.systems/certs.json says this site serves
     Retry · Export (a PNG of the panel) · Complete test (test.carino.systems)
   This used to be a trimmed, network-only version; it is the hub's now.

   Lazy, unlike the hub: nothing is measured or requested until the panel
   is first opened, so loading the page contacts no third party. A page
   with a Content-Security-Policy must allow what the panel asks (Topo's
   index.html lists every host). After the first open, opening it again
   re-checks reachability at most once a minute; Retry re-runs everything.

   On an intranet, point it at an address service of your own and no
   third party is asked for the address:

     <script src="carino-diag.js" data-whoami="/whoami" defer></script>

   Anything answering with a bare IP address in the body will do (Caddy
   needs one line — see carino-offline.caddyfile.example in
   MiguelCarino/Custom-Images). It is tried before every public provider;
   if it 404s or is not configured the chain simply carries on.

   Self-contained: styles are inlined and scoped under #cnDiagBox /
   #cnDiagBtn with the hub's dark colours hard-coded (no CSS variables),
   so it is safe on light-themed or Tailwind pages and needs no CDN. A page
   with the Colourful theme restyles it from its own sheet (Topo's
   index.html does).

   Language: its labels and status words come from a dictionary here (es,
   pt-BR, ja, ru, the hub's own wording), picked by CarinoLang.current or
   <html lang>, with a site's window.t winning when it has the string.
   IPv4, IPv6, LAN, NAT, ISP, CPU, RAM, GPU, UTC and Epoch are names and
   stay as they are.
   ============================================================ */
(function () {
  'use strict';

  const A = '#eab308', BG = '#0b0b0b', BORDER = '#262626', MUTED = '#8a8a8a', SEC = '#a3a3a3', TEXT = '#fff';
  const MONO = '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace';

  const CSS = ''
    + '#cnDiagBtn{display:flex;align-items:center;gap:8px;background:transparent;border:1px solid ' + BORDER + ';'
    + 'color:' + SEC + ';font-family:' + MONO + ';font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;'
    + 'padding:0 14px;height:30px;border-radius:4px;cursor:pointer;transition:.2s;white-space:nowrap;position:relative;'
    + '-webkit-appearance:none;appearance:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;}'
    + '#cnDiagBtn:hover,#cnDiagBtn[aria-expanded="true"]{border-color:' + A + ';color:' + A + ';background:rgba(234,179,8,.08);}'
    + '#cnDiagBtn:focus-visible{outline:2px solid ' + A + ';outline-offset:2px;}'
    + '#cnDiagBtn .cn-pulse{width:6px;height:6px;border-radius:50%;background:' + A + ';box-shadow:0 0 8px ' + A + ';'
    + 'animation:cnPulseGlow 2s ease-in-out infinite;flex-shrink:0;}'
    + '@keyframes cnPulseGlow{0%,100%{opacity:1;}50%{opacity:.4;}}'
    + '@keyframes cnScan{0%,100%{opacity:1;}50%{opacity:.35;}}'
    // On a phone the word is clipped, not removed: it is the button's name.
    + '@media(max-width:640px){#cnDiagBtn{padding:0 10px;}#cnDiagBtn .lbl{position:absolute;width:1px;height:1px;padding:0;'
    + 'margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;}}'

    + '#cnDiagBox{position:fixed;top:69px;right:16px;width:440px;max-width:calc(100vw - 32px);'
    + 'max-height:calc(100vh - 86px);max-height:calc(100dvh - 86px);overflow-y:auto;overscroll-behavior:contain;'
    + 'scrollbar-width:thin;scrollbar-color:' + BORDER + ' transparent;'
    + 'background:' + BG + ';border:1px solid rgba(234,179,8,.45);padding:20px;border-radius:6px;'
    + 'box-shadow:0 10px 40px rgba(0,0,0,.8);opacity:0;pointer-events:none;transform:translateY(-10px);visibility:hidden;'
    + 'transition:opacity .3s ease,transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s linear .3s;z-index:2147483001;'
    + 'font-family:' + MONO + ';text-align:left;color:' + TEXT + ';}'
    + '#cnDiagBox.open{opacity:1;pointer-events:auto;transform:translateY(0);visibility:visible;transition-delay:0s;}'
    + '#cnDiagBox *{box-sizing:border-box;}'
    + '#cnDiagBox .d-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;font-size:.75rem;line-height:1.4;}'
    + '#cnDiagBox .d-lbl{color:' + MUTED + ';text-transform:uppercase;letter-spacing:.05em;flex-shrink:0;}'
    + '#cnDiagBox .d-val{color:' + TEXT + ';text-align:right;}'
    + '#cnDiagBox .d-trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;}'
    + '#cnDiagBox .d-trunc>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '#cnDiagBox .d-grp{display:flex;align-items:center;gap:6px;min-width:0;justify-content:flex-end;}'
    + '#cnDiagBox .d-sec{color:' + MUTED + ';font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;'
    + 'margin:10px 0 5px;opacity:.45;border-bottom:1px solid ' + BORDER + ';padding-bottom:3px;}'
    + '#cnDiagBox .d-sec .d-count{float:right;}'
    + '#cnDiagBox .d-head{border-bottom:1px solid ' + BORDER + ';padding-bottom:8px;margin-bottom:12px;}'
    + '#cnDiagBox .d-pair{display:flex;flex-wrap:wrap;justify-content:space-between;column-gap:20px;}'
    + '#cnDiagBox .d-pair>.d-row{flex:0 1 auto;min-width:max-content;gap:8px;}'
    + '#cnDiagBox .d-note{margin:2px 0 6px;color:' + MUTED + ';font-size:.62rem;line-height:1.5;}'
    + '#cnDiagBox [data-cert][hidden]{display:none;}'
    + '#cnDiagBox .r-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:4px;margin-bottom:8px;}'
    + '#cnDiagBox .r-cell{display:flex;align-items:center;gap:4px;border:1px solid ' + BORDER + ';border-radius:3px;padding:3px 5px;min-width:0;}'
    + '#cnDiagBox .r-cell .lbl{flex:1 1 auto;min-width:0;font-size:.62rem;color:' + SEC + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
    + '#cnDiagBox .r-cell .ms,#cnDiagBox .r-cell .ip{display:none;}'
    + '@media(max-width:480px){#cnDiagBox .r-grid{grid-template-columns:repeat(3,1fr);}}'
    + '#cnDiagBox .dot{width:5px;height:5px;border-radius:50%;display:inline-block;flex-shrink:0;background:#666;}'
    + '#cnDiagBox .dot.ok{background:' + A + ';box-shadow:0 0 4px ' + A + ';}'
    + '#cnDiagBox .dot.slow{background:#fff;box-shadow:0 0 4px rgba(255,255,255,.6);}'
    + '#cnDiagBox .dot.bad{background:#ef4444;box-shadow:0 0 4px #ef4444;}'
    + '#cnDiagBox .dot.scan{background:' + SEC + ';animation:cnScan 1s infinite;}'
    + '#cnDiagBox .d-actions{display:flex;gap:8px;}'
    + '#cnDiagBox .d-btn{display:flex;flex:1;align-items:center;justify-content:center;gap:5px;width:100%;'
    + 'margin-top:16px;background:transparent;border:1px solid ' + BORDER + ';color:' + SEC + ';'
    + 'font-family:' + MONO + ';font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;text-decoration:none;'
    + 'padding:8px 0;border-radius:4px;cursor:pointer;transition:.2s;-webkit-appearance:none;appearance:none;}'
    + '#cnDiagBox .d-btn:hover{border-color:' + A + ';color:' + A + ';}'
    + '#cnDiagBox .d-btn:focus-visible{outline:2px solid ' + A + ';outline-offset:2px;}'
    + '#cnDiagBox .d-btn svg{width:12px;height:12px;}'
    + '#cnDiagBox .d-test{margin-top:8px;border-color:rgba(234,179,8,.45);color:' + A + ';background:rgba(234,179,8,.08);}'
    + '#cnDiagBox .d-test:hover{border-color:' + A + ';background:rgba(234,179,8,.16);}'
    + '@media(prefers-reduced-motion:reduce){#cnDiagBtn .cn-pulse,#cnDiagBox .dot.scan{animation:none;}#cnDiagBox{transition:none;}}';

  // The hub's own wording (Carino-Systems/i18n.js), so the panel reads the same there and here.
  const L10N = {
    "es": {
      "Sys. Status": "Estado del sist.",
      "Last Check": "Última comprobación",
      "Reachability": "Conectividad",
      "Network": "Red",
      "Paths": "Rutas",
      "Ping": "Ping",
      "Jitter": "Fluctuación",
      "Conn": "Conexión",
      "Speed": "Velocidad",
      "Hardware": "Hardware",
      "Screen": "Pantalla",
      "Battery": "Batería",
      "System": "Sistema",
      "Client": "Cliente",
      "Certificate": "Certificado",
      "Issuer": "Emisor",
      "Valid until": "Válido hasta",
      "Fleet": "Todos los sitios",
      "If your padlock shows a different issuer or fingerprint, your antivirus or network is inspecting HTTPS on this device.": "Si tu candado muestra otro emisor u otra huella, tu antivirus o tu red está inspeccionando el HTTPS en este dispositivo.",
      "Retry": "Reintentar",
      "Export": "Exportar",
      "Complete test": "Prueba completa",
      "Blocked or unreachable": "Bloqueado o inalcanzable",
      "mDNS masked": "Oculto por mDNS",
      "Logical Cores": "núcleos lógicos",
      "Unknown (Masked)": "Desconocido (oculto)",
      "Masked": "Oculto",
      "Charging": "Cargando",
      "On battery": "Con batería",
      "N/A": "N/D",
      "Unknown": "Desconocido",
      "Unknown GPU": "GPU desconocida",
      "Error": "Error",
      "Testing...": "Probando...",
      "Timeout": "Tiempo agotado",
      "Boost Test...": "Prueba ampliada...",
      "UDP blocked": "UDP bloqueado",
      "Hidden": "Oculto",
      "Open — no NAT": "Abierto — sin NAT",
      "Symmetric (multi-WAN)": "Simétrico (multi-WAN)",
      "Symmetric NAT": "NAT simétrico",
      "Cone NAT": "NAT de cono",
      "down": "caído",
      "no connection": "sin conexión",
      "as expected": "como se espera",
      "names the site, 14+ days left": "nombra el sitio, quedan 14+ días",
      "Last certificate seen; now failing:": "Último certificado visto; ahora falla:",
      "Software": "Por software",
      "Integrated": "Integrada",
      "Discrete": "Dedicada",
    },
    "pt-BR": {
      "Sys. Status": "Status do sist.",
      "Last Check": "Última verificação",
      "Reachability": "Conectividade",
      "Network": "Rede",
      "Paths": "Rotas",
      "Ping": "Ping",
      "Jitter": "Flutuação",
      "Conn": "Conexão",
      "Speed": "Velocidade",
      "Hardware": "Hardware",
      "Screen": "Tela",
      "Battery": "Bateria",
      "System": "Sistema",
      "Client": "Cliente",
      "Certificate": "Certificado",
      "Issuer": "Emissor",
      "Valid until": "Válido até",
      "Fleet": "Todos os sites",
      "If your padlock shows a different issuer or fingerprint, your antivirus or network is inspecting HTTPS on this device.": "Se o seu cadeado mostra outro emissor ou outra impressão digital, seu antivírus ou sua rede está inspecionando o HTTPS neste dispositivo.",
      "Retry": "Tentar novamente",
      "Export": "Exportar",
      "Complete test": "Teste completo",
      "Blocked or unreachable": "Bloqueado ou inacessível",
      "mDNS masked": "Oculto por mDNS",
      "Logical Cores": "núcleos lógicos",
      "Unknown (Masked)": "Desconhecido (oculto)",
      "Masked": "Oculto",
      "Charging": "Carregando",
      "On battery": "Na bateria",
      "N/A": "N/D",
      "Unknown": "Desconhecido",
      "Unknown GPU": "GPU desconhecida",
      "Error": "Erro",
      "Testing...": "Testando...",
      "Timeout": "Tempo esgotado",
      "Boost Test...": "Teste ampliado...",
      "UDP blocked": "UDP bloqueado",
      "Hidden": "Oculto",
      "Open — no NAT": "Aberto — sem NAT",
      "Symmetric (multi-WAN)": "Simétrico (multi-WAN)",
      "Symmetric NAT": "NAT simétrico",
      "Cone NAT": "NAT cone",
      "down": "fora do ar",
      "no connection": "sem conexão",
      "as expected": "conforme o esperado",
      "names the site, 14+ days left": "nomeia o site, restam 14+ dias",
      "Last certificate seen; now failing:": "Último certificado visto; agora falha:",
      "Software": "Por software",
      "Integrated": "Integrada",
      "Discrete": "Dedicada",
    },
    "ja": {
      "Sys. Status": "システム状態",
      "Last Check": "最終チェック",
      "Reachability": "到達性",
      "Network": "ネットワーク",
      "Paths": "経路",
      "Ping": "Ping",
      "Jitter": "ジッター",
      "Conn": "接続",
      "Speed": "速度",
      "Hardware": "ハードウェア",
      "Screen": "画面",
      "Battery": "バッテリー",
      "System": "システム",
      "Client": "クライアント",
      "Certificate": "証明書",
      "Issuer": "発行者",
      "Valid until": "有効期限",
      "Fleet": "全サイト",
      "If your padlock shows a different issuer or fingerprint, your antivirus or network is inspecting HTTPS on this device.": "鍵マークに別の発行者やフィンガープリントが表示される場合は、このPCのウイルス対策ソフトかネットワークがHTTPSを検査しています。",
      "Retry": "再試行",
      "Export": "エクスポート",
      "Complete test": "完全テスト",
      "Blocked or unreachable": "ブロックまたは到達不可",
      "mDNS masked": "mDNSでマスク済み",
      "Logical Cores": "論理コア",
      "Unknown (Masked)": "不明（マスク済み）",
      "Masked": "マスク済み",
      "Charging": "充電中",
      "On battery": "バッテリー駆動",
      "N/A": "該当なし",
      "Unknown": "不明",
      "Unknown GPU": "GPU不明",
      "Error": "エラー",
      "Testing...": "テスト中...",
      "Timeout": "タイムアウト",
      "Boost Test...": "追加テスト中...",
      "UDP blocked": "UDPブロック",
      "Hidden": "非公開",
      "Open — no NAT": "オープン — NATなし",
      "Symmetric (multi-WAN)": "対称型 (multi-WAN)",
      "Symmetric NAT": "対称型NAT",
      "Cone NAT": "コーン型NAT",
      "down": "停止",
      "no connection": "接続なし",
      "as expected": "想定どおり",
      "names the site, 14+ days left": "サイト名が一致、残り14日以上",
      "Last certificate seen; now failing:": "最後に確認した証明書。現在は失敗:",
      "Software": "ソフトウェア",
      "Integrated": "内蔵",
      "Discrete": "専用",
    },
    "ru": {
      "Sys. Status": "Статус сист.",
      "Last Check": "Последняя проверка",
      "Reachability": "Доступность",
      "Network": "Сеть",
      "Paths": "Маршруты",
      "Ping": "Пинг",
      "Jitter": "Джиттер",
      "Conn": "Связь",
      "Speed": "Скорость",
      "Hardware": "Оборудование",
      "Screen": "Экран",
      "Battery": "Батарея",
      "System": "Система",
      "Client": "Клиент",
      "Certificate": "Сертификат",
      "Issuer": "Издатель",
      "Valid until": "Действителен до",
      "Fleet": "Все сайты",
      "If your padlock shows a different issuer or fingerprint, your antivirus or network is inspecting HTTPS on this device.": "Если замок в браузере показывает другого издателя или отпечаток, ваш антивирус или сеть проверяет HTTPS на этом устройстве.",
      "Retry": "Повторить",
      "Export": "Экспорт",
      "Complete test": "Полный тест",
      "Blocked or unreachable": "Заблокировано или недоступно",
      "mDNS masked": "Скрыто mDNS",
      "Logical Cores": "логических ядер",
      "Unknown (Masked)": "Неизвестно (скрыто)",
      "Masked": "Скрыто",
      "Charging": "Заряжается",
      "On battery": "От батареи",
      "N/A": "Н/Д",
      "Unknown": "Неизвестно",
      "Unknown GPU": "Неизвестный GPU",
      "Error": "Ошибка",
      "Testing...": "Проверка...",
      "Timeout": "Таймаут",
      "Boost Test...": "Расширенный тест...",
      "UDP blocked": "UDP заблокирован",
      "Hidden": "Скрыто",
      "Open — no NAT": "Открыт — без NAT",
      "Symmetric (multi-WAN)": "Симметричный (multi-WAN)",
      "Symmetric NAT": "Симметричный NAT",
      "Cone NAT": "Конусный NAT",
      "down": "недоступен",
      "no connection": "нет соединения",
      "as expected": "как ожидается",
      "names the site, 14+ days left": "сайт указан, осталось 14+ дней",
      "Last certificate seen; now failing:": "Последний увиденный сертификат; сейчас ошибка:",
      "Software": "Программная",
      "Integrated": "Встроенная",
      "Discrete": "Дискретная",
    },
  };

  function langNow() {
    const l = String((window.CarinoLang && window.CarinoLang.current) || document.documentElement.lang || 'en');
    return /^pt/i.test(l) ? 'pt-BR' : l.slice(0, 2).toLowerCase();
  }
  function tr(s) {
    if (typeof window.t === 'function') {
      try { const v = window.t(s); if (typeof v === 'string' && v && v !== s) return v; } catch (e) { /* not i18n */ }
    }
    const d = L10N[langNow()];
    return (d && d[s]) || s;
  }

  const SVG = (p) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + p + '</svg>';
  const RETRY = SVG('<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>');
  const EXPORT = SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>');
  const PULSE = SVG('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>');

  // Rows: k = a label to translate, n = a name kept as it is.
  const row = (lbl, id, opts) => {
    const o = opts || {};
    const l = o.n ? '<span class="d-lbl">' + lbl + '</span>' : '<span class="d-lbl" data-cn-key="' + lbl + '"></span>';
    const v = '<span class="d-val' + (o.trunc ? ' d-trunc' : '') + '" id="' + id + '">--</span>';
    return '<div class="d-row"' + (o.cert ? ' data-cert hidden' : '') + '>' + l
      + (o.dot ? '<div class="d-grp">' + v + '<span class="dot" id="' + o.dot + '"></span></div>' : v) + '</div>';
  };
  const pair = (a, b) => '<div class="d-pair">' + a + b + '</div>';
  const sec = (key, extra) => '<div class="d-sec"><span data-cn-key="' + key + '"></span>' + (extra || '') + '</div>';

  const BOX = ''
    + '<div class="d-row d-head"><span class="d-lbl" data-cn-key="Last Check"></span>'
    + '<span class="d-val" id="cnDiagLast" style="color:' + A + '">--:--</span></div>'
    + sec('Reachability', '<span class="d-count" id="cnDiagReachCount">--</span>')
    + '<div class="r-grid" id="cnDiagReach"></div>'
    + sec('Network')
    + row('IPv4', 'cnDiagV4', { n: 1, dot: 'cnDiagDot4' })
    + row('IPv6', 'cnDiagV6', { n: 1, dot: 'cnDiagDot6', trunc: 1 })
    + row('LAN', 'cnDiagLan', { n: 1, dot: 'cnDiagDotLan', trunc: 1 })
    + row('NAT', 'cnDiagNat', { n: 1, dot: 'cnDiagDotNat', trunc: 1 })
    + row('Paths', 'cnDiagPaths', { dot: 'cnDiagDotPaths', trunc: 1 })
    + row('ISP', 'cnDiagISP', { n: 1, dot: 'cnDiagDotISP', trunc: 1 })
    + pair(row('Ping', 'cnDiagPing'), row('Jitter', 'cnDiagJitter'))
    + pair(row('Conn', 'cnDiagConn'), row('Speed', 'cnDiagSpeed'))
    + sec('Hardware')
    + pair(row('CPU', 'cnDiagCPU', { n: 1 }), row('RAM', 'cnDiagRAM', { n: 1 }))
    + row('GPU', 'cnDiagGPU', { n: 1, trunc: 1 })
    + row('Screen', 'cnDiagScreen')
    + row('Battery', 'cnDiagBattery')
    + sec('System')
    + row('Client', 'cnDiagClient', { trunc: 1 })
    + pair(row('UTC', 'cnDiagUTC', { n: 1 }), row('Epoch', 'cnDiagEpoch', { n: 1 }))
    // Filled from carino.systems/certs.json (baseline/certwatch.py) for this
    // site; hidden when the file cannot be read or does not list it.
    + '<div class="d-sec" data-cert hidden><span data-cn-key="Certificate"></span></div>'
    + row('Issuer', 'cnDiagCertIssuer', { cert: 1, trunc: 1 })
    + row('Valid until', 'cnDiagCertUntil', { cert: 1 })
    + row('SHA-256', 'cnDiagCertSha', { n: 1, cert: 1 })
    + row('Fleet', 'cnDiagCertFleet', { cert: 1, trunc: 1, dot: 'cnDiagDotCert' })
    + '<p class="d-note" data-cert hidden data-cn-key="If your padlock shows a different issuer or fingerprint, your antivirus or network is inspecting HTTPS on this device."></p>'
    + '<div class="d-actions">'
    + '<button type="button" class="d-btn" id="cnDiagRetry">' + RETRY + '<span data-cn-key="Retry"></span></button>'
    + '<button type="button" class="d-btn" id="cnDiagExport">' + EXPORT + '<span data-cn-key="Export"></span></button>'
    + '</div>'
    + '<a class="d-btn d-test" href="https://test.carino.systems" target="_blank" rel="noopener">' + PULSE + '<span data-cn-key="Complete test"></span></a>';

  const $ = (id) => document.getElementById(id);
  const pad2 = (n) => String(n).padStart(2, '0');
  // A value: written as it is.
  function set(id, v, title) {
    const el = $(id);
    if (!el) return;
    el.textContent = v; el.removeAttribute('data-cn-key');
    if (title != null) el.title = title;
  }
  // A status word rather than a value: kept as its English key so a
  // language switch can translate it again.
  function say(id, key, title) {
    const el = $(id);
    if (!el) return;
    el.textContent = tr(key); el.setAttribute('data-cn-key', key);
    if (title != null) el.title = title;
  }
  function dot(id, cls) { const el = $(id); if (el) el.className = 'dot' + (cls ? ' ' + cls : ''); }

  function relabel() {
    const btn = $('cnDiagBtn');
    if (btn) {
      const l = btn.querySelector('.lbl');
      if (l) l.textContent = tr('Sys. Status');
      btn.title = tr('Sys. Status');
    }
    document.querySelectorAll('#cnDiagBox [data-cn-key]').forEach((el) => { el.textContent = tr(el.getAttribute('data-cn-key')); });
  }

  function stampLastCheck() {
    const n = new Date();
    set('cnDiagLast', pad2(n.getHours()) + ':' + pad2(n.getMinutes()) + ':' + pad2(n.getSeconds()));
  }

  // Several rows are backed by APIs only Chromium ships (deviceMemory,
  // getBattery, connection). Where the API is ABSENT the row is hidden: "N/A"
  // would read like a privacy switch the visitor could flip. A row whose API
  // exists but answered nothing still prints its value.
  function hideRow(id) {
    const el = $(id);
    const r = el && el.closest('.d-row');
    if (!r) return;
    r.style.display = 'none';
    r.classList.add('d-hidden');   // read back by the PNG export
    const p = r.parentElement;
    if (!p || !p.classList.contains('d-pair')) return;
    const alive = [...p.children].filter((c) => !c.classList.contains('d-hidden'));
    if (!alive.length) p.style.display = 'none';
    else if (alive.length === 1) alive[0].style.flex = '1 1 100%';
  }

  /* ---- system & hardware (local: nothing leaves the page) ---- */

  let clockTimer = null;
  function tickClock() {
    const now = new Date();
    set('cnDiagUTC', now.toISOString().substring(11, 19) + 'Z');
    set('cnDiagEpoch', String(Math.floor(now.getTime() / 1000)));
  }

  // Resolved once: a fresh WebGL context per pass would run into the
  // engine's live-context cap. undefined = not probed, null = no WebGL.
  let gpuInfo;
  let battBound = false;

  async function detectSystem() {
    const ua = navigator.userAgent;
    let os = 'Unknown', browser = 'Browser', ver = '', arch = '';
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Linux')) {
      os = ['Fedora', 'Ubuntu', 'Debian', 'Arch', 'Gentoo', 'NixOS'].find((d) => ua.includes(d)) || 'Linux';
    }
    const m = (re) => { const x = ua.match(re); return x ? x[1] : ''; };
    let brave = false;
    try { brave = !!(navigator.brave && await navigator.brave.isBrave()); } catch (e) { /* not Brave */ }
    if (brave) { browser = 'Brave'; ver = m(/Chrome\/(\d+\.\d+)/); }
    else if (ua.includes('CriOS')) { browser = 'Chrome iOS'; ver = m(/CriOS\/(\d+\.\d+)/); }
    else if (ua.includes('FxiOS')) { browser = 'Firefox iOS'; ver = m(/FxiOS\/(\d+\.\d+)/); }
    else if (ua.includes('Edg')) { browser = 'Edge'; ver = m(/Edg\/(\d+\.\d+)/); }
    else if (ua.includes('Chrome') && !ua.includes('Chromium')) { browser = 'Chrome'; ver = m(/Chrome\/(\d+\.\d+)/); }
    else if (ua.includes('Chromium')) { browser = 'Chromium'; ver = m(/Chromium\/(\d+\.\d+)/); }
    else if (ua.includes('Firefox')) { browser = 'Firefox'; ver = m(/Firefox\/(\d+\.\d+)/); }
    else if (ua.includes('Safari')) { browser = 'Safari'; ver = m(/Version\/(\d+\.\d+)/); }
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        const d = await navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness']);
        if (d.architecture) arch = d.architecture;
        if (d.bitness) arch += ' ' + d.bitness + '-bit';
      } catch (e) { /* refused */ }
    } else if (/WOW64|Win64|x86_64/.test(ua)) arch = 'x64';
    else if (ua.includes('arm')) arch = 'arm';
    set('cnDiagClient', browser + (ver ? ' v' + ver : '') + ' on ' + os + (arch.trim() ? ' [' + arch.trim() + ']' : ''));

    const cores = navigator.hardwareConcurrency;
    set('cnDiagCPU', cores ? cores + ' ' + tr('Logical Cores') : tr('Unknown (Masked)'));
    if (!('deviceMemory' in navigator)) hideRow('cnDiagRAM');
    else if (navigator.deviceMemory) set('cnDiagRAM', '~' + navigator.deviceMemory + ' GB');
    else say('cnDiagRAM', 'Masked');

    set('cnDiagScreen', screen.width + 'x' + screen.height + ' (' + (window.devicePixelRatio || 1).toFixed(1) + 'x)');

    if ('getBattery' in navigator) {
      try {
        const b = await navigator.getBattery();
        const fmt = () => set('cnDiagBattery', Math.round(b.level * 100) + '% — ' + tr(b.charging ? 'Charging' : 'On battery'));
        fmt();
        if (!battBound) { battBound = true; b.addEventListener('levelchange', fmt); b.addEventListener('chargingchange', fmt); }
      } catch (e) { say('cnDiagBattery', 'N/A'); }
    } else hideRow('cnDiagBattery');

    const c = navigator.connection;
    if (c) {
      const type = (c.type && c.type !== 'unknown') ? c.type : (c.effectiveType || null);
      if (type) set('cnDiagConn', String(type).toUpperCase()); else say('cnDiagConn', 'Unknown');
    } else hideRow('cnDiagConn');

    paintGPU();
  }

  function probeGPU() {
    const canvas = document.createElement('canvas');
    const opts = { powerPreference: 'low-power' };   // never wake a discrete GPU to read a name
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || null;
    if (!gl) return null;
    try {
      let vendor = '', renderer = '';
      // Gecko deprecated the debug extension and its RENDERER names the GPU already.
      const dbg = /\bFirefox\//.test(navigator.userAgent) ? null : gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) { vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || ''; renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || ''; }
      const raw = renderer || gl.getParameter(gl.RENDERER) || 'Unknown';
      const rawVendor = vendor || gl.getParameter(gl.VENDOR) || '';
      let name = raw, backend = '';
      const angle = raw.match(/^ANGLE\s*\((.+)\)\s*$/);
      if (angle) {
        const parts = angle[1].split(/,\s*/g).map((p) => p.trim()).filter(Boolean);
        name = (parts[1] || parts[0] || raw).replace(/\s(vs|ps|gs|ds|es|cs)_\d_\d/gi, '').trim();
        backend = parts.slice(2).length ? 'ANGLE (' + parts.slice(2).join(', ') + ')' : 'ANGLE';
      } else if (/swiftshader/i.test(raw)) backend = 'Software rasterizer';
      let out = '', depth = 0;
      for (const ch of name) { if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1); else if (!depth) out += ch; }
      name = out.replace(/\/PCIe\/SSE2/gi, '').replace(/\s+/g, ' ').trim();
      const s = (rawVendor + ' ' + raw).toLowerCase();
      const type = /swiftshader|llvmpipe|soft/.test(s) ? 'Software'
        : /intel|uhd|iris|apple|\bm[123]\b|adreno|mali|powervr|radeon graphics/.test(s) ? 'Integrated'
        : /nvidia|geforce|quadro|rtx|gtx|amd|radeon|rx |vega|arc /.test(s) ? 'Discrete' : 'Unknown';
      const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return { name, type, backend, maxTex, title: [rawVendor && 'Vendor: ' + rawVendor, 'Renderer: ' + raw].filter(Boolean).join('\n') };
    } catch (e) { return { error: true }; }
  }
  function paintGPU() {
    if (gpuInfo === undefined) gpuInfo = probeGPU();
    const el = $('cnDiagGPU');
    if (!el) return;
    if (gpuInfo === null) { hideRow('cnDiagGPU'); return; }
    if (gpuInfo.error) { say('cnDiagGPU', 'Error'); return; }
    el.textContent = ''; el.removeAttribute('data-cn-key'); el.title = gpuInfo.title;
    const main = document.createElement('span'); main.textContent = gpuInfo.name || tr('Unknown GPU');
    const sub = document.createElement('span');
    sub.textContent = ['[' + tr(gpuInfo.type) + ']', gpuInfo.backend, 'Tex: ' + gpuInfo.maxTex].filter(Boolean).join(' | ');
    sub.style.cssText = 'font-size:.75em;opacity:.7;margin-top:2px;';
    el.append(main, sub);
  }

  /* ---- network ---- */

  function fetchWith(url, timeoutMs, read, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 4000);
    return fetch(url, Object.assign({ mode: 'cors', signal: ctrl.signal, cache: 'no-store' }, init || {}))
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return read(res); })
      .finally(() => clearTimeout(t));
  }
  const fetchJSON = (url, ms, init) => fetchWith(url, ms, (r) => r.json(), init);
  // Some providers answer in plain text: an address is a string.
  const fetchText = (url, ms) => fetchWith(url, ms, (r) => r.text()).then((s) => {
    const v = String(s).trim();
    if (!v) throw new Error('empty body');
    return v;
  });
  // Cloudflare's trace endpoint: `key=value` lines.
  const fetchTrace = (url, key) => fetchText(url).then((body) => {
    const line = body.split('\n').find((l) => l.indexOf(key + '=') === 0);
    if (!line) throw new Error('no ' + key);
    return line.slice(key.length + 1).trim();
  });
  // Walk a provider list in order, resolving on the first that answers.
  const tryProviders = (list) => list.reduce((chain, next) => chain.catch(next), Promise.reject(new Error('none')));

  // An address service on the visitor's own network, when the page names one.
  const WHOAMI = (() => {
    const s = document.currentScript || document.querySelector('script[src*="carino-diag.js"]');
    return (s && s.getAttribute('data-whoami')) || null;
  })();

  function detectIPs() {
    set('cnDiagV4', '...'); set('cnDiagV6', '...');
    dot('cnDiagDot4', 'scan'); dot('cnDiagDot6', 'scan');
    // Each provider is held to the family asked for: one that answers over
    // the other family is skipped rather than ending the chain. The last of
    // each is Cloudflare's trace by IP literal, which needs no DNS at all.
    const only = (want, get) => () => get().then((ip) => {
      const v = String(ip);
      if ((want === 6) !== v.includes(':')) throw new Error('wrong family: ' + v);
      return v;
    });
    const whoami = (want) => (WHOAMI ? [only(want, () => fetchText(WHOAMI))] : []);
    const v4 = tryProviders(whoami(4).concat([
      only(4, () => fetchJSON('https://api4.ipify.org?format=json').then((d) => d.ip)),
      only(4, () => fetchText('https://ipv4.icanhazip.com')),
      only(4, () => fetchText('https://4.ident.me')),
      only(4, () => fetchTrace('https://1.1.1.1/cdn-cgi/trace', 'ip'))
    ]));
    const v6 = tryProviders(whoami(6).concat([
      only(6, () => fetchJSON('https://api6.ipify.org?format=json').then((d) => d.ip)),
      only(6, () => fetchText('https://ipv6.icanhazip.com')),
      only(6, () => fetchText('https://6.ident.me'))
    ]));
    // A failed probe is a failed probe: a blocker, a captive portal and a dead
    // provider look the same from here, so one wording and a neutral dot.
    return Promise.allSettled([v4, v6]).then(([a, b]) => {
      if (a.status === 'fulfilled' && a.value.includes('.')) { set('cnDiagV4', a.value); dot('cnDiagDot4', 'ok'); }
      else { say('cnDiagV4', 'Blocked or unreachable'); dot('cnDiagDot4', ''); }
      if (b.status === 'fulfilled' && b.value.includes(':')) { set('cnDiagV6', b.value); dot('cnDiagDot6', 'ok'); }
      else { say('cnDiagV6', 'Blocked or unreachable'); dot('cnDiagDot6', ''); }
    });
  }

  // Three providers, each asked only for the operator's name; an empty name
  // is a failed lookup and moves the chain on.
  function detectISP() {
    set('cnDiagISP', '...'); dot('cnDiagDotISP', 'scan');
    return tryProviders([
      () => fetchJSON('https://ipwho.is/?fields=ip,connection', 5000).then((d) => (d && d.connection && (d.connection.isp || d.connection.org)) || ''),
      () => fetchJSON('https://ipinfo.io/json', 5000).then((d) => d.org || ''),
      () => fetchJSON('https://ipapi.co/json/', 5000).then((d) => d.org || '')
    ].map((get) => () => get().then((org) => {
      const name = String(org).replace(/^AS\d+\s+/i, '').trim();
      if (!name) throw new Error('no org');
      return name;
    }))).then((name) => { set('cnDiagISP', name, name); dot('cnDiagDotISP', 'ok'); })
      .catch(() => { say('cnDiagISP', 'Blocked or unreachable'); dot('cnDiagDotISP', ''); });
  }

  // A browser cannot ICMP-ping, so HEAD requests to this same page are timed:
  // the first pays for the connection and is dropped; ping is the median of
  // the rest, jitter the mean step between consecutive ones (RFC 3550).
  async function checkPing() {
    say('cnDiagPing', 'Testing...'); set('cnDiagJitter', '...');
    const base = location.origin + location.pathname;
    const samples = [];
    for (let i = 0; i < 6; i++) {
      const start = performance.now();
      try { await fetch(base + '?_p=' + start, { method: 'HEAD', cache: 'no-store' }); samples.push(performance.now() - start); }
      catch (e) { /* a dropped sample */ }
    }
    const got = samples.slice(1);
    if (!got.length) { say('cnDiagPing', 'Timeout'); set('cnDiagJitter', '--'); return; }
    const s = [...got].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
    const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    set('cnDiagPing', Math.round(median) + ' ms', 'Median of ' + got.length + ' HTTP HEAD round trips (warm-up discarded).\nSamples: ' + got.map(Math.round).join(', ') + ' ms');
    if (got.length < 2) { set('cnDiagJitter', '--'); return; }
    let sum = 0;
    for (let i = 1; i < got.length; i++) sum += Math.abs(got[i] - got[i - 1]);
    const j = sum / (got.length - 1);
    set('cnDiagJitter', (j < 10 ? j.toFixed(1) : Math.round(j)) + ' ms', 'Mean deviation between consecutive round trips (RFC 3550 IPDV).');
  }

  // The hub's speed files: 1 MB, then 25 MB when the first took under half a second.
  const SPEED_SMALL = 'https://raw.githubusercontent.com/MiguelCarino/Carino-Systems/refs/heads/main/assets/files/sample_1mb';
  const SPEED_LARGE = 'https://raw.githubusercontent.com/MiguelCarino/Carino-Systems/refs/heads/main/assets/files/sample_25mb';
  async function download(url) {
    const start = performance.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    return { s: (performance.now() - start) / 1000, bytes: blob.size };
  }
  async function runSpeedTest() {
    say('cnDiagSpeed', 'Testing...');
    try {
      let r = await download(SPEED_SMALL);
      if (r.s < 0.5) { say('cnDiagSpeed', 'Boost Test...'); r = await download(SPEED_LARGE); }
      if (r.s <= 0) throw new Error('instant');
      const bps = r.bytes * 8 / r.s;
      set('cnDiagSpeed', bps >= 1e6 ? (bps / 1e6).toFixed(1) + ' Mbps' : bps >= 1e3 ? Math.round(bps / 1e3) + ' Kbps' : Math.round(bps) + ' bps');
    } catch (e) {
      const c = navigator.connection;
      if (c && c.downlink) set('cnDiagSpeed', '~' + c.downlink + ' Mbps (Est)'); else say('cnDiagSpeed', 'Error');
    }
  }

  // WebRTC ICE candidates are the one window into the network's shape: host
  // candidates are local interfaces (usually masked as <uuid>.local), srflx
  // ones the public ip:port two STUN servers see, which tells cone from
  // symmetric NAT.
  const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
  function probeWebRTC(timeoutMs) {
    return new Promise((resolve) => {
      const locals = new Set(), mdns = new Set(), publics = new Set(), ports = new Set();
      let pc, done = false;
      const finish = () => {
        if (done) return; done = true;
        try { if (pc) pc.close(); } catch (e) { /* closed */ }
        resolve({ locals: [...locals], mdns: mdns.size, ifaces: locals.size + mdns.size, publics: [...publics], ports: [...ports] });
      };
      try { pc = new RTCPeerConnection({ iceServers: STUN.map((urls) => ({ urls })) }); } catch (e) { finish(); return; }
      try { pc.createDataChannel('probe'); } catch (e) { /* no data channels */ }
      pc.onicecandidate = (e) => {
        if (!e || !e.candidate) { finish(); return; }
        const parts = (e.candidate.candidate || '').split(' ');
        const addr = parts[4] || '', port = +parts[5] || 0, ti = parts.indexOf('typ'), typ = ti >= 0 ? parts[ti + 1] : '';
        if (/\.local$/i.test(addr)) { mdns.add(addr.toLowerCase()); return; }
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) return;
        if (typ === 'host') locals.add(addr);
        else if (typ === 'srflx' || typ === 'prflx') { publics.add(addr); if (port) ports.add(port); }
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(finish);
      setTimeout(finish, timeoutMs || 2500);
    });
  }
  async function detectLAN() {
    const r = await probeWebRTC();
    const lan = r.locals.find(isPrivate) || r.locals[0] || null;
    if (lan) { set('cnDiagLan', r.locals.length > 1 ? lan + ' +' + (r.locals.length - 1) : lan, r.locals.join(', ')); dot('cnDiagDotLan', 'ok'); }
    else { say('cnDiagLan', 'mDNS masked', 'Browsers hide the LAN IP behind a random .local mDNS name for privacy.'); dot('cnDiagDotLan', ''); }

    let key, ok = true;
    if (!r.publics.length) { key = r.ifaces ? 'UDP blocked' : 'Hidden'; ok = false; }
    else if (r.locals.some((ip) => !isPrivate(ip) && r.publics.includes(ip))) key = 'Open — no NAT';
    else if (r.publics.length > 1) key = 'Symmetric (multi-WAN)';
    else if (r.ports.length > 1) key = 'Symmetric NAT';
    else key = 'Cone NAT';
    const wanText = ($('cnDiagV4') || {}).textContent || '';
    const wan = /^\d{1,3}(\.\d{1,3}){3}$/.test(wanText.trim()) ? wanText.trim() : null;
    const pub = r.publics[0] || null;
    if (pub && wan && pub !== wan) {
      set('cnDiagNat', tr(key) + ' ⚠', 'WebRTC exposes ' + pub + ', but the WAN address is ' + wan + ' — VPN/proxy split-tunnel or a WebRTC leak.');
      dot('cnDiagDotNat', 'bad');
    } else {
      say('cnDiagNat', key, pub ? 'Public via WebRTC: ' + pub + (wan ? ' — matches WAN' : '') : 'No STUN reflexive candidate — UDP is blocked or WebRTC is restricted by the browser.');
      dot('cnDiagDotNat', ok ? 'ok' : '');
    }
    const n = r.ifaces;
    const desc = [r.locals.length && r.locals.length + ' numeric', r.mdns && r.mdns + ' masked'].filter(Boolean).join(' + ');
    set('cnDiagPaths', n ? n + ' iface' + (n > 1 ? 's' : '') : '—',
      n ? n + ' local interface path(s) seen by WebRTC' + (desc ? ' (' + desc + ')' : '') + '. More than one usually means a VPN/virtual adapter or multi-homing.' : 'No interface candidates surfaced.');
    dot('cnDiagDotPaths', n ? 'ok' : '');
  }

  async function runNetwork() {
    await Promise.all([detectIPs(), detectISP()]);
    await detectLAN();        // after the IPs, for the WebRTC-vs-WAN check
    await checkPing();
    await runSpeedTest();
    stampLastCheck();
  }

  /* ---- reachability: the hub's fifteen ----
     The four resolvers are raw IPs and answer even with DNS broken; the
     clouds and regional flagships are the usual casualties of filters,
     censorship and VPN geo-fencing; carino.systems is our own. A no-cors
     fetch resolves when the host answers and rejects otherwise: up/down and
     latency, never the status. Hostnames are also resolved over DNS-over-
     HTTPS, so a missing address flags DNS apart from reachability. */
  const REACH = [
    { name: 'Cloudflare DNS', host: '1.1.1.1', ip: '1.1.1.1' },
    { name: 'Google DNS', host: '8.8.8.8', ip: '8.8.8.8' },
    { name: 'Quad9 DNS', host: '9.9.9.9', ip: '9.9.9.9' },
    { name: 'OpenDNS', host: '208.67.222.222', ip: '208.67.222.222' },
    { name: 'Google', host: 'google.com' },
    { name: 'Cloudflare', host: 'cloudflare.com' },
    { name: 'AWS Cloud', host: 'aws.amazon.com' },
    { name: 'Azure Cloud', host: 'azure.microsoft.com' },
    { name: 'Baidu', host: 'baidu.com' },
    { name: 'Yandex', host: 'yandex.com' },
    { name: 'Yahoo Japan', host: 'yahoo.co.jp' },
    { name: 'Wikipedia', host: 'wikipedia.org' },
    { name: 'Mercado Libre', host: 'mercadolibre.com.mx' },
    { name: 'GitHub', host: 'github.com' },
    { name: 'Carino.systems', host: 'carino.systems' }
  ];
  const SLOW_MS = 500;   // above this a reachable target's dot goes white
  let reachAt = 0;

  async function resolveIP(host) {
    for (const url of ['https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(host) + '&type=A',
                       'https://dns.google/resolve?name=' + encodeURIComponent(host) + '&type=A']) {
      try {
        const j = await fetchJSON(url, 5000, { headers: { accept: 'application/dns-json' } });
        const a = (j && j.Answer || []).find((x) => x.type === 1);
        if (a) return a.data;
      } catch (e) { /* the next resolver */ }
    }
    return null;
  }
  async function probeHost(host) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const start = performance.now();
    try {
      await fetch('https://' + host + '/favicon.ico', { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      return Math.round(performance.now() - start);
    } finally { clearTimeout(t); }
  }
  function buildReach() {
    const list = $('cnDiagReach');
    if (!list || list.childElementCount) return;
    REACH.forEach((tgt, i) => {
      const cell = document.createElement('div');
      cell.className = 'r-cell'; cell.id = 'cnDiagR' + i; cell.title = tgt.name;
      cell.innerHTML = '<span class="dot"></span><span class="lbl"></span><span class="ms">—</span><span class="ip">—</span>';
      cell.querySelector('.lbl').textContent = tgt.name;
      list.appendChild(cell);
    });
  }
  async function checkReach(force) {
    if (!force && Date.now() - reachAt < 60000) return;
    reachAt = Date.now();
    buildReach();
    const count = $('cnDiagReachCount');
    let up = 0, done = 0;
    if (count) count.textContent = '0/' + REACH.length;
    await Promise.all(REACH.map(async (tgt, i) => {
      const cell = $('cnDiagR' + i);
      if (!cell) return;
      const d = cell.querySelector('.dot'), ms = cell.querySelector('.ms'), ip = cell.querySelector('.ip');
      d.className = 'dot scan'; ms.textContent = '...'; ip.textContent = '…';
      const [ipRes, msRes] = await Promise.allSettled([tgt.ip ? Promise.resolve(tgt.ip) : resolveIP(tgt.host), probeHost(tgt.host)]);
      const ipTxt = ipRes.status === 'fulfilled' && ipRes.value ? ipRes.value : 'no DNS';
      ip.textContent = ipTxt;
      if (msRes.status === 'fulfilled') {
        up++;
        d.className = 'dot ' + (msRes.value > SLOW_MS ? 'slow' : 'ok');
        ms.textContent = msRes.value + ' ms';
      } else {
        d.className = 'dot';   // grey: it did not answer, and we cannot know why
        ms.textContent = tr('down');
      }
      cell.title = tgt.name + ' · ' + ipTxt + ' · ' + (msRes.status === 'fulfilled' ? msRes.value + ' ms' : tr('no connection'));
      done++;
      if (count) count.textContent = done < REACH.length ? up + '/' + done : up + '/' + REACH.length + ' up';
    }));
    stampLastCheck();
  }

  /* ---- certificate ----
     carino.systems/certs.json is written daily by baseline/certwatch.py: what
     each fleet site serves, checked from outside. A page cannot read its own
     connection's certificate, so these rows say what the browser SHOULD see;
     a padlock that disagrees means something re-signed the connection. Read
     once; when it cannot be read or does not list this site, the section
     stays hidden. */
  let certs;
  function paintCerts(data) {
    const all = data && data.domains;
    const me = all && (all[location.hostname] || null);
    if (!me || !me.sha256) return;
    const expected = data.expected_issuer || '';
    const now = Date.now();
    const named = (d, san) => (san || []).some((n) => n === d || (n.startsWith('*.') && n.slice(2) === d.split('.').slice(1).join('.')));
    const names = Object.keys(all);
    const off = names.filter((d) => {
      const c = all[d];
      return c.error || c.issuer_org !== expected || !(Date.parse(c.not_after) - now >= 14 * 864e5) || !named(d, c.san);
    });
    const stale = me.error ? '\n' + tr('Last certificate seen; now failing:') + ' ' + me.error : '';
    set('cnDiagCertIssuer', [me.issuer_org, me.issuer_cn].filter(Boolean).join(' '), (me.subject || location.hostname) + stale);
    set('cnDiagCertUntil', String(me.not_after).slice(0, 10), me.not_after + stale);
    set('cnDiagCertSha', me.sha256.split(':').slice(0, 8).join(':') + '…', me.sha256 + stale);
    set('cnDiagCertFleet', (names.length - off.length) + '/' + names.length + ' ' + tr('as expected'),
      off.length ? off.join('\n') : expected + ', ' + tr('names the site, 14+ days left'));
    dot('cnDiagDotCert', off.length ? 'slow' : 'ok');
    document.querySelectorAll('#cnDiagBox [data-cert]').forEach((el) => { el.hidden = false; });
  }
  function loadCerts() {
    if (!certs) certs = fetchJSON('https://carino.systems/certs.json', 6000).catch(() => { certs = undefined; return null; });
    return certs.then(paintCerts);
  }

  /* ---- export: the panel as a PNG, drawn on a canvas (no libraries) ---- */
  function dotColour(d) {
    if (!d) return null;
    if (d.classList.contains('slow')) return '#ffffff';
    if (d.classList.contains('ok')) return A;
    if (d.classList.contains('bad')) return '#ef4444';
    if (d.classList.contains('scan')) return SEC;
    return '#666666';
  }
  const hidden = (el) => el.classList.contains('d-hidden') || el.hidden || el.style.display === 'none';
  function rowModel(el) {
    const l = el.querySelector('.d-lbl'), v = el.querySelector('.d-val');
    const value = v ? (v.children.length ? [...v.children].map((n) => n.textContent.trim()).filter(Boolean).join(' · ') : v.textContent.trim()) : '';
    return { type: 'row', label: l ? l.textContent.trim() : '', value, dot: dotColour(el.querySelector('.dot')) };
  }
  function model() {
    const out = [];
    const box = $('cnDiagBox');
    if (!box) return out;
    for (const el of box.children) {
      if (hidden(el) || el.classList.contains('d-actions') || el.classList.contains('d-test') || el.classList.contains('d-note')) continue;
      if (el.classList.contains('d-sec')) {
        const spans = el.querySelectorAll(':scope > span');
        out.push({ type: 'section', text: (spans[0] || el).textContent.trim(), extra: spans.length > 1 ? spans[spans.length - 1].textContent.trim() : '' });
      } else if (el.classList.contains('d-row')) out.push(rowModel(el));
      else if (el.classList.contains('d-pair')) { for (const sub of el.children) if (!hidden(sub)) out.push(rowModel(sub)); }
      else if (el.id === 'cnDiagReach') {
        for (const c of el.children) {
          out.push({ type: 'row', label: c.querySelector('.lbl').textContent.trim(),
            value: [c.querySelector('.ip').textContent.trim(), c.querySelector('.ms').textContent.trim()].filter(Boolean).join('  ·  '),
            dot: dotColour(c.querySelector('.dot')) });
        }
      }
    }
    return out;
  }
  // Synchronous from the click to a.click(): WebKit keeps a download only
  // while it is still attached to the gesture.
  function exportImage() {
    const rows = model();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const W = 460, padX = 24, padTop = 24, padBottom = 52, titleH = 44, secH = 26, rowH = 22;
    const h = padTop + titleH + rows.reduce((s, r) => s + (r.type === 'section' ? secH : rowH), 0) + padBottom;
    const cv = document.createElement('canvas');
    cv.width = W * scale; cv.height = h * scale;
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    const mono = "'IBM Plex Mono', ui-monospace, monospace", disp = "'Red Hat Display', 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, h);
    ctx.strokeStyle = 'rgba(234,179,8,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, h - 1);
    ctx.fillStyle = A; ctx.font = '900 20px ' + disp; ctx.fillText('SYSTEM STATUS', padX, padTop + 20);
    ctx.fillStyle = SEC; ctx.font = '11px ' + mono; ctx.textAlign = 'right';
    ctx.fillText(new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC', W - padX, padTop + 19);
    ctx.textAlign = 'left';
    let y = padTop + titleH;
    rows.forEach((r) => {
      if (r.type === 'section') {
        y += 4;
        ctx.strokeStyle = BORDER; ctx.beginPath(); ctx.moveTo(padX, y + secH - 8); ctx.lineTo(W - padX, y + secH - 8); ctx.stroke();
        ctx.fillStyle = '#666666'; ctx.font = '700 10px ' + mono; ctx.fillText(r.text.toUpperCase(), padX, y + 12);
        if (r.extra) { ctx.textAlign = 'right'; ctx.fillStyle = SEC; ctx.fillText(r.extra, W - padX, y + 12); ctx.textAlign = 'left'; }
        y += secH;
        return;
      }
      let vx = W - padX;
      if (r.dot) { ctx.fillStyle = r.dot; ctx.beginPath(); ctx.arc(vx - 3, y + 6, 3, 0, Math.PI * 2); ctx.fill(); vx -= 12; }
      ctx.fillStyle = '#666666'; ctx.font = '11px ' + mono; ctx.fillText(r.label, padX, y + 10);
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; ctx.fillText(r.value, vx, y + 10); ctx.textAlign = 'left';
      y += rowH;
    });
    ctx.textAlign = 'center'; ctx.fillStyle = A; ctx.font = '900 15px ' + disp;
    ctx.fillText(location.hostname || 'carino.systems', W / 2, h - 22);
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'carino-sysstatus-' + Math.floor(Date.now() / 1000) + '.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---- wiring ---- */

  let swept = false;
  function sweep() { swept = true; detectSystem(); runNetwork(); checkReach(true); loadCerts(); }

  function build(nav) {
    if ($('cnDiagBtn')) return;
    const style = document.createElement('style');
    style.id = 'carino-diag-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'cnDiagBtn';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'cnDiagBox');
    btn.innerHTML = '<span class="lbl"></span><span class="cn-pulse"></span>';
    // To the LEFT of the social icons, as on the hub.
    const right = nav.querySelector('.cn-right');
    if (!right) return;
    const social = right.querySelector('.social-row');
    if (social) right.insertBefore(btn, social); else right.appendChild(btn);

    const box = document.createElement('div');
    box.id = 'cnDiagBox';
    box.setAttribute('role', 'region');
    box.innerHTML = BOX;
    document.body.appendChild(box);
    relabel();
    const later = () => setTimeout(() => { relabel(); if (swept) { detectSystem(); if (certs) loadCerts(); } }, 0);
    window.addEventListener('carino:langchange', later);
    document.addEventListener('DOMContentLoaded', later);

    const setOpen = (open) => {
      if (open) {
        // Under the bar, whatever its height on this page.
        const bottom = nav.getBoundingClientRect().bottom;
        if (bottom > 0) box.style.top = Math.round(bottom + 9) + 'px';
      }
      box.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { tickClock(); clockTimer = clockTimer || setInterval(tickClock, 1000); }
      else if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !box.classList.contains('open');
      setOpen(open);
      if (!open) return;
      // Lazy: the first open is what triggers any outbound request; a later
      // one re-checks reachability, at most once a minute.
      if (!swept) sweep(); else checkReach(false);
    });
    $('cnDiagRetry').addEventListener('click', () => { sweep(); });
    $('cnDiagExport').addEventListener('click', exportImage);
    // pointerdown, not click: WebKit does not bubble a click from plain text
    // to the document, so a tap on the page left the panel open there.
    document.addEventListener('pointerdown', (e) => {
      if (!box.classList.contains('open') || box.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !box.classList.contains('open')) return;
      setOpen(false); btn.focus();
    });
  }

  // carino-navbar.js injects #carinoNav on DOMContentLoaded; both scripts are
  // deferred so the order is not guaranteed. Watch for the navbar instead.
  function start() {
    const nav = $('carinoNav');
    if (nav) { build(nav); return; }
    const obs = new MutationObserver(() => { const n = $('carinoNav'); if (n) { obs.disconnect(); build(n); } });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 10000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
