// Extracted from the scratchpad HTML this suite was first authored in.
window.addEventListener('load',()=>{ setTimeout(()=>{
  const out=[]; const ok=(n,c,e)=>out.push(`${c?'PASS':'FAIL'} :: ${n}${e?' :: '+e:''}`);
  const load=(k)=>{ loadTemplateState(templatesData[k]); autoBindLinks(); renderCanvasOnly(); };

  load('imaging');
  ok('imaging: archive link is fibre', effectiveMedium(getLink('im13'))==='fiber');
  ok('imaging: teleradiology rides a VPN tunnel', effectiveMedium(getLink('im17'))==='vpn');
  ok('imaging: remote radiologist reaches PACS', calculateReachability('i_rad').reachableNodes.has('i_pacs'));
  ok('imaging: modalities reach PACS', calculateReachability('i_ct').reachableNodes.has('i_pacs'));
  ok('imaging: DICOM port 104 open on PACS', getPortStatus(getNode('i_pacs'),'104').level==='good', getPortStatus(getNode('i_pacs'),'104').text.slice(0,40));
  ok('imaging: VLANs bound as authored', ifaceLabel(getNode('i_l3'), getLink('im5').sourceIface)==='vlan10' && ifaceLabel(getNode('i_l3'), getLink('im6').sourceIface)==='vlan20');

  load('hotel');
  ok('hotel: guest laptop associates by radio', effectiveMedium(getLink('ho9'))==='wireless');
  ok('hotel: guest reaches the internet', calculateReachability('h_gl').reachableNodes.has('h_net'));
  ok('hotel: both APs uplink on the guest VLAN', ifaceLabel(getNode('h_l3'), getLink('ho7').sourceIface)==='vlan20' && ifaceLabel(getNode('h_l3'), getLink('ho8').sourceIface)==='vlan20');
  ok('hotel: AP uplinks are cables, not radio', effectiveMedium(getLink('ho7'))==='utp' && effectiveMedium(getLink('ho8'))==='utp');

  load('vessel');
  ok('vessel: crew phone associates by radio', effectiveMedium(getLink('ve11'))==='wireless');
  ok('vessel: crew phone reaches the satellite uplink', calculateReachability('v_cph').reachableNodes.has('v_sat'));
  ok('vessel: engine SCADA speaks Modbus/502', getPortStatus(getNode('v_scd'),'502').level==='good');
  ok('vessel: bridge and engine are separate subnets',
     getValidIps(getNode('v_ecd'))[0].networkStr !== getValidIps(getNode('v_scd'))[0].networkStr,
     getValidIps(getNode('v_ecd'))[0].networkStr+' vs '+getValidIps(getNode('v_scd'))[0].networkStr);

  load('warehouse');
  ok('warehouse: scanners associate by radio', effectiveMedium(getLink('wa9'))==='wireless');
  ok('warehouse: a scanner reaches the WMS', calculateReachability('wh_h1').reachableNodes.has('wh_wms'));
  ok('warehouse: two scanners share one radio', getLink('wa9').targetIface === getLink('wa10').targetIface);

  const pre=document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent=out.join('\n'); document.body.appendChild(pre);
},400); });
