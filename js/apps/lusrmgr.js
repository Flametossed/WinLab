/* Local Users and Groups (lusrmgr.msc): Users and Groups over WS.local, the same model New-LocalUser, net user and
 * net localgroup use. On a domain controller the snap-in only shows the message Windows shows there.
 *   WS.lusrmgr.snapin({ label }) -> { node }   'lu-root' > Users 'lu-users' | Groups 'lu-groups'
 *   WS.lusrmgr.launch() -> win
 *   newUser(opts) / newGroup(opts) -> Promise<number created>   (Create keeps the dialog open, as in Windows)
 *   setPassword(name, opts) -> Promise<bool>                    the warning, then Set Password for <user>
 *   userProperties(name, opts) / groupProperties(name, opts) -> Promise<bool>
 *   deleteUsers(names) / deleteGroups(names) / rename(kind, name) -> Promise
 * Dialogs take opts.onCreate with the live frame / sheet; controls carry data-field names for tests. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, L = WS.local;
  const TITLE = 'Local Users and Groups';
  const DC_TEXT = 'This computer is a domain controller. This snap-in cannot be used on a domain controller. Domain accounts are managed with the Active Directory Users and Computers snap-in.';
  const MEMBERSHIP_NOTE = "Changes to a user's group membership are not effective until the next time the user logs on.";
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const ICON = {
    root: s16('<g transform="translate(-2 0)">' + inner(I.adUser) + '</g><g transform="translate(5 3) scale(.75)">' + inner(I.adGroup) + '</g>'),
    folder: I.folder, user: I.adUser, userOff: I.adUserDisabled, group: I.adGroup
  };
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = (r, title = TITLE) => WS.ui.msgbox({ title, icon: 'error', message: typeof r === 'string' ? r : r.error, detail: r.detail });
  const SEP = { separator: true };
  const lw = { labelWidth: 110 };

  /** A dialog with Create/Close: create() returns an error to keep the form, anything else counts one and resets it. */
  function createDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 400, className: 'w32-dlg lu-dlg', closeValue: 0 });
    frame.body.appendChild(h('div.w32.lu-form', o.content));
    let busy = false, made = 0;
    const create = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await o.create();
        if (typeof r === 'string' || (r && r.ok === false)) { await err(r, o.title); return; }
        made++;
        if (o.reset) o.reset();
      } finally { busy = false; }
    };
    const createBtn = h('button.btn.primary', { onClick: create }, 'Create');
    frame.footer.append(h('button.btn', { onClick: () => WS.ui.msgbox({ title: o.title, icon: 'info', message: 'Help is not available in the lab simulator.' }) }, 'Help'), createBtn, h('button.btn', { onClick: () => frame.close(made) }, 'Close'));
    frame.onEnter = create; frame.onEscape = () => frame.close(made);
    frame.create = create;
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /* ================================================================ users */
  /** The four account check boxes, with Windows' rule that "must change" excludes the other two password options. */
  function accountChecks(u, o = {}) {
    const c = {
      must: field('mustChange', F.checkbox('User must change password at next logon', u ? u.mustChange : true)),
      cannot: field('cannotChange', F.checkbox('User cannot change password', u ? u.cannotChange : false)),
      never: field('neverExpires', F.checkbox('Password never expires', u ? u.neverExpires : false)),
      disabled: field('disabled', F.checkbox('Account is disabled', u ? !u.enabled : false))
    };
    if (o.locked) c.locked = field('locked', F.checkbox('Account is locked out', false, { disabled: true }));
    const paint = () => { const m = c.must.checked; c.cannot.input.disabled = m; c.never.input.disabled = m; if (!m) c.must.input.disabled = c.cannot.checked || c.never.checked; };
    [c.must, c.cannot, c.never].forEach(x => x.input.addEventListener('change', paint));
    paint();
    c.el = h('div.lu-checks', c.must, c.cannot, c.never, c.disabled, c.locked || null);
    c.values = () => ({ mustChange: c.must.checked, cannotChange: c.cannot.checked, neverExpires: c.never.checked, enabled: !c.disabled.checked });
    return c;
  }
  function newUser(opts = {}) {
    if (!L.available()) return err(DC_TEXT).then(() => 0);
    const f = { name: field('name', F.text({ maxLength: 20 })), full: field('fullName', F.text()), desc: field('description', F.text()),
      pw: field('password', F.text({ password: true })), pw2: field('confirm', F.text({ password: true })) };
    let checks = accountChecks(null);
    const box = h('div', checks.el);
    const content = h('div',
      F.row('User name:', f.name, lw), F.row('Full name:', f.full, lw), F.row('Description:', f.desc, lw), F.sep(),
      F.row('Password:', f.pw, lw), F.row('Confirm password:', f.pw2, lw), box);
    return createDialog({ title: 'New User', width: 420, content, onCreate: opts.onCreate,
      create: () => {
        if (f.pw.value !== f.pw2.value) return 'The passwords typed do not match.';
        const v = checks.values();
        const r = L.createUser(f.name.value, { fullName: f.full.value, description: f.desc.value, password: f.pw.value, mustChange: v.mustChange, cannotChange: v.cannotChange, neverExpires: v.neverExpires, enabled: v.enabled });
        if (!r.ok) return r.code === 'UserExists' ? `The user ${f.name.value.trim()} already exists.` : r;
        return true;
      },
      reset: () => { for (const k of Object.keys(f)) f[k].value = ''; U.clear(box); checks = accountChecks(null); box.appendChild(checks.el); f.name.focus(); } });
  }
  async function setPassword(name, opts = {}) {
    const u = L.user(name);
    if (!u) return false;
    const warn = await WS.ui.dialog({ title: `Set Password for ${u.name}`, width: 470, onCreate: opts.onWarn,
      content: h('div.msgbox', h('div.msgbox-icon', { html: WS.ui.icons.warning }), h('div.msgbox-text',
        h('p.lu-p', 'Resetting this password might cause irreversible loss of information for this user account. For security reasons, Windows protects certain information by making it impossible to access if the user\'s password is reset. This data loss will occur the next time the user logs off.'),
        h('p.lu-p', 'You should use this command only if a user has forgotten his or her password and does not have a password reset disk. If this user has created a password reset disk, then he or she should use that disk to set the password.'),
        h('p.lu-p', 'If the user knows the password and wants to change it, he or she should log on, and then press CTRL+ALT+DEL and click Change Password.'))),
      buttons: [{ label: 'Proceed', primary: true }, { label: 'Cancel', cancel: true }] });
    if (warn !== 'Proceed') return false;
    const pw = field('password', F.text({ password: true })), pw2 = field('confirm', F.text({ password: true }));
    const frame = WS.ui.modal({ title: `Set Password for ${u.name}`, width: 420, className: 'w32-dlg lu-dlg', closeValue: false });
    frame.body.appendChild(h('div.w32.lu-form', F.row('New password:', pw, lw), F.row('Confirm password:', pw2, lw),
      h('p.lu-p', 'If you click OK, the following will occur:'),
      h('p.lu-p.ind', 'This user account will immediately lose access to all of its encrypted files, stored passwords, and personal security certificates.'),
      h('p.lu-p', 'If you click Cancel, the password will not be changed and no data will be lost.')));
    const ok = async () => {
      if (pw.value !== pw2.value) { await err('The passwords typed do not match.', 'Local Users and Groups'); return; }
      const r = L.setPassword(u.name, pw.value);
      if (!r.ok) { await err(r, 'Local Users and Groups'); return; }
      frame.close(true);
      await WS.ui.msgbox({ title: 'Local Users and Groups', icon: 'info', message: 'The password has been set.' });
    };
    frame.footer.append(h('button.btn.primary', { onClick: ok }, 'OK'), h('button.btn', { onClick: () => frame.close(false) }, 'Cancel'));
    frame.onEnter = ok; frame.onEscape = () => frame.close(false);
    frame.ok = ok;
    if (opts.onCreate) opts.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }
  /** A member list with Add.../Remove that applies when the sheet applies (draft until then). */
  function memberList(initial, o) {
    let items = initial.slice(), sel = null;
    const box = h('div.lu-members', { tabIndex: 0 });
    const addB = field(o.key + '-add', F.button('Add...', async () => {
      const picked = await WS.ui.objectPicker({ types: o.types, multi: true, source: 'local', title: o.pickTitle, onCreate: o.onPicker });
      if (!picked) return;
      for (const p of picked) { const n = p.name; if (!items.some(x => x.toLowerCase() === n.toLowerCase())) items.push(n); sel = n; }
      paint(); o.onChange();
    })), remB = field(o.key + '-remove', F.button('Remove', () => { if (!sel) return; items = items.filter(x => x !== sel); sel = null; paint(); o.onChange(); }));
    function paint() {
      U.clear(box);
      for (const n of items) box.appendChild(h('div.lu-mem' + (n === sel ? '.sel' : ''), { dataset: { name: n }, onPointerdown: () => { sel = n; paint(); } },
        h('span.lu-mic', { html: o.icon(n) }), h('span', o.label(n))));
      remB.disabled = !sel;
    }
    paint();
    return { el: h('div', box, h('div.lu-mbtns', addB, remB)), items: () => items.slice(), select: n => { sel = items.find(x => x.toLowerCase() === n.toLowerCase()) || null; paint(); }, remove: () => remB.click(),
      add: names => { for (const n of [].concat(names)) if (!items.some(x => x.toLowerCase() === n.toLowerCase())) items.push(n); paint(); o.onChange(); } };
  }
  /** Apply a membership draft through the model, group by group. */
  function applyMembership(before, after, fnAdd, fnRemove) {
    const low = a => a.map(x => x.toLowerCase());
    for (const n of after) if (!low(before).includes(n.toLowerCase())) { const r = fnAdd(n); if (!r.ok) return r; }
    for (const n of before) if (!low(after).includes(n.toLowerCase())) { const r = fnRemove(n); if (!r.ok) return r; }
    return null;
  }
  function userProperties(name, opts = {}) {
    const u = L.user(name);
    if (!u) return Promise.resolve(false);
    let g = null, checks = null, mem = null, prof = null;
    const tabs = [
      { label: 'General', render: () => {
        g = { full: field('fullName', F.text({ value: u.fullName })), desc: field('description', F.text({ value: u.description })) };
        checks = accountChecks(u, { locked: true });
        return h('div', h('div.lu-head', h('span.lu-hic', { html: u.enabled ? ICON.user : ICON.userOff }), h('span', u.name)), F.sep(),
          F.row('Full name:', g.full, lw), F.row('Description:', g.desc, lw), checks.el);
      },
      apply: () => {
        const v = checks.values();
        if (v.mustChange && v.neverExpires) return 'You have selected Password never expires. The user will not be required to change the password at next logon.';
        return L.setUser(u.name, { fullName: g.full.value, description: g.desc.value, ...v });
      } },
      { label: 'Member Of', render: sh => {
        mem = memberList(L.groupsOf(u.name), { key: 'memberof', types: ['group'], pickTitle: 'Select Groups', icon: () => ICON.group, label: n => n, onChange: () => sh.setDirty(), onPicker: opts.onPicker });
        return h('div', h('div', 'Member of:'), mem.el, h('p.lu-note', MEMBERSHIP_NOTE));
      },
      apply: () => applyMembership(L.groupsOf(u.name), mem.items(), gn => L.addMember(gn, u.name), gn => L.removeMember(gn, u.name)) },
      { label: 'Profile', render: () => {
        prof = { path: field('profilePath', F.text({ value: u.profilePath || '' })), script: field('logonScript', F.text({ value: u.logonScript || '' })), home: field('homeDirectory', F.text({ value: u.homeDirectory || '' })) };
        return h('div', F.group('User profile', F.row('Profile path:', prof.path, { labelWidth: 90 }), F.row('Logon script:', prof.script, { labelWidth: 90 })),
          F.group('Home folder', F.row('Local path:', prof.home, { labelWidth: 90 })));
      },
      apply: () => L.setUser(u.name, { profilePath: prof.path.value, logonScript: prof.script.value, homeDirectory: prof.home.value }) }
    ];
    return WS.ui.propertySheet({ title: `${u.name} Properties`, width: 410, errorTitle: TITLE, tabs, initialTab: opts.tab === 'Member Of' ? 1 : 0, onCreate: sh => { if (opts.onCreate) opts.onCreate(sh, () => mem); } });
  }
  async function deleteUsers(names) {
    names = [].concat(names);
    if (!names.length) return false;
    const what = names.length === 1 ? `the user ${names[0]}` : 'the selected users';
    const a = await WS.ui.msgbox({ title: TITLE, icon: 'warning', buttons: ['Yes', 'No'],
      message: `Each user account has a unique identifier in addition to their user name. Deleting a user account deletes this identifier and it cannot be restored, even if you create an account with an identical name. This can prevent the user from accessing resources they currently have permission to access.\n\nAre you sure you want to delete ${what}?` });
    if (a !== 'Yes') return false;
    for (const n of names) { const r = L.deleteUser(n); if (!r.ok) { await err(`The following error occurred while attempting to delete the user ${n}:\n\n${r.error}`); return false; } }
    return true;
  }

  /* ================================================================ groups */
  const memberIcon = n => (/^NT AUTHORITY\\/i.test(n) ? ICON.group : L.user(n) && !L.user(n).enabled ? ICON.userOff : ICON.user);
  function newGroup(opts = {}) {
    if (!L.available()) return err(DC_TEXT).then(() => 0);
    const name = field('name', F.text({ maxLength: 256 })), desc = field('description', F.text());
    let mem = memberList([], { key: 'members', types: ['user'], pickTitle: 'Select Users', icon: memberIcon, label: n => n, onChange: () => {}, onPicker: opts.onPicker });
    const holder = h('div', mem.el);
    const content = h('div', F.row('Group name:', name, lw), F.row('Description:', desc, lw), h('div', 'Members:'), holder);
    return createDialog({ title: 'New Group', width: 420, content, onCreate: f => { f.members = () => mem; if (opts.onCreate) opts.onCreate(f); },
      create: () => {
        const r = L.createGroup(name.value, desc.value);
        if (!r.ok) return r;
        for (const m of mem.items()) { const a = L.addMember(r.group.name, m); if (!a.ok) return a; }
        return true;
      },
      reset: () => { name.value = ''; desc.value = ''; U.clear(holder); mem = memberList([], { key: 'members', types: ['user'], pickTitle: 'Select Users', icon: memberIcon, label: n => n, onChange: () => {}, onPicker: opts.onPicker }); holder.appendChild(mem.el); name.focus(); } });
  }
  function groupProperties(name, opts = {}) {
    const gr = L.group(name);
    if (!gr) return Promise.resolve(false);
    let desc = null, mem = null;
    return WS.ui.propertySheet({ title: `${gr.name} Properties`, width: 410, errorTitle: TITLE, onCreate: sh => { if (opts.onCreate) opts.onCreate(sh, () => mem); },
      tabs: [{ label: 'General', render: sh => {
        desc = field('description', F.text({ value: gr.description, readOnly: false }));
        mem = memberList(gr.members, { key: 'members', types: ['user'], pickTitle: 'Select Users', icon: memberIcon, label: n => n, onChange: () => sh.setDirty(), onPicker: opts.onPicker });
        return h('div', h('div.lu-head', h('span.lu-hic', { html: ICON.group }), h('span', gr.name)), F.sep(), F.row('Description:', desc, lw), h('div', 'Members:'), mem.el, h('p.lu-note', MEMBERSHIP_NOTE));
      },
      apply: () => {
        if (desc.value !== gr.description) { const r = L.setGroup(gr.name, { description: desc.value }); if (!r.ok) return r; }
        return applyMembership(L.group(gr.name).members, mem.items(), m => L.addMember(gr.name, m), m => L.removeMember(gr.name, m));
      } }] });
  }
  async function deleteGroups(names) {
    names = [].concat(names);
    if (!names.length) return false;
    const what = names.length === 1 ? `the group ${names[0]}` : 'the selected groups';
    const a = await WS.ui.msgbox({ title: TITLE, icon: 'warning', buttons: ['Yes', 'No'],
      message: `Each group has a unique identifier in addition to its group name. Deleting a group deletes this identifier and it cannot be restored, even if you create a group with an identical name. This can prevent group members from accessing resources they currently have permission to access.\n\nAre you sure you want to delete ${what}?` });
    if (a !== 'Yes') return false;
    for (const n of names) { const r = L.deleteGroup(n); if (!r.ok) { await err(r); return false; } }
    return true;
  }
  async function rename(kind, name) {
    const v = await WS.ui.inputBox({ title: 'Rename', prompt: `Type a new name for ${name}:`, value: name });
    if (v == null || v === name) return false;
    const r = kind === 'user' ? L.renameUser(name, v) : L.renameGroup(name, v);
    if (!r.ok) { await err(r); return false; }
    return true;
  }

  /* ================================================================ snap-in */
  function dcPage() {
    return { render: host => { host.appendChild(h('div.lu-dc.w32', DC_TEXT)); return {}; } };
  }
  function snapin(opts = {}) {
    const usersView = {
      columns: [{ key: 'name', label: 'Name', width: 160 }, { key: 'fullName', label: 'Full Name', width: 160 }, { key: 'description', label: 'Description', width: 380 }],
      rows: () => (L.available() ? L.users() : []), getId: u => u.name, icon: u => (u.enabled ? ICON.user : ICON.userOff), sortKey: 'name', multi: true,
      menu: (rows, mmc) => {
        if (!rows.length) return usersMenu();
        const one = rows.length === 1;
        return [{ label: 'Set &Password...', disabled: !one, action: () => setPassword(rows[0].name) },
          SEP, { label: 'All Tas&ks', items: () => [{ label: 'Set &Password...', disabled: !one, action: () => setPassword(rows[0].name) }] },
          SEP, { label: '&Delete', action: () => deleteUsers(rows.map(r => r.name)) }, { label: 'Rena&me', disabled: !one, action: () => rename('user', rows[0].name) },
          SEP, { label: 'Re&fresh', action: () => mmc.refresh() }];
      },
      properties: u => userProperties(u.name), delete: rows => deleteUsers(rows.map(r => r.name)), rename: u => rename('user', u.name), itemLabel: u => u.name
    };
    const groupsView = {
      columns: [{ key: 'name', label: 'Name', width: 240 }, { key: 'description', label: 'Description', width: 520 }],
      rows: () => (L.available() ? L.groups() : []), getId: g => g.name, icon: () => ICON.group, sortKey: 'name', multi: true,
      menu: (rows, mmc) => {
        if (!rows.length) return groupsMenu();
        const one = rows.length === 1;
        return [{ label: 'Add to &Group...', disabled: !one, action: () => groupProperties(rows[0].name) },
          SEP, { label: 'All Tas&ks', items: () => [{ label: 'Add to &Group...', disabled: !one, action: () => groupProperties(rows[0].name) }] },
          SEP, { label: '&Delete', action: () => deleteGroups(rows.map(r => r.name)) }, { label: 'Rena&me', disabled: !one, action: () => rename('group', rows[0].name) },
          SEP, { label: 'Re&fresh', action: () => mmc.refresh() }];
      },
      properties: g => groupProperties(g.name), delete: rows => deleteGroups(rows.map(r => r.name)), rename: g => rename('group', g.name), itemLabel: g => g.name
    };
    const usersMenu = () => [{ label: 'New &User...', action: () => newUser() }];
    const groupsMenu = () => [{ label: 'New &Group...', action: () => newGroup() }];
    const kids = () => (L.available() ? [
      { id: 'lu-users', label: 'Users', icon: ICON.folder, view: usersView, menu: usersMenu },
      { id: 'lu-groups', label: 'Groups', icon: ICON.folder, view: groupsView, menu: groupsMenu }] : []);
    const node = { id: 'lu-root', label: opts.label || TITLE, icon: ICON.root, expanded: !!opts.expanded, children: kids,
      view: () => (L.available() ? { columns: [{ key: 'label', label: 'Name', width: 200 }], rows: kids, getId: n => n.id, icon: n => n.icon, sortKey: null, multi: false, onActivate: (n, mmc) => mmc.selectPath([mmc.current().id, n.id]) } : dcPage()) };
    return { node };
  }
  function launch() {
    const snap = snapin({ label: 'Local Users and Groups (Local)', expanded: true });
    const mmc = WS.mmc.create({ app: 'lusrmgr', title: 'lusrmgr - [Local Users and Groups (Local)]', icon: ICON.root, width: 900, height: 560, topics: ['local', 'system'], nodes: [snap.node] });
    return mmc.win;
  }

  WS.lusrmgr = { launch, snapin, newUser, newGroup, setPassword, userProperties, groupProperties, deleteUsers, deleteGroups, rename, DC_TEXT, ICON };
  WS.apps.register({ id: 'lusrmgr', name: TITLE, icon: ICON.root, launch, keywords: ['lusrmgr.msc', 'local users', 'local groups'] });
})();
