/* Security model:
 *   WS.local - local users and groups (lusrmgr.msc, *-LocalUser/*-LocalGroup, net user, net localgroup).
 *              A domain controller has no local SAM, so WS.local.available() is false after promotion.
 *   WS.sec   - password policy (local policy, or the Default Domain Policy on a DC).
 *   WS.fw    - Windows Defender Firewall profiles and rules (wf.msc, firewall.cpl, *-NetFirewallRule, netsh advfirewall).
 * State: local.users[], local.groups[], security.policy, firewall.profiles, firewall.rules[], firewall.networkCategory.
 * The built-in Administrator's password lives in system.adminPassword (the sign-in screen uses it). */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  /* ---------------------------------------------------------------- local accounts */
  const LOCAL_GROUPS = [
    ['Access Control Assistance Operators', 579, 'Members of this group can remotely query authorization attributes and permissions for resources on this computer.'],
    ['Administrators', 544, 'Administrators have complete and unrestricted access to the computer/domain', ['Administrator']],
    ['Backup Operators', 551, 'Backup Operators can override security restrictions for the sole purpose of backing up or restoring files'],
    ['Certificate Service DCOM Access', 574, 'Members of this group are allowed to connect to Certification Authorities in the enterprise'],
    ['Cryptographic Operators', 569, 'Members are authorized to perform cryptographic operations.'],
    ['Device Owners', 583, 'Members of this group can change system-wide settings.'],
    ['Distributed COM Users', 562, 'Members are allowed to launch, activate and use Distributed COM objects on this machine.'],
    ['Event Log Readers', 573, 'Members of this group can read event logs from local machine'],
    ['Guests', 546, 'Guests have the same access as members of the Users group by default, except for the Guest account which is further restricted', ['Guest']],
    ['Hyper-V Administrators', 578, 'Members of this group have complete and unrestricted access to all features of Hyper-V.'],
    ['IIS_IUSRS', 568, 'Built-in group used by Internet Information Services.'],
    ['Network Configuration Operators', 556, 'Members in this group can have some administrative privileges to manage configuration of networking features'],
    ['OpenSSH Users', 585, 'Members of this group may connect to this computer using SSH.'],
    ['Performance Log Users', 559, 'Members of this group may schedule logging of performance counters, enable trace providers, and collect event traces both locally and via remote access to this computer'],
    ['Performance Monitor Users', 558, 'Members of this group can access performance counter data locally and remotely'],
    ['Power Users', 547, 'Power Users are included for backwards compatibility and possess limited administrative powers'],
    ['Print Operators', 550, 'Members can administer printers installed on domain controllers'],
    ['RDS Endpoint Servers', 576, 'Servers in this group run virtual machines and host sessions where users RemoteApp programs and personal virtual desktops run. This group needs to be populated on servers running RD Connection Broker. RD Session Host servers and RD Virtualization Host servers used in the deployment need to be in this group.'],
    ['RDS Management Servers', 577, 'Servers in this group can perform routine administrative actions on servers running Remote Desktop Services. This group needs to be populated on all servers in a Remote Desktop Services deployment. The servers running the RDS Central Management service must be included in this group.'],
    ['RDS Remote Access Servers', 575, 'Servers in this group enable users of RemoteApp programs and personal virtual desktops access to these resources. In Internet-facing deployments, these servers are typically deployed in an edge network. This group needs to be populated on servers running RD Connection Broker. RD Gateway servers and RD Web Access servers used in the deployment need to be in this group.'],
    ['Remote Desktop Users', 555, 'Members in this group are granted the right to logon remotely'],
    ['Remote Management Users', 580, 'Members of this group can access WMI resources over management protocols (such as WS-Management via the Windows Remote Management service). This applies only to WMI namespaces that grant access to the user.'],
    ['Replicator', 552, 'Supports file replication in a domain'],
    ['Storage Replica Administrators', 582, 'Members of this group have complete and unrestricted access to all features of Storage Replica.'],
    ['System Managed Accounts Group', 581, 'Members of this group are managed by the system.', ['DefaultAccount']],
    ['Users', 545, 'Users are prevented from making accidental or intentional system-wide changes and can run most applications', ['NT AUTHORITY\\Authenticated Users', 'NT AUTHORITY\\INTERACTIVE']]
  ];

  WS.store.init('local', s => {
    const machineSid = `S-1-5-21-${U.randInt(1e9, 4e9)}-${U.randInt(1e9, 4e9)}-${U.randInt(1e9, 4e9)}`;
    const user = (name, rid, desc, enabled, extra) => Object.assign({ name, sid: `${machineSid}-${rid}`, fullName: '', description: desc, enabled, password: null, mustChange: false, cannotChange: false, neverExpires: true, builtin: true, created: new Date().toISOString(), lastLogon: null }, extra);
    s.local = {
      machineSid,
      nextRid: 1000,
      users: [
        user('Administrator', 500, 'Built-in account for administering the computer/domain', true),
        user('DefaultAccount', 503, 'A user account managed by the system.', false),
        user('Guest', 501, 'Built-in account for guest access to the computer/domain', false, { cannotChange: true }),
        user('WDAGUtilityAccount', 504, 'A user account managed and used by the system for Windows Defender Application Guard scenarios.', false, { neverExpires: false })
      ],
      groups: LOCAL_GROUPS.map(([name, rid, description, members]) => ({ name, sid: 'S-1-5-32-' + rid, description, members: (members || []).slice(), builtin: true }))
    };
  });
  WS.store.init('security', s => {
    s.security = { policy: { minLength: 0, complexity: true, maxAgeDays: 42, minAgeDays: 0, history: 0, lockoutThreshold: 0, lockoutMinutes: 10 } };
  });

  const L = () => WS.state.local;
  const ieq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const stripMachine = n => String(n).replace(new RegExp('^(\\.|' + WS.sys.name + ')\\\\', 'i'), '');
  const dcError = () => ({ ok: false, error: 'This computer is a domain controller. This snap-in cannot be used on a domain controller. Domain accounts are managed with the Active Directory Users and Computers snap-in.' });
  const BAD_CHARS = /["/\\[\]:;|=,+*?<>@]/;

  function findUser(name) { name = stripMachine(name); return L().users.find(u => ieq(u.name, name)) || null; }
  function findGroup(name) { name = stripMachine(name); return L().groups.find(g => ieq(g.name, name)) || null; }

  function policy() {
    if (WS.sys.isDC() && WS.state.ad && WS.state.ad.policy) return WS.state.ad.policy;
    return WS.state.security.policy;
  }
  function checkPassword(pw, ctx = {}) {
    const p = policy();
    return U.checkPassword(pw, { minLength: p.minLength, complexity: p.complexity, sam: ctx.sam, displayName: ctx.displayName, message: ctx.message });
  }

  function createUser(name, opts = {}) {
    if (WS.sys.isDC()) return dcError();
    name = String(name || '').trim();
    if (!name) return { ok: false, error: 'You must enter a user name.' };
    if (name.length > 20) return { ok: false, error: `The name provided is not a properly formed account name.` };
    if (BAD_CHARS.test(name) || /^\.+$/.test(name)) return { ok: false, error: `The user name entered contains one or more of the following illegal characters: " / \\ [ ] : ; | = , + * ? < > @` };
    if (findUser(name)) return { ok: false, code: 'UserExists', error: `The user ${name} already exists.` };
    if (findGroup(name)) return { ok: false, code: 'GroupExists', error: `The account ${name} already exists as a group.` };
    if (opts.password != null || !opts.noPassword) {
      const bad = checkPassword(opts.password || '', { sam: name, displayName: opts.fullName, message: 'The password does not meet the password policy requirements. Check the minimum password length, password complexity and password history requirements.' });
      if (bad) return { ok: false, code: 'InvalidPassword', error: bad };
    }
    const u = { name, sid: `${L().machineSid}-${L().nextRid++}`, fullName: opts.fullName || '', description: opts.description || '', enabled: opts.enabled !== false,
      password: opts.password || '', mustChange: !!opts.mustChange, cannotChange: !!opts.cannotChange, neverExpires: !!opts.neverExpires, builtin: false,
      created: new Date().toISOString(), lastLogon: null };
    L().users.push(u);
    findGroup('Users').members.push(name);
    WS.evt.audit(4720, 'User Account Management', 'A user account was created.', [['New Account', [['Security ID', `${WS.sys.name}\\${name}`], ['Account Name', name], ['Account Domain', WS.sys.name]]]]);
    WS.store.changed('local');
    return { ok: true, user: u };
  }
  function deleteUser(name) {
    if (WS.sys.isDC()) return dcError();
    const u = findUser(name);
    if (!u) return { ok: false, code: 'UserNotFound', error: `User ${name} was not found.` };
    if (u.builtin) return { ok: false, error: 'Cannot perform this operation on built-in accounts.' };
    L().users = L().users.filter(x => x !== u);
    L().groups.forEach(g => { g.members = g.members.filter(m => !ieq(m, u.name)); });
    WS.evt.audit(4726, 'User Account Management', 'A user account was deleted.', [['Target Account', [['Account Name', u.name], ['Account Domain', WS.sys.name]]]]);
    WS.store.changed('local');
    return { ok: true };
  }
  function renameUser(name, newName) {
    if (WS.sys.isDC()) return dcError();
    const u = findUser(name);
    if (!u) return { ok: false, code: 'UserNotFound', error: `User ${name} was not found.` };
    newName = String(newName || '').trim();
    if (!newName || BAD_CHARS.test(newName) || newName.length > 20) return { ok: false, error: 'The name provided is not a properly formed account name.' };
    if (!ieq(name, newName) && (findUser(newName) || findGroup(newName))) return { ok: false, error: `The account ${newName} already exists.` };
    L().groups.forEach(g => { g.members = g.members.map(m => ieq(m, u.name) ? newName : m); });
    u.name = newName;
    WS.store.changed('local');
    return { ok: true };
  }
  function setUser(name, props) {
    if (WS.sys.isDC()) return dcError();
    const u = findUser(name);
    if (!u) return { ok: false, code: 'UserNotFound', error: `User ${name} was not found.` };
    for (const k of ['fullName', 'description', 'mustChange', 'cannotChange', 'neverExpires', 'profilePath', 'logonScript', 'homeDirectory']) if (k in props) u[k] = props[k];
    if ('enabled' in props && u.enabled !== !!props.enabled) {
      u.enabled = !!props.enabled;
      WS.evt.audit(u.enabled ? 4722 : 4725, 'User Account Management', `A user account was ${u.enabled ? 'enabled' : 'disabled'}.`, [['Target Account', [['Account Name', u.name], ['Account Domain', WS.sys.name]]]]);
    }
    WS.store.changed('local');
    return { ok: true };
  }
  function setPassword(name, pw) {
    if (WS.sys.isDC() && !ieq(name, 'Administrator')) return dcError();
    const u = findUser(name);
    if (!u) return { ok: false, code: 'UserNotFound', error: `User ${name} was not found.` };
    const bad = checkPassword(pw, { sam: u.name, displayName: u.fullName });
    if (bad) return { ok: false, code: 'InvalidPassword', error: bad };
    if (ieq(u.name, 'Administrator')) { WS.state.system.adminPassword = pw; WS.store.changed('system'); }
    else u.password = pw;
    u.passwordLastSet = new Date().toISOString();
    WS.evt.audit(4724, 'User Account Management', "An attempt was made to reset an account's password.", [['Target Account', [['Account Name', u.name], ['Account Domain', WS.sys.name]]]]);
    WS.store.changed('local');
    return { ok: true };
  }
  /** Sign-in check: local account (or the domain on a DC, via WS.ad). */
  function verify(name, pw) {
    if (WS.sys.isDC() && WS.ad) return WS.ad.verify(name, pw);
    const u = findUser(name);
    if (!u) return { ok: false, error: 'The user name or password is incorrect. Try again.' };
    const real = ieq(u.name, 'Administrator') ? WS.state.system.adminPassword : u.password;
    if (real !== pw) return { ok: false, error: 'The user name or password is incorrect. Try again.' };
    if (!u.enabled) return { ok: false, error: 'Your account has been disabled. Please see your system administrator.' };
    u.lastLogon = new Date().toISOString();
    return { ok: true, user: u.name, mustChange: u.mustChange };
  }

  function createGroup(name, description) {
    if (WS.sys.isDC()) return dcError();
    name = String(name || '').trim();
    if (!name || BAD_CHARS.test(name) || name.length > 256) return { ok: false, error: 'The group name entered is not valid.' };
    if (findGroup(name)) return { ok: false, code: 'GroupExists', error: `The group ${name} already exists.` };
    if (findUser(name)) return { ok: false, error: `The account ${name} already exists as a user.` };
    const g = { name, sid: `${L().machineSid}-${L().nextRid++}`, description: description || '', members: [], builtin: false };
    L().groups.push(g);
    WS.evt.audit(4731, 'Security Group Management', 'A security-enabled local group was created.', [['New Group', [['Group Name', name], ['Group Domain', WS.sys.name]]]]);
    WS.store.changed('local');
    return { ok: true, group: g };
  }
  function setGroup(name, props) {
    if (WS.sys.isDC()) return dcError();
    const g = findGroup(name);
    if (!g) return { ok: false, code: 'GroupNotFound', error: `Group ${name} was not found.` };
    if ('description' in props) g.description = String(props.description || '');
    WS.store.changed('local');
    return { ok: true };
  }
  function renameGroup(name, newName) {
    if (WS.sys.isDC()) return dcError();
    const g = findGroup(name);
    if (!g) return { ok: false, code: 'GroupNotFound', error: `Group ${name} was not found.` };
    if (g.builtin) return { ok: false, error: 'Cannot perform this operation on built-in accounts.' };
    newName = String(newName || '').trim();
    if (!newName || BAD_CHARS.test(newName) || newName.length > 256) return { ok: false, error: 'The group name entered is not valid.' };
    if (!ieq(name, newName) && (findGroup(newName) || findUser(newName))) return { ok: false, error: `The account ${newName} already exists.` };
    g.name = newName;
    WS.store.changed('local');
    return { ok: true };
  }
  function deleteGroup(name) {
    if (WS.sys.isDC()) return dcError();
    const g = findGroup(name);
    if (!g) return { ok: false, code: 'GroupNotFound', error: `Group ${name} was not found.` };
    if (g.builtin) return { ok: false, error: 'Cannot perform this operation on built-in accounts.' };
    L().groups = L().groups.filter(x => x !== g);
    WS.store.changed('local');
    return { ok: true };
  }
  function addMember(group, member) {
    if (WS.sys.isDC()) return dcError();
    const g = findGroup(group);
    if (!g) return { ok: false, code: 'GroupNotFound', error: `Group ${group} was not found.` };
    const m = stripMachine(member);
    const u = findUser(m);
    const label = u ? u.name : m;
    if (!u && !/^NT AUTHORITY\\/i.test(m)) return { ok: false, code: 'PrincipalNotFound', error: `Principal ${member} was not found.` };
    if (g.members.some(x => ieq(x, label))) return { ok: false, code: 'MemberExists', error: `${WS.sys.name}\\${label} is already a member of group ${g.name}.` };
    g.members.push(label);
    WS.evt.audit(4732, 'Security Group Management', 'A member was added to a security-enabled local group.', [['Member', [['Account Name', label]]], ['Group', [['Group Name', g.name], ['Group Domain', 'Builtin']]]]);
    WS.store.changed('local');
    return { ok: true };
  }
  function removeMember(group, member) {
    if (WS.sys.isDC()) return dcError();
    const g = findGroup(group);
    if (!g) return { ok: false, code: 'GroupNotFound', error: `Group ${group} was not found.` };
    const m = stripMachine(member);
    if (!g.members.some(x => ieq(x, m))) return { ok: false, code: 'MemberNotFound', error: `Member ${member} was not found in group ${g.name}.` };
    g.members = g.members.filter(x => !ieq(x, m));
    WS.evt.audit(4733, 'Security Group Management', 'A member was removed from a security-enabled local group.', [['Member', [['Account Name', m]]], ['Group', [['Group Name', g.name], ['Group Domain', 'Builtin']]]]);
    WS.store.changed('local');
    return { ok: true };
  }

  WS.local = {
    available: () => !WS.sys.isDC(),
    users: () => L().users.slice().sort((a, b) => a.name.localeCompare(b.name)),
    groups: () => L().groups.slice().sort((a, b) => a.name.localeCompare(b.name)),
    user: findUser, group: findGroup,
    createUser, deleteUser, renameUser, setUser, setPassword, verify,
    createGroup, setGroup, renameGroup, deleteGroup, addMember, removeMember,
    groupsOf: name => L().groups.filter(g => g.members.some(m => ieq(m, stripMachine(name)))).map(g => g.name)
  };
  WS.sec = {
    policy, checkPassword,
    setPolicy(props) {
      const p = WS.state.security.policy;
      for (const k of Object.keys(p)) if (k in props) p[k] = typeof p[k] === 'boolean' ? !!props[k] : Math.max(0, +props[k] || 0);
      WS.store.changed('security');
      return { ok: true };
    }
  };

  /* ---------------------------------------------------------------- firewall */
  // [Name, DisplayName, Group, Direction, Protocol, LocalPort, Enabled, Profile]
  const BASE_RULES = [
    ['CoreNet-DHCP-In', 'Core Networking - Dynamic Host Configuration Protocol (DHCP-In)', 'Core Networking', 'Inbound', 'UDP', '68', true],
    ['CoreNet-DHCP-Out', 'Core Networking - Dynamic Host Configuration Protocol (DHCP-Out)', 'Core Networking', 'Outbound', 'UDP', '67', true],
    ['CoreNet-DNS-Out-UDP', 'Core Networking - DNS (UDP-Out)', 'Core Networking', 'Outbound', 'UDP', 'Any', true],
    ['CoreNet-ICMP4-DUFRAG-In', 'Core Networking - Destination Unreachable Fragmentation Needed (ICMPv4-In)', 'Core Networking', 'Inbound', 'ICMPv4', 'Any', true],
    ['CoreNet-IPv6-In', 'Core Networking - IPv6 (IPv6-In)', 'Core Networking', 'Inbound', 'IPv6', 'Any', true],
    ['CoreNet-Diag-ICMP4-EchoRequest-In', 'Core Networking Diagnostics - ICMP Echo Request (ICMPv4-In)', 'Core Networking Diagnostics', 'Inbound', 'ICMPv4', 'Any', false],
    ['CoreNet-Diag-ICMP4-EchoRequest-Out', 'Core Networking Diagnostics - ICMP Echo Request (ICMPv4-Out)', 'Core Networking Diagnostics', 'Outbound', 'ICMPv4', 'Any', false],
    ['FPS-ICMP4-ERQ-In', 'File and Printer Sharing (Echo Request - ICMPv4-In)', 'File and Printer Sharing', 'Inbound', 'ICMPv4', 'Any', false],
    ['FPS-ICMP6-ERQ-In', 'File and Printer Sharing (Echo Request - ICMPv6-In)', 'File and Printer Sharing', 'Inbound', 'ICMPv6', 'Any', false],
    ['FPS-SMB-In-TCP', 'File and Printer Sharing (SMB-In)', 'File and Printer Sharing', 'Inbound', 'TCP', '445', false],
    ['FPS-NB_Session-In-TCP', 'File and Printer Sharing (NB-Session-In)', 'File and Printer Sharing', 'Inbound', 'TCP', '139', false],
    ['FPS-NB_Name-In-UDP', 'File and Printer Sharing (NB-Name-In)', 'File and Printer Sharing', 'Inbound', 'UDP', '137', false],
    ['FPS-NB_Datagram-In-UDP', 'File and Printer Sharing (NB-Datagram-In)', 'File and Printer Sharing', 'Inbound', 'UDP', '138', false],
    ['FPS-SpoolSvc-In-TCP', 'File and Printer Sharing (Spooler Service - RPC)', 'File and Printer Sharing', 'Inbound', 'TCP', 'RPC', false],
    ['RemoteDesktop-UserMode-In-TCP', 'Remote Desktop - User Mode (TCP-In)', 'Remote Desktop', 'Inbound', 'TCP', '3389', false],
    ['RemoteDesktop-UserMode-In-UDP', 'Remote Desktop - User Mode (UDP-In)', 'Remote Desktop', 'Inbound', 'UDP', '3389', false],
    ['RemoteDesktop-Shadow-In-TCP', 'Remote Desktop - Shadow (TCP-In)', 'Remote Desktop', 'Inbound', 'TCP', 'Any', false],
    ['WINRM-HTTP-In-TCP', 'Windows Remote Management (HTTP-In)', 'Windows Remote Management', 'Inbound', 'TCP', '5985', true, 'Domain, Private'],
    ['WINRM-HTTP-In-TCP-PUBLIC', 'Windows Remote Management (HTTP-In)', 'Windows Remote Management', 'Inbound', 'TCP', '5985', true, 'Public'],
    ['WMI-WINMGMT-In-TCP', 'Windows Management Instrumentation (WMI-In)', 'Windows Management Instrumentation (WMI)', 'Inbound', 'TCP', 'Any', false],
    ['WMI-RPCSS-In-TCP', 'Windows Management Instrumentation (DCOM-In)', 'Windows Management Instrumentation (WMI)', 'Inbound', 'TCP', '135', false],
    ['RemoteEventLogSvc-In-TCP', 'Remote Event Log Management (RPC)', 'Remote Event Log Management', 'Inbound', 'TCP', 'RPC', false],
    ['RemoteSvcAdmin-In-TCP', 'Remote Service Management (RPC)', 'Remote Service Management', 'Inbound', 'TCP', 'RPC', false],
    ['RemoteTask-In-TCP', 'Remote Scheduled Tasks Management (RPC)', 'Remote Scheduled Tasks Management', 'Inbound', 'TCP', 'RPC', false],
    ['RVM-VDS-In-TCP', 'Remote Volume Management - Virtual Disk Service (RPC)', 'Remote Volume Management', 'Inbound', 'TCP', 'RPC', false],
    ['RemoteFwAdmin-In-TCP', 'Windows Defender Firewall Remote Management (RPC)', 'Windows Defender Firewall Remote Management', 'Inbound', 'TCP', 'RPC', false],
    ['MsMpEng-In', 'Microsoft Defender Antivirus (MsMpEng)', 'Microsoft Defender Antivirus', 'Inbound', 'Any', 'Any', true]
  ];
  /** Rule groups that a role adds (enabled) when it is installed. */
  const FEATURE_RULES = {
    'Web-Server': [
      ['IIS-WebServerRole-HTTP-In-TCP', 'World Wide Web Services (HTTP Traffic-In)', 'World Wide Web Services (HTTP)', 'Inbound', 'TCP', '80', true],
      ['IIS-WebServerRole-HTTPS-In-TCP', 'World Wide Web Services (HTTPS Traffic-In)', 'Secure World Wide Web Services (HTTPS)', 'Inbound', 'TCP', '443', true]
    ],
    DNS: [
      ['DNSSrv-TCP-In', 'DNS (TCP, Incoming)', 'DNS Service', 'Inbound', 'TCP', '53', true],
      ['DNSSrv-UDP-In', 'DNS (UDP, Incoming)', 'DNS Service', 'Inbound', 'UDP', '53', true],
      ['DNSSrv-RPC-TCP-In', 'RPC (TCP, Incoming)', 'DNS Service', 'Inbound', 'TCP', 'RPC', true]
    ],
    DHCP: [
      ['DHCPServer-v4-UDP-In', 'DHCP Server v4 (UDP-In)', 'DHCP Server', 'Inbound', 'UDP', '67', true],
      ['DHCPServer-v6-UDP-In', 'DHCP Server v6 (UDP-In)', 'DHCP Server', 'Inbound', 'UDP', '547', true],
      ['DHCPServer-RPC-In', 'DHCP Server (RPC-In)', 'DHCP Server Management', 'Inbound', 'TCP', 'RPC', true]
    ],
    'Hyper-V': [['VIRT-HVRHTTPL-In-TCP-NoScope', 'Hyper-V Replica HTTP Listener (TCP-In)', 'Hyper-V Replica HTTP', 'Inbound', 'TCP', '80', false]],
    'FS-FileServer': []
  };
  /** Added by the AD DS promotion (see ad.js). */
  const ADDS_RULES = [
    ['ADDS-LDAP-TCP-In', 'Active Directory Domain Controller - LDAP (TCP-In)', 'Active Directory Domain Services', 'Inbound', 'TCP', '389', true],
    ['ADDS-LDAP-UDP-In', 'Active Directory Domain Controller - LDAP (UDP-In)', 'Active Directory Domain Services', 'Inbound', 'UDP', '389', true],
    ['ADDS-LDAPS-TCP-In', 'Active Directory Domain Controller - Secure LDAP (TCP-In)', 'Active Directory Domain Services', 'Inbound', 'TCP', '636', true],
    ['ADDS-LDAPGC-TCP-In', 'Active Directory Domain Controller - LDAP for Global Catalog (TCP-In)', 'Active Directory Domain Services', 'Inbound', 'TCP', '3268', true],
    ['ADDS-SAMLSA-NP-TCP-In', 'Active Directory Domain Controller - SAM/LSA (NP-TCP-In)', 'Active Directory Domain Services', 'Inbound', 'TCP', '445', true],
    ['ADDS-RPC-TCP-In', 'Active Directory Domain Controller (RPC)', 'Active Directory Domain Services', 'Inbound', 'TCP', 'RPC', true],
    ['ADDS-ICMP4-In', 'Active Directory Domain Controller - Echo Request (ICMPv4-In)', 'Active Directory Domain Services', 'Inbound', 'ICMPv4', 'Any', true],
    ['ADWS-TCP-In', 'Active Directory Web Services (TCP-In)', 'Active Directory Web Services', 'Inbound', 'TCP', '9389', true],
    ['KDC-TCP-In', 'Kerberos Key Distribution Center (TCP-In)', 'Kerberos Key Distribution Center', 'Inbound', 'TCP', '88', true],
    ['KDC-UDP-In', 'Kerberos Key Distribution Center (UDP-In)', 'Kerberos Key Distribution Center', 'Inbound', 'UDP', '88', true]
  ];
  /** ICMP type:code of the predefined ICMP rules (8 = Echo Request, i.e. ping; 3:4 = Fragmentation Needed). */
  const ICMP_TYPES = { 'CoreNet-ICMP4-DUFRAG-In': '3:4', 'CoreNet-Diag-ICMP4-EchoRequest-In': '8:*', 'CoreNet-Diag-ICMP4-EchoRequest-Out': '8:*', 'FPS-ICMP4-ERQ-In': '8:*', 'FPS-ICMP6-ERQ-In': '128:*', 'ADDS-ICMP4-In': '8:*' };
  /** [program, service] of predefined rules. A program rule without a port only matches traffic for that program (see allows). */
  const SVCHOST = '%SystemRoot%\\system32\\svchost.exe';
  const PROGRAMS = {
    'MsMpEng-In': ['%ProgramData%\\Microsoft\\Windows Defender\\Platform\\4.18.24090.11-0\\MsMpEng.exe'],
    'RemoteDesktop-UserMode-In-TCP': [SVCHOST, 'TermService'], 'RemoteDesktop-UserMode-In-UDP': [SVCHOST, 'TermService'], 'RemoteDesktop-Shadow-In-TCP': ['%SystemRoot%\\system32\\RdpSa.exe'],
    'FPS-SMB-In-TCP': ['System'], 'FPS-NB_Session-In-TCP': ['System'], 'WMI-WINMGMT-In-TCP': [SVCHOST, 'winmgmt'],
    'DNSSrv-TCP-In': ['%systemroot%\\System32\\dns.exe'], 'DNSSrv-UDP-In': ['%systemroot%\\System32\\dns.exe']
  };
  const mkRule = ([name, displayName, group, direction, protocol, localPort, enabled, profile]) =>
    ({ name, displayName, group, direction, protocol, localPort, remotePort: 'Any', remoteAddress: profile === 'Public' && /WINRM/.test(name) ? 'LocalSubnet' : 'Any', localAddress: 'Any',
      program: PROGRAMS[name] ? PROGRAMS[name][0] : 'Any', service: PROGRAMS[name] && PROGRAMS[name][1] ? PROGRAMS[name][1] : 'Any', action: 'Allow', enabled: !!enabled, profile: profile || 'Any',
      builtin: true, description: '', edgeTraversal: 'Block', ...(ICMP_TYPES[name] ? { icmpType: ICMP_TYPES[name] } : {}) });

  const LOG_FILE = '%systemroot%\\system32\\LogFiles\\Firewall\\pfirewall.log';
  const defaultProfile = () => ({ enabled: true, inbound: 'Block', outbound: 'Allow', blockAll: false, notify: false, logDropped: false, logAllowed: false, logFile: LOG_FILE, logMaxKB: 4096 });
  WS.store.init('firewall', s => {
    s.firewall = { networkCategory: 'Public', profiles: { Domain: defaultProfile(), Private: defaultProfile(), Public: defaultProfile() }, rules: BASE_RULES.map(mkRule) };
  });

  const FW = () => WS.state.firewall;
  const PROFILES = ['Domain', 'Private', 'Public'];
  /** A profile with the newer settings filled in (older saved states lack them). */
  function profile(name) {
    const n = PROFILES.find(p => ieq(p, name));
    const p = n && FW().profiles[n];
    if (!p) return null;
    for (const [k, v] of Object.entries(defaultProfile())) if (!(k in p)) p[k] = v;
    return p;
  }
  /** Fields newer than some saved rules. */
  const ruleDefaults = r => ({ localAddress: 'Any', remotePort: 'Any', remoteAddress: 'Any', program: 'Any', service: 'Any', edgeTraversal: 'Block', description: '', group: '', ...r });
  const ADDR_WORDS = ['LocalSubnet', 'DNS', 'DHCP', 'WINS', 'DefaultGateway', 'Internet', 'Intranet', 'IntranetRemoteAccess', 'PlayToDevice'];
  const isIp4 = x => /^\d{1,3}(\.\d{1,3}){3}$/.test(x) && x.split('.').every(n => +n <= 255);
  /** One scope entry: Any, a keyword, an IPv4 address, subnet (a.b.c.d/nn or /mask) or range (a-b). */
  function validAddr(x) {
    x = String(x).trim();
    if (ieq(x, 'Any') || ADDR_WORDS.some(w => ieq(w, x))) return true;
    if (isIp4(x)) return true;
    const sub = x.match(/^([\d.]+)\/([\d.]+)$/);
    if (sub) return isIp4(sub[1]) && (/^\d+$/.test(sub[2]) ? +sub[2] <= 32 : isIp4(sub[2]));
    const rng = x.match(/^([\d.]+)-([\d.]+)$/);
    if (rng) return isIp4(rng[1]) && isIp4(rng[2]) && U.ipToInt(rng[1]) <= U.ipToInt(rng[2]);
    return /^[0-9a-f:]+(\/\d+)?$/i.test(x) && x.includes(':');
  }
  const normAddr = v => { const list = [].concat(v == null || v === '' ? 'Any' : v).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean); return list.some(x => ieq(x, 'Any')) || !list.length ? 'Any' : list.map(x => ADDR_WORDS.find(w => ieq(w, x)) || x).join(','); };
  /** 'Any', 'Domain, Private', ['Public']... -> the canonical "Domain, Private" string ('Any' when all three). */
  function normProfile(v) {
    if (v == null || ieq(v, 'Any') || ieq(v, 'All')) return 'Any';
    const set = new Set([].concat(v).flatMap(x => String(x).split(/[,\s]+/)).filter(Boolean).map(x => PROFILES.find(p => ieq(p, x.trim())) || '?'));
    if (set.has('?')) return null;
    if (!set.size) return null;
    return set.size === 3 ? 'Any' : PROFILES.filter(p => set.has(p)).join(', ');
  }
  /** Does a rule's scope (a remoteAddress / localAddress list) include ip? */
  function inScope(scope, ip) {
    if (!scope || ieq(scope, 'Any') || !ip) return true;
    const me = WS.net.adapter();
    return String(scope).split(',').some(x => {
      x = x.trim();
      if (ieq(x, 'LocalSubnet')) return !!me.ip && U.inSubnet(ip, me.ip, me.prefix);
      if (ieq(x, 'DefaultGateway')) return ip === me.gateway;
      if (ieq(x, 'DNS')) return (me.dnsServers || []).includes(ip);
      if (ieq(x, 'Intranet') || ieq(x, 'DHCP') || ieq(x, 'WINS')) return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
      if (ieq(x, 'Internet')) return !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(ip);
      const sub = x.match(/^([\d.]+)\/([\d.]+)$/);
      if (sub) return U.inSubnet(ip, sub[1], /^\d+$/.test(sub[2]) ? +sub[2] : U.maskToPrefix(sub[2]));
      const rng = x.match(/^([\d.]+)-([\d.]+)$/);
      if (rng) return U.ipToInt(ip) >= U.ipToInt(rng[1]) && U.ipToInt(ip) <= U.ipToInt(rng[2]);
      return x === ip;
    });
  }
  const portMatch = (spec, port) => spec == null || spec === 'Any' || port == null || String(spec).split(',').some(x => { const [a, b] = x.trim().split('-').map(Number); return port >= a && port <= (b || a); });
  function findRules(nameOrDisplay) {
    const re = /[*?]/.test(nameOrDisplay) ? U.wildcardToRegex(nameOrDisplay) : null;
    return FW().rules.filter(r => re ? (re.test(r.name) || re.test(r.displayName)) : (ieq(r.name, nameOrDisplay) || ieq(r.displayName, nameOrDisplay)));
  }
  function addRules(defs) {
    for (const d of defs) if (!FW().rules.some(r => r.name === d[0])) FW().rules.push(mkRule(d));
    WS.store.changed('firewall');
  }
  const VALID_PROTO = ['TCP', 'UDP', 'ICMPv4', 'ICMPv6', 'Any'];
  /** Port lists: Any, numbers and ranges; local ports of predefined rules can also be RPC keywords. */
  const validPorts = (p, remote) => p === 'Any' || (!remote && ['RPC', 'RPC-EPMap', 'IPHTTPS', 'Teredo', 'PlayToDiscovery'].includes(p)) || String(p).split(',').every(x => /^\d+(-\d+)?$/.test(x.trim()) && x.split('-').every(n => +n >= 0 && +n <= 65535));

  WS.fw = {
    profiles: () => FW().profiles,
    /** The profile in use: Domain on a DC, otherwise the network category (Public until changed). */
    activeProfile: () => WS.sys.isDC() ? 'Domain' : FW().networkCategory,
    setNetworkCategory(cat) {
      if (!['Public', 'Private'].includes(cat)) return { ok: false, error: `Unable to set NetworkCategory to '${cat}'.` };
      if (WS.sys.isDC()) return { ok: false, error: 'Unable to set NetworkCategory to \'' + cat + '\'. This could be due to one of the following reasons: 1) The network is a domain-authenticated network.' };
      FW().networkCategory = cat; WS.store.changed('firewall'); return { ok: true };
    },
    /** setProfile(name, { enabled, inbound: 'Block'|'Allow', blockAll, outbound, notify, logDropped, logAllowed, logFile, logMaxKB }) */
    setProfile(name, props) {
      const p = profile(name);
      if (!p) return { ok: false, error: `The profile '${name}' was not found.` };
      if ('logMaxKB' in props && !(Number.isInteger(+props.logMaxKB) && +props.logMaxKB >= 1 && +props.logMaxKB <= 32767)) return { ok: false, error: 'The log file size limit must be between 1 and 32767 KB.' };
      if ('logFile' in props && !String(props.logFile || '').trim()) return { ok: false, error: 'Specify a name for the log file.' };
      for (const k of ['enabled', 'notify', 'logDropped', 'logAllowed', 'blockAll']) if (k in props) p[k] = !!props[k];
      if (props.inbound) p.inbound = props.inbound === 'Allow' ? 'Allow' : 'Block';
      if (props.outbound) p.outbound = props.outbound === 'Block' ? 'Block' : 'Allow';
      if ('logFile' in props) p.logFile = String(props.logFile).trim();
      if ('logMaxKB' in props) p.logMaxKB = +props.logMaxKB;
      WS.store.changed('firewall');
      return { ok: true };
    },
    profile,
    /** setRule(name, { displayName, description, enabled, action, profile, protocol, localPort, remotePort, localAddress, remoteAddress, program, service, edgeTraversal })
     *  (Set-NetFirewallRule and the rule Properties sheet). Everything is validated before anything changes. */
    setRule(name, props) {
      const r = FW().rules.find(x => x.name === name) || findRules(name)[0];
      if (!r) return { ok: false, code: 'NotFound', error: `No MSFT_NetFirewallRule objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
      const next = { ...ruleDefaults(r), ...r };
      if ('displayName' in props) { const d = String(props.displayName || '').trim(); if (!d) return { ok: false, error: 'The rule must have a name.' }; next.displayName = d; }
      if ('description' in props) next.description = String(props.description || '');
      if ('enabled' in props) next.enabled = !!props.enabled;
      if ('action' in props) next.action = props.action === 'Block' ? 'Block' : 'Allow';
      if ('profile' in props) { const p = normProfile(props.profile); if (!p) return { ok: false, error: 'Select at least one profile.' }; next.profile = p; }
      if ('protocol' in props) { const p = VALID_PROTO.find(x => ieq(x, props.protocol)); if (!p) return { ok: false, error: `The protocol '${props.protocol}' is not valid.` }; next.protocol = p; }
      for (const k of ['localPort', 'remotePort']) if (k in props) next[k] = props[k] == null || props[k] === '' ? 'Any' : [].concat(props[k]).join(',').replace(/\s+/g, '');
      if (!['TCP', 'UDP'].includes(next.protocol)) { next.localPort = 'Any'; next.remotePort = 'Any'; }
      if (!validPorts(next.localPort) || !validPorts(next.remotePort, true)) return { ok: false, error: 'The port is not valid. Specify a port number or range between 0 and 65535.' };
      for (const k of ['localAddress', 'remoteAddress']) if (k in props) {
        const v = normAddr(props[k]);
        if (v !== 'Any' && !v.split(',').every(validAddr)) return { ok: false, error: `The IP address ${v.split(',').find(x => !validAddr(x))} is not valid.` };
        next[k] = v;
      }
      if ('program' in props) next.program = String(props.program || '').trim() || 'Any';
      if ('service' in props) next.service = String(props.service || '').trim() || 'Any';
      if ('edgeTraversal' in props) { const e = ['Block', 'Allow', 'DeferToUser', 'DeferToApp'].find(x => ieq(x, props.edgeTraversal)); if (!e) return { ok: false, error: 'The edge traversal setting is not valid.' }; next.edgeTraversal = e; }
      Object.assign(r, next);
      WS.store.changed('firewall');
      return { ok: true, rule: r };
    },
    rules: (filter = {}) => FW().rules.filter(r => (!filter.direction || r.direction === filter.direction) && (!filter.group || ieq(r.group, filter.group)) && (filter.enabled == null || r.enabled === filter.enabled)),
    find: findRules,
    setEnabled(nameOrDisplay, enabled) {
      const rs = findRules(nameOrDisplay);
      if (!rs.length) return { ok: false, code: 'NotFound', error: `No MSFT_NetFirewallRule objects found with property 'DisplayName' equal to '${nameOrDisplay}'.` };
      rs.forEach(r => { r.enabled = !!enabled; });
      WS.store.changed('firewall');
      return { ok: true, count: rs.length };
    },
    setGroupEnabled(group, enabled) {
      const rs = FW().rules.filter(r => ieq(r.group, group));
      if (!rs.length) return { ok: false, code: 'NotFound', error: `No MSFT_NetFirewallRule objects found with property 'DisplayGroup' equal to '${group}'.` };
      rs.forEach(r => { r.enabled = !!enabled; });
      WS.store.changed('firewall');
      return { ok: true, count: rs.length };
    },
    /** New-NetFirewallRule: { displayName, direction, action, protocol, localPort, remoteAddress, program, profile, enabled, description, group } */
    newRule(def) {
      const displayName = String(def.displayName || '').trim();
      if (!displayName) return { ok: false, error: 'The rule must have a name.' };
      const protocol = VALID_PROTO.find(p => ieq(p, def.protocol || 'Any'));
      if (!protocol) return { ok: false, error: `The protocol '${def.protocol}' is not valid.` };
      const localPort = def.localPort == null || def.localPort === '' ? 'Any' : [].concat(def.localPort).join(',').replace(/\s+/g, '');
      const remotePort = def.remotePort == null || def.remotePort === '' ? 'Any' : [].concat(def.remotePort).join(',').replace(/\s+/g, '');
      if ((localPort !== 'Any' || remotePort !== 'Any') && !['TCP', 'UDP'].includes(protocol)) return { ok: false, error: 'The port number is only valid for the TCP and UDP protocols.' };
      if (!validPorts(localPort) || !validPorts(remotePort, true)) return { ok: false, error: 'The port is not valid. Specify a port number or range between 0 and 65535.' };
      const profile = normProfile(def.profile);
      if (!profile) return { ok: false, error: 'Select at least one profile.' };
      const addr = {};
      for (const k of ['localAddress', 'remoteAddress']) {
        addr[k] = normAddr(def[k]);
        if (addr[k] !== 'Any' && !addr[k].split(',').every(validAddr)) return { ok: false, error: `The IP address ${addr[k].split(',').find(x => !validAddr(x))} is not valid.` };
      }
      if (def.name && FW().rules.some(x => ieq(x.name, def.name))) return { ok: false, code: 'Exists', error: `Cannot create a file when that file already exists.` };
      const r = { name: def.name || '{' + U.guid() + '}', displayName, group: def.group || '', direction: def.direction === 'Outbound' ? 'Outbound' : 'Inbound', protocol, localPort,
        remotePort, localAddress: addr.localAddress, remoteAddress: addr.remoteAddress, program: def.program || 'Any', service: def.service || 'Any', action: def.action === 'Block' ? 'Block' : 'Allow',
        enabled: def.enabled !== false, profile, builtin: false, description: def.description || '', edgeTraversal: 'Block' };
      FW().rules.push(r);
      WS.store.changed('firewall');
      return { ok: true, rule: r };
    },
    removeRule(nameOrDisplay) {
      const rs = findRules(nameOrDisplay);
      if (!rs.length) return { ok: false, code: 'NotFound', error: `No MSFT_NetFirewallRule objects found with property 'DisplayName' equal to '${nameOrDisplay}'.` };
      FW().rules = FW().rules.filter(r => !rs.includes(r));
      WS.store.changed('firewall');
      return { ok: true, count: rs.length };
    },
    /** Would a connection be allowed right now? allows('Inbound', 'TCP', 445, { from: '192.168.1.50', program }) - the active profile's
     *  rules decide: a matching Block rule wins, then a matching Allow rule, then the profile default ("Block all connections"
     *  ignores the Allow rules). Program-specific rules only match when o.program is given. */
    allows(direction, protocol, port, o = {}) {
      const prof = WS.fw.activeProfile();
      const p = profile(prof);
      if (!p.enabled) return true;
      const inbound = direction !== 'Outbound';
      const remote = o.from || o.to || null;
      const applies = r => r.enabled && r.direction === (inbound ? 'Inbound' : 'Outbound') && (r.profile === 'Any' || r.profile.split(/,\s*/).includes(prof)) &&
        (r.protocol === 'Any' || ieq(r.protocol, protocol)) && portMatch(inbound ? r.localPort : r.remotePort || 'Any', port) &&
        inScope(r.remoteAddress, remote) &&
        // a program rule matches that program's traffic; one that also names a port (svchost-hosted RDP) matches the port
        (!r.program || r.program === 'Any' || (o.program ? ieq(r.program, o.program) : (inbound ? r.localPort : r.remotePort || 'Any') !== 'Any')) &&
        (r.icmpType == null || o.icmpType == null || String(r.icmpType).split(':')[0] === String(o.icmpType));
      const hits = FW().rules.filter(applies);
      if (hits.some(r => r.action === 'Block')) return false;
      if (inbound && p.blockAll) return false;
      return hits.length > 0 || (inbound ? p.inbound === 'Allow' : p.outbound !== 'Block');
    },
    allowsInbound: (protocol, port, o) => WS.fw.allows('Inbound', protocol, port, o),
    /** Restore Default Policy / netsh advfirewall reset: the install-time rules (plus those of installed roles and AD DS) and profiles. */
    restoreDefaults() {
      const rules = BASE_RULES.map(mkRule);
      for (const [id, defs] of Object.entries(FEATURE_RULES)) if (WS.features.isInstalled(id)) rules.push(...defs.map(mkRule));
      if (WS.sys.isDC()) rules.push(...ADDS_RULES.map(mkRule));
      FW().rules = rules;
      FW().profiles = { Domain: defaultProfile(), Private: defaultProfile(), Public: defaultProfile() };
      if (WS.features.isInstalled('FS-FileServer')) WS.fw.setGroupEnabled('File and Printer Sharing', true);
      if (WS.state.system.rdpEnabled) WS.fw.setGroupEnabled('Remote Desktop', true);
      WS.store.changed('firewall');
      return { ok: true };
    },
    /** Export Policy... / netsh advfirewall export: the profiles and rules as text (a .wfw file in the lab). */
    exportPolicy: () => JSON.stringify({ format: 'ws2025lab-wfw', version: 1, profiles: FW().profiles, rules: FW().rules }, null, 1),
    importPolicy(text) {
      let o;
      try { o = JSON.parse(text); } catch (e) { o = null; }
      if (!o || o.format !== 'ws2025lab-wfw' || !o.profiles || !Array.isArray(o.rules)) return { ok: false, error: 'The policy file is not valid. Specify a file exported by Windows Defender Firewall with Advanced Security.' };
      FW().profiles = Object.fromEntries(PROFILES.map(n => [n, { ...defaultProfile(), ...(o.profiles[n] || {}) }]));
      FW().rules = o.rules.map(r => ({ ...r }));
      WS.store.changed('firewall');
      return { ok: true };
    },
    normProfile, validAddr, inScope, ruleDefaults, LOG_FILE,
    addRules,
    ADDS_RULES
  };

  WS.features.on('install', id => { if (FEATURE_RULES[id]) addRules(FEATURE_RULES[id]); });
  WS.features.on('uninstall', id => {
    if (!FEATURE_RULES[id]) return;
    const names = new Set(FEATURE_RULES[id].map(r => r[0]));
    FW().rules = FW().rules.filter(r => !names.has(r.name));
    WS.store.changed('firewall');
  });
})();
