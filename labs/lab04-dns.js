/* Built-in lab: DNS zones, records and forwarding. */
WS.labs.register({
  id: 'lab04-dns',
  title: 'Lab 04: DNS records and a reverse zone',
  difficulty: 'Intermediate',
  minutes: 25,
  description: 'DC01 runs DNS for contoso.local. Publish the company web and mail servers, add reverse lookup, and set up forwarding for internet and partner names.',
  setup: (s, WS) => WS.labs.fixtures.domainController(s),
  objectives: [
    {
      id: 'reverse',
      text: 'Create an Active Directory-integrated reverse lookup zone for 192.168.1.0/24.',
      hint: 'DNS Manager > right-click Reverse Lookup Zones > New Zone... > Primary zone, stored in Active Directory > IPv4 > Network ID 192.168.1. Or: Add-DnsServerPrimaryZone -NetworkId 192.168.1.0/24 -ReplicationScope Domain',
      check: { dnsZone: { name: '1.168.192.in-addr.arpa', adIntegrated: true } }
    },
    {
      id: 'www',
      text: 'Add a host (A) record www.contoso.local for 192.168.1.20, with its pointer (PTR) record.',
      hint: 'Right-click contoso.local > New Host (A or AAAA)..., and check "Create associated pointer (PTR) record". Create the reverse zone first.',
      check: { all: [{ dnsRecord: { zone: 'contoso.local', name: 'www', type: 'A', data: '192.168.1.20' } }, { dnsRecord: { zone: '1.168.192.in-addr.arpa', name: '20', type: 'PTR', data: 'www.contoso.local' } }] }
    },
    {
      id: 'alias',
      text: 'Add an alias (CNAME) intranet.contoso.local that points to www.contoso.local.',
      hint: 'Right-click contoso.local > New Alias (CNAME)... Or: Add-DnsServerResourceRecordCName -ZoneName contoso.local -Name intranet -HostNameAlias www.contoso.local',
      check: { dnsRecord: { zone: 'contoso.local', name: 'intranet', type: 'CNAME', data: 'www.contoso.local' } }
    },
    {
      id: 'mail',
      text: 'Add a host mail.contoso.local (192.168.1.25) and a mail exchanger (MX) record for contoso.local that points to it.',
      hint: 'Create the host first, then New Mail Exchanger (MX)... with the host field left blank. Or: Add-DnsServerResourceRecordMX -ZoneName contoso.local -Name . -MailExchange mail.contoso.local -Preference 10',
      check: { all: [{ dnsRecord: { zone: 'contoso.local', name: 'mail', type: 'A', data: '192.168.1.25' } }, { dnsRecord: { zone: 'contoso.local', name: '@', type: 'MX', data: 'mail.contoso.local' } }] }
    },
    {
      id: 'forwarder',
      text: 'Forward internet queries to 8.8.8.8.',
      hint: 'Right-click the server > Properties > Forwarders > Edit... Or: Add-DnsServerForwarder 8.8.8.8',
      check: { dnsForwarders: ['8.8.8.8'] }
    },
    {
      id: 'conditional',
      text: 'Send queries for the partner domain fabrikam.com to their DNS server, 192.168.1.1, with a conditional forwarder.',
      hint: 'DNS Manager > right-click Conditional Forwarders > New Conditional Forwarder... Or: Add-DnsServerConditionalForwarderZone -Name fabrikam.com -MasterServers 192.168.1.1',
      check: { conditionalForwarder: { name: 'fabrikam.com', masters: ['192.168.1.1'] } }
    },
    {
      id: 'verify',
      text: 'Verify from the server that intranet.contoso.local resolves to 192.168.1.20.',
      hint: 'Run: nslookup intranet.contoso.local, or Resolve-DnsName intranet.contoso.local',
      check: { resolves: { name: 'intranet.contoso.local', ip: '192.168.1.20' } }
    }
  ]
});
