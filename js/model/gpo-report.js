/* Group Policy reports: the HTML that GPMC's Settings tab, Save Report..., Get-GPOReport and gpresult /h produce,
 * and the XML of Get-GPOReport -ReportType Xml. Adds to WS.gpo:
 *   reportBody(gpo) / reportHtml(gpo)         a GPO's settings report (body fragment / standalone document)
 *   rsopBody(rs, o) / rsopHtml(rs, o)          a Group Policy Results / Modeling report for WS.gpo.rsop() output
 *   reportXml(gpo), rsopXml(rs)                XML reports
 *   settingRows(gpo | settings, side)          [{ category, def, value, gpoName }] grouped as the reports list them
 * Sections toggle with elements marked data-gprep-toggle (the console wires the clicks; saved files carry a small script). */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util, G = WS.gpo, CAT = WS.gpoCatalog;
  const esc = s => U.esc(s == null ? '' : String(s));
  const when = d => `${U.fmtDate(new Date(d))} ${U.fmtTime(new Date(d), true)}`;

  const CSS = `.gprep{font:12px "Segoe UI",Tahoma,sans-serif;color:#000;background:#fff;padding:8px 12px 24px}
.gprep .gp-title{font-size:20px;font-weight:600;margin:4px 0 2px}.gprep .gp-sub{color:#555;margin-bottom:10px;display:flex;justify-content:space-between}
.gprep .gp-sec{margin:6px 0 0}.gprep .gp-h{display:flex;justify-content:space-between;align-items:center;padding:3px 6px;font-weight:600;cursor:pointer;user-select:none}
.gprep .gp-h1{background:#4169a8;color:#fff;font-size:13px}.gprep .gp-h2{background:#c5d4ea;color:#000}.gprep .gp-h3{background:#e5ebf5;color:#000;font-weight:600}
.gprep .gp-h4{color:#000;font-weight:600;padding-left:2px;border-bottom:1px solid #d8d8d8;cursor:pointer}.gprep .gp-tog{font-weight:normal;font-size:11px;text-decoration:underline;color:inherit}
.gprep .gp-body{padding:4px 0 6px 14px}.gprep .gp-sec.closed>.gp-body{display:none}
.gprep table{border-collapse:collapse;margin:3px 0 8px;min-width:420px}.gprep th{text-align:left;font-weight:600;padding:2px 14px 2px 4px;border-bottom:1px solid #c8c8c8;white-space:nowrap}
.gprep td{padding:2px 14px 2px 4px;vertical-align:top}.gprep .gp-kv td:first-child{color:#333;white-space:nowrap;width:180px}.gprep .gp-none{color:#555;padding:2px 4px}
.gprep .gp-opts{margin:2px 0 6px 18px}.gprep .gp-note{color:#555}`;

  const sec = (level, title, body, o = {}) => `<div class="gp-sec${o.closed ? ' closed' : ''}"><div class="gp-h gp-h${level}" data-gprep-toggle="1"><span>${esc(title)}</span><span class="gp-tog">${o.closed ? 'show' : 'hide'}</span></div><div class="gp-body">${body}</div></div>`;
  const kv = rows => `<table class="gp-kv">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const table = (cols, rows) => `<table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;

  /** Rows for a side, from a GPO or from RSoP settings ({ key: { value, gpoName } }). */
  function settingRows(src, side) {
    const out = [];
    const isRsop = !src.id && !src.computer;
    const entries = isRsop ? Object.entries(src) : Object.entries(src[side] || {});
    for (const [k, raw] of entries) {
      const def = G.definition(side, k);
      if (!def) continue;
      const value = isRsop ? raw.value : raw;
      out.push({ key: k, def, value, gpoName: isRsop ? raw.gpoName : src.name, category: def.kind === 'service' ? 'System Services' : CAT.category(def) });
    }
    const order = new Map(CAT.settings.map((s, i) => [s.side + ':' + s.key, i]));
    return out.sort((a, b) => (order.has(side + ':' + a.key) ? order.get(side + ':' + a.key) : 1e6) - (order.has(side + ':' + b.key) ? order.get(side + ':' + b.key) : 1e6) || a.def.name.localeCompare(b.def.name));
  }
  /** "Windows Settings > Security Settings > ..." and "Administrative Templates" blocks for one side. */
  function settingsBlocks(rows, extraReg, withGpo) {
    const sec4 = (title, body) => sec(4, title, body);
    const secRows = rows.filter(r => r.def.group === 'security'), adm = rows.filter(r => r.def.kind === 'policy');
    const cols = withGpo ? ['Policy', 'Setting', 'Winning GPO'] : ['Policy', 'Setting'];
    let html = '';
    if (secRows.length) {
      const byCat = groupBy(secRows, r => r.category);
      let inner = '';
      for (const [cat, list] of byCat) {
        if (cat === 'System Services') inner += sec4(cat, table(withGpo ? ['Service Name', 'Startup Mode', 'Winning GPO'] : ['Service Name', 'Startup Mode'], list.map(r => [r.def.service, r.value, ...(withGpo ? [r.gpoName] : [])])));
        else inner += sec4(cat, table(cols, list.map(r => [r.def.name, G.display(r.def, r.value), ...(withGpo ? [r.gpoName] : [])])));
      }
      html += sec(3, 'Windows Settings', sec(3, 'Security Settings', inner));
    }
    if (adm.length || (extraReg && extraReg.length)) {
      let inner = adm.length ? '<div class="gp-note">Policy definitions (ADMX files) retrieved from the local computer.</div>' : '';
      for (const [cat, list] of groupBy(adm, r => r.category)) {
        const body = list.map(r => {
          const opts = r.value.state === 'Enabled' ? r.def.options.map(op => {
            const v = r.value.options[op.id];
            const shown = op.type === 'check' ? (v ? 'Enabled' : 'Disabled') : op.type === 'select' ? ((op.choices.find(c => c.value === v) || {}).label || v) : op.type === 'list' ? (v || []).join('; ') : v;
            return `<tr><td>${esc(op.label.replace(/:$/, ''))}</td><td>${esc(shown)}</td></tr>`;
          }).join('') : '';
          return `<table><tr><th>Policy</th><th>Setting</th><th>Comment</th>${withGpo ? '<th>Winning GPO</th>' : ''}</tr><tr><td>${esc(r.def.name)}</td><td>${esc(r.value.state)}</td><td>${esc(r.value.comment || '')}</td>${withGpo ? `<td>${esc(r.gpoName)}</td>` : ''}</tr></table>${opts ? `<table class="gp-opts gp-kv">${opts}</table>` : ''}`;
        }).join('');
        inner += sec(4, cat, body);
      }
      if (extraReg && extraReg.length) inner += sec(4, 'Extra Registry Settings', '<div class="gp-note">Display names for some settings cannot be found. You might be able to resolve this issue by updating the .ADM files used by Group Policy Management.</div>' + table(withGpo ? ['Setting', 'Value', 'Winning GPO'] : ['Setting', 'Value'], extraReg.map(e => [`${e.key}\\${e.value}`, e.data, ...(withGpo ? [e.gpoName] : [])])));
      html += sec(3, 'Administrative Templates', inner);
    }
    return html ? sec(2, 'Policies', html) : NONE;
  }
  /** Preferences > Windows Settings > Drive Maps, as GPMC lists preference items (one block per item). */
  function prefsBlock(items, withGpo) {
    if (!WS.gpp || !items.length) return '';
    const body = items.map(it => {
      const r = WS.gpp.reportItem(it);
      const general = `<table class="gp-kv"><tr><td>Action</td><td>${esc(r.action)}</td></tr></table><div class="gp-note"><b>Properties</b></div>${kv(r.props)}`;
      const common = `<div class="gp-note"><b>Options</b></div>${kv(r.common)}${r.filters ? kv([['Filters', r.filters]]) : ''}${r.description ? kv([['Description', r.description]]) : ''}`;
      return sec(4, r.title + (r.disabled ? ' (Disabled)' : ''), `<div><b>${esc(r.head)}</b></div>${withGpo ? kv([['Winning GPO', it.gpoName]]) : ''}${sec(4, 'General', general)}${sec(4, 'Common', common)}`);
    }).join('');
    return sec(2, 'Preferences', sec(3, 'Windows Settings', sec(3, 'Drive Maps', body)));
  }
  const NONE = '<div class="gp-none">No settings defined.</div>';
  const withPrefs = (pol, pre) => (pre ? (pol === NONE ? pre : pol + pre) : pol);
  function groupBy(list, f) { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
  const wrap = (title, body) => `<!DOCTYPE html>\r\n<html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body style="margin:0">${body}<script>document.addEventListener('click',function(e){var h=e.target.closest('[data-gprep-toggle]');if(h){var s=h.parentNode;s.classList.toggle('closed');h.querySelector('.gp-tog').textContent=s.classList.contains('closed')?'show':'hide';}var a=e.target.closest('[data-gprep-all]');if(a){var c=a.textContent==='hide all';document.querySelectorAll('.gp-sec').forEach(function(x){x.classList.toggle('closed',c);x.querySelector('.gp-tog').textContent=c?'show':'hide';});a.textContent=c?'show all':'hide all';}});</script></body></html>\r\n`;

  /* ---------------------------------------------------------------- GPO report */
  function reportBody(x) {
    const g = G.get(x); if (!g) return '';
    const ad = WS.state.ad;
    const links = G.links(g);
    const general = sec(2, 'Details', kv([
      ['Domain', ad.domain], ['Owner', G.principal(g.owner).name], ['Created', when(g.created)], ['Modified', when(g.modified)],
      ['User Revisions', `${g.userVersion} (AD), ${g.userVersion} (SYSVOL)`], ['Computer Revisions', `${g.computerVersion} (AD), ${g.computerVersion} (SYSVOL)`],
      ['Unique ID', g.id], ['GPO Status', G.statusLabel(g.status)]])) +
      sec(2, 'Links', links.length ? table(['Location', 'Enforced', 'Link Status', 'Path'], links.map(l => [G.somName(l.som), l.enforced ? 'Yes' : 'No', l.enabled ? 'Enabled' : 'Disabled', G.somPath(l.som)])) : '<div class="gp-none">None</div>') +
      sec(2, 'Security Filtering', '<div class="gp-note">The settings in this GPO can only apply to the following groups, users, and computers:</div>' + table(['Name'], G.filtering(g).map(p => [p.name]))) +
      sec(2, 'Delegation', '<div class="gp-note">These groups and users have the specified permission for this GPO</div>' + table(['Name', 'Allowed Permissions', 'Inherited'], G.permissions(g).map(p => [p.name, p.label, 'No']))) +
      (g.wmiFilter ? sec(2, 'WMI Filtering', kv([['WMI Filter Name', (G.wmiFilter(g.wmiFilter) || {}).name || ''], ['Description', (G.wmiFilter(g.wmiFilter) || {}).description || '']])) : '');
    const prefItems = s => (s === 'user' && WS.gpp ? WS.gpp.drives(g) : []);
    const side = (s, label) => sec(1, `${label} (${G.sideOn(g, s) ? 'Enabled' : 'Disabled'})`, withPrefs(settingsBlocks(settingRows(g, s), (g.registry || {})[s], false), prefsBlock(prefItems(s), false)));
    return `<div class="gprep"><div class="gp-title">${esc(g.name)}</div><div class="gp-sub"><span>Data collected on: ${esc(when(new Date()))}</span><a class="gp-tog" data-gprep-all="1">hide all</a></div>` +
      sec(1, 'General', general) + side('computer', 'Computer Configuration') + side('user', 'User Configuration') + '</div>';
  }

  /* ---------------------------------------------------------------- RSoP report */
  /** o: { title, only: 'summary' | 'settings' } */
  function rsopBody(rs, o = {}) {
    const ad = WS.state.ad;
    const part = (s, label) => {
      const r = rs[s];
      if (!r) return '';
      const general = kv([[s === 'computer' ? 'Computer name' : 'User name', s === 'computer' ? (ad ? `${ad.netbios}\\${r.target ? r.target.name : WS.sys.name}` : WS.sys.name) : (r.target && ad ? `${ad.netbios}\\${r.target.sam}` : `${WS.sys.name}\\Administrator`)],
        ['Domain', ad ? ad.domain : 'WORKGROUP'], ['Site', 'Default-First-Site-Name'], ['Organizational Unit', r.dn ? r.dn.split(',').slice(1).filter(p => !/^DC=/i.test(p)).map(p => p.replace(/^\w+=/, '')).reverse().join('/') || (ad ? ad.domain : '') : ''],
        ['Security Group Membership', 'show']]).replace('<td>show</td>', `<td>${esc(r.groups.join(', '))}</td>`);
      const gpos = sec(3, 'Applied GPOs', r.applied.length ? r.applied.map(e => `<table class="gp-kv"><tr><td colspan="2"><b>${esc(e.name)}</b> [${esc(e.local ? 'Local' : e.id)}]</td></tr><tr><td>Link Location</td><td>${esc(e.local ? 'Local' : e.somPath)}</td></tr><tr><td>Extensions Configured</td><td>${esc(extensions(e.gpo, s).join(', ') || 'None')}</td></tr><tr><td>Enforced</td><td>${(e.link && e.link.enforced) || e.enforced ? 'Yes' : 'No'}</td></tr><tr><td>Disabled</td><td>None</td></tr><tr><td>Security Filter</td><td>${esc(e.local || !e.gpo.acl.length ? '' : G.filtering(e.gpo).map(p => p.name).join(', '))}</td></tr><tr><td>Revision</td><td>AD (${e.gpo[s === 'user' ? 'userVersion' : 'computerVersion']}), SYSVOL (${e.gpo[s === 'user' ? 'userVersion' : 'computerVersion']})</td></tr><tr><td>WMI Filter</td><td>${esc(e.gpo.wmiFilter ? (G.wmiFilter(e.gpo.wmiFilter) || {}).name : '')}</td></tr></table>`).join('') : '<div class="gp-none">None</div>') +
        sec(3, 'Denied GPOs', r.filtered.length ? table(['Name', 'Link Location', 'Reason Denied'], r.filtered.map(e => [e.name, e.local ? 'Local' : e.somPath, e.reason])) : '<div class="gp-none">None</div>');
      const status = sec(3, 'Component Status', table(['Component Name', 'Status'], [['Group Policy Infrastructure', 'Success'], ...extensionsAll(r, s).map(x => [x, 'Success'])]));
      const summary = o.only === 'settings' ? '' : sec(2, 'Summary', sec(3, 'General', general) + sec(3, 'Group Policy Objects', gpos) + status);
      // preference items: what the last processing applied (Results), or every item in the applied GPOs (Modeling)
      const last = WS.gpp && WS.gpp.last();
      const prefs = s !== 'user' || !WS.gpp ? [] : r.time && last ? last.items.filter(i => i.result === 'applied' || i.result === 'once') : WS.gpp.itemsFor(r).filter(i => !i.disabled);
      const settings = o.only === 'summary' ? '' : sec(2, 'Settings', withPrefs(settingsBlocks(settingRows(r.settings, s), r.registry, true), prefsBlock(prefs, true)));
      return sec(1, label, summary + settings);
    };
    const title = o.title || 'Group Policy Results';
    return `<div class="gprep"><div class="gp-title">${esc(title)}</div><div class="gp-sub"><span>Data collected on: ${esc(when(new Date()))}</span><a class="gp-tog" data-gprep-all="1">hide all</a></div>` +
      part('computer', 'Computer Details') + part('user', 'User Details') + '</div>';
  }
  function extensions(g, side) {
    const out = new Set();
    for (const k of Object.keys((g || {})[side] || {})) { const d = G.definition(side, k); if (d) out.add(d.kind === 'policy' ? 'Registry' : 'Security'); }
    if (((g || {}).registry || {})[side] && g.registry[side].length) out.add('Registry');
    if (WS.gpp && g && g.prefs && WS.gpp.count(g, side)) out.add('Drive Maps');
    return [...out].sort();
  }
  const extensionsAll = (r, s) => [...new Set(r.applied.flatMap(e => extensions(e.gpo, s)))].sort();

  /* ---------------------------------------------------------------- XML */
  const xesc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function drivesXml(items) {
    if (!items.length) return '';
    const ga = s => xesc(s);
    let x = '    <ExtensionData>\r\n      <Extension xmlns:q3="http://www.microsoft.com/GroupPolicy/Settings/DriveMaps" xsi:type="q3:DriveMapSettings">\r\n        <q3:DriveMapSettings clsid="' + WS.gpp.CLSID.drives + '">\r\n';
    for (const it of items) {
      x += `          <q3:Drive clsid="${WS.gpp.CLSID.drive}" name="${ga(it.name)}" status="${ga(it.name)}" image="${{ C: 0, R: 1, U: 2, D: 3 }[it.action]}" uid="${it.uid}"${it.common.stopOnError ? '' : ' bypassErrors="1"'}${it.common.removePolicy ? ' removePolicy="1"' : ''}${it.disabled ? ' disabled="1"' : ''}>` +
        `<q3:GPOSettingOrder>${it.order}</q3:GPOSettingOrder><q3:Properties action="${it.action}" thisDrive="${it.thisDrive}" allDrives="${it.allDrives}" userName="${ga(it.userName)}" path="${ga(it.path)}" label="${ga(it.label)}" persistent="${it.persistent ? 1 : 0}" useLetter="${it.useLetter ? 1 : 0}" letter="${it.letter}" />` +
        (it.common.targeting && it.filters.length ? `<q3:Filters>${it.filters.map(f => `<q3:Filter${{ group: 'Group', user: 'User', computer: 'Computer', ou: 'OrgUnit' }[f.type]} bool="${f.bool}" not="${f.not ? 1 : 0}" name="${ga(f.name)}" />`).join('')}</q3:Filters>` : '') + '</q3:Drive>\r\n';
    }
    return x + '        </q3:DriveMapSettings>\r\n      </Extension>\r\n      <Name>Drive Maps</Name>\r\n    </ExtensionData>\r\n';
  }
  function sideXml(rows, extra, side, enabled, version, prefs = []) {
    const sec = rows.filter(r => r.def.group === 'security'), adm = rows.filter(r => r.def.kind === 'policy');
    let x = `  <${side}>\r\n    <VersionDirectory>${version}</VersionDirectory>\r\n    <VersionSysvol>${version}</VersionSysvol>\r\n    <Enabled>${enabled}</Enabled>\r\n`;
    if (sec.length) {
      x += '    <ExtensionData>\r\n      <Extension xmlns:q1="http://www.microsoft.com/GroupPolicy/Settings/Security" xsi:type="q1:SecuritySettings">\r\n';
      for (const r of sec) {
        const v = r.def.kind === 'accounts' ? r.value.map(a => `<q1:Member><Name xmlns="http://www.microsoft.com/GroupPolicy/Types">${xesc(a)}</Name></q1:Member>`).join('') : `<q1:SettingValue>${xesc(typeof r.value === 'boolean' ? (r.value ? 'true' : 'false') : G.display(r.def, r.value))}</q1:SettingValue>`;
        x += `        <q1:Setting><q1:Name>${xesc(r.def.inf ? r.def.inf[1] : r.key)}</q1:Name><q1:DisplayName>${xesc(r.def.name)}</q1:DisplayName>${v}</q1:Setting>\r\n`;
      }
      x += '      </Extension>\r\n      <Name>Security</Name>\r\n    </ExtensionData>\r\n';
    }
    if (adm.length || (extra && extra.length)) {
      x += '    <ExtensionData>\r\n      <Extension xmlns:q2="http://www.microsoft.com/GroupPolicy/Settings/Registry" xsi:type="q2:RegistrySettings">\r\n';
      for (const r of adm) x += `        <q2:Policy><q2:Name>${xesc(r.def.name)}</q2:Name><q2:State>${r.value.state}</q2:State><q2:Explain>${xesc(r.def.explain)}</q2:Explain><q2:Supported>${xesc(r.def.supported)}</q2:Supported><q2:Category>${xesc(r.category)}</q2:Category></q2:Policy>\r\n`;
      for (const e of extra || []) x += `        <q2:RegistrySetting><q2:KeyPath>${xesc(e.key)}</q2:KeyPath><q2:Value><q2:Name>${xesc(e.value)}</q2:Name><q2:Number>${xesc(e.data)}</q2:Number></q2:Value></q2:RegistrySetting>\r\n`;
      x += '      </Extension>\r\n      <Name>Registry</Name>\r\n    </ExtensionData>\r\n';
    }
    x += drivesXml(prefs);
    return x + `  </${side}>\r\n`;
  }
  function reportXml(x) {
    const g = G.get(x); if (!g) return '';
    const ad = WS.state.ad;
    return `<?xml version="1.0" encoding="utf-16"?>\r\n<GPO xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.microsoft.com/GroupPolicy/Settings">\r\n` +
      `  <Identifier>\r\n    <Identifier xmlns="http://www.microsoft.com/GroupPolicy/Types">${g.id}</Identifier>\r\n    <Domain xmlns="http://www.microsoft.com/GroupPolicy/Types">${ad.domain}</Domain>\r\n  </Identifier>\r\n` +
      `  <Name>${xesc(g.name)}</Name>\r\n  <IncludeComments>true</IncludeComments>\r\n  <CreatedTime>${g.created}</CreatedTime>\r\n  <ModifiedTime>${g.modified}</ModifiedTime>\r\n  <ReadTime>${new Date().toISOString()}</ReadTime>\r\n` +
      `  <SecurityDescriptor>\r\n    <Owner xmlns="http://www.microsoft.com/GroupPolicy/Types/Security"><Name xmlns="http://www.microsoft.com/GroupPolicy/Types">${xesc(G.principal(g.owner).name)}</Name></Owner>\r\n  </SecurityDescriptor>\r\n  <FilterDataAvailable>true</FilterDataAvailable>\r\n` +
      sideXml(settingRows(g, 'computer'), g.registry.computer, 'Computer', G.sideOn(g, 'computer'), g.computerVersion) +
      sideXml(settingRows(g, 'user'), g.registry.user, 'User', G.sideOn(g, 'user'), g.userVersion, WS.gpp ? WS.gpp.drives(g) : []) +
      G.links(g).map(l => `  <LinksTo>\r\n    <SOMName>${xesc(G.somName(l.som))}</SOMName>\r\n    <SOMPath>${xesc(G.somPath(l.som))}</SOMPath>\r\n    <Enabled>${l.enabled}</Enabled>\r\n    <NoOverride>${l.enforced}</NoOverride>\r\n  </LinksTo>\r\n`).join('') +
      '</GPO>\r\n';
  }
  function rsopXml(rs) {
    const side = (s, tag) => {
      const r = rs[s]; if (!r) return '';
      return `  <${tag}>\r\n    <Name>${xesc(r.target ? r.target.name : WS.sys.name)}</Name>\r\n` +
        r.applied.map(e => `    <GPO><Name>${xesc(e.name)}</Name><Path><Identifier xmlns="http://www.microsoft.com/GroupPolicy/Types">${e.local ? 'LocalGPO' : e.id}</Identifier></Path><IsValid>true</IsValid><FilterAllowed>true</FilterAllowed><AccessDenied>false</AccessDenied><Link><SOMPath>${xesc(e.somPath)}</SOMPath></Link></GPO>\r\n`).join('') +
        r.filtered.map(e => `    <GPO><Name>${xesc(e.name)}</Name><FilterAllowed>false</FilterAllowed><Reason>${xesc(e.reason)}</Reason></GPO>\r\n`).join('') +
        `  </${tag}>\r\n`;
    };
    return `<?xml version="1.0" encoding="utf-16"?>\r\n<Rsop xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.microsoft.com/GroupPolicy/Rsop">\r\n  <ReadTime>${new Date().toISOString()}</ReadTime>\r\n  <DataType>LoggedOnUser</DataType>\r\n${side('computer', 'ComputerResults')}${side('user', 'UserResults')}</Rsop>\r\n`;
  }

  Object.assign(G, {
    reportCss: CSS, reportBody, reportHtml: x => { const g = G.get(x); return g ? wrap(g.name, reportBody(g)) : ''; },
    rsopBody, rsopHtml: (rs, o = {}) => wrap(o.title || 'Group Policy Results', rsopBody(rs, o)), reportXml, rsopXml, settingRows
  });
})();
