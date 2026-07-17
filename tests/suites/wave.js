window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const media = ['utp','fiber','wireless','powerline','vpn'];
  const nodes = [{ id:'r', type:'router', name:'R', x:400, y:150, interfaces:[{id:'i1',name:'eth0',ip:'10.0.0.1/24'}] }];
  const links = [];
  media.forEach((m,i) => {
    nodes.push({ id:'n'+i, type:'server', name:'N'+i, x:100+i*140, y:400, gw:'10.0.0.1',
      interfaces:[{id:'i1',name:m==='wireless'?'wlan0':'eth0',ip:'10.0.0.'+(10+i)+'/24'}] });
    links.push({ id:'l'+i, source:'r', target:'n'+i, medium:m });
  });
  state.nodes = nodes.map(normalizeLoadedNode); state.links = links.map(normalizeLoadedLink); autoBindLinks();
  state.settings.traceMode = true; select('r','node');

  // Speeds must be unchanged from the previous design.
  const EXPECT = { utp:40, fiber:112.5, vpn:35.556, powerline:22.5 };
  Object.entries(EXPECT).forEach(([m, want]) => {
    const el = document.getElementById('ui-link-' + state.links.find(l=>l.medium===m).id);
    const cs = getComputedStyle(el);
    const off = Math.abs(parseFloat(getComputedStyle(el).getPropertyValue('stroke-dashoffset')) || 0);
    const dur = parseFloat(cs.animationDuration);
    // Read the keyframe target out of the stylesheet rather than trusting the comment.
    let target = 0;
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch(e) { continue; }
      for (const r of rules||[]) if (r.type===CSSRule.KEYFRAMES_RULE && r.name==='flow-'+m)
        for (const k of r.cssRules) if (k.keyText==='to' || k.keyText==='100%') target = Math.abs(parseFloat(k.style.strokeDashoffset));
    }
    const speed = target/dur;
    ok(`${m} speed unchanged (${want} px/s)`, Math.abs(speed-want) < 1.5, `${speed.toFixed(1)} px/s  dash=[${cs.strokeDasharray}] ${dur}s`);
  });

  // Patterns must all differ from each other.
  const dashes = media.filter(m=>m!=='wireless').map(m => getComputedStyle(document.getElementById('ui-link-'+state.links.find(l=>l.medium===m).id)).strokeDasharray);
  ok('cable patterns are all distinct', new Set(dashes).size === dashes.length, dashes.join(' | '));

  // ---- The ))) waves ----
  const wl = state.links.find(l => l.medium === 'wireless');
  const waves = [...document.querySelectorAll('.flow-wave')];
  ok('wireless link emits a wave overlay', waves.length === 1, 'found ' + waves.length);
  const tp = waves[0] && waves[0].querySelector('textPath');
  ok('waves ride the link path', tp && tp.getAttribute('href') === '#ui-link-' + wl.id, tp && tp.getAttribute('href'));
  ok('waves are ) arcs', tp && /^\)/.test(tp.textContent.trim()), JSON.stringify(tp && tp.textContent.slice(0,10)));
  ok('waves actually laid out (non-zero length)', waves[0].getComputedTextLength() > 0, String(waves[0] && waves[0].getComputedTextLength().toFixed(1)));
  ok('wave overlay does not eat clicks', getComputedStyle(waves[0]).pointerEvents === 'none');

  const anim = tp && tp.querySelector('animate');
  ok('waves animate', !!anim, anim && `${anim.getAttribute('from')} -> ${anim.getAttribute('to')} in ${anim.getAttribute('dur')}`);
  ok('wireless keeps its 1.2s cadence', anim && anim.getAttribute('dur') === '1.2s');
  ok('loop starts off-path so there is no bare gap', anim && parseFloat(anim.getAttribute('from')) < 0 && parseFloat(anim.getAttribute('to')) === 0);
  // Seamlessness: the from/to span must equal exactly one glyph repeat.
  const reps = tp.textContent.length / 3;
  const advance = waves[0].getComputedTextLength() / reps;
  ok('loop span equals one repeat (seamless)', Math.abs(Math.abs(parseFloat(anim.getAttribute('from'))) - advance) < 0.01,
     `span=${Math.abs(parseFloat(anim.getAttribute('from'))).toFixed(3)} advance=${advance.toFixed(3)}`);
  // getComputedTextLength() on a textPath is clamped to the path near its end,
  // and engines report that last pixel differently (Chromium lands on the length,
  // Gecko a pixel under). The code already emits ceil(total/advance)+2 repeats, so
  // the arcs genuinely overshoot and clip — allow a 2px metric tolerance so a
  // sub-pixel reporting quirk is not read as a bare tail.
  const linkLen = document.getElementById('ui-link-'+wl.id).getTotalLength();
  ok('waves cover the whole link', reps * advance >= linkLen - 2,
     `covered=${(reps*advance).toFixed(0)}px link=${linkLen.toFixed(0)}px`);

  // SMIL must actually be running, not merely present.
  const t0 = tp.startOffset.animVal.value;
  setTimeout(() => {
    const t1 = tp.startOffset.animVal.value;
    ok('SMIL is really animating (startOffset moves)', t0 !== t1, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
    // Non-wireless media must not get an overlay.
    ok('only wireless gets waves', document.querySelectorAll('.flow-wave').length === 1);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }, 300);
}, 400); });
