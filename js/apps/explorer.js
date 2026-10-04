/* File Explorer over WS.fs: This PC (drives with free space), folder views, the navigation tree, an editable address bar,
 * search in the current folder, New folder / Text document, Rename, Delete and Properties (General, and Sharing for
 * folders and drives, whose Advanced Sharing... is the Shared Folders dialog). Drive Properties are Disk Management's.
 *   WS.apps.launch('explorer', { path }) -> win; win.explorer = { path(), go(path), up(), back(), select(names), newFolder(),
 *     newTextFile(), rename(name, newName), remove(names), properties(name?), items() }
 * Not built: copy/cut/paste and drag and drop, Recycle Bin (Delete is permanent and asks first), the ribbon's View options,
 * previews, compressed folders, and NTFS permissions (no Security tab). */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f;
  const PC = 'This PC', BIN = 'Recycle Bin';
  /** Explorer's clipboard is shared by every Explorer window: { paths[], cut } */
  let clip = null;
  const TEXT = /\.(txt|log|ini|ps1|bat|cmd|csv|xml|json|md|cfg|inf)$/i;
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = msg => WS.ui.msgbox({ title: 'File Explorer', icon: 'error', message: msg });
  const BAD = /[\\/:*?"<>|]/;
  const kb = b => `${(b ? Math.max(1, Math.ceil(b / 1024)) : 0).toLocaleString('en-US')} KB`;   // Explorer: 0 KB empty, then rounds up
  /** User policy "Hide these specified drives in My Computer" / "Prevent access to drives from My Computer": a bit per letter, A = 1. */
  const driveMask = opt => { const v = WS.gpo ? WS.gpo.policyOption('user', opt, opt) : null; return Number(v) || 0; };
  const hiddenDrive = l => !!(driveMask('NoDrives') & (1 << (l.charCodeAt(0) - 65))) || (WS.gpp && WS.gpp.hideAll()) || !!(WS.netuse && WS.netuse.get(l) && WS.netuse.get(l).hidden);
  const blockedDrive = p => /^[A-Z]:/i.test(p) && !!(driveMask('NoViewOnDrive') & (1 << (p[0].toUpperCase().charCodeAt(0) - 65)));
  const drives = () => [...WS.fs.drives(), ...(WS.storage.cdrom() && WS.storage.cdrom().letter ? [WS.storage.cdrom().letter] : [])].filter((x, i, a) => a.indexOf(x) === i && !hiddenDrive(x)).sort();
  /** Mapped network drives (net use, Group Policy Drive Maps): This PC's "Network locations" group. */
  const netDrives = () => (WS.netuse ? WS.netuse.list().map(d => d.letter).filter(l => !WS.state.fs.drives[l] && !hiddenDrive(l)) : []);
  const isRoot = p => /^[A-Z]:\\$/i.test(p) || /^\\\\[^\\]+\\[^\\]+$/.test(p);
  const label = l => WS.ui.driveLabel(l);
  const title = p => (p === PC || p === BIN ? p : /^[A-Z]:\\$/i.test(p) ? label(p[0].toUpperCase()) : /^\\\\[^\\]+\\[^\\]+$/.test(p) ? `${p.split('\\').pop()} (${p.split('\\').slice(0, 3).join('\\')})` : p.replace(/\\$/, '').split('\\').pop());
  const norm = p => (/^this pc$/i.test(p) ? PC : /^recycle bin$/i.test(p) ? BIN : WS.fs.full(p).replace(/^([A-Z]:)$/i, '$1\\'));
  const join = (dir, name) => (dir.endsWith('\\') ? dir : dir + '\\') + name;

  const NETICON = '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="7" rx="1" fill="#e8ecf1" stroke="#7a8696"/><rect x="3" y="5" width="6" height="1.6" fill="#7a8696"/><path d="M8 10v2.5M3 13.5h10" stroke="#4a8a2a" stroke-width="1.4"/></svg>';
  const NETICON_X = NETICON.replace('</svg>', '<circle cx="12" cy="12" r="3.3" fill="#d13438"/><path d="M10.6 10.6l2.8 2.8M13.4 10.6l-2.8 2.8" stroke="#fff" stroke-width="1.2"/></svg>');
  const netIcon = l => { const d = WS.netuse && WS.netuse.get(l); return d && WS.netuse.status(d) !== 'OK' ? NETICON_X : NETICON; };
  function launch(args = {}) {
    const win = WS.wm.create({ app: 'explorer', title: PC, icon: I.explorer, width: 1000, height: 600 });
    let cur = PC, list = null, filter = '';
    const back = [], fwd = [];
    const addr = field('address', h('input.inp.ex-addr', { spellcheck: false }));
    const search = field('search', h('input.inp.ex-search', { placeholder: 'Search', spellcheck: false }));
    const navBtn = (glyph, tip, fn) => h('button.ex-nav', { title: tip, onClick: fn }, glyph);
    const bBack = navBtn('←', 'Back', () => goBack()), bFwd = navBtn('→', 'Forward', () => goFwd()), bUp = navBtn('↑', 'Up', () => up());
    const cmd = h('div.ex-cmd'), main = h('div.ex-main'), status = h('div.ex-status');
    const tree = WS.ui.tree({ nodes: () => [{ id: PC, label: PC, icon: I.thisPC, expanded: true, children: () => [...drives().map(l => folderNode(l + ':\\', label(l), WS.storage.isCdrom(l) ? I.cdrom : l === 'C' ? I.driveSystem : I.drive)), ...netDrives().map(l => folderNode(l + ':\\', label(l), netIcon(l)))] }],
      onSelect: n => { if (n.id !== cur) go(n.id); } });
    function folderNode(path, text, icon) {
      return { id: path, label: text, icon: icon || I.folder, hasChildren: !WS.storage.isCdrom(path[0]),
        children: () => { try { return WS.fs.list(path).filter(x => x.type === 'dir' && !x.hidden).sort((a, b) => a.name.localeCompare(b.name)).map(x => folderNode(join(path, x.name), x.name)); } catch (e) { return []; } } };
    }
    win.body.appendChild(h('div.ex', h('div.ex-top', bBack, bFwd, bUp, addr, search), cmd, h('div.ex-body', h('div.ex-tree', tree.el), main), status));

    function go(path, o = {}) {
      let p;
      try { p = norm(String(path).trim()); } catch (e) { p = null; }
      if (p && p !== PC && p !== BIN) {
        if (blockedDrive(p)) { WS.ui.msgbox({ title: 'Restrictions', icon: 'warning', message: 'This operation has been cancelled due to restrictions in effect on this computer. Please contact your system administrator.' }); return false; }
        if (WS.storage.isCdrom(p[0])) { err(`${p[0]}:\\ is not accessible.\n\nThe device is not ready.`); return false; }
        if (/^\\\\/.test(p) || (WS.netuse && WS.netuse.get(p[0]) && !WS.state.fs.drives[p[0].toUpperCase()])) {
          const m = /^\\\\/.test(p) ? null : WS.netuse.get(p[0]);
          const r = WS.netuse.resolveUnc(m ? m.remote : p);
          if (!r.ok) { err(`${m ? p.slice(0, 3) : p.split('\\').slice(0, 4).join('\\')} is not accessible. You might not have permission to use this network resource. Contact the administrator of this server to find out if you have access permissions.\n\n${r.error}`); return false; }
        }
        const st = WS.fs.stat(p);
        if (!st) { err(`Windows can't find '${path}'. Check the spelling and try again.`); return false; }
        if (st.type !== 'dir') { openFile(p); return true; }
      }
      if (!p) { err(`Windows can't find '${path}'. Check the spelling and try again.`); return false; }
      if (!o.history && p !== cur) { back.push(cur); fwd.length = 0; }
      cur = p; filter = ''; search.value = '';
      render();
      return true;
    }
    const goBack = () => { if (!back.length) return; fwd.push(cur); go(back.pop(), { history: true }); };
    const goFwd = () => { if (!fwd.length) return; back.push(cur); go(fwd.pop(), { history: true }); };
    const up = () => { if (cur === PC || cur === BIN) return; const parent = isRoot(cur) ? PC : cur.replace(/\\[^\\]+$/, '').replace(/^([A-Z]:)$/i, '$1\\'); go(parent); };
    const openFile = p => (TEXT.test(p) ? WS.apps.launch('notepad', { path: p }) : err(`Windows can't open this file:\n\nFile: ${p.split('\\').pop()}\n\nThere is no app associated with this file type in the lab simulator.`));
    function items() {
      if (cur === PC) return [];
      if (cur === BIN) return WS.fs.recycleBin().filter(x => !filter || x.name.toLowerCase().includes(filter));
      try { return WS.fs.list(cur).filter(x => !x.hidden && (!filter || x.name.toLowerCase().includes(filter))); } catch (e) { return []; }
    }
    const selected = () => (list ? list.selected() : []);
    const unique = base => { let n = base, i = 2; const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''; const stem = ext ? base.slice(0, -ext.length) : base; while (WS.fs.exists(join(cur, n))) n = `${stem} (${i++})${ext}`; return n; };
    function newFolder() { const n = unique('New folder'); try { WS.fs.mkdir(join(cur, n)); } catch (e) { err(e.message); return null; } render(); list.select([n]); return n; }
    function newTextFile() { const n = unique('New Text Document.txt'); try { WS.fs.writeFile(join(cur, n), ''); } catch (e) { err(e.message); return null; } render(); list.select([n]); return n; }
    /** Rename in place, as Explorer does: the name cell becomes an edit box (Enter or click away commits, Esc cancels). */
    let renaming = null;
    function startRename(name) {
      const row = list && list.el.querySelector(`.lv-row[data-id="${CSS.escape(name)}"] [data-col="0"]`);
      if (!row) return null;
      renaming = name;
      const box = field('rename', h('input.inp.ex-rename', { value: name, spellcheck: false }));
      const text = row.querySelector('.lv-t');
      if (text) text.replaceWith(box); else row.appendChild(box);
      const dot = name.lastIndexOf('.');
      setTimeout(() => { box.focus(); box.setSelectionRange(0, dot > 0 && !WS.fs.isDir(join(cur, name)) ? dot : name.length); }, 10);
      let done = false;
      const finish = async commit => { if (done) return; done = true; renaming = null; if (commit) await rename(name, box.value); else render(); };
      box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
      box.addEventListener('pointerdown', e => e.stopPropagation());
      box.addEventListener('blur', () => finish(true));
      return box;
    }
    async function rename(name, newName) {
      if (newName == null) return startRename(name);
      const v = newName;
      if (v == null || v === name) { render(); return false; }
      const t = v.trim();
      if (!t || BAD.test(t)) { await err('A file name can\'t contain any of the following characters:\n\\ / : * ? " < > |'); return false; }
      if (WS.fs.exists(join(cur, t)) && t.toLowerCase() !== name.toLowerCase()) { await err(`There is already a file or folder with the name "${t}" in this location.`); return false; }
      try { WS.fs.rename(join(cur, name), t); } catch (e) { await err(e.code === 'AccessDenied' ? 'You need permission to perform this action.' : e.message); return false; }
      render(); list.select([t]);
      return true;
    }
    /** Delete moves items to the Recycle Bin without asking (the Windows Server default); Shift+Delete asks, then deletes permanently. */
    async function remove(names, o = {}) {
      names = [].concat(names);
      if (!names.length) return false;
      if (cur === BIN) return purge(names);
      // Do not move deleted files to the Recycle Bin (user policy) makes every delete permanent
      if (!o.permanent && !(WS.gpo && WS.gpo.policyEnabled('user', 'NoRecycleFiles'))) {
        for (const n of names) {
          try { WS.fs.recycle(join(cur, n)); } catch (e) { await err(e.code === 'AccessDenied' ? `You need permission to perform this action.\n\n${n}` : e.message); break; }
        }
        render();
        return true;
      }
      const one = names.length === 1 ? WS.fs.stat(join(cur, names[0])) : null;
      const q = one ? `Are you sure you want to permanently delete this ${one.type === 'dir' ? 'folder' : 'file'}?\n\n${one.name}` : `Are you sure you want to permanently delete these ${names.length} items?`;
      if ((await WS.ui.msgbox({ title: one ? (one.type === 'dir' ? 'Delete Folder' : 'Delete File') : 'Delete Multiple Items', icon: 'warning', message: q, buttons: ['Yes', 'No'] })) !== 'Yes') return false;
      for (const n of names) {
        try { WS.fs.remove(join(cur, n), null, { recursive: true }); } catch (e) { await err(e.code === 'AccessDenied' ? `You need permission to perform this action.\n\n${n}` : e.message); break; }
      }
      render();
      return true;
    }

    /* ---- Recycle Bin (ids are the bin item ids) ---- */
    async function purge(ids) {
      const q = ids.length === 1 ? `Are you sure you want to permanently delete this ${(WS.fs.recycleBin().find(x => x.id === ids[0]) || {}).type === 'dir' ? 'folder' : 'file'}?` : `Are you sure you want to permanently delete these ${ids.length} items?`;
      if ((await WS.ui.msgbox({ title: ids.length === 1 ? 'Delete File' : 'Delete Multiple Items', icon: 'warning', message: q, buttons: ['Yes', 'No'] })) !== 'Yes') return false;
      WS.fs.emptyRecycle(ids); render();
      return true;
    }
    async function emptyBin() { const all = WS.fs.recycleBin().map(x => x.id); return all.length ? purge(all) : false; }
    async function restore(ids) {
      for (const id of [].concat(ids)) { try { WS.fs.restore(id); } catch (e) { await err(e.message); break; } }
      render();
      return true;
    }

    /* ---- clipboard and drag and drop ---- */
    function setClip(names, cut) { clip = { paths: names.map(n => join(cur, n)), cut: !!cut }; render(); }
    /** "X - Copy", "X - Copy (2)" for a copy pasted into its own folder. */
    const copyName = (dir, name) => {
      const dot = name.lastIndexOf('.'), file = dot > 0 && !WS.fs.isDir(join(dir, name));
      const stem = file ? name.slice(0, dot) : name, ext = file ? name.slice(dot) : '';
      let n = `${stem} - Copy${ext}`, i = 2;
      while (WS.fs.exists(join(dir, n))) n = `${stem} - Copy (${i++})${ext}`;
      return n;
    };
    /** Copy or move paths into dir; returns the names created there. */
    async function transfer(paths, dir, move) {
      const made = [];
      for (const src of paths) {
        if (!WS.fs.exists(src)) continue;
        const name = src.split('\\').pop();
        const same = src.replace(/\\[^\\]+$/, '').replace(/^([A-Z]:)$/i, '$1\\').toLowerCase() === dir.toLowerCase();
        if (same && move) continue;
        let target = join(dir, same ? copyName(dir, name) : name), force = false;
        if (!same && WS.fs.exists(target)) {
          const a = await WS.ui.msgbox({ title: move ? 'Moving' : 'Copying', icon: 'warning', message: `The destination already has a ${WS.fs.isDir(target) ? 'folder' : 'file'} named "${name}".`, buttons: ['Replace', 'Skip', 'Cancel'] });
          if (a === 'Cancel' || a == null) break;
          if (a === 'Skip') continue;
          force = true;
          if (WS.fs.isDir(target)) WS.fs.remove(target, null, { recursive: true });
        }
        try {
          if (move) WS.fs.move(src, target, null, { recursive: true, force }); else WS.fs.copy(src, target, null, { recursive: true, force });
          made.push(target.split('\\').pop());
        } catch (e) { await err(e.code === 'AccessDenied' ? `You need permission to perform this action.\n\n${name}` : e.message); break; }
      }
      return made;
    }
    async function paste(dir = cur) {
      if (!clip || dir === PC || dir === BIN) return [];
      const made = await transfer(clip.paths, dir, clip.cut);
      if (clip.cut) clip = null;
      render();
      if (list && made.length) list.select(made);
      return made;
    }
    /** Drag and drop: a move on the same drive, a copy to another drive (Ctrl forces a copy), as Explorer does. */
    async function drop(paths, dir, ctrl) {
      if (dir === PC || dir === BIN || !paths.length) return [];
      const move = !ctrl && paths.every(p => p[0].toUpperCase() === dir[0].toUpperCase());
      const made = await transfer(paths, dir, move);
      render();
      return made;
    }
    /** Properties of an item in this folder (or of the folder itself / a drive). */
    function properties(name) {
      const path = name ? join(cur, name) : cur;
      if (/^[A-Z]:\\$/i.test(path)) {
        const hit = WS.storage.byLetter(path[0]);
        return hit ? WS.diskmgmt.volumeProperties(`part:${hit.disk.number}:${hit.part.number}`) : Promise.resolve(false);
      }
      const st = WS.fs.stat(path);
      if (!st) return Promise.resolve(false);
      if (st.junction) return mountProps(path, st);
      const dir = st.type === 'dir';
      let files = 0, folders = 0;
      if (dir) { const walk = p => { for (const x of WS.fs.list(p)) { if (x.type === 'dir') { folders++; walk(join(p, x.name)); } else files++; } }; try { walk(path); } catch (e) { /* unreadable */ } }
      const size = dir ? WS.fs.du(path) : st.size;
      const lw = { labelWidth: 100 };
      const tabs = [{ label: 'General', render: () => h('div',
        h('div.ex-phead', h('span.ex-pic', { html: dir ? I.folder : I.file }), F.text({ value: st.name, readOnly: true })), F.sep(),
        F.row('Type:', F.value(dir ? 'File folder' : WS.ui.fileTypeName(st.name, false)), lw), F.row('Location:', F.value(path.replace(/\\[^\\]+$/, '').replace(/^([A-Z]:)$/i, '$1\\')), lw),
        F.row('Size:', F.value(`${WS.diskmgmt.shortSize(size)} (${size.toLocaleString('en-US')} bytes)`), lw),
        dir ? F.row('Contains:', F.value(`${files.toLocaleString('en-US')} Files, ${folders.toLocaleString('en-US')} Folders`), lw) : null, F.sep(),
        F.row('Created:', F.value(U.fmtDateTime(st.created)), lw), F.row('Modified:', F.value(U.fmtDateTime(st.modified)), lw), F.sep(),
        F.row('Attributes:', h('span.ex-attrs', F.checkbox('Read-only', st.readOnly, { disabled: true }), F.checkbox('Hidden', st.hidden, { disabled: true })), lw)) }];
      if (dir) tabs.push({ label: 'Sharing', render: () => WS.diskmgmt.sharingTab(path) });
      return WS.ui.propertySheet({ title: `${st.name} Properties`, width: 400, tabs });
    }
    /** A mount point's Properties: Type Mounted Volume, and the volume it leads to (its Properties button opens the volume's). */
    function mountProps(path, st) {
      const v = WS.storage.volumeByPath(path);
      const lw = { labelWidth: 100 };
      const target = v ? `${v.label || 'Local Disk'}${v.letter ? ` (${v.letter}:)` : ''}` : st.junction;
      return WS.ui.propertySheet({ title: `${st.name} Properties`, width: 400, tabs: [{ label: 'General', render: () => h('div',
        h('div.ex-phead', h('span.ex-pic', { html: I.drive }), F.text({ value: st.name, readOnly: true })), F.sep(),
        F.row('Type:', F.value('Mounted Volume'), lw), F.row('Location:', F.value(path.replace(/\\[^\\]+$/, '').replace(/^([A-Z]:)$/i, '$1\\')), lw),
        F.row('Target:', h('span', { style: 'display:flex;align-items:center;gap:10px' }, F.value(target),
          F.button('Properties', () => WS.diskmgmt.volumeProperties(`part:${v.disk}:${v.partition}`), { disabled: !v })), lw), F.sep(),
        F.row('Created:', F.value(U.fmtDateTime(st.created)), lw)) }] });
    }
    const driveProps = l => { const hit = WS.storage.byLetter(l); return hit ? WS.diskmgmt.volumeProperties(`part:${hit.disk.number}:${hit.part.number}`) : null; };
    const itemMenu = rows => {
      const one = rows.length === 1 ? rows[0] : null, names = rows.map(r => r.name);
      if (cur === BIN) return [{ label: 'R&estore', default: true, action: () => restore(rows.map(r => r.id)) }, { separator: true }, { label: '&Delete', action: () => purge(rows.map(r => r.id)) }];
      return [
        one ? { label: '&Open', default: true, action: () => go(join(cur, one.name)) } : null,
        { separator: true },
        { label: 'Cu&t', shortcut: 'Ctrl+X', action: () => setClip(names, true) }, { label: '&Copy', shortcut: 'Ctrl+C', action: () => setClip(names, false) },
        one && one.type === 'dir' && clip ? { label: '&Paste', action: () => paste(join(cur, one.name)) } : null,
        { separator: true },
        { label: '&Delete', action: () => remove(names) },
        one ? { label: 'Rena&me', action: () => rename(one.name) } : null,
        { separator: true },
        one ? { label: 'P&roperties', action: () => properties(one.name) } : null
      ].filter(Boolean);
    };
    const bgMenu = () => (cur === BIN ? [{ label: '&Empty Recycle Bin', disabled: !WS.fs.recycleBin().length, action: () => emptyBin() }, { separator: true }, { label: 'Re&fresh', action: () => render() }] : [
      { label: '&New', items: () => [{ label: '&Folder', action: () => newFolder() }, { separator: true }, { label: 'Text Document', action: () => newTextFile() }] },
      { separator: true }, { label: '&Paste', shortcut: 'Ctrl+V', disabled: !clip, action: () => paste() },
      { separator: true }, { label: 'Re&fresh', action: () => render() }, { separator: true }, { label: 'P&roperties', action: () => properties() }
    ]);
    function paintCmd() {
      U.clear(cmd);
      const rows = selected(), inFolder = cur !== PC && cur !== BIN;
      const b = (text, fn, on = true) => h('button.ex-cbtn', { disabled: !on, onClick: fn }, text);
      if (cur === BIN) {
        const n = WS.fs.recycleBin().length;
        cmd.append(b('Empty Recycle Bin', () => emptyBin(), n > 0), b('Restore all items', () => restore(WS.fs.recycleBin().map(x => x.id)), n > 0 && !rows.length), b('Restore the selected items', () => restore(rows.map(r => r.id)), rows.length > 0));
      } else cmd.append(b('New ▾', e => WS.ui.popupMenu(e.currentTarget, () => bgMenu()[0].items()), inFolder),
        b('Cut', () => setClip(rows.map(r => r.name), true), inFolder && rows.length > 0), b('Copy', () => setClip(rows.map(r => r.name), false), inFolder && rows.length > 0), b('Paste', () => paste(), inFolder && !!clip),
        b('Rename', () => rows[0] && rename(rows[0].name), inFolder && rows.length === 1), b('Delete', () => remove(rows.map(r => r.name)), inFolder && rows.length > 0),
        b('Properties', () => (rows.length === 1 ? properties(rows[0].name) : properties()), inFolder || rows.length > 0));
      bBack.disabled = !back.length; bFwd.disabled = !fwd.length; bUp.disabled = cur === PC || cur === BIN;
      const n = cur === PC ? drives().length + netDrives().length : list ? list.rows().length : 0;
      status.textContent = `${n} item${n === 1 ? '' : 's'}${rows.length ? `    ${rows.length} item${rows.length === 1 ? '' : 's'} selected` : ''}`;
    }
    function render() {
      U.clear(main);
      list = null;
      addr.value = cur;
      win.setTitle(title(cur));
      if (cur === PC) {
        main.appendChild(h('div.ex-pc', h('div.ex-group', 'Devices and drives'), h('div.ex-drives', ...drives().map(l => {
          const v = WS.storage.volume(l), cd = WS.storage.isCdrom(l);
          const pct = v ? Math.round(v.used / v.size * 100) : 0;
          return h('div.ex-drive', { dataset: { letter: l }, onDblclick: () => go(l + ':\\'),
            onContextmenu: e => { e.preventDefault(); WS.ui.contextMenu(e.clientX, e.clientY, [{ label: '&Open', default: true, action: () => go(l + ':\\') }, { separator: true },
              { label: 'F&ormat...', disabled: cd || l === 'C' || !v, action: () => { const hit = WS.storage.byLetter(l); if (hit) WS.diskmgmt.format(`part:${hit.disk.number}:${hit.part.number}`); } }, { separator: true },
              { label: 'P&roperties', disabled: cd, action: () => driveProps(l) }]); } },
          h('span.ex-dic', { html: cd ? I.cdrom : l === 'C' ? I.driveSystem : I.drive }),
          h('div', h('div', label(l)), cd ? null : h('div.ex-bar', h('i', { style: { width: pct + '%' } })), cd ? null : h('div.ex-dim', v ? `${WS.diskmgmt.shortSize(v.free)} free of ${WS.diskmgmt.shortSize(v.size)}` : '')));
        })), ...(netDrives().length ? [h('div.ex-group', 'Network locations'), h('div.ex-drives', ...netDrives().map(l => {
          const d = WS.netuse.get(l), r = WS.netuse.resolveUnc(d.remote), v = r.ok ? WS.storage.volume(r.path[0]) : null;
          const pct = v ? Math.round(v.used / v.size * 100) : 0;
          return h('div.ex-drive.ex-net', { dataset: { letter: l }, onDblclick: () => go(l + ':\\'),
            onContextmenu: e => { e.preventDefault(); WS.ui.contextMenu(e.clientX, e.clientY, [{ label: '&Open', default: true, action: () => go(l + ':\\') }, { separator: true },
              { label: '&Disconnect', action: () => { WS.netuse.disconnect(l); render(); } }, { separator: true }, { label: 'P&roperties', disabled: true }]); } },
            h('span.ex-dic', { html: netIcon(l) }),
            h('div', h('div', label(l)), v ? h('div.ex-bar', h('i', { style: { width: pct + '%' } })) : null, h('div.ex-dim', v ? `${WS.diskmgmt.shortSize(v.free)} free of ${WS.diskmgmt.shortSize(v.size)}` : 'Disconnected')));
        }))] : [])));
      } else {
        const inBin = cur === BIN;
        const typeOf = r => (r.junction ? 'Mounted Volume' : r.type === 'dir' ? 'File folder' : WS.ui.fileTypeName(r.name, false));
        list = WS.ui.listView({
          columns: inBin ? [{ key: 'name', label: 'Name', width: 240 }, { key: 'origin', label: 'Original Location', width: 220 }, { key: 'deleted', label: 'Date Deleted', width: 150, type: 'date', render: r => U.fmtDateTime(r.deleted) },
            { key: 'size', label: 'Size', width: 80, align: 'right', type: 'num', render: r => kb(r.size) }, { key: 'kind', label: 'Item type', width: 130, value: typeOf }]
            : [{ key: 'name', label: 'Name', width: 280, sort: (a, b, ra, rb) => (ra.type === rb.type ? a.localeCompare(b) : ra.type === 'dir' ? -1 : 1) }, { key: 'modified', label: 'Date modified', width: 150, type: 'date', render: r => U.fmtDateTime(r.modified) },
              { key: 'kind', label: 'Type', width: 150, value: typeOf }, { key: 'size', label: 'Size', width: 90, align: 'right', type: 'num', render: r => (r.type === 'dir' ? '' : kb(r.size)) }],
          rows: items, getId: r => (inBin ? r.id : r.name), icon: r => (r.junction ? I.drive : r.type === 'dir' ? I.folder : I.file), multi: true, sortKey: inBin ? 'deleted' : 'name', sortDir: inBin ? -1 : 1,
          emptyText: filter ? 'No items match your search.' : inBin ? 'The Recycle Bin is empty.' : 'This folder is empty.',
          rowClass: r => (!inBin && clip && clip.cut && clip.paths.includes(join(cur, r.name)) ? 'ex-cut' : ''),
          onSelect: () => paintCmd(), onActivate: r => (inBin ? restore([r.id]) : go(join(cur, r.name))),
          onContext: (rows, x, y) => WS.ui.contextMenu(x, y, rows.length ? itemMenu(rows) : bgMenu()),
          onKey: (e, rows) => {
            const names = rows.map(r => (inBin ? r.id : r.name));
            if (e.key === 'Delete' && rows.length) { remove(names, { permanent: e.shiftKey }); return true; }
            if (inBin) return false;
            if (e.key === 'F2' && rows.length === 1) { rename(rows[0].name); return true; }
            if (e.key === 'Backspace') { goBack(); return true; }
            if (e.ctrlKey && /^[xcv]$/i.test(e.key)) { if (e.key.toLowerCase() === 'v') paste(); else if (rows.length) setClip(names, e.key.toLowerCase() === 'x'); return true; }
            return false;
          }
        });
        if (!inBin) {
          // drag rows onto a folder row (or a tree node): a move on the same drive, a copy to another drive
          list.el.addEventListener('pointerdown', e => { const r = e.target.closest('.lv-row'); if (r) r.draggable = true; });
          list.el.addEventListener('dragstart', e => { const r = e.target.closest('.lv-row'); if (!r) return; const names = list.selected().some(x => x.name === r.dataset.id) ? list.selected().map(x => x.name) : [r.dataset.id]; e.dataTransfer.setData('text/x-ws-paths', JSON.stringify(names.map(n => join(cur, n)))); });
          list.el.addEventListener('dragover', e => { const r = e.target.closest('.lv-row'); if (r && WS.fs.isDir(join(cur, r.dataset.id))) e.preventDefault(); });
          list.el.addEventListener('drop', e => { const r = e.target.closest('.lv-row'); if (!r) return; e.preventDefault(); const paths = JSON.parse(e.dataTransfer.getData('text/x-ws-paths') || '[]').filter(p => p.toLowerCase() !== join(cur, r.dataset.id).toLowerCase()); drop(paths, join(cur, r.dataset.id), e.ctrlKey); });
        }
        main.appendChild(h('div.ex-list', list.el));
      }
      // the navigation pane follows the current folder, expanding down to it
      tree.refresh();
      if (cur === PC || cur === BIN) { if (tree.node(PC)) tree.select(PC, { silent: true }); }
      else { const parts = cur.replace(/\\$/, '').split('\\'), ids = [PC, parts[0] + '\\']; for (let i = 1; i < parts.length; i++) ids.push(parts.slice(0, i + 1).join('\\')); tree.reveal(ids); }
      paintCmd();
    }
    tree.el.addEventListener('dragover', e => { const r = e.target.closest('[data-id]'); if (r && /^[A-Z]:\\/i.test(r.dataset.id)) e.preventDefault(); });
    tree.el.addEventListener('drop', e => { const r = e.target.closest('[data-id]'); if (!r) return; e.preventDefault(); drop(JSON.parse(e.dataTransfer.getData('text/x-ws-paths') || '[]'), r.dataset.id, e.ctrlKey); });
    addr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const v = addr.value.trim(); if (/^this pc$/i.test(v)) go(PC); else go(v); } else if (e.key === 'Escape') addr.value = cur; });
    search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); if (list) { list.refresh(); paintCmd(); } });
    win.listen('fs', () => { if (renaming) return; if (list) { list.refresh(); paintCmd(); tree.refresh(); } else render(); });
    win.listen('storage', () => { if (!renaming) render(); });
    win.listen('smb', () => tree.refresh());
    win.listen('netuse', () => { tree.refresh(); if (cur === PC) render(); });
    win.explorer = { path: () => cur, go, up, back: goBack, select: names => list && list.select([].concat(names)), newFolder, newTextFile, rename, startRename, remove, properties,
      copy: names => setClip([].concat(names), false), cut: names => setClip([].concat(names), true), paste, drop, restore, emptyBin, clip: () => clip, tree: () => tree,
      items: () => (cur === PC ? drives().map(label) : list ? list.rows().map(r => r.name) : []) };
    if (args.path) go(args.path); else render();
    return win;
  }

  WS.explorer = { launch };
  WS.apps.register({ id: 'explorer', name: 'File Explorer', icon: I.explorer, launch, keywords: ['explorer', 'file explorer', 'files', 'folders', 'this pc'] });
})();
