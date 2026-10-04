/* Shared Folders (fsmgmt.msc): Shares, Sessions and Open Files, the Create A Shared Folder Wizard, share Properties with
 * Share Permissions, Offline Settings, and Explorer's Advanced Sharing dialog. Shares are read and changed only through
 * WS.smb - the model New-SmbShare, Grant-SmbShareAccess and net share use - so every tool shows the same shares.
 *   WS.fsmgmt.snapin({ label }) -> { node }   'sf-root' > Shares 'sf-shares' | Sessions 'sf-sessions' | Open Files 'sf-files'
 *   WS.fsmgmt.launch() -> win                 the standalone console, "Shared Folders (Local)"
 *   newShare({ path, onCreate(w, data) }) -> Promise<share | null>        Create A Shared Folder Wizard
 *   shareProperties(name, opts) -> Promise<bool>                         General | Share Permissions
 *   stopSharing(names) -> Promise<bool>
 *   permissions(name | { title, access }, opts) -> Promise               "Permissions for <share>" (applies to a share, or
 *                                                                        resolves to the new access list for one not made yet)
 *   offlineSettings(mode, opts) -> Promise<cachingMode | null>
 *   advancedSharing(path, opts) -> Promise<bool>                         Explorer > Properties > Sharing > Advanced Sharing...
 *   permEditor(access, { onChange }) -> { el, access(), select(account), add(picked[]), remove(), set(right, type, on) }
 * Dialogs take opts.onCreate with the live frame / sheet / wizard; controls carry data-field names for tests. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f;
  const TITLE = 'Shared Folders';
  const RIGHTS = ['Full', 'Change', 'Read'];
  const RLABEL = { Full: 'Full Control', Change: 'Change', Read: 'Read' };
  const CACHE = {
    Manual: 'Selected files and programs available offline', None: 'No files or programs available offline',
    Documents: 'All files and programs that users open are available offline', Programs: 'All files and programs that users open are available offline', BranchCache: 'Selected files and programs available offline'
  };
  const UNLIMITED = 16777216;
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const ICON = {
    root: I.share,
    shares: I.share,
    sessions: s16('<rect x="1.5" y="2.5" width="8" height="6" rx=".8" fill="#5b6b7d"/><rect x="2.5" y="3.5" width="6" height="4" fill="#9fc1e3"/><rect x="6.5" y="7.5" width="8" height="6" rx=".8" fill="#5b6b7d"/><rect x="7.5" y="8.5" width="6" height="4" fill="#9fc1e3"/><path d="M5.5 9v2.5h1" fill="none" stroke="#2f7fd8"/>'),
    files: s16(inner(I.folder) + '<rect x="8" y="7" width="6.5" height="7.5" rx=".6" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/><path d="M9.3 9.2h4M9.3 10.9h4M9.3 12.6h2.6" stroke="#8a97a6" stroke-width=".8"/>')
  };
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = (r, title = TITLE) => WS.ui.msgbox({ title, icon: 'error', message: typeof r === 'string' ? r : r.error, detail: r.detail });
  const ask = (message, title = TITLE) => WS.ui.msgbox({ title, icon: 'warning', message, buttons: ['Yes', 'No'] }).then(a => a === 'Yes');
  const SEP = { separator: true };
  const unc = name => `\\\\${WS.sys.name}\\${name}`;

  /* ================================================================ share permissions */
  /** Model ACEs ([{account, right, type}]) <-> one row per principal with the checked Allow/Deny boxes. */
  function toEntries(access) {
    const map = new Map();
    for (const a of access || []) {
      const k = a.account.toLowerCase();
      if (!map.has(k)) map.set(k, { account: a.account, allow: new Set(), deny: new Set() });
      const e = map.get(k), set = a.type === 'Deny' ? e.deny : e.allow;
      for (const r of RIGHTS.slice(Math.max(0, RIGHTS.indexOf(a.right)))) set.add(r);
    }
    return [...map.values()];
  }
  function toAccess(entries) {
    const out = [];
    for (const e of entries) for (const [set, type] of [[e.allow, 'Allow'], [e.deny, 'Deny']]) {
      const top = RIGHTS.find(r => set.has(r));
      if (top) out.push({ account: e.account, right: top, type });
    }
    return out;
  }
  const isGroupName = n => {
    const s = n.replace(/^.*\\/, '');
    if (/^(Everyone|Authenticated Users|INTERACTIVE|NETWORK|SYSTEM|CREATOR OWNER|ANONYMOUS LOGON|Administrators|Users|Guests|Backup Operators)$/i.test(s)) return true;
    if (WS.sys.isDC() && WS.ad) { const o = WS.ad.get(s); return !!o && o.type === 'group'; }
    return !!WS.local.group(s);
  };
  /** How the permission list names a principal: "Everyone", "Administrators (DC01\Administrators)", "Sales Staff (CONTOSO\Sales Staff)". */
  function display(acct) {
    if (/\\/.test(acct)) return `${acct.replace(/^.*\\/, '')} (${acct})`;
    if (/^(Everyone|Authenticated Users|INTERACTIVE|NETWORK|SYSTEM|CREATOR OWNER|ANONYMOUS LOGON)$/i.test(acct)) return acct;
    const dom = WS.sys.isDC() ? (/^(Administrators|Users|Guests|Backup Operators|Remote Desktop Users)$/i.test(acct) ? 'BUILTIN' : WS.ad.netbios()) : WS.sys.name;
    return `${acct} (${dom}\\${acct})`;
  }
  function permEditor(access, o = {}) {
    let entries = toEntries(access);
    let cur = entries[0] || null;
    const list = h('div.sf-princ', { tabIndex: 0 });
    const head = h('div.sf-phead');
    const grid = h('div.sf-pgrid');
    const boxes = {};
    for (const r of RIGHTS) {
      boxes[r] = {};
      const row = [h('span.sf-pname', RLABEL[r])];
      for (const type of ['Allow', 'Deny']) {
        const cb = h('input', { type: 'checkbox', onChange: () => set(r, type, cb.checked) });
        field(`perm-${r}-${type}`, cb);
        boxes[r][type] = cb;
        row.push(h('span.sf-pcb', cb));
      }
      grid.appendChild(h('div.sf-prow', ...row));
    }
    const addBtn = field('perm-add', F.button('Add...', () => pick())), remBtn = field('perm-remove', F.button('Remove', () => remove()));
    function paint() {
      U.clear(list);
      for (const e of entries) {
        list.appendChild(h('div.sf-prin' + (e === cur ? '.sel' : ''), { dataset: { acct: e.account }, onPointerdown: () => { cur = e; paint(); } },
          h('span.sf-pic', { html: isGroupName(e.account) ? I.adGroup : I.adUser }), h('span', display(e.account))));
      }
      U.clear(head);
      head.append(h('span', cur ? `Permissions for ${display(cur.account).replace(/ \(.*\)$/, '')}` : 'Permissions'), h('span.sf-pcol', 'Allow'), h('span.sf-pcol', 'Deny'));
      for (const r of RIGHTS) for (const type of ['Allow', 'Deny']) {
        const cb = boxes[r][type];
        cb.disabled = !cur;
        cb.checked = !!cur && (type === 'Allow' ? cur.allow : cur.deny).has(r);
      }
      remBtn.disabled = !cur;
    }
    /** Full Control implies Change implies Read; ticking Allow clears the same Deny box (and the reverse). */
    function set(right, type, on) {
      if (!cur) return;
      const mine = type === 'Allow' ? cur.allow : cur.deny, other = type === 'Allow' ? cur.deny : cur.allow;
      const i = RIGHTS.indexOf(right);
      if (on) for (const r of RIGHTS.slice(i)) { mine.add(r); other.delete(r); }
      else for (const r of RIGHTS.slice(0, i + 1)) mine.delete(r);
      paint(); changed();
    }
    function add(picked) {
      for (const p of picked || []) {
        const account = p.principal || p.name || p;
        let e = entries.find(x => x.account.toLowerCase() === String(account).toLowerCase());
        if (!e) { e = { account, allow: new Set(['Read']), deny: new Set() }; entries.push(e); }
        cur = e;
      }
      paint(); changed();
    }
    async function pick() { const r = await WS.ui.objectPicker({ types: ['user', 'group', 'principal'], onCreate: o.onPicker }); if (r && r.length) add(r); }
    function remove() { if (!cur) return; const i = entries.indexOf(cur); entries.splice(i, 1); cur = entries[Math.min(i, entries.length - 1)] || null; paint(); changed(); }
    const changed = () => { if (o.onChange) o.onChange(); };
    list.addEventListener('keydown', e => {
      const i = entries.indexOf(cur);
      if (e.key === 'ArrowDown' && i < entries.length - 1) { cur = entries[i + 1]; paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && i > 0) { cur = entries[i - 1]; paint(); e.preventDefault(); }
      else if (e.key === 'Delete') { remove(); e.preventDefault(); }
    });
    paint();
    const el = h('div.sf-perm', h('div', 'Group or user names:'), list, h('div.sf-pbtns', addBtn, remBtn), h('div.sf-ptable', head, grid));
    return {
      el, access: () => toAccess(entries), entries: () => entries,
      select(account) { cur = entries.find(x => x.account.toLowerCase() === String(account).toLowerCase()) || cur; paint(); },
      add, remove, set, pick
    };
  }
  const shareTab = (access, onChange) => {
    const ed = permEditor(access, { onChange });
    return { ed, el: h('div', ed.el) };
  };
  /** "Permissions for <share>" - a one-tab property sheet over the editor. */
  function permissions(target, opts = {}) {
    const s = typeof target === 'string' ? WS.smb.get(target) : null;
    const title = s ? `Permissions for ${s.name}` : target.title;
    let ed, result = null;
    return WS.ui.propertySheet({ title, width: 380, errorTitle: title, onCreate: sh => { if (opts.onCreate) opts.onCreate(sh, () => ed); },
      tabs: [{ label: 'Share Permissions',
        render: sh => { const t = shareTab(s ? s.access : target.access, () => sh.setDirty()); ed = t.ed; return t.el; },
        apply: () => { if (s) return WS.smb.setAccess(s.name, ed.access()); result = ed.access(); return null; } }]
    }).then(applied => (s ? applied : applied ? result : null));
  }

  /** Offline Settings (Caching): Manual | None | Documents | Programs. */
  function offlineSettings(mode, opts = {}) {
    const g = U.uid('off');
    const r = {
      Manual: field('cache-Manual', F.radio(g, 'Only the files and programs that users specify are available offline', mode === 'Manual' || mode === 'BranchCache')),
      None: field('cache-None', F.radio(g, 'No files or programs from the shared folder are available offline', mode === 'None')),
      Documents: field('cache-Documents', F.radio(g, 'All files and programs that users open from the shared folder are automatically available offline', mode === 'Documents' || mode === 'Programs'))
    };
    const perf = field('cache-perf', F.checkbox('Optimize for performance', mode === 'Programs'));
    const paint = () => { perf.input.disabled = !r.Documents.checked; if (perf.input.disabled) perf.checked = false; };
    const content = h('div.w32.sf-form', h('p.sf-p', 'You can choose whether and which files and programs in the shared folder are available to users who are offline.'),
      r.Manual, F.checkbox('Enable BranchCache', false, { disabled: true }), r.None, r.Documents, h('div.sf-indent', perf));
    content.addEventListener('change', paint); paint();
    return WS.ui.dialog({ title: 'Offline Settings', width: 470, content, onCreate: opts.onCreate, buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true }] })
      .then(a => (a !== 'ok' ? null : r.None.checked ? 'None' : r.Documents.checked ? (perf.checked ? 'Programs' : 'Documents') : 'Manual'));
  }

  /* ================================================================ Create A Shared Folder Wizard */
  const PERM_OPTS = [
    ['read', 'All users have read-only access', () => [{ account: 'Everyone', right: 'Read', type: 'Allow' }]],
    ['adminRead', 'Administrators have full access; other users have read-only access', () => [{ account: 'Everyone', right: 'Read', type: 'Allow' }, { account: 'Administrators', right: 'Full', type: 'Allow' }]],
    ['adminChange', 'Administrators have full access; other users have read and write access', () => [{ account: 'Everyone', right: 'Change', type: 'Allow' }, { account: 'Administrators', right: 'Full', type: 'Allow' }]],
    ['adminOnly', 'Administrators have full access; other users have no access', () => [{ account: 'Administrators', right: 'Full', type: 'Allow' }]],
    ['custom', 'Customize permissions', null]
  ];
  const baseName = p => { const t = String(p).replace(/\\+$/, ''); return /^[A-Za-z]:$/.test(t) ? t[0].toUpperCase() : t.split('\\').pop(); };
  function newShare(opts = {}) {
    const W = 'Create A Shared Folder Wizard', g = U.uid('csf'), c = {};
    const data = { path: opts.path || '', name: '', nameTouched: false, description: '', caching: 'Manual', perm: 'read', custom: null, share: null, again: false };
    const pages = [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the Create A Shared Folder Wizard',
        render: () => h('div.sf-wtext', h('p', 'This wizard helps you share a folder with other users on the network.'), h('p', 'To continue, click Next.')) },
      { id: 'path', title: 'Folder Path', subtitle: 'Specify the computer name and the path to the folder you want to share.',
        render: () => {
          c.path = field('path', F.text({ value: data.path }));
          const browse = field('browse', F.button('Browse...', async () => {
            const p = await WS.ui.filePicker({ mode: 'folder', title: 'Browse For Folder', prompt: 'Select the folder you want to share.', path: c.path.value.trim() || 'C:\\' });
            if (p) c.path.value = p;
          }));
          return h('div.sf-wz',
            F.row('Computer name:', h('span.sf-line', F.text({ value: WS.sys.name, readOnly: true }), F.button('Browse...', () => {}, { disabled: true })), { labelWidth: 100 }),
            h('p.sf-p', 'Type the path to the folder you want to share, or click Browse to pick the folder or add a new folder.'),
            F.row('Folder path:', h('span.sf-line', c.path, browse), { labelWidth: 100 }),
            h('div.sf-example', 'Example: C:\\Docs\\Public'));
        },
        validate: async () => {
          const raw = c.path.value.trim();
          if (!raw) return 'Type the path of the folder you want to share.';
          let full;
          try { full = WS.fs.full(raw); } catch (e) { return 'The path is not valid. Type a full path, such as C:\\Docs\\Public.'; }
          if (!/^[A-Za-z]:\\/.test(full)) return 'The path is not valid. Type a full path, such as C:\\Docs\\Public.';
          const st = WS.fs.stat(full);
          if (st && st.type !== 'dir') return `${full} is not a folder. Type the path of a folder.`;
          if (!st) {
            if (!WS.fs.drives().includes(full[0].toUpperCase())) return 'The system cannot find the drive specified.';
            if (!(await ask(`The folder ${full} does not exist. Do you want to create it?`, W))) return false;
            try { WS.fs.mkdir(full); } catch (e) { return e.message || 'The folder could not be created.'; }
          }
          if (data.path.toLowerCase() !== full.toLowerCase()) data.nameTouched = false;
          data.path = full;
          return null;
        } },
      { id: 'name', title: 'Name, Description, and Settings', subtitle: 'Specify how people see and use this share over the network.',
        render: () => {
          c.name = field('name', F.text({ maxLength: 80 }));
          c.unc = F.value('');
          c.desc = field('description', F.text());
          c.cache = F.value(CACHE[data.caching]);
          c.name.addEventListener('input', () => { data.nameTouched = true; c.unc.textContent = unc(c.name.value.trim()); });
          const change = field('offline', F.button('Change...', async () => { const m = await offlineSettings(data.caching, { onCreate: opts.onOffline }); if (m) { data.caching = m; c.cache.textContent = CACHE[m]; } }));
          const lw = { labelWidth: 100 };
          return h('div.sf-wz', h('p.sf-p', 'Type information about the share for users. To modify how people use the content while offline, click Change.'),
            F.row('Share name:', c.name, lw), F.row('Share path:', c.unc, lw), F.row('Description:', c.desc, lw), F.row('Offline setting:', h('span.sf-line', c.cache, change), lw));
        },
        enter: () => { if (!data.nameTouched) c.name.value = baseName(data.path); c.unc.textContent = unc(c.name.value.trim()); },
        validate: () => {
          const n = c.name.value.trim();
          if (!n) return 'Type a share name.';
          if (n.length > 80 || /[\\/[\]:|<>+=;,?*"]/.test(n)) return 'The share name contains invalid characters.';
          if (WS.smb.get(n)) return `The share name ${n} already exists on this computer. Choose another share name.`;
          data.name = n; data.description = c.desc.value;
          return null;
        } },
      { id: 'perms', title: 'Shared Folder Permissions', subtitle: 'Permissions let you control who can see the folder and the level of access they have.', nextLabel: 'Finish',
        render: () => {
          const custom = field('custom', F.button('Custom...', async () => {
            const r = await permissions({ title: 'Customize Permissions', access: data.custom || PERM_OPTS[0][2]() }, { onCreate: opts.onCustom });
            if (r) data.custom = r;
          }, { disabled: data.perm !== 'custom' }));
          const radios = PERM_OPTS.map(([k, label]) => field('perm-' + k, F.radio(g, label, data.perm === k, { onChange: v => { if (v) { data.perm = k; custom.disabled = k !== 'custom'; } } })));
          return h('div.sf-wz', h('p.sf-p', 'Set the kind of permissions you want for the shared folder.'), ...radios.slice(0, 4), h('div.sf-line', radios[4], custom),
            h('p.sf-note', 'By default, only share permissions are set on this folder. To control local access permissions for this folder or objects within the folder, click Custom and then modify the permissions on the Security tab to apply specific permissions on the folder.'));
        },
        validate: () => {
          const opt = PERM_OPTS.find(x => x[0] === data.perm);
          const access = opt[2] ? opt[2]() : data.custom || PERM_OPTS[0][2]();
          const r = WS.smb.newShare({ name: data.name, path: data.path, description: data.description, cachingMode: data.caching, access });
          if (!r.ok) return r;
          data.share = r.share;
          return null;
        } },
      { id: 'done', title: 'Sharing was Successful', subtitle: 'Status: You have successfully completed the Create A Shared Folder Wizard.', noBack: true, rerender: true,
        render: () => {
          const summary = field('summary', F.textarea({ readOnly: true, rows: 7, value: ['You have selected the following share settings:', '', `Share path: ${unc(data.name)}`, `Folder path: ${data.path}`, `Description: ${data.description}`, `Offline setting: ${CACHE[data.caching]}`].join('\r\n') }));
          c.again = field('again', F.checkbox('When I click Finish, run the wizard again to share another folder', false, { onChange: v => { data.again = v; } }));
          return h('div.sf-wz', h('div', 'Summary:'), summary, c.again, h('p.sf-p', 'To close this wizard, click Finish.'));
        } }
    ];
    return WS.ui.wizard({ title: W, style: 'classic', icon: I.share, width: 560, height: 450, data, pages, onCreate: w => { if (opts.onCreate) opts.onCreate(w, data); } })
      .then(res => {
        if (data.share && data.again) setTimeout(() => newShare({ onCreate: opts.onAgain }), 0);
        return data.share;
      });
  }

  /* ================================================================ share properties */
  async function stopSharing(names) {
    names = [].concat(names || []);
    if (!names.length) return false;
    const msg = names.length === 1 ? `Are you sure you wish to stop sharing ${names[0]}?` : `Are you sure you wish to stop sharing these ${names.length} items?`;
    if (!(await ask(msg))) return false;
    for (const n of names) { const r = WS.smb.removeShare(n); if (!r.ok) { await err(r); return false; } }
    return true;
  }
  function shareProperties(name, opts = {}) {
    const s = WS.smb.get(name);
    if (!s) return Promise.resolve(false);
    const g = U.uid('shp');
    let c = {}, ed = null, caching = s.cachingMode || 'Manual';
    const tabs = [
      { label: 'General', render: sh => {
        const limit = s.concurrentUserLimit || 0;
        c.desc = field('description', F.text({ value: s.description || '' }));
        c.max = field('limit-max', F.radio(g, 'Maximum allowed', !limit));
        c.some = field('limit-some', F.radio(g, 'Allow this number of users:', !!limit));
        c.n = field('limit', F.number({ value: limit || 1, min: 1, max: UNLIMITED, width: 90 }));
        const paint = () => { c.n.disabled = !c.some.checked; };
        c.max.input.addEventListener('change', paint); c.some.input.addEventListener('change', paint); paint();
        const lw = { labelWidth: 90 };
        return h('div',
          F.row('Share name:', F.value(s.name), lw), F.row('Folder path:', F.value(s.path), lw), F.row('Description:', c.desc, lw),
          F.group('User limit', c.max, h('div.sf-line', c.some, c.n)),
          h('p.sf-p', 'To modify how people use the content while offline, click Offline Settings.'),
          h('div.sf-btnrow', field('offline', F.button('Offline Settings...', async () => { const m = await offlineSettings(caching, { onCreate: opts.onOffline }); if (m && m !== caching) { caching = m; sh.setDirty(); } }, { disabled: s.special }))));
      },
      apply: () => {
        if (c.some.checked && !(+c.n.value >= 1 && +c.n.value <= UNLIMITED)) return `The user limit must be a number between 1 and ${UNLIMITED}.`;
        return WS.smb.setShare(s.name, { description: c.desc.value, concurrentUserLimit: c.some.checked ? +c.n.value : 0, cachingMode: caching });
      } },
      { label: 'Share Permissions', render: sh => {
        if (s.special) return h('div.sf-admin', 'This has been shared for administrative purposes. The permissions cannot be set.');
        const t = shareTab(s.access, () => sh.setDirty()); ed = t.ed; return t.el;
      },
      apply: () => (ed ? WS.smb.setAccess(s.name, ed.access()) : null) }
    ];
    return WS.ui.propertySheet({ title: `${s.name} Properties`, width: 400, errorTitle: TITLE, initialTab: opts.tab === 'Share Permissions' ? 1 : 0, tabs,
      onCreate: sh => { if (opts.onCreate) opts.onCreate(sh, () => ed); } });
  }

  /* ================================================================ Advanced Sharing (Explorer) */
  function advancedSharing(path, opts = {}) {
    const full = WS.fs.full(path);
    const mine = () => WS.smb.sharesFor(full).filter(s => !s.special);
    const st = { on: mine().length > 0, sel: mine()[0] ? mine()[0].name : null, access: null, caching: 'Manual', created: false };
    const frame = WS.ui.modal({ title: 'Advanced Sharing', width: 400, className: 'w32-dlg sf-dlg', closeValue: false });
    const cb = field('share', F.checkbox('Share this folder', st.on));
    const nameText = field('name', F.text({ value: baseName(full), maxLength: 80 }));
    const nameSel = field('names', F.select([], '', {}));
    const limit = field('limit', F.number({ value: UNLIMITED, min: 1, max: UNLIMITED, width: 100 }));
    const comments = field('comments', F.textarea({ rows: 3 }));
    const addB = field('add', F.button('Add', () => addShare())), remB = field('remove', F.button('Remove', () => removeShare()));
    const permB = field('permissions', F.button('Permissions', () => perms())), cacheB = field('caching', F.button('Caching', () => cache()));
    const nameBox = h('span.sf-namebox');
    const okBtn = h('button.btn.primary', { onClick: async () => { if (await apply()) frame.close(true); } }, 'OK');
    const applyBtn = h('button.btn', { onClick: () => apply() }, 'Apply');
    function paint() {
      const shares = mine();
      U.clear(nameBox);
      if (shares.length) {
        U.clear(nameSel);
        for (const s of shares) nameSel.appendChild(h('option', { value: s.name, selected: s.name === st.sel }, s.name));
        nameBox.appendChild(nameSel);
        const s = WS.smb.get(st.sel) || shares[0];
        st.sel = s.name;
        comments.value = s.description || '';
        limit.value = s.concurrentUserLimit || UNLIMITED;
      } else nameBox.appendChild(nameText);
      const on = cb.checked;
      [nameText, nameSel, limit, comments].forEach(x => { x.disabled = !on; });
      addB.disabled = !on || !shares.length; remB.disabled = !on || shares.length < 2;
      permB.disabled = cacheB.disabled = !on;
    }
    nameSel.addEventListener('change', () => { st.sel = nameSel.value; paint(); });
    cb.input.addEventListener('change', paint);
    async function apply() {
      const shares = mine();
      const lim = +limit.value >= UNLIMITED ? 0 : +limit.value;
      if (cb.checked && !(+limit.value >= 1 && +limit.value <= UNLIMITED)) { await err(`The user limit must be a number between 1 and ${UNLIMITED}.`, 'Advanced Sharing'); return false; }
      if (cb.checked && !shares.length) {
        const r = WS.smb.newShare({ name: nameText.value.trim(), path: full, description: comments.value, concurrentUserLimit: lim, cachingMode: st.caching, access: st.access || [{ account: 'Everyone', right: 'Read', type: 'Allow' }] });
        if (!r.ok) { await err(r, 'Advanced Sharing'); return false; }
        st.sel = r.share.name; st.created = true;
      } else if (cb.checked) {
        const r = WS.smb.setShare(st.sel, { description: comments.value, concurrentUserLimit: lim });
        if (!r.ok) { await err(r, 'Advanced Sharing'); return false; }
      } else if (shares.length) {
        for (const s of shares) { const r = WS.smb.removeShare(s.name); if (!r.ok) { await err(r, 'Advanced Sharing'); return false; } }
      }
      paint();
      return true;
    }
    async function perms() {
      if (mine().length) { await permissions(st.sel, { onCreate: opts.onPermissions }); return; }
      const r = await permissions({ title: `Permissions for ${nameText.value.trim() || baseName(full)}`, access: st.access || [{ account: 'Everyone', right: 'Read', type: 'Allow' }] }, { onCreate: opts.onPermissions });
      if (r) st.access = r;
    }
    async function cache() {
      const cur = mine().length ? WS.smb.get(st.sel).cachingMode || 'Manual' : st.caching;
      const m = await offlineSettings(cur, { onCreate: opts.onOffline });
      if (!m) return;
      if (mine().length) WS.smb.setShare(st.sel, { cachingMode: m }); else st.caching = m;
    }
    async function addShare() {
      const n = field('newname', F.text({ maxLength: 80 })), d = field('newdesc', F.text());
      const content = h('div.w32.sf-form', F.row('Share name:', n, { labelWidth: 90 }), F.row('Description:', d, { labelWidth: 90 }));
      const a = await WS.ui.dialog({ title: 'New Share', width: 360, content, onCreate: opts.onAdd, buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true }] });
      if (a !== 'ok') return;
      const r = WS.smb.newShare({ name: n.value.trim(), path: full, description: d.value });
      if (!r.ok) { await err(r, 'Advanced Sharing'); return; }
      st.sel = r.share.name; paint();
    }
    async function removeShare() {
      if (mine().length < 2) return;
      const r = WS.smb.removeShare(st.sel);
      if (!r.ok) { await err(r, 'Advanced Sharing'); return; }
      st.sel = mine()[0].name; paint();
    }
    frame.body.appendChild(h('div.w32.sf-form', cb,
      F.group('Settings',
        F.row('Share name:', nameBox, { labelWidth: 90 }), h('div.sf-btnrow', addB, remB),
        F.row('Limit the number of simultaneous users to:', limit, { labelWidth: 250 }),
        F.row('Comments:', comments, { labelWidth: 90 }),
        h('div.sf-btnrow.left', permB, cacheB))));
    frame.footer.append(okBtn, h('button.btn', { onClick: () => frame.close(st.created) }, 'Cancel'), applyBtn);
    frame.onEnter = () => okBtn.click(); frame.onEscape = () => frame.close(st.created);
    Object.assign(frame, { apply, ok: () => okBtn.click() });
    paint();
    if (opts.onCreate) opts.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /* ================================================================ snap-in */
  const openPath = p => WS.apps.launch('explorer', { path: p });
  function snapin(opts = {}) {
    const sharesView = {
      columns: [
        { key: 'name', label: 'Share Name', width: 130 }, { key: 'path', label: 'Folder Path', width: 210 }, { key: 'type', label: 'Type', width: 70, value: () => 'Windows' },
        { key: 'conn', label: '# Client Connections', width: 130, type: 'num', align: 'right', value: () => 0 }, { key: 'description', label: 'Description', width: 220 }
      ],
      rows: () => WS.smb.shares(), getId: s => s.name, icon: () => ICON.shares, sortKey: 'name', multi: true,
      emptyText: 'There are no items to show in this view.',
      menu: (rows, mmc) => {
        if (!rows.length) return nodeMenu(mmc);
        const one = rows.length === 1;
        return [
          { label: '&Open', disabled: !one || !rows[0].path, action: () => openPath(rows[0].path) },
          { label: '&Stop Sharing', action: () => stopSharing(rows.map(r => r.name)) },
          SEP, { label: 'All Tas&ks', items: () => [{ label: '&Stop Sharing', action: () => stopSharing(rows.map(r => r.name)) }] },
          SEP, { label: 'Re&fresh', action: () => mmc.refresh() }
        ];
      },
      properties: r => shareProperties(r.name),
      delete: rows => stopSharing(rows.map(r => r.name)),
      itemLabel: r => r.name
    };
    const nodeMenu = () => [{ label: 'New &Share...', action: () => newShare() }, SEP, { label: 'All Tas&ks', items: () => [{ label: 'New &Share...', action: () => newShare() }] }];
    const emptyView = (cols, menu) => ({ columns: cols, rows: () => [], getId: r => r.id, multi: false, emptyText: 'There are no items to show in this view.', menu: () => menu });
    const sessions = emptyView([{ key: 'user', label: 'User', width: 120 }, { key: 'computer', label: 'Computer', width: 120 }, { key: 'type', label: 'Type', width: 70 }, { key: 'files', label: '# Open Files', width: 90 },
      { key: 'connected', label: 'Connected Time', width: 110 }, { key: 'idle', label: 'Idle Time', width: 90 }, { key: 'guest', label: 'Guest', width: 60 }],
    [{ label: '&Disconnect All Sessions', disabled: true }, SEP, { label: 'All Tas&ks', items: () => [{ label: '&Disconnect All Sessions', disabled: true }] }]);
    const files = emptyView([{ key: 'file', label: 'Open File', width: 240 }, { key: 'by', label: 'Accessed By', width: 120 }, { key: 'type', label: 'Type', width: 70 }, { key: 'locks', label: '# Locks', width: 70 }, { key: 'mode', label: 'Open Mode', width: 110 }],
      [{ label: '&Disconnect All Open Files', disabled: true }, SEP, { label: 'All Tas&ks', items: () => [{ label: '&Disconnect All Open Files', disabled: true }] }]);
    const kids = [
      { id: 'sf-shares', label: 'Shares', icon: ICON.shares, view: sharesView, menu: nodeMenu },
      { id: 'sf-sessions', label: 'Sessions', icon: ICON.sessions, view: sessions, menu: () => [{ label: '&Disconnect All Sessions', disabled: true }] },
      { id: 'sf-files', label: 'Open Files', icon: ICON.files, view: files, menu: () => [{ label: '&Disconnect All Open Files', disabled: true }] }
    ];
    const node = { id: 'sf-root', label: opts.label || TITLE, icon: ICON.root, expanded: !!opts.expanded, children: kids,
      view: { columns: [{ key: 'label', label: 'Name', width: 200 }], rows: () => kids, getId: n => n.id, icon: n => n.icon, sortKey: null, multi: false,
        onActivate: (n, mmc) => mmc.selectPath([mmc.current().id, n.id]) } };
    return { node };
  }
  function launch() {
    const snap = snapin({ label: 'Shared Folders (Local)', expanded: true });
    const mmc = WS.mmc.create({ app: 'fsmgmt', title: TITLE, icon: ICON.root, width: 960, height: 600, topics: ['smb'], nodes: [snap.node], select: 'sf-shares' });
    return mmc.win;
  }

  WS.fsmgmt = { launch, snapin, newShare, shareProperties, stopSharing, permissions, offlineSettings, advancedSharing, permEditor, toEntries, toAccess, ICON };
  WS.apps.register({ id: 'fsmgmt', name: TITLE, icon: ICON.root, launch, keywords: ['fsmgmt.msc', 'shared folders', 'shares', 'share'] });
})();
