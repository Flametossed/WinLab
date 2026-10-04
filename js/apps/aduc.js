/* Active Directory Users and Computers (dsa.msc). All directory changes use WS.ad.
 * WS.aduc exposes the dialogs for callers/tests; launch returns a window with win.aduc.mmc. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, A = WS.ad;
  const title = 'Active Directory Users and Computers';
  const labels = { domainDNS: 'Domain', builtinDomain: 'Builtin', container: 'Container', organizationalUnit: 'Organizational Unit',
    user: 'User', group: 'Group', computer: 'Computer', foreignSecurityPrincipal: 'Foreign Security Principal' };
  const icon = o => ({ domainDNS: I.domain, builtinDomain: I.builtin, container: I.container, organizationalUnit: I.ou,
    user: o.enabled === false ? I.adUserDisabled : I.adUser, group: I.adGroup,
    computer: o.enabled === false ? I.adComputerDisabled : I.adComputer, foreignSecurityPrincipal: I.fsp })[o.type] || I.folder;
  const field = (name, control) => {
    const input = control.input || control;
    input.dataset.field = name; input.setAttribute('aria-label', name);
    return control;
  };
  const columns = [
    { key: 'name', label: 'Name', width: 220 },
    { key: 'type', label: 'Type', width: 180, value: o => labels[o.type] || o.type },
    { key: 'description', label: 'Description', width: 310 }
  ];
  const canCreate = p => p && A.isContainer(p) && p.type !== 'builtinDomain';
  const destination = p => F.note('Create in: ' + A.canonical(p));
  const error = r => WS.ui.msgbox({ title, icon: 'error', message: r.error, detail: r.detail });

  function formDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 440, className: 'w32-dlg aduc-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32.aduc-form', o.content));
    let busy = false;
    const submit = async () => {
      if (busy) return;
      busy = true; ok.disabled = true;
      try {
        const r = await o.submit();
        if (r && r.ok === false) await WS.ui.msgbox({ title: o.title, icon: 'error', message: r.error, detail: r.detail });
        else if (r !== false) frame.close(r);
      } finally { busy = false; ok.disabled = false; }
    };
    const ok = h('button.btn.primary', { onClick: submit }, o.okLabel || 'OK');
    frame.footer.append(ok, h('button.btn', { onClick: () => { if (!busy) frame.close(null); } }, 'Cancel'));
    frame.onEnter = submit;
    frame.onEscape = () => { if (!busy) frame.close(null); };
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  function newOU(parent, opts = {}) {
    const p = A.get(parent); if (!canCreate(p)) return null;
    const name = field('name', F.text()), protect = field('protect', F.checkbox('Protect container from accidental deletion', true));
    return formDialog({ title: 'New Object - Organizational Unit', onCreate: opts.onCreate,
      content: h('div', destination(p), F.row('Name:', name), protect),
      submit: () => A.createOU({ name: name.value, parent: p, protect: protect.checked }) });
  }

  function newGroup(parent, opts = {}) {
    const p = A.get(parent); if (!canCreate(p)) return null;
    const name = field('name', F.text()), sam = field('sam', F.text({ maxLength: 256 }));
    let lastName = '';
    name.addEventListener('input', () => { if (!sam.value || sam.value === lastName) sam.value = name.value; lastName = name.value; });
    const scope = field('scope', F.select([{ value: 'DomainLocal', label: 'Domain local' }, 'Global', 'Universal'], 'Global'));
    const category = field('category', F.select(['Security', 'Distribution'], 'Security'));
    return formDialog({ title: 'New Object - Group', onCreate: opts.onCreate,
      content: h('div', destination(p), F.row('Group name:', name), F.row('Group name (pre-Windows 2000):', sam, { labelWidth: 175 }),
        F.row('Group scope:', scope), F.row('Group type:', category)),
      submit: () => A.createGroup({ name: name.value, sam: sam.value, parent: p, scope: scope.value, category: category.value }) });
  }

  function newComputer(parent, opts = {}) {
    const p = A.get(parent); if (!canCreate(p)) return null;
    const name = field('name', F.text({ maxLength: 15 }));
    return formDialog({ title: 'New Object - Computer', onCreate: opts.onCreate,
      content: h('div', destination(p), F.row('Computer name:', name), F.note('A computer account will be created in the selected container.')),
      submit: () => A.createComputer({ name: name.value, parent: p }) });
  }

  function newUser(parent, opts = {}) {
    const p = A.get(parent); if (!canCreate(p)) return null;
    const c = {}, text = (key, o) => (c[key] = field(key, F.text(o)));
    const check = (key, label, value) => (c[key] = field(key, F.checkbox(label, value)));
    let generated = '', generatedSam = '';
    const userData = () => ({ name: c.name.value.trim(), givenName: c.givenName.value.trim(), sn: c.sn.value.trim(), initials: c.initials.value.trim(),
      sam: c.sam.value.trim(), upn: c.logon.value.trim() ? c.logon.value.trim() + '@' + A.domain() : null,
      password: c.password.value, enabled: !c.disabled.checked, mustChange: c.mustChange.checked,
      cannotChange: c.cannotChange.checked, neverExpires: c.neverExpires.checked, parent: p });
    return WS.ui.wizard({ title: 'New Object - User', icon: I.adUser, width: 480, height: 460,
      onCreate: opts.onCreate,
      pages: [
        { id: 'identity', title: 'New Object - User', subtitle: 'Create in: ' + A.canonical(p), render: () => {
          const content = h('div.aduc-form', F.row('First name:', text('givenName')), F.row('Initials:', text('initials', { maxLength: 6 })),
            F.row('Last name:', text('sn')), F.row('Full name:', text('name')), F.sep(),
            F.row('User logon name:', h('div.aduc-inline', text('logon'), F.value('@' + A.domain()))),
            F.row('User logon name (pre-Windows 2000):', h('div.aduc-inline', F.value(A.netbios() + '\\'), text('sam', { maxLength: 20 })), { labelWidth: 170 }));
          const updateName = () => {
            const next = [c.givenName.value.trim(), c.initials.value.trim() && c.initials.value.trim() + '.', c.sn.value.trim()].filter(Boolean).join(' ');
            if (!c.name.value || c.name.value === generated) c.name.value = next;
            generated = next;
          };
          ['givenName', 'initials', 'sn'].forEach(k => c[k].addEventListener('input', updateName));
          c.logon.addEventListener('input', () => { if (!c.sam.value || c.sam.value === generatedSam) c.sam.value = c.logon.value.slice(0, 20); generatedSam = c.logon.value.slice(0, 20); });
          return content;
        }, validate: () => !c.name.value.trim() ? 'Enter a full name.' : !c.logon.value.trim() || !c.sam.value.trim() ? 'Enter a user logon name.' : /[@\\\s]/.test(c.logon.value.trim()) ? 'Enter the logon name without a domain suffix or spaces.' : null },
        { id: 'password', title: 'New Object - User', subtitle: 'Set the password and account options.', render: () => {
          const content = h('div.aduc-form', F.row('Password:', text('password', { password: true })), F.row('Confirm password:', text('confirm', { password: true })), F.sep(),
            check('mustChange', 'User must change password at next logon', true), check('cannotChange', 'User cannot change password', false),
            check('neverExpires', 'Password never expires', false), check('disabled', 'Account is disabled', false));
          c.mustChange.input.addEventListener('change', () => { if (c.mustChange.checked) { c.cannotChange.checked = false; c.neverExpires.checked = false; } });
          for (const k of ['cannotChange', 'neverExpires']) c[k].input.addEventListener('change', () => { if (c[k].checked) c.mustChange.checked = false; });
          return content;
        }, validate: () => c.password.value !== c.confirm.value ? 'The passwords do not match.' : U.checkPassword(c.password.value, { ...A.policy(), sam: c.sam.value, displayName: c.name.value }) },
        { id: 'summary', title: 'New Object - User', subtitle: 'Click Finish to create the user.', rerender: true,
          render: () => h('div.aduc-form', F.note('The following user account will be created:'), F.row('Full name:', F.value(c.name.value)),
            F.row('Logon name:', F.value(c.logon.value + '@' + A.domain())), F.row('Account:', F.value(c.disabled.checked ? 'Disabled' : 'Enabled')),
            c.mustChange.checked ? F.note('User must change password at next logon.') : null, c.neverExpires.checked ? F.note('Password never expires.') : null) }
      ], onFinish: w => {
        const r = A.createUser(userData());
        if (r.ok) w.data.object = r.object;
        return r;
      } });
  }

  function resetPassword(identity, opts = {}) {
    const u = A.get(identity, 'user'); if (!u) return null;
    const pw = field('password', F.text({ password: true })), confirm = field('confirm', F.text({ password: true }));
    const mustChange = field('mustChange', F.checkbox('User must change password at next logon', true));
    const unlock = field('unlock', F.checkbox('Unlock the user\'s account', !!u.lockedOut));
    return formDialog({ title: 'Reset Password', onCreate: opts.onCreate,
      content: h('div', F.note('Reset the password for ' + u.name + '.'), F.row('New password:', pw), F.row('Confirm password:', confirm), mustChange, unlock),
      submit: () => pw.value !== confirm.value ? { ok: false, error: 'The passwords do not match.' } : A.setPassword(u.id, pw.value, { mustChange: mustChange.checked, unlock: unlock.checked }) });
  }

  async function setEnabled(rows, enabled) {
    for (const o of rows) { const r = A.setEnabled(o.id, enabled); if (!r.ok) { await error(r); return r; } }
    return { ok: true };
  }
  async function addToGroup(rows) {
    const picked = await WS.ui.objectPicker({ title: 'Select Groups', source: 'ad', types: ['group'], multi: true });
    if (!picked) return;
    for (const g of picked) for (const o of rows) {
      const r = A.addMember(g.id, o.id); if (!r.ok) { await error(r); return r; }
    }
    return { ok: true };
  }
  async function rename(identity) {
    const o = A.get(identity); if (!o) return;
    let value = o.name;
    for (;;) {
      const next = await WS.ui.inputBox({ title: 'Rename', prompt: 'New name:', value });
      if (next === null) return;
      const r = A.rename(o.id, next);
      if (r.ok) return r;
      await error(r); value = next;
    }
  }

  function move(rows, opts = {}) {
    const gone = new Set(rows.flatMap(o => [o.id, ...A.descendants(o.id).map(d => d.id)]));
    let selected = null;
    const node = o => ({ id: o.id, label: o.type === 'domainDNS' ? A.domain() : o.name, icon: icon(o), expanded: o.type === 'domainDNS',
      children: () => A.children(o.id).filter(x => A.isContainer(x) && x.type !== 'builtinDomain' && !gone.has(x.id)).sort((a, b) => a.name.localeCompare(b.name)).map(node) });
    const tree = WS.ui.tree({ nodes: () => [node(A.root())], onSelect: n => { selected = A.get(n.id); } });
    tree.el.classList.add('aduc-destination');
    tree.select(A.root().id);
    return formDialog({ title: 'Move', onCreate: opts.onCreate,
      content: h('div', F.note('Select the container to which you want to move the selected objects.'), tree.el),
      submit: () => {
        if (!selected) return { ok: false, error: 'Select a destination container.' };
        for (const o of rows) { const r = A.move(o.id, selected); if (!r.ok) return r; }
        return { ok: true };
      } });
  }

  async function remove(rows) {
    // If a parent and child are both selected, delete the parent only once.
    const selected = new Set(rows.map(o => o.id));
    rows = rows.filter(o => { for (let p = A.get(o.parentId); p; p = A.get(p.parentId)) if (selected.has(p.id)) return false; return true; });
    for (const o of rows) {
      const sub = A.descendants(o.id);
      const recursive = F.checkbox('Delete this container and all of its objects', false);
      const answer = await WS.ui.dialog({ title: 'Confirm Deletion', width: 440,
        content: h('div.w32', F.note(`Are you sure you want to delete ${labels[o.type].toLowerCase()} "${o.name}"?`), sub.length ? recursive : null),
        buttons: [{ label: 'Yes', primary: true }, { label: 'No', cancel: true }] });
      if (answer !== 'Yes') return { ok: false, cancelled: true };
      if (sub.length && !recursive.checked) { await error({ error: 'This container is not empty. Select the option to delete its objects, or move them first.' }); return { ok: false }; }
      const r = A.remove(o.id, { recursive: !!sub.length });
      if (!r.ok) { await error(r); return r; }
    }
    return { ok: true };
  }

  function find(parent, opts = {}) {
    const base = A.get(parent) || A.root(); if (!base) return null;
    const name = field('name', F.text()), description = field('description', F.text());
    const type = field('type', F.select([{ value: 'accounts', label: 'Users and Groups' }, { value: 'user', label: 'Users' },
      { value: 'group', label: 'Groups' }, { value: 'computer', label: 'Computers' }, { value: 'organizationalUnit', label: 'Organizational Units' }, { value: 'all', label: 'All Objects' }], 'accounts'));
    const location = field('location', F.select([{ value: base.id, label: A.canonical(base) }, ...(base.id === A.root().id ? [] : [{ value: A.root().id, label: 'Entire Directory' }])], base.id));
    let results = [];
    const frame = WS.ui.modal({ title: 'Find Users and Groups', width: 730, className: 'w32-dlg aduc-find', closeValue: null });
    const count = F.note('Enter search criteria, then click Find Now.');
    const list = WS.ui.listView({ columns: [...columns.slice(0, 2), { key: 'folder', label: 'In Folder', width: 250, value: o => A.canonical(A.get(o.parentId) || o) }],
      rows: () => results, icon, getId: o => o.id, multi: true, emptyText: 'No objects found.',
      onActivate: o => WS.aduc.properties(o.id, { advanced: opts.advanced }),
      onContext: (rows, x, y) => WS.ui.contextMenu(x, y, rowMenu(rows, opts.console)) });
    list.el.classList.add('aduc-find-results');
    const run = () => {
      const q = name.value.trim(), d = description.value.trim().toLowerCase();
      results = A.search({ under: A.get(location.value), advanced: !!opts.advanced,
        type: type.value === 'all' ? undefined : type.value === 'accounts' ? ['user', 'group'] : type.value,
        name: q ? (/[?*]/.test(q) ? q : q + '*') : undefined,
        filter: o => !d || (o.description || '').toLowerCase().includes(d) });
      list.refresh(); count.textContent = results.length + ' object(s) found.';
    };
    frame.body.appendChild(h('div.w32.aduc-form', F.row('Find:', type), F.row('In:', location), F.row('Name:', name), F.row('Description:', description),
      h('div.aduc-buttons', F.button('Find Now', run), F.button('Clear', () => { name.value = ''; description.value = ''; results = []; list.refresh(); count.textContent = 'Enter search criteria, then click Find Now.'; })), count, list.el));
    frame.footer.append(F.button('Properties', () => { const rows = list.selected(); if (rows.length === 1) WS.aduc.properties(rows[0].id, { advanced: opts.advanced }); }),
      F.button('Go to Object', () => { const o = list.selected()[0]; if (o && opts.console) { frame.close(); opts.console.locate(o); } }), F.button('Close', () => frame.close()));
    frame.onEnter = run; frame.onEscape = () => frame.close();
    if (opts.onCreate) opts.onCreate(frame, { list, run });
    WS.ui.focusFirst(frame, name);
    return frame.promise;
  }

  function rowMenu(rows, controller) {
    if (!rows.length) return [];
    const one = rows.length === 1, o = rows[0];
    const accounts = rows.every(x => ['user', 'computer'].includes(x.type));
    const principals = rows.every(x => ['user', 'computer', 'group'].includes(x.type));
    return [
      one && o.type === 'user' ? { label: 'Reset &Password...', icon: I.key, action: () => resetPassword(o.id) } : null,
      accounts ? { label: '&Enable Account', disabled: rows.every(x => x.enabled), icon: I.enable, action: () => setEnabled(rows, true) } : null,
      accounts ? { label: '&Disable Account', disabled: rows.every(x => !x.enabled), icon: I.disable, action: () => setEnabled(rows, false) } : null,
      principals ? { label: 'Add to a &group...', icon: I.newGroup, action: () => addToGroup(rows) } : null,
      { separator: true },
      { label: '&Move...', icon: I.move, disabled: rows.some(x => x.type === 'domainDNS' || x.type === 'builtinDomain'), action: () => move(rows) },
      { label: '&Delete', icon: I.delete, shortcut: 'Del', disabled: rows.some(x => x.critical || x.type === 'domainDNS'), action: () => remove(rows) },
      one ? { label: 'Rena&me', icon: I.rename, shortcut: 'F2', disabled: o.critical || o.type === 'domainDNS', action: () => rename(o.id) } : null,
      one && A.isContainer(o) && controller ? { label: '&Find...', icon: I.find, action: () => find(o.id, { advanced: controller.advanced, console: controller }) } : null
    ].filter(Boolean);
  }

  function launch(opts = {}) {
    let advanced = false, filter = null, mmc;
    const controller = { get advanced() { return advanced; }, get filter() { return filter; },
      setAdvanced(value) { advanced = !!value; mmc.refresh(); }, setFilter(types) { filter = types && new Set(types); mmc.refresh(); }, locate,
      get mmc() { return mmc; } };
    function locate(o) {
      if (!o || !A.get(o.id)) return;
      const path = []; for (let p = A.isContainer(o) ? o : A.get(o.parentId); p; p = A.get(p.parentId)) path.unshift(p.id);
      mmc.selectPath(['aduc-root', ...path]);
      if (!A.isContainer(o) && mmc.list) { mmc.list.select([o.id]); mmc.list.focus(); }
    }
    function createItems(p) {
      const after = promise => { if (promise) promise.then(r => { const o = r && (r.object || r.data && r.data.object); if (o) { mmc.refresh(); if (mmc.list) mmc.list.select([o.id]); } }); };
      return [
        { label: '&User', icon: I.newUser, action: () => after(newUser(p.id)) },
        { label: '&Group', icon: I.newGroup, action: () => after(newGroup(p.id)) },
        ['domainDNS', 'organizationalUnit'].includes(p.type) ? { label: '&Organizational Unit', icon: I.newOU, action: () => after(newOU(p.id)) } : null,
        { label: '&Computer', icon: I.adComputer, action: () => after(newComputer(p.id)) }
      ].filter(Boolean);
    }
    const scopeMenu = p => [canCreate(p) ? { label: '&New', items: () => createItems(p) } : null, ...rowMenu([p], controller)];
    const properties = o => WS.aduc.properties(o.id, { advanced });
    const viewFor = p => ({ columns, getId: o => o.id, icon, sortKey: 'name',
      rows: () => A.children(p.id, { advanced }).filter(o => !filter || filter.has(o.type)),
      menu: rows => rows.length ? rowMenu(rows, controller) : [canCreate(p) ? { label: '&New', items: () => createItems(p) } : null, { label: '&Find...', action: () => find(p.id, { advanced, console: controller }) }],
      properties, onActivate: o => A.isContainer(o) ? locate(o) : properties(o),
      delete: remove, rename: o => { if (!o.critical) rename(o.id); }, itemLabel: o => o.name,
      status: rows => rows.length ? rows.length + ' object(s) selected' : A.children(p.id, { advanced }).filter(o => !filter || filter.has(o.type)).length + ' object(s)',
      toolbar: [
        { icon: I.newUser, title: 'Create a new user in the current container', enabled: () => canCreate(p), action: () => newUser(p.id) },
        { icon: I.newGroup, title: 'Create a new group in the current container', enabled: () => canCreate(p), action: () => newGroup(p.id) },
        { icon: I.newOU, title: 'Create a new organizational unit in the current container', enabled: () => ['domainDNS', 'organizationalUnit'].includes(p.type), action: () => newOU(p.id) },
        { icon: I.find, title: 'Find objects in Active Directory', action: () => find(p.id, { advanced, console: controller }) }
      ] });
    const node = o => ({ id: o.id, label: o.type === 'domainDNS' ? A.domain() : o.name, icon: icon(o),
      expanded: o.type === 'domainDNS', children: () => A.children(o.id, { advanced }).filter(A.isContainer).sort((a, b) => a.name.localeCompare(b.name)).map(node),
      menu: () => scopeMenu(o), properties: () => properties(o), view: () => viewFor(o) });
    const disconnected = () => ({ render: host => { host.appendChild(h('div.aduc-empty.w32', h('h3', 'No domain is available'),
      F.note('Install Active Directory Domain Services and promote this server to a domain controller to manage its directory.'),
      F.button('Open Server Manager', () => WS.sm.open('dashboard')))); } });
    mmc = WS.mmc.create({ app: 'dsa', title, icon: I.adRoot, width: 1080, height: 680, topics: ['ad', 'system', 'features'],
      select: A.root() ? ['aduc-root', A.root().id] : 'aduc-root',
      nodes: () => [{ id: 'aduc-root', label: title, icon: I.adRoot, expanded: true,
        children: () => A.root() ? [node(A.root())] : [],
        menu: () => A.root() ? [{ label: '&Find...', action: () => find(A.root().id, { advanced, console: controller }) }] : [],
        view: () => A.root() ? { columns, getId: o => o.id, icon, rows: () => [{ ...A.root(), name: A.domain() }], onActivate: locate } : disconnected() }],
      viewMenu: () => [
        { label: '&Advanced Features', checked: advanced, action: () => controller.setAdvanced(!advanced) },
        { label: '&Filter Options...', action: () => {
          const types = ['builtinDomain', 'organizationalUnit', 'container', 'user', 'group', 'computer', 'foreignSecurityPrincipal'];
          const choices = types.map(t => F.checkbox(labels[t], !filter || filter.has(t)));
          WS.ui.dialog({ title: 'Filter Options', width: 380, content: h('div.w32', F.note('Show the following types of objects:'), ...choices),
            buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] }).then(r => { if (r === 'OK') controller.setFilter(types.filter((t, i) => choices[i].checked)); });
        } }
      ] });
    mmc.win.aduc = controller;
    if (opts.onCreate) opts.onCreate(controller);
    return mmc.win;
  }

  WS.aduc = { launch, newUser, newGroup, newOU, newComputer, resetPassword, setEnabled, addToGroup, rename, move, remove, find,
    icon, labels, columns, field, formDialog };
  WS.apps.register({ id: 'dsa', name: title, icon: I.adRoot, launch, keywords: ['aduc', 'dsa.msc', 'users', 'groups'] });
})();
