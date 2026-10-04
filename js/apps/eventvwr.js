/* Event Viewer (eventvwr.msc) on the MMC frame (actionsPane: 'full', as MMC 3.0 snap-ins show it).
 * Tree: Event Viewer (Local) > Custom Views (Server Roles, Administrative Events, user views), Windows Logs,
 * Applications and Services Logs (with Microsoft > Windows), Saved Logs, Subscriptions. The root shows Overview and Summary.
 * Log and custom view nodes list events (header line + preview pane with General / Details, Friendly or XML View); a filter
 * stays on its node until Clear Filter. Logs are read, filtered and cleared only through WS.evt, so Clear-EventLog,
 * Write-EventLog and Limit-EventLog in PowerShell and this console always agree, and new events appear live.
 * Every dialog takes opts.onCreate(obj) with the live object, and works with no console open.
 *   WS.eventvwr.snapin({ label, path }) -> { ctl, nodes, viewMenu }: the same tree for another console (Computer Management
 *       hosts it under System Tools); the host calls ctl.attach(mmc) after creating its console. TOPICS: its refresh topics.
 *   WS.eventvwr.launch({ select }) -> win; win.eventvwr = controller { mmc, select(nodeId | log), info(nodeId), filters, setFilter(id, f),
 *       clearFilter(id), filterCurrent(opts), clearLog(opts), properties(opts), find(opts), findNext(text), saveAll(opts),
 *       saveSelected(opts), openEvent(entry, opts), createCustomView(opts), importCustomView(opts), openSavedLog(opts), setPreview(bool) }
 *   WS.eventvwr.eventProperties(log, record, opts) -> Promise. opts.rows: entries (or () => entries) the arrows walk (default:
 *       the whole log, newest first); opts.onNavigate(entry); opts.tab 'General' | 'Details'; opts.mode 'friendly' | 'xml';
 *       onCreate(dlg { frame, entry, next(), prev(), tab(name), mode(m), copy(), close() }).
 *   filterLog(log | logs[], opts) -> Promise<filter | null>  (opts.filter, opts.mode 'filter' | 'create', opts.title)
 *   clearLog(log, opts) -> Promise<'cleared' | 'saved' | null>   (opts.onPicker / onDisplayInfo for the Save and Clear path)
 *   logProperties(log, opts) -> Promise<boolean>;  saveEvents(entries, opts) -> Promise<path | null> (opts.onPicker | onCreate: the Save As picker)
 *   createCustomView(opts), importCustomView(opts), exportCustomView(view, opts), openSavedLog(opts), find(controller, opts)
 *   Helpers shared with other consoles (DNS Manager's DNS Events): columns(log), rowIcon(log), levelText(e), eventText(e), eventXml(e),
 *   copyText(text), clipboard (last copied text). */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, E = WS.evt;
  const TITLE = 'Event Viewer';
  let seq = 0;
  const uid = p => `${p}-${++seq}`;

  /* ---------------------------------------------------------------- icons (16-unit, no ids) */
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const SHEET = '<rect x="2.5" y="1.5" width="10" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 4.5h6M4.5 7h6M4.5 9.5h4" stroke="#8a97a6"/>';
  const FOLDER = '<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder-back)"/><path d="M1 6h14v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder)"/>';
  const FUNNEL = '<path d="M8 8.5h7.5l-2.9 3.3v3.2l-1.7-.9v-2.3z" fill="url(#wsg-blue)" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/>';
  const IC = {
    app: s16(SHEET + '<path d="M11.6 7.6l4 7.1H7.6z" fill="#f7c600" stroke="#b58900" stroke-width=".6" stroke-linejoin="round"/><path d="M11.6 10.1v2.3" stroke="#1b1b1b" stroke-width="1.1"/><circle cx="11.6" cy="13.5" r=".6" fill="#1b1b1b"/>'),
    view: s16(SHEET + FUNNEL),
    views: s16(FOLDER + FUNNEL),
    subs: s16(SHEET + '<circle cx="11.8" cy="11.8" r="3.7" fill="url(#wsg-green)"/><path d="M9.9 11.8h3.6M12.2 10.2l1.6 1.6-1.6 1.6" fill="none" stroke="#fff" stroke-width="1.1"/>'),
    saved: s16(SHEET + '<rect x="8.5" y="8.5" width="7" height="7" rx=".8" fill="#2f7fd8"/><rect x="10" y="8.5" width="4" height="2.6" fill="#fff"/><rect x="9.8" y="12.4" width="4.4" height="3.1" fill="#dbe9f9"/>'),
    open: s16('<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H13a1 1 0 0 1 1 1V7H1z" fill="url(#wsg-folder-back)"/><path d="M3 7h12.3l-2 6.3a1 1 0 0 1-1 .7H1.5L1 13z" fill="url(#wsg-folder)"/>'),
    create: s16(SHEET + '<path d="M12 7.8l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="#f2b631" stroke="#c98a00" stroke-width=".4"/>'),
    import: s16(SHEET + '<path d="M15.5 12H9.3M11.6 9.6L9.2 12l2.4 2.4" fill="none" stroke="#2f7fd8" stroke-width="1.6"/>'),
    save: s16('<path d="M2 2h10.2L14 3.8V14H2z" fill="#2f7fd8"/><rect x="4.5" y="2" width="6" height="4" fill="#fff"/><rect x="4" y="8.8" width="8" height="5.2" fill="#e8f1fb"/>'),
    copy: s16('<rect x="5.5" y="1.5" width="8" height="10" rx="1" fill="#fff" stroke="#6b7c8f"/><rect x="2.5" y="4.5" width="8" height="10" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 7.5h4M4.5 9.5h4M4.5 11.5h3" stroke="#8a97a6"/>'),
    clear: s16(SHEET + '<path d="M9.5 9.5l5 5M14.5 9.5l-5 5" stroke="#c42b1c" stroke-width="1.7"/>'),
    connect: s16('<rect x="1.5" y="2.5" width="9" height="7" rx="1" fill="#5b6b7d"/><rect x="2.6" y="3.6" width="6.8" height="4.8" fill="#9fc1e3"/><path d="M4 12h4M6 9.5V12" stroke="#5b6b7d"/><path d="M12.5 8.5v6M9.5 11.5h6" stroke="#0f7b0f" stroke-width="1.6"/>'),
    up: s16('<path d="M8 4.5l4.5 6h-9z" fill="#1f6fc4"/>'),
    down: s16('<path d="M8 11.5l4.5-6h-9z" fill="#1f6fc4"/>'),
    x: '<svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2"/></svg>'
  };

  /* ---------------------------------------------------------------- constants and small helpers */
  const LEVEL_ORDER = ['Critical', 'Error', 'Warning', 'Information', 'Verbose'];
  const LEVEL_ICON = { Critical: I.eventCritical, Error: I.eventError, Warning: I.eventWarning, Information: I.eventInfo, Verbose: I.eventInfo };
  const TIME_OPTS = [['any', 'Any time'], ['1h', 'Last hour'], ['12h', 'Last 12 hours'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];
  const TIME_MS = { any: 0, '1h': 36e5, '12h': 432e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
  const KEYWORDS = { 'Audit Failure': '4503599627370496', 'Audit Success': '9007199254740992', Classic: '36028797018963968', 'Correlation Hint': '18014398509481984',
    'Response Time': '281474976710656', SQM: '2251799813685248', 'WDI Context': '562949953421312', 'WDI Diag': '1125899906842624' };
  const TASKS = { 'User Account Management': 13824, 'Computer Account Management': 13825, 'Security Group Management': 13826, 'Security State Change': 12288,
    Logon: 12544, 'Special Logon': 12548, 'Log clear': 104, 'Engine Lifecycle': 4, 'Provider Lifecycle': 6, 'Windows Update Agent': 1 };
  const WINDOWS_LOGS = ['Application', 'Security', 'Setup', 'System', 'ForwardedEvents'];
  const ID_HELP = 'Includes/Excludes Event IDs: Enter ID numbers and/or ID ranges separated by commas. To exclude criteria, type a minus sign first. For example 1,3,5-99,-76';
  const list = v => (Array.isArray(v) ? v : String(v == null ? '' : v).split(',')).map(x => String(x).trim()).filter(x => x && !/^<All .*>$/i.test(x));
  const logDisplay = log => (E.info(log) ? E.info(log).display : log);
  const tag = log => e => ({ ...e, log: e.log || log });
  const isAudit = e => /^Audit /.test(e.level);
  const levelText = e => (isAudit(e) ? 'Information' : e.level);
  const levelIcon = e => LEVEL_ICON[levelText(e)] || I.eventInfo;
  const keywordIcon = e => ({ 'Audit Success': I.auditSuccess, 'Audit Failure': I.auditFailure })[E.keyword(e)] || I.eventInfo;
  const rowIcon = log => (log === 'Security' ? keywordIcon : levelIcon);
  const fmtSize = b => (b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(2)} MB`);
  const longTime = t => `${U.fmtLongDate(t)} ${U.fmtTime(t, true)}`;
  const count = n => Number(n).toLocaleString('en-US');
  const vstate = () => WS.state.eventvwr;
  WS.store.init('eventvwr', s => { s.eventvwr = { recent: [], savedLogs: [], collector: false, preview: true }; });
  const consoles = new Set();
  const refreshAll = () => consoles.forEach(c => c.mmc.refresh());

  /** The list columns: the Security log shows Keywords (Audit Success / Audit Failure) where other logs show Level. */
  function columns(log) {
    const sec = log === 'Security';
    return [
      sec ? { key: 'keywords', label: 'Keywords', width: 115, value: e => E.keyword(e) } : { key: 'level', label: 'Level', width: 105, value: levelText },
      { key: 'time', label: 'Date and Time', width: 150, render: e => U.fmtDateTime(e.time), sort: (a, b, ra, rb) => a.localeCompare(b) || ra.record - rb.record },
      { key: 'source', label: 'Source', width: sec ? 215 : 210 },
      { key: 'id', label: 'Event ID', width: 70, type: 'num' },
      { key: 'task', label: 'Task Category', width: 155 }
    ];
  }

  /* ---------------------------------------------------------------- the event as XML (System / EventData) */
  const PROVIDERS = {
    'Service Control Manager': { guid: '{555908d1-a6d7-4695-8e1e-26931d2012f4}', esn: 'Service Control Manager', q: 16384, kw: '0x8080000000000000', pid: 768 },
    'Microsoft-Windows-Security-Auditing': { guid: '{54849625-5478-4994-a5ba-3e3b0328c30d}', pid: 780 },
    'Microsoft-Windows-Eventlog': { guid: '{fc65ddd8-d6ef-4962-83d5-6e5cfe9ce148}', kw: '0x8000000000000000', pid: 1496 },
    'Microsoft-Windows-Kernel-General': { guid: '{a68ca8b7-004f-d7b6-a698-07e2de0f1f5d}', kw: '0x8000000000000080', pid: 4 },
    'Microsoft-Windows-Time-Service': { guid: '{06edcfeb-0fd0-4e53-acca-a6f8bbf81bcb}' },
    'Microsoft-Windows-Servicing': { guid: '{bd12f3b8-fc40-4a61-a307-b7a013a069c1}' },
    'Microsoft-Windows-WindowsUpdateClient': { guid: '{945a8954-c147-4acd-923f-40c45405a658}' },
    'Microsoft-Windows-DistributedCOM': { guid: '{1b562e86-b7aa-4131-badc-b6f3a001407e}', esn: 'DCOM', q: 0, kw: '0x8080000000000000' },
    'Microsoft-Windows-User Profiles Service': { guid: '{89b1e9f0-5aff-44a6-9b44-0a07a7ce5845}' },
    'Microsoft-Windows-DNS-Server-Service': { guid: '{71a551f5-c893-4849-886b-b5ec8502641e}' },
    'Microsoft-Windows-DHCP-Server': { guid: '{6d64f02c-a125-4dac-9a01-f0555b41ca84}' },
    User32: { guid: '{b0aa8734-56f7-41cc-b2f4-de228e98b946}', esn: 'User32', q: 32768, kw: '0x8080000000000000' },
    EventLog: { q: 32768, kw: '0x80000000000000' }
  };
  const WELL_KNOWN = { SYSTEM: 'S-1-5-18', 'NT AUTHORITY\\SYSTEM': 'S-1-5-18', 'LOCAL SERVICE': 'S-1-5-19', 'NT AUTHORITY\\LOCAL SERVICE': 'S-1-5-19', 'NETWORK SERVICE': 'S-1-5-20', 'NT AUTHORITY\\NETWORK SERVICE': 'S-1-5-20' };
  function sidOf(account) {
    const a = String(account || ''), name = a.split('\\').pop();
    if (WELL_KNOWN[a.toUpperCase()]) return WELL_KNOWN[a.toUpperCase()];
    try {
      if (WS.sys.isDC() && WS.ad) { const o = WS.ad.get(name, 'user'); if (o && o.sid) return o.sid; }
      const u = ((WS.state.local || {}).users || []).find(x => x.name.toLowerCase() === name.toLowerCase());
      if (u && u.sid) return u.sid;
    } catch (e) { /* fall back to the name */ }
    return a;
  }
  const utf16hex = s => [...s].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0') + '00').join('') + '0000';
  const svcName = display => { const s = WS.catalog.services.find(x => x.display === display); return s ? s.name : display; };
  const sysTime = e => { const extra = String(U.hashStr('t' + e.record) % 10000).padStart(4, '0'); return String(e.time).replace(/\.(\d{3})Z$/, `.$1${extra}Z`); };

  /** Security audit text back into the event's named data (Target* first, then Subject*, as Windows orders them). */
  function auditData(text) {
    const SECTION = { Subject: 'Subject', 'New Account': 'Target', 'Target Account': 'Target', 'Target Computer': 'Target', 'New Computer Account': 'Target',
      'Account That Was Locked Out': 'Target', 'New Group': 'Target', Group: 'Target', Member: 'Member' };
    const FIELD = { 'Security ID': 'Sid', 'Account Name': 'UserName', 'Account Domain': 'DomainName', 'Logon ID': 'LogonId', 'Group Name': 'UserName', 'Group Domain': 'DomainName' };
    const out = [];
    let section = null;
    for (const line of String(text).split('\n')) {
      const s = line.match(/^([A-Z][^:\t]*):$/);
      if (s) { section = SECTION[s[1]] || null; continue; }
      const kv = line.match(/^\t([^:]+):\t+(.*)$/);
      if (!kv || !section) continue;
      const name = section === 'Member' ? (kv[1] === 'Security ID' ? 'MemberSid' : 'MemberName') : section + (FIELD[kv[1]] || kv[1].replace(/\s+/g, ''));
      out.push([name, /Sid$/.test(name) ? sidOf(kv[2]) : kv[2]]);
    }
    return [...out.filter(x => !/^Subject/.test(x[0])), ...out.filter(x => /^Subject/.test(x[0]))];
  }
  function eventData(e) {
    const m = String(e.message || ''), D = (items, binary) => ({ kind: 'EventData', items, binary });
    let r;
    if (e.source === 'Service Control Manager' && (r = m.match(/^The (.+) service entered the (\w+) state\.$/))) return D([['param1', r[1]], ['param2', r[2]]], utf16hex(`${svcName(r[1])}/${r[2] === 'running' ? 4 : 1}`));
    if (e.source === 'Service Control Manager' && (r = m.match(/^The start type of the (.+) service was changed from (.+) to (.+)\.$/))) return D([['param1', r[1]], ['param2', r[2]], ['param3', r[3]], ['param4', svcName(r[1])]]);
    if (e.source === 'User32' && (r = m.match(/^The process (.+) \((.+)\) has initiated the (?:restart|power off) of computer .+ on behalf of user (.+) for the following reason: (.*)\n Reason Code: (.*)\n Shutdown Type: (.*)\n Comment: ?(.*)$/)))
      return D([['param1', `${r[1]} (${r[2]})`], ['param2', r[2]], ['param3', r[4]], ['param4', r[5]], ['param5', r[6]], ['param6', r[7]], ['param7', r[3]]]);
    if (e.source === 'Microsoft-Windows-Kernel-General' && e.id === 12) {
      const b = String(WS.state.system.build || '26100.0').split('.');
      return D([['MajorVersion', '10'], ['MinorVersion', '0'], ['BuildVersion', b[0]], ['QfeVersion', b[1] || '0'], ['ServiceVersion', '0'], ['BootMode', '0'], ['StartTime', (m.match(/system time (.+)\.$/) || [])[1] || '']]);
    }
    if (e.source === 'Microsoft-Windows-Eventlog' && (e.id === 104 || e.id === 1102)) {
      const [dom, user] = String(e.user).includes('\\') ? String(e.user).split('\\') : [WS.sys.netbiosDomain(), 'Administrator'];
      const items = e.id === 1102 ? auditData(m) : [['SubjectUserName', user], ['SubjectDomainName', dom], ['Channel', (m.match(/^The (.+) log file was cleared\.$/) || [])[1] || e.log], ['BackupPath', '']];
      return { kind: 'UserData', tag: 'LogFileCleared', ns: 'http://manifests.microsoft.com/win/2004/08/windows/eventlog', items };
    }
    if (e.source === 'Microsoft-Windows-Security-Auditing') return D(auditData(m));
    return D([[null, m]]);
  }
  function systemOf(e) {
    const p = PROVIDERS[e.source] || {}, manifest = !!p.guid && !p.esn;
    const kw = e.level === 'Audit Success' ? (e.source === 'Microsoft-Windows-Eventlog' ? '0x4020000000000000' : '0x8020000000000000')
      : e.level === 'Audit Failure' ? '0x8010000000000000' : p.kw || (manifest ? '0x8000000000000000' : '0x80000000000000');
    const task = TASKS[e.task] != null ? TASKS[e.task] : +((String(e.task).match(/^\((\d+)\)$/) || [])[1] || 0);
    const sid = e.user && e.user !== 'N/A' ? sidOf(e.user) : null;
    return [
      ['Provider', [['Name', e.source], p.guid ? ['Guid', p.guid] : null, p.esn ? ['EventSourceName', p.esn] : null].filter(Boolean)],
      ['EventID', manifest ? [] : [['Qualifiers', p.q != null ? p.q : 0]], e.id],
      ['Version', [], 0], ['Level', [], E.levelValue(e)], ['Task', [], task], ['Opcode', [], 0], ['Keywords', [], kw],
      ['TimeCreated', [['SystemTime', sysTime(e)]]], ['EventRecordID', [], e.record], ['Correlation', []],
      ['Execution', [['ProcessID', p.pid != null ? p.pid : 900 + (U.hashStr(e.source) % 900) * 4], ['ThreadID', 1000 + (U.hashStr('r' + e.record) % 2500) * 4]]],
      ['Channel', [], e.log], ['Computer', [], e.computer], ['Security', sid ? [['UserID', sid]] : []]
    ];
  }
  const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** Pretty-printed event XML as [text, html] lines (the html is the coloured XML View). */
  function xmlLines(e) {
    const out = [], pad = d => '  '.repeat(d);
    const attrsOf = a => [a.map(([k, v]) => ` ${k}="${xesc(v)}"`).join(''), a.map(([k, v]) => ` <span class="xa">${k}</span>="<span class="xv">${U.esc(xesc(v))}</span>"`).join('')];
    const leaf = (d, t, a = [], text = null) => {
      const [at, ah] = attrsOf(a), empty = text == null || text === '';
      out.push([`${pad(d)}<${t}${at}${empty ? ' />' : `>${xesc(text)}</${t}>`}`,
        `${pad(d)}<span class="xm">&lt;</span><span class="xt">${t}</span>${ah}${empty ? '<span class="xm"> /&gt;</span>' : `<span class="xm">&gt;</span><b>${U.esc(xesc(text))}</b><span class="xm">&lt;/</span><span class="xt">${t}</span><span class="xm">&gt;</span>`}`]);
    };
    const open = (d, t, a = []) => { const [at, ah] = attrsOf(a); out.push([`${pad(d)}<${t}${at}>`, `${pad(d)}<span class="xm">&lt;</span><span class="xt">${t}</span>${ah}<span class="xm">&gt;</span>`]); };
    const close = (d, t) => out.push([`${pad(d)}</${t}>`, `${pad(d)}<span class="xm">&lt;/</span><span class="xt">${t}</span><span class="xm">&gt;</span>`]);
    open(0, 'Event', [['xmlns', 'http://schemas.microsoft.com/win/2004/08/events/event']]);
    open(1, 'System');
    for (const [t, a, text] of systemOf(e)) leaf(2, t, a, text);
    close(1, 'System');
    const data = eventData(e);
    if (data.kind === 'UserData') {
      open(1, 'UserData'); open(2, data.tag, [['xmlns', data.ns]]);
      for (const [k, v] of data.items) leaf(3, k, [], v);
      close(2, data.tag); close(1, 'UserData');
    } else if (!data.items.length && !data.binary) leaf(1, 'EventData');
    else {
      open(1, 'EventData');
      for (const [k, v] of data.items) leaf(2, 'Data', k ? [['Name', k]] : [], v);
      if (data.binary) leaf(2, 'Binary', [], data.binary);
      close(1, 'EventData');
    }
    close(0, 'Event');
    return out;
  }
  const eventXml = e => xmlLines(e).map(l => l[0]).join('\r\n');
  /** "Copy Details as Text", as Event Viewer puts it on the clipboard. */
  function eventText(e) {
    return [`Log Name:      ${e.log}`, `Source:        ${e.source}`, `Date:          ${U.fmtDateTime(e.time)}`, `Event ID:      ${e.id}`, `Task Category: ${e.task}`,
      `Level:         ${levelText(e)}`, `Keywords:      ${E.keyword(e)}`, `User:          ${e.user}`, `Computer:      ${e.computer}`, 'Description:',
      String(e.message).replace(/\r?\n/g, '\r\n'), 'Event Xml:', eventXml(e)].join('\r\n');
  }
  const api = { clipboard: '' };
  function copyText(text) {
    api.clipboard = text;
    const fallback = () => {
      const ta = h('textarea', { style: 'position:fixed;left:-10000px;top:0' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
      ta.remove();
    };
    try { const p = navigator.clipboard && navigator.clipboard.writeText(text); if (p && p.catch) p.catch(fallback); else if (!p) fallback(); } catch (e) { fallback(); }
  }

  /* ---------------------------------------------------------------- General / Details panes */
  function generalPage(e) {
    const lab = t => h('div.ev-lab', t), val = (t, wide) => h('div.ev-val' + (wide ? '.wide' : ''), t == null ? '' : String(t));
    return h('div.ev-general',
      h('div.ev-msg', { tabIndex: 0 }, e.message),
      h('div.ev-grid',
        lab('Log Name:'), val(e.log, true),
        lab('Source:'), val(e.source), lab('Logged:'), val(U.fmtDateTime(e.time)),
        lab('Event ID:'), val(e.id), lab('Task Category:'), val(e.task),
        lab('Level:'), val(levelText(e)), lab('Keywords:'), val(E.keyword(e)),
        lab('User:'), val(e.user), lab('Computer:'), val(e.computer),
        lab('OpCode:'), val('Info', true),
        lab('More Information:'), h('div.ev-val.wide', F.link('Event Log Online Help', () => WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'Event Log Online Help is not available in the lab simulator.', detail: `Event ${e.id}, ${e.source}` })))));
  }
  function friendlyView(e) {
    const indent = d => ({ paddingLeft: 4 + d * 18 + 'px' });
    const group = (label, kids, d) => {
      const body = h('div', ...kids), tog = h('span.ev-ftog', '-');
      return h('div', h('div.ev-fh', { style: indent(d), onClick: () => { const shut = body.style.display !== 'none'; body.style.display = shut ? 'none' : ''; tog.textContent = shut ? '+' : '-'; } }, tog, h('b', label)), body);
    };
    const row = (d, name, value, attr) => h('div.ev-fr', { style: indent(d) }, h('span.ev-fn', attr ? `[ ${name}]` : name), h('span.ev-fv', value == null ? '' : String(value)));
    const sys = systemOf(e).map(([t, a, text]) => (a.length ? group(text != null ? `${t}  ${text}` : t, a.map(([k, v]) => row(3, k, v, true)), 1) : row(2, t, text)));
    const data = eventData(e);
    const tail = data.kind === 'UserData' ? group('UserData', [group(data.tag, data.items.map(([k, v]) => row(3, k, v)), 1)], 0)
      : group('EventData', [...data.items.map(([k, v]) => row(2, k || '', v)), data.binary ? row(2, 'Binary data:', data.binary) : null].filter(Boolean), 0);
    return h('div.ev-friendly', group('System', sys, 0), tail);
  }
  const xmlView = e => h('pre.ev-xml', { html: xmlLines(e).map(l => l[1]).join('\n') });
  function detailsPage(e, st) {
    const host = h('div.ev-dbody');
    const paint = () => { U.clear(host); host.appendChild(st.mode === 'xml' ? xmlView(e) : friendlyView(e)); };
    const name = uid('evd');
    const radios = h('div.ev-dmodes',
      F.radio(name, 'Friendly View', st.mode !== 'xml', { onChange: v => { if (v) { st.mode = 'friendly'; paint(); } } }),
      F.radio(name, 'XML View', st.mode === 'xml', { onChange: v => { if (v) { st.mode = 'xml'; paint(); } } }));
    paint();
    return h('div.ev-details', radios, host);
  }
  /** General | Details tab control shared by the preview pane and the Event Properties dialog. st: { tab, mode } */
  function eventPane(e, st) {
    const tabs = ['General', 'Details'], body = h('div.ev-tbody');
    const strip = h('div.ev-tabs', ...tabs.map(t => h('div.ev-tab', { onClick: () => { st.tab = t; paint(); } }, t)));
    function paint() {
      [...strip.children].forEach((x, i) => x.classList.toggle('sel', tabs[i] === st.tab));
      U.clear(body); body.appendChild(st.tab === 'Details' ? detailsPage(e, st) : generalPage(e));
    }
    paint();
    return h('div.ev-pane', strip, body);
  }

  /* ---------------------------------------------------------------- Event Properties */
  function eventProperties(logName, record, opts = {}) {
    const rows = () => ((typeof opts.rows === 'function' ? opts.rows() : opts.rows) || E.list(logName)).map(tag(logName));
    const rec = Number(record);
    let entry = rows().find(x => x.record === rec) || E.list(logName).map(tag(logName)).find(x => x.record === rec);
    if (!entry) {
      WS.ui.msgbox({ title: TITLE, icon: 'error', message: 'The event could not be found. It may have been cleared from the log.' });
      return Promise.resolve(null);
    }
    const st = { tab: opts.tab || 'General', mode: opts.mode || 'friendly' };
    const frame = WS.ui.modal({ title: '', width: 690, className: 'w32-dlg ev-props', closeValue: null });
    const upBtn = h('button.tbtn.ev-nav', { title: 'Previous Event', html: IC.up, onClick: () => move(-1) });
    const dnBtn = h('button.tbtn.ev-nav', { title: 'Next Event', html: IC.down, onClick: () => move(1) });
    const holder = h('div.ev-propmain');
    frame.body.appendChild(h('div.w32.ev-propwrap', holder, h('div.ev-navs', upBtn, dnBtn)));
    function paint() {
      frame.setTitle(`Event Properties - Event ${entry.id}, ${entry.source}`);
      U.clear(holder); holder.appendChild(eventPane(entry, st));
      const all = rows(), i = all.findIndex(x => x.record === entry.record);
      upBtn.disabled = i <= 0; dnBtn.disabled = i < 0 || i >= all.length - 1;
    }
    function move(d) {
      const all = rows(), i = all.findIndex(x => x.record === entry.record), n = i >= 0 ? all[i + d] : null;
      if (!n) return false;
      entry = n; paint();
      if (opts.onNavigate) opts.onNavigate(entry);
      return true;
    }
    const copyBtn = h('button.btn.ev-copy', { onClick: () => copyText(eventText(entry)) }, h('span.ev-bic', { html: IC.copy }), 'Copy');
    frame.footer.append(h('div', { style: 'flex:1' }, copyBtn), h('button.btn.primary', { onClick: () => frame.close(null) }, 'Close'));
    frame.onEnter = () => frame.close(null);
    paint();
    const dlg = { frame, get entry() { return entry; }, next: () => move(1), prev: () => move(-1), tab(t) { st.tab = t; paint(); },
      mode(m) { st.tab = 'Details'; st.mode = m; paint(); }, copy: () => copyBtn.click(), close: () => frame.close(null), upBtn, dnBtn };
    if (opts.onCreate) opts.onCreate(dlg);
    WS.ui.focusFirst(frame, frame.footer.querySelector('.btn.primary'));
    return frame.promise;
  }

  /* ---------------------------------------------------------------- filter dialog (Filter Current Log / Create Custom View) */
  /** Drop-down with check boxes (Event logs, Event sources, Task category, Keywords). choices: [{ value, label, depth, group: [values] }] */
  function checkCombo(choices, selected, o = {}) {
    const input = F.text({ value: list(selected).join(','), disabled: !!o.disabled });
    const btn = h('button.ev-ddbtn', { type: 'button', tabIndex: -1, disabled: !!o.disabled, html: I.chevronDown });
    const el = h('div.ev-combo', input, btn);
    let panel = null;
    const values = () => list(input.value);
    const outside = e => { if (panel && !panel.contains(e.target) && !el.contains(e.target)) close(); };
    function close() { if (!panel) return; panel.remove(); panel = null; document.removeEventListener('pointerdown', outside, true); }
    function open() {
      const shade = el.closest('.dlg-shade') || WS.ui.dialogLayer(), r = input.getBoundingClientRect();
      const sel = new Set(values().map(v => v.toLowerCase()));
      const items = typeof choices === 'function' ? choices() : choices;
      panel = h('div.ev-ddpanel', { style: { left: r.left + 'px', top: r.bottom + 'px', width: (r.width + 18) + 'px' } });
      if (!items.length) panel.appendChild(h('div.ev-ddnone', '(none)'));
      for (const ch of items) {
        const kids = ch.group || [ch.value];
        const cb = F.checkbox(ch.label, kids.every(v => sel.has(String(v).toLowerCase())), { onChange: on => {
          const cur = values().filter(v => !kids.some(k => String(k).toLowerCase() === v.toLowerCase()));
          input.value = (on ? [...cur, ...kids] : cur).join(',');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          close(); open();
        } });
        cb.style.paddingLeft = 4 + (ch.depth || 0) * 16 + 'px';
        panel.appendChild(cb);
      }
      shade.appendChild(panel);
      document.addEventListener('pointerdown', outside, true);
    }
    btn.addEventListener('click', () => (panel ? close() : open()));
    return { el, input, open, close, get value() { return values(); }, set(v) { input.value = list(v).join(','); },
      setDisabled(d) { input.disabled = btn.disabled = !!d; if (d) close(); } };
  }
  const logChoices = () => {
    const present = E.logNames(), out = [];
    const win = WINDOWS_LOGS.filter(l => present.includes(l)), apps = present.filter(l => !WINDOWS_LOGS.includes(l));
    out.push({ label: 'Windows Logs', group: win });
    win.forEach(l => out.push({ value: l, label: logDisplay(l), depth: 1 }));
    out.push({ label: 'Applications and Services Logs', group: apps });
    apps.forEach(l => out.push({ value: l, label: E.info(l).folder ? l : logDisplay(l), depth: 1 }));
    return out;
  };
  const distinct = (logs, key) => [...new Set(logs.flatMap(l => E.list(l).map(e => e[key])))].sort((a, b) => a.localeCompare(b)).map(v => ({ value: v, label: v }));
  const levelNums = levels => LEVEL_ORDER.filter(l => list(levels).includes(l)).map(l => E.LEVEL_NUM[l]);

  /** The XPath query Event Viewer builds from the Filter tab (shown on the XML tab and in exported custom views). */
  function xpathOf(f) {
    const c = [], or = parts => (parts.length > 1 ? parts[0] + '  or ' + parts.slice(1).join(' or ') : parts[0]);
    const src = list(f.sources);
    if (src.length) c.push('Provider[' + src.map(s => `@Name='${s}'`).join(' or ') + ']');
    const lv = levelNums(f.levels).flatMap(n => (n === 4 ? ['Level=4', 'Level=0'] : ['Level=' + n]));
    if (lv.length) c.push(`(${or(lv)})`);
    const tasks = list(f.tasks).map(t => TASKS[t]).filter(n => n != null).map(n => `Task = ${n}`);
    if (tasks.length) c.push(`(${or(tasks)})`);
    const kw = list(f.keywords).filter(k => KEYWORDS[k]);
    if (kw.length) c.push(`(${kw.map(k => `band(Keywords,${KEYWORDS[k]})`).join(' or ')})`);
    const ids = E.parseIds(f.ids) || { include: [], exclude: [] };
    const idx = rs => rs.map(([a, b]) => (a === b ? `EventID=${a}` : ` (EventID >= ${a} and EventID <= ${b}) `));
    if (ids.include.length) c.push(`(${or(idx(ids.include))})`);
    if (TIME_MS[f.time]) c.push(`TimeCreated[timediff(@SystemTime) <= ${TIME_MS[f.time]}]`);
    const users = list(f.users).map(u => `@UserID='${sidOf(u)}'`);
    if (users.length) c.push(`Security[${users.join(' or ')}]`);
    const comps = list(f.computers).map(x => `Computer='${x}'`);
    if (comps.length) c.push(`(${comps.join(' or ')})`);
    return { select: c.length ? `*[System[${c.join(' and ')}]]` : '*', suppress: ids.exclude.length ? `*[System[(${or(idx(ids.exclude))})]]` : null };
  }
  function queryXml(f, logs) {
    const q = xpathOf(f), paths = logs.length ? logs : ['System'];
    return ['<QueryList>', `  <Query Id="0" Path="${xesc(paths[0])}">`,
      ...paths.map(l => `    <Select Path="${xesc(l)}">${xesc(q.select)}</Select>`),
      ...(q.suppress ? paths.map(l => `    <Suppress Path="${xesc(l)}">${xesc(q.suppress)}</Suppress>`) : []),
      '  </Query>', '</QueryList>'].join('\n');
  }

  function filterDialog(o = {}) {
    const create = o.mode === 'create', fixed = list(o.logs);
    const f0 = { time: 'any', levels: [], logs: fixed, sources: [], ids: '', tasks: [], keywords: [], users: '', computers: '', bySource: false, ...(o.filter || {}) };
    const frame = WS.ui.modal({ title: o.title || (create ? 'Create Custom View' : 'Filter Current Log'), width: 600, className: 'w32-dlg ev-filter', closeValue: null });
    const c = {};
    c.time = F.select(TIME_OPTS.map(([value, label]) => ({ value, label })), f0.time || 'any', { width: 230 });
    c.levels = {};
    for (const l of ['Critical', 'Warning', 'Verbose', 'Error', 'Information']) c.levels[l] = F.checkbox(l, list(f0.levels).includes(l));
    const rn = uid('evsrc');
    c.byLog = F.radio(rn, 'By log', !f0.bySource, { disabled: !create, onChange: () => sync() });
    c.bySource = F.radio(rn, 'By source', !!f0.bySource, { disabled: !create, onChange: () => sync() });
    const currentLogs = () => (create ? (c.bySource.checked ? E.logNames() : c.logs.value) : fixed);
    c.logs = checkCombo(logChoices, create ? f0.logs : fixed, { disabled: !create });
    c.sources = checkCombo(() => distinct(currentLogs(), 'source'), f0.sources);
    c.ids = F.text({ value: f0.ids || '<All Event IDs>' });
    c.tasks = checkCombo(() => distinct(currentLogs(), 'task'), f0.tasks);
    c.keywords = checkCombo(Object.keys(KEYWORDS).map(k => ({ value: k, label: k })), f0.keywords);
    c.users = F.text({ value: f0.users || '<All Users>' });
    c.computers = F.text({ value: f0.computers || '<All Computers>' });
    function sync() { if (create) c.logs.setDisabled(c.bySource.checked); }
    sync();
    const read = () => ({ time: c.time.value, levels: LEVEL_ORDER.filter(l => c.levels[l].checked), logs: create ? (c.bySource.checked ? [] : c.logs.value) : fixed,
      bySource: create && c.bySource.checked, sources: c.sources.value, ids: list(c.ids.value).length ? c.ids.value.trim() : '', tasks: c.tasks.value, keywords: c.keywords.value,
      users: list(c.users.value).join(','), computers: list(c.computers.value).join(',') });
    function clear() {
      c.time.value = 'any'; Object.values(c.levels).forEach(x => { x.checked = false; });
      if (create) { c.byLog.checked = true; c.logs.set([]); sync(); }
      c.sources.set([]); c.ids.value = '<All Event IDs>'; c.tasks.set([]); c.keywords.set([]); c.users.value = '<All Users>'; c.computers.value = '<All Computers>';
    }
    const lw = { labelWidth: 100 };
    const filterPage = h('div.ev-fpage',
      F.row('Logged:', c.time, lw),
      h('div.frow', h('label.flabel', { style: 'width:100px;align-self:flex-start;padding-top:5px' }, 'Event level:'), h('div.ev-levels', ...Object.values(c.levels))),
      h('div.ev-bylog', h('div', c.byLog, c.bySource), h('div.ev-bylog-c', F.row('Event logs:', c.logs.el, { labelWidth: 90 }), F.row('Event sources:', c.sources.el, { labelWidth: 90 }))),
      h('div.ev-idhelp', ID_HELP), c.ids,
      F.row('Task category:', c.tasks.el, lw), F.row('Keywords:', c.keywords.el, lw), F.row('User:', c.users, lw), F.row('Computer(s):', c.computers, lw),
      h('div.ev-right', F.button('Clear', clear)));
    const xmlBox = F.textarea({ readOnly: true, rows: 17 });
    xmlBox.classList.add('ev-xmlbox');
    const xmlPage = h('div.ev-fpage', xmlBox, F.checkbox('Edit query manually', false, { disabled: true }));
    const pages = [['Filter', filterPage], ['XML', xmlPage]];
    const tabsEl = h('div.ps-tabs'), pagesEl = h('div.ps-pages.ev-fpages', filterPage, xmlPage);
    const tabs = pages.map(([label], i) => { const b = h('div.ps-tab', { onClick: () => show(i) }, label); tabsEl.appendChild(b); return b; });
    function show(i) {
      tabs.forEach((b, j) => b.classList.toggle('sel', i === j));
      pages.forEach(([, el], j) => { el.style.display = i === j ? '' : 'none'; });
      if (i === 1) { const f = read(); xmlBox.value = queryXml(f, f.logs.length ? f.logs : f.bySource ? E.logNames() : []); }
      [c.logs, c.sources, c.tasks, c.keywords].forEach(x => x.close());
    }
    frame.body.appendChild(h('div.w32.ps', tabsEl, pagesEl));
    async function ok() {
      const f = read();
      if (E.parseIds(f.ids) === null) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: 'The Event ID filter is not valid. Enter ID numbers and/or ID ranges separated by commas, for example 1,3,5-99,-76.' }); return; }
      if (create && !f.logs.length && !f.sources.length) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: f.bySource ? 'Select at least one event source.' : 'Select at least one event log.' }); return; }
      [c.logs, c.sources, c.tasks, c.keywords].forEach(x => x.close());
      frame.close(f);
    }
    const okBtn = h('button.btn.primary', { onClick: ok }, 'OK');
    frame.footer.append(okBtn, h('button.btn', { onClick: () => { [c.logs, c.sources, c.tasks, c.keywords].forEach(x => x.close()); frame.close(null); } }, 'Cancel'));
    frame.onEnter = ok;
    show(0);
    const dlg = { frame, c, ok, clear, read, cancel: () => frame.close(null), tab: name => show(pages.findIndex(p => p[0] === name)), xml: () => xmlBox.value };
    if (o.onCreate) o.onCreate(dlg);
    WS.ui.focusFirst(frame, c.time);
    return frame.promise;
  }
  /** "Filtered: Log: System; Levels: Error, Warning; Source: ; Event ID: 7036" (the header's second line). */
  function filterSummary(label, f) {
    const parts = [`Log: ${label}`], lv = LEVEL_ORDER.filter(l => list(f.levels).includes(l));
    if (lv.length) parts.push('Levels: ' + lv.join(', '));
    parts.push('Source: ' + list(f.sources).join(', '));
    if (list(f.ids).length) parts.push('Event ID: ' + String(f.ids).trim());
    return 'Filtered: ' + parts.join('; ');
  }

  /* ---------------------------------------------------------------- clear, save, properties, find */
  const SAVE_FILTERS = [{ label: 'Event Files (*.evtx)', ext: ['.evtx'] }, { label: 'XML (*.xml)', ext: ['.xml'] }, { label: 'Text (Tab delimited) (*.txt)', ext: ['.txt'] }, { label: 'CSV (Comma Separated) (*.csv)', ext: ['.csv'] }];
  function displayInfo(onCreate) {
    const n = uid('evdi');
    const content = h('div.w32.ev-dispinfo', F.note('Display information allows the saved log to be viewed with descriptions on other computers.'),
      F.radio(n, 'No display information', false), F.radio(n, 'Display information for these languages:', true),
      h('div.ev-langs', F.checkbox('English (United States)', true)), F.checkbox('Show all available languages', false));
    return WS.ui.dialog({ title: 'Display Information', width: 420, content, onCreate, buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] }).then(r => r === 'OK');
  }
  function exportText(entries, sep) {
    const cell = v => { const s = String(v == null ? '' : v); return /["\r\n]/.test(s) || (sep === ',' && s.includes(',')) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const sec = entries.length && entries.every(e => e.log === 'Security');
    const head = [sec ? 'Keywords' : 'Level', 'Date and Time', 'Source', 'Event ID', 'Task Category'];
    return [head.join(sep), ...entries.map(e => [sec ? E.keyword(e) : levelText(e), U.fmtDateTime(e.time), e.source, e.id, e.task, e.message].map(cell).join(sep))].join('\r\n') + '\r\n';
  }
  /** Save All Events As / Save Selected Events: .evtx (simulator format, opens again with Open Saved Log), .xml, .txt, .csv. */
  async function saveEvents(entries, opts = {}) {
    const path = await WS.ui.filePicker({ mode: 'save', title: opts.title || 'Save As', filters: SAVE_FILTERS, defaultName: opts.defaultName || '', onCreate: opts.onPicker || opts.onCreate });
    if (!path) return null;
    const ext = (path.match(/\.([^.\\]+)$/) || [])[1] || '';
    let text;
    if (/^xml$/i.test(ext)) text = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Events>\r\n' + entries.map(eventXml).join('\r\n') + '\r\n</Events>\r\n';
    else if (/^txt$/i.test(ext)) text = exportText(entries, '\t');
    else if (/^csv$/i.test(ext)) text = exportText(entries, ',');
    else {
      if (!(await displayInfo(opts.onDisplayInfo))) return null;
      text = E.serialize(opts.log || (entries[0] && entries[0].log) || 'Application', entries);
    }
    try { WS.fs.writeFile(path, text); }
    catch (e) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: e.message }); return null; }
    return path;
  }
  async function clearLog(log, opts = {}) {
    const name = logDisplay(log);
    const ans = await WS.ui.dialog({ title: TITLE, width: 430, onCreate: opts.onCreate,
      content: h('div.w32.ev-ask', `Do you want to save "${name}" before clearing it?`),
      buttons: [{ label: 'Save and Clear', primary: true }, { label: 'Clear' }, { label: 'Cancel', cancel: true }] });
    if (ans === 'Save and Clear') {
      const path = await saveEvents(E.list(log).map(tag(log)), { log, defaultName: name, onPicker: opts.onPicker, onDisplayInfo: opts.onDisplayInfo });
      if (!path) return null;
      E.clear(log);
      return 'saved';
    }
    if (ans !== 'Clear') return null;
    E.clear(log);
    return 'cleared';
  }
  function logProperties(log, opts = {}) {
    const p0 = E.logProps(log);
    if (!p0) return null;
    const c = {};
    const sizeText = p => `${fmtSize(p.sizeBytes)}(${count(p.sizeBytes)} bytes)`;
    const paintTimes = () => { const p = E.logProps(log); c.size.textContent = sizeText(p); c.modified.textContent = longTime(p.modified); c.accessed.textContent = longTime(p.modified); };
    return WS.ui.propertySheet({ title: `Log Properties - ${p0.display} (Type: ${p0.type})`, width: 540, errorTitle: TITLE, onCreate: opts.onCreate,
      tabs: [{ label: 'General', render: () => {
        const p = E.logProps(log), lw = { labelWidth: 95 };
        c.size = F.value(sizeText(p)); c.created = F.value(longTime(p.created)); c.modified = F.value(longTime(p.modified)); c.accessed = F.value(longTime(p.modified));
        c.enabled = F.checkbox('Enable logging', p.enabled, { disabled: p.classic });
        c.max = F.number({ value: p.maxKB, min: 64, max: 4194240, width: 120 });
        const rn = uid('evret');
        c.ret = { overwrite: F.radio(rn, 'Overwrite events as needed (oldest events first)', p.retention === 'overwrite'),
          archive: F.radio(rn, 'Archive the log when full, do not overwrite events', p.retention === 'archive'),
          manual: F.radio(rn, 'Do not overwrite events ( Clear logs manually )', p.retention === 'manual') };
        c.clear = F.button('Clear Log', async () => { if (await clearLog(log, opts.clear || {})) paintTimes(); });
        c.clear.setAttribute('data-nodirty', '');
        return h('div.ev-lprops',
          F.row('Full Name:', F.text({ value: log, readOnly: true }), lw), F.row('Log path:', F.text({ value: p.path, readOnly: true }), lw),
          F.row('Log size:', c.size, lw), F.row('Created:', c.created, lw), F.row('Modified:', c.modified, lw), F.row('Accessed:', c.accessed, lw),
          F.sep(), c.enabled, F.row('Maximum log size ( KB ):', c.max, { labelWidth: 150 }),
          h('div.ev-when', 'When maximum event log size is reached:'), h('div.ev-indent', c.ret.overwrite, c.ret.archive, c.ret.manual),
          h('div.ev-right', c.clear));
      }, apply: () => {
        const cur = E.logProps(log), change = {};
        let kb = Math.floor(Number(c.max.value));
        if (!Number.isFinite(kb)) kb = cur.maxKB;
        if (kb !== cur.maxKB) { kb = U.clamp(Math.ceil(kb / 64) * 64, 64, 4194240); change.maxKB = kb; }
        c.max.value = kb;
        const retention = Object.keys(c.ret).find(k => c.ret[k].checked) || cur.retention;
        if (retention !== cur.retention) change.retention = retention;
        if (!cur.classic && c.enabled.checked !== cur.enabled) change.enabled = c.enabled.checked;
        if (!Object.keys(change).length) return null;
        const r = E.setLogProps(log, change);
        if (r.ok) paintTimes();
        return r;
      } }] });
  }
  /** Read-only properties of a saved log (Open Saved Log). */
  function savedProperties(s, opts = {}) {
    const st = WS.fs.stat(s.path) || {};
    return WS.ui.propertySheet({ title: `Log Properties - ${s.name} (Type: Administrative)`, width: 540, errorTitle: TITLE, onCreate: opts.onCreate,
      tabs: [{ label: 'General', render: () => h('div.ev-lprops', F.row('Full Name:', F.text({ value: s.name, readOnly: true })), F.row('Log path:', F.text({ value: s.path, readOnly: true })),
        F.row('Log size:', F.value(`${fmtSize(st.size || 0)}(${count(st.size || 0)} bytes)`)), F.row('Created:', F.value(st.created ? longTime(st.created) : '')), F.row('Modified:', F.value(st.modified ? longTime(st.modified) : '')),
        F.sep(), F.checkbox('Enable logging', true, { disabled: true }), F.note('Saved logs are read-only.')) }] });
  }
  function find(ctl, opts = {}) {
    const frame = WS.ui.modal({ title: 'Find', width: 430, className: 'w32-dlg ev-find', closeValue: null });
    const what = F.text({ value: ctl.lastFind || '' });
    const next = async () => {
      const t = what.value.trim();
      if (!t) return;
      ctl.lastFind = t;
      if (!ctl.findNext(t)) await WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'Search string not found.' });
    };
    frame.body.appendChild(h('div.w32', F.row('Find what:', what, { labelWidth: 70 })));
    const nextBtn = h('button.btn.primary', { onClick: next }, 'Find Next');
    frame.footer.append(nextBtn, h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = next;
    const dlg = { frame, input: what, next, close: () => frame.close(null) };
    if (opts.onCreate) opts.onCreate(dlg);
    WS.ui.focusFirst(frame, what);
    return frame.promise;
  }

  /* ---------------------------------------------------------------- custom views */
  const viewNodeId = v => 'ev-cv:' + v.id;
  function viewXml(v) {
    const f = v.filter || {}, logs = list(f.logs).length ? list(f.logs) : f.any ? [...new Set(f.any.flatMap(p => list(p.logs)))] : [];
    const el = (t, val) => (val ? `<${t}>${xesc(val)}</${t}>` : '');
    const simple = el('Channel', logs.join(',')) + el('EventId', list(f.ids).length ? f.ids : '') + el('Level', levelNums(f.levels).join(',')) + el('Source', list(f.sources).join(',')) +
      el('Task', list(f.tasks).join(',')) + el('Keyword', list(f.keywords).join(',')) + el('UserName', list(f.users).join(',')) + el('ComputerName', list(f.computers).join(',')) +
      `<RelativeTimeInfo>${TIME_MS[f.time] || 0}</RelativeTimeInfo><BySource>${f.bySource ? 'True' : 'False'}</BySource>`;
    return `<ViewerConfig><QueryConfig><QueryParams><Simple>${simple}</Simple></QueryParams><QueryNode><Name>${xesc(v.name)}</Name><Description>${xesc(v.description || '')}</Description>${queryXml(f, logs).replace(/\n\s*/g, '')}</QueryNode></QueryConfig></ViewerConfig>`;
  }
  function parseViewXml(text) {
    let doc;
    try { doc = new DOMParser().parseFromString(String(text), 'application/xml'); } catch (e) { return null; }
    if (!doc || doc.querySelector('parsererror') || !doc.querySelector('ViewerConfig QueryNode')) return null;
    const g = sel => { const n = doc.querySelector(sel); return n ? n.textContent : ''; };
    const LV = { 1: 'Critical', 2: 'Error', 3: 'Warning', 4: 'Information', 5: 'Verbose' };
    const rel = Number(g('Simple > RelativeTimeInfo')) || 0;
    const filter = { logs: list(g('Simple > Channel')), ids: g('Simple > EventId'), levels: list(g('Simple > Level')).map(n => LV[n]).filter(Boolean), sources: list(g('Simple > Source')),
      tasks: list(g('Simple > Task')), keywords: list(g('Simple > Keyword')), users: g('Simple > UserName'), computers: g('Simple > ComputerName'),
      time: Object.keys(TIME_MS).find(k => TIME_MS[k] === rel) || 'any', bySource: /^true$/i.test(g('Simple > BySource')) };
    if (!filter.logs.length && !filter.sources.length) filter.logs = [...new Set([...doc.querySelectorAll('Select')].map(s => s.getAttribute('Path')).filter(Boolean))];
    return { name: g('QueryNode > Name'), description: g('QueryNode > Description'), filter };
  }
  /** Name + Description dialog used by Save Filter to Custom View, Import Custom View File and Custom View Properties. */
  function nameDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: 470, className: 'w32-dlg ev-savecv', closeValue: null });
    const name = F.text({ value: o.name || '' }), desc = F.textarea({ rows: 3, value: o.description || '' });
    const where = WS.ui.tree({ nodes: [{ id: 'cv', label: 'Custom Views', icon: IC.views, expanded: true, children: [{ id: 'roles', label: 'Server Roles', icon: I.folder }] }] });
    where.select('cv');
    where.el.classList.add('ev-where');
    frame.body.appendChild(h('div.w32', F.row('Name', name, { labelWidth: 80 }), F.row('Description', desc, { labelWidth: 80 }),
      o.edit ? h('div.ev-right', F.button('Edit Filter...', o.edit)) : h('div', h('div', { style: 'margin:8px 0 4px' }, 'Select where the Custom View will be saved:'), where.el, F.checkbox('All Users', false, { disabled: true }))));
    const ok = async () => {
      const r = await o.submit({ name: name.value.trim(), description: desc.value });
      if (r && r.ok === false) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: r.error }); return; }
      frame.close(r);
    };
    frame.footer.append(...[o.edit ? null : h('div', { style: 'flex:1' }, F.button('New Folder', () => WS.apps.notImplemented('New Folder'))), h('button.btn.primary', { onClick: ok }, 'OK'), h('button.btn', { onClick: () => frame.close(null) }, 'Cancel')].filter(Boolean));
    frame.onEnter = ok;
    if (o.onCreate) o.onCreate({ frame, name, description: desc, ok, cancel: () => frame.close(null) });
    WS.ui.focusFirst(frame, name);
    return frame.promise;
  }
  async function createCustomView(opts = {}) {
    const f = await filterDialog({ title: 'Create Custom View', mode: 'create', filter: opts.filter, onCreate: opts.onCreate });
    if (!f) return null;
    const r = await nameDialog({ title: 'Save Filter to Custom View', onCreate: opts.onSave, submit: v => E.saveCustomView({ ...v, filter: f }) });
    return r && r.view;
  }
  async function importCustomView(opts = {}) {
    const path = await WS.ui.filePicker({ mode: 'open', title: 'Import Custom View', filters: [{ label: 'Event Viewer Custom View Files (*.xml)', ext: ['.xml'] }], onCreate: opts.onPicker });
    if (!path) return null;
    let v = null;
    try { v = parseViewXml(WS.fs.readFile(path)); } catch (e) { v = null; }
    if (!v) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: 'The custom view file could not be imported. The file is not a valid Event Viewer custom view.' }); return null; }
    const r = await nameDialog({ title: 'Import Custom View File', name: v.name || path.replace(/^.*\\/, '').replace(/\.[^.]+$/, ''), description: v.description, onCreate: opts.onCreate,
      submit: x => E.saveCustomView({ ...x, filter: v.filter }) });
    return r && r.view;
  }
  async function exportCustomView(v, opts = {}) {
    const path = await WS.ui.filePicker({ mode: 'save', title: 'Export Custom View', filters: [{ label: 'Event Viewer Custom View Files (*.xml)', ext: ['.xml'] }], defaultName: v.name.replace(/[\\/:*?"<>|]/g, ''), onCreate: opts.onPicker || opts.onCreate });
    if (!path) return null;
    try { WS.fs.writeFile(path, viewXml(v)); } catch (e) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: e.message }); return null; }
    return path;
  }
  async function openSavedLog(opts = {}) {
    const path = await WS.ui.filePicker({ mode: 'open', title: 'Open Saved Log', filters: [{ label: 'Event Files (*.evtx,*.evt,*.etl)', ext: ['.evtx', '.evt', '.etl'] }, { label: 'Event Log Files (*.evtx)', ext: ['.evtx'] }], onCreate: opts.onPicker });
    if (!path) return null;
    let parsed = null;
    try { parsed = E.parseFile(WS.fs.readFile(path)); } catch (e) { parsed = null; }
    if (!parsed) { await WS.ui.msgbox({ title: TITLE, icon: 'error', message: 'Event Viewer cannot open the event log or custom view. Verify that Event Log service is running or query is too long. The event log file is corrupted.' }); return null; }
    const r = await nameDialog({ title: 'Open Saved Log', name: path.replace(/^.*\\/, '').replace(/\.[^.]+$/, ''), onCreate: opts.onCreate,
      submit: v => { if (!v.name) return { ok: false, error: 'Type a name for the saved log.' }; const s = { id: uid('sl') + Date.now().toString(36), name: v.name, description: v.description, path, log: parsed.log }; vstate().savedLogs.push(s); WS.store.changed('eventvwr'); return { ok: true, saved: s }; } });
    if (r && r.saved) refreshAll();
    return r && r.saved;
  }

  /* ---------------------------------------------------------------- built-in views */
  const ROLE_VIEWS = [
    ['AD-Domain-Services', 'Active Directory Domain Services', [{ logs: ['Directory Service', 'DFS Replication'] }, { logs: ['System'], sources: ['NETLOGON', 'Microsoft-Windows-Kerberos-Key-Distribution-Center'] }]],
    ['AD-Certificate', 'Active Directory Certificate Services', [{ logs: ['Application'], sources: ['Microsoft-Windows-CertificationAuthority'] }]],
    ['DHCP', 'DHCP Server', [{ logs: ['System'], sources: ['Microsoft-Windows-DHCP-Server'] }]],
    ['DNS', 'DNS Server', [{ logs: ['DNS Server'] }]],
    ['Print-Services', 'Print and Document Services', [{ logs: ['System'], sources: ['Microsoft-Windows-PrintService'] }]],
    ['Remote-Desktop-Services', 'Remote Desktop Services', [{ logs: ['System'], sources: ['Microsoft-Windows-TerminalServices-RemoteConnectionManager', 'TermService'] }]],
    ['Web-Server', 'Web Server (IIS)', [{ logs: ['System'], sources: ['Microsoft-Windows-IIS-W3SVC', 'Microsoft-Windows-WAS', 'Microsoft-Windows-IIS-IISReset'] }]]
  ];
  const adminLogs = () => E.logNames().filter(l => E.info(l).type === 'Administrative');
  const builtinViews = () => [
    ...ROLE_VIEWS.filter(([role]) => WS.features.isInstalled(role)).map(([role, name, any]) => ({ id: 'role-' + role, name, builtin: true, role: true,
      description: `Critical, Error, Warning and Information events for the ${name} role.`, filter: { levels: ['Critical', 'Error', 'Warning', 'Information'], any } })),
    { id: 'admin', name: 'Administrative Events', builtin: true, description: 'Critical, Error and Warning events from all administrative logs.', filter: { levels: ['Critical', 'Error', 'Warning'], logs: adminLogs() } }
  ];
  const viewLogs = v => [...new Set([...list(v.filter.logs), ...(v.filter.any || []).flatMap(p => list(p.logs))])].filter(l => E.logNames().includes(l));

  /* ---------------------------------------------------------------- the console */
  /** The Event Viewer snap-in: scope nodes, View menu and controller, for its own console or for Computer Management.
   *  opts.label: the root node's label (default 'Event Viewer (Local)'); opts.path: scope node ids above 'ev-root' in the
   *  host console (Computer Management: ['cm-root', 'cm-tools']). The host calls ctl.attach(mmc) once its console exists. */
  function snapin(opts = {}) {
    const ctl = { filters: {}, pv: { tab: 'General', mode: 'friendly' }, preview: vstate().preview !== false, analytic: false, lastFind: '', fresh: null, infos: new Map(), ovClosed: new Set(), ovOpen: new Set() };
    let mmc;
    const FULL = 'full';
    const commonMenu = () => [
      { label: '&Open Saved Log...', icon: IC.open, action: () => ctl.openSavedLog() },
      { label: 'Create &Custom View...', icon: IC.create, action: () => ctl.createCustomView() },
      { label: '&Import Custom View...', icon: IC.import, action: () => ctl.importCustomView() }
    ];
    const task = label => () => WS.apps.notImplemented(label);

    /* ---- nodes ---- */
    function listNode(info) {
      ctl.infos.set(info.id, info);
      return { id: info.id, label: info.label, icon: info.icon, actionsPane: FULL, menu: () => listMenu(info), view: () => eventList(info) };
    }
    const parentPath = log => (WINDOWS_LOGS.includes(log) ? 'Windows Logs' : E.info(log).folder ? 'Applications and Services Logs\\' + E.info(log).folder.join('\\') : 'Applications and Services Logs');
    const logInfo = log => ({ id: 'ev-log:' + log, kind: 'log', log, logs: [log], label: E.info(log).display, icon: I.log,
      path: `${parentPath(log)}\\${E.info(log).display}`, base: () => E.list(log).map(tag(log)) });
    const viewInfo = (v, parentPath) => ({ id: v.builtin ? 'ev-cvb:' + v.id : viewNodeId(v), kind: 'view', view: v, logs: viewLogs(v), log: viewLogs(v).length === 1 ? viewLogs(v)[0] : null,
      label: v.name, icon: IC.view, path: `${parentPath}\\${v.name}`, base: () => E.query(v.filter), userView: !v.builtin });
    const savedInfo = s => ({ id: 'ev-saved:' + s.id, kind: 'saved', saved: s, logs: [], log: s.log, label: s.name, icon: IC.saved, path: `Saved Logs\\${s.name}`,
      base: () => { try { const o = E.parseFile(WS.fs.readFile(s.path)); return o ? o.events.slice().sort((a, b) => b.time.localeCompare(a.time) || b.record - a.record).map(tag(o.log)) : []; } catch (e) { return []; } } });
    function folder(id, label, icon, kids, o = {}) {
      return { id, label, icon, expanded: o.expanded, actionsPane: FULL, children: kids, menu: () => [...commonMenu(), ...(o.menu || [])], view: () => folderView(id, kids, o) };
    }
    function msFolders() {
      const ops = E.logNames().filter(l => E.info(l).folder);
      const names = [...new Set(ops.map(l => E.info(l).folder[2]))].sort((a, b) => a.localeCompare(b));
      return names.map(n => folder('ev-ms:Windows/' + n, n, I.folder, () => ops.filter(l => E.info(l).folder[2] === n).map(l => listNode(logInfo(l)))));
    }
    function nodes() {
      const builtins = builtinViews(), roles = builtins.filter(v => v.role), admin = builtins.find(v => v.id === 'admin');
      const user = E.customViews().sort((a, b) => a.name.localeCompare(b.name));
      const apps = E.logNames().filter(l => !WINDOWS_LOGS.includes(l) && !E.info(l).folder);
      const appKids = () => [...apps.map(l => listNode(logInfo(l))), folder('ev-ms', 'Microsoft', I.folder, () => [folder('ev-ms:Windows', 'Windows', I.folder, msFolders)])]
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
      const saved = vstate().savedLogs || [];
      return [{ id: 'ev-root', label: opts.label || 'Event Viewer (Local)', icon: IC.app, expanded: !opts.path, actionsPane: FULL,
        menu: () => [...commonMenu(), { separator: true }, { label: 'Co&nnect to Another Computer...', icon: IC.connect, action: task('Select Computer') }],
        view: () => overviewView(),
        children: () => [
          folder('ev-cv', 'Custom Views', IC.views, () => [
            folder('ev-cv-roles', 'Server Roles', I.folder, () => roles.map(v => listNode(viewInfo(v, 'Custom Views\\Server Roles'))), { views: true }),
            listNode(viewInfo(admin, 'Custom Views')),
            ...user.map(v => listNode(viewInfo(v, 'Custom Views')))], { views: true }),
          folder('ev-wl', 'Windows Logs', I.folder, () => WINDOWS_LOGS.map(l => listNode(logInfo(l)))),
          folder('ev-asl', 'Applications and Services Logs', I.folder, appKids),
          saved.length ? folder('ev-saved', 'Saved Logs', I.folder, () => saved.map(s => listNode(savedInfo(s)))) : null,
          { id: 'ev-sub', label: 'Subscriptions', icon: IC.subs, actionsPane: FULL, view: () => subscriptionsView(),
            menu: () => [...commonMenu(), { separator: true }, { label: 'Create &Subscription...', icon: IC.subs, disabled: !vstate().collector, action: task('Subscription Properties') }] }
        ].filter(Boolean) }];
    }

    /* ---- menus ---- */
    function listMenu(info) {
      const filtered = !!ctl.filters[info.id], view = info.kind === 'view';
      return [
        ...commonMenu(), { separator: true },
        info.kind === 'log' ? { label: 'C&lear Log...', icon: IC.clear, action: () => ctl.clearLog({ id: info.id }) } : null,
        { label: view ? '&Filter Current Custom View...' : '&Filter Current Log...', icon: I.filter, action: () => ctl.filterCurrent({ id: info.id }) },
        filtered ? { label: 'Clear Filte&r', action: () => ctl.clearFilter(info.id) } : null,
        { label: 'P&roperties', icon: I.properties, action: () => ctl.properties({ id: info.id }) },
        view ? { label: '&Duplicate Custom View...', action: () => ctl.duplicateView(info) } : null,
        view ? { label: '&Export Custom View...', action: () => exportCustomView(info.view) } : null,
        { label: 'F&ind...', icon: I.find, action: () => ctl.find() },
        { label: filtered ? 'Save Filtered Log File &As...' : view ? 'Save All Events in Custom View &As...' : 'Save All Events &As...', icon: IC.save, action: () => ctl.saveAll({ id: info.id }) },
        info.kind !== 'saved' ? { label: view ? 'Attach &Task To This Custom View...' : 'A&ttach a Task To this Log...', icon: I.task, action: task('Create Basic Task Wizard') } : null,
        info.userView || info.kind === 'saved' ? { separator: true } : null,
        info.userView || info.kind === 'saved' ? { label: '&Delete', icon: I.delete, action: () => ctl.remove(info) } : null,
        info.userView || info.kind === 'saved' ? { label: 'Rena&me', icon: I.rename, action: () => ctl.rename(info) } : null
      ];
    }
    function eventMenu(rows) {
      return [
        { label: '&Event Properties', default: true, icon: I.properties, disabled: !rows.length, action: () => ctl.openEvent(rows[0]) },
        { label: '&Attach Task To This Event...', icon: I.task, action: task('Create Basic Task Wizard') },
        { separator: true },
        { label: '&Copy', icon: IC.copy, items: () => [
          { label: 'Copy &Details as Text', action: () => copyText(rows.map(eventText).join('\r\n\r\n')) },
          { label: 'Copy Details as &XML', action: () => copyText(rows.map(eventXml).join('\r\n')) }] },
        { label: '&Save Selected Events...', icon: IC.save, action: () => ctl.saveSelected({ rows }) },
        { separator: true },
        { label: 'Re&fresh', icon: I.refresh, action: () => mmc.refresh() }
      ];
    }
    function viewMenu() {
      const v = mmc && mmc.view(), lst = !!(v && v.evList && mmc.list);
      return [
        lst ? { label: '&Add/Remove Columns...', action: task('Add/Remove Columns') } : null,
        lst ? { label: '&Sort By', items: () => v.columns.map(c => ({ label: c.label, radio: true, checked: mmc.list.sortKey === c.key, action: () => mmc.list.sortBy(c.key, c.key === 'time' ? -1 : 1) })) } : null,
        lst ? { label: '&Remove Sorting', action: () => mmc.list.sortBy('time', -1) } : null,
        { separator: true },
        { label: 'Show A&nalytic and Debug Logs', checked: ctl.analytic, action: () => { ctl.analytic = !ctl.analytic; } },
        { label: '&Preview Pane', checked: ctl.preview, action: () => ctl.setPreview(!ctl.preview) }
      ];
    }

    /* ---- event list views ---- */
    function rowsOf(info) {
      const base = info.base(), f = ctl.filters[info.id], now = Date.now();
      return f ? base.filter(e => E.match(e, f, now)) : base;
    }
    function eventList(info) {
      return {
        evList: true, exportList: false, columns: columns(info.log), getId: e => String(e.record), icon: rowIcon(info.log), sortKey: 'time', sortDir: -1, multi: true, emptyText: ' ',
        rows: () => rowsOf(info),
        header: () => header(info),
        preview: rows => (ctl.preview && rows.length ? previewPane(rows[0]) : null),
        menu: rows => (rows.length ? eventMenu(rows) : []),
        onActivate: e => ctl.openEvent(e),
        itemLabel: e => `Event ${e.id}, ${e.source}`
      };
    }
    function header(info) {
      visit(info);
      const total = info.base().length, f = ctl.filters[info.id];
      if (ctl.fresh !== info.id) {
        ctl.fresh = info.id;
        setTimeout(() => { const l = mmc.list, cur = mmc.current(); if (l && cur && cur.id === info.id && !l.selected().length && l.rows().length) l.select([String(l.rows()[0].record)]); }, 0);
      }
      return h('div.ev-head',
        h('div.ev-h1', h('span.ev-hic', { html: info.icon }), h('span.ev-hname', info.label), h('span.ev-hcount', `Number of events: ${count(total)}`)),
        f ? h('div.ev-h2', h('span.ev-hic', { html: I.filter }), h('span.ev-hfilter', `${filterSummary(info.kind === 'view' ? info.label : info.log || info.label, f)}. Number of events: ${count(rowsOf(info).length)}`)) : null);
    }
    function previewPane(e) {
      return h('div.ev-pv', h('div.ev-pvhead', h('span', `Event ${e.id}, ${e.source}`), h('button.ev-pvx', { title: 'Close', html: IC.x, onClick: () => ctl.setPreview(false) })), eventPane(e, ctl.pv));
    }
    function visit(info) {
      const r = vstate().recent = vstate().recent || [];
      if (r[0] && r[0].id === info.id) return;
      const i = r.findIndex(x => x.id === info.id);
      if (i >= 0) r.splice(i, 1);
      r.unshift({ id: info.id, name: info.path, at: new Date().toISOString() });
      r.length = Math.min(r.length, 10);
      WS.store.changed('eventvwr');
    }
    function folderView(id, kids, o) {
      const rows = () => (typeof kids === 'function' ? kids() : kids).map(n => ({ id: n.id, name: n.label, icon: n.icon, info: ctl.infos.get(n.id) }));
      if (o.views) return { columns: [{ key: 'name', label: 'Name', width: 260 }, { key: 'desc', label: 'Description', width: 420, value: r => (r.info && r.info.view ? r.info.view.description : '') }],
        rows, getId: r => r.id, icon: r => r.icon, sortKey: null, multi: false, onActivate: r => ctl.select(r.id) };
      const p = r => (r.info && r.info.kind === 'log' ? E.logProps(r.info.log) : null);
      return { columns: [{ key: 'name', label: 'Name', width: 260 }, { key: 'type', label: 'Type', width: 120, value: r => (p(r) ? p(r).type : '') },
        { key: 'events', label: 'Number of Events', width: 120, type: 'num', value: r => (p(r) ? count(p(r).entries) : '') }, { key: 'size', label: 'Size', width: 100, value: r => (p(r) ? fmtSize(p(r).sizeBytes) : '') }],
      rows, getId: r => r.id, icon: r => r.icon, sortKey: null, multi: false, onActivate: r => ctl.select(r.id) };
    }

    /* ---- Overview and Summary ---- */
    function overviewView() {
      return { render: host => {
        const root = h('div.ev-ov');
        host.appendChild(root);
        const paint = () => { const top = root.scrollTop; U.clear(root); root.append(...overview()); root.scrollTop = top; };
        paint();
        ctl.paintOverview = paint;
        return { refresh: paint };
      } };
    }
    /** A small read-only grid; column widths are proportions, so the table always fits the section. */
    function grid(cols, rows) {
      const st = c => ({ flex: `${c.width} 1 0`, minWidth: Math.min(60, c.width) + 'px' });
      return h('div.ev-tbl', h('div.ev-tr.ev-th', ...cols.map(c => h('div.ev-td' + (c.align === 'right' ? '.r' : ''), { style: st(c), title: c.label }, c.label))),
        ...rows.map(r => h('div.ev-tr' + (r.cls ? '.' + r.cls : ''), { onDblclick: r.open, onPointerdown: e => { e.currentTarget.parentNode.querySelectorAll('.ev-tr.sel').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); } },
          ...r.cells.map((x, i) => h('div.ev-td' + (cols[i].align === 'right' ? '.r' : ''), { style: st(cols[i]), title: typeof x === 'string' ? x : null }, x)))));
    }
    function summary() {
      const now = Date.now(), W = [36e5, 864e5, 6048e5];
      const TYPES = ['Critical', 'Error', 'Warning', 'Information', 'Audit Success', 'Audit Failure'];
      const groups = TYPES.map(t => ({ type: t, counts: [0, 0, 0], items: new Map() }));
      for (const log of E.logNames()) for (const e of E.list(log)) {
        const age = now - new Date(e.time).getTime();
        if (age > W[2]) continue;
        const g = groups[TYPES.indexOf(isAudit(e) ? e.level : e.level === 'Verbose' ? 'Information' : e.level)];
        if (!g) continue;
        const key = `${e.id}|${e.source}|${log}`;
        let it = g.items.get(key);
        if (!it) g.items.set(key, it = { id: e.id, source: e.source, log, counts: [0, 0, 0] });
        W.forEach((w, i) => { if (age <= w) { g.counts[i]++; it.counts[i]++; } });
      }
      return groups;
    }
    function overview() {
      const sec = (key, title, ...body) => {
        const open = !ctl.ovClosed.has(key);
        return h('div.ev-sec', h('div.ev-sech', { onClick: () => { if (open) ctl.ovClosed.add(key); else ctl.ovClosed.delete(key); ctl.paintOverview(); } }, h('span', title), h('span.ev-sectog', open ? '▲' : '▼')),
          open ? h('div.ev-secb', ...body) : null);
      };
      const typeIcon = t => ({ 'Audit Success': I.auditSuccess, 'Audit Failure': I.auditFailure })[t] || LEVEL_ICON[t];
      const sumRows = [];
      for (const g of summary()) {
        const open = ctl.ovOpen.has(g.type);
        const toggle = h('span.ev-xtog', { onClick: () => { if (open) ctl.ovOpen.delete(g.type); else ctl.ovOpen.add(g.type); ctl.paintOverview(); } }, g.items.size ? (open ? '-' : '+') : '');
        sumRows.push({ cls: 'ev-sumtype', cells: [h('span.ev-cell', toggle, h('span.ev-cic', { html: typeIcon(g.type) }), g.type), '-', '-', '-', ...g.counts.map(count)] });
        if (open) [...g.items.values()].sort((a, b) => b.counts[2] - a.counts[2] || a.id - b.id).forEach(it => sumRows.push({ cls: 'ev-sumitem', open: () => ctl.drill(it), cells: ['', String(it.id), it.source, logDisplay(it.log), ...it.counts.map(count)] }));
      }
      const recent = (vstate().recent || []).filter(r => curInfo(r.id)).map(r => {
        const info = curInfo(r.id), p = info.kind === 'log' ? E.logProps(info.log) : null;
        return { open: () => ctl.select(r.id), cells: [r.name, info.kind === 'view' ? info.view.description || 'N/A' : 'N/A', p ? U.fmtDateTime(p.modified) : 'N/A', p ? U.fmtDateTime(p.created) : 'N/A'] };
      });
      const RET = { overwrite: 'Overwrite events as necessary', archive: 'Archive the log when full', manual: 'Do not overwrite events' };
      const logs = E.logNames().map(E.logProps).sort((a, b) => (a.folder ? a.name : a.display).localeCompare(b.folder ? b.name : b.display)).map(p => ({ open: () => ctl.select(p.name),
        cells: [p.folder ? p.name : p.display, `${fmtSize(p.sizeBytes)}/${fmtSize(p.maxKB * 1024)}`, U.fmtDateTime(p.modified), p.enabled ? 'Enabled' : 'Disabled', RET[p.retention]] }));
      return [
        h('div.ev-ovtop', h('span.ev-ovtitle', 'Overview and Summary'), h('span.ev-ovtime', 'Last refreshed: ' + U.fmtDateTime(new Date()))),
        sec('overview', 'Overview', h('p.ev-ovtext', 'To view events that have occurred on your computer, select the appropriate source, log or custom view node in the console tree. The Administrative Events custom view contains all the administrative events, regardless of source. An aggregate view of all the logs is shown below.')),
        sec('summary', 'Summary of Administrative Events', grid([{ label: 'Event Type', width: 170 }, { label: 'Event ID', width: 70 }, { label: 'Source', width: 230 }, { label: 'Log', width: 150 },
          { label: 'Last hour', width: 75, align: 'right' }, { label: '24 hours', width: 75, align: 'right' }, { label: '7 days', width: 75, align: 'right' }], sumRows)),
        sec('recent', 'Recently Viewed Nodes', recent.length ? grid([{ label: 'Name', width: 330 }, { label: 'Description', width: 250 }, { label: 'Modified', width: 150 }, { label: 'Created', width: 150 }], recent) : h('div.ev-none', 'No nodes have recently been viewed.')),
        sec('logs', 'Log Summary', grid([{ label: 'Log Name', width: 330 }, { label: 'Size (Current/Maximum)', width: 160 }, { label: 'Modified', width: 150 }, { label: 'Enabled', width: 70 }, { label: 'Retention Policy', width: 200 }], logs))
      ];
    }

    /* ---- Subscriptions ---- */
    function subscriptionsView() {
      return { render: host => {
        const draw = () => {
          U.clear(host);
          if (!vstate().collector) return;
          const lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 220 }, { key: 'status', label: 'Status', width: 90 }, { key: 'type', label: 'Type', width: 110 },
            { key: 'sources', label: 'Source Computers', width: 130 }, { key: 'description', label: 'Description', width: 260 }], rows: [], emptyText: 'There are no items to show in this view.' });
          host.appendChild(h('div.mmc-listwrap', lv.el));
        };
        if (!vstate().collector && !ctl.askingWec) { ctl.askingWec = true; setTimeout(() => askCollector().then(() => { ctl.askingWec = false; draw(); }), 0); }
        draw();
        return { refresh: draw };
      } };
    }
    async function askCollector() {
      const ans = await WS.ui.dialog({ title: TITLE, width: 460, onCreate: f => { ctl.collectorPrompt = f; },
        content: h('div.w32.ev-ask', 'The Windows Event Collector Service must be running and configured to manage subscriptions. Do you want to start this service and configure it to start automatically?'),
        buttons: [{ label: 'Yes', primary: true }, { label: 'No', cancel: true }] });
      ctl.collectorPrompt = null;
      if (ans !== 'Yes') return false;
      if (WS.svc.get('Wecsvc')) { WS.svc.setStartup('Wecsvc', 'AutomaticDelayedStart'); WS.svc.start('Wecsvc'); }
      vstate().collector = true;
      WS.store.changed('eventvwr');
      mmc.refresh();
      return true;
    }

    /* ---- controller ---- */
    /** Node info by id (the current node by default); logs are found even before their folder has been expanded. */
    function curInfo(id) {
      id = id || (mmc.current() && mmc.current().id);
      if (!id) return null;
      if (ctl.infos.has(id)) return ctl.infos.get(id);
      const m = id.match(/^ev-log:(.+)$/);
      return m && E.info(m[1]) && E.logNames().includes(m[1]) ? logInfo(m[1]) : null;
    }
    Object.assign(ctl, {
      info: curInfo,
      /** Select a node by id, or a log by name ('System', 'DNS Server', 'Microsoft-Windows-PowerShell/Operational'). */
      select(target) {
        mmc.refresh();
        const id = ctl.infos.has(target) || /^ev-/.test(target) ? target : 'ev-log:' + target;
        const n = mmc.tree.node(id);
        if (n) { mmc.select(id); return true; }
        const p = pathTo(id);
        if (p) { mmc.selectPath(p); return true; }
        return false;
      },
      setFilter(id, f) { ctl.filters[id] = f; mmc.refresh(); },
      clearFilter(id) { delete ctl.filters[id || mmc.current().id]; mmc.refresh(); },
      async filterCurrent(o = {}) {
        const info = curInfo(o.id);
        if (!info) return null;
        const logs = info.kind === 'saved' ? [info.log] : info.logs;
        const f = await filterDialog({ title: info.kind === 'view' ? 'Filter Current Custom View' : 'Filter Current Log', mode: 'filter', logs, filter: ctl.filters[info.id], onCreate: o.onCreate });
        if (f) ctl.setFilter(info.id, f);
        return f;
      },
      async clearLog(o = {}) {
        const info = curInfo(o.id);
        if (!info || info.kind !== 'log') return null;
        const r = await clearLog(info.log, o);
        mmc.refresh();
        return r;
      },
      properties(o = {}) {
        const info = curInfo(o.id);
        if (!info) return null;
        if (info.kind === 'log') return logProperties(info.log, o).then(r => { mmc.refresh(); return r; });
        if (info.kind === 'saved') return savedProperties(info.saved, o);
        const v = info.view;
        return nameDialog({ title: 'Custom View Properties', name: v.name, description: v.description, onCreate: o.onCreate,
          edit: v.builtin ? null : async () => { const f = await filterDialog({ title: 'Edit Custom View', mode: 'create', filter: v.filter }); if (f) E.saveCustomView({ ...v, filter: f }); },
          submit: x => (v.builtin ? { ok: true } : E.saveCustomView({ ...v, ...x, filter: (E.customViews().find(y => y.id === v.id) || v).filter })) });
      },
      find: (o = {}) => find(ctl, o),
      findNext(text) {
        const l = mmc.list;
        if (!l) return null;
        const rows = l.rows(), sel = l.selected()[0], t = text.toLowerCase();
        const start = sel ? rows.findIndex(r => r.record === sel.record) + 1 : 0;
        const hay = e => [e.message, e.source, e.id, e.task, levelText(e), E.keyword(e), e.user, e.computer].join('\n').toLowerCase();
        const hit = [...rows.slice(start), ...rows.slice(0, start)].find(e => hay(e).includes(t));
        if (hit) { l.select([String(hit.record)]); }
        return hit || null;
      },
      saveAll(o = {}) {
        const info = curInfo(o.id);
        return info ? saveEvents(rowsOf(info), { ...o, log: info.log, defaultName: info.label.replace(/[\\/:*?"<>|]/g, '') }) : null;
      },
      saveSelected(o = {}) { const rows = o.rows || mmc.selection(); return rows.length ? saveEvents(rows, { ...o, log: rows[0].log }) : null; },
      openEvent(e, o = {}) {
        if (!e) return null;
        return eventProperties(e.log, e.record, { rows: () => (mmc.list ? mmc.list.rows() : [e]), onNavigate: x => { if (mmc.list) mmc.list.select([String(x.record)]); }, ...o });
      },
      async createCustomView(o = {}) {
        const v = await createCustomView(o);
        if (v) { mmc.refresh(); ctl.select(viewNodeId(v)); }
        return v;
      },
      async importCustomView(o = {}) {
        const v = await importCustomView(o);
        if (v) { mmc.refresh(); ctl.select(viewNodeId(v)); }
        return v;
      },
      async openSavedLog(o = {}) {
        const s = await openSavedLog(o);
        if (s) ctl.select('ev-saved:' + s.id);
        return s;
      },
      async duplicateView(info) {
        const name = await WS.ui.inputBox({ title: 'Duplicate Custom View', prompt: 'Name:', value: `${info.view.name} (1)` });
        if (!name) return null;
        const r = E.saveCustomView({ name, description: info.view.description, filter: info.view.filter });
        if (r.ok) { mmc.refresh(); ctl.select(viewNodeId(r.view)); }
        return r.view;
      },
      async rename(info) {
        const name = await WS.ui.inputBox({ title: 'Rename', prompt: 'New name:', value: info.label, validate: v => (v.trim() ? null : 'Type a name.') });
        if (!name) return;
        if (info.kind === 'saved') { info.saved.name = name.trim(); WS.store.changed('eventvwr'); refreshAll(); }
        else E.saveCustomView({ ...info.view, name });
      },
      async remove(info) {
        const what = info.kind === 'saved' ? `the saved log "${info.label}"` : `the custom view "${info.label}"`;
        if (await WS.ui.msgbox({ title: TITLE, icon: 'warning', message: `Are you sure you want to delete ${what}?`, buttons: ['Yes', 'No'] }) !== 'Yes') return false;
        if (info.kind === 'saved') { vstate().savedLogs = vstate().savedLogs.filter(s => s.id !== info.saved.id); WS.store.changed('eventvwr'); refreshAll(); }
        else E.removeCustomView(info.view.id);
        ctl.infos.delete(info.id);
        mmc.refresh();
        return true;
      },
      /** Overview > Summary of Administrative Events: double-clicking an event row shows those events in their log. */
      drill(it) { if (ctl.select(it.log)) ctl.setFilter('ev-log:' + it.log, { logs: [it.log], ids: String(it.id), sources: [it.source], levels: [] }); },
      setPreview(on) { ctl.preview = !!on; vstate().preview = !!on; WS.store.changed('eventvwr'); mmc.win.el.classList.toggle('ev-nopv', !on); mmc.refresh(); }
    });
    const pathTo = id => { const p = rawPath(id); return p ? [...(opts.path || []), ...p] : null; };
    function rawPath(id) {
      const m = id.match(/^ev-log:(.+)$/);
      if (!m) {
        if (/^ev-(cv|wl|asl|saved|sub)$/.test(id)) return ['ev-root', id];
        if (id === 'ev-cv-roles' || /^ev-cv(b:admin|:)/.test(id)) return ['ev-root', 'ev-cv', id];
        if (/^ev-cvb:role-/.test(id)) return ['ev-root', 'ev-cv', 'ev-cv-roles', id];
        if (/^ev-saved:/.test(id)) return ['ev-root', 'ev-saved', id];
        const ms = id.match(/^ev-ms(?::Windows(?:\/.+)?)?$/);
        return ms ? ['ev-root', 'ev-asl', 'ev-ms', 'ev-ms:Windows', id].slice(0, id === 'ev-ms' ? 3 : id === 'ev-ms:Windows' ? 4 : 5) : null;
      }
      const log = m[1], info = E.info(log);
      if (!info || !E.logNames().includes(log)) return null;
      if (WINDOWS_LOGS.includes(log)) return ['ev-root', 'ev-wl', id];
      if (!info.folder) return ['ev-root', 'ev-asl', id];
      return ['ev-root', 'ev-asl', 'ev-ms', 'ev-ms:Windows', 'ev-ms:Windows/' + info.folder[2], id];
    }

    ctl.attach = m => {
      mmc = m; ctl.mmc = m;
      m.win.el.classList.toggle('ev-nopv', !ctl.preview);
      consoles.add(ctl);
      m.win.onClose(() => consoles.delete(ctl));
    };
    return { ctl, nodes, viewMenu };
  }
  /** Topics an Event Viewer console refreshes on. */
  const TOPICS = ['events', 'features', 'system', 'services'];
  function launch(opts = {}) {
    const snap = snapin();
    const mmc = WS.mmc.create({ app: 'eventvwr', title: TITLE, icon: IC.app, width: 1240, height: 740, actionsPane: 'full', topics: TOPICS, nodes: snap.nodes, viewMenu: snap.viewMenu });
    const ctl = snap.ctl;
    ctl.attach(mmc);
    mmc.win.el.classList.add('ev-win');
    mmc.win.eventvwr = ctl;
    if (opts.select) ctl.select(opts.select);
    if (opts.onCreate) opts.onCreate(ctl);
    return mmc.win;
  }

  const filterLog = (log, opts = {}) => filterDialog({ ...opts, logs: [].concat(log), mode: opts.mode || 'filter' });
  Object.assign(api, { launch, snapin, TOPICS, eventProperties, filterLog, clearLog, logProperties, saveEvents, find, createCustomView, importCustomView, exportCustomView, openSavedLog,
    columns, rowIcon, levelText, levelIcon, eventText, eventXml, copyText, queryXml, viewXml, parseViewXml, icons: IC, consoles: () => [...consoles] });
  WS.eventvwr = api;
  WS.apps.register({ id: 'eventvwr', name: TITLE, icon: IC.app, launch, keywords: ['eventvwr', 'eventvwr.msc', 'event viewer', 'logs'] });
})();
