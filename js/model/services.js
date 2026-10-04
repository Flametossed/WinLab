/* Services model: WS.svc, built from WS.catalog.services. Used by services.msc, Get-Service,
 * Start-/Stop-/Restart-/Set-Service, sc.exe and net start/stop.
 * State: services.state[<service name>] = { startup, status }  (startup uses the services.msc wording:
 *   'Automatic', 'Automatic (Delayed Start)', 'Manual', 'Manual (Trigger Start)', 'Disabled', ...;
 *   status: 'Running' | 'Stopped').
 * A service whose catalog entry names a feature only exists while that feature is installed;
 * '#dc' services exist only on a domain controller. */
(function () {
  'use strict';
  const WS = window.WS;
  const BUILTIN = WS.catalog.services;
  const byName = {};
  for (const s of BUILTIN) byName[s.name.toLowerCase()] = s;

  WS.store.init('services', s => {
    const state = {};
    for (const c of BUILTIN) state[c.name] = { startup: c.startup, status: c.status };
    s.services = { state, custom: [] };
  });

  /* Lab-defined services live in services.custom[] (see define()); they behave like catalog entries. */
  const custom = () => (WS.state && WS.state.services && WS.state.services.custom) || [];
  const all = () => BUILTIN.concat(custom());
  const cat = name => { const n = String(name).toLowerCase(); return byName[n] || custom().find(c => c.name.toLowerCase() === n) || null; };

  /** Image paths as sc qc, the Services General tab and Task Manager show them. */
  const SVCHOST = k => `C:\\Windows\\system32\\svchost.exe -k ${k} -p`;
  const PATHS = {
    Spooler: 'C:\\Windows\\System32\\spoolsv.exe', NTDS: 'C:\\Windows\\System32\\lsass.exe', Kdc: 'C:\\Windows\\System32\\lsass.exe',
    Netlogon: 'C:\\Windows\\system32\\lsass.exe', SamSs: 'C:\\Windows\\system32\\lsass.exe', KeyIso: 'C:\\Windows\\system32\\lsass.exe', VaultSvc: 'C:\\Windows\\system32\\lsass.exe',
    DNS: 'C:\\Windows\\system32\\dns.exe', DHCPServer: SVCHOST('DHCPServer'), ADWS: 'C:\\Windows\\ADWS\\Microsoft.ActiveDirectory.WebServices.exe', DFSR: 'C:\\Windows\\system32\\DFSRs.exe',
    W3SVC: SVCHOST('iissvcs'), WAS: SVCHOST('iissvcs'), WinDefend: '"C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18.24090.11-0\\MsMpEng.exe"',
    msiserver: 'C:\\Windows\\system32\\msiexec.exe /V', TrustedInstaller: 'C:\\Windows\\servicing\\TrustedInstaller.exe', VSS: 'C:\\Windows\\system32\\vssvc.exe',
    sshd: 'C:\\Windows\\System32\\OpenSSH\\sshd.exe', 'ssh-agent': 'C:\\Windows\\System32\\OpenSSH\\ssh-agent.exe', vmms: 'C:\\Windows\\system32\\vmms.exe',
    vmcompute: 'C:\\Windows\\system32\\vmcompute.exe', IsmServ: 'C:\\Windows\\System32\\ismserv.exe', Dfs: 'C:\\Windows\\system32\\dfssvc.exe', CertSvc: 'C:\\Windows\\system32\\certsrv.exe',
    ClusSvc: 'C:\\Windows\\Cluster\\clussvc.exe', sppsvc: 'C:\\Windows\\system32\\sppsvc.exe', edgeupdate: '"C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe" /svc',
    WsusService: '"C:\\Program Files\\Update Services\\Services\\WsusService.exe"', wbengine: '"C:\\Windows\\system32\\wbengine.exe"', MSDTC: 'C:\\Windows\\System32\\msdtc.exe',
    SrmSvc: SVCHOST('netsvcs'), TermService: SVCHOST('NetworkService'), RpcSs: SVCHOST('rpcss'), RpcEptMapper: SVCHOST('RPCSS'), DcomLaunch: SVCHOST('DcomLaunch'), PlugPlay: SVCHOST('DcomLaunch'), Power: SVCHOST('DcomLaunch'),
    LanmanServer: SVCHOST('smbsvcs'), LanmanWorkstation: SVCHOST('NetworkService'), Dnscache: SVCHOST('NetworkService'), Dhcp: SVCHOST('LocalServiceNetworkRestricted'),
    mpssvc: SVCHOST('LocalServiceNoNetworkFirewall'), BFE: SVCHOST('LocalServiceNoNetworkFirewall'), EventLog: SVCHOST('LocalServiceNetworkRestricted'),
    W32Time: SVCHOST('LocalService'), Winmgmt: SVCHOST('netsvcs'), WinRM: SVCHOST('NetworkService'), wuauserv: SVCHOST('netsvcs')
  };
  const pathOf = name => { const c = cat(name); return (c && c.path) || PATHS[c ? c.name : name] || SVCHOST('netsvcs'); };

  const st = name => {
    const c = cat(name);
    if (!c) return null;
    const all = WS.state.services.state;
    return all[c.name] = all[c.name] || { startup: c.startup, status: c.status };
  };

  function present(c) {
    if (!c.feature) return true;
    if (c.feature === '#dc') return WS.sys.isDC();
    return WS.features.isInstalled(c.feature);
  }

  /** Find a service by service name or display name (wildcards allowed for list()). */
  function find(name) {
    const n = String(name).toLowerCase();
    const c = cat(n) || all().find(x => x.display.toLowerCase() === n);
    return c && present(c) ? c : null;
  }

  function view(c) {
    const s = st(c.name);
    return { name: c.name, display: c.display, description: c.desc, logon: c.logon, path: pathOf(c.name), custom: !byName[c.name.toLowerCase()], startup: s.startup, status: s.status,
      startType: baseType(s.startup), canStop: s.status === 'Running' && !WS.catalog.unstoppable.has(c.name),
      dependsOn: deps(c.name), dependents: dependents(c.name).map(d => d.name) };
  }

  function list(pattern) {
    const re = pattern ? WS.util.wildcardToRegex(pattern) : null;
    return all().filter(present).filter(c => !re || re.test(c.name) || re.test(c.display))
      .sort((a, b) => a.display.localeCompare(b.display)).map(view);
  }

  /** Required services (optional '?' dependencies only count when that service exists). */
  function deps(name) {
    const c = cat(name);
    return ((c && c.depends) || WS.catalog.depends[c ? c.name : name] || [])
      .map(d => d.replace(/\?$/, ''))
      .filter(d => cat(d) && present(cat(d)));
  }
  function dependents(name) {
    return all().filter(present).filter(c => deps(c.name).some(d => d.toLowerCase() === name.toLowerCase()));
  }

  const baseType = startup => /^Automatic/.test(startup) ? (/Delayed/.test(startup) ? 'AutomaticDelayedStart' : 'Automatic') : /^Manual/.test(startup) ? 'Manual' : 'Disabled';
  const SC_WORD = { Automatic: 'auto start', AutomaticDelayedStart: 'auto start', Manual: 'demand start', Disabled: 'disabled' };

  const notFound = name => ({ ok: false, code: 'NoServiceFoundForGivenName', error: `Cannot find any service with service name '${name}'.` });

  const statusHooks = [];
  function setStatus(c, status) {
    const s = st(c.name);
    if (s.status === status) return;
    s.status = status;
    WS.evt.write('System', { id: 7036, source: 'Service Control Manager', message: `The ${c.display} service entered the ${status === 'Running' ? 'running' : 'stopped'} state.` });
    for (const fn of statusHooks) { try { fn(c.name, status); } catch (e) { console.error(e); } }
    WS.store.changed('services');
  }

  function start(name) {
    const c = find(name);
    if (!c) return notFound(name);
    const s = st(c.name);
    if (s.status === 'Running') return { ok: true, changed: false };
    if (s.startup === 'Disabled') return { ok: false, code: 1058, error: `Service '${c.display} (${c.name})' cannot be started due to the following error: Cannot start service ${c.name} on computer '.'.`, detail: 'The service cannot be started, either because it is disabled or because it has no enabled devices associated with it.' };
    for (const d of deps(c.name)) {
      const r = start(d);
      if (!r.ok) return { ok: false, code: 1068, error: `Service '${c.display} (${c.name})' cannot be started due to the following error: Cannot start service ${c.name} on computer '.'.`, detail: 'The dependency service or group failed to start.' };
    }
    setStatus(c, 'Running');
    return { ok: true, changed: true };
  }

  /** stop(name, {force}) - without force, running dependents make it fail (as Stop-Service does). */
  function stop(name, opts = {}) {
    const c = find(name);
    if (!c) return notFound(name);
    const s = st(c.name);
    if (s.status !== 'Running') return { ok: true, changed: false };
    if (WS.catalog.unstoppable.has(c.name)) return { ok: false, code: 1052, error: `Service '${c.display} (${c.name})' cannot be stopped due to the following error: Cannot stop ${c.name} service on computer '.'.`, detail: 'The requested control is not valid for this service.' };
    const running = dependents(c.name).filter(d => st(d.name).status === 'Running');
    if (running.length && !opts.force) {
      return { ok: false, code: 'ServiceHasDependentServices', dependents: running.map(d => d.display),
        error: `Cannot stop service '${c.display} (${c.name})' because it has dependent services. It can only be stopped if the Force flag is set.` };
    }
    for (const d of running) { const r = stop(d.name, { force: true }); if (!r.ok) return r; }
    setStatus(c, 'Stopped');
    return { ok: true, changed: true, alsoStopped: running.map(d => d.display) };
  }

  function restart(name, opts) {
    const r = stop(name, opts);
    if (!r.ok) return r;
    return start(name);
  }

  /** type: Automatic | AutomaticDelayedStart | Manual | Disabled, or a services.msc label. */
  function setStartup(name, type) {
    const c = find(name);
    if (!c) return notFound(name);
    const s = st(c.name);
    const t = String(type).replace(/\s+/g, '').toLowerCase();
    const base = { automatic: 'Automatic', auto: 'Automatic', automaticdelayedstart: 'AutomaticDelayedStart', 'automatic(delayedstart)': 'AutomaticDelayedStart', 'delayed-auto': 'AutomaticDelayedStart', manual: 'Manual', demand: 'Manual', disabled: 'Disabled' }[t];
    if (!base) return { ok: false, error: `Cannot bind parameter 'StartupType'. Cannot convert value "${type}" to type "Microsoft.PowerShell.Commands.ServiceStartupType".` };
    const old = baseType(s.startup);
    const trigger = /Trigger Start/.test(s.startup) && base !== 'Disabled';
    const label = { Automatic: 'Automatic', AutomaticDelayedStart: 'Automatic (Delayed Start)', Manual: 'Manual', Disabled: 'Disabled' }[base];
    s.startup = trigger ? (label.includes('(') ? label.replace(')', ', Trigger Start)') : label + ' (Trigger Start)') : label;
    if (old !== base) WS.evt.write('System', { id: 7040, source: 'Service Control Manager', message: `The start type of the ${c.display} service was changed from ${SC_WORD[old]} to ${SC_WORD[base]}.` });
    WS.store.changed('services');
    return { ok: true };
  }

  /* At boot, services return to what their startup type says. */
  WS.sys.on('boot', () => {
    for (const k of Object.keys(failures)) delete failures[k];
    for (const c of all()) {
      const s = st(c.name);
      if (!present(c)) { s.status = 'Stopped'; continue; }
      const t = baseType(s.startup);
      s.status = t === 'Disabled' ? 'Stopped' : t !== 'Manual' ? 'Running' : (/Trigger/.test(s.startup) && c.status === 'Running' ? 'Running' : 'Stopped');
    }
    WS.store.changed('services');
  });
  /* A newly installed role's services appear with their default startup type and start. */
  WS.features.on('install', id => {
    for (const c of BUILTIN) if (c.feature === id) {
      WS.state.services.state[c.name] = { startup: c.startup, status: 'Stopped' };
      if (baseType(c.startup) !== 'Disabled' && c.status === 'Running') setStatus(c, 'Running');
    }
  });
  WS.features.on('uninstall', id => { for (const c of BUILTIN) if (c.feature === id) st(c.name).status = 'Stopped'; });

  /* ---- unexpected termination (Task Manager, Stop-Process, taskkill on a service's process) ----
   * Service Control Manager logs 7031 when a recovery action follows, 7034 when none does. Built-in services that
   * start automatically restart after 60 seconds on the first two failures; a lab service sets
   * recovery: 'restart' | 'none' and restartMs. WS.svc.timeScale shortens the wait (tests). */
  const failures = {};
  const recoveryOf = c => {
    if (c.recovery) return c.recovery === 'restart' ? { restart: true, ms: c.restartMs || 60000 } : { restart: false };
    return /^Automatic/.test(c.startup) && c.status === 'Running' ? { restart: true, ms: 60000 } : { restart: false };
  };
  function crash(name) {
    const c = find(name);
    if (!c) return notFound(name);
    const s = st(c.name);
    if (s.status !== 'Running') return { ok: true, changed: false };
    const n = failures[c.name] = (failures[c.name] || 0) + 1;
    const rec = recoveryOf(c);
    const restart = rec.restart && n <= 2;
    s.status = 'Stopped';
    WS.evt.write('System', restart
      ? { id: 7031, level: 'Error', source: 'Service Control Manager', message: `The ${c.display} service terminated unexpectedly.  It has done this ${n} time(s).  The following corrective action will be taken in ${rec.ms} milliseconds: Restart the service.` }
      : { id: 7034, level: 'Error', source: 'Service Control Manager', message: `The ${c.display} service terminated unexpectedly.  It has done this ${n} time(s).` });
    for (const fn of statusHooks) { try { fn(c.name, 'Stopped'); } catch (e) { console.error(e); } }
    WS.store.changed('services');
    if (restart) {
      const boot = WS.state.meta.bootCount;
      setTimeout(() => {
        const cur = find(c.name);
        // nothing happens if the server restarted, or someone stopped/disabled the service meanwhile
        if (!cur || WS.state.meta.bootCount !== boot || st(c.name).status === 'Running' || st(c.name).startup === 'Disabled' || !failures[c.name]) return;
        start(c.name);
      }, rec.ms * WS.svc.timeScale);
    }
    return { ok: true, changed: true, restart, failures: n };
  }

  /** Add (or replace) a lab-defined service: { name, display, startup, status, logon, desc, path, recovery, restartMs, depends }. */
  function define(def) {
    const list = WS.state.services.custom = WS.state.services.custom || [];
    const c = Object.assign({ startup: 'Automatic', status: 'Running', logon: 'Local System', desc: '', feature: null }, def);
    const i = list.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase());
    if (i >= 0) list[i] = c; else list.push(c);
    WS.state.services.state[c.name] = { startup: c.startup, status: c.status };
    WS.store.changed('services');
    return { ok: true };
  }

  WS.svc = {
    list, find, pathOf, crash, define, timeScale: 1,
    /** How many times a service terminated unexpectedly since the last boot. */
    failures: name => failures[(cat(name) || {}).name] || 0,
    get: name => { const c = find(name); return c ? view(c) : null; },
    isRunning: name => { const c = find(name); return !!c && st(c.name).status === 'Running'; },
    start, stop, restart, setStartup, dependents: name => dependents(name).map(view),
    /** on('status', (name, status) => ...) fires when a service starts or stops outside a boot (boot uses WS.sys.on('boot')). */
    on(event, fn) { if (event === 'status') statusHooks.push(fn); },
    /** Used by models when a role (e.g. AD DS) brings its services up outside a feature install. */
    reset(name) { const c = cat(name); if (c) { WS.state.services.state[c.name] = { startup: c.startup, status: 'Stopped' }; if (c.status === 'Running') setStatus(c, 'Running'); } }
  };
})();
