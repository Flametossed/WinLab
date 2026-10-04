/* Built-in lab: Group Policy Preferences Drive Maps - mapped drives for everyone, a targeted drive and removing an old mapping. */
WS.labs.register({
  id: 'lab16-drive-maps',
  title: 'Lab 16: Mapped drives with Group Policy Preferences',
  difficulty: 'Intermediate',
  minutes: 25,
  description: 'Contoso wants every user to get a Public drive at sign-in, the IT team to get an IT drive, and the old Archive drive that people mapped by hand to disappear. Use Group Policy Preferences Drive Maps (Group Policy Management > Edit... > User Configuration > Preferences > Windows Settings > Drive Maps), then process user policy and check the result with net use or File Explorer.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      const steps = [
        () => WS.fs.ensureDir('C:\\Shares\\Public'), () => WS.fs.ensureDir('C:\\Shares\\IT'), () => WS.fs.ensureDir('C:\\Shares\\Archive'),
        () => WS.fs.writeFile('C:\\Shares\\Public\\Welcome.txt', 'Shared files for everyone at Contoso.\r\n'),
        () => WS.fs.writeFile('C:\\Shares\\IT\\Runbook.txt', 'IT team runbook.\r\n'),
        () => WS.fs.writeFile('C:\\Shares\\Archive\\2019 reports.txt', 'Old reports. This share is being retired.\r\n'),
        () => WS.smb.newShare({ name: 'Public', path: 'C:\\Shares\\Public', description: 'Company files', changeAccess: ['Authenticated Users'] }),
        () => WS.smb.newShare({ name: 'IT', path: 'C:\\Shares\\IT', description: 'IT team', fullAccess: ['Administrators'] }),
        () => WS.smb.newShare({ name: 'Archive', path: 'C:\\Shares\\Archive', description: 'Retired', readAccess: ['Everyone'] }),
        () => WS.ad.createOU({ name: 'IT' }),
        () => WS.ad.createGroup({ name: 'IT Staff', scope: 'Global', category: 'Security', parent: 'IT' }),
        () => WS.ad.createUser({ name: 'Sam Ortiz', givenName: 'Sam', sn: 'Ortiz', sam: 'sortiz', parent: 'IT', password: 'IT-P@ssw0rd2025' }),
        () => WS.ad.addMember('IT Staff', 'sortiz'),
        // the drive people mapped by hand (remembered, so it comes back at every sign-in)
        () => WS.netuse.connect('X', '\\\\DC01\\Archive', { persistent: true })
      ];
      for (const step of steps) { const r = step(); if (r && r.ok === false) throw new Error(r.error); }
    });
  },
  objectives: [
    {
      id: 'gpo',
      text: 'Create a GPO named "Drive Mappings" and link it to the contoso.local domain.',
      hint: 'Server Manager > Tools > Group Policy Management > Forest > Domains > right-click contoso.local > Create a GPO in this domain, and Link it here... Or: New-GPO -Name "Drive Mappings" | New-GPLink -Target "DC=contoso,DC=local"',
      check: { gpLink: { gpo: 'Drive Mappings', target: 'contoso.local', enabled: true } }
    },
    {
      id: 'public',
      text: 'In "Drive Mappings", map P: to \\\\DC01\\Public with the Update action, labelled "Public", and set it to reconnect.',
      hint: 'Right-click Drive Mappings > Edit... > User Configuration > Preferences > Windows Settings > right-click Drive Maps > New > Mapped Drive. Action: Update, Location: \\\\DC01\\Public, check Reconnect, Label as: Public, Drive Letter: Use: P. PowerShell has no cmdlets for Drive Maps; this one is GUI only.',
      check: { gppDrive: { gpo: 'Drive Mappings', letter: 'P', action: 'Update', path: '\\\\DC01\\Public', label: 'Public', persistent: true } }
    },
    {
      id: 'it',
      text: 'Map I: to \\\\DC01\\IT in the same GPO, but only for members of the IT Staff security group.',
      hint: 'New > Mapped Drive with Location \\\\DC01\\IT and Use: I. On the Common tab check Item-level targeting, click Targeting... > New Item > Security Group, and browse (...) to IT Staff with "User in group" selected.',
      check: { gppDrive: { gpo: 'Drive Mappings', letter: 'I', path: '\\\\DC01\\IT', targeting: { type: 'group', name: 'IT Staff' } } }
    },
    {
      id: 'member',
      text: 'Add the Administrator account to the IT Staff group, so the I: drive is targeted at you as well.',
      hint: 'Active Directory Users and Computers > IT > IT Staff > Properties > Members > Add... Administrator. Or: Add-ADGroupMember -Identity "IT Staff" -Members Administrator',
      check: { adGroup: { name: 'IT Staff', members: ['Administrator'] } }
    },
    {
      id: 'archive',
      text: 'Add an item to "Drive Mappings" that deletes the old X: drive (\\\\DC01\\Archive) for everyone.',
      hint: 'New > Mapped Drive, Action: Delete, Drive Letter: Delete: X. The location can stay empty.',
      check: { gppDrive: { gpo: 'Drive Mappings', letter: 'X', action: 'Delete' } }
    },
    {
      id: 'apply',
      text: 'Process user policy so that P: and I: are mapped by Group Policy and X: is gone. Check with net use, Get-SmbMapping or File Explorer.',
      hint: 'Drive maps are applied when user policy is processed: at sign-in, or now with gpupdate (or gpupdate /target:user). Then run net use. If a drive is missing, look in Event Viewer > Applications and Services Logs > Microsoft > Windows > GroupPolicy > Operational, and the Application log (source Group Policy Drive Maps).',
      check: { all: [
        { mappedDrive: { letter: 'P', remote: '\\\\DC01\\Public', source: 'gpp' } },
        { mappedDrive: { letter: 'I', remote: '\\\\DC01\\IT', source: 'gpp' } },
        { mappedDrive: { letter: 'X', exists: false } }
      ] }
    }
  ]
});
