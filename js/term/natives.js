/* Native console programs shared by CMD and PowerShell (ipconfig, ping, nslookup, netsh, net, sc, whoami, ...).
 * WS.term.defineNative(name, run, o)  run(argv, io) -> exit code (may be async)
 * WS.term.native(name) / nativeNames() / makeIO(session, overrides)
 * io: write(t), writeLine(t), error(t), input (piped lines or null), readLine(o), console, session, cwd,
 *     cancelled(), wait(ms) -> false when Ctrl+C was pressed, launch(appId, label).
 * Output text matches the real tools so students learn to read it. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;
  const natives = {};

  function defineNative(name, run, o = {}) { natives[name.toLowerCase()] = { name, run, ...o }; }
  /** o.feature: the program exists only while that feature is installed (iisreset); o.dir: it lives in a folder that
   * is not on PATH (appcmd in %windir%\system32\inetsrv), so it runs only by path or, in CMD, from that folder. */
  function native(name) {
    const n = String(name).toLowerCase().replace(/\.(exe|com)$/, '');
    const nat = natives[n] || natives[String(name).toLowerCase()] || null;
    if (nat && nat.feature && ![].concat(nat.feature).some(f => WS.features.isInstalled(f))) return null;
    return nat;
  }
  /** Can `name` (as typed, maybe with a path) reach this native from cwd? */
  function reachable(nat, name, cwd, o = {}) {
    if (!nat || !nat.dir) return true;
    const hasPath = /[\\/]/.test(name);
    if (!hasPath && !o.searchCwd) return false;
    let full;
    try { full = WS.fs.full(name, cwd); } catch (e) { return false; }
    const dir = full.replace(/\\[^\\]*$/, '');
    return dir.toLowerCase() === nat.dir.toLowerCase() && (WS.fs.exists(full) || WS.fs.exists(full + '.exe'));
  }
  const nativeNames = () => Object.values(natives).filter(n => !n.hidden && !n.dir && (!n.feature || [].concat(n.feature).some(f => WS.features.isInstalled(f)))).map(n => n.name);
  function makeIO(session, o = {}) {
    const io = {
      session, console: session.console, kind: session.kind,
      get cwd() { return session.cwd; },
      write: o.write || (t => session.write(t)),
      writeLine(t) { io.write((t == null ? '' : t) + '\n'); },
      error: o.error || (t => session.write(t)),
      input: o.input || null,
      readLine: ro => (session.console ? session.console.readLine(ro) : Promise.resolve(null)),
      cancelled() { if (session.cancelled || (session.console && session.console.disposed)) { session.cancelled = false; return true; } return false; },
      async wait(ms) { const step = 50; for (let t = 0; t < ms; t += step) { await U.sleep(Math.min(step, ms - t)); if (session.cancelled || (session.console && session.console.disposed)) return false; } return true; },
      launch(appId, label) { if (WS.apps.get(appId)) WS.apps.launch(appId); else WS.apps.notImplemented(label || appId); }
    };
    return io;
  }
  const lc = s => String(s).toLowerCase();
  const sw = (argv, ...names) => argv.some(a => names.includes(lc(a).replace(/^-/, '/')));
  const dots = (label, width = 36) => {
    // "   IPv4 Address. . . . . . . . . . . : " alignment used by ipconfig
    let s = '   ' + label;
    while (s.length < width) s += s.length % 2 ? ' ' : '.';
    return s.replace(/\.$/, ' ').slice(0, width) + ': ';
  };

  /* ================================================================ ipconfig */
  function ipconfigText(all) {
    const c = WS.net.ipconfig();
    const out = ['', 'Windows IP Configuration', ''];
    if (all) {
      out.push(dots('Host Name') + c.hostName);
      out.push(dots('Primary Dns Suffix ') + c.primarySuffix);
      out.push(dots('Node Type') + c.nodeType);
      out.push(dots('IP Routing Enabled') + 'No');
      out.push(dots('WINS Proxy Enabled') + 'No');
      if (c.searchList.length) { out.push(dots('DNS Suffix Search List') + c.searchList[0]); for (const s of c.searchList.slice(1)) out.push(' '.repeat(39) + s); }
    }
    out.push('');
    for (const a of c.adapters) {
      if (a.status === 'Disabled') continue;
      out.push(`Ethernet adapter ${a.name}:`, '');
      if (a.status === 'Disconnected') {
        out.push(dots('Media State') + 'Media disconnected', dots('Connection-specific DNS Suffix ') + '');
        if (all) out.push(dots('Description') + a.description, dots('Physical Address') + a.mac, dots('DHCP Enabled') + (a.dhcp ? 'Yes' : 'No'), dots('Autoconfiguration Enabled') + 'Yes');
        out.push('');
        continue;
      }
      out.push(dots('Connection-specific DNS Suffix ') + (a.dnsSuffix || ''));
      if (all) out.push(dots('Description') + a.description, dots('Physical Address') + a.mac, dots('DHCP Enabled') + (a.dhcp ? 'Yes' : 'No'), dots('Autoconfiguration Enabled') + 'Yes');
      const pref = all ? '(Preferred)' : '';
      if (WS.net.bound(a, 'ms_tcpip6')) out.push(dots('Link-local IPv6 Address') + a.linkLocal6 + pref);
      const apipa = /^169\.254\./.test(a.ip);
      if (a.ip && a.ip !== '0.0.0.0' && WS.net.bound(a, 'ms_tcpip')) {
        out.push(dots(apipa ? 'Autoconfiguration IPv4 Address' : 'IPv4 Address') + a.ip + (all ? (apipa ? '(Preferred)' : a.status === 'Duplicate' ? '(Duplicate)' : '(Preferred)') : ''));
        out.push(dots('Subnet Mask') + a.mask);
      }
      if (all && a.dhcp && a.leaseObtained) { out.push(dots('Lease Obtained') + WS.util.fmtLongDate(a.leaseObtained) + ' ' + U.fmtTime(a.leaseObtained, true), dots('Lease Expires') + WS.util.fmtLongDate(a.leaseExpires) + ' ' + U.fmtTime(a.leaseExpires, true)); }
      out.push(dots('Default Gateway') + (a.gateway || ''));
      if (all) {
        if (a.dhcp && a.dhcpServer) out.push(dots('DHCP Server') + a.dhcpServer);
        out.push(dots('DHCPv6 IAID') + '100668765', dots('DHCPv6 Client DUID') + '00-01-00-01-2E-8B-4C-21-' + a.mac);
        if (a.dnsServers.length) { out.push(dots('DNS Servers') + a.dnsServers[0]); for (const s of a.dnsServers.slice(1)) out.push(' '.repeat(39) + s); }
        else out.push(dots('DNS Servers') + 'fec0:0:0:ffff::1%1', ' '.repeat(39) + 'fec0:0:0:ffff::2%1', ' '.repeat(39) + 'fec0:0:0:ffff::3%1');
        out.push(dots('NetBIOS over Tcpip') + 'Enabled');
      }
      out.push('');
    }
    return out;
  }
  defineNative('ipconfig', async (argv, io) => {
    const a = argv.map(lc);
    const flag = a.find(x => /^[/-]/.test(x));
    if (!flag || flag === '/all' || flag === '-all') { ipconfigText(flag != null).forEach(l => io.writeLine(l)); return 0; }
    if (flag === '/?' || flag === '-?') { io.writeLine('\nUSAGE:\n    ipconfig [/allcompartments] [/? | /all |\n                                 /renew [adapter] | /release [adapter] |\n                                 /renew6 [adapter] | /release6 [adapter] |\n                                 /flushdns | /displaydns | /registerdns |\n                                 /showclassid adapter |\n                                 /setclassid adapter [classid] |\n                                 /showclassid6 adapter |\n                                 /setclassid6 adapter [classid] ]\n'); return 0; }
    if (flag === '/flushdns') { io.writeLine('\nWindows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.'); return 0; }
    if (flag === '/registerdns') { io.writeLine('\nWindows IP Configuration\n\nRegistration of the DNS resource records for all adapters of this computer has been initiated. Any errors will be reported in the Event Viewer in 15 minutes.'); return 0; }
    if (flag === '/displaydns') { io.writeLine('\nWindows IP Configuration\n\n    localhost\n    ----------------------------------------\n    Record Name . . . . . : localhost\n    Record Type . . . . . : 1\n    Time To Live  . . . . : 604800\n    Data Length . . . . . : 4\n    Section . . . . . . . : Answer\n    A (Host) Record . . . : 127.0.0.1\n'); return 0; }
    if (flag === '/release' || flag === '/renew') {
      const ad = WS.net.adapter();
      io.writeLine('\nWindows IP Configuration\n');
      if (flag === '/renew') await io.wait(800);
      const r = flag === '/release' ? WS.net.release(ad.name) : WS.net.renew(ad.name);
      if (!r.ok) { io.writeLine(r.error); return 1; }
      ipconfigText(false).slice(3).forEach(l => io.writeLine(l));
      return 0;
    }
    io.writeLine('Error: unrecognized or incomplete command line.\n\nUSAGE:\n    ipconfig [/allcompartments] [/? | /all | /renew [adapter] | /release [adapter] | /flushdns | /displaydns | /registerdns ]');
    return 1;
  });

  /* ================================================================ ping */
  defineNative('ping', async (argv, io) => {
    let count = 4, forever = false, size = 32, resolveName = false, target = null;
    for (let i = 0; i < argv.length; i++) {
      const a = lc(argv[i]);
      if (a === '-n' || a === '/n') count = +argv[++i] || 4;
      else if (a === '-t' || a === '/t') forever = true;
      else if (a === '-l' || a === '/l') size = +argv[++i] || 32;
      else if (a === '-a' || a === '/a') resolveName = true;
      else if (a === '-4' || a === '-6' || a === '/4') { /* ignore */ }
      else if (a === '/?' || a === '-?') { io.writeLine('\nUsage: ping [-t] [-a] [-n count] [-l size] [-f] [-i TTL] [-v TOS]\n            [-r count] [-s count] [[-j host-list] | [-k host-list]]\n            [-w timeout] [-R] [-S srcaddr] [-c compartment] [-p]\n            [-4] [-6] target_name\n'); return 0; }
      else if (/^-/.test(a)) { io.writeLine(`Bad option ${argv[i]}.`); return 1; }
      else target = argv[i];
    }
    if (!target) { io.writeLine('IP address must be specified.'); return 1; }
    const first = WS.net.ping(target, 1);
    if (first.error) { io.writeLine(first.error); return 1; }
    const ip = first.ip;
    let shownName = U.isValidIp(target) ? null : first.name;
    if (resolveName && U.isValidIp(target)) shownName = WS.net.reverse(ip);
    io.writeLine('');
    io.writeLine(shownName ? `Pinging ${shownName} [${ip}] with ${size} bytes of data:` : `Pinging ${ip} with ${size} bytes of data:`);
    let sent = 0, recv = 0;
    const times = [];
    let stopped = false;
    for (let i = 0; forever || i < count; i++) {
      const r = WS.net.ping(ip, 1).lines[0];
      sent++;
      const ok = await io.wait(i === 0 ? 50 : 1000);
      if (!ok) { stopped = true; sent--; break; }
      io.writeLine(r.text.replace(/bytes=32/, `bytes=${size}`));
      if (r.ok) { recv++; times.push(r.time); } else if (/unreachable/.test(r.text)) recv++;
    }
    io.writeLine('');
    io.writeLine(`Ping statistics for ${ip}:`);
    io.writeLine(`    Packets: Sent = ${sent}, Received = ${recv}, Lost = ${sent - recv} (${sent ? Math.round((sent - recv) * 100 / sent) : 0}% loss),`);
    if (times.length) {
      io.writeLine('Approximate round trip times in milli-seconds:');
      io.writeLine(`    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Average = ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);
    }
    if (stopped) io.writeLine('Control-C');
    return times.length ? 0 : 1;
  });

  /* ================================================================ nslookup */
  function serverInfo(io, serverIp) {
    const q = serverIp.split('.').reverse().join('.') + '.in-addr.arpa';
    const r = WS.net.queryServer(serverIp, q, 'PTR');
    if (r.status === 'timeout') io.writeLine('DNS request timed out.\n    timeout was 2 seconds.');
    const p = r.records.find(x => x.type === 'PTR');
    return p ? p.data.replace(/\.$/, '') : 'UnKnown';
  }
  function recordLine(r) {
    const n = r.name.replace(/\.$/, '');
    const d = typeof r.data === 'string' ? r.data.replace(/\.$/, '') : r.data;
    switch (r.type) {
      case 'MX': return `${n}\tMX preference = ${r.preference}, mail exchanger = ${d}`;
      case 'NS': return `${n}\tnameserver = ${d}`;
      case 'CNAME': return `${n}\tcanonical name = ${d}`;
      case 'PTR': return `${n}\tname = ${d}`;
      case 'TXT': return `${n}\ttext =\n\n\t"${d}"`;
      case 'SRV': return `${n}\tSRV service location:\n\t  priority       = ${r.priority}\n\t  weight         = ${r.weight}\n\t  port           = ${r.port}\n\t  svr hostname   = ${d}`;
      case 'SOA': return `${n}\n\tprimary name server = ${d.primary.replace(/\.$/, '')}\n\tresponsible mail addr = ${d.responsible.replace(/\.$/, '')}\n\tserial  = ${d.serial || 1}\n\trefresh = ${d.refresh} (15 mins)\n\tretry   = ${d.retry} (10 mins)\n\texpire  = ${d.expire} (1 day)\n\tdefault TTL = ${d.minimum} (1 hour)`;
      case 'AAAA': return `${n}\tAAAA IPv6 address = ${d}`;
      default: return `${n}\tinternet address = ${d}`;
    }
  }
  function lookup(io, name, serverIp, serverName, type = 'A') {
    type = type.toUpperCase();
    let qname = String(name).replace(/\.$/, '');
    if (U.isValidIp(qname)) { qname = qname.split('.').reverse().join('.') + '.in-addr.arpa'; type = 'PTR'; }
    const suffixes = [WS.state.system.domain, WS.net.adapter().dnsSuffix].filter(Boolean);
    const candidates = String(name).endsWith('.') || type === 'PTR' ? [qname] : [...suffixes.map(s => qname + '.' + s), qname];
    let last = null;
    for (const c of candidates) {
      const r = WS.net.queryServer(serverIp, c, type === 'ANY' ? 'ANY' : type);
      last = { r, name: c };
      if (r.status === 'timeout') break;
      if (r.status === 'ok' && r.records.length) break;
    }
    const { r } = last;
    if (r.status === 'timeout') { io.writeLine('DNS request timed out.\n    timeout was 2 seconds.\nDNS request timed out.\n    timeout was 2 seconds.'); io.writeLine(`*** Request to ${serverName} timed-out`); return 1; }
    if (r.status === 'nxdomain' || !r.records.length) {
      io.writeLine(`*** ${serverName} can't find ${name}: ${r.status === 'nxdomain' || !r.records.length ? 'Non-existent domain' : 'No response from server'}`);
      return 1;
    }
    if (!r.authoritative) io.writeLine('Non-authoritative answer:');
    if (type === 'A' || type === 'PTR' && U.isValidIp(name)) {
      if (type === 'PTR') { const p = r.records.find(x => x.type === 'PTR'); io.writeLine(`Name:    ${p.data.replace(/\.$/, '')}\nAddress:  ${name}\n`); return 0; }
      const a = r.records.filter(x => x.type === 'A');
      const cn = r.records.filter(x => x.type === 'CNAME');
      io.writeLine(`Name:    ${(a[0] ? a[0].name : last.name).replace(/\.$/, '')}`);
      io.writeLine(a.length > 1 ? `Addresses:  ${a.map(x => x.data).join('\n          ')}` : `Address:  ${a[0] ? a[0].data : ''}`);
      if (cn.length) io.writeLine(`Aliases:  ${cn.map(x => x.name.replace(/\.$/, '')).join('\n          ')}`);
      io.writeLine('');
      return 0;
    }
    for (const rec of r.records) io.writeLine(recordLine(rec));
    io.writeLine('');
    return 0;
  }
  defineNative('nslookup', async (argv, io) => {
    let type = 'A';
    const rest = [];
    for (const a of argv) {
      const m = a.match(/^-(?:type|q|querytype)=(\w+)$/i);
      if (m) type = m[1]; else if (/^-/.test(a)) { /* other options ignored */ } else rest.push(a);
    }
    let serverIp = rest[1] ? (U.isValidIp(rest[1]) ? rest[1] : (WS.net.resolve(rest[1]).ip || rest[1])) : WS.net.dnsServers()[0];
    if (!serverIp) {
      io.writeLine('*** Default servers are not available');
      io.writeLine('Server:  UnKnown\nAddress:  127.0.0.1\n');
      if (rest[0]) { io.writeLine(`*** UnKnown can't find ${rest[0]}: No response from server`); return 1; }
      serverIp = '127.0.0.1';
    }
    let serverName = serverInfo(io, serverIp);
    if (rest[0]) {
      io.writeLine(`Server:  ${serverName}\nAddress:  ${serverIp}\n`);
      return lookup(io, rest[0], serverIp, serverName, type);
    }
    // interactive mode
    io.writeLine(`Default Server:  ${serverName}\nAddress:  ${serverIp}\n`);
    for (;;) {
      const line = await io.readLine({ prompt: '> ' });
      if (line === null) return 0;
      const t = line.trim();
      if (!t) continue;
      if (/^(exit|quit)$/i.test(t)) return 0;
      let m;
      if ((m = t.match(/^set\s+(?:type|q|querytype)=(\w+)$/i))) { type = m[1]; continue; }
      if (/^set\s+/i.test(t)) continue;
      if ((m = t.match(/^(?:l)?server\s+(\S+)$/i))) {
        serverIp = U.isValidIp(m[1]) ? m[1] : (WS.net.resolve(m[1]).ip || m[1]);
        serverName = serverInfo(io, serverIp);
        io.writeLine(`Default Server:  ${serverName}\nAddress:  ${serverIp}\n`);
        continue;
      }
      io.writeLine(`Server:  ${serverName}\nAddress:  ${serverIp}\n`);
      lookup(io, t.split(/\s+/)[0], serverIp, serverName, type);
    }
  });

  /* ================================================================ dnscmd (the DNS Server command-line tool, over WS.dns) */
  const DNS_ERR = { ResourceExists: [9609, 'DNS_ERROR_ZONE_ALREADY_EXISTS'], NotFound: [9601, 'DNS_ERROR_ZONE_DOES_NOT_EXIST'], NotInstalled: [1722, 'RPC_S_SERVER_UNAVAILABLE'] };
  function dnscmdFail(io, what, r) {
    const [code, name] = DNS_ERR[r.code] || (/record/i.test(what) ? [9701, 'DNS_ERROR_RECORD_DOES_NOT_EXIST'] : [87, 'ERROR_INVALID_PARAMETER']);
    io.writeLine(`${what}\n\n    Status = ${code} (0x${code.toString(16).toUpperCase().padStart(8, '0')})\nCommand failed:  ${name}     ${code}    0x${code.toString(16).toUpperCase()}\n`);
    return 1;
  }
  defineNative('dnscmd', (argv, io) => {
    const D = WS.dns;
    let args = argv.slice();
    if (args[0] && !/^\//.test(args[0])) args = args.slice(1); // a server name; this is the only DNS server
    const cmd = (args.shift() || '').toLowerCase();
    const ok = () => { io.writeLine('Command completed successfully.\n'); return 0; };
    if (!cmd || cmd === '/?' || cmd === '/help') {
      io.writeLine('\nUSAGE: DnsCmd <ServerName> <Command> [<Command Parameters>]\n\n<ServerName>:\n  IP address or host name    -- remote or local DNS server\n  .                          -- DNS server on local machine\n<Command>:\n  /Info                      -- Get server information\n  /ClearCache                -- Clear DNS server cache\n  /EnumZones                 -- Enumerate zones\n  /ZoneInfo                  -- View zone information\n  /ZoneAdd                   -- Create a new zone on the DNS server\n  /ZoneDelete                -- Delete a zone from DNS server or DS\n  /ZonePrint                 -- Display all records in the zone\n  /ZoneWriteBack             -- Save zone data back to file\n  /RecordAdd                 -- Add a resource record to a zone\n  /RecordDelete              -- Remove a resource record from a zone\n  /ResetForwarders           -- Set DNS servers to forward recursive queries to\n\n<Command Parameters>:\n  DnsCmd <CommandName> /? -- For help info on specific Command\n');
      return 0;
    }
    if (!D.isInstalled() || !WS.svc.isRunning('DNS')) {
      io.writeLine(`DNS Server ${WS.sys.name} failed to connect.\n    Status = 1722 (0x000006BA)\nCommand failed:  RPC_S_SERVER_UNAVAILABLE     1722    0x6BA\n`);
      return 1;
    }
    const storage = z => (z.adIntegrated ? 'AD-' + (z.replication || 'Domain') : 'File');
    if (cmd === '/enumzones') {
      const zones = D.zones();
      io.writeLine(`\nEnumerated zone list:\n\tZone count = ${zones.length}\n\n Zone name                      Type       Storage         Properties\n`);
      for (const z of zones) io.writeLine(` ${z.name.padEnd(30)} ${'Primary'.padEnd(10)} ${storage(z).padEnd(15)} ${[z.dynamicUpdate === 'Secure' ? 'Secure' : z.dynamicUpdate === 'NonsecureAndSecure' ? 'Update' : '', z.reverse ? 'Rev' : '', z.paused ? 'Paused' : ''].filter(Boolean).join(' ')}`);
      io.writeLine('');
      return ok();
    }
    if (cmd === '/zoneinfo') {
      const z = D.zone(args[0] || '');
      if (!z) return dnscmdFail(io, `DNS Server failed to get information for zone ${args[0] || ''}.`, { code: 'NotFound' });
      io.writeLine(`\nZone query result:\n\nZone info:\n\tptr                   = ${z.name}\n\tzone name             = ${z.name}\n\tzone type             = 1\n\tshutdown              = 0\n\tpaused                = ${z.paused ? 1 : 0}\n\tupdate                = ${{ None: 0, NonsecureAndSecure: 1, Secure: 2 }[z.dynamicUpdate] || 0}\n\tDS integrated         = ${z.adIntegrated ? 1 : 0}\n\tread only zone        = 0\n\tdata file             = ${z.file || '(null)'}\n\tusing WINS            = 0\n\tusing Nbstat          = 0\n\taging                 = ${D.zoneInfo(z).aging.enabled ? 1 : 0}\n`);
      return ok();
    }
    if (cmd === '/zoneprint') {
      const z = D.zone(args[0] || '');
      if (!z) return dnscmdFail(io, `DNS Server failed to enumerate records for node @.`, { code: 'NotFound' });
      const text = D.zoneFileText({ ...z, file: z.file || (z.name + '.dns') }).split(/\r?\n/).slice(4).join('\n');
      io.writeLine(';\n;  Zone:    ' + z.name + '\n;  Server:  ' + WS.sys.fqdn().toLowerCase() + '\n;  Time:    ' + new Date().toUTCString() + '\n;\n' + text);
      return ok();
    }
    if (cmd === '/zoneadd') {
      const name = args[0];
      const ds = args.some(a => /^\/dsprimary$/i.test(a)), fileAt = args.findIndex(a => /^\/file$/i.test(a));
      if (!name || !(ds || args.some(a => /^\/primary$/i.test(a)))) { io.writeLine('Usage: DnsCmd <ServerName> /ZoneAdd <ZoneName> <ZoneType> [<Options>]\n  <ZoneType>:\n    /DsPrimary [/DP <FQDN>]       -- DS integrated primary zone\n    /Primary /file <filename>     -- standard file backed primary\n'); return 1; }
      const r = D.createZone({ name, adIntegrated: ds, file: fileAt >= 0 ? args[fileAt + 1] : undefined });
      if (!r.ok) return dnscmdFail(io, `DNS Server failed to create zone ${name}.`, r);
      io.writeLine(`DNS Server ${WS.sys.name} created zone ${r.zone.name}:\n`);
      return ok();
    }
    if (cmd === '/zonedelete') {
      if (!args[0]) { io.writeLine('Usage: DnsCmd <ServerName> /ZoneDelete <ZoneName> [/DsDel] [/f]\n'); return 1; }
      const r = D.removeZone(args[0]);
      if (!r.ok) return dnscmdFail(io, `DNS Server failed to delete zone ${args[0]}.`, r);
      io.writeLine(`DNS Server ${WS.sys.name} deleted zone ${args[0]}:\n    Status = 0 (0x00000000)`);
      return ok();
    }
    if (cmd === '/zonewriteback' || cmd === '/writebackfiles') {
      const r = D.writeZoneFiles(cmd === '/zonewriteback' ? args[0] : undefined);
      if (!r.ok) return dnscmdFail(io, `DNS Server failed to write back zone ${args[0] || ''}.`, r);
      return ok();
    }
    if (cmd === '/recordadd' || cmd === '/recorddelete') {
      const [zoneName, node, type, ...data] = args.filter(a => !/^\/f$/i.test(a));
      if (!zoneName || !node || !type) { io.writeLine(`Usage: DnsCmd <ServerName> ${cmd === '/recordadd' ? '/RecordAdd <Zone> <NodeName> [/Aging] [/OpenAcl] [/CreatePTR] [<Ttl>] <RRType> <RRData>' : '/RecordDelete <Zone> <NodeName> <RRType> <RRData> [/f]'}\n`); return 1; }
      const t = type.toUpperCase(), name = node === '@' ? '@' : node;
      const z = D.zone(zoneName);
      const fq = z ? (name === '@' ? z.name : `${name}.${z.name}`) : `${name}.${zoneName}`;
      if (cmd === '/recorddelete') {
        const r = D.removeRecord(zoneName, { name, type: t, data: data.length ? data[data.length - 1] : undefined });
        if (!r.ok) return dnscmdFail(io, `Deleted ${t} record(s) at ${zoneName}`, { code: r.code === 'NotFound' && !z ? 'NotFound' : 'Record' });
        io.writeLine(`Deleted ${t} record(s) at ${zoneName}`);
        return ok();
      }
      const rec = { name, type: t, data: data[data.length - 1], createPtr: args.some(a => /^\/createptr$/i.test(a)) };
      if (t === 'MX') { rec.preference = +data[0]; rec.data = data[1]; }
      if (t === 'SRV') { rec.priority = +data[0]; rec.weight = +data[1]; rec.port = +data[2]; rec.data = data[3]; }
      if (t === 'TXT') rec.data = data.join(' ');
      const r = D.addRecord(zoneName, rec);
      if (!r.ok) return dnscmdFail(io, `Add ${t} Record for ${fq} at ${zoneName}`, r.code === 'NotFound' ? r : { code: 'Record' });
      io.writeLine(`Add ${t} Record for ${fq} at ${zoneName}`);
      return ok();
    }
    if (cmd === '/resetforwarders') {
      const ips = args.filter(a => !/^\//.test(a));
      const r = D.setForwarders(ips);
      if (!r.ok) return dnscmdFail(io, 'DNS Server failed to reset forwarders.', r);
      if (args.some(a => /^\/slave$/i.test(a))) D.setUseRootHints(false);
      return ok();
    }
    if (cmd === '/clearcache') { D.clearCache(); return ok(); }
    if (cmd === '/info') {
      io.writeLine(`\nQuery result:\nServer info\n\tserver name              = ${WS.sys.fqdn().toLowerCase()}\n\tversion                  = 65EC000A (10.0 build 26100)\n\tDS container             = ${WS.sys.isDC() ? 'cn=MicrosoftDNS,cn=System,' + WS.ad.domainDN() : '(null)'}\n\tforest name              = ${WS.state.system.domain || '(null)'}\n\tdomain name              = ${WS.state.system.domain || '(null)'}\n\nConfiguration:\n\tdwRpcProtocol            = 00000005\n\tdwNameCheckFlag          = 00000002\n\tcAddressAnswerLimit      = 0\n\tdwRecursionRetry         = 3\n\tdwRecursionTimeout       = 8\n\tdwDsPollingInterval      = 180\n\nAging Configuration:\n\tScavengingInterval       = 0\n\tDefaultAgingState        = 0\n\tDefaultRefreshInterval   = 168\n\tDefaultNoRefreshInterval = 168\n\nServer Addresses:\n\tPtr          = ${WS.net.primaryIp() || '(null)'}\n\nForwarders:\n\tPtr          = ${D.forwarders().length ? D.forwarders().join(', ') : '(null)'}\n\tTimeout      = 3\n\tSlave        = ${D.useRootHints() ? 0 : 1}\n`);
      return ok();
    }
    io.writeLine(`Unknown Command "${argv.find(a => /^\//.test(a)) || cmd}" Specified -- type DnsCmd -?.\n`);
    return 1;
  });

  /* ================================================================ tracert / arp / getmac / route */
  defineNative('tracert', async (argv, io) => {
    const target = argv.find(a => !/^[-/]/.test(a));
    if (!target) { io.writeLine('\nUsage: tracert [-d] [-h maximum_hops] [-j host-list] [-w timeout]\n               [-R] [-S srcaddr] [-4] [-6] target_name\n'); return 1; }
    const r = WS.net.resolve(target);
    if (!r.ok) { io.writeLine(`Unable to resolve target system name ${target}.`); return 1; }
    io.writeLine(`\nTracing route to ${U.isValidIp(target) ? r.ip : `${r.name} [${r.ip}]`}\nover a maximum of 30 hops:\n`);
    const route = WS.net.route(r.ip);
    const gw = WS.net.adapter().gateway;
    const hop = async (n, ip, base) => { if (!(await io.wait(500))) return false; const t = () => base ? String(base + U.randInt(0, 3)).padStart(4) + ' ms' : '  <1 ms'; io.writeLine(`  ${n}  ${t()}  ${t()}  ${t()}  ${ip}`); return true; };
    if (route === 'local') await hop(1, r.ip, 0);
    else if (route === 'direct') { if (WS.net.ping(r.ip, 1).ok) await hop(1, r.ip, 0); else io.writeLine('  1     *        *        *     Request timed out.'); }
    else if (route === 'routed') {
      await hop(1, gw, 0);
      const ok = WS.net.ping(r.ip, 1).ok;
      if (!(await hop(2, '10.0.0.1', 8))) return 0;
      if (ok) await hop(3, r.ip, 13);
      else for (let n = 3; n <= 5; n++) { if (!(await io.wait(600))) return 0; io.writeLine(`  ${n}     *        *        *     Request timed out.`); }
    } else { io.writeLine('  1  General failure.'); }
    io.writeLine('\nTrace complete.');
    return 0;
  });
  defineNative('arp', (argv, io) => {
    if (!sw(argv, '/a', '/g')) { io.writeLine('\nDisplays and modifies the IP-to-Physical address translation tables used by\naddress resolution protocol (ARP).\n\nARP -s inet_addr eth_addr [if_addr]\nARP -d inet_addr [if_addr]\nARP -a [inet_addr] [-N if_addr] [-v]\n'); return 0; }
    const a = WS.net.adapter();
    io.writeLine(`\nInterface: ${a.ip} --- 0x${a.ifIndex.toString(16)}`);
    io.writeLine('  Internet Address      Physical Address      Type');
    for (const p of WS.state.network.peers.filter(x => U.inSubnet(x.ip, a.ip, a.prefix))) io.writeLine(`  ${p.ip.padEnd(22)}${p.mac.toLowerCase().padEnd(22)}dynamic`);
    io.writeLine(`  ${U.broadcastOf(a.ip, a.prefix).padEnd(22)}${'ff-ff-ff-ff-ff-ff'.padEnd(22)}static`);
    io.writeLine(`  ${'224.0.0.22'.padEnd(22)}${'01-00-5e-00-00-16'.padEnd(22)}static`);
    io.writeLine(`  ${'224.0.0.251'.padEnd(22)}${'01-00-5e-00-00-fb'.padEnd(22)}static`);
    io.writeLine('');
    return 0;
  });
  defineNative('getmac', (argv, io) => {
    const a = WS.net.adapter();
    io.writeLine('\nPhysical Address    Transport Name');
    io.writeLine('=================== ==========================================================');
    io.writeLine(`${a.mac}   ${a.enabled ? '\\Device\\Tcpip_{3F8A2C61-0C1B-4B67-9C3E-5D0A1E2B7C40}' : 'Disconnected'}`);
    return 0;
  });
  defineNative('route', (argv, io) => {
    const a = WS.net.adapter();
    io.writeLine('===========================================================================\nInterface List\n  6...' + a.mac.replace(/-/g, ' ').toLowerCase() + ' ......' + a.description + '\n  1...........................Software Loopback Interface 1\n===========================================================================\n');
    io.writeLine('IPv4 Route Table\n===========================================================================\nActive Routes:\nNetwork Destination        Netmask          Gateway       Interface  Metric');
    if (a.gateway) io.writeLine(`          0.0.0.0          0.0.0.0      ${a.gateway.padStart(11)}   ${a.ip.padStart(12)}    271`);
    io.writeLine(`        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331`);
    io.writeLine(`  ${U.networkOf(a.ip, a.prefix).padStart(15)}  ${U.prefixToMask(a.prefix).padStart(15)}         On-link   ${a.ip.padStart(15)}    271`);
    io.writeLine('===========================================================================\nPersistent Routes:\n  None\n');
    return 0;
  });

  /* ================================================================ hostname / whoami / systeminfo */
  defineNative('hostname', (argv, io) => { io.writeLine(WS.sys.name); return 0; });
  defineNative('whoami', (argv, io) => {
    const user = (WS.session && WS.session.user) || 'Administrator';
    const dom = WS.sys.isDC() ? WS.ad.netbios() : WS.sys.name;
    const a = argv.map(lc);
    const sid = WS.sys.isDC() ? (WS.ad.get(user, 'user') || {}).sid : (WS.local.user(user) || {}).sid;
    if (a.includes('/upn')) { if (!WS.sys.isDC()) { io.writeLine('ERROR: Unable to get User Principal Name (UPN) as the current logged-on user\n       is not a domain user.'); return 1; } io.writeLine(`${user.toLowerCase()}@${WS.ad.domain()}`); return 0; }
    if (a.includes('/fqdn')) { if (!WS.sys.isDC()) { io.writeLine('ERROR: Unable to get Fully Qualified Distinguished Name (FQDN) as the current\n       logged-on user is not a domain user.'); return 1; } io.writeLine(WS.ad.dn(WS.ad.get(user, 'user'))); return 0; }
    const groups = WS.sys.isDC() ? WS.ad.memberOf(WS.ad.get(user, 'user') || '', true).map(g => [`${g.builtin ? 'BUILTIN' : WS.ad.netbios()}\\${g.name}`, g.builtin ? 'Alias' : 'Group', g.sid])
      : WS.local.groupsOf(user).map(g => [`BUILTIN\\${g}`, 'Alias', (WS.local.group(g) || {}).sid]);
    groups.unshift(['Everyone', 'Well-known group', 'S-1-1-0']);
    groups.push(['NT AUTHORITY\\NETWORK', 'Well-known group', 'S-1-5-2'], ['NT AUTHORITY\\Authenticated Users', 'Well-known group', 'S-1-5-11'], ['NT AUTHORITY\\This Organization', 'Well-known group', 'S-1-5-15'], ['Mandatory Label\\High Mandatory Level', 'Label', 'S-1-16-12288']);
    const userBlock = () => { io.writeLine('\nUSER INFORMATION\n----------------\n'); io.writeLine('User Name' + ' '.repeat(Math.max(1, `${dom}\\${user}`.length - 8)) + 'SID'); io.writeLine('='.repeat(`${dom}\\${user}`.length) + ' ' + '='.repeat(String(sid).length)); io.writeLine(`${dom.toLowerCase()}\\${user.toLowerCase()} ${sid}`); };
    const groupBlock = () => {
      io.writeLine('\n\nGROUP INFORMATION\n-----------------\n');
      const w = Math.max(...groups.map(g => g[0].length), 10);
      io.writeLine('Group Name'.padEnd(w) + ' Type             SID          Attributes');
      io.writeLine('='.repeat(w) + ' ================ ============ ===============================================================');
      for (const g of groups) io.writeLine(`${g[0].padEnd(w)} ${g[1].padEnd(16)} ${String(g[2]).padEnd(12)} Mandatory group, Enabled by default, Enabled group`);
    };
    if (a.includes('/user')) { userBlock(); return 0; }
    if (a.includes('/groups')) { groupBlock(); return 0; }
    if (a.includes('/priv') || a.includes('/all')) {
      if (a.includes('/all')) { userBlock(); groupBlock(); }
      io.writeLine('\n\nPRIVILEGES INFORMATION\n----------------------\n\nPrivilege Name                            Description                                                        State\n========================================= ================================================================== ========');
      for (const [p, d] of [['SeShutdownPrivilege', 'Shut down the system'], ['SeChangeNotifyPrivilege', 'Bypass traverse checking'], ['SeIncreaseWorkingSetPrivilege', 'Increase a process working set'], ['SeBackupPrivilege', 'Back up files and directories'], ['SeRestorePrivilege', 'Restore files and directories'], ['SeTakeOwnershipPrivilege', 'Take ownership of files or other objects']]) io.writeLine(`${p.padEnd(41)} ${d.padEnd(66)} ${p === 'SeChangeNotifyPrivilege' ? 'Enabled' : 'Disabled'}`);
      return 0;
    }
    io.writeLine(`${dom.toLowerCase()}\\${user.toLowerCase()}`);
    return 0;
  });
  defineNative('systeminfo', async (argv, io) => {
    io.write('Loading Operating System Information ...');
    await io.wait(500);
    io.write('\r' + ' '.repeat(42) + '\r');
    const s = WS.state.system;
    const a = WS.net.adapter();
    const row = (k, v) => io.writeLine(`${(k + ':').padEnd(27)}${v}`);
    io.writeLine('');
    row('Host Name', s.computerName);
    row('OS Name', 'Microsoft Windows Server 2025 Datacenter Evaluation');
    row('OS Version', '10.0.26100 N/A Build 26100');
    row('OS Manufacturer', 'Microsoft Corporation');
    row('OS Configuration', WS.sys.isDC() ? 'Primary Domain Controller' : 'Standalone Server');
    row('OS Build Type', 'Multiprocessor Free');
    row('Registered Owner', 'Windows User');
    row('Registered Organization', '');
    row('Product ID', '00454-40000-00001-AA000');
    row('Original Install Date', `${U.fmtDate(s.installDate)}, ${U.fmtTime(s.installDate, true)}`);
    row('System Boot Time', `${U.fmtDate(s.lastBoot || new Date())}, ${U.fmtTime(s.lastBoot || new Date(), true)}`);
    row('System Manufacturer', 'Microsoft Corporation');
    row('System Model', 'Virtual Machine');
    row('System Type', 'x64-based PC');
    row('Processor(s)', '1 Processor(s) Installed.');
    io.writeLine(' '.repeat(27) + '[01]: Intel64 Family 6 Model 79 Stepping 1 GenuineIntel ~2295 Mhz');
    row('BIOS Version', 'Microsoft Corporation Hyper-V UEFI Release v4.1, 4/6/2022');
    row('Windows Directory', 'C:\\Windows');
    row('System Directory', 'C:\\Windows\\system32');
    row('Boot Device', '\\Device\\HarddiskVolume1');
    row('System Locale', 'en-us;English (United States)');
    row('Input Locale', 'en-us;English (United States)');
    row('Time Zone', s.timeZone);
    row('Total Physical Memory', '4,095 MB');
    row('Available Physical Memory', '2,311 MB');
    row('Virtual Memory: Max Size', '5,503 MB');
    row('Virtual Memory: Available', '3,447 MB');
    row('Virtual Memory: In Use', '2,056 MB');
    row('Page File Location(s)', 'C:\\pagefile.sys');
    row('Domain', s.domain || s.workgroup);
    row('Logon Server', '\\\\' + s.computerName);
    const fixes = WS.wu.hotfixes();
    row('Hotfix(s)', `${fixes.length} Hotfix(s) Installed.`);
    io.writeLine(fixes.map((x, i) => ' '.repeat(27) + `[${String(i + 1).padStart(2, '0')}]: ${x.kb}`).join('\n'));
    row('Network Card(s)', '1 NIC(s) Installed.');
    io.writeLine(' '.repeat(27) + `[01]: ${a.description}`);
    io.writeLine(' '.repeat(33) + `Connection Name: ${a.name}`);
    io.writeLine(' '.repeat(33) + `DHCP Enabled:    ${a.dhcp ? 'Yes' : 'No'}`);
    if (a.dhcp && a.dhcpServer) io.writeLine(' '.repeat(33) + `DHCP Server:     ${a.dhcpServer}`);
    io.writeLine(' '.repeat(33) + 'IP address(es)');
    io.writeLine(' '.repeat(33) + `[01]: ${a.ip}`);
    io.writeLine(' '.repeat(33) + `[02]: ${a.linkLocal6.replace(/%\d+$/, '')}`);
    row('Hyper-V Requirements', 'A hypervisor has been detected. Features required for Hyper-V will not be displayed.');
    return 0;
  });

  /* ================================================================ gpupdate / shutdown / tasklist / dcdiag */
  defineNative('gpupdate', async (argv, io) => {
    const a = argv.map(x => lc(x).replace(/^-/, '/'));
    if (a.includes('/?')) {
      io.writeLine('Updates multiple Group Policy settings.\n\nGPUPDATE [/Target:{Computer | User}] [/Force] [/Wait:<value>]\n         [/Logoff] [/Boot] [/Sync]\n\nParameters:\n\nValue                     Description\n/Target:{Computer | User} Specifies that only User or only Computer\n                          policy settings are updated. By default,\n                          both User and Computer policy settings are\n                          updated.\n\n/Force                    Reapplies all policy settings. By default,\n                          only policy settings that have changed are\n                          applied.\n\n/Wait:{value}             Sets the number of seconds to wait for policy\n                          processing to finish before returning to the\n                          command prompt. The default value is 600 seconds.\n\n/Logoff                   Causes a logoff after the Group Policy settings\n                          have been updated.\n\n/Boot                     Causes a computer restart after the Group Policy\n                          settings are applied.\n\n/Sync                     Causes the next foreground policy application to\n                          be done synchronously.\n');
      return 0;
    }
    const bad = a.find(x => !/^\/(force|logoff|boot|sync|target:(computer|user)|wait:-?\d+)$/.test(x));
    if (bad) { io.writeLine(`\nERROR: Invalid argument/option - '${argv[a.indexOf(bad)]}'.\nType "GPUPDATE /?" for usage.\n`); return 1; }
    const tgt = (a.find(x => x.startsWith('/target:')) || '').slice(8) || 'both';
    io.writeLine('Updating policy...\n');
    if (!(await io.wait(1200))) return 1;
    const r = WS.gpo ? WS.gpo.refresh({ target: tgt, force: a.includes('/force'), reason: 'manual' }) : null;
    if (tgt !== 'user') io.writeLine('Computer Policy update has completed successfully.');
    if (tgt !== 'computer') io.writeLine('User Policy update has completed successfully.');
    io.writeLine('');
    return r && r.ok === false ? 1 : 0;
  });
  /* gpresult: the logged RSoP data (what the last policy processing applied), as /R, /V, /Z, /H or /X */
  const GPRESULT_HELP = '\nGPRESULT [/S system [/U username [/P [password]]]] [/SCOPE scope]\n           [/USER targetusername] [/R | /V | /Z] [(/X | /H) <filename> [/F]]\n\nDescription:\n    This command line tool displays the Resultant Set of Policy (RSoP)\n    information for a target user and computer.\n\nParameter List:\n    /S        system           Specifies the remote system to connect to.\n\n    /U        [domain\\]user    Specifies the user context under which the\n                               command should run.\n                               Can not be used with /X, /H.\n\n    /P        [password]       Specifies the password for the given user\n                               context. Prompts for input if omitted.\n                               Cannot be used with /X, /H.\n\n    /SCOPE    scope            Specifies whether the user or the\n                               computer settings need to be displayed.\n                               Valid values: "USER", "COMPUTER".\n\n    /USER     [domain\\]user    Specifies the user name for which the\n                               RSoP data is to be displayed.\n\n    /X        <filename>       Saves the report in XML format at the\n                               location and with the file name specified\n                               by the <filename> parameter.\n\n    /H        <filename>       Saves the report in HTML format at the\n                               location and with the file name specified by\n                               the <filename> parameter.\n\n    /F                         Forces Gpresult to overwrite the file name\n                               specified in the /X or /H command.\n\n    /R                         Displays RSoP summary data.\n\n    /V                         Specifies that verbose information should\n                               be displayed. Verbose information provides\n                               additional detailed settings that have\n                               been applied with a precedence of 1.\n\n    /Z                         Specifies that the super-verbose\n                               information should be displayed.\n\n    /?                         Displays this help message.\n\n\nExamples:\n    GPRESULT /R\n    GPRESULT /H GPReport.html\n    GPRESULT /USER targetusername /V\n    GPRESULT /S system /USER targetusername /SCOPE COMPUTER /Z\n    GPRESULT /S system /U username /P password /SCOPE USER /V\n';
  defineNative('gpresult', async (argv, io) => {
    const a = argv.map(x => lc(x).replace(/^-/, '/'));
    if (!a.length || a.includes('/?')) { io.writeLine(GPRESULT_HELP); return a.length ? 0 : 1; }
    const val = flag => { const i = a.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
    const scope = val('/scope');
    if (scope && !/^(user|computer)$/i.test(scope)) { io.writeLine(`ERROR: Invalid value for '/SCOPE' option.\nType "GPRESULT /?" for usage.`); return 1; }
    const sv = val('/s');
    if (sv && sv.split('.')[0].toLowerCase() !== WS.sys.name.toLowerCase() && sv.toLowerCase() !== 'localhost') { io.writeLine('ERROR: The RPC server is unavailable.'); return 1; }
    const who = val('/user');
    const sessionUser = (WS.session && WS.session.user) || 'Administrator';
    const ad = WS.state.ad;
    if (who && who.replace(/^[^\\]+\\/, '').toLowerCase() !== sessionUser.toLowerCase()) { io.writeLine(`\nINFO: The user "${who}" does not have RSoP data.\n`); return 1; }
    const rs = WS.gpo.loggedRsop();
    const out = { computer: scope && /^user$/i.test(scope) ? null : rs.computer, user: scope && /^computer$/i.test(scope) ? null : rs.user };
    const file = val('/h') || val('/x');
    if (file) {
      const xml = !!val('/x');
      let path;
      try { path = WS.fs.full(file, io.cwd); } catch (e) { io.writeLine('ERROR: The system cannot find the path specified.'); return 1; }
      if (WS.fs.exists(path) && !a.includes('/f')) { io.writeLine(`\nERROR: The file "${path}" already exists.\n`); return 1; }
      try { WS.fs.writeFile(path, xml ? WS.gpo.rsopXml(out) : WS.gpo.rsopHtml(out)); } catch (e) { io.writeLine('ERROR: The system cannot find the path specified.'); return 1; }
      return 0;
    }
    if (!a.some(x => /^\/(r|v|z)$/.test(x))) { io.writeLine('ERROR: Invalid Syntax.\nType "GPRESULT /?" for usage.'); return 1; }
    const verbose = a.includes('/v') || a.includes('/z');
    const pad = (k, v) => `    ${(k + ':').padEnd(36)}${v}`;
    const when = d => `${U.fmtDate(new Date(d))} at ${U.fmtTime(new Date(d), true)}`;
    const L = [];
    L.push('', 'Microsoft (R) Windows (R) Operating System Group Policy Result tool v2.0', '\u00a9 Microsoft Corporation. All rights reserved.', '', `Created on ${when(new Date())}`, '', '');
    const userName = ad ? `${ad.netbios}\\${sessionUser}` : `${WS.sys.name}\\${sessionUser}`;
    const head = `RSOP data for ${userName} on ${WS.sys.name} : Logging Mode`;
    L.push(head, '-'.repeat(head.length), '');
    L.push(`OS Configuration:            ${WS.sys.isDC() ? 'Primary Domain Controller' : 'Standalone Server'}`, 'OS Version:                  10.0.26100', `Site Name:                   ${ad ? 'Default-First-Site-Name' : 'N/A'}`, 'Roaming Profile:             N/A', `Local Profile:               C:\\Users\\${sessionUser}`, 'Connected over a slow link?: No', '');
    const sideBlock = (r, side) => {
      const title = side === 'computer' ? 'COMPUTER SETTINGS' : 'USER SETTINGS';
      L.push('', title, '-'.repeat(title.length + 1));
      if (!r) { L.push(side === 'user' ? `\nINFO: The user "${userName}" does not have RSoP data.` : '\nINFO: The computer does not have RSoP data.'); return; }
      L.push(`    ${r.dn || (side === 'computer' ? WS.sys.name : sessionUser)}`);
      L.push(pad('Last time Group Policy was applied', when(r.time)), pad('Group Policy was applied from', ad ? WS.sys.fqdn() : 'N/A'), pad('Group Policy slow link threshold', '500 kbps'),
        pad('Domain Name', ad ? ad.netbios : WS.sys.name), pad('Domain Type', ad ? 'Windows 2008 or later' : '<Local Computer>'), '');
      L.push('    Applied Group Policy Objects', '    -----------------------------');
      if (r.applied.length) r.applied.forEach(e => L.push(`        ${e.name}`)); else L.push('        N/A');
      L.push('');
      if (r.filtered.length) {
        L.push('    The following GPOs were not applied because they were filtered out', '    -------------------------------------------------------------------');
        r.filtered.forEach(e => L.push(`        ${e.name}`, `            Filtering:  ${e.reason}`, ''));
      }
      const g = side === 'computer' ? '    The computer is a part of the following security groups' : '    The user is a part of the following security groups';
      L.push(g, '    ' + '-'.repeat(g.length - 4));
      r.groups.forEach(x => L.push(`        ${x}`));
      if (verbose) verboseBlock(r, side);
    };
    const verboseBlock = (r, side) => {
      const rows = WS.gpo.settingRows(r.settings, side);
      const head2 = `Resultant Set Of Policies for ${side === 'computer' ? 'Computer' : 'User'}`;
      L.push('', '', `    ${head2}`, '    ' + '-'.repeat(head2.length + 1), '');
      const group = (title, list, fmt) => {
        L.push(`        ${title}`, '        ' + '-'.repeat(title.length));
        if (!list.length) L.push('            N/A');
        else list.forEach(x => L.push(...fmt(x), ''));
        L.push('');
      };
      const secLine = x => [`            GPO: ${x.gpoName}`, `                Policy:            ${x.def.inf ? x.def.inf[1] : x.key}`, `                ${side === 'computer' ? 'Computer' : 'User'} Setting:  ${x.def.kind === 'accounts' ? x.value.join('\n                                   ') : x.def.kind === 'bool' ? (x.value ? 'Enabled' : 'Not Enabled') : WS.gpo.display(x.def, x.value)}`];
      if (side === 'computer') {
        group('Software Installations', [], null); group('Startup Scripts', [], null); group('Shutdown Scripts', [], null);
        group('Account Policies', rows.filter(x => /^c\.sec\.(pw|lock|krb)$/.test(x.def.node)), secLine);
        group('Audit Policy', rows.filter(x => x.def.node === 'c.sec.audit'), secLine);
        group('User Rights', rows.filter(x => x.def.node === 'c.sec.ura'), secLine);
        group('Security Options', rows.filter(x => x.def.node === 'c.sec.opt'), secLine);
        group('Event Log Settings', rows.filter(x => x.def.node === 'c.sec.evt'), secLine);
        group('Restricted Groups', [], null);
        group('System Services', rows.filter(x => x.def.kind === 'service'), x => [`            GPO: ${x.gpoName}`, `                Service Name:      ${x.def.service}`, `                Startup Mode:      ${x.value}`]);
        group('Registry Settings', [], null); group('File System Settings', [], null); group('Public Key Policies', [], null);
      } else {
        group('Software Installations', [], null); group('Logon Scripts', [], null); group('Logoff Scripts', [], null); group('Public Key Policies', [], null);
      }
      group('Administrative Templates', rows.filter(x => x.def.kind === 'policy'), x => { const r2 = WS.gpo.regValuesOf(x.def, x.value)[0]; return [`            GPO: ${x.gpoName}`, `                Folder Id: ${r2 ? r2.key + '\\' + r2.value : x.def.name}`, `                Value:       ${r2 ? (typeof r2.data === 'number' ? [r2.data & 255, (r2.data >> 8) & 255, 0, 0].join(', ') : r2.data) : ''}`, `                State:       ${x.value.state}`]; });
    };
    sideBlock(out.computer, 'computer');
    if (!scope || /^user$/i.test(scope)) sideBlock(out.user, 'user');
    if (scope && /^computer$/i.test(scope)) { /* computer only */ }
    io.writeLine(L.join('\n') + '\n');
    return 0;
  });
  defineNative('dcgpofix', async (argv, io) => {
    const a = argv.map(x => lc(x).replace(/^-/, '/'));
    io.writeLine('\nMicrosoft(R) Windows(R) Operating System Default Group Policy Restore Utility v5.1\nCopyright (C) Microsoft Corporation. 1981-2003\n\nDescription: Recreates the Default Group Policy Objects (GPOs) for a domain\nSyntax: DcGPOFix [/ignoreschema] [/Target: Domain | DC | BOTH]\n');
    if (a.includes('/?')) return 0;
    if (!WS.state.ad) { io.writeLine('This utility can only be run on a domain controller.\n'); return 1; }
    const t = (argv.join(' ').match(/\/target:\s*(\w+)/i) || [0, 'both'])[1].toLowerCase();
    if (!/^(domain|dc|both)$/.test(t)) { io.writeLine('The /target parameter must be Domain, DC or Both.\n'); return 1; }
    io.writeLine('This utility can restore either the Default Domain Policy, the Default Domain Controllers Policy, or both to their original state after initial installation. To successfully restore these GPOs, you must be a Domain Administrator or Enterprise Administrator.\n\nWARNING: YOU WILL LOSE ANY CHANGES YOU HAVE MADE TO THESE GPOs. THIS UTILITY IS INTENDED ONLY FOR DISASTER RECOVERY PURPOSES.\n');
    const what = t === 'domain' ? 'Default Domain Policy' : t === 'dc' ? 'Default Domain Controller policy' : 'Default Domain policy and Default Domain Controller policy';
    io.writeLine(`You are about to restore ${what} for the following domain:\n${WS.state.ad.domain}\n`);
    const ans = await io.readLine({ prompt: 'Do you want to continue: <Y/N>? ' });
    if (!/^y/i.test(String(ans || '').trim())) { io.writeLine(''); return 1; }
    const r = WS.gpo.restoreDefaults(t);
    for (const n of r.restored || []) io.writeLine(`\nThe ${n} was restored successfully`);
    io.writeLine('');
    return r.ok ? 0 : 1;
  });
  defineNative('shutdown', async (argv, io) => {
    const a = argv.map(x => lc(x).replace(/^-/, '/'));
    if (a.includes('/a')) { io.writeLine('Unable to abort the system shutdown because no shutdown was in progress.(1116)'); return 1116; }
    const restart = a.includes('/r'), stop = a.includes('/s');
    if (!restart && !stop) { io.writeLine('Usage: shutdown [/i | /l | /s | /sg | /r | /g | /a | /p | /h | /e | /o] [/hybrid] [/soft] [/fw] [/f]\n    [/m \\\\computer][/t xxx][/d [p|u:]xx:yy [/c "comment"]]\n\n    No args    Display help. This is the same as typing /?.\n    /s         Shutdown the computer.\n    /r         Full shutdown and restart the computer.\n    /a         Abort a system shutdown.\n    /t xxx     Set the time-out period before shutdown to xxx seconds.'); return 0; }
    const ti = a.indexOf('/t');
    const secs = ti >= 0 ? Math.min(+a[ti + 1] || 0, 600) : 30;
    if (secs > 0) WS.ui.msgbox({ title: "You're about to be signed out", icon: 'warning', message: `Windows will ${restart ? 'restart' : 'shut down'} in ${secs >= 60 ? Math.round(secs / 60) + ' minutes' : 'less than a minute'}.`, buttons: ['Close'] });
    setTimeout(() => (restart ? WS.shell.restart() : WS.shell.shutdown()), Math.min(secs, 30) * 1000 + 100);
    return 0;
  });
  /* ---- tasklist / taskkill (WS.proc) ---- */
  const kb = n => Math.round(n).toLocaleString('en-US') + ' K';
  const sessName = p => (p.session ? 'Console' : 'Services');
  const cpuTime = p => { const s = Math.floor(WS.proc.live(p).cpuSeconds); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const windowTitle = p => (p.windows[0] ? p.windows[0].title : p.title || 'N/A');
  /** The process list as tasklist shows it: the Idle process first, then in start order. */
  function processList() {
    return WS.proc.list().sort((a, b) => (a.pid === 0 ? -1 : b.pid === 0 ? 1 : a.pid === 4 ? -1 : b.pid === 4 ? 1 : a.started - b.started || a.pid - b.pid));
  }
  /** tasklist /FI and taskkill /FI filters: "IMAGENAME eq notepad.exe", "PID gt 1000", "STATUS eq RUNNING", ... */
  function procFilter(text) {
    const m = /^\s*(\w+)\s+(eq|ne|gt|lt|ge|le)\s+(.*?)\s*$/i.exec(text || '');
    if (!m) return null;
    const [, field, op, raw] = m, f = field.toUpperCase(), o = op.toLowerCase();
    const re = new RegExp('^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
    const cmp = (a, b) => (o === 'eq' ? a === b : o === 'ne' ? a !== b : o === 'gt' ? a > b : o === 'lt' ? a < b : o === 'ge' ? a >= b : a <= b);
    const str = v => (o === 'ne' ? !re.test(v) : re.test(v));
    const fields = {
      IMAGENAME: p => str(p.image), PID: p => cmp(p.pid, +raw), SESSION: p => cmp(p.session, +raw), SESSIONNAME: p => str(sessName(p)),
      STATUS: p => str(p.status === 'Not responding' ? 'NOT RESPONDING' : p.status === 'Suspended' ? 'UNKNOWN' : 'RUNNING'),
      USERNAME: p => str(WS.proc.qualifiedUser(p)) || str(p.user), MEMUSAGE: p => cmp(Math.round(WS.proc.live(p).memKB), +raw),
      SERVICES: p => p.services.some(x => re.test(x)) !== (o === 'ne'), WINDOWTITLE: p => str(windowTitle(p)), MODULES: () => o === 'ne', CPUTIME: () => true
    };
    return fields[f] ? { test: fields[f], field: f } : { bad: f };
  }
  const quoteCsv = v => `"${String(v).replace(/"/g, '""')}"`;
  defineNative('tasklist', (argv, io) => {
    const a = argv.map(x => x.replace(/^-/, '/'));
    if (a.some(x => x === '/?')) { io.writeLine('\nTASKLIST [/S system [/U username [/P [password]]]]\n         [/M [module] | /SVC | /V] [/FI filter] [/FO format] [/NH]\n\nDescription:\n    This tool displays a list of currently running processes on\n    either a local or remote machine.\n\nParameter List:\n   /SVC                    Displays services hosted in each process.\n   /V                      Displays verbose task information.\n   /FI    filter           Displays a set of tasks that match a\n                           given criteria specified by the filter.\n   /FO    format           Specifies the output format.\n                           Valid values: "TABLE", "LIST", "CSV".\n   /NH                     Specifies that the "Column Header" should\n                           not be displayed in the output.\n                           Valid only for "TABLE" and "CSV" formats.\n'); return 0; }
    const flag = n => a.some(x => x.toLowerCase() === n);
    const svc = flag('/svc'), verbose = flag('/v'), nh = flag('/nh');
    let fmt = 'table';
    const filters = [];
    for (let i = 0; i < a.length; i++) {
      const x = a[i].toLowerCase();
      if (x === '/fo') { fmt = String(a[++i] || '').toLowerCase(); if (!['table', 'list', 'csv'].includes(fmt)) { io.writeLine('ERROR: Invalid argument/option - \'' + (a[i] || '') + '\'.\nType "TASKLIST /?" for usage.'); return 1; } }
      else if (x === '/fi') { const f = procFilter(a[++i]); if (!f || f.bad) { io.writeLine('ERROR: The search filter cannot be recognized.'); return 1; } filters.push(f); }
      else if (!['/svc', '/v', '/nh', '/m'].includes(x)) { io.writeLine(`ERROR: Invalid argument/option - '${a[i]}'.\nType "TASKLIST /?" for usage.`); return 1; }
    }
    if (svc && verbose) { io.writeLine('ERROR: Invalid syntax. /SVC and /V cannot be used together.\nType "TASKLIST /?" for usage.'); return 1; }
    if (nh && fmt === 'list') { io.writeLine('ERROR: Invalid syntax. /NH option is valid only for "TABLE" and "CSV" formats.\nType "TASKLIST /?" for usage.'); return 1; }
    const rows = processList().filter(p => filters.every(f => f.test(p)));
    if (!rows.length) { io.writeLine('INFO: No tasks are running which match the specified criteria.'); return 0; }
    const cols = svc ? [['Image Name', 25, p => p.image], ['PID', 8, p => p.pid, 1], ['Services', 44, p => (p.services.length ? p.services.join(', ') : 'N/A')]]
      : [['Image Name', 25, p => p.image], ['PID', 8, p => p.pid, 1], ['Session Name', 16, sessName], ['Session#', 11, p => p.session, 1], ['Mem Usage', 12, p => kb(WS.proc.live(p).memKB), 1],
        ...(verbose ? [['Status', 15, p => (p.status === 'Not responding' ? 'Not Responding' : p.status === 'Suspended' ? 'Unknown' : 'Running')], ['User Name', 50, p => (p.key === 'idle' || p.key === 'system' || p.key === 'registry' ? 'N/A' : WS.proc.qualifiedUser(p))], ['CPU Time', 12, cpuTime, 1], ['Window Title', 72, windowTitle]] : [])];
    io.writeLine('');
    if (fmt === 'csv') {
      if (!nh) io.writeLine(cols.map(c => quoteCsv(c[0])).join(','));
      for (const p of rows) io.writeLine(cols.map(c => quoteCsv(c[2](p))).join(','));
      return 0;
    }
    if (fmt === 'list') {
      const w = Math.max(...cols.map(c => c[0].length)) + 2;
      for (const p of rows) { for (const c of cols) io.writeLine((c[0] + ':').padEnd(w) + c[2](p)); io.writeLine(''); }
      return 0;
    }
    if (!nh) { io.writeLine(cols.map(c => (c[3] ? c[0].padStart(c[1]) : c[0].padEnd(c[1]))).join(' ').replace(/\s+$/, '')); io.writeLine(cols.map(c => '='.repeat(c[1])).join(' ')); }
    for (const p of rows) {
      if (svc && p.services.length > 2) { // long service lists wrap under the Services column, as tasklist /svc does
        const lines = [];
        let cur = '';
        for (const sv of p.services) { const add = (cur ? cur + ', ' : '') + sv; if (add.length > 44 && cur) { lines.push(cur + ','); cur = sv; } else cur = add; }
        lines.push(cur);
        io.writeLine(`${p.image.slice(0, 25).padEnd(25)} ${String(p.pid).padStart(8)} ${lines[0]}`);
        for (const l of lines.slice(1)) io.writeLine(' '.repeat(35) + l);
        continue;
      }
      io.writeLine(cols.map(c => { const v = String(c[2](p)); return c[3] ? v.padStart(c[1]) : v.length > c[1] && c !== cols[cols.length - 1] ? v.slice(0, c[1]) : v.padEnd(c[1]); }).join(' ').replace(/\s+$/, ''));
    }
    return 0;
  });
  defineNative('taskkill', async (argv, io) => {
    const a = argv.map(x => x.replace(/^-/, '/'));
    const usage = () => io.writeLine('\nTASKKILL [/S system [/U username [/P [password]]]]\n         { [/FI filter] [/PID processid | /IM imagename] } [/T] [/F]\n\nDescription:\n    This tool is used to terminate tasks by process id (PID) or image name.\n\nParameter List:\n    /FI   filter           Applies a filter to select a set of tasks.\n                           Allows "*" to be used. ex. imagename eq acme*\n    /PID  processid        Specifies the PID of the process to be terminated.\n                           Use TaskList to get the PID.\n    /IM   imagename        Specifies the image name of the process\n                           to be terminated. Wildcard \'*\' can be used\n                           to specify all tasks or image names.\n    /T                     Terminates the specified process and any\n                           child processes which were started by it.\n    /F                     Specifies to forcefully terminate the process(es).\n');
    if (!a.length || a.includes('/?')) { usage(); return a.length ? 0 : 1; }
    const pids = [], ims = [], filters = [];
    let force = false, tree = false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i].toLowerCase();
      if (x === '/pid') { const v = a[++i]; if (!/^\d+$/.test(v || '')) { io.writeLine(`ERROR: Invalid syntax. Value expected for '/PID'.\nType "TASKKILL /?" for usage.`); return 1; } pids.push(+v); }
      else if (x === '/im') { const v = a[++i]; if (!v) { io.writeLine(`ERROR: Invalid syntax. Value expected for '/IM'.\nType "TASKKILL /?" for usage.`); return 1; } ims.push(v); }
      else if (x === '/fi') { const f = procFilter(a[++i]); if (!f || f.bad) { io.writeLine('ERROR: The search filter cannot be recognized.'); return 1; } filters.push(f); }
      else if (x === '/f') force = true;
      else if (x === '/t') tree = true;
      else { io.writeLine(`ERROR: Invalid argument/option - '${a[i]}'.\nType "TASKKILL /?" for usage.`); return 1; }
    }
    if (!pids.length && !ims.length && !filters.length) { io.writeLine('ERROR: Invalid syntax. Neither /FI nor /PID nor /IM were specified.\nType "TASKKILL /?" for usage.'); return 1; }
    let rc = 0;
    const procs = processList().filter(p => p.pid !== 0);
    const targets = [];
    const add = p => { if (!targets.includes(p)) targets.push(p); };
    for (const id of pids) { const p = procs.find(x => x.pid === id); if (p && filters.every(f => f.test(p))) add(p); else { io.writeLine(`ERROR: The process "${id}" not found.`); rc = 128; } }
    for (const n of ims) {
      const re = new RegExp('^' + n.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
      const hits = procs.filter(p => (re.test(p.image) || re.test(p.name)) && filters.every(f => f.test(p)));
      if (!hits.length) { io.writeLine(`ERROR: The process "${n}" not found.`); rc = 128; }
      hits.forEach(add);
    }
    if (!pids.length && !ims.length) { procs.filter(p => filters.every(f => f.test(p))).forEach(add); if (!targets.length) { io.writeLine('INFO: No tasks running with the specified criteria.'); return 0; } }
    for (const p of targets) {
      const kids = tree ? WS.proc.children(p.pid) : [];
      const r = WS.proc.kill(p.pid, { force, tree });
      if (tree) for (const c of r.ended || []) if (c !== p && c.pid !== p.pid) io.writeLine(`SUCCESS: The process with PID ${c.pid} (child process of PID ${c.ppid}) has been terminated.`);
      if (!r.ok) {
        rc = 1;
        if (r.code === 'NotFound') { io.writeLine(`ERROR: The process "${p.pid}" not found.`); continue; }
        io.writeLine(tree || pids.includes(p.pid) && !ims.length
          ? `ERROR: The process with PID ${p.pid} ${tree && kids.length ? `(child process of PID ${p.ppid}) ` : ''}could not be terminated.\nReason: ${r.error}`
          : `ERROR: The process "${p.image}" with PID ${p.pid} could not be terminated.\nReason: ${r.error}`);
        continue;
      }
      if (r.crashed) return 0;
      if (tree) io.writeLine(`SUCCESS: The process with PID ${p.pid} (child process of PID ${p.ppid}) has been terminated.`);
      else if (r.graceful) io.writeLine(`SUCCESS: Sent termination signal to the process "${p.image}" with PID ${p.pid}.`);
      else if (pids.includes(p.pid) && !ims.length) io.writeLine(`SUCCESS: The process with PID ${p.pid} has been terminated.`);
      else io.writeLine(`SUCCESS: The process "${p.image}" with PID ${p.pid} has been terminated.`);
    }
    return rc;
  });
  defineNative('dcdiag', async (argv, io) => {
    const name = WS.sys.name;
    io.writeLine('\nDirectory Server Diagnosis\n\nPerforming initial setup:\n   Trying to find home server...');
    await io.wait(400);
    if (!WS.sys.isDC()) {
      io.writeLine(`   * Verifying that the local machine ${name}, is a Directory Server. \n   Home Server = ${name}\n   [${name}] Directory Binding Error 1722:\n   The RPC server is unavailable.\n   This may limit some of the tests that can be performed.\n   * The local machine is not a domain controller.`);
      return 1;
    }
    const dom = WS.ad.domain();
    const dnsOk = WS.net.resolve(WS.sys.fqdn()).ok && WS.dns.query('_ldap._tcp.' + dom, 'SRV').records.length > 0;
    io.writeLine(`   Home Server = ${name}\n   * Identified AD Forest. \n   Done gathering initial info.\n\nDoing initial required tests\n   \n   Testing server: Default-First-Site-Name\\${name}\n      Starting test: Connectivity\n         ......................... ${name} passed test Connectivity\n\nDoing primary tests\n   \n   Testing server: Default-First-Site-Name\\${name}`);
    for (const t of ['Advertising', 'FrsEvent', 'DFSREvent', 'SysVolCheck', 'KccEvent', 'KnowsOfRoleHolders', 'MachineAccount', 'NCSecDesc', 'NetLogons', 'ObjectsReplicated', 'Replications', 'RidManager', 'Services', 'SystemLog', 'VerifyReferences']) {
      await io.wait(120);
      const fail = (t === 'Advertising' && !dnsOk) || (t === 'Services' && !['NTDS', 'Kdc', 'Netlogon', 'DNS'].every(s => !WS.svc.get(s) || WS.svc.isRunning(s)));
      io.writeLine(`      Starting test: ${t}`);
      if (fail && t === 'Services') io.writeLine('            Invalid service startup type: one or more AD DS services are not running.');
      if (fail && t === 'Advertising') io.writeLine(`         Warning: DsGetDcName returned information for \\\\${name}.${dom}, when we were trying to reach ${name}.\n         SERVER IS NOT RESPONDING or IS NOT CONSIDERED SUITABLE.`);
      io.writeLine(`         ......................... ${name} ${fail ? 'failed' : 'passed'} test ${t}`);
    }
    io.writeLine(`   \n   Running partition tests on : ForestDnsZones\n      Starting test: CheckSDRefDom\n         ......................... ForestDnsZones passed test CheckSDRefDom\n   \n   Running enterprise tests on : ${dom}\n      Starting test: LocatorCheck\n         ......................... ${dom} passed test LocatorCheck\n      Starting test: Intersite\n         ......................... ${dom} passed test Intersite`);
    return 0;
  });

  /* ================================================================ net */
  const netOk = io => { io.writeLine('The command completed successfully.\n'); return 0; };
  const netErr = (io, text, msg) => { io.writeLine(`${text}\n\nMore help is available by typing NET HELPMSG ${msg}.\n`); return 2; };
  const cols3 = names => { const out = []; for (let i = 0; i < names.length; i += 3) out.push(names.slice(i, i + 3).map((n, j) => (j < 2 ? n.padEnd(25) : n)).join('').replace(/\s+$/, '')); return out; };
  async function netUser(argv, io) {
    const dc = WS.sys.isDC();
    const args = argv.filter(a => !/^\//.test(a));
    const flags = argv.filter(a => /^\//.test(a)).map(lc);
    const name = args[0];
    if (!name) {
      const users = dc ? WS.ad.search({ type: 'user' }).map(u => u.sam) : WS.local.users().map(u => u.name);
      io.writeLine(`\nUser accounts for \\\\${WS.sys.name}\n\n-------------------------------------------------------------------------------`);
      cols3(users.sort((a, b) => a.localeCompare(b))).forEach(l => io.writeLine(l));
      return netOk(io);
    }
    const u = dc ? WS.ad.resolveIdentity(name, 'user') : WS.local.user(name);
    if (flags.includes('/add')) {
      let pw = args[1];
      if (pw === '*') pw = await askPassword(io);
      if (pw == null) return 2;
      const r = dc ? WS.ad.createUser({ name, sam: name, password: pw || '' }) : WS.local.createUser(name, { password: pw || '' });
      if (!r.ok) return r.code === 'SamExists' || r.code === 'UserExists' || r.code === 'Exists' ? netErr(io, 'The account already exists.', 2224) : netErr(io, 'The password does not meet the password policy requirements. Check the minimum password length, password complexity and password history requirements.', 2245);
      return netOk(io);
    }
    if (!u) return netErr(io, 'The user name could not be found.', 2221);
    if (flags.includes('/delete')) { const r = dc ? WS.ad.remove(u.id) : WS.local.deleteUser(u.name); return r.ok ? netOk(io) : netErr(io, 'Access is denied.', 2123); }
    const active = flags.find(f => f.startsWith('/active:'));
    if (active) { const on = /yes$/.test(active); const r = dc ? WS.ad.setEnabled(u.id, on) : WS.local.setUser(u.name, { enabled: on }); if (!r.ok) return netErr(io, r.error, 2245); }
    if (args[1]) {
      let pw = args[1];
      if (pw === '*') pw = await askPassword(io);
      if (pw == null) return 2;
      const r = dc ? WS.ad.setPassword(u.id, pw) : WS.local.setPassword(u.name, pw);
      if (!r.ok) return netErr(io, 'The password does not meet the password policy requirements. Check the minimum password length, password complexity and password history requirements.', 2245);
    }
    if (active || args[1]) return netOk(io);
    // details
    const isLocal = !dc;
    const sam = isLocal ? u.name : u.sam;
    const groups = dc ? WS.ad.memberOf(u) : WS.local.groupsOf(u.name).map(n => ({ name: n, builtin: true }));
    const local = groups.filter(g => g.builtin).map(g => '*' + g.name);
    const global = groups.filter(g => !g.builtin).map(g => '*' + g.name);
    const set = u.pwdLastSet || u.passwordLastSet || WS.state.system.installDate;
    const lines = [
      ['User name', sam], ['Full Name', u.displayName || u.fullName || ''], ['Comment', u.description || ''], ["User's comment", ''], ['Country/region code', '000 (System Default)'],
      ['Account active', u.enabled ? 'Yes' : 'No'], ['Account expires', 'Never'], null,
      ['Password last set', set ? PSDate(set) : 'Never'], ['Password expires', u.neverExpires ? 'Never' : PSDate(new Date(new Date(set).getTime() + 42 * 864e5))], ['Password changeable', set ? PSDate(set) : 'Never'],
      ['Password required', 'Yes'], ['User may change password', u.cannotChange ? 'No' : 'Yes'], null,
      ['Workstations allowed', 'All'], ['Logon script', u.scriptPath || ''], ['User profile', u.profilePath || ''], ['Home directory', u.homeDirectory || ''], ['Last logon', u.lastLogon ? PSDate(u.lastLogon) : 'Never'], null,
      ['Logon hours allowed', 'All'], null,
      ['Local Group Memberships', local.length ? local.join('  ') : '*None'], ['Global Group memberships', global.length ? global.join('  ') : '*None']
    ];
    for (const l of lines) io.writeLine(l ? (l[0].padEnd(29) + l[1]).replace(/\s+$/, '') : '');
    return netOk(io);
  }
  const PSDate = d => `${U.fmtDate(d)} ${U.fmtTime(d, true)}`;
  async function askPassword(io) {
    const a = await io.readLine({ prompt: 'Type a password for the user:', secure: true });
    if (a == null) return null;
    const b = await io.readLine({ prompt: 'Retype the password to confirm:', secure: true });
    if (b == null) return null;
    if (a !== b) { io.writeLine('The passwords do not match.\n\nMore help is available by typing NET HELPMSG 2219.\n'); return null; }
    return a;
  }
  function netGroup(argv, io, localgroup) {
    const dc = WS.sys.isDC();
    const args = argv.filter(a => !/^\//.test(a));
    const flags = argv.filter(a => /^\//.test(a)).map(lc);
    const name = args[0];
    if (!localgroup && !dc) { io.writeLine('This command can be used only on a Windows Domain Controller.\n\nMore help is available by typing NET HELPMSG 3515.\n'); return 2; }
    if (!name) {
      const groups = dc ? WS.ad.search({ type: 'group' }).filter(g => (localgroup ? g.scope === 'DomainLocal' : g.scope !== 'DomainLocal')).map(g => g.name) : WS.local.groups().map(g => g.name);
      io.writeLine(`\n${localgroup ? 'Aliases' : 'Group Accounts'} for \\\\${WS.sys.name}\n\n-------------------------------------------------------------------------------`);
      groups.sort((a, b) => a.localeCompare(b)).forEach(g => io.writeLine('*' + g));
      return netOk(io);
    }
    const g = dc ? WS.ad.get(name, 'group') : WS.local.group(name);
    if (flags.includes('/add') && args.length === 1) {
      if (g) return netErr(io, localgroup ? 'The specified local group already exists.' : 'The group already exists.', localgroup ? 1379 : 2223);
      const r = dc ? WS.ad.createGroup({ name, scope: localgroup ? 'DomainLocal' : 'Global' }) : WS.local.createGroup(name);
      return r.ok ? netOk(io) : netErr(io, r.error, 2223);
    }
    if (!g) return netErr(io, localgroup ? 'The specified local group does not exist.' : 'The group name could not be found.', localgroup ? 1376 : 2220);
    if (flags.includes('/delete') && args.length === 1) { const r = dc ? WS.ad.remove(g.id) : WS.local.deleteGroup(g.name); return r.ok ? netOk(io) : netErr(io, 'Access is denied.', 5); }
    if (args.length > 1 && (flags.includes('/add') || flags.includes('/delete'))) {
      for (const m of args.slice(1)) {
        const r = dc ? (flags.includes('/add') ? WS.ad.addMember(g.id, m.replace(/^[^\\]+\\/, '')) : WS.ad.removeMember(g.id, m.replace(/^[^\\]+\\/, ''))) : (flags.includes('/add') ? WS.local.addMember(g.name, m) : WS.local.removeMember(g.name, m));
        if (!r.ok) {
          if (r.code === 'AlreadyMember' || r.code === 'MemberExists') { io.writeLine('System error 1378 has occurred.\n\nThe specified account name is already a member of the group.\n'); return 2; }
          if (r.code === 'NotFound' || r.code === 'PrincipalNotFound') return netErr(io, `There is no such global user or group: ${m}.`, 3783);
          io.writeLine(r.error); return 2;
        }
      }
      return netOk(io);
    }
    const members = dc ? WS.ad.members(g).map(m => (m.type === 'foreignSecurityPrincipal' ? m.displayName : g.builtin && m.type === 'group' ? `${WS.ad.netbios()}\\${m.name}` : m.sam || m.name)) : g.members;
    io.writeLine(`${localgroup ? 'Alias name' : 'Group name'}     ${g.name}\nComment        ${g.description || ''}\n\nMembers\n\n-------------------------------------------------------------------------------`);
    (localgroup ? members.map(m => [m]) : cols3(members).map(l => [l])).forEach(l => io.writeLine(l[0]));
    return netOk(io);
  }
  async function netStartStop(argv, io, start) {
    const name = argv.join(' ').replace(/^"|"$/g, '');
    if (!name) {
      if (!start) { io.writeLine('The syntax of this command is:\n\nNET STOP\nservice\n'); return 1; }
      io.writeLine('These Windows services are started:\n');
      WS.svc.list().filter(s => s.status === 'Running').forEach(s => io.writeLine('   ' + s.display));
      io.writeLine('');
      return netOk(io);
    }
    const s = WS.svc.get(name);
    if (!s) return netErr(io, 'The service name is invalid.', 2185);
    if (start) {
      if (s.status === 'Running') return netErr(io, 'The requested service has already been started.', 2182);
      const r = WS.svc.start(s.name);
      if (!r.ok) { io.writeLine(`System error ${r.code === 1058 ? 1058 : 1068} has occurred.\n\n${r.detail || r.error}\n`); return 2; }
      io.writeLine(`The ${s.display} service is starting.`);
      await io.wait(400);
      io.writeLine(`The ${s.display} service was started successfully.\n`);
      return 0;
    }
    if (s.status !== 'Running') return netErr(io, `The ${s.display} service is not started.`, 3521);
    if (!s.canStop) return netErr(io, 'The requested pause, continue, or stop is not valid for this service.', 2191);
    const deps = WS.svc.dependents(s.name).filter(d => d.status === 'Running');
    if (deps.length) {
      io.writeLine(`The following services are dependent on the ${s.display} service.\nStopping the ${s.display} service will also stop these services.\n`);
      deps.forEach(d => io.writeLine('   ' + d.display));
      io.writeLine('');
      const ans = await io.readLine({ prompt: 'Do you want to continue this operation? (Y/N) [N]: ' });
      if (!ans || !/^y/i.test(ans.trim())) return 2;
      for (const d of deps) { io.writeLine(`The ${d.display} service is stopping.`); WS.svc.stop(d.name, { force: true }); io.writeLine(`The ${d.display} service was stopped successfully.\n`); }
    }
    io.writeLine(`The ${s.display} service is stopping.`);
    await io.wait(400);
    WS.svc.stop(s.name, { force: true });
    io.writeLine(`The ${s.display} service was stopped successfully.\n`);
    return 0;
  }
  function netShare(argv, io) {
    if (!argv.length) {
      io.writeLine('\nShare name   Resource                        Remark\n\n-------------------------------------------------------------------------------');
      for (const s of WS.smb.shares()) io.writeLine(`${s.name.padEnd(12)} ${(s.path || '').padEnd(31)} ${s.description}`.replace(/\s+$/, ''));
      return netOk(io);
    }
    const first = argv[0];
    const flags = argv.slice(1).map(x => x);
    if (first.includes('=')) {
      const [name, path] = first.split('=');
      const grants = flags.filter(f => /^\/grant:/i.test(f)).map(f => f.slice(7).split(','));
      const remark = (flags.find(f => /^\/remark:/i.test(f)) || '').slice(8).replace(/^"|"$/g, '');
      const o = { name, path: path.replace(/^"|"$/g, ''), description: remark, fullAccess: [], changeAccess: [], readAccess: [] };
      for (const [acct, right] of grants) o[{ full: 'fullAccess', change: 'changeAccess', read: 'readAccess' }[lc(right || 'read')] || 'readAccess'].push(acct);
      const r = WS.smb.newShare(o);
      if (!r.ok) { io.writeLine(r.code === 'Exists' ? 'The name has already been shared.\n\nMore help is available by typing NET HELPMSG 2118.\n' : `The device or directory does not exist.\n\nMore help is available by typing NET HELPMSG 2116.\n`); return 2; }
      io.writeLine(`${name} was shared successfully.\n`);
      return 0;
    }
    if (flags.some(f => lc(f) === '/delete')) {
      const r = WS.smb.removeShare(first);
      if (!r.ok) return netErr(io, 'This shared resource does not exist.', 2310);
      io.writeLine(`${first} was deleted successfully.\n`);
      return 0;
    }
    const s = WS.smb.get(first);
    if (!s) return netErr(io, 'This shared resource does not exist.', 2310);
    io.writeLine(`Share name        ${s.name}\nPath              ${s.path}\nRemark            ${s.description}\nMaximum users     No limit\nUsers\nCaching           Manual caching of documents\nPermission        ${s.access.map(a => `${a.account}, ${a.right.toUpperCase()}`).join('\n                  ')}\n`);
    return netOk(io);
  }
  function netAccounts(argv, io) {
    const p = WS.sec.policy();
    const row = (k, v) => io.writeLine((k + ':').padEnd(54) + v);
    row('Force user logoff how long after time expires?', 'Never');
    row('Minimum password age (days)', p.minAgeDays);
    row('Maximum password age (days)', p.maxAgeDays || 'Unlimited');
    row('Minimum password length', p.minLength);
    row('Length of password history maintained', p.history || 'None');
    row('Lockout threshold', p.lockoutThreshold || 'Never');
    row('Lockout duration (minutes)', p.lockoutMinutes || 10);
    row('Lockout observation window (minutes)', p.lockoutWindowMinutes || p.lockoutMinutes || 10);
    row('Computer role', WS.sys.isDC() ? 'PRIMARY' : 'SERVER');
    return netOk(io);
  }
  /** net use: mapped network drives (WS.netuse; Group Policy Drive Maps and New-SmbMapping make the same connections). */
  async function netUse(argv, io) {
    const NU = WS.netuse;
    const sysErr = r => { io.writeLine(`System error ${r.sys} has occurred.\n\n${r.error}\n`); return 2; };
    const flags = argv.filter(a => a.startsWith('/')), args = argv.filter(a => !a.startsWith('/'));
    const flag = re => flags.find(f => re.test(f));
    const pers = flag(/^\/persistent:/i);
    if (pers && !/^\/persistent:(yes|no)$/i.test(pers)) { io.writeLine('The syntax of this command is:\n\nNET USE\n[devicename | *] [\\\\computername\\sharename[\\volume] [password | *]]\n        [/USER:[domainname\\]username]\n        [/USER:[dotted domain name\\]username]\n        [/USER:[username@dotted domain name]\n        [/SMARTCARD]\n        [/SAVECRED]\n        [/REQUIREINTEGRITY]\n        [/REQUIREPRIVACY]\n        [/WRITETHROUGH]\n        [[/DELETE] | [/PERSISTENT:{YES | NO}]]\n\nNET USE {devicename | *} [password | *] /HOME\n\nNET USE [/PERSISTENT:{YES | NO}]\n'); return 1; }
    const del = flag(/^\/d(el(ete)?)?$/i);
    if (!args.length && !del) {
      if (pers) { NU.setRemember(/yes$/i.test(pers)); return netOk(io); }
      const list = NU.list();
      io.writeLine(`New connections will ${NU.remember ? '' : 'not '}be remembered.\n`);
      if (!list.length) { io.writeLine('There are no entries in the list.\n'); return 0; }
      io.writeLine(`\nStatus       Local     Remote                    Network\n\n-------------------------------------------------------------------------------`);
      for (const d of list) {
        const remote = d.remote.length > 25 ? d.remote + '\n' + ' '.repeat(48) : d.remote.padEnd(26);
        io.writeLine(`${NU.status(d).padEnd(13)}${(d.letter + ':').padEnd(10)}${remote}Microsoft Windows Network`);
      }
      return netOk(io);
    }
    const dev = args[0] && /^([a-z]:|\*)$/i.test(args[0]) ? args[0] : null;
    const remote = args.find(a => /^\\\\/.test(a));
    if (del) {
      if (dev === '*') {
        const list = NU.list();
        if (!list.length) { io.writeLine('There are no entries in the list.\n'); return 0; }
        io.writeLine('You have these remote connections:\n');
        list.forEach(d => io.writeLine(`    ${(d.letter + ':').padEnd(14)}${d.remote}`));
        io.writeLine('Continuing will cancel the connections.\n');
        const ans = flag(/^\/y(es)?$/i) ? 'Y' : await io.readLine({ prompt: 'Do you want to continue this operation? (Y/N) [N]: ' });
        if (!ans || !/^y/i.test(ans.trim())) { io.writeLine('The command completed successfully.\n'); return 0; }
        list.forEach(d => NU.disconnect(d.letter));
        return netOk(io);
      }
      const target = dev || remote;
      const d = dev ? NU.get(dev) : NU.list().find(x => x.remote.toLowerCase() === String(remote).toLowerCase());
      if (!target || !d) return netErr(io, 'The network connection could not be found.', 2250);
      NU.disconnect(d.letter);
      io.writeLine(`${target} was deleted successfully.\n`);
      return 0;
    }
    if (dev && dev !== '*' && !remote) {
      const d = NU.get(dev);
      if (!d) return netErr(io, 'The network connection could not be found.', 2250);
      io.writeLine(`Local name        ${d.letter}:\nRemote name       ${d.remote}\nResource type     Disk\nStatus            ${NU.status(d)}\n# Opens           0\n# Connections     1`);
      return netOk(io);
    }
    if (!remote) { io.writeLine('The syntax of this command is:\n\nNET USE\n[devicename | *] [\\\\computername\\sharename[\\volume] [password | *]]\n'); return 1; }
    const r = NU.connect(dev, remote, pers ? { persistent: /yes$/i.test(pers) } : {});
    if (!r.ok) return sysErr(r);
    if (dev === '*') io.writeLine(`Drive ${r.letter}: is now connected to ${r.drive.remote}.\n`);
    return netOk(io);
  }
  defineNative('net', async (argv, io) => {
    const sub = lc(argv[0] || '');
    const rest = argv.slice(1).filter(a => lc(a) !== '/domain');
    switch (sub) {
      case 'user': case 'users': return netUser(rest, io);
      case 'localgroup': return netGroup(rest, io, true);
      case 'group': return netGroup(rest, io, false);
      case 'start': return netStartStop(rest, io, true);
      case 'stop': return netStartStop(rest, io, false);
      case 'share': return netShare(rest, io);
      case 'accounts': return netAccounts(rest, io);
      case 'use': return netUse(rest, io);
      case 'session': io.writeLine('There are no entries in the list.\n'); return 0;
      case 'view': io.writeLine('System error 6118 has occurred.\n\nThe list of servers for this workgroup is not currently available\n'); return 2;
      case 'helpmsg': io.writeLine(`\n${{ 2221: 'The user name could not be found.', 2224: 'The account already exists.', 2245: 'The password does not meet the password policy requirements.', 2182: 'The requested service has already been started.', 3521: '*** service is not started.' }[argv[1]] || 'The message number is not valid.'}\n`); return 0;
      default:
        io.writeLine('The syntax of this command is:\n\nNET\n    [ ACCOUNTS | COMPUTER | CONFIG | CONTINUE | FILE | GROUP | HELP |\n      HELPMSG | LOCALGROUP | PAUSE | SESSION | SHARE | START |\n      STATISTICS | STOP | TIME | USE | USER | VIEW ]\n');
        return 1;
    }
  });
  natives.net1 = natives.net;

  /* ================================================================ sc */
  const SC_START = { Automatic: '2   AUTO_START', AutomaticDelayedStart: '2   AUTO_START  (DELAYED)', Manual: '3   DEMAND_START', Disabled: '4   DISABLED' };
  function scTypeLine(s) { const p = WS.services ? WS.services.pathOf(s.name) : ''; return /svchost/i.test(p) ? '30  WIN32' : '10  WIN32_OWN_PROCESS'; }
  function scState(io, s, display) {
    io.writeLine(`\nSERVICE_NAME: ${s.name}`);
    if (display) io.writeLine(`DISPLAY_NAME: ${s.display}`);
    io.writeLine(`        TYPE               : ${scTypeLine(s)}`);
    io.writeLine(`        STATE              : ${s.status === 'Running' ? '4  RUNNING' : '1  STOPPED'}`);
    if (s.status === 'Running') io.writeLine(`                                (${s.canStop ? 'STOPPABLE' : 'NOT_STOPPABLE'}, NOT_PAUSABLE, ${s.canStop ? 'ACCEPTS_SHUTDOWN' : 'IGNORES_SHUTDOWN'})`);
    io.writeLine(`        WIN32_EXIT_CODE    : ${s.status === 'Running' ? '0  (0x0)' : '1077  (0x435)'}`);
    io.writeLine('        SERVICE_EXIT_CODE  : 0  (0x0)\n        CHECKPOINT         : 0x0\n        WAIT_HINT          : 0x0');
  }
  defineNative('sc', async (argv, io) => {
    const a = argv.slice();
    if (a[0] && /^\\\\/.test(a[0])) a.shift();
    const cmd = lc(a[0] || '');
    const name = a[1];
    const notFound = op => { io.writeLine(`[SC] ${op} FAILED 1060:\n\nThe specified service does not exist as an installed service.\n`); return 1060; };
    if (cmd === 'query' || cmd === 'queryex') {
      if (!name || /^(type|state|bufsize|ri|group)=$/i.test(name)) {
        const all = a.some((x, i) => lc(x) === 'state=' && lc(a[i + 1]) === 'all');
        const inactive = a.some((x, i) => lc(x) === 'state=' && lc(a[i + 1]) === 'inactive');
        for (const s of WS.svc.list().filter(x => all || (inactive ? x.status !== 'Running' : x.status === 'Running'))) scState(io, s, true);
        return 0;
      }
      const s = WS.svc.get(name);
      if (!s) return notFound('EnumQueryServicesStatus:OpenService');
      scState(io, s, false);
      if (cmd === 'queryex') io.writeLine(`        PID                : ${s.status === 'Running' ? WS.proc.pidOfService(s.name) : 0}\n        FLAGS              :`);
      return 0;
    }
    if (cmd === 'qc') {
      const s = WS.svc.get(name || '');
      if (!s) return notFound('OpenService');
      io.writeLine('[SC] QueryServiceConfig SUCCESS\n');
      io.writeLine(`SERVICE_NAME: ${s.name}\n        TYPE               : ${scTypeLine(s)}\n        START_TYPE         : ${SC_START[s.startType]}\n        ERROR_CONTROL      : 1   NORMAL\n        BINARY_PATH_NAME   : ${WS.services ? WS.services.pathOf(s.name) : ''}\n        LOAD_ORDER_GROUP   :\n        TAG                : 0\n        DISPLAY_NAME       : ${s.display}`);
      io.writeLine(`        DEPENDENCIES       : ${s.dependsOn.join('\n                           : ')}`);
      io.writeLine(`        SERVICE_START_NAME : ${s.logon === 'Local System' ? 'LocalSystem' : 'NT AUTHORITY\\' + s.logon.replace(/ /g, '')}`);
      return 0;
    }
    if (cmd === 'start') {
      const s = WS.svc.get(name || '');
      if (!s) return notFound('StartService: OpenService');
      if (s.status === 'Running') { io.writeLine('[SC] StartService FAILED 1056:\n\nAn instance of the service is already running.\n'); return 1056; }
      const r = WS.svc.start(s.name);
      if (!r.ok) { io.writeLine(`[SC] StartService FAILED ${r.code === 1058 ? 1058 : 1068}:\n\n${r.detail}\n`); return 1058; }
      io.writeLine(`\nSERVICE_NAME: ${s.name}\n        TYPE               : ${scTypeLine(s)}\n        STATE              : 2  START_PENDING\n                                (NOT_STOPPABLE, NOT_PAUSABLE, IGNORES_SHUTDOWN)\n        WIN32_EXIT_CODE    : 0  (0x0)\n        SERVICE_EXIT_CODE  : 0  (0x0)\n        CHECKPOINT         : 0x0\n        WAIT_HINT          : 0x7d0\n        PID                : ${1000 + U.hashStr(s.name) % 4000}\n        FLAGS              :`);
      return 0;
    }
    if (cmd === 'stop') {
      const s = WS.svc.get(name || '');
      if (!s) return notFound('ControlService: OpenService');
      if (s.status !== 'Running') { io.writeLine('[SC] ControlService FAILED 1062:\n\nThe service has not been started.\n'); return 1062; }
      if (!s.canStop) { io.writeLine('[SC] ControlService FAILED 1052:\n\nThe requested control is not valid for this service.\n'); return 1052; }
      if (WS.svc.dependents(s.name).some(d => d.status === 'Running')) { io.writeLine('[SC] ControlService FAILED 1051:\n\nA stop control has been sent to a service that other running services are dependent on.\n'); return 1051; }
      WS.svc.stop(s.name);
      io.writeLine(`\nSERVICE_NAME: ${s.name}\n        TYPE               : ${scTypeLine(s)}\n        STATE              : 3  STOP_PENDING\n                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)\n        WIN32_EXIT_CODE    : 0  (0x0)\n        SERVICE_EXIT_CODE  : 0  (0x0)\n        CHECKPOINT         : 0x0\n        WAIT_HINT          : 0x0`);
      return 0;
    }
    if (cmd === 'config') {
      const s = WS.svc.get(name || '');
      if (!s) return notFound('OpenService');
      const i = a.findIndex(x => /^start=/i.test(x));
      if (i < 0 || lc(a[i]) !== 'start=' || !a[i + 1]) {
        io.writeLine('DESCRIPTION:\n        Modifies a service entry in the registry and Service Database.\nUSAGE:\n        sc <server> config [service name] <option1> <option2>...\n\nOPTIONS:\nNOTE: The option name includes the equal sign.\n      A space is required between the equal sign and the value.\n      To remove the dependency, use a single / as dependency value.\n type= <own|share|interact|kernel|filesys|rec|adapt|userown|usershare>\n start= <boot|system|auto|demand|disabled|delayed-auto>');
        return 1639;
      }
      const map = { auto: 'Automatic', demand: 'Manual', disabled: 'Disabled', 'delayed-auto': 'AutomaticDelayedStart' };
      const v = map[lc(a[i + 1])];
      if (!v) { io.writeLine('[SC] ChangeServiceConfig FAILED 87:\n\nThe parameter is incorrect.\n'); return 87; }
      WS.svc.setStartup(s.name, v);
      io.writeLine('[SC] ChangeServiceConfig SUCCESS');
      return 0;
    }
    io.writeLine('DESCRIPTION:\n        SC is a command line program used for communicating with the\n        Service Control Manager and services.\nUSAGE:\n        sc <server> [command] [service name] <option1> <option2>...\n\n        Commands:\n          query-----------Queries the status for a service, or\n                          enumerates the status for types of services.\n          queryex---------Queries the extended status for a service.\n          start-----------Starts a service.\n          stop------------Sends a STOP request to a service.\n          config----------Changes the configuration of a service (persistent).\n          qc--------------Queries the configuration information for a service.');
    return 0;
  });

  /* ================================================================ netsh */
  function kv(args) {
    const o = {}; const pos = [];
    for (const a of args) { const m = a.match(/^(\w+)=(.*)$/); if (m) o[lc(m[1])] = m[2].replace(/^"|"$/g, ''); else pos.push(a.replace(/^"|"$/g, '')); }
    return { o, pos };
  }
  function netshFirewallRule(rest, io) {
    const op = lc(rest[0] || '');
    const { o } = kv(rest.slice(1));
    if (op === 'add' && lc(rest[1]) === 'rule') {
      if (!o.name || !o.dir || !o.action) { io.writeLine('\nA specified value is not valid.\n\nUsage: add rule name=<string>\n      dir=in|out\n      action=allow|block|bypass\n      [program=<program path>]\n      [service=<service short name>|any]\n      [description=<string>]\n      [enable=yes|no (default=yes)]\n      [profile=public|private|domain|any[,...]]\n      [localip=any|<IPv4 address>|<IPv6 address>|<subnet>|<range>|<list>]\n      [protocol=0-255|icmpv4|icmpv6|icmpv4:type,code|icmpv6:type,code|\n         tcp|udp|any (default=any)]\n      [localport=0-65535|<port range>[,...]|RPC|RPC-EPMap|IPHTTPS|any (default=any)]\n'); return 1; }
      const r = WS.fw.newRule({ displayName: o.name, direction: lc(o.dir) === 'out' ? 'Outbound' : 'Inbound', action: lc(o.action) === 'block' ? 'Block' : 'Allow', protocol: o.protocol ? o.protocol.toUpperCase().replace('ICMPV4', 'ICMPv4').replace('ICMPV6', 'ICMPv6') : 'Any', localPort: o.localport, remotePort: o.remoteport,
        localAddress: o.localip, remoteAddress: o.remoteip, enabled: lc(o.enable || 'yes') !== 'no', profile: o.profile || 'Any', program: o.program, service: o.service, description: o.description });
      if (!r.ok) { io.writeLine(r.error); return 1; }
      io.writeLine('Ok.\n'); return 0;
    }
    if (op === 'delete' && lc(rest[1]) === 'rule') {
      const r = WS.fw.removeRule(o.name || '');
      if (!r.ok) { io.writeLine('\nNo rules match the specified criteria.\n'); return 1; }
      io.writeLine(`\nDeleted ${r.count} rule(s).\nOk.\n`); return 0;
    }
    if (op === 'set' && lc(rest[1]) === 'rule') {
      const ni = rest.findIndex(x => lc(x) === 'new');
      const sel = kv(rest.slice(2, ni < 0 ? undefined : ni)).o;
      const nw = ni < 0 ? {} : kv(rest.slice(ni + 1)).o;
      const rules = sel.group ? WS.fw.rules({ group: sel.group }) : WS.fw.find(sel.name || '');
      if (!rules.length) { io.writeLine('\nNo rules match the specified criteria.\n'); return 1; }
      const props = {};
      if (nw.enable) props.enabled = /yes/i.test(nw.enable);
      if (nw.action) props.action = lc(nw.action) === 'block' ? 'Block' : 'Allow';
      if (nw.name) props.displayName = nw.name;
      if (nw.description != null) props.description = nw.description;
      if (nw.profile) props.profile = nw.profile;
      if (nw.protocol) props.protocol = nw.protocol;
      if (nw.localport) props.localPort = nw.localport;
      if (nw.remoteport) props.remotePort = nw.remoteport;
      if (nw.localip) props.localAddress = nw.localip;
      if (nw.remoteip) props.remoteAddress = nw.remoteip;
      if (nw.program) props.program = nw.program;
      for (const r of rules) { const res = WS.fw.setRule(r.name, props); if (!res.ok) { io.writeLine(`\n${res.error}\n`); return 1; } }
      io.writeLine(`\nUpdated ${rules.length} rule(s).\nOk.\n`); return 0;
    }
    if (op === 'show' && lc(rest[1]) === 'rule') {
      const rules = !o.name || lc(o.name) === 'all' ? WS.fw.rules() : WS.fw.find(o.name);
      if (!rules.length) { io.writeLine('No rules match the specified criteria.'); return 1; }
      for (const r of rules) {
        const f = WS.fw.ruleDefaults(r);
        io.writeLine(`\nRule Name:                            ${r.displayName}\n----------------------------------------------------------------------\nEnabled:                              ${r.enabled ? 'Yes' : 'No'}\nDirection:                            ${r.direction === 'Inbound' ? 'In' : 'Out'}\nProfiles:                             ${r.profile === 'Any' ? 'Domain,Private,Public' : r.profile.replace(/\s/g, '')}\nGrouping:                             ${r.group}\nLocalIP:                              ${f.localAddress}\nRemoteIP:                             ${f.remoteAddress}\nProtocol:                             ${r.protocol}${['TCP', 'UDP'].includes(r.protocol) ? `\nLocalPort:                            ${r.localPort}\nRemotePort:                           ${f.remotePort}` : ''}\nEdge traversal:                       ${f.edgeTraversal === 'Allow' ? 'Yes' : 'No'}\nAction:                               ${r.action}`);
      }
      io.writeLine('Ok.\n'); return 0;
    }
    io.writeLine(`The following command was not found: advfirewall firewall ${rest.join(' ')}.`);
    return 1;
  }
  function netshAdvfirewall(rest, io) {
    const op = lc(rest[0] || '');
    if (op === 'firewall') return netshFirewallRule(rest.slice(1), io);
    const profMap = { allprofiles: ['Domain', 'Private', 'Public'], domainprofile: ['Domain'], privateprofile: ['Private'], publicprofile: ['Public'], currentprofile: [WS.fw.activeProfile()] };
    if (op === 'set' && profMap[lc(rest[1])]) {
      const what = lc(rest[2] || '');
      if (what === 'state') {
        const on = lc(rest[3] || '') === 'on';
        if (!['on', 'off'].includes(lc(rest[3] || ''))) { io.writeLine('\nA specified value is not valid.\n'); return 1; }
        for (const p of profMap[lc(rest[1])]) WS.fw.setProfile(p, { enabled: on });
        io.writeLine('Ok.\n'); return 0;
      }
      if (what === 'firewallpolicy') {
        const [inb, outb] = String(rest[3] || '').split(',');
        for (const p of profMap[lc(rest[1])]) WS.fw.setProfile(p, { inbound: /allow/i.test(inb) ? 'Allow' : 'Block', blockAll: /blockinboundalways/i.test(inb), outbound: /block/i.test(outb) ? 'Block' : 'Allow' });
        io.writeLine('Ok.\n'); return 0;
      }
      if (what === 'logging') {
        const key = lc(rest[3] || ''), val = rest.slice(4).join(' ').replace(/^"|"$/g, '');
        const props = key === 'droppedconnections' ? { logDropped: lc(val) === 'enable' } : key === 'allowedconnections' ? { logAllowed: lc(val) === 'enable' }
          : key === 'filename' ? { logFile: val } : key === 'maxfilesize' ? { logMaxKB: +val } : null;
        if (!props || ((key === 'droppedconnections' || key === 'allowedconnections') && !/^(enable|disable|notconfigured)$/i.test(val))) { io.writeLine('\nA specified value is not valid.\n'); return 1; }
        for (const p of profMap[lc(rest[1])]) { const r = WS.fw.setProfile(p, props); if (!r.ok) { io.writeLine(`\n${r.error}\n`); return 1; } }
        io.writeLine('Ok.\n'); return 0;
      }
    }
    if (op === 'show' && profMap[lc(rest[1])]) {
      for (const p of profMap[lc(rest[1])]) {
        const pr = WS.fw.profile(p);
        io.writeLine(`\n${p} Profile Settings: \n----------------------------------------------------------------------\nState                                 ${pr.enabled ? 'ON' : 'OFF'}\nFirewall Policy                       ${pr.blockAll ? 'BlockInboundAlways' : pr.inbound + 'Inbound'},${pr.outbound}Outbound\nLocalFirewallRules                    N/A (GPO-store only)\nLocalConSecRules                      N/A (GPO-store only)\nInboundUserNotification               ${pr.notify ? 'Enable' : 'Disable'}\nRemoteManagement                      Disable\nUnicastResponseToMulticast            Enable\n\nLogging:\nLogAllowedConnections                 ${pr.logAllowed ? 'Enable' : 'Disable'}\nLogDroppedConnections                 ${pr.logDropped ? 'Enable' : 'Disable'}\nFileName                              ${pr.logFile}\nMaxFileSize                           ${pr.logMaxKB}`);
      }
      io.writeLine('Ok.\n'); return 0;
    }
    if (op === 'reset') { WS.fw.restoreDefaults(); io.writeLine('Ok.\n'); return 0; }
    if (op === 'export' || op === 'import') {
      const path = rest.slice(1).join(' ').replace(/^"|"$/g, '');
      if (!path) { io.writeLine(`\nUsage: ${op} <path>\n`); return 1; }
      try {
        if (op === 'export') WS.fs.writeFile(path, WS.fw.exportPolicy(), io.cwd);
        else { const r = WS.fw.importPolicy(WS.fs.readFile(path, io.cwd)); if (!r.ok) { io.writeLine(`\n${r.error}\n`); return 1; } }
      } catch (e) { io.writeLine(`\nAn error occurred while attempting to contact the Windows Defender Firewall service. Make sure that the service is running and try your request again.\n`); return 1; }
      io.writeLine('Ok.\n'); return 0;
    }
    io.writeLine(`The following command was not found: advfirewall ${rest.join(' ')}.`);
    return 1;
  }
  function netshInterface(rest, io) {
    let r = rest.slice();
    const fam = lc(r[0] || '');
    if (fam === 'show' && lc(r[1] || '') === 'interface') {
      io.writeLine('\nAdmin State    State          Type             Interface Name\n-------------------------------------------------------------------------');
      for (const a of WS.net.adapters()) io.writeLine(`${(a.enabled ? 'Enabled' : 'Disabled').padEnd(15)}${(WS.net.status(a) === 'Up' || WS.net.status(a) === 'Duplicate' ? 'Connected' : 'Disconnected').padEnd(15)}${'Dedicated'.padEnd(17)}${a.name}`);
      io.writeLine(''); return 0;
    }
    if (fam === 'set' && lc(r[1] || '') === 'interface') {
      const { o, pos } = kv(r.slice(2));
      const name = o.name || o.interface || pos[0];
      const ad = WS.net.adapter(name);
      if (!ad) { io.writeLine('The filename, directory name, or volume label syntax is incorrect.\n'); return 1; }
      if (o.admin) WS.net.setEnabled(ad.name, /enable/i.test(o.admin));
      if (o.newname) WS.net.rename(ad.name, o.newname);
      return 0;
    }
    if (!['ipv4', 'ip'].includes(fam)) { io.writeLine(`The following command was not found: interface ${rest.join(' ')}.`); return 1; }
    r = r.slice(1);
    const op = lc(r[0] || ''), what = lc(r[1] || '');
    const { o, pos } = kv(r.slice(2));
    // Tagged arguments occupy their normal slots; remaining positionals fill the gaps.
    // e.g. name=Ethernet static 192.168.1.10 255.255.255.0 192.168.1.1
    if (o.interface && !o.name) o.name = o.interface;
    if (o.addr && !o.address) o.address = o.addr;
    const slots = what === 'address' ? ['name', 'source', 'address', 'mask', 'gateway']
      : op === 'set' ? ['name', 'source', 'address'] : ['name', 'address', 'index'];
    let pi = 0;
    for (const slot of slots) if (o[slot] == null && pi < pos.length) o[slot] = pos[pi++];
    const name = o.name;
    if (op === 'show' && (what === 'config' || what === 'addresses' || what === 'dnsservers' || what === 'dns')) {
      for (const a of WS.net.adapters().filter(x => !name || x.name.toLowerCase() === name.toLowerCase())) {
        if (!a.enabled) continue;
        io.writeLine(`\nConfiguration for interface "${a.name}"`);
        if (what !== 'dnsservers' && what !== 'dns') {
          io.writeLine(`    DHCP enabled:                         ${a.dhcp ? 'Yes' : 'No'}`);
          if (a.ip) io.writeLine(`    IP Address:                           ${a.ip}\n    Subnet Prefix:                        ${U.networkOf(a.ip, a.prefix)}/${a.prefix} (mask ${U.prefixToMask(a.prefix)})`);
          if (a.gateway) io.writeLine(`    Default Gateway:                      ${a.gateway}\n    Gateway Metric:                       ${a.dhcp ? 0 : 256}`);
          io.writeLine('    InterfaceMetric:                      15');
        }
        if (what !== 'addresses') {
          if (a.dnsDhcp) io.writeLine(`    DNS servers configured through DHCP:  ${a.dnsServers.join('\n                                          ') || 'None'}`);
          else io.writeLine(`    Statically Configured DNS Servers:    ${a.dnsServers.join('\n                                          ') || 'None'}`);
          io.writeLine('    Register with which suffix:           Primary only');
        }
        if (what === 'config') io.writeLine(`    ${a.dhcp ? 'WINS servers configured through DHCP:' : 'Statically Configured WINS Servers:'}   None`);
      }
      if (!name && what === 'config') io.writeLine('\nConfiguration for interface "Loopback Pseudo-Interface 1"\n    DHCP enabled:                         No\n    IP Address:                           127.0.0.1\n    Subnet Prefix:                        127.0.0.0/8 (mask 255.0.0.0)\n    InterfaceMetric:                      75\n    Statically Configured DNS Servers:    None\n    Register with which suffix:           Primary only\n    Statically Configured WINS Servers:   None');
      io.writeLine('');
      return 0;
    }
    const ad = WS.net.adapter(name || '');
    if ((op === 'set' || op === 'add' || op === 'delete') && !ad) { io.writeLine('The filename, directory name, or volume label syntax is incorrect.\n'); return 1; }
    if (op === 'set' && what === 'address') {
      const source = lc(o.source || '');
      if (source === 'dhcp') { WS.net.setDhcp(ad.name); io.writeLine(''); return 0; }
      const ip = o.address, mask = o.mask, gw = o.gateway;
      if (!U.isValidIp(ip || '')) { io.writeLine(`Invalid address parameter (${ip}). It should be a valid IPv4 address.\n`); return 1; }
      if (mask && !U.isValidMask(mask)) { io.writeLine(`Invalid mask parameter (${mask}).\n`); return 1; }
      const res = WS.net.setStatic(ad.name, { ip, mask: mask || '255.255.255.0', gateway: gw && lc(gw) !== 'none' ? gw : null });
      if (!res.ok) { io.writeLine(res.error + '\n'); return 1; }
      io.writeLine('');
      return 0;
    }
    if (op === 'set' && (what === 'dnsservers' || what === 'dnsserver' || what === 'dns')) {
      const source = lc(o.source || '');
      if (source === 'dhcp') { WS.net.setDnsServers(ad.name, null); io.writeLine(''); return 0; }
      const addr = o.address;
      if (!addr || lc(addr) === 'none') { WS.net.setDnsServers(ad.name, []); io.writeLine(''); return 0; }
      if (!U.isValidIp(addr)) { io.writeLine(`The configured DNS server is incorrect or does not exist.\n`); return 1; }
      WS.net.setDnsServers(ad.name, [addr]);
      io.writeLine('');
      return 0;
    }
    if (op === 'add' && (what === 'dnsservers' || what === 'dnsserver' || what === 'dns')) {
      const addr = o.address;
      if (!U.isValidIp(addr || '')) { io.writeLine(`The configured DNS server is incorrect or does not exist.\n`); return 1; }
      const list = ad.dnsServers.filter(x => x !== addr);
      const idx = o.index ? Math.max(0, +o.index - 1) : list.length;
      list.splice(idx, 0, addr);
      WS.net.setDnsServers(ad.name, list);
      io.writeLine('');
      return 0;
    }
    if (op === 'delete' && (what === 'dnsservers' || what === 'dnsserver' || what === 'dns')) {
      const addr = o.address;
      WS.net.setDnsServers(ad.name, !addr || lc(addr) === 'all' ? [] : ad.dnsServers.filter(x => x !== addr));
      io.writeLine('');
      return 0;
    }
    io.writeLine(`The following command was not found: interface ${rest.join(' ')}.`);
    return 1;
  }
  async function netshRun(args, io) {
    const ctx = lc(args[0] || '');
    if (ctx === 'interface' || ctx === 'int') return netshInterface(args.slice(1), io);
    if (ctx === 'advfirewall') return netshAdvfirewall(args.slice(1), io);
    if (ctx === 'firewall') { io.writeLine('\nIMPORTANT: Command executed successfully.\nHowever, "netsh firewall" is deprecated;\nuse "netsh advfirewall firewall" instead.\nFor more information on using "netsh advfirewall firewall" commands\ninstead of "netsh firewall", see KB article 947709\nat https://go.microsoft.com/fwlink/?linkid=121488 .\n'); return 0; }
    if (ctx === 'winsock' && lc(args[1] || '') === 'reset') { io.writeLine('\nSucessfully reset the Winsock Catalog.\nYou must restart the computer in order to complete the reset.\n'); return 0; }
    if (ctx === '/?' || ctx === '?' || ctx === 'help') { io.writeLine('\nUsage: netsh [-a AliasFile] [-c Context] [-r RemoteMachine] [-u [DomainName\\]UserName] [-p Password | *]\n             [Command | -f ScriptFile]\n\nThe following commands are available:\n\nCommands in this context:\n?              - Displays a list of commands.\nadvfirewall    - Changes to the `netsh advfirewall\' context.\ninterface      - Changes to the `netsh interface\' context.\nwinsock        - Changes to the `netsh winsock\' context.\n'); return 0; }
    io.writeLine(`The following command was not found: ${args.join(' ')}.`);
    return 1;
  }
  defineNative('netsh', async (argv, io) => {
    if (argv.length) return netshRun(argv, io);
    for (;;) {
      const line = await io.readLine({ prompt: 'netsh>' });
      if (line === null) return 0;
      const t = line.trim();
      if (!t) continue;
      if (/^(exit|bye|quit)$/i.test(t)) return 0;
      await netshRun(t.match(/(?:[^\s"]+|"[^"]*")+/g).map(x => x.replace(/^"|"$/g, '')), io);
    }
  });

  /* ================================================================ text filters for pipes */
  defineNative('findstr', (argv, io) => {
    const flags = argv.filter(a => /^\/\w/.test(a)).map(lc);
    const terms = argv.filter(a => !/^\/\w/.test(a));
    const ci = flags.includes('/i');
    const lit = (flags.find(f => f.startsWith('/c:')) || '').slice(3).replace(/^"|"$/g, '');
    const words = lit ? [lit] : (terms[0] || '').replace(/^"|"$/g, '').split(/\s+/).filter(Boolean);
    const lines = io.input || [];
    let hit = 0;
    for (const l of lines) {
      const t = ci ? l.toLowerCase() : l;
      const m = words.some(w => t.includes(ci ? w.toLowerCase() : w));
      if (flags.includes('/v') ? !m : m) { io.writeLine(l); hit++; }
    }
    return hit ? 0 : 1;
  });
  defineNative('find', (argv, io) => {
    const flags = argv.filter(a => /^\/\w/.test(a)).map(lc);
    const term = (argv.find(a => !/^\/\w/.test(a)) || '').replace(/^"|"$/g, '');
    const ci = flags.includes('/i');
    let hit = 0;
    for (const l of io.input || []) {
      const m = (ci ? l.toLowerCase() : l).includes(ci ? term.toLowerCase() : term);
      if (flags.includes('/v') ? !m : m) { if (!flags.includes('/c')) io.writeLine(l); hit++; }
    }
    if (flags.includes('/c')) io.writeLine(String(hit));
    return hit ? 0 : 1;
  });
  defineNative('more', (argv, io) => { for (const l of io.input || []) io.writeLine(l); return 0; });
  defineNative('sort', (argv, io) => { const l = (io.input || []).slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })); if (argv.map(lc).includes('/r')) l.reverse(); l.forEach(x => io.writeLine(x)); return 0; });
  defineNative('clip', () => 0);
  defineNative('timeout', async (argv, io) => {
    const i = argv.findIndex(a => lc(a) === '/t');
    const n = Math.min(+argv[i + 1] || 0, 60);
    for (let s = n; s > 0; s--) { io.write(`\rWaiting for ${String(s).padStart(2)} seconds, press a key to continue ...`); if (!(await io.wait(1000))) { io.writeLine('\n^C'); return 1; } }
    io.writeLine(`\rWaiting for  0 seconds, press a key to continue ...`);
    return 0;
  });
  defineNative('where', (argv, io) => {
    const name = argv.find(a => !/^\//.test(a));
    const n = native(name || '');
    if (!n) { io.writeLine('INFO: Could not find files for the given pattern(s).'); return 1; }
    io.writeLine(`C:\\Windows\\System32\\${n.name}.exe`);
    return 0;
  }, { hidden: true });

  /* ================================================================ diskpart */
  /* Interactive (DISKPART> prompt) or `diskpart /s script.txt`. Works on a focus (selected disk / partition / volume) like
   * the real tool and changes disks only through WS.storage, so Disk Management and Get-Disk see every change. */
  const DP_VERSION = '10.0.26100.1';
  const VDS = 'Virtual Disk Service error:\n';
  /** diskpart's sizes stay in a unit while the value is under 10240: "1024 KB", "16 MB", "7633 MB", "40 GB". */
  function dpSize(b) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = b || 0, i = 0;
    while (v >= 10240 && i < units.length - 1) { v /= 1024; i++; }
    return `${Math.floor(v)} ${units[i]}`;
  }
  const DP_HELP = [
    ['ACTIVE', 'Mark the selected partition as active.'], ['ASSIGN', 'Assign a drive letter or mount point to the selected volume.'],
    ['ATTRIBUTES', 'Manipulate volume or disk attributes.'], ['CLEAN', 'Clear the configuration information, or all information, off the disk.'],
    ['CONVERT', 'Convert between different disk formats.'], ['CREATE', 'Create a volume, partition or virtual disk.'],
    ['DELETE', 'Delete an object.'], ['DETAIL', 'Provide details about an object.'], ['EXIT', 'Exit DiskPart.'],
    ['EXTEND', 'Extend a volume.'], ['FORMAT', 'Format the volume or partition.'], ['HELP', 'Display a list of commands.'],
    ['LIST', 'Display a list of objects.'], ['OFFLINE', 'Offline an object that is currently marked as online.'],
    ['ONLINE', 'Online an object that is currently marked as offline.'], ['REM', 'Does nothing. This is used to comment scripts.'],
    ['REMOVE', 'Remove a drive letter or mount point assignment.'], ['RESCAN', 'Rescan the computer looking for disks and volumes.'],
    ['SAN', 'Display or set the SAN policy for the currently booted OS.'], ['SELECT', 'Shift the focus to an object.'],
    ['SHRINK', 'Reduce the size of the selected volume.']
  ];
  const dpHelpText = () => [`Microsoft DiskPart version ${DP_VERSION}`, '', ...DP_HELP.map(([c, d]) => `${c.padEnd(11)} - ${d}`)].join('\n');
  async function diskpartSession(io, lines) {
    const S = WS.storage, MB = S.MB;
    const sel = { disk: null, part: null, vol: null };   // vol: 'cd' or 'n:p'
    const out = (...l) => io.writeLine(['', ...l, ''].join('\n'));
    const say = text => { out(text); return true; };
    const fail = text => { out(text); return false; };
    const vds = r => fail(VDS + (r.error || 'The operation failed.'));
    const disk = () => (sel.disk == null ? null : S.disks().find(d => d.number === sel.disk) || null);
    const part = () => { const d = disk(); return d && sel.part != null ? d.partitions.find(p => p.number === sel.part) || null : null; };
    /** Volumes in the order diskpart numbers them: the DVD drive, the boot volume, then the rest by disk and partition. */
    function volumes() {
      const v = [];
      const cd = S.cdrom();
      if (cd) v.push({ key: 'cd', cd: true, letter: cd.letter, label: '', fs: '', type: 'DVD-ROM', size: 0, status: 'No Media', info: '' });
      const parts = [];
      for (const d of S.disks()) if (d.online && d.style !== 'RAW') for (const p of d.partitions) if (p.type !== 'Reserved') parts.push({ d, p });
      parts.sort((a, b) => a.d.number - b.d.number || (b.p.letter === 'C') - (a.p.letter === 'C') || a.p.number - b.p.number);
      for (const { d, p } of parts) {
        const used = p.fs ? S.usedBytes(p) : 0;
        v.push({ key: `${d.number}:${p.number}`, disk: d.number, part: p.number, letter: p.letter, label: p.label || '', fs: p.fs || 'RAW', type: 'Partition', size: p.size, free: Math.max(0, p.size - used),
          status: 'Healthy', info: p.letter === 'C' ? 'Boot' : p.type === 'System' ? 'System' : p.type === 'Recovery' ? 'Hidden' : '', paths: (S.volumeAt(d.number, p.number) || {}).paths || [] });
      }
      return v.map((x, i) => ({ ...x, n: i }));
    }
    const volume = () => volumes().find(v => v.key === sel.vol) || null;
    const focusVolumeOf = (n, pn) => { const v = volumes().find(x => x.key === `${n}:${pn}`); sel.vol = v ? v.key : null; };
    const needDisk = () => (disk() ? null : fail('There is no disk selected.\nPlease select a disk and try again.'));
    const needPart = () => (part() ? null : fail('There is no partition selected.\nPlease select a partition and try again.'));
    const needVol = () => (volume() || part() ? null : fail('There is no volume selected.\nPlease select a volume and try again.'));
    /** The selected volume as a { disk, part } model target (a partition focus counts too). */
    const target = () => {
      const v = volume();
      if (v && v.cd) return { cd: true };
      const n = v ? v.disk : sel.disk, pn = v ? v.part : sel.part;
      const d = S.disk(n);
      const p = d && d.partitions.find(x => x.number === pn);
      return p ? { disk: d, part: p } : null;
    };
    const syntax = cmd => fail(`The arguments specified for this command are not valid.\nFor more information on the command type: HELP ${cmd}`);
    const diskTable = list => ['  Disk ###  Status         Size     Free     Dyn  Gpt', '  --------  -------------  -------  -------  ---  ---',
      ...list.map(d => `${d.number === sel.disk ? '*' : ' '} ${('Disk ' + d.number).padEnd(8)}  ${d.status.padEnd(13)}  ${dpSize(d.size).padStart(7)}  ${dpSize(d.style === 'RAW' ? d.size : d.unallocated).padStart(7)}  ${'   '}  ${d.style === 'GPT' ? ' * ' : ''}`.replace(/\s+$/, ''))].join('\n');
    const volTable = list => ['  Volume ###  Ltr  Label        Fs     Type        Size     Status     Info', '  ----------  ---  -----------  -----  ----------  -------  ---------  --------',
      ...list.map(v => `${v.key === sel.vol ? '*' : ' '} ${('Volume ' + v.n).padEnd(10)}   ${v.letter || ' '}   ${v.label.slice(0, 11).padEnd(11)}  ${(v.fs || '').padEnd(5)}  ${v.type.padEnd(10)}  ${dpSize(v.size).padStart(7)}  ${v.status.padEnd(9)}  ${v.info}`.replace(/\s+$/, '') + (v.paths || []).map(x => '\n    ' + x).join(''))].join('\n');
    const word = (t, w) => !!t && w.startsWith(t) && t.length >= Math.min(3, w.length);
    const ptype = (d, p) => (p.type === 'Basic' ? 'Primary' : p.type);

    function run(line) {
      // a token may contain quoted parts: label="My Data" is one token
      const toks = (line.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(x => x.replace(/"/g, ''));
      if (!toks.length) return true;
      const [c0, c1] = [toks[0].toLowerCase(), (toks[1] || '').toLowerCase()];
      const args = {}, flags = new Set();
      for (const t of toks.slice(1)) { const m = t.match(/^([a-z]+)=(.*)$/i); if (m) args[m[1].toLowerCase()] = m[2]; else flags.add(t.toLowerCase()); }
      const num = x => (x != null && /^\d+$/.test(x) ? +x : null);
      if (c0 === 'rem') return true;
      if (word(c0, 'help') || c0 === '?') return say(dpHelpText());
      if (word(c0, 'list')) {
        if (word(c1, 'disk')) return say(diskTable(S.disks()));
        if (word(c1, 'volume')) return say(volTable(volumes()));
        if (word(c1, 'partition')) {
          const d = disk();
          if (!d) return fail('There is no disk selected to list partitions.\nSelect a disk and try again.');
          const ps = d.online && d.style !== 'RAW' ? d.partitions.slice().sort((a, b) => a.offset - b.offset) : [];
          if (!ps.length) return say('There are no partitions on this disk to show.');
          return say(['  Partition ###  Type              Size     Offset', '  -------------  ----------------  -------  -------',
            ...ps.map(p => `${p.number === sel.part ? '*' : ' '} ${('Partition ' + p.number).padEnd(13)}  ${ptype(d, p).padEnd(16)}  ${dpSize(p.size).padStart(7)}  ${dpSize(p.offset).padStart(7)}`)].join('\n'));
        }
        return say(['Microsoft DiskPart version ' + DP_VERSION, '', 'DISK        - Display a list of disks. For example, LIST DISK.', 'PARTITION   - Display a list of partitions on the selected disk.', 'VOLUME      - Display a list of volumes. For example, LIST VOLUME.'].join('\n'));
      }
      if (word(c0, 'select')) {
        const which = toks[2];
        if (word(c1, 'disk')) {
          const d = S.disks().find(x => x.number === num(which));
          if (!d) { sel.disk = null; sel.part = null; return fail('The disk you specified is not valid.\n\nThere is no disk selected.'); }
          sel.disk = d.number; sel.part = null; sel.vol = null;
          return say(`Disk ${d.number} is now the selected disk.`);
        }
        if (word(c1, 'partition')) {
          if (needDisk()) return false;
          const p = disk().partitions.find(x => x.number === num(which));
          if (!p || !disk().online) { sel.part = null; return fail('The partition you specified is not valid.\nPlease select a valid partition.\n\nThere is no partition selected.'); }
          sel.part = p.number; focusVolumeOf(sel.disk, p.number);
          return say(`Partition ${p.number} is now the selected partition.`);
        }
        if (word(c1, 'volume')) {
          const list = volumes();
          const v = num(which) != null ? list.find(x => x.n === num(which)) : list.find(x => x.letter && which && x.letter === which.replace(':', '').toUpperCase());
          if (!v) { sel.vol = null; return fail('The volume you selected is not valid or does not exist.'); }
          sel.vol = v.key;
          if (!v.cd) { sel.disk = v.disk; sel.part = v.part; }
          return say(`Volume ${v.n} is the selected volume.`);
        }
        return syntax('SELECT');
      }
      if (word(c0, 'online') || word(c0, 'offline')) {
        const on = word(c0, 'online');
        if (!word(c1, 'disk')) return syntax(on ? 'ONLINE' : 'OFFLINE');
        if (needDisk()) return false;
        if (disk().online === on) return fail(VDS + `This disk is already ${on ? 'online' : 'offline'}.`);
        const r = S.setOnline(sel.disk, on);
        if (!r.ok) return vds(r);
        return say(`DiskPart successfully ${on ? 'onlined' : 'offlined'} the selected disk.`);
      }
      if (word(c0, 'attributes')) {
        if (!word(c1, 'disk')) return syntax('ATTRIBUTES');
        if (needDisk()) return false;
        const d = disk();
        if (flags.has('readonly') && (flags.has('set') || flags.has('clear'))) {
          const r = S.setReadOnly(d.number, flags.has('set'));
          if (!r.ok) return vds(r);
          return say(`Disk attributes ${flags.has('set') ? 'set' : 'cleared'} successfully.`);
        }
        const yn = v => (v ? 'Yes' : 'No');
        return say([`Current Read-only State : ${yn(d.readOnly)}`, `Read-only  : ${yn(d.readOnly)}`, `Boot Disk  : ${yn(d.boot)}`, `Pagefile Disk  : ${yn(d.boot)}`,
          'Hibernation File Disk  : No', `Crashdump Disk  : ${yn(d.boot)}`, 'Clustered Disk  : No'].join('\n'));
      }
      if (word(c0, 'clean')) {
        if (needDisk()) return false;
        if (disk().boot) return fail(VDS + 'Clean is not allowed on the disk containing the current boot, system, pagefile, crashdump or hibernation volume.');
        if (!disk().online) return fail(VDS + 'The disk is offline.');
        const r = S.clearDisk(sel.disk);
        if (!r.ok) return vds(r);
        sel.part = null; sel.vol = null;
        return say('DiskPart succeeded in cleaning the disk.');
      }
      if (word(c0, 'convert')) {
        const style = c1 === 'gpt' ? 'GPT' : c1 === 'mbr' ? 'MBR' : null;
        if (!style) return c1 === 'dynamic' || c1 === 'basic' ? fail(VDS + 'The operation is not supported on this disk.') : syntax('CONVERT');
        if (needDisk()) return false;
        const d = disk();
        if (!d.online) return fail(VDS + 'The disk is offline.');
        if (d.style === style) return fail(VDS + 'The specified disk is not convertible. CDROMs and DVDs are examples of disks that are not convertible.');
        const r = d.style === 'RAW' ? S.initialize(d.number, style) : S.convertStyle(d.number, style);
        if (!r.ok) return fail(VDS + (r.code === 'NotEmpty' ? 'The specified disk is not convertible because it contains partitions. Delete them, or use CLEAN, and try again.' : r.error));
        return say(`DiskPart successfully converted the selected disk to ${style} format.`);
      }
      if (word(c0, 'create')) {
        if (!word(c1, 'partition')) return c1 === 'volume' || c1 === 'vdisk' ? fail(VDS + 'The operation is not supported in this lab.') : syntax('CREATE');
        const kind = (toks[2] || '').toLowerCase();
        if (!word(kind, 'primary')) return word(kind, 'extended') || word(kind, 'logical') || kind === 'efi' || kind === 'msr' ? fail(VDS + 'The specified command or parameters are not supported on this system.') : syntax('CREATE PARTITION');
        if (needDisk()) return false;
        let d = disk();
        if (!d.online) return fail(VDS + 'The disk is offline.');
        if (d.style === 'RAW') { const i = S.initialize(d.number, 'MBR'); if (!i.ok) return vds(i); d = disk(); }   // diskpart initializes a RAW disk as MBR
        const size = args.size != null ? num(args.size) : null;
        if (args.size != null && !size) return syntax('CREATE PARTITION PRIMARY');
        const r = S.newPartition(d.number, { size: size ? size * MB : 'max', letter: null });
        if (!r.ok) return fail(VDS + (r.code === 'NotEnoughSpace' ? 'There is not enough usable space for this operation.' : r.error));
        sel.part = r.partition.number; focusVolumeOf(d.number, r.partition.number);
        return say('DiskPart succeeded in creating the specified partition.');
      }
      if (word(c0, 'format')) {
        if (needVol()) return false;
        const t = target();
        if (!t || t.cd) return fail(VDS + 'The device is not ready.');
        const unit = args.unit ? (/^(\d+)k$/i.test(args.unit) ? +args.unit.slice(0, -1) * 1024 : num(args.unit)) : 0;
        if (args.unit && !unit) return syntax('FORMAT');
        const r = S.format(t, { fs: args.fs || 'NTFS', label: args.label || '', au: unit, compress: flags.has('compress') });
        if (!r.ok) return vds(r);
        focusVolumeOf(t.disk.number, t.part.number);
        return say('  100 percent completed\n\nDiskPart successfully formatted the volume.');
      }
      if (word(c0, 'assign') || word(c0, 'remove')) {
        const add = word(c0, 'assign');
        if (needVol()) return false;
        const t = target();
        const letter = args.letter ? args.letter.replace(':', '').toUpperCase() : null;
        let r;
        if (args.mount != null) {
          // assign/remove mount=<empty NTFS folder>: a folder access path
          if (t.cd || !args.mount) return syntax(add ? 'ASSIGN' : 'REMOVE');
          r = add ? S.addAccessPath(t.disk.number, t.part.number, args.mount) : S.removeAccessPath(t.disk.number, t.part.number, args.mount);
          if (!r.ok) return fail(VDS + (r.code === 'NotEmpty' ? 'The directory is not empty.' : r.code === 'PathNotFound' ? 'The system cannot find the path specified.' : r.code === 'NotFound' ? 'The specified mount point is not valid.' : r.error));
          return say(`DiskPart successfully ${add ? 'assigned' : 'removed'} the drive letter or mount point.`);
        }
        if (t.cd) r = S.setCdromLetter(add ? letter || S.nextLetter() : null);
        else if (add) r = t.part.letter ? (letter ? S.setLetter(t.part.letter, letter) : { ok: false, error: 'The volume already has a drive letter.' }) : S.assignLetter(t.disk.number, t.part.number, letter || 'auto');
        else r = t.part.letter ? S.setLetter(t.part.letter, null) : { ok: false, error: 'The volume does not have a drive letter or mount point.' };
        if (!r.ok) return fail(VDS + (r.code === 'LetterInUse' ? 'The specified drive letter is not free to be assigned.' : r.error));
        return say(`DiskPart successfully ${add ? 'assigned' : 'removed'} the drive letter or mount point.`);
      }
      if (word(c0, 'delete')) {
        const vol = word(c1, 'volume');
        if (!vol && !word(c1, 'partition')) return c1 === 'disk' ? fail(VDS + 'The operation is not supported on basic disks.') : syntax('DELETE');
        if (vol ? needVol() : needPart()) return false;
        const t = target();
        if (!t || t.cd) return fail(VDS + 'The operation is not supported on this volume.');
        const r = S.deletePartition(t.disk.number, t.part.number);
        if (!r.ok) return vds(r);
        sel.part = null; sel.vol = null;
        return say(vol ? 'DiskPart successfully deleted the volume.' : 'DiskPart successfully deleted the selected partition.');
      }
      if (word(c0, 'extend') || word(c0, 'shrink')) {
        const grow = word(c0, 'extend');
        if (needVol()) return false;
        const t = target();
        if (!t || t.cd || !t.part.letter || !t.part.fs) return fail(VDS + 'The volume cannot be extended because the file system does not support it.');
        const sz = S.supportedSize(t.part.letter);
        if (grow) {
          const max = Math.floor((sz.max - t.part.size) / MB);
          const want = args.size != null ? num(args.size) : max;
          if (want == null) return syntax('EXTEND');
          if (max < 1 || want > max) return fail(VDS + 'There is not enough usable space for this operation.');
          const r = S.resize(t.part.letter, t.part.size + want * MB);
          return r.ok ? say('DiskPart successfully extended the volume.') : vds(r);
        }
        if (t.part.fs !== 'NTFS') return fail(VDS + 'The volume cannot be shrunk because the file system does not support it.');
        const max = Math.max(0, Math.floor((t.part.size - sz.min) / MB));
        if (flags.has('querymax')) return say(`The maximum number of reclaimable bytes is:  ${dpSize(max * MB)}`);
        const want = args.desired != null ? num(args.desired) : max;
        if (want == null || want < 1) return syntax('SHRINK');
        if (want > max) return fail(VDS + 'The specified shrink size is too big and will cause the volume to be smaller than the minimum volume size.');
        const r = S.resize(t.part.letter, t.part.size - want * MB);
        return r.ok ? say(`DiskPart successfully shrunk the volume by:  ${dpSize(want * MB)}`) : vds(r);
      }
      if (word(c0, 'active')) {
        if (needPart()) return false;
        if (disk().style !== 'MBR') return fail(VDS + 'The selected disk is not a fixed MBR disk.\nThe ACTIVE command can only be used on fixed MBR disks.');
        const r = S.setActive(sel.disk, sel.part);
        return r.ok ? say('DiskPart marked the current partition as active.') : vds(r);
      }
      if (word(c0, 'detail')) {
        if (word(c1, 'disk')) {
          if (needDisk()) return false;
          const d = disk(), yn = v => (v ? 'Yes' : 'No');
          const mine = volumes().filter(v => v.disk === d.number);
          return say([d.model, `Disk ID: ${d.style === 'GPT' ? '{' + U.hashStr('disk' + d.number).toString(16).toUpperCase().padStart(8, '0') + '-0000-4000-8000-00155D010000}' : U.hashStr('disk' + d.number).toString(16).toUpperCase().padStart(8, '0')}`,
            'Type   : SCSI', `Status : ${d.status}`, 'Path   : 0', 'Target : 0', `LUN ID : ${d.number}`, 'Location Path : UNAVAILABLE', `Current Read-only State : ${yn(d.readOnly)}`, `Read-only  : ${yn(d.readOnly)}`,
            `Boot Disk  : ${yn(d.boot)}`, `Pagefile Disk  : ${yn(d.boot)}`, 'Hibernation File Disk  : No', `Crashdump Disk  : ${yn(d.boot)}`, 'Clustered Disk  : No', '',
            mine.length ? volTable(mine) : 'There are no volumes.'].join('\n'));
        }
        if (word(c1, 'partition')) {
          if (needPart()) return false;
          const p = part(), v = volumes().find(x => x.key === `${sel.disk}:${p.number}`);
          const gptType = { System: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b', Reserved: 'e3c9e316-0b5c-4db8-817d-f92df00215ae', Recovery: 'de94bba4-06d1-4d40-a16a-bfd50179d6ac', Basic: 'ebd0a0a2-b9e5-4433-87c0-68b6b72699c7' }[p.type];
          return say([`Partition ${p.number}`, `Type    : ${disk().style === 'GPT' ? gptType : p.type === 'Basic' ? '07' : '27'}`, `Hidden  : ${p.type === 'Basic' ? 'No' : 'Yes'}`, `Required: ${p.type === 'System' || p.type === 'Recovery' ? 'Yes' : 'No'}`,
            'Attrib  : 0000000000000000', `Offset in Bytes: ${p.offset}`, '', v ? volTable([v]) : 'There is no volume associated with this partition.'].join('\n'));
        }
        if (word(c1, 'volume')) {
          if (needVol()) return false;
          const v = volume() || volumes().find(x => x.key === `${sel.disk}:${sel.part}`);
          if (!v || v.cd) return fail('There are no disks attached to this volume.');
          return say([diskTable(S.disks().filter(d => d.number === v.disk)), '', 'Read-only              : No', `Hidden                 : ${v.info === 'Hidden' || v.info === 'System' ? 'Yes' : 'No'}`, 'No Default Drive Letter: No', 'Shadow Copy            : No',
            'Offline                : No', 'BitLocker Encrypted    : No', 'Installable            : Yes', '', `Volume Capacity        : ${dpSize(v.size).padStart(7)}`, `Volume Free Space      : ${dpSize(v.free).padStart(7)}`].join('\n'));
        }
        return syntax('DETAIL');
      }
      if (word(c0, 'rescan')) return say('Please wait while DiskPart scans your configuration...\n\nDiskPart has finished scanning your configuration.');
      if (c0 === 'san') {
        if (args.policy) { const r = S.setSanPolicy(args.policy); return r.ok ? say('DiskPart successfully changed the SAN policy for the current operating system.') : syntax('SAN'); }
        const label = { OnlineAll: 'Online All', OfflineAll: 'Offline All', OfflineShared: 'Offline Shared', OfflineInternal: 'Offline Internal' }[S.sanPolicy()];
        return say(`SAN Policy  : ${label}`);
      }
      return say(dpHelpText());
    }

    io.writeLine(`\nMicrosoft DiskPart version ${DP_VERSION}\n\nCopyright (C) Microsoft Corporation.\nOn computer: ${WS.sys.name}`);
    if (lines) {   // /s script: no prompts; stop at the first error (unless the line ends in NOERR)
      for (const raw of lines) {
        const l = raw.replace(/\s+noerr\s*$/i, '');
        if (/^\s*exit\s*$/i.test(l)) break;
        if (!run(l) && l === raw) { io.writeLine('DiskPart has encountered an error: The operation failed.\nSee the System Event Log for more information.\n'); return 1; }
      }
      io.writeLine('\nLeaving DiskPart...');
      return 0;
    }
    io.writeLine('');
    for (;;) {
      const line = await io.readLine({ prompt: 'DISKPART> ' });
      if (line === null) return 0;
      if (/^\s*exit\s*$/i.test(line)) { io.writeLine('\nLeaving DiskPart...'); return 0; }
      run(line.trim());
    }
  }
  defineNative('diskpart', async (argv, io) => {
    const si = argv.findIndex(a => /^[/-]s$/i.test(a));
    if (si >= 0) {
      const path = argv[si + 1];
      let text;
      try { text = WS.fs.readFile(path, io.cwd); } catch (e) { io.writeLine(`\nMicrosoft DiskPart version ${DP_VERSION}\n\nThe system cannot find the file specified.\n`); return 1; }
      return diskpartSession(io, text.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    }
    if (argv.some(a => /^[/-]\?$/.test(a))) { io.writeLine(`\nMicrosoft DiskPart version ${DP_VERSION}\n\nDISKPART [/add | /delete] <device type> <device name>\nDISKPART /s <script>\nDISKPART /?`); return 0; }
    return diskpartSession(io, null);
  });

  /* ================================================================ mountvol */
  const MOUNTVOL_HELP = `Creates, deletes, or lists a volume mount point.

MOUNTVOL [drive:]path VolumeName
MOUNTVOL [drive:]path /D
MOUNTVOL [drive:]path /L
MOUNTVOL [drive:]path /P
MOUNTVOL /R
MOUNTVOL /N
MOUNTVOL /E
MOUNTVOL drive: /S

    path        Specifies the existing NTFS directory where the mount
                point will reside.
    VolumeName  Specifies the volume name that is the target of the mount
                point.
    /D          Removes the volume mount point from the specified directory.
    /L          Lists the mounted volume name for the specified directory.
    /P          Removes the volume mount point from the specified directory,
                dismounts the volume, and makes the volume not mountable.
                You can make the volume mountable again by creating a volume
                mount point.
    /R          Removes volume mount point directories and registry settings
                for volumes that are no longer in the system.
    /N          Disables automatic mounting of new volumes.
    /E          Re-enables automatic mounting of new volumes.
    /S          Mount the EFI System Partition on the given drive.
`;
  defineNative('mountvol', (argv, io) => {
    const S = WS.storage;
    const vols = () => S.volumes().filter(v => v.type !== 'Reserved');
    const flag = f => argv.some(a => a.toLowerCase() === f);
    const fail = msg => { io.writeLine(msg); return 1; };
    if (!argv.length || argv.some(a => a === '/?')) {
      io.writeLine(MOUNTVOL_HELP + '\nPossible values for VolumeName along with current mount points are:\n');
      const cd = S.cdrom();
      const list = vols().map(v => [v.path, v.letter || v.paths.length ? [...(v.letter ? [v.letter + ':\\'] : []), ...v.paths] : null]);
      if (cd) list.push([`\\\\?\\Volume{${U.hashStr('cdrom').toString(16).padStart(8, '0')}-0000-0000-0000-000000000000}\\`, cd.letter ? [cd.letter + ':\\'] : null]);
      for (const [path, mounts] of list) io.writeLine(`    ${path}\n${mounts ? mounts.map(m => '        ' + m).join('\n') : '        *** NO MOUNT POINTS ***'}\n`);
      return 0;
    }
    if (flag('/r') || flag('/n') || flag('/e')) return 0;
    const rest = argv.filter(a => !/^\/[a-z]$/i.test(a));
    if (!rest.length) return fail('The parameter is incorrect.\n');
    let dir;
    try { dir = WS.fs.full(rest[0].replace(/\\+$/, ''), io.cwd); } catch (e) { return fail('The system cannot find the path specified.\n'); }
    if (flag('/d') || flag('/p')) {
      const v = S.volumeByPath(dir);
      if (!v) return fail('The file or directory is not a reparse point.\n');
      const r = S.removeAccessPath(v.disk, v.partition, dir);
      return r.ok ? 0 : fail(r.error + '\n');
    }
    if (flag('/l')) {
      const v = S.volumeByPath(dir);
      if (!v) return fail('The file or directory is not a reparse point.\n');
      io.writeLine('    ' + v.path);
      return 0;
    }
    if (rest.length < 2) return fail('The parameter is incorrect.\n');
    const target = vols().find(v => v.path.toLowerCase() === rest[1].toLowerCase());
    if (!target) return fail('The parameter is incorrect.\n');
    const r = S.addAccessPath(target.disk, target.partition, dir);
    if (r.ok) return 0;
    return fail((r.code === 'PathNotFound' ? 'The system cannot find the file specified.' : r.code === 'InUse' ? 'The volume mount point already exists.' : r.error) + '\n');
  });

  /* ================================================================ launchers */
  const LAUNCH = [
    ['notepad', 'notepad', 'Notepad'], ['servermanager', 'servermanager', 'Server Manager'], ['services.msc', 'services', 'Services'], ['sysdm.cpl', 'sysdm', 'System Properties'],
    ['timedate.cpl', 'timedate', 'Date and Time'], ['control', 'control', 'Control Panel'], ['ncpa.cpl', 'ncpa', 'Network Connections'], ['dsa.msc', 'dsa', 'Active Directory Users and Computers'],
    ['dnsmgmt.msc', 'dnsmgmt', 'DNS Manager'], ['dhcpmgmt.msc', 'dhcpmgmt', 'DHCP'], ['eventvwr', 'eventvwr', 'Event Viewer'], ['eventvwr.msc', 'eventvwr', 'Event Viewer'],
    ['compmgmt.msc', 'compmgmt', 'Computer Management'], ['diskmgmt.msc', 'diskmgmt', 'Disk Management'], ['gpmc.msc', 'gpmc', 'Group Policy Management'], ['wf.msc', 'wf', 'Windows Defender Firewall with Advanced Security'],
    ['firewall.cpl', 'firewall', 'Windows Defender Firewall'], ['lusrmgr.msc', 'lusrmgr', 'Local Users and Groups'], ['taskmgr', 'taskmgr', 'Task Manager'], ['explorer', 'explorer', 'File Explorer'],
    ['msinfo32', 'msinfo32', 'System Information'], ['regedit', 'regedit', 'Registry Editor'], ['mstsc', 'mstsc', 'Remote Desktop Connection'], ['mmc', 'mmc', 'Microsoft Management Console'],
    ['dsac', 'dsac', 'Active Directory Administrative Center'], ['gpedit.msc', 'gpedit', 'Local Group Policy Editor'], ['inetmgr', 'inetmgr', 'Internet Information Services (IIS) Manager'],
    ['virtmgmt.msc', 'virtmgmt', 'Hyper-V Manager'], ['perfmon', 'perfmon', 'Performance Monitor'], ['resmon', 'resmon', 'Resource Monitor'], ['msconfig', 'msconfig', 'System Configuration'],
    ['appwiz.cpl', 'appwiz', 'Programs and Features'], ['powershell_ise', 'ise', 'Windows PowerShell ISE'], ['taskschd.msc', 'taskschd', 'Task Scheduler'], ['certlm.msc', 'certlm', 'Certificates - Local Computer'],
    ['fsmgmt.msc', 'fsmgmt', 'Shared Folders'], ['devmgmt.msc', 'devmgmt', 'Device Manager'], ['hdwwiz.cpl', 'devmgmt', 'Device Manager'],
    ['msedge', 'edge', 'Microsoft Edge'], ['systemsettings', 'settings', 'Settings'], ['control.exe', 'control', 'Control Panel'], ['inetcpl.cpl', 'inetcpl', 'Internet Properties']
  ];
  /* Control Panel applets that open a Settings page on Windows Server 2025 */
  const CPL_SETTINGS = { 'desk.cpl': 'display', 'mmsys.cpl': 'sound', 'powercfg.cpl': 'power', 'intl.cpl': 'regionlanguage', 'main.cpl': 'bluetooth' };
  for (const [cmd, app, label] of LAUNCH) defineNative(cmd, (argv, io) => { io.launch(app, label); return 0; }, { launcher: true, hidden: /\./.test(cmd) });
  const SHELLS = { cmd: 'cmd', powershell: 'powershell', wt: 'terminal', windowsterminal: 'terminal', notepad: 'notepad', explorer: 'explorer', taskmgr: 'taskmgr', servermanager: 'servermanager' };
  const EDITABLE = /\.(txt|log|ini|inf|ps1|psm1|cmd|bat|xml|csv|cfg|conf|json|md|reg)$/i;
  /**
   * What Run, Task Manager's Create new task, Start-Process and start open for some text:
   * { app, label, args } or null ("Windows cannot find ...").
   */
  function resolveLaunch(text, cwd) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const m = /^"([^"]+)"\s*(.*)$/.exec(raw) || /^(\S+)\s*(.*)$/.exec(raw);
    const first = m[1], rest = m[2].replace(/^"|"$/g, '');
    const base = first.replace(/^.*\\/, '').toLowerCase(), plain = base.replace(/\.(exe|com)$/, '');
    if (plain === 'mmc' && rest) return resolveLaunch(rest.replace(/^.*\\/, ''), cwd);
    const known = LAUNCH.find(([c]) => c === base || c === plain);
    // ms-settings:<page> opens Settings; web addresses open Microsoft Edge
    const ms = /^ms-settings:(\S*)$/i.exec(raw);
    if (ms) return { app: 'settings', label: 'Settings', args: { page: ms[1] || 'system' } };
    if (/^(https?|ftp):\/\//i.test(raw) || /^www\.[^\s]+$/i.test(raw)) return { app: 'edge', label: 'Microsoft Edge', args: { url: raw } };
    if (CPL_SETTINGS[base]) return { app: 'settings', label: 'Settings', args: { page: CPL_SETTINGS[base] } };
    if (plain === 'msedge' && rest) return { app: 'edge', label: 'Microsoft Edge', args: { url: rest } };
    if (plain === 'control' && rest) { const sub = rest.toLowerCase().replace(/^\/name\s+/, ''); const page = { 'microsoft.programsandfeatures': 'appwiz', 'appwiz.cpl': 'appwiz', 'microsoft.administrativetools': null, 'admintools': null }; if (sub in page) return page[sub] ? { app: page[sub], label: 'Programs and Features', args: {} } : { app: 'control', label: 'Control Panel', args: { page: 'tools' } }; return resolveLaunch(rest, cwd) || { app: 'control', label: 'Control Panel', args: {} }; }
    if (SHELLS[plain]) {
      const app = SHELLS[plain];
      if (app === 'explorer' && rest) return { app, label: 'File Explorer', args: { path: rest } };
      if (app === 'notepad' && rest) return { app, label: 'Notepad', args: { path: WS.fs.full(rest, cwd) } };
      return { app, label: (known && known[2]) || app, args: {} };
    }
    if (known) return { app: known[1], label: known[2], args: {} };
    let st = null;
    try { st = WS.fs.stat(raw.replace(/^"|"$/g, ''), cwd); } catch (e) { st = null; }
    if (st && st.type === 'dir') return { app: 'explorer', label: 'File Explorer', args: { path: st.path } };
    if (st && EDITABLE.test(st.path)) return { app: 'notepad', label: 'Notepad', args: { path: st.path } };
    if (st && /\.html?$/i.test(st.path)) return { app: 'edge', label: 'Microsoft Edge', args: { url: st.path } };
    if (st && /\.msc$/i.test(st.path)) return resolveLaunch(st.name, cwd);
    if (st && /\.exe$/i.test(st.path)) { const k = LAUNCH.find(([c]) => c === st.name.toLowerCase().replace(/\.exe$/, '')); return k ? { app: k[1], label: k[2], args: {} } : { app: null, label: st.name, args: {} }; }
    return null;
  }
  function launchResolved(r) { if (!r) return false; if (r.app && WS.apps.get(r.app)) WS.apps.launch(r.app, r.args); else WS.apps.notImplemented(r.label); return true; }
  defineNative('start', (argv, io) => {
    const args = argv.filter(x => !/^\/(min|max|wait|b|i|normal|high|low|realtime|abovenormal|belownormal)$/i.test(x));
    if (args.length && /^".*"$/.test(args[0]) && args.length > 1) args.shift(); // the window title
    if (!args.length) { io.launch('cmd', 'Command Prompt'); return 0; }
    const r = resolveLaunch(args.join(' '), io.cwd);
    if (!r) { WS.ui.msgbox({ title: args[0], icon: 'error', message: `Windows cannot find '${args[0]}'. Make sure you typed the name correctly, and then try again.` }); return 1; }
    launchResolved(r);
    return 0;
  }, { hidden: true });
  defineNative('winver', () => { WS.ui.msgbox({ title: 'About Windows', icon: 'info', message: `Microsoft Windows Server\nVersion 24H2 (OS Build ${WS.state.system.build})`, detail: '© Microsoft Corporation. All rights reserved.\n\nWindows Server 2025 Lab Simulator - a training mock-up, not affiliated with Microsoft.' }); return 0; });
  defineNative('dcpromo', (argv, io) => {
    WS.ui.msgbox({ title: 'Active Directory Domain Services Installation Wizard', icon: 'info', message: 'The Active Directory Domain Services Installation Wizard is relocated in Server Manager. For more information, see http://go.microsoft.com/fwlink/?LinkId=220921.' });
    io.writeLine('');
    return 0;
  });
  defineNative('sconfig', async (argv, io) => {
    if (!WS.term.sconfig) { io.writeLine('SConfig is not available.'); return 1; }
    return WS.term.sconfig(io);
  });

  /* ================================================================ nested shells */
  defineNative('cmd', async (argv, io) => {
    if (!WS.term.CmdSession) return 1;
    const s = new WS.term.CmdSession({ console: io.console, cwd: io.cwd, history: io.session.lineHistory });
    const ci = argv.findIndex(a => /^\/[ck]$/i.test(a));
    if (s.disabledByPolicy() === 1 || (s.disabledByPolicy() && ci < 0)) { io.writeLine('The command prompt has been disabled by your administrator.\n'); return 1; }
    if (ci >= 0) {
      const line = argv.slice(ci + 1).join(' ');
      // /c output goes through io so PowerShell can capture or pipe it
      s.console = { write: t => io.write(t), writeLine: t => io.writeLine(t), readLine: o => io.readLine(o), cols: () => (io.console && io.console.cols ? io.console.cols() : 120),
        setTitle() {}, setProgress() {}, clear() {}, onInterrupt: () => () => {} };
      await s.execute(line);
      if (/^\/c$/i.test(argv[ci])) return s.lastExit || 0;
    }
    s.console = io.console;
    if (ci < 0) s.banner();
    await s.repl();
    return s.exitCode || 0;
  });
  defineNative('powershell', async (argv, io) => {
    const s = new WS.ps.Session({ console: io.console, cwd: io.cwd, history: io.session.lineHistory });
    const ci = argv.findIndex(a => /^-c(ommand)?$/i.test(a));
    const cmdText = ci >= 0 ? argv.slice(ci + 1).join(' ') : argv.filter(a => !/^-/.test(a)).join(' ');
    if (cmdText) {
      const out = [];
      await s.execute(cmdText, { capture: out });
      PS().formatOut(out, 120).forEach(l => io.writeLine(l));
      return s.lastSuccess ? 0 : 1;
    }
    s.banner();
    await s.repl();
    return s.exitCode || 0;
  });
  const PS = () => WS.ps;

  WS.term = WS.term || {};
  Object.assign(WS.term, { defineNative, native, reachable, nativeNames, makeIO, natives, ipconfigText, processList, resolveLaunch, launchResolved });
})();
