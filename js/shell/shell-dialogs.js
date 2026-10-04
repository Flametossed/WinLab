/* Shell dialogs: the Run box (Win+R), the Win+X menu, the Shutdown Event Tracker (planned shutdowns from the power
 * menu, and "Why did the computer shut down unexpectedly?" at the first sign-in after a crash or power loss), and the
 * Windows Security screen (Ctrl+Alt+Del, Ctrl+Alt+End in the browser) with Change a password.
 *   WS.shell.run(o) -> win (app 'run'); win.runbox = { input, ok(), cancel(), browse() }
 *   WS.shell.winX(anchor?) -> menu element
 *   WS.shell.shutdownTracker(restart, { onCreate }) -> Promise<reason | null>; REASONS
 *   WS.shell.unexpectedShutdownTracker({ onCreate }) -> Promise<bool>
 *   WS.shell.secureScreen() -> overlay; WS.shell.changePassword() */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons;
  const gpOn = (side, key) => !!(WS.gpo && WS.gpo.policyEnabled(side, key));

  const RUN_ICON = '<svg viewBox="0 0 32 32"><rect x="3" y="6" width="26" height="20" rx="2" fill="#fff" stroke="#5b6b7d" stroke-width="1.5"/><rect x="3" y="6" width="26" height="4" fill="#2f7fd8"/><path d="M10 21l5-5-5-5" fill="none" stroke="#1b1b1b" stroke-width="2"/><path d="M17 22h6" stroke="#1b1b1b" stroke-width="2"/></svg>';
  const SHIELD = '<svg viewBox="0 0 16 16"><path d="M8 1.5l5 2v4c0 3.3-2.1 5.8-5 7-2.9-1.2-5-3.7-5-7v-4z" fill="#3c7fd9"/><path d="M8 1.5v13c2.9-1.2 5-3.7 5-7v-4z" fill="#f2c94c"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

  /* ================================================================ Run */
  function runWindow(o = {}) {
    const layer = document.getElementById('windows');
    const H = layer.clientHeight || window.innerHeight - 48;
    const win = WS.wm.create({ app: 'run', title: 'Run', icon: RUN_ICON, width: 412, height: 212, x: 12, y: Math.max(10, H - 224), resizable: false });
    win.el.classList.add('run-win');
    const mru = (WS.personal && WS.personal.get().runMru) || [];
    const input = h('input.inp.run-input', { value: o.value != null ? o.value : mru[0] || '', spellcheck: false, autocomplete: 'off' });
    input.dataset.field = 'open';
    const drop = h('button.run-drop', { html: CHEVRON, tabIndex: -1, title: '' });
    drop.addEventListener('click', () => {
      const list = (WS.personal && WS.personal.get().runMru) || [];
      if (list.length) WS.ui.popupMenu(input, list.map(t => ({ label: t.replace(/&/g, '&&'), action: () => { input.value = t; input.focus(); input.select(); sync(); } })));
    });
    const okBtn = h('button.btn.primary', { onClick: () => ok() }, 'OK');
    const cancelBtn = h('button.btn', { onClick: () => win.close() }, 'Cancel');
    const browseBtn = h('button.btn', { onClick: () => browse() }, 'Browse...');
    const sync = () => { okBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', sync);
    win.body.appendChild(h('div.w32.run',
      h('div.run-top', h('span.run-ico', { html: RUN_ICON }), h('div', 'Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.')),
      h('div.run-row', h('label', 'Open:'), h('div.run-combo', input, drop)),
      h('div.run-admin', h('span.run-shield', { html: SHIELD }), 'This task will be created with administrative privileges.'),
      h('div.run-btns', okBtn, cancelBtn, browseBtn)));
    win.el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.target.closest('.run-btns')) { e.preventDefault(); ok(); }
      if (e.key === 'Escape') { e.preventDefault(); win.close(); }
      if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); drop.click(); }
    });
    async function ok() {
      const text = input.value.trim();
      if (!text) return null;
      const target = WS.term && WS.term.resolveLaunch(text);
      if (!target) {
        await WS.ui.msgbox({ title: text, icon: 'error', message: `Windows cannot find '${text}'. Make sure you typed the name correctly, and then try again.` });
        input.focus(); input.select();
        return null;
      }
      if (WS.personal) WS.personal.addRun(text);
      win.close();
      WS.term.launchResolved(target);
      return target;
    }
    async function browse() {
      const pick = await WS.ui.filePicker({ mode: 'open', path: 'C:\\Windows\\System32', filters: [{ label: 'Programs (*.exe;*.pif;*.com;*.bat;*.cmd)', ext: ['.exe', '.pif', '.com', '.bat', '.cmd'] }, { label: 'All Files (*.*)', ext: [] }] });
      if (pick) { input.value = /\s/.test(pick) ? `"${pick}"` : pick; sync(); }
      input.focus();
    }
    win.runbox = { input, ok, cancel: () => win.close(), browse };
    sync();
    setTimeout(() => { input.focus(); input.select(); }, 30);
    return win;
  }
  WS.apps.register({ id: 'run', name: 'Run', icon: RUN_ICON, singleton: true, keywords: ['run', 'run dialog'], launch: runWindow,
    reuse: (w, o) => { if (o.value != null) { w.runbox.input.value = o.value; } w.runbox.input.focus(); w.runbox.input.select(); } });

  /* ================================================================ Win+X */
  function winX(anchor) {
    const start = anchor || document.querySelector('#taskbar .tb-start');
    if (!start || (WS.proc && !WS.proc.explorerRunning())) return null;
    WS.shell.closeFlyouts();
    const go = (id, args) => () => WS.apps.launch(id, args);
    const power = [
      !gpOn('user', 'NoLogoff') && { label: 'Sign &out', action: () => WS.shell.signOut() },
      ...(gpOn('user', 'NoClose') ? [] : [{ label: 'Sh&ut down', action: () => WS.shell.requestShutdown(false) }, { label: '&Restart', action: () => WS.shell.requestShutdown(true) }])
    ].filter(Boolean);
    const items = [
      { label: 'Installed a&pps', action: go('settings', { page: 'appsfeatures' }) },
      { label: 'P&ower Options', action: go('settings', { page: 'power' }) },
      { label: 'E&vent Viewer', action: go('eventvwr') },
      { label: 'S&ystem', action: go('settings', { page: 'about' }) },
      { label: 'Device &Manager', action: go('devmgmt') },
      { label: 'Net&work Connections', action: go('ncpa') },
      { label: 'Dis&k Management', action: go('diskmgmt') },
      { label: 'Computer Mana&gement', action: go('compmgmt') },
      { label: 'Term&inal', action: go('terminal') },
      { label: 'Terminal (&Admin)', action: go('terminal') },
      { separator: true },
      !gpOn('user', 'DisableTaskMgr') && { label: '&Task Manager', action: go('taskmgr') },
      { label: 'Setti&ngs', action: go('settings') },
      { label: 'File &Explorer', action: go('explorer') },
      { label: '&Search', action: () => WS.shell.toggleStart() },
      !gpOn('user', 'NoRun') && { label: '&Run', action: () => run() },
      { separator: true },
      power.length && { label: 'Sh&ut down or sign out', items: power },
      { label: '&Desktop', action: () => WS.shell.showDesktop() }
    ].filter(Boolean);
    const r = start.getBoundingClientRect();
    const el = WS.ui.contextMenu(r.left, r.top, items, { keyboard: !anchor });
    if (el) {
      el.classList.add('winx');
      el.style.top = Math.max(4, r.top - el.offsetHeight - 6) + 'px';
      el.style.left = Math.max(4, r.left) + 'px';
    }
    return el;
  }

  function run(o) { return WS.apps.launch('run', o || {}); }

  /* ================================================================ Shutdown Event Tracker */
  // SHTDN_REASON codes: major (other 0, hardware 0x10000, OS 0x20000, application 0x40000, system 0x50000) | minor | 0x80000000 when planned
  const REASONS = [
    ['Other (Planned)', 0x80000000, 'A shutdown or restart for an unknown reason'],
    ['Other (Unplanned)', 0x0, 'A shutdown or restart for an unknown reason'],
    ['Hardware: Maintenance (Planned)', 0x80010001, 'Shutdown or restart for hardware maintenance (such as adding or replacing RAM)'],
    ['Hardware: Maintenance (Unplanned)', 0x10001, 'Shutdown or restart for hardware maintenance (such as adding or replacing RAM)'],
    ['Hardware: Installation (Planned)', 0x80010002, 'Shutdown or restart to begin or complete hardware installation'],
    ['Hardware: Installation (Unplanned)', 0x10002, 'Shutdown or restart to begin or complete hardware installation'],
    ['Operating System: Upgrade (Planned)', 0x80020003, 'Shutdown or restart for an operating system upgrade'],
    ['Operating System: Reconfiguration (Planned)', 0x80020004, 'Shutdown or restart for operating system configuration change'],
    ['Operating System: Reconfiguration (Unplanned)', 0x20004, 'Shutdown or restart for operating system configuration change'],
    ['Operating System: Service pack (Planned)', 0x80020010, 'Shutdown or restart to install a service pack'],
    ['Operating System: Hot fix (Planned)', 0x80020011, 'Shutdown or restart to install a hot fix'],
    ['Operating System: Hot fix (Unplanned)', 0x20011, 'Shutdown or restart to install a hot fix'],
    ['Operating System: Security fix (Planned)', 0x80020012, 'Shutdown or restart to install a security fix'],
    ['Operating System: Security fix (Unplanned)', 0x20012, 'Shutdown or restart to install a security fix'],
    ['Application: Maintenance (Planned)', 0x80040001, 'Shutdown or restart for application maintenance'],
    ['Application: Maintenance (Unplanned)', 0x40001, 'Shutdown or restart for application maintenance'],
    ['Application: Installation (Planned)', 0x80040002, 'Shutdown or restart for application installation'],
    ['Application: Unresponsive', 0x40005, 'Shutdown or restart because an application stopped responding'],
    ['Application: Unstable', 0x40006, 'Shutdown or restart because an application behaved unpredictably'],
    ['Security issue', 0x50013, 'Shutdown or restart because of a security issue'],
    ['Loss of network connectivity (Unplanned)', 0x50014, 'Shutdown or restart because of a loss of network connectivity']
  ].map(([title, code, desc]) => ({ title, code, desc, planned: code >= 0x80000000 }));

  /** A modal on the #dialogs layer with Windows' modern look (no caption bar). */
  function modernModal(cls, ...children) {
    let el = document.getElementById('dialogs');
    if (!el) { el = h('div', { id: 'dialogs' }); document.getElementById('screen').appendChild(el); }
    const shade = h('div.dlg-shade.modern-shade', h('div.modern-dlg.' + cls, ...children));
    el.appendChild(shade);
    return shade;
  }

  /** Start > Power > Shut down / Restart on Windows Server: choose a reason first. Resolves the reason, or null for Cancel. */
  function shutdownTracker(restart, o = {}) {
    return new Promise(resolve => {
      const sel = h('select.sdt-select', ...REASONS.map((r, i) => h('option', { value: i }, r.title)));
      sel.dataset.field = 'reason';
      const desc = h('div.sdt-desc');
      const paint = () => { desc.textContent = REASONS[+sel.value].desc; };
      sel.addEventListener('change', paint);
      paint();
      let shade;
      const close = v => { document.removeEventListener('keydown', key, true); shade.remove(); resolve(v); };
      const cont = h('button.btn.primary', { onClick: () => close({ ...REASONS[+sel.value], comment: '' }) }, 'Continue');
      const cancel = h('button.btn', { onClick: () => close(null) }, 'Cancel');
      const key = e => { if (!shade.isConnected) return; if (e.key === 'Escape') { e.preventDefault(); close(null); } if (e.key === 'Enter' && e.target !== sel) { e.preventDefault(); cont.click(); } };
      document.addEventListener('keydown', key, true);
      shade = modernModal('sdt',
        h('h2', `Choose a reason that best describes why you want to ${restart ? 'restart' : 'shut down'} this computer`),
        sel, desc, h('div.sdt-btns', cont, cancel));
      setTimeout(() => sel.focus(), 30);
      if (o.onCreate) o.onCreate({ select: sel, choose: title => { const i = REASONS.findIndex(r => r.title === title); if (i >= 0) { sel.value = i; paint(); } }, ok: () => cont.click(), cancel: () => cancel.click(), el: shade });
    });
  }

  /** First sign-in after an unexpected shutdown: the classic Shutdown Event Tracker window. Event 1076 records the answer. */
  function unexpectedShutdownTracker(o = {}) {
    const info = WS.state.system.unexpectedShutdown;
    if (!info) return Promise.resolve(false);
    const unplanned = REASONS.filter(r => !r.planned);
    const sel = WS.ui.f.select(unplanned.map((r, i) => ({ value: String(i), label: r.title })), '0', { width: 300 });
    sel.dataset.field = 'reason';
    const desc = h('div.sdt-classic-desc');
    const problem = WS.ui.f.text({ value: info.bugcheck || '', width: 300 });
    const comment = WS.ui.f.textarea({ rows: 4 });
    comment.dataset.field = 'comment';
    let frame;
    const needsComment = () => /^Other/.test(unplanned[+sel.value].title);
    const sync = () => { desc.textContent = unplanned[+sel.value].desc; if (frame) frame.buttons[0].disabled = needsComment() && !comment.value.trim(); };
    sel.addEventListener('change', sync);
    comment.addEventListener('input', sync);
    sync();
    const when = new Date(info.time);
    const content = h('div.w32.sdt-classic',
      h('div.sdt-classic-head', h('span.sdt-classic-ico', { html: I.info }), h('div', h('b', 'Why did the computer shut down unexpectedly?'),
        h('div', `The previous system shutdown at ${U.fmtTime(when, true)} on ${U.fmtDate(when)} was unexpected.`))),
      WS.ui.f.row('Option:', sel, { labelWidth: 80 }), desc,
      WS.ui.f.row('Problem ID:', problem, { labelWidth: 80 }),
      h('div.flabel', 'Comment:'), comment,
      WS.ui.f.note('A comment is required for this option.'));
    return WS.ui.dialog({ title: 'Shutdown Event Tracker', width: 460, className: 'w32-dlg', content,
      buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }],
      onCreate: f => { frame = f; sync(); if (o.onCreate) o.onCreate({ frame, select: sel, comment, ok: () => f.buttons[0].click(), choose: t => { const i = unplanned.findIndex(r => r.title === t); if (i >= 0) { sel.value = String(i); sync(); } }, setComment: t => { comment.value = t; sync(); } }); } })
      .then(r => {
        if (r !== 'OK') return false;
        const reason = unplanned[+sel.value];
        const dom = WS.sys.netbiosDomain();
        WS.evt.write('System', { id: 1076, source: 'User32', user: `${dom}\\Administrator`, message: `The reason supplied by user ${dom}\\Administrator for the last unexpected shutdown of this computer is: ${reason.title}\n Reason Code: 0x${reason.code.toString(16)}\n Problem ID: ${problem.value}\n Bugcheck String: ${info.bugcheck || ''}\n Comment: ${comment.value}` });
        delete WS.state.system.unexpectedShutdown;
        WS.store.changed('system');
        return true;
      });
  }

  /* ================================================================ Windows Security (Ctrl+Alt+Del) */
  function secureScreen() {
    if (!WS.session.loggedIn) { if (WS.shell.isLocked()) WS.shell.unlock(); return null; }
    if (document.querySelector('#overlays .secure')) return null;
    WS.shell.closeFlyouts();
    const layer = document.getElementById('overlays');
    const bg = getComputedStyle(document.getElementById('wallpaper')).background;
    let el;
    const back = () => { document.removeEventListener('keydown', key, true); el.remove(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); } };
    const item = (label, fn) => h('button.secure-item', { dataset: { item: label }, onClick: () => { back(); fn(); } }, label);
    const items = [
      !gpOn('user', 'DisableLockWorkstation') && item('Lock', () => WS.shell.lockSession()),
      item('Switch user', () => { WS.shell.lockSession(); WS.shell.unlock(); }),
      !gpOn('user', 'NoLogoff') && item('Sign out', () => WS.shell.signOut()),
      !gpOn('user', 'DisableChangePassword') && item('Change a password', () => changePassword()),
      !gpOn('user', 'DisableTaskMgr') && item('Task Manager', () => WS.apps.launch('taskmgr'))
    ].filter(Boolean);
    const powerBtn = gpOn('user', 'NoClose') ? null : h('button.secure-icon', { html: I.power, title: 'Power', onClick: e => {
      e.stopPropagation();
      const r = powerBtn.getBoundingClientRect();
      const m = WS.ui.contextMenu(r.left, r.top, [{ label: 'Shut down', action: () => { back(); WS.shell.requestShutdown(false); } }, { label: 'Restart', action: () => { back(); WS.shell.requestShutdown(true); } }]);
      if (m) m.style.top = (r.top - m.offsetHeight - 4) + 'px';
    } });
    el = h('div.overlay.secure', h('div.bg', { style: { background: bg } }),
      h('div.secure-list', ...items),
      h('div.secure-corner', h('span.secure-icon', { html: I.net, title: 'Network' }), powerBtn),
      h('button.btn.secure-cancel', { onClick: back }, 'Cancel'));
    layer.appendChild(el);
    document.addEventListener('keydown', key, true);
    setTimeout(() => { const f = el.querySelector('.secure-item'); if (f) f.focus(); }, 30);
    return el;
  }

  /** Change a password (from the Windows Security screen): the Administrator's own password, through the account model. */
  function changePassword(o = {}) {
    const layer = document.getElementById('overlays');
    const bg = getComputedStyle(document.getElementById('wallpaper')).background;
    const user = WS.sys.isDC() ? `${WS.sys.netbiosDomain()}\\Administrator` : 'Administrator';
    const field = (ph, name) => { const i = h('input', { type: 'password', placeholder: ph, autocomplete: 'off' }); i.dataset.field = name; return i; };
    const oldPw = field('Old password', 'old'), newPw = field('New password', 'new'), confirm = field('Confirm password', 'confirm');
    const msg = h('div.cp-msg');
    let el;
    const close = () => { document.removeEventListener('keydown', key, true); el.remove(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const notice = (text, again) => {
      const form = el.querySelector('.cpw-form');
      form.style.display = 'none';
      const ok = h('button.btn.primary', { onClick: () => { box.remove(); if (again) { form.style.display = ''; (again === 'old' ? oldPw : newPw).focus(); } else close(); } }, 'OK');
      const box = h('div.cpw-notice', h('div', text), ok);
      el.querySelector('.cpw-box').appendChild(box);
      setTimeout(() => ok.focus(), 20);
    };
    const submit = () => {
      if (oldPw.value !== WS.state.system.adminPassword) { oldPw.value = newPw.value = confirm.value = ''; return notice('The password is incorrect. Try again.', 'old'); }
      if (newPw.value !== confirm.value) { newPw.value = confirm.value = ''; return notice('The passwords don\u2019t match.', 'new'); }
      const r = WS.sys.isDC() && WS.ad ? WS.ad.setPassword('Administrator', newPw.value) : WS.local.setPassword('Administrator', newPw.value);
      if (!r || !r.ok) { newPw.value = confirm.value = ''; return notice('Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.', 'new'); }
      notice('Your password has been changed.');
    };
    [oldPw, newPw, confirm].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
    el = h('div.overlay.secure.cpw', h('div.bg', { style: { background: bg } }),
      h('div.cpw-box', h('div.avatar', { html: I.user }), h('div.cpw-name', user),
        h('div.cpw-form', oldPw, newPw, h('div.cpw-row', confirm, h('button.cpw-go', { title: 'Submit', onClick: submit }, '\u2192')), msg)),
      h('button.btn.secure-cancel', { onClick: close }, 'Cancel'));
    layer.appendChild(el);
    document.addEventListener('keydown', key, true);
    setTimeout(() => oldPw.focus(), 30);
    if (o.onCreate) o.onCreate({ el, oldPw, newPw, confirm, submit });
    return el;
  }

  Object.assign(WS.shell, { run, winX, shutdownTracker, unexpectedShutdownTracker, secureScreen, changePassword, REASONS, RUN_ICON });
})();
