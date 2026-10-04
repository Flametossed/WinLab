/* Taskbar flyouts: Quick Settings (network, accessibility, volume), the notification center with the calendar, and toasts.
 *   WS.shell.toast({ app, title, text, icon, action, timeout }) -> notification (also kept in the notification center for
 *     the session; with Do not disturb on, or notifications off in Settings, it goes there without a banner)
 *   WS.shell.quickSettings() / notificationCenter() toggle the flyouts; notifications(), clearNotifications(), unreadCount(),
 *   volume() -> { level, muted }, setVolume(level, muted), colorFilter(on).
 * User policy "Remove Notifications and Action Center" leaves the clock flyout with only the calendar. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons;
  const gpOn = (side, key) => !!(WS.gpo && WS.gpo.policyEnabled(side, key));
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const IC = {
    ethernet: s16('<rect x="3" y="2" width="10" height="7" rx="1" fill="none" stroke="currentColor"/><path d="M8 9v3M4 14h8M8 12v2" stroke="currentColor"/>'),
    access: s16('<circle cx="8" cy="2.8" r="1.4" fill="currentColor"/><path d="M2.5 5.5L8 6.5l5.5-1M8 6.5V10l-2.5 4.5M8 10l2.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
    gear: s16('<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor"/>'),
    pencil: s16('<path d="M3 13l1-3.5L11 2.5 13.5 5l-7 7z" fill="none" stroke="currentColor"/>'),
    chevron: s16('<path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
    back: s16('<path d="M10 3.5L5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
    up: s16('<path d="M3.5 10L8 5.5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
    down: s16('<path d="M3.5 6L8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
    bell: s16('<path d="M8 2a4 4 0 0 0-4 4v3L2.5 11.5h11L12 9V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor"/>'),
    bellOff: s16('<path d="M8 2a4 4 0 0 0-4 4v3L2.5 11.5h11L12 9V6a4 4 0 0 0-4-4zM6.5 13a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor"/><path d="M2 2l12 12" stroke="currentColor"/>'),
    close: s16('<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2"/>'),
    speaker: s16('<path d="M2 6h3l4-3v10L5 10H2z" fill="none" stroke="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor"/>'),
    muted: s16('<path d="M2 6h3l4-3v10L5 10H2z" fill="none" stroke="currentColor"/><path d="M11 6l4 4M15 6l-4 4" stroke="currentColor"/>')
  };

  /* ---------------- session state (not saved: a restart clears it, as Windows clears banners) ---------------- */
  let notes = [];
  const vol = { level: 50, muted: false };
  let colorFilter = false;
  const fly = () => document.getElementById('flyouts');
  const prefs = () => (WS.personal ? WS.personal.get() : { notifications: true, dnd: false });

  /* ================================================================ toasts */
  function toastLayer() {
    let el = document.getElementById('toasts');
    if (!el) { el = h('div', { id: 'toasts' }); document.getElementById('screen').appendChild(el); }
    return el;
  }
  function toast(o = {}) {
    const n = { id: U.uid('note'), app: o.app || 'Windows', title: o.title || '', text: o.text || '', icon: o.icon || null, action: o.action || null, time: WS.sys.now ? WS.sys.now() : new Date(), read: false };
    if (!gpOn('user', 'DisableNotificationCenter')) { notes.unshift(n); notes = notes.slice(0, 30); }
    WS.shell.refreshTray();
    const p = prefs();
    if (!WS.session.loggedIn || !p.notifications || p.dnd) return n;
    const layer = toastLayer();
    let timer;
    const dismiss = () => { clearTimeout(timer); el.remove(); };
    const el = h('div.toast', { dataset: { id: n.id } },
      h('div.toast-head', h('span.toast-app', n.icon ? h('span.toast-ico', { html: n.icon }) : null, n.app), h('button.toast-x', { html: IC.close, title: 'Dismiss', onClick: e => { e.stopPropagation(); dismiss(); } })),
      h('div.toast-title', n.title), n.text ? h('div.toast-text', n.text) : null);
    el.addEventListener('click', () => { dismiss(); n.read = true; WS.shell.refreshTray(); if (n.action) n.action(); });
    layer.appendChild(el);
    while (layer.children.length > 3) layer.firstChild.remove();
    timer = setTimeout(dismiss, o.timeout || 7000);
    return n;
  }

  /* ================================================================ Quick Settings */
  function quickSettings(view) {
    const f = fly();
    if (f.querySelector('.qs') && !view) return WS.shell.closeFlyouts();
    WS.shell.closeFlyouts();
    const panel = h('div.flyout.qs');
    f.appendChild(panel);
    const a = WS.net.adapter();
    const netName = () => (WS.ncpa ? WS.ncpa.networkName(a) : 'Network');
    const conn = () => (WS.ncpa ? WS.ncpa.connectivity(a) : 'Internet');
    const connected = () => a.enabled && a.connected && WS.net.usable(a);

    function main() {
      U.clear(panel);
      const tile = (cls, icon, label, sub, on, open, toggle) => h('div.qs-tile' + cls + (on ? '.on' : ''),
        h('button.qs-tbtn', { html: icon, title: label, onClick: toggle || open }), h('div.qs-tlabel', label, sub ? h('small', sub) : null),
        open ? h('button.qs-tmore', { html: IC.chevron, title: `Manage ${label.toLowerCase()} settings`, onClick: open }) : null);
      const slider = h('input.qs-range', { type: 'range', min: 0, max: 100, value: vol.level });
      slider.dataset.field = 'volume';
      const pct = h('span.qs-pct', String(vol.level));
      const spk = h('button.qs-spk', { html: vol.muted ? IC.muted : IC.speaker, title: vol.muted ? 'Unmute' : 'Mute', onClick: () => { setVolume(vol.level, !vol.muted); main(); } });
      slider.addEventListener('input', () => { setVolume(+slider.value, vol.muted && +slider.value === 0); pct.textContent = slider.value; });
      panel.append(
        h('div.qs-tiles',
          tile('.qs-net', IC.ethernet, connected() ? netName() : 'Network', connected() ? (conn() === 'Internet' ? null : 'No internet') : 'Not connected', connected(), () => quickSettings('network')),
          tile('.qs-acc', IC.access, 'Accessibility', null, colorFilter, () => quickSettings('access'))),
        h('div.qs-vol', spk, slider, pct),
        h('div.qs-foot', h('span'), h('button.qs-fbtn', { html: IC.pencil, title: 'Edit quick settings', disabled: true }),
          h('button.qs-fbtn', { html: IC.gear, title: 'All settings', onClick: () => { WS.shell.closeFlyouts(); WS.apps.launch('settings'); } })));
    }
    function sub(title, ...body) {
      U.clear(panel);
      panel.append(h('div.qs-sub', h('div.qs-subhead', h('button.qs-back', { html: IC.back, title: 'Back', onClick: main }), h('span', title)), ...body));
    }
    function network() {
      sub('Ethernet',
        h('div.qs-net-item' + (connected() ? '.on' : ''), h('span.qs-net-ico', { html: IC.ethernet }),
          h('div', h('div', a.name), h('small', !a.enabled ? 'Disabled' : !a.connected ? 'Network cable unplugged' : `${netName()}, ${conn() === 'Internet' ? 'Connected' : 'No internet'}`))),
        h('div.qs-link', { onClick: () => { WS.shell.closeFlyouts(); WS.apps.launch('settings', { page: 'network' }); } }, 'More Internet settings'));
    }
    function access() {
      const sw = h('button.toggle' + (colorFilter ? '.on' : ''), { role: 'switch', 'aria-checked': String(colorFilter), dataset: { field: 'colorfilters' }, onClick: () => { setColorFilter(!colorFilter); access(); } }, h('i'));
      sub('Accessibility',
        h('div.qs-acc-row', h('span', 'Color filters'), sw),
        h('div.qs-link', { onClick: () => { WS.shell.closeFlyouts(); WS.apps.launch('settings', { page: 'accessibility' }); } }, 'More accessibility settings'));
    }
    ({ network, access }[view] || main)();
    return panel;
  }

  function setVolume(level, muted) {
    vol.level = Math.max(0, Math.min(100, Math.round(level)));
    vol.muted = !!muted;
    WS.shell.refreshTray();
  }
  function setColorFilter(on) {
    colorFilter = !!on;
    document.getElementById('screen').classList.toggle('color-filter', colorFilter);
  }

  /* ================================================================ notification center + calendar */
  let calMonth = null;
  function notificationCenter() {
    const f = fly();
    if (f.querySelector('.nc')) return WS.shell.closeFlyouts();
    WS.shell.closeFlyouts();
    // opening the center dismisses the banners on screen
    const tl = document.getElementById('toasts');
    if (tl) U.clear(tl);
    const today = WS.sys.now ? WS.sys.now() : new Date();
    calMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const panel = h('div.flyout.nc');
    f.appendChild(panel);
    const showNotes = !gpOn('user', 'DisableNotificationCenter');

    function paintNotes(card) {
      U.clear(card);
      const p = prefs();
      card.append(h('div.nc-head', h('span', 'Notifications'),
        h('div.nc-headbtns',
          notes.length ? h('button.nc-clear', { onClick: () => { notes = []; paintNotes(card); WS.shell.refreshTray(); } }, 'Clear all') : null,
          h('button.nc-dnd' + (p.dnd ? '.on' : ''), { html: p.dnd ? IC.bellOff : IC.bell, title: p.dnd ? 'Turn off do not disturb' : 'Do not disturb', dataset: { field: 'dnd' },
            onClick: () => { WS.personal.set({ dnd: !p.dnd }); paintNotes(card); WS.shell.refreshTray(); } }))));
      if (!notes.length) { card.append(h('div.nc-empty', 'No new notifications')); return; }
      const groups = [...new Set(notes.map(n => n.app))];
      for (const app of groups) {
        card.append(h('div.nc-app', app));
        for (const n of notes.filter(x => x.app === app)) {
          card.append(h('div.nc-note', { dataset: { id: n.id }, onClick: () => { WS.shell.closeFlyouts(); if (n.action) n.action(); } },
            h('div.nc-note-head', h('b', n.title), h('span.nc-time', U.fmtTime(n.time)),
              h('button.nc-x', { html: IC.close, title: 'Clear', onClick: e => { e.stopPropagation(); notes = notes.filter(x => x !== n); paintNotes(card); WS.shell.refreshTray(); } })),
            n.text ? h('div.nc-note-text', n.text) : null));
        }
      }
      notes.forEach(n => { n.read = true; });
      WS.shell.refreshTray();
    }

    function paintCal(card) {
      U.clear(card);
      const head = h('div.cal-title', `${U.DAYS[today.getDay()]}, ${U.MONTHS[today.getMonth()]} ${today.getDate()}`);
      const month = h('div.cal-month', `${U.MONTHS[calMonth.getMonth()]} ${calMonth.getFullYear()}`);
      const nav = d => () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + d, 1); paintCal(card); };
      const grid = h('div.cal-grid', ...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => h('span.cal-dow', d)));
      const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1 - calMonth.getDay());
      for (let i = 0; i < 42; i++) {
        const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
        const isToday = d.toDateString() === today.toDateString();
        grid.append(h('span.cal-day' + (d.getMonth() !== calMonth.getMonth() ? '.other' : '') + (isToday ? '.today' : ''), { dataset: { date: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` } }, String(d.getDate())));
      }
      card.append(h('div.cal-head', head), h('div.cal-nav', month, h('button.cal-btn', { html: IC.up, title: 'Previous month', onClick: nav(-1) }), h('button.cal-btn', { html: IC.down, title: 'Next month', onClick: nav(1) })), grid);
    }

    if (showNotes) { const c = h('div.nc-card.nc-notes'); panel.appendChild(c); paintNotes(c); }
    const cal = h('div.nc-card.nc-cal');
    panel.appendChild(cal);
    paintCal(cal);
    return panel;
  }

  Object.assign(WS.shell, {
    toast, quickSettings, notificationCenter, setVolume, colorFilter: setColorFilter,
    notifications: () => notes.slice(), clearNotifications: () => { notes = []; WS.shell.refreshTray(); },
    unreadCount: () => notes.filter(n => !n.read).length,
    volume: () => ({ ...vol })
  });

  /* ---- lab objectives raise a toast as they complete (the Lab Guide shows the same progress) ---- */
  let seen = null;
  WS.store.on('change:lab', () => {
    if (!WS.state) return;
    const p = WS.labs && WS.labs.progress();
    if (!p) { seen = null; return; }
    const done = new Set(Object.keys(WS.state.lab.completed || {}));
    if (seen && seen.lab === p.lab.id) {
      const fresh = p.items.filter(o => o.done && !seen.done.has(o.id));
      for (const o of fresh) toast({ app: 'Lab Guide', icon: I.lab, title: 'Objective complete', text: `${o.text} (${p.doneCount} of ${p.total})`, action: () => WS.apps.launch('lab') });
      if (fresh.length && p.doneCount === p.total) toast({ app: 'Lab Guide', icon: I.lab, title: 'Lab complete', text: `You finished "${p.lab.title}".`, action: () => WS.apps.launch('lab') });
    }
    seen = { lab: p.lab.id, done };
  });
  // the starting point (page load, and every boot, which is how a lab starts): objectives already complete don't toast again
  const baseline = () => { if (!WS.state) return; const p = WS.labs && WS.labs.progress(); seen = p ? { lab: p.lab.id, done: new Set(Object.keys(WS.state.lab.completed || {})) } : null; };
  setTimeout(baseline, 0);
  WS.sys.on('boot', baseline);
})();
