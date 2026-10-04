/* ADUC browser workflow; use a fresh profile. &shot=directory|newuser|user|members|find. */
(async function () {
  'use strict';
  const WS = window.WS, A = WS.ad, D = WS.aduc;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const button = (label, scope = shade()) => [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(65); };
  const input = (key, scope = shade()) => scope.querySelector(`[data-field="${key}"]`);
  const fill = (key, value, scope) => { const el = input(key, scope); if (!el) throw new Error('Missing field: ' + key); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const tab = async label => { const b = [...shade().querySelectorAll('.ps-tab')].find(x => x.textContent === label); if (!b) throw new Error('Missing tab: ' + label); b.click(); await wait(30); };
  const selectRow = row => { if (!row) throw new Error('Missing row'); row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  async function pick(action, names) {
    let picker;
    const original = WS.ui.objectPicker;
    WS.ui.objectPicker = opts => original({ ...opts, onCreate: p => { picker = p; } });
    try { action(); await wait(40); t('object picker opens over the directory dialog', !!picker); picker.setText(names); picker.ok(); await wait(80); }
    finally { WS.ui.objectPicker = original; }
  }
  try {
    await wait(250);
    const win = WS.apps.launch('dsa'), c = win.aduc, mmc = c.mmc;
    t('ADUC is a real registered console', win.app === 'dsa' && !!mmc);
    t('unpromoted server explains how to configure a domain', win.el.textContent.includes('No domain is available'));
    t('unpromoted server offers Server Manager', !!button('Open Server Manager', win.el));
    WS.state.system.adminPassword = 'ForestP@ss2025!';
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
    WS.sys.onBoot();
    const promoted = A.installForest({ domainName: 'contoso.local', safeModePassword: 'RestoreP@ss2025!', noReboot: true });
    t('domain fixture promotes through the shared model', promoted.ok, promoted);
    WS.sys.onBoot();
    for (let i = 0; i < 20 && !win.el.textContent.includes('contoso.local'); i++) await wait(50);
    t('open console discovers newly promoted domain', win.el.textContent.includes('contoso.local'));
    c.locate(A.root()); await wait(50);
    t('domain view includes the standard containers', ['Users', 'Computers', 'Builtin', 'Domain Controllers'].every(n => mmc.list.rows().some(o => o.name === n)));
    t('advanced containers are initially hidden', !mmc.list.rows().some(o => o.name === 'System'));
    const sm = WS.sm.open('dashboard');
    [...sm.el.querySelectorAll('.sm-menu')].find(x => x.textContent === 'Tools').click(); await wait(30);
    t('Server Manager Tools includes ADUC', document.querySelector('#dialogs').textContent.includes('Active Directory Users and Computers'));
    WS.ui.closeMenu(); win.restore();

    // Create an OU using the console's New menu, then exercise duplicate/cancel handling.
    mmc.scopeMenu(mmc.current()).find(x => WS.ui.plain(x.label) === 'New').items().find(x => WS.ui.plain(x.label) === 'Organizational Unit').action(); await wait(40);
    t('New menu opens the OU dialog', shade().textContent.includes('New Object - Organizational Unit'));
    fill('name', 'Sales'); await click('OK');
    const sales = A.get('Sales', 'organizationalUnit');
    t('OU created in selected domain and protected by default', sales && sales.parentId === A.root().id && sales.protected);
    t('created OU appears in live console tree', !!mmc.tree.node(sales.id));
    D.newOU(A.root().id); await wait(30); fill('name', 'Sales'); await click('OK');
    t('duplicate OU gives a model validation error', shade().textContent.includes('already in use'));
    await click('OK'); await click('Cancel');
    t('duplicate creation leaves one OU', A.search({ type: 'organizationalUnit', name: 'Sales' }).length === 1);
    D.newOU(A.root().id); await wait(30); fill('name', 'Cancelled OU'); await click('Cancel');
    t('cancelled OU is not created', !A.get('Cancelled OU'));
    c.locate(sales); await wait(40);

    let wizard;
    D.newUser(sales.id, { onCreate: w => { wizard = w; } }); await wait(50);
    t('new user starts with identity page and correct destination', wizard.page.id === 'identity' && wizard.el.textContent.includes('Sales'));
    fill('givenName', 'Jane'); fill('sn', 'Reed'); fill('logon', 'jreed');
    t('full name and legacy logon follow input', input('name').value === 'Jane Reed' && input('sam').value === 'jreed');
    await click('Next >', wizard.el);
    t('new user reaches password page', wizard.page.id === 'password');
    t('new users must change password by default', input('mustChange').checked);
    fill('password', 'short'); fill('confirm', 'different'); await click('Next >', wizard.el);
    t('password mismatch stays on password page', shade().textContent.includes('do not match') && wizard.page.id === 'password');
    await click('OK'); fill('confirm', 'short'); await click('Next >', wizard.el);
    t('weak password is rejected before creating a user', shade().textContent.includes('password policy') && !A.get('jreed'));
    await click('OK'); fill('password', 'LabP@ssword2025!'); fill('confirm', 'LabP@ssword2025!');
    fill('neverExpires', true);
    t('never expires clears must change flag', !input('mustChange').checked);
    fill('mustChange', true);
    t('must change clears conflicting account options', !input('neverExpires').checked && !input('cannotChange').checked);
    await click('Next >', wizard.el);
    t('summary includes name and UPN without exposing password', wizard.page.id === 'summary' && wizard.el.textContent.includes('jreed@contoso.local') && !wizard.el.textContent.includes('LabP@ssword2025!'));
    if (stop('newuser')) return;
    await click('Finish', wizard.el);
    const user = A.get('jreed', 'user');
    t('Finish creates enabled user in the OU', user && user.parentId === sales.id && user.enabled && user.mustChange);
    t('creation writes user audit', WS.evt.list('Security').some(e => e.id === 4720));
    t('user appears without reopening the console', mmc.list.rows().some(o => o.id === user.id));
    t('dialog closes after Finish', !wizard.el.isConnected);

    D.newGroup(sales.id); await wait(35); fill('name', 'Sales Staff');
    t('legacy group name follows group name', input('sam').value === 'Sales Staff');
    await click('OK'); const group = A.get('Sales Staff', 'group');
    t('group defaults to global security', group && group.scope === 'Global' && group.category === 'Security' && group.parentId === sales.id);
    D.newComputer(sales.id); await wait(35); fill('name', 'CLIENT02'); await click('OK'); const computer = A.get('CLIENT02', 'computer');
    t('computer created with DNS name and dollar SAM', computer && computer.sam === 'CLIENT02$' && computer.dnsHostName === 'client02.contoso.local');
    t('three objects visible in Sales', mmc.list.rows().length === 3);

    // PowerShell and GUI work against exactly the same directory.
    const io = new WS.term.TextConsole(), ps = new WS.ps.Session({ console: io });
    const captures = [];
    await ps.execute('Get-ADUser jreed', { capture: captures });
    t('PowerShell finds user created through ADUC', ps.lastSuccess && captures.some(o => o.SamAccountName === 'jreed'));
    await ps.execute(`New-ADGroup -Name "Terminal Group" -GroupScope Global -Path "${A.dn(sales)}"`);
    await wait(100);
    t('PowerShell-created group appears in open ADUC', mmc.list.rows().some(o => o.name === 'Terminal Group'));
    const terminalGroup = A.get('Terminal Group', 'group');
    if (stop('directory')) return;

    let sheet;
    D.properties(user.id, { onCreate: s => { sheet = s; } }); await wait(40);
    t('user has expected property tabs', ['General', 'Address', 'Account', 'Profile', 'Telephones', 'Organization', 'Member Of'].every(n => [...shade().querySelectorAll('.ps-tab')].some(x => x.textContent === n)));
    t('Object tab is hidden without Advanced Features', ![...shade().querySelectorAll('.ps-tab')].some(x => x.textContent === 'Object'));
    fill('description', 'Pending edit'); await click('Cancel');
    t('Cancel discards edited properties', user.description === '');
    D.properties(user.id, { onCreate: s => { sheet = s; } }); await wait(40);
    fill('description', 'Sales representative'); fill('email', 'jreed@contoso.local'); fill('telephone', '555-0102');
    await tab('Telephones'); fill('mobile', '555-0199');
    await tab('Address'); fill('city', 'Boston');
    await tab('Profile'); fill('profilePath', '\\\\DC01\\profiles\\jreed');
    await tab('Organization'); fill('department', 'Sales');
    await pick(() => button('Change...').click(), 'Administrator');
    await click('Apply');
    t('Apply persists general and additional tabs', user.description === 'Sales representative' && user.email === 'jreed@contoso.local' && user.telephone === '555-0102' && user.mobile === '555-0199' && user.city === 'Boston' && user.department === 'Sales');
    t('organization manager uses chosen directory identity', user.manager === A.get('Administrator', 'user').id);
    t('profile path persists through shared model', user.profilePath === '\\\\DC01\\profiles\\jreed');
    t('Apply resets dirty state', !sheet.dirty && sheet.applyBtn.disabled);
    await tab('General');
    if (stop('user')) return;
    await click('OK');

    // Membership edits must stay drafts until Apply, and group rules still come from the model.
    D.properties(group.id, { onCreate: s => { sheet = s; } }); await wait(30); await tab('Members');
    await pick(() => button('Add...').click(), 'jreed; CLIENT02');
    t('members are visible in draft list', shade().querySelectorAll('.aduc-members .lv-row').length === 2);
    t('Add does not mutate model before Apply', A.members(group.id).length === 0);
    await click('Cancel'); t('Cancel discards membership draft', A.members(group.id).length === 0);
    D.properties(group.id, { onCreate: s => { sheet = s; } }); await wait(30); await tab('Members');
    await pick(() => button('Add...').click(), 'jreed; CLIENT02'); await click('Apply');
    t('Apply adds both user and computer through shared membership model', A.members(group.id).some(x => x.id === user.id) && A.members(group.id).some(x => x.id === computer.id));
    t('membership writes security audit', WS.evt.list('Security').some(e => e.id === 4728));
    if (stop('members')) return;
    const memberRows = shade().querySelectorAll('.aduc-members .lv-row');
    selectRow([...memberRows].find(x => x.textContent.includes('CLIENT02'))); await click('Remove');
    t('Remove stays pending until Apply', A.members(group.id).some(x => x.id === computer.id));
    await click('Apply'); t('Apply removes selected membership', !A.members(group.id).some(x => x.id === computer.id));
    await tab('General'); fill('scope', 'DomainLocal'); fill('category', 'Distribution'); await click('Apply');
    t('invalid direct group scope change is rejected', shade().textContent.includes('universal first'));
    t('failed scope change leaves category and scope unchanged', group.scope === 'Global' && group.category === 'Security');
    await click('OK'); fill('scope', 'Universal'); fill('category', 'Security'); await click('Apply');
    t('valid group scope change applies', group.scope === 'Universal'); await click('OK');

    D.properties(user.id, { onCreate: s => { sheet = s; } }); await wait(35); await tab('Member Of');
    t('Member Of includes primary group and added group', shade().textContent.includes('Domain Users') && shade().textContent.includes('Sales Staff'));
    selectRow([...shade().querySelectorAll('.aduc-members .lv-row')].find(x => x.textContent.includes('Domain Users')));
    t('primary group cannot be removed', button('Remove').disabled);
    selectRow([...shade().querySelectorAll('.aduc-members .lv-row')].find(x => x.textContent.includes('Sales Staff')));
    await click('Set Primary Group'); t('primary group change stays a draft', user.primaryGroupId === 513);
    await click('Apply'); t('primary group applies through model', user.primaryGroupId === group.rid && A.memberOf(user).some(x => x.name === 'Domain Users'));
    await pick(() => button('Add...').click(), 'Terminal Group'); await click('Apply');
    t('Member Of can add another group', A.members(terminalGroup.id).some(x => x.id === user.id));
    await click('OK');

    D.resetPassword(user.id); await wait(35); fill('password', 'NewP@ssword2025!'); fill('confirm', 'mismatch'); await click('OK');
    t('reset password mismatch keeps account password unchanged', shade().textContent.includes('do not match') && user.password === 'LabP@ssword2025!');
    await click('OK'); fill('confirm', 'NewP@ssword2025!'); fill('mustChange', false); await click('OK');
    t('reset password changes credentials and next-logon option', A.verify('jreed', 'NewP@ssword2025!').ok && !user.mustChange);
    await D.setEnabled([user], false); await wait(90);
    t('Disable Account prevents sign-in', !user.enabled && A.verify('jreed', 'NewP@ssword2025!').error.includes('disabled'));
    await D.setEnabled([user], true); t('Enable Account restores sign-in', A.verify('jreed', 'NewP@ssword2025!').ok);
    A.setPolicy({ lockoutThreshold: 1 }); A.verify('jreed', 'wrong');
    t('model can lock account', user.lockedOut);
    D.properties(user.id); await wait(35); await tab('Account'); fill('unlock', true); await click('OK');
    t('Account tab unlocks user', !user.lockedOut && user.badPwdCount === 0);

    let frame, search;
    D.find(sales.id, { console: c, onCreate: (f, api) => { frame = f; search = api; } }); await wait(35);
    fill('name', 'Jane'); await click('Find Now');
    t('Find uses name prefix and selected subtree', search.list.rows().length === 1 && search.list.rows()[0].id === user.id);
    fill('description', 'representative'); await click('Find Now'); t('Find combines description criteria', search.list.rows().length === 1);
    fill('description', 'no matching description'); await click('Find Now'); t('Find displays empty result for unmatched description', search.list.rows().length === 0);
    await click('Clear'); fill('type', 'computer'); fill('name', 'CLIENT*'); await click('Find Now');
    t('Find supports wildcard and type filtering', search.list.rows().length === 1 && search.list.rows()[0].id === computer.id);
    if (stop('find')) return;
    search.list.select([computer.id]); await click('Go to Object');
    t('Go to Object navigates and selects search result', mmc.current().id === sales.id && mmc.selection()[0].id === computer.id);

    c.setAdvanced(true); c.locate(A.root());
    t('Advanced Features shows System container', mmc.list.rows().some(x => x.name === 'System'));
    c.setAdvanced(false); t('turning Advanced Features off hides System again', !mmc.list.rows().some(x => x.name === 'System'));
    c.locate(sales); c.setFilter(['user']); t('view filter restricts result pane', mmc.list.rows().length === 1 && mmc.list.rows()[0].id === user.id);
    c.setFilter(null); t('clearing filter restores all objects', mmc.list.rows().length === 4);

    // Rename/move/delete confirmations and protection go through their actual GUI dialogs.
    const renaming = D.rename(computer.id); await wait(35); shade().querySelector('input').value = 'CLIENT03'; await click('OK'); await renaming;
    t('Rename updates directory common name', A.get(computer.id).name === 'CLIENT03');
    const destination = A.createOU({ name: 'Operations' }).object;
    const moving = D.move([computer]); await wait(35);
    selectRow(shade().querySelector(`.tv-row[data-id="${destination.id}"]`)); await click('OK'); await moving;
    t('Move changes parent and directory path', computer.parentId === destination.id && A.dn(computer).includes('OU=Operations'));
    c.locate(computer); t('navigation follows moved object', mmc.current().id === destination.id && mmc.selection()[0].id === computer.id);
    const deleting = D.remove([destination]); await wait(30); shade().querySelector('input[type=checkbox]').click(); await click('Yes');
    t('protected OU deletion is rejected', shade().textContent.includes('protected from accidental deletion') && !!A.get(destination.id));
    await click('OK'); await deleting;
    D.properties(destination.id, { advanced: true }); await wait(35); await tab('Object');
    t('Object tab shows DN GUID and deletion protection', shade().textContent.includes(A.dn(destination)) && shade().textContent.includes(destination.id) && input('protected').checked);
    fill('protected', false); await click('Cancel'); t('Cancel preserves protection', destination.protected);
    D.properties(destination.id, { advanced: true }); await wait(35); await tab('Object'); fill('protected', false); await click('OK');
    t('Object tab applies protection change', !destination.protected);
    const cancelDelete = D.remove([computer]); await wait(30); await click('No'); await cancelDelete; t('No keeps object', !!A.get(computer.id));
    const deleteTree = D.remove([destination]); await wait(30); shade().querySelector('input[type=checkbox]').click(); await click('Yes'); await deleteTree;
    t('confirmed recursive deletion removes OU and child', !A.get(destination.id) && !A.get(computer.id));
    await wait(100); t('deleted scope falls back to a live tree node', mmc.current() && mmc.tree.node(mmc.current().id));
    t('invalid scope value does not mutate group', !A.setGroupScope(group.id, 'Invalid', 'Distribution').ok && group.category === 'Security');
    t('built-in groups keep scope controls disabled', A.get('Domain Users').critical);
    ps.exited = true; win.close(); t('console closes cleanly', !win.el.isConnected);
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
