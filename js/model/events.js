/* Event log model: WS.evt. Logs are kept in state.events.logs[<log name>] as arrays (newest last),
 * capped so localStorage stays small. Model modules write real event IDs here so Event Viewer
 * and Get-WinEvent / Get-EventLog show what the student did. A fresh state starts with a short, realistic
 * history (the latest cumulative update with its restart, then the image being shut down); every boot adds
 * the usual System / Security / Application entries.
 * Entry: { record, id, level, source, time, message, task, user, computer }
 * Created lazily (older saved states lack them):
 *   state.events.props[log] = { maxKB, retention: 'overwrite' | 'archive' | 'manual', retainDays, enabled, cleared }
 *   state.events.customViews[] = { id, name, description, filter }   (Event Viewer > Custom Views)
 * API besides logNames / info / write / audit / list / clear:
 *   logProps(log) -> { name, display, type: 'Administrative' | 'Operational', classic, folder, path, maxKB, retention, retainDays,
 *                      enabled, entries, sizeBytes, created, modified, overflowAction, minimumRetentionDays, logMode } | null
 *   setLogProps(log, { maxKB, retention, retainDays, enabled }) -> { ok, props } | { ok: false, code, error }
 *   keyword(entry) -> 'Audit Success' | 'Audit Failure' | 'Classic';  levelValue(entry) -> 0 (audit) .. 5 (Verbose)
 *   parseIds('1,3,5-99,-76') -> { include: [[a, b]], exclude: [[a, b]] }, or null when the text is not valid
 *   match(entry, filter), query(filter) -> entries tagged with .log, newest first
 *     filter: { logs[], sources[], levels[], ids, tasks[], keywords[], users, computers,
 *               time: 'any' | '1h' | '12h' | '24h' | '7d' | '30d', any: [partial filters, unioned] }
 *   customViews(), saveCustomView({ id?, name, description, filter }) -> { ok, view }, removeCustomView(id)
 *   serialize(log, entries) / parseFile(text): the simulator's .evtx file format (Save All Events As, archives). */
(function () {
  'use strict';
  const WS = window.WS;
  const CAP = 250;
  const ADMIN = 'Administrative', OPER = 'Operational';

  const classic = (maxKB, o) => ({ maxKB, classic: true, type: ADMIN, ...o });
  const oper = (folder, display, maxKB, o) => ({ display, folder: ['Microsoft', 'Windows', folder], maxKB, type: OPER, ...o });
  const LOGS = {
    Application: classic(20480), Security: classic(20480), Setup: { maxKB: 1028, type: OPER }, System: classic(20480),
    ForwardedEvents: { display: 'Forwarded Events', maxKB: 20480, type: OPER },
    'Directory Service': classic(1028, { when: () => WS.sys.isDC() }),
    'DNS Server': classic(1028, { when: () => WS.features.isInstalled('DNS') }),
    'DFS Replication': classic(15360, { when: () => WS.sys.isDC() }),
    HardwareEvents: classic(20480, { display: 'Hardware Events' }),
    'Internet Explorer': classic(512, { retention: 'manual', retainDays: 7 }),
    'Key Management Service': classic(20480),
    'Windows PowerShell': classic(15360),
    'Microsoft-Windows-DNS-Client/Operational': oper('DNS Client Events', 'Operational', 1028, { enabled: false }),
    'Microsoft-Windows-GroupPolicy/Operational': oper('GroupPolicy', 'Operational', 4096),
    'Microsoft-Windows-PowerShell/Operational': oper('PowerShell', 'Operational', 15360),
    'Microsoft-Windows-TaskScheduler/Operational': oper('TaskScheduler', 'Operational', 10240, { enabled: false }),
    'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational': oper('TerminalServices-LocalSessionManager', 'Operational', 1028),
    'Microsoft-Windows-Windows Defender/Operational': oper('Windows Defender', 'Operational', 16384),
    'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall': oper('Windows Firewall With Advanced Security', 'Firewall', 1028),
    'Microsoft-Windows-WindowsUpdateClient/Operational': oper('WindowsUpdateClient', 'Operational', 1028)
  };
  for (const [name, d] of Object.entries(LOGS)) d.display = d.display || name;

  /** Levels as Event Viewer shows them. Security log entries use 'Audit Success' / 'Audit Failure'. */
  const LEVELS = ['Critical', 'Error', 'Warning', 'Information', 'Verbose', 'Audit Success', 'Audit Failure'];
  const LEVEL_NUM = { Critical: 1, Error: 2, Warning: 3, Information: 4, Verbose: 5, 'Audit Success': 0, 'Audit Failure': 0 };
  /** Providers that log as LocalSystem; classic sources and the audit log show User: N/A. */
  const SYSTEM_USER = new Set(['Microsoft-Windows-Kernel-General', 'Microsoft-Windows-Servicing', 'Microsoft-Windows-WindowsUpdateClient',
    'Microsoft-Windows-User Profiles Service', 'Microsoft-Windows-RestartManager', 'Microsoft-Windows-DNS-Server-Service']);
  const sysTime = d => new Date(d).toISOString().replace(/\.(\d{3})Z$/, '.$1000000Z');

  WS.store.init('events', s => {
    s.events = { nextRecord: 1, logs: { Application: [], Security: [], Setup: [], System: [], 'Windows PowerShell': [] } };
    seed(s);
  });

  /* ---- a fresh lab server's history (minutes before the state was created) ---- */
  function seed(s) {
    const sys = s.system || {}, name = sys.computerName || 'WIN-SERVER', build = sys.build || '26100.1742';
    const now = Date.now(), at = m => new Date(now - Math.round(m * 60000)).toISOString();
    const kb = 'KB5043080', update = `2024-09 Cumulative Update for Microsoft server operating system version 24H2 for x64-based Systems (${kb})`;
    const g = () => WS.util.guid().toLowerCase();
    const host = g(), runspace = g();
    const psDetails = lines => `\n\nDetails: \n\t${lines.join('\n\t')}\n\n\tSequenceNumber=${lines.length + 11}\n\n\tHostName=ConsoleHost\n\tHostVersion=5.1.${build}\n\tHostId=${host}\n\tHostApplication=C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass\n\tEngineVersion=5.1.${build}\n\tRunspaceId=${runspace}\n\tPipelineId=\n\tCommandName=\n\tCommandType=\n\tScriptName=\n\tCommandPath=\n\tCommandLine=`;
    const provider = p => `Provider "${p}" is Started. ${psDetails([`ProviderName=${p}`, 'NewProviderState=Started'])}`;
    const engine = (a, b) => `Engine state is changed from ${a} to ${b}. ${psDetails([`NewEngineState=${b}`, `PreviousEngineState=${a}`])}`;
    const startup = m => [
      [m, 'System', 12, 'Microsoft-Windows-Kernel-General', 0, 0, `The operating system started at system time ${sysTime(at(m))}.`],
      [m - 0.01, 'System', 6009, 'EventLog', 0, 0, `Microsoft (R) Windows (R) 10.00. ${build.split('.')[0]}  Multiprocessor Free.`],
      [m - 0.02, 'System', 6005, 'EventLog', 0, 0, 'The Event log service was started.'],
      [m - 0.03, 'Security', 4608, 'Microsoft-Windows-Security-Auditing', 'Audit Success', 'Security State Change', 'Windows is starting up.\n\nThis event is logged when LSASS.EXE starts and the auditing subsystem is initialized.'],
      [m - 0.2, 'Application', 902, 'Microsoft-Windows-Security-SPP', 0, 0, `The Software Protection service has started.\n10.0.${build}`],
      [m - 0.3, 'Application', 1531, 'Microsoft-Windows-User Profiles Service', 0, 0, 'The User Profile Service has started successfully.']
    ];
    const rows = [
      ...startup(61),
      [60.5, 'Application', 16394, 'Microsoft-Windows-Security-SPP', 0, 0, 'Offline downlevel migration succeeded.'],
      [60, 'System', 37, 'Microsoft-Windows-Time-Service', 0, 0, 'The time provider NtpClient is currently receiving valid time data from time.windows.com,0x8 (ntp.m|0x8|0.0.0.0:123->20.101.57.9:123).', 'LOCAL SERVICE'],
      [59.9, 'System', 35, 'Microsoft-Windows-Time-Service', 0, 0, 'The time service is now synchronizing the system time with the time source time.windows.com,0x8 (ntp.m|0x8|0.0.0.0:123->20.101.57.9:123) with reference id 154748180. Current local stratum number is 4.', 'LOCAL SERVICE'],
      [59, 'System', 10016, 'Microsoft-Windows-DistributedCOM', 'Warning', 0, 'The application-specific permission settings do not grant Local Activation permission for the COM Server application with CLSID \n{C2F03A33-21F5-47FA-B4BB-156362A2F239}\n and APPID \n{316CDED5-E4AE-4B15-9113-7055D84DCC97}\n to the user NT AUTHORITY\\LOCAL SERVICE SID (S-1-5-19) from address LocalHost (Using LRPC) running in the application container Unavailable SID (Unavailable). This security permission can be modified using the Component Services administrative tool.', 'LOCAL SERVICE'],
      [57.2, 'Windows PowerShell', 600, 'PowerShell', 0, 'Provider Lifecycle', provider('Registry')],
      [57.1, 'Windows PowerShell', 600, 'PowerShell', 0, 'Provider Lifecycle', provider('FileSystem')],
      [57, 'Windows PowerShell', 400, 'PowerShell', 0, 'Engine Lifecycle', engine('None', 'Available')],
      [56, 'Windows PowerShell', 403, 'PowerShell', 0, 'Engine Lifecycle', engine('Available', 'Stopped')],
      [55, 'Application', 10000, 'Microsoft-Windows-RestartManager', 0, 0, `Starting session 0 - ${sysTime(at(55))}.`],
      [54.5, 'Setup', 1, 'Microsoft-Windows-Servicing', 0, 0, `Initiating changes for package ${kb}. Current state is Absent. Target state is Installed. Client id: UpdateAgentLCU.`],
      [54, 'System', 43, 'Microsoft-Windows-WindowsUpdateClient', 0, 'Windows Update Agent', `Installation Started: Windows has started installing the following update: ${update}`],
      [50, 'Setup', 4, 'Microsoft-Windows-Servicing', 0, 0, `A reboot is necessary before package ${kb} can be changed to the Installed state.`],
      [49.6, 'Application', 10001, 'Microsoft-Windows-RestartManager', 0, 0, `Ending session 0 started ${sysTime(at(55))}.`],
      [49, 'Application', 8224, 'VSS', 0, 0, 'The VSS service is shutting down due to idle timeout.'],
      [48, 'System', 1074, 'User32', 0, 0, `The process C:\\Windows\\system32\\svchost.exe (${name}) has initiated the restart of computer ${name} on behalf of user NT AUTHORITY\\SYSTEM for the following reason: Operating System: Service pack (Planned)\n Reason Code: 0x80020010\n Shutdown Type: restart\n Comment: `, 'NT AUTHORITY\\SYSTEM'],
      [47.9, 'System', 6006, 'EventLog', 0, 0, 'The Event log service was stopped.'],
      ...startup(46),
      [45, 'Setup', 2, 'Microsoft-Windows-Servicing', 0, 0, `Package ${kb} was successfully changed to the Installed state.`],
      [44.5, 'System', 19, 'Microsoft-Windows-WindowsUpdateClient', 0, 'Windows Update Agent', `Installation Successful: Windows successfully installed the following update: ${update}`],
      [44, 'Application', 16384, 'Microsoft-Windows-Security-SPP', 0, 0, `Successfully scheduled Software Protection service for re-start at ${at(-1440).replace(/\.\d{3}Z$/, 'Z')}. Reason: RulesEngine.`],
      [30, 'System', 1074, 'User32', 0, 0, `The process C:\\Windows\\system32\\winlogon.exe (${name}) has initiated the power off of computer ${name} on behalf of user ${name}\\Administrator for the following reason: No title for this reason could be found\n Reason Code: 0x500ff\n Shutdown Type: power off\n Comment: `, `${name}\\Administrator`],
      [29.9, 'System', 6006, 'EventLog', 0, 0, 'The Event log service was stopped.']
    ];
    for (const [m, log, id, source, level, task, message, user] of rows) {
      (s.events.logs[log] = s.events.logs[log] || []).push({ record: s.events.nextRecord++, id, level: level || 'Information', source, time: at(m), message,
        task: task || 'None', user: user || (log === 'Security' || !SYSTEM_USER.has(source) ? 'N/A' : 'SYSTEM'), computer: name });
    }
  }

  /* ---- per-log settings ---- */
  function settings(log) {
    const d = LOGS[log] || {}, p = (WS.state.events.props || {})[log] || {};
    return { maxKB: p.maxKB || d.maxKB || 20480, retention: p.retention || d.retention || 'overwrite',
      retainDays: p.retainDays != null ? p.retainDays : d.retainDays || 0, enabled: p.enabled != null ? p.enabled : d.enabled !== false };
  }
  function logProps(log) {
    const d = LOGS[log];
    if (!d) return null;
    const s = settings(log), ev = WS.state.events, list = ev.logs[log] || [], p = (ev.props || {})[log] || {};
    const created = WS.state.system.installDate || WS.state.meta.created;
    const modified = [list.length ? list[list.length - 1].time : null, p.cleared, created].filter(Boolean).sort().pop();
    const overwrite = s.retention === 'overwrite', older = s.retention === 'manual' && s.retainDays > 0;
    return { name: log, display: d.display, type: d.type, classic: !!d.classic, folder: d.folder || null,
      path: `%SystemRoot%\\System32\\Winevt\\Logs\\${log.replace(/\//g, '%4')}.evtx`, ...s, entries: list.length,
      sizeBytes: 4096 + 65536 * Math.max(1, Math.ceil(list.length / 60)), created, modified,
      overflowAction: overwrite ? 'OverwriteAsNeeded' : older ? 'OverwriteOlder' : 'DoNotOverwrite',
      minimumRetentionDays: overwrite ? 0 : older ? s.retainDays : -1,
      logMode: overwrite ? 'Circular' : s.retention === 'archive' ? 'AutoBackup' : 'Retain' };
  }
  function setLogProps(log, o = {}) {
    const d = LOGS[log];
    if (!d || !WS.evt.logNames().includes(log)) return { ok: false, code: 'NotFound', error: 'The specified channel could not be found.' };
    const ev = WS.state.events, p = { ...((ev.props || {})[log] || {}) };
    if (o.maxKB != null) {
      const kb = Math.floor(Number(o.maxKB));
      if (!(kb >= 64 && kb <= 4194240)) return { ok: false, code: 'InvalidSize', error: 'The maximum log size must be between 64 KB and 4,194,240 KB.' };
      p.maxKB = kb;
    }
    if (o.retention != null) {
      if (!['overwrite', 'archive', 'manual'].includes(o.retention)) return { ok: false, code: 'InvalidArgument', error: `'${o.retention}' is not a valid retention policy.` };
      p.retention = o.retention;
      if (o.retention !== 'manual' && o.retainDays == null) p.retainDays = 0;
    }
    if (o.retainDays != null) p.retainDays = Math.max(0, Math.floor(Number(o.retainDays)) || 0);
    if (o.enabled != null && !!o.enabled !== settings(log).enabled) {
      if (d.classic) return { ok: false, code: 'NotSupported', error: 'Logging cannot be turned off for this log.' };
      p.enabled = !!o.enabled;
    }
    (ev.props = ev.props || {})[log] = p;
    WS.store.changed('events');
    return { ok: true, props: logProps(log) };
  }

  /* ---- writing ---- */
  const ELF = 'ElfFile';
  const plain = ({ record, id, level, source, time, message, task, user, computer }) => ({ record, id, level, source, time, message, task, user, computer });
  function serialize(log, entries) {
    return ELF + '\r\n' + JSON.stringify({ log, computer: WS.sys.fqdn(), saved: new Date().toISOString(), events: entries.map(plain) });
  }
  function parseFile(text) {
    if (!String(text || '').startsWith(ELF)) return null;
    try { const o = JSON.parse(String(text).slice(ELF.length)); return o && Array.isArray(o.events) ? o : null; } catch (e) { return null; }
  }
  /** "Archive the log when full": the full log goes to Archive-<log>-<time>.evtx and logging starts over. */
  function archive(log, entries) {
    try {
      const dir = 'C:\\Windows\\System32\\winevt\\Logs', t = new Date().toISOString().replace(/[T:.]/g, '-').replace(/Z$/, '');
      WS.fs.ensureDir(dir);
      WS.fs.writeFile(`${dir}\\Archive-${log.replace(/\//g, '%4')}-${t}.evtx`, serialize(log, entries));
    } catch (e) { /* the archive is best effort */ }
  }

  function write(log, e) {
    const ev = WS.state.events;
    const s = settings(log);
    if (!s.enabled) return null;
    const list = ev.logs[log] = ev.logs[log] || [];
    if (list.length >= CAP && s.retention !== 'overwrite') {
      if (s.retention === 'manual') return null;
      archive(log, list.splice(0));
    }
    const entry = {
      record: ev.nextRecord++,
      id: e.id,
      level: e.level || (log === 'Security' ? 'Audit Success' : 'Information'),
      source: e.source,
      time: e.time || new Date().toISOString(),
      message: e.message || '',
      task: e.task || 'None',
      user: e.user || (log === 'Security' || !SYSTEM_USER.has(e.source) ? 'N/A' : 'SYSTEM'),
      computer: WS.sys.fqdn()
    };
    list.push(entry);
    if (list.length > CAP) list.splice(0, list.length - CAP);
    WS.store.changed('events');
    return entry;
  }

  /** The signed-in account's domain: the NetBIOS domain on a DC, the computer name for a local account. */
  const accountDomain = () => (WS.sys.isDC() ? WS.sys.netbiosDomain() : WS.sys.name);
  /** Security audit helper: who did it (Subject) plus the event's own fields. */
  function subjectBlock() {
    const dom = accountDomain();
    const user = (WS.session && WS.session.user) || 'Administrator';
    return `Subject:\n\tSecurity ID:\t\t${dom}\\${user}\n\tAccount Name:\t\t${user}\n\tAccount Domain:\t\t${dom}\n\tLogon ID:\t\t0x${(0x3E7 + (WS.state.meta.bootCount || 1) * 4099).toString(16).toUpperCase()}`;
  }
  function audit(id, task, text, fields) {
    const body = [text, '', subjectBlock()];
    for (const [title, rows] of fields || []) {
      body.push('', title + ':');
      for (const [k, v] of rows) body.push(`\t${k}:\t\t${v == null || v === '' ? '-' : v}`);
    }
    return write('Security', { id, source: 'Microsoft-Windows-Security-Auditing', task, message: body.join('\n') });
  }

  /* ---- filtering (Event Viewer's Filter Current Log / custom views) ---- */
  const WINDOW = { '1h': 36e5, '12h': 432e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
  const items = v => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,;]/)).map(x => String(x).trim()).filter(x => x && !/^<All .*>$/i.test(x));
  const keyword = e => (e.level === 'Audit Success' || e.level === 'Audit Failure' ? e.level : 'Classic');
  const levelValue = e => (LEVEL_NUM[e.level] != null ? LEVEL_NUM[e.level] : 4);
  function parseIds(text) {
    const s = String(text == null ? '' : text).trim();
    const out = { include: [], exclude: [] };
    if (!s || /^<All Event IDs>$/i.test(s)) return out;
    for (const part of s.split(',').map(x => x.trim())) {
      if (!part) continue;
      const m = part.match(/^(-)?\s*(\d+)\s*(?:-\s*(\d+))?$/);
      if (!m) return null;
      const a = +m[2], b = m[3] != null ? +m[3] : a;
      if (a > 65535 || b > 65535 || b < a) return null;
      (m[1] ? out.exclude : out.include).push([a, b]);
    }
    return out;
  }
  const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  function match(e, f = {}, now = Date.now()) {
    if (WINDOW[f.time] && now - new Date(e.time).getTime() > WINDOW[f.time]) return false;
    const levels = items(f.levels);
    if (levels.length) {
      const want = new Set(levels.map(l => LEVEL_NUM[l]));
      if (want.has(4)) want.add(0);
      if (!want.has(levelValue(e))) return false;
    }
    const ids = parseIds(f.ids);
    if (!ids) return false;
    const inside = ([a, b]) => e.id >= a && e.id <= b;
    if (ids.include.length && !ids.include.some(inside)) return false;
    if (ids.exclude.some(inside)) return false;
    const any = (list, v) => !list.length || list.some(x => same(x, v));
    if (!any(items(f.sources), e.source) || !any(items(f.tasks), e.task) || !any(items(f.keywords), keyword(e))) return false;
    const users = items(f.users);
    if (users.length && !users.some(u => same(u, e.user) || same(u, String(e.user).split('\\').pop()))) return false;
    const comps = items(f.computers);
    if (comps.length && !comps.some(c => same(c, e.computer) || same(c, String(e.computer).split('.')[0]))) return false;
    return true;
  }
  function query(f = {}) {
    const byTime = (a, b) => b.time.localeCompare(a.time) || b.record - a.record;
    if (f.any && f.any.length) {
      const seen = new Map();
      for (const part of f.any) for (const e of query({ ...f, any: null, ...part })) seen.set(e.record, e);
      return [...seen.values()].sort(byTime);
    }
    let logs = items(f.logs).filter(l => LOGS[l] || WS.state.events.logs[l]);
    if (!logs.length && items(f.sources).length) logs = WS.evt.logNames();
    const now = Date.now(), out = [];
    for (const log of logs) for (const e of WS.evt.list(log)) if (match(e, f, now)) out.push({ ...e, log });
    return out.sort(byTime);
  }

  WS.evt = {
    LEVELS, LEVEL_NUM,
    logNames: () => Object.keys(LOGS).filter(n => !LOGS[n].when || LOGS[n].when()),
    info: name => LOGS[name] || null,
    write,
    audit,
    list(log, opts = {}) {
      let l = (WS.state.events.logs[log] || []).slice().reverse();
      if (opts.id != null) l = l.filter(e => [].concat(opts.id).includes(e.id));
      if (opts.level) l = l.filter(e => [].concat(opts.level).includes(e.level));
      if (opts.source) l = l.filter(e => e.source.toLowerCase().includes(String(opts.source).toLowerCase()));
      if (opts.newest) l = l.slice(0, opts.newest);
      return l;
    },
    clear(log) {
      const ev = WS.state.events;
      ev.logs[log] = [];
      (ev.props = ev.props || {})[log] = { ...(ev.props[log] || {}), cleared: new Date().toISOString() };
      const user = (WS.session && WS.session.user) || 'Administrator';
      if (log === 'Security') write('Security', { id: 1102, source: 'Microsoft-Windows-Eventlog', level: 'Audit Success', task: 'Log clear', message: 'The audit log was cleared.\n' + subjectBlock() });
      else write('System', { id: 104, source: 'Microsoft-Windows-Eventlog', task: 'Log clear', user: `${accountDomain()}\\${user}`, message: `The ${log} log file was cleared.` });
      WS.store.changed('events');
    },
    logProps, setLogProps, keyword, levelValue, parseIds, match, query, serialize, parseFile,
    customViews: () => (WS.state.events.customViews || []).slice(),
    saveCustomView(v = {}) {
      const name = String(v.name || '').trim();
      if (!name) return { ok: false, code: 'InvalidName', error: 'Type a name for the custom view.' };
      const ev = WS.state.events, list = ev.customViews = ev.customViews || [];
      const view = { id: v.id || 'cv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, description: v.description || '',
        filter: JSON.parse(JSON.stringify(v.filter || {})), created: v.created || new Date().toISOString() };
      const i = list.findIndex(x => x.id === view.id);
      if (i >= 0) list[i] = view; else list.push(view);
      WS.store.changed('events');
      return { ok: true, view };
    },
    removeCustomView(id) {
      const ev = WS.state.events, before = (ev.customViews || []).length;
      ev.customViews = (ev.customViews || []).filter(v => v.id !== id);
      if (ev.customViews.length === before) return { ok: false, code: 'NotFound', error: 'The custom view could not be found.' };
      WS.store.changed('events');
      return { ok: true };
    }
  };

  /* ---- boot / shutdown events, as a real server writes them ---- */
  WS.sys.on('shutdown', ({ restart, user, reason }) => {
    const dom = accountDomain();
    // the Shutdown Event Tracker's choice, or what Windows writes when none was given
    const why = reason ? reason.title : 'No title for this reason could be found';
    const code = reason ? '0x' + (reason.code >>> 0).toString(16) : '0x500ff';
    const proc = reason && reason.process ? reason.process : 'C:\\Windows\\system32\\winlogon.exe';
    const who = reason && reason.system ? 'NT AUTHORITY\\SYSTEM' : `${dom}\\${user || 'Administrator'}`;
    write('System', {
      id: 1074, source: 'User32', user: who,
      message: `The process ${proc} (${WS.sys.name}) has initiated the ${restart ? 'restart' : 'power off'} of computer ${WS.sys.name} on behalf of user ${who} for the following reason: ${why}\n Reason Code: ${code}\n Shutdown Type: ${restart ? 'restart' : 'power off'}\n Comment: ${(reason && reason.comment) || ''}`
    });
    write('System', { id: 6006, source: 'EventLog', message: 'The Event log service was stopped.' });
  });
  WS.sys.on('boot', () => {
    const now = new Date(), build = String(WS.state.system.build || '26100');
    // VMConnect's Turn Off / Reset: the machine lost power, so this boot reports an unexpected shutdown
    const lost = WS.state.system.powerLoss;
    if (lost) {
      delete WS.state.system.powerLoss;
      const t = new Date(lost.time);
      write('System', { id: 41, level: 'Critical', source: 'Microsoft-Windows-Kernel-Power', task: '(63)', message: 'The system has rebooted without cleanly shutting down first. This error could be caused if the system stopped responding, crashed, or lost power unexpectedly.' });
      write('System', { id: 6008, level: 'Error', source: 'EventLog', message: `The previous system shutdown at ${WS.util.fmtTime(t, true)} on ${WS.util.fmtDate(t)} was unexpected.` });
      WS.state.system.unexpectedShutdown = { time: lost.time, kind: lost.kind };
    }
    write('System', { id: 12, source: 'Microsoft-Windows-Kernel-General', message: `The operating system started at system time ${sysTime(now)}.` });
    write('System', { id: 6009, source: 'EventLog', message: `Microsoft (R) Windows (R) 10.00. ${build.split('.')[0]}  Multiprocessor Free.` });
    write('System', { id: 6005, source: 'EventLog', message: 'The Event log service was started.' });
    write('Security', { id: 4608, source: 'Microsoft-Windows-Security-Auditing', task: 'Security State Change', message: 'Windows is starting up.\n\nThis event is logged when LSASS.EXE starts and the auditing subsystem is initialized.' });
    write('Application', { id: 902, source: 'Microsoft-Windows-Security-SPP', message: `The Software Protection service has started.\n10.0.${build}` });
    write('Application', { id: 1531, source: 'Microsoft-Windows-User Profiles Service', message: 'The User Profile Service has started successfully.' });
    write('Application', { id: 16384, source: 'Microsoft-Windows-Security-SPP', message: `Successfully scheduled Software Protection service for re-start at ${new Date(now.getTime() + 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z')}. Reason: RulesEngine.` });
  });
})();
