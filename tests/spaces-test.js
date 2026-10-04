/* Storage Spaces: the model (WS.spaces), the Storage cmdlets, Server Manager's Storage Pools page with the New Storage
 * Pool and New Virtual Disk wizards, Disk Management, and Lab 18. Use a fresh profile.
 * &shot=pools|nspname|nspdisks|nspresults|vdlayout|vdresiliency|vdsize|vdresults|degraded|diskmgmt stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, S = WS.storage, SP = WS.spaces, GB = S.GB, MB = S.MB;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const button = (label, scope = shade()) => scope && [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label + ' in ' + dlgText().slice(0, 160)); b.click(); await wait(80); };
  const fieldIn = (root, f) => root.querySelector(`[data-field="${f}"]`);
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async cmd => { const io = ps.console; io.clear(); await ps.execute(cmd); return io.text(); };
  const objs = async cmd => { const out = []; await ps.execute(cmd, { capture: out }); return out; };
  const check = c => WS.labs.evalCheck(c, WS.state);
  const vd = n => SP.space(n);
  try {
    await wait(250);

    /* ---------------- physical disks and the primordial pool ---------------- */
    const added = [1, 2, 3, 4, 5].map(() => S.addDisk(20));
    t('five new 20 GB disks (offline, as the SAN policy leaves them)', added.join() === '2,3,4,5,6' && added.every(n => !S.disk(n).online));
    let out = await run('Get-PhysicalDisk | Sort-Object Number');
    t('Get-PhysicalDisk lists every physical disk with the real columns', /Number FriendlyName\s+SerialNumber MediaType\s+CanPool OperationalStatus\s+HealthStatus Usage\s+Size/.test(out) && (out.match(/Msft Virtual Disk/g) || []).length === 7 && /0 Msft Virtual Disk\s+Unspecified\s+False\s+OK\s+Healthy\s+Auto-Select\s+127 GB/.test(out), out);
    t('the system disk can\'t be pooled: Insufficient Capacity', SP.physicalDisk(0).cannotPoolReason === 'Insufficient Capacity' && SP.physicalDisks().filter(d => d.canPool).length === 6);
    t('Primordial holds the disks that are not in a pool', SP.primordial().poolable.join() === '1,2,3,4,5,6');
    out = await run('Get-StoragePool');
    t('Get-StoragePool shows the Primordial pool', /Primordial\s+OK\s+Healthy\s+True\s+False/.test(out), out);
    out = await run('Get-StorageSubSystem | Format-List FriendlyName,HealthStatus');
    t('Get-StorageSubSystem: Windows Storage on the server', out.includes(`Windows Storage on ${WS.sys.name}`) && out.includes('Healthy'), out);

    /* ---------------- New-StoragePool ---------------- */
    out = await run('New-StoragePool -FriendlyName DataPool -StorageSubSystemFriendlyName "Windows Storage*" -PhysicalDisks (Get-PhysicalDisk -CanPool $true | Where-Object Size -eq 20GB)');
    let pool = SP.pool('DataPool');
    t('New-StoragePool pools the five 20 GB disks and prints the pool', pool && pool.disks.join() === '2,3,4,5,6' && /DataPool\s+OK\s+Healthy\s+False\s+False\s+100 GB/.test(out), out);
    t('pool metadata takes 256 MB per disk', pool.allocated === 5 * 256 * MB && pool.free === 100 * GB - 5 * 256 * MB);
    t('pooled disks leave Get-Disk and Disk Management', !S.disks().some(d => added.includes(d.number)) && !S.disk(2) && (await run('Get-Disk')).split('\n').filter(l => /^\s+\d+ /.test(l)).length === 2);
    t('...and show in Get-PhysicalDisk as In a Pool', SP.physicalDisk(2).cannotPoolReason === 'In a Pool' && SP.physicalDisk(2).pool === 'DataPool');
    out = await run('New-StoragePool -FriendlyName DataPool -StorageSubSystemFriendlyName "Windows Storage*" -PhysicalDisks (Get-PhysicalDisk -CanPool $true)');
    t('a second pool with the same name is refused', out.includes('The specified friendly name already exists.'), out);
    out = await run('New-StoragePool -FriendlyName Other -StorageSubSystemFriendlyName "Windows Storage*" -PhysicalDisks (Get-PhysicalDisk | Where-Object Number -eq 0)');
    t('the system disk can\'t join a pool', out.includes('One of the physical disks specified is not supported by this operation.') && !SP.pool('Other'), out);

    /* ---------------- New-VirtualDisk ---------------- */
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Mirror1 -ResiliencySettingName Mirror -ProvisioningType Fixed -Size 20GB');
    let m = vd('Mirror1');
    t('New-VirtualDisk makes a two-way mirror and prints it', m && m.layout === 'Mirror' && m.copies === 2 && m.size === 20 * GB && /Mirror1\s+Mirror\s+1\s+OK\s+Healthy\s+20 GB\s+40 GB\s+50.00%/.test(out), out);
    t('a two-way mirror spreads over 4 of the 5 disks (2 columns x 2 copies)', m.columns === 2 && m.disks.length === 4);
    const md = S.disks().find(d => d.number === m.disk);
    t('its disk appears: next number, online, RAW, a Storage Space device', m.disk === 7 && md && md.online && md.style === 'RAW' && md.model === 'Microsoft Storage Space Device');
    out = await run('Get-Disk -Number 7 | Format-List FriendlyName,BusType,HealthStatus');
    t('Get-Disk names it after the virtual disk, bus type Spaces', /FriendlyName\s*:\s*Mirror1/.test(out) && /BusType\s*:\s*Spaces/.test(out), out);
    out = await run('Get-VirtualDisk Mirror1 | Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru | New-Partition -DriveLetter M -UseMaximumSize | Format-Volume -FileSystem NTFS -NewFileSystemLabel Mirrored -Confirm:$false');
    t('the usual pipeline initializes it and makes M:', S.volume('M') && S.volume('M').label === 'Mirrored' && S.volume('M').disk === 7, out);
    WS.fs.writeFile('M:\\ledger.txt', 'balanced');
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Parity1 -ResiliencySettingName Parity -ProvisioningType Thin -Size 100GB');
    const pa = vd('Parity1');
    t('a thin parity disk can be larger than the pool\'s free space', pa && pa.size === 100 * GB && pa.provisioning === 'Thin' && pa.columns === 5 && pa.footprint === 0 && /Parity1\s+Parity\s+1\s+OK\s+Healthy\s+100 GB\s+0 B\s+80.00%/.test(out), out);
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Big -ResiliencySettingName Mirror -ProvisioningType Fixed -Size 60GB');
    t('a fixed disk that does not fit: Not enough available capacity', out.includes('Not enough available capacity') && !vd('Big'), out);
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Dual -ResiliencySettingName Parity -PhysicalDiskRedundancy 2 -ProvisioningType Thin -Size 10GB');
    t('dual parity needs 7 disks: sufficient eligible resources', out.includes('The storage pool does not have sufficient eligible resources for the creation of the specified virtual disk.'), out);
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Three -ResiliencySettingName Mirror -NumberOfDataCopies 3 -Size 1GB');
    t('a three-way mirror works on 5 disks (1 column x 3 copies)', vd('Three') && vd('Three').copies === 3 && vd('Three').disks.length === 3 && vd('Three').footprint === 3 * GB, out);
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Mirror1 -ResiliencySettingName Simple -Size 1GB');
    t('virtual disk names are unique', out.includes('The specified friendly name already exists.'), out);
    out = await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Rest -ResiliencySettingName Simple -UseMaximumSize');
    const rest = vd('Rest');
    t('-UseMaximumSize takes all it can across its columns (until one disk is full)', rest && rest.provisioning === 'Fixed' && rest.disks.length === 5 && SP.physicalDisks().filter(d => d.pool === 'DataPool').some(d => d.size - d.allocated < 256 * MB), [rest, SP.pool('DataPool')]);
    out = await run('Remove-VirtualDisk -FriendlyName Rest,Three -Confirm:$false');
    t('Remove-VirtualDisk deletes the virtual disks and their disks', !vd('Rest') && !vd('Three') && SP.spaces().length === 2 && S.disks().filter(d => d.space).length === 2, out);
    out = await run('Get-VirtualDisk');
    t('Get-VirtualDisk lists them', out.includes('Mirror1') && out.includes('Parity1') && /FriendlyName\s+ResiliencySettingName\s+FaultDomainRedundancy\s+OperationalStatus\s+HealthStatus\s+Size\s+FootprintOnPool/.test(out), out);
    t('pipelines: pool -> virtual disks and virtual disk -> physical disks', (await objs('Get-StoragePool DataPool | Get-VirtualDisk')).length === 2 && (await objs('Get-VirtualDisk Mirror1 | Get-PhysicalDisk')).length === 4 && (await objs('Get-StoragePool DataPool | Get-PhysicalDisk')).length === 5);
    t('a thin disk\'s footprint grows with what its volumes hold', (() => { const before = vd('Parity1').footprint; S.disk(vd('Parity1').disk); return before === 0; })());
    await run('Get-VirtualDisk Parity1 | Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru | New-Partition -DriveLetter Q -Size 10GB | Format-Volume -FileSystem NTFS -NewFileSystemLabel Thin -Confirm:$false');
    t('...after a volume is made on it', vd('Parity1').footprint > 0 && vd('Parity1').footprint < 2 * GB, vd('Parity1').footprint);

    /* ---------------- hot spares, failures and repair ---------------- */
    out = await run('Add-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk -CanPool $true) -Usage HotSpare');
    t('Add-PhysicalDisk -Usage HotSpare adds Disk 1 as a hot spare', SP.physicalDisk(1).pool === 'DataPool' && SP.physicalDisk(1).usageLabel === 'Hot Spare' && !S.disk(1), out);
    const victim = vd('Mirror1').disks[0];
    SP.failDisk(victim);
    t('a failed disk: Lost Communication, the pool and its mirror Degraded', SP.physicalDisk(victim).operationalStatus === 'Lost Communication' && SP.pool('DataPool').operationalStatus === 'Degraded'
      && vd('Mirror1').operationalStatus === 'Degraded' && vd('Mirror1').healthStatus === 'Warning' && vd('Parity1').operationalStatus === 'Degraded');
    t('the mirror keeps working', WS.fs.readFile('M:\\ledger.txt') === 'balanced');
    if (stop('degraded-ps')) return;
    out = await run('Get-PhysicalDisk | Where-Object OperationalStatus -ne OK');
    t('Get-PhysicalDisk shows the lost disk without a number', /\s+Msft Virtual Disk\s+Unspecified\s+False\s+Lost Communication\s+Warning\s+Auto-Select\s+20 GB/.test(out), out);
    out = await run(`Remove-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk | Where-Object OperationalStatus -eq 'Lost Communication') -Confirm:$false`);
    t('a disk still in use can\'t be removed', out.includes('Retire the disk and repair the virtual disks first.') && SP.physicalDisk(victim), out);
    out = await run('Get-VirtualDisk | Repair-VirtualDisk');
    t('Repair-VirtualDisk rebuilds both onto healthy disks', vd('Mirror1').operationalStatus === 'OK' && vd('Parity1').operationalStatus === 'OK' && !vd('Mirror1').disks.includes(victim) && !vd('Parity1').disks.includes(victim), out);
    t('the parity disk needed the hot spare, which is now in use', vd('Parity1').disks.includes(1) && SP.physicalDisk(1).usage === 'AutoSelect');
    out = await run(`Remove-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk | Where-Object OperationalStatus -eq 'Lost Communication') -Confirm:$false`);
    t('after the repair the failed disk is removed for good', !out.trim() && !SP.physicalDisk(victim) && SP.pool('DataPool').disks.length === 5 && SP.pool('DataPool').operationalStatus === 'OK', out);
    // retire, repair, remove: the replace-a-disk procedure
    const old = vd('Parity1').disks.find(n => vd('Mirror1').disks.includes(n));
    await run(`Get-PhysicalDisk | Where-Object DeviceId -eq '${old}' | Set-PhysicalDisk -Usage Retired`);
    t('retiring a disk marks it Retired and the virtual disks on it need a repair', SP.physicalDisk(old).usageLabel === 'Retired' && vd('Mirror1').operationalStatus === 'Degraded' && vd('Parity1').operationalStatus === 'Degraded');
    out = await run('Repair-VirtualDisk -FriendlyName Mirror1');
    t('the mirror moves to the pool disk it was not using', !out.trim() && vd('Mirror1').operationalStatus === 'OK' && !vd('Mirror1').disks.includes(old), out);
    out = await run('Repair-VirtualDisk -FriendlyName Parity1');
    t('the parity disk already uses every other disk: nowhere to move', out.includes('not enough free space on the healthy physical disks') && vd('Parity1').disks.includes(old), out);
    const fresh = S.addDisk(20);
    await run(`Add-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk -CanPool $true)`);
    await run('Repair-VirtualDisk -FriendlyName Parity1');
    t('with a new disk in the pool, the repair moves the data off the retired disk', vd('Parity1').operationalStatus === 'OK' && vd('Parity1').disks.includes(fresh) && !vd('Parity1').disks.includes(old));
    out = await run(`Remove-PhysicalDisk -StoragePoolFriendlyName DataPool -PhysicalDisks (Get-PhysicalDisk | Where-Object Usage -eq Retired) -Confirm:$false`);
    t('then the retired disk leaves the pool and can be pooled again', !out.trim() && !SP.physicalDisk(old).pool && SP.physicalDisk(old).canPool && S.disk(old), out);
    // a simple space has no redundancy
    await run('New-VirtualDisk -StoragePoolFriendlyName DataPool -FriendlyName Scratch -ResiliencySettingName Simple -ProvisioningType Fixed -Size 1GB');
    await run('Get-VirtualDisk Scratch | Get-Disk | Initialize-Disk -PartitionStyle GPT -PassThru | New-Partition -DriveLetter T -UseMaximumSize | Format-Volume -FileSystem NTFS -Confirm:$false');
    WS.fs.writeFile('T:\\tmp.txt', 'x');
    const sDisk = vd('Scratch').disk, sOn = vd('Scratch').disks[0];
    SP.failDisk(sOn);
    t('a simple space on a failed disk is Detached: its disk and T: are gone', vd('Scratch').operationalStatus === 'Detached' && vd('Scratch').healthStatus === 'Unhealthy' && !S.disk(sDisk) && !WS.fs.hasDrive('T'));
    out = await run('Repair-VirtualDisk Scratch');
    t('...and it can\'t be repaired', out.includes('too many of its physical disks have failed'), out);
    SP.restoreDisk(sOn);
    t('when the disk comes back, so do the disk and its files', vd('Scratch').operationalStatus === 'OK' && S.disk(sDisk) && WS.fs.readFile('T:\\tmp.txt') === 'x');
    await run('Remove-VirtualDisk Scratch -Confirm:$false');
    t('removing a virtual disk takes its volume with it', !WS.fs.hasDrive('T') && !S.volume('T'));

    /* ---------------- resize, pool removal ---------------- */
    await run('Resize-VirtualDisk -FriendlyName Mirror1 -Size 22GB');
    t('Resize-VirtualDisk grows the disk; the new space is unallocated', vd('Mirror1').size === 22 * GB && S.disk(vd('Mirror1').disk).size === 22 * GB && S.supportedSize('M').max > S.volume('M').size + GB);
    out = await run('Remove-StoragePool DataPool -Confirm:$false');
    t('a pool with virtual disks can\'t be removed', out.includes('contains virtual disks') && SP.pool('DataPool'), out);
    out = await run('Set-StoragePool -FriendlyName DataPool -NewFriendlyName Finance');
    t('Set-StoragePool renames it', SP.pool('Finance') && !SP.pool('DataPool') && vd('Mirror1').pool === 'Finance', out);
    await run('Set-StoragePool -FriendlyName Finance -NewFriendlyName DataPool');

    /* ---------------- Server Manager: Storage Pools ---------------- */
    const extra = [S.addDisk(20), S.addDisk(20), S.addDisk(20)];
    const pageText = w => w.page._el.textContent;
    const wzButton = (w, label) => [...w.el.querySelectorAll('.wz-buttons button')].find(b => b.textContent.trim() === label);
    const item = (items, n) => items.find(x => x && x.label === n);
    const SM = WS.smspaces;
    const win = WS.sm.open('fss:pools'); await wait(100);
    const tileText = name => (win.el.querySelector(`[data-tile="${name}"]`) || { textContent: '' }).textContent;
    t('Storage Pools lists the Primordial pool and DataPool', SM.rows.pools().map(r => r.name).join() === 'Primordial,DataPool' && tileText('STORAGE POOLS').includes('DataPool') && tileText('STORAGE POOLS').includes('Storage Spaces | 2 total'));
    WS.smfss.selection.pools = 'pool:DataPool'; win.sm.go('fss:pools'); await wait(80);
    t('selecting DataPool lists its virtual disks with layout, provisioning and volume', /Mirror1\s*Mirror\s*Fixed\s*22\.0 GB\s*22\.0 GB\s*M:/.test(tileText('VIRTUAL DISKS')) && tileText('VIRTUAL DISKS').includes('Parity1'), tileText('VIRTUAL DISKS'));
    t('...and its physical disks with their usage', (tileText('PHYSICAL DISKS').match(/Auto-Select/g) || []).length === 5, tileText('PHYSICAL DISKS'));
    t('the pool menu: New Virtual Disk, Add Physical Disk, Delete Storage Pool, Properties', ['New Virtual Disk...', 'Add Physical Disk...', 'Delete Storage Pool', 'Properties'].every(n => item(SM.menus.pool(SM.rows.pools()[1]), n)) && item(SM.menus.pool(SM.rows.pools()[0]), 'New Storage Pool...'));
    if (stop('pools')) return;

    let nw = null, nd = null;
    WS.sm.newStoragePool({ onCreate: (w, d) => { nw = w; nd = d; } }); await wait(80);
    t('New Storage Pool Wizard: the real steps', [...nw.el.querySelectorAll('.wz-step')].map(x => x.textContent).join('|') === 'Before You Begin|Storage Pool Name|Physical Disks|Confirmation|Results');
    await nw.next(); await wait(40);
    nw.next(); await wait(80);
    t('a name is required', dlgText().includes('Type a name for the storage pool.'));
    await click('OK');
    type(fieldIn(nw.page._el, 'pool-name'), 'DataPool'); nw.next(); await wait(80);
    t('the name must be new', dlgText().includes('A storage pool named DataPool already exists.'));
    await click('OK');
    type(fieldIn(nw.page._el, 'pool-name'), 'Archive'); type(fieldIn(nw.page._el, 'pool-desc'), 'Old projects');
    t('the primordial pool to use is shown', pageText(nw).includes('Windows Storage') && pageText(nw).includes('Primordial'));
    if (stop('nspname')) return;
    await nw.next(); await wait(40);
    const pick = SP.primordial().poolable;
    t('Physical Disks lists the poolable disks', nw.page.id === 'disks' && pick.length === 4 && pick.every(n => fieldIn(nw.page._el, 'pd-' + n)), pick);
    nw.next(); await wait(80);
    t('at least one disk is required', dlgText().includes('Select at least one physical disk for the storage pool.'));
    await click('OK');
    for (const n of extra) fieldIn(nw.page._el, 'pd-' + n).click();
    type(fieldIn(nw.page._el, 'alloc-' + extra[2]), 'Hot Spare');
    t('the selected capacity adds up', pageText(nw).includes('Total selected capacity: 60.0 GB'), pageText(nw));
    if (stop('nspdisks')) return;
    await nw.next(); await wait(40);
    t('Confirmation summarizes the pool and its disks', nw.page.id === 'confirm' && ['Name:Archive', 'Description:Old projects', 'Total capacity:60.0 GB', 'Primordial pool:Primordial', 'Hot Spare', 'Automatic'].every(x => pageText(nw).includes(x)), pageText(nw));
    wzButton(nw, 'Create').click(); await wait(400);
    t('Create makes the pool through WS.spaces, with the hot spare', SP.pool('Archive') && SP.pool('Archive').disks.length === 3 && SP.physicalDisk(extra[2]).usage === 'HotSpare' && SP.pool('Archive').description === 'Old projects');
    t('Results: both tasks completed, and the virtual disk option', (pageText(nw).match(/Completed/g) || []).length === 2 && !!fieldIn(nw.el, 'next-vd'));
    fieldIn(nw.el, 'next-vd').click();
    if (stop('nspresults')) return;
    wzButton(nw, 'Close').click(); await wait(120);
    t('"Create a virtual disk when this wizard closes" opens the New Virtual Disk Wizard', !!WS.wm.find('newvdisk') && !WS.wm.find('newpool'));
    WS.wm.find('newvdisk').close(); await wait(40);
    t('the new pool is selected on the page', WS.smfss.selection.pools === 'pool:Archive');

    let vw = null, vdd = null;
    WS.sm.newVirtualDisk({ pool: 'Archive', onCreate: (w, d) => { vw = w; vdd = d; } }); await wait(80);
    t('New Virtual Disk Wizard: the real steps', [...vw.el.querySelectorAll('.wz-step')].map(x => x.textContent).join('|') === 'Before You Begin|Storage Pool|Virtual Disk Name|Enclosure Awareness|Storage Layout|Resiliency Settings|Provisioning|Size|Confirmation|Results');
    await vw.next(); await wait(40);
    t('Storage Pool lists the pools with Archive chosen', vw.page.id === 'pool' && fieldIn(vw.page._el, 'pool-Archive').checked && pageText(vw).includes('DataPool'));
    await vw.next(); await wait(40);
    type(fieldIn(vw.page._el, 'vd-name'), 'Mirror1'); vw.next(); await wait(80);
    t('virtual disk names must be new', dlgText().includes('A virtual disk named Mirror1 already exists.'));
    await click('OK');
    type(fieldIn(vw.page._el, 'vd-name'), 'Archive1');
    t('storage tiers are offered but unavailable', pageText(vw).includes('Create storage tiers on this virtual disk'));
    await vw.next(); await wait(40);
    t('Enclosure Awareness is unavailable without enclosures', vw.page.id === 'enclosure' && pageText(vw).includes('Enable enclosure awareness'));
    await vw.next(); await wait(40);
    fieldIn(vw.page._el, 'opt-Parity').click(); await wait(20);
    t('choosing a layout shows its description', pageText(vw).includes('requires at least three disks'));
    vw.next(); await wait(80);
    t('parity needs three eligible disks (the hot spare doesn\'t count)', dlgText().includes('does not contain enough physical disks to support the Parity storage layout'), dlgText());
    await click('OK');
    fieldIn(vw.page._el, 'opt-Mirror').click();
    if (stop('vdlayout')) return;
    await vw.next(); await wait(40);
    t('Resiliency Settings: two-way mirror; three-way needs five disks', vw.page.id === 'resiliency' && fieldIn(vw.page._el, 'opt-1').checked && fieldIn(vw.page._el, 'opt-2').disabled);
    if (stop('vdresiliency')) return;
    await vw.next(); await wait(40);
    fieldIn(vw.page._el, 'opt-Fixed').click();
    await vw.next(); await wait(40);
    t('Size: the free space and what this layout can use', vw.page.id === 'size' && pageText(vw).includes('Free space in this storage pool:') && !fieldIn(vw.page._el, 'opt-max').disabled, pageText(vw));
    type(fieldIn(vw.page._el, 'size'), '30'); vw.next(); await wait(80);
    t('a fixed disk can\'t be bigger than the layout allows', dlgText().includes("can't be larger than the available capacity for this layout"), dlgText());
    await click('OK');
    fieldIn(vw.page._el, 'opt-max').click();
    if (stop('vdsize')) return;
    await vw.next(); await wait(40);
    t('Confirmation: two-way mirror, fixed, maximum size', vw.page.id === 'confirm' && ['Name:Archive1', 'Storage layout:Mirror', 'Resiliency type:Two-way mirror', 'Provisioning:Fixed', 'Maximum size'].every(x => pageText(vw).includes(x)), pageText(vw));
    wzButton(vw, 'Create').click(); await wait(400);
    const a1 = vd('Archive1');
    t('Create makes the mirror on the two Automatic disks and initializes its disk', a1 && a1.copies === 2 && a1.disks.length === 2 && !a1.disks.includes(extra[2]) && S.disk(a1.disk).style === 'GPT' && a1.size > 19 * GB);
    t('Results: three tasks and "Create a volume when this wizard closes" (on)', (pageText(vw).match(/Completed/g) || []).length === 3 && fieldIn(vw.el, 'next-volume').checked);
    if (stop('vdresults')) return;
    wzButton(vw, 'Close').click(); await wait(120);
    t('closing it opens the New Volume Wizard', !!WS.wm.find('newvolume'));
    WS.wm.find('newvolume').close(); await wait(40);

    WS.smfss.selection.pools = 'pool:Archive'; win.sm.go('fss:pools'); await wait(80);
    const arow = SM.rows.spaces(SP.pool('Archive')).find(r => r.name === 'Archive1');
    t('the virtual disk menu: Repair only when degraded', item(SM.menus.space(arow), 'Repair Virtual Disk').disabled && !item(SM.menus.space(arow), 'Extend Virtual Disk...').disabled);
    let ed = null;
    const edp = SM.extendVirtualDisk('Archive1', { onCreate: f => { ed = f; } }); await wait(60);
    type(fieldIn(shade(), 'size'), '25'); await click('OK');
    t('Extend Virtual Disk on a full pool: Not enough available capacity', dlgText().includes('Not enough available capacity'), dlgText());
    await click('OK'); await click('Cancel'); await edp; void ed;
    let ap = null;
    const app = SM.addPhysicalDisk('Archive', { onCreate: f => { ap = f; } }); await wait(60);
    t('Add Physical Disk lists the remaining poolable disk', dlgText().includes('Select one or more physical disks to add to the storage pool Archive:') && SP.primordial().poolable.length === 1);
    fieldIn(shade(), 'pd-' + SP.primordial().poolable[0]).click(); await click('OK'); await app; void ap;
    t('...and adds it', SP.pool('Archive').disks.length === 4 && !SP.primordial().poolable.length);
    item(SM.menus.space(arow), 'Extend Virtual Disk...').action(); await wait(60);
    type(fieldIn(shade(), 'size'), '25'); await click('OK'); await wait(60);
    t('one more disk is not enough: a 1-column two-way mirror grows onto two more disks', dlgText().includes('Not enough available capacity'), dlgText());
    await click('OK'); await click('Cancel');
    SP.setDisk(extra[2], { usage: 'AutoSelect' });
    item(SM.menus.space(arow), 'Extend Virtual Disk...').action(); await wait(60);
    type(fieldIn(shade(), 'size'), '25'); await click('OK'); await wait(60);
    t('with the hot spare made Automatic too, Extend Virtual Disk grows the mirror onto both', vd('Archive1').size === 25 * GB && vd('Archive1').disks.length === 4, vd('Archive1'));
    const pp = SM.poolProperties('Archive'); await wait(60);
    t('pool Properties: name, description, capacity and health', dlgText().includes('Archive Properties') && dlgText().includes('Health status:Healthy') && fieldIn(shade(), 'pool-desc').value === 'Old projects');
    type(fieldIn(shade(), 'pool-desc'), 'Closed projects'); await click('OK'); await pp;
    t('...and it saves the description', SP.pool('Archive').description === 'Closed projects');
    item(SM.menus.pool(SM.rows.pools().find(r => r.name === 'Archive')), 'Delete Storage Pool').action(); await wait(60);
    await click('Yes'); await wait(40);
    t('a pool with a virtual disk can\'t be deleted', dlgText().includes('contains virtual disks'));
    await click('OK');
    item(SM.menus.space(arow), 'Delete Virtual Disk').action(); await wait(60);
    t('Delete Virtual Disk warns that its volumes go too', dlgText().includes('also deletes its volumes'));
    await click('Yes'); await wait(40);
    item(SM.menus.pool(SM.rows.pools().find(r => r.name === 'Archive')), 'Delete Storage Pool').action(); await wait(60);
    await click('Yes'); await wait(40);
    t('then the pool goes and its disks return to the Primordial pool', !vd('Archive1') && !SP.pool('Archive') && SP.primordial().poolable.length === 4);

    /* ---------------- a failed disk in Server Manager ---------------- */
    const lost = vd('Mirror1').disks[1];
    SP.failDisk(lost);
    WS.smfss.selection.pools = 'pool:DataPool'; win.sm.go('fss:pools'); await wait(80);
    t('a failed disk: the pool and the mirror show Degraded, the disk Lost Communication', SM.rows.pools().find(r => r.name === 'DataPool').status === 'Degraded' && /Mirror1\s*Degraded/.test(tileText('VIRTUAL DISKS')) && tileText('PHYSICAL DISKS').includes('Lost Communication'), [tileText('VIRTUAL DISKS'), tileText('PHYSICAL DISKS')]);
    if (stop('degraded')) return;
    const mrow = SM.rows.spaces(SP.pool('DataPool')).find(r => r.name === 'Mirror1');
    t('Repair Virtual Disk is enabled', !item(SM.menus.space(mrow), 'Repair Virtual Disk').disabled);
    SP.addDisks('DataPool', [S.addDisk(20)], 'HotSpare'); // Parity1 already uses every disk, so its repair needs one more
    for (const r of SM.rows.spaces(SP.pool('DataPool'))) if (r.v.operationalStatus === 'Degraded') await item(SM.menus.space(r), 'Repair Virtual Disk').action();
    const lrow = SM.rows.disks(SP.pool('DataPool')).find(r => r.d.number === lost);
    item(SM.menus.disk(lrow), 'Remove Disk').action(); await wait(60); await click('Yes'); await wait(40);
    t('after Repair, Remove Disk takes the failed disk out', vd('Mirror1').operationalStatus === 'OK' && !SP.physicalDisk(lost) && SP.pool('DataPool').operationalStatus === 'OK', [vd('Mirror1').operationalStatus, dlgText()]);

    /* ---------------- Disks page, Disk Management ---------------- */
    win.sm.go('fss:disks'); await wait(60);
    const drow = WS.smfss.rows.disks().find(r => r.d.number === vd('Mirror1').disk);
    t('Disks shows the virtual disk\'s disk with its name and bus type Spaces', drow && drow.vdisk === 'Mirror1' && drow.bus === 'Spaces' && !WS.smfss.rows.disks().some(r => r.d.pool));
    WS.smfss.selection.disks = drow.id; win.sm.go('fss:disks'); await wait(60);
    t('...and its storage pool card', tileText('STORAGE POOL').includes('DataPool') && tileText('STORAGE POOL').includes('Storage Pool'), tileText('STORAGE POOL'));
    const dm = WS.diskmgmt.launch(); await wait(900);
    const dmText = dm.el.textContent;
    t('Disk Management shows the virtual disks\' disks, not the pooled physical disks', dmText.includes(`Disk ${vd('Mirror1').disk}`) && dmText.includes('Mirrored (M:)') && !dmText.includes('Disk 2 '), dmText.slice(0, 300));
    if (stop('diskmgmt')) return;
    dm.close();

    console.log(`RESULT ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.log('FAIL exception :: ' + (e && e.stack || e));
    console.log(`RESULT ${pass} passed, ${fail + 1} failed`);
  }
})();
