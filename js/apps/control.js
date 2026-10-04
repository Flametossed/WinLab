/* Control Panel (control.exe): the Category view home, All Control Panel Items (large/small icons), the category pages,
 * User Accounts and Windows Tools; and Programs and Features (appwiz.cpl) with Installed Updates. Items open the real
 * tools (sysdm, ncpa, firewall.cpl, Settings pages...) or the "not built yet" window. User policy: Prohibit access to
 * Control Panel (WS.shell.restricted), Hide specified Control Panel items (DisallowCpl), Hide "Programs and Features".
 *   WS.apps.launch('control', { page: 'home'|'all'|'system'|'network'|'hardware'|'programs'|'accounts'|'appearance'|'clock'|'ease'|'useraccounts'|'tools' })
 *     -> win; win.cpanel = { page(), go(id), item(name), search(text), view(mode) }
 *   WS.apps.launch('appwiz', { page: 'programs'|'updates' }) -> win; win.appwiz = { page(), go(id), list, select(name), uninstall(), features() } */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f;
  const gpOn = (side, key) => !!(WS.gpo && WS.gpo.policyEnabled(side, key));
  const s32 = b => `<svg viewBox="0 0 32 32">${b}</svg>`;
  const ICON = {
    app: s32('<rect x="3" y="5" width="26" height="20" rx="2" fill="#fff" stroke="#5b6b7d" stroke-width="1.5"/><rect x="6" y="9" width="8" height="6" rx="1" fill="#2f7fd8"/><rect x="18" y="9" width="8" height="6" rx="1" fill="#2fb34b"/><rect x="6" y="17" width="8" height="5" rx="1" fill="#e3a21a"/><rect x="18" y="17" width="8" height="5" rx="1" fill="#c42b1c"/>'),
    system: s32('<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#2f7fd8"/><path d="M16 3v26c6-2 11-7 11-14V7z" fill="#1f5fae"/><path d="M11 16l4 4 7-8" fill="none" stroke="#fff" stroke-width="2.4"/>'),
    network: s32('<circle cx="16" cy="16" r="12" fill="#4ea5ef"/><path d="M4 16h24M16 4c4 4 5 8 5 12s-1 8-5 12c-4-4-5-8-5-12s1-8 5-12z" fill="none" stroke="#fff" stroke-width="1.5"/>'),
    hardware: s32('<rect x="4" y="9" width="24" height="15" rx="2" fill="#5b6b7d"/><rect x="8" y="5" width="16" height="6" rx="1" fill="#9aa6b3"/><circle cx="24" cy="20" r="1.6" fill="#2fb34b"/>'),
    programs: s32('<rect x="4" y="6" width="24" height="20" rx="2" fill="#fff" stroke="#5b6b7d" stroke-width="1.5"/><rect x="4" y="6" width="24" height="5" rx="2" fill="#2f7fd8"/><path d="M9 16h14M9 20h9" stroke="#5b6b7d" stroke-width="1.6"/>'),
    accounts: s32('<circle cx="16" cy="11" r="6" fill="#4a7fbd"/><path d="M5 28c1-7 5-10 11-10s10 3 11 10z" fill="#4a7fbd"/>'),
    appearance: s32('<rect x="4" y="6" width="24" height="18" rx="2" fill="url(#wsg-blue)"/><circle cx="11" cy="12" r="3" fill="#ffd768"/><path d="M4 22l8-7 6 5 4-3 6 5v2H4z" fill="#2fb34b"/>'),
    clock: s32('<circle cx="16" cy="16" r="12" fill="#fff" stroke="#5b6b7d" stroke-width="2"/><path d="M16 9v7l5 3" fill="none" stroke="#1b1b1b" stroke-width="2"/><circle cx="25" cy="25" r="5" fill="#4ea5ef"/>'),
    ease: s32('<circle cx="16" cy="16" r="12" fill="#2f7fd8"/><circle cx="16" cy="9.5" r="2" fill="#fff"/><path d="M9 13l7 1.5 7-1.5M16 14.5v5l-3 6M16 19.5l3 6" fill="none" stroke="#fff" stroke-width="1.8"/>'),
    tools: s32('<path d="M6 26l11-11M20 4a6 6 0 0 0-5 8l-10 10 4 4 10-10a6 6 0 0 0 8-5l-4 2-3-3z" fill="#9aa6b3" stroke="#5b6b7d" stroke-width="1.2"/>'),
    item: s32('<rect x="5" y="5" width="22" height="22" rx="3" fill="#e9eef5" stroke="#8a97a6"/><path d="M10 12h12M10 16h12M10 20h8" stroke="#5b6b7d" stroke-width="1.6"/>'),
    uac: '<svg viewBox="0 0 16 16"><path d="M8 1.5l5 2v4c0 3-2 5.4-5 6.6-3-1.2-5-3.6-5-6.6v-4z" fill="#2f7fd8"/><path d="M8 1.5v12.6c3-1.2 5-3.6 5-6.6v-4z" fill="#f2b631"/></svg>',
    search: '<svg viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor"/><path d="M10 10l4.5 4.5" stroke="currentColor"/></svg>'
  };

  const soon = name => () => WS.apps.notImplemented(name);
  const settings = page => () => WS.apps.launch('settings', { page });
  /** All Control Panel Items: [name, canonical name, icon, open] */
  const ITEMS = [
    ['Color Management', 'Microsoft.ColorManagement', 'appearance', soon('Color Management')],
    ['Credential Manager', 'Microsoft.CredentialManager', 'accounts', soon('Credential Manager')],
    ['Date and Time', 'Microsoft.DateAndTime', 'clock', () => WS.apps.launch('timedate')],
    ['Device Manager', 'Microsoft.DeviceManager', 'hardware', () => WS.apps.launch('devmgmt')],
    ['Devices and Printers', 'Microsoft.DevicesAndPrinters', 'hardware', soon('Devices and Printers')],
    ['Ease of Access Center', 'Microsoft.EaseOfAccessCenter', 'ease', settings('accessibility')],
    ['File Explorer Options', 'Microsoft.FolderOptions', 'appearance', soon('File Explorer Options')],
    ['Fonts', 'Microsoft.Fonts', 'appearance', () => WS.apps.launch('explorer', { path: 'C:\\Windows\\Fonts' })],
    ['Internet Options', 'Microsoft.InternetOptions', 'network', soon('Internet Options')],
    ['iSCSI Initiator', 'Microsoft.iSCSIInitiator', 'hardware', soon('iSCSI Initiator')],
    ['Keyboard', 'Microsoft.Keyboard', 'hardware', soon('Keyboard Properties')],
    ['Mouse', 'Microsoft.Mouse', 'hardware', soon('Mouse Properties')],
    ['Network and Sharing Center', 'Microsoft.NetworkAndSharingCenter', 'network', () => WS.apps.launch('netcenter')],
    ['Phone and Modem', 'Microsoft.PhoneAndModem', 'hardware', soon('Phone and Modem')],
    ['Power Options', 'Microsoft.PowerOptions', 'hardware', settings('power')],
    ['Programs and Features', 'Microsoft.ProgramsAndFeatures', 'programs', () => WS.apps.launch('appwiz')],
    ['Region', 'Microsoft.RegionAndLanguage', 'clock', settings('regionlanguage')],
    ['RemoteApp and Desktop Connections', 'Microsoft.RemoteAppAndDesktopConnections', 'network', soon('RemoteApp and Desktop Connections')],
    ['Security and Maintenance', 'Microsoft.ActionCenter', 'system', soon('Security and Maintenance')],
    ['Sound', 'Microsoft.Sound', 'hardware', settings('sound')],
    ['Speech Recognition', 'Microsoft.SpeechRecognition', 'ease', soon('Speech Recognition')],
    ['Sync Center', 'Microsoft.SyncCenter', 'network', soon('Sync Center')],
    ['System', 'Microsoft.System', 'system', settings('about')],
    ['Taskbar and Navigation', 'Microsoft.Taskbar', 'appearance', settings('taskbar')],
    ['Troubleshooting', 'Microsoft.Troubleshooting', 'system', soon('Troubleshooting')],
    ['User Accounts', 'Microsoft.UserAccounts', 'accounts', null],
    ['Windows Defender Firewall', 'Microsoft.WindowsFirewall', 'system', () => WS.apps.launch('firewall')],
    ['Windows Tools', 'Microsoft.AdministrativeTools', 'tools', null]
  ];
  /** Hide specified Control Panel items: names or canonical names. */
  function hidden(name) {
    const list = WS.gpo ? WS.gpo.policyOption('user', 'DisallowCpl', 'DisallowCplList') : null;
    if (!list) return false;
    const it = ITEMS.find(x => x[0] === name);
    return list.some(x => { const v = String(x).trim().toLowerCase(); return v === name.toLowerCase() || (it && v === it[1].toLowerCase()); });
  }

  const CATS = [
    ['system', 'System and Security', [['Check firewall status', 'firewall'], ['Allow an app through Windows Firewall', 'firewall-allowed']]],
    ['network', 'Network and Internet', [['View network status and tasks', 'netcenter']]],
    ['hardware', 'Hardware', [['View devices and printers', 'Devices and Printers'], ['Add a device', 'Add a device']]],
    ['programs', 'Programs', [['Uninstall a program', 'appwiz'], ['Turn Windows features on or off', 'features', true]]],
    ['accounts', 'User Accounts', [['Change account type', 'useraccounts', true]]],
    ['appearance', 'Appearance and Personalization', []],
    ['clock', 'Clock and Region', [['Change date, time, or number formats', 'regionlanguage']]],
    ['ease', 'Ease of Access', [['Let Windows suggest settings', 'accessibility'], ['Optimize visual display', 'accessibility']]]
  ];
  // category pages: [item name, [link text, target]...]
  const CAT_PAGES = {
    system: [['Security and Maintenance', [['Review your computer\u2019s status and resolve issues', 'Security and Maintenance']]],
      ['Windows Defender Firewall', [['Check firewall status', 'firewall'], ['Allow an app through Windows Firewall', 'firewall-allowed']]],
      ['System', [['View amount of RAM and processor speed', 'about'], ['Allow remote access', 'sysdm-remote', true], ['See the name of this computer', 'about']]],
      ['Power Options', [['Change what the power buttons do', 'power'], ['Change when the computer sleeps', 'power']]],
      ['Windows Tools', [['Free up disk space', 'cleanmgr'], ['Defragment and optimize your drives', 'dfrgui'], ['Create and format hard disk partitions', 'diskmgmt', true], ['View event logs', 'eventvwr', true], ['Schedule tasks', 'taskschd', true]]]],
    network: [['Network and Sharing Center', [['View network status and tasks', 'netcenter'], ['View network computers and devices', 'View network computers and devices']]],
      ['Internet Options', [['Change your homepage', 'Internet Options'], ['Manage browser add-ons', 'Internet Options'], ['Delete browsing history and cookies', 'Internet Options']]]],
    hardware: [['Devices and Printers', [['Add a device', 'Add a device'], ['Advanced printer setup', 'Advanced printer setup'], ['Device Manager', 'devmgmt', true]]],
      ['Sound', [['Adjust system volume', 'sound'], ['Change system sounds', 'sound']]], ['Power Options', [['Change what the power buttons do', 'power']]]],
    programs: [['Programs and Features', [['Uninstall a program', 'appwiz'], ['Turn Windows features on or off', 'features', true], ['View installed updates', 'updates']]]],
    accounts: [['User Accounts', [['Change account type', 'useraccounts', true], ['Remove user accounts', 'useraccounts', true]]], ['Credential Manager', [['Manage Web Credentials', 'Credential Manager'], ['Manage Windows Credentials', 'Credential Manager']]]],
    appearance: [['Taskbar and Navigation', [['Navigation properties', 'taskbar']]], ['Ease of Access Center', [['Use screen reader', 'accessibility'], ['Turn High Contrast on or off', 'accessibility']]],
      ['File Explorer Options', [['Specify single- or double-click to open', 'File Explorer Options'], ['Show hidden files and folders', 'File Explorer Options']]], ['Fonts', [['Change Font Settings', 'Fonts']]]],
    clock: [['Date and Time', [['Set the time and date', 'timedate'], ['Change the time zone', 'timedate'], ['Add clocks for different time zones', 'timedate']]], ['Region', [['Change date, time, or number formats', 'regionlanguage']]]],
    ease: [['Ease of Access Center', [['Let Windows suggest settings', 'accessibility'], ['Optimize visual display', 'accessibility']]], ['Speech Recognition', [['Start speech recognition', 'Speech Recognition']]]]
  };
  /** Where a link goes. Unknown targets are tools that aren't built (named after the link). */
  function openTarget(t, win) {
    const map = {
      firewall: () => WS.apps.launch('firewall'), 'firewall-allowed': () => WS.apps.launch('firewall', { page: 'allowed' }), netcenter: () => WS.apps.launch('netcenter'),
      appwiz: () => WS.apps.launch('appwiz'), updates: () => WS.apps.launch('appwiz', { page: 'updates' }), features: () => WS.sm && WS.sm.addRoles ? WS.sm.addRoles() : null,
      about: settings('about'), power: settings('power'), sound: settings('sound'), taskbar: settings('taskbar'), accessibility: settings('accessibility'), regionlanguage: settings('regionlanguage'),
      'sysdm-remote': () => WS.apps.launch('sysdm', { tab: 'remote' }), timedate: () => WS.apps.launch('timedate'), devmgmt: () => WS.apps.launch('devmgmt'),
      diskmgmt: () => WS.apps.launch('diskmgmt'), eventvwr: () => WS.apps.launch('eventvwr'), useraccounts: () => win.cpanel.go('useraccounts'),
      Fonts: () => WS.apps.launch('explorer', { path: 'C:\\Windows\\Fonts' })
    };
    (map[t] || (WS.apps.get(t) ? () => WS.apps.launch(t) : soon(t)))();
  }

  /* ================================================================ Control Panel */
  const PAGE_TITLE = { home: 'Control Panel', all: 'All Control Panel Items', useraccounts: 'User Accounts', tools: 'Windows Tools' };
  CATS.forEach(([id, label]) => { PAGE_TITLE[id] = label; });

  function launch(args = {}) {
    const win = WS.wm.create({ app: 'control', title: 'Control Panel', icon: ICON.app, width: 980, height: 640 });
    let page = 'home', view = 'category', query = '';
    const crumbs = h('div.cp-crumbs');
    const search = h('input.cpl-search', { placeholder: 'Search Control Panel', spellcheck: false });
    search.dataset.field = 'search';
    const nav = h('div.cp-nav');
    const main = h('div.cp-main');
    win.body.appendChild(h('div.cp.cpl', h('div.cp-bar.cpl-bar', crumbs, h('div.cpl-searchbox', search, h('span', { html: ICON.search }))), h('div.cp-body', nav, main)));
    const link = (text, fn, uac) => h('a.cp-link', { href: '#', dataset: { link: text }, onClick: e => { e.preventDefault(); fn(); } }, uac ? h('span.cp-uac', { html: ICON.uac }) : null, text);
    const viewBy = () => h('div.cpl-viewby', 'View by: ', F.select([{ value: 'category', label: 'Category' }, { value: 'large', label: 'Large icons' }, { value: 'small', label: 'Small icons' }], page === 'all' ? view : 'category', { width: 110 }));
    function wireView(el) {
      const sel = el.querySelector('select');
      sel.dataset.field = 'viewby';
      sel.addEventListener('change', () => setView(sel.value));
      return el;
    }
    function setView(v) { view = v; go(v === 'category' ? 'home' : 'all'); }

    function paintCrumbs() {
      U.clear(crumbs);
      const parts = page === 'home' ? ['Control Panel'] : page === 'all' ? ['Control Panel', 'All Control Panel Items'] : page === 'useraccounts' ? ['Control Panel', 'User Accounts', 'User Accounts'] : page === 'tools' ? ['Control Panel', 'System and Security', 'Windows Tools'] : page === 'search' ? ['Search Results in Control Panel'] : ['Control Panel', PAGE_TITLE[page]];
      parts.forEach((p, i) => { if (i) crumbs.append(h('span.cp-sep', '>')); crumbs.append(h('span.cpl-crumb', { onClick: () => { if (i === 0 && p === 'Control Panel') go(view === 'category' ? 'home' : 'all'); else if (p === 'System and Security') go('system'); } }, p)); });
    }
    function paintNav() {
      U.clear(nav);
      if (page === 'home' || page === 'all' || page === 'search') return;
      nav.append(link('Control Panel Home', () => go('home')));
      for (const [id, label] of CATS) nav.append(id === page ? h('div.cpl-navcur', label) : link(label, () => go(id)));
    }
    function home() {
      const cat = ([id, label, links]) => h('div.cpl-cat', { dataset: { cat: id } }, h('span.cpl-cicon', { html: ICON[id] }),
        h('div', h('a.cpl-ctitle', { href: '#', onClick: e => { e.preventDefault(); go(id); } }, label),
          ...links.map(([text, target, uac]) => h('div', link(text, () => openTarget(target, win), uac)))));
      return [h('div.cpl-head', h('h1.cp-h1', 'Adjust your computer\u2019s settings'), wireView(viewBy())), h('div.cpl-cats', ...CATS.map(cat))];
    }
    function all() {
      const items = ITEMS.filter(([n]) => !hidden(n) && !(n === 'Programs and Features' && gpOn('user', 'NoProgramsAndFeatures')));
      return [h('div.cpl-head', h('h1.cp-h1', 'Adjust your computer\u2019s settings'), wireView(viewBy())),
        h('div.cpl-items.' + view, ...items.map(([n, , icon]) => h('a.cpl-item', { href: '#', dataset: { item: n }, onClick: e => { e.preventDefault(); item(n); } }, h('span', { html: ICON[icon] }), n)))];
    }
    function category(id) {
      return [h('div.cpl-sections', ...CAT_PAGES[id].filter(([n]) => !hidden(n)).map(([n, links]) => {
        const it = ITEMS.find(x => x[0] === n);
        return h('div.cpl-sec', h('span.cpl-cicon', { html: ICON[it ? it[2] : 'item'] }),
          h('div', h('a.cpl-ctitle', { href: '#', onClick: e => { e.preventDefault(); item(n); } }, n), h('div.cpl-seclinks', ...links.map(([t, target, uac]) => link(t, () => openTarget(target, win), uac)))));
      }))];
    }
    function userAccounts() {
      const dc = WS.sys.isDC();
      nav.querySelectorAll('.cp-link, .cpl-navcur').forEach(x => x.remove());
      nav.append(link('Control Panel Home', () => go('home')), link('Manage your credentials', soon('Credential Manager')), link('Create a password reset disk', soon('Forgotten Password Wizard')),
        link('Manage your file encryption certificates', soon('Encrypting File System')), link('Configure advanced user profile properties', () => WS.apps.launch('sysdm', { tab: 'advanced' })));
      return [h('h1.cp-h1', 'Make changes to your user account'),
        h('div.cpl-ua', h('div.cpl-ualinks',
          link('Make changes to my account in PC settings', settings('yourinfo')),
          link('Change your account name', soon('Change your account name'), true), link('Change your account type', soon('Change your account type'), true),
          link('Manage another account', () => WS.apps.launch(dc ? 'dsa' : 'lusrmgr'), true), link('Change User Account Control settings', soon('User Account Control Settings'), true)),
          h('div.cpl-uacard', h('span.cpl-uaav', { html: I.user }), h('div', h('b', 'Administrator'), h('div', dc ? `${WS.sys.netbiosDomain()}\\Administrator` : 'Local Account'), h('div', 'Administrator'), h('div', 'Password protected'))))];
    }
    function tools() {
      const list = WS.sm && WS.sm.tools ? WS.sm.tools() : [];
      return [h('div.cpl-tools', ...list.map(t => h('a.cpl-tool', { href: '#', dataset: { tool: t.label }, onClick: e => { e.preventDefault(); WS.apps.get(t.id) ? WS.apps.launch(t.id) : WS.apps.notImplemented(t.label); } },
        h('span', { html: (WS.apps.get(t.id) && WS.apps.get(t.id).icon) || ICON.tools }), t.label)))];
    }
    function results() {
      const q = query.toLowerCase();
      const hits = ITEMS.filter(([n]) => !hidden(n) && n.toLowerCase().includes(q));
      const linkHits = Object.values(CAT_PAGES).flat().flatMap(([n, links]) => links.filter(([t]) => t.toLowerCase().includes(q)).map(l => [n, l]));
      return [h('h1.cp-h1', `Search Results for "${query}"`),
        hits.length || linkHits.length ? null : h('p', 'No results found.'),
        ...hits.map(([n, , icon]) => h('div.cpl-sec', h('span.cpl-cicon', { html: ICON[icon] }), h('div', h('a.cpl-ctitle', { href: '#', onClick: e => { e.preventDefault(); item(n); } }, n),
          h('div.cpl-seclinks', ...linkHits.filter(([m]) => m === n).map(([, [t, target, uac]]) => link(t, () => openTarget(target, win), uac)))))),
        ...[...new Set(linkHits.map(([n]) => n))].filter(n => !hits.some(([m]) => m === n)).map(n => h('div.cpl-sec', h('span.cpl-cicon', { html: ICON.item }),
          h('div', h('a.cpl-ctitle', { href: '#', onClick: e => { e.preventDefault(); item(n); } }, n), h('div.cpl-seclinks', ...linkHits.filter(([m]) => m === n).map(([, [t, target, uac]]) => link(t, () => openTarget(target, win), uac))))))];
    }
    /** Open an item by name, as double-clicking it in All Control Panel Items does. */
    function item(name) {
      const it = ITEMS.find(x => x[0] === name);
      if (!it || hidden(name)) return false;
      if (name === 'User Accounts') go('useraccounts');
      else if (name === 'Windows Tools') go('tools');
      else it[3]();
      return true;
    }
    function go(id) {
      page = id;
      if (id === 'all' && view === 'category') view = 'large';
      if (id === 'home') view = 'category';
      win.setTitle(id === 'search' ? 'Search Results' : PAGE_TITLE[id] || 'Control Panel');
      paintCrumbs();
      paintNav();
      U.clear(main);
      const body = id === 'home' ? home() : id === 'all' ? all() : id === 'useraccounts' ? userAccounts() : id === 'tools' ? tools() : id === 'search' ? results() : CAT_PAGES[id] ? category(id) : home();
      main.append(...body.filter(Boolean));
      return page;
    }
    search.addEventListener('input', () => { query = search.value.trim(); if (query) go('search'); else go(view === 'category' ? 'home' : 'all'); });
    win.listen('gpresult', () => go(page));
    win.cpanel = { page: () => page, go, item, view: setView, search: t => { search.value = t; search.dispatchEvent(new Event('input')); return main.textContent; } };
    go(args.page || 'home');
    return win;
  }

  /* ================================================================ Programs and Features (appwiz.cpl) */
  function appwiz(args = {}) {
    const win = WS.wm.create({ app: 'appwiz', title: 'Programs and Features', icon: ICON.programs, width: 1000, height: 640 });
    let page = 'programs', lv = null;
    const crumbs = h('div.cp-crumbs');
    const nav = h('div.cp-nav');
    const main = h('div.cp-main.aw-main');
    win.body.appendChild(h('div.cp.cpl', h('div.cp-bar', crumbs), h('div.cp-body', nav, main)));
    const link = (text, fn, uac) => h('a.cp-link', { href: '#', dataset: { link: text }, onClick: e => { e.preventDefault(); fn(); } }, uac ? h('span.cp-uac', { html: ICON.uac }) : null, text);
    const features = () => (WS.sm && WS.sm.addRoles ? WS.sm.addRoles() : null);

    function go(id) {
      page = id;
      U.clear(crumbs).append(...['Control Panel', 'Programs', 'Programs and Features', ...(id === 'updates' ? ['Installed Updates'] : [])].flatMap((x, i) => (i ? [h('span.cp-sep', '>'), h('span', x)] : [h('span', x)])));
      win.setTitle(id === 'updates' ? 'Installed Updates' : 'Programs and Features');
      U.clear(nav).append(link('Control Panel Home', () => WS.apps.launch('control')),
        id === 'updates' ? link('Uninstall a program', () => go('programs')) : link('View installed updates', () => go('updates')),
        link('Turn Windows features on or off', features, true));
      U.clear(main);
      if (id === 'updates') updates(); else programs();
      return page;
    }
    function toolbar(buttons) { return h('div.aw-toolbar', h('button.aw-tb', { disabled: true }, 'Organize \u25be'), ...buttons); }
    function programs() {
      const unBtn = h('button.aw-tb', { dataset: { action: 'uninstall' }, onClick: () => uninstall() }, 'Uninstall');
      const tb = toolbar([unBtn]);
      lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 270 }, { key: 'publisher', label: 'Publisher', width: 160 }, { key: 'installedOn', label: 'Installed On', width: 90, type: 'date', render: r => U.fmtDate(new Date(r.installedOn)) },
        { key: 'sizeKB', label: 'Size', width: 70, type: 'num', align: 'right', render: r => (r.sizeKB ? (r.sizeKB >= 1024 ? (r.sizeKB / 1024).toFixed(1) + ' MB' : r.sizeKB + ' KB') : '') }, { key: 'version', label: 'Version', width: 110 }],
        rows: () => WS.programs.list(), getId: r => r.id, icon: () => I.fileExe,
        onSelect: () => sync(), onActivate: () => uninstall(), onContext: rows => { if (rows.length) WS.ui.contextMenu(lastX, lastY, [{ label: '&Uninstall', default: true, disabled: rows[0].system, action: () => uninstall() }]); } });
      let lastX = 0, lastY = 0;
      lv.el.addEventListener('contextmenu', e => { lastX = e.clientX; lastY = e.clientY; }, true);
      const foot = h('div.aw-foot');
      const sync = () => {
        const sel = lv.selected()[0];
        unBtn.style.display = sel ? '' : 'none';
        unBtn.disabled = !sel || !!sel.system;
        const list = WS.programs.list(), total = list.reduce((a, p) => a + p.sizeKB, 0);
        U.clear(foot).append(h('span', { html: ICON.programs }), h('div', h('b', 'Currently installed programs'), `  Total size: ${(total / 1024).toFixed(1)} MB`, h('div', `${list.length} programs installed`)));
      };
      main.append(h('h1.cp-h1', 'Uninstall or change a program'), h('p', 'To uninstall a program, select it from the list and then click Uninstall, Change, or Repair.'), tb, h('div.aw-list', lv.el), foot);
      sync();
      win.listen('programs', () => { if (page === 'programs') { lv.refresh(); sync(); } });
    }
    async function uninstall() {
      const p = lv && lv.selected()[0];
      if (!p || p.system) return false;
      const r = await WS.ui.msgbox({ title: 'Programs and Features', icon: 'question', message: `Are you sure you want to uninstall ${p.name}?`, buttons: ['Yes', 'No'] });
      if (r !== 'Yes') return false;
      const res = WS.programs.uninstall(p.id);
      if (!res.ok) await WS.ui.msgbox({ title: 'Programs and Features', icon: 'error', message: res.error });
      return res.ok;
    }
    function updates() {
      const rows = () => (WS.wu ? WS.wu.hotfixes() : []).map(x => ({ id: x.kb, name: `${x.kind === 'Security Update' ? 'Security Update' : 'Update'} for Microsoft Windows (${x.kb})`, program: 'Microsoft Windows', version: '', publisher: 'Microsoft Corporation', installedOn: x.installedOn }));
      lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 300 }, { key: 'program', label: 'Program', width: 130 }, { key: 'version', label: 'Version', width: 60 }, { key: 'publisher', label: 'Publisher', width: 140 },
        { key: 'installedOn', label: 'Installed On', width: 100, type: 'date', render: r => U.fmtDate(r.installedOn) }],
        rows, getId: r => r.id, icon: () => I.task, groupLabel: list => `Microsoft Windows (${list.length})` });
      main.append(h('h1.cp-h1', 'Uninstall an update'), h('p', 'To uninstall an update, select it from the list and then click Uninstall or Change.'), toolbar([]), h('div.aw-list', lv.el));
      win.listen('updates', () => { if (page === 'updates') lv.refresh(); });
    }
    win.appwiz = { page: () => page, go, get list() { return lv; }, select: name => { const p = WS.programs.find(name); if (p) lv.select([p.id]); return !!p; }, uninstall, features };
    go(args.page === 'updates' ? 'updates' : 'programs');
    return win;
  }

  WS.apps.register({ id: 'control', name: 'Control Panel', icon: ICON.app, keywords: ['control', 'control panel', 'control.exe'], launch });
  WS.apps.register({ id: 'appwiz', name: 'Programs and Features', icon: ICON.programs, keywords: ['appwiz.cpl', 'programs and features', 'uninstall a program', 'installed updates'], launch: appwiz });
  WS.control = { ITEMS, CATS, hidden, ICON };
})();
