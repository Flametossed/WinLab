/* Installed programs (the Uninstall registry keys): what Programs and Features (appwiz.cpl) and Settings > Apps >
 * Installed apps list. Labs can add their own with WS.programs.define(); uninstalling one removes it and, if it says so,
 * its startup entry and the lab process that belongs to it.
 *   WS.programs.list() -> [{ id, name, publisher, version, sizeKB, installedOn, system }]
 *   define({ name, publisher, version, sizeKB, installedOn, startupId, processId }) -> program; uninstall(idOrName) -> { ok, error }
 * State: state.programs. */
(function () {
  'use strict';
  const WS = window.WS;

  const BUILTIN = [
    { id: 'edge', name: 'Microsoft Edge', publisher: 'Microsoft Corporation', version: '130.0.2849.68', sizeKB: 0, system: true },
    { id: 'webview2', name: 'Microsoft Edge WebView2 Runtime', publisher: 'Microsoft Corporation', version: '130.0.2849.68', sizeKB: 0, system: true },
    { id: 'vcredist', name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.40.33810', publisher: 'Microsoft Corporation', version: '14.40.33810.0', sizeKB: 20480 }
  ];

  WS.store.init('programs', s => { s.programs = { custom: [], removed: [] }; });
  const S = () => WS.state.programs;

  function list() {
    const s = S(), installed = WS.state.system.installDate;
    return [...BUILTIN.filter(p => !s.removed.includes(p.id)).map(p => ({ ...p, installedOn: installed })), ...s.custom.map(p => ({ ...p }))]
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const find = idOrName => list().find(p => p.id === idOrName || p.name.toLowerCase() === String(idOrName).toLowerCase()) || null;

  function define(def) {
    const s = S();
    const p = { id: def.id || 'prog-' + WS.util.hashStr(def.name).toString(36), name: def.name, publisher: def.publisher || '', version: def.version || '', sizeKB: def.sizeKB || 0,
      installedOn: def.installedOn || new Date().toISOString(), startupId: def.startupId || null, processId: def.processId || null };
    s.custom = s.custom.filter(x => x.id !== p.id).concat(p);
    WS.store.changed('programs');
    return p;
  }

  function uninstall(idOrName) {
    const p = find(idOrName);
    if (!p) return { ok: false, code: 'NotFound', error: `The program ${idOrName} is not installed.` };
    if (p.system) return { ok: false, code: 'System', error: `${p.name} is part of Windows and can't be uninstalled.` };
    const s = S();
    if (BUILTIN.some(b => b.id === p.id)) s.removed.push(p.id);
    else s.custom = s.custom.filter(x => x.id !== p.id);
    // the program's own startup entry and lab process go with it
    if (p.startupId && WS.state.processes) WS.state.processes.startup = (WS.state.processes.startup || []).filter(x => x.id !== p.startupId);
    if (p.processId && WS.state.processes) {
      WS.state.processes.custom = (WS.state.processes.custom || []).filter(x => x.id !== p.processId);
      WS.store.changed('processes');
    }
    WS.evt.write('Application', { id: 11724, source: 'MsiInstaller', user: `${WS.sys.netbiosDomain()}\\Administrator`, message: `Product: ${p.name} -- Removal completed successfully.` });
    WS.store.changed('programs');
    return { ok: true };
  }

  WS.programs = { list, find, define, uninstall };
})();
