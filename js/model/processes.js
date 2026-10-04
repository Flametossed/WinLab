/* Process model: WS.proc. Task Manager, Get-Process/Stop-Process/Start-Process, tasklist/taskkill and
 * Win32_Process all read it, so a process ended in one shows up gone in the others.
 *
 * Nothing about a process is stored in WS.state except what a lab sets up: the list is derived on demand from
 *   - the kernel and core user-mode processes (System, smss, csrss, wininit, services, lsass, winlogon, dwm...);
 *   - running services (one svchost.exe per service, as Windows does on a 4 GB VM; lsass.exe hosts NTDS, Kdc,
 *     Netlogon, SamSs, KeyIso and VaultSvc; dns.exe, spoolsv.exe, MsMpEng.exe and friends run on their own);
 *   - the signed-in session (explorer.exe, sihost, taskhostw, Start, Search, ...) and startup apps;
 *   - open windows (mmc.exe per console, ServerManager.exe, notepad.exe, WindowsTerminal.exe with a
 *     powershell.exe/cmd.exe per tab, Taskmgr.exe...);
 *   - lab-defined processes in processes.custom[].
 * PIDs, start times, priority, affinity and efficiency mode live in memory and reset at every boot, as on Windows.
 *
 * State (the lab API):
 *   processes.custom[]  = { id, image, path, description, company, version, user, cpu (average %), mem (KB),
 *                           leakKBps, disk (MB/s), net (Mbps), threads, kind: 'background'|'app',
 *                           status: 'Running'|'Not responding', cmdLine,
 *                           startWith: 'boot' | 'logon' | 'service:<name>' | 'startup:<id>' }
 *   processes.startup[] = { id, name, publisher, command, location: 'HKLM'|'HKCU'|'Startup', enabled, impact }
 *   system.crash        = { code, name, time } while a bug check waits for the next boot to be logged
 *
 * API: list(), get(pid), find(name), byKey(key), kill(pid, { force, tree, allowCritical, graceful }),
 *   setPriority(pid, cls), setAffinity(pid, mask), setEfficiency(pid, on), dump(pid), startupApps(),
 *   setStartupEnabled(idOrName, on), addCustom(def), addStartup(def), sample(), totals(), pidFor(key),
 *   onLogon(), onLogoff(), sessionActive(), PRIORITIES. Results follow the model convention
 *   ({ ok, code, error }); codes: NotFound, AccessDenied, Critical, NotAllowed. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util;
  const NCPU = 4, TOTAL_KB = 4193780; // the VM: 4 virtual processors, 4 GB (what systeminfo and Get-ComputerInfo report)
  const SYS32 = 'C:\\Windows\\System32\\';

  WS.store.init('processes', s => {
    s.processes = {
      custom: [],
      startup: [{ id: 'securityhealth', name: 'Windows Security notification icon', publisher: 'Microsoft Corporation', command: '%windir%\\system32\\SecurityHealthSystray.exe', location: 'HKLM', enabled: true, impact: 'Not measured' }]
    };
  });

  /* PriorityClass names (PowerShell) with the base priority and Task Manager's label. */
  const PRIORITIES = {
    Realtime: { base: 24, label: 'Realtime' }, High: { base: 13, label: 'High' }, AboveNormal: { base: 10, label: 'Above normal' },
    Normal: { base: 8, label: 'Normal' }, BelowNormal: { base: 6, label: 'Below normal' }, Idle: { base: 4, label: 'Low' }
  };
  const priorityName = v => {
    const k = String(v).replace(/\s+/g, '').toLowerCase();
    return Object.keys(PRIORITIES).find(p => p.toLowerCase() === k || PRIORITIES[p].label.replace(/\s+/g, '').toLowerCase() === k) || null;
  };

  /* ---------------- runtime (per boot) ---------------- */
  let rt = fresh();
  function fresh() { return { pids: {}, used: new Set([0, 4]), info: {}, dead: new Set(), logon: 0, active: false, bootTime: Date.now(), last: null }; }
  function pidFor(key, fixed) {
    if (rt.pids[key] != null) return rt.pids[key];
    let pid = fixed;
    if (pid == null) do { pid = 4 * (130 + Math.floor(Math.random() * 2300)); } while (rt.used.has(pid));
    rt.used.add(pid);
    rt.pids[key] = pid;
    rt.info[key] = { started: Date.now(), priority: null, affinity: (1 << NCPU) - 1, efficiency: false, cpuNow: null, memNow: null, diskNow: 0, netNow: 0 };
    return pid;
  }
  function release(key) {
    if (rt.pids[key] == null) return;
    rt.used.delete(rt.pids[key]);
    delete rt.pids[key]; delete rt.info[key];
  }
  WS.sys.on('boot', () => {
    rt = fresh();
    logCrash();
  });
  // a stopped service's process exits, so starting it again gives a new PID
  WS.svc.on('status', (name, status) => {
    if (status !== 'Stopped') return;
    release('svc:' + name);
    for (const c of custom()) if (c.startWith === 'service:' + name) release('custom:' + c.id);
  });

  /* ---------------- what runs where ---------------- */
  // Core processes: [key, image, description, user, session, kind, cpu %, mem KB, threads, handles, parent key, flags]
  // flags: c = critical (ending it stops the system), p = protected (Access is denied), h = hidden from the
  // Processes tab, r = restarted at once when ended (dwm), x = suspended (UWP host while not in use)
  const CORE = [
    ['idle', 'System Idle Process', 'System Idle Process', 'SYSTEM', 0, 'windows', 0, 8, 4, 0, null, 'ph'],
    ['system', 'System', 'NT Kernel & System', 'SYSTEM', 0, 'windows', 0.1, 20, 156, 3120, 'idle', 'p'],
    ['registry', 'Registry', 'Registry', 'SYSTEM', 0, 'windows', 0, 9240, 4, 0, 'system', 'ph'],
    ['smss', 'smss.exe', 'Windows Session Manager', 'SYSTEM', 0, 'windows', 0, 312, 2, 57, 'system', 'cp'],
    ['csrss0', 'csrss.exe', 'Client Server Runtime Process', 'SYSTEM', 0, 'windows', 0, 1180, 11, 520, 'smss', 'cp'],
    ['wininit', 'wininit.exe', 'Windows Start-Up Application', 'SYSTEM', 0, 'windows', 0, 920, 1, 165, 'smss', 'cp'],
    ['services', 'services.exe', 'Services and Controller app', 'SYSTEM', 0, 'windows', 0, 3640, 7, 620, 'wininit', 'cp'],
    // lsass is critical but not a protected process: Microsoft turns LSA protection on automatically only on new
    // Windows 11 22H2+ clients (domain-joined, HVCI-capable); a server has to opt in (RunAsPPL)
    ['lsass', 'lsass.exe', 'Local Security Authority Process', 'SYSTEM', 0, 'windows', 0, 6100, 9, 1240, 'wininit', 'c'],
    ['fontdrv0', 'fontdrvhost.exe', 'Usermode Font Driver Host', 'UMFD-0', 0, 'windows', 0, 1260, 5, 39, 'wininit', ''],
    ['csrss1', 'csrss.exe', 'Client Server Runtime Process', 'SYSTEM', 1, 'windows', 0.05, 1490, 13, 610, 'smss', 'cp'],
    ['winlogon', 'winlogon.exe', 'Windows Logon Application', 'SYSTEM', 1, 'windows', 0, 1820, 5, 270, 'smss', 'c'],
    ['fontdrv1', 'fontdrvhost.exe', 'Usermode Font Driver Host', 'UMFD-1', 1, 'windows', 0, 2540, 5, 39, 'winlogon', ''],
    ['dwm', 'dwm.exe', 'Desktop Window Manager', 'DWM-1', 1, 'windows', 0.3, 26400, 15, 1050, 'winlogon', 'r'],
    ['wmiprvse0', 'WmiPrvSE.exe', 'WMI Provider Host', 'NETWORK SERVICE', 0, 'background', 0, 5800, 9, 410, 'svc:DcomLaunch', ''],
    ['wmiprvse1', 'WmiPrvSE.exe', 'WMI Provider Host', 'SYSTEM', 0, 'background', 0, 7900, 11, 530, 'svc:DcomLaunch', ''],
    ['dllhost0', 'dllhost.exe', 'COM Surrogate', 'SYSTEM', 0, 'background', 0, 2100, 6, 210, 'svc:DcomLaunch', '']
  ];
  // Processes of the signed-in session (Administrator, session 1)
  const SESSION = [
    ['explorer', 'explorer.exe', 'Windows Explorer', 0.2, 48600, 64, 2410, null, ''],
    ['sihost', 'sihost.exe', 'Shell Infrastructure Host', 0, 4800, 11, 520, 'svc:Schedule', ''],
    ['taskhostw', 'taskhostw.exe', 'Host Process for Windows Tasks', 0, 3400, 9, 280, 'svc:Schedule', ''],
    ['ctfmon', 'ctfmon.exe', 'CTF Loader', 0, 3300, 10, 470, 'svc:Schedule', ''],
    ['startmenu', 'StartMenuExperienceHost.exe', 'Start', 0, 21800, 18, 760, 'svc:DcomLaunch', 'x'],
    ['search', 'SearchHost.exe', 'Search', 0, 43100, 31, 1150, 'svc:DcomLaunch', 'x'],
    ['shellexp', 'ShellExperienceHost.exe', 'Windows Shell Experience Host', 0, 14900, 15, 690, 'svc:DcomLaunch', 'x'],
    ['textinput', 'TextInputHost.exe', 'Microsoft Text Input Application', 0, 11800, 14, 580, 'svc:DcomLaunch', ''],
    ['runtimebroker0', 'RuntimeBroker.exe', 'Runtime Broker', 0, 5200, 6, 330, 'svc:DcomLaunch', ''],
    ['runtimebroker1', 'RuntimeBroker.exe', 'Runtime Broker', 0, 3900, 4, 240, 'svc:DcomLaunch', ''],
    ['dllhost1', 'dllhost.exe', 'COM Surrogate', 0, 3100, 5, 190, 'svc:DcomLaunch', '']
  ];
  const IMAGE_PATH = {
    'InetMgr.exe': 'C:\\Windows\\System32\\inetsrv\\InetMgr.exe', 'w3wp.exe': 'C:\\Windows\\System32\\inetsrv\\w3wp.exe',
    'StartMenuExperienceHost.exe': 'C:\\Windows\\SystemApps\\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\\StartMenuExperienceHost.exe',
    'SearchHost.exe': 'C:\\Windows\\SystemApps\\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\\SearchHost.exe',
    'ShellExperienceHost.exe': 'C:\\Windows\\SystemApps\\ShellExperienceHost_cw5n1h2txyewy\\ShellExperienceHost.exe',
    'TextInputHost.exe': 'C:\\Windows\\SystemApps\\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\\TextInputHost.exe',
    'msedge.exe': 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'SystemSettings.exe': 'C:\\Windows\\ImmersiveControlPanel\\SystemSettings.exe',
    'explorer.exe': 'C:\\Windows\\explorer.exe', 'WmiPrvSE.exe': 'C:\\Windows\\System32\\wbem\\WmiPrvSE.exe',
    'WindowsTerminal.exe': 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.21.2911.0_x64__8wekyb3d8bbwe\\WindowsTerminal.exe',
    'OpenConsole.exe': 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.21.2911.0_x64__8wekyb3d8bbwe\\OpenConsole.exe',
    'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'MsMpEng.exe': 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18.24090.11-0\\MsMpEng.exe',
    'NisSrv.exe': 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18.24090.11-0\\NisSrv.exe',
    'MpDefenderCoreService.exe': 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\4.18.24090.11-0\\MpDefenderCoreService.exe',
    'LabGuide.exe': 'C:\\Program Files\\Lab Simulator\\LabGuide.exe'
  };
  const pathOfImage = img => (img in IMAGE_PATH ? IMAGE_PATH[img] : SYS32 + img);

  /* Services that run in their own executable: image -> [description, cpu, mem KB, flags] */
  const OWN = {
    'spoolsv.exe': ['Spooler SubSystem App', 0, 5600, ''], 'dns.exe': ['Domain Name System (DNS) Server', 0.1, 61200, ''],
    'Microsoft.ActiveDirectory.WebServices.exe': ['Microsoft.ActiveDirectory.WebServices', 0, 34800, ''], 'DFSRs.exe': ['Distributed File System Replication', 0, 10400, ''],
    'MsMpEng.exe': ['Antimalware Service Executable', 0.4, 168500, 'p'], 'ismserv.exe': ['Windows NT Intersite Messaging Service', 0, 2100, ''],
    'dfssvc.exe': ['Windows NT Distributed File System Service', 0, 2300, ''], 'msdtc.exe': ['Microsoft Distributed Transaction Coordinator Service', 0, 2900, ''],
    'vmms.exe': ['Virtual Machine Management Service', 0.1, 21300, ''], 'vmcompute.exe': ['Hyper-V Host Compute Service', 0, 6200, ''],
    'certsrv.exe': ['Active Directory Certificate Services', 0, 11600, ''], 'sppsvc.exe': ['Microsoft Software Protection Platform Service', 0, 7400, ''],
    'sshd.exe': ['OpenSSH SSH Server', 0, 3100, ''], 'ssh-agent.exe': ['OpenSSH Authentication Agent', 0, 1800, ''], 'vssvc.exe': ['Microsoft® Volume Shadow Copy Service', 0, 2600, ''],
    'msiexec.exe': ['Windows® installer', 0, 4900, ''], 'TrustedInstaller.exe': ['Windows Modules Installer', 0, 5200, ''], 'WsusService.exe': ['WSUS Service', 0.1, 48600, ''],
    'wbengine.exe': ['Microsoft® Block Level Backup Engine Service EXE', 0, 4200, ''], 'clussvc.exe': ['Cluster Service', 0, 18700, ''], 'MicrosoftEdgeUpdate.exe': ['Microsoft Edge Update', 0, 2500, '']
  };
  // Memory and CPU that set some svchost services apart from the ~2 MB default
  const SVCHOST_USE = { DcomLaunch: [0, 9800], RpcSs: [0, 6900], Winmgmt: [0.05, 10400], EventLog: [0.05, 6800], Schedule: [0, 3600], gpsvc: [0, 3100], DHCPServer: [0, 9800],
    W3SVC: [0, 7600], WAS: [0, 4400], LanmanServer: [0, 3900], mpssvc: [0, 5200], BFE: [0, 3500], DiagTrack: [0.05, 11200], UsoSvc: [0, 8200], CryptSvc: [0, 4100],
    Dnscache: [0, 2600], NlaSvc: [0, 3300], FontCache: [0, 2900], WinRM: [0, 4800], iphlpsvc: [0, 3100], BrokerInfrastructure: [0, 3200], TermService: [0, 6500] };
  const LSASS = new Set(['NTDS', 'Kdc', 'Netlogon', 'SamSs', 'KeyIso', 'VaultSvc']);

  /* Windows -> processes. Explorer hosts File Explorer and Control Panel windows; Server Manager hosts its wizards. */
  const MMC = new Set(['services', 'dsa', 'dnsmgmt', 'dhcpmgmt', 'eventvwr', 'compmgmt', 'diskmgmt', 'gpmc', 'gpme', 'gpedit', 'wf', 'lusrmgr', 'fsmgmt', 'devmgmt', 'virtmgmt']);
  const EXPLORER_HOSTED = new Set(['explorer', 'ncpa', 'netcenter', 'firewall', 'control', 'appwiz', 'run']);
  const SM_HOSTED = new Set(['addsconfig', 'dhcpconfig', 'newvolume', 'newshare', 'addroles', 'removeroles']);
  const MSC = { services: 'services.msc', dsa: 'dsa.msc', dnsmgmt: 'dnsmgmt.msc', dhcpmgmt: 'dhcpmgmt.msc', eventvwr: 'eventvwr.msc', compmgmt: 'compmgmt.msc', diskmgmt: 'diskmgmt.msc', gpmc: 'gpmc.msc', gpme: 'gpme.msc', gpedit: 'gpedit.msc', wf: 'WF.msc', lusrmgr: 'lusrmgr.msc', fsmgmt: 'fsmgmt.msc', devmgmt: 'devmgmt.msc', virtmgmt: 'virtmgmt.msc' };
  // app id -> [image, description, company, cpu, mem KB, app name in the Processes tab]
  const APP = {
    servermanager: ['ServerManager.exe', 'Server Manager', 'Microsoft Corporation', 0.3, 152400, 'Server Manager'],
    notepad: ['notepad.exe', 'Notepad', 'Microsoft Corporation', 0, 3600, 'Notepad'],
    terminal: ['WindowsTerminal.exe', 'Windows Terminal', 'Microsoft Corporation', 0.1, 61800, 'Windows Terminal'],
    taskmgr: ['Taskmgr.exe', 'Task Manager', 'Microsoft Corporation', 1.2, 31200, 'Task Manager'],
    lab: ['LabGuide.exe', 'Lab Guide', 'Lab Simulator', 0, 9800, 'Lab Guide'],
    settings: ['SystemSettings.exe', 'Settings', 'Microsoft Corporation', 0.1, 38600, 'Settings'],
    edge: ['msedge.exe', 'Microsoft Edge', 'Microsoft Corporation', 0.4, 112300, 'Microsoft Edge'],
    mmc: ['mmc.exe', 'Microsoft Management Console', 'Microsoft Corporation', 0.1, 24500, 'Microsoft Management Console'],
    vmconnect: ['vmconnect.exe', 'Virtual Machine Connection', 'Microsoft Corporation', 0.6, 46200, 'Virtual Machine Connection'],
    inetmgr: ['InetMgr.exe', 'IIS Manager', 'Microsoft Corporation', 0.1, 38900, 'Internet Information Services (IIS) Manager']
  };

  const custom = () => (WS.state.processes && WS.state.processes.custom) || [];
  const startupList = () => (WS.state.processes && WS.state.processes.startup) || [];
  const isDC = () => WS.sys.isDC();
  const accountDomain = () => (WS.state.system.domain ? WS.sys.netbiosDomain() : WS.sys.name);
  const sessionUser = () => (WS.session && WS.session.user) || 'Administrator';

  /** Every running process, in no particular order. */
  const sources = [];
  function list() {
    const out = [];
    const keys = new Set();
    const add = (key, p, fixedPid) => {
      if (rt.dead.has(key)) return null;
      keys.add(key);
      const pid = pidFor(key, fixedPid);
      const info = rt.info[key];
      const proc = Object.assign({ key, pid, ppid: null, parentKey: null, session: 0, user: 'SYSTEM', company: 'Microsoft Corporation', kind: 'windows', cpuBase: 0, memBase: 2000,
        threads: 6, handles: 200, services: [], windows: [], critical: false, protected: false, hidden: false, respawn: false, status: 'Running', disk: 0, net: 0, leakKBps: 0 }, p);
      proc.path = proc.path === undefined ? pathOfImage(proc.image) : proc.path;
      proc.name = proc.image.replace(/\.exe$/i, '');
      proc.started = new Date(info.started);
      proc.priority = info.priority || proc.defaultPriority || 'Normal';
      proc.affinity = info.affinity;
      proc.efficiency = info.efficiency;
      out.push(proc);
      return proc;
    };
    for (const [key, image, desc, user, session, kind, cpu, mem, threads, handles, parent, flags] of CORE) {
      const p = add(key, { image, description: desc, user, session, kind, cpuBase: cpu, memBase: key === 'lsass' && isDC() ? 52300 : mem, threads, handles, parentKey: parent,
        critical: flags.includes('c'), protected: flags.includes('p'), hidden: flags.includes('h'), respawn: flags.includes('r'),
        defaultPriority: ['csrss0', 'csrss1', 'wininit', 'winlogon', 'dwm'].includes(key) ? 'High' : key === 'system' ? 'Normal' : 'Normal' }, key === 'idle' ? 0 : key === 'system' ? 4 : undefined);
      if (p && key === 'idle') { p.path = null; p.company = null; }
      if (p && key === 'system') { p.path = null; p.description = 'NT Kernel & System'; }
      if (p && key === 'registry') { p.path = null; p.company = null; }
    }
    // services
    const lsass = out.find(p => p.key === 'lsass');
    for (const s of WS.svc.list()) {
      if (s.status !== 'Running') continue;
      if (LSASS.has(s.name)) { if (lsass) lsass.services.push(s.name); continue; }
      const raw = s.path || WS.svc.pathOf(s.name);
      const exe = raw.replace(/^"/, '').replace(/".*$/, '').replace(/ -.*$/, '').replace(/ \/.*$/, '');
      const image = exe.replace(/^.*\\/, '');
      const user = s.logon === 'Local System' ? 'SYSTEM' : s.logon.toUpperCase();
      if (/^svchost\.exe$/i.test(image)) {
        const [cpu, mem] = SVCHOST_USE[s.name] || [0, 1400 + U.hashStr(s.name) % 2600];
        add('svc:' + s.name, { image: 'svchost.exe', path: SYS32 + 'svchost.exe', description: 'Host Process for Windows Services', user, cpuBase: cpu, memBase: mem, threads: 4 + U.hashStr(s.name) % 12,
          handles: 120 + U.hashStr(s.name) % 600, services: [s.name], parentKey: 'services', cmdLine: raw, critical: s.name === 'DcomLaunch' || s.name === 'RpcSs',
          defaultPriority: 'Normal' });
        continue;
      }
      const c = s.custom ? custom().find(x => x.startWith === 'service:' + s.name) : null;
      if (c) continue; // a lab service's process comes from its custom definition below
      const own = OWN[image] || [s.display, 0, 4000, ''];
      const existing = out.find(p => p.key === 'own:' + image);
      if (existing) { existing.services.push(s.name); continue; }
      const p = add('own:' + image, { image, path: exe, description: own[0], user, cpuBase: own[1], memBase: own[2], threads: 8 + U.hashStr(image) % 20, handles: 200 + U.hashStr(image) % 900,
        services: [s.name], parentKey: 'services', protected: own[3].includes('p'), cmdLine: raw, kind: 'background' });
      if (p && image === 'MsMpEng.exe') { // Defender's helpers run while the antivirus service does
        add('nissrv', { image: 'NisSrv.exe', description: 'Microsoft Network Realtime Inspection Service', user: 'LOCAL SERVICE', memBase: 3600, threads: 6, parentKey: 'services', protected: true, kind: 'background' });
        add('mpcore', { image: 'MpDefenderCoreService.exe', description: 'Antimalware Core Service', memBase: 9100, threads: 12, parentKey: 'services', protected: true, kind: 'background' });
      }
    }
    // lab-defined processes
    for (const c of custom()) {
      const w = c.startWith || 'boot';
      let key = 'custom:' + c.id;
      if (w.startsWith('service:')) { if (!WS.svc.isRunning(w.slice(8))) continue; }
      else if (w === 'logon' || w.startsWith('startup:')) {
        if (!rt.active) continue;
        if (w.startsWith('startup:')) { const e = startupList().find(x => x.id === w.slice(8)); if (!e || !e.enabledAtLogon) continue; }
        key += ':' + rt.logon;
      }
      const user = c.user || (w === 'logon' || w.startsWith('startup:') ? sessionUser() : 'SYSTEM');
      add(key, { image: c.image, path: c.path || 'C:\\Program Files\\' + c.image, description: c.description || c.image.replace(/\.exe$/i, ''), company: c.company || '', version: c.version,
        user, session: /^(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$/i.test(user) ? 0 : 1, kind: c.kind || 'background', cpuBase: c.cpu || 0, memBase: c.mem || 4000, leakKBps: c.leakKBps || 0,
        disk: c.disk || 0, net: c.net || 0, threads: c.threads || 8, handles: c.handles || 240, status: c.status || 'Running', services: w.startsWith('service:') ? [w.slice(8)] : [],
        parentKey: w.startsWith('service:') ? 'services' : w === 'boot' ? 'services' : 'explorer', cmdLine: c.cmdLine || `"${c.path || c.image}"`, customId: c.id });
    }
    // processes other models derive (IIS worker processes)
    for (const src of sources) { try { src(add); } catch (e) { console.error('process source failed', e); } }
    // the signed-in session
    if (rt.active) {
      for (const [key, image, desc, cpu, mem, threads, handles, parent, flags] of SESSION) {
        const p = add(key + ':' + rt.logon, { image, description: desc, user: sessionUser(), session: 1, kind: key === 'explorer' ? 'windows' : 'background', cpuBase: cpu, memBase: mem, threads, handles,
          parentKey: parent, status: flags.includes('x') ? 'Suspended' : 'Running', shell: key === 'explorer' });
        if (p && key === 'explorer') { p.ppid = rt.explorerParent = rt.explorerParent || 4 * (2400 + Math.floor(Math.random() * 100)); p.kind = 'windows'; }
      }
      for (const e of startupList()) {
        if (!e.enabledAtLogon || custom().some(c => c.startWith === 'startup:' + e.id)) continue;
        const image = String(e.command).replace(/^"/, '').replace(/".*$/, '').replace(/ .*$/, '').replace(/^.*\\/, '');
        add(`startup:${e.id}:${rt.logon}`, { image, path: String(e.command).replace(/%windir%/i, 'C:\\Windows').replace(/^"|".*$/g, '').replace(/ .*$/, ''), description: e.name, company: e.publisher,
          user: sessionUser(), session: 1, kind: 'background', memBase: 1600, threads: 3, handles: 140, parentKey: 'explorer:' + rt.logon });
      }
      addWindows(add, out);
    }
    // parents
    const byKey = new Map(out.map(p => [p.key, p]));
    for (const p of out) {
      if (p.ppid != null) continue;
      if (!p.parentKey) { p.ppid = 0; continue; }
      const k = p.parentKey.includes(':') || !SESSION.some(s => s[0] === p.parentKey) ? p.parentKey : p.parentKey + ':' + rt.logon;
      const parent = byKey.get(k) || byKey.get(k + ':' + rt.logon);
      p.ppid = parent ? parent.pid : (rt.orphanParent = rt.orphanParent || 4 * (300 + Math.floor(Math.random() * 50)));
    }
    // forget processes that are gone, so a restart gets a new PID
    for (const k of Object.keys(rt.pids)) if (!keys.has(k) && !rt.dead.has(k)) release(k);
    return out;
  }

  function addWindows(add, out) {
    const explorer = out.find(p => p.shell);
    const sm = () => out.find(p => p.appId === 'servermanager');
    const wins = WS.wm.windows.filter(w => w.app !== 'stub').slice().sort((a, b) => (a.app === 'servermanager' ? -1 : b.app === 'servermanager' ? 1 : 0));
    for (const w of wins) {
      if (EXPLORER_HOSTED.has(w.app)) { if (explorer) explorer.windows.push(w); continue; }
      if (SM_HOSTED.has(w.app) && sm()) { sm().windows.push(w); continue; }
      const mmc = MMC.has(w.app);
      const def = APP[mmc ? 'mmc' : w.app] || [w.app + '.exe', w.title, '', 0, 8000, w.title];
      const p = add('win:' + w.id, { image: def[0], path: IMAGE_PATH[def[0]] ? IMAGE_PATH[def[0]] : SYS32 + def[0], description: def[1], company: def[2], cpuBase: def[3], memBase: def[4],
        appName: def[5], appId: w.app, user: sessionUser(), session: 1, kind: 'app', threads: 18 + U.hashStr(w.id) % 20, handles: 400 + U.hashStr(w.id) % 700, parentKey: explorer ? explorer.key : null,
        cmdLine: mmc ? `"C:\\Windows\\system32\\mmc.exe" "C:\\Windows\\system32\\${MSC[w.app] || w.app + '.msc'}"` : `"${IMAGE_PATH[def[0]] || SYS32 + def[0]}"`, defaultPriority: w.app === 'taskmgr' ? 'High' : 'Normal' });
      if (!p) continue;
      p.windows.push(w);
      if (w.app === 'terminal') {
        p.path = IMAGE_PATH['WindowsTerminal.exe'];
        p.cmdLine = `"${p.path}"`;
        const tabs = typeof w.procs === 'function' ? w.procs() : [];
        for (const t of tabs) {
          const ps = t.kind !== 'cmd';
          add('tab:' + t.key, { image: ps ? 'powershell.exe' : 'cmd.exe', description: ps ? 'Windows PowerShell' : 'Windows Command Processor', user: sessionUser(), session: 1, kind: 'app',
            cpuBase: 0, memBase: ps ? 72400 : 4100, threads: ps ? 22 : 1, handles: ps ? 690 : 70, parentKey: p.key, hostKey: p.key, title: t.title, tab: t, cmdLine: ps ? '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"' : '"C:\\Windows\\system32\\cmd.exe"' });
          add('con:' + t.key, { image: 'OpenConsole.exe', description: 'Console Window Host', user: sessionUser(), session: 1, kind: 'app', memBase: 6100, threads: 6, handles: 230, parentKey: p.key, hostKey: p.key, tab: t });
        }
      }
    }
  }

  /* ---------------- live numbers ---------------- */
  const jitter = base => (base > 0 ? Math.max(0, base * (0.35 + Math.random() * 1.3)) : (Math.random() < 0.03 ? Math.random() * 0.4 : 0));
  /** Take a sample: updates each process's CPU/memory/disk/network now and returns the totals. */
  function sample() {
    const procs = list();
    const now = Date.now();
    let cpu = 0, mem = 0, disk = 0, net = 0;
    for (const p of procs) {
      const info = rt.info[p.key];
      if (!info || p.key === 'idle') continue;
      let c = p.status === 'Suspended' ? 0 : jitter(p.cpuBase);
      if (p.cpuBase >= 10) c = Math.min(100, p.cpuBase * (0.9 + Math.random() * 0.2)); // a busy process stays busy
      // affinity caps a process at the processors it may use; efficiency mode trims it further
      const cores = popcount(p.affinity);
      c = Math.min(c, 100 * cores / NCPU);
      if (p.efficiency) c *= 0.6;
      info.cpuNow = c;
      const ageS = (now - info.started) / 1000;
      info.memNow = Math.round(Math.min(p.memBase + p.leakKBps * ageS, 2600000) * (0.985 + Math.random() * 0.03));
      info.diskNow = p.disk ? p.disk * (0.5 + Math.random()) : (Math.random() < 0.02 ? Math.random() * 0.2 : 0);
      info.netNow = p.net ? p.net * (0.5 + Math.random()) : 0;
      cpu += c; mem += info.memNow; disk += info.diskNow; net += info.netNow;
    }
    cpu = Math.min(100, cpu);
    rt.last = { time: now, cpu, procMemKB: mem, disk, net };
    return totals(procs);
  }
  const popcount = m => { let n = 0; for (let i = 0; i < NCPU; i++) if (m & (1 << i)) n++; return n; };
  /** Machine-wide numbers (from the last sample): CPU %, memory in KB, disk and network activity. */
  function totals(procs) {
    if (!rt.last) return sample();
    procs = procs || list();
    const l = rt.last;
    const usedKB = Math.min(TOTAL_KB - 200000, Math.round(l.procMemKB * 1.12 + 610000 + (isDC() ? 140000 : 0)));
    const committedKB = Math.round(usedKB * 1.35);
    const threads = procs.reduce((a, p) => a + p.threads, 0), handles = procs.reduce((a, p) => a + p.handles, 0);
    return {
      cpu: l.cpu, speedGHz: 2.30 + (l.cpu > 20 ? 0.6 : l.cpu > 3 ? 0.25 : 0), processes: procs.filter(p => p.key !== 'idle').length, threads, handles,
      uptimeMs: Date.now() - rt.bootTime,
      memory: { totalKB: TOTAL_KB, usedKB, availableKB: TOTAL_KB - usedKB, committedKB, commitLimitKB: TOTAL_KB + 1310720, cachedKB: Math.round((TOTAL_KB - usedKB) * 0.62),
        pagedKB: 241000 + (isDC() ? 38000 : 0), nonpagedKB: 118000, percent: usedKB / TOTAL_KB * 100 },
      disk: { active: Math.min(100, l.disk * 9 + (Math.random() < 0.15 ? Math.random() * 3 : 0)), readKBs: Math.round(l.disk * 380), writeKBs: Math.round(l.disk * 640 + Math.random() * 30) },
      net: { sendKbps: Math.round(l.net * 1000 + Math.random() * 8), recvKbps: Math.round(l.net * 1200 + Math.random() * 16 + (isDC() ? 6 : 0)) }
    };
  }
  /** Per-process live values (sampling first if nothing has been sampled in the last two seconds). */
  function live(p) {
    if (!rt.last || Date.now() - rt.last.time > 2000) sample();
    const info = rt.info[p.key] || {};
    const ageS = (Date.now() - (info.started || Date.now())) / 1000;
    return {
      cpu: p.key === 'idle' ? Math.max(0, 100 - rt.last.cpu) : info.cpuNow || 0,
      memKB: p.key === 'idle' ? 8 : info.memNow || p.memBase,
      disk: info.diskNow || 0, net: info.netNow || 0,
      // CPU time: average use over the process's life (a % of four processors)
      cpuSeconds: p.key === 'idle' ? ageS * NCPU * 0.95 : p.cpuBase * NCPU / 100 * ageS + (U.hashStr(p.key) % 300) / 100
    };
  }

  /* ---------------- lookups ---------------- */
  const get = pid => list().find(p => p.pid === +pid) || null;
  const find = name => { const n = String(name).toLowerCase().replace(/\.exe$/, ''); return list().filter(p => p.name.toLowerCase() === n); };
  const byKey = key => list().find(p => p.key === key) || null;
  const children = (procs, pid) => procs.filter(p => p.ppid === pid && p.pid !== pid);

  /* ---------------- ending processes ---------------- */
  const denied = p => ({ ok: false, code: 'AccessDenied', error: 'Access is denied.', process: p });
  /**
   * kill(pid, opts): ends a process the way TerminateProcess does.
   *   force: false asks windows to close (taskkill without /F); a process with no window then needs /F.
   *   tree: also end its descendants (End process tree, taskkill /T).
   *   allowCritical: Task Manager confirmed "Abandon unsaved data and shut down", so a protected critical
   *   process may be ended too; the shells are refused with Access is denied.
   */
  function kill(pid, opts = {}) {
    const procs = list();
    const p = procs.find(x => x.pid === +pid);
    if (!p) return { ok: false, code: 'NotFound', error: `The process "${pid}" not found.` };
    const ended = [];
    if (opts.tree) {
      const walk = q => { for (const c of children(procs, q.pid)) { walk(c); const r = endOne(c, opts); if (r.ok) ended.push(c); } };
      walk(p);
    }
    const r = endOne(p, opts);
    if (!r.ok) return Object.assign(r, { ended });
    ended.push(p);
    WS.store.changed('processes');
    return { ok: true, ended, graceful: r.graceful, crashed: r.crashed };
  }
  function endOne(p, opts) {
    if (p.key === 'idle' || p.key === 'system' || p.key === 'registry') return denied(p);
    if (p.protected && !(opts.allowCritical && p.critical)) return denied(p);
    if (opts.force === false && !p.windows.length && !p.tab) return { ok: false, code: 'ForceRequired', error: 'This process can only be terminated forcefully (with /F option).', process: p };
    if (p.critical) { bugcheck(p); return { ok: true, crashed: true }; }
    if (p.shell) { endExplorer(p); return { ok: true }; }
    if (p.windows.length || p.tab) {
      const graceful = opts.force === false;
      if (p.tab) p.tab.close();
      else for (const w of p.windows.filter(x => WS.wm.windows.includes(x))) { if (graceful && w.canClose) Promise.resolve(w.canClose()).then(ok => ok && w.close()); else w.close(); }
      release(p.key);
      return { ok: true, graceful };
    }
    if (p.respawn) { release(p.key); return { ok: true }; } // winlogon starts a new one straight away
    if (p.services.length && !p.customId) {
      for (const s of p.services) WS.svc.crash(s);
      release(p.key);
      return { ok: true };
    }
    if (p.customId) {
      const c = custom().find(x => x.id === p.customId);
      if (c && c.startWith && c.startWith.startsWith('service:')) { WS.svc.crash(c.startWith.slice(8)); release(p.key); return { ok: true }; }
    }
    rt.dead.add(p.key);
    release(p.key);
    rt.used.add(p.pid); // PIDs are not reused straight away
    return { ok: true };
  }
  function endExplorer(p) {
    for (const w of p.windows) w.close();
    rt.dead.add(p.key);
    if (WS.shell && WS.shell.explorerEnded) WS.shell.explorerEnded();
  }
  /** Start the shell again (Task Manager's Restart, Run new task: explorer). */
  function startExplorer() {
    const key = 'explorer:' + rt.logon;
    if (!rt.dead.has(key)) return false;
    rt.dead.delete(key);
    release(key);
    rt.explorerParent = null;
    if (WS.shell && WS.shell.explorerStarted) WS.shell.explorerStarted();
    WS.store.changed('processes');
    return true;
  }
  const explorerRunning = () => !rt.active || !rt.dead.has('explorer:' + rt.logon);

  /* ---------------- bug checks ---------------- */
  function bugcheck(p) {
    WS.state.system.crash = { code: 0xEF, name: 'CRITICAL_PROCESS_DIED', process: p.image, time: new Date().toISOString() };
    WS.store.save();
    if (WS.shell && WS.shell.bugcheck) setTimeout(() => WS.shell.bugcheck('CRITICAL_PROCESS_DIED'), 50);
  }
  /** At the next boot, the event logs and the dump file record what happened. */
  function logCrash() {
    const c = WS.state.system.crash;
    if (!c) return;
    delete WS.state.system.crash;
    const t = new Date(c.time);
    const hex = n => '0x' + n.toString(16).padStart(16, '0');
    const p1 = hex(0xffffa50f00000000 + (U.hashStr(c.process || '') % 0xffffff) * 0x80);
    WS.evt.write('System', { id: 41, level: 'Critical', source: 'Microsoft-Windows-Kernel-Power', task: '(63)', message: 'The system has rebooted without cleanly shutting down first. This error could be caused if the system stopped responding, crashed, or lost power unexpectedly.' });
    WS.evt.write('System', { id: 6008, level: 'Error', source: 'EventLog', message: `The previous system shutdown at ${U.fmtTime(t, true)} on ${U.fmtDate(t)} was unexpected.` });
    WS.evt.write('System', { id: 1001, level: 'Error', source: 'Microsoft-Windows-WER-SystemErrorReporting', message: `The computer has rebooted from a bugcheck.  The bugcheck was: 0x000000ef (${p1}, 0x0000000000000000, 0x0000000000000000, 0x0000000000000000). A dump was saved in: C:\\Windows\\MEMORY.DMP. Report Id: ${U.guid().replace(/[{}]/g, '').toLowerCase()}.` });
    WS.state.system.unexpectedShutdown = { time: c.time, kind: 'bugcheck', bugcheck: '0x000000ef' };
    try { WS.fs.writeFile('C:\\Windows\\MEMORY.DMP', 'PAGEDU64 (Lab Simulator stand-in for a kernel memory dump)', null, { size: 812 * 1048576 }); } catch (e) { /* best effort */ }
    WS.store.changed('system');
  }

  /* ---------------- priority, affinity, efficiency mode ---------------- */
  function setPriority(pid, cls) {
    const p = get(pid);
    if (!p) return { ok: false, code: 'NotFound', error: `Cannot find a process with the process identifier ${pid}.` };
    const name = priorityName(cls);
    if (!name) return { ok: false, code: 'InvalidValue', error: `Cannot convert value "${cls}" to type "System.Diagnostics.ProcessPriorityClass". Error: "Unable to match the identifier name ${cls} to a valid enumerator name. Specify one of the following enumerator names and try again:\nNormal, Idle, High, RealTime, BelowNormal, AboveNormal"` };
    if (p.protected || p.key === 'system') return denied(p);
    rt.info[p.key].priority = name;
    if (name !== 'Idle') rt.info[p.key].efficiency = false;
    WS.store.changed('processes');
    return { ok: true, priority: name };
  }
  function setAffinity(pid, mask) {
    const p = get(pid);
    if (!p) return { ok: false, code: 'NotFound', error: `Cannot find a process with the process identifier ${pid}.` };
    mask = +mask & ((1 << NCPU) - 1);
    if (!mask) return { ok: false, code: 'InvalidValue', error: 'The process must have affinity with at least one processor.' };
    if (p.protected || p.critical || p.key === 'system') return denied(p);
    rt.info[p.key].affinity = mask;
    WS.store.changed('processes');
    return { ok: true };
  }
  function setEfficiency(pid, on) {
    const p = get(pid);
    if (!p) return { ok: false, code: 'NotFound', error: `Cannot find a process with the process identifier ${pid}.` };
    if (!canEfficiency(p)) return { ok: false, code: 'NotAllowed', error: 'Efficiency mode is not available for this process.' };
    const info = rt.info[p.key];
    info.efficiency = !!on;
    info.priority = on ? 'Idle' : null;
    WS.store.changed('processes');
    return { ok: true };
  }
  const canEfficiency = p => p.kind !== 'windows' && !p.protected && !p.critical && p.status !== 'Suspended' && p.key !== 'idle' && p.appId !== 'taskmgr';

  /* ---------------- memory dumps (Create memory dump file) ---------------- */
  function dump(pid) {
    const p = get(pid);
    if (!p) return { ok: false, code: 'NotFound', error: `Cannot find a process with the process identifier ${pid}.` };
    if (p.protected || p.key === 'system') return denied(p);
    const dir = `C:\\Users\\${sessionUser()}\\AppData\\Local\\Temp`;
    WS.fs.ensureDir(dir);
    let path = `${dir}\\${p.name}.DMP`;
    for (let i = 2; WS.fs.stat(path); i++) path = `${dir}\\${p.name} (${i}).DMP`;
    const size = Math.round((live(p).memKB * 1.6 + 30000) * 1024);
    WS.fs.writeFile(path, `MDMP (Lab Simulator stand-in for a full user-mode dump of ${p.image}, PID ${p.pid})`, null, { size });
    return { ok: true, path, size, shortPath: path.replace(/\\Users\\Administrator\\/i, '\\Users\\ADMINI~1\\') };
  }

  /* ---------------- startup apps ---------------- */
  const startupApps = () => startupList().map(e => Object.assign({}, e));
  function setStartupEnabled(idOrName, on) {
    const n = String(idOrName).toLowerCase();
    const e = startupList().find(x => x.id.toLowerCase() === n || x.name.toLowerCase() === n);
    if (!e) return { ok: false, code: 'NotFound', error: `The startup app '${idOrName}' was not found.` };
    e.enabled = !!on;
    WS.store.changed('processes');
    return { ok: true };
  }
  function addStartup(def) {
    const list = WS.state.processes.startup;
    const e = Object.assign({ location: 'HKLM', enabled: true, impact: 'Not measured', publisher: '' }, def);
    const i = list.findIndex(x => x.id === e.id);
    if (i >= 0) list[i] = e; else list.push(e);
    WS.store.changed('processes');
    return { ok: true };
  }
  function addCustom(def) {
    const list = WS.state.processes.custom;
    const c = Object.assign({ id: def.image.replace(/\.exe$/i, '').toLowerCase() }, def);
    const i = list.findIndex(x => x.id === c.id);
    if (i >= 0) list[i] = c; else list.push(c);
    WS.store.changed('processes');
    return { ok: true };
  }

  /* ---------------- sessions ---------------- */
  /** Sign-in: session processes and enabled startup apps start (locking and unlocking keeps the session). */
  function onLogon() {
    if (rt.active) return;
    rt.active = true;
    rt.logon++;
    for (const e of startupList()) e.enabledAtLogon = !!e.enabled; // what Run keys say at sign-in decides what starts
    WS.store.changed('processes');
  }
  function onLogoff() {
    if (!rt.active) return;
    rt.active = false;
    WS.store.changed('processes');
  }

  WS.proc = {
    list, get, find, byKey, kill, live, sample, totals, setPriority, setAffinity, setEfficiency, canEfficiency, dump, pidFor,
    startupApps, setStartupEnabled, addStartup, addCustom, onLogon, onLogoff, startExplorer, explorerRunning, priorityName, children: pid => children(list(), +pid),
    sessionActive: () => rt.active, accountDomain, PRIORITIES, NCPU, TOTAL_KB,
    /** addSource(fn): fn(add) adds derived processes on every list(); add(key, props) as in list(). isDead(key): ended and not re-created. */
    addSource: fn => sources.push(fn), isDead: key => rt.dead.has(key),
    /** PID of the process hosting a service (0 when it isn't running). */
    pidOfService(name) { const n = String(name).toLowerCase(); const p = list().find(x => x.services.some(s => s.toLowerCase() === n)); return p ? p.pid : 0; },
    /** The account name as Get-Process -IncludeUserName and tasklist /v print it. */
    qualifiedUser(p) {
      if (/^(SYSTEM|LOCAL SERVICE|NETWORK SERVICE)$/.test(p.user)) return 'NT AUTHORITY\\' + p.user;
      if (/^UMFD-/.test(p.user)) return 'Font Driver Host\\' + p.user;
      if (/^DWM-/.test(p.user)) return 'Window Manager\\' + p.user;
      if (p.accountDomain) return p.accountDomain + '\\' + p.user;
      return accountDomain() + '\\' + p.user;
    }
  };
})();
