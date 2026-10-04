/* Storage model: WS.storage. Disks, partitions and volumes for Disk Management, diskpart and the
 * Storage cmdlets (Get-Disk, Initialize-Disk, New-Partition, Format-Volume...). Disk 0 holds Windows;
 * Disk 1 is a blank 40 GB data disk that starts Offline (SAN policy), so students bring it online,
 * initialize it and create a volume - exactly as on a fresh Hyper-V VM with a second VHDX.
 * State: storage.disks[] = { number, model, size, style: 'RAW'|'GPT'|'MBR', online, readOnly, boot, partitions[] },
 *        partition = { number, type: 'System'|'Reserved'|'Basic'|'Recovery', offset, size, fs, letter, label, flags[], au?, compressed?, shortNames? },
 *        storage.cdrom = { letter, media }. Sizes are bytes.
 * Every lettered, formatted volume gets its administrative share (E$, "Default share") in WS.smb, as the Server service does. */
(function () {
  'use strict';
  const WS = window.WS;
  const MB = 1024 * 1024, GB = 1024 * MB;
  const OS_USED = 14.6 * GB; // what Windows itself takes on C:

  WS.store.init('storage', s => {
    const total = 127 * GB;
    const recovery = 742 * MB, esp = 100 * MB, msr = 16 * MB;
    const cSize = total - MB - esp - msr - recovery - MB;
    s.storage = {
      disks: [
        { number: 0, model: 'Msft Virtual Disk', serial: '', size: total, style: 'GPT', online: true, readOnly: false, boot: true, partitions: [
          { number: 1, type: 'System', offset: MB, size: esp, fs: 'FAT32', letter: null, label: '', flags: ['EFI System Partition'] },
          { number: 2, type: 'Reserved', offset: MB + esp, size: msr, fs: null, letter: null, label: '', flags: [] },
          { number: 3, type: 'Basic', offset: MB + esp + msr, size: cSize, fs: 'NTFS', letter: 'C', label: '', flags: ['Boot', 'Page File', 'Crash Dump', 'Basic Data Partition'] },
          { number: 4, type: 'Recovery', offset: MB + esp + msr + cSize, size: recovery, fs: 'NTFS', letter: null, label: '', flags: ['Recovery Partition'] }
        ] },
        { number: 1, model: 'Msft Virtual Disk', serial: '', size: 40 * GB, style: 'RAW', online: false, readOnly: false, boot: false, partitions: [] }
      ],
      cdrom: { letter: 'D', media: null }
    };
  });

  const S = () => WS.state.storage;
  const disk = n => S().disks.find(d => d.number === +n) || null;
  const noDisk = n => ({ ok: false, code: 'NotFound', error: `No MSFT_Disk objects found with property 'Number' equal to '${n}'. Verify the value of the property and retry.` });
  const usedLetters = () => new Set([...S().disks.flatMap(d => d.partitions.map(p => p.letter)).filter(Boolean), S().cdrom && S().cdrom.letter].filter(Boolean));
  const freeLetters = () => 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !usedLetters().has(l));
  /** Windows gives a new volume the first free letter (E: while the DVD drive holds D:, D: once it has moved). */
  const nextLetter = () => freeLetters()[0] || null;
  const changed = () => { syncAdminShares(); WS.store.changed('storage'); };

  /** The Server service shares the root of every fixed, formatted, lettered volume as <letter>$. */
  function syncAdminShares() {
    if (!WS.state.smb) return;
    const want = new Set(S().disks.filter(d => d.online).flatMap(d => d.partitions.filter(p => p.letter && p.fs).map(p => p.letter)));
    const shares = WS.state.smb.shares;
    let dirty = false;
    for (const s of shares.slice()) {
      const m = /^([A-Z])\$$/i.exec(s.name);
      if (m && s.special && !want.has(m[1].toUpperCase())) { shares.splice(shares.indexOf(s), 1); dirty = true; }
    }
    for (const l of want) if (!shares.some(s => s.name.toUpperCase() === l + '$')) { shares.push({ name: l + '$', path: l + ':\\', description: 'Default share', special: true, access: [] }); dirty = true; }
    if (dirty) WS.store.changed('smb');
  }

  /** GPT keeps 1 MB at each end for its headers; MBR keeps 1 MB at the start. */
  const usableEnd = d => d.size - (d.style === 'GPT' ? MB : 0);
  /** Unallocated extents of at least 1 MB, in disk order (what Disk Management draws as black "Unallocated" regions). */
  function freeRegions(d) {
    if (!d || d.style === 'RAW') return [];
    const out = [];
    let cur = MB;
    for (const p of d.partitions.slice().sort((a, b) => a.offset - b.offset)) {
      if (p.offset - cur >= MB) out.push({ offset: cur, size: p.offset - cur });
      cur = Math.max(cur, p.offset + p.size);
    }
    if (usableEnd(d) - cur >= MB) out.push({ offset: cur, size: usableEnd(d) - cur });
    return out;
  }
  function largestFree(d) {
    return freeRegions(d).reduce((best, r) => (r.size > best.size ? r : best), { offset: MB, size: 0 });
  }
  const unallocated = d => d.style === 'RAW' ? d.size : d.size - d.partitions.reduce((a, p) => a + p.size, 0) - MB - (d.style === 'GPT' ? MB : 0);

  /** A volume's files stay on the partition (p.files) while it has no drive letter or its disk is offline, as on real disks. */
  function unmount(p) {
    const drives = WS.state.fs.drives;
    if (p.letter && drives[p.letter]) { p.files = drives[p.letter]; delete drives[p.letter]; WS.store.changed('fs'); }
  }
  function mount(p) {
    if (!p.letter || !p.fs) return;
    if (p.files) { WS.state.fs.drives[p.letter] = p.files; delete p.files; WS.store.changed('fs'); }
    else if (!WS.state.fs.drives[p.letter]) WS.fs.createDrive(p.letter);
  }
  function setOnline(n, online) {
    const d = disk(n); if (!d) return noDisk(n);
    if (d.boot && !online) return { ok: false, error: 'The specified disk is a system disk. The operation is not allowed on the system or boot disk.' };
    if (d.online === !!online) return { ok: true };
    d.online = !!online;
    for (const p of d.partitions) { if (online) mount(p); else unmount(p); }
    changed();
    return { ok: true };
  }
  function initialize(n, style = 'GPT') {
    const d = disk(n); if (!d) return noDisk(n);
    style = String(style).toUpperCase();
    if (!['GPT', 'MBR'].includes(style)) return { ok: false, error: `Cannot bind parameter 'PartitionStyle'. Specify one of the following enumerator names and try again: Unknown, MBR, GPT` };
    if (!d.online) return { ok: false, code: 'Offline', error: 'The disk is offline.' };
    if (d.style !== 'RAW') return { ok: false, code: 'AlreadyInitialized', error: 'The disk has already been initialized.' };
    d.style = style;
    if (style === 'GPT') d.partitions.push({ number: 1, type: 'Reserved', offset: MB, size: 16 * MB, fs: null, letter: null, label: '', flags: [] });
    changed();
    return { ok: true };
  }
  function clearDisk(n) {
    const d = disk(n); if (!d) return noDisk(n);
    if (d.boot) return { ok: false, error: 'The operation is not allowed on the system or boot disk.' };
    for (const p of d.partitions) if (p.letter) WS.fs.removeDrive(p.letter);
    d.partitions = []; d.style = 'RAW';
    changed();
    return { ok: true };
  }

  /** newPartition(n, { size: bytes | 'max', letter: 'E' | 'auto' | null, offset: start of the free extent to use (default: the largest) }) */
  function newPartition(n, o = {}) {
    const d = disk(n); if (!d) return noDisk(n);
    if (!d.online) return { ok: false, code: 'Offline', error: 'The disk is offline.' };
    if (d.style === 'RAW') return { ok: false, code: 'NotInitialized', error: 'The disk has not been initialized.' };
    if (d.readOnly) return { ok: false, error: 'The media is write protected.' };
    if (d.style === 'MBR' && d.partitions.length >= 4) return { ok: false, error: 'There is not enough space available on the disk(s) to complete this operation.' };
    const free = o.offset != null ? freeRegions(d).find(r => o.offset >= r.offset && o.offset < r.offset + r.size) || { offset: 0, size: 0 } : largestFree(d);
    const size = o.size === 'max' || o.size == null ? free.size : Math.floor(+o.size / MB) * MB;
    if (!(size >= 8 * MB) || size > free.size) return { ok: false, code: 'NotEnoughSpace', error: 'Not enough available capacity' };
    let letter = o.letter === 'auto' ? nextLetter() : o.letter ? String(o.letter).toUpperCase().replace(':', '') : null;
    if (letter && usedLetters().has(letter)) return { ok: false, code: 'LetterInUse', error: 'The requested access path is already in use.' };
    const p = { number: Math.max(0, ...d.partitions.map(x => x.number)) + 1, type: 'Basic', offset: free.offset, size, fs: null, letter, label: '', flags: [d.style === 'MBR' ? 'Primary Partition' : 'Basic Data Partition'] };
    d.partitions.push(p);
    changed();
    return { ok: true, partition: p, disk: d };
  }
  const findPart = (n, pn) => { const d = disk(n); return d ? d.partitions.find(p => p.number === +pn) || null : null; };
  function byLetter(letter) {
    letter = String(letter || '').toUpperCase().replace(/[:\\]/g, '');
    for (const d of S().disks) for (const p of d.partitions) if (p.letter === letter) return { disk: d, part: p };
    return null;
  }
  const isSystem = p => p.letter === 'C' || ['System', 'Recovery', 'Reserved'].includes(p.type);

  /** Allocation unit sizes Format offers per file system (bytes); the first is the default for most volume sizes. */
  const AU = { NTFS: [4096, 512, 1024, 2048, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152], ReFS: [4096, 65536],
    FAT32: [4096, 512, 1024, 2048, 8192, 16384, 32768, 65536], exFAT: [32768, 512, 1024, 2048, 4096, 8192, 16384, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216, 33554432] };
  /** The cluster size Windows picks when "Default" is chosen. */
  function defaultAu(fs, size) {
    if (fs === 'exFAT') return size <= 256 * MB ? 4096 : size <= 32 * GB ? 32768 : 131072;
    if (fs === 'FAT32') return size <= 8 * GB ? 4096 : size <= 16 * GB ? 8192 : 16384;
    return 4096;
  }
  /** format(letterOrPart, { fs: 'NTFS'|'ReFS'|'FAT32'|'exFAT', label, au: bytes (0/undefined = default), compress, shortNames (8.3 names, NTFS) }) - wipes the volume's files. */
  function format(target, o = {}) {
    const hit = typeof target === 'object' ? target : byLetter(target);
    if (!hit) return { ok: false, code: 'NotFound', error: `No MSFT_Volume objects found with property 'DriveLetter' equal to '${target}'. Verify the value of the property and retry.` };
    const p = hit.part;
    if (p.letter === 'C') return { ok: false, error: 'Windows cannot format this volume. It contains the version of Windows that you are using. Formatting this volume could cause your computer to stop working.' };
    if (isSystem(p)) return { ok: false, error: 'The operation is not supported on this partition.' };
    const fs = ['NTFS', 'ReFS', 'FAT32', 'exFAT'].find(x => x.toLowerCase() === String(o.fs || 'NTFS').toLowerCase());
    if (!fs) return { ok: false, error: `Cannot validate argument on parameter 'FileSystem'. The argument "${o.fs}" does not belong to the set "FAT,FAT32,exFAT,NTFS,ReFS".` };
    if (fs === 'FAT32' && p.size > 32 * GB) return { ok: false, error: 'The volume is too big for FAT32.' };
    const label = String(o.label == null ? '' : o.label);
    if (label.length > (fs === 'FAT32' ? 11 : 32)) return { ok: false, error: 'The volume label is not valid. Please enter a valid volume label.' };
    const au = +o.au || 0;
    if (au && !AU[fs].includes(au)) return { ok: false, error: 'The specified cluster size is invalid.' };
    if (o.compress && fs !== 'NTFS') return { ok: false, error: 'Compression is supported only on NTFS volumes.' };
    if (o.compress && au > 4096) return { ok: false, error: 'Compression is not supported for allocation unit sizes above 4096 bytes.' };
    p.fs = fs; p.label = label; p.au = au || defaultAu(fs, p.size); p.compressed = !!o.compress; p.shortNames = !!o.shortNames && fs !== 'ReFS';
    delete p.files;
    if (p.letter) WS.fs.createDrive(p.letter);
    changed();
    return { ok: true, volume: volumeOf(hit.disk, p) };
  }
  /** Disk Management's New Simple Volume Wizard in one call. */
  function newVolume(n, o = {}) {
    const r = newPartition(n, { size: o.size, letter: o.letter === undefined ? 'auto' : o.letter, offset: o.offset });
    if (!r.ok) return r;
    const f = format({ disk: r.disk, part: r.partition }, { fs: o.fs || 'NTFS', label: o.label == null ? 'New Volume' : o.label, au: o.au, compress: o.compress, shortNames: o.shortNames });
    if (!f.ok) { r.disk.partitions = r.disk.partitions.filter(p => p !== r.partition); changed(); }
    return f;
  }
  function deletePartition(n, pn) {
    const d = disk(n); const p = findPart(n, pn);
    if (!p) return { ok: false, code: 'NotFound', error: `No MSFT_Partition objects found with property 'PartitionNumber' equal to '${pn}'.` };
    if (isSystem(p)) return { ok: false, error: 'Virtual Disk Service error:\nCannot delete a protected partition without the force protected parameter set.' };
    if (p.letter) WS.fs.removeDrive(p.letter);
    d.partitions = d.partitions.filter(x => x !== p);
    changed();
    return { ok: true };
  }
  function setLetter(oldLetter, newLetter) {
    const hit = byLetter(oldLetter);
    if (!hit) return { ok: false, code: 'NotFound', error: `No MSFT_Partition objects found with property 'DriveLetter' equal to '${oldLetter}'.` };
    if (hit.part.letter === 'C') return { ok: false, error: 'Windows cannot modify the drive letter of your system volume or boot volume.' };
    const nl = newLetter ? String(newLetter).toUpperCase().replace(':', '') : null;
    if (nl && usedLetters().has(nl)) return { ok: false, code: 'LetterInUse', error: 'The requested access path is already in use.' };
    if (!nl) unmount(hit.part);
    else if (WS.state.fs.drives[hit.part.letter]) WS.fs.moveDrive(hit.part.letter, nl);
    hit.part.letter = nl;
    changed();
    return { ok: true };
  }
  /** Give a lettered partition a letter (Add-PartitionAccessPath / "Change Drive Letter and Paths > Add"). */
  function assignLetter(n, pn, letter) {
    const p = findPart(n, pn);
    if (!p) return { ok: false, code: 'NotFound', error: `No MSFT_Partition objects found with property 'PartitionNumber' equal to '${pn}'.` };
    const nl = letter === 'auto' ? nextLetter() : String(letter).toUpperCase().replace(':', '');
    if (usedLetters().has(nl)) return { ok: false, code: 'LetterInUse', error: 'The requested access path is already in use.' };
    p.letter = nl;
    mount(p);
    changed();
    return { ok: true };
  }
  /** Convert to GPT/MBR Disk: only an empty disk (an MSR alone counts as empty) can change partition style. */
  function convertStyle(n, style) {
    const d = disk(n); if (!d) return noDisk(n);
    style = String(style).toUpperCase();
    if (!['GPT', 'MBR'].includes(style)) return { ok: false, error: 'The parameter is incorrect.' };
    if (!d.online) return { ok: false, code: 'Offline', error: 'The disk is offline.' };
    if (d.style === 'RAW') return { ok: false, code: 'NotInitialized', error: 'The disk has not been initialized.' };
    if (d.style === style) return { ok: true };
    if (d.boot || d.partitions.some(p => p.type !== 'Reserved')) return { ok: false, code: 'NotEmpty', error: 'The disk is not empty.' };
    d.style = style;
    d.partitions = style === 'GPT' ? [{ number: 1, type: 'Reserved', offset: MB, size: 16 * MB, fs: null, letter: null, label: '', flags: [] }] : [];
    changed();
    return { ok: true };
  }
  /** Mark Partition as Active (MBR only); the other partitions on the disk lose the flag. */
  function setActive(n, pn) {
    const d = disk(n), p = findPart(n, pn);
    if (!p) return { ok: false, code: 'NotFound', error: `No MSFT_Partition objects found with property 'PartitionNumber' equal to '${pn}'.` };
    if (d.style !== 'MBR') return { ok: false, error: 'The operation is not supported on GPT disks.' };
    for (const x of d.partitions) x.flags = x.flags.filter(f => f !== 'Active');
    p.flags.push('Active');
    changed();
    return { ok: true };
  }
  /** Change Drive Letter and Paths on the DVD drive (null removes its letter). */
  function setCdromLetter(letter) {
    const cd = S().cdrom; if (!cd) return { ok: false, code: 'NotFound', error: 'The device is not ready.' };
    const nl = letter ? String(letter).toUpperCase().replace(':', '') : null;
    if (nl && nl !== cd.letter && usedLetters().has(nl)) return { ok: false, code: 'LetterInUse', error: 'The requested access path is already in use.' };
    cd.letter = nl;
    changed();
    return { ok: true };
  }
  function setLabel(letter, label) {
    const hit = byLetter(letter);
    if (!hit) return { ok: false, code: 'NotFound', error: `No MSFT_Volume objects found with property 'DriveLetter' equal to '${letter}'.` };
    if (String(label).length > 32) return { ok: false, error: 'The volume label is not valid. Please enter a valid volume label.' };
    hit.part.label = String(label); changed(); return { ok: true };
  }
  /** Extend (positive) or shrink to a new size in bytes; extending needs free space right after the partition. */
  function resize(letter, newSize) {
    const hit = byLetter(letter);
    if (!hit) return { ok: false, code: 'NotFound', error: `No MSFT_Partition objects found with property 'DriveLetter' equal to '${letter}'.` };
    const { disk: d, part: p } = hit;
    newSize = Math.floor(+newSize / MB) * MB;
    const after = d.partitions.filter(x => x.offset > p.offset).sort((a, b) => a.offset - b.offset)[0];
    const maxSize = (after ? after.offset : usableEnd(d)) - p.offset;
    const minSize = Math.ceil((usedBytes(p) + 64 * MB) / MB) * MB;
    if (newSize > maxSize) return { ok: false, code: 'NotEnoughSpace', error: 'Size Not Supported\n\nThe size of the extent is less than the minimum of 1MB.' };
    if (newSize < minSize) return { ok: false, code: 'TooSmall', error: 'The specified shrink size is too big and will cause the volume to be smaller than the minimum volume size.' };
    p.size = newSize;
    changed();
    return { ok: true };
  }
  function supportedSize(letter) {
    const hit = byLetter(letter);
    if (!hit) return null;
    const { disk: d, part: p } = hit;
    const after = d.partitions.filter(x => x.offset > p.offset).sort((a, b) => a.offset - b.offset)[0];
    return { min: Math.ceil((usedBytes(p) + 64 * MB) / MB) * MB, max: (after ? after.offset : usableEnd(d)) - p.offset };
  }

  function usedBytes(p) {
    if (!p.fs) return 0;
    const meta = p.fs === 'ReFS' ? Math.min(2 * GB, p.size * 0.02) : p.size * 0.002;
    const files = p.letter && WS.state.fs.drives[p.letter] ? WS.fs.du(p.letter + ':\\') : 0;
    return Math.round((p.letter === 'C' ? OS_USED : 0) + meta + files);
  }
  function volumeOf(d, p) {
    const used = usedBytes(p);
    const status = 'Healthy (' + (p.flags.join(', ') || 'Primary Partition') + ')';
    return { disk: d.number, partition: p.number, letter: p.letter, label: p.label, fs: p.fs || (p.type === 'Basic' ? 'RAW' : ''), type: p.type,
      path: `\\\\?\\Volume{${WS.util.hashStr('vol' + d.number + p.number).toString(16).padStart(8, '0')}-0000-0000-0000-100000000000}\\`,
      layout: 'Simple', volType: 'Basic', status, size: p.size, used, free: Math.max(0, p.size - used),
      healthStatus: 'Healthy', operationalStatus: 'OK', hidden: p.type === 'Reserved', au: p.au || (p.fs ? defaultAu(p.fs, p.size) : 0), compressed: !!p.compressed, shortNames: !!p.shortNames };
  }

  // The Server service re-creates the administrative shares (ADMIN$, IPC$, C$, E$...) each time it starts.
  WS.sys.on('boot', () => {
    const sh = WS.state.smb && WS.state.smb.shares;
    if (!sh) return;
    for (const [name, path, description] of [['ADMIN$', 'C:\\Windows', 'Remote Admin'], ['IPC$', '', 'Remote IPC']])
      if (!sh.some(s => s.name.toUpperCase() === name)) sh.push({ name, path, description, special: true, access: [] });
    syncAdminShares();
  });

  WS.storage = {
    GB, MB,
    disks: () => S().disks.map(d => ({ ...d, unallocated: unallocated(d), largestFree: largestFree(d).size,
      status: !d.online ? 'Offline' : d.style === 'RAW' ? 'Not Initialized' : 'Online', partitions: d.partitions.slice() })),
    disk, volumes: () => S().disks.filter(d => d.online).flatMap(d => d.partitions.filter(p => p.type !== 'Reserved').map(p => volumeOf(d, p))),
    volume: letter => { const h = byLetter(letter); return h ? volumeOf(h.disk, h.part) : null; },
    byLetter, freeLetters, nextLetter, isCdrom: l => !!S().cdrom && S().cdrom.letter === String(l).toUpperCase(),
    cdrom: () => S().cdrom, freeRegions: n => freeRegions(disk(n)), usedBytes, AU, defaultAu,
    setOnline, initialize, clearDisk, newPartition, format, newVolume, deletePartition, setLetter, assignLetter, setLabel, resize, supportedSize,
    convertStyle, setActive, setCdromLetter, syncAdminShares,
    /** Labs/instructors: add another blank virtual disk (like adding a VHDX in Hyper-V). */
    addDisk(sizeGB = 20) {
      const n = Math.max(...S().disks.map(d => d.number)) + 1;
      S().disks.push({ number: n, model: 'Msft Virtual Disk', serial: '', size: sizeGB * GB, style: 'RAW', online: WS.storage.sanPolicy() === 'OnlineAll', readOnly: false, boot: false, partitions: [] });
      changed();
      return n;
    },
    /** Set-Disk -IsReadOnly / diskpart "attributes disk set|clear readonly". */
    setReadOnly(n, on) {
      const d = disk(n); if (!d) return noDisk(n);
      if (d.boot && on) return { ok: false, error: 'The operation is not allowed on the system or boot disk.' };
      d.readOnly = !!on;
      changed();
      return { ok: true };
    },
    /** The SAN policy decides whether new disks come online: Windows Server defaults to OfflineShared, which is why Disk 1 starts Offline. */
    sanPolicy: () => S().sanPolicy || 'OfflineShared',
    setSanPolicy(p) {
      const v = ['OnlineAll', 'OfflineAll', 'OfflineShared', 'OfflineInternal'].find(x => x.toLowerCase() === String(p).toLowerCase());
      if (!v) return { ok: false, error: 'The arguments specified for this command are not valid.' };
      S().sanPolicy = v;
      changed();
      return { ok: true };
    }
  };
})();
