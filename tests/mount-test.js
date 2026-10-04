/* Volume mount points (folder access paths) and Server Manager's own Volume Properties and Manage Drive Letter and
 * Access Paths dialogs: the model, PowerShell, CMD (dir, mountvol, diskpart), Disk Management, the New Volume wizards,
 * File Explorer and Lab 17. Use a fresh profile.
 * &shot=volumes|props|health|letters|addpath|dmpaths|dmmount|nvfolder|explorer stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, S = WS.storage, GB = S.GB;
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
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.text(); };
  const dp = async inputs => { const tc = new WS.term.TextConsole({ inputs }); const cs = new WS.term.CmdSession({ console: tc }); await cs.execute('diskpart'); return tc.text(); };
  const check = c => WS.labs.evalCheck(c, WS.state);
  let v;
  const fsErr = fn => { try { fn(); return null; } catch (e) { return e.code; } };
  try {
    await wait(250);

    /* ---------------- the model ---------------- */
    S.setOnline(1, true); S.initialize(1, 'GPT');
    const created = S.newVolume(1, { size: 10 * GB, letter: null, fs: 'NTFS', label: 'Data' });
    const pn = created.volume.partition;
    t('a volume can be created with no drive letter', created.ok && !created.volume.letter && created.volume.paths.length === 0);
    WS.fs.mkdir('C:\\Mount\\Data');
    let r = S.addAccessPath(1, pn, 'C:\\Mount\\Data');
    v = S.volumeAt(1, pn);
    t('addAccessPath mounts it in an empty folder', r.ok && r.path === 'C:\\Mount\\Data\\' && v.paths.join() === 'C:\\Mount\\Data\\', { r, paths: v.paths });
    t('its access paths: the folder, then the volume GUID path', v.accessPaths.length === 2 && v.accessPaths[0] === 'C:\\Mount\\Data\\' && /^\\\\\?\\Volume\{[0-9a-f-]+\}\\$/.test(v.accessPaths[1]), v.accessPaths);
    WS.fs.writeFile('C:\\Mount\\Data\\report.txt', 'quarterly numbers');
    t('files written through the folder land on the mounted volume', WS.fs.readFile('C:\\Mount\\Data\\report.txt') === 'quarterly numbers' && S.disk(1).partitions.find(p => p.number === pn).files.children['report.txt']);
    t('the C: folder itself stays empty (the files are not on C:)', Object.keys(WS.fs.folderNode('C:\\Mount\\Data').children).length === 0);
    const st = WS.fs.stat('C:\\Mount\\Data');
    t('stat reports the folder as a junction to the volume', st && st.type === 'dir' && st.name === 'Data' && st.junction === v.path, st);
    t('listing C:\\Mount shows the mount point as a junction', WS.fs.list('C:\\Mount').some(x => x.name === 'Data' && x.junction));
    t('listing the mount point lists the volume', WS.fs.list('C:\\Mount\\Data').map(x => x.name).join() === 'report.txt');
    WS.fs.mkdir('C:\\Mount\\Data\\Q1');
    t('mkdir inside the mount creates folders on the volume', !!S.disk(1).partitions.find(p => p.number === pn).files.children.q1);
    t('volumeByPath finds the volume by its folder (any case, with or without the slash)', S.volumeByPath('c:\\mount\\data').partition === pn && S.volumeByPath('C:\\Mount\\Data\\').partition === pn);
    t('used space counts files on a volume with no letter', S.volumeAt(1, pn).used > S.usedBytes({ fs: 'NTFS', size: 10 * GB, flags: [] }) - 1);
    // errors
    WS.fs.mkdir('C:\\Mount\\Full'); WS.fs.writeFile('C:\\Mount\\Full\\x.txt', 'x');
    t('a folder that is not empty is refused', S.addAccessPath(1, pn, 'C:\\Mount\\Full').code === 'NotEmpty');
    t('a folder that does not exist is refused', S.addAccessPath(1, pn, 'C:\\Mount\\Nope').code === 'PathNotFound');
    t('a folder that is already a mount point is refused', S.addAccessPath(1, pn, 'C:\\Mount\\Data').code === 'InUse');
    t('a volume cannot be mounted in itself', S.addAccessPath(1, pn, 'C:\\Mount\\Data\\Q1').code === 'SameVolume');
    t('the system partitions cannot be mounted', !S.addAccessPath(0, 1, 'C:\\Mount\\Full').ok && !S.addAccessPath(0, 4, 'C:\\Mount\\Full').ok);
    const refs = S.newVolume(1, { size: 5 * GB, letter: 'R', fs: 'ReFS', label: 'Refs' });
    WS.fs.mkdir('R:\\Mnt');
    t('only folders on NTFS volumes can hold a mount point', S.addAccessPath(1, pn, 'R:\\Mnt').code === 'NotNtfs');
    S.deletePartition(1, refs.volume.partition);
    // a drive-letter path assigns a letter
    r = S.addAccessPath(1, pn, 'E:\\');
    t('a drive-letter access path assigns the letter, and the files follow', r.ok && S.volumeAt(1, pn).letter === 'E' && WS.fs.readFile('E:\\report.txt') === 'quarterly numbers' && WS.fs.readFile('C:\\Mount\\Data\\report.txt') === 'quarterly numbers');
    t('access paths list the letter first', S.volumeAt(1, pn).accessPaths.slice(0, 2).join('|') === 'E:\\|C:\\Mount\\Data\\');
    r = S.removeAccessPath(1, pn, 'E:\\');
    t('removing the letter path keeps the folder path working', r.ok && !S.volumeAt(1, pn).letter && WS.fs.readFile('C:\\Mount\\Data\\report.txt') === 'quarterly numbers');
    // renaming moves the access path
    WS.fs.rename('C:\\Mount', 'Mounts');
    t('renaming a parent folder changes the access path', S.volumeAt(1, pn).paths.join() === 'C:\\Mounts\\Data\\' && WS.fs.readFile('C:\\Mounts\\Data\\report.txt') === 'quarterly numbers');
    WS.fs.rename('C:\\Mounts\\Data', 'Finance');
    t('renaming the mount point itself renames the path, not the volume', S.volumeAt(1, pn).paths.join() === 'C:\\Mounts\\Finance\\' && S.volumeAt(1, pn).label === 'Data');
    WS.fs.rename('C:\\Mounts\\Finance', 'Data'); WS.fs.rename('C:\\Mounts', 'Mount');
    t('a mount point cannot be moved', fsErr(() => WS.fs.move('C:\\Mount\\Data', 'C:\\Moved')) === 'AccessDenied');
    WS.fs.copy('C:\\Mount\\Data', 'C:\\DataCopy', null, { recursive: true });
    t('copying a mount point copies the files into an ordinary folder', WS.fs.readFile('C:\\DataCopy\\report.txt') === 'quarterly numbers' && !WS.fs.stat('C:\\DataCopy').junction);
    // offline
    S.setOnline(1, false);
    t('with the disk offline the folder says the device is not ready', fsErr(() => WS.fs.list('C:\\Mount\\Data')) === 'NotReady');
    S.setOnline(1, true);
    t('online again, the files are back', WS.fs.readFile('C:\\Mount\\Data\\report.txt') === 'quarterly numbers');
    // removing the folder removes the mount point (the files stay on the volume)
    WS.fs.mkdir('C:\\Mount\\Second');
    S.addAccessPath(1, pn, 'C:\\Mount\\Second');
    t('a volume can have several folder paths', S.volumeAt(1, pn).paths.join('|') === 'C:\\Mount\\Data\\|C:\\Mount\\Second\\');
    WS.fs.remove('C:\\Mount\\Second');
    t('deleting a mount point folder (rd) removes only that path', S.volumeAt(1, pn).paths.join() === 'C:\\Mount\\Data\\' && !WS.fs.stat('C:\\Mount\\Second') && WS.fs.readFile('C:\\Mount\\Data\\report.txt') === 'quarterly numbers');
    t('removeAccessPath on a folder that is not a mount point fails', S.removeAccessPath(1, pn, 'C:\\Mount\\Full').code === 'NotFound');

    /* ---------------- PowerShell ---------------- */
    let out = await run('(Get-Partition -DiskNumber 1 -PartitionNumber ' + pn + ').AccessPaths');
    t('Get-Partition AccessPaths lists the folder and the GUID path', out.includes('C:\\Mount\\Data\\') && out.includes('\\\\?\\Volume{'), out);
    out = await run('Get-ChildItem C:\\Mount');
    t('Get-ChildItem shows the mount point with the l (reparse point) mode', /d----l\s+.*Data/.test(out) && /d-----\s+.*Full/.test(out), out);
    out = await run('(Get-Item C:\\Mount\\Data).LinkType');
    t('Get-Item reports LinkType Junction', out.trim() === 'Junction', out);
    WS.fs.mkdir('C:\\Logs\\Archive');
    out = await run(`Add-PartitionAccessPath -DiskNumber 1 -PartitionNumber ${pn} -AccessPath C:\\Logs\\Archive`);
    t('Add-PartitionAccessPath -AccessPath mounts the volume in a folder', !out.trim() && S.volumeAt(1, pn).paths.includes('C:\\Logs\\Archive\\'), out);
    out = await run(`Add-PartitionAccessPath -DiskNumber 1 -PartitionNumber ${pn} -AccessPath C:\\Mount\\Full`);
    t('a folder that is not empty: "The access path is not valid."', out.includes('The access path is not valid.') && out.includes('Add-PartitionAccessPath'), out);
    out = await run(`Get-Partition -DiskNumber 1 -PartitionNumber ${pn} | Remove-PartitionAccessPath -AccessPath C:\\Logs\\Archive\\`);
    t('Remove-PartitionAccessPath (piped partition) removes it and leaves the folder', !out.trim() && !S.volumeAt(1, pn).paths.includes('C:\\Logs\\Archive\\') && WS.fs.isDir('C:\\Logs\\Archive'), out);
    out = await run(`Add-PartitionAccessPath -DiskNumber 1 -PartitionNumber ${pn} -AssignDriveLetter`);
    const autoLetter = S.volumeAt(1, pn).letter;
    t('Add-PartitionAccessPath -AssignDriveLetter gives it the next free letter', !out.trim() && autoLetter === 'E', { out, autoLetter });
    out = await run(`Remove-PartitionAccessPath -DriveLetter E -AccessPath E:\\`);
    t('Remove-PartitionAccessPath -AccessPath E:\\ removes the letter', !out.trim() && !S.volumeAt(1, pn).letter, out);

    /* ---------------- CMD: dir, mountvol, diskpart ---------------- */
    out = await crun('dir C:\\Mount');
    t('dir shows <JUNCTION> with the \\??\\Volume{GUID}\\ target', /<JUNCTION>\s+Data \[\\\?\?\\Volume\{[0-9a-f-]+\}\\\]/.test(out) && /<DIR>\s+Full/.test(out), out);
    out = await crun('mountvol');
    t('mountvol lists every volume with its mount points', out.includes('Creates, deletes, or lists a volume mount point.') && out.includes('Possible values for VolumeName along with current mount points are:')
      && out.includes(`${v.path}\n        C:\\Mount\\Data\\`) && out.includes('        C:\\') && out.includes('*** NO MOUNT POINTS ***'), out);
    out = await crun('mountvol C:\\Mount\\Data /L');
    t('mountvol <dir> /L prints the volume name', out.trim() === v.path, out);
    out = await crun('mountvol C:\\Mount\\Full /L');
    t('mountvol /L on an ordinary folder: not a reparse point', out.includes('The file or directory is not a reparse point.'), out);
    out = await crun('mountvol C:\\Mount\\Data /D');
    t('mountvol /D removes the mount point', !out.trim() && !S.volumeAt(1, pn).paths.length, out);
    out = await crun(`mountvol C:\\Mount\\Data ${v.path}`);
    t('mountvol <dir> <VolumeName> mounts it again', !out.trim() && S.volumeAt(1, pn).paths.join() === 'C:\\Mount\\Data\\', out);
    out = await crun(`mountvol C:\\Mount\\Full ${v.path}`);
    t('mountvol into a folder that is not empty: The directory is not empty.', out.includes('The directory is not empty.'), out);
    WS.fs.mkdir('C:\\Mount\\Dp');
    out = await dp(['list volume', `select volume ${S.volumes().filter(x => x.type !== 'Reserved').length}`, 'assign mount=C:\\Mount\\Dp', 'list volume', 'remove mount=C:\\Mount\\Dp', 'exit']);
    t('diskpart list volume prints a folder path under its volume', /Volume \d+\s+Data\s+NTFS\s+Partition\s+10 GB\s+Healthy\s*\n {4}C:\\Mount\\Data\\/.test(out), out);
    t('diskpart assign mount= and remove mount= change the folder paths', (out.match(/DiskPart successfully assigned the drive letter or mount point\./g) || []).length === 1 && out.includes('DiskPart successfully removed the drive letter or mount point.') && out.includes('    C:\\Mount\\Dp\\') && !S.volumeAt(1, pn).paths.includes('C:\\Mount\\Dp\\'), out);

    /* ---------------- Server Manager: Volumes, Properties, Manage Drive Letter and Access Paths ---------------- */
    const opts = sel => [...sel.options].map(o => o.value);
    const pageText = w => w.page._el.textContent;
    const wzButton = (w, label) => [...w.el.querySelectorAll('.wz-buttons button')].find(b => b.textContent.trim() === label);
    const item = (items, n) => items.find(x => x && x.label === n);
    const win = WS.sm.open('fss:volumes'); await wait(120);
    const rowId = `vol:1:${pn}`;
    const dataRow = () => WS.smfss.rows.volumes().find(r => r.id === rowId);
    t('Volumes shows a folder-mounted volume by its folder path', dataRow().volume === 'C:\\Mount\\Data' && win.el.querySelector('.sm-content').textContent.includes('C:\\Mount\\Data'), dataRow().volume);
    const domVols = [...win.el.querySelectorAll('.sm-content .lv-row')].map(r => r.textContent);
    const at = s => domVols.findIndex(x => x.startsWith(s));
    t('...after the lettered volumes and before the GUID-only ones', at('C:') >= 0 && at('C:') < at('C:\\Mount\\Data') && at('C:\\Mount\\Data') < at('\\\\?\\Volume{'), domVols.map(x => x.slice(0, 24)));
    const vm = WS.smfss.menus.volume(dataRow());
    t('its menu offers Properties and Manage Drive Letter and Access Paths...', !item(vm, 'Properties').disabled && !item(vm, 'Manage Drive Letter and Access Paths...').disabled);
    if (stop('volumes')) return;

    let vp = null, api = null;
    const vpp = WS.smfss.volumeProperties(rowId, { onCreate: (f, a) => { vp = f; api = a; } }); await wait(80);
    t('Volume Properties is Server Manager\'s own dialog, titled by the volume', vp.box.querySelector('.dlg-ttext').textContent === 'C:\\Mount\\Data Properties' && [...vp.box.querySelectorAll('.nav > div')].map(x => x.textContent).join() === 'General,Health');
    t('General: volume, server, label, file system, allocation unit, access paths and capacity', ['Volume:C:\\Mount\\Data', 'Server name:' + WS.sys.name, 'File system:NTFS', 'Allocation unit size:4 KB', 'Drive letter and access paths:C:\\Mount\\Data\\', 'Capacity:10.0 GB', '% used'].every(x => dlgText().includes(x)) && fieldIn(shade(), 'vol-label').value === 'Data', dlgText());
    t('Apply starts disabled', button('Apply').disabled);
    if (stop('props')) return;
    type(fieldIn(shade(), 'vol-label'), 'Finance Data');
    t('typing a label enables Apply', !button('Apply').disabled);
    api.show('health'); await wait(20);
    t('Health: Healthy and OK', dlgText().includes('Health status:Healthy') && dlgText().includes('Operational status:OK'));
    if (stop('health')) return;
    await click('OK'); const applied = await vpp;
    t('OK sets the label of a volume with no drive letter', applied === true && S.volumeAt(1, pn).label === 'Finance Data', S.volumeAt(1, pn).label);

    let md = null;
    let mdp = WS.smfss.manageAccessPaths(rowId, { onCreate: f => { md = f; } }); await wait(80);
    t('Manage Drive Letter and Access Paths: no letter, and the folder listed', dlgText().includes(`Assign a drive letter or access paths to volume C:\\Mount\\Data on ${WS.sys.name}.`) && !fieldIn(shade(), 'use-letter').checked && fieldIn(shade(), 'letter').disabled && opts(fieldIn(shade(), 'paths')).join() === 'C:\\Mount\\Data\\', dlgText());
    if (stop('letters')) return;
    WS.fs.mkdir('C:\\Finance\\Data');
    md.addPath('C:\\Finance\\Data');
    fieldIn(shade(), 'use-letter').click(); type(fieldIn(shade(), 'letter'), 'F');
    t('Add... and the letter are staged, not applied', opts(fieldIn(shade(), 'paths')).join('|') === 'C:\\Mount\\Data\\|C:\\Finance\\Data\\' && !fieldIn(shade(), 'letter').disabled && !S.volumeAt(1, pn).letter);
    if (stop('addpath')) return;
    await click('OK'); await mdp;
    v = S.volumeAt(1, pn);
    t('OK adds the folder path and the drive letter', v.letter === 'F' && v.paths.join('|') === 'C:\\Finance\\Data\\|C:\\Mount\\Data\\' && WS.fs.readFile('F:\\report.txt') === 'quarterly numbers' && WS.fs.readFile('C:\\Finance\\Data\\report.txt') === 'quarterly numbers', v);
    t('with a letter the volume is listed as F:', dataRow().volume === 'F:');
    mdp = WS.smfss.manageAccessPaths(rowId, { onCreate: f => { md = f; } }); await wait(80);
    t('it opens with the letter checked and both paths', fieldIn(shade(), 'use-letter').checked && fieldIn(shade(), 'letter').value === 'F' && opts(fieldIn(shade(), 'paths')).length === 2);
    md.removePath('C:\\Finance\\Data'); md.addPath('C:\\Mount\\Full');
    await click('OK');
    t('a folder that is not empty is refused with Server Manager\'s message', dlgText().includes('The folder C:\\Mount\\Full is not empty. Select an empty folder on an NTFS volume.'), dlgText());
    await click('OK');
    md.removePath('C:\\Mount\\Full'); fieldIn(shade(), 'use-letter').click();
    await click('OK'); await mdp;
    v = S.volumeAt(1, pn);
    t('removing a path and clearing the letter (the folder stays, now an ordinary one)', !v.letter && v.paths.join() === 'C:\\Mount\\Data\\' && WS.fs.isDir('C:\\Finance\\Data') && !WS.fs.stat('C:\\Finance\\Data').junction && !WS.fs.hasDrive('F'), v);

    /* ---------------- New Volume Wizard: The following folder ---------------- */
    WS.fs.mkdir('C:\\Mount\\Projects');
    let nv = null, nvd = null;
    WS.sm.newVolume({ disk: 1, onCreate: (w, d) => { nv = w; nvd = d; } }); await wait(80);
    await nv.next(); await wait(40);
    await nv.next(); await wait(40);
    type(fieldIn(nv.page._el, 'size'), '10'); await nv.next(); await wait(40);
    t('the wizard reaches Drive Letter or Folder', nv.page.id === 'letter', nv.page.id);
    fieldIn(nv.page._el, 'assign-folder').click();
    type(fieldIn(nv.page._el, 'folder'), 'C:\\Mount\\Full'); nv.next(); await wait(80);
    t('a folder that is not empty is refused', dlgText().includes('The folder C:\\Mount\\Full is not empty.'), dlgText());
    await click('OK');
    type(fieldIn(nv.page._el, 'folder'), 'c:\\mount\\projects');
    if (stop('nvfolder')) return;
    await nv.next(); await wait(40);
    type(fieldIn(nv.page._el, 'label'), 'Projects'); await nv.next(); await wait(40);
    t('Confirmation shows the folder (with its real casing)', nv.page.id === 'confirm' && pageText(nv).includes('Drive letter or folder:C:\\Mount\\Projects\\'), pageText(nv));
    wzButton(nv, 'Create').click(); await wait(400);
    const proj = S.volumeByPath('C:\\Mount\\Projects');
    t('Create mounts the new volume in the folder (all five tasks complete)', (pageText(nv).match(/Completed/g) || []).length === 5 && proj && proj.label === 'Projects' && !proj.letter && nvd.volume.paths.join() === 'C:\\Mount\\Projects\\', pageText(nv));
    wzButton(nv, 'Close').click(); await wait(40);

    /* ---------------- Disk Management ---------------- */
    let cl = null;
    const clp = WS.diskmgmt.changeLetter(`part:1:${proj.partition}`, { onCreate: f => { cl = f; } }); await wait(80);
    t('Change Drive Letter and Paths lists the folder path; Change is only for letters', opts(fieldIn(shade(), 'paths')).join() === 'C:\\Mount\\Projects\\' && button('Change...').disabled && !button('Remove').disabled && !button('Add...').disabled);
    if (stop('dmpaths')) return;
    await click('Add...');
    t('Add: both a letter and an empty NTFS folder are offered', !fieldIn(shade(), 'assign').disabled && !fieldIn(shade(), 'mount').disabled && fieldIn(shade(), 'folder').disabled);
    fieldIn(shade(), 'mount').click();
    t('choosing the folder enables the path and Browse...', !fieldIn(shade(), 'folder').disabled && fieldIn(shade(), 'letter').disabled && !button('Browse...').disabled);
    type(fieldIn(shade(), 'folder'), 'C:\\Mount\\Full'); await click('OK');
    t('Disk Management refuses a folder that is not empty', dlgText().includes('The folder you specified is not empty.'), dlgText());
    await click('OK');
    WS.fs.mkdir('C:\\Mount\\Projects2');
    type(fieldIn(shade(), 'folder'), 'C:\\Mount\\Projects2');
    if (stop('dmmount')) return;
    await click('OK');
    t('Add mounts it and the list shows both paths', opts(fieldIn(shade(), 'paths')).join('|') === 'C:\\Mount\\Projects\\|C:\\Mount\\Projects2\\', opts(fieldIn(shade(), 'paths')));
    cl.select('C:\\Mount\\Projects\\'); await click('Remove');
    t('removing a path asks about drive paths', dlgText().includes('Are you sure you want to remove this drive path?'));
    await click('Yes');
    t('...and removes only that path', S.volumeAt(1, proj.partition).paths.join() === 'C:\\Mount\\Projects2\\' && opts(fieldIn(shade(), 'paths')).join() === 'C:\\Mount\\Projects2\\');
    await click('Add...');
    t('Add on a volume with no letter still offers a letter', !fieldIn(shade(), 'assign').disabled);
    type(fieldIn(shade(), 'letter'), 'P'); await click('OK');
    t('a letter can be added next to the folder path', S.volumeAt(1, proj.partition).letter === 'P' && opts(fieldIn(shade(), 'paths')).join('|') === 'P:|C:\\Mount\\Projects2\\');
    await click('Add...');
    t('with a letter, Add offers only a folder', fieldIn(shade(), 'assign').disabled && fieldIn(shade(), 'mount').checked);
    await click('Cancel');
    await click('OK'); await clp;

    WS.fs.mkdir('C:\\Mount\\Simple');
    let wz = null;
    const nsp = WS.diskmgmt.newSimpleVolume(1, { onCreate: w => { wz = w; } }); await wait(80);
    await click('Next >', wz.el); await click('Next >', wz.el);
    t('New Simple Volume: the folder box is off until "Mount in..." is chosen', wz.page.id === 'letter' && fieldIn(wz.el, 'folder').disabled && !fieldIn(wz.el, 'letterMode-mount').disabled);
    fieldIn(wz.el, 'letterMode-mount').click(); type(fieldIn(wz.el, 'folder'), 'C:\\Mount\\Nope'); await click('Next >', wz.el);
    t('a folder that does not exist is refused', dlgText().includes('The path you specified does not exist.'), dlgText());
    await click('OK');
    type(fieldIn(wz.el, 'folder'), 'C:\\Mount\\Simple'); await click('Next >', wz.el);
    type(fieldIn(wz.el, 'label'), 'Simple'); await click('Next >', wz.el);
    t('the summary shows the folder', wz.el.textContent.includes('Drive letter or path: C:\\Mount\\Simple'), wz.el.textContent.slice(0, 400));
    await click('Finish', wz.el); await nsp; await wait(100);
    const simple = S.volumeByPath('C:\\Mount\\Simple');
    t('the New Simple Volume Wizard mounts the volume in the folder', !!simple && simple.label === 'Simple' && !simple.letter);

    /* ---------------- File Explorer ---------------- */
    const ex = WS.apps.launch('explorer', { path: 'C:\\Mount' }); await wait(120);
    const exRow = n => [...ex.el.querySelectorAll('.lv-row')].find(r => r.textContent.startsWith(n));
    t('Explorer shows mount points as Mounted Volume, folders as File folder', exRow('Data') && exRow('Data').textContent.includes('Mounted Volume') && exRow('Full').textContent.includes('File folder'));
    if (stop('explorer')) return;
    ex.explorer.properties(['Data']); await wait(80);
    t('a mount point\'s Properties: Type Mounted Volume and the target volume', dlgText().includes('Mounted Volume') && dlgText().includes('Target:Finance Data'), dlgText());
    await click('Cancel');
    ex.explorer.go('C:\\Mount\\Data'); await wait(60);
    t('opening it lists the volume\'s files', ex.explorer.items().includes('report.txt'));
    ex.close();

    /* ---------------- deleting a mounted volume ---------------- */
    S.deletePartition(1, simple.partition);
    t('deleting the volume leaves its mount folder as an ordinary empty folder', WS.fs.isDir('C:\\Mount\\Simple') && !WS.fs.stat('C:\\Mount\\Simple').junction && WS.fs.list('C:\\Mount\\Simple').length === 0);

    /* ---------------- Lab 17 checks ---------------- */
    t('volume check: path + hasLetter', check({ volume: { path: 'C:\\Mount\\Data', label: 'Finance Data', hasLetter: false } }) && !check({ volume: { path: 'C:\\Mount\\Data', hasLetter: true } }));
    t('volume check: path + letter', check({ volume: { path: 'C:\\Mount\\Projects2', letter: 'P' } }) && !check({ volume: { path: 'C:\\Mount\\Projects2', letter: 'Q' } }) && !check({ volume: { path: 'C:\\Mount\\Full' } }));
    t('Lab 17 is registered with four objectives', WS.labs.get('lab17-mount-points') && WS.labs.get('lab17-mount-points').objectives.map(o => o.id).join() === 'archive,logs,stale,scratch');

    console.log(`RESULT ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.log('FAIL exception :: ' + (e && e.stack || e));
    console.log(`RESULT ${pass} passed, ${fail + 1} failed`);
  }
})();
