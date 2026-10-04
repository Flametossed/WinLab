/* Group Policy Management Editor (GPMC's Edit...), the Local Group Policy Editor (gpedit.msc) and the Group Policy
 * Starter GPO Editor: one editor over WS.gpoCatalog, writing through WS.gpo.
 * WS.gpme.open(gpo | 'local' | { starter: id }, { onCreate }) -> window with win.gpme = { mmc, open(nodeId), target };
 * policyDialog(target, side, key, { onCreate }) / securityDialog(...) open the setting dialogs directly (tests).
 * Node ids: gpme-root, gpme:<catalog node id> (c.sec.pw, u.adm.cp ...). */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, G = WS.gpo, CAT = WS.gpoCatalog;
  const field = (name, control) => { const el = control.input || control; el.dataset.field = name; el.setAttribute('aria-label', name); return control; };
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const ICON = {
    computer: I.computer, user: I.adUser, folder: I.folder,
    security: s16('<path d="M8 1.5l5.5 2v4.2c0 3.2-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.6-5.5-6.8V3.5z" fill="url(#wsg-blue)"/><path d="M5.5 8l1.8 1.8L10.8 6" fill="none" stroke="#fff" stroke-width="1.3"/>'),
    setting: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 5h7M4.5 7.5h7M4.5 10h4.5" stroke="#8a97a6"/>'),
    secSetting: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 4.5h7M4.5 7h7" stroke="#8a97a6"/><path d="M8 8.5l3.5 1.2v1.8c0 1.5-1.5 2.6-3.5 3.2-2-.6-3.5-1.7-3.5-3.2V9.7z" fill="#2f7fd8"/>'),
    admx: s16('<rect x="1.5" y="3" width="13" height="10" rx="1" fill="url(#wsg-folder)" stroke="#c99a00"/><rect x="4" y="6" width="8" height="5" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/>'),
    service: I.service
  };
  const ACCOUNT_LOCAL = { PasswordHistorySize: 'history', MaximumPasswordAge: 'maxAgeDays', MinimumPasswordAge: 'minAgeDays', MinimumPasswordLength: 'minLength', PasswordComplexity: 'complexity', ClearTextPassword: 'reversible', LockoutBadCount: 'lockoutThreshold', LockoutDuration: 'lockoutMinutes', ResetLockoutCount: 'lockoutWindowMinutes' };
  const LOCAL_SKIP = new Set(['c.sec.krb', 'c.sec.evt', 'c.sec.rg', 'c.sec.svc', 'c.sec.reg', 'c.sec.fs', 'c.sec.wired', 'c.sec.wifi']);

  /* ---------------------------------------------------------------- targets: a GPO, the local GPO or a Starter GPO */
  function target(x) {
    if (x && typeof x === 'object' && x.starter) {
      const s = G.starter(x.starter); if (!s) return null;
      return { kind: 'starter', id: 'starter:' + s.id, obj: s, title: 'Group Policy Starter GPO Editor', root: `${s.name} [${WS.sys.fqdn().toUpperCase()}] Starter Group Policy Object`, readOnly: !!s.system,
        get: (side, key) => s[side][key], set: (side, key, v) => G.setStarterSetting(s, side, key, v) };
    }
    if (x === 'local' || (x && G.isLocal(x))) {
      const lg = G.local();
      return { kind: 'local', id: 'local', obj: lg, title: 'Local Group Policy Editor', root: 'Local Computer Policy',
        get: (side, key) => {
          const v = lg[side][key];
          if (v === undefined && side === 'computer' && ACCOUNT_LOCAL[key]) { const p = WS.state.security.policy[ACCOUNT_LOCAL[key]]; return p === undefined ? (key === 'ClearTextPassword' ? false : undefined) : p; }
          return v;
        },
        set: (side, key, v) => G.setSetting('local', side, key, v) };
    }
    const g = G.get(x); if (!g) return null;
    return { kind: 'gpo', id: g.id, obj: g, title: 'Group Policy Management Editor', root: `${g.name} [${WS.sys.fqdn().toUpperCase()}] Policy`,
      get: (side, key) => g[side][key], set: (side, key, v) => G.setSetting(g, side, key, v) };
  }
  const valueText = (t, def) => {
    const side = def.side || 'computer';
    // with no lockout threshold, the duration and reset counter mean nothing: Not Applicable
    if (def.lockout) { const th = t.get(side, 'LockoutBadCount'); if (th === 0) return 'Not Applicable'; if (th === undefined && t.get(side, def.key) === undefined) return 'Not Defined'; }
    return G.display(def, t.get(side, def.key));
  };

  /* ---------------------------------------------------------------- setting dialogs */
  /** Administrative Template policy dialog: Not Configured / Enabled / Disabled, Comment, Supported on, Options, Help,
   *  Previous Setting / Next Setting. */
  function policyDialog(t, side, key, o = {}) {
    const list = o.list || [CAT.get(side, key)];
    let idx = list.findIndex(d => d.key === key);
    const frame = WS.ui.modal({ title: list[idx].name, width: 760, className: 'w32-dlg gpme-dlg', closeValue: false });
    const host = h('div.w32.gpme-pol');
    frame.body.appendChild(host);
    let state, comment, optEls, def, dirty = false, applied = false;
    const applyBtn = h('button.btn', { disabled: true, onClick: () => apply() }, 'Apply');
    const markDirty = () => { dirty = true; applyBtn.disabled = !!t.readOnly; };
    function render() {
      def = list[idx];
      frame.setTitle(def.name);
      U.clear(host);
      const v = t.get(side, def.key);
      state = v ? v.state : 'Not Configured';
      const radios = ['Not Configured', 'Enabled', 'Disabled'].map(s => field(s === 'Not Configured' ? 'notConfigured' : s.toLowerCase(), F.radio('gpme-state', s, state === s, { disabled: !!t.readOnly, onChange: on => { if (on) { state = s; paintOptions(); markDirty(); } } })));
      comment = field('comment', F.textarea({ value: v ? v.comment || '' : '', rows: 3, readOnly: !!t.readOnly }));
      comment.addEventListener('input', markDirty);
      optEls = {};
      const opts = h('div.gpme-opts');
      for (const op of def.options) {
        const cur = v && v.state === 'Enabled' && op.id in v.options ? v.options[op.id] : op.dflt;
        let ctl;
        if (op.type === 'select') ctl = F.select(op.choices.map(c => ({ value: c.value, label: c.label })), cur);
        else if (op.type === 'number') ctl = F.number({ value: cur, min: op.min, max: op.max, width: 110 });
        else if (op.type === 'check') ctl = F.checkbox(op.label, !!cur);
        else if (op.type === 'list') { const vals = Array.isArray(cur) ? cur.slice() : []; ctl = F.button('Show...', () => showContents(op, vals, markDirty)); ctl.values = vals; }
        else ctl = F.text({ value: cur == null ? '' : cur, width: 300 });
        field('opt-' + op.id, ctl);
        (ctl.input || ctl).addEventListener('input', markDirty); (ctl.input || ctl).addEventListener('change', markDirty);
        optEls[op.id] = { op, ctl };
        opts.appendChild(h('div.gpme-opt', op.before ? h('div.fnote', op.before) : null, op.type === 'check' ? ctl : h('label', op.label), op.type === 'check' ? null : ctl));
      }
      if (!def.options.length) opts.appendChild(h('div'));
      const prev = F.button('Previous Setting', () => go(-1), { disabled: idx <= 0 }), next = F.button('Next Setting', () => go(1), { disabled: idx >= list.length - 1 });
      host.append(
        h('div.gpme-polhead', h('span', { html: ICON.setting }), h('span.gpme-pname', def.name), prev, next),
        h('div.gpme-top', h('div.gpme-radios', ...radios), h('div.gpme-right', h('div', 'Comment:'), comment, h('div', 'Supported on:'), h('div.gpme-supported', def.supported))),
        h('div.gpme-bottom', h('div', { style: 'flex:1;display:flex;flex-direction:column' }, h('div.gpme-cap', 'Options:'), opts), h('div', { style: 'flex:1;display:flex;flex-direction:column' }, h('div.gpme-cap', 'Help:'), h('div.gpme-help', def.explain))));
      paintOptions();
      dirty = false; applyBtn.disabled = true;
    }
    function paintOptions() { const opts = host.querySelector('.gpme-opts'); if (opts) opts.classList.toggle('disabled', state !== 'Enabled'); }
    function value() {
      if (state === 'Not Configured') return null;
      const options = {};
      for (const [id, { op, ctl }] of Object.entries(optEls)) options[id] = op.type === 'check' ? ctl.checked : op.type === 'list' ? ctl.values : (ctl.input || ctl).value;
      return { state, options, comment: comment.value };
    }
    async function apply() {
      if (t.readOnly) return true;
      if (!dirty) return true;
      const r = t.set(side, def.key, value());
      if (!r.ok) { await WS.ui.msgbox({ title: def.name, icon: 'error', message: r.error }); return false; }
      applied = true; dirty = false; applyBtn.disabled = true;
      return true;
    }
    async function go(step) { if (!(await apply())) return; idx = Math.max(0, Math.min(list.length - 1, idx + step)); render(); }
    const ok = h('button.btn.primary', { onClick: async () => { if (await apply()) frame.close(applied); } }, 'OK');
    frame.footer.append(ok, h('button.btn', { onClick: () => frame.close(applied) }, 'Cancel'), applyBtn);
    frame.onEscape = () => frame.close(applied);
    render();
    const api = { frame, set(s) { const r = host.querySelector(`[data-field="${s === 'Not Configured' ? 'notConfigured' : s.toLowerCase()}"]`); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); },
      option(id, v) { const e = optEls[id]; if (!e) throw new Error('No option ' + id); if (e.op.type === 'check') e.ctl.checked = v; else if (e.op.type === 'list') { e.ctl.values.length = 0; e.ctl.values.push(...v); } else (e.ctl.input || e.ctl).value = v; markDirty(); },
      comment(v) { comment.value = v; markDirty(); }, ok: () => ok.click(), apply, next: () => go(1), prev: () => go(-1), get def() { return def; } };
    if (o.onCreate) o.onCreate(api);
    return frame.promise;
  }
  function showContents(op, values, onChange) {
    const ta = h('textarea.inp', { rows: 10, spellcheck: false, style: 'width:100%' }); ta.value = values.join('\n');
    field('values', ta);
    return WS.ui.dialog({ title: 'Show Contents', width: 420, content: h('div.w32.gpme-list', h('div', { style: 'margin-bottom:4px' }, op.label + ' (one value per line):'), ta), buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] })
      .then(r => { if (r === 'OK') { values.length = 0; values.push(...ta.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean)); onChange(); } return r; });
  }

  /** Security setting properties: "<name> Properties" with Security Policy Setting (Local Security Setting) and Explain tabs. */
  function securityDialog(t, side, key, o = {}) {
    const def = G.definition(side, key);
    const local = t.kind === 'local';
    const cur = t.get(side, def.key);
    const ui = {};
    const tabs = [{ label: local ? 'Local Security Setting' : 'Security Policy Setting', render: () => {
      const defined = cur !== undefined && cur !== null;
      ui.define = local ? null : field('define', F.checkbox('Define this policy setting' + (def.kind === 'audit' ? 's' : ''), defined));
      const body = h('div.gpme-secbody');
      const v = defined ? cur : def.dflt;
      if (def.kind === 'num') {
        if (def.key === 'MaximumPasswordAge' && v === 0) ui.note = h('div.fnote', 'Password will not expire.');
        ui.num = field('value', F.number({ value: v == null ? def.min : v, min: def.min, max: def.max, width: 90 }));
        body.append(h('div', def.prompt), h('div.gpme-num', ui.num, h('span', def.unit)), ui.note || null);
      } else if (def.kind === 'bool') {
        ui.on = field('enabled', F.radio('gpme-bool', 'Enabled', v !== false)); ui.off = field('disabled', F.radio('gpme-bool', 'Disabled', v === false));
        body.append(ui.on, ui.off);
      } else if (def.kind === 'audit') {
        ui.s = field('success', F.checkbox('Success', !!(v & 1))); ui.f = field('failure', F.checkbox('Failure', !!(v & 2)));
        body.append(h('div', 'Audit these attempts:'), ui.s, ui.f);
      } else if (def.kind === 'accounts') {
        ui.accounts = (Array.isArray(v) ? v : []).slice();
        const box = h('div.gpme-accounts');
        let sel = -1;
        const paint = () => { U.clear(box); ui.accounts.forEach((a, i) => box.appendChild(h('div' + (i === sel ? '.sel' : ''), { onClick: () => { sel = i; paint(); } }, a))); };
        paint();
        ui.add = async picked => {
          const p = picked || await WS.ui.objectPicker({ types: ['user', 'group', 'computer', 'principal'], multi: true });
          if (p) { for (const x of p) { const n = x.principal || x.name; if (!ui.accounts.includes(n)) ui.accounts.push(n); } paint(); sheetRef && sheetRef.setDirty(); }
        };
        ui.remove = () => { if (sel >= 0) { ui.accounts.splice(sel, 1); sel = -1; paint(); sheetRef && sheetRef.setDirty(); } };
        body.append(box, h('div.gpmc-btns', F.button('Add User or Group...', () => ui.add()), F.button('Remove', ui.remove)));
      } else if (def.kind === 'text') { ui.text = field('value', F.text({ value: v || '', width: 330 })); body.append(ui.text); }
      else if (def.kind === 'multitext') { ui.text = field('value', F.textarea({ value: v || '', rows: 8, width: 360 })); body.append(ui.text); }
      else if (def.kind === 'select') { ui.sel = field('value', F.select(def.choices.map(c => ({ value: c.value, label: c.label })), v == null ? def.choices[0].value : v, { width: 340 })); body.append(ui.sel); }
      else if (def.kind === 'service') {
        ui.modes = ['Automatic', 'Manual', 'Disabled'].map(m => field(m.toLowerCase(), F.radio('gpme-svc', m, (v || 'Automatic') === m)));
        body.append(h('div', 'Select service startup mode:'), ...ui.modes, h('div.gpmc-btns', F.button('Edit Security...', () => {}, { disabled: true })));
      }
      const sync = () => body.classList.toggle('disabled', !!ui.define && !ui.define.checked);
      if (ui.define) ui.define.input.addEventListener('change', sync);
      sync();
      return h('div.gpme-sec', h('div.gpme-sechead', h('span', { html: def.kind === 'service' ? I.service : ICON.secSetting }), h('span', def.name)), ui.define, body, def.note ? F.note(def.note) : null);
    }, apply: async () => {
      if (ui.define && !ui.define.checked) { const r = t.set(side, def.key, null); return r.ok ? null : r.error; }
      let v;
      if (def.kind === 'num') { v = Number(ui.num.value); if (!Number.isInteger(v)) return `${def.name} must be a whole number.`; }
      else if (def.kind === 'bool') v = ui.on.checked;
      else if (def.kind === 'audit') v = (ui.s.checked ? 1 : 0) | (ui.f.checked ? 2 : 0);
      else if (def.kind === 'accounts') v = ui.accounts.slice();
      else if (def.kind === 'text' || def.kind === 'multitext') v = ui.text.value;
      else if (def.kind === 'select') v = ui.sel.value;
      else if (def.kind === 'service') v = ['Automatic', 'Manual', 'Disabled'][ui.modes.findIndex(m => m.checked)];
      // the editor's cross-checks, then "Suggested Value Changes"
      if (def.key === 'ResetLockoutCount') { const d = t.get(side, 'LockoutDuration'); if (d && v > d) return 'The reset account lockout counter time must be less than or equal to the account lockout duration.'; }
      if (def.key === 'LockoutDuration' && v !== 0) { const rc = t.get(side, 'ResetLockoutCount'); if (rc && rc > v) return 'The account lockout duration must be greater than or equal to the reset account lockout counter time.'; }
      if (def.key === 'MinimumPasswordAge') { const mx = t.get(side, 'MaximumPasswordAge'); if (mx && v >= mx) return 'The minimum password age must be less than the maximum password age.'; }
      if (def.key === 'MaximumPasswordAge' && v) { const mn = t.get(side, 'MinimumPasswordAge'); if (mn != null && mn >= v) return 'The maximum password age must be greater than the minimum password age.'; }
      if (def.key === 'LockoutBadCount' && v > 0) {
        const extra = ['LockoutDuration', 'ResetLockoutCount'].filter(k => t.get(side, k) == null);
        if (extra.length) {
          const ans = await suggested(def, `${v} invalid logon attempts`, extra.map(k => [CAT.get(side, k).name, 'Not Defined', '10 minutes']), o.onSuggest);
          if (ans !== 'OK') return { ok: false, silent: true };
          for (const k of extra) t.set(side, k, 10);
        }
      }
      const r = t.set(side, def.key, v);
      return r.ok ? null : r.error;
    } }, { label: 'Explain', render: () => h('div.gpme-explain', def.explain || '') }];
    let sheetRef = null;
    return WS.ui.propertySheet({ title: `${def.name} Properties`, width: 440, tabs, errorTitle: def.name, onCreate: s => { sheetRef = s; if (o.onCreate) o.onCreate(s, ui); } });
  }
  function suggested(def, now, rows, onCreate) {
    const table = h('table.gpme-sugg', h('tr', h('th', 'Policy'), h('th', 'Policy Setting'), h('th', 'Suggested Setting')), ...rows.map(r => h('tr', ...r.map(c => h('td', c)))));
    const p = WS.ui.dialog({ title: 'Suggested Value Changes', width: 480, content: h('div.w32', h('div', `Because the value of ${def.name} is now ${now}, the settings for the following items will be changed to suggested values.`), table), buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
    if (onCreate) setTimeout(() => onCreate([...document.querySelectorAll('#dialogs .dlg-shade')].pop()), 0);
    return p;
  }
  /** The root's Properties: General (disable either half), Links, WMI Filter, Comment. */
  function gpoProperties(t, o = {}) {
    const g = t.obj;
    if (t.kind !== 'gpo') return WS.ui.msgbox({ title: t.root, icon: 'info', message: t.kind === 'local' ? 'Local Computer Policy\n\nThe Local Group Policy object applies to this computer and everyone who signs in to it. Domain GPOs override it.' : 'Starter GPOs contain Administrative Template settings only.' });
    const ui = {};
    return WS.ui.propertySheet({ title: `${t.root.replace(/ Policy$/, '')} Properties`, width: 440, onCreate: s => { if (o.onCreate) o.onCreate(s, ui); }, tabs: [
      { label: 'General', render: () => {
        ui.noComputer = field('disableComputer', F.checkbox('Disable Computer Configuration settings', /^(ComputerSettingsDisabled|AllSettingsDisabled)$/.test(g.status)));
        ui.noUser = field('disableUser', F.checkbox('Disable User Configuration settings', /^(UserSettingsDisabled|AllSettingsDisabled)$/.test(g.status)));
        return h('div', F.group('Summary', h('table.gpmc-kv', ...[['Created:', U.fmtDate(new Date(g.created)) + ' ' + U.fmtTime(new Date(g.created), true)], ['Modified:', U.fmtDate(new Date(g.modified)) + ' ' + U.fmtTime(new Date(g.modified), true)],
          ['Revisions:', `${g.computerVersion} (Computer), ${g.userVersion} (User)`], ['Domain:', WS.state.ad.domain], ['Unique name:', g.id]].map(([k, v]) => h('tr', h('td', k), h('td', v))))), ui.noComputer, ui.noUser);
      }, apply: () => { const s = ui.noComputer.checked && ui.noUser.checked ? 'AllSettingsDisabled' : ui.noComputer.checked ? 'ComputerSettingsDisabled' : ui.noUser.checked ? 'UserSettingsDisabled' : 'AllSettingsEnabled'; return s === g.status ? null : G.setStatus(g, s); } },
      { label: 'Links', render: () => {
        let found = [];
        const lv = WS.ui.listView({ columns: [{ key: 'p', label: 'Site, Domain, or OU', width: 260, value: l => G.somPath(l.som) }, { key: 'd', label: 'Domain', width: 110, value: () => WS.state.ad.domain }], rows: () => found, getId: l => l.som.id });
        lv.el.style.height = '220px'; lv.el.style.border = '1px solid #d9d9d9';
        ui.findLinks = () => { found = G.links(g); lv.refresh(); };
        return h('div', F.row('Search in this domain:', h('div.gpmc-inline', F.select([WS.state.ad.domain], WS.state.ad.domain, { width: 150 }), F.button('Find Now', ui.findLinks)), { labelWidth: 140 }), lv.el);
      } },
      { label: 'WMI Filter', render: () => {
        ui.none = field('wmiNone', F.radio('gpme-wmi', 'None', !g.wmiFilter)); ui.this = field('wmiThis', F.radio('gpme-wmi', 'This filter:', !!g.wmiFilter));
        ui.filter = field('wmiFilter', F.select(G.wmiFilters().map(f => ({ value: f.id, label: f.name })), g.wmiFilter || '', { width: 240, disabled: !G.wmiFilters().length }));
        return h('div', F.note('Only one WMI filter can be applied to the Group Policy object.'), ui.none, h('div.gpmc-inline', ui.this, ui.filter));
      }, apply: () => { const want = ui.this.checked ? ui.filter.value || null : null; return want === g.wmiFilter ? null : G.setGpoWmiFilter(g, want); } },
      { label: 'Comment', render: () => { ui.comment = field('comment', F.textarea({ value: g.description, rows: 10, width: 380 })); return h('div', F.note('Comment:'), ui.comment); },
        apply: () => (ui.comment.value === g.description ? null : G.setComment(g, ui.comment.value)) }
    ] });
  }

  /* ---------------------------------------------------------------- editor console */
  const open = new Map();
  function launch(x, opts = {}) {
    const t = target(x);
    if (!t) { WS.ui.msgbox({ title: 'Group Policy Management Editor', icon: 'error', message: 'The Group Policy object could not be found. It may have been deleted.' }); return null; }
    const existing = open.get(t.id);
    if (existing && existing.el.isConnected) { existing.restore(); if (opts.onCreate) opts.onCreate(existing.gpme); return existing; }
    let mmc = null;
    const ctl = { target: t, get mmc() { return mmc; }, open: id => mmc.selectPath(pathTo(id)) };
    const pathTo = id => { const out = []; for (let n = CAT.node(id.replace(/^gpme:/, '')); n; n = CAT.parent(n.id)) if (keep(n)) out.unshift('gpme:' + n.id); return ['gpme-root', ...out]; };
    /** Which catalog nodes this editor shows (the local GPO has no Policies/Preferences level; Starter GPOs only Administrative Templates). */
    function keep(n) {
      if (t.kind === 'local') return !/^[cu]\.pol$/.test(n.id) && !/\.pref/.test(n.id) && !LOCAL_SKIP.has(n.id);
      if (t.kind === 'starter') return /^[cu]$/.test(n.id) || /\.adm/.test(n.id);
      return true;
    }
    const kidsOf = n => n.children.flatMap(c => (keep(c) ? [c] : kidsOf(c)));
    const label = n => (n.id === 'c.sec.ipsec' ? (t.kind === 'local' ? 'IP Security Policies on Local Computer' : `IP Security Policies on Active Directory (${WS.state.ad ? WS.state.ad.domain.toUpperCase() : ''})`) : n.label);
    const icon = n => (/^[c]$/.test(n.id) ? ICON.computer : /^u$/.test(n.id) ? ICON.user : n.id === 'c.sec' || n.id === 'u.sec' ? ICON.security : n.kind === 'admx' || n.kind === 'all' ? ICON.admx : ICON.folder);
    const node = n => ({ id: 'gpme:' + n.id, label: label(n), icon: icon(n), expanded: /^[cu]$/.test(n.id), children: () => kidsOf(n).map(node), view: () => viewFor(n), menu: () => menuFor(n) });
    const prefs = n => n.kind === 'pref' && WS.gpmePrefs && WS.gpmePrefs.handles(n.id);
    const menuFor = n => (n.kind === 'admx' || n.kind === 'all' ? [{ label: 'Filter &Options...', disabled: true }, { label: 'Filter O&n', disabled: true }] : prefs(n) ? WS.gpmePrefs.menu(n, t) : n.kind === 'pref' ? [{ label: '&New', disabled: true }] : []);
    const folderRows = n => kidsOf(n).map(c => ({ kind: 'folder', id: c.id, name: label(c), node: c }));
    function viewFor(n) {
      const side = n.side;
      if (n.kind === 'security') {
        const local = t.kind === 'local';
        return { columns: [{ key: 'name', label: 'Policy', width: 380, value: d => d.name }, { key: 'value', label: local ? 'Security Setting' : 'Policy Setting', width: 260, value: d => valueText(t, d) }],
          rows: () => CAT.inNode(n.id), getId: d => d.key, icon: () => ICON.secSetting, multi: false, sortKey: 'name',
          onActivate: d => securityDialog(t, side, d.key), properties: d => securityDialog(t, side, d.key), menu: () => [] };
      }
      if (n.kind === 'services') {
        return { columns: [{ key: 'name', label: 'Service Name', width: 300, value: s => s.display }, { key: 'startup', label: 'Startup', width: 120, value: s => t.get('computer', 'svc:' + s.name) || 'Not Defined' }, { key: 'perm', label: 'Permission', width: 120, value: s => (t.get('computer', 'svc:' + s.name) ? 'Configured' : 'Not Defined') }],
          rows: () => WS.svc.list(), getId: s => s.name, icon: () => ICON.service, multi: false, sortKey: 'name',
          onActivate: s => securityDialog(t, 'computer', 'svc:' + s.name), properties: s => securityDialog(t, 'computer', 'svc:' + s.name), menu: () => [] };
      }
      if (n.kind === 'admx' || n.kind === 'all') {
        const settingsList = () => (n.kind === 'all' ? CAT.policiesUnder(n.id.replace(/\.all$/, '')) .slice().sort((a, b) => a.name.localeCompare(b.name)) : CAT.inNode(n.id).slice().sort((a, b) => a.name.localeCompare(b.name)));
        const rows = () => [...(n.kind === 'all' ? [] : folderRows(n)), ...settingsList().map(d => ({ kind: 'setting', id: d.key, name: d.name, def: d }))];
        const state = r => { if (r.kind !== 'setting') return ''; const v = t.get(side, r.def.key); return v ? v.state : 'Not configured'; };
        const editRow = r => policyDialog(t, side, r.def.key, { list: settingsList() });
        const columns = [{ key: 'name', label: 'Setting', width: 380 }, { key: 'state', label: 'State', width: 110, value: state }, { key: 'comment', label: 'Comment', width: 160, value: r => (r.kind === 'setting' ? ((t.get(side, r.def.key) || {}).comment || '') : '') }];
        if (n.kind === 'all') columns.push({ key: 'path', label: 'Path', width: 300, value: r => '\\' + CAT.category(r.def).replace(/\//g, '\\') });
        return { columns, rows, getId: r => r.kind + ':' + r.id, icon: r => (r.kind === 'folder' ? I.folder : ICON.setting), multi: false, sortKey: null,
          onActivate: r => (r.kind === 'folder' ? ctl.open('gpme:' + r.id) : editRow(r)),
          menu: rs => (rs.length && rs[0].kind === 'setting' ? [{ label: '&Edit', default: true, action: () => editRow(rs[0]) }, { separator: true }, { label: 'Filter O&n', disabled: true }, { label: 'Filter &Options...', disabled: true }] : []),
          extended: rs => {
            const r = rs[0];
            if (!r || r.kind !== 'setting') return h('div.gpme-ext', h('h3', label(n)), h('div', 'Select an item to view its description.'));
            return h('div.gpme-ext', h('h3', r.def.name), F.link('Edit policy setting', () => editRow(r)), h('div.gpme-req', h('b', 'Requirements:'), h('br'), r.def.supported), h('p', h('b', 'Description:'), h('br'), h('span.gpme-desc', r.def.explain)));
          } };
      }
      if (n.kind === 'info') return { render: host => { host.appendChild(h('div.gpme-info', n.info)); return {}; } };
      if (prefs(n)) { const v = WS.gpmePrefs.view(n, t, ctl); if (v) return v; }
      if (n.kind === 'pref') return { columns: [{ key: 'name', label: 'Name', width: 220 }, { key: 'order', label: 'Order', width: 60 }, { key: 'action', label: 'Action', width: 90 }], rows: () => [], getId: r => r.id, emptyText: 'There are no items to show in this view.\n\n' + n.info };
      if (n.kind === 'empty') return { columns: [{ key: 'name', label: 'Name', width: 300 }], rows: () => [], getId: r => r.id, emptyText: 'There are no items to show in this view.' };
      return { columns: [{ key: 'name', label: 'Name', width: 380 }], rows: () => folderRows(n), getId: r => r.id, icon: r => icon(r.node), multi: false, onActivate: r => ctl.open('gpme:' + r.id) };
    }
    const roots = () => CAT.tree.filter(keep).map(node);
    mmc = WS.mmc.create({ app: 'gpme', title: t.title, icon: ICON.security, width: 1080, height: 680, treeWidth: 330, topics: ['gpo', 'gp', 'services'],
      select: 'gpme-root',
      nodes: () => [{ id: 'gpme-root', label: t.root, icon: t.kind === 'local' ? ICON.computer : ICON.setting, expanded: true, children: roots,
        properties: () => gpoProperties(t), view: { columns: [{ key: 'name', label: 'Name', width: 380 }], rows: () => CAT.tree.filter(keep).map(n => ({ id: n.id, name: n.label, node: n })), getId: r => r.id, icon: r => icon(r.node), multi: false, onActivate: r => ctl.open('gpme:' + r.id) } }],
      onClose: () => open.delete(t.id) });
    mmc.win.gpme = ctl;
    open.set(t.id, mmc.win);
    if (opts.onCreate) opts.onCreate(ctl);
    return mmc.win;
  }

  WS.gpme = { open: launch, policyDialog: (x, side, key, o) => policyDialog(target(x), side, key, o), securityDialog: (x, side, key, o) => securityDialog(target(x), side, key, o),
    properties: (x, o) => gpoProperties(target(x), o), target, ICON };
  WS.apps.register({ id: 'gpme', name: 'Group Policy Management Editor', icon: ICON.security, hidden: true, launch: o => launch(o && o.gpo, o) });
  WS.apps.register({ id: 'gpedit', name: 'Local Group Policy Editor', icon: ICON.security, launch: o => launch('local', o), keywords: ['gpedit', 'gpedit.msc', 'local group policy', 'edit group policy'] });
})();
