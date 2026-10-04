/* Built-in lab: an Engineering project share, built with Server Manager > File and Storage Services. */
WS.labs.register({
  id: 'lab12-file-server',
  title: 'Lab 12: File server with Server Manager',
  difficulty: 'Intermediate',
  minutes: 25,
  description: 'Engineering needs a project share on DC01. Use Server Manager > File and Storage Services to build it: a ReFS volume for large project files, a bigger archive volume, and a share that hides folders people cannot open and encrypts its traffic. Then close a share a technician left open.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      const GB = WS.storage.GB;
      const steps = [
        () => WS.ad.createOU({ name: 'Engineering' }),
        () => WS.ad.createGroup({ name: 'Engineering Staff', scope: 'Global', category: 'Security', parent: 'Engineering' }),
        // Disk 2: a 20 GB archive disk that a technician set up with only a 5 GB volume.
        () => { const n = WS.storage.addDisk(20); WS.storage.setOnline(n, true); WS.storage.initialize(n, 'GPT'); return WS.storage.newVolume(n, { size: 5 * GB, letter: 'V', fs: 'NTFS', label: 'Archive' }); },
        // ...and a share of C:\OldData, open to Everyone, that nobody uses any more.
        () => { WS.fs.ensureDir('C:\\OldData'); return WS.smb.newShare({ name: 'OldData', path: 'C:\\OldData', fullAccess: ['Everyone'] }); }
      ];
      for (const step of steps) { const r = step(); if (r && r.ok === false) throw new Error(r.error); }
    });
  },
  objectives: [
    {
      id: 'volume',
      text: 'On Disk 1, create a ReFS volume P: labelled Projects that uses the whole disk and 64 KB allocation units.',
      hint: 'Server Manager > File and Storage Services > Volumes > Disks: right-click Disk 1 > New Volume... The wizard brings the disk online and initializes it as GPT. Keep the offered size, choose P on Drive Letter or Folder, then ReFS, 64K and the label on File System Settings. Or: Set-Disk 1 -IsOffline $false; Initialize-Disk 1 -PartitionStyle GPT; New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter P | Format-Volume -FileSystem ReFS -AllocationUnitSize 65536 -NewFileSystemLabel Projects',
      check: { volume: { letter: 'P', label: 'Projects', fs: 'ReFS', au: 65536, minSizeGB: 39 } }
    },
    {
      id: 'archive',
      text: 'The Archive volume (V:) on Disk 2 is only 5 GB. Extend it to use all of Disk 2.',
      hint: 'File and Storage Services > Volumes: right-click V: > Extend Volume... and keep the maximum size it offers. Or: Resize-Partition -DriveLetter V -Size (Get-PartitionSupportedSize -DriveLetter V).SizeMax',
      check: { volume: { letter: 'V', label: 'Archive', minSizeGB: 19 } }
    },
    {
      id: 'share',
      text: 'Share P:\\Shares\\Engineering as Engineering. Engineering Staff should have Change and Administrators Full Control share permissions; Everyone should have none.',
      hint: 'Shares > TASKS > New Share... > SMB Share - Quick, select volume P:, share name Engineering (the wizard creates the folder). On Permissions click Customize permissions... > Share: remove Everyone, add Engineering Staff with Change and Administrators with Full Control. Or: New-Item P:\\Shares\\Engineering -ItemType Directory; New-SmbShare -Name Engineering -Path P:\\Shares\\Engineering -ChangeAccess "CONTOSO\\Engineering Staff" -FullAccess Administrators',
      check: { all: [
        { share: { name: 'Engineering', path: 'P:\\Shares\\Engineering', access: [{ account: 'Engineering Staff', right: 'Change' }, { account: 'Administrators', right: 'Full' }] } },
        { not: { share: { name: 'Engineering', access: [{ account: 'Everyone' }] } } }
      ] }
    },
    {
      id: 'abe',
      text: 'Turn on access-based enumeration for Engineering, so users see only the folders they can open.',
      hint: 'New Share Wizard > Other Settings > Enable access-based enumeration, or Shares > right-click Engineering > Properties > Settings. Or: Set-SmbShare -Name Engineering -FolderEnumerationMode AccessBased -Force',
      check: { share: { name: 'Engineering', folderEnumerationMode: 'AccessBased' } }
    },
    {
      id: 'encrypt',
      text: 'Require SMB encryption for everything sent to and from the Engineering share.',
      hint: 'Other Settings (or Properties > Settings) > Encrypt data access. Or: Set-SmbShare -Name Engineering -EncryptData $true -Force',
      check: { share: { name: 'Engineering', encryptData: true } }
    },
    {
      id: 'olddata',
      text: 'A technician left an OldData share open to Everyone. Stop sharing it, but keep the C:\\OldData folder.',
      hint: 'File and Storage Services > Shares: right-click OldData > Stop Sharing. Or: Remove-SmbShare -Name OldData -Force',
      check: { all: [{ not: { share: { name: 'OldData' } } }, { file: { path: 'C:\\OldData', type: 'dir' } }] }
    }
  ]
});
