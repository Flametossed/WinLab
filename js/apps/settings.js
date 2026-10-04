/* Settings (SystemSettings.exe, ms-settings:): the Windows 11 Settings app as Windows Server 2025 ships it. Pages are named
 * after their ms-settings: URIs. Everything goes through the models, so a change here shows up in PowerShell, sconfig and
 * the classic tools: System (Display, Sound, Notifications, Power, Storage, Remote Desktop, About with Rename this PC),
 * Network & internet (Ethernet with IP/DNS editing, Advanced network settings), Personalization (Background, Colors with
 * Light/Dark mode and accent colour, Taskbar alignment and search), Apps (Installed apps with Uninstall, Startup),
 * Accounts (Your info, Sign-in options > Change password), Time & language (time zone, Sync now, region), Accessibility
 * (Color filters) and Windows Update (check, download and install, restart, update history).
 *   WS.apps.launch('settings', { page }) -> win; win.settings = { page(), go(id), back(), search(text), el }
 *   WS.settings.PAGES (ids and titles); WS.settings.renameDialog({ onCreate }) */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons;
  const gpOn = (side, key) => !!(WS.gpo && WS.gpo.policyEnabled(side, key));
  const s20 = b => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2">${b}</svg>`;
  const IC = {
    app: '<svg viewBox="0 0 32 32"><path d="M16 3l2.2 3.4 4-.8 1 4 3.8 1.6-1.6 3.8 2 3.5-3.6 2.1-.3 4.1-4-.3L16 29l-2.6-3.1-4 .3-.3-4.1L5.5 20l2-3.5L5.9 12.7l3.8-1.6 1-4 4 .8z" fill="#5b6b7d"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="16" cy="16" r="2.6" fill="#2f7fd8"/></svg>',
    system: s20('<rect x="2.5" y="3.5" width="15" height="10" rx="1"/><path d="M7 17h6M10 13.5V17"/>'),
    bluetooth: s20('<path d="M6 6.5l8 7-4 3.5V3l4 3.5-8 7"/>'),
    network: s20('<path d="M10 17a7 7 0 0 0 0-14 7 7 0 0 0 0 14zM3 10h14M10 3c2 2.2 2.8 4.5 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.5-2.8-7S8 5.2 10 3z"/>'),
    personalization: s20('<path d="M4 16c0-2 1.5-3 3-3s2 1 2 2.2C9 17 6.5 17 4 16zM8.5 12.5L16 4.5a1.4 1.4 0 0 1 2 2l-8 7.5"/>'),
    apps: s20('<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>'),
    accounts: s20('<circle cx="10" cy="7" r="3.5"/><path d="M3.5 17c.6-3.4 3.2-5 6.5-5s5.9 1.6 6.5 5"/>'),
    time: s20('<circle cx="10" cy="10" r="7"/><path d="M10 5.5V10l3 2"/>'),
    accessibility: s20('<circle cx="10" cy="4" r="1.6"/><path d="M3.5 7l6.5 1.3L16.5 7M10 8.3v4L7 17.5M10 12.3l3 5.2"/>'),
    privacy: s20('<path d="M10 2.5l6 2.2v4.6c0 3.6-2.5 6.5-6 8.2-3.5-1.7-6-4.6-6-8.2V4.7z"/>'),
    windowsupdate: s20('<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M15 2.5v3.3h-3.3"/>'),
    display: s20('<rect x="2.5" y="3.5" width="15" height="10" rx="1"/><path d="M7 17h6"/>'),
    sound: s20('<path d="M3 8h3l4-3.5v11L6 12H3zM13 7a4 4 0 0 1 0 6M15.5 5a7 7 0 0 1 0 10"/>'),
    notifications: s20('<path d="M10 3a5 5 0 0 0-5 5v3.5L3.5 14h13L15 11.5V8a5 5 0 0 0-5-5zM8 16.5a2 2 0 0 0 4 0"/>'),
    power: s20('<path d="M10 2.5v6M6 4.8a6.5 6.5 0 1 0 8 0"/>'),
    storage: s20('<rect x="2.5" y="6" width="15" height="8" rx="1.2"/><circle cx="14.5" cy="10" r="1"/>'),
    multitasking: s20('<rect x="2.5" y="4" width="7" height="12" rx="1"/><rect x="11.5" y="4" width="6" height="5.5" rx="1"/><rect x="11.5" y="11" width="6" height="5" rx="1"/>'),
    remote: s20('<rect x="2.5" y="3.5" width="15" height="10" rx="1"/><path d="M7 17h6M8 7l-2 2 2 2M12 7l2 2-2 2"/>'),
    clipboard: s20('<rect x="4.5" y="4" width="11" height="13.5" rx="1"/><path d="M7.5 4V2.5h5V4"/>'),
    about: s20('<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.3v.2"/>'),
    ethernet: s20('<rect x="4" y="3" width="12" height="9" rx="1"/><path d="M10 12v3M6 17h8M10 15v2"/>'),
    proxy: s20('<circle cx="10" cy="10" r="7"/><path d="M3 10h14"/>'),
    advanced: s20('<rect x="3" y="4" width="14" height="9" rx="1"/><path d="M7 16.5h6M6 8h8"/>'),
    background: s20('<rect x="2.5" y="4" width="15" height="12" rx="1"/><path d="M2.5 13l4-4 3 3 2.5-2 5.5 4.5"/>'),
    colors: s20('<path d="M10 3a7 7 0 1 0 0 14c1 0 1.5-.7 1.2-1.6-.4-1 .3-2 1.4-2H15a2.5 2.5 0 0 0 2-2.5C17 6 14 3 10 3z"/><circle cx="6.5" cy="9" r="1"/><circle cx="9" cy="6" r="1"/><circle cx="13" cy="7" r="1"/>'),
    themes: s20('<path d="M4 15L13.5 5.5a2 2 0 0 1 3 3L7 18H4z"/>'),
    lock: s20('<rect x="4" y="9" width="12" height="8.5" rx="1"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/>'),
    start: s20('<rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/>'),
    taskbar: s20('<rect x="2.5" y="4" width="15" height="12" rx="1"/><path d="M2.5 13h15"/>'),
    defaultapps: s20('<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 10l2 2 4-4"/>'),
    startup: s20('<path d="M10 3c3 2 4.5 5 4 9l-2 2H8l-2-2C5.5 8 7 5 10 3zM8 16l-1.5 2M12 16l1.5 2"/><circle cx="10" cy="8" r="1.4"/>'),
    signin: s20('<circle cx="7" cy="10" r="3.5"/><path d="M10.5 10h7M15 10v3M17.5 10v2"/>'),
    users: s20('<circle cx="7.5" cy="7.5" r="3"/><path d="M2 16.5c.5-2.8 2.6-4 5.5-4s5 1.2 5.5 4M13 5a2.6 2.6 0 0 1 0 5M14.5 12.6c2 .3 3.2 1.5 3.5 3.9"/>'),
    work: s20('<rect x="2.5" y="6" width="15" height="10.5" rx="1"/><path d="M7 6V3.5h6V6"/>'),
    region: s20('<path d="M3 4h7M6.5 4v-1.5M8.5 4c-.5 3-2.5 5.5-5 7M5 7.5c1 2 2.5 3.3 4 4M10 17l3.5-8 3.5 8M11.2 14.5h4.6"/>'),
    history: s20('<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3v3.3h3.3M10 6.5V10l2.5 1.5"/>'),
    pause: s20('<rect x="5" y="4" width="3" height="12"/><rect x="12" y="4" width="3" height="12"/>'),
    security: s20('<path d="M10 2.5l6 2.2v4.6c0 3.6-2.5 6.5-6 8.2-3.5-1.7-6-4.6-6-8.2V4.7z"/><path d="M7.5 10l2 2 3.5-3.5"/>'),
    general: s20('<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M7 8h6M7 12h4"/>'),
    diag: s20('<path d="M3 15l4-5 3 3 5-7"/>'),
    filters: s20('<circle cx="8" cy="8" r="5"/><circle cx="12" cy="12" r="5"/>'),
    chevron: s20('<path d="M8 5l5 5-5 5"/>'),
    back: s20('<path d="M16 10H4M9 5l-5 5 5 5"/>'),
    search: s20('<circle cx="8.5" cy="8.5" r="5"/><path d="M12.3 12.3l4.2 4.2"/>'),
    more: s20('<circle cx="5" cy="10" r=".8" fill="currentColor"/><circle cx="10" cy="10" r=".8" fill="currentColor"/><circle cx="15" cy="10" r=".8" fill="currentColor"/>'),
    copy: s20('<rect x="6.5" y="6.5" width="10" height="10" rx="1"/><path d="M13.5 6.5V4a.5.5 0 0 0-.5-.5H4a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h2.5"/>'),
    expand: s20('<path d="M5 8l5 5 5-5"/>'),
    sync: s20('<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M15 2.5v3.3h-3.3"/>'),
    pc: '<svg viewBox="0 0 64 48"><rect x="4" y="2" width="56" height="36" rx="3" fill="#2f3b4a"/><rect x="7" y="5" width="50" height="30" rx="1" fill="url(#wsg-blue)"/><path d="M24 46h16M32 38v8" stroke="#2f3b4a" stroke-width="3"/></svg>',
    check: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#0f7b0f"/><path d="M6 10.3l2.6 2.6L14.2 7" fill="none" stroke="#fff" stroke-width="1.7"/></svg>',
    warn: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#c42b1c"/><path d="M10 5.5v5.5M10 13.6v.4" stroke="#fff" stroke-width="1.8"/></svg>',
    restart: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#2f7fd8"/><path d="M14 10a4 4 0 1 1-1.2-2.9M13.2 4.7v2.6h-2.6" fill="none" stroke="#fff" stroke-width="1.5"/></svg>'
  };

  /* ================================================================ page catalogue */
  const NAV = [['system', 'System'], ['bluetooth', 'Bluetooth & devices'], ['network', 'Network & internet'], ['personalization', 'Personalization'], ['apps', 'Apps'],
    ['accounts', 'Accounts'], ['time', 'Time & language'], ['accessibility', 'Accessibility'], ['privacy', 'Privacy & security'], ['windowsupdate', 'Windows Update']];
  // id -> [title, top-level nav id, icon, search keywords]
  const PAGES = {
    system: ['System', 'system', 'system', ''], display: ['Display', 'system', 'display', 'resolution scale monitor brightness'], sound: ['Sound', 'system', 'sound', 'volume speakers audio'],
    notifications: ['Notifications', 'system', 'notifications', 'do not disturb toast'], power: ['Power', 'system', 'power', 'sleep screen'], storagesense: ['Storage', 'system', 'storage', 'disk space drive'],
    multitasking: ['Multitasking', 'system', 'multitasking', 'snap'], remotedesktop: ['Remote Desktop', 'system', 'remote', 'rdp remote desktop nla'], clipboard: ['Clipboard', 'system', 'clipboard', ''],
    about: ['About', 'system', 'about', 'rename pc computer name device specifications windows version build product id'],
    bluetooth: ['Bluetooth & devices', 'bluetooth', 'bluetooth', 'printers mouse'],
    network: ['Network & internet', 'network', 'network', ''], 'network-ethernet': ['Ethernet', 'network', 'ethernet', 'ip address dns static dhcp gateway subnet mac'],
    'network-proxy': ['Proxy', 'network', 'proxy', ''], 'network-advancedsettings': ['Advanced network settings', 'network', 'advanced', 'adapter disable network reset'],
    personalization: ['Personalization', 'personalization', 'personalization', ''], 'personalization-background': ['Background', 'personalization', 'background', 'wallpaper desktop'],
    colors: ['Colors', 'personalization', 'colors', 'dark mode light mode accent color transparency theme'], themes: ['Themes', 'personalization', 'themes', ''],
    lockscreen: ['Lock screen', 'personalization', 'lock', ''], 'personalization-start': ['Start', 'personalization', 'start', ''], taskbar: ['Taskbar', 'personalization', 'taskbar', 'alignment center left search'],
    apps: ['Apps', 'apps', 'apps', ''], appsfeatures: ['Installed apps', 'apps', 'apps', 'uninstall programs'], defaultapps: ['Default apps', 'apps', 'defaultapps', ''], startupapps: ['Startup', 'apps', 'startup', 'startup apps'],
    accounts: ['Accounts', 'accounts', 'accounts', ''], yourinfo: ['Your info', 'accounts', 'accounts', ''], signinoptions: ['Sign-in options', 'accounts', 'signin', 'password change'],
    otherusers: ['Other users', 'accounts', 'users', 'add user'], workplace: ['Access work or school', 'accounts', 'work', ''],
    time: ['Time & language', 'time', 'time', ''], dateandtime: ['Date & time', 'time', 'time', 'time zone clock sync ntp'], regionlanguage: ['Language & region', 'time', 'region', 'language country region format'],
    accessibility: ['Accessibility', 'accessibility', 'accessibility', ''], colorfilters: ['Color filters', 'accessibility', 'filters', 'grayscale'],
    privacy: ['Privacy & security', 'privacy', 'privacy', ''], 'privacy-general': ['General', 'privacy', 'general', ''], 'privacy-feedback': ['Diagnostics & feedback', 'privacy', 'diag', 'telemetry'],
    windowsupdate: ['Windows Update', 'windowsupdate', 'windowsupdate', 'updates patch check for updates'], 'windowsupdate-history': ['Update history', 'windowsupdate', 'history', 'installed updates kb'],
    'windowsupdate-options': ['Advanced options', 'windowsupdate', 'advanced', 'active hours']
  };
  const ALIAS = { home: 'system', 'network-status': 'network', 'personalization-colors': 'colors', 'appsfeatures-app': 'appsfeatures', 'storage': 'storagesense', 'easeofaccess': 'accessibility',
    'easeofaccess-colorfilter': 'colorfilters', 'windowsupdate-action': 'windowsupdate', 'otherusers-add': 'otherusers', 'display-advanced': 'display', 'powersleep': 'power', 'activation': 'about',
    'network-adapter': 'network-advancedsettings', 'privacy-diagnostics': 'privacy-feedback' };
  const norm = id => { id = String(id || 'system').replace(/^ms-settings:/i, '').toLowerCase() || 'system'; id = ALIAS[id] || id; return PAGES[id] ? id : 'system'; };

  /* ================================================================ small controls */
  function toggle(on, onChange, o = {}) {
    const b = h('button.toggle' + (on ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!on), disabled: !!o.disabled, dataset: { field: o.field || '' } }, h('i'));
    const lbl = h('span.st-tlabel', on ? 'On' : 'Off');
    b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); lbl.textContent = v ? 'On' : 'Off'; onChange(v); });
    return h('span.st-toggle', lbl, b);
  }
  function select(options, value, onChange, o = {}) {
    const s = h('select.st-select', { disabled: !!o.disabled, dataset: { field: o.field || '' } }, ...options.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
    if (onChange) s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  const btn = (label, fn, o = {}) => h('button.st-btn' + (o.primary ? '.primary' : ''), { disabled: !!o.disabled, dataset: { action: o.action || label }, onClick: e => { e.stopPropagation(); fn(); } }, label);
  const link = (label, fn) => h('a.st-link', { href: '#', onClick: e => { e.preventDefault(); fn(); } }, label);
  /** A settings row: icon, title + description, something on the right (control, value), optional click-through. */
  function card(o) {
    const el = h('div.st-card' + (o.go ? '.click' : '') + (o.cls ? '.' + o.cls : ''), { dataset: { card: o.id || o.title } },
      o.icon ? h('span.st-cicon', { html: IC[o.icon] || o.icon }) : null,
      h('div.st-ctext', h('div.st-ctitle', o.title), o.desc ? h('div.st-cdesc', o.desc) : null),
      o.right != null ? h('div.st-cright', o.right) : null,
      o.go ? h('span.st-chev', { html: IC.chevron }) : null);
    if (o.go) el.addEventListener('click', e => { if (!e.target.closest('button, select, input, a')) o.go(); });
    return el;
  }
  const group = (...cards) => h('div.st-group', ...cards.filter(Boolean));
  const h3 = t => h('h3.st-h3', t);
  const managedNote = text => h('div.st-managed', text || '*Some of these settings are managed by your organization.');
  /** Two-column read-only properties, as Settings lists them under a card, with Copy. */
  function props(rows, copyLabel = 'Copy') {
    const text = rows.map(([k, v]) => `${k}\t${v}`).join('\n');
    return h('div.st-props', ...rows.map(([k, v]) => h('div.st-prow', h('span', k), h('span', { dataset: { prop: k } }, String(v)))),
      h('div.st-props-copy', btn(copyLabel, () => { try { navigator.clipboard.writeText(text); } catch (e) { /* clipboard may be blocked */ } })));
  }
  /** Expandable card (Settings' expanders). */
  function expander(o) {
    const body = h('div.st-exbody', ...(o.body || []));
    const head = card({ ...o, right: h('span.st-exright', o.right || null, h('span.st-exchev', { html: IC.expand })) });
    const el = h('div.st-expander' + (o.open ? '.open' : ''), head, body);
    head.addEventListener('click', e => { if (!e.target.closest('button, select, input, a')) el.classList.toggle('open'); });
    return el;
  }

  /** A Windows 11 content dialog on the #dialogs layer. buttons: [{ label, primary, value }] -> Promise(value) */
  function contentDialog({ title, body, buttons, onCreate, cls }) {
    return new Promise(resolve => {
      let layer = document.getElementById('dialogs');
      if (!layer) { layer = h('div', { id: 'dialogs' }); document.getElementById('screen').appendChild(layer); }
      let shade;
      const close = v => { document.removeEventListener('keydown', key, true); shade.remove(); resolve(v); };
      const btns = buttons.map(b => h('button.st-btn' + (b.primary ? '.primary' : ''), { disabled: !!b.disabled, onClick: async () => { if (b.validate && !(await b.validate())) return; close(b.value !== undefined ? b.value : b.label); } }, b.label));
      const key = e => {
        if (!shade.isConnected) return;
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { const p = buttons.findIndex(b => b.primary); if (p >= 0 && !btns[p].disabled) { e.preventDefault(); btns[p].click(); } }
      };
      shade = h('div.dlg-shade.st-shade', h('div.st-dialog' + (cls ? '.' + cls : ''), h('h2', title), h('div.st-dbody', ...[].concat(body)), h('div.st-dbtns', ...btns)));
      layer.appendChild(shade);
      document.addEventListener('keydown', key, true);
      setTimeout(() => { const f = shade.querySelector('input:not([disabled]), select'); if (f) f.focus(); }, 30);
      if (onCreate) onCreate({ el: shade, buttons: btns, close });
    });
  }

  /* ================================================================ the window */
  function launch(args = {}) {
    const win = WS.wm.create({ app: 'settings', title: 'Settings', icon: IC.app, width: 1040, height: 700 });
    win.el.classList.add('themed');
    const content = h('div.st-content');
    const crumbs = h('h1.st-crumbs');
    const navEl = h('nav.st-nav');
    const results = h('div.st-results');
    const search = h('input.st-search', { placeholder: 'Find a setting', spellcheck: false });
    search.dataset.field = 'search';
    const backBtn = h('button.st-backbtn', { html: IC.back, title: 'Back', onClick: () => back() });
    const userTile = h('div.st-user');
    const root = h('div.st',
      h('div.st-top', backBtn, h('span', 'Settings')),
      h('div.st-main',
        h('div.st-side', userTile, h('div.st-searchbox', search, h('span.st-sico', { html: IC.search }), results), navEl),
        h('div.st-page', crumbs, content)));
    win.body.appendChild(root);
    let page = null;
    const history = [];
    const timers = [];
    const clearTimers = () => { while (timers.length) clearInterval(timers.pop()); };
    win.onClose(clearTimers);

    function paintUser() {
      const dc = WS.sys.isDC();
      U.clear(userTile).append(h('span.st-avatar', { html: I.user }), h('div', h('b', 'Administrator'), h('small', dc ? `${WS.sys.netbiosDomain()}\\Administrator` : 'Local Account')));
      userTile.onclick = () => go('yourinfo');
    }
    function paintNav() {
      U.clear(navEl);
      const top = PAGES[page][1];
      for (const [id, label] of NAV) navEl.appendChild(h('button.st-navitem' + (id === top ? '.sel' : ''), { dataset: { nav: id }, onClick: () => go(id) }, h('span.st-nico', { html: IC[id] }), label));
    }
    function go(id, opts = {}) {
      const next = norm(id);
      if (page && !opts.noHistory && page !== next) history.push(page);
      page = next;
      clearTimers();
      paintNav();
      paintUser();
      backBtn.disabled = !history.length;
      const [title, top] = PAGES[page];
      U.clear(crumbs);
      if (page === top) crumbs.append(title);
      else crumbs.append(h('a.st-crumb', { href: '#', onClick: e => { e.preventDefault(); go(top); } }, PAGES[top][0]), h('span.st-sep', { html: IC.chevron }), title);
      U.clear(content);
      // Prohibit access to Control Panel and PC settings closes Settings; Disable the Display Control Panel blocks Display
      const render = RENDER[page] || placeholder;
      try { content.append(...[render(ctx)].flat(4).filter(Boolean)); } catch (e) { console.error(e); content.append(h('p', 'This page could not be shown.')); }
      content.scrollTop = 0;
      win.setTitle('Settings');
      return page;
    }
    function back() { if (!history.length) return; go(history.pop(), { noHistory: true }); }
    const ctx = { go, repaint: () => go(page, { noHistory: true }), win, every: (fn, ms) => { timers.push(setInterval(fn, ms)); } };

    /* ---- search ---- */
    const runSearch = () => {
      const q = search.value.trim().toLowerCase();
      U.clear(results);
      results.classList.toggle('open', !!q);
      if (!q) return [];
      const hits = Object.entries(PAGES).filter(([id, [title, , , kw]]) => title.toLowerCase().includes(q) || kw.includes(q) || id.includes(q)).slice(0, 8);
      if (!hits.length) results.append(h('div.st-noresult', 'No results'));
      for (const [id, [title]] of hits) results.append(h('div.st-result', { dataset: { page: id }, onClick: () => { search.value = ''; runSearch(); go(id); } }, h('span', { html: IC[PAGES[id][2]] || IC.system }), title));
      return hits.map(x => x[0]);
    };
    search.addEventListener('input', runSearch);
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = results.querySelector('.st-result'); if (f) f.click(); } if (e.key === 'Escape') { search.value = ''; runSearch(); } });
    search.addEventListener('blur', () => setTimeout(() => results.classList.remove('open'), 150));

    win.listen('system', () => { if (['about', 'remotedesktop', 'dateandtime'].includes(page)) ctx.repaint(); paintUser(); });
    win.listen('network', () => { if (page.startsWith('network')) ctx.repaint(); });
    win.listen('updates', () => { if (page.startsWith('windowsupdate')) ctx.repaint(); });
    win.listen('programs', () => { if (page === 'appsfeatures') ctx.repaint(); });
    win.listen('gpresult', () => ctx.repaint());
    win.settings = { page: () => page, go, back, search: t => { search.value = t; return runSearch(); }, el: root };
    go(args.page || 'system', { noHistory: true });
    return win;
  }

  /* ================================================================ pages */
  const placeholder = ctx => [h('div.st-placeholder', h('p', 'This page is not part of the lab simulator yet.'), h('p.st-dim', 'The settings that labs use are under System, Network & internet, Personalization, Apps, Accounts, Time & language and Windows Update.'))];
  const listPage = (...items) => ctx => [group(...items.map(([id, desc]) => card({ title: PAGES[id][0], desc, icon: PAGES[id][2], go: () => ctx.go(id), id })))];

  const RENDER = {};
  /* ---------------- System ---------------- */
  RENDER.system = ctx => {
    const s = WS.state.system;
    return [
      h('div.st-hero', h('span.st-pc', { html: IC.pc }), h('div', h('div.st-hero-name', s.computerName), h('div.st-dim', 'Virtual Machine'), link('Rename', () => renameDialog())),
        h('div.st-hero-right', card({ title: 'Windows Update', desc: WS.wu && WS.wu.state().status === 'restart' ? 'Restart required' : `Last checked: ${lastChecked()}`, icon: 'windowsupdate', go: () => ctx.go('windowsupdate') }))),
      listPage(['display', 'Monitors, brightness, night light, display profile'], ['sound', 'Volume levels, output, input, sound devices'], ['notifications', 'Alerts from apps and system, do not disturb'],
        ['power', 'Screen and sleep'], ['storagesense', 'Storage space, drives, configuration rules'], ['multitasking', 'Snap windows, desktops, task switching'],
        ['remotedesktop', 'Enable and configure Remote Desktop'], ['clipboard', 'Cut and copy history, sync, clear'], ['about', 'Device specifications, rename PC, Windows specifications'])(ctx)
    ];
  };
  RENDER.display = ctx => {
    const blocked = gpOn('user', 'NoDispCPL');
    const sc = document.getElementById('screen');
    const res = `${sc.clientWidth} \u00d7 ${sc.clientHeight}`;
    return [blocked ? managedNote() : null,
      h3('Scale & layout'),
      group(card({ title: 'Scale', desc: 'Change the size of text, apps, and other items', icon: 'display', right: select(['100% (Recommended)', '125%', '150%'], '100% (Recommended)', null, { disabled: true }) }),
        card({ title: 'Display resolution', desc: 'Adjust the resolution to fit your connected display', icon: 'display', right: select([`${res} (Recommended)`], `${res} (Recommended)`, null, { disabled: true }) }),
        card({ title: 'Display orientation', icon: 'display', right: select(['Landscape', 'Portrait'], 'Landscape', null, { disabled: true }) })),
      h('p.st-dim', 'The lab runs on the Microsoft Hyper-V Video adapter: resolution follows the size of the browser window.'),
      h3('Related settings'),
      group(card({ title: 'Advanced display', desc: 'Display information, refresh rate', icon: 'display' }))];
  };
  RENDER.sound = ctx => {
    const v = WS.shell.volume ? WS.shell.volume() : { level: 50, muted: false };
    const slider = h('input.st-range', { type: 'range', min: 0, max: 100, value: v.level });
    slider.dataset.field = 'volume';
    slider.addEventListener('input', () => WS.shell.setVolume && WS.shell.setVolume(+slider.value, false));
    return [h3('Output'), group(card({ title: 'Speakers', desc: 'Microsoft Hyper-V Audio', icon: 'sound' }), card({ title: 'Volume', icon: 'sound', right: slider }),
      card({ title: 'Mute', icon: 'sound', right: toggle(v.muted, on => WS.shell.setVolume && WS.shell.setVolume(+slider.value, on), { field: 'mute' }) }))];
  };
  RENDER.notifications = ctx => {
    const p = WS.personal.get();
    const off = gpOn('user', 'DisableNotificationCenter');
    return [off ? managedNote() : null,
      group(card({ title: 'Notifications', desc: 'Get notifications from apps and other senders', icon: 'notifications', right: toggle(p.notifications, v => WS.personal.set({ notifications: v }), { field: 'notifications' }) }),
        card({ title: 'Do not disturb', desc: 'Notifications will be sent directly to notification center', icon: 'notifications', right: toggle(p.dnd, v => { WS.personal.set({ dnd: v }); WS.shell.refreshTray(); }, { field: 'dnd' }) })),
      h3('Notifications from apps and other senders'),
      group(card({ title: 'Lab Guide', desc: 'Banners, Sounds', icon: I.lab }), card({ title: 'Windows Update', desc: 'Banners, Sounds', icon: 'windowsupdate' }))];
  };
  RENDER.power = ctx => {
    const p = WS.state.personal.power = WS.state.personal.power || { screen: '10', sleep: 'never' };
    const opts = [['1', '1 minute'], ['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['never', 'Never']];
    const save = (k, v) => { p[k] = v; WS.store.changed('personal'); };
    return [h3('Screen and sleep'), group(
      card({ title: 'When plugged in, turn off my screen after', icon: 'power', right: select(opts, p.screen, v => save('screen', v), { field: 'screen' }) }),
      card({ title: 'When plugged in, put my device to sleep after', icon: 'power', right: select(opts, p.sleep, v => save('sleep', v), { field: 'sleep' }) }))];
  };
  RENDER.storagesense = ctx => {
    const vols = WS.storage.volumes().filter(v => v.letter && v.fs);
    return [h3('Local storage'), group(...vols.map(v => {
      const pct = v.size ? Math.round(v.used / v.size * 100) : 0;
      return card({ title: `${v.label || 'Local Disk'} (${v.letter}:)`, icon: 'storage', id: 'vol-' + v.letter,
        desc: h('div', h('div.st-bar', h('i', { style: { width: pct + '%' } })), h('div.st-dim', `${U.fmtBytes(v.used)} used of ${U.fmtBytes(v.size)} \u00b7 ${U.fmtBytes(v.free)} free`)) });
    })),
    h3('Storage management'),
    group(card({ title: 'Advanced storage settings', desc: 'Disks & volumes, backup options', icon: 'storage', go: () => WS.apps.launch('diskmgmt') }))];
  };
  RENDER.multitasking = ctx => {
    const sp = WS.personal.snap();
    const save = patch => WS.personal.set({ snap: patch });
    const opt = (field, label) => h('label.st-check', h('input', { type: 'checkbox', checked: sp[field], disabled: !sp.enabled, dataset: { field: 'snap-' + field },
      onChange: e => save({ [field]: e.target.checked }) }), label);
    return [group(
      expander({ title: 'Snap windows', desc: 'Resize windows automatically or with snap layouts', icon: 'multitasking', open: true, id: 'snap',
        right: toggle(sp.enabled, v => { save({ enabled: v }); ctx.repaint(); }, { field: 'snap' }),
        body: [h('div.st-checks',
          opt('hoverMax', 'Show snap layouts when I hover over a window\u2019s maximize button'),
          opt('dragTop', 'Show snap layouts when I drag a window to the top of my screen'),
          opt('groups', 'Show my snapped windows when I hover over taskbar apps, in Task View, and when I press Alt+Tab'),
          opt('assist', 'When I snap a window, suggest what I can snap next to it'),
          opt('nearEdge', 'When I drag a window, let me snap it without dragging all the way to the screen edge'))] }),
      card({ title: 'Title bar window shake', desc: 'When I grab a window\u2019s title bar and shake it, minimize all other windows', icon: 'multitasking',
        right: toggle(sp.shake, v => save({ shake: v }), { field: 'shake' }) }),
      card({ title: 'Desktops', desc: 'On the taskbar, show all the open windows', icon: 'multitasking', right: select(['Only on the desktop I\u2019m using', 'On all desktops'], 'Only on the desktop I\u2019m using', null, { disabled: true }) }),
      card({ title: 'Alt + Tab', desc: 'Pressing Alt + Tab shows', icon: 'multitasking', right: select(['Open windows only'], 'Open windows only', null, { disabled: true }) }))];
  };
  RENDER.remotedesktop = ctx => {
    const s = WS.state.system;
    const nla = h('label.st-check', h('input', { type: 'checkbox', checked: s.rdpNla, disabled: !s.rdpEnabled, dataset: { field: 'nla' },
      onChange: e => WS.sys.setRemoteDesktop(s.rdpEnabled, e.target.checked) }), 'Require devices to use Network Level Authentication to connect (Recommended)');
    const tg = toggle(s.rdpEnabled, async v => {
      if (v) {
        const r = await contentDialog({ title: 'Enable Remote Desktop?', body: h('p', 'You\u2019ll be able to connect to and control this PC from a remote device using a Remote Desktop client (Microsoft Remote Desktop app or Remote Desktop Connection). Remote Desktop users can control this PC.'),
          buttons: [{ label: 'Confirm', primary: true, value: true }, { label: 'Cancel', value: false }] });
        if (!r) return ctx.repaint();
      }
      WS.sys.setRemoteDesktop(v);
      ctx.repaint();
    }, { field: 'rdp' });
    return [group(card({ title: 'Remote Desktop', desc: 'Connect to and use this PC from another device using the Remote Desktop app', icon: 'remote', right: tg }),
      s.rdpEnabled ? h('div.st-card.st-sub', nla) : null,
      s.rdpEnabled ? card({ title: 'Remote Desktop port', icon: 'remote', right: h('span.st-dim', '3389') }) : null),
      s.rdpEnabled ? h('p.st-dim', `Use this PC name to connect from your remote device: ${WS.sys.fqdn()}`) : null,
      group(card({ title: 'Remote Desktop users', icon: 'users', go: () => WS.cpl.rdpUsers() }))];
  };
  RENDER.about = ctx => {
    const s = WS.state.system;
    const id = n => U.hashStr(s.installDate + n).toString(16).padStart(8, '0').toUpperCase();
    const deviceId = `${id('a')}-${id('b').slice(0, 4)}-${id('c').slice(0, 4)}-${id('d').slice(0, 4)}-${id('e')}${id('f').slice(0, 4)}`;
    const installed = new Date(s.installDate);
    return [
      h('div.st-hero', h('span.st-pc', { html: IC.pc }), h('div', h('div.st-hero-name', s.computerName), h('div.st-dim', 'Virtual Machine'),
        s.pendingComputerName ? h('div.st-pending', `This PC will be renamed to ${s.pendingComputerName} after you restart.`) : null),
        h('div.st-hero-right', btn('Rename this PC', () => renameDialog(), { action: 'rename' }))),
      expander({ title: 'Device specifications', icon: 'about', open: true, body: [props([
        ['Device name', s.computerName], ['Full device name', WS.sys.fqdn()], ['Processor', 'Intel(R) Xeon(R) CPU E5-2673 v4 @ 2.30GHz   2.29 GHz'], ['Installed RAM', '4.00 GB'],
        ['Device ID', deviceId], ['Product ID', '00454-40000-00001-AA000'], ['System type', '64-bit operating system, x64-based processor'],
        ['Pen and touch', 'No pen or touch input is available for this display']]),
        h('div.st-related', h('span', 'Related links'), link('Domain or workgroup', () => WS.apps.launch('sysdm', { tab: 'name' })), link('System protection', () => WS.apps.launch('sysdm', { tab: 'advanced' })), link('Advanced system settings', () => WS.apps.launch('sysdm', { tab: 'advanced' })))] }),
      expander({ title: 'Windows specifications', icon: 'about', open: true, body: [props([
        ['Edition', s.edition], ['Version', '24H2'], ['Installed on', U.fmtDate(installed)], ['OS build', s.build]])] }),
      h3('Related'),
      group(card({ title: 'Product key and activation', desc: 'Change product key or upgrade your edition of Windows', icon: 'security' }),
        card({ title: 'Remote desktop', desc: 'Control this device from another device', icon: 'remote', go: () => ctx.go('remotedesktop') }),
        card({ title: 'Device Manager', desc: 'Printer and other drivers, hardware properties', icon: 'system', go: () => WS.apps.launch('devmgmt') }))
    ];
  };

  /** Rename your PC: name check, then Restart now / Restart later. */
  async function renameDialog(o = {}) {
    const s = WS.state.system;
    const input = h('input.st-input', { value: '', spellcheck: false, placeholder: 'New PC name' });
    input.dataset.field = 'newname';
    const err = h('div.st-err');
    const next = await contentDialog({ title: 'Rename your PC', cls: 'rename',
      body: [h('p', 'You can use a combination of letters, hyphens, and numbers.'), h('p.st-dim', `Current PC name: ${s.computerName}`), input, err],
      buttons: [{ label: 'Next', primary: true, value: true, validate: () => {
        const n = input.value.trim();
        const bad = U.validateComputerName(n) || (/[^A-Za-z0-9-]/.test(n) ? 'Your PC name can only include letters, hyphens and numbers.' : null) || (n.toUpperCase() === s.computerName ? 'Your PC already has this name.' : null);
        err.textContent = bad || '';
        return !bad;
      } }, { label: 'Cancel', value: false }],
      onCreate: d => { if (o.onCreate) o.onCreate({ ...d, input, err, stage: 'name' }); } });
    if (!next) return false;
    const n = input.value.trim().toUpperCase();
    const r = WS.sys.rename(n);
    if (!r.ok) { await WS.ui.msgbox({ title: 'Rename your PC', icon: 'error', message: r.error }); return false; }
    const now = await contentDialog({ title: 'Restart your PC to apply these changes', body: [h('p', `Rename this PC from ${s.computerName} to ${n}.`), h('p.st-dim', 'Save your work and close any open apps before you restart.')],
      buttons: [{ label: 'Restart now', primary: true, value: true }, { label: 'Restart later', value: false }],
      onCreate: d => { if (o.onCreate) o.onCreate({ ...d, stage: 'restart' }); } });
    if (now) WS.shell.restart();
    return true;
  }

  /* ---------------- Network & internet ---------------- */
  const adapterInfo = () => {
    const a = WS.net.adapter();
    const conn = WS.ncpa ? WS.ncpa.connectivity(a) : 'Internet';
    const name = WS.ncpa ? WS.ncpa.networkName(a) : 'Network';
    return { a, conn, name, up: a.enabled && a.connected && WS.net.usable(a) };
  };
  RENDER.network = ctx => {
    const { a, conn, name, up } = adapterInfo();
    return [
      h('div.st-netbanner', h('span.st-netico', { html: IC.ethernet }), h('div', h('div.st-hero-name', a.name), h('div.st-dim', up ? `${name} \u00b7 ${conn === 'Internet' ? 'Connected' : 'No internet'}` : !a.enabled ? 'Disabled' : 'Not connected')),
        h('div.st-hero-right', card({ title: 'Properties', desc: WS.fw ? `${WS.fw.activeProfile()} network` : '', icon: 'ethernet', go: () => ctx.go('network-ethernet') }))),
      group(card({ title: 'Ethernet', desc: 'Authentication, IP and DNS settings, metered network', icon: 'ethernet', go: () => ctx.go('network-ethernet') }),
        card({ title: 'Proxy', desc: 'Proxy server for Wi-Fi and Ethernet connections', icon: 'proxy', go: () => ctx.go('network-proxy') }),
        card({ title: 'Advanced network settings', desc: 'View all network adapters, network reset', icon: 'advanced', go: () => ctx.go('network-advancedsettings') }))];
  };
  RENDER['network-ethernet'] = ctx => {
    const { a, up } = adapterInfo();
    const dc = WS.sys.isDC();
    const cat = WS.fw ? WS.fw.activeProfile() : 'Public';
    const profile = dc ? card({ title: 'Network profile type', desc: 'Domain network', icon: 'ethernet' })
      : card({ title: 'Network profile type', icon: 'ethernet', right: h('div.st-radios',
        ...[['Public', 'Public network (Recommended)', 'Your device is not discoverable on the network.'], ['Private', 'Private network', 'Your device is discoverable on the network.']].map(([v, l, d]) =>
          h('label.st-radio', h('input', { type: 'radio', name: 'netcat', checked: cat === v, dataset: { field: 'category-' + v.toLowerCase() }, onChange: () => { WS.fw.setNetworkCategory(v); ctx.repaint(); } }), h('span', h('b', l), h('small', d))))) });
    const dns = WS.net.dnsServers ? WS.net.dnsServers() : a.dnsServers;
    const rows = [['Link speed (Receive/Transmit):', '10000/10000 (Mbps)'], ['Link-local IPv6 address:', a.linkLocal6 || ''],
      ['IPv4 address:', up && a.ip ? a.ip : ''], ['IPv4 DNS servers:', (dns || []).join('\n') || ''],
      WS.state.system.domain ? ['Primary DNS suffix:', WS.state.system.domain] : null,
      ['Manufacturer:', 'Microsoft'], ['Description:', a.description], ['Driver version:', '10.0.26100.1'], ['Physical address (MAC):', a.mac]].filter(Boolean);
    return [
      group(profile,
        card({ title: 'IP assignment:', desc: a.dhcp ? 'Automatic (DHCP)' : 'Manual', icon: 'ethernet', id: 'ip', right: btn('Edit', () => editIp(ctx), { action: 'edit-ip' }) }),
        !a.dhcp ? h('div.st-card.st-sub', props([['IPv4 address:', a.ip], ['IPv4 mask:', U.prefixToMask(a.prefix)], ['IPv4 gateway:', a.gateway || '']], 'Copy')) : null,
        card({ title: 'DNS server assignment:', desc: a.dnsDhcp ? 'Automatic (DHCP)' : 'Manual', icon: 'ethernet', id: 'dns', right: btn('Edit', () => editDns(ctx), { action: 'edit-dns' }) }),
        h('div.st-card.st-sub', props(rows))),
      h3('Related settings'),
      group(card({ title: 'More network adapter options', icon: 'advanced', go: () => WS.apps.launch('ncpa') }))];
  };

  /** Edit IP settings: Automatic (DHCP) or Manual with the IPv4 fields; saved through WS.net, as ncpa.cpl and New-NetIPAddress do. */
  function editIp(ctx, o = {}) {
    const a = WS.net.adapter();
    const mode = select([['dhcp', 'Automatic (DHCP)'], ['manual', 'Manual']], a.dhcp ? 'dhcp' : 'manual', () => paint(), { field: 'ipmode' });
    const f = (label, value, field) => { const i = h('input.st-input', { value: value || '', spellcheck: false }); i.dataset.field = field; return [h('label.st-flabel', label), i]; };
    const dns = a.dnsServers || [];
    const [lIp, ip] = f('IP address', a.dhcp ? '' : a.ip, 'ip'), [lMask, mask] = f('Subnet mask', a.dhcp ? '' : U.prefixToMask(a.prefix), 'mask'), [lGw, gw] = f('Gateway', a.dhcp ? '' : a.gateway, 'gateway');
    const [lD1, d1] = f('Preferred DNS', a.dnsDhcp ? '' : dns[0], 'dns1'), [lD2, d2] = f('Alternate DNS', a.dnsDhcp ? '' : dns[1], 'dns2');
    const manual = h('div.st-fields', h('div.st-fhead', 'IPv4'), lIp, ip, lMask, mask, lGw, gw, lD1, d1, lD2, d2);
    const err = h('div.st-err');
    const paint = () => { manual.style.display = mode.value === 'manual' ? '' : 'none'; };
    paint();
    return contentDialog({ title: 'Edit IP settings', cls: 'editip', body: [mode, manual, err],
      buttons: [{ label: 'Save', primary: true, value: true, validate: async () => {
        err.textContent = '';
        if (mode.value === 'dhcp') { WS.net.setDhcp(a.name); WS.net.setDnsServers(a.name, null); return true; }
        const chk = WS.net.checkStatic({ ip: ip.value.trim(), mask: mask.value.trim(), gateway: gw.value.trim() });
        if (!chk.ok) { err.textContent = chk.error; return false; }
        const servers = [d1.value.trim(), d2.value.trim()].filter(Boolean);
        const badDns = servers.find(x => !U.isValidIp(x));
        if (badDns) { err.textContent = `The address ${badDns} is not a valid DNS server address.`; return false; }
        if (chk.warnings.length && (await WS.ui.msgbox({ title: 'Settings', icon: 'warning', message: chk.warnings[0], buttons: ['Yes', 'No'] })) !== 'Yes') return false;
        const r = WS.net.setStatic(a.name, { ip: chk.ip, prefix: chk.prefix, gateway: chk.gateway });
        if (!r.ok) { err.textContent = r.error; return false; }
        WS.net.setDnsServers(a.name, servers.length ? servers : []);
        return true;
      } }, { label: 'Cancel', value: false }],
      onCreate: d => { if (o.onCreate) o.onCreate({ ...d, mode, ip, mask, gw, d1, d2, err, paint }); } }).then(r => { if (ctx) ctx.repaint(); return r; });
  }
  function editDns(ctx, o = {}) {
    const a = WS.net.adapter();
    const dns = a.dnsServers || [];
    const mode = select([['dhcp', 'Automatic (DHCP)'], ['manual', 'Manual']], a.dnsDhcp ? 'dhcp' : 'manual', () => paint(), { field: 'dnsmode' });
    const d1 = h('input.st-input', { value: a.dnsDhcp ? '' : dns[0] || '', dataset: { field: 'dns1' } }), d2 = h('input.st-input', { value: a.dnsDhcp ? '' : dns[1] || '', dataset: { field: 'dns2' } });
    const manual = h('div.st-fields', h('div.st-fhead', 'IPv4'), h('label.st-flabel', 'Preferred DNS'), d1, h('label.st-flabel', 'Alternate DNS'), d2);
    const err = h('div.st-err');
    const paint = () => { manual.style.display = mode.value === 'manual' ? '' : 'none'; };
    paint();
    return contentDialog({ title: 'Edit DNS settings', body: [mode, manual, err],
      buttons: [{ label: 'Save', primary: true, value: true, validate: () => {
        if (mode.value === 'dhcp') { if (!a.dhcp) { err.textContent = 'DNS settings can be obtained automatically only when the IP address is assigned by DHCP.'; return false; } WS.net.setDnsServers(a.name, null); return true; }
        const servers = [d1.value.trim(), d2.value.trim()].filter(Boolean);
        const r = WS.net.setDnsServers(a.name, servers);
        if (!r.ok) { err.textContent = r.error; return false; }
        return true;
      } }, { label: 'Cancel', value: false }],
      onCreate: d => { if (o.onCreate) o.onCreate({ ...d, mode, d1, d2, err }); } }).then(r => { if (ctx) ctx.repaint(); return r; });
  }
  RENDER['network-advancedsettings'] = ctx => {
    const a = WS.net.adapter();
    return [h3('Network adapters'),
      expander({ title: a.name, desc: a.description, icon: 'ethernet', open: true, id: 'adapter',
        right: btn(a.enabled ? 'Disable' : 'Enable', () => { WS.net.setEnabled(a.name, !a.enabled); ctx.repaint(); }, { action: a.enabled ? 'disable' : 'enable' }),
        body: [card({ title: 'View additional properties', go: () => ctx.go('network-ethernet') })] }),
      h3('More settings'),
      group(card({ title: 'Hardware and connection properties', icon: 'advanced', go: () => ctx.go('network-ethernet') }),
        card({ title: 'Network reset', desc: 'Reset all network adapters to factory settings', icon: 'network' })),
      h3('Related settings'),
      group(card({ title: 'More network adapter options', icon: 'advanced', go: () => WS.apps.launch('ncpa') }),
        card({ title: 'Network and Sharing Center', icon: 'network', go: () => WS.apps.launch('netcenter') }),
        card({ title: 'Windows Firewall', icon: 'security', go: () => WS.apps.launch('firewall') }))];
  };

  /* ---------------- Personalization ---------------- */
  function preview() {
    const p = WS.personal.get();
    return h('div.st-preview', { style: { background: WS.personal.backgroundCss() } },
      h('div.st-pv-win' + (p.appMode === 'dark' ? '.dark' : ''), h('div.st-pv-bar', { style: { background: p.accent } }), h('div.st-pv-text', 'Aa')),
      h('div.st-pv-task' + (p.taskbarAlign === 'center' ? '.center' : '') + (p.mode === 'dark' ? '.dark' : ''), h('i'), h('i'), h('i')));
  }
  RENDER.personalization = ctx => [h('div.st-pvwrap', preview()), listPage(['personalization-background', 'Background image, color, slideshow'], ['colors', 'Accent color, transparency effects, color theme'],
    ['themes', 'Install, create, manage'], ['lockscreen', 'Lock screen images, apps, animations'], ['personalization-start', 'Recent apps and items, folders'], ['taskbar', 'Taskbar behaviors, system pins'])(ctx)];
  RENDER['personalization-background'] = ctx => {
    const p = WS.personal.get(), bg = WS.personal.background();
    const managed = WS.personal.managed('background');
    const kind = select([['picture', 'Picture'], ['solid', 'Solid color']], bg.kind, v => { WS.personal.set({ background: { kind: v } }); ctx.repaint(); }, { disabled: !!managed, field: 'bgkind' });
    const pics = h('div.st-pics', ...WS.personal.PICTURES.map(x => h('button.st-pic' + (bg.kind === 'picture' && bg.picture === x.id ? '.sel' : ''), { title: x.name, disabled: !!managed, dataset: { pic: x.id },
      style: { background: x.css }, onClick: () => { WS.personal.set({ background: { kind: 'picture', picture: x.id } }); ctx.repaint(); } })));
    const sw = h('div.st-swatches', ...WS.personal.COLORS.slice(0, 24).map(c => h('button.st-swatch' + (bg.kind === 'solid' && bg.color === c ? '.sel' : ''), { title: c, disabled: !!managed, dataset: { color: c },
      style: { background: c }, onClick: () => { WS.personal.set({ background: { kind: 'solid', color: c } }); ctx.repaint(); } })));
    return [managed ? managedNote() : null, h('div.st-pvwrap', preview()),
      group(card({ title: 'Personalize your background', desc: 'A picture background applies to your current desktop. Solid color or slideshow backgrounds apply to all your desktops.', icon: 'background', right: kind }),
        bg.kind === 'picture' ? card({ title: 'Recent images', desc: pics }) : card({ title: 'Choose your background color', desc: sw }))];
  };
  RENDER.colors = ctx => {
    const p = WS.personal.get();
    const custom = p.mode !== p.appMode;
    const modeSel = select([['light', 'Light'], ['dark', 'Dark'], ['custom', 'Custom']], custom ? 'custom' : p.mode, v => {
      if (v === 'custom') WS.personal.set({ appMode: p.mode === 'light' ? 'dark' : 'light' }); else WS.personal.set({ mode: v, appMode: v });
      ctx.repaint();
    }, { field: 'mode' });
    const sw = h('div.st-swatches', ...WS.personal.COLORS.map(c => h('button.st-swatch' + (p.accent === c ? '.sel' : ''), { title: c, dataset: { accent: c }, style: { background: c },
      onClick: () => { WS.personal.set({ accent: c }); ctx.repaint(); } })));
    return [h('div.st-pvwrap', preview()),
      group(card({ title: 'Choose your mode', desc: 'Change the colors that appear in Windows and your apps', icon: 'colors', right: modeSel }),
        custom ? h('div.st-card.st-sub', h('div.st-ctext', h('div.st-ctitle', 'Choose your default Windows mode')), select([['light', 'Light'], ['dark', 'Dark']], p.mode, v => { WS.personal.set({ mode: v }); ctx.repaint(); }, { field: 'winmode' })) : null,
        custom ? h('div.st-card.st-sub', h('div.st-ctext', h('div.st-ctitle', 'Choose your default app mode')), select([['light', 'Light'], ['dark', 'Dark']], p.appMode, v => { WS.personal.set({ appMode: v }); ctx.repaint(); }, { field: 'appmode' })) : null,
        card({ title: 'Transparency effects', desc: 'Windows and surfaces appear translucent', icon: 'colors', right: toggle(p.transparency, v => WS.personal.set({ transparency: v }), { field: 'transparency' }) }),
        card({ title: 'Accent color', icon: 'colors', right: select(['Manual'], 'Manual', null, { disabled: true }) }),
        card({ title: 'Windows colors', desc: sw }),
        card({ title: 'Show accent color on Start and taskbar', desc: p.mode === 'light' ? 'Available in Dark mode' : null, icon: 'colors', right: toggle(p.accentOnTaskbar, v => WS.personal.set({ accentOnTaskbar: v }), { disabled: p.mode === 'light', field: 'accenttaskbar' }) }))];
  };
  RENDER.taskbar = ctx => {
    const p = WS.personal.get();
    return [h3('Taskbar items'),
      group(card({ title: 'Search', icon: 'taskbar', right: select([['hide', 'Hide'], ['icon', 'Search icon only'], ['label', 'Search icon and label'], ['box', 'Search box']], p.taskbarSearch, v => WS.personal.set({ taskbarSearch: v }), { field: 'search' }) })),
      h3('Taskbar behaviors'),
      group(card({ title: 'Taskbar alignment', icon: 'taskbar', right: select([['left', 'Left'], ['center', 'Center']], p.taskbarAlign, v => WS.personal.set({ taskbarAlign: v }), { field: 'align' }) }))];
  };
  RENDER.lockscreen = ctx => [gpOn('computer', 'NoChangingLockScreen') ? managedNote() : null, ...placeholder(ctx)];

  /* ---------------- Apps ---------------- */
  RENDER.apps = listPage(['appsfeatures', 'Uninstall and manage apps on your PC'], ['defaultapps', 'Defaults for file and link types, other defaults'], ['startupapps', 'Apps that start automatically when you sign in']);
  let appQuery = '', appSort = 'name';
  RENDER.appsfeatures = ctx => {
    const q = h('input.st-input.st-appsearch', { placeholder: 'Search apps', value: appQuery, spellcheck: false, dataset: { field: 'appsearch' } });
    const list = h('div.st-group');
    const count = h('div.st-dim');
    const paint = () => {
      const all = WS.programs.list().filter(p => !appQuery || p.name.toLowerCase().includes(appQuery.toLowerCase()));
      const sorted = all.sort({ name: (a, b) => a.name.localeCompare(b.name), date: (a, b) => new Date(b.installedOn) - new Date(a.installedOn), size: (a, b) => b.sizeKB - a.sizeKB }[appSort]);
      count.textContent = `${sorted.length} app${sorted.length === 1 ? '' : 's'} found`;
      U.clear(list);
      for (const p of sorted) {
        const more = h('button.st-more', { html: IC.more, title: 'More options', dataset: { app: p.name } });
        more.addEventListener('click', e => { e.stopPropagation(); WS.ui.popupMenu(more, [{ label: 'Modify', disabled: true }, { label: 'Uninstall', disabled: !!p.system, action: () => uninstall(p, more) }]); });
        list.append(card({ title: p.name, icon: 'apps', id: 'app-' + p.id, desc: [p.version, p.publisher, U.fmtDate(new Date(p.installedOn))].filter(Boolean).join('  |  '),
          right: h('span.st-appright', p.sizeKB ? h('span.st-dim', U.fmtBytes(p.sizeKB * 1024)) : null, more) }));
      }
    };
    q.addEventListener('input', () => { appQuery = q.value; paint(); });
    paint();
    return [group(card({ title: 'Installed apps', right: h('span.st-appbar', q, select([['name', 'Name (A to Z)'], ['date', 'Date installed'], ['size', 'Size (large to small)']], appSort, v => { appSort = v; paint(); }, { field: 'sort' })) })),
      count, list, h3('Related settings'), group(card({ title: 'Programs and Features', icon: 'apps', go: () => WS.apps.launch('appwiz') }))];
  };
  async function uninstall(p, anchor) {
    const ok = await contentDialog({ title: 'Uninstall', body: h('p', 'This app and its related info will be uninstalled.'), buttons: [{ label: 'Uninstall', primary: true, value: true }, { label: 'Cancel', value: false }] });
    if (!ok) return false;
    const r = WS.programs.uninstall(p.id);
    if (!r.ok) await WS.ui.msgbox({ title: 'Uninstall', icon: 'error', message: r.error });
    return r.ok;
  }
  RENDER.startupapps = ctx => {
    const list = WS.proc.startupApps();
    return [h('p.st-dim', 'Apps can be configured to start when you sign in. In most cases, they\u2019ll start minimized or might only start a background task.'),
      group(...list.map(e => card({ title: e.name, desc: `${e.publisher || ''}${e.publisher ? '  |  ' : ''}${e.enabled ? (e.impact === 'Not measured' ? 'No impact' : `${e.impact} impact`) : 'No impact'}`, icon: 'startup', id: 'startup-' + e.id,
        right: toggle(e.enabled, v => WS.proc.setStartupEnabled(e.id, v), { field: 'startup-' + e.id }) }))),
      list.length ? null : h('p.st-dim', 'No startup apps.')];
  };

  /* ---------------- Accounts ---------------- */
  const acctHero = () => h('div.st-hero', h('span.st-bigavatar', { html: I.user }), h('div', h('div.st-hero-name', 'ADMINISTRATOR'),
    h('div.st-dim', WS.sys.isDC() ? `${WS.sys.netbiosDomain()}\\Administrator` : 'Local Account'), h('div.st-dim', 'Administrator')));
  RENDER.accounts = ctx => [acctHero(), listPage(['yourinfo', 'Profile photo'], ['signinoptions', 'Password, security key'], ['otherusers', 'Device access, work or school users'], ['workplace', 'Organization resources like email, apps, and network'])(ctx)];
  RENDER.yourinfo = ctx => [acctHero(), h3('Related settings'), group(card({ title: 'Accounts', desc: 'Manage local and domain accounts', icon: 'users', go: () => WS.apps.launch(WS.sys.isDC() ? 'dsa' : 'lusrmgr') }))];
  RENDER.signinoptions = ctx => {
    const blocked = gpOn('user', 'DisableChangePassword');
    return [h3('Ways to sign in'), blocked ? managedNote() : null,
      expander({ title: 'Password', desc: 'Sign in with your account\u2019s password', icon: 'signin', open: true,
        body: [card({ title: 'Your account password is set up for signing in to Windows, apps, and services', right: btn('Change', () => WS.shell.changePassword(), { disabled: blocked, action: 'change-password' }) })] })];
  };
  RENDER.otherusers = ctx => [group(card({ title: 'Add other user', icon: 'users', right: btn('Add account', () => WS.apps.launch(WS.sys.isDC() ? 'dsa' : 'lusrmgr'), { action: 'add-account' }) })),
    h('p.st-dim', WS.sys.isDC() ? 'On a domain controller, accounts are managed in Active Directory Users and Computers.' : 'Local accounts are managed in Local Users and Groups.')];

  /* ---------------- Time & language ---------------- */
  RENDER.time = listPage(['dateandtime', 'Time zones, automatic clock settings, calendar display'], ['regionlanguage', 'Windows and some apps format dates and time based on your region']);
  let lastSync = null, syncFailed = false;
  RENDER.dateandtime = ctx => {
    const clock = h('div.st-clock');
    const tick = () => { const d = WS.sys.now(); clock.textContent = `${U.fmtTime(d)}\n${U.fmtLongDate(d)}`; };
    tick();
    ctx.every(tick, 1000);
    const tz = select(WS.sys.timeZones.map(t => [t.id, t.display]), WS.state.system.timeZoneId, v => { WS.sys.setTimeZone(v); tick(); }, { field: 'timezone' });
    const dc = WS.sys.isDC();
    const server = dc ? 'Local CMOS Clock' : 'time.windows.com';
    const status = h('div.st-dim', syncFailed ? h('span.st-errtext', 'Time synchronization failed') : lastSync ? `Last successful time synchronization: ${U.fmtDateTime(WS.sys.now(lastSync))}` : 'Last successful time synchronization: Never', h('br'), `Time server: ${server}`);
    const sync = btn('Sync now', async () => {
      sync.disabled = true; sync.textContent = 'Syncing...';
      await U.sleep(900 * (WS.wu ? WS.wu.timeScale : 1));
      // a domain controller (the PDC emulator) serves time from its own clock; otherwise time.windows.com must be reachable
      const r = WS.net.resolve('time.windows.com');
      const ok = dc || (r.ok && WS.net.route(r.ip) === 'routed' && WS.state.network.lan.internet);
      if (ok) lastSync = new Date();
      syncFailed = !ok;
      ctx.repaint();
    }, { action: 'sync' });
    return [clock,
      group(card({ title: 'Set time automatically', icon: 'time', right: toggle(true, () => {}, { disabled: true }) }),
        card({ title: 'Set time zone automatically', icon: 'time', right: toggle(false, () => {}, { disabled: true }) }),
        card({ title: 'Set the time and date manually', icon: 'time', right: btn('Change', () => {}, { disabled: true }) })),
      group(card({ title: 'Time zone', icon: 'time', right: tz }),
        card({ title: 'Adjust for daylight saving time automatically', icon: 'time', right: toggle(true, () => {}) })),
      h3('Additional settings'),
      group(card({ title: 'Sync now', desc: status, icon: 'sync', right: sync })),
      h3('Related links'),
      group(card({ title: 'Additional clocks', desc: 'Clocks for different time zones', icon: 'time', go: () => WS.apps.launch('timedate') }))];
  };
  RENDER.regionlanguage = ctx => [h3('Language'),
    group(card({ title: 'Windows display language', desc: 'Windows features like Settings and File Explorer will appear in this language', icon: 'region', right: select(['English (United States)'], 'English (United States)', null, { disabled: true }) }),
      card({ title: 'Preferred languages', desc: 'English (United States)', icon: 'region' })),
    h3('Region'),
    group(card({ title: 'Country or region', icon: 'region', right: select(['United States'], 'United States', null, { disabled: true }) }),
      card({ title: 'Regional format', icon: 'region', right: select(['Recommended [English (United States)]'], 'Recommended [English (United States)]', null, { disabled: true }) }))];

  /* ---------------- Accessibility, Privacy ---------------- */
  RENDER.accessibility = listPage(['colorfilters', 'Colorblindness filters, grayscale, inverted']);
  RENDER.colorfilters = ctx => [group(card({ title: 'Color filters', desc: 'Grayscale', icon: 'filters', right: toggle(document.getElementById('screen').classList.contains('color-filter'), v => WS.shell.colorFilter(v), { field: 'colorfilters' }) }))];
  RENDER.privacy = ctx => [h3('Security'), group(card({ title: 'Windows Security', desc: 'Antivirus, browser, firewall, and network protection for your device', icon: 'security', go: () => WS.apps.notImplemented('Windows Security') })),
    h3('Windows permissions'), listPage(['privacy-general', 'Advertising ID, local content, app launches, settings suggestions'], ['privacy-feedback', 'Diagnostic data, inking and typing data, tailored experiences'])(ctx)];

  /* ---------------- Windows Update ---------------- */
  function lastChecked() {
    const st = WS.wu.state();
    if (!st.lastChecked) return 'Never';
    const d = new Date(st.lastChecked), t = WS.sys.now(d), today = WS.sys.now();
    return (t.toDateString() === today.toDateString() ? 'Today, ' : U.fmtDate(t) + ', ') + U.fmtTime(t);
  }
  const ITEM_STATE = { pending: () => 'Pending download', downloading: i => `Downloading - ${i.pct}%`, installing: i => `Installing - ${i.pct}%`, restart: () => 'Pending restart', installed: () => 'Installed', failed: () => 'Install error' };
  RENDER.windowsupdate = ctx => {
    const st = WS.wu.state();
    const pol = WS.wu.policy();
    const restartNow = () => WS.shell.shutdownNow(true, { title: 'Operating System: Service pack (Planned)', code: 0x80020010, process: 'C:\\Windows\\system32\\svchost.exe', system: true });
    let icon = IC.check, title = 'You\u2019re up to date', sub = `Last checked: ${lastChecked()}`, action = btn('Check for updates', () => WS.wu.check(), { primary: true, action: 'check' });
    if (st.status === 'idle' && !st.lastChecked) { icon = IC.restart; title = 'Check for updates'; }
    if (st.status === 'checking') { icon = IC.restart; title = 'Checking for updates...'; sub = h('div.st-progress', h('i')); action = null; }
    if (st.status === 'available') { icon = IC.restart; title = 'Updates available'; action = btn('Download & install all', () => WS.wu.install(), { primary: true, action: 'install' }); }
    if (st.status === 'installing') { icon = IC.restart; title = 'Updates are being installed'; action = null; }
    if (st.status === 'restart') { icon = IC.restart; title = 'Restart required'; sub = 'Your device will restart outside of active hours.'; action = btn('Restart now', restartNow, { primary: true, action: 'restart' }); }
    if (st.status === 'error') { icon = IC.warn; title = 'There were problems checking for updates'; sub = h('div', st.error.error, h('div.st-dim', `(${st.error.code})`)); action = btn('Retry', () => WS.wu.check(), { primary: true, action: 'retry' }); }
    const items = st.items.length && st.status !== 'uptodate' ? group(...st.items.map(i => card({ title: i.title, id: i.kb, icon: 'windowsupdate', right: h('span.st-dim', { dataset: { state: i.state } }, ITEM_STATE[i.state] ? ITEM_STATE[i.state](i) : '') }))) : null;
    return [
      pol ? h('div', managedNote(), link('View configured update policies', () => WS.ui.msgbox({ title: 'Configured update policies', message: 'Policies set on your device', detail: `Configure Automatic Updates: ${pol.text}\nType of policy: Group Policy` }))) : null,
      h('div.st-wu', h('span.st-wuico', { html: icon }), h('div.st-wutext', h('div.st-hero-name', title), typeof sub === 'string' ? h('div.st-dim', sub) : sub), action ? h('div.st-hero-right', action) : null),
      items,
      h3('More options'),
      group(card({ title: 'Pause updates', icon: 'pause', right: btn('Pause for 1 week', () => {}, { disabled: true }) }),
        card({ title: 'Update history', icon: 'history', go: () => ctx.go('windowsupdate-history') }),
        card({ title: 'Advanced options', desc: 'Delivery optimization, optional updates, active hours, other update settings', icon: 'advanced', go: () => ctx.go('windowsupdate-options') }))];
  };
  RENDER['windowsupdate-history'] = ctx => {
    const hist = WS.wu.history();
    const by = k => hist.filter(x => (k === 'quality' ? x.kind : k === 'definition' ? /Security Intelligence/.test(x.title) : !x.kind && !/Security Intelligence/.test(x.title)));
    const sec = (label, list) => expander({ title: `${label} (${list.length})`, icon: 'history', open: !!list.length, id: label,
      body: list.length ? list.map(x => card({ title: x.title, desc: `Successfully installed on ${U.fmtDate(new Date(x.date))}` })) : [h('div.st-dim.st-pad', 'No updates')] });
    return [h3('Update history'), sec('Quality Updates', by('quality')), sec('Definition Updates', by('definition')), sec('Other Updates', by('other')),
      h3('Related settings'), group(card({ title: 'Uninstall updates', icon: 'windowsupdate', go: () => WS.apps.launch('appwiz', { page: 'updates' }) }))];
  };

  WS.apps.register({ id: 'settings', name: 'Settings', icon: IC.app, singleton: true, keywords: ['settings', 'ms-settings', 'pc settings', 'dark mode', 'windows update', 'rename', 'personalization', 'time zone'],
    launch, reuse: (w, args) => { if (args.page) w.settings.go(args.page); } });
  WS.settings = { PAGES, renameDialog, editIp: o => editIp(null, o), editDns: o => editDns(null, o), contentDialog };
})();
