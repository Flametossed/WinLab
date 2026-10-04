/* Static catalogs: Windows Server roles/role services/features and the service list.
 * Feature ids match the real Install-WindowsFeature names so PowerShell practice transfers. */
(function () {
  'use strict';
  const WS = window.WS;

  // [id, display name, children?, opts?]   opts: {installed, desc, mgmt:[ids], reboot, services:[], tools:[], defaultChildren:[]}
  // type is inferred: top level of ROLES = role, nested = roleService; top level of FEATURES = feature, nested = feature (sub-feature)
  const ROLES = [
    ['AD-Certificate', 'Active Directory Certificate Services', [
      ['ADCS-Cert-Authority', 'Certification Authority', null, { desc: 'Certification Authority (CA) is used to issue and manage certificates. Multiple CAs can be linked to form a public key infrastructure.' }],
      ['ADCS-Enroll-Web-Pol', 'Certificate Enrollment Policy Web Service'],
      ['ADCS-Enroll-Web-Svc', 'Certificate Enrollment Web Service'],
      ['ADCS-Web-Enrollment', 'Certification Authority Web Enrollment'],
      ['ADCS-Device-Enrollment', 'Network Device Enrollment Service'],
      ['ADCS-Online-Cert', 'Online Responder']
    ], { desc: 'Active Directory Certificate Services (AD CS) is used to create certification authorities and related role services that allow you to issue and manage certificates used in a variety of applications.', mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-ADCS', 'RSAT-ADCS-Mgmt'], defaultChildren: ['ADCS-Cert-Authority'], services: ['CertSvc'], postConfig: 'adcs' }],
    ['AD-Domain-Services', 'Active Directory Domain Services', null, {
      desc: 'Active Directory Domain Services (AD DS) stores information about objects on the network and makes this information available to users and network administrators. AD DS uses domain controllers to give network users access to permitted resources anywhere on the network through a single logon process.',
      mgmt: ['GPMC', 'RSAT', 'RSAT-Role-Tools', 'RSAT-AD-Tools', 'RSAT-AD-PowerShell', 'RSAT-ADDS', 'RSAT-AD-AdminCenter', 'RSAT-ADDS-Tools'], postConfig: 'adds'
    }],
    ['ADFS-Federation', 'Active Directory Federation Services', null, { desc: 'Active Directory Federation Services (AD FS) provides simplified, secured identity federation and Web single sign-on (SSO) capabilities.' }],
    ['ADLDS', 'Active Directory Lightweight Directory Services', null, { desc: 'Active Directory Lightweight Directory Services (AD LDS) provides a store for application-specific data, for directory-enabled applications that do not require the infrastructure of Active Directory Domain Services.', mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-AD-Tools', 'RSAT-ADLDS'] }],
    ['ADRMS', 'Active Directory Rights Management Services', null, { desc: 'Active Directory Rights Management Services (AD RMS) helps you protect information from unauthorized use.' }],
    ['Device-Health-Attestation', 'Device Health Attestation', null, { desc: 'The Device Health Attestation Service enables enterprise policy based enforcement of device security, based on the health attestation reports from TPM-enabled devices.' }],
    ['DHCP', 'DHCP Server', null, { desc: 'Dynamic Host Configuration Protocol (DHCP) Server enables you to centrally configure, manage, and provide temporary IP addresses and related information for client computers.', mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-DHCP'], services: ['DHCPServer'], postConfig: 'dhcp', staticIp: true }],
    ['DNS', 'DNS Server', null, { desc: 'Domain Name System (DNS) Server provides name resolution for TCP/IP networks. DNS Server is easier to manage when it is installed on the same server as Active Directory Domain Services. If you select the Active Directory Domain Services role, you can install and configure DNS Server and Active Directory Domain Services to work together.', mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-DNS-Server'], services: ['DNS'], staticIp: true }],
    ['FileAndStorage-Services', 'File and Storage Services', [
      ['File-Services', 'File and iSCSI Services', [
        ['FS-FileServer', 'File Server', null, { desc: 'File Server manages shared folders and enables users to access files on this computer from the network.' }],
        ['FS-BranchCache', 'BranchCache for Network Files', null, { desc: 'BranchCache for Network Files provides support for BranchCache on this file server.' }],
        ['FS-Data-Deduplication', 'Data Deduplication', null, { desc: 'Data Deduplication saves disk space by storing a single copy of identical data on the volume.' }],
        ['FS-DFS-Namespace', 'DFS Namespaces', null, { desc: 'DFS Namespaces enables you to group shared folders located on different servers into one or more logically structured namespaces.', services: ['Dfs'], mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-File-Services', 'RSAT-DFS-Mgmt-Con'] }],
        ['FS-DFS-Replication', 'DFS Replication', null, { desc: 'DFS Replication is a multimaster replication engine that enables you to synchronize folders on multiple servers across local or wide area network (WAN) network connections.', services: ['DFSR'], mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-File-Services', 'RSAT-DFS-Mgmt-Con'] }],
        ['FS-Resource-Manager', 'File Server Resource Manager', null, { desc: 'File Server Resource Manager helps you manage and understand the files and folders on a file server by scheduling file management tasks and storage reports, classifying files and folders, configuring folder quotas, and defining file screening policies.', services: ['SrmSvc'], mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-File-Services', 'RSAT-FSRM-Mgmt'] }],
        ['FS-VSS-Agent', 'File Server VSS Agent Service'],
        ['FS-iSCSITarget-Server', 'iSCSI Target Server', null, { desc: 'iSCSI Target Server provides services and management tools for iSCSI targets.' }],
        ['iSCSITarget-VSS-VDS', 'iSCSI Target Storage Provider (VDS and VSS hardware providers)'],
        ['FS-NFS-Service', 'Server for NFS', null, { desc: 'Server for NFS enables this computer to share files with UNIX-based computers and other computers that use the network file system (NFS) protocol.' }],
        ['FS-SyncShareService', 'Work Folders', null, { desc: 'Work Folders provides a way to use work files from a variety of computers, including work and personal devices.' }]
      ], { desc: 'File and iSCSI Services provides technologies that help you manage file servers and storage, reduce disk space utilization, replicate and cache files to branch offices, move or fail over a file share to another cluster node, and share files by using the NFS protocol.' }],
      ['Storage-Services', 'Storage Services', null, { installed: true, desc: 'Storage Services provides storage management functionality that is always installed and cannot be removed.' }]
    ], { installed: true, desc: 'File and Storage Services includes services that are always installed, as well as functionality that you can install to help manage file servers and storage.' }],
    ['HostGuardianServiceRole', 'Host Guardian Service', null, { desc: 'The Host Guardian Service (HGS) server role provides the Attestation and Key Protection services that enable Guarded Hosts to run Shielded virtual machines.' }],
    ['Hyper-V', 'Hyper-V', null, { desc: 'Hyper-V provides the services that you can use to create and manage virtual machines and their resources. Each virtual machine is a virtualized computer system that operates in an isolated execution environment. This allows you to run multiple operating systems simultaneously.', mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-Hyper-V-Tools', 'Hyper-V-Tools', 'Hyper-V-PowerShell'], reboot: true, services: ['vmms', 'vmcompute'] }],
    ['NetworkATC', 'Network ATC', null, { desc: 'Network ATC simplifies the deployment and network configuration management for Azure Stack HCI and Windows Server clusters.' }],
    ['NetworkController', 'Network Controller', null, { desc: 'The Network Controller provides the point of automation needed for continual configuration, monitoring and diagnostics of virtual networks, physical networks, network services, network topology, address management, etc. within a datacenter stamp.' }],
    ['NPAS', 'Network Policy and Access Services', null, { desc: 'Network Policy and Access Services provides a Network Policy Server (NPS), which helps safeguard the security of your network.', services: ['IAS'], mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-NPAS'] }],
    ['Print-Services', 'Print and Document Services', [
      ['Print-Server', 'Print Server', null, { desc: 'Print Server includes the Print Management snap-in, which is used for managing multiple printers or print servers and migrating printers to and from other Windows print servers.' }],
      ['Print-Internet', 'Internet Printing'],
      ['Print-LPD-Service', 'LPD Service']
    ], { desc: 'Print and Document Services enables you to centralize print server and network printer management tasks.', defaultChildren: ['Print-Server'], mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-Print-Services'] }],
    ['RemoteAccess', 'Remote Access', [
      ['DirectAccess-VPN', 'DirectAccess and VPN (RAS)'],
      ['Routing', 'Routing'],
      ['Web-Application-Proxy', 'Web Application Proxy']
    ], { desc: 'Remote Access provides seamless connectivity through DirectAccess, VPN, and Web Application Proxy.', services: ['RemoteAccess'], defaultChildren: ['DirectAccess-VPN'], mgmt: ['RSAT', 'RSAT-Role-Tools', 'RSAT-RemoteAccess'] }],
    ['Remote-Desktop-Services', 'Remote Desktop Services', [
      ['RDS-Connection-Broker', 'Remote Desktop Connection Broker'],
      ['RDS-Gateway', 'Remote Desktop Gateway'],
      ['RDS-Licensing', 'Remote Desktop Licensing'],
      ['RDS-RD-Server', 'Remote Desktop Session Host'],
      ['RDS-Virtualization', 'Remote Desktop Virtualization Host'],
      ['RDS-Web-Access', 'Remote Desktop Web Access']
    ], { desc: 'Remote Desktop Services enables users to access virtual desktops, session-based desktops, and RemoteApp programs. Use the Remote Desktop Services installation to configure a Virtual machine-based or a Session-based desktop deployment.' }],
    ['VolumeActivation', 'Volume Activation Services', null, { desc: 'Volume Activation Services enables you to automate and simplify the management of Key Management Service (KMS) host keys and the volume key activation infrastructure for a network.' }],
    ['Web-Server', 'Web Server (IIS)', [
      ['Web-WebServer', 'Web Server', [
        ['Web-Common-Http', 'Common HTTP Features', [
          ['Web-Default-Doc', 'Default Document'],
          ['Web-Dir-Browsing', 'Directory Browsing'],
          ['Web-Http-Errors', 'HTTP Errors'],
          ['Web-Static-Content', 'Static Content'],
          ['Web-Http-Redirect', 'HTTP Redirection'],
          ['Web-DAV-Publishing', 'WebDAV Publishing']
        ]],
        ['Web-Health', 'Health and Diagnostics', [
          ['Web-Http-Logging', 'HTTP Logging'],
          ['Web-Custom-Logging', 'Custom Logging'],
          ['Web-Log-Libraries', 'Logging Tools'],
          ['Web-Request-Monitor', 'Request Monitor'],
          ['Web-Http-Tracing', 'Tracing']
        ]],
        ['Web-Performance', 'Performance', [
          ['Web-Stat-Compression', 'Static Content Compression'],
          ['Web-Dyn-Compression', 'Dynamic Content Compression']
        ]],
        ['Web-Security', 'Security', [
          ['Web-Filtering', 'Request Filtering'],
          ['Web-Basic-Auth', 'Basic Authentication'],
          ['Web-CertProvider', 'Centralized SSL Certificate Support'],
          ['Web-Client-Auth', 'Client Certificate Mapping Authentication'],
          ['Web-Digest-Auth', 'Digest Authentication'],
          ['Web-IP-Security', 'IP and Domain Restrictions'],
          ['Web-Url-Auth', 'URL Authorization'],
          ['Web-Windows-Auth', 'Windows Authentication']
        ]],
        ['Web-App-Dev', 'Application Development', [
          ['Web-Net-Ext45', '.NET Extensibility 4.8'],
          ['Web-Asp-Net45', 'ASP.NET 4.8'],
          ['Web-ASP', 'ASP'],
          ['Web-CGI', 'CGI'],
          ['Web-ISAPI-Ext', 'ISAPI Extensions'],
          ['Web-ISAPI-Filter', 'ISAPI Filters'],
          ['Web-WebSockets', 'WebSocket Protocol']
        ]]
      ]],
      ['Web-Ftp-Server', 'FTP Server', [
        ['Web-Ftp-Service', 'FTP Service'],
        ['Web-Ftp-Ext', 'FTP Extensibility']
      ]],
      ['Web-Mgmt-Tools', 'Management Tools', [
        ['Web-Mgmt-Console', 'IIS Management Console'],
        ['Web-Scripting-Tools', 'IIS Management Scripts and Tools'],
        ['Web-Mgmt-Service', 'Management Service']
      ]]
    ], {
      desc: 'Web Server (IIS) provides a reliable, manageable, and scalable Web application infrastructure.',
      defaultChildren: ['Web-WebServer', 'Web-Common-Http', 'Web-Default-Doc', 'Web-Dir-Browsing', 'Web-Http-Errors', 'Web-Static-Content', 'Web-Health', 'Web-Http-Logging', 'Web-Performance', 'Web-Stat-Compression', 'Web-Security', 'Web-Filtering', 'Web-Mgmt-Tools', 'Web-Mgmt-Console'],
      services: ['W3SVC', 'WAS']
    }],
    ['WDS', 'Windows Deployment Services', [
      ['WDS-Deployment', 'Deployment Server'],
      ['WDS-Transport', 'Transport Server']
    ], { desc: 'Windows Deployment Services provides a simplified, secure means of rapidly and remotely deploying Windows operating systems to computers over the network.', defaultChildren: ['WDS-Deployment', 'WDS-Transport'], services: ['WDSServer'] }],
    ['UpdateServices', 'Windows Server Update Services', [
      ['UpdateServices-WidDB', 'WID Connectivity'],
      ['UpdateServices-Services', 'WSUS Services'],
      ['UpdateServices-DB', 'SQL Server Connectivity']
    ], { desc: 'Windows Server Update Services allows network administrators to specify the Microsoft updates that should be installed, create separate groups of computers for different sets of updates, and get reports on the compliance levels of the computers and the updates that must be installed.', defaultChildren: ['UpdateServices-WidDB', 'UpdateServices-Services'], services: ['WsusService'], postConfig: 'wsus' }]
  ];

  const FEATURES = [
    ['NET-Framework-Features', '.NET Framework 3.5 Features', [
      ['NET-Framework-Core', '.NET Framework 3.5 (includes .NET 2.0 and 3.0)'],
      ['NET-HTTP-Activation', 'HTTP Activation'],
      ['NET-Non-HTTP-Activ', 'Non-HTTP Activation']
    ], { desc: '.NET Framework 3.5 combines the power of the .NET Framework 2.0 APIs with new technologies for building applications that offer appealing user interfaces, protect your customers’ personal identity information, enable seamless and secure communication, and provide the ability to model a range of business processes.' }],
    ['NET-Framework-45-Features', '.NET Framework 4.8 Features', [
      ['NET-Framework-45-Core', '.NET Framework 4.8', null, { installed: true }],
      ['NET-Framework-45-ASPNET', 'ASP.NET 4.8'],
      ['NET-WCF-Services45', 'WCF Services', [
        ['NET-WCF-HTTP-Activation45', 'HTTP Activation'],
        ['NET-WCF-MSMQ-Activation45', 'Message Queuing (MSMQ) Activation'],
        ['NET-WCF-Pipe-Activation45', 'Named Pipe Activation'],
        ['NET-WCF-TCP-Activation45', 'TCP Activation'],
        ['NET-WCF-TCP-PortSharing45', 'TCP Port Sharing', null, { installed: true }]
      ], { installed: true }]
    ], { installed: true, desc: '.NET Framework 4.8 provides a comprehensive and consistent programming model for quickly and easily building and running applications that are built for various platforms including desktop PCs, Servers, smart phones and the public and private cloud.' }],
    ['BITS', 'Background Intelligent Transfer Service (BITS)', null, { desc: 'Background Intelligent Transfer Service (BITS) asynchronously transfers files in the foreground or background, controls the flow of the transfers to preserve the responsiveness of other network applications, and automatically resumes file transfers after disconnecting from the network or restarting the computer.' }],
    ['BitLocker', 'BitLocker Drive Encryption', null, { desc: 'BitLocker Drive Encryption helps to protect data on lost, stolen, or inappropriately decommissioned computers by encrypting the entire volume and checking the integrity of early boot components.', reboot: true, mgmt: ['RSAT', 'RSAT-Feature-Tools', 'RSAT-Feature-Tools-BitLocker'] }],
    ['BitLocker-NetworkUnlock', 'BitLocker Network Unlock'],
    ['BranchCache', 'BranchCache', null, { desc: 'BranchCache installs the services required to configure this computer as either a hosted cache server or a BranchCache-enabled server.' }],
    ['NFS-Client', 'Client for NFS', null, { desc: 'Client for NFS enables this computer to access files on UNIX-based NFS servers.' }],
    ['Containers', 'Containers', null, { desc: 'Provides services and tools to create and manage Windows Server Containers and their resources.', reboot: true }],
    ['Data-Center-Bridging', 'Data Center Bridging', null, { desc: 'Data Center Bridging (DCB) is a suite of IEEE standards that are used to enhance Ethernet local area networks by providing hardware-based bandwidth guarantees and transport reliability.' }],
    ['Direct-Play', 'Direct Play'],
    ['EnhancedStorage', 'Enhanced Storage'],
    ['Failover-Clustering', 'Failover Clustering', null, { desc: 'Failover Clustering allows multiple servers to work together to provide high availability of server roles. Failover Clustering is often used for File Services, virtual machines, database applications, and mail applications.', mgmt: ['RSAT', 'RSAT-Feature-Tools', 'RSAT-Clustering', 'RSAT-Clustering-Mgmt', 'RSAT-Clustering-PowerShell'], services: ['ClusSvc'] }],
    ['GPMC', 'Group Policy Management', null, { desc: 'Group Policy Management is a scriptable Microsoft Management Console (MMC) snap-in, providing a single administrative tool for managing Group Policy across the enterprise. Group Policy Management is the standard tool for managing Group Policy.' }],
    ['HostGuardian', 'Host Guardian Hyper-V Support'],
    ['DiskIo-QoS', 'I/O Quality of Service'],
    ['Web-WHC', 'IIS Hostable Web Core'],
    ['Internet-Print-Client', 'Internet Printing Client'],
    ['IPAM', 'IP Address Management (IPAM) Server', null, { desc: 'IP Address Management (IPAM) Server provides a central framework for managing your IP address space and corresponding infrastructure servers such as DHCP and DNS.' }],
    ['LPR-Port-Monitor', 'LPR Port Monitor'],
    ['ManagementOdata', 'Management OData IIS Extension'],
    ['Server-Media-Foundation', 'Media Foundation'],
    ['MSMQ', 'Message Queuing'],
    ['Windows-Defender', 'Microsoft Defender Antivirus', null, { installed: true, desc: 'Microsoft Defender Antivirus helps protect your machine from malware.' }],
    ['Multipath-IO', 'Multipath I/O', null, { desc: 'Multipath I/O, along with the Microsoft Device Specific Module (DSM) or a third-party DSM, provides support for using multiple data paths to a storage device on Windows.' }],
    ['NLB', 'Network Load Balancing', null, { desc: 'Network Load Balancing (NLB) distributes traffic across several servers, using the TCP/IP networking protocol.', mgmt: ['RSAT', 'RSAT-Feature-Tools', 'RSAT-NLB'] }],
    ['PNRP', 'Peer Name Resolution Protocol'],
    ['qWave', 'Quality Windows Audio Video Experience'],
    ['CMAK', 'RAS Connection Manager Administration Kit (CMAK)'],
    ['Remote-Assistance', 'Remote Assistance'],
    ['RDC', 'Remote Differential Compression'],
    ['RSAT', 'Remote Server Administration Tools', [
      ['RSAT-Feature-Tools', 'Feature Administration Tools', [
        ['RSAT-Feature-Tools-BitLocker', 'BitLocker Drive Encryption Administration Utilities'],
        ['RSAT-Clustering', 'Failover Clustering Tools', [
          ['RSAT-Clustering-Mgmt', 'Failover Cluster Management Tools'],
          ['RSAT-Clustering-PowerShell', 'Failover Cluster Module for Windows PowerShell']
        ]],
        ['RSAT-NLB', 'Network Load Balancing Tools'],
        ['RSAT-SNMP', 'SNMP Tools'],
        ['RSAT-Storage-Replica', 'Storage Replica Module for Windows PowerShell']
      ]],
      ['RSAT-Role-Tools', 'Role Administration Tools', [
        ['RSAT-AD-Tools', 'AD DS and AD LDS Tools', [
          ['RSAT-AD-PowerShell', 'Active Directory module for Windows PowerShell'],
          ['RSAT-ADDS', 'AD DS Tools', [
            ['RSAT-AD-AdminCenter', 'Active Directory Administrative Center'],
            ['RSAT-ADDS-Tools', 'AD DS Snap-Ins and Command-Line Tools']
          ]],
          ['RSAT-ADLDS', 'AD LDS Snap-Ins and Command-Line Tools']
        ]],
        ['RSAT-Hyper-V-Tools', 'Hyper-V Management Tools', [
          ['Hyper-V-Tools', 'Hyper-V GUI Management Tools'],
          ['Hyper-V-PowerShell', 'Hyper-V Module for Windows PowerShell']
        ]],
        ['RSAT-RDS-Tools', 'Remote Desktop Services Tools'],
        ['RSAT-ADCS', 'Active Directory Certificate Services Tools', [
          ['RSAT-ADCS-Mgmt', 'Certification Authority Management Tools']
        ]],
        ['RSAT-DHCP', 'DHCP Server Tools'],
        ['RSAT-DNS-Server', 'DNS Server Tools'],
        ['RSAT-File-Services', 'File Services Tools', [
          ['RSAT-DFS-Mgmt-Con', 'DFS Management Tools'],
          ['RSAT-FSRM-Mgmt', 'File Server Resource Manager Tools'],
          ['RSAT-NFS-Admin', 'Services for Network File System Management Tools']
        ]],
        ['RSAT-NPAS', 'Network Policy and Access Services Tools'],
        ['RSAT-Print-Services', 'Print and Document Services Tools'],
        ['RSAT-RemoteAccess', 'Remote Access Management Tools']
      ]]
    ], { desc: 'Remote Server Administration Tools includes snap-ins and command-line tools for remotely managing roles and features.' }],
    ['RPC-over-HTTP-Proxy', 'RPC over HTTP Proxy'],
    ['Setup-and-Boot-Event-Collection', 'Setup and Boot Event Collection'],
    ['Simple-TCPIP', 'Simple TCP/IP Services'],
    ['FS-SMB1', 'SMB 1.0/CIFS File Sharing Support', null, { desc: 'Support for the SMB 1.0/CIFS file sharing protocol, and the Computer Browser protocol. SMB 1.0 is deprecated and insecure; leave it uninstalled unless a legacy device requires it.', reboot: true }],
    ['FS-SMBBW', 'SMB Bandwidth Limit'],
    ['SNMP-Service', 'SNMP Service', null, { desc: 'Simple Network Management Protocol (SNMP) Service includes agents that monitor the activity in network devices and report to the network console workstation.' }],
    ['SoftwareLoadBalancer', 'Software Load Balancer'],
    ['SMS', 'Storage Migration Service'],
    ['SMS-Proxy', 'Storage Migration Service Proxy'],
    ['Storage-Replica', 'Storage Replica', null, { desc: 'Storage Replica (SR) enables block-level, synchronous replication of storage between servers for disaster recovery.', reboot: true }],
    ['System-DataArchiver', 'System Data Archiver', null, { installed: true }],
    ['System-Insights', 'System Insights', null, { desc: 'System Insights gives you increased insight into the functioning of your servers by using local predictive analytics.' }],
    ['Telnet-Client', 'Telnet Client', null, { desc: 'Telnet Client uses the Telnet protocol to connect to a remote Telnet server and run applications on that server.' }],
    ['TFTP-Client', 'TFTP Client'],
    ['WebDAV-Redirector', 'WebDAV Redirector'],
    ['Biometric-Framework', 'Windows Biometric Framework'],
    ['Windows-Identity-Foundation', 'Windows Identity Foundation 3.5'],
    ['Windows-Internal-Database', 'Windows Internal Database'],
    ['PowerShellRoot', 'Windows PowerShell', [
      ['PowerShell', 'Windows PowerShell 5.1', null, { installed: true }],
      ['PowerShell-ISE', 'Windows PowerShell ISE', null, { installed: true }],
      ['DSC-Service', 'Windows PowerShell Desired State Configuration Service'],
      ['WindowsPowerShellWebAccess', 'Windows PowerShell Web Access']
    ], { installed: true, desc: 'Windows PowerShell enables you to automate local and remote Windows administration. This task-based command-line shell and scripting language is built on the Microsoft .NET Framework.' }],
    ['WAS', 'Windows Process Activation Service', [
      ['WAS-Process-Model', 'Process Model'],
      ['WAS-Config-APIs', 'Configuration APIs']
    ]],
    ['Search-Service', 'Windows Search Service'],
    ['Windows-Server-Backup', 'Windows Server Backup', null, { desc: 'Windows Server Backup allows you to back up and recover your operating system, applications and data. You can schedule backups, and protect the entire server or specific volumes.', services: ['wbengine'] }],
    ['Migration', 'Windows Server Migration Tools'],
    ['WindowsStorageManagementService', 'Windows Standards-Based Storage Management'],
    ['Microsoft-Windows-Subsystem-Linux', 'Windows Subsystem for Linux', null, { reboot: true, desc: 'Provides services and environments for running native user-mode Linux shells and tools on Windows.' }],
    ['Windows-TIFF-IFilter', 'Windows TIFF IFilter'],
    ['WinRM-IIS-Ext', 'WinRM IIS Extension'],
    ['WINS', 'WINS Server'],
    ['Wireless-Networking', 'Wireless LAN Service'],
    ['WoW64-Support', 'WoW64 Support', null, { installed: true }],
    ['XPS-Viewer', 'XPS Viewer', null, { installed: true }]
  ];

  const byId = {};
  const roots = { role: [], feature: [] };

  function build(list, kind, parent, depth) {
    const out = [];
    for (const [id, name, children, opts] of list) {
      const o = opts || {};
      const node = {
        id, name, kind, // kind: role | feature  (which wizard page it is shown on)
        type: kind === 'role' ? (depth === 0 ? 'Role' : 'Role Service') : 'Feature',
        parent: parent ? parent.id : null,
        depth,
        desc: o.desc || (parent ? `${name} is a component of ${parent.name}.` : `${name}.`),
        defaultInstalled: !!o.installed,
        mgmt: o.mgmt || [],
        reboot: !!o.reboot,
        services: o.services || [],
        postConfig: o.postConfig || null,
        staticIp: !!o.staticIp,
        defaultChildren: o.defaultChildren || null,
        children: []
      };
      byId[id] = node;
      if (children) node.children = build(children, kind, node, depth + 1);
      out.push(node);
    }
    return out;
  }
  roots.role = build(ROLES, 'role', null, 0);
  roots.feature = build(FEATURES, 'feature', null, 0);

  /* ------------------------------------------------------------------ services
   * [name, display, startup, status, logon, description, featureId|null]
   * featureId: service only exists once that feature (or the promotion) adds it. */
  const LS = 'Local System', LSV = 'Local Service', NS = 'Network Service';
  const SERVICES = [
    ['ADWS', 'Active Directory Web Services', 'Automatic', 'Running', LS, 'This service provides a Web Service interface to instances of the directory service (AD DS and AD LDS) that are running locally on this server.', '#dc'],
    ['AppIDSvc', 'Application Identity', 'Manual (Trigger Start)', 'Stopped', LSV, 'Determines and verifies the identity of an application. Disabling this service will prevent AppLocker from being enforced.'],
    ['Appinfo', 'Application Information', 'Manual (Trigger Start)', 'Running', LS, 'Facilitates the running of interactive applications with additional administrative privileges.'],
    ['AppMgmt', 'Application Management', 'Manual', 'Stopped', LS, 'Processes installation, removal, and enumeration requests for software deployed through Group Policy.'],
    ['AudioEndpointBuilder', 'Windows Audio Endpoint Builder', 'Manual', 'Stopped', LS, 'Manages audio devices for the Windows Audio service.'],
    ['Audiosrv', 'Windows Audio', 'Manual', 'Stopped', LSV, 'Manages audio for Windows-based programs.'],
    ['BFE', 'Base Filtering Engine', 'Automatic', 'Running', LSV, 'The Base Filtering Engine (BFE) is a service that manages firewall and Internet Protocol security (IPsec) policies and implements user mode filtering.'],
    ['BITS', 'Background Intelligent Transfer Service', 'Manual', 'Stopped', LS, 'Transfers files in the background using idle network bandwidth.'],
    ['BrokerInfrastructure', 'Background Tasks Infrastructure Service', 'Automatic', 'Running', LS, 'Windows infrastructure service that controls which background tasks can run on the system.'],
    ['CertPropSvc', 'Certificate Propagation', 'Manual (Trigger Start)', 'Running', LS, 'Copies user certificates and root certificates from smart cards into the current user’s certificate store.'],
    ['CertSvc', 'Active Directory Certificate Services', 'Automatic', 'Running', LS, 'Creates, manages, and removes X.509 certificates for applications such as S/MIME and SSL.', 'AD-Certificate'],
    ['ClusSvc', 'Cluster Service', 'Disabled', 'Stopped', LS, 'Enables servers to work together as a cluster to keep server-based applications highly available.', 'Failover-Clustering'],
    ['COMSysApp', 'COM+ System Application', 'Manual', 'Running', LS, 'Manages the configuration and tracking of Component Object Model (COM)+-based components.'],
    ['CryptSvc', 'Cryptographic Services', 'Automatic', 'Running', NS, 'Provides Catalog Database Service, Protected Root Service, Automatic Root Certificate Update Service and Key Service.'],
    ['DcomLaunch', 'DCOM Server Process Launcher', 'Automatic', 'Running', LS, 'The DCOMLAUNCH service launches COM and DCOM servers in response to object activation requests.'],
    ['Dfs', 'DFS Namespace', 'Automatic', 'Running', LS, 'Enables you to group shared folders located on different servers into one or more logically structured namespaces.', 'FS-DFS-Namespace'],
    ['DFSR', 'DFS Replication', 'Automatic', 'Running', LS, 'Enables you to synchronize folders on multiple servers across local or wide area network (WAN) network connections.', 'FS-DFS-Replication'],
    ['Dhcp', 'DHCP Client', 'Automatic', 'Running', LSV, 'Registers and updates IP addresses and DNS records for this computer.'],
    ['DHCPServer', 'DHCP Server', 'Automatic', 'Running', NS, 'Performs TCP/IP configuration for DHCP clients, including dynamic assignments of IP addresses, specification of the WINS and DNS servers, and connection-specific Domain Name System (DNS) names.', 'DHCP'],
    ['DiagTrack', 'Connected User Experiences and Telemetry', 'Automatic', 'Running', LS, 'The Connected User Experiences and Telemetry service enables features that support in-application and connected user experiences.'],
    ['DNS', 'DNS Server', 'Automatic', 'Running', LS, 'Enables DNS clients to resolve DNS names by answering DNS queries and dynamic DNS update requests.', 'DNS'],
    ['Dnscache', 'DNS Client', 'Automatic (Trigger Start)', 'Running', NS, 'The DNS Client service (dnscache) caches Domain Name System (DNS) names and registers the full computer name for this computer.'],
    ['DPS', 'Diagnostic Policy Service', 'Automatic (Delayed Start)', 'Running', LSV, 'The Diagnostic Policy Service enables problem detection, troubleshooting and resolution for Windows components.'],
    ['edgeupdate', 'Microsoft Edge Update Service (edgeupdate)', 'Automatic (Delayed Start)', 'Stopped', LS, 'Keeps your Microsoft software up to date.'],
    ['EventLog', 'Windows Event Log', 'Automatic', 'Running', LSV, 'This service manages events and event logs. It supports logging events, querying events, subscribing to events, archiving event logs, and managing event metadata.'],
    ['EventSystem', 'COM+ Event System', 'Automatic', 'Running', LSV, 'Supports System Event Notification Service (SENS), which provides automatic distribution of events to subscribing Component Object Model (COM) components.'],
    ['FontCache', 'Windows Font Cache Service', 'Automatic', 'Running', LSV, 'Optimizes performance of applications by caching commonly used font data.'],
    ['gpsvc', 'Group Policy Client', 'Automatic (Trigger Start)', 'Running', LS, 'The service is responsible for applying settings configured by administrators for the computer and users through the Group Policy component.'],
    ['IAS', 'Network Policy Server', 'Automatic', 'Running', NS, 'Network Policy Server manages authentication, authorization, auditing and accounting for virtual private network (VPN), 802.1X wireless and wired switch, and dial-up connections.', 'NPAS'],
    ['iphlpsvc', 'IP Helper', 'Automatic', 'Running', LS, 'Provides tunnel connectivity using IPv6 transition technologies (6to4, ISATAP, Port Proxy, and Teredo), and IP-HTTPS.'],
    ['IsmServ', 'Intersite Messaging', 'Automatic', 'Running', LS, 'Enables messages to be exchanged between computers running Windows Server sites.', '#dc'],
    ['Kdc', 'Kerberos Key Distribution Center', 'Automatic', 'Running', LS, 'On domain controllers, this service enables users to log on to the network using the Kerberos authentication protocol.', '#dc'],
    ['KeyIso', 'CNG Key Isolation', 'Manual (Trigger Start)', 'Running', LS, 'The CNG key isolation service is hosted in the LSA process.'],
    ['LanmanServer', 'Server', 'Automatic (Trigger Start)', 'Running', LS, 'Supports file, print, and named-pipe sharing over the network for this computer.'],
    ['LanmanWorkstation', 'Workstation', 'Automatic', 'Running', NS, 'Creates and maintains client network connections to remote servers using the SMB protocol.'],
    ['lmhosts', 'TCP/IP NetBIOS Helper', 'Manual (Trigger Start)', 'Running', LSV, 'Provides support for the NetBIOS over TCP/IP (NetBT) service and NetBIOS name resolution for clients on the network.'],
    ['LSM', 'Local Session Manager', 'Automatic', 'Running', LS, 'Core Windows Service that manages local user sessions.'],
    ['mpssvc', 'Windows Defender Firewall', 'Automatic', 'Running', LSV, 'Windows Defender Firewall helps protect your computer by preventing unauthorized users from gaining access to your computer through the Internet or a network.'],
    ['MSDTC', 'Distributed Transaction Coordinator', 'Automatic (Delayed Start)', 'Running', NS, 'Coordinates transactions that span multiple resource managers, such as databases, message queues, and file systems.'],
    ['MSiSCSI', 'Microsoft iSCSI Initiator Service', 'Manual', 'Stopped', LS, 'Manages Internet SCSI (iSCSI) sessions from this computer to remote iSCSI target devices.'],
    ['msiserver', 'Windows Installer', 'Manual', 'Stopped', LS, 'Adds, modifies, and removes applications provided as a Windows Installer (*.msi, *.msp) package.'],
    ['Netlogon', 'Netlogon', 'Manual', 'Stopped', LS, 'Maintains a secure channel between this computer and the domain controller for authenticating users and services.'],
    ['netprofm', 'Network List Service', 'Manual', 'Running', LSV, 'Identifies the networks to which the computer has connected, collects and stores properties for these networks.'],
    ['NlaSvc', 'Network Location Awareness', 'Automatic', 'Running', NS, 'Collects and stores configuration information for the network and notifies programs when this information is modified.'],
    ['nsi', 'Network Store Interface Service', 'Automatic', 'Running', LSV, 'This service delivers network notifications (e.g. interface addition/deleting etc) to user mode clients.'],
    ['NTDS', 'Active Directory Domain Services', 'Automatic', 'Running', LS, 'AD DS Domain Controller service. If this service is stopped, users will be unable to log on to the network.', '#dc'],
    ['PlugPlay', 'Plug and Play', 'Manual', 'Running', LS, 'Enables a computer to recognize and adapt to hardware changes with little or no user input.'],
    ['PolicyAgent', 'IPsec Policy Agent', 'Manual (Trigger Start)', 'Running', NS, 'Internet Protocol security (IPsec) supports network-level peer authentication, data origin authentication, data integrity, data confidentiality (encryption), and replay protection.'],
    ['Power', 'Power', 'Automatic', 'Running', LS, 'Manages power policy and power policy notification delivery.'],
    ['ProfSvc', 'User Profile Service', 'Automatic', 'Running', LS, 'This service is responsible for loading and unloading user profiles.'],
    ['RemoteAccess', 'Routing and Remote Access', 'Disabled', 'Stopped', LS, 'Offers routing services to businesses in local area and wide area network environments.', 'RemoteAccess'],
    ['RemoteRegistry', 'Remote Registry', 'Automatic (Trigger Start)', 'Stopped', LSV, 'Enables remote users to modify registry settings on this computer.'],
    ['RpcEptMapper', 'RPC Endpoint Mapper', 'Automatic', 'Running', NS, 'Resolves RPC interfaces identifiers to transport endpoints.'],
    ['RpcSs', 'Remote Procedure Call (RPC)', 'Automatic', 'Running', NS, 'The RPCSS service is the Service Control Manager for COM and DCOM servers.'],
    ['SamSs', 'Security Accounts Manager', 'Automatic', 'Running', LS, 'The startup of this service signals other services that the Security Accounts Manager (SAM) is ready to accept requests.'],
    ['Schedule', 'Task Scheduler', 'Automatic', 'Running', LS, 'Enables a user to configure and schedule automated tasks on this computer.'],
    ['seclogon', 'Secondary Logon', 'Manual', 'Stopped', LS, 'Enables starting processes under alternate credentials.'],
    ['SENS', 'System Event Notification Service', 'Automatic', 'Running', LS, 'Monitors system events and notifies subscribers to COM+ Event System of these events.'],
    ['SessionEnv', 'Remote Desktop Configuration', 'Manual', 'Stopped', LS, 'Remote Desktop Configuration service (RDCS) is responsible for all Remote Desktop Services and Remote Desktop related configuration and session maintenance activities.'],
    ['ShellHWDetection', 'Shell Hardware Detection', 'Automatic', 'Running', LS, 'Provides notifications for AutoPlay hardware events.'],
    ['Spooler', 'Print Spooler', 'Automatic', 'Running', LS, 'This service spools print jobs and handles interaction with the printer. If you turn off this service, you won’t be able to print or see your printers.'],
    ['sppsvc', 'Software Protection', 'Automatic (Delayed Start)', 'Stopped', NS, 'Enables the download, installation and enforcement of digital licenses for Windows and Windows applications.'],
    ['SrmSvc', 'File Server Resource Manager', 'Automatic', 'Running', LS, 'Monitors the amount of space used by folders, controls file creation, classifies files, and manages file storage reports.', 'FS-Resource-Manager'],
    ['ssh-agent', 'OpenSSH Authentication Agent', 'Disabled', 'Stopped', LS, 'Agent to hold private keys used for public key authentication.'],
    ['sshd', 'OpenSSH SSH Server', 'Manual', 'Stopped', LS, 'SSH protocol based service to provide secure encrypted communications between two untrusted hosts over an insecure network.'],
    ['SstpSvc', 'Secure Socket Tunneling Protocol Service', 'Manual', 'Running', LSV, 'Provides support for the Secure Socket Tunneling Protocol (SSTP) to connect to remote computers using VPN.'],
    ['swprv', 'Microsoft Software Shadow Copy Provider', 'Manual', 'Stopped', LS, 'Manages software-based volume shadow copies taken by the Volume Shadow Copy service.'],
    ['TapiSrv', 'Telephony', 'Manual', 'Stopped', NS, 'Provides Telephony API (TAPI) support for programs that control telephony devices on the local computer.'],
    ['TermService', 'Remote Desktop Services', 'Manual', 'Stopped', NS, 'Allows users to connect interactively to a remote computer. Remote Desktop and Remote Desktop Session Host Server depend on this service.'],
    ['Themes', 'Themes', 'Automatic', 'Running', LS, 'Provides user experience theme management.'],
    ['TrkWks', 'Distributed Link Tracking Client', 'Automatic', 'Running', LS, 'Maintains links between NTFS files within a computer or across computers in a network.'],
    ['UmRdpService', 'Remote Desktop Services UserMode Port Redirector', 'Manual', 'Stopped', LS, 'Allows the redirection of Printers/Drives/Ports for RDP connections.'],
    ['UsoSvc', 'Update Orchestrator Service', 'Automatic (Delayed Start)', 'Running', LS, 'Manages Windows Updates. If stopped, your devices will not be able to download and install the latest updates.'],
    ['VaultSvc', 'Credential Manager', 'Manual', 'Running', LS, 'Provides secure storage and retrieval of credentials to users, applications and security service packages.'],
    ['vmcompute', 'Hyper-V Host Compute Service', 'Manual (Trigger Start)', 'Running', LS, 'Provides support for running Windows Containers and Virtual Machines.', 'Hyper-V'],
    ['vmicheartbeat', 'Hyper-V Heartbeat Service', 'Manual (Trigger Start)', 'Running', LS, 'Monitors the state of this virtual machine by reporting a heartbeat at regular intervals.'],
    ['vmictimesync', 'Hyper-V Time Synchronization Service', 'Manual (Trigger Start)', 'Running', LSV, 'Synchronizes the system time of this virtual machine with the system time of the physical computer.'],
    ['vmms', 'Hyper-V Virtual Machine Management', 'Automatic', 'Running', LS, 'Management service for Hyper-V, provides service to run multiple virtual machines.', 'Hyper-V'],
    ['VSS', 'Volume Shadow Copy', 'Manual', 'Stopped', LS, 'Manages and implements Volume Shadow Copies used for backup and other purposes.'],
    ['W32Time', 'Windows Time', 'Manual (Trigger Start)', 'Running', LSV, 'Maintains date and time synchronization on all clients and servers in the network.'],
    ['W3SVC', 'World Wide Web Publishing Service', 'Automatic', 'Running', LS, 'Provides Web connectivity and administration through the Internet Information Services Manager.', 'Web-Server'],
    ['WAS', 'Windows Process Activation Service', 'Manual', 'Running', LS, 'The Windows Process Activation Service (WAS) provides process activation, resource management and health management services for message-activated applications.', 'Web-Server'],
    ['wbengine', 'Block Level Backup Engine Service', 'Manual', 'Stopped', LS, 'The WBENGINE service is used by Windows Backup to perform backup and recovery operations.', 'Windows-Server-Backup'],
    ['Wcmsvc', 'Windows Connection Manager', 'Automatic (Trigger Start)', 'Running', LSV, 'Makes automatic connect/disconnect decisions based on the network connectivity options currently available to the PC.'],
    ['WDSServer', 'Windows Deployment Services Server', 'Automatic', 'Stopped', LS, 'Provides services to deploy Windows operating systems to client computers.', 'WDS'],
    ['WdiServiceHost', 'Diagnostic Service Host', 'Manual', 'Running', LSV, 'The Diagnostic Service Host is used by the Diagnostic Policy Service to host diagnostics that need to run in a Local Service context.'],
    ['WinDefend', 'Microsoft Defender Antivirus Service', 'Automatic', 'Running', LS, 'Helps protect users from malware and other potentially unwanted software.'],
    ['WinHttpAutoProxySvc', 'WinHTTP Web Proxy Auto-Discovery Service', 'Manual', 'Running', LSV, 'WinHTTP implements the client HTTP stack and provides developers with a Win32 API and COM Automation component for sending HTTP requests and receiving responses.'],
    ['Winmgmt', 'Windows Management Instrumentation', 'Automatic', 'Running', LS, 'Provides a common interface and object model to access management information about operating system, devices, applications and services.'],
    ['WinRM', 'Windows Remote Management (WS-Management)', 'Automatic', 'Running', NS, 'Windows Remote Management (WinRM) service implements the WS-Management protocol for remote management.'],
    ['wmiApSrv', 'WMI Performance Adapter', 'Manual', 'Stopped', LS, 'Provides performance library information from Windows Management Instrumentation (WMI) providers to clients on the network.'],
    ['WsusService', 'WSUS Service', 'Automatic', 'Running', NS, 'Enables WSUS to synchronize updates and deploy them to client computers.', 'UpdateServices'],
    ['wuauserv', 'Windows Update', 'Manual (Trigger Start)', 'Stopped', LS, 'Enables the detection, download, and installation of updates for Windows and other programs.']
  ];

  /** Services that cannot be stopped from the console (as in real Windows). */
  const UNSTOPPABLE = new Set(['RpcSs', 'RpcEptMapper', 'DcomLaunch', 'PlugPlay', 'Power', 'LSM', 'BrokerInfrastructure', 'SamSs', 'gpsvc', 'WinDefend', 'mpssvc', 'BFE']);
  /** Service dependencies (stopping a service stops its dependents). */
  const DEPENDS = {
    Netlogon: ['LanmanWorkstation'], NTDS: ['RpcSs'], DNS: ['RpcSs', 'NTDS?'], DHCPServer: ['RpcSs'],
    W3SVC: ['WAS'], Kdc: ['NTDS?'], ADWS: ['NTDS?'], TermService: ['RpcSs'], UmRdpService: ['TermService']
  };

  WS.catalog = {
    features: { roots, byId, get: id => byId[id] || null, all: () => Object.values(byId) },
    services: SERVICES.map(([name, display, startup, status, logon, desc, feature]) => ({ name, display, startup, status, logon, desc, feature: feature || null })),
    unstoppable: UNSTOPPABLE,
    depends: DEPENDS
  };
})();
