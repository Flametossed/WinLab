/* Lab engine: injectable labs with auto-checked objectives.
 *
 * A lab is either a JS file in /labs that calls WS.labs.register({...}), or a JSON file
 * imported from the Lab Guide (stored in localStorage). Format:
 *   { id, title, description, difficulty, minutes,
 *     setup: { set: { 'system.workgroup': 'WORKGROUP', ... } }   // or a function(state, WS) in JS labs
 *     objectives: [{ id, text, hint, check }] }
 * check is declarative so JSON labs work:
 *   { path: 'system.computerName', equalsIgnoreCase: 'DC01' }
 *   ops: equals | equalsIgnoreCase | includes | matches (regex, case-insensitive) | exists | gte | lte
 *   combine with { all: [...] } / { any: [...] } / { not: {...} }; JS labs may also use a function(state, WS).
 * Completed objectives latch (stay done) and are stored in state.lab, so progress survives reloads.
 *
 * Step snapshots (undo): starting a lab saves its starting point, and every evaluate() pass that completes objectives saves a
 * snapshot of the whole lab state at that moment. WS.labs.snapshots.list() gives them oldest first; revert(id) puts the server
 * back to one (objectives completed after it open again, later snapshots are dropped) and restarts it like the host bar's
 * Revert. They are kept apart from the host bar's checkpoints, in IndexedDB (localStorage if that is unavailable). */
(function () {
  'use strict';
  const WS = window.WS;
  const CUSTOM_KEY = 'ws2025lab.customLabs.v1';
  const labs = {};

  WS.store.init('lab', s => { s.lab = { activeId: null, startedAt: null, completed: {} }; });

  /** 'network.adapters[0].ip' and 'network.adapters.0.ip' both work. */
  const splitPath = path => String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  const getPath = (obj, path) => splitPath(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = splitPath(path);
    let o = obj;
    for (const k of keys.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    o[keys[keys.length - 1]] = value;
  }

  function evalCheck(check, state) {
    if (check == null) return false;
    if (typeof check === 'function') { try { return !!check(state, WS); } catch (e) { return false; } }
    if (Array.isArray(check)) return check.every(c => evalCheck(c, state));
    if (check.all) return check.all.every(c => evalCheck(c, state));
    if (check.any) return check.any.some(c => evalCheck(c, state));
    if (check.not) return !evalCheck(check.not, state);
    for (const k of Object.keys(check)) {
      if (helpers[k]) { try { return !!helpers[k](check[k], state); } catch (e) { return false; } }
    }
    const v = getPath(state, check.path);
    const str = v == null ? '' : String(v);
    if ('equals' in check) return v === check.equals;
    if ('equalsIgnoreCase' in check) return str.toLowerCase() === String(check.equalsIgnoreCase).toLowerCase();
    if ('includes' in check) return Array.isArray(v) ? v.includes(check.includes) : str.toLowerCase().includes(String(check.includes).toLowerCase());
    if ('matches' in check) { try { return new RegExp(check.matches, 'i').test(str); } catch (e) { return false; } }
    if ('exists' in check) return (v !== undefined && v !== null) === !!check.exists;
    if ('gte' in check) return Number(v) >= check.gte;
    if ('lte' in check) return Number(v) <= check.lte;
    return false;
  }

  /** Returns an error string, or null if the definition is usable. */
  function validate(def) {
    if (!def || typeof def !== 'object') return 'Lab file is not an object.';
    if (!def.id || !/^[\w.-]+$/.test(def.id)) return 'Lab needs an "id" (letters, digits, - _ .).';
    if (!def.title) return 'Lab needs a "title".';
    if (!Array.isArray(def.objectives) || !def.objectives.length) return 'Lab needs at least one objective.';
    for (const o of def.objectives) if (!o.id || !o.text || !o.check) return 'Every objective needs "id", "text" and "check".';
    return null;
  }

  function register(def, opts = {}) {
    const err = validate(def);
    if (err) { console.warn('Lab rejected:', err, def); return { ok: false, error: err }; }
    labs[def.id] = Object.assign({ difficulty: 'Beginner', minutes: 15, description: '' }, def, { custom: !!opts.custom });
    return { ok: true };
  }

  function loadCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveCustom(list) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* storage full */ } }
  loadCustom().forEach(def => register(def, { custom: true }));

  /** Import a JSON lab (string). Replaces a custom lab with the same id. */
  function importJSON(text) {
    let def;
    try { def = JSON.parse(text); } catch (e) { return { ok: false, error: 'The file is not valid JSON: ' + e.message }; }
    if (labs[def.id] && !labs[def.id].custom) return { ok: false, error: `A built-in lab already uses the id "${def.id}".` };
    const r = register(def, { custom: true });
    if (r.ok) saveCustom(loadCustom().filter(d => d.id !== def.id).concat([def]));
    return r.ok ? { ok: true, lab: labs[def.id] } : r;
  }
  function removeCustom(id) {
    saveCustom(loadCustom().filter(d => d.id !== id));
    if (labs[id] && labs[id].custom) delete labs[id];
    if (WS.state.lab.activeId === id) stop();
  }

  const active = () => labs[WS.state.lab.activeId] || null;

  function progress() {
    const lab = active();
    if (!lab) return null;
    const done = WS.state.lab.completed || {};
    const items = lab.objectives.map(o => ({ ...o, done: !!done[o.id], doneAt: done[o.id] || null }));
    return { lab, items, doneCount: items.filter(i => i.done).length, total: items.length };
  }

  /** Re-check objectives; newly met ones latch as complete. */
  function evaluate() {
    const lab = active();
    if (!lab) return;
    const done = WS.state.lab.completed = WS.state.lab.completed || {};
    const now = [];
    for (const o of lab.objectives) {
      if (!done[o.id] && evalCheck(o.check, WS.state)) { done[o.id] = new Date().toISOString(); now.push(o.id); }
    }
    if (now.length) { snap.capture(now); WS.store.changed('lab'); }
  }
  WS.store.on('change', topics => { if (!(topics.length === 1 && topics[0] === 'lab')) evaluate(); });

  /** Revert the server to the lab's starting point (keeps the Administrator password) and reboot into it. */
  function start(id) {
    const lab = labs[id];
    if (!lab) return { ok: false, error: 'Lab not found.' };
    const pw = WS.state.system.adminPassword;
    const s = WS.store.createDefault();
    s.meta.oobeDone = true;
    s.system.adminPassword = pw;
    try {
      if (typeof lab.setup === 'function') lab.setup(s, WS);
      else if (lab.setup && lab.setup.set) for (const [p, v] of Object.entries(lab.setup.set)) setPath(s, p, v);
    } catch (e) { return { ok: false, error: 'Lab setup failed: ' + e.message }; }
    s.lab = { activeId: id, startedAt: new Date().toISOString(), completed: {} };
    snap.begin(s);
    WS.state = s;
    WS.store.save();
    WS.shell.restart();
    return { ok: true };
  }

  function stop() {
    WS.state.lab = { activeId: null, startedAt: null, completed: {} };
    snap.clear();
    WS.store.changed('lab');
  }

  /* ---------- query helpers: { "<helper>": { ...args } } in a check ----------
   * Each compares only the fields given. Strings compare case-insensitively; lists ("members",
   * "memberOf") must all be present. Add more with WS.labs.helper(name, (args, state, WS) => bool). */
  const helpers = {};
  const same = (actual, expected) => typeof expected === 'string' ? String(actual == null ? '' : actual).toLowerCase() === expected.toLowerCase() : actual === expected;
  const fieldsMatch = (obj, args, skip) => Object.entries(args).every(([k, v]) => skip.includes(k) || same(obj[k], v));
  const allIn = (names, list) => [].concat(names).every(n => list.some(x => same(x, n)));
  const adNames = list => list.flatMap(o => [o.name, o.sam].filter(Boolean));
  const adParentIs = (o, ou) => { if (ou == null) return true; const p = WS.ad.byId(o.parentId); const want = WS.ad.container(ou); return !!p && (want ? p.id === want.id : same(p.name, ou)); };
  function helper(name, fn) { helpers[name] = (args, state) => fn(args, state, WS); }

  helper('feature', a => typeof a === 'string' ? WS.features.isInstalled(a) : same(WS.features.installState(a.id), a.state || 'Installed'));
  /* Processes (WS.proc): { name: 'notepad.exe', running, priority: 'BelowNormal' | 'Below normal', efficiency }. "Not running" only
   * counts while someone is signed in, so a process that starts with the session can't look ended before sign-in. */
  helper('process', a => {
    const hits = WS.proc.find(a.name);
    if (a.running === false) return WS.proc.sessionActive() && hits.length === 0;
    return hits.some(p => (a.priority == null || p.priority === WS.proc.priorityName(a.priority)) && (a.efficiency == null || p.efficiency === a.efficiency) && (a.user == null || same(p.user, a.user)));
  });
  // IIS: sites, application pools, default documents, and what a browser gets back
  const iisBinding = (b, want) => (want.protocol == null || same(b.protocol, want.protocol)) && (want.port == null || b.port === +want.port) && (want.host == null || same(b.host, want.host)) && (want.ip == null || same(b.ip, want.ip)) && (want.cert == null || !!b.cert === !!want.cert)
    && (!want.certCovers || (!!b.cert && !!WS.certs.get(b.cert) && WS.certs.covers(WS.certs.get(b.cert), b.host)));
  helper('iisSite', a => {
    const s = WS.iis && WS.iis.site(a.name);
    if (a.exists === false) return !s;
    if (!s) return false;
    if (a.state && !same(WS.iis.siteState(s), a.state)) return false;
    if (a.physicalPath && WS.fs.full(WS.fs.expandEnv(WS.iis.rootPath(s))).toLowerCase().replace(/\\+$/, '') !== WS.fs.full(a.physicalPath).toLowerCase().replace(/\\+$/, '')) return false;
    if (a.pool && !same(WS.iis.rootPool(s), a.pool)) return false;
    if (a.binding && ![].concat(a.binding).every(w => s.bindings.some(b => iisBinding(b, w)))) return false;
    if (a.dirBrowse != null && WS.iis.dirBrowse(s.name).enabled !== !!a.dirBrowse) return false;
    if (a.vdir && !s.vdirs.some(v => same(v.path, WS.iis.normPath(a.vdir.path || a.vdir)) && (!a.vdir.physicalPath || same(WS.fs.expandEnv(v.physicalPath), a.vdir.physicalPath)))) return false;
    return true;
  });
  helper('iisAppPool', a => {
    const p = WS.iis && WS.iis.pool(a.name);
    if (a.exists === false) return !p;
    if (!p) return false;
    const rt = a.runtime == null ? null : /no managed/i.test(a.runtime) ? '' : a.runtime;
    return (rt == null || p.runtime === rt) && (a.pipeline == null || same(p.pipeline, a.pipeline)) && (a.state == null || same(WS.iis.poolState(p), a.state));
  });
  helper('iisDefaultDoc', a => { if (!WS.iis || !WS.iis.installed()) return false; const d = WS.iis.defaultDocs(a.site || null); const i = d.files.findIndex(f => same(f.value, a.file)); return d.enabled && i >= 0 && (a.first !== true || i === 0); });
  helper('http', a => {
    if (!WS.http || !WS.iis) return false;
    const r = WS.iis.silently(() => WS.http.fetch(a.url, { insecure: a.ignoreCert !== false }));
    if (a.ok === false) return !r.ok || r.status >= 400;
    return r.ok && r.status === (a.status || 200) && (!a.contains || String(r.body).toLowerCase().includes(String(a.contains).toLowerCase()));
  });
  // Hyper-V: virtual switches, VMs and virtual hard disks
  helper('vmSwitch', a => {
    const s = WS.hv && WS.hv.switch(a.name);
    if (a.exists === false) return !s;
    return !!s && (a.type == null || same(s.type, a.type)) && (a.adapter == null || same(s.adapter, a.adapter)) && (a.allowManagementOS == null || s.allowManagementOS === !!a.allowManagementOS);
  });
  helper('vm', a => {
    const v = WS.hv && WS.hv.vm(a.name);
    if (a.exists === false) return !v;
    if (!v) return false;
    const pathIn = (p, base) => !!p && WS.fs.full(p).toLowerCase().startsWith(WS.fs.full(base).toLowerCase().replace(/\\+$/, '') + '\\');
    if (a.generation != null && v.generation !== +a.generation) return false;
    if (a.state != null && !same(v.state, a.state)) return false;
    if (a.memoryStartupMB != null && v.memory.startup !== +a.memoryStartupMB) return false;
    if (a.maxStartupMB != null && v.memory.startup > +a.maxStartupMB) return false;
    if (a.dynamicMemory != null && v.memory.dynamic !== !!a.dynamicMemory) return false;
    if (a.cpu != null && v.cpu.count !== +a.cpu) return false;
    if (a.switch != null && !v.nics.some(n => same(n.switch, a.switch))) return false;
    if (a.pathUnder != null && !pathIn(v.path + '\\x', a.pathUnder)) return false;
    if (a.disk && !v.disks.some(d => { const x = d.path && WS.hv.vhd(d.path); return x && (a.disk.type == null || same(x.type, a.disk.type)) && (a.disk.format == null || same(x.format, a.disk.format)) && (a.disk.minSizeGB == null || x.size >= a.disk.minSizeGB * 1024 ** 3) && (a.disk.pathUnder == null || pathIn(x.path, a.disk.pathUnder)); })) return false;
    if (a.osInstalled != null && !!WS.hv.guestOs(v) !== !!a.osInstalled) return false;
    if (a.setupDone != null && !!(WS.hv.guestOs(v) || {}).setupDone !== !!a.setupDone) return false;
    if (a.ipInSubnet != null) { const ip = WS.hv.guestIps(v, 0)[0]; const [net, pre] = String(a.ipInSubnet).split('/'); if (!ip || !WS.util.inSubnet(ip, net, +pre || 24)) return false; }
    if (a.checkpoint != null && !v.checkpoints.some(c => same(c.name, a.checkpoint))) return false;
    if (a.autoStart != null && !same(v.autoStart, a.autoStart)) return false;
    if (a.autoStop != null && !same(v.autoStop, a.autoStop)) return false;
    if (a.secureBoot != null && v.firmware.secureBoot !== !!a.secureBoot) return false;
    return true;
  });
  helper('vhd', a => { const x = WS.hv && WS.hv.vhd(a.path); return a.exists === false ? !x : !!x && WS.fs.exists(x.path) && (a.type == null || same(x.type, a.type)) && (a.format == null || same(x.format, a.format)) && (a.minSizeGB == null || x.size >= a.minSizeGB * 1024 ** 3); });
  helper('startupApp', a => { const e = WS.proc.startupApps().find(x => same(x.name, a.name) || same(x.id, a.name)); return a.exists === false ? !e : !!e && (a.enabled == null || e.enabled === a.enabled); });
  helper('service', a => { const s = WS.svc.get(a.name); return !!s && (a.status == null || same(s.status, a.status)) && (a.startup == null || same(s.startType, a.startup) || same(s.startup, a.startup)); });
  helper('adapter', a => {
    const ad = WS.net.adapter(a.name);
    if (!ad) return false;
    if (a.static != null && ad.dhcp === a.static) return false;
    // dns: exact list in order; dnsIncludes: these servers appear somewhere in the list
    if (a.dns && a.dns.join(',') !== ad.dnsServers.join(',')) return false;
    if (a.dnsIncludes && !allIn(a.dnsIncludes, ad.dnsServers)) return false;
    // bindings: { ms_tcpip6: false } - Ethernet Properties check boxes by component ID
    if (a.bindings && !Object.entries(a.bindings).every(([id, on]) => WS.net.bound(ad, id) === !!on)) return false;
    return fieldsMatch(ad, a, ['name', 'static', 'dns', 'dnsIncludes', 'bindings']);
  });
  helper('adUser', a => {
    if (!WS.ad.isDC()) return false;
    const u = a.sam ? WS.ad.resolveIdentity(a.sam, 'user') : WS.ad.get(a.name, 'user');
    if (!u || !adParentIs(u, a.ou)) return false;
    if (a.memberOf && !allIn(a.memberOf, adNames(WS.ad.memberOf(u)))) return false;
    return fieldsMatch(u, a, ['sam', 'ou', 'memberOf']);
  });
  helper('adGroup', a => {
    if (!WS.ad.isDC()) return false;
    const g = WS.ad.get(a.name, 'group');
    if (!g || !adParentIs(g, a.ou)) return false;
    if (a.members && !allIn(a.members, adNames(WS.ad.members(g)))) return false;
    if (a.memberOf && !allIn(a.memberOf, adNames(WS.ad.memberOf(g)))) return false;
    return fieldsMatch(g, a, ['ou', 'members', 'memberOf']);
  });
  helper('adOU', a => {
    if (!WS.ad.isDC()) return false;
    return WS.ad.search({ type: 'organizationalUnit' }).some(o => same(o.name, a.name) && adParentIs(o, a.parent) && fieldsMatch(o, a, ['name', 'parent']));
  });
  helper('adComputer', a => { if (!WS.ad.isDC()) return false; const c = WS.ad.get(a.name, 'computer'); return !!c && adParentIs(c, a.ou) && fieldsMatch(c, a, ['name', 'ou']); });
  helper('dnsZone', a => { const z = WS.dns.zone(a.name); return !!z && fieldsMatch({ ...z, ...WS.dns.zoneInfo(z) }, a, ['name']); });
  // { "dnsForwarders": ["8.8.8.8"] } - these server-level forwarders are configured (in any order)
  helper('dnsForwarders', a => allIn(a, WS.dns.forwarders()));
  // { "conditionalForwarder": { "name": "fabrikam.com", "masters": ["192.168.1.1"], "adIntegrated": true } }
  helper('conditionalForwarder', a => { const c = WS.dns.conditionalForwarder(a.name); return !!c && (!a.masters || allIn(a.masters, c.masters)) && fieldsMatch(c, a, ['name', 'masters']); });
  helper('dnsRecord', a => {
    const recs = WS.dns.records(a.zone) || [];
    return recs.some(r => same(r.type, a.type || 'A') && (a.name == null || same(r.name, a.name) || same(r.fqdn, a.name)) &&
      (a.data == null || same(String(r.data).replace(/\.$/, ''), String(a.data).replace(/\.$/, ''))));
  });
  helper('resolves', a => { const r = WS.net.resolve(a.name); return r.ok && (a.ip == null || r.ip === a.ip); });
  helper('ping', a => WS.net.ping(a.target, 1).ok === (a.ok !== false));
  helper('dhcpScope', a => {
    const s = a.id ? WS.dhcp.scope(a.id) : WS.dhcp.scopes().find(x => a.name ? same(x.name, a.name) : true);
    if (!s) return false;
    if (a.exclusion && !s.exclusions.some(e => e.start === a.exclusion.start && e.end === (a.exclusion.end || a.exclusion.start))) return false;
    if (a.reservation && !s.reservations.some(r => (!a.reservation.ip || r.ip === a.reservation.ip) && (!a.reservation.mac || r.mac === WS.dhcp.normMac(a.reservation.mac)))) return false;
    if (a.option) { const v = WS.dhcp.effectiveOptions(s.id)[a.option.code]; if (JSON.stringify([].concat(v || [])).toLowerCase() !== JSON.stringify([].concat(a.option.value)).toLowerCase()) return false; }
    return fieldsMatch(s, a, ['id', 'name', 'exclusion', 'reservation', 'option']) && (!a.name || same(s.name, a.name));
  });
  helper('dhcpAuthorized', a => WS.dhcp.authorized === (a !== false));
  // { "dhcpFilter": { "list": "deny", "mac": "00-15-5D-01-01-32", "enabled": true } } - list optional (either), enabled = that list is switched on
  helper('dhcpFilter', a => {
    const f = WS.dhcp.filters(), lists = a.list ? [String(a.list).toLowerCase()] : ['allow', 'deny'];
    if (a.enabled != null && lists.some(k => f[k + 'Enabled'] !== a.enabled)) return false;
    if (!a.mac) return true;
    const m = WS.dhcp.normFilterMac(a.mac);
    return lists.some(k => f[k].some(x => x.mac === m));
  });
  // { "dhcpLease": { "client": "CLIENT01", "ip": "192.168.1.150", "scope": "192.168.1.0", "reservation": true } } - fromServer: false = not leased from this server
  helper('dhcpLease', a => {
    const p = WS.state.network.peers.find(x => same(x.name, a.client || 'CLIENT01'));
    if (!p || (a.fromServer !== false) !== (p.leasedFrom === 'server') || (a.ip && p.ip !== a.ip)) return false;
    if (a.scope == null && a.reservation == null) return true;
    const l = (a.scope ? WS.dhcp.leases(a.scope) : WS.dhcp.scopes().flatMap(s => s.leases)).find(x => x.mac === p.mac);
    return !!l && (a.reservation == null || (l.type === 'Reservation') === !!a.reservation);
  });
  helper('share', a => {
    const s = WS.smb.get(a.name);
    if (!s) return false;
    if (a.path && !same(s.path.replace(/\\$/, ''), a.path.replace(/\\$/, ''))) return false;
    if (a.cachingMode && !same(s.cachingMode || 'Manual', a.cachingMode)) return false;
    if (a.concurrentUserLimit != null && (s.concurrentUserLimit || 0) !== a.concurrentUserLimit) return false;
    if (a.folderEnumerationMode && !same(s.folderEnumerationMode || 'Unrestricted', a.folderEnumerationMode)) return false;
    if (a.encryptData != null && !!s.encryptData !== !!a.encryptData) return false;
    if (a.access && ![].concat(a.access).every(x => s.access.some(y => same(y.account.replace(/^.*\\/, ''), x.account.replace(/^.*\\/, '')) && (!x.right || same(y.right, x.right)) && same(y.type, x.type || 'Allow')))) return false;
    return true;
  });
  helper('file', a => {
    const st = WS.fs.stat(a.path);
    if (a.exists === false) return !st;
    if (!st || (a.type && st.type !== a.type)) return false;
    if (a.contains != null) { try { return WS.fs.readFile(a.path).toLowerCase().includes(String(a.contains).toLowerCase()); } catch (e) { return false; } }
    return true;
  });
  helper('volume', a => {
    const v = WS.storage.volume(a.letter);
    if (!v) return false;
    if (a.minSizeGB && v.size < a.minSizeGB * WS.storage.GB * 0.99) return false;
    return fieldsMatch(v, a, ['letter', 'minSizeGB']);
  });
  helper('disk', a => { const d = WS.storage.disks().find(x => x.number === +a.number); return !!d && fieldsMatch(d, a, ['number']); });
  helper('firewallRule', a => {
    const rules = a.group ? WS.fw.rules({ group: a.group }) : WS.fw.find(a.name || a.displayName);
    return rules.length > 0 && rules.every(r => fieldsMatch(r, a, ['name', 'displayName', 'group']));
  });
  /** Would this connection get through the firewall right now? from: an IP address or a lab machine's name (CLIENT01). */
  helper('firewallAllows', a => {
    const peer = a.from && (WS.state.network.peers || []).find(p => same(p.name, a.from));
    const from = peer ? peer.ip : a.from;
    const proto = a.protocol || 'TCP';
    // ICMP checks mean ping (Echo Request) unless the lab names another type
    const icmpType = a.icmpType != null ? a.icmpType : /^icmpv4$/i.test(proto) ? 8 : /^icmpv6$/i.test(proto) ? 128 : null;
    return WS.fw.allows(a.direction || 'Inbound', proto, a.port == null ? null : +a.port, { from, program: a.program, icmpType }) === (a.allowed !== false);
  });
  helper('firewallProfile', a => { const p = WS.fw.profile(a.name); return !!p && (a.minLogMaxKB == null || p.logMaxKB >= a.minLogMaxKB) && fieldsMatch(p, a, ['name', 'minLogMaxKB']); });
  helper('localUser', a => {
    const u = WS.local.user(a.name);
    if (!u) return false;
    if (a.memberOf && !allIn(a.memberOf, WS.local.groupsOf(u.name))) return false;
    return fieldsMatch(u, a, ['name', 'memberOf']);
  });
  helper('localGroup', a => { const g = WS.local.group(a.name); return !!g && (!a.members || allIn(a.members, g.members)); });
  helper('event', a => WS.evt.list(a.log || 'System', { id: a.id }).some(e => (!a.source || same(e.source, a.source)) && (!a.contains || e.message.toLowerCase().includes(a.contains.toLowerCase()))));
  // { "eventLog": { "name": "System", "minMaxKB": 40960, "retention": "overwrite" } } - Log Properties / Limit-EventLog
  helper('eventLog', a => { const p = WS.evt.logProps(a.name); return !!p && (a.minMaxKB == null || p.maxKB >= a.minMaxKB) && fieldsMatch(p, a, ['name', 'minMaxKB']); });
  // { "customView": { "name": "Service errors", "logs": ["System"], "levels": ["Error"] } } - an Event Viewer custom view with (at least) these filters
  helper('customView', a => WS.evt.customViews().some(v => same(v.name, a.name) && (!a.logs || allIn(a.logs, (v.filter || {}).logs || [])) && (!a.levels || allIn(a.levels, (v.filter || {}).levels || []))));

  /* ---- Group Policy ---- */
  /** A comparison spec: a plain value (equal; strings ignore case), or { gte, lte, contains, nonEmpty }. */
  const cmp = (actual, spec) => {
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      if (spec.gte != null && !(Number(actual) >= spec.gte)) return false;
      if (spec.lte != null && !(Number(actual) <= spec.lte)) return false;
      if (spec.contains != null && !(Array.isArray(actual) ? allIn([spec.contains], actual) : String(actual == null ? '' : actual).toLowerCase().includes(String(spec.contains).toLowerCase()))) return false;
      if (spec.nonEmpty && !(Array.isArray(actual) ? actual.length : String(actual == null ? '' : actual).trim())) return false;
      return true;
    }
    return same(actual, spec);
  };
  // { "gpo": { "name": "Sales Desktop", "status": "AllSettingsEnabled", "linked": true } } or { "gpo": "Sales Desktop" }; "exists": false
  helper('gpo', a => {
    if (!WS.ad.isDC()) return false;
    const g = WS.gpo.get(typeof a === 'string' ? a : a.name);
    if (typeof a === 'string') return !!g;
    if (a.exists === false) return !g;
    if (!g) return false;
    if (a.status && !same(g.status, a.status)) return false;
    if (a.linked != null && (WS.gpo.links(g).length > 0) !== a.linked) return false;
    if (a.wmiFilter !== undefined && !(a.wmiFilter ? same((WS.gpo.wmiFilter(g.wmiFilter) || {}).name, a.wmiFilter) : !g.wmiFilter)) return false;
    return true;
  });
  // { "gpLink": { "gpo": "Sales Desktop", "target": "Sales", "enabled": true, "enforced": false, "order": 1 } } - target: OU path, DN or the domain name
  helper('gpLink', a => {
    if (!WS.ad.isDC()) return false;
    const g = WS.gpo.get(a.gpo), som = WS.gpo.somOf(a.target);
    const l = g && som && WS.gpo.somLinks(som).find(x => x.gpo === g.id);
    return !!l && (a.enabled == null || l.enabled === a.enabled) && (a.enforced == null || l.enforced === a.enforced) && (a.order == null || l.order === a.order);
  });
  // { "gpoSetting": { "gpo": "Default Domain Policy", "side": "computer", "key": "MinimumPasswordLength", "value": { "gte": 12 } } }
  //   policies (Administrative Templates): "state": "Enabled", "options": { "DisableCMD": 2 }; "defined": false = Not Defined / Not configured
  helper('gpoSetting', a => {
    if (!WS.ad.isDC() && !/^local$/i.test(a.gpo)) return false;
    const g = WS.gpo.get(a.gpo); if (!g) return false;
    const def = WS.gpo.definition(a.side || 'computer', a.key); if (!def) return false;
    const v = g[a.side || 'computer'][def.key];
    if (a.defined === false) return v === undefined;
    if (v === undefined) return false;
    if (a.state && !same(v.state, a.state)) return false;
    if (a.options && !Object.entries(a.options).every(([k, x]) => cmp(v.options[k], x))) return false;
    if (a.value !== undefined && !cmp(v, a.value)) return false;
    return true;
  });
  // { "gpInheritance": { "target": "Kiosks", "blocked": true } }
  helper('gpInheritance', a => WS.ad.isDC() && !!WS.gpo.somOf(a.target) && WS.gpo.isBlocked(a.target) === (a.blocked !== false));
  // { "gpoPermission": { "gpo": "Sales Desktop", "trustee": "Sales Staff", "level": "GpoApply" } } - level "None" = no entry at all
  helper('gpoPermission', a => {
    if (!WS.ad.isDC()) return false;
    const g = WS.gpo.get(a.gpo), who = WS.gpo.resolvePrincipal(a.trustee);
    if (!g || !who) return false;
    const e = WS.gpo.permissions(g).find(p => p.sid === who.sid);
    if (same(a.level, 'None')) return !e;
    return !!e && (a.level == null || [].concat(a.level).some(l => same(e.level, l)));
  });
  // { "domainPasswordPolicy": { "minLength": { "gte": 12 }, "lockoutThreshold": 5 } } - the domain's effective policy (Get-ADDefaultDomainPasswordPolicy)
  helper('domainPasswordPolicy', a => { const p = WS.ad.policy(); return !!p && Object.entries(a).every(([k, v]) => cmp(p[k], v)); });
  // { "gpoBackup": { "path": "C:\\GPOBackup", "gpo": "Sales Desktop" } } - a backup of that GPO (any GPO when omitted) in the folder
  helper('gpoBackup', a => WS.gpo.backups(a.path).some(b => !a.gpo || same(b.name, a.gpo)));
  // { "gpApplied": { "side": "computer", "gpo": "Default Domain Controllers Policy" } } - in the last processing results (gpresult)
  helper('gpApplied', a => { const r = WS.gpo.applied(a.side || 'computer'); return !!r && r.applied.some(e => same(e.name, a.gpo)) === (a.applied !== false); });
  // { "wmiFilter": { "name": "Member servers", "query": "ProductType" } }
  helper('wmiFilter', a => WS.ad.isDC() && WS.gpo.wmiFilters().some(f => same(f.name, a.name) && (!a.query || f.queries.some(q => q.query.toLowerCase().includes(a.query.toLowerCase())))));

  /* Group Policy Preferences Drive Maps items:
   * { "gppDrive": { "gpo": "Drive Mappings", "letter": "P", "action": "Update", "path": "\\\\DC01\\Public", "label": "Public", "persistent": true,
   *                 "targeting": { "type": "group", "name": "IT Staff" }, "removePolicy": true } }   // action: Create/Replace/Update/Delete or C/R/U/D; "exists": false */
  const bare = n => String(n == null ? '' : n).replace(/^[^\\]+\\(?!\\)/, '');
  helper('gppDrive', a => {
    if (!WS.ad.isDC() || !WS.gpp) return a.exists === false;
    const g = WS.gpo.get(a.gpo);
    const items = g ? WS.gpp.drives(g) : [];
    const hit = items.some(it => {
      if (a.letter && !same(it.letter, String(a.letter).replace(/:$/, ''))) return false;
      if (a.action && !(same(it.action, a.action) || same(WS.gpp.ACTIONS[it.action], a.action))) return false;
      if (a.path != null && !same(it.path.replace(/\\$/, ''), String(a.path).replace(/\\$/, ''))) return false;
      if (a.label != null && !same(it.label, a.label)) return false;
      for (const k of ['persistent', 'useLetter', 'disabled']) if (a[k] != null && !!it[k] !== !!a[k]) return false;
      for (const k of ['removePolicy', 'applyOnce', 'stopOnError']) if (a[k] != null && !!it.common[k] !== !!a[k]) return false;
      if (a.targeting) {
        if (!it.common.targeting) return false;
        const want = [].concat(a.targeting);
        if (!want.every(w => it.filters.some(f => (!w.type || f.type === w.type) && (!w.name || same(bare(f.name), bare(w.name)) || same(f.name, w.name)) && (w.not == null || f.not === !!w.not)))) return false;
      }
      return true;
    });
    return hit === (a.exists !== false);
  });
  /* Mapped network drives in the session (net use): { "mappedDrive": { "letter": "P", "remote": "\\\\DC01\\Public", "source": "gpp", "label": "Public" } }; "exists": false */
  helper('mappedDrive', a => {
    const d = WS.netuse ? WS.netuse.get(a.letter) : null;
    const ok = !!d && (a.remote == null || same(d.remote.replace(/\\$/, ''), String(a.remote).replace(/\\$/, ''))) && (a.label == null || same(d.label, a.label)) &&
      (a.source == null || same(d.source, a.source)) && (a.persistent == null || d.persistent === !!a.persistent) && (a.hidden == null || d.hidden === !!a.hidden);
    return ok === (a.exists !== false);
  });

  /** For JS lab setups: run the real model functions (install roles, promote, create users...) against the lab's
   * fresh state s before it goes live, e.g. setup: (s, WS) => WS.labs.withState(s, () => WS.ad.installForest({...})). */
  function withState(s, fn) {
    const prev = WS.state;
    WS.state = s;
    try { return fn(); } finally { WS.state = prev; }
  }

  /* ---------- step snapshots (undo to a step) ---------- */
  const snap = (() => {
    const DB = 'ws2025lab', STORE = 'labSnapshots', LS_KEY = 'ws2025lab.labSnapshots.v1', MAX = 40;
    let set = null;        // { labId, startedAt, list: [{ id, kind: 'start' | 'step', objectives: [id], done: n, created, state }] }
    let backend = 'memory', ready = null;
    const idb = () => new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no IndexedDB'));
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    const tx = (mode, fn) => idb().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode); const st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => { db.close(); resolve(r && r.result); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    }));
    // load once at startup (the Lab Guide repaints on 'lab' when it arrives)
    ready = tx('readonly', st => st.get('current')).then(v => { backend = 'indexeddb'; if (v && !set) set = v; })
      .catch(() => { try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); backend = 'localStorage'; if (v && !set) set = v; } catch (e) { backend = 'memory'; } })
      .then(() => WS.store.changed('lab'));
    let saving = Promise.resolve();
    function persist() {
      const data = set;
      saving = saving.then(() => ready).then(() => {
        if (backend === 'indexeddb') return tx('readwrite', st => (data ? st.put(data, 'current') : st.delete('current'))).catch(() => { backend = 'localStorage'; return persistLs(data); });
        if (backend === 'localStorage') return persistLs(data);
      });
      return saving;
    }
    function persistLs(data) {
      try { if (data) localStorage.setItem(LS_KEY, JSON.stringify(data)); else localStorage.removeItem(LS_KEY); }
      catch (e) {
        // browser storage is full: drop the oldest step snapshots (never the start) until it fits, or keep them in memory only
        while (data && data.list.length > 2) { data.list.splice(1, 1); try { localStorage.setItem(LS_KEY, JSON.stringify(data)); return; } catch (e2) { /* still too big */ } }
        backend = 'memory';
      }
    }
    const current = () => !!set && !!WS.state.lab && set.labId === WS.state.lab.activeId && set.startedAt === WS.state.lab.startedAt;
    const mk = (kind, state, objectives) => ({ id: WS.util.uid('ls'), kind, objectives, done: Object.keys(state.lab.completed || {}).length, created: new Date().toISOString(), state: WS.util.deepClone(state) });
    return {
      /** A lab is starting from state s (before its first boot): its starting point is snapshot 0. */
      begin(s) { set = { labId: s.lab.activeId, startedAt: s.lab.startedAt, list: [mk('start', s, [])] }; persist(); WS.store.changed('lab'); },
      /** Objectives just completed: save the lab as it is now. */
      capture(ids) {
        if (!WS.state.lab.activeId) return;
        if (!current()) set = { labId: WS.state.lab.activeId, startedAt: WS.state.lab.startedAt, list: [] };   // e.g. a lab started before this feature
        set.list.push(mk('step', WS.state, ids.slice()));
        while (set.list.length > MAX) set.list.splice(1, 1);
        persist();
      },
      clear() { set = null; persist(); },
      list: () => (current() ? set.list.map(({ state, ...x }) => x) : []),
      get: id => (current() ? set.list.find(x => x.id === id) || null : null),
      /** Put the server back to a snapshot and restart it. Later snapshots go; the chosen one stays (you can go back to it again). */
      revert(id) {
        const target = current() && set.list.find(x => x.id === id);
        if (!target) return { ok: false, error: 'That step snapshot is no longer available.' };
        set.list = set.list.slice(0, set.list.indexOf(target) + 1);
        persist();
        const state = WS.util.deepClone(target.state);
        if (WS.host && WS.host.restoreState) WS.host.restoreState(state);
        else { WS.store.applyState(state); WS.store.save(); if (WS.shell && WS.shell.boot) WS.shell.boot(); }
        WS.store.changed('lab');
        return { ok: true };
      },
      get backend() { return backend; }, ready: () => ready, saved: () => saving
    };
  })();
  /** Describe a snapshot for people: "Start of lab", "Step 3 complete", "Steps 2 and 3 complete". */
  function snapshotLabel(x) {
    const lab = active();
    if (x.kind === 'start') return 'Start of lab';
    const nums = x.objectives.map(id => lab ? lab.objectives.findIndex(o => o.id === id) + 1 : 0).filter(Boolean).sort((a, b) => a - b);
    if (!nums.length) return 'Step complete';
    return nums.length === 1 ? `Step ${nums[0]} complete` : `Steps ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]} complete`;
  }

  WS.labs = {
    snapshots: Object.assign(snap, { label: snapshotLabel }),
    helper, helpers: () => Object.keys(helpers), withState,
    register, importJSON, removeCustom, start, stop, active, progress, evaluate, evalCheck,
    list: () => Object.values(labs), get: id => labs[id] || null
  };
})();
