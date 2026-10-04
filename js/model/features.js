/* Roles and features model: WS.features. Used by the Add Roles and Features Wizard and by
 * Install-WindowsFeature / Uninstall-WindowsFeature / Get-WindowsFeature.
 * State: features.installed[id] = true, features.pending[id] = 'install' | 'uninstall' (applied at boot),
 *        features.postTasks = [{ id, feature, title, done }] (Server Manager notifications flag).
 * Other models react with WS.features.on('install' | 'uninstall', (id, node) => ...). */
(function () {
  'use strict';
  const WS = window.WS;
  const C = WS.catalog.features;

  WS.store.init('features', s => {
    const installed = {};
    for (const f of C.all()) if (f.defaultInstalled) installed[f.id] = true;
    s.features = { installed, pending: {}, postTasks: [] };
  });

  const POST_TASKS = {
    adds: 'Promote this server to a domain controller',
    dhcp: 'Complete DHCP configuration',
    adcs: 'Configure Active Directory Certificate Services on the destination server',
    wsus: 'Launch Post-Installation tasks'
  };
  /** Always installed and cannot be removed. */
  const PERMANENT = new Set(['FileAndStorage-Services', 'Storage-Services']);
  /** Tool containers shared by several roles: -IncludeManagementTools on uninstall leaves them alone. */
  const SHARED_TOOLS = new Set(['RSAT', 'RSAT-Role-Tools', 'RSAT-AD-Tools', 'RSAT-Feature-Tools']);

  const hooks = { install: [], uninstall: [] };
  function fire(kind, id) {
    for (const fn of hooks[kind]) { try { fn(id, C.get(id)); } catch (e) { console.error('feature ' + kind + ' hook failed', id, e); } }
  }

  const st = () => WS.state.features;
  const isInstalled = id => !!st().installed[id];
  const ancestors = node => { const out = []; let p = node && node.parent && C.get(node.parent); while (p) { out.push(p); p = p.parent && C.get(p.parent); } return out; };
  const descendants = node => node.children.flatMap(c => [c, ...descendants(c)]);

  /** Resolve a name or wildcard (Install-WindowsFeature accepts both) to catalog nodes. */
  function resolve(names) {
    const out = [], missing = [];
    for (const n of [].concat(names)) {
      if (/[*?]/.test(n)) { const re = WS.util.wildcardToRegex(n); out.push(...C.all().filter(f => re.test(f.id))); continue; }
      const f = C.get(n) || C.all().find(x => x.id.toLowerCase() === String(n).toLowerCase());
      if (f) out.push(f); else missing.push(n);
    }
    return { nodes: [...new Set(out)], missing };
  }

  /** Everything that would be installed for these ids (in tree order), and what is still missing. */
  function plan(ids, opts = {}) {
    const { nodes, missing } = resolve(ids);
    const set = new Set();
    const add = n => { if (!n) return; set.add(n.id); ancestors(n).forEach(a => set.add(a.id)); };
    for (const n of nodes) {
      add(n);
      if (opts.includeAllSubFeature) descendants(n).forEach(add);
      else if (n.defaultChildren && !n.children.some(c => nodes.includes(c) || isInstalled(c.id))) n.defaultChildren.forEach(id => add(C.get(id)));
      if (opts.includeManagementTools) [n, ...ancestors(n)].forEach(x => x.mgmt.forEach(id => add(C.get(id))));
    }
    const order = C.all().map(f => f.id);
    const all = [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return { all, toInstall: all.filter(id => !isInstalled(id) && st().pending[id] !== 'install'), missing };
  }

  /** For the wizard's "Add features that are required for <role>?" dialog. */
  function requiredFor(id) {
    const node = C.get(id);
    if (!node) return [];
    const p = plan([id], { includeManagementTools: true });
    return p.toInstall.filter(x => x !== id).map(x => C.get(x));
  }

  function installState(id) {
    const p = st().pending[id];
    if (p === 'install') return 'InstallPending';
    if (p === 'uninstall') return 'UninstallPending';
    return isInstalled(id) ? 'Installed' : 'Available';
  }

  function addPostTask(node) {
    if (!node.postConfig || !POST_TASKS[node.postConfig]) return;
    const tasks = st().postTasks;
    if (!tasks.some(t => t.id === node.postConfig && !t.done)) tasks.push({ id: node.postConfig, feature: node.id, title: POST_TASKS[node.postConfig], done: false, created: new Date().toISOString() });
  }

  /** Install-WindowsFeature. Returns { ok, success, restartNeeded: 'No'|'Yes', exitCode, featureResult: [nodes], error } */
  function install(ids, opts = {}) {
    const p = plan(ids, opts);
    if (p.missing.length) return { ok: false, error: `ArgumentNotValid: The role, role service, or feature name is not valid: '${p.missing.join("', '")}'. The name was not found.` };
    if (!p.toInstall.length) return { ok: true, success: true, restartNeeded: 'No', exitCode: 'NoChangeNeeded', featureResult: [] };
    const nodes = p.toInstall.map(id => C.get(id));
    const needsReboot = nodes.some(n => n.reboot);
    for (const n of nodes) {
      if (n.reboot) st().pending[n.id] = 'install';
      else { st().installed[n.id] = true; delete st().pending[n.id]; }
      addPostTask(n);
    }
    if (needsReboot) WS.sys.requireReboot('features');
    WS.store.changed('features');
    for (const n of nodes) if (!n.reboot) fire('install', n.id);
    WS.evt.write('System', { id: 7036, source: 'Service Control Manager', message: 'The Windows Modules Installer service entered the running state.' });
    if (needsReboot && opts.restart) setTimeout(() => WS.shell.restart(), 0);
    return { ok: true, success: true, restartNeeded: needsReboot ? 'Yes' : 'No', exitCode: needsReboot ? 'SuccessRestartRequired' : 'Success', featureResult: nodes };
  }

  /** Uninstall-WindowsFeature. Removing a whole role needs a restart, as on real Windows. */
  function uninstall(ids, opts = {}) {
    const { nodes, missing } = resolve(ids);
    if (missing.length) return { ok: false, error: `ArgumentNotValid: The role, role service, or feature name is not valid: '${missing.join("', '")}'. The name was not found.` };
    for (const n of nodes) {
      if (PERMANENT.has(n.id)) return { ok: false, error: `The request to add or remove features on the specified server failed.\n${n.name} cannot be removed because it is always installed.` };
      if (n.id === 'AD-Domain-Services' && WS.sys.isDC()) return { ok: false, error: 'The request to add or remove features on the specified server failed.\nThe Active Directory domain controller needs to be demoted before Active Directory Domain Services can be removed.' };
    }
    const set = new Set();
    for (const n of nodes) {
      [n, ...descendants(n)].forEach(x => { if (isInstalled(x.id) || st().pending[x.id] === 'install') set.add(x.id); });
      if (opts.includeManagementTools) n.mgmt.forEach(id => { if (isInstalled(id) && !SHARED_TOOLS.has(id)) set.add(id); });
    }
    if (!set.size) return { ok: true, success: true, restartNeeded: 'No', exitCode: 'NoChangeNeeded', featureResult: [] };
    let needsReboot = false;
    for (const id of set) {
      const n = C.get(id);
      if (st().pending[id] === 'install') { delete st().pending[id]; continue; }
      if (n.reboot || (n.kind === 'role' && n.depth === 0)) { st().pending[id] = 'uninstall'; needsReboot = true; }
      else { delete st().installed[id]; fire('uninstall', id); }
    }
    // a tool container (RSAT, Role Administration Tools...) with nothing left under it is no longer installed
    for (let again = true; again;) {
      again = false;
      for (const f of C.all()) {
        if (f.kind !== 'feature' || !f.children.length || !isInstalled(f.id) || f.defaultInstalled) continue;
        if (!f.children.some(c => isInstalled(c.id) || st().pending[c.id]) && descendants(f).some(d => set.has(d.id))) { delete st().installed[f.id]; again = true; }
      }
    }
    st().postTasks = st().postTasks.filter(t => !set.has(t.feature));
    if (needsReboot) WS.sys.requireReboot('features');
    WS.store.changed('features');
    if (needsReboot && opts.restart) setTimeout(() => WS.shell.restart(), 0);
    return { ok: true, success: true, restartNeeded: needsReboot ? 'Yes' : 'No', exitCode: needsReboot ? 'SuccessRestartRequired' : 'Success', featureResult: [...set].map(id => C.get(id)) };
  }

  WS.sys.on('boot', () => {
    const pend = st().pending;
    for (const [id, what] of Object.entries(pend)) {
      delete pend[id];
      if (what === 'install') { st().installed[id] = true; fire('install', id); }
      else { delete st().installed[id]; fire('uninstall', id); }
    }
    WS.store.changed('features');
  });

  WS.features = {
    isInstalled,
    installState,
    resolve,
    plan,
    requiredFor,
    install,
    uninstall,
    on(kind, fn) { hooks[kind].push(fn); },
    postTasks: () => st().postTasks.filter(t => !t.done),
    completePostTask(id) { st().postTasks.forEach(t => { if (t.id === id) t.done = true; }); WS.store.changed('features'); },
    installedRoles() {
      return C.roots.role.filter(r => isInstalled(r.id) || r.children.some(c => isInstalled(c.id)));
    }
  };
})();
