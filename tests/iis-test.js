/* IIS: the model (sites, bindings, host headers, pools, default documents, directory browsing, applications,
 * virtual directories, certificates, worker processes, logs), the shell commands (IISAdministration,
 * WebAdministration, appcmd, iisreset, curl, Invoke-WebRequest, Cert:), IIS Manager and Edge. Use a fresh profile.
 * &shot=home|sites|pools|addsite|bindings|binding|defdoc|dirbrowse|certs|content|workers|listing|certwarn|invalidhost|ps */
(async function () {
  'use strict';
  const WS = window.WS, X = () => WS.iis;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 3000) => { for (let i = 0; i < ms / 50; i++) { if (fn()) return true; await wait(50); } return !!fn(); };
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const title = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
  const button = (label, scope = shade()) => scope && [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label + ' in ' + (scope || shade() || {}).textContent); b.click(); await wait(80); };
  const shotMode = new URLSearchParams(location.search).get('shot');
  const shot = name => { if (shotMode !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async c => { const io = ps.console; io.clear(); await ps.execute(c); return io.buf; };
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.buf; };
  const req = (host, path = '/', o = {}) => X().request({ protocol: o.protocol || 'http', host, ip: o.ip || '127.0.0.1', port: o.port, path });
  const serve = (url, o) => WS.edge.serve(url, o);
  const write = (p, text) => { WS.fs.ensureDir(p.replace(/\\[^\\]+$/, '')); WS.fs.writeFile(p, text); };
  try {
    await wait(300);
    const ip = WS.net.primaryIp();
    // the lab's hosts-file names for host headers
    const HOSTS = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    WS.fs.writeFile(HOSTS, WS.fs.readFile(HOSTS) + `\r\n${ip} intranet.contoso.local\r\n${ip} reports.contoso.local\r\n${ip} other.contoso.local\r\n${ip} ps.contoso.local\r\n`);

    /* ---------------- before IIS ---------------- */
    t('IIS is not installed at first; appcmd and Get-IISSite do not exist', !X().installed() && WS.state.iis === null && /is not recognized/.test(await crun('C:\\Windows\\System32\\inetsrv\\appcmd list site')) && /is not recognized/.test(await run('Get-IISSite')));
    t('iisreset is not recognized without IIS', /is not recognized/.test(await crun('iisreset /status')));
    t('localhost refuses without IIS', serve('http://localhost').code === 'ERR_CONNECTION_REFUSED');

    /* ---------------- install ---------------- */
    WS.features.install(['Web-Server']);
    await wait(50);
    const dws = X().site('Default Web Site');
    t('installing IIS creates Default Web Site (ID 1, http *:80:, wwwroot) and DefaultAppPool', !!dws && dws.id === 1 && dws.state === 'Started' && X().bindingInfo(dws.bindings[0]) === '*:80:' && X().rootPath(dws) === '%SystemDrive%\\inetpub\\wwwroot' && X().pool('DefaultAppPool').runtime === 'v4.0' && X().pool('DefaultAppPool').pipeline === 'Integrated');
    t('applicationHost.config is written and lists the site', /<site name="Default Web Site" id="1">[\s\S]*bindingInformation="\*:80:"/.test(WS.fs.readFile('C:\\Windows\\System32\\inetsrv\\config\\applicationHost.config')));
    t('appcmd.exe and InetMgr.exe are in %windir%\\system32\\inetsrv', WS.fs.exists('C:\\Windows\\System32\\inetsrv\\appcmd.exe') && WS.fs.exists('C:\\Windows\\System32\\inetsrv\\InetMgr.exe'));
    let r = req('localhost');
    t('localhost gets iisstart.htm from Default Web Site', r.status === 200 && r.title === 'IIS Windows Server' && r.site.name === 'Default Web Site');
    t('the default document list is IIS 10\u2019s', X().defaultDocs(null).files.map(f => f.value).join(',') === 'Default.htm,Default.asp,index.htm,index.html,iisstart.htm');

    /* ---------------- sites, host headers, HTTP.sys ---------------- */
    WS.fs.ensureDir('C:\\Sites\\Intranet');
    let n = X().newSite({ name: 'Intranet', physicalPath: 'C:\\Sites\\Intranet', bindings: [{ protocol: 'http', ip: '*', port: 80, host: 'intranet.contoso.local' }], createPool: true });
    t('a host-header site starts next to Default Web Site with its own pool', n.ok && n.site.id === 2 && n.started && !n.conflict && X().pool('Intranet') && X().rootPool(n.site) === 'Intranet');
    r = req('intranet.contoso.local', '/', { ip });
    t('an empty site: 403.14 with the IIS detailed error', r.status === 403 && r.sub === '403.14' && /HTTP Error 403.14 - Forbidden/.test(r.body) && /Things you can try:/.test(r.body));
    write('C:\\Sites\\Intranet\\index.html', '<html><head><title>Contoso Intranet</title></head><body><h1>Contoso Intranet</h1><a href="/news/">News</a></body></html>');
    r = req('intranet.contoso.local', '/', { ip });
    t('the host header picks the Intranet site', r.status === 200 && r.title === 'Contoso Intranet' && r.site.name === 'Intranet');
    t('another host name falls to the wildcard binding', req('other.contoso.local', '/', { ip }).site.name === 'Default Web Site');
    X().stopSite('Default Web Site');
    r = req('localhost');
    t('with Default Web Site stopped, an unknown host gets HTTP.sys 400 Invalid Hostname', r.status === 400 && /Bad Request - Invalid Hostname/.test(r.body) && /HTTP Error 400. The request hostname is invalid./.test(r.body));
    t('...while the host-header site still answers', req('intranet.contoso.local', '/', { ip }).status === 200);
    X().stopSite('Intranet');
    t('with nothing listening on port 80, the connection is refused', req('localhost').kind === 'refused' && serve('http://localhost').code === 'ERR_CONNECTION_REFUSED');
    X().startSite('Default Web Site'); X().startSite('Intranet');
    WS.fs.ensureDir('C:\\Sites\\Copy');
    n = X().newSite({ name: 'Copy', physicalPath: 'C:\\Sites\\Copy', bindings: [{ protocol: 'http', ip: '*', port: 80, host: '' }] });
    t('a duplicate binding is created stopped', n.ok && n.conflict && n.site.state === 'Stopped');
    let e = X().startSite('Copy');
    t('starting it fails with 0x80070020', !e.ok && e.code === 'InUse' && /0x80070020/.test(e.error));
    t('removing a site works', X().removeSite('Copy').ok && !X().site('Copy'));
    t('duplicate site names are refused', X().newSite({ name: 'intranet', physicalPath: 'C:\\x' }).code === 'Exists');
    t('bad ports and host names are refused', X().addBinding('Intranet', { protocol: 'http', port: 70000 }).code === 'InvalidPort' && X().addBinding('Intranet', { protocol: 'http', port: 81, host: 'bad host' }).code === 'InvalidHost');

    /* ---------------- directory browsing, redirects, request filtering ---------------- */
    write('C:\\Sites\\Reports\\Q1.csv', 'Quarter,Sales\r\nQ1,100');
    write('C:\\Sites\\Reports\\2026\\Q2.csv', 'Quarter,Sales\r\nQ2,120');
    n = X().newSite({ name: 'Reports', physicalPath: 'C:\\Sites\\Reports', bindings: [{ protocol: 'http', ip: '*', port: 8080 }], createPool: true });
    t('a port-8080 site with no default document: 403.14', n.ok && req('localhost', '/', { port: 8080 }).sub === '403.14');
    X().setDirBrowse('Reports', { enabled: true });
    r = req('localhost', '/', { port: 8080 });
    t('directory browsing lists the folder IIS-style', r.status === 200 && r.listing && /<H1>localhost - \/<\/H1>/.test(r.body) && /<A HREF="\/Q1.csv">Q1.csv<\/A>/.test(r.body) && /&lt;dir&gt; <A HREF="\/2026\/">2026<\/A>/.test(r.body) && !/To Parent Directory/.test(r.body));
    t('...and the setting is written to the site\u2019s web.config (which is not listed)', /<directoryBrowse enabled="true" \/>/.test(WS.fs.readFile('C:\\Sites\\Reports\\web.config')) && !/web.config/.test(r.body));
    r = req('localhost', '/2026', { port: 8080 });
    t('a folder without a trailing slash gets a 301 courtesy redirect', r.status === 301 && r.location === 'http://localhost:8080/2026/');
    r = req('localhost', '/2026/', { port: 8080 });
    t('a subfolder listing links to its parent', /\[To Parent Directory\]/.test(r.body) && /Q2.csv/.test(r.body));
    t('the directory browsing setting is inherited by the server default only where not set', X().dirBrowse('Reports/2026').enabled && !X().dirBrowse('Intranet').enabled && !X().dirBrowse(null).enabled);
    t('web.config is a hidden segment (404.8)', req('localhost', '/web.config', { port: 8080 }).sub === '404.8');
    t('a .config file is a denied extension (404.7) and an unknown one has no MIME map (404.3)', (write('C:\\Sites\\Reports\\app.config', 'x'), req('localhost', '/app.config', { port: 8080 }).sub === '404.7') && (write('C:\\Sites\\Reports\\data.xyz', 'x'), req('localhost', '/data.xyz', { port: 8080 }).sub === '404.3'));
    r = req('localhost', '/Q1.csv', { port: 8080 });
    t('a .csv file is served as text/csv', r.status === 200 && r.contentType === 'text/csv' && /Q1,100/.test(r.body));
    t('a missing file: 404.0 with the physical path', req('localhost', '/nope.htm', { port: 8080 }).sub === '404.0' && /C:\\Sites\\Reports\\nope.htm/.test(req('localhost', '/nope.htm', { port: 8080 }).body));
    X().setDirBrowse('Reports', { showFlags: 'Date, Time, Size' });
    t('without Extension in showFlags, names lose their extension', /<A HREF="\/Q1.csv">Q1<\/A>/.test(req('localhost', '/', { port: 8080 }).body));

    /* ---------------- default documents ---------------- */
    write('C:\\Sites\\Intranet\\home.htm', '<html><head><title>Intranet Home</title></head><body>Home</body></html>');
    t('home.htm is not a default document yet', req('intranet.contoso.local', '/', { ip }).title === 'Contoso Intranet');
    t('adding home.htm at the site puts it first as a Local entry', X().addDefaultDoc('Intranet', 'home.htm', 0).ok && X().defaultDocs('Intranet').files[0].value === 'home.htm' && X().defaultDocs('Intranet').files[0].local && !X().defaultDocs('Intranet').files[1].local);
    t('...and it wins', req('intranet.contoso.local', '/', { ip }).title === 'Intranet Home');
    t('the server list is unchanged; the site web.config has the add', !X().defaultDocs(null).files.some(f => f.value === 'home.htm') && /<add value="home.htm" \/>/.test(WS.fs.readFile('C:\\Sites\\Intranet\\web.config')));
    t('a duplicate entry is refused', X().addDefaultDoc('Intranet', 'HOME.HTM').code === 'Exists');
    X().moveDefaultDoc('Intranet', 'home.htm', 1);
    t('Move Down reorders and makes every entry local', X().defaultDocs('Intranet').files[1].value === 'home.htm' && X().defaultDocs('Intranet').files.every(f => f.local));
    X().revertDefaultDocs('Intranet');
    t('Revert To Parent restores the inherited list', !X().defaultDocs('Intranet').files.some(f => f.value === 'home.htm') && req('intranet.contoso.local', '/', { ip }).title === 'Contoso Intranet');
    X().setDefaultDocEnabled('Intranet', false);
    t('with default documents disabled, the folder is 403.14', req('intranet.contoso.local', '/', { ip }).sub === '403.14');
    X().setDefaultDocEnabled('Intranet', true);

    /* ---------------- pools, worker processes ---------------- */
    t('a request started a worker process for the pool', !!WS.proc.list().find(p => p.image === 'w3wp.exe' && p.iisPool === 'Intranet'));
    const w1 = WS.proc.list().find(p => p.image === 'w3wp.exe' && p.iisPool === 'Intranet');
    t('w3wp.exe runs as IIS APPPOOL\\Intranet under the WAS svchost', w1 && WS.proc.qualifiedUser(w1) === 'IIS APPPOOL\\Intranet' && w1.ppid === WS.proc.pidOfService('WAS') && /-ap "Intranet"/.test(w1.cmdLine));
    X().recyclePool('Intranet');
    req('intranet.contoso.local', '/', { ip });
    const w2 = WS.proc.list().find(p => p.image === 'w3wp.exe' && p.iisPool === 'Intranet');
    t('recycling starts a new worker process', w2 && w2.pid !== w1.pid);
    WS.proc.kill(w2.pid, {});
    t('a killed worker is gone until the next request starts another', !WS.proc.list().some(p => p.iisPool === 'Intranet') && (req('intranet.contoso.local', '/', { ip }), WS.proc.list().some(p => p.iisPool === 'Intranet' && p.pid !== w2.pid)));
    X().stopPool('Intranet');
    r = req('intranet.contoso.local', '/', { ip });
    t('a stopped pool gives HTTP.sys 503 Service Unavailable', r.status === 503 && /HTTP Error 503. The service is unavailable./.test(r.body) && !WS.proc.list().some(p => p.iisPool === 'Intranet'));
    X().startPool('Intranet');
    t('starting it again serves the site', req('intranet.contoso.local', '/', { ip }).status === 200);
    t('a pool name in use is refused; removing a pool works', X().newPool({ name: 'intranet' }).code === 'Exists' && X().newPool({ name: 'Temp', runtime: '' }).ok && X().pool('Temp').runtime === '' && X().removePool('Temp').ok);

    /* ---------------- applications and virtual directories ---------------- */
    write('C:\\Docs\\guide.txt', 'Read me');
    t('a virtual directory maps to another folder', X().addVdir('Intranet', { path: 'docs', physicalPath: 'C:\\Docs' }).ok && req('intranet.contoso.local', '/docs/guide.txt', { ip }).body === 'Read me');
    write('C:\\Apps\\Api\\index.htm', '<title>API</title>');
    X().newPool({ name: 'ApiPool', start: false });
    t('an application runs in its own pool', X().addApp('Intranet', { path: '/api', physicalPath: 'C:\\Apps\\Api', pool: 'ApiPool' }).ok && req('intranet.contoso.local', '/api/', { ip }).status === 503 && req('intranet.contoso.local', '/', { ip }).status === 200);
    X().startPool('ApiPool');
    t('...and answers once its pool starts', req('intranet.contoso.local', '/api/', { ip }).title === 'API');
    t('a site whose folder is missing gives 500.19', (X().newSite({ name: 'Broken', physicalPath: 'C:\\Nowhere', bindings: [{ protocol: 'http', port: 8081 }] }), req('localhost', '/', { port: 8081 }).sub === '500.19') && /Cannot read configuration file/.test(req('localhost', '/', { port: 8081 }).body));
    X().removeSite('Broken');

    /* ---------------- HTTPS ---------------- */
    const cert = WS.certs.createSelfSigned({ dnsNames: ['intranet.contoso.local'], friendlyName: 'Intranet' }).cert;
    t('a self-signed certificate lands in LocalMachine\\My', cert.subject === 'CN=intranet.contoso.local' && /^[0-9A-F]{40}$/.test(cert.thumbprint) && WS.certs.storeOf(cert.thumbprint) === 'my');
    t('an https binding with the certificate serves the site', X().addBinding('Intranet', { protocol: 'https', port: 443, host: 'intranet.contoso.local', cert: cert.thumbprint }).ok && req('intranet.contoso.local', '/', { protocol: 'https', ip }).status === 200);
    t('an https binding without a certificate resets the connection', X().addBinding('Reports', { protocol: 'https', port: 8443 }).ok && req('localhost', '/', { protocol: 'https', port: 8443 }).kind === 'reset' && serve('https://localhost:8443/').code === 'ERR_CONNECTION_RESET');
    let er = serve('https://intranet.contoso.local/');
    t('Edge: a self-signed certificate shows "Your connection isn\u2019t private" (NET::ERR_CERT_AUTHORITY_INVALID)', er.kind === 'cert' && er.code === 'NET::ERR_CERT_AUTHORITY_INVALID' && /Your connection isn\u2019t private/.test(er.html));
    t('...and a name mismatch shows NET::ERR_CERT_COMMON_NAME_INVALID', X().addBinding('Default Web Site', { protocol: 'https', port: 443, cert: cert.thumbprint }).ok && serve('https://localhost/').code === 'NET::ERR_CERT_COMMON_NAME_INVALID');

    /* ---------------- W3SVC, logs ---------------- */
    WS.svc.stop('W3SVC');
    t('with W3SVC stopped: refused, sites Unknown, Start fails with the W3SVC message', req('localhost').kind === 'refused' && X().siteState(X().site('Intranet')) === 'Unknown' && /World Wide Web Publishing Service \(W3SVC\) is stopped/.test(X().startSite('Intranet').error));
    WS.svc.start('W3SVC');
    const logs = WS.fs.list('C:\\inetpub\\logs\\LogFiles\\W3SVC2');
    const logText = logs.length ? WS.fs.readFile(logs[0].path) : '';
    t('requests are logged in W3C format per site', /^#Software: Microsoft Internet Information Services 10.0/.test(logText) && /#Fields: date time s-ip cs-method cs-uri-stem/.test(logText) && / GET \/docs\/guide.txt - 80 /.test(logText) && / 503 0 0 /.test(logText));

    /* ---------------- PowerShell ---------------- */
    let o = await run('Get-IISSite');
    t('Get-IISSite needs IIS Management Scripts and Tools', /The term 'Get-IISSite' is not recognized/.test(o));
    WS.features.install(['Web-Scripting-Tools']);
    o = await run('Get-IISSite');
    t('Get-IISSite: Name, ID, State, Physical Path, Bindings', /Name\s+ID\s+State\s+Physical Path\s+Bindings/.test(o) && /Default Web Site\s+1\s+Started\s+%SystemDrive%\\inetpub\\wwwroot\s+http \*:80:/.test(o) && /\n\s+https \*:443:intranet.contoso.local/.test(o), o);
    WS.fs.ensureDir('C:\\Sites\\PS');
    o = await run('New-IISSite -Name PSsite -PhysicalPath C:\\Sites\\PS -BindingInformation "*:8090:"');
    t('New-IISSite creates and starts a site', X().site('PSsite') && X().site('PSsite').state === 'Started' && X().rootPool(X().site('PSsite')) === 'DefaultAppPool', o);
    o = await run('$c = New-SelfSignedCertificate -DnsName ps.contoso.local -CertStoreLocation Cert:\\LocalMachine\\My; New-IISSiteBinding -Name PSsite -BindingInformation "*:8443:ps.contoso.local" -Protocol https -CertificateThumbPrint $c.Thumbprint -CertStoreLocation Cert:\\LocalMachine\\My; $c.Subject');
    t('New-SelfSignedCertificate + New-IISSiteBinding add an https binding with the certificate', /CN=ps.contoso.local/.test(o) && X().site('PSsite').bindings.some(b => b.protocol === 'https' && b.port === 8443 && WS.certs.get(b.cert).subject === 'CN=ps.contoso.local'), o);
    o = await run('Get-ChildItem Cert:\\LocalMachine\\My');
    t('Get-ChildItem Cert:\\LocalMachine\\My lists the certificates', /PSParentPath: Microsoft.PowerShell.Security\\Certificate::LocalMachine\\My/.test(o) && o.includes(cert.thumbprint) && /CN=ps.contoso.local/.test(o), o);
    o = await run('Get-IISSiteBinding -Name PSsite');
    t('Get-IISSiteBinding', /protocol\s+bindingInformation\s+sslFlags/.test(o) && /https\s+\*:8443:ps.contoso.local/.test(o), o);
    o = await run('Stop-IISSite -Name PSsite; (Get-IISSite PSsite).State');
    t('Stop-IISSite stops it', /Stopped/.test(o) && X().site('PSsite').state === 'Stopped', o);
    await run('Start-IISSite -Name PSsite');
    o = await run('Get-IISAppPool');
    t('Get-IISAppPool: Name, Status, CLR Ver, Pipeline Mode, Start Mode', /Name\s+Status\s+CLR Ver\s+Pipeline Mode\s+Start Mode/.test(o) && /DefaultAppPool\s+Started\s+v4.0\s+Integrated\s+OnDemand/.test(o), o);
    o = await run('New-Website -Name W2 -Port 8091 -PhysicalPath C:\\Sites\\PS');
    t('New-Website (WebAdministration) creates a site', X().site('W2') && X().site('W2').bindings[0].port === 8091 && /W2\s+\d+\s+Started/.test(o), o);
    o = await run('New-Website -Name W2 -Port 8092 -PhysicalPath C:\\Sites\\PS');
    t('New-Website on an existing name: "Destination element already exists"', /Destination element already exists, please use "force" parameter to override./.test(o), o);
    await run('Stop-Website -Name W2');
    o = await run('Get-WebsiteState -Name W2');
    t('Stop-Website / Get-WebsiteState', /Stopped/.test(o), o);
    await run('Remove-Website -Name W2');
    t('Remove-Website', !X().site('W2'));
    o = await run('New-WebAppPool -Name P1; Stop-WebAppPool -Name P1; Get-WebAppPoolState -Name P1');
    t('New-WebAppPool / Stop-WebAppPool / Get-WebAppPoolState', X().pool('P1') && X().pool('P1').state === 'Stopped' && /Value\s*\n-----\s*\nStopped/.test(o), o);
    o = await run('New-WebBinding -Name PSsite -Protocol http -Port 8093 -HostHeader ps.contoso.local; Get-WebBinding -Name PSsite -Port 8093');
    t('New-WebBinding / Get-WebBinding', /http\s+\*:8093:ps.contoso.local/.test(o) && X().site('PSsite').bindings.some(b => b.port === 8093), o);
    o = await run('New-WebBinding -Name PSsite -Protocol http -Port 8093 -HostHeader ps.contoso.local');
    t('a duplicate New-WebBinding is refused', /Cannot add duplicate collection entry of type 'binding'/.test(o), o);
    await run('Remove-WebBinding -Name PSsite -Port 8093');
    t('Remove-WebBinding', !X().site('PSsite').bindings.some(b => b.port === 8093));
    await run("Set-WebConfigurationProperty -Filter /system.webServer/directoryBrowse -Name enabled -Value $true -PSPath 'IIS:\\Sites\\PSsite'");
    t('Set-WebConfigurationProperty turns on directory browsing for a site', X().dirBrowse('PSsite').enabled && !X().dirBrowse(null).enabled);
    await run("Add-WebConfigurationProperty -Filter '//defaultDocument/files' -PSPath 'IIS:\\Sites\\PSsite' -AtIndex 0 -Name Collection -Value 'home.htm'");
    t('Add-WebConfigurationProperty adds a default document first', X().defaultDocs('PSsite').files[0].value === 'home.htm');
    await run('New-WebVirtualDirectory -Site PSsite -Name docs -PhysicalPath C:\\Docs');
    t('New-WebVirtualDirectory', X().vdirs('PSsite').some(v => v.path === '/docs'));
    await run('New-WebApplication -Site PSsite -Name app -PhysicalPath C:\\Apps\\Api -ApplicationPool ApiPool');
    t('New-WebApplication', X().apps('PSsite').some(a => a.path === '/app' && a.pool === 'ApiPool'));
    o = await run('Invoke-WebRequest http://localhost -UseBasicParsing');
    t('Invoke-WebRequest returns the page', /StatusCode\s+: 200/.test(o) && /StatusDescription : OK/.test(o) && /Server: Microsoft-IIS\/10.0/.test(o), o);
    o = await run('(Invoke-WebRequest http://intranet.contoso.local/ -UseBasicParsing).Content');
    t('...through DNS/hosts and host headers', /Contoso Intranet/.test(o), o);
    o = await run('Invoke-WebRequest http://localhost/missing.htm -UseBasicParsing');
    t('Invoke-WebRequest: a 404 is an error', /The remote server returned an error: \(404\) Not Found\./.test(o), o);
    o = await run('Invoke-WebRequest https://intranet.contoso.local/ -UseBasicParsing');
    t('Invoke-WebRequest: an untrusted certificate fails the TLS trust check', /Could not establish trust relationship for the SSL\/TLS secure channel/.test(o), o);
    o = await run('Test-NetConnection localhost -Port 8090');
    t('Test-NetConnection sees the IIS port', /TcpTestSucceeded\s+: True/.test(o), o);
    o = await run('appcmd list site');
    t('appcmd is not on PATH in PowerShell', /The term 'appcmd' is not recognized/.test(o), o);
    o = await run('& C:\\Windows\\System32\\inetsrv\\appcmd.exe list apppool DefaultAppPool');
    t('...but runs by its full path', /APPPOOL "DefaultAppPool" \(MgdVersion:v4.0,MgdMode:Integrated,state:Started\)/.test(o), o);

    /* ---------------- CMD: appcmd, iisreset, curl ---------------- */
    o = await crun('appcmd list site');
    t('CMD: appcmd is not recognized outside inetsrv', /'appcmd' is not recognized/.test(o), o);
    await crun('cd /d C:\\Windows\\System32\\inetsrv');
    o = await crun('appcmd list site');
    t('appcmd list site', /SITE "Default Web Site" \(id:1,bindings:http\/\*:80:,https\/\*:443:,state:Started\)/.test(o) && /SITE "Intranet" \(id:2,bindings:http\/\*:80:intranet.contoso.local,https\/\*:443:intranet.contoso.local,state:Started\)/.test(o), o);
    o = await crun('appcmd add site /name:Cmd /bindings:http/*:8094: /physicalPath:C:\\Sites\\PS');
    t('appcmd add site', /SITE object "Cmd" added\s+APP object "Cmd\/" added\s+VDIR object "Cmd\/" added/.test(o) && X().site('Cmd') && X().site('Cmd').bindings[0].port === 8094, o);
    o = await crun('appcmd add site /name:Cmd /bindings:http/*:8095: /physicalPath:C:\\Sites\\PS');
    t('appcmd add site with a used name: duplicate collection element', /ERROR \( message:Failed to add duplicate collection element "Cmd". \)/.test(o), o);
    o = await crun('appcmd stop site Cmd');
    t('appcmd stop site', /"Cmd" successfully stopped./.test(o) && X().site('Cmd').state === 'Stopped', o);
    o = await crun('appcmd set site Cmd /+bindings.[protocol=\'http\',bindingInformation=\'*:8096:\']');
    t('appcmd set site /+bindings', /SITE object "Cmd" changed/.test(o) && X().site('Cmd').bindings.some(b => b.port === 8096), o);
    o = await crun('appcmd set config Cmd /section:directoryBrowse /enabled:true');
    t('appcmd set config /section:directoryBrowse', /Applied configuration changes to section "system.webServer\/directoryBrowse" for "MACHINE\/WEBROOT\/APPHOST\/Cmd"/.test(o) && X().dirBrowse('Cmd').enabled, o);
    o = await crun('appcmd list app /site.name:Intranet');
    t('appcmd list app', /APP "Intranet\/" \(applicationPool:Intranet\)/.test(o) && /APP "Intranet\/api" \(applicationPool:ApiPool\)/.test(o), o);
    o = await crun('appcmd list vdir');
    t('appcmd list vdir', /VDIR "Intranet\/docs" \(physicalPath:C:\\Docs\)/.test(o), o);
    o = await crun('appcmd delete site Nope');
    t('appcmd on a missing site', /ERROR \( message:Cannot find SITE object with identifier "Nope". \)/.test(o), o);
    o = await crun('appcmd delete site Cmd');
    t('appcmd delete site', /SITE object "Cmd" deleted/.test(o) && !X().site('Cmd'), o);
    o = await crun('appcmd recycle apppool Intranet');
    t('appcmd recycle apppool', /"Intranet" successfully recycled./.test(o), o);
    o = await crun('iisreset /status');
    t('iisreset /status', /Status for World Wide Web Publishing Service \( W3SVC \) : Running/.test(o), o);
    o = await crun('iisreset');
    t('iisreset stops and restarts IIS', /Attempting stop...\s+Internet services successfully stopped\s+Attempting start...\s+Internet services successfully restarted/.test(o) && WS.svc.isRunning('W3SVC') && WS.svc.isRunning('WAS'), o);
    o = await crun('curl -I http://localhost/');
    t('curl -I shows IIS\u2019s headers', /^HTTP\/1.1 200 OK/.test(o) && /Server: Microsoft-IIS\/10.0/.test(o) && /Content-Type: text\/html/.test(o), o);
    o = await crun('curl http://intranet.contoso.local/docs/guide.txt');
    t('curl prints the body', /Read me/.test(o), o);
    o = await crun('curl https://intranet.contoso.local/');
    t('curl: an untrusted certificate is error 60', /curl: \(60\) schannel: SEC_E_UNTRUSTED_ROOT/.test(o), o);
    o = await crun('curl -k https://intranet.contoso.local/');
    t('curl -k ignores it', /Contoso Intranet/.test(o), o);
    o = await crun('curl http://nosuchhost.contoso.local/');
    t('curl: an unknown host is error 6', /curl: \(6\) Could not resolve host: nosuchhost.contoso.local/.test(o), o);
    o = await crun('curl http://localhost:9999/');
    t('curl: a closed port is error 7', /curl: \(7\) Failed to connect to localhost port 9999/.test(o), o);
    if (shot('ps')) { WS.apps.launch('terminal'); return; }

    /* ---------------- IIS Manager ---------------- */
    const win = WS.apps.launch('inetmgr'); await wait(120);
    const M = win.inetmgr;
    t('IIS Manager opens on the server node with Manage Server actions', M.node() === 'server' && M.actions().includes('View Sites') && win.el.textContent.includes(`${WS.sys.name} Home`));
    t('the Features View shows the IIS feature icons', ['defaultDocument', 'directoryBrowse', 'certs', 'workers', 'logging'].every(k => win.el.querySelector(`.im-fi[data-feature="${k}"]`)));
    t('the tree has Application Pools, Sites and every site', !!M.tree.node('pools') && !!M.tree.node('sites') && X().sites().every(s => M.tree.node('s:' + s.id)));
    if (shot('home')) return;
    M.select('sites'); await wait(60);
    t('Sites lists Name, ID, Status, Binding, Path', M.list().rows().length === X().sites().length && win.el.textContent.includes('intranet.contoso.local on *:80 (http)'));
    M.list().select([2]); await wait(40);
    t('selecting a site offers Bindings..., Browse and Manage Website', M.actions().includes('Bindings...') && M.actions().some(a => /^~?Start$/.test(a)) && M.actions().includes('Browse *:80 (http)'));
    if (shot('sites')) return;
    M.select('pools'); await wait(60);
    t('Application Pools lists the pools with their application counts', M.list().rows().some(p => p.name === 'ApiPool') && win.el.textContent.includes('ApplicationPoolIdentity'));
    M.list().select(['P1']); await wait(40);
    M.act('Start'); await wait(60);
    t('Start on a pool starts it', X().pool('P1').state === 'Started');
    if (shot('pools')) return;

    // Add Website, with a duplicate binding refused and then a good one
    WS.fs.ensureDir('C:\\Sites\\Gui');
    let api;
    let p = WS.inetmgr.addWebsite({ onCreate: (f, a) => { api = a; } }); await wait(60);
    t('Add Website: OK stays disabled until a name and a path are entered', api.okButton.disabled && title() === 'Add Website');
    api.set('name', 'Gui');
    t('...the application pool follows the site name', api.field('pool').value === 'Gui');
    api.set('path', 'C:\\Sites\\Gui');
    if (shot('addsite')) return;
    api.ok(); await wait(80);
    t('a duplicate binding asks before it is added', /The binding '\*:80:' is assigned to another site\. If you assign the same binding to this site, you will only be able to start one of the sites\. Are you sure that you want to add this duplicate binding\?/.test(dlgText()));
    await click('No');
    api.set('port', '8097');
    api.ok(); await p;
    t('Add Website creates the site and its application pool', X().site('Gui') && X().site('Gui').state === 'Started' && X().pool('Gui') && X().rootPool(X().site('Gui')) === 'Gui' && X().site('Gui').bindings[0].port === 8097);
    p = WS.inetmgr.addWebsite({ onCreate: (f, a) => { api = a; } }); await wait(60);
    api.set('name', 'gui'); api.set('path', 'C:\\Sites\\Gui'); api.set('port', '8098'); api.ok(); await wait(80);
    t('a used site name is refused', /A site with this name already exists./.test(dlgText()));
    await click('OK'); api.cancel(); await p;
    // Site Bindings
    let bapi;
    p = WS.inetmgr.bindings('Gui', { onCreate: (f, a) => { bapi = a; } }); await wait(60);
    t('Site Bindings lists the binding', title() === 'Site Bindings' && bapi.list.rows().length === 1 && dlgText().includes('8097'));
    if (shot('bindings')) return;
    bapi.add(); await wait(80);
    t('Add Site Binding opens', title() === 'Add Site Binding' && /Example: www.contoso.com or marketing.contoso.com/.test(dlgText()));
    const bShade = shade();
    const setF = (name, v) => { const el = bShade.querySelector(`[data-field="${name}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    setF('type', 'https');
    t('choosing https switches the port to 443 and shows the certificate list', bShade.querySelector('[data-field="port"]').value === '443' && !bShade.querySelector('.im-ssl').hidden);
    setF('host', 'gui.contoso.local');
    if (shot('binding')) return;
    await click('OK', bShade);
    t('https without a certificate: "You must specify a certificate."', /You must specify a certificate./.test(dlgText()));
    await click('OK');
    setF('cert', cert.thumbprint);
    await click('OK', bShade);
    t('the https binding is added with the certificate', X().site('Gui').bindings.some(b => b.protocol === 'https' && b.port === 443 && b.host === 'gui.contoso.local' && b.cert === cert.thumbprint) && bapi.list.rows().length === 2);
    bapi.list.select([1]); await wait(30);
    bapi.remove(); await wait(60);
    t('Remove asks "Are you sure that you want to remove the selected binding?"', /Are you sure that you want to remove the selected binding\?/.test(dlgText()));
    await click('Yes');
    t('...and removes it', X().site('Gui').bindings.length === 1);
    bapi.close(); await p;
    // Edit Site, Add Application Pool, Basic Settings
    WS.fs.ensureDir('C:\\Sites\\Gui2');
    p = WS.inetmgr.editSite('Gui', { onCreate: (f, a) => { api = a; } }); await wait(50);
    api.set('path', 'C:\\Sites\\Gui2'); api.ok(); await p;
    t('Edit Site changes the physical path', X().rootPath(X().site('Gui')) === 'C:\\Sites\\Gui2');
    p = WS.inetmgr.addPool({ onCreate: (f, a) => { api = a; } }); await wait(50);
    api.set('name', 'NoManaged'); api.set('clr', ''); api.set('mode', 'Classic'); api.ok(); await p;
    t('Add Application Pool: No Managed Code, Classic', X().pool('NoManaged') && X().pool('NoManaged').runtime === '' && X().pool('NoManaged').pipeline === 'Classic' && X().pool('NoManaged').state === 'Started');
    p = WS.inetmgr.editPool('NoManaged', { onCreate: (f, a) => { api = a; } }); await wait(50);
    api.set('clr', 'v4.0'); api.ok(); await p;
    t('Edit Application Pool (Basic Settings) changes the CLR version', X().pool('NoManaged').runtime === 'v4.0');
    p = WS.inetmgr.addVdir('Gui', '/', { onCreate: (f, a) => { api = a; } }); await wait(50);
    api.set('alias', 'files'); api.set('path', 'C:\\Docs'); api.ok(); await p;
    t('Add Virtual Directory', X().vdirs('Gui').some(v => v.path === '/files' && v.physicalPath === 'C:\\Docs'));
    // feature pages on the Gui site
    const gid = 's:' + X().site('Gui').id;
    M.select(gid); await wait(60);
    t('the site node shows "Gui Home" and Edit Site / Manage Website / Browse actions', win.el.textContent.includes('Gui Home') && M.actions().includes('Basic Settings...') && M.actions().includes('Browse *:8097 (http)'));
    M.tree.expand(gid); await wait(30);
    t('the tree shows the virtual directory under the site', !!M.tree.node(`${gid}:/files`));
    M.open('defaultDocument'); await wait(60);
    t('Default Document lists the inherited entries', M.list().rows().length === 5 && win.el.textContent.includes('Inherited'));
    M.act('Add...'); await wait(60);
    { const s2 = shade(); const el = s2.querySelector('[data-field="name"]'); el.value = 'start.htm'; el.dispatchEvent(new Event('input', { bubbles: true })); await click('OK', s2); }
    t('Add... puts a Local entry at the top', X().defaultDocs('Gui').files[0].value === 'start.htm' && M.list().rows()[0].local);
    M.list().select(['start.htm']); await wait(30);
    M.act('Move Down'); await wait(40);
    t('Move Down', X().defaultDocs('Gui').files[1].value === 'start.htm');
    if (shot('defdoc')) return;
    M.act('Revert To Parent'); await wait(60);
    await click('Yes');
    t('Revert To Parent', !X().defaultDocs('Gui').files.some(f => f.value === 'start.htm'));
    M.open('directoryBrowse'); await wait(60);
    t('Directory Browsing shows the disabled alert', M.alerts().some(a => /Directory browsing has been disabled./.test(a)));
    M.act('Enable'); await wait(60);
    t('Enable turns it on for the site', X().dirBrowse('Gui').enabled && !M.alerts().length);
    M.dbBoxes()[4].checked = true; M.act('Apply'); await wait(40);
    t('Apply saves the Long date flag', /LongDate/.test(X().dirBrowse('Gui').showFlags));
    if (shot('dirbrowse')) return;
    M.select('server'); await wait(40); M.open('certs'); await wait(60);
    t('Server Certificates lists both certificates', M.list().rows().length === 2 && win.el.textContent.includes('Certificate Hash'));
    M.act('Create Self-Signed Certificate...'); await wait(60);
    { const s2 = shade(); t('Create Self-Signed Certificate: friendly name and store', title() === 'Create Self-Signed Certificate' && /Specify a friendly name for the certificate:/.test(dlgText())); const el = s2.querySelector('[data-field="name"]'); el.value = 'DC01 web'; el.dispatchEvent(new Event('input', { bubbles: true })); await click('OK', s2); }
    t('...creates one issued to the computer\u2019s name', WS.certs.list().some(c => c.friendlyName === 'DC01 web' && c.subject === 'CN=' + WS.sys.fqdn().toLowerCase()));
    if (shot('certs')) return;
    M.open('workers'); await wait(60);
    t('Worker Processes lists the running w3wp.exe processes', M.list().rows().length >= 1 && M.list().rows().every(w => w.proc.image === 'w3wp.exe'));
    if (shot('workers')) return;
    M.select('s:' + X().site('Reports').id); await wait(40); M.setView('content'); await wait(60);
    t('Content View lists the site\u2019s files', M.list().rows().some(r => r.name === 'Q1.csv') && M.list().rows().some(r => r.name === '2026'));
    if (shot('content')) return;
    M.setView('features'); M.select('s:2'); await wait(40);
    M.act('Stop'); await wait(60);
    t('Stop on the site stops it', X().site('Intranet').state === 'Stopped' && M.tree.node('s:2') && M.actions().includes('Start'));
    M.act('Start'); await wait(60);
    X().newSite({ name: 'Dup', physicalPath: 'C:\\Sites\\Gui', bindings: [{ protocol: 'http', port: 80, host: 'intranet.contoso.local' }] });
    const dup = X().site('Dup');
    M.select('s:' + dup.id); await wait(40);
    M.act('Start'); await wait(80);
    t('starting a site with a duplicate binding shows the 0x80070020 error', /There was an error while performing this operation\./.test(dlgText()) && /0x80070020/.test(dlgText()));
    await click('OK');
    M.act('Browse *:80 (http)'); await wait(30);
    M.select('s:2'); await wait(40);
    M.act('Browse *:80 (http)'); await wait(120);
    const edgeWin = WS.wm.find('edge');
    t('Browse opens the site in Edge', edgeWin && /intranet.contoso.local/.test(edgeWin.edge.url()) && edgeWin.edge.title() === 'Contoso Intranet');
    X().removeSite('Dup');

    /* ---------------- Edge pages ---------------- */
    const E = edgeWin.edge;
    E.go('http://localhost:8080/2026'); await wait(80);
    t('Edge follows the 301 to the folder and shows the listing', E.url() === 'http://localhost:8080/2026/' && /localhost - \/2026\//.test(E.title()));
    if (shot('listing')) return;
    E.go('https://intranet.contoso.local/'); await wait(80);
    t('Edge shows the certificate warning', E.result().kind === 'cert' && edgeWin.el.textContent.includes('Your connection isn\u2019t private') && edgeWin.el.textContent.includes('NET::ERR_CERT_AUTHORITY_INVALID'));
    if (shot('certwarn')) { edgeWin.el.querySelector('.ed-errbtn.ed-secondary').click(); return; }
    edgeWin.el.querySelector('.ed-errbtn.ed-secondary').click(); await wait(30);
    edgeWin.el.querySelector('.ed-proceed').click(); await wait(80);
    t('Advanced > Continue shows the page, marked not secure', E.title() === 'Contoso Intranet' && E.result().insecure && edgeWin.el.querySelector('.ed-site.ed-notsecure'));
    X().stopSite('Default Web Site');
    E.go('http://localhost/'); await wait(80);
    t('Edge shows HTTP.sys\u2019s Bad Request - Invalid Hostname', E.result().status === 400 && /Bad Request - Invalid Hostname/.test(E.text()));
    if (shot('invalidhost')) return;
    X().startSite('Default Web Site');
    E.go('http://localhost/missing.htm'); await wait(80);
    t('Edge renders the IIS detailed 404.0', E.result().code === 'HTTP 404.0' && edgeWin.el.textContent.includes('HTTP Error 404.0 - Not Found') && edgeWin.el.textContent.includes('Things you can try:'));

    /* ---------------- tools, uninstall ---------------- */
    t('Server Manager\u2019s Tools menu lists IIS Manager', WS.sm.tools().some(x => /Internet Information Services \(IIS\) Manager/.test(x.name || x[0] || x.label || '')));
    t('inetmgr in the Run box resolves to IIS Manager', (WS.term.resolveLaunch('inetmgr') || {}).app === 'inetmgr');
    t('Task Manager shows InetMgr.exe for the IIS Manager window', WS.proc.list().some(p => p.image === 'InetMgr.exe'));
    win.close(); edgeWin.close();
    WS.features.uninstall(['Web-Server']);
    WS.sys.onBoot(); await wait(100);
    t('uninstalling IIS (after the restart) removes the configuration', !WS.features.isInstalled('Web-Server') && WS.state.iis === null && !X().installed() && serve('http://localhost').code === 'ERR_CONNECTION_REFUSED');
  } catch (e) {
    fail++;
    console.log('FAIL exception :: ' + (e && e.stack || e));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
