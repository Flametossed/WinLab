/* Built-in labs: each setup gives the documented starting point, no objective starts complete, and the commands
 * in the hints complete every objective, and the Undo step snapshots. Use a fresh profile (it rewrites the lab state).
 * &shot=goback (Lab Guide with Go back links) or &shot=undo (the Go back confirmation over Undo...) stops there. */
(async function () {
  'use strict';
  const WS = window.WS, L = WS.labs;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  /** WS.labs.start without the restart: rebuild the state, apply setup, then boot it the way a reload does. */
  async function begin(id) {
    const lab = L.get(id), pw = WS.state.system.adminPassword;
    const s = WS.store.createDefault();
    s.meta.oobeDone = true; s.system.adminPassword = pw;
    if (typeof lab.setup === 'function') lab.setup(s, WS); else for (const [p, v] of Object.entries((lab.setup || {}).set || {})) setPath(s, p, v);
    s.lab = { activeId: id, startedAt: new Date().toISOString(), completed: {} };
    L.snapshots.begin(s);   // as WS.labs.start does
    WS.state = s;
    WS.sys.onBoot();
    await wait(150);
    L.evaluate();
    return lab;
  }
  const setPath = (o, path, v) => { const k = path.replace(/\[(\d+)\]/g, '.$1').split('.'); k.slice(0, -1).forEach(x => { o = o[x] = o[x] || {}; }); o[k[k.length - 1]] = v; };
  const open = () => L.progress().items.filter(i => !i.done).map(i => i.id);
  async function ps(lines) {
    const io = new WS.term.TextConsole(), session = new WS.ps.Session({ console: io });
    for (const line of lines) {
      await session.execute(line);
      if (!session.lastSuccess) t('command succeeds: ' + line, false, String(io.buf || '').slice(-400));
    }
    session.exited = true;
    await wait(120);
    L.evaluate();
  }
  const shotAt = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const finished = name => { const p = L.progress(); t(name + ': every objective completes', p.doneCount === p.total, open()); };
  try {
    await wait(250);
    if (new URLSearchParams(location.search).get('shot') === 'guide') { WS.apps.launch('lab'); await wait(200); console.log('RESULT 0 passed, 0 failed'); return; }
    t('built-in labs are registered', ['lab01-initial-config', 'lab02-adds-forest', 'lab03-ad-objects', 'lab04-dns', 'lab05-dhcp', 'lab06-storage-shares', 'lab07-iis', 'lab09-services-events', 'lab11-firewall', 'lab12-file-server', 'lab13-group-policy', 'lab14-task-manager', 'lab15-hyperv', 'lab16-drive-maps', 'lab17-mount-points', 'lab18-storage-spaces'].every(id => L.get(id)));
    t('new check helpers are available', ['dnsForwarders', 'conditionalForwarder', 'dhcpFilter', 'dhcpLease', 'eventLog', 'customView', 'gpo', 'gpLink', 'gpoSetting', 'gpInheritance', 'gpoPermission', 'domainPasswordPolicy', 'gpoBackup', 'gpApplied', 'wmiFilter', 'iisSite', 'iisAppPool', 'iisDefaultDoc', 'http', 'vmSwitch', 'vm', 'vhd'].every(h => L.helpers().includes(h)));

    // Lab 01: the network objectives (the rename/workgroup/restart ones are covered by the Server Manager suite).
    await begin('lab01-initial-config');
    t('Lab 01 starts on DHCP with no objective complete', WS.net.adapter().dhcp && L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.1.10 -PrefixLength 24 -DefaultGateway 192.168.1.1']);
    t('a static address without DNS completes only the IP objective', !open().includes('ip') && open().includes('dns'), open());
    await ps(['Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses 192.168.1.1']);
    t('Lab 01 DNS objective completes', !open().includes('dns'), open());

    // Lab 02 starts from the Lab 01 result.
    await begin('lab02-adds-forest');
    t('Lab 02 starts as DC01 with a static address', WS.state.system.computerName === 'DC01' && !WS.net.adapter().dhcp && WS.net.adapter().ip === '192.168.1.10');
    t('Lab 02 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Install-WindowsFeature AD-Domain-Services -IncludeManagementTools']);
    t('Lab 02 role objective completes', !open().includes('role'));
    const r = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'Restore-P@ss2025', noReboot: true });
    t('Lab 02 promotion succeeds', r.ok, r);
    WS.sys.onBoot(); await wait(150); L.evaluate();
    finished('Lab 02');

    // Lab 03 starts on a domain controller with a contractor account.
    await begin('lab03-ad-objects');
    t('Lab 03 starts on a contoso.local domain controller', WS.sys.isDC() && WS.state.system.domain === 'contoso.local' && WS.svc.isRunning('NTDS'));
    t('Lab 03 setup created the contractor account', !!WS.ad.get('contractor1', 'user') && WS.ad.get('contractor1', 'user').enabled);
    t('Lab 03 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps([
      'New-ADOrganizationalUnit -Name Sales',
      'New-ADUser -Name "Jane Reed" -GivenName Jane -Surname Reed -SamAccountName jreed -Path "OU=Sales,DC=contoso,DC=local" -AccountPassword (ConvertTo-SecureString "LabP@ssword2025!" -AsPlainText -Force) -Enabled $true',
      'New-ADGroup "Sales Staff" -GroupScope Global -Path "OU=Sales,DC=contoso,DC=local"',
      'Add-ADGroupMember "Sales Staff" jreed',
      'New-ADOrganizationalUnit -Name Workstations',
      'New-ADComputer CLIENT01 -Path "OU=Workstations,DC=contoso,DC=local"',
      'Disable-ADAccount contractor1'
    ]);
    finished('Lab 03');

    // Lab 04 starts on the same domain controller.
    await begin('lab04-dns');
    t('Lab 04 starts with an AD-integrated contoso.local zone', WS.dns.zone('contoso.local') && WS.dns.zone('contoso.local').adIntegrated && WS.svc.isRunning('DNS'));
    t('Lab 04 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps([
      'Add-DnsServerPrimaryZone -NetworkId 192.168.1.0/24 -ReplicationScope Domain',
      'Add-DnsServerResourceRecordA -ZoneName contoso.local -Name www -IPv4Address 192.168.1.20 -CreatePtr',
      'Add-DnsServerResourceRecordCName -ZoneName contoso.local -Name intranet -HostNameAlias www.contoso.local',
      'Add-DnsServerResourceRecordA -ZoneName contoso.local -Name mail -IPv4Address 192.168.1.25',
      'Add-DnsServerResourceRecordMX -ZoneName contoso.local -Name . -MailExchange mail.contoso.local -Preference 10',
      'Add-DnsServerForwarder 8.8.8.8'
    ]);
    t('Lab 04 needs the conditional forwarder last', open().join() === 'conditional', open());
    await ps(['Add-DnsServerConditionalForwarderZone -Name fabrikam.com -MasterServers 192.168.1.1']);
    finished('Lab 04');
    const zcap = [], zps = new WS.ps.Session({ console: new WS.term.TextConsole() });
    await zps.execute('Get-DnsServerZone fabrikam.com', { capture: zcap });
    t('Get-DnsServerZone reports the conditional forwarder', zcap[0] && zcap[0].ZoneType === 'Forwarder' && zcap[0].MasterServers.join() === '192.168.1.1', zcap.map(o => o.ZoneType));
    await zps.execute('Set-DnsServerConditionalForwarderZone -Name fabrikam.com -MasterServers 192.168.1.1,8.8.8.8');
    t('Set-DnsServerConditionalForwarderZone changes the masters', WS.dns.conditionalForwarder('fabrikam.com').masters.join() === '192.168.1.1,8.8.8.8');
    await zps.execute('Remove-DnsServerZone fabrikam.com -Force');
    t('Remove-DnsServerZone removes a conditional forwarder', !WS.dns.conditionalForwarder('fabrikam.com'));
    zps.exited = true;
    t('objectives stay complete after a later change', (WS.dns.removeRecord('contoso.local', { name: 'intranet', type: 'CNAME' }), L.evaluate(), L.progress().doneCount === L.progress().total));

    // Lab 05: the router no longer hands out addresses.
    await begin('lab05-dhcp');
    t('Lab 05 starts with CLIENT01 on an APIPA address', /^169\.254\./.test(WS.state.network.peers.find(p => p.name === 'CLIENT01').ip));
    t('Lab 05 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps([
      'Install-WindowsFeature DHCP -IncludeManagementTools',
      'Add-DhcpServerInDC',
      'Add-DhcpServerv4Scope -Name "Lab LAN" -StartRange 192.168.1.100 -EndRange 192.168.1.200 -SubnetMask 255.255.255.0',
      'Add-DhcpServerv4ExclusionRange -ScopeId 192.168.1.0 -StartRange 192.168.1.100 -EndRange 192.168.1.109',
      'Set-DhcpServerv4OptionValue -ScopeId 192.168.1.0 -Router 192.168.1.1 -DnsServer 192.168.1.10 -DnsDomain contoso.local',
      'Add-DhcpServerv4Reservation -ScopeId 192.168.1.0 -IPAddress 192.168.1.150 -ClientId 00-15-5D-01-01-32 -Name CLIENT01'
    ]);
    await wait(120); L.evaluate();
    finished('Lab 05');
    t('CLIENT01 registered itself in DNS with its reserved address', WS.net.resolve('client01.contoso.local').ip === '192.168.1.150');
    t('dhcpFilter helper sees a deny filter', (WS.dhcp.addFilter('deny', '00-15-5D-01-01-32', 'test'), WS.dhcp.setFilterList({ deny: true }), L.evalCheck({ dhcpFilter: { list: 'deny', mac: '00155d010132', enabled: true } }, WS.state)));

    // Lab 06: a new offline data disk on the Lab 03 domain.
    await begin('lab06-storage-shares');
    t('Lab 06 starts with Disk 1 offline and the DVD drive on D:', WS.storage.disks()[1].status === 'Offline' && WS.storage.cdrom().letter === 'D');
    t('Lab 06 starts with the Sales Staff group', !!WS.ad.get('Sales Staff', 'group') && WS.ad.get('Sales Staff', 'group').members.length === 1);
    t('Lab 06 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Set-Disk 1 -IsOffline $false', 'Initialize-Disk 1 -PartitionStyle GPT']);
    { const tc = new WS.term.TextConsole({ inputs: ['list volume', 'select volume 0', 'assign letter=R', 'exit'] }); await new WS.term.CmdSession({ console: tc }).execute('diskpart'); await wait(60); L.evaluate(); }
    t('Lab 06 disk and DVD objectives complete', !open().includes('online') && !open().includes('dvd'), open());
    t('with the DVD drive moved, a new volume would get D:', WS.storage.nextLetter() === 'D');
    await ps([
      'New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter E | Format-Volume -FileSystem NTFS -NewFileSystemLabel Data -Confirm:$false',
      'New-Item E:\\Shares\\Sales -ItemType Directory',
      'New-SmbShare -Name Sales -Path E:\\Shares\\Sales -FullAccess Administrators -ReadAccess Everyone'
    ]);
    t('Everyone on the share keeps the share objective open', open().includes('share') && !open().includes('volume'), open());
    await ps(['Revoke-SmbShareAccess -Name Sales -AccountName Everyone -Force', 'Grant-SmbShareAccess -Name Sales -AccountName "CONTOSO\\Sales Staff" -AccessRight Change -Force', 'Set-SmbShare -Name Sales -CachingMode None -Force']);
    finished('Lab 06');
    t('the volume brought its administrative share', !!WS.smb.get('E$'));

    // Lab 09: a disabled Print Spooler, and log housekeeping.
    await begin('lab09-services-events');
    t('Lab 09 starts with Print Spooler disabled and stopped', WS.svc.get('Spooler').status === 'Stopped' && /Disabled/.test(WS.svc.get('Spooler').startup));
    t('the System log holds the 7040 start-type change to find', WS.evt.list('System', { id: 7040 }).some(e => e.message.includes('Print Spooler') && e.message.includes('disabled')));
    t('Lab 09 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Set-Service Spooler -StartupType Automatic', 'Start-Service Spooler', 'Set-Service RemoteRegistry -StartupType Disabled', 'Limit-EventLog -LogName System -MaximumSize 40MB']);
    t('Lab 09 service and log-size objectives complete', ['find', 'harden', 'size'].every(id => !open().includes(id)), open());
    WS.fs.writeFile('C:\\Logs\\Application.evtx', WS.evt.serialize('Application', WS.evt.list('Application')));
    t('saving the log alone does not complete the archive objective', (L.evaluate(), open().includes('archive')));
    await ps(['Clear-EventLog Application']);
    WS.evt.saveCustomView({ name: 'Service errors', filter: { logs: ['System'], levels: ['Critical', 'Error'] } }); L.evaluate();
    finished('Lab 09');

    // Lab 11: a technician's block rule breaks Remote Desktop.
    await begin('lab11-firewall');
    t('Lab 11 starts with RDP enabled but blocked by a firewall rule', WS.state.system.rdpEnabled && !L.evalCheck({ firewallAllows: { protocol: 'TCP', port: 3389, from: 'CLIENT01' } }, WS.state) && !!WS.fw.find('Temp - block 3389').length);
    t('Lab 11 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private', 'Get-NetFirewallRule -Action Block | Remove-NetFirewallRule', 'Enable-NetFirewallRule -Name FPS-ICMP4-ERQ-In']);
    t('Lab 11 profile, RDP and ping objectives complete', ['profile', 'rdp', 'ping'].every(id => !open().includes(id)), open());
    await ps(['New-NetFirewallRule -DisplayName "Contoso Web App" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Domain,Private']);
    t('an app rule open to every address does not complete the scope objective', open().includes('app'));
    await ps(['Set-NetFirewallRule -DisplayName "Contoso Web App" -RemoteAddress 192.168.1.0/24',
      'New-NetFirewallRule -DisplayName "Block Telnet" -Direction Outbound -Protocol TCP -RemotePort 23 -Action Block',
      'Set-NetFirewallProfile -Profile Private -LogBlocked True -LogMaxSizeKilobytes 16384', 'netsh advfirewall export C:\\Backup\\firewall.wfw']);
    finished('Lab 11');

    // Lab 12: a project file server on the domain controller, with an archive disk and a stale share.
    await begin('lab12-file-server');
    t('Lab 12 starts with Disk 1 offline, a 5 GB Archive volume on Disk 2 and the OldData share', WS.storage.disks()[1].status === 'Offline' && WS.storage.volume('V').disk === 2
      && Math.round(WS.storage.volume('V').size / WS.storage.GB) === 5 && WS.smb.get('OldData').access.some(a => a.account === 'Everyone') && !!WS.ad.get('Engineering Staff', 'group'));
    t('Lab 12 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Set-Disk 1 -IsOffline $false', 'Initialize-Disk 1 -PartitionStyle GPT',
      'New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter P | Format-Volume -FileSystem NTFS -NewFileSystemLabel Projects -Confirm:$false']);
    t('an NTFS volume does not complete the ReFS objective', open().includes('volume'));
    await ps(['Format-Volume -DriveLetter P -FileSystem ReFS -AllocationUnitSize 65536 -NewFileSystemLabel Projects -Confirm:$false',
      'Resize-Partition -DriveLetter V -Size (Get-PartitionSupportedSize -DriveLetter V).SizeMax']);
    t('Lab 12 volume objectives complete', !open().includes('volume') && !open().includes('archive'), open());
    await ps(['New-Item P:\\Shares\\Engineering -ItemType Directory',
      'New-SmbShare -Name Engineering -Path P:\\Shares\\Engineering -ChangeAccess "CONTOSO\\Engineering Staff" -FullAccess Administrators']);
    t('the share alone leaves the settings objectives open', !open().includes('share') && open().includes('abe') && open().includes('encrypt'), open());
    await ps(['Set-SmbShare -Name Engineering -FolderEnumerationMode AccessBased -Force', 'Set-SmbShare -Name Engineering -EncryptData $true -Force', 'Remove-SmbShare -Name OldData -Force']);
    finished('Lab 12');
    t('stopping the share kept its folder', WS.fs.isDir('C:\\OldData'));

    // Lab 13: Group Policy. GPO security settings have no cmdlet, so those steps go through the editor's model calls.
    await begin('lab13-group-policy');
    t('Lab 13 starts with Sales, Kiosks and only the default GPOs', !!WS.ad.get('Sales Staff', 'group') && WS.gpo.list().length === 2 && !!WS.gpo.somOf('Kiosks') && WS.fs.isDir('C:\\GPOBackup'));
    t('Lab 13 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    WS.gpo.setSetting('Default Domain Policy', 'computer', 'MinimumPasswordLength', 12);
    WS.gpo.setSetting('Default Domain Policy', 'computer', 'LockoutBadCount', 5);
    L.evaluate();
    t('editing the GPO completes the password objective, not the apply one', !open().includes('password') && open().includes('apply'), open());
    await ps(['gpupdate /force']);
    t('gpupdate applies it', !open().includes('apply') && WS.ad.policy().minLength === 12, open());
    await ps(['New-GPO -Name "Sales Desktop Restrictions" | New-GPLink -Target "OU=Sales,DC=contoso,DC=local"',
      'Set-GPRegistryValue -Name "Sales Desktop Restrictions" -Key "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" -ValueName NoControlPanel -Type DWord -Value 1',
      'Set-GPRegistryValue -Name "Sales Desktop Restrictions" -Key "HKCU\\Software\\Policies\\Microsoft\\Windows\\System" -ValueName DisableCMD -Type DWord -Value 1']);
    t('the GPO is linked; DisableCMD 1 (scripts blocked too) does not complete the settings objective', !open().includes('gpo') && open().includes('settings'), open());
    await ps(['Set-GPRegistryValue -Name "Sales Desktop Restrictions" -Key "HKCU\\Software\\Policies\\Microsoft\\Windows\\System" -ValueName DisableCMD -Type DWord -Value 2',
      'Set-GPPermission -Name "Sales Desktop Restrictions" -TargetName "Sales Staff" -TargetType Group -PermissionLevel GpoApply']);
    t('Sales Staff alone, with Authenticated Users still applying, leaves the filter open', !open().includes('settings') && open().includes('filter'), open());
    await ps(['Set-GPPermission -Name "Sales Desktop Restrictions" -TargetName "Authenticated Users" -TargetType Group -PermissionLevel None -Replace']);
    t('removing Authenticated Users completely leaves the filter open (computers cannot read it)', open().includes('filter'), open());
    await ps(['Set-GPPermission -Name "Sales Desktop Restrictions" -TargetName "Domain Computers" -TargetType Group -PermissionLevel GpoRead']);
    t('Domain Computers: Read completes the filter', !open().includes('filter'), open());
    WS.gpo.setSetting('Default Domain Controllers Policy', 'computer', 'LegalNoticeCaption', 'Authorized use only');
    WS.gpo.setSetting('Default Domain Controllers Policy', 'computer', 'LegalNoticeText', 'This system is for authorized Contoso staff only.');
    await ps(['Set-GPInheritance -Target "OU=Kiosks,DC=contoso,DC=local" -IsBlocked Yes',
      'Set-GPLink -Name "Default Domain Policy" -Target "DC=contoso,DC=local" -Enforced Yes',
      'Backup-GPO -All -Path C:\\GPOBackup']);
    finished('Lab 13');

    // Lab 14: processes and Task Manager. Startup apps start at sign-in, so the test signs in after the boot.
    WS.svc.timeScale = 0.01;
    await begin('lab14-task-manager');
    WS.proc.onLogon(); L.evaluate();
    const pn = n => WS.proc.find(n);
    t('Lab 14 starts with DataSync, a hung reportgen, the indexer and the leaking service', ['datasync.exe', 'reportgen.exe', 'indexer.exe', 'cupdsvc.exe'].every(n => pn(n).length === 1) && WS.svc.isRunning('ContosoUpdate') && pn('reportgen.exe')[0].status === 'Not responding' && WS.proc.pidOfService('ContosoUpdate') === pn('cupdsvc.exe')[0].pid);
    t('Lab 14 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    t('DataSync Agent is the busiest process', WS.proc.list().sort((a, b) => b.cpuBase - a.cpuBase)[0].image === 'datasync.exe');
    WS.proc.onLogoff(); L.evaluate();
    t('signed out, DataSync not running does not count', open().includes('cpu'));
    WS.proc.onLogon();
    await ps(['Stop-Process -Name datasync']);
    t('ending DataSync completes the CPU objective only', !open().includes('cpu') && open().includes('startup'), open());
    WS.proc.setStartupEnabled('DataSync Agent', false); L.evaluate();
    t('disabling the startup app completes it', !open().includes('startup'), open());
    await ps(['Stop-Process -Name reportgen -Force']);
    t('ending reportgen before dumping it leaves both objectives open', open().includes('dump') && open().includes('hung'), open());
    WS.sys.onBoot(); WS.proc.onLogon(); await wait(50);
    t('after a restart reportgen is back (hung) and DataSync stays off', pn('reportgen.exe').length === 1 && pn('datasync.exe').length === 0);
    WS.proc.dump(pn('reportgen.exe')[0].pid); L.evaluate();
    t('the dump completes the dump objective', !open().includes('dump') && open().includes('hung'), open());
    await ps(['taskkill /im reportgen.exe /f']);
    t('ending it now completes the next one', !open().includes('hung'), open());
    await ps(['(Get-Process indexer).PriorityClass = "BelowNormal"']);
    t('(Get-Process indexer).PriorityClass sets Below normal', !open().includes('priority') && pn('indexer.exe')[0].priority === 'BelowNormal', open());
    const leakPid = pn('cupdsvc.exe')[0].pid;
    await ps(['Stop-Process -Name cupdsvc -Force']);
    t('ending cupdsvc.exe: the service terminates unexpectedly (7031) and recovery restarts it', WS.state.events.logs.System.slice(-4).some(e => e.id === 7031 && e.message.includes('The Contoso Update Helper service terminated unexpectedly') && e.message.includes('5000 milliseconds')));
    await wait(200);
    t('...with a new process, and the objective stays open', WS.svc.isRunning('ContosoUpdate') && pn('cupdsvc.exe').length === 1 && pn('cupdsvc.exe')[0].pid !== leakPid && open().includes('leak'), open());
    await ps(['tasklist /svc /fi "imagename eq cupdsvc.exe"', 'Stop-Service ContosoUpdate', 'Set-Service ContosoUpdate -StartupType Disabled']);
    t('Lab 14: the service is stopped and its process gone', pn('cupdsvc.exe').length === 0);
    finished('Lab 14');
    WS.svc.timeScale = 1;

    // Lab 07: IIS, done entirely from PowerShell (appcmd by its full path, since inetsrv is not on PATH).
    await begin('lab07-iis');
    t('Lab 07 starts on the domain controller with the site content and no IIS', WS.sys.isDC() && !WS.features.isInstalled('Web-Server') && WS.fs.exists('C:\\Sites\\Intranet\\home.htm') && WS.fs.exists('C:\\Sites\\Reports\\Q1-2026.csv') && WS.state.iis === null);
    t('Lab 07 starts with no objective complete', L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Install-WindowsFeature Web-Server -IncludeManagementTools']);
    t('Lab 07 role objective completes', !open().includes('role'), open());
    await ps(['Install-WindowsFeature Web-Scripting-Tools', 'New-IISSite -Name Intranet -PhysicalPath C:\\Sites\\Intranet -BindingInformation "*:80:intranet.contoso.local"']);
    t('Lab 07 site objective completes; the pool objective stays open (New-IISSite uses DefaultAppPool)', !open().includes('site') && open().includes('pool'), open());
    await ps(['& C:\\Windows\\System32\\inetsrv\\appcmd.exe add apppool /name:Intranet /managedRuntimeVersion:', '& C:\\Windows\\System32\\inetsrv\\appcmd.exe set app "Intranet/" /applicationPool:Intranet']);
    t('Lab 07 pool objective completes', !open().includes('pool') && WS.iis.pool('Intranet').runtime === '', open());
    await ps(['Add-DnsServerResourceRecordA -ZoneName contoso.local -Name intranet -IPv4Address 192.168.1.10']);
    t('Lab 07 DNS objective completes; home stays open (403.14 without home.htm)', !open().includes('dns') && open().includes('home') && WS.iis.silently(() => WS.edge.serve('http://intranet.contoso.local/')).code === 'HTTP 403.14', open());
    await ps(["Add-WebConfigurationProperty -Filter //defaultDocument/files -PSPath IIS:\\Sites\\Intranet -AtIndex 0 -Name Collection -Value home.htm"]);
    t('Lab 07 home objective completes', !open().includes('home'), open());
    await ps(['& C:\\Windows\\System32\\inetsrv\\appcmd.exe add site /name:Reports /bindings:http/*:8080: /physicalPath:C:\\Sites\\Reports']);
    t('Lab 07 reports objective waits for directory browsing', open().includes('reports'), open());
    await ps(['& C:\\Windows\\System32\\inetsrv\\appcmd.exe set config Reports /section:directoryBrowse /enabled:true']);
    t('Lab 07 reports objective completes; CLIENT01 is still blocked', !open().includes('reports') && open().includes('firewall'), open());
    await ps(['New-NetFirewallRule -DisplayName "IIS Reports (TCP 8080)" -Direction Inbound -Protocol TCP -LocalPort 8080']);
    t('Lab 07 firewall objective completes', !open().includes('firewall'), open());
    const dcCert = WS.certs.createSelfSigned({ friendlyName: 'DC01' }).cert;
    WS.iis.addBinding('Intranet', { protocol: 'https', port: 443, host: 'intranet.contoso.local', cert: dcCert.thumbprint });
    L.evaluate();
    t('Lab 07: a certificate issued to dc01.contoso.local does not complete the HTTPS objective', open().includes('https'), open());
    await ps(['$c = New-SelfSignedCertificate -DnsName intranet.contoso.local -CertStoreLocation Cert:\\LocalMachine\\My', 'Remove-IISSiteBinding -Name Intranet -BindingInformation "*:443:intranet.contoso.local" -Protocol https', 'New-IISSiteBinding -Name Intranet -BindingInformation "*:443:intranet.contoso.local" -Protocol https -CertificateThumbPrint $c.Thumbprint -CertStoreLocation Cert:\\LocalMachine\\My']);
    finished('Lab 07');
    t('Lab 07 checks wrote no IIS log lines of their own', !WS.fs.exists('C:\\inetpub\\logs\\LogFiles\\W3SVC2') || !WS.fs.list('C:\\inetpub\\logs\\LogFiles\\W3SVC2').length);

    // Lab 15: Hyper-V from PowerShell, with Windows Setup driven through the model (what the VM console's buttons call).
    await begin('lab15-hyperv');
    WS.hv.timeScale = 0.05;
    t('Lab 15 starts as HV01 with the ISO and no Hyper-V', WS.state.system.computerName === 'HV01' && WS.fs.exists('C:\\ISO\\WindowsServer2025.iso') && !WS.features.isInstalled('Hyper-V') && L.progress().doneCount === 0, L.progress().items.filter(i => i.done).map(i => i.id));
    await ps(['Install-WindowsFeature Hyper-V -IncludeManagementTools']);
    t('Lab 15 role objective waits for the restart', open().includes('role'), open());
    WS.sys.onBoot(); await wait(150); L.evaluate();
    t('Lab 15 role objective completes after the restart', !open().includes('role'), open());
    await ps(['New-VMSwitch -Name LAN -NetAdapterName Ethernet -AllowManagementOS $true']);
    t('Lab 15 switch objective completes; HV01 keeps 192.168.1.10 on vEthernet (LAN)', !open().includes('switch') && WS.net.adapter('vEthernet (LAN)').ip === '192.168.1.10', open());
    await ps(['New-VM -Name SRV01 -Generation 2 -MemoryStartupBytes 1GB -Path C:\\Hyper-V -NewVHDPath C:\\Hyper-V\\SRV01\\SRV01.vhdx -NewVHDSizeBytes 40GB -SwitchName LAN']);
    t('Lab 15 VM objective waits for Dynamic Memory', open().includes('vm'), open());
    await ps(['Set-VMMemory SRV01 -DynamicMemoryEnabled $true -MinimumBytes 512MB -MaximumBytes 2GB', 'Set-VMProcessor SRV01 -Count 2']);
    t('Lab 15 VM and processor objectives complete', !open().includes('vm') && !open().includes('cpu'), open());
    await ps(['Add-VMDvdDrive -VMName SRV01 -Path C:\\ISO\\WindowsServer2025.iso', '$d = Get-VMDvdDrive SRV01', 'Set-VMFirmware SRV01 -FirstBootDevice $d', 'Start-VM SRV01']);
    const lv = WS.hv.vm('SRV01');
    for (let i = 0; i < 60 && lv.guest.phase !== 'presskey'; i++) await wait(50);
    WS.hv.pressKey('SRV01');
    for (let i = 0; i < 60 && lv.guest.step !== 'language'; i++) await wait(50);
    for (const st of ['keyboard', 'option', 'license', 'disk', 'ready']) WS.hv.setupStep('SRV01', st, st === 'license' ? { edition: 'std' } : undefined);
    WS.hv.setupStep('SRV01', 'install');
    for (let i = 0; i < 200 && lv.guest.phase !== 'oobe'; i++) await wait(50);
    L.evaluate();
    t('Lab 15 install objective completes; the network one waits for the guest\u2019s setup', !open().includes('install') && open().includes('network'), open());
    WS.hv.guestSetPassword('SRV01', 'P@ssw0rd!');
    await wait(150); L.evaluate();
    t('Lab 15 network objective completes', !open().includes('network'), [open(), WS.hv.guestIps(lv, 0)]);
    await ps(['Checkpoint-VM -Name SRV01 -SnapshotName "Clean install"', 'Set-VM SRV01 -AutomaticStartAction Start -AutomaticStopAction ShutDown']);
    finished('Lab 15');
    WS.hv.timeScale = 1;

    await begin('lab17-mount-points');
    t('Lab 17 starts with nothing done (Logs at L: and C:\\Temp\\LogsOld, an unreachable volume, Disk 1 offline)', open().join() === 'archive,logs,stale,scratch' && WS.storage.volume('L').paths.join() === 'C:\\Temp\\LogsOld\\'
      && WS.storage.volumes().some(v => v.label === 'New Volume' && !v.letter && !v.paths.length) && !WS.storage.disk(1).online, open());
    await ps(['Set-Disk 1 -IsOffline $false', 'Initialize-Disk 1 -PartitionStyle GPT', 'New-Partition -DiskNumber 1 -UseMaximumSize | Format-Volume -FileSystem NTFS -NewFileSystemLabel FinanceArchive', 'Add-PartitionAccessPath -DiskNumber 1 -PartitionNumber 2 -AccessPath C:\\Shares\\Finance\\Archive']);
    t('Lab 17 archive objective completes', !open().includes('archive'), open());
    await ps(['New-Item C:\\Logs -ItemType Directory', 'Add-PartitionAccessPath -DriveLetter L -AccessPath C:\\Logs']);
    t('Lab 17 logs objective completes', !open().includes('logs'), open());
    await ps(['Remove-PartitionAccessPath -DriveLetter L -AccessPath C:\\Temp\\LogsOld']);
    t('Lab 17 stale path objective completes', !open().includes('stale'), open());
    await ps(['Set-Partition -DiskNumber 2 -PartitionNumber 3 -NewDriveLetter S', 'Set-Volume -DriveLetter S -NewFileSystemLabel Scratch']);
    finished('Lab 17');

    await begin('lab18-storage-spaces');
    t('Lab 18 starts with nothing done and five poolable disks', open().join() === 'pool,mirror,volume,thin,spare' && WS.spaces.primordial().poolable.length === 6, open());
    await ps(['New-StoragePool -FriendlyName DataPool -StorageSubSystemFriendlyName "Windows Storage*" -PhysicalDisks (Get-PhysicalDisk -CanPool $true | Where-Object Size -eq 20GB)']);
    t('Lab 18 pool objective completes', !open().includes('pool'), open());
    await ps(['New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Finance -ResiliencySettingName Mirror -NumberOfDataCopies 2 -ProvisioningType Fixed -Size 20GB']);
    t('Lab 18 mirror objective completes', !open().includes('mirror'), open());
    await ps(['Get-VirtualDisk Finance | Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru | New-Partition -DriveLetter F -UseMaximumSize | Format-Volume -FileSystem NTFS -NewFileSystemLabel Finance -Confirm:$false']);
    t('Lab 18 volume objective completes', !open().includes('volume'), open());
    await ps(['New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Scratch -ResiliencySettingName Simple -ProvisioningType Thin -Size 100GB']);
    t('Lab 18 thin objective completes', !open().includes('thin'), open());
    await ps(['Add-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk -CanPool $true | Where-Object Size -eq 30GB) -Usage HotSpare']);
    finished('Lab 18');

    // Undo: step snapshots and going back to one (Lab 16, through the model).
    await begin('lab16-drive-maps');
    const SN = L.snapshots, G = WS.gpo, P = WS.gpp;
    const shadeL = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
    t('Undo: starting a lab saves its starting point', SN.list().length === 1 && SN.list()[0].kind === 'start' && SN.label(SN.list()[0]) === 'Start of lab', SN.list());
    const dm = G.create('Drive Mappings').gpo; G.link(dm, WS.ad.root());
    await wait(60); L.evaluate();
    t('Undo: completing step 1 saves "Step 1 complete"', SN.list().length === 2 && SN.label(SN.list()[1]) === 'Step 1 complete' && SN.list()[1].done === 1, SN.list().map(SN.label));
    P.newDrive(dm, { action: 'U', path: '\\\\DC01\\Public', letter: 'P', label: 'Public', persistent: true });
    await wait(60); L.evaluate();
    P.newDrive(dm, { action: 'U', path: '\\\\DC01\\IT', letter: 'I', filters: [{ type: 'group', name: 'IT Staff' }] });
    await wait(60); L.evaluate();
    t('Undo: one snapshot per completed step', SN.list().map(SN.label).join('|') === 'Start of lab|Step 1 complete|Step 2 complete|Step 3 complete', SN.list().map(SN.label));
    // two objectives met in one pass share a snapshot
    await ps(['Add-ADGroupMember -Identity "IT Staff" -Members Administrator']);
    t('Undo: step 4 complete', SN.label(SN.list().pop()) === 'Step 4 complete', SN.list().map(SN.label));
    // the mistake: delete the GPO (completed objectives stay complete)
    G.remove(dm);
    t('Undo: the mistake leaves the latched objectives done', !G.get('Drive Mappings') && open().join() === 'archive,apply', open());
    const lg = WS.apps.launch('lab'); await wait(120);
    const backLinks = [...lg.el.querySelectorAll('.lab-back')];
    t('Lab Guide: "Go back to here" on each completed step and an Undo… button', backLinks.length === 4 && [...lg.el.querySelectorAll('button')].some(b => b.textContent === 'Undo…'), backLinks.length);
    if (shotAt('goback')) return;
    let ud = null;
    const udp = WS.labGuide.undoDialog({ onCreate: d => { ud = d; } }); await wait(80);
    t('Undo…: "Go back to a step" lists the snapshots newest first', shadeL().textContent.includes('Go back to a step') && ud.list.rows().map(SN.label).join('|') === 'Step 4 complete|Step 3 complete|Step 2 complete|Step 1 complete|Start of lab', ud.list.rows().map(SN.label));
    const step3 = SN.list()[3];
    ud.list.select([step3.id]); await wait(30);
    ud.go(); await wait(80);
    t('Go back asks first, naming what is lost', shadeL().textContent.includes('Go back to “Step 3 complete”?') && shadeL().textContent.includes('step 4 will be open again') && shadeL().textContent.includes('The server will restart.'), shadeL().textContent.slice(0, 300));
    if (shotAt('undo')) return;
    [...shadeL().querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); await wait(60);
    t('Cancel keeps everything', SN.list().length === 5 && !G.get('Drive Mappings'));
    [...shadeL().querySelectorAll('button')].find(b => b.textContent === 'Close').click(); await wait(40);
    await WS.labGuide.goBack(step3.id, { confirm: false });
    await wait(2800); L.evaluate();
    const back = G.get('Drive Mappings');
    t('after going back to step 3 the GPO is there again with P: and I:', !!back && P.drives(back).map(d => d.letter).join() === 'P,I', back && P.drives(back));
    t('...step 4 is open again (Administrator is not in IT Staff any more)', open().join() === 'member,archive,apply' && !WS.ad.members('IT Staff').some(m => m.sam === 'Administrator'), open());
    t('...later snapshots are dropped, the chosen one stays', SN.list().map(SN.label).join('|') === 'Start of lab|Step 1 complete|Step 2 complete|Step 3 complete', SN.list().map(SN.label));
    t('...the server restarted (boot event logged, no unexpected-shutdown event)', WS.state.events.logs.System.slice(-40).some(e => e.id === 6005) && !WS.state.system.powerLoss);
    // two objectives completed by one change share a snapshot
    P.newDrive(G.get('Drive Mappings'), { action: 'D', letter: 'X' });
    WS.ad.addMember('IT Staff', 'Administrator');
    await wait(80);
    t('Undo: steps completed in one pass share a snapshot ("Steps 4 and 5 complete")', SN.label(SN.list().pop()) === 'Steps 4 and 5 complete', SN.list().map(SN.label));
    await SN.saved();
    const stored = await new Promise(res => { const rq = indexedDB.open('ws2025lab', 1); rq.onsuccess = () => { const g2 = rq.result.transaction('labSnapshots').objectStore('labSnapshots').get('current'); g2.onsuccess = () => { res(g2.result); rq.result.close(); }; g2.onerror = () => res(null); }; rq.onerror = () => res(null); });
    t('snapshots are stored in IndexedDB (they survive a page reload)', SN.backend === 'indexeddb' && stored && stored.list.length === SN.list().length && stored.labId === 'lab16-drive-maps', [SN.backend, stored && stored.list.length]);
    await WS.labGuide.goBack(SN.list()[0].id, { confirm: false });
    await wait(2800); L.evaluate();
    t('going back to the start of the lab: no GPO, nothing done, only the start snapshot left', !G.get('Drive Mappings') && L.progress().doneCount === 0 && SN.list().length === 1 && WS.netuse.get('X'), [L.progress().doneCount, SN.list().length]);
    L.stop();
    t('ending the lab drops its snapshots', SN.list().length === 0);

    // The real start path: revert, set up, restart the shell.
    const started = L.start('lab03-ad-objects');
    t('WS.labs.start accepts a lab that starts on a domain controller', started.ok, started);
    await wait(9000);
    t('WS.labs.start saves the starting point snapshot', L.snapshots.list().length >= 1 && L.snapshots.list()[0].kind === 'start');
    t('after the restart the lab is active on a fresh domain controller', L.active() && L.active().id === 'lab03-ad-objects' && WS.sys.isDC() && !WS.ad.get('jreed', 'user') && L.progress().doneCount === 0);
    t('the domain zone survives the restart', !!WS.dns.zone('contoso.local') && WS.net.resolve('contoso.local').ip === '192.168.1.10');
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
