/* Disk Management (diskmgmt.msc): the volume list over the graphical disk view, as the real snap-in shows them.
 * Every change goes through WS.storage - the model Get-Disk, Initialize-Disk, New-Partition and Format-Volume use - so
 * this console and PowerShell always agree, and an open console repaints when either one changes the disks.
 * Hosted on its own (diskmgmt.msc, console tree hidden) or under Computer Management > Storage:
 *   WS.diskmgmt.snapin() -> { node, ctl }   node: the MMC scope node ('dm-root', with viewMenu(mmc)); ctl: the controller.
 *   WS.diskmgmt.launch(opts) -> win; win.diskmgmt = ctl.
 * ctl: { mmc, select(id), selected(), menu(id), top, bottom, setTop(kind), setBottom(kind), rescan(), loading }
 *   Object ids: 'disk:<n>', 'part:<n>:<partition>', 'free:<n>:<offset>' (unallocated; 'free:<n>:raw' on an uninitialized
 *   disk), 'cdrom'. Pane kinds: 'volumes' | 'disks' | 'graphical' (| 'hidden' for the bottom pane).
 * Dialogs (each takes opts.onCreate with the live dialog frame / wizard / sheet; controls carry data-field names for tests):
 *   initialize({ disks }), newSimpleVolume(n, { offset }), format(id), changeLetter(id), extend(id), shrink(id),
 *   deleteVolume(id), markActive(id), online(n), offline(n), convert(n, style), diskProperties(n), volumeProperties(id),
 *   cdromProperties(). They return promises; ones that change nothing resolve to null/false. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, S = WS.storage;
  const TITLE = 'Disk Management';
  const MB = S.MB, GB = S.GB, TB = 1024 * GB;

  /* ---------------- icons ---------------- */
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const DOWN = '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M12 10.3v3.2M10.6 12.2l1.4 1.4 1.4-1.4" stroke="#fff" stroke-width="1" fill="none"/>';
  const ICON = {
    app: s16('<rect x="1.5" y="3" width="13" height="10" rx="1.2" fill="#6b7785"/><rect x="2.6" y="4.2" width="10.8" height="3.4" fill="#fff"/><rect x="2.6" y="4.2" width="3" height="3.4" fill="#13238f"/><rect x="5.6" y="4.2" width="5.4" height="3.4" fill="#2f7fd8"/><rect x="11" y="4.2" width="2.4" height="3.4" fill="#1b1b1b"/><circle cx="12.2" cy="10.7" r=".8" fill="#4cff8a"/><path d="M3 10.7h6" stroke="#aab4bf"/>'),
    disk: I.disk, diskDown: s16(inner(I.disk) + DOWN), cdrom: I.cdrom, vol: I.drive, volSys: I.driveSystem
  };

  /* ---------------- formatting helpers ---------------- */
  /** Disk Management's sizes: "100 MB", "39.98 GB", "1.50 TB". */
  const size = b => (b >= TB ? (b / TB).toFixed(2) + ' TB' : b >= GB ? (b / GB).toFixed(2) + ' GB' : Math.round(b / MB) + ' MB');
  const mb = b => Math.floor(b / MB);
  /** Explorer's three-digit sizes ("39.9 GB", "126 GB"), which truncate rather than round. */
  function shortSize(b) {
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = b;
    while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
    if (i === 0) return `${b} bytes`;
    const t = v >= 100 ? Math.floor(v) : v >= 10 ? (Math.floor(v * 10) / 10).toFixed(1) : (Math.floor(v * 100) / 100).toFixed(2);
    return `${t} ${units[i]}`;
  }
  const bytes = b => `${Math.round(b).toLocaleString('en-US')} bytes`;
  const hidden = p => p.type === 'Reserved';
  const sysPart = p => p.type === 'System' || p.type === 'Recovery';
  const volName = (d, p) => (p.letter ? `${p.label ? p.label + ' ' : ''}(${p.letter}:)` : p.label || `(Disk ${d.number} partition ${p.number})`);
  const volStatus = p => 'Healthy (' + (p.flags.join(', ') || 'Primary Partition') + ')';
  const diskStatus = d => (!d.online ? 'Offline' : d.style === 'RAW' ? 'Not Initialized' : 'Online');
  const diskType = d => (d.style === 'RAW' ? 'Unknown' : 'Basic');
  const fsList = sizeBytes => ['NTFS', 'ReFS', 'exFAT', ...(sizeBytes <= 32 * GB ? ['FAT32'] : [])];
  const auLabel = b => (b >= 1024 * 1024 ? b / 1024 / 1024 + 'M' : b >= 4096 * 4 ? b / 1024 + 'K' : String(b));
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = (r, title = TITLE) => WS.ui.msgbox({ title, icon: 'error', message: typeof r === 'string' ? r : r.error, detail: r.detail });
  const help = () => WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'Help is not available in the lab simulator.', detail: 'Use the Lab Guide for hints about the current lab.' });
  const HELP = { label: '&Help', action: help };
  const SEP = { separator: true };

  /** Resolve an object id against the live model. */
  function resolve(id) {
    const [k, a, b] = String(id || '').split(':');
    if (k === 'cdrom') return S.cdrom() ? { kind: 'cdrom', id: 'cdrom', cd: S.cdrom() } : null;
    const d = S.disk(a);
    if (!d) return null;
    if (k === 'disk') return { kind: 'disk', id, disk: d };
    if (k === 'part') { const p = d.partitions.find(x => x.number === +b); return p ? { kind: 'part', id, disk: d, part: p } : null; }
    if (k === 'free') {
      if (b === 'raw') return d.style === 'RAW' ? { kind: 'free', id, disk: d, region: { offset: 0, size: d.size }, raw: true } : null;
      const r = S.freeRegions(d.number).find(x => x.offset === +b);
      return r ? { kind: 'free', id, disk: d, region: r } : null;
    }
    return null;
  }
  const partId = (d, p) => `part:${d.number}:${p.number}`;

  /** A small modal with OK/Cancel; ok() returns an error (string / {ok:false}) to keep it open, or anything else to close. */
  function formDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 400, className: 'w32-dlg dm-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32', o.content));
    let busy = false;
    const ok = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await o.ok();
        if (r === false) return;
        if (typeof r === 'string' || (r && r.ok === false)) { if (r.cancelled !== true) await err(r, o.errorTitle || o.title); return; }
        frame.close(r === undefined ? true : r);
      } finally { busy = false; }
    };
    const okBtn = h('button.btn.primary', { onClick: ok }, o.okLabel || 'OK');
    frame.footer.append(okBtn, h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = ok; frame.onEscape = () => frame.close(null);
    frame.ok = ok; frame.okBtn = okBtn;
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /* ================================================================ commands */
  function online(n) { const r = S.setOnline(n, true); if (!r.ok) return err(r).then(() => r); return Promise.resolve(r); }
  function offline(n) { const r = S.setOnline(n, false); if (!r.ok) return err(r).then(() => r); return Promise.resolve(r); }
  function convert(n, style) { const r = S.convertStyle(n, style); if (!r.ok) return err(r.code === 'NotEmpty' ? 'The operation failed to complete because the disk is not empty. Delete all volumes on the disk and try again.' : r).then(() => r); return Promise.resolve(r); }

  /** Initialize Disk: every online, uninitialized disk is listed; opts.disks preselects some. */
  function initialize(opts = {}) {
    const cands = S.disks().filter(d => d.online && d.style === 'RAW');
    if (!cands.length) return Promise.resolve(false);
    const want = new Set((opts.disks || cands.map(d => d.number)).map(Number));
    const g = U.uid('dmi');
    const checks = cands.map(d => ({ n: d.number, cb: field('disk' + d.number, F.checkbox(`Disk ${d.number}`, want.has(d.number))) }));
    const gpt = field('gpt', F.radio(g, 'GPT (GUID Partition Table)', true)), mbr = field('mbr', F.radio(g, 'MBR (Master Boot Record)', false));
    const content = h('div.dm-init',
      h('div', 'You must initialize a disk before Logical Disk Manager can access it.'),
      h('div.dm-lbl', 'Select disks:'),
      h('div.dm-listbox', ...checks.map(c => c.cb)),
      h('div.dm-lbl', 'Use the following partition style for the selected disks:'),
      h('div.dm-indent', gpt, mbr),
      h('div.dm-note', 'Note: The GPT partition style is not recognized by all previous versions of Windows.'));
    const paint = frame => { frame.okBtn.disabled = !checks.some(c => c.cb.checked); };
    return formDialog({ title: 'Initialize Disk', width: 410, content,
      onCreate: f => { content.addEventListener('change', () => paint(f)); paint(f); if (opts.onCreate) opts.onCreate(f); },
      ok: () => {
        const style = mbr.checked ? 'MBR' : 'GPT';
        for (const c of checks) if (c.cb.checked) { const r = S.initialize(c.n, style); if (!r.ok) return r; }
        return true;
      } });
  }

  /** New Simple Volume Wizard on one unallocated extent (opts.offset; default the largest). */
  function newSimpleVolume(n, opts = {}) {
    const d = S.disk(n);
    if (!d || !d.online || d.style === 'RAW') return Promise.resolve(null);
    const region = opts.offset != null ? S.freeRegions(n).find(r => r.offset === +opts.offset) : S.freeRegions(n).reduce((a, r) => (!a || r.size > a.size ? r : a), null);
    if (!region) return Promise.resolve(null);
    const W = 'New Simple Volume Wizard', g = U.uid('nsv'), c = {};
    const maxMB = mb(region.size), minMB = 8;
    const data = { sizeMB: maxMB, letterMode: 'assign', letter: S.nextLetter(), folder: '', format: true, fs: 'NTFS', au: 0, label: 'New Volume', quick: true, compress: false };
    const radio = (key, value, label, o = {}) => field(key + '-' + value, F.radio(g + key, label, data[key] === value, { disabled: o.disabled, onChange: v => { if (v) { data[key] = value; if (o.on) o.on(); } } }));
    const lw = { labelWidth: 210 };
    function fillAu() {
      const list = S.AU[c.fs.value] || [4096];
      U.clear(c.au);
      c.au.appendChild(h('option', { value: '0' }, 'Default'));
      for (const b of list.slice().sort((x, y) => x - y)) c.au.appendChild(h('option', { value: String(b) }, auLabel(b)));
      c.au.value = '0';
    }
    function paintFormat() {
      const off = !c.formatYes.checked;
      [c.fs, c.au, c.label, c.quick.input].forEach(x => { x.disabled = off; });
      const ntfs = c.fs.value === 'NTFS' && (+c.au.value || 4096) <= 4096;
      c.compress.input.disabled = off || !ntfs;
      if (c.compress.input.disabled) c.compress.checked = false;
    }
    const pages = [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the New Simple Volume Wizard',
        render: () => h('div.dm-wtext', h('p', 'This wizard helps you create a simple volume on a disk.'), h('p', 'A simple volume can only be on a single disk.'), h('p', 'To continue, click Next.')) },
      { id: 'size', title: 'Specify Volume Size', subtitle: 'Choose a volume size that is between the maximum and minimum sizes.',
        render: () => {
          c.size = field('size', F.number({ value: maxMB, min: minMB, max: maxMB, width: 110 }));
          return h('div.dm-wz', F.row('Maximum disk space in MB:', F.value(maxMB), lw), F.row('Minimum disk space in MB:', F.value(minMB), lw), F.row('Simple volume size in MB:', c.size, lw));
        },
        validate: () => {
          const v = +c.size.value;
          if (!Number.isInteger(v) || v < minMB || v > maxMB) return `The size you specified is not valid. Specify a size between ${minMB} MB and ${maxMB} MB.`;
          data.sizeMB = v;
          return null;
        } },
      { id: 'letter', title: 'Assign Drive Letter or Path', subtitle: 'For easier access, you can assign a drive letter or drive path to your partition.',
        render: () => {
          c.letter = field('letter', F.select(S.freeLetters().map(l => ({ value: l, label: l })), data.letter, { width: 60, onChange: v => { data.letter = v; } }));
          c.folder = field('folder', F.text({ value: data.folder, width: 250 }));
          c.folder.addEventListener('input', () => { data.folder = c.folder.value; });
          c.browse = F.button('Browse...', async () => {
            const p = await WS.ui.filePicker({ mode: 'folder', title: 'Browse for Drive Path', prompt: 'Select an empty folder on an NTFS volume.', path: c.folder.value || 'C:\\' });
            if (p) { c.folder.value = p; data.folder = p; }
          });
          const paint = () => { c.letter.disabled = data.letterMode !== 'assign'; c.folder.disabled = c.browse.disabled = data.letterMode !== 'mount'; };
          c.assign = radio('letterMode', 'assign', 'Assign the following drive letter:', { on: paint });
          c.mount = radio('letterMode', 'mount', 'Mount in the following empty NTFS folder:', { on: paint });
          c.none = radio('letterMode', 'none', 'Do not assign a drive letter or drive path', { on: paint });
          paint();
          return h('div.dm-wz',
            h('div.dm-line', c.assign, c.letter),
            c.mount, h('div.dm-indent.dm-line', c.folder, c.browse),
            c.none);
        },
        validate: () => {
          if (data.letterMode !== 'mount') return null;
          if (!data.folder.trim()) return 'Specify the path of an empty folder on an NTFS volume.';
          const r = S.checkAccessPath(data.folder);
          if (!r.ok) return mountError(r);
          data.folder = r.path.replace(/\\$/, '');
          return null;
        } },
      { id: 'format', title: 'Format Partition', subtitle: 'To store data on this partition, you must format it first.',
        render: () => {
          c.fs = field('fs', F.select(fsList(data.sizeMB * MB), 'NTFS', { width: 150 }));
          c.au = field('au', F.select([{ value: '0', label: 'Default' }], '0', { width: 150 }));
          c.label = field('label', F.text({ value: data.label, width: 150, maxLength: 32 }));
          c.quick = field('quick', F.checkbox('Perform a quick format', true));
          c.compress = field('compress', F.checkbox('Enable file and folder compression', false));
          c.formatNo = radio('format', false, 'Do not format this volume', { on: paintFormat });
          c.formatYes = radio('format', true, 'Format this volume with the following settings:', { on: paintFormat });
          c.fs.addEventListener('change', () => { fillAu(); paintFormat(); });
          c.au.addEventListener('change', paintFormat);
          fillAu(); paintFormat();
          const lw2 = { labelWidth: 140 };
          return h('div.dm-wz', h('p.dm-p', 'Choose whether you want to format this volume, and if so, what settings you want to use.'),
            c.formatNo, c.formatYes,
            h('div.dm-indent', F.row('File system:', c.fs, lw2), F.row('Allocation unit size:', c.au, lw2), F.row('Volume label:', c.label, lw2), c.quick, c.compress));
        },
        enter: () => {
          // FAT32 is offered only for volumes up to 32 GB
          const cur = c.fs.value, list = fsList(data.sizeMB * MB);
          U.clear(c.fs);
          for (const x of list) c.fs.appendChild(h('option', { value: x }, x));
          c.fs.value = list.includes(cur) ? cur : 'NTFS';
          if (c.fs.value !== cur) fillAu();
          paintFormat();
        },
        validate: () => {
          data.format = c.formatYes.checked;
          if (!data.format) return null;
          data.fs = c.fs.value; data.au = +c.au.value; data.label = c.label.value; data.quick = c.quick.checked; data.compress = c.compress.checked;
          if (data.label.length > (data.fs === 'FAT32' ? 11 : 32)) return 'The volume label is not valid. Please enter a valid volume label.';
          return null;
        } },
      { id: 'complete', kind: 'complete', title: 'Completing the New Simple Volume Wizard', rerender: true,
        render: () => {
          const lines = [['Volume type', 'Simple Volume'], ['Disk selected', `Disk ${n}`], ['Volume size', `${data.sizeMB} MB`],
            ['Drive letter or path', data.letterMode === 'assign' ? data.letter + ':' : data.letterMode === 'mount' ? data.folder : 'None'],
            ...(data.format ? [['File system', data.fs], ['Allocation unit size', data.au ? auLabel(data.au) : 'Default'], ['Volume label', data.label], ['Quick format', data.quick ? 'Yes' : 'No']] : [['File system', 'None']])];
          return h('div.dm-wtext', h('p', 'You have successfully completed the New Simple Volume Wizard.'), h('p', 'You selected the following settings:'),
            h('div.dm-summary', { dataset: { field: 'summary' } }, ...lines.map(([k, v]) => h('div', `${k}: ${v}`))), h('p', 'To close this wizard, click Finish.'));
        } }
    ];
    return WS.ui.wizard({ title: W, style: 'classic', icon: ICON.app, width: 560, height: 440, data, pages,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, data); },
      onFinish: () => {
        const r = S.newPartition(n, { size: data.sizeMB * MB, letter: data.letterMode === 'assign' ? data.letter : null, offset: region.offset });
        if (!r.ok) return r;
        if (data.format) {
          const f = S.format({ disk: r.disk, part: r.partition }, { fs: data.fs, label: data.label, au: data.au, compress: data.compress });
          if (!f.ok) return f;
        }
        if (data.letterMode === 'mount') { const a = S.addAccessPath(r.disk.number, r.partition.number, data.folder); if (!a.ok) return { ok: false, error: mountError(a) }; }
        if (opts.ctl) opts.ctl.select(partId(r.disk, r.partition));
        return true;
      } }).then(res => (res.finished ? data : null));
  }

  /** Format X: (or an unlettered partition): asks before it wipes the volume. */
  function format(id, opts = {}) {
    const o = resolve(id);
    if (!o || o.kind !== 'part') return Promise.resolve(null);
    const { disk: d, part: p } = o;
    const title = p.letter ? `Format ${p.letter}:` : 'Format';
    if (p.letter === 'C') return err('Windows cannot format this volume. It contains the version of Windows that you are using. Formatting this volume could cause your computer to stop working.', title).then(() => null);
    const c = {};
    c.label = field('label', F.text({ value: p.fs ? p.label : 'New Volume', width: 190, maxLength: 32 }));
    c.fs = field('fs', F.select(fsList(p.size), fsList(p.size).includes(p.fs) ? p.fs : 'NTFS', { width: 190 }));
    c.au = field('au', F.select([], '0', { width: 190 }));
    c.quick = field('quick', F.checkbox('Perform a quick format', true));
    c.compress = field('compress', F.checkbox('Enable file and folder compression', false));
    const fillAu = () => { U.clear(c.au); c.au.appendChild(h('option', { value: '0' }, 'Default')); for (const b of (S.AU[c.fs.value] || []).slice().sort((x, y) => x - y)) c.au.appendChild(h('option', { value: String(b) }, auLabel(b))); };
    const paint = () => { const ok = c.fs.value === 'NTFS' && (+c.au.value || 4096) <= 4096; c.compress.input.disabled = !ok; if (!ok) c.compress.checked = false; };
    c.fs.addEventListener('change', () => { fillAu(); paint(); }); c.au.addEventListener('change', paint);
    fillAu(); paint();
    const lw = { labelWidth: 130 };
    return formDialog({ title, width: 380, onCreate: opts.onCreate,
      content: h('div.dm-form', F.row('Volume label:', c.label, lw), F.row('File system:', c.fs, lw), F.row('Allocation unit size:', c.au, lw), c.quick, c.compress),
      ok: async () => {
        const ans = await WS.ui.msgbox({ title, icon: 'warning', message: 'Formatting this volume will erase all data on it. Back up any data you want to keep before formatting. Do you want to continue?', buttons: ['OK', 'Cancel'] });
        if (ans !== 'OK') return false;
        const r = S.format({ disk: d, part: p }, { fs: c.fs.value, label: c.label.value, au: +c.au.value, compress: c.compress.checked });
        return r.ok ? true : r;
      } });
  }

  /** Disk Management's wording for a folder that can't hold a mount point. */
  const mountError = r => ({ PathNotFound: 'The path you specified does not exist. Specify an existing empty folder on an NTFS volume.',
    NotEmpty: 'The folder you specified is not empty. You can mount a drive only in an empty folder on an NTFS volume.',
    NotNtfs: 'You can mount a drive only in an empty folder on an NTFS volume. The folder you specified is not on an NTFS volume.',
    InUse: 'The path you specified is already in use by another volume.', SameVolume: 'You cannot mount a drive in a folder on the same drive.',
    InvalidPath: 'The path you specified is not valid. Specify the full path of an empty folder, such as C:\\Data.' }[r.code] || r.error);
  /** Add/Change Drive Letter or Path: the letter radio, and "Mount in the following empty NTFS folder" with its path and Browse.... */
  function mountControls(o) {
    const g = U.uid('mnt');
    const folder = field('folder', F.text({ value: o.folder || '', width: 230, disabled: true }));
    const browse = F.button('Browse...', async () => {
      const p = await WS.ui.filePicker({ mode: 'folder', title: 'Browse for Drive Path', prompt: 'Select an empty folder on an NTFS volume.', path: folder.value || 'C:\\' });
      if (p) { folder.value = p; folder.dispatchEvent(new Event('input')); }
    }, { disabled: true });
    let mode = o.mode;
    const paint = () => { o.letter.disabled = mode !== 'assign'; folder.disabled = browse.disabled = mode !== 'mount'; };
    const radio = (m, label, dis) => field(m, F.radio(g, label, mode === m, { disabled: !!dis, onChange: on => { if (on) { mode = m; paint(); } } }));
    const r = { assign: radio('assign', 'Assign the following drive letter:', o.noLetter), mount: radio('mount', 'Mount in the following empty NTFS folder:', o.noMount) };
    paint();
    return { ...r, folder, browse, mode: () => mode };
  }

  /** Change Drive Letter and Paths for a volume or the DVD drive; Add/Change/Remove apply at once, as in Windows. */
  function changeLetter(id, opts = {}) {
    const o = resolve(id);
    if (!o || (o.kind !== 'part' && o.kind !== 'cdrom')) return Promise.resolve(null);
    const cd = o.kind === 'cdrom';
    const cur = () => (cd ? S.cdrom().letter : resolve(id) && resolve(id).part.letter);
    const folders = () => (cd ? [] : (S.volumeAt(o.disk.number, o.part.number) || { paths: [] }).paths);
    const name = () => (cd ? `${cur() ? cur() + ': ' : ''}()` : volName(o.disk, resolve(id).part));
    const box = field('paths', h('select.inp.dm-paths', { size: 6 }));
    const frame = WS.ui.modal({ title: `Change Drive Letter and Paths for ${name()}`, width: 420, className: 'w32-dlg dm-dlg', closeValue: null });
    const add = field('add', F.button('Add...', () => edit(false))), change = field('change', F.button('Change...', () => edit(true))), remove = field('remove', F.button('Remove', () => drop()));
    const selected = () => box.value || '';
    const isLetter = x => /^[A-Z]:$/.test(x);
    const buttons = () => { change.disabled = !isLetter(selected()); remove.disabled = !selected(); };
    const paint = () => {
      U.clear(box);
      const items = [...(cur() ? [cur() + ':'] : []), ...folders()];
      items.forEach((x, i) => box.appendChild(h('option', { value: x, selected: i === 0 }, x)));
      // a volume can have one letter and any number of folder paths; the DVD drive only a letter here
      add.disabled = cd ? !!cur() : false;
      buttons();
      frame.setTitle(`Change Drive Letter and Paths for ${name()}`);
    };
    box.addEventListener('change', buttons);
    const apply = l => (cd ? S.setCdromLetter(l) : cur() ? S.setLetter(cur(), l) : S.assignLetter(o.disk.number, o.part.number, l));
    async function edit(isChange) {
      const letters = S.freeLetters();
      const sel = field('letter', F.select(letters.map(l => ({ value: l, label: l })), isChange ? letters.find(l => l > cur()) || letters[0] : S.nextLetter() || letters[0], { width: 60 }));
      const m = mountControls({ letter: sel, mode: !isChange && cur() ? 'mount' : 'assign', noLetter: !isChange && !!cur(), noMount: cd || isChange });
      const content = h('div.dm-form', isChange ? h('p.dm-p', `Enter a new drive letter or path for ${name()}.`) : null,
        h('div.dm-line', m.assign, sel), m.mount, h('div.dm-indent.dm-line', m.folder, m.browse));
      const r = await formDialog({ title: isChange ? 'Change Drive Letter or Path' : 'Add Drive Letter or Path', width: 400, content, onCreate: opts.onEdit,
        ok: async () => {
          if (m.mode() === 'mount') {
            if (!m.folder.value.trim()) return 'Specify the path of an empty folder on an NTFS volume.';
            const res = S.addAccessPath(o.disk.number, o.part.number, m.folder.value);
            return res.ok ? true : mountError(res);
          }
          if (isChange && cur()) {
            const ans = await WS.ui.msgbox({ title: TITLE, icon: 'warning', message: 'Some programs that rely on drive letters might not run correctly. Do you want to continue?', buttons: ['Yes', 'No'] });
            if (ans !== 'Yes') return false;
          }
          const res = apply(sel.value);
          return res.ok ? true : res;
        } });
      if (r) paint();
    }
    async function drop() {
      const x = selected();
      if (!x) return;
      const letter = isLetter(x);
      const ans = await WS.ui.msgbox({ title: TITLE, icon: 'warning', message: letter ? 'Some programs that rely on drive letters might not run correctly. Are you sure you want to remove this drive letter?' : 'Some programs that rely on drive paths might not run correctly. Are you sure you want to remove this drive path?', buttons: ['Yes', 'No'] });
      if (ans !== 'Yes') return;
      const r = letter ? apply(null) : S.removeAccessPath(o.disk.number, o.part.number, x);
      if (!r.ok) await err(r);
      paint();
    }
    frame.body.appendChild(h('div.w32.dm-form', h('div', 'Allow access to this volume by using the following drive letter and paths:'), box, h('div.dm-btns', add, change, remove)));
    const okBtn = h('button.btn.primary', { onClick: () => frame.close(true) }, 'OK');
    frame.footer.append(okBtn, h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = () => frame.close(true); frame.onEscape = () => frame.close(null);
    Object.assign(frame, { add: () => edit(false), change: () => edit(true), remove: drop, select: x => { box.value = x; buttons(); } });
    paint();
    if (opts.onCreate) opts.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /** Extend Volume Wizard: a basic volume can only grow into the free space right after it on the same disk. */
  function extend(id, opts = {}) {
    const o = resolve(id);
    if (!o || o.kind !== 'part' || !o.part.letter) return Promise.resolve(null);
    const { disk: d, part: p } = o;
    const sz = S.supportedSize(p.letter);
    const availMB = mb(sz.max - p.size);
    if (availMB < 1) return err('There is not enough space available on the disk(s) to complete this operation.', 'Extend Volume Wizard').then(() => null);
    const W = 'Extend Volume Wizard', data = { addMB: availMB }, c = {};
    const pages = [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the Extend Volume Wizard',
        render: () => h('div.dm-wtext', h('p', 'This wizard helps you increase the size of simple and spanned volumes. You can extend a volume by adding space from one or more additional disks.'), h('p', 'To continue, click Next.')) },
      { id: 'disks', title: 'Select Disks', subtitle: 'You can use space on one or more disks to extend the volume.',
        render: () => {
          c.amount = field('amount', F.number({ value: availMB, min: 1, max: availMB, width: 110 }));
          const total = F.value(mb(p.size) + availMB);
          c.amount.addEventListener('input', () => { total.textContent = String(mb(p.size) + (+c.amount.value || 0)); });
          const lw = { labelWidth: 230 };
          return h('div.dm-wz',
            h('p.dm-p', 'You can only extend the volume to the available space shown below because the disk cannot be converted to dynamic or the volume being extended is a boot or system volume.'),
            h('div.dm-pick', h('div', h('div.dm-lbl', 'Available:'), h('div.dm-listbox.dm-pickbox')),
              h('div.dm-pickbtns', F.button('Add >', () => {}, { disabled: true }), F.button('< Remove', () => {}, { disabled: true }), F.button('<< Remove All', () => {}, { disabled: true })),
              h('div', h('div.dm-lbl', 'Selected:'), h('div.dm-listbox.dm-pickbox', h('div.dm-pickrow.sel', h('span', `Disk ${d.number}`), h('span', `${availMB} MB`))))),
            F.row('Total volume size in megabytes (MB):', total, lw), F.row('Maximum available space in MB:', F.value(availMB), lw), F.row('Select the amount of space in MB:', c.amount, lw));
        },
        validate: () => {
          const v = +c.amount.value;
          if (!Number.isInteger(v) || v < 1 || v > availMB) return `The amount of space you specified is not valid. Specify a size between 1 MB and ${availMB} MB.`;
          data.addMB = v; return null;
        } },
      { id: 'complete', kind: 'complete', title: 'Completing the Extend Volume Wizard', rerender: true,
        render: () => h('div.dm-wtext', h('p', 'You have successfully completed the Extend Volume Wizard.'), h('p', 'You selected the following settings:'),
          h('div.dm-summary', h('div', `Disks selected: Disk ${d.number}`), h('div', `Space added: ${data.addMB} MB`), h('div', `Total volume size: ${mb(p.size) + data.addMB} MB`)), h('p', 'To close this wizard, click Finish.')) }
    ];
    return WS.ui.wizard({ title: W, style: 'classic', icon: ICON.app, width: 560, height: 470, data, pages,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, data); },
      onFinish: () => { const r = S.resize(p.letter, p.size + data.addMB * MB); return r.ok ? true : r; } }).then(res => (res.finished ? data : null));
  }

  /** Shrink X: - queries the shrink space first, as Disk Management does. */
  async function shrink(id, opts = {}) {
    const o = resolve(id);
    if (!o || o.kind !== 'part' || !o.part.letter) return null;
    const p = o.part, L = p.letter;
    const q = WS.ui.progress({ title: 'Querying Shrink Space', text: 'Querying volume for available shrink space, please wait...' });
    for (const pct of [30, 70, 100]) { q.set(pct); await U.sleep(120); }
    q.close();
    const sz = S.supportedSize(L);
    const availMB = Math.max(0, mb(p.size - sz.min));
    if (availMB < 1) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: 'There is not enough space available on the volume to shrink it.' }); return null; }
    const amount = field('amount', F.number({ value: availMB, min: 1, max: availMB, width: 110 }));
    const after = F.value(mb(p.size) - availMB);
    amount.addEventListener('input', () => { after.textContent = String(mb(p.size) - (+amount.value || 0)); });
    const lw = { labelWidth: 260 };
    const content = h('div.dm-form',
      F.row('Total size before shrink in MB:', F.value(mb(p.size)), lw), F.row('Size of available shrink space in MB:', F.value(availMB), lw),
      F.row('Enter the amount of space to shrink in MB:', amount, lw), F.row('Total size after shrink in MB:', after, lw),
      h('div.dm-note', 'You cannot shrink a volume beyond the point where any unmovable files are located. See the "defrag" event in the Application log for detailed information about the operation when it has completed.'),
      h('div.dm-note', 'See "Shrink a Basic Volume" in Disk Management help for more information'));
    return formDialog({ title: `Shrink ${L}:`, width: 470, okLabel: 'Shrink', content, onCreate: opts.onCreate, errorTitle: TITLE,
      ok: () => {
        const v = +amount.value;
        if (!Number.isInteger(v) || v < 1 || v > availMB) return 'The specified shrink size is too big and will cause the volume to be smaller than the minimum volume size.';
        const r = S.resize(L, p.size - v * MB);
        return r.ok ? v : r;
      } });
  }

  async function deleteVolume(id) {
    const o = resolve(id);
    if (!o || o.kind !== 'part') return null;
    const { disk: d, part: p } = o;
    if (p.letter === 'C' || sysPart(p)) { await err('The operation is not supported on this partition.'); return null; }
    const ans = await WS.ui.msgbox({ title: 'Delete simple volume', icon: 'warning', message: 'Deleting this volume will erase all data on it. Back up any data you want to keep before deleting. Do you want to continue?', buttons: ['Yes', 'No'] });
    if (ans !== 'Yes') return null;
    const r = S.deletePartition(d.number, p.number);
    if (!r.ok) { await err(r); return null; }
    return r;
  }

  async function markActive(id) {
    const o = resolve(id);
    if (!o || o.kind !== 'part') return null;
    const ans = await WS.ui.msgbox({ title: TITLE, icon: 'warning', message: 'The partition you have selected will be marked as active, but it does not contain a valid operating system. This might prevent your computer from starting. Do you want to continue?', buttons: ['Yes', 'No'] });
    if (ans !== 'Yes') return null;
    const r = S.setActive(o.disk.number, o.part.number);
    if (!r.ok) { await err(r); return null; }
    return r;
  }

  const openVolume = p => WS.apps.launch('explorer', { path: p.letter + ':\\' });

  /* ================================================================ property sheets */
  function deviceGeneral(name, type, maker, location) {
    return h('div',
      h('div.dm-devhead', h('span.dm-devic', { html: type === 'DVD/CD-ROM drives' ? ICON.cdrom : ICON.disk }), h('span', name)),
      F.row('Device type:', F.value(type), { labelWidth: 100 }), F.row('Manufacturer:', F.value(maker), { labelWidth: 100 }), F.row('Location:', F.value(location), { labelWidth: 100 }),
      F.group('Device status', h('div.dm-status', 'This device is working properly.')));
  }
  function driverTab(date) {
    return h('div',
      F.row('Driver Provider:', F.value('Microsoft'), { labelWidth: 110 }), F.row('Driver Date:', F.value(date), { labelWidth: 110 }),
      F.row('Driver Version:', F.value(`10.0.${WS.state.system.build || 26100}.1`), { labelWidth: 110 }), F.row('Digital Signer:', F.value('Microsoft Windows'), { labelWidth: 110 }),
      h('div.dm-drvbtns', F.button('Driver Details', () => {}, { disabled: true }), F.button('Update Driver', () => {}, { disabled: true }),
        F.button('Roll Back Driver', () => {}, { disabled: true }), F.button('Disable Device', () => {}, { disabled: true }), F.button('Uninstall Device', () => {}, { disabled: true })));
  }
  /** The disk's device Properties (Disk Management: right-click the disk > Properties). */
  function diskProperties(n, opts = {}) {
    const d = S.disks().find(x => x.number === +n);
    if (!d) return Promise.resolve(false);
    return WS.ui.propertySheet({ title: `${d.model} Properties`, width: 420, onCreate: opts.onCreate, initialTab: opts.tab === 'Volumes' ? 2 : 0,
      tabs: [
        { label: 'General', render: () => deviceGeneral(d.model, 'Disk drives', '(Standard disk drives)', `Bus Number 0, Target Id 0, LUN ${d.number}`) },
        { label: 'Policies', render: () => h('div',
          F.group('Write-caching policy', F.checkbox('Enable write caching on the device', true, { disabled: true }),
            h('div.dm-note', 'Improves system performance by enabling write caching on the device, but a power outage or equipment failure might result in data loss or corruption.'),
            F.checkbox('Turn off Windows write-cache buffer flushing on the device', false, { disabled: true }))) },
        { label: 'Volumes', render: () => {
          const lw = { labelWidth: 130 };
          const style = { GPT: 'GUID Partition Table (GPT)', MBR: 'Master Boot Record (MBR)', RAW: 'Not Applicable' }[d.style];
          const vols = d.online && d.style !== 'RAW' ? d.partitions.filter(p => !hidden(p)) : [];
          const reserved = d.partitions.filter(hidden).reduce((a, p) => a + p.size, 0);
          return h('div', F.row('Disk:', F.value(`Disk ${d.number}`), lw), F.row('Type:', F.value(diskType(d)), lw), F.row('Status:', F.value(diskStatus(d)), lw),
            F.row('Partition style:', F.value(style), lw), F.row('Capacity:', F.value(`${mb(d.size)} MB`), lw), F.row('Unallocated space:', F.value(`${mb(d.style === 'RAW' ? d.size : d.unallocated)} MB`), lw),
            F.row('Reserved space:', F.value(`${mb(reserved)} MB`), lw),
            h('div.dm-lbl', 'Volumes:'),
            h('div.dm-vols', h('div.dm-vrow.head', h('span', 'Volume'), h('span', 'Capacity')), ...vols.map(p => h('div.dm-vrow', h('span', volName(d, p)), h('span', `${mb(p.size)} MB`)))),
            h('div.dm-btns.right', F.button('Populate', () => {}, { disabled: true }), F.button('Properties', () => {}, { disabled: true })));
        } },
        { label: 'Driver', render: () => driverTab('6/21/2006') }
      ] });
  }
  function cdromProperties(opts = {}) {
    return WS.ui.propertySheet({ title: 'Microsoft Virtual DVD-ROM Properties', width: 420, onCreate: opts.onCreate,
      tabs: [{ label: 'General', render: () => deviceGeneral('Microsoft Virtual DVD-ROM', 'DVD/CD-ROM drives', '(Standard CD-ROM drives)', 'Bus Number 0, Target Id 0, LUN 2') },
        { label: 'Driver', render: () => driverTab('6/21/2006') }] });
  }

  /** The drive Properties sheet (General with the usage pie, Tools, Hardware, Sharing, Quota). */
  function volumeProperties(id, opts = {}) {
    const o = resolve(id);
    if (!o || o.kind !== 'part') return Promise.resolve(false);
    const { disk: d, part: p } = o;
    const v = S.volume(p.letter) || { size: p.size, used: S.usedBytes(p), free: p.size - S.usedBytes(p) };
    let labelBox;
    const tabs = [
      { label: 'General', render: () => {
        labelBox = field('label', F.text({ value: p.label, width: 220, maxLength: 32, readOnly: !p.fs }));
        const used = p.fs ? v.used : 0, free = p.fs ? v.free : p.size;
        const pct = p.size ? used / p.size * 100 : 0;
        const lw = { labelWidth: 90 };
        const line = (sw, label, b) => h('div.dm-useline', sw ? h('span.dm-sw.' + sw) : h('span.dm-sw.none'), h('span.dm-ul', label), h('span.dm-ub', bytes(b)), h('span.dm-us', shortSize(b)));
        return h('div',
          h('div.dm-devhead', h('span.dm-devic', { html: p.letter === 'C' ? ICON.volSys : ICON.vol }), labelBox),
          F.sep(),
          F.row('Type:', F.value('Local Disk'), lw), F.row('File system:', F.value(p.fs || 'RAW'), lw),
          F.sep(),
          line('used', 'Used space:', used), line('free', 'Free space:', free),
          F.sep(),
          line(null, 'Capacity:', p.size),
          h('div.dm-pierow', h('div.dm-pie', { style: { background: `conic-gradient(#1e64c8 0 ${pct}%, #d5d5d5 ${pct}% 100%)` } }),
            h('div.dm-pielbl', p.letter ? `Drive ${p.letter}:` : ''), F.button('Disk Cleanup', () => WS.apps.launch('cleanmgr'), { disabled: !p.letter })),
          F.sep(),
          F.checkbox('Compress this drive to save disk space', !!p.compressed, { disabled: true }),
          F.checkbox('Allow files on this drive to have contents indexed in addition to file properties', true, { disabled: true }));
      },
      apply: () => {
        if (!labelBox || labelBox.readOnly || labelBox.value === p.label) return null;
        return S.setLabel({ disk: d, part: p }, labelBox.value);
      } },
      { label: 'Tools', render: () => h('div',
        F.group('Error checking', h('div.dm-tool', h('div', 'This option will check the drive for file system errors.'), F.button('Check', () => checkDrive(p), { disabled: !p.fs || !p.letter }))),
        F.group('Optimize and defragment drive', h('div.dm-tool', h('div', "Optimizing your computer's drives can help it run more efficiently."), F.button('Optimize', () => WS.apps.launch('dfrgui'), { disabled: !p.fs })))) },
      { label: 'Hardware', render: () => {
        const rows = [...S.disks().map(x => [x.model, 'Disk drives']), ...(S.cdrom() ? [['Microsoft Virtual DVD-ROM', 'DVD/CD-ROM drives']] : [])];
        return h('div', h('div.dm-lbl', 'All disk drives:'),
          h('div.dm-vols', h('div.dm-vrow.head', h('span', 'Name'), h('span', 'Type')), ...rows.map(([a, b], i) => h('div.dm-vrow' + (i === d.number ? '.sel' : ''), h('span', a), h('span', b)))),
          F.group('Device Properties', F.row('Manufacturer:', F.value('(Standard disk drives)'), { labelWidth: 100 }), F.row('Location:', F.value(`Bus Number 0, Target Id 0, LUN ${d.number}`), { labelWidth: 100 }),
            F.row('Device status:', F.value('This device is working properly.'), { labelWidth: 100 })),
          h('div.dm-btns.right', F.button('Properties', () => diskProperties(d.number))));
      } },
      p.letter && p.fs ? { label: 'Sharing', render: () => sharingTab(p.letter + ':\\') } : null,
      p.fs === 'NTFS' ? { label: 'Quota', render: () => h('div',
        h('div.dm-line', h('span.dm-light'), h('span', 'Status:  Disk quotas are disabled')),
        F.checkbox('Enable quota management', false, { disabled: true }), F.checkbox('Deny disk space to users exceeding quota limit', false, { disabled: true }),
        F.note('Quotas are not modelled in the lab simulator.')) } : null
    ];
    return WS.ui.propertySheet({ title: `${volName(d, p)} Properties`, width: 410, onCreate: opts.onCreate, errorTitle: TITLE, tabs });
  }
  /** Explorer's Sharing tab for a drive or folder; Advanced Sharing... is the Shared Folders dialog. */
  function sharingTab(path) {
    const box = h('div');
    const paint = () => {
      U.clear(box);
      const shares = WS.smb.sharesFor(path).filter(s => !s.special);
      const unc = shares.length ? `\\\\${WS.sys.name}\\${shares[0].name}` : 'Not Shared';
      box.append(
        F.group('Network File and Folder Sharing', h('div.dm-line', h('span.dm-devic', { html: I.share }), h('div', h('div', path), h('div', shares.length ? 'Shared' : 'Not Shared'))),
          F.row('Network Path:', F.value(unc), { labelWidth: 90 }), F.button('Share...', () => {}, { disabled: true })),
        F.group('Advanced Sharing', h('div', 'Set custom permissions, create multiple shares, and set other advanced sharing options.'),
          F.button('Advanced Sharing...', async () => { if (WS.fsmgmt) await WS.fsmgmt.advancedSharing(path); else WS.apps.notImplemented('Advanced Sharing'); paint(); })));
    };
    paint();
    return box;
  }
  async function checkDrive(p) {
    const t = `Error Checking (${p.letter}:)`;
    const a = await WS.ui.msgbox({ title: t, icon: 'info', message: "You don't need to scan this drive", detail: "We haven't found any errors on this drive. You can still scan the drive for errors if you want.", buttons: ['Scan drive', 'Cancel'] });
    if (a !== 'Scan drive') return;
    const q = WS.ui.progress({ title: t, text: 'Scanning drive...' });
    for (const pct of [25, 60, 100]) { q.set(pct); await U.sleep(150); }
    q.close();
    await WS.ui.msgbox({ title: t, icon: 'info', message: 'Your drive was successfully scanned', detail: 'Windows successfully scanned the drive. No errors were found.', buttons: ['Close'] });
  }

  /* ================================================================ snap-in */
  function snapin() {
    const ctl = { mmc: null, sel: null, top: 'volumes', bottom: 'graphical', loading: true, prompted: false, panes: [], topHeight: null };
    const viewLabel = { volumes: '&Volume List', disks: '&Disk List', graphical: '&Graphical View' };
    const run = (fn, ...a) => Promise.resolve(fn(...a)).then(r => { refresh(); return r; });

    /* ---- context menus ---- */
    function menu(id) {
      const o = resolve(id);
      if (!o) return [HELP];
      if (o.kind === 'cdrom') return [{ label: '&Change Drive Letter and Paths...', action: () => run(changeLetter, 'cdrom') }, SEP, { label: 'P&roperties', action: () => cdromProperties() }, SEP, HELP];
      const d = o.disk, props = { label: 'P&roperties', action: () => diskProperties(d.number) };
      if (o.kind === 'disk') {
        if (!d.online) return [{ label: '&Online', action: () => run(online, d.number) }, SEP, props, SEP, HELP];
        if (d.style === 'RAW') return [{ label: '&Initialize Disk', action: () => run(initialize, { disks: [d.number] }) }, SEP, { label: 'O&ffline', action: () => run(offline, d.number) }, SEP, props, SEP, HELP];
        const empty = !d.partitions.some(p => !hidden(p));
        return [
          { label: 'New S&panned Volume...', disabled: true }, { label: 'New S&triped Volume...', disabled: true }, { label: 'New &Mirrored Volume...', disabled: true }, { label: 'New RAID-&5 Volume...', disabled: true },
          SEP, { label: 'Convert to D&ynamic Disk...', disabled: true },
          d.style === 'GPT' ? { label: 'Convert to MB&R Disk', disabled: !empty || d.boot, action: () => run(convert, d.number, 'MBR') } : { label: 'Convert to &GPT Disk', disabled: !empty || d.boot, action: () => run(convert, d.number, 'GPT') },
          SEP, { label: 'O&ffline', disabled: d.boot, action: () => run(offline, d.number) },
          SEP, props, SEP, HELP];
      }
      if (o.kind === 'free') {
        const usable = d.online && d.style !== 'RAW' && !(d.style === 'MBR' && d.partitions.length >= 4);
        return [{ label: 'New Si&mple Volume...', disabled: !usable, action: () => run(newSimpleVolume, d.number, { offset: o.region.offset, ctl }) },
          { label: 'New S&panned Volume...', disabled: true }, { label: 'New S&triped Volume...', disabled: true }, { label: 'New &Mirrored Volume...', disabled: true }, { label: 'New RAID-&5 Volume...', disabled: true },
          SEP, props, SEP, HELP];
      }
      const p = o.part;
      if (sysPart(p)) return [HELP];
      const isC = p.letter === 'C', sz = p.letter && p.fs ? S.supportedSize(p.letter) : null;
      const canExtend = !!sz && ['NTFS', 'ReFS'].includes(p.fs) && sz.max - p.size >= MB;
      const canShrink = !!sz && p.fs === 'NTFS' && p.size - sz.min >= MB;
      return [
        { label: '&Open', disabled: !p.fs || !p.letter, action: () => openVolume(p) }, { label: '&Explore', disabled: !p.fs || !p.letter, action: () => openVolume(p) },
        SEP,
        { label: '&Mark Partition as Active', disabled: d.style !== 'MBR' || p.flags.includes('Active'), action: () => run(markActive, id) },
        { label: '&Change Drive Letter and Paths...', action: () => run(changeLetter, id) },
        { label: '&Format...', disabled: isC, action: () => run(format, id) },
        SEP,
        { label: 'E&xtend Volume...', disabled: !canExtend, action: () => run(extend, id) },
        { label: 'S&hrink Volume...', disabled: !canShrink, action: () => run(shrink, id) },
        { label: 'Add M&irror...', disabled: true },
        { label: '&Delete Volume...', disabled: isC, action: () => run(deleteVolume, id) },
        SEP, { label: 'P&roperties', action: () => volumeProperties(id) }, SEP, HELP];
    }
    function popup(id, x, y, kb) { select(id); WS.ui.contextMenu(x, y, menu(id), { keyboard: kb }); }
    const activate = id => { const o = resolve(id); if (!o) return; if (o.kind === 'part' && !sysPart(o.part)) volumeProperties(id); else if (o.kind === 'disk' || o.kind === 'free') diskProperties(o.disk.number); else if (o.kind === 'cdrom') cdromProperties(); };

    /* ---- list panes ---- */
    function volumeRows() {
      const rows = [];
      for (const d of S.disks()) {
        if (!d.online || d.style === 'RAW') continue;
        for (const p of d.partitions) {
          if (hidden(p)) continue;
          const used = p.fs && !sysPart(p) ? S.usedBytes(p) : 0, free = Math.max(0, p.size - used);
          rows.push({ id: partId(d, p), name: volName(d, p), layout: 'Simple', type: 'Basic', fs: sysPart(p) ? '' : p.fs || 'RAW', status: volStatus(p), size: p.size, free, pct: Math.round(free / p.size * 100), boot: p.letter === 'C' });
        }
      }
      return rows;
    }
    function diskRows() {
      const style = { GPT: 'GPT', MBR: 'MBR', RAW: '' };
      const rows = S.disks().map(d => ({ id: 'disk:' + d.number, name: `Disk ${d.number}`, num: d.number, type: diskType(d), size: d.size, unalloc: d.style === 'RAW' ? d.size : d.unallocated, status: diskStatus(d), device: 'SCSI', style: style[d.style], off: !d.online || d.style === 'RAW' }));
      if (S.cdrom()) rows.push({ id: 'cdrom', name: 'CD-ROM 0', num: 1000, type: 'DVD', size: 0, unalloc: 0, status: 'No Media', device: 'SCSI', style: '', cd: true });
      return rows;
    }
    function listPane(kind) {
      const vol = kind === 'volumes';
      const cols = vol ? [
        { key: 'name', label: 'Volume', width: 160 }, { key: 'layout', label: 'Layout', width: 56 }, { key: 'type', label: 'Type', width: 50 }, { key: 'fs', label: 'File System', width: 76 },
        { key: 'status', label: 'Status', width: 300 },
        { key: 'size', label: 'Capacity', width: 74, align: 'right', type: 'num', render: r => size(r.size) },
        { key: 'free', label: 'Free Space', width: 74, align: 'right', type: 'num', render: r => size(r.free) },
        { key: 'pct', label: '% Free', width: 54, align: 'right', type: 'num', render: r => r.pct + ' %' }
      ] : [
        { key: 'num', label: 'Disk', width: 90, type: 'num', render: r => r.name }, { key: 'type', label: 'Type', width: 70 },
        { key: 'size', label: 'Capacity', width: 90, align: 'right', type: 'num', render: r => (r.cd ? '' : size(r.size)) },
        { key: 'unalloc', label: 'Unallocated Space', width: 120, align: 'right', type: 'num', render: r => (r.cd ? '' : size(r.unalloc)) },
        { key: 'status', label: 'Status', width: 100 }, { key: 'device', label: 'Device Type', width: 90 }, { key: 'style', label: 'Partition Style', width: 100 }
      ];
      let syncing = false;
      const lv = WS.ui.listView({
        columns: cols, rows: () => (ctl.loading ? [] : vol ? volumeRows() : diskRows()), getId: r => r.id, multi: false, sortKey: vol ? 'name' : 'num', emptyText: '',
        icon: r => (vol ? (r.boot ? ICON.volSys : ICON.vol) : r.cd ? ICON.cdrom : r.off ? ICON.diskDown : ICON.disk),
        onSelect: rows => { if (!syncing && rows[0]) select(rows[0].id, lv); },
        onActivate: r => activate(r.id),
        onContext: (rows, x, y, kb) => { if (rows[0]) popup(rows[0].id, x, y, kb); }
      });
      return { kind, el: lv.el, lv, refresh: () => lv.refresh(), sync: id => { syncing = true; try { const has = lv.rows().some(r => r.id === id); lv.select(has ? [id] : []); } finally { syncing = false; } } };
    }

    /* ---- graphical pane ---- */
    function regions(d) {
      if (d.style === 'RAW') return [{ id: `free:${d.number}:raw`, kind: 'free', size: d.size }];
      if (!d.online) return [{ id: 'disk:' + d.number, kind: 'offline', size: d.size }];
      const items = d.partitions.filter(p => !hidden(p)).map(p => ({ id: partId(d, p), kind: 'part', part: p, offset: p.offset, size: p.size }));
      for (const r of S.freeRegions(d.number)) items.push({ id: `free:${d.number}:${r.offset}`, kind: 'free', offset: r.offset, size: r.size });
      return items.sort((a, b) => a.offset - b.offset);
    }
    function regionEl(d, r) {
      const lines = [];
      if (r.kind === 'part') {
        const p = r.part;
        if (p.letter || p.label) lines.push(h('b', volName(d, p)));
        lines.push(h('div', sysPart(p) ? size(p.size) : `${size(p.size)} ${p.fs || 'RAW'}`));
        lines.push(h('div', volStatus(p)));
      } else if (r.kind === 'free') { lines.push(h('div', size(r.size)), h('div', 'Unallocated')); }
      else lines.push(h('div', size(r.size)));
      const el = h('div.dm-reg' + (ctl.sel === r.id ? '.sel' : ''), { dataset: { id: r.id }, style: { flex: `${Math.max(1, r.size / MB)} 1 0px` } },
        r.kind === 'offline' ? null : h('div.dm-bar.' + (r.kind === 'free' ? 'free' : 'prim')), h('div.dm-rtext', ...lines));
      return el;
    }
    function graphPane() {
      const el = h('div.dm-graph', { tabIndex: 0 });
      const paint = () => {
        const top = el.scrollTop;
        U.clear(el);
        if (ctl.loading) return;
        for (const d of S.disks()) {
          const bad = !d.online || d.style === 'RAW';
          const hid = 'disk:' + d.number;
          el.appendChild(h('div.dm-disk',
            h('div.dm-dhead' + (ctl.sel === hid ? '.sel' : ''), { dataset: { id: hid }, title: !d.online ? 'Offline (The disk is offline because of policy set by an administrator)' : d.style === 'RAW' ? 'Not Initialized' : '' },
              h('span.dm-dic', { html: bad ? ICON.diskDown : ICON.disk }),
              h('div.dm-dtext', h('b', `Disk ${d.number}`), h('div', diskType(d)), h('div', size(d.size)), h('div', diskStatus(d)))),
            h('div.dm-regs', ...regions(d).map(r => regionEl(d, r)))));
        }
        const cd = S.cdrom();
        if (cd) el.appendChild(h('div.dm-disk.cd',
          h('div.dm-dhead' + (ctl.sel === 'cdrom' ? '.sel' : ''), { dataset: { id: 'cdrom' } }, h('span.dm-dic', { html: ICON.cdrom }),
            h('div.dm-dtext', h('b', 'CD-ROM 0'), h('div', `DVD${cd.letter ? ` (${cd.letter}:)` : ''}`), h('div', ' '), h('div', 'No Media'))),
          h('div.dm-regs.empty')));
        el.scrollTop = top;
      };
      const hit = e => e.target.closest('[data-id]');
      el.addEventListener('pointerdown', e => { const t = hit(e); if (t && e.button <= 2) select(t.dataset.id); });
      el.addEventListener('dblclick', e => { const t = hit(e); if (t) activate(t.dataset.id); });
      el.addEventListener('contextmenu', e => { e.preventDefault(); const t = hit(e); if (t) popup(t.dataset.id, e.clientX, e.clientY); });
      el.addEventListener('keydown', e => {
        if (WS.ui.menusOpen()) return;
        if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && ctl.sel) {
          e.preventDefault();
          const t = el.querySelector(`[data-id="${CSS.escape(ctl.sel)}"]`), b = (t || el).getBoundingClientRect();
          WS.ui.contextMenu(b.left + 20, b.top + 20, menu(ctl.sel), { keyboard: true });
        }
      });
      // selection only moves the hatching, so the region under the pointer survives for dblclick/contextmenu
      const mark = () => el.querySelectorAll('[data-id]').forEach(x => x.classList.toggle('sel', x.dataset.id === ctl.sel));
      return { kind: 'graphical', el, refresh: paint, sync: mark };
    }
    const legend = () => h('div.dm-legend', h('span', h('span.dm-sw.free'), 'Unallocated'), h('span', h('span.dm-sw.prim'), 'Primary partition'));

    /* ---- layout ---- */
    let host = null;
    function build() {
      if (!host) return;
      U.clear(host);
      const make = k => (k === 'graphical' ? graphPane() : listPane(k));
      const top = make(ctl.top), bottom = ctl.bottom === 'hidden' ? null : make(ctl.bottom);
      ctl.panes = [top, bottom].filter(Boolean);
      const root = h('div.dm');
      const topBox = h('div.dm-pane.top' + (bottom ? '' : '.full'), top.el);
      if (bottom && ctl.topHeight) topBox.style.height = ctl.topHeight + 'px';
      root.appendChild(topBox);
      if (bottom) {
        const split = h('div.dm-split');
        dragSplit(split, topBox, root);
        root.append(split, h('div.dm-pane.bottom', bottom.el));
      }
      if (ctl.panes.some(p => p.kind === 'graphical')) root.appendChild(legend());
      host.appendChild(root);
      for (const p of ctl.panes) { p.refresh(); if (ctl.sel) p.sync(ctl.sel); }
    }
    function dragSplit(split, topBox, root) {
      split.addEventListener('pointerdown', e => {
        e.preventDefault();
        const y0 = e.clientY, h0 = topBox.offsetHeight;
        split.setPointerCapture(e.pointerId);
        const move = ev => { ctl.topHeight = U.clamp(h0 + ev.clientY - y0, 40, Math.max(60, root.offsetHeight - 90)); topBox.style.height = ctl.topHeight + 'px'; };
        const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); };
        split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
      });
    }
    function refresh() {
      if (ctl.sel && !resolve(ctl.sel)) ctl.sel = null;
      for (const p of ctl.panes) { p.refresh(); p.sync(ctl.sel); }
    }
    function select(id, from) {
      ctl.sel = resolve(id) ? id : null;
      for (const p of ctl.panes) if (p.lv !== from) p.sync(ctl.sel);
    }

    /* ---- the scope node ---- */
    const view = {
      render(container, mmc) {
        ctl.mmc = mmc;
        host = container;
        build();
        if (ctl.loading) setTimeout(() => {
          ctl.loading = false;
          if (!host || !host.isConnected) return;
          refresh();
          if (ctl.mmc) ctl.mmc.setStatus('');
          if (!ctl.prompted && S.disks().some(d => d.online && d.style === 'RAW')) { ctl.prompted = true; initialize({ onCreate: ctl.onInitPrompt }).then(() => refresh()); }
        }, 350);
        return { refresh };
      },
      status: () => (ctl.loading ? 'Connecting to Virtual Disk Service...' : '')
    };
    const node = {
      id: 'dm-root', label: TITLE, icon: ICON.app, view,
      menu: () => [
        { label: 'Re&scan Disks', action: () => ctl.rescan() },
        { label: 'Create &VHD', action: () => WS.apps.notImplemented('Create and Attach Virtual Hard Disk') },
        { label: 'A&ttach VHD', action: () => WS.apps.notImplemented('Attach Virtual Hard Disk') },
        SEP,
        { label: 'All Tas&ks', items: () => (ctl.sel ? WS.mmc.tidy(menu(ctl.sel).filter(x => x.separator || x.label !== '&Help')) : [{ label: '(Empty)', disabled: true }]) }
      ],
      viewMenu: () => [
        { label: '&Top', items: () => ['disks', 'volumes', 'graphical'].map(k => ({ label: viewLabel[k], radio: true, checked: ctl.top === k, disabled: ctl.bottom === k, action: () => ctl.setTop(k) })) },
        { label: '&Bottom', items: () => [...['disks', 'volumes', 'graphical'].map(k => ({ label: viewLabel[k], radio: true, checked: ctl.bottom === k, disabled: ctl.top === k, action: () => ctl.setBottom(k) })),
          { label: '&Hidden', radio: true, checked: ctl.bottom === 'hidden', action: () => ctl.setBottom('hidden') }] },
        SEP,
        { label: '&Settings...', disabled: true }
      ]
    };
    Object.assign(ctl, {
      menu, select: id => select(id), selected: () => ctl.sel, refresh,
      setTop(k) { if (k === ctl.bottom) return; ctl.top = k; build(); },
      setBottom(k) { if (k === ctl.top) return; ctl.bottom = k; build(); },
      async rescan() {
        const m = ctl.mmc;
        if (m) m.setStatus('Rescanning disks...');
        await U.sleep(300);
        refresh();
        if (m) m.setStatus('');
      },
      newSimpleVolume: (n, o = {}) => run(newSimpleVolume, n, { ...o, ctl })
    });
    return { node, ctl };
  }

  function launch(opts = {}) {
    const snap = snapin();
    if (opts.onInitPrompt) snap.ctl.onInitPrompt = opts.onInitPrompt;
    const mmc = WS.mmc.create({ app: 'diskmgmt', title: TITLE, icon: ICON.app, width: 1060, height: 680, showTree: false, topics: ['storage', 'smb'],
      nodes: [snap.node], viewMenu: snap.node.viewMenu });
    mmc.win.diskmgmt = snap.ctl;
    return mmc.win;
  }

  WS.diskmgmt = { launch, snapin, resolve, size, shortSize, volName, ICON,
    initialize, newSimpleVolume, format, changeLetter, extend, shrink, deleteVolume, markActive, online, offline, convert,
    diskProperties, volumeProperties, cdromProperties, sharingTab };
  WS.apps.register({ id: 'diskmgmt', name: TITLE, icon: ICON.app, launch, keywords: ['diskmgmt.msc', 'disk management', 'partition', 'volume', 'format'] });
})();
