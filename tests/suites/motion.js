// Motion (js/motion.js) and the samples that show groups (js/data.js).
// What is held here:
//   1. in the test runner there is no motion unless asked for (its probe
//      sets window.TOPO_MOTION = false): a collapse leaves no ghost and
//      starts nothing;
//   2. asked for, a collapse flies a copy of each device drawn into the
//      group and grows the group's node in; the copies are gone once played;
//      the devices' own transform attributes and the saved document are
//      what they would be without motion, and an SVG export taken mid-flight
//      holds no copy;
//   3. an expand spreads the devices out of the node, whose copy swells and
//      goes; a Tidy and its undo glide the devices; the rack view slides a
//      box that moved and fades its cables back in;
//   4. TOPO_MOTION = false turns it off again;
//   5. the samples: Data Centre has a building, a hall, two racks with every
//      device placed and VMs on their hosts; Imaging Centre, Call Centre and
//      Smart Home are filed by room; the Showcase files its tower by floor
//      and room with three racks, a container inside a VM and the branch and
//      home apart; none of them raises a group, rack or host finding, and a
//      half-depth device ships half depth.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The runner's clock is virtual and paints no frames, so an animation
  // never reaches its end by waiting: each is finished here, which runs its
  // onfinish (a ghost removing itself) as the end of a real one would.
  const played = async () => { document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* infinite */ } }); await wait(30); };
  const ghosts = () => document.querySelectorAll('.motion-ghost').length;
  const animsOn = (el) => (el && el.getAnimations ? el.getAnimations().length : 0);
  const open = (key) => { replaceDocument(templatesData[key], { origin: 'template' }); renderCanvasOnly(); };
  try {
    // ---- 1. Off under automation ----
    ok('motion is off in the runner unless asked for', motionOn() === false);
    open('datacenter');
    setGroupCollapsed('g_a02', true);
    ok('a collapse with motion off leaves no ghost and animates no device', ghosts() === 0 && animsOn(document.getElementById('ui-group-g_a02')) === 0);
    setGroupCollapsed('g_a02', false);

    // ---- 2. A collapse, played ----
    window.TOPO_MOTION = true;
    ok('asked for, it is on', motionOn() === true);
    const saved = JSON.stringify(serializeDoc());
    const members = state.nodes.filter((n) => n.group === 'g_a02' || (n.host && getNode(n.host).group === 'g_a02'));
    setGroupCollapsed('g_a02', true);
    ok('each device drawn into the rack flies in as a copy', ghosts() === members.length, `${ghosts()} of ${members.length}`);
    ok('the rack\'s node grows in', animsOn(document.getElementById('ui-group-g_a02')) > 0);
    ok('an SVG export mid-flight holds no copy', !/motion-ghost/.test(canvasSvgMarkup()));
    ok('the saved document is what it was', JSON.stringify(serializeDoc()) === saved);
    await played();
    ok('once played the copies are gone', ghosts() === 0);
    ok('the node is drawn at the transform its attribute says', document.getElementById('ui-group-g_a02').getAnimations().length === 0);

    // ---- 3. Expand, Tidy, undo, the rack ----
    setGroupCollapsed('g_a02', false);
    const d9 = document.getElementById('ui-node-d9');
    ok('an expand spreads the devices out of the node', animsOn(d9) > 0);
    ok('and the node swells and goes as a copy', ghosts() === 1);
    ok('the device\'s own transform is its place', d9.getAttribute('transform') === `translate(${getNode('d9').x}, ${getNode('d9').y})`);
    await played();
    const before = state.nodes.map((n) => `${n.id}:${n.x},${n.y}`).join(' ');
    tidyLayout();
    const movedNow = state.nodes.filter((n) => animsOn(document.getElementById(`ui-node-${n.id}`)) > 0).length;
    ok('a Tidy glides the devices it moved', movedNow > 0, String(movedNow));
    await played();
    undo();
    ok('its undo glides them back, to where they were', state.nodes.map((n) => `${n.id}:${n.x},${n.y}`).join(' ') === before
      && state.nodes.some((n) => animsOn(document.getElementById(`ui-node-${n.id}`)) > 0));
    await played();
    openRackView('g_a01');
    await wait(50);
    batch(() => { getNode('d2').rackU = 25; save(); renderCanvasOnly(); });
    const box = document.querySelector('#rackView .rk-dev[data-node="d2"]:not(.rk-back)');
    ok('the rack view slides a box that moved', animsOn(box) > 0);
    ok('and fades its cables back in', animsOn(document.querySelector('#rackView .rk-wiring')) > 0);
    await played();
    showRackView(false);

    // ---- 4. Off again ----
    window.TOPO_MOTION = false;
    setGroupCollapsed('g_a01', true);
    ok('TOPO_MOTION = false turns it off', ghosts() === 0);
    setGroupCollapsed('g_a01', false);

    // ---- 5. The samples ----
    open('datacenter');
    const racks = state.groups.filter((g) => g.kind === 'rack');
    const racked = state.nodes.filter((n) => isRackGroup(groupById(n.group)) && !n.host);
    ok('Data Centre: a building, a hall, two racks and an ops room', state.groups.length === 5 && racks.length === 2
      && state.groups.some((g) => g.kind === 'building') && groupById('g_a01').parent === 'g_hall');
    ok('Data Centre: every device in a rack has its units', racked.length === 10 && racked.every((n) => Number.isInteger(n.rackU)), String(racked.length));
    ok('Data Centre: the web tier runs on the app servers', state.nodes.filter((n) => n.host).map((n) => `${n.id}>${n.host}`).join() === 'd6>d9,d7>d9,d8>d10');
    ok('Data Centre: the storage switch ships half depth, from the back', getNode('d12').rackDepth === 'half' && getNode('d12').rackFace === 'rear');
    const quiet = {};
    ['house', 'imaging', 'callcenter', 'datacenter', 'showcase'].forEach((k) => {
      open(k);
      // Faults only: a rack's untagged cables are an info note (Round 5),
      // and the samples' cables carry no tags.
      quiet[k] = topologyFindings().filter(isCountedFinding).filter((f) => /rack|group|host/i.test(`${f.check} ${f.detail}`)).map((f) => f.detail);
    });
    ok('no sample raises a group, rack or host finding', Object.values(quiet).every((l) => !l.length), JSON.stringify(quiet));
    open('imaging');
    ok('Imaging Centre: rooms on a floor and a 24U rack', state.groups.filter((g) => g.kind === 'room').length === 4 && groupById('g_rk1').uHeight === 24
      && state.nodes.filter((n) => n.group === 'g_rk1').every((n) => Number.isInteger(n.rackU)));
    open('callcenter');
    ok('Call Centre: a 12U wall rack of half-depth gear', groupById('g_wall').uHeight === 12
      && state.nodes.filter((n) => n.group === 'g_wall').every((n) => n.rackDepth === 'half'));
    open('showcase');
    ok('Showcase: the tower by floor and room, two server racks and a wall rack, the branch and the home apart',
      state.groups.length === 15 && state.groups.filter((g) => g.kind === 'rack').length === 3
      && state.nodes.filter((n) => isRackGroup(groupById(n.group)) && !n.host).every((n) => Number.isInteger(n.rackU))
      && groupById('g_branch').parent == null && getNode('ro').group === 'g_branch');
    ok('Showcase: the web tier on the app server, the API container inside the web VM',
      getNode('wvm').host === 'as' && getNode('pvm').host === 'as' && getNode('ctr').host === 'wvm' && getNode('ctr').group === 'g_rkb');
    open('house');
    ok('Smart Home: filed by room, the porch camera outside them', state.groups.length === 3 && !getNode('h6').group && getNode('h2').group === 'g_cup');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.TOPO_MOTION = false;
    try { localStorage.removeItem(COLLAPSED_KEY); } catch (e) { /* blocked */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
