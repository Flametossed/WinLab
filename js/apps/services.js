/* Services (services.msc) - the reference tool for the MMC frame: one scope node with a list view,
 * Extended view panel, snap-in toolbar, context menus, and a property sheet. Everything goes through WS.svc,
 * so changes made here show up in Get-Service / sc.exe and vice versa. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons, F = () => WS.ui.f;

  /** Image paths as sc qc / the General tab show them (kept in the model so Task Manager agrees). */
  const pathOf = name => WS.svc.pathOf(name);
  const logonLabel = l => (l === 'Local System' ? 'Local System' : l);
  const STARTUP = ['Automatic (Delayed Start)', 'Automatic', 'Manual', 'Disabled'];
  /** The Startup type drop-down has no "(Trigger Start)" variants. */
  const choice = t => (/^Automatic \(Delayed/.test(t) ? STARTUP[0] : /^Automatic/.test(t) ? STARTUP[1] : /^Manual/.test(t) ? STARTUP[2] : STARTUP[3]);

  function launch() {
    const mmc = WS.mmc.create({
      app: 'services', title: 'Services', icon: I.services, width: 1040, height: 640, topics: ['services', 'features', 'system'],
      nodes: () => [{ id: 'svc-local', label: 'Services (Local)', icon: I.services, view: listView }]
    });
    return mmc.win;
  }

  const listView = {
    columns: [
      { key: 'display', label: 'Name', width: 220 },
      { key: 'description', label: 'Description', width: 250 },
      { key: 'status', label: 'Status', width: 70 },
      { key: 'startup', label: 'Startup Type', width: 150 },
      { key: 'logon', label: 'Log On As', width: 120, value: r => logonLabel(r.logon) }
    ],
    rows: () => WS.svc.list(),
    getId: r => r.name,
    icon: () => I.service,
    sortKey: 'display',
    multi: true,
    itemLabel: r => r.display,
    menu: (rows, mmc) => {
      if (!rows.length) return [];
      const r = rows[0];
      const one = rows.length === 1;
      const canStart = one && r.status !== 'Running';
      const canStop = one && r.canStop;
      const tasks = () => [
        { label: '&Start', disabled: !canStart, action: () => startSvc(r) },
        { label: 'S&top', disabled: !canStop, action: () => stopSvc(r) },
        { label: '&Pause', disabled: true },
        { label: 'R&esume', disabled: true },
        { label: 'Rest&art', disabled: !canStop, action: () => restartSvc(r) }
      ];
      return [
        ...tasks(),
        { separator: true },
        { label: 'All Tas&ks', items: tasks },
        { separator: true },
        { label: 'Re&fresh', action: () => mmc.refresh() }
      ];
    },
    properties: r => properties(r.name),
    toolbar: [
      { icon: I.play, title: 'Start Service', action: rows => startSvc(rows[0]), enabled: rows => rows.length === 1 && rows[0].status !== 'Running' },
      { icon: I.stop, title: 'Stop Service', action: rows => stopSvc(rows[0]), enabled: rows => rows.length === 1 && rows[0].canStop },
      { icon: I.pause, title: 'Pause Service', action: () => {}, enabled: () => false },
      { icon: I.restart, title: 'Restart Service', action: rows => restartSvc(rows[0]), enabled: rows => rows.length === 1 && rows[0].canStop }
    ],
    extended: rows => {
      if (rows.length !== 1) return h('div', h('h3', ''), h('div', 'Select an item to view its description.'));
      const r = rows[0];
      const links = [];
      if (r.status !== 'Running') links.push(WS.ui.f.link('Start', () => startSvc(r)), ' the service');
      else if (r.canStop) links.push(WS.ui.f.link('Stop', () => stopSvc(r)), ' the service', h('br'), WS.ui.f.link('Restart', () => restartSvc(r)), ' the service');
      return h('div', h('h3', r.display), h('div', ...links), h('p', h('span', 'Description:'), h('br'), r.description));
    },
    status: () => ''
  };

  /* ---------------- start / stop with the real dialogs ---------------- */
  async function control(verb, display, fn) {
    const p = WS.ui.progress({ title: 'Service Control', text: `Windows is attempting to ${verb} the following service on Local Computer...\n\n${display}` });
    for (const pct of [20, 55, 85]) { p.set(pct); await U.sleep(180); }
    const r = fn();
    p.set(100); await U.sleep(120);
    p.close();
    return r;
  }
  function failBox(verb, r, svc) {
    const code = typeof r.code === 'number' ? r.code : verb === 'start' ? 1058 : 1052;
    return WS.ui.msgbox({ title: 'Services', icon: 'error', message: `Windows could not ${verb} the ${svc.display} service on Local Computer.\n\nError ${code}: ${r.detail || r.error}` });
  }
  async function startSvc(svc) {
    const r = await control('start', svc.display, () => WS.svc.start(svc.name));
    if (!r.ok) await failBox('start', r, svc);
    return r;
  }
  async function stopSvc(svc) {
    const running = WS.svc.dependents(svc.name).filter(d => d.status === 'Running');
    if (running.length) {
      const list = h('div.lv-mini', ...running.map(d => h('div', d.display)));
      const ans = await WS.ui.dialog({ title: 'Stop Other Services', icon: null, width: 420,
        content: h('div.w32', h('div', `When ${svc.display} stops, these other services will also stop.`), h('div.grp', { style: 'height:90px;overflow:auto;background:#fff' }, list), h('div', 'Do you want to stop these services?')),
        buttons: [{ label: 'Yes', primary: true }, { label: 'No', cancel: true }] });
      if (ans !== 'Yes') return { ok: false, cancelled: true };
    }
    const r = await control('stop', svc.display, () => WS.svc.stop(svc.name, { force: true }));
    if (!r.ok) await failBox('stop', r, svc);
    return r;
  }
  async function restartSvc(svc) {
    const r = await stopSvc(svc);
    if (!r.ok) return r;
    return startSvc(WS.svc.get(svc.name));
  }

  /* ---------------- properties ---------------- */
  /** opts.onCreate(sheet) receives the live property sheet (tests use it). */
  function properties(name, opts = {}) {
    const s0 = WS.svc.get(name);
    if (!s0) return null;
    let startupSel, statusVal, btns = {};
    const paintStatus = () => {
      const s = WS.svc.get(name);
      statusVal.textContent = s.status;
      btns.start.disabled = s.status === 'Running';
      btns.stop.disabled = !s.canStop;
    };
    return WS.ui.propertySheet({
      title: `${s0.display} Properties (Local Computer)`, width: 410, errorTitle: 'Services',
      onCreate: opts.onCreate,
      tabs: [
        {
          label: 'General',
          render: () => {
            startupSel = F().select(STARTUP, choice(s0.startup), { width: 220 });
            statusVal = h('span', s0.status);
            const act = fn => async () => { await fn(WS.svc.get(name)); paintStatus(); };
            btns.start = F().button('Start', act(startSvc));
            btns.stop = F().button('Stop', act(stopSvc));
            btns.pause = F().button('Pause', () => {}, { disabled: true });
            btns.resume = F().button('Resume', () => {}, { disabled: true });
            [btns.start, btns.stop, btns.pause, btns.resume].forEach(b => b.setAttribute('data-nodirty', ''));
            setTimeout(paintStatus, 0);
            return h('div',
              F().row('Service name:', F().value(s0.name), { labelWidth: 100 }),
              F().row('Display name:', F().text({ value: s0.display, readOnly: true }), { labelWidth: 100 }),
              F().row('Description:', F().textarea({ value: s0.description, readOnly: true, rows: 3 }), { labelWidth: 100 }),
              F().stack('Path to executable:', F().text({ value: pathOf(s0.name), readOnly: true })),
              F().row('Startup type:', startupSel, { labelWidth: 100 }),
              F().sep(),
              F().row('Service status:', statusVal, { labelWidth: 100 }),
              h('div', { style: 'display:flex;gap:8px;margin:8px 0' }, btns.start, btns.stop, btns.pause, btns.resume),
              F().note('You can specify the start parameters that apply when you start the service from here.'),
              F().row('Start parameters:', F().text({ disabled: s0.status === 'Running' }), { labelWidth: 100 }));
          },
          apply: () => {
            const want = startupSel.value;
            const cur = WS.svc.get(name).startup;
            if (want === choice(cur)) return null;
            return WS.svc.setStartup(name, { [STARTUP[0]]: 'AutomaticDelayedStart', [STARTUP[1]]: 'Automatic', [STARTUP[2]]: 'Manual', [STARTUP[3]]: 'Disabled' }[want]);
          }
        },
        {
          label: 'Log On',
          render: () => {
            const ls = s0.logon === 'Local System';
            return h('div',
              h('div', 'Log on as:'),
              F().radio('logon-' + name, 'Local System account', ls, { disabled: true }),
              h('div', { style: 'padding-left:20px' }, F().checkbox('Allow service to interact with desktop', false, { disabled: true })),
              F().radio('logon-' + name, 'This account:', !ls, { disabled: true }),
              h('div', { style: 'padding-left:20px' },
                F().row('', F().text({ value: ls ? '' : `NT AUTHORITY\\${s0.logon.replace(/ /g, '')}`, disabled: true }), { labelWidth: 0 }),
                F().row('Password:', F().text({ password: true, value: ls ? '' : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', disabled: true }), { labelWidth: 100 }),
                F().row('Confirm password:', F().text({ password: true, value: ls ? '' : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022', disabled: true }), { labelWidth: 100 })),
              F().note('Changing the account a service runs as is not modelled in this lab.'));
          }
        },
        {
          label: 'Recovery',
          render: () => {
            const action = v => F().select(['Take No Action', 'Restart the Service', 'Run a Program', 'Restart the Computer'], v, { width: 190, disabled: true });
            return h('div',
              F().note('Select the computer\'s response if this service fails.'),
              F().row('First failure:', action('Restart the Service'), { labelWidth: 170 }),
              F().row('Second failure:', action('Restart the Service'), { labelWidth: 170 }),
              F().row('Subsequent failures:', action('Take No Action'), { labelWidth: 170 }),
              F().row('Reset fail count after:', h('span', F().number({ value: 1, disabled: true }), ' days'), { labelWidth: 170 }),
              F().row('Restart service after:', h('span', F().number({ value: 1, disabled: true }), ' minutes'), { labelWidth: 170 }),
              F().checkbox('Enable actions for stops with errors.', false, { disabled: true }));
          }
        },
        {
          label: 'Dependencies',
          render: () => {
            const nodeFor = (svc, dir, seen = new Set()) => {
              const kids = dir === 'down' ? svc.dependsOn.map(n => WS.svc.get(n)).filter(Boolean) : svc.dependents.map(n => WS.svc.get(n)).filter(Boolean);
              const id = dir + ':' + [...seen, svc.name].join('/');
              const top = seen.size === 0;
              return { id, label: svc.display, icon: I.service,
                children: () => (kids.length || !top ? kids.filter(k => !seen.has(k.name)).map(k => nodeFor(k, dir, new Set([...seen, svc.name])))
                  : [{ id: id + ':none', label: '<No Dependencies>' }]) };
            };
            const s = WS.svc.get(name);
            const t1 = WS.ui.tree({ nodes: () => [{ ...nodeFor(s, 'down'), expanded: true }] });
            const t2 = WS.ui.tree({ nodes: () => [{ ...nodeFor(s, 'up'), expanded: true }] });
            t1.el.style.height = t2.el.style.height = '120px';
            t1.el.style.border = t2.el.style.border = '1px solid #828790';
            return h('div',
              F().note('Some services depend on other services, system drivers or load order groups. If a system component is stopped, or is not running properly, dependent services can be affected.'),
              h('div', { style: 'margin-top:8px' }, s.display), h('div', 'This service depends on the following system components:'), t1.el,
              h('div', { style: 'margin-top:10px' }, 'The following system components depend on this service:'), t2.el);
          }
        }
      ]
    });
  }

  WS.apps.register({ id: 'services', name: 'Services', icon: I.services, launch });
  /** The Services snap-in node, for Computer Management > Services and Applications > Services. */
  const snapin = (o = {}) => ({ node: { id: o.id || 'svc-local', label: o.label || 'Services', icon: I.services, view: listView } });
  WS.services = { startSvc, stopSvc, restartSvc, properties, pathOf, view: listView, snapin };
})();
