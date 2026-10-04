/* IIS from the command line: the IISAdministration and WebAdministration modules (installed with IIS Management
 * Scripts and Tools, Web-Scripting-Tools), New-SelfSignedCertificate and the Cert: drive (PKI), Invoke-WebRequest,
 * and the native appcmd.exe (in %windir%\system32\inetsrv, which is not on PATH), iisreset.exe and curl.exe.
 * Everything goes through WS.iis / WS.certs, so IIS Manager shows the same sites, and through WS.edge.serve, so a
 * request takes the same path through the lab network as one from Edge. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util, PS = WS.ps;
  const { psobj, toStr, toBool, cmdlet, view } = PS;
  const { wild, hasWild } = PS.helpers;
  const I = () => WS.iis;
  const lc = s => String(s == null ? '' : s).toLowerCase();

  /* ================================================================ HTTP client (curl, Invoke-WebRequest) */
  /** One request through the lab network: { ok, status, reason, headers[], body, error: { kind, ... } } */
  function fetchUrl(url, o = {}) {
    let u = String(url || '').trim();
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'http://' + u;
    let parsed;
    try { parsed = new URL(u); } catch (e) { return { ok: false, error: { kind: 'badurl' }, url: u }; }
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: { kind: 'protocol', scheme: parsed.protocol.replace(':', '') }, url: u };
    const port = +(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    const host = parsed.hostname;
    for (let hops = 0; hops < 10; hops++) {
      const r = WS.edge.serve(u, { ignoreCert: true });
      const raw = r.raw;
      if (r.kind === 'error') {
        const kind = /NXDOMAIN|BAD_CONFIG/.test(r.code) ? 'resolve' : /REFUSED/.test(r.code) ? 'refused' : /RESET/.test(r.code) ? 'reset' : /DISCONNECTED/.test(r.code) ? 'resolve' : 'timeout';
        return { ok: false, error: { kind, host, port }, url: u };
      }
      if (raw && raw.cert && !o.insecure && raw.cert.selfSigned) return { ok: false, error: { kind: 'cert', host, port, cert: raw.cert }, url: u };
      if (raw && raw.status === 301 && raw.location && o.follow !== false) { u = raw.location; continue; }
      const status = raw ? raw.status : r.status || 200;
      const body = raw ? raw.body || '' : r.html || r.text || '';
      const type = raw ? raw.contentType || 'text/html' : 'text/html';
      const len = raw && raw.size != null && raw.body == null ? raw.size : new TextEncoder().encode(body).length;
      const now = new Date().toUTCString();
      const headers = raw
        ? [['Content-Type', type + (raw.httpsys ? '; charset=us-ascii' : '')], ['Content-Length', String(len)], ...(raw.status === 200 && raw.phys && !raw.listing ? [['Last-Modified', new Date((WS.fs.stat(raw.phys) || {}).modified || Date.now()).toUTCString()], ['Accept-Ranges', 'bytes'], ['ETag', `"${(U.hashStr(raw.phys) >>> 0).toString(16)}:0"`]] : []),
          ...(raw.location ? [['Location', raw.location]] : []), ['Server', raw.httpsys ? 'Microsoft-HTTPAPI/2.0' : 'Microsoft-IIS/10.0'], ['Date', now]]
        : [['Content-Type', 'text/html'], ['Content-Length', String(len)], ['Date', now]];
      return { ok: true, status, reason: (raw && raw.reason) || 'OK', headers, body, url: u, contentType: type, length: len };
    }
    return { ok: false, error: { kind: 'redirects' }, url: u };
  }

  /** WS.http.fetch(url, { insecure, follow }): what curl and Invoke-WebRequest see (lab checks use it inside WS.iis.silently). */
  WS.http = { fetch: fetchUrl };

  /* ---------------- curl.exe (Windows ships curl 8.x with Schannel) ---------------- */
  const CURL_VER = 'curl 8.9.1 (Windows) libcurl/8.9.1 Schannel zlib/1.3 WinIDN\nRelease-Date: 2024-07-31\nProtocols: dict file ftp ftps http https imap imaps ipfs ipns mqtt pop3 pop3s smb smbs smtp smtps telnet tftp\nFeatures: alt-svc AsynchDNS HSTS HTTPS-proxy IDN IPv6 Kerberos Largefile libz NTLM SPNEGO SSL SSPI threadsafe Unicode UnixSockets';
  WS.term.defineNative('curl', async (argv, io) => {
    const flags = new Set(); let out = null, url = null;
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '-o' || a === '--output') { out = argv[++i]; continue; }
      if (/^--(version|head|include|insecure|silent|location)$/.test(a)) { flags.add(a.slice(2)); continue; }
      if (/^-[a-zA-Z]+$/.test(a)) { for (const c of a.slice(1)) flags.add({ V: 'version', I: 'head', i: 'include', k: 'insecure', s: 'silent', L: 'location' }[c] || c); continue; }
      url = a;
    }
    if (flags.has('version')) { io.writeLine(CURL_VER); return 0; }
    if (!url) { io.writeLine('curl: try \'curl --help\' for more information'); return 2; }
    await io.wait(150);
    const r = fetchUrl(url, { insecure: flags.has('insecure'), follow: flags.has('location') });
    if (!r.ok) {
      const e = r.error;
      const msg = e.kind === 'resolve' ? `curl: (6) Could not resolve host: ${e.host}` : e.kind === 'refused' ? `curl: (7) Failed to connect to ${e.host} port ${e.port} after ${U.randInt(0, 3)} ms: Could not connect to server`
        : e.kind === 'timeout' ? `curl: (28) Failed to connect to ${e.host} port ${e.port} after 21045 ms: Timed out` : e.kind === 'reset' ? 'curl: (35) schannel: failed to receive handshake, SSL/TLS connection failed'
        : e.kind === 'cert' ? 'curl: (60) schannel: SEC_E_UNTRUSTED_ROOT (0x80090325) - The certificate chain was issued by an authority that is not trusted.\nMore details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it. To learn more about this situation and\nhow to fix it, please visit the webpage mentioned above.'
        : e.kind === 'protocol' ? `curl: (1) Protocol "${e.scheme}" not supported` : `curl: (3) URL rejected: Malformed input to a URL function`;
      io.writeLine(msg);
      return +(/\((\d+)\)/.exec(msg) || [0, 1])[1];
    }
    const head = [`HTTP/1.1 ${r.status} ${r.reason}`, ...r.headers.map(([k, v]) => `${k}: ${v}`), ''].join('\n');
    if (flags.has('head')) { io.writeLine(head); return 0; }
    const text = (flags.has('include') ? head + '\n' : '') + r.body;
    if (out) {
      try { WS.fs.writeFile(WS.fs.full(out, io.cwd), r.body, null); } catch (e) { io.writeLine(`curl: (23) Failure writing output to destination, passed ${r.length} returned 0`); return 23; }
      if (!flags.has('silent')) io.writeLine(`  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 ${String(r.length).padStart(5)}  100 ${String(r.length).padStart(5)}    0     0   ${String(r.length * 12).padStart(5)}      0 --:--:-- --:--:-- --:--:-- ${String(r.length * 12).padStart(5)}`);
      return 0;
    }
    io.write(text.replace(/\r\n/g, '\n') + (text.endsWith('\n') ? '' : '\n'));
    return 0;
  });

  /* ---------------- Invoke-WebRequest (PowerShell 5.1) ---------------- */
  const trunc = (s, n = 200) => (s.length > n ? s.slice(0, n) + '...' : s);
  view('Microsoft.PowerShell.Commands.BasicHtmlWebResponseObject', { custom: items => items.flatMap(o => {
    const rows = [['StatusCode', String(o.StatusCode)], ['StatusDescription', o.StatusDescription], ['Content', trunc(o.Content)], ['RawContent', trunc(o.RawContent)],
      ['Forms', ''], ['Headers', '{' + o.Headers.map(([k, v]) => `[${k}, ${v}]`).join(', ').slice(0, 60) + (o.Headers.length > 2 ? '...}' : '}')], ['Images', `{${o.Images.join(', ')}}`], ['InputFields', '{}'],
      ['Links', '{' + o.Links.map(l => `@{innerHTML=${l.innerHTML}; href=${l.href}}`).join(', ').slice(0, 80) + '}'], ['ParsedHtml', ''], ['RawContentLength', String(o.RawContentLength)]].filter(r => r[0] !== 'Forms' && r[0] !== 'ParsedHtml');
    const w = 17;
    return ['', ...rows.flatMap(([k, v]) => String(v).replace(/\r/g, '').split('\n').map((l, i) => (i ? ' '.repeat(w + 3) : k.padEnd(w) + ' : ') + l)), ''];
  }).concat(['']) });
  const webErr = (ctx, message) => ctx.throw({ message, category: 'InvalidOperation', target: 'System.Net.HttpWebRequest', targetType: 'HttpWebRequest', exception: 'WebException', id: 'WebCmdletWebResponseException,Microsoft.PowerShell.Commands.InvokeWebRequestCommand' });
  cmdlet({ name: 'Invoke-WebRequest', module: 'Microsoft.PowerShell.Utility', synopsis: 'Gets content from a web page on the internet.',
    params: { Uri: { pos: 0, mandatory: true }, UseBasicParsing: { type: 'switch' }, Method: {}, OutFile: {}, PassThru: { type: 'switch' }, TimeoutSec: { type: 'int' }, MaximumRedirection: { type: 'int' }, Headers: { type: 'object' }, UserAgent: {} },
    async process(ctx, p) {
      ctx.progress({ activity: 'Reading web response', status: 'Reading response stream... (Number of bytes read: 0)', percent: 30 });
      await ctx.sleep(200);
      const r = fetchUrl(toStr(p.Uri), { follow: p.MaximumRedirection !== 0 });
      if (!r.ok) {
        const e = r.error;
        return webErr(ctx, e.kind === 'resolve' ? `The remote name could not be resolved: '${e.host}'` : e.kind === 'refused' ? 'Unable to connect to the remote server' : e.kind === 'timeout' ? 'The operation has timed out.'
          : e.kind === 'reset' ? 'The underlying connection was closed: An unexpected error occurred on a send.' : e.kind === 'cert' ? 'The underlying connection was closed: Could not establish trust relationship for the SSL/TLS secure channel.'
          : e.kind === 'protocol' ? `The '${e.scheme}' scheme is not supported.` : 'Invalid URI: The hostname could not be parsed.');
      }
      if (r.status >= 400) return webErr(ctx, `The remote server returned an error: (${r.status}) ${r.reason}.`);
      if (p.OutFile) { try { WS.fs.writeFile(ctx.resolvePath(toStr(p.OutFile)), r.body); } catch (e) { ctx.throw({ message: e.message, category: 'WriteError', target: toStr(p.OutFile), exception: 'IOException', id: 'System.IO.IOException,Microsoft.PowerShell.Commands.InvokeWebRequestCommand' }); } if (!p.PassThru) return; }
      const links = [...r.body.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => psobj('System.Management.Automation.PSCustomObject', { innerHTML: m[2].replace(/<[^>]+>/g, ''), href: m[1] }));
      const images = [...r.body.matchAll(/<img\b[^>]*src="([^"]*)"/gi)].map(m => `@{src=${m[1]}}`);
      ctx.out(psobj('Microsoft.PowerShell.Commands.BasicHtmlWebResponseObject', {
        StatusCode: r.status, StatusDescription: r.reason, Content: r.body, RawContent: [`HTTP/1.1 ${r.status} ${r.reason}`, ...r.headers.map(([k, v]) => `${k}: ${v}`), '', r.body].join('\r\n'),
        Headers: r.headers, Images: images, InputFields: [], Links: links, RawContentLength: r.length
      }, { str: r.body }));
    } });

  /* ================================================================ appcmd.exe */
  const INETSRV = 'C:\\Windows\\System32\\inetsrv';
  const bindingsText = s => s.bindings.map(b => `${b.protocol}/${I().bindingInfo(b)}`).join(',');
  const siteLine = s => `SITE "${s.name}" (id:${s.id},bindings:${bindingsText(s)},state:${I().siteState(s)})`;
  const poolLine = p => `APPPOOL "${p.name}" (MgdVersion:${p.runtime},MgdMode:${p.pipeline},state:${I().poolState(p)})`;
  const appId = (s, a) => `${s.name}${a.path}`;
  function appcmdArgs(argv) {
    const pos = [], named = {}, ops = [];
    for (const a of argv) {
      const m = /^[/-]([+-])?([^:]+?)(?::(.*))?$/.exec(a);
      if (m && !/^[/-]\?$/.test(a) && (a.startsWith('/') || a.startsWith('-'))) {
        if (m[1]) ops.push({ op: m[1], path: m[2] + (m[3] != null ? ':' + m[3] : '') });
        else named[lc(m[2])] = m[3] == null ? 'true' : m[3].replace(/^"|"$/g, '');
      } else pos.push(a.replace(/^"|"$/g, ''));
    }
    return { pos, named, ops };
  }
  /** [protocol='http',bindingInformation='*:8080:'] -> { protocol, bindingInformation } */
  const bracket = t => { const o = {}; for (const m of String(t).matchAll(/(\w+)='([^']*)'/g)) o[lc(m[1])] = m[2]; return o; };
  WS.term.defineNative('appcmd', async (argv, io) => {
    const W = io.writeLine.bind(io);
    const err = (m, code = 1168) => { W(`ERROR ( message:${m} )`); return code; };
    if (!argv.length || /^[/-]\?$/.test(argv[0])) {
      W('General purpose IIS command line administration tool.\n\nAPPCMD (command) (object-type) <identifier> < /parameter1:value1 ... >\n\nSupported object types:\n\n  SITE      Administration of virtual sites\n  APP       Administration of applications\n  VDIR      Administration of virtual directories\n  APPPOOL   Administration of application pools\n  CONFIG    Administration of general configuration sections\n  WP        Administration of worker processes\n  REQUEST   Administration of HTTP requests\n  MODULE    Administration of server modules\n  BACKUP    Administration of server configuration backups\n  TRACE     Working with failed request trace logs\n  BINDING   Object for working with SSL bindings\n\n(To list commands supported by each object use /?, e.g. \'appcmd.exe site /?\')\n\nGeneral parameters:\n\n  /?        Display context-sensitive help message.\n\n  /text<:value>\n            Generate output in text format (default).\n            /text:* shows all object properties in detail view.\n            /text:<attribute> shows the value of the specified\n            attribute for each object.\n  /xml      Generate output in XML format.\n            Use this to produce output that can be sent to another\n            command running in /in mode.\n  /in or -  Read and operate on XML input from standard input.\n            Use this to operate on input produced by another\n            command running in /xml mode.\n  /config<:*>\n            Show configuration for displayed requests.\n            Use /config:* to also include inherited configuration.\n  /metadata Show configuration metadata when displaying configuration.\n  /commit   Set config path where configuration changes are saved.\n            Can specify either a specific configuration path, "site",\n            "app", "parent", or "url" to save to the appropriate portion\n            of the path being edited by the command, or "apphost",\n            "webroot", or "machine" for the corresponding configuration\n            level.\n  /debug    Show debugging information for command execution.\n\nUse "!" to escape parameters that have same names as the general parameters,\nlike "/!debug:value" to set a config property named "debug".');
      return 0;
    }
    const verb = lc(argv[0]), type = lc(argv[1] || '');
    const { pos, named, ops } = appcmdArgs(argv.slice(2));
    const id = pos[0] || named.name || named['site.name'] && type === 'site' && named['site.name'];
    const S = () => { const s = I().site(id); if (!s) throw err(`Cannot find SITE object with identifier "${id}".`); return s; };
    const P = () => { const p = I().pool(id); if (!p) throw err(`Cannot find APPPOOL object with identifier "${id}".`); return p; };
    const show = r => { if (!r.ok) throw err(r.code === 'Exists' && !/duplicate/.test(r.error) ? `Failed to add duplicate collection element "${id}".` : r.error, r.code === 'Exists' ? 183 : 1168); };
    try {
      if (!['list', 'add', 'delete', 'set', 'start', 'stop', 'recycle'].includes(verb)) return err(`The command "${argv[0]}" is not supported on object "${argv[1] || ''}".`, 87);
      if (type === 'site' || type === 'sites') {
        if (verb === 'list') {
          let list = I().sites();
          if (id) list = list.filter(s => lc(s.name) === lc(id) || String(s.id) === id);
          if (named.state) list = list.filter(s => lc(I().siteState(s)) === lc(named.state));
          if (id && !list.length) return err(`Cannot find SITE object with identifier "${id}".`);
          if (named.text === '*') list.forEach(s => W(`SITE\n  SITE.NAME:"${s.name}"\n  SITE.ID:"${s.id}"\n  bindings:"${bindingsText(s)}"\n  state:"${I().siteState(s)}"\n  [site]\n    name:"${s.name}"\n    id:"${s.id}"\n    serverAutoStart:"${s.autoStart}"`));
          else if (named.text) list.forEach(s => W(String({ name: s.name, id: s.id, state: I().siteState(s), bindings: bindingsText(s) }[lc(named.text)] ?? '')));
          else list.forEach(s => W(siteLine(s)));
          return 0;
        }
        if (verb === 'add') {
          const bindings = (named.bindings || 'http/*:80:').split(',').map(x => { const m = /^(\w+)\/(.*)$/.exec(x); return m ? I().parseBinding(m[2], m[1]) : null; });
          if (bindings.some(b => !b)) return err('Invalid binding information.', 87);
          if (!named.physicalpath) {
            if (!named.name) return err('Missing required attribute "name".', 87);
          }
          const r = I().newSite({ name: named.name, id: named.id, bindings, physicalPath: named.physicalpath || ' ', pool: 'DefaultAppPool' });
          if (!r.ok) { if (r.code === 'InvalidPath') return err('Missing required attribute "physicalPath".', 87); return show(r); }
          W(`SITE object "${r.site.name}" added`);
          W(`APP object "${r.site.name}/" added`);
          W(`VDIR object "${r.site.name}/" added`);
          return 0;
        }
        if (verb === 'delete') { const s = S(); show(I().removeSite(s.name)); W(`SITE object "${s.name}" deleted`); return 0; }
        if (verb === 'start' || verb === 'stop') {
          const s = S();
          const r = verb === 'start' ? I().startSite(s.name) : I().stopSite(s.name);
          if (!r.ok) return err(`The object identifier does not represent a valid object. (Exception from HRESULT: ${r.code === 'InUse' ? '0x80070020' : '0x800710D8'})`, 1168);
          W(`"${s.name}" successfully ${verb === 'start' ? 'started' : 'stopped'}.`);
          return 0;
        }
        if (verb === 'set') {
          const s = S();
          for (const o of ops) {
            const m = /^bindings\.(\[.*\])$/i.exec(o.path);
            if (!m) return err(`Unknown attribute "${o.path}".  Replace with -? for help.`, 87);
            const b = bracket(m[1]);
            const r = o.op === '+' ? I().addBinding(s.name, { ...I().parseBinding(b.bindinginformation, b.protocol) }) : I().removeBinding(s.name, { protocol: b.protocol, info: b.bindinginformation });
            if (!r.ok) return err(r.code === 'NotFound' ? `Cannot find requested collection element.` : r.error, r.code === 'Exists' ? 183 : 1168);
          }
          if (named.name && lc(named.name) !== lc(s.name)) show(I().setSite(s.name, { name: named.name }));
          if (named['[path=\'/\'].[path=\'/\'].physicalpath']) show(I().setSite(s.name, { physicalPath: named['[path=\'/\'].[path=\'/\'].physicalpath'] }));
          W(`SITE object "${s.name}" changed`);
          return 0;
        }
      }
      if (type === 'apppool' || type === 'apppools') {
        if (verb === 'list') {
          let list = I().pools();
          if (id) list = list.filter(p => lc(p.name) === lc(id));
          if (id && !list.length) return err(`Cannot find APPPOOL object with identifier "${id}".`);
          list.forEach(p => W(poolLine(p)));
          return 0;
        }
        if (verb === 'add') {
          if (!named.name) return err('Missing required attribute "name".', 87);
          const r = I().newPool({ name: named.name, runtime: named.managedruntimeversion != null ? named.managedruntimeversion : 'v4.0', pipeline: named.managedpipelinemode });
          if (!r.ok) return err(r.code === 'Exists' ? `Failed to add duplicate collection element "${named.name}".` : r.error, r.code === 'Exists' ? 183 : 87);
          W(`APPPOOL object "${r.pool.name}" added`);
          return 0;
        }
        const p = P();
        if (verb === 'delete') { show(I().removePool(p.name)); W(`APPPOOL object "${p.name}" deleted`); return 0; }
        if (verb === 'start' || verb === 'stop' || verb === 'recycle') {
          const r = verb === 'start' ? I().startPool(p.name) : verb === 'stop' ? I().stopPool(p.name) : I().recyclePool(p.name);
          if (!r.ok) return err(r.error, 1168);
          W(`"${p.name}" successfully ${verb === 'start' ? 'started' : verb === 'stop' ? 'stopped' : 'recycled'}.`);
          return 0;
        }
        if (verb === 'set') {
          const r = I().setPool(p.name, { ...(named.managedruntimeversion != null ? { runtime: named.managedruntimeversion } : {}), ...(named.managedpipelinemode ? { pipeline: named.managedpipelinemode } : {}) });
          show(r); W(`APPPOOL object "${p.name}" changed`); return 0;
        }
      }
      if (type === 'app' || type === 'apps') {
        if (verb === 'list') {
          const filterSite = named['site.name'];
          for (const s of I().sites()) for (const a of I().apps(s.name)) if ((!id || lc(id) === lc(appId(s, a))) && (!filterSite || lc(filterSite) === lc(s.name)) && (!named.apppool || lc(named.apppool) === lc(a.pool))) W(`APP "${appId(s, a)}" (applicationPool:${a.pool})`);
          return 0;
        }
        if (verb === 'add') {
          const r = I().addApp(named['site.name'], { path: named.path, physicalPath: named.physicalpath, pool: named.applicationpool });
          if (!r.ok) return err(r.code === 'NotFound' ? `Cannot find SITE object with identifier "${named['site.name']}".` : r.error, 1168);
          W(`APP object "${named['site.name']}${I().normPath(named.path)}" added`);
          W(`VDIR object "${named['site.name']}${I().normPath(named.path)}" added`);
          return 0;
        }
        const [sn, ...rest] = String(id || '').split('/');
        if (verb === 'delete') { const r = I().removeApp(sn, '/' + rest.join('/')); if (!r.ok) return err(`Cannot find APP object with identifier "${id}".`); W(`APP object "${id}" deleted`); return 0; }
        if (verb === 'set') { const r = I().setApp(sn, '/' + rest.join('/'), { pool: named.applicationpool }); if (!r.ok) return err(`Cannot find APP object with identifier "${id}".`); W(`APP object "${id}" changed`); return 0; }
      }
      if (type === 'vdir' || type === 'vdirs') {
        if (verb === 'list') {
          for (const s of I().sites()) for (const v of I().vdirs(s.name)) if (!id || lc(id) === lc(s.name + v.path)) W(`VDIR "${s.name}${v.path}" (physicalPath:${v.physicalPath})`);
          return 0;
        }
        if (verb === 'add') {
          const app = String(named['app.name'] || '').replace(/\/$/, '');
          const [sn, ...rest] = app.split('/');
          const path = (rest.length ? '/' + rest.join('/') : '') + I().normPath(named.path);
          const r = I().addVdir(sn, { path, physicalPath: named.physicalpath });
          if (!r.ok) return err(r.code === 'NotFound' ? `Cannot find APP object with identifier "${named['app.name']}".` : r.error, 1168);
          W(`VDIR object "${sn}${I().normPath(path)}" added`);
          return 0;
        }
        if (verb === 'delete') { const [sn, ...rest] = String(id || '').split('/'); const r = I().removeVdir(sn, '/' + rest.join('/')); if (!r.ok) return err(`Cannot find VDIR object with identifier "${id}".`); W(`VDIR object "${id}" deleted`); return 0; }
      }
      if (type === 'wp' || type === 'wps') {
        if (verb === 'list') { I().workers().forEach(w => W(`WP "${w.proc.pid}" (applicationPool:${w.pool.name})`)); return 0; }
      }
      if (type === 'config') {
        const section = lc(named.section || '').replace(/^system\.webserver\//, '');
        const scope = pos[0] ? pos[0].replace(/\/$/, '') : null;
        if (scope && !I().site(scope.split('/')[0])) return err(`Cannot find SITE object with identifier "${scope}".`);
        const where = `MACHINE/WEBROOT/APPHOST${scope ? '/' + scope : ''}`;
        if (verb === 'list') {
          if (section === 'directorybrowse') { const d = I().dirBrowse(scope); W(`<system.webServer>\n  <directoryBrowse enabled="${d.enabled}" showFlags="${d.showFlags}" />\n</system.webServer>`); return 0; }
          if (section === 'defaultdocument') { const d = I().defaultDocs(scope); W(`<system.webServer>\n  <defaultDocument enabled="${d.enabled}">\n    <files>\n${d.files.map(f => `      <add value="${f.value}" />`).join('\n')}\n    </files>\n  </defaultDocument>\n</system.webServer>`); return 0; }
          return err(`Unknown config section "${named.section || ''}".`, 87);
        }
        if (verb === 'set') {
          if (section === 'directorybrowse') {
            const o = {};
            if (named.enabled != null) o.enabled = /^true$/i.test(named.enabled);
            if (named.showflags != null) o.showFlags = named.showflags;
            show(I().setDirBrowse(scope, o));
          } else if (section === 'defaultdocument') {
            if (named.enabled != null) show(I().setDefaultDocEnabled(scope, /^true$/i.test(named.enabled)));
            for (const o of ops) {
              const m = /^files\.(\[.*\])$/i.exec(o.path);
              if (!m) return err(`Unknown attribute "${o.path}".  Replace with -? for help.`, 87);
              const v = bracket(m[1]).value;
              const r = o.op === '+' ? I().addDefaultDoc(scope, v, 0) : I().removeDefaultDoc(scope, v);
              if (!r.ok) return err(r.code === 'Exists' ? `Cannot add duplicate collection entry of type 'add' with unique key attribute 'value' set to '${v}'` : 'Cannot find requested collection element.', r.code === 'Exists' ? 183 : 1168);
            }
          } else return err(`Unknown config section "${named.section || ''}".`, 87);
          W(`Applied configuration changes to section "system.webServer/${section === 'directorybrowse' ? 'directoryBrowse' : 'defaultDocument'}" for "${where}" at configuration commit path "${where}"`);
          return 0;
        }
      }
      return err(`The command "${argv[0]}" is not supported on object "${argv[1] || ''}".`, 87);
    } catch (code) { if (typeof code === 'number') return code; throw code; }
  }, { feature: 'Web-Server', dir: INETSRV });

  /* ================================================================ iisreset.exe */
  WS.term.defineNative('iisreset', async (argv, io) => {
    const a = lc(argv[0] || '/restart').replace(/^-/, '/');
    if (a === '/?' ) { io.writeLine('IISRESET.EXE (c) Microsoft Corp. 1998-2005\n\nUsage:\niisreset [computername]\n\n    /RESTART            Stop and then restart all Internet services.\n    /START              Start all Internet services.\n    /STOP               Stop all Internet services.\n    /REBOOT             Reboot the computer.\n    /REBOOTONERROR      Reboot the computer if an error occurs when starting,\n                        stopping, or restarting Internet services.\n    /NOFORCE            Do not forcefully terminate Internet services if\n                        attempting to stop them gracefully fails.\n    /TIMEOUT:val        Specify the timeout value ( in seconds ) to wait for\n                        a successful stop of Internet services. On expiration\n                        of this timeout the computer can be rebooted if\n                        the /REBOOTONERROR parameter is specified.\n                        The default value is 20s for restart, 60s for stop,\n                        and 0s for reboot.\n    /STATUS             Display the status of all Internet services.\n    /ENABLE             Enable restarting of Internet Services\n                        on the local system.\n    /DISABLE            Disable restarting of Internet Services\n                        on the local system.'); return 0; }
    if (a === '/status') { for (const [n, d] of [['WAS', 'Windows Process Activation Service'], ['W3SVC', 'World Wide Web Publishing Service']]) io.writeLine(`Status for ${d} ( ${n} ) : ${WS.svc.isRunning(n) ? 'Running' : 'Stopped'}`); return 0; }
    const mode = a === '/stop' ? 'stop' : a === '/start' ? 'start' : 'restart';
    io.writeLine('');
    if (mode !== 'start') { io.writeLine('Attempting stop...'); if (!(await io.wait(500))) return 1; await I().reset('stop'); io.writeLine('Internet services successfully stopped'); }
    if (mode !== 'stop') { io.writeLine('Attempting start...'); if (!(await io.wait(400))) return 1; await I().reset('start'); io.writeLine(`Internet services successfully ${mode === 'restart' ? 'restarted' : 'started'}`); }
    io.writeLine('');
    return 0;
  }, { feature: 'Web-Server' });

  /* ================================================================ certificates: PKI module and the Cert: drive */
  const certObj = (c, store = 'My') => psobj('System.Security.Cryptography.X509Certificates.X509Certificate2', {
    PSParentPath: `Microsoft.PowerShell.Security\\Certificate::LocalMachine\\${store}`, Thumbprint: c.thumbprint, Subject: c.subject, Issuer: c.issuer, FriendlyName: c.friendlyName,
    NotBefore: new Date(c.notBefore), NotAfter: new Date(c.notAfter), DnsNameList: c.dnsNames, HasPrivateKey: true, SerialNumber: c.serial.toUpperCase(), PSPath: `Microsoft.PowerShell.Security\\Certificate::LocalMachine\\${store}\\${c.thumbprint}`
  }, { str: `[Subject]\n  ${c.subject}\n\n[Issuer]\n  ${c.issuer}\n\n[Thumbprint]\n  ${c.thumbprint}` });
  view('System.Security.Cryptography.X509Certificates.X509Certificate2', { custom: items => {
    const out = []; let parent = null;
    for (const o of items) {
      if (o.PSParentPath !== parent) { parent = o.PSParentPath; out.push('', `   PSParentPath: ${parent}`, '', 'Thumbprint                                Subject', '----------                                -------'); }
      out.push(`${o.Thumbprint.padEnd(42)}${o.Subject}`);
    }
    return out.concat(['']);
  }, listProps: ['Subject', 'Issuer', 'Thumbprint', 'FriendlyName', 'NotBefore', 'NotAfter', 'DnsNameList'] });
  PS.providers = PS.providers || {};
  PS.providers.cert = {
    childItems(ctx, raw) {
      const m = /^cert:\\?(?:(localmachine|currentuser)(?:\\([^\\]+))?)?\\?$/i.exec(raw.replace(/\//g, '\\'));
      if (!m) return ctx.error({ message: `Cannot find path '${raw}' because it does not exist.`, category: 'ObjectNotFound', target: raw, exception: 'ItemNotFoundException', id: 'PathNotFound,Microsoft.PowerShell.Commands.GetChildItemCommand' });
      if (!m[1]) { for (const n of ['CurrentUser', 'LocalMachine']) ctx.out(psobj('System.Management.Automation.PSCustomObject', { Location: n, StoreNames: '{TrustedPublisher, ClientAuthIssuer, Root, ...}' })); return; }
      if (!m[2]) { for (const n of ['TrustedPublisher', 'ClientAuthIssuer', 'Remote Desktop', 'Root', 'TrustedDevices', 'WebHosting', 'CA', 'AuthRoot', 'TrustedPeople', 'My', 'SmartCardRoot', 'Trust', 'Disallowed']) ctx.out(psobj('System.Management.Automation.PSCustomObject', { Name: n })); return; }
      if (/^currentuser$/i.test(m[1])) return;
      const store = m[2].toLowerCase();
      const name = store === 'my' ? 'My' : store === 'webhosting' ? 'WebHosting' : m[2];
      if (store === 'my' || store === 'webhosting') WS.certs.list(store).forEach(c => ctx.out(certObj(c, name)));
    }
  };
  cmdlet({ name: 'New-SelfSignedCertificate', module: 'PKI', synopsis: 'Creates a new self-signed certificate for testing purposes.',
    params: { DnsName: { type: 'string[]', pos: 0 }, CertStoreLocation: {}, FriendlyName: {}, Subject: {}, NotAfter: { type: 'datetime' }, KeyUsage: {}, Type: {} },
    process(ctx, p) {
      const loc = toStr(p.CertStoreLocation || 'Cert:\\LocalMachine\\My');
      const m = /^cert:\\(localmachine)\\(my|webhosting)\\?$/i.exec(loc.replace(/\//g, '\\'));
      if (!m) ctx.throw({ message: /currentuser/i.test(loc) ? 'Only the LocalMachine\\My and LocalMachine\\WebHosting stores are modelled in the lab simulator.' : `Cannot find path '${loc}' because it does not exist.`, category: 'ObjectNotFound', target: loc, exception: 'ItemNotFoundException', id: 'PathNotFound,Microsoft.CertificateServices.Commands.NewSelfSignedCertificateCommand' });
      const names = (p.DnsName || []).map(toStr);
      if (!names.length && !p.Subject) ctx.throw({ message: 'CertEnroll::CX509Enrollment::_CreateRequest: The subject name is missing. 0x80094001 (-2146877439 CERTSRV_E_BAD_REQUESTSUBJECT)', category: 'NotSpecified', target: '', exception: 'Exception', id: 'System.Exception,Microsoft.CertificateServices.Commands.NewSelfSignedCertificateCommand' });
      const r = WS.certs.createSelfSigned({ dnsNames: names.length ? names : [toStr(p.Subject).replace(/^CN=/i, '')], store: m[2], friendlyName: p.FriendlyName ? toStr(p.FriendlyName) : '' });
      ctx.out(certObj(r.cert, m[2].toLowerCase() === 'my' ? 'My' : 'WebHosting'));
    } });

  /* ================================================================ shared: site and pool objects, scopes */
  const fmtBindings = (s, sslFlags) => s.bindings.map(b => `${b.protocol} ${I().bindingInfo(b)}${b.protocol === 'https' && sslFlags ? ` sslFlags=${b.sni ? 1 : 0}` : ''}`);
  const siteView = { custom: items => {
    const w = Math.max(16, ...items.map(o => o.Name.length)) + 1;
    const out = ['', `${'Name'.padEnd(w)}${'ID'.padEnd(5)}${'State'.padEnd(11)}${'Physical Path'.padEnd(31)}Bindings`, `${'----'.padEnd(w)}${'--'.padEnd(5)}${'-----'.padEnd(11)}${'-------------'.padEnd(31)}--------`];
    for (const o of items) {
      const b = o.__bindings.length ? o.__bindings : [''];
      out.push(`${o.Name.padEnd(w)}${String(o.ID).padEnd(5)}${o.State.padEnd(11)}${o.__path.padEnd(31)}${b[0]}`.replace(/\s+$/, ''));
      for (const x of b.slice(1)) out.push(' '.repeat(w + 5 + 11 + 31) + x);
    }
    return out.concat(['']);
  } };
  view('Microsoft.Web.Administration.Site', siteView);
  view('Microsoft.IIs.PowerShell.Framework.ConfigurationElement#site', siteView);
  function siteObj(s, kind) {
    const iisAdmin = kind === 'iis';
    const o = psobj(iisAdmin ? 'Microsoft.Web.Administration.Site' : 'Microsoft.IIs.PowerShell.Framework.ConfigurationElement#site', {
      Name: s.name, ID: s.id, State: I().siteState(s), PhysicalPath: I().rootPath(s), ApplicationPool: I().rootPool(s), ServerAutoStart: s.autoStart,
      Bindings: s.bindings.map(b => bindingObj(s, b, iisAdmin))
    }, { str: iisAdmin ? s.name : 'Microsoft.IIs.PowerShell.Framework.ConfigurationElement', methods: { Start: () => { const r = I().startSite(s.name); if (!r.ok) throw new Error(r.error); return 'Started'; }, Stop: () => { const r = I().stopSite(s.name); if (!r.ok) throw new Error(r.error); return 'Stopped'; } } });
    Object.defineProperty(o, '__bindings', { value: fmtBindings(s, !iisAdmin) });
    Object.defineProperty(o, '__path', { value: I().rootPath(s) });
    return o;
  }
  function bindingObj(s, b, iisAdmin) {
    const info = I().bindingInfo(b);
    const props = iisAdmin ? { protocol: b.protocol, bindingInformation: info, sslFlags: b.sni ? 'Sni' : 'None' } : { protocol: b.protocol, bindingInformation: info, sslFlags: b.sni ? 1 : 0 };
    return psobj(iisAdmin ? 'Microsoft.Web.Administration.Binding' : 'Microsoft.IIs.PowerShell.Framework.ConfigurationElement#site#bindings#binding', props, { str: `${b.protocol} ${info}`, methods: {
      AddSslCertificate(thumb, store) {
        const t = toStr(thumb);
        if (!WS.certs.get(t)) throw new Error('A specified logon session does not exist. It may already have been terminated. (Exception from HRESULT: 0x80070520)');
        const i = s.bindings.indexOf(b); const r = I().setBinding(s.name, i, { cert: t }); if (!r.ok) throw new Error(r.error); return null;
      },
      RemoveSslCertificate() { const i = s.bindings.indexOf(b); I().setBinding(s.name, i, { cert: null }); return null; }
    } });
  }
  view('Microsoft.Web.Administration.Binding', { table: { columns: [{ label: 'protocol', width: 8, value: 'protocol' }, { label: 'bindingInformation', width: 34, value: 'bindingInformation' }, { label: 'sslFlags', width: 8, value: 'sslFlags', align: 'right' }] } });
  view('Microsoft.IIs.PowerShell.Framework.ConfigurationElement#site#bindings#binding', { table: { columns: [{ label: 'protocol', width: 8, value: 'protocol' }, { label: 'bindingInformation', width: 34, value: 'bindingInformation' }, { label: 'sslFlags', width: 8, value: 'sslFlags', align: 'right' }] } });
  const poolObj = (p, kind) => psobj(kind === 'iis' ? 'Microsoft.Web.Administration.ApplicationPool' : 'IIS.WebAppPool', {
    Name: p.name, State: I().poolState(p), ManagedRuntimeVersion: p.runtime, ManagedPipelineMode: p.pipeline, StartMode: 'OnDemand', AutoStart: p.autoStart, ProcessModel: { identityType: p.identity }
  }, { str: kind === 'iis' ? p.name : 'Microsoft.IIs.PowerShell.Framework.ConfigurationElement', methods: {
    Start: () => { const r = I().startPool(p.name); if (!r.ok) throw new Error(r.error); return 'Started'; }, Stop: () => { const r = I().stopPool(p.name); if (!r.ok) throw new Error(r.error); return 'Stopped'; },
    Recycle: () => { const r = I().recyclePool(p.name); if (!r.ok) throw new Error(r.error); return 'Started'; } } });
  view('Microsoft.Web.Administration.ApplicationPool', { table: { columns: [{ label: 'Name', width: 20, value: 'Name' }, { label: 'Status', width: 12, value: 'State' }, { label: 'CLR Ver', width: 8, value: 'ManagedRuntimeVersion' }, { label: 'Pipeline Mode', width: 14, value: 'ManagedPipelineMode' }, { label: 'Start Mode', value: 'StartMode' }] } });
  view('IIS.WebAppPool', { table: { columns: [{ label: 'Name', width: 24, value: 'Name' }, { label: 'State', width: 12, value: 'State' }, { label: 'Applications', value: o => I().appsUsing(o.Name).map(x => x.site.name + x.app.path).join('\n') }] } });

  /** -PSPath 'IIS:\Sites\X\sub' / 'MACHINE/WEBROOT/APPHOST' -Location 'X' -> null (server) or 'X/sub' */
  function scopeOf(ctx, pspath, location) {
    const pp = toStr(pspath || 'MACHINE/WEBROOT/APPHOST').replace(/\//g, '\\');
    let scope = null;
    const m = /^iis:\\sites\\(.+)$/i.exec(pp);
    if (m) scope = m[1].replace(/\\+$/, '').replace(/\\/g, '/');
    else if (!/^(iis:\\?|machine\\webroot\\apphost\\?)$/i.test(pp)) ctx.throw({ message: `Cannot find path '${toStr(pspath)}' because it does not exist.`, category: 'ObjectNotFound', target: toStr(pspath), exception: 'ItemNotFoundException', id: 'PathNotFound,' + ctx.name });
    if (location) scope = (scope ? scope + '/' : '') + toStr(location).replace(/^\/|\/$/g, '');
    if (scope && !I().site(scope.split('/')[0])) ctx.throw({ message: `Cannot find path 'IIS:\\Sites\\${scope.split('/')[0]}' because it does not exist.`, category: 'ObjectNotFound', target: scope, exception: 'ItemNotFoundException', id: 'PathNotFound,' + ctx.name });
    return scope;
  }
  const sectionOf = f => lc(toStr(f)).replace(/^\/*(system\.webserver\/)?/, '').replace(/^\/+/, '');
  const failRec = (ctx, r, target, terminating = true) => {
    const rec = { message: r.error, category: r.code === 'NotFound' ? 'ObjectNotFound' : r.code === 'Exists' ? 'ResourceExists' : 'InvalidOperation', target: target || '', exception: r.code === 'NotFound' ? 'ArgumentException' : 'InvalidOperationException', id: `${r.code || 'InvalidOperation'},${ctx.name}` };
    if (terminating) ctx.throw(rec); else ctx.error(rec);
  };

  /* ================================================================ IISAdministration */
  const iisCmd = def => cmdlet({ module: 'IISAdministration', version: '1.1.0.0', feature: 'Web-Scripting-Tools', ...def });
  const needIIS = ctx => { if (!I().installed()) ctx.throw({ message: 'Web Server (IIS) is not installed.', category: 'NotInstalled', target: '', exception: 'InvalidOperationException', id: 'NotInstalled,' + ctx.name }); };
  iisCmd({ name: 'Get-IISSite', synopsis: 'Gets configuration information for an IIS Web site.', params: { Name: { type: 'string[]', pos: 0, pipe: 'name' } },
    process(ctx, p) {
      needIIS(ctx);
      if (!p.Name) { I().sites().forEach(s => ctx.out(siteObj(s, 'iis'))); return; }
      for (const n of p.Name) { const s = I().site(n); if (s) ctx.out(siteObj(s, 'iis')); else ctx.warn(`Web site '${n}' does not exist.`); }
    } });
  iisCmd({ name: 'New-IISSite', shouldProcess: true, synopsis: 'Creates a new IIS Web site.',
    params: { Name: { pos: 0, mandatory: true }, PhysicalPath: { pos: 1, mandatory: true }, BindingInformation: { pos: 2, mandatory: true }, Protocol: { dflt: 'http' }, CertificateThumbPrint: {}, CertStoreLocation: {}, SslFlag: {}, Force: { type: 'switch' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      needIIS(ctx);
      const b = I().parseBinding(toStr(p.BindingInformation), toStr(p.Protocol || 'http'));
      if (!b) ctx.throw({ message: `The binding information '${toStr(p.BindingInformation)}' is not valid. Use the format "IPAddress:Port:HostName", for example "*:80:".`, category: 'InvalidArgument', target: toStr(p.BindingInformation), exception: 'ArgumentException', id: 'InvalidBindingInformation,Microsoft.IIS.Powershell.Commands.NewIISSiteCommand' });
      if (p.CertificateThumbPrint) b.cert = toStr(p.CertificateThumbPrint);
      if (p.SslFlag && /sni/i.test(toStr(p.SslFlag))) b.sni = true;
      const existing = I().site(p.Name);
      if (existing && !p.Force) ctx.throw({ message: `Web site '${p.Name}' already exists.`, category: 'ResourceExists', target: p.Name, exception: 'ArgumentException', id: 'SiteAlreadyExists,Microsoft.IIS.Powershell.Commands.NewIISSiteCommand' });
      if (!(await ctx.confirm('New-IISSite', p.Name))) return;
      if (existing) I().removeSite(existing.name);
      const r = I().newSite({ name: toStr(p.Name), physicalPath: ctx.resolvePath(toStr(p.PhysicalPath)), bindings: [b] });
      if (!r.ok) failRec(ctx, r, p.Name);
      if (r.conflict) ctx.warn(`The binding '${I().bindingInfo(b)}' is assigned to another site. The site '${r.site.name}' was not started.`);
      if (p.Passthru) ctx.out(siteObj(r.site, 'iis'));
    } });
  iisCmd({ name: 'Remove-IISSite', shouldProcess: true, impact: 'High', synopsis: 'Removes an IIS site.', params: { Name: { pos: 0, mandatory: true, pipe: 'name' } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name);
      if (!s) { ctx.warn(`Web site '${p.Name}' does not exist.`); return; }
      if (!(await ctx.confirm('Remove-IISSite', s.name, { impact: 'High' }))) return;
      I().removeSite(s.name);
    } });
  for (const [verb, fn] of [['Start', 'startSite'], ['Stop', 'stopSite']]) iisCmd({ name: `${verb}-IISSite`, shouldProcess: true, synopsis: `${verb}s an existing IIS site.`, params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name);
      if (!s) { ctx.warn(`Web site '${p.Name}' does not exist.`); return; }
      if (!(await ctx.confirm(`${verb}-IISSite`, s.name))) return;
      const r = I()[fn](s.name);
      if (!r.ok) failRec(ctx, r, s.name);
      if (p.Passthru) ctx.out(siteObj(s, 'iis'));
    } });
  iisCmd({ name: 'Get-IISSiteBinding', synopsis: 'Gets the bindings of an IIS site.', params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, BindingInformation: { pos: 1 }, Protocol: { pos: 2 } },
    process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name);
      if (!s) { ctx.warn(`Web site '${p.Name}' does not exist.`); return; }
      s.bindings.filter(b => (!p.BindingInformation || lc(I().bindingInfo(b)) === lc(p.BindingInformation)) && (!p.Protocol || b.protocol === lc(p.Protocol))).forEach(b => ctx.out(bindingObj(s, b, true)));
    } });
  iisCmd({ name: 'New-IISSiteBinding', shouldProcess: true, synopsis: 'Adds a new binding to an existing IIS site.',
    params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, BindingInformation: { pos: 1, mandatory: true }, Protocol: { pos: 2, dflt: 'http' }, CertificateThumbPrint: {}, CertStoreLocation: {}, SslFlag: {}, Force: { type: 'switch' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name);
      if (!s) ctx.throw({ message: `Web site '${p.Name}' does not exist.`, category: 'ObjectNotFound', target: p.Name, exception: 'ArgumentException', id: 'SiteNotFound,Microsoft.IIS.Powershell.Commands.NewIISSiteBindingCommand' });
      const b = I().parseBinding(toStr(p.BindingInformation), toStr(p.Protocol || 'http'));
      if (!b) ctx.throw({ message: `The binding information '${toStr(p.BindingInformation)}' is not valid.`, category: 'InvalidArgument', target: toStr(p.BindingInformation), exception: 'ArgumentException', id: 'InvalidBindingInformation,Microsoft.IIS.Powershell.Commands.NewIISSiteBindingCommand' });
      if (b.protocol === 'https' && !p.CertificateThumbPrint) ctx.throw({ message: 'The CertificateThumbPrint parameter is required for an https binding.', category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'CertificateRequired,Microsoft.IIS.Powershell.Commands.NewIISSiteBindingCommand' });
      if (p.CertificateThumbPrint) b.cert = toStr(p.CertificateThumbPrint);
      if (p.SslFlag && /sni/i.test(toStr(p.SslFlag))) b.sni = true;
      if (!(await ctx.confirm('New-IISSiteBinding', s.name))) return;
      const r = I().addBinding(s.name, b);
      if (!r.ok) failRec(ctx, r, s.name);
      if (p.Passthru) ctx.out(bindingObj(s, r.binding, true));
    } });
  iisCmd({ name: 'Remove-IISSiteBinding', shouldProcess: true, synopsis: 'Removes a binding from an IIS site.', params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, BindingInformation: { pos: 1, mandatory: true }, Protocol: { pos: 2 }, RemoveConfigOnly: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name);
      if (!s) { ctx.warn(`Web site '${p.Name}' does not exist.`); return; }
      if (!(await ctx.confirm('Remove-IISSiteBinding', s.name))) return;
      const r = I().removeBinding(s.name, { protocol: p.Protocol ? toStr(p.Protocol) : null, info: toStr(p.BindingInformation) });
      if (!r.ok) ctx.warn(`The binding '${toStr(p.BindingInformation)}' does not exist on site '${s.name}'.`);
    } });
  iisCmd({ name: 'Get-IISAppPool', synopsis: 'Gets information about application pools and their worker processes.', params: { Name: { type: 'string[]', pos: 0, pipe: 'name' } },
    process(ctx, p) {
      needIIS(ctx);
      if (!p.Name) { I().pools().forEach(x => ctx.out(poolObj(x, 'iis'))); return; }
      for (const n of p.Name) { const x = I().pool(n); if (x) ctx.out(poolObj(x, 'iis')); else ctx.warn(`Application pool '${n}' does not exist.`); }
    } });

  /* ================================================================ WebAdministration */
  const webCmd = def => cmdlet({ module: 'WebAdministration', version: '1.0.0.0', feature: 'Web-Scripting-Tools', ...def });
  const EXISTS = 'Destination element already exists, please use "force" parameter to override.';
  const noSite = (ctx, n, terminating = false) => { const rec = { message: `Cannot find path 'IIS:\\Sites\\${n}' because it does not exist.`, category: 'ObjectNotFound', target: `IIS:\\Sites\\${n}`, exception: 'ItemNotFoundException', id: 'PathNotFound,' + ctx.name }; if (terminating) ctx.throw(rec); else ctx.error(rec); };
  webCmd({ name: 'Get-Website', synopsis: 'Gets configuration information for an IIS Web site.', params: { Name: { pos: 0, pipe: 'name' } },
    process(ctx, p) { needIIS(ctx); I().sites().filter(s => !p.Name || wild(toStr(p.Name), s.name)).forEach(s => ctx.out(siteObj(s, 'web'))); } });
  webCmd({ name: 'New-Website', shouldProcess: true, synopsis: 'Creates a new Web site.',
    params: { Name: { pos: 0, mandatory: true }, PhysicalPath: {}, Port: { type: 'int' }, IPAddress: {}, HostHeader: {}, ApplicationPool: {}, Id: { type: 'int' }, Ssl: { type: 'switch' }, SslFlags: { type: 'int' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      const existing = I().site(p.Name);
      if (existing && !p.Force) ctx.throw({ message: EXISTS, category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'System.ArgumentException,Microsoft.IIs.PowerShell.Provider.NewWebsiteCommand' });
      if (p.ApplicationPool && !I().pool(p.ApplicationPool)) ctx.throw({ message: `Cannot find path 'IIS:\\AppPools\\${p.ApplicationPool}' because it does not exist.`, category: 'ObjectNotFound', target: p.ApplicationPool, exception: 'ItemNotFoundException', id: 'PathNotFound,Microsoft.IIs.PowerShell.Provider.NewWebsiteCommand' });
      if (!(await ctx.confirm('New-Website', p.Name))) return;
      if (existing) I().removeSite(existing.name);
      const b = { protocol: p.Ssl ? 'https' : 'http', ip: p.IPAddress ? toStr(p.IPAddress) : '*', port: p.Port || (p.Ssl ? 443 : 80), host: p.HostHeader ? toStr(p.HostHeader) : '', sni: (p.SslFlags || 0) & 1 };
      const r = I().newSite({ name: toStr(p.Name), id: p.Id, physicalPath: p.PhysicalPath ? ctx.resolvePath(toStr(p.PhysicalPath)) : ' ', pool: p.ApplicationPool || 'DefaultAppPool', bindings: [b] });
      if (!r.ok) failRec(ctx, r, p.Name);
      ctx.out(siteObj(r.site, 'web'));
    } });
  webCmd({ name: 'Remove-Website', shouldProcess: true, synopsis: 'Removes a Web site.', params: { Name: { pos: 0, mandatory: true, pipe: 'name' } },
    async process(ctx, p) { needIIS(ctx); const s = I().site(p.Name); if (!s) return noSite(ctx, p.Name); if (!(await ctx.confirm('Remove-Website', s.name))) return; I().removeSite(s.name); } });
  for (const [verb, fn] of [['Start', 'startSite'], ['Stop', 'stopSite']]) webCmd({ name: `${verb}-Website`, shouldProcess: true, synopsis: `${verb}s a Web site.`, params: { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      for (const n of p.Name) {
        const s = I().site(n); if (!s) { noSite(ctx, n); continue; }
        if (!(await ctx.confirm(`${verb}-Website`, s.name))) continue;
        const r = I()[fn](s.name);
        if (!r.ok) { failRec(ctx, r, s.name, false); continue; }
        if (p.PassThru) ctx.out(siteObj(s, 'web'));
      }
    } });
  const bindMatch = (p, b) => (!p.Protocol || b.protocol === lc(p.Protocol)) && (p.Port == null || b.port === +p.Port) && (p.HostHeader == null || lc(b.host) === lc(p.HostHeader)) && (p.IPAddress == null || b.ip === toStr(p.IPAddress));
  webCmd({ name: 'Get-WebBinding', synopsis: 'Gets the bindings on the specified Web site.', params: { Name: { pos: 0, pipe: 'name' }, Protocol: {}, Port: { type: 'int' }, IPAddress: {}, HostHeader: {} },
    process(ctx, p) {
      needIIS(ctx);
      const list = p.Name ? [I().site(p.Name)].filter(Boolean) : I().sites();
      if (p.Name && !list.length) return noSite(ctx, p.Name);
      for (const s of list) for (const b of s.bindings) if (bindMatch(p, b)) ctx.out(bindingObj(s, b, false));
    } });
  webCmd({ name: 'New-WebBinding', shouldProcess: true, synopsis: 'Adds a binding to an existing Web site.', params: { Name: { pos: 0, pipe: 'name' }, Protocol: { dflt: 'http' }, Port: { type: 'int' }, IPAddress: {}, HostHeader: {}, SslFlags: { type: 'int' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name || 'Default Web Site'); if (!s) return noSite(ctx, p.Name, true);
      const proto = lc(p.Protocol || 'http');
      const b = { protocol: proto, ip: p.IPAddress ? toStr(p.IPAddress) : '*', port: p.Port || (proto === 'https' ? 443 : 80), host: p.HostHeader ? toStr(p.HostHeader) : '', sni: !!((p.SslFlags || 0) & 1) };
      if (!(await ctx.confirm('New-WebBinding', s.name))) return;
      const r = I().addBinding(s.name, b);
      if (!r.ok) ctx.throw({ message: r.error, category: 'InvalidArgument', target: '', exception: 'COMException', id: 'System.Runtime.InteropServices.COMException,Microsoft.IIs.PowerShell.Provider.NewWebBindingCommand' });
    } });
  webCmd({ name: 'Remove-WebBinding', shouldProcess: true, synopsis: 'Removes a binding from a Web site.', params: { Name: { pos: 0, pipe: 'name' }, Protocol: {}, Port: { type: 'int' }, IPAddress: {}, HostHeader: {}, BindingInformation: {} },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name || 'Default Web Site'); if (!s) return noSite(ctx, p.Name);
      const hits = s.bindings.filter(b => bindMatch(p, b) && (!p.BindingInformation || lc(I().bindingInfo(b)) === lc(p.BindingInformation)));
      if (!(await ctx.confirm('Remove-WebBinding', s.name))) return;
      for (const b of hits) I().removeBinding(s.name, { protocol: b.protocol, info: I().bindingInfo(b) });
    } });
  webCmd({ name: 'Set-WebBinding', shouldProcess: true, synopsis: 'Changes a property of a binding.', params: { Name: { pos: 0, mandatory: true }, BindingInformation: { mandatory: true }, PropertyName: { mandatory: true, values: ['Port', 'IPAddress', 'HostHeader'] }, Value: { mandatory: true } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Name); if (!s) return noSite(ctx, p.Name, true);
      const i = s.bindings.findIndex(b => lc(I().bindingInfo(b)) === lc(p.BindingInformation));
      if (i < 0) ctx.throw({ message: `The binding '${p.BindingInformation}' was not found on site '${s.name}'.`, category: 'ObjectNotFound', target: p.BindingInformation, exception: 'ArgumentException', id: 'BindingNotFound,Microsoft.IIs.PowerShell.Provider.SetWebBindingCommand' });
      if (!(await ctx.confirm('Set-WebBinding', s.name))) return;
      const key = { port: 'port', ipaddress: 'ip', hostheader: 'host' }[lc(p.PropertyName)];
      const r = I().setBinding(s.name, i, { [key]: key === 'port' ? +toStr(p.Value) : toStr(p.Value) });
      if (!r.ok) failRec(ctx, r, s.name);
    } });
  webCmd({ name: 'Get-WebAppPoolState', synopsis: 'Gets the run-time state of an application pool.', params: { Name: { pos: 0, pipe: 'name' } },
    process(ctx, p) { needIIS(ctx); for (const x of I().pools().filter(x => !p.Name || wild(toStr(p.Name), x.name))) ctx.out(psobj('System.Management.Automation.PSCustomObject', { Value: I().poolState(x) })); } });
  webCmd({ name: 'Get-WebsiteState', synopsis: 'Gets the run-time state of a Web site.', params: { Name: { pos: 0, pipe: 'name' } },
    process(ctx, p) { needIIS(ctx); for (const s of I().sites().filter(s => !p.Name || wild(toStr(p.Name), s.name))) ctx.out(psobj('System.Management.Automation.PSCustomObject', { Value: I().siteState(s) })); } });
  webCmd({ name: 'New-WebAppPool', shouldProcess: true, synopsis: 'Creates a new IIS application pool.', params: { Name: { pos: 0, mandatory: true }, Force: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      if (I().pool(p.Name) && !p.Force) ctx.throw({ message: EXISTS, category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'System.ArgumentException,Microsoft.IIs.PowerShell.Provider.NewAppPoolCommand' });
      if (!(await ctx.confirm('New-WebAppPool', p.Name))) return;
      if (I().pool(p.Name)) I().removePool(p.Name);
      const r = I().newPool({ name: toStr(p.Name) });
      if (!r.ok) failRec(ctx, r, p.Name);
      ctx.out(poolObj(r.pool, 'web'));
    } });
  webCmd({ name: 'Remove-WebAppPool', shouldProcess: true, synopsis: 'Removes an IIS application pool.', params: { Name: { pos: 0, mandatory: true, pipe: 'name' } },
    async process(ctx, p) { needIIS(ctx); if (!I().pool(p.Name)) return ctx.error({ message: `Cannot find path 'IIS:\\AppPools\\${p.Name}' because it does not exist.`, category: 'ObjectNotFound', target: p.Name, exception: 'ItemNotFoundException', id: 'PathNotFound,' + ctx.name }); if (!(await ctx.confirm('Remove-WebAppPool', p.Name))) return; I().removePool(p.Name); } });
  for (const [verb, fn] of [['Start', 'startPool'], ['Stop', 'stopPool'], ['Restart', 'recyclePool']]) webCmd({ name: `${verb}-WebAppPool`, shouldProcess: true, synopsis: `${verb}s an application pool.`, params: { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      for (const n of p.Name) {
        const x = I().pool(n);
        if (!x) { ctx.error({ message: `Cannot find path 'IIS:\\AppPools\\${n}' because it does not exist.`, category: 'ObjectNotFound', target: n, exception: 'ItemNotFoundException', id: 'PathNotFound,' + ctx.name }); continue; }
        if (!(await ctx.confirm(`${verb}-WebAppPool`, x.name))) continue;
        const r = I()[fn](x.name);
        if (!r.ok) { ctx.error({ message: r.error, category: 'InvalidOperation', target: x.name, exception: 'COMException', id: 'System.Runtime.InteropServices.COMException,' + ctx.name }); continue; }
        if (p.PassThru) ctx.out(poolObj(x, 'web'));
      }
    } });
  const appObj = (s, a) => psobj('IIS.WebApplication', { Name: a.path.slice(1), Site: s.name, Path: a.path, ApplicationPool: a.pool, PhysicalPath: (s.vdirs.find(v => lc(v.path) === lc(a.path)) || {}).physicalPath || '' });
  view('IIS.WebApplication', { table: { columns: [{ label: 'Name', width: 22, value: 'Name' }, { label: 'Application pool', width: 20, value: 'ApplicationPool' }, { label: 'Protocols', width: 10, value: () => 'http' }, { label: 'Physical Path', value: 'PhysicalPath' }] } });
  const vdirObj = (s, v) => psobj('IIS.WebVirtualDirectory', { Name: v.path.slice(1), Site: s.name, Path: v.path, PhysicalPath: v.physicalPath });
  view('IIS.WebVirtualDirectory', { table: { columns: [{ label: 'Name', width: 22, value: 'Name' }, { label: 'Physical Path', value: 'PhysicalPath' }] } });
  webCmd({ name: 'New-WebApplication', shouldProcess: true, synopsis: 'Creates a new Web application.', params: { Name: { pos: 0, mandatory: true }, Site: { mandatory: true }, PhysicalPath: { mandatory: true }, ApplicationPool: {}, Force: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Site); if (!s) return noSite(ctx, p.Site, true);
      if (s.apps.some(a => lc(a.path) === lc(I().normPath(p.Name))) && !p.Force) ctx.throw({ message: EXISTS, category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'System.ArgumentException,Microsoft.IIs.PowerShell.Provider.NewWebApplicationCommand' });
      if (!(await ctx.confirm('New-WebApplication', p.Name))) return;
      if (p.Force) I().removeApp(s.name, p.Name);
      const r = I().addApp(s.name, { path: toStr(p.Name), physicalPath: ctx.resolvePath(toStr(p.PhysicalPath)), pool: p.ApplicationPool ? toStr(p.ApplicationPool) : null });
      if (!r.ok) failRec(ctx, r, p.Name);
      ctx.out(appObj(s, s.apps.find(a => lc(a.path) === lc(I().normPath(p.Name)))));
    } });
  webCmd({ name: 'Remove-WebApplication', shouldProcess: true, synopsis: 'Removes a Web application.', params: { Name: { pos: 0, mandatory: true }, Site: { mandatory: true } },
    async process(ctx, p) { needIIS(ctx); if (!(await ctx.confirm('Remove-WebApplication', p.Name))) return; const r = I().removeApp(p.Site, p.Name); if (!r.ok) failRec(ctx, r, p.Name, false); } });
  webCmd({ name: 'Get-WebApplication', synopsis: 'Gets Web applications.', params: { Name: { pos: 0 }, Site: {} },
    process(ctx, p) { needIIS(ctx); for (const s of I().sites().filter(s => !p.Site || lc(s.name) === lc(p.Site))) for (const a of s.apps) if (a.path !== '/' && (!p.Name || wild(toStr(p.Name), a.path.slice(1)))) ctx.out(appObj(s, a)); } });
  webCmd({ name: 'New-WebVirtualDirectory', shouldProcess: true, synopsis: 'Creates a new virtual directory.', params: { Name: { pos: 0, mandatory: true }, Site: { mandatory: true }, PhysicalPath: { mandatory: true }, Application: {}, Force: { type: 'switch' } },
    async process(ctx, p) {
      needIIS(ctx);
      const s = I().site(p.Site); if (!s) return noSite(ctx, p.Site, true);
      const path = (p.Application ? I().normPath(p.Application) : '') + I().normPath(p.Name);
      if (s.vdirs.some(v => lc(v.path) === lc(I().normPath(path))) && !p.Force) ctx.throw({ message: EXISTS, category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'System.ArgumentException,Microsoft.IIs.PowerShell.Provider.NewVirtualDirectoryCommand' });
      if (!(await ctx.confirm('New-WebVirtualDirectory', p.Name))) return;
      if (p.Force) I().removeVdir(s.name, path);
      const r = I().addVdir(s.name, { path, physicalPath: ctx.resolvePath(toStr(p.PhysicalPath)) });
      if (!r.ok) failRec(ctx, r, p.Name);
      ctx.out(vdirObj(s, s.vdirs.find(v => lc(v.path) === lc(I().normPath(path)))));
    } });
  webCmd({ name: 'Remove-WebVirtualDirectory', shouldProcess: true, synopsis: 'Removes a virtual directory.', params: { Name: { pos: 0, mandatory: true }, Site: { mandatory: true }, Application: {} },
    async process(ctx, p) { needIIS(ctx); if (!(await ctx.confirm('Remove-WebVirtualDirectory', p.Name))) return; const r = I().removeVdir(p.Site, (p.Application ? I().normPath(p.Application) : '') + I().normPath(p.Name)); if (!r.ok) failRec(ctx, r, p.Name, false); } });
  webCmd({ name: 'Get-WebVirtualDirectory', synopsis: 'Gets virtual directories.', params: { Name: { pos: 0 }, Site: {} },
    process(ctx, p) { needIIS(ctx); for (const s of I().sites().filter(s => !p.Site || lc(s.name) === lc(p.Site))) for (const v of s.vdirs) if (v.path !== '/' && !s.apps.some(a => lc(a.path) === lc(v.path)) && (!p.Name || wild(toStr(p.Name), v.path.slice(1)))) ctx.out(vdirObj(s, v)); } });

  /* ---------------- configuration properties (directoryBrowse, defaultDocument) ---------------- */
  const unsupported = (ctx, f) => ctx.throw({ message: `The configuration section '${toStr(f)}' is not modelled in the lab simulator. Supported: system.webServer/directoryBrowse and system.webServer/defaultDocument.`, category: 'NotImplemented', target: toStr(f), exception: 'NotSupportedException', id: 'NotSupported,' + ctx.name });
  const CFG = { Filter: { pos: 0, mandatory: true }, PSPath: { alias: ['Path'] }, Location: {}, Name: { pos: 1, mandatory: true }, Value: { type: 'object' }, Force: { type: 'switch' } };
  webCmd({ name: 'Set-WebConfigurationProperty', shouldProcess: true, synopsis: 'Changes the value of an IIS configuration property.', params: { ...CFG, Value: { type: 'object', pos: 2 } },
    async process(ctx, p) {
      needIIS(ctx);
      const scope = scopeOf(ctx, p.PSPath, p.Location), sec = sectionOf(p.Filter), name = lc(p.Name);
      if (!(await ctx.confirm('Set-WebConfigurationProperty', scope || 'MACHINE/WEBROOT/APPHOST'))) return;
      const v = p.Value && typeof p.Value === 'object' && 'Value' in p.Value ? p.Value.Value : p.Value;
      let r;
      if (sec === 'directorybrowse' && name === 'enabled') r = I().setDirBrowse(scope, { enabled: toBool(v) });
      else if (sec === 'directorybrowse' && name === 'showflags') r = I().setDirBrowse(scope, { showFlags: toStr(v) });
      else if (sec === 'defaultdocument' && name === 'enabled') r = I().setDefaultDocEnabled(scope, toBool(v));
      else return unsupported(ctx, p.Filter + '/@' + p.Name);
      if (!r.ok) failRec(ctx, r, scope);
    } });
  const isFiles = f => /^(\/\/)?(system\.webserver\/)?defaultdocument\/files\/?$/i.test(toStr(f).replace(/^\/+/, '//').replace(/^\/\/\/+/, '//').replace(/^\/\/system/i, 'system')) || /defaultdocument\/files/i.test(toStr(f));
  webCmd({ name: 'Add-WebConfigurationProperty', shouldProcess: true, synopsis: 'Adds a collection element to an IIS configuration collection.', params: { ...CFG, Value: { type: 'object', pos: 2 }, AtIndex: { type: 'int' } },
    async process(ctx, p) {
      needIIS(ctx);
      const scope = scopeOf(ctx, p.PSPath, p.Location);
      if (!isFiles(p.Filter)) return unsupported(ctx, p.Filter);
      if (!(await ctx.confirm('Add-WebConfigurationProperty', scope || 'MACHINE/WEBROOT/APPHOST'))) return;
      const v = p.Value instanceof PS.PSHashtable ? toStr(p.Value.get('value')) : typeof p.Value === 'object' && p.Value && 'value' in p.Value ? toStr(p.Value.value) : toStr(p.Value);
      const r = I().addDefaultDoc(scope, v, p.AtIndex != null ? p.AtIndex : I().defaultDocs(scope).files.length);
      if (!r.ok) ctx.throw({ message: r.error, category: 'InvalidData', target: '', exception: 'COMException', id: 'System.Runtime.InteropServices.COMException,Microsoft.IIs.PowerShell.Provider.AddConfigurationPropertyCommand' });
    } });
  webCmd({ name: 'Remove-WebConfigurationProperty', shouldProcess: true, synopsis: 'Removes an IIS configuration collection element.', params: { ...CFG, AtElement: { type: 'object' } },
    async process(ctx, p) {
      needIIS(ctx);
      const scope = scopeOf(ctx, p.PSPath, p.Location);
      if (!isFiles(p.Filter)) return unsupported(ctx, p.Filter);
      const el = p.AtElement;
      const v = el instanceof PS.PSHashtable ? toStr(el.get('value')) : toStr(el);
      if (!(await ctx.confirm('Remove-WebConfigurationProperty', scope || 'MACHINE/WEBROOT/APPHOST'))) return;
      const r = I().removeDefaultDoc(scope, v);
      if (!r.ok) ctx.error({ message: 'Cannot find requested collection element.', category: 'ObjectNotFound', target: v, exception: 'COMException', id: 'System.Runtime.InteropServices.COMException,Microsoft.IIs.PowerShell.Provider.RemoveConfigurationPropertyCommand' });
    } });
  webCmd({ name: 'Get-WebConfigurationProperty', synopsis: 'Gets the value of an IIS configuration property.', params: { Filter: { pos: 0, mandatory: true }, PSPath: { alias: ['Path'] }, Location: {}, Name: { pos: 1, mandatory: true } },
    process(ctx, p) {
      needIIS(ctx);
      const scope = scopeOf(ctx, p.PSPath, p.Location), sec = sectionOf(p.Filter), name = lc(p.Name);
      if (sec === 'directorybrowse') { const d = I().dirBrowse(scope); ctx.out(psobj('Microsoft.IIs.PowerShell.Framework.ConfigurationAttribute', { Name: name === 'showflags' ? 'showFlags' : 'enabled', Value: name === 'showflags' ? d.showFlags : d.enabled, IsInheritedFromDefaultValue: false, Schema: 'Microsoft.IIs.PowerShell.Framework.ConfigurationAttributeSchema' })); return; }
      if (isFiles(p.Filter)) { I().defaultDocs(scope).files.forEach(f => ctx.out(psobj('Microsoft.IIs.PowerShell.Framework.ConfigurationElement', { value: f.value }, { str: 'Microsoft.IIs.PowerShell.Framework.ConfigurationElement' }))); return; }
      if (sec === 'defaultdocument' && name === 'enabled') { ctx.out(I().defaultDocs(scope).enabled); return; }
      unsupported(ctx, p.Filter);
    } });
})();
