/* Group Policy Management (gpmc.msc). GPOs, links, inheritance, security filtering, delegation, WMI filters,
 * Starter GPOs, backups, Group Policy Results and Group Policy Modeling. Everything goes through WS.gpo, so the
 * GroupPolicy PowerShell module, gpupdate and gpresult see the same GPOs.
 * WS.gpmc exposes the dialogs (each takes { onCreate } for tests); launch returns a window with
 * win.gpmc = { mmc, open(nodeId), tab(label), current() }. Node ids: gpmc-root, gpmc-forest, gpmc-domains,
 * gpmc-som:<AD id>, gpmc-link:<som id>:<GPO id>, gpmc-gpos, gpmc-gpo:<GPO id>, gpmc-wmis, gpmc-wmi:<id>,
 * gpmc-starters, gpmc-starter:<id>, gpmc-sites, gpmc-modeling, gpmc-results, gpmc-result:<n>. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, G = WS.gpo;
  const TITLE = 'Group Policy Management';
  const A = () => WS.state.ad;
  const dom = () => A().domain;
  const when = d => (d ? `${U.fmtDate(new Date(d))} ${U.fmtTime(new Date(d), true)}` : '');
  const field = (name, control) => { const el = control.input || control; el.dataset.field = name; el.setAttribute('aria-label', name); return control; };
  const error = r => WS.ui.msgbox({ title: TITLE, icon: 'error', message: r.error, detail: r.detail });
  const ask = (message, o = {}) => WS.ui.msgbox({ title: o.title || TITLE, icon: o.icon || 'question', message, detail: o.detail, buttons: o.buttons || ['OK', 'Cancel'] });

  /* ---------------------------------------------------------------- icons */
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const scroll = '<path d="M4 2.5h8.5v11H5.5A1.5 1.5 0 0 1 4 12z" fill="#fff" stroke="#6b7c8f"/><path d="M6 5h5M6 7h5M6 9h3.5" stroke="#8a97a6"/><path d="M2.5 12a1.5 1.5 0 0 0 3 0V4a1.5 1.5 0 0 0-3 0z" fill="#e3e9f1" stroke="#6b7c8f"/>';
  const shortcut = '<rect x=".5" y="8.5" width="7" height="7" fill="#fff" stroke="#555" stroke-width=".8"/><path d="M2.3 13.8l3.2-3.2M3.4 10.4h2.3v2.3" fill="none" stroke="#1d5fbf" stroke-width="1.1"/>';
  const lock = '<rect x="10.2" y="11" width="5.3" height="4.5" rx=".6" fill="#c99a00"/><path d="M11.3 11V9.8a1.6 1.6 0 0 1 3.2 0V11" fill="none" stroke="#8a6a00" stroke-width="1"/>';
  const bang = '<circle cx="12.5" cy="12.5" r="3.3" fill="#1d5fbf" stroke="#fff" stroke-width=".7"/><path d="M12.5 10.6v2.3" stroke="#fff" stroke-width="1.3"/><circle cx="12.5" cy="14.3" r=".7" fill="#fff"/>';
  const ICON = {
    gpmc: s16(scroll + '<path d="M9.5 11.5l4-4 1.5 1.5-4 4h-1.5z" fill="#2f7fd8"/>'),
    forest: s16('<path d="M5 1.5l3.6 5H6.9l2.6 4H6v3.5H4V10.5H.6l2.6-4H1.5z" fill="#2e8b3e"/><path d="M11.5 4l3.2 4.4h-1.5l2.3 3.3H12.5V14.5H11v-2.8H8l2.3-3.3H8.7z" fill="#46a752"/>'),
    gpo: s16(scroll), link: l => s16(`<g opacity="${l.enabled === false ? '.45' : '1'}">${scroll}</g>${shortcut}${l.enforced ? lock : ''}`),
    folder: I.folder, domain: som => (som.blockInheritance ? s16(inner(I.domain) + bang) : I.domain), ou: som => (som.blockInheritance ? s16(inner(I.ou) + bang) : I.ou),
    wmi: s16('<path d="M2 2.5h12l-4.6 5.2V13l-2.8 1.5V7.7z" fill="#e8b024" stroke="#9b7410" stroke-width=".8"/>'),
    starter: s16(scroll + '<path d="M12 8.5l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#f2b631" stroke="#9b7410" stroke-width=".5"/>'),
    sites: s16('<circle cx="8" cy="8" r="6.3" fill="#4ea5ef" stroke="#1f6fc4"/><path d="M1.7 8h12.6M8 1.7c-2.5 3.2-2.5 9.4 0 12.6M8 1.7c2.5 3.2 2.5 9.4 0 12.6" fill="none" stroke="#e6f2fd" stroke-width=".8"/>'),
    modeling: s16(scroll + '<circle cx="12" cy="11.5" r="2.6" fill="#5b6b7d"/><circle cx="12" cy="11.5" r="1" fill="#fff"/>'),
    results: s16(scroll + '<path d="M9.5 14.5v-3M11.5 14.5v-5M13.5 14.5v-4" stroke="#0f7b0f" stroke-width="1.4"/>')
  };
  const linkIcon = l => ICON.link(l);
  const somIcon = som => (som.type === 'domainDNS' ? ICON.domain(som) : ICON.ou(som));

  /* ---------------------------------------------------------------- shared state for every open console */
  const clipboard = { gpo: null };
  const results = [];            // Group Policy Results and Modeling reports live as long as the page (GPMC keeps them in the console)
  let resultSeq = 0;
  const prefs = () => (WS.state.gp.prefs = WS.state.gp.prefs || {});
  let reportCssDone = false;
  function reportCss() { if (reportCssDone) return; reportCssDone = true; document.head.appendChild(h('style', { html: G.reportCss })); }
  /** A report body (from gpo-report.js) with working show/hide toggles. */
  function reportView(html) {
    reportCss();
    const el = h('div.gpmc-report', { html });
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-gprep-toggle]');
      if (t) { const s = t.parentNode; s.classList.toggle('closed'); t.querySelector('.gp-tog').textContent = s.classList.contains('closed') ? 'show' : 'hide'; return; }
      const all = e.target.closest('[data-gprep-all]');
      if (all) { const close = all.textContent === 'hide all'; el.querySelectorAll('.gp-sec').forEach(x => { x.classList.toggle('closed', close); x.querySelector('.gp-tog').textContent = close ? 'show' : 'hide'; }); all.textContent = close ? 'show all' : 'hide all'; }
    });
    return el;
  }

  /* ---------------------------------------------------------------- dialogs */
  function formDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 420, className: 'w32-dlg gpmc-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32', o.content));
    let busy = false;
    const submit = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await o.submit();
        if (r && r.ok === false) await error(r);
        else if (r !== false) frame.close(r || true);
      } finally { busy = false; }
    };
    frame.footer.append(h('button.btn.primary', { onClick: submit }, o.okLabel || 'OK'), h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = e => { if (!(e && e.target && e.target.tagName === 'TEXTAREA')) submit(); };
    frame.onEscape = () => frame.close(null);
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /** New GPO (optionally linked to a domain/OU, as "Create a GPO in this domain, and Link it here..." does). */
  function newGpo(o = {}) {
    const name = field('name', F.text({ value: 'New Group Policy Object', width: 300 }));
    const starters = [{ value: '', label: '(none)' }, ...G.starters().map(s => ({ value: s.id, label: s.name }))];
    const starter = field('starter', F.select(starters, o.starter || '', { width: 300 }));
    setTimeout(() => name.select(), 40);
    return formDialog({ title: 'New GPO', width: 400, onCreate: o.onCreate,
      content: h('div', F.stack('Name:', name), F.stack('Source Starter GPO:', starter)),
      submit: () => {
        const r = G.create(name.value, { starter: starter.value || null });
        if (!r.ok) return r;
        if (o.link) { const l = G.link(r.gpo, o.link); if (!l.ok) return l; }
        return r;
      } });
  }
  /** Link an Existing GPO: the Select GPO dialog. */
  function linkExisting(som, o = {}) {
    let chosen = null;
    const list = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 330 }], rows: () => G.list().slice().sort((a, b) => a.name.localeCompare(b.name)), getId: g => g.id, icon: () => ICON.gpo, multi: false,
      onSelect: rows => { chosen = rows[0] || null; }, onActivate: () => submit && submit() });
    list.el.classList.add('gpmc-pick');
    let submit = null;
    return formDialog({ title: 'Select GPO', width: 420, onCreate: f => { submit = () => f.onEnter(); if (o.onCreate) o.onCreate({ frame: f, list, select: name => { const g = G.get(name); list.select([g.id]); chosen = g; } }); },
      content: h('div', F.row('Look in this domain:', F.select([dom()], dom(), { width: 220 }), { labelWidth: 130 }), F.note('Group Policy objects:'), list.el),
      submit: () => (chosen ? G.link(chosen, som) : { ok: false, error: 'Select a GPO to link.' }) });
  }
  async function deleteLink(som, g) {
    if (await ask('Do you want to delete this link? This will not delete the GPO itself.') !== 'OK') return null;
    const r = G.unlink(g, som); if (!r.ok) await error(r);
    return r;
  }
  async function deleteGpo(g) {
    if (await ask('Do you want to delete this GPO and all links to it in this domain? This will not delete links in other domains.') !== 'OK') return null;
    const r = G.remove(g); if (!r.ok) await error(r);
    return r;
  }
  async function renameGpo(g) {
    let value = g.name;
    for (;;) {
      const next = await WS.ui.inputBox({ title: 'Rename', prompt: 'Name:', value });
      if (next === null) return null;
      const r = G.rename(g, next);
      if (r.ok) return r;
      await error(r); value = next;
    }
  }
  async function newOU(parent) {
    const name = field('name', F.text({ width: 300 }));
    return formDialog({ title: 'New Organizational Unit', width: 380, content: h('div', F.stack('Name:', name)), submit: () => WS.ad.createOU({ name: name.value, parent }) });
  }
  async function deleteOU(som) {
    if (await ask(`Do you want to delete the organizational unit "${som.name}" and all the objects in it?`, { icon: 'warning' }) !== 'OK') return null;
    const r = WS.ad.remove(som.id, { recursive: true });
    if (!r.ok) await error(r);
    return r;
  }
  async function saveReport(kind, x, o = {}) {
    const g = kind === 'gpo' ? G.get(x) : null;
    const name = g ? g.name : o.name || 'Group Policy Results';
    const path = o.path || await WS.ui.filePicker({ mode: 'save', title: 'Save GPO Report', defaultName: name.replace(/[\\/:*?"<>|]/g, '') + '.htm',
      filters: [{ label: 'HTML File (*.htm;*.html)', ext: ['.htm', '.html'] }, { label: 'XML File (*.xml)', ext: ['.xml'] }] });
    if (!path) return null;
    const xml = /\.xml$/i.test(path);
    const text = kind === 'gpo' ? (xml ? G.reportXml(g) : G.reportHtml(g)) : (xml ? G.rsopXml(o.rs) : G.rsopHtml(o.rs, { title: name }));
    try { WS.fs.writeFile(path, text); } catch (e) { await WS.ui.msgbox({ title: 'Save GPO Report', icon: 'error', message: e.message }); return null; }
    return path;
  }
  /** The once-per-selection warning shown when a link is selected in the tree. */
  let lastNotice = 0;
  function linkNotice(o = {}) {
    if (prefs().noLinkNotice || Date.now() - lastNotice < 800) return null;
    lastNotice = Date.now();
    const box = field('dontshow', F.checkbox('Do not show this message again', false));
    const frame = WS.ui.modal({ title: TITLE, width: 440, className: 'w32-dlg' });
    frame.body.appendChild(h('div.w32.gpmc-notice', h('div.gpmc-nicon', { html: WS.ui.icons.info }),
      h('div', h('p', 'You have selected a link to a Group Policy Object (GPO). Except for changes to link properties, changes you make here are global to the GPO, and will impact all other locations where this GPO is linked.'), box)));
    const ok = h('button.btn.primary', { onClick: () => { if (box.checked) { prefs().noLinkNotice = true; WS.store.changed('gp'); } frame.close(true); } }, 'OK');
    frame.footer.appendChild(ok);
    frame.onEnter = () => ok.click(); frame.onEscape = () => ok.click();
    if (o.onCreate) o.onCreate(frame);
    setTimeout(() => ok.focus(), 30);
    return frame.promise;
  }

  /* ---- security filtering and delegation ---- */
  async function addFiltering(g, o = {}) {
    const picked = o.picked || await WS.ui.objectPicker({ types: ['user', 'group', 'computer', 'principal'], multi: true, title: 'Select User, Computer, or Group' });
    if (!picked || !picked.length) return null;
    for (const p of picked) { const r = G.setPermission(g, p.principal || p.name, 'GpoApply'); if (!r.ok) { await error(r); return r; } }
    return { ok: true };
  }
  async function removeDelegation(g, sid) {
    if (await ask('Do you want to remove this delegation privilege?') !== 'OK') return null;
    const r = G.setPermission(g, sid, 'None', { replace: true });
    if (!r.ok) await error(r);
    return r;
  }
  async function addDelegation(g, o = {}) {
    const picked = o.picked || await WS.ui.objectPicker({ types: ['user', 'group', 'computer', 'principal'], multi: false, title: 'Select User, Computer, or Group' });
    if (!picked || !picked.length) return null;
    const p = picked[0];
    const level = field('level', F.select([{ value: 'GpoRead', label: 'Read' }, { value: 'GpoEdit', label: 'Edit settings' }, { value: 'GpoEditDeleteModifySecurity', label: 'Edit settings, delete, modify security' }], 'GpoRead', { width: 260 }));
    return formDialog({ title: 'Add Group or User', width: 400, onCreate: o.onCreate,
      content: h('div', F.row('Group or user name:', F.value(p.principal || p.name), { labelWidth: 130 }), F.row('Permissions:', level, { labelWidth: 130 })),
      submit: () => G.setPermission(g, p.principal || p.name, level.value, { replace: true }) });
  }

  /* ---- WMI filters ---- */
  function wmiQueryDialog(q = {}, o = {}) {
    const ns = field('namespace', F.text({ value: q.namespace || 'root\\CIMv2', width: 300 }));
    const query = field('query', F.textarea({ value: q.query || '', rows: 5, width: 360 }));
    return formDialog({ title: 'WMI Query', width: 420, onCreate: o.onCreate,
      content: h('div', F.stack('Namespace:', ns), F.stack('Query:', query)),
      submit: () => (query.value.trim() ? { ok: true, query: { namespace: ns.value.trim() || 'root\\CIMv2', query: query.value.trim() } } : { ok: false, error: 'You must enter a query.' }) });
  }
  function wmiFilterDialog(existing, o = {}) {
    const f = existing ? G.wmiFilter(existing) : null;
    const name = field('name', F.text({ value: f ? f.name : '', width: 340 }));
    const desc = field('description', F.textarea({ value: f ? f.description : '', rows: 2, width: 340 }));
    const queries = f ? f.queries.map(q => ({ ...q })) : [];
    const list = WS.ui.listView({ columns: [{ key: 'namespace', label: 'Namespace', width: 100 }, { key: 'query', label: 'Query', width: 260 }], rows: () => queries, getId: q => queries.indexOf(q) + ':' + q.query, multi: false });
    list.el.classList.add('gpmc-queries');
    const add = async () => { const r = await wmiQueryDialog({}, { onCreate: o.onQuery }); if (r && r.query) { queries.push(r.query); list.refresh(); } };
    const edit = async () => { const q = list.selected()[0]; if (!q) return; const r = await wmiQueryDialog(q, { onCreate: o.onQuery }); if (r && r.query) { Object.assign(q, r.query); list.refresh(); } };
    const remove = () => { const q = list.selected()[0]; if (q) { queries.splice(queries.indexOf(q), 1); list.refresh(); } };
    return formDialog({ title: f ? f.name : 'New WMI Filter', width: 460, okLabel: 'Save',
      onCreate: frame => { if (o.onCreate) o.onCreate({ frame, add, edit, remove, queries, list }); },
      content: h('div', F.stack('Name:', name), F.stack('Description:', desc), F.note('Queries:'), h('div.gpmc-qrow', list.el, h('div.gpmc-qbtns', F.button('Add...', add), F.button('Remove', remove), F.button('Edit...', edit)))),
      submit: () => (f ? G.setWmiFilterProps(f, { name: name.value, description: desc.value, queries }) : G.createWmiFilter({ name: name.value, description: desc.value, queries })) });
  }

  /* ---- backups ---- */
  async function backupDialog(which, o = {}) {
    const loc = field('location', F.text({ value: o.path || prefs().backupPath || 'C:\\', width: 270 }));
    const desc = field('description', F.text({ width: 340 }));
    const browse = F.button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', title: 'Browse For Folder', path: loc.value }); if (p) loc.value = p; });
    const r = await formDialog({ title: which === 'all' ? 'Back Up Group Policy Object' : 'Back Up Group Policy Object', width: 440, okLabel: 'Back Up', onCreate: o.onCreate,
      content: h('div', F.note(which === 'all' ? 'Enter the name of the folder in which you want to store backups of all GPOs in this domain.' : 'Enter the name of the folder in which you want to store backup versions of this GPO.'),
        F.stack('Location:', h('div.gpmc-inline', loc, browse)), F.stack('Description:', desc)),
      submit: () => { const b = G.backup(which === 'all' ? 'all' : which, loc.value, desc.value); if (b.ok) { prefs().backupPath = loc.value; WS.store.changed('gp'); } return b; } });
    if (!r || r === true) return null;
    await WS.ui.dialog({ title: 'Backup', width: 420, content: h('div.w32', h('div', 'Backup progress:'), h('div.pbar', h('div.pbar-fill', { style: 'width:100%' })),
      h('div.gpmc-status', ...r.backups.map(b => h('div', `${b.gpo.name}: Succeeded`))), h('div', `${r.backups.length} GPO${r.backups.length === 1 ? ' was' : 's were'} successfully backed up.`)), buttons: [{ label: 'OK', primary: true }] });
    return r;
  }
  function backupList(path, o = {}) {
    const latest = { on: o.latestOnly !== false };
    const rows = () => {
      let list = G.backups(path()).filter(b => !o.gpoId || b.gpoId === o.gpoId);
      if (latest.on) { const seen = new Set(); list = list.filter(b => (seen.has(b.gpoId) ? false : seen.add(b.gpoId))); }
      return list;
    };
    const lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 170 }, { key: 'time', label: 'Time Stamp', width: 140, value: b => when(b.time) }, { key: 'comment', label: 'Description', width: 130 }, { key: 'gpoId', label: 'GPO ID', width: 260 }],
      rows, getId: b => b.backupId, icon: () => ICON.gpo, multi: false });
    lv.el.classList.add('gpmc-backups');
    const box = F.checkbox('Show only the latest version of each GPO', latest.on, { onChange: v => { latest.on = v; lv.refresh(); } });
    return { lv, box };
  }
  function viewBackupSettings(b) {
    if (!b || !b.data) return;
    reportCss();
    const fake = { ...b.data, registry: b.data.registry || { computer: [], user: [] } };
    // a deleted GPO's backup can still be shown: report through a temporary stand-in
    const g = G.get(b.gpoId);
    const body = g ? G.reportBody(g) : `<div class="gprep"><div class="gp-title">${U.esc(fake.name)}</div><div class="gp-none">The GPO no longer exists in the domain; restore it to see its full report.</div></div>`;
    WS.ui.dialog({ title: `${b.name} - backup settings`, width: 680, content: h('div.gpmc-reportbox', reportView(body)), buttons: [{ label: 'Close', primary: true }] });
  }
  function manageBackups(o = {}) {
    const loc = field('location', F.text({ value: o.path || prefs().backupPath || 'C:\\', width: 330 }));
    const { lv, box } = backupList(() => loc.value, {});
    loc.addEventListener('change', () => lv.refresh());
    const browse = F.button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', title: 'Browse For Folder', path: loc.value }); if (p) { loc.value = p; lv.refresh(); } });
    const restore = async () => {
      const b = lv.selected()[0]; if (!b) return null;
      if (await ask('Are you sure you want to restore the selected backup?') !== 'OK') return null;
      const r = G.restore(b.backupId, loc.value);
      if (!r.ok) await error(r); else { await WS.ui.msgbox({ title: 'Restore', icon: 'info', message: `${b.name}: Succeeded`, detail: 'The GPO was restored. Links to it are not part of a backup; link it again where it is needed.' }); }
      lv.refresh();
      return r;
    };
    const del = async () => {
      const b = lv.selected()[0]; if (!b) return null;
      if (await ask('Are you sure you want to permanently delete the selected backup?', { icon: 'warning' }) !== 'OK') return null;
      WS.fs.remove(b.path, null, { recursive: true }); lv.refresh();
      return { ok: true };
    };
    const frame = WS.ui.modal({ title: 'Manage Backups', width: 760, className: 'w32-dlg gpmc-dlg' });
    frame.body.appendChild(h('div.w32', F.stack('Backup location:', h('div.gpmc-inline', loc, browse)), F.note('Backed up GPOs:'), lv.el, box));
    frame.footer.append(F.button('Restore', restore), F.button('Delete', del), F.button('View Settings...', () => viewBackupSettings(lv.selected()[0])), h('button.btn.primary', { onClick: () => frame.close(true) }, 'Close'));
    frame.onEscape = () => frame.close(true);
    if (o.onCreate) o.onCreate({ frame, list: lv, restore, del, setPath: p => { loc.value = p; lv.refresh(); } });
    return frame.promise;
  }
  /** Restore Group Policy Object Wizard (a GPO's Restore from Backup...). */
  function restoreWizard(g, o = {}) {
    const loc = field('location', F.text({ value: prefs().backupPath || 'C:\\', width: 300 }));
    let bl = null;
    return WS.ui.wizard({ title: 'Restore Group Policy Object Wizard', style: 'classic', onCreate: o.onCreate, data: {}, pages: [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the Restore Group Policy Object Wizard', render: () => h('div', h('p', 'This wizard helps you restore a Group Policy object (GPO) from a GPO backup.'), h('p', 'To continue, click Next.')) },
      { id: 'location', title: 'Backup Location', subtitle: 'The location of the backup folder that contains the GPO backup.', render: () => h('div', F.note('Enter the name of the folder that contains the backup you want to restore from.'), F.stack('Backup folder:', loc)),
        validate: () => (WS.fs.isDir(loc.value) ? null : 'The system cannot find the path specified.') },
      { id: 'source', title: 'Source GPO', subtitle: 'Select the GPO version you want to restore.', rerender: true,
        render: w => { bl = backupList(() => loc.value, { gpoId: g.id }); w.data.list = bl.lv; return h('div', F.note('Backed up versions:'), bl.lv.el, bl.box); },
        validate: w => { const b = bl.lv.selected()[0] || bl.lv.rows()[0]; if (!b) return 'There are no backups of this GPO in the selected folder.'; w.data.backup = b; return null; } },
      { id: 'done', kind: 'complete', title: 'Completing the Restore Group Policy Object Wizard', rerender: true, render: w => h('div', h('p', 'You have successfully completed the Restore Group Policy Object Wizard.'), h('p', 'You chose to restore the following backup:'), h('p', `${w.data.backup.name}\n${when(w.data.backup.time)}`), h('p', 'To close this wizard and start the restore, click Finish.')) }
    ], onFinish: async w => { const r = G.restore(w.data.backup.backupId, loc.value); if (!r.ok) { await error(r); return false; } prefs().backupPath = loc.value; await WS.ui.msgbox({ title: 'Restore', icon: 'info', message: `${g.name}: Succeeded` }); return true; } });
  }
  /** Import Settings Wizard: copy a backup's settings into this GPO. */
  function importWizard(g, o = {}) {
    const loc = field('location', F.text({ value: prefs().backupPath || 'C:\\', width: 300 }));
    let bl = null;
    return WS.ui.wizard({ title: 'Import Settings Wizard', style: 'classic', onCreate: o.onCreate, data: {}, pages: [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the Import Settings Wizard', render: () => h('div', h('p', 'This wizard helps you import settings from a backed-up Group Policy object (GPO) into the destination GPO. Any existing settings in the destination GPO will be overwritten.'), h('p', `Destination GPO: ${g.name}`), h('p', 'To continue, click Next.')) },
      { id: 'backup', title: 'Backup GPO', subtitle: 'You should back up the existing settings in the destination GPO before you import new settings.', render: () => h('div', F.note('Importing settings overwrites every setting in the destination GPO. To back it up first, click Backup.'), F.button('Backup...', () => backupDialog(g))) },
      { id: 'location', title: 'Backup Location', subtitle: 'The location of the backup folder that contains the GPO backup.', render: () => h('div', F.stack('Backup folder:', loc)),
        validate: () => (WS.fs.isDir(loc.value) ? null : 'The system cannot find the path specified.') },
      { id: 'source', title: 'Source GPO', subtitle: 'Select the GPO from which you want to import settings.', rerender: true,
        render: w => { bl = backupList(() => loc.value, {}); w.data.list = bl.lv; return h('div', F.note('Backed up GPOs:'), bl.lv.el, bl.box); },
        validate: w => { const b = bl.lv.selected()[0]; if (!b) return 'Select a backup to import.'; w.data.backup = b; return null; } },
      { id: 'scan', title: 'Scanning Backup', subtitle: 'The wizard will now scan the backup for security principals and UNC paths.', render: () => h('div', F.note('The backup does not contain any security principals or UNC paths that need to be migrated.')) },
      { id: 'done', kind: 'complete', title: 'Completing the Import Settings Wizard', rerender: true, render: w => h('div', h('p', 'You have successfully completed the Import Settings Wizard.'), h('p', `Source GPO: ${w.data.backup.name}`), h('p', 'To close this wizard and import the settings, click Finish.')) }
    ], onFinish: async w => { const r = G.importSettings(w.data.backup.backupId, loc.value, g); if (!r.ok) { await error(r); return false; } await WS.ui.msgbox({ title: 'Import', icon: 'info', message: `${g.name}: Succeeded` }); return true; } });
  }
  async function pasteGpo(o = {}) {
    const src = G.get(clipboard.gpo); if (!src) return null;
    const dflt = F.radio('cpy', 'Use the default permissions for new GPOs', true), keep = F.radio('cpy', 'Preserve the existing permissions', false);
    field('defaultPerms', dflt); field('preservePerms', keep);
    return formDialog({ title: 'Copy GPO', width: 420, onCreate: o.onCreate, content: h('div', F.note('Specify permissions for the new GPO:'), dflt, keep),
      submit: () => G.copy(src, { preservePermissions: keep.checked }) });
  }

  /* ---- Group Policy Update... on an OU ---- */
  async function remoteUpdate(som, o = {}) {
    const comps = WS.ad.search({ type: 'computer', under: WS.ad.dn(som), advanced: true });
    if (await ask(`Are you sure you want to update the policy on the following computers?\n\nComputers in "${G.somName(som)}" and all its child OUs: ${comps.length}`, { title: 'Force Group Policy update' }) !== 'OK') return null;
    const rows = comps.map(c => {
      const self = c.name.toLowerCase() === WS.sys.name.toLowerCase();
      if (self) G.refresh({ force: true, reason: 'manual' });
      return { name: c.name, code: self ? '' : '0x800706ba', text: self ? 'Succeeded' : 'The RPC server is unavailable.' };
    });
    const lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Computer Name', width: 140 }, { key: 'code', label: 'Error Code', width: 90 }, { key: 'text', label: 'Error Description', width: 220 }], rows, getId: r => r.name, multi: false });
    lv.el.classList.add('gpmc-pick');
    await WS.ui.dialog({ title: 'Remote Group Policy update results', width: 500, content: h('div.w32', F.note(`Succeeded: ${rows.filter(r => !r.code).length}    Failed: ${rows.filter(r => r.code).length}`), lv.el), buttons: [{ label: 'Close', primary: true }] });
    return rows;
  }

  /* ---- Group Policy Results / Modeling wizards ---- */
  function resultsWizard(o = {}) {
    const thisPc = field('thisComputer', F.radio('rwpc', 'This computer', true)), another = field('anotherComputer', F.radio('rwpc', 'Another computer:', false));
    const pcName = field('computerName', F.text({ width: 220 }));
    const noComp = field('noComputer', F.checkbox('Do not display policy settings for the selected computer in the results (display user policy settings only)', false));
    const user = (WS.session && WS.session.user) || 'Administrator';
    const display = A() ? `${A().netbios}\\${user}` : `${WS.sys.name}\\${user}`;
    const users = WS.ui.listView({ columns: [{ key: 'name', label: 'User', width: 300 }], rows: () => (G.applied('user') ? [{ name: display }] : []), getId: r => r.name, multi: false, emptyText: 'No users have RSoP data on this computer.' });
    users.el.classList.add('gpmc-pick');
    const current = field('currentUser', F.radio('rwu', 'Current user', true)), specific = field('specificUser', F.radio('rwu', 'Select a specific user:', false));
    const noUser = field('noUser', F.checkbox('Do not display user policy settings in the results (display computer policy settings only)', false));
    return WS.ui.wizard({ title: 'Group Policy Results Wizard', style: 'classic', onCreate: o.onCreate, data: {}, pages: [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the Group Policy Results Wizard', render: () => h('div', h('p', 'This wizard helps you report the policy settings applied to a user or computer. You can use this information to help troubleshoot policy-related issues.'), h('p', 'To continue, click Next.')) },
      { id: 'computer', title: 'Computer Selection', subtitle: 'You can view policy settings for this computer or for another computer on this network.', render: () => h('div', F.note('Select the computer for which you want to display policy settings.'), thisPc, h('div.gpmc-inline', another, pcName), noComp),
        validate: () => (another.checked && pcName.value.trim() && pcName.value.trim().replace(/^[^\\]+\\/, '').toLowerCase() !== WS.sys.name.toLowerCase() ? `The computer "${pcName.value.trim()}" could not be contacted. Verify that the computer is on the network and that you have permission to read its Resultant Set of Policy data.` : null) },
      { id: 'user', title: 'User Selection', subtitle: 'You can view policy settings for users of the selected computer.', render: () => h('div', F.note('Display policy settings for:'), current, specific, users.el, noUser),
        validate: () => (noComp.checked && noUser.checked ? 'You must select at least one of computer or user policy settings to display.' : null) },
      { id: 'summary', title: 'Summary of Selections', subtitle: 'The list contains the selections you made in the wizard.', rerender: true,
        render: () => h('div', h('table.gpmc-sum', ...[['User name', noUser.checked ? '' : display], ['Display user policy settings', noUser.checked ? 'No' : 'Yes'], ['Computer name', `${A() ? A().netbios + '\\' : ''}${WS.sys.name}`], ['Display computer policy settings', noComp.checked ? 'No' : 'Yes']].map(([k, v]) => h('tr', h('td', k), h('td', v)))), F.note('To change your selections, click Back. To gather the policy settings, click Next.')) },
      { id: 'done', kind: 'complete', title: 'Completing the Group Policy Results Wizard', render: () => h('div', h('p', 'You have successfully completed the Group Policy Results Wizard.'), h('p', 'To close this wizard, click Finish.')) }
    ], onFinish: w => {
      const res = { id: ++resultSeq, kind: 'results', name: noUser.checked ? WS.sys.name : `${user} on ${WS.sys.name}`, showComputer: !noComp.checked, showUser: !noUser.checked, time: new Date().toISOString() };
      res.rs = logged(res);
      results.push(res);
      w.data.result = res;
      WS.store.changed('gpmc');
      return true;
    } }).then(r => { if (r.finished && r.data.result && o.console) o.console.open('gpmc-result:' + r.data.result.id); return r; });
  }
  const logged = res => { const rs = G.loggedRsop(); return { computer: res.showComputer ? rs.computer : null, user: res.showUser ? rs.user : null }; };
  /** Choose a domain or OU (the Modeling wizard's Browse... for a container). */
  function chooseContainer(title, o = {}) {
    let chosen = null;
    const node = som => ({ id: som.id, label: G.somName(som), icon: somIcon(som), expanded: som.type === 'domainDNS', data: som,
      children: () => WS.ad.children(som.id, { advanced: true }).filter(x => x.type === 'organizationalUnit' || (x.type === 'container' && !x.advanced)).sort((a, b) => a.name.localeCompare(b.name)).map(node) });
    const tree = WS.ui.tree({ nodes: () => [node(WS.ad.root())], onSelect: n => { chosen = WS.ad.byId(n.id); } });
    tree.el.classList.add('gpmc-ctree');
    return formDialog({ title, width: 380, onCreate: f => { if (o.onCreate) o.onCreate({ frame: f, tree, choose: id => { tree.reveal(WS.gpo.chainFor(WS.ad.byId(id), true).map(x => x.id)); chosen = WS.ad.byId(id); } }); },
      content: h('div', tree.el), submit: () => (chosen ? { ok: true, container: chosen } : { ok: false, error: 'Select a container.' }) });
  }
  function modelingWizard(o = {}) {
    const d = { userMode: 'container', compMode: 'container', userContainer: o.userContainer || null, compContainer: o.computerContainer || null, user: null, computer: null, loopback: 0 };
    const uCont = field('userContainer', F.radio('mu', 'Container:', true)), uObj = field('userObject', F.radio('mu', 'User:', false));
    const cCont = field('computerContainer', F.radio('mc', 'Container:', true)), cObj = field('computerObject', F.radio('mc', 'Computer:', false));
    const uContText = field('userContainerText', F.text({ readOnly: true, width: 280 })), uObjText = field('userText', F.text({ width: 280 }));
    const cContText = field('computerContainerText', F.text({ readOnly: true, width: 280 })), cObjText = field('computerText', F.text({ width: 280 }));
    const show = () => { uContText.value = d.userContainer ? WS.ad.dn(d.userContainer) : ''; cContText.value = d.compContainer ? WS.ad.dn(d.compContainer) : ''; };
    const loop = field('loopback', F.checkbox('Loopback processing', false)), merge = field('merge', F.radio('ml', 'Merge', true)), replace = field('replace', F.radio('ml', 'Replace', false));
    const slow = F.checkbox('Slow network connection (for example, a dial-up connection)', false);
    const browseC = which => F.button('Browse...', async () => { const r = await chooseContainer(which === 'user' ? 'Choose User Container' : 'Choose Computer Container', { onCreate: o.onChoose }); if (r && r.container) { d[which === 'user' ? 'userContainer' : 'compContainer'] = r.container; (which === 'user' ? uCont : cCont).checked = true; show(); } });
    const browseO = which => F.button('Browse...', async () => {
      const p = await WS.ui.objectPicker({ types: [which], multi: false });
      if (p && p[0]) { (which === 'user' ? uObjText : cObjText).value = p[0].principal; (which === 'user' ? uObj : cObj).checked = true; }
    });
    const resolve = () => {
      const target = (isObj, text, cont, type) => {
        if (isObj) { const o2 = text.trim() ? (WS.ad.resolveIdentity(text.trim().replace(/^[^\\]+\\/, ''), type) || WS.ad.get(text.trim().replace(/^[^\\]+\\/, ''), type)) : null; return o2 ? { obj: o2, label: o2.name } : { error: `The ${type} "${text}" was not found.` }; }
        return cont ? { obj: { type, parentId: cont.id, name: '', sid: null }, label: G.somName(cont) } : { obj: null, label: '' };
      };
      return { u: target(uObj.checked, uObjText.value, d.userContainer, 'user'), c: target(cObj.checked, cObjText.value, d.compContainer, 'computer') };
    };
    return WS.ui.wizard({ title: 'Group Policy Modeling Wizard', style: 'classic', onCreate: w => { show(); if (o.onCreate) o.onCreate(w, d); }, data: d, pages: [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the Group Policy Modeling Wizard', render: () => h('div', h('p', 'This wizard helps you simulate policy deployment for users and computers. The resulting report shows the policy settings that would apply if the simulated conditions were in effect.'), h('p', 'To continue, click Next.')) },
      { id: 'dc', title: 'Domain Controller Selection', subtitle: 'The simulation is processed on a domain controller.', render: () => h('div', F.row('Show domain controllers in this domain:', F.select([dom()], dom(), { width: 160 }), { labelWidth: 220 }), F.radio('mdc', 'Any available domain controller running Windows Server 2003 or later', true), F.radio('mdc', `This domain controller: ${WS.sys.fqdn()}`, false)) },
      { id: 'select', title: 'User and Computer Selection', subtitle: 'You can simulate policy settings for a user and computer, or for the containers they are in.',
        render: () => h('div', F.group('User information', h('div.gpmc-inline', uCont, uContText, browseC('user')), h('div.gpmc-inline', uObj, uObjText, browseO('user'))),
          F.group('Computer information', h('div.gpmc-inline', cCont, cContText, browseC('computer')), h('div.gpmc-inline', cObj, cObjText, browseO('computer')))),
        validate: () => { const r = resolve(); if (r.u.error) return r.u.error; if (r.c.error) return r.c.error; if (!r.u.obj && !r.c.obj) return 'You must specify a user or computer, or a container for them.'; return null; } },
      { id: 'advanced', title: 'Advanced Simulation Options', subtitle: 'You can specify additional options for the simulation.', render: () => h('div', slow, loop, h('div.gpmc-indent', merge, replace), F.row('Site:', F.select(['(None)', 'Default-First-Site-Name'], '(None)', { width: 200 }), { labelWidth: 60 })) },
      { id: 'summary', title: 'Summary of Selections', subtitle: 'The list contains the selections you made in the wizard.', rerender: true,
        render: () => { const r = resolve(); return h('div', h('table.gpmc-sum', ...[['User', r.u.obj ? (uObj.checked ? `${A().netbios}\\${r.u.obj.sam}` : WS.ad.dn(d.userContainer)) : '(none)'], ['Computer', r.c.obj ? (cObj.checked ? `${A().netbios}\\${r.c.obj.name}` : WS.ad.dn(d.compContainer)) : '(none)'], ['Loopback processing', loop.checked ? (replace.checked ? 'Replace' : 'Merge') : 'No'], ['Slow link', slow.checked ? 'Yes' : 'No']].map(([k, v]) => h('tr', h('td', k), h('td', v)))), F.note('To change your selections, click Back. To process the simulation, click Next.')); } },
      { id: 'done', kind: 'complete', title: 'Completing the Group Policy Modeling Wizard', render: () => h('div', h('p', 'You have successfully completed the Group Policy Modeling Wizard.'), h('p', 'To close this wizard, click Finish.')) }
    ], onFinish: w => {
      const r = resolve();
      const res = { id: ++resultSeq, kind: 'modeling', name: `${r.u.label || '(none)'} on ${r.c.label || '(none)'}`, user: r.u.obj, computer: r.c.obj, loopback: loop.checked ? (replace.checked ? 2 : 1) : 0, time: new Date().toISOString() };
      res.rs = modeled(res);
      results.push(res);
      w.data.result = res;
      WS.store.changed('gpmc');
      return true;
    } }).then(r => { if (r.finished && r.data.result && o.console) o.console.open('gpmc-result:' + r.data.result.id); return r; });
  }
  const modeled = res => G.rsop({ computer: res.computer, user: res.user, loopback: res.loopback || null });

  /* ---------------------------------------------------------------- result pane: tabs */
  function tabbed(host, ctl, kind, head, tabs) {
    const titleEl = h('span.gpmc-title'), strip = h('div.gpmc-tabs'), body = h('div.gpmc-tabbody');
    host.appendChild(h('div.gpmc-pane', h('div.gpmc-head', head.icon ? h('span.gpmc-hicon', { html: head.icon }) : null, titleEl), strip, body));
    let live = null;
    const current = () => { const want = ctl.tabs[kind]; return tabs.find(t => t.label === want) ? want : tabs[0].label; };
    function paint() {
      titleEl.textContent = typeof head.title === 'function' ? head.title() : head.title;
      const cur = current();
      U.clear(strip);
      for (const t of tabs) strip.appendChild(h('div.gpmc-tab' + (t.label === cur ? '.sel' : ''), { dataset: { tab: t.label }, onClick: () => { ctl.tabs[kind] = t.label; paint(); } }, t.label));
      U.clear(body);
      live = tabs.find(t => t.label === cur).render(body) || null;
    }
    paint();
    ctl.showTab = label => { if (tabs.find(t => t.label === label)) { ctl.tabs[kind] = label; paint(); } };
    return { refresh() { titleEl.textContent = typeof head.title === 'function' ? head.title() : head.title; if (live && live.refresh) live.refresh(); else paint(); } };
  }
  const section = (title, ...children) => h('div.gpmc-sec', h('div.gpmc-sh', title), ...children);
  function list(o) { const lv = WS.ui.listView(Object.assign({ multi: false }, o)); lv.el.classList.add('gpmc-list'); if (o.height) lv.el.style.height = o.height + 'px'; return lv; }
  const wmiName = g => (g.wmiFilter ? (G.wmiFilter(g.wmiFilter) || {}).name || '' : 'None');

  /* ---- views ---- */
  function contentsView(ctl, kind, title, icon, columns, rows, o = {}) {
    return { render: host => tabbed(host, ctl, kind, { title, icon }, [{ label: 'Contents', render: b => {
      const lv = list({ columns, rows, getId: o.getId || (r => r.id), icon: o.icon || (r => r.icon), onActivate: r => (o.activate ? o.activate(r) : r.node && ctl.open(r.node)), emptyText: o.empty,
        onContext: (sel, x, y) => o.menu && WS.ui.contextMenu(x, y, o.menu(sel)) });
      if (o.before) b.appendChild(o.before());
      b.appendChild(lv.el);
      return { refresh: () => lv.refresh() };
    } }, ...(o.tabs || [])]) };
  }
  function somView(ctl, som) {
    const isDom = som.type === 'domainDNS';
    const tabs = [];
    if (isDom) tabs.push({ label: 'Status', render: b => statusTab(b, 'domain') });
    tabs.push({ label: 'Linked Group Policy Objects', render: b => {
      const lv = list({ columns: [
        { key: 'order', label: 'Link Order', width: 70, type: 'num' }, { key: 'gpo', label: 'GPO', width: 190, value: r => r.gpoObj.name },
        { key: 'enforced', label: 'Enforced', width: 65, value: r => (r.enforced ? 'Yes' : 'No') }, { key: 'enabled', label: 'Link Enabled', width: 85, value: r => (r.enabled ? 'Yes' : 'No') },
        { key: 'status', label: 'GPO Status', width: 120, value: r => G.statusLabel(r.gpoObj.status) }, { key: 'wmi', label: 'WMI Filter', width: 100, value: r => wmiName(r.gpoObj) },
        { key: 'modified', label: 'Modified', width: 140, value: r => when(r.gpoObj.modified) }, { key: 'domain', label: 'Domain', width: 100, value: () => dom() }],
      rows: () => G.somLinks(som), getId: r => r.gpo, icon: linkIcon, sortKey: 'order',
      onActivate: r => ctl.open(`gpmc-link:${som.id}:${r.gpo}`),
      onContext: (sel, x, y) => WS.ui.contextMenu(x, y, sel.length ? linkMenu(ctl, som, sel[0].gpoObj) : somMenu(ctl, som)) });
      const move = to => { const r = lv.selected()[0]; if (!r) return; const n = G.somLinks(som).length; const order = to === 'top' ? 1 : to === 'bottom' ? n : r.order + (to === 'up' ? -1 : 1); if (order >= 1 && order <= n) G.setLink(r.gpo, som, { order }); };
      const arrow = (label, path, to) => h('button.gpmc-arrow', { title: label, dataset: { move: to }, html: s16(path), onClick: () => move(to) });
      b.appendChild(h('div.gpmc-split', h('div.gpmc-arrows',
        arrow('Move link to top', '<path d="M3 3h10M8 5l-4 4h3v4h2V9h3z" fill="#1d5fbf" stroke="#1d5fbf"/>', 'top'), arrow('Move link up', '<path d="M8 3l-4.5 5H7v5h2V8h3.5z" fill="#1d5fbf"/>', 'up'),
        arrow('Move link down', '<path d="M8 13l-4.5-5H7V3h2v5h3.5z" fill="#1d5fbf"/>', 'down'), arrow('Move link to bottom', '<path d="M3 13h10M8 11l-4-4h3V3h2v4h3z" fill="#1d5fbf" stroke="#1d5fbf"/>', 'bottom')), lv.el));
      ctl.linkedList = lv;
      return { refresh: () => lv.refresh() };
    } });
    tabs.push({ label: 'Group Policy Inheritance', render: b => {
      if (som.blockInheritance) b.appendChild(h('div.gpmc-banner', 'This container has inheritance blocked. GPOs linked to higher-level containers do not apply unless their links are enforced.'));
      const lv = list({ columns: [{ key: 'precedence', label: 'Precedence', width: 75, type: 'num' }, { key: 'gpo', label: 'GPO', width: 200, value: r => r.gpo.name },
        { key: 'loc', label: 'Location', width: 160, value: r => G.somName(r.som) }, { key: 'status', label: 'GPO Status', width: 120, value: r => G.statusLabel(r.gpo.status) }, { key: 'wmi', label: 'WMI Filter', width: 100, value: r => wmiName(r.gpo) }],
      rows: () => G.inheritance(som), getId: r => r.precedence + ':' + r.gpo.id, icon: r => linkIcon(r), sortKey: 'precedence',
      onActivate: r => ctl.open(`gpmc-link:${r.som.id}:${r.gpo.id}`) });
      b.appendChild(lv.el);
      ctl.inheritanceList = lv;
      return { refresh: () => lv.refresh() };
    } });
    tabs.push({ label: 'Delegation', render: b => {
      const perm = F.select(['Link GPOs', 'Perform Group Policy Modeling analyses', 'Read Group Policy Results data'], 'Link GPOs', { width: 260 });
      const rows = () => [{ id: 'da', name: 'Domain Admins (CONTOSO\\Domain Admins)'.replace('CONTOSO', A().netbios), applies: 'This container only', inherited: 'No' },
        { id: 'ea', name: `Enterprise Admins (${A().netbios}\\Enterprise Admins)`, applies: 'This container and all child containers', inherited: isDom ? 'No' : 'Yes' },
        { id: 'sys', name: 'SYSTEM', applies: 'This container only', inherited: 'No' }];
      const lv = list({ columns: [{ key: 'name', label: 'Groups and users', width: 290 }, { key: 'applies', label: 'Applies To', width: 220 }, { key: 'inherited', label: 'Inherited', width: 70 }], rows, getId: r => r.id, icon: () => I.adGroup });
      b.appendChild(h('div', F.row('Permission:', perm, { labelWidth: 80 }), F.note('Groups and users:'), lv.el, h('div.gpmc-btns', F.button('Add...', () => {}, { disabled: true }), F.button('Remove', () => {}, { disabled: true }), F.button('Properties', () => {}, { disabled: true }), F.button('Advanced...', () => {}, { disabled: true }))));
      return {};
    } });
    return { render: host => tabbed(host, ctl, isDom ? 'domain' : 'ou', { title: () => G.somName(som), icon: somIcon(som) }, tabs) };
  }
  function statusTab(b, what) {
    let detected = false;
    const paint = () => {
      U.clear(b);
      b.appendChild(h('div.gpmc-status',
        h('p', `This page shows the status of Active Directory and SYSVOL (DFSR) replication for this ${what} as it relates to Group Policy.`),
        section('Status Details', h('p', `${WS.sys.fqdn()} is the baseline domain controller for this ${what}.`),
          detected ? h('p', `Domain controller(s) with replication in sync (1 of 1): ${WS.sys.fqdn()}`) : h('p', 'No infrastructure status exists for this ' + what + '. To gather infrastructure status, click Detect Now.'),
          F.button('Detect Now', () => { detected = true; paint(); }))));
    };
    paint();
    return {};
  }
  function gpoView(ctl, g, link) {
    const tabs = [
      { label: 'Scope', render: b => scopeTab(ctl, b, g, link) },
      { label: 'Details', render: b => detailsTab(b, g) },
      { label: 'Settings', render: b => { const paint = () => { U.clear(b); b.appendChild(reportView(G.reportBody(g))); }; paint(); return { refresh: paint }; } },
      { label: 'Delegation', render: b => delegationTab(b, g) },
      { label: 'Status', render: b => statusTab(b, 'GPO') }
    ];
    return { render: host => {
      if (link) setTimeout(() => { if (host.isConnected) linkNotice({ onCreate: ctl.onNotice }); }, 0);
      return tabbed(host, ctl, 'gpo', { title: () => g.name, icon: link ? linkIcon(link.l || {}) : ICON.gpo }, tabs);
    } };
  }
  function scopeTab(ctl, b, g, link) {
    const where = F.select([dom()], dom(), { width: 200 });
    const links = list({ columns: [{ key: 'loc', label: 'Location', width: 180, value: r => G.somName(r.som) }, { key: 'enf', label: 'Enforced', width: 70, value: r => (r.enforced ? 'Yes' : 'No') },
      { key: 'en', label: 'Link Enabled', width: 85, value: r => (r.enabled ? 'Yes' : 'No') }, { key: 'path', label: 'Path', width: 240, value: r => G.somPath(r.som) }],
    rows: () => G.links(g), getId: r => r.som.id, icon: r => somIcon(r.som), height: 110,
    onActivate: r => ctl.open('gpmc-som:' + r.som.id),
    onContext: (sel, x, y) => sel.length && WS.ui.contextMenu(x, y, [
      { label: 'Enforced', checked: sel[0].enforced, action: () => G.setLink(g, sel[0].som, { enforced: !sel[0].enforced }) },
      { label: 'Link Enabled', checked: sel[0].enabled, action: () => G.setLink(g, sel[0].som, { enabled: !sel[0].enabled }) },
      { separator: true }, { label: 'Delete Link(s)', action: () => deleteLink(sel[0].som, g) }]) });
    const filt = list({ columns: [{ key: 'name', label: 'Name', width: 360 }], rows: () => G.filtering(g), getId: r => r.sid, icon: r => (r.type === 'User' ? I.adUser : r.type === 'Computer' ? I.adComputer : I.adGroup), height: 100 });
    const removeBtn = F.button('Remove', async () => { const r = filt.selected()[0]; if (r) await removeDelegation(g, r.sid); });
    const wmiSel = field('wmiFilter', F.select([{ value: '', label: '<none>' }, ...G.wmiFilters().map(f => ({ value: f.id, label: f.name }))], g.wmiFilter || '', { width: 220 }));
    wmiSel.addEventListener('change', async () => {
      const f = G.wmiFilter(wmiSel.value);
      if (await ask(`Do you want to change the WMI filter to ${f ? f.name : '<none>'}?`, { buttons: ['Yes', 'No'] }) !== 'Yes') { wmiSel.value = g.wmiFilter || ''; return; }
      const r = G.setGpoWmiFilter(g, wmiSel.value || null); if (!r.ok) error(r);
    });
    b.appendChild(h('div.gpmc-scope',
      section('Links', F.row('Display links in this location:', where, { labelWidth: 190 }), F.note('The following sites, domains, and OUs are linked to this GPO:'), links.el),
      section('Security Filtering', F.note('The settings in this GPO can only apply to the following groups, users, and computers:'), filt.el,
        h('div.gpmc-btns', F.button('Add...', () => addFiltering(g)), removeBtn, F.button('Properties', () => {}, { disabled: true }))),
      section('WMI Filtering', F.note('This GPO is linked to the following WMI filter:'), h('div.gpmc-inline', wmiSel, F.button('Open', () => { if (g.wmiFilter) ctl.open('gpmc-wmi:' + g.wmiFilter); })))));
    ctl.scope = { links, filtering: filt, wmi: wmiSel, removeFilter: () => removeBtn.click() };
    return { refresh: () => { links.refresh(); filt.refresh(); wmiSel.value = g.wmiFilter || ''; } };
  }
  function detailsTab(b, g) {
    const status = field('gpoStatus', F.select(G.STATUS.map(s => ({ value: s, label: G.statusLabel(s) })), g.status, { width: 260 }));
    status.addEventListener('change', () => { const r = G.setStatus(g, status.value); if (!r.ok) error(r); });
    const rows = () => [['Domain:', dom()], ['Owner:', `${G.principal(g.owner).short} (${G.principal(g.owner).name})`], ['Created:', when(g.created)], ['Modified:', when(g.modified)],
      ['User version:', `${g.userVersion} (AD), ${g.userVersion} (SYSVOL)`], ['Computer version:', `${g.computerVersion} (AD), ${g.computerVersion} (SYSVOL)`], ['Unique ID:', g.id]];
    const table = h('table.gpmc-kv');
    const comment = F.textarea({ value: g.description, rows: 4, readOnly: true, width: 420 });
    const paint = () => { U.clear(table); for (const [k, v] of rows()) table.appendChild(h('tr', h('td', k), h('td', v))); status.value = g.status; comment.value = g.description; };
    paint();
    b.appendChild(h('div.gpmc-details', table, F.row('GPO Status:', status, { labelWidth: 120 }), F.row('Comment:', comment, { labelWidth: 120 })));
    return { refresh: paint };
  }
  function delegationTab(b, g) {
    const lv = list({ columns: [{ key: 'name', label: 'Name', width: 300 }, { key: 'label', label: 'Allowed Permissions', width: 260 }, { key: 'inh', label: 'Inherited', width: 70, value: () => 'No' }],
      rows: () => G.permissions(g), getId: r => r.sid, icon: r => (r.type === 'User' ? I.adUser : r.type === 'Computer' ? I.adComputer : I.adGroup) });
    b.appendChild(h('div', F.note('These groups and users have the specified permission for this GPO'), lv.el,
      h('div.gpmc-btns', F.button('Add...', () => addDelegation(g)), F.button('Remove', async () => { const r = lv.selected()[0]; if (r) await removeDelegation(g, r.sid); }), F.button('Properties', () => {}, { disabled: true }), F.button('Advanced...', () => {}, { disabled: true }))));
    return { refresh: () => lv.refresh() };
  }
  function wmiView(ctl, f) {
    return { render: host => tabbed(host, ctl, 'wmi', { title: () => f.name, icon: ICON.wmi }, [{ label: 'General', render: b => {
      const paint = () => {
        U.clear(b);
        const q = list({ columns: [{ key: 'namespace', label: 'Namespace', width: 110 }, { key: 'query', label: 'Query', width: 420 }], rows: f.queries, getId: r => r.query, height: 90 });
        const used = list({ columns: [{ key: 'name', label: 'GPO', width: 260 }, { key: 'dom', label: 'Domain', width: 120, value: () => dom() }], rows: () => G.list().filter(g => g.wmiFilter === f.id), getId: g => g.id, icon: () => ICON.gpo, height: 90, onActivate: g => ctl.open('gpmc-gpo:' + g.id) });
        b.appendChild(h('div', h('table.gpmc-kv', h('tr', h('td', 'Name:'), h('td', f.name)), h('tr', h('td', 'Description:'), h('td', f.description)), h('tr', h('td', 'Author:'), h('td', f.author)), h('tr', h('td', 'Modified:'), h('td', when(f.modified)))),
          F.note('Queries:'), q.el, h('div.gpmc-btns', F.button('Edit Filter...', () => wmiFilterDialog(f))), F.note('GPOs that use this WMI filter:'), used.el));
      };
      paint();
      return { refresh: paint };
    } }]) };
  }
  function resultView(ctl, res) {
    const rs = () => res.rs;
    const tabs = [
      { label: 'Summary', render: b => { const p = () => { U.clear(b); b.appendChild(reportView(G.rsopBody(rs(), { title: res.name, only: 'summary' }))); }; p(); return { refresh: p }; } },
      { label: 'Settings', render: b => { const p = () => { U.clear(b); b.appendChild(reportView(G.rsopBody(rs(), { title: res.name, only: 'settings' }))); }; p(); return { refresh: p }; } }
    ];
    if (res.kind === 'results') tabs.push({ label: 'Policy Events', render: b => {
      const logs = ['System', 'Application', 'Microsoft-Windows-GroupPolicy/Operational'];
      const rows = () => logs.flatMap(l => (WS.state.events.logs[l] || []).filter(e => /GroupPolicy|SceCli/.test(e.source)).map(e => ({ ...e, log: l }))).sort((a, b2) => b2.record - a.record);
      const lv = list({ columns: [{ key: 'level', label: 'Type', width: 90 }, { key: 'time', label: 'Date and Time', width: 150, value: e => when(e.time) }, { key: 'source', label: 'Source', width: 170 }, { key: 'id', label: 'Event ID', width: 70, type: 'num' }, { key: 'log', label: 'Log', width: 180 }],
        rows, getId: e => e.log + e.record, icon: () => I.eventInfo });
      b.appendChild(lv.el);
      return { refresh: () => lv.refresh() };
    } });
    else tabs.push({ label: 'Query', render: b => { b.appendChild(h('table.gpmc-kv', ...[['User', res.user ? (res.user.sam ? `${A().netbios}\\${res.user.sam}` : WS.ad.dn(WS.ad.byId(res.user.parentId))) : '(none)'], ['Computer', res.computer ? (res.computer.sam ? `${A().netbios}\\${res.computer.name}` : WS.ad.dn(WS.ad.byId(res.computer.parentId))) : '(none)'], ['Loopback processing', res.loopback === 2 ? 'Replace' : res.loopback === 1 ? 'Merge' : 'No'], ['Created', when(res.time)]].map(([k, v]) => h('tr', h('td', k), h('td', v))))); return {}; } });
    return { render: host => tabbed(host, ctl, 'result-' + res.kind, { title: () => res.name, icon: res.kind === 'results' ? ICON.results : ICON.modeling }, tabs) };
  }
  function starterView(ctl, s) {
    return { render: host => tabbed(host, ctl, 'starter', { title: () => s.name, icon: ICON.starter }, [
      { label: 'Details', render: b => { b.appendChild(h('table.gpmc-kv', ...[['Name:', s.name], ['Created:', when(s.created)], ['Modified:', when(s.modified)], ['User version:', String(s.userVersion || 0)], ['Computer version:', String(s.computerVersion || 0)], ['Type:', s.system ? 'System' : 'Custom'], ['Comment:', s.description]].map(([k, v]) => h('tr', h('td', k), h('td', v))))); return {}; } },
      { label: 'Settings', render: b => { const p = () => { U.clear(b); b.appendChild(reportView(starterReport(s))); }; p(); return { refresh: p }; } },
      { label: 'Delegation', render: b => { const lv = list({ columns: [{ key: 'n', label: 'Name', width: 300 }, { key: 'p', label: 'Allowed Permissions', width: 200 }], rows: [{ n: `${A().netbios}\\Domain Admins`, p: 'Edit settings' }, { n: `${A().netbios}\\Group Policy Creator Owners`, p: 'Edit settings' }, { n: 'NT AUTHORITY\\Authenticated Users', p: 'Read' }], getId: r => r.n, icon: () => I.adGroup }); b.appendChild(lv.el); return {}; } }
    ]) };
  }
  function starterReport(s) {
    const rows = side => G.settingRows(s, side);
    const block = side => { const r = rows(side); return r.length ? `<table><tr><th>Policy</th><th>Setting</th></tr>${r.map(x => `<tr><td>${U.esc(x.category + '/' + x.def.name)}</td><td>${U.esc(x.value.state)}</td></tr>`).join('')}</table>` : '<div class="gp-none">No settings defined.</div>'; };
    return `<div class="gprep"><div class="gp-title">${U.esc(s.name)}</div><div class="gp-sec"><div class="gp-h gp-h1" data-gprep-toggle="1"><span>Computer Configuration</span><span class="gp-tog">hide</span></div><div class="gp-body">${block('computer')}</div></div><div class="gp-sec"><div class="gp-h gp-h1" data-gprep-toggle="1"><span>User Configuration</span><span class="gp-tog">hide</span></div><div class="gp-body">${block('user')}</div></div></div>`;
  }

  /* ---------------------------------------------------------------- menus */
  const edit = x => (WS.gpme ? WS.gpme.open(x) : WS.apps.notImplemented('Group Policy Management Editor'));
  function somMenu(ctl, som) {
    const isDom = som.type === 'domainDNS';
    return [
      { label: 'Create a GPO in this domain, and Link it &here...', action: () => newGpo({ link: som }) },
      { label: 'Link an Existing &GPO...', action: () => linkExisting(som) },
      { label: '&Block Inheritance', checked: !!som.blockInheritance, action: () => G.setBlockInheritance(som, !som.blockInheritance) },
      { separator: true },
      !isDom ? { label: 'Group Policy &Update...', action: () => remoteUpdate(som) } : null,
      { label: 'Group Policy &Modeling Wizard...', action: () => modelingWizard({ userContainer: som, computerContainer: som, console: ctl }) },
      { separator: true },
      { label: 'New &Organizational Unit', action: () => newOU(som) },
      isDom ? { label: '&Search...', action: () => search(ctl) } : null,
      isDom ? { label: '&Change Domain Controller...', disabled: true } : null,
      isDom ? { label: '&Remove', disabled: true } : null,
      isDom ? { label: 'Active &Directory Users and Computers...', action: () => WS.apps.launch('dsa') } : null,
      !isDom ? { separator: true } : null,
      !isDom ? { label: '&Delete', action: () => deleteOU(som) } : null,
      !isDom ? { label: 'Re&name', action: () => renameOU(som) } : null
    ];
  }
  async function renameOU(som) {
    let value = som.name;
    for (;;) {
      const next = await WS.ui.inputBox({ title: 'Rename', prompt: 'Name:', value });
      if (next === null) return null;
      const r = WS.ad.rename(som.id, next);
      if (r.ok) return r;
      await error(r); value = next;
    }
  }
  function linkMenu(ctl, som, g) {
    const l = G.somLinks(som).find(x => x.gpo === g.id) || {};
    return [
      { label: '&Edit...', default: true, action: () => edit(g) },
      { label: 'E&nforced', checked: !!l.enforced, action: () => G.setLink(g, som, { enforced: !l.enforced }) },
      { label: '&Link Enabled', checked: l.enabled !== false, action: () => G.setLink(g, som, { enabled: l.enabled === false }) },
      { label: '&Save Report...', action: () => saveReport('gpo', g) },
      { separator: true },
      { label: '&Delete', action: () => deleteLink(som, g) },
      { label: 'Re&name', action: () => renameGpo(g) }
    ];
  }
  function gpoMenu(ctl, g) {
    const radio = (s, label) => ({ label, radio: true, checked: g.status === s, action: () => G.setStatus(g, s) });
    return [
      { label: '&Edit...', default: true, action: () => edit(g) },
      { label: 'GPO &Status', items: () => [radio('AllSettingsEnabled', '&Enabled'), radio('UserSettingsDisabled', '&User Configuration Settings Disabled'), radio('ComputerSettingsDisabled', '&Computer Configuration Settings Disabled'), radio('AllSettingsDisabled', '&All Settings Disabled')] },
      { separator: true },
      { label: '&Back Up...', action: () => backupDialog(g) },
      { label: '&Restore from Backup...', action: () => restoreWizard(g) },
      { label: '&Import Settings...', action: () => importWizard(g) },
      { label: 'Save &Report...', action: () => saveReport('gpo', g) },
      { separator: true },
      { label: '&Copy', action: () => { clipboard.gpo = g.id; } },
      { label: '&Delete', action: () => deleteGpo(g) },
      { label: 'Re&name', action: () => renameGpo(g) }
    ];
  }
  async function search(ctl) {
    const value = field('value', F.text({ width: 240 }));
    const found = [];
    const lv = list({ columns: [{ key: 'name', label: 'Name', width: 230 }, { key: 'id', label: 'GPO ID', width: 270 }], rows: () => found, getId: g => g.id, icon: () => ICON.gpo, height: 140, onActivate: g => { ctl.open('gpmc-gpo:' + g.id); } });
    const go = () => { found.length = 0; found.push(...G.list().filter(g => g.name.toLowerCase().includes(value.value.toLowerCase()))); lv.refresh(); };
    return WS.ui.dialog({ title: 'Search for Group Policy Objects', width: 560, content: h('div.w32', F.row('Search in this domain:', F.select([dom()], dom(), { width: 180 }), { labelWidth: 150 }),
      F.row('Search item:', F.select(['GPO name'], 'GPO name', { width: 180 }), { labelWidth: 150 }), F.row('Condition:', F.select(['Contains'], 'Contains', { width: 180 }), { labelWidth: 150 }),
      F.row('Value:', h('div.gpmc-inline', value, F.button('Find Now', go)), { labelWidth: 150 }), F.note('Search results:'), lv.el), buttons: [{ label: 'Close', primary: true }] });
  }

  /* ---------------------------------------------------------------- console */
  function launch(opts = {}) {
    let mmc = null;
    const ctl = { tabs: {}, get mmc() { return mmc; }, open: id => { if (!mmc.tree.node(id)) mmc.tree.refresh(); if (mmc.tree.node(id)) mmc.select(id); else mmc.selectPath(pathTo(id)); }, tab: label => ctl.showTab && ctl.showTab(label), current: () => mmc.current(),
      dialogs: WS.gpmc };
    const pathTo = id => {
      const m = id.match(/^gpmc-(som|link|gpo|wmi|starter|result):([^:]+)(?::(.+))?$/);
      const base = ['gpmc-root', 'gpmc-forest', 'gpmc-domains'];
      if (!m) return [...base, id];
      if (m[1] === 'som' || m[1] === 'link') { const som = WS.ad.byId(m[2]); return som ? [...base, ...G.chainFor(som, true).map(s => 'gpmc-som:' + s.id), ...(m[1] === 'link' ? [id] : [])] : base; }
      const root = 'gpmc-som:' + WS.ad.root().id;
      if (m[1] === 'gpo') return [...base, root, 'gpmc-gpos', id];
      if (m[1] === 'wmi') return [...base, root, 'gpmc-wmis', id];
      if (m[1] === 'starter') return [...base, root, 'gpmc-starters', id];
      return ['gpmc-root', 'gpmc-forest', results.find(r => 'gpmc-result:' + r.id === id && r.kind === 'modeling') ? 'gpmc-modeling' : 'gpmc-results', id];
    };
    const somNode = som => ({ id: 'gpmc-som:' + som.id, label: G.somName(som), icon: somIcon(som), expanded: som.type === 'domainDNS',
      children: () => [
        ...G.somLinks(som).map(l => ({ id: `gpmc-link:${som.id}:${l.gpo}`, label: l.gpoObj.name, icon: linkIcon(l), menu: () => linkMenu(ctl, som, l.gpoObj), view: () => gpoView(ctl, l.gpoObj, { som, l }) })),
        ...WS.ad.children(som.id).filter(x => x.type === 'organizationalUnit').sort((a, b) => a.name.localeCompare(b.name)).map(somNode),
        ...(som.type === 'domainDNS' ? [gposNode(), wmisNode(), startersNode()] : [])],
      menu: () => somMenu(ctl, som), view: () => somView(ctl, som) });
    const gposNode = () => ({ id: 'gpmc-gpos', label: 'Group Policy Objects', icon: I.folder,
      children: () => G.list().slice().sort((a, b) => a.name.localeCompare(b.name)).map(g => ({ id: 'gpmc-gpo:' + g.id, label: g.name, icon: ICON.gpo, menu: () => gpoMenu(ctl, g), view: () => gpoView(ctl, g, null) })),
      menu: () => [{ label: '&New', action: () => newGpo() }, { label: 'Back Up &All...', action: () => backupDialog('all') }, { label: '&Manage Backups...', action: () => manageBackups() },
        { label: '&Open Migration Table Editor', disabled: true }, { separator: true }, clipboard.gpo && G.get(clipboard.gpo) ? { label: '&Paste', action: () => pasteGpo() } : null],
      view: () => contentsView(ctl, 'gpos', `Group Policy Objects in ${dom()}`, I.folder,
        [{ key: 'name', label: 'Name', width: 220 }, { key: 'status', label: 'GPO Status', width: 150, value: g => G.statusLabel(g.status) }, { key: 'wmi', label: 'WMI Filter', width: 110, value: wmiName },
          { key: 'modified', label: 'Modified', width: 140, value: g => when(g.modified) }, { key: 'owner', label: 'Owner', width: 160, value: g => G.principal(g.owner).name }],
        () => G.list(), { icon: () => ICON.gpo, activate: g => ctl.open('gpmc-gpo:' + g.id), menu: sel => (sel.length ? gpoMenu(ctl, sel[0]) : []),
          tabs: [{ label: 'Delegation', render: b => { const lv = list({ columns: [{ key: 'n', label: 'Groups and users', width: 320 }, { key: 'i', label: 'Inherited', width: 80 }], rows: [{ n: `Domain Admins (${A().netbios}\\Domain Admins)`, i: 'No' }, { n: `Group Policy Creator Owners (${A().netbios}\\Group Policy Creator Owners)`, i: 'No' }, { n: 'SYSTEM', i: 'No' }], getId: r => r.n, icon: () => I.adGroup }); b.appendChild(h('div', F.note('The following groups and users can create GPOs in this domain:'), lv.el)); return {}; } }] }) });
    const wmisNode = () => ({ id: 'gpmc-wmis', label: 'WMI Filters', icon: I.folder,
      children: () => G.wmiFilters().slice().sort((a, b) => a.name.localeCompare(b.name)).map(f => ({ id: 'gpmc-wmi:' + f.id, label: f.name, icon: ICON.wmi, view: () => wmiView(ctl, f),
        menu: () => [{ label: '&Export...', disabled: true }, { separator: true }, { label: '&Delete', action: async () => { if (await ask('Are you sure you want to delete this WMI filter?') === 'OK') { const r = G.removeWmiFilter(f); if (!r.ok) error(r); } } },
          { label: 'Re&name', action: async () => { const n = await WS.ui.inputBox({ title: 'Rename', prompt: 'Name:', value: f.name }); if (n !== null) { const r = G.setWmiFilterProps(f, { name: n }); if (!r.ok) error(r); } } }] })),
      menu: () => [{ label: '&New...', action: () => wmiFilterDialog(null) }, { label: '&Import...', disabled: true }],
      view: () => contentsView(ctl, 'wmis', `WMI Filters in ${dom()}`, I.folder, [{ key: 'name', label: 'Name', width: 200 }, { key: 'description', label: 'Description', width: 240 }, { key: 'author', label: 'Author', width: 190 }, { key: 'modified', label: 'Modified', width: 140, value: f => when(f.modified) }],
        () => G.wmiFilters(), { icon: () => ICON.wmi, activate: f => ctl.open('gpmc-wmi:' + f.id) }) });
    const startersNode = () => ({ id: 'gpmc-starters', label: 'Starter GPOs', icon: I.folder,
      children: () => G.starters().map(s => ({ id: 'gpmc-starter:' + s.id, label: s.name, icon: ICON.starter, view: () => starterView(ctl, s),
        menu: () => [{ label: '&Edit...', disabled: !!s.system, action: () => edit({ starter: s.id }) }, { label: '&New GPO From Starter GPO...', action: () => newGpo({ starter: s.id }) }, { label: '&Back Up...', disabled: true }, { label: 'Save as &Cabinet...', disabled: true }, { label: 'Save &Report...', disabled: true },
          { separator: true }, { label: '&Delete', disabled: !!s.system, action: async () => { if (await ask('Are you sure you want to delete this Starter GPO?') === 'OK') { const r = G.removeStarter(s.id); if (!r.ok) error(r); } } }] })),
      menu: () => (A().starterGpos ? [{ label: '&New', action: () => newStarter() }, { label: '&Load Cabinet...', disabled: true }] : []),
      view: () => (A().starterGpos ? contentsView(ctl, 'starters', `Starter GPOs in ${dom()}`, I.folder, [{ key: 'name', label: 'Name', width: 260 }, { key: 'type', label: 'Starter GPO Type', width: 120, value: s => (s.system ? 'System' : 'Custom') }, { key: 'modified', label: 'Modified', width: 140, value: s => when(s.modified) }],
        () => G.starters(), { icon: () => ICON.starter, activate: s => ctl.open('gpmc-starter:' + s.id) })
        : { render: host => { host.appendChild(h('div.gpmc-pane', h('div.gpmc-head', h('span.gpmc-title', `Starter GPOs in ${dom()}`)), h('div.gpmc-tabbody.w32', h('p', `The Starter GPOs folder does not exist in the domain ${dom()}. Click the button below to create this folder.`), F.button('Create Starter GPOs Folder', () => G.createStarterFolder())))); return {}; } }) });
    const resultsList = kind => results.filter(r => r.kind === kind).map(res => ({ id: 'gpmc-result:' + res.id, label: res.name, icon: kind === 'results' ? ICON.results : ICON.modeling, view: () => resultView(ctl, res),
      menu: () => [{ label: '&Advanced View', disabled: true }, { label: 'Rerun &Query', action: () => { res.rs = res.kind === 'results' ? logged(res) : modeled(res); res.time = new Date().toISOString(); mmc.refresh(); } },
        { label: '&Save Report...', action: () => saveReport('rsop', null, { name: res.name, rs: res.rs }) }, { separator: true },
        { label: '&Delete', action: async () => { if (await ask('Do you want to delete this item?') === 'OK') { results.splice(results.indexOf(res), 1); mmc.refresh(); } } },
        { label: 'Re&name', action: async () => { const n = await WS.ui.inputBox({ title: 'Rename', prompt: 'Name:', value: res.name }); if (n) { res.name = n; mmc.refresh(); } } }] }));
    const noDomain = { render: host => { host.appendChild(h('div.gpmc-pane', h('div.gpmc-head', h('span.gpmc-title', TITLE)), h('div.gpmc-tabbody.w32', h('div.gpmc-error', h('span', { html: WS.ui.icons.error }), h('div', h('b', 'The specified domain either does not exist or could not be contacted.'), h('p', 'Group Policy Management manages the Group Policy objects of an Active Directory domain. Install Active Directory Domain Services and promote this server to a domain controller, then reopen the console.'), F.button('Open Server Manager', () => WS.sm.open('dashboard'))))))); return {}; } };
    mmc = WS.mmc.create({ app: 'gpmc', title: TITLE, icon: ICON.gpmc, width: 1120, height: 700, treeWidth: 280, topics: ['gpo', 'ad', 'system', 'features', 'gpresult', 'gpmc'],
      select: A() ? ['gpmc-root', 'gpmc-forest', 'gpmc-domains', 'gpmc-som:' + WS.ad.root().id] : 'gpmc-root',
      nodes: () => [{ id: 'gpmc-root', label: TITLE, icon: ICON.gpmc, expanded: true,
        children: () => (A() ? [{ id: 'gpmc-forest', label: `Forest: ${dom()}`, icon: ICON.forest, expanded: true,
          children: () => [
            { id: 'gpmc-domains', label: 'Domains', icon: I.folder, expanded: true, children: () => [somNode(WS.ad.root())], menu: () => [{ label: 'Show &Domains...', disabled: true }],
              view: () => contentsView(ctl, 'domains', 'Domains', I.folder, [{ key: 'name', label: 'Name', width: 240 }], () => [{ id: 'd', name: dom(), node: 'gpmc-som:' + WS.ad.root().id }], { icon: () => I.domain }) },
            { id: 'gpmc-sites', label: 'Sites', icon: ICON.sites, menu: () => [{ label: '&Show Sites...', disabled: true }],
              view: () => contentsView(ctl, 'sites', 'Sites', ICON.sites, [{ key: 'name', label: 'Name', width: 240 }], () => [], { empty: 'To show sites, right-click Sites and click Show Sites.' }) },
            { id: 'gpmc-modeling', label: 'Group Policy Modeling', icon: ICON.modeling, children: () => resultsList('modeling'), menu: () => [{ label: 'Group Policy &Modeling Wizard...', action: () => modelingWizard({ console: ctl }) }],
              view: () => contentsView(ctl, 'modeling', 'Group Policy Modeling', ICON.modeling, [{ key: 'name', label: 'Name', width: 260 }, { key: 'time', label: 'Created', width: 160, value: r => when(r.time) }], () => results.filter(r => r.kind === 'modeling'),
                { getId: r => String(r.id), icon: () => ICON.modeling, activate: r => ctl.open('gpmc-result:' + r.id), empty: 'To create a new Group Policy Modeling report, right-click Group Policy Modeling and then click Group Policy Modeling Wizard.' }) },
            { id: 'gpmc-results', label: 'Group Policy Results', icon: ICON.results, children: () => resultsList('results'), menu: () => [{ label: 'Group Policy &Results Wizard...', action: () => resultsWizard({ console: ctl }) }],
              view: () => contentsView(ctl, 'results', 'Group Policy Results', ICON.results, [{ key: 'name', label: 'Name', width: 260 }, { key: 'time', label: 'Created', width: 160, value: r => when(r.time) }], () => results.filter(r => r.kind === 'results'),
                { getId: r => String(r.id), icon: () => ICON.results, activate: r => ctl.open('gpmc-result:' + r.id), empty: 'To create a new Group Policy Results report, right-click Group Policy Results and then click Group Policy Results Wizard.' }) }],
          menu: () => [{ label: '&Search...', action: () => search(ctl) }],
          view: () => contentsView(ctl, 'forest', `Forest: ${dom()}`, ICON.forest, [{ key: 'name', label: 'Name', width: 260 }],
            () => [{ id: 'd', name: 'Domains', node: 'gpmc-domains', icon: I.folder }, { id: 's', name: 'Sites', node: 'gpmc-sites', icon: ICON.sites }, { id: 'm', name: 'Group Policy Modeling', node: 'gpmc-modeling', icon: ICON.modeling }, { id: 'r', name: 'Group Policy Results', node: 'gpmc-results', icon: ICON.results }]) }] : []),
        view: () => (A() ? contentsView(ctl, 'root', TITLE, ICON.gpmc, [{ key: 'name', label: 'Name', width: 260 }], () => [{ id: 'f', name: `Forest: ${dom()}`, node: 'gpmc-forest', icon: ICON.forest }]) : noDomain) }]
    });
    mmc.win.gpmc = ctl;
    if (opts.onCreate) opts.onCreate(ctl);
    return mmc.win;
  }
  function newStarter(o = {}) {
    const name = field('name', F.text({ width: 300 })), comment = field('comment', F.textarea({ rows: 3, width: 300 }));
    return formDialog({ title: 'New Starter GPO', width: 400, onCreate: o.onCreate, content: h('div', F.stack('Name:', name), F.stack('Comment:', comment)), submit: () => G.createStarter(name.value, comment.value) });
  }

  WS.gpmc = { launch, newGpo, linkExisting, deleteLink, deleteGpo, renameGpo, newOU, deleteOU, saveReport, linkNotice, addFiltering, addDelegation, removeDelegation,
    wmiFilterDialog, wmiQueryDialog, backupDialog, manageBackups, restoreWizard, importWizard, pasteGpo, remoteUpdate, resultsWizard, modelingWizard, chooseContainer,
    newStarter, search, clipboard, results, ICON, reportView, somMenu: (som, ctl) => somMenu(ctl, som), linkMenu: (som, g, ctl) => linkMenu(ctl, som, g), gpoMenu: (g, ctl) => gpoMenu(ctl, g) };
  WS.apps.register({ id: 'gpmc', name: TITLE, icon: ICON.gpmc, launch, keywords: ['gpmc', 'gpmc.msc', 'group policy', 'gpo'] });
})();
