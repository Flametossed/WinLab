/* PowerShell GroupPolicy module (installed with Group Policy Management, feature GPMC): GPOs, links, inheritance,
 * permissions, registry-based settings, reports, backups, Starter GPOs, Invoke-GPUpdate and Get-GPResultantSetOfPolicy.
 * Everything goes through WS.gpo, so GPMC and the Group Policy Management Editor show the same objects. */
(function () {
  'use strict';
  const WS = window.WS;
  const PS = WS.ps;
  const { psobj, toStr } = PS;
  const { wild, hasWild } = PS.helpers;
  const G = WS.gpo;
  const MOD = 'GroupPolicy';
  const cls = n => 'Microsoft.GroupPolicy.Commands.' + n.replace('-', '') + 'Command';
  const gpCmd = def => PS.cmdlet({ module: MOD, version: '1.0.0.0', feature: 'GPMC', cls: cls(def.name), ...def });
  const dom = () => (WS.state.ad ? WS.state.ad.domain : '');
  const bare = id => String(id).replace(/^\{|\}$/g, '').toLowerCase();
  const yn = v => (v == null ? null : /^(yes|true|1|enabled)$/i.test(toStr(v)));

  function check(ctx) {
    if (!WS.state.ad) ctx.throw({ message: 'The specified domain either does not exist or could not be contacted.', category: 'NotSpecified', target: '', exception: 'COMException', id: `System.Runtime.InteropServices.COMException,${cls(ctx.name)}` });
    G.ensure();
  }
  function fail(ctx, r, target, terminating) {
    const rec = { message: r.error, category: r.code === 'NotFound' ? 'ObjectNotFound' : r.code === 'Exists' ? 'ResourceExists' : 'InvalidArgument', target: target || '', targetType: 'String',
      exception: r.code === 'NotFound' ? 'ArgumentException' : 'ArgumentException', id: `${r.code === 'NotFound' ? 'GpoWithNameNotFound' : r.code || 'InvalidOperation'},${cls(ctx.name)}` };
    if (terminating) ctx.throw(rec); else ctx.error(rec);
  }
  const gpoObj = g => psobj('Microsoft.GroupPolicy.Gpo', {
    DisplayName: g.name, DomainName: dom(), Owner: G.principal(g.owner).name, Id: bare(g.id), GpoStatus: g.status, Description: g.description || null,
    CreationTime: new Date(g.created), ModificationTime: new Date(g.modified), UserVersion: `AD Version: ${g.userVersion}, SysVol Version: ${g.userVersion}`,
    ComputerVersion: `AD Version: ${g.computerVersion}, SysVol Version: ${g.computerVersion}`, WmiFilter: g.wmiFilter ? (G.wmiFilter(g.wmiFilter) || {}).name || null : null
  }, { str: 'Microsoft.GroupPolicy.Gpo' });
  /** -Name / -Guid / pipeline Gpo object -> GPO, or an error. */
  function findGpo(ctx, p, terminating = true) {
    const guid = p.Guid != null ? toStr(p.Guid.Id || p.Guid) : null;
    const name = p.Name != null ? toStr(p.Name.DisplayName || p.Name) : null;
    const g = guid ? G.get(guid) : name ? G.get(name) : null;
    if (!g) {
      const msg = guid ? `A GPO with ID {${bare(guid)}} was not found in the ${dom()} domain.` : `A GPO with the display name '${name}' could not be found in the ${dom()} domain.`;
      const rec = { message: msg, category: 'ObjectNotFound', target: '', targetType: 'GetGpoCommand', exception: 'ArgumentException', id: `${guid ? 'GpoWithIdNotFound' : 'GpoWithNameNotFound'},${cls(ctx.name)}` };
      if (terminating) ctx.throw(rec); else ctx.error(rec);
      return null;
    }
    return g;
  }
  const NAME = { Name: { pos: 0, alias: ['DisplayName'], pipe: 'name' }, Guid: { alias: ['Id'], pipe: 'name' } };
  const COMMON = { Domain: { alias: ['DomainName'] }, Server: { alias: ['DC'] } };
  function somFor(ctx, target) {
    const t = toStr(target);
    const som = G.somOf(t);
    if (!som) ctx.throw({ message: `The "${t}" Scope of Management (SOM) could not be found in the ${dom()} domain. Specify the distinguished name of a domain or organizational unit.`, category: 'ObjectNotFound', target: t, exception: 'ArgumentException', id: `SomNotFound,${cls(ctx.name)}` });
    return som;
  }
  const linkObj = (g, som, l) => psobj('Microsoft.GroupPolicy.GpoLink', { GpoId: bare(g.id), DisplayName: g.name, Enabled: l.enabled, Enforced: l.enforced, Target: WS.ad.dn(som), Order: l.order }, { str: 'Microsoft.GroupPolicy.GpoLink' });
  const somObj = som => psobj('Microsoft.GroupPolicy.Som', {
    Name: (som.type === 'domainDNS' ? dom() : som.name).toLowerCase(), ContainerType: som.type === 'domainDNS' ? 'Domain' : 'OU', Path: WS.ad.dn(som).toLowerCase(),
    GpoInheritanceBlocked: som.blockInheritance ? 'Yes' : 'No', GpoLinks: G.somLinks(som).map(l => l.gpoObj.name), InheritedGpoLinks: G.inheritance(som).map(e => e.gpo.name)
  }, { str: 'Microsoft.GroupPolicy.Som' });

  /* ---------------------------------------------------------------- GPOs */
  gpCmd({ name: 'Get-GPO', synopsis: 'Gets one GPO or all the GPOs in a domain.', params: { ...NAME, All: { type: 'switch' }, ...COMMON },
    process(ctx, p) {
      check(ctx);
      if (p.All || (p.Name == null && p.Guid == null)) { if (!p.All) ctx.throw({ message: 'Cannot validate argument. Specify -Name, -Guid or -All.', category: 'InvalidArgument', target: '', exception: 'ParameterBindingException', id: `AmbiguousParameterSet,${cls(ctx.name)}` }); G.list().slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(g => ctx.out(gpoObj(g))); return; }
      const n = p.Name != null ? toStr(p.Name) : null;
      if (n && hasWild(n)) { G.list().filter(g => wild(n, g.name)).forEach(g => ctx.out(gpoObj(g))); return; }
      const g = findGpo(ctx, p, false); if (g) ctx.out(gpoObj(g));
    } });
  gpCmd({ name: 'New-GPO', shouldProcess: true, synopsis: 'Creates a new GPO.', params: { Name: { pos: 0, mandatory: true, alias: ['DisplayName'] }, Comment: { pos: 1 }, StarterGpoName: {}, StarterGpoGuid: {}, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      if (!(await ctx.confirm('New-GPO', p.Name))) return;
      const r = G.create(p.Name, { comment: p.Comment, starter: p.StarterGpoName || p.StarterGpoGuid || null });
      if (!r.ok) return fail(ctx, r, p.Name);
      ctx.out(gpoObj(r.gpo));
    } });
  gpCmd({ name: 'Remove-GPO', shouldProcess: true, impact: 'High', synopsis: 'Removes a GPO.', params: { ...NAME, KeepLinks: { type: 'switch' }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      if (!(await ctx.confirm('Remove-GPO', g.name))) return;
      const r = G.remove(g); if (!r.ok) fail(ctx, r, g.name);
    } });
  gpCmd({ name: 'Rename-GPO', shouldProcess: true, synopsis: 'Assigns a new display name to a GPO.', params: { ...NAME, TargetName: { mandatory: true, pos: 1 }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      if (!(await ctx.confirm('Rename-GPO', g.name))) return;
      const r = G.rename(g, p.TargetName); if (!r.ok) return fail(ctx, r, g.name);
      ctx.out(gpoObj(g));
    } });
  gpCmd({ name: 'Copy-GPO', shouldProcess: true, synopsis: 'Copies a GPO.', params: { SourceName: { pos: 0, alias: ['DisplayName'] }, SourceGuid: { alias: ['Id'] }, TargetName: { mandatory: true, pos: 1 }, CopyAcl: { type: 'switch' }, SourceDomain: {}, TargetDomain: {} },
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, { Name: p.SourceName, Guid: p.SourceGuid }); if (!g) return;
      if (!(await ctx.confirm('Copy-GPO', g.name))) return;
      const r = G.copy(g, { name: p.TargetName, preservePermissions: !!p.CopyAcl }); if (!r.ok) return fail(ctx, r, p.TargetName);
      ctx.out(gpoObj(r.gpo));
    } });

  /* ---------------------------------------------------------------- links and inheritance */
  const LINK = { ...NAME, Target: { mandatory: true, pos: 1 }, LinkEnabled: { type: 'enum', values: ['Unspecified', 'No', 'Yes'] }, Enforced: { type: 'enum', values: ['Unspecified', 'No', 'Yes'] }, Order: { type: 'int' }, ...COMMON };
  gpCmd({ name: 'New-GPLink', shouldProcess: true, synopsis: 'Links a GPO to a site, domain, or organizational unit (OU).', params: LINK,
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      const som = somFor(ctx, p.Target);
      if (!(await ctx.confirm('New-GPLink', `${g.name} -> ${WS.ad.dn(som)}`))) return;
      const r = G.link(g, som, { enabled: p.LinkEnabled === 'No' ? false : true, enforced: p.Enforced === 'Yes', order: p.Order });
      if (!r.ok) return fail(ctx, r, WS.ad.dn(som));
      ctx.out(linkObj(g, som, r.link));
    } });
  gpCmd({ name: 'Set-GPLink', shouldProcess: true, synopsis: 'Sets the properties of the specified GPO link.', params: LINK,
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      const som = somFor(ctx, p.Target);
      if (!(await ctx.confirm('Set-GPLink', `${g.name} -> ${WS.ad.dn(som)}`))) return;
      const r = G.setLink(g, som, { enabled: p.LinkEnabled && p.LinkEnabled !== 'Unspecified' ? p.LinkEnabled === 'Yes' : null, enforced: p.Enforced && p.Enforced !== 'Unspecified' ? p.Enforced === 'Yes' : null, order: p.Order });
      if (!r.ok) return fail(ctx, r, WS.ad.dn(som));
      ctx.out(linkObj(g, som, r.link));
    } });
  gpCmd({ name: 'Remove-GPLink', shouldProcess: true, synopsis: 'Removes a GPO link from a site, domain or organizational unit (OU).', params: { ...NAME, Target: { mandatory: true, pos: 1 }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      const som = somFor(ctx, p.Target);
      if (!(await ctx.confirm('Remove-GPLink', `${g.name} -> ${WS.ad.dn(som)}`))) return;
      const r = G.unlink(g, som); if (!r.ok) fail(ctx, r, WS.ad.dn(som));
    } });
  gpCmd({ name: 'Get-GPInheritance', synopsis: 'Retrieves Group Policy inheritance information for a specified domain or OU.', params: { Target: { mandatory: true, pos: 0, pipe: 'value' }, ...COMMON },
    process(ctx, p) { check(ctx); ctx.out(somObj(somFor(ctx, p.Target))); } });
  gpCmd({ name: 'Set-GPInheritance', shouldProcess: true, synopsis: 'Blocks or unblocks inheritance for a specified domain or OU.', params: { Target: { mandatory: true, pos: 0 }, IsBlocked: { mandatory: true, pos: 1, type: 'enum', values: ['Yes', 'No'] }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const som = somFor(ctx, p.Target);
      if (!(await ctx.confirm('Set-GPInheritance', WS.ad.dn(som)))) return;
      G.setBlockInheritance(som, p.IsBlocked === 'Yes');
      ctx.out(somObj(som));
    } });

  /* ---------------------------------------------------------------- permissions */
  const permObj = (p, inherited) => psobj('Microsoft.GroupPolicy.GPPermission', { Trustee: psobj('Microsoft.GroupPolicy.GPTrustee', { Domain: /\\/.test(p.name) ? p.name.split('\\')[0] : null, Name: p.short, Sid: p.sid, SidType: p.type === 'WellKnownGroup' ? 'WellKnownGroup' : p.type, DSPath: p.obj ? WS.ad.dn(p.obj) : null }, { str: p.short }),
    TrusteeType: p.type === 'WellKnownGroup' ? 'WellKnownGroup' : p.type, Permission: p.level, Inherited: !!inherited }, { str: 'Microsoft.GroupPolicy.GPPermission' });
  gpCmd({ name: 'Get-GPPermission', synopsis: 'Gets the permission level for one or more security principals on a specified GPO.', params: { ...NAME, TargetName: {}, TargetType: { type: 'enum', values: ['Computer', 'User', 'Group'] }, All: { type: 'switch' }, ...COMMON },
    process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      let list = G.permissions(g);
      if (p.TargetName) {
        const who = G.resolvePrincipal(p.TargetName);
        list = who ? list.filter(x => x.sid === who.sid) : [];
        if (!list.length) return ctx.error({ message: `The trustee "${p.TargetName}" does not have permissions on the ${g.name} GPO.`, category: 'ObjectNotFound', target: p.TargetName, exception: 'ArgumentException', id: `TrusteeNotFound,${cls(ctx.name)}` });
      }
      list.forEach(x => ctx.out(permObj(x)));
    } });
  gpCmd({ name: 'Set-GPPermission', shouldProcess: true, synopsis: 'Grants a level of permissions to a security principal for one GPO or for all the GPOs in a domain.',
    params: { ...NAME, All: { type: 'switch' }, PermissionLevel: { mandatory: true, type: 'enum', values: ['GpoRead', 'GpoApply', 'GpoEdit', 'GpoEditDeleteModifySecurity', 'WmiFilterEdit', 'WmiFilterEditAll', 'WmiFilterCustom', 'StarterGpoRead', 'StarterGpoEdit', 'StarterGpoEditDeleteModifySecurity', 'StarterGpoCustom', 'None'] },
      TargetName: { mandatory: true }, TargetType: { mandatory: true, type: 'enum', values: ['Computer', 'User', 'Group'] }, Replace: { type: 'switch' }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const gpos = p.All ? G.list() : [findGpo(ctx, p)].filter(Boolean);
      for (const g of gpos) {
        if (!(await ctx.confirm('Set-GPPermission', g.name))) continue;
        const r = G.setPermission(g, p.TargetName, p.PermissionLevel, { replace: !!p.Replace });
        if (!r.ok) { fail(ctx, r, p.TargetName); continue; }
        ctx.out(gpoObj(g));
      }
    } });

  /* ---------------------------------------------------------------- registry-based settings */
  const fullHive = h => (h === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER');
  const regObj = r => psobj('Microsoft.GroupPolicy.PolicyRegistrySetting', { KeyPath: r.key, FullKeyPath: `${fullHive(r.hive)}\\${r.key}`, Hive: r.hive === 'HKLM' ? 'LocalMachine' : 'CurrentUser', PolicyState: 'Set', Value: r.data, Type: r.type, ValueName: r.value, HasValue: true }, { str: 'Microsoft.GroupPolicy.PolicyRegistrySetting' });
  const keyMatch = (key, r) => { const k = String(key).replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM').replace(/^HKEY_CURRENT_USER/i, 'HKCU').replace(/^(HKLM|HKCU):?\\/i, (m, x) => x.toUpperCase() + '\\'); return k.toLowerCase() === `${r.hive}\\${r.key}`.toLowerCase(); };
  gpCmd({ name: 'Get-GPRegistryValue', synopsis: 'Retrieves one or more registry-based policy settings under either Computer Configuration or User Configuration in a GPO.', params: { ...NAME, Key: { mandatory: true }, ValueName: {}, ...COMMON },
    process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      const hits = G.registryValues(g).filter(r => keyMatch(p.Key, r) && (p.ValueName == null || r.value.toLowerCase() === toStr(p.ValueName).toLowerCase()));
      if (!hits.length) return ctx.error({ message: `The following Group Policy registry setting was not found: "key: ${p.Key}${p.ValueName ? ', value: ' + p.ValueName : ''}".`, category: 'ObjectNotFound', target: '', exception: 'ArgumentException', id: `GpoRegistryValueNotFound,${cls(ctx.name)}` });
      hits.forEach(r => ctx.out(regObj(r)));
    } });
  gpCmd({ name: 'Set-GPRegistryValue', shouldProcess: true, synopsis: 'Configures one or more registry-based policy settings under either Computer Configuration or User Configuration in a GPO.',
    params: { ...NAME, Key: { mandatory: true }, ValueName: { type: 'string[]' }, Type: { type: 'enum', values: ['String', 'ExpandString', 'Binary', 'DWord', 'MultiString', 'QWord'] }, Value: { type: 'object' }, Additive: { type: 'switch' }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      if (!(await ctx.confirm('Set-GPRegistryValue', g.name))) return;
      for (const vn of p.ValueName || ['']) {
        const r = G.setRegistryValue(g, { key: p.Key, valueName: vn, type: p.Type || (typeof p.Value === 'number' ? 'DWord' : 'String'), value: p.Value });
        if (!r.ok) return fail(ctx, r, p.Key);
      }
      ctx.out(gpoObj(g));
    } });
  gpCmd({ name: 'Remove-GPRegistryValue', shouldProcess: true, synopsis: 'Removes one or more registry-based policy settings from either Computer Configuration or User Configuration in a GPO.', params: { ...NAME, Key: { mandatory: true }, ValueName: { type: 'string[]' }, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const g = findGpo(ctx, p); if (!g) return;
      if (!(await ctx.confirm('Remove-GPRegistryValue', g.name))) return;
      for (const vn of p.ValueName || [null]) { const r = G.removeRegistryValue(g, p.Key, vn); if (!r.ok) return fail(ctx, r, p.Key); }
      ctx.out(gpoObj(g));
    } });

  /* ---------------------------------------------------------------- reports */
  const REPORT = { type: 'enum', values: ['Xml', 'Html'], mandatory: true };
  function writeReport(ctx, path, text) {
    const full = ctx.resolvePath(path);
    try { WS.fs.writeFile(full, text); } catch (e) { ctx.throw({ message: e.code === 'PathNotFound' ? `Could not find a part of the path '${full}'.` : e.message, category: 'WriteError', target: full, exception: 'IOException', id: `System.IO.IOException,${cls(ctx.name)}` }); }
  }
  gpCmd({ name: 'Get-GPOReport', synopsis: 'Generates a report either in XML or HTML format for a specified GPO or for all GPOs in a domain.', params: { ...NAME, All: { type: 'switch' }, ReportType: REPORT, Path: {}, ...COMMON },
    process(ctx, p) {
      check(ctx);
      const gpos = p.All ? G.list() : [findGpo(ctx, p)].filter(Boolean);
      const xml = p.ReportType === 'Xml';
      const text = gpos.length === 1 ? (xml ? G.reportXml(gpos[0]) : G.reportHtml(gpos[0])) : (xml ? `<?xml version="1.0" encoding="utf-16"?>\r\n<report>\r\n${gpos.map(g => G.reportXml(g).replace(/^<\?xml[^>]*>\r\n/, '')).join('')}</report>\r\n` : gpos.map(g => G.reportHtml(g)).join('\r\n'));
      if (p.Path) writeReport(ctx, p.Path, text); else ctx.out(text);
    } });
  gpCmd({ name: 'Get-GPResultantSetOfPolicy', synopsis: 'Gets and writes the RSoP information for a user, a computer, or both to a file.', params: { ReportType: REPORT, Path: { mandatory: true }, User: {}, Computer: {} },
    process(ctx, p) {
      const rs = G.loggedRsop();
      if (!rs.computer && !rs.user) ctx.throw({ message: 'The Resultant Set of Policy (RSoP) data is not available for the specified user and computer.', category: 'InvalidOperation', target: '', exception: 'InvalidOperationException', id: `RsopDataNotAvailable,${cls(ctx.name)}` });
      writeReport(ctx, p.Path, p.ReportType === 'Xml' ? G.rsopXml(rs) : G.rsopHtml(rs));
      ctx.out(psobj('Microsoft.GroupPolicy.RsopReport', { RsopMode: 'Logging', Namespace: '\\\\' + WS.sys.name + '\\Root\\Rsop\\NS' + WS.util.randInt(1e7, 9e7), LoggingComputer: WS.sys.name, LoggingUser: rs.user ? rs.user.name : '', LoggingMode: 'UserAndComputer' }));
    } });
  gpCmd({ name: 'Invoke-GPUpdate', synopsis: 'Schedules a remote Group Policy refresh (gpupdate) on the specified computer.', params: { Computer: { pos: 0 }, Target: { type: 'enum', values: ['Computer', 'User'] }, Force: { type: 'switch' }, RandomDelayInMinutes: { type: 'int' }, AsJob: { type: 'switch' }, Boot: { type: 'switch' }, LogOff: { type: 'switch' }, Sync: { type: 'switch' } },
    process(ctx, p) {
      if (p.Computer && toStr(p.Computer).split('.')[0].toLowerCase() !== WS.sys.name.toLowerCase() && toStr(p.Computer) !== 'localhost') {
        ctx.throw({ message: `Computer "${p.Computer}" is not responding. The target computer is either turned off or Remote Scheduled Tasks Management Firewall rules are disabled.`, category: 'OperationTimeout', target: toStr(p.Computer), exception: 'COMException', id: `COMException,${cls(ctx.name)}` });
      }
      G.refresh({ target: p.Target ? p.Target.toLowerCase() : 'both', force: !!p.Force, reason: 'manual' });
    } });

  /* ---------------------------------------------------------------- backups */
  const backupObj = b => psobj('Microsoft.GroupPolicy.GpoBackup', { DisplayName: b.gpo ? b.gpo.name : b.name, GpoId: bare(b.gpo ? b.gpo.id : b.gpoId), Id: bare(b.backupId), BackupDirectory: b.path.replace(/\\[^\\]+$/, ''), CreationTime: new Date(b.time), DomainName: dom(), Comment: b.comment || '' }, { str: 'Microsoft.GroupPolicy.GpoBackup' });
  gpCmd({ name: 'Backup-GPO', shouldProcess: true, synopsis: 'Backs up one GPO or all the GPOs in a domain.', params: { ...NAME, All: { type: 'switch' }, Path: { mandatory: true, alias: ['BackupLocation'] }, Comment: {}, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const which = p.All ? 'all' : findGpo(ctx, p);
      if (!which) return;
      if (!(await ctx.confirm('Backup-GPO', p.All ? 'All GPOs' : which.name))) return;
      const r = G.backup(which, ctx.resolvePath(p.Path), p.Comment);
      if (!r.ok) return ctx.error({ message: r.code === 'PathNotFound' ? `The backup directory "${p.Path}" does not exist.` : r.error, category: 'ObjectNotFound', target: p.Path, exception: 'DirectoryNotFoundException', id: `BackupDirectoryNotFound,${cls(ctx.name)}` });
      r.backups.forEach(b => ctx.out(backupObj(b)));
    } });
  gpCmd({ name: 'Restore-GPO', shouldProcess: true, synopsis: 'Restores one GPO or all GPOs in a domain from one or more GPO backup files.', params: { ...NAME, All: { type: 'switch' }, Path: { mandatory: true, alias: ['BackupLocation'] }, BackupId: {}, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      const path = ctx.resolvePath(p.Path);
      const all = G.backups(path);
      let picks;
      if (p.BackupId) picks = all.filter(b => bare(b.backupId) === bare(p.BackupId));
      else if (p.All) { const seen = new Set(); picks = all.filter(b => (seen.has(b.gpoId) ? false : seen.add(b.gpoId))); }
      else {
        const want = p.Guid ? '{' + bare(p.Guid) + '}' : null;
        picks = all.filter(b => (want ? b.gpoId.toLowerCase() === want.toLowerCase() : b.name.toLowerCase() === toStr(p.Name).toLowerCase())).slice(0, 1);
      }
      if (!picks.length) return ctx.error({ message: `A backup of the GPO "${p.Name || p.Guid || p.BackupId}" was not found in "${p.Path}".`, category: 'ObjectNotFound', target: p.Path, exception: 'ArgumentException', id: `BackupNotFound,${cls(ctx.name)}` });
      for (const b of picks) {
        if (!(await ctx.confirm('Restore-GPO', b.name))) continue;
        const r = G.restore(b.backupId, path);
        if (!r.ok) { fail(ctx, r, b.name); continue; }
        ctx.out(gpoObj(r.gpo));
      }
    } });
  gpCmd({ name: 'Import-GPO', shouldProcess: true, synopsis: 'Imports the Group Policy settings from a backed-up GPO into a specified GPO.', params: { BackupGpoName: {}, BackupId: {}, TargetName: {}, TargetGuid: {}, Path: { mandatory: true }, CreateIfNeeded: { type: 'switch' }, MigrationTable: {}, ...COMMON },
    async process(ctx, p) {
      check(ctx);
      if (!(await ctx.confirm('Import-GPO', p.TargetName || p.TargetGuid))) return;
      const r = G.importSettings(p.BackupId || p.BackupGpoName, ctx.resolvePath(p.Path), p.TargetName || p.TargetGuid, { createIfNeeded: !!p.CreateIfNeeded });
      if (!r.ok) return fail(ctx, r, p.TargetName);
      ctx.out(gpoObj(r.gpo));
    } });

  /* ---------------------------------------------------------------- Starter GPOs */
  const starterObj = s => psobj('Microsoft.GroupPolicy.StarterGpo', { DisplayName: s.name, Id: bare(s.id), Owner: `${WS.state.ad.netbios}\\Domain Admins`, CreationTime: new Date(s.created), ModificationTime: new Date(s.modified), UserVersion: s.userVersion || 0, ComputerVersion: s.computerVersion || 0, StarterGpoVersion: '1.0', StarterGpoType: s.system ? 'System' : 'Custom', Author: s.system ? 'Microsoft Corporation' : 'Administrator', Product: s.system ? 'Microsoft Windows' : '', Description: s.description }, { str: 'Microsoft.GroupPolicy.StarterGpo' });
  gpCmd({ name: 'New-GPStarterGPO', shouldProcess: true, synopsis: 'Creates a new Starter GPO.', params: { Name: { pos: 0, mandatory: true }, Comment: {}, ...COMMON },
    async process(ctx, p) { check(ctx); if (!(await ctx.confirm('New-GPStarterGPO', p.Name))) return; const r = G.createStarter(p.Name, p.Comment); if (!r.ok) return fail(ctx, r, p.Name); ctx.out(starterObj(r.starter)); } });
  gpCmd({ name: 'Get-GPStarterGPO', synopsis: 'Gets one Starter GPO or all Starter GPOs in a domain.', params: { Name: { pos: 0 }, Guid: {}, All: { type: 'switch' }, ...COMMON },
    process(ctx, p) {
      check(ctx);
      if (!WS.state.ad.starterGpos) return ctx.error({ message: `The Starter GPOs folder does not exist in the ${dom()} domain.`, category: 'ObjectNotFound', target: '', exception: 'ArgumentException', id: `StarterGpoFolderNotFound,${cls(ctx.name)}` });
      const list = p.All || (!p.Name && !p.Guid) ? G.starters() : [G.starter(p.Guid || p.Name)].filter(Boolean);
      if (!list.length) return ctx.error({ message: `The Starter GPO "${p.Name || p.Guid}" could not be found in the ${dom()} domain.`, category: 'ObjectNotFound', target: '', exception: 'ArgumentException', id: `StarterGpoNotFound,${cls(ctx.name)}` });
      list.forEach(s => ctx.out(starterObj(s)));
    } });
})();
