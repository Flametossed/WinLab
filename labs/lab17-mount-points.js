/* Built-in lab: drive letters and volume mount points (folder access paths), with Server Manager's Manage Drive Letter
 * and Access Paths and Volume Properties, Disk Management's Change Drive Letter and Paths, or the Storage cmdlets. */
WS.labs.register({
  id: 'lab17-mount-points',
  title: 'Lab 17: Drive letters and mount points',
  difficulty: 'Intermediate',
  minutes: 20,
  description: 'Finance wants its archive inside the existing share folder rather than on a new drive letter, and the web team wants its logs under C:\\Logs. Mount volumes in empty NTFS folders, tidy up the drive letters and access paths a technician left behind, and name a volume nobody can reach.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      const GB = WS.storage.GB;
      let logs = null;
      const steps = [
        // the Finance share folder, with an empty Archive folder waiting for the new disk
        () => WS.fs.ensureDir('C:\\Shares\\Finance\\Archive'),
        () => WS.fs.writeFile('C:\\Shares\\Finance\\Budget 2026.xlsx', 'Budget'),
        () => WS.smb.newShare({ name: 'Finance', path: 'C:\\Shares\\Finance', fullAccess: ['Administrators'], changeAccess: ['Authenticated Users'] }),
        // Disk 2: Logs (L:) with the web server's logs, and a second volume a technician created with no letter or path
        () => { const n = WS.storage.addDisk(20); WS.storage.setOnline(n, true); WS.storage.initialize(n, 'GPT'); return (logs = WS.storage.newVolume(n, { size: 10 * GB, letter: 'L', fs: 'NTFS', label: 'Logs' })); },
        () => WS.fs.ensureFile('L:\\W3SVC1\\u_ex260930.log', '#Software: Microsoft Internet Information Services 10.0'),
        () => WS.storage.newVolume(logs.volume.disk, { size: 'max', letter: null, fs: 'NTFS', label: 'New Volume' }),
        // ...and an old mount point of Logs under C:\Temp that nothing uses any more
        () => WS.fs.ensureDir('C:\\Temp\\LogsOld'),
        () => WS.storage.addAccessPath(logs.volume.disk, logs.volume.partition, 'C:\\Temp\\LogsOld')
      ];
      for (const step of steps) { const r = step(); if (r && r.ok === false) throw new Error(r.error); }
    });
  },
  objectives: [
    {
      id: 'archive',
      text: 'On Disk 1, create an NTFS volume labelled FinanceArchive that uses the whole disk. Mount it in the empty folder C:\\Shares\\Finance\\Archive, with no drive letter.',
      hint: 'Server Manager > File and Storage Services > Volumes > Disks: right-click Disk 1 > New Volume... (it brings the disk online and initializes it). On Drive Letter or Folder choose "The following folder" and browse to C:\\Shares\\Finance\\Archive. Or Disk Management: bring Disk 1 online, initialize it, then New Simple Volume > "Mount in the following empty NTFS folder". Or: Set-Disk 1 -IsOffline $false; Initialize-Disk 1 -PartitionStyle GPT; New-Partition -DiskNumber 1 -UseMaximumSize | Format-Volume -FileSystem NTFS -NewFileSystemLabel FinanceArchive; Add-PartitionAccessPath -DiskNumber 1 -PartitionNumber 2 -AccessPath C:\\Shares\\Finance\\Archive',
      check: { volume: { path: 'C:\\Shares\\Finance\\Archive', label: 'FinanceArchive', fs: 'NTFS', hasLetter: false, minSizeGB: 39 } }
    },
    {
      id: 'logs',
      text: 'The web team wants the Logs volume (L:) at C:\\Logs as well. Mount it there and keep its L: drive letter.',
      hint: 'A mount point must be an empty folder that already exists: create C:\\Logs first (File Explorer, md C:\\Logs, or the folder browser\'s Make New Folder). Then Volumes: right-click L: > Manage Drive Letter and Access Paths... > Add... and pick C:\\Logs. Or Disk Management: Change Drive Letter and Paths > Add... > Mount in the following empty NTFS folder. Or: New-Item C:\\Logs -ItemType Directory; Add-PartitionAccessPath -DriveLetter L -AccessPath C:\\Logs',
      check: { volume: { path: 'C:\\Logs', letter: 'L', label: 'Logs' } }
    },
    {
      id: 'stale',
      text: 'Remove the old access path C:\\Temp\\LogsOld from the Logs volume. The volume and its files must stay.',
      hint: 'Volumes: right-click L: > Manage Drive Letter and Access Paths..., select C:\\Temp\\LogsOld, Remove, OK. Or Disk Management > Change Drive Letter and Paths > select the path > Remove. Or: mountvol C:\\Temp\\LogsOld /D, or Remove-PartitionAccessPath -DriveLetter L -AccessPath C:\\Temp\\LogsOld',
      check: { all: [{ not: { volume: { path: 'C:\\Temp\\LogsOld' } } }, { volume: { letter: 'L', label: 'Logs' } }, { file: { path: 'L:\\W3SVC1\\u_ex260930.log' } }] }
    },
    {
      id: 'scratch',
      text: 'The other volume on Disk 2 has no drive letter or path, so nobody can reach it. Label it Scratch and give it drive letter S:.',
      hint: 'Volumes lists it by its \\\\?\\Volume{...}\\ path. Right-click it > Properties and type the label, then Manage Drive Letter and Access Paths... > Drive letter: S. Or: Get-Partition -DiskNumber 2 shows it as partition 3 with no DriveLetter; Set-Partition -DiskNumber 2 -PartitionNumber 3 -NewDriveLetter S; Set-Volume -DriveLetter S -NewFileSystemLabel Scratch',
      check: { volume: { letter: 'S', label: 'Scratch' } }
    }
  ]
});
