/* Model-layer smoke test. Open tests/model-test.html?quick=1 in a throwaway browser profile (it rewrites
 * the lab state in localStorage). Each result is a console line: PASS / FAIL / RESULT. */
(function () {
  const WS = window.WS;
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? ' :: ' + JSON.stringify(extra) : '')); };
  const boot = () => { WS.sys.onShutdown(true); WS.sys.onBoot(); };
  try {
    // ---------- network defaults
    const a = WS.net.adapter();
    t('dhcp address in router range', a.dhcp && WS.util.inSubnet(a.ip, '192.168.1.0', 24) && +a.ip.split('.')[3] >= 100, a);
    t('resolve internet via router', WS.net.resolve('www.bing.com').ok);
    t('ping 8.8.8.8 ok', WS.net.ping('8.8.8.8').ok);
    t('ping microsoft.com times out', !WS.net.ping('microsoft.com').ok && WS.net.ping('microsoft.com').lines[0].text === 'Request timed out.');
    t('ping unknown LAN host unreachable', /Destination host unreachable/.test(WS.net.ping('192.168.1.77').lines[0].text));
    t('ping bad name', /could not find host/.test(WS.net.ping('nosuchhost.example').error || ''));
    t('llmnr client01', WS.net.resolve('client01').source === 'llmnr');

    // ---------- static IP
    t('reject network address', !WS.net.setStatic('Ethernet', { ip: '192.168.1.0', prefix: 24 }).ok);
    const st = WS.net.setStatic('Ethernet', { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' });
    t('set static', st.ok && !a.dhcp && a.ip === '192.168.1.10', st);
    t('gateway warning', WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '10.0.0.1' }).warnings.length === 1);
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.net.setDnsServers('Ethernet', ['127.0.0.1']);
    t('no DNS role -> resolution times out', WS.net.resolve('www.bing.com').error === 'timeout');
    t('lab check adapter[0] path', WS.labs.evalCheck({ path: 'network.adapters[0].ip', equals: '192.168.1.10' }, WS.state));
    t('lab helper adapter', WS.labs.evalCheck({ adapter: { static: true, ip: '192.168.1.10', gateway: '192.168.1.1', dns: ['127.0.0.1'] } }, WS.state));

    // ---------- features + DNS
    const req = WS.features.requiredFor('DNS').map(f => f.id);
    t('DNS requires RSAT-DNS-Server', req.includes('RSAT-DNS-Server'), req);
    const fi = WS.features.install(['DNS'], { includeManagementTools: true });
    t('install DNS', fi.ok && fi.exitCode === 'Success' && WS.features.isInstalled('RSAT-DNS-Server'), fi);
    t('DNS service running', WS.svc.isRunning('DNS'));
    t('DNS firewall rules', WS.fw.find('DNS (UDP, Incoming)').length === 1);
    t('root hints resolve', WS.net.resolve('www.bing.com').ok);
    t('reinstall no change', WS.features.install(['DNS']).exitCode === 'NoChangeNeeded');
    t('bad feature name', !WS.features.install(['Nope']).ok);
    const z = WS.dns.createZone({ name: 'lab.local' });
    t('create zone', z.ok, z);
    t('dup zone', !WS.dns.createZone({ name: 'lab.local' }).ok);
    t('add A', WS.dns.addRecord('lab.local', { name: 'www', type: 'A', data: '192.168.1.20' }).ok);
    const ptrW = WS.dns.addRecord('lab.local', { name: 'app', type: 'A', data: '192.168.1.21', createPtr: true });
    t('PTR warning without reverse zone', ptrW.ok && /reverse lookup zone/.test(ptrW.warning || ''));
    t('reverse zone', WS.dns.createZone({ networkId: '192.168.1.0/24' }).ok && !!WS.dns.zone('1.168.192.in-addr.arpa'));
    t('ptr created', WS.dns.addRecord('lab.local', { name: 'db', type: 'A', data: '192.168.1.22', createPtr: true }).warning === null);
    t('reverse lookup', WS.net.reverse('192.168.1.22') === 'db.lab.local');
    t('CNAME conflict', !WS.dns.addRecord('lab.local', { name: 'www', type: 'CNAME', data: 'db.lab.local' }).ok);
    WS.dns.addRecord('lab.local', { name: 'intranet', type: 'CNAME', data: 'www.lab.local' });
    const r = WS.net.resolve('intranet.lab.local');
    t('resolve via CNAME', r.ok && r.ip === '192.168.1.20', r);
    t('nxdomain', WS.net.resolve('nope.lab.local').error === 'notfound');
    t('lab helper dnsRecord', WS.labs.evalCheck({ dnsRecord: { zone: 'lab.local', name: 'www', type: 'A', data: '192.168.1.20' } }, WS.state));
    WS.svc.stop('DNS');
    t('stopped DNS -> timeout', WS.net.resolve('www.lab.local').error === 'timeout');
    WS.svc.start('DNS');

    // ---------- services
    t('stop RpcSs refused', !WS.svc.stop('RpcSs').ok);
    WS.svc.setStartup('Spooler', 'Disabled');
    WS.svc.stop('Spooler');
    const sp = WS.svc.start('Spooler');
    t('disabled cannot start', !sp.ok && sp.code === 1058, sp);
    t('7040 logged', WS.evt.list('System', { id: 7040 }).length > 0);
    t('lab helper service', WS.labs.evalCheck({ service: { name: 'spooler', status: 'Stopped', startup: 'Disabled' } }, WS.state));

    // ---------- AD DS
    t('promotion blocked without role', WS.ad.prereqCheck({ domainName: 'contoso.local', safeModePassword: 'P@ssw0rd!' }).errors.length > 0);
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
    t('adds post task', WS.features.postTasks().some(x => x.id === 'adds'));
    t('single label rejected', !!WS.ad.validateDomainName('contoso'));
    const pc = WS.ad.prereqCheck({ domainName: 'contoso.local', safeModePassword: 'P@ssw0rd!' });
    t('prereq ok', pc.errors.length === 0, pc.errors);
    const inst = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'P@ssw0rd!', noReboot: true });
    t('installForest', inst.ok, inst);
    boot();
    t('is DC', WS.sys.isDC() && WS.state.system.domain === 'contoso.local' && WS.sys.netbiosDomain() === 'CONTOSO');
    t('NTDS running', WS.svc.isRunning('NTDS') && WS.svc.isRunning('Netlogon'));
    const s1 = WS.svc.stop('LanmanWorkstation');
    t('stop with dependents fails', !s1.ok && s1.code === 'ServiceHasDependentServices', s1);
    const s2 = WS.svc.stop('LanmanWorkstation', { force: true });
    t('force stops dependents', s2.ok && !WS.svc.isRunning('Netlogon'), s2);
    WS.svc.start('Netlogon');
    t('start pulls dependency up', WS.svc.isRunning('LanmanWorkstation'));
    t('domain DN', WS.ad.domainDN() === 'DC=contoso,DC=local');
    const admins = WS.ad.members('Administrators').map(o => o.name).sort();
    t('Administrators members', admins.join(',') === 'Administrator,Domain Admins,Enterprise Admins', admins);
    t('Domain Users includes Administrator (primary)', WS.ad.members('Domain Users').some(o => o.name === 'Administrator'));
    t('DC computer in Domain Controllers OU', WS.ad.dn(WS.ad.get(WS.sys.name, 'computer')) === `CN=${WS.sys.name},OU=Domain Controllers,DC=contoso,DC=local`);
    t('resolve DC fqdn', WS.net.resolve(WS.sys.fqdn()).ok);
    t('resolve domain apex', WS.net.resolve('contoso.local').ip === '192.168.1.10', WS.net.resolve('contoso.local'));
    t('SRV _ldap._tcp', WS.dns.query('_ldap._tcp.contoso.local', 'SRV').records.length === 1);
    t('SRV _msdcs dc', WS.dns.query('_ldap._tcp.dc._msdcs.contoso.local', 'SRV').records.length === 1);
    t('SYSVOL share', !!WS.smb.get('SYSVOL') && WS.fs.exists('C:\\Windows\\SYSVOL\\sysvol\\contoso.local\\SCRIPTS'));
    t('local SAM unavailable', !WS.local.createUser('bob', { password: 'P@ssw0rd1' }).ok);
    t('firewall Domain profile', WS.fw.activeProfile() === 'Domain');
    t('domain admin login', WS.ad.verify('CONTOSO\\Administrator', WS.state.system.adminPassword).ok);

    const ou = WS.ad.createOU({ name: 'Sales' });
    t('create OU', ou.ok && WS.ad.dn(ou.object) === 'OU=Sales,DC=contoso,DC=local');
    t('dup OU', WS.ad.createOU({ name: 'sales' }).code === 'Exists');
    t('nested OU path', WS.ad.createOU({ name: 'East', parent: 'Sales' }).ok && !!WS.ad.container('Sales/East'));
    const weak = WS.ad.createUser({ givenName: 'John', sn: 'Smith', sam: 'jsmith', upn: 'jsmith', parent: 'OU=Sales,DC=contoso,DC=local', password: 'short' });
    t('weak password rejected', weak.code === 'PasswordPolicy', weak);
    const u = WS.ad.createUser({ givenName: 'John', sn: 'Smith', sam: 'jsmith', upn: 'jsmith', parent: 'OU=Sales,DC=contoso,DC=local', password: 'Pa$$w0rd123' });
    t('create user', u.ok && u.object.name === 'John Smith' && u.object.upn === 'jsmith@contoso.local' && u.object.enabled, u);
    t('dup sam', WS.ad.createUser({ name: 'Other', sam: 'JSMITH', password: 'Pa$$w0rd123' }).code === 'SamExists');
    const nopw = WS.ad.createUser({ name: 'No Pw', sam: 'nopw' });
    t('no password -> disabled', nopw.ok && !nopw.object.enabled);
    t('enable without password fails', !WS.ad.setEnabled('nopw', true).ok);
    const g = WS.ad.createGroup({ name: 'Sales Staff', parent: 'Sales', scope: 'Global' });
    t('create group', g.ok);
    t('add member', WS.ad.addMember('Sales Staff', 'jsmith').ok);
    t('already member', WS.ad.addMember('Sales Staff', 'jsmith').code === 'AlreadyMember');
    const dl = WS.ad.createGroup({ name: 'Sales Share RW', parent: 'Sales', scope: 'DomainLocal' });
    t('global cannot contain domain local', WS.ad.addMember('Sales Staff', 'Sales Share RW').code === 'GroupScope');
    t('AGDLP: DL contains global', WS.ad.addMember('Sales Share RW', 'Sales Staff').ok && dl.ok);
    t('recursive members', WS.ad.members('Sales Share RW', true).some(m => m.sam === 'jsmith'));
    t('memberOf recursive', WS.ad.memberOf('jsmith', true).map(x => x.name).includes('Sales Share RW'));
    t('cannot remove primary group', WS.ad.removeMember('Domain Users', 'jsmith').code === 'PrimaryGroup');
    t('cannot add builtin group', WS.ad.addMember('Sales Share RW', 'Administrators').code === 'GroupScope');
    t('protected OU', WS.ad.remove('Sales').code === 'Protected');
    t('cannot delete Domain Admins', WS.ad.remove('Domain Admins').code === 'Critical');
    t('lab helper adUser', WS.labs.evalCheck({ adUser: { sam: 'jsmith', ou: 'Sales', enabled: true, memberOf: ['Sales Staff'] } }, WS.state));
    t('lab helper adGroup', WS.labs.evalCheck({ adGroup: { name: 'Sales Staff', scope: 'Global', members: ['jsmith'] } }, WS.state));
    t('lab helper adOU', WS.labs.evalCheck({ adOU: { name: 'East', parent: 'Sales' } }, WS.state));
    t('lab helper negative', !WS.labs.evalCheck({ adUser: { sam: 'jsmith', ou: 'East' } }, WS.state));
    t('move user', WS.ad.move('jsmith', 'Sales/East').ok && WS.labs.evalCheck({ adUser: { sam: 'jsmith', ou: 'Sales/East' } }, WS.state));
    WS.ad.setProps('Sales', { protected: false });
    t('non-leaf delete needs recursive', WS.ad.remove('Sales').code === 'NotLeaf');
    t('recursive delete blocked by protected child', WS.ad.remove('Sales', { recursive: true }).code === 'Protected');
    t('4720 audited', WS.evt.list('Security', { id: 4720 }).length >= 2);
    t('scope change Global->DomainLocal blocked', WS.ad.setGroupScope('Sales Staff', 'DomainLocal').code === 'GroupScope');

    // ---------- storage + shares
    t('disk1 offline', WS.storage.disks()[1].status === 'Offline');
    t('new volume on offline disk fails', WS.storage.newVolume(1, {}).code === 'Offline');
    WS.storage.setOnline(1, true);
    t('not initialized', WS.storage.newVolume(1, {}).code === 'NotInitialized');
    t('initialize GPT', WS.storage.initialize(1, 'GPT').ok);
    const v = WS.storage.newVolume(1, { label: 'Data' });
    t('new volume E:', v.ok && v.volume.letter === 'E' && v.volume.fs === 'NTFS', v);
    t('cannot format C', !WS.storage.format('C', {}).ok);
    t('E drive exists', WS.fs.drives().includes('E'));
    WS.fs.mkdir('E:\\Shares\\Sales');
    WS.fs.writeFile('E:\\Shares\\Sales\\readme.txt', 'hello');
    t('read file', WS.fs.readFile('e:/shares/sales/README.TXT') === 'hello');
    t('relative path', WS.fs.full('..\\Sales\\readme.txt', 'E:\\Shares\\Sales') === 'E:\\Shares\\Sales\\readme.txt');
    let code = null; try { WS.fs.remove('C:\\Windows', null, { recursive: true }); } catch (e) { code = e.code; }
    t('cannot delete Windows', code === 'AccessDenied');
    code = null; try { WS.fs.readFile('D:\\x.txt'); } catch (e) { code = e.code; }
    t('cdrom not ready', code === 'NotReady');
    t('hosts file', /localhost name resolution/.test(WS.fs.readFile('%SystemRoot%\\System32\\drivers\\etc\\hosts')));
    WS.fs.writeFile('C:\\Windows\\System32\\drivers\\etc\\hosts', '\n10.9.9.9 legacy.app', null, { append: true });
    t('hosts file resolution', WS.net.resolve('legacy.app').ip === '10.9.9.9');
    const sh = WS.smb.newShare({ name: 'Sales', path: 'E:\\Shares\\Sales', fullAccess: ['CONTOSO\\Sales Staff'] });
    t('new share', sh.ok, sh);
    t('file server installed by share', WS.features.isInstalled('FS-FileServer'));
    t('SMB firewall enabled', WS.fw.find('File and Printer Sharing (SMB-In)')[0].enabled);
    t('dup share', WS.smb.newShare({ name: 'sales', path: 'E:\\Shares' }).code === 'Exists');
    t('lab helper share', WS.labs.evalCheck({ share: { name: 'Sales', path: 'E:\\Shares\\Sales', access: [{ account: 'Sales Staff', right: 'Full' }] } }, WS.state));
    t('lab helper volume', WS.labs.evalCheck({ volume: { letter: 'E', label: 'Data', fs: 'NTFS', minSizeGB: 39 } }, WS.state));

    // ---------- DHCP
    WS.features.install(['DHCP'], { includeManagementTools: true });
    t('dhcp post task', WS.features.postTasks().some(x => x.id === 'dhcp'));
    t('complete dhcp config', WS.dhcp.completeConfiguration().ok && WS.dhcp.authorized && !!WS.ad.get('DHCP Administrators', 'group'));
    t('scope overlap invalid range', !WS.dhcp.addScope({ name: 'x', start: '192.168.1.0', end: '192.168.1.200', prefix: 24 }).ok);
    const sc = WS.dhcp.addScope({ name: 'LAN', start: '192.168.1.100', end: '192.168.1.200', mask: '255.255.255.0' });
    t('add scope', sc.ok, sc);
    WS.dhcp.addExclusion('192.168.1.0', '192.168.1.100', '192.168.1.109');
    WS.dhcp.setOption('192.168.1.0', 3, '192.168.1.1');
    WS.dhcp.setOption('192.168.1.0', 6, ['192.168.1.10']);
    WS.dhcp.setOption('192.168.1.0', 15, 'contoso.local');
    WS.state.network.lan.dhcp.enabled = false;
    WS.dhcp.refreshLeases();
    const c1 = WS.state.network.peers.find(p => p.name === 'CLIENT01');
    t('client leased from server', c1.leasedFrom === 'server' && c1.ip === '192.168.1.110', c1);
    t('client registered in DNS', WS.net.resolve('client01.contoso.local').ip === '192.168.1.110');
    t('ping client', WS.net.ping('client01').ok);
    t('reservation', WS.dhcp.addReservation('192.168.1.0', { ip: '192.168.1.150', mac: c1.mac, name: 'CLIENT01' }).ok);
    WS.dhcp.refreshLeases();
    t('reservation applied', c1.ip === '192.168.1.150');
    t('lab helper dhcpScope', WS.labs.evalCheck({ dhcpScope: { id: '192.168.1.0', active: true, exclusion: { start: '192.168.1.100', end: '192.168.1.109' }, option: { code: 6, value: ['192.168.1.10'] } } }, WS.state));
    WS.svc.stop('DHCPServer');
    WS.dhcp.refreshLeases();
    t('no dhcp server -> APIPA', /^169\.254\./.test(c1.ip));
    WS.svc.start('DHCPServer');

    // ---------- feature uninstall needs restart
    WS.features.install(['Web-Server'], { includeManagementTools: true });
    t('IIS installed with W3SVC running', WS.features.isInstalled('Web-WebServer') && WS.svc.isRunning('W3SVC'));
    const un = WS.features.uninstall(['Web-Server']);
    t('uninstall role pending restart', un.restartNeeded === 'Yes' && WS.features.installState('Web-Server') === 'UninstallPending', un);
    boot();
    t('removed after restart', !WS.features.isInstalled('Web-Server') && !WS.svc.get('W3SVC'));
    t('cannot remove AD DS on DC', !WS.features.uninstall(['AD-Domain-Services']).ok);

    // ---------- state + lab run
    const size = JSON.stringify(WS.state).length;
    t('state under 400 KB', size < 400000, size);
    console.log('INFO state bytes ' + size + ', AD objects ' + WS.state.ad.objects.length + ', events ' + Object.values(WS.state.events.logs).reduce((a, l) => a + l.length, 0));
  } catch (e) {
    fail++;
    console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | '));
  }
  setTimeout(() => { const n = [...document.querySelectorAll('.sm-nav div')].find(d => d.textContent === 'Local Server'); if (n) n.click(); }, 300);
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
