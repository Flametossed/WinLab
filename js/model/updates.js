/* Windows Update: what Settings > Windows Update, Server Manager's Local Server, Get-HotFix, systeminfo and
 * Programs and Features > Installed Updates show. Checking needs the update service to be reachable (DNS + a route to the
 * Internet); downloads and installs take simulated time; the cumulative update finishes at the next restart and raises the
 * OS build, as on a real server. Events go to the System log as Microsoft-Windows-WindowsUpdateClient (19, 20, 43, 44).
 *   WS.wu.state() -> { status, lastChecked, lastInstalled, items[], error }
 *   check() -> Promise<{ ok, error, code }>; install() -> Promise<{ ok, restartRequired }>; hotfixes(); history();
 *   policy() -> null | { text, auto } from Configure Automatic Updates; timeScale (tests set it below 1).
 * State: state.updates. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util;

  /** Offered in this order. kind: what Get-HotFix calls it (null: not a hotfix, e.g. definitions). */
  const CATALOG = [
    { kb: 'KB5046617', kind: 'Security Update', restart: true, mb: 712, build: '26100.2314', title: '2024-11 Cumulative Update for Microsoft server operating system version 24H2 for x64-based Systems (KB5046617)' },
    { kb: 'KB5045934', kind: 'Update', restart: false, mb: 68, title: '2024-11 Cumulative Update for .NET Framework 3.5 and 4.8.1 for Microsoft server operating system version 24H2 for x64 (KB5045934)' },
    { kb: 'KB2267602', kind: null, restart: false, mb: 92, title: 'Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.421.1405.0) - Current Channel (Broad)' },
    { kb: 'KB890830', kind: null, restart: false, mb: 59, title: 'Windows Malicious Software Removal Tool x64 - v5.130 (KB890830)' }
  ];
  /** Packages already in the installation image (they show in Get-HotFix but not in the update history). */
  const BASELINE = [['KB5044026', 'Update'], ['KB5044284', 'Security Update']];

  WS.store.init('updates', s => {
    s.updates = { installed: BASELINE.map(([kb, kind]) => ({ kb, kind, installedOn: null, by: 'NT AUTHORITY\\SYSTEM' })), history: [], pendingRestart: [], lastChecked: null, lastInstalled: null };
  });
  const S = () => WS.state.updates;
  /** Runtime only: what this session found and how far each item has got. */
  const rt = { status: 'idle', items: [], error: null, busy: null };
  const listeners = [];
  const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } WS.store.changed('updates'); };

  const done = kb => S().installed.some(x => x.kb === kb) || S().pendingRestart.includes(kb) || S().history.some(x => x.kb === kb && x.result === 'Succeeded');
  const sleep = ms => new Promise(r => setTimeout(r, Math.max(1, ms * WU.timeScale)));
  const wuEvent = (id, msg, level) => WS.evt.write('System', { id, source: 'Microsoft-Windows-WindowsUpdateClient', level: level || 'Information', task: 'Windows Update Agent', message: msg });

  /** Can the server reach the update service? -> null or { code, error } */
  function unreachable() {
    const r = WS.net.resolve('windowsupdate.microsoft.com');
    if (!r.ok) return { code: '0x8024402c', error: "We couldn't connect to the update service. We'll try again later, or you can check now. If it still doesn't work, make sure you're connected to the internet." };
    if (WS.net.route(r.ip) !== 'routed' || !WS.state.network.lan.internet) return { code: '0x8024401c', error: "We couldn't connect to the update service. We'll try again later, or you can check now. If it still doesn't work, make sure you're connected to the internet." };
    return null;
  }

  async function check() {
    if (rt.busy) return rt.busy;
    rt.busy = (async () => {
      rt.status = 'checking'; rt.error = null; emit();
      await sleep(2500);
      const bad = unreachable();
      S().lastChecked = new Date().toISOString();
      if (bad) {
        rt.status = 'error'; rt.error = bad;
        wuEvent(20, `Installation Failure: Windows failed to install the following update with error ${bad.code}: Windows Update scan.`, 'Error');
        rt.busy = null; emit();
        return { ok: false, ...bad };
      }
      const pending = S().pendingRestart;
      rt.items = CATALOG.filter(c => !done(c.kb) || pending.includes(c.kb)).map(c => ({ ...c, state: pending.includes(c.kb) ? 'restart' : 'pending', pct: 0 }));
      rt.status = pending.length ? 'restart' : rt.items.length ? 'available' : 'uptodate';
      rt.busy = null; emit();
      return { ok: true, count: rt.items.length };
    })();
    return rt.busy;
  }

  /** Download and install everything found by the last check. */
  async function install() {
    if (rt.busy) return rt.busy;
    rt.busy = (async () => {
      const todo = rt.items.filter(i => i.state === 'pending' || i.state === 'failed');
      rt.status = 'installing'; emit();
      for (const it of todo) {
        it.state = 'downloading';
        for (const pct of [0, 25, 60, 100]) { it.pct = pct; emit(); await sleep(700); }
      }
      for (const it of todo) {
        it.state = 'installing'; it.pct = 0; emit();
        wuEvent(43, `Installation Started: Windows has started installing the following update: ${it.title}`);
        for (const pct of [10, 50, 100]) { it.pct = pct; emit(); await sleep(700); }
        if (it.restart) {
          it.state = 'restart';
          if (!S().pendingRestart.includes(it.kb)) S().pendingRestart.push(it.kb);
          WS.sys.requireReboot('updates');
        } else {
          it.state = 'installed';
          finish(it);
        }
        wuEvent(19, `Installation Successful: Windows successfully installed the following update: ${it.title}`);
      }
      const restart = rt.items.some(i => i.state === 'restart');
      rt.status = restart ? 'restart' : 'uptodate';
      if (!restart) rt.items = [];
      rt.busy = null; emit();
      if (restart && WS.shell && WS.shell.toast) WS.shell.toast({ app: 'Windows Update', title: 'Restart required', text: 'Your device needs to restart to finish installing updates. Restart outside of active hours.', action: () => WS.apps.launch('settings', { page: 'windowsupdate' }) });
      return { ok: true, restartRequired: restart };
    })();
    return rt.busy;
  }

  function finish(c) {
    const s = S(), now = new Date().toISOString();
    if (c.kind && !s.installed.some(x => x.kb === c.kb)) s.installed.push({ kb: c.kb, kind: c.kind, installedOn: now, by: 'NT AUTHORITY\\SYSTEM' });
    s.history.unshift({ kb: c.kb, title: c.title, result: 'Succeeded', date: now, kind: c.kind });
    s.lastInstalled = now;
  }

  /* the cumulative update completes during the restart */
  WS.sys.on('boot', () => {
    const s = S();
    if (!s || !s.pendingRestart.length) return;
    for (const kb of s.pendingRestart) {
      const c = CATALOG.find(x => x.kb === kb);
      if (!c) continue;
      finish(c);
      if (c.build) WS.state.system.build = c.build;
    }
    s.pendingRestart = [];
    rt.items = []; rt.status = 'idle';
    WS.store.changed('updates', 'system');
  });

  /** Configure Automatic Updates, as Settings and Server Manager describe it. */
  function policy() {
    if (!WS.gpo) return null;
    const v = WS.gpo.effective('computer', 'NoAutoUpdate');
    if (!v || !v.state || v.state === 'Not Configured') return null;
    if (v.state === 'Disabled') return { auto: false, text: 'Never check for updates (not recommended)' };
    const opt = Number(v.options && v.options.AUOptions) || 3;
    return { auto: true, opt, text: { 2: 'Notify for download and notify for install', 3: 'Download updates only, using Windows Update', 4: 'Install updates automatically using Windows Update', 5: 'Local admin chooses setting', 7: 'Notify for install and notify for restart' }[opt] || 'Download updates only, using Windows Update' };
  }

  const WU = {
    CATALOG, timeScale: 1,
    state: () => ({ status: rt.status === 'idle' && S().pendingRestart.length ? 'restart' : rt.status, lastChecked: S().lastChecked, lastInstalled: S().lastInstalled, items: rt.items.slice(), error: rt.error,
      pendingRestart: S().pendingRestart.slice() }),
    check, install, policy, unreachable,
    /** Installed packages, as Get-HotFix lists them: { kb, kind, installedOn (Date), by } */
    hotfixes: () => S().installed.map(x => ({ ...x, installedOn: new Date(x.installedOn || WS.state.system.installDate) })),
    history: () => S().history.slice(),
    onChange: fn => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    /** Forget this session's scan (a reboot does the same). */
    reset() { rt.status = 'idle'; rt.items = []; rt.error = null; rt.busy = null; }
  };
  WS.wu = WU;
})();
