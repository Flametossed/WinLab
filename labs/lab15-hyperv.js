/* Built-in lab: Hyper-V - the role, an external virtual switch, a generation 2 VM, installing Windows Server in it,
 * the guest on the lab network, a checkpoint, and automatic start/stop actions. */
WS.labs.register({
  id: 'lab15-hyperv',
  title: 'Lab 15: Hyper-V',
  difficulty: 'Intermediate',
  minutes: 45,
  description: 'HV01 will host Contoso\u2019s test servers. Install Hyper-V, give virtual machines access to the lab network, build SRV01 and install Windows Server 2025 in it from C:\\ISO\\WindowsServer2025.iso, then protect it with a checkpoint and make it start with the host.',
  setup: (s, WS) => {
    WS.labs.fixtures.configured(s);
    WS.labs.withState(s, () => {
      s.system.computerName = 'HV01';
      WS.hv.writeIso('C:\\ISO\\WindowsServer2025.iso');
      WS.fs.ensureDir('C:\\Hyper-V');
    });
  },
  objectives: [
    {
      id: 'role',
      text: 'Install the Hyper-V role with its management tools, and restart.',
      hint: 'Server Manager > Manage > Add Roles and Features > Hyper-V (the wizard can restart for you). Or: Install-WindowsFeature Hyper-V -IncludeManagementTools -Restart',
      check: { all: [{ feature: 'Hyper-V' }, { feature: 'Hyper-V-Tools' }, { feature: 'Hyper-V-PowerShell' }] }
    },
    {
      id: 'switch',
      text: 'Create an External virtual switch named "LAN" on the Ethernet adapter, shared with the management operating system.',
      hint: 'Hyper-V Manager > Virtual Switch Manager... > New virtual network switch > External > Create Virtual Switch, name it LAN, keep "Allow management operating system to share this network adapter". HV01\u2019s IP settings move to "vEthernet (LAN)". Or: New-VMSwitch -Name LAN -NetAdapterName Ethernet -AllowManagementOS $true',
      check: { vmSwitch: { name: 'LAN', type: 'External', adapter: 'Ethernet', allowManagementOS: true } }
    },
    {
      id: 'vm',
      text: 'Create a generation 2 VM named SRV01 stored in C:\\Hyper-V, with 1024 MB of startup memory and Dynamic Memory, connected to LAN, and a new dynamically expanding VHDX of at least 40 GB in C:\\Hyper-V.',
      hint: 'Hyper-V Manager > New > Virtual Machine... (Store the virtual machine in a different location: C:\\Hyper-V). Or: New-VM -Name SRV01 -Generation 2 -MemoryStartupBytes 1GB -Path C:\\Hyper-V -NewVHDPath C:\\Hyper-V\\SRV01\\SRV01.vhdx -NewVHDSizeBytes 40GB -SwitchName LAN; Set-VMMemory SRV01 -DynamicMemoryEnabled $true. The host has about 2 GB to spare, so bigger VMs will not start.',
      check: { vm: { name: 'SRV01', generation: 2, memoryStartupMB: 1024, dynamicMemory: true, switch: 'LAN', pathUnder: 'C:\\Hyper-V', disk: { type: 'Dynamic', format: 'VHDX', minSizeGB: 40, pathUnder: 'C:\\Hyper-V' } } }
    },
    {
      id: 'cpu',
      text: 'Give SRV01 two virtual processors (the VM must be off to change this).',
      hint: 'SRV01 > Settings... > Processor > Number of virtual processors: 2. Or: Set-VMProcessor SRV01 -Count 2',
      check: { vm: { name: 'SRV01', cpu: 2 } }
    },
    {
      id: 'install',
      text: 'Install Windows Server 2025 on SRV01 from C:\\ISO\\WindowsServer2025.iso.',
      hint: 'Attach the ISO (Settings > SCSI Controller > DVD Drive, or Add-VMDvdDrive -VMName SRV01 -Path C:\\ISO\\WindowsServer2025.iso) and put the DVD first in Firmware. Then Connect..., Start, and press a key at "Press any key to boot from CD or DVD..." straight away. If you miss it you get the boot summary: use Ctrl+Alt+Delete or Reset and try again.',
      check: { vm: { name: 'SRV01', osInstalled: true } }
    },
    {
      id: 'network',
      text: 'Finish the guest\u2019s setup (Administrator password) so SRV01 runs on the lab network with an address in 192.168.1.0/24.',
      hint: 'Customize settings in the VM\u2019s console sets the Administrator password. The guest gets its address by DHCP through the LAN switch. Get-VMNetworkAdapter SRV01 shows it.',
      check: { vm: { name: 'SRV01', state: 'Running', setupDone: true, ipInSubnet: '192.168.1.0/24' } }
    },
    {
      id: 'checkpoint',
      text: 'Take a checkpoint of SRV01 named "Clean install".',
      hint: 'Hyper-V Manager > SRV01 > Checkpoint, then rename it in the Checkpoints pane. Or: Checkpoint-VM -Name SRV01 -SnapshotName "Clean install"',
      check: { vm: { name: 'SRV01', checkpoint: 'Clean install' } }
    },
    {
      id: 'auto',
      text: 'SRV01 must always start when HV01 starts, and its guest must be shut down cleanly when HV01 shuts down.',
      hint: 'Settings > Automatic Start Action: Always start this virtual machine automatically; Automatic Stop Action: Shut down the guest operating system. Or: Set-VM SRV01 -AutomaticStartAction Start -AutomaticStopAction ShutDown',
      check: { vm: { name: 'SRV01', autoStart: 'Start', autoStop: 'ShutDown' } }
    }
  ]
});
