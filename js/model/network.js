/* Network model: WS.net. One adapter on a simulated lab LAN (router 192.168.1.1, a client PC,
 * and a few "internet" hosts). Name resolution follows the Windows order: hosts file -> DNS
 * servers in order (a local DNS role answers for 127.0.0.1 / own IP) -> LLMNR for single-label
 * names on the subnet. ping() gives the real Windows failure messages.
 * State: network.adapters[i], network.lan (the lab network), network.peers. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  /** Public hosts reachable once the server has a working gateway. icmp:false = drops ping (like microsoft.com). */
  const INTERNET = [
    { name: 'dns.google', ip: '8.8.8.8', icmp: true, dns: true },
    { name: 'dns.google', ip: '8.8.4.4', icmp: true, dns: true },
    { name: 'one.one.one.one', ip: '1.1.1.1', icmp: true, dns: true },
    { name: 'www.microsoft.com', ip: '23.45.229.117', icmp: false, cname: 'e13678.dscb.akamaiedge.net' },
    { name: 'microsoft.com', ip: '20.70.246.20', icmp: false },
    { name: 'www.bing.com', ip: '13.107.21.200', icmp: true },
    { name: 'bing.com', ip: '13.107.21.200', icmp: true },
    { name: 'www.google.com', ip: '142.250.72.4', icmp: true },
    { name: 'google.com', ip: '142.250.72.14', icmp: true },
    { name: 'www.example.com', ip: '93.184.215.14', icmp: true },
    { name: 'example.com', ip: '93.184.215.14', icmp: true },
    { name: 'windowsupdate.microsoft.com', ip: '20.72.235.82', icmp: false },
    { name: 'time.windows.com', ip: '168.61.215.74', icmp: false }
  ];

  WS.store.init('network', s => {
    s.network = {
      lan: {
        network: '192.168.1.0', prefix: 24, gateway: '192.168.1.1', internet: true,
        dhcp: { enabled: true, start: '192.168.1.100', end: '192.168.1.199', dns: ['192.168.1.1'], domain: '', leaseHours: 24 }
      },
      peers: [
        { name: 'ROUTER', ip: '192.168.1.1', mac: '00-15-5D-01-01-01', icmp: true, dns: true, ttl: 64 },
        { name: 'CLIENT01', ip: '192.168.1.50', mac: '00-15-5D-01-01-32', icmp: true, ttl: 128, dhcpClient: true }
      ],
      adapters: [{
        name: 'Ethernet', ifIndex: 6, description: 'Microsoft Hyper-V Network Adapter', mac: U.randomMac(),
        enabled: true, connected: true, linkSpeed: '10 Gbps',
        dhcp: true, ip: null, prefix: 24, gateway: null, dhcpServer: null, leaseObtained: null, leaseExpires: null,
        dnsDhcp: true, dnsServers: [], dnsSuffix: '', registerDns: true,
        ipv6: true, linkLocal6: 'fe80::' + [1, 2, 3, 4].map(() => U.randInt(0, 0xffff).toString(16)).join(':') + '%6'
      }]
    };
    applyDhcp(s.network.adapters[0], s.network);
  });

  const net = () => WS.state.network;
  const hooks = [];
  function changed(a) { WS.store.changed('network'); for (const fn of hooks) { try { fn(a); } catch (e) { console.error(e); } } }

  function adapter(nameOrIndex) {
    const list = net().adapters;
    if (nameOrIndex == null) return list[0];
    return list.find(a => a.ifIndex === +nameOrIndex || a.name.toLowerCase() === String(nameOrIndex).toLowerCase()) || null;
  }

  /* ---------------- DHCP client ---------------- */
  function applyDhcp(a, n) {
    n = n || net();
    const lan = n.lan;
    // a DHCP server on the LAN: the router, or (later) a DHCP role on a different machine. An adapter on another
    // segment (a Hyper-V internal switch: a.segment) has no DHCP server, so it falls through to APIPA.
    if (a.dhcp && !a.segment && lan.dhcp && lan.dhcp.enabled) {
      const lo = U.ipToInt(lan.dhcp.start), hi = U.ipToInt(lan.dhcp.end);
      const used = new Set(n.peers.map(p => p.ip));
      let ip = lo + (U.hashStr(a.mac) % (hi - lo + 1));
      for (let i = 0; i <= hi - lo && used.has(U.intToIp(ip)); i++) ip = ip >= hi ? lo : ip + 1;
      a.ip = U.intToIp(ip); a.prefix = lan.prefix; a.gateway = lan.gateway; a.dhcpServer = lan.gateway;
      const now = new Date();
      a.leaseObtained = now.toISOString(); a.leaseExpires = new Date(+now + lan.dhcp.leaseHours * 3600e3).toISOString();
      if (a.dnsDhcp) a.dnsServers = lan.dhcp.dns.slice();
      if (!a.suffixConfigured) a.dnsSuffix = lan.dhcp.domain || '';
    } else if (a.dhcp && a.altConfig) {
      // no DHCP server answered, and the Alternate Configuration tab holds a user-configured address
      const c = a.altConfig;
      a.ip = c.ip; a.prefix = c.prefix; a.gateway = c.gateway || null; a.dhcpServer = null; a.leaseObtained = a.leaseExpires = null;
      if (a.dnsDhcp) a.dnsServers = (c.dns || []).slice();
    } else if (a.dhcp) {
      // no DHCP server answered: Automatic Private IP Addressing
      a.ip = '169.254.' + (1 + U.hashStr(a.mac) % 254) + '.' + (1 + U.hashStr(a.mac + 'x') % 254);
      a.prefix = 16; a.gateway = null; a.dhcpServer = null; a.leaseObtained = a.leaseExpires = null;
      if (a.dnsDhcp) a.dnsServers = [];
    }
  }

  /* ---------------- bindings (Ethernet Properties > "This connection uses the following items") ---------------- */
  const BINDINGS = [
    ['ms_msclient', 'Client for Microsoft Networks', 'Allows your computer to access resources on a Microsoft network.', 'client'],
    ['ms_server', 'File and Printer Sharing for Microsoft Networks', 'Allows other computers to access resources on your computer using a Microsoft network.', 'service'],
    ['ms_pacer', 'QoS Packet Scheduler', 'Provides network traffic control, including rate-of-flow and prioritization services.', 'service'],
    ['ms_tcpip', 'Internet Protocol Version 4 (TCP/IPv4)', 'Transmission Control Protocol/Internet Protocol. The default wide area network protocol that provides communication across diverse interconnected networks.', 'protocol'],
    ['ms_implat', 'Microsoft Network Adapter Multiplexor Protocol', 'Protocol driver used to team network adapters.', 'protocol', false],
    ['ms_lldp', 'Microsoft LLDP Protocol Driver', 'Microsoft Link Layer Discovery Protocol driver.', 'protocol'],
    ['ms_tcpip6', 'Internet Protocol Version 6 (TCP/IPv6)', 'TCP/IP version 6. The latest version of the internet protocol that provides communication across diverse interconnected networks.', 'protocol'],
    ['ms_rspndr', 'Link-Layer Topology Discovery Responder', 'Allows this PC to be discovered and located on the network.', 'protocol'],
    ['ms_lltdio', 'Link-Layer Topology Discovery Mapper I/O Driver', 'Used to discover and locate other PCs, devices, and network infrastructure components on the network, and also to determine network bandwidth.', 'protocol'],
    // listed only once Hyper-V is installed; bound when the adapter carries an external virtual switch
    ['vms_pp', 'Hyper-V Extensible Virtual Switch', 'Hyper-V Extensible Virtual Switch', 'service', false]
  ];
  /** Is a component bound to the adapter? (TCP/IPv6 follows the older a.ipv6 flag.) */
  function bound(a, id) {
    if (id === 'ms_tcpip6') return a.ipv6 !== false;
    const def = BINDINGS.find(b => b[0] === id);
    return a.bindings && id in a.bindings ? !!a.bindings[id] : !!def && def[4] !== false;
  }
  function bindings(which) {
    const a = adapter(which);
    const hv = WS.features && WS.features.isInstalled('Hyper-V');
    return a ? BINDINGS.filter(b => b[0] !== 'vms_pp' || hv).map(([id, name, description, kind]) => ({ id, name, description, kind, enabled: bound(a, id) })) : [];
  }
  /** Enable-/Disable-NetAdapterBinding: unbinding TCP/IPv4 stops IPv4 traffic on the adapter (ping: "General failure"). */
  function setBinding(which, id, enabled) {
    const a = adapter(which);
    if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    const def = BINDINGS.find(b => b[0].toLowerCase() === String(id).toLowerCase() || b[1].toLowerCase() === String(id).toLowerCase());
    if (!def) return { ok: false, code: 'NotFound', error: `No MSFT_NetAdapterBindingSettingData objects found with property 'ComponentID' equal to '${id}'.` };
    if (def[0] === 'ms_tcpip6') a.ipv6 = !!enabled;
    else { a.bindings = a.bindings || {}; a.bindings[def[0]] = !!enabled; }
    changed(a);
    return { ok: true };
  }
  /** Set-DnsClient / Advanced TCP/IP Settings > DNS: { suffix (connection-specific; '' = from DHCP), register } */
  function setDnsClient(which, o = {}) {
    const a = adapter(which);
    if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    if ('suffix' in o) {
      const s = String(o.suffix || '').trim().replace(/\.$/, '');
      if (s && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(s)) return { ok: false, error: `The DNS suffix ${s} is not valid. It can contain only letters, digits, hyphens and periods.` };
      a.suffixConfigured = !!s;
      a.dnsSuffix = s || (a.dhcp && net().lan.dhcp && net().lan.dhcp.enabled ? net().lan.dhcp.domain || '' : '');
    }
    if ('register' in o) a.registerDns = !!o.register;
    changed(a);
    return { ok: true };
  }
  /** IPv4 Properties > Alternate Configuration: null = Automatic private IP address, or { ip, prefix | mask, gateway, dns[] }. */
  function setAlternate(which, cfg) {
    const a = adapter(which);
    if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    if (!cfg) { a.altConfig = null; if (a.dhcp) applyDhcp(a); changed(a); return { ok: true }; }
    const ip = String(cfg.ip || '').trim();
    if (!U.isValidIp(ip)) return { ok: false, error: `The IP address ${ip || '(blank)'} is not valid.` };
    const prefix = cfg.prefix != null ? +cfg.prefix : U.maskToPrefix(cfg.mask);
    if (!(prefix >= 1 && prefix <= 32)) return { ok: false, error: 'The subnet mask is not valid. Enter a valid subnet mask.' };
    const gw = String(cfg.gateway || '').trim();
    if (gw && !U.isValidIp(gw)) return { ok: false, error: `The default gateway ${gw} is not valid.` };
    const dns = [].concat(cfg.dns || []).map(x => String(x).trim()).filter(Boolean);
    const bad = dns.find(x => !U.isValidIp(x));
    if (bad) return { ok: false, error: `The address ${bad} is not a valid DNS server address.` };
    a.altConfig = { ip, prefix, gateway: gw || null, dns };
    if (a.dhcp) applyDhcp(a);
    changed(a);
    return { ok: true };
  }

  /** The address actually in use (a duplicate static address is not used, like real Windows). */
  function status(a) {
    a = a || adapter();
    if (!a.enabled) return 'Disabled';
    if (!a.connected) return 'Disconnected';
    if (!a.dhcp && net().peers.some(p => p.ip === a.ip)) return 'Duplicate';
    return 'Up';
  }
  const usable = a => status(a) === 'Up' && bound(a, 'ms_tcpip');
  const isApipa = ip => /^169\.254\./.test(ip || '');

  /* ---------------- configuration (used by ncpa.cpl, New-NetIPAddress, netsh, sconfig) ---------------- */
  /** setStatic(adapter, { ip, prefix | mask, gateway }) -> { ok, error?, warnings[] } */
  function setStatic(which, cfg) {
    const a = adapter(which);
    if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    const chk = checkStatic(cfg);
    if (!chk.ok) return chk;
    const { ip, prefix, gateway: gw, warnings } = chk;
    a.dhcp = false; a.ip = ip; a.prefix = prefix; a.gateway = gw || null;
    a.dhcpServer = a.leaseObtained = a.leaseExpires = null;
    if (a.dnsDhcp) { a.dnsDhcp = false; a.dnsServers = []; }
    if (!a.suffixConfigured) a.dnsSuffix = '';
    if (net().peers.some(p => p.ip === ip)) {
      const p = net().peers.find(x => x.ip === ip);
      WS.evt.write('System', { id: 4199, source: 'Tcpip', level: 'Error', message: `The system detected an address conflict for IP address ${ip} with the system having network hardware address ${p.mac}. Network operations on this system may be disrupted as a result.` });
    }
    changed(a);
    return { ok: true, warnings };
  }
  /** Validate a static configuration without applying it (IPv4 Properties checks before OK closes it). */
  function checkStatic(cfg) {
    const ip = String(cfg.ip || '').trim();
    if (!U.isValidIp(ip)) return { ok: false, error: `The IP address ${ip || '(blank)'} is not valid.` };
    let prefix = cfg.prefix != null ? +cfg.prefix : U.maskToPrefix(cfg.mask);
    if (!(prefix >= 1 && prefix <= 32)) return { ok: false, error: 'The subnet mask is not valid. Enter a valid subnet mask.' };
    const first = +ip.split('.')[0];
    if (first === 0 || first === 127 || first >= 224) return { ok: false, error: `The IP address ${ip} is not valid. ${first === 127 ? 'Addresses beginning with 127 are reserved for loopback addresses.' : 'Specify a value between 1 and 223 for the first field.'}` };
    if (prefix < 31 && (ip === U.networkOf(ip, prefix) || ip === U.broadcastOf(ip, prefix))) {
      return { ok: false, error: 'The combination of IP address and subnet mask is invalid. All of the bits in the host address portion of the IP address are set to ' + (ip === U.networkOf(ip, prefix) ? '0' : '1') + '. Please enter a valid combination of IP address and subnet mask.' };
    }
    const gw = cfg.gateway ? String(cfg.gateway).trim() : '';
    if (gw && !U.isValidIp(gw)) return { ok: false, error: `The default gateway ${gw} is not valid.` };
    const warnings = [];
    if (gw && !U.inSubnet(gw, ip, prefix)) warnings.push('The default gateway is not on the same network segment (subnet) that is defined by the IP address and subnet mask. Do you want to save this configuration?');
    return { ok: true, ip, prefix, gateway: gw, warnings };
  }
  function setDhcp(which) {
    const a = adapter(which);
    if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    a.dhcp = true;
    applyDhcp(a);
    changed(a);
    return { ok: true };
  }
  /** servers: array of IPs, or null to get DNS servers from DHCP again (Set-DnsClientServerAddress -ResetServerAddresses). */
  function setDnsServers(which, servers) {
    const a = adapter(which);
    if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    if (servers == null) { a.dnsDhcp = true; a.dnsServers = []; if (a.dhcp) applyDhcp(a); changed(a); return { ok: true }; }
    const list = [].concat(servers).map(x => String(x).trim()).filter(Boolean);
    const bad = list.find(x => !U.isValidIp(x));
    if (bad) return { ok: false, error: `The address ${bad} is not a valid DNS server address.` };
    a.dnsDhcp = false; a.dnsServers = list;
    changed(a);
    return { ok: true };
  }
  function setEnabled(which, enabled) {
    const a = adapter(which); if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    a.enabled = !!enabled; changed(a); return { ok: true };
  }
  function renameAdapter(which, newName) {
    const a = adapter(which); if (!a) return { ok: false, error: `No MSFT_NetAdapter objects found with property 'Name' equal to '${which}'.` };
    newName = String(newName || '').trim();
    if (!newName) return { ok: false, error: 'The connection name cannot be blank.' };
    if (net().adapters.some(x => x !== a && x.name.toLowerCase() === newName.toLowerCase())) return { ok: false, error: 'Cannot rename this connection. A connection with the name you specified already exists. Specify a different name.' };
    a.name = newName; changed(a); return { ok: true };
  }
  function renew(which) {
    const a = adapter(which);
    if (!a.dhcp) return { ok: false, error: `An error occurred while renewing interface ${a.name} : The DHCP client is not enabled on this adapter.` };
    if (!usable(a)) return { ok: false, error: `No operation can be performed on ${a.name} while it has its media disconnected.` };
    applyDhcp(a); changed(a);
    return isApipa(a.ip) ? { ok: false, error: `An error occurred while renewing interface ${a.name} : unable to contact your DHCP server. Request has timed out.` } : { ok: true };
  }
  function release(which) {
    const a = adapter(which);
    if (!a.dhcp) return { ok: false, error: `The operation failed as no adapter is in the state permissible for this operation.` };
    a.ip = '0.0.0.0'; a.gateway = null; a.leaseObtained = a.leaseExpires = null; changed(a);
    return { ok: true };
  }

  /* ---------------- name resolution ---------------- */
  function hostsEntries() {
    let text = '';
    try { text = WS.fs ? WS.fs.readFile('C:\\Windows\\System32\\drivers\\etc\\hosts') : ''; } catch (e) { text = ''; }
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.replace(/#.*/, '').trim();
      if (!t) continue;
      const [ip, ...names] = t.split(/\s+/);
      if (U.isValidIp(ip)) names.forEach(n => out.push({ ip, name: n.toLowerCase() }));
    }
    return out;
  }

  const ownIps = () => net().adapters.filter(usable).map(a => a.ip).filter(Boolean);
  const isLocalAddr = ip => ip === '127.0.0.1' || ip === '::1' || ownIps().includes(ip);

  /** Can this server exchange packets with ip? ('direct' | 'routed' | false) */
  function route(ip) {
    if (isLocalAddr(ip)) return 'local';
    const a = net().adapters.find(x => usable(x) && x.ip && x.ip !== '0.0.0.0');
    if (!a) return false;
    if (U.inSubnet(ip, a.ip, a.prefix)) return 'direct';
    if (!a.gateway || !U.inSubnet(a.gateway, a.ip, a.prefix)) return false;
    if (!net().peers.some(p => p.ip === a.gateway)) return false;
    return 'routed';
  }
  function hostAt(ip) {
    const r = route(ip);
    if (r === 'local') return { local: true };
    if (r === 'direct') return net().peers.find(p => p.ip === ip) || null;
    if (r === 'routed') {
      const lan = net().lan;
      if (!lan.internet) return null;
      return INTERNET.find(h => h.ip === ip) || null;
    }
    return null;
  }

  /** Ask one DNS server. Returns { status: 'ok' | 'nxdomain' | 'timeout', records, authoritative }. */
  function queryServer(server, name, type = 'A', depth = 0) {
    name = String(name).replace(/\.$/, '').toLowerCase();
    if (depth > 4) return { status: 'timeout', records: [] };
    if (isLocalAddr(server)) {
      if (!WS.dns || !WS.features.isInstalled('DNS') || !WS.svc.isRunning('DNS')) return { status: 'timeout', records: [] };
      const r = WS.dns.query(name, type);
      if (r.authoritative) return { status: r.records.length || r.nodata ? 'ok' : 'nxdomain', records: r.records, authoritative: true };
      // a conditional forwarder for the name wins over the server-level forwarders and root hints
      const cf = WS.dns.conditionalForwarderFor && WS.dns.conditionalForwarderFor(name);
      if (cf) {
        for (const m of cf.masters) {
          const fr = queryServer(m, name, type, depth + 1);
          if (fr.status !== 'timeout') return { ...fr, authoritative: false };
        }
        return { status: 'timeout', records: [] };
      }
      for (const f of WS.dns.forwarders()) {
        const fr = queryServer(f, name, type, depth + 1);
        if (fr.status !== 'timeout') return { ...fr, authoritative: false };
      }
      // root hints: the server goes to the internet itself if it has a route
      if (WS.dns.useRootHints() && net().lan.internet && route('8.8.8.8') === 'routed') return internetAnswer(name, type);
      return { status: 'timeout', records: [] };
    }
    const host = hostAt(server);
    if (!host || !host.dns) return { status: 'timeout', records: [] };
    return internetAnswer(name, type);
  }
  function internetAnswer(name, type) {
    if (type === 'PTR') {
      const ip = name.replace(/\.in-addr\.arpa$/, '').split('.').reverse().join('.');
      const h = INTERNET.find(x => x.ip === ip);
      return h ? { status: 'ok', records: [{ name, type: 'PTR', data: h.name }] } : { status: 'nxdomain', records: [] };
    }
    const hits = INTERNET.filter(h => h.name === name);
    if (!hits.length) return { status: 'nxdomain', records: [] };
    const recs = [];
    if (hits[0].cname) recs.push({ name, type: 'CNAME', data: hits[0].cname });
    hits.forEach(h => recs.push({ name: hits[0].cname || name, type: 'A', data: h.ip }));
    return { status: 'ok', records: recs, authoritative: false };
  }

  function dnsServers() {
    const a = net().adapters.find(usable);
    return a ? a.dnsServers.slice() : [];
  }
  function suffixes() {
    const s = WS.state.system;
    return [s.domain, adapter().dnsSuffix].filter(Boolean).map(x => x.toLowerCase());
  }

  /** resolve(name) -> { ok, name, ip, addresses, source: 'literal'|'local'|'hosts'|'dns'|'llmnr', server, error: 'notfound'|'timeout' } */
  function resolve(name) {
    const raw = String(name || '').trim().replace(/\.$/, '');
    const n = raw.toLowerCase();
    if (U.isValidIp(raw)) return { ok: true, name: raw, ip: raw, addresses: [raw], source: 'literal' };
    if (n === 'localhost') return { ok: true, name: 'localhost', ip: '127.0.0.1', addresses: ['127.0.0.1'], source: 'local' };
    const me = WS.sys.name.toLowerCase();
    if (n === me || n === WS.sys.fqdn().toLowerCase()) {
      const ip = ownIps()[0] || '127.0.0.1';
      return { ok: true, name: WS.sys.fqdn(), ip, addresses: [ip], source: 'local' };
    }
    const hosts = hostsEntries().filter(e => e.name === n);
    if (hosts.length) return { ok: true, name: raw, ip: hosts[0].ip, addresses: hosts.map(h => h.ip), source: 'hosts' };

    const candidates = n.includes('.') ? [n, ...suffixes().map(s => n + '.' + s)] : [...suffixes().map(s => n + '.' + s), n];
    let sawTimeout = false;
    for (const server of dnsServers()) {
      let answered = false;
      for (const c of candidates) {
        const r = queryServer(server, c, 'A');
        if (r.status === 'timeout') { sawTimeout = true; break; }
        answered = true;
        const a = r.records.filter(x => x.type === 'A');
        if (a.length) return { ok: true, name: a[0].name || c, ip: a[0].data, addresses: a.map(x => x.data), source: 'dns', server, aliases: r.records.filter(x => x.type === 'CNAME').map(x => x.name) };
      }
      if (answered) break; // an authoritative "no" from a responding server: don't ask the next one
    }
    // LLMNR / NetBIOS for single-label names on the local subnet
    if (!n.includes('.')) {
      const p = net().peers.find(x => x.name.toLowerCase() === n && route(x.ip) === 'direct');
      if (p) return { ok: true, name: p.name, ip: p.ip, addresses: [p.ip], source: 'llmnr' };
    }
    return { ok: false, name: raw, error: sawTimeout ? 'timeout' : 'notfound' };
  }

  /** Reverse lookup through the configured DNS servers (nslookup uses this for "Server: ..."). */
  function reverse(ip, server) {
    const q = ip.split('.').reverse().join('.') + '.in-addr.arpa';
    for (const s of server ? [server] : dnsServers()) {
      const r = queryServer(s, q, 'PTR');
      if (r.status === 'timeout') continue;
      const p = r.records.find(x => x.type === 'PTR');
      return p ? p.data.replace(/\.$/, '') : null;
    }
    if (ip === '127.0.0.1') return 'localhost';
    return null;
  }

  /** ping(target, count) -> { ok, ip, name, lines: [{ ok, text, time, ttl }], error } */
  function ping(target, count = 4) {
    const r = resolve(target);
    if (!r.ok) return { ok: false, error: `Ping request could not find host ${target}. Please check the name and try again.` };
    const ip = r.ip;
    const lines = [];
    const a = net().adapters.find(usable);
    const reply = (time, ttl) => lines.push({ ok: true, time, ttl, text: `Reply from ${ip}: bytes=32 time${time < 1 ? '<1' : '=' + time}ms TTL=${ttl}` });
    for (let i = 0; i < count; i++) {
      if (isLocalAddr(ip) || /^127\./.test(ip)) { reply(0, 128); continue; }
      if (!a || !a.ip || a.ip === '0.0.0.0') { lines.push({ ok: false, text: 'PING: transmit failed. General failure.' }); continue; }
      const rt = route(ip);
      if (rt === 'direct') {
        const p = net().peers.find(x => x.ip === ip);
        if (!p) lines.push({ ok: false, text: `Reply from ${a.ip}: Destination host unreachable.` });
        else if (!p.icmp) lines.push({ ok: false, text: 'Request timed out.' });
        else reply(U.randInt(0, 1), p.ttl || 128);
      } else if (rt === 'routed') {
        const h = hostAt(ip);
        if (h && h.icmp) reply(U.randInt(11, 24), h.ttl || 116);
        else lines.push({ ok: false, text: 'Request timed out.' });
      } else {
        lines.push({ ok: false, text: a.gateway && !isApipa(a.ip) ? 'Request timed out.' : 'PING: transmit failed. General failure.' });
      }
    }
    return { ok: lines.some(l => l.ok), ip, name: r.name, source: r.source, lines };
  }

  /** Everything ipconfig /all prints, as data. */
  function ipconfig() {
    const s = WS.state.system;
    return {
      hostName: s.computerName, primarySuffix: s.domain || '', nodeType: 'Hybrid', ipRouting: false, winsProxy: false,
      searchList: suffixes(),
      // an adapter with no IP protocol bound (the physical NIC under an external virtual switch) is not listed
      adapters: net().adapters.filter(a => bound(a, 'ms_tcpip') || a.ipv6 !== false).map(a => ({ ...a, status: status(a), mask: U.prefixToMask(a.prefix) }))
    };
  }

  WS.sys.on('boot', () => {
    for (const a of net().adapters) if (a.dhcp) applyDhcp(a);
    WS.store.changed('network');
  });

  /* ---------------- adapters added and removed by other models (Hyper-V's vEthernet adapters) ---------------- */
  /** addAdapter({ name, description, mac, index (position; 0 = the primary), segment, ...config }) -> adapter */
  function addAdapter(o) {
    const list = net().adapters;
    const ifIndex = o.ifIndex || Math.max(...list.map(x => x.ifIndex)) + 1 + U.randInt(0, 4);
    const a = Object.assign({ name: o.name, ifIndex, description: o.description || 'Hyper-V Virtual Ethernet Adapter', mac: o.mac || U.randomMac(), enabled: true, connected: true, linkSpeed: '10 Gbps',
      dhcp: true, ip: null, prefix: 24, gateway: null, dhcpServer: null, leaseObtained: null, leaseExpires: null, dnsDhcp: true, dnsServers: [], dnsSuffix: '', registerDns: true, ipv6: true,
      linkLocal6: 'fe80::' + [1, 2, 3, 4].map(() => U.randInt(0, 0xffff).toString(16)).join(':') + '%' + ifIndex }, o);
    delete a.index;
    if (a.dhcp && !o.ip) applyDhcp(a);
    list.splice(o.index != null ? o.index : list.length, 0, a);
    changed(a);
    return a;
  }
  function removeAdapter(name) {
    const list = net().adapters;
    const i = list.findIndex(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (i < 0) return null;
    const [a] = list.splice(i, 1);
    changed(a);
    return a;
  }
  /** The IP settings a vEthernet adapter takes over from the physical one (and gives back). */
  const IP_FIELDS = ['dhcp', 'ip', 'prefix', 'gateway', 'dhcpServer', 'leaseObtained', 'leaseExpires', 'dnsDhcp', 'dnsServers', 'dnsSuffix', 'suffixConfigured', 'registerDns', 'altConfig'];
  function moveIpConfig(from, to) {
    for (const k of IP_FIELDS) { if (k in from) to[k] = Array.isArray(from[k]) ? from[k].slice() : from[k]; else delete to[k]; }
    Object.assign(from, { dhcp: true, ip: null, gateway: null, dhcpServer: null, leaseObtained: null, leaseExpires: null, dnsServers: [] });
    changed(to);
  }

  WS.net = {
    addAdapter, removeAdapter, moveIpConfig, applyDhcp: a => { applyDhcp(a); changed(a); },
    INTERNET, adapter, adapters: () => net().adapters, status, setStatic, setDhcp, setDnsServers, setEnabled, rename: renameAdapter,
    bindings, setBinding, bound, setDnsClient, setAlternate, usable, checkStatic,
    renew, release, resolve, reverse, queryServer, dnsServers, ping, route, ipconfig, ownIps,
    primaryIp: () => ownIps()[0] || null,
    isStatic: () => !adapter().dhcp,
    onChange: fn => hooks.push(fn)
  };
})();
