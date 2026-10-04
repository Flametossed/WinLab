/* Server Manager end-to-end test: a first-day lab done entirely through the GUI.
 * Open tests/sm-test.html?quick=1 in a throwaway profile with --virtual-time-budget=60000.
 * &shot=<dashboard|local|flag|required|roles|confirm|results|adds|prereq|dhcp|sysdm|remove> stops there for a screenshot. */
(async function () {
  const WS = window.WS, h = WS.h;
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? ' :: ' + JSON.stringify(extra) : '')); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = new URLSearchParams(location.search).get('shot');
  const stop = name => shot === name;
  const topShade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const btn = (label, scope) => [...(scope || topShade() || document).querySelectorAll('button')].find(b => b.textContent.trim() === label);
  const dlgText = () => (topShade() ? topShade().textContent : '');
  const clickDlg = async label => { const b = btn(label); if (b) b.click(); await wait(40); return !!b; };
  const sm = () => WS.wm.find('servermanager');
  const navTo = async id => { sm().sm.go(id); await wait(30); };
  const wzBtn = (w, label) => [...w.el.querySelectorAll('.wz-buttons button')].find(b => b.textContent.trim() === label);
  const next = async w => { w.next(); await wait(80); };

  try {
    await wait(200);
    /* ---------------- Server Manager basics ---------------- */
    t('server manager opens at sign-in', !!sm());
    t('dashboard tiles', sm().el.querySelectorAll('.sm-tile').length >= 3);
    t('no notifications yet', !sm().el.querySelector('.sm-flag.warn'));
    if (stop('dashboard')) return;
    await navTo('local');
    t('local server properties', sm().el.textContent.includes('Computer name') && sm().el.textContent.includes('Total disk space'));
    t('local server sections', ['EVENTS', 'SERVICES', 'ROLES AND FEATURES'].every(s => sm().el.textContent.includes(s)));
    if (stop('local')) return;

    /* ---------------- System Properties: rename + RDP + time zone ---------------- */
    const link = [...sm().el.querySelectorAll('.sm-prow .v.link')][0];
    link.click(); await wait(60);
    t('computer name opens System Properties', dlgText().includes('System Properties') && dlgText().includes('Full computer name'));
    if (stop('sysdm')) return;
    btn('Change...').click(); await wait(60);
    const nameInput = topShade().querySelector('input[type=text]');
    // try joining a domain first: no DC can be contacted
    const radios = topShade().querySelectorAll('input[type=radio]');
    radios[0].click(); await wait(10);
    topShade().querySelectorAll('input[type=text]')[1].value = 'contoso.local';
    btn('OK').click(); await wait(60);
    t('domain join fails (no DC)', dlgText().includes('could not be contacted'));
    await clickDlg('OK');
    radios[1].click(); await wait(10);
    nameInput.value = 'DC01'; nameInput.dispatchEvent(new Event('input'));
    btn('OK').click(); await wait(60);
    t('restart required message', dlgText().includes('You must restart your computer'));
    await clickDlg('OK');
    t('pending name shown', dlgText().includes('Changes will take effect after you restart'));
    [...document.querySelectorAll('.ps-tab')].find(x => x.textContent === 'Remote').click(); await wait(20);
    const rdpAllow = [...topShade().querySelectorAll('label.chk')].find(l => l.textContent.startsWith('Allow remote connections')).querySelector('input');
    rdpAllow.click(); await wait(10);
    btn('OK').click(); await wait(80);
    t('restart now/later prompt', dlgText().includes('You must restart your computer to apply these changes'));
    await clickDlg('Restart Later');
    t('rename pending + RDP enabled', WS.state.system.pendingComputerName === 'DC01' && WS.state.system.rdpEnabled && WS.fw.find('Remote Desktop - User Mode (TCP-In)')[0].enabled);
    WS.cpl.timeZoneDialog(); await wait(40);
    topShade().querySelector('select').value = 'Eastern Standard Time';
    await clickDlg('OK');
    t('time zone changed', WS.state.system.timeZoneId === 'Eastern Standard Time');
    WS.sys.onShutdown(true); WS.sys.onBoot(); await wait(60);
    t('name applied after restart', WS.sys.name === 'DC01');

    /* ---------------- Add Roles: static IP warning ---------------- */
    let w, x;
    WS.sm.addRoles({ onCreate: (wz, api) => { w = wz; x = api; } }); await wait(80);
    t('add roles wizard opens on Before You Begin', w.page.id === 'before' && w.el.querySelector('.wz-step.cur').textContent === 'Before You Begin');
    x.toggle('DNS', true); await wait(60);
    t('dynamic IP validation warning', dlgText().includes('dynamically assigned IP addresses'));
    await clickDlg('Cancel');
    t('cancel leaves DNS unselected', !x.sel.has('DNS'));
    wzBtn(w, 'Cancel').click(); await wait(40);
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.net.setDnsServers('Ethernet', ['127.0.0.1']);

    /* ---------------- Add Roles: AD DS + DHCP ---------------- */
    WS.sm.addRoles({ onCreate: (wz, api) => { w = wz; x = api; } }); await wait(80);
    await next(w); await next(w); await next(w);
    t('reached Server Roles', w.page.id === 'roles' && w.el.textContent.includes('Active Directory Domain Services'));
    t('installed role shows (x of y installed)', /File and Storage Services \(\d+ of \d+ installed\)/.test(w.el.textContent));
    x.toggle('AD-Domain-Services', true); await wait(60);
    t('required features dialog', dlgText().includes('Add features that are required for Active Directory Domain Services?') && dlgText().includes('[Tools] Group Policy Management'));
    if (stop('required')) return;
    await clickDlg('Add Features');
    t('AD DS + tools selected', x.sel.has('AD-Domain-Services') && x.sel.has('GPMC') && x.sel.has('RSAT-ADDS-Tools'));
    x.toggle('DHCP', true); await wait(60);
    await clickDlg('Add Features');
    t('DHCP selected', x.sel.has('DHCP') && x.sel.has('RSAT-DHCP'));
    if (stop('roles')) { w.el.querySelector('.ft-row') && 0; return; }
    await next(w);
    t('features page', w.page.id === 'features');
    await next(w);
    t('AD DS intro page', w.page.id === 'role:AD-Domain-Services' && w.el.textContent.includes('Things to note:'));
    t('nav lists role pages', [...w.el.querySelectorAll('.wz-step')].map(s => s.textContent).join('|').includes('AD DS|DHCP Server|Confirmation'));
    await next(w); await next(w);
    t('confirmation page, install enabled', w.page.id === 'confirm' && !wzBtn(w, 'Install').disabled && w.el.textContent.includes('Group Policy Management'));
    if (stop('confirm')) return;
    wzBtn(w, 'Install').click(); await wait(100);
    t('results page shows progress', w.page.id === 'results' && w.el.textContent.includes('Installation started'));
    await wait(1800);
    t('installed', WS.features.isInstalled('AD-Domain-Services') && WS.features.isInstalled('DHCP') && WS.svc.isRunning('DHCPServer'));
    t('results say configuration required', w.el.textContent.includes('Configuration required. Installation succeeded on DC01'));
    t('results link to promote', w.el.textContent.includes('Promote this server to a domain controller'));
    if (stop('results')) return;
    wzBtn(w, 'Close').click(); await wait(80);

    /* ---------------- notifications ---------------- */
    t('flag shows warning', !!sm().el.querySelector('.sm-flag.warn'));
    sm().el.querySelector('.sm-flag').click(); await wait(40);
    const notesEl = sm().el.querySelector('.sm-notes');
    t('flyout lists post-deployment tasks', notesEl && notesEl.textContent.includes('Promote this server to a domain controller') && notesEl.textContent.includes('Complete DHCP configuration'));
    if (stop('flag')) return;
    sm().el.querySelector('.sm-flag').click(); await wait(20);
    await navTo('role:AD-Domain-Services');
    t('AD DS role page banner', sm().el.querySelector('.sm-banner') && sm().el.textContent.includes('Configuration required for Active Directory Domain Services at DC01'));
    WS.sm.taskDetails(); await wait(40);
    t('task details lists tasks', dlgText().includes('All Servers Task Details') && dlgText().includes('Promote this server'));
    await clickDlg('Close');

    /* ---------------- AD DS Configuration Wizard ---------------- */
    let a, d;
    WS.sm.addsConfig({ onCreate: (wz, data) => { a = wz; d = data; }, noRestart: true, restartDelay: 50 }); await wait(80);
    t('adds wizard opens', a.page.id === 'deploy' && a.el.textContent.includes('TARGET SERVER'));
    await next(a);
    t('existing domain needs a domain name', dlgText().includes('You must specify the domain name.'));
    await clickDlg('OK');
    [...a.el.querySelectorAll('label.chk')].find(l => l.textContent === 'Add a new forest').querySelector('input').click(); await wait(20);
    const rootIn = a.el.querySelector('.wz-page:not([style*="none"]) input[type=text]');
    rootIn.value = 'contoso'; rootIn.dispatchEvent(new Event('input'));
    await next(a);
    t('single-label name rejected', dlgText().includes('single-label DNS name'));
    await clickDlg('OK');
    rootIn.value = 'contoso.local'; rootIn.dispatchEvent(new Event('input'));
    await next(a);
    t('domain controller options', a.page.id === 'options');
    if (stop('adds')) return;
    const pws = [...a.el.querySelectorAll('.wz-page:not([style*="none"]) input[type=password]')];
    pws[0].value = 'P@ssw0rd!'; pws[0].dispatchEvent(new Event('input'));
    pws[1].value = 'different1!'; pws[1].dispatchEvent(new Event('input'));
    await next(a);
    t('DSRM mismatch rejected', dlgText().includes('The passwords do not match.'));
    await clickDlg('OK');
    pws[1].value = 'P@ssw0rd!'; pws[1].dispatchEvent(new Event('input'));
    await next(a);
    t('DNS options delegation warning', a.page.id === 'dns' && a.el.textContent.includes('A delegation for this DNS server cannot be created'));
    await next(a);
    await wait(800);
    t('NetBIOS name computed', d.netbios === 'CONTOSO');
    await next(a); await next(a);
    t('review options', a.page.id === 'review' && a.el.textContent.includes('The new domain name is "contoso.local"'));
    await next(a);
    await wait(1300);
    t('prerequisites passed', a.el.textContent.includes('All prerequisite checks passed successfully') && !wzBtn(a, 'Install').disabled);
    if (stop('prereq')) return;
    wzBtn(a, 'Install').click();
    await wait(4000);
    t('promoted to DC', WS.sys.isDC() && WS.state.system.domain === 'contoso.local' && WS.ad.netbios() === 'CONTOSO');
    t('sign-out notice shown', dlgText().includes("You're about to be signed out") || a.el.textContent.includes('successfully configured as a domain controller'));
    await clickDlg('Close');
    a.close();
    WS.sys.onShutdown(true); WS.sys.onBoot(); await wait(60);
    if (!sm()) WS.apps.launch('servermanager');
    await wait(60);
    t('AD DS post task gone, DHCP remains', !WS.features.postTasks().some(p => p.id === 'adds') && WS.features.postTasks().some(p => p.id === 'dhcp'));

    /* ---------------- DHCP post-install ---------------- */
    let dw, dd;
    WS.sm.dhcpConfig({ onCreate: (wz, data) => { dw = wz; dd = data; } }); await wait(80);
    await next(dw);
    t('authorization page on a DC', dw.page.id === 'auth' && [...dw.el.querySelectorAll('input')].some(i => i.value.startsWith('CONTOSO\\')));
    await next(dw);
    t('summary page with Commit', dw.page.id === 'summary' && !wzBtn(dw, 'Commit').disabled);
    wzBtn(dw, 'Commit').click(); await wait(900);
    t('commit done', dw.page.id === 'done' && dw.el.textContent.includes('Done') && WS.dhcp.authorized && !!WS.ad.get('DHCP Administrators', 'group'));
    t('summary step highlighted', dw.el.querySelector('.wz-step.cur') && dw.el.querySelector('.wz-step.cur').textContent === 'Summary');
    if (stop('dhcp')) return;
    wzBtn(dw, 'Close').click(); await wait(40);
    t('no post-deployment tasks left', WS.features.postTasks().length === 0);

    /* ---------------- role pages and tiles ---------------- */
    await navTo('dashboard');
    const navLabels = [...sm().el.querySelectorAll('.sm-nav > div .l')].map(n => n.textContent);
    t('nav has role pages', ['AD DS', 'DHCP', 'DNS', 'File and Storage Services'].every(l => navLabels.includes(l)), navLabels);
    WS.svc.stop('Spooler'); await wait(80);
    const localTile = [...sm().el.querySelectorAll('.sm-tile')].find(tl => tl.textContent.startsWith('Local Server'));
    t('stopped automatic service flags Local Server tile', localTile.classList.contains('bad') && [...localTile.querySelectorAll('.r.bad')].some(r => r.textContent.startsWith('Services')));
    await navTo('role:DNS');
    t('DNS role page lists DNS service', [...sm().el.querySelectorAll('.lv-row')].some(r => r.dataset.id === 'DNS'));

    /* ---------------- Remove Roles ---------------- */
    let rw, rx;
    WS.sm.removeRoles({ onCreate: (wz, api) => { rw = wz; rx = api; } }); await wait(80);
    t('remove wizard title', rw.el.textContent.includes('Before you begin'));
    rx.toggle('AD-Domain-Services', false); await wait(60);
    t('AD DS on a DC cannot be removed', dlgText().includes('needs to be demoted'));
    await clickDlg('OK');
    rx.toggle('DHCP', false); await wait(60);
    t('remove features dialog', dlgText().includes('Remove features that require DHCP Server?'));
    await clickDlg('Remove Features');
    t('DHCP + tools marked for removal', rx.rem.has('DHCP') && rx.rem.has('RSAT-DHCP'));
    while (rw.page.id !== 'confirm') await next(rw);
    t('remove confirmation lists DHCP', rw.el.textContent.includes('DHCP Server') && !wzBtn(rw, 'Remove').disabled);
    if (stop('remove')) return;
    wzBtn(rw, 'Remove').click(); await wait(2000);
    t('removal pending restart', rw.el.textContent.includes('Restart pending') && WS.features.installState('DHCP') === 'UninstallPending');
    wzBtn(rw, 'Close').click();
  } catch (e) {
    fail++;
    console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
