# 2026-11-10 09:02:44 by RouterOS 7.16
# software id = QW12-ER34
#
# model = C53UiG+5HPaxD2HPaxD
# serial number = HHB0A1B2C3D
# Hand-written test fixture for Topo's importer (v7 /interface wifi), not a real router's.
/interface wifi security
add authentication-types=wpa2-psk,wpa3-psk name=sec-casa passphrase="no-me-leas-2026"
/interface wifi configuration
add country=Mexico name=cfg-casa security=sec-casa ssid="Casa Ruiz"
/interface wifi
set [ find default-name=wifi1 ] channel.band=5ghz-ax configuration=cfg-casa configuration.mode=ap disabled=no
set [ find default-name=wifi2 ] channel.band=2ghz-ax configuration=cfg-casa configuration.mode=ap disabled=no
add configuration.mode=ap configuration.ssid="Casa Invitados" configuration.hide-ssid=yes master-interface=wifi2 name=wifi3 security.authentication-types=""
/ip address
add address=192.168.10.1/24 interface=bridge network=192.168.10.0
/system identity
set name=hapax-casa
