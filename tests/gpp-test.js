/* Group Policy Preferences Drive Maps and mapped network drives: UNC paths, WS.netuse (net use, New-PSDrive -Persist,
 * *-SmbMapping, pushd), the Drive Maps model and its processing, the editor's list / New Drive Properties / Targeting
 * Editor, the reports, File Explorer's Network locations and Lab 16. Use a fresh profile (it rewrites the lab state).
 * &shot=<mode> stops at that point for a screenshot: list, dialog, common, targeting, explorer, report. */
(async function () {
  'use strict';
  const WS = window.WS, G = WS.gpo, P = WS.gpp, NU = WS.netuse;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const title = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
  const button = (label, scope = shade()) => [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(70); };
  const input = (key, scope = shade()) => scope.querySelector(`[data-field="${CSS.escape(key)}"]`);
  const fill = (key, value, scope) => {
    const el = input(key, scope); if (!el) throw new Error('Missing field: ' + key);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(['checkbox', 'radio'].includes(el.type) || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const tab = async label => { const b = [...shade().querySelectorAll('.ps-tab')].find(x => x.textContent === label); b.click(); await wait(50); };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const item = (items, name) => { const it = items.filter(Boolean).find(x => x.label && WS.ui.plain(x.label) === name); if (!it) throw new Error('Missing menu item: ' + name); return it; };
  const psc = new WS.term.TextConsole(), ps = new WS.ps.Session({ console: psc });
  const run = async c => { const out = []; await ps.execute(c, { capture: out }); return out; };
  const runText = async c => { psc.clear(); const out = []; await ps.execute(c, { capture: out }); return WS.ps.formatOut(out, 120).join('\n') + '\n' + psc.text(); };
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.text(); };
  const check = c => WS.labs.evalCheck(c, WS.state);
  const evts = (log, id) => (WS.state.events.logs[log] || []).filter(e => e.id === id);
  try {
    await wait(250);
    const ME = WS.sys.name;
    const unc = share => `\\\\${ME}\\${share}`;

    /* ================================================================ UNC paths and mapped drives */
    WS.fs.ensureDir('C:\\Shares\\Sales\\Reports'); WS.fs.writeFile('C:\\Shares\\Sales\\Q3.txt', 'Q3 numbers');
    WS.fs.ensureDir('C:\\Shares\\Public'); WS.fs.ensureDir('C:\\Shares\\IT'); WS.fs.ensureDir('C:\\Shares\\Old');
    for (const n of ['Sales', 'Public', 'IT', 'Old']) WS.smb.newShare({ name: n, path: 'C:\\Shares\\' + n });
    t('UNC path lists the share', WS.fs.list(unc('Sales')).map(x => x.name).join() === 'Reports,Q3.txt');
    t('UNC path reads a file and keeps the share name casing', WS.fs.readFile(unc('sales') + '\\q3.txt') === 'Q3 numbers' && WS.fs.full(`\\\\${ME}\\sales\\reports`) === `\\\\${ME}\\Sales\\Reports`);
    t('localhost and the server\u2019s address reach the same share', WS.fs.exists('\\\\localhost\\Sales\\Q3.txt') && WS.fs.exists(`\\\\${WS.net.primaryIp()}\\Sales\\Q3.txt`));
    let r = NU.resolveUnc(`\\\\${ME}\\Nope`);
    t('unknown share: The network name cannot be found. (67)', !r.ok && r.sys === 67 && r.hr === '0x80070043', r);
    r = NU.resolveUnc('\\\\FS99\\Data');
    t('unknown server: The network path was not found. (53)', !r.ok && r.sys === 53 && r.hr === '0x80070035', r);
    let threw = null; try { WS.fs.list('\\\\FS99\\Data'); } catch (e) { threw = e; }
    t('WS.fs throws NetPath for an unreachable server', threw && threw.code === 'NetPath');

    let out = await crun('net use');
    t('net use with no connections', out.includes('New connections will be remembered.') && out.includes('There are no entries in the list.'));
    out = await crun(`net use S: ${unc('Sales')}`);
    t('net use S: \\\\server\\Sales', out.includes('The command completed successfully.') && NU.get('S') && NU.get('S').remote === unc('Sales'), out);
    t('S:\\ reads through the mapping', WS.fs.readFile('S:\\Q3.txt') === 'Q3 numbers' && WS.fs.full('s:\\reports') === 'S:\\Reports');
    WS.fs.writeFile('S:\\Reports\\new.txt', 'via S:');
    t('writes through the mapping land in the shared folder', WS.fs.readFile('C:\\Shares\\Sales\\Reports\\new.txt') === 'via S:');
    out = await crun('net use');
    t('net use lists it: OK  S:  \\\\server\\Sales  Microsoft Windows Network', /OK\s+S:\s+\\\\\S+\\Sales\s+Microsoft Windows Network/.test(out) && out.includes('Status       Local     Remote'), out);
    out = await crun(`net use S: ${unc('Public')}`);
    t('the letter in use: System error 85', out.includes('System error 85 has occurred.') && out.includes('The local device name is already in use.'), out);
    out = await crun('net use C: \\\\' + ME + '\\Public');
    t('a local volume letter is in use too', out.includes('System error 85'));
    out = await crun('net use T: \\\\FS99\\Data');
    t('unreachable server: System error 53', out.includes('System error 53 has occurred.') && out.includes('The network path was not found.'), out);
    out = await crun(`net use * ${unc('Public')} /persistent:no`);
    t('net use * picks Z: and says so', out.includes(`Drive Z: is now connected to ${unc('Public')}.`) && NU.get('Z') && NU.get('Z').persistent === false, out);
    out = await crun('net use S:');
    t('net use S: shows the connection', out.includes('Local name        S:') && out.includes('Resource type     Disk'), out);
    out = await crun('S:');
    t('cmd: S: switches to the mapped drive', cmd.cwd === 'S:\\', cmd.cwd);
    out = await crun('dir');
    t('cmd: dir on the mapped drive', out.includes('Q3.txt') && out.includes('Reports'), out);
    out = await crun('C:');
    out = await crun(`cd ${unc('Sales')}`);
    t('cmd: CMD does not support UNC paths as current directories.', out.includes('CMD does not support UNC paths as current directories.') && cmd.cwd.startsWith('C:'), out);
    out = await crun(`pushd ${unc('IT')}`);
    const pl = cmd.cwd[0];
    t('cmd: pushd \\\\server\\share maps a temporary drive', /^[A-Z]:\\$/.test(cmd.cwd) && NU.get(pl) && NU.get(pl).remote === unc('IT'), [cmd.cwd, NU.list()]);
    await crun('popd');
    t('cmd: popd removes it again', cmd.cwd.startsWith('C:') && !NU.get(pl));
    out = await crun(`dir ${unc('Sales')}`);
    t('cmd: dir \\\\server\\share', out.includes(`Directory of ${unc('Sales')}`) && out.includes('Q3.txt'), out);
    WS.sys.onBoot(); await wait(60);
    t('a restart keeps remembered connections and drops the others', !!NU.get('S') && !NU.get('Z'));
    out = await crun('net use Z: /delete');
    t('net use Z: /delete when it is gone: 2250', out.includes('The network connection could not be found.') && out.includes('NET HELPMSG 2250'), out);
    out = await crun('net use S: /delete');
    t('net use S: /delete', out.includes('S: was deleted successfully.') && !NU.get('S'), out);

    /* ---------------- PowerShell */
    out = await runText(`New-PSDrive -Name S -PSProvider FileSystem -Root ${unc('Sales')} -Persist`);
    t('New-PSDrive -Persist maps a network drive', NU.get('S') && NU.get('S').persistent && !NU.get('S').psOnly && out.includes(unc('Sales')), out);
    out = await runText('Get-PSDrive');
    t('Get-PSDrive lists it with the share as its root', new RegExp(`S\\s+.*FileSystem\\s+\\\\\\\\${ME}\\\\Sales`, 'i').test(out), out);
    out = await runText('Get-ChildItem S:\\ | Select-Object -ExpandProperty Name');
    t('Get-ChildItem S:\\', out.includes('Q3.txt'), out);
    out = await runText(`Set-Location ${unc('Sales')}; (Get-Location).Path; Set-Location C:\\`);
    t('PowerShell can stand in a UNC path', out.includes(unc('Sales')), out);
    out = await runText('New-PSDrive -Name Q -PSProvider FileSystem -Root C:\\Shares -Persist');
    t('-Persist needs a remote root', out.includes('the root must be a file system location on a remote computer'), out);
    out = await runText('Get-SmbMapping');
    t('Get-SmbMapping: Status, Local Path, Remote Path', /Status\s+Local Path Remote Path/.test(out) && new RegExp(`OK\\s+S:\\s+\\\\\\\\${ME}\\\\Sales`, 'i').test(out), out);
    await run(`New-SmbMapping -LocalPath T: -RemotePath ${unc('Public')} -Persistent $true`);
    t('New-SmbMapping', NU.get('T') && NU.get('T').remote === unc('Public'));
    out = await runText(`New-SmbMapping -LocalPath T: -RemotePath ${unc('IT')}`);
    t('New-SmbMapping on a letter in use fails as SMB does', out.includes('The local device name is already in use.'), out);
    await run('Remove-SmbMapping -LocalPath T: -Force');
    await run('Remove-PSDrive S');
    t('Remove-SmbMapping and Remove-PSDrive', !NU.get('T') && !NU.get('S'));
    await run(`New-PSDrive -Name W -PSProvider FileSystem -Root ${unc('IT')}`);
    out = await crun('net use');
    t('a New-PSDrive without -Persist is PowerShell-only (not in net use)', !!NU.get('W') && NU.get('W').psOnly && out.includes('There are no entries in the list.'), out);
    await run('Remove-PSDrive W');

    /* ================================================================ the Drive Maps model */
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
    const promo = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'RestoreP@ss2025!', noReboot: true });
    t('promotion succeeds', promo.ok, promo);
    WS.ad.createOU({ name: 'IT' });
    WS.ad.createGroup({ name: 'IT Staff', scope: 'Global', category: 'Security', parent: 'IT' });
    WS.ad.createGroup({ name: 'Sales Staff', scope: 'Global', category: 'Security' });
    const g = G.create('Drive Mappings').gpo;
    G.link(g, WS.ad.root());
    t('a new GPO is Not Applied (Empty) for the user', G.rsop().user.filtered.some(e => e.name === 'Drive Mappings' && e.reason === 'Not Applied (Empty)'));
    r = P.newDrive(g, { action: 'U', path: '', letter: 'S' });
    t('a drive item needs a location', !r.ok && /location/i.test(r.error), r);
    r = P.newDrive(g, { action: 'U', path: 'C:\\Shares\\Sales', letter: 'S' });
    t('the location must be a UNC path', !r.ok && /UNC/.test(r.error), r);
    const v0 = g.userVersion;
    r = P.newDrive(g, { action: 'U', path: unc('Sales'), letter: 'S', label: 'Sales', persistent: true });
    t('New mapped drive S: (Update)', r.ok && r.item.name === 'S:' && r.order === 1 && g.userVersion === v0 + 1, r);
    const sUid = r.item.uid;
    t('the GPO now applies to the user', G.rsop().user.applied.some(e => e.name === 'Drive Mappings'));
    const xmlPath = G.gpoDir(g) + '\\User\\Preferences\\Drives\\Drives.xml';
    let xml = WS.fs.readFile(xmlPath);
    t('SYSVOL: User\\Preferences\\Drives\\Drives.xml with the real CLSIDs', xml.includes('<Drives clsid="{8FDDCC1A-0C3C-43cd-A6B4-71A6DF20DA8C}">') && xml.includes('<Drive clsid="{935D1B74-9CB8-4e3c-9914-7DD559B7A417}" name="S:" status="S:" image="2"'), xml);
    t('Drives.xml: Properties action="U" ... persistent="1" useLetter="1" letter="S", bypassErrors', xml.includes(`<Properties action="U" thisDrive="NOCHANGE" allDrives="NOCHANGE" userName="" path="${unc('Sales')}" label="Sales" persistent="1" useLetter="1" letter="S"/>`) && xml.includes('bypassErrors="1"'), xml);
    t('GPT.INI carries the user version', new RegExp(`Version=${g.userVersion * 65536 + g.computerVersion}`).test(WS.fs.readFile(G.gpoDir(g) + '\\GPT.INI')));
    r = P.newDrive(g, { action: 'C', path: unc('IT'), letter: 'I', filters: [{ type: 'group', name: 'IT Staff' }] });
    t('a targeted item: the filter resolves the group and its SID', r.ok && r.item.common.targeting && r.item.filters[0].name === 'CONTOSO\\IT Staff' && /^S-1-5-21-/.test(r.item.filters[0].sid), r.item && r.item.filters);
    const iUid = r.item.uid;
    t('Targeting text: the user is a member of the security group CONTOSO\\IT Staff', P.filterText(r.item.filters[0]) === 'the user is a member of the security group CONTOSO\\IT Staff');
    xml = WS.fs.readFile(xmlPath);
    t('Drives.xml: <Filters><FilterGroup ... userContext="1"/>', /<Filters><FilterGroup bool="AND" not="0" name="CONTOSO\\IT Staff" sid="S-1-5-21-[\d-]+" userContext="1" primaryGroup="0" localGroup="0"\/><\/Filters>/.test(xml), xml);
    r = P.newDrive(g, { action: 'U', path: unc('Old'), letter: 'O', common: { removePolicy: true } });
    t('"Remove this item when it is no longer applied" turns the action into Replace', r.ok && r.item.action === 'R' && WS.fs.readFile(xmlPath).includes('removePolicy="1"'));
    const oUid = r.item.uid;
    t('Move Up / Move Down change the order', P.moveDrive(g, oUid, -1).order === 2 && P.drives(g).map(d => d.letter).join('') === 'SOI' && P.moveDrive(g, oUid, 1).order === 3);

    /* ---------------- processing */
    NU.connect('X', unc('Old'), { persistent: true });
    r = P.newDrive(g, { action: 'D', letter: 'X' });
    t('a Delete item needs no location', r.ok && r.item.path === '');
    const evBefore = (WS.state.events.logs['Microsoft-Windows-GroupPolicy/Operational'] || []).length;
    out = await crun('gpupdate /target:user');
    t('gpupdate /target:user', out.includes('User Policy update has completed successfully.'), out);
    t('S: is mapped by Group Policy with its label', NU.get('S') && NU.get('S').source === 'gpp' && NU.get('S').label === 'Sales' && NU.get('S').persistent);
    t('I: is not mapped: Administrator is not in IT Staff', !NU.get('I'));
    t('O: is mapped and tracked for removal', NU.get('O') && WS.state.gp.pp.tracked.some(x => x.letter === 'O'));
    t('the Delete item removed X:', !NU.get('X'));
    const opNew = WS.state.events.logs['Microsoft-Windows-GroupPolicy/Operational'].slice(evBefore);
    t('Operational log: 4016 Starting Group Policy Drive Maps Extension Processing, then 5016', opNew.some(e => e.id === 4016 && e.message.startsWith('Starting Group Policy Drive Maps Extension Processing.') && e.message.includes('Drive Mappings')) && opNew.some(e => e.id === 5016 && /Completed Group Policy Drive Maps Extension Processing in \d+ milliseconds\./.test(e.message)), opNew.map(e => e.id));
    t('...between 5312 and the completion event', opNew.findIndex(e => e.id === 5312) < opNew.findIndex(e => e.id === 4016) && opNew.findIndex(e => e.id === 5016) < opNew.findIndex(e => e.id === 8005));
    t('lab helpers: mappedDrive and gppDrive', check({ mappedDrive: { letter: 'S', remote: unc('Sales'), source: 'gpp', label: 'Sales' } }) && check({ mappedDrive: { letter: 'X', exists: false } }) &&
      check({ gppDrive: { gpo: 'Drive Mappings', letter: 'I', action: 'Create', targeting: { type: 'group', name: 'IT Staff' } } }) && !check({ gppDrive: { gpo: 'Drive Mappings', letter: 'I', action: 'Update' } }));
    WS.ad.addMember('IT Staff', 'Administrator');
    await crun('gpupdate');
    t('after joining IT Staff the targeted I: drive is mapped', NU.get('I') && NU.get('I').remote === unc('IT'));
    // Update does not remap a drive that points somewhere else; Replace does
    NU.disconnect('S'); NU.connect('S', unc('Public'), { persistent: true });
    await crun('gpupdate');
    t('Update keeps an existing S: that points elsewhere (and takes the label)', NU.get('S').remote === unc('Public') && NU.get('S').label === 'Sales');
    P.setDrive(g, sUid, { action: 'R' });
    await crun('gpupdate');
    t('Replace re-creates it with the item\u2019s location', NU.get('S').remote === unc('Sales'));
    // Create fails on a letter in use: event 4098 in the Application log, error suppressed
    NU.connect('P', unc('Public'), { persistent: true });
    r = P.newDrive(g, { action: 'C', path: unc('Sales'), letter: 'P' });
    const pUid = r.item.uid;
    await crun('gpupdate');
    let w = evts('Application', 4098).pop();
    t('Create on a letter in use: Application 4098 from Group Policy Drive Maps', w && w.source === 'Group Policy Drive Maps' && w.level === 'Warning' && w.message === `The user 'P:' preference item in the 'Drive Mappings ${g.id}' Group Policy Object did not apply because it failed with error code '0x80070055 The local device name is already in use.' This error was suppressed.`, w);
    t('...and the completion event is 6016 (warning)', evts('Microsoft-Windows-GroupPolicy/Operational', 6016).length > 0);
    P.removeDrive(g, pUid); NU.disconnect('P');
    r = P.newDrive(g, { action: 'U', path: '\\\\FS99\\Data', letter: 'F' });
    await crun('gpupdate');
    w = evts('Application', 4098).pop();
    t('an unreachable server: 0x80070035 The network path was not found.', w.message.includes("'0x80070035 The network path was not found.'") && !NU.get('F'));
    P.removeDrive(g, r.item.uid);
    // targeting: NOT, OR, OU, computer name
    const ctx = { user: G.userObject(), computer: G.thisComputer() };
    const F = f => P.evalFilter(P.normFilter(f), ctx);
    t('targeting: group, NOT group, user, computer name, OU', F({ type: 'group', name: 'IT Staff' }) && !F({ type: 'group', name: 'IT Staff', not: true }) && F({ type: 'user', name: 'Administrator' }) &&
      F({ type: 'computer', name: ME }) && !F({ type: 'computer', name: 'CLIENT01' }) && F({ type: 'ou', name: 'Domain Controllers', userContext: false }) && !F({ type: 'ou', name: 'IT' }));
    t('targeting: items combine top to bottom with AND / OR', P.targeted(P.normalize({ path: unc('IT'), letter: 'Q', filters: [{ type: 'group', name: 'Sales Staff' }, { type: 'computer', name: ME, bool: 'OR' }] }), ctx) &&
      !P.targeted(P.normalize({ path: unc('IT'), letter: 'Q', filters: [{ type: 'group', name: 'Sales Staff' }, { type: 'computer', name: ME, bool: 'AND' }] }), ctx));
    // Remove this item when it is no longer applied
    P.removeDrive(g, oUid);
    await crun('gpupdate');
    t('deleting a "remove when no longer applied" item removes O: at the next refresh', !NU.get('O') && !WS.state.gp.pp.tracked.some(x => x.letter === 'O'));
    // Apply once
    r = P.newDrive(g, { action: 'U', path: unc('Public'), letter: 'K', common: { applyOnce: true } });
    await crun('gpupdate');
    NU.disconnect('K');
    await crun('gpupdate');
    t('Apply once and do not reapply', !NU.get('K') && WS.fs.readFile(xmlPath).includes(`<FilterRunOnce hidden="1" not="0" bool="AND" id="${r.item.uid}"/>`));
    P.removeDrive(g, r.item.uid);
    // disabled items and GPO status
    P.setDisabled(g, iUid, true); NU.disconnect('I');
    await crun('gpupdate');
    t('a disabled item is skipped', !NU.get('I') && WS.fs.readFile(xmlPath).includes('disabled="1"'));
    P.setDisabled(g, iUid, false);
    G.setStatus(g, 'UserSettingsDisabled'); NU.disconnect('S');
    await crun('gpupdate');
    t('User configuration settings disabled: no drive maps', !NU.get('S'));
    G.setStatus(g, 'AllSettingsEnabled');
    await crun('gpupdate');
    t('enabled again: S: and I: come back', NU.get('S') && NU.get('I'));
    // Hide this drive
    P.setDrive(g, iUid, { action: 'U', thisDrive: 'HIDE' });
    await crun('gpupdate');
    t('Hide this drive marks the mapping hidden', NU.get('I').hidden === true);
    P.setDrive(g, iUid, { thisDrive: 'NOCHANGE' }); NU.update('I', { hidden: false });

    /* ---------------- copy, backup, restore, reports */
    const cp = G.copy(g, { name: 'Drive Mappings Copy' });
    t('Copy GPO keeps the preference items and writes Drives.xml', cp.ok && P.drives(cp.gpo).length === P.drives(g).length && WS.fs.exists(G.gpoDir(cp.gpo) + '\\User\\Preferences\\Drives\\Drives.xml'));
    WS.fs.ensureDir('C:\\GPOBackup');
    const bk = G.backup(g, 'C:\\GPOBackup', 'drives');
    const before = P.drives(g).length;
    P.removeDrive(g, sUid);
    G.restore(bk.backups[0].backupId, 'C:\\GPOBackup');
    t('Back Up / Restore round-trips the drive items', P.drives(g).length === before && WS.fs.readFile(xmlPath).includes('name="S:"'));
    const html = G.reportHtml(g);
    t('Settings report: Preferences > Windows Settings > Drive Maps > Drive Map (Drive: S)', html.includes('Preferences') && html.includes('Drive Maps') && html.includes('Drive Map (Drive: S)') && html.includes('Use first available') === false && html.includes(unc('Sales')), html.slice(html.indexOf('Preferences'), html.indexOf('Preferences') + 300));
    t('...with the Common options and the targeting', html.includes('Remove this item when it is no longer applied') && html.includes('the user is a member of the security group CONTOSO\\IT Staff'));
    const rx = G.reportXml(g);
    t('Get-GPOReport XML: DriveMapSettings extension', rx.includes('xsi:type="q3:DriveMapSettings"') && rx.includes('<Name>Drive Maps</Name>') && rx.includes('<q3:GPOSettingOrder>1</q3:GPOSettingOrder>'));
    await crun('gpupdate');
    const rr = G.rsopHtml(G.loggedRsop());
    t('Group Policy Results: the applied drive maps with the winning GPO, and Drive Maps under Extensions Configured', rr.includes('Drive Map (Drive: S)') && rr.includes('Winning GPO') && rr.includes('Drive Maps'));
    const empty = G.create('Only Drives').gpo; P.newDrive(empty, { path: unc('Public'), letter: 'L' });
    t('a GPO with only preferences does not say "No settings defined." for the user', !/User Configuration \(Enabled\)<\/span><span class="gp-tog">hide<\/span><\/div><div class="gp-body"><div class="gp-none">No settings defined/.test(G.reportHtml(empty)));
    G.remove(empty); G.remove(cp.gpo);

    /* ================================================================ the editor */
    const edw = WS.gpme.open(g), ec = edw.gpme, emmc = ec.mmc;
    await wait(100);
    ec.open('gpme:u.pref.drivemaps'); await wait(80);
    t('Drive Maps lists the items: Name, Order, Action, Path', emmc.list.rows().length === P.drives(g).length && edw.el.querySelector('.mmc-result').textContent.includes('Order') && edw.el.querySelector('.mmc-result').textContent.includes(unc('Sales')));
    emmc.list.select([sUid]); await wait(40);
    t('the Extended view shows Processing and Description', edw.el.querySelector('.mmc-ext').textContent.includes('Processing') && edw.el.querySelector('.mmc-ext').textContent.includes('Stop on error: No'));
    if (stop('list')) return;
    const nodeMenu = WS.gpmePrefs.menu({ id: 'u.pref.drivemaps' }, ec.target);
    t('right-click Drive Maps: New > Mapped Drive', item(item(nodeMenu, 'New').items, 'Mapped Drive'));
    let sh = null, ui = null;
    let busy = WS.gpmePrefs.driveDialog(g, null, { onCreate: (s, u) => { sh = s; ui = u; } }); await wait(80);
    t('New Drive Properties: General and Common', title() === 'New Drive Properties' && dlgText().includes('General') && dlgText().includes('Common') && dlgText().includes('Label as:') && dlgText().includes('Use first available, starting at:'));
    t('defaults: Update, Use: D, Connect as disabled (MS14-025), No change', input('action').value === 'U' && input('letter').value === 'D' && input('userName').disabled && input('thisDrive-nochange').checked);
    if (stop('dialog')) return;
    await click('OK');
    t('OK with no location is refused', title() === 'New Drive Properties' && /location/i.test(dlgText()));
    await click('OK');
    fill('location', unc('Public')); fill('reconnect', true); fill('label', 'Public'); fill('letter', 'P');
    fill('action', 'D');
    t('Delete: the location is disabled and the letter choices become Delete all / Delete', input('location').disabled && dlgText().includes('Delete all, starting at:') && dlgText().includes('Delete:'));
    fill('action', 'U');
    await tab('Common');
    t('Common: the five options, Targeting... and Description', dlgText().includes('Stop processing items in this extension if an error occurs.') && dlgText().includes("Run in logged-on user's security context (user policy option)") && dlgText().includes('Apply once and do not reapply') && button('Targeting...').disabled);
    fill('targeting', true);
    t('Item-level targeting enables Targeting...', !button('Targeting...').disabled);
    if (stop('common')) return;
    let te = null;
    button('Targeting...').click(); await wait(80);
    t('Targeting Editor opens', title() === 'Targeting Editor' && dlgText().includes('New Item') && dlgText().includes('Item Options'));
    const teShade = shade();
    button('New Item ▾', teShade).click(); await wait(40);
    const pop = [...document.querySelectorAll('.menu.ctx')].pop();
    t('New Item lists the targeting item types', pop && pop.textContent.includes('Security Group') && pop.textContent.includes('WMI Query'), pop && pop.textContent.slice(0, 120));
    const sgItem = pop && [...pop.querySelectorAll('.menu-item')].find(x => WS.ui.plain(x.textContent).trim().startsWith('Security Group'));
    if (sgItem) sgItem.click(); else document.body.click();
    await wait(60);
    fill('targetName', 'Sales Staff', teShade);
    t('a Security Group item: "the user is a member of the security group Sales Staff"', teShade.querySelector('.gpp-te-item') && teShade.querySelector('.gpp-te-item').textContent.includes('the user is a member of the security group Sales Staff'));
    if (stop('targeting')) return;
    await click('OK', teShade);
    await wait(60);
    t('back in the sheet, OK saves the item with its filter', title() === 'New Drive Properties');
    await click('OK'); await busy;
    const pItem = P.drives(g).find(d => d.letter === 'P');
    t('...as P: Update \\\\server\\Public, label Public, reconnect, targeted at CONTOSO\\Sales Staff', pItem && pItem.action === 'U' && pItem.path === unc('Public') && pItem.persistent && pItem.label === 'Public' && pItem.common.targeting && pItem.filters[0].name === 'CONTOSO\\Sales Staff', pItem);
    await wait(60);
    t('the list shows the new item', emmc.list.rows().some(x => x.uid === pItem.uid));
    busy = WS.gpmePrefs.driveDialog(g, pItem.uid, { onCreate: (s, u) => { sh = s; ui = u; } }); await wait(80);
    t('an existing item opens as "P: Properties"', title() === 'P: Properties' && input('location').value === unc('Public'));
    await tab('Common');
    fill('removePolicy', true);
    await tab('General');
    t('Remove this item when it is no longer applied: the action becomes Replace and cannot change', input('action').value === 'R' && input('action').disabled);
    await click('OK'); await busy;
    t('...saved', P.drive(g, pItem.uid).action === 'R' && P.drive(g, pItem.uid).common.removePolicy);
    P.removeDrive(g, pItem.uid);

    /* ================================================================ File Explorer */
    await crun('gpupdate');
    const ex = WS.apps.launch('explorer'); await wait(120);
    t('This PC: Network locations with the mapped drives', ex.el.textContent.includes('Network locations') && ex.el.textContent.includes('Sales (S:)') && ex.el.textContent.includes(`IT (\\\\${ME}) (I:)`), ex.el.querySelector('.ex-main').textContent.slice(0, 300));
    if (stop('explorer')) return;
    ex.explorer.go('S:\\'); await wait(60);
    t('opening S: lists the share', ex.explorer.items().includes('Q3.txt'));
    ex.explorer.go(unc('Sales')); await wait(60);
    t('the address bar takes \\\\server\\share', ex.explorer.path() === unc('Sales') && ex.explorer.items().includes('Reports'));
    ex.explorer.go('\\\\FS99\\Data'); await wait(60);
    t('an unreachable share: "... is not accessible" with The network path was not found.', title() === 'File Explorer' && dlgText().includes('is not accessible') && dlgText().includes('The network path was not found.'));
    await click('OK');
    ex.explorer.up(); await wait(40);
    t('Up from a share root goes to This PC', ex.explorer.path() === 'This PC');
    ex.close();

    const gw = WS.apps.launch('gpmc'); await wait(150);
    gw.gpmc.open('gpmc-gpo:' + g.id); await wait(120); gw.gpmc.tab('Settings'); await wait(200);
    t('GPMC Settings tab: User Configuration > Preferences > Drive Maps', gw.el.textContent.includes('Drive Map (Drive: S)') && gw.el.textContent.includes('Preferences'));
    const prefHead = [...gw.el.querySelectorAll('.gp-h')].find(x => x.textContent.startsWith('Preferences'));
    if (prefHead) prefHead.scrollIntoView();
    if (stop('report')) return;
    gw.close();

    /* ================================================================ Lab 16 */
    const lab = WS.labs.get('lab16-drive-maps');
    const pw = WS.state.system.adminPassword;
    const s = WS.store.createDefault();
    s.meta.oobeDone = true; s.system.adminPassword = pw;
    lab.setup(s, WS);
    s.lab = { activeId: lab.id, startedAt: new Date().toISOString(), completed: {} };
    WS.state = s;
    WS.sys.onBoot(); await wait(150);
    WS.gpo.refresh({ target: 'user', reason: 'logon' });
    WS.labs.evaluate();
    const openIds = () => WS.labs.progress().items.filter(i => !i.done).map(i => i.id);
    t('Lab 16 starts on DC01 with the shares, IT Staff and the old X: drive, nothing done', WS.sys.name === 'DC01' && WS.smb.get('Archive') && NU.get('X') && NU.get('X').remote === '\\\\DC01\\Archive' && WS.labs.progress().doneCount === 0, openIds());
    const lg = G.create('Drive Mappings').gpo; G.link(lg, WS.ad.root());
    P.newDrive(lg, { action: 'U', path: '\\\\DC01\\Public', letter: 'P', label: 'Public', persistent: true });
    P.newDrive(lg, { action: 'U', path: '\\\\DC01\\IT', letter: 'I', filters: [{ type: 'group', name: 'IT Staff' }] });
    WS.labs.evaluate();
    t('Lab 16: GPO, Public and IT objectives complete', !openIds().includes('gpo') && !openIds().includes('public') && !openIds().includes('it'), openIds());
    P.newDrive(lg, { action: 'D', letter: 'X' });
    await run('Add-ADGroupMember -Identity "IT Staff" -Members Administrator');
    WS.labs.evaluate();
    t('Lab 16: the apply objective waits for policy processing', openIds().join() === 'apply', openIds());
    await crun('gpupdate /target:user');
    WS.labs.evaluate();
    t('Lab 16: every objective completes after gpupdate', WS.labs.progress().doneCount === WS.labs.progress().total, openIds());

    console.log(`RESULT ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.log('FAIL exception :: ' + (e && e.stack || e));
    console.log(`RESULT ${pass} passed, ${fail + 1} failed`);
  }
})();
