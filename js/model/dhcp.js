/* DHCP Server model: WS.dhcp. Scopes, exclusions, reservations, options, authorization and leases,
 * for the DHCP console and *-DhcpServerv4* cmdlets / netsh dhcp.
 * Simulated clients: LAN peers with dhcpClient:true (CLIENT01) get their address from the lab router
 * while network.lan.dhcp.enabled is true; switch the router's DHCP off (a lab setup can do this) and
 * they lease from this server instead - if it is installed, running, authorized (on a domain) and has an
 * active scope for the LAN. Otherwise they fall back to APIPA (169.254.x.x).
 * State: dhcp.authorized, dhcp.configured, dhcp.serverOptions{code: value}, dhcp.scopes[] = { id, name, description,
 *   start, end, prefix, leaseDays, active, exclusions[{start,end}], reservations[{ip,mac,name,description}],
 *   options{code: value}, leases[{ip, mac, hostname, expires, type}] }.
 * Later additions (absent from older saved states, so always read with a fallback): scope.type ('Dhcp'|'Bootp'|'Both'),
 *   scope.delay (subnet delay, ms), scope.leaseUnlimited, reservation.type ('Both'|'Dhcp'|'Bootp'),
 *   dhcp.filters = { allow[{mac, description}], deny[...], allowEnabled, denyEnabled } (MAC 'AA-BB-...' or a pattern
 *   such as '00-15-5D-*'). With the Deny list enabled a listed client gets no lease; with the Allow list enabled only
 *   listed clients do (the others fall back to APIPA).
 * Added API: addFilter(list, mac, description), removeFilter(mac, list?), setFilterList({allow, deny}), filters(),
 *   filterOf(mac) -> 'allow'|'deny'|null, isFiltered(mac), normFilterMac(mac), setReservation(scopeId, ip, props),
 *   removeLease(scopeId, ip), statistics(scopeId?) (Display Statistics counters, derived from the leases this server holds),
 *   checkScope(o) / checkExclusion(range, start, end) (validation only: null or the error the add* call would return). */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  /** Predefined DHCP Standard Options (description = the console's Available Options text). */
  const OPTIONS = {
    3: { name: 'Router', type: 'ip[]', description: 'Array of router addresses ordered by preference' },
    6: { name: 'DNS Servers', type: 'ip[]', description: 'Array of DNS servers, by preference' },
    15: { name: 'DNS Domain Name', type: 'string', description: 'DNS Domain name for client resolutions' },
    44: { name: 'WINS/NBNS Servers', type: 'ip[]', description: 'NBNS Address(es) in priority order' },
    46: { name: 'WINS/NBT Node Type', type: 'byte', description: '0x1 = B-node, 0x2 = P-node, 0x4 = M-node, 0x8 = H-node' },
    42: { name: 'NTP Servers', type: 'ip[]', description: 'Addresses of Network Time Protocol servers' },
    66: { name: 'Boot Server Host Name', type: 'string', description: 'TFTP boot server host name' },
    67: { name: 'Bootfile Name', type: 'string', description: 'Bootfile Name' },
    2: { name: 'Time Offset', type: 'long', description: 'UTC offset in seconds' },
    4: { name: 'Time Server', type: 'ip[]', description: 'Array of time server addresses, by preference' },
    5: { name: 'Name Servers', type: 'ip[]', description: 'Array of name servers [IEN 116], by preference' },
    7: { name: 'Log Servers', type: 'ip[]', description: 'Array of MIT_LCS UDP log servers on subnet' }
  };

  WS.store.init('dhcp', s => { s.dhcp = { authorized: false, configured: false, serverOptions: {}, scopes: [] }; });

  const H = () => WS.state.dhcp;
  const I = U.ipToInt;
  const changed = () => { WS.store.changed('dhcp'); scheduleRefresh(); };
  const findScope = id => H().scopes.find(s => s.id === String(id).trim()) || null;
  const noScope = id => ({ ok: false, code: 'NotFound', error: `Failed to get the scope ${id} on DHCP server ${WS.sys.name}. The specified DHCP scope does not exist.` });
  const normMac = m => { const hex = String(m || '').replace(/[^0-9a-f]/gi, '').toUpperCase(); return hex.length === 12 ? hex.match(/../g).join('-') : null; };
  const inRange = (ip, a, b) => I(ip) >= I(a) && I(ip) <= I(b);

  function canLease() {
    if (!WS.features.isInstalled('DHCP') || !WS.svc.isRunning('DHCPServer')) return false;
    return WS.sys.isDC() ? H().authorized : true;
  }

  /* ---- post-install: "Complete DHCP configuration" ---- */
  /** opts.authorize (default true): authorize in AD when this is a DC (the wizard's "Skip AD authorization" passes false). */
  function completeConfiguration(opts = {}) {
    if (!WS.features.isInstalled('DHCP')) return { ok: false, error: 'The DHCP Server role is not installed.' };
    const groups = [['DHCP Administrators', 'Members who have administrative access to DHCP Service'], ['DHCP Users', 'Members who have view-only access to the DHCP service']];
    if (WS.sys.isDC() && WS.ad) {
      for (const [name, description] of groups) if (!WS.ad.get(name)) WS.ad.createGroup({ name, description, scope: 'DomainLocal', parent: WS.ad.usersContainerDN() });
      if (opts.authorize !== false) H().authorized = true;
    } else {
      for (const [name, description] of groups) if (!WS.local.group(name)) WS.local.createGroup(name, description);
    }
    H().configured = true;
    WS.features.completePostTask('dhcp');
    WS.svc.restart('DHCPServer');
    changed();
    return { ok: true };
  }
  function authorize() {
    if (!WS.features.isInstalled('DHCP')) return { ok: false, error: 'The DHCP Server role is not installed.' };
    if (!WS.sys.isDC()) return { ok: false, code: 'NotInDomain', error: `Failed to add DHCP server ${WS.sys.name} in DS. This computer is not joined to an Active Directory domain.` };
    H().authorized = true;
    WS.evt.write('System', { id: 1044, source: 'Microsoft-Windows-DHCP-Server', message: `The DHCP/BINL service on the local machine, belonging to the Windows Administrative domain ${WS.state.system.domain}, has determined that it is authorized to start. It is servicing clients now.` });
    changed();
    return { ok: true };
  }
  function unauthorize() { H().authorized = false; changed(); return { ok: true }; }

  /* ---- scopes ---- */
  /** checkScope(o) -> null, or the { ok:false, error } addScope would return (the New Scope Wizard validates pages with it). */
  function checkScope(o) {
    if (!WS.features.isInstalled('DHCP')) return { ok: false, error: 'The DHCP Server role is not installed.' };
    const name = String(o.name || '').trim();
    if (!name) return { ok: false, error: 'You must enter a name for the scope.' };
    const { start, end } = o;
    if (!U.isValidIp(start) || !U.isValidIp(end)) return { ok: false, error: 'The IP address is not valid.' };
    const prefix = o.prefix != null ? +o.prefix : U.maskToPrefix(o.mask || '255.255.255.0');
    if (!(prefix >= 8 && prefix <= 30)) return { ok: false, error: 'The subnet mask is not valid.' };
    if (U.networkOf(start, prefix) !== U.networkOf(end, prefix)) return { ok: false, error: 'The start and end IP addresses are not in the same subnet.' };
    if (I(start) > I(end)) return { ok: false, error: 'The end IP address must be greater than the start IP address.' };
    const id = U.networkOf(start, prefix);
    if (start === id || end === U.broadcastOf(start, prefix)) return { ok: false, error: 'The range of IP addresses includes the subnet ID or the broadcast address. Enter a valid range of IP addresses.' };
    if (findScope(id)) return { ok: false, code: 'Exists', error: `Failed to add scope ${id} on DHCP server ${WS.sys.name}. The specified DHCP scope already exists.` };
    if (H().scopes.some(s => U.inSubnet(start, s.id, s.prefix) || U.inSubnet(s.start, id, prefix))) return { ok: false, error: 'The specified range either overlaps with an existing range or is invalid.' };
    return null;
  }
  /** addScope({ name, start, end, mask | prefix, description, leaseDays = 8, active = true }) */
  function addScope(o) {
    const bad = checkScope(o); if (bad) return bad;
    const name = String(o.name).trim(), { start, end } = o, prefix = o.prefix != null ? +o.prefix : U.maskToPrefix(o.mask || '255.255.255.0'), id = U.networkOf(start, prefix);
    const scope = { id, name, description: o.description || '', start, end, prefix, mask: U.prefixToMask(prefix), leaseDays: o.leaseDays != null ? +o.leaseDays : 8,
      active: o.active !== false, exclusions: [], reservations: [], options: {}, leases: [] };
    H().scopes.push(scope);
    changed();
    return { ok: true, scope };
  }
  function removeScope(id) {
    if (!findScope(id)) return noScope(id);
    H().scopes = H().scopes.filter(s => s.id !== id);
    changed();
    return { ok: true };
  }
  function setScope(id, props) {
    const s = findScope(id); if (!s) return noScope(id);
    if ('type' in props && !SCOPE_TYPES[String(props.type).toLowerCase()]) return { ok: false, error: `The scope type ${props.type} is not valid. Specify Dhcp, Bootp or Both.` };
    if ('delay' in props && !(+props.delay >= 0 && +props.delay <= 1000)) return { ok: false, error: 'The subnet delay must be between 0 and 1000 milliseconds.' };
    if ('leaseDays' in props && !(+props.leaseDays > 0)) return { ok: false, error: 'The lease duration must be at least one minute.' };
    if ('start' in props || 'end' in props) {
      const start = props.start || s.start, end = props.end || s.end;
      if (!U.inSubnet(start, s.id, s.prefix) || !U.inSubnet(end, s.id, s.prefix) || I(start) > I(end)) return { ok: false, error: 'The specified range either overlaps with an existing range or is invalid.' };
      s.start = start; s.end = end;
    }
    for (const k of ['name', 'description']) if (k in props) s[k] = String(props[k]);
    if ('leaseDays' in props) s.leaseDays = +props.leaseDays;
    if ('leaseUnlimited' in props) s.leaseUnlimited = !!props.leaseUnlimited;
    if ('active' in props) s.active = !!props.active;
    if ('type' in props) s.type = SCOPE_TYPES[String(props.type).toLowerCase()];
    if ('delay' in props) s.delay = Math.round(+props.delay);
    changed();
    return { ok: true };
  }
  const SCOPE_TYPES = { dhcp: 'Dhcp', bootp: 'Bootp', both: 'Both' };
  const resType = t => ({ both: 'Both', dhcp: 'Dhcp', bootp: 'Bootp' })[String(t || 'both').toLowerCase()] || 'Both';
  function addExclusion(id, start, end) {
    const s = findScope(id); if (!s) return noScope(id);
    end = end || start;
    const bad = checkExclusion(s, start, end); if (bad) return bad;
    s.exclusions.push({ start, end });
    changed();
    return { ok: true };
  }
  /** checkExclusion({ start, end, exclusions }, start, end) -> null or the addExclusion error (the wizard's draft list uses it). */
  function checkExclusion(s, start, end) {
    end = end || start;
    if (!U.isValidIp(start) || !U.isValidIp(end) || I(start) > I(end)) return { ok: false, error: 'The IP address range is not valid.' };
    if (!inRange(start, s.start, s.end) || !inRange(end, s.start, s.end)) return { ok: false, error: 'The specified exclusion range is not within the scope address range.' };
    if ((s.exclusions || []).some(e => I(start) <= I(e.end) && I(end) >= I(e.start))) return { ok: false, error: 'The specified exclusion range overlaps an existing exclusion range.' };
    return null;
  }
  function removeExclusion(id, start) {
    const s = findScope(id); if (!s) return noScope(id);
    const before = s.exclusions.length;
    s.exclusions = s.exclusions.filter(e => e.start !== start);
    if (s.exclusions.length === before) return { ok: false, code: 'NotFound', error: `The exclusion range starting at ${start} was not found.` };
    changed();
    return { ok: true };
  }
  /** addReservation(scopeId, { ip, mac, name, description }) */
  function addReservation(id, o) {
    const s = findScope(id); if (!s) return noScope(id);
    const mac = normMac(o.mac);
    if (!U.isValidIp(o.ip) || !U.inSubnet(o.ip, s.id, s.prefix)) return { ok: false, error: `The IP address ${o.ip} is not in the scope ${s.id}.` };
    if (!mac) return { ok: false, error: 'The MAC address is not valid. Type the 12 hexadecimal digits of the client MAC address.' };
    if (s.reservations.some(r => r.ip === o.ip)) return { ok: false, code: 'Exists', error: `Failed to add reservation for ${o.ip}. The specified IP address is currently taken by another client.` };
    if (s.reservations.some(r => r.mac === mac)) return { ok: false, code: 'Exists', error: `Failed to add reservation for ${o.ip}. The client is already a reserved client.` };
    s.reservations.push({ ip: o.ip, mac, name: o.name || '', description: o.description || '', type: resType(o.type) });
    changed();
    return { ok: true };
  }
  /** setReservation(scopeId, ip, { name, mac, description, type }) - the reservation's Properties sheet. */
  function setReservation(id, ip, props) {
    const s = findScope(id); if (!s) return noScope(id);
    const r = s.reservations.find(x => x.ip === ip);
    if (!r) return { ok: false, code: 'NotFound', error: `The reservation ${ip} was not found.` };
    if ('mac' in props) {
      const mac = normMac(props.mac);
      if (!mac) return { ok: false, error: 'The MAC address is not valid. Type the 12 hexadecimal digits of the client MAC address.' };
      if (s.reservations.some(x => x !== r && x.mac === mac)) return { ok: false, code: 'Exists', error: `Failed to modify reservation for ${ip}. The client is already a reserved client.` };
      r.mac = mac;
    }
    for (const k of ['name', 'description']) if (k in props) r[k] = String(props[k]);
    if ('type' in props) r.type = resType(props.type);
    changed();
    return { ok: true };
  }
  /** Delete a lease (Address Leases > Delete). The client keeps its address until it renews, i.e. the next lease refresh. */
  function removeLease(id, ip) {
    const s = findScope(id); if (!s) return noScope(id);
    const before = s.leases.length;
    s.leases = s.leases.filter(l => l.ip !== ip);
    if (s.leases.length === before) return { ok: false, code: 'NotFound', error: `Failed to get the lease ${ip} on DHCP server ${WS.sys.name}. The specified IP address is not currently taken by any client.` };
    WS.store.changed('dhcp');
    return { ok: true };
  }
  function removeReservation(id, ipOrMac) {
    const s = findScope(id); if (!s) return noScope(id);
    const mac = normMac(ipOrMac);
    const before = s.reservations.length;
    s.reservations = s.reservations.filter(r => r.ip !== ipOrMac && r.mac !== mac);
    if (s.reservations.length === before) return { ok: false, code: 'NotFound', error: `The reservation ${ipOrMac} was not found.` };
    changed();
    return { ok: true };
  }
  /** setOption(scopeId | null for server options, code, value) - ip[] options take an array or comma list. */
  function setOption(id, code, value) {
    code = +code;
    const def = OPTIONS[code];
    if (!def) return { ok: false, error: `Option ${code} is not defined on the server.` };
    if (def.type === 'ip[]') {
      value = (Array.isArray(value) ? value : String(value).split(/[,\s]+/)).map(x => String(x).trim()).filter(Boolean);
      const bad = value.find(x => !U.isValidIp(x));
      if (bad) return { ok: false, error: `${bad} is not a valid IP address.` };
    } else if (def.type === 'byte' || def.type === 'long') {
      const raw = String(Array.isArray(value) ? value[0] : value).trim();
      const n = /^0x[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : /^-?\d+$/.test(raw) ? +raw : NaN;
      if (isNaN(n) || (def.type === 'byte' && (n < 0 || n > 255))) return { ok: false, error: `The value ${raw} is not valid for option ${code} ${def.name}.` };
      value = n;
    } else value = String(Array.isArray(value) ? value.join(' ') : value);
    const target = id == null ? H().serverOptions : (findScope(id) || {}).options;
    if (!target) return noScope(id);
    target[code] = value;
    changed();
    return { ok: true };
  }
  function removeOption(id, code) {
    const target = id == null ? H().serverOptions : (findScope(id) || {}).options;
    if (!target) return noScope(id);
    delete target[+code];
    changed();
    return { ok: true };
  }
  /** Scope options win over server options. */
  const effectiveOptions = s => Object.assign({}, H().serverOptions, s.options);

  /* ---- MAC address filters (IPv4 > Filters > Allow / Deny) ---- */
  const FL = () => H().filters || (H().filters = { allow: [], deny: [], allowEnabled: false, denyEnabled: false });
  const LISTS = { allow: 'Allow', deny: 'Deny' };
  const listKey = l => (LISTS[String(l || '').toLowerCase()] ? String(l).toLowerCase() : null);
  /** A MAC address, or a pattern with * for whole bytes (00-15-5D-*), as 'AA-BB-...'; null when invalid. */
  function normPattern(m) {
    const s = String(m || '').trim().toUpperCase().replace(/:/g, '-');
    if (!s.includes('*')) return normMac(s);
    return /^([0-9A-F]{2}|\*)(-([0-9A-F]{2}|\*)){0,5}$/.test(s) ? s : null;
  }
  const macMatch = (pattern, mac) => (pattern.includes('*') ? new RegExp('^' + pattern.replace(/\*/g, '[0-9A-F-]*') + '$').test(mac) : pattern === mac);
  /** Which list a client's MAC appears in (whether or not that list is enabled). */
  function filterOf(mac) {
    const m = normMac(mac) || String(mac || '').toUpperCase(), f = FL();
    return f.deny.some(x => macMatch(x.mac, m)) ? 'deny' : f.allow.some(x => macMatch(x.mac, m)) ? 'allow' : null;
  }
  /** True when the enabled filter lists stop this server from answering the client. */
  function isFiltered(mac) {
    const m = normMac(mac) || String(mac || '').toUpperCase(), f = FL();
    if (f.denyEnabled && f.deny.some(x => macMatch(x.mac, m))) return true;
    return !!f.allowEnabled && !f.allow.some(x => macMatch(x.mac, m));
  }
  function addFilter(list, mac, description) {
    const key = listKey(list);
    if (!key) return { ok: false, error: `The filter list ${list} is not valid. Specify Allow or Deny.` };
    const m = normPattern(mac);
    if (!m) return { ok: false, error: 'The MAC address is not valid. Type the 12 hexadecimal digits of the client MAC address, for example 00-15-5D-01-01-32. Use * for any byte.' };
    const f = FL();
    for (const k of Object.keys(LISTS)) if (f[k].some(x => x.mac === m)) return { ok: false, code: 'Exists', error: `Failed to add filter for MAC address ${m.toLowerCase()} on DHCP server ${WS.sys.name}. The specified MAC address already exists in the ${LISTS[k]} list.` };
    f[key].push({ mac: m, description: description == null ? '' : String(description) });
    changed();
    return { ok: true, mac: m };
  }
  /** removeFilter(mac, list?) - from either list unless list is given. */
  function removeFilter(mac, list) {
    const m = normPattern(mac), f = FL();
    const keys = list ? [listKey(list)].filter(Boolean) : Object.keys(LISTS);
    let hit = false;
    for (const k of keys) { const before = f[k].length; f[k] = f[k].filter(x => x.mac !== m); hit = hit || f[k].length !== before; }
    if (!hit) return { ok: false, code: 'NotFound', error: `Failed to delete filter for MAC address ${String(mac).toLowerCase()} on DHCP server ${WS.sys.name}. The specified MAC address was not found in the filter list.` };
    changed();
    return { ok: true };
  }
  /** setFilterList({ allow: bool, deny: bool }) - "Enable Allow list" / "Enable Deny list". */
  function setFilterList(o) {
    const f = FL();
    if ('allow' in o) f.allowEnabled = !!o.allow;
    if ('deny' in o) f.denyEnabled = !!o.deny;
    changed();
    return { ok: true };
  }
  const filters = () => { const f = FL(); return { allow: f.allow.map(x => ({ ...x })), deny: f.deny.map(x => ({ ...x })), allowEnabled: !!f.allowEnabled, denyEnabled: !!f.denyEnabled }; };

  /* ---- Display Statistics ---- */
  function statistics(id) {
    const list = id != null ? [findScope(id)].filter(Boolean) : H().scopes;
    if (id != null && !list.length) return null;
    const run = WS.evt.list('System', { source: 'Service Control Manager' }).find(e => /^The DHCP Server service entered the running state/.test(e.message));
    let total = 0, inUse = 0, leases = 0;
    for (const s of list) {
      const excluded = s.exclusions.reduce((n, e) => n + I(e.end) - I(e.start) + 1, 0);
      total += Math.max(0, I(s.end) - I(s.start) + 1 - excluded);
      inUse += new Set([...s.leases.map(l => l.ip), ...s.reservations.map(r => r.ip)].filter(ip => inRange(ip, s.start, s.end))).size;
      leases += s.leases.length;
    }
    return { startTime: run ? run.time : WS.state.system.lastBoot || new Date().toISOString(), discovers: leases, offers: leases, delayedOffers: 0, requests: leases, acks: leases,
      nacks: 0, declines: 0, releases: 0, totalScopes: list.length, scopesWithDelay: list.filter(s => s.delay > 0).length,
      totalAddresses: total, inUse, available: Math.max(0, total - inUse) };
  }

  /* ---- leasing to simulated clients ---- */
  function pickAddress(s, mac) {
    const res = s.reservations.find(r => r.mac === mac);
    if (res) return { ip: res.ip, type: 'Reservation' };
    const taken = new Set([...s.reservations.map(r => r.ip), ...s.leases.filter(l => l.mac !== mac).map(l => l.ip), ...WS.net.ownIps(),
      ...WS.state.network.peers.filter(p => !p.dhcpClient).map(p => p.ip)]);
    const current = s.leases.find(l => l.mac === mac);
    if (current && !taken.has(current.ip) && !s.exclusions.some(e => inRange(current.ip, e.start, e.end)) && inRange(current.ip, s.start, s.end)) return { ip: current.ip, type: 'DHCP' };
    for (let n = I(s.start); n <= I(s.end); n++) {
      const ip = U.intToIp(n);
      if (!taken.has(ip) && !s.exclusions.some(e => inRange(ip, e.start, e.end))) return { ip, type: 'DHCP' };
    }
    return null;
  }
  function refreshLeases() {
    const n = WS.state.network;
    for (const p of n.peers.filter(x => x.dhcpClient)) {
      if (n.lan.dhcp && n.lan.dhcp.enabled) {
        const lo = I(n.lan.dhcp.start), hi = I(n.lan.dhcp.end);
        p.ip = U.intToIp(lo + (U.hashStr(p.mac) % (hi - lo + 1)));
        p.leasedFrom = 'router';
        continue;
      }
      const s = canLease() && !isFiltered(p.mac) && H().scopes.find(x => x.active && x.id === U.networkOf(n.lan.network, n.lan.prefix) && x.prefix === n.lan.prefix);
      const pick = s && pickAddress(s, p.mac);
      if (!pick) { p.ip = '169.254.' + (1 + U.hashStr(p.mac) % 254) + '.' + (1 + U.hashStr(p.mac + 'y') % 254); p.leasedFrom = null; continue; }
      const opts = effectiveOptions(s);
      const domain = opts[15] || '';
      s.leases = s.leases.filter(l => l.mac !== p.mac);
      s.leases.push({ ip: pick.ip, mac: p.mac, hostname: domain ? `${p.name}.${domain}` : p.name, expires: pick.type === 'Reservation' || s.leaseUnlimited ? null : new Date(Date.now() + s.leaseDays * 864e5).toISOString(), type: pick.type });
      p.ip = pick.ip; p.leasedFrom = 'server'; p.dnsServers = opts[6] || []; p.gateway = (opts[3] || [])[0] || null; p.dnsSuffix = domain;
      // the client registers its own A record if the zone allows dynamic updates
      const z = WS.dns && domain && WS.dns.zone(domain);
      if (z && z.dynamicUpdate !== 'None') {
        z.records = z.records.filter(r => !(r.type === 'A' && r.name.toLowerCase() === p.name.toLowerCase()));
        z.records.push({ name: p.name.toLowerCase(), type: 'A', data: p.ip, ttl: 1200, timestamp: new Date().toISOString() });
        WS.store.changed('dns');
      }
    }
    WS.store.changed('network', 'dhcp');
  }
  let refreshTimer = null;
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshLeases, 50); }

  WS.sys.on('boot', () => {
    if (WS.features.isInstalled('DHCP') && WS.sys.isDC() && !H().authorized) {
      WS.evt.write('System', { id: 1046, source: 'Microsoft-Windows-DHCP-Server', level: 'Error', message: `The DHCP/BINL service on the local machine, belonging to the Windows Administrative domain ${WS.state.system.domain}, has determined that it is not authorized to service clients on this network. This machine is part of a directory service enterprise and is not authorized in the same domain.` });
    }
    refreshLeases();
  });
  WS.store.on('change:services', scheduleRefresh);
  WS.store.on('change:features', scheduleRefresh);

  WS.dhcp = {
    OPTIONS, isInstalled: () => WS.features.isInstalled('DHCP'), canLease,
    get authorized() { return H().authorized; }, get configured() { return H().configured; },
    completeConfiguration, authorize, unauthorize,
    scopes: () => H().scopes.slice().sort((a, b) => U.ipCompare(a.id, b.id)), scope: findScope,
    addScope, removeScope, setScope, addExclusion, removeExclusion, addReservation, removeReservation,
    setOption, removeOption, serverOptions: () => ({ ...H().serverOptions }), effectiveOptions: id => { const s = findScope(id); return s ? effectiveOptions(s) : null; },
    leases: id => { const s = findScope(id); return s ? s.leases.slice() : []; },
    refreshLeases, normMac,
    setReservation, removeLease, addFilter, removeFilter, setFilterList, filters, filterOf, isFiltered, normFilterMac: normPattern, statistics, checkScope, checkExclusion
  };
})();
