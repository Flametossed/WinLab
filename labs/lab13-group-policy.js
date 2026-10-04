/* Built-in lab: Group Policy with GPMC - the domain password policy, a filtered user GPO, a logon banner, inheritance and a backup. */
WS.labs.register({
  id: 'lab13-group-policy',
  title: 'Lab 13: Group Policy',
  difficulty: 'Intermediate',
  minutes: 35,
  description: 'Contoso needs its first Group Policy objects. Tighten the domain password policy and make it take effect, lock down the Sales desktops without touching the administrators, put a logon banner on the domain controller, keep the kiosk OU clean, and back everything up. Use Group Policy Management (Server Manager > Tools) and gpupdate.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      const steps = [
        () => WS.ad.createOU({ name: 'Sales' }),
        () => WS.ad.createGroup({ name: 'Sales Staff', scope: 'Global', category: 'Security', parent: 'Sales' }),
        () => WS.ad.createUser({ name: 'Jo Smith', givenName: 'Jo', sn: 'Smith', sam: 'jsmith', parent: 'Sales', password: 'Sales-P@ss2025' }),
        () => WS.ad.createUser({ name: 'Ana Lima', givenName: 'Ana', sn: 'Lima', sam: 'alima', parent: 'Sales', password: 'Sales-P@ss2025' }),
        () => WS.ad.addMember('Sales Staff', 'jsmith'),
        () => WS.ad.addMember('Sales Staff', 'alima'),
        () => WS.ad.createOU({ name: 'Kiosks' }),
        () => WS.ad.createComputer({ name: 'KIOSK01', parent: 'Kiosks' }),
        () => WS.ad.createComputer({ name: 'CLIENT01', parent: 'Sales' })
      ];
      for (const step of steps) { const r = step(); if (r && r.ok === false) throw new Error(r.error); }
      WS.fs.ensureDir('C:\\GPOBackup');
    });
  },
  objectives: [
    {
      id: 'password',
      text: 'In the Default Domain Policy, require passwords of at least 12 characters and lock an account out after 5 invalid sign-in attempts.',
      hint: 'Group Policy Management > Forest > Domains > contoso.local > right-click Default Domain Policy > Edit... Then Computer Configuration > Policies > Windows Settings > Security Settings > Account Policies. Password Policy > Minimum password length: 12. Account Lockout Policy > Account lockout threshold: 5 (accept the suggested values for the duration and reset counter). PowerShell cannot edit security settings inside a GPO; Set-ADDefaultDomainPasswordPolicy changes the domain directly and is overwritten the next time the GPO is re-applied.',
      check: { all: [
        { gpoSetting: { gpo: 'Default Domain Policy', side: 'computer', key: 'MinimumPasswordLength', value: { gte: 12 } } },
        { gpoSetting: { gpo: 'Default Domain Policy', side: 'computer', key: 'LockoutBadCount', value: 5 } }
      ] }
    },
    {
      id: 'apply',
      text: 'Make the new password policy take effect now, so that Get-ADDefaultDomainPasswordPolicy reports it.',
      hint: 'Domain password policy is applied when the domain controller processes Group Policy (every 5 minutes on a DC). Run gpupdate (or gpupdate /force) in Command Prompt or PowerShell, then check with Get-ADDefaultDomainPasswordPolicy or net accounts.',
      check: { domainPasswordPolicy: { minLength: { gte: 12 }, lockoutThreshold: 5 } }
    },
    {
      id: 'gpo',
      text: 'Create a GPO named "Sales Desktop Restrictions" and link it to the Sales OU.',
      hint: 'Right-click the Sales OU > Create a GPO in this domain, and Link it here... Or: New-GPO -Name "Sales Desktop Restrictions" | New-GPLink -Target "OU=Sales,DC=contoso,DC=local"',
      check: { gpLink: { gpo: 'Sales Desktop Restrictions', target: 'Sales', enabled: true } }
    },
    {
      id: 'settings',
      text: 'In that GPO, prohibit access to Control Panel and prevent access to the command prompt, but still allow batch scripts to run.',
      hint: 'Edit the GPO > User Configuration > Policies > Administrative Templates. Control Panel > Prohibit access to Control Panel and PC settings: Enabled. System > Prevent access to the command prompt: Enabled, with "Disable the command prompt script processing also?" set to No. Or: Set-GPRegistryValue -Name "Sales Desktop Restrictions" -Key "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" -ValueName NoControlPanel -Type DWord -Value 1, and the same for "HKCU\\Software\\Policies\\Microsoft\\Windows\\System" DisableCMD with the value 2.',
      check: { all: [
        { gpoSetting: { gpo: 'Sales Desktop Restrictions', side: 'user', key: 'NoControlPanel', state: 'Enabled' } },
        { gpoSetting: { gpo: 'Sales Desktop Restrictions', side: 'user', key: 'DisableCMD', state: 'Enabled', options: { DisableCMD: 2 } } }
      ] }
    },
    {
      id: 'filter',
      text: 'Filter "Sales Desktop Restrictions" so it applies only to the Sales Staff group. Computers must still be able to read the GPO, or the user settings will not apply.',
      hint: 'Select the GPO > Scope tab > Security Filtering: remove Authenticated Users and add Sales Staff. Then Delegation tab > Add... Authenticated Users (or Domain Computers) with Read. Since the MS16-072 update, user policy is read with the computer\'s account, so a GPO that only Sales Staff can read never applies. Or: Set-GPPermission -Name "Sales Desktop Restrictions" -TargetName "Sales Staff" -TargetType Group -PermissionLevel GpoApply; Set-GPPermission -Name "Sales Desktop Restrictions" -TargetName "Authenticated Users" -TargetType Group -PermissionLevel GpoRead -Replace',
      check: { all: [
        { gpoPermission: { gpo: 'Sales Desktop Restrictions', trustee: 'Sales Staff', level: 'GpoApply' } },
        { not: { gpoPermission: { gpo: 'Sales Desktop Restrictions', trustee: 'Authenticated Users', level: 'GpoApply' } } },
        { any: [
          { gpoPermission: { gpo: 'Sales Desktop Restrictions', trustee: 'Authenticated Users', level: ['GpoRead', 'GpoEdit', 'GpoEditDeleteModifySecurity'] } },
          { gpoPermission: { gpo: 'Sales Desktop Restrictions', trustee: 'Domain Computers', level: ['GpoRead', 'GpoApply'] } }
        ] }
      ] }
    },
    {
      id: 'banner',
      text: 'Show a logon banner on the domain controllers: use the Default Domain Controllers Policy, with the title "Authorized use only" and a message of your choice.',
      hint: 'Edit Default Domain Controllers Policy > Computer Configuration > Policies > Windows Settings > Security Settings > Local Policies > Security Options: "Interactive logon: Message title for users attempting to log on" and "Interactive logon: Message text for users attempting to log on". After gpupdate, lock the server (Start > Power > Lock) to see it.',
      check: { all: [
        { gpoSetting: { gpo: 'Default Domain Controllers Policy', side: 'computer', key: 'LegalNoticeCaption', value: 'Authorized use only' } },
        { gpoSetting: { gpo: 'Default Domain Controllers Policy', side: 'computer', key: 'LegalNoticeText', value: { nonEmpty: true } } }
      ] }
    },
    {
      id: 'inheritance',
      text: 'The Kiosks OU must not inherit domain GPOs, except the Default Domain Policy, which has to apply everywhere.',
      hint: 'Right-click Kiosks > Block Inheritance. Then right-click the Default Domain Policy link under contoso.local > Enforced. Check the Kiosks OU\'s Group Policy Inheritance tab. Or: Set-GPInheritance -Target "OU=Kiosks,DC=contoso,DC=local" -IsBlocked Yes; Set-GPLink -Name "Default Domain Policy" -Target "DC=contoso,DC=local" -Enforced Yes',
      check: { all: [
        { gpInheritance: { target: 'Kiosks', blocked: true } },
        { gpLink: { gpo: 'Default Domain Policy', target: 'contoso.local', enforced: true } }
      ] }
    },
    {
      id: 'backup',
      text: 'Back up all GPOs, including "Sales Desktop Restrictions", to C:\\GPOBackup.',
      hint: 'Right-click Group Policy Objects > Back Up All... and enter C:\\GPOBackup. Or: Backup-GPO -All -Path C:\\GPOBackup',
      check: { all: [{ gpoBackup: { path: 'C:\\GPOBackup', gpo: 'Sales Desktop Restrictions' } }, { gpoBackup: { path: 'C:\\GPOBackup', gpo: 'Default Domain Policy' } }] }
    }
  ]
});
