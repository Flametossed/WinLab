/* DNS Server model: WS.dns. Zones and records for DNS Manager, *-DnsServer* cmdlets and dnscmd;
 * WS.net.resolve() asks this server when the adapter points at 127.0.0.1 or its own address.
 * State: dns.zones[] = { name, type: 'Primary', adIntegrated, replication, dynamicUpdate, reverse, file, serial, records[],
 *          paused?, transfers?: 'None'|'Any'|'NameServers'|'List', transferList?[], aging?{ enabled, noRefresh, refresh (hours) },
 *          domains?[] (empty sub-domain folders, relative names) } - read the optional ones through zoneInfo(z),
 *        record = { name ('@' = zone apex, else relative), type, data, ttl, ...type-specific (preference, priority, weight, port) }
 *        dns.forwarders[], dns.useRootHints, dns.conditionalForwarders[] = { name, masters[], adIntegrated, replication, timeout }.
 * Zone files (C:\Windows\System32\dns\<file>) are written when a standard zone is created, on Update Server Data File(s)
 * and at shutdown, as the DNS Server service does. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  WS.store.init('dns', s => { s.dns = { zones: [], forwarders: [], useRootHints: true, conditionalForwarders: [] }; });

  const D = () => WS.state.dns;
  const CF = () => D().conditionalForwarders || (D().conditionalForwarders = []);
  const REPLICATION = ['Forest', 'Domain', 'Legacy'];
  const DYNAMIC = ['None', 'NonsecureAndSecure', 'Secure'];
  /** The root hints a new DNS server ships with (cache.dns). */
  const ROOT_HINTS = [['a', '198.41.0.4'], ['b', '170.247.170.2'], ['c', '192.33.4.12'], ['d', '199.7.91.13'], ['e', '192.203.230.10'], ['f', '192.5.5.241'],
    ['g', '192.112.36.4'], ['h', '198.97.190.53'], ['i', '192.36.148.17'], ['j', '192.58.128.30'], ['k', '193.0.14.129'], ['l', '199.7.83.42'], ['m', '202.12.27.33']]
    .map(([l, ip]) => ({ name: l + '.root-servers.net.', ip }));
  /** The DNS Server log, filtered by Server Properties > Event Logging. */
  const LOG_LEVELS = { None: [], Errors: ['Error'], ErrorsAndWarnings: ['Error', 'Warning'], All: ['Error', 'Warning', 'Information'] };
  const logDns = e => { if ((LOG_LEVELS[D().eventLogging] || LOG_LEVELS.All).includes(e.level || 'Information')) WS.evt.write('DNS Server', { source: 'Microsoft-Windows-DNS-Server-Service', ...e }); };
  /** Optional zone settings with the defaults Windows uses (AD-integrated zones don't allow zone transfers). */
  const zoneInfo = z => ({ paused: !!z.paused, transfers: z.transfers || (z.adIntegrated ? 'None' : 'NameServers'), transferList: (z.transferList || []).slice(),
    aging: Object.assign({ enabled: false, noRefresh: 168, refresh: 168 }, z.aging), domains: (z.domains || []).slice() });
  const ieq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const strip = n => String(n || '').trim().replace(/\.$/, '').toLowerCase();
  const fqdnDot = n => /\.$/.test(n) ? n : n + '.';
  const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SRV', 'TXT', 'SOA'];
  const changed = z => { if (z) z.serial = (z.serial || 1) + 1; WS.store.changed('dns'); };
  const serverName = () => WS.sys.fqdn().toLowerCase();

  function validName(name, allowUnderscore = true) {
    if (!name || name.length > 253) return false;
    return name.split('.').every(l => l.length >= 1 && l.length <= 63 && (allowUnderscore ? /^[A-Za-z0-9_*-]+$/ : /^[A-Za-z0-9-]+$/).test(l));
  }

  function zone(name) { return D().zones.find(z => ieq(z.name, strip(name))) || null; }
  /** Most specific zone this server is authoritative for. */
  function zoneFor(fqdn) {
    const n = strip(fqdn);
    return D().zones.filter(z => n === z.name || n.endsWith('.' + z.name)).sort((a, b) => b.name.length - a.name.length)[0] || null;
  }
  const relName = (z, fqdn) => { const n = strip(fqdn); return n === z.name ? '@' : n.slice(0, -(z.name.length + 1)); };
  const absName = (z, rel) => rel === '@' ? z.name : rel + '.' + z.name;

  const notInstalled = () => ({ ok: false, code: 'NotInstalled', error: 'The DNS server is not installed on this computer. Install the DNS Server role first.' });

  /** createZone({ name | networkId: '192.168.1.0/24', adIntegrated, replication: 'Domain'|'Forest'|'Legacy', dynamicUpdate, file,
   *              existingFile: true (load the records from %SystemRoot%\System32\dns\<file> instead of creating it) }) */
  function createZone(o) {
    if (!WS.features.isInstalled('DNS')) return notInstalled();
    let name = strip(o.name);
    let reverse = false;
    if (o.networkId) {
      const [net, pfx] = String(o.networkId).split('/');
      const prefix = pfx ? +pfx : 24;
      if (!U.isValidIp(net) && !/^\d{1,3}(\.\d{1,3}){0,2}$/.test(net)) return { ok: false, error: `The network ID ${o.networkId} is not valid.` };
      const full = U.isValidIp(net) ? net : (net + '.0.0.0').split('.').slice(0, 4).join('.');
      name = U.reverseZoneName(full, prefix);
    }
    if (/\.in-addr\.arpa$/.test(name)) reverse = true;
    if (!name || !validName(name)) return { ok: false, error: `The zone name '${o.name}' is not valid. DNS names can contain letters (a-z, A-Z), numbers (0-9) and hyphens, separated by periods.` };
    if (zone(name) || CF().some(c => ieq(c.name, name))) return { ok: false, code: 'ResourceExists', error: `Failed to create zone ${name} on server ${WS.sys.name}. The zone already exists.` };
    if (o.adIntegrated && !WS.sys.isDC()) return { ok: false, error: `Failed to create zone ${name} on server ${WS.sys.name}. The zone cannot be stored in Active Directory because the DNS server is not running on a domain controller.` };
    if (o.dynamicUpdate && !DYNAMIC.includes(o.dynamicUpdate)) return { ok: false, error: `The dynamic update value ${o.dynamicUpdate} is not valid.` };
    if (o.dynamicUpdate === 'Secure' && !o.adIntegrated) return { ok: false, error: `Failed to create zone ${name} on server ${WS.sys.name}. Secure dynamic updates are available only for Active Directory-integrated zones.` };
    let loaded = null;
    if (o.existingFile && !o.adIntegrated) {
      const path = 'C:\\Windows\\System32\\dns\\' + (o.file || name + '.dns');
      let text;
      try { text = WS.fs.readFile(path); } catch (e) { return { ok: false, code: 'FileNotFound', error: `The zone file ${o.file || name + '.dns'} was not found in %SystemRoot%\\system32\\dns. Copy the file to this folder, or create a new zone file.` }; }
      loaded = parseZoneFile(text, name);
    }
    const z = {
      name, type: 'Primary', adIntegrated: !!o.adIntegrated, replication: o.adIntegrated ? (o.replication || 'Domain') : null,
      dynamicUpdate: o.dynamicUpdate || (o.adIntegrated ? 'Secure' : 'None'), reverse, file: o.adIntegrated ? null : (o.file || name + '.dns'),
      serial: 1, created: new Date().toISOString(),
      records: [
        { name: '@', type: 'SOA', ttl: 3600, data: { primary: serverName() + '.', responsible: 'hostmaster' + (WS.state.system.domain ? '.' + WS.state.system.domain : '') + '.', refresh: 900, retry: 600, expire: 86400, minimum: 3600 } },
        { name: '@', type: 'NS', ttl: 3600, data: serverName() + '.' }
      ]
    };
    if (loaded) {
      if (loaded.soa) { z.records[0].data = Object.assign(z.records[0].data, loaded.soa.data); z.serial = loaded.soa.serial || 1; }
      if (loaded.records.some(r => r.type === 'NS' && r.name === '@')) z.records = z.records.filter(r => !(r.type === 'NS' && r.name === '@'));
      z.records.push(...loaded.records);
    }
    if (!z.adIntegrated) z.transfers = 'NameServers';
    D().zones.push(z);
    if (z.file && !loaded) writeZoneFile(z);
    logDns({ id: 770, message: `The DNS server has created a new zone ${name}.` });
    changed();
    return { ok: true, zone: z };
  }
  function removeZone(name) {
    const z = zone(name);
    if (!z) return { ok: false, code: 'NotFound', error: `Failed to get the zone information for ${name} on server ${WS.sys.name}.` };
    D().zones = D().zones.filter(x => x !== z);
    logDns({ id: 771, message: `The DNS server has deleted zone ${z.name}.` });
    changed();
    return { ok: true };
  }
  const zoneMissing = name => ({ ok: false, code: 'NotFound', error: `Failed to get the zone information for ${name} on server ${WS.sys.name}.` });
  /** setZone(name, { dynamicUpdate, adIntegrated, replication, file, paused, transfers, transferList, aging, soa: { serial, primary,
   *   responsible, refresh, retry, expire, minimum, ttl } }) - validates everything before changing anything. */
  function setZone(name, props) {
    const z = zone(name);
    if (!z) return zoneMissing(name);
    const ad = 'adIntegrated' in props ? !!props.adIntegrated : z.adIntegrated;
    if ('dynamicUpdate' in props && !DYNAMIC.includes(props.dynamicUpdate)) return { ok: false, error: `The dynamic update value ${props.dynamicUpdate} is not valid.` };
    if ((props.dynamicUpdate || ('adIntegrated' in props ? null : z.dynamicUpdate)) === 'Secure' && !ad) return { ok: false, error: 'Secure dynamic updates are available only for Active Directory-integrated zones.' };
    if (ad && !z.adIntegrated && !WS.sys.isDC()) return { ok: false, error: `The zone ${z.name} cannot be stored in Active Directory because the DNS server is not running on a domain controller.` };
    if ('replication' in props && !REPLICATION.includes(props.replication)) return { ok: false, error: `The replication scope ${props.replication} is not valid.` };
    if ('transfers' in props && !['None', 'Any', 'NameServers', 'List'].includes(props.transfers)) return { ok: false, error: `The zone transfer setting ${props.transfers} is not valid.` };
    const list = 'transferList' in props ? [].concat(props.transferList || []).map(x => String(x).trim()).filter(Boolean) : null;
    if (list && list.some(ip => !U.isValidIp(ip))) return { ok: false, error: `${list.find(ip => !U.isValidIp(ip))} is not a valid IP address.` };
    if ('file' in props && !ad && !/^[^\\/:*?"<>|]+$/.test(String(props.file || ''))) return { ok: false, error: 'The zone file name is not valid.' };
    const soa = props.soa;
    if (soa) {
      for (const k of ['serial', 'refresh', 'retry', 'expire', 'minimum', 'ttl']) if (k in soa && !(Number.isInteger(+soa[k]) && +soa[k] >= 0 && +soa[k] <= 2147483647)) return { ok: false, error: `The value for ${k === 'minimum' ? 'the minimum (default) TTL' : k} is not valid.` };
      for (const k of ['primary', 'responsible']) if (k in soa && !validName(strip(soa[k]))) return { ok: false, error: `The ${k === 'primary' ? 'primary server' : 'responsible person'} name '${soa[k]}' is not valid.` };
      if ('serial' in soa && +soa.serial < (z.serial || 1)) return { ok: false, error: 'The serial number cannot be lower than the current serial number.' };
    }
    if (props.aging && props.aging.enabled && !(+props.aging.noRefresh > 0 && +props.aging.refresh > 0)) return { ok: false, error: 'The no-refresh and refresh intervals must be greater than zero.' };
    if ('adIntegrated' in props && ad !== z.adIntegrated) {
      z.adIntegrated = ad;
      if (ad) { z.replication = props.replication || 'Domain'; z.file = null; delete z.transfers; }
      else {
        z.replication = null; z.file = props.file || z.name + '.dns';
        if (z.dynamicUpdate === 'Secure') z.dynamicUpdate = 'None';
        z.transfers = 'NameServers';
        writeZoneFile(z);
      }
    }
    if ('dynamicUpdate' in props) z.dynamicUpdate = props.dynamicUpdate;
    if ('replication' in props && z.adIntegrated) z.replication = props.replication;
    if ('file' in props && !z.adIntegrated) z.file = String(props.file).trim();
    if ('paused' in props) z.paused = !!props.paused;
    if ('transfers' in props) z.transfers = props.transfers;
    if (list) z.transferList = list;
    if (props.aging) z.aging = { enabled: !!props.aging.enabled, noRefresh: +props.aging.noRefresh || 168, refresh: +props.aging.refresh || 168 };
    if (soa) {
      const rec = z.records.find(r => r.type === 'SOA');
      for (const k of ['refresh', 'retry', 'expire', 'minimum']) if (k in soa) rec.data[k] = +soa[k];
      for (const k of ['primary', 'responsible']) if (k in soa) rec.data[k] = fqdnDot(strip(soa[k]));
      if ('ttl' in soa) rec.ttl = +soa.ttl;
      if ('serial' in soa) { z.serial = +soa.serial; changed(); return { ok: true }; }
    }
    changed(z);
    return { ok: true };
  }

  /* ---- empty sub-domains (DNS Manager's New Domain...) ---- */
  function addDomain(zoneName, rel) {
    const z = zone(zoneName); if (!z) return zoneMissing(zoneName);
    const n = strip(rel);
    if (!n || !validName(n)) return { ok: false, error: `The domain name '${rel}' is not valid. DNS names can contain letters (a-z, A-Z), numbers (0-9) and hyphens, separated by periods.` };
    const has = x => ieq(x, n) || String(x).toLowerCase().endsWith('.' + n);
    if ((z.domains || []).some(has) || z.records.some(r => r.name !== '@' && has(r.name))) return { ok: false, code: 'ResourceExists', error: `The domain ${n}.${z.name} already exists.` };
    (z.domains = z.domains || []).push(String(rel).trim().replace(/\.$/, ''));
    changed(z);
    return { ok: true };
  }
  /** Deletes a sub-domain folder with every record and folder under it. */
  function removeDomain(zoneName, rel) {
    const z = zone(zoneName); if (!z) return zoneMissing(zoneName);
    const n = strip(rel), under = x => ieq(x, n) || String(x).toLowerCase().endsWith('.' + n);
    const before = z.records.length + (z.domains || []).length;
    z.records = z.records.filter(r => r.name === '@' || !under(r.name));
    z.domains = (z.domains || []).filter(d => !under(d));
    if (z.records.length + z.domains.length === before) return { ok: false, code: 'NotFound', error: `The domain ${n}.${z.name} does not exist.` };
    changed(z);
    return { ok: true };
  }

  /** addRecord(zone, { name, type, data, ttl, preference, priority, weight, port, createPtr }) -> { ok, record, warning } */
  function addRecord(zoneName, r) {
    const z = zone(zoneName);
    if (!z) return { ok: false, code: 'NotFound', error: `Failed to get the zone information for ${zoneName} on server ${WS.sys.name}.` };
    const type = String(r.type || 'A').toUpperCase();
    if (!TYPES.includes(type) || type === 'SOA') return { ok: false, error: `The record type ${r.type} is not supported.` };
    let name = r.name == null || r.name === '' || r.name === '@' || r.name === '.' ? '@' : strip(r.name);
    if (name !== '@' && name.endsWith('.' + z.name)) name = relName(z, name);
    if (name !== '@' && !validName(name)) return { ok: false, error: `The record name '${r.name}' is not valid.` };
    let data = typeof r.data === 'string' ? r.data.trim() : r.data;
    if (type === 'A' && !U.isValidIp(data)) return { ok: false, error: `The IP address ${data || '(blank)'} is not valid. Enter a valid IPv4 address.` };
    if (type === 'AAAA' && !/^[0-9a-f:]+$/i.test(data || '')) return { ok: false, error: `The IP address ${data} is not a valid IPv6 address.` };
    if (['CNAME', 'NS', 'PTR', 'MX', 'SRV'].includes(type)) {
      if (!data || !validName(strip(data))) return { ok: false, error: `The host name '${data || ''}' is not valid. Type a fully qualified domain name (FQDN).` };
      data = fqdnDot(strip(data));
    }
    if (type === 'SRV' && !(r.port >= 0 && r.port <= 65535)) return { ok: false, error: 'The port number must be between 0 and 65535.' };
    const same = z.records.filter(x => ieq(x.name, name));
    if (type === 'CNAME' && same.length) return { ok: false, code: 'ResourceExists', error: `Failed to create resource record ${name} in zone ${z.name} on server ${WS.sys.name}. A CNAME record cannot be created because another record with the same name already exists.` };
    if (type !== 'CNAME' && same.some(x => x.type === 'CNAME')) return { ok: false, code: 'ResourceExists', error: `Failed to create resource record ${name} in zone ${z.name} on server ${WS.sys.name}. A CNAME record with the same name already exists.` };
    if (same.some(x => x.type === type && JSON.stringify(x.data).toLowerCase() === JSON.stringify(data).toLowerCase())) return { ok: false, code: 'ResourceExists', error: `Failed to create resource record ${name} in zone ${z.name} on server ${WS.sys.name}. The resource record already exists.` };
    const rec = { name, type, data, ttl: r.ttl || 3600 };
    if (type === 'MX') rec.preference = r.preference != null ? +r.preference : 10;
    if (type === 'SRV') { rec.priority = +r.priority || 0; rec.weight = +r.weight || 0; rec.port = +r.port; }
    if (r.dynamic) rec.timestamp = new Date().toISOString();
    z.records.push(rec);
    let warning = null;
    if (type === 'A' && r.createPtr) {
      const rz = D().zones.find(x => x.reverse && U.isValidIp(data) && reverseCovers(x.name, data));
      if (!rz) warning = 'Warning: The associated pointer (PTR) record cannot be created, probably because the referenced reverse lookup zone cannot be found.';
      else addRecord(rz.name, { name: ptrName(rz.name, data), type: 'PTR', data: absName(z, name) });
    }
    changed(z);
    return { ok: true, record: rec, warning };
  }
  /** removeRecord(zone, { name, type, data? }) - without data, removes every record of that name and type. */
  function removeRecord(zoneName, r) {
    const z = zone(zoneName);
    if (!z) return { ok: false, code: 'NotFound', error: `Failed to get the zone information for ${zoneName} on server ${WS.sys.name}.` };
    let name = r.name == null || r.name === '' || r.name === '@' || r.name === '.' ? '@' : strip(r.name);
    if (name !== '@' && name.endsWith('.' + z.name)) name = relName(z, name);
    const type = String(r.type).toUpperCase();
    if (type === 'SOA' || (type === 'NS' && name === '@' && z.records.filter(x => x.type === 'NS' && x.name === '@').length <= 1)) return { ok: false, error: 'The record cannot be deleted. A zone must contain at least one SOA and one NS record.' };
    const match = x => ieq(x.name, name) && x.type === type && (r.data == null || ieq(strip(typeof x.data === 'string' ? x.data : ''), strip(r.data)));
    const before = z.records.length;
    z.records = z.records.filter(x => !match(x));
    if (z.records.length === before) return { ok: false, code: 'NotFound', error: `Failed to get ${name} record in ${z.name} zone on ${WS.sys.name} server.` };
    changed(z);
    return { ok: true };
  }

  const dataKey = d => typeof d === 'string' ? strip(d) : JSON.stringify(d).toLowerCase();
  function findRecord(z, m) {
    let name = m.name == null || m.name === '' || m.name === '@' || m.name === '.' ? '@' : strip(m.name);
    if (name !== '@' && name.endsWith('.' + z.name)) name = relName(z, name);
    const type = String(m.type).toUpperCase();
    return z.records.find(x => ieq(x.name, name) && x.type === type && (m.data == null || dataKey(x.data) === dataKey(m.data))) || null;
  }
  /** setRecord(zone, { name, type, data }, { name, data, ttl, preference, priority, weight, port, createPtr }) - edits one record in place
   *  (record Properties). Validation is addRecord's; on failure the old record is kept. */
  function setRecord(zoneName, match, props) {
    const z = zone(zoneName); if (!z) return zoneMissing(zoneName);
    const rec = findRecord(z, match);
    if (!rec) return { ok: false, code: 'NotFound', error: `Failed to get ${match.name || '@'} record in ${z.name} zone on ${WS.sys.name} server.` };
    if (rec.type === 'SOA') return setZone(z.name, { soa: props });
    const at = z.records.indexOf(rec);
    z.records.splice(at, 1);
    const r = addRecord(z.name, { ...rec, ...props, type: rec.type, name: props.name != null ? props.name : rec.name, dynamic: false });
    if (!r.ok) { z.records.splice(at, 0, rec); return r; }
    z.records.splice(z.records.indexOf(r.record), 1);
    z.records.splice(at, 0, r.record);
    if (rec.timestamp && !props.static) r.record.timestamp = rec.timestamp;
    return r;
  }
  /** The PTR record that points back at an A record (to update or delete it with the host). */
  function findPtr(zoneName, rec) {
    const z = zone(zoneName);
    if (!z || !rec || rec.type !== 'A' || !U.isValidIp(rec.data)) return null;
    const rz = D().zones.find(x => x.reverse && reverseCovers(x.name, rec.data));
    if (!rz) return null;
    const target = strip(absName(z, rec.name === '@' ? '@' : strip(rec.name)));
    const ptr = rz.records.find(x => x.type === 'PTR' && ieq(x.name, ptrName(rz.name, rec.data)) && strip(x.data) === target);
    return ptr ? { zone: rz.name, record: ptr } : null;
  }

  function reverseCovers(zoneName, ip) {
    const octs = zoneName.replace(/\.in-addr\.arpa$/, '').split('.').reverse();
    return ip.split('.').slice(0, octs.length).join('.') === octs.join('.');
  }
  function ptrName(zoneName, ip) {
    const n = zoneName.replace(/\.in-addr\.arpa$/, '').split('.').length;
    return ip.split('.').slice(n).reverse().join('.');
  }

  /** query(fqdn, type) -> { authoritative, records[] (absolute names), nodata } */
  function query(fqdn, type = 'A', depth = 0) {
    const n = strip(fqdn);
    const z = zoneFor(n);
    if (!z) return { authoritative: false, records: [] };
    // a paused zone is not loaded for queries; the server treats the name as one it is not authoritative for
    if (z.paused) return { authoritative: false, records: [], paused: true };
    const rel = relName(z, n);
    // a delegation inside the zone (e.g. _msdcs) that we don't host is not ours to answer
    const here = z.records.filter(r => ieq(r.name, rel));
    const abs = r => ({ ...r, name: absName(z, r.name) });
    const want = String(type).toUpperCase();
    let records = here.filter(r => want === 'ANY' || r.type === want).map(abs);
    if (!records.length && want !== 'CNAME') {
      const cn = here.find(r => r.type === 'CNAME');
      if (cn && depth < 8) {
        const target = query(cn.data, want, depth + 1);
        records = [abs(cn), ...target.records];
        if (!target.authoritative && WS.net) {
          const ext = WS.net.resolve(strip(cn.data));
          if (ext.ok) records.push(...ext.addresses.map(ip => ({ name: strip(cn.data), type: 'A', data: ip, ttl: 300 })));
        }
      }
    }
    const exists = here.length > 0 || z.records.some(r => r.name !== '@' && (r.name.toLowerCase().endsWith('.' + rel)))
      || (z.domains || []).some(d => ieq(d, rel) || d.toLowerCase().endsWith('.' + rel));
    return { authoritative: true, zone: z.name, records, nodata: !records.length && exists };
  }

  /* ---- AD DS promotion: the zones dcpromo creates ---- */
  function createAdZones(domain, dcName, ip, guids) {
    const d = strip(domain), host = (dcName + '.' + d).toLowerCase() + '.';
    const add = (z, name, type, data, extra) => { const zz = zone(z); zz.records.push(Object.assign({ name, type, data, ttl: 600, timestamp: new Date().toISOString() }, extra)); };
    const srv = (z, name, port) => add(z, name, 'SRV', host, { priority: 0, weight: 100, port });
    for (const zn of [d, '_msdcs.' + d]) {
      if (!zone(zn)) {
        D().zones.push({ name: zn, type: 'Primary', adIntegrated: true, replication: zn === d ? 'Domain' : 'Forest', dynamicUpdate: 'Secure', reverse: false, file: null, serial: 1, created: new Date().toISOString(),
          records: [
            { name: '@', type: 'SOA', ttl: 3600, data: { primary: host, responsible: 'hostmaster.' + d + '.', refresh: 900, retry: 600, expire: 86400, minimum: 3600 } },
            { name: '@', type: 'NS', ttl: 3600, data: host }
          ] });
      }
    }
    add(d, '@', 'A', ip);
    add(d, dcName.toLowerCase(), 'A', ip, { timestamp: null });
    add(d, '_msdcs', 'NS', host);
    // names keep the case the DC registers them with (DNS is case-preserving, lookups are case-insensitive)
    const site = 'Default-First-Site-Name';
    add(d, 'DomainDnsZones', 'A', ip); add(d, 'ForestDnsZones', 'A', ip);
    srv(d, '_ldap._tcp', 389); srv(d, '_kerberos._tcp', 88); srv(d, '_kpasswd._tcp', 464); srv(d, '_gc._tcp', 3268);
    srv(d, '_kerberos._udp', 88); srv(d, '_kpasswd._udp', 464);
    srv(d, `_ldap._tcp.${site}._sites`, 389); srv(d, `_kerberos._tcp.${site}._sites`, 88);
    srv(d, `_gc._tcp.${site}._sites`, 3268);
    srv(d, '_ldap._tcp.DomainDnsZones', 389); srv(d, '_ldap._tcp.ForestDnsZones', 389);
    srv(d, `_ldap._tcp.${site}._sites.DomainDnsZones`, 389); srv(d, `_ldap._tcp.${site}._sites.ForestDnsZones`, 389);
    const m = '_msdcs.' + d;
    add(m, guids.dsa, 'CNAME', host);
    add(m, 'gc', 'A', ip);
    srv(m, '_ldap._tcp.dc', 389); srv(m, '_kerberos._tcp.dc', 88); srv(m, '_ldap._tcp.pdc', 389); srv(m, '_ldap._tcp.gc', 3268);
    srv(m, `_ldap._tcp.${guids.domain}.domains`, 389);
    srv(m, `_ldap._tcp.${site}._sites.dc`, 389); srv(m, `_kerberos._tcp.${site}._sites.dc`, 88); srv(m, `_ldap._tcp.${site}._sites.gc`, 3268);
    changed();
  }

  /* ---- dynamic registration: a DC re-registers its A records when its address or name changes ---- */
  function reregister(oldName) {
    if (!WS.sys.isDC() || !WS.features.isInstalled('DNS')) return;
    const d = WS.state.system.domain;
    const z = zone(d);
    const ip = WS.net.primaryIp();
    if (!z || !ip) return;
    const me = WS.sys.name.toLowerCase();
    const old = (oldName || me).toLowerCase();
    for (const r of z.records) {
      if (r.type !== 'A') continue;
      if (ieq(r.name, old)) { r.name = me; r.data = ip; }
      if (['@', 'domaindnszones', 'forestdnszones'].includes(r.name.toLowerCase()) && r.timestamp) r.data = ip;
    }
    const mz = zone('_msdcs.' + d);
    if (mz) for (const r of mz.records) if (r.type === 'A' && r.name === 'gc') r.data = ip;
    changed(z);
  }
  WS.net.onChange(() => reregister());
  WS.sys.on('boot', ({ renamedFrom }) => reregister(renamedFrom));

  /* ---- conditional forwarders: queries for these domains go to their master servers instead of the server forwarders ---- */
  /** addConditionalForwarder({ name, masters[], adIntegrated, replication, timeout }) */
  function addConditionalForwarder(o) {
    if (!WS.features.isInstalled('DNS')) return notInstalled();
    const name = strip(o.name);
    if (!name || !validName(name, false)) return { ok: false, error: `The DNS domain name '${o.name || ''}' is not valid.` };
    if (zone(name) || CF().some(c => ieq(c.name, name))) return { ok: false, code: 'ResourceExists', error: `Failed to create zone ${name} on server ${WS.sys.name}. The zone already exists.` };
    const masters = [].concat(o.masters || []).map(x => String(x).trim()).filter(Boolean);
    if (!masters.length) return { ok: false, error: 'You must specify at least one IP address of a master server.' };
    const bad = masters.find(x => !U.isValidIp(x));
    if (bad) return { ok: false, error: `${bad} is not a valid IP address.` };
    if (o.adIntegrated && !WS.sys.isDC()) return { ok: false, error: `Failed to create zone ${name} on server ${WS.sys.name}. The zone cannot be stored in Active Directory because the DNS server is not running on a domain controller.` };
    if (o.adIntegrated && o.replication && !REPLICATION.includes(o.replication)) return { ok: false, error: `The replication scope ${o.replication} is not valid.` };
    const cf = { name, masters, adIntegrated: !!o.adIntegrated, replication: o.adIntegrated ? (o.replication || 'Forest') : null, timeout: +o.timeout || 5 };
    CF().push(cf);
    changed();
    return { ok: true, forwarder: cf };
  }
  function setConditionalForwarder(name, props) {
    const cf = CF().find(c => ieq(c.name, strip(name)));
    if (!cf) return { ok: false, code: 'NotFound', error: `Failed to get the zone information for ${name} on server ${WS.sys.name}.` };
    if ('masters' in props) {
      const masters = [].concat(props.masters || []).map(x => String(x).trim()).filter(Boolean);
      if (!masters.length) return { ok: false, error: 'You must specify at least one IP address of a master server.' };
      const bad = masters.find(x => !U.isValidIp(x));
      if (bad) return { ok: false, error: `${bad} is not a valid IP address.` };
      cf.masters = masters;
    }
    if ('timeout' in props) cf.timeout = +props.timeout || 5;
    changed();
    return { ok: true };
  }
  function removeConditionalForwarder(name) {
    const before = CF().length;
    D().conditionalForwarders = CF().filter(c => !ieq(c.name, strip(name)));
    if (CF().length === before) return { ok: false, code: 'NotFound', error: `Failed to get the zone information for ${name} on server ${WS.sys.name}.` };
    changed();
    return { ok: true };
  }
  /** The most specific conditional forwarder for a name, if any. */
  function conditionalForwarderFor(fqdn) {
    const n = strip(fqdn);
    return CF().filter(c => n === c.name || n.endsWith('.' + c.name)).sort((a, b) => b.name.length - a.name.length)[0] || null;
  }

  /* ---- zone files ---- */
  const col = (s, w) => (s + ' '.repeat(Math.max(1, w - s.length)));
  function rdata(r) {
    if (r.type === 'MX') return `${r.preference}  ${r.data}`;
    if (r.type === 'SRV') return `${r.priority} ${r.weight} ${r.port}	${r.data}`;
    if (r.type === 'TXT') return `( "${String(r.data).replace(/"/g, '\\"')}" )`;
    return String(r.data);
  }
  function zoneFileText(z) {
    const soa = z.records.find(r => r.type === 'SOA').data;
    const pad = '                        ';
    const lines = [';', `;  Database file ${z.file} for ${z.name} zone.`, `;      Zone version:  ${z.serial || 1}`, ';', '',
      `@                       IN  SOA ${soa.primary}  ${soa.responsible} (`,
      `${pad}		${col(String(z.serial || 1), 13)}; serial number`, `${pad}		${col(String(soa.refresh), 13)}; refresh`,
      `${pad}		${col(String(soa.retry), 13)}; retry`, `${pad}		${col(String(soa.expire), 13)}; expire`,
      `${pad}		${col(String(soa.minimum), 11)}) ; default TTL`, '', ';', ';  Zone NS records', ';', ''];
    for (const r of z.records.filter(x => x.type === 'NS' && x.name === '@')) lines.push(`${col('@', 24)}NS	${r.data}`);
    lines.push('', ';', ';  Zone records', ';', '');
    let last = null;
    for (const r of z.records.filter(x => x.type !== 'SOA' && !(x.type === 'NS' && x.name === '@'))) {
      const name = r.name === last ? '' : r.name;
      last = r.name;
      const ttl = r.ttl && r.ttl !== soa.minimum ? r.ttl + '	' : '';
      lines.push(`${col(name, 24)}${ttl}${r.type}	${rdata(r)}`);
    }
    return lines.join('\r\n') + '\r\n';
  }
  function writeZoneFile(z) {
    if (!z || z.adIntegrated || !z.file) return;
    try { WS.fs.ensureDir('C:\\Windows\\System32\\dns'); WS.fs.writeFile('C:\\Windows\\System32\\dns\\' + z.file, zoneFileText(z)); } catch (e) { console.error(e); }
  }
  /** Reads the records from a zone file in the format the DNS server writes (and common BIND files). */
  function parseZoneFile(text, origin) {
    const out = { soa: null, records: [] };
    let last = '@', ttlDefault = 3600;
    const src = String(text).replace(/;[^\r\n]*/g, '').replace(/\(([^)]*)\)/g, (m, inner) => inner.replace(/\s+/g, ' '));
    for (const raw of src.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      if (/^\$TTL\s+(\d+)/i.test(raw)) { ttlDefault = +RegExp.$1; continue; }
      if (/^\$/.test(raw)) continue;
      const f = raw.trim().split(/\s+/);
      let name = /^\s/.test(raw) ? last : f.shift();
      let ttl = ttlDefault;
      while (f.length && (/^\d+$/.test(f[0]) || /^IN$/i.test(f[0]) || /^\[AGE:\d+\]$/i.test(f[0]))) { const t = f.shift(); if (/^\d+$/.test(t)) ttl = +t; }
      const type = (f.shift() || '').toUpperCase();
      if (name !== '@') { const fq = strip(name); name = /\.$/.test(name) ? (fq === strip(origin) ? '@' : fq.endsWith('.' + strip(origin)) ? fq.slice(0, -(strip(origin).length + 1)) : fq) : name.toLowerCase() === '@' ? '@' : name; }
      last = name;
      const host = s => (s && /\.$/.test(s) ? s : s ? s + '.' + strip(origin) + '.' : s);
      if (type === 'SOA') { const [primary, responsible, serial, refresh, retry, expire, minimum] = f; out.soa = { serial: +serial || 1, data: { primary: host(primary), responsible: host(responsible), refresh: +refresh, retry: +retry, expire: +expire, minimum: +minimum } }; continue; }
      const rec = { name, type, ttl };
      if (type === 'MX') { rec.preference = +f[0]; rec.data = host(f[1]); }
      else if (type === 'SRV') { rec.priority = +f[0]; rec.weight = +f[1]; rec.port = +f[2]; rec.data = host(f[3]); }
      else if (['CNAME', 'NS', 'PTR'].includes(type)) rec.data = host(f[0]);
      else if (type === 'TXT') rec.data = f.join(' ').replace(/^"|"$/g, '').replace(/\\"/g, '"');
      else if (['A', 'AAAA'].includes(type)) rec.data = f[0];
      else continue;
      out.records.push(rec);
    }
    return out;
  }
  /** Update Server Data File(s): write every standard zone (or one zone) to its file now. */
  function writeZoneFiles(name) {
    const list = name ? [zone(name)].filter(Boolean) : D().zones;
    if (name && !list.length) return zoneMissing(name);
    list.forEach(writeZoneFile);
    return { ok: true };
  }
  WS.sys.on('shutdown', () => { if (WS.features.isInstalled('DNS')) D().zones.forEach(writeZoneFile); });
  /** Reload: a standard zone is read back from its file, so changes not yet written to it are lost (as on a real server). */
  function reloadZone(name) {
    const z = zone(name); if (!z) return zoneMissing(name);
    if (z.adIntegrated) { changed(); return { ok: true }; }
    let text;
    try { text = WS.fs.readFile('C:\\Windows\\System32\\dns\\' + z.file); } catch (e) { return { ok: false, error: `The zone ${z.name} could not be loaded. The zone file ${z.file} was not found in %SystemRoot%\\system32\\dns.` }; }
    const loaded = parseZoneFile(text, z.name);
    const soa = z.records.find(r => r.type === 'SOA');
    if (loaded.soa) { Object.assign(soa.data, loaded.soa.data); z.serial = loaded.soa.serial; }
    z.records = [soa, ...loaded.records];
    changed();
    return { ok: true };
  }

  /* ---- aging and scavenging ---- */
  /** Removes dynamic records whose time stamp is older than no-refresh + refresh, in zones with aging on. Returns the count. */
  function scavenge(now = Date.now()) {
    let count = 0;
    for (const z of D().zones) {
      const a = zoneInfo(z).aging;
      if (!a.enabled) continue;
      const keep = z.records.filter(r => !r.timestamp || now - new Date(r.timestamp).getTime() < (a.noRefresh + a.refresh) * 3600e3);
      count += z.records.length - keep.length;
      if (keep.length !== z.records.length) { z.records = keep; changed(z); }
    }
    if (count) logDns({ id: 2501, message: `The DNS server has completed a scavenging cycle and ${count} stale resource records were deleted.` });
    else logDns({ id: 2502, message: 'The DNS server has completed a scavenging cycle but no nodes were visited.' });
    return { ok: true, count };
  }

  /* ---- the DNS Server log: service start/stop as the real server reports it ---- */
  const started = () => {
    logDns({ id: 2, message: 'The DNS server has started.' });
    logDns({ id: 4, message: 'The DNS server has finished the background loading of zones. All zones are now available for DNS updates and zone transfers, as allowed by their individual zone configuration.' });
  };
  WS.svc.on('status', (name, status) => {
    if (name !== 'DNS' || !WS.features.isInstalled('DNS')) return;
    if (status === 'Running') started();
    else logDns({ id: 3, message: 'The DNS server has shut down.' });
  });
  WS.sys.on('boot', () => { if (WS.features.isInstalled('DNS') && WS.svc.isRunning('DNS')) started(); });

  WS.dns = {
    TYPES, ROOT_HINTS, REPLICATION,
    isInstalled: () => WS.features.isInstalled('DNS'),
    zones: () => D().zones.slice().sort((a, b) => (a.reverse - b.reverse) || a.name.localeCompare(b.name)),
    zone, zoneFor, zoneInfo, createZone, removeZone, setZone, addRecord, removeRecord, setRecord, findPtr, query, createAdZones,
    addDomain, removeDomain, zoneFileText, writeZoneFiles, parseZoneFile, reloadZone, scavenge, clearCache: () => ({ ok: true }),
    /** Server Properties > Event Logging: 'None' | 'Errors' | 'ErrorsAndWarnings' | 'All' (the default). */
    eventLogging: () => D().eventLogging || 'All',
    setEventLogging(v) { if (!['None', 'Errors', 'ErrorsAndWarnings', 'All'].includes(v)) return { ok: false, error: `The event logging level ${v} is not valid.` }; D().eventLogging = v; changed(); return { ok: true }; },
    conditionalForwarders: () => CF().slice().sort((a, b) => a.name.localeCompare(b.name)),
    conditionalForwarder: name => CF().find(c => ieq(c.name, strip(name))) || null,
    addConditionalForwarder, setConditionalForwarder, removeConditionalForwarder, conditionalForwarderFor,
    records: name => { const z = zone(name); return z ? z.records.map(r => ({ ...r, fqdn: absName(z, r.name) })) : null; },
    forwarders: () => D().forwarders.slice(),
    setForwarders(list) {
      const l = [].concat(list || []).map(x => String(x).trim()).filter(Boolean);
      const bad = l.find(x => !U.isValidIp(x));
      if (bad) return { ok: false, error: `${bad} is not a valid IP address.` };
      D().forwarders = l; changed(); return { ok: true };
    },
    useRootHints: () => D().useRootHints !== false,
    setUseRootHints(v) { D().useRootHints = !!v; changed(); return { ok: true }; },
    reverseCovers, ptrName
  };
})();
