/* Built-in lab: DHCP scope, options and a reservation. */
WS.labs.register({
  id: 'lab05-dhcp',
  title: 'Lab 05: DHCP scope, options and reservation',
  difficulty: 'Intermediate',
  minutes: 25,
  description: 'The router\'s DHCP service has been switched off, so CLIENT01 has no address. Make DC01 the DHCP server for 192.168.1.0/24 and give CLIENT01 a fixed address.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    s.network.lan.dhcp.enabled = false;
  },
  objectives: [
    {
      id: 'role',
      text: 'Install the DHCP Server role with its management tools.',
      hint: 'Server Manager > Manage > Add Roles and Features > DHCP Server. Or: Install-WindowsFeature DHCP -IncludeManagementTools',
      check: { all: [{ feature: 'DHCP' }, { feature: 'RSAT-DHCP' }] }
    },
    {
      id: 'authorize',
      text: 'Complete the DHCP post-install configuration and authorize the server in Active Directory.',
      hint: 'Notifications flag > "Complete DHCP configuration" > Commit. Or: Add-DhcpServerInDC',
      check: { dhcpAuthorized: true }
    },
    {
      id: 'scope',
      text: 'Create an active scope named Lab LAN for 192.168.1.100 - 192.168.1.200 (255.255.255.0).',
      hint: 'DHCP console > IPv4 > New Scope... Or: Add-DhcpServerv4Scope -Name "Lab LAN" -StartRange 192.168.1.100 -EndRange 192.168.1.200 -SubnetMask 255.255.255.0',
      check: { dhcpScope: { id: '192.168.1.0', name: 'Lab LAN', start: '192.168.1.100', end: '192.168.1.200', active: true } }
    },
    {
      id: 'exclusion',
      text: 'Keep 192.168.1.100 - 192.168.1.109 for servers and printers: exclude them from distribution.',
      hint: 'Scope > Address Pool > New Exclusion Range... Or: Add-DhcpServerv4ExclusionRange -ScopeId 192.168.1.0 -StartRange 192.168.1.100 -EndRange 192.168.1.109',
      check: { dhcpScope: { id: '192.168.1.0', exclusion: { start: '192.168.1.100', end: '192.168.1.109' } } }
    },
    {
      id: 'options',
      text: 'Give clients the router 192.168.1.1, the DNS server 192.168.1.10 and the DNS domain name contoso.local.',
      hint: 'Scope Options (or Server Options) > Configure Options... > 003, 006, 015. Or: Set-DhcpServerv4OptionValue -ScopeId 192.168.1.0 -Router 192.168.1.1 -DnsServer 192.168.1.10 -DnsDomain contoso.local',
      check: { all: [
        { dhcpScope: { id: '192.168.1.0', option: { code: 3, value: ['192.168.1.1'] } } },
        { dhcpScope: { id: '192.168.1.0', option: { code: 6, value: ['192.168.1.10'] } } },
        { dhcpScope: { id: '192.168.1.0', option: { code: 15, value: 'contoso.local' } } }] }
    },
    {
      id: 'reservation',
      text: 'Reserve 192.168.1.150 for CLIENT01 (MAC address 00-15-5D-01-01-32).',
      hint: 'Scope > Reservations > New Reservation... Or: Add-DhcpServerv4Reservation -ScopeId 192.168.1.0 -IPAddress 192.168.1.150 -ClientId 00-15-5D-01-01-32 -Name CLIENT01',
      check: { dhcpScope: { id: '192.168.1.0', reservation: { ip: '192.168.1.150', mac: '00-15-5D-01-01-32' } } }
    },
    {
      id: 'lease',
      text: 'Confirm that CLIENT01 now leases its reserved address from DC01.',
      hint: 'Scope > Address Leases shows "Reservation (active)". Or: Get-DhcpServerv4Lease -ScopeId 192.168.1.0',
      check: { dhcpLease: { client: 'CLIENT01', ip: '192.168.1.150', scope: '192.168.1.0', reservation: true } }
    }
  ]
});
