/* Disk Management browser workflow; use a fresh profile.
 * &shot=initial|online|init|wizard|wizformat|volumes|format|letter|shrink|extend|volprops|diskprops|mbr|prompt stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, S = WS.storage, DM = WS.diskmgmt;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const button = (label, scope = shade()) => [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(70); };
  const input = (key, scope = shade()) => scope.querySelector(`[data-field="${key}"]`);
  const fill = (key, value, scope) => {
    const el = input(key, scope); if (!el) throw new Error('Missing field: ' + key);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(['checkbox', 'radio'].includes(el.type) || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const tab = async label => { const b = [...shade().querySelectorAll('.ps-tab')].find(x => x.textContent === label); if (!b) throw new Error('Missing tab: ' + label); b.click(); await wait(30); };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const item = (items, name) => { const it = items.find(x => x && x.label && WS.ui.plain(x.label) === name); if (!it) throw new Error('Missing menu item: ' + name + ' in ' + items.filter(x => x && x.label).map(x => WS.ui.plain(x.label)).join('|')); return it; };
  const labels = items => items.filter(x => x && x.label).map(x => WS.ui.plain(x.label));
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async cmd => { const out = []; await ps.execute(cmd, { capture: out }); return out; };
  try {
    await wait(250);
    /* ---------------- open: Connecting to Virtual Disk Service, then the default disks ---------------- */
    t('diskmgmt.msc is a registered console', !!WS.apps.get('diskmgmt'));
    const win = WS.apps.launch('diskmgmt'), c = win.diskmgmt, mmc = c.mmc;
    await wait(60);
    t('opens with the console tree hidden and connects to VDS first', win.el.querySelector('.mmc-tree').style.display === 'none' && win.el.textContent.includes('Connecting to Virtual Disk Service...'));
    await wait(450);
    const G = () => win.el.querySelector('.dm-graph');
    const vols = () => mmc.win.el.querySelector('.dm-pane.top .lv').textContent;
    t('volume list shows C: and the hidden system partitions', vols().includes('(C:)') && vols().includes('(Disk 0 partition 1)') && vols().includes('(Disk 0 partition 4)') && !vols().includes('partition 2'));
    t('volume list status text', vols().includes('Healthy (Boot, Page File, Crash Dump, Basic Data Partition)') && vols().includes('Healthy (EFI System Partition)') && vols().includes('Healthy (Recovery Partition)'));
    t('graphical view: Disk 0 online, Disk 1 offline and unknown, DVD with no media', G().textContent.includes('Disk 0Basic127.00 GBOnline') && G().textContent.includes('Disk 1Unknown40.00 GBOffline') && G().textContent.includes('CD-ROM 0DVD (D:)') && G().textContent.includes('No Media'));
    t('legend shows Unallocated and Primary partition', win.el.querySelector('.dm-legend').textContent === 'UnallocatedPrimary partition');
    t('offline disk explains the SAN policy', G().querySelector('[data-id="disk:1"]').title.includes('policy set by an administrator'));
    t('no Initialize prompt while the new disk is offline', !shade());
    if (stop('initial')) return;

    /* ---------------- menus per object ---------------- */
    t('offline disk menu: Online, Properties, Help', labels(c.menu('disk:1')).join() === 'Online,Properties,Help');
    const d0 = labels(c.menu('disk:0'));
    t('boot disk menu offers conversions and Offline disabled', d0.includes('Convert to MBR Disk') && item(c.menu('disk:0'), 'Offline').disabled && item(c.menu('disk:0'), 'Convert to MBR Disk').disabled);
    t('EFI partition menu has only Help', labels(c.menu('part:0:1')).join() === 'Help');
    const cm = c.menu('part:0:3');
    t('C: cannot be formatted, deleted or extended (recovery partition follows it)', item(cm, 'Format...').disabled && item(cm, 'Delete Volume...').disabled && item(cm, 'Extend Volume...').disabled && !item(cm, 'Shrink Volume...').disabled);
    t('GPT volume cannot be marked active', item(cm, 'Mark Partition as Active').disabled);

    /* ---------------- Online + Initialize ---------------- */
    await item(c.menu('disk:1'), 'Online').action(); await wait(80);
    t('Online brings Disk 1 to Not Initialized', S.disks()[1].status === 'Not Initialized' && G().textContent.includes('Disk 1Unknown40.00 GBNot Initialized'));
    t('uninitialized disk menu: Initialize Disk, Offline, Properties, Help', labels(c.menu('disk:1')).join() === 'Initialize Disk,Offline,Properties,Help');
    t('unallocated region on an uninitialized disk cannot hold a volume', item(c.menu('free:1:raw'), 'New Simple Volume...').disabled);
    if (stop('online')) return;
    let busy = item(c.menu('disk:1'), 'Initialize Disk').action(); await wait(80);
    t('Initialize Disk lists the disk and defaults to GPT', dlgText().includes('You must initialize a disk before Logical Disk Manager can access it.') && input('disk1').checked && input('gpt').checked);
    t('Initialize Disk shows the GPT note', dlgText().includes('The GPT partition style is not recognized by all previous versions of Windows.'));
    if (stop('init')) return;
    fill('disk1', false);
    t('OK is disabled with no disk selected', button('OK').disabled);
    fill('disk1', true); await click('OK'); await busy; await wait(80);
    t('disk initialized as GPT with its MSR', S.disk(1).style === 'GPT' && S.disk(1).partitions.length === 1 && S.disk(1).partitions[0].type === 'Reserved');
    const free = S.freeRegions(1)[0];
    t('graphical view shows 39.98 GB Unallocated after the hidden MSR', G().textContent.includes('39.98 GBUnallocated') && !!G().querySelector(`[data-id="free:1:${free.offset}"]`));
    t('PowerShell sees the initialized disk', (await run('Get-Disk -Number 1'))[0].PartitionStyle === 'GPT');

    /* ---------------- New Simple Volume Wizard ---------------- */
    let wz, wd;
    busy = DM.newSimpleVolume(1, { offset: free.offset, ctl: c, onCreate: (w, d) => { wz = w; wd = d; } }); await wait(80);
    t('wizard opens on its welcome page', wz.page.id === 'welcome' && wz.el.textContent.includes('Welcome to the New Simple Volume Wizard'));
    await click('Next >', wz.el);
    t('size page shows the maximum, minimum and default size', wz.el.textContent.includes('Maximum disk space in MB:40942') && wz.el.textContent.includes('Minimum disk space in MB:8') && input('size', wz.el).value === '40942');
    fill('size', '50000', wz.el); await click('Next >', wz.el);
    t('too large a size is refused', dlgText().includes('Specify a size between 8 MB and 40942 MB') && wz.page.id === 'size');
    await click('OK');
    fill('size', '30720', wz.el); await click('Next >', wz.el);
    t('drive letter page offers E first', wz.page.id === 'letter' && input('letter', wz.el).value === 'E' && input('letterMode-mount', wz.el).disabled);
    if (stop('wizard')) return;
    await click('Next >', wz.el);
    t('format page defaults: NTFS, Default, New Volume, quick format', input('fs', wz.el).value === 'NTFS' && input('au', wz.el).value === '0' && input('label', wz.el).value === 'New Volume' && input('quick', wz.el).checked);
    t('FAT32 is offered up to 32 GB (30 GB here)', [...input('fs', wz.el).options].some(o => o.value === 'FAT32'));
    await click('< Back', wz.el); await click('< Back', wz.el); fill('size', '40000', wz.el); await click('Next >', wz.el); await click('Next >', wz.el);
    t('FAT32 is not offered above 32 GB', ![...input('fs', wz.el).options].some(o => o.value === 'FAT32'));
    await click('< Back', wz.el); await click('< Back', wz.el); fill('size', '30720', wz.el); await click('Next >', wz.el); await click('Next >', wz.el);
    fill('fs', 'ReFS', wz.el);
    t('ReFS offers 4K/64K clusters and no compression', [...input('au', wz.el).options].map(o => o.textContent).join() === 'Default,4096,64K' && input('compress', wz.el).disabled);
    fill('fs', 'NTFS', wz.el); fill('label', 'Data', wz.el);
    if (stop('wizformat')) return;
    await click('Next >', wz.el);
    t('Completing page summarises the settings', wz.page.id === 'complete' && wz.el.textContent.includes('Volume size: 30720 MB') && wz.el.textContent.includes('Drive letter or path: E:') && wz.el.textContent.includes('Volume label: Data'));
    await click('Finish', wz.el); await busy; await wait(120);
    const E = () => S.volume('E');
    t('volume E: created as NTFS "Data" of 30 GB', E() && E().fs === 'NTFS' && E().label === 'Data' && E().size === 30720 * S.MB);
    t('E: drive is browsable and has its admin share', WS.fs.drives().includes('E') && !!WS.smb.get('E$') && WS.smb.get('E$').description === 'Default share');
    t('volume list and graphical view show Data (E:)', vols().includes('Data (E:)') && G().textContent.includes('Data (E:)30.00 GB NTFSHealthy (Basic Data Partition)'));
    t('remaining space is a new unallocated region', S.freeRegions(1).length === 1 && G().textContent.includes('9.98 GBUnallocated'));
    t('the new volume is selected', c.selected() === 'part:1:2' && !!G().querySelector('.dm-reg.sel[data-id="part:1:2"]'));
    if (stop('volumes')) return;

    /* ---------------- Format ---------------- */
    WS.fs.writeFile('E:\\keep.txt', 'data');
    busy = DM.format('part:1:2'); await wait(80);
    t('Format dialog prefills the label and file system', shade().querySelector('.dlg-ttext').textContent === 'Format E:' && input('label').value === 'Data' && input('fs').value === 'NTFS');
    fill('fs', 'NTFS'); fill('au', '65536');
    t('compression is unavailable above 4K clusters', input('compress').disabled);
    fill('label', 'SQLData');
    if (stop('format')) return;
    await click('OK');
    t('Format warns that data will be erased', dlgText().includes('Formatting this volume will erase all data on it.'));
    await click('Cancel'); await wait(40);
    t('Cancel at the warning keeps the dialog and the data', shade() && shade().querySelector('.dlg-ttext').textContent === 'Format E:' && WS.fs.exists('E:\\keep.txt'));
    await click('OK'); await click('OK'); await busy; await wait(60);
    t('format applied the label and 64K clusters and wiped the files', E().label === 'SQLData' && E().au === 65536 && !WS.fs.exists('E:\\keep.txt'));
    t('Get-Volume reports the allocation unit size', (await run('Get-Volume -DriveLetter E'))[0].AllocationUnitSize === 65536);

    /* ---------------- Change Drive Letter and Paths ---------------- */
    WS.fs.writeFile('E:\\keep.txt', 'data');
    let ldlg, edlg;
    busy = DM.changeLetter('part:1:2', { onCreate: f => { ldlg = f; }, onEdit: f => { edlg = f; } }); await wait(80);
    t('dialog lists E: with Change and Remove', ldlg.box.querySelector('[data-field="paths"]').textContent === 'E:' && button('Add...').disabled && !button('Change...').disabled);
    if (stop('letter')) return;
    await click('Change...');
    t('Change dialog asks for the new letter', dlgText().includes('Enter a new drive letter or path for SQLData (E:).'));
    fill('letter', 'S'); await click('OK');
    t('changing a letter warns about programs', dlgText().includes('Some programs that rely on drive letters might not run correctly.'));
    await click('Yes'); await wait(60);
    t('letter changed to S: and the files moved with it', S.volume('S') && WS.fs.exists('S:\\keep.txt') && !S.volume('E'));
    t('admin shares follow the letter', !!WS.smb.get('S$') && !WS.smb.get('E$'));
    await click('Remove'); await click('Yes'); await wait(60);
    t('removing the letter unmounts the volume but keeps it', !WS.fs.drives().includes('S') && S.disk(1).partitions.find(p => p.number === 2).fs === 'NTFS' && vols().includes('SQLData') && !WS.smb.get('S$'));
    await click('Add...'); fill('letter', 'E'); await click('OK'); await wait(60);
    t('adding a letter back brings the files back', WS.fs.exists('E:\\keep.txt'));
    await click('OK'); await busy;
    void edlg;

    /* ---------------- Shrink + Extend ---------------- */
    busy = DM.shrink('part:1:2'); await wait(600);
    t('Shrink queries the space and opens Shrink E:', shade().querySelector('.dlg-ttext').textContent === 'Shrink E:' && dlgText().includes('Size of available shrink space in MB:'));
    fill('amount', '10240');
    t('total after shrink updates', dlgText().includes('Total size after shrink in MB:20480'));
    if (stop('shrink')) return;
    await click('Shrink'); await busy; await wait(80);
    t('volume shrank to 20 GB; the freed space joins the unallocated region after it', E().size === 20480 * S.MB && S.freeRegions(1).length === 1 && S.freeRegions(1)[0].size === (40942 - 20480) * S.MB);
    t('Extend is now available', !item(c.menu('part:1:2'), 'Extend Volume...').disabled);
    busy = DM.extend('part:1:2', { onCreate: w => { wz = w; } }); await wait(80);
    await click('Next >', wz.el);
    t('Select Disks shows Disk 1 and the maximum', wz.el.textContent.includes('Disk 1') && input('amount', wz.el).value === String(Math.floor(S.freeRegions(1)[0].size / S.MB)));
    fill('amount', '5120', wz.el);
    if (stop('extend')) return;
    await click('Next >', wz.el); await click('Finish', wz.el); await busy; await wait(60);
    t('volume extended by 5 GB', E().size === 25600 * S.MB);

    /* ---------------- Properties ---------------- */
    let sheet;
    busy = DM.volumeProperties('part:1:2', { onCreate: s => { sheet = s; } }); await wait(80);
    t('volume Properties title and General tab', shade().querySelector('.dlg-ttext').textContent === 'SQLData (E:) Properties' && dlgText().includes('Local Disk') && dlgText().includes('NTFS') && dlgText().includes('Drive E:'));
    t('drive tabs: General, Tools, Hardware, Sharing, Quota', [...shade().querySelectorAll('.ps-tab')].map(x => x.textContent).join() === 'General,Tools,Hardware,Sharing,Quota');
    fill('label', 'Database');
    if (stop('volprops')) return;
    await tab('Hardware');
    t('Hardware lists the virtual disks and DVD', dlgText().includes('Msft Virtual Disk') && dlgText().includes('Microsoft Virtual DVD-ROM'));
    await tab('Sharing');
    t('Sharing tab says the drive is not shared', dlgText().includes('E:\\') && dlgText().includes('Not Shared'));
    sheet.ok(); await busy; await wait(60);
    t('label change applied through the model', E().label === 'Database' && (await run('Get-Volume -DriveLetter E'))[0].FileSystemLabel === 'Database');
    busy = DM.diskProperties(1, { tab: 'Volumes' }); await wait(80);
    t('disk Properties: Volumes tab', shade().querySelector('.dlg-ttext').textContent === 'Msft Virtual Disk Properties' && dlgText().includes('GUID Partition Table (GPT)') && dlgText().includes('Database (E:)') && dlgText().includes('Reserved space:16 MB'));
    if (stop('diskprops')) return;
    await click('Cancel'); await busy;

    /* ---------------- PowerShell and the console agree ---------------- */
    await run('Set-Disk -Number 1 -IsOffline $true'); await wait(120);
    t('Set-Disk -IsOffline updates the open console', G().textContent.includes('Disk 1Basic40.00 GBOffline') && !vols().includes('Database (E:)'));
    t('an offline disk hides its drive but keeps the files', !WS.fs.drives().includes('E'));
    await item(c.menu('disk:1'), 'Online').action(); await wait(80);
    t('bringing it online restores the volume and files', WS.fs.exists('E:\\keep.txt') && vols().includes('Database (E:)'));
    await run('New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter G | Format-Volume -FileSystem NTFS -NewFileSystemLabel Logs -Confirm:$false'); await wait(120);
    t('a volume made in PowerShell appears in the console', vols().includes('Logs (G:)') && G().textContent.includes('Logs (G:)'));

    /* ---------------- Delete, convert to MBR, mark active ---------------- */
    busy = DM.deleteVolume('part:1:3'); await wait(60);
    t('Delete asks first', dlgText().includes('Deleting this volume will erase all data on it.'));
    await click('No'); await busy;
    t('No keeps the volume', !!S.volume('G'));
    busy = DM.deleteVolume('part:1:3'); await wait(60); await click('Yes'); await busy;
    busy = DM.deleteVolume('part:1:2'); await wait(60); await click('Yes'); await busy; await wait(60);
    t('both volumes deleted and their drives gone', !S.volume('G') && !S.volume('E') && !WS.fs.drives().includes('E'));
    t('empty GPT disk can be converted to MBR', !item(c.menu('disk:1'), 'Convert to MBR Disk').disabled);
    await item(c.menu('disk:1'), 'Convert to MBR Disk').action(); await wait(60);
    t('disk is MBR with no MSR', S.disk(1).style === 'MBR' && !S.disk(1).partitions.length && labels(c.menu('disk:1')).includes('Convert to GPT Disk'));
    const mfree = S.freeRegions(1)[0];
    busy = DM.newSimpleVolume(1, { offset: mfree.offset, onCreate: w => { wz = w; } }); await wait(60);
    await click('Next >', wz.el); fill('size', '16384', wz.el); await click('Next >', wz.el); await click('Next >', wz.el);
    t('FAT32 is offered for a 16 GB volume', [...input('fs', wz.el).options].some(o => o.value === 'FAT32'));
    fill('fs', 'FAT32', wz.el); fill('label', 'USBIMAGE', wz.el);
    await click('Next >', wz.el); await click('Finish', wz.el); await busy; await wait(60);
    const mv = S.volume('E');
    t('MBR volume is a primary partition formatted FAT32', mv && mv.fs === 'FAT32' && mv.status === 'Healthy (Primary Partition)' && mv.au === 8192);
    if (stop('mbr')) return;
    busy = DM.markActive('part:1:1'); await wait(60); await click('Yes'); await busy; await wait(40);
    t('Mark Partition as Active sets the Active flag', S.disk(1).partitions[0].flags.includes('Active') && item(c.menu('part:1:1'), 'Mark Partition as Active').disabled);

    /* ---------------- DVD drive letter ---------------- */
    busy = DM.changeLetter('cdrom'); await wait(60);
    await click('Change...'); fill('letter', 'R'); await click('OK'); await click('Yes'); await click('OK'); await busy; await wait(60);
    t('DVD drive moved to R:', S.cdrom().letter === 'R' && G().textContent.includes('DVD (R:)'));
    t('a freed letter is offered again', S.freeLetters().includes('D'));

    /* ---------------- view menu ---------------- */
    c.setTop('disks'); await wait(40);
    t('Top > Disk List shows the disks', vols().includes('Disk 0') && vols().includes('Unallocated Space') && vols().includes('CD-ROM 0'));
    c.setBottom('hidden'); await wait(40);
    t('Bottom > Hidden removes the graphical view and legend', !G() && !win.el.querySelector('.dm-legend'));
    c.setBottom('graphical'); c.setTop('volumes'); await wait(40);
    t('views restored', !!G() && vols().includes('(C:)'));

    /* ---------------- a new online RAW disk prompts Initialize Disk on open ---------------- */
    win.close();
    const n = S.addDisk(10); S.setOnline(n, true);
    let prompt = null;
    const w2 = DM.launch({ onInitPrompt: f => { prompt = f; } }); await wait(500);
    t('opening Disk Management prompts to initialize the new disk', !!prompt && dlgText().includes(`Disk ${n}`) && input('disk' + n).checked);
    if (stop('prompt')) return;
    fill('mbr', true); await click('OK'); await wait(60);
    t('prompted disk initialized as MBR', S.disk(n).style === 'MBR');
    w2.close();
    const w3 = WS.apps.launch('diskmgmt'); await wait(500);
    t('no prompt when every disk is initialized', !shade());
    w3.close();

    /* ---------------- diskpart (interactive, errors, /s script) ---------------- */
    const dp = async (inputs, line = 'diskpart') => { const tc = new WS.term.TextConsole({ inputs }); const cs = new WS.term.CmdSession({ console: tc }); await cs.execute(line); return { text: tc.text(), code: cs.lastExit }; };
    let r = await dp(['list disk', 'select disk 2', 'list disk', 'list partition', 'convert gpt', 'create partition primary size=4096', 'format fs=ntfs label="Scratch" quick', 'assign letter=S', 'list volume', 'exit']);
    t('diskpart banner and prompt', r.text.includes('Microsoft DiskPart version 10.0.26100.1') && r.text.includes(`On computer: ${WS.sys.name}`) && r.text.includes('DISKPART> list disk'));
    t('list disk uses diskpart units and marks GPT', /Disk 0 {4}Online {10}127 GB {6}0 B {8}\*/.test(r.text) && r.text.includes('Disk 2 is now the selected disk.') && r.text.includes('* Disk 2'));
    t('empty disk has no partitions to show', r.text.includes('There are no partitions on this disk to show.'));
    t('convert, create, format and assign succeed', ['DiskPart successfully converted the selected disk to GPT format.', 'DiskPart succeeded in creating the specified partition.', 'DiskPart successfully formatted the volume.', 'DiskPart successfully assigned the drive letter or mount point.'].every(x => r.text.includes(x)));
    t('list volume shows the new volume selected', /\* Volume \d+ +S +Scratch +NTFS +Partition +4096 MB +Healthy/.test(r.text) && /Volume 0 +R +DVD-ROM +0 B +No Media/.test(r.text) && r.text.includes('Leaving DiskPart...'), r.text.slice(-1400));
    t('diskpart changes go through the model', S.volume('S') && S.volume('S').label === 'Scratch' && S.disk(2).style === 'GPT' && !!WS.smb.get('S$'), { v: S.volume('S'), style: S.disk(2).style, share: !!WS.smb.get('S$') });
    r = await dp(['select volume S', 'shrink querymax', 'extend', 'detail disk', 'san', 'select disk 0', 'list partition']);
    t('shrink querymax and extend', r.text.includes('The maximum number of reclaimable bytes is:') && r.text.includes('DiskPart successfully extended the volume.') && S.volume('S').size > 9000 * S.MB);
    t('detail disk lists its volumes; SAN policy explains offline disks', r.text.includes('Msft Virtual Disk') && r.text.includes('LUN ID : 2') && r.text.includes('SAN Policy  : Offline Shared'));
    t('list partition on the boot disk', /Partition 1 +System +100 MB +1024 KB/.test(r.text) && /Partition 2 +Reserved +16 MB +101 MB/.test(r.text) && /Partition 4 +Recovery +742 MB/.test(r.text));
    r = await dp(['format fs=ntfs quick', 'select disk 9', 'select disk 0', 'clean', 'select partition 1', 'delete partition', 'select disk 2', 'convert mbr', 'offline disk', 'offline disk', 'online disk', 'bogus']);
    t('no volume selected', r.text.includes('There is no volume selected.\nPlease select a volume and try again.'));
    t('invalid disk number', r.text.includes('The disk you specified is not valid.'));
    t('clean refused on the boot disk', r.text.includes('Clean is not allowed on the disk containing the current boot'));
    t('protected partition cannot be deleted', r.text.includes('Cannot delete a protected partition without the force protected parameter set.'));
    t('converting a disk with partitions is refused', r.text.includes('is not convertible because it contains partitions'));
    t('offline/online disk, and offline twice is an error', r.text.includes('DiskPart successfully offlined the selected disk.') && r.text.includes('This disk is already offline.') && r.text.includes('DiskPart successfully onlined the selected disk.') && S.disk(2).online);
    t('an unknown command prints the command list', r.text.includes('ACTIVE      - Mark the selected partition as active.'));
    WS.fs.writeFile('C:\\dp.txt', 'select disk 2\r\nclean\r\ncreate partition primary\r\nformat fs=ntfs quick label=Tmp\r\nassign letter=T\r\nactive\r\n');
    r = await dp([], 'diskpart /s C:\\dp.txt');
    t('diskpart /s runs a script without prompts', !r.text.includes('DISKPART>') && r.text.includes('Leaving DiskPart...') && r.code === 0);
    t('create partition on a cleaned (RAW) disk initializes it as MBR', S.disk(2).style === 'MBR' && S.volume('T') && S.volume('T').label === 'Tmp' && S.disk(2).partitions[0].flags.includes('Active'));
    WS.fs.writeFile('C:\\dp2.txt', 'select disk 2\r\nconvert gpt\r\nrescan\r\n');
    r = await dp([], 'diskpart /s C:\\dp2.txt');
    t('a script stops at the first error', r.code === 1 && r.text.includes('DiskPart has encountered an error') && !r.text.includes('finished scanning'));
    r = await dp([], 'diskpart /s C:\\missing.txt');
    t('a missing script file is reported', r.code === 1 && r.text.includes('The system cannot find the file specified.'));
    const pso = await run('Get-Disk -Number 2');
    t('PowerShell sees the diskpart result', pso[0].PartitionStyle === 'MBR');
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
