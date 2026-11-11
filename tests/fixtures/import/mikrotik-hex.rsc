# nov/10/2026 08:41:17 by RouterOS 6.49.15
# software id = AB12-CD34
#
# model = RB750Gr3
# serial number = HEX0000A1B2
# Hand-written test fixture for Topo's importer, not a real router's export.
/interface bridge
add admin-mac=48:8F:5A:00:00:01 auto-mac=no comment=defconf name=bridge
/interface ethernet
set [ find default-name=ether1 ] comment="Internet (Telmex)" mac-address=48:8F:5A:00:00:01 name=ether1-wan
set [ find default-name=ether2 ] mac-address=48:8F:5A:00:00:02
set [ find default-name=ether5 ] disabled=yes
/interface vlan
add interface=bridge name=vlan20-voz vlan-id=20
/interface wireless security-profiles
set [ find default=yes ] supplicant-identity=MikroTik
add authentication-types=wpa2-psk eap-methods="" mode=dynamic-keys name=oficina \
    supplicant-identity="" wpa2-pre-shared-key="Una\_clave\"rara\\2026"
/interface list
add comment=defconf name=WAN
add comment=defconf name=LAN
/ip pool
add name=dhcp_pool0 ranges=192.168.88.100-192.168.88.199
add name=pool-voz ranges=10.0.20.10-10.0.20.50
/ip dhcp-server
add address-pool=dhcp_pool0 disabled=no interface=bridge name=dhcp1
add address-pool=pool-voz disabled=no interface=vlan20-voz name=dhcp-voz
/interface bridge port
add bridge=bridge comment=defconf interface=ether2
add bridge=bridge comment=defconf interface=ether3
add bridge=bridge comment=defconf interface=ether4
/ip address
add address=192.168.88.1/24 comment=defconf interface=bridge network=192.168.88.0
add address=10.0.20.1/24 interface=vlan20-voz network=10.0.20.0
add address=201.150.10.2/30 interface=ether1-wan network=201.150.10.0
/ip dhcp-client
add comment=defconf disabled=yes interface=ether1-wan
/ip dhcp-server lease
add address=192.168.88.20 comment="Impresora HP" mac-address=00:14:38:DD:00:20 server=dhcp1
add address=192.168.88.21 mac-address=D0:67:E5:DD:00:21 server=dhcp1
add address=10.0.20.11 comment="Telefono recepcion" mac-address=00:0B:82:DD:00:11 server=dhcp-voz
/ip dhcp-server network
add address=10.0.20.0/24 dns-server=10.0.20.1 gateway=10.0.20.1
add address=192.168.88.0/24 comment=defconf dns-server=192.168.88.1,1.1.1.1 gateway=192.168.88.1
/ip dns
set allow-remote-requests=yes
/ip firewall filter
add action=accept chain=input comment="defconf: accept established,related,untracked" connection-state=established,related,untracked
add action=drop chain=input comment="defconf: drop invalid" connection-state=invalid
/ip firewall nat
add action=masquerade chain=srcnat comment="defconf: masquerade" ipsec-policy=out,none out-interface-list=WAN
/ip route
add distance=1 gateway=201.150.10.1
/ppp secret
add name=vpn-user password=vpn-secret-99 profile=default-encryption
/system clock
set time-zone-name=America/Mexico_City
/system identity
set name=hex-oficina
this line is not RouterOS
/ip neighbor print detail
 0 interface=ether2,bridge address=192.168.88.2 mac-address=48:8F:5A:11:22:33 identity="sw-piso1" platform="MikroTik"
   version="7.15.3 (stable)" board="CRS326-24G-2S+" interface-name="ether24" system-caps="bridge,router" system-caps-enabled="bridge"
 1 interface=ether4,bridge address=192.168.88.30 mac-address=D0:67:E5:DD:00:30 identity="nas-01" platform="Linux" version="6.1"
