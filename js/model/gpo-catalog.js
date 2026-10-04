/* Group Policy settings catalog: WS.gpoCatalog (data only).
 * The Group Policy Management Editor's tree and the policy settings the lab models, with their real names,
 * GptTmpl.inf sections (security settings) or registry values (Administrative Templates) and condensed help text.
 *
 * Tree node: { id, label, side: 'computer'|'user', kind, children[] }
 *   kind: 'folder' (sub-folders only), 'security' (Policy | Policy Setting list), 'services' (System Services),
 *         'admx' (Administrative Templates folder: sub-folders + Setting | State | Comment), 'all' (All Settings),
 *         'empty' (a list with nothing in it), 'info' (a short note; node.info), 'pref' (a Group Policy Preferences list).
 * Setting: { key, side, node, name, kind, explain, ... }
 *   security kinds: 'num' { min, max, unit, prompt, dflt }, 'bool', 'audit' (1 = Success, 2 = Failure), 'accounts',
 *                   'text', 'multitext', 'select' { choices: [{ value, label }] }; inf: [section, name] for GptTmpl.inf.
 *   'policy' (Administrative Templates): reg 'HKLM\\path!Value', on / off values, supported, options[]:
 *            { id, type: 'text'|'number'|'select'|'check'|'list', label, dflt, min, max, choices, reg? }.
 * Values stored in a GPO: security settings hold the value itself; policies hold { state: 'Enabled'|'Disabled', options, comment }. */
(function () {
  'use strict';
  const WS = window.WS;

  /* ---------------------------------------------------------------- tree */
  const N = (id, label, kind, children, extra) => Object.assign({ id, label, kind: kind || 'folder', children: children || [] }, extra);
  const PREF_INFO = 'This preference extension is not modelled in the lab simulator (Drive Maps is). Use Policies for settings that are enforced.';
  const securityTree = side => side === 'computer'
    ? N('c.sec', 'Security Settings', 'folder', [
      N('c.sec.acct', 'Account Policies', 'folder', [
        N('c.sec.pw', 'Password Policy', 'security'), N('c.sec.lock', 'Account Lockout Policy', 'security'), N('c.sec.krb', 'Kerberos Policy', 'security')]),
      N('c.sec.local', 'Local Policies', 'folder', [
        N('c.sec.audit', 'Audit Policy', 'security'), N('c.sec.ura', 'User Rights Assignment', 'security'), N('c.sec.opt', 'Security Options', 'security')]),
      N('c.sec.evt', 'Event Log', 'security'),
      N('c.sec.rg', 'Restricted Groups', 'empty'),
      N('c.sec.svc', 'System Services', 'services'),
      N('c.sec.reg', 'Registry', 'empty'),
      N('c.sec.fs', 'File System', 'empty'),
      N('c.sec.wired', 'Wired Network (IEEE 802.3) Policies', 'empty'),
      N('c.sec.fw', 'Windows Defender Firewall with Advanced Security', 'info', [], { info: 'Firewall rules in Group Policy are not modelled. Use the Administrative Templates > Network > Network Connections > Windows Defender Firewall settings, or wf.msc on the server.' }),
      N('c.sec.nlm', 'Network List Manager Policies', 'empty'),
      N('c.sec.wifi', 'Wireless Network (IEEE 802.11) Policies', 'empty'),
      N('c.sec.pk', 'Public Key Policies', 'empty'),
      N('c.sec.srp', 'Software Restriction Policies', 'info', [], { info: 'No Software Restriction Policies Defined' }),
      N('c.sec.acp', 'Application Control Policies', 'empty'),
      N('c.sec.ipsec', 'IP Security Policies on Active Directory', 'empty'),
      N('c.sec.aapc', 'Advanced Audit Policy Configuration', 'info', [], { info: 'Advanced Audit Policy Configuration is not modelled. Use Local Policies > Audit Policy.' })])
    : N('u.sec', 'Security Settings', 'folder', [N('u.sec.pk', 'Public Key Policies', 'empty'), N('u.sec.srp', 'Software Restriction Policies', 'info', [], { info: 'No Software Restriction Policies Defined' })]);

  const computer = N('c', 'Computer Configuration', 'folder', [
    N('c.pol', 'Policies', 'folder', [
      N('c.sw', 'Software Settings', 'folder', [N('c.sw.inst', 'Software installation', 'empty')]),
      N('c.win', 'Windows Settings', 'folder', [
        N('c.nrpt', 'Name Resolution Policy', 'info', [], { info: 'The Name Resolution Policy Table (NRPT) is not modelled in the lab simulator.' }),
        N('c.scripts', 'Scripts (Startup/Shutdown)', 'info', [], { info: 'Startup and shutdown scripts are not modelled in the lab simulator.' }),
        N('c.printers', 'Deployed Printers', 'empty'),
        securityTree('computer'),
        N('c.qos', 'Policy-based QoS', 'empty')]),
      N('c.adm', 'Administrative Templates: Policy definitions (ADMX files) retrieved from the local computer.', 'admx', [
        N('c.adm.cp', 'Control Panel', 'admx', [N('c.adm.cp.pers', 'Personalization', 'admx')]),
        N('c.adm.net', 'Network', 'admx', [
          N('c.adm.net.lm', 'Lanman Workstation', 'admx'),
          N('c.adm.net.nc', 'Network Connections', 'admx', [
            N('c.adm.net.fw', 'Windows Defender Firewall', 'admx', [N('c.adm.net.fw.dom', 'Domain Profile', 'admx'), N('c.adm.net.fw.std', 'Standard Profile', 'admx')])])]),
        N('c.adm.prn', 'Printers', 'admx'),
        N('c.adm.srv', 'Server', 'admx'),
        N('c.adm.start', 'Start Menu and Taskbar', 'admx'),
        N('c.adm.sys', 'System', 'admx', [
          N('c.adm.sys.gp', 'Group Policy', 'admx'), N('c.adm.sys.logon', 'Logon', 'admx'),
          N('c.adm.sys.ra', 'Remote Assistance', 'admx'), N('c.adm.sys.sm', 'Server Manager', 'admx')]),
        N('c.adm.wc', 'Windows Components', 'admx', [
          N('c.adm.wc.evt', 'Event Log Service', 'admx', [N('c.adm.wc.evt.app', 'Application', 'admx'), N('c.adm.wc.evt.sec', 'Security', 'admx'), N('c.adm.wc.evt.sys', 'System', 'admx')]),
          N('c.adm.wc.def', 'Microsoft Defender Antivirus', 'admx'),
          N('c.adm.wc.rds', 'Remote Desktop Services', 'admx', [
            N('c.adm.wc.rdsh', 'Remote Desktop Session Host', 'admx', [N('c.adm.wc.rdsh.conn', 'Connections', 'admx'), N('c.adm.wc.rdsh.sec', 'Security', 'admx')])]),
          N('c.adm.wc.ps', 'Windows PowerShell', 'admx'),
          N('c.adm.wc.wrm', 'Windows Remote Management (WinRM)', 'admx', [N('c.adm.wc.wrm.svc', 'WinRM Service', 'admx')]),
          N('c.adm.wc.wu', 'Windows Update', 'admx', [N('c.adm.wc.wu.eue', 'Manage end user experience', 'admx')])]),
        N('c.adm.all', 'All Settings', 'all')])]),
    N('c.pref', 'Preferences', 'folder', [
      N('c.pref.win', 'Windows Settings', 'folder', ['Environment', 'Files', 'Folders', 'Ini Files', 'Registry', 'Network Shares', 'Shortcuts'].map(l => N('c.pref.' + l.toLowerCase().replace(/ /g, ''), l, 'pref', [], { info: PREF_INFO }))),
      N('c.pref.cp', 'Control Panel Settings', 'folder', ['Data Sources', 'Devices', 'Folder Options', 'Local Users and Groups', 'Network Options', 'Power Options', 'Printers', 'Scheduled Tasks', 'Services'].map(l => N('c.pref.' + l.toLowerCase().replace(/ /g, ''), l, 'pref', [], { info: PREF_INFO })))])]);

  const user = N('u', 'User Configuration', 'folder', [
    N('u.pol', 'Policies', 'folder', [
      N('u.sw', 'Software Settings', 'folder', [N('u.sw.inst', 'Software installation', 'empty')]),
      N('u.win', 'Windows Settings', 'folder', [
        N('u.scripts', 'Scripts (Logon/Logoff)', 'info', [], { info: 'Logon and logoff scripts are not modelled in the lab simulator. A user\'s logon script can be set on the Profile tab in Active Directory Users and Computers.' }),
        securityTree('user'),
        N('u.fr', 'Folder Redirection', 'info', [], { info: 'Folder Redirection is not modelled in the lab simulator.' }),
        N('u.qos', 'Policy-based QoS', 'empty'),
        N('u.printers', 'Deployed Printers', 'empty')]),
      N('u.adm', 'Administrative Templates: Policy definitions (ADMX files) retrieved from the local computer.', 'admx', [
        N('u.adm.cp', 'Control Panel', 'admx', [N('u.adm.cp.disp', 'Display', 'admx'), N('u.adm.cp.pers', 'Personalization', 'admx'), N('u.adm.cp.prog', 'Programs', 'admx')]),
        N('u.adm.desk', 'Desktop', 'admx', [N('u.adm.desk.desk', 'Desktop', 'admx')]),
        N('u.adm.net', 'Network', 'admx', [N('u.adm.net.nc', 'Network Connections', 'admx')]),
        N('u.adm.sf', 'Shared Folders', 'admx'),
        N('u.adm.start', 'Start Menu and Taskbar', 'admx'),
        N('u.adm.sys', 'System', 'admx', [N('u.adm.sys.cad', 'Ctrl+Alt+Del Options', 'admx'), N('u.adm.sys.logon', 'Logon', 'admx')]),
        N('u.adm.wc', 'Windows Components', 'admx', [N('u.adm.wc.fe', 'File Explorer', 'admx'), N('u.adm.wc.ps', 'Windows PowerShell', 'admx')]),
        N('u.adm.all', 'All Settings', 'all')])]),
    N('u.pref', 'Preferences', 'folder', [
      N('u.pref.win', 'Windows Settings', 'folder', ['Applications', 'Drive Maps', 'Environment', 'Files', 'Folders', 'Ini Files', 'Registry', 'Shortcuts'].map(l => N('u.pref.' + l.toLowerCase().replace(/ /g, ''), l, 'pref', [], { info: l === 'Drive Maps' ? '' : PREF_INFO }))),
      N('u.pref.cp', 'Control Panel Settings', 'folder', ['Data Sources', 'Devices', 'Folder Options', 'Internet Settings', 'Local Users and Groups', 'Network Options', 'Power Options', 'Printers', 'Regional Options', 'Scheduled Tasks', 'Start Menu'].map(l => N('u.pref.' + l.toLowerCase().replace(/ /g, ''), l, 'pref', [], { info: PREF_INFO })))])]);

  const nodes = new Map();
  const parents = new Map();
  (function index(list, parent, side) {
    for (const n of list) {
      n.side = side || (n.id[0] === 'c' ? 'computer' : 'user');
      nodes.set(n.id, n);
      if (parent) parents.set(n.id, parent.id);
      index(n.children, n, n.side);
    }
  })([computer, user]);

  /* ---------------------------------------------------------------- security settings */
  const settings = [];
  const byKey = new Map();
  function add(s) { settings.push(s); byKey.set(s.side + ':' + s.key, s); return s; }
  const sec = (node, key, name, kind, extra) => add(Object.assign({ key, side: 'computer', node, name, kind, group: 'security' }, extra));

  // Password Policy ([System Access] in GptTmpl.inf)
  sec('c.sec.pw', 'PasswordHistorySize', 'Enforce password history', 'num', { inf: ['System Access', 'PasswordHistorySize'], min: 0, max: 24, unit: 'passwords remembered', prompt: 'Keep password history for:', dflt: 24,
    explain: 'This security setting determines the number of unique new passwords that have to be associated with a user account before an old password can be reused. The value must be between 0 and 24 passwords.\n\nThis policy enables administrators to enhance security by ensuring that old passwords are not reused continually.\n\nDefault:\n24 on domain controllers.\n0 on stand-alone servers.' });
  sec('c.sec.pw', 'MaximumPasswordAge', 'Maximum password age', 'num', { inf: ['System Access', 'MaximumPasswordAge'], min: 0, max: 999, unit: 'days', prompt: 'Password will expire in:', dflt: 42,
    explain: 'This security setting determines the period of time (in days) that a password can be used before the system requires the user to change it. You can set passwords to expire after a number of days between 1 and 999, or you can specify that passwords never expire by setting the number of days to 0. If the maximum password age is between 1 and 999 days, the Minimum password age must be less than the maximum password age.\n\nDefault: 42.' });
  sec('c.sec.pw', 'MinimumPasswordAge', 'Minimum password age', 'num', { inf: ['System Access', 'MinimumPasswordAge'], min: 0, max: 998, unit: 'days', prompt: 'Password can be changed after:', dflt: 1,
    explain: 'This security setting determines the period of time (in days) that a password must be used before the user can change it. You can set a value between 1 and 998 days, or you can allow changes immediately by setting the number of days to 0.\n\nThe minimum password age must be less than the Maximum password age, unless the maximum password age is set to 0.\n\nDefault:\n1 on domain controllers.\n0 on stand-alone servers.' });
  sec('c.sec.pw', 'MinimumPasswordLength', 'Minimum password length', 'num', { inf: ['System Access', 'MinimumPasswordLength'], min: 0, max: 14, unit: 'characters', prompt: 'Password must be at least:', dflt: 7,
    explain: 'This security setting determines the least number of characters that a password for a user account may contain. The maximum value for this setting depends on the value of the Relax minimum password length limits setting. If that setting is not defined, this setting may be configured from 0 to 14. If it is defined and enabled, this setting may be configured from 0 to 128.\n\nSetting the number of characters to 0 means that no password is required.\n\nDefault:\n7 on domain controllers.\n0 on stand-alone servers.' });
  sec('c.sec.pw', 'MinimumPasswordLengthAudit', 'Minimum password length audit', 'num', { inf: ['System Access', 'MinimumPasswordLengthAudit'], min: 1, max: 128, unit: 'characters', prompt: 'Audit passwords shorter than:', dflt: 14,
    explain: 'This security setting determines the minimum password length for which password length audit warning events are issued. This setting may be configured from 1 to 128.\n\nYou should only enable and configure this setting when you try to determine the potential effect of increasing the minimum password length setting in your environment.' });
  sec('c.sec.pw', 'PasswordComplexity', 'Password must meet complexity requirements', 'bool', { inf: ['System Access', 'PasswordComplexity'], dflt: true,
    explain: 'This security setting determines whether passwords must meet complexity requirements.\n\nIf this policy is enabled, passwords must meet the following minimum requirements:\n\n- Not contain the user\'s account name or parts of the user\'s full name that exceed two consecutive characters\n- Be at least six characters in length\n- Contain characters from three of the following four categories: English uppercase characters (A through Z), English lowercase characters (a through z), base 10 digits (0 through 9), non-alphabetic characters (for example, !, $, #, %)\n\nComplexity requirements are enforced when passwords are changed or created.\n\nDefault:\nEnabled on domain controllers.\nDisabled on stand-alone servers.' });
  sec('c.sec.pw', 'RelaxMinimumPasswordLengthLimits', 'Relax minimum password length limits', 'bool', { inf: ['System Access', 'RelaxMinimumPasswordLengthLimits'], dflt: true,
    explain: 'This setting controls whether the minimum password length setting can be increased beyond the legacy limit of 14. If this setting is not defined, minimum password length may be configured to no more than 14. If this setting is defined and disabled, minimum password length may be configured to no more than 14. If this setting is defined and enabled, minimum password length may be configured above 14.' });
  sec('c.sec.pw', 'ClearTextPassword', 'Store passwords using reversible encryption', 'bool', { inf: ['System Access', 'ClearTextPassword'], dflt: false,
    explain: 'This security setting determines whether the operating system stores passwords using reversible encryption.\n\nThis policy provides support for applications that use protocols that require knowledge of the user\'s password for authentication purposes. Storing passwords using reversible encryption is essentially the same as storing plaintext versions of the passwords. For this reason, this policy should never be enabled unless application requirements outweigh the need to protect password information.\n\nDefault: Disabled.' });
  // Account Lockout Policy
  sec('c.sec.lock', 'LockoutDuration', 'Account lockout duration', 'num', { inf: ['System Access', 'LockoutDuration'], min: 0, max: 99999, unit: 'minutes', prompt: 'Account is locked out for:', dflt: 10, lockout: true,
    explain: 'This security setting determines the number of minutes a locked-out account remains locked out before automatically becoming unlocked. The available range is from 0 minutes through 99,999 minutes. If you set the account lockout duration to 0, the account will be locked out until an administrator explicitly unlocks it.\n\nIf an account lockout threshold is defined, the account lockout duration must be greater than or equal to the reset time.\n\nDefault: None, because this policy setting only has meaning when an Account lockout threshold is specified.' });
  sec('c.sec.lock', 'LockoutBadCount', 'Account lockout threshold', 'num', { inf: ['System Access', 'LockoutBadCount'], min: 0, max: 999, unit: 'invalid logon attempts', prompt: 'Account will lock out after:', dflt: 0,
    explain: 'This security setting determines the number of failed logon attempts that causes a user account to be locked out. A locked-out account cannot be used until it is reset by an administrator or until the lockout duration for the account has expired. You can set a value between 0 and 999 failed logon attempts. If you set the value to 0, the account will never be locked out.\n\nDefault: 0.' });
  sec('c.sec.lock', 'AllowAdministratorLockout', 'Allow Administrator account lockout', 'bool', { inf: ['System Access', 'AllowAdministratorLockout'], dflt: true,
    explain: 'This security setting determines whether the built-in Administrator account is subject to account lockout policy.' });
  sec('c.sec.lock', 'ResetLockoutCount', 'Reset account lockout counter after', 'num', { inf: ['System Access', 'ResetLockoutCount'], min: 1, max: 99999, unit: 'minutes', prompt: 'Reset account lockout counter after:', dflt: 10, lockout: true,
    explain: 'This security setting determines the number of minutes that must elapse after a failed logon attempt before the failed logon attempt counter is reset to 0 bad logon attempts. The available range is 1 minute to 99,999 minutes.\n\nIf an account lockout threshold is defined, this reset time must be less than or equal to the Account lockout duration.\n\nDefault: None, because this policy setting only has meaning when an Account lockout threshold is specified.' });
  // Kerberos Policy
  sec('c.sec.krb', 'TicketValidateClient', 'Enforce user logon restrictions', 'bool', { inf: ['Kerberos Policy', 'TicketValidateClient'], dflt: true,
    explain: 'This security setting determines whether the Kerberos V5 Key Distribution Center (KDC) validates every request for a session ticket against the user rights policy of the user account.\n\nDefault: Enabled.' });
  sec('c.sec.krb', 'MaxServiceAge', 'Maximum lifetime for service ticket', 'num', { inf: ['Kerberos Policy', 'MaxServiceAge'], min: 10, max: 99999, unit: 'minutes', prompt: 'Ticket expires in:', dflt: 600,
    explain: 'This security setting determines the maximum amount of time (in minutes) that a granted session ticket can be used to access a particular service. The setting must be greater than 10 minutes and less than or equal to the setting for Maximum lifetime for user ticket.\n\nDefault: 600 minutes (10 hours).' });
  sec('c.sec.krb', 'MaxTicketAge', 'Maximum lifetime for user ticket', 'num', { inf: ['Kerberos Policy', 'MaxTicketAge'], min: 1, max: 99999, unit: 'hours', prompt: 'Ticket expires in:', dflt: 10,
    explain: 'This security setting determines the maximum amount of time (in hours) that a user\'s ticket-granting ticket (TGT) may be used.\n\nDefault: 10 hours.' });
  sec('c.sec.krb', 'MaxRenewAge', 'Maximum lifetime for user ticket renewal', 'num', { inf: ['Kerberos Policy', 'MaxRenewAge'], min: 1, max: 99999, unit: 'days', prompt: 'Ticket renewal expires in:', dflt: 7,
    explain: 'This security setting determines the period of time (in days) during which a user\'s ticket-granting ticket (TGT) may be renewed.\n\nDefault: 7 days.' });
  sec('c.sec.krb', 'MaxClockSkew', 'Maximum tolerance for computer clock synchronization', 'num', { inf: ['Kerberos Policy', 'MaxClockSkew'], min: 0, max: 99999, unit: 'minutes', prompt: 'Maximum tolerance:', dflt: 5,
    explain: 'This security setting determines the maximum time difference (in minutes) that Kerberos V5 tolerates between the time on the client clock and the time on the domain controller that provides Kerberos authentication.\n\nDefault: 5 minutes.' });
  // Audit Policy ([Event Audit]; 1 = Success, 2 = Failure)
  for (const [k, n, what] of [
    ['AuditAccountLogon', 'Audit account logon events', 'each instance of a user logging on to or logging off from another computer in which this computer is used to validate the account'],
    ['AuditAccountManage', 'Audit account management', 'each event of account management on a computer: a user account or group is created, changed, or deleted; a user account is renamed, disabled, or enabled; or a password is set or changed'],
    ['AuditDSAccess', 'Audit directory service access', 'the event of a user accessing an Active Directory object that has its own system access control list (SACL) specified'],
    ['AuditLogonEvents', 'Audit logon events', 'each instance of a user logging on to or logging off from a computer'],
    ['AuditObjectAccess', 'Audit object access', 'the event of a user accessing an object, such as a file, folder, registry key or printer, that has its own system access control list (SACL) specified'],
    ['AuditPolicyChange', 'Audit policy change', 'every incident of a change to user rights assignment policies, audit policies, or trust policies'],
    ['AuditPrivilegeUse', 'Audit privilege use', 'each instance of a user exercising a user right'],
    ['AuditProcessTracking', 'Audit process tracking', 'detailed tracking information for events such as program activation, process exit, handle duplication, and indirect object access'],
    ['AuditSystemEvents', 'Audit system events', 'when a user restarts or shuts down the computer or when an event occurs that affects either the system security or the security log']]) {
    sec('c.sec.audit', k, n, 'audit', { inf: ['Event Audit', k], explain: `This security setting determines whether the OS audits ${what}.\n\nIf you define this policy setting, you can specify whether to audit successes, audit failures, or not audit the event type at all.\n\nNote: You can disable auditing of this event type by selecting the Define these policy settings check box and clearing both the Success and Failure check boxes.` });
  }
  // User Rights Assignment ([Privilege Rights])
  for (const [k, n] of [
    ['SeTrustedCredManAccessPrivilege', 'Access Credential Manager as a trusted caller'], ['SeNetworkLogonRight', 'Access this computer from the network'],
    ['SeTcbPrivilege', 'Act as part of the operating system'], ['SeMachineAccountPrivilege', 'Add workstations to domain'],
    ['SeIncreaseQuotaPrivilege', 'Adjust memory quotas for a process'], ['SeInteractiveLogonRight', 'Allow log on locally'],
    ['SeRemoteInteractiveLogonRight', 'Allow log on through Remote Desktop Services'], ['SeBackupPrivilege', 'Back up files and directories'],
    ['SeChangeNotifyPrivilege', 'Bypass traverse checking'], ['SeSystemtimePrivilege', 'Change the system time'], ['SeTimeZonePrivilege', 'Change the time zone'],
    ['SeCreatePagefilePrivilege', 'Create a pagefile'], ['SeCreateTokenPrivilege', 'Create a token object'], ['SeCreateGlobalPrivilege', 'Create global objects'],
    ['SeCreatePermanentPrivilege', 'Create permanent shared objects'], ['SeCreateSymbolicLinkPrivilege', 'Create symbolic links'], ['SeDebugPrivilege', 'Debug programs'],
    ['SeDenyNetworkLogonRight', 'Deny access to this computer from the network'], ['SeDenyBatchLogonRight', 'Deny log on as a batch job'],
    ['SeDenyServiceLogonRight', 'Deny log on as a service'], ['SeDenyInteractiveLogonRight', 'Deny log on locally'],
    ['SeDenyRemoteInteractiveLogonRight', 'Deny log on through Remote Desktop Services'], ['SeEnableDelegationPrivilege', 'Enable computer and user accounts to be trusted for delegation'],
    ['SeRemoteShutdownPrivilege', 'Force shutdown from a remote system'], ['SeAuditPrivilege', 'Generate security audits'],
    ['SeImpersonatePrivilege', 'Impersonate a client after authentication'], ['SeIncreaseWorkingSetPrivilege', 'Increase a process working set'],
    ['SeIncreaseBasePriorityPrivilege', 'Increase scheduling priority'], ['SeLoadDriverPrivilege', 'Load and unload device drivers'],
    ['SeLockMemoryPrivilege', 'Lock pages in memory'], ['SeBatchLogonRight', 'Log on as a batch job'], ['SeServiceLogonRight', 'Log on as a service'],
    ['SeSecurityPrivilege', 'Manage auditing and security log'], ['SeRelabelPrivilege', 'Modify an object label'], ['SeSystemEnvironmentPrivilege', 'Modify firmware environment values'],
    ['SeDelegateSessionUserImpersonatePrivilege', 'Obtain an impersonation token for another user in the same session'], ['SeManageVolumePrivilege', 'Perform volume maintenance tasks'],
    ['SeProfileSingleProcessPrivilege', 'Profile single process'], ['SeSystemProfilePrivilege', 'Profile system performance'], ['SeUndockPrivilege', 'Remove computer from docking station'],
    ['SeAssignPrimaryTokenPrivilege', 'Replace a process level token'], ['SeRestorePrivilege', 'Restore files and directories'], ['SeShutdownPrivilege', 'Shut down the system'],
    ['SeSyncAgentPrivilege', 'Synchronize directory service data'], ['SeTakeOwnershipPrivilege', 'Take ownership of files or other objects']]) {
    sec('c.sec.ura', k, n, 'accounts', { inf: ['Privilege Rights', k], explain: `${n}\n\nThis user right determines which users and groups have the "${n}" right on the computers this Group Policy object applies to. Define this policy setting to replace the computer's default list with the users and groups you add here.` });
  }
  // Security Options (registry-backed; inf: [Registry Values] in a real GptTmpl.inf)
  const opt = (key, name, kind, explain, extra) => sec('c.sec.opt', key, name, kind, Object.assign({ inf: ['Registry Values', key], explain }, extra));
  opt('EnableAdminAccount', 'Accounts: Administrator account status', 'bool', 'This security setting determines whether the local Administrator account is enabled or disabled.', { inf: ['System Access', 'EnableAdminAccount'] });
  opt('NoConnectedUser', 'Accounts: Block Microsoft accounts', 'select', 'This policy setting prevents users from adding new Microsoft accounts on this computer.', { choices: [{ value: 0, label: 'This policy is disabled' }, { value: 1, label: 'Users can\'t add Microsoft accounts' }, { value: 3, label: 'Users can\'t add or log on with Microsoft accounts' }] });
  opt('EnableGuestAccount', 'Accounts: Guest account status', 'bool', 'This security setting determines if the Guest account is enabled or disabled.', { inf: ['System Access', 'EnableGuestAccount'] });
  opt('LimitBlankPasswordUse', 'Accounts: Limit local account use of blank passwords to console logon only', 'bool', 'This security setting determines whether local accounts that are not password protected can be used to log on from locations other than the physical computer console.\n\nDefault: Enabled.');
  opt('NewAdministratorName', 'Accounts: Rename administrator account', 'text', 'This security setting determines whether a different account name is associated with the security identifier (SID) for the account Administrator.', { inf: ['System Access', 'NewAdministratorName'], note: 'Not applied by the lab simulator.' });
  opt('NewGuestName', 'Accounts: Rename guest account', 'text', 'This security setting determines whether a different account name is associated with the security identifier (SID) for the account "Guest."', { inf: ['System Access', 'NewGuestName'] });
  opt('SCENoApplyLegacyAuditPolicy', 'Audit: Force audit policy subcategory settings (Windows Vista or later) to override audit policy category settings', 'bool', 'Windows Vista and later versions of Windows allow audit policy to be managed in a more precise way using audit policy subcategories. Setting the audit policy at the category level will override the new subcategory audit policy feature.');
  opt('CrashOnAuditFail', 'Audit: Shut down system immediately if unable to log security audits', 'bool', 'This security setting determines whether the system shuts down if it is unable to log security events.');
  opt('AddPrinterDrivers', 'Devices: Prevent users from installing printer drivers', 'bool', 'For a computer to print to a shared printer, the driver for that shared printer must be installed on the local computer. This security setting determines who is allowed to install a printer driver as part of connecting to a shared printer.');
  opt('SubmitControl', 'Domain controller: Allow server operators to schedule tasks', 'bool', 'This security setting determines if Server Operators are allowed to submit jobs by means of the AT schedule facility.');
  opt('LDAPServerIntegrity', 'Domain controller: LDAP server signing requirements', 'select', 'This security setting determines whether the LDAP server requires signing to be negotiated with LDAP clients.', { choices: [{ value: 1, label: 'None' }, { value: 2, label: 'Require signing' }] });
  opt('RefusePasswordChange', 'Domain controller: Refuse machine account password changes', 'bool', 'This security setting determines whether domain controllers will refuse requests from member computers to change computer account passwords.');
  opt('RequireSignOrSeal', 'Domain member: Digitally encrypt or sign secure channel data (always)', 'bool', 'This security setting determines whether all secure channel traffic initiated by the domain member must be signed or encrypted.');
  opt('DisablePasswordChange', 'Domain member: Disable machine account password changes', 'bool', 'Determines whether a domain member periodically changes its computer account password.');
  opt('MaximumMachinePasswordAge', 'Domain member: Maximum machine account password age', 'num', 'This security setting determines how often a domain member will attempt to change its computer account password.\n\nDefault: 30 days.', { min: 0, max: 999, unit: 'days', prompt: 'Machine account password will expire in:', dflt: 30 });
  opt('DisableCAD', 'Interactive logon: Do not require CTRL+ALT+DEL', 'bool', 'This security setting determines whether pressing CTRL+ALT+DEL is required before a user can log on.\n\nDefault on domain computers: Enabled: At least Windows 8 / Disabled: Windows 7 or earlier.');
  opt('DontDisplayLastUserName', 'Interactive logon: Don\'t display last signed-in', 'bool', 'This security setting determines whether the Windows sign-in screen will show the username of the last person who signed in on this PC.\n\nIf this policy is enabled, the username will not be shown. If this policy is disabled, the username will be shown.');
  opt('InactivityTimeoutSecs', 'Interactive logon: Machine inactivity limit', 'num', 'Windows notices inactivity of a logon session, and if the amount of inactive time exceeds the inactivity limit, then the screen saver will run, locking the session.', { min: 0, max: 599940, unit: 'seconds', prompt: 'Machine will be locked after', dflt: 900 });
  opt('LegalNoticeText', 'Interactive logon: Message text for users attempting to log on', 'multitext', 'This security setting specifies a text message that is displayed to users when they log on.\n\nThis text is often used for legal reasons, for example, to warn users about the ramifications of misusing company information or to warn them that their actions may be audited.');
  opt('LegalNoticeCaption', 'Interactive logon: Message title for users attempting to log on', 'text', 'This security setting allows the specification of a title to appear in the title bar of the window that contains the Interactive logon: Message text for users attempting to log on.');
  opt('CachedLogonsCount', 'Interactive logon: Number of previous logons to cache (in case domain controller is not available)', 'num', 'Each unique user\'s logon information is cached locally so that, in the event that a domain controller is unavailable during subsequent logon attempts, they are able to log on.\n\nDefault: 10.', { min: 0, max: 50, unit: 'logons', prompt: 'Cache:', dflt: 10 });
  opt('PasswordExpiryWarning', 'Interactive logon: Prompt user to change password before expiration', 'num', 'Determines how far in advance (in days) users are warned that their password is about to expire.\n\nDefault: 5 days.', { min: 0, max: 999, unit: 'days', prompt: 'Begin prompting this many days before password expires:', dflt: 5 });
  opt('RequireSecuritySignatureClient', 'Microsoft network client: Digitally sign communications (always)', 'bool', 'This security setting determines whether packet signing is required by the SMB client component.');
  opt('RequireSecuritySignature', 'Microsoft network server: Digitally sign communications (always)', 'bool', 'This security setting determines whether packet signing is required by the SMB server component.');
  opt('EnableSecuritySignature', 'Microsoft network server: Digitally sign communications (if client agrees)', 'bool', 'This security setting determines whether the SMB server will negotiate SMB packet signing with clients that request it.');
  opt('LSAAnonymousNameLookup', 'Network access: Allow anonymous SID/Name translation', 'bool', 'This policy setting determines whether an anonymous user can request security identifier (SID) attributes for another user.\n\nDefault: Disabled.', { inf: ['System Access', 'LSAAnonymousNameLookup'] });
  opt('RestrictAnonymousSAM', 'Network access: Do not allow anonymous enumeration of SAM accounts', 'bool', 'This security setting determines what additional permissions will be granted for anonymous connections to the computer.\n\nDefault: Enabled.');
  opt('RestrictAnonymous', 'Network access: Do not allow anonymous enumeration of SAM accounts and shares', 'bool', 'This security setting determines whether anonymous enumeration of SAM accounts and shares is allowed.\n\nDefault: Disabled.');
  opt('EveryoneIncludesAnonymous', 'Network access: Let Everyone permissions apply to anonymous users', 'bool', 'This security setting determines what additional permissions are granted for anonymous connections to the computer.\n\nDefault: Disabled.');
  opt('NoLMHash', 'Network security: Do not store LAN Manager hash value on next password change', 'bool', 'This security setting determines if, at the next password change, the LAN Manager (LM) hash value for the new password is stored.\n\nDefault: Enabled.');
  opt('ForceLogoffWhenHourExpire', 'Network security: Force logoff when logon hours expire', 'bool', 'This security setting determines whether to disconnect users who are connected to the local computer outside their user account\'s valid logon hours.', { inf: ['System Access', 'ForceLogoffWhenHourExpire'] });
  opt('LmCompatibilityLevel', 'Network security: LAN Manager authentication level', 'select', 'This security setting determines which challenge/response authentication protocol is used for network logons.\n\nDefault: Send NTLMv2 response only.', { choices: [
    { value: 0, label: 'Send LM & NTLM responses' }, { value: 1, label: 'Send LM & NTLM - use NTLMv2 session security if negotiated' }, { value: 2, label: 'Send NTLM response only' },
    { value: 3, label: 'Send NTLMv2 response only' }, { value: 4, label: 'Send NTLMv2 response only. Refuse LM' }, { value: 5, label: 'Send NTLMv2 response only. Refuse LM & NTLM' }] });
  opt('ShutdownWithoutLogon', 'Shutdown: Allow system to be shut down without having to log on', 'bool', 'This security setting determines whether a computer can be shut down without having to log on to Windows.\n\nDefault on servers: Disabled.');
  opt('FilterAdministratorToken', 'User Account Control: Admin Approval Mode for the Built-in Administrator account', 'bool', 'This policy setting controls the behavior of Admin Approval Mode for the built-in Administrator account.');
  opt('ConsentPromptBehaviorAdmin', 'User Account Control: Behavior of the elevation prompt for administrators in Admin Approval Mode', 'select', 'This policy setting controls the behavior of the elevation prompt for administrators.', { choices: [
    { value: 0, label: 'Elevate without prompting' }, { value: 1, label: 'Prompt for credentials on the secure desktop' }, { value: 2, label: 'Prompt for consent on the secure desktop' },
    { value: 3, label: 'Prompt for credentials' }, { value: 4, label: 'Prompt for consent' }, { value: 5, label: 'Prompt for consent for non-Windows binaries' }] });
  opt('EnableLUA', 'User Account Control: Run all administrators in Admin Approval Mode', 'bool', 'This policy setting controls the behavior of all User Account Control (UAC) policy settings for the computer. If you change this policy setting, you must restart your computer.');
  // Event Log
  const LOGS = [['Application', 'application'], ['Security', 'security'], ['System', 'system']];
  for (const [log, l] of LOGS) sec('c.sec.evt', 'MaxSize_' + log, `Maximum ${l} log size`, 'num', { inf: [log + ' Log', 'MaximumLogSize'], min: 64, max: 4194240, unit: 'kilobytes', prompt: 'Maximum log size:', dflt: log === 'Security' ? 131072 : 20480, log,
    explain: `This security setting specifies the maximum size of the ${l} event log, which has a maximum capacity of 4 GB. Log file sizes must be a multiple of 64 KB. If you enter a value that is not a multiple of 64 KB, Event Viewer will set the log file size to a multiple of 64 KB.` });
  for (const [log, l] of LOGS) sec('c.sec.evt', 'RestrictGuestAccess_' + log, `Prevent local guests group from accessing ${l} log`, 'bool', { inf: [log + ' Log', 'RestrictGuestAccess'], log,
    explain: `This security setting determines whether guests are prevented from accessing the ${l} event log.\n\nDefault: Enabled for Windows XP and later.` });
  for (const [log, l] of LOGS) sec('c.sec.evt', 'Retention_' + log, `Retention method for ${l} log`, 'select', { inf: [log + ' Log', 'AuditLogRetentionPeriod'], log, choices: [
    { value: 1, label: 'Overwrite events by days' }, { value: 0, label: 'Overwrite events as needed' }, { value: 2, label: 'Do not overwrite events (clear log manually)' }],
  explain: `This security setting determines the "wrapping" method for the ${l} log.\n\nIf you want to archive the ${l} log, select Do not overwrite events (clear log manually). If you select this option, you must clear the log manually; when the maximum log size is reached, new events are discarded.` });

  /* ---------------------------------------------------------------- Administrative Templates */
  const W2K = 'At least Windows 2000', WXP = 'At least Windows Server 2003 operating systems or Windows XP Professional', VISTA = 'At least Windows Vista',
    W7 = 'At least Windows 7 or Windows Server 2008 R2', W8 = 'At least Windows Server 2012, Windows 8 or Windows RT', W10 = 'At least Windows Server 2016, Windows 10',
    S2008 = 'At least Windows Server 2008', S2012 = 'At least Windows Server 2012 R2';
  const pol = (side, node, key, name, reg, supported, explain, extra) => add(Object.assign({ key, side, node, name, kind: 'policy', group: 'admx', reg, on: 1, off: 0, supported, explain, options: [] }, extra));
  const C = 'computer', U = 'user';
  const HKCU_EXP = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', HKCU_SYS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
  const HKLM_TS = 'HKLM\\Software\\Policies\\Microsoft\\Windows NT\\Terminal Services';

  // Computer > Control Panel > Personalization
  pol(C, 'c.adm.cp.pers', 'NoLockScreen', 'Do not display the lock screen', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Personalization!NoLockScreen', W8,
    'This policy setting controls whether the lock screen appears for users.\n\nIf you enable this policy setting, users that are not required to press CTRL + ALT + DEL before signing in will see their selected tile after locking their PC.\n\nIf you disable or do not configure this policy setting, users that are not required to press CTRL + ALT + DEL before signing in will see a lock screen after locking their PC. They must dismiss the lock screen using touch, the keyboard, or by dragging it with the mouse.', { effect: true });
  pol(C, 'c.adm.cp.pers', 'NoChangingLockScreen', 'Prevent changing lock screen and logon image', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Personalization!NoChangingLockScreen', W8,
    'Prevents users from changing the background image shown when the machine is locked or when on the sign-in screen.');
  pol(C, 'c.adm.cp.pers', 'LockScreenImage', 'Force a specific default lock screen and logon image', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Personalization!LockScreenImage', W8,
    'This setting allows you to force a specific default lock screen and logon image by entering the path (location) of the image file. The same image will be used for both the lock and logon screens.', { on: null, options: [{ id: 'LockScreenImage', type: 'text', label: 'Path to lock screen image:', dflt: '' }] });
  // Computer > Network
  pol(C, 'c.adm.net.lm', 'AllowInsecureGuestAuth', 'Enable insecure guest logons', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\LanmanWorkstation!AllowInsecureGuestAuth', 'At least Windows Server 2016',
    'This policy setting determines if the SMB client will allow insecure guest logons to an SMB server.\n\nIf you enable this policy setting or if you do not configure this policy setting, the SMB client will allow insecure guest logons.\n\nIf you disable this policy setting, the SMB client will reject insecure guest logons.');
  pol(C, 'c.adm.net.nc', 'NC_AllowNetBridge_NLA', 'Prohibit installation and configuration of Network Bridge on your DNS domain network', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Network Connections!NC_AllowNetBridge_NLA', WXP,
    'Determines whether a user can install and configure the Network Bridge.', { on: 0, off: 1 });
  for (const [node, prof, label] of [['c.adm.net.fw.dom', 'DomainProfile', 'Domain'], ['c.adm.net.fw.std', 'StandardProfile', 'Standard']]) {
    const base = `HKLM\\Software\\Policies\\Microsoft\\WindowsFirewall\\${prof}`;
    pol(C, node, 'EnableFirewall_' + prof, 'Windows Defender Firewall: Protect all network connections', base + '!EnableFirewall', WXP,
      `Turns on Windows Defender Firewall.\n\nIf you enable this policy setting, Windows Defender Firewall runs and ignores the "Computer Configuration\\Administrative Templates\\Network\\Network Connections\\Windows Defender Firewall\\Standard Profile\\Windows Defender Firewall: Allow local program exceptions" policy setting.\n\nIf you disable this policy setting, Windows Defender Firewall does not run. This is the only way to ensure that Windows Defender Firewall does not run and administrators who log on locally cannot start it.\n\nThis setting applies to the ${label} profile${label === 'Standard' ? ' (the Private and Public profiles of Windows Defender Firewall with Advanced Security)' : ''}.`, { effect: true, profile: prof });
    pol(C, node, 'IcmpEcho_' + prof, 'Windows Defender Firewall: Allow ICMP exceptions', base + '\\IcmpSettings!AllowInboundEchoRequest', WXP,
      'Defines the set of Internet Control Message Protocol (ICMP) message types that Windows Defender Firewall allows. Utilities can use ICMP messages to determine the status of other computers. For example, Ping uses the echo request message.',
      { options: [{ id: 'AllowOutboundDestinationUnreachable', type: 'check', label: 'Allow outbound destination unreachable' }, { id: 'AllowInboundEchoRequest', type: 'check', label: 'Allow inbound echo request', dflt: true },
        { id: 'AllowInboundTimestampRequest', type: 'check', label: 'Allow inbound timestamp request' }, { id: 'AllowInboundRouterRequest', type: 'check', label: 'Allow inbound router request' }] });
    pol(C, node, 'RemoteDesktop_' + prof, 'Windows Defender Firewall: Allow inbound Remote Desktop exceptions', base + '\\Services\\RemoteDesktop!Enabled', WXP,
      'Allows this computer to receive inbound Remote Desktop requests. To do this, Windows Defender Firewall opens TCP port 3389.', { options: [{ id: 'RemoteAddresses', type: 'text', label: 'Allow unsolicited incoming messages from these IP addresses:', dflt: '*' }] });
  }
  // Computer > Printers, Start Menu
  pol(C, 'c.adm.prn', 'RegisterSpoolerRemoteRpcEndPoint', 'Allow Print Spooler to accept client connections', 'HKLM\\Software\\Policies\\Microsoft\\Windows NT\\Printers!RegisterSpoolerRemoteRpcEndPoint', S2008,
    'This policy controls whether the print spooler will accept client connections.\n\nWhen the policy is not configured or enabled, the spooler will always accept client connections.\n\nWhen the policy is disabled, the spooler will not accept client connections nor allow users to share printers. All printers currently shared will continue to be shared.\n\nThe spooler must be restarted for changes to this policy to take effect.', { on: 1, off: 2 });
  pol(C, 'c.adm.start', 'NoPinningStoreToTaskbar', 'Do not allow pinning Store app to the Taskbar', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Explorer!NoPinningStoreToTaskbar', W8,
    'This policy setting allows you to control pinning the Store app to the Taskbar.');
  // Computer > System
  pol(C, 'c.adm.sys.gp', 'UserPolicyMode', 'Configure user Group Policy loopback processing mode', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\System!UserPolicyMode', W2K,
    'This policy setting directs the system to apply the set of Group Policy objects for the computer to any user who logs on to a computer affected by this setting. It is intended for special-use computers, such as those in public places, laboratories, and classrooms, where you must modify the user setting based on the computer that is being used.\n\nBy default, the user\'s Group Policy Objects determine which user settings apply. If this setting is enabled, then, when a user logs on to this computer, the computer\'s Group Policy Objects determine which set of Group Policy Objects applies.\n\nIf you enable this setting, you can select one of the following modes from the Mode box:\n\n"Replace" indicates that the user settings defined in the computer\'s Group Policy Objects replace the user settings normally applied to the user.\n\n"Merge" indicates that the user settings defined in the computer\'s Group Policy Objects and the user settings normally applied to the user are combined. If the settings conflict, the user settings in the computer\'s Group Policy Objects take precedence over the user\'s normal settings.',
    { on: null, effect: true, options: [{ id: 'UserPolicyMode', type: 'select', label: 'Mode:', dflt: 1, choices: [{ value: 1, label: 'Merge' }, { value: 2, label: 'Replace' }], reg: true }] });
  pol(C, 'c.adm.sys.gp', 'GroupPolicyRefreshTime', 'Set Group Policy refresh interval for computers', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\System!GroupPolicyRefreshTime', W2K,
    'This policy setting specifies how often Group Policy for computers is updated while the computer is in use (in the background). This setting specifies a background update rate only for Group Policies in the Computer Configuration folder.\n\nBy default, computer Group Policy is updated in the background every 90 minutes, with a random offset of 0 to 30 minutes.\n\nThis setting does not apply to domain controllers.',
    { on: null, options: [{ id: 'GroupPolicyRefreshTime', type: 'number', label: 'Minutes:', dflt: 90, min: 0, max: 44640, reg: true }, { id: 'GroupPolicyRefreshTimeOffset', type: 'number', label: 'Minutes:', dflt: 30, min: 0, max: 1440, before: 'This is a random time added to the refresh interval to prevent all clients from requesting Group Policy at the same time.' }] });
  pol(C, 'c.adm.sys.gp', 'GroupPolicyRefreshTimeDC', 'Set Group Policy refresh interval for domain controllers', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\System!GroupPolicyRefreshTimeDC', W2K,
    'This policy setting specifies how often Group Policy is updated on domain controllers while they are running (in the background).\n\nBy default, Group Policy on the domain controllers is updated every five minutes.',
    { on: null, effect: true, options: [{ id: 'GroupPolicyRefreshTimeDC', type: 'number', label: 'Minutes:', dflt: 5, min: 0, max: 44640, reg: true }, { id: 'GroupPolicyRefreshTimeOffsetDC', type: 'number', label: 'Minutes:', dflt: 0, min: 0, max: 1440 }] });
  pol(C, 'c.adm.sys.gp', 'DisableBkGndGroupPolicy', 'Turn off background refresh of Group Policy', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System!DisableBkGndGroupPolicy', W2K,
    'This policy setting prevents Group Policy from being updated while the computer is in use. This policy setting applies to Group Policy for computers, users, and domain controllers.', { effect: true });
  pol(C, 'c.adm.sys.logon', 'SyncForegroundPolicy', 'Always wait for the network at computer startup and logon', 'HKLM\\Software\\Policies\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon!SyncForegroundPolicy', WXP,
    'This policy setting determines whether Group Policy processing is synchronous (that is, whether computers wait for the network to be fully initialized during computer startup and user logon).');
  pol(C, 'c.adm.sys.logon', 'EnableFirstLogonAnimation', 'Show first sign-in animation', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System!EnableFirstLogonAnimation', 'At least Windows Server 2012 R2, Windows 8.1 or Windows RT 8.1',
    'This policy setting allows you to control whether users see the first sign-in animation when signing in to the computer for the first time.');
  pol(C, 'c.adm.sys.logon', 'DisableLockScreenAppNotifications', 'Turn off app notifications on the lock screen', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\System!DisableLockScreenAppNotifications', W8,
    'This policy setting allows you to prevent app notifications from appearing on the lock screen.');
  pol(C, 'c.adm.sys.ra', 'fAllowUnsolicited', 'Configure Offer Remote Assistance', 'HKLM\\Software\\Policies\\Microsoft\\Windows NT\\Terminal Services!fAllowUnsolicited', WXP,
    'This policy setting allows you to turn on or turn off Offer (Unsolicited) Remote Assistance on this computer.',
    { options: [{ id: 'fAllowUnsolicitedFullControl', type: 'select', label: 'Permit remote control of this computer:', dflt: 1, choices: [{ value: 1, label: 'Allow helpers to remotely control the computer' }, { value: 0, label: 'Allow helpers to only view the computer' }] }] });
  pol(C, 'c.adm.sys.ra', 'fAllowToGetHelp', 'Configure Solicited Remote Assistance', 'HKLM\\Software\\Policies\\Microsoft\\Windows NT\\Terminal Services!fAllowToGetHelp', WXP,
    'This policy setting allows you to turn on or turn off Solicited (Ask for) Remote Assistance on this computer.');
  pol(C, 'c.adm.sys.sm', 'DoNotOpenAtLogon', 'Do not display Server Manager automatically at logon', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Server\\ServerManager!DoNotOpenAtLogon', S2008,
    'This policy setting allows you to turn off the automatic display of Server Manager at logon.\n\nIf you enable this policy setting, Server Manager is not displayed automatically when a user logs on to the server.\n\nIf you disable this policy setting, Server Manager is displayed automatically when a user logs on to the server.\n\nIf you do not configure this policy setting, Server Manager is displayed when a user logs on to the server. However, if the "Do not show me this console at logon" (Windows Server 2008 and Windows Server 2008 R2) or "Do not start Server Manager automatically at logon" (Windows Server 2012) option is selected, the console is not displayed automatically at logon.', { effect: true });
  pol(C, 'c.adm.sys.sm', 'RefreshInterval', 'Configure the refresh interval for Server Manager', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\Server\\ServerManager!RefreshIntervalEnabled', 'At least Windows Server 2012',
    'This policy setting allows you to set the refresh interval for Server Manager.', { options: [{ id: 'RefreshInterval', type: 'number', label: 'Minutes:', dflt: 10, min: 1, max: 14400 }] });
  // Computer > Windows Components
  for (const [node, log] of [['c.adm.wc.evt.app', 'Application'], ['c.adm.wc.evt.sec', 'Security'], ['c.adm.wc.evt.sys', 'System']]) {
    pol(C, node, 'EventLogMaxSize_' + log, 'Specify the maximum log file size (KB)', `HKLM\\Software\\Policies\\Microsoft\\Windows\\EventLog\\${log}!MaxSize`, VISTA,
      'This policy setting specifies the maximum size of the log file in kilobytes.\n\nIf you enable this policy setting, you can configure the maximum log file size to be between 1 megabyte (1,024 kilobytes) and 2 terabytes (2,147,483,647 kilobytes) in kilobyte increments.\n\nIf you disable or do not configure this policy setting, the maximum size of the log file will be set to the locally configured value. This value can be changed by the local administrator using the Log Properties dialog and it defaults to 20 megabytes.',
      { on: null, log, effect: true, options: [{ id: 'MaxSize', type: 'number', label: 'Maximum Log Size (KB)', dflt: 32768, min: 1024, max: 2147483647, reg: true }] });
    pol(C, node, 'EventLogRetention_' + log, 'Control Event Log behavior when the log file reaches its maximum size', `HKLM\\Software\\Policies\\Microsoft\\Windows\\EventLog\\${log}!Retention`, VISTA,
      'This policy setting controls Event Log behavior when the log file reaches its maximum size.\n\nIf you enable this policy setting and a log file reaches its maximum size, new events are not written to the log and are lost.\n\nIf you disable or do not configure this policy setting and a log file reaches its maximum size, new events overwrite old events.', { log, effect: true, on: '1', off: '0' });
  }
  pol(C, 'c.adm.wc.def', 'DisableAntiSpyware', 'Turn off Microsoft Defender Antivirus', 'HKLM\\Software\\Policies\\Microsoft\\Windows Defender!DisableAntiSpyware', 'At least Windows Server 2012, Windows 8 or Windows RT',
    'This policy setting turns off Microsoft Defender Antivirus.\n\nIf you enable this policy setting, Microsoft Defender Antivirus does not run, and will not scan computers for malware or other potentially unwanted software.\n\nIf you disable this policy setting, Microsoft Defender Antivirus will run regardless of any other installed antivirus product.');
  pol(C, 'c.adm.wc.rdsh.conn', 'fDenyTSConnections', 'Allow users to connect remotely by using Remote Desktop Services', HKLM_TS + '!fDenyTSConnections', WXP,
    'This policy setting allows you to configure remote access to computers by using Remote Desktop Services.\n\nIf you enable this policy setting, users who are members of the Remote Desktop Users group on the target computer can connect remotely to the target computer by using Remote Desktop Services.\n\nIf you disable this policy setting, users cannot connect remotely to the target computer by using Remote Desktop Services. The target computer will maintain any current connections, but will not accept any new incoming connections.\n\nIf you do not configure this policy setting, Remote Desktop Services uses the Remote Desktop setting on the target computer to determine whether the remote connection is allowed. This setting is found on the Remote tab in the System properties sheet.', { on: 0, off: 1, effect: true });
  pol(C, 'c.adm.wc.rdsh.conn', 'MaxInstanceCount', 'Limit number of connections', HKLM_TS + '!MaxInstanceCount', WXP,
    'Specifies whether Remote Desktop Services limits the number of simultaneous connections to the server.', { on: null, options: [{ id: 'MaxInstanceCount', type: 'number', label: 'RD Maximum Connections allowed', dflt: 999999, min: 0, max: 999999, reg: true }] });
  pol(C, 'c.adm.wc.rdsh.sec', 'UserAuthentication', 'Require user authentication for remote connections by using Network Level Authentication', HKLM_TS + '!UserAuthentication', VISTA,
    'This policy setting allows you to specify whether to require user authentication for remote connections to the RD Session Host server by using Network Level Authentication.\n\nIf you enable this policy setting, only client computers that support Network Level Authentication can connect to the RD Session Host server.', { effect: true });
  pol(C, 'c.adm.wc.ps', 'EnableScripts', 'Turn on Script Execution', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\PowerShell!EnableScripts', W7,
    'This policy setting lets you configure the script execution policy, controlling which scripts are allowed to run.\n\nIf you enable this policy setting, the scripts selected in the drop-down list are allowed to run.\n\nThe "Allow only signed scripts" policy setting allows scripts to execute only if they are signed by a trusted publisher.\n\nThe "Allow local scripts and remote signed scripts" policy setting allows any local scripts to run; scripts that originate from the Internet must be signed by a trusted publisher.\n\nThe "Allow all scripts" policy setting allows all scripts to run.\n\nIf you disable this policy setting, no scripts are allowed to run.\n\nNote: This policy setting exists under both "Computer Configuration" and "User Configuration" in the Local Group Policy Editor. The "Computer Configuration" has precedence over "User Configuration."',
    { effect: true, options: [{ id: 'ExecutionPolicy', type: 'select', label: 'Execution Policy', dflt: 'AllSigned', choices: [{ value: 'AllSigned', label: 'Allow only signed scripts' }, { value: 'RemoteSigned', label: 'Allow local scripts and remote signed scripts' }, { value: 'Unrestricted', label: 'Allow all scripts' }] }] });
  pol(C, 'c.adm.wc.ps', 'EnableScriptBlockLogging', 'Turn on PowerShell Script Block Logging', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging!EnableScriptBlockLogging', 'At least Microsoft Windows 7 or Windows Server 2008 family',
    'This policy setting enables logging of all PowerShell script input to the Microsoft-Windows-PowerShell/Operational event log.', { options: [{ id: 'EnableScriptBlockInvocationLogging', type: 'check', label: 'Log script block invocation start / stop events:' }] });
  pol(C, 'c.adm.wc.ps', 'EnableTranscripting', 'Turn on PowerShell Transcription', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\PowerShell\\Transcription!EnableTranscripting', 'At least Microsoft Windows 7 or Windows Server 2008 family',
    'This policy setting lets you capture the input and output of Windows PowerShell commands into text-based transcripts.', { options: [{ id: 'OutputDirectory', type: 'text', label: 'Transcript output directory', dflt: '' }, { id: 'EnableInvocationHeader', type: 'check', label: 'Include invocation headers' }] });
  pol(C, 'c.adm.wc.wrm.svc', 'AllowAutoConfig', 'Allow remote server management through WinRM', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\WinRM\\Service!AllowAutoConfig', VISTA,
    'This policy setting allows you to manage whether the Windows Remote Management (WinRM) service automatically listens on the network for requests on the HTTP transport over the default HTTP port.',
    { options: [{ id: 'IPv4Filter', type: 'text', label: 'IPv4 filter:', dflt: '*' }, { id: 'IPv6Filter', type: 'text', label: 'IPv6 filter:', dflt: '*' }] });
  pol(C, 'c.adm.wc.wu.eue', 'NoAutoUpdate', 'Configure Automatic Updates', 'HKLM\\Software\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU!NoAutoUpdate', 'At least Windows XP Professional Service Pack 1 or Windows 2000 Service Pack 3',
    'Specifies whether this computer will receive security updates and other important downloads through the Windows automatic updating service.', { on: 0, off: 1, options: [
      { id: 'AUOptions', type: 'select', label: 'Configure automatic updating:', dflt: 3, choices: [{ value: 2, label: '2 - Notify for download and auto install' }, { value: 3, label: '3 - Auto download and notify for install' }, { value: 4, label: '4 - Auto download and schedule the install' }, { value: 5, label: '5 - Allow local admin to choose setting' }, { value: 7, label: '7 - Auto Download, Notify to install, Notify to Restart' }] },
      { id: 'ScheduledInstallDay', type: 'select', label: 'Scheduled install day:', dflt: 0, choices: ['0 - Every day', '1 - Every Sunday', '2 - Every Monday', '3 - Every Tuesday', '4 - Every Wednesday', '5 - Every Thursday', '6 - Every Friday', '7 - Every Saturday'].map((l, i) => ({ value: i, label: l })) },
      { id: 'ScheduledInstallTime', type: 'select', label: 'Scheduled install time:', dflt: 3, choices: Array.from({ length: 24 }, (_, i) => ({ value: i, label: String(i).padStart(2, '0') + ':00' })) }] });

  // User > Control Panel
  pol(U, 'u.adm.cp', 'NoControlPanel', 'Prohibit access to Control Panel and PC settings', HKCU_EXP + '!NoControlPanel', W2K,
    'Disables all Control Panel programs and the PC settings app.\n\nThis setting prevents Control.exe and SystemSettings.exe, the program files for Control Panel and PC settings, from starting. As a result, users cannot start Control Panel or PC settings, or run any of their items.\n\nThis setting removes Control Panel from:\nThe Start screen\nFile Explorer\n\nThis setting removes PC settings from:\nThe Start screen\nSettings charm\nAccount picture\nSearch results\n\nIf users try to select a Control Panel item from the Properties item on a context menu, a message appears explaining that a setting prevents the action.', { effect: true });
  pol(U, 'u.adm.cp', 'DisallowCpl', 'Hide specified Control Panel items', HKCU_EXP + '!DisallowCpl', W2K,
    'This setting allows you to display or hide specified Control Panel items, such as Mouse, System, or Personalization, from the Control Panel window and the Start screen.\n\nTo hide a Control Panel item, enable this policy setting and click Show to access the list of disallowed Control Panel items. In the Show Contents dialog box in the Value column, enter the Control Panel item\'s canonical name. For example, enter Microsoft.Mouse, Microsoft.System, or Microsoft.Personalization.',
    { options: [{ id: 'DisallowCplList', type: 'list', label: 'List of disallowed Control Panel items' }] });
  pol(U, 'u.adm.cp.disp', 'NoDispCPL', 'Disable the Display Control Panel', HKCU_SYS + '!NoDispCPL', W2K,
    'Disables the Display Control Panel.\n\nIf you enable this setting, the Display Control Panel does not run. When users try to start Display, a message appears explaining that a setting prevents the action.');
  pol(U, 'u.adm.cp.pers', 'ScreenSaveActive', 'Enable screen saver', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop!ScreenSaveActive', W2K,
    'Enables desktop screen savers.\n\nIf you disable this setting, screen savers do not run. Also, this setting disables the Screen Saver section of the Screen Saver dialog in the Personalization or Display Control Panel.', { on: '1', off: '0' });
  pol(U, 'u.adm.cp.pers', 'ScreenSaverIsSecure', 'Password protect the screen saver', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop!ScreenSaverIsSecure', W2K,
    'Determines whether screen savers used on the computer are password protected.', { on: '1', off: '0' });
  pol(U, 'u.adm.cp.pers', 'ScreenSaveTimeOut', 'Screen saver timeout', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop!ScreenSaveTimeOut', W2K,
    'Specifies how much user idle time must elapse before the screen saver is launched.', { on: null, options: [{ id: 'ScreenSaveTimeOut', type: 'number', label: 'Seconds:', dflt: 900, min: 1, max: 599940, reg: true }] });
  pol(U, 'u.adm.cp.pers', 'NoChangingWallPaper', 'Prevent changing desktop background', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\ActiveDesktop!NoChangingWallPaper', 'At least Windows Vista',
    'Prevents users from adding or changing the background design of the desktop.');
  pol(U, 'u.adm.cp.prog', 'NoProgramsAndFeatures', 'Hide "Programs and Features" page', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Programs!NoProgramsAndFeatures', VISTA,
    'This setting prevents users from accessing "Programs and Features" to view, uninstall, change, or repair programs that are currently installed on the computer.');
  // User > Desktop
  pol(U, 'u.adm.desk', 'NoDesktop', 'Hide and disable all items on the desktop', HKCU_EXP + '!NoDesktop', W2K,
    'Removes icons, shortcuts, and other default and user-defined items from the desktop, including Briefcase, Recycle Bin, Computer, and Network Locations.\n\nRemoving icons and shortcuts does not prevent the user from using another method to start the programs or opening the items they represent.', { effect: true });
  pol(U, 'u.adm.desk', 'NoRecycleBinIcon', 'Remove Recycle Bin icon from desktop', HKCU_EXP + '\\NonEnum!{645FF040-5081-101B-9F08-00AA002F954E}', WXP,
    'Removes most occurrences of the Recycle Bin icon.\n\nThis setting removes the Recycle Bin icon from the desktop, from File Explorer, from programs that use the File Explorer windows, and from the standard Open dialog box.\n\nThis setting does not prevent the user from using other methods to gain access to the contents of the Recycle Bin folder.', { effect: true });
  pol(U, 'u.adm.desk', 'DisablePersonalDirChange', 'Prohibit User from manually redirecting Profile Folders', HKCU_EXP + '!DisablePersonalDirChange', W2K,
    'Prevents users from changing the path to their profile folders.');
  pol(U, 'u.adm.desk.desk', 'Wallpaper', 'Desktop Wallpaper', HKCU_SYS + '!Wallpaper', W2K,
    'Specifies the desktop background ("wallpaper") displayed on all users\' desktops.\n\nThis setting lets you specify the wallpaper on users\' desktops and prevents users from changing the image or its presentation. The wallpaper you specify can be stored in a bitmap (*.bmp) or JPEG (*.jpg) file.\n\nTo use this setting, type the fully qualified path and name of the file that stores the wallpaper image. You can type a local path, such as C:\\Windows\\web\\wallpaper\\home.jpg or a UNC path, such as \\\\Server\\Share\\Corp.jpg.',
    { on: null, options: [{ id: 'Wallpaper', type: 'text', label: 'Wallpaper Name:', dflt: '', reg: true }, { id: 'WallpaperStyle', type: 'select', label: 'Wallpaper Style:', dflt: 0, choices: [{ value: 0, label: 'Center' }, { value: 4, label: 'Fill' }, { value: 3, label: 'Fit' }, { value: 2, label: 'Stretch' }, { value: 1, label: 'Tile' }, { value: 5, label: 'Span' }] }] });
  // User > Network, Shared Folders
  pol(U, 'u.adm.net.nc', 'NC_LanProperties', 'Prohibit access to properties of a LAN connection', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Network Connections!NC_LanProperties', W2K,
    'Determines whether users can change the properties of a LAN connection.', { on: 0, off: 1 });
  pol(U, 'u.adm.sf', 'PublishSharedFolders', 'Allow shared folders to be published', 'HKCU\\Software\\Policies\\Microsoft\\Windows NT\\SharedFolders!PublishSharedFolders', W2K,
    'This policy setting determines whether the user can publish shared folders in Active Directory Domain Services (AD DS).');
  // User > Start Menu and Taskbar
  pol(U, 'u.adm.start', 'NoClose', 'Remove and prevent access to the Shut Down, Restart, Sleep, and Hibernate commands', HKCU_EXP + '!NoClose', W2K,
    'This policy setting prevents users from performing the following commands from the Windows security screen, the logon screen, and the Start menu: Shut Down, Restart, Sleep, and Hibernate. This policy setting does not prevent users from running Windows-based programs that perform these functions.', { effect: true });
  pol(U, 'u.adm.start', 'NoRun', 'Remove Run menu from Start Menu', HKCU_EXP + '!NoRun', W2K,
    'If you enable this setting, the following changes occur:\n\n(1) The Run command is removed from the Start menu.\n(2) The New Task (Run) command is removed from Task Manager.\n(3) The user will be blocked from entering the following into the Internet Explorer Address Bar: a UNC path, accessing local drives, accessing local folders.\n(4) The Windows key + R shortcut is disabled.');
  pol(U, 'u.adm.start', 'LockTaskbar', 'Lock the Taskbar', HKCU_EXP + '!LockTaskbar', W2K,
    'This setting affects the taskbar, which is used to switch between running applications.');
  pol(U, 'u.adm.start', 'DisableNotificationCenter', 'Remove Notifications and Action Center', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer!DisableNotificationCenter', W10,
    'This policy setting removes Notifications and Action Center from the notification area on the taskbar.');
  // User > System
  pol(U, 'u.adm.sys', 'DisableCMD', 'Prevent access to the command prompt', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\System!DisableCMD', W2K,
    'This policy setting prevents users from running the interactive command prompt, Cmd.exe. This policy setting also determines whether batch files (.cmd and .bat) can run on the computer.\n\nIf you enable this policy setting and the user tries to open a command window, the system displays a message explaining that a setting prevents the action.\n\nIf you disable this policy setting or do not configure it, users can run Cmd.exe and batch files normally.\n\nNote: Do not prevent the computer from running batch files if the computer uses logon, logoff, startup, or shutdown batch file scripts, or for users that use Remote Desktop Services.',
    { on: null, effect: true, options: [{ id: 'DisableCMD', type: 'select', label: 'Disable the command prompt script processing also?', dflt: 2, choices: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }], reg: true }] });
  pol(U, 'u.adm.sys', 'DisableRegistryTools', 'Prevent access to registry editing tools', HKCU_SYS + '!DisableRegistryTools', W2K,
    'Disables the Windows registry editor Regedit.exe.\n\nIf you enable this policy setting and the user tries to start Regedit.exe, a message appears explaining that a policy setting prevents the action.',
    { on: null, effect: true, options: [{ id: 'DisableRegistryTools', type: 'select', label: 'Disable regedit from running silently?', dflt: 1, choices: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }], reg: true }] });
  pol(U, 'u.adm.sys', 'DisallowRun', 'Don\'t run specified Windows applications', HKCU_EXP + '!DisallowRun', W2K,
    'Prevents Windows from running the programs you specify in this policy setting.\n\nIf you enable this policy setting, users cannot run programs that you add to the list of disallowed applications.\n\nThis policy setting only prevents users from running programs that are started by the File Explorer process. It does not prevent users from running programs, such as Task Manager, which are started by the system process or by other processes.',
    { effect: true, options: [{ id: 'DisallowRunList', type: 'list', label: 'List of disallowed applications' }] });
  pol(U, 'u.adm.sys.cad', 'DisableChangePassword', 'Remove Change Password', HKCU_SYS + '!DisableChangePassword', W2K,
    'This policy setting prevents users from changing their Windows password on demand.');
  pol(U, 'u.adm.sys.cad', 'DisableLockWorkstation', 'Remove Lock Computer', HKCU_SYS + '!DisableLockWorkstation', W2K,
    'This policy setting prevents users from locking the system.\n\nWhile locked, the desktop is hidden and the system cannot be used. Only the user who locked the system or the system administrator can unlock it.', { effect: true });
  pol(U, 'u.adm.sys.cad', 'DisableTaskMgr', 'Remove Task Manager', HKCU_SYS + '!DisableTaskMgr', W2K,
    'This policy setting prevents users from starting Task Manager (Taskmgr.exe).\n\nIf you enable this policy setting and users try to start Task Manager, a message appears explaining that a policy prevents the action.', { effect: true });
  pol(U, 'u.adm.sys.cad', 'NoLogoff', 'Remove Logoff', HKCU_EXP + '!NoLogoff', W2K,
    'This policy setting disables or removes all menu items and buttons that log the user off the system.', { effect: true });
  pol(U, 'u.adm.sys.logon', 'Run', 'Run these programs at user logon', HKCU_EXP + '\\Run!Run', WXP,
    'Specifies additional programs or documents that Windows starts automatically when a user logs on to the system.', { options: [{ id: 'RunList', type: 'list', label: 'Items to run at logon' }] });
  // User > Windows Components
  const DRIVES = [{ value: 3, label: 'Restrict A and B drives only' }, { value: 4, label: 'Restrict C drive only' }, { value: 8, label: 'Restrict D drive only' },
    { value: 7, label: 'Restrict A, B and C drives only' }, { value: 15, label: 'Restrict A, B, C and D drives only' }, { value: 67108863, label: 'Restrict all drives' }, { value: 0, label: 'Do not restrict drives' }];
  pol(U, 'u.adm.wc.fe', 'NoDrives', 'Hide these specified drives in My Computer', HKCU_EXP + '!NoDrives', W2K,
    'This policy setting allows you to hide these specified drives in My Computer.\n\nThis policy setting allows you to remove the icons representing selected hard drives from My Computer and File Explorer. Also, the drive letters representing the selected drives do not appear in the standard Open dialog box.\n\nIf you enable this policy setting, select a drive or combination of drives in the drop-down list.\n\nNote: This policy setting removes the drive icons. Users can still gain access to drive contents by using other methods, such as by typing the path to a directory on the drive in the Map Network Drive dialog box, in the Run dialog box, or in a command window.',
    { on: null, effect: true, options: [{ id: 'NoDrives', type: 'select', label: 'Pick one of the following combinations', dflt: 15, choices: DRIVES, reg: true }] });
  pol(U, 'u.adm.wc.fe', 'NoViewOnDrive', 'Prevent access to drives from My Computer', HKCU_EXP + '!NoViewOnDrive', W2K,
    'Prevents users from using My Computer to gain access to the content of selected drives.\n\nIf you enable this setting, users can browse the directory structure of the selected drives in My Computer or File Explorer, but they cannot open folders and access the contents.',
    { on: null, effect: true, options: [{ id: 'NoViewOnDrive', type: 'select', label: 'Pick one of the following combinations', dflt: 15, choices: DRIVES, reg: true }] });
  pol(U, 'u.adm.wc.fe', 'NoNetConnectDisconnect', 'Remove "Map Network Drive" and "Disconnect Network Drive"', HKCU_EXP + '!NoNetConnectDisconnect', W2K,
    'Prevents users from using File Explorer or Network Locations to map or disconnect network drives.');
  pol(U, 'u.adm.wc.fe', 'NoRecycleFiles', 'Do not move deleted files to the Recycle Bin', HKCU_EXP + '!NoRecycleFiles', W2K,
    'When a file or folder is deleted in File Explorer, a copy of the file or folder is placed in the Recycle Bin. Using this setting, you can change this behavior.\n\nIf you enable this setting, files and folders that are deleted using File Explorer will not be placed in the Recycle Bin and will therefore be permanently deleted.', { effect: true });
  pol(U, 'u.adm.wc.ps', 'EnableScripts', 'Turn on Script Execution', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\PowerShell!EnableScripts', W7,
    'This policy setting lets you configure the script execution policy, controlling which scripts are allowed to run.\n\nIf you enable this policy setting, the scripts selected in the drop-down list are allowed to run.\n\nIf you disable this policy setting, no scripts are allowed to run.\n\nNote: This policy setting exists under both "Computer Configuration" and "User Configuration" in the Local Group Policy Editor. The "Computer Configuration" has precedence over "User Configuration."',
    { effect: true, options: [{ id: 'ExecutionPolicy', type: 'select', label: 'Execution Policy', dflt: 'AllSigned', choices: [{ value: 'AllSigned', label: 'Allow only signed scripts' }, { value: 'RemoteSigned', label: 'Allow local scripts and remote signed scripts' }, { value: 'Unrestricted', label: 'Allow all scripts' }] }] });

  /* ---------------------------------------------------------------- lookups */
  const pathOf = id => { const out = []; for (let x = id; x; x = parents.get(x)) out.unshift(nodes.get(x)); return out; };
  /** Registry spelling 'HKLM\\Key!Value' -> { hive, key, value }. */
  const splitReg = r => { const [k, v] = String(r).split('!'); const m = k.match(/^(HKLM|HKCU)\\(.*)$/i); return { hive: m[1].toUpperCase(), key: m[2], value: v }; };
  const policiesUnder = id => settings.filter(s => s.kind === 'policy' && (s.node === id || pathOf(s.node).some(n => n.id === id)));

  WS.gpoCatalog = {
    tree: [computer, user], node: id => nodes.get(id) || null, parent: id => nodes.get(parents.get(id)) || null, path: pathOf,
    settings, get: (side, key) => byKey.get(side + ':' + key) || null, find: key => settings.find(s => s.key === key) || null,
    inNode: id => settings.filter(s => s.node === id), policiesUnder, splitReg,
    /** Folder path as reports show it: "Control Panel/Personalization" (below Administrative Templates) or "Account Policies/Password Policy". */
    category(s) {
      const p = pathOf(s.node).map(n => n.label);
      const i = s.kind === 'policy' ? p.findIndex(l => /^Administrative Templates/.test(l)) : p.indexOf('Security Settings');
      return p.slice(i + 1).join('/');
    }
  };
})();
