/* Group Policy Preferences in the Group Policy Management Editor: the Drive Maps list (User Configuration > Preferences >
 * Windows Settings > Drive Maps), the New Drive Properties / "<S:> Properties" sheet (General and Common tabs) and the
 * Targeting Editor. Writes through WS.gpp.
 *   WS.gpmePrefs.view(node, target, ctl) / menu(node, target) - used by gpme.js for the preference nodes it handles
 *   WS.gpmePrefs.driveDialog(gpo, uid | null, { onCreate(sheet, ui) }) -> Promise (true if anything was saved)
 *   WS.gpmePrefs.targetingEditor(filters, { onCreate(api) }) -> Promise<filters | null> */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, P = WS.gpp;
  const field = (name, control) => { const el = control.input || control; el.dataset.field = name; el.setAttribute('aria-label', name); return control; };
  const HANDLED = new Set(['u.pref.drivemaps']);
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  /* ---------------------------------------------------------------- icons: a network drive with the action's badge */
  const BADGE = {
    C: '<circle cx="12" cy="12" r="3.6" fill="#2e9e3e"/><path d="M12 10v4M10 12h4" stroke="#fff" stroke-width="1.4"/>',
    R: '<circle cx="12" cy="12" r="3.6" fill="#d9534f"/><path d="M10.3 12a1.8 1.8 0 1 0 .6-1.4" fill="none" stroke="#fff" stroke-width="1.1"/><path d="M10 9.6v1.6h1.6" fill="none" stroke="#fff" stroke-width="1"/>',
    U: '<path d="M12 8.2l3.9 6.6H8.1z" fill="#f2b632" stroke="#b07d00" stroke-width=".6"/><path d="M12 10.6v2.2" stroke="#5a3d00" stroke-width="1"/>',
    D: '<circle cx="12" cy="12" r="3.6" fill="#c42b1c"/><path d="M10.5 10.5l3 3M13.5 10.5l-3 3" stroke="#fff" stroke-width="1.3"/>'
  };
  const driveIcon = (action, off) => `<svg viewBox="0 0 16 16"><rect x="1" y="3" width="11" height="6.5" rx="1" fill="#e8ecf1" stroke="#7a8696"/><rect x="2.5" y="5" width="5" height="1.4" fill="#7a8696"/><path d="M6.5 9.5v2.3M2.5 12.6h7" stroke="#4a8a2a" stroke-width="1.3"/>${off ? '<circle cx="12" cy="12" r="3.6" fill="#c42b1c"/><path d="M9.8 14.2l4.4-4.4" stroke="#fff" stroke-width="1.3"/>' : BADGE[action] || ''}</svg>`;

  /* ---------------------------------------------------------------- Drive Maps list */
  let clip = null;   // copied item (Copy / Paste in the list)
  function view(n, t, ctl) {
    if (t.kind !== 'gpo') return null;
    const g = t.obj;
    const rows = () => P.drives(g);
    const edit = r => driveDialog(g, r ? r.uid : null);
    const remove = async rs => {
      if (!rs.length) return;
      const ans = await WS.ui.msgbox({ title: 'Delete Item', icon: 'warning', message: rs.length > 1 ? `Are you sure you want to delete these ${rs.length} items?` : 'Are you sure you want to delete this item?', buttons: ['Yes', 'No'] });
      if (ans !== 'Yes') return;
      for (const r of rs) P.removeDrive(g, r.uid);
    };
    const paste = () => { if (clip) { const { uid, name, order, changed, ...props } = clip; P.newDrive(g, props); } };
    const move = (r, d) => r && P.moveDrive(g, r.uid, d);
    return {
      columns: [{ key: 'name', label: 'Name', width: 120 }, { key: 'order', label: 'Order', width: 60, type: 'num' }, { key: 'action', label: 'Action', width: 90, value: r => P.ACTIONS[r.action] },
        { key: 'path', label: 'Path', width: 260, value: r => (r.action === 'D' ? '' : r.path) }],
      rows, getId: r => r.uid, icon: r => driveIcon(r.action, r.disabled), multi: true, sortKey: 'order',
      rowClass: r => (r.disabled ? 'gpp-off' : ''),
      emptyText: 'There are no items to show in this view.',
      onActivate: r => edit(r), properties: r => edit(r),
      delete: rs => remove(rs),
      menu: rs => (rs.length ? [
        { label: '&Copy', action: () => { clip = JSON.parse(JSON.stringify(rs[0])); } },
        { label: '&Delete', action: () => remove(rs) },
        { separator: true },
        rs.length === 1 && { label: rs[0].disabled ? '&Enable Item' : 'D&isable Item', action: () => P.setDisabled(g, rs[0].uid, !rs[0].disabled) },
        rs.length === 1 && { label: 'Move &Up', disabled: rs[0].order <= 1, action: () => move(rs[0], -1) },
        rs.length === 1 && { label: 'Move Do&wn', disabled: rs[0].order >= rows().length, action: () => move(rs[0], 1) }
      ] : newMenu(g, paste)),
      toolbar: [
        { icon: '<svg viewBox="0 0 16 16"><path d="M8 3l4.5 5H10v5H6V8H3.5z" fill="#2f6fb8"/></svg>', title: 'Move the selected item up', enabled: rs => rs.length === 1 && rs[0].order > 1, action: rs => move(rs[0], -1) },
        { icon: '<svg viewBox="0 0 16 16"><path d="M8 13l4.5-5H10V3H6v5H3.5z" fill="#2f6fb8"/></svg>', title: 'Move the selected item down', enabled: rs => rs.length === 1 && rs[0].order < rows().length, action: rs => move(rs[0], 1) }
      ],
      extended: rs => {
        const r = rs[0];
        if (!r) return h('div.gpme-ext', h('h3', 'Drive Maps'), h('div', 'No policies selected'));
        const c = r.common;
        const yn = b => (b ? 'Yes' : 'No');
        return h('div.gpme-ext', h('h3', `${r.name}`),
          h('p', h('b', 'Processing'), h('br'), `Stop on error: ${yn(c.stopOnError)}`, h('br'), `Run in logged-on user's security context: ${yn(c.userContext)}`, h('br'), `Remove when no longer applied: ${yn(c.removePolicy)}`),
          c.targeting && r.filters.length ? h('p', h('b', 'Item-level targeting'), h('br'), P.filtersText(r.filters)) : null,
          h('p', h('b', 'Description'), h('br'), c.description || 'No description provided.'));
      },
      status: () => ''
    };
  }
  const newMenu = (g, paste) => [{ label: '&New', items: [{ label: '&Mapped Drive', action: () => driveDialog(g, null) }] }, { separator: true }, { label: '&Paste', disabled: !clip, action: paste }];
  const menu = (n, t) => (t.kind === 'gpo' ? newMenu(t.obj, () => { if (clip) { const { uid, name, order, changed, ...props } = clip; P.newDrive(t.obj, props); } }) : [{ label: '&New', disabled: true }]);

  /* ---------------------------------------------------------------- New Drive Properties */
  function sharePicker() {
    const shares = WS.smb.shares().filter(s => !s.special || /^(SYSVOL|NETLOGON)$/i.test(s.name));
    const items = shares.map(s => `\\\\${WS.sys.name}\\${s.name}`);
    let sel = null;
    const box = h('div.gpp-browse');
    const paint = () => { U.clear(box); box.appendChild(h('div.gpp-bsrv', { html: I.computer }, h('span', WS.sys.name))); items.forEach(p => box.appendChild(h('div.gpp-bitem' + (p === sel ? '.sel' : ''), { dataset: { path: p }, onClick: () => { sel = p; paint(); }, onDblclick: () => { sel = p; btnOk.click(); } }, h('span', { html: I.folder }), p.split('\\').pop()))); };
    let btnOk = null;
    const p = WS.ui.dialog({ title: 'Browse For Folder', width: 340, content: h('div.w32', h('div', { style: 'margin-bottom:6px' }, 'Select a shared folder:'), box), buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
    setTimeout(() => { const shade = [...document.querySelectorAll('#dialogs .dlg-shade')].pop(); btnOk = shade && [...shade.querySelectorAll('button')].find(b => b.textContent === 'OK'); }, 0);
    paint();
    return p.then(r => (r === 'OK' ? sel : null));
  }
  /** "New Drive Properties" (uid null) or "<S:> Properties". */
  function driveDialog(x, uid, o = {}) {
    const g = WS.gpo.get(x);
    const cur = uid ? P.drive(g, uid) : null;
    const work = JSON.parse(JSON.stringify(cur || P.defaults()));
    let savedUid = cur ? cur.uid : null;
    const ui = {};
    const general = () => {
      ui.action = field('action', F.select(Object.entries(P.ACTIONS).map(([value, label]) => ({ value, label })), work.action, { width: 120, disabled: work.common.removePolicy }));
      ui.icon = h('span.gpp-dicon', { html: driveIcon(work.action) });
      ui.path = field('location', F.text({ value: work.path, width: 300 }));
      ui.browse = F.button('...', async () => { const p = await sharePicker(); if (p) { ui.path.value = p; work.path = p; ui.path.dispatchEvent(new Event('input', { bubbles: true })); } });
      ui.reconnect = field('reconnect', F.checkbox('Reconnect', work.persistent));
      ui.label = field('label', F.text({ value: work.label, width: 180 }));
      ui.first = field('firstAvailable', F.radio('gpp-letter', 'Use first available, starting at:', !work.useLetter));
      ui.use = field('useLetter', F.radio('gpp-letter', 'Use:', work.useLetter));
      ui.letterFirst = field('firstLetter', F.select(LETTERS, work.useLetter ? 'D' : work.letter, { width: 60 }));
      ui.letter = field('letter', F.select(LETTERS, work.letter, { width: 60 }));
      ui.user = field('userName', F.text({ value: work.userName, width: 200, disabled: true }));
      ui.pw = F.text({ password: true, width: 200, disabled: true }); ui.pw2 = F.text({ password: true, width: 200, disabled: true });
      const hs = (name, which, labels) => labels.map(([v, l]) => field(`${name}-${v.toLowerCase()}`, F.radio('gpp-' + name, l, work[which] === v, { onChange: on => { if (on) work[which] = v; } })));
      ui.thisDrive = hs('thisDrive', 'thisDrive', [['NOCHANGE', 'No change'], ['HIDE', 'Hide this drive'], ['SHOW', 'Show this drive']]);
      ui.allDrives = hs('allDrives', 'allDrives', [['NOCHANGE', 'No change'], ['HIDE', 'Hide all drives'], ['SHOW', 'Show all drives']]);
      const sync = () => {
        work.action = ui.action.value; ui.icon.innerHTML = driveIcon(work.action);
        const del = work.action === 'D';
        // Delete: no location, and the letter choice becomes "Delete all, starting at" / "Delete"
        for (const el of [ui.path, ui.browse, ui.reconnect.input, ui.label]) el.disabled = del;
        ui.first.querySelector('span').textContent = del ? 'Delete all, starting at:' : 'Use first available, starting at:';
        ui.use.querySelector('span').textContent = del ? 'Delete:' : 'Use:';
        ui.letterFirst.disabled = ui.use.checked; ui.letter.disabled = !ui.use.checked;
        for (const r of [...ui.thisDrive, ...ui.allDrives]) r.input.disabled = del;
      };
      ui.action.addEventListener('change', sync);
      for (const r of [ui.first, ui.use]) r.input.addEventListener('change', sync);
      const page = h('div.gpp-gen',
        h('div.gpp-arow', ui.icon, h('label', 'Action:'), ui.action),
        h('div.frow', h('label.flabel', { style: { width: '70px' } }, 'Location:'), h('div.fctl.gpp-loc', ui.path, ui.browse)),
        h('div.gpp-rl', ui.reconnect, h('label', 'Label as:'), ui.label),
        F.group('Drive Letter', h('div.gpp-letters', h('div.gpme-inl', ui.first, ui.letterFirst), h('div.gpme-inl', ui.use, ui.letter))),
        F.group('Connect as (optional)', F.row('User name:', ui.user, { labelWidth: 110 }), h('div.gpp-pw', F.row('Password:', ui.pw, { labelWidth: 110 }), F.row('Confirm password:', ui.pw2, { labelWidth: 110 }))),
        h('div.gpp-hs', F.group('Hide/Show this drive', ...ui.thisDrive), F.group('Hide/Show all drives', ...ui.allDrives)));
      sync();
      return page;
    };
    const common = sheet => {
      const c = work.common;
      const chk = (key, label, name) => field(name, F.checkbox(label, c[key], { onChange: v => { c[key] = v; if (key === 'removePolicy' && ui.action) { if (v) { ui.action.value = 'R'; ui.action.dispatchEvent(new Event('change', { bubbles: true })); } ui.action.disabled = v; } if (key === 'targeting') ui.targetBtn.disabled = !v; } }));
      ui.stop = chk('stopOnError', 'Stop processing items in this extension if an error occurs.', 'stopOnError');
      ui.userContext = chk('userContext', "Run in logged-on user's security context (user policy option)", 'userContext');
      ui.remove = chk('removePolicy', 'Remove this item when it is no longer applied', 'removePolicy');
      ui.once = chk('applyOnce', 'Apply once and do not reapply', 'applyOnce');
      ui.targeting = chk('targeting', 'Item-level targeting', 'targeting');
      ui.targetBtn = F.button('Targeting...', async () => { const f = await targetingEditor(work.filters, { onCreate: o.onTargeting }); if (f) { work.filters = f; sheet.setDirty(); } }, { disabled: !c.targeting });
      ui.desc = field('description', F.textarea({ value: c.description, rows: 5, width: 400 }));
      ui.desc.addEventListener('input', () => { c.description = ui.desc.value; });
      return h('div.gpp-common', F.group('Options common to all items', ui.stop, ui.userContext, ui.remove, ui.once, h('div.gpme-inl', ui.targeting, ui.targetBtn)), h('div', 'Description'), ui.desc);
    };
    const collect = () => {
      if (ui.action) {
        work.action = ui.action.value; work.path = ui.path.value.trim(); work.persistent = ui.reconnect.checked; work.label = ui.label.value;
        work.useLetter = ui.use.checked; work.letter = work.useLetter ? ui.letter.value : ui.letterFirst.value;
      }
      return work;
    };
    const apply = () => {
      const w = collect();
      const r = savedUid ? P.setDrive(g, savedUid, w) : P.newDrive(g, w);
      if (!r.ok) return r.error;
      savedUid = r.item.uid;
      return null;
    };
    let sheetRef = null;
    const title = () => (cur ? `${cur.name} Properties` : 'New Drive Properties');
    return WS.ui.propertySheet({ title: title(), width: 470, errorTitle: title(), tabs: [{ label: 'General', render: general, apply }, { label: 'Common', render: common }],
      onCreate: s => { sheetRef = s; if (!cur) s.setDirty(); if (o.onCreate) o.onCreate(s, ui); } });
  }

  /* ---------------------------------------------------------------- Targeting Editor */
  const ALL_TYPES = ['Battery Present', 'Computer Name', 'CPU Speed', 'Date Match', 'Disk Space', 'Domain', 'Environment Variable', 'File Match', 'IP Address Range', 'Language', 'LDAP Query', 'MAC Address Range', 'MSI Query', 'Network Connection',
    'Operating System', 'Organizational Unit', 'PCMCIA Present', 'Portable Computer', 'Processing Mode', 'RAM', 'Registry Match', 'Security Group', 'Site', 'Terminal Session', 'Time Range', 'User', 'WMI Query'];
  const TYPE_OF = { 'Security Group': 'group', User: 'user', 'Computer Name': 'computer', 'Organizational Unit': 'ou' };
  function ouPicker() {
    const ous = WS.state.ad ? WS.state.ad.objects.filter(o => o.type === 'organizationalUnit').map(o => WS.ad.dn(o)).sort() : [];
    const sel = field('ou', F.select(ous, ous[0] || '', { width: 360 }));
    return WS.ui.dialog({ title: 'Select Organizational Unit', width: 400, content: h('div.w32', h('div', { style: 'margin-bottom:6px' }, 'Organizational unit:'), sel), buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] })
      .then(r => (r === 'OK' ? sel.value : null));
  }
  function targetingEditor(filters, o = {}) {
    const list = JSON.parse(JSON.stringify(filters || []));
    let sel = list.length ? 0 : -1;
    const frame = WS.ui.modal({ title: 'Targeting Editor', width: 640, className: 'w32-dlg gpp-te', closeValue: null });
    const box = h('div.gpp-te-list'), props = h('div.gpp-te-props');
    const paint = () => {
      U.clear(box);
      if (!list.length) box.appendChild(h('div.gpp-te-empty', 'Use the New Item menu to add targeting items.'));
      list.forEach((f, i) => box.appendChild(h('div.gpp-te-item' + (i === sel ? '.sel' : ''), { dataset: { index: i }, onClick: () => { sel = i; paint(); } }, (i ? f.bool + ' ' : '') + P.filterText(f))));
      paintProps();
      for (const [b, en] of [[bOpts, sel >= 0], [bDel, sel >= 0], [bUp, sel > 0], [bDown, sel >= 0 && sel < list.length - 1]]) b.disabled = !en;
    };
    function paintProps() {
      U.clear(props);
      const f = list[sel];
      if (!f) return;
      const upd = () => { const t = box.children[sel]; if (t) t.textContent = (sel ? f.bool + ' ' : '') + P.filterText(f); };
      const nameBox = field('targetName', F.text({ value: f.name, width: 280, onInput: v => { f.name = v; f.sid = ''; upd(); } }));
      const pick = async () => {
        let v = null;
        if (f.type === 'ou') v = await ouPicker();
        else { const r = await WS.ui.objectPicker({ types: f.type === 'group' ? ['group'] : f.type === 'user' ? ['user'] : ['computer'] }); v = r && r[0] ? (f.type === 'computer' ? r[0].name : r[0].principal || r[0].name) : null; }
        if (v) { const n = P.normFilter({ ...f, name: v }); Object.assign(f, n); nameBox.value = f.name; upd(); paintProps(); }
      };
      const row = (label, ctl) => F.row(label, h('div.gpme-inl', ctl, F.button('...', pick)), { labelWidth: 120 });
      const ctxRadios = noun => [field('userContext', F.radio('gpp-te-ctx', `User in ${noun}`, f.userContext !== false, { onChange: on => { if (on) { f.userContext = true; upd(); } } })),
        field('computerContext', F.radio('gpp-te-ctx', `Computer in ${noun}`, f.userContext === false, { onChange: on => { if (on) { f.userContext = false; upd(); } } }))];
      if (f.type === 'group') props.append(row('Group:', nameBox), F.row('SID:', F.text({ value: f.sid || '', width: 280, readOnly: true }), { labelWidth: 120 }), h('div.gpme-inl', ...ctxRadios('group')), F.checkbox('Primary group', false, { disabled: true }));
      else if (f.type === 'user') props.append(row('User:', nameBox), F.row('SID:', F.text({ value: f.sid || '', width: 280, readOnly: true }), { labelWidth: 120 }));
      else if (f.type === 'computer') props.append(row('Computer name:', nameBox), h('div.gpme-inl', F.radio('gpp-te-cn', 'NetBIOS name', true), F.radio('gpp-te-cn', 'DNS name', false, { disabled: true })));
      else if (f.type === 'ou') props.append(row('Organizational unit:', nameBox), field('directMember', F.checkbox('Direct member only', f.directMember, { onChange: v => { f.directMember = v; upd(); } })), h('div.gpme-inl', ...ctxRadios('OU')));
    }
    const add = label => { const type = TYPE_OF[label]; list.push(P.normFilter({ type, bool: 'AND', name: type === 'computer' ? WS.sys.name : '' })); sel = list.length - 1; paint(); };
    const tbtn = (label, fn) => h('button.btn.btn-sm', { onClick: e => fn(e) }, label);
    const bNew = tbtn('New Item ▾', e => WS.ui.popupMenu(e.currentTarget, ALL_TYPES.map(l => ({ label: l, disabled: !TYPE_OF[l], action: () => add(l) }))));
    const bColl = h('button.btn.btn-sm', { disabled: true }, 'Add Collection');
    const bOpts = tbtn('Item Options ▾', e => { const f = list[sel]; if (!f) return; WS.ui.popupMenu(e.currentTarget, [{ label: 'And', radio: true, checked: f.bool === 'AND', action: () => { f.bool = 'AND'; paint(); } }, { label: 'Or', radio: true, checked: f.bool === 'OR', action: () => { f.bool = 'OR'; paint(); } }, { separator: true },
      { label: 'Is', radio: true, checked: !f.not, action: () => { f.not = false; paint(); } }, { label: 'Is Not', radio: true, checked: f.not, action: () => { f.not = true; paint(); } }]); });
    const bDel = tbtn('Delete', () => { if (sel < 0) return; list.splice(sel, 1); sel = Math.min(sel, list.length - 1); paint(); });
    const bUp = tbtn('↑', () => { if (sel > 0) { [list[sel - 1], list[sel]] = [list[sel], list[sel - 1]]; sel--; paint(); } });
    const bDown = tbtn('↓', () => { if (sel >= 0 && sel < list.length - 1) { [list[sel + 1], list[sel]] = [list[sel], list[sel + 1]]; sel++; paint(); } });
    frame.body.appendChild(h('div.w32.gpp-te-body', h('div.gpp-te-bar', bNew, bColl, bOpts, bDel, bUp, bDown), box, props));
    const ok = h('button.btn.primary', { onClick: async () => {
      for (const f of list) { const e = P.checkFilter(f); if (e) { await WS.ui.msgbox({ title: 'Targeting Editor', icon: 'error', message: e }); return; } }
      frame.close(list.map(P.normFilter));
    } }, 'OK');
    frame.footer.append(ok, h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEscape = () => frame.close(null);
    paint();
    if (o.onCreate) o.onCreate({ frame, add, list, select: i => { sel = i; paint(); }, ok: () => ok.click(), option: (bool, not) => { const f = list[sel]; if (bool) f.bool = bool; if (not != null) f.not = not; paint(); }, setName: v => { const f = list[sel]; Object.assign(f, P.normFilter({ ...f, name: v })); paint(); }, setContext: user => { list[sel].userContext = user; paint(); } });
    return frame.promise;
  }

  WS.gpmePrefs = { handles: id => HANDLED.has(id), view, menu, driveDialog, targetingEditor, driveIcon };
})();
