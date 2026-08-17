// carino-oui — MAC address decoding, lifted out of hardware.carino.systems so
// the two tools cannot drift apart. Pure data plus four functions; no DOM, no
// i18n, no globals beyond the ones exported at the bottom.
//
// The table is a CURATED ~570-prefix subset, not the IEEE registry (~35,000).
// An address that misses it is "not in our table", never "unassigned" — say so
// in the UI, because the difference matters to whoever is reading.
//
// Topo uses it on interface MACs: paste an address and the vendor, the
// unicast/multicast bit and the universal/local bit are read out of the address
// itself. The last of those is the one that earns its place on a network map —
// a locally-administered address is randomised, so the OUI tells you nothing
// and any inventory keyed on it is fiction.

/* ---- 1. OUI table (curated subset, keyed by 6 hex chars) ---- */
const OUI = {};
function reg(vendor, ...prefixes){ for(const p of prefixes) OUI[p.replace(/[^0-9a-f]/gi,'').toUpperCase()] = vendor; }

reg('Apple','0003 93','000A 95','0016 CB','001B 63','001E C2','0021 E9','0023 12','0025 BC','0026 BB',
    '3C07 54','6033 4B','6896 7B','A45E 60','ACBC 32','D023 DB','F018 98','DC2B 2A','9084 0D','9803 D8',
    '8866 5A','F437 B7','E4CE 8F','B817 C2','7CD1 C3','5426 96','4C8D 79','40B3 95','1C1A C0','A8BB CF');
reg('Samsung','0000 F0','0007 AB','0012 FB','0015 99','001A 8A','001D 25','0021 19','0023 39','0024 54',
    '0837 3D','5C0A 5B','8C77 12','BC20 A4','C819 F7','E850 8B','F008 F1','2C44 01','34BE 00','78F8 82');
reg('Intel Corporate','0002 B3','0003 47','000C F1','0013 02','0015 00','0016 76','0019 D1','001B 21',
    '001E 64','001F 3B','0021 6A','0024 D7','3CA9 F4','5CE0 C5','7C5C F8','8CA9 82','A088 B4','AC7B A1',
    'E4A7 A0','606C 66','9C4E 36','48F1 7F','B4D5 BD','34E1 2D');
reg('Dell','0006 5B','0008 74','000B DB','000D 56','0012 3F','0014 22','0015 C5','0018 8B','0019 B9',
    '001A A0','001E 4F','0021 70','0022 19','0024 E8','0025 64','14FE B5','1803 73','1866 DA','2047 47',
    '24B6 FD','3417 EB','549F 35','7486 7A','848F 69','B8AC 6F','D067 E5','F8B1 56','F8BC 12','98 90 96','B885 84');
reg('HP / HPE','0001 E6','0004 EA','0008 02','000B CD','000E 7F','000F 20','0011 0A','0014 38','0016 35',
    '0017 08','0018 71','0019 BB','001B 78','001C C4','001E 0B','001F 29','0021 5A','0022 64','0023 7D',
    '0025 B3','0026 55','0800 09','1060 4B','2892 4A','2C23 3A','2C44 FD','308D 99','3464 A9','3863 BB',
    '3C4A 92','40A8 F0','5CB9 01','6C3B E5','7010 6F','78AC C0','80CE 62','9457 A5','9C8E 99','A01D 48',
    'AC16 2D','B05A DA','B499 BA','C8CB B8','D07E 28','D89D 67','EC8E B5','EC9A 74','F092 1C','FC15 B4','FC3F DB');
reg('Cisco','0000 0C','0001 42','0001 63','0001 96','000A 41','000B 5F','000D 28','000E 83','000F 23',
    '0011 20','0012 00','0013 19','0014 1B','0015 2B','0016 46','0017 0E','0018 18','0019 2F','001A 6C',
    '001B 0C','001C 0F','001D 45','001E 13','001F 26','0021 55','0022 55','0023 04','0024 14','0025 45',
    '0026 0A','5835 D9','6C41 6A','F40F 1B','F866 F2');
reg('TP-Link','000A EB','14CC 20','18A6 F7','30B5 C2','50C7 BF','54C8 0F','60E3 27','6470 02','A0F3 C1',
    'AC84 C6','B048 7A','C025 E9','C46E 1F','C4E9 84','D80D 17','E8DE 27','EC08 6B','F4F2 6D','F81A 67','F8D1 11');
reg('Huawei','0018 82','001E 10','0025 9E','0034 FE','0046 4B','0402 1F','04BD 70','04C0 6F','0819 A6',
    '0C37 DC','101B 54','20F3 A3','2831 52','4846 FB','4C1F CC','5C7D 5E','78D7 52','80B6 86','8853 D4',
    'C8D1 5E','E019 1D','F4C7 14','FC48 EF');
reg('Xiaomi','009E C8','0C1D AF','102A B3','14F6 5A','1859 36','2082 C0','286C 07','34CE 00','38A4 ED',
    '3CBD 3E','5064 2B','5844 98','6409 80','64B4 73','68DF DD','742344','7811 DC','7C1D D9','8CBE BE',
    '98FA E3','A086 C6','ACC1 EE','F0B4 29','F8A4 5F','FC64 BA');
reg('Google','001A 11','3C5A B4','5460 09','6CAD F8','9495 A0','A477 33','F4F5 D8','F4F5 E8','089E 08',
    '20DF B9','30FD 38','48D6 D5','6416 66','94EB 2C','D86C 63','E4F0 42','DAA1 19');
reg('Amazon','0071 47','0C47 C9','34D2 70','38F7 3D','40B4 CD','4465 0D','4C17 44','50DC E7','6837 E9',
    '6854 FD','7475 48','74C2 46','84D6 D0','A002 DC','AC63 BE','F027 2D','F081 73','FC65 DE','FCA1 83','B0FC 0D');
reg('Microsoft','0003 FF','0012 5A','0017 FA','001D D8','0022 48','2818 78','3059 B7','3C83 75','4850 73',
    '501A C5','5882 A8','5CBA 37','6045 BD','7C1E 52','7CED 8D','985F D3','B4AE 2B','C033 5E','C49D ED','DC98 40');
reg('Raspberry Pi','28CD C1','2CCF 67','B827 EB','D83A DD','DCA6 32','E45F 01');
reg('Espressif (ESP8266/32)','18FE 34','240A C4','246F 28','2C3A E8','30AE A4','3C71 BF','40F5 20','483F DA',
    '545A A6','5CCF 7F','6001 94','68C6 3A','7C9E BD','840D 8E','84CC A8','8CAA B5','90380C','A020 A6',
    'A47B 9D','AC67 B2','B4E6 2D','BCDD C2','CC50 E3','D8A0 1D','DC4F 22','ECFA BC');
reg('Netgear','0009 5B','000F B5','0014 6C','0018 4D','001B 2F','001E 2A','001F 33','0022 3F','0024 B2',
    '0026 F2','04A1 51','08BD 43','200C C8','204E 7F','28C6 8E','2C30 33','4494 FC','4C60 DE','6CB0 CE',
    '841B 5E','9C3D CF','A004 60','A040 A0','C03F 0E','C404 15','DCEF 09','E046 9A','E091 F5','E4F4 C6');
reg('ASUSTek','000C 6E','000E A6','0011 2F','0011 D8','0013 D4','0015 F2','0017 31','0018 F3','001A 92',
    '001B FC','001D 60','001E 8C','001F C6','0022 15','0023 54','0024 8C','0026 18','0860 6E','10BF 48',
    '1C87 2C','2CFDA1','305A 3A','382C 4A','5046 5D','5404 A6','6045 CB','704D 7B','74D0 2B','AC22 0B',
    'AC9E 17','BCAE C5','D850 E6','E03F 49','F46D 04','FC34 97');
reg('Lenovo','0059 07','089E 01','1051 72','1C69 7A','201E 88','2089 84','507B 9D','54EE 75','68F7 28',
    '70720D','7404 F1','8C16 45','A48C DB','ACB5 7D','C85B 76','C8D3 FF','CC2F 71','D832 14','E02C B2',
    'F0D5 BF','7088 6B','98FA 9B');
reg('LG Electronics','001C 62','001E 75','001F 6B','0022 A9','0024 83','0025 E5','0026 E2','00AA 70',
    '1068 3F','2C54 CF','34FC EF','40B0 FA','58A2 B5','60E3 AC','64995D','6CD6 8A','7091 8F','88C9 D0',
    'A039 F7','A816 B2','C49A 02','CC2D 8C','E85B 5B','F80C F3');
reg('Sony','0001 4A','0004 1F','000A D9','000E 07','0013 15','0016 20','0019 63','001A 80','001B 59',
    '001C A4','001D 0D','001E 45','0024 BE','00D9 D1','30F9 ED','5442 49','7884 3C','AC9B 0A','D8D4 3C','FC0F E6');
reg('MSI (Micro-Star)','0016 17','0019 DB','0021 85','0024 21','309C 23','448A 5B','8C89 A5','D8CB 8A','E0D5 5E');
reg('Gigabyte','000D 61','0016 E6','001A 4D','001D 7D','001F D0','0024 1D','1C6F 65','408D 5C','50E5 49',
    '74D4 35','B42E 99');
reg('Acer','0001 24','0016 D4','001A 6B','001D 72','6CF0 49','8C10 D4','C03F D5','D0DF 9A');
reg('Realtek','00E0 4C');
reg('NVIDIA','0004 4B','48B0 2D');
reg('Ubiquiti','0027 22','44D9 E7','6864 4B','DC9F DB','FCEC DA','E063 DA','B4FB E4');
reg('MikroTik','4C5E 0C','6432 A8','48A98A ','CC2DE0 ','DC2C6E ','E48D8C ');
reg('D-Link','0005 5D','0011 95','0013 46','0015 E9','0017 9A','001B 11','001C F0','001E 58',
    '0021 91','1CBD B9','5CD9 98','C8BE 19','F07D 68','FC75 16');
reg('Nintendo','0009 BF','0016 56','0017 AB','0019 1D','001A E9','001B EA','001C BE','001E 35','001F 32',
    '0021 47','0022 4C','0023 CC','0024 44','0025 A0','0026 59','182A 7B','2C10 C1','34AF 2C',
    '58BD A3','7CBB 8A','8CCD E8','98B6 E9','9CE6 35','B8AE 6E','E84E CE');
reg('VMware (virtual)','0005 69','000C 29','0050 56','0010 4C');
reg('VirtualBox (virtual)','0800 27');
reg('Microsoft Hyper-V (virtual)','0015 5D');
reg('Xen (virtual)','0016 3E');
reg('Parallels (virtual)','001C 42');
reg('QEMU/KVM (virtual)','5254 00');
reg('Docker (virtual)','0242 AC','0242 C0','0242 00');

/* Longer, meaningful reserved prefixes (matched before OUI) */
const RESERVED = [
  {p:'FFFFFFFFFFFF', name:'Broadcast address', kind:'special', note:'Sent to every device on the segment. Not a real vendor.'},
  {p:'000000000000', name:'Null / unspecified', kind:'special', note:'All-zero address — a placeholder or uninitialised interface.'},
  {p:'01005E', name:'IPv4 multicast', kind:'special', note:'Ethernet mapping of an IPv4 multicast group (RFC 1112).'},
  {p:'3333',   name:'IPv6 multicast', kind:'special', note:'Ethernet mapping of an IPv6 multicast group (RFC 2464).'},
  {p:'0180C2', name:'IEEE 802.1 bridge group', kind:'special', note:'Spanning Tree (STP), LLDP, LACP and other link-layer control frames.'},
  {p:'01000C', name:'Cisco control (CDP/VTP/PVST+)', kind:'special', note:'Cisco Discovery Protocol / VLAN control multicast.'},
  {p:'01000CCCCCCC', name:'Cisco CDP / VTP', kind:'special', note:'Cisco Discovery Protocol multicast address.'},
  {p:'FFFF', name:'Reserved / vendor test', kind:'special', note:'Leading FFs are typically broadcast or invalid.'}
];

/* ---- 2. MAC parsing & decoding ---- */
function normalizeMac(raw){
  const hex = (raw||'').replace(/[^0-9a-fA-F]/g,'').toUpperCase();
  return hex;
}
function looksLikeMac(raw){
  // 12 hex digits with optional : - . separators, in familiar groupings
  const s = (raw||'').trim();
  if(/^[0-9a-fA-F]{12}$/.test(s.replace(/[^0-9a-fA-F]/g,'')) &&
     /[:\-.]/.test(s)) return true;              // has separators + 12 hex
  if(/^([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}$/.test(s)) return true;
  if(/^([0-9a-fA-F]{4}[.]){2}[0-9a-fA-F]{4}$/.test(s)) return true; // cisco
  if(/^[0-9a-fA-F]{12}$/.test(s)) return true;    // bare 12 hex
  return false;
}
function fmtColon(hex){ return hex.match(/.{2}/g).join(':'); }

function lookupVendor(hex){
  // reserved / structural prefixes first (longest match wins)
  const sorted = RESERVED.slice().sort((a,b)=>b.p.length-a.p.length);
  for(const r of sorted){ if(hex.startsWith(r.p)) return {vendor:r.name, kind:r.kind, note:r.note}; }
  // OUI (first 24 bits)
  const oui = hex.slice(0,6);
  if(OUI[oui]) return {vendor:OUI[oui], kind:'oui', oui};
  return {vendor:null, kind:'unknown', oui};
}

function decodeMac(raw){
  const hex = normalizeMac(raw);
  if(hex.length !== 12) {
    return {error:`Need exactly 12 hex digits — got ${hex.length}. A MAC looks like AA:BB:CC:DD:EE:FF.`};
  }
  const bytes = hex.match(/.{2}/g).map(b=>parseInt(b,16));
  const first = bytes[0];
  const igBit = first & 0x01;           // 0 = unicast, 1 = multicast/group
  const ulBit = (first & 0x02) >> 1;    // 0 = universal (OUI), 1 = local
  const v = lookupVendor(hex);

  // classify
  const isBroadcast = hex === 'FFFFFFFFFFFF';
  const isMulticast = igBit === 1 && !isBroadcast;
  const isLocal = ulBit === 1;

  // EUI-64 (insert FFFE) & IPv6 modified EUI-64 (flip U/L bit)
  const eui64 = (hex.slice(0,6) + 'FFFE' + hex.slice(6)).match(/.{2}/g).join(':');
  const modFirst = (first ^ 0x02).toString(16).padStart(2,'0').toUpperCase();
  const modEui = modFirst + hex.slice(2,6) + 'FFFE' + hex.slice(6);
  const ll = 'fe80::' + modEui.slice(0,4).toLowerCase() + ':' + modEui.slice(4,8).toLowerCase()
           + ':' + modEui.slice(8,12).toLowerCase() + ':' + modEui.slice(12,16).toLowerCase();

  return {hex, bytes, first, igBit, ulBit, vendor:v, isBroadcast, isMulticast, isLocal,
          eui64, ll, oui:hex.slice(0,6)};
}

// The map is what makes duplicate detection possible: two interfaces holding
// the same address is a fact about the drawing, not about any one node.
window.CarinoOUI = { OUI, RESERVED, decodeMac, looksLikeMac, normalizeMac, fmtColon, lookupVendor };
