/* IIS model: WS.iis (sites, bindings, applications, virtual directories, application pools, default documents,
 * directory browsing, request handling, W3C logs, worker processes) and WS.certs (the LocalMachine certificate stores).
 * IIS Manager, the IISAdministration/WebAdministration cmdlets, appcmd, iisreset, Edge, Invoke-WebRequest and curl
 * all go through it.
 *
 * State (the lab API):
 *   iis = null until Web Server (IIS) is installed, then
 *     { nextSiteId,
 *       sites: [{ id, name, state: 'Started'|'Stopped', autoStart,
 *                 bindings: [{ protocol: 'http'|'https', ip: '*'|'192.168.1.10', port, host, cert (thumbprint|null), sni }],
 *                 apps: [{ path: '/', pool }], vdirs: [{ path: '/', physicalPath }] }],
 *       pools: [{ name, runtime: 'v4.0'|'' (No Managed Code), pipeline: 'Integrated'|'Classic', state, identity, autoStart }],
 *       server: { defaultDocument: { enabled, files: [] }, directoryBrowse: { enabled, showFlags } },
 *       config: { '<site>[/path]' (lower case): { defaultDocument?: { enabled?, files?, local? }, directoryBrowse?: { enabled, showFlags } } } }
 *   certs = { my: [cert], webhosting: [cert] }, cert = { thumbprint, subject, issuer, friendlyName, dnsNames[], notBefore, notAfter, selfSigned }
 *
 * A scope is null (the server), 'Site' or 'Site/path'. Results follow the model convention ({ ok, code, error }).
 * The site's applicationHost.config and web.config files are written from the model (they are not read back).
 *
 * request({ protocol, host, ip, port, path, query, clientIp, userAgent }) is what HTTP.sys and IIS do with a request
 * that reached this server: { kind: 'refused' | 'reset' } or { kind: 'response', status, sub, reason, contentType,
 * body, title, phys, site, binding, cert, location (301) }. Error bodies are IIS 10's detailed errors (local requests). */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util;
  const INETSRV = 'C:\\Windows\\System32\\inetsrv';
  const WWWROOT = '%SystemDrive%\\inetpub\\wwwroot';
  const DEFAULT_DOCS = ['Default.htm', 'Default.asp', 'index.htm', 'index.html', 'iisstart.htm'];
  const SHOW_FLAGS = 'Date, Time, Size, Extension';
  /* The static MIME map entries the simulator serves (a subset of applicationHost.config's staticContent). */
  const MIME = {
    htm: 'text/html', html: 'text/html', txt: 'text/plain', css: 'text/css', js: 'application/javascript', xml: 'text/xml', json: 'application/json', csv: 'text/csv',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp',
    pdf: 'application/pdf', zip: 'application/x-zip-compressed', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', mp4: 'video/mp4', woff: 'font/x-woff', woff2: 'application/font-woff2', msi: 'application/octet-stream', exe: 'application/octet-stream'
  };
  /* Request filtering: hidden segments and denied extensions (applicationHost.config defaults, abridged). */
  const HIDDEN = ['web.config', 'bin', 'app_code', 'app_globalresources', 'app_localresources', 'app_webreferences', 'app_data', 'app_browsers'];
  const DENIED_EXT = ['config', 'asax', 'ascx', 'master', 'skin', 'browser', 'sitemap', 'cs', 'vb', 'mdb', 'ldf', 'mdf', 'csproj', 'vbproj', 'resx', 'licx', 'webinfo', 'sln', 'suo', 'dll.config'];

  WS.store.init('iis', s => { s.iis = null; });
  WS.store.init('certs', s => { s.certs = { my: [], webhosting: [] }; });

  const st = () => WS.state.iis;
  const installed = () => !!st() && WS.features.isInstalled('Web-Server');
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const same = (a, b) => lc(a) === lc(b);
  const fail = (code, error) => ({ ok: false, code, error });
  const NOT_INSTALLED = () => fail('NotInstalled', 'Web Server (IIS) is not installed on this server.');
  const w3svc = () => WS.svc.isRunning('W3SVC');
  const was = () => WS.svc.isRunning('WAS');

  /* ================================================================ defaults */
  function fresh() {
    const files = DEFAULT_DOCS.slice();
    if (WS.features.isInstalled('Web-Asp-Net45')) files.push('default.aspx');
    return {
      nextSiteId: 2,
      sites: [{ id: 1, name: 'Default Web Site', state: 'Started', autoStart: true, bindings: [{ protocol: 'http', ip: '*', port: 80, host: '', cert: null, sni: false }],
        apps: [{ path: '/', pool: 'DefaultAppPool' }], vdirs: [{ path: '/', physicalPath: WWWROOT }] }],
      pools: [{ name: 'DefaultAppPool', runtime: 'v4.0', pipeline: 'Integrated', state: 'Started', identity: 'ApplicationPoolIdentity', autoStart: true }],
      server: { defaultDocument: { enabled: true, files }, directoryBrowse: { enabled: false, showFlags: SHOW_FLAGS } },
      config: {}
    };
  }
  function layDown() {
    WS.fs.ensureDir(INETSRV + '\\config');
    for (const f of ['appcmd.exe', 'InetMgr.exe', 'w3wp.exe', 'iisreset.exe']) WS.fs.ensureFile((f === 'iisreset.exe' ? 'C:\\Windows\\System32\\' : INETSRV + '\\') + f, '');
    WS.fs.ensureDir('C:\\inetpub\\logs\\LogFiles');
    WS.fs.ensureDir('C:\\inetpub\\temp\\appPools');
  }
  WS.features.on('install', id => {
    if (id === 'Web-Server') { if (!WS.state.iis) WS.state.iis = fresh(); layDown(); commit(); }
    if (id === 'Web-Asp-Net45' && st()) {
      const d = st().server.defaultDocument;
      if (!d.files.some(f => same(f, 'default.aspx'))) d.files.push('default.aspx');
      for (const n of ['.NET v4.5', '.NET v4.5 Classic']) if (!pool(n)) st().pools.push({ name: n, runtime: 'v4.0', pipeline: /Classic/.test(n) ? 'Classic' : 'Integrated', state: 'Started', identity: 'ApplicationPoolIdentity', autoStart: true });
      commit();
    }
  });
  WS.features.on('uninstall', id => { if (id === 'Web-Server') { WS.state.iis = null; workers = {}; WS.store.changed('iis'); } });
  WS.sys.on('boot', () => {
    workers = {};
    if (WS.features.isInstalled('Web-Server')) { if (!WS.state.iis) WS.state.iis = fresh(); layDown(); }
  });

  /* ================================================================ lookups */
  const sites = () => (st() ? st().sites.slice().sort((a, b) => a.id - b.id) : []);
  function site(x) {
    if (!st() || x == null) return null;
    if (typeof x === 'object') return st().sites.includes(x) ? x : site(x.name);
    if (/^\d+$/.test(String(x))) { const byId = st().sites.find(s => s.id === +x); if (byId) return byId; }
    return st().sites.find(s => same(s.name, x)) || null;
  }
  const pools = () => (st() ? st().pools.slice().sort((a, b) => a.name.localeCompare(b.name)) : []);
  const pool = name => (st() ? st().pools.find(p => same(p.name, name)) || null : null);
  const rootPath = s => (s.vdirs.find(v => v.path === '/') || {}).physicalPath || '';
  const rootPool = s => (s.apps.find(a => a.path === '/') || {}).pool || 'DefaultAppPool';
  /** The state IIS Manager and Get-IISSite show: Unknown while W3SVC is stopped. */
  const siteState = s => (!w3svc() ? 'Unknown' : s.state);
  const poolState = p => (!was() ? 'Unknown' : p.state);
  const appsUsing = name => sites().flatMap(s => s.apps.filter(a => same(a.pool, name)).map(a => ({ site: s, app: a })));

  /* ---------------- bindings ---------------- */
  /** '*:80:www.contoso.com' (bindingInformation) */
  const bindingInfo = b => `${b.ip || '*'}:${b.port}:${b.host || ''}`;
  /** Binding column text in IIS Manager: "www.contoso.com on *:80 (http)" */
  const bindingLabel = b => `${b.host ? b.host + ' on ' : ''}${b.ip || '*'}:${b.port} (${b.protocol})`;
  function parseBinding(info, protocol = 'http') {
    const m = /^\s*([^:]*|\[[^\]]*\]):(\d*):(.*)$/.exec(String(info || ''));
    if (!m) return null;
    return { protocol: lc(protocol) || 'http', ip: m[1] === '' || m[1] === '*' ? '*' : m[1], port: +m[2], host: m[3].trim(), cert: null, sni: false };
  }
  const HOST_BAD = /[/\\[\]:|<>+=;,?*$%#@{}^`"\s]/;
  function checkBinding(b) {
    if (!['http', 'https'].includes(b.protocol)) return fail('InvalidArgument', `The protocol '${b.protocol}' is not supported. Use http or https.`);
    if (!Number.isInteger(+b.port) || +b.port < 1 || +b.port > 65535) return fail('InvalidPort', 'The specified port is invalid. The port must be a number between 1 and 65535.');
    if (b.ip !== '*' && !U.isValidIp(b.ip)) return fail('InvalidIp', `'${b.ip}' is not a valid IP address.`);
    if (b.host && (HOST_BAD.test(b.host) || b.host.length > 255 || /^\.|\.$|\.\./.test(b.host))) return fail('InvalidHost', 'The specified host name is incorrect. The host name must use a valid host name format and cannot contain the following characters: "/\\[]:|<>+=;,?*$%#@{}^`. Example: www.contoso.com.');
    if (b.protocol === 'https' && b.cert && !certs.get(b.cert)) return fail('CertNotFound', `A certificate with the thumbprint '${b.cert}' was not found in the certificate store.`);
    return { ok: true };
  }
  const sameBinding = (a, b) => a.protocol === b.protocol && same(bindingInfo(a), bindingInfo(b));
  /** Other sites that have exactly this binding (only one of them can run). */
  const conflicts = (b, except) => sites().filter(s => s !== except && s.bindings.some(x => sameBinding(x, b)));
  const runningConflict = s => s.bindings.some(b => conflicts(b, s).some(o => o.state === 'Started'));
  const normBinding = b => ({ protocol: lc(b.protocol || 'http'), ip: !b.ip || b.ip === 'All Unassigned' ? '*' : String(b.ip), port: +b.port, host: String(b.host || '').trim().toLowerCase(), cert: b.cert ? String(b.cert).toUpperCase() : null, sni: !!b.sni });

  /* ================================================================ sites */
  function newSite(o = {}) {
    if (!installed()) return NOT_INSTALLED();
    const name = String(o.name || '').trim();
    if (!name) return fail('InvalidName', 'The site name cannot be empty.');
    if (/[\\/?;:@&=+$,|"<>*]/.test(name)) return fail('InvalidName', 'The site name cannot contain the following characters: \\, /, ?, ;, :, @, &, =, +, $, ,, |, ", <, >, *.');
    if (site(name)) return fail('Exists', `Failed to add duplicate collection element "${name}".`);
    const physicalPath = String(o.physicalPath || '').trim();
    if (!physicalPath) return fail('InvalidPath', 'The physical path cannot be empty.');
    const bindings = (o.bindings && o.bindings.length ? o.bindings : [{ protocol: 'http', ip: '*', port: 80, host: '' }]).map(normBinding);
    for (const b of bindings) { const c = checkBinding(b); if (!c.ok) return c; }
    if (o.id != null && st().sites.some(s => s.id === +o.id)) return fail('Exists', `A site with ID ${o.id} already exists.`);
    let poolName = o.pool || 'DefaultAppPool';
    if (o.createPool) { // IIS Manager's Add Website makes a pool named after the site
      poolName = name;
      if (!pool(poolName)) st().pools.push({ name: poolName, runtime: 'v4.0', pipeline: 'Integrated', state: 'Started', identity: 'ApplicationPoolIdentity', autoStart: true });
    }
    const id = o.id != null ? +o.id : Math.max(st().nextSiteId, ...st().sites.map(s => s.id + 1));
    st().nextSiteId = Math.max(st().nextSiteId, id + 1);
    const s = { id, name, state: 'Stopped', autoStart: true, bindings, apps: [{ path: '/', pool: poolName }], vdirs: [{ path: '/', physicalPath }] };
    st().sites.push(s);
    let conflict = bindings.some(b => conflicts(b, s).length);
    if (o.start !== false && !bindings.some(b => conflicts(b, s).some(x => x.state === 'Started'))) s.state = 'Started';
    if (s.state === 'Stopped') s.autoStart = o.start === false ? false : s.autoStart;
    commit();
    return { ok: true, site: s, conflict, started: s.state === 'Started' };
  }
  function removeSite(name) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    st().sites.splice(st().sites.indexOf(s), 1);
    for (const k of Object.keys(st().config)) if (k === lc(s.name) || k.startsWith(lc(s.name) + '/')) delete st().config[k];
    commit();
    return { ok: true };
  }
  const notFoundSite = name => fail('NotFound', `Cannot find SITE object with identifier "${name}".`);
  function startSite(name) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    if (!w3svc()) return fail('ServiceStopped', 'The World Wide Web Publishing Service (W3SVC) is stopped. Websites cannot be started unless the World Wide Web Publishing Service (W3SVC) is running.');
    if (runningConflict(s)) return fail('InUse', 'The process cannot access the file because it is being used by another process. (Exception from HRESULT: 0x80070020)');
    if (s.state !== 'Started') { s.state = 'Started'; s.autoStart = true; commit(); }
    return { ok: true, site: s };
  }
  function stopSite(name) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    if (!w3svc()) return fail('ServiceStopped', 'The World Wide Web Publishing Service (W3SVC) is stopped. Websites cannot be started unless the World Wide Web Publishing Service (W3SVC) is running.');
    if (s.state !== 'Stopped') { s.state = 'Stopped'; s.autoStart = false; commit(); }
    return { ok: true, site: s };
  }
  /** setSite(name, { name, physicalPath, pool }) - Edit Site / Basic Settings, Rename. */
  function setSite(name, o = {}) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    if (o.name != null && !same(o.name, s.name)) {
      const nn = String(o.name).trim();
      if (!nn) return fail('InvalidName', 'The site name cannot be empty.');
      if (site(nn)) return fail('Exists', `Failed to add duplicate collection element "${nn}".`);
      const old = lc(s.name);
      for (const k of Object.keys(st().config)) if (k === old || k.startsWith(old + '/')) { st().config[lc(nn) + k.slice(old.length)] = st().config[k]; delete st().config[k]; }
      s.name = nn;
    } else if (o.name != null) s.name = String(o.name).trim();
    if (o.physicalPath != null) { const v = s.vdirs.find(x => x.path === '/'); v.physicalPath = String(o.physicalPath).trim(); }
    if (o.pool != null) { const a = s.apps.find(x => x.path === '/'); a.pool = o.pool; }
    commit();
    return { ok: true, site: s };
  }
  function addBinding(name, b) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    b = normBinding(b);
    const c = checkBinding(b); if (!c.ok) return c;
    if (s.bindings.some(x => sameBinding(x, b))) return fail('Exists', `Cannot add duplicate collection entry of type 'binding' with combined key attributes 'protocol, bindingInformation' respectively set to '${b.protocol}, ${bindingInfo(b)}'`);
    s.bindings.push(b);
    commit();
    return { ok: true, binding: b, conflict: conflicts(b, s).length > 0 };
  }
  function findBinding(s, m) { return s.bindings.findIndex(b => (m.protocol == null || b.protocol === lc(m.protocol)) && (m.info == null || same(bindingInfo(b), m.info)) && (m.port == null || b.port === +m.port) && (m.host == null || same(b.host, m.host)) && (m.ip == null || b.ip === (m.ip === '' ? '*' : m.ip))); }
  /** removeBinding(site, { protocol, info } | { protocol, port, host, ip }) */
  function removeBinding(name, m) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    const i = findBinding(s, m);
    if (i < 0) return fail('NotFound', 'The specified binding was not found.');
    s.bindings.splice(i, 1);
    commit();
    return { ok: true };
  }
  /** setBinding(site, index, binding) - Edit Site Binding; also AddSslCertificate (cert only). */
  function setBinding(name, index, b) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    if (!s.bindings[index]) return fail('NotFound', 'The specified binding was not found.');
    b = normBinding({ ...s.bindings[index], ...b });
    const c = checkBinding(b); if (!c.ok) return c;
    if (s.bindings.some((x, i) => i !== index && sameBinding(x, b))) return fail('Exists', `Cannot add duplicate collection entry of type 'binding' with combined key attributes 'protocol, bindingInformation' respectively set to '${b.protocol}, ${bindingInfo(b)}'`);
    s.bindings[index] = b;
    commit();
    return { ok: true, binding: b, conflict: conflicts(b, s).length > 0 };
  }

  /* ---------------- applications and virtual directories ---------------- */
  const normPath = p => ('/' + String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).replace(/\/{2,}/g, '/');
  const apps = name => { const s = site(name); return s ? s.apps.slice().sort((a, b) => a.path.localeCompare(b.path)) : []; };
  const vdirs = name => { const s = site(name); return s ? s.vdirs.slice().sort((a, b) => a.path.localeCompare(b.path)) : []; };
  const ALIAS_BAD = /[\\?;:@&=+$,|"<>*]/;
  function addApp(name, o) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    const path = normPath(o.path);
    if (path === '/' || ALIAS_BAD.test(path)) return fail('InvalidName', 'The alias is invalid.');
    if (s.apps.some(a => same(a.path, path))) return fail('Exists', `Failed to add duplicate collection element "${s.name}${path}".`);
    if (!o.physicalPath) return fail('InvalidPath', 'The physical path cannot be empty.');
    s.apps.push({ path, pool: o.pool || rootPool(s) });
    const v = s.vdirs.find(x => same(x.path, path));
    if (v) v.physicalPath = o.physicalPath; else s.vdirs.push({ path, physicalPath: o.physicalPath });
    commit();
    return { ok: true };
  }
  function removeApp(name, path) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    path = normPath(path);
    const i = s.apps.findIndex(a => same(a.path, path));
    if (i < 0 || path === '/') return fail('NotFound', `Cannot find APP object with identifier "${s.name}${path}".`);
    s.apps.splice(i, 1);
    s.vdirs = s.vdirs.filter(v => !same(v.path, path));
    commit();
    return { ok: true };
  }
  function setApp(name, path, o) {
    const s = site(name);
    const a = s && s.apps.find(x => same(x.path, normPath(path)));
    if (!a) return fail('NotFound', `Cannot find APP object with identifier "${name}${normPath(path)}".`);
    if (o.pool != null) a.pool = o.pool;
    if (o.physicalPath != null) { const v = s.vdirs.find(x => same(x.path, a.path)); if (v) v.physicalPath = o.physicalPath; }
    commit();
    return { ok: true };
  }
  function addVdir(name, o) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    const path = normPath(o.path);
    if (path === '/' || ALIAS_BAD.test(path)) return fail('InvalidName', 'The alias is invalid.');
    if (s.vdirs.some(v => same(v.path, path))) return fail('Exists', `Failed to add duplicate collection element "${s.name}${path}".`);
    if (!o.physicalPath) return fail('InvalidPath', 'The physical path cannot be empty.');
    s.vdirs.push({ path, physicalPath: o.physicalPath });
    commit();
    return { ok: true };
  }
  function removeVdir(name, path) {
    const s = site(name);
    if (!s) return notFoundSite(name);
    path = normPath(path);
    const i = s.vdirs.findIndex(v => same(v.path, path));
    if (i < 0 || path === '/' || s.apps.some(a => same(a.path, path))) return fail('NotFound', `Cannot find VDIR object with identifier "${s.name}${path}".`);
    s.vdirs.splice(i, 1);
    commit();
    return { ok: true };
  }
  function setVdir(name, path, o) {
    const s = site(name);
    const v = s && s.vdirs.find(x => same(x.path, normPath(path)));
    if (!v) return fail('NotFound', `Cannot find VDIR object with identifier "${name}${normPath(path)}".`);
    if (o.physicalPath != null) v.physicalPath = o.physicalPath;
    commit();
    return { ok: true };
  }
  /** The longest application / virtual directory that contains a URL path. */
  const longest = (list, path) => list.filter(x => x.path === '/' || same(path, x.path) || lc(path).startsWith(lc(x.path) + '/')).sort((a, b) => b.path.length - a.path.length)[0] || null;
  /** URL path -> physical path (null when the site has no root). */
  function mapPath(s, urlPath) {
    const v = longest(s.vdirs, urlPath);
    if (!v) return null;
    const rest = urlPath.slice(v.path === '/' ? 1 : v.path.length).replace(/^\//, '');
    const base = WS.fs.expandEnv(v.physicalPath).replace(/\\+$/, '');
    return rest ? base + '\\' + rest.replace(/\//g, '\\') : base;
  }

  /* ---------------- application pools ---------------- */
  const POOL_BAD = /[\\/?;:@&=+$,|"<>*]/;
  function newPool(o = {}) {
    if (!installed()) return NOT_INSTALLED();
    const name = String(o.name || '').trim();
    if (!name) return fail('InvalidName', 'The application pool name cannot be empty.');
    if (POOL_BAD.test(name)) return fail('InvalidName', 'The application pool name contains invalid characters. The following characters are not allowed: \\, /, ?, ;, :, @, &, =, +, $, ,, |, ", <, >, *.');
    if (pool(name)) return fail('Exists', 'An application pool with this name already exists.');
    const p = { name, runtime: o.runtime == null ? 'v4.0' : o.runtime, pipeline: o.pipeline || 'Integrated', state: o.start === false ? 'Stopped' : 'Started', identity: o.identity || 'ApplicationPoolIdentity', autoStart: o.start !== false };
    st().pools.push(p);
    commit();
    return { ok: true, pool: p };
  }
  const notFoundPool = name => fail('NotFound', `Cannot find APPPOOL object with identifier "${name}".`);
  function removePool(name) {
    const p = pool(name);
    if (!p) return notFoundPool(name);
    st().pools.splice(st().pools.indexOf(p), 1);
    delete workers[lc(p.name)];
    commit();
    return { ok: true };
  }
  function setPool(name, o = {}) {
    const p = pool(name);
    if (!p) return notFoundPool(name);
    if (o.name != null && !same(o.name, p.name)) {
      const nn = String(o.name).trim();
      if (!nn || POOL_BAD.test(nn)) return fail('InvalidName', 'The application pool name contains invalid characters.');
      if (pool(nn)) return fail('Exists', 'An application pool with this name already exists.');
      for (const { app } of appsUsing(p.name)) app.pool = nn;
      delete workers[lc(p.name)];
      p.name = nn;
    }
    for (const k of ['runtime', 'pipeline', 'identity', 'autoStart']) if (o[k] != null) p[k] = o[k];
    if (o.runtime != null || o.pipeline != null || o.identity != null) recycleWorker(p);
    commit();
    return { ok: true, pool: p };
  }
  function startPool(name) {
    const p = pool(name);
    if (!p) return notFoundPool(name);
    if (!was()) return fail('ServiceStopped', 'The Windows Process Activation Service (WAS) is stopped. Application pools cannot be started unless the Windows Process Activation Service (WAS) is running.');
    if (p.state === 'Started') return fail('AlreadyStarted', 'The object identifier does not represent a valid object. (Exception from HRESULT: 0x800710D8)');
    p.state = 'Started'; p.autoStart = true;
    commit();
    return { ok: true };
  }
  function stopPool(name) {
    const p = pool(name);
    if (!p) return notFoundPool(name);
    if (!was()) return fail('ServiceStopped', 'The Windows Process Activation Service (WAS) is stopped. Application pools cannot be started unless the Windows Process Activation Service (WAS) is running.');
    if (p.state === 'Stopped') return fail('AlreadyStopped', 'The object identifier does not represent a valid object. (Exception from HRESULT: 0x800710D8)');
    p.state = 'Stopped'; p.autoStart = false;
    delete workers[lc(p.name)];
    commit();
    return { ok: true };
  }
  function recyclePool(name) {
    const p = pool(name);
    if (!p) return notFoundPool(name);
    if (p.state !== 'Started' || !was()) return fail('NotStarted', 'The object identifier does not represent a valid object. (Exception from HRESULT: 0x800710D8)');
    recycleWorker(p);
    WS.store.changed('processes');
    return { ok: true };
  }

  /* ---------------- worker processes (w3wp.exe, started on demand, one per pool) ---------------- */
  let workers = {}; // pool (lower case) -> { gen, requests, started }
  let quiet = 0;   // silently(): lab checks make requests without starting workers or writing logs (which would re-trigger the checks)
  function silently(fn) { quiet++; try { return fn(); } finally { quiet--; } }
  const workerKey = (p, w) => `w3wp:${lc(p.name)}:${w.gen}`;
  function recycleWorker(p) { const w = workers[lc(p.name)]; if (w) workers[lc(p.name)] = { gen: w.gen + 1, requests: 0, started: Date.now() }; }
  /** The pool's worker, started for a request if it isn't running (a killed one is replaced). */
  function ensureWorker(p) {
    if (quiet) return null;
    let w = workers[lc(p.name)];
    if (w && WS.proc && WS.proc.isDead(workerKey(p, w))) w = null;
    if (!w) { const prev = Object.values(workers).reduce((m, x) => Math.max(m, x.gen), 0); w = workers[lc(p.name)] = { gen: prev + 1, requests: 0, started: Date.now() }; WS.store.changed('processes'); }
    w.requests++;
    return w;
  }
  function workerList() {
    if (!installed() || !was() || !WS.proc) return [];
    const procs = WS.proc.list();
    return pools().filter(p => workers[lc(p.name)] && p.state === 'Started').map(p => ({ pool: p, proc: procs.find(x => x.key === workerKey(p, workers[lc(p.name)])) })).filter(x => x.proc);
  }
  if (WS.proc && WS.proc.addSource) WS.proc.addSource(add => {
    if (!installed() || !was()) return;
    for (const p of st().pools) {
      const w = workers[lc(p.name)];
      if (!w || p.state !== 'Started') continue;
      add(workerKey(p, w), { image: 'w3wp.exe', path: INETSRV + '\\w3wp.exe', description: 'IIS Worker Process', user: p.name, accountDomain: 'IIS APPPOOL', kind: 'background', cpuBase: 0.05, memBase: 9800 + Math.min(w.requests, 40) * 60,
        threads: 22, handles: 610, parentKey: 'svc:WAS', iisPool: p.name,
        cmdLine: `c:\\windows\\system32\\inetsrv\\w3wp.exe -ap "${p.name}" -v "${p.runtime || ''}" -l "webengine4.dll" -a \\\\.\\pipe\\iisipm${U.hashStr(p.name + w.gen).toString(16)} -h "C:\\inetpub\\temp\\apppools\\${p.name}\\${p.name}.config" -w "" -m 0 -t 20 -ta 0` });
    }
  });

  /* ================================================================ configuration: default documents, directory browsing */
  const scopeKey = scope => {
    if (!scope) return null;
    const i = String(scope).indexOf('/');
    const sName = i < 0 ? scope : scope.slice(0, i), path = i < 0 ? '/' : normPath(scope.slice(i));
    const s = site(sName);
    if (!s) return undefined;
    return lc(s.name) + (path === '/' ? '' : lc(path));
  };
  const parentKey = key => (key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : null);
  /** Effective default documents at a scope: { enabled, files: [{ value, local }] } */
  function defaultDocs(scope) {
    if (!st()) return { enabled: false, files: [] };
    const srv = st().server.defaultDocument;
    let key = scopeKey(scope);
    if (key === undefined) return { enabled: srv.enabled, files: srv.files.map(value => ({ value, local: false })) };
    if (key === null) return { enabled: srv.enabled, files: srv.files.map(value => ({ value, local: true })) };
    const own = (st().config[key] || {}).defaultDocument;
    let files = null, enabled = null, k = key;
    while (k && (files == null || enabled == null)) {
      const c = (st().config[k] || {}).defaultDocument;
      if (c) { if (files == null && c.files) files = c.files; if (enabled == null && c.enabled != null) enabled = c.enabled; }
      k = parentKey(k);
    }
    if (files == null) files = srv.files;
    if (enabled == null) enabled = srv.enabled;
    const local = own && own.local ? own.local.map(lc) : [];
    return { enabled, files: files.map(value => ({ value, local: local.includes(lc(value)) })) };
  }
  function cfg(scope, section) {
    const key = scopeKey(scope);
    if (key === undefined) return null;
    if (key === null) return st().server[section];
    const c = st().config[key] = st().config[key] || {};
    return c[section] = c[section] || {};
  }
  const DOC_BAD = /[\\/:*?"<>|]/;
  function addDefaultDoc(scope, value, index = 0) {
    if (!st()) return NOT_INSTALLED();
    value = String(value || '').trim();
    if (!value || DOC_BAD.test(value)) return fail('InvalidName', 'The default document name is invalid.');
    const cur = defaultDocs(scope);
    if (cur.files.some(f => same(f.value, value))) return fail('Exists', `Cannot add duplicate collection entry of type 'add' with unique key attribute 'value' set to '${value}'`);
    const c = cfg(scope, 'defaultDocument');
    if (!c) return notFoundSite(scope);
    const files = cur.files.map(f => f.value);
    files.splice(Math.max(0, Math.min(index, files.length)), 0, value);
    if (scope) { c.files = files; c.local = [...(c.local || []), value]; } else c.files = files;
    commit(scope);
    return { ok: true };
  }
  function removeDefaultDoc(scope, value) {
    if (!st()) return NOT_INSTALLED();
    const cur = defaultDocs(scope);
    if (!cur.files.some(f => same(f.value, value))) return fail('NotFound', `The default document '${value}' was not found.`);
    const c = cfg(scope, 'defaultDocument');
    if (!c) return notFoundSite(scope);
    c.files = cur.files.map(f => f.value).filter(v => !same(v, value));
    if (scope) c.local = (c.local || []).filter(v => !same(v, value));
    commit(scope);
    return { ok: true };
  }
  /** Move Up / Move Down (every entry at this scope becomes local, as IIS Manager does). */
  function moveDefaultDoc(scope, value, dir) {
    if (!st()) return NOT_INSTALLED();
    const files = defaultDocs(scope).files.map(f => f.value);
    const i = files.findIndex(v => same(v, value)), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= files.length) return fail('InvalidOperation', 'The entry cannot be moved.');
    [files[i], files[j]] = [files[j], files[i]];
    const c = cfg(scope, 'defaultDocument');
    c.files = files;
    if (scope) c.local = files.slice();
    commit(scope);
    return { ok: true };
  }
  function setDefaultDocEnabled(scope, on) {
    if (!st()) return NOT_INSTALLED();
    const c = cfg(scope, 'defaultDocument');
    if (!c) return notFoundSite(scope);
    c.enabled = !!on;
    commit(scope);
    return { ok: true };
  }
  function revert(scope, section) {
    const key = scopeKey(scope);
    if (!key || !st().config[key]) return { ok: true };
    delete st().config[key][section];
    if (!Object.keys(st().config[key]).length) delete st().config[key];
    commit(scope);
    return { ok: true };
  }
  const hasLocal = (scope, section) => { const key = scopeKey(scope); return !!key && !!(st().config[key] || {})[section]; };
  function dirBrowse(scope) {
    if (!st()) return { enabled: false, showFlags: SHOW_FLAGS };
    let k = scopeKey(scope);
    while (k) { const c = (st().config[k] || {}).directoryBrowse; if (c && c.enabled != null) return { enabled: c.enabled, showFlags: c.showFlags || SHOW_FLAGS }; k = parentKey(k); }
    return { ...st().server.directoryBrowse };
  }
  function setDirBrowse(scope, o) {
    if (!st()) return NOT_INSTALLED();
    const c = cfg(scope, 'directoryBrowse');
    if (!c) return notFoundSite(scope);
    const cur = dirBrowse(scope);
    c.enabled = o.enabled != null ? !!o.enabled : cur.enabled;
    c.showFlags = o.showFlags != null ? o.showFlags : cur.showFlags;
    commit(scope);
    return { ok: true };
  }

  /* ================================================================ files written from the model */
  const xa = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function appHostConfig() {
    const s = st();
    const L = ['<?xml version="1.0" encoding="UTF-8"?>', '<!--', '', '    IIS configuration sections.', '', '    For schema documentation, see', '    %windir%\\system32\\inetsrv\\config\\schema\\IIS_schema.xml.', '', '-->', '', '<configuration>', '', '    <system.applicationHost>', '', '        <applicationPools>'];
    for (const p of s.pools) L.push(`            <add name="${xa(p.name)}"${p.runtime !== 'v4.0' ? ` managedRuntimeVersion="${xa(p.runtime)}"` : ''}${p.pipeline === 'Classic' ? ' managedPipelineMode="Classic"' : ''}${p.autoStart ? '' : ' autoStart="false"'} />`);
    L.push('            <applicationPoolDefaults managedRuntimeVersion="v4.0">', '                <processModel identityType="ApplicationPoolIdentity" />', '            </applicationPoolDefaults>', '        </applicationPools>', '', '        <sites>');
    for (const x of sites()) {
      L.push(`            <site name="${xa(x.name)}" id="${x.id}"${x.autoStart ? '' : ' serverAutoStart="false"'}>`);
      for (const a of x.apps.slice().sort((p, q) => p.path.localeCompare(q.path))) {
        L.push(`                <application path="${xa(a.path)}"${same(a.pool, 'DefaultAppPool') ? '' : ` applicationPool="${xa(a.pool)}"`}>`);
        for (const v of x.vdirs.filter(v => longest(x.apps, v.path) === a)) L.push(`                    <virtualDirectory path="${xa(a.path === '/' ? v.path : v.path.slice(a.path.length) || '/')}" physicalPath="${xa(v.physicalPath)}" />`);
        L.push('                </application>');
      }
      L.push('                <bindings>');
      for (const b of x.bindings) L.push(`                    <binding protocol="${b.protocol}" bindingInformation="${xa(bindingInfo(b))}"${b.sni ? ' sslFlags="1"' : ''} />`);
      L.push('                </bindings>', '            </site>');
    }
    L.push('            <siteDefaults>', '                <logFile logFormat="W3C" directory="%SystemDrive%\\inetpub\\logs\\LogFiles" />', '                <traceFailedRequestsLogging directory="%SystemDrive%\\inetpub\\logs\\FailedReqLogFiles" />', '            </siteDefaults>',
      '            <applicationDefaults applicationPool="DefaultAppPool" />', '            <virtualDirectoryDefaults allowSubDirConfig="true" />', '        </sites>', '', '    </system.applicationHost>', '', '    <system.webServer>', '');
    const dd = s.server.defaultDocument, db = s.server.directoryBrowse;
    L.push(`        <defaultDocument enabled="${dd.enabled}">`, '            <files>', ...dd.files.map(f => `                <add value="${xa(f)}" />`), '            </files>', '        </defaultDocument>', '',
      `        <directoryBrowse enabled="${db.enabled}"${db.showFlags !== SHOW_FLAGS ? ` showFlags="${xa(db.showFlags)}"` : ''} />`, '', '    </system.webServer>', '', '</configuration>', '');
    return L.join('\r\n');
  }
  /** The web.config IIS Manager writes in the folder a site- or folder-level setting applies to. */
  function webConfig(key) {
    const c = st().config[key] || {};
    const inner = [];
    if (c.defaultDocument) {
      const d = c.defaultDocument, parentFiles = defaultDocs(parentScope(key)).files.map(f => f.value);
      const lines = [];
      if (d.files) {
        const reordered = d.files.filter(v => parentFiles.some(p => same(p, v))).map(lc).join('|') !== parentFiles.filter(p => d.files.some(v => same(v, p))).map(lc).join('|');
        if (reordered) { lines.push('                <clear />'); d.files.forEach(v => lines.push(`                <add value="${xa(v)}" />`)); }
        else {
          parentFiles.filter(p => !d.files.some(v => same(v, p))).forEach(v => lines.push(`                <remove value="${xa(v)}" />`));
          (d.local || []).forEach(v => lines.push(`                <add value="${xa(v)}" />`));
        }
      }
      inner.push(`        <defaultDocument${d.enabled != null ? ` enabled="${d.enabled}"` : ''}>`, ...(lines.length ? ['            <files>', ...lines, '            </files>'] : []), '        </defaultDocument>');
    }
    if (c.directoryBrowse) inner.push(`        <directoryBrowse enabled="${!!c.directoryBrowse.enabled}"${c.directoryBrowse.showFlags && c.directoryBrowse.showFlags !== SHOW_FLAGS ? ` showFlags="${xa(c.directoryBrowse.showFlags)}"` : ''} />`);
    return ['<?xml version="1.0" encoding="UTF-8"?>', '<configuration>', inner.length ? '    <system.webServer>' : '    <system.webServer />', ...inner, ...(inner.length ? ['    </system.webServer>'] : []), '</configuration>', ''].join('\r\n');
  }
  function parentScope(key) {
    const s = st().sites.find(x => lc(x.name) === key.split('/')[0]);
    const p = parentKey(key);
    if (!p) return null;
    return s.name + p.slice(lc(s.name).length);
  }
  function writeWebConfig(scope) {
    const key = scopeKey(scope);
    if (!key) return;
    const s = st().sites.find(x => lc(x.name) === key.split('/')[0]);
    const phys = mapPath(s, key.includes('/') ? key.slice(key.indexOf('/')) : '/');
    try { if (phys && WS.fs.isDir(phys)) WS.fs.writeFile(phys + '\\web.config', webConfig(key)); } catch (e) { /* read-only or missing: IIS Manager would show an error; the setting still applies */ }
  }
  /** Save: applicationHost.config, the scope's web.config, and the change event. */
  function commit(scope) {
    if (!st()) return;
    try { if (WS.fs.isDir(INETSRV + '\\config')) WS.fs.writeFile(INETSRV + '\\config\\applicationHost.config', appHostConfig()); } catch (e) { /* ignore */ }
    if (scope) writeWebConfig(scope);
    WS.store.changed('iis');
  }

  /* ================================================================ requests */
  const ownIp = ip => ip === '127.0.0.1' || ip === '::1' || WS.net.ownIps().includes(ip);
  /** Started sites with a binding HTTP.sys listens on for this protocol, address and port. */
  function listeners(protocol, ip, port) {
    if (!installed() || !w3svc()) return [];
    const out = [];
    for (const s of sites()) if (s.state === 'Started') for (const b of s.bindings) if (b.protocol === protocol && b.port === +port && (b.ip === '*' || b.ip === ip)) out.push({ site: s, binding: b });
    return out;
  }
  /** Is anything listening on this TCP port (Test-NetConnection, curl)? */
  const listening = (port, ip = '127.0.0.1') => listeners('http', ip, port).length > 0 || listeners('https', ip, port).length > 0;
  /** HTTP.sys's choice: host name + address, host name, specific address, then the wildcard. */
  function match(protocol, host, ip, port) {
    const ls = listeners(protocol, ip, port);
    if (!ls.length) return { none: true };
    const h = lc(host);
    return { hit: ls.find(x => x.binding.host && same(x.binding.host, h) && x.binding.ip === ip) || ls.find(x => x.binding.host && same(x.binding.host, h))
      || ls.find(x => !x.binding.host && x.binding.ip === ip) || ls.find(x => !x.binding.host && x.binding.ip === '*') || null };
  }
  const HTTPSYS = (title, h2, p) => `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN""http://www.w3.org/TR/html4/strict.dtd">\r\n<HTML><HEAD><TITLE>${title}</TITLE>\r\n<META HTTP-EQUIV="Content-Type" Content="text/html; charset=us-ascii"></HEAD>\r\n<BODY><h2>${h2}</h2>\r\n<hr><p>${p}</p>\r\n</BODY></HTML>\r\n`;
  const REASON = { 200: 'OK', 301: 'Moved Permanently', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' };

  /* IIS 10 detailed errors (sent to local requests) */
  const ERRORS = {
    '403.14': { reason: 'Forbidden', desc: 'The Web server is configured to not list the contents of this directory.', module: 'DirectoryListingModule', notification: 'ExecuteRequestHandler', code: '0x00000000',
      causes: ['A default document is not configured for the requested URL, and directory browsing is not enabled on the server.'],
      tries: ['If you do not want to enable directory browsing, ensure that a default document is configured and that the file exists.', 'Enable directory browsing using IIS Manager. Open IIS Manager. In the Features view, double-click Directory Browsing. On the Directory Browsing page, in the Actions pane, click Enable.', 'Verify that the configuration/system.webServer/directoryBrowse@enabled attribute is set to true in the site or application configuration file.'],
      more: 'This error occurs when a document is not specified in the URL, no default document is specified for the Web site or application, and directory listing is not enabled for the Web site or application. This setting may be disabled on purpose to secure the contents of the server.' },
    '404.0': { reason: 'Not Found', desc: 'The resource you are looking for has been removed, had its name changed, or is temporarily unavailable.', module: 'IIS Web Core', notification: 'MapRequestHandler', code: '0x80070002',
      causes: ['The directory or file specified does not exist on the Web server.', 'The URL contains a typographical error.', 'A custom filter or module, such as URLScan, restricts access to the file.'],
      tries: ['Create the content on the Web server.', 'Review the browser URL.', 'Check the failed request tracing log and see which module is calling SetStatus.'],
      more: 'This error means that the file or directory does not exist on the server. Create the file or directory and try the request again.' },
    '404.3': { reason: 'Not Found', desc: 'The page you are requesting cannot be served because of the extension configuration. If the page is a script, add a handler. If the file should be downloaded, add a MIME map.', module: 'StaticFileModule', notification: 'ExecuteRequestHandler', code: '0x80070032',
      causes: ['It is possible that a handler mapping is missing. By default, the static file handler processes all content.', 'The feature you are trying to use may not be installed.', 'The appropriate MIME map is not enabled for the Web site or application. (Warning: Do not create a MIME map for content that users should not download, such as .ASPX pages or .config files.)', 'If ASP.NET is not installed.'],
      tries: ['In system.webServer/handlers: Ensure that the expected handler for the current page is mapped.', 'Install the required feature, or add a MIME map for the file name extension in IIS Manager (MIME Types).'],
      more: 'This error occurs when the file extension of the requested URL is for a MIME type that is not configured on the server. You can add a MIME type for the file extension for files that are not dynamic scripting pages, database, or configuration files.' },
    '404.7': { reason: 'Not Found', desc: 'The request filtering module is configured to deny the file extension.', module: 'RequestFilteringModule', notification: 'BeginRequest', code: '0x00000000',
      causes: ['Request filtering is configured for the Web server and the file extension for this request is explicitly denied.'],
      tries: ['Verify the configuration/system.webServer/security/requestFiltering/fileExtensions settings in applicationhost.config and web.config.'],
      more: 'This is a security feature. Do not change this feature unless the scope of the change is fully understood.' },
    '404.8': { reason: 'Not Found', desc: 'The request filtering module is configured to deny a path in the URL that contains a hiddenSegment section.', module: 'RequestFilteringModule', notification: 'BeginRequest', code: '0x00000000',
      causes: ['Request filtering is configured for the Web server and the request contains a hiddenSegment section that is denied.'],
      tries: ['Verify the configuration/system.webServer/security/requestFiltering/hiddenSegments settings in applicationhost.config and web.config.'],
      more: 'This is a security feature. Do not change this feature unless the scope of the change is fully understood.' },
    '500.19': { reason: 'Internal Server Error', desc: 'The requested page cannot be accessed because the related configuration data for the page is invalid.', module: 'IIS Web Core', notification: 'BeginRequest', code: '0x80070003', handler: 'Not yet determined',
      causes: ['IIS was not able to access the web.config file for the Web site or application. This can occur if the NTFS permissions are set incorrectly.', 'IIS was not able to process configuration for the Web site or application.', 'The authenticated user does not have permission to use this DLL.', 'The request is mapped to a managed handler but the .NET Extensibility Feature is not installed.'],
      tries: ['Ensure that the NTFS permissions for the web.config file are correct and allow access to the Web server\u2019s machine account.', 'Check the event logs to see if any additional information was logged.', 'Verify the permissions for the DLL.', 'Install the .NET Extensibility feature if the request is mapped to a managed handler.', 'Create a tracing rule to track failed requests for this HTTP status code.'],
      more: 'This error occurs when there is a problem reading the configuration file for the Web server or Web application. In some cases, the event logs may contain more information about what caused this error.' }
  };
  function iisError(sub, ctx, extra = {}) {
    const e = ERRORS[sub];
    const status = +sub.split('.')[0];
    const li = a => a.map(x => `<li>${U.esc(x)}</li>`).join('');
    const cfgErr = extra.configFile ? `<tr><th>Config Error</th><td colspan="3">Cannot read configuration file</td></tr><tr><th>Config File</th><td colspan="3">\\\\?\\${U.esc(extra.configFile)}</td></tr>` : '';
    const body = `<!DOCTYPE html><html><head><title>IIS 10.0 Detailed Error - ${sub} - ${e.reason}</title></head><body class="iis-err">
<div class="iis-box"><h3>HTTP Error ${sub} - ${e.reason}</h3><h4>${U.esc(e.desc)}</h4></div>
<div class="iis-sec"><h4>Most likely causes:</h4><ul>${li(e.causes)}</ul></div>
<div class="iis-sec"><h4>Things you can try:</h4><ul>${li(e.tries)}</ul></div>
<div class="iis-sec"><h4>Detailed Error Information:</h4><table>
<tr><th>Module</th><td>${U.esc(e.module)}</td><th>Requested URL</th><td>${U.esc(ctx.url)}</td></tr>
<tr><th>Notification</th><td>${e.notification}</td><th>Physical Path</th><td>${U.esc(ctx.phys || '')}</td></tr>
<tr><th>Handler</th><td>${e.handler || ctx.handler || 'StaticFile'}</td><th>Logon Method</th><td>${sub === '500.19' ? 'Not yet determined' : 'Anonymous'}</td></tr>
<tr><th>Error Code</th><td>${e.code}</td><th>Logon User</th><td>${sub === '500.19' ? 'Not yet determined' : 'Anonymous'}</td></tr>${cfgErr}</table></div>
<div class="iis-sec"><h4>More Information:</h4><p>${U.esc(e.more)}</p></div></body></html>`;
    return { kind: 'response', status, sub, reason: e.reason, contentType: 'text/html', body, title: `IIS 10.0 Detailed Error - ${sub} - ${e.reason}`, detailed: true, phys: ctx.phys, site: ctx.site, binding: ctx.binding };
  }
  /** IIS's directory listing (DirectoryListingModule). */
  function listing(host, urlPath, phys, flags) {
    const f = lc(flags);
    const show = k => f.includes(k);
    const items = WS.fs.list(phys).filter(x => !same(x.name, 'web.config'));
    const up = urlPath === '/' ? null : urlPath.replace(/[^/]+\/$/, '');
    const when = iso => {
      const d = new Date(iso);
      const date = show('longdate') ? `${U.DAYS[d.getDay()]}, ${U.MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` : show('date') ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '';
      const hh = d.getHours() % 12 || 12, time = show('time') ? `${hh}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}` : '';
      return (date ? date.padStart(show('longdate') ? 0 : 10) : '') + (time ? ' ' + time.padStart(8) : '');
    };
    const rows = items.map(x => {
      const href = urlPath + encodeURIComponent(x.name).replace(/%20/g, '%20') + (x.type === 'dir' ? '/' : '');
      const name = x.type === 'file' && !show('extension') ? x.name.replace(/\.[^.]+$/, '') : x.name;
      const size = show('size') || x.type === 'dir' ? (x.type === 'dir' ? '&lt;dir&gt;' : String(x.size)).padStart(x.type === 'dir' ? 13 + 6 : 13) : '';
      return `${when(x.modified)}${size ? ' ' + size : ''} <A HREF="${href}">${U.esc(name)}</A><br>`;
    }).join('');
    return `<html><head><title>${U.esc(host)} - ${U.esc(urlPath)}</title></head><body><H1>${U.esc(host)} - ${U.esc(urlPath)}</H1><hr>\r\n\r\n<pre>${up ? `<A HREF="${up}">[To Parent Directory]</A><br><br>` : ''}${rows}</pre><hr></body></html>`;
  }
  const titleOf = html => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || ''); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };

  function request(req) {
    const protocol = lc(req.protocol || 'http').replace(/:$/, '');
    const port = +(req.port || (protocol === 'https' ? 443 : 80));
    const ip = req.ip || '127.0.0.1';
    const host = String(req.host || ip);
    if (!ownIp(ip)) return { kind: 'refused' };
    const m = match(protocol, host, ip, port);
    if (m.none) return { kind: 'refused' };
    if (!m.hit) return log(null, req, { kind: 'response', status: 400, reason: 'Bad Request', contentType: 'text/html', body: HTTPSYS('Bad Request', 'Bad Request - Invalid Hostname', 'HTTP Error 400. The request hostname is invalid.'), title: 'Bad Request', httpsys: true });
    const { site: s, binding } = m.hit;
    let cert = null;
    if (protocol === 'https') { cert = binding.cert ? certs.get(binding.cert) : null; if (!cert) return { kind: 'reset', site: s }; }
    let urlPath;
    try { urlPath = normUrl(decodeURIComponent(String(req.path || '/').split('?')[0])); } catch (e) { urlPath = '/'; }
    const app = longest(s.apps, urlPath.replace(/\/$/, '') || '/');
    const p = app && pool(app.pool);
    if (!p || p.state !== 'Started' || !was()) return log(s, req, { kind: 'response', status: 503, reason: 'Service Unavailable', contentType: 'text/html', body: HTTPSYS('Service Unavailable', 'Service Unavailable', 'HTTP Error 503. The service is unavailable.'), title: 'Service Unavailable', httpsys: true, site: s, binding, cert });
    ensureWorker(p);
    const ctx = { url: `${protocol}://${host}:${port}${urlPath}`, site: s, binding };
    const done = r => log(s, req, Object.assign(r, { site: s, binding, cert, pool: p.name }));
    // request filtering
    const segs = urlPath.split('/').filter(Boolean).map(lc);
    if (segs.some(x => HIDDEN.includes(x))) return done(iisError('404.8', { ...ctx, phys: mapPath(s, urlPath) }));
    const ext = (/\.([^./]+)$/.exec(urlPath) || [])[1];
    if (ext && DENIED_EXT.includes(lc(ext))) return done(iisError('404.7', { ...ctx, phys: mapPath(s, urlPath) }));
    const rootPhys = mapPath(s, '/');
    if (!rootPhys || !WS.fs.isDir(rootPhys)) return done(iisError('500.19', { ...ctx, phys: mapPath(s, urlPath) }, { configFile: (rootPhys || '') + '\\web.config' }));
    let phys = mapPath(s, urlPath.replace(/\/$/, '') || '/');
    let stt = phys && WS.fs.stat(phys);
    if (stt && stt.type === 'dir') {
      if (!urlPath.endsWith('/')) return done({ kind: 'response', status: 301, reason: 'Moved Permanently', location: `${protocol}://${host}${port === (protocol === 'https' ? 443 : 80) ? '' : ':' + port}${urlPath}/`, contentType: 'text/html', body: `<head><title>Document Moved</title></head>\n<body><h1>Object Moved</h1>This document may be found <a HREF="${U.esc(urlPath)}/">here</a></body>`, title: 'Document Moved', phys });
      const scope = s.name + (urlPath === '/' ? '' : urlPath.replace(/\/$/, ''));
      const dd = defaultDocs(scope);
      const doc = dd.enabled ? dd.files.find(f => { const x = WS.fs.stat(phys + '\\' + f.value); return x && x.type === 'file'; }) : null;
      if (!doc) {
        const db = dirBrowse(scope);
        if (db.enabled) return done({ kind: 'response', status: 200, reason: 'OK', contentType: 'text/html', body: listing(host, urlPath, phys, db.showFlags), title: `${host} - ${urlPath}`, phys, listing: true });
        return done(iisError('403.14', { ...ctx, phys }));
      }
      phys = phys + '\\' + WS.fs.stat(phys + '\\' + doc.value).name;
      stt = WS.fs.stat(phys);
    }
    if (!stt) return done(iisError('404.0', { ...ctx, phys }));
    const fext = lc((/\.([^.\\]+)$/.exec(phys) || [])[1] || '');
    const type = MIME[fext];
    if (!type) return done(iisError('404.3', { ...ctx, phys }));
    const text = /^(text\/|application\/(javascript|json))/.test(type) ? WS.fs.readFile(phys) : null;
    return done({ kind: 'response', status: 200, reason: 'OK', contentType: type, body: text, size: stt.size, title: type === 'text/html' ? titleOf(text) : stt.name, phys });
  }
  const normUrl = p => { const out = []; for (const seg of p.replace(/\\/g, '/').split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); } return '/' + out.join('/') + (/\/$/.test(p) && out.length ? '/' : ''); };

  /* ---------------- W3C logging (C:\inetpub\logs\LogFiles\W3SVC<id>\u_ex<yymmdd>.log) ---------------- */
  const FIELDS = '#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) cs(Referer) sc-status sc-substatus sc-win32-status time-taken';
  const logDir = s => `C:\\inetpub\\logs\\LogFiles\\W3SVC${s.id}`;
  function log(s, req, res) {
    if (!s || quiet || !WS.features.isInstalled('Web-Http-Logging')) return res;
    try {
      const now = new Date(), iso = now.toISOString(), d = iso.slice(0, 10), t = iso.slice(11, 19);
      const file = `${logDir(s)}\\u_ex${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}.log`;
      WS.fs.ensureDir(logDir(s));
      const head = WS.fs.exists(file) ? '' : `#Software: Microsoft Internet Information Services 10.0\r\n#Version: 1.0\r\n#Date: ${d} ${t}\r\n${FIELDS}\r\n`;
      const [stem, q] = String(req.path || '/').split('?');
      const sub = res.sub ? res.sub.split('.')[1] : '0';
      const win32 = res.sub === '404.0' ? 2 : res.sub === '404.3' ? 50 : res.sub === '500.19' ? 3 : 0;
      const ua = String(req.userAgent || 'Mozilla/5.0+(Windows+NT+10.0;+Win64;+x64)+AppleWebKit/537.36+(KHTML,+like+Gecko)+Chrome/130.0.0.0+Safari/537.36+Edg/130.0.2849.68').replace(/ /g, '+');
      WS.fs.writeFile(file, head + `${d} ${t} ${req.ip || '127.0.0.1'} ${req.method || 'GET'} ${stem || '/'} ${q || '-'} ${req.port || 80} - ${req.clientIp || req.ip || '127.0.0.1'} ${ua} - ${res.status} ${sub} ${win32} ${1 + U.randInt(0, 14)}\r\n`, null, { append: true });
    } catch (e) { /* logging never breaks a request */ }
    return res;
  }

  /* ================================================================ iisreset */
  async function reset(mode = 'restart') {
    if (!installed()) return NOT_INSTALLED();
    if (mode === 'stop' || mode === 'restart') { WS.svc.stop('W3SVC'); WS.svc.stop('WAS'); workers = {}; }
    if (mode === 'start' || mode === 'restart') { WS.svc.start('WAS'); WS.svc.start('W3SVC'); }
    WS.store.changed('iis');
    return { ok: true };
  }

  /* ================================================================ certificates (LocalMachine\My and \WebHosting) */
  const STORES = { my: 'Personal', webhosting: 'Web Hosting' };
  const certStore = name => { const k = lc(name || 'my').replace(/^.*\\/, '').replace(/\s+/g, ''); return k === 'personal' ? 'my' : k; };
  const certs = {
    STORES,
    list(store) { const c = WS.state.certs; return store ? (c[certStore(store)] || []).slice() : [...c.my, ...c.webhosting]; },
    get(thumb) { const t = String(thumb || '').replace(/\s/g, '').toUpperCase(); return certs.list().find(c => c.thumbprint === t) || null; },
    storeOf(thumb) { const c = certs.get(thumb); return c ? (WS.state.certs.webhosting.includes(c) ? 'webhosting' : 'my') : null; },
    /** IIS Manager's Create Self-Signed Certificate (subject = the computer's FQDN) or New-SelfSignedCertificate -DnsName. */
    createSelfSigned(o = {}) {
      const store = certStore(o.store);
      if (!WS.state.certs[store]) return fail('InvalidStore', `Cannot find path 'Cert:\\LocalMachine\\${o.store}' because it does not exist.`);
      const names = (o.dnsNames && o.dnsNames.length ? o.dnsNames : [WS.sys.fqdn().toLowerCase()]).map(String);
      const now = new Date(), until = new Date(now.getTime() + 365 * 864e5);
      const cert = { thumbprint: Array.from({ length: 40 }, () => '0123456789ABCDEF'[U.randInt(0, 15)]).join(''), subject: 'CN=' + names[0], issuer: 'CN=' + names[0], friendlyName: o.friendlyName || '',
        dnsNames: names, notBefore: now.toISOString(), notAfter: until.toISOString(), selfSigned: true, serial: Array.from({ length: 32 }, () => '0123456789abcdef'[U.randInt(0, 15)]).join('') };
      WS.state.certs[store].push(cert);
      WS.store.changed('certs');
      return { ok: true, cert };
    },
    setFriendlyName(thumb, name) { const c = certs.get(thumb); if (!c) return fail('NotFound', 'The certificate was not found.'); c.friendlyName = name || ''; WS.store.changed('certs'); return { ok: true }; },
    remove(thumb) {
      const c = certs.get(thumb);
      if (!c) return fail('NotFound', 'The certificate was not found.');
      for (const k of Object.keys(STORES)) WS.state.certs[k] = WS.state.certs[k].filter(x => x !== c);
      WS.store.changed('certs');
      return { ok: true };
    },
    /** Does a certificate cover a host name (CN or SAN, one-level wildcard)? */
    covers(c, host) { return c.dnsNames.some(n => same(n, host) || (/^\*\./.test(n) && lc(host).endsWith(lc(n.slice(1))) && !lc(host).slice(0, -n.length + 1).includes('.'))); }
  };

  WS.iis = {
    installed, sites, site, pools, pool, siteState, poolState, rootPath, rootPool, appsUsing,
    newSite, removeSite, startSite, stopSite, setSite,
    bindingInfo, bindingLabel, parseBinding, addBinding, removeBinding, setBinding, conflicts, checkBinding: b => checkBinding(normBinding(b)),
    apps, vdirs, addApp, removeApp, setApp, addVdir, removeVdir, setVdir, mapPath, normPath,
    newPool, removePool, setPool, startPool, stopPool, recyclePool, workers: workerList,
    defaultDocs, addDefaultDoc, removeDefaultDoc, moveDefaultDoc, setDefaultDocEnabled, revertDefaultDocs: scope => revert(scope, 'defaultDocument'),
    dirBrowse, setDirBrowse, revertDirBrowse: scope => revert(scope, 'directoryBrowse'), hasLocal,
    request, listening, logDir, reset, appHostConfig, silently,
    w3svc, was, INETSRV, WWWROOT, DEFAULT_DOCS, SHOW_FLAGS, MIME
  };
  WS.certs = certs;
})();
