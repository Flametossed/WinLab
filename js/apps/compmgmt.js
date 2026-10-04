/* Computer Management (compmgmt.msc) and Device Manager (devmgmt.msc). Computer Management hosts the other snap-ins
 * under the real tree, so each one behaves exactly as in its own console:
 *   Computer Management (Local)
 *     System Tools > Task Scheduler | Event Viewer (WS.eventvwr.snapin) | Shared Folders (WS.fsmgmt) |
 *                    Local Users and Groups (WS.lusrmgr) | Performance | Device Manager
 *     Storage > Windows Server Backup | Disk Management (WS.diskmgmt)
 *     Services and Applications > Services (WS.services) | WMI Control
 * Task Scheduler, Performance and Windows Server Backup are information pages until those tools are built.
 *   launch({ select: nodeId }) -> win; win.compmgmt = { mmc, disk (Disk Management controller), events (Event Viewer
 *   controller), open(nodeId), path(nodeId) }.   WS.compmgmt.devices() lists Device Manager's categories. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f;
  const TITLE = 'Computer Management';
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const ICON = {
    app: s16(inner(I.computer) + '<circle cx="12.3" cy="11.8" r="3.2" fill="#fff"/><circle cx="12.3" cy="11.8" r="2.6" fill="#8a97a6"/><circle cx="12.3" cy="11.8" r="1" fill="#fff"/><path d="M12.3 8.6v1.1M12.3 13.9v1.1M9.1 11.8h1.1M14.4 11.8h1.1" stroke="#8a97a6" stroke-width="1.1"/>'),
    tools: s16('<path d="M3 13l6.5-6.5M10 2.5a3 3 0 0 0 3.5 3.5l-1.2 1.2-2.8-.2-.2-2.8z" fill="#8a97a6" stroke="#5b6b7d" stroke-width="1"/><path d="M2.3 12.2l1.5 1.5" stroke="#c98a00" stroke-width="2.4" stroke-linecap="round"/>'),
    storage: I.disk, apps: I.services, task: I.task,
    perf: s16('<rect x="1.5" y="2.5" width="13" height="10" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3 10l2.5-3 2 2 3-4 2.5 3" fill="none" stroke="#0f7b0f" stroke-width="1.3"/>'),
    dev: s16('<rect x="1.5" y="2" width="9" height="7" rx="1" fill="#5b6b7d"/><rect x="2.6" y="3.1" width="6.8" height="4.8" fill="#9fc1e3"/><rect x="9.5" y="7.5" width="5" height="7" rx=".6" fill="#8a97a6"/><rect x="10.3" y="8.6" width="3.4" height=".9" fill="#d6dde5"/><rect x="10.3" y="10.2" width="3.4" height=".9" fill="#d6dde5"/>'),
    backup: s16('<rect x="2.5" y="5" width="11" height="8" rx="1" fill="#6b7785"/><rect x="3.6" y="6.2" width="8.8" height="2" fill="#aab4bf"/><path d="M8 1.5v5M5.8 4.5L8 6.7l2.2-2.2" fill="none" stroke="#2f7fd8" stroke-width="1.4"/>'),
    wmi: s16(inner(I.gear)),
    chip: s16('<rect x="4" y="4" width="8" height="8" rx="1" fill="#5b6b7d"/><rect x="6" y="6" width="4" height="4" fill="#8fa3b8"/><path d="M5.5 2v2M8 2v2M10.5 2v2M5.5 12v2M8 12v2M10.5 12v2M2 5.5h2M2 8h2M2 10.5h2M12 5.5h2M12 8h2M12 10.5h2" stroke="#5b6b7d"/>'),
    monitor: s16('<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" fill="#5b6b7d"/><rect x="2.6" y="3.6" width="10.8" height="6.3" fill="#9fc1e3"/><path d="M6 13.5h4M8 11v2.5" stroke="#5b6b7d" stroke-width="1.2"/>'),
    keyboard: s16('<rect x="1" y="5" width="14" height="7" rx="1" fill="#8a97a6"/><path d="M3 7h1M5 7h1M7 7h1M9 7h1M11 7h1M3 9h1M5 9h1M7 9h1M9 9h1M11 9h1M5 10.8h6" stroke="#fff"/>'),
    mouse: s16('<rect x="4.5" y="2" width="7" height="12" rx="3.5" fill="#d6dde5" stroke="#6b7c8f"/><path d="M8 2v4.5M4.5 6.5h7" stroke="#6b7c8f"/>'),
    printer: s16('<rect x="4" y="1.5" width="8" height="5" fill="#fff" stroke="#6b7c8f"/><rect x="1.5" y="6" width="13" height="6" rx="1" fill="#8a97a6"/><rect x="4" y="10" width="8" height="4.5" fill="#fff" stroke="#6b7c8f"/>'),
    controller: s16('<rect x="1.5" y="4" width="13" height="8" rx="1" fill="#2f7fd8"/><path d="M3.5 7h9M3.5 9h6" stroke="#fff"/>'),
    hid: s16('<rect x="2" y="3" width="12" height="10" rx="2" fill="#8a97a6"/><circle cx="6" cy="8" r="1.5" fill="#fff"/><path d="M9.5 8h3M11 6.5v3" stroke="#fff"/>')
  };
  const SEP = { separator: true };
  const info = (title, ...paras) => ({ render: host => { const paint = () => { U.clear(host); host.appendChild(h('div.cm-info.w32', h('h3', title), ...paras.map(p => h('p', typeof p === 'function' ? p() : p)))); }; paint(); return { refresh: paint }; } });

  /* ================================================================ Device Manager */
  const CPU = 'Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz';
  function devices() {
    const S = WS.storage;
    return [
      ['Computer', I.computer, '(Standard computers)', ['ACPI x64-based PC']],
      ['Disk drives', I.disk, '(Standard disk drives)', S.disks().map(d => d.model)],
      ['Display adapters', ICON.monitor, 'Microsoft', ['Microsoft Hyper-V Video']],
      ['DVD/CD-ROM drives', I.cdrom, '(Standard CD-ROM drives)', S.cdrom() ? ['Microsoft Virtual DVD-ROM'] : []],
      ['Human Interface Devices', ICON.hid, 'Microsoft', ['Microsoft Hyper-V Input']],
      ['Keyboards', ICON.keyboard, 'Microsoft', ['Microsoft Hyper-V Virtual Keyboard']],
      ['Mice and other pointing devices', ICON.mouse, 'Microsoft', ['HID-compliant mouse']],
      ['Monitors', ICON.monitor, '(Standard monitor types)', ['Generic Non-PnP Monitor']],
      ['Network adapters', I.adapter, 'Microsoft', ['Microsoft Hyper-V Network Adapter', 'WAN Miniport (IKEv2)', 'WAN Miniport (IP)', 'WAN Miniport (IPv6)', 'WAN Miniport (L2TP)', 'WAN Miniport (Network Monitor)', 'WAN Miniport (PPPOE)', 'WAN Miniport (PPTP)', 'WAN Miniport (SSTP)']],
      ['Print queues', ICON.printer, 'Microsoft', ['Microsoft Print to PDF', 'Microsoft XPS Document Writer', 'Root Print Queue']],
      ['Processors', ICON.chip, 'Intel', [CPU, CPU, CPU, CPU]],
      ['Software devices', ICON.chip, 'Microsoft', ['Microsoft Device Association Root Enumerator', 'Microsoft Radio Device Enumeration Bus', 'Microsoft RRAS Root Enumerator']],
      ['Storage controllers', ICON.controller, 'Microsoft', ['Microsoft Hyper-V SCSI Controller', 'Microsoft Storage Spaces Controller']],
      ['System devices', ICON.chip, '(Standard system devices)', ['ACPI Module Device', 'ACPI Power Button', 'Composite Bus Enumerator', 'Microsoft ACPI-Compliant System', 'Microsoft Hyper-V Activation Component',
        'Microsoft Hyper-V Data Exchange', 'Microsoft Hyper-V Generation Counter', 'Microsoft Hyper-V Guest Shutdown', 'Microsoft Hyper-V Heartbeat', 'Microsoft Hyper-V Remote Desktop Virtualization',
        'Microsoft Hyper-V Time Synchronization', 'Microsoft Hyper-V Virtual Machine Bus', 'Microsoft Hyper-V Volume Shadow Copy', 'Microsoft System Management BIOS Driver', 'Microsoft Virtual Drive Enumerator',
        'NDIS Virtual Network Adapter Enumerator', 'Remote Desktop Device Redirector Bus', 'System CMOS/real time clock', 'UMBus Root Bus Enumerator']]
    ].map(([name, icon, maker, list]) => ({ name, icon, maker, list }));
  }
  function deviceProperties(dev, cat, opts = {}) {
    return WS.ui.propertySheet({ title: `${dev} Properties`, width: 410, onCreate: opts.onCreate, tabs: [
      { label: 'General', render: () => h('div',
        h('div.cm-devhead', h('span.cm-devic', { html: cat.icon }), h('span', dev)),
        F.row('Device type:', F.value(cat.name), { labelWidth: 100 }), F.row('Manufacturer:', F.value(cat.maker), { labelWidth: 100 }), F.row('Location:', F.value('Unknown'), { labelWidth: 100 }),
        F.group('Device status', h('div.cm-status', 'This device is working properly.'))) },
      { label: 'Driver', render: () => h('div',
        F.row('Driver Provider:', F.value('Microsoft'), { labelWidth: 110 }), F.row('Driver Date:', F.value('6/21/2006'), { labelWidth: 110 }),
        F.row('Driver Version:', F.value(`10.0.${WS.state.system.build || 26100}.1`), { labelWidth: 110 }), F.row('Digital Signer:', F.value('Microsoft Windows'), { labelWidth: 110 })) }
    ] });
  }
  /** Device Manager's tree as a result-pane view (Devices by type). */
  function deviceView() {
    let tree = null, sel = null;
    const scan = async mmc => { if (mmc) mmc.setStatus('Scanning for hardware changes...'); await U.sleep(250); if (tree) tree.refresh(); if (mmc) mmc.setStatus(''); };
    function menuFor(n, mmc) {
      if (!n || !n.data) return [{ label: '&Scan for hardware changes', action: () => scan(mmc) }, { label: 'Add &legacy hardware', disabled: true }, SEP, { label: 'P&roperties', disabled: true }];
      if (n.data.dev) return [{ label: '&Update driver', disabled: true }, { label: '&Disable device', disabled: true }, { label: 'U&ninstall device', disabled: true }, SEP,
        { label: '&Scan for hardware changes', action: () => scan(mmc) }, SEP, { label: 'P&roperties', default: true, action: () => deviceProperties(n.data.dev, n.data.cat) }];
      return [{ label: '&Scan for hardware changes', action: () => scan(mmc) }, SEP, { label: 'P&roperties', disabled: true }];
    }
    const view = {
      render(host, mmc) {
        tree = WS.ui.tree({
          nodes: () => [{ id: 'dv-pc', label: WS.sys.name, icon: I.computer, expanded: true,
            children: () => devices().filter(c => c.list.length).map(c => ({ id: 'dv-cat:' + c.name, label: c.name, icon: c.icon, data: { cat: c },
              children: () => c.list.map((d, i) => ({ id: `dv-dev:${c.name}:${i}`, label: d, icon: c.icon, data: { dev: d, cat: c } })) })) }],
          onSelect: n => { sel = n; },
          onActivate: n => { if (n.data && n.data.dev) { deviceProperties(n.data.dev, n.data.cat); return true; } return false; },
          onContext: (n, x, y, kb) => { sel = n; WS.ui.contextMenu(x, y, menuFor(n, mmc), { keyboard: kb }); }
        });
        host.appendChild(h('div.cm-devtree', tree.el));
        return { refresh: () => tree.refresh() };
      }
    };
    return { view, menu: mmc => menuFor(sel, mmc), tree: () => tree,
      viewMenu: () => [{ label: 'Devices by t&ype', radio: true, checked: true }, { label: 'Devices by co&nnection', radio: true, disabled: true }, { label: '&Resources by type', radio: true, disabled: true },
        { label: 'Resources by co&nnection', radio: true, disabled: true }, { label: 'Containers by type', radio: true, disabled: true }, { label: 'Devices by driver', radio: true, disabled: true }, SEP, { label: 'Sho&w hidden devices', disabled: true }] };
  }

  /* ================================================================ WMI Control */
  function wmiProperties(opts = {}) {
    return WS.ui.propertySheet({ title: 'WMI Control (Local) Properties', width: 410, onCreate: opts.onCreate, tabs: [
      { label: 'General', render: () => h('div', h('div', 'Successfully connected to:'), h('div.cm-indent', '<local computer>'),
        F.group('General information:', h('div.cm-wmi',
          h('div', `Computer: ${WS.sys.name}`), h('div', `OS: Microsoft Windows Server 2025 Datacenter Evaluation`), h('div', `OS Version: 10.0.${WS.state.system.build || 26100}`),
          h('div', 'Service pack: (none)'), h('div', `WMI Version: 10.0.${WS.state.system.build || 26100}.1`), h('div', 'WMI location: %windir%\\system32\\wbem'), h('div', 'Logged on as: Administrator')))) },
      { label: 'Backup/Restore', render: () => h('div', F.note('Automatic backups of the WMI repository are not modelled in the lab simulator.')) },
      { label: 'Security', render: () => h('div', F.note('WMI namespace security is not modelled in the lab simulator.')) },
      { label: 'Advanced', render: () => h('div', F.row('Default namespace for scripting:', F.value('root\\cimv2'), { labelWidth: 200 })) }
    ] });
  }

  /* ================================================================ Computer Management */
  function launch(opts = {}) {
    const dm = WS.diskmgmt.snapin();
    const sf = WS.fsmgmt.snapin();
    const lu = WS.lusrmgr.snapin();
    const ev = WS.eventvwr.snapin({ label: 'Event Viewer', path: ['cm-root', 'cm-tools'] });
    const sv = WS.services.snapin({ id: 'svc-local', label: 'Services' });
    const dv = deviceView();
    const folderView = kids => ({ columns: [{ key: 'label', label: 'Name', width: 260 }], rows: () => kids(), getId: n => n.id, icon: n => n.icon, sortKey: null, multi: false, onActivate: (n, m) => m.selectPath([m.current().id, n.id]) });
    const toolsKids = () => [
      { id: 'cm-tasks', label: 'Task Scheduler', icon: ICON.task, view: info('Task Scheduler', 'Use Task Scheduler to create and manage common tasks that your computer will carry out automatically at the times you specify.', 'Task Scheduler is not built in the lab simulator yet.') },
      ev.nodes()[0],
      sf.node,
      lu.node,
      { id: 'cm-perf', label: 'Performance', icon: ICON.perf, view: info('Performance', 'Use Performance Monitor to view performance data either in real time or from a log file.', 'Performance Monitor is not built in the lab simulator yet.') },
      { id: 'dv-root', label: 'Device Manager', icon: ICON.dev, view: dv.view, menu: m => dv.menu(m), viewMenu: dv.viewMenu }
    ];
    const storageKids = () => [
      { id: 'cm-wsb', label: 'Windows Server Backup', icon: ICON.backup,
        view: info('Windows Server Backup', () => (WS.features.isInstalled('Windows-Server-Backup') ? 'Windows Server Backup is not built in the lab simulator yet.'
          : 'The Windows Server Backup feature is not installed on this computer. To install it, use the Add Roles and Features Wizard in Server Manager.')) },
      dm.node
    ];
    const appsKids = () => [
      sv.node,
      { id: 'cm-wmi', label: 'WMI Control', icon: ICON.wmi, properties: () => wmiProperties(),
        view: info('WMI Control', 'Configures and controls the Windows Management Instrumentation (WMI) service.', 'To change the settings, right-click WMI Control and then click Properties.') }
    ];
    const connect = () => WS.apps.notImplemented('Select Computer');
    const nodes = () => [{
      id: 'cm-root', label: 'Computer Management (Local)', icon: ICON.app, expanded: true,
      menu: () => [{ label: '&Connect to another computer...', action: connect }, SEP, { label: 'All Tas&ks', items: () => [{ label: '&Connect to another computer...', action: connect }] }],
      view: folderView(() => nodes()[0].children()),
      children: () => [
        { id: 'cm-tools', label: 'System Tools', icon: ICON.tools, expanded: true, children: toolsKids, view: folderView(toolsKids) },
        { id: 'cm-storage', label: 'Storage', icon: ICON.storage, expanded: true, children: storageKids, view: folderView(storageKids) },
        { id: 'cm-apps', label: 'Services and Applications', icon: ICON.apps, children: appsKids, view: folderView(appsKids) }
      ]
    }];
    let mmc = null;
    /** View menu items belong to the snap-in that owns the selected node. */
    const viewMenu = m => {
      const id = (m.current() && m.current().id) || '';
      if (/^ev-/.test(id)) return ev.viewMenu();
      if (/^dm-/.test(id)) return dm.node.viewMenu(m);
      if (/^dv-/.test(id)) return dv.viewMenu();
      return [];
    };
    mmc = WS.mmc.create({ app: 'compmgmt', title: TITLE, icon: ICON.app, width: 1180, height: 700, treeWidth: 250, nodes, viewMenu,
      topics: [...new Set(['storage', 'smb', 'local', 'system', 'features', ...WS.eventvwr.TOPICS])] });
    ev.ctl.attach(mmc);
    /** Scope path to a node id (children are functions, so walk them). */
    function path(id) {
      const walk = (list, trail) => {
        for (const n of list.filter(Boolean)) {
          const t = [...trail, n.id];
          if (n.id === id) return t;
          if (n.children) { const r = walk(typeof n.children === 'function' ? n.children() : n.children, t); if (r) return r; }
        }
        return null;
      };
      return walk(nodes(), []);
    }
    const ctl = { mmc, disk: dm.ctl, events: ev.ctl, path, open(id) { const p = path(id); if (!p) return false; mmc.selectPath(p); return true; } };
    mmc.win.compmgmt = ctl;
    if (opts.select) ctl.open(opts.select);
    return mmc.win;
  }

  function launchDevmgmt() {
    const dv = deviceView();
    const mmc = WS.mmc.create({ app: 'devmgmt', title: 'Device Manager', icon: ICON.dev, width: 760, height: 600, showTree: false, showActions: false, topics: ['storage'],
      nodes: [{ id: 'dv-root', label: 'Device Manager on local computer', icon: ICON.dev, view: dv.view, menu: m => dv.menu(m) }], viewMenu: () => dv.viewMenu() });
    return mmc.win;
  }

  WS.compmgmt = { launch, devices, deviceProperties, wmiProperties, ICON };
  WS.apps.register({ id: 'compmgmt', name: TITLE, icon: ICON.app, launch, keywords: ['compmgmt.msc', 'computer management'] });
  WS.apps.register({ id: 'devmgmt', name: 'Device Manager', icon: ICON.dev, launch: launchDevmgmt, keywords: ['devmgmt.msc', 'device manager', 'drivers', 'hardware'] });
})();
