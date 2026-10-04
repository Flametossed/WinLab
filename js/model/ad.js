/* Active Directory model: WS.ad. Forest promotion (Install-ADDSForest / the AD DS Configuration Wizard)
 * and directory objects for ADUC, ADAC, *-ADUser/-ADGroup/-ADOrganizationalUnit/-ADComputer, dsadd/dsquery.
 * State: ad = null until promotion, then { domain, netbios, domainSid, domainGuid, forestMode, domainMode,
 *   nextRid, policy (the domain's password and lockout policy, written by Group Policy processing), gpos[] (see gpo.js), objects[] }.
 * Object: { id (GUID), type: 'domainDNS'|'builtinDomain'|'container'|'organizationalUnit'|'user'|'group'|'computer'|'foreignSecurityPrincipal',
 *   name (the CN/OU value), parentId, sid?, description, protected (from accidental deletion), critical (system object),
 *   advanced (only shown with View > Advanced Features), created, modified, ...type fields }.
 *   user:  sam, upn, givenName, initials, sn, displayName, enabled, password, mustChange, cannotChange, neverExpires,
 *          lockedOut, badPwdCount, primaryGroupId, office, title, department, company, email, telephone, manager, ...
 *   group: sam, scope: 'Global'|'DomainLocal'|'Universal', category: 'Security'|'Distribution', members: [ids], builtin?
 *   computer: sam (NAME$), dnsHostName, os, osVersion, primaryGroupId, enabled
 * Errors use the wording ADUC/PowerShell show; codes: NotFound, Exists, SamExists, UpnExists, Protected, Critical,
 *   NotLeaf, PasswordPolicy, AlreadyMember, NotMember, GroupScope, PrimaryGroup, NotDC. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  WS.store.init('ad', s => { s.ad = null; });

  const A = () => WS.state.ad;
  const objs = () => A().objects;
  const ieq = (a, b) => String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
  const now = () => new Date().toISOString();
  const notDC = () => ({ ok: false, code: 'NotDC', error: 'Unable to find a default server with Active Directory Web Services running.' });
  const changed = () => WS.store.changed('ad');

  /* ---------------------------------------------------------------- DNs */
  const escRdn = v => String(v).replace(/([,\\#+<>;"=])/g, '\\$1').replace(/^ | $/g, '\\ ');
  function dn(o) {
    if (!o) return '';
    if (o.type === 'domainDNS') return A().domain.split('.').map(p => 'DC=' + p).join(',');
    const parent = byId(o.parentId);
    return (o.type === 'organizationalUnit' ? 'OU=' : 'CN=') + escRdn(o.name) + ',' + dn(parent);
  }
  const byId = id => id ? objs().find(o => o.id === id) || null : null;
  const domainObj = () => objs().find(o => o.type === 'domainDNS');
  const normDn = s => String(s).replace(/\s*,\s*/g, ',').replace(/\s*=\s*/g, '=').toLowerCase();
  function byDn(s) { const n = normDn(s); return objs().find(o => normDn(dn(o)) === n) || null; }
  /** Canonical name, as shown on the Object tab: contoso.local/Sales/John Smith */
  function canonical(o) {
    const parts = [];
    for (let x = o; x && x.type !== 'domainDNS'; x = byId(x.parentId)) parts.unshift(x.name);
    return A().domain + '/' + parts.join('/');
  }

  /** -Identity semantics: GUID, DN, SID, sAMAccountName, or UPN. */
  function resolveIdentity(identity, type) {
    if (!A() || identity == null) return null;
    if (typeof identity === 'object' && identity.id) identity = identity.id;
    const id = String(identity).trim();
    const okType = o => !type || [].concat(type).includes(o.type);
    let o = byId(id) || (id.includes('=') ? byDn(id) : null) || objs().find(x => x.sid && ieq(x.sid, id));
    if (!o) {
      const sam = id.replace(/^[^\\]+\\/, '');
      o = objs().find(x => okType(x) && x.sam && (ieq(x.sam, sam) || (x.type === 'computer' && ieq(x.sam, sam + '$'))))
        || objs().find(x => okType(x) && x.upn && ieq(x.upn, id));
    }
    return o && okType(o) ? o : null;
  }
  /** Friendlier lookup for the GUI and labs: identity first, then name (CN). */
  function get(identity, type) {
    return resolveIdentity(identity, type) || (A() ? objs().find(o => (!type || [].concat(type).includes(o.type)) && ieq(o.name, identity)) || null : null);
  }
  /** Resolve a container argument: DN, 'Sales' / 'Sales/East' (OU path under the domain), or an object. */
  function container(x) {
    if (!x) return null;
    if (typeof x === 'object') return byId(x.id) || null;
    const s = String(x).trim();
    if (s.includes('=')) return byDn(s);
    let cur = domainObj();
    for (const part of s.replace(/^[^/]*\.[^/]*\//, '').split(/[/\\]/).filter(Boolean)) {
      cur = objs().find(o => o.parentId === cur.id && ieq(o.name, part) && isContainer(o));
      if (!cur) return null;
    }
    return cur;
  }
  const isContainer = o => ['domainDNS', 'builtinDomain', 'container', 'organizationalUnit'].includes(o.type);
  const children = (id, opts = {}) => objs().filter(o => o.parentId === id && (opts.advanced || !o.advanced));
  function descendants(id) { return children(id, { advanced: true }).flatMap(c => [c, ...descendants(c.id)]); }

  /* ---------------------------------------------------------------- promotion */
  const LEVELS = { win2016: 'Windows2016Forest', winthreshold: 'Windows2016Forest', '7': 'Windows2016Forest', windows2016forest: 'Windows2016Forest', windows2016domain: 'Windows2016Forest',
    win2025: 'Windows2025Forest', '10': 'Windows2025Forest', windows2025forest: 'Windows2025Forest', windows2025domain: 'Windows2025Forest' };

  function validateDomainName(name) {
    name = String(name || '').trim().replace(/\.$/, '');
    if (!name) return 'You must specify a domain name.';
    if (!name.includes('.')) return `The domain name "${name}" is a single-label DNS name. Single-label domain names are not supported. Specify a fully qualified domain name, for example contoso.com.`;
    if (name.length > 64 || !name.split('.').every(l => /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(l)) || /^\d+$/.test(name.split('.').pop())) {
      return `The domain name "${name}" is not a valid DNS domain name. DNS names can contain letters (a-z, A-Z), numbers (0-9) and hyphens, separated by periods.`;
    }
    return null;
  }
  const defaultNetbios = domain => String(domain).split('.')[0].toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 15);

  /** The wizard's Prerequisites Check page: { errors[], warnings[] } */
  function prereqCheck(o = {}) {
    const errors = [], warnings = [];
    if (!WS.features.isInstalled('AD-Domain-Services')) errors.push('The Active Directory Domain Services role is not installed on this server.');
    if (WS.sys.isDC()) errors.push('This server is already a domain controller.');
    if (WS.sys.restartPending()) errors.push('A restart is pending on this server. Restart the server before you promote it to a domain controller.');
    const dErr = validateDomainName(o.domainName);
    if (o.domainName !== undefined && dErr) errors.push(dErr);
    const nb = o.netbios || (o.domainName ? defaultNetbios(o.domainName) : '');
    if (o.domainName !== undefined && (!nb || nb.length > 15 || /[.\\/:*?"<>|]/.test(nb))) errors.push(`The NetBIOS domain name "${nb}" is not valid.`);
    if (o.safeModePassword !== undefined) {
      if (!o.safeModePassword) errors.push('You must supply a Directory Services Restore Mode (DSRM) password.');
      else if (U.checkPassword(o.safeModePassword, { minLength: 7 })) errors.push('Verification of the Directory Services Restore Mode (DSRM) password failed. The password does not meet the length, complexity, or history requirements of the domain.');
    }
    if (!WS.state.system.adminPassword) errors.push('The local Administrator account becomes the domain Administrator account when you create a new domain. The new domain cannot be created because the local Administrator account password does not meet requirements.');
    warnings.push('Windows Server 2025 domain controllers have a default for the security setting named "Allow cryptography algorithms compatible with Windows NT 4.0" that prevents weaker cryptography algorithms when establishing security channel sessions.\n\nFor more information about this setting, see Knowledge Base article 942564 (http://go.microsoft.com/fwlink/?LinkId=104751).');
    if (!WS.net.isStatic()) warnings.push('This computer has at least one physical network adapter that does not have static IP address(es) assigned to its IP Properties. If both IPv4 and IPv6 are enabled for a network adapter, both IPv4 and IPv6 static IP addresses should be assigned to both IPv4 and IPv6 Properties of the physical network adapter. Such static IP address(es) assignment should be done to all the physical network adapters for reliable Domain Name System (DNS) operation.');
    if (o.installDns !== false) warnings.push('A delegation for this DNS server cannot be created because the authoritative parent zone cannot be found or it does not run Windows DNS server. If you are integrating with an existing DNS infrastructure, you should manually create a delegation to this DNS server in the parent zone to ensure reliable name resolution from outside the domain "' + (o.domainName || '') + '". Otherwise, no action is required.');
    return { errors, warnings };
  }

  /** installForest({ domainName, netbios, safeModePassword, forestMode, domainMode, installDns = true, noReboot,
   *                 databasePath, logPath, sysvolPath }) - paths default to C:\Windows\NTDS and C:\Windows\SYSVOL. */
  function installForest(o) {
    const check = prereqCheck(o);
    if (check.errors.length) return { ok: false, code: 'Prerequisites', error: check.errors[0], errors: check.errors, warnings: check.warnings };
    const domain = String(o.domainName).trim().replace(/\.$/, '').toLowerCase();
    const netbios = (o.netbios || defaultNetbios(domain)).toUpperCase();
    const forestMode = LEVELS[String(o.forestMode || 'Win2025').toLowerCase()];
    if (!forestMode) return { ok: false, error: `Cannot bind parameter 'ForestMode'. Specify one of: Win2016, Win2025, WinThreshold.` };
    const domainMode = LEVELS[String(o.domainMode || o.forestMode || 'Win2025').toLowerCase()].replace('Forest', 'Domain');
    if (domainMode.replace('Domain', '') < forestMode.replace('Forest', '')) return { ok: false, error: 'The domain functional level cannot be lower than the forest functional level.' };

    const sys = WS.state.system;
    const domainSid = `S-1-5-21-${U.randInt(1e9, 4e9)}-${U.randInt(1e9, 4e9)}-${U.randInt(1e9, 4e9)}`;
    WS.state.ad = {
      domain, netbios, domainSid, domainGuid: U.guid(), dsaGuid: U.guid(), forestMode, domainMode,
      created: now(), nextRid: 1103, dsrmPassword: o.safeModePassword,
      policy: { minLength: 7, complexity: true, maxAgeDays: 42, minAgeDays: 1, history: 24, lockoutThreshold: 0, lockoutMinutes: 10, lockoutWindowMinutes: 10, reversible: false },
      gpos: [
        { id: '{31B2F340-016D-11D2-945F-00C04FB984F9}', name: 'Default Domain Policy', links: [], status: 'Enabled', created: now(), modified: now() },
        { id: '{6AC1786C-016F-11D2-945F-00C04fB984F9}', name: 'Default Domain Controllers Policy', links: [], status: 'Enabled', created: now(), modified: now() }
      ],
      objects: []
    };
    buildDefaults(sys.computerName);
    const ad = A();
    ad.gpos[0].links = [dn(domainObj())];
    ad.gpos[1].links = [dn(get('Domain Controllers', 'organizationalUnit'))];

    // the server becomes the forest root DC
    sys.domain = domain;
    sys.workgroup = null;
    sys.domainRole = 'PrimaryDomainController';
    WS.state.firewall.networkCategory = 'DomainAuthenticated';

    // DNS: install the role, create the AD-integrated zones, point the DNS client at itself, keep old servers as forwarders
    const a = WS.net.adapter();
    const ip = WS.net.primaryIp() || a.ip;
    if (o.installDns !== false) {
      WS.features.install(['DNS'], { includeManagementTools: true });
      const old = a.dnsServers.filter(x => x !== '127.0.0.1' && x !== ip);
      if (old.length && !WS.state.dns.forwarders.length) WS.state.dns.forwarders = old;
      WS.dns.createAdZones(domain, sys.computerName, ip, { dsa: ad.dsaGuid, domain: ad.domainGuid });
      if (!a.dnsServers.includes(ip) && !a.dnsServers.includes('127.0.0.1')) { a.dnsDhcp = false; a.dnsServers = ['127.0.0.1']; }
      WS.store.changed('network');
    }

    // services that only exist on a DC come up; Netlogon goes automatic
    ['NTDS', 'Kdc', 'ADWS', 'DFSR', 'IsmServ'].forEach(n => WS.svc.reset(n));
    WS.svc.setStartup('Netlogon', 'Automatic'); WS.svc.start('Netlogon');

    // SYSVOL / NTDS folders and their shares
    const trim = p => String(p).replace(/\\+$/, '');
    const sv = trim(o.sysvolPath || 'C:\\Windows\\SYSVOL');
    WS.fs.ensureFile(trim(o.databasePath || 'C:\\Windows\\NTDS') + '\\ntds.dit', ''); WS.fs.ensureFile(trim(o.logPath || o.databasePath || 'C:\\Windows\\NTDS') + '\\edb.log', '');
    for (const g of ad.gpos) { WS.fs.ensureDir(`${sv}\\domain\\Policies\\${g.id}\\MACHINE`); WS.fs.ensureDir(`${sv}\\domain\\Policies\\${g.id}\\USER`); WS.fs.ensureFile(`${sv}\\domain\\Policies\\${g.id}\\GPT.INI`, '[General]\r\nVersion=1\r\n'); }
    WS.fs.ensureDir(`${sv}\\domain\\scripts`);
    WS.fs.ensureDir(`${sv}\\sysvol\\${domain}\\Policies`); WS.fs.ensureDir(`${sv}\\sysvol\\${domain}\\SCRIPTS`);
    if (WS.gpo) WS.gpo.ensure(); // GPO settings, gPLink on the domain and Domain Controllers OU, GPT.INI versions
    WS.state.smb.shares.push({ name: 'NETLOGON', path: `${sv}\\sysvol\\${domain}\\SCRIPTS`, description: 'Logon server share ', special: false, access: [{ account: 'Everyone', right: 'Read', type: 'Allow' }, { account: 'BUILTIN\\Administrators', right: 'Full', type: 'Allow' }] });
    WS.state.smb.shares.push({ name: 'SYSVOL', path: `${sv}\\sysvol`, description: 'Logon server share ', special: false, access: [{ account: 'Everyone', right: 'Read', type: 'Allow' }, { account: 'BUILTIN\\Administrators', right: 'Full', type: 'Allow' }, { account: 'NT AUTHORITY\\Authenticated Users', right: 'Full', type: 'Allow' }] });
    WS.fw.addRules(WS.fw.ADDS_RULES);

    WS.features.completePostTask('adds');
    WS.evt.write('Directory Service', { id: 1000, source: 'NTDS General', task: 'Service Control', message: 'Microsoft Active Directory Domain Services startup complete, version 10.0.26100.1742' });
    WS.evt.write('System', { id: 5774, source: 'NETLOGON', level: 'Information', message: `This computer has been promoted to a domain controller of the domain ${domain}.` });
    WS.sys.requireReboot('adds');
    WS.store.changed('ad', 'system', 'services', 'fs', 'smb', 'firewall', 'dns');
    if (!o.noReboot) setTimeout(() => WS.shell.restart(), 0);
    return { ok: true, warnings: check.warnings, message: 'Operation completed successfully', restartNeeded: true };
  }

  function buildDefaults(dcName) {
    const ad = A();
    // Builtin groups use the well-known S-1-5-32 authority; everything else is relative to the domain SID
    const sidOf = rid => rid >= 544 && rid <= 583 && ![553, 571, 572].includes(rid) ? `S-1-5-32-${rid}` : `${ad.domainSid}-${rid}`;
    const mk = (type, name, parentId, extra) => {
      const o = Object.assign({ id: U.guid(), type, name, parentId, description: '', protected: false, critical: true, advanced: false, created: ad.created, modified: ad.created }, extra);
      ad.objects.push(o);
      return o;
    };
    const root = mk('domainDNS', ad.domain.split('.')[0], null, { protected: true });
    const cont = (name, desc, adv) => mk('container', name, root.id, { description: desc, advanced: !!adv });
    const builtin = mk('builtinDomain', 'Builtin', root.id);
    const computers = cont('Computers', 'Default container for upgraded computer accounts');
    const dcs = mk('organizationalUnit', 'Domain Controllers', root.id, { description: 'Default container for domain controllers', protected: false });
    const fsp = cont('ForeignSecurityPrincipals', 'Default container for security identifiers (SIDs) associated with objects from external, trusted domains');
    cont('Keys', 'Default container for key credential objects');
    cont('Managed Service Accounts', 'Default container for managed service accounts');
    const users = cont('Users', 'Default container for upgraded user accounts');
    ['LostAndFound', 'Program Data', 'System', 'NTDS Quotas', 'TPM Devices', 'Infrastructure'].forEach(n => cont(n, n === 'LostAndFound' ? 'Default container for orphaned objects' : n === 'System' ? 'Builtin system settings' : n === 'Program Data' ? 'Default location for storage of application data.' : n === 'NTDS Quotas' ? 'Quota specifications container' : '', true));

    const fspObj = (sid, display) => mk('foreignSecurityPrincipal', sid, fsp.id, { sid, displayName: display });
    const fInteractive = fspObj('S-1-5-4', 'NT AUTHORITY\\INTERACTIVE');
    const fAuth = fspObj('S-1-5-11', 'NT AUTHORITY\\Authenticated Users');
    const fEdc = fspObj('S-1-5-9', 'NT AUTHORITY\\ENTERPRISE DOMAIN CONTROLLERS');
    const fIusr = fspObj('S-1-5-17', 'NT AUTHORITY\\IUSR');

    const user = (name, rid, desc, enabled, pg) => mk('user', name, users.id, { sam: name, upn: null, givenName: '', sn: '', initials: '', displayName: '', description: desc, enabled, password: null,
      mustChange: false, cannotChange: name === 'Guest', neverExpires: name !== 'krbtgt', lockedOut: false, badPwdCount: 0, primaryGroupId: pg, rid, sid: sidOf(rid), pwdLastSet: ad.created, lastLogon: null });
    const admin = user('Administrator', 500, 'Built-in account for administering the computer/domain', true, 513);
    const guest = user('Guest', 501, 'Built-in account for guest access to the computer/domain', false, 514);
    const krbtgt = user('krbtgt', 502, 'Key Distribution Center Service Account', false, 513);

    const grp = (parent, name, rid, scope, desc, builtinGrp) => mk('group', name, parent.id, { sam: name, scope, category: 'Security', description: desc, members: [], rid, sid: sidOf(rid), builtin: !!builtinGrp });
    const B = [
      ['Access Control Assistance Operators', 579, 'Members of this group can remotely query authorization attributes and permissions for resources on this computer.'],
      ['Account Operators', 548, 'Members can administer domain user and group accounts'],
      ['Administrators', 544, 'Administrators have complete and unrestricted access to the computer/domain'],
      ['Backup Operators', 551, 'Backup Operators can override security restrictions for the sole purpose of backing up or restoring files'],
      ['Certificate Service DCOM Access', 574, 'Members of this group are allowed to connect to Certification Authorities in the enterprise'],
      ['Cryptographic Operators', 569, 'Members are authorized to perform cryptographic operations.'],
      ['Distributed COM Users', 562, 'Members are allowed to launch, activate and use Distributed COM objects on this machine.'],
      ['Event Log Readers', 573, 'Members of this group can read event logs from local machine'],
      ['Guests', 546, 'Guests have the same access as members of the Users group by default, except for the Guest account which is further restricted'],
      ['Hyper-V Administrators', 578, 'Members of this group have complete and unrestricted access to all features of Hyper-V.'],
      ['IIS_IUSRS', 568, 'Built-in group used by Internet Information Services.'],
      ['Incoming Forest Trust Builders', 557, 'Members of this group can create incoming, one-way trusts to this forest'],
      ['Network Configuration Operators', 556, 'Members in this group can have some administrative privileges to manage configuration of networking features'],
      ['Performance Log Users', 559, 'Members of this group may schedule logging of performance counters, enable trace providers, and collect event traces both locally and via remote access to this computer'],
      ['Performance Monitor Users', 558, 'Members of this group can access performance counter data locally and remotely'],
      ['Pre-Windows 2000 Compatible Access', 554, 'A backward compatibility group which allows read access on all users and groups in the domain'],
      ['Print Operators', 550, 'Members can administer printers installed on domain controllers'],
      ['RDS Endpoint Servers', 576, 'Servers in this group run virtual machines and host sessions where users RemoteApp programs and personal virtual desktops run. This group needs to be populated on servers running RD Connection Broker. RD Session Host servers and RD Virtualization Host servers used in the deployment need to be in this group.'],
      ['RDS Management Servers', 577, 'Servers in this group can perform routine administrative actions on servers running Remote Desktop Services. This group needs to be populated on all servers in a Remote Desktop Services deployment. The servers running the RDS Central Management service must be included in this group.'],
      ['RDS Remote Access Servers', 575, 'Servers in this group enable users of RemoteApp programs and personal virtual desktops access to these resources. In Internet-facing deployments, these servers are typically deployed in an edge network. This group needs to be populated on servers running RD Connection Broker. RD Gateway servers and RD Web Access servers used in the deployment need to be in this group.'],
      ['Remote Desktop Users', 555, 'Members in this group are granted the right to logon remotely'],
      ['Remote Management Users', 580, 'Members of this group can access WMI resources over management protocols (such as WS-Management via the Windows Remote Management service). This applies only to WMI namespaces that grant access to the user.'],
      ['Replicator', 552, 'Supports file replication in a domain'],
      ['Server Operators', 549, 'Members can administer domain servers'],
      ['Storage Replica Administrators', 582, 'Members of this group have complete and unrestricted access to all features of Storage Replica.'],
      ['Terminal Server License Servers', 561, 'Members of this group can update user accounts in Active Directory with information about license issuance, for the purpose of tracking and reporting TS Per User CAL usage'],
      ['Users', 545, 'Users are prevented from making accidental or intentional system-wide changes and can run most applications'],
      ['Windows Authorization Access Group', 560, 'Members of this group have access to the computed tokenGroupsGlobalAndUniversal attribute on User objects']
    ];
    const bg = {};
    for (const [n, rid, d] of B) bg[n] = grp(builtin, n, rid, 'DomainLocal', d, true);

    const G = [
      ['Allowed RODC Password Replication Group', 571, 'DomainLocal', 'Members in this group can have their passwords replicated to all read-only domain controllers in the domain'],
      ['Cert Publishers', 517, 'DomainLocal', 'Members of this group are permitted to publish certificates to the directory'],
      ['Cloneable Domain Controllers', 522, 'Global', 'Members of this group that are domain controllers may be cloned.'],
      ['Denied RODC Password Replication Group', 572, 'DomainLocal', 'Members in this group cannot have their passwords replicated to any read-only domain controllers in the domain'],
      ['DnsAdmins', 1101, 'DomainLocal', 'DNS Administrators Group'],
      ['DnsUpdateProxy', 1102, 'Global', 'DNS clients who are permitted to perform dynamic updates on behalf of some other clients (such as DHCP servers).'],
      ['Domain Admins', 512, 'Global', 'Designated administrators of the domain'],
      ['Domain Computers', 515, 'Global', 'All workstations and servers joined to the domain'],
      ['Domain Controllers', 516, 'Global', 'All domain controllers in the domain'],
      ['Domain Guests', 514, 'Global', 'All domain guests'],
      ['Domain Users', 513, 'Global', 'All domain users'],
      ['Enterprise Admins', 519, 'Universal', 'Designated administrators of the enterprise'],
      ['Enterprise Key Admins', 527, 'Universal', 'Members of this group can perform administrative actions on key objects within the forest.'],
      ['Enterprise Read-only Domain Controllers', 498, 'Universal', 'Members of this group are Read-Only Domain Controllers in the enterprise'],
      ['Group Policy Creator Owners', 520, 'Global', 'Members in this group can modify group policy for the domain'],
      ['Key Admins', 526, 'Global', 'Members of this group can perform administrative actions on key objects within the domain.'],
      ['Protected Users', 525, 'Global', 'Members of this group are afforded additional protections against authentication security threats. See http://go.microsoft.com/fwlink/?LinkId=298939 for more information.'],
      ['RAS and IAS Servers', 553, 'DomainLocal', 'Servers in this group can access remote access properties of users'],
      ['Read-only Domain Controllers', 521, 'Global', 'Members of this group are Read-Only Domain Controllers in the domain'],
      ['Schema Admins', 518, 'Universal', 'Designated administrators of the schema']
    ];
    const ug = {};
    for (const [n, rid, scope, d] of G) ug[n] = grp(users, n, rid, scope, d);
    for (const n of ['DnsAdmins', 'DnsUpdateProxy']) ug[n].critical = false;

    const dc = mk('computer', dcName, dcs.id, { sam: dcName + '$', dnsHostName: (dcName + '.' + ad.domain).toLowerCase(), os: 'Windows Server 2025 Datacenter Evaluation', osVersion: '10.0 (26100)',
      enabled: true, primaryGroupId: 516, rid: 1000, sid: sidOf(1000), description: '', critical: true });

    const add = (g, ...m) => g.members.push(...m.map(x => x.id));
    add(bg.Administrators, admin, ug['Enterprise Admins'], ug['Domain Admins']);
    add(bg.Users, fInteractive, fAuth, ug['Domain Users']);
    add(bg.Guests, guest, ug['Domain Guests']);
    add(bg['Pre-Windows 2000 Compatible Access'], fAuth);
    add(bg['Windows Authorization Access Group'], fEdc);
    add(bg.IIS_IUSRS, fIusr);
    add(ug['Domain Admins'], admin); add(ug['Enterprise Admins'], admin); add(ug['Schema Admins'], admin); add(ug['Group Policy Creator Owners'], admin);
    add(ug['Denied RODC Password Replication Group'], ug['Read-only Domain Controllers'], ug['Group Policy Creator Owners'], ug['Domain Admins'], ug['Cert Publishers'], ug['Enterprise Admins'], ug['Schema Admins'], ug['Domain Controllers'], krbtgt);
    void dc;
  }

  /* ---------------------------------------------------------------- validation helpers */
  const SAM_BAD = /["/\\[\]:;|=,+*?<>]/;
  function checkSam(sam, self) {
    if (!sam) return { code: 'Invalid', error: 'You must enter a user logon name.' };
    if (sam.length > 20) return { code: 'Invalid', error: `The user logon name (pre-Windows 2000) "${sam}" is too long. It can contain at most 20 characters.` };
    if (SAM_BAD.test(sam) || /^[. ]+$/.test(sam)) return { code: 'Invalid', error: `The user logon name "${sam}" contains one or more of the following illegal characters: " / \\ [ ] : ; | = , + * ? < >` };
    if (objs().some(o => o !== self && o.sam && ieq(o.sam, sam))) return { code: 'SamExists', error: 'The specified account already exists' };
    return null;
  }
  function checkCn(name, parentId, self) {
    if (!name || !String(name).trim()) return { code: 'Invalid', error: 'You must enter a name.' };
    if (String(name).length > 64) return { code: 'Invalid', error: 'The name is too long. It can contain at most 64 characters.' };
    if (objs().some(o => o !== self && o.parentId === parentId && ieq(o.name, name))) return { code: 'Exists', error: 'An attempt was made to add an object to the directory with a name that is already in use.' };
    return null;
  }
  function checkPw(pw, u) {
    const p = A().policy;
    return U.checkPassword(pw, { minLength: p.minLength, complexity: p.complexity, sam: u.sam, displayName: u.displayName,
      message: 'The password does not meet the length, complexity, or history requirement of the domain.' });
  }
  const fail = (e) => Object.assign({ ok: false }, e);
  const defaultParent = type => type === 'computer' ? get('Computers', 'container') : type === 'organizationalUnit' ? domainObj() : get('Users', 'container');
  function parentFor(x, type) {
    if (x == null) return defaultParent(type);
    const p = container(x);
    return p && isContainer(p) && p.type !== 'builtinDomain' ? p : null;
  }
  const noParent = x => fail({ code: 'NotFound', error: `Directory object not found: '${x}'.` });
  const auditUser = (id, verb, o) => WS.evt.audit(id, 'User Account Management', verb, [['Target Account', [['Security ID', `${A().netbios}\\${o.sam}`], ['Account Name', o.sam], ['Account Domain', A().netbios]]]]);

  /* ---------------------------------------------------------------- users */
  /** createUser({ name, givenName, sn, initials, displayName, sam, upn, parent, password, enabled = true, mustChange, cannotChange, neverExpires, description, ...attrs }) */
  function createUser(o) {
    if (!A()) return notDC();
    const parent = parentFor(o.parent, 'user'); if (!parent) return noParent(o.parent);
    const name = String(o.name || [o.givenName, o.initials && o.initials + '.', o.sn].filter(Boolean).join(' ')).trim();
    let e = checkCn(name, parent.id); if (e) return fail(e);
    const sam = String(o.sam || (o.upn || '').split('@')[0] || name).trim().slice(0, 20);
    e = checkSam(sam); if (e) return fail(e);
    const upn = o.upn ? (o.upn.includes('@') ? o.upn : o.upn + '@' + A().domain) : null;
    if (upn && objs().some(x => x.upn && ieq(x.upn, upn))) return fail({ code: 'UpnExists', error: 'The user logon name you have chosen is already in use in this enterprise. Choose another logon name, and then try again.' });
    const u = { id: U.guid(), type: 'user', name, parentId: parent.id, sam, upn, givenName: o.givenName || '', sn: o.sn || '', initials: o.initials || '',
      displayName: o.displayName != null ? o.displayName : name, description: o.description || '', enabled: false, password: null,
      mustChange: !!o.mustChange, cannotChange: !!o.cannotChange, neverExpires: !!o.neverExpires, lockedOut: false, badPwdCount: 0, primaryGroupId: 513,
      office: o.office || '', title: o.title || '', department: o.department || '', company: o.company || '', email: o.email || '', telephone: o.telephone || '',
      manager: null, homeDirectory: '', homeDrive: '', profilePath: '', scriptPath: '', protected: false, critical: false, advanced: false,
      rid: A().nextRid, sid: `${A().domainSid}-${A().nextRid}`, created: now(), modified: now(), pwdLastSet: null, lastLogon: null };
    if (o.password != null) {
      const bad = checkPw(o.password, u);
      if (bad) return fail({ code: 'PasswordPolicy', error: bad });
      u.password = o.password; u.pwdLastSet = u.mustChange ? null : now();
      u.enabled = o.enabled !== false;
    }
    A().nextRid++;
    objs().push(u);
    auditUser(4720, 'A user account was created.', u);
    if (u.enabled) auditUser(4722, 'A user account was enabled.', u);
    changed();
    return { ok: true, object: u };
  }
  function setPassword(identity, pw, opts = {}) {
    const u = resolveIdentity(identity, 'user'); if (!u) return notFound(identity);
    const bad = checkPw(pw, u);
    if (bad) return fail({ code: 'PasswordPolicy', error: bad });
    if (u.rid === 500) WS.state.system.adminPassword = pw;
    u.password = pw; u.mustChange = !!opts.mustChange; u.pwdLastSet = u.mustChange ? null : now(); u.modified = now();
    if (opts.unlock) { u.lockedOut = false; u.badPwdCount = 0; }
    auditUser(4724, "An attempt was made to reset an account's password.", u);
    WS.store.changed('ad', 'system');
    return { ok: true };
  }
  function setEnabled(identity, enabled) {
    const o = resolveIdentity(identity, ['user', 'computer']); if (!o) return notFound(identity);
    if (enabled && o.type === 'user' && o.password == null && o.rid !== 500) return fail({ code: 'PasswordPolicy', error: 'Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.' });
    if (o.enabled === !!enabled) return { ok: true, changed: false };
    o.enabled = !!enabled; o.modified = now();
    if (o.type === 'user') auditUser(enabled ? 4722 : 4725, `A user account was ${enabled ? 'enabled' : 'disabled'}.`, o);
    changed();
    return { ok: true, changed: true };
  }
  function unlock(identity) {
    const u = resolveIdentity(identity, 'user'); if (!u) return notFound(identity);
    u.lockedOut = false; u.badPwdCount = 0;
    auditUser(4767, 'A user account was unlocked.', u);
    changed();
    return { ok: true };
  }
  /** Sign-in: CONTOSO\user, user@contoso.local or user. */
  function verify(name, pw) {
    const generic = { ok: false, error: 'The user name or password is incorrect. Try again.' };
    const raw = String(name || '').trim();
    const dom = raw.includes('\\') ? raw.split('\\')[0] : null;
    if (dom && !ieq(dom, A().netbios) && !ieq(dom, A().domain)) return generic;
    const u = resolveIdentity(raw.replace(/^[^\\]+\\/, ''), 'user');
    if (!u) return generic;
    if (u.lockedOut) return { ok: false, error: 'The referenced account is currently locked out and may not be logged on to.' };
    const real = u.rid === 500 ? WS.state.system.adminPassword : u.password;
    if (real !== pw) {
      u.badPwdCount = (u.badPwdCount || 0) + 1;
      const t = A().policy.lockoutThreshold;
      if (t && u.badPwdCount >= t) { u.lockedOut = true; WS.evt.audit(4740, 'User Account Management', 'A user account was locked out.', [['Account That Was Locked Out', [['Account Name', u.sam]]]]); }
      changed();
      return generic;
    }
    if (!u.enabled) return { ok: false, error: 'Your account has been disabled. Please see your system administrator.' };
    u.badPwdCount = 0; u.lastLogon = now(); changed();
    return { ok: true, user: u.sam, mustChange: u.mustChange };
  }

  /* ---------------------------------------------------------------- groups, OUs, computers */
  /** createGroup({ name, sam, scope = 'Global', category = 'Security', parent, description }) */
  function createGroup(o) {
    if (!A()) return notDC();
    const parent = parentFor(o.parent, 'group'); if (!parent) return noParent(o.parent);
    const name = String(o.name || '').trim();
    let e = checkCn(name, parent.id); if (e) return fail(e);
    const sam = String(o.sam || name).slice(0, 256);
    if (objs().some(x => x.sam && ieq(x.sam, sam))) return fail({ code: 'SamExists', error: `The pre-Windows 2000 group name "${sam}" is already in use. Please choose another name.` });
    const scope = { global: 'Global', domainlocal: 'DomainLocal', 'domain local': 'DomainLocal', universal: 'Universal' }[String(o.scope || 'Global').toLowerCase()];
    if (!scope) return fail({ error: `Cannot bind parameter 'GroupScope'. Specify one of the following enumerator names and try again: DomainLocal, Global, Universal` });
    const category = /^dist/i.test(o.category || '') ? 'Distribution' : 'Security';
    const g = { id: U.guid(), type: 'group', name, parentId: parent.id, sam, scope, category, description: o.description || '', email: o.email || '', notes: '', members: [],
      protected: false, critical: false, advanced: false, rid: A().nextRid, sid: `${A().domainSid}-${A().nextRid}`, created: now(), modified: now(), managedBy: null };
    A().nextRid++;
    objs().push(g);
    if (category === 'Security') WS.evt.audit({ Global: 4727, DomainLocal: 4731, Universal: 4754 }[scope], 'Security Group Management', `A security-enabled ${scope === 'DomainLocal' ? 'local' : scope.toLowerCase()} group was created.`, [['New Group', [['Group Name', name], ['Group Domain', A().netbios]]]]);
    changed();
    return { ok: true, object: g };
  }
  /** createOU({ name, parent, description, protect = true }) - ADUC protects new OUs by default. */
  function createOU(o) {
    if (!A()) return notDC();
    const parent = parentFor(o.parent, 'organizationalUnit'); if (!parent) return noParent(o.parent);
    if (parent.type === 'container') return fail({ error: 'The requested object has a non-unique identifier and cannot be retrieved.', code: 'Invalid' });
    const name = String(o.name || '').trim();
    if (/[,\\#+<>;"=]/.test(name)) return fail({ code: 'Invalid', error: 'The name contains characters that are not allowed.' });
    const e = checkCn(name, parent.id); if (e) return fail(e);
    const ou = { id: U.guid(), type: 'organizationalUnit', name, parentId: parent.id, description: o.description || '', protected: o.protect !== false, critical: false, advanced: false,
      created: now(), modified: now(), managedBy: null, street: '', city: '', state: '', postalCode: '', country: '' };
    objs().push(ou);
    changed();
    return { ok: true, object: ou };
  }
  function createComputer(o) {
    if (!A()) return notDC();
    const parent = parentFor(o.parent, 'computer'); if (!parent) return noParent(o.parent);
    const name = String(o.name || '').trim().toUpperCase();
    const vErr = U.validateComputerName(name); if (vErr) return fail({ code: 'Invalid', error: vErr });
    let e = checkCn(name, parent.id); if (e) return fail(e);
    e = checkSam(name + '$'); if (e) return fail(e);
    const c = { id: U.guid(), type: 'computer', name, parentId: parent.id, sam: name + '$', dnsHostName: (name + '.' + A().domain).toLowerCase(), os: o.os || '', osVersion: '',
      description: o.description || '', enabled: o.enabled !== false, primaryGroupId: 515, protected: false, critical: false, advanced: false,
      rid: A().nextRid, sid: `${A().domainSid}-${A().nextRid}`, created: now(), modified: now(), managedBy: null };
    A().nextRid++;
    objs().push(c);
    WS.evt.audit(4741, 'Computer Account Management', 'A computer account was created.', [['New Computer Account', [['Account Name', c.sam], ['Account Domain', A().netbios]]]]);
    changed();
    return { ok: true, object: c };
  }

  const notFound = identity => fail({ code: 'NotFound', error: `Cannot find an object with identity: '${identity}' under: '${A() ? dn(domainObj()) : ''}'.` });

  /** remove(identity, { recursive }) - honours "Protect object from accidental deletion". */
  function remove(identity, opts = {}) {
    const o = typeof identity === 'object' ? byId(identity.id) : get(identity);
    if (!o) return notFound(identity);
    if (o.critical || o.type === 'domainDNS' || (o.rid && o.rid < 1000)) return fail({ code: 'Critical', error: o.type === 'user' || o.type === 'group' ? 'Cannot perform this operation on built-in accounts.' : 'Access is denied' });
    if (o.protected) return fail({ code: 'Protected', error: 'Access is denied', detail: `You do not have sufficient privileges to delete ${o.name}, or this object is protected from accidental deletion.` });
    const sub = descendants(o.id);
    if (sub.length && !opts.recursive) return fail({ code: 'NotLeaf', error: 'The directory service can perform the requested operation only on a leaf object.' });
    const blocked = sub.find(x => x.protected || x.critical);
    if (blocked) return fail({ code: 'Protected', error: 'Access is denied', detail: `You do not have sufficient privileges to delete ${blocked.name}, or this object is protected from accidental deletion.` });
    const gone = new Set([o.id, ...sub.map(x => x.id)]);
    A().objects = objs().filter(x => !gone.has(x.id));
    for (const g of objs()) if (g.type === 'group') g.members = g.members.filter(m => !gone.has(m));
    for (const x of objs()) if (gone.has(x.managedBy)) x.managedBy = null;
    for (const x of objs()) if (gone.has(x.manager)) x.manager = null;
    for (const x of [o, ...sub]) {
      if (x.type === 'user') auditUser(4726, 'A user account was deleted.', x);
      if (x.type === 'group' && x.category === 'Security') WS.evt.audit({ Global: 4730, DomainLocal: 4734, Universal: 4758 }[x.scope], 'Security Group Management', `A security-enabled ${x.scope === 'DomainLocal' ? 'local' : x.scope.toLowerCase()} group was deleted.`, [['Deleted Group', [['Group Name', x.name], ['Group Domain', A().netbios]]]]);
      if (x.type === 'computer') WS.evt.audit(4743, 'Computer Account Management', 'A computer account was deleted.', [['Target Computer', [['Account Name', x.sam]]]]);
    }
    changed();
    return { ok: true, count: gone.size };
  }
  function rename(identity, newName) {
    const o = get(identity); if (!o) return notFound(identity);
    if (o.type === 'domainDNS' || o.type === 'builtinDomain') return fail({ code: 'Critical', error: 'Access is denied' });
    newName = String(newName || '').trim();
    const e = checkCn(newName, o.parentId, o); if (e) return fail(e);
    o.name = newName; o.modified = now();
    changed();
    return { ok: true };
  }
  function move(identity, target) {
    const o = get(identity); if (!o) return notFound(identity);
    const t = container(target);
    if (!t || !isContainer(t) || t.type === 'builtinDomain') return noParent(target);
    if (o.protected || (o.critical && !['user', 'group', 'computer'].includes(o.type))) return fail({ code: 'Protected', error: 'Access is denied' });
    if (o.id === t.id || descendants(o.id).some(d => d.id === t.id)) return fail({ code: 'Invalid', error: 'The operation cannot be performed because child objects exist. This operation can only be performed on a leaf object.' });
    if (o.type === 'organizationalUnit' && t.type === 'container') return fail({ code: 'Invalid', error: 'The object cannot be added because the parent is not on the list of possible superiors.' });
    const e = checkCn(o.name, t.id, o); if (e) return fail(e);
    o.parentId = t.id; o.modified = now();
    changed();
    return { ok: true };
  }
  const EDITABLE = {
    user: ['givenName', 'sn', 'initials', 'displayName', 'description', 'office', 'title', 'department', 'company', 'email', 'telephone', 'homeDirectory', 'homeDrive', 'profilePath', 'scriptPath', 'mustChange', 'cannotChange', 'neverExpires', 'protected', 'upn', 'sam', 'manager', 'streetAddress', 'city', 'state', 'postalCode', 'country', 'mobile', 'webPage'],
    group: ['description', 'email', 'notes', 'protected', 'sam', 'managedBy'],
    organizationalUnit: ['description', 'protected', 'managedBy', 'street', 'city', 'state', 'postalCode', 'country'],
    computer: ['description', 'protected', 'managedBy', 'location'],
    container: ['description', 'protected']
  };
  /** setProps(identity, { attr: value }) - unknown or read-only attributes are rejected. */
  function setProps(identity, props) {
    const o = get(identity); if (!o) return notFound(identity);
    const allowed = EDITABLE[o.type] || [];
    for (const [k, v] of Object.entries(props)) {
      if (!allowed.includes(k)) return fail({ code: 'Invalid', error: `The attribute '${k}' cannot be set on ${o.type} objects.` });
      if (k === 'sam') { const e = checkSam(String(v), o); if (e) return fail(e); }
      if (k === 'upn' && v) {
        const upn = String(v).includes('@') ? String(v) : v + '@' + A().domain;
        if (objs().some(x => x !== o && x.upn && ieq(x.upn, upn))) return fail({ code: 'UpnExists', error: 'The user logon name you have chosen is already in use in this enterprise. Choose another logon name, and then try again.' });
        props = { ...props, upn };
      }
      if ((k === 'manager' || k === 'managedBy') && v) { const m = get(v); if (!m) return notFound(v); props = { ...props, [k]: m.id }; }
    }
    Object.assign(o, props);
    o.modified = now();
    if (o.type === 'user') auditUser(4738, 'A user account was changed.', o);
    changed();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- membership */
  /** Allowed member types by group scope (single-domain forest). */
  function memberRule(g, m) {
    if (m.type === 'group') {
      if (g.scope === 'Global' && m.scope === 'DomainLocal') return 'A global group cannot have a local group as a member.';
      if (g.scope === 'Global' && m.scope === 'Universal') return 'A global group cannot have a universal group as a member.';
      if (g.scope === 'Universal' && m.scope === 'DomainLocal') return 'A universal group cannot have a local group as a member.';
      if (m.builtin) return 'A local group cannot have another cross-domain local group as a member.';
    }
    if (m.type === 'foreignSecurityPrincipal' && g.scope === 'Global') return 'A global group cannot have a cross-domain member.';
    return null;
  }
  function addMember(group, member) {
    const g = get(group, 'group'); if (!g) return notFound(group);
    const m = typeof member === 'object' ? byId(member.id) : get(member, ['user', 'group', 'computer', 'foreignSecurityPrincipal']);
    if (!m) return notFound(member);
    if (m.id === g.id) return fail({ code: 'GroupScope', error: 'A group cannot be made a member of itself.' });
    if (g.members.includes(m.id) || m.primaryGroupId === g.rid) return fail({ code: 'AlreadyMember', error: 'The specified account name is already a member of the group.' });
    const rule = memberRule(g, m); if (rule) return fail({ code: 'GroupScope', error: rule });
    g.members.push(m.id); g.modified = now();
    if (g.category === 'Security') WS.evt.audit({ Global: 4728, DomainLocal: 4732, Universal: 4756 }[g.scope], 'Security Group Management', `A member was added to a security-enabled ${g.scope === 'DomainLocal' ? 'local' : g.scope.toLowerCase()} group.`, [['Member', [['Account Name', dn(m)]]], ['Group', [['Group Name', g.name], ['Group Domain', A().netbios]]]]);
    changed();
    return { ok: true };
  }
  function removeMember(group, member) {
    const g = get(group, 'group'); if (!g) return notFound(group);
    const m = typeof member === 'object' ? byId(member.id) : get(member);
    if (!m) return notFound(member);
    if (m.primaryGroupId === g.rid) return fail({ code: 'PrimaryGroup', error: 'The primary group cannot be removed. Set another group as primary if you want to remove this one.' });
    if (!g.members.includes(m.id)) return fail({ code: 'NotMember', error: 'The specified account name is not a member of the group.' });
    g.members = g.members.filter(x => x !== m.id); g.modified = now();
    if (g.category === 'Security') WS.evt.audit({ Global: 4729, DomainLocal: 4733, Universal: 4757 }[g.scope], 'Security Group Management', `A member was removed from a security-enabled ${g.scope === 'DomainLocal' ? 'local' : g.scope.toLowerCase()} group.`, [['Member', [['Account Name', dn(m)]]], ['Group', [['Group Name', g.name], ['Group Domain', A().netbios]]]]);
    changed();
    return { ok: true };
  }
  /** Direct members (plus primary-group members, as ADUC and Get-ADGroupMember show them); recursive expands nested groups. */
  function members(group, recursive) {
    const g = get(group, 'group'); if (!g) return [];
    const direct = [...g.members.map(byId).filter(Boolean), ...objs().filter(o => o.primaryGroupId && o.primaryGroupId === g.rid)];
    if (!recursive) return direct;
    const out = new Map(), seen = new Set([g.id]);
    const walk = list => { for (const m of list) { if (m.type === 'group') { if (!seen.has(m.id)) { seen.add(m.id); walk(members(m)); } } else out.set(m.id, m); } };
    walk(direct);
    return [...out.values()];
  }
  /** Groups an object belongs to (primary group included); recursive follows nesting. */
  function memberOf(identity, recursive) {
    const o = typeof identity === 'object' ? byId(identity.id) : get(identity); if (!o) return [];
    const direct = objs().filter(g => g.type === 'group' && (g.members.includes(o.id) || (o.primaryGroupId && g.rid === o.primaryGroupId)));
    if (!recursive) return direct;
    const out = new Map();
    const walk = list => { for (const g of list) if (!out.has(g.id)) { out.set(g.id, g); walk(memberOf(g)); } };
    walk(direct);
    return [...out.values()];
  }
  function setPrimaryGroup(identity, group) {
    const u = resolveIdentity(identity, ['user', 'computer']); if (!u) return notFound(identity);
    const g = get(group, 'group'); if (!g) return notFound(group);
    if (!g.members.includes(u.id)) return fail({ code: 'NotMember', error: 'The user must be a member of the group before it can be set as the primary group.' });
    if (g.scope === 'DomainLocal' || g.category !== 'Security') return fail({ code: 'GroupScope', error: 'The primary group must be a global or universal security group.' });
    const old = objs().find(x => x.type === 'group' && x.rid === u.primaryGroupId);
    if (old && !old.members.includes(u.id)) old.members.push(u.id);
    g.members = g.members.filter(x => x !== u.id);
    u.primaryGroupId = g.rid;
    changed();
    return { ok: true };
  }
  /** Change group scope with the real conversion rules (Global <-> Universal <-> DomainLocal; no direct Global <-> DomainLocal). */
  function setGroupScope(group, scope, category) {
    const g = get(group, 'group'); if (!g) return notFound(group);
    if (g.builtin || g.critical) return fail({ code: 'Critical', error: 'Access is denied' });
    if (scope && !['Global', 'DomainLocal', 'Universal'].includes(scope)) return fail({ code: 'GroupScope', error: 'Specify a valid group scope: Global, DomainLocal, or Universal.' });
    const newCategory = category ? (/^dist/i.test(category) ? 'Distribution' : 'Security') : g.category;
    if (!scope || scope === g.scope) { g.category = newCategory; g.modified = now(); changed(); return { ok: true }; }
    const ms = g.members.map(byId).filter(Boolean);
    const parents = memberOf(g);
    if ((g.scope === 'Global' && scope === 'DomainLocal') || (g.scope === 'DomainLocal' && scope === 'Global')) return fail({ code: 'GroupScope', error: `The group scope cannot be changed directly from ${g.scope === 'DomainLocal' ? 'domain local' : 'global'} to ${scope === 'DomainLocal' ? 'domain local' : 'global'}. Change it to universal first.` });
    if (scope === 'Universal' && g.scope === 'Global' && parents.some(p => p.scope === 'Global')) return fail({ code: 'GroupScope', error: 'A global group that is a member of another global group cannot be changed to a universal group.' });
    if (scope === 'Universal' && g.scope === 'DomainLocal' && ms.some(m => m.type === 'group' && m.scope === 'DomainLocal')) return fail({ code: 'GroupScope', error: 'A universal group cannot have a local group as a member.' });
    if (scope === 'Global' && ms.some(m => m.type === 'group' && m.scope === 'Universal')) return fail({ code: 'GroupScope', error: 'A global group cannot have a universal group as a member.' });
    if (scope === 'DomainLocal' && parents.some(p => p.scope === 'Universal')) return fail({ code: 'GroupScope', error: 'A universal group cannot have a local group as a member.' });
    g.scope = scope; g.category = newCategory; g.modified = now();
    changed();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- queries */
  /** search({ type, under (container), scope: 'subtree'|'onelevel', name (wildcard), filter(o), advanced }) */
  function search(q = {}) {
    if (!A()) return [];
    const base = q.under ? container(q.under) : null;
    if (q.under && !base) return [];
    let list = base ? (q.scope === 'onelevel' ? children(base.id, { advanced: true }) : descendants(base.id)) : objs().slice();
    if (q.type) list = list.filter(o => [].concat(q.type).includes(o.type));
    if (!q.advanced) list = list.filter(o => !o.advanced && !(byId(o.parentId) || {}).advanced);
    if (q.name) { const re = U.wildcardToRegex(q.name); list = list.filter(o => re.test(o.name) || (o.sam && re.test(o.sam))); }
    if (q.filter) list = list.filter(q.filter);
    return list;
  }

  WS.sys.on('boot', ({ renamedFrom }) => {
    if (!A() || !renamedFrom) return;
    const c = objs().find(o => o.type === 'computer' && ieq(o.name, renamedFrom));
    if (c) { c.name = WS.sys.name; c.sam = WS.sys.name + '$'; c.dnsHostName = (WS.sys.name + '.' + A().domain).toLowerCase(); changed(); }
  });

  WS.ad = {
    isDC: () => !!A(),
    domain: () => A() && A().domain,
    netbios: () => A() && A().netbios,
    domainDN: () => A() ? dn(domainObj()) : '',
    usersContainerDN: () => A() ? dn(get('Users', 'container')) : '',
    root: () => A() ? domainObj() : null,
    validateDomainName, defaultNetbios, prereqCheck, installForest,
    dn, canonical, byId, byDn, get, resolveIdentity, container, children, descendants, search, isContainer,
    createUser, createGroup, createOU, createComputer, remove, rename, move, setProps, setPassword, setEnabled, unlock, verify,
    addMember, removeMember, members, memberOf, setPrimaryGroup, setGroupScope,
    policy: () => A() ? A().policy : null,
    setPolicy(props) {
      if (!A()) return notDC();
      const p = A().policy;
      for (const k of Object.keys(p)) if (k in props) p[k] = typeof p[k] === 'boolean' ? !!props[k] : Math.max(0, +props[k] || 0);
      changed();
      return { ok: true };
    }
  };
})();
