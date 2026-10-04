/* Shell (Roadmap step 3): host bar, Win+X, Run, flyouts, toasts, dark mode, taskbar alignment, desktop New/View,
 * Windows Security, Change a password, Shutdown Event Tracker, unexpected-shutdown tracker, lock/resume, checkpoints.
 * &shot=hostbar|winx|run|quick|calendar|toast|dark|center|desktop|secure|tracker|unexpected stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* not yet */ } await wait(50); } return false; };
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const click = async label => { const b = [...shade().querySelectorAll('button')].find(x => x.textContent.trim() === label); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(80); };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const menu = () => [...document.querySelectorAll('.menu.ctx')].pop();
  const menuItem = label => [...menu().querySelectorAll('.menu-item')].find(x => x.textContent.replace(/\s+/g, ' ').trim().startsWith(label));
  const fire = (el, type, o = {}) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, ...o })); };
  const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const lastSys = id => WS.state.events.logs.System.filter(e => e.id === id).pop();
  async function signIn() {
    await waitFor(() => WS.shell.isLocked(), 10000);
    WS.shell.unlock(); await wait(120);
    const pw = document.querySelector('#overlays .login .pw input[type=password]');
    pw.value = WS.state.system.adminPassword;
    pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return waitFor(() => WS.session.loggedIn, 5000);
  }
  try {
    await wait(300);
    /* ---------------- host bar ---------------- */
    const hb = document.getElementById('hostbar');
    t('the VMConnect host bar is above the screen', !!hb && document.getElementById('screen').getBoundingClientRect().top >= hb.getBoundingClientRect().bottom - 1);
    t('it shows the VM as Running', WS.host.state() === 'Running' && hb.textContent.includes('Status: Running'));
    t('its Action menu lists the VMConnect commands', (() => { hb.querySelector('[data-menu="Action"]').click(); const m = menu(); const ok = m && ['Ctrl+Alt+Delete', 'Start', 'Turn Off...', 'Shut Down...', 'Save', 'Pause', 'Reset...', 'Checkpoint...', 'Revert...'].every(l => m.textContent.includes(l)); WS.ui.closeMenu(); return ok; })());
    WS.host.pause(); await wait(50);
    t('Pause dims the screen and the status says Paused', WS.host.state() === 'Paused' && !!document.querySelector('#vmstate.paused'));
    WS.host.resume();
    t('Resume clears it', WS.host.state() === 'Running' && !document.getElementById('vmstate'));
    WS.host.save(); await wait(50);
    t('Save blacks the screen out and keeps the session', WS.host.state() === 'Saved' && /is saved/.test(document.getElementById('vmstate').textContent) && WS.session.loggedIn);
    WS.host.start();
    t('Start resumes a saved VM where it was', WS.host.state() === 'Running' && !document.getElementById('vmstate') && !!WS.wm.find('servermanager'));
    if (stop('hostbar')) return;

    /* ---------------- Win+X ---------------- */
    const start = document.querySelector('#taskbar .tb-start');
    fire(start, 'contextmenu'); await wait(60);
    let m = menu();
    t('right-clicking Start opens the Win+X menu', !!m && m.classList.contains('winx'));
    t('Win+X lists the Windows Server 2025 items', ['Installed apps', 'Power Options', 'Event Viewer', 'System', 'Device Manager', 'Network Connections', 'Disk Management', 'Computer Management', 'Terminal', 'Terminal (Admin)', 'Task Manager', 'Settings', 'File Explorer', 'Search', 'Run', 'Shut down or sign out', 'Desktop'].every(l => !!menuItem(l)));
    t('it opens above the Start button', m.getBoundingClientRect().bottom <= start.getBoundingClientRect().top + 1);
    if (stop('winx')) return;
    menuItem('Event Viewer').click(); await wait(150);
    t('Win+X > Event Viewer opens Event Viewer', !!WS.wm.find('eventvwr'));
    WS.wm.find('eventvwr').close();

    /* ---------------- Run ---------------- */
    let run = WS.shell.run(); await wait(80);
    const layerH = document.getElementById('windows').clientHeight;
    t('Run opens at the bottom left', run.app === 'run' && parseInt(run.el.style.left) <= 20 && parseInt(run.el.style.top) + run.el.offsetHeight >= layerH - 20);
    t('Run shows the admin note and Browse', run.el.textContent.includes('This task will be created with administrative privileges.') && run.el.textContent.includes('Browse...'));
    if (stop('run')) return;
    run.runbox.input.value = 'nosuchthing.exe';
    run.runbox.ok(); await wait(100);
    t('an unknown name gets "Windows cannot find"', dlgText().includes("Windows cannot find 'nosuchthing.exe'. Make sure you typed the name correctly, and then try again."));
    await click('OK');
    t('...and Run stays open', !!WS.wm.find('run'));
    run.runbox.input.value = 'ncpa.cpl';
    await run.runbox.ok(); await wait(100);
    t('ncpa.cpl opens Network Connections and closes Run', !!WS.wm.find('ncpa') && !WS.wm.find('run'));
    WS.wm.find('ncpa').close();
    t('Run remembers what was typed', WS.personal.get().runMru[0] === 'ncpa.cpl');
    run = WS.shell.run(); await wait(50);
    t('the next Run starts with the last command', run.runbox.input.value === 'ncpa.cpl');
    run.runbox.input.value = 'ms-settings:about';
    await run.runbox.ok(); await wait(150);
    t('ms-settings:about opens Settings > About', !!WS.wm.find('settings') && WS.wm.find('settings').settings.page() === 'about');
    WS.wm.find('settings').close();
    run = WS.shell.run(); run.runbox.input.value = 'control'; await run.runbox.ok(); await wait(100);
    t('control opens Control Panel', !!WS.wm.find('control'));
    WS.wm.find('control').close();
    t('Task Manager is hosted under explorer.exe while Run is open', (() => { const w = WS.shell.run(); const ex = WS.proc.list().find(p => p.shell); const ok = ex && ex.windows.includes(w); w.close(); return ok; })());
    // Remove Run menu from Start Menu
    const gpu = WS.state.gp.applied.user = WS.state.gp.applied.user || { settings: {} };
    gpu.settings = gpu.settings || {};
    gpu.settings.NoRun = { value: { state: 'Enabled', options: {} } };
    WS.apps.launch('run'); await wait(80);
    t('Remove Run menu from Start Menu blocks Run with the restrictions message', dlgText().includes('This operation has been cancelled due to restrictions in effect on this computer.') && !WS.wm.find('run'));
    await click('OK');
    fire(start, 'contextmenu'); await wait(60);
    t('...and removes Run from Win+X', !menuItem('Run'));
    WS.ui.closeMenu();
    delete gpu.settings.NoRun;

    /* ---------------- Quick Settings ---------------- */
    document.querySelector('#taskbar .tray-quick').click(); await wait(60);
    let qs = document.querySelector('#flyouts .qs');
    t('the network/volume tray button opens Quick Settings', !!qs && qs.querySelector('.qs-net') && qs.querySelector('.qs-acc') && qs.querySelector('.qs-range'));
    t('the network tile is on (connected)', qs.querySelector('.qs-net').classList.contains('on'));
    if (stop('quick')) return;
    const slider = qs.querySelector('[data-field="volume"]');
    slider.value = 20; slider.dispatchEvent(new Event('input', { bubbles: true }));
    t('the volume slider sets the volume', WS.shell.volume().level === 20);
    qs.querySelector('.qs-spk').click(); await wait(30);
    t('the speaker button mutes, and the tray says so', WS.shell.volume().muted && document.querySelector('#taskbar .tray-quick').innerHTML.includes('M11 6l4 4'));
    document.querySelector('#flyouts .qs .qs-spk').click();
    document.querySelector('#flyouts .qs-acc .qs-tmore').click(); await wait(30);
    document.querySelector('#flyouts [data-field="colorfilters"]').click(); await wait(30);
    t('Accessibility > Color filters turns the screen grayscale', document.getElementById('screen').classList.contains('color-filter'));
    WS.shell.colorFilter(false);
    document.querySelector('#flyouts .qs-back').click(); await wait(30);
    document.querySelector('#flyouts .qs-net .qs-tmore').click(); await wait(30);
    t('the network arrow lists Ethernet with its network', document.querySelector('#flyouts .qs-sub').textContent.includes('Ethernet') && document.querySelector('#flyouts .qs-sub').textContent.includes('More Internet settings'));
    document.querySelector('#taskbar .tray-quick').click(); await wait(30);
    WS.shell.closeFlyouts();

    /* ---------------- toasts + notification center + calendar ---------------- */
    WS.shell.clearNotifications();
    WS.shell.toast({ app: 'Test', title: 'Hello toast', text: 'From the shell test' }); await wait(60);
    t('a toast appears above the tray', !!document.querySelector('#toasts .toast') && document.querySelector('#toasts .toast').textContent.includes('Hello toast'));
    t('the clock shows an unread badge', document.querySelector('#taskbar .tray-bell').classList.contains('unread'));
    if (stop('toast')) return;
    document.querySelector('#taskbar .tray-clock').click(); await wait(60);
    let nc = document.querySelector('#flyouts .nc');
    t('the clock opens the notification center with the toast', !!nc && nc.querySelector('.nc-notes').textContent.includes('Hello toast'));
    const today = WS.sys.now();
    const todayCell = nc.querySelector('.cal-day.today');
    t('the calendar highlights today (server time zone)', !!todayCell && todayCell.dataset.date === `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`);
    t('opening it marks notifications read', WS.shell.unreadCount() === 0 && !document.querySelector('#taskbar .tray-bell').classList.contains('unread'));
    if (stop('calendar')) return;
    nc.querySelector('[data-field="dnd"]').click(); await wait(30);
    t('the bell turns on Do not disturb', WS.personal.get().dnd === true);
    WS.shell.closeFlyouts();
    document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
    WS.shell.toast({ app: 'Test', title: 'Quiet one' }); await wait(40);
    t('with Do not disturb, toasts skip the banner but reach the center', !document.querySelector('#toasts .toast') && WS.shell.notifications().some(n => n.title === 'Quiet one'));
    WS.personal.set({ dnd: false });
    // lab objectives toast as they complete
    WS.state.lab = { activeId: 'lab01-initial-config', startedAt: new Date().toISOString(), completed: {} };
    WS.store.changed('lab'); await wait(60);
    const wgText = WS.labs.get('lab01-initial-config').objectives.find(o => o.id === 'workgroup').text;
    WS.sys.setWorkgroup('LAB'); await wait(120);
    t('completing a lab objective raises a Lab Guide toast', WS.shell.notifications().some(n => n.app === 'Lab Guide' && n.title === 'Objective complete' && n.text.startsWith(wgText) && /\(1 of \d+\)$/.test(n.text)), WS.shell.notifications().map(n => n.title + ':' + n.text));
    WS.labs.stop(); WS.sys.setWorkgroup('WORKGROUP'); WS.state.system.pendingReboot = []; WS.store.changed('system');
    document.querySelectorAll('#toasts .toast').forEach(x => x.remove());

    /* ---------------- dark mode, alignment, search ---------------- */
    WS.personal.set({ mode: 'dark', appMode: 'dark' }); await wait(60);
    t('dark mode sets the theme on the page', document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.appsTheme === 'dark');
    const tbBg = getComputedStyle(document.getElementById('taskbar')).backgroundColor;
    t('the taskbar goes dark', /rgba?\((2\d|3\d|1\d), ?(2\d|3\d|1\d), ?(2\d|3\d|1\d)/.test(tbBg), tbBg);
    WS.shell.toggleStart(); await wait(60);
    t('Start follows dark mode', getComputedStyle(document.querySelector('.start-menu')).color === 'rgb(255, 255, 255)');
    t('Win32 menus stay light in dark mode', (() => { const el = WS.ui.contextMenu(100, 100, [{ label: 'X' }]); const c = getComputedStyle(el).color; WS.ui.closeMenu(); return c === 'rgb(27, 27, 27)'; })());
    if (stop('dark')) return;
    WS.shell.closeFlyouts();
    WS.personal.set({ taskbarAlign: 'center', taskbarSearch: 'icon' }); await wait(80);
    const tbMain = document.querySelector('#taskbar .tb-main').getBoundingClientRect();
    t('Center alignment centres Start and the apps', Math.abs((tbMain.left + tbMain.right) / 2 - window.innerWidth / 2) < 4);
    t('Search icon only replaces the search box', !!document.querySelector('#taskbar .tb-searchicon') && !document.querySelector('#taskbar .tb-search'));
    if (stop('center')) return;
    WS.personal.set({ mode: 'light', appMode: 'light', taskbarAlign: 'left', taskbarSearch: 'box' }); await wait(60);
    t('back to light, left-aligned with the search box', document.documentElement.dataset.theme === 'light' && !!document.querySelector('#taskbar .tb-search') && document.querySelector('#taskbar .tb-main').getBoundingClientRect().left < 20);

    /* ---------------- desktop: View, Sort by, New ---------------- */
    WS.shell.showDesktop(); await wait(30);
    fire(document.elementFromPoint(600, 400), 'contextmenu'); await wait(60);
    m = menu();
    t('the desktop menu has View, Sort by, Refresh, New, Display settings, Personalize', ['View', 'Sort by', 'Refresh', 'New', 'Display settings', 'Personalize'].every(l => !!menuItem(l)));
    WS.ui.closeMenu();
    const nf = WS.shell.desktopNew('dir'); await wait(60);
    const ren = document.querySelector('#desktop-icons .desk-rename');
    t('New > Folder makes "New folder" and starts renaming it', nf === 'New folder' && !!ren && ren.value === 'New folder');
    ren.value = 'Scripts';
    ren.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(80);
    t('renaming it on the desktop renames the folder', WS.fs.isDir(WS.shell.DESKTOP + '\\Scripts') && !!document.querySelector('#desktop-icons .desk-icon[data-name="Scripts"]'));
    WS.shell.desktopNew('file'); await wait(40);
    const ren2 = document.querySelector('#desktop-icons .desk-rename');
    ren2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(60);
    t('New > Text Document makes "New Text Document.txt"', WS.fs.exists(WS.shell.DESKTOP + '\\New Text Document.txt') && !!document.querySelector('#desktop-icons .desk-icon[data-name="New Text Document.txt"]'));
    WS.fs.writeFile(WS.shell.DESKTOP + '\\notes.txt', 'hello'); await wait(60);
    t('files written to the Desktop folder elsewhere show up', !!document.querySelector('#desktop-icons .desk-icon[data-name="notes.txt"]'));
    fire(document.querySelector('#desktop-icons .desk-icon[data-name="notes.txt"]'), 'dblclick'); await wait(120);
    t('double-clicking a text file opens it in Notepad', !!WS.wm.find('notepad'));
    WS.wm.find('notepad').close();
    WS.personal.set({ desktop: { iconSize: 'small' } }); await wait(60);
    t('View > Small icons', document.getElementById('desktop-icons').dataset.size === 'small');
    if (stop('desktop')) return;
    WS.personal.set({ desktop: { iconSize: 'medium', showIcons: false } }); await wait(40);
    t('View > Show desktop icons off hides them', getComputedStyle(document.getElementById('desktop-icons')).display === 'none');
    WS.personal.set({ desktop: { showIcons: true } });

    /* ---------------- time zone clock ---------------- */
    WS.sys.setTimeZone('Tokyo Standard Time');
    WS.shell.renderTaskbar(); await wait(30);
    const tokyoHour = +new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hourCycle: 'h23', hour: 'numeric' }).format(new Date()) % 24;
    t('the clock follows the server time zone', WS.sys.now().getHours() === tokyoHour && document.querySelector('#taskbar .tb-clock').textContent.startsWith(WS.util.fmtTime(WS.sys.now())));
    WS.sys.setTimeZone('Pacific Standard Time'); WS.shell.renderTaskbar();

    /* ---------------- Windows Security (Ctrl+Alt+Del) and Change a password ---------------- */
    key('End', { ctrlKey: true, altKey: true }); await wait(60);
    let sec = document.querySelector('#overlays .secure');
    t('Ctrl+Alt+End opens the Windows Security screen', !!sec && ['Lock', 'Switch user', 'Sign out', 'Change a password', 'Task Manager'].every(l => !!sec.querySelector(`[data-item="${l}"]`)) && sec.textContent.includes('Cancel'));
    if (stop('secure')) return;
    key('Escape'); await wait(40);
    t('Esc returns to the desktop', !document.querySelector('#overlays .secure') && WS.session.loggedIn);
    WS.host.cad(); await wait(40);
    t('the host bar’s Ctrl+Alt+Delete does the same', !!document.querySelector('#overlays .secure'));
    document.querySelector('#overlays .secure [data-item="Change a password"]').click(); await wait(60);
    const cp = document.querySelector('#overlays .cpw');
    const oldPw = WS.state.system.adminPassword;
    const fill = (o, n, c) => { cp.querySelector('[data-field="old"]').value = o; cp.querySelector('[data-field="new"]').value = n; cp.querySelector('[data-field="confirm"]').value = c; cp.querySelector('.cpw-go').click(); };
    fill('wrong', 'N3w-P@ssword!', 'N3w-P@ssword!'); await wait(40);
    t('a wrong old password is refused', cp.textContent.includes('The password is incorrect. Try again.'));
    cp.querySelector('.cpw-notice .btn').click(); await wait(20);
    fill(oldPw, 'N3w-P@ssword!', 'Different1!'); await wait(40);
    t('mismatched new passwords are refused', cp.textContent.includes('The passwords don’t match.'));
    cp.querySelector('.cpw-notice .btn').click(); await wait(20);
    fill(oldPw, 'abc', 'abc'); await wait(40);
    t('a password that fails complexity is refused', cp.textContent.includes('does not meet the length, complexity, or history requirements'));
    cp.querySelector('.cpw-notice .btn').click(); await wait(20);
    fill(oldPw, 'N3w-P@ssword!', 'N3w-P@ssword!'); await wait(40);
    t('a good change says "Your password has been changed."', cp.textContent.includes('Your password has been changed.') && WS.state.system.adminPassword === 'N3w-P@ssword!');
    cp.querySelector('.cpw-notice .btn').click(); await wait(20);
    WS.local.setPassword('Administrator', oldPw);

    /* ---------------- lock keeps the session ---------------- */
    WS.apps.launch('notepad'); await wait(60);
    const smCount = WS.wm.windows.filter(w => w.app === 'servermanager').length;
    WS.shell.lockSession(); await wait(60);
    t('Lock shows the lock screen', WS.shell.isLocked() && !WS.session.loggedIn);
    await signIn(); await wait(150);
    t('unlocking returns to the same windows without a new logon', !!WS.wm.find('notepad') && WS.wm.windows.filter(w => w.app === 'servermanager').length === smCount);
    WS.wm.find('notepad').close();

    /* ---------------- Shutdown Event Tracker ---------------- */
    let tracker = null;
    const pending = WS.shell.shutdownTracker(true, { onCreate: o => { tracker = o; } });
    await wait(60);
    t('Restart asks why (Shutdown Event Tracker)', !!tracker && document.querySelector('.modern-dlg.sdt h2').textContent === 'Choose a reason that best describes why you want to restart this computer');
    t('the reasons are the Windows ones, Other (Planned) first', tracker.select.options[0].textContent === 'Other (Planned)' && [...tracker.select.options].some(o => o.textContent === 'Operating System: Security fix (Planned)'));
    if (stop('tracker')) return;
    tracker.cancel();
    t('Cancel keeps the session', (await pending) === null && WS.session.loggedIn);
    // the real power-menu path: Restart -> tracker -> Continue -> restart with the reason in event 1074
    const powerRestart = WS.shell.powerItems().find(([l]) => l === 'Restart')[1];
    powerRestart(); await wait(80);
    const sel = document.querySelector('.modern-dlg.sdt select');
    sel.value = String(WS.shell.REASONS.findIndex(r => r.title === 'Application: Installation (Planned)')); sel.dispatchEvent(new Event('change'));
    [...document.querySelectorAll('.modern-dlg.sdt button')].find(b => b.textContent === 'Continue').click();
    await waitFor(() => !WS.session.loggedIn, 3000);
    const e1074 = lastSys(1074);
    t('event 1074 records the reason and its code', !!e1074 && e1074.message.includes('for the following reason: Application: Installation (Planned)') && e1074.message.includes('Reason Code: 0x80040002') && e1074.message.includes('Shutdown Type: restart'), e1074 && e1074.message);
    t('...and the server restarts', await signIn());

    /* ---------------- checkpoints, Turn Off and the unexpected-shutdown tracker ---------------- */
    WS.fs.writeFile(WS.shell.DESKTOP + '\\before-checkpoint.txt', 'x');
    const cpt = await WS.host.checkpoint('Shell test checkpoint');
    t('Checkpoint saves the lab', !!cpt && WS.host.checkpoints().some(c => c.name === 'Shell test checkpoint'));
    WS.fs.writeFile(WS.shell.DESKTOP + '\\after-checkpoint.txt', 'x');
    await WS.host.turnOff({ confirm: false }); await wait(60);
    t('Turn Off powers the VM off at once', WS.host.state() === 'Off' && !WS.session.loggedIn && WS.wm.windows.length === 0);
    WS.host.start();
    await waitFor(() => WS.shell.isLocked(), 8000);
    t('Start boots it and the System log reports the unexpected shutdown (41, 6008)', lastSys(41) && lastSys(6008) && /was unexpected\.$/.test(lastSys(6008).message) && !!WS.state.system.unexpectedShutdown);
    await signIn();
    await waitFor(() => dlgText().includes('Why did the computer shut down unexpectedly?'), 3000);
    t('the first sign-in asks "Why did the computer shut down unexpectedly?"', dlgText().includes('Why did the computer shut down unexpectedly?'));
    if (stop('unexpected')) return;
    const okBtn = [...shade().querySelectorAll('button')].find(b => b.textContent === 'OK');
    t('Other (Unplanned) needs a comment before OK', okBtn.disabled);
    const ta = shade().querySelector('[data-field="comment"]');
    ta.value = 'Pulled the plug in the shell test'; ta.dispatchEvent(new Event('input'));
    await click('OK');
    t('the answer is logged as event 1076 and the question is cleared', lastSys(1076) && lastSys(1076).message.includes('Other (Unplanned)') && lastSys(1076).message.includes('Pulled the plug') && !WS.state.system.unexpectedShutdown);
    await WS.host.revert({ confirm: false });
    await waitFor(() => WS.shell.isLocked(), 8000);
    t('Revert returns to the checkpoint', WS.fs.exists(WS.shell.DESKTOP + '\\before-checkpoint.txt') && !WS.fs.exists(WS.shell.DESKTOP + '\\after-checkpoint.txt'));
    t('...without an unexpected-shutdown question', !WS.state.system.unexpectedShutdown);
    WS.store.deleteCheckpoint(cpt.id);
    await signIn();
    t('About Virtual Machine Connection says it is not affiliated with Microsoft', await (async () => { WS.host.about(); await wait(60); const ok = dlgText().includes('not affiliated with'); await click('OK'); return ok; })());
  } catch (e) {
    fail++;
    console.log('FAIL exception: ' + (e && e.stack || e));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
