/* Server Manager > File and Storage Services: the sub-pages Servers, Volumes (with Disks and Storage Pools under it),
 * Shares, iSCSI and Work Folders, plus the New Volume Wizard, the New Share Wizard, share Properties and Extend Volume.
 * Everything goes through the shared models (WS.storage, WS.smb, WS.fs), so Disk Management, File Explorer, diskpart
 * and the Storage/SMB cmdlets always show the same disks, volumes and shares.
 *   WS.smfss.render(sub, ctx), subnav(el, sub, go), crumbs(sub)   used by servermanager.js for the page 'fss:<sub>'
 *   WS.smfss.selection                                            the selected row id per page, kept across repaints
 *   WS.smfss.menus.volume(row) | disk(row) | share(row)           the right-click menus (rows come from rows.*())
 *   WS.smfss.rows.volumes() | disks() | shares()                  ids 'vol:<disk>:<partition>', 'disk:<n>', 'share:<name>'
 *   WS.sm.newVolume({ disk, onCreate(w, data) })                  New Volume Wizard -> Promise<{ finished, data }>
 *   WS.sm.newShare({ volume, path, onCreate(w, data) })           New Share Wizard
 *   WS.sm.shareProperties(name, { onCreate(frame, api) })         "<share> Properties" -> Promise<bool: anything applied>
 *   WS.smfss.extendVolume(letter, { onCreate(frame) })            Extend Volume
 *   WS.smfss.advancedSecurity({ name, path, access, onCreate })   Customize permissions... -> Promise<access[] | null>
 *   WS.smfss.bringOnline(n), takeOffline(n), initialize(n), resetDisk(n), stopSharing(name), scanVolume(letter)
 * Dialogs take opts.onCreate with the live wizard / frame / sheet; controls carry data-field names for tests. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, S = WS.storage;
  const MB = S.MB, GB = S.GB, TB = 1024 * GB;
  const UNIT = { MB, GB, TB };
  const PAGES = [['servers', 'Servers'], ['volumes', 'Volumes'], ['disks', 'Disks', 'volumes'], ['pools', 'Storage Pools', 'volumes'],
    ['shares', 'Shares'], ['iscsi', 'iSCSI'], ['workfolders', 'Work Folders']];
  const selection = { volumes: null, disks: null, shares: null, pools: null };
  const server = () => WS.sys.name;
  const unc = name => `\\\\${server()}\\${name}`;
  const SEP = { separator: true };
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = (r, title = 'Server Manager') => WS.ui.msgbox({ title, icon: 'error', message: typeof r === 'string' ? r : r.error, detail: r.detail });
  const ask = (title, message) => WS.ui.msgbox({ title, icon: 'warning', message, buttons: ['Yes', 'No'] }).then(a => a === 'Yes');
  const link = (text, fn) => h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); fn(); } }, text);
  const featureName = id => (WS.catalog.features.get(id) || { name: id }).name;

  /** Server Manager's sizes: three significant digits ("126 GB", "40.0 GB", "8.00 MB"). */
  function size(b) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; b = Math.max(0, +b || 0);
    while (b >= 1000 && i < units.length - 1) { b /= 1024; i++; }
    return (b >= 100 ? String(Math.round(b)) : b >= 10 ? b.toFixed(1) : b.toFixed(2)) + ' ' + units[i];
  }
  /** Allocation unit sizes as the New Volume Wizard lists them: 512 ... 8192, then 16K, 32K, 64K ... 1M, 2M. */
  const auLabel = b => (b <= 8192 ? String(b) : b < MB ? b / 1024 + 'K' : b / MB + 'M');
  const pctBar = pct => h('div.fss-pct' + (pct >= 90 ? '.full' : ''), { title: pct + '%' }, h('div.fill', { style: { width: Math.min(100, pct) + '%' } }));
  const kv = rows => h('div.fss-kv', ...rows.flatMap(([k, v]) => [h('span.k', k), h('span', v == null ? '' : String(v))]));

  /* ================================================================ rows */
  const isSysVol = v => v.letter === 'C' || ['System', 'Recovery'].includes(v.type);
  const formatted = v => !!v.fs && v.fs !== 'RAW';
  const volName = v => (v.letter ? v.letter + ':' : v.path);
  const partId = v => `part:${v.disk}:${v.partition}`;
  /** Lettered volumes first (C:, E:...), then the ones known only by their \\?\Volume{GUID}\ path. */
  const volSort = (x, y, a, b) => (a.v.letter ? '0' + a.v.letter : '1' + a.v.path).localeCompare(b.v.letter ? '0' + b.v.letter : '1' + b.v.path);
  const volumeRows = () => S.volumes().map(v => ({ id: `vol:${v.disk}:${v.partition}`, v, volume: volName(v), status: '', label: v.label || '', prov: 'Fixed',
    capacity: v.size, free: formatted(v) ? v.free : 0, pct: formatted(v) ? Math.round(v.used / v.size * 100) : 0 }));
  const diskRows = () => S.disks().map(d => ({ id: 'disk:' + d.number, d, number: d.number, vdisk: '', status: d.online ? 'Online' : 'Offline', capacity: d.size,
    unalloc: d.style === 'RAW' ? d.size : d.unallocated, partition: d.style === 'RAW' ? 'Unknown' : d.style, ro: d.readOnly ? '✓' : '', clustered: '', subsystem: 'Windows Storage',
    bus: 'SCSI', name: d.model || 'Msft Virtual Disk' }));
  const shareRows = () => WS.smb.shares().filter(s => !s.special).map(s => ({ id: 'share:' + s.name, s, share: s.name, path: s.path, protocol: 'SMB', avail: 'Not Clustered' }));
  /** Disks Storage Spaces can pool: not the system disk and no partitions (an MSR alone does not count). */
  const poolable = () => S.disks().filter(d => !d.boot && !d.partitions.some(p => p.type !== 'Reserved'));
  const volumeOfPath = path => { const m = /^([A-Z]):/i.exec(path || ''); return m ? S.volume(m[1]) : null; };

  /* ================================================================ tiles */
  /** A Server Manager tile over a list: heading, "All x | n total", TASKS, Filter, the list (grouped under the server). */
  function tile(o) {
    const filter = h('input.inp.sm-filter', { type: 'text', placeholder: 'Filter', dataset: { field: (o.key || 'tile') + '-filter' } });
    const match = (r, q) => o.columns.some(c => String(c.value ? c.value(r) : r[c.key] == null ? '' : r[c.key]).toLowerCase().includes(q));
    const rows = () => { const q = filter.value.trim().toLowerCase(); const all = o.rows(); return q ? all.filter(r => match(r, q)) : all; };
    const lv = WS.ui.listView({ columns: o.columns, rows, getId: r => r.id, multi: false, sortKey: o.sortKey, icon: o.icon, emptyText: o.emptyText,
      groupLabel: list => (o.groupLabel ? o.groupLabel(list) : `${server()} (${list.length})`),
      onSelect: list => { if (o.key) selection[o.key] = list[0] ? list[0].id : null; if (o.onSelect) o.onSelect(list[0] || null); },
      onActivate: o.onActivate,
      onContext: (list, x, y) => { if (o.menu && list.length) WS.ui.contextMenu(x, y, o.menu(list[0])); } });
    if (o.height) lv.el.style.height = o.height + 'px';
    filter.addEventListener('input', () => lv.refresh());
    const tasksBtn = o.tasks ? h('button.sm-tasks', { dataset: { field: (o.key || 'tile') + '-tasks' } }, 'TASKS ▾') : null;
    if (tasksBtn) tasksBtn.addEventListener('click', () => WS.ui.popupMenu(tasksBtn, () => o.tasks(lv.selected()[0] || null)));
    const el = h('div.sm-sect.box', { dataset: { tile: o.title } },
      h('div.sm-shead', h('div', h('h3', o.title), h('div.sm-sub', o.sub(o.rows().length))), tasksBtn),
      o.filter === false ? null : h('div.sm-fbar', filter), lv.el);
    return { el, lv };
  }
  /** Re-select the row that was selected before the page repainted, or paint the lower tiles empty. */
  function restore(t, key, paint) {
    const id = selection[key];
    if (id && t.lv.rows().some(r => r.id === id)) t.lv.select([id]);
    else { selection[key] = null; paint(null); }
  }
  /** A tile with a message instead of a list ("There are no shares. To create a file share, start the New Share Wizard."). */
  function noteTile(title, sub, body, tasks) {
    const tasksBtn = tasks ? h('button.sm-tasks', 'TASKS ▾') : null;
    if (tasksBtn) tasksBtn.addEventListener('click', () => WS.ui.popupMenu(tasksBtn, tasks));
    return h('div.sm-sect.box', { dataset: { tile: title } },
      h('div.sm-shead', h('div', h('h3', title), sub ? h('div.sm-sub', sub) : null), tasksBtn), h('div.fss-note', ...[].concat(body)));
  }
  const cardTile = (title, sub, body) => h('div.sm-sect.box', { dataset: { tile: title } }, h('div.sm-shead', h('div', h('h3', title), h('div.sm-sub', sub || ''))), body);

  /* ================================================================ pages */
  function serversPage(c) { c.serversPage('FileAndStorage-Services'); }

  function volumesPage(c) {
    const sharesHost = h('div'), diskHost = h('div');
    const paint = r => {
      U.clear(sharesHost); U.clear(diskHost);
      const v = r && r.v;
      sharesHost.appendChild(relatedShares(v));
      diskHost.appendChild(diskCard(v ? S.disks().find(d => d.number === v.disk) : null, v ? 'volume' : null));
    };
    const t = tile({ title: 'VOLUMES', key: 'volumes', sub: n => `All volumes | ${n} total`, rows: volumeRows, sortKey: 'volume',
      icon: r => (r.v.letter === 'C' ? I.driveSystem : I.drive),
      columns: [
        { key: 'volume', label: 'Volume', width: 190, sort: volSort }, { key: 'status', label: 'Status', width: 55 }, { key: 'label', label: 'File System Label', width: 115 },
        { key: 'prov', label: 'Provisioning', width: 85 },
        { key: 'capacity', label: 'Capacity', width: 72, type: 'num', align: 'right', render: r => size(r.capacity) },
        { key: 'free', label: 'Free Space', width: 75, type: 'num', align: 'right', render: r => size(r.free) },
        { key: 'dedupRate', label: 'Deduplication Rate', width: 110, value: () => '' }, { key: 'dedupSave', label: 'Deduplication Savings', width: 128, value: () => '' },
        { key: 'pct', label: 'Percent Used', width: 95, type: 'num', render: r => pctBar(r.pct) }
      ],
      menu: volumeMenu, onSelect: paint,
      tasks: () => [{ label: 'New Volume...', action: () => newVolume() }, { label: 'Rescan Storage', action: () => rescan(c) }, SEP, { label: 'Refresh', action: c.render }] });
    c.content.append(t.el, h('div.fss-lower', sharesHost, diskHost));
    restore(t, 'volumes', paint);
  }
  function relatedShares(v) {
    const list = v && v.letter ? shareRows().filter(r => r.path.toUpperCase().startsWith(v.letter + ':')) : [];
    return tile({ title: 'SHARES', sub: () => (v ? `Related Shares | ${list.length} total` : 'Related Shares'), rows: () => list, filter: false, height: 130,
      columns: [{ key: 'share', label: 'Share', width: 120 }, { key: 'path', label: 'Local Path', width: 200 }, { key: 'protocol', label: 'Protocol', width: 70 }, { key: 'avail', label: 'Availability Type', width: 110 }],
      icon: () => I.share, menu: shareMenu, groupLabel: rows => `${server()} (${rows.length})`,
      emptyText: v ? 'No related shares exist.' : 'Select a volume to display its related shares.',
      tasks: () => [{ label: 'New Share...', disabled: !v || !v.letter || !formatted(v), action: () => newShare({ volume: v.letter }) }] }).el;
  }
  /** The DISK tile under Volumes, and the disk details shown for a selected volume. */
  function diskCard(d) {
    if (!d) return cardTile('DISK', '', h('div.fss-note', 'Select a volume to display its disk.'));
    const used = d.style === 'RAW' ? 0 : d.size - d.unallocated;
    return cardTile('DISK', `${d.model || 'Msft Virtual Disk'} on ${server()}`, h('div.fss-card', { dataset: { field: 'disk-card' } },
      h('div.hd', `Disk ${d.number}`),
      h('div.bar', h('div.fill', { style: { width: Math.round(used / d.size * 100) + '%' } })),
      h('div.kv', ...[['Status:', d.online ? 'Online' : 'Offline'], ['Capacity:', size(d.size)], ['Unallocated:', size(d.style === 'RAW' ? d.size : d.unallocated)],
        ['Partition style:', d.style === 'RAW' ? 'Unknown' : d.style], ['Read-only:', d.readOnly ? 'Yes' : 'No'], ['Bus type:', 'SCSI'], ['Subsystem:', 'Windows Storage']]
        .flatMap(([k, val]) => [h('span.k', k), h('span', val)]))));
  }

  function disksPage(c) {
    const volHost = h('div'), poolHost = h('div');
    const paint = r => {
      U.clear(volHost); U.clear(poolHost);
      const d = r && r.d;
      const list = d ? volumeRows().filter(x => x.v.disk === d.number) : [];
      volHost.appendChild(tile({ title: 'VOLUMES', sub: () => (d ? `Related Volumes | ${list.length} total` : 'Related Volumes'), rows: () => list, filter: false, height: 130,
        columns: [{ key: 'volume', label: 'Volume', width: 200, sort: volSort }, { key: 'status', label: 'Status', width: 60 }, { key: 'prov', label: 'Provisioning', width: 90 },
          { key: 'capacity', label: 'Capacity', width: 80, type: 'num', align: 'right', render: x => size(x.capacity) }, { key: 'free', label: 'Free Space', width: 80, type: 'num', align: 'right', render: x => size(x.free) }],
        icon: x => (x.v.letter === 'C' ? I.driveSystem : I.drive), menu: volumeMenu, sortKey: 'volume',
        emptyText: !d ? 'Select a disk to display its volumes.' : !d.online ? 'The disk is offline.' : 'No related volumes exist.',
        tasks: () => [{ label: 'New Volume...', disabled: !d, action: () => newVolume({ disk: d.number }) }] }).el);
      const inPool = d && poolable().some(x => x.number === d.number);
      poolHost.appendChild(cardTile('STORAGE POOL', d ? `Disk ${d.number} on ${server()}` : '', !d ? h('div.fss-note', 'Select a disk to display its storage pool.')
        : inPool ? h('div.fss-card', h('div.hd', 'Primordial'), h('div.kv', ...[['Type:', 'Available Disks'], ['Managed by:', server()], ['Available to:', server()]].flatMap(([k, v]) => [h('span.k', k), h('span', v)])))
          : h('div.fss-note', 'No related storage pool exists.')));
    };
    const t = tile({ title: 'DISKS', key: 'disks', sub: n => `All disks | ${n} total`, rows: diskRows, sortKey: 'number',
      icon: r => (r.d.online ? WS.diskmgmt.ICON.disk : WS.diskmgmt.ICON.diskDown),
      columns: [
        { key: 'number', label: 'Number', width: 70, type: 'num' }, { key: 'vdisk', label: 'Virtual Disk', width: 90 }, { key: 'status', label: 'Status', width: 70 },
        { key: 'capacity', label: 'Capacity', width: 80, type: 'num', align: 'right', render: r => size(r.capacity) },
        { key: 'unalloc', label: 'Unallocated', width: 85, type: 'num', align: 'right', render: r => size(r.unalloc) },
        { key: 'partition', label: 'Partition', width: 70 }, { key: 'ro', label: 'Read Only', width: 80 }, { key: 'clustered', label: 'Clustered', width: 70 },
        { key: 'subsystem', label: 'Subsystem', width: 120 }, { key: 'bus', label: 'Bus Type', width: 70 }, { key: 'name', label: 'Name', width: 130 }
      ],
      menu: diskMenu, onSelect: paint,
      tasks: () => [{ label: 'New Volume...', action: () => newVolume() }, { label: 'Rescan Storage', action: () => rescan(c) }, SEP, { label: 'Refresh', action: c.render }] });
    c.content.append(t.el, h('div.fss-lower', volHost, poolHost));
    restore(t, 'disks', paint);
  }

  function poolsPage(c) {
    const vdHost = h('div'), pdHost = h('div');
    const notBuilt = () => WS.apps.notImplemented('New Storage Pool Wizard');
    const paint = r => {
      U.clear(vdHost); U.clear(pdHost);
      vdHost.appendChild(noteTile('VIRTUAL DISKS', r ? `Primordial on ${server()}` : '', !r ? 'Select a storage pool to display its virtual disks.'
        : ['No related virtual disks exist.\nTo create a virtual disk, ', link('start the New Virtual Disk Wizard', () => WS.apps.notImplemented('New Virtual Disk Wizard')), '.']));
      const disks = r ? poolable() : [];
      pdHost.appendChild(tile({ title: 'PHYSICAL DISKS', sub: () => (r ? `Primordial on ${server()}` : ''), rows: () => disks.map(d => ({ id: 'pd:' + d.number, slot: '', name: `${d.model || 'Msft Virtual Disk'} (${server()})`,
        status: 'OK', capacity: d.size, bus: 'SCSI', usage: 'Auto-Select', chassis: `Integrated : Adapter 0 : Port 0 : Target 0 : LUN ${d.number}`, media: 'Unspecified', rpm: '' })),
      filter: false, height: 130, groupLabel: () => `Primordial (${disks.length})`, icon: () => WS.diskmgmt.ICON.disk, sortKey: 'name',
      columns: [{ key: 'slot', label: 'Slot', width: 40 }, { key: 'name', label: 'Name', width: 190 }, { key: 'status', label: 'Status', width: 50 },
        { key: 'capacity', label: 'Capacity', width: 75, type: 'num', align: 'right', render: x => size(x.capacity) }, { key: 'bus', label: 'Bus', width: 50 }, { key: 'usage', label: 'Usage', width: 85 },
        { key: 'chassis', label: 'Chassis', width: 260 }, { key: 'media', label: 'Media Type', width: 85 }, { key: 'rpm', label: 'RPM', width: 50 }],
      emptyText: r ? 'No physical disks are available.' : 'Select a storage pool to display its physical disks.' }).el);
    };
    const rows = () => { const d = poolable(); return d.length ? [{ id: 'pool:primordial', name: 'Primordial', type: 'Available Disks', managedBy: server(), availableTo: server(), rw: '', capacity: d.reduce((a, x) => a + x.size, 0), free: '', alloc: '', status: '' }] : []; };
    const t = tile({ title: 'STORAGE POOLS', key: 'pools', sub: n => `Storage Spaces | ${n} total`, rows, sortKey: 'name', groupLabel: list => `Windows Storage (${server()}) (${list.length})`,
      icon: () => WS.diskmgmt.ICON.app, emptyText: 'No storage pools exist.',
      columns: [{ key: 'name', label: 'Name', width: 140 }, { key: 'type', label: 'Type', width: 110 }, { key: 'managedBy', label: 'Managed by', width: 100 }, { key: 'availableTo', label: 'Available to', width: 100 },
        { key: 'rw', label: 'Read-Write Server', width: 120 }, { key: 'capacity', label: 'Capacity', width: 80, type: 'num', align: 'right', render: r => size(r.capacity) },
        { key: 'free', label: 'Free Space', width: 80 }, { key: 'alloc', label: 'Percent Allocated', width: 120 }, { key: 'status', label: 'Status', width: 70 }],
      menu: () => [{ label: 'New Storage Pool...', action: notBuilt }], onSelect: paint,
      tasks: () => [{ label: 'New Storage Pool...', action: notBuilt }, { label: 'Rescan Storage', action: () => rescan(c) }, SEP, { label: 'Refresh', action: c.render }] });
    c.content.append(t.el, h('div.fss-lower', vdHost, pdHost));
    restore(t, 'pools', paint);
  }

  function sharesPage(c) {
    const quotaHost = h('div'), volHost = h('div');
    const fsrm = WS.features.isInstalled('FS-Resource-Manager');
    const paint = r => {
      U.clear(quotaHost); U.clear(volHost);
      quotaHost.appendChild(noteTile('QUOTA', r ? `${r.share} on ${server()}` : '', !fsrm
        ? ['To use quotas, File Server Resource Manager must be installed on the server.\nTo install File Server Resource Manager, ', link('start the Add Roles and Features Wizard', () => WS.sm.addRoles()), '.']
        : r ? 'No quotas are configured for the selected share.' : 'Select a share to display its quotas.'));
      volHost.appendChild(volumeCard(r ? volumeOfPath(r.path) : null, c, !!r));
    };
    const t = tile({ title: 'SHARES', key: 'shares', sub: n => `All shares | ${n} total`, rows: shareRows, sortKey: 'share', icon: () => I.share,
      columns: [{ key: 'share', label: 'Share', width: 160 }, { key: 'path', label: 'Local Path', width: 320 }, { key: 'protocol', label: 'Protocol', width: 80 }, { key: 'avail', label: 'Availability Type', width: 130 }],
      emptyText: () => h('div', h('div', 'There are no shares.'), h('div', 'To create a file share, ', link('start the New Share Wizard', () => newShare()), '.')),
      menu: shareMenu, onSelect: paint, onActivate: r => shareProperties(r.share),
      tasks: () => [{ label: 'New Share...', action: () => newShare() }, SEP, { label: 'Refresh', action: c.render }] });
    c.content.append(t.el, h('div.fss-lower', quotaHost, volHost));
    restore(t, 'shares', paint);
  }
  /** The VOLUME tile under Shares: the share's volume, its usage, and "Go to Volumes Overview >". */
  function volumeCard(v, c, picked) {
    if (!v) return cardTile('VOLUME', '', h('div.fss-note', picked ? 'The volume for this share is not available.' : 'Select a share to display its volume.'));
    const pct = Math.round(v.used / v.size * 100);
    return cardTile('VOLUME', `${v.letter}: on ${server()}`, h('div.fss-card', { dataset: { field: 'volume-card' } },
      h('div.hd', `(${v.letter}:) ${v.label || 'Local Disk'}`),
      h('div.bar', h('div.fill', { style: { width: pct + '%' } })), h('div', `${pct}% Used`),
      h('div.kv', ...[['Capacity:', size(v.size)], ['Used Space:', size(v.used)], ['Free Space:', size(v.free)]].flatMap(([k, val]) => [h('span.k', k), h('span', val)])),
      h('div.go', link('Go to Volumes Overview >', () => { selection.volumes = `vol:${v.disk}:${v.partition}`; c.go('fss:volumes'); }))));
  }

  function iscsiPage(c) {
    const on = WS.features.isInstalled('FS-iSCSITarget-Server');
    const wizard = () => WS.apps.notImplemented('New iSCSI Virtual Disk Wizard');
    c.content.appendChild(noteTile('iSCSI VIRTUAL DISKS', 'All iSCSI virtual disks | 0 total', on
      ? ['There are no iSCSI virtual disks.\nTo create an iSCSI virtual disk, ', link('start the New iSCSI Virtual Disk Wizard', wizard), '.']
      : ['To create an iSCSI virtual disk, you must install iSCSI Target Server on at least one server in the server pool.\nTo install iSCSI Target Server, ', link('start the Add Roles and Features Wizard', () => WS.sm.addRoles()), '.'],
    () => [{ label: 'New iSCSI Virtual Disk...', disabled: !on, action: wizard }, SEP, { label: 'Refresh', action: c.render }]));
  }
  function workFoldersPage(c) {
    const on = WS.features.isInstalled('FS-SyncShareService');
    const wizard = () => WS.apps.notImplemented('New Sync Share Wizard');
    c.content.appendChild(noteTile('WORK FOLDERS', 'All sync shares | 0 total', on
      ? ['There are no sync shares.\nTo create a sync share for Work Folders, ', link('start the New Sync Share Wizard', wizard), '.']
      : ['To use Work Folders, you must install Work Folders on at least one server in the server pool.\nTo install Work Folders, ', link('start the Add Roles and Features Wizard', () => WS.sm.addRoles()), '.'],
    () => [{ label: 'New Sync Share...', disabled: !on, action: wizard }, SEP, { label: 'Refresh', action: c.render }]));
  }

  async function rescan(c) { await U.sleep(300); c.render(); }

  /* ================================================================ menus and commands */
  function volumeMenu(r) {
    if (!r) return [];
    const v = r.v, sys = isSysVol(v), id = partId(v);
    const lim = v.letter ? S.supportedSize(v.letter) : null;
    return [
      { label: 'New Share...', disabled: !v.letter || !formatted(v), action: () => newShare({ volume: v.letter }) },
      { label: 'New iSCSI Virtual Disk...', disabled: !v.letter || !WS.features.isInstalled('FS-iSCSITarget-Server'), action: () => WS.apps.notImplemented('New iSCSI Virtual Disk Wizard') },
      { label: 'Scan File System for Errors', disabled: !formatted(v), action: () => scanVolume(v) },
      { label: 'Repair File System Errors', disabled: true },
      { label: 'Manage Drive Letter and Access Paths...', disabled: sys, action: () => WS.diskmgmt.changeLetter(id) },
      { label: 'Format...', disabled: sys, action: () => WS.diskmgmt.format(id) },
      { label: 'Extend Volume...', disabled: !lim || !formatted(v) || ['System', 'Recovery'].includes(v.type) || lim.max - v.size < MB, action: () => extendVolume(v.letter) },
      { label: 'Delete Volume', disabled: sys, action: () => WS.diskmgmt.deleteVolume(id) },
      { label: 'Configure Data Deduplication...', disabled: sys || !WS.features.isInstalled('FS-Data-Deduplication'), action: () => WS.apps.notImplemented('Deduplication Settings') },
      SEP,
      { label: 'Properties', disabled: !v.letter, action: () => WS.diskmgmt.volumeProperties(id) }
    ];
  }
  function diskMenu(r) {
    if (!r) return [];
    const d = r.d;
    return [
      { label: 'New Volume...', disabled: d.readOnly, action: () => newVolume({ disk: d.number }) },
      { label: 'Bring Online', disabled: d.online, action: () => bringOnline(d.number) },
      { label: 'Take Offline', disabled: !d.online || d.boot, action: () => takeOffline(d.number) },
      { label: 'Initialize', disabled: !d.online || d.style !== 'RAW', action: () => initialize(d.number) },
      { label: 'Reset Disk', disabled: !d.online || d.boot || d.style === 'RAW', action: () => resetDisk(d.number) }
    ];
  }
  function shareMenu(r) {
    if (!r) return [];
    return [
      { label: 'Open Share', action: () => WS.apps.launch('explorer', { path: r.path }) },
      { label: 'Stop Sharing', action: () => stopSharing(r.share) },
      { label: 'Configure Quota...', disabled: true },
      SEP,
      { label: 'Properties', action: () => shareProperties(r.share) }
    ];
  }

  async function bringOnline(n) {
    if (!(await ask('Bring Disk Online', 'If the disk is online on another server, bringing it online on this server might cause data loss. Are you sure you want to bring this disk online?'))) return false;
    const r = S.setOnline(n, true);
    if (!r.ok) { await err(r, 'Bring Disk Online'); return false; }
    return true;
  }
  async function takeOffline(n) {
    if (!(await ask('Take Disk Offline', 'Taking the disk offline makes its volumes unavailable to users and applications. Are you sure you want to take this disk offline?'))) return false;
    const r = S.setOnline(n, false);
    if (!r.ok) { await err(r, 'Take Disk Offline'); return false; }
    return true;
  }
  async function initialize(n) {
    if (!(await ask('Initialize Disk', 'Initializing the disk erases all data on it and initializes it as a GPT disk. Are you sure you want to continue?'))) return false;
    const r = S.initialize(n, 'GPT');
    if (!r.ok) { await err(r, 'Initialize Disk'); return false; }
    return true;
  }
  async function resetDisk(n) {
    if (!(await ask('Reset Disk', 'Resetting the disk erases all data on it and returns it to an uninitialized state. Are you sure you want to continue?'))) return false;
    const r = S.clearDisk(n);
    if (!r.ok) { await err(r, 'Reset Disk'); return false; }
    return true;
  }
  async function stopSharing(name) {
    const s = WS.smb.get(name);
    if (!s) return false;
    if (!(await ask('Stop Sharing', `If you stop sharing ${s.name}, users who are connected to it will be disconnected and might lose data. Are you sure you want to stop sharing ${s.name}?`))) return false;
    const r = WS.smb.removeShare(s.name);
    if (!r.ok) { await err(r, 'Stop Sharing'); return false; }
    return true;
  }
  async function scanVolume(v) {
    if (typeof v === 'string') v = S.volume(v);
    if (!v) return;
    await U.sleep(200);
    await WS.ui.msgbox({ title: 'Scan File System for Errors', icon: 'info', message: `Volume ${volName(v)} (${v.fs})`, detail: 'Windows has scanned the file system and found no problems.\nNo further action is required.' });
  }

  /** A small modal with OK/Cancel; ok() returns an error (string / {ok:false}) to keep it open, false to stay quietly. */
  function formDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 400, className: 'w32-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32', o.content));
    const ok = async () => {
      const r = await o.ok();
      if (r === false) return;
      if (typeof r === 'string' || (r && r.ok === false)) { await err(r, o.title); return; }
      frame.close(r === undefined ? true : r);
    };
    frame.footer.append(h('button.btn.primary', { onClick: ok }, 'OK'), h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = ok; frame.onEscape = () => frame.close(null);
    frame.ok = ok;
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }
  /** A size typed in MB/GB/TB; a value that is within display rounding of the maximum means the maximum. */
  function parseSize(text, unit, max) {
    if (!/^\s*\d+([.,]\d+)?\s*$/.test(String(text))) return null;
    let b = Math.round(parseFloat(String(text).replace(',', '.')) * UNIT[unit]);
    if (b > max && b - max <= 0.05 * UNIT[unit]) b = max;
    return b;
  }
  const floor2 = x => String(Math.floor(x * 100) / 100);

  /** Extend Volume: the current and maximum size, and the new size. */
  function extendVolume(letter, opts = {}) {
    const v = S.volume(letter), lim = S.supportedSize(letter);
    if (!v || !lim) return Promise.resolve(null);
    const unit = field('unit', F.select(['MB', 'GB', 'TB'], lim.max >= GB ? 'GB' : 'MB', { width: 60 }));
    const offered = floor2(lim.max / UNIT[unit.value]), offeredUnit = unit.value;
    const num = field('size', F.text({ value: offered, width: 100 }));
    return formDialog({ title: 'Extend Volume', width: 420, onCreate: opts.onCreate,
      content: h('div', h('p', { style: 'margin-top:0' }, `Specify the new size of volume ${letter.toUpperCase()}: on ${server()}.`),
        kv([['Current size:', size(v.size)], ['Maximum size:', size(lim.max)]]),
        F.row('New size:', h('span', { style: 'display:flex;gap:6px' }, num, unit), { labelWidth: 90 })),
      ok: () => {
        const b = num.value.trim() === offered && unit.value === offeredUnit ? lim.max : parseSize(num.value, unit.value, lim.max);
        if (b == null) return 'The new size is not valid. Type a number.';
        if (b <= v.size) return 'The new size must be larger than the current size.';
        if (b > lim.max) return `The new size can't be larger than the maximum size (${size(lim.max)}).`;
        return S.resize(letter, b);
      } });
  }

  /* ================================================================ New Volume Wizard */
  function newVolume(opts = {}) {
    const open = WS.wm.find('newvolume');
    if (open) { open.restore(); return Promise.resolve(null); }
    const d = { disk: opts.disk != null ? +opts.disk : null, value: '', unit: 'GB', sizeFor: null, bytes: 0, assign: 'letter', letter: null, folder: '',
      fs: 'NTFS', au: 0, label: 'New Volume', shortNames: false, steps: null, error: null, volume: null };
    const disk = () => S.disks().find(x => x.number === d.disk) || null;
    /** What a volume can use: the largest free extent, or a blank disk once it is initialized as GPT (MSR + headers = 18 MB). */
    const avail = x => (!x ? 0 : x.style === 'RAW' ? x.size - 18 * MB : x.largestFree);
    const STEPS = ['Gather information', 'Create new partition', 'Format volume', 'Add access path', 'Update cache'];
    const pages = [
      { id: 'before', nav: 'Before You Begin', title: 'Before you begin',
        render: () => h('div.wz-text', h('p', 'This wizard helps you create a volume, assign it a drive letter or folder, and then format it with a file system.'),
          h('p', 'You can create a volume on a physical disk or a virtual disk. A virtual disk is a collection of one or more physical disks from a previously created storage pool. The layout of data across the physical disks can increase the reliability and performance of the volume.'),
          h('p', 'To continue, click Next.')) },
      { id: 'disk', nav: 'Server and Disk', title: 'Select the server and disk', rerender: true,
        render: () => {
          const srv = WS.ui.listView({ columns: [{ key: 'name', label: 'Provision to', width: 170 }, { key: 'status', label: 'Status', width: 90 }, { key: 'cluster', label: 'Cluster Role', width: 120 }, { key: 'dest', label: 'Destination', width: 110 }],
            rows: [{ id: 'local', name: server(), status: 'Online', cluster: 'Not Clustered', dest: 'Local' }], multi: false });
          srv.el.style.height = '68px';
          srv.select(['local']);
          const lv = WS.ui.listView({ multi: false, sortKey: 'n', icon: () => WS.diskmgmt.ICON.disk,
            columns: [{ key: 'n', label: 'Disk', width: 80, type: 'num', render: r => 'Disk ' + r.n }, { key: 'vdisk', label: 'Virtual Disk', width: 100 },
              { key: 'capacity', label: 'Capacity', width: 90, type: 'num', align: 'right', render: r => size(r.capacity) }, { key: 'free', label: 'Free Space', width: 90, type: 'num', align: 'right', render: r => size(r.free) },
              { key: 'status', label: 'Status', width: 90 }, { key: 'sub', label: 'Subsystem', width: 130 }],
            rows: () => S.disks().map(x => ({ id: 'disk:' + x.number, n: x.number, vdisk: '', capacity: x.size, free: avail(x), status: x.online ? 'Online' : 'Offline', sub: 'Windows Storage' })),
            onSelect: rows => { d.disk = rows[0] ? rows[0].n : null; } });
          lv.el.style.height = '150px';
          lv.el.dataset.field = 'disks';
          if (d.disk == null) { const first = S.disks().find(x => avail(x) >= 8 * MB); if (first) d.disk = first.number; }
          if (d.disk != null) lv.select(['disk:' + d.disk]);
          return h('div.wz-text.fss-wz', h('div.wz-section', 'Server:'), srv.el, h('div.wz-section', 'Disk:'), lv.el);
        },
        validate: async () => {
          const x = disk();
          if (!x) return 'Select a disk.';
          if (x.readOnly) return 'The selected disk is read-only.';
          if (avail(x) < 8 * MB) return 'There is not enough free space on the selected disk to create a volume.';
          if (!x.online || x.style === 'RAW') {
            const message = !x.online && x.style === 'RAW' ? 'The selected disk will be brought online and initialized as a GPT disk.'
              : !x.online ? 'The selected disk will be brought online.' : 'The selected disk will be initialized as a GPT disk.';
            if ((await WS.ui.msgbox({ title: 'Offline or Uninitialized Disk', icon: 'info', message, buttons: ['OK', 'Cancel'] })) !== 'OK') return false;
            if (!x.online) { const r = S.setOnline(x.number, true); if (!r.ok) return r; }
            if (x.style === 'RAW') { const r = S.initialize(x.number, 'GPT'); if (!r.ok) return r; }
          }
          return null;
        } },
      { id: 'size', nav: 'Size', title: 'Specify the size of the volume', rerender: true,
        render: () => {
          const max = avail(disk());
          if (d.sizeFor !== d.disk) { d.unit = max >= GB ? 'GB' : 'MB'; d.value = d.offered = floor2(max / UNIT[d.unit]); d.offeredUnit = d.unit; d.sizeFor = d.disk; }
          const num = field('size', F.text({ value: d.value, width: 100 }));
          const unit = field('unit', F.select(['MB', 'GB', 'TB'], d.unit, { width: 60, onChange: v => { d.unit = v; } }));
          num.addEventListener('input', () => { d.value = num.value; });
          return h('div.wz-text.fss-wz', kv([['Available Capacity:', size(max)], ['Minimum size:', size(8 * MB)]]),
            F.row('Volume size:', h('span', { style: 'display:flex;gap:6px' }, num, unit), { labelWidth: 110 }));
        },
        validate: () => {
          const max = avail(disk());
          // the offered size is the available capacity rounded down for display; left as it is, it means all of it
          const b = String(d.value).trim() === d.offered && d.unit === d.offeredUnit ? max : parseSize(d.value, d.unit, max);
          if (b == null) return 'The volume size is not valid. Type a number.';
          if (b < 8 * MB) return `The volume size must be at least ${size(8 * MB)}.`;
          if (b > max) return `The volume size can't be larger than the available capacity (${size(max)}).`;
          d.bytes = b;
          return null;
        } },
      { id: 'letter', nav: 'Drive Letter or Folder', title: 'Assign to a drive letter or folder', rerender: true,
        render: () => {
          const g = U.uid('nvl'), free = S.freeLetters();
          if (!d.letter || !free.includes(d.letter)) d.letter = S.nextLetter();
          let paint = () => {};
          const radio = (key, label) => field('assign-' + key, F.radio(g, label, d.assign === key, { onChange: v => { if (v) { d.assign = key; paint(); } } }));
          const rL = radio('letter', 'Drive letter:'), rF = radio('folder', 'The following folder:'), rN = radio('none', "Don't assign to a drive letter or folder.");
          const letter = field('letter', F.select(free, d.letter, { width: 60, onChange: v => { d.letter = v; } }));
          const folder = field('folder', F.text({ value: d.folder, width: 260 }));
          folder.addEventListener('input', () => { d.folder = folder.value; });
          const browse = F.button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: folder.value || 'C:\\' }); if (p) { folder.value = p; d.folder = p; } });
          paint = () => { letter.disabled = d.assign !== 'letter'; folder.disabled = browse.disabled = d.assign !== 'folder'; };
          paint();
          const line = (...k) => h('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, ...k);
          return h('div.wz-text.fss-wz', h('p', 'Select whether to assign the volume to a drive letter or a folder. When you assign a volume to a folder, the volume appears as a folder within a drive, such as D:\\UserData.'),
            h('div', 'Assign to:'), line(rL, letter), line(rF, folder, browse), line(rN));
        },
        validate: () => (d.assign === 'folder' ? 'Mounting a volume in an empty NTFS folder is not available in the lab simulator. Assign a drive letter instead.'
          : d.assign === 'letter' && !d.letter ? 'Select a drive letter.' : null) },
      { id: 'fs', nav: 'File System Settings', title: 'Select file system settings',
        render: () => {
          const fs = field('fs', F.select(['NTFS', 'ReFS'], d.fs, { width: 200 }));
          const au = field('au', F.select([], '0', { width: 200 }));
          const label = field('label', F.text({ value: d.label, width: 200, maxLength: 32 }));
          const short = field('shortnames', F.checkbox('Generate short file names (not recommended)', d.shortNames, { onChange: v => { d.shortNames = v; } }));
          const fill = () => {
            U.clear(au);
            au.appendChild(h('option', { value: '0' }, 'Default'));
            for (const b of S.AU[fs.value].slice().sort((x, y) => x - y)) au.appendChild(h('option', { value: String(b) }, auLabel(b)));
            if (!S.AU[fs.value].includes(d.au)) d.au = 0;
            au.value = String(d.au);
            short.input.disabled = fs.value === 'ReFS';
            if (fs.value === 'ReFS') { short.checked = false; d.shortNames = false; }
          };
          fs.addEventListener('change', () => { d.fs = fs.value; fill(); });
          au.addEventListener('change', () => { d.au = +au.value; });
          label.addEventListener('input', () => { d.label = label.value; });
          fill();
          const lw = { labelWidth: 150 };
          return h('div.wz-text.fss-wz', F.row('File system:', fs, lw), F.row('Allocation unit size:', au, lw), F.row('Volume label:', label, lw),
            h('div', { style: 'margin-top:14px' }, short),
            h('p', { style: 'margin:4px 0 0 22px;color:#555' }, 'Short file names (8 characters with 3-character extensions) are required for some 16-bit applications running on client computers, but make file operations slower.'));
        },
        validate: () => (d.label.length > 32 ? 'The volume label is not valid. Please enter a valid volume label.' : null) },
      { id: 'confirm', nav: 'Confirmation', title: 'Confirm selections', finish: true, rerender: true,
        render: () => {
          const x = disk();
          return h('div.wz-text.fss-wz', h('p', 'Confirm that the following are the correct settings, and then click Create.'),
            h('div.wz-section', 'VOLUME LOCATION'), kv([['Server:', server()], ['Subsystem:', 'Windows Storage'], ['Disk:', `Disk ${x.number} ${x.model || 'Msft Virtual Disk'}`], ['Free space:', size(avail(x))]]),
            h('div.wz-section', 'VOLUME PROPERTIES'), kv([['Volume size:', size(d.bytes)], ['Drive letter or folder:', d.assign === 'letter' ? d.letter + ':\\' : 'None'], ['Volume label:', d.label]]),
            h('div.wz-section', 'FILE SYSTEM SETTINGS'), kv([['File system:', d.fs], ['Short file name creation:', d.shortNames ? 'Enabled' : 'Disabled'], ['Allocation unit size:', d.au ? auLabel(d.au) : 'Default']]));
        } },
      { id: 'results', nav: 'Results', title: 'Completion', rerender: true,
        render: () => results(d, 'You have successfully completed the New Volume Wizard.') }
    ];
    return WS.ui.wizard({ title: 'New Volume Wizard', style: 'server', asWindow: true, app: 'newvolume', icon: WS.diskmgmt.ICON.app, width: 820, height: 580,
      destination: ' ', finishLabel: 'Create', pages, data: d,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, d); },
      onFinish: async () => {
        const x = disk();
        const region = S.freeRegions(x.number).reduce((b, r) => (r.size > b.size ? r : b), { offset: 0, size: 0 });
        await U.sleep(200);
        const r = S.newVolume(x.number, { size: d.bytes >= region.size ? 'max' : d.bytes, offset: region.offset, letter: d.assign === 'letter' ? d.letter : null,
          fs: d.fs, label: d.label, au: d.au, shortNames: d.shortNames });
        if (!r.ok) { d.error = r.error; d.steps = STEPS.map((s, i) => [s, i === 0 ? 'Completed' : i === 1 ? 'Failed' : '']); return null; }
        d.volume = r.volume;
        d.steps = STEPS.map(s => [s, 'Completed']);
        return null;
      } });
  }
  /** A Results page: the outcome and the Task / Progress / Status table. */
  function results(d, success) {
    return h('div.wz-text.fss-wz',
      d.error ? h('div.wz-banner.err', h('span', { html: I.eventError }), h('div.t', d.error)) : h('div.wz-banner.ok', h('span', { html: I.enable }), h('div.t', success)),
      h('div.fss-tasks', { dataset: { field: 'results' } }, h('div.r.h', h('span', 'Task'), h('span', 'Progress'), h('span', 'Status')),
        ...(d.steps || []).map(([task, status]) => h('div.r', h('span', task), h('span', status ? h('div.fss-pct.task' + (status === 'Completed' ? '' : '.failed'), h('div.fill', { style: { width: status === 'Completed' ? '100%' : '0' } })) : ''), h('span' + (status === 'Completed' ? '.ok' : status ? '.bad' : ''), status)))));
  }

  /* ================================================================ New Share Wizard */
  const PROFILES = [
    { id: 'smb-quick', label: 'SMB Share - Quick', desc: 'This basic profile represents the fastest way to create an SMB file share, typically used to share files with Windows-based computers.\n\n• Suitable for general file sharing\n• Advanced options can be configured later by using the Properties dialog' },
    { id: 'smb-adv', label: 'SMB Share - Advanced', requires: ['FS-Resource-Manager'], unsupported: true, desc: 'This advanced profile offers additional options to configure an SMB file share.\n\n• Set the folder owners for access-denied assistance\n• Configure default classification of data in the folder for management and access policies\n• Enable quotas' },
    { id: 'smb-app', label: 'SMB Share - Applications', desc: 'This profile creates an SMB file share with settings appropriate for Hyper-V, certain databases, and other server applications.' },
    { id: 'nfs-quick', label: 'NFS Share - Quick', requires: ['FS-NFS-Service'], unsupported: true, desc: 'This basic profile represents the fastest way to create an NFS file share, typically used to share files with UNIX-based computers.\n\n• Suitable for general file sharing\n• Advanced options can be configured later by using the Properties dialog' },
    { id: 'nfs-adv', label: 'NFS Share - Advanced', requires: ['FS-NFS-Service', 'FS-Resource-Manager'], unsupported: true, desc: 'This advanced profile offers additional options to configure an NFS file share.\n\n• Set the folder owners for access-denied assistance\n• Configure default classification of data in the folder for management and access policies\n• Enable quotas' }
  ];
  const RLABEL = { Full: 'Full Control', Change: 'Change', Read: 'Read' };
  const shareSummary = access => (access.length ? access.map(a => `${a.account.replace(/^BUILTIN\\/, '')} ${a.type === 'Deny' ? 'Deny ' : ''}${RLABEL[a.right] || a.right}`).join(', ') : 'None');
  /** The folder's NTFS permissions: what a new folder inherits (ACLs are not modelled, so this list is fixed). */
  const FOLDER_ACL = [
    ['Allow', 'BUILTIN\\Administrators', 'Full Control', 'This folder, subfolders, and files'],
    ['Allow', 'NT AUTHORITY\\SYSTEM', 'Full Control', 'This folder, subfolders, and files'],
    ['Allow', 'CREATOR OWNER', 'Full Control', 'Subfolders and files only'],
    ['Allow', 'BUILTIN\\Users', 'Read & Execute', 'This folder, subfolders, and files'],
    ['Allow', 'BUILTIN\\Users', 'Special', 'This folder and subfolders']
  ];
  function aclList(inherited) {
    const lv = WS.ui.listView({ multi: false, sortKey: null, rows: FOLDER_ACL.map(([type, principal, access, applies], i) => ({ id: String(i), type, principal, access, applies, from: inherited || '' })),
      columns: [{ key: 'type', label: 'Type', width: 60 }, { key: 'principal', label: 'Principal', width: 190 }, { key: 'access', label: 'Access', width: 110 },
        ...(inherited != null ? [{ key: 'from', label: 'Inherited from', width: 100 }] : []), { key: 'applies', label: 'Applies To', width: 220 }] });
    lv.el.style.height = '130px'; lv.el.style.border = '1px solid #ababab';
    return lv.el;
  }
  /** Customize permissions...: Advanced Security Settings with the Permissions (inherited, read-only) and Share tabs. */
  function advancedSecurity(o) {
    const leaf = String(o.path || '').replace(/\\$/, '').split('\\').pop() || o.path;
    let ed = null, result = null;
    return WS.ui.propertySheet({ title: `Advanced Security Settings for ${leaf}`, width: 640, onCreate: sh => { if (o.onCreate) o.onCreate(sh, () => ed); },
      tabs: [
        { label: 'Permissions', render: () => h('div.w32', kv([['Name:', o.path], ['Owner:', `Administrators (${WS.sys.isDC() ? WS.ad.netbios() : server()}\\Administrators)`]]),
          h('div', { style: 'margin:6px 0' }, 'Permission entries:'), aclList(o.path.replace(/\\[^\\]*$/, '') + '\\'),
          h('div', { style: 'display:flex;gap:6px;margin-top:6px' }, F.button('Add', () => {}, { disabled: true }), F.button('Remove', () => {}, { disabled: true }), F.button('View', () => {}, { disabled: true }), F.button('Disable inheritance', () => {}, { disabled: true })),
          F.note('Folder (NTFS) permissions are not modelled in the lab simulator, so the folder keeps the permissions it inherits. Use the Share tab to set who can reach the share over the network.')) },
        { label: 'Share', render: sh => {
          ed = WS.fsmgmt.permEditor(o.access, { onChange: () => sh.setDirty() });
          return h('div.w32', h('div', { style: 'margin-bottom:6px' }, `Network location for this share: ${unc(o.name || leaf)}`), ed.el);
        }, apply: () => { result = ed.access(); return null; } }
      ] }).then(applied => (applied ? result : null));
  }

  function newShare(opts = {}) {
    const open = WS.wm.find('newshare');
    if (open) { open.restore(); return Promise.resolve(null); }
    const vols = () => S.volumes().filter(v => v.letter && formatted(v));
    const d = { profile: 'smb-quick', mode: opts.path ? 'custom' : 'volume', volume: null, custom: opts.path || '', name: '', nameTouched: false, desc: '',
      abe: false, cache: true, encrypt: false, access: [{ account: 'Everyone', right: 'Full', type: 'Allow' }], steps: null, error: null, share: null };
    const pick = String(opts.volume || '').toUpperCase().replace(/[:\\]/g, '');
    d.volume = (vols().find(v => v.letter === pick) || vols()[0] || {}).letter || null;
    const prof = () => PROFILES.find(p => p.id === d.profile);
    const missing = () => (prof().requires || []).filter(id => !WS.features.isInstalled(id));
    const trim = p => String(p || '').trim().replace(/[\\/]+$/, '').replace(/\//g, '\\') || '';
    const localPath = () => (d.mode === 'custom' ? WS.fs.full(trim(d.custom) || 'C:\\') : `${d.volume}:\\Shares\\${d.name.trim()}`);
    const pages = [
      { id: 'profile', nav: 'Select Profile', title: 'Select the profile for this share',
        render: () => {
          const list = h('div.fss-plist', { tabIndex: 0, dataset: { field: 'profiles' } }), desc = h('div.fss-pdesc');
          const choose = id => { if (d.profile !== id) { d.profile = id; d.cache = id !== 'smb-app'; } paint(); };
          const paint = () => {
            U.clear(list);
            for (const p of PROFILES) list.appendChild(h('div' + (p.id === d.profile ? '.sel' : ''), { dataset: { profile: p.id }, onPointerdown: () => choose(p.id) }, p.label));
            desc.textContent = prof().desc;
          };
          list.addEventListener('keydown', e => {
            const i = PROFILES.findIndex(p => p.id === d.profile);
            if (e.key === 'ArrowDown' && i < PROFILES.length - 1) { choose(PROFILES[i + 1].id); e.preventDefault(); }
            else if (e.key === 'ArrowUp' && i > 0) { choose(PROFILES[i - 1].id); e.preventDefault(); }
          });
          paint();
          return h('div.wz-text.fss-wz', h('div.fss-profiles', h('div', h('div.wz-coltitle', 'File share profile:'), list), h('div', h('div.wz-coltitle', 'Description:'), desc)));
        } },
      { id: 'location', nav: 'Share Location', title: 'Select the server and path for this share', rerender: true,
        render: () => {
          const miss = missing();
          const srv = WS.ui.listView({ multi: false, columns: [{ key: 'name', label: 'Server Name', width: 150 }, { key: 'status', label: 'Status', width: 260 }, { key: 'cluster', label: 'Cluster Role', width: 110 }, { key: 'owner', label: 'Owner Node', width: 100 }],
            rows: [{ id: 'local', name: server(), status: miss.length ? `${miss.map(featureName).join(' and ')} is not installed` : 'Online', cluster: 'Not Clustered', owner: '' }] });
          srv.el.style.height = '68px'; srv.select(['local']);
          const g = U.uid('nsl');
          let paint = () => {};
          const rV = field('by-volume', F.radio(g, 'Select by volume:', d.mode === 'volume', { onChange: v => { if (v) { d.mode = 'volume'; paint(); } } }));
          const rC = field('by-path', F.radio(g, 'Type a custom path:', d.mode === 'custom', { onChange: v => { if (v) { d.mode = 'custom'; paint(); } } }));
          const lv = WS.ui.listView({ multi: false, sortKey: 'volume', icon: r => (r.volume === 'C:' ? I.driveSystem : I.drive),
            columns: [{ key: 'volume', label: 'Volume', width: 90 }, { key: 'free', label: 'Free Space', width: 90, type: 'num', align: 'right', render: r => size(r.free) },
              { key: 'capacity', label: 'Capacity', width: 90, type: 'num', align: 'right', render: r => size(r.capacity) }, { key: 'fs', label: 'File System', width: 90 }],
            rows: () => vols().map(v => ({ id: 'vol:' + v.letter, letter: v.letter, volume: v.letter + ':', free: v.free, capacity: v.size, fs: v.fs })),
            onSelect: rows => { if (rows[0]) d.volume = rows[0].letter; } });
          lv.el.style.height = '110px'; lv.el.dataset.field = 'volumes';
          if (d.volume) lv.select(['vol:' + d.volume]);
          const path = field('custom-path', F.text({ value: d.custom, width: 330 }));
          path.addEventListener('input', () => { d.custom = path.value; });
          const browse = F.button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: path.value.trim() || 'C:\\' }); if (p) { path.value = p; d.custom = p; } });
          paint = () => { path.disabled = browse.disabled = d.mode !== 'custom'; lv.el.classList.toggle('disabled', d.mode !== 'volume'); };
          paint();
          return h('div.wz-text.fss-wz', h('div.wz-section', 'Server:'), srv.el,
            h('div.wz-section', 'Share location:'), rV, h('div', { style: 'margin-left:22px' }, lv.el,
              h('div', { style: 'margin:4px 0 8px;color:#555' }, 'The location of the file share will be a new folder in the \\Shares directory on the selected volume.')),
            rC, h('div', { style: 'margin-left:22px;display:flex;gap:6px' }, path, browse));
        },
        validate: () => {
          const p = prof(), miss = missing();
          if (miss.length) return `To create a share with the ${p.label} profile, ${miss.map(featureName).join(' and ')} must be installed on ${server()}. To install it, start the Add Roles and Features Wizard.`;
          if (p.unsupported) return `The ${p.label} profile is not available in the lab simulator. Choose SMB Share - Quick or SMB Share - Applications.`;
          if (d.mode === 'volume') return d.volume && vols().some(v => v.letter === d.volume) ? null : 'Select a volume.';
          const c = trim(d.custom);
          if (!/^[A-Za-z]:(\\|$)/.test(c) || !WS.fs.isDir(c.slice(0, 2) + '\\')) return `The path "${d.custom}" is not valid. Type a local path, such as D:\\Shares\\Sales.`;
          const st = WS.fs.stat(c);
          if (st && st.type !== 'dir') return `The path "${d.custom}" is a file. Type the path of a folder.`;
          if (!d.nameTouched) d.name = c.length > 3 ? c.split('\\').pop() : '';
          return null;
        } },
      { id: 'name', nav: 'Share Name', title: 'Specify share name', rerender: true,
        render: () => {
          const name = field('share-name', F.text({ value: d.name, width: 330 }));
          const desc = field('share-desc', F.textarea({ value: d.desc, rows: 3, width: 420 }));
          const lp = field('local-path', F.text({ value: '', readOnly: true, width: 420 }));
          const rp = field('remote-path', F.text({ value: '', readOnly: true, width: 420 }));
          const note = h('div', { style: 'margin:4px 0 8px;color:#555' }, h('span', { html: I.eventWarning, style: 'display:inline-block;width:14px;vertical-align:-2px;margin-right:4px' }), 'If the folder does not exist, the folder is created.');
          const paint = () => { lp.value = localPath(); rp.value = unc(d.name.trim()); note.style.display = d.name.trim() && WS.fs.isDir(localPath()) ? 'none' : ''; };
          name.addEventListener('input', () => { d.name = name.value; d.nameTouched = true; paint(); });
          desc.addEventListener('input', () => { d.desc = desc.value; });
          paint();
          return h('div.wz-text.fss-wz', F.stack('Share name:', name), F.stack('Share description:', desc), F.stack('Local path to share:', lp), note, F.stack('Remote path to share:', rp));
        },
        validate: () => {
          const n = d.name.trim();
          if (!n) return 'Type a share name.';
          if (n.length > 80 || /[\\/[\]:|<>+=;,?*"]/.test(n)) return 'The share name contains invalid characters.';
          if (WS.smb.get(n)) return `The share name "${n}" is already in use on ${server()}. Type a different share name.`;
          const st = WS.fs.stat(localPath());
          if (st && st.type !== 'dir') return `A file named "${localPath()}" already exists. Type a different share name.`;
          d.name = n;
          return null;
        } },
      { id: 'settings', nav: 'Other Settings', title: 'Configure share settings', rerender: true,
        render: () => h('div.wz-text.fss-wz.fss-checks',
          field('abe', F.checkbox('Enable access-based enumeration', d.abe, { onChange: v => { d.abe = v; } })),
          h('div.d', "Access-based enumeration displays only the files and folders that a user has permissions to access. If a user does not have Read (or equivalent) permissions for a folder, Windows hides the folder from the user's view."),
          field('caching', F.checkbox('Allow caching of share', d.cache, { onChange: v => { d.cache = v; } })),
          h('div.d', 'Caching makes the contents of the share available to offline users. If the BranchCache for Network Files role service is installed, you can enable BranchCache on the share.'),
          h('div', { style: 'margin-left:22px' }, field('branchcache', F.checkbox('Enable BranchCache on the file share', false, { disabled: true })),
            h('div.d', 'BranchCache enables computers in a branch office to cache files downloaded from this share, and then allows the files to be securely available to other computers in the branch.')),
          field('encrypt', F.checkbox('Encrypt data access', d.encrypt, { onChange: v => { d.encrypt = v; } })),
          h('div.d', 'When enabled, remote file access to this share will be encrypted. This secures the data against unauthorized access while the data is transferred to and from the share. If this box is checked and grayed out, an administrator has turned on encryption for the entire server.')) },
      { id: 'perms', nav: 'Permissions', title: 'Specify permissions to control access', rerender: true,
        render: w => h('div.wz-text.fss-wz',
          h('p', 'Permissions to access the files on a share are set using a combination of folder permissions, share permissions, and, optionally, a central access policy.'),
          kv([['Share permissions:', shareSummary(d.access)]]),
          h('div', { style: 'margin-bottom:4px' }, 'Folder permissions:'), aclList(),
          h('div', { style: 'margin-top:8px' }, field('customize', F.button('Customize permissions...', async () => {
            const r = await advancedSecurity({ name: d.name, path: localPath(), access: d.access });
            if (r) { d.access = r; w.goto('perms'); }
          })))) },
      { id: 'confirm', nav: 'Confirmation', title: 'Confirm selections', finish: true, rerender: true,
        render: () => h('div.wz-text.fss-wz', h('p', 'Confirm that the following are the correct settings, and then click Create.'),
          h('div.wz-section', 'SHARE LOCATION'), kv([['Server:', server()], ['Cluster role:', 'Not Clustered'], ['Local path:', localPath()]]),
          h('div.wz-section', 'SHARE PROPERTIES'), kv([['Share name:', d.name], ['Protocol:', 'SMB'], ['Access-based enumeration:', d.abe ? 'Enabled' : 'Disabled'],
            ['Caching:', d.cache ? 'Enabled' : 'Disabled'], ['BranchCache:', 'Disabled'], ['Encrypt data:', d.encrypt ? 'Enabled' : 'Disabled']])) },
      { id: 'results', nav: 'Results', title: 'View results', rerender: true, render: () => results(d, 'The share was successfully created.') }
    ];
    return WS.ui.wizard({ title: 'New Share Wizard', style: 'server', asWindow: true, app: 'newshare', icon: I.share, width: 820, height: 600,
      destination: ' ', finishLabel: 'Create', pages, data: d,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, d); },
      onFinish: async () => {
        const path = localPath();
        try { WS.fs.ensureDir(path); } catch (e) { return e.message; }
        const r = WS.smb.newShare({ name: d.name, path, description: d.desc, access: d.access, folderEnumerationMode: d.abe ? 'AccessBased' : 'Unrestricted',
          cachingMode: d.cache ? 'Manual' : 'None', encryptData: d.encrypt });
        if (!r.ok) return r;
        await U.sleep(200);
        d.share = r.share;
        d.steps = [['Create SMB share', 'Completed'], ['Set SMB permissions', 'Completed']];
        selection.shares = 'share:' + r.share.name;
        return null;
      } });
  }

  /* ================================================================ share Properties */
  function shareProperties(name, opts = {}) {
    const s = WS.smb.get(name);
    if (!s) return Promise.resolve(false);
    const frame = WS.ui.modal({ title: `${s.name} Properties`, width: 760, className: 'w32-dlg', closeValue: false });
    const st = { desc: s.description || '', abe: s.folderEnumerationMode === 'AccessBased', cache: (s.cachingMode || 'Manual') !== 'None', encrypt: !!s.encryptData, access: null };
    let applied = false, cur = 'general';
    const SECTIONS = [['general', 'General'], ['perms', 'Permissions'], ['settings', 'Settings']];
    const nav = h('div.nav'), pg = h('div.pg');
    const okBtn = h('button.btn.primary', 'OK'), cancelBtn = h('button.btn', 'Cancel'), applyBtn = h('button.btn', { disabled: true }, 'Apply');
    const setDirty = () => { applyBtn.disabled = false; };
    const sections = {
      general: () => {
        const desc = field('share-desc', F.textarea({ value: st.desc, rows: 3, width: 400 }));
        desc.addEventListener('input', () => { st.desc = desc.value; setDirty(); });
        return h('div', kv([['Server Name:', server()], ['Share name:', s.name]]), F.stack('Share description:', desc),
          kv([['Folder path:', s.path], ['Protocol:', 'SMB'], ['Availability type:', 'Not Clustered']]));
      },
      perms: () => h('div',
        h('p', { style: 'margin-top:0' }, 'Permissions to access the files on a share are set using a combination of folder permissions, share permissions, and, optionally, a central access policy.'),
        kv([['Share permissions:', shareSummary(st.access || s.access)]]), h('div', { style: 'margin-bottom:4px' }, 'Folder permissions:'), aclList(),
        h('div', { style: 'margin-top:8px' }, field('customize', F.button('Customize permissions...', async () => {
          const r = await advancedSecurity({ name: s.name, path: s.path, access: st.access || s.access });
          if (r) { st.access = r; setDirty(); show('perms'); }
        })))),
      settings: () => h('div.fss-checks',
        field('abe', F.checkbox('Enable access-based enumeration', st.abe, { onChange: v => { st.abe = v; setDirty(); } })),
        h('div.d', "Access-based enumeration displays only the files and folders that a user has permissions to access. If a user does not have Read (or equivalent) permissions for a folder, Windows hides the folder from the user's view."),
        field('caching', F.checkbox('Allow caching of share', st.cache, { onChange: v => { st.cache = v; setDirty(); } })),
        h('div.d', 'Caching makes the contents of the share available to offline users. If the BranchCache for Network Files role service is installed, you can enable BranchCache on the share.'),
        h('div', { style: 'margin-left:22px' }, F.checkbox('Enable BranchCache on the file share', false, { disabled: true })),
        field('encrypt', F.checkbox('Encrypt data access', st.encrypt, { onChange: v => { st.encrypt = v; setDirty(); } })),
        h('div.d', 'When enabled, remote file access to this share will be encrypted. This secures the data against unauthorized access while the data is transferred to and from the share.'))
    };
    function show(id) {
      cur = id;
      U.clear(nav); U.clear(pg);
      for (const [k, label] of SECTIONS) nav.appendChild(h('div' + (k === id ? '.sel' : ''), { dataset: { section: k }, onClick: () => show(k) }, label));
      pg.append(h('h4', SECTIONS.find(x => x[0] === id)[1]), sections[id]());
    }
    function apply() {
      if (!WS.smb.get(s.name)) { err('The share no longer exists.', frame.box.querySelector('.dlg-ttext').textContent); return false; }
      const mode = st.cache ? ((s.cachingMode || 'Manual') === 'None' ? 'Manual' : s.cachingMode || 'Manual') : 'None';
      const r = WS.smb.setShare(s.name, { description: st.desc, folderEnumerationMode: st.abe ? 'AccessBased' : 'Unrestricted', cachingMode: mode, encryptData: st.encrypt });
      if (!r.ok) { err(r); return false; }
      if (st.access) { const a = WS.smb.setAccess(s.name, st.access); if (!a.ok) { err(a); return false; } st.access = null; }
      applied = true; applyBtn.disabled = true;
      return true;
    }
    okBtn.addEventListener('click', () => { if (applyBtn.disabled || apply()) frame.close(applied); });
    cancelBtn.addEventListener('click', () => frame.close(applied));
    applyBtn.addEventListener('click', () => { if (!applyBtn.disabled) apply(); });
    frame.footer.append(okBtn, cancelBtn, applyBtn);
    frame.onEscape = () => frame.close(applied);
    frame.body.appendChild(h('div.w32.fss-props', nav, pg));
    show('general');
    if (opts.onCreate) opts.onCreate(frame, { show, ok: () => okBtn.click(), apply: () => applyBtn.click(), cancel: () => cancelBtn.click(), state: st, current: () => cur });
    return frame.promise;
  }

  /* ================================================================ wiring */
  function subnav(el, sub, go) {
    U.clear(el);
    for (const [id, label, parent] of PAGES) el.appendChild(h('div' + (id === sub ? '.sel' : '') + (parent ? '.sub' : ''), { dataset: { sub: id }, onClick: () => go(id) }, label));
  }
  function crumbs(sub) {
    const p = PAGES.find(x => x[0] === sub) || PAGES[0];
    return p[2] ? [PAGES.find(x => x[0] === p[2])[1], p[1]] : [p[1]];
  }
  const RENDER = { servers: serversPage, volumes: volumesPage, disks: disksPage, pools: poolsPage, shares: sharesPage, iscsi: iscsiPage, workfolders: workFoldersPage };
  function render(sub, c) { (RENDER[sub] || serversPage)(c); }

  WS.smfss = { render, subnav, crumbs, PAGES, selection, size, extendVolume, advancedSecurity, bringOnline, takeOffline, initialize, resetDisk, stopSharing, scanVolume,
    menus: { volume: volumeMenu, disk: diskMenu, share: shareMenu }, rows: { volumes: volumeRows, disks: diskRows, shares: shareRows } };
  Object.assign(WS.sm, { newVolume, newShare, shareProperties });
})();
