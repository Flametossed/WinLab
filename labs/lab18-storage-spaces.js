/* Built-in lab: Storage Spaces. A storage pool from four disks, a resilient mirror with a volume on it, a thin
 * virtual disk bigger than the pool, and a hot spare: Server Manager's Storage Pools page or the Storage cmdlets. */
WS.labs.register({
  id: 'lab18-storage-spaces',
  title: 'Lab 18: Storage Spaces',
  difficulty: 'Intermediate',
  minutes: 25,
  description: 'Four new 20 GB disks and a 30 GB disk have been added to DC01. Pool the 20 GB disks with Storage Spaces, give Finance a volume that survives a disk failure, make a large thin scratch disk, and keep the 30 GB disk ready as a hot spare.',
  setup: (s, WS) => {
    WS.labs.fixtures.domainController(s);
    WS.labs.withState(s, () => {
      // added to the VM after setup, so the SAN policy leaves them offline (Storage Spaces can still pool them)
      for (const gb of [20, 20, 20, 20, 30]) WS.storage.addDisk(gb);
    });
  },
  objectives: [
    {
      id: 'pool',
      text: 'Create a storage pool named DataPool from the four 20 GB disks.',
      hint: 'Server Manager > File and Storage Services > Volumes > Storage Pools: right-click Primordial > New Storage Pool..., name it DataPool and tick the four 20 GB disks. Or: New-StoragePool -FriendlyName DataPool -StorageSubSystemFriendlyName "Windows Storage*" -PhysicalDisks (Get-PhysicalDisk -CanPool $true | Where-Object Size -eq 20GB)',
      check: { storagePool: { name: 'DataPool', minDisks: 4 } }
    },
    {
      id: 'mirror',
      text: 'In DataPool, create a 20 GB virtual disk named Finance with a two-way mirror layout and fixed provisioning.',
      hint: 'Storage Pools: right-click DataPool > New Virtual Disk...: name Finance, layout Mirror, Two-way mirror, Fixed, size 20 GB. Or: New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Finance -ResiliencySettingName Mirror -NumberOfDataCopies 2 -ProvisioningType Fixed -Size 20GB',
      check: { virtualDisk: { name: 'Finance', pool: 'DataPool', layout: 'Mirror', copies: 2, provisioning: 'Fixed', minSizeGB: 19.9 } }
    },
    {
      id: 'volume',
      text: 'On the Finance virtual disk, create an NTFS volume F: labelled Finance that uses the whole disk.',
      hint: 'Leave "Create a volume when this wizard closes" ticked at the end of the New Virtual Disk Wizard, or right-click Finance in VIRTUAL DISKS > New Volume..., and choose F:, NTFS and the label. Or: Get-VirtualDisk Finance | Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru | New-Partition -DriveLetter F -UseMaximumSize | Format-Volume -FileSystem NTFS -NewFileSystemLabel Finance',
      check: { volume: { letter: 'F', label: 'Finance', fs: 'NTFS', virtualDisk: 'Finance', minSizeGB: 19.8 } }
    },
    {
      id: 'thin',
      text: 'Create a 100 GB virtual disk named Scratch in DataPool with the Simple layout. It is bigger than the pool, so it must be thin provisioned.',
      hint: 'New Virtual Disk...: name Scratch, layout Simple, provisioning Thin, size 100 GB (Fixed can\'t be larger than the free space). Or: New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Scratch -ResiliencySettingName Simple -ProvisioningType Thin -Size 100GB',
      check: { virtualDisk: { name: 'Scratch', pool: 'DataPool', layout: 'Simple', provisioning: 'Thin', minSizeGB: 99 } }
    },
    {
      id: 'spare',
      text: 'Add the 30 GB disk to DataPool as a hot spare.',
      hint: 'Storage Pools: right-click DataPool > Add Physical Disk..., tick the 30 GB disk and set its Allocation to Hot Spare. Or: Add-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk -CanPool $true | Where-Object Size -eq 30GB) -Usage HotSpare',
      check: { storagePool: { name: 'DataPool', hotSpares: 1 } }
    }
  ]
});
