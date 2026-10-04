/* Computer Management, Shared Folders, Local Users and Groups and Device Manager browser workflow; use a fresh profile.
 * &shot=tree|disk|events|users|newuser|userprops|groups|shares|wizard|wizperms|shareprops|advanced|devices|dc stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, SF = WS.fsmgmt, LU = WS.lusrmgr;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const title = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
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
  const has = (items, name) => items.some(x => x && x.label && WS.ui.plain(x.label) === name);
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async cmd => { const out = []; await ps.execute(cmd, { capture: out }); return out; };
  try {
    await wait(250);
    /* ---------------- the console tree ---------------- */
    t('compmgmt, fsmgmt, lusrmgr and devmgmt are registered', ['compmgmt', 'fsmgmt', 'lusrmgr', 'devmgmt'].every(id => !!WS.apps.get(id)));
    t('the .msc names launch them from a shell', ['compmgmt.msc', 'fsmgmt.msc', 'lusrmgr.msc', 'devmgmt.msc', 'diskmgmt.msc'].every(n => !!WS.term.native(n)));
    const win = WS.apps.launch('compmgmt'), c = win.compmgmt, mmc = c.mmc;
    await wait(80);
    const treeText = () => win.el.querySelector('.mmc-tree').textContent;
    t('tree: Computer Management (Local) > System Tools, Storage, Services and Applications', ['Computer Management (Local)', 'System Tools', 'Storage', 'Services and Applications'].every(x => treeText().includes(x)));
    t('System Tools lists the six real tools in order', /Task Scheduler.*Event Viewer.*Shared Folders.*Local Users and Groups.*Performance.*Device Manager/.test(treeText()));
    t('Storage holds Windows Server Backup and Disk Management', /Windows Server Backup.*Disk Management/.test(treeText()));
    t('root result pane lists the three folders', mmc.list && mmc.list.rows().map(r => r.label).join() === 'System Tools,Storage,Services and Applications');
    t('root menu offers Connect to another computer...', has(mmc.scopeMenu(mmc.current()), 'Connect to another computer...'));
    if (stop('tree')) return;

    /* ---------------- hosted snap-ins ---------------- */
    c.open('dm-root'); await wait(450);
    t('Disk Management runs inside Computer Management', win.el.textContent.includes('(Disk 0 partition 1)') && !!win.el.querySelector('.dm-graph') && c.path('dm-root').join('/') === 'cm-root/cm-storage/dm-root');
    if (stop('disk')) return;
    c.open('svc-local'); await wait(60);
    t('Services lists the service catalog', mmc.list && mmc.list.rows().length > 50 && mmc.list.rows().some(r => r.name === 'Spooler'));
    t('Services and Applications expanded to reach Services', c.path('svc-local').join('/') === 'cm-root/cm-apps/svc-local');
    t('Event Viewer controller selects a log under System Tools', c.events.select('System') && mmc.current().id === 'ev-log:System');
    await wait(60);
    t('System log header shows inside Computer Management', win.el.textContent.includes('Number of events:'));
    t('Event Viewer nodes use the full Actions pane', win.el.querySelector('.mmc-actions').textContent.includes('Filter Current Log...'));
    if (stop('events')) return;

    /* ---------------- Local Users and Groups ---------------- */
    c.open('lu-users'); await wait(60);
    const names = () => mmc.list.rows().map(r => r.name);
    t('Users lists the built-in accounts', ['Administrator', 'DefaultAccount', 'Guest', 'WDAGUtilityAccount'].every(n => names().includes(n)));
    t('Users menu: New User...', has(mmc.scopeMenu(mmc.current()), 'New User...'));
    if (stop('users')) return;
    let busy = LU.newUser(); await wait(60);
    t('New User has the real fields and Create/Close', title() === 'New User' && !!button('Create') && !!button('Close') && input('mustChange').checked && input('cannotChange').disabled);
    fill('name', 'helpdesk'); fill('fullName', 'Help Desk'); fill('description', 'Tier 1 support');
    fill('password', 'P@ssw0rd123'); fill('confirm', 'P@ssw0rd12');
    if (stop('newuser')) return;
    await click('Create');
    t('mismatched passwords are refused', dlgText().includes('The passwords typed do not match.'));
    await click('OK');
    fill('password', 'short'); fill('confirm', 'short'); await click('Create');
    t('weak password fails the policy', dlgText().includes('does not meet the password policy requirements'));
    await click('OK');
    fill('password', 'P@ssw0rd123'); fill('confirm', 'P@ssw0rd123'); fill('mustChange', false); fill('neverExpires', true); await click('Create');
    t('Create makes the user and clears the form', !!WS.local.user('helpdesk') && input('name').value === '' && WS.local.user('helpdesk').neverExpires && !WS.local.user('helpdesk').mustChange);
    fill('name', 'helpdesk'); fill('password', 'P@ssw0rd123'); fill('confirm', 'P@ssw0rd123'); await click('Create');
    t('duplicate user name is refused', dlgText().includes('The user helpdesk already exists.'));
    await click('OK'); await click('Close'); await busy; await wait(60);
    t('new user appears in the list and in PowerShell', names().includes('helpdesk') && (await run('Get-LocalUser -Name helpdesk'))[0].Description === 'Tier 1 support');

    busy = LU.setPassword('helpdesk'); await wait(60);
    t('Set Password warns before resetting', dlgText().includes('Resetting this password might cause irreversible loss of information') && !!button('Proceed'));
    await click('Proceed');
    fill('password', 'N3w!Passw0rd'); fill('confirm', 'N3w!Passw0rd'); await click('OK');
    t('password set message', dlgText().includes('The password has been set.'));
    await click('OK'); await busy;
    t('the new password signs in', WS.local.verify('helpdesk', 'N3w!Passw0rd').ok);

    let sheet, getMem;
    busy = LU.userProperties('helpdesk', { onCreate: (s, m) => { sheet = s; getMem = m; } }); await wait(60);
    t('user Properties: General, Member Of, Profile', title() === 'helpdesk Properties' && [...shade().querySelectorAll('.ps-tab')].map(x => x.textContent).join() === 'General,Member Of,Profile');
    fill('description', 'Tier 2 support'); fill('disabled', true);
    await tab('Member Of');
    t('Member Of shows Users', dlgText().includes('Users'));
    getMem().add(['Remote Desktop Users']);
    if (stop('userprops')) return;
    sheet.ok(); await busy; await wait(60);
    t('General and Member Of applied through the model', WS.local.user('helpdesk').description === 'Tier 2 support' && !WS.local.user('helpdesk').enabled && WS.local.group('Remote Desktop Users').members.includes('helpdesk'));
    t('disabled user shows the disabled icon', mmc.view().icon(mmc.list.rows().find(r => r.name === 'helpdesk')) === WS.icons.adUserDisabled);

    c.open('lu-groups'); await wait(60);
    t('Groups lists the builtin groups', names().includes('Administrators') && names().includes('Remote Desktop Users'));
    let gf;
    busy = LU.newGroup({ onCreate: f => { gf = f; } }); await wait(60);
    fill('name', 'Helpdesk Admins'); fill('description', 'Can reset passwords');
    gf.members().add(['helpdesk']);
    if (stop('groups')) return;
    await click('Create'); await click('Close'); await busy; await wait(60);
    t('New Group created with its member', WS.local.group('Helpdesk Admins') && WS.local.group('Helpdesk Admins').members.includes('helpdesk') && names().includes('Helpdesk Admins'));
    busy = LU.groupProperties('Helpdesk Admins', { onCreate: (s, m) => { sheet = s; getMem = m; } }); await wait(60);
    getMem().select('helpdesk'); getMem().remove(); fill('description', 'Password resets');
    sheet.ok(); await busy; await wait(40);
    t('group Properties removes the member and changes the description', !WS.local.group('Helpdesk Admins').members.length && WS.local.group('Helpdesk Admins').description === 'Password resets');
    busy = LU.rename('group', 'Helpdesk Admins'); await wait(60);
    shade().querySelector('input').value = 'Service Desk'; await click('OK'); await busy;
    t('rename group goes through the model', !!WS.local.group('Service Desk') && !WS.local.group('Helpdesk Admins'));
    busy = LU.deleteGroups(['Administrators']); await wait(60); await click('Yes'); await wait(60);
    t('built-in groups cannot be deleted', dlgText().includes('built-in accounts'));
    await click('OK'); await busy;
    busy = LU.deleteUsers(['helpdesk']); await wait(60);
    t('deleting a user explains the SID', dlgText().includes('Each user account has a unique identifier'));
    await click('Yes'); await busy;
    t('user deleted and removed from groups', !WS.local.user('helpdesk') && !WS.local.group('Remote Desktop Users').members.includes('helpdesk'));

    /* ---------------- Shared Folders ---------------- */
    c.open('sf-shares'); await wait(60);
    const shares = () => mmc.list.rows().map(r => r.name);
    t('Shares lists the administrative shares', ['ADMIN$', 'C$', 'IPC$'].every(n => shares().includes(n)));
    t('Shares menu: New Share...', has(mmc.scopeMenu(mmc.current()), 'New Share...'));
    if (stop('shares')) return;
    let wz;
    busy = SF.newShare({ onCreate: w => { wz = w; } }); await wait(60);
    t('wizard opens on its welcome page', wz.el.textContent.includes('Welcome to the Create A Shared Folder Wizard'));
    await click('Next >', wz.el);
    t('Folder Path page shows this computer', wz.el.textContent.includes('Example: C:\\Docs\\Public') && [...wz.el.querySelectorAll('input')].some(i => i.value === WS.sys.name));
    fill('path', 'C:\\Shares\\Public', wz.el);
    if (stop('wizard')) return;
    await click('Next >', wz.el);
    t('a missing folder can be created', dlgText().includes('does not exist. Do you want to create it?'));
    await click('Yes'); await wait(60);
    t('folder created and Name page defaults the share name', WS.fs.isDir('C:\\Shares\\Public') && wz.page.id === 'name' && input('name', wz.el).value === 'Public' && wz.el.textContent.includes(`\\\\${WS.sys.name}\\Public`));
    fill('description', 'Company documents', wz.el);
    await click('Next >', wz.el);
    t('Permissions page: Finish on the button, four presets and Customize', wz.page.id === 'perms' && !!button('Finish', wz.el) && wz.el.textContent.includes('Administrators have full access; other users have read-only access'));
    fill('perm-adminRead', true, wz.el);
    if (stop('wizperms')) return;
    await click('Finish', wz.el); await wait(60);
    t('share created on the permissions page; status page has no Back', !!WS.smb.get('Public') && wz.page.id === 'done' && button('< Back', wz.el).disabled && wz.el.textContent.includes('Sharing was Successful'));
    t('summary lists the share path', input('summary', wz.el).value.includes(`Share path: \\\\${WS.sys.name}\\Public`));
    await click('Finish', wz.el); await busy; await wait(60);
    const pub = WS.smb.get('Public');
    t('preset permissions: Everyone Read, Administrators Full', pub.access.some(a => a.account === 'Everyone' && a.right === 'Read') && pub.access.some(a => a.account === 'Administrators' && a.right === 'Full'));
    t('the share appears in the console and in PowerShell', shares().includes('Public') && (await run('Get-SmbShare -Name Public'))[0].Path === 'C:\\Shares\\Public');
    t('creating a share installs the File Server role service', WS.features.isInstalled('FS-FileServer'));

    let ed;
    busy = SF.shareProperties('Public', { onCreate: (s, e) => { sheet = s; ed = e; } }); await wait(60);
    t('share Properties: General + Share Permissions', title() === 'Public Properties' && dlgText().includes('C:\\Shares\\Public') && input('description').value === 'Company documents');
    fill('limit-some', true); fill('limit', '10');
    await tab('Share Permissions');
    ed().select('Everyone');
    fill('perm-Change-Allow', true);
    t('allowing Change also allows Read', input('perm-Read-Allow').checked && !input('perm-Full-Allow').checked);
    fill('perm-Full-Allow', true); fill('perm-Read-Allow', false);
    t('clearing Read clears Change and Full Control', !input('perm-Full-Allow').checked && !input('perm-Change-Allow').checked);
    fill('perm-Change-Allow', true);
    ed().add([{ principal: 'Guests' }]);
    fill('perm-Full-Deny', true);
    t('Deny Full Control ticks every Deny box for the new principal', input('perm-Read-Deny').checked && input('perm-Change-Deny').checked && !input('perm-Read-Allow').checked);
    if (stop('shareprops')) return;
    sheet.ok(); await busy; await wait(60);
    const acc = WS.smb.get('Public').access;
    t('Share Permissions apply as ACEs', acc.some(a => a.account === 'Everyone' && a.right === 'Change' && a.type === 'Allow') && acc.some(a => a.account === 'Guests' && a.right === 'Full' && a.type === 'Deny'));
    t('user limit saved', WS.smb.get('Public').concurrentUserLimit === 10);
    t('Get-SmbShareAccess agrees', (await run('Get-SmbShareAccess -Name Public')).some(o => /Guests$/.test(o.AccountName) && o.AccessControlType === 'Deny'));
    busy = SF.shareProperties('C$', { tab: 'Share Permissions' }); await wait(60);
    t('an administrative share cannot have permissions set', dlgText().includes('This has been shared for administrative purposes. The permissions cannot be set.'));
    await click('Cancel'); await busy;

    WS.fs.mkdir('C:\\Data');
    busy = SF.advancedSharing('C:\\Data'); await wait(60);
    t('Advanced Sharing starts unshared with the folder name', title() === 'Advanced Sharing' && !input('share').checked && input('name').value === 'Data' && input('name').disabled);
    fill('share', true); fill('comments', 'Team data');
    if (stop('advanced')) return;
    await click('OK'); await busy; await wait(60);
    t('Share this folder + OK creates the share (Everyone Read)', WS.smb.get('Data') && WS.smb.get('Data').description === 'Team data' && WS.smb.get('Data').access[0].account === 'Everyone');
    busy = SF.advancedSharing('C:\\Data'); await wait(60);
    t('reopening shows the share selected', input('share').checked && input('names').value === 'Data');
    fill('share', false); await click('OK'); await busy;
    t('clearing Share this folder stops sharing', !WS.smb.get('Data'));
    busy = SF.stopSharing(['Public']); await wait(60);
    t('Stop Sharing asks first', dlgText().includes('Are you sure you wish to stop sharing Public?'));
    await click('No'); await busy;
    t('No keeps the share', !!WS.smb.get('Public'));

    /* ---------------- Device Manager, WMI Control, Windows Server Backup ---------------- */
    c.open('dv-root'); await wait(60);
    t('Device Manager tree lists the categories and devices', win.el.textContent.includes('Disk drives') && win.el.textContent.includes('Network adapters') && win.el.textContent.includes(WS.sys.name));
    if (stop('devices')) return;
    const dm2 = WS.apps.launch('devmgmt'); await wait(60);
    t('devmgmt.msc opens Device Manager on its own', dm2.el.textContent.includes('Device Manager'));
    dm2.close();
    busy = WS.compmgmt.wmiProperties(); await wait(60);
    t('WMI Control properties show the connection', dlgText().includes('Successfully connected to:') && dlgText().includes(WS.sys.name));
    await click('Cancel'); await busy;
    c.open('cm-wsb'); await wait(40);
    t('Windows Server Backup explains the feature is missing', win.el.textContent.includes('The Windows Server Backup feature is not installed'));

    /* ---------------- on a domain controller ---------------- */
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
    const promo = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'Restore-P@ss2025', noReboot: true }); await wait(150);
    t('test setup: promoted', promo.ok && WS.sys.isDC(), promo);
    c.open('lu-root'); await wait(60);
    t('Local Users and Groups shows the domain controller message', win.el.textContent.includes('This computer is a domain controller. This snap-in cannot be used on a domain controller.'));
    t('and has no Users/Groups children', !mmc.tree.node('lu-users'));
    if (stop('dc')) return;
    win.close();
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
