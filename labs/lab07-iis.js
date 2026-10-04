/* Built-in lab: Web Server (IIS) - sites, host headers, DNS, default documents, a second site on its own port with
 * directory browsing, the firewall, an application pool and an HTTPS binding. */
WS.labs.register({
  id: 'lab07-iis',
  title: 'Lab 07: Web Server (IIS)',
  difficulty: 'Intermediate',
  minutes: 40,
  description: 'Contoso wants an intranet on DC01. The web team has copied the pages to C:\\Sites\\Intranet and the monthly reports to C:\\Sites\\Reports. Install IIS, publish both sites, make the intranet reachable by name over HTTP and HTTPS, and let CLIENT01 reach the reports.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      WS.fs.ensureDir('C:\\Sites\\Intranet\\images');
      WS.fs.writeFile('C:\\Sites\\Intranet\\home.htm', '<!DOCTYPE html>\r\n<html>\r\n<head><title>Contoso Intranet</title></head>\r\n<body>\r\n<h1>Contoso Intranet</h1>\r\n<p>Welcome to the Contoso intranet.</p>\r\n<ul>\r\n<li><a href="/news.htm">Company news</a></li>\r\n<li><a href="http://dc01.contoso.local:8080/">Monthly reports</a></li>\r\n</ul>\r\n</body>\r\n</html>\r\n');
      WS.fs.writeFile('C:\\Sites\\Intranet\\news.htm', '<!DOCTYPE html>\r\n<html>\r\n<head><title>Company news</title></head>\r\n<body><h1>Company news</h1><p>The new intranet is live.</p><p><a href="/home.htm">Home</a></p></body>\r\n</html>\r\n');
      WS.fs.writeFile('C:\\Sites\\Intranet\\images\\logo.png', '', null, { size: 18432 });
      WS.fs.ensureDir('C:\\Sites\\Reports\\Archive');
      WS.fs.writeFile('C:\\Sites\\Reports\\Q1-2026.csv', 'Region,Sales\r\nNorth,120500\r\nSouth,98200\r\n');
      WS.fs.writeFile('C:\\Sites\\Reports\\Q2-2026.csv', 'Region,Sales\r\nNorth,131000\r\nSouth,101400\r\n');
      WS.fs.writeFile('C:\\Sites\\Reports\\Archive\\Q4-2025.csv', 'Region,Sales\r\nNorth,110900\r\nSouth,90100\r\n');
    });
  },
  objectives: [
    {
      id: 'role',
      text: 'Install the Web Server (IIS) role with the IIS Management Console.',
      hint: 'Server Manager > Manage > Add Roles and Features > Web Server (IIS). Or: Install-WindowsFeature Web-Server -IncludeManagementTools. Then open Tools > Internet Information Services (IIS) Manager (inetmgr).',
      check: { all: [{ feature: 'Web-Server' }, { feature: 'Web-Mgmt-Console' }] }
    },
    {
      id: 'site',
      text: 'Create a website named "Intranet" for C:\\Sites\\Intranet, bound to HTTP port 80 with the host name intranet.contoso.local, and start it.',
      hint: 'IIS Manager > Sites > Add Website... (site name Intranet, physical path C:\\Sites\\Intranet, host name intranet.contoso.local). The Default Web Site keeps *:80 without a host name, so both can run. Or, after Install-WindowsFeature Web-Scripting-Tools: New-IISSite -Name Intranet -PhysicalPath C:\\Sites\\Intranet -BindingInformation "*:80:intranet.contoso.local"',
      check: { iisSite: { name: 'Intranet', physicalPath: 'C:\\Sites\\Intranet', state: 'Started', binding: { protocol: 'http', port: 80, host: 'intranet.contoso.local' } } }
    },
    {
      id: 'pool',
      text: 'The intranet is static HTML: run it in its own application pool named "Intranet" with the .NET CLR version set to No Managed Code.',
      hint: 'Add Website creates a pool named after the site: Application Pools > Intranet > Basic Settings... > .NET CLR version: No Managed Code. From the command line (in C:\\Windows\\System32\\inetsrv, which is not on PATH): appcmd add apppool /name:Intranet /managedRuntimeVersion: then appcmd set app "Intranet/" /applicationPool:Intranet',
      check: { all: [{ iisSite: { name: 'Intranet', pool: 'Intranet' } }, { iisAppPool: { name: 'Intranet', runtime: 'No Managed Code', state: 'Started' } }] }
    },
    {
      id: 'dns',
      text: 'Make intranet.contoso.local resolve to DC01 (192.168.1.10).',
      hint: 'DNS Manager > Forward Lookup Zones > contoso.local > New Host (A or AAAA)... intranet, 192.168.1.10 (or a CNAME to dc01.contoso.local). Or: Add-DnsServerResourceRecordA -ZoneName contoso.local -Name intranet -IPv4Address 192.168.1.10',
      check: { resolves: { name: 'intranet.contoso.local', ip: '192.168.1.10' } }
    },
    {
      id: 'home',
      text: 'Browsing to http://intranet.contoso.local/ must show the intranet home page. The page is home.htm, which is not one of IIS\u2019s default documents: add it to the Intranet site only.',
      hint: 'Try it in Edge first: you get HTTP Error 403.14. IIS Manager > Intranet > Default Document > Add... > home.htm. Or: Add-WebConfigurationProperty -Filter //defaultDocument/files -PSPath IIS:\\Sites\\Intranet -AtIndex 0 -Name Collection -Value home.htm',
      check: { all: [{ iisDefaultDoc: { site: 'Intranet', file: 'home.htm' } }, { not: { iisDefaultDoc: { file: 'home.htm' } } }, { http: { url: 'http://intranet.contoso.local/', status: 200, contains: 'Welcome to the Contoso intranet' } }] }
    },
    {
      id: 'reports',
      text: 'Publish C:\\Sites\\Reports as a website named "Reports" on port 8080 (all addresses, no host name) and turn on directory browsing for it, so the report files are listed.',
      hint: 'Add Website... with port 8080, then Reports > Directory Browsing > Enable (Actions pane). Or: appcmd add site /name:Reports /bindings:http/*:8080: /physicalPath:C:\\Sites\\Reports and appcmd set config Reports /section:directoryBrowse /enabled:true',
      check: { all: [{ iisSite: { name: 'Reports', state: 'Started', binding: { protocol: 'http', port: 8080, host: '' }, dirBrowse: true } }, { http: { url: 'http://dc01.contoso.local:8080/', status: 200, contains: 'Q1-2026.csv' } }] }
    },
    {
      id: 'firewall',
      text: 'CLIENT01 cannot reach the reports yet: allow inbound TCP 8080 through Windows Defender Firewall.',
      hint: 'IIS only opens ports 80 and 443 (World Wide Web Services rules). wf.msc > Inbound Rules > New Rule... > Port > TCP 8080 > Allow. Or: New-NetFirewallRule -DisplayName "IIS Reports (TCP 8080)" -Direction Inbound -Protocol TCP -LocalPort 8080',
      check: { firewallAllows: { protocol: 'TCP', port: 8080, from: 'CLIENT01' } }
    },
    {
      id: 'https',
      text: 'Add an HTTPS binding on port 443 for intranet.contoso.local, using a self-signed certificate for that name.',
      hint: 'IIS Manager\u2019s Create Self-Signed Certificate... always issues the certificate to the server\u2019s own name (dc01.contoso.local), so make this one in PowerShell: New-SelfSignedCertificate -DnsName intranet.contoso.local -CertStoreLocation Cert:\\LocalMachine\\My. Then Intranet > Bindings... > Add... > https, host name intranet.contoso.local, SSL certificate. Edge shows "Your connection isn\u2019t private" because the certificate is self-signed: Advanced > Continue.',
      check: { all: [{ iisSite: { name: 'Intranet', binding: { protocol: 'https', port: 443, host: 'intranet.contoso.local', cert: true, certCovers: true } } }, { http: { url: 'https://intranet.contoso.local/', status: 200, contains: 'Contoso Intranet' } }] }
    }
  ]
});
