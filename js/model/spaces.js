/* Storage Spaces: WS.spaces. Storage pools made of physical disks, and virtual disks (spaces) carved out of a pool, for
 * Server Manager's Storage Pools page and the Storage cmdlets (Get-PhysicalDisk, New-StoragePool, New-VirtualDisk...).
 * A physical disk in a pool disappears from Get-Disk and Disk Management (storage.js hides disk.pool); each virtual disk
 * appears as a new disk (a "Microsoft Storage Space Device", online and RAW) that is initialized and given volumes the
 * usual way, so every disk and volume tool works on it unchanged.
 * State: storage.pools[] = { id, name, description }
 *        storage.spaces[] = { id, name, pool, layout: 'Simple'|'Mirror'|'Parity', redundancy (0, 1 or 2 disk failures
 *          tolerated), provisioning: 'Fixed'|'Thin', size, columns, disks: [physical disk numbers it is spread over], disk: its disk number }
 *        on a physical disk: pool (pool id), usage ('AutoSelect'|'HotSpare'|'Retired'), failed (lost communication), mediaType.
 * Allocation is in 256 MB slabs; every pooled disk keeps 256 MB for the pool's metadata. A virtual disk takes
 * size x factor from the pool (Mirror: the number of copies; Parity: columns / (columns - redundancy)), spread evenly
 * over its disks. Thin disks take only what their volumes use. A failed disk degrades the virtual disks on it (they
 * keep working while their redundancy covers it) and detaches the ones it can't cover; Repair moves data off failed and
 * retired disks onto healthy ones, after which the failed disk can be removed. */
(function () {
  'use strict';
  const WS = window.WS;
  const MB = 1024 * 1024, GB = 1024 * MB, SLAB = 256 * MB, META = 256 * MB;

  const S = () => WS.state.storage;
  const pools = () => (S().pools = S().pools || []);
  const spaces = () => (S().spaces = S().spaces || []);
  const ieq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const raw = n => S().disks.find(d => d.number === +n) || null;
  const changed = () => WS.store.changed('storage');
  const fail = (code, error) => ({ ok: false, code, error });
  const INSUFFICIENT = 'The storage pool does not have sufficient eligible resources for the creation of the specified virtual disk.';
  const roundUp = b => Math.ceil(b / SLAB) * SLAB;

  /* ---------------- physical disks ---------------- */
  const usageLabel = u => ({ AutoSelect: 'Auto-Select', HotSpare: 'Hot Spare', Retired: 'Retired', ManualSelect: 'Manual-Select', Journal: 'Journal' }[u || 'AutoSelect']);
  /** Why a disk can't join a pool (Get-PhysicalDisk's CannotPoolReason), or null. */
  function cannotPool(d) {
    if (d.space) return 'Not Supported'; // a virtual disk can't be pooled again
    if (d.pool) return 'In a Pool';
    if (d.failed) return 'Not Healthy';
    if (d.boot || d.partitions.some(p => p.type !== 'Reserved') || d.size < 4 * GB) return 'Insufficient Capacity';
    return null;
  }
  /** Space a physical disk gives to virtual disks (metadata included). */
  function allocatedOn(n) {
    const d = raw(n);
    if (!d || !d.pool) return 0;
    return META + spaces().filter(v => v.disks.includes(d.number)).reduce((a, v) => a + share(v), 0);
  }
  const freeOn = n => { const d = raw(n); return d ? Math.max(0, d.size - allocatedOn(n)) : 0; };
  function physicalDisk(d) {
    const pool = d.pool ? pools().find(p => p.id === d.pool) : null;
    return { number: d.number, deviceId: d.failed ? '' : String(d.number), uniqueId: '60022480' + WS.util.hashStr('disk' + d.number).toString(16).toUpperCase(), friendlyName: d.model || 'Msft Virtual Disk',
      size: d.size, allocated: d.pool ? allocatedOn(d.number) : d.boot || d.partitions.some(p => p.type !== 'Reserved') ? d.size : 0, canPool: !cannotPool(d), cannotPoolReason: cannotPool(d) || '',
      usage: d.usage || 'AutoSelect', usageLabel: usageLabel(d.usage), mediaType: d.mediaType || 'Unspecified', busType: 'SAS', pool: pool ? pool.name : null, boot: !!d.boot,
      healthStatus: d.failed ? 'Warning' : 'Healthy', operationalStatus: d.failed ? 'Lost Communication' : 'OK', failed: !!d.failed };
  }
  /** Every physical disk (the pooled ones too, not the disks of virtual disks), as Get-PhysicalDisk lists them. */
  const physicalDisks = () => S().disks.filter(d => !d.space).map(physicalDisk);
  const poolDisks = id => S().disks.filter(d => d.pool === id);
  /** Disks a new virtual disk can use: healthy, Auto-Select, in the pool. */
  const eligible = id => poolDisks(id).filter(d => !d.failed && (d.usage || 'AutoSelect') === 'AutoSelect');

  /* ---------------- pools ---------------- */
  const findPool = name => pools().find(p => ieq(p.name, name)) || null;
  function poolInfo(p) {
    const disks = poolDisks(p.id);
    const size = disks.reduce((a, d) => a + d.size, 0), allocated = disks.reduce((a, d) => a + allocatedOn(d.number), 0);
    const degraded = disks.some(d => d.failed);
    return { name: p.name, description: p.description || '', primordial: false, size, allocated, free: size - allocated, disks: disks.map(d => d.number),
      virtualDisks: spaces().filter(v => v.pool === p.id).map(v => v.name), healthStatus: degraded ? 'Warning' : 'Healthy', operationalStatus: degraded ? 'Degraded' : 'OK', readOnly: false };
  }
  /** The Primordial pool: the disks that can be pooled (Server Manager lists it only while there are some). */
  function primordial() {
    const disks = S().disks.filter(d => !d.space && !d.pool);
    const size = disks.reduce((a, d) => a + d.size, 0);
    return { name: 'Primordial', description: '', primordial: true, size, allocated: disks.reduce((a, d) => a + physicalDisk(d).allocated, 0), free: 0, disks: disks.map(d => d.number),
      poolable: disks.filter(d => !cannotPool(d)).map(d => d.number), virtualDisks: [], healthStatus: 'Healthy', operationalStatus: 'OK', readOnly: false };
  }
  function checkName(name, existing) {
    const n = String(name || '').trim();
    if (!n) return fail('InvalidName', 'The friendly name is not valid.');
    if (n.length > 64 || /[\\/:*?"<>|]/.test(n)) return fail('InvalidName', 'The friendly name is not valid.');
    if (existing(n)) return fail('Exists', 'The specified friendly name already exists.');
    return null;
  }
  /** newPool({ name, disks: [numbers], description, usage: { [number]: 'HotSpare' } }) - New-StoragePool / the New Storage Pool Wizard. */
  function newPool(o) {
    const bad = checkName(o.name, n => ieq(n, 'Primordial') || !!findPool(n));
    if (bad) return bad;
    const disks = [...new Set([].concat(o.disks || []).map(Number))].map(raw);
    if (!disks.length) return fail('NoDisks', 'You must select at least one physical disk.');
    for (const d of disks) if (!d || cannotPool(d)) return fail('CannotPool', 'One of the physical disks specified is not supported by this operation.');
    const p = { id: WS.util.guid(), name: String(o.name).trim(), description: o.description || '' };
    pools().push(p);
    for (const d of disks) addToPool(p, d, (o.usage || {})[d.number]);
    changed();
    return { ok: true, pool: poolInfo(p) };
  }
  function addToPool(p, d, usage) {
    d.pool = p.id; d.usage = usage === 'HotSpare' ? 'HotSpare' : 'AutoSelect';
    d.partitions = []; d.style = 'RAW'; d.online = true; d.readOnly = false;
  }
  /** Add-PhysicalDisk: more disks for an existing pool (usage 'HotSpare' keeps them for repairs). */
  function addDisks(name, numbers, usage) {
    const p = findPool(name); if (!p) return fail('NotFound', `No MSFT_StoragePool objects found with property 'FriendlyName' equal to '${name}'.`);
    const disks = [].concat(numbers).map(raw);
    for (const d of disks) if (!d || cannotPool(d)) return fail('CannotPool', 'One of the physical disks specified is not supported by this operation.');
    for (const d of disks) addToPool(p, d, usage);
    changed();
    return { ok: true };
  }
  /** Remove-PhysicalDisk: only a disk no virtual disk uses (retire it and repair first). A failed disk leaves the system. */
  function removeDisk(name, n) {
    const p = findPool(name), d = raw(n);
    if (!p || !d || d.pool !== p.id) return fail('NotFound', 'The physical disk is not in this storage pool.');
    if (spaces().some(v => v.disks.includes(d.number))) return fail('InUse', 'The physical disk could not be removed because a virtual disk still uses it. Retire the disk and repair the virtual disks first.');
    if (d.failed) S().disks = S().disks.filter(x => x !== d);
    else { delete d.pool; delete d.usage; }
    changed();
    return { ok: true };
  }
  /** Set-PhysicalDisk -Usage AutoSelect|HotSpare|Retired, -MediaType HDD|SSD|Unspecified */
  function setDisk(n, o) {
    const d = raw(n); if (!d || d.space) return fail('NotFound', `No MSFT_PhysicalDisk objects found with property 'DeviceId' equal to '${n}'.`);
    if (o.usage) {
      const u = ['AutoSelect', 'HotSpare', 'Retired', 'ManualSelect', 'Journal'].find(x => ieq(x, o.usage));
      if (!u) return fail('Invalid', `Cannot bind parameter 'Usage'. Specify one of the following enumerator names and try again: Unknown, AutoSelect, ManualSelect, HotSpare, Retired, Journal`);
      if (!d.pool) return fail('NotPooled', 'The operation is not supported on a physical disk that is not in a storage pool.');
      if (u === 'HotSpare' && spaces().some(v => v.disks.includes(d.number))) return fail('InUse', 'The physical disk is in use by a virtual disk and cannot be made a hot spare.');
      d.usage = u;
    }
    if (o.mediaType) {
      const m = ['HDD', 'SSD', 'SCM', 'Unspecified'].find(x => ieq(x, o.mediaType));
      if (!m) return fail('Invalid', `Cannot bind parameter 'MediaType'. Specify one of the following enumerator names and try again: Unspecified, HDD, SSD, SCM`);
      d.mediaType = m;
    }
    changed();
    return { ok: true };
  }
  /** Remove-StoragePool: its disks go back to the Primordial pool. */
  function removePool(name) {
    const p = findPool(name); if (!p) return fail('NotFound', `No MSFT_StoragePool objects found with property 'FriendlyName' equal to '${name}'.`);
    if (spaces().some(v => v.pool === p.id)) return fail('HasVirtualDisks', 'The storage pool could not be deleted because it contains virtual disks. Delete the virtual disks first.');
    for (const d of poolDisks(p.id)) { if (d.failed) S().disks = S().disks.filter(x => x !== d); else { delete d.pool; delete d.usage; } }
    S().pools = pools().filter(x => x !== p);
    changed();
    return { ok: true };
  }
  /** Set-StoragePool -NewFriendlyName / -Description */
  function setPool(name, o) {
    const p = findPool(name); if (!p) return fail('NotFound', `No MSFT_StoragePool objects found with property 'FriendlyName' equal to '${name}'.`);
    if (o.newName != null && !ieq(o.newName, p.name)) { const bad = checkName(o.newName, n => ieq(n, 'Primordial') || !!findPool(n)); if (bad) return bad; p.name = String(o.newName).trim(); }
    if (o.description != null) p.description = String(o.description);
    changed();
    return { ok: true };
  }

  /* ---------------- virtual disks ---------------- */
  const LAYOUTS = ['Simple', 'Mirror', 'Parity'];
  /** Fewest disks each layout needs: two-way mirror 2, three-way mirror 5, single parity 3, dual parity 7. */
  const minDisks = (layout, red) => (layout === 'Simple' ? 1 : layout === 'Mirror' ? (red >= 2 ? 5 : 2) : red >= 2 ? 7 : 3);
  /** How many disks a new virtual disk spreads over, and its columns. */
  function shape(layout, red, n) {
    if (layout === 'Mirror') { const copies = red + 1, cols = Math.max(1, Math.min(4, Math.floor(n / copies))); return { columns: cols, count: cols * copies }; }
    const cols = Math.min(n, 8);
    return { columns: cols, count: cols };
  }
  const factor = v => (v.layout === 'Mirror' ? v.redundancy + 1 : v.layout === 'Parity' ? v.columns / (v.columns - v.redundancy) : 1);
  const efficiency = v => 1 / factor(v);
  /** What a thin disk has written: the space its volumes use. */
  function written(v) {
    const d = raw(v.disk);
    if (!d) return 0;
    return d.partitions.reduce((a, p) => a + (p.fs ? WS.storage.usedBytes(p) : p.type === 'Reserved' ? p.size : 0), 0);
  }
  const footprint = v => roundUp((v.provisioning === 'Thin' ? Math.min(v.size, written(v)) : v.size) * factor(v));
  const share = v => footprint(v) / v.disks.length;
  /** OK while no disk is lost, Degraded while the redundancy covers the lost disks, Detached beyond it. */
  function health(v) {
    const lost = v.disks.filter(n => { const d = raw(n); return !d || d.failed; }).length;
    const retired = v.disks.some(n => { const d = raw(n); return d && d.usage === 'Retired'; });
    if (!lost) return retired ? { op: 'Degraded', health: 'Warning' } : { op: 'OK', health: 'Healthy' };
    return lost <= v.redundancy ? { op: 'Degraded', health: 'Warning' } : { op: 'Detached', health: 'Unhealthy' };
  }
  function spaceInfo(v) {
    const p = pools().find(x => x.id === v.pool), h = health(v);
    return { name: v.name, pool: p ? p.name : '', layout: v.layout, redundancy: v.redundancy, copies: v.layout === 'Mirror' ? v.redundancy + 1 : 1, provisioning: v.provisioning, size: v.size,
      footprint: footprint(v), allocated: v.provisioning === 'Thin' ? roundUp(Math.min(v.size, written(v))) : v.size, efficiency: efficiency(v), columns: v.columns, disks: v.disks.slice(), disk: v.disk,
      operationalStatus: h.op, healthStatus: h.health, uniqueId: v.id.replace(/-/g, '').toUpperCase(),
      resiliency: v.layout === 'Mirror' ? (v.redundancy >= 2 ? 'Three-way mirror' : 'Two-way mirror') : v.layout === 'Parity' ? (v.redundancy >= 2 ? 'Dual parity' : 'Single parity') : 'Simple' };
  }
  const findSpace = name => spaces().find(v => ieq(v.name, name)) || null;
  /** Fit a virtual disk of `bytes` (or the most that fits, bytes = 'max') onto the pool: -> { disks, columns, size } | error */
  function place(p, layout, red, provisioning, bytes, exclude = []) {
    const disks = eligible(p.id).filter(d => !exclude.includes(d.number));
    if (disks.length < minDisks(layout, red)) return fail('NotEnoughDisks', INSUFFICIENT);
    const { columns, count } = shape(layout, red, disks.length);
    const chosen = disks.map(d => ({ n: d.number, free: freeOn(d.number) })).sort((a, b) => b.free - a.free).slice(0, count);
    const f = layout === 'Mirror' ? red + 1 : layout === 'Parity' ? columns / (columns - red) : 1;
    const most = Math.floor(chosen[chosen.length - 1].free * count / f / SLAB) * SLAB;
    const size = bytes === 'max' ? most : roundUp(+bytes);
    if (!(size >= SLAB)) return fail('NotEnoughSpace', 'Not enough available capacity');
    if (provisioning === 'Fixed' && size > most) return fail('NotEnoughSpace', 'Not enough available capacity');
    return { ok: true, disks: chosen.map(c => c.n), columns, size, most };
  }
  /** newSpace({ pool, name, layout: Simple|Mirror|Parity, redundancy (Mirror 1 = two-way, 2 = three-way; Parity 1 single, 2 dual), provisioning: Fixed|Thin, size: bytes | 'max' }) */
  function newSpace(o) {
    const p = findPool(o.pool); if (!p) return fail('NotFound', `No MSFT_StoragePool objects found with property 'FriendlyName' equal to '${o.pool}'.`);
    const bad = checkName(o.name, n => !!findSpace(n));
    if (bad) return bad;
    const layout = LAYOUTS.find(x => ieq(x, o.layout || 'Mirror'));
    if (!layout) return fail('Invalid', `The resiliency setting name is not valid.`);
    const red = layout === 'Simple' ? 0 : Math.max(1, Math.min(2, +o.redundancy || 1));
    const provisioning = ieq(o.provisioning, 'Thin') ? 'Thin' : 'Fixed';
    if (provisioning === 'Thin' && o.size === 'max') return fail('Invalid', 'The maximum size can be used only with fixed provisioning.');
    const fit = place(p, layout, red, provisioning, o.size);
    if (!fit.ok) return fit;
    const v = { id: WS.util.guid(), name: String(o.name).trim(), pool: p.id, layout, redundancy: red, provisioning, size: fit.size, columns: fit.columns, disks: fit.disks };
    v.disk = WS.storage.addSpaceDisk(v.id, v.size);
    spaces().push(v);
    changed();
    return { ok: true, space: spaceInfo(v) };
  }
  /** Most a new virtual disk could be (Server Manager's "Maximum size"). */
  function maxSize(poolName, layout, red) {
    const p = findPool(poolName); if (!p) return 0;
    const r = place(p, layout, layout === 'Simple' ? 0 : red || 1, 'Fixed', 'max');
    return r.ok ? r.most : 0;
  }
  /** Remove-VirtualDisk: the disk and its volumes go with it. */
  function removeSpace(name) {
    const v = findSpace(name); if (!v) return fail('NotFound', `No MSFT_VirtualDisk objects found with property 'FriendlyName' equal to '${name}'.`);
    WS.storage.removeSpaceDisk(v.disk);
    S().spaces = spaces().filter(x => x !== v);
    changed();
    return { ok: true };
  }
  /** Resize-VirtualDisk: grow only; the new space appears unallocated at the end of its disk. */
  function resizeSpace(name, bytes) {
    const v = findSpace(name); if (!v) return fail('NotFound', `No MSFT_VirtualDisk objects found with property 'FriendlyName' equal to '${name}'.`);
    const size = roundUp(+bytes);
    if (!(size > v.size)) return fail('Invalid', 'The size must be larger than the current size of the virtual disk.');
    if (health(v).op === 'Detached') return fail('Detached', 'The virtual disk is detached.');
    if (v.provisioning === 'Fixed') {
      // grow on its own disks, or spread over as many more disks again (columns x copies), as Storage Spaces needs
      const need = roundUp(size * factor(v)), had = share(v);
      const fits = set => set.every(n => (v.disks.includes(n) ? freeOn(n) + had : freeOn(n)) >= need / set.length);
      const more = eligible(v.pool).filter(d => !v.disks.includes(d.number)).map(d => d.number).sort((a, b) => freeOn(b) - freeOn(a)).slice(0, v.disks.length);
      if (fits(v.disks)) { /* room where it is */ } else if (more.length === v.disks.length && fits([...v.disks, ...more])) v.disks = [...v.disks, ...more];
      else return fail('NotEnoughSpace', 'Not enough available capacity');
    }
    v.size = size;
    WS.storage.resizeSpaceDisk(v.disk, size);
    changed();
    return { ok: true };
  }
  /** Repair-VirtualDisk: rebuild onto healthy disks (hot spares too) the copies held by failed or retired disks. */
  function repair(name) {
    const v = findSpace(name); if (!v) return fail('NotFound', `No MSFT_VirtualDisk objects found with property 'FriendlyName' equal to '${name}'.`);
    const h = health(v);
    if (h.op === 'Detached') return fail('Detached', 'The virtual disk cannot be repaired because too many of its physical disks have failed.');
    const bad = v.disks.filter(n => { const d = raw(n); return !d || d.failed || d.usage === 'Retired'; });
    if (!bad.length) return { ok: true, repaired: 0 };
    const need = share(v);
    const candidates = poolDisks(v.pool).filter(d => !d.failed && !v.disks.includes(d.number) && ['AutoSelect', 'HotSpare'].includes(d.usage || 'AutoSelect') && freeOn(d.number) >= need)
      .sort((a, b) => (a.usage === 'HotSpare') - (b.usage === 'HotSpare') || freeOn(b.number) - freeOn(a.number));
    if (candidates.length < bad.length) return fail('NotEnoughDisks', 'The virtual disk could not be repaired because there is not enough free space on the healthy physical disks in the storage pool.');
    bad.forEach((n, i) => { const d = candidates[i]; if (d.usage === 'HotSpare') d.usage = 'AutoSelect'; v.disks[v.disks.indexOf(n)] = d.number; });
    refresh();
    changed();
    return { ok: true, repaired: bad.length };
  }
  /** Keep each virtual disk's disk attached or detached to match its health. */
  function refresh() {
    for (const v of spaces()) WS.storage.setDetached(v.disk, health(v).op === 'Detached');
  }

  /* ---------------- faults (labs and instructors) ---------------- */
  /** The physical disk stops answering (Lost Communication). */
  function failDisk(n) {
    const d = raw(n); if (!d || !d.pool) return fail('NotFound', 'The disk is not in a storage pool.');
    d.failed = true;
    refresh();
    changed();
    return { ok: true };
  }
  function restoreDisk(n) {
    const d = raw(n); if (!d) return fail('NotFound', 'No such disk.');
    delete d.failed;
    refresh();
    changed();
    return { ok: true };
  }

  WS.spaces = {
    SLAB, META, LAYOUTS, minDisks,
    physicalDisks, physicalDisk: n => { const d = raw(n); return d && !d.space ? physicalDisk(d) : null; },
    pools: () => pools().map(poolInfo), pool: name => { const p = findPool(name); return p ? poolInfo(p) : null; }, primordial,
    poolOfDisk: n => { const d = raw(n); if (!d) return null; const p = pools().find(x => x.id === d.pool || (d.space && spaces().some(v => v.disk === d.number && v.pool === x.id))); return p ? poolInfo(p) : null; },
    spaces: () => spaces().map(spaceInfo), space: name => { const v = findSpace(name); return v ? spaceInfo(v) : null; },
    spaceOfDisk: n => { const v = spaces().find(x => x.disk === +n); return v ? spaceInfo(v) : null; },
    newPool, addDisks, removeDisk, setDisk, removePool, setPool, newSpace, maxSize, removeSpace, resizeSpace, repair, failDisk, restoreDisk
  };
})();
