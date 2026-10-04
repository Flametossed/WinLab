/* Windows Defender Firewall control panel (firewall.cpl): the status page, Allowed apps, Customize Settings (turn on/off,
 * block all incoming, notifications) and Restore defaults; Advanced settings opens wf.msc. Everything goes through WS.fw.
 * "Allowed apps and features" works on rule groups: a group is allowed on a profile while one of its enabled inbound rules
 * applies to that profile, and ticking boxes enables the group's rules for exactly the ticked profiles.
 *   WS.firewallcpl.launch({ page: 'home' | 'allowed' | 'customize' | 'restore' }) -> win; win.firewallcpl = { page(), go(name),
 *     changeSettings(), toggle(group, profile | 'on', value), ok(), cancel(), restore() }
 *   allowedApps() -> [{ group, Domain, Private, Public }] (what the list shows); setAllowed(group, profiles[]) */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, F = WS.ui.f, FWM = WS.fw;
  const TITLE = 'Windows Defender Firewall';
  const PROFILES = ['Domain', 'Private', 'Public'];
  const NET = { Domain: 'Domain networks', Private: 'Private networks', Public: 'Guest or public networks' };
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const SHIELD = c => s16(`<path d="M8 1.2l5.6 2v4.2c0 3.4-2.3 6.1-5.6 7.4C4.7 13.5 2.4 10.8 2.4 7.4V3.2z" fill="${c}"/>`);
  const ICON = { app: WS.wf ? WS.wf.ICON.app : SHIELD('#d9772b'), on: SHIELD('#0f7b0f'), off: SHIELD('#c42b1c'), uac: s16('<path d="M8 1.5l5 2v4c0 3-2 5.4-5 6.6-3-1.2-5-3.6-5-6.6v-4z" fill="#2f7fd8"/><path d="M8 1.5v12.6c3-1.2 5-3.6 5-6.6v-4z" fill="#f2b631"/>') };
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const applies = (r, p) => r.profile === 'Any' || r.profile.split(/,\s*/).includes(p);

  /** The groups the Allowed apps list shows, with the profiles each one is allowed on. */
  function allowedApps() {
    const groups = [...new Set(FWM.rules({ direction: 'Inbound' }).map(r => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return groups.map(group => {
      const rules = FWM.rules({ direction: 'Inbound', group }).filter(r => r.enabled && r.action === 'Allow');
      return { group, ...Object.fromEntries(PROFILES.map(p => [p, rules.some(r => applies(r, p))])) };
    });
  }
  /** Allow a group on exactly these profiles (none: disable its inbound rules). */
  function setAllowed(group, profiles) {
    const rules = FWM.rules({ direction: 'Inbound', group });
    if (!rules.length) return { ok: false, error: `No rules are defined for ${group}.` };
    for (const r of rules) {
      const res = profiles.length ? FWM.setRule(r.name, { enabled: true, action: 'Allow', profile: profiles }) : FWM.setRule(r.name, { enabled: false });
      if (!res.ok) return res;
    }
    return { ok: true };
  }

  function launch(opts = {}) {
    const win = WS.wm.create({ app: 'firewall', title: TITLE, icon: ICON.app, width: 980, height: 640 });
    let page = 'home', unlocked = false, draft = null, custom = null;
    const crumbs = h('div.cp-crumbs');
    const nav = h('div.cp-nav');
    const main = h('div.cp-main');
    win.body.appendChild(h('div.cp', h('div.cp-bar', crumbs), h('div.cp-body', nav, main)));
    const link = (text, fn, uac) => h('a.cp-link', { href: '#', onClick: e => { e.preventDefault(); fn(); } }, uac ? h('span.cp-uac', { html: ICON.uac }) : null, text);

    function paintNav() {
      U.clear(nav);
      if (page !== 'home') return;
      nav.append(link('Control Panel Home', () => WS.apps.launch('control')),
        link('Allow an app or feature through Windows Defender Firewall', () => go('allowed')),
        link('Change notification settings', () => go('customize'), true), link('Turn Windows Defender Firewall on or off', () => go('customize'), true),
        link('Restore defaults', () => go('restore'), true), link('Advanced settings', () => WS.apps.launch('wf'), true), link('Troubleshoot my network', () => WS.apps.notImplemented('Network troubleshooter')),
        h('div.cp-see', 'See also'), link('Security and Maintenance', () => WS.apps.notImplemented('Security and Maintenance')), link('Network and Sharing Center', () => WS.apps.launch('netcenter')));
    }
    function home() {
      const act = FWM.activeProfile();
      const bad = PROFILES.some(p => !FWM.profile(p).enabled);
      const net = p => (p === 'Domain' && WS.sys.isDC() ? WS.state.system.domain : p === act ? 'Network' : null);
      const rows = p => {
        const d = FWM.profile(p);
        return h('div.cp-table',
          h('div.cp-tr', h('span', 'Windows Defender Firewall state:'), h('span', d.enabled ? 'On' : 'Off')),
          h('div.cp-tr', h('span', 'Incoming connections:'), h('span', d.blockAll ? 'Block all connections to apps, including those on the list of allowed apps' : 'Block all connections to apps that are not on the list of allowed apps')),
          h('div.cp-tr', h('span', `Active ${p === 'Public' ? 'public' : p.toLowerCase()} networks:`), h('span', net(p) || 'None')),
          h('div.cp-tr', h('span', 'Notification state:'), h('span', d.notify ? 'Notify me when Windows Defender Firewall blocks a new app' : 'Do not notify me when Windows Defender Firewall blocks a new app')));
      };
      return [
        h('h1.cp-h1', 'Help protect your PC with Windows Defender Firewall'),
        h('p', 'Windows Defender Firewall can help prevent hackers or malicious software from gaining access to your PC through the Internet or a network.'),
        bad ? h('div.cp-warn', h('span.cp-wic', { html: ICON.off }), h('div', h('b', 'Update your Firewall settings'), h('div', 'Windows Defender Firewall is not using the recommended settings to protect your computer.')),
          field('recommended', F.button('Use recommended settings', () => { for (const p of PROFILES) FWM.setProfile(p, { enabled: true }); }))) : null,
        ...PROFILES.map(p => {
          const on = FWM.profile(p).enabled, conn = p === act;
          return h('div.cp-sec' + (conn ? '.open' : ''), h('div.cp-sech', h('span.cp-sic', { html: on ? ICON.on : ICON.off }), h('span.cp-sname', NET[p]), h('span.cp-conn', conn ? 'Connected' : 'Not connected')),
            conn ? rows(p) : null);
        })
      ];
    }
    function allowed() {
      if (!draft) draft = Object.fromEntries(allowedApps().map(a => [a.group, { on: PROFILES.some(p => a[p]), ...Object.fromEntries(PROFILES.map(p => [p, a[p]])) }]));
      const table = h('div.cp-apps', h('div.cp-arow.head', h('span', 'Name'), ...PROFILES.map(p => h('span', p))),
        ...Object.entries(draft).map(([group, d]) => {
          const cb = (key, label) => field(`app-${group}-${key}`, h('input', { type: 'checkbox', checked: d[key], disabled: !unlocked, title: label, onChange: e => toggle(group, key, e.target.checked) }));
          return h('div.cp-arow', h('label.cp-aname', cb('on', group), h('span', group)), ...PROFILES.map(p => h('span.cp-acb', cb(p, p))));
        }));
      return [
        h('h1.cp-h1', 'Allow apps to communicate through Windows Defender Firewall'),
        h('p', 'To add, change, or remove allowed apps and ports, click Change settings.'),
        h('div.cp-row', F.link('What are the risks of allowing an app to communicate?', () => WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'Allowing an app through the firewall lets other computers on the network connect to it. Only allow apps and features you trust, and only on the network types that need them.' })),
          field('change', h('button.btn.cp-change', { disabled: unlocked, onClick: () => changeSettings() }, h('span.cp-uac', { html: ICON.uac }), 'Change settings'))),
        h('div.cp-lbl', 'Allowed apps and features:'), table,
        h('div.cp-row.right', F.button('Details...', () => {}, { disabled: true }), F.button('Remove', () => {}, { disabled: true })),
        h('div.cp-row.right', F.button('Allow another app...', () => WS.apps.notImplemented('Add an app'), { disabled: !unlocked })),
        okCancel(applyAllowed)
      ];
    }
    function customize() {
      if (!custom) custom = Object.fromEntries(PROFILES.map(p => { const d = FWM.profile(p); return [p, { enabled: d.enabled, blockAll: d.blockAll, notify: d.notify }]; }));
      const blocks = PROFILES.map(p => {
        const d = custom[p], g = U.uid('cps');
        const on = field(`${p}-on`, F.radio(g, 'Turn on Windows Defender Firewall', d.enabled, { onChange: v => { if (v) { d.enabled = true; paint(); } } }));
        const off = field(`${p}-off`, F.radio(g, 'Turn off Windows Defender Firewall (not recommended)', !d.enabled, { onChange: v => { if (v) { d.enabled = false; paint(); } } }));
        const block = field(`${p}-blockall`, F.checkbox('Block all incoming connections, including those in the list of allowed apps', d.blockAll, { onChange: v => { d.blockAll = v; } }));
        const notify = field(`${p}-notify`, F.checkbox('Notify me when Windows Defender Firewall blocks a new app', d.notify, { onChange: v => { d.notify = v; } }));
        const paint = () => { block.input.disabled = notify.input.disabled = !d.enabled; };
        paint();
        return h('div.cp-cust', h('h2.cp-h2', `${p === 'Public' ? 'Public' : p} network settings`),
          h('div.cp-copt', h('span.cp-sic', { html: ICON.on }), h('div', on, h('div.cp-sub', block, notify))),
          h('div.cp-copt', h('span.cp-sic', { html: ICON.off }), off));
      });
      return [h('h1.cp-h1', 'Customize settings for each type of network'), h('p', 'You can modify the firewall settings for each type of network that you use.'), ...blocks, okCancel(applyCustom)];
    }
    function restore() {
      return [h('h1.cp-h1', 'Restore default settings'),
        h('p', 'When you restore the default settings, Windows Defender Firewall will remove all Windows Defender Firewall settings that you have configured for all network locations. This might cause some apps to stop working.'),
        h('div.cp-row', field('restore', h('button.btn', { onClick: () => restoreDefaults() }, h('span.cp-uac', { html: ICON.uac }), 'Restore defaults'))),
        h('div.cp-row.right', F.button('Cancel', () => go('home')))];
    }
    const okCancel = fn => h('div.cp-row.right.cp-foot', field('ok', F.button('OK', () => fn())), field('cancel', F.button('Cancel', () => go('home'))));
    function toggle(group, key, value) {
      const d = draft[group];
      d[key] = value;
      if (key === 'on' && value && !PROFILES.some(p => d[p])) PROFILES.forEach(p => { d[p] = p === FWM.activeProfile(); });
      if (key !== 'on' && value) d.on = true;
      render();
    }
    function applyAllowed() {
      const now = Object.fromEntries(allowedApps().map(a => [a.group, a]));
      for (const [group, d] of Object.entries(draft)) {
        const want = d.on ? PROFILES.filter(p => d[p]) : [];
        const had = PROFILES.filter(p => now[group] && now[group][p]);
        if (want.join() !== had.join()) { const r = setAllowed(group, want); if (!r.ok) { WS.ui.msgbox({ title: TITLE, icon: 'error', message: r.error }); return false; } }
      }
      go('home');
      return true;
    }
    function applyCustom() {
      for (const p of PROFILES) FWM.setProfile(p, custom[p]);
      go('home');
      return true;
    }
    async function restoreDefaults() {
      const a = await WS.ui.msgbox({ title: 'Restore Defaults Confirmation', icon: 'warning', message: 'Are you sure you want to restore your settings to default?', buttons: ['Yes', 'No'] });
      if (a !== 'Yes') return false;
      FWM.restoreDefaults();
      go('home');
      return true;
    }
    function changeSettings() { unlocked = true; render(); }
    function go(name) {
      page = name;
      if (name !== 'allowed') { draft = null; unlocked = false; }
      if (name !== 'customize') custom = null;
      render();
    }
    function render() {
      const top = main.scrollTop;
      const title = { home: TITLE, allowed: 'Allowed apps', customize: 'Customize Settings', restore: 'Restore Settings' }[page];
      U.clear(crumbs);
      crumbs.append(...['Control Panel', 'System and Security', TITLE, ...(page === 'home' ? [] : [title])].flatMap((x, i) => (i ? [h('span.cp-sep', '>'), h('span', x)] : [h('span', x)])));
      win.setTitle(title);
      paintNav();
      U.clear(main);
      main.append(...({ home, allowed, customize, restore }[page])().filter(Boolean));
      main.scrollTop = top;
    }
    win.listen('firewall', () => { if (page === 'home') render(); });
    win.firewallcpl = { page: () => page, go, changeSettings, toggle, ok: () => (page === 'allowed' ? applyAllowed() : page === 'customize' ? applyCustom() : false), cancel: () => go('home'), restore: restoreDefaults };
    go(opts.page || 'home');
    return win;
  }

  WS.firewallcpl = { launch, allowedApps, setAllowed };
  WS.apps.register({ id: 'firewall', name: TITLE, icon: ICON.app, launch, keywords: ['firewall.cpl', 'firewall', 'allow an app', 'windows defender firewall'] });
})();
