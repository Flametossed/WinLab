/* DNS Manager browser workflow; use a fresh profile. &shot=down|wizard|records|zoneprops|server|forwarders|ad|delete */
(async function () {
  'use strict';
  const WS = window.WS, N = WS.dns, D = WS.dnsmgmt;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const button = (label, scope = shade()) => scope && [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(70); };
  const input = (key, scope = shade()) => scope.querySelector(`[data-field="${key}"]`);
  const fill = (key, value, scope) => { const el = input(key, scope); if (!el) throw new Error('Missing field: ' + key); if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const choose = key => fill(key, true);
  const tab = async label => { const b = [...shade().querySelectorAll('.ps-tab')].find(x => x.textContent === label); if (!b) throw new Error('Missing tab: ' + label); b.click(); await wait(30); };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const rec = (zone, name, type) => (N.zone(zone) || { records: [] }).records.find(r => r.name.toLowerCase() === name.toLowerCase() && r.type === type);
  const resultText = win => win.el.querySelector('.mmc-result').textContent;
  const labels = mmc => mmc.list ? mmc.list.rows().map(r => r.label || r.name) : [];
  async function wizardNext(w, n = 1) { for (let i = 0; i < n; i++) await click('Next >', w.el); }
  try {
    await wait(250);
    const win0 = WS.apps.launch('dnsmgmt');
    t('DNS Manager is a registered console', win0.app === 'dnsmgmt' && !!win0.dnsmgmt.mmc);
    win0.dnsmgmt.mmc.select('srv'); await wait(30);
    t('server without the role reports that it cannot be contacted', resultText(win0).includes('The RPC server is unavailable'));
    t('server without the role offers Server Manager', !!button('Open Server Manager', win0.el));
    if (stop('down')) return;
    win0.close();

    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.net.setDnsServers('Ethernet', ['127.0.0.1']);
    WS.features.install(['DNS'], { includeManagementTools: true });
    await wait(60);
    t('DNS role installs with its service running', N.isInstalled() && WS.svc.isRunning('DNS'));
    t('DNS Server log records the service start (events 2 and 4)', [2, 4].every(id => WS.evt.list('DNS Server').some(e => e.id === id)));
    const sm = WS.sm.open('dashboard');
    [...sm.el.querySelectorAll('.sm-menu')].find(x => x.textContent === 'Tools').click(); await wait(30);
    t('Server Manager Tools lists DNS', [...document.querySelectorAll('#dialogs .menu-item')].some(x => x.textContent.trim() === 'DNS'));
    WS.ui.closeMenu(); sm.close();

    const win = WS.apps.launch('dnsmgmt'), c = win.dnsmgmt, mmc = c.mmc;
    t('root lists this server', mmc.list.rows().some(r => r.name === WS.sys.name));
    mmc.select('srv'); await wait(30);
    t('server shows the standard folders', ['Forward Lookup Zones', 'Reverse Lookup Zones', 'Trust Points', 'Conditional Forwarders', 'Global Logs'].every(n => labels(mmc).includes(n)), labels(mmc));
    mmc.selectPath(['dns', 'srv', 'flz']); await wait(30);
    t('a new DNS server has no forward lookup zones', mmc.list.rows().length === 0);

    // New Zone Wizard: a standard primary forward zone on a workgroup server
    let wz;
    D.newZone({ onCreate: w => { wz = w; } }); await wait(60);
    t('New Zone Wizard opens on its welcome page', wz.page.id === 'welcome' && wz.el.textContent.includes('Welcome to the New Zone Wizard'));
    await wizardNext(wz);
    t('Zone Type page; AD storage unavailable off a domain controller', wz.page.id === 'type' && input('ad').disabled && !input('ad').checked);
    choose('type:secondary'); await wizardNext(wz);
    t('a secondary zone is refused for lack of a master server', shade().textContent.includes('no other DNS server'));
    await click('OK'); choose('type:primary'); await wizardNext(wz);
    t('replication page is skipped; Forward or Reverse page is shown', wz.page.id === 'direction');
    await wizardNext(wz);
    t('Zone Name page keeps Next disabled until a name is typed', wz.page.id === 'name' && button('Next >', wz.el).disabled);
    fill('zoneName', 'contoso.com');
    t('typing a zone name enables Next', !button('Next >', wz.el).disabled);
    await wizardNext(wz);
    t('Zone File page proposes <zone>.dns', wz.page.id === 'file' && input('file').value === 'contoso.com.dns');
    await wizardNext(wz);
    t('secure updates need AD; default is no dynamic updates', input('dynamic:Secure').disabled && input('dynamic:None').checked);
    await wizardNext(wz);
    t('summary shows the zone type and file', wz.page.id === 'complete' && wz.el.textContent.includes('Standard Primary') && wz.el.textContent.includes('contoso.com.dns'));
    if (stop('wizard')) return;
    await click('Finish', wz.el);
    const z = N.zone('contoso.com');
    t('Finish creates a standard primary zone', z && !z.adIntegrated && z.dynamicUpdate === 'None' && z.file === 'contoso.com.dns');
    t('the zone file is written to %SystemRoot%\\System32\\dns', WS.fs.readFile('C:\\Windows\\System32\\dns\\contoso.com.dns').includes('Database file contoso.com.dns for contoso.com zone.'));
    t('zone creation is logged (event 770)', WS.evt.list('DNS Server').some(e => e.id === 770 && e.message.includes('contoso.com')));
    await wait(80);
    t('the new zone appears in the open console', mmc.current().id === 'flz' && mmc.list.rows().some(r => r.name === 'contoso.com'));
    c.locate('contoso.com'); await wait(40);
    t('zone apex shows SOA and NS as (same as parent folder)', mmc.list.rows().filter(r => r.label === '(same as parent folder)').map(r => r.rec.type).sort().join() === 'NS,SOA');
    t('SOA data uses DNS Manager format', resultText(win).includes(`[${z.serial}], ${WS.sys.fqdn().toLowerCase()}.`));

    // New Host
    let hf;
    D.newHost('contoso.com', '', { onCreate: f => { hf = f; } }); await wait(40);
    fill('name', 'www');
    t('FQDN follows the host name', hf.body.querySelector('input[readonly]').value === 'www.contoso.com.');
    fill('ip', '192.168.1.20'); fill('ptr', true);
    await click('Add Host', hf.box);
    t('missing reverse zone gives the PTR warning', shade().textContent.includes('associated pointer (PTR) record cannot be created'));
    await click('OK');
    t('the host is still created', rec('contoso.com', 'www', 'A') && rec('contoso.com', 'www', 'A').data === '192.168.1.20');
    t('Cancel becomes Done after a host is added', !!button('Done', hf.box));
    fill('name', 'www'); fill('ip', '192.168.1.20'); await click('Add Host', hf.box);
    t('a duplicate host is rejected', shade() !== hf.shade && shade().textContent.includes('already exists'));
    await click('OK');
    fill('name', 'app'); fill('ip', '300.1.1.1'); await click('Add Host', hf.box);
    t('an invalid IP address is rejected', shade().textContent.includes('is not valid'));
    await click('OK'); fill('ip', '192.168.1.21'); fill('ptr', false); await click('Add Host', hf.box);
    t('success message names the host record', shade().textContent.includes('The host record app.contoso.com was successfully created.'));
    await click('OK'); await click('Done', hf.box);

    // A reverse lookup zone from the Reverse Lookup Zones folder (no Forward/Reverse page)
    D.newZone({ reverse: true, onCreate: w => { wz = w; } }); await wait(50);
    await wizardNext(wz, 2);
    t('reverse wizard asks IPv4 or IPv6', wz.page.id === 'family');
    await wizardNext(wz);
    fill('networkId', '192.168.1');
    t('zone name follows the network ID', input('reverseName').value === '1.168.192.in-addr.arpa');
    await wizardNext(wz, 3);
    t('reverse summary says Reverse', wz.el.textContent.includes('Reverse') && wz.el.textContent.includes('1.168.192.in-addr.arpa'));
    await click('Finish', wz.el);
    t('reverse lookup zone created', N.zone('1.168.192.in-addr.arpa') && N.zone('1.168.192.in-addr.arpa').reverse);
    await wait(60); mmc.selectPath(['dns', 'srv', 'rlz']); await wait(30);
    t('it is listed under Reverse Lookup Zones', mmc.list.rows().some(r => r.name === '1.168.192.in-addr.arpa'));
    D.newHost('contoso.com', '', { onCreate: f => { hf = f; } }); await wait(40);
    fill('name', 'mail'); fill('ip', '192.168.1.25'); fill('ptr', true); await click('Add Host', hf.box);
    t('PTR created with the host once the reverse zone exists', shade().textContent.includes('successfully created') && rec('1.168.192.in-addr.arpa', '25', 'PTR').data === 'mail.contoso.com.');
    await click('OK'); await click('Done', hf.box);

    // Other record types
    let rf;
    const record = async (type, values, zone = 'contoso.com', rel = '') => {
      D.newRecord(type, zone, rel, { onCreate: f => { rf = f; } }); await wait(40);
      for (const [k, v] of Object.entries(values)) fill(k, v);
      await click('OK', rf.box);
    };
    await record('CNAME', { name: 'intranet', target: 'www.contoso.com' });
    t('New Alias creates a CNAME', rec('contoso.com', 'intranet', 'CNAME').data === 'www.contoso.com.');
    await record('CNAME', { name: 'www', target: 'app.contoso.com' });
    t('an alias cannot share a name with a host', shade().textContent.includes('CNAME record cannot be created'));
    await click('OK'); await click('Cancel', rf.box);
    await record('MX', { mailServer: 'mail.contoso.com', preference: 10 });
    t('New Mail Exchanger creates an apex MX', rec('contoso.com', '@', 'MX') && rec('contoso.com', '@', 'MX').preference === 10);
    await record('TXT', { text: 'v=spf1 mx -all' });
    t('a TXT record is created', rec('contoso.com', '@', 'TXT').data === 'v=spf1 mx -all');
    let rt, rtApi;
    D.otherRecords('contoso.com', '', { onCreate: (f, api) => { rt = f; rtApi = api; }, inner: { onCreate: f => { rf = f; } } }); await wait(40);
    t('Resource Record Type lists the record types', rt.body.textContent.includes('Service Location (SRV)') && !rt.body.textContent.includes('Pointer (PTR)'));
    rtApi.select('SRV'); await wait(20);
    t('choosing a type shows its description', rt.body.textContent.includes('RFC 2052'));
    rtApi.create(); await wait(40);
    fill('service', '_http'); fill('protocol', '_tcp'); fill('port', 80); fill('host', 'www.contoso.com'); await click('OK', rf.box);
    t('an SRV record is created through Other New Records', rec('contoso.com', '_http._tcp', 'SRV') && rec('contoso.com', '_http._tcp', 'SRV').port === 80);
    await click('Done', rt.box);
    await record('PTR', { ip: '192.168.1.30', host: 'printer.contoso.com' }, '1.168.192.in-addr.arpa');
    t('a PTR record is created in the reverse zone', rec('1.168.192.in-addr.arpa', '30', 'PTR').data === 'printer.contoso.com.');
    await wait(60);
    t('the SRV record makes a _tcp folder', D.childFolders(N.zone('contoso.com'), '').some(f => f.label === '_tcp'));
    c.locate('contoso.com', '_tcp'); await wait(40);
    t('the folder holds the _http record', mmc.list.rows().some(r => r.label === '_http' && r.rec.type === 'SRV') && mmc.current().id === 'f:contoso.com|_tcp');
    c.locate('contoso.com'); await wait(30);
    t('zone view lists folders before records', mmc.list.rows()[0].kind === 'folder');
    if (stop('records')) return;

    // The model behind the console is the one name resolution and PowerShell use
    t('the server resolves its new host', WS.net.resolve('www.contoso.com').ip === '192.168.1.20');
    t('the alias resolves through the CNAME', WS.net.resolve('intranet.contoso.com').ip === '192.168.1.20');
    const io = new WS.term.TextConsole(), ps = new WS.ps.Session({ console: io });
    const cap = [];
    await ps.execute('Get-DnsServerResourceRecord -ZoneName contoso.com', { capture: cap });
    t('Get-DnsServerResourceRecord sees console records', cap.some(o => o.HostName === 'intranet' && o.RecordType === 'CNAME'));
    await ps.execute('Add-DnsServerResourceRecordA -ZoneName contoso.com -Name ps1 -IPv4Address 192.168.1.40');
    await wait(100);
    t('a record added in PowerShell appears in the open console', mmc.list.rows().some(r => r.label === 'ps1'));

    // Record properties
    let sheet;
    D.recordProperties('contoso.com', rec('contoso.com', 'www', 'A'), { onCreate: s => { sheet = s; } }); await wait(40);
    t('record name is read-only in Properties', input('name').disabled && input('name').value === 'www');
    fill('ip', '192.168.1.999'); await click('OK');
    t('an invalid address keeps the sheet open and the record unchanged', shade().textContent.includes('not valid') && rec('contoso.com', 'www', 'A').data === '192.168.1.20');
    await click('OK'); fill('ip', '192.168.1.22'); fill('ptr', true); await click('OK');
    t('Properties changes the address', rec('contoso.com', 'www', 'A').data === '192.168.1.22' && !rec('contoso.com', 'www', 'A').createPtr);
    t('Update associated pointer creates the PTR', rec('1.168.192.in-addr.arpa', '22', 'PTR').data === 'www.contoso.com.');
    D.recordProperties('contoso.com', rec('contoso.com', 'mail', 'A'), { onCreate: s => { sheet = s; } }); await wait(40);
    t('PTR box starts checked when a PTR exists', input('ptr').checked);
    fill('ip', '192.168.1.26'); await click('OK');
    t('moving a host moves its PTR', !rec('1.168.192.in-addr.arpa', '25', 'PTR') && rec('1.168.192.in-addr.arpa', '26', 'PTR').data === 'mail.contoso.com.');
    D.recordProperties('contoso.com', rec('contoso.com', '@', 'MX'), { onCreate: s => { sheet = s; } }); await wait(40);
    fill('preference', 20); await click('Apply');
    t('MX priority edits through Properties', rec('contoso.com', '@', 'MX').preference === 20);
    await click('Cancel');

    // Delete
    const mailRow = () => mmc.list.rows().find(r => r.label === 'mail' && r.rec.type === 'A');
    let deleting = D.deleteRows('contoso.com', '', [mailRow()]); await wait(40);
    t('delete asks with the record name and a PTR option', shade().textContent.includes('Do you want to delete the record mail from the server?') && input('deletePtr').checked);
    if (stop('delete')) return;
    await click('No'); await deleting;
    t('No keeps the record', !!rec('contoso.com', 'mail', 'A'));
    deleting = D.deleteRows('contoso.com', '', [mailRow()]); await wait(40); await click('Yes'); await deleting;
    t('Yes deletes the host and its PTR', !rec('contoso.com', 'mail', 'A') && !rec('1.168.192.in-addr.arpa', '26', 'PTR'));
    deleting = D.deleteRows('contoso.com', '', mmc.list.rows().filter(r => r.rec && r.rec.type === 'SOA')); await wait(40);
    t('the SOA record cannot be deleted', shade().textContent.includes('cannot be deleted'));
    await click('OK'); await deleting;

    // Zone properties
    D.zoneProperties('contoso.com', { onCreate: s => { sheet = s; } }); await wait(40);
    t('General tab shows type and file', shade().textContent.includes('Standard Primary') && input('file').value === 'contoso.com.dns');
    t('a file-backed zone cannot offer secure-only updates', ![...input('dynamicUpdate').options].some(o => o.value === 'Secure'));
    fill('dynamicUpdate', 'NonsecureAndSecure'); await wait(60);
    t('nonsecure updates raise the security warning', shade().textContent.includes('significant security vulnerability'));
    await click('No');
    t('No puts the setting back', input('dynamicUpdate').value === 'None');
    fill('dynamicUpdate', 'NonsecureAndSecure'); await wait(60); await click('Yes');
    if (stop('zoneprops')) return;
    await click('Apply');
    t('Apply sets nonsecure and secure updates', N.zone('contoso.com').dynamicUpdate === 'NonsecureAndSecure');
    await click('Pause');
    t('Pause pauses the zone', N.zone('contoso.com').paused && shade().textContent.includes('Paused'));
    t('a paused zone does not answer for its names', !N.query('www.contoso.com', 'A').authoritative);
    await click('Start');
    t('Start resumes it', !N.zone('contoso.com').paused);
    await tab('Start of Authority (SOA)');
    const serial = N.zone('contoso.com').serial;
    t('SOA tab shows refresh as 15 minutes', input('refresh').value === '15' && input('refreshUnit').value === 'minutes');
    fill('refresh', 30); await click('Increment'); await click('Apply');
    t('SOA edits apply and the serial increases', N.zone('contoso.com').records.find(r => r.type === 'SOA').data.refresh === 1800 && N.zone('contoso.com').serial > serial);
    await tab('Name Servers');
    t('Name Servers lists this server', shade().textContent.includes(WS.sys.fqdn().toLowerCase() + '.'));
    await tab('Zone Transfers');
    t('standard zones allow transfers to name servers by default', input('allowTransfers').checked && input('xfer:NameServers').checked);
    fill('allowTransfers', false); await click('OK');
    t('clearing Allow zone transfers turns them off', N.zoneInfo(N.zone('contoso.com')).transfers === 'None');

    // Zone file: Update Server Data File and Reload
    const zoneItem = label => mmc.scopeMenu(mmc.tree.node('z:contoso.com')).find(x => WS.ui.plain(x.label || '') === label);
    zoneItem('Update Server Data File').action(); await wait(20);
    t('Update Server Data File writes the records', /^www\s+A\s+192\.168\.1\.22/m.test(WS.fs.readFile('C:\\Windows\\System32\\dns\\contoso.com.dns')));
    N.addRecord('contoso.com', { name: 'temp', type: 'A', data: '192.168.1.99' });
    zoneItem('Reload').action(); await wait(40);
    t('Reload warns about unsaved changes', shade().textContent.includes('will be lost'));
    await click('Yes'); await wait(30);
    t('Reload restores the zone from its file', !rec('contoso.com', 'temp', 'A') && rec('contoso.com', 'www', 'A') && rec('contoso.com', '_http._tcp', 'SRV'));

    // Server properties: forwarders, event logging, monitoring
    D.serverProperties({ tab: 'Forwarders', onCreate: s => { sheet = s; } }); await wait(40);
    await click('Edit...'); await wait(30);
    t('Edit Forwarders opens', shade().textContent.includes('IP addresses of forwarding servers'));
    fill('addIp', '8.8.8.8'); input('addIp').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(20);
    fill('addIp', '10.9.9.9'); input('addIp').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(20);
    t('a reachable forwarder validates OK', shade().querySelector('.dns-iplist').textContent.includes('dns.google') && shade().querySelector('.dns-iplist').textContent.includes('OK'));
    t('an unreachable forwarder times out', shade().textContent.includes('A timeout occurred during validation.'));
    t('Enter in the address line adds instead of closing', shade().textContent.includes('Edit Forwarders'));
    if (stop('forwarders')) return;
    await click('OK');
    t('the Forwarders tab shows the new list as a draft', shade().textContent.includes('10.9.9.9') && N.forwarders().length === 0);
    fill('useRootHints', false); await click('Apply');
    t('Apply saves the forwarders and root hints setting', N.forwarders().join() === '8.8.8.8,10.9.9.9' && !N.useRootHints());
    await tab('Root Hints');
    t('Root Hints lists the 13 root servers', shade().querySelectorAll('.dns-roots .lv-row').length === 13);
    await tab('Event Logging'); choose('evlog:Errors'); await click('Apply');
    t('Event Logging level applies', N.eventLogging() === 'Errors');
    const before = WS.evt.list('DNS Server').length;
    WS.svc.restart('DNS');
    t('Errors only suppresses informational DNS events', WS.evt.list('DNS Server').length === before);
    choose('evlog:All'); await click('Apply');
    await tab('Monitoring'); fill('simple', true); fill('recursive', true); await click('Test Now');
    t('Monitoring Test Now passes simple and recursive queries', sheet.tabs[5].api.results.el.textContent.includes('PassPass'), sheet.tabs[5].api.results.el.textContent);
    if (stop('server')) return;
    await click('OK');

    // Conditional forwarders win over the server forwarders
    t('www.example.com resolves through the forwarders', WS.net.resolve('www.example.com').ok);
    let cfApi;
    D.newConditionalForwarder({ onCreate: (f, api) => { cfApi = api; } }); await wait(40);
    fill('domain', 'example.com'); await cfApi.add('10.9.9.9'); await click('OK');
    t('New Conditional Forwarder saves through the model', N.conditionalForwarder('example.com') && N.conditionalForwarder('example.com').masters.join() === '10.9.9.9');
    t('a dead conditional forwarder stops resolution for its domain', !WS.net.resolve('www.example.com').ok);
    t('other names still use the server forwarders', WS.net.resolve('www.bing.com').ok);
    D.newConditionalForwarder({ onCreate: (f, api) => { cfApi = api; } }); await wait(40);
    fill('domain', 'example.com'); await cfApi.add('192.168.1.1'); await click('OK');
    t('a duplicate conditional forwarder is refused', shade().textContent.includes('already exists'));
    await click('OK'); await click('Cancel');
    D.conditionalForwarderProperties('example.com', { onCreate: s => { sheet = s; } }); await wait(40);
    fill('addIp', '192.168.1.1'); input('addIp').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(20);
    await click('OK');
    t('fixing the master server restores resolution', N.conditionalForwarder('example.com').masters.includes('192.168.1.1') && WS.net.resolve('www.example.com').ok);
    await wait(60); mmc.selectPath(['dns', 'srv', 'cf']); await wait(30);
    t('Conditional Forwarders lists the domain', mmc.list.rows().some(r => r.name === 'example.com'));

    // Stopping the DNS Server service
    WS.svc.stop('DNS'); await wait(80);
    mmc.select('srv'); await wait(30);
    t('a stopped DNS service shows the RPC error', resultText(win).includes('could not be contacted') && !mmc.tree.node('flz'));
    t('stopping is logged (event 3)', WS.evt.list('DNS Server')[0].id === 3);
    t('stopped server cannot resolve names', !WS.net.resolve('www.contoso.com').ok);
    await click('Start', win.el); await wait(900);
    t('Start from the console restarts the service', WS.svc.isRunning('DNS') && !!mmc.tree.node('flz'));
    mmc.selectPath(['dns', 'srv', 'logs', 'dnsevents']); await wait(40);
    t('DNS Events shows the DNS Server log newest first', mmc.list.rows().length === WS.evt.list('DNS Server').length && mmc.list.rows()[0].record === WS.evt.list('DNS Server')[0].record);

    // Promotion: AD-integrated zones and their folders
    WS.state.system.adminPassword = 'ForestP@ss2025!';
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true }); WS.sys.onBoot();
    const promoted = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'RestoreP@ss2025!', noReboot: true });
    WS.sys.onBoot(); await wait(150);
    t('promotion succeeds', promoted.ok, promoted);
    const ad = N.zone('contoso.local');
    t('domain zone is AD-integrated with secure updates', ad && ad.adIntegrated && ad.dynamicUpdate === 'Secure' && ad.replication === 'Domain');
    const folders = D.childFolders(ad, '').map(f => f.label);
    t('domain zone shows the DC folders', ['_msdcs', '_sites', '_tcp', '_udp', 'DomainDnsZones', 'ForestDnsZones'].every(n => folders.includes(n)), folders);
    t('_msdcs is a delegation', D.childFolders(ad, '').find(f => f.label === '_msdcs').delegation);
    t('DomainDnsZones holds its own A record as (same as parent folder)', D.recordsAt(ad, 'DomainDnsZones').some(r => r.label === '(same as parent folder)' && r.rec.type === 'A'));
    t('site folders keep their registered case', D.childFolders(ad, '_sites').some(f => f.label === 'Default-First-Site-Name'));
    c.locate('contoso.local', '_tcp'); await wait(40);
    t('the _tcp folder lists the DC SRV records', ['_gc', '_kerberos', '_kpasswd', '_ldap'].every(n => mmc.list.rows().some(r => r.label === n)));
    c.locate('contoso.local'); await wait(30);
    if (stop('ad')) return;
    t('AD zone transfers are off by default', N.zoneInfo(ad).transfers === 'None');

    D.newZone({ onCreate: w => { wz = w; } }); await wait(50);
    await wizardNext(wz);
    t('AD storage is checked by default on a DC', !input('ad').disabled && input('ad').checked);
    await wizardNext(wz);
    t('the replication scope page appears for AD zones', wz.page.id === 'replication' && input('rep:Domain').checked);
    choose('rep:Forest'); await wizardNext(wz, 2);
    fill('zoneName', 'fabrikam.local'); await wizardNext(wz);
    t('Zone File is skipped and secure updates are the default', wz.page.id === 'dynamic' && !input('dynamic:Secure').disabled && input('dynamic:Secure').checked);
    await wizardNext(wz); await click('Finish', wz.el);
    const fab = N.zone('fabrikam.local');
    t('Finish creates a forest-replicated AD zone', fab && fab.adIntegrated && fab.replication === 'Forest' && fab.dynamicUpdate === 'Secure' && !fab.file);
    D.changeZoneType('fabrikam.local'); await wait(40);
    fill('ad', false); await click('OK'); await wait(30);
    t('converting to a file-backed zone asks first', shade().textContent.includes('zone file instead of Active Directory'));
    await click('Yes'); await wait(30);
    t('the zone becomes a standard primary with a file', !N.zone('fabrikam.local').adIntegrated && N.zone('fabrikam.local').dynamicUpdate === 'None' && WS.fs.exists('C:\\Windows\\System32\\dns\\fabrikam.local.dns'));
    deleting = D.deleteZone('fabrikam.local'); await wait(30); await click('Yes'); await deleting;
    t('Delete removes a standard zone after one prompt', !N.zone('fabrikam.local'));
    N.createZone({ name: 'adtemp.local', adIntegrated: true });
    deleting = D.deleteZone('adtemp.local'); await wait(30); await click('Yes'); await wait(30);
    t('an AD-integrated zone asks a second time', shade().textContent.includes('stored in Active Directory'));
    await click('Yes'); await deleting;
    t('the AD zone is deleted', !N.zone('adtemp.local'));

    D.newDomain('contoso.local', ''); await wait(30); fill('domain', 'branch'); await click('OK');
    t('New Domain adds an empty folder', D.childFolders(N.zone('contoso.local'), '').some(f => f.label === 'branch'));
    D.newHost('contoso.local', 'branch', { onCreate: f => { hf = f; } }); await wait(40);
    fill('name', 'fs1');
    t('a host in a sub-domain gets the sub-domain FQDN', hf.body.querySelector('input[readonly]').value === 'fs1.branch.contoso.local.');
    fill('ip', '192.168.1.70'); await click('Add Host', hf.box); await click('OK'); await click('Done', hf.box);
    t('the host is stored under the sub-domain', !!rec('contoso.local', 'fs1.branch', 'A') && WS.net.resolve('fs1.branch.contoso.local').ip === '192.168.1.70');
    deleting = D.deleteRows('contoso.local', '', [{ kind: 'folder', rel: 'branch', label: 'branch' }]); await wait(30);
    t('deleting a domain warns about its records', shade().textContent.includes('all of the records it contains'));
    await click('Yes'); await deleting;
    t('the domain and its records are gone', !rec('contoso.local', 'fs1.branch', 'A') && !D.childFolders(N.zone('contoso.local'), '').some(f => f.label === 'branch'));
    D.newDelegation('contoso.local', '', { onCreate: w => { wz = w; } }); await wait(40);
    await wizardNext(wz); fill('delegated', 'lab'); await wizardNext(wz);
    await wz.data.addServer('ns1.lab.contoso.local', '192.168.1.60'); await wizardNext(wz); await click('Finish', wz.el);
    t('New Delegation adds NS and glue records', rec('contoso.local', 'lab', 'NS').data === 'ns1.lab.contoso.local.' && rec('contoso.local', 'ns1.lab', 'A').data === '192.168.1.60');
    t('the delegation shows as a delegation folder', D.childFolders(N.zone('contoso.local'), '').find(f => f.label === 'lab').delegation);

    // dnscmd works on the same zones
    const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
    const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.text(); };
    let out = await crun('dnscmd /enumzones');
    t('dnscmd /enumzones lists the AD zones', cmd.lastExit === 0 && /contoso\.local\s+Primary\s+AD-Domain\s+Secure/.test(out) && out.includes('Command completed successfully.'), out);
    out = await crun('dnscmd . /recordadd contoso.local printer A 192.168.1.80');
    t('dnscmd /recordadd adds a record', cmd.lastExit === 0 && out.includes('Add A Record for printer.contoso.local at contoso.local') && rec('contoso.local', 'printer', 'A').data === '192.168.1.80', out);
    out = await crun('dnscmd /zoneadd contoso.local /dsprimary');
    t('dnscmd reports an existing zone the way the server does', cmd.lastExit === 1 && out.includes('DNS_ERROR_ZONE_ALREADY_EXISTS') && out.includes('9609'), out);
    out = await crun('dnscmd /zoneprint contoso.local');
    t('dnscmd /zoneprint prints the records', /printer\s+A\s+192\.168\.1\.80/.test(out), out.slice(0, 400));
    out = await crun('dnscmd /recorddelete contoso.local printer A 192.168.1.80 /f');
    t('dnscmd /recorddelete removes it', cmd.lastExit === 0 && !rec('contoso.local', 'printer', 'A'), out);

    // Advanced view and nslookup
    c.setAdvanced(true);
    D.recordProperties('contoso.local', rec('contoso.local', WS.sys.name, 'A'), { advanced: true }); await wait(40);
    t('Advanced view adds the TTL to record properties', !!input('ttl0') && shade().textContent.includes('DDDDD:HH.MM.SS'));
    await click('Cancel');
    const term = D.launchNslookup(); await wait(500);
    t('Launch nslookup opens Command Prompt in nslookup', term && term.terminal && term.terminal.active.console.el.textContent.includes('Default Server:'));
    term.close();
    ps.exited = true; win.close();
    t('console closes cleanly', !win.el.isConnected);
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
