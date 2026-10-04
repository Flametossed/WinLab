/* Group Policy Preferences: WS.gpp. Preference items live in the GPO (g.prefs) and are written to SYSVOL as the real
 * XML files; the Group Policy client applies them when user policy is processed (sign-in, gpupdate, background refresh).
 * Built so far: Drive Maps (User Configuration > Preferences > Windows Settings > Drive Maps), with the Common tab's
 * options and item-level targeting (Security Group, User, Computer Name, Organizational Unit).
 *
 * State:
 *   g.prefs = { user: { drives: [item] } }   item (order = array index + 1):
 *     { uid '{GUID}', name 'S:', changed (ISO), disabled, action 'C'|'R'|'U'|'D', path '\\\\DC01\\Sales', label, persistent,
 *       useLetter (false = "Use first available, starting at" / "Delete all, starting at"), letter 'S', thisDrive / allDrives
 *       'NOCHANGE'|'HIDE'|'SHOW', userName, common: { stopOnError, userContext, removePolicy, applyOnce, targeting, description },
 *       filters: [{ type 'group'|'user'|'computer'|'ou', bool 'AND'|'OR', not, name, sid?, userContext?, directMember? }] }
 *   gp.pp = { once: [uid] (Apply once and do not reapply), tracked: [{ uid, gpo, letter }] (Remove this item when it is no
 *           longer applied), hideAll (Hide/Show all drives), last: { time, items: [{ ...item, gpoId, gpoName, result }] } }
 * Drives map through WS.netuse (fs.js), so net use, Get-PSDrive, Get-SmbMapping and File Explorer all see them. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util, G = WS.gpo;

  // gp.pp is filled in lazily (the gp slice belongs to gpo.js)
  const PP = () => { const gp = WS.state.gp; gp.pp = gp.pp || { once: [], tracked: [], hideAll: false, last: null }; return gp.pp; };

  const ACTIONS = { C: 'Create', R: 'Replace', U: 'Update', D: 'Delete' };
  const IMAGE = { C: 0, R: 1, U: 2, D: 3 };
  const HIDE_LABEL = { NOCHANGE: 'No change', HIDE: 'Hide', SHOW: 'Show' };
  const CLSID = { drives: '{8FDDCC1A-0C3C-43cd-A6B4-71A6DF20DA8C}', drive: '{935D1B74-9CB8-4e3c-9914-7DD559B7A417}' };
  const CSE = { drives: '{5794DAFD-BE60-433F-88A2-1A31939AC01F}' };
  const SOURCE = 'Group Policy Drive Maps';
  const ieq = (a, b) => String(a == null ? '' : a).toLowerCase() === String(b == null ? '' : b).toLowerCase();
  const now = () => new Date().toISOString();
  const fail = (code, error) => ({ ok: false, code, error });
  const clone = x => JSON.parse(JSON.stringify(x));
  const stamp = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

  /* ---------------------------------------------------------------- items */
  const prefsOf = (g, side = 'user') => { g.prefs = g.prefs || {}; g.prefs[side] = g.prefs[side] || {}; return g.prefs[side]; };
  const drivesOf = g => { const p = prefsOf(g); p.drives = p.drives || []; return p.drives; };
  const count = (g, side) => (g && g.prefs && g.prefs[side] ? Object.values(g.prefs[side]).reduce((n, list) => n + (list || []).length, 0) : 0);
  const defaults = () => ({ action: 'U', path: '', label: '', persistent: false, useLetter: true, letter: 'D', thisDrive: 'NOCHANGE', allDrives: 'NOCHANGE', userName: '', disabled: false,
    common: { stopOnError: false, userContext: false, removePolicy: false, applyOnce: false, targeting: false, description: '' }, filters: [] });
  const nameOf = it => `${it.letter}:`;
  function gpoOf(x) {
    const g = G.get(x);
    if (!g || G.isLocal(g)) return null;
    return g;
  }
  /** Validate and normalise a drive item (the New Drive Properties dialog runs the same checks). */
  function checkDrive(it) {
    if (!ACTIONS[it.action]) return 'The action is not valid.';
    if (it.action !== 'D' || it.useLetter) {
      if (!/^[A-Z]$/.test(it.letter)) return 'Select a drive letter.';
    }
    if (it.action !== 'D') {
      if (!String(it.path || '').trim()) return 'The location field cannot be empty.';
      if (!WS.netuse.uncParts(it.path)) return 'The location must be a UNC path, for example \\\\server\\share.';
    }
    if (!['NOCHANGE', 'HIDE', 'SHOW'].includes(it.thisDrive) || !['NOCHANGE', 'HIDE', 'SHOW'].includes(it.allDrives)) return 'The Hide/Show setting is not valid.';
    for (const f of it.filters || []) { const e = checkFilter(f); if (e) return e; }
    return null;
  }
  function normalize(src, base) {
    const it = { ...clone(base || defaults()), ...clone(src || {}) };
    it.common = { ...defaults().common, ...(base ? base.common : {}), ...((src || {}).common || {}) };
    it.action = String(it.action || 'U').charAt(0).toUpperCase();
    const fullAction = Object.keys(ACTIONS).find(k => ieq(ACTIONS[k], (src || {}).action));
    if (fullAction) it.action = fullAction;
    it.letter = String(it.letter || '').replace(/:$/, '').toUpperCase();
    it.path = String(it.path || '').trim().replace(/\//g, '\\');
    it.persistent = !!it.persistent; it.useLetter = it.useLetter !== false; it.disabled = !!it.disabled;
    it.thisDrive = String(it.thisDrive || 'NOCHANGE').toUpperCase(); it.allDrives = String(it.allDrives || 'NOCHANGE').toUpperCase();
    // "Remove this item when it is no longer applied" changes the action to Replace, as the editor does
    if (it.common.removePolicy) it.action = 'R';
    it.filters = (it.filters || []).map(normFilter);
    // filters given without saying otherwise switch item-level targeting on (as adding them in the Targeting Editor implies)
    if (src && src.filters && src.filters.length && !(src.common && 'targeting' in src.common)) it.common.targeting = true;
    it.name = nameOf(it);
    return it;
  }
  function touch(g) { G.touch(g, 'user'); }
  function newDrive(x, props = {}) {
    const g = gpoOf(x); if (!g) return fail('NotFound', `The GPO "${x && x.name ? x.name : x}" was not found.`);
    const it = normalize(props);
    const bad = checkDrive(it); if (bad) return fail('Invalid', bad);
    it.uid = '{' + U.guid().toUpperCase() + '}'; it.changed = now();
    drivesOf(g).push(it);
    touch(g);
    return { ok: true, item: it, order: drivesOf(g).length };
  }
  const find = (g, uid) => drivesOf(g).find(d => ieq(d.uid, uid) || ieq(d.name, uid)) || null;
  function setDrive(x, uid, props) {
    const g = gpoOf(x); if (!g) return fail('NotFound', 'The GPO was not found.');
    const cur = find(g, uid); if (!cur) return fail('NotFound', 'The preference item was not found.');
    const it = normalize(props, cur);
    const bad = checkDrive(it); if (bad) return fail('Invalid', bad);
    it.uid = cur.uid; it.changed = now();
    const list = drivesOf(g);
    list[list.indexOf(cur)] = it;
    touch(g);
    return { ok: true, item: it };
  }
  function removeDrive(x, uid) {
    const g = gpoOf(x); if (!g) return fail('NotFound', 'The GPO was not found.');
    const cur = find(g, uid); if (!cur) return fail('NotFound', 'The preference item was not found.');
    g.prefs.user.drives = drivesOf(g).filter(d => d !== cur);
    touch(g);
    return { ok: true };
  }
  /** Change an item's processing order (the editor's Move Up / Move Down, Order column). */
  function moveDrive(x, uid, delta) {
    const g = gpoOf(x); if (!g) return fail('NotFound', 'The GPO was not found.');
    const list = drivesOf(g), cur = find(g, uid); if (!cur) return fail('NotFound', 'The preference item was not found.');
    const i = list.indexOf(cur), j = Math.max(0, Math.min(list.length - 1, i + delta));
    if (i === j) return { ok: true, changed: false };
    list.splice(i, 1); list.splice(j, 0, cur);
    touch(g);
    return { ok: true, changed: true, order: j + 1 };
  }
  const setDisabled = (x, uid, on) => setDrive(x, uid, { disabled: !!on });

  /* ---------------------------------------------------------------- item-level targeting */
  const FILTER_TYPES = { group: 'Security Group', user: 'User', computer: 'Computer Name', ou: 'Organizational Unit' };
  function normFilter(f) {
    const o = { type: f.type, bool: String(f.bool || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND', not: !!f.not, name: String(f.name || '').trim() };
    if (o.type === 'group') { o.userContext = f.userContext !== false; const p = G.resolvePrincipal(o.name); if (p) { o.name = p.name; o.sid = p.sid; } else o.sid = f.sid || ''; }
    if (o.type === 'user') { const p = G.resolvePrincipal(o.name); if (p) { o.name = p.name; o.sid = p.sid; } else o.sid = f.sid || ''; }
    if (o.type === 'computer') o.name = o.name.toUpperCase().replace(/^\\\\/, '');
    if (o.type === 'ou') { o.userContext = f.userContext !== false; o.directMember = !!f.directMember; const ou = ouOf(o.name); if (ou) o.name = WS.ad.dn(ou); }
    return o;
  }
  function ouOf(name) {
    if (!WS.state.ad || !name) return null;
    const byDn = WS.ad.byDn(name);
    if (byDn) return byDn;
    return WS.ad.get(String(name).replace(/^.*\//, ''), 'organizationalUnit');
  }
  function checkFilter(f) {
    if (!FILTER_TYPES[f.type]) return 'The targeting item is not valid.';
    if (!f.name) return f.type === 'group' ? 'Enter a group.' : f.type === 'user' ? 'Enter a user.' : f.type === 'computer' ? 'Enter a computer name.' : 'Enter an organizational unit.';
    return null;
  }
  /** The Targeting Editor's line for an item: "the user is a member of the security group CONTOSO\\Sales Staff". */
  function filterText(f) {
    const is = f.not ? 'is not' : 'is';
    if (f.type === 'group') return `the ${f.userContext ? 'user' : 'computer'} ${is} a member of the security group ${f.name}`;
    if (f.type === 'user') return `the user ${is} ${f.name}`;
    if (f.type === 'computer') return `the computer name ${is} ${f.name}`;
    if (f.type === 'ou') return `the ${f.userContext ? 'user' : 'computer'} ${is} ${f.directMember ? 'a direct member of' : 'in'} the Organizational Unit ${f.name}`;
    return '';
  }
  const filtersText = list => list.map((f, i) => (i ? f.bool + ' ' : '') + filterText(f)).join(' ');
  /** ctx: { user, computer } AD objects (the session's user and this computer). Items are combined top to bottom. */
  function evalFilter(f, ctx) {
    let v = false;
    if (f.type === 'group') {
      const who = f.userContext ? ctx.user : ctx.computer;
      const sids = G.tokenSids(who);
      v = f.sid ? sids.has(f.sid) : false;
    } else if (f.type === 'user') v = !!ctx.user && (ieq(ctx.user.sid, f.sid) || ieq(`${WS.state.ad ? WS.state.ad.netbios : ''}\\${ctx.user.sam}`, f.name) || ieq(ctx.user.sam, f.name));
    else if (f.type === 'computer') v = ieq(f.name, WS.sys.name) || ieq(f.name, WS.sys.fqdn());
    else if (f.type === 'ou') {
      const who = f.userContext ? ctx.user : ctx.computer;
      const ou = ouOf(f.name);
      if (who && ou) {
        if (f.directMember) v = who.parentId === ou.id;
        else for (let p = WS.ad.byId(who.parentId); p; p = p.parentId ? WS.ad.byId(p.parentId) : null) if (p.id === ou.id) { v = true; break; }
      }
    }
    return f.not ? !v : v;
  }
  function targeted(it, ctx) {
    if (!it.common.targeting || !it.filters.length) return true;
    let res = evalFilter(it.filters[0], ctx);
    for (const f of it.filters.slice(1)) res = f.bool === 'OR' ? res || evalFilter(f, ctx) : res && evalFilter(f, ctx);
    return res;
  }

  /* ---------------------------------------------------------------- SYSVOL (Drives.xml) */
  const xa = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function filterXml(f) {
    const head = `bool="${f.bool}" not="${f.not ? 1 : 0}"`;
    if (f.type === 'group') return `<FilterGroup ${head} name="${xa(f.name)}" sid="${xa(f.sid)}" userContext="${f.userContext ? 1 : 0}" primaryGroup="0" localGroup="0"/>`;
    if (f.type === 'user') return `<FilterUser ${head} name="${xa(f.name)}" sid="${xa(f.sid)}"/>`;
    if (f.type === 'computer') return `<FilterComputer ${head} type="NETBIOS" name="${xa(f.name)}"/>`;
    return `<FilterOrgUnit ${head} name="${xa(f.name)}" userContext="${f.userContext ? 1 : 0}" directMember="${f.directMember ? 1 : 0}"/>`;
  }
  function drivesXml(g) {
    const list = drivesOf(g);
    if (!list.length) return null;
    const items = list.map(it => {
      const c = it.common;
      const attrs = [`clsid="${CLSID.drive}"`, `name="${xa(it.name)}"`, `status="${xa(it.name)}"`, `image="${IMAGE[it.action]}"`, `changed="${stamp(it.changed)}"`, `uid="${it.uid}"`,
        c.userContext ? 'userContext="1"' : '', c.removePolicy ? 'removePolicy="1"' : '', c.stopOnError ? '' : 'bypassErrors="1"', it.disabled ? 'disabled="1"' : '', c.description ? `desc="${xa(c.description)}"` : ''].filter(Boolean).join(' ');
      const props = `<Properties action="${it.action}" thisDrive="${it.thisDrive}" allDrives="${it.allDrives}" userName="${xa(it.userName)}" path="${xa(it.path)}" label="${xa(it.label)}" persistent="${it.persistent ? 1 : 0}" useLetter="${it.useLetter ? 1 : 0}" letter="${it.letter}"/>`;
      const filters = [...(c.targeting ? it.filters.map(filterXml) : []), ...(c.applyOnce ? [`<FilterRunOnce hidden="1" not="0" bool="AND" id="${it.uid}"/>`] : [])];
      return `<Drive ${attrs}>${props}${filters.length ? `<Filters>${filters.join('')}</Filters>` : ''}</Drive>`;
    });
    return `<?xml version="1.0" encoding="utf-8"?>\r\n<Drives clsid="${CLSID.drives}">${items.join('')}\r\n</Drives>\r\n`;
  }
  /** Called by WS.gpo's SYSVOL writer: <User>\Preferences\Drives\Drives.xml, or nothing when there are no items. */
  function writeSysvol(g, userDir) {
    const xml = drivesXml(g), dir = `${userDir}\\Preferences\\Drives`, file = `${dir}\\Drives.xml`;
    if (xml) { WS.fs.ensureDir(dir); WS.fs.writeFile(file, xml); }
    else if (WS.fs.exists(file)) { WS.fs.remove(file); for (const d of [dir, `${userDir}\\Preferences`]) { try { WS.fs.remove(d); } catch (e) { break; } } }
  }

  /* ---------------------------------------------------------------- processing (the Drive Maps client-side extension) */
  /** Items in processing order: GPOs from lowest to highest precedence (so the closest one wins), items in their order. */
  function itemsFor(rsSide) {
    const out = [];
    for (const e of rsSide.applied.slice().reverse()) {
      if (e.local || !e.gpo || !e.gpo.prefs) continue;
      drivesOf(e.gpo).forEach((it, i) => out.push({ ...clone(it), order: i + 1, gpoId: e.gpo.id, gpoName: e.gpo.name }));
    }
    return out;
  }
  const errText = r => `${r.hr} ${r.error}`;
  /** Apply one item. Returns { result: 'applied' | 'skipped' | 'filtered' | 'error', error }. */
  function applyItem(it, ctx) {
    const nu = WS.netuse;
    const mine = d => d && d.source === 'gpp' && ieq(d.uid, it.uid);
    if (it.action === 'D') {
      const letters = it.useLetter ? [it.letter] : nu.list().map(d => d.letter).filter(l => l >= it.letter);
      for (const l of letters) if (nu.get(l)) nu.disconnect(l);
      return { result: 'applied' };
    }
    const opts = { label: it.label, persistent: it.persistent, source: 'gpp', gpo: it.gpoId, uid: it.uid };
    const hide = d => { if (d && it.thisDrive !== 'NOCHANGE') nu.update(d.letter, { hidden: it.thisDrive === 'HIDE' }); };
    let letter = it.useLetter ? it.letter : null;
    if (!letter) {
      // "Use first available": a drive this item already mapped keeps its letter
      const prev = nu.list().find(mine) || nu.list().find(d => ieq(d.remote, it.path));
      if (prev && it.action === 'U') { nu.update(prev.letter, { label: it.label, persistent: it.persistent }); hide(prev); return { result: 'applied', letter: prev.letter }; }
      if (prev && it.action === 'R') nu.disconnect(prev.letter);
      const r = nu.connect('*', it.path, { ...opts, from: it.letter });
      if (!r.ok) return { result: 'error', error: r };
      hide(r.drive);
      return { result: 'applied', letter: r.letter };
    }
    const existing = nu.get(letter);
    if (existing && it.action === 'C') return { result: 'error', error: { ...nu.errors.InUse } };
    if (existing && it.action === 'U') {
      // Update keeps the existing connection (a different path is not remapped) and changes the item's other settings
      nu.update(letter, { label: it.label || existing.label, persistent: it.persistent, source: 'gpp', gpo: it.gpoId, uid: it.uid });
      hide(existing);
      return { result: 'applied', letter };
    }
    if (existing && it.action === 'R') nu.disconnect(letter);
    const r = nu.connect(letter, it.path, opts);
    if (!r.ok) return { result: 'error', error: r };
    hide(r.drive);
    return { result: 'applied', letter };
  }
  /** Run the Drive Maps extension for the user's resultant GPOs. rsSide: WS.gpo.rsop().user. Returns { events, items }. */
  function applyUser(rsSide, o = {}) {
    const pp = PP();
    const ctx = { user: rsSide.target, computer: G.thisComputer() };
    const items = itemsFor(rsSide);
    const events = [];
    const results = [];
    const seen = new Set();
    let hideAll = null, warnings = 0, stopped = new Set();
    for (const it of items) {
      if (it.disabled) { results.push({ ...it, result: 'disabled' }); continue; }
      if (stopped.has(it.gpoId)) { results.push({ ...it, result: 'skipped' }); continue; }
      if (!targeted(it, ctx)) { results.push({ ...it, result: 'filtered' }); continue; }
      seen.add(it.uid);
      if (it.common.applyOnce && pp.once.includes(it.uid)) { results.push({ ...it, result: 'once' }); continue; }
      const r = applyItem(it, ctx);
      if (r.result === 'error') {
        warnings++;
        const stop = it.common.stopOnError;
        events.push({ log: 'Application', id: 4098, level: stop ? 'Error' : 'Warning', source: SOURCE,
          message: `The user '${it.name}' preference item in the '${it.gpoName} {${it.gpoId.replace(/^\{|\}$/g, '')}}' Group Policy Object did not apply because it failed with error code '${errText(r.error)}'${stop ? ' This error was not suppressed.' : ' This error was suppressed.'}` });
        if (stop) stopped.add(it.gpoId);
        results.push({ ...it, result: 'error', error: errText(r.error) });
        continue;
      }
      if (it.common.applyOnce && !pp.once.includes(it.uid)) pp.once.push(it.uid);
      if (it.common.removePolicy && r.letter) { pp.tracked = pp.tracked.filter(x => !ieq(x.uid, it.uid)); pp.tracked.push({ uid: it.uid, gpo: it.gpoId, letter: r.letter }); }
      if (it.allDrives !== 'NOCHANGE') hideAll = it.allDrives === 'HIDE';
      results.push({ ...it, result: 'applied', letter: r.letter });
    }
    // "Remove this item when it is no longer applied": the GPO stopped applying, the item was deleted or targeting failed
    for (const t of pp.tracked.slice()) {
      if (seen.has(t.uid)) continue;
      const d = WS.netuse.get(t.letter);
      if (d && d.source === 'gpp' && ieq(d.uid, t.uid)) WS.netuse.disconnect(t.letter);
      pp.tracked = pp.tracked.filter(x => x !== t);
    }
    if (hideAll !== null) pp.hideAll = hideAll;
    pp.last = { time: now(), items: results };
    const gpoNames = [...new Set(items.map(i => i.gpoName))];
    if (items.length || o.reason === 'manual') {
      const op = 'Microsoft-Windows-GroupPolicy/Operational', src = 'Microsoft-Windows-GroupPolicy';
      if (items.length) {
        events.unshift({ log: op, id: 4016, source: src, message: `Starting ${SOURCE} Extension Processing.\n\nList of applicable Group Policy objects: (${o.changed ? 'Changes were detected.' : 'No changes were detected.'})\n\n${gpoNames.join('\n')}` });
        events.push({ log: op, id: warnings ? (stopped.size ? 7016 : 6016) : 5016, level: warnings ? (stopped.size ? 'Error' : 'Warning') : undefined, source: src,
          message: `Completed ${SOURCE} Extension Processing in ${12 + items.length * 7} milliseconds.` });
      }
    }
    WS.store.changed('gp'); WS.store.changed('netuse');
    return { events, items: results };
  }
  /** Hide/Show all drives (NoDrives for every letter) from the last processing. */
  const hideAll = () => !!(WS.state.gp && WS.state.gp.pp && WS.state.gp.pp.hideAll);

  /* ---------------------------------------------------------------- reports */
  const yn = b => (b ? 'Yes' : 'No');
  /** Rows the HTML report shows for one item (General / Common). */
  function reportItem(it) {
    const props = [['Location', it.action === 'D' ? '' : it.path], ['Reconnect', it.persistent ? 'Enabled' : 'Disabled'], ['Label as', it.label],
      [it.useLetter ? 'Use' : (it.action === 'D' ? 'Delete all, starting at' : 'Use first available, starting at'), it.letter], ['Connect as', it.userName],
      ['Hide/Show this drive', HIDE_LABEL[it.thisDrive] === 'No change' ? 'No change' : `${HIDE_LABEL[it.thisDrive]} this drive`],
      ['Hide/Show all drives', HIDE_LABEL[it.allDrives] === 'No change' ? 'No change' : `${HIDE_LABEL[it.allDrives]} all drives`]];
    const c = it.common;
    const common = [['Stop processing items on this extension if an error occurs on this item', yn(c.stopOnError)], ["Run in logged-on user's security context (user policy option)", yn(c.userContext)],
      ['Remove this item when it is no longer applied', yn(c.removePolicy)], ['Apply once and do not reapply', yn(c.applyOnce)]];
    return { title: `Drive Map (Drive: ${it.letter})`, head: `${it.name} (Order: ${it.order || 1})`, action: ACTIONS[it.action], props, common, filters: c.targeting && it.filters.length ? filtersText(it.filters) : '', description: c.description, disabled: it.disabled };
  }

  WS.gpp = {
    ACTIONS, HIDE_LABEL, FILTER_TYPES, CSE, CLSID, defaults, normalize, checkDrive,
    drives: x => { const g = gpoOf(x); return g ? drivesOf(g).map((d, i) => ({ ...d, order: i + 1 })) : []; },
    drive: (x, uid) => { const g = gpoOf(x); return g ? find(g, uid) : null; },
    newDrive, setDrive, removeDrive, moveDrive, setDisabled, count,
    filterText, filtersText, evalFilter, targeted, normFilter, checkFilter,
    drivesXml, writeSysvol, itemsFor, applyUser, hideAll, reportItem,
    /** The items the last user policy processing ran, with their results (Group Policy Results, the lab checks). */
    last: () => (WS.state.gp && WS.state.gp.pp && WS.state.gp.pp.last) || null,
    /** Copy g.prefs between GPOs (Copy, backup, restore, import). */
    clonePrefs: g => clone((g && g.prefs) || {})
  };
})();
