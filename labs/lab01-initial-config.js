/* Built-in lab. To add a lab: copy this file (or labs/examples/lab-template.json for an
 * importable lab), then add a <script> tag for it in index.html after js/core/labs.js. */
WS.labs.register({
  id: 'lab01-initial-config',
  title: 'Lab 01: Initial server configuration',
  difficulty: 'Beginner',
  minutes: 15,
  description: 'A freshly installed server has a random name, the default workgroup and an address from DHCP. Give it a proper identity and a fixed address before it goes into production.',
  setup: { set: { 'system.computerName': 'WIN-LAB01Q7M2KD', 'system.workgroup': 'WORKGROUP' } },
  objectives: [
    {
      id: 'rename',
      text: 'Change the computer name to DC01.',
      hint: 'Server Manager > Local Server > click the computer name next to "Computer name".',
      check: { any: [{ path: 'system.pendingComputerName', equalsIgnoreCase: 'DC01' }, { path: 'system.computerName', equalsIgnoreCase: 'DC01' }] }
    },
    {
      id: 'workgroup',
      text: 'Put the server in the workgroup LAB.',
      hint: 'Same dialog: under "Member of", type LAB in the Workgroup box.',
      check: { path: 'system.workgroup', equalsIgnoreCase: 'LAB' }
    },
    {
      id: 'ip',
      text: 'Give the Ethernet connection the static address 192.168.1.10, subnet mask 255.255.255.0, default gateway 192.168.1.1.',
      hint: 'Server Manager > Local Server > click the Ethernet link (or run ncpa.cpl). Right-click Ethernet > Properties > Internet Protocol Version 4 (TCP/IPv4) > Properties > Use the following IP address. Or: New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.1.10 -PrefixLength 24 -DefaultGateway 192.168.1.1',
      check: { adapter: { static: true, ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' } }
    },
    {
      id: 'dns',
      text: 'Set the preferred DNS server to 192.168.1.1 (the router) by hand, so the server keeps resolving names without DHCP.',
      hint: 'Same IPv4 Properties dialog: Use the following DNS server addresses > Preferred DNS server. Or: Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses 192.168.1.1',
      check: { all: [{ path: 'network.adapters[0].dnsDhcp', equals: false }, { path: 'network.adapters[0].dnsServers[0]', equals: '192.168.1.1' }] }
    },
    {
      id: 'restart',
      text: 'Restart the server so the new name takes effect.',
      hint: 'Choose Restart Now when prompted, or Start > Power > Restart.',
      check: { path: 'system.computerName', equalsIgnoreCase: 'DC01' }
    }
  ]
});
