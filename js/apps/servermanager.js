/* Server Manager: Dashboard, Local Server, All Servers, one page per installed role and File and Storage Services
 * (its sub-pages - Servers, Volumes, Disks, Storage Pools, Shares, iSCSI, Work Folders - live in sm-fss.js); the notifications
 * flag (post-deployment configuration, feature installation results) and Task Details; Manage / Tools /
 * View / Help menus. The wizards live in sm-roles-wizard.js, sm-adds-wizard.js and sm-dhcp-wizard.js and
 * hang off WS.sm (WS.sm.addRoles(), removeRoles(), addsConfig(), dhcpConfig()).
 * State: servermanager.{hideWelcome, skipBeforeYouBegin, noAutoStart}. Notifications about finished
 * installations are runtime-only, like a real Server Manager session; post-deployment tasks come from
 * WS.features.postTasks() and survive restarts. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons;

  WS.store.init('servermanager', s => { s.servermanager = { hideWelcome: false, skipBeforeYouBegin: false, noAutoStart: false }; });
  const SMS = () => WS.state.servermanager;

  /* ---------------------------------------------------------------- roles: names and scope */
  const ROLE_INFO = {
    'AD-Certificate': { short: 'AD CS', post: 'Active Directory Certificate Services' },
    'AD-Domain-Services': { short: 'AD DS', logs: ['Directory Service', 'DFS Replication'], sources: ['NETLOGON', 'NTDS'], dc: true },
    'ADFS-Federation': { short: 'AD FS' }, ADLDS: { short: 'AD LDS' }, ADRMS: { short: 'AD RMS' },
    DHCP: { short: 'DHCP', sources: ['Microsoft-Windows-DHCP-Server'] },
    DNS: { short: 'DNS', logs: ['DNS Server'] },
    'FileAndStorage-Services': { short: 'File and Storage Services', services: ['LanmanServer'] },
    'Hyper-V': { short: 'Hyper-V' }, NPAS: { short: 'NPAS' }, 'Print-Services': { short: 'Print Services', services: ['Spooler'] },
    RemoteAccess: { short: 'Remote Access' }, 'Remote-Desktop-Services': { short: 'Remote Desktop Services' },
    VolumeActivation: { short: 'Volume Activation Services' }, 'Web-Server': { short: 'IIS' },
    WDS: { short: 'WDS' }, UpdateServices: { short: 'WSUS' }
  };
  const roleNode = id => WS.catalog.features.get(id);
  const shortName = id => (ROLE_INFO[id] && ROLE_INFO[id].short) || roleNode(id).name;
  const subtreeIds = node => [node.id, ...node.children.flatMap(subtreeIds)];
  /** The page a role's tile and nav entry open; File and Storage Services has its own sub-pages (page 'fss:<sub>'). */
  const rolePage = id => (id === 'FileAndStorage-Services' && WS.smfss ? 'fss' : 'role:' + id);

  /** Services shown on a role page (or every service for the server pages). */
  function scopeServices(roleId) {
    const all = WS.svc.list();
    if (!roleId) return all;
    const node = roleNode(roleId), info = ROLE_INFO[roleId] || {};
    const ids = new Set(subtreeIds(node));
    const names = new Set(WS.catalog.services.filter(s => (s.feature && ids.has(s.feature)) || (info.dc && s.feature === '#dc')).map(s => s.name).concat(info.services || []));
    return all.filter(s => names.has(s.name));
  }
  /** Critical, Error and Warning events from the last 24 hours (Server Manager's default event filter). */
  function scopeEvents(roleId) {
    const since = Date.now() - 864e5;
    const bad = e => ['Critical', 'Error', 'Warning'].includes(e.level) && new Date(e.time).getTime() >= since;
    const out = [];
    const take = (log, filter) => WS.evt.list(log).filter(e => bad(e) && (!filter || filter(e))).forEach(e => out.push({ ...e, log }));
    if (!roleId) ['System', 'Application', ...WS.evt.logNames().filter(l => !['System', 'Application', 'Security', 'Setup', 'Windows PowerShell'].includes(l))].forEach(l => take(l));
    else {
      const info = ROLE_INFO[roleId] || {};
      (info.logs || []).forEach(l => take(l));
      if (info.sources) take('System', e => info.sources.includes(e.source));
    }
    return out.sort((a, b) => new Date(b.time) - new Date(a.time));
  }
  const stoppedAutomatic = list => list.filter(s => /^Automatic/.test(s.startType) && s.status !== 'Running');

  /* ---------------------------------------------------------------- notifications */
  const notes = []; // runtime: { id, title, message, status: 'done'|'warning'|'error'|'running', time, actions: [{label, fn}] }
  const emit = () => WS.store.emit('change:sm', 'sm');
  const POST = {
    adds: { role: 'AD-Domain-Services', action: 'Promote this server to a domain controller', run: () => WS.sm.addsConfig() },
    dhcp: { role: 'DHCP', action: 'Complete DHCP configuration', run: () => WS.sm.dhcpConfig() },
    adcs: { role: 'AD-Certificate', action: 'Configure Active Directory Certificate Services on the destination server', run: () => WS.apps.notImplemented('AD CS Configuration') },
    wsus: { role: 'UpdateServices', action: 'Launch Post-Installation tasks', run: () => WS.apps.notImplemented('WSUS Post-Installation tasks') }
  };
  function postNotes() {
    return WS.features.postTasks().map(t => {
      const p = POST[t.id] || {};
      const role = roleNode(p.role || t.feature);
      return { id: 'post:' + t.id, post: true, title: 'Post-deployment Configuration', stage: 'Not started', status: 'warning', time: t.created,
        message: `Configuration required for ${role ? role.name : t.title} at ${WS.sys.name}`, actions: [{ label: p.action || t.title, fn: p.run || (() => {}) }] };
    });
  }
  const allNotes = () => [...postNotes(), ...notes.slice().reverse()];
  function notify(n) { notes.push({ id: U.uid('note'), time: new Date().toISOString(), status: 'done', actions: [], ...n }); emit(); }
  function dismiss(id) { const i = notes.findIndex(n => n.id === id); if (i >= 0) notes.splice(i, 1); emit(); }

  function taskDetails() {
    const lv = WS.ui.listView({
      columns: [
        { key: 'status', label: 'Status', width: 55, render: n => h('span.sm-ticon', { html: n.status === 'warning' ? I.eventWarning : n.status === 'error' ? I.eventError : I.enable }) },
        { key: 'title', label: 'Task Name', width: 190 },
        { key: 'stage', label: 'Stage', width: 90, value: n => n.stage || 'Completed' },
        { key: 'message', label: 'Message', width: 280 },
        { key: 'action', label: 'Action', width: 230, render: n => n.actions[0] ? h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); WS.ui.closeMenu(); close(); n.actions[0].fn(); } }, n.actions[0].label) : '' },
        { key: 'notes', label: 'Notifications', width: 80, value: () => '1' }
      ],
      rows: allNotes, getId: n => n.id, multi: false, sortKey: null, emptyText: 'There are no tasks to show.'
    });
    lv.el.style.height = '260px';
    let close = () => {};
    WS.ui.dialog({ title: 'All Servers Task Details and Notifications', width: 920, content: h('div.w32', h('div.sm-sub', 'All Tasks | ' + allNotes().length + ' total'), lv.el),
      buttons: [{ label: 'Close', primary: true, cancel: true }], onCreate: fr => { close = () => fr.close('Close'); } });
  }

  /* ---------------------------------------------------------------- the window */
  function launch(args = {}) {
    const win = WS.wm.create({ app: 'servermanager', title: 'Server Manager', icon: I.servermanager, width: 1180, height: 720, maximized: window.innerWidth < 1300 });
    let page = args.page || 'dashboard', lastFss = 'servers';
    const crumb = h('div.sm-crumb');
    const nav = h('div.sm-nav');
    const subnav = h('div.sm-subnav', { style: 'display:none' });
    const content = h('div.sm-content');
    const flagBtn = h('button.sm-flag', { title: 'Notifications', html: FLAG });
    const refreshBtn = h('button.sm-refresh', { title: 'Refresh "' + 'Server Manager' + '"', html: I.refresh, onClick: () => { refreshBtn.classList.add('spin'); setTimeout(() => refreshBtn.classList.remove('spin'), 600); render(); } });
    const menu = (label, items) => { const el = h('span.sm-menu', label); el.addEventListener('click', () => WS.ui.popupMenu(el, items)); return el; };
    win.body.appendChild(h('div.sm',
      h('div.sm-head', crumb, refreshBtn, flagBtn, h('div.sm-menus',
        menu('Manage', manageMenu), menu('Tools', toolsMenu), menu('View', () => [{ label: 'Show Welcome Tile', checked: !SMS().hideWelcome, action: () => { SMS().hideWelcome = !SMS().hideWelcome; WS.store.changed('servermanager'); } }]),
        menu('Help', helpMenu))),
      h('div.sm-main', nav, subnav, content)));
    flagBtn.addEventListener('click', e => { e.stopPropagation(); toggleNotes(); });

    const go = id => { page = id; render(); content.scrollTop = 0; };
    win.sm = { go, get page() { return page; }, render };

    function pages() {
      const roles = WS.features.installedRoles();
      return [['dashboard', 'Dashboard', I.servermanager], ['local', 'Local Server', I.server], ['all', 'All Servers', I.server],
        ...roles.map(r => [rolePage(r.id), shortName(r.id), I.server])];
    }
    const ctx = { win, get content() { return content; }, go, render: () => render(), serversPage: id => serversPage(id), banner: (...a) => banner(...a) };
    function render() {
      const list = pages();
      if (page === 'fss') page = 'fss:' + lastFss;
      const fss = /^fss:/.test(page) && list.some(p => p[0] === 'fss') ? page.slice(4) : null;
      if (fss) lastFss = fss;
      else if (!list.some(p => p[0] === page)) page = 'dashboard';
      U.clear(nav);
      nav.classList.toggle('narrow', !!fss);
      for (const [id, label, icon] of list) {
        nav.appendChild(h('div' + (page === id || (fss && id === 'fss') ? '.sel' : ''), { title: label, onClick: () => go(id) },
          h('span', { html: icon }), h('span.l', label), id === 'fss' ? h('span.arr', '▸') : null));
      }
      subnav.style.display = fss ? '' : 'none';
      if (fss) WS.smfss.subnav(subnav, fss, sub => go('fss:' + sub));
      const crumbs = fss ? ['File and Storage Services', ...WS.smfss.crumbs(fss)] : [list.find(p => p[0] === page)[1]];
      crumb.innerHTML = 'Server Manager' + crumbs.map((c, i) => ` <span class="sep">▸</span> ${i === crumbs.length - 1 ? `<b>${U.esc(c)}</b>` : U.esc(c)}`).join('');
      paintFlag();
      const top = content.scrollTop;
      U.clear(content);
      if (page === 'dashboard') dashboard();
      else if (page === 'local') localServer();
      else if (page === 'all') serversPage(null);
      else if (fss) WS.smfss.render(fss, ctx);
      else serversPage(page.slice(5));
      content.scrollTop = top;
    }
    function paintFlag() {
      const n = allNotes();
      flagBtn.classList.toggle('warn', n.some(x => x.status === 'warning'));
      flagBtn.classList.toggle('err', n.some(x => x.status === 'error'));
      flagBtn.dataset.count = n.length || '';
    }

    /* ---------------- notifications flyout ---------------- */
    let notesEl = null;
    function closeNotes() { if (notesEl) { notesEl.remove(); notesEl = null; document.removeEventListener('pointerdown', outside, true); } }
    function outside(e) { if (notesEl && !notesEl.contains(e.target) && !flagBtn.contains(e.target)) closeNotes(); }
    function toggleNotes() {
      if (notesEl) return closeNotes();
      notesEl = h('div.sm-notes');
      const list = allNotes();
      if (!list.length) notesEl.appendChild(h('div.sm-note.empty', 'No notifications'));
      for (const n of list) {
        notesEl.appendChild(h('div.sm-note',
          h('div.sm-note-head', h('span', { html: n.status === 'warning' ? I.eventWarning : n.status === 'error' ? I.eventError : n.status === 'running' ? I.refresh : I.enable }), h('b', n.title),
            n.post ? null : h('button.sm-note-x', { title: 'Remove', onClick: () => { dismiss(n.id); closeNotes(); toggleNotes(); } }, '✕')),
          h('div.sm-note-msg', n.message),
          ...n.actions.map(a => h('div', h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); closeNotes(); a.fn(); } }, a.label)))));
      }
      notesEl.appendChild(h('div.sm-note-foot', h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); closeNotes(); taskDetails(); } }, 'Task Details')));
      win.body.querySelector('.sm').appendChild(notesEl);
      const fr = flagBtn.getBoundingClientRect(), wr = win.body.getBoundingClientRect();
      notesEl.style.top = (fr.bottom - wr.top + 2) + 'px';
      notesEl.style.right = Math.max(8, wr.right - fr.right - 120) + 'px';
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    }
    win.onClose(closeNotes);

    /* ---------------- dashboard ---------------- */
    function dashboard() {
      if (!SMS().hideWelcome) {
        const step = (n, text, fn) => h('div.sm-step', h('span.n', n), h('a', { href: '#', onClick: e => { e.preventDefault(); fn(); } }, text));
        content.appendChild(h('div.sm-welcome',
          h('div.side', h('div.on', 'QUICK START'), h('div', "WHAT'S NEW"), h('div', 'LEARN MORE')),
          h('div.qs', h('h2', 'WELCOME TO SERVER MANAGER'),
            step(1, 'Configure this local server', () => go('local')),
            step(2, 'Add roles and features', () => WS.sm.addRoles()),
            step(3, 'Add other servers to manage', () => WS.apps.notImplemented('Add Servers')),
            step(4, 'Create a server group', () => WS.apps.notImplemented('Create Server Group')),
            step(5, 'Connect this server to cloud services', () => WS.apps.notImplemented('Azure Arc')),
            h('a.sm-hide', { href: '#', onClick: e => { e.preventDefault(); SMS().hideWelcome = true; WS.store.changed('servermanager'); } }, 'Hide'))));
      }
      const roles = WS.features.installedRoles();
      const tile = (name, pageId, roleId) => {
        const svcBad = stoppedAutomatic(scopeServices(roleId)).length;
        const evBad = scopeEvents(roleId).filter(e => e.level !== 'Warning').length;
        const row = (label, count) => h('div.r' + (count ? '.bad' : ''), { onClick: () => go(pageId) }, h('span', label), h('span.c', count ? String(count) : ''));
        return h('div.sm-tile' + (svcBad || evBad ? '.bad' : ''),
          h('div.t', { onClick: () => go(pageId) }, h('span', name), h('span.n', '1')),
          row('Manageability', 0), row('Events', evBad), row('Services', svcBad), row('Performance', 0), row('BPA results', 0));
      };
      content.appendChild(h('div.sm-sect',
        h('h3', 'ROLES AND SERVER GROUPS'),
        h('div.sm-sub', `Roles: ${roles.length}   |   Server groups: 1   |   Servers total: 1`),
        h('div.sm-tiles', ...roles.map(r => tile(shortName(r.id), rolePage(r.id), r.id)), tile('Local Server', 'local', null), tile('All Servers', 'all', null))));
    }

    /* ---------------- shared page sections ---------------- */
    function section(title, sub, lvOpts, tasks) {
      const filter = h('input.inp.sm-filter', { type: 'text', placeholder: 'Filter' });
      const baseRows = lvOpts.rows;
      const lv = WS.ui.listView({ ...lvOpts, rows: () => { const q = filter.value.trim().toLowerCase(); const r = baseRows(); return q ? r.filter(x => lvOpts.columns.some(c => String(c.value ? c.value(x) : x[c.key] == null ? '' : x[c.key]).toLowerCase().includes(q))) : r; } });
      filter.addEventListener('input', () => lv.refresh());
      const tasksBtn = h('button.sm-tasks', 'TASKS ▾');
      tasksBtn.addEventListener('click', () => WS.ui.popupMenu(tasksBtn, () => tasks(lv.selected())));
      const subEl = h('div.sm-sub', sub(baseRows().length));
      return h('div.sm-sect.box',
        h('div.sm-shead', h('div', h('h3', title), subEl), tasksBtn),
        h('div.sm-fbar', filter), lv.el);
    }
    const serverName = () => WS.sys.name;
    function serversSection() {
      const ip = () => [WS.net.primaryIp(), WS.net.adapter().ipv6 ? WS.net.adapter().linkLocal6.replace(/%\d+$/, '') : null].filter(Boolean).join(', ');
      return section('SERVERS', n => `All servers | ${n} total`, {
        columns: [
          { key: 'name', label: 'Server Name', width: 170 }, { key: 'ip', label: 'IPv4 Address', width: 230 },
          { key: 'manage', label: 'Manageability', width: 260 }, { key: 'update', label: 'Last Update', width: 160 }, { key: 'act', label: 'Windows Activation', width: 230 }
        ],
        rows: () => [{ id: 'local', name: serverName(), ip: ip(), manage: 'Online - Performance counters not started', update: U.fmtDateTime(WS.state.system.lastBoot || new Date()), act: '00454-40000-00001-AA000 (Not activated)' }],
        multi: false, onContext: (rows, x, y) => { if (rows.length) WS.ui.contextMenu(x, y, serverMenu()); }
      }, () => [{ label: 'Refresh', action: render }]);
    }
    const serverMenu = () => [
      { label: 'Add Roles and Features', action: () => WS.sm.addRoles() },
      { label: 'Remove Roles and Features', action: () => WS.sm.removeRoles() },
      { label: 'Restart Server', action: async () => { if ((await WS.ui.msgbox({ title: 'Restart Server', icon: 'question', message: `Are you sure you want to restart ${serverName()}?`, buttons: ['OK', 'Cancel'] })) === 'OK') WS.shell.restart(); } },
      { label: 'Computer Management', action: () => WS.apps.launch('compmgmt') },
      { label: 'Remote Desktop Connection', action: () => WS.apps.notImplemented('Remote Desktop Connection') },
      { label: 'Windows PowerShell', action: () => WS.apps.launch('powershell') },
      { separator: true },
      { label: 'Refresh', action: render }
    ];
    function eventsSection(roleId) {
      return section('EVENTS', n => `All events | ${n} total`, {
        columns: [
          { key: 'server', label: 'Server Name', width: 140, value: () => serverName() }, { key: 'id', label: 'ID', width: 60, type: 'num' },
          { key: 'level', label: 'Severity', width: 80 }, { key: 'source', label: 'Source', width: 230 }, { key: 'log', label: 'Log', width: 110 },
          { key: 'time', label: 'Date and Time', width: 160, type: 'date', render: e => U.fmtDateTime(e.time) }
        ],
        rows: () => scopeEvents(roleId), getId: e => e.log + e.record, multi: false, sortKey: 'time', sortDir: -1, emptyText: 'No events found.',
        onActivate: e => WS.ui.msgbox({ title: 'Event Detail', icon: e.level === 'Warning' ? 'warning' : 'error', message: `${e.source}  (Event ID ${e.id})`, detail: e.message })
      }, () => [{ label: 'Refresh', action: render }]);
    }
    function servicesSection(roleId) {
      const act = async (rows, fn, verb) => {
        for (const s of rows) {
          const r = fn(s.name);
          if (!r.ok) { await WS.ui.msgbox({ title: 'Server Manager', icon: 'error', message: `Couldn't ${verb} service ${s.display} on server ${serverName()}.`, detail: r.detail || r.error }); break; }
        }
      };
      const items = rows => [
        { label: 'Start Services', disabled: !rows.length, action: () => act(rows, n => WS.svc.start(n), 'start') },
        { label: 'Stop Services', disabled: !rows.length, action: () => act(rows, n => WS.svc.stop(n, { force: true }), 'stop') },
        { label: 'Restart Services', disabled: !rows.length, action: () => act(rows, n => WS.svc.restart(n, { force: true }), 'restart') },
        { label: 'Pause Services', disabled: true }, { label: 'Resume Services', disabled: true },
        { separator: true }, { label: 'Refresh', action: render }
      ];
      return section('SERVICES', n => `All services | ${n} total`, {
        columns: [
          { key: 'server', label: 'Server Name', width: 140, value: () => serverName() }, { key: 'display', label: 'Display Name', width: 260 },
          { key: 'name', label: 'Service Name', width: 150 }, { key: 'status', label: 'Status', width: 80 },
          { key: 'startType', label: 'Start Type', width: 150, value: s => (s.startType === 'AutomaticDelayedStart' ? 'Automatic (Delayed Start)' : s.startType) }
        ],
        rows: () => scopeServices(roleId), getId: s => s.name, multi: true, sortKey: 'display', emptyText: 'No services found.',
        rowClass: s => (/^Automatic/.test(s.startType) && s.status !== 'Running' ? 'sm-bad' : ''),
        onContext: (rows, x, y) => WS.ui.contextMenu(x, y, items(rows))
      }, items);
    }
    function rolesSection() {
      const path = n => { const out = []; let p = n.parent && roleNode(n.parent); while (p) { out.unshift(p.name); p = p.parent && roleNode(p.parent); } return out.join('\\'); };
      return section('ROLES AND FEATURES', n => `All roles and features | ${n} total`, {
        columns: [
          { key: 'server', label: 'Server Name', width: 140, value: () => serverName() }, { key: 'name', label: 'Role/Feature Name', width: 300 },
          { key: 'path', label: 'Path', width: 380, value: path }, { key: 'type', label: 'Type', width: 100 }
        ],
        rows: () => WS.catalog.features.all().filter(f => WS.features.isInstalled(f.id)), getId: f => f.id, multi: true, sortKey: null,
        onContext: (rows, x, y) => WS.ui.contextMenu(x, y, [{ label: 'Remove Role or Feature', disabled: !rows.length, action: () => WS.sm.removeRoles() }, { separator: true }, { label: 'Refresh', action: render }])
      }, () => [{ label: 'Add Roles and Features', action: () => WS.sm.addRoles() }, { label: 'Remove Roles and Features', action: () => WS.sm.removeRoles() }, { separator: true }, { label: 'Refresh', action: render }]);
    }

    /* ---------------- local server ---------------- */
    function localServer() {
      const s = WS.state.system;
      const nic = WS.net.adapter();
      const st = WS.net.status(nic);
      const nicText = st === 'Disabled' ? 'Disabled' : st !== 'Up' ? 'Not connected' : nic.dhcp ? 'IPv4 address assigned by DHCP, IPv6 enabled' : `${nic.ip}, IPv6 enabled`;
      const prof = WS.fw.activeProfile();
      const sysdm = tab => () => WS.apps.launch('sysdm', { tab });
      const totalDisk = WS.storage.disks().reduce((a, d) => a + d.size, 0) / WS.storage.GB;
      // Windows Update rows: "Never", "Today at 2:15 PM" or a date, as Server Manager words them
      const wu = WS.wu ? WS.wu.state() : null;
      const openWu = () => WS.apps.launch('settings', { page: 'windowsupdate' });
      const wuWhen = iso => { if (!iso) return 'Never'; const d = WS.sys.now(new Date(iso)), t = WS.sys.now(); return d.toDateString() === t.toDateString() ? `Today at ${U.fmtTime(d)}` : `${U.fmtDate(d)} ${U.fmtTime(d)}`; };
      const left = [
        ['Computer name', s.computerName + (s.pendingComputerName ? ` (pending restart: ${s.pendingComputerName})` : ''), sysdm('name')],
        s.domain ? ['Domain', s.domain, sysdm('name')] : ['Workgroup', s.workgroup, sysdm('name')],
        null,
        ['Microsoft Defender Firewall', `${prof}: ${WS.fw.profiles()[prof].enabled ? 'On' : 'Off'}`, () => WS.apps.launch('firewall')],
        ['Remote management', s.remoteMgmt ? 'Enabled' : 'Disabled', remoteMgmtDialog],
        ['Remote Desktop', s.rdpEnabled ? 'Enabled' : 'Disabled', sysdm('remote')],
        ['NIC Teaming', 'Disabled', () => WS.apps.notImplemented('NIC Teaming')],
        [nic.name, nicText, () => WS.apps.launch('ncpa')],
        ['Azure Arc Management', 'Disabled', () => WS.apps.notImplemented('Azure Arc Setup')],
        null,
        ['Operating system version', 'Microsoft Windows Server 2025 Datacenter Evaluation'],
        ['Hardware information', 'Microsoft Corporation Virtual Machine']
      ];
      const right = [
        ['Last installed updates', wuWhen(wu && wu.lastInstalled), openWu],
        ['Windows Update', (WS.wu && WS.wu.policy() && WS.wu.policy().text) || 'Download updates only, using Windows Update', openWu],
        ['Last checked for updates', wuWhen(wu && wu.lastChecked), openWu],
        null,
        ['Microsoft Defender Antivirus', 'Real-Time Protection: On', () => WS.apps.notImplemented('Windows Security')],
        ['Feedback & Diagnostics', 'Settings', () => WS.apps.launch('settings', { page: 'privacy-feedback' })],
        ['Time zone', s.timeZone, () => WS.apps.launch('timedate')],
        ['Product ID', '00454-40000-00001-AA000 (not activated)', () => WS.apps.launch('settings', { page: 'about' })],
        null,
        ['Processors', 'Intel(R) Xeon(R) CPU E5-2673 v4 @ 2.30GHz'],
        ['Installed memory (RAM)', '4 GB'],
        ['Total disk space', `${totalDisk.toFixed(1)} GB`]
      ];
      const col = rows => h('div.sm-pcol', ...rows.map(r => r ? h('div.sm-prow', h('div.k', r[0]), h('div.v' + (r[2] ? '.link' : ''), r[2] ? { onClick: r[2] } : null, r[1])) : h('div.sm-pgap')));
      const tasks = h('button.sm-tasks', 'TASKS ▾');
      tasks.addEventListener('click', () => WS.ui.popupMenu(tasks, [{ label: 'Refresh', action: render }, { label: 'Add Roles and Features', action: () => WS.sm.addRoles() }, { label: 'Shut Down Local Server', action: () => WS.shell.shutdown() }]));
      content.appendChild(h('div.sm-sect.box',
        h('div.sm-shead', h('div', h('h3', 'PROPERTIES'), h('div.sm-sub', 'For ' + s.computerName)), tasks),
        h('div.sm-props', col(left), col(right))));
      if (WS.sys.restartPending()) content.appendChild(banner(`A restart is pending on ${s.computerName}. Restart the server to complete the configuration changes.`));
      content.appendChild(eventsSection(null));
      content.appendChild(servicesSection(null));
      content.appendChild(rolesSection());
    }

    /* ---------------- all servers / role pages ---------------- */
    function serversPage(roleId) {
      if (roleId) {
        for (const n of postNotes().filter(x => POST[x.id.slice(5)] && POST[x.id.slice(5)].role === roleId)) {
          content.appendChild(banner(n.message, () => n.actions[0].fn(), 'More...'));
        }
        if (WS.features.installState(roleId) === 'UninstallPending') content.appendChild(banner(`A restart is pending on ${serverName()}. ${roleNode(roleId).name} will be removed when the server restarts.`));
      }
      content.appendChild(serversSection());
      content.appendChild(eventsSection(roleId));
      content.appendChild(servicesSection(roleId));
    }
    function banner(text, action, label) {
      return h('div.sm-banner', h('span', { html: I.eventWarning }), h('span.t', text), action ? h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); action(); } }, label || 'More...') : null);
    }

    for (const t of ['system', 'features', 'network', 'firewall', 'services', 'events', 'servermanager', 'sm', 'ad', 'storage', 'smb', 'updates']) win.listen(t, render);
    render();
    return win;
  }

  /* ---------------------------------------------------------------- menus */
  const manageMenu = () => [
    { label: 'Add Roles and Features', action: () => WS.sm.addRoles() },
    { label: 'Remove Roles and Features', action: () => WS.sm.removeRoles() },
    { label: 'Add Servers', action: () => WS.apps.notImplemented('Add Servers') },
    { label: 'Create Server Group', action: () => WS.apps.notImplemented('Create Server Group') },
    { label: 'Server Manager Properties', action: smProperties }
  ];
  const helpMenu = () => [
    { label: 'Server Manager Help', action: () => WS.ui.msgbox({ title: 'Server Manager', message: 'Help is not available in the lab simulator.', detail: 'Use the Lab Guide for hints about the current lab.' }) },
    { label: 'TechCenter', disabled: true }, { label: 'Server Manager Community Center', disabled: true }, { label: 'Provide Feedback...', disabled: true },
    { separator: true },
    { label: 'About Server Manager', action: () => WS.ui.msgbox({ title: 'About Server Manager', message: `Server Manager\nVersion ${WS.state.system.version}`, detail: 'Windows Server 2025 Lab Simulator. A training mock-up; not affiliated with or endorsed by Microsoft.' }) }
  ];
  function smProperties() {
    const mins = WS.ui.f.number({ value: 10, min: 1, max: 14400 });
    const noAuto = WS.ui.f.checkbox('Do not start Server Manager automatically at logon', SMS().noAutoStart);
    WS.ui.dialog({ title: 'Server Manager Properties', width: 400,
      content: h('div.w32', WS.ui.f.row('Refresh the data every', h('span', mins, ' minutes'), { labelWidth: 140 }), noAuto),
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }] })
      .then(r => { if (r === 'ok') { SMS().noAutoStart = noAuto.checked; WS.store.changed('servermanager'); } });
  }
  function remoteMgmtDialog() {
    const cb = WS.ui.f.checkbox('Enable remote management of this server from other computers', WS.state.system.remoteMgmt);
    WS.ui.dialog({ title: 'Configure Remote Management', width: 440,
      content: h('div.w32', h('p', { style: 'margin-top:0' }, 'Remote management allows this server to be managed remotely by using Server Manager, Windows PowerShell, and Windows Remote Management (WinRM).'), cb),
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }] })
      .then(r => {
        if (r !== 'ok') return;
        WS.state.system.remoteMgmt = cb.checked;
        WS.fw.setGroupEnabled('Windows Remote Management', cb.checked);
        if (cb.checked) WS.svc.start('WinRM');
        WS.store.changed('system');
      });
  }

  /* Tools menu: the base Windows tools plus each installed role's consoles, sorted as Server Manager sorts them.
   * Entries whose app isn't registered yet open the "not built yet" window. */
  const TOOLS = [
    ['Active Directory Administrative Center', 'dsac', 'RSAT-AD-AdminCenter'], ['Active Directory Domains and Trusts', 'domain', 'RSAT-ADDS-Tools'],
    ['Active Directory Module for Windows PowerShell', 'powershell', 'RSAT-AD-PowerShell'], ['Active Directory Sites and Services', 'dssite', 'RSAT-ADDS-Tools'],
    ['Active Directory Users and Computers', 'dsa', 'RSAT-ADDS-Tools'], ['ADSI Edit', 'adsiedit', 'RSAT-ADDS-Tools'],
    ['Component Services', 'comexp'], ['Computer Management', 'compmgmt'], ['Defragment and Optimize Drives', 'dfrgui'],
    ['DHCP', 'dhcpmgmt', 'RSAT-DHCP'], ['Disk Cleanup', 'cleanmgr'], ['DNS', 'dnsmgmt', 'RSAT-DNS-Server'], ['Event Viewer', 'eventvwr'],
    ['Group Policy Management', 'gpmc', 'GPMC'], ['Hyper-V Manager', 'virtmgmt', 'Hyper-V-Tools'], ['Internet Information Services (IIS) Manager', 'inetmgr', 'Web-Mgmt-Console'],
    ['iSCSI Initiator', 'iscsicpl'], ['Microsoft Azure Services', 'azure'], ['ODBC Data Sources (32-bit)', 'odbc32'], ['ODBC Data Sources (64-bit)', 'odbc64'],
    ['Performance Monitor', 'perfmon'], ['Recovery Drive', 'recovery'], ['Registry Editor', 'regedit'], ['Resource Monitor', 'resmon'], ['Services', 'services'],
    ['System Configuration', 'msconfig'], ['System Information', 'msinfo32'], ['Task Scheduler', 'taskschd'],
    ['Windows Defender Firewall with Advanced Security', 'wf'], ['Windows Memory Diagnostic', 'mdsched'], ['Windows PowerShell', 'powershell'],
    ['Windows PowerShell (x86)', 'powershell'], ['Windows PowerShell ISE', 'ise'], ['Windows PowerShell ISE (x86)', 'ise'],
    ['Windows Server Backup', 'wbadmin', 'Windows-Server-Backup']
  ];
  const toolsMenu = () => TOOLS.filter(([, , feature]) => !feature || WS.features.isInstalled(feature))
    .map(([label, id]) => ({ label, action: () => (WS.apps.get(id) ? WS.apps.launch(id) : WS.apps.notImplemented(label)) }));

  const FLAG = '<svg viewBox="0 0 20 20"><path d="M5 2v16" stroke="#3b3b3b" stroke-width="1.6"/><path d="M5.8 3h10l-2.5 3.5L15.8 10h-10z" fill="#e9e9e9" stroke="#3b3b3b" stroke-width="1.1"/></svg>';

  WS.sm = {
    notify, dismiss, notes: allNotes, taskDetails, shortName, scopeServices, scopeEvents, POST, rolePage,
    /** The Tools menu as [{ label, id }] (Control Panel > Windows Tools shows the same list). */
    tools: () => TOOLS.filter(([, , feature]) => !feature || WS.features.isInstalled(feature)).map(([label, id]) => ({ label, id })),
    /** Navigate an open Server Manager window (opens one if needed). Pages: 'dashboard', 'local', 'all', 'role:<id>', 'fss' or 'fss:<sub>'. */
    open(pageId) { const w = WS.wm.find('servermanager') || WS.apps.launch('servermanager'); w.restore(); if (pageId) w.sm.go(pageId); return w; },
    // replaced by the wizard modules
    addRoles: () => WS.apps.notImplemented('Add Roles and Features Wizard'),
    removeRoles: () => WS.apps.notImplemented('Remove Roles and Features Wizard'),
    addsConfig: () => WS.apps.notImplemented('Active Directory Domain Services Configuration Wizard'),
    dhcpConfig: () => WS.apps.notImplemented('DHCP Post-Install configuration wizard')
  };
  WS.sys.on('boot', () => { notes.length = 0; });
  WS.apps.register({ id: 'servermanager', name: 'Server Manager', icon: I.servermanager, singleton: true, launch, keywords: ['server manager', 'roles', 'features'] });
})();
