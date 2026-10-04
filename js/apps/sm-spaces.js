/* Server Manager > File and Storage Services > Storage Pools (Storage Spaces), on WS.spaces: the STORAGE POOLS list with
 * its VIRTUAL DISKS and PHYSICAL DISKS tiles, the New Storage Pool Wizard, the New Virtual Disk Wizard, Add Physical
 * Disk, Extend Virtual Disk and pool Properties. Built from sm-fss.js's tiles (WS.smfss.ui).
 *   WS.smspaces.page(ctx)                                        the Storage Pools page (sm-fss routes 'fss:pools' here)
 *   WS.smspaces.rows.pools() | spaces(pool) | disks(pool)        ids 'pool:<name>' ('pool:primordial'), 'vd:<name>', 'pd:<number>'
 *   WS.smspaces.menus.pool(row) | space(row) | disk(row)
 *   WS.sm.newStoragePool({ onCreate(w, data) })                  -> Promise<{ finished, data }>; data.next opens New Virtual Disk
 *   WS.sm.newVirtualDisk({ pool, onCreate(w, data) })            data.next (default on) opens the New Volume Wizard on the new disk
 *   WS.smspaces.addPhysicalDisk(pool, { onCreate(frame) }), extendVirtualDisk(name, { onCreate }), poolProperties(name, { onCreate })
 * Controls carry data-field names for tests. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, F = WS.ui.f, SP = WS.spaces, S = WS.storage;
  const X = () => WS.smfss.ui;
  const MB = S.MB, GB = S.GB;

  /* ================================================================ rows */
  const statusText = s => (s === 'OK' ? '' : s);
  function poolRows() {
    const { server, size } = X(), pr = SP.primordial();
    return [
      ...(pr.poolable.length ? [{ id: 'pool:primordial', p: pr, name: 'Primordial', type: 'Available Disks', managedBy: server(), availableTo: server(), rw: '', capacity: pr.size, free: null, alloc: null, status: '' }] : []),
      ...SP.pools().map(p => ({ id: 'pool:' + p.name, p, name: p.name, type: 'Storage Pool', managedBy: server(), availableTo: server(), rw: server(), capacity: p.size, free: p.free,
        alloc: Math.round(p.allocated / p.size * 100), status: statusText(p.operationalStatus) }))
    ].map(r => ({ ...r, sizeText: size(r.capacity) }));
  }
  const volumesOn = n => S.volumes().filter(v => v.disk === n).map(v => (v.letter ? v.letter + ':' : v.paths[0] ? v.paths[0].replace(/\\$/, '') : v.path)).join(', ');
  const spaceRows = pool => SP.spaces().filter(v => pool && !pool.primordial && v.pool === pool.name).map(v => ({ id: 'vd:' + v.name, v, name: v.name, status: statusText(v.operationalStatus),
    layout: v.layout, provisioning: v.provisioning, capacity: v.size, allocated: v.allocated, volume: v.operationalStatus === 'Detached' ? '' : volumesOn(v.disk) }));
  const diskRows = pool => SP.physicalDisks().filter(d => (pool ? (pool.primordial ? pool.poolable.includes(d.number) : d.pool === pool.name) : false)).map(d => ({ id: 'pd:' + d.number, d, slot: '',
    name: `${d.friendlyName} (${X().server()})`, status: d.operationalStatus, capacity: d.size, bus: d.busType, usage: d.usageLabel, chassis: d.failed ? '' : `Integrated : Adapter 0 : Port 0 : Target 0 : LUN ${d.number}`,
    media: d.mediaType, rpm: '' }));
  const poolByRow = r => (r ? (r.p.primordial ? SP.primordial() : SP.pool(r.p.name)) : null);

  /* ================================================================ menus */
  function poolMenu(r) {
    if (!r) return [];
    if (r.p.primordial) return [{ label: 'New Storage Pool...', action: () => newStoragePool() }];
    const { SEP } = X();
    return [
      { label: 'New Virtual Disk...', action: () => newVirtualDisk({ pool: r.p.name }) },
      { label: 'Add Physical Disk...', disabled: !SP.primordial().poolable.length, action: () => addPhysicalDisk(r.p.name) },
      SEP,
      { label: 'Delete Storage Pool', action: () => deletePool(r.p.name) },
      SEP,
      { label: 'Properties', action: () => poolProperties(r.p.name) }
    ];
  }
  function spaceMenu(r) {
    if (!r) return [];
    const v = r.v, { SEP } = X(), detached = v.operationalStatus === 'Detached';
    return [
      { label: 'New Volume...', disabled: detached, action: () => WS.sm.newVolume({ disk: v.disk }) },
      { label: 'Repair Virtual Disk', disabled: v.operationalStatus !== 'Degraded', action: () => repairSpace(v.name) },
      { label: 'Extend Virtual Disk...', disabled: detached, action: () => extendVirtualDisk(v.name) },
      SEP,
      { label: 'Delete Virtual Disk', action: () => deleteSpace(v.name) }
    ];
  }
  function diskMenu(r) {
    if (!r || !r.d.pool) return [];
    return [
      { label: 'Remove Disk', action: () => removeDisk(r.d.pool, r.d.number) },
      { label: 'Toggle Disk Identification LED', disabled: true }
    ];
  }
  async function deletePool(name) {
    if (!(await X().ask('Delete Storage Pool', `Are you sure you want to delete the storage pool ${name}? The physical disks in it return to the primordial pool.`))) return false;
    const r = SP.removePool(name);
    if (!r.ok) { await X().err(r, 'Delete Storage Pool'); return false; }
    return true;
  }
  async function deleteSpace(name) {
    if (!(await X().ask('Delete Virtual Disk', `Deleting the virtual disk ${name} also deletes its volumes and all the data on them. Are you sure you want to continue?`))) return false;
    const r = SP.removeSpace(name);
    if (!r.ok) { await X().err(r, 'Delete Virtual Disk'); return false; }
    return true;
  }
  async function repairSpace(name) {
    const r = SP.repair(name);
    if (!r.ok) { await X().err(r, 'Repair Virtual Disk'); return false; }
    return true;
  }
  async function removeDisk(poolName, n) {
    if (!(await X().ask('Remove Physical Disk', `Are you sure you want to remove this physical disk from the storage pool ${poolName}? Windows must first move the data on it to other disks in the pool.`))) return false;
    const r = SP.removeDisk(poolName, n);
    if (!r.ok) { await X().err(r, 'Remove Physical Disk'); return false; }
    return true;
  }

  /* ================================================================ the page */
  function page(c) {
    const { tile, restore, noteTile, size, pctBar, link, server, SEP } = X();
    const vdHost = h('div'), pdHost = h('div');
    const paint = r => {
      U.clear(vdHost); U.clear(pdHost);
      const pool = poolByRow(r);
      if (!pool || pool.primordial) {
        vdHost.appendChild(noteTile('VIRTUAL DISKS', pool ? `Primordial on ${server()}` : '', !pool ? 'Select a storage pool to display its virtual disks.'
          : ['No related virtual disks exist.\nTo create a virtual disk, ', link('start the New Virtual Disk Wizard', () => newVirtualDisk()), '.']));
      } else {
        vdHost.appendChild(tile({ title: 'VIRTUAL DISKS', sub: () => `${pool.name} on ${server()}`, rows: () => spaceRows(pool), filter: false, height: 130, sortKey: 'name',
          groupLabel: list => `${pool.name} (${list.length})`, icon: () => WS.diskmgmt.ICON.disk,
          columns: [{ key: 'name', label: 'Name', width: 110 }, { key: 'status', label: 'Status', width: 70 }, { key: 'layout', label: 'Layout', width: 60 }, { key: 'provisioning', label: 'Provisioning', width: 80 },
            { key: 'capacity', label: 'Capacity', width: 70, type: 'num', align: 'right', render: x => size(x.capacity) }, { key: 'allocated', label: 'Allocated', width: 70, type: 'num', align: 'right', render: x => size(x.allocated) },
            { key: 'volume', label: 'Volume', width: 80 }],
          emptyText: () => h('div', h('div', 'No related virtual disks exist.'), h('div', 'To create a virtual disk, ', link('start the New Virtual Disk Wizard', () => newVirtualDisk({ pool: pool.name })), '.')),
          menu: spaceMenu, tasks: () => [{ label: 'New Virtual Disk...', action: () => newVirtualDisk({ pool: pool.name }) }, SEP, { label: 'Refresh', action: c.render }] }).el);
      }
      pdHost.appendChild(tile({ title: 'PHYSICAL DISKS', sub: () => (pool ? `${pool.name} on ${server()}` : ''), rows: () => diskRows(pool), filter: false, height: 130, sortKey: 'name',
        groupLabel: list => `${pool ? pool.name : ''} (${list.length})`, icon: x => (x.d.failed ? WS.diskmgmt.ICON.diskDown : WS.diskmgmt.ICON.disk),
        columns: [{ key: 'slot', label: 'Slot', width: 40 }, { key: 'name', label: 'Name', width: 170 }, { key: 'status', label: 'Status', width: 110 },
          { key: 'capacity', label: 'Capacity', width: 70, type: 'num', align: 'right', render: x => size(x.capacity) }, { key: 'bus', label: 'Bus', width: 45 }, { key: 'usage', label: 'Usage', width: 85 },
          { key: 'chassis', label: 'Chassis', width: 250 }, { key: 'media', label: 'Media Type', width: 85 }, { key: 'rpm', label: 'RPM', width: 45 }],
        menu: diskMenu,
        emptyText: pool ? 'No physical disks are available.' : 'Select a storage pool to display its physical disks.',
        tasks: () => [{ label: 'Add Physical Disk...', disabled: !pool || pool.primordial || !SP.primordial().poolable.length, action: () => addPhysicalDisk(pool.name) }] }).el);
    };
    const t = tile({ title: 'STORAGE POOLS', key: 'pools', sub: n => `Storage Spaces | ${n} total`, rows: poolRows, sortKey: 'name', groupLabel: list => `Windows Storage (${server()}) (${list.length})`,
      icon: () => WS.diskmgmt.ICON.app, emptyText: 'No storage pools exist.',
      columns: [{ key: 'name', label: 'Name', width: 120 }, { key: 'type', label: 'Type', width: 105 }, { key: 'managedBy', label: 'Managed by', width: 100 }, { key: 'availableTo', label: 'Available to', width: 100 },
        { key: 'rw', label: 'Read-Write Server', width: 115 }, { key: 'capacity', label: 'Capacity', width: 70, type: 'num', align: 'right', render: r => size(r.capacity) },
        { key: 'free', label: 'Free Space', width: 75, type: 'num', align: 'right', render: r => (r.free == null ? '' : size(r.free)) },
        { key: 'alloc', label: 'Percent Allocated', width: 115, type: 'num', render: r => (r.alloc == null ? '' : pctBar(r.alloc)) }, { key: 'status', label: 'Status', width: 70 }],
      menu: poolMenu, onSelect: paint,
      tasks: () => [{ label: 'New Storage Pool...', disabled: !SP.primordial().poolable.length, action: () => newStoragePool() }, { label: 'Rescan Storage', action: async () => { await U.sleep(300); c.render(); } }, SEP, { label: 'Refresh', action: c.render }] });
    c.content.append(t.el, h('div.fss-lower', vdHost, pdHost));
    restore(t, 'pools', paint);
  }

  /** Run fn once the wizard's window has closed (the "...when this wizard closes" check boxes). */
  const afterClose = (app, fn) => { const win = WS.wm.find(app); if (win) win.onClose(() => setTimeout(fn, 0)); };

  /* ================================================================ New Storage Pool Wizard */
  /** The physical disk table of the wizard and Add Physical Disk: a check box and an Allocation list per disk. */
  function diskPicker(d, onChange) {
    const { size, field, server } = X();
    const disks = SP.primordial().poolable.map(n => SP.physicalDisk(n));
    const total = h('div', { style: 'margin-top:8px' });
    const paintTotal = () => { total.textContent = `Total selected capacity: ${size(disks.filter(x => d.disks[x.number]).reduce((a, x) => a + x.size, 0))}`; if (onChange) onChange(); };
    const rows = disks.map(x => {
      const cb = field('pd-' + x.number, F.checkbox('', !!d.disks[x.number], { onChange: on => { if (on) d.disks[x.number] = alloc.value; else delete d.disks[x.number]; paintTotal(); } }));
      const alloc = field('alloc-' + x.number, F.select([{ value: 'Automatic', label: 'Automatic' }, { value: 'Hot Spare', label: 'Hot Spare' }], d.disks[x.number] || 'Automatic', { width: 110,
        onChange: v => { if (d.disks[x.number]) d.disks[x.number] = v; } }));
      return h('tr', h('td', cb), h('td', ''), h('td', `${x.friendlyName} (${server()})`), h('td.num', size(x.size)), h('td', x.busType), h('td', ''), h('td', alloc),
        h('td', `Integrated : Adapter 0 : Port 0 : Target 0 : LUN ${x.number}`), h('td', x.mediaType));
    });
    paintTotal();
    return h('div', h('div.fss-pdscroll', h('table.fss-pdtable', h('thead', h('tr', ...['', 'Slot', 'Name', 'Capacity', 'Bus', 'RPM', 'Allocation', 'Chassis', 'Media Type'].map(x => h('th', x)))), h('tbody', ...rows))), total);
  }
  const ALLOC_USAGE = { Automatic: 'AutoSelect', 'Hot Spare': 'HotSpare' };
  function newStoragePool(opts = {}) {
    const open = WS.wm.find('newpool');
    if (open) { open.restore(); return Promise.resolve(null); }
    const { kv, size, field, server, results } = X();
    const d = { name: '', description: '', disks: {}, next: false, steps: null, error: null, pool: null };
    const pages = [
      { id: 'before', nav: 'Before You Begin', title: 'Before you begin',
        render: () => h('div.wz-text', h('p', 'This wizard helps you create a storage pool. A storage pool is a set of physical disks that you can use to create one or more virtual disks.'),
          h('p', 'A storage pool groups physical disks, so you can use their combined capacity and add disks later as you need more space. Virtual disks created from the pool can be resilient to disk failures.'),
          h('p', 'To continue, click Next.')) },
      { id: 'name', nav: 'Storage Pool Name', title: 'Specify a storage pool name and subsystem',
        render: () => {
          const name = field('pool-name', F.text({ value: d.name, width: 300 })), desc = field('pool-desc', F.textarea({ value: d.description, rows: 3, width: 300 }));
          name.addEventListener('input', () => { d.name = name.value; });
          desc.addEventListener('input', () => { d.description = desc.value; });
          const lw = { labelWidth: 100 };
          return h('div.wz-text.fss-wz', F.row('Name:', name, lw), F.row('Description:', desc, lw),
            h('p', { style: 'margin-top:16px' }, 'Select the group of available disks (also known as a primordial pool) that you want to use:'),
            h('table.fss-pdtable', h('thead', h('tr', ...['Managed by', 'Available to', 'Subsystem', 'Primordial Pool'].map(x => h('th', x)))),
              h('tbody', h('tr.sel', h('td', server()), h('td', server()), h('td', 'Windows Storage'), h('td', 'Primordial')))));
        },
        validate: () => {
          const n = d.name.trim();
          if (!n) return 'Type a name for the storage pool.';
          if (/^primordial$/i.test(n) || SP.pool(n)) return `A storage pool named ${n} already exists. Type a different name.`;
          if (n.length > 64 || /[\\/:*?"<>|]/.test(n)) return 'The storage pool name is not valid.';
          d.name = n;
          return null;
        } },
      { id: 'disks', nav: 'Physical Disks', title: 'Select physical disks for the storage pool', rerender: true,
        render: () => h('div.wz-text.fss-wz', h('p', { style: 'margin-top:0' }, 'Select physical disks for the storage pool:'), diskPicker(d)),
        validate: () => {
          const sel = Object.entries(d.disks);
          if (!sel.length) return 'Select at least one physical disk for the storage pool.';
          if (sel.every(([, a]) => a === 'Hot Spare')) return 'At least one physical disk must use the Automatic allocation.';
          return null;
        } },
      { id: 'confirm', nav: 'Confirmation', title: 'Confirm selections', finish: true, rerender: true,
        render: () => {
          const nums = Object.keys(d.disks).map(Number);
          const disks = nums.map(n => SP.physicalDisk(n));
          return h('div.wz-text.fss-wz', h('p', 'Confirm that the following are the correct settings, and then click Create.'),
            h('div.wz-section', 'STORAGE POOL LOCATION'), kv([['Server:', server()], ['Cluster role:', 'Not Clustered'], ['Storage subsystem:', 'Windows Storage'], ['Primordial pool:', 'Primordial']]),
            h('div.wz-section', 'STORAGE POOL PROPERTIES'), kv([['Name:', d.name], ['Description:', d.description], ['Total capacity:', size(disks.reduce((a, x) => a + x.size, 0))]]),
            h('div.wz-section', 'PHYSICAL DISKS'), h('div', { style: 'margin-left:12px' }, ...disks.map(x => h('div', `${x.friendlyName} (${server()}) (${size(x.size)}) ${d.disks[x.number]}`))));
        } },
      { id: 'results', nav: 'Results', title: 'View results', rerender: true,
        render: () => h('div', results(d, 'You have successfully completed the New Storage Pool Wizard.'),
          d.pool ? h('div', { style: 'margin-top:12px' }, field('next-vd', F.checkbox('Create a virtual disk when this wizard closes', d.next, { onChange: v => { d.next = v; } }))) : null) }
    ];
    return WS.ui.wizard({ title: 'New Storage Pool Wizard', style: 'server', asWindow: true, app: 'newpool', icon: WS.diskmgmt.ICON.app, width: 820, height: 580,
      destination: ' ', finishLabel: 'Create', pages, data: d,
      // the Results check box acts when the wizard window closes
      onCreate: w => { afterClose('newpool', () => { if (d.pool && d.next) newVirtualDisk({ pool: d.pool.name }); }); if (opts.onCreate) opts.onCreate(w, d); },
      onFinish: async () => {
        await U.sleep(200);
        const usage = {};
        for (const [n, a] of Object.entries(d.disks)) usage[n] = ALLOC_USAGE[a];
        const r = SP.newPool({ name: d.name, description: d.description, disks: Object.keys(d.disks).map(Number), usage });
        if (!r.ok) { d.error = r.error; d.steps = [['Gather information', 'Completed'], ['Create storage pool', 'Failed']]; return null; }
        d.pool = r.pool;
        X().selection.pools = 'pool:' + r.pool.name;
        d.steps = [['Gather information', 'Completed'], ['Create storage pool', 'Completed']];
        return null;
      } });
  }

  /* ================================================================ New Virtual Disk Wizard */
  const LAYOUT_TEXT = {
    Simple: 'Data is striped across physical disks, maximizing capacity and increasing throughput, but decreasing reliability. This storage layout requires at least one disk and does not protect you from a disk failure.',
    Mirror: 'Data is striped across physical disks, creating two or three copies of your data. This increases reliability, but reduces capacity. This storage layout requires at least two disks to protect you from a single disk failure, or at least five disks to protect you from two simultaneous disk failures.',
    Parity: 'Data and parity information are striped across physical disks, increasing reliability, but somewhat reducing capacity and performance. This storage layout requires at least three disks to protect you from a single disk failure, and at least seven disks to protect you from two disk failures.'
  };
  const RESILIENCY = { Mirror: [[1, 'Two-way mirror', 'Creates two copies of your data, protecting you from a single disk failure. This option requires at least two disks.'], [2, 'Three-way mirror', 'Creates three copies of your data, protecting you from two simultaneous disk failures. This option requires at least five disks.']],
    Parity: [[1, 'Single parity', 'Protects you from a single disk failure. This option requires at least three disks.'], [2, 'Dual parity', 'Protects you from two simultaneous disk failures. This option requires at least seven disks.']] };
  const eligibleCount = pool => SP.physicalDisks().filter(x => x.pool === pool && !x.failed && x.usage === 'AutoSelect').length;
  function newVirtualDisk(opts = {}) {
    const open = WS.wm.find('newvdisk');
    if (open) { open.restore(); return Promise.resolve(null); }
    const { kv, size, field, server, results, parseSize } = X();
    const d = { pool: opts.pool || (SP.pools()[0] || {}).name || null, name: '', description: '', layout: 'Mirror', red: 1, provisioning: 'Thin', sizeMode: 'size', value: '', unit: 'GB', bytes: 0,
      next: true, steps: null, error: null, space: null };
    const pool = () => SP.pool(d.pool);
    const radioGroup = (g, items, cur, onPick) => items.map(([value, label, disabled]) => field('opt-' + value, F.radio(g, label, cur === value, { disabled, onChange: on => { if (on) onPick(value); } })));
    const pages = [
      { id: 'before', nav: 'Before You Begin', title: 'Before you begin',
        render: () => h('div.wz-text', h('p', 'This wizard helps you create a virtual disk, which can be used to create volumes.'),
          h('p', 'A virtual disk is a collection of one or more physical disks from a previously created storage pool. The layout of data on the physical disks can increase the reliability and performance of the virtual disk.'),
          h('p', 'To continue, click Next.')) },
      { id: 'pool', nav: 'Storage Pool', title: 'Select the storage pool', rerender: true,
        render: () => {
          const rows = SP.pools();
          if (!rows.length) return h('div.wz-text', h('p', 'There are no storage pools. Close this wizard and create a storage pool first.'));
          const g = U.uid('vdp');
          return h('div.wz-text.fss-wz', h('p', { style: 'margin-top:0' }, 'Select the storage pool:'),
            h('table.fss-pdtable', h('thead', h('tr', ...['', 'Storage Pool', 'Managed by', 'Available to', 'Free Space'].map(x => h('th', x)))),
              h('tbody', ...rows.map(p => h('tr', h('td', field('pool-' + p.name, F.radio(g, '', d.pool === p.name, { onChange: on => { if (on) d.pool = p.name; } }))),
                h('td', p.name), h('td', server()), h('td', server()), h('td.num', size(p.free)))))));
        },
        validate: () => (!pool() ? 'Select a storage pool.' : !eligibleCount(d.pool) ? 'The storage pool does not contain any healthy physical disks that can be used.' : null) },
      { id: 'name', nav: 'Virtual Disk Name', title: 'Specify the virtual disk name',
        render: () => {
          const name = field('vd-name', F.text({ value: d.name, width: 300 })), desc = field('vd-desc', F.textarea({ value: d.description, rows: 3, width: 300 }));
          name.addEventListener('input', () => { d.name = name.value; });
          desc.addEventListener('input', () => { d.description = desc.value; });
          const lw = { labelWidth: 100 };
          return h('div.wz-text.fss-wz', F.row('Name:', name, lw), F.row('Description:', desc, lw),
            h('div', { style: 'margin-top:14px' }, F.checkbox('Create storage tiers on this virtual disk', false, { disabled: true })),
            h('p', { style: 'margin:4px 0 0 22px;color:#555' }, 'Storage tiers move the most frequently used files to faster storage. They need both SSD and HDD physical disks in the pool, so they are not available here.'));
        },
        validate: () => {
          const n = d.name.trim();
          if (!n) return 'Type a name for the virtual disk.';
          if (SP.space(n)) return `A virtual disk named ${n} already exists. Type a different name.`;
          if (n.length > 64 || /[\\/:*?"<>|]/.test(n)) return 'The virtual disk name is not valid.';
          d.name = n;
          return null;
        } },
      { id: 'enclosure', nav: 'Enclosure Awareness', title: 'Specify enclosure resiliency',
        render: () => h('div.wz-text.fss-wz', h('p', { style: 'margin-top:0' }, 'Enclosure awareness provides an additional level of data protection, by placing copies of data on physical disks in different enclosures, so the virtual disk survives the failure of a whole enclosure.'),
          F.checkbox('Enable enclosure awareness', false, { disabled: true }),
          h('p', { style: 'margin:4px 0 0 22px;color:#555' }, 'The physical disks in this storage pool are not in enclosures that support enclosure awareness.')) },
      { id: 'layout', nav: 'Storage Layout', title: 'Select the storage layout', rerender: true,
        render: () => {
          const g = U.uid('vdl'), desc = h('div.fss-layoutdesc', LAYOUT_TEXT[d.layout]);
          const radios = radioGroup(g, ['Simple', 'Mirror', 'Parity'].map(x => [x, x]), d.layout, v => { d.layout = v; d.red = 1; desc.textContent = LAYOUT_TEXT[v]; });
          return h('div.wz-text.fss-wz', h('p', { style: 'margin-top:0' }, 'Layout:'), h('div.fss-layout', h('div.fss-layoutlist', ...radios), h('div', h('div', { style: 'font-weight:600' }, 'Description:'), desc)));
        },
        validate: () => (eligibleCount(d.pool) < SP.minDisks(d.layout, 1) ? `The storage pool does not contain enough physical disks to support the ${d.layout} storage layout.` : null) },
      { id: 'resiliency', nav: 'Resiliency Settings', title: 'Configure the resiliency settings', rerender: true, skip: () => d.layout === 'Simple',
        render: () => {
          const g = U.uid('vdr'), n = eligibleCount(d.pool), opts2 = RESILIENCY[d.layout];
          if (n < SP.minDisks(d.layout, d.red)) d.red = 1;
          const desc = h('div.fss-layoutdesc', opts2.find(x => x[0] === d.red)[2]);
          const radios = radioGroup(g, opts2.map(([r, label]) => [r, label, n < SP.minDisks(d.layout, r)]), d.red, v => { d.red = v; desc.textContent = opts2.find(x => x[0] === v)[2]; });
          return h('div.wz-text.fss-wz', h('p', { style: 'margin-top:0' }, 'Resiliency type:'), h('div.fss-layout', h('div.fss-layoutlist', ...radios), h('div', h('div', { style: 'font-weight:600' }, 'Description:'), desc)));
        } },
      { id: 'provisioning', nav: 'Provisioning', title: 'Specify the provisioning type',
        render: () => {
          const g = U.uid('vdv');
          const [thin, fixed] = radioGroup(g, [['Thin', 'Thin'], ['Fixed', 'Fixed']], d.provisioning, v => { d.provisioning = v; if (v === 'Thin' && d.sizeMode === 'max') d.sizeMode = 'size'; });
          return h('div.wz-text.fss-wz', h('p', { style: 'margin-top:0' }, 'Provisioning type:'),
            thin, h('p', { style: 'margin:2px 0 10px 22px;color:#555' }, 'The volume uses space from the storage pool as needed, up to the volume size.'),
            fixed, h('p', { style: 'margin:2px 0 0 22px;color:#555' }, 'The volume uses storage capacity from the storage pool that is equal to the volume size.'));
        } },
      { id: 'size', nav: 'Size', title: 'Specify the size of the virtual disk', rerender: true,
        render: () => {
          const p = pool(), most = SP.maxSize(d.pool, d.layout, d.red), g = U.uid('vds');
          const num = field('size', F.text({ value: d.value, width: 100 }));
          const unit = field('unit', F.select(['MB', 'GB', 'TB'], d.unit, { width: 60, onChange: v => { d.unit = v; } }));
          num.addEventListener('input', () => { d.value = num.value; });
          const [rs, rm] = radioGroup(g, [['size', 'Specify size:'], ['max', 'Maximum size', d.provisioning === 'Thin']], d.sizeMode, v => { d.sizeMode = v; num.disabled = unit.disabled = v !== 'size'; });
          num.disabled = unit.disabled = d.sizeMode !== 'size';
          return h('div.wz-text.fss-wz', kv([['Free space in this storage pool:', size(p.free)], ['Available capacity for this layout:', size(most)]]),
            h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:10px' }, rs, num, unit), h('div', { style: 'margin-top:8px' }, rm),
            d.provisioning === 'Thin' ? h('p', { style: 'margin:8px 0 0 0;color:#555' }, 'A thin virtual disk can be larger than the free space in the pool. It uses space from the pool only as data is written to it.') : null);
        },
        validate: () => {
          const most = SP.maxSize(d.pool, d.layout, d.red);
          if (d.sizeMode === 'max') { if (!most) return 'There is not enough free space in the storage pool for this layout.'; d.bytes = most; return null; }
          const b = parseSize(d.value, d.unit, Infinity);
          if (b == null || b < 256 * MB) return 'The virtual disk size is not valid. Specify a size of at least 256 MB.';
          if (d.provisioning === 'Fixed' && b > most) return `The virtual disk size can't be larger than the available capacity for this layout (${size(most)}).`;
          d.bytes = b;
          return null;
        } },
      { id: 'confirm', nav: 'Confirmation', title: 'Confirm selections', finish: true, rerender: true,
        render: () => {
          const p = pool();
          const res = d.layout === 'Simple' ? 'Simple' : RESILIENCY[d.layout].find(x => x[0] === d.red)[1];
          return h('div.wz-text.fss-wz', h('p', 'Confirm that the following are the correct settings, and then click Create.'),
            h('div.wz-section', 'VIRTUAL DISK LOCATION'), kv([['Server:', server()], ['Cluster role:', 'Not Clustered'], ['Storage pool:', p.name], ['Capacity:', size(p.size)], ['Free space:', size(p.free)]]),
            h('div.wz-section', 'VIRTUAL DISK PROPERTIES'), kv([['Name:', d.name], ['Storage layout:', d.layout], ['Resiliency type:', res], ['Provisioning:', d.provisioning], ['Enclosure awareness:', 'Disabled'],
              ['Size:', d.sizeMode === 'max' ? `Maximum size (${size(d.bytes)})` : size(d.bytes)]]));
        } },
      { id: 'results', nav: 'Results', title: 'View results', rerender: true,
        render: () => h('div', results(d, 'You have successfully completed the New Virtual Disk Wizard.'),
          d.space ? h('div', { style: 'margin-top:12px' }, field('next-volume', F.checkbox('Create a volume when this wizard closes', d.next, { onChange: v => { d.next = v; } }))) : null) }
    ];
    return WS.ui.wizard({ title: 'New Virtual Disk Wizard', style: 'server', asWindow: true, app: 'newvdisk', icon: WS.diskmgmt.ICON.app, width: 820, height: 580,
      destination: ' ', finishLabel: 'Create', pages, data: d,
      onCreate: w => { afterClose('newvdisk', () => { if (d.space && d.next) WS.sm.newVolume({ disk: d.space.disk }); }); if (opts.onCreate) opts.onCreate(w, d); },
      onFinish: async () => {
        await U.sleep(200);
        const r = SP.newSpace({ pool: d.pool, name: d.name, layout: d.layout, redundancy: d.red, provisioning: d.provisioning, size: d.sizeMode === 'max' ? 'max' : d.bytes });
        if (!r.ok) { d.error = r.error; d.steps = [['Gather information', 'Completed'], ['Create virtual disk', 'Failed'], ['Initialize disk', '']]; return null; }
        S.initialize(r.space.disk, 'GPT');
        d.space = r.space;
        d.steps = [['Gather information', 'Completed'], ['Create virtual disk', 'Completed'], ['Initialize disk', 'Completed']];
        return null;
      } });
  }

  /* ================================================================ dialogs */
  /** Add Physical Disk: poolable disks with an Allocation each (Automatic or Hot Spare). */
  function addPhysicalDisk(poolName, opts = {}) {
    const d = { disks: {} };
    return X().formDialog({ title: 'Add Physical Disk', width: 760, onCreate: f => { f.state = d; if (opts.onCreate) opts.onCreate(f); },
      content: h('div', h('p', { style: 'margin-top:0' }, `Select one or more physical disks to add to the storage pool ${poolName}:`), diskPicker(d)),
      ok: () => {
        const sel = Object.entries(d.disks);
        if (!sel.length) return 'Select at least one physical disk.';
        for (const usage of ['Automatic', 'Hot Spare']) {
          const nums = sel.filter(([, a]) => a === usage).map(([n]) => +n);
          if (nums.length) { const r = SP.addDisks(poolName, nums, ALLOC_USAGE[usage]); if (!r.ok) return r; }
        }
        return true;
      } });
  }
  /** Extend Virtual Disk: a bigger size; the volume on it can then be extended. */
  function extendVirtualDisk(name, opts = {}) {
    const v = SP.space(name);
    if (!v) return Promise.resolve(null);
    const { kv, size, field, parseSize } = X();
    const num = field('size', F.text({ value: String(Math.round(v.size / GB) + 1), width: 100 }));
    const unit = field('unit', F.select(['MB', 'GB', 'TB'], 'GB', { width: 60 }));
    return X().formDialog({ title: 'Extend Virtual Disk', width: 430, onCreate: opts.onCreate,
      content: h('div', h('p', { style: 'margin-top:0' }, `Specify the new size of the virtual disk ${v.name}.`),
        kv([['Current size:', size(v.size)], ['Free space in pool:', size(SP.pool(v.pool).free)], ['Provisioning:', v.provisioning]]),
        F.row('New size:', h('span', { style: 'display:flex;gap:6px' }, num, unit), { labelWidth: 90 })),
      ok: () => {
        const b = parseSize(num.value, unit.value, Infinity);
        if (b == null) return 'The new size is not valid. Type a number.';
        if (b <= v.size) return 'The new size must be larger than the current size.';
        return SP.resizeSpace(v.name, b);
      } });
  }
  /** Storage pool Properties: the name and description, with the pool's capacity and health. */
  function poolProperties(name, opts = {}) {
    const p = SP.pool(name);
    if (!p) return Promise.resolve(null);
    const { kv, size, field, server } = X();
    const n = field('pool-name', F.text({ value: p.name, width: 260 })), desc = field('pool-desc', F.textarea({ value: p.description, rows: 3, width: 260 }));
    const lw = { labelWidth: 120 };
    return X().formDialog({ title: `${p.name} Properties`, width: 480, onCreate: opts.onCreate,
      content: h('div', F.row('Name:', n, lw), F.row('Description:', desc, lw),
        kv([['Managed by:', server()], ['Storage subsystem:', 'Windows Storage'], ['Capacity:', size(p.size)], ['Allocated space:', size(p.allocated)], ['Free space:', size(p.free)],
          ['Physical disks:', String(p.disks.length)], ['Health status:', p.healthStatus], ['Operational status:', p.operationalStatus]])),
      ok: () => SP.setPool(p.name, { newName: n.value, description: desc.value }) });
  }

  WS.smspaces = { page, rows: { pools: poolRows, spaces: spaceRows, disks: diskRows }, menus: { pool: poolMenu, space: spaceMenu, disk: diskMenu },
    addPhysicalDisk, extendVirtualDisk, poolProperties, deletePool, deleteSpace, repairSpace, removeDisk };
  Object.assign(WS.sm, { newStoragePool, newVirtualDisk });
})();
