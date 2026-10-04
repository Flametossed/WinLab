/* PowerShell modules for the server roles: ActiveDirectory, ADDSDeployment, DnsServer, DhcpServer.
 * Each module only exists once its feature is installed (RSAT-AD-PowerShell, AD-Domain-Services, RSAT-DNS-Server,
 * RSAT-DHCP), exactly like Get-Command shows on a real server. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;
  const PS = WS.ps;
  const { psobj, toStr, toBool, toArray, getProp, cmdlet, view, PSHashtable, ScriptBlock } = PS;
  const { wild, hasWild } = PS.helpers;

  /* ================================================================ ActiveDirectory */
  const AD = 'ActiveDirectory';
  const ADF = 'RSAT-AD-PowerShell';
  const adCls = n => 'Microsoft.ActiveDirectory.Management.Commands.' + n.replace('-', '');
  const adCmd = def => cmdlet({ module: AD, version: '1.0.1.0', feature: ADF, cls: adCls(def.name), ...def });
  function adCheck(ctx) {
    if (!WS.sys.isDC() || !WS.svc.isRunning('ADWS')) ctx.throw({ message: 'Unable to find a default server with Active Directory Web Services running.', category: 'ResourceUnavailable', target: '', exception: 'ADServerDownException', id: `ActiveDirectoryServer:1355,${adCls(ctx.name)}` });
  }
  const TYPE_CLASS = { user: 'ADUser', group: 'ADGroup', organizationalUnit: 'ADOrganizationalUnit', computer: 'ADComputer' };
  function adNotFound(ctx, identity, cls, terminating = true) {
    const rec = { message: `Cannot find an object with identity: '${toStr(identity)}' under: '${WS.ad.domainDN()}'.`, category: 'ObjectNotFound', target: toStr(identity), targetType: cls, exception: 'ADIdentityNotFoundException', id: `ActiveDirectoryCmdlet:Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException,${adCls(ctx.name)}` };
    if (terminating) ctx.throw(rec); else ctx.error(rec);
  }
  function adFail(ctx, r, target) {
    const map = {
      SamExists: ['ResourceExists', 'ADIdentityAlreadyExistsException', 'ActiveDirectoryServer:1316', 'The specified account already exists'],
      UpnExists: ['ResourceExists', 'ADIdentityAlreadyExistsException', 'ActiveDirectoryServer:1316', 'The specified account already exists'],
      Exists: ['NotSpecified', 'ADException', 'ActiveDirectoryServer:8305', 'An attempt was made to add an object to the directory with a name that is already in use'],
      PasswordPolicy: ['InvalidData', 'ADPasswordComplexityException', 'ActiveDirectoryServer:1325', 'The password does not meet the length, complexity, or history requirement of the domain.'],
      Protected: ['PermissionDenied', 'UnauthorizedAccessException', 'ActiveDirectoryCmdlet:System.UnauthorizedAccessException', 'Access is denied'],
      Critical: ['PermissionDenied', 'UnauthorizedAccessException', 'ActiveDirectoryCmdlet:System.UnauthorizedAccessException', 'Access is denied'],
      NotLeaf: ['NotSpecified', 'ADException', 'ActiveDirectoryServer:8213', 'The directory service can perform the requested operation only on a leaf object'],
      GroupScope: ['NotSpecified', 'ADException', 'ActiveDirectoryServer:1371', null],
      NotMember: ['NotSpecified', 'ADException', 'ActiveDirectoryServer:1377', 'The specified account name is not a member of the group'],
      PrimaryGroup: ['NotSpecified', 'ADException', 'ActiveDirectoryServer:1316', 'The user cannot be removed from a group because the group is currently the user\'s primary group'],
      NotFound: ['ObjectNotFound', 'ADIdentityNotFoundException', 'ActiveDirectoryCmdlet:Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException', 'Directory object not found'],
      Invalid: ['InvalidArgument', 'ArgumentException', 'ActiveDirectoryCmdlet:System.ArgumentException', null]
    };
    const [category, exception, id, msg] = map[r.code] || ['NotSpecified', 'ADException', 'ActiveDirectoryServer:8245', null];
    ctx.error({ message: msg || r.error, category, target, targetType: 'String', exception, id: `${id},${adCls(ctx.name)}` });
  }
  const fmtSpan = days => `${days}.00:00:00`;
  const guidOf = o => o.id;

  /** Attribute getters: AD attribute names as the module exposes them. */
  const ATTR = {
    AccountExpirationDate: () => null, AccountLockoutTime: o => (o.lockedOut ? new Date() : null), AccountNotDelegated: () => false, AllowReversiblePasswordEncryption: () => false,
    BadLogonCount: o => o.badPwdCount || 0, CannotChangePassword: o => !!o.cannotChange, CanonicalName: o => WS.ad.canonical(o), City: o => o.city || null, CN: o => o.name,
    Company: o => o.company || null, Country: o => o.country || null, Created: o => new Date(o.created), Deleted: () => null, Department: o => o.department || null,
    Description: o => o.description || null, DisplayName: o => o.displayName || null, DistinguishedName: o => WS.ad.dn(o), DNSHostName: o => o.dnsHostName || null,
    EmailAddress: o => o.email || null, EmployeeID: () => null, Enabled: o => o.enabled, GivenName: o => (o.type === 'user' ? o.givenName || null : undefined),
    GroupCategory: o => o.category, GroupScope: o => o.scope, HomeDirectory: o => o.homeDirectory || null, HomeDrive: o => o.homeDrive || null, Initials: o => o.initials || null,
    LastLogonDate: o => (o.lastLogon ? new Date(o.lastLogon) : null), LockedOut: o => !!o.lockedOut, ManagedBy: o => (o.managedBy ? WS.ad.dn(WS.ad.byId(o.managedBy)) : null),
    Manager: o => (o.manager ? WS.ad.dn(WS.ad.byId(o.manager)) : null), MemberOf: o => WS.ad.memberOf(o).filter(g => g.rid !== o.primaryGroupId).map(g => WS.ad.dn(g)),
    Members: o => (o.members || []).map(id => WS.ad.dn(WS.ad.byId(id))).filter(Boolean), MobilePhone: o => o.mobile || null, Modified: o => new Date(o.modified), Name: o => o.name,
    ObjectCategory: o => `CN=${{ user: 'Person', group: 'Group', organizationalUnit: 'Organizational-Unit', computer: 'Computer', container: 'Container' }[o.type] || 'Container'},CN=Schema,CN=Configuration,${WS.ad.domainDN()}`,
    ObjectClass: o => o.type, ObjectGUID: o => guidOf(o), Office: o => o.office || null, OfficePhone: o => o.telephone || null, OperatingSystem: o => o.os || null, OperatingSystemVersion: o => o.osVersion || null,
    PasswordExpired: o => o.type === 'user' && o.mustChange, PasswordLastSet: o => (o.pwdLastSet ? new Date(o.pwdLastSet) : null), PasswordNeverExpires: o => !!o.neverExpires, PasswordNotRequired: () => false,
    PostalCode: o => o.postalCode || null, PrimaryGroup: o => { const g = WS.ad.search({ type: 'group', advanced: true }).find(x => x.rid === o.primaryGroupId); return g ? WS.ad.dn(g) : null; },
    ProfilePath: o => o.profilePath || null, ProtectedFromAccidentalDeletion: o => !!o.protected, SamAccountName: o => o.sam, ScriptPath: o => o.scriptPath || null, SID: o => o.sid || null,
    State: o => o.state || null, StreetAddress: o => o.streetAddress || o.street || null, Surname: o => (o.type === 'user' ? o.sn || null : undefined), Title: o => o.title || null,
    UserPrincipalName: o => (o.type === 'user' || o.type === 'computer' ? o.upn || null : undefined), whenChanged: o => new Date(o.modified), whenCreated: o => new Date(o.created),
    LinkedGroupPolicyObjects: o => (WS.gpo ? WS.gpo.somLinks(o) : []).map(l => `cn=${l.gpo},cn=policies,cn=system,${WS.ad.domainDN()}`),
    IPv4Address: o => (o.type === 'computer' && o.dnsHostName && o.dnsHostName.split('.')[0].toLowerCase() === WS.sys.name.toLowerCase() ? WS.net.primaryIp() : null)
  };
  const ATTR_ALIAS = { sn: 'Surname', givenname: 'GivenName', mail: 'EmailAddress', samaccountname: 'SamAccountName', userprincipalname: 'UserPrincipalName', l: 'City', st: 'State', telephonenumber: 'OfficePhone', physicaldeliveryofficename: 'Office', displayname: 'DisplayName', objectclass: 'ObjectClass', distinguishedname: 'DistinguishedName', name: 'Name', cn: 'CN', description: 'Description', department: 'Department', title: 'Title', company: 'Company', manager: 'Manager', memberof: 'MemberOf', member: 'Members', enabled: 'Enabled', whencreated: 'whenCreated', whenchanged: 'whenChanged', streetaddress: 'StreetAddress', postalcode: 'PostalCode', protectedfromaccidentaldeletion: 'ProtectedFromAccidentalDeletion', groupscope: 'GroupScope', groupcategory: 'GroupCategory', lockedout: 'LockedOut', passwordneverexpires: 'PasswordNeverExpires', objectguid: 'ObjectGUID', objectsid: 'SID', sid: 'SID', homedirectory: 'HomeDirectory', scriptpath: 'ScriptPath', canonicalname: 'CanonicalName' };
  const attrName = n => ATTR_ALIAS[String(n).toLowerCase()] || Object.keys(ATTR).find(k => k.toLowerCase() === String(n).toLowerCase()) || n;
  const DEFAULTS = {
    user: ['DistinguishedName', 'Enabled', 'GivenName', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID', 'Surname', 'UserPrincipalName'],
    group: ['DistinguishedName', 'GroupCategory', 'GroupScope', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID'],
    organizationalUnit: ['City', 'Country', 'DistinguishedName', 'LinkedGroupPolicyObjects', 'ManagedBy', 'Name', 'ObjectClass', 'ObjectGUID', 'PostalCode', 'State', 'StreetAddress'],
    computer: ['DistinguishedName', 'DNSHostName', 'Enabled', 'Name', 'ObjectClass', 'ObjectGUID', 'SamAccountName', 'SID', 'UserPrincipalName'],
    object: ['DistinguishedName', 'Name', 'ObjectClass', 'ObjectGUID']
  };
  const ALL_PROPS = {
    user: ['AccountExpirationDate', 'AccountLockoutTime', 'AccountNotDelegated', 'AllowReversiblePasswordEncryption', 'BadLogonCount', 'CannotChangePassword', 'CanonicalName', 'City', 'CN', 'Company', 'Country', 'Created', 'Deleted', 'Department', 'Description', 'DisplayName', 'EmailAddress', 'EmployeeID', 'HomeDirectory', 'HomeDrive', 'Initials', 'LastLogonDate', 'LockedOut', 'Manager', 'MemberOf', 'MobilePhone', 'Modified', 'Office', 'OfficePhone', 'PasswordExpired', 'PasswordLastSet', 'PasswordNeverExpires', 'PasswordNotRequired', 'PostalCode', 'PrimaryGroup', 'ProfilePath', 'ProtectedFromAccidentalDeletion', 'ScriptPath', 'State', 'StreetAddress', 'Title', 'whenChanged', 'whenCreated'],
    group: ['CanonicalName', 'CN', 'Created', 'Description', 'DisplayName', 'ManagedBy', 'MemberOf', 'Members', 'Modified', 'ProtectedFromAccidentalDeletion', 'whenChanged', 'whenCreated'],
    organizationalUnit: ['CanonicalName', 'Created', 'Description', 'Modified', 'ProtectedFromAccidentalDeletion', 'whenChanged', 'whenCreated'],
    computer: ['CanonicalName', 'CN', 'Created', 'Description', 'IPv4Address', 'LockedOut', 'ManagedBy', 'MemberOf', 'Modified', 'OperatingSystem', 'OperatingSystemVersion', 'PasswordLastSet', 'PrimaryGroup', 'ProtectedFromAccidentalDeletion', 'whenChanged', 'whenCreated'],
    object: ['CanonicalName', 'CN', 'Created', 'Description', 'DisplayName', 'Modified', 'ProtectedFromAccidentalDeletion', 'whenChanged', 'whenCreated']
  };
  function adObj(o, props, kind) {
    const k = kind || (DEFAULTS[o.type] ? o.type : 'object');
    let names = DEFAULTS[k].slice();
    for (const p of toArray(props)) {
      const n = toStr(p);
      if (n === '*') names.push(...(ALL_PROPS[k] || []));
      else names.push(attrName(n));
    }
    names = [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const out = {};
    for (const n of names) { const g = ATTR[n]; const v = g ? g(o) : null; if (v !== undefined) out[n] = v; }
    const type = 'Microsoft.ActiveDirectory.Management.' + (kind === 'object' ? 'ADObject' : TYPE_CLASS[o.type] || 'ADObject');
    return psobj(type, out, { str: WS.ad.dn(o), hidden: { __adid: o.id } });
  }
  const principalObj = o => psobj('Microsoft.ActiveDirectory.Management.ADPrincipal', { distinguishedName: WS.ad.dn(o), name: o.type === 'foreignSecurityPrincipal' ? o.name : o.name, objectClass: o.type, objectGUID: o.id, SamAccountName: o.sam || null, SID: o.sid }, { str: WS.ad.dn(o), hidden: { __adid: o.id } });

  /** -Identity: an AD object from the pipeline, or DN / GUID / SID / sAMAccountName. */
  function identity(ctx, v, types) {
    if (v && typeof v === 'object' && v.__hidden && v.__hidden.__adid) return WS.ad.byId(v.__hidden.__adid);
    const o = WS.ad.resolveIdentity(toStr(v), types);
    return o && (!types || toArray(types).includes(o.type)) ? o : null;
  }
  /* ---- -Filter / -LDAPFilter ---- */
  function filterFn(ctx, text) {
    if (text instanceof ScriptBlock) text = text.toString();
    text = toStr(text).trim();
    if (text === '*') return () => true;
    const toks = text.match(/\(|\)|-[a-z]+|'[^']*'|"[^"]*"|\$[\w.:]+|[^\s()]+/gi) || [];
    let i = 0;
    const bad = () => ctx.throw({ message: `Error parsing query: '${text}' Error Message: 'syntax error' at position: '${Math.min(text.length, toks.slice(0, i).join(' ').length + 1)}'.`, category: 'ParserError', target: '', exception: 'ADFilterParsingException', id: `ActiveDirectoryCmdlet:Microsoft.ActiveDirectory.Management.ADFilterParsingException,${adCls(ctx.name)}` });
    const value = t => {
      if (t == null) bad();
      if (/^['"]/.test(t)) return t.slice(1, -1).replace(/^\$\(.*\)$/, '');
      if (/^\$/.test(t)) { const parts = t.slice(1).split('.'); let v = ctx.session.getVar(parts[0]); for (const p of parts.slice(1)) v = getProp(v, p); return v; }
      if (/^\d+$/.test(t)) return +t;
      return t;
    };
    const term = () => {
      if (toks[i] === '(') { i++; const e = expr(); if (toks[i] !== ')') bad(); i++; return e; }
      if (/^-not$/i.test(toks[i] || '')) { i++; const t = term(); return o => !t(o); }
      const attr = toks[i++];
      const op = (toks[i++] || '').toLowerCase();
      const raw = toks[i++];
      if (!attr || !/^-(eq|ne|like|notlike|gt|lt|ge|le|approx)$/.test(op)) bad();
      let v = value(raw);
      if (typeof v === 'string' && /^\$(true|false)$/i.test(raw)) v = /true/i.test(raw);
      const name = attrName(attr);
      return o => {
        const g = ATTR[name];
        const av = g ? g(o) : getProp(o, attr);
        const list = Array.isArray(av) ? av : [av];
        return list.some(x => {
          if (x === undefined) return false;
          switch (op) {
            case '-eq': return typeof v === 'boolean' ? x === v : v === '*' ? x != null && x !== '' : toStr(x).toLowerCase() === toStr(v).toLowerCase();
            case '-ne': return typeof v === 'boolean' ? x !== v : toStr(x).toLowerCase() !== toStr(v).toLowerCase();
            case '-like': case '-approx': return x != null && wild(toStr(v), toStr(x));
            case '-notlike': return !wild(toStr(v), toStr(x));
            case '-gt': return PS.cmp(x, v) > 0;
            case '-lt': return PS.cmp(x, v) < 0;
            case '-ge': return PS.cmp(x, v) >= 0;
            case '-le': return PS.cmp(x, v) <= 0;
            default: return false;
          }
        });
      };
    };
    const expr = () => {
      let left = term();
      while (/^-(and|or)$/i.test(toks[i] || '')) {
        const op = toks[i++].toLowerCase();
        const right = term();
        const l = left;
        left = op === '-and' ? (o => l(o) && right(o)) : (o => l(o) || right(o));
      }
      return left;
    };
    const f = expr();
    if (i < toks.length) bad();
    return f;
  }
  function ldapFn(ctx, text) {
    const m = String(text).match(/^\(?\(?(\w+)=([^)]*)\)?\)?$/);
    if (!m) ctx.throw({ message: 'The search filter cannot be recognized', category: 'NotSpecified', target: '', exception: 'ADException', id: `ActiveDirectoryServer:8254,${adCls(ctx.name)}` });
    const name = attrName(m[1]);
    return o => { const g = ATTR[name]; const v = g ? g(o) : null; return toArray(v).some(x => (name === 'ObjectClass' ? m[2].toLowerCase() === toStr(x).toLowerCase() || (m[2].toLowerCase() === 'person' && x === 'user') : wild(m[2], toStr(x)))); };
  }
  function searchBase(ctx, p) {
    if (!p.SearchBase) return null;
    const b = WS.ad.byDn(p.SearchBase);
    if (!b) ctx.throw({ message: 'Directory object not found', category: 'ObjectNotFound', target: '', exception: 'ADIdentityNotFoundException', id: `ActiveDirectoryCmdlet:Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException,${adCls(ctx.name)}` });
    return b;
  }
  const getParams = extra => ({ Identity: { type: 'object', pos: 0, pipe: 'value', set: 'Identity' }, Filter: { type: 'object', mandatory: true, set: 'Filter' }, LDAPFilter: { set: 'LdapFilter' }, Properties: { type: 'string[]', alias: ['Property'] }, SearchBase: {}, SearchScope: { type: 'enum', values: ['Base', 'OneLevel', 'Subtree'] }, ResultSetSize: { type: 'int' }, Server: {}, Credential: { type: 'object' }, ...extra });
  function runGet(ctx, p, type, kind) {
    adCheck(ctx);
    if (p.Identity != null) {
      const o = identity(ctx, p.Identity, type === 'object' ? null : type);
      if (!o) return adNotFound(ctx, p.Identity, TYPE_CLASS[type] || 'ADObject');
      ctx.out(adObj(o, p.Properties, kind));
      return;
    }
    const f = p.LDAPFilter ? ldapFn(ctx, p.LDAPFilter) : filterFn(ctx, p.Filter);
    const base = searchBase(ctx, p);
    let list = WS.ad.search({ type: type === 'object' ? undefined : type, under: base ? WS.ad.dn(base) : undefined, scope: p.SearchScope === 'OneLevel' ? 'onelevel' : 'subtree', advanced: type === 'object' });
    if (base && p.SearchScope === 'Base') list = [base];
    else if (base && (p.SearchScope || 'Subtree') === 'Subtree' && (type === 'object' || base.type === type)) list.unshift(base);
    let n = 0;
    for (const o of list) {
      if (!f(o)) continue;
      ctx.out(adObj(o, p.Properties, kind));
      if (p.ResultSetSize && ++n >= p.ResultSetSize) break;
    }
  }
  const pathDN = (ctx, p, dflt) => {
    if (!p.Path) return dflt;
    if (!WS.ad.byDn(p.Path)) ctx.throw({ message: 'Directory object not found', category: 'ObjectNotFound', target: p.Path, targetType: 'String', exception: 'ADIdentityNotFoundException', id: `ActiveDirectoryCmdlet:Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException,${adCls(ctx.name)}` });
    return p.Path;
  };

  /* ---- users ---- */
  const userAttrParams = { GivenName: {}, Surname: {}, Initials: {}, DisplayName: {}, SamAccountName: {}, UserPrincipalName: {}, Description: {}, Department: {}, Title: {}, Office: {}, Company: {}, EmailAddress: {}, OfficePhone: {}, MobilePhone: {}, City: {}, StreetAddress: {}, State: {}, PostalCode: {}, Country: {}, Manager: { type: 'object' }, HomeDirectory: {}, HomeDrive: {}, ProfilePath: {}, ScriptPath: {}, ChangePasswordAtLogon: { type: 'bool' }, PasswordNeverExpires: { type: 'bool' }, CannotChangePassword: { type: 'bool' } };
  const USER_MAP = { GivenName: 'givenName', Surname: 'sn', Initials: 'initials', DisplayName: 'displayName', SamAccountName: 'sam', UserPrincipalName: 'upn', Description: 'description', Department: 'department', Title: 'title', Office: 'office', Company: 'company', EmailAddress: 'email', OfficePhone: 'telephone', MobilePhone: 'mobile', City: 'city', StreetAddress: 'streetAddress', State: 'state', PostalCode: 'postalCode', Country: 'country', HomeDirectory: 'homeDirectory', HomeDrive: 'homeDrive', ProfilePath: 'profilePath', ScriptPath: 'scriptPath', ChangePasswordAtLogon: 'mustChange', PasswordNeverExpires: 'neverExpires', CannotChangePassword: 'cannotChange' };
  const LDAP_MAP = { department: 'department', title: 'title', description: 'description', mail: 'email', telephonenumber: 'telephone', physicaldeliveryofficename: 'office', displayname: 'displayName', givenname: 'givenName', sn: 'sn', company: 'company', l: 'city', st: 'state', postalcode: 'postalCode', streetaddress: 'streetAddress', mobile: 'mobile', info: 'notes', homedirectory: 'homeDirectory', scriptpath: 'scriptPath', userprincipalname: 'upn', samaccountname: 'sam' };
  adCmd({ name: 'Get-ADUser', synopsis: 'Gets one or more Active Directory users.', params: getParams(), process(ctx, p) { runGet(ctx, p, 'user'); } });
  adCmd({ name: 'New-ADUser', shouldProcess: true, synopsis: 'Creates a new Active Directory user.',
    params: { Name: { pos: 0, mandatory: true }, Path: {}, AccountPassword: { type: 'securestring' }, Enabled: { type: 'bool' }, PassThru: { type: 'switch' }, OtherAttributes: { type: 'hashtable' }, ...userAttrParams },
    async process(ctx, p) {
      adCheck(ctx);
      const parent = pathDN(ctx, p, WS.ad.usersContainerDN());
      const dn = `CN=${p.Name},${parent}`;
      if (!(await ctx.confirm('New', dn))) return;
      const o = { name: p.Name, parent, password: p.AccountPassword ? p.AccountPassword.value : undefined, enabled: p.Enabled === true };
      const CORE = ['givenName', 'sn', 'initials', 'displayName', 'sam', 'upn', 'description', 'office', 'title', 'department', 'company', 'email', 'telephone', 'mustChange', 'cannotChange', 'neverExpires'];
      const extra = {};
      for (const [k, v] of Object.entries(USER_MAP)) if (p[k] != null) (CORE.includes(v) ? o : extra)[v] = p[k];
      if (p.OtherAttributes) for (const [k, v] of p.OtherAttributes.entries()) if (LDAP_MAP[k.toLowerCase()]) o[LDAP_MAP[k.toLowerCase()]] = toStr(v);
      let r = WS.ad.createUser(o);
      if (!r.ok && r.code === 'PasswordPolicy') {
        // like the real cmdlet: the account is created (disabled) and the password error is reported
        const r2 = WS.ad.createUser({ ...o, password: undefined });
        adFail(ctx, r, dn);
        if (r2.ok && p.PassThru) ctx.out(adObj(r2.object));
        return;
      }
      if (!r.ok) return adFail(ctx, r, dn);
      if (p.Enabled === true && !p.AccountPassword) adFail(ctx, { code: 'PasswordPolicy', error: 'Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.' }, dn);
      if (p.Manager) { const m = identity(ctx, p.Manager, 'user'); if (m) extra.manager = m.id; }
      if (Object.keys(extra).length) WS.ad.setProps(r.object.id, extra);
      if (p.PassThru) ctx.out(adObj(r.object));
    } });
  const identParam = { Identity: { type: 'object', pos: 0, mandatory: true, pipe: 'value' } };
  adCmd({ name: 'Set-ADUser', shouldProcess: true, synopsis: 'Modifies an Active Directory user.',
    params: { ...identParam, Enabled: { type: 'bool' }, Replace: { type: 'hashtable' }, Add: { type: 'hashtable' }, Clear: { type: 'string[]' }, Remove: { type: 'hashtable' }, PassThru: { type: 'switch' }, ...userAttrParams },
    async process(ctx, p) {
      adCheck(ctx);
      const u = identity(ctx, p.Identity, 'user');
      if (!u) return adNotFound(ctx, p.Identity, 'ADUser');
      if (!(await ctx.confirm('Set', WS.ad.dn(u)))) return;
      const props = {};
      for (const [k, v] of Object.entries(USER_MAP)) if (p[k] != null && k !== 'Manager') props[v] = p[k];
      for (const h of [p.Replace, p.Add]) if (h) for (const [k, v] of h.entries()) { const m = LDAP_MAP[k.toLowerCase()]; if (!m) return adFail(ctx, { code: 'Invalid', error: `The specified directory service attribute or value does not exist\nParameter name: ${k}` }, WS.ad.dn(u)); props[m] = toStr(toArray(v)[0]); }
      for (const k of p.Clear || []) { const m = LDAP_MAP[k.toLowerCase()]; if (m) props[m] = ''; }
      if (p.Manager) { const m = identity(ctx, p.Manager, 'user'); if (!m) return adNotFound(ctx, p.Manager, 'ADUser'); props.manager = m.id; }
      if (Object.keys(props).length) { const r = WS.ad.setProps(u.id, props); if (!r.ok) return adFail(ctx, r, WS.ad.dn(u)); }
      if (p.Enabled != null) { const r = WS.ad.setEnabled(u.id, p.Enabled); if (!r.ok) return adFail(ctx, r, WS.ad.dn(u)); }
      if (p.PassThru) ctx.out(adObj(WS.ad.byId(u.id)));
    } });
  const removeCmd = (name, type, cls) => adCmd({ name, shouldProcess: true, impact: 'High', params: { ...identParam, Recursive: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const o = identity(ctx, p.Identity, type);
      if (!o) return adNotFound(ctx, p.Identity, cls);
      if (!(await ctx.confirm('Remove', WS.ad.dn(o), { impact: 'High' }))) return;
      const r = WS.ad.remove(o, { recursive: p.Recursive });
      if (!r.ok) adFail(ctx, r, WS.ad.dn(o));
    } });
  removeCmd('Remove-ADUser', 'user', 'ADUser');
  removeCmd('Remove-ADGroup', 'group', 'ADGroup');
  removeCmd('Remove-ADComputer', 'computer', 'ADComputer');
  removeCmd('Remove-ADOrganizationalUnit', 'organizationalUnit', 'ADOrganizationalUnit');
  removeCmd('Remove-ADObject', null, 'ADObject');
  for (const [verb, on] of [['Enable', true], ['Disable', false]]) {
    adCmd({ name: `${verb}-ADAccount`, shouldProcess: true, params: { ...identParam, PassThru: { type: 'switch' } },
      async process(ctx, p) {
        adCheck(ctx);
        const o = identity(ctx, p.Identity, ['user', 'computer']);
        if (!o) return adNotFound(ctx, p.Identity, 'ADAccount');
        if (!(await ctx.confirm('Set', WS.ad.dn(o)))) return;
        const r = WS.ad.setEnabled(o.id, on);
        if (!r.ok) return adFail(ctx, r, WS.ad.dn(o));
        if (p.PassThru) ctx.out(adObj(o));
      } });
  }
  adCmd({ name: 'Unlock-ADAccount', shouldProcess: true, params: identParam,
    async process(ctx, p) { adCheck(ctx); const o = identity(ctx, p.Identity, 'user'); if (!o) return adNotFound(ctx, p.Identity, 'ADAccount'); if (await ctx.confirm('Set', WS.ad.dn(o))) WS.ad.unlock(o.id); } });
  adCmd({ name: 'Set-ADAccountPassword', shouldProcess: true, synopsis: "Modifies the password of an Active Directory account.",
    params: { ...identParam, NewPassword: { type: 'securestring' }, OldPassword: { type: 'securestring' }, Reset: { type: 'switch' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const u = identity(ctx, p.Identity, ['user', 'computer']);
      if (!u) return adNotFound(ctx, p.Identity, 'ADAccount');
      let np = p.NewPassword;
      if (!p.Reset && !p.OldPassword) {
        const old = await ctx.prompt(`Please enter the current password for '${WS.ad.dn(u)}'\nPassword: `, { secure: true });
        if (old !== (u.rid === 500 ? WS.state.system.adminPassword : u.password)) ctx.throw({ message: 'The specified network password is not correct', category: 'InvalidData', target: WS.ad.dn(u), exception: 'ADInvalidPasswordException', id: `ActiveDirectoryServer:86,${adCls(ctx.name)}` });
      }
      if (!np) {
        const a = await ctx.prompt(`Please enter the desired password for '${WS.ad.dn(u)}'\nPassword: `, { secure: true });
        const b = await ctx.prompt('Repeat Password: ', { secure: true });
        if (a !== b) ctx.throw({ message: 'The passwords do not match.', category: 'InvalidData', target: '', exception: 'ArgumentException', id: `ActiveDirectoryCmdlet:System.ArgumentException,${adCls(ctx.name)}` });
        np = { value: a };
      }
      if (!(await ctx.confirm('Set-ADAccountPassword', WS.ad.dn(u)))) return;
      const r = WS.ad.setPassword(u.id, np.value, { mustChange: u.mustChange });
      if (!r.ok) adFail(ctx, r, WS.ad.dn(u));
    } });
  adCmd({ name: 'Search-ADAccount', params: { LockedOut: { type: 'switch' }, AccountDisabled: { type: 'switch' }, PasswordNeverExpires: { type: 'switch' }, AccountInactive: { type: 'switch' }, PasswordExpired: { type: 'switch' }, UsersOnly: { type: 'switch' }, ComputersOnly: { type: 'switch' }, SearchBase: {} },
    process(ctx, p) {
      adCheck(ctx);
      const base = searchBase(ctx, p);
      for (const o of WS.ad.search({ type: p.UsersOnly ? 'user' : p.ComputersOnly ? 'computer' : ['user', 'computer'], under: base ? WS.ad.dn(base) : undefined })) {
        if (p.LockedOut && !o.lockedOut) continue;
        if (p.AccountDisabled && o.enabled) continue;
        if (p.PasswordNeverExpires && !o.neverExpires) continue;
        if (p.PasswordExpired && !o.mustChange) continue;
        if (p.AccountInactive && o.lastLogon) continue;
        const b = adObj(o);
        ctx.out(psobj('Microsoft.ActiveDirectory.Management.ADAccount', { AccountExpirationDate: null, DistinguishedName: b.DistinguishedName, Enabled: o.enabled, LastLogonDate: o.lastLogon ? new Date(o.lastLogon) : null, LockedOut: !!o.lockedOut, Name: o.name, ObjectClass: o.type, ObjectGUID: o.id, PasswordExpired: !!o.mustChange, PasswordNeverExpires: !!o.neverExpires, SamAccountName: o.sam, SID: o.sid, UserPrincipalName: o.upn || null }, { str: b.DistinguishedName, hidden: { __adid: o.id } }));
      }
    } });

  /* ---- groups ---- */
  adCmd({ name: 'Get-ADGroup', synopsis: 'Gets one or more Active Directory groups.', params: getParams(), process(ctx, p) { runGet(ctx, p, 'group'); } });
  adCmd({ name: 'New-ADGroup', shouldProcess: true, synopsis: 'Creates an Active Directory group.',
    params: { Name: { pos: 0, mandatory: true }, GroupScope: { type: 'enum', pos: 1, mandatory: true, values: ['DomainLocal', 'Global', 'Universal'], enumType: 'Microsoft.ActiveDirectory.Management.ADGroupScope' }, GroupCategory: { type: 'enum', values: ['Distribution', 'Security'], enumType: 'Microsoft.ActiveDirectory.Management.ADGroupCategory' }, Path: {}, Description: {}, DisplayName: {}, SamAccountName: {}, ManagedBy: { type: 'object' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const parent = pathDN(ctx, p, WS.ad.usersContainerDN());
      const dn = `CN=${p.Name},${parent}`;
      if (!(await ctx.confirm('New', dn))) return;
      const r = WS.ad.createGroup({ name: p.Name, sam: p.SamAccountName, scope: p.GroupScope, category: p.GroupCategory || 'Security', parent, description: p.Description });
      if (!r.ok) return adFail(ctx, r, dn);
      if (p.ManagedBy) { const m = identity(ctx, p.ManagedBy); if (m) WS.ad.setProps(r.object.id, { managedBy: m.id }); }
      if (p.PassThru) ctx.out(adObj(r.object));
    } });
  adCmd({ name: 'Set-ADGroup', shouldProcess: true, params: { ...identParam, Description: {}, DisplayName: {}, GroupScope: { type: 'enum', values: ['DomainLocal', 'Global', 'Universal'] }, GroupCategory: { type: 'enum', values: ['Distribution', 'Security'] }, ManagedBy: { type: 'object' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const g = identity(ctx, p.Identity, 'group');
      if (!g) return adNotFound(ctx, p.Identity, 'ADGroup');
      if (!(await ctx.confirm('Set', WS.ad.dn(g)))) return;
      if (p.Description != null) WS.ad.setProps(g.id, { description: p.Description });
      if (p.ManagedBy) { const m = identity(ctx, p.ManagedBy); if (!m) return adNotFound(ctx, p.ManagedBy, 'ADPrincipal'); WS.ad.setProps(g.id, { managedBy: m.id }); }
      if (p.GroupScope || p.GroupCategory) { const r = WS.ad.setGroupScope(g.id, p.GroupScope, p.GroupCategory); if (!r.ok) return adFail(ctx, r, WS.ad.dn(g)); }
      if (p.PassThru) ctx.out(adObj(g));
    } });
  const memberParams = { Identity: { type: 'object', pos: 0, mandatory: true }, Members: { type: 'object[]', pos: 1, mandatory: true, pipe: 'value', alias: ['Member'] }, PassThru: { type: 'switch' } };
  adCmd({ name: 'Add-ADGroupMember', shouldProcess: true, synopsis: 'Adds one or more members to an Active Directory group.', params: memberParams,
    async process(ctx, p) {
      adCheck(ctx);
      const g = identity(ctx, p.Identity, 'group');
      if (!g) return adNotFound(ctx, p.Identity, 'ADGroup');
      if (!(await ctx.confirm('Set', WS.ad.dn(g)))) return;
      for (const m of p.Members) {
        const o = identity(ctx, m, ['user', 'group', 'computer']);
        if (!o) { adNotFound(ctx, m, 'ADPrincipal'); continue; }
        const r = WS.ad.addMember(g.id, o);
        if (!r.ok && r.code !== 'AlreadyMember') adFail(ctx, r, WS.ad.dn(g));
      }
      if (p.PassThru) ctx.out(adObj(g));
    } });
  adCmd({ name: 'Remove-ADGroupMember', shouldProcess: true, impact: 'High', params: memberParams,
    async process(ctx, p) {
      adCheck(ctx);
      const g = identity(ctx, p.Identity, 'group');
      if (!g) return adNotFound(ctx, p.Identity, 'ADGroup');
      if (!(await ctx.confirm('Set', WS.ad.dn(g), { impact: 'High' }))) return;
      for (const m of p.Members) {
        const o = identity(ctx, m);
        if (!o) { adNotFound(ctx, m, 'ADPrincipal'); continue; }
        const r = WS.ad.removeMember(g.id, o);
        if (!r.ok) adFail(ctx, r, WS.ad.dn(g));
      }
    } });
  adCmd({ name: 'Get-ADGroupMember', synopsis: 'Gets the members of an Active Directory group.', params: { Identity: { type: 'object', pos: 0, mandatory: true, pipe: 'value' }, Recursive: { type: 'switch' } },
    process(ctx, p) {
      adCheck(ctx);
      const g = identity(ctx, p.Identity, 'group');
      if (!g) return adNotFound(ctx, p.Identity, 'ADGroup');
      WS.ad.members(g, p.Recursive).forEach(m => ctx.out(principalObj(m)));
    } });
  adCmd({ name: 'Get-ADPrincipalGroupMembership', params: { Identity: { type: 'object', pos: 0, mandatory: true, pipe: 'value' } },
    process(ctx, p) { adCheck(ctx); const o = identity(ctx, p.Identity); if (!o) return adNotFound(ctx, p.Identity, 'ADPrincipal'); WS.ad.memberOf(o).forEach(g => ctx.out(adObj(g))); } });
  adCmd({ name: 'Add-ADPrincipalGroupMembership', shouldProcess: true, params: { Identity: { type: 'object', pos: 0, mandatory: true, pipe: 'value' }, MemberOf: { type: 'object[]', pos: 1, mandatory: true } },
    async process(ctx, p) {
      adCheck(ctx);
      const o = identity(ctx, p.Identity);
      if (!o) return adNotFound(ctx, p.Identity, 'ADPrincipal');
      if (!(await ctx.confirm('Set', WS.ad.dn(o)))) return;
      for (const gid of p.MemberOf) { const g = identity(ctx, gid, 'group'); if (!g) { adNotFound(ctx, gid, 'ADGroup', false); continue; } const r = WS.ad.addMember(g.id, o); if (!r.ok && r.code !== 'AlreadyMember') adFail(ctx, r, WS.ad.dn(g)); }
    } });

  /* ---- OUs, computers, generic objects ---- */
  adCmd({ name: 'Get-ADOrganizationalUnit', synopsis: 'Gets one or more Active Directory organizational units.', params: getParams(), process(ctx, p) { runGet(ctx, p, 'organizationalUnit'); } });
  adCmd({ name: 'New-ADOrganizationalUnit', shouldProcess: true, synopsis: 'Creates an Active Directory organizational unit.',
    params: { Name: { pos: 0, mandatory: true }, Path: {}, Description: {}, ProtectedFromAccidentalDeletion: { type: 'bool' }, City: {}, State: {}, PostalCode: {}, Country: {}, StreetAddress: {}, ManagedBy: { type: 'object' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const parent = pathDN(ctx, p, WS.ad.domainDN());
      const dn = `OU=${p.Name},${parent}`;
      if (!(await ctx.confirm('New', dn))) return;
      const r = WS.ad.createOU({ name: p.Name, parent, description: p.Description, protect: p.ProtectedFromAccidentalDeletion !== false });
      if (!r.ok) return adFail(ctx, r, dn);
      const extra = {};
      for (const [k, v] of [['City', 'city'], ['State', 'state'], ['PostalCode', 'postalCode'], ['Country', 'country'], ['StreetAddress', 'street']]) if (p[k] != null) extra[v] = p[k];
      if (Object.keys(extra).length) WS.ad.setProps(r.object.id, extra);
      if (p.PassThru) ctx.out(adObj(r.object));
    } });
  adCmd({ name: 'Set-ADOrganizationalUnit', shouldProcess: true, params: { ...identParam, Description: {}, ProtectedFromAccidentalDeletion: { type: 'bool' }, City: {}, State: {}, PostalCode: {}, Country: {}, StreetAddress: {}, ManagedBy: { type: 'object' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const ou = identity(ctx, p.Identity, 'organizationalUnit');
      if (!ou) return adNotFound(ctx, p.Identity, 'ADOrganizationalUnit');
      if (!(await ctx.confirm('Set', WS.ad.dn(ou)))) return;
      const props = {};
      if (p.Description != null) props.description = p.Description;
      if (p.ProtectedFromAccidentalDeletion != null) props.protected = p.ProtectedFromAccidentalDeletion;
      for (const [k, v] of [['City', 'city'], ['State', 'state'], ['PostalCode', 'postalCode'], ['Country', 'country'], ['StreetAddress', 'street']]) if (p[k] != null) props[v] = p[k];
      if (p.ManagedBy) { const m = identity(ctx, p.ManagedBy); if (m) props.managedBy = m.id; }
      const r = WS.ad.setProps(ou.id, props);
      if (!r.ok) adFail(ctx, r, WS.ad.dn(ou)); else if (p.PassThru) ctx.out(adObj(ou));
    } });
  adCmd({ name: 'Get-ADComputer', synopsis: 'Gets one or more Active Directory computers.', params: getParams(), process(ctx, p) { runGet(ctx, p, 'computer'); } });
  adCmd({ name: 'New-ADComputer', shouldProcess: true, params: { Name: { pos: 0, mandatory: true }, Path: {}, Description: {}, Enabled: { type: 'bool' }, SamAccountName: {}, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const parent = pathDN(ctx, p, `CN=Computers,${WS.ad.domainDN()}`);
      if (!(await ctx.confirm('New', `CN=${p.Name},${parent}`))) return;
      const r = WS.ad.createComputer({ name: p.Name, parent, description: p.Description, enabled: p.Enabled !== false });
      if (!r.ok) return adFail(ctx, r, `CN=${p.Name},${parent}`);
      if (p.PassThru) ctx.out(adObj(r.object));
    } });
  adCmd({ name: 'Get-ADObject', synopsis: 'Gets one or more Active Directory objects.', params: getParams({ IncludeDeletedObjects: { type: 'switch' } }), process(ctx, p) { runGet(ctx, p, 'object', 'object'); } });
  adCmd({ name: 'Set-ADObject', shouldProcess: true, params: { ...identParam, ProtectedFromAccidentalDeletion: { type: 'bool' }, Description: {}, DisplayName: {}, Replace: { type: 'hashtable' }, Clear: { type: 'string[]' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const o = identity(ctx, p.Identity);
      if (!o) return adNotFound(ctx, p.Identity, 'ADObject');
      if (!(await ctx.confirm('Set', WS.ad.dn(o)))) return;
      const props = {};
      if (p.ProtectedFromAccidentalDeletion != null) props.protected = p.ProtectedFromAccidentalDeletion;
      if (p.Description != null) props.description = p.Description;
      if (p.DisplayName != null && o.type === 'user') props.displayName = p.DisplayName;
      if (p.Replace) for (const [k, v] of p.Replace.entries()) { const m = LDAP_MAP[k.toLowerCase()]; if (m) props[m] = toStr(v); }
      for (const k of p.Clear || []) { const m = LDAP_MAP[k.toLowerCase()]; if (m) props[m] = ''; }
      if ('protected' in props && Object.keys(props).length === 1) { o.protected = !!props.protected; WS.store.changed('ad'); }
      else { const r = WS.ad.setProps(o.id, props); if (!r.ok) return adFail(ctx, r, WS.ad.dn(o)); }
      if (p.PassThru) ctx.out(adObj(o, null, 'object'));
    } });
  adCmd({ name: 'Move-ADObject', shouldProcess: true, synopsis: 'Moves an Active Directory object or a container of objects to a different container or domain.', params: { ...identParam, TargetPath: { pos: 1, mandatory: true }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const o = identity(ctx, p.Identity);
      if (!o) return adNotFound(ctx, p.Identity, 'ADObject');
      if (!WS.ad.byDn(p.TargetPath)) return adFail(ctx, { code: 'NotFound' }, p.TargetPath);
      if (!(await ctx.confirm('Move', WS.ad.dn(o)))) return;
      const r = WS.ad.move(o.id, p.TargetPath);
      if (!r.ok) adFail(ctx, r, WS.ad.dn(o)); else if (p.PassThru) ctx.out(adObj(o, null, 'object'));
    } });
  adCmd({ name: 'Rename-ADObject', shouldProcess: true, params: { ...identParam, NewName: { pos: 1, mandatory: true }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      const o = identity(ctx, p.Identity);
      if (!o) return adNotFound(ctx, p.Identity, 'ADObject');
      if (!(await ctx.confirm('Rename', WS.ad.dn(o)))) return;
      const r = WS.ad.rename(o.id, p.NewName);
      if (!r.ok) adFail(ctx, r, WS.ad.dn(o)); else if (p.PassThru) ctx.out(adObj(o, null, 'object'));
    } });

  /* ---- domain, forest, DC, password policy ---- */
  adCmd({ name: 'Get-ADDomain', synopsis: 'Gets an Active Directory domain.', params: { Identity: { type: 'object', pos: 0 }, Current: {} },
    process(ctx) {
      adCheck(ctx);
      const d = WS.state.ad, dn = WS.ad.domainDN(), dc = WS.sys.fqdn();
      ctx.out(psobj('Microsoft.ActiveDirectory.Management.ADDomain', {
        AllowedDNSSuffixes: [], ChildDomains: [], ComputersContainer: `CN=Computers,${dn}`, DeletedObjectsContainer: `CN=Deleted Objects,${dn}`, DistinguishedName: dn, DNSRoot: d.domain,
        DomainControllersContainer: `OU=Domain Controllers,${dn}`, DomainMode: d.domainMode, DomainSID: d.domainSid, ForeignSecurityPrincipalsContainer: `CN=ForeignSecurityPrincipals,${dn}`, Forest: d.domain,
        InfrastructureMaster: dc, LastLogonReplicationInterval: null, LinkedGroupPolicyObjects: WS.gpo.somLinks(WS.ad.root()).map(l => `CN=${l.gpo},CN=Policies,CN=System,${dn}`), LostAndFoundContainer: `CN=LostAndFound,${dn}`,
        ManagedBy: null, Name: d.domain.split('.')[0], NetBIOSName: d.netbios, ObjectClass: 'domainDNS', ObjectGUID: d.domainGuid, ParentDomain: null, PDCEmulator: dc,
        PublicKeyRequiredPasswordRolling: true, QuotasContainer: `CN=NTDS Quotas,${dn}`, ReadOnlyReplicaDirectoryServers: [], ReplicaDirectoryServers: [dc], RIDMaster: dc, SubordinateReferences: [`DC=ForestDnsZones,${dn}`, `DC=DomainDnsZones,${dn}`, `CN=Configuration,${dn}`],
        SystemsContainer: `CN=System,${dn}`, UsersContainer: `CN=Users,${dn}`
      }, { str: dn }));
    } });
  adCmd({ name: 'Get-ADForest', params: { Identity: { type: 'object', pos: 0 } },
    process(ctx) {
      adCheck(ctx);
      const d = WS.state.ad, dn = WS.ad.domainDN(), dc = WS.sys.fqdn();
      ctx.out(psobj('Microsoft.ActiveDirectory.Management.ADForest', { ApplicationPartitions: [`DC=DomainDnsZones,${dn}`, `DC=ForestDnsZones,${dn}`], CrossForestReferences: [], DomainNamingMaster: dc, Domains: [d.domain], ForestMode: d.forestMode, GlobalCatalogs: [dc], Name: d.domain, PartitionsContainer: `CN=Partitions,CN=Configuration,${dn}`, RootDomain: d.domain, SchemaMaster: dc, Sites: ['Default-First-Site-Name'], SPNSuffixes: [], UPNSuffixes: [] }, { str: d.domain }));
    } });
  adCmd({ name: 'Get-ADDomainController', params: { Identity: { type: 'object', pos: 0 }, Discover: { type: 'switch' }, Filter: { type: 'object' } },
    process(ctx) {
      adCheck(ctx);
      const d = WS.state.ad, dn = WS.ad.domainDN(), name = WS.sys.name;
      ctx.out(psobj('Microsoft.ActiveDirectory.Management.ADDomainController', { ComputerObjectDN: `CN=${name},OU=Domain Controllers,${dn}`, DefaultPartition: dn, Domain: d.domain, Enabled: true, Forest: d.domain, HostName: WS.sys.fqdn(), InvocationId: d.dsaGuid, IPv4Address: WS.net.primaryIp(), IPv6Address: null, IsGlobalCatalog: true, IsReadOnly: false, LdapPort: 389, Name: name, NTDSSettingsObjectDN: `CN=NTDS Settings,CN=${name},CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,${dn}`, OperatingSystem: 'Windows Server 2025 Datacenter Evaluation', OperatingSystemHotfix: null, OperatingSystemServicePack: null, OperatingSystemVersion: '10.0 (26100)', OperationMasterRoles: ['SchemaMaster', 'DomainNamingMaster', 'PDCEmulator', 'RIDMaster', 'InfrastructureMaster'], Partitions: [`DC=ForestDnsZones,${dn}`, `DC=DomainDnsZones,${dn}`, `CN=Schema,CN=Configuration,${dn}`, `CN=Configuration,${dn}`, dn], ServerObjectDN: `CN=${name},CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,${dn}`, ServerObjectGuid: U.guid(), Site: 'Default-First-Site-Name', SslPort: 636 }, { str: WS.sys.fqdn() }));
    } });
  const span = m => `${m >= 1440 ? Math.floor(m / 1440) + '.' : ''}${U.pad(Math.floor(m % 1440 / 60))}:${U.pad(m % 60)}:00`;
  const policyObj = () => { const p = WS.ad.policy(); return psobj('Microsoft.ActiveDirectory.Management.ADDefaultDomainPasswordPolicy', { ComplexityEnabled: p.complexity, DistinguishedName: WS.ad.domainDN(), LockoutDuration: span(p.lockoutMinutes), LockoutObservationWindow: span(p.lockoutWindowMinutes != null ? p.lockoutWindowMinutes : p.lockoutMinutes), LockoutThreshold: p.lockoutThreshold, MaxPasswordAge: fmtSpan(p.maxAgeDays), MinPasswordAge: fmtSpan(p.minAgeDays), MinPasswordLength: p.minLength, objectClass: ['domainDNS'], objectGuid: WS.state.ad.domainGuid, PasswordHistoryCount: p.history, ReversibleEncryptionEnabled: !!p.reversible }); };
  adCmd({ name: 'Get-ADDefaultDomainPasswordPolicy', params: { Identity: { type: 'object', pos: 0 }, Current: {} }, process(ctx) { adCheck(ctx); ctx.out(policyObj()); } });
  const spanMinutes = v => { const m = toStr(v).match(/^(?:(\d+)\.)?(\d+):(\d\d)(?::\d\d)?$/); return m ? (+m[1] || 0) * 1440 + (+m[2]) * 60 + (+m[3]) : Math.round(PS.toNum(v)); };
  const spanDays = v => { const s = toStr(v); const m = s.match(/^(\d+)(?:\.(\d\d):\d\d:\d\d)?$/); return m ? +m[1] : Math.round(PS.toNum(s)); };
  adCmd({ name: 'Set-ADDefaultDomainPasswordPolicy', shouldProcess: true, params: { Identity: { type: 'object', pos: 0 }, MinPasswordLength: { type: 'int' }, ComplexityEnabled: { type: 'bool' }, MaxPasswordAge: {}, MinPasswordAge: {}, PasswordHistoryCount: { type: 'int' }, LockoutThreshold: { type: 'int' }, LockoutDuration: {}, LockoutObservationWindow: {}, ReversibleEncryptionEnabled: { type: 'bool' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      adCheck(ctx);
      if (!(await ctx.confirm('Set', WS.ad.domainDN()))) return;
      const props = {};
      if (p.MinPasswordLength != null) props.minLength = p.MinPasswordLength;
      if (p.ComplexityEnabled != null) props.complexity = p.ComplexityEnabled;
      if (p.MaxPasswordAge != null) props.maxAgeDays = spanDays(p.MaxPasswordAge);
      if (p.MinPasswordAge != null) props.minAgeDays = spanDays(p.MinPasswordAge);
      if (p.PasswordHistoryCount != null) props.history = p.PasswordHistoryCount;
      if (p.LockoutThreshold != null) props.lockoutThreshold = p.LockoutThreshold;
      if (p.LockoutDuration != null) props.lockoutMinutes = spanMinutes(p.LockoutDuration);
      if (p.LockoutObservationWindow != null) props.lockoutWindowMinutes = spanMinutes(p.LockoutObservationWindow);
      if (p.ReversibleEncryptionEnabled != null) props.reversible = p.ReversibleEncryptionEnabled;
      WS.ad.setPolicy(props);
      if (p.PassThru) ctx.out(policyObj());
    } });
  adCmd({ name: 'Get-ADRootDSE', process(ctx) { adCheck(ctx); const dn = WS.ad.domainDN(); ctx.out(psobj('Microsoft.ActiveDirectory.Management.ADRootDSE', { configurationNamingContext: `CN=Configuration,${dn}`, currentTime: new Date(), defaultNamingContext: dn, dnsHostName: WS.sys.fqdn(), domainControllerFunctionality: 'Windows2025', domainFunctionality: WS.state.ad.domainMode.replace('Domain', 'Domain'), forestFunctionality: WS.state.ad.forestMode, isGlobalCatalogReady: true, isSynchronized: true, rootDomainNamingContext: dn, schemaNamingContext: `CN=Schema,CN=Configuration,${dn}`, serverName: `CN=${WS.sys.name},CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,${dn}`, supportedLDAPVersion: [3, 2] })); } });

  /* ================================================================ ADDSDeployment */
  const DEP = 'ADDSDeployment';
  const depCls = n => 'Microsoft.DirectoryServices.Deployment.PowerShell.Commands.' + n.replace('-', '') + 'Command';
  view('Microsoft.DirectoryServices.Deployment.Types.ADDSDeploymentResult', { table: { columns: [{ label: 'Message', width: 57, value: 'Message' }, { label: 'Context', width: 17, value: 'Context' }, { label: 'RebootRequired', width: 14, align: 'right', value: 'RebootRequired' }, { label: 'Status', value: 'Status' }] } });
  const LEVELS = { win2016: 'Win2016', winthreshold: 'Win2016', '7': 'Win2016', win2025: 'Win2025', '10': 'Win2025', default: 'Win2025' };
  async function promoteFlow(ctx, p, testOnly) {
    if (WS.sys.isDC()) ctx.throw({ message: 'Verification of prerequisites for Domain Controller promotion failed. This server is already a domain controller.', category: 'NotSpecified', target: '', exception: 'TestFailedException', id: 'Test.VerifyDcPromoCore.DCPromo.General.74,' + depCls(ctx.name) });
    const fm = LEVELS[String(p.ForestMode || 'Default').toLowerCase()];
    const dm = LEVELS[String(p.DomainMode || p.ForestMode || 'Default').toLowerCase()];
    if (!fm || !dm) ctx.throw({ message: `Verification of user input for the computer failed. The specified forest functional level (${p.ForestMode}) is not supported by Windows Server 2025. Specify Win2016 (WinThreshold) or Win2025.`, category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'Test.VerifyUserInput.DCPromo.General.74,' + depCls(ctx.name) });
    let dsrm = p.SafeModeAdministratorPassword;
    if (!dsrm) {
      const a = await ctx.prompt('SafeModeAdministratorPassword: ', { secure: true });
      const b = await ctx.prompt('Confirm SafeModeAdministratorPassword: ', { secure: true });
      if (a !== b) ctx.throw({ message: 'The passwords do not match.', category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'Test.VerifyUserInput.DCPromo.General.74,' + depCls(ctx.name) });
      dsrm = { value: a };
    }
    const opts = { domainName: p.DomainName, netbios: p.DomainNetbiosName, safeModePassword: dsrm.value, forestMode: fm, domainMode: dm, installDns: p.InstallDns !== false, databasePath: p.DatabasePath, logPath: p.LogPath, sysvolPath: p.SysvolPath, noReboot: true };
    const chk = WS.ad.prereqCheck(opts);
    if (!testOnly && !p.Force) {
      const a = await ctx.ask('', 'The target server will be configured as a domain controller and restarted when this operation is complete.\nDo you want to continue with this operation?', [['Y', 'Yes'], ['A', 'Yes to All'], ['N', 'No'], ['L', 'No to All'], ['S', 'Suspend']], 'Y');
      if (!['Y', 'A'].includes(a)) return;
    }
    for (const w of chk.warnings) ctx.warn(w);
    const steps = testOnly ? ['Validating environment and user input', 'All tests completed successfully'] : ['Determining DNS Settings', 'Validating environment and user input', 'All tests completed successfully', 'Installing new forest', 'Configuring the local computer to host Active Directory Domain Services', 'Creating directory partition', 'Configuring the DNS Server service on this computer', 'Securing machine\\domain controller'];
    for (let i = 0; i < steps.length; i++) {
      if (chk.errors.length && i >= 2) break;
      ctx.progress({ activity: testOnly ? 'Test-ADDSForestInstallation' : 'Install-ADDSForest', status: steps[i], percent: Math.round((i + 1) * 100 / steps.length) });
      await ctx.sleep(testOnly ? 300 : 350);
    }
    if (chk.errors.length) ctx.throw({ message: `Verification of prerequisites for Domain Controller promotion failed. ${chk.errors[0]}`, category: 'NotSpecified', target: '', exception: 'TestFailedException', id: 'Test.VerifyDcPromoCore.DCPromo.General.74,' + depCls(ctx.name) });
    if (testOnly) { ctx.out(psobj('Microsoft.DirectoryServices.Deployment.Types.ADDSDeploymentResult', { Message: 'Operation completed successfully', Context: 'Test.VerifyDcPromoCore.DCPromo.General.1', RebootRequired: false, Status: 'Success' })); return; }
    const r = WS.ad.installForest(opts);
    if (!r.ok) ctx.throw({ message: r.error, category: 'NotSpecified', target: '', exception: 'DeploymentException', id: 'DCPromo.General.3,' + depCls(ctx.name) });
    ctx.out(psobj('Microsoft.DirectoryServices.Deployment.Types.ADDSDeploymentResult', { Message: 'Operation completed successfully', Context: 'DCPromo.General.3', RebootRequired: false, Status: 'Success' }));
    if (!p.NoRebootOnCompletion) {
      setTimeout(() => {
        WS.ui.msgbox({ title: "You're about to be signed out", icon: 'warning', message: 'Your computer will restart because Active Directory Domain Services was installed or removed.', buttons: ['Close'] });
        setTimeout(() => WS.shell.restart(), 6000);
      }, 400);
    } else ctx.warn('A restart is required to complete the promotion. Restart the server before you use it as a domain controller.');
  }
  const forestParams = { DomainName: { pos: 0, mandatory: true }, DomainNetbiosName: {}, SafeModeAdministratorPassword: { type: 'securestring' }, ForestMode: {}, DomainMode: {}, InstallDns: { type: 'switch' }, DatabasePath: {}, LogPath: {}, SysvolPath: {}, NoRebootOnCompletion: { type: 'switch' }, Force: { type: 'switch' }, CreateDnsDelegation: { type: 'switch' }, SkipPreChecks: { type: 'switch' }, NoDnsOnNetwork: { type: 'switch' } };
  cmdlet({ name: 'Install-ADDSForest', module: DEP, version: '1.0.0.0', feature: 'AD-Domain-Services', cls: depCls('Install-ADDSForest'), shouldProcess: true, synopsis: 'Installs a new Active Directory forest configuration.', params: forestParams,
    async process(ctx, p) { await promoteFlow(ctx, p, false); } });
  cmdlet({ name: 'Test-ADDSForestInstallation', module: DEP, version: '1.0.0.0', feature: 'AD-Domain-Services', cls: depCls('Test-ADDSForestInstallation'), params: forestParams,
    async process(ctx, p) { await promoteFlow(ctx, p, true); } });
  for (const n of ['Install-ADDSDomainController', 'Install-ADDSDomain', 'Test-ADDSDomainControllerInstallation']) {
    cmdlet({ name: n, module: DEP, version: '1.0.0.0', feature: 'AD-Domain-Services', cls: depCls(n), shouldProcess: true, params: { DomainName: { pos: 0, mandatory: true, alias: ['ParentDomainName'] }, NewDomainName: {}, Credential: { type: 'object' }, SafeModeAdministratorPassword: { type: 'securestring' }, InstallDns: { type: 'switch' }, Force: { type: 'switch' } },
      process(ctx, p) { ctx.throw({ message: `Verification of prerequisites for Domain Controller promotion failed. The specified domain "${p.DomainName}" either does not exist or could not be contacted.`, category: 'NotSpecified', target: '', exception: 'TestFailedException', id: 'Test.VerifyDcPromoCore.DCPromo.General.74,' + depCls(n) }); } });
  }
  cmdlet({ name: 'Uninstall-ADDSDomainController', module: DEP, version: '1.0.0.0', feature: 'AD-Domain-Services', cls: depCls('Uninstall-ADDSDomainController'), shouldProcess: true, params: { LastDomainControllerInDomain: { type: 'switch' }, LocalAdministratorPassword: { type: 'securestring' }, RemoveApplicationPartitions: { type: 'switch' }, DemoteOperationMasterRole: { type: 'switch' }, Force: { type: 'switch' } },
    process(ctx) { ctx.throw({ message: WS.sys.isDC() ? 'Demoting the domain controller is not supported in the lab simulator. Use "Reset the lab" or start a lab to return to a member server.' : 'Verification of prerequisites for Domain Controller demotion failed. This computer is not a domain controller.', category: 'NotSpecified', exception: 'TestFailedException', id: 'Test.VerifyDcDemoteCore.DCPromo.General.74,' + depCls('Uninstall-ADDSDomainController') }); } });

  /* ================================================================ DnsServer */
  const DNSM = 'DnsServer';
  const dnsCmd = def => cmdlet({ module: DNSM, version: '2.0.0.0', feature: 'RSAT-DNS-Server', cls: def.name, ...def });
  function dnsCheck(ctx, cls = 'DnsServerZone') {
    if (!WS.dns.isInstalled() || !WS.svc.isRunning('DNS')) ctx.throw({ message: `Failed to get information for server ${WS.sys.name}.`, category: 'ResourceUnavailable', target: WS.sys.name, targetType: `root/Microsoft/Windows/DNS/${cls}`, exception: 'CimException', id: `WIN32 1722,${ctx.name}` });
  }
  const dnsErr = (ctx, msg, code, category = 'NotSpecified', cls = 'DnsServerZone', target) => ctx.error({ message: msg, category, target: target || WS.sys.name, targetType: `root/Microsoft/Windows/DNS/${cls}`, exception: 'CimException', id: `WIN32 ${code},${ctx.name}` });
  const zoneObj = z => psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerPrimaryZone', { ZoneName: z.name, ZoneType: z.type || 'Primary', IsAutoCreated: !!z.auto, IsDsIntegrated: !!z.adIntegrated, IsReverseLookupZone: !!z.reverse, IsSigned: false, DynamicUpdate: z.dynamicUpdate || 'None', ReplicationScope: z.adIntegrated ? z.replication : 'None', ZoneFile: z.file || null, IsPaused: !!z.paused, IsShutdown: false }, { str: z.name });
  const ZONE_TABLE = { table: { columns: [{ label: 'ZoneName', width: 32, value: 'ZoneName' }, { label: 'ZoneType', width: 10, value: 'ZoneType' }, { label: 'IsAutoCreated', width: 13, value: 'IsAutoCreated' }, { label: 'IsDsIntegrated', width: 14, value: 'IsDsIntegrated' }, { label: 'IsReverseLookupZone', width: 19, value: 'IsReverseLookupZone' }, { label: 'IsSigned', value: 'IsSigned' }] } };
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerPrimaryZone', ZONE_TABLE);
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerConditionalForwarderZone', ZONE_TABLE);
  const anyZoneObj = z => (z.cf ? cfObj(z) : zoneObj(z));
  const cfObj = c => psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerConditionalForwarderZone', { ZoneName: c.name, ZoneType: 'Forwarder', IsAutoCreated: false, IsDsIntegrated: c.adIntegrated, IsReverseLookupZone: /\.in-addr\.arpa$/.test(c.name), IsSigned: false, MasterServers: c.masters.slice(), ForwarderTimeout: c.timeout, ReplicationScope: c.adIntegrated ? c.replication : 'None', UseRecursion: false }, { str: c.name });
  dnsCmd({ name: 'Get-DnsServerZone', synopsis: 'Gets details of DNS zones on a DNS server.', params: { Name: { type: 'string[]', pos: 0, alias: ['ZoneName'] }, ComputerName: {} },
    process(ctx, p) {
      dnsCheck(ctx);
      const auto = [{ name: '0.in-addr.arpa', auto: true, reverse: true }, { name: '127.in-addr.arpa', auto: true, reverse: true }, { name: '255.in-addr.arpa', auto: true, reverse: true }];
      if (WS.sys.isDC()) auto.push({ name: 'TrustAnchors', adIntegrated: true, replication: 'Forest' });
      const zones = [...WS.dns.zones(), ...WS.dns.conditionalForwarders().map(c => ({ ...c, cf: true })), ...auto].sort((a, b) => (a.name.startsWith('_') ? -1 : 0) - (b.name.startsWith('_') ? -1 : 0) || 0);
      if (p.Name) { for (const n of p.Name) { const z = zones.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!z) dnsErr(ctx, `The zone ${n} was not found on server ${WS.sys.name}.`, 9601, 'ObjectNotFound', 'DnsServerZone', n); else ctx.out(anyZoneObj(z)); } return; }
      zones.forEach(z => ctx.out(anyZoneObj(z)));
    } });
  dnsCmd({ name: 'Add-DnsServerPrimaryZone', shouldProcess: true, synopsis: 'Adds a primary zone to a DNS server.',
    params: { Name: { pos: 0, alias: ['ZoneName'] }, NetworkId: {}, ReplicationScope: { type: 'enum', values: ['Forest', 'Domain', 'Legacy', 'Custom'] }, ZoneFile: {}, DynamicUpdate: { type: 'enum', values: ['None', 'Secure', 'NonsecureAndSecure'] }, PassThru: { type: 'switch' }, ComputerName: {} },
    async process(ctx, p) {
      dnsCheck(ctx);
      if (!p.ReplicationScope && !p.ZoneFile) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,Add-DnsServerPrimaryZone' });
      if (!p.Name && !p.NetworkId) ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: Name.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'MissingMandatoryParameter,Add-DnsServerPrimaryZone' });
      if (!(await ctx.confirm('Add-DnsServerPrimaryZone', p.Name || p.NetworkId))) return;
      if (p.DynamicUpdate === 'Secure' && !p.ReplicationScope) return dnsErr(ctx, `Failed to create zone ${p.Name} on server ${WS.sys.name}. Secure dynamic updates are available only for Active Directory-integrated zones.`, 87, 'InvalidArgument');
      const r = WS.dns.createZone({ name: p.Name, networkId: p.NetworkId, adIntegrated: !!p.ReplicationScope, replication: p.ReplicationScope, dynamicUpdate: p.DynamicUpdate, file: p.ZoneFile });
      if (!r.ok) return dnsErr(ctx, r.error.replace(/ The zone already exists\.$/, '').replace(/^Failed/, 'Failed'), r.code === 'ResourceExists' ? 9609 : 9601, r.code === 'ResourceExists' ? 'ResourceExists' : 'InvalidArgument');
      if (p.PassThru) ctx.out(zoneObj(r.zone));
    } });
  dnsCmd({ name: 'Remove-DnsServerZone', shouldProcess: true, impact: 'High', params: { Name: { pos: 0, mandatory: true, alias: ['ZoneName'] }, Force: { type: 'switch' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      dnsCheck(ctx);
      const z = WS.dns.zone(p.Name), cf = !z && WS.dns.conditionalForwarder(p.Name);
      if (!z && !cf) return dnsErr(ctx, `Failed to get the zone information for ${p.Name} on server ${WS.sys.name}.`, 9601, 'ObjectNotFound');
      if (!p.Force && !(await ctx.confirm('Remove', p.Name, { impact: 'High', query: `Removing the zone ${p.Name} from the server ${WS.sys.name}. Do you want to continue?` }))) return;
      if (cf) WS.dns.removeConditionalForwarder(p.Name); else WS.dns.removeZone(p.Name);
    } });
  dnsCmd({ name: 'Set-DnsServerPrimaryZone', shouldProcess: true, params: { Name: { pos: 0, mandatory: true, alias: ['ZoneName'] }, DynamicUpdate: { type: 'enum', values: ['None', 'Secure', 'NonsecureAndSecure'] }, PassThru: { type: 'switch' } },
    async process(ctx, p) { dnsCheck(ctx); if (!(await ctx.confirm('Set', p.Name))) return; const r = WS.dns.setZone(p.Name, { ...(p.DynamicUpdate ? { dynamicUpdate: p.DynamicUpdate } : {}) }); if (!r.ok) dnsErr(ctx, r.error, r.code === 'NotFound' ? 9601 : 87, r.code === 'NotFound' ? 'ObjectNotFound' : 'InvalidArgument'); else if (p.PassThru) ctx.out(zoneObj(WS.dns.zone(p.Name))); } });
  dnsCmd({ name: 'Add-DnsServerConditionalForwarderZone', shouldProcess: true, synopsis: 'Adds a conditional forwarder to a DNS server.',
    params: { Name: { pos: 0, mandatory: true, alias: ['ZoneName'] }, MasterServers: { type: 'string[]', pos: 1, mandatory: true }, ReplicationScope: { type: 'enum', values: ['Forest', 'Domain', 'Legacy', 'Custom'] }, ForwarderTimeout: { type: 'int' }, PassThru: { type: 'switch' }, ComputerName: {} },
    async process(ctx, p) {
      dnsCheck(ctx);
      if (!(await ctx.confirm('Add-DnsServerConditionalForwarderZone', p.Name))) return;
      const r = WS.dns.addConditionalForwarder({ name: p.Name, masters: p.MasterServers, adIntegrated: !!p.ReplicationScope, replication: p.ReplicationScope, timeout: p.ForwarderTimeout });
      if (!r.ok) return dnsErr(ctx, r.error.replace(/ The zone already exists\.$/, ''), r.code === 'ResourceExists' ? 9609 : 87, r.code === 'ResourceExists' ? 'ResourceExists' : 'InvalidArgument', 'DnsServerConditionalForwarderZone', p.Name);
      if (p.PassThru) ctx.out(cfObj(r.forwarder));
    } });
  dnsCmd({ name: 'Set-DnsServerConditionalForwarderZone', shouldProcess: true, params: { Name: { pos: 0, mandatory: true, alias: ['ZoneName'] }, MasterServers: { type: 'string[]' }, ForwarderTimeout: { type: 'int' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      dnsCheck(ctx);
      if (!(await ctx.confirm('Set', p.Name))) return;
      const r = WS.dns.setConditionalForwarder(p.Name, { ...(p.MasterServers ? { masters: p.MasterServers } : {}), ...(p.ForwarderTimeout != null ? { timeout: p.ForwarderTimeout } : {}) });
      if (!r.ok) return dnsErr(ctx, r.error, r.code === 'NotFound' ? 9601 : 87, r.code === 'NotFound' ? 'ObjectNotFound' : 'InvalidArgument', 'DnsServerConditionalForwarderZone', p.Name);
      if (p.PassThru) ctx.out(cfObj(WS.dns.conditionalForwarder(p.Name)));
    } });
  const TYPE_NUM = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33 };
  const ttlText = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return `${U.pad(h)}:${U.pad(m)}:${U.pad(ss)}`; };
  const rrData = r => (r.type === 'SOA' ? `[${r.data.serial || 1}][${r.data.primary}][${r.data.responsible}]` : r.type === 'MX' ? `[${r.preference}][${r.data}]` : r.type === 'SRV' ? `[${r.priority}][${r.weight}][${r.port}][${r.data}]` : toStr(r.data));
  const rrObj = (r, zone) => psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerResourceRecord', { HostName: r.name, RecordType: r.type, Type: TYPE_NUM[r.type] || 0, Timestamp: r.timestamp ? new Date(r.timestamp) : 0, TimeToLive: ttlText(r.ttl || 3600), RecordData: rrData(r), DistinguishedName: `DC=${r.name},DC=${zone},cn=MicrosoftDNS,DC=DomainDnsZones` }, { str: r.name });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerResourceRecord', { table: { columns: [{ label: 'HostName', width: 25, value: 'HostName' }, { label: 'RecordType', width: 10, value: 'RecordType' }, { label: 'Type', width: 10, value: 'Type' }, { label: 'Timestamp', width: 20, value: 'Timestamp' }, { label: 'TimeToLive', width: 15, value: 'TimeToLive' }, { label: 'RecordData', value: 'RecordData' }] } });
  dnsCmd({ name: 'Get-DnsServerResourceRecord', synopsis: 'Gets resource records from a specified DNS zone.', params: { ZoneName: { pos: 0, mandatory: true }, Name: { pos: 1 }, RRType: { type: 'enum', values: Object.keys(TYPE_NUM) } },
    process(ctx, p) {
      dnsCheck(ctx);
      const recs = WS.dns.records(p.ZoneName);
      if (!recs) return dnsErr(ctx, `Failed to get the zone information for ${p.ZoneName} on server ${WS.sys.name}.`, 9601, 'ObjectNotFound');
      let list = recs;
      if (p.Name) list = list.filter(r => r.name.toLowerCase() === p.Name.toLowerCase().replace(/\.$/, '') || r.fqdn.toLowerCase() === p.Name.toLowerCase().replace(/\.$/, ''));
      if (p.RRType) list = list.filter(r => r.type === p.RRType);
      if (!list.length && p.Name) return dnsErr(ctx, `Failed to get ${p.Name} record in ${p.ZoneName} zone on ${WS.sys.name} server.`, 9714, 'ObjectNotFound', 'DnsServerResourceRecord', p.Name);
      list.forEach(r => ctx.out(rrObj(r, p.ZoneName)));
    } });
  const addRR = (ctx, p, rec) => {
    const r = WS.dns.addRecord(p.ZoneName, { ...rec, ttl: p.TimeToLive ? (toStr(p.TimeToLive).match(/^(\d+):(\d+):(\d+)$/) ? toStr(p.TimeToLive).split(':').reduce((a, b) => a * 60 + +b, 0) : PS.toNum(p.TimeToLive)) : undefined });
    if (!r.ok) {
      if (r.code === 'NotFound') return dnsErr(ctx, `Failed to get the zone information for ${p.ZoneName} on server ${WS.sys.name}.`, 9601, 'ObjectNotFound');
      return dnsErr(ctx, r.code === 'ResourceExists' ? `Failed to create resource record ${rec.name} in zone ${p.ZoneName} on server ${WS.sys.name}.` : r.error, r.code === 'ResourceExists' ? (/CNAME/.test(r.error) ? 9709 : 9711) : 87, r.code === 'ResourceExists' ? 'ResourceExists' : 'InvalidArgument', 'DnsServerResourceRecord', rec.name);
    }
    if (r.warning) ctx.warn(r.warning.replace(/^Warning: /, ''));
    if (p.PassThru) ctx.out(rrObj(r.record, p.ZoneName));
  };
  const rrBase = { ZoneName: { mandatory: true }, Name: { mandatory: true }, TimeToLive: {}, PassThru: { type: 'switch' }, AllowUpdateAny: { type: 'switch' }, ComputerName: {} };
  dnsCmd({ name: 'Add-DnsServerResourceRecordA', shouldProcess: true, synopsis: 'Adds a type A resource record to a DNS zone.', params: { ...rrBase, IPv4Address: { type: 'string[]', mandatory: true }, CreatePtr: { type: 'switch' } },
    async process(ctx, p) { dnsCheck(ctx); if (!(await ctx.confirm('Add', p.Name))) return; for (const ip of p.IPv4Address) addRR(ctx, p, { name: p.Name, type: 'A', data: ip, createPtr: p.CreatePtr }); } });
  dnsCmd({ name: 'Add-DnsServerResourceRecordCName', shouldProcess: true, params: { ...rrBase, HostNameAlias: { mandatory: true } },
    async process(ctx, p) { dnsCheck(ctx); if (!(await ctx.confirm('Add', p.Name))) return; addRR(ctx, p, { name: p.Name, type: 'CNAME', data: p.HostNameAlias }); } });
  dnsCmd({ name: 'Add-DnsServerResourceRecordMX', shouldProcess: true, params: { ...rrBase, MailExchange: { mandatory: true }, Preference: { type: 'int', mandatory: true } },
    async process(ctx, p) { dnsCheck(ctx); if (!(await ctx.confirm('Add', p.Name))) return; addRR(ctx, p, { name: p.Name, type: 'MX', data: p.MailExchange, preference: p.Preference }); } });
  dnsCmd({ name: 'Add-DnsServerResourceRecordPtr', shouldProcess: true, params: { ...rrBase, PtrDomainName: { mandatory: true } },
    async process(ctx, p) { dnsCheck(ctx); if (!(await ctx.confirm('Add', p.Name))) return; addRR(ctx, p, { name: p.Name, type: 'PTR', data: p.PtrDomainName }); } });
  dnsCmd({ name: 'Add-DnsServerResourceRecord', shouldProcess: true, params: { ...rrBase, A: { type: 'switch' }, CName: { type: 'switch' }, Ptr: { type: 'switch' }, MX: { type: 'switch' }, Txt: { type: 'switch' }, IPv4Address: {}, HostNameAlias: {}, PtrDomainName: {}, MailExchange: {}, Preference: { type: 'int' }, DescriptiveText: {}, CreatePtr: { type: 'switch' } },
    async process(ctx, p) {
      dnsCheck(ctx);
      if (!(await ctx.confirm('Add', p.Name))) return;
      if (p.A) addRR(ctx, p, { name: p.Name, type: 'A', data: p.IPv4Address, createPtr: p.CreatePtr });
      else if (p.CName) addRR(ctx, p, { name: p.Name, type: 'CNAME', data: p.HostNameAlias });
      else if (p.Ptr) addRR(ctx, p, { name: p.Name, type: 'PTR', data: p.PtrDomainName });
      else if (p.MX) addRR(ctx, p, { name: p.Name, type: 'MX', data: p.MailExchange, preference: p.Preference || 10 });
      else if (p.Txt) addRR(ctx, p, { name: p.Name, type: 'TXT', data: p.DescriptiveText });
      else ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,Add-DnsServerResourceRecord' });
    } });
  dnsCmd({ name: 'Remove-DnsServerResourceRecord', shouldProcess: true, impact: 'High', params: { ZoneName: { pos: 0, mandatory: true }, Name: { pos: 1 }, RRType: { type: 'enum', values: Object.keys(TYPE_NUM), pos: 2 }, RecordData: { type: 'string[]' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      dnsCheck(ctx);
      if (!p.Force && !(await ctx.confirm('Remove', p.Name, { impact: 'High', query: `Removing DNS resource record set by name ${p.Name} of type ${p.RRType} from zone ${p.ZoneName} on ${WS.sys.name} server. Do you want to continue?` }))) return;
      const r = WS.dns.removeRecord(p.ZoneName, { name: p.Name, type: p.RRType, data: p.RecordData ? p.RecordData[0] : undefined });
      if (!r.ok) dnsErr(ctx, r.error, r.code === 'NotFound' ? 9714 : 87, r.code === 'NotFound' ? 'ObjectNotFound' : 'InvalidArgument', 'DnsServerResourceRecord', p.Name);
    } });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerForwarder', { list: ['UseRootHint', 'Timeout(s)', 'EnableReordering', 'IPAddress', 'ReorderedIPAddress'] });
  const fwdObj = () => psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DNS/DnsServerForwarder', { UseRootHint: WS.dns.useRootHints(), 'Timeout(s)': 3, EnableReordering: true, IPAddress: WS.dns.forwarders(), ReorderedIPAddress: WS.dns.forwarders() });
  dnsCmd({ name: 'Get-DnsServerForwarder', process(ctx) { dnsCheck(ctx, 'DnsServerForwarder'); ctx.out(fwdObj()); } });
  dnsCmd({ name: 'Set-DnsServerForwarder', shouldProcess: true, params: { IPAddress: { type: 'string[]', pos: 0 }, UseRootHint: { type: 'bool' }, PassThru: { type: 'switch' } },
    async process(ctx, p) { dnsCheck(ctx, 'DnsServerForwarder'); if (!(await ctx.confirm('Set', 'DnsServerForwarder'))) return; if (p.IPAddress) { const r = WS.dns.setForwarders(p.IPAddress); if (!r.ok) return dnsErr(ctx, r.error, 87, 'InvalidArgument', 'DnsServerForwarder'); } if (p.UseRootHint != null) WS.dns.setUseRootHints(p.UseRootHint); if (p.PassThru) ctx.out(fwdObj()); } });
  dnsCmd({ name: 'Add-DnsServerForwarder', shouldProcess: true, params: { IPAddress: { type: 'string[]', pos: 0, mandatory: true }, PassThru: { type: 'switch' } },
    async process(ctx, p) { dnsCheck(ctx, 'DnsServerForwarder'); if (!(await ctx.confirm('Add', p.IPAddress.join(', ')))) return; const r = WS.dns.setForwarders([...WS.dns.forwarders(), ...p.IPAddress.filter(x => !WS.dns.forwarders().includes(x))]); if (!r.ok) dnsErr(ctx, r.error, 87, 'InvalidArgument', 'DnsServerForwarder'); else if (p.PassThru) ctx.out(fwdObj()); } });
  dnsCmd({ name: 'Remove-DnsServerForwarder', shouldProcess: true, impact: 'High', params: { IPAddress: { type: 'string[]', pos: 0, mandatory: true }, Force: { type: 'switch' } },
    async process(ctx, p) { dnsCheck(ctx, 'DnsServerForwarder'); if (!p.Force && !(await ctx.confirm('Remove', p.IPAddress.join(', '), { impact: 'High' }))) return; WS.dns.setForwarders(WS.dns.forwarders().filter(x => !p.IPAddress.includes(x))); } });
  dnsCmd({ name: 'Clear-DnsServerCache', shouldProcess: true, params: { Force: { type: 'switch' } }, async process(ctx, p) { dnsCheck(ctx, 'DnsServerCache'); if (!p.Force) await ctx.confirm('Clear', 'DnsServerCache', { impact: 'High', query: `Clearing all resource records from cache on server ${WS.sys.name}. Do you want to continue?` }); } });

  /* ================================================================ DhcpServer */
  const DH = 'DhcpServer';
  const dhcpCmd = def => cmdlet({ module: DH, version: '2.0.0.0', feature: 'RSAT-DHCP', cls: def.name, ...def });
  function dhcpCheck(ctx, what = 'scopes') {
    if (!WS.dhcp.isInstalled() || !WS.svc.isRunning('DHCPServer')) ctx.throw({ message: `Failed to get the ${what} on DHCP server ${WS.sys.name}.`, category: 'NotSpecified', target: WS.sys.name, targetType: 'root/Microsoft/Windows/DHCP/DhcpServerv4Scope', exception: 'CimException', id: `WIN32 1722,${ctx.name}` });
  }
  /** TimeSpan text for a scope lease; fractional days come from the console's Days/Hours/Minutes, unlimited is TimeSpan.MaxValue. */
  const leaseSpan = s => { if (s.leaseUnlimited) return '10675199.02:48:05.4775807'; const m = Math.round(s.leaseDays * 1440), d = Math.floor(m / 1440); return `${d}.${U.pad(Math.floor(m % 1440 / 60))}:${U.pad(m % 60)}:00`; };
  const dhcpErr = (ctx, msg, code, category = 'InvalidArgument', target) => ctx.error({ message: msg, category, target: target || WS.sys.name, targetType: 'root/Microsoft/Windows/DHCP/DhcpServerv4Scope', exception: 'CimException', id: `DHCP ${code},${ctx.name}` });
  const scopeObj = s => psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Scope', { ScopeId: s.id, SubnetMask: s.mask, Name: s.name, State: s.active ? 'Active' : 'Inactive', StartRange: s.start, EndRange: s.end, LeaseDuration: leaseSpan(s), Description: s.description, Type: s.type || 'Dhcp' }, { str: s.id });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Scope', { table: { columns: [{ label: 'ScopeId', width: 15, value: 'ScopeId' }, { label: 'SubnetMask', width: 15, value: 'SubnetMask' }, { label: 'Name', width: 20, value: 'Name' }, { label: 'State', width: 8, value: 'State' }, { label: 'StartRange', width: 15, value: 'StartRange' }, { label: 'EndRange', width: 15, value: 'EndRange' }, { label: 'LeaseDuration', value: 'LeaseDuration' }] } });
  const scopeOf = (ctx, id) => { const s = WS.dhcp.scope(toStr(id)); if (!s) dhcpErr(ctx, `Failed to get the scope ${id} on DHCP server ${WS.sys.name}.`, 20022, 'ObjectNotFound', toStr(id)); return s; };
  dhcpCmd({ name: 'Get-DhcpServerv4Scope', synopsis: 'Returns the IPv4 scope configuration of the specified scopes.', params: { ScopeId: { type: 'string[]', pos: 0, pipe: 'name' }, ComputerName: {} },
    process(ctx, p) { dhcpCheck(ctx); if (p.ScopeId) { for (const id of p.ScopeId) { const s = scopeOf(ctx, id); if (s) ctx.out(scopeObj(s)); } return; } WS.dhcp.scopes().forEach(s => ctx.out(scopeObj(s))); } });
  const leaseDays = v => { if (v == null) return undefined; const s = toStr(v); const m = s.match(/^(\d+)\.(\d\d):(\d\d):(\d\d)$/) || s.match(/^(\d+)$/); if (m) return +m[1] + (m[2] ? (+m[2]) / 24 : 0); const t = s.match(/^(\d\d):(\d\d):(\d\d)$/); return t ? (+t[1]) / 24 : PS.toNum(s); };
  dhcpCmd({ name: 'Add-DhcpServerv4Scope', shouldProcess: true, synopsis: 'Adds an IPv4 scope on the DHCP server service.',
    params: { Name: { mandatory: true }, StartRange: { mandatory: true }, EndRange: { mandatory: true }, SubnetMask: { mandatory: true }, State: { type: 'enum', values: ['Active', 'InActive'] }, LeaseDuration: {}, Description: {}, Type: {}, PassThru: { type: 'switch' }, ComputerName: {} },
    async process(ctx, p) {
      dhcpCheck(ctx);
      if (!(await ctx.confirm('Add', p.Name))) return;
      const r = WS.dhcp.addScope({ name: p.Name, start: p.StartRange, end: p.EndRange, mask: p.SubnetMask, description: p.Description, leaseDays: leaseDays(p.LeaseDuration), active: p.State !== 'InActive' });
      if (!r.ok) return dhcpErr(ctx, r.code === 'Exists' ? `Failed to add scope ${U.networkOf(p.StartRange, U.maskToPrefix(p.SubnetMask))} on DHCP server ${WS.sys.name}.` : r.error, r.code === 'Exists' ? 20021 : 20018, r.code === 'Exists' ? 'ResourceExists' : 'InvalidArgument');
      if (p.PassThru) ctx.out(scopeObj(r.scope));
    } });
  dhcpCmd({ name: 'Set-DhcpServerv4Scope', shouldProcess: true, params: { ScopeId: { pos: 0, mandatory: true, pipe: 'name' }, Name: {}, Description: {}, State: { type: 'enum', values: ['Active', 'InActive'] }, LeaseDuration: {}, StartRange: {}, EndRange: {}, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      dhcpCheck(ctx);
      const s = scopeOf(ctx, p.ScopeId); if (!s) return;
      if (!(await ctx.confirm('Set', s.id))) return;
      const props = {};
      for (const k of ['Name', 'Description']) if (p[k] != null) props[k.toLowerCase()] = p[k];
      if (p.State) props.active = p.State === 'Active';
      if (p.LeaseDuration) props.leaseDays = leaseDays(p.LeaseDuration);
      if (p.StartRange) props.start = p.StartRange;
      if (p.EndRange) props.end = p.EndRange;
      const r = WS.dhcp.setScope(s.id, props);
      if (!r.ok) dhcpErr(ctx, r.error, 20018); else if (p.PassThru) ctx.out(scopeObj(WS.dhcp.scope(s.id)));
    } });
  dhcpCmd({ name: 'Remove-DhcpServerv4Scope', shouldProcess: true, impact: 'High', params: { ScopeId: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, Force: { type: 'switch' } },
    async process(ctx, p) { dhcpCheck(ctx); for (const id of p.ScopeId) { const s = scopeOf(ctx, id); if (!s) continue; if (!p.Force && !(await ctx.confirm('Remove', id, { impact: 'High' }))) continue; WS.dhcp.removeScope(s.id); } } });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpExclusionRange', { table: { columns: [{ label: 'ScopeId', width: 15, value: 'ScopeId' }, { label: 'StartRange', width: 15, value: 'StartRange' }, { label: 'EndRange', value: 'EndRange' }] } });
  dhcpCmd({ name: 'Add-DhcpServerv4ExclusionRange', shouldProcess: true, params: { ScopeId: { pos: 0, mandatory: true, pipe: 'name' }, StartRange: { pos: 1, mandatory: true }, EndRange: { pos: 2, mandatory: true }, PassThru: { type: 'switch' } },
    async process(ctx, p) { dhcpCheck(ctx); const s = scopeOf(ctx, p.ScopeId); if (!s || !(await ctx.confirm('Add', `${p.StartRange}-${p.EndRange}`))) return; const r = WS.dhcp.addExclusion(s.id, p.StartRange, p.EndRange); if (!r.ok) dhcpErr(ctx, `Failed to add exclusion range ${p.StartRange}-${p.EndRange} for scope ${s.id} on DHCP server ${WS.sys.name}. ${r.error}`, 20020); } });
  dhcpCmd({ name: 'Get-DhcpServerv4ExclusionRange', params: { ScopeId: { type: 'string[]', pos: 0, pipe: 'name' } },
    process(ctx, p) { dhcpCheck(ctx); for (const s of p.ScopeId ? p.ScopeId.map(id => scopeOf(ctx, id)).filter(Boolean) : WS.dhcp.scopes()) for (const e of s.exclusions) ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpExclusionRange', { ScopeId: s.id, StartRange: e.start, EndRange: e.end })); } });
  dhcpCmd({ name: 'Remove-DhcpServerv4ExclusionRange', shouldProcess: true, params: { ScopeId: { pos: 0, mandatory: true }, StartRange: { pos: 1 }, EndRange: { pos: 2 } },
    async process(ctx, p) { dhcpCheck(ctx); const s = scopeOf(ctx, p.ScopeId); if (!s || !(await ctx.confirm('Remove', p.StartRange))) return; for (const e of s.exclusions.filter(x => !p.StartRange || x.start === p.StartRange)) WS.dhcp.removeExclusion(s.id, e.start); } });
  const resObj = (s, r) => psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Reservation', { IPAddress: r.ip, ScopeId: s.id, ClientId: r.mac.toLowerCase(), Name: r.name, Type: r.type || 'Both', Description: r.description });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Reservation', { table: { columns: [{ label: 'IPAddress', width: 15, value: 'IPAddress' }, { label: 'ScopeId', width: 15, value: 'ScopeId' }, { label: 'ClientId', width: 20, value: 'ClientId' }, { label: 'Name', width: 20, value: 'Name' }, { label: 'Type', width: 6, value: 'Type' }, { label: 'Description', value: 'Description' }] } });
  dhcpCmd({ name: 'Add-DhcpServerv4Reservation', shouldProcess: true, params: { ScopeId: { pos: 0, mandatory: true, pipe: 'name' }, IPAddress: { pos: 1, mandatory: true }, ClientId: { pos: 2, mandatory: true }, Name: {}, Description: {}, Type: {}, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      dhcpCheck(ctx);
      const s = scopeOf(ctx, p.ScopeId); if (!s || !(await ctx.confirm('Add', p.IPAddress))) return;
      const r = WS.dhcp.addReservation(s.id, { ip: p.IPAddress, mac: p.ClientId, name: p.Name, description: p.Description, type: p.Type });
      if (!r.ok) return dhcpErr(ctx, r.error, r.code === 'Exists' ? 20022 : 20018, r.code === 'Exists' ? 'ResourceExists' : 'InvalidArgument');
      if (p.PassThru) ctx.out(resObj(s, WS.dhcp.scope(s.id).reservations.find(x => x.ip === p.IPAddress)));
    } });
  dhcpCmd({ name: 'Get-DhcpServerv4Reservation', params: { ScopeId: { type: 'string[]', pos: 0, pipe: 'name' }, IPAddress: { type: 'string[]' } },
    process(ctx, p) { dhcpCheck(ctx); for (const s of p.ScopeId ? p.ScopeId.map(id => scopeOf(ctx, id)).filter(Boolean) : WS.dhcp.scopes()) for (const r of s.reservations) if (!p.IPAddress || p.IPAddress.includes(r.ip)) ctx.out(resObj(s, r)); } });
  dhcpCmd({ name: 'Remove-DhcpServerv4Reservation', shouldProcess: true, params: { ScopeId: { pos: 0 }, IPAddress: { type: 'string[]' }, ClientId: { type: 'string[]' } },
    async process(ctx, p) {
      dhcpCheck(ctx);
      for (const s of p.ScopeId ? [scopeOf(ctx, p.ScopeId)].filter(Boolean) : WS.dhcp.scopes()) for (const key of [...(p.IPAddress || []), ...(p.ClientId || [])]) { if (!(await ctx.confirm('Remove', key))) continue; const r = WS.dhcp.removeReservation(s.id, key); if (!r.ok && p.ScopeId) dhcpErr(ctx, r.error, 20022, 'ObjectNotFound'); }
    } });
  const OPT_TYPES = { 'ip[]': 'IPv4Address', string: 'String', byte: 'Byte', long: 'DWord' };
  const OPT_NAMES = { 3: 'Router', 6: 'DNS Servers', 15: 'DNS Domain Name', 44: 'WINS/NBNS Servers', 46: 'WINS/NBT Node Type', 42: 'NTP Servers', 66: 'Boot Server Host Name', 67: 'Bootfile Name', 51: 'Lease' };
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4OptionValue', { table: { columns: [{ label: 'OptionId', width: 8, align: 'right', value: 'OptionId' }, { label: 'Name', width: 20, value: 'Name' }, { label: 'Type', width: 10, value: 'Type' }, { label: 'Value', width: 30, value: 'Value' }, { label: 'VendorClass', width: 11, value: 'VendorClass' }, { label: 'UserClass', width: 9, value: 'UserClass' }, { label: 'PolicyName', value: 'PolicyName' }] } });
  dhcpCmd({ name: 'Set-DhcpServerv4OptionValue', shouldProcess: true, synopsis: 'Sets an IPv4 option value at the server, scope, or reservation level.',
    params: { ScopeId: { pos: 0, pipe: 'name' }, Router: { type: 'string[]' }, DnsServer: { type: 'string[]' }, DnsDomain: {}, WinsServer: { type: 'string[]' }, OptionId: { type: 'int' }, Value: { type: 'string[]' }, Force: { type: 'switch' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      dhcpCheck(ctx);
      const sid = p.ScopeId || null;
      if (sid && !scopeOf(ctx, sid)) return;
      if (!(await ctx.confirm('Set', sid || 'server options'))) return;
      if (p.DnsServer && !p.Force) {
        for (const d of p.DnsServer) {
          const ok = WS.net.ownIps().includes(d) || WS.net.queryServer(d, WS.state.system.domain || 'www.microsoft.com', 'A').status !== 'timeout';
          if (!ok) return dhcpErr(ctx, `The DNS server ${d} is not a valid DNS server for the domain ${p.DnsDomain || WS.state.system.domain || ''}.`, 87);
        }
      }
      const sets = [[3, p.Router], [6, p.DnsServer], [15, p.DnsDomain], [44, p.WinsServer]];
      if (p.OptionId) sets.push([p.OptionId, p.Value]);
      for (const [code, v] of sets) if (v != null) { const r = WS.dhcp.setOption(sid, code, code === 15 ? toStr(v) : v); if (!r.ok) dhcpErr(ctx, r.error, 87); }
    } });
  dhcpCmd({ name: 'Get-DhcpServerv4OptionValue', params: { ScopeId: { pos: 0, pipe: 'name' }, OptionId: { type: 'int[]' }, All: { type: 'switch' } },
    process(ctx, p) {
      dhcpCheck(ctx, 'option values');
      const opts = p.ScopeId ? (scopeOf(ctx, p.ScopeId) ? WS.dhcp.scope(p.ScopeId).options : null) : WS.dhcp.serverOptions();
      if (!opts) return;
      const rows = Object.entries(opts).map(([code, v]) => ({ OptionId: +code, Name: OPT_NAMES[code] || (WS.dhcp.OPTIONS[code] || {}).name || 'Option ' + code, Type: OPT_TYPES[(WS.dhcp.OPTIONS[code] || {}).type] || (Array.isArray(v) ? 'IPv4Address' : 'String'), Value: toArray(v), VendorClass: '', UserClass: '', PolicyName: '' }));
      if (p.ScopeId) { const s = WS.dhcp.scope(p.ScopeId); rows.push({ OptionId: 51, Name: 'Lease', Type: 'DWord', Value: [String(s.leaseDays * 86400)], VendorClass: '', UserClass: '', PolicyName: '' }); }
      rows.sort((a, b) => a.OptionId - b.OptionId).filter(r => !p.OptionId || p.OptionId.includes(r.OptionId)).forEach(r => ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4OptionValue', r)));
    } });
  dhcpCmd({ name: 'Remove-DhcpServerv4OptionValue', shouldProcess: true, params: { ScopeId: { pos: 0 }, OptionId: { type: 'int[]', mandatory: true } },
    async process(ctx, p) { dhcpCheck(ctx); for (const c of p.OptionId) if (await ctx.confirm('Remove', String(c))) WS.dhcp.removeOption(p.ScopeId || null, c); } });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Lease', { table: { columns: [{ label: 'IPAddress', width: 15, value: 'IPAddress' }, { label: 'ScopeId', width: 15, value: 'ScopeId' }, { label: 'ClientId', width: 20, value: 'ClientId' }, { label: 'HostName', width: 20, value: 'HostName' }, { label: 'AddressState', width: 15, value: 'AddressState' }, { label: 'LeaseExpiryTime', value: 'LeaseExpiryTime' }] } });
  dhcpCmd({ name: 'Get-DhcpServerv4Lease', params: { ScopeId: { type: 'string[]', pos: 0, pipe: 'name' }, IPAddress: { type: 'string[]' } },
    process(ctx, p) {
      dhcpCheck(ctx, 'leases');
      for (const s of p.ScopeId ? p.ScopeId.map(id => scopeOf(ctx, id)).filter(Boolean) : WS.dhcp.scopes()) for (const l of s.leases) if (!p.IPAddress || p.IPAddress.includes(l.ip)) ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Lease', { IPAddress: l.ip, ScopeId: s.id, ClientId: l.mac.toLowerCase(), HostName: l.hostname, AddressState: l.type === 'Reservation' ? 'ActiveReservation' : 'Active', LeaseExpiryTime: l.expires ? new Date(l.expires) : null }));
    } });
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerInDC', { table: { columns: [{ label: 'IPAddress', width: 15, value: 'IPAddress' }, { label: 'DnsName', value: 'DnsName' }] } });
  dhcpCmd({ name: 'Add-DhcpServerInDC', shouldProcess: true, synopsis: 'Adds the computer that runs the DHCP server service to the list of authorized DHCP server services in Active Directory.', params: { DnsName: { pos: 0 }, IPAddress: { pos: 1 }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      if (!(await ctx.confirm('Add', WS.sys.fqdn()))) return;
      const r = WS.dhcp.authorize();
      if (!r.ok) return dhcpErr(ctx, `Failed to add DHCP server ${WS.sys.fqdn()} in DS. This computer is not joined to an Active Directory domain.`, 20070, 'NotSpecified');
    } });
  dhcpCmd({ name: 'Get-DhcpServerInDC', process(ctx) { if (WS.dhcp.authorized) ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerInDC', { IPAddress: WS.net.primaryIp(), DnsName: WS.sys.fqdn().toLowerCase() })); } });
  dhcpCmd({ name: 'Remove-DhcpServerInDC', shouldProcess: true, params: { DnsName: { pos: 0 }, IPAddress: { pos: 1 } }, async process(ctx) { if (await ctx.confirm('Remove', WS.sys.fqdn())) WS.dhcp.unauthorize(); } });
  dhcpCmd({ name: 'Add-DhcpServerSecurityGroup', process(ctx) {
    if (WS.sys.isDC()) { for (const [n, d] of [['DHCP Administrators', 'Members who have administrative access to DHCP Service'], ['DHCP Users', 'Members who have view-only access to the DHCP service']]) if (!WS.ad.get(n, 'group')) WS.ad.createGroup({ name: n, description: d, scope: 'DomainLocal' }); }
    else for (const [n, d] of [['DHCP Administrators', 'Members who have administrative access to DHCP Service'], ['DHCP Users', 'Members who have view-only access to the DHCP service']]) if (!WS.local.group(n)) WS.local.createGroup(n, d);
  } });
  dhcpCmd({ name: 'Set-DhcpServerv4Reservation', shouldProcess: true, params: { IPAddress: { pos: 0, mandatory: true, pipe: 'name' }, ClientId: {}, Name: {}, Description: {}, Type: { type: 'enum', values: ['Dhcp', 'Bootp', 'Both'] }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      dhcpCheck(ctx, 'reservations');
      const s = WS.dhcp.scopes().find(x => x.reservations.some(r => r.ip === p.IPAddress));
      if (!s) return dhcpErr(ctx, `Failed to get reservation for IP address ${p.IPAddress} on DHCP server ${WS.sys.name}.`, 20022, 'ObjectNotFound', p.IPAddress);
      if (!(await ctx.confirm('Set', p.IPAddress))) return;
      const props = {};
      for (const [k, m] of [['ClientId', 'mac'], ['Name', 'name'], ['Description', 'description'], ['Type', 'type']]) if (p[k] != null) props[m] = p[k];
      const r = WS.dhcp.setReservation(s.id, p.IPAddress, props);
      if (!r.ok) dhcpErr(ctx, r.error, r.code === 'Exists' ? 20022 : 20018); else if (p.PassThru) ctx.out(resObj(s, WS.dhcp.scope(s.id).reservations.find(x => x.ip === p.IPAddress)));
    } });
  dhcpCmd({ name: 'Remove-DhcpServerv4Lease', shouldProcess: true, synopsis: 'Deletes one or more lease records from the DHCP server service.', params: { IPAddress: { type: 'string[]', pos: 0, pipe: 'name' }, ScopeId: { type: 'string[]' }, ComputerName: {} },
    async process(ctx, p) {
      dhcpCheck(ctx, 'leases');
      if (!p.IPAddress) { for (const s of (p.ScopeId || []).map(id => scopeOf(ctx, id)).filter(Boolean)) for (const l of WS.dhcp.leases(s.id)) if (await ctx.confirm('Remove', l.ip)) WS.dhcp.removeLease(s.id, l.ip); return; }
      for (const ip of p.IPAddress) {
        const s = WS.dhcp.scopes().find(x => x.leases.some(l => l.ip === ip));
        if (!s) { dhcpErr(ctx, `Failed to get the lease ${ip} on DHCP server ${WS.sys.name}.`, 20013, 'ObjectNotFound', ip); continue; }
        if (await ctx.confirm('Remove', ip)) WS.dhcp.removeLease(s.id, ip);
      }
    } });
  const FILTER = 'Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Filter';
  const FILTERLIST = 'Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4FilterList';
  const filterObj = (list, f) => psobj(FILTER, { List: list, MacAddress: f.mac.toLowerCase(), Description: f.description });
  const filterListObj = () => { const f = WS.dhcp.filters(); return psobj(FILTERLIST, { Allow: f.allowEnabled, Deny: f.denyEnabled }); };
  view(FILTER, { table: { columns: [{ label: 'List', width: 8, value: 'List' }, { label: 'MacAddress', width: 20, value: 'MacAddress' }, { label: 'Description', value: 'Description' }] } });
  view(FILTERLIST, { table: { columns: [{ label: 'Allow', width: 20, value: 'Allow' }, { label: 'Deny', value: 'Deny' }] } });
  dhcpCmd({ name: 'Add-DhcpServerv4Filter', shouldProcess: true, synopsis: 'Adds a MAC address filter to the allow or deny list of the DHCP server service.',
    params: { List: { mandatory: true, type: 'enum', values: ['Allow', 'Deny'] }, MacAddress: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, Description: {}, Force: { type: 'switch' }, PassThru: { type: 'switch' }, ComputerName: {} },
    async process(ctx, p) {
      dhcpCheck(ctx, 'filters');
      for (const mac of p.MacAddress) {
        if (!(await ctx.confirm('Add', mac))) continue;
        const r = WS.dhcp.addFilter(p.List, mac, p.Description || '');
        if (!r.ok) { dhcpErr(ctx, r.error, r.code === 'Exists' ? 20096 : 87, r.code === 'Exists' ? 'ResourceExists' : 'InvalidArgument', mac); continue; }
        if (p.PassThru) ctx.out(filterObj(p.List, { mac: r.mac, description: p.Description || '' }));
      }
    } });
  dhcpCmd({ name: 'Get-DhcpServerv4Filter', synopsis: 'Gets the MAC address filters from the allow or deny list.', params: { List: { type: 'enum', values: ['Allow', 'Deny'] }, ComputerName: {} },
    process(ctx, p) {
      dhcpCheck(ctx, 'filters');
      const f = WS.dhcp.filters();
      for (const [key, list] of [['allow', 'Allow'], ['deny', 'Deny']]) if (!p.List || p.List === list) f[key].forEach(x => ctx.out(filterObj(list, x)));
    } });
  dhcpCmd({ name: 'Remove-DhcpServerv4Filter', shouldProcess: true, params: { MacAddress: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, ComputerName: {} },
    async process(ctx, p) {
      dhcpCheck(ctx, 'filters');
      for (const mac of p.MacAddress) { if (!(await ctx.confirm('Remove', mac))) continue; const r = WS.dhcp.removeFilter(mac); if (!r.ok) dhcpErr(ctx, r.error, 20097, 'ObjectNotFound', mac); }
    } });
  dhcpCmd({ name: 'Set-DhcpServerv4FilterList', shouldProcess: true, synopsis: 'Enables or disables the allow and deny filter lists.', params: { Allow: { type: 'bool' }, Deny: { type: 'bool' }, PassThru: { type: 'switch' }, ComputerName: {} },
    async process(ctx, p) {
      dhcpCheck(ctx, 'filters');
      if (!(await ctx.confirm('Set', 'FilterList'))) return;
      const o = {};
      if (p.Allow != null) o.allow = p.Allow;
      if (p.Deny != null) o.deny = p.Deny;
      WS.dhcp.setFilterList(o);
      if (p.PassThru) ctx.out(filterListObj());
    } });
  dhcpCmd({ name: 'Get-DhcpServerv4FilterList', params: { ComputerName: {} }, process(ctx) { dhcpCheck(ctx, 'filters'); ctx.out(filterListObj()); } });
  const pct = (n, total) => (total ? Math.round(n * 100 / total) : 0);
  view('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4ScopeStatistics', { table: { columns: [{ label: 'ScopeId', width: 15, value: 'ScopeId' }, { label: 'Free', width: 8, align: 'right', value: 'Free' }, { label: 'InUse', width: 8, align: 'right', value: 'InUse' }, { label: 'PercentageInUse', width: 16, align: 'right', value: 'PercentageInUse' }, { label: 'Reserved', width: 9, align: 'right', value: 'Reserved' }, { label: 'Pending', width: 8, align: 'right', value: 'Pending' }, { label: 'SuperscopeName', value: 'SuperscopeName' }] } });
  dhcpCmd({ name: 'Get-DhcpServerv4ScopeStatistics', params: { ScopeId: { type: 'string[]', pos: 0, pipe: 'name' }, ComputerName: {} },
    process(ctx, p) {
      dhcpCheck(ctx, 'scope statistics');
      for (const s of p.ScopeId ? p.ScopeId.map(id => scopeOf(ctx, id)).filter(Boolean) : WS.dhcp.scopes()) {
        const st = WS.dhcp.statistics(s.id);
        ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4ScopeStatistics', { ScopeId: s.id, Free: st.available, InUse: st.inUse, PercentageInUse: pct(st.inUse, st.totalAddresses), Reserved: s.reservations.length, Pending: 0, SuperscopeName: '' }));
      }
    } });
  dhcpCmd({ name: 'Get-DhcpServerv4Statistics', params: { ComputerName: {} },
    process(ctx) {
      dhcpCheck(ctx, 'server statistics');
      const st = WS.dhcp.statistics();
      ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#root/Microsoft/Windows/DHCP/DhcpServerv4Statistics', { InUse: st.inUse, Available: st.available, Acks: st.acks, AddressesAvailable: st.available, AddressesInUse: st.inUse,
        Declines: st.declines, DelayedOffers: st.delayedOffers, Discovers: st.discovers, Naks: st.nacks, Offers: st.offers, PendingOffers: 0, PercentageAvailable: 100 - pct(st.inUse, st.totalAddresses),
        PercentageInUse: pct(st.inUse, st.totalAddresses), PercentagePendingOffers: 0, Releases: st.releases, Requests: st.requests, ScopesWithDelayConfigured: st.scopesWithDelay,
        ServerStartTime: new Date(st.startTime), TotalAddresses: st.totalAddresses, TotalScopes: st.totalScopes }));
    } });
})();
