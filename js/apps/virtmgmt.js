/* Hyper-V Manager (virtmgmt.msc) on the MMC frame: Hyper-V Manager > <server>, the Virtual Machines list with the
 * Checkpoints tree and the details pane below it, and the server and VM actions. Dialogs and wizards: New Virtual
 * Machine Wizard, New Virtual Hard Disk Wizard, Virtual Switch Manager, Settings for <VM>, Hyper-V Settings, Export,
 * Rename and the confirmations. Everything goes through WS.hv, so PowerShell sees the same VMs.
 *   WS.virtmgmt = { newVM(o), newVhd(o), switchManager(o), settings(vm, o), hostSettings(o), connect(vm), act(vm, what) }
 *   (o.onCreate(w|frame, api) for tests). */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = () => WS.ui.f;
  const H = () => WS.hv;
  const GB = 1024 ** 3, MB = 1024 ** 2;
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const IC = {
    app: '<svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="18" rx="2" fill="#2b5797" stroke="#1d3d6b"/><rect x="6" y="8" width="20" height="12" fill="#5ea0e6"/><path d="M9 11h6v6H9zM17 11h6v6h-6z" fill="#fff" opacity=".85"/><path d="M12 27h8M16 23v4" stroke="#1d3d6b" stroke-width="2"/></svg>',
    root: s16('<rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="#2b5797"/><rect x="3" y="4" width="10" height="6" fill="#5ea0e6"/><path d="M5 14h6M8 11.5v2.5" stroke="#1d3d6b"/>'),
    vmOff: s16('<rect x="1.5" y="2.5" width="13" height="10" rx="1" fill="#e8ecf1" stroke="#7b8794"/><rect x="3" y="4" width="10" height="7" fill="#c5cdd6"/>'),
    vmOn: s16('<rect x="1.5" y="2.5" width="13" height="10" rx="1" fill="#e8ecf1" stroke="#2b5797"/><rect x="3" y="4" width="10" height="7" fill="#5ea0e6"/><circle cx="12.5" cy="12.5" r="3" fill="#2a8d2a"/><path d="M11.5 11l2.2 1.5-2.2 1.5z" fill="#fff"/>'),
    vmSaved: s16('<rect x="1.5" y="2.5" width="13" height="10" rx="1" fill="#e8ecf1" stroke="#7b8794"/><rect x="3" y="4" width="10" height="7" fill="#c5cdd6"/><circle cx="12.5" cy="12.5" r="3" fill="#2b5797"/><path d="M11 12.5h3M12.5 11v3" stroke="#fff"/>'),
    vmPaused: s16('<rect x="1.5" y="2.5" width="13" height="10" rx="1" fill="#e8ecf1" stroke="#2b5797"/><rect x="3" y="4" width="10" height="7" fill="#5ea0e6"/><circle cx="12.5" cy="12.5" r="3" fill="#c98b16"/><path d="M11.6 11v3M13.4 11v3" stroke="#fff"/>'),
    checkpoint: s16('<rect x="2" y="3" width="11" height="8" rx="1" fill="#e8ecf1" stroke="#7b8794"/><circle cx="12" cy="11.5" r="3.2" fill="#fff" stroke="#2b5797"/><path d="M12 9.8v1.8l1.2.8" stroke="#2b5797" fill="none"/>'),
    now: s16('<path d="M3 3l10 5-10 5z" fill="#2a8d2a"/>'),
    sw: s16('<rect x="1.5" y="5" width="13" height="6" rx="1" fill="#e8ecf1" stroke="#2b5797"/><path d="M4 8h1M6.5 8h1M9 8h1M11.5 8h1" stroke="#2b5797" stroke-width="1.6"/>'),
    disk: I.disk || I.drive, dvd: I.cdrom, nic: I.adapter, cpu: s16('<rect x="4" y="4" width="8" height="8" fill="#5b7fa8"/><path d="M6 1.5v2M8 1.5v2M10 1.5v2M6 12.5v2M8 12.5v2M10 12.5v2M1.5 6h2M1.5 8h2M1.5 10h2M12.5 6h2M12.5 8h2M12.5 10h2" stroke="#5b7fa8"/>'),
    mem: s16('<rect x="1.5" y="5" width="13" height="6" fill="#2a8d2a"/><path d="M3.5 7h1.5v2H3.5zM6.5 7H8v2H6.5zM9.5 7H11v2H9.5z" fill="#fff"/>'),
    shield: I.shield, gear: I.gear, folder: I.folder
  };
  const vmIcon = v => (v.state === 'Running' ? IC.vmOn : v.state === 'Paused' ? IC.vmPaused : v.state === 'Saved' ? IC.vmSaved : IC.vmOff);
  const err = (message, detail, title = 'Hyper-V Manager') => WS.ui.msgbox({ title, icon: 'error', message, detail });
  const ask = (title, message, buttons = ['Turn Off', 'Cancel'], icon = 'warning') => WS.ui.msgbox({ title, icon, message, buttons });
  const field = (name, el) => { (el.input || el).dataset.field = name; return el; };
  const host = () => WS.sys.name;

  /* ================================================================ VM actions */
  async function act(x, what) {
    const v = H().vm(x);
    if (!v) return;
    const fail = (r, head) => { if (!r.ok) return err(head, r.error); return null; };
    switch (what) {
      case 'connect': return connect(v.id);
      case 'settings': return settings(v.id);
      case 'start': { const r = H().start(v.id); return fail(r, 'An error occurred while attempting to start the selected virtual machine(s).'); }
      case 'turnoff': {
        if ((await ask('Turn Off Machine', `Do you want to turn off "${v.name}"?\n\nIf you turn off the virtual machine, any unsaved data in the virtual machine will be lost.`)) !== 'Turn Off') return;
        return fail(H().stop(v.id, { turnOff: true }), 'An error occurred while attempting to turn off the selected virtual machine(s).');
      }
      case 'shutdown': {
        if ((await ask('Shut Down Machine', `Are you sure you want to shut down "${v.name}"?`, ['Shut Down', 'Cancel'], 'question')) !== 'Shut Down') return;
        return fail(H().stop(v.id), 'An error occurred while attempting to shut down the selected virtual machine(s).');
      }
      case 'save': return fail(H().save(v.id), 'An error occurred while attempting to save the selected virtual machine(s).');
      case 'pause': return fail(H().pause(v.id), 'An error occurred while attempting to pause the selected virtual machine(s).');
      case 'resume': return fail(H().resume(v.id), 'An error occurred while attempting to resume the selected virtual machine(s).');
      case 'reset': {
        if ((await ask('Reset Machine', `Are you sure you want to reset "${v.name}"?\n\nIf you reset the virtual machine, any unsaved data in the virtual machine will be lost.`, ['Reset', 'Cancel'])) !== 'Reset') return;
        return fail(H().reset(v.id), 'An error occurred while attempting to reset the selected virtual machine(s).');
      }
      case 'deletesaved': {
        if ((await ask('Delete Saved State', `Are you sure you want to delete the saved state of "${v.name}"?\n\nThe virtual machine will start from its turned-off state the next time it starts.`, ['Delete', 'Cancel'])) !== 'Delete') return;
        return fail(H().stop(v.id, { turnOff: true }), 'An error occurred while deleting the saved state.');
      }
      case 'checkpoint': {
        const r = H().checkpoint(v.id);
        if (!r.ok) return err('An error occurred while attempting to checkpoint the selected virtual machine(s).', r.error);
        if (r.checkpoint.type === 'Production') WS.ui.msgbox({ title: 'Production checkpoint created', icon: 'info', message: 'Production checkpoint created successfully. Production checkpoints use backup technology inside the guest to create the checkpoint, instead of using saved state technology.', buttons: ['OK'] });
        return;
      }
      case 'revert': {
        const c = v.checkpoints.find(k => k.id === v.current);
        if (!c) return;
        if ((await ask('Revert Virtual Machine', `Are you sure you want to revert "${v.name}" to the previous checkpoint?\n\nYou will lose the current state of the virtual machine.`, ['Revert', 'Cancel'])) !== 'Revert') return;
        return fail(H().applyCheckpoint(v.id, c.id), 'An error occurred while attempting to revert the virtual machine.');
      }
      case 'rename': {
        await WS.ui.inputBox({ title: 'Rename', prompt: 'Name:', value: v.name, validate: n => { const r = H().renameVM(v.id, n); return r.ok ? null : r.error; } });
        return;
      }
      case 'export': return exportDialog(v.id);
      case 'delete': {
        if ((await ask('Delete Selected Virtual Machines', `Are you sure you want to delete the selected virtual machine "${v.name}"?\n\nThe virtual machine configuration files and checkpoints are deleted. Virtual hard disks are not deleted.`, ['Delete', 'Cancel'])) !== 'Delete') return;
        return fail(H().removeVM(v.id), 'An error occurred while attempting to delete the selected virtual machine(s).');
      }
    }
  }
  function vmMenu(v) {
    const on = v.state === 'Running', paused = v.state === 'Paused', off = v.state === 'Off', saved = v.state === 'Saved';
    const A = (label, what, o = {}) => ({ label, action: () => act(v.id, what), ...o });
    return [
      A('Co&nnect...', 'connect'), A('S&ettings...', 'settings'), { separator: true },
      off || saved ? A('S&tart', 'start') : null, paused ? A('Resu&me', 'resume') : null,
      on || paused ? A('T&urn Off...', 'turnoff') : null, on ? A('Shu&t Down...', 'shutdown') : null, on || paused ? A('Sa&ve', 'save') : null,
      saved ? A('Delete Saved State...', 'deletesaved') : null, on ? A('&Pause', 'pause') : null, on || paused ? A('&Reset', 'reset') : null,
      { separator: true }, A('Chec&kpoint', 'checkpoint'), v.current ? A('Re&vert...', 'revert') : null, { separator: true },
      { label: '&Move...', disabled: true }, A('E&xport...', 'export'), A('Rena&me...', 'rename'), off ? A('&Delete...', 'delete') : null, { label: 'Enable &Replication...', disabled: true }
    ];
  }
  function hostMenu() {
    return [
      { label: '&New', items: [{ label: '&Virtual Machine...', action: () => newVM() }, { label: '&Hard Disk...', action: () => newVhd() }, { label: '&Floppy Disk...', disabled: true }] },
      { label: '&Import Virtual Machine...', disabled: true }, { label: 'Hyper-V Se&ttings...', action: () => hostSettings() }, { label: 'Virtual S&witch Manager...', action: () => switchManager() },
      { label: 'Virtual SA&N Manager...', disabled: true }, { label: '&Edit Disk...', action: () => editDisk() }, { label: 'Ins&pect Disk...', action: () => inspectDisk() }, { separator: true },
      WS.svc.isRunning('vmms') ? { label: '&Stop Service', action: async () => { if ((await ask('Stop Service', 'Stopping the Hyper-V Virtual Machine Management service will make the virtual machines on this server unmanageable until the service is started again. Are you sure you want to stop it?', ['Stop Service', 'Cancel'])) === 'Stop Service') WS.svc.stop('vmms'); } }
        : { label: '&Start Service', action: () => WS.svc.start('vmms') },
      { label: '&Remove Server', disabled: true }
    ];
  }

  /* ================================================================ the console */
  const fmtMem = mb => (mb ? `${mb} MB` : '');
  function details(v) {
    if (!v) return null;
    const i = H().info(v);
    const tabs = ['Summary', 'Memory', 'Networking'];
    let cur = details.tab || 'Summary';
    const body = h('div.hv-dbody');
    const kv = rows => h('table.hv-kv', ...rows.map(([k, x]) => h('tr', h('td', k + ':'), h('td', x == null ? '' : String(x)))));
    const paint = () => {
      U.clear(body);
      if (cur === 'Summary') body.append(h('div.hv-dcols', kv([['Created', U.fmtDateTime(new Date(v.created))], ['Configuration Version', v.version], ['Generation', v.generation], ['Notes', v.notes || 'None']]),
        kv([['Clustered', 'No'], ['Heartbeat', i.heartbeat || (v.state === 'Running' ? 'No Contact' : '')], ['Integration Services', H().guestUp(v) ? 'Up to date' : '']])));
      else if (cur === 'Memory') body.append(kv([['Startup Memory', fmtMem(v.memory.startup)], ['Dynamic Memory', v.memory.dynamic ? 'Enabled' : 'Disabled'], ...(v.memory.dynamic ? [['Minimum Memory', fmtMem(v.memory.minimum)], ['Maximum Memory', fmtMem(v.memory.maximum)]] : []),
        ['Assigned Memory', fmtMem(i.assignedMB)], ['Memory Demand', fmtMem(i.demandMB)], ['Memory Status', v.state === 'Running' ? 'OK' : '']]));
      else body.append(h('table.hv-nets', h('tr', h('th', 'Adapter'), h('th', 'Connection'), h('th', 'IP Addresses'), h('th', 'Status')),
        ...v.nics.map((n, k) => h('tr', h('td', `${n.name} (Dynamic MAC: ${H().macDashed(n.mac)})`), h('td', n.switch || 'Not connected'), h('td', H().guestIps(v, k).join(', ')), h('td', v.state === 'Running' ? 'OK' : '')))));
      tabRow.querySelectorAll('.hv-dtab').forEach(t => t.classList.toggle('sel', t.textContent === cur));
    };
    const tabRow = h('div.hv-dtabs', ...tabs.map(t => h('div.hv-dtab', { onClick: () => { cur = details.tab = t; paint(); } }, t)));
    const el = h('div.hv-details', h('div.hv-dhead', h('span', { html: vmIcon(v) }), v.name), body, tabRow);
    paint();
    return el;
  }
  function checkpointPane(v, mmc) {
    const box = h('div.hv-cp', h('div.hv-sechead', 'Checkpoints'));
    if (!v) return box;
    if (!v.checkpoints.length) { box.append(h('div.hv-empty', 'The selected virtual machine has no checkpoints.')); return box; }
    const nodes = parent => v.checkpoints.filter(c => (c.parent || null) === parent).map(c => ({ id: c.id, label: c.name, icon: IC.checkpoint, expanded: true, data: c,
      children: () => [...nodes(c.id), ...(v.current === c.id ? [{ id: 'now', label: 'Now', icon: IC.now }] : [])] }));
    const tree = WS.ui.tree({ nodes: () => nodes(null),
      onContext: (n, x, y) => { if (n.data) WS.ui.contextMenu(x, y, checkpointMenu(v, n.data)); },
      onActivate: n => { if (n.data) applyDialog(v, n.data); } });
    tree.el.classList.add('hv-cptree');
    box.append(tree.el);
    box.cpTree = tree;
    return box;
  }
  function checkpointMenu(v, c) {
    return [
      { label: '&Settings...', action: () => settings(v.id, { readOnly: c }) }, { label: '&Apply...', action: () => applyDialog(v, c) }, { label: '&Export...', action: () => exportDialog(v.id) },
      { label: 'Rena&me...', action: () => WS.ui.inputBox({ title: 'Rename', prompt: 'Name:', value: c.name, validate: n => { const r = H().renameCheckpoint(v.id, c.id, n); return r.ok ? null : r.error; } }) },
      { separator: true },
      { label: '&Delete Checkpoint...', action: async () => { if ((await ask('Delete Checkpoint', `Are you sure you want to delete the checkpoint "${c.name}"?`, ['Delete', 'Cancel'])) === 'Delete') H().removeCheckpoint(v.id, c.id); } },
      { label: 'Delete Checkpoint Su&btree...', action: async () => { if ((await ask('Delete Checkpoint Subtree', `Are you sure you want to delete the checkpoint "${c.name}" and all of its child checkpoints?`, ['Delete', 'Cancel'])) === 'Delete') H().removeCheckpoint(v.id, c.id, { subtree: true }); } }
    ];
  }
  async function applyDialog(v, c, o = {}) {
    const p = WS.ui.msgbox({ title: 'Apply Checkpoint', icon: 'question', message: `Are you sure you want to apply the selected checkpoint?\n\nThe current state of the virtual machine "${v.name}" will be lost. To keep it, create a checkpoint first.`, buttons: ['Take Checkpoint and Apply', 'Apply', 'Cancel'] });
    const b = await p;
    if (b === 'Cancel' || !b) return;
    if (b === 'Take Checkpoint and Apply') H().checkpoint(v.id);
    const r = H().applyCheckpoint(v.id, c.id);
    if (!r.ok) err('An error occurred while attempting to apply the checkpoint.', r.error);
  }

  const listView = {
    columns: [
      { key: 'name', label: 'Name', width: 150 },
      { key: 'state', label: 'State', width: 80, value: v => v.state },
      { key: 'cpu', label: 'CPU Usage', width: 80, value: v => (v.state === 'Running' ? `${H().info(v).cpu}%` : '') },
      { key: 'mem', label: 'Assigned Memory', width: 110, value: v => fmtMem(H().info(v).assignedMB) },
      { key: 'up', label: 'Uptime', width: 80, value: v => (v.state === 'Running' || v.state === 'Paused' ? H().info(v).uptime : '') },
      { key: 'status', label: 'Status', width: 140, value: v => (v.state === 'Off' ? '' : H().info(v).status) },
      { key: 'ver', label: 'Configuration Version', width: 130, value: v => v.version }
    ],
    rows: () => H().vms(), getId: v => v.id, icon: v => vmIcon(v), sortKey: 'name', itemLabel: v => v.name, exportList: false,
    emptyText: 'No virtual machines were found on this server.',
    header: () => 'Virtual Machines',
    menu: rows => (rows[0] ? vmMenu(rows[0]) : []),
    properties: v => settings(v.id),
    onActivate: v => connect(v.id),
    preview: rows => h('div.hv-lower', checkpointPane(rows[0]), details(rows[0])),
    status: () => ''
  };
  function launch(args = {}) {
    const mmc = WS.mmc.create({
      app: 'virtmgmt', title: 'Hyper-V Manager', icon: IC.app, width: 1180, height: 720, actionsPane: 'full', topics: ['hyperv', 'services', 'features'],
      nodes: () => [{ id: 'hv-root', label: 'Hyper-V Manager', icon: IC.root, expanded: true,
        view: { custom: { render: c => { c.append(h('div.hv-intro', h('h2', 'Hyper-V Manager'), h('p', 'Hyper-V Manager provides the tools and information you can use to manage a virtualization server.'),
          h('div.hv-introbox', h('b', 'Introduction'), h('p', 'A virtualization server is a physical computer that provides the resources required to run virtual machines. You can use Hyper-V Manager to create, configure, and manage the virtual machines on a virtualization server.'),
            h('p', 'You can use virtual machines to run different workloads. Each virtual machine runs in an isolated execution environment, which gives you the flexibility to run different operating systems and applications on one physical computer.'),
            H().installed() ? null : h('p.hv-warn', 'The Hyper-V role is not installed on this computer. Use Server Manager to install it, then restart.')))); return {}; } } },
        menu: () => [{ label: '&Connect to Server...', disabled: true }],
        children: () => (H().installed() ? [{ id: 'hv-host', label: host(), icon: I.server, menu: () => hostMenu(), view: listView }] : []) }]
    });
    const tickId = setInterval(() => { if (mmc.current && mmc.current() && mmc.current().id === 'hv-host' && H().vms().some(v => v.state === 'Running')) mmc.refresh(); }, 1000);
    mmc.win.onClose(() => clearInterval(tickId));
    setTimeout(() => { if (H().installed()) mmc.select('hv-host'); }, 0);
    mmc.win.virtmgmt = mmc;
    return mmc.win;
  }

  /* ================================================================ New Virtual Machine Wizard */
  function newVM(o = {}) {
    const hv = H().host();
    const d = { name: 'New Virtual Machine', elsewhere: false, location: hv.vmPath + '\\', gen: 1, memory: 1024, dynamic: false, sw: '', disk: 'new', vhdName: '', vhdLocation: '', vhdSize: 127, existing: '', install: 'later', iso: '' };
    const lbl = (t, el) => h('div.hv-row', h('label', t), el);
    const syncVhd = () => { d.vhdName = d.name + '.vhdx'; d.vhdLocation = d.elsewhere ? `${d.location.replace(/\\+$/, '')}\\${d.name}\\Virtual Hard Disks\\` : hv.vhdPath + '\\'; };
    syncVhd();
    const pages = [
      { id: 'begin', title: 'Before You Begin', render: () => h('div.hv-wz', h('p', 'This wizard helps you create a virtual machine. You can use virtual machines in place of physical computers for a variety of uses. You can use this wizard to configure the virtual machine now, and you can change the configuration later using Hyper-V Manager.'),
        h('p', 'To create a virtual machine, do one of the following:'), h('ul', h('li', 'Click Finish to create a virtual machine that is configured with default values.'), h('li', 'Click Next to create a virtual machine with a custom configuration.')),
        F().checkbox('Do not show this page again', false)) },
      { id: 'name', title: 'Specify Name and Location', nav: 'Specify Name and Location', render: () => {
        const name = field('name', F().text({ value: d.name, width: 330, onInput: v => { d.name = v; syncVhd(); } }));
        const loc = field('location', F().text({ value: d.location, width: 330, disabled: true, onInput: v => { d.location = v; syncVhd(); } }));
        const browse = F().button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: loc.value }); if (p) { loc.value = d.location = p + '\\'; syncVhd(); } }, { disabled: true });
        const chk = field('elsewhere', F().checkbox('Store the virtual machine in a different location', false, { onChange: on => { d.elsewhere = on; loc.disabled = browse.disabled = !on; if (!on) { loc.value = d.location = hv.vmPath + '\\'; } syncVhd(); } }));
        return h('div.hv-wz', h('p', 'Choose a name and location for this virtual machine.'), h('p', 'The name is displayed in Hyper-V Manager. We recommend that you use a name that helps you easily identify this virtual machine, such as the name of the guest operating system or workload.'),
          lbl('Name:', name), h('p', 'You can create a folder or use an existing folder to store the virtual machine. If you don\u2019t select a folder, the virtual machine is stored in the default folder configured for this server.'),
          chk, lbl('Location:', h('div.hv-inline', loc, browse)), h('div.hv-note', 'If you plan to create checkpoints of this virtual machine, select a location that has enough free space. Checkpoints include virtual machine data and may require a large amount of space.'));
      }, validate: () => (!d.name.trim() ? 'The name of the virtual machine cannot be empty.' : /[\\/:*?"<>|]/.test(d.name) ? 'The name of the virtual machine contains characters that are not valid: \\ / : * ? " < > |' : null) },
      { id: 'gen', title: 'Specify Generation', render: () => h('div.hv-wz', h('p', 'Choose the generation of this virtual machine.'),
        field('gen1', F().radio('hvgen', 'Generation 1', d.gen === 1, { onChange: on => { if (on) d.gen = 1; } })), h('div.hv-desc', 'This virtual machine generation provides the same virtual hardware to the virtual machine as in previous versions of Hyper-V.'),
        field('gen2', F().radio('hvgen', 'Generation 2', d.gen === 2, { onChange: on => { if (on) d.gen = 2; } })), h('div.hv-desc', 'This virtual machine generation provides support for newer virtualization features, has UEFI-based firmware, and requires a supported 64-bit guest operating system.'),
        h('div.hv-note', 'Once a virtual machine has been created, you cannot change its generation.')) },
      { id: 'mem', title: 'Assign Memory', render: () => h('div.hv-wz', h('p', 'Specify the amount of memory to allocate to this virtual machine. You can specify an amount from 32 MB through 251658240 MB. To improve performance, specify more than the minimum amount recommended for the operating system.'),
        lbl('Startup memory:', h('div.hv-inline', field('memory', F().text({ value: d.memory, width: 90, onInput: v => { d.memory = v; } })), 'MB')),
        field('dynamic', F().checkbox('Use Dynamic Memory for this virtual machine.', d.dynamic, { onChange: on => { d.dynamic = on; } })),
        h('div.hv-note', 'When you decide how much memory to assign to a virtual machine, consider how you intend to use the virtual machine and the operating system that it will run.')),
        validate: () => { const m = +d.memory; return !/^\d+$/.test(String(d.memory).trim()) || m < 32 || m > 251658240 ? 'The amount of memory you specified is not valid. Type a value from 32 MB through 251658240 MB.' : m % 2 ? 'The amount of memory must be an even number.' : null; } },
      { id: 'net', title: 'Configure Networking', render: () => h('div.hv-wz', h('p', 'Each new virtual machine includes a network adapter. You can configure the network adapter to use a virtual switch, or it can remain disconnected.'),
        lbl('Connection:', field('switch', F().select([{ value: '', label: 'Not Connected' }, ...H().switches().map(s => ({ value: s.name, label: s.name }))], d.sw, { width: 300, onChange: v => { d.sw = v; } })))) },
      { id: 'disk', title: 'Connect Virtual Hard Disk', rerender: true, render: () => {
        const radio = (val, label) => field('disk-' + val, F().radio('hvdisk', label, d.disk === val, { onChange: on => { if (on) { d.disk = val; enable(); } } }));
        const nm = field('vhdname', F().text({ value: d.vhdName, width: 300, onInput: v => { d.vhdName = v; } }));
        const loc = field('vhdlocation', F().text({ value: d.vhdLocation, width: 300, onInput: v => { d.vhdLocation = v; } }));
        const size = field('vhdsize', F().text({ value: d.vhdSize, width: 70, onInput: v => { d.vhdSize = v; } }));
        const ex = field('existing', F().text({ value: d.existing, width: 300, onInput: v => { d.existing = v; } }));
        const exb = F().button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'open', path: 'C:\\', filters: [{ label: 'Virtual hard disks (*.vhdx;*.vhd)', ext: ['vhdx', 'vhd'] }] }); if (p) ex.value = d.existing = p; });
        const enable = () => { [nm, loc, size].forEach(e => { e.disabled = d.disk !== 'new'; }); ex.disabled = exb.disabled = d.disk !== 'existing'; };
        setTimeout(enable, 0);
        return h('div.hv-wz', h('p', 'A virtual machine requires storage so that you can install an operating system. You can specify the storage now or configure it later by modifying the virtual machine\u2019s properties.'),
          radio('new', 'Create a virtual hard disk'), h('div.hv-desc', 'Use this option to create a VHDX dynamically expanding virtual hard disk.'),
          h('div.hv-indent', lbl('Name:', nm), lbl('Location:', loc), lbl('Size:', h('div.hv-inline', size, 'GB (Maximum: 64 TB)'))),
          radio('existing', 'Use an existing virtual hard disk'), h('div.hv-desc', 'Use this option to attach an existing VHDX virtual hard disk.'), h('div.hv-indent', lbl('Location:', h('div.hv-inline', ex, exb))),
          radio('later', 'Attach a virtual hard disk later'), h('div.hv-desc', 'Use this option to skip this step now and attach an existing virtual hard disk later.'));
      }, validate: () => {
        if (d.disk === 'new') {
          if (!/\.vhdx$/i.test(d.vhdName.trim())) return 'The file name must end in .vhdx.';
          if (!(+d.vhdSize >= 1) || +d.vhdSize > 65536) return 'The size of the virtual hard disk is not valid. Type a value from 1 GB through 65536 GB.';
          if (WS.fs.exists(d.vhdLocation.replace(/\\+$/, '') + '\\' + d.vhdName.trim())) return `The file '${d.vhdLocation.replace(/\\+$/, '')}\\${d.vhdName.trim()}' already exists. Specify a different file name.`;
        }
        if (d.disk === 'existing' && !WS.fs.exists(d.existing)) return 'The virtual hard disk file was not found. Specify an existing virtual hard disk.';
        return null;
      } },
      { id: 'install', title: 'Installation Options', rerender: true, render: () => {
        const iso = field('iso', F().text({ value: d.iso, width: 300, onInput: v => { d.iso = v; } }));
        const b = F().button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'open', path: 'C:\\', filters: [{ label: 'Image files (*.iso)', ext: ['iso'] }] }); if (p) iso.value = d.iso = p; });
        const en = () => { iso.disabled = b.disabled = d.install !== 'iso'; };
        setTimeout(en, 0);
        const r = (val, label) => field('install-' + val, F().radio('hvinst', label, d.install === val, { onChange: on => { if (on) { d.install = val; en(); } } }));
        return h('div.hv-wz', h('p', 'You can install an operating system now if you have access to the setup media, or you can install it later.'),
          r('later', 'Install an operating system later'), r('iso', 'Install an operating system from a bootable image file'), h('div.hv-indent', lbl('Image file (.iso):', h('div.hv-inline', iso, b))),
          r('network', 'Install an operating system from a network-based installation server'));
      }, skip: () => d.disk === 'later', validate: () => (d.install === 'iso' && !(/\.iso$/i.test(d.iso) && WS.fs.exists(d.iso)) ? 'The image file was not found. Specify an existing .iso file.' : null) },
      { id: 'summary', title: 'Completing the New Virtual Machine Wizard', nav: 'Summary', rerender: true, render: () => h('div.hv-wz', h('p', 'You have successfully completed the New Virtual Machine Wizard. You are about to create the following virtual machine.'),
        h('div.hv-sumhead', 'Description:'), h('table.hv-sum', ...[['Name', d.name], ['Generation', `Generation ${d.gen}`], ['Memory', `${d.memory} MB${d.dynamic ? ' (Dynamic Memory)' : ''}`], ['Network', d.sw || 'Not Connected'],
          ['Hard Disk', d.disk === 'new' ? `${d.vhdLocation.replace(/\\+$/, '')}\\${d.vhdName} (VHDX, dynamically expanding)` : d.disk === 'existing' ? d.existing : 'None'], ['Operating System', d.install === 'iso' ? `Will be installed from ${d.iso}` : d.install === 'network' ? 'Will be installed from the network' : 'Will be installed at a later time']].map(([k, x]) => h('tr', h('td', k + ':'), h('td', x)))),
        h('p', 'To create the virtual machine and close the wizard, click Finish.')) }
    ];
    let created = null;
    return WS.ui.wizard({ title: 'New Virtual Machine Wizard', style: 'server', finishAnywhere: true, finishLabel: 'Finish', destination: '', icon: IC.app, data: d, pages, width: 760, height: 560,
      onCreate: w => { if (o.onCreate) o.onCreate(w, d); },
      onFinish: () => {
        const r = H().newVM({ name: d.name.trim(), generation: d.gen, memoryMB: +d.memory, dynamicMemory: d.dynamic, path: d.elsewhere ? d.location : null, switch: d.sw || null,
          newVhd: d.disk === 'new' ? { path: `${d.vhdLocation.replace(/\\+$/, '')}\\${d.vhdName.trim()}`, sizeBytes: Math.round(+d.vhdSize * GB) } : null, vhdPath: d.disk === 'existing' ? d.existing : null,
          iso: d.install === 'iso' && d.disk !== 'later' ? d.iso : null, bootDevice: d.install === 'network' ? 'NetworkAdapter' : null });
        if (!r.ok) return r;
        if (d.install === 'network' && r.vm.generation === 1) r.vm.bios.order = ['LegacyNetworkAdapter', 'CD', 'IDE', 'Floppy'];
        created = r.vm;
        return true;
      } }).then(res => (res.finished ? created : null));
  }

  /* ================================================================ New Virtual Hard Disk Wizard, Edit/Inspect Disk */
  function newVhd(o = {}) {
    const d = { format: 'VHDX', type: 'Dynamic', name: 'New Virtual Hard Disk.vhdx', location: H().host().vhdPath + '\\', size: 127 };
    const lbl = (t, el) => h('div.hv-row', h('label', t), el);
    const fixExt = () => { d.name = d.name.replace(/\.vhdx?$/i, '') + (d.format === 'VHD' ? '.vhd' : '.vhdx'); };
    const pages = [
      { id: 'begin', title: 'Before You Begin', render: () => h('div.hv-wz', h('p', 'This wizard helps you create a new virtual hard disk. Virtual hard disks are files that function like physical hard disks. You can use them as storage for virtual machines.')) },
      { id: 'format', title: 'Choose Disk Format', render: () => h('div.hv-wz', h('p', 'What format do you want to use for the virtual hard disk?'),
        field('vhd', F().radio('vhdfmt', 'VHD', d.format === 'VHD', { onChange: on => { if (on) { d.format = 'VHD'; fixExt(); } } })), h('div.hv-desc', 'Supports virtual hard disks up to 2,040 GB in size.'),
        field('vhdx', F().radio('vhdfmt', 'VHDX', d.format === 'VHDX', { onChange: on => { if (on) { d.format = 'VHDX'; fixExt(); } } })), h('div.hv-desc', 'This format supports virtual disks up to 64 TB and is resilient to consistency issues that might occur from power failures. This format is not supported in operating systems earlier than Windows Server 2012.'),
        F().radio('vhdfmt', 'VHD Set', false, { disabled: true }), h('div.hv-desc', 'This format is for shared virtual hard disks used by guest clusters.')) },
      { id: 'type', title: 'Choose Disk Type', render: () => h('div.hv-wz', h('p', 'What type of virtual hard disk do you want to create?'),
        field('fixed', F().radio('vhdtype', 'Fixed size', d.type === 'Fixed', { onChange: on => { if (on) d.type = 'Fixed'; } })), h('div.hv-desc', 'This type of disk provides better performance and is recommended for servers running applications with high levels of disk activity. The virtual hard disk file that is created initially uses the size of the virtual hard disk and does not change when data is deleted or added.'),
        field('dynamic', F().radio('vhdtype', 'Dynamically expanding', d.type === 'Dynamic', { onChange: on => { if (on) d.type = 'Dynamic'; } })), h('div.hv-desc', 'This type of disk provides better use of physical storage space and is recommended for servers running applications that are not disk intensive. The virtual hard disk file that is created is small initially and changes as data is added.'),
        field('differencing', F().radio('vhdtype', 'Differencing', d.type === 'Differencing', { onChange: on => { if (on) d.type = 'Differencing'; } })), h('div.hv-desc', 'This type of disk is associated in a parent-child relationship with another disk that you want to leave intact. You can make changes to the data or operating system without affecting the parent disk, so that you can revert the changes easily.')) },
      { id: 'name', title: 'Specify Name and Location', rerender: true, render: () => h('div.hv-wz', h('p', 'Specify the name and location of the virtual hard disk file.'),
        lbl('Name:', field('name', F().text({ value: d.name, width: 320, onInput: v => { d.name = v; } }))), lbl('Location:', field('location', F().text({ value: d.location, width: 320, onInput: v => { d.location = v; } })))),
        validate: () => (!new RegExp(`\\.${d.format.toLowerCase()}$`, 'i').test(d.name.trim()) ? `The file name must end in .${d.format.toLowerCase()}.` : WS.fs.exists(d.location.replace(/\\+$/, '') + '\\' + d.name.trim()) ? 'The specified file already exists. Specify a different name.' : null) },
      { id: 'configure', title: d.type === 'Differencing' ? 'Configure Disk' : 'Configure Disk', rerender: true, render: () => d.type === 'Differencing'
        ? h('div.hv-wz', h('p', 'Specify the location of the parent virtual hard disk.'), lbl('Path:', field('parent', F().text({ value: d.parent || '', width: 320, onInput: v => { d.parent = v; } }))))
        : h('div.hv-wz', h('p', 'You can create a blank virtual hard disk or copy the contents of an existing physical disk.'),
          F().radio('vhdsrc', 'Create a new blank virtual hard disk', true), h('div.hv-indent', lbl('Size:', h('div.hv-inline', field('size', F().text({ value: d.size, width: 70, onInput: v => { d.size = v; } })), `GB (Maximum: ${d.format === 'VHD' ? '2040 GB' : '64 TB'})`))),
          F().radio('vhdsrc', 'Copy the contents of the specified physical disk:', false, { disabled: true }), F().radio('vhdsrc', 'Copy the contents of the specified virtual hard disk', false, { disabled: true })),
        validate: () => (d.type === 'Differencing' ? (!WS.fs.exists(d.parent || '') ? 'The parent virtual hard disk was not found.' : null) : !(+d.size >= 1) ? 'The size is not valid.' : null) },
      { id: 'summary', title: 'Completing the New Virtual Hard Disk Wizard', nav: 'Summary', rerender: true, render: () => h('div.hv-wz', h('p', 'You have successfully completed the New Virtual Hard Disk Wizard. You are about to create the following virtual hard disk.'),
        h('table.hv-sum', ...[['Format', d.format], ['Type', d.type === 'Dynamic' ? 'dynamically expanding' : d.type === 'Fixed' ? 'fixed size' : 'differencing'], ['Name', d.name], ['Location', d.location], ...(d.type === 'Differencing' ? [['Parent', d.parent]] : [['Size', `${d.size} GB`]])].map(([k, x]) => h('tr', h('td', k + ':'), h('td', x)))),
        h('p', 'To create the virtual hard disk and close this wizard, click Finish.')) }
    ];
    let made = null;
    return WS.ui.wizard({ title: 'New Virtual Hard Disk Wizard', style: 'server', finishAnywhere: true, finishLabel: 'Finish', destination: '', icon: IC.app, data: d, pages, width: 760, height: 540,
      onCreate: w => { if (o.onCreate) o.onCreate(w, d); },
      onFinish: () => { const r = H().newVhd({ path: d.location.replace(/\\+$/, '') + '\\' + d.name.trim(), sizeBytes: Math.round(+d.size * GB), type: d.type, parent: d.parent }); if (!r.ok) return r; made = r.vhd; return true; } }).then(res => (res.finished ? made : null));
  }
  async function pickVhd(title) { return WS.ui.filePicker({ mode: 'open', path: H().host().vhdPath, filters: [{ label: 'Virtual Hard Disk files (*.vhdx;*.vhd;*.avhdx;*.avhd)', ext: ['vhdx', 'vhd', 'avhdx', 'avhd'] }], title }); }
  async function inspectDisk(path) {
    path = path || await pickVhd('Open');
    if (!path) return;
    const x = H().vhd(path);
    if (!x) return err(`The file '${path}' is not a virtual hard disk that Hyper-V can open.`, null, 'Virtual Hard Disk Properties');
    return WS.ui.dialog({ title: 'Virtual Hard Disk Properties', width: 420, content: h('div.w32', h('table.hv-kv', ...[['Format', `${x.format} (${x.format === 'VHDX' ? 'Virtual Hard Disk v2' : 'Virtual Hard Disk'})`], ['Type', x.type === 'Dynamic' ? 'Dynamically expanding virtual hard disk' : x.type === 'Fixed' ? 'Fixed size virtual hard disk' : 'Differencing virtual hard disk'],
      ['Location', x.path.replace(/\\[^\\]+$/, '')], ['File Name', x.path.split('\\').pop()], ['Current File Size', U.fmtBytes(H().vhdFileSize(x))], ['Maximum Disk Size', U.fmtBytes(x.size)], ...(x.parent ? [['Parent', x.parent]] : [])].map(([k, v]) => h('tr', h('td', k + ':'), h('td', String(v)))))) });
  }
  async function editDisk() {
    const path = await pickVhd('Edit Virtual Hard Disk');
    if (!path) return;
    const x = H().vhd(path);
    if (!x) return err(`The file '${path}' is not a virtual hard disk that Hyper-V can open.`, null, 'Edit Virtual Hard Disk Wizard');
    const gb = await WS.ui.inputBox({ title: 'Edit Virtual Hard Disk Wizard', prompt: `Expand: new size of ${x.path.split('\\').pop()} in GB (now ${Math.round(x.size / GB)} GB):`, value: String(Math.round(x.size / GB)),
      validate: v => { const r = H().resizeVhd(x.path, Math.round(+v * GB)); return r.ok ? null : r.error; } });
    return gb;
  }

  /* ================================================================ Export */
  function exportDialog(id) {
    const v = H().vm(id);
    const loc = field('path', F().text({ value: 'C:\\Exports', width: 300 }));
    const frame = WS.ui.modal({ title: `Export Virtual Machine`, width: 440, className: 'w32-dlg' });
    frame.body.append(h('div.w32', h('p', `Specify where you want to save the files.`), h('div.hv-row', h('label', 'Location:'), h('div.hv-inline', loc, F().button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: 'C:\\' }); if (p) loc.value = p; })))));
    frame.footer.append(h('button.btn.primary', { onClick: () => { const r = H().exportVM(v.id, loc.value); if (!r.ok) err('An error occurred while attempting to export the virtual machine.', r.error); else frame.close(true); } }, 'Export'), h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    return frame.promise;
  }

  /* ================================================================ Virtual Switch Manager */
  function switchManager(o = {}) {
    const frame = WS.ui.modal({ title: `Virtual Switch Manager for ${host()}`, width: 760, height: 560, className: 'w32-dlg hv-big' });
    // pending edits, applied by OK/Apply
    let work = H().switches().map(s => ({ ...s, orig: s.name, removed: false }));
    let sel = work.length ? 'sw:0' : 'new';
    const left = h('div.hv-left'), right = h('div.hv-right');
    frame.body.append(h('div.w32.hv-split', left, right));
    const item = (key, label, icon, sub, o2 = {}) => h('div.hv-litem' + (sel === key ? '.sel' : '') + (o2.head ? '.head' : '') + (o2.indent ? '.indent' : ''), { dataset: { key }, onClick: () => { if (!o2.head) { sel = key; paint(); } } },
      icon ? h('span.hv-lic', { html: icon }) : null, h('div', h('div', label), sub ? h('div.hv-lsub', sub) : null));
    function paintLeft() {
      U.clear(left);
      left.append(item('h1', 'Virtual Switches', null, null, { head: true }), item('new', 'New virtual network switch', IC.sw));
      work.forEach((s, i) => { if (!s.removed) left.append(item('sw:' + i, s.name, IC.sw, s.type === 'External' ? (WS.net.adapter(s.adapter) || {}).description || s.adapter : s.type === 'Internal' ? 'Internal only' : 'Private virtual switch', { indent: true })); });
      left.append(item('h2', 'Global Network Settings', null, null, { head: true }), item('mac', 'MAC Address Range', IC.nic, `${H().host().macMin.match(/../g).join('-')} to ${H().host().macMax.match(/../g).join('-')}`));
    }
    let newType = 'External';
    function paintRight() {
      U.clear(right);
      if (sel === 'new') {
        const types = [['External', 'Creates a virtual switch that binds to the physical network adapter so that virtual machines can access a physical network.'], ['Internal', 'Creates a virtual switch that can be used only by the virtual machines that run on this physical computer, and between the virtual machines and the physical computer. An internal virtual switch does not provide connectivity to a physical network connection.'], ['Private', 'Creates a virtual switch that can be used only by the virtual machines that run on this physical computer.']];
        const desc = h('div.hv-desc');
        const lst = h('div.hv-types', ...types.map(([t, ds]) => h('div.hv-type' + (t === newType ? '.sel' : ''), { dataset: { type: t }, onClick: () => { newType = t; paintRight(); } }, t)));
        desc.textContent = types.find(x => x[0] === newType)[1];
        right.append(h('div.hv-rhead', 'Create virtual switch'), h('div', 'What type of virtual switch do you want to create?'), lst, desc,
          h('div.hv-right-b', h('button.btn', { dataset: { field: 'create' }, onClick: () => {
            let n = 'New Virtual Switch', k = 1; while (work.some(s => !s.removed && lc(s.name) === lc(n))) n = `New Virtual Switch ${++k}`;
            work.push({ id: null, name: n, type: newType, adapter: newType === 'External' ? (externalChoices()[0] || {}).name || null : null, allowManagementOS: newType !== 'Private', notes: '', orig: null, removed: false });
            sel = 'sw:' + (work.length - 1); dirty(); paint();
          } }, 'Create Virtual Switch')));
        return;
      }
      if (sel === 'mac') { right.append(h('div.hv-rhead', 'MAC Address Range'), h('p', 'Specify the range of dynamic MAC addresses that Hyper-V assigns to virtual network adapters.'), h('table.hv-kv', h('tr', h('td', 'Minimum:'), h('td', H().host().macMin.match(/../g).join('-'))), h('tr', h('td', 'Maximum:'), h('td', H().host().macMax.match(/../g).join('-'))))); return; }
      const s = work[+sel.slice(3)];
      if (!s) return;
      const nm = field('name', F().text({ value: s.name, width: 360, onInput: v => { s.name = v; dirty(); paintLeft(); } }));
      const notes = field('notes', F().textarea({ value: s.notes, rows: 2, width: 360 })); notes.addEventListener('input', () => { s.notes = notes.value; dirty(); });
      const ad = field('adapter', F().select(externalChoices(s).map(a => ({ value: a.name, label: a.description })), s.adapter || '', { width: 330, onChange: v => { s.adapter = v; dirty(); } }));
      const share = field('share', F().checkbox('Allow management operating system to share this network adapter', s.allowManagementOS, { onChange: on => { s.allowManagementOS = on; dirty(); } }));
      const radio = (t, label) => field('type-' + t, F().radio('swtype', label, s.type === t, { onChange: on => { if (on) { s.type = t; if (t === 'External' && !s.adapter) s.adapter = (externalChoices(s)[0] || {}).name || null; s.allowManagementOS = t !== 'Private'; dirty(); paint(); } } }));
      const ext = s.type === 'External';
      ad.disabled = !ext; share.input.disabled = !ext;
      right.append(h('div.hv-rhead', 'Virtual Switch Properties'), h('div.hv-row', h('label', 'Name:'), nm), h('div.hv-row', h('label', 'Notes:'), notes),
        F().group('Connection type', h('div', 'What do you want to connect this virtual switch to?'), radio('External', 'External network:'), h('div.hv-indent', ad, share, F().checkbox('Enable single-root I/O virtualization (SR-IOV)', false, { disabled: true })),
          radio('Internal', 'Internal network'), radio('Private', 'Private network')),
        F().group('VLAN ID', F().checkbox('Enable virtual LAN identification for management operating system', false, { disabled: true }), h('div.hv-note', 'The VLAN identifier specifies the virtual LAN that the management operating system will use for all network communications through this network adapter.')),
        h('div.hv-right-b', h('button.btn', { dataset: { field: 'remove' }, onClick: () => { s.removed = true; sel = 'new'; dirty(); paint(); } }, 'Remove')));
    }
    function externalChoices(s) {
      const taken = new Set(work.filter(w => w !== s && !w.removed && w.type === 'External').map(w => lc(w.adapter)));
      return WS.net.adapters().filter(a => !/^vEthernet/i.test(a.name) && !taken.has(lc(a.name)));
    }
    const paint = () => { paintLeft(); paintRight(); };
    const okBtn = h('button.btn.primary', { onClick: async () => { if (await apply()) frame.close(true); } }, 'OK');
    const cancelBtn = h('button.btn', { onClick: () => frame.close(false) }, 'Cancel');
    const applyBtn = h('button.btn', { disabled: true, onClick: () => apply() }, 'Apply');
    const dirty = () => { applyBtn.disabled = false; };
    frame.footer.append(okBtn, cancelBtn, applyBtn);
    async function apply() {
      if (applyBtn.disabled) return true;
      const names = work.filter(s => !s.removed).map(s => lc(s.name.trim()));
      if (names.some(n => !n)) { await err('The virtual switch name cannot be empty.', null, 'Virtual Switch Manager'); return false; }
      if (new Set(names).size !== names.length) { await err('A virtual switch with this name already exists. Specify a different name.', null, 'Virtual Switch Manager'); return false; }
      const touchesHost = work.some(s => (s.removed && s.orig && (H().switch(s.orig) || {}).type === 'External') || (s.type === 'External' && (!s.orig || JSON.stringify(H().switch(s.orig) && [H().switch(s.orig).type, H().switch(s.orig).adapter, H().switch(s.orig).allowManagementOS]) !== JSON.stringify(['External', s.adapter, s.allowManagementOS]))));
      if (touchesHost && (await WS.ui.msgbox({ title: 'Apply Networking Changes', icon: 'warning', buttons: ['Yes', 'No'], message: 'Pending changes may disrupt network connectivity.\n\nThe virtual switch configuration is being changed. These changes might disrupt network connectivity of this computer or of virtual machines. Do you want to apply the changes?' })) !== 'Yes') return false;
      for (const s of work.filter(w => w.removed && w.orig)) { const r = H().removeSwitch(s.orig); if (!r.ok) { await err(r.error, null, 'Virtual Switch Manager'); return false; } }
      for (const s of work.filter(w => !w.removed)) {
        const r = s.orig ? H().setSwitch(s.orig, { name: s.name.trim(), type: s.type, adapter: s.type === 'External' ? s.adapter : null, allowManagementOS: s.allowManagementOS, notes: s.notes })
          : H().newSwitch({ name: s.name.trim(), type: s.type, adapter: s.type === 'External' ? s.adapter : null, allowManagementOS: s.allowManagementOS, notes: s.notes });
        if (!r.ok) { await err('Error applying Virtual Switch Properties changes', r.error, 'Virtual Switch Manager'); return false; }
        s.orig = r.switch.name;
      }
      work = work.filter(w => !w.removed).map(s => ({ ...H().switch(s.orig), orig: s.orig, removed: false }));
      applyBtn.disabled = true;
      paint();
      return true;
    }
    paint();
    if (o.onCreate) o.onCreate(frame, { select: k => { sel = k; paint(); }, work: () => work, apply, ok: () => okBtn.click(), right });
    return frame.promise;
  }

  /* ================================================================ Settings for <VM> */
  function settings(id, o = {}) {
    const v0 = H().vm(id);
    if (!v0) return null;
    const ro = !!o.readOnly; // a checkpoint's settings
    const v = JSON.parse(JSON.stringify(ro ? o.readOnly.snap.config : v0)); // working copy
    const frame = WS.ui.modal({ title: ro ? `Settings for ${v0.name} (checkpoint)` : `Settings for ${v.name} on ${host()}`, width: 820, height: 600, className: 'w32-dlg hv-big' });
    const left = h('div.hv-left.hv-stree'), right = h('div.hv-right');
    frame.body.append(h('div.w32.hv-split', left, right));
    let sel = o.page || 'memory';
    const running = v0.state !== 'Off';
    const ctl = v.generation === 2 ? 'SCSI Controller' : 'IDE Controller';
    function entries() {
      const hw = [['add', 'Add Hardware', IC.gear], v.generation === 2 ? ['firmware', 'Firmware', IC.gear, v.firmware.bootOrder.length ? `Boot from ${bootLabel(v.firmware.bootOrder[0])}` : ''] : ['bios', 'BIOS', IC.gear, `Boot from ${v.bios.order[0]}`],
        ...(v.generation === 2 ? [['security', 'Security', IC.shield, v.firmware.secureBoot ? 'Secure Boot enabled' : 'Secure Boot disabled']] : []),
        ['memory', 'Memory', IC.mem, `${v.memory.startup} MB`], ['processor', 'Processor', IC.cpu, `${v.cpu.count} Virtual processor${v.cpu.count > 1 ? 's' : ''}`], ['ctl', ctl, IC.gear]];
      v.disks.forEach((d, i) => hw.push(['disk:' + i, 'Hard Drive', IC.disk, d.path ? d.path.split('\\').pop() : 'No virtual hard disk', true]));
      v.dvds.forEach((d, i) => hw.push(['dvd:' + i, 'DVD Drive', IC.dvd, d.path ? d.path.split('\\').pop() : 'None', true]));
      v.nics.forEach((n, i) => hw.push(['nic:' + i, n.name, IC.nic, n.switch || 'Not connected']));
      const mg = [['name', 'Name', IC.gear, v.name], ['integration', 'Integration Services', IC.gear, Object.values(v.integration).every(Boolean) ? 'All services offered' : 'Some services offered'],
        ['checkpoints', 'Checkpoints', IC.checkpoint, v.checkpointType === 'Disabled' ? 'Disabled' : v.checkpointType === 'Standard' ? 'Standard' : 'Production'], ['paging', 'Smart Paging File Location', IC.folder, v.path],
        ['autostart', 'Automatic Start Action', IC.gear, { Nothing: 'None', StartIfRunning: 'Restart if previously running', Start: 'Always start automatically' }[v.autoStart]], ['autostop', 'Automatic Stop Action', IC.gear, { Save: 'Save', TurnOff: 'Turn Off', ShutDown: 'Shut Down' }[v.autoStop]]];
      return { hw, mg };
    }
    const bootLabel = e => (e.startsWith('dvd') ? 'DVD Drive' : e.startsWith('disk') ? 'Hard Drive' : 'Network Adapter');
    function paintLeft() {
      U.clear(left);
      const { hw, mg } = entries();
      const row = ([key, label, icon, sub, indent]) => h('div.hv-litem' + (sel === key ? '.sel' : '') + (indent ? '.indent' : ''), { dataset: { key }, onClick: () => { sel = key; paint(); } }, h('span.hv-lic', { html: icon || '' }), h('div', h('div', label), sub ? h('div.hv-lsub', sub) : null));
      left.append(h('div.hv-litem.head', h('div', 'Hardware')), ...hw.map(row), h('div.hv-litem.head', h('div', 'Management')), ...mg.map(row));
    }
    const dirty = () => { applyBtn.disabled = ro; };
    const lbl = (t, el) => h('div.hv-row', h('label', t), el);
    const disabledNote = t => h('div.hv-note', t);
    function paintRight() {
      U.clear(right);
      const [kind, idx] = sel.split(':');
      const R = (...c) => right.append(...c);
      if (kind === 'add') {
        const choices = v.generation === 2 ? ['SCSI Controller', 'Network Adapter'] : ['SCSI Controller', 'Network Adapter', 'Legacy Network Adapter', 'Fibre Channel Adapter'];
        const pick = field('hw', F().select(choices, 'Network Adapter', { width: 260 }));
        pick.size = choices.length;
        R(h('div.hv-rhead', 'Add Hardware'), h('p', 'You can use this setting to add devices to your virtual machine.'), h('div', 'Select the devices you want to add and click the Add button.'), pick,
          h('div.hv-right-b', h('button.btn', { dataset: { field: 'addhw' }, onClick: () => { if (pick.value === 'Network Adapter') { v.nics.push({ id: 'nic-new-' + U.uid(), name: 'Network Adapter', switch: null, mac: null, dynamicMac: true, vlan: null, isNew: true }); sel = 'nic:' + (v.nics.length - 1); dirty(); paint(); } else WS.ui.msgbox({ title: 'Add Hardware', icon: 'info', message: `${pick.value} is not modelled in the lab simulator.` }); } }, 'Add')));
        return;
      }
      if (kind === 'firmware') {
        const lst = h('div.hv-boot');
        const draw = () => { U.clear(lst); v.firmware.bootOrder.forEach((e, i) => { const [k, j] = e.split(':'); const dev = k === 'dvd' ? v.dvds[+j] : k === 'disk' ? v.disks[+j] : v.nics[+j];
          lst.append(h('div.hv-bootrow' + (bootSel === i ? '.sel' : ''), { dataset: { entry: e }, onClick: () => { bootSel = i; draw(); } }, h('span.hv-lic', { html: k === 'dvd' ? IC.dvd : k === 'disk' ? IC.disk : IC.nic }), bootLabel(e), h('span.hv-dim', k === 'net' ? (dev && dev.switch) || '' : (dev && dev.path ? dev.path.split('\\').pop() : '')))); }); };
        let bootSel = 0;
        draw();
        const mv = d => { const j = bootSel + d; if (j < 0 || j >= v.firmware.bootOrder.length) return; const o2 = v.firmware.bootOrder; [o2[bootSel], o2[j]] = [o2[j], o2[bootSel]]; bootSel = j; draw(); dirty(); };
        R(h('div.hv-rhead', 'Firmware'), h('div', 'Boot order'), h('div.hv-inline.hv-top', lst, h('div.hv-mv', h('button.btn', { dataset: { field: 'moveup' }, onClick: () => mv(-1) }, 'Move Up'), h('button.btn', { dataset: { field: 'movedown' }, onClick: () => mv(1) }, 'Move Down'))));
        return;
      }
      if (kind === 'bios') {
        const lst = h('div.hv-boot'); let bs = 0;
        const draw = () => { U.clear(lst); v.bios.order.forEach((k, i) => lst.append(h('div.hv-bootrow' + (bs === i ? '.sel' : ''), { onClick: () => { bs = i; draw(); } }, k === 'IDE' ? 'IDE' : k === 'CD' ? 'CD' : k === 'LegacyNetworkAdapter' ? 'Legacy Network adapter' : 'Floppy'))); };
        draw();
        const mv = d => { const j = bs + d; if (j < 0 || j >= v.bios.order.length) return; [v.bios.order[bs], v.bios.order[j]] = [v.bios.order[j], v.bios.order[bs]]; bs = j; draw(); dirty(); };
        R(h('div.hv-rhead', 'BIOS'), F().checkbox('Num Lock', false), h('div', 'Startup order'), h('div.hv-inline.hv-top', lst, h('div.hv-mv', h('button.btn', { onClick: () => mv(-1) }, 'Move Up'), h('button.btn', { onClick: () => mv(1) }, 'Move Down'))));
        return;
      }
      if (kind === 'security') {
        const sb = field('secureboot', F().checkbox('Enable Secure Boot', v.firmware.secureBoot, { disabled: running, onChange: on => { v.firmware.secureBoot = on; tpl.disabled = !on || running; dirty(); } }));
        const tpl = field('template', F().select([{ value: 'MicrosoftWindows', label: 'Microsoft Windows' }, { value: 'MicrosoftUEFICertificateAuthority', label: 'Microsoft UEFI Certificate Authority' }, { value: 'OpenSourceShieldedVM', label: 'Open Source Shielded VM' }], v.firmware.template, { width: 260, disabled: !v.firmware.secureBoot || running, onChange: x => { v.firmware.template = x; dirty(); } }));
        const tpm = field('tpm', F().checkbox('Enable Trusted Platform Module', v.tpm, { disabled: running, onChange: on => { v.tpm = on; dirty(); } }));
        R(h('div.hv-rhead', 'Security'), F().group('Secure Boot', h('p', 'Use Secure Boot to help prevent unauthorized code from running at boot time (recommended).'), sb, lbl('Template:', tpl)),
          F().group('Encryption Support', tpm, F().checkbox('Encrypt state and virtual machine migration traffic', false, { disabled: true })),
          running ? disabledNote('Some settings cannot be modified because the virtual machine was running when this window was opened. To modify a setting that is unavailable, shut down the virtual machine and then reopen this window.') : null);
        return;
      }
      if (kind === 'memory') {
        const m = v.memory;
        const ram = field('ram', F().text({ value: m.startup, width: 90, disabled: running && !m.dynamic, onInput: x => { m.startup = x; dirty(); } }));
        const dyn = field('dynamic', F().checkbox('Enable Dynamic Memory', m.dynamic, { disabled: running, onChange: on => { m.dynamic = on; mn.disabled = mx.disabled = !on; if (on && m.minimum >= m.startup) { m.minimum = Math.min(512, m.startup); m.maximum = 1048576; mn.value = m.minimum; mx.value = m.maximum; } dirty(); } }));
        const mn = field('min', F().text({ value: m.minimum, width: 90, disabled: !m.dynamic, onInput: x => { m.minimum = x; dirty(); } }));
        const mx = field('max', F().text({ value: m.maximum, width: 90, disabled: !m.dynamic, onInput: x => { m.maximum = x; dirty(); } }));
        R(h('div.hv-rhead', 'Memory'), h('p', 'Specify the amount of memory that this virtual machine can use.'), lbl('RAM:', h('div.hv-inline', ram, 'MB')),
          F().group('Dynamic Memory', h('p', 'You can allow the amount of memory available to this virtual machine to change dynamically within the range you set.'), dyn, lbl('Minimum RAM:', h('div.hv-inline', mn, 'MB')), lbl('Maximum RAM:', h('div.hv-inline', mx, 'MB')),
            h('p', 'Specify the percentage of memory that Hyper-V should try to reserve as a buffer. Hyper-V uses the percentage and the current demand for memory to determine an amount of memory for the buffer.'), lbl('Memory buffer:', h('div.hv-inline', F().text({ value: m.buffer, width: 50, disabled: !m.dynamic }), '%'))),
          running ? disabledNote('Some settings cannot be modified because the virtual machine was running when this window was opened.') : null);
        return;
      }
      if (kind === 'processor') {
        const n = field('cpu', F().select(Array.from({ length: WS.proc.NCPU }, (x, i) => String(i + 1)), String(v.cpu.count), { width: 70, disabled: running, onChange: x => { v.cpu.count = +x; dirty(); } }));
        R(h('div.hv-rhead', 'Processor'), h('p', 'You can modify the number of virtual processors based on the number of processors on the physical computer. You can also modify other resource control settings.'), lbl('Number of virtual processors:', n),
          F().group('Resource control', h('p', 'You can use resource controls to balance resources among virtual machines.'), lbl('Virtual machine reserve (percentage):', F().text({ value: 0, width: 50, disabled: true })), lbl('Virtual machine limit (percentage):', F().text({ value: 100, width: 50, disabled: true })), lbl('Relative weight:', F().text({ value: 100, width: 50, disabled: true }))),
          running ? disabledNote('Some settings cannot be modified because the virtual machine was running when this window was opened.') : null);
        return;
      }
      if (kind === 'ctl') {
        R(h('div.hv-rhead', ctl), h('p', 'You can add hard drives to your controller or remove hard drives from it. Select the type of drive you want to attach to the controller and then click Add.'),
          h('div.hv-types', h('div.hv-type.sel', 'Hard Drive'), h('div.hv-type', 'DVD Drive')),
          h('div.hv-right-b', h('button.btn', { dataset: { field: 'adddisk' }, onClick: () => { v.disks.push({ controller: v.generation === 2 ? 'SCSI' : 'IDE', number: 0, location: null, path: null, isNew: true }); sel = 'disk:' + (v.disks.length - 1); dirty(); paint(); } }, 'Add Hard Drive'),
            h('button.btn', { dataset: { field: 'adddvd' }, onClick: () => { v.dvds.push({ controller: v.generation === 2 ? 'SCSI' : 'IDE', number: 0, location: null, path: null, isNew: true }); sel = 'dvd:' + (v.dvds.length - 1); dirty(); paint(); } }, 'Add DVD Drive')));
        return;
      }
      if (kind === 'disk') {
        const d = v.disks[+idx];
        const p = field('vhd', F().text({ value: d.path || '', width: 360, onInput: x => { d.path = x; dirty(); } }));
        R(h('div.hv-rhead', 'Hard Drive'), h('p', 'You can change how this virtual hard disk is attached to the virtual machine. If an operating system is installed on this disk, changing the attachment might prevent the virtual machine from starting.'),
          lbl('Controller:', h('span', ctl)), lbl('Location:', h('span', `${d.location == null ? '(next free)' : d.location} (in use)`)),
          F().group('Media', h('div', 'You can compact, convert, expand, merge, reconnect or shrink a virtual hard disk by editing the associated file. Specify the full path to the file.'), F().radio('dmedia', 'Virtual hard disk:', true), p,
            h('div.hv-inline', F().button('New', async () => { const x = await newVhd(); if (x) { p.value = d.path = x.path; dirty(); } }), F().button('Edit', () => editDisk()), F().button('Inspect', () => inspectDisk(d.path)), F().button('Browse...', async () => { const x = await pickVhd('Open'); if (x) { p.value = d.path = x; dirty(); } }))),
          h('div.hv-right-b', h('button.btn', { dataset: { field: 'removedisk' }, onClick: () => { d.removed = true; v.disks.splice(+idx, 1); if (v.firmware) v.firmware.bootOrder = v.firmware.bootOrder.filter(e => e !== 'disk:' + idx).map(e => (e.startsWith('disk:') && +e.slice(5) > +idx ? 'disk:' + (+e.slice(5) - 1) : e)); sel = 'ctl'; dirty(); paint(); } }, 'Remove')));
        return;
      }
      if (kind === 'dvd') {
        const d = v.dvds[+idx];
        const p = field('iso', F().text({ value: d.path || '', width: 330, disabled: !d.path, onInput: x => { d.path = x; dirty(); } }));
        const none = field('dvd-none', F().radio('dvdm', 'None', !d.path, { onChange: on => { if (on) { d.path = null; p.value = ''; p.disabled = true; dirty(); } } }));
        const img = field('dvd-image', F().radio('dvdm', 'Image file:', !!d.path, { onChange: on => { if (on) { p.disabled = false; dirty(); } } }));
        R(h('div.hv-rhead', 'DVD Drive'), h('p', 'Select the controller and location on the controller to attach the CD/DVD drive.'), lbl('Controller:', h('span', ctl)),
          F().group('Media', h('div', 'Specify the media to use with your virtual CD/DVD drive.'), none, img, h('div.hv-inline', p, F().button('Browse...', async () => { const x = await WS.ui.filePicker({ mode: 'open', path: 'C:\\', filters: [{ label: 'Image files (*.iso)', ext: ['iso'] }] }); if (x) { img.checked = true; p.disabled = false; p.value = d.path = x; dirty(); } }))),
          h('div.hv-note', 'To remove the virtual CD/DVD drive from this virtual machine, click Remove.'), h('div.hv-right-b', h('button.btn', { onClick: () => { v.dvds.splice(+idx, 1); if (v.firmware) v.firmware.bootOrder = v.firmware.bootOrder.filter(e => e !== 'dvd:' + idx).map(e => (e.startsWith('dvd:') && +e.slice(4) > +idx ? 'dvd:' + (+e.slice(4) - 1) : e)); sel = 'ctl'; dirty(); paint(); } }, 'Remove')));
        return;
      }
      if (kind === 'nic') {
        const n = v.nics[+idx];
        const swl = field('switch', F().select([{ value: '', label: 'Not connected' }, ...H().switches().map(s => ({ value: s.name, label: s.name }))], n.switch || '', { width: 300, onChange: x => { n.switch = x || null; dirty(); } }));
        const vl = field('vlan', F().text({ value: n.vlan || '', width: 70, disabled: !n.vlan, onInput: x => { n.vlan = x; dirty(); } }));
        const vchk = field('vlanon', F().checkbox('Enable virtual LAN identification', !!n.vlan, { onChange: on => { vl.disabled = !on; n.vlan = on ? vl.value || 2 : null; if (on && !vl.value) vl.value = 2; dirty(); } }));
        R(h('div.hv-rhead', 'Network Adapter'), h('p', 'Specify the configuration of the network adapter or remove the network adapter.'), lbl('Virtual switch:', swl),
          F().group('VLAN ID', vchk, h('p', 'The VLAN identifier specifies the virtual LAN that this virtual machine will use for all network communications through this network adapter.'), vl),
          F().group('Bandwidth Management', F().checkbox('Enable bandwidth management', false, { disabled: true })),
          h('div.hv-note', 'To remove the network adapter from this virtual machine, click Remove.'), h('div.hv-right-b', h('button.btn', { dataset: { field: 'removenic' }, onClick: () => { v.nics.splice(+idx, 1); if (v.firmware) v.firmware.bootOrder = v.firmware.bootOrder.filter(e => e !== 'net:' + idx).map(e => (e.startsWith('net:') && +e.slice(4) > +idx ? 'net:' + (+e.slice(4) - 1) : e)); sel = 'add'; dirty(); paint(); } }, 'Remove')));
        return;
      }
      if (kind === 'name') {
        const nm = field('name', F().text({ value: v.name, width: 360, onInput: x => { v.name = x; dirty(); } }));
        const notes = field('notes', F().textarea({ value: v.notes, rows: 6, width: 360 })); notes.addEventListener('input', () => { v.notes = notes.value; dirty(); });
        R(h('div.hv-rhead', 'Name'), h('p', 'You can edit the name of this virtual machine. This name is displayed in Hyper-V Manager.'), nm, h('div', 'Notes:'), notes);
        return;
      }
      if (kind === 'integration') {
        R(h('div.hv-rhead', 'Integration Services'), h('p', 'Select the services that you want Hyper-V to offer to this virtual machine. To use the services you select, they must be supported by the guest operating system.'),
          F().group('Services', ...H().INTEGRATION.map(nm => field('is-' + nm, F().checkbox(nm === 'VSS' ? 'Backup (volume shadow copy)' : nm === 'Shutdown' ? 'Operating system shutdown' : nm === 'Key-Value Pair Exchange' ? 'Data Exchange' : nm, v.integration[nm], { onChange: on => { v.integration[nm] = on; dirty(); } })))));
        return;
      }
      if (kind === 'checkpoints') {
        const en = field('cpon', F().checkbox('Enable checkpoints', v.checkpointType !== 'Disabled', { onChange: on => { v.checkpointType = on ? 'Production' : 'Disabled'; dirty(); paint(); } }));
        const dis = v.checkpointType === 'Disabled';
        const prod = field('cp-production', F().radio('cptype', 'Production checkpoints', /^Production/.test(v.checkpointType), { disabled: dis, onChange: on => { if (on) { v.checkpointType = fall.checked ? 'Production' : 'ProductionOnly'; dirty(); } } }));
        const fall = field('cp-fallback', F().checkbox('Create standard checkpoints if it\u2019s not possible to create a production checkpoint', v.checkpointType !== 'ProductionOnly', { disabled: dis, onChange: on => { if (/^Production/.test(v.checkpointType)) v.checkpointType = on ? 'Production' : 'ProductionOnly'; dirty(); } }));
        const std = field('cp-standard', F().radio('cptype', 'Standard checkpoints', v.checkpointType === 'Standard', { disabled: dis, onChange: on => { if (on) { v.checkpointType = 'Standard'; dirty(); } } }));
        const auto = field('cp-auto', F().checkbox('Use automatic checkpoints', v.automaticCheckpoints, { disabled: dis, onChange: on => { v.automaticCheckpoints = on; dirty(); } }));
        R(h('div.hv-rhead', 'Checkpoints'), h('p', 'You can choose the type of checkpoint to create when you use Hyper-V Manager or the Checkpoint-VM Windows PowerShell cmdlet.'), en,
          F().group('Checkpoint Type', prod, h('div.hv-desc', 'Production checkpoints use backup technology in the guest to create data-consistent checkpoints that do not include information about running applications.'), h('div.hv-indent', fall),
            std, h('div.hv-desc', 'Standard checkpoints capture the state, data, and hardware configuration of a running virtual machine. Use standard checkpoints for development and testing scenarios.')),
          lbl('Checkpoint File Location:', F().text({ value: `${v.path}`, width: 320, readOnly: true })), auto, h('div.hv-desc', 'Automatically create a checkpoint when the virtual machine starts.'));
        return;
      }
      if (kind === 'paging') { R(h('div.hv-rhead', 'Smart Paging File Location'), h('p', 'Specify the folder to store the Smart Paging file for this virtual machine. The Smart Paging file is used when additional memory is needed to restart the virtual machine.'), F().text({ value: v.path, width: 360, readOnly: true })); return; }
      if (kind === 'autostart') {
        const r = (val, label) => field('as-' + val, F().radio('astart', label, v.autoStart === val, { onChange: on => { if (on) { v.autoStart = val; dirty(); } } }));
        const delay = field('delay', F().text({ value: v.autoStartDelay, width: 60, onInput: x => { v.autoStartDelay = x; dirty(); } }));
        R(h('div.hv-rhead', 'Automatic Start Action'), h('p', 'What do you want this virtual machine to do when the physical computer starts?'), r('Nothing', 'Nothing'), r('StartIfRunning', 'Automatically start if it was running when the service stopped'), r('Start', 'Always start this virtual machine automatically'),
          F().group('Automatic start delay', h('p', 'Specify a startup delay to reduce resource contention between virtual machines.'), lbl('Startup delay:', h('div.hv-inline', delay, 'seconds'))));
        return;
      }
      if (kind === 'autostop') {
        const r = (val, label) => field('ast-' + val, F().radio('astop', label, v.autoStop === val, { onChange: on => { if (on) { v.autoStop = val; dirty(); } } }));
        R(h('div.hv-rhead', 'Automatic Stop Action'), h('p', 'What do you want this virtual machine to do when the physical computer shuts down?'), r('Save', 'Save the virtual machine state'), h('div.hv-desc', `Hyper-V will reserve ${v.memory.startup} MB of disk space to save the virtual machine state when the physical computer shuts down.`), r('TurnOff', 'Turn off the virtual machine'), r('ShutDown', 'Shut down the guest operating system'));
      }
    }
    const paint = () => { paintLeft(); paintRight(); };
    async function apply() {
      if (ro) return true;
      const live = H().vm(id);
      if (!live) return true;
      const step = r => { if (r && !r.ok) throw r; };
      try {
        step(H().setVM(id, { memory: { startup: +v.memory.startup, dynamic: v.memory.dynamic, minimum: +v.memory.minimum, maximum: +v.memory.maximum }, ...(v.cpu.count !== live.cpu.count ? { cpu: v.cpu.count } : {}),
          ...(v.generation === 2 && (v.firmware.secureBoot !== live.firmware.secureBoot || v.firmware.template !== live.firmware.template) ? { secureBoot: v.firmware.secureBoot, template: v.firmware.template } : {}),
          ...(v.generation === 2 && v.tpm !== live.tpm ? { tpm: v.tpm } : {}), notes: v.notes, autoStart: v.autoStart, autoStartDelay: +v.autoStartDelay || 0, autoStop: v.autoStop, checkpointType: v.checkpointType, automaticCheckpoints: v.automaticCheckpoints, integration: v.integration,
          ...(v.name.trim() !== live.name ? { name: v.name.trim() } : {}) }));
        // disks: removed, re-pathed, added
        for (let i = live.disks.length - 1; i >= 0; i--) if (!v.disks.some(d => !d.isNew && d.number === live.disks[i].number && d.location === live.disks[i].location && d.controller === live.disks[i].controller)) step(H().removeDisk(id, i));
        for (const d of v.disks) {
          if (d.isNew) { if (d.path) step(H().addDisk(id, { path: d.path })); continue; }
          const i = live.disks.findIndex(x => x.number === d.number && x.location === d.location && x.controller === d.controller);
          if (i >= 0 && (live.disks[i].path || '') !== (d.path || '')) step(H().setDiskPath(id, i, d.path || null));
        }
        for (let i = live.dvds.length - 1; i >= 0; i--) if (!v.dvds.some(d => !d.isNew && d.number === live.dvds[i].number && d.location === live.dvds[i].location)) step(H().removeDvd(id, i));
        for (const d of v.dvds) {
          if (d.isNew) { step(H().addDvd(id, d.path || null)); continue; }
          const i = live.dvds.findIndex(x => x.number === d.number && x.location === d.location);
          if (i >= 0 && (live.dvds[i].path || '') !== (d.path || '')) step(H().setDvd(id, d.path || null, i));
        }
        for (let i = live.nics.length - 1; i >= 0; i--) if (!v.nics.some(n => n.id === live.nics[i].id)) step(H().removeNic(id, i));
        for (const n of v.nics) {
          if (n.isNew) { step(H().addNic(id, { switch: n.switch })); n.isNew = false; n.id = live.nics[live.nics.length - 1].id; continue; }
          const i = live.nics.findIndex(x => x.id === n.id);
          if (i < 0) continue;
          if ((live.nics[i].switch || null) !== (n.switch || null)) step(H().connectNic(id, i, n.switch || null));
          if (String(live.nics[i].vlan || '') !== String(n.vlan || '')) step(H().setNic(id, i, { vlan: n.vlan || null }));
        }
        if (v.generation === 2) { const valid = live.firmware.bootOrder.slice().sort().join() === v.firmware.bootOrder.slice().sort().join(); if (valid) step(H().setVM(id, { bootOrder: v.firmware.bootOrder })); }
        else step(H().setVM(id, { bootOrder: v.bios.order }));
      } catch (r) {
        await err('An error occurred while attempting to apply the settings.', r.error || String(r), `Settings for ${live.name}`);
        return false;
      }
      const fresh = JSON.parse(JSON.stringify(H().vm(id)));
      Object.keys(v).forEach(k => delete v[k]); Object.assign(v, fresh);
      applyBtn.disabled = true;
      paint();
      return true;
    }
    const okBtn = h('button.btn.primary', { onClick: async () => { if (await apply()) frame.close(true); } }, 'OK');
    const applyBtn = h('button.btn', { disabled: true, onClick: () => apply() }, 'Apply');
    frame.footer.append(okBtn, h('button.btn', { onClick: () => frame.close(false) }, 'Cancel'), applyBtn);
    paint();
    if (o.onCreate) o.onCreate(frame, { select: k => { sel = k; paint(); }, work: v, apply, ok: () => okBtn.click(), right, left });
    return frame.promise;
  }

  /* ================================================================ Hyper-V Settings */
  function hostSettings(o = {}) {
    const hv = { ...H().host() };
    const frame = WS.ui.modal({ title: `Hyper-V Settings for ${host()}`, width: 760, height: 520, className: 'w32-dlg hv-big' });
    const left = h('div.hv-left'), right = h('div.hv-right');
    frame.body.append(h('div.w32.hv-split', left, right));
    let sel = 'vhd';
    const items = [['h', 'Server'], ['vhd', 'Virtual Hard Disks', hv.vhdPath], ['vm', 'Virtual Machines', hv.vmPath], ['numa', 'NUMA Spanning', 'Allow NUMA Spanning'], ['esm', 'Enhanced Session Mode Policy', 'No enhanced session mode'], ['h', 'User'], ['kbd', 'Keyboard', 'Use on the virtual machine'], ['mrk', 'Mouse Release Key', 'CTRL+ALT+LEFT ARROW']];
    const dirty = () => { applyBtn.disabled = false; };
    const paint = () => {
      U.clear(left); U.clear(right);
      for (const [k, l, sub] of items) left.append(k === 'h' ? h('div.hv-litem.head', h('div', l)) : h('div.hv-litem' + (sel === k ? '.sel' : ''), { dataset: { key: k }, onClick: () => { sel = k; paint(); } }, h('span.hv-lic', { html: IC.gear }), h('div', h('div', l), h('div.hv-lsub', k === 'vhd' ? hv.vhdPath : k === 'vm' ? hv.vmPath : k === 'numa' ? (hv.numaSpanning ? 'Allow NUMA Spanning' : 'Do not allow NUMA Spanning') : k === 'esm' ? (hv.enhancedSession ? 'Allow enhanced session mode' : 'No enhanced session mode') : sub))));
      if (sel === 'vhd' || sel === 'vm') {
        const key = sel === 'vhd' ? 'vhdPath' : 'vmPath';
        const t = field(key, F().text({ value: hv[key], width: 360, onInput: x => { hv[key] = x; dirty(); } }));
        right.append(h('div.hv-rhead', sel === 'vhd' ? 'Virtual Hard Disks' : 'Virtual Machines'), h('p', sel === 'vhd' ? 'Specify the default folder to store virtual hard disk files.' : 'Specify the default folder to store virtual machine configuration files.'),
          h('div.hv-inline', t, F().button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: t.value }); if (p) { t.value = hv[key] = p; dirty(); } })));
      } else if (sel === 'numa') right.append(h('div.hv-rhead', 'NUMA Spanning'), h('p', 'Specify whether virtual machines can use NUMA spanning. Changes take effect when the Hyper-V Virtual Machine Management service restarts.'), field('numa', F().checkbox('Allow virtual machines to span physical NUMA nodes', hv.numaSpanning, { onChange: on => { hv.numaSpanning = on; dirty(); } })));
      else if (sel === 'esm') right.append(h('div.hv-rhead', 'Enhanced Session Mode Policy'), field('esm', F().checkbox('Allow enhanced session mode', hv.enhancedSession, { onChange: on => { hv.enhancedSession = on; dirty(); } })), h('p', 'Enhanced session mode lets you redirect local devices and resources when you connect to a virtual machine. It is not modelled in the lab simulator.'));
      else right.append(h('div.hv-rhead', sel === 'kbd' ? 'Keyboard' : 'Mouse Release Key'), h('p', 'This setting is not modelled in the lab simulator.'));
    };
    const apply = async () => { const r = H().setHost({ vhdPath: hv.vhdPath, vmPath: hv.vmPath, numaSpanning: hv.numaSpanning, enhancedSession: hv.enhancedSession }); if (!r.ok) { await err(r.error, null, 'Hyper-V Settings'); return false; } applyBtn.disabled = true; return true; };
    const okBtn = h('button.btn.primary', { onClick: async () => { if (applyBtn.disabled || await apply()) frame.close(true); } }, 'OK');
    const applyBtn = h('button.btn', { disabled: true, onClick: () => apply() }, 'Apply');
    frame.footer.append(okBtn, h('button.btn', { onClick: () => frame.close(false) }, 'Cancel'), applyBtn);
    paint();
    if (o.onCreate) o.onCreate(frame, { select: k => { sel = k; paint(); }, ok: () => okBtn.click() });
    return frame.promise;
  }

  function connect(id) { return WS.apps.launch('vmconnect', { vm: id }); }

  WS.apps.register({ id: 'virtmgmt', name: 'Hyper-V Manager', icon: IC.app, keywords: ['hyper-v', 'virtmgmt', 'virtual machine', 'vm', 'hyper-v manager'], launch });
  WS.virtmgmt = { newVM, newVhd, switchManager, settings, hostSettings, connect, act, applyDialog, checkpointMenu, vmMenu, hostMenu, inspectDisk, exportDialog, ICON: IC.app, IC };
})();
