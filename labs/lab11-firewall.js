/* Built-in lab: Windows Defender Firewall - profiles, rules, scope, logging, and a broken Remote Desktop. */
WS.labs.register({
  id: 'lab11-firewall',
  title: 'Lab 11: Windows Defender Firewall',
  difficulty: 'Intermediate',
  minutes: 30,
  description: 'DC01 is a stand-alone server that will host a line-of-business web app. Remote Desktop stopped working after a technician "tidied up" the firewall. Fix it, open only what the app needs, block Telnet, and set up logging and a policy backup.',
  setup: (s, WS) => {
    WS.labs.fixtures.configured(s);
    WS.labs.withState(s, () => {
      WS.sys.setRemoteDesktop(true, true);
      const r = WS.fw.newRule({ displayName: 'Temp - block 3389', description: 'Added during troubleshooting. Remove when done.', direction: 'Inbound', action: 'Block', protocol: 'TCP', localPort: '3389', profile: 'Any' });
      if (!r.ok) throw new Error(r.error);
      WS.fs.ensureDir('C:\\Backup');
    });
  },
  objectives: [
    {
      id: 'profile',
      text: 'The lab network is trusted: change the Ethernet connection from the Public to the Private network profile.',
      hint: 'In PowerShell: Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private. The overview in wf.msc then says "Private Profile is Active".',
      check: { path: 'firewall.networkCategory', equals: 'Private' }
    },
    {
      id: 'rdp',
      text: 'Remote Desktop to DC01 no longer works from CLIENT01. Find the firewall rule that blocks it and delete or disable it.',
      hint: 'wf.msc > Inbound Rules. Sort by Action, or Filter by State > Filter by Enabled, and look for a Block rule on port 3389. Or: Get-NetFirewallRule -Action Block, then Remove-NetFirewallRule.',
      check: { firewallAllows: { protocol: 'TCP', port: 3389, from: 'CLIENT01' } }
    },
    {
      id: 'ping',
      text: 'Allow ping (ICMPv4 Echo Request) to DC01 from the lab network.',
      hint: 'wf.msc > Inbound Rules > "File and Printer Sharing (Echo Request - ICMPv4-In)" > Enable Rule. Or: Enable-NetFirewallRule -Name FPS-ICMP4-ERQ-In',
      check: { firewallAllows: { protocol: 'ICMPv4', from: 'CLIENT01' } }
    },
    {
      id: 'app',
      text: 'Create an inbound rule named "Contoso Web App" that allows TCP 8080 on the Domain and Private profiles only, and only from the 192.168.1.0/24 network.',
      hint: 'Inbound Rules > New Rule... > Port > TCP 8080 > Allow > clear Public > name it. Then Properties > Scope > Remote IP address > These IP addresses > Add 192.168.1.0/24. Or: New-NetFirewallRule -DisplayName "Contoso Web App" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Domain,Private -RemoteAddress 192.168.1.0/24',
      check: { all: [
        { firewallRule: { displayName: 'Contoso Web App', direction: 'Inbound', protocol: 'TCP', localPort: '8080', action: 'Allow', enabled: true, profile: 'Domain, Private' } },
        { firewallAllows: { protocol: 'TCP', port: 8080, from: 'CLIENT01' } },
        { not: { firewallAllows: { protocol: 'TCP', port: 8080, from: '10.0.0.5' } } }
      ] }
    },
    {
      id: 'telnet',
      text: 'Block outbound Telnet (TCP port 23) on every profile with an outbound rule named "Block Telnet".',
      hint: 'Outbound Rules > New Rule... > Port > TCP, Specific remote ports: 23 > Block the connection. Or: New-NetFirewallRule -DisplayName "Block Telnet" -Direction Outbound -Protocol TCP -RemotePort 23 -Action Block',
      check: { all: [{ firewallRule: { displayName: 'Block Telnet', direction: 'Outbound', action: 'Block', enabled: true } }, { not: { firewallAllows: { direction: 'Outbound', protocol: 'TCP', port: 23 } } }] }
    },
    {
      id: 'log',
      text: 'For the Private profile, log dropped packets and raise the log size limit to at least 16,384 KB.',
      hint: 'Right-click the top node > Properties > Private Profile > Logging: Customize... Or: Set-NetFirewallProfile -Profile Private -LogBlocked True -LogMaxSizeKilobytes 16384',
      check: { firewallProfile: { name: 'Private', logDropped: true, minLogMaxKB: 16384 } }
    },
    {
      id: 'export',
      text: 'Back up the finished firewall policy to C:\\Backup\\firewall.wfw.',
      hint: 'Right-click the top node > Export Policy... Or: netsh advfirewall export C:\\Backup\\firewall.wfw',
      check: { file: { path: 'C:\\Backup\\firewall.wfw', contains: 'ws2025lab-wfw' } }
    }
  ]
});
