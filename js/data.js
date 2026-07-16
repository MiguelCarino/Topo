// Seed defaults, templates and building-block snippets. Pure data.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const initialDataDefaults = {
    cloud: { os: 'ISP', interfaces: [{ id: 'i1', name: 'wan0', ip: '8.8.8.8/32' }] },
    router: { os: 'Edge Gateway', gw: '0.0.0.0', dns: '8.8.8.8', ports: '22', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.1/24' }] },
    firewall: { os: 'pfSense', dns: '1.1.1.1', ports: '443, 22', interfaces: [{ id: 'i1', name: 'igb0', ip: '10.0.0.1/24' }] },
    switch: { os: 'SwitchOS', interfaces: [] }, // Empty interfaces = Dumb switch (backplane)
    server: { os: 'Ubuntu OS', gw: '192.168.1.1', dns: '8.8.8.8', ports: '80, 443, 22', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.10/24' }] },
    vm: { os: 'Ubuntu VM', gw: '192.168.1.1', dns: '8.8.8.8', ports: '22', interfaces: [{ id: 'i1', name: 'vnet0', ip: '192.168.1.11/24' }] },
    pc: { os: 'Windows 11', gw: '192.168.1.1', dns: '8.8.8.8', ports: '80, 443', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.50/24' }] },
    ap: { os: 'UniFi', interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] }, // radio serves clients; faceplate port is the uplink
    iot: { os: 'FreeRTOS', gw: '192.168.1.1', dns: '8.8.8.8', ports: '1883', interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.100/24' }] },
    printer: { os: 'Firmware', gw: '192.168.1.1', ports: '9100', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.80/24' }] },
    camera: { os: 'Firmware', gw: '192.168.1.1', ports: '554', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.90/24' }] },
    container: { os: 'Docker', gw: '192.168.1.1', dns: '8.8.8.8', ports: '8080', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.120/24' }] },
    loadbalancer: { os: 'HAProxy', gw: '203.0.113.1', dns: '8.8.8.8', ports: '80, 443', nat: true, interfaces: [{ id: 'i1', name: 'vip0', ip: '203.0.113.20/24' }, { id: 'i2', name: 'pool0', ip: '10.30.0.1/24' }] },
    l3switch: { os: 'Cisco IOS', dns: '8.8.8.8', ports: '22', interfaces: [{ id: 'i1', name: 'vlan10', ip: '10.10.10.1/24' }, { id: 'i2', name: 'vlan20', ip: '10.10.20.1/24' }] },
    edge: { os: 'Omada', dns: '8.8.8.8', ports: '443, 500, 4500', nat: true, interfaces: [{ id: 'i1', name: 'wan0', ip: '203.0.113.2/30' }, { id: 'i2', name: 'wan1', ip: '198.51.100.2/30' }, { id: 'i3', name: 'lan', ip: '192.168.0.1/24' }] },
    vpn: { os: 'FortiGate', dns: '1.1.1.1', ports: '443, 500, 4500', nat: true, interfaces: [{ id: 'i1', name: 'wan', ip: '203.0.113.10/30' }, { id: 'i2', name: 'lan', ip: '10.0.0.1/24' }] },
    voip: { os: 'SIP', gw: '192.168.1.1', dns: '8.8.8.8', ports: '5060, 5061', interfaces: [{ id: 'i1', name: 'eth0', ip: '192.168.1.60/24' }] }
};

// Templates Data (Converted to Interface format via Normalizer)
// A deliberately broken network: every node here trips a different check, so the
// diagnostics have something to demonstrate on. Interfaces and bindings are
// explicit throughout — auto-bind is good enough to quietly repair most of these
// if left to choose, which would defeat the point.
// dx/dy are block offsets; the template wrapper below turns them into absolute
// coordinates so the same data serves both menus.
const COMMON_ERRORS = {
    nodes: [
        { tid: 'rtr', type: 'router', name: 'Gateway', dx: 0, dy: -180, dns: '8.8.8.8',
          interfaces: [{ id: 'r1', name: 'eth0', ip: '192.168.9.1/24' }] },

        // L2 loop: two switches, two cables, no STP.
        { tid: 'sw1', type: 'switch', name: 'Switch A', dx: -110, dy: -40, portCount: 8, interfaces: [] },
        { tid: 'sw2', type: 'switch', name: 'Switch B', dx: 150, dy: -40, portCount: 8, interfaces: [] },

        // ARP flux + MAC flapping: two NICs, one subnet, one broadcast domain.
        { tid: 'pacs', type: 'server', name: 'PACS (dual NIC)', dx: -260, dy: 90, gw: '192.168.9.1', ports: '104, 11112',
          interfaces: [{ id: 'e1', name: 'eno1', ip: '192.168.9.10/24' }, { id: 'e2', name: 'enp4s0', ip: '192.168.9.11/24' }] },

        // Duplicate IP: same address as the PACS server's eno1.
        { tid: 'dup', type: 'server', name: 'Duplicate IP', dx: 260, dy: 90, gw: '192.168.9.1',
          interfaces: [{ id: 'd1', name: 'eth0', ip: '192.168.9.10/24' }] },

        // Wi-Fi association cabled out of the Ethernet port while a radio sits idle.
        { tid: 'ap', type: 'ap', name: 'Access Point', dx: -10, dy: 90, portCount: 1,
          interfaces: [{ id: 'w1', name: 'wlan0', ip: '' }] },
        { tid: 'lap', type: 'pc', name: 'Laptop (Wi-Fi on eth0)', dx: -10, dy: 220, gw: '192.168.9.1',
          interfaces: [{ id: 'l1', name: 'eth0', ip: '192.168.9.50/24' }, { id: 'l2', name: 'wlan0', ip: '' }] },

        // Cabled to the gateway but addressed on another subnet, with a gateway it
        // therefore cannot reach.
        // Kept off the top-right: that corner is where the validation panel sits,
        // and this node is one of the things the panel is talking about.
        { tid: 'mis', type: 'pc', name: 'Wrong Subnet', dx: -280, dy: -180, gw: '192.168.9.1',
          interfaces: [{ id: 'm1', name: 'eth0', ip: '10.99.9.5/24' }] }
    ],
    links: [
        { s: 'rtr', t: 'sw1', si: 'r1', ti: 'p1' },
        { s: 'sw1', t: 'sw2', si: 'p2', ti: 'p1' },
        { s: 'sw1', t: 'sw2', si: 'p3', ti: 'p2' },              // closes the loop
        { s: 'pacs', t: 'sw1', si: 'e1', ti: 'p4' },
        { s: 'pacs', t: 'sw1', si: 'e2', ti: 'p5' },             // same subnet, same fabric
        { s: 'ap', t: 'sw1', si: 'p1', ti: 'p6' },               // uplink: cable, port to port
        { s: 'lap', t: 'ap', si: 'l1', ti: 'w1', medium: 'wireless' }, // radio out of eth0
        { s: 'dup', t: 'sw2', si: 'd1', ti: 'p3' },
        { s: 'mis', t: 'rtr', si: 'm1', ti: 'r1' }               // subnet mismatch on one cable
    ]
};

// Same block, placed absolutely, so it can also be opened as a whole workspace.
const commonErrorsTemplate = (originX, originY) => ({
    nodes: COMMON_ERRORS.nodes.map((n) => {
        const { tid, dx, dy, ...rest } = n;
        return { ...cloneData(rest), id: tid, x: originX + dx, y: originY + dy };
    }),
    links: COMMON_ERRORS.links.map((l, i) => ({
        id: `ce${i}`, source: l.s, target: l.t, sourceIface: l.si, targetIface: l.ti,
        medium: l.medium, attachment: l.attachment || null
    }))
});

const templatesData = {
    house: {
        nodes: [
            { id: 'h1', type: 'cloud', name: 'ISP', x: 400, y: 100, ips: ['203.0.113.1/30'] },
            { id: 'h2', type: 'router', name: 'Home Router', x: 400, y: 220, ips: ['192.168.1.1/24', '203.0.113.2/30'], gw: '203.0.113.1', dns: '8.8.8.8' },
            { id: 'h3', type: 'pc', name: 'Home PC', x: 250, y: 350, ips: ['192.168.1.50/24'], gw: '192.168.1.1', dns: '8.8.8.8' },
            { id: 'hp1', type: 'printer', name: 'Wireless Printer', x: 350, y: 350, gw: '192.168.1.1', dns: '8.8.8.8', interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.80/24' }] },
            { id: 'hap', type: 'ap', name: 'WiFi AP', x: 500, y: 350, ips: [] },
            { id: 'h5', type: 'iot', name: 'Smart TV', x: 450, y: 450, gw: '192.168.1.1', dns: '8.8.8.8', interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.101/24' }] },
            { id: 'h6', type: 'camera', name: 'Porch Cam', x: 550, y: 450, gw: '192.168.1.1', dns: '8.8.8.8', interfaces: [{ id: 'i1', name: 'wlan0', ip: '192.168.1.102/24' }] }
        ],
        links: [{ id: 'hl1', source: 'h1', target: 'h2' }, { id: 'hl2', source: 'h2', target: 'h3' }, { id: 'hl3', source: 'h2', target: 'hap' }, { id: 'hl4', source: 'hap', target: 'h5' }, { id: 'hl5', source: 'hap', target: 'h6' }, { id: 'hl6', source: 'hap', target: 'hp1' }]
    },
    bank: {
        nodes: [
            { id: 'b1', type: 'cloud', name: 'WAN Connection', x: 400, y: 50, ips: [] },
            { id: 'b2', type: 'firewall', name: 'Edge Firewall', x: 400, y: 150, ips: ['10.50.0.1/16'], dns: '1.1.1.1' },
            { id: 'b3', type: 'router', name: 'Core Router', x: 400, y: 250, ips: ['10.50.10.1/24', '10.50.20.1/24'], gw: '10.50.0.1' },
            { id: 'b4', type: 'switch', name: 'Teller SW', x: 250, y: 350, portCount: 8, ips: [] },
            { id: 'b5', type: 'pc', name: 'Teller 1', x: 150, y: 450, ips: ['10.50.10.51/24'], gw: '10.50.10.1', dns: '10.50.10.10' },
            { id: 'b6', type: 'pc', name: 'Teller 2', x: 250, y: 450, ips: ['10.50.10.52/24'], gw: '10.50.10.1', dns: '10.50.10.10' },
            { id: 'b7', type: 'printer', name: 'Secure Print', x: 350, y: 450, ips: ['10.50.10.80/24'], gw: '10.50.10.1' },
            { id: 'b8', type: 'switch', name: 'ATM SW', x: 550, y: 350, portCount: 8, ips: [] },
            { id: 'b9', type: 'custom', name: 'Lobby ATM', x: 500, y: 450, ips: ['10.50.20.100/24'], gw: '10.50.20.1' },
            { id: 'b10', type: 'custom', name: 'Drive-Thru ATM', x: 600, y: 450, ips: ['10.50.20.101/24'], gw: '10.50.20.1' }
        ],
        links: [{ id: 'bl1', source: 'b1', target: 'b2' }, { id: 'bl2', source: 'b2', target: 'b3' }, { id: 'bl3', source: 'b3', target: 'b4' }, { id: 'bl4', source: 'b3', target: 'b8' }, { id: 'bl5', source: 'b4', target: 'b5' }, { id: 'bl6', source: 'b4', target: 'b6' }, { id: 'bl7', source: 'b4', target: 'b7' }, { id: 'bl8', source: 'b8', target: 'b9' }, { id: 'bl9', source: 'b8', target: 'b10' }]
    },
    datacenter: {
        nodes: [
            { id: 'd1',  type: 'cloud',        name: 'Internet Backbone', x: 480, y: 40,  ips: [] },
            { id: 'd2',  type: 'edge',         name: 'Edge Router',       x: 480, y: 150, nat: true, gw: '203.0.113.1', dns: '1.1.1.1', ips: ['203.0.113.2/30', '198.51.100.2/30', '172.16.0.1/24'] },
            { id: 'd3',  type: 'firewall',     name: 'Perimeter FW',      x: 480, y: 260, nat: true, gw: '172.16.0.1', ips: ['172.16.0.2/24', '172.16.1.1/24', '172.16.2.1/24'], ports: '443, 22' },
            { id: 'd4',  type: 'loadbalancer', name: 'App Load Balancer', x: 260, y: 380, gw: '172.16.1.1', ips: ['172.16.1.5/24', '10.10.0.1/24'], ports: '80, 443' },
            { id: 'd5',  type: 'l3switch',     name: 'Core Fabric',       x: 640, y: 380, gw: '172.16.2.1', ips: ['172.16.2.2/24', '10.20.0.1/24', '10.30.0.1/24'] },
            { id: 'd6',  type: 'vm',           name: 'Web Node 1',        x: 120, y: 510, ips: ['10.10.0.11/24'], gw: '10.10.0.1', ports: '80, 443' },
            { id: 'd7',  type: 'vm',           name: 'Web Node 2',        x: 220, y: 510, ips: ['10.10.0.12/24'], gw: '10.10.0.1', ports: '80, 443' },
            { id: 'd8',  type: 'container',    name: 'API Container',     x: 320, y: 510, ips: ['10.10.0.13/24'], gw: '10.10.0.1', ports: '8080' },
            { id: 'd9',  type: 'server',       name: 'App Server 1',      x: 470, y: 510, ips: ['10.20.0.11/24'], gw: '10.20.0.1', ports: '8080' },
            { id: 'd10', type: 'server',       name: 'App Server 2',      x: 570, y: 510, ips: ['10.20.0.12/24'], gw: '10.20.0.1', ports: '8080' },
            { id: 'd11', type: 'pc',           name: 'Jump Host',         x: 670, y: 510, ips: ['10.20.0.50/24'], gw: '10.20.0.1', ports: '22' },
            { id: 'd12', type: 'switch',       name: 'Storage Switch',    x: 820, y: 510, portCount: 8, ips: [] },
            { id: 'd13', type: 'server',       name: 'DB Master',         x: 760, y: 640, ips: ['10.30.0.10/24'], gw: '10.30.0.1', ports: '5432' },
            { id: 'd14', type: 'server',       name: 'DB Replica',        x: 850, y: 640, ips: ['10.30.0.11/24'], gw: '10.30.0.1', ports: '5432' },
            { id: 'd15', type: 'server',       name: 'NAS Storage',       x: 940, y: 640, ips: ['10.30.0.20/24'], gw: '10.30.0.1', ports: '2049, 445' }
        ],
        links: [
            { id: 'dl1', source: 'd1', target: 'd2' }, { id: 'dl2', source: 'd2', target: 'd3' },
            { id: 'dl3', source: 'd3', target: 'd4' }, { id: 'dl4', source: 'd3', target: 'd5' },
            { id: 'dl5', source: 'd4', target: 'd6' }, { id: 'dl6', source: 'd4', target: 'd7' }, { id: 'dl7', source: 'd4', target: 'd8', attachment: 'bridged' },
            { id: 'dl8', source: 'd5', target: 'd9' }, { id: 'dl9', source: 'd5', target: 'd10' }, { id: 'dl10', source: 'd5', target: 'd11' }, { id: 'dl11', source: 'd5', target: 'd12' },
            { id: 'dl12', source: 'd12', target: 'd13' }, { id: 'dl13', source: 'd12', target: 'd14' }, { id: 'dl14', source: 'd12', target: 'd15' }
        ]
    },
    hospital: {
        nodes: [
            { id: 'hp1', type: 'cloud', name: 'ISP', x: 400, y: 50, ips: [] },
            { id: 'hp2', type: 'firewall', name: 'Main Firewall', x: 400, y: 150, ips: ['10.10.0.1/16'], dns: '1.1.1.1' },
            { id: 'hp3', type: 'router', name: 'Core Router', x: 400, y: 250, ips: ['10.10.10.1/24', '192.168.100.1/24'], gw: '10.10.0.1' },
            { id: 'hp4', type: 'switch', name: 'Admin SW', x: 250, y: 350, portCount: 8, ips: [] },
            { id: 'hp5', type: 'server', name: 'EHR Server', x: 150, y: 450, ips: ['10.10.10.20/24'], gw: '10.10.10.1' },
            { id: 'hp6', type: 'pc', name: 'Nurse Desk', x: 250, y: 450, ips: ['10.10.10.50/24'], gw: '10.10.10.1' },
            { id: 'hp7', type: 'printer', name: 'Records Print', x: 350, y: 450, ips: ['10.10.10.80/24'], gw: '10.10.10.1' },
            { id: 'hp8', type: 'switch', name: 'Medical SW', x: 550, y: 350, portCount: 8, ips: [] },
            { id: 'hp9', type: 'dicom', name: 'PACS Archive', x: 450, y: 450, ips: ['192.168.100.10/24'] },
            { id: 'hp10', type: 'dicom', name: 'MRI Scanner', x: 550, y: 450, ips: ['192.168.100.11/24'] },
            { id: 'hp11', type: 'iot', name: 'Vitals Mon', x: 650, y: 450, ips: ['192.168.100.52/24'], gw: '192.168.100.1' }
        ],
        links: [{ id: 'hpl1', source: 'hp1', target: 'hp2' }, { id: 'hpl2', source: 'hp2', target: 'hp3' }, { id: 'hpl3', source: 'hp3', target: 'hp4' }, { id: 'hpl4', source: 'hp3', target: 'hp8' }, { id: 'hpl5', source: 'hp4', target: 'hp5' }, { id: 'hpl6', source: 'hp4', target: 'hp6' }, { id: 'hpl7', source: 'hp4', target: 'hp7' }, { id: 'hpl8', source: 'hp8', target: 'hp9' }, { id: 'hpl9', source: 'hp8', target: 'hp10' }, { id: 'hpl10', source: 'hp8', target: 'hp11' }]
    },
    campus: {
        nodes: [
            { id: 'c1', type: 'cloud', name: 'WAN', x: 400, y: 50, ips: [] },
            { id: 'c2', type: 'firewall', name: 'Campus Firewall', x: 400, y: 150, ips: ['10.0.0.1/16'], dns: '1.1.1.1' },
            { id: 'c3', type: 'router', name: 'Core Router', x: 400, y: 250, ips: ['10.0.1.1/24', '10.0.2.1/24', '172.20.0.1/24'], gw: '10.0.0.1' },
            { id: 'c4', type: 'switch', name: 'IT SW', x: 200, y: 350, portCount: 8, ips: [] },
            { id: 'c5', type: 'vm', name: 'Domain Controller', x: 150, y: 450, ips: ['10.0.1.10/24'], gw: '10.0.1.1' },
            { id: 'c6', type: 'pc', name: 'Admin PC', x: 250, y: 450, ips: ['10.0.1.50/24'], gw: '10.0.1.1' },
            { id: 'c7', type: 'switch', name: 'HR SW', x: 400, y: 350, portCount: 8, ips: [] },
            { id: 'c8', type: 'pc', name: 'HR Desktop', x: 400, y: 450, ips: ['10.0.2.50/24'], gw: '10.0.2.1' },
            { id: 'c9', type: 'ap', name: 'Guest AP', x: 600, y: 350, ips: [] },
            { id: 'c10', type: 'iot', name: 'Visitor Phone', x: 600, y: 450, ips: ['172.20.0.50/24'], gw: '172.20.0.1' }
        ],
        links: [{ id: 'cl1', source: 'c1', target: 'c2' }, { id: 'cl2', source: 'c2', target: 'c3' }, { id: 'cl3', source: 'c3', target: 'c4' }, { id: 'cl4', source: 'c3', target: 'c7' }, { id: 'cl5', source: 'c3', target: 'c9' }, { id: 'cl6', source: 'c4', target: 'c5' }, { id: 'cl7', source: 'c4', target: 'c6' }, { id: 'cl8', source: 'c7', target: 'c8' }, { id: 'cl9', source: 'c9', target: 'c10' }]
    },
    retail: {
        nodes: [
            { id: 'r1', type: 'cloud', name: 'ISP', x: 400, y: 50, ips: [] },
            { id: 'r2', type: 'router', name: 'Store Router', x: 400, y: 150, ips: ['192.168.5.1/24', '10.5.5.1/24'], gw: '0.0.0.0' },
            { id: 'r3', type: 'switch', name: 'Core SW', x: 400, y: 250, portCount: 8, ips: [] },
            { id: 'r4', type: 'switch', name: 'POS SW', x: 250, y: 350, portCount: 8, ips: [] },
            { id: 'r5', type: 'pc', name: 'Register 1', x: 150, y: 450, ips: ['192.168.5.10/24'], gw: '192.168.5.1' },
            { id: 'r6', type: 'pc', name: 'Register 2', x: 250, y: 450, ips: ['192.168.5.11/24'], gw: '192.168.5.1' },
            { id: 'r7', type: 'printer', name: 'Receipt Printer', x: 350, y: 450, ips: ['192.168.5.80/24'], gw: '192.168.5.1' },
            { id: 'r8', type: 'switch', name: 'CCTV SW', x: 550, y: 350, portCount: 8, ips: [] },
            { id: 'r9', type: 'server', name: 'NVR', x: 450, y: 450, ips: ['10.5.5.10/24'], gw: '10.5.5.1' },
            { id: 'r10', type: 'camera', name: 'Entrance Cam', x: 550, y: 450, ips: ['10.5.5.90/24'], gw: '10.5.5.1' },
            { id: 'r11', type: 'camera', name: 'Aisle Cam', x: 650, y: 450, ips: ['10.5.5.91/24'], gw: '10.5.5.1' }
        ],
        links: [{ id: 'rl1', source: 'r1', target: 'r2' }, { id: 'rl2', source: 'r2', target: 'r3' }, { id: 'rl3', source: 'r3', target: 'r4' }, { id: 'rl4', source: 'r3', target: 'r8' }, { id: 'rl5', source: 'r4', target: 'r5' }, { id: 'rl6', source: 'r4', target: 'r6' }, { id: 'rl7', source: 'r4', target: 'r7' }, { id: 'rl8', source: 'r8', target: 'r9' }, { id: 'rl9', source: 'r8', target: 'r10' }, { id: 'rl10', source: 'r8', target: 'r11' }]
    },
    factory: {
        nodes: [
            { id: 'f1', type: 'cloud', name: 'WAN', x: 400, y: 50, ips: [] },
            { id: 'f2', type: 'firewall', name: 'Plant Firewall', x: 400, y: 150, ips: ['10.20.0.1/16'], dns: '1.1.1.1' },
            { id: 'f3', type: 'router', name: 'Core Router', x: 400, y: 250, ips: ['10.20.10.1/24', '10.20.20.1/24'], gw: '10.20.0.1' },
            { id: 'f4', type: 'server', name: 'SCADA Master', x: 250, y: 350, ips: ['10.20.10.10/24'], gw: '10.20.10.1' },
            { id: 'f5', type: 'switch', name: 'Plant SW', x: 550, y: 350, portCount: 8, ips: [] },
            { id: 'f6', type: 'iot', name: 'PLC Controller 1', x: 450, y: 450, ips: ['10.20.20.50/24'], gw: '10.20.20.1' },
            { id: 'f7', type: 'iot', name: 'Robotic Arm 2', x: 550, y: 450, ips: ['10.20.20.51/24'], gw: '10.20.20.1' },
            { id: 'f8', type: 'camera', name: 'QA Cam', x: 650, y: 450, ips: ['10.20.20.90/24'], gw: '10.20.20.1' }
        ],
        links: [{ id: 'fl1', source: 'f1', target: 'f2' }, { id: 'fl2', source: 'f2', target: 'f3' }, { id: 'fl3', source: 'f3', target: 'f4' }, { id: 'fl4', source: 'f3', target: 'f5' }, { id: 'fl5', source: 'f5', target: 'f6' }, { id: 'fl6', source: 'f5', target: 'f7' }, { id: 'fl7', source: 'f5', target: 'f8' }]
    },
    studio: {
        nodes: [
            { id: 's1', type: 'cloud', name: 'Internet', x: 400, y: 50, ips: [] },
            { id: 's2', type: 'router', name: 'Gateway', x: 400, y: 150, ips: ['10.0.0.1/24'] },
            { id: 's3', type: 'switch', name: '10G Switch', x: 400, y: 250, portCount: 8, ips: [] },
            { id: 's4', type: 'server', name: 'NAS Storage', x: 200, y: 350, ips: ['10.0.0.10/24'], gw: '10.0.0.1' },
            { id: 's5', type: 'vm', name: 'Render Node (Passthrough)', x: 100, y: 450, ips: ['10.0.0.11/24'], gw: '10.0.0.1' },
            { id: 's6', type: 'pc', name: 'Edit Bay 1', x: 350, y: 350, ips: ['10.0.0.50/24'], gw: '10.0.0.1' },
            { id: 's7', type: 'pc', name: 'Edit Bay 2', x: 450, y: 350, ips: ['10.0.0.51/24'], gw: '10.0.0.1' },
            { id: 's8', type: 'camera', name: 'Studio Cam A', x: 550, y: 350, ips: ['10.0.0.90/24'], gw: '10.0.0.1' },
            { id: 's9', type: 'camera', name: 'Studio Cam B', x: 650, y: 350, ips: ['10.0.0.91/24'], gw: '10.0.0.1' }
        ],
        links: [{ id: 'sl1', source: 's1', target: 's2' }, { id: 'sl2', source: 's2', target: 's3' }, { id: 'sl3', source: 's3', target: 's4' }, { id: 'sl_pass', source: 's4', target: 's5', attachment: 'passthrough' }, { id: 'sl4', source: 's3', target: 's6' }, { id: 'sl5', source: 's3', target: 's7' }, { id: 'sl6', source: 's3', target: 's8' }, { id: 'sl7', source: 's3', target: 's9' }]
    },
    callcenter: {
        nodes: [
            { id: 'c1',  type: 'cloud',    name: 'Internet',           x: 460, y: 50,  ips: [] },
            { id: 'c2',  type: 'router',   name: 'CC Gateway',         x: 460, y: 155, nat: true, gw: '203.0.113.1', dns: '1.1.1.1', ips: ['203.0.113.2/30', '10.5.0.1/24'] },
            { id: 'c3',  type: 'firewall', name: 'Firewall / UTM',     x: 460, y: 260, nat: true, gw: '10.5.0.1', ips: ['10.5.0.2/24', '10.5.10.1/24', '10.5.20.1/24'], ports: '443, 22' },
            { id: 'c4',  type: 'switch',   name: 'Voice Switch',       x: 270, y: 370, portCount: 8, ips: [] },
            { id: 'c5',  type: 'switch',   name: 'Data Switch',        x: 640, y: 370, portCount: 8, ips: [] },
            { id: 'c6',  type: 'voip',     name: 'Agent Phone 1',      x: 110, y: 490, ips: ['10.5.10.61/24'], gw: '10.5.10.1', ports: '5060' },
            { id: 'c7',  type: 'voip',     name: 'Agent Phone 2',      x: 200, y: 490, ips: ['10.5.10.62/24'], gw: '10.5.10.1', ports: '5060' },
            { id: 'c8',  type: 'voip',     name: 'Agent Phone 3',      x: 290, y: 490, ips: ['10.5.10.63/24'], gw: '10.5.10.1', ports: '5060' },
            { id: 'c9',  type: 'voip',     name: 'Supervisor Phone',   x: 380, y: 490, ips: ['10.5.10.64/24'], gw: '10.5.10.1', ports: '5060' },
            { id: 'c10', type: 'custom',   name: 'PBX / Call Manager', x: 245, y: 600, ips: ['10.5.10.10/24'], gw: '10.5.10.1', ports: '5060, 5061' },
            { id: 'c11', type: 'pc',       name: 'Agent PC 1',         x: 500, y: 490, ips: ['10.5.20.51/24'], gw: '10.5.20.1' },
            { id: 'c12', type: 'pc',       name: 'Agent PC 2',         x: 590, y: 490, ips: ['10.5.20.52/24'], gw: '10.5.20.1' },
            { id: 'c13', type: 'pc',       name: 'Supervisor PC',      x: 680, y: 490, ips: ['10.5.20.53/24'], gw: '10.5.20.1' },
            { id: 'c14', type: 'server',   name: 'CRM / Recording',    x: 560, y: 600, ips: ['10.5.20.10/24'], gw: '10.5.20.1', ports: '80, 443, 5432' },
            { id: 'c15', type: 'printer',  name: 'Office Printer',     x: 660, y: 600, ips: ['10.5.20.80/24'], gw: '10.5.20.1', ports: '9100' }
        ],
        links: [
            { id: 'cl1', source: 'c1', target: 'c2' }, { id: 'cl2', source: 'c2', target: 'c3' },
            { id: 'cl3', source: 'c3', target: 'c4' }, { id: 'cl4', source: 'c3', target: 'c5' },
            { id: 'cl5', source: 'c4', target: 'c6' }, { id: 'cl6', source: 'c4', target: 'c7' }, { id: 'cl7', source: 'c4', target: 'c8' }, { id: 'cl8', source: 'c4', target: 'c9' }, { id: 'cl9', source: 'c4', target: 'c10' },
            { id: 'cl10', source: 'c5', target: 'c11' }, { id: 'cl11', source: 'c5', target: 'c12' }, { id: 'cl12', source: 'c5', target: 'c13' }, { id: 'cl13', source: 'c5', target: 'c14' }, { id: 'cl14', source: 'c5', target: 'c15' }
        ]
    },
    // A real mixed-use building — hospital, studio, office and call-center
    // tenants on-site, plus a branch office and a home both linked back over
    // VPN. Exercises every node type, NAT, and the VPN overlay.
    showcase: {
        nodes: [
            // --- Building edge / core ---
            { id: 'net',  type: 'cloud',        name: 'Internet',            x: 820,  y: 40,  ips: [] },
            { id: 'edge', type: 'edge',         name: 'Building Edge GW',    x: 420,  y: 150, nat: true, gw: '203.0.113.1', dns: '1.1.1.1', ips: ['203.0.113.2/30', '198.51.100.6/30', '10.0.0.1/24'] },
            { id: 'vpn',  type: 'vpn',          name: 'VPN Concentrator',    x: 820,  y: 150, nat: true, gw: '203.0.113.9', dns: '1.1.1.1', ips: ['203.0.113.10/30', '10.0.0.3/24'], ports: '443, 500, 4500' },
            { id: 'fw',   type: 'firewall',     name: 'Core Firewall',       x: 420,  y: 270, nat: true, gw: '10.0.0.1', dns: '1.1.1.1', ips: ['10.0.0.2/24', '10.10.0.1/24', '10.20.0.1/24'], ports: '443, 22' },
            { id: 'l3',   type: 'l3switch',     name: 'Core Distribution',   x: 300,  y: 390, gw: '10.10.0.1', ips: ['10.10.0.2/24', '10.10.10.1/24', '10.10.20.1/24', '10.10.30.1/24', '10.10.40.1/24'] },
            { id: 'lb',   type: 'loadbalancer', name: 'Web Load Balancer',   x: 640,  y: 390, nat: true, gw: '10.20.0.1', ips: ['10.20.0.5/24', '10.30.0.1/24'], ports: '80, 443' },
            // --- Server farm (behind the LB) ---
            { id: 'as',   type: 'server',       name: 'App Server',          x: 560,  y: 510, gw: '10.30.0.1', ports: '80, 443',
              // Two subnets, not one: this is multi-homing done right — compare the
              // PACS server in the Common Errors template.
              interfaces: [{ id: 'a1', name: 'eth0', ip: '10.30.0.11/24' }, { id: 'a2', name: 'eth1', ip: '10.31.0.11/24' }, { id: 'a3', name: 'eth2', ip: '' }] },
            { id: 'pvm',  type: 'vm',           name: 'GPU VM (passthrough)', x: 620, y: 630, ips: ['10.30.0.14/24'], gw: '10.30.0.1' },
            { id: 'bsw',  type: 'switch',       name: 'Storage Switch',      x: 780,  y: 630, portCount: 8, ips: [] },
            { id: 'nas',  type: 'server',       name: 'NAS',                 x: 780,  y: 730, ips: ['10.31.0.10/24'], ports: '2049, 445' },
            { id: 'wvm',  type: 'vm',           name: 'Web VM',              x: 650,  y: 510, ips: ['10.30.0.12/24'], gw: '10.30.0.1' },
            { id: 'ctr',  type: 'container',    name: 'API Container',       x: 740,  y: 510, ips: ['10.30.0.13/24'], gw: '10.30.0.1', ports: '8080' },
            // --- Hospital tenant (VLAN 10) ---
            { id: 'hsw',  type: 'switch',       name: 'Hospital Switch',     x: 90,   y: 510, portCount: 8,  ips: [] },
            { id: 'dcm',  type: 'dicom',        name: 'CT Modality',         x: 40,   y: 630, ips: ['10.10.10.20/24'], gw: '10.10.10.1', ports: '104' },
            { id: 'pacs', type: 'server',       name: 'PACS Server',         x: 130,  y: 630, ips: ['10.10.10.10/24'], gw: '10.10.10.1', ports: '104, 11112' },
            { id: 'radpc',type: 'pc',           name: 'Radiology WS',        x: 40,   y: 730, ips: ['10.10.10.50/24'], gw: '10.10.10.1' },
            { id: 'wcam', type: 'camera',       name: 'Ward Camera',         x: 130,  y: 730, ips: ['10.10.10.90/24'], gw: '10.10.10.1', ports: '554' },
            // --- Studio tenant (VLAN 20) ---
            { id: 'ssw',  type: 'switch',       name: 'Studio Switch',       x: 250,  y: 510, portCount: 8,  ips: [] },
            { id: 'scam', type: 'camera',       name: 'Studio Cam',          x: 210,  y: 630, ips: ['10.10.20.90/24'], gw: '10.10.20.1', ports: '554' },
            { id: 'epc',  type: 'pc',           name: 'Edit Bay',            x: 300,  y: 630, ips: ['10.10.20.50/24'], gw: '10.10.20.1' },
            // --- On-site office tenant (VLAN 30, wireless) ---
            { id: 'oap',  type: 'ap',           name: 'Office WiFi',         x: 440,  y: 510, ips: [] },
            { id: 'opc',  type: 'pc',           name: 'Office WS',           x: 380,  y: 630, gw: '10.10.30.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.10.30.50/24' }] },
            { id: 'opr',  type: 'printer',      name: 'Office Printer',      x: 470,  y: 630, gw: '10.10.30.1', ports: '9100', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.10.30.80/24' }] },
            { id: 'oph',  type: 'voip',         name: 'Desk Phone',          x: 400,  y: 730, gw: '10.10.30.1', ports: '5060', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.10.30.60/24' }] },
            { id: 'osen', type: 'iot',          name: 'Smart Sensor',        x: 490,  y: 730, gw: '10.10.30.1', ports: '1883', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.10.30.100/24' }] },
            // --- Call center tenant (VLAN 40) ---
            { id: 'csw',  type: 'switch',       name: 'Call Center Switch',  x: 940,  y: 510, portCount: 24, ips: [] },
            { id: 'cp1',  type: 'voip',         name: 'Agent Phone 1',       x: 860,  y: 630, ips: ['10.10.40.61/24'], gw: '10.10.40.1', ports: '5060' },
            { id: 'cp2',  type: 'voip',         name: 'Agent Phone 2',       x: 950,  y: 630, ips: ['10.10.40.62/24'], gw: '10.10.40.1', ports: '5060' },
            { id: 'capc', type: 'pc',           name: 'Agent WS',            x: 1040, y: 630, ips: ['10.10.40.50/24'], gw: '10.10.40.1' },
            { id: 'pbx',  type: 'custom',       name: 'PBX Controller',      x: 940,  y: 730, ips: ['10.10.40.10/24'], gw: '10.10.40.1', ports: '5060' },
            // --- Branch office (over VPN) ---
            { id: 'ro',   type: 'router',       name: 'Branch Office GW',    x: 1180, y: 150, nat: true, gw: '198.51.100.9', ips: ['198.51.100.10/30', '172.16.5.1/24'] },
            { id: 'rsw',  type: 'switch',       name: 'Branch Switch',       x: 1180, y: 270, portCount: 8,  ips: [] },
            { id: 'rmtpc',type: 'pc',           name: 'Branch WS',           x: 1130, y: 390, ips: ['172.16.5.50/24'], gw: '172.16.5.1' },
            { id: 'rpr',  type: 'printer',      name: 'Branch Printer',      x: 1230, y: 390, ips: ['172.16.5.80/24'], gw: '172.16.5.1', ports: '9100' },
            // --- Home (over VPN) ---
            { id: 'hm',   type: 'router',       name: 'Home Router (VPN)',   x: 1460, y: 150, nat: true, gw: '198.51.100.13', ips: ['198.51.100.14/30', '192.168.1.1/24'] },
            { id: 'hpc',  type: 'pc',           name: 'Home PC',             x: 1410, y: 270, ips: ['192.168.1.50/24'], gw: '192.168.1.1' },
            { id: 'hiot', type: 'iot',          name: 'Smart Home Hub',      x: 1510, y: 270, ips: ['192.168.1.100/24'], gw: '192.168.1.1', ports: '1883' }
        ],
        links: [
            { id: 'k1',  source: 'net', target: 'edge' }, { id: 'k2', source: 'net', target: 'vpn' },
            { id: 'k3',  source: 'net', target: 'ro' },   { id: 'k4', source: 'net', target: 'hm' },
            { id: 'kv1', source: 'vpn', target: 'ro', medium: 'vpn' }, { id: 'kv2', source: 'vpn', target: 'hm', medium: 'vpn' },
            { id: 'k5',  source: 'edge', target: 'fw', medium: 'fiber' },  { id: 'k6', source: 'edge', target: 'vpn' },
            { id: 'k7',  source: 'fw', target: 'l3' },    { id: 'k7b', source: 'fw', target: 'l3' },  { id: 'k8', source: 'fw', target: 'lb' },
            { id: 'k9',  source: 'lb', target: 'as' },    { id: 'k10', source: 'lb', target: 'wvm', attachment: 'bridged' }, { id: 'k11', source: 'lb', target: 'ctr', attachment: 'bridged' },
            { id: 'k12', source: 'l3', target: 'hsw' },   { id: 'k13', source: 'l3', target: 'ssw' }, { id: 'k14', source: 'l3', target: 'oap' }, { id: 'k15', source: 'l3', target: 'csw' },
            { id: 'k16', source: 'hsw', target: 'dcm' },  { id: 'k17', source: 'hsw', target: 'pacs' }, { id: 'k18', source: 'hsw', target: 'radpc' }, { id: 'k19', source: 'hsw', target: 'wcam' },
            { id: 'k20', source: 'ssw', target: 'scam' }, { id: 'k21', source: 'ssw', target: 'epc' },
            { id: 'k22', source: 'oap', target: 'opc', medium: 'wireless' }, { id: 'k23', source: 'oap', target: 'opr', medium: 'wireless' }, { id: 'k24', source: 'oap', target: 'oph', medium: 'wireless' }, { id: 'k25', source: 'oap', target: 'osen', medium: 'wireless' },
            { id: 'k26', source: 'csw', target: 'cp1' },  { id: 'k27', source: 'csw', target: 'cp2' }, { id: 'k28', source: 'csw', target: 'capc' }, { id: 'k29', source: 'csw', target: 'pbx' },
            { id: 'k30', source: 'ro', target: 'rsw' },   { id: 'k31', source: 'rsw', target: 'rmtpc' }, { id: 'k32', source: 'rsw', target: 'rpr' },
            { id: 'k33', source: 'hm', target: 'hpc' },   { id: 'k34', source: 'hm', target: 'hiot', medium: 'powerline' },
            { id: 'k35', source: 'as', target: 'bsw', sourceIface: 'a2' }, { id: 'k36', source: 'bsw', target: 'nas' },
            { id: 'k37', source: 'as', target: 'pvm', sourceIface: 'a3', attachment: 'passthrough' }
        ]
    },
    // --- Industry templates -------------------------------------------------
    // Interfaces are named and bound explicitly on the L3 downlinks: an L3 switch
    // has several same-priority interfaces, and letting auto-bind guess which VLAN
    // a cable lands on is a coin flip once more than one is free.
    imaging: {
        nodes: [
            { id: 'i_net', type: 'cloud',  name: 'Internet',            x: 480, y: 40,  ips: [] },
            { id: 'i_rtr', type: 'router', name: 'Clinic Gateway',      x: 340, y: 150, nat: true, gw: '203.0.113.1', dns: '1.1.1.1', ports: '22',
              interfaces: [{ id: 'w', name: 'eth0', ip: '203.0.113.2/30' }, { id: 'l', name: 'eth1', ip: '10.60.0.1/24' }] },
            { id: 'i_vpn', type: 'vpn',    name: 'Teleradiology VPN',   x: 720, y: 150, nat: true, gw: '203.0.113.5', dns: '1.1.1.1', ports: '443, 500, 4500',
              interfaces: [{ id: 'w', name: 'wan', ip: '203.0.113.6/30' }, { id: 'c', name: 'lan', ip: '10.60.0.3/24' }, { id: 't', name: 'tun0', ip: '10.60.30.1/24' }] },
            { id: 'i_l3',  type: 'l3switch', name: 'Core L3',           x: 480, y: 270, gw: '10.60.0.1', dns: '1.1.1.1', ports: '22',
              interfaces: [{ id: 'c', name: 'vlan1', ip: '10.60.0.2/24' }, { id: 'm', name: 'vlan10', ip: '10.60.10.1/24' }, { id: 'o', name: 'vlan20', ip: '10.60.20.1/24' }] },
            { id: 'i_msw', type: 'switch', name: 'Modality Switch',     x: 300, y: 390, portCount: 16, ips: [] },
            { id: 'i_osw', type: 'switch', name: 'Reading Room Switch', x: 700, y: 390, portCount: 8, ips: [] },
            { id: 'i_ct',  type: 'dicom',  name: 'CT Scanner',          x: 120, y: 510, ips: ['10.60.10.20/24'], gw: '10.60.10.1', ports: '104' },
            { id: 'i_mr',  type: 'dicom',  name: 'MRI',                 x: 220, y: 510, ips: ['10.60.10.21/24'], gw: '10.60.10.1', ports: '104' },
            { id: 'i_us',  type: 'dicom',  name: 'Ultrasound',          x: 320, y: 510, ips: ['10.60.10.22/24'], gw: '10.60.10.1', ports: '104' },
            { id: 'i_cr',  type: 'dicom',  name: 'CR / DX',             x: 420, y: 510, ips: ['10.60.10.23/24'], gw: '10.60.10.1', ports: '104' },
            { id: 'i_pacs',type: 'server', name: 'PACS Server',         x: 170, y: 630, ips: ['10.60.10.10/24'], gw: '10.60.10.1', ports: '104, 11112, 443' },
            { id: 'i_vna', type: 'server', name: 'VNA Archive',         x: 290, y: 630, ips: ['10.60.10.11/24'], gw: '10.60.10.1', ports: '104, 11112' },
            { id: 'i_prn', type: 'printer',name: 'DICOM Film Printer',  x: 410, y: 630, ips: ['10.60.10.80/24'], gw: '10.60.10.1', ports: '104' },
            { id: 'i_ris', type: 'server', name: 'RIS / Worklist',      x: 600, y: 510, ips: ['10.60.20.10/24'], gw: '10.60.20.1', ports: '80, 443' },
            { id: 'i_ws1', type: 'pc',     name: 'Reading WS 1',        x: 700, y: 510, ips: ['10.60.20.50/24'], gw: '10.60.20.1' },
            { id: 'i_ws2', type: 'pc',     name: 'Reading WS 2',        x: 800, y: 510, ips: ['10.60.20.51/24'], gw: '10.60.20.1' },
            { id: 'i_rad', type: 'pc',     name: 'Remote Radiologist',  x: 920, y: 270, ips: ['10.60.30.50/24'], gw: '10.60.30.1' }
        ],
        links: [
            { id: 'im1', source: 'i_net', target: 'i_rtr', targetIface: 'w' },
            { id: 'im2', source: 'i_net', target: 'i_vpn', targetIface: 'w' },
            { id: 'im3', source: 'i_rtr', target: 'i_l3', sourceIface: 'l', targetIface: 'c' },
            { id: 'im4', source: 'i_vpn', target: 'i_l3', sourceIface: 'c', targetIface: 'c' },
            { id: 'im5', source: 'i_l3', target: 'i_msw', sourceIface: 'm', targetIface: 'p1' },
            { id: 'im6', source: 'i_l3', target: 'i_osw', sourceIface: 'o', targetIface: 'p1' },
            { id: 'im7', source: 'i_msw', target: 'i_ct', sourceIface: 'p2' },
            { id: 'im8', source: 'i_msw', target: 'i_mr', sourceIface: 'p3' },
            { id: 'im9', source: 'i_msw', target: 'i_us', sourceIface: 'p4' },
            { id: 'im10', source: 'i_msw', target: 'i_cr', sourceIface: 'p5' },
            { id: 'im11', source: 'i_msw', target: 'i_pacs', sourceIface: 'p6' },
            { id: 'im12', source: 'i_msw', target: 'i_prn', sourceIface: 'p7' },
            // Whole-study retrieval off the archive is the one link worth fibre.
            { id: 'im13', source: 'i_msw', target: 'i_vna', sourceIface: 'p8', medium: 'fiber' },
            { id: 'im14', source: 'i_osw', target: 'i_ris', sourceIface: 'p2' },
            { id: 'im15', source: 'i_osw', target: 'i_ws1', sourceIface: 'p3' },
            { id: 'im16', source: 'i_osw', target: 'i_ws2', sourceIface: 'p4' },
            { id: 'im17', source: 'i_vpn', target: 'i_rad', sourceIface: 't', medium: 'vpn' }
        ]
    },
    hotel: {
        nodes: [
            { id: 'h_net', type: 'cloud', name: 'Internet',        x: 480, y: 40,  ips: [] },
            { id: 'h_edge',type: 'edge',  name: 'Hotel Edge GW',   x: 480, y: 150, nat: true, gw: '198.51.100.1', dns: '1.1.1.1', ports: '443',
              interfaces: [{ id: 'w', name: 'wan0', ip: '198.51.100.2/30' }, { id: 'l', name: 'lan', ip: '10.70.0.1/24' }] },
            { id: 'h_l3',  type: 'l3switch', name: 'Core L3',      x: 480, y: 270, gw: '10.70.0.1', ports: '22',
              interfaces: [{ id: 'c', name: 'vlan1', ip: '10.70.0.2/24' }, { id: 's', name: 'vlan10', ip: '10.70.10.1/24' }, { id: 'g', name: 'vlan20', ip: '10.70.20.1/24' }, { id: 'b', name: 'vlan30', ip: '10.70.30.1/24' }] },
            { id: 'h_ssw', type: 'switch', name: 'Staff Switch',   x: 200, y: 390, portCount: 8, ips: [] },
            { id: 'h_pms', type: 'server', name: 'PMS Server',     x: 120, y: 510, ips: ['10.70.10.10/24'], gw: '10.70.10.1', ports: '443, 1433' },
            { id: 'h_rec', type: 'pc',     name: 'Reception WS',   x: 230, y: 510, ips: ['10.70.10.50/24'], gw: '10.70.10.1' },
            { id: 'h_ph',  type: 'voip',   name: 'Front Desk Phone', x: 340, y: 510, ips: ['10.70.10.60/24'], gw: '10.70.10.1', ports: '5060' },
            { id: 'h_ap1', type: 'ap',     name: 'Guest AP – Floor 1', x: 480, y: 390, ips: [] },
            { id: 'h_ap2', type: 'ap',     name: 'Guest AP – Floor 2', x: 620, y: 390, ips: [] },
            { id: 'h_gl',  type: 'pc',     name: 'Guest Laptop',   x: 450, y: 520, gw: '10.70.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.70.20.101/24' }] },
            { id: 'h_gp',  type: 'iot',    name: 'Guest Phone',    x: 640, y: 520, gw: '10.70.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.70.20.102/24' }] },
            { id: 'h_bsw', type: 'switch', name: 'Building Switch', x: 820, y: 390, portCount: 16, ips: [] },
            { id: 'h_tv',  type: 'iot',    name: 'Room IPTV',      x: 740, y: 510, ips: ['10.70.30.20/24'], gw: '10.70.30.1', ports: '554' },
            { id: 'h_lock',type: 'iot',    name: 'Door Lock Hub',  x: 850, y: 510, ips: ['10.70.30.30/24'], gw: '10.70.30.1', ports: '1883' },
            { id: 'h_cam', type: 'camera', name: 'Lobby Camera',   x: 960, y: 510, ips: ['10.70.30.90/24'], gw: '10.70.30.1', ports: '554' }
        ],
        links: [
            { id: 'ho1', source: 'h_net', target: 'h_edge', targetIface: 'w' },
            { id: 'ho2', source: 'h_edge', target: 'h_l3', sourceIface: 'l', targetIface: 'c' },
            { id: 'ho3', source: 'h_l3', target: 'h_ssw', sourceIface: 's', targetIface: 'p1' },
            { id: 'ho4', source: 'h_ssw', target: 'h_pms', sourceIface: 'p2' },
            { id: 'ho5', source: 'h_ssw', target: 'h_rec', sourceIface: 'p3' },
            { id: 'ho6', source: 'h_ssw', target: 'h_ph', sourceIface: 'p4' },
            // Both APs hang off the one guest VLAN interface — the routing-device
            // exemption is what makes that legal rather than a double-booked port.
            { id: 'ho7', source: 'h_l3', target: 'h_ap1', sourceIface: 'g', targetIface: 'p1' },
            { id: 'ho8', source: 'h_l3', target: 'h_ap2', sourceIface: 'g', targetIface: 'p1' },
            { id: 'ho9', source: 'h_ap1', target: 'h_gl', medium: 'wireless' },
            { id: 'ho10', source: 'h_ap2', target: 'h_gp', medium: 'wireless' },
            { id: 'ho11', source: 'h_l3', target: 'h_bsw', sourceIface: 'b', targetIface: 'p1' },
            { id: 'ho12', source: 'h_bsw', target: 'h_tv', sourceIface: 'p2' },
            { id: 'ho13', source: 'h_bsw', target: 'h_lock', sourceIface: 'p3' },
            { id: 'ho14', source: 'h_bsw', target: 'h_cam', sourceIface: 'p4' }
        ]
    },
    vessel: {
        nodes: [
            { id: 'v_sat', type: 'cloud',  name: 'VSAT / LEO Uplink', x: 480, y: 40, ips: [] },
            { id: 'v_mdm', type: 'router', name: 'Satellite Modem',   x: 480, y: 150, nat: true, gw: '100.64.0.1',
              interfaces: [{ id: 'w', name: 'wan0', ip: '100.64.0.2/30' }, { id: 'l', name: 'lan', ip: '172.20.0.1/24' }] },
            { id: 'v_fw',  type: 'firewall', name: 'Vessel Firewall', x: 480, y: 270, nat: true, gw: '172.20.0.1', dns: '1.1.1.1', ports: '443, 22',
              interfaces: [{ id: 'w', name: 'igb0', ip: '172.20.0.2/24' }, { id: 'n', name: 'igb1', ip: '172.20.10.1/24' }, { id: 'o', name: 'igb2', ip: '172.20.20.1/24' }, { id: 'c', name: 'igb3', ip: '172.20.30.1/24' }] },
            { id: 'v_nsw', type: 'switch', name: 'Bridge Switch',     x: 220, y: 390, portCount: 8, ips: [] },
            { id: 'v_ecd', type: 'custom', name: 'ECDIS (Charts)',    x: 120, y: 510, ips: ['172.20.10.20/24'], gw: '172.20.10.1' },
            { id: 'v_rdr', type: 'custom', name: 'Radar',             x: 230, y: 510, ips: ['172.20.10.21/24'], gw: '172.20.10.1' },
            { id: 'v_ais', type: 'iot',    name: 'AIS Transponder',   x: 340, y: 510, ips: ['172.20.10.22/24'], gw: '172.20.10.1' },
            { id: 'v_osw', type: 'switch', name: 'Engine Room Switch', x: 560, y: 390, portCount: 8, ips: [] },
            { id: 'v_scd', type: 'custom', name: 'Engine SCADA',      x: 490, y: 510, ips: ['172.20.20.10/24'], gw: '172.20.20.1', ports: '502' },
            { id: 'v_plc', type: 'iot',    name: 'Engine PLC',        x: 600, y: 510, ips: ['172.20.20.20/24'], gw: '172.20.20.1', ports: '502' },
            { id: 'v_ap',  type: 'ap',     name: 'Crew Wi-Fi',        x: 820, y: 390, ips: [] },
            { id: 'v_cph', type: 'iot',    name: 'Crew Phone',        x: 820, y: 520, gw: '172.20.30.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '172.20.30.101/24' }] }
        ],
        links: [
            { id: 've1', source: 'v_sat', target: 'v_mdm', targetIface: 'w' },
            { id: 've2', source: 'v_mdm', target: 'v_fw', sourceIface: 'l', targetIface: 'w' },
            { id: 've3', source: 'v_fw', target: 'v_nsw', sourceIface: 'n', targetIface: 'p1' },
            { id: 've4', source: 'v_nsw', target: 'v_ecd', sourceIface: 'p2' },
            { id: 've5', source: 'v_nsw', target: 'v_rdr', sourceIface: 'p3' },
            { id: 've6', source: 'v_nsw', target: 'v_ais', sourceIface: 'p4' },
            { id: 've7', source: 'v_fw', target: 'v_osw', sourceIface: 'o', targetIface: 'p1' },
            { id: 've8', source: 'v_osw', target: 'v_scd', sourceIface: 'p2' },
            { id: 've9', source: 'v_osw', target: 'v_plc', sourceIface: 'p3' },
            { id: 've10', source: 'v_fw', target: 'v_ap', sourceIface: 'c', targetIface: 'p1' },
            { id: 've11', source: 'v_ap', target: 'v_cph', medium: 'wireless' }
        ]
    },
    warehouse: {
        nodes: [
            { id: 'wh_net', type: 'cloud',  name: 'Internet',       x: 480, y: 40,  ips: [] },
            { id: 'wh_rtr', type: 'router', name: 'Site Router',    x: 480, y: 150, nat: true, gw: '203.0.113.9', dns: '1.1.1.1',
              interfaces: [{ id: 'w', name: 'eth0', ip: '203.0.113.10/30' }, { id: 'l', name: 'eth1', ip: '10.80.0.1/24' }] },
            { id: 'wh_l3',  type: 'l3switch', name: 'Core L3',      x: 480, y: 270, gw: '10.80.0.1', ports: '22',
              interfaces: [{ id: 'c', name: 'vlan1', ip: '10.80.0.2/24' }, { id: 'd', name: 'vlan10', ip: '10.80.10.1/24' }, { id: 'r', name: 'vlan20', ip: '10.80.20.1/24' }] },
            { id: 'wh_osw', type: 'switch', name: 'Office Switch',  x: 240, y: 390, portCount: 8, ips: [] },
            { id: 'wh_wms', type: 'server', name: 'WMS Server',     x: 130, y: 510, ips: ['10.80.10.10/24'], gw: '10.80.10.1', ports: '443, 8080' },
            { id: 'wh_ofc', type: 'pc',     name: 'Office WS',      x: 240, y: 510, ips: ['10.80.10.50/24'], gw: '10.80.10.1' },
            { id: 'wh_lp',  type: 'printer',name: 'Label Printer',  x: 350, y: 510, ips: ['10.80.10.80/24'], gw: '10.80.10.1', ports: '9100' },
            { id: 'wh_ap1', type: 'ap',     name: 'Aisle AP 1',     x: 600, y: 390, ips: [] },
            { id: 'wh_ap2', type: 'ap',     name: 'Aisle AP 2',     x: 800, y: 390, ips: [] },
            { id: 'wh_h1',  type: 'iot',    name: 'Handheld Scanner 1', x: 540, y: 520, gw: '10.80.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.80.20.101/24' }] },
            { id: 'wh_h2',  type: 'iot',    name: 'Handheld Scanner 2', x: 670, y: 520, gw: '10.80.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.80.20.102/24' }] },
            { id: 'wh_fl',  type: 'iot',    name: 'Forklift Terminal',  x: 810, y: 520, gw: '10.80.20.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.80.20.103/24' }] }
        ],
        links: [
            { id: 'wa1', source: 'wh_net', target: 'wh_rtr', targetIface: 'w' },
            { id: 'wa2', source: 'wh_rtr', target: 'wh_l3', sourceIface: 'l', targetIface: 'c' },
            { id: 'wa3', source: 'wh_l3', target: 'wh_osw', sourceIface: 'd', targetIface: 'p1' },
            { id: 'wa4', source: 'wh_osw', target: 'wh_wms', sourceIface: 'p2' },
            { id: 'wa5', source: 'wh_osw', target: 'wh_ofc', sourceIface: 'p3' },
            { id: 'wa6', source: 'wh_osw', target: 'wh_lp', sourceIface: 'p4' },
            { id: 'wa7', source: 'wh_l3', target: 'wh_ap1', sourceIface: 'r', targetIface: 'p1' },
            { id: 'wa8', source: 'wh_l3', target: 'wh_ap2', sourceIface: 'r', targetIface: 'p1' },
            { id: 'wa9', source: 'wh_ap1', target: 'wh_h1', medium: 'wireless' },
            { id: 'wa10', source: 'wh_ap1', target: 'wh_h2', medium: 'wireless' },
            { id: 'wa11', source: 'wh_ap2', target: 'wh_fl', medium: 'wireless' }
        ]
    },
    // Two enclaves that never touch. The unclassified side reaches its own WAN
    // and the classified side reaches its own through an inline Type 1 encryptor;
    // there is deliberately no link, no shared subnet and no shared switch between
    // them. Trace from either side and the other simply is not there — which is the
    // whole point of the drawing.
    military: {
        nodes: [
            // --- Unclassified enclave -----------------------------------------
            { id: 'm_net',  type: 'cloud', name: 'DISA NIPRNet',       x: 400,  y: 40,  ips: ['203.0.113.17/30'] },
            { id: 'm_edge', type: 'edge',  name: 'Base Boundary',      x: 400,  y: 150, nat: true, gw: '203.0.113.17', dns: '1.1.1.1', ports: '443',
              interfaces: [{ id: 'w', name: 'wan0', ip: '203.0.113.18/30' }, { id: 'l', name: 'lan', ip: '10.90.0.1/24' }] },
            { id: 'm_fw',   type: 'firewall', name: 'NIPR Firewall',   x: 400,  y: 270, nat: true, gw: '10.90.0.1', dns: '1.1.1.1', ports: '443, 22',
              interfaces: [{ id: 'w', name: 'igb0', ip: '10.90.0.2/24' }, { id: 'a', name: 'igb1', ip: '10.90.10.1/24' }, { id: 'b', name: 'igb2', ip: '10.90.20.1/24' }, { id: 'c', name: 'igb3', ip: '10.90.30.1/24' }] },
            { id: 'm_hqsw', type: 'switch', name: 'HQ Switch',         x: 140,  y: 390, portCount: 24, ips: [] },
            { id: 'm_hq1',  type: 'pc',     name: 'Command WS',        x: 40,   y: 520, ips: ['10.90.10.50/24'], gw: '10.90.10.1' },
            { id: 'm_hq2',  type: 'pc',     name: 'Admin WS',          x: 140,  y: 520, ips: ['10.90.10.51/24'], gw: '10.90.10.1' },
            { id: 'm_c2',   type: 'server', name: 'Ops / C2 Server',   x: 240,  y: 520, ips: ['10.90.10.10/24'], gw: '10.90.10.1', ports: '443, 22' },
            { id: 'm_lgsw', type: 'switch', name: 'Logistics Switch',  x: 400,  y: 390, portCount: 8, ips: [] },
            { id: 'm_log',  type: 'server', name: 'Logistics Server',  x: 360,  y: 520, ips: ['10.90.20.10/24'], gw: '10.90.20.1', ports: '443' },
            { id: 'm_prn',  type: 'printer', name: 'Logistics Printer', x: 460, y: 520, ips: ['10.90.20.80/24'], gw: '10.90.20.1', ports: '9100' },
            { id: 'm_scsw', type: 'switch', name: 'Perimeter Switch',  x: 680,  y: 390, portCount: 16, ips: [] },
            { id: 'm_gate', type: 'custom', name: 'Gate Access Control', x: 580, y: 520, ips: ['10.90.30.20/24'], gw: '10.90.30.1', ports: '443' },
            { id: 'm_cm1',  type: 'camera', name: 'Perimeter Cam N',   x: 680,  y: 520, ips: ['10.90.30.91/24'], gw: '10.90.30.1', ports: '554' },
            { id: 'm_cm2',  type: 'camera', name: 'Perimeter Cam S',   x: 780,  y: 520, ips: ['10.90.30.92/24'], gw: '10.90.30.1', ports: '554' },
            { id: 'm_ap',   type: 'ap',     name: 'Motor Pool Wi-Fi',  x: 900,  y: 390, ips: [] },
            { id: 'm_hh',   type: 'iot',    name: 'Motor Pool Handheld', x: 900, y: 520, gw: '10.90.30.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.90.30.101/24' }] },

            // --- Classified enclave: no path to anything above -----------------
            { id: 'm_snet', type: 'cloud', name: 'DISA SIPRNet',       x: 1260, y: 40,  ips: ['198.51.100.17/30'] },
            // ct = ciphertext (black) side, pt = plaintext (red) side.
            { id: 'm_tac',  type: 'vpn',   name: 'TACLANE (Type 1 INE)', x: 1260, y: 150, gw: '198.51.100.17', ports: '500, 4500',
              interfaces: [{ id: 'ct', name: 'ct', ip: '198.51.100.18/30' }, { id: 'pt', name: 'pt', ip: '10.91.0.1/24' }] },
            { id: 'm_scif', type: 'switch', name: 'SCIF Switch',       x: 1260, y: 270, portCount: 8, ips: [] },
            { id: 'm_sw1',  type: 'pc',     name: 'SIPR WS 1',         x: 1160, y: 400, ips: ['10.91.0.50/24'], gw: '10.91.0.1' },
            { id: 'm_sw2',  type: 'pc',     name: 'SIPR WS 2',         x: 1260, y: 400, ips: ['10.91.0.51/24'], gw: '10.91.0.1' },
            { id: 'm_ssrv', type: 'server', name: 'Classified Server', x: 1360, y: 400, ips: ['10.91.0.10/24'], gw: '10.91.0.1', ports: '445' }
        ],
        links: [
            { id: 'ml1', source: 'm_net', target: 'm_edge', targetIface: 'w' },
            { id: 'ml2', source: 'm_edge', target: 'm_fw', sourceIface: 'l', targetIface: 'w' },
            // Building-to-building backbone runs on fibre.
            { id: 'ml3', source: 'm_fw', target: 'm_hqsw', sourceIface: 'a', targetIface: 'p1', medium: 'fiber' },
            { id: 'ml4', source: 'm_hqsw', target: 'm_hq1', sourceIface: 'p2' },
            { id: 'ml5', source: 'm_hqsw', target: 'm_hq2', sourceIface: 'p3' },
            { id: 'ml6', source: 'm_hqsw', target: 'm_c2', sourceIface: 'p4' },
            { id: 'ml7', source: 'm_fw', target: 'm_lgsw', sourceIface: 'b', targetIface: 'p1', medium: 'fiber' },
            { id: 'ml8', source: 'm_lgsw', target: 'm_log', sourceIface: 'p2' },
            { id: 'ml9', source: 'm_lgsw', target: 'm_prn', sourceIface: 'p3' },
            { id: 'ml10', source: 'm_fw', target: 'm_scsw', sourceIface: 'c', targetIface: 'p1', medium: 'fiber' },
            { id: 'ml11', source: 'm_scsw', target: 'm_gate', sourceIface: 'p2' },
            { id: 'ml12', source: 'm_scsw', target: 'm_cm1', sourceIface: 'p3' },
            { id: 'ml13', source: 'm_scsw', target: 'm_cm2', sourceIface: 'p4' },
            { id: 'ml14', source: 'm_scsw', target: 'm_ap', sourceIface: 'p5', targetIface: 'p1' },
            { id: 'ml15', source: 'm_ap', target: 'm_hh', medium: 'wireless' },

            { id: 'ml16', source: 'm_snet', target: 'm_tac', targetIface: 'ct' },
            { id: 'ml17', source: 'm_tac', target: 'm_scif', sourceIface: 'pt', targetIface: 'p1', medium: 'fiber' },
            { id: 'ml18', source: 'm_scif', target: 'm_sw1', sourceIface: 'p2' },
            { id: 'ml19', source: 'm_scif', target: 'm_sw2', sourceIface: 'p3' },
            { id: 'ml20', source: 'm_scif', target: 'm_ssrv', sourceIface: 'p4' }
        ]
    },
    errors: commonErrorsTemplate(620, 380)
};

// Menu copy for the library tabs. Order here is the order shown; the key must
// match templatesData / SNIPPETS.
const TEMPLATE_META = [
    { key: 'house',      icon: '🏠', name: 'Smart Home',      blurb: 'Router, Wi-Fi and a handful of devices' },
    { key: 'hospital',   icon: '🏥', name: 'Hospital',        blurb: 'Clinical VLANs, PACS and modalities' },
    { key: 'imaging',    icon: '🩻', name: 'Imaging Centre',  blurb: 'Modalities → PACS → VNA, teleradiology over VPN' },
    { key: 'bank',       icon: '🏦', name: 'Bank Branch',     blurb: 'Segmented cardholder and staff zones' },
    { key: 'datacenter', icon: '🏢', name: 'Data Centre',     blurb: 'Spine/leaf fabric with server pods' },
    { key: 'campus',     icon: '🎓', name: 'Corporate Campus', blurb: 'Multi-building core with wireless' },
    { key: 'retail',     icon: '🛒', name: 'Retail POS',      blurb: 'Tills, back office and guest Wi-Fi' },
    { key: 'hotel',      icon: '🏨', name: 'Hotel',           blurb: 'Guest Wi-Fi, PMS, IPTV and door locks' },
    { key: 'warehouse',  icon: '📦', name: 'Warehouse',       blurb: 'Aisle APs, handheld scanners and a WMS' },
    { key: 'factory',    icon: '🏭', name: 'Smart Factory',   blurb: 'OT/IT split with PLCs and SCADA' },
    { key: 'military',   icon: '🪖', name: 'Military Base',   blurb: 'Air-gapped NIPR and SIPR enclaves, Type 1 crypto' },
    { key: 'vessel',     icon: '🚢', name: 'Vessel',          blurb: 'Satellite uplink, bridge, engine room, crew' },
    { key: 'studio',     icon: '🎬', name: 'Media Studio',    blurb: '10G edit bays and a passthrough render node' },
    { key: 'callcenter', icon: '📞', name: 'Call Center',     blurb: 'PBX, agent phones and workstations' },
    { key: 'showcase',   icon: '🧩', name: 'Full Showcase',   blurb: 'Every node type, medium and feature at once' },
    { key: 'errors',     icon: '🚑', name: 'Common Errors',   blurb: 'Broken on purpose — six faults to find' }
];

const SNIPPET_META = [
    { key: 'dicom',        icon: '🩻', name: 'DICOM Imaging',   blurb: 'Modalities → PACS' },
    { key: 'dmz',          icon: '🛡️', name: 'DMZ',             blurb: 'Firewall + two zones' },
    { key: 'dcpod',        icon: '🗄️', name: 'DC Pod',          blurb: 'L3 + servers, VM, container' },
    { key: 'webfarm',      icon: '🌐', name: 'Web Farm',        blurb: 'Load balancer + 3 servers' },
    { key: 'k8s',          icon: '☸️', name: 'Kubernetes',      blurb: 'Ingress, control plane, workers' },
    { key: 'homelab',      icon: '🧪', name: 'Homelab',         blurb: 'Hypervisor, VMs and a NAS' },
    { key: 'vlan',         icon: '🔀', name: 'VLAN Segment',    blurb: 'Switch + 3 hosts' },
    { key: 'wifi',         icon: '📶', name: 'Wireless Cell',   blurb: 'AP + 3 associated clients' },
    { key: 'iotseg',       icon: '🔌', name: 'Isolated IoT',    blurb: 'Firewall + AP + guest devices' },
    { key: 'voip',         icon: '📞', name: 'VoIP',            blurb: 'PBX, switch and phones' },
    { key: 'surveillance', icon: '📹', name: 'Surveillance',    blurb: 'NVR + PoE switch + 3 cameras' },
    { key: 'storage',      icon: '💽', name: 'Storage',         blurb: 'NAS + backup target' },
    { key: 'mgmt',         icon: '🛠️', name: 'Management',      blurb: 'Monitoring, syslog, jump host' },
    { key: 'branch',       icon: '🏢', name: 'Branch Office',   blurb: 'Router, LAN and a phone' },
    { key: 'vpnsite',      icon: '🔒', name: 'VPN Site-to-Site', blurb: 'Tunnel between two sites' },
    { key: 'hapair',       icon: '⚖️', name: 'HA Firewall Pair', blurb: 'Primary + standby' },
    { key: 'errors',       icon: '🚑', name: 'Common Errors',   blurb: 'ARP flux, L2 loop, Wi-Fi on eth0…' }
];

// ---- Building-block snippets (stamped, not replacing) ----
const SNIPPETS = {
    errors: COMMON_ERRORS,
    dmz: { nodes: [
        { tid: 'fw', type: 'firewall', name: 'Edge FW', dx: 0, dy: -60, ips: ['203.0.113.1/30', '10.20.0.1/24', '10.20.10.1/24'], dns: '1.1.1.1' },
        { tid: 'sw1', type: 'switch', name: 'LAN SW', dx: -120, dy: 60, portCount: 8, ips: [] },
        { tid: 'sw2', type: 'switch', name: 'DMZ SW', dx: 120, dy: 60, portCount: 8, ips: [] },
        { tid: 'srv', type: 'server', name: 'DMZ Server', dx: 120, dy: 180, ips: ['10.20.10.10/24'], gw: '10.20.10.1', ports: '80, 443' } ],
      links: [{ s: 'fw', t: 'sw1' }, { s: 'fw', t: 'sw2' }, { s: 'sw2', t: 'srv' }] },
    dcpod: { nodes: [
        { tid: 'core', type: 'l3switch', name: 'Pod Core L3', dx: 0, dy: -60, ips: ['10.30.0.1/24'], gw: '10.30.0.254' },
        { tid: 's1', type: 'server', name: 'App Server', dx: -160, dy: 90, ips: ['10.30.0.11/24'], gw: '10.30.0.1', ports: '8080' },
        { tid: 's2', type: 'server', name: 'DB Server', dx: -40, dy: 90, ips: ['10.30.0.12/24'], gw: '10.30.0.1', ports: '5432' },
        { tid: 'c1', type: 'container', name: 'Container', dx: 80, dy: 90, ips: ['10.30.0.13/24'], gw: '10.30.0.1', ports: '8080' },
        { tid: 'vm1', type: 'vm', name: 'Worker VM', dx: 200, dy: 90, ips: ['10.30.0.14/24'], gw: '10.30.0.1' } ],
      links: [{ s: 'core', t: 's1' }, { s: 'core', t: 's2' }, { s: 'core', t: 'c1', attachment: 'bridged' }, { s: 'core', t: 'vm1', attachment: 'bridged' }] },
    vlan: { nodes: [
        { tid: 'sw', type: 'switch', name: 'VLAN SW', dx: 0, dy: 0, portCount: 8, ips: [] },
        { tid: 'p1', type: 'pc', name: 'Host 1', dx: -120, dy: 120, ips: ['10.40.0.51/24'], gw: '10.40.0.1' },
        { tid: 'p2', type: 'pc', name: 'Host 2', dx: 0, dy: 120, ips: ['10.40.0.52/24'], gw: '10.40.0.1' },
        { tid: 'p3', type: 'pc', name: 'Host 3', dx: 120, dy: 120, ips: ['10.40.0.53/24'], gw: '10.40.0.1' } ],
      links: [{ s: 'sw', t: 'p1' }, { s: 'sw', t: 'p2' }, { s: 'sw', t: 'p3' }] },
    wifi: { nodes: [
        { tid: 'ap', type: 'ap', name: 'Access Point', dx: 0, dy: 0, ips: [] },
        { tid: 'c1', type: 'iot', name: 'Phone', dx: -120, dy: 120, gw: '10.50.0.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.50.0.101/24' }] },
        { tid: 'c2', type: 'pc', name: 'Laptop', dx: 0, dy: 120, gw: '10.50.0.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.50.0.102/24' }] },
        { tid: 'c3', type: 'camera', name: 'WiFi Cam', dx: 120, dy: 120, gw: '10.50.0.1', interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.50.0.103/24' }] } ],
      links: [{ s: 'ap', t: 'c1', medium: 'wireless' }, { s: 'ap', t: 'c2', medium: 'wireless' }, { s: 'ap', t: 'c3', medium: 'wireless' }] },
    hapair: { nodes: [
        { tid: 'f1', type: 'firewall', name: 'FW Primary', dx: -80, dy: 0, ips: ['10.0.0.2/24'], dns: '1.1.1.1' },
        { tid: 'f2', type: 'firewall', name: 'FW Standby', dx: 80, dy: 0, ips: ['10.0.0.3/24'], dns: '1.1.1.1' } ],
      links: [{ s: 'f1', t: 'f2' }] },
    webfarm: { nodes: [
        { tid: 'lb', type: 'loadbalancer', name: 'Web LB', dx: 0, dy: -60, nat: true, gw: '10.60.0.1', ips: ['10.60.0.5/24', '10.61.0.1/24'], ports: '80, 443' },
        { tid: 'w1', type: 'server', name: 'Web 1', dx: -120, dy: 90, ips: ['10.61.0.11/24'], gw: '10.61.0.1', ports: '80, 443' },
        { tid: 'w2', type: 'server', name: 'Web 2', dx: 0, dy: 90, ips: ['10.61.0.12/24'], gw: '10.61.0.1', ports: '80, 443' },
        { tid: 'w3', type: 'server', name: 'Web 3', dx: 120, dy: 90, ips: ['10.61.0.13/24'], gw: '10.61.0.1', ports: '80, 443' } ],
      links: [{ s: 'lb', t: 'w1' }, { s: 'lb', t: 'w2' }, { s: 'lb', t: 'w3' }] },
    vpnsite: { nodes: [
        { tid: 'net', type: 'cloud', name: 'Internet', dx: 0, dy: -130, ips: [] },
        { tid: 'g1', type: 'vpn', name: 'HQ VPN GW', dx: -150, dy: 0, nat: true, gw: '203.0.113.1', ips: ['203.0.113.10/30', '10.70.0.1/24'], ports: '443, 500, 4500' },
        { tid: 'g2', type: 'router', name: 'Branch GW', dx: 150, dy: 0, nat: true, gw: '198.51.100.1', ips: ['198.51.100.10/30', '10.71.0.1/24'] },
        { tid: 'h1', type: 'pc', name: 'HQ Host', dx: -150, dy: 120, ips: ['10.70.0.50/24'], gw: '10.70.0.1' },
        { tid: 'h2', type: 'pc', name: 'Branch Host', dx: 150, dy: 120, ips: ['10.71.0.50/24'], gw: '10.71.0.1' } ],
      links: [{ s: 'net', t: 'g1' }, { s: 'net', t: 'g2' }, { s: 'g1', t: 'g2', medium: 'vpn' }, { s: 'g1', t: 'h1' }, { s: 'g2', t: 'h2' }] },
    voip: { nodes: [
        { tid: 'sw', type: 'switch', name: 'Voice Switch', dx: 0, dy: -60, portCount: 8, ips: [] },
        { tid: 'pbx', type: 'custom', name: 'PBX', dx: -130, dy: 60, ips: ['10.80.0.10/24'], gw: '10.80.0.1', ports: '5060, 5061' },
        { tid: 'p1', type: 'voip', name: 'Phone 1', dx: 0, dy: 90, ips: ['10.80.0.61/24'], gw: '10.80.0.1', ports: '5060' },
        { tid: 'p2', type: 'voip', name: 'Phone 2', dx: 120, dy: 90, ips: ['10.80.0.62/24'], gw: '10.80.0.1', ports: '5060' } ],
      links: [{ s: 'sw', t: 'pbx' }, { s: 'sw', t: 'p1' }, { s: 'sw', t: 'p2' }] },
    surveillance: { nodes: [
        { tid: 'nvr', type: 'server', name: 'NVR', dx: 0, dy: -70, ips: ['10.90.0.10/24'], gw: '10.90.0.1', ports: '554, 80' },
        { tid: 'sw', type: 'switch', name: 'PoE Switch', dx: 0, dy: 30, portCount: 8, ips: [] },
        { tid: 'cam1', type: 'camera', name: 'Camera 1', dx: -130, dy: 150, ips: ['10.90.0.91/24'], gw: '10.90.0.1', ports: '554' },
        { tid: 'cam2', type: 'camera', name: 'Camera 2', dx: 0, dy: 150, ips: ['10.90.0.92/24'], gw: '10.90.0.1', ports: '554' },
        { tid: 'cam3', type: 'camera', name: 'Camera 3', dx: 130, dy: 150, ips: ['10.90.0.93/24'], gw: '10.90.0.1', ports: '554' } ],
      links: [{ s: 'sw', t: 'nvr' }, { s: 'sw', t: 'cam1' }, { s: 'sw', t: 'cam2' }, { s: 'sw', t: 'cam3' }] },
    storage: { nodes: [
        { tid: 'sw', type: 'switch', name: 'Storage Switch', dx: 0, dy: -60, portCount: 8, ips: [] },
        { tid: 'nas', type: 'server', name: 'NAS', dx: -90, dy: 70, ips: ['10.100.0.10/24'], gw: '10.100.0.1', ports: '2049, 445' },
        { tid: 'bkp', type: 'server', name: 'Backup', dx: 90, dy: 70, ips: ['10.100.0.11/24'], gw: '10.100.0.1', ports: '873' } ],
      links: [{ s: 'sw', t: 'nas' }, { s: 'sw', t: 'bkp' }] },
    // Medical imaging: US/CT/MR/CR/DX modalities send DICOM to a PACS,
    // with reading workstations and a DICOM film printer.
    dicom: { nodes: [
        { tid: 'sw',   type: 'switch',  name: 'Imaging Switch',  dx: 0,    dy: -100, portCount: 8, ips: [] },
        { tid: 'pacs', type: 'server',  name: 'PACS Server',     dx: -240, dy: 20,  ips: ['10.120.0.10/24'], gw: '10.120.0.1', ports: '104, 11112, 443' },
        { tid: 'prn',  type: 'printer', name: 'DICOM Printer',   dx: -120, dy: 20,  ips: ['10.120.0.80/24'], gw: '10.120.0.1', ports: '104' },
        { tid: 'ws1',  type: 'pc',      name: 'Reading WS 1',    dx: 150,  dy: 20,  ips: ['10.120.0.51/24'], gw: '10.120.0.1' },
        { tid: 'ws2',  type: 'pc',      name: 'Reading WS 2',    dx: 250,  dy: 20,  ips: ['10.120.0.52/24'], gw: '10.120.0.1' },
        { tid: 'us',   type: 'dicom',   name: 'US Scanner',      dx: -160, dy: 160, ips: ['10.120.0.21/24'], gw: '10.120.0.1', ports: '104' },
        { tid: 'ct',   type: 'dicom',   name: 'CT Scanner',      dx: -80,  dy: 160, ips: ['10.120.0.22/24'], gw: '10.120.0.1', ports: '104' },
        { tid: 'mr',   type: 'dicom',   name: 'MR Scanner',      dx: 0,    dy: 160, ips: ['10.120.0.23/24'], gw: '10.120.0.1', ports: '104' },
        { tid: 'cr',   type: 'dicom',   name: 'CR Unit',         dx: 80,   dy: 160, ips: ['10.120.0.24/24'], gw: '10.120.0.1', ports: '104' },
        { tid: 'dx',   type: 'dicom',   name: 'DX Unit',         dx: 160,  dy: 160, ips: ['10.120.0.25/24'], gw: '10.120.0.1', ports: '104' } ],
      links: [{ s: 'sw', t: 'pacs' }, { s: 'sw', t: 'prn' }, { s: 'sw', t: 'ws1' }, { s: 'sw', t: 'ws2' }, { s: 'sw', t: 'us' }, { s: 'sw', t: 'ct' }, { s: 'sw', t: 'mr' }, { s: 'sw', t: 'cr' }, { s: 'sw', t: 'dx' }] },
    // Homelab: a hypervisor running VMs + a container, plus a NAS.
    homelab: { nodes: [
        { tid: 'sw',  type: 'switch',    name: 'Lab Switch',        dx: 0,    dy: -70, portCount: 8, ips: [] },
        { tid: 'hv',  type: 'server',    name: 'Hypervisor (PVE)',  dx: -120, dy: 50,  ips: ['10.110.0.10/24'], gw: '10.110.0.1', ports: '8006, 22' },
        { tid: 'nas', type: 'server',    name: 'NAS',               dx: 120,  dy: 50,  ips: ['10.110.0.20/24'], gw: '10.110.0.1', ports: '2049, 445' },
        { tid: 'vm1', type: 'vm',        name: 'VM: Web',           dx: -60,  dy: 160, ips: ['10.110.0.21/24'], gw: '10.110.0.1', ports: '80, 443' },
        { tid: 'vm2', type: 'vm',        name: 'VM: DB',            dx: 40,   dy: 160, ips: ['10.110.0.22/24'], gw: '10.110.0.1', ports: '5432' },
        { tid: 'ct1', type: 'container', name: 'Container: App',    dx: 140,  dy: 160, ips: ['10.110.0.31/24'], gw: '10.110.0.1', ports: '8080' } ],
      links: [{ s: 'sw', t: 'hv' }, { s: 'sw', t: 'nas' }, { s: 'hv', t: 'vm1', attachment: 'bridged' }, { s: 'hv', t: 'vm2', attachment: 'bridged' }, { s: 'hv', t: 'ct1', attachment: 'bridged' }] },
    // A complete small branch office behind its own NAT router.
    branch: { nodes: [
        { tid: 'rtr', type: 'router',  name: 'Branch Router',  dx: 0,    dy: -100, nat: true, gw: '198.51.100.9', ips: ['198.51.100.10/30', '172.16.9.1/24'] },
        { tid: 'sw',  type: 'switch',  name: 'Branch Switch',  dx: 0,    dy: 10,  portCount: 8, ips: [] },
        { tid: 'pc1', type: 'pc',      name: 'Desk 1',         dx: -150, dy: 140, ips: ['172.16.9.51/24'], gw: '172.16.9.1' },
        { tid: 'pc2', type: 'pc',      name: 'Desk 2',         dx: -50,  dy: 140, ips: ['172.16.9.52/24'], gw: '172.16.9.1' },
        { tid: 'prn', type: 'printer', name: 'Printer',        dx: 50,   dy: 140, ips: ['172.16.9.80/24'], gw: '172.16.9.1', ports: '9100' },
        { tid: 'ph',  type: 'voip',    name: 'Desk Phone',     dx: 150,  dy: 140, ips: ['172.16.9.60/24'], gw: '172.16.9.1', ports: '5060' } ],
      links: [{ s: 'rtr', t: 'sw' }, { s: 'sw', t: 'pc1' }, { s: 'sw', t: 'pc2' }, { s: 'sw', t: 'prn' }, { s: 'sw', t: 'ph' }] },
    // Kubernetes: control plane + worker pods behind an ingress load balancer.
    k8s: { nodes: [
        { tid: 'lb', type: 'loadbalancer', name: 'Ingress LB',    dx: 0,    dy: -90, nat: true, gw: '10.130.0.1', ips: ['10.130.0.5/24'], ports: '80, 443' },
        { tid: 'sw', type: 'switch',       name: 'Cluster Switch',dx: 0,    dy: 10,  portCount: 8, ips: [] },
        { tid: 'cp', type: 'server',       name: 'Control Plane', dx: -150, dy: 140, ips: ['10.130.0.10/24'], gw: '10.130.0.1', ports: '6443' },
        { tid: 'w1', type: 'container',    name: 'Worker Pod 1',  dx: -40,  dy: 140, ips: ['10.130.0.21/24'], gw: '10.130.0.1', ports: '8080' },
        { tid: 'w2', type: 'container',    name: 'Worker Pod 2',  dx: 60,   dy: 140, ips: ['10.130.0.22/24'], gw: '10.130.0.1', ports: '8080' },
        { tid: 'w3', type: 'container',    name: 'Worker Pod 3',  dx: 160,  dy: 140, ips: ['10.130.0.23/24'], gw: '10.130.0.1', ports: '8080' } ],
      links: [{ s: 'lb', t: 'sw' }, { s: 'sw', t: 'cp' }, { s: 'sw', t: 'w1' }, { s: 'sw', t: 'w2' }, { s: 'sw', t: 'w3' }] },
    // Isolated IoT / guest VLAN gated by its own firewall.
    iotseg: { nodes: [
        { tid: 'fw',  type: 'firewall', name: 'IoT Firewall',  dx: 0,    dy: -100, nat: true, gw: '10.0.0.1', dns: '1.1.1.1', ips: ['10.0.0.9/24', '10.140.0.1/24'] },
        { tid: 'ap',  type: 'ap',       name: 'IoT AP',        dx: 0,    dy: 10,  ips: [] },
        { tid: 'hub', type: 'iot',      name: 'Smart Hub',     dx: -140, dy: 140, ips: ['10.140.0.10/24'], gw: '10.140.0.1', ports: '1883' },
        { tid: 'cam', type: 'camera',   name: 'WiFi Camera',   dx: -30,  dy: 140, ips: ['10.140.0.90/24'], gw: '10.140.0.1', ports: '554' },
        { tid: 'sen', type: 'iot',      name: 'Sensor',        dx: 80,   dy: 140, ips: ['10.140.0.100/24'], gw: '10.140.0.1', ports: '1883' },
        { tid: 'tv',  type: 'iot',      name: 'Smart TV',      dx: 180,  dy: 140, ips: ['10.140.0.101/24'], gw: '10.140.0.1' } ],
      links: [{ s: 'fw', t: 'ap' }, { s: 'ap', t: 'hub', medium: 'wireless' }, { s: 'ap', t: 'cam', medium: 'wireless' }, { s: 'ap', t: 'sen', medium: 'wireless' }, { s: 'ap', t: 'tv', medium: 'wireless' }] },
    // Out-of-band management / monitoring segment.
    mgmt: { nodes: [
        { tid: 'sw',   type: 'switch', name: 'Mgmt Switch',      dx: 0,    dy: -70, portCount: 8, ips: [] },
        { tid: 'mon',  type: 'server', name: 'Monitoring',       dx: -110, dy: 60,  ips: ['10.150.0.10/24'], gw: '10.150.0.1', ports: '3000, 9090' },
        { tid: 'log',  type: 'server', name: 'Syslog / SIEM',    dx: 110,  dy: 60,  ips: ['10.150.0.11/24'], gw: '10.150.0.1', ports: '514, 443' },
        { tid: 'jump', type: 'pc',     name: 'Jump Host',        dx: 0,    dy: 160, ips: ['10.150.0.50/24'], gw: '10.150.0.1', ports: '22' } ],
      links: [{ s: 'sw', t: 'mon' }, { s: 'sw', t: 'log' }, { s: 'sw', t: 'jump' }] }
};
