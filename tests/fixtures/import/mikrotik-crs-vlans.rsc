# 2026-11-10 08:55:02 by RouterOS 7.15.3
# software id = ZX98-YW76
#
# model = CRS326-24G-2S+
# serial number = HFD0123456
# Hand-written test fixture for Topo's importer (a terse export), not a real switch's.
/interface bridge add admin-mac=48:8F:5A:11:22:00 auto-mac=no name=bridge1 vlan-filtering=yes
/interface ethernet set [ find default-name=ether1 ] comment="Uplink hEX" name=ether1
/interface ethernet set [ find default-name=ether2 ] comment=Recepcion
/interface ethernet set [ find default-name=ether3 ] name=cam-patio
/interface ethernet set [ find default-name=sfp-sfpplus1 ] comment="Fibra NAS"
/interface ethernet set [ find default-name=ether24 ] comment="hEX oficina"
/interface vlan add interface=bridge1 name=mgmt vlan-id=99
/interface bonding add mode=802.3ad name=bond-nas slaves=ether22,ether23
/interface bridge port add bridge=bridge1 interface=ether2 pvid=10
/interface bridge port add bridge=bridge1 interface=cam-patio pvid=30
/interface bridge port add bridge=bridge1 interface=ether4 pvid=10
/interface bridge port add bridge=bridge1 interface=ether24
/interface bridge port add bridge=bridge1 interface=bond-nas pvid=10
/interface bridge vlan add bridge=bridge1 tagged=bridge1,ether1,ether24 untagged=ether5 vlan-ids=20
/interface bridge vlan add bridge=bridge1 tagged=bridge1,ether1,ether24 vlan-ids=10,30,99,100-102
/ip address add address=192.168.99.2/24 interface=mgmt network=192.168.99.0
/system identity set name="sw-piso1"
/system note set show-at-login=no
/snmp community set [ find default=yes ] name=s3cr3t-community
