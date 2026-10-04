/* Built-in lab: organizational units, users, groups and computer accounts. */
WS.labs.register({
  id: 'lab03-ad-objects',
  title: 'Lab 03: OUs, users and groups',
  difficulty: 'Beginner',
  minutes: 20,
  description: 'DC01 is the domain controller for contoso.local. Organize the Sales department in Active Directory and tidy up an old account.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      const r = WS.ad.createUser({ name: 'Contractor One', givenName: 'Contractor', sn: 'One', sam: 'contractor1', password: 'Temp-P@ss2025', enabled: true, mustChange: false });
      if (!r.ok) throw new Error(r.error);
    });
  },
  objectives: [
    {
      id: 'ou',
      text: 'Create an organizational unit named Sales at the top of the domain.',
      hint: 'Active Directory Users and Computers > right-click contoso.local > New > Organizational Unit. Or: New-ADOrganizationalUnit -Name Sales',
      check: { adOU: { name: 'Sales' } }
    },
    {
      id: 'user',
      text: 'Create an enabled user Jane Reed (logon name jreed) in the Sales OU.',
      hint: 'Select Sales > New > User. The password must meet the domain\'s complexity rules.',
      check: { adUser: { sam: 'jreed', ou: 'Sales', enabled: true } }
    },
    {
      id: 'group',
      text: 'Create a global security group named Sales Staff in the Sales OU.',
      hint: 'Select Sales > New > Group; keep Global and Security. Or: New-ADGroup "Sales Staff" -GroupScope Global -Path "OU=Sales,DC=contoso,DC=local"',
      check: { adGroup: { name: 'Sales Staff', scope: 'Global', category: 'Security', ou: 'Sales' } }
    },
    {
      id: 'member',
      text: 'Make Jane Reed a member of Sales Staff.',
      hint: 'Right-click jreed > Add to a group..., or open Sales Staff > Members > Add. Or: Add-ADGroupMember "Sales Staff" jreed',
      check: { adGroup: { name: 'Sales Staff', members: ['jreed'] } }
    },
    {
      id: 'computer',
      text: 'Create an OU named Workstations and a computer account CLIENT01 in it.',
      hint: 'New > Organizational Unit, then select Workstations > New > Computer.',
      check: { adComputer: { name: 'CLIENT01', ou: 'Workstations' } }
    },
    {
      id: 'disable',
      text: 'The contract has ended: disable the account contractor1 (in the Users container). Do not delete it.',
      hint: 'Users > right-click Contractor One > Disable Account. Or: Disable-ADAccount contractor1',
      check: { adUser: { sam: 'contractor1', enabled: false } }
    }
  ]
});
