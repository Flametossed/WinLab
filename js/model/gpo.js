/* Group Policy model: WS.gpo. GPOs and their settings, links, inheritance, security filtering, WMI filters,
 * Resultant Set of Policy, policy processing (gpupdate, boot, sign-in, background refresh), backups and Starter GPOs.
 * GPMC, the Group Policy Management Editor, gpupdate/gpresult and the GroupPolicy PowerShell module all use it.
 *
 * State (in the ad slice, as AD stores it):
 *   ad.gpos[]: { id '{GUID}', name, status 'AllSettingsEnabled'|'UserSettingsDisabled'|'ComputerSettingsDisabled'|'AllSettingsDisabled',
 *                created, modified, owner (SID), description, computerVersion, userVersion, computer {key: value}, user {key: value},
 *                registry { computer: [], user: [] } (values without an ADMX definition), acl [{ sid, level }], wmiFilter (id) }
 *   Links live on the domain and OU objects, like gPLink: obj.gpLinks [{ gpo, enabled, enforced }] (index 0 = link order 1);
 *   obj.blockInheritance. ad.wmiFilters[], ad.starterGpos (null until the Starter GPOs folder is created).
 * State slice gp: { local (the Local Group Policy object), applied: { computer, user } (the last processing results), prefs }.
 * Policy only takes effect when it is processed: at boot, at sign-in, on gpupdate and every 5 minutes on a DC.
 * Permission levels: GpoRead, GpoApply (Read + Apply group policy = security filtering), GpoEdit, GpoEditDeleteModifySecurity, GpoCustom. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util, CAT = WS.gpoCatalog;

  WS.store.init('gp', s => {
    s.gp = { local: { name: 'Local Group Policy', computer: {}, user: {}, registry: { computer: [], user: [] }, computerVersion: 0, userVersion: 0, modified: null }, applied: { computer: null, user: null }, prefs: {} };
  });

  const DDP = '{31B2F340-016D-11D2-945F-00C04FB984F9}', DDCP = '{6AC1786C-016F-11D2-945F-00C04fB984F9}';
  const STATUS = ['AllSettingsEnabled', 'UserSettingsDisabled', 'ComputerSettingsDisabled', 'AllSettingsDisabled'];
  const STATUS_LABEL = { AllSettingsEnabled: 'Enabled', UserSettingsDisabled: 'User configuration settings disabled', ComputerSettingsDisabled: 'Computer configuration settings disabled', AllSettingsDisabled: 'All settings disabled' };
  const LEVELS = ['GpoRead', 'GpoApply', 'GpoEdit', 'GpoEditDeleteModifySecurity', 'GpoCustom'];
  const LEVEL_LABEL = { GpoRead: 'Read', GpoApply: 'Read (from Security Filtering)', GpoEdit: 'Edit settings', GpoEditDeleteModifySecurity: 'Edit settings, delete, modify security', GpoCustom: 'Custom' };
  const WK = { 'S-1-1-0': 'Everyone', 'S-1-5-11': 'NT AUTHORITY\\Authenticated Users', 'S-1-5-9': 'NT AUTHORITY\\ENTERPRISE DOMAIN CONTROLLERS', 'S-1-5-18': 'NT AUTHORITY\\SYSTEM', 'S-1-3-0': 'CREATOR OWNER' };
  const ACCOUNT_MAP = { PasswordHistorySize: 'history', MaximumPasswordAge: 'maxAgeDays', MinimumPasswordAge: 'minAgeDays', MinimumPasswordLength: 'minLength', PasswordComplexity: 'complexity', ClearTextPassword: 'reversible', LockoutBadCount: 'lockoutThreshold', LockoutDuration: 'lockoutMinutes', ResetLockoutCount: 'lockoutWindowMinutes' };

  const A = () => WS.state.ad;
  const ieq = (a, b) => String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
  const now = () => new Date().toISOString();
  const fail = (code, error, extra) => Object.assign({ ok: false, code, error }, extra);
  const notDC = () => fail('NotDC', 'The specified domain either does not exist or could not be contacted.');
  const newId = () => '{' + U.guid().toUpperCase() + '}';
  const dsid = rid => `${A().domainSid}-${rid}`;
  const changed = (...t) => WS.store.changed('gpo', ...t);

  /* ---------------------------------------------------------------- defaults */
  const DDP_SETTINGS = {
    PasswordHistorySize: 24, MaximumPasswordAge: 42, MinimumPasswordAge: 1, MinimumPasswordLength: 7, PasswordComplexity: true, ClearTextPassword: false,
    LockoutBadCount: 0, TicketValidateClient: true, MaxServiceAge: 600, MaxTicketAge: 10, MaxRenewAge: 7, MaxClockSkew: 5,
    LSAAnonymousNameLookup: false, NoLMHash: true, ForceLogoffWhenHourExpire: false
  };
  const DDCP_SETTINGS = () => ({
    SeNetworkLogonRight: ['Everyone', 'BUILTIN\\Administrators', 'NT AUTHORITY\\Authenticated Users', 'NT AUTHORITY\\ENTERPRISE DOMAIN CONTROLLERS', 'BUILTIN\\Pre-Windows 2000 Compatible Access'],
    SeMachineAccountPrivilege: ['NT AUTHORITY\\Authenticated Users'],
    SeIncreaseQuotaPrivilege: ['NT AUTHORITY\\LOCAL SERVICE', 'NT AUTHORITY\\NETWORK SERVICE', 'BUILTIN\\Administrators'],
    SeInteractiveLogonRight: ['BUILTIN\\Administrators', 'BUILTIN\\Backup Operators', 'BUILTIN\\Account Operators', 'BUILTIN\\Print Operators', 'BUILTIN\\Server Operators', 'NT AUTHORITY\\ENTERPRISE DOMAIN CONTROLLERS'],
    SeBackupPrivilege: ['BUILTIN\\Administrators', 'BUILTIN\\Backup Operators', 'BUILTIN\\Server Operators'],
    SeChangeNotifyPrivilege: ['Everyone', 'NT AUTHORITY\\LOCAL SERVICE', 'NT AUTHORITY\\NETWORK SERVICE', 'BUILTIN\\Administrators', 'NT AUTHORITY\\Authenticated Users', 'BUILTIN\\Pre-Windows 2000 Compatible Access'],
    SeSystemtimePrivilege: ['NT AUTHORITY\\LOCAL SERVICE', 'BUILTIN\\Administrators', 'BUILTIN\\Server Operators'],
    SeCreatePagefilePrivilege: ['BUILTIN\\Administrators'], SeDebugPrivilege: ['BUILTIN\\Administrators'], SeEnableDelegationPrivilege: ['BUILTIN\\Administrators'],
    SeRemoteShutdownPrivilege: ['BUILTIN\\Administrators', 'BUILTIN\\Server Operators'], SeAuditPrivilege: ['NT AUTHORITY\\LOCAL SERVICE', 'NT AUTHORITY\\NETWORK SERVICE'],
    SeIncreaseBasePriorityPrivilege: ['BUILTIN\\Administrators'], SeLoadDriverPrivilege: ['BUILTIN\\Administrators', 'BUILTIN\\Print Operators'],
    SeBatchLogonRight: ['BUILTIN\\Administrators', 'BUILTIN\\Backup Operators', 'BUILTIN\\Performance Log Users'], SeSecurityPrivilege: ['BUILTIN\\Administrators'],
    SeSystemEnvironmentPrivilege: ['BUILTIN\\Administrators'], SeProfileSingleProcessPrivilege: ['BUILTIN\\Administrators'], SeSystemProfilePrivilege: ['BUILTIN\\Administrators', 'NT SERVICE\\WdiServiceHost'],
    SeUndockPrivilege: ['BUILTIN\\Administrators'], SeAssignPrimaryTokenPrivilege: ['NT AUTHORITY\\LOCAL SERVICE', 'NT AUTHORITY\\NETWORK SERVICE'],
    SeRestorePrivilege: ['BUILTIN\\Administrators', 'BUILTIN\\Backup Operators', 'BUILTIN\\Server Operators'], SeShutdownPrivilege: ['BUILTIN\\Administrators', 'BUILTIN\\Backup Operators', 'BUILTIN\\Server Operators', 'BUILTIN\\Print Operators'],
    SeTakeOwnershipPrivilege: ['BUILTIN\\Administrators'],
    RequireSignOrSeal: true, RequireSecuritySignature: true, EnableSecuritySignature: true, LDAPServerIntegrity: 1
  });
  const defaultAcl = () => [{ sid: 'S-1-5-11', level: 'GpoApply' }, { sid: dsid(512), level: 'GpoEditDeleteModifySecurity' }, { sid: dsid(519), level: 'GpoEditDeleteModifySecurity' },
    { sid: 'S-1-5-9', level: 'GpoRead' }, { sid: 'S-1-5-18', level: 'GpoEditDeleteModifySecurity' }];
  const isDefault = g => g && (g.id === DDP || ieq(g.id, DDCP));

  function fill(g) {
    if (g.status === 'Enabled' || !STATUS.includes(g.status)) g.status = 'AllSettingsEnabled';
    if (!g.computer) {
      g.computer = ieq(g.id, DDP) ? { ...DDP_SETTINGS } : ieq(g.id, DDCP) ? DDCP_SETTINGS() : {};
      g.user = g.user || {};
    }
    g.user = g.user || {};
    if (g.computerVersion == null) g.computerVersion = ieq(g.id, DDP) ? 3 : ieq(g.id, DDCP) ? 1 : 0;
    if (g.userVersion == null) g.userVersion = 0;
    g.registry = g.registry || { computer: [], user: [] };
    g.acl = g.acl || defaultAcl();
    g.owner = g.owner || dsid(512);
    if (g.description == null) g.description = '';
    if (g.wmiFilter === undefined) g.wmiFilter = null;
    g.created = g.created || now(); g.modified = g.modified || g.created;
  }
  /** Bring an older saved state up to this model (links on the GPO -> gPLink on the container). Cheap once done. */
  function ensure() {
    const ad = A();
    if (!ad) return null;
    if (ad.gpModel === 2) return ad;
    ad.gpos = ad.gpos || [];
    for (const g of ad.gpos) {
      for (const l of g.links || []) {
        const som = WS.ad.byDn(l);
        if (som && !(som.gpLinks || []).some(x => x.gpo === g.id)) (som.gpLinks = som.gpLinks || []).push({ gpo: g.id, enabled: true, enforced: false });
      }
      delete g.links;
      fill(g);
    }
    ad.wmiFilters = ad.wmiFilters || [];
    if (ad.starterGpos === undefined) ad.starterGpos = null;
    if (ad.policy && ad.policy.lockoutWindowMinutes == null) ad.policy.lockoutWindowMinutes = ad.policy.lockoutMinutes || 10;
    ad.gpModel = 2;
    for (const g of ad.gpos) writeSysvol(g);
    return ad;
  }

  /* ---------------------------------------------------------------- principals */
  function principal(sid) {
    if (WK[sid]) return { sid, name: WK[sid], short: WK[sid].replace(/^.*\\/, ''), type: 'WellKnownGroup' };
    const ad = A();
    const o = ad && ad.objects.find(x => x.sid === sid);
    if (!o) return { sid, name: sid, short: sid, type: 'Unknown' };
    const parent = WS.ad.byId(o.parentId);
    const dom = parent && parent.type === 'builtinDomain' ? 'BUILTIN' : ad.netbios;
    return { sid, name: `${dom}\\${o.sam || o.name}`, short: o.name, type: o.type === 'group' ? 'Group' : o.type === 'user' ? 'User' : 'Computer', obj: o };
  }
  /** 'Authenticated Users', 'CONTOSO\\Sales Staff', 'Sales Staff', a SID, or an AD object -> principal, or null. */
  function resolvePrincipal(x) {
    if (!x || !A()) return null;
    if (typeof x === 'object') return x.sid ? principal(x.sid) : x.obj && x.obj.sid ? principal(x.obj.sid) : null;
    const s = String(x).trim();
    const wk = Object.entries(WK).find(([sid, n]) => ieq(sid, s) || ieq(n, s) || ieq(n.replace(/^.*\\/, ''), s));
    if (wk) return principal(wk[0]);
    const bare = s.replace(/^[^\\]+\\/, '');
    const o = A().objects.find(z => z.sid && ieq(z.sid, s)) || WS.ad.resolveIdentity(bare, ['user', 'group', 'computer']) || WS.ad.get(bare, ['user', 'group', 'computer']);
    return o && o.sid ? principal(o.sid) : null;
  }
  /** SIDs in an object's token: itself, Everyone, Authenticated Users, its groups (nested) and, for a DC, ENTERPRISE DOMAIN CONTROLLERS. */
  function tokenSids(o) {
    const sids = new Set(['S-1-1-0', 'S-1-5-11']);
    if (!o || !A()) return sids;
    if (o.sid) sids.add(o.sid);
    for (const g of WS.ad.memberOf(o, true)) if (g.sid) sids.add(g.sid);
    if (o.type === 'computer' && o.primaryGroupId === 516) sids.add('S-1-5-9');
    return sids;
  }
  const RANK = { GpoRead: 1, GpoApply: 2, GpoEdit: 3, GpoEditDeleteModifySecurity: 4, GpoCustom: 1 };
  const canApply = (g, tokens) => g.acl.some(e => e.level === 'GpoApply' && tokens.has(e.sid));
  const canRead = (g, tokens) => g.acl.some(e => RANK[e.level] >= 1 && tokens.has(e.sid));

  /* ---------------------------------------------------------------- GPOs */
  const gpos = () => (ensure() ? A().gpos : []);
  const local = () => WS.state.gp.local;
  /** id ('{GUID}' with or without braces, any case), display name, 'local' or a GPO object. */
  function get(x) {
    if (!x) return null;
    if (typeof x === 'object') return x === local() ? x : gpos().find(g => g === x || g.id === x.id) || null;
    if (ieq(x, 'local')) return local();
    const s = String(x).trim();
    const bare = s.replace(/^\{|\}$/g, '');
    return gpos().find(g => ieq(g.id, '{' + bare + '}')) || gpos().find(g => ieq(g.name, s)) || null;
  }
  const isLocal = g => g === local();
  const sideOn = (g, side) => isLocal(g) || (side === 'user' ? !/^(UserSettingsDisabled|AllSettingsDisabled)$/.test(g.status) : !/^(ComputerSettingsDisabled|AllSettingsDisabled)$/.test(g.status));
  const sideSettings = (g, side) => g[side] || {};
  const isEmpty = (g, side) => !Object.keys(sideSettings(g, side)).length && !((g.registry || {})[side] || []).length && !(WS.gpp && WS.gpp.count(g, side));
  const nameTaken = (name, self) => gpos().some(g => g !== self && ieq(g.name, name));
  const badName = name => (!name ? 'You must specify a name.' : name.length > 255 ? 'The name cannot be longer than 255 characters.' : null);

  function create(name, o = {}) {
    if (!ensure()) return notDC();
    name = String(name == null ? '' : name).trim();
    const bad = badName(name); if (bad) return fail('Invalid', bad);
    if (nameTaken(name)) return fail('Exists', `A GPO named "${name}" already exists in the ${A().domain} domain.`);
    const g = { id: o.id || newId(), name, status: 'AllSettingsEnabled', created: now(), modified: now(), owner: dsid(512), description: o.comment || '',
      computerVersion: 0, userVersion: 0, computer: {}, user: {}, registry: { computer: [], user: [] }, acl: defaultAcl(), wmiFilter: null };
    if (o.starter) {
      const st = starter(o.starter);
      if (!st) return fail('NotFound', `The Starter GPO "${o.starter}" was not found.`);
      g.computer = JSON.parse(JSON.stringify(st.computer || {})); g.user = JSON.parse(JSON.stringify(st.user || {}));
      g.computerVersion = Object.keys(g.computer).length ? 1 : 0; g.userVersion = Object.keys(g.user).length ? 1 : 0;
      if (!g.description) g.description = st.description || '';
    }
    A().gpos.push(g);
    writeSysvol(g, true);
    changed();
    return { ok: true, gpo: g };
  }
  function remove(x) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    A().gpos = A().gpos.filter(y => y !== g);
    for (const som of soms()) if (som.gpLinks) som.gpLinks = som.gpLinks.filter(l => l.gpo !== g.id);
    try { WS.fs.remove(gpoDir(g), null, { recursive: true }); } catch (e) { /* already gone */ }
    changed('ad');
    return { ok: true };
  }
  function rename(x, name) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    name = String(name == null ? '' : name).trim();
    const bad = badName(name); if (bad) return fail('Invalid', bad);
    if (nameTaken(name, g)) return fail('Exists', `A GPO named "${name}" already exists in the ${A().domain} domain.`);
    g.name = name; g.modified = now();
    changed();
    return { ok: true };
  }
  function setStatus(x, status) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    const s = STATUS.find(v => ieq(v, status)) || Object.keys(STATUS_LABEL).find(k => ieq(STATUS_LABEL[k], status));
    if (!s) return fail('Invalid', `Cannot bind parameter 'GpoStatus'. Specify one of: ${STATUS.join(', ')}.`);
    g.status = s; g.modified = now();
    changed();
    return { ok: true };
  }
  function setComment(x, text) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    g.description = String(text || ''); g.modified = now();
    changed();
    return { ok: true };
  }
  /** Copy-GPO / Copy + Paste in GPMC: same settings under a new GUID, no links. */
  function copy(x, o = {}) {
    const src = get(x); if (!src || isLocal(src)) return notFoundGpo(x);
    const name = o.name || `Copy of ${src.name}`;
    const r = create(name, { comment: src.description });
    if (!r.ok) return r;
    const g = r.gpo;
    g.computer = JSON.parse(JSON.stringify(src.computer)); g.user = JSON.parse(JSON.stringify(src.user));
    g.registry = JSON.parse(JSON.stringify(src.registry)); g.status = src.status; g.wmiFilter = src.wmiFilter;
    if (src.prefs) g.prefs = JSON.parse(JSON.stringify(src.prefs));
    g.computerVersion = Object.keys(g.computer).length ? 1 : 0; g.userVersion = Object.keys(g.user).length || (WS.gpp && WS.gpp.count(g, 'user')) ? 1 : 0;
    if (o.preservePermissions) g.acl = JSON.parse(JSON.stringify(src.acl));
    writeSysvol(g);
    changed();
    return { ok: true, gpo: g };
  }
  const notFoundGpo = x => fail('NotFound', `The GPO "${x && x.name ? x.name : x}" was not found in the ${A() ? A().domain : ''} domain.`);

  /* ---------------------------------------------------------------- settings */
  function definition(side, key) {
    if (side === 'computer' && /^svc:/i.test(key)) {
      const svc = WS.svc.get(key.slice(4));
      return svc ? { key: 'svc:' + svc.name, side, kind: 'service', name: svc.display, service: svc.name, group: 'security', node: 'c.sec.svc', inf: ['Service General Setting', svc.name] } : null;
    }
    return CAT.get(side, key);
  }
  const SVC_MODES = ['Automatic', 'Manual', 'Disabled'];
  function normalize(def, v) {
    switch (def.kind) {
      case 'num': {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n)) return { error: `${def.name} must be a number.` };
        return { value: n };
      }
      case 'bool': return { value: typeof v === 'string' ? /^(1|true|enabled|yes)$/i.test(v) : !!v };
      case 'audit': return { value: typeof v === 'number' ? v & 3 : (/success/i.test(v) ? 1 : 0) | (/failure/i.test(v) ? 2 : 0) };
      case 'accounts': return { value: (Array.isArray(v) ? v : String(v).split(/[,;]/)).map(x => String(x).trim()).filter(Boolean) };
      case 'text': case 'multitext': return { value: String(v) };
      case 'select': {
        const c = def.choices.find(c => String(c.value) === String(v) || ieq(c.label, v));
        return c ? { value: c.value } : { error: `"${v}" is not a valid value for ${def.name}.` };
      }
      case 'service': {
        const m = SVC_MODES.find(x => ieq(x, v));
        return m ? { value: m } : { error: 'Select a service startup mode: Automatic, Manual or Disabled.' };
      }
      case 'policy': {
        const p = typeof v === 'string' ? { state: v } : { ...v };
        const state = ieq(p.state, 'enabled') ? 'Enabled' : ieq(p.state, 'disabled') ? 'Disabled' : null;
        if (!state) return { error: 'Specify Enabled or Disabled.' };
        const options = {};
        if (state === 'Enabled') for (const op of def.options) {
          let val = p.options && op.id in p.options ? p.options[op.id] : op.dflt;
          if (op.type === 'number') {
            val = Math.floor(Number(val));
            if (!Number.isFinite(val) || (op.min != null && val < op.min) || (op.max != null && val > op.max)) return { error: `The value of "${op.label.replace(/:$/, '')}" must be between ${op.min} and ${op.max}.` };
          } else if (op.type === 'check') val = !!val;
          else if (op.type === 'list') val = (Array.isArray(val) ? val : String(val || '').split(/\r?\n/)).map(x => String(x).trim()).filter(Boolean);
          else if (op.type === 'select') { const c = op.choices.find(c => String(c.value) === String(val) || ieq(c.label, val)); if (!c) return { error: `"${val}" is not a valid choice for "${op.label.replace(/:$/, '')}".` }; val = c.value; }
          else val = val == null ? '' : String(val);
          options[op.id] = val;
        }
        return { value: { state, options, comment: p.comment || '' } };
      }
    }
    return { value: v };
  }
  function rangeError(g, side, def, v) {
    if (def.kind !== 'num') return null;
    let max = def.max;
    if (def.key === 'MinimumPasswordLength' && g[side].RelaxMinimumPasswordLengthLimits === true) max = 128;
    if (v < def.min || v > max) return `The value for ${def.name} must be between ${def.min} and ${max}.`;
    return null;
  }
  /** setSetting(gpo, 'computer'|'user', key, value) - value null removes it (Not Defined / Not Configured). */
  function setSetting(x, side, key, value, o = {}) {
    const g = get(x); if (!g) return notFoundGpo(x);
    const def = definition(side, key);
    if (!def) return fail('Invalid', `The setting "${key}" does not exist in the ${side === 'user' ? 'User' : 'Computer'} Configuration.`);
    if (value === null || value === undefined) {
      if (!(def.key in g[side])) return { ok: true, changed: false };
      delete g[side][def.key];
    } else {
      const n = normalize(def, value);
      if (n.error) return fail('Invalid', n.error);
      const re = rangeError(g, side, def, n.value); if (re) return fail('Invalid', re);
      if (JSON.stringify(g[side][def.key]) === JSON.stringify(n.value)) return { ok: true, changed: false };
      g[side][def.key] = n.value;
    }
    if (!o.quiet) touch(g, side);
    return { ok: true, changed: true };
  }
  const setting = (x, side, key) => { const g = get(x); const def = g && definition(side, key); return g && def ? (g[side][def.key] === undefined ? null : g[side][def.key]) : null; };
  function touch(g, side) {
    g[side === 'user' ? 'userVersion' : 'computerVersion']++;
    g.modified = now();
    if (isLocal(g)) {
      WS.store.changed('gp');
      // the Local Group Policy Editor's changes apply at once (and local account policy always does)
      refresh({ target: side, reason: 'local', silent: true });
      return;
    }
    writeSysvol(g);
    changed();
  }

  /* ---- registry values (Set-GPRegistryValue) ---- */
  const HIVES = { hklm: 'HKLM', hkey_local_machine: 'HKLM', hkcu: 'HKCU', hkey_current_user: 'HKCU' };
  function parseKey(k) {
    const m = String(k || '').match(/^([^\\:]+):?\\(.+)$/);
    const hive = m && HIVES[m[1].toLowerCase()];
    return hive ? { hive, key: m[2].replace(/\\+$/, '') } : null;
  }
  const policyFor = (hive, key, value) => CAT.settings.find(s => s.kind === 'policy' && (() => { const r = CAT.splitReg(s.reg); return r.hive === hive && ieq(r.key, key) && ieq(r.value, value); })());
  const regType = v => (typeof v === 'number' ? 'DWord' : 'String');
  /** The registry values a catalog policy writes, as Get-GPRegistryValue reports them. */
  function regValuesOf(def, v) {
    const r = CAT.splitReg(def.reg);
    if (v.state === 'Disabled') return def.off == null ? [] : [{ ...r, type: regType(def.off), data: def.off }];
    const opt = def.options.find(o => o.reg);
    const data = def.on != null ? def.on : opt ? v.options[opt.id] : 1;
    const out = [{ ...r, type: regType(data), data }];
    for (const op of def.options) if (!op.reg && op.type !== 'list') out.push({ hive: r.hive, key: r.key, value: op.id, type: regType(op.type === 'check' ? 1 : v.options[op.id]), data: op.type === 'check' ? (v.options[op.id] ? 1 : 0) : v.options[op.id] });
    return out;
  }
  function registryValues(x) {
    const g = get(x); if (!g) return [];
    const out = [];
    for (const side of ['computer', 'user']) {
      for (const [k, v] of Object.entries(g[side])) { const def = CAT.get(side, k); if (def && def.kind === 'policy') out.push(...regValuesOf(def, v)); }
      for (const e of g.registry[side] || []) out.push({ hive: side === 'computer' ? 'HKLM' : 'HKCU', key: e.key, value: e.value, type: e.type, data: e.data });
    }
    return out;
  }
  /** setRegistryValue(gpo, { key: 'HKCU\\Software\\...', valueName, type, value }) maps onto the ADMX policy that owns the value when there is one. */
  function setRegistryValue(x, o) {
    const g = get(x); if (!g) return notFoundGpo(x);
    const k = parseKey(o.key);
    if (!k) return fail('Invalid', `The registry key "${o.key}" is not valid. Use a key that starts with HKLM\\ or HKCU\\.`);
    const side = k.hive === 'HKLM' ? 'computer' : 'user';
    const type = o.type || regType(o.value);
    const data = /^(DWord|QWord)$/i.test(type) ? Number(o.value) : o.value;
    const def = policyFor(k.hive, k.key, o.valueName);
    if (def) {
      if (def.on != null && String(data) === String(def.on)) return setSetting(g, side, def.key, { state: 'Enabled', options: (g[side][def.key] || {}).options });
      if (def.off != null && String(data) === String(def.off)) return setSetting(g, side, def.key, { state: 'Disabled' });
      const opt = def.options.find(op => op.reg);
      if (def.on == null && opt) return setSetting(g, side, def.key, { state: 'Enabled', options: { ...((g[side][def.key] || {}).options || {}), [opt.id]: data } });
    }
    const list = g.registry[side];
    const i = list.findIndex(e => ieq(e.key, k.key) && ieq(e.value, o.valueName));
    const entry = { key: k.key, value: o.valueName || '', type, data };
    if (i >= 0) list[i] = entry; else list.push(entry);
    touch(g, side);
    return { ok: true };
  }
  function removeRegistryValue(x, key, valueName) {
    const g = get(x); if (!g) return notFoundGpo(x);
    const k = parseKey(key); if (!k) return fail('Invalid', `The registry key "${key}" is not valid.`);
    const side = k.hive === 'HKLM' ? 'computer' : 'user';
    let n = 0;
    for (const [sk, v] of Object.entries(g[side])) {
      const def = CAT.get(side, sk);
      if (def && def.kind === 'policy' && regValuesOf(def, v).some(r => ieq(r.key, k.key) && (valueName == null || ieq(r.value, valueName)))) { delete g[side][sk]; n++; }
    }
    const before = g.registry[side].length;
    g.registry[side] = g.registry[side].filter(e => !(ieq(e.key, k.key) && (valueName == null || ieq(e.value, valueName))));
    n += before - g.registry[side].length;
    if (!n) return fail('NotFound', `The following key or value was not found in the GPO: ${key}${valueName ? '\\' + valueName : ''}.`);
    touch(g, side);
    return { ok: true, count: n };
  }

  /* ---------------------------------------------------------------- display */
  /** Text the editor's Policy Setting / State column shows. */
  function display(def, v, g, side) {
    if (def.lockout && g) {
      const t = g[side || 'computer'].LockoutBadCount;
      if (t === 0 && v === undefined) return 'Not Applicable';
    }
    if (v === undefined || v === null) return def.kind === 'policy' ? 'Not configured' : 'Not Defined';
    switch (def.kind) {
      case 'num': return `${v} ${def.unit}`;
      case 'bool': return v ? 'Enabled' : 'Disabled';
      case 'audit': return v === 3 ? 'Success, Failure' : v === 1 ? 'Success' : v === 2 ? 'Failure' : 'No auditing';
      case 'accounts': return v.join(',');
      case 'select': { const c = def.choices.find(c => c.value === v); return c ? c.label : String(v); }
      case 'multitext': return String(v).replace(/\r?\n/g, ' ');
      case 'policy': return v.state;
      default: return String(v);
    }
  }

  /* ---------------------------------------------------------------- links and inheritance */
  const soms = () => (A() ? A().objects.filter(o => o.type === 'domainDNS' || o.type === 'organizationalUnit') : []);
  /** A scope of management: the domain or an OU, by object, id, DN, 'contoso.local' or OU path 'Sales/East'. */
  function somOf(x) {
    if (!x || !ensure()) return null;
    if (typeof x === 'object') { const o = WS.ad.byId(x.id); return o && (o.type === 'domainDNS' || o.type === 'organizationalUnit') ? o : null; }
    const s = String(x).trim();
    if (ieq(s, A().domain) || ieq(s.replace(/\s+/g, ''), WS.ad.domainDN().replace(/\s+/g, ''))) return WS.ad.root();
    const o = WS.ad.byId(s) || WS.ad.container(s);
    return o && (o.type === 'domainDNS' || o.type === 'organizationalUnit') ? o : null;
  }
  const somName = som => (som.type === 'domainDNS' ? A().domain : som.name);
  const somPath = som => (som.type === 'domainDNS' ? A().domain : WS.ad.canonical(som));
  function linkTargetError(target) {
    const o = typeof target === 'string' ? (target.includes('=') ? WS.ad.byDn(target) : null) : target;
    if (o && !(o.type === 'domainDNS' || o.type === 'organizationalUnit')) return fail('Invalid', `A GPO cannot be linked to "${WS.ad.dn(o)}". GPOs can be linked only to sites, domains, and organizational units.`);
    return fail('NotFound', `The container "${target && target.name ? target.name : target}" was not found in the ${A().domain} domain.`);
  }
  function somLinks(x) { const som = somOf(x); return som ? (som.gpLinks || []).map((l, i) => ({ ...l, order: i + 1, gpoObj: get(l.gpo) })).filter(l => l.gpoObj) : []; }
  /** Every link to a GPO: [{ som, enabled, enforced, order }], sorted by path. */
  function links(x) {
    const g = get(x); if (!g || isLocal(g)) return [];
    const out = [];
    for (const som of soms()) (som.gpLinks || []).forEach((l, i) => { if (l.gpo === g.id) out.push({ som, enabled: l.enabled, enforced: l.enforced, order: i + 1 }); });
    return out.sort((a, b) => somPath(a.som).localeCompare(somPath(b.som)));
  }
  function link(x, target, o = {}) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    const som = somOf(target); if (!som) return linkTargetError(target);
    som.gpLinks = som.gpLinks || [];
    if (som.gpLinks.some(l => l.gpo === g.id)) return fail('Exists', `The GPO named '${g.name}' is already linked to a Scope of Management with Path '${WS.ad.dn(som)}'.`);
    const entry = { gpo: g.id, enabled: o.enabled !== false, enforced: !!o.enforced };
    const at = o.order ? Math.max(1, Math.min(som.gpLinks.length + 1, Math.floor(o.order))) : som.gpLinks.length + 1;
    som.gpLinks.splice(at - 1, 0, entry);
    changed('ad');
    return { ok: true, link: { ...entry, order: at, som } };
  }
  function setLink(x, target, o = {}) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    const som = somOf(target); if (!som) return linkTargetError(target);
    const list = som.gpLinks || [];
    const i = list.findIndex(l => l.gpo === g.id);
    if (i < 0) return fail('NotFound', `The GPO named '${g.name}' is not linked to a Scope of Management with Path '${WS.ad.dn(som)}'.`);
    const l = list[i];
    if (o.enabled != null) l.enabled = !!o.enabled;
    if (o.enforced != null) l.enforced = !!o.enforced;
    if (o.order != null) {
      const to = Math.floor(o.order);
      if (!(to >= 1 && to <= list.length)) return fail('Invalid', `The link order must be between 1 and ${list.length}.`);
      list.splice(i, 1); list.splice(to - 1, 0, l);
    }
    changed('ad');
    return { ok: true, link: { ...l, order: list.indexOf(l) + 1, som } };
  }
  function unlink(x, target) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    const som = somOf(target); if (!som) return linkTargetError(target);
    const before = (som.gpLinks || []).length;
    som.gpLinks = (som.gpLinks || []).filter(l => l.gpo !== g.id);
    if (som.gpLinks.length === before) return fail('NotFound', `The GPO named '${g.name}' is not linked to a Scope of Management with Path '${WS.ad.dn(som)}'.`);
    changed('ad');
    return { ok: true };
  }
  function setBlockInheritance(target, on) {
    const som = somOf(target); if (!som) return linkTargetError(target);
    som.blockInheritance = !!on;
    changed('ad');
    return { ok: true };
  }
  const isBlocked = target => { const som = somOf(target); return !!(som && som.blockInheritance); };
  /** Domain and OU ancestors of an object, top-down (the object itself too when includeSelf). */
  function chainFor(obj, includeSelf) {
    const out = [];
    for (let x = includeSelf ? obj : WS.ad.byId(obj.parentId); x; x = WS.ad.byId(x.parentId)) if (x.type === 'domainDNS' || x.type === 'organizationalUnit') out.unshift(x);
    return out;
  }
  /** Links in precedence order (index 0 = precedence 1): enforced links from the top down, then the others from the closest SOM up,
   *  stopping at a SOM that blocks inheritance. */
  function orderedLinks(chain, includeDisabled) {
    let blockAt = 0;
    chain.forEach((c, i) => { if (c.blockInheritance) blockAt = i; });
    const enforced = [], normal = [];
    chain.forEach((som, level) => (som.gpLinks || []).forEach((l, i) => {
      const gpo = get(l.gpo);
      if (!gpo || (!l.enabled && !includeDisabled)) return;
      const e = { gpo, som, link: l, level, order: i + 1 };
      if (l.enforced) enforced.push(e); else if (level >= blockAt) normal.push(e);
    }));
    enforced.sort((a, b) => a.level - b.level || a.order - b.order);
    normal.sort((a, b) => b.level - a.level || a.order - b.order);
    return [...enforced, ...normal];
  }
  /** GPMC's Group Policy Inheritance tab for a domain or OU. */
  function inheritance(target) {
    const som = somOf(target); if (!som) return [];
    return orderedLinks(chainFor(som, true), false).map((e, i) => ({ precedence: i + 1, gpo: e.gpo, som: e.som, enforced: e.link.enforced, enabled: e.link.enabled }));
  }

  /* ---------------------------------------------------------------- permissions (security filtering, delegation) */
  function permissions(x) {
    const g = get(x); if (!g || isLocal(g)) return [];
    return g.acl.map(e => ({ ...principal(e.sid), level: e.level, label: LEVEL_LABEL[e.level], inherited: false }));
  }
  const filtering = x => permissions(x).filter(p => p.level === 'GpoApply');
  /** setPermission(gpo, principal, level | 'None', { replace }) - Set-GPPermission semantics: without replace, a lower level is refused. */
  function setPermission(x, who, level, o = {}) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    const p = resolvePrincipal(who);
    if (!p) return fail('NotFound', `Trustee "${who}" could not be found.`);
    const lv = level === 'None' ? 'None' : LEVELS.find(l => ieq(l, level));
    if (!lv) return fail('Invalid', `Cannot bind parameter 'PermissionLevel'. Specify one of: GpoRead, GpoApply, GpoEdit, GpoEditDeleteModifySecurity, None.`);
    const i = g.acl.findIndex(e => e.sid === p.sid);
    if (lv === 'None') {
      if (i < 0) return { ok: true, changed: false };
      if (!o.replace) return fail('Invalid', `The trustee ${p.name} already has permissions on this GPO. Use the Replace parameter to remove them.`);
      g.acl.splice(i, 1);
    } else if (i >= 0) {
      if (g.acl[i].level === lv) return { ok: true, changed: false };
      if (!o.replace && RANK[g.acl[i].level] > RANK[lv]) return fail('Invalid', `The trustee ${p.name} already has a higher permission level (${g.acl[i].level}) on this GPO. Use the Replace parameter to lower it.`);
      g.acl[i].level = lv;
    } else g.acl.push({ sid: p.sid, level: lv });
    g.modified = now();
    changed();
    return { ok: true, changed: true, principal: p };
  }

  /* ---------------------------------------------------------------- WMI filters */
  const wmiFilters = () => (ensure() ? A().wmiFilters : []);
  const wmiFilter = x => (x && typeof x === 'object' ? x : wmiFilters().find(f => f.id === x || ieq(f.name, x))) || null;
  function checkQueries(qs) {
    if (!qs || !qs.length) return 'A WMI filter must contain at least one query.';
    for (const q of qs) if (!/^\s*select\s+.+\s+from\s+\w+/i.test(q.query || '')) return `The query "${q.query}" is not valid. A WMI query must use the form SELECT * FROM <class> WHERE <condition>.`;
    return null;
  }
  function createWmiFilter(o) {
    if (!ensure()) return notDC();
    const name = String(o.name || '').trim();
    if (!name) return fail('Invalid', 'You must enter a name for the WMI filter.');
    if (wmiFilters().some(f => ieq(f.name, name))) return fail('Exists', `A WMI filter named "${name}" already exists.`);
    const queries = (o.queries || []).map(q => (typeof q === 'string' ? { namespace: 'root\\CIMv2', query: q } : { namespace: q.namespace || 'root\\CIMv2', query: q.query }));
    const e = checkQueries(queries); if (e) return fail('Invalid', e);
    const f = { id: newId(), name, description: o.description || '', queries, author: `Administrator@${A().domain.toUpperCase()}`, created: now(), modified: now() };
    A().wmiFilters.push(f);
    changed();
    return { ok: true, filter: f };
  }
  function setWmiFilterProps(x, o) {
    const f = wmiFilter(x); if (!f) return fail('NotFound', `The WMI filter "${x}" was not found.`);
    if (o.name != null) {
      const n = String(o.name).trim();
      if (!n) return fail('Invalid', 'You must enter a name for the WMI filter.');
      if (wmiFilters().some(y => y !== f && ieq(y.name, n))) return fail('Exists', `A WMI filter named "${n}" already exists.`);
      f.name = n;
    }
    if (o.description != null) f.description = String(o.description);
    if (o.queries) { const qs = o.queries.map(q => (typeof q === 'string' ? { namespace: 'root\\CIMv2', query: q } : q)); const e = checkQueries(qs); if (e) return fail('Invalid', e); f.queries = qs; }
    f.modified = now();
    changed();
    return { ok: true };
  }
  function removeWmiFilter(x) {
    const f = wmiFilter(x); if (!f) return fail('NotFound', `The WMI filter "${x}" was not found.`);
    if (gpos().some(g => g.wmiFilter === f.id)) return fail('InUse', 'The WMI filter is linked to one or more GPOs. Remove the links before deleting the WMI filter.');
    A().wmiFilters = A().wmiFilters.filter(y => y !== f);
    changed();
    return { ok: true };
  }
  function setGpoWmiFilter(x, filter) {
    const g = get(x); if (!g || isLocal(g)) return notFoundGpo(x);
    if (filter == null || filter === '') g.wmiFilter = null;
    else { const f = wmiFilter(filter); if (!f) return fail('NotFound', `The WMI filter "${filter}" was not found.`); g.wmiFilter = f.id; }
    g.modified = now();
    changed();
    return { ok: true };
  }
  /** WMI values for a computer object (the lab only answers Win32_OperatingSystem and Win32_ComputerSystem). */
  function wmiClasses(c) {
    const dc = !c || (c.type === 'computer' && c.primaryGroupId === 516) || (c.name && ieq(c.name, WS.sys.name) && WS.sys.isDC());
    const os = (c && c.os) || (dc || (c && ieq(c.name, WS.sys.name)) ? 'Windows Server 2025 Datacenter Evaluation' : 'Windows 11 Enterprise');
    return {
      win32_operatingsystem: { Caption: 'Microsoft ' + os, Version: /Windows 11/.test(os) ? '10.0.26100' : '10.0.26100', BuildNumber: '26100', ProductType: dc ? 2 : /server/i.test(os) ? 3 : 1, OSArchitecture: '64-bit', OperatingSystemSKU: dc ? 8 : 4 },
      win32_computersystem: { Name: c ? c.name : WS.sys.name, Domain: A() ? A().domain : 'WORKGROUP', PartOfDomain: !!A(), Manufacturer: 'Microsoft Corporation', Model: 'Virtual Machine', DomainRole: dc ? 5 : /server/i.test(os) ? 3 : 1 }
    };
  }
  /** Evaluate one WQL query; null = the query can't be parsed (treated as false, as Windows does). */
  function evalWql(query, c) {
    const m = String(query).trim().match(/^select\s+(?:\*|[\w, ]+)\s+from\s+(\w+)(?:\s+where\s+(.+))?$/i);
    if (!m) return null;
    const inst = wmiClasses(c)[m[1].toLowerCase()];
    if (!inst) return false;
    if (!m[2]) return true;
    const val = s => (/^["']/.test(s) ? s.slice(1, -1) : /^(true|false)$/i.test(s) ? /^true$/i.test(s) : Number(s));
    const cond = t => {
      const cm = t.trim().match(/^(\w+)\s*(=|<>|!=|>=|<=|>|<|\s+like\s+|\s+not\s+like\s+)\s*("[^"]*"|'[^']*'|[\d.]+|true|false)$/i);
      if (!cm) throw new Error('bad');
      const key = Object.keys(inst).find(k => ieq(k, cm[1]));
      if (!key) throw new Error('bad');
      const a = inst[key], b = val(cm[3]), op = cm[2].trim().toLowerCase();
      if (op === 'like' || op === 'not like') {
        const re = new RegExp('^' + String(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
        return re.test(String(a)) === (op === 'like');
      }
      const num = typeof a === 'number' || (typeof b === 'number' && !isNaN(Number(a)));
      const x = num ? Number(a) : String(a).toLowerCase(), y = num ? Number(b) : String(b).toLowerCase();
      return { '=': x === y, '<>': x !== y, '!=': x !== y, '>': x > y, '<': x < y, '>=': x >= y, '<=': x <= y }[op];
    };
    try { return m[2].split(/\s+or\s+/i).some(part => part.split(/\s+and\s+/i).every(cond)); } catch (e) { return null; }
  }
  const wmiPass = (filterId, computer) => { const f = wmiFilter(filterId); return !f || f.queries.every(q => evalWql(q.query, computer) === true); };

  /* ---------------------------------------------------------------- Starter GPOs */
  const starters = () => (ensure() && A().starterGpos) || [];
  const starter = x => starters().find(s => s.id === x || ieq(s.name, x)) || null;
  function createStarterFolder() {
    if (!ensure()) return notDC();
    if (A().starterGpos) return { ok: true, changed: false };
    A().starterGpos = [
      { id: '{2A4A9A8E-3A5C-4C1B-8D5D-44E4E2E6A101}', name: 'Group Policy Reporting Firewall Ports', system: true, description: 'This Starter GPO contains the firewall settings that allow remote Group Policy reporting (RSoP) from GPMC.', computer: {}, user: {}, created: now(), modified: now() },
      { id: '{2A4A9A8E-3A5C-4C1B-8D5D-44E4E2E6A102}', name: 'Group Policy Remote Update Firewall Ports', system: true, description: 'This Starter GPO contains the firewall settings that allow GPMC to schedule a remote Group Policy update (Invoke-GPUpdate).', computer: {}, user: {}, created: now(), modified: now() }
    ];
    try { WS.fs.ensureDir(policiesRoot().replace(/\\Policies$/, '\\StarterGPOs')); } catch (e) { /* SYSVOL missing */ }
    changed();
    return { ok: true, changed: true };
  }
  function createStarter(name, comment) {
    if (!ensure()) return notDC();
    if (!A().starterGpos) createStarterFolder();
    name = String(name || '').trim();
    if (!name) return fail('Invalid', 'You must specify a name.');
    if (starters().some(s => ieq(s.name, name))) return fail('Exists', `A Starter GPO named "${name}" already exists.`);
    const s = { id: newId(), name, system: false, description: comment || '', computer: {}, user: {}, computerVersion: 0, userVersion: 0, created: now(), modified: now(), starter: true };
    A().starterGpos.push(s);
    changed();
    return { ok: true, starter: s };
  }
  function removeStarter(x) {
    const s = starter(x); if (!s) return fail('NotFound', `The Starter GPO "${x}" was not found.`);
    if (s.system) return fail('Invalid', 'System Starter GPOs cannot be deleted.');
    A().starterGpos = A().starterGpos.filter(y => y !== s);
    changed();
    return { ok: true };
  }
  /** Starter GPOs hold Administrative Templates only; the editor edits them through these. */
  function setStarterSetting(x, side, key, value) {
    const s = starter(x); if (!s) return fail('NotFound', `The Starter GPO "${x}" was not found.`);
    if (s.system) return fail('Invalid', 'System Starter GPOs are read-only.');
    const def = CAT.get(side, key);
    if (!def || def.kind !== 'policy') return fail('Invalid', 'Starter GPOs can contain Administrative Template settings only.');
    if (value == null) delete s[side][key];
    else { const n = normalize(def, value); if (n.error) return fail('Invalid', n.error); s[side][key] = n.value; }
    s[side === 'user' ? 'userVersion' : 'computerVersion'] = (s[side === 'user' ? 'userVersion' : 'computerVersion'] || 0) + 1;
    s.modified = now();
    changed();
    return { ok: true };
  }

  /* ---------------------------------------------------------------- RSoP */
  const thisComputer = () => (A() ? A().objects.find(o => o.type === 'computer' && ieq(o.name, WS.sys.name)) || null : null);
  function userObject(name) {
    if (!A()) return null;
    const n = String(name || (WS.session && WS.session.user) || 'Administrator').replace(/^[^\\]+\\/, '');
    return WS.ad.resolveIdentity(n, 'user') || WS.ad.get(n, 'user');
  }
  /** Resultant Set of Policy for one side. target: an AD user/computer (null = the local computer/user of a workgroup server).
   *  ctx: { computer } - user processing reads GPOs with the computer's credentials (MS16-072), evaluates WMI filters on the
   *  computer, and honours loopback processing (ctx.loopback: 1 Merge, 2 Replace). */
  function rsopSide(side, target, ctx = {}) {
    let list = [];
    if (target && A()) {
      list = orderedLinks(chainFor(target), true);
      if (side === 'user' && ctx.loopback && ctx.computer) {
        const cl = orderedLinks(chainFor(ctx.computer), true);
        list = ctx.loopback === 2 ? cl : [...cl, ...list];
      }
    }
    const seen = new Set();
    list = list.filter(e => (seen.has(e.gpo.id) ? false : seen.add(e.gpo.id)));
    const tokens = tokenSids(target), compTokens = side === 'user' && ctx.computer ? tokenSids(ctx.computer) : null;
    const applied = [], filtered = [];
    for (const e of list) {
      const g = e.gpo;
      let reason = null;
      if (!e.link.enabled) reason = 'Disabled (Link)';
      else if (!sideOn(g, side)) reason = 'Disabled (GPO)';
      else if (!canApply(g, tokens)) reason = 'Denied (Security)';
      else if (compTokens && !canRead(g, compTokens)) reason = 'Denied (Security)';
      else if (g.wmiFilter && !wmiPass(g.wmiFilter, side === 'user' ? ctx.computer : target)) reason = 'Denied (WMI Filter)';
      else if (isEmpty(g, side)) reason = 'Not Applied (Empty)';
      (reason ? filtered : applied).push({ gpo: g, id: g.id, name: g.name, som: e.som, somPath: somPath(e.som), link: e.link, reason });
    }
    const lg = local();
    const localRow = { gpo: lg, id: 'local', name: 'Local Group Policy', som: null, somPath: 'Local', link: null, local: true };
    if (isEmpty(lg, side)) filtered.push({ ...localRow, reason: 'Not Applied (Empty)' }); else applied.push(localRow);
    const settings = {};
    for (const e of applied.slice().reverse()) for (const [k, v] of Object.entries(sideSettings(e.gpo, side))) settings[k] = { value: v, gpo: e.id, gpoName: e.name };
    const extra = [];
    for (const e of applied.slice().reverse()) for (const r of (e.gpo.registry || {})[side] || []) extra.push({ ...r, gpoName: e.name });
    return { side, target, dn: target ? WS.ad.dn(target) : null, applied, filtered, settings, registry: extra, groups: groupNames(side, target) };
  }
  function groupNames(side, o) {
    if (!o || !A()) return side === 'computer' ? ['BUILTIN\\Administrators', 'Everyone', 'BUILTIN\\Users', 'NT AUTHORITY\\NETWORK', 'NT AUTHORITY\\Authenticated Users', 'This Organization', 'System Mandatory Level']
      : ['Everyone', 'BUILTIN\\Administrators', 'BUILTIN\\Users', 'NT AUTHORITY\\INTERACTIVE', 'CONSOLE LOGON', 'NT AUTHORITY\\Authenticated Users', 'This Organization', 'LOCAL', 'NTLM Authentication', 'High Mandatory Level'];
    const groups = WS.ad.memberOf(o, true).map(g => principal(g.sid).name.replace(new RegExp('^' + A().netbios + '\\\\'), ''));
    const extra = side === 'computer' ? ['Everyone', 'NT AUTHORITY\\NETWORK', 'NT AUTHORITY\\Authenticated Users', 'This Organization', o.sam, ...(o.primaryGroupId === 516 ? ['NT AUTHORITY\\ENTERPRISE DOMAIN CONTROLLERS'] : []), 'Authentication authority asserted identity', 'System Mandatory Level']
      : ['Everyone', 'NT AUTHORITY\\INTERACTIVE', 'CONSOLE LOGON', 'NT AUTHORITY\\Authenticated Users', 'This Organization', 'LOCAL', 'Authentication authority asserted identity', 'High Mandatory Level'];
    return [...new Set([...groups.filter(n => /^BUILTIN\\/.test(n)), ...extra, ...groups.filter(n => !/^BUILTIN\\/.test(n))])];
  }
  /** rsop({ computer, user, loopback }) - computer/user: an AD object, identity, a stand-in { type, parentId } for a container
   *  (Group Policy Modeling) or null; loopback overrides the computer's loopback mode. Returns { computer, user, loopback }. */
  function rsop(o = {}) {
    ensure();
    const comp = o.computer === undefined ? thisComputer() : typeof o.computer === 'object' ? o.computer : (A() ? WS.ad.get(o.computer, 'computer') : null);
    const out = { computer: rsopSide('computer', comp, {}), user: null, loopback: 0 };
    const lb = out.computer.settings.UserPolicyMode;
    out.loopback = o.loopback != null ? o.loopback : lb && lb.value.state === 'Enabled' ? Number(lb.value.options.UserPolicyMode) : 0;
    if (o.user !== null) {
      const u = o.user === undefined ? userObject() : typeof o.user === 'object' ? o.user : userObject(o.user);
      out.user = rsopSide('user', u, { computer: comp, loopback: out.loopback });
    }
    return out;
  }
  /** Account policy a DC takes from GPOs linked at the domain head (in precedence order); OU-linked GPOs don't count. */
  function domainAccountSettings(rs) {
    const root = WS.ad.root(), s = {};
    for (const e of rs.applied.filter(x => x.som && x.som.id === root.id).reverse()) for (const k of Object.keys(ACCOUNT_MAP)) if (k in e.gpo.computer) s[k] = e.gpo.computer[k];
    return s;
  }

  /* ---------------------------------------------------------------- processing */
  const signature = rs => JSON.stringify([rs.applied.map(e => [e.id, e.local ? [local().computerVersion, local().userVersion] : [e.gpo.computerVersion, e.gpo.userVersion]]), rs.filtered.map(e => e.id)]);
  function snapshot(rs, sig, at) {
    return { time: at, sig, dn: rs.dn, name: rs.target ? (rs.side === 'computer' ? rs.target.name : `${A().netbios}\\${rs.target.sam}`) : (rs.side === 'computer' ? WS.sys.name : `${WS.sys.name}\\${(WS.session && WS.session.user) || 'Administrator'}`),
      applied: rs.applied.map(e => ({ id: e.id, name: e.name, som: e.somPath, enforced: !!(e.link && e.link.enforced) })), filtered: rs.filtered.map(e => ({ id: e.id, name: e.name, som: e.somPath, reason: e.reason })),
      settings: rs.settings, registry: rs.registry, groups: rs.groups };
  }
  const opLog = 'Microsoft-Windows-GroupPolicy/Operational';
  const GP_SRC = 'Microsoft-Windows-GroupPolicy';
  function account(side, rs) {
    if (side === 'computer') return A() ? `${A().netbios}\\${WS.sys.name}$` : `${WS.sys.name}$`;
    return rs.target && A() ? `${A().netbios}\\${rs.target.sam}` : `${WS.sys.name}\\${(WS.session && WS.session.user) || 'Administrator'}`;
  }
  function writeEvents(side, rs, changedNow, reason, extEvents = []) {
    const who = side === 'computer' ? 'computer' : 'user';
    const acct = account(side, rs);
    const kind = { boot: ['computer boot', 4000, 8000], logon: ['user logon', 4001, 8001], manual: ['manual', side === 'computer' ? 4004 : 4005, side === 'computer' ? 8004 : 8005], background: ['periodic', side === 'computer' ? 4006 : 4007, side === 'computer' ? 8006 : 8007] }[reason] || null;
    if (kind) WS.evt.write(opLog, { id: kind[1], source: GP_SRC, message: reason === 'boot' || reason === 'logon' ? `Starting ${kind[0]} policy processing for ${acct}.\nActivity id: {${U.guid().toUpperCase()}}` : `Starting ${kind[0]} processing of policy for ${who} ${acct}.\nActivity id: {${U.guid().toUpperCase()}}` });
    WS.evt.write(opLog, { id: 5312, source: GP_SRC, message: `List of applicable Group Policy objects:\n\n${rs.applied.slice().reverse().map(e => e.name).join('\n') || 'None'}` });
    if (rs.filtered.length) WS.evt.write(opLog, { id: 5313, source: GP_SRC, message: `The following Group Policy objects were not applicable because they were filtered out :\n\n${rs.filtered.map(e => `${e.name}\n\t${e.reason}`).join('\n')}` });
    for (const e of extEvents) WS.evt.write(e.log, e);   // client-side extensions (Group Policy Preferences)
    if (kind) WS.evt.write(opLog, { id: kind[2], source: GP_SRC, message: reason === 'boot' || reason === 'logon' ? `Completed ${kind[0]} policy processing for ${acct} in 1 seconds.` : `Completed ${kind[0]} processing of policy for ${who} ${acct} in 1 seconds.` });
    const n = rs.applied.filter(e => !e.local).length + (rs.applied.some(e => e.local) ? 1 : 0);
    if (changedNow) WS.evt.write('System', { id: side === 'computer' ? 1502 : 1503, source: GP_SRC, message: `The Group Policy settings for the ${who} were processed successfully. New settings from ${n} Group Policy objects were detected and applied.` });
    else WS.evt.write('System', { id: side === 'computer' ? 1500 : 1501, source: GP_SRC, message: `The Group Policy settings for the ${who} were processed successfully. There were no changes detected since the last successful processing of Group Policy.` });
  }
  /** What the client-side extensions do with the computer's resultant settings. */
  function applyComputer(rs) {
    const S = k => (rs.settings[k] ? rs.settings[k].value : undefined);
    // account policies: domain-linked GPOs on a DC, the local policy on a workgroup server
    if (WS.sys.isDC() && A()) {
      const acct = domainAccountSettings(rs);
      const p = A().policy;
      for (const [k, v] of Object.entries(acct)) p[ACCOUNT_MAP[k]] = v;
      WS.store.changed('ad');
    } else if (!A()) {
      const p = WS.state.security.policy;
      for (const [k, f] of Object.entries(ACCOUNT_MAP)) if (S(k) !== undefined) p[f] = S(k);
      WS.store.changed('security');
    }
    // event logs
    for (const log of ['Application', 'Security', 'System']) {
      const props = {};
      if (S('MaxSize_' + log) !== undefined) props.maxKB = Math.max(64, Math.ceil(S('MaxSize_' + log) / 64) * 64);
      if (S('Retention_' + log) !== undefined) props.retention = { 0: 'overwrite', 1: 'overwrite', 2: 'manual' }[S('Retention_' + log)];
      const ms = S('EventLogMaxSize_' + log);
      if (ms && ms.state === 'Enabled') props.maxKB = Math.min(4194240, Math.max(64, Math.ceil(ms.options.MaxSize / 64) * 64));
      const rt = S('EventLogRetention_' + log);
      if (rt) props.retention = rt.state === 'Enabled' ? 'manual' : 'overwrite';
      if (Object.keys(props).length) WS.evt.setLogProps(log, props);
    }
    // system services (startup type only, as the Security CSE does)
    for (const [k, v] of Object.entries(rs.settings)) if (/^svc:/.test(k)) { const svc = WS.svc.get(k.slice(4)); if (svc && svc.startup.split(' ')[0] !== v.value) WS.svc.setStartup(svc.name, v.value); }
    // Remote Desktop
    const rdp = S('fDenyTSConnections'), nla = S('UserAuthentication');
    if (rdp || nla) {
      const on = rdp ? rdp.state === 'Enabled' : WS.state.system.rdpEnabled;
      const n = nla ? nla.state === 'Enabled' : WS.state.system.rdpNla;
      if (on !== WS.state.system.rdpEnabled || n !== WS.state.system.rdpNla) WS.sys.setRemoteDesktop(on, n);
    }
    // Windows Defender Firewall profiles
    for (const [prof, names] of [['DomainProfile', ['Domain']], ['StandardProfile', ['Private', 'Public']]]) {
      const v = S('EnableFirewall_' + prof);
      if (v && WS.fw) for (const n of names) if (WS.fw.profile(n).enabled !== (v.state === 'Enabled')) WS.fw.setProfile(n, { enabled: v.state === 'Enabled' });
    }
    if (Object.keys(rs.settings).some(k => { const d = CAT.get('computer', k) || definition('computer', k); return d && d.group === 'security'; })) {
      WS.evt.write('Application', { id: 1704, source: 'SceCli', message: 'Security policy in the Group policy objects has been applied successfully.' });
    }
  }
  /** refresh({ target: 'computer'|'user'|'both', force, reason: 'manual'|'boot'|'logon'|'background'|'local', silent })
   *  Processes policy as the Group Policy client does: settings are applied when something changed (or with force). */
  function refresh(o = {}) {
    ensure();
    const target = o.target || 'both', reason = o.reason || 'manual';
    const at = now();
    const out = { ok: true, computer: null, user: null };
    const rs = rsop({ user: target === 'computer' || !(WS.session && WS.session.loggedIn) ? null : undefined });
    const ap = WS.state.gp.applied;
    if (target !== 'user') {
      const sig = signature(rs.computer);
      const changedNow = !!o.force || !ap.computer || ap.computer.sig !== sig;
      if (changedNow) applyComputer(rs.computer);
      ap.computer = snapshot(rs.computer, sig, at);
      if (!o.silent) writeEvents('computer', rs.computer, changedNow, reason);
      out.computer = { changed: changedNow, applied: rs.computer.applied.length };
    }
    if (target !== 'computer' && rs.user) {
      const sig = signature(rs.user);
      const changedNow = !!o.force || !ap.user || ap.user.sig !== sig;
      ap.user = snapshot(rs.user, sig, at);
      // preference items are re-applied on every refresh (unless "Apply once and do not reapply")
      const pp = WS.gpp && reason !== 'local' ? WS.gpp.applyUser(rs.user, { changed: changedNow, reason }) : null;
      if (!o.silent) writeEvents('user', rs.user, changedNow, reason, pp ? pp.events : []);
      out.user = { changed: changedNow, applied: rs.user.applied.length };
    }
    WS.store.changed('gpresult');
    return out;
  }
  /** The last processing results in the shape rsop() returns (what Group Policy Results and gpresult report), or nulls. */
  function loggedRsop() {
    ensure();
    const ap = WS.state.gp.applied;
    const conv = (snap, side) => snap && {
      side, time: snap.time, name: snap.name, dn: snap.dn, target: side === 'computer' ? thisComputer() : userObject(), settings: snap.settings, registry: snap.registry || [], groups: snap.groups || [],
      applied: snap.applied.map(e => ({ ...e, somPath: e.som, local: e.id === 'local', link: { enforced: e.enforced }, gpo: e.id === 'local' ? local() : get(e.id) || { id: e.id, name: e.name, computer: {}, user: {}, registry: { computer: [], user: [] }, acl: [], computerVersion: 0, userVersion: 0 } })),
      filtered: snap.filtered.map(e => ({ ...e, somPath: e.som, local: e.id === 'local' }))
    };
    return { computer: conv(ap.computer, 'computer'), user: conv(ap.user, 'user') };
  }
  /** The value the last policy processing applied for a setting (undefined if none). */
  function effective(side, key) {
    const a = WS.state.gp.applied[side];
    const e = a && a.settings[key];
    return e ? e.value : undefined;
  }
  const policyEnabled = (side, key) => { const v = effective(side, key); return !!(v && v.state === 'Enabled'); };
  /** Shortcut for the shell and the tools: the applied (or null) value of a policy option, e.g. option('user', 'DisableCMD', 'DisableCMD'). */
  const policyOption = (side, key, opt) => { const v = effective(side, key); return v && v.state === 'Enabled' ? v.options[opt] : null; };

  /* background refresh: every 5 minutes on a DC (or the GPO's interval); 90 minutes elsewhere */
  setInterval(() => {
    if (!WS.session || !WS.session.loggedIn || !WS.state.gp) return;
    if (policyEnabled('computer', 'DisableBkGndGroupPolicy')) return;
    const a = WS.state.gp.applied.computer;
    const dcMin = policyOption('computer', 'GroupPolicyRefreshTimeDC', 'GroupPolicyRefreshTimeDC');
    const minutes = WS.sys.isDC() ? (dcMin != null ? dcMin : 5) : (policyOption('computer', 'GroupPolicyRefreshTime', 'GroupPolicyRefreshTime') || 90);
    if (!a || Date.now() - new Date(a.time).getTime() >= Math.max(1, minutes) * 60000) refresh({ reason: 'background' });
  }, 60000);
  WS.sys.on('boot', () => { try { refresh({ target: 'computer', reason: 'boot' }); } catch (e) { console.error('Group Policy processing failed at boot', e); } });

  /* ---------------------------------------------------------------- SYSVOL */
  function policiesRoot() {
    const sv = WS.state.smb && WS.state.smb.shares.find(s => ieq(s.name, 'SYSVOL'));
    return (sv ? sv.path.replace(/\\sysvol$/i, '') : 'C:\\Windows\\SYSVOL') + '\\domain\\Policies';
  }
  const gpoDir = g => `${policiesRoot()}\\${g.id}`;
  const REG_PATH = {
    LegalNoticeText: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 7], LegalNoticeCaption: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 1],
    DontDisplayLastUserName: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4], DisableCAD: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4],
    InactivityTimeoutSecs: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4], ShutdownWithoutLogon: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4],
    EnableLUA: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4], FilterAdministratorToken: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4],
    ConsentPromptBehaviorAdmin: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4], NoConnectedUser: ['Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', 4],
    NoLMHash: ['System\\CurrentControlSet\\Control\\Lsa', 4], LmCompatibilityLevel: ['System\\CurrentControlSet\\Control\\Lsa', 4], RestrictAnonymous: ['System\\CurrentControlSet\\Control\\Lsa', 4],
    RestrictAnonymousSAM: ['System\\CurrentControlSet\\Control\\Lsa', 4], EveryoneIncludesAnonymous: ['System\\CurrentControlSet\\Control\\Lsa', 4], LimitBlankPasswordUse: ['System\\CurrentControlSet\\Control\\Lsa', 4],
    SCENoApplyLegacyAuditPolicy: ['System\\CurrentControlSet\\Control\\Lsa', 4], CrashOnAuditFail: ['System\\CurrentControlSet\\Control\\Lsa', 4], SubmitControl: ['System\\CurrentControlSet\\Control\\Lsa', 4],
    RequireSecuritySignature: ['System\\CurrentControlSet\\Services\\LanManServer\\Parameters', 4], EnableSecuritySignature: ['System\\CurrentControlSet\\Services\\LanManServer\\Parameters', 4],
    RequireSecuritySignatureClient: ['System\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters\\RequireSecuritySignature', 4, true],
    RequireSignOrSeal: ['System\\CurrentControlSet\\Services\\Netlogon\\Parameters', 4], DisablePasswordChange: ['System\\CurrentControlSet\\Services\\Netlogon\\Parameters', 4],
    MaximumMachinePasswordAge: ['System\\CurrentControlSet\\Services\\Netlogon\\Parameters\\MaximumPasswordAge', 4, true], RefusePasswordChange: ['System\\CurrentControlSet\\Services\\Netlogon\\Parameters', 4],
    LDAPServerIntegrity: ['System\\CurrentControlSet\\Services\\NTDS\\Parameters', 4], AddPrinterDrivers: ['System\\CurrentControlSet\\Control\\Print\\Providers\\LanMan Print Services\\Servers', 4],
    CachedLogonsCount: ['Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon', 1], PasswordExpiryWarning: ['Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon', 4]
  };
  function gptTmpl(g) {
    const sections = {};
    const put = (sec, line) => (sections[sec] = sections[sec] || []).push(line);
    for (const [k, v] of Object.entries(g.computer)) {
      const def = definition('computer', k);
      if (!def || def.group !== 'security' || !def.inf) continue;
      const [sec, name] = def.inf;
      if (sec === 'Registry Values') {
        const rp = REG_PATH[k];
        if (!rp) continue;
        const path = 'MACHINE\\' + (rp[2] ? rp[0] : rp[0] + '\\' + k);
        put(sec, `${path}=${rp[1]},${rp[1] === 1 || rp[1] === 7 ? (Array.isArray(v) ? v.join(',') : String(v).replace(/\r?\n/g, ',')) : typeof v === 'boolean' ? (v ? 1 : 0) : v}`);
      } else if (sec === 'Privilege Rights') put(sec, `${name} = ${v.map(a => { const p = resolvePrincipal(a); return p ? '*' + p.sid : a; }).join(',')}`);
      else if (sec === 'Service General Setting') put(sec, `"${def.service}",${{ Automatic: 2, Manual: 3, Disabled: 4 }[v]},""`);
      else put(sec, `${name} = ${typeof v === 'boolean' ? (v ? 1 : 0) : v}`);
    }
    if (!Object.keys(sections).length) return null;
    const order = ['System Access', 'Kerberos Policy', 'Event Audit', 'Application Log', 'Security Log', 'System Log', 'Registry Values', 'Privilege Rights', 'Service General Setting'];
    let text = '[Unicode]\r\nUnicode=yes\r\n';
    for (const s of order) if (sections[s]) text += `[${s}]\r\n${sections[s].join('\r\n')}\r\n`;
    return text + '[Version]\r\nsignature="$CHICAGO$"\r\nRevision=1\r\n';
  }
  function registryPol(g, side) {
    const vals = [];
    for (const [k, v] of Object.entries(g[side])) { const def = CAT.get(side, k); if (def && def.kind === 'policy') vals.push(...regValuesOf(def, v)); }
    for (const e of g.registry[side] || []) vals.push({ key: e.key, value: e.value, type: e.type, data: e.data });
    if (!vals.length) return null;
    return 'PReg\x01\x00\x00\x00' + vals.map(r => `[${r.key};${r.value};${/dword/i.test(r.type) ? 'REG_DWORD' : 'REG_SZ'};${String(r.data).length};${r.data}]`).join('');
  }
  /** GPT.INI, GptTmpl.inf and Registry.pol under SYSVOL, so the GPO's folder looks like a real one. */
  function writeSysvol(g, isNew) {
    if (!A() || isLocal(g)) return;
    try {
      const dir = gpoDir(g);
      const up = isDefault(g);
      const mach = `${dir}\\${up ? 'MACHINE' : 'Machine'}`, usr = `${dir}\\${up ? 'USER' : 'User'}`;
      WS.fs.ensureDir(mach); WS.fs.ensureDir(usr);
      const ini = `[General]\r\nVersion=${g.userVersion * 65536 + g.computerVersion}\r\n${isNew || g.newIni ? 'displayName=New Group Policy Object\r\n' : ''}`;
      if (isNew) g.newIni = true;
      WS.fs.writeFile(`${dir}\\GPT.INI`, ini);
      const tmpl = gptTmpl(g), tp = `${mach}\\Microsoft\\Windows NT\\SecEdit\\GptTmpl.inf`;
      if (tmpl) { WS.fs.ensureDir(`${mach}\\Microsoft\\Windows NT\\SecEdit`); WS.fs.writeFile(tp, tmpl); } else if (WS.fs.exists(tp)) WS.fs.remove(tp);
      for (const [side, base] of [['computer', mach], ['user', usr]]) {
        const pol = registryPol(g, side), pp = `${base}\\Registry.pol`;
        if (pol) WS.fs.writeFile(pp, pol); else if (WS.fs.exists(pp)) WS.fs.remove(pp);
      }
      if (WS.gpp) WS.gpp.writeSysvol(g, usr);
    } catch (e) { /* SYSVOL is missing (an odd lab start); the GPO still works */ }
  }

  /* ---------------------------------------------------------------- backup / restore */
  const xmlEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** Back up GPOs to a folder: <path>\{BackupId}\ with bkupInfo.xml and Backup.xml, as Backup-GPO does. */
  function backup(which, path, comment) {
    if (!ensure()) return notDC();
    const list = which === 'all' ? gpos().slice() : [].concat(which).map(get).filter(Boolean);
    if (!list.length) return notFoundGpo(which);
    let dir;
    try { dir = WS.fs.full(path).replace(/\\$/, ''); if (!WS.fs.isDir(dir)) return fail('PathNotFound', 'The system cannot find the path specified.'); } catch (e) { return fail('PathNotFound', 'The system cannot find the path specified.'); }
    const out = [];
    for (const g of list) {
      const id = newId(), at = now(), bdir = `${dir}\\${id}`;
      WS.fs.ensureDir(bdir);
      WS.fs.writeFile(`${bdir}\\bkupInfo.xml`, `<BackupInst xmlns="http://www.microsoft.com/GroupPolicy/GPOOperations/Manifest"><GPOGuid><![CDATA[${g.id}]]></GPOGuid><GPODomain><![CDATA[${A().domain}]]></GPODomain><GPODomainGuid><![CDATA[{${A().domainGuid}}]]></GPODomainGuid><GPODomainController><![CDATA[${WS.sys.fqdn()}]]></GPODomainController><BackupTime><![CDATA[${at}]]></BackupTime><ID><![CDATA[${id}]]></ID><Comment><![CDATA[${comment || ''}]]></Comment><GPODisplayName><![CDATA[${g.name}]]></GPODisplayName></BackupInst>\r\n`);
      const payload = JSON.stringify({ id: g.id, name: g.name, status: g.status, description: g.description, owner: g.owner, computer: g.computer, user: g.user, registry: g.registry, prefs: g.prefs || {}, acl: g.acl, wmiFilter: g.wmiFilter, computerVersion: g.computerVersion, userVersion: g.userVersion, created: g.created });
      WS.fs.writeFile(`${bdir}\\Backup.xml`, `<?xml version="1.0" encoding="utf-8"?>\r\n<GroupPolicyBackupScheme bkp:version="2.0" bkp:type="GroupPolicyBackupTemplate" xmlns:bkp="http://www.microsoft.com/GroupPolicy/GPOOperations" xmlns="http://www.microsoft.com/GroupPolicy/GPOOperations">\r\n  <GroupPolicyObject>\r\n    <GroupPolicyCoreSettings>\r\n      <ID><![CDATA[${g.id}]]></ID>\r\n      <Domain><![CDATA[${A().domain}]]></Domain>\r\n      <DisplayName><![CDATA[${g.name}]]></DisplayName>\r\n    </GroupPolicyCoreSettings>\r\n    <LabSimulatorSettings><![CDATA[${payload}]]></LabSimulatorSettings>\r\n  </GroupPolicyObject>\r\n</GroupPolicyBackupScheme>\r\n`);
      if (WS.gpo.reportXml) WS.fs.writeFile(`${bdir}\\gpreport.xml`, WS.gpo.reportXml(g));
      WS.fs.ensureDir(`${bdir}\\DomainSysvol\\GPO\\Machine`); WS.fs.ensureDir(`${bdir}\\DomainSysvol\\GPO\\User`);
      out.push({ backupId: id, gpo: g, time: at, path: bdir, comment: comment || '' });
    }
    WS.store.changed('fs');
    return { ok: true, backups: out };
  }
  /** The backups in a folder (Manage Backups / Restore-GPO), newest first. */
  function backups(path) {
    let dir;
    try { dir = WS.fs.full(path).replace(/\\$/, ''); if (!WS.fs.isDir(dir)) return []; } catch (e) { return []; }
    const out = [];
    for (const e of WS.fs.list(dir)) {
      if (e.type !== 'dir') continue;
      try {
        const info = WS.fs.readFile(`${dir}\\${e.name}\\bkupInfo.xml`);
        const xml = WS.fs.readFile(`${dir}\\${e.name}\\Backup.xml`);
        const cd = tag => { const m = info.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)); return m ? m[1] : ''; };
        const pm = xml.match(/<LabSimulatorSettings><!\[CDATA\[([\s\S]*?)\]\]><\/LabSimulatorSettings>/);
        out.push({ backupId: cd('ID'), gpoId: cd('GPOGuid'), name: cd('GPODisplayName'), domain: cd('GPODomain'), time: cd('BackupTime'), comment: cd('Comment'), path: `${dir}\\${e.name}`, data: pm ? JSON.parse(pm[1]) : null });
      } catch (err) { /* not a GPO backup folder */ }
    }
    return out.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  }
  const findBackup = (path, x) => backups(path).find(b => ieq(b.backupId, x) || ieq(b.backupId, '{' + String(x).replace(/^\{|\}$/g, '') + '}')) || null;
  /** Restore-GPO: put a backup back into the GPO with the same GUID (re-created if it was deleted). Links are not part of a backup. */
  function restore(backupId, path) {
    if (!ensure()) return notDC();
    const b = findBackup(path, backupId);
    if (!b || !b.data) return fail('NotFound', `The backup "${backupId}" was not found in ${path}.`);
    let g = get(b.data.id);
    if (!g) {
      if (nameTaken(b.data.name)) return fail('Exists', `A GPO named "${b.data.name}" already exists in the ${A().domain} domain.`);
      g = { id: b.data.id, name: b.data.name, created: b.data.created || now(), computerVersion: 0, userVersion: 0 };
      A().gpos.push(g);
    }
    Object.assign(g, { name: b.data.name, status: b.data.status, description: b.data.description, owner: b.data.owner, computer: JSON.parse(JSON.stringify(b.data.computer)), user: JSON.parse(JSON.stringify(b.data.user)),
      registry: JSON.parse(JSON.stringify(b.data.registry || { computer: [], user: [] })), prefs: JSON.parse(JSON.stringify(b.data.prefs || {})), acl: JSON.parse(JSON.stringify(b.data.acl)), wmiFilter: wmiFilter(b.data.wmiFilter) ? b.data.wmiFilter : null, modified: now() });
    g.computerVersion = Math.max(g.computerVersion + 1, b.data.computerVersion || 0); g.userVersion = Math.max(g.userVersion + 1, b.data.userVersion || 0);
    fill(g);
    writeSysvol(g);
    changed('ad');
    return { ok: true, gpo: g };
  }
  /** Import-GPO / Import Settings: copy a backup's settings into another (or a new) GPO. */
  function importSettings(backupId, path, target, o = {}) {
    if (!ensure()) return notDC();
    const b = findBackup(path, backupId) || backups(path).find(x => ieq(x.name, backupId));
    if (!b || !b.data) return fail('NotFound', `The backup "${backupId}" was not found in ${path}.`);
    let g = get(target);
    if (!g) {
      if (!o.createIfNeeded) return notFoundGpo(target);
      const r = create(target); if (!r.ok) return r;
      g = r.gpo;
    }
    g.computer = JSON.parse(JSON.stringify(b.data.computer)); g.user = JSON.parse(JSON.stringify(b.data.user));
    g.registry = JSON.parse(JSON.stringify(b.data.registry || { computer: [], user: [] }));
    g.prefs = JSON.parse(JSON.stringify(b.data.prefs || {}));
    g.computerVersion++; g.userVersion++; g.modified = now();
    writeSysvol(g);
    changed();
    return { ok: true, gpo: g };
  }
  /** dcgpofix: re-create the Default Domain Policy and/or Default Domain Controllers Policy with their install-time settings. */
  function restoreDefaults(which = 'both') {
    if (!ensure()) return notDC();
    const out = [];
    for (const [id, name, som, w] of [[DDP, 'Default Domain Policy', WS.ad.root(), 'domain'], [DDCP, 'Default Domain Controllers Policy', WS.ad.get('Domain Controllers', 'organizationalUnit'), 'dc']]) {
      if (which !== 'both' && which !== w) continue;
      let g = get(id);
      if (!g) { g = { id, name, created: now() }; A().gpos.push(g); }
      for (const k of ['computer', 'user', 'acl', 'computerVersion', 'userVersion', 'registry', 'owner', 'prefs']) delete g[k];
      g.name = name; g.status = 'AllSettingsEnabled'; g.description = ''; g.wmiFilter = null;
      const keepV = 1;
      fill(g); g.computerVersion += keepV; g.modified = now();
      if (som && !(som.gpLinks || []).some(l => l.gpo === id)) (som.gpLinks = som.gpLinks || []).unshift({ gpo: id, enabled: true, enforced: false });
      writeSysvol(g);
      out.push(name);
    }
    changed('ad');
    return { ok: true, restored: out };
  }

  WS.gpo = {
    DDP, DDCP, STATUS, STATUS_LABEL, LEVELS, LEVEL_LABEL, ensure, catalog: CAT,
    list: () => gpos().slice(), get, local, isLocal, isDefault, create, remove, rename, setStatus, setComment, copy, sideOn, isEmpty,
    definition, setting, setSetting, touch, display, registryValues, setRegistryValue, removeRegistryValue, regValuesOf,
    soms, somOf, somName, somPath, links, somLinks, link, setLink, unlink, setBlockInheritance, isBlocked, inheritance, chainFor,
    permissions, filtering, setPermission, principal, resolvePrincipal, tokenSids,
    wmiFilters, wmiFilter, createWmiFilter, setWmiFilterProps, removeWmiFilter, setGpoWmiFilter, evalWql, wmiPass,
    starters, starter, createStarterFolder, createStarter, removeStarter, setStarterSetting,
    rsop, loggedRsop, refresh, effective, policyEnabled, policyOption, thisComputer, userObject, domainAccountSettings,
    applied: side => (WS.state.gp.applied || {})[side] || null,
    gpoDir, policiesRoot, backup, backups, restore, importSettings, restoreDefaults,
    statusLabel: s => STATUS_LABEL[s] || s
  };
})();
