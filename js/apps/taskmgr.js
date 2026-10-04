/* Task Manager (Taskmgr.exe), the Windows Server 2025 / Windows 11 design: a left navigation pane with Processes,
 * Performance, App history, Startup apps, Users, Details and Services, plus Settings. Everything reads WS.proc
 * (js/model/processes.js) and WS.svc, so ending a process here is the same as Stop-Process or taskkill.
 * Opens from the taskbar's right-click menu, Ctrl+Shift+Esc, Start search, or `taskmgr` in a shell (app id taskmgr).
 * win.taskmgr = { go(page), page(), nodes(), select(id), selected(), commands(), command(label), menu(), tick(),
 *                 expand(id), runNewTask(o), endTask(o), prefs } for tests. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, F = WS.ui.f;

  WS.store.init('taskmgr', s => {
    s.taskmgr = { startPage: 'processes', speed: 'Normal', alwaysOnTop: false, minimizeOnUse: true, hideWhenMinimized: false, fullAccountName: false,
      historyAll: false, askEfficiency: true, groupByType: true, memoryPercent: false, cpuGraph: 'overall', appHistorySince: null };
  });
  const prefs = () => WS.state.taskmgr;
  const SPEED = { High: 500, Normal: 1000, Low: 4000, Paused: 0 };

  /* ---------------- icons ---------------- */
  const svg = (d, o = '') => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" ${o}>${d}</svg>`;
  const ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="3" fill="#1b7fd4"/><rect x="4" y="5" width="16" height="14" rx="1.5" fill="#e8f3fc"/><polyline points="5.5,15 9,11 12,13.5 15.5,8 18.5,10.5" fill="none" stroke="#1b7fd4" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  const NAV_ICONS = {
    processes: svg('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>'),
    performance: svg('<path d="M1.5 10.5h3l2-5 3 8 2-5h3"/>'),
    apphistory: svg('<circle cx="8.5" cy="8" r="5.5"/><path d="M8.5 5v3.2l2.2 1.4M3 4.5V2M3 4.5h2.4"/>'),
    startup: svg('<path d="M2.5 11.5a5.5 5.5 0 1 1 11 0"/><path d="M8 11.5l2.6-3.4"/><circle cx="8" cy="11.5" r=".8" fill="currentColor"/>'),
    users: svg('<circle cx="6" cy="5.5" r="2.4"/><path d="M1.8 13.5c.4-2.4 2.1-3.7 4.2-3.7s3.8 1.3 4.2 3.7"/><circle cx="11.3" cy="5.2" r="1.9"/><path d="M11.2 9c1.7 0 3 1.1 3.3 3"/>'),
    details: svg('<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="3" cy="4" r=".6" fill="currentColor"/><circle cx="3" cy="8" r=".6" fill="currentColor"/><circle cx="3" cy="12" r=".6" fill="currentColor"/>'),
    services: svg('<path d="M6.3 2.5h3.4v1.8l1.3.7 1.5-.9 1.7 2.9-1.5.9v1.6l1.5.9-1.7 2.9-1.5-.9-1.3.7v1.8H6.3v-1.8L5 12.4l-1.5.9-1.7-2.9 1.5-.9V7.9L1.8 7l1.7-2.9 1.5.9 1.3-.7z"/><circle cx="8" cy="8" r="1.8"/>'),
    settings: svg('<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
    menu: svg('<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>')
  };
  const CMD_ICONS = {
    run: svg('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 6v4M6 8h4"/>'),
    end: svg('<circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/>'),
    restart: svg('<path d="M12.5 8a4.5 4.5 0 1 1-1.4-3.3M12 2.5v2.6H9.4"/>'),
    leaf: svg('<path d="M3 13c0-6 4-9.5 10-10-.3 6-3.8 10-10 10zM3 13l5-5"/>'),
    view: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M6 6.5V13"/>'),
    start: svg('<path d="M5 3.5v9l7-4.5z"/>'),
    stop: svg('<rect x="4" y="4" width="8" height="8" rx="1"/>'),
    services: NAV_ICONS.services,
    enable: svg('<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8.2l1.8 1.8 3.4-3.6"/>'),
    disable: svg('<circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/>'),
    props: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>'),
    disconnect: svg('<path d="M6 10l4-4M4.5 8.5L3 10a2.1 2.1 0 0 0 3 3l1.5-1.5M8.5 4.5L10 3a2.1 2.1 0 0 1 3 3l-1.5 1.5"/>'),
    users: NAV_ICONS.users,
    trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>'),
    more: svg('<circle cx="3.5" cy="8" r=".8" fill="currentColor"/><circle cx="8" cy="8" r=".8" fill="currentColor"/><circle cx="12.5" cy="8" r=".8" fill="currentColor"/>')
  };
  const ROW_ICONS = {
    app: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="#fff" stroke="#6b6b6b"/><rect x="1.5" y="2.5" width="13" height="3" rx="1.5" fill="#6aa6dd"/></svg>',
    windows: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1.5" fill="#dfe9f5" stroke="#5b7fa8"/><path d="M5 6h6M5 8.5h6M5 11h4" stroke="#5b7fa8"/></svg>',
    service: '<svg viewBox="0 0 16 16"><path d="M6.3 2.5h3.4v1.8l1.3.7 1.5-.9 1.7 2.9-1.5.9v1.6l1.5.9-1.7 2.9-1.5-.9-1.3.7v1.8H6.3v-1.8L5 12.4l-1.5.9-1.7-2.9 1.5-.9V7.9L1.8 7l1.7-2.9 1.5.9 1.3-.7z" fill="#cfd8e3" stroke="#5f6f82"/><circle cx="8" cy="8" r="1.7" fill="#fff" stroke="#5f6f82"/></svg>',
    window: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" fill="#fff" stroke="#7d7d7d"/><rect x="2.5" y="3.5" width="11" height="2" fill="#9cc3e6"/></svg>',
    user: '<svg viewBox="0 0 16 16"><circle cx="8" cy="5.5" r="2.7" fill="#9fb8d3"/><path d="M2.8 14c.5-3 2.6-4.6 5.2-4.6s4.7 1.6 5.2 4.6z" fill="#9fb8d3"/></svg>'
  };
  const appIcon = id => { const a = WS.apps.get(id); return a && a.icon ? a.icon : ROW_ICONS.app; };

  /* ---------------- formatting ---------------- */
  const pct1 = v => (v < 0.05 ? '0%' : v >= 99.95 ? '100%' : v.toFixed(1).replace(/\.0$/, '') + '%');
  const mb = kb => (kb / 1024).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
  const mbs = v => (v < 0.05 ? '0 MB/s' : v.toFixed(1) + ' MB/s');
  const mbps = v => (v < 0.05 ? '0 Mbps' : v.toFixed(1) + ' Mbps');
  const gb = kb => (kb / 1048576).toFixed(1) + ' GB';
  const kbSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' GB' : n >= 1024 ? Math.round(n / 1024) + ' MB' : Math.round(n) + ' KB');
  const uptime = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 86400)}:${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const heat = f => ({ background: `rgba(0, 120, 212, ${(0.05 + 0.5 * Math.min(1, Math.max(0, f))).toFixed(3)})` });

  /* ---------------- shared dialogs ---------------- */
  const msg = (message, detail, buttons = ['OK'], icon = 'warning') => WS.ui.msgbox({ title: 'Task Manager', icon, message, detail, buttons });
  const accessDenied = () => msg('Unable to terminate process', 'The operation could not be completed.\n\nAccess is denied.', ['OK'], 'error');

  /** "Do you want to end the system process ...?" for critical processes: the checkbox enables Shut down. */
  async function confirmCritical(name) {
    let frame;
    const chk = F.checkbox('Abandon unsaved data and shut down.', false, { onChange: on => { frame.buttons[0].disabled = !on; } });
    const content = h('div.msgbox', h('div.msgbox-icon', { html: WS.ui.icons.warning || '' }),
      h('div.msgbox-text', h('div.tm-instr', `Do you want to end the system process '${name}'?`),
        h('div.msgbox-detail', 'Ending this process will shut down the operating system immediately. You will lose unsaved data. Are you sure you want to continue?'), h('div.w32', { style: 'margin-top:10px' }, chk)));
    const r = await WS.ui.dialog({ title: 'Task Manager', width: 460, content, buttons: [{ label: 'Shut down', primary: true, disabled: true }, { label: 'Cancel', cancel: true }], onCreate: f => { frame = f; WS.taskmgr.lastDialog = { frame, check: chk }; } });
    return r === 'Shut down';
  }
  /** End a process with the confirmations Task Manager shows; o.confirm: the Details tab's "Do you want to end ...?". */
  async function endProcess(p, o = {}) {
    if (!p) return false;
    const label = o.label || p.image;
    if (p.key === 'idle' || p.key === 'system' || p.key === 'registry' || (p.protected && !p.critical)) { await accessDenied(); return false; }
    if (p.critical) {
      if (!(await confirmCritical(o.label || p.description || p.image))) return false;
      return WS.proc.kill(p.pid, { allowCritical: true, tree: o.tree }).ok;
    }
    if (o.tree) {
      if (await msg(`Do you want to end the process tree of ${label}?`, 'If open programs or processes are associated with this process tree, they will close and you will lose any unsaved data. If you end a system process, it might result in system instability. Are you sure you want to continue?', ['End process tree', 'Cancel']) !== 'End process tree') return false;
    } else if (o.confirm) {
      if (await msg(`Do you want to end ${label}?`, 'If an open program is associated with this process, it will close and you will lose any unsaved data. If you end a system process, it might result in system instability. Are you sure you want to continue?', ['End process', 'Cancel']) !== 'End process') return false;
    }
    const r = WS.proc.kill(p.pid, { tree: o.tree });
    if (!r.ok) { if (r.code === 'AccessDenied') await accessDenied(); else await msg('Unable to terminate process', r.error, ['OK'], 'error'); return false; }
    return true;
  }
  async function setPriority(p, cls) {
    if (await msg(`Do you want to change the priority of ${p.image}?`, 'Changing the priority of certain processes could cause system instability.', ['Change priority', 'Cancel']) !== 'Change priority') return false;
    const r = WS.proc.setPriority(p.pid, cls);
    if (!r.ok) { await msg('Unable to change priority', `The operation could not be completed.\n\n${r.error}`, ['OK'], 'error'); return false; }
    return true;
  }
  async function efficiency(p, on) {
    if (on && prefs().askEfficiency) {
      const dont = F.checkbox('Don\u2019t ask me again', false);
      const content = h('div.msgbox', h('div.msgbox-icon', { html: WS.ui.icons.question || '' }),
        h('div.msgbox-text', h('div.tm-instr', 'Turn on Efficiency mode?'), h('div.msgbox-detail', 'Efficiency mode will lower process priority and improve power efficiency but may cause instability for certain processes.'), h('div.w32', { style: 'margin-top:10px' }, dont)));
      const r = await WS.ui.dialog({ title: 'Task Manager', width: 440, content, buttons: [{ label: 'Turn on Efficiency mode', primary: true }, { label: 'Cancel', cancel: true }] });
      if (r !== 'Turn on Efficiency mode') return false;
      if (dont.checked) { prefs().askEfficiency = false; WS.store.changed('taskmgr'); }
    }
    return WS.proc.setEfficiency(p.pid, on).ok;
  }
  async function setAffinity(p) {
    if (p.protected || p.critical || p.key === 'system' || p.key === 'idle') { await msg('Unable to access or set process affinity', 'The operation could not be completed.\n\nAccess is denied.', ['OK'], 'error'); return false; }
    const boxes = Array.from({ length: WS.proc.NCPU }, (_, i) => F.checkbox('CPU ' + i, !!(p.affinity & (1 << i))));
    const allBox = F.checkbox('<All Processors>', boxes.every(b => b.checked), { onChange: on => boxes.forEach(b => { b.checked = on; }) });
    boxes.forEach(b => b.input.addEventListener('change', () => { allBox.checked = boxes.every(x => x.checked); }));
    for (;;) {
      const content = h('div.w32.tm-affinity', h('div', { style: 'margin-bottom:8px' }, `Which processors are allowed to run "${p.image}"?`), h('div.tm-afflist', allBox, ...boxes));
      const r = await WS.ui.dialog({ title: 'Processor affinity', width: 360, content, buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }], onCreate: f => { WS.taskmgr.lastDialog = { frame: f, all: allBox, boxes }; } });
      if (r !== 'OK') return false;
      const mask = boxes.reduce((m, b, i) => (b.checked ? m | (1 << i) : m), 0);
      if (!mask) { await msg('The process must have affinity with at least one processor.', null, ['OK'], 'error'); continue; }
      const res = WS.proc.setAffinity(p.pid, mask);
      if (!res.ok) await msg('Unable to access or set process affinity', res.error, ['OK'], 'error');
      return res.ok;
    }
  }
  async function createDump(p) {
    const box = WS.ui.progress({ title: 'Dumping process', text: 'Dumping process...' });
    box.set(40);
    await U.sleep(600);
    const r = WS.proc.dump(p.pid);
    box.close();
    if (!r.ok) { await msg('Unable to create dump file', `The operation could not be completed.\n\n${r.error}`, ['OK'], 'error'); return r; }
    const ans = await WS.ui.msgbox({ title: 'Dumping process', icon: 'info', message: 'The file has been successfully created.', detail: r.shortPath, buttons: ['Open file location', 'OK'] });
    if (ans === 'Open file location') openLocation(r.path);
    return r;
  }
  function openLocation(path) {
    if (!path) return;
    const dir = path.replace(/\\[^\\]+$/, ''), name = path.replace(/^.*\\/, '');
    const w = WS.apps.launch('explorer', { path: dir });
    if (w && w.explorer) setTimeout(() => w.explorer.select(name), 30);
  }
  async function waitChain(p) {
    const hung = p.status === 'Not responding';
    const content = h('div.w32.tm-wait', h('div', { style: 'margin-bottom:8px' }, hung ? `One or more threads of ${p.image} are waiting to finish network I/O.` : `${p.image} is running normally.`),
      h('div.tm-waittree', h('div', `${p.image} (PID: ${p.pid})`), hung ? h('div', { style: 'padding-left:16px' }, `Thread: ${p.pid + 8}  Waiting on network I/O`) : null));
    const r = await WS.ui.dialog({ title: 'Analyze wait chain', width: 440, content, buttons: hung ? [{ label: 'End process', primary: true }, { label: 'Cancel', cancel: true }] : [{ label: 'Close', primary: true, cancel: true }] });
    if (r === 'End process') await endProcess(WS.proc.get(p.pid));
  }
  /** Properties of the process's image file: General and Details, as Explorer shows them. */
  function fileProperties(p) {
    if (!p.path) return Promise.resolve(false);
    let st = null;
    try { st = WS.fs.stat(p.path); } catch (e) { st = null; }
    const size = st ? st.size : 40960 + (U.hashStr(p.image) % 900) * 1024;
    const created = st ? st.created : WS.state.system.installDate;
    const modified = st ? st.modified : WS.state.system.installDate;
    const ms = p.company === 'Microsoft Corporation';
    const lw = { labelWidth: 100 };
    const sizeText = `${WS.diskmgmt ? WS.diskmgmt.shortSize(size) : kbSize(size / 1024)} (${size.toLocaleString('en-US')} bytes)`;
    const kv = rows => h('table.tm-kv', h('tbody', ...rows.map(([k, v]) => h('tr', h('td', k), h('td', v == null ? '' : String(v))))));
    return WS.ui.propertySheet({ title: `${p.image} Properties`, width: 400, tabs: [
      { label: 'General', render: () => h('div', h('div.ex-phead', h('span.ex-pic', { html: ROW_ICONS.app }), F.text({ value: p.image, readOnly: true })), F.sep(),
        F.row('Type of file:', F.value('Application (.exe)'), lw), F.row('Description:', F.value(p.description), lw), F.sep(),
        F.row('Location:', F.value(p.path.replace(/\\[^\\]+$/, '')), lw), F.row('Size:', F.value(sizeText), lw), F.sep(),
        F.row('Created:', F.value(U.fmtDateTime(created)), lw), F.row('Modified:', F.value(U.fmtDateTime(modified)), lw), F.sep(),
        F.row('Attributes:', h('span.ex-attrs', F.checkbox('Read-only', false, { disabled: true }), F.checkbox('Hidden', false, { disabled: true })), lw)) },
      { label: 'Details', render: () => kv([['Property', 'Value'], ['File description', p.description], ['Type', 'Application'], ['File version', p.version || (ms ? '10.0.26100.1' : '1.0.0.0')],
        ['Product name', ms ? 'Microsoft® Windows® Operating System' : p.description], ['Product version', p.version || (ms ? '10.0.26100.1' : '1.0.0.0')],
        ['Copyright', ms ? '© Microsoft Corporation. All rights reserved.' : p.company ? `© ${p.company}` : ''], ['Size', kbSize(size / 1024)], ['Date modified', U.fmtDateTime(modified)],
        ['Language', 'English (United States)'], ['Original filename', p.image.toUpperCase() === 'EXPLORER.EXE' ? 'EXPLORER.EXE.MUI' : p.image]]) }
    ] });
  }

  /** Create new task (Run new task): admin rights note, Browse..., and the Run dialog's "cannot find" error. */
  async function runNewTask(o = {}) {
    let value = o.value || '';
    for (;;) {
      const input = F.text({ value, width: 290 });
      const content = h('div.w32.tm-run',
        h('div.tm-run-top', h('span.tm-run-ico', { html: ICON }), h('div', 'Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.')),
        F.row('Open:', input, { labelWidth: 44 }),
        h('div.tm-run-admin', h('span.tm-shield', { html: '<svg viewBox="0 0 16 16"><path d="M8 1.5l5 2v4c0 3.3-2.1 5.8-5 7-2.9-1.2-5-3.7-5-7v-4z" fill="#3c7fd9"/><path d="M8 1.5v13c2.9-1.2 5-3.7 5-7v-4z" fill="#f2c94c"/></svg>' }), 'This task will be created with administrative privileges.'));
      setTimeout(() => { input.focus(); input.select(); }, 40);
      const r = await WS.ui.dialog({ title: 'Create new task', width: 420, content, buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }, { label: 'Browse...' }], onCreate: f => { WS.taskmgr.lastDialog = { frame: f, input }; } });
      value = input.value;
      if (r === 'Browse...') { const pick = await WS.ui.filePicker({ mode: 'open', path: 'C:\\Windows\\System32', filters: [{ label: 'Programs (*.exe;*.pif;*.com;*.bat;*.cmd)', ext: ['.exe', '.pif', '.com', '.bat', '.cmd'] }, { label: 'All Files (*.*)', ext: [] }] }); if (pick) value = pick; continue; }
      if (r !== 'OK' || !value.trim()) return null;
      const target = WS.term.resolveLaunch(value);
      if (!target) { await WS.ui.msgbox({ title: value.trim(), icon: 'error', message: `Windows cannot find '${value.trim()}'. Make sure you typed the name correctly, and then try again.` }); continue; }
      WS.term.launchResolved(target);
      return target;
    }
  }

  /* ================================================================ the window */
  function launch(args = {}) {
    const P = prefs();
    const win = WS.wm.create({ app: 'taskmgr', title: 'Task Manager', icon: ICON, width: 1020, height: 670 });
    win.el.classList.add('tm-window');
    const tm = { page: null, sel: {}, expanded: new Set(), sort: { processes: null, users: null }, search: '', perf: 'cpu', hist: { cpu: [], cores: [[], [], [], []], mem: [], disk: {}, net: [] }, closed: false, nav: true };
    const content = h('div.tm-page');
    const navEl = h('div.tm-nav');
    const search = h('input.tm-search', { placeholder: 'Type a name, publisher, or PID to search', spellcheck: false });
    search.addEventListener('input', () => { tm.search = search.value.trim().toLowerCase(); refresh(); });
    const root = h('div.tm',
      h('div.tm-top', h('button.tm-burger', { html: NAV_ICONS.menu, title: 'Open navigation', onClick: () => { tm.nav = !tm.nav; root.classList.toggle('tm-collapsed', !tm.nav); } }),
        h('div.tm-title', 'Task Manager'), h('div.tm-searchbox', h('span', { html: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.5 3.5"/>') }), search)),
      h('div.tm-main', navEl, content));
    win.body.appendChild(root);

    const PAGES = [['processes', 'Processes'], ['performance', 'Performance'], ['apphistory', 'App history'], ['startup', 'Startup apps'], ['users', 'Users'], ['details', 'Details'], ['services', 'Services']];
    const navItem = (id, label) => h('button.tm-navitem', { dataset: { page: id }, title: label, onClick: () => go(id) }, h('span.tm-navico', { html: NAV_ICONS[id] }), h('span.tm-navlabel', label));
    navEl.append(...PAGES.map(([id, label]) => navItem(id, label)), h('div.tm-navspacer'), navItem('settings', 'Settings'));

    /* ---- page frame: title + command bar + body ---- */
    let head, cmdbar, body, cmds = [];
    function frame(title) {
      U.clear(content);
      cmdbar = h('div.tm-cmds');
      head = h('div.tm-head', h('h2', title), cmdbar);
      body = h('div.tm-body');
      content.append(head, body);
    }
    /** Command bar buttons: [{ label, icon, action, disabled, menu }]. The live refresh calls this every tick, so
     *  when the buttons are the same they are updated in place: replacing a button between mousedown and mouseup
     *  would swallow the click. */
    const cmdSig = c => [c.label, c.icon, c.text === false, !!c.menu].join('\u0001');
    function setCommands(list) {
      // Remove Run menu from Start Menu also removes Task Manager's Run new task
      const next = list.filter(Boolean).filter(c => !(c.label === 'Run new task' && WS.shell.restricted('run')));
      const same = cmdbar.children.length === next.length && next.length === cmds.length && next.every((c, i) => cmdSig(c) === cmdSig(cmds[i]));
      cmds = next;
      if (same) { cmds.forEach((c, i) => { cmdbar.children[i].disabled = !!c.disabled; }); return; }
      U.clear(cmdbar);
      cmds.forEach((_, i) => {
        const c = cmds[i];
        const b = h('button.tm-cmd', { disabled: !!c.disabled, title: c.label, dataset: { cmd: c.label } }, h('span.tm-cmdico', { html: CMD_ICONS[c.icon] || '' }), c.text === false ? null : h('span', c.label), c.menu ? h('span.tm-caret', '\u2304') : null);
        // read cmds[i] at click time: the action may have been replaced by a later refresh
        b.addEventListener('click', () => { const cur = cmds[i]; if (cur.menu) WS.ui.popupMenu(b, typeof cur.menu === 'function' ? cur.menu() : cur.menu); else if (!b.disabled) cur.action(); });
        cmdbar.appendChild(b);
      });
    }

    function go(page) {
      if (page === tm.page) return;
      tm.page = page;
      navEl.querySelectorAll('.tm-navitem').forEach(b => b.classList.toggle('sel', b.dataset.page === page));
      search.disabled = !['processes', 'details', 'services', 'startup', 'users', 'apphistory'].includes(page);
      search.parentNode.classList.toggle('disabled', search.disabled);
      PAGE[page].open();
    }
    function refresh() { if (!tm.closed && tm.page && PAGE[tm.page].refresh) PAGE[tm.page].refresh(); }

    /* ---- live updates ---- */
    let timer = null;
    function tick() {
      if (tm.closed) return;
      const t = WS.proc.sample();
      push(tm.hist.cpu, t.cpu);
      tm.hist.cores.forEach((c, i) => push(c, Math.max(0, Math.min(100, t.cpu * (0.6 + ((i * 37 + c.length * 13) % 9) / 10) + (Math.random() - 0.5) * 2))));
      push(tm.hist.mem, t.memory.percent);
      for (const d of perfDisks()) { const k = 'disk' + d.number; tm.hist.disk[k] = tm.hist.disk[k] || []; push(tm.hist.disk[k], d.number === 0 ? t.disk.active : Math.random() < 0.05 ? Math.random() : 0); }
      push(tm.hist.net, t.net.sendKbps + t.net.recvKbps);
      tm.totals = t;
      refresh();
    }
    const push = (a, v) => { a.push(v); if (a.length > 60) a.shift(); };
    function schedule() { clearInterval(timer); const ms = SPEED[prefs().speed]; if (ms) timer = setInterval(tick, ms); }
    const soon = U.debounce ? U.debounce(refresh, 60) : refresh;
    win.listen('processes', soon); win.listen('services', soon); win.listen('taskmgr', soon);
    // every pointerdown in a window focuses it and emits, so only refresh when the windows themselves changed
    const wmSig = () => WS.wm.windows.map(w => `${w.id}:${w.title}:${!!w.minimized}`).join('|');
    let lastWm = wmSig();
    const onWm = () => { if (tm.closed) return; const s = wmSig(); if (s !== lastWm) { lastWm = s; soon(); } applyOnTop(); };
    WS.wm.on(onWm);
    function applyOnTop() { if (prefs().alwaysOnTop && !tm.closed) win.el.style.zIndex = 50000; }
    win.onClose(() => { tm.closed = true; clearInterval(timer); });

    /* ================================================================ Processes */
    const sumLive = procs => procs.reduce((a, p) => { const l = WS.proc.live(p); a.cpu += l.cpu; a.mem += l.memKB; a.disk += l.disk; a.net += l.net; return a; }, { cpu: 0, mem: 0, disk: 0, net: 0 });
    function svcDisplay(name) { const s = WS.svc.get(name); return s ? s.display : name; }
    /** The Processes tab's tree: groups of nodes { id, name, icon, procs, proc, children, kind, status, window, service }. */
    function processNodes() {
      const procs = WS.proc.list();
      const apps = [], background = [], windows = [];
      const svcChildren = p => p.services.map(s => ({ id: `svc:${s}@${p.key}`, name: svcDisplay(s), icon: ROW_ICONS.service, kind: 'service', service: s, proc: p, procs: [] }));
      for (const p of procs) {
        if (p.hidden || p.hostKey) continue;
        if (p.kind === 'app' || (p.shell && p.windows.length)) {
          const tabs = procs.filter(x => x.hostKey === p.key);
          const kids = p.appId === 'terminal' ? [p, ...tabs].map(x => ({ id: 'child:' + x.key, name: x === p ? 'Windows Terminal' : x.description, icon: x === p ? appIcon('terminal') : ROW_ICONS.app, kind: 'process', proc: x, procs: [x] }))
            : p.windows.map(w => ({ id: 'win:' + w.id + '@' + p.key, name: w.title, icon: ROW_ICONS.window, kind: 'window', window: w, proc: p, procs: [] }));
          apps.push({ id: p.key, name: p.shell ? 'Windows Explorer' : p.appName || p.description, icon: p.shell ? appIcon('explorer') : appIcon(p.appId === 'mmc' ? 'services' : p.appId), kind: 'process', proc: p, procs: [p, ...tabs], children: kids, status: p.status });
          continue;
        }
        const node = { id: p.key, proc: p, procs: [p], kind: 'process', status: p.status, icon: p.kind === 'windows' ? ROW_ICONS.windows : ROW_ICONS.app, name: p.description || p.image };
        if (p.image.toLowerCase() === 'svchost.exe') { node.name = `Service Host: ${svcDisplay(p.services[0])}`; node.children = svcChildren(p); node.icon = ROW_ICONS.service; }
        else if (p.services.length) { node.children = svcChildren(p); if (p.key === 'lsass') node.name = 'Local Security Authority Process'; }
        if (p.shell) node.name = 'Windows Explorer';
        if (p.key === 'system') node.name = 'System';
        (p.kind === 'background' ? background : windows).push(node);
      }
      windows.push({ id: 'interrupts', name: 'System interrupts', icon: ROW_ICONS.windows, kind: 'interrupts', procs: [], fixed: { cpu: 0.1 + Math.random() * 0.2, mem: 0, disk: 0, net: 0 } });
      const groups = [{ id: 'g:apps', label: 'Apps', nodes: apps }, { id: 'g:background', label: 'Background processes', nodes: background }, { id: 'g:windows', label: 'Windows processes', nodes: windows }];
      for (const g of groups) for (const n of g.nodes) {
        n.live = n.fixed || sumLive(n.procs);
        if (n.children && n.children.length > 1 && n.kind !== 'interrupts') n.count = n.children.length;
        for (const c of n.children || []) c.live = c.procs.length ? sumLive(c.procs) : null;
      }
      // search: a name, publisher or PID
      if (tm.search) for (const g of groups) g.nodes = g.nodes.filter(n => matches(n) || (n.children || []).some(matches));
      const col = tm.sort.processes;
      const key = col ? { name: n => n.name.toLowerCase(), status: n => n.status || '', cpu: n => n.live.cpu, memory: n => n.live.mem, disk: n => n.live.disk, network: n => n.live.net }[col.key] : n => n.name.toLowerCase();
      const dir = col ? col.dir : 1;
      for (const g of groups) g.nodes.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * dir; });
      return prefs().groupByType ? groups : [{ id: 'g:all', label: null, nodes: groups.flatMap(g => g.nodes).sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; }) }];
    }
    const matches = n => { const q = tm.search; return n.name.toLowerCase().includes(q) || (n.proc && (String(n.proc.pid) === q || (n.proc.company || '').toLowerCase().includes(q) || n.proc.image.toLowerCase().includes(q))); };
    let lastNodes = [];
    const flatNodes = () => lastNodes.flatMap(g => g.nodes.flatMap(n => [n, ...(n.children || [])]));
    const nodeById = id => flatNodes().find(n => n.id === id) || null;

    function statusCell(n) {
      const p = n.proc;
      if (!p || n.kind === 'service' || n.kind === 'window') return n.kind === 'service' ? (WS.svc.isRunning(n.service) ? 'Running' : 'Stopped') : '';
      if (p.efficiency) return h('span.tm-status', h('span.tm-leaf', { html: CMD_ICONS.leaf, title: 'Efficiency mode' }), 'Efficiency mode');
      if (p.status === 'Suspended') return h('span.tm-status', { title: 'This process is suspended to help improve system performance.' }, h('span.tm-pause', '\u23F8'));
      if (p.status === 'Not responding') return 'Not responding';
      return '';
    }
    const PCOLS = [['name', 'Name'], ['status', 'Status'], ['cpu', 'CPU'], ['memory', 'Memory'], ['disk', 'Disk'], ['network', 'Network']];
    function renderProcesses() {
      const t = tm.totals || WS.proc.totals();
      lastNodes = processNodes();
      const scroller = body.querySelector('.tm-scroll');
      const top = scroller ? scroller.scrollTop : 0;
      const memPct = t.memory.percent, totalMem = t.memory.totalKB;
      const headCell = (k, label) => {
        const col = tm.sort.processes;
        const sum = { cpu: pct1(t.cpu).replace(/\.\d%/, '%'), memory: Math.round(memPct) + '%', disk: Math.round(t.disk.active) + '%', network: Math.round((t.net.sendKbps + t.net.recvKbps) / 100000) + '%' }[k];
        return h('th.tm-th' + (k === 'name' ? '.tm-name' : k === 'status' ? '.tm-statcol' : '.tm-num') + (col && col.key === k ? '.sorted' : ''), { dataset: { col: k }, onClick: () => sortBy(k) },
          sum != null ? h('div.tm-sum', sum) : h('div.tm-sum', '\u00a0'), h('div.tm-colname', label, col && col.key === k ? (col.dir > 0 ? ' \u02C4' : ' \u02C5') : ''));
      };
      const rows = [];
      for (const g of lastNodes) {
        if (g.label) rows.push(h('tr.tm-group', h('td', { colSpan: 6 }, `${g.label} (${g.nodes.length})`)));
        for (const n of g.nodes) {
          rows.push(rowEl(n, 0, memPct, totalMem));
          if (n.children && tm.expanded.has(n.id)) for (const c of n.children) rows.push(rowEl(c, 1, memPct, totalMem));
        }
      }
      const table = h('table.tm-table', h('thead', h('tr', ...PCOLS.map(([k, l]) => headCell(k, l)))), h('tbody', ...rows));
      U.clear(body);
      const sc = h('div.tm-scroll', { tabIndex: 0, onKeydown: e => { if (e.key === 'Delete') { e.preventDefault(); procCommands().find(c => c.icon === 'end' || c.icon === 'restart').action(); } } }, table);
      body.appendChild(sc);
      sc.scrollTop = top;
      setCommands(procCommands());
    }
    function rowEl(n, depth, memPct, totalMem) {
      const l = n.live;
      const hasKids = n.children && n.children.length;
      const open = tm.expanded.has(n.id);
      const cell = (text, f) => h('td.tm-num', { style: l ? heat(f) : null }, l ? text : '');
      const tr = h('tr.tm-row' + (tm.sel.processes === n.id ? '.sel' : ''), { dataset: { id: n.id } },
        h('td.tm-name', h('div.tm-namewrap', { style: { paddingLeft: (depth ? 30 : 4) + 'px' } },
          hasKids ? h('span.tm-exp', { onClick: e => { e.stopPropagation(); toggle(n.id); } }, open ? '\u02C5' : '\u203A') : h('span.tm-exp.none'),
          h('span.tm-rowico', { html: n.icon || ROW_ICONS.app }), h('span.tm-rowname', n.name + (n.count ? ` (${n.count})` : '')))),
        h('td.tm-statcol', statusCell(n)),
        cell(pct1(l ? l.cpu : 0), l ? l.cpu / 40 : 0),
        cell(prefs().memoryPercent ? pct1(l ? l.mem / totalMem * 100 : 0) : mb(l ? l.mem : 0), l ? l.mem / 400000 : 0),
        cell(mbs(l ? l.disk : 0), l ? l.disk / 10 : 0),
        cell(mbps(l ? l.net : 0), l ? l.net / 10 : 0));
      tr.addEventListener('mousedown', () => selectProc(n.id));
      tr.addEventListener('dblclick', () => { if (n.kind === 'window') switchTo(n); else if (hasKids) toggle(n.id); });
      tr.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); selectProc(n.id); WS.ui.contextMenu(e.clientX, e.clientY, procMenu(n)); });
      return tr;
    }
    function selectProc(id) { tm.sel.processes = id; body.querySelectorAll('.tm-row').forEach(r => r.classList.toggle('sel', r.dataset.id === id)); setCommands(procCommands()); }
    function toggle(id) { if (tm.expanded.has(id)) tm.expanded.delete(id); else tm.expanded.add(id); renderProcesses(); }
    function sortBy(k) {
      const col = tm.sort.processes;
      tm.sort.processes = col && col.key === k ? (col.dir === (k === 'name' || k === 'status' ? 1 : -1) ? { key: k, dir: -col.dir } : null) : { key: k, dir: k === 'name' || k === 'status' ? 1 : -1 };
      renderProcesses();
    }
    const selNode = () => (tm.sel.processes ? nodeById(tm.sel.processes) : null);
    function switchTo(n) { const w = n.window || (n.proc && n.proc.windows[0]); if (w) { w.restore(); if (prefs().minimizeOnUse) win.minimize(); } }
    async function endTaskNode(n) {
      if (!n || !n.proc || n.kind === 'service' || n.kind === 'interrupts') return false;
      if (n.kind === 'window' && n.window) { n.window.close(); return true; } // ending one window of an app closes that window
      return endProcess(n.proc, { label: n.proc.critical ? n.name : n.proc.image });
    }
    async function restartExplorer(p) {
      WS.proc.kill(p.pid, {});
      await U.sleep(500);
      WS.proc.startExplorer();
    }
    function procCommands() {
      const n = selNode();
      const p = n && n.proc;
      const shell = p && p.shell && n.kind !== 'window';
      const eff = p && n.kind === 'process' && WS.proc.canEfficiency(p);
      return [
        { label: 'Run new task', icon: 'run', action: () => runNewTask() },
        shell ? { label: 'Restart', icon: 'restart', action: () => restartExplorer(p) }
          : { label: 'End task', icon: 'end', disabled: !p || n.kind === 'service' || n.kind === 'interrupts', action: () => endTaskNode(selNode()) },
        { label: 'Efficiency mode', icon: 'leaf', disabled: !eff, action: () => efficiency(p, !p.efficiency) },
        { label: 'View', icon: 'view', menu: () => [
          { label: 'Group by type', checked: prefs().groupByType, action: () => { prefs().groupByType = !prefs().groupByType; WS.store.changed('taskmgr'); renderProcesses(); } },
          { label: 'Expand all', action: () => { flatNodes().forEach(x => x.children && tm.expanded.add(x.id)); renderProcesses(); } },
          { label: 'Collapse all', action: () => { tm.expanded.clear(); renderProcesses(); } },
          { separator: true },
          { label: 'Memory', items: [{ label: 'Values', radio: true, checked: !prefs().memoryPercent, action: () => { prefs().memoryPercent = false; renderProcesses(); } }, { label: 'Percents', radio: true, checked: prefs().memoryPercent, action: () => { prefs().memoryPercent = true; renderProcesses(); } }] }
        ] }
      ];
    }
    function procMenu(n) {
      const p = n.proc;
      if (n.kind === 'interrupts') return [{ label: 'Provide feedback', disabled: true }, { separator: true }, { label: 'Search online', action: () => WS.apps.launch('edge') }];
      if (n.kind === 'service') {
        const running = WS.svc.isRunning(n.service);
        return [{ label: '&Start', disabled: running, action: () => svcAction('start', n.service) }, { label: 'S&top', disabled: !running, action: () => svcAction('stop', n.service) },
          { label: 'Restart', disabled: !running, action: () => svcAction('restart', n.service) }, { separator: true },
          { label: 'Open Services', action: () => WS.apps.launch('services') }, { label: 'Search online', action: () => WS.apps.launch('edge') }, { label: 'Go to details', action: () => goDetails(p.pid) }];
      }
      if (n.kind === 'window') return [{ label: '&Switch to', default: true, action: () => switchTo(n) }, { label: 'Bring to front', action: () => n.window.restore() },
        { label: 'Minimize', action: () => n.window.minimize() }, { label: 'Maximize', action: () => { n.window.restore(); if (!n.window.maximized) n.window.toggleMax(); } }, { separator: true },
        { label: '&End task', action: () => endTaskNode(n) }];
      const appRow = p.kind === 'app' || (p.shell && p.windows.length);
      return [
        appRow && !p.shell ? { label: '&Switch to', default: true, action: () => switchTo(n) } : null,
        p.shell ? { label: '&Restart', default: true, action: () => restartExplorer(p) } : null,
        { label: '&End task', action: () => endTaskNode(n) },
        { label: 'Provide feedback', disabled: true },
        { label: 'Efficiency mode', checked: p.efficiency, disabled: !WS.proc.canEfficiency(p), action: () => efficiency(p, !p.efficiency) },
        { separator: true },
        { label: 'Create memory dump file', action: () => createDump(p) },
        { separator: true },
        { label: 'Go to details', action: () => goDetails(p.pid) },
        { label: 'Open file location', disabled: !p.path, action: () => openLocation(p.path) },
        { label: 'Search online', action: () => WS.apps.launch('edge') },
        { label: 'Properties', disabled: !p.path, action: () => fileProperties(p) }
      ];
    }
    async function svcAction(verb, name) {
      const r = WS.svc[verb](name, verb === 'stop' || verb === 'restart' ? { force: true } : undefined);
      if (!r.ok) await msg(verb === 'start' ? 'Unable to start service.' : 'Unable to stop service.', r.detail || r.error, ['OK'], 'error');
      refresh();
      return r.ok;
    }
    function goDetails(pid) { tm.sel.details = String(pid); go('details'); if (detailsList) { detailsList.select([String(pid)]); const r = body.querySelector('.lv-row.sel'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'center' }); } }

    /* ================================================================ Details */
    let detailsList = null;
    const twoDigit = v => String(Math.min(99, Math.round(v))).padStart(2, '0');
    const userCol = p => (p.key === 'idle' || p.key === 'system' || p.key === 'registry' ? 'SYSTEM' : prefs().fullAccountName ? WS.proc.qualifiedUser(p) : p.user);
    function detailsRows() {
      return WS.proc.list().filter(p => !tm.search || p.image.toLowerCase().includes(tm.search) || String(p.pid) === tm.search || (p.description || '').toLowerCase().includes(tm.search))
        .map(p => { const l = WS.proc.live(p); return { id: String(p.pid), p, name: p.key === 'idle' ? 'System Idle Process' : p.image, pid: p.pid, status: p.status, user: userCol(p), cpu: l.cpu, mem: l.memKB, arch: p.key === 'idle' || p.key === 'system' || p.key === 'registry' ? '' : 'x64', desc: p.description || '' }; });
    }
    function openDetails() {
      frame('Details');
      detailsList = WS.ui.listView({
        columns: [{ key: 'name', label: 'Name', width: 200, render: r => h('span.tm-dname', h('span.tm-rowico', { html: r.p.kind === 'app' ? ROW_ICONS.app : ROW_ICONS.windows }), r.name) },
          { key: 'pid', label: 'PID', width: 60, align: 'right', type: 'num' }, { key: 'status', label: 'Status', width: 90 }, { key: 'user', label: 'User name', width: 120 },
          { key: 'cpu', label: 'CPU', width: 46, align: 'right', type: 'num', render: r => twoDigit(r.cpu) },
          { key: 'mem', label: 'Memory (active private working set)', width: 120, align: 'right', type: 'num', render: r => Math.round(r.mem).toLocaleString('en-US') + ' K' },
          { key: 'arch', label: 'Architecture', width: 80 }, { key: 'desc', label: 'Description', width: 260 }],
        rows: detailsRows, getId: r => r.id, sortKey: 'name', sortDir: 1,
        onSelect: rows => { tm.sel.details = rows[0] ? rows[0].id : null; setCommands(detailCommands()); },
        onContext: (rows, x, y) => { if (rows[0]) WS.ui.contextMenu(x, y, detailMenu(rows[0].p)); },
        onKey: (e, rows) => { if (e.key === 'Delete' && rows[0]) endProcess(rows[0].p, { confirm: true }); }
      });
      body.appendChild(detailsList.el);
      if (tm.sel.details) detailsList.select([tm.sel.details]);
      setCommands(detailCommands());
    }
    const selDetail = () => (tm.sel.details ? WS.proc.get(+tm.sel.details) : null);
    function detailCommands() {
      const p = selDetail();
      return [{ label: 'Run new task', icon: 'run', action: () => runNewTask() },
        { label: 'End task', icon: 'end', disabled: !p, action: () => endProcess(selDetail(), { confirm: true }) },
        { label: 'Efficiency mode', icon: 'leaf', disabled: !p || !WS.proc.canEfficiency(p), action: () => efficiency(p, !p.efficiency) },
        { label: 'Properties', icon: 'props', disabled: !p || !p.path, action: () => fileProperties(p) }];
    }
    function detailMenu(p) {
      const cur = p.priority;
      return [
        { label: '&End task', action: () => endProcess(p, { confirm: true }) },
        { label: 'End process &tree', action: () => endProcess(p, { tree: true }) },
        { label: 'Provide feedback', disabled: true },
        { label: 'Efficiency mode', checked: p.efficiency, disabled: !WS.proc.canEfficiency(p), action: () => efficiency(p, !p.efficiency) },
        { separator: true },
        { label: 'Set &priority', disabled: p.key === 'idle', items: ['Realtime', 'High', 'AboveNormal', 'Normal', 'BelowNormal', 'Idle'].map(k => ({ label: WS.proc.PRIORITIES[k].label, radio: true, checked: cur === k, action: () => setPriority(p, k) })) },
        { label: 'Set &affinity', disabled: p.key === 'idle', action: () => setAffinity(p) },
        { separator: true },
        { label: 'Analyze wait chain', disabled: p.key === 'idle' || p.key === 'system', action: () => waitChain(p) },
        { label: 'UAC virtualization', disabled: true },
        { label: 'Create memory dump file', disabled: p.key === 'idle', action: () => createDump(p) },
        { separator: true },
        { label: 'Open file location', disabled: !p.path, action: () => openLocation(p.path) },
        { label: 'Search online', action: () => WS.apps.launch('edge') },
        { label: 'P&roperties', disabled: !p.path, action: () => fileProperties(p) },
        { label: 'Go to service(s)', disabled: !p.services.length, action: () => goServices(p.services) }
      ];
    }

    /* ================================================================ Services */
    let svcList = null;
    const groupOf = s => { const m = /-k\s+(\S+)/.exec(WS.svc.pathOf(s.name)); return m ? m[1] : ''; };
    function goServices(names) { tm.sel.services = names[0]; go('services'); if (svcList) { svcList.select(names); const r = body.querySelector('.lv-row.sel'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'center' }); } }
    function openServices() {
      frame('Services');
      svcList = WS.ui.listView({
        columns: [{ key: 'name', label: 'Name', width: 170, render: r => h('span.tm-dname', h('span.tm-rowico', { html: ROW_ICONS.service }), r.name) }, { key: 'pid', label: 'PID', width: 60, align: 'right', type: 'num', render: r => (r.pid ? String(r.pid) : '') },
          { key: 'description', label: 'Description', width: 300 }, { key: 'status', label: 'Status', width: 80 }, { key: 'group', label: 'Group', width: 200 }],
        rows: () => WS.svc.list().filter(s => !tm.search || s.name.toLowerCase().includes(tm.search) || s.display.toLowerCase().includes(tm.search))
          .map(s => ({ id: s.name, name: s.name, pid: s.status === 'Running' ? WS.proc.pidOfService(s.name) : 0, description: s.display, status: s.status, group: groupOf(s) })),
        getId: r => r.id, sortKey: 'name', sortDir: 1,
        onSelect: rows => { tm.sel.services = rows[0] ? rows[0].id : null; setCommands(svcCommands()); },
        onContext: (rows, x, y) => { if (rows[0]) WS.ui.contextMenu(x, y, svcMenu(rows[0])); }
      });
      body.appendChild(svcList.el);
      if (tm.sel.services) svcList.select([tm.sel.services]);
      setCommands(svcCommands());
    }
    function svcCommands() {
      const s = tm.sel.services ? WS.svc.get(tm.sel.services) : null;
      return [{ label: 'Run new task', icon: 'run', action: () => runNewTask() },
        { label: 'Start', icon: 'start', disabled: !s || s.status === 'Running', action: () => svcAction('start', s.name) },
        { label: 'Stop', icon: 'stop', disabled: !s || s.status !== 'Running', action: () => svcAction('stop', s.name) },
        { label: 'Restart', icon: 'restart', disabled: !s || s.status !== 'Running', action: () => svcAction('restart', s.name) },
        { label: 'Open services', icon: 'services', action: () => WS.apps.launch('services') }];
    }
    function svcMenu(r) {
      const running = r.status === 'Running';
      return [{ label: '&Start', disabled: running, action: () => svcAction('start', r.name) }, { label: 'S&top', disabled: !running, action: () => svcAction('stop', r.name) },
        { label: '&Restart', disabled: !running, action: () => svcAction('restart', r.name) }, { separator: true },
        { label: 'Open Services', action: () => WS.apps.launch('services') }, { label: 'Search online', action: () => WS.apps.launch('edge') },
        { label: 'Go to details', disabled: !running, action: () => goDetails(r.pid) }];
    }

    /* ================================================================ Startup apps */
    let startList = null;
    function openStartup() {
      frame('Startup apps');
      startList = WS.ui.listView({
        columns: [{ key: 'name', label: 'Name', width: 260, render: r => h('span.tm-dname', h('span.tm-rowico', { html: ROW_ICONS.app }), r.name) }, { key: 'publisher', label: 'Publisher', width: 200 },
          { key: 'status', label: 'Status', width: 100 }, { key: 'impact', label: 'Startup impact', width: 120 }],
        rows: () => WS.proc.startupApps().filter(e => !tm.search || e.name.toLowerCase().includes(tm.search) || (e.publisher || '').toLowerCase().includes(tm.search))
          .map(e => ({ id: e.id, name: e.name, publisher: e.publisher, status: e.enabled ? 'Enabled' : 'Disabled', impact: e.impact || 'Not measured', e })),
        getId: r => r.id, sortKey: 'name', sortDir: 1, emptyText: 'There are no startup items to display.',
        onSelect: rows => { tm.sel.startup = rows[0] ? rows[0].id : null; setCommands(startCommands()); },
        onContext: (rows, x, y) => { if (rows[0]) WS.ui.contextMenu(x, y, startMenu(rows[0].e)); }
      });
      body.appendChild(startList.el);
      if (tm.sel.startup) startList.select([tm.sel.startup]);
      setCommands(startCommands());
    }
    const selStartup = () => WS.proc.startupApps().find(e => e.id === tm.sel.startup) || null;
    const startPath = e => String(e.command).replace(/%windir%/i, 'C:\\Windows').replace(/^"/, '').replace(/".*$/, '').replace(/\.exe .*$/i, '.exe');
    function startCommands() {
      const e = selStartup();
      return [{ label: 'Run new task', icon: 'run', action: () => runNewTask() },
        { label: 'Enable', icon: 'enable', disabled: !e || e.enabled, action: () => WS.proc.setStartupEnabled(e.id, true) },
        { label: 'Disable', icon: 'disable', disabled: !e || !e.enabled, action: () => WS.proc.setStartupEnabled(e.id, false) },
        { label: 'Properties', icon: 'props', disabled: !e, action: () => startProps(e) }];
    }
    function startMenu(e) {
      return [e.enabled ? { label: '&Disable', action: () => WS.proc.setStartupEnabled(e.id, false) } : { label: '&Enable', action: () => WS.proc.setStartupEnabled(e.id, true) },
        { label: '&Open file location', action: () => openLocation(startPath(e)) }, { label: 'Search online', action: () => WS.apps.launch('edge') },
        { label: 'P&roperties', action: () => startProps(e) }];
    }
    const startProps = e => fileProperties({ image: startPath(e).replace(/^.*\\/, ''), path: startPath(e), description: e.name, company: e.publisher });

    /* ================================================================ Users */
    function userNodes() {
      const procs = WS.proc.list().filter(p => p.session === 1 && p.user.toLowerCase() === ((WS.session && WS.session.user) || 'Administrator').toLowerCase());
      if (!procs.length) return [];
      const kids = procs.filter(p => !p.hostKey).map(p => ({ id: 'u:' + p.key, name: p.appName || (p.shell ? 'Windows Explorer' : p.description || p.image), proc: p, live: sumLive([p, ...procs.filter(x => x.hostKey === p.key)]), icon: p.kind === 'app' ? appIcon(p.appId === 'mmc' ? 'services' : p.appId) : ROW_ICONS.app }));
      const name = prefs().fullAccountName ? `${WS.proc.accountDomain()}\\${(WS.session && WS.session.user) || 'Administrator'}` : (WS.session && WS.session.user) || 'Administrator';
      return [{ id: 'user', name, live: sumLive(procs), children: kids.sort((a, b) => a.name.localeCompare(b.name)), icon: ROW_ICONS.user, count: kids.length }];
    }
    function openUsers() { frame('Users'); renderUsers(); }
    function renderUsers() {
      const t = tm.totals || WS.proc.totals();
      const nodes = userNodes();
      const scroller = body.querySelector('.tm-scroll');
      const top = scroller ? scroller.scrollTop : 0;
      const head = h('tr', ...[['User', null], ['Status', null], ['CPU', pct1(t.cpu).replace(/\.\d%/, '%')], ['Memory', Math.round(t.memory.percent) + '%'], ['Disk', Math.round(t.disk.active) + '%'], ['Network', '0%']]
        .map(([l, sum], i) => h('th.tm-th' + (i === 0 ? '.tm-name' : i === 1 ? '.tm-statcol' : '.tm-num'), h('div.tm-sum', sum || '\u00a0'), h('div.tm-colname', l))));
      const rows = [];
      const row = (n, depth) => {
        const l = n.live, open = tm.expanded.has('users:' + n.id);
        const tr = h('tr.tm-row' + (tm.sel.users === n.id ? '.sel' : ''), { dataset: { id: n.id } },
          h('td.tm-name', h('div.tm-namewrap', { style: { paddingLeft: (depth ? 30 : 4) + 'px' } }, n.children ? h('span.tm-exp', { onClick: e => { e.stopPropagation(); open ? tm.expanded.delete('users:' + n.id) : tm.expanded.add('users:' + n.id); renderUsers(); } }, open ? '\u02C5' : '\u203A') : h('span.tm-exp.none'),
            h('span.tm-rowico', { html: n.icon }), h('span.tm-rowname', n.name + (n.count ? ` (${n.count})` : '')))),
          h('td.tm-statcol', ''), h('td.tm-num', { style: heat(l.cpu / 40) }, pct1(l.cpu)), h('td.tm-num', { style: heat(l.mem / 400000) }, mb(l.mem)), h('td.tm-num', { style: heat(l.disk / 10) }, mbs(l.disk)), h('td.tm-num', { style: heat(l.net / 10) }, mbps(l.net)));
        tr.addEventListener('mousedown', () => { tm.sel.users = n.id; body.querySelectorAll('.tm-row').forEach(r => r.classList.toggle('sel', r.dataset.id === n.id)); setCommands(userCommands()); });
        tr.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); tm.sel.users = n.id; WS.ui.contextMenu(e.clientX, e.clientY, n.children ? userMenu(n) : (n.proc ? procMenu({ kind: 'process', proc: n.proc, name: n.name }) : [])); });
        rows.push(tr);
        if (n.children && open) n.children.forEach(c => row(c, 1));
      };
      nodes.forEach(n => row(n, 0));
      U.clear(body);
      const sc = h('div.tm-scroll', h('table.tm-table', h('thead', head), h('tbody', ...rows)));
      body.appendChild(sc);
      sc.scrollTop = top;
      setCommands(userCommands());
    }
    function userCommands() {
      return [{ label: 'Run new task', icon: 'run', action: () => runNewTask() }, { label: 'Disconnect', icon: 'disconnect', disabled: tm.sel.users !== 'user', action: () => disconnect() },
        { label: 'Manage user accounts', icon: 'users', action: () => WS.apps.launch('settings', { page: 'otherusers' }) }];
    }
    function userMenu(n) {
      const open = tm.expanded.has('users:' + n.id);
      return [{ label: open ? 'Collapse' : '&Expand', action: () => { open ? tm.expanded.delete('users:' + n.id) : tm.expanded.add('users:' + n.id); renderUsers(); } },
        { label: '&Disconnect', action: () => disconnect() }, { label: 'Sign &off', action: () => signOff() }, { label: 'Send &message...', action: () => sendMessage() }, { separator: true },
        { label: 'Manage user accounts', action: () => WS.apps.launch('settings', { page: 'otherusers' }) }];
    }
    async function disconnect() {
      if (await msg('Are you sure you want to disconnect the selected user?', 'You are about to disconnect your own session. Your programs keep running, and you can sign in again to reconnect.', ['Disconnect user', 'Cancel']) !== 'Disconnect user') return;
      WS.shell.lock();
    }
    async function signOff() {
      if (await msg('Are you sure you want to sign off the selected user?', 'Any unsaved data will be lost.', ['Sign out user', 'Cancel']) !== 'Sign out user') return;
      WS.shell.signOut();
    }
    async function sendMessage() {
      const title = F.text({ value: `Message from ${(WS.session && WS.session.user) || 'Administrator'}`, width: 300 }), text = F.textarea({ rows: 4, width: 300 });
      const r = await WS.ui.dialog({ title: 'Send message', width: 380, content: h('div.w32', F.stack('Message title:', title), F.stack('Message:', text)), buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
      if (r === 'OK' && text.value.trim()) WS.ui.msgbox({ title: title.value, icon: 'info', message: text.value });
    }

    /* ================================================================ App history */
    function openAppHistory() {
      frame('App history');
      if (!prefs().appHistorySince) { prefs().appHistorySince = WS.state.system.installDate || new Date().toISOString(); }
      const note = h('div.tm-note', `Resource usage since ${U.fmtDate(new Date(prefs().appHistorySince))} for current user account.`);
      const apps = [['Lab Guide', 'lab'], ['Microsoft Edge', 'edge'], ['Notepad', 'notepad'], ['Windows Security', null], ['Windows Terminal', 'terminal']];
      const list = WS.ui.listView({
        columns: [{ key: 'name', label: 'Name', width: 260, render: r => h('span.tm-dname', h('span.tm-rowico', { html: r.icon }), r.name) }, { key: 'cpu', label: 'CPU time', width: 100, align: 'right' },
          { key: 'net', label: 'Network', width: 100, align: 'right' }, { key: 'metered', label: 'Metered network', width: 120, align: 'right' }, { key: 'tiles', label: 'Tiles', width: 80, align: 'right' }],
        rows: () => apps.filter(([n]) => !tm.search || n.toLowerCase().includes(tm.search)).map(([n, id]) => ({ id: n, name: n, icon: id ? appIcon(id) : ROW_ICONS.app, cpu: '0:00:00', net: '0 MB', metered: '0 MB', tiles: '0 MB' })),
        getId: r => r.id, sortKey: 'name', sortDir: 1
      });
      body.append(note, list.el);
      setCommands([{ label: 'Delete usage history', icon: 'trash', action: () => { prefs().appHistorySince = new Date().toISOString(); WS.store.changed('taskmgr'); note.textContent = `Resource usage since ${U.fmtDate(new Date())} for current user account.`; } }]);
    }

    /* ================================================================ Performance */
    const COLORS = { cpu: '#117dbb', mem: '#8b12ae', disk: '#4da60c', net: '#a74f01' };
    const perfDisks = () => WS.storage.disks().filter(d => d.online && d.partitions.some(p => p.letter));
    function graph(data, color, max, o = {}) {
      const n = 60, pts = [];
      const vals = data.slice(-n);
      vals.forEach((v, i) => pts.push(`${(100 - (vals.length - 1 - i) * (100 / (n - 1))).toFixed(2)},${(100 - Math.min(100, v / max * 100)).toFixed(2)}`));
      const ve = 'vector-effect="non-scaling-stroke"';
      const grid = o.grid === false ? '' : Array.from({ length: 9 }, (_, i) => `<path ${ve} d="M0 ${(i + 1) * 10}H100" />`).join('') + Array.from({ length: 19 }, (_, i) => `<path ${ve} d="M${(i + 1) * 5} 0V100" />`).join('');
      const line = pts.length > 1 ? `<polygon points="${pts[0].split(',')[0]},100 ${pts.join(' ')} 100,100" fill="${color}" fill-opacity=".1"/><polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"/>` : '';
      return h('div.tm-graph' + (o.mini ? '.mini' : ''), { style: { borderColor: color }, html: `<svg viewBox="0 0 100 100" preserveAspectRatio="none"><g stroke="${color}" stroke-opacity=".16" stroke-width="1">${grid}</g>${line}</svg>` });
    }
    const netScale = () => { const m = Math.max(1, ...tm.hist.net); return [100, 500, 1000, 5000, 10000, 50000, 100000, 1000000].find(s => s >= m) || 1000000; };
    const scaleLabel = kbps => (kbps >= 1000 ? kbps / 1000 + ' Mbps' : kbps + ' Kbps');
    function perfTiles(t) {
      const a = WS.net.adapter();
      const tiles = [{ id: 'cpu', label: 'CPU', sub: `${Math.round(t.cpu)}%  ${t.speedGHz.toFixed(2)} GHz`, data: tm.hist.cpu, color: COLORS.cpu, max: 100 },
        { id: 'mem', label: 'Memory', sub: `${gb(t.memory.usedKB).replace(' GB', '')}/${gb(t.memory.totalKB)} (${Math.round(t.memory.percent)}%)`, data: tm.hist.mem, color: COLORS.mem, max: 100 },
        ...perfDisks().map(d => ({ id: 'disk' + d.number, label: `Disk ${d.number} (${d.partitions.filter(p => p.letter).map(p => p.letter + ':').join(' ')})`, sub: `Unknown\n${Math.round((tm.hist.disk['disk' + d.number] || [0]).slice(-1)[0] || 0)}%`, data: tm.hist.disk['disk' + d.number] || [], color: COLORS.disk, max: 100 })),
        a && a.enabled ? { id: 'net', label: 'Ethernet', sub: a.connected === false ? 'Not connected' : `Ethernet\nS: ${t.net.sendKbps} R: ${t.net.recvKbps} Kbps`, data: tm.hist.net, color: COLORS.net, max: netScale() } : null].filter(Boolean);
      return tiles;
    }
    function renderPerformance() {
      const t = tm.totals || WS.proc.totals();
      const tiles = perfTiles(t);
      if (!tiles.some(x => x.id === tm.perf)) tm.perf = 'cpu';
      U.clear(body);
      const side = h('div.tm-perfside', ...tiles.map(x => h('div.tm-tile' + (x.id === tm.perf ? '.sel' : ''), { dataset: { tile: x.id }, onClick: () => { tm.perf = x.id; renderPerformance(); } },
        graph(x.data, x.color, x.max, { mini: true, grid: false }), h('div.tm-tiletext', h('div.tm-tilelabel', x.label), h('div.tm-tilesub', x.sub)))));
      body.append(h('div.tm-perf', side, h('div.tm-perfmain', perfDetail(tm.perf, t))));
      setCommands([{ label: 'Run new task', icon: 'run', action: () => runNewTask() }, { label: 'More options', icon: 'more', text: false, menu: [{ label: 'Open Resource Monitor', action: () => WS.apps.notImplemented('Resource Monitor') }, { label: 'Copy', action: () => {} }] }]);
    }
    const stat = (label, value) => h('div.tm-stat', h('div.tm-statlabel', label), h('div.tm-statval', value));
    const kv = rows => h('table.tm-kvstats', h('tbody', ...rows.map(([k, v]) => h('tr', h('td', k), h('td', v)))));
    function perfDetail(id, t) {
      const titleRow = (title, model) => h('div.tm-perfhead', h('div.tm-perftitle', title), h('div.tm-perfmodel', model));
      const axis = (l, r) => h('div.tm-axis', h('span', l), h('span', r));
      if (id === 'cpu') {
        const g = prefs().cpuGraph === 'logical'
          ? h('div.tm-cores', ...tm.hist.cores.map(c => graph(c, COLORS.cpu, 100)))
          : graph(tm.hist.cpu, COLORS.cpu, 100);
        g.addEventListener('contextmenu', e => { e.preventDefault(); WS.ui.contextMenu(e.clientX, e.clientY, [{ label: 'Change graph to', items: [
          { label: 'Overall utilization', radio: true, checked: prefs().cpuGraph !== 'logical', action: () => { prefs().cpuGraph = 'overall'; renderPerformance(); } },
          { label: 'Logical processors', radio: true, checked: prefs().cpuGraph === 'logical', action: () => { prefs().cpuGraph = 'logical'; renderPerformance(); } }] }]); });
        return h('div', titleRow('CPU', 'Intel(R) Xeon(R) CPU E5-2673 v4 @ 2.30GHz'), axis('% Utilization', '100%'), g, axis('60 seconds', '0'),
          h('div.tm-stats', h('div.tm-statgrid', stat('Utilization', Math.round(t.cpu) + '%'), stat('Speed', t.speedGHz.toFixed(2) + ' GHz'), h('div'), stat('Processes', t.processes), stat('Threads', t.threads.toLocaleString('en-US')), stat('Handles', t.handles.toLocaleString('en-US')), stat('Up time', uptime(t.uptimeMs))),
            kv([['Base speed:', '2.30 GHz'], ['Sockets:', '1'], ['Virtual processors:', String(WS.proc.NCPU)], ['Virtual machine:', 'Yes'], ['L1 cache:', 'N/A']])));
      }
      if (id === 'mem') {
        const m = t.memory;
        const comp = h('div.tm-memcomp', h('div', { style: { width: (m.usedKB / m.totalKB * 100).toFixed(1) + '%', background: 'rgba(139,18,174,.35)' } }), h('div', { style: { width: '2%', background: 'rgba(139,18,174,.2)' } }),
          h('div', { style: { width: (m.cachedKB / m.totalKB * 100).toFixed(1) + '%', background: 'rgba(139,18,174,.1)' } }));
        return h('div', titleRow('Memory', gb(m.totalKB)), axis('Memory usage', gb(m.totalKB)), graph(tm.hist.mem, COLORS.mem, 100), axis('60 seconds', '0'), axis('Memory composition', ''), comp,
          h('div.tm-stats', h('div.tm-statgrid', stat('In use (Compressed)', `${gb(m.usedKB)} (0 MB)`), stat('Available', gb(m.availableKB)), h('div'), stat('Committed', `${gb(m.committedKB).replace(' GB', '')}/${gb(m.commitLimitKB)}`), stat('Cached', gb(m.cachedKB)), h('div'),
            stat('Paged pool', Math.round(m.pagedKB / 1024) + ' MB'), stat('Non-paged pool', Math.round(m.nonpagedKB / 1024) + ' MB')),
            kv([['Slots used:', 'N/A'], ['Hardware reserved:', '1.5 MB']])));
      }
      if (id.startsWith('disk')) {
        const d = perfDisks().find(x => 'disk' + x.number === id);
        const h2 = tm.hist.disk[id] || [];
        const active = Math.round(h2.slice(-1)[0] || 0);
        const sizeGB = Math.round(d.size / 1073741824);
        const fmtGB = Math.round(d.partitions.filter(p => p.fs).reduce((a, p) => a + p.size, 0) / 1073741824);
        return h('div', titleRow(`Disk ${d.number} (${d.partitions.filter(p => p.letter).map(p => p.letter + ':').join(' ')})`, 'Microsoft Virtual Disk'), axis('Active time', '100%'), graph(h2, COLORS.disk, 100), axis('60 seconds', '0'),
          axis('Disk transfer rate', '10 KB/s'), graph(h2.map(v => v * 0.6), COLORS.disk, 100), axis('60 seconds', '0'),
          h('div.tm-stats', h('div.tm-statgrid', stat('Active time', active + '%'), stat('Average response time', (active ? (0.4 + Math.random()).toFixed(1) : '0.0') + ' ms'), h('div'),
            stat('Read speed', d.number === 0 ? `${t.disk.readKBs} KB/s` : '0 KB/s'), stat('Write speed', d.number === 0 ? `${t.disk.writeKBs} KB/s` : '0 KB/s')),
            kv([['Capacity:', sizeGB + ' GB'], ['Formatted:', fmtGB + ' GB'], ['System disk:', d.number === 0 ? 'Yes' : 'No'], ['Page file:', d.number === 0 ? 'Yes' : 'No'], ['Type:', 'Unknown']])));
      }
      const a = WS.net.adapter();
      const sc = netScale();
      return h('div', titleRow('Ethernet', a.description || 'Microsoft Hyper-V Network Adapter'), axis('Throughput', scaleLabel(sc)), graph(tm.hist.net, COLORS.net, sc), axis('60 seconds', '0'),
        h('div.tm-stats', h('div.tm-statgrid', stat('Send', `${t.net.sendKbps} Kbps`), stat('Receive', `${t.net.recvKbps} Kbps`)),
          kv([['Adapter name:', a.name], ['Connection type:', 'Ethernet'], ['IPv4 address:', a.ip || ''], ['IPv6 address:', (a.linkLocal6 || '').replace(/%\d+$/, '')]])));
    }

    /* ================================================================ Settings */
    function openSettings() {
      frame('Settings');
      const p = prefs();
      const save = (k, v) => { p[k] = v; WS.store.changed('taskmgr'); if (k === 'speed') schedule(); if (k === 'alwaysOnTop') { if (v) applyOnTop(); else win.focus(); } };
      const chk = (k, label) => h('label.tm-check', h('input', { type: 'checkbox', checked: !!p[k], dataset: { pref: k }, onChange: e => save(k, e.target.checked) }), h('span', label));
      const sel = (k, opts) => h('select.tm-select', { dataset: { pref: k }, onChange: e => save(k, e.target.value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: p[k] === v }, l)));
      body.appendChild(h('div.tm-settings',
        h('div.tm-setcard', h('div.tm-setrow', h('div', h('div.tm-setname', 'Default start page'), h('div.tm-setdesc', 'Choose which page to show when Task Manager opens')), sel('startPage', PAGES))),
        h('div.tm-setcard', h('div.tm-setrow', h('div', h('div.tm-setname', 'Real time update speed'), h('div.tm-setdesc', 'Choose how often Task Manager updates its data')), sel('speed', [['High', 'High'], ['Normal', 'Normal'], ['Low', 'Low'], ['Paused', 'Paused']]))),
        h('div.tm-setcard', h('div.tm-setname', 'Window management'), chk('alwaysOnTop', 'Always on top'), chk('minimizeOnUse', 'Minimize on use'), chk('hideWhenMinimized', 'Hide when minimized')),
        h('div.tm-setcard', h('div.tm-setname', 'Other options'), chk('fullAccountName', 'Show full account name'), chk('historyAll', 'Show history for all processes'), chk('askEfficiency', 'Ask me before applying Efficiency mode'))));
      setCommands([]);
    }

    const PAGE = {
      processes: { open: () => { frame('Processes'); renderProcesses(); }, refresh: renderProcesses },
      performance: { open: () => { frame('Performance'); renderPerformance(); }, refresh: renderPerformance },
      apphistory: { open: openAppHistory },
      startup: { open: openStartup, refresh: () => { startList.refresh(); setCommands(startCommands()); } },
      users: { open: openUsers, refresh: renderUsers },
      details: { open: openDetails, refresh: () => { detailsList.refresh(); setCommands(detailCommands()); } },
      services: { open: openServices, refresh: () => { svcList.refresh(); setCommands(svcCommands()); } },
      settings: { open: openSettings }
    };

    win.taskmgr = {
      go, page: () => tm.page, tick, refresh, prefs, el: root,
      nodes: () => { if (tm.page === 'processes') return flatNodes(); return []; },
      groups: () => lastNodes,
      select(id) { if (tm.page === 'processes') selectProc(id); else if (tm.page === 'details') { tm.sel.details = String(id); detailsList.select([String(id)]); setCommands(detailCommands()); } else if (tm.page === 'services') { tm.sel.services = id; svcList.select([id]); setCommands(svcCommands()); } else if (tm.page === 'startup') { tm.sel.startup = id; startList.select([id]); setCommands(startCommands()); } else if (tm.page === 'users') { tm.sel.users = id; renderUsers(); } },
      selected: () => tm.sel[tm.page],
      expand(id) { tm.expanded.add(id); renderProcesses(); },
      commands: () => cmds.map(c => ({ label: c.label, disabled: !!c.disabled })),
      command(label) { const c = cmds.find(x => x.label === label); if (!c) throw new Error('No command ' + label); if (c.disabled) return null; return c.menu ? (typeof c.menu === 'function' ? c.menu() : c.menu) : c.action(); },
      menu() {
        if (tm.page === 'processes') { const n = selNode(); return n ? procMenu(n) : []; }
        if (tm.page === 'details') { const p = selDetail(); return p ? detailMenu(p) : []; }
        if (tm.page === 'services') { const r = svcList.selected()[0]; return r ? svcMenu(r) : []; }
        if (tm.page === 'startup') { const e = selStartup(); return e ? startMenu(e) : []; }
        if (tm.page === 'users') { const n = userNodes()[0]; return n ? userMenu(n) : []; }
        return [];
      },
      runNewTask, endProcess, search(q) { search.value = q; tm.search = q.toLowerCase(); refresh(); }, perf: id => { tm.perf = id; renderPerformance(); },
      setSort(key, dir) { tm.sort.processes = key ? { key, dir } : null; renderProcesses(); }
    };
    tick();
    go(args.page || P.startPage || 'processes');
    schedule();
    applyOnTop();
    return win;
  }

  WS.taskmgr = { launch, runNewTask, endProcess, confirmCritical, lastDialog: null, ICON };
  WS.apps.register({ id: 'taskmgr', name: 'Task Manager', icon: ICON, singleton: true, keywords: ['task manager', 'taskmgr', 'processes', 'performance', 'end task'], launch });
})();
