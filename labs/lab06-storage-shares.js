/* Built-in lab: bring a new data disk into service and share a department folder. */
WS.labs.register({
  id: 'lab06-storage-shares',
  title: 'Lab 06: Disks, volumes and file shares',
  difficulty: 'Intermediate',
  minutes: 25,
  description: 'A new 40 GB virtual disk has been added to DC01 for the Sales department. Bring it into service with Disk Management, move the DVD drive out of the way, and share a Sales folder with the right share permissions.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      // The Lab 03 result: the Sales OU, its group and one member.
      const steps = [
        () => WS.ad.createOU({ name: 'Sales' }),
        () => WS.ad.createUser({ name: 'Jane Reed', givenName: 'Jane', sn: 'Reed', sam: 'jreed', parent: 'Sales', password: 'LabP@ssword2025!', enabled: true, mustChange: false }),
        () => WS.ad.createGroup({ name: 'Sales Staff', scope: 'Global', category: 'Security', parent: 'Sales' }),
        () => WS.ad.addMember('Sales Staff', 'jreed')
      ];
      for (const step of steps) { const r = step(); if (r && r.ok === false) throw new Error(r.error); }
    });
  },
  objectives: [
    {
      id: 'online',
      text: 'Bring Disk 1 online and initialize it with the GPT partition style.',
      hint: 'Computer Management > Storage > Disk Management (or diskmgmt.msc). Right-click Disk 1 > Online, then right-click it again > Initialize Disk > GPT. Or: Set-Disk 1 -IsOffline $false; Initialize-Disk 1 -PartitionStyle GPT. Or in diskpart: select disk 1, online disk, convert gpt',
      check: { disk: { number: 1, status: 'Online', style: 'GPT' } }
    },
    {
      id: 'dvd',
      text: 'Change the DVD drive\'s letter to R: so that the data volumes can use the letters after C:.',
      hint: 'Disk Management > right-click CD-ROM 0 > Change Drive Letter and Paths... > Change... > R. Or in diskpart: list volume, select volume 0 (the DVD-ROM), assign letter=R',
      check: { path: 'storage.cdrom.letter', equalsIgnoreCase: 'R' }
    },
    {
      id: 'volume',
      text: 'Create an NTFS volume that uses all of Disk 1, with drive letter E: and the label Data.',
      hint: 'Right-click the unallocated space on Disk 1 > New Simple Volume... Check the drive letter page: once the DVD drive has moved, the wizard suggests D:. Or: New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter E | Format-Volume -FileSystem NTFS -NewFileSystemLabel Data. Or in diskpart: select disk 1, create partition primary, format fs=ntfs label=Data quick, assign letter=E',
      check: { volume: { letter: 'E', label: 'Data', fs: 'NTFS', minSizeGB: 39 } }
    },
    {
      id: 'share',
      text: 'Share the folder E:\\Shares\\Sales as Sales. Sales Staff should have Change and Administrators Full Control share permissions; Everyone should have no share permission at all.',
      hint: 'Computer Management > Shared Folders > Shares > New Share... (the wizard can create the folder), then choose Customize permissions > Custom... Or: New-Item E:\\Shares\\Sales -ItemType Directory; New-SmbShare -Name Sales -Path E:\\Shares\\Sales -ChangeAccess "CONTOSO\\Sales Staff" -FullAccess Administrators',
      check: { all: [
        { share: { name: 'Sales', path: 'E:\\Shares\\Sales', access: [{ account: 'Sales Staff', right: 'Change' }, { account: 'Administrators', right: 'Full' }] } },
        { not: { share: { name: 'Sales', access: [{ account: 'Everyone' }] } } }
      ] }
    },
    {
      id: 'offline',
      text: 'Sales files must not be cached on laptops: set the Sales share so that no files or programs are available offline.',
      hint: 'Shares > Sales > Properties > Offline Settings... > No files or programs from the shared folder are available offline. Or: Set-SmbShare -Name Sales -CachingMode None -Force',
      check: { share: { name: 'Sales', cachingMode: 'None' } }
    }
  ]
});
