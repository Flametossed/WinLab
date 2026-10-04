/* UI toolkit, part 4: pickers.
 *
 * WS.ui.objectPicker({ types: ['user','group','computer','contact','principal'], multi = true, source: 'auto'|'ad'|'local',
 *                      title, filter(obj) }) -> Promise<picked[] | null>
 *   The "Select Users, Computers, or Groups" dialog. Searches Active Directory on a DC, otherwise the local SAM.
 *   'principal' adds well-known principals (Everyone, Authenticated Users...). Check Names resolves what was typed
 *   (Multiple Names Found / Name Not Found dialogs as in Windows); Advanced... runs a "starts with" search.
 *   picked: { type, name, sam, display, principal ('CONTOSO\\jsmith'), id (AD GUID), source, obj }
 *
 * WS.ui.filePicker({ mode: 'folder' | 'open' | 'save', title, path, prompt, filters: [{ label, ext: ['.txt'] }],
 *                    defaultName, okLabel }) -> Promise<full path | null>
 *   'folder' is the classic Browse For Folder dialog (with Make New Folder); 'open'/'save' are the common file
 *   dialog (address bar, folder tree, file list, File name + type filter). Both read and write WS.fs.
 * WS.ui.fileTypeName(name, isDir) -> Explorer's "Type" column text. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons, f = () => WS.ui.f;

  /* ================================================================ object picker */
  const TYPE_LABEL = { user: 'Users', group: 'Groups', computer: 'Computers', contact: 'Contacts', principal: 'Built-in security principals' };
  const TYPE_ONE = { user: 'User', group: 'Group', computer: 'Computer', contact: 'Contact', principal: 'Built-in security principal' };
  const PRINCIPALS = ['Everyone', 'Authenticated Users', 'SYSTEM', 'NETWORK', 'INTERACTIVE', 'CREATOR OWNER', 'ANONYMOUS LOGON', 'LOCAL SERVICE', 'NETWORK SERVICE', 'SERVICE', 'BATCH', 'DIALUP', 'REMOTE INTERACTIVE LOGON', 'This Organization'];
  const joinOr = list => list.length <= 1 ? list.join('') : list.length === 2 ? list.join(' or ') : list.slice(0, -1).join(', ') + ', or ' + list[list.length - 1];

  function iconFor(p) {
    if (p.type === 'user') return p.obj && p.obj.enabled === false ? I.adUserDisabled : I.adUser;
    if (p.type === 'group') return I.adGroup;
    if (p.type === 'computer') return I.adComputer;
    if (p.type === 'contact') return I.contact;
    return I.fsp;
  }

  function candidates(source, types) {
    const out = [];
    if (source === 'ad') {
      const nb = WS.ad.netbios();
      for (const o of WS.ad.search({ type: types.filter(t => t !== 'principal'), advanced: false })) {
        const parent = WS.ad.byId(o.parentId);
        out.push({ type: o.type, name: o.name, sam: o.sam || '', upn: o.upn || '', email: o.email || '', description: o.description || '',
          folder: parent ? WS.ad.canonical(parent) : '', display: o.type === 'user' && o.upn ? `${o.name} (${o.upn})` : o.name,
          principal: o.sam ? `${nb}\\${o.sam}` : o.name, id: o.id, source: 'ad', obj: o,
          keys: [o.name, o.sam, o.upn, o.displayName, o.givenName, o.sn, o.sam && o.type === 'computer' ? o.sam.replace(/\$$/, '') : null].filter(Boolean) });
      }
    } else {
      const pc = WS.sys.name;
      if (types.includes('user')) for (const u of WS.local.users()) out.push({ type: 'user', name: u.name, sam: u.name, description: u.description, folder: pc, display: `${pc}\\${u.name}`, principal: `${pc}\\${u.name}`, source: 'local', obj: u, keys: [u.name, u.fullName].filter(Boolean) });
      if (types.includes('group')) for (const g of WS.local.groups()) out.push({ type: 'group', name: g.name, sam: g.name, description: g.description, folder: pc, display: `${pc}\\${g.name}`, principal: `${pc}\\${g.name}`, source: 'local', obj: g, keys: [g.name] });
    }
    if (types.includes('principal')) for (const p of PRINCIPALS) out.push({ type: 'principal', name: p, sam: p, description: '', folder: '', display: p, principal: p, source: 'builtin', obj: null, keys: [p] });
    return out;
  }
  function match(list, text) {
    const q = text.trim().toLowerCase().replace(/^[^\\]+\\/, '');
    if (!q) return [];
    const exact = list.filter(c => c.keys.some(k => k.toLowerCase() === q) || c.principal.toLowerCase() === text.trim().toLowerCase());
    if (exact.length) return exact;
    return list.filter(c => c.keys.some(k => k.toLowerCase().startsWith(q)));
  }

  async function objectPicker(o = {}) {
    let types = (o.types || ['user', 'group']).slice();
    const source = o.source && o.source !== 'auto' ? o.source : (WS.sys.isDC() ? 'ad' : 'local');
    const allowed = types.slice();
    const location = source === 'ad' ? WS.ad.domain() : WS.sys.name;
    const multi = o.multi !== false;
    const title = o.title || (source === 'ad' && ['user', 'group', 'computer'].every(t => types.includes(t))
      ? 'Select Users, Contacts, Computers, Service Accounts, or Groups'
      : 'Select ' + joinOr(types.map(t => TYPE_LABEL[t])));
    const pool = () => candidates(source, types).filter(c => !o.filter || o.filter(c));
    const typeText = () => joinOr(types.map(t => TYPE_LABEL[t]));

    const typeBox = f().text({ value: typeText(), readOnly: true });
    const locBox = f().text({ value: location, readOnly: true });
    const box = h('div.op-box.inp', { contentEditable: 'true', spellcheck: false });
    const tokens = new Map();
    let tokSeq = 0;

    function readBox() {
      const out = [];
      for (const n of box.childNodes) {
        if (n.nodeType === 1 && n.classList.contains('op-tok')) out.push({ pick: tokens.get(n.dataset.k) });
        else String(n.textContent).split(';').map(s => s.trim()).filter(Boolean).forEach(text => out.push({ text }));
      }
      return out;
    }
    function writeBox(entries) {
      U.clear(box); tokens.clear();
      entries.forEach((e, i) => {
        if (i) box.appendChild(document.createTextNode('; '));
        if (e.pick) {
          const k = String(++tokSeq);
          tokens.set(k, e.pick);
          box.appendChild(h('span.op-tok', { contentEditable: 'false', dataset: { k } }, e.pick.display));
        } else box.appendChild(document.createTextNode(e.text));
      });
    }
    function addPicks(picks) {
      const cur = readBox();
      const have = new Set(cur.filter(e => e.pick).map(e => e.pick.principal));
      for (const p of picks) if (!have.has(p.principal)) { cur.push({ pick: p }); have.add(p.principal); }
      writeBox(multi ? cur : cur.slice(-1));
    }

    /** Resolve every typed name. Returns true when everything resolved. */
    async function checkNames() {
      const entries = readBox();
      const out = [];
      let allOk = true;
      for (const e of entries) {
        if (e.pick) { out.push(e); continue; }
        const hits = match(pool(), e.text);
        if (hits.length === 1) { out.push({ pick: hits[0] }); continue; }
        if (hits.length > 1) {
          const chosen = await multipleNames(e.text, hits, multi);
          if (chosen && chosen.length) chosen.forEach(p => out.push({ pick: p }));
          else { out.push(e); allOk = false; }
          continue;
        }
        await WS.ui.msgbox({ title: 'Name Not Found', icon: 'warning', width: 480,
          message: `An object (${joinOr(types.map(t => TYPE_ONE[t]))}) with the following name cannot be found: "${e.text}".`,
          detail: 'Check the selected object types and location for accuracy and ensure that you typed the object name correctly, or remove this object from the selection.' });
        out.push(e); allOk = false;
      }
      writeBox(multi ? out : out.slice(0, 1));
      return allOk;
    }

    const frame = WS.ui.modal({ title, width: 470, className: 'w32-dlg', closeValue: null });
    const btnTypes = f().button('Object Types...', async () => {
      const chosen = await objectTypes(allowed, types);
      if (chosen) { types = chosen; typeBox.value = typeText(); }
    });
    const btnLoc = f().button('Locations...', () => WS.ui.msgbox({ title: 'Locations', message: `Only one location is available in this lab:\n\n${location}`, icon: 'info' }));
    const btnCheck = f().button('Check Names', () => checkNames());
    const btnAdv = f().button('Advanced...', async () => { const r = await advanced(pool, multi, typeText()); if (r && r.length) addPicks(r); });
    frame.body.appendChild(h('div.w32.op',
      h('div', 'Select this object type:'), h('div.op-line', typeBox, btnTypes),
      h('div', 'From this location:'), h('div.op-line', locBox, btnLoc),
      h('div', 'Enter the object name', multi ? 's' : '', ' to select (', h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); WS.ui.msgbox({ title: 'Examples', message: 'DisplayName (example: "FirstName LastName")\nObjectName (example: "Computer1")\nUserName (example: "User1")\nObjectName@DomainName (example: "User1@Domain.com")\nDomainName\\ObjectName (example: "Domain\\User1")' }); } }, 'examples'), '):'),
      h('div.op-line.top', box, btnCheck)));
    const okBtn = h('button.btn.primary', { onClick: async () => {
      if (!readBox().length) { frame.close([]); return; }
      if (await checkNames()) frame.close(readBox().map(e => e.pick));
    } }, 'OK');
    frame.footer.appendChild(h('div', { style: 'flex:1' }, btnAdv));
    frame.footer.appendChild(okBtn);
    frame.footer.appendChild(h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); okBtn.click(); } });
    box.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text')); });
    frame.onEnter = () => okBtn.click();
    frame.picker = { box, checkNames, readBox, setText: t => writeBox([{ text: t }]), ok: () => okBtn.click() };
    if (o.onCreate) o.onCreate(frame.picker);
    setTimeout(() => box.focus(), 30);
    return frame.promise;
  }

  function objectTypes(allowed, current) {
    const boxes = allowed.map(t => f().checkbox(TYPE_LABEL[t], current.includes(t)));
    const list = h('div.op-types', ...boxes.map((b, i) => h('div', { html: '' }, h('span.ic', { html: iconFor({ type: allowed[i] }) }), b)));
    return WS.ui.dialog({ title: 'Object Types', width: 380, content: h('div.w32', h('div', { style: 'margin-bottom:6px' }, 'Select the types of objects you want to find.'), h('div', 'Object types:'), list),
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }] })
      .then(r => { if (r !== 'ok') return null; const c = allowed.filter((t, i) => boxes[i].checked); return c.length ? c : null; });
  }

  function pickColumns() {
    return [
      { key: 'name', label: 'Name', width: 170 },
      { key: 'email', label: 'E-Mail Address', width: 120 },
      { key: 'description', label: 'Description', width: 170 },
      { key: 'folder', label: 'In Folder', width: 150 }
    ];
  }
  function multipleNames(text, hits, multi) {
    const lv = WS.ui.listView({ columns: pickColumns(), rows: hits, getId: r => r.principal, icon: iconFor, multi });
    lv.el.style.height = '200px';
    let chosen = null;
    return WS.ui.dialog({ title: 'Multiple Names Found', width: 560,
      content: h('div.w32', h('div', { style: 'margin-bottom:8px' }, `More than one object matched the name "${text}". Select one or more names from this list, or, reenter the name.`), h('div', 'Matching names:'), lv.el),
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }],
      onCreate: fr => { lv.select(hits[0].principal); lv.el.addEventListener('dblclick', () => fr.buttons[0].click()); }
    }).then(r => { chosen = r === 'ok' ? lv.selected() : null; return chosen; });
  }
  function advanced(pool, multi, typeText) {
    const nameOp = f().select(['Starts with', 'Is exactly'], 'Starts with', { width: 110 });
    const nameIn = f().text({ width: 200 });
    const descOp = f().select(['Starts with', 'Is exactly'], 'Starts with', { width: 110 });
    const descIn = f().text({ width: 200 });
    const disabledOnly = f().checkbox('Disabled accounts', false);
    let rows = [];
    const lv = WS.ui.listView({ columns: pickColumns(), rows: () => rows, getId: r => r.principal, icon: iconFor, multi, emptyText: '' });
    lv.el.style.height = '210px';
    const test = (op, v, val) => !v || (op === 'Is exactly' ? String(val || '').toLowerCase() === v.toLowerCase() : String(val || '').toLowerCase().startsWith(v.toLowerCase()));
    const find = () => {
      rows = pool().filter(c => test(nameOp.value, nameIn.value.trim(), c.name) && test(descOp.value, descIn.value.trim(), c.description) && (!disabledOnly.checked || (c.obj && c.obj.enabled === false)));
      lv.refresh();
    };
    const content = h('div.w32',
      f().row('Object type:', f().text({ value: typeText, readOnly: true, width: 320 }), { labelWidth: 90 }),
      f().group('Common Queries',
        h('div.op-q', h('span', 'Name:'), nameOp, nameIn),
        h('div.op-q', h('span', 'Description:'), descOp, descIn),
        disabledOnly,
        h('div', { style: 'text-align:right' }, f().button('Find Now', find))),
      h('div', { style: 'margin:8px 0 4px' }, 'Search results:'), lv.el);
    return WS.ui.dialog({ title: 'Select ' + typeText, width: 620, content, buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }],
      onCreate: fr => { lv.el.addEventListener('dblclick', () => fr.buttons[0].click()); nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); find(); } }); } })
      .then(r => (r === 'ok' ? lv.selected() : null));
  }

  /* ================================================================ file system pickers */
  const TYPES = {
    '.txt': 'Text Document', '.log': 'Text Document', '.ini': 'Configuration settings', '.exe': 'Application', '.dll': 'Application extension',
    '.ps1': 'Windows PowerShell Script', '.psm1': 'Windows PowerShell Script Module', '.bat': 'Windows Batch File', '.cmd': 'Windows Command Script',
    '.msc': 'Microsoft Common Console Document', '.cpl': 'Control panel item', '.csv': 'Microsoft Excel Comma Separated Values File',
    '.xml': 'XML Document', '.htm': 'Microsoft Edge HTML Document', '.html': 'Microsoft Edge HTML Document', '.json': 'JSON File', '.dat': 'DAT File',
    '.dit': 'DIT File', '.dns': 'DNS File', '.sam': 'SAM File', '.reg': 'Registration Entries', '.zip': 'Compressed (zipped) Folder', '.vhdx': 'Hard Disk Image File'
  };
  function fileTypeName(name, isDir) {
    if (isDir) return 'File folder';
    const i = name.lastIndexOf('.');
    if (i <= 0) return 'File';
    const ext = name.slice(i).toLowerCase();
    return TYPES[ext] || ext.slice(1).toUpperCase() + ' File';
  }
  function fileIcon(name, isDir) {
    if (isDir) return I.folder;
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (['.exe', '.msc', '.cpl'].includes(ext)) return I.fileExe;
    if (['.txt', '.log', '.ini', '.ps1', '.cmd', '.bat', '.csv', '.xml', '.json'].includes(ext)) return I.fileText;
    return I.file;
  }
  function driveLabel(letter) {
    if (WS.storage.isCdrom(letter)) return `DVD Drive (${letter}:)`;
    const m = !WS.state.fs.drives[letter] && WS.netuse ? WS.netuse.get(letter) : null;
    if (m) return WS.netuse.displayName(m);
    const v = WS.storage.volume(letter);
    return `${v && v.label ? v.label : 'Local Disk'} (${letter}:)`;
  }
  /** Folder tree nodes for This PC (ids are full paths). */
  function folderNodes() {
    const sub = path => () => {
      try { return WS.fs.list(path).filter(x => x.type === 'dir').map(d => ({ id: d.path, label: d.name, icon: I.folder, iconOpen: I.folderOpen, children: sub(d.path), hasChildren: hasDirs(d.path) })); }
      catch (e) { return []; }
    };
    const hasDirs = path => { try { return WS.fs.list(path).some(x => x.type === 'dir'); } catch (e) { return false; } };
    const drives = [...WS.fs.drives().map(l => ({ id: l + ':\\', label: driveLabel(l), icon: l === 'C' ? I.driveSystem : I.drive, children: sub(l + ':\\'), hasChildren: hasDirs(l + ':\\') }))];
    const cd = WS.storage.cdrom();
    if (cd && cd.letter) drives.push({ id: cd.letter + ':\\', label: driveLabel(cd.letter), icon: I.cdrom, children: [], hasChildren: false });
    drives.sort((a, b) => a.id.localeCompare(b.id));
    return [{ id: 'pc', label: 'This PC', icon: I.thisPC, expanded: true, children: drives }];
  }
  /** Ids of every folder from the drive down to path, for tree.reveal(). */
  function pathChain(path) {
    const p = WS.fs.parse(path);
    const out = ['pc', p.drive + ':\\'];
    let cur = p.drive + ':';
    for (const part of p.parts) { cur += '\\' + part; out.push(WS.fs.full(cur)); }
    return out;
  }
  function uniqueName(dir, base) {
    let name = base, n = 2;
    while (WS.fs.exists(dir.replace(/\\$/, '') + '\\' + name)) name = `${base} (${n++})`;
    return name;
  }

  function browseForFolder(o) {
    const frame = WS.ui.modal({ title: o.title || 'Browse For Folder', width: 360, className: 'w32-dlg', closeValue: null });
    const folderBox = f().text({ readOnly: true });
    const tv = WS.ui.tree({ nodes: folderNodes, onSelect: n => { folderBox.value = n.id === 'pc' ? 'This PC' : n.label; okBtn.disabled = n.id === 'pc' || /^[A-Z]:\\$/.test(n.id) && WS.storage.isCdrom(n.id[0]); } });
    tv.el.classList.add('fp-tree');
    const okBtn = h('button.btn.primary', { onClick: () => { const n = tv.selected(); if (n && n.id !== 'pc') frame.close(WS.fs.full(n.id)); } }, o.okLabel || 'OK');
    const makeBtn = h('button.btn', { onClick: () => {
      const n = tv.selected();
      if (!n || n.id === 'pc') return;
      const name = uniqueName(n.id, 'New folder');
      try { WS.fs.mkdir(n.id.replace(/\\$/, '') + '\\' + name); } catch (e) { WS.ui.msgbox({ title: 'Browse For Folder', message: e.message, icon: 'error' }); return; }
      tv.expand(n.id); tv.refresh();
      tv.select(WS.fs.full(n.id.replace(/\\$/, '') + '\\' + name));
    } }, 'Make New Folder');
    frame.body.appendChild(h('div.w32', h('div', { style: 'margin-bottom:8px' }, o.prompt || 'Select a folder:'), tv.el, f().row('Folder:', folderBox, { labelWidth: 50 })));
    frame.footer.appendChild(h('div', { style: 'flex:1' }, makeBtn));
    frame.footer.appendChild(okBtn);
    frame.footer.appendChild(h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = () => okBtn.click();
    try { tv.reveal(pathChain(o.path && WS.fs.isDir(o.path) ? o.path : 'C:\\')); } catch (e) { tv.select('pc'); }
    setTimeout(() => tv.focus(), 30);
    frame.picker = { tree: tv, ok: () => okBtn.click(), makeFolder: () => makeBtn.click() };
    if (o.onCreate) o.onCreate(frame.picker);
    return frame.promise;
  }

  function fileDialog(o) {
    const save = o.mode === 'save';
    const filters = o.filters && o.filters.length ? o.filters : [{ label: 'All Files (*.*)', ext: [] }];
    const frame = WS.ui.modal({ title: o.title || (save ? 'Save As' : 'Open'), width: 780, height: 500, className: 'w32-dlg fdlg', closeValue: null });
    let cwd = o.path && WS.fs.isDir(o.path) ? WS.fs.full(o.path) : o.path && WS.fs.isDir(o.path.replace(/\\[^\\]*$/, '')) ? WS.fs.full(o.path.replace(/\\[^\\]*$/, '')) : 'C:\\Users\\Administrator\\Documents';
    if (!WS.fs.isDir(cwd)) cwd = 'C:\\';
    const addr = f().text({ value: cwd });
    const nameIn = f().text({ value: o.defaultName || (o.path && !WS.fs.isDir(o.path) ? o.path.replace(/^.*\\/, '') : '') });
    const filterSel = f().select(filters.map((x, i) => ({ value: i, label: x.label })), 0, { onChange: () => lv.refresh() });
    const exts = () => filters[+filterSel.value].ext || [];
    const rows = () => {
      let items = [];
      try { items = WS.fs.list(cwd); } catch (e) { items = []; }
      return items.filter(x => x.type === 'dir' || !exts().length || exts().some(e => x.name.toLowerCase().endsWith(e)));
    };
    const lv = WS.ui.listView({
      columns: [
        { key: 'name', label: 'Name', width: 210, sort: (a, b, ra, rb) => (ra.type === rb.type ? 0 : ra.type === 'dir' ? -1 : 1) || a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) },
        { key: 'modified', label: 'Date modified', width: 130, type: 'date', render: r => U.fmtDate(r.modified) + ' ' + U.fmtTime(r.modified) },
        { key: 'kind', label: 'Type', width: 115, value: r => fileTypeName(r.name, r.type === 'dir') },
        { key: 'size', label: 'Size', width: 70, align: 'right', type: 'num', render: r => (r.type === 'dir' ? '' : U.fmtKB(r.size)) }
      ],
      rows, getId: r => r.path, icon: r => fileIcon(r.name, r.type === 'dir'), multi: false, emptyText: 'This folder is empty.',
      onSelect: sel => { if (sel[0] && sel[0].type === 'file') nameIn.value = sel[0].name; },
      onActivate: r => { if (r.type === 'dir') go(r.path); else { nameIn.value = r.name; okBtn.click(); } }
    });
    const tv = WS.ui.tree({ nodes: folderNodes, onSelect: n => { if (n.id !== 'pc' && !(WS.storage.isCdrom(n.id[0]) && n.id.length === 3)) go(n.id, true); } });
    tv.el.classList.add('fp-side');
    function go(path, fromTree) {
      if (!WS.fs.isDir(path)) { WS.ui.msgbox({ title: frame.bar.textContent, message: `Windows can't find '${path}'. Check the spelling and try again.`, icon: 'error' }); addr.value = cwd; return; }
      cwd = WS.fs.full(path); addr.value = cwd; lv.refresh();
      if (!fromTree) { try { tv.reveal(pathChain(cwd)); } catch (e) { /* ignore */ } }
    }
    const upBtn = h('button.tbtn', { html: I.up, title: 'Up', onClick: () => { const p = cwd.replace(/\\[^\\]+\\?$/, ''); go(p.length === 2 ? p + '\\' : p); } });
    addr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(addr.value.trim()); } });
    const okBtn = h('button.btn.primary', { onClick: () => accept() }, o.okLabel || (save ? 'Save' : 'Open'));
    async function accept() {
      let name = nameIn.value.trim();
      if (!name) return;
      let path = /^[A-Za-z]:/.test(name) || name.startsWith('\\') ? WS.fs.full(name) : WS.fs.full(name, cwd);
      if (WS.fs.isDir(path)) { go(path); nameIn.value = ''; return; }
      if (save && !/\.[^.\\]+$/.test(path) && exts()[0]) path += exts()[0];
      const exists = WS.fs.exists(path);
      const parentOk = WS.fs.isDir(path.replace(/\\[^\\]+$/, '') || path.slice(0, 3));
      if (!save && !exists) { await WS.ui.msgbox({ title: frame.bar.textContent, icon: 'warning', message: `${path.replace(/^.*\\/, '')}\nFile not found.\nCheck the file name and try again.` }); return; }
      if (save && !parentOk) { await WS.ui.msgbox({ title: frame.bar.textContent, icon: 'warning', message: `${path}\nPath does not exist.\nCheck the path and try again.` }); return; }
      if (save && exists) {
        const r = await WS.ui.msgbox({ title: 'Confirm Save As', icon: 'warning', message: `${path.replace(/^.*\\/, '')} already exists.\nDo you want to replace it?`, buttons: ['Yes', 'No'] });
        if (r !== 'Yes') return;
      }
      frame.close(path);
    }
    frame.body.appendChild(h('div.w32.fd',
      h('div.fd-addr', upBtn, addr),
      h('div.fd-main', tv.el, lv.el),
      h('div.fd-bottom', h('label', 'File name:'), nameIn, filterSel)));
    frame.footer.appendChild(okBtn);
    frame.footer.appendChild(h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = () => okBtn.click();
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); accept(); } });
    try { tv.reveal(pathChain(cwd)); } catch (e) { /* ignore */ }
    setTimeout(() => nameIn.focus(), 30);
    frame.picker = { list: lv, tree: tv, go, setName: n => { nameIn.value = n; }, ok: () => accept(), get cwd() { return cwd; } };
    if (o.onCreate) o.onCreate(frame.picker);
    return frame.promise;
  }

  function filePicker(o = {}) { return o.mode === 'folder' ? browseForFolder(o) : fileDialog(o); }

  WS.ui.objectPicker = objectPicker;
  WS.ui.filePicker = filePicker;
  WS.ui.fileTypeName = fileTypeName;
  WS.ui.fileIcon = fileIcon;
  WS.ui.driveLabel = driveLabel;
})();
