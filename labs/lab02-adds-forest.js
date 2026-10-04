/* Built-in lab: install AD DS and create the contoso.local forest. */
WS.labs.register({
  id: 'lab02-adds-forest',
  title: 'Lab 02: Install AD DS and create a forest',
  difficulty: 'Beginner',
  minutes: 20,
  description: 'DC01 has its name and a static IP address. Make it the first domain controller of a new forest, contoso.local, with DNS installed alongside Active Directory.',
  setup: (s, WS) => WS.labs.fixtures.configured(s),
  objectives: [
    {
      id: 'role',
      text: 'Install the Active Directory Domain Services role, including its management tools.',
      hint: 'Server Manager > Manage > Add Roles and Features > Server Roles > Active Directory Domain Services, then accept "Add Features". Or: Install-WindowsFeature AD-Domain-Services -IncludeManagementTools',
      check: { all: [{ feature: 'AD-Domain-Services' }, { feature: 'RSAT-ADDS-Tools' }] }
    },
    {
      id: 'promote',
      text: 'Promote the server to a domain controller in a new forest named contoso.local.',
      hint: 'Click the notifications flag > "Promote this server to a domain controller" > Add a new forest. Or: Install-ADDSForest -DomainName contoso.local',
      check: { path: 'system.domain', equalsIgnoreCase: 'contoso.local' }
    },
    {
      id: 'netbios',
      text: 'Keep the default NetBIOS domain name, CONTOSO.',
      hint: 'The Additional Options page of the AD DS Configuration Wizard proposes it.',
      check: { path: 'ad.netbios', equalsIgnoreCase: 'CONTOSO' }
    },
    {
      id: 'dns',
      text: 'Install DNS with the domain controller, so that contoso.local is an Active Directory-integrated zone.',
      hint: 'Leave "Domain Name System (DNS) server" checked on the Domain Controller Options page. Check it afterwards in Server Manager > Tools > DNS.',
      check: { all: [{ feature: 'DNS' }, { dnsZone: { name: 'contoso.local', adIntegrated: true } }] }
    },
    {
      id: 'srv',
      text: 'Confirm that the domain controller registered its locator (SRV) records and that contoso.local resolves to 192.168.1.10.',
      hint: 'DNS Manager > contoso.local > _tcp shows _ldap and _kerberos. Then run: nslookup contoso.local',
      check: { all: [{ dnsRecord: { zone: 'contoso.local', name: '_ldap._tcp', type: 'SRV' } }, { resolves: { name: 'contoso.local', ip: '192.168.1.10' } }] }
    }
  ]
});
