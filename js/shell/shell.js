/* Shell: app registry, boot -> OOBE -> lock -> sign-in -> desktop, the desktop (icons, files on the Desktop folder,
 * View / Sort by / New), the taskbar (alignment, search, tray), Start menu and power. The Run box, Win+X menu,
 * Shutdown Event Tracker and Windows Security screen live in shell-dialogs.js; quick settings, the calendar,
 * notifications and toasts in flyouts.js; the VMConnect bar in hostbar.js. Those attach to WS.shell. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util;

  const I = WS.icons; // js/core/icons.js

  /* ---------------- app registry ---------------- */
  const apps = {};
  WS.apps = {
    register(def) { apps[def.id] = def; },
    get: id => apps[id],
    launch(id, args) {
      const app = apps[id];
      if (!app) return notImplemented(id);
      // with explorer.exe ended, "explorer" starts the shell again instead of opening a window
      if (id === 'explorer' && WS.proc && !WS.proc.explorerRunning()) { WS.proc.startExplorer(); return null; }
      const blocked = restricted(id);
      if (blocked) { WS.ui.msgbox({ title: blocked[0], icon: 'warning', message: blocked[1] }); return null; }
      if (app.singleton) { const w = WS.wm.find(id); if (w) { w.restore(); if (app.reuse) app.reuse(w, args || {}); return w; } }
      return app.launch(args || {});
    },
    list: () => Object.values(apps)
  };

  /* ---------------- Group Policy on the shell (what the last policy processing applied) ---------------- */
  const gpComp = key => (WS.gpo ? WS.gpo.effective('computer', key) : undefined);
  const gpOn = (side, key) => !!(WS.gpo && WS.gpo.policyEnabled(side, key));
  const RESTRICTED = 'This operation has been cancelled due to restrictions in effect on this computer. Please contact your system administrator.';
  const CPL_APPS = new Set(['control', 'sysdm', 'timedate', 'ncpa', 'firewall', 'appwiz', 'netcenter', 'settings']);
  const MMC_APPS = new Set(['services', 'dsa', 'dnsmgmt', 'dhcpmgmt', 'eventvwr', 'compmgmt', 'diskmgmt', 'gpmc', 'gpme', 'gpedit', 'wf', 'lusrmgr', 'fsmgmt', 'devmgmt']);
  const EXE = { notepad: 'notepad.exe', explorer: 'explorer.exe', terminal: 'windowsterminal.exe', powershell: 'powershell.exe', cmd: 'cmd.exe', servermanager: 'servermanager.exe', taskmgr: 'taskmgr.exe', regedit: 'regedit.exe', edge: 'msedge.exe', settings: 'systemsettings.exe', control: 'control.exe' };
  /** [title, message] when user policy blocks an app (Prohibit access to Control Panel, Remove Task Manager, Don't run specified Windows applications...). */
  function restricted(id) {
    if (!WS.gpo || !(WS.session && WS.session.loggedIn)) return null;
    if (CPL_APPS.has(id) && gpOn('user', 'NoControlPanel')) return ['Restrictions', RESTRICTED];
    if (id === 'run' && gpOn('user', 'NoRun')) return ['Restrictions', RESTRICTED];
    if (id === 'taskmgr' && gpOn('user', 'DisableTaskMgr')) return ['Task Manager', 'Task Manager has been disabled by your administrator.'];
    if (id === 'regedit' && gpOn('user', 'DisableRegistryTools')) return ['Registry Editor', 'Registry editing has been disabled by your administrator.'];
    if (id === 'appwiz' && gpOn('user', 'NoProgramsAndFeatures')) return ['Programs and Features', 'Your system administrator has disabled Programs and Features.'];
    const deny = WS.gpo.policyOption('user', 'DisallowRun', 'DisallowRunList');
    const exe = MMC_APPS.has(id) ? 'mmc.exe' : EXE[id];
    if (deny && exe && deny.some(x => x.toLowerCase().replace(/^.*\\/, '') === exe)) return ['Restrictions', RESTRICTED];
    return null;
  }

  function notImplemented(name) {
    const w = WS.wm.create({ app: 'stub', title: name, icon: I.info, width: 420, height: 180, resizable: false });
    w.body.appendChild(h('div', { style: 'padding:20px;display:flex;gap:14px' },
      h('div', { html: I.info, style: 'width:32px;flex:none' }),
      h('div', h('div', { style: 'font-weight:600;margin-bottom:6px' }, `"${name}" is not built yet.`),
        h('div', { style: 'color:#555' }, 'This tool is planned but not part of the current skeleton. See HANDOFF.md.'))));
    return w;
  }
  WS.apps.notImplemented = notImplemented;

  // Placeholder registrations for pinned items; the real apps register over them.
  ['explorer|File Explorer', 'powershell|Windows PowerShell', 'edge|Microsoft Edge', 'lab|Lab Guide'].forEach(s => {
    const [id, name] = s.split('|');
    WS.apps.register({ id, name, icon: I[id], launch: () => notImplemented(name) });
  });

  /* ---------------- overlays ---------------- */
  const overlays = () => document.getElementById('overlays');
  function showOverlay(cls, ...children) {
    U.clear(overlays());
    const el = h('div.overlay.' + cls, ...children);
    overlays().appendChild(el);
    return el;
  }
  function clearOverlay() { U.clear(overlays()); }

  function wallpaperStyle() { return getComputedStyle(document.getElementById('wallpaper')).background; }
  const now = () => (WS.sys.now ? WS.sys.now() : new Date());

  /* ---------------- boot sequence ---------------- */
  async function boot(statusText) {
    closeFlyouts();
    WS.wm.closeAll();
    document.getElementById('taskbar').style.display = 'none';
    const status = h('div.status', statusText || '');
    showOverlay('boot',
      h('div.logo', { html: I.winlogoWhite }),
      h('div.spinner', h('i'), h('i'), h('i'), h('i'), h('i')),
      status);
    await U.sleep(statusText ? 1800 : 2200);
    WS.session.resume = false;
    WS.sys.onBoot();
    if (WS.wu) WS.wu.reset();
    if (WS.personal) WS.personal.apply();
    if (!WS.state.meta.oobeDone) return oobe();
    lock();
  }

  /* First boot: set the built-in Administrator password ("Customize settings"). */
  function oobe() {
    const pw1 = h('input', { type: 'password', autocomplete: 'new-password' });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div.err');
    const finish = () => {
      if (pw1.value !== pw2.value) { err.textContent = 'The passwords don’t match. Try again.'; return; }
      const bad = U.checkPassword(pw1.value, { minLength: 8, message: 'The password doesn’t meet the complexity requirements. Use at least 8 characters with three of: uppercase, lowercase, numbers, symbols.' });
      if (bad) { err.textContent = bad; return; }
      WS.state.system.adminPassword = pw1.value;
      WS.state.meta.oobeDone = true;
      WS.store.changed('system');
      WS.store.save();
      lock();
    };
    [pw1, pw2].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') finish(); }));
    showOverlay('oobe', h('div.panel',
      h('h1', 'Customize settings'),
      h('p', 'Type a password for the built-in administrator account that you can use to sign in to this computer.'),
      h('label', 'User name'), h('input', { value: 'Administrator', readOnly: true }),
      h('label', 'Password'), pw1,
      h('label', 'Reenter password'), pw2,
      err,
      h('div.actions', h('button.btn.primary', { onClick: finish }, 'Finish'))));
    setTimeout(() => pw1.focus(), 50);
  }

  /* Lock screen: Ctrl+Alt+Del can't be captured by a browser, so any key/click, Ctrl+Alt+End or the host bar's Ctrl+Alt+Delete unlocks. */
  let lockGo = null;
  function lock() {
    closeFlyouts();
    WS.session.loggedIn = false;
    document.getElementById('taskbar').style.display = 'none';
    const time = h('div.time'), date = h('div.date');
    const tick = () => { const d = now(); time.textContent = U.fmtTime(d).replace(/ [AP]M$/, ''); date.textContent = U.fmtLongDate(d).replace(/, \d{4}$/, ''); };
    tick();
    const timer = setInterval(tick, 1000);
    const noCad = gpComp('DisableCAD') === true;
    // Do not display the lock screen only applies when Ctrl+Alt+Del isn't required (Interactive logon: Do not require CTRL+ALT+DEL)
    if (noCad && gpOn('computer', 'NoLockScreen')) { clearInterval(timer); return legalNotice(); }
    const el = showOverlay('lock', h('div.bg', { style: { background: wallpaperStyle() } }), time, date,
      noCad ? h('div.hint', 'Click or press any key to sign in.') : h('div.hint', 'Press Ctrl+Alt+Delete to unlock.', h('small', '(In the browser: click, press any key, or use Ctrl+Alt+End)')));
    const go = e => {
      if (e && e.type === 'keydown' && ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // wait for the full Ctrl+Alt+End chord
      clearInterval(timer); document.removeEventListener('keydown', go); lockGo = null; legalNotice();
    };
    lockGo = go;
    el.addEventListener('click', go);
    setTimeout(() => { if (lockGo === go) document.addEventListener('keydown', go); }, 300);
  }

  /** Interactive logon: Message title/text for users attempting to log on - shown after Ctrl+Alt+Del, before the sign-in screen. */
  function legalNotice() {
    const text = gpComp('LegalNoticeText'), caption = gpComp('LegalNoticeCaption');
    if (!text || !String(text).trim()) return login();
    const ok = h('button.btn.primary', { onClick: () => { document.removeEventListener('keydown', key, true); login(); } }, 'OK');
    const key = e => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } };
    showOverlay('login.legal', h('div.bg', { style: { background: wallpaperStyle(), zIndex: -1, filter: 'blur(20px)' } }),
      h('div.legal-box', h('div.legal-title', caption || ''), h('div.legal-text', String(text)), h('div.actions', ok)));
    document.addEventListener('keydown', key, true);
    setTimeout(() => ok.focus(), 50);
  }

  function login() {
    const pw = h('input', { type: 'password', placeholder: 'Password' });
    const msg = h('div.msg');
    const user = WS.state.system.domain ? `${WS.state.system.domain.split('.')[0].toUpperCase()}\\Administrator` : 'Administrator';
    // Interactive logon: Don't display last signed-in -> an empty user name box instead of the last user's tile
    const hideLast = gpComp('DontDisplayLastUserName') === true;
    const name = hideLast ? h('input', { type: 'text', placeholder: 'User name', spellcheck: false }) : null;
    const submit = async () => {
      if (name) {
        const n = name.value.trim().toLowerCase(), d = WS.state.system.domain ? WS.state.system.domain.split('.')[0].toLowerCase() : null;
        const okName = n === 'administrator' || (d && (n === `${d}\\administrator` || n === `administrator@${WS.state.system.domain.toLowerCase()}`)) || n === `${WS.state.system.computerName.toLowerCase()}\\administrator` || n === '.\\administrator';
        if (!okName || pw.value !== WS.state.system.adminPassword) { msg.textContent = 'The user name or password is incorrect. Try again.'; pw.value = ''; pw.focus(); return; }
      }
      if (pw.value !== WS.state.system.adminPassword) { msg.textContent = 'The user name or password is incorrect. Try again.'; pw.value = ''; pw.focus(); return; }
      msg.textContent = 'Welcome';
      await U.sleep(900);
      if (WS.session.resume) { resumeSession(); return; }
      startSession('Administrator');
      // after an unexpected shutdown, the first administrator to sign in is asked why (Shutdown Event Tracker)
      if (WS.state.system.unexpectedShutdown && WS.shell.unexpectedShutdownTracker) setTimeout(() => WS.shell.unexpectedShutdownTracker(), 600);
    };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    if (name) name.addEventListener('keydown', e => { if (e.key === 'Enter') pw.focus(); });
    showOverlay('login',
      h('div.bg', { style: { background: wallpaperStyle(), zIndex: -1, filter: 'blur(20px)' } }),
      h('div.avatar', { html: I.user }), name ? h('div.pw.user', name) : h('div.name', user),
      h('div.pw', pw, h('button', { onClick: submit, title: 'Submit' }, '→')),
      msg,
      h('div.reset', { onClick: resetLab }, 'Forgot the password? Reset the lab'));
    setTimeout(() => (name || pw).focus(), 50);
  }

  async function resetLab() {
    const r = await WS.ui.msgbox({ title: 'Reset lab', icon: 'warning', message: 'Reset the entire lab to a fresh install?', detail: 'All changes, including the Administrator password, will be lost.', buttons: ['Reset', 'Cancel'] });
    if (r !== 'Reset') return;
    WS.store.reset();
    location.reload();
  }

  function startSession(user) {
    WS.session = { loggedIn: true, user, domain: WS.state.system.domain || WS.state.system.computerName, logonTime: new Date().toISOString() };
    clearOverlay();
    if (WS.personal) WS.personal.apply();
    if (WS.proc) WS.proc.onLogon();
    const shellUp = !WS.proc || WS.proc.explorerRunning();
    document.getElementById('taskbar').style.display = shellUp ? '' : 'none';
    // user policy is processed at sign-in (the computer's at boot)
    if (WS.gpo) { try { WS.gpo.refresh({ target: 'user', reason: 'logon' }); } catch (e) { console.error('Group Policy processing failed at sign-in', e); } }
    if (shellUp) { renderDesktop(); renderTaskbar(); }
    // Server Manager opens at sign-in, as on a real server (unless its Properties or Group Policy say not to)
    if (!(WS.state.servermanager && WS.state.servermanager.noAutoStart) && !gpOn('computer', 'DoNotOpenAtLogon')) WS.apps.launch('servermanager');
    if (WS.labs && WS.labs.active()) WS.apps.launch('lab');
  }

  /** Unlocking: the session and its windows are still there, so this is not a new logon. */
  function resumeSession() {
    WS.session.loggedIn = true;
    WS.session.resume = false;
    clearOverlay();
    const shellUp = !WS.proc || WS.proc.explorerRunning();
    document.getElementById('taskbar').style.display = shellUp ? '' : 'none';
    if (shellUp) { renderDesktop(); renderTaskbar(); }
  }

  /* ---------------- desktop ---------------- */
  const DESKTOP = 'C:\\Users\\Administrator\\Desktop';
  const TEXT_FILE = /\.(txt|log|ini|ps1|bat|cmd|csv|xml|json|md|cfg|inf)$/i;
  function desktopFiles() {
    let list = [];
    try { list = WS.fs.list(DESKTOP); } catch (e) { list = []; }
    const by = WS.personal ? WS.personal.get().desktop.sortBy : 'name';
    const cmp = { name: () => 0, size: (a, b) => a.size - b.size, type: (a, b) => (a.type === b.type ? a.extension.localeCompare(b.extension) : a.type === 'dir' ? -1 : 1), modified: (a, b) => new Date(a.modified) - new Date(b.modified) }[by] || (() => 0);
    return list.slice().sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  function iconForFile(f) { return f.type === 'dir' ? I.folder : TEXT_FILE.test(f.name) ? I.fileText : /\.(exe|msc)$/i.test(f.name) ? I.fileExe : I.file; }
  function openPath(path) {
    const r = WS.term && WS.term.resolveLaunch ? WS.term.resolveLaunch(`"${path}"`) : null;
    if (r) WS.term.launchResolved(r);
    else WS.ui.msgbox({ title: path.split('\\').pop(), icon: 'info', message: 'There is no app associated with this file in the lab simulator.' });
  }

  function renderDesktop() {
    const icons = U.clear(document.getElementById('desktop-icons'));
    const prefs = WS.personal ? WS.personal.get().desktop : { showIcons: true, iconSize: 'medium' };
    icons.dataset.size = prefs.iconSize;
    icons.style.display = prefs.showIcons ? '' : 'none';
    // double-click or Enter opens; right-click gives the icon's own menu with Open in bold, as on Windows
    const add = (icon, label, open, extra = () => [], file) => {
      const el = h('div.desk-icon', { dataset: { name: label } }, h('span.desk-glyph', { html: icon }), h('span.desk-label', label));
      el.tabIndex = -1;
      const select = () => { icons.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); el.focus({ preventScroll: true }); };
      el.addEventListener('click', select);
      el.addEventListener('dblclick', () => { select(); open(); });
      el.addEventListener('keydown', e => {
        if (e.target !== el) return;
        if (e.key === 'Enter') { e.preventDefault(); open(); }
        if (file && e.key === 'F2') { e.preventDefault(); renameIcon(el, file); }
        if (file && e.key === 'Delete') { e.preventDefault(); deleteFile(file); }
      });
      el.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        select();
        WS.ui.contextMenu(e.clientX, e.clientY, [{ label: '&Open', default: true, action: open }, ...extra()]);
      });
      icons.appendChild(el);
      return el;
    };
    if (!gpOn('user', 'NoDesktop')) {
      if (!gpOn('user', 'NoRecycleBinIcon')) add(I.recycle, 'Recycle Bin', () => WS.apps.launch('explorer', { path: 'Recycle Bin' }), () => [
        { separator: true }, { label: 'Empty Recycle &Bin', disabled: !WS.fs.recycleBin().length, action: emptyRecycleBin }
      ]);
      add(I.lab, 'Lab Guide', () => WS.apps.launch('lab'));
      for (const f of desktopFiles()) {
        add(iconForFile(f), f.name, () => openPath(f.path), () => [
          f.type === 'dir' ? null : { label: '&Edit', action: () => TEXT_FILE.test(f.name) ? WS.apps.launch('notepad', { path: f.path }) : openPath(f.path) },
          { separator: true },
          { label: 'Rena&me', action: () => renameIcon(icons.querySelector(`.desk-icon[data-name="${CSS.escape(f.name)}"]`), f) },
          { label: '&Delete', action: () => deleteFile(f) },
          { separator: true },
          { label: 'P&roperties', action: () => WS.apps.launch('explorer', { path: DESKTOP }) }
        ], f);
      }
    }
    const s = WS.state.system;
    document.getElementById('watermark').innerHTML =
      `${U.esc(s.edition)}<br>Windows License valid for 180 days<br>Build ${U.esc(s.build)}.ge_release (Lab Simulator)`;
    if (WS.personal) WS.personal.apply();
  }

  /** In-place rename on the desktop, as Explorer does (Enter commits, Esc cancels). */
  function renameIcon(el, f) {
    if (!el) return;
    const label = el.querySelector('.desk-label');
    const input = h('input.desk-rename', { value: f.name, spellcheck: false });
    label.replaceWith(input);
    const dot = f.type === 'dir' ? -1 : f.name.lastIndexOf('.');
    setTimeout(() => { input.focus(); input.setSelectionRange(0, dot > 0 ? dot : f.name.length); }, 10);
    let done = false;
    const commit = async keep => {
      if (done) return;
      done = true;
      const n = input.value.trim();
      if (keep && n && n !== f.name) {
        if (/[\\/:*?"<>|]/.test(n)) { await WS.ui.msgbox({ title: 'Rename', icon: 'error', message: 'A file name can\u2019t contain any of the following characters:\n\\ / : * ? " < > |' }); }
        else if (WS.fs.exists(DESKTOP + '\\' + n)) { await WS.ui.msgbox({ title: 'Rename', icon: 'error', message: `There is already a ${f.type === 'dir' ? 'folder' : 'file'} with the same name in this location.` }); }
        else { try { WS.fs.rename(f.path, n); } catch (e) { await WS.ui.msgbox({ title: 'Rename', icon: 'error', message: e.message }); } }
      }
      renderDesktop();
    };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('dblclick', e => e.stopPropagation());
  }
  async function deleteFile(f) {
    try { WS.fs.recycle(f.path); } catch (e) { await WS.ui.msgbox({ title: 'Delete File', icon: 'error', message: e.message }); }
    renderDesktop();
  }
  /** New > Folder / Text Document on the desktop: "New folder", "New folder (2)"..., then rename in place. */
  function desktopNew(kind) {
    try { WS.fs.mkdir(DESKTOP, null, { existOk: true }); } catch (e) { /* profile folder always exists */ }
    const base = kind === 'dir' ? 'New folder' : 'New Text Document', ext = kind === 'dir' ? '' : '.txt';
    let name = base + ext;
    for (let i = 2; WS.fs.exists(DESKTOP + '\\' + name); i++) name = `${base} (${i})${ext}`;
    try { if (kind === 'dir') WS.fs.mkdir(DESKTOP + '\\' + name); else WS.fs.writeFile(DESKTOP + '\\' + name, ''); } catch (e) { WS.ui.msgbox({ title: 'Desktop', icon: 'error', message: e.message }); return null; }
    renderDesktop();
    const el = document.querySelector(`#desktop-icons .desk-icon[data-name="${CSS.escape(name)}"]`);
    if (el) renameIcon(el, WS.fs.stat(DESKTOP + '\\' + name));
    return name;
  }

  /** The desktop's Empty Recycle Bin: the same confirmation File Explorer shows. */
  async function emptyRecycleBin() {
    const items = WS.fs.recycleBin();
    if (!items.length) return false;
    const q = items.length === 1 ? `Are you sure you want to permanently delete this ${items[0].type === 'dir' ? 'folder' : 'file'}?` : `Are you sure you want to permanently delete these ${items.length} items?`;
    if ((await WS.ui.msgbox({ title: items.length === 1 ? 'Delete File' : 'Delete Multiple Items', icon: 'warning', message: q, buttons: ['Yes', 'No'] })) !== 'Yes') return false;
    WS.fs.emptyRecycle();
    return true;
  }
  // clicking empty desktop clears the icon selection
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.desk-icon') && e.target.closest('#desktop') && !e.target.closest('.win')) document.querySelectorAll('#desktop-icons .sel').forEach(x => x.classList.remove('sel'));
  });
  // files created on the Desktop elsewhere (Explorer, PowerShell, Notepad) show up
  WS.store.on('change:fs', () => { if (WS.session && WS.session.loggedIn && !document.querySelector('.desk-rename')) renderDesktop(); });

  /* ---------------- taskbar ---------------- */
  const PINNED = ['servermanager', 'explorer', 'powershell', 'edge'];
  let clockTimer = null;

  function renderTaskbar() {
    const tb = U.clear(document.getElementById('taskbar'));
    const p = WS.personal ? WS.personal.get() : { taskbarSearch: 'box' };
    const main = h('div.tb-main');
    const startBtn = h('button.tb-btn.tb-start', { html: I.winlogo, title: 'Start', onClick: e => { e.stopPropagation(); toggleStart(); } });
    // right-clicking Start is the Win+X menu
    startBtn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); if (WS.shell.winX) WS.shell.winX(startBtn); });
    main.appendChild(startBtn);
    const openSearch = e => { e.stopPropagation(); toggleStart(); };
    if (p.taskbarSearch === 'box') main.appendChild(h('div.tb-search', { html: I.search, onClick: openSearch }, 'Search'));
    else if (p.taskbarSearch === 'label') main.appendChild(h('button.tb-searchbtn', { html: I.search, title: 'Search', onClick: openSearch }, h('span', 'Search')));
    else if (p.taskbarSearch === 'icon') main.appendChild(h('button.tb-btn.tb-searchicon', { html: I.search, title: 'Search', onClick: openSearch }));
    const appsEl = h('div.tb-apps');
    main.appendChild(appsEl);
    tb.appendChild(main);
    tb.appendChild(h('div.tb-spacer'));
    const clock = h('div.tb-clock');
    const volIcon = h('span', { html: I.vol, title: 'Speakers: 50%' });
    const netIcon = h('span', { html: I.net, title: 'Network',
      // the tooltip shows the network and its access, as Windows does; right-click offers diagnostics
      onMouseenter: e => { if (WS.ncpa) { const a = WS.net.adapter(); e.currentTarget.title = `${WS.ncpa.networkName(a)}\n${WS.ncpa.connectivity(a)}`; } },
      onContextmenu: e => {
        e.preventDefault(); e.stopPropagation();
        WS.ui.contextMenu(e.clientX, e.clientY, [
          { label: '&Diagnose network problems', action: () => WS.ncpa && WS.ncpa.diagnose(WS.net.adapter().name) },
          { label: '&Network and Internet settings', action: () => WS.apps.launch('settings', { page: 'network' }) }
        ]);
      } });
    volIcon.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      WS.ui.contextMenu(e.clientX, e.clientY, [{ label: 'Open volume mi&xer', action: () => WS.apps.launch('settings', { page: 'sound' }) }, { label: '&Sound settings', action: () => WS.apps.launch('settings', { page: 'sound' }) }]);
    });
    const quick = h('div.tray-item.tray-quick', { title: '', onClick: e => { e.stopPropagation(); if (WS.shell.quickSettings) WS.shell.quickSettings(); } }, netIcon, volIcon);
    const bell = h('span.tray-bell');
    const clockBtn = h('div.tray-item.tray-clock', { onClick: e => { e.stopPropagation(); if (WS.shell.notificationCenter) WS.shell.notificationCenter(); } }, clock, bell);
    tb.appendChild(h('div.tb-tray', quick, clockBtn,
      h('div.tb-showdesk', { title: 'Show desktop', onClick: e => { e.stopPropagation(); showDesktop(); } })));
    const tick = () => {
      const d = now();
      clock.innerHTML = `${U.fmtTime(d)}<br>${U.fmtDate(d)}`;
      clockBtn.title = U.fmtLongDate(d);
      const pr = WS.personal ? WS.personal.get() : {};
      const unread = WS.shell.unreadCount ? WS.shell.unreadCount() : 0;
      bell.className = 'tray-bell' + (pr.dnd ? ' dnd' : unread ? ' unread' : '');
      bell.innerHTML = pr.dnd ? BELL_Z : unread ? `<b>${unread}</b>` : '';
      const muted = WS.shell.volume ? WS.shell.volume().muted : false;
      volIcon.innerHTML = muted ? VOL_MUTED : I.vol;
      volIcon.title = muted ? 'Speakers: Muted' : `Speakers: ${WS.shell.volume ? WS.shell.volume().level : 50}%`;
    };
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 5000);
    trayTick = tick;

    const renderApps = () => {
      U.clear(appsEl);
      const running = [...new Set(WS.wm.windows.map(w => w.app))];
      const ids = [...PINNED, ...running.filter(a => !PINNED.includes(a))];
      for (const id of ids) {
        const app = WS.apps.get(id);
        const wins = WS.wm.windows.filter(w => w.app === id);
        const icon = app ? app.icon : (wins[0] && wins[0].icon) || I.info;
        const active = WS.wm.active && WS.wm.active.app === id;
        const btn = h('button.tb-btn' + (active ? '.active-app' : ''), { html: icon, title: app ? app.name : (wins[0] && wins[0].title), dataset: { app: id } });
        if (wins.length) btn.appendChild(h('span.ind'));
        btn.addEventListener('click', () => {
          if (!wins.length) return WS.apps.launch(id);
          const w = wins[0];
          if (WS.wm.active === w && !w.minimized) w.minimize(); else w.restore();
        });
        appsEl.appendChild(btn);
      }
    };
    taskbarApps = renderApps;
    if (!taskbarHooked) { taskbarHooked = true; WS.wm.on(() => taskbarApps && taskbarApps()); }
    renderApps();
    // right-clicking empty taskbar space: Task Manager and Taskbar settings, as on Windows 11
    tb.oncontextmenu = e => {
      if (e.target.closest('.tb-btn, .tray-item')) return;
      e.preventDefault(); e.stopPropagation();
      WS.ui.contextMenu(e.clientX, e.clientY, [
        { label: 'Task Manager', disabled: !!restricted('taskmgr'), action: () => WS.apps.launch('taskmgr') }, // greyed by Remove Task Manager
        { label: 'Taskbar settings', action: () => WS.apps.launch('settings', { page: 'taskbar' }) }
      ]);
    };
  }
  let taskbarApps = null, taskbarHooked = false, trayTick = null;
  const BELL_Z = '<svg viewBox="0 0 16 16"><path d="M8 2a4 4 0 0 0-4 4v3L2.5 11.5h11L12 9V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor"/><path d="M10 1.5h3l-3 3h3" fill="none" stroke="currentColor" stroke-width=".9"/></svg>';
  const VOL_MUTED = '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z" fill="none" stroke="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor"/></svg>';
  /** Repaint the tray (bell, volume) after a flyout changes something. */
  function refreshTray() { if (trayTick && WS.session.loggedIn) trayTick(); }
  // taskbar alignment and search are preferences: repaint when they change
  WS.store.on('change:personal', () => { if (WS.session && WS.session.loggedIn && (!WS.proc || WS.proc.explorerRunning())) { renderTaskbar(); renderDesktop(); } });

  /** Show desktop (the sliver at the right end of the taskbar, Win+D): minimize everything, then put it back. */
  let shownDesktop = null;
  function showDesktop() {
    const visible = WS.wm.windows.filter(w => !w.minimized);
    if (visible.length) { shownDesktop = visible; visible.forEach(w => w.minimize()); }
    else if (shownDesktop) { const list = shownDesktop; shownDesktop = null; list.filter(w => WS.wm.windows.includes(w)).forEach(w => w.restore()); }
  }

  /* ---------------- explorer.exe ended / restarted (Task Manager, taskkill, Stop-Process) ---------------- */
  function explorerEnded() {
    closeFlyouts();
    document.getElementById('taskbar').style.display = 'none';
    U.clear(document.getElementById('desktop-icons'));
  }
  function explorerStarted() {
    if (!WS.session.loggedIn) return;
    document.getElementById('taskbar').style.display = '';
    renderDesktop();
    renderTaskbar();
  }

  /* ---------------- bug check (a critical process was ended) ---------------- */
  async function bugcheck(stopCode) {
    closeFlyouts();
    WS.wm.closeAll();
    WS.session.loggedIn = false;
    if (WS.proc) WS.proc.onLogoff();
    document.getElementById('taskbar').style.display = 'none';
    const pct = h('div.bsod-pct', '0% complete');
    showOverlay('bsod',
      h('div.bsod-body',
        h('div.bsod-face', ':('),
        h('div.bsod-msg', 'Your device ran into a problem and needs to restart. We\u2019re just collecting some error info, and then we\u2019ll restart for you.'),
        pct,
        h('div.bsod-more',
          h('div.bsod-qr', { html: qrSvg() }),
          h('div',
            h('div', 'For more information about this issue and possible fixes, visit https://www.windows.com/stopcode'),
            h('div.bsod-gap', 'If you call a support person, give them this info:'),
            h('div', 'Stop code: ' + stopCode)))));
    for (const n of [0, 20, 45, 70, 100]) { pct.textContent = n + '% complete'; await U.sleep(WS.shell.bugcheckDelay); }
    boot();
  }
  /** A decorative QR-like square (not a real code). */
  function qrSvg() {
    let cells = '';
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      const on = finder ? !((x % 14 === 1 || x % 14 === 5) && y % 14 > 0 && y % 14 < 6 || (y % 14 === 1 || y % 14 === 5) && x % 14 > 0 && x % 14 < 6) : U.hashStr(x + ':' + y) % 3 === 0;
      if (on) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
    return `<svg viewBox="0 0 21 21" fill="#fff" shape-rendering="crispEdges">${cells}</svg>`;
  }

  /* Desktop right-click menu; the browser's own menu is suppressed everywhere except text fields. */
  function desktopMenu(x, y) {
    const p = WS.personal ? WS.personal.get().desktop : { iconSize: 'medium', sortBy: 'name', showIcons: true, autoArrange: true };
    const setDesk = patch => WS.personal && WS.personal.set({ desktop: patch });
    return WS.ui.contextMenu(x, y, [
      { label: '&View', items: [
        { label: '&Large icons', radio: true, checked: p.iconSize === 'large', action: () => setDesk({ iconSize: 'large' }) },
        { label: '&Medium icons', radio: true, checked: p.iconSize === 'medium', action: () => setDesk({ iconSize: 'medium' }) },
        { label: 'S&mall icons', radio: true, checked: p.iconSize === 'small', action: () => setDesk({ iconSize: 'small' }) },
        { separator: true },
        { label: '&Auto arrange icons', checked: p.autoArrange, action: () => setDesk({ autoArrange: !p.autoArrange }) },
        { label: 'Al&ign icons to grid', checked: true, disabled: true },
        { separator: true },
        { label: 'Show &desktop icons', checked: p.showIcons, action: () => setDesk({ showIcons: !p.showIcons }) }
      ] },
      { label: 'S&ort by', items: [['&Name', 'name'], ['&Size', 'size'], ['Item &type', 'type'], ['&Date modified', 'modified']].map(([label, k]) => ({ label, radio: true, checked: p.sortBy === k, action: () => setDesk({ sortBy: k }) })) },
      { label: 'R&efresh', action: renderDesktop },
      { separator: true },
      { label: 'Ne&w', items: [{ label: '&Folder', icon: I.folder, action: () => desktopNew('dir') }, { separator: true }, { label: 'Text Document', icon: I.fileText, action: () => desktopNew('file') }] },
      { separator: true },
      { label: 'Displa&y settings', action: () => WS.apps.launch('settings', { page: 'display' }) },
      { label: 'Personali&ze', action: () => WS.apps.launch('settings', { page: 'personalization' }) },
      { separator: true },
      { label: 'Open in Terminal', action: () => WS.apps.launch('powershell') }
    ]);
  }
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('input, textarea')) return;
    e.preventDefault();
    if (!WS.session.loggedIn || !e.target.closest('#desktop') || e.target.closest('.win')) return;
    desktopMenu(e.clientX, e.clientY);
  });

  /* Keyboard: Ctrl+Esc opens Start (the Win key itself usually goes to the host OS); Ctrl+Shift+Esc opens Task Manager;
   * Ctrl+Alt+End is Ctrl+Alt+Del (the Windows Security screen). Win-key shortcuts work where the browser receives them:
   * in fullscreen with keyboard lock (host bar), or on hosts where the Meta key isn't a browser shortcut key (not macOS). */
  const metaAllowed = () => !!document.fullscreenElement || !/Mac|iPhone|iPad/.test(navigator.platform || '');
  let metaAlone = false;
  document.addEventListener('keydown', e => {
    if (!WS.session.loggedIn) return;
    if (e.ctrlKey && e.altKey && (e.key === 'End' || e.key === 'Delete')) { e.preventDefault(); if (WS.shell.secureScreen) WS.shell.secureScreen(); return; }
    if (e.ctrlKey && e.key === 'Escape') {
      e.preventDefault();
      if (e.shiftKey) WS.apps.launch('taskmgr');
      else if (!WS.proc || WS.proc.explorerRunning()) toggleStart();
      return;
    }
    if (e.key === 'Meta' || e.key === 'OS') { metaAlone = true; return; }
    metaAlone = false;
    if (!e.metaKey || !metaAllowed() || (WS.proc && !WS.proc.explorerRunning() && !/^[lL]$/.test(e.key))) return;
    const k = e.key.toLowerCase();
    const map = {
      r: () => WS.shell.run && WS.shell.run(),
      x: () => WS.shell.winX && WS.shell.winX(),
      e: () => WS.apps.launch('explorer'),
      i: () => WS.apps.launch('settings'),
      l: () => !gpOn('user', 'DisableLockWorkstation') && lockSession(),
      d: () => showDesktop(),
      m: () => WS.wm.windows.forEach(w => w.minimize()),
      a: () => WS.shell.quickSettings && WS.shell.quickSettings(),
      n: () => WS.shell.notificationCenter && WS.shell.notificationCenter(),
      s: () => toggleStart(),
      z: () => WS.snap.openLayouts(WS.wm.active, { keys: true }),
      arrowleft: () => WS.snap.key('left'), arrowright: () => WS.snap.key('right'),
      arrowup: () => WS.snap.key('up'), arrowdown: () => WS.snap.key('down')
    };
    if (map[k] && !e.shiftKey) { e.preventDefault(); closeFlyouts(); map[k](); }
  });
  document.addEventListener('keyup', e => {
    if ((e.key === 'Meta' || e.key === 'OS') && metaAlone && WS.session.loggedIn && metaAllowed() && (!WS.proc || WS.proc.explorerRunning())) toggleStart();
    metaAlone = false;
  });

  /* ---------------- Start menu ---------------- */
  function closeFlyouts() { U.clear(document.getElementById('flyouts')); }
  document.addEventListener('pointerdown', e => {
    const fly = document.getElementById('flyouts');
    if (fly && fly.firstChild && !fly.contains(e.target) && !e.target.closest('#taskbar') && !e.target.closest('.menu.ctx')) closeFlyouts();
  });

  const START_PINNED = ['servermanager', 'explorer', 'settings', 'edge', 'powershell', 'taskmgr', 'control', 'notepad', 'eventvwr', 'lab'];
  function toggleStart() {
    const fly = document.getElementById('flyouts');
    if (fly.querySelector('.start-menu')) return closeFlyouts();
    closeFlyouts();
    const grid = h('div.start-grid');
    const search = h('input', { placeholder: 'Search for apps, settings, and documents' });
    const renderGrid = () => {
      U.clear(grid);
      const q = search.value.trim().toLowerCase();
      // empty search shows the pinned apps; typing searches every registered app (as Start search does)
      const ids = q ? WS.apps.list().filter(a => !a.hidden).map(a => a.id) : START_PINNED;
      for (const id of ids) {
        const app = WS.apps.get(id);
        if (!app || (q && !app.name.toLowerCase().includes(q) && !(app.keywords || []).some(k => k.includes(q)))) continue;
        grid.appendChild(h('div.start-app', { html: app.icon, dataset: { app: id }, onClick: () => { closeFlyouts(); WS.apps.launch(id); } }, app.name));
      }
    };
    search.addEventListener('input', renderGrid);
    // Enter in Start search runs what was typed when nothing matches (as Start does for commands like ncpa.cpl)
    search.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const first = grid.querySelector('.start-app');
      if (first) { first.click(); return; }
      const r = WS.term && WS.term.resolveLaunch(search.value);
      if (r) { closeFlyouts(); WS.term.launchResolved(r); }
    });
    renderGrid();
    const powerBtn = powerItems().length ? h('div.start-power', { html: I.power, title: 'Power', onClick: e => { e.stopPropagation(); powerMenu(powerBtn); } }) : null;
    const userBtn = h('div.start-user', { onClick: e => { e.stopPropagation(); userMenu(userBtn); } }, h('div.avatar', { html: I.user, style: 'width:32px;height:32px' }), WS.session.user || 'Administrator');
    fly.appendChild(h('div.start-menu',
      h('div.start-search', { html: I.search }, search),
      h('div.start-section', h('h3', 'Pinned'), grid),
      h('div.start-footer', userBtn, powerBtn)));
    setTimeout(() => search.focus(), 30);
  }

  function anchoredMenu(anchor, items, dx = -120) {
    const fly = document.getElementById('flyouts');
    fly.querySelectorAll('.menu').forEach(m => m.remove());
    const r = anchor.getBoundingClientRect();
    const item = (label, fn) => h('div.menu-item', { onClick: () => { closeFlyouts(); fn(); } }, label);
    const els = items.map(([label, fn]) => (label === '-' ? h('div.menu-sep') : item(label, fn)));
    const m = h('div.menu', { style: { left: Math.max(4, r.left + dx) + 'px', bottom: (fly.getBoundingClientRect().bottom - r.top + 6) + 'px' } }, ...els);
    fly.appendChild(m);
    return m;
  }
  function powerMenu(anchor) { return anchoredMenu(anchor, powerItems()); }
  /** Start's account menu: Change account settings, Lock, Sign out (what policy allows). */
  function userMenu(anchor) {
    return anchoredMenu(anchor, [['Change account settings', () => WS.apps.launch('settings', { page: 'yourinfo' })],
      !gpOn('user', 'DisableLockWorkstation') && ['Lock', lockSession], !gpOn('user', 'NoLogoff') && ['Sign out', signOut]].filter(Boolean), 0);
  }

  /** The power menu, minus what user policy removes (Remove Lock Computer, Remove Logoff, Remove ... Shut Down ... commands).
   * Shut down and Restart go through the Shutdown Event Tracker, as on Windows Server. */
  function powerItems() {
    const top = [!gpOn('user', 'DisableLockWorkstation') && ['Lock', lockSession], !gpOn('user', 'NoLogoff') && ['Sign out', signOut]].filter(Boolean);
    const bottom = gpOn('user', 'NoClose') ? [] : [['Shut down', () => requestShutdown(false)], ['Restart', () => requestShutdown(true)]];
    return [...top, ...(top.length && bottom.length ? [['-']] : []), ...bottom];
  }
  /** Ask the Shutdown Event Tracker why, then shut down or restart (Cancel keeps the session). */
  async function requestShutdown(restart) {
    let reason;
    if (WS.shell.shutdownTracker) { reason = await WS.shell.shutdownTracker(restart); if (!reason) return false; }
    shutdown(restart, reason);
    return true;
  }

  /** Lock keeps the session (windows stay open behind the lock screen), as on Windows. */
  function lockSession() {
    closeFlyouts();
    WS.session.loggedIn = false;
    document.getElementById('taskbar').style.display = 'none';
    lock();
    // signing back in returns to the same desktop
    WS.session.resume = true;
  }
  function signOut() { WS.wm.closeAll(); if (WS.proc) WS.proc.onLogoff(); if (WS.netuse) WS.netuse.onLogoff(); WS.session.resume = false; lock(); }

  async function shutdown(restart, reason) {
    closeFlyouts();
    WS.sys.onShutdown(restart, reason);
    WS.wm.closeAll();
    WS.session.loggedIn = false;
    document.getElementById('taskbar').style.display = 'none';
    showOverlay('boot', h('div.spinner', h('i'), h('i'), h('i'), h('i'), h('i')), h('div.status', restart ? 'Restarting' : 'Shutting down'));
    await U.sleep(1800);
    if (restart) return boot();
    poweredOff();
  }
  function poweredOff() {
    WS.session.loggedIn = false;
    document.getElementById('taskbar').style.display = 'none';
    showOverlay('boot.off', h('div.status', { style: 'margin:0;color:#aaa' }, 'The virtual machine is turned off.'),
      h('button.btn', { onClick: () => boot() }, 'Start'));
  }
  const isOff = () => !!document.querySelector('#overlays .overlay.off');

  WS.store.on('change:gpresult', () => { if (WS.session && WS.session.loggedIn) renderDesktop(); });
  WS.shell = { boot, lock, login, legalNotice, powerItems, restricted, startSession, signOut, lockSession, restart: () => shutdown(true), shutdown: () => shutdown(false), shutdownNow: shutdown, requestShutdown,
    closeFlyouts, resetLab, explorerEnded, explorerStarted, bugcheck, bugcheckDelay: 1500, renderDesktop, renderTaskbar, refreshTray, showDesktop, desktopNew, desktopMenu, toggleStart,
    poweredOff, isOff, showOverlay, clearOverlay, unlock: () => lockGo && lockGo(), isLocked: () => !!lockGo, DESKTOP, gpOn };
})();
