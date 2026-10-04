/* Hyper-V model: WS.hv. Virtual switches, virtual machines, virtual hard disks, checkpoints and a small guest
 * (boot devices, "Press any key to boot from CD or DVD...", Windows Setup, the installed OS). Hyper-V Manager,
 * Virtual Machine Connection, the Hyper-V PowerShell module and vmconnect all go through it.
 *
 * State (the lab API): hyperv = null until the Hyper-V role is installed (after its restart), then
 *   { host: { vhdPath, vmPath, numaSpanning, enhancedSession, memoryMB (memory the host can give to VMs), macMin, macMax, macNext },
 *     switches: [{ id, name, type: 'External'|'Internal'|'Private', adapter ('Ethernet' or null), allowManagementOS, notes }],
 *     vms: [vm], vhds: { '<lower-case path>': vhd } }
 *   vm  = { id (GUID), name, generation: 1|2, version: '12.0', path (the folder holding "Virtual Machines"), state: 'Off'|'Running'|'Saved'|'Paused',
 *           memory: { startup, dynamic, minimum, maximum, buffer } (MB), cpu: { count, nested },
 *           disks: [{ controller: 'SCSI'|'IDE', number, location, path }], dvds: [{ controller, number, location, path|null }],
 *           nics: [{ id, name, switch|null, mac, dynamicMac, vlan|null }],
 *           firmware: { secureBoot, template: 'MicrosoftWindows'|'MicrosoftUEFICertificateAuthority'|'OpenSourceShieldedVM', bootOrder: ['dvd'|'disk'|'net' (+ index)] },
 *           bios: { order: ['CD','IDE','LegacyNetworkAdapter','Floppy'] } (generation 1), tpm,
 *           integration: { [service]: bool }, checkpointType: 'Production'|'ProductionOnly'|'Standard'|'Disabled', automaticCheckpoints,
 *           autoStart: 'Nothing'|'StartIfRunning'|'Start', autoStartDelay (s), autoStop: 'Save'|'TurnOff'|'ShutDown', notes, created,
 *           startedAt, guest: { phase, ... } (kept while Saved), checkpoints: [{ id, name, parent, created, type, snap }], current }
 *   vhd = { path, format: 'VHDX'|'VHD', type: 'Dynamic'|'Fixed'|'Differencing', size (bytes), parent, os: null | { product, edition, desktop,
 *           computerName, setupDone, password, icmp } }
 *   An ISO is a file whose text starts with "ws2025lab-iso:" and a JSON label (WS.hv.writeIso makes one).
 * Results follow the model convention ({ ok, code, error }); error texts are the ones Hyper-V shows. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util;
  const GB = 1024 ** 3, MB = 1024 ** 2;
  const DEFAULT_VM_PATH = 'C:\\ProgramData\\Microsoft\\Windows\\Hyper-V';
  const DEFAULT_VHD_PATH = 'C:\\ProgramData\\Microsoft\\Windows\\Virtual Hard Disks';
  const ISO_MARK = 'ws2025lab-iso:';
  const INTEGRATION = ['Guest Service Interface', 'Heartbeat', 'Key-Value Pair Exchange', 'Shutdown', 'Time Synchronization', 'VSS'];
  const EDITIONS = [
    { id: 'std-core', name: 'Windows Server 2025 Standard Evaluation', desktop: false },
    { id: 'std', name: 'Windows Server 2025 Standard Evaluation (Desktop Experience)', desktop: true },
    { id: 'dc-core', name: 'Windows Server 2025 Datacenter Evaluation', desktop: false },
    { id: 'dc', name: 'Windows Server 2025 Datacenter Evaluation (Desktop Experience)', desktop: true }
  ];

  WS.store.init('hyperv', s => { s.hyperv = null; });
  /* The Add Roles and Features Wizard's Hyper-V pages, applied when the role finishes installing (after the restart). */
  WS.store.init('hvInstall', s => { s.hvInstall = null; });

  const st = () => WS.state.hyperv;
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const fail = (code, error) => ({ ok: false, code, error });
  const installed = () => WS.features.isInstalled('Hyper-V') && !!st();
  const running = () => installed() && WS.svc.isRunning('vmms');
  const NOT_INSTALLED = () => fail('NotInstalled', 'Hyper-V is not installed on this computer, or the Hyper-V Virtual Machine Management service is not running.');
  const changed = () => WS.store.changed('hyperv');
  let timeScale = 1;
  const later = (fn, ms) => setTimeout(fn, Math.max(0, ms * timeScale));

  /* ================================================================ install, boot, shutdown */
  function fresh() {
    return { host: { vhdPath: DEFAULT_VHD_PATH, vmPath: DEFAULT_VM_PATH, numaSpanning: true, enhancedSession: false, memoryMB: 2048, macMin: '00155D010A00', macMax: '00155D010AFF', macNext: 0 },
      switches: [], vms: [], vhds: {} };
  }
  WS.features.on('install', id => {
    if (id !== 'Hyper-V') return;
    if (!WS.state.hyperv) WS.state.hyperv = fresh();
    WS.fs.ensureDir(DEFAULT_VM_PATH); WS.fs.ensureDir(DEFAULT_VHD_PATH);
    const o = WS.state.hvInstall;
    if (o) {
      WS.state.hvInstall = null;
      if (o.vhdPath) { st().host.vhdPath = o.vhdPath; WS.fs.ensureDir(o.vhdPath); }
      if (o.vmPath) { st().host.vmPath = o.vmPath; WS.fs.ensureDir(o.vmPath); }
      st().host.migration = !!o.migration;
      // the wizard names each switch after its adapter: "<description> - Virtual Switch"
      for (const name of o.adapters || []) { const a = WS.net.adapter(name); if (a) newSwitch({ name: `${a.description} - Virtual Switch`, adapter: a.name, allowManagementOS: true, atInstall: true }); }
    }
    changed();
  });
  WS.features.on('uninstall', id => {
    if (id !== 'Hyper-V' || !st()) return;
    for (const sw of st().switches.slice()) removeSwitch(sw.name);
    WS.state.hyperv = null; rt = {}; syncPeers(); changed();
  });
  /* The host shuts down: each running VM follows its Automatic Stop Action. */
  WS.sys.on('shutdown', () => {
    if (!st()) return;
    for (const vm of st().vms) {
      if (vm.state !== 'Running' && vm.state !== 'Paused') continue;
      if (vm.autoStop === 'Save') { vm.state = 'Saved'; vm.wasRunning = true; }
      else { vm.state = 'Off'; vm.wasRunning = true; vm.guest = { phase: 'off' }; if (vm.autoStop === 'TurnOff') vm.dirtyShutdown = true; }
    }
    changed();
  });
  /* Boot: VMs still marked running lost power with the host; then each one's Automatic Start Action runs. */
  WS.sys.on('boot', () => {
    rt = {};
    if (!st()) { syncPeers(); return; }
    for (const vm of st().vms) {
      if (vm.state === 'Running' || vm.state === 'Paused') { vm.state = 'Off'; vm.wasRunning = true; vm.guest = { phase: 'off' }; }
      const start = vm.autoStart === 'Start' || (vm.autoStart === 'StartIfRunning' && vm.wasRunning);
      delete vm.wasRunning;
      if (start && WS.svc.isRunning('vmms')) later(() => { if (vm.state === 'Off' || vm.state === 'Saved') startVM(vm.id); }, (vm.autoStartDelay || 0) * 1000 + 200);
    }
    syncPeers();
    changed();
  });

  /* ================================================================ host */
  const host = () => (st() ? st().host : null);
  function setHost(o = {}) {
    if (!installed()) return NOT_INSTALLED();
    const h = host();
    for (const k of ['vhdPath', 'vmPath']) if (o[k] != null) {
      const p = String(o[k]).trim().replace(/\\+$/, '');
      if (!/^[a-z]:\\/i.test(p)) return fail('InvalidPath', `The path '${o[k]}' is not valid. Specify a full path.`);
      h[k] = p;
    }
    for (const k of ['numaSpanning', 'enhancedSession']) if (o[k] != null) h[k] = !!o[k];
    if (o.memoryMB != null) h.memoryMB = +o.memoryMB;
    changed();
    return { ok: true };
  }
  function nextMac() {
    const h = host();
    const min = parseInt(h.macMin, 16), max = parseInt(h.macMax, 16);
    const used = new Set(st().vms.flatMap(v => v.nics.map(n => n.mac)));
    for (let i = 0; i <= max - min; i++) {
      const mac = (min + ((h.macNext + i) % (max - min + 1))).toString(16).toUpperCase().padStart(12, '0');
      if (!used.has(mac)) { h.macNext = (h.macNext + i + 1) % (max - min + 1); return mac; }
    }
    return 'FFFFFFFFFFFF';
  }
  const macDashed = m => m.match(/../g).join('-');

  /* ================================================================ virtual switches */
  const switches = () => (st() ? st().switches.slice() : []);
  const sw = name => (st() ? st().switches.find(x => lc(x.name) === lc(name)) || null : null);
  const vnicName = name => `vEthernet (${name})`;
  /** newSwitch({ name, type, adapter, allowManagementOS, notes }) */
  function newSwitch(o = {}) {
    if (!(o.atInstall ? st() : running())) return NOT_INSTALLED();
    const name = String(o.name || '').trim();
    const type = o.adapter ? 'External' : (o.type || 'Private');
    if (!name) return fail('InvalidName', 'The virtual switch name cannot be empty.');
    if (type === 'External') {
      const a = WS.net.adapter(o.adapter);
      if (!a || /^vEthernet/i.test(a.name)) return fail('NotFound', `No MSFT_NetAdapter objects found with property 'Name' equal to '${o.adapter}'.  Verify the value of the property and retry.`);
      if (st().switches.some(x => x.type === 'External' && lc(x.adapter) === lc(a.name))) return fail('InUse', `Failed while adding virtual Ethernet switch connections.\nEthernet port '${a.description}' bind failed: Cannot create a file when that file already exists. (0x800700B7).`);
    }
    if (sw(name)) return fail('Exists', `Failed while adding virtual Ethernet switch connections.\nA virtual switch named '${name}' already exists.`);
    const s = { id: U.guid(), name, type, adapter: type === 'External' ? WS.net.adapter(o.adapter).name : null, allowManagementOS: type === 'Internal' ? true : type === 'External' ? o.allowManagementOS !== false : false, notes: o.notes || '' };
    st().switches.push(s);
    plumb(s);
    changed();
    return { ok: true, switch: s };
  }
  /** The host side of a switch: External binds the physical adapter (its IP settings move to vEthernet when shared);
   * Internal gets a vEthernet adapter of its own on a separate segment; Private touches nothing on the host. */
  function plumb(s) {
    if (s.type === 'External') {
      const phys = WS.net.adapter(s.adapter);
      if (!phys) return;
      for (const b of ['ms_msclient', 'ms_server', 'ms_pacer', 'ms_tcpip', 'ms_lldp', 'ms_rspndr', 'ms_lltdio']) WS.net.setBinding(phys.name, b, false);
      WS.net.setBinding(phys.name, 'vms_pp', true);
      phys.ipv6 = false;
      if (s.allowManagementOS) { const v = WS.net.addAdapter({ name: vnicName(s.name), mac: phys.mac, index: 0, ip: null }); WS.net.moveIpConfig(phys, v); if (v.dhcp) WS.net.applyDhcp(v); }
      else Object.assign(phys, { ip: null, gateway: null, dnsServers: [] });
    } else if (s.type === 'Internal') {
      WS.net.addAdapter({ name: vnicName(s.name), segment: 'switch:' + lc(s.name) });
    }
  }
  function unplumb(s) {
    if (s.type === 'External') {
      const phys = WS.net.adapter(s.adapter), v = WS.net.adapter(vnicName(s.name));
      if (phys) {
        if (v) WS.net.moveIpConfig(v, phys);
        if (phys.bindings) for (const b of ['ms_msclient', 'ms_server', 'ms_pacer', 'ms_tcpip', 'ms_lldp', 'ms_rspndr', 'ms_lltdio', 'vms_pp']) delete phys.bindings[b];
        phys.ipv6 = true;
        if (phys.dhcp) WS.net.applyDhcp(phys);
      }
      if (v) WS.net.removeAdapter(v.name);
    } else if (s.type === 'Internal') WS.net.removeAdapter(vnicName(s.name));
  }
  function removeSwitch(name) {
    const s = sw(name);
    if (!s) return fail('NotFound', `Hyper-V was unable to find a virtual switch with name "${name}".`);
    unplumb(s);
    st().switches.splice(st().switches.indexOf(s), 1);
    for (const vm of st().vms) for (const n of vm.nics) if (lc(n.switch) === lc(s.name)) n.switch = null;
    syncPeers();
    changed();
    return { ok: true };
  }
  /** setSwitch(name, { name, type, adapter, allowManagementOS, notes }) - Virtual Switch Manager's Apply, Set-VMSwitch. */
  function setSwitch(name, o = {}) {
    const s = sw(name);
    if (!s) return fail('NotFound', `Hyper-V was unable to find a virtual switch with name "${name}".`);
    if (o.name != null && lc(o.name) !== lc(s.name)) {
      const nn = String(o.name).trim();
      if (!nn) return fail('InvalidName', 'The virtual switch name cannot be empty.');
      if (sw(nn)) return fail('Exists', `A virtual switch named '${nn}' already exists.`);
      const v = WS.net.adapter(vnicName(s.name));
      for (const vm of st().vms) for (const n of vm.nics) if (lc(n.switch) === lc(s.name)) n.switch = nn;
      if (v) v.name = vnicName(nn);
      if (s.type === 'Internal' && v) v.segment = 'switch:' + lc(nn);
      s.name = nn;
    }
    if (o.notes != null) s.notes = o.notes;
    const type = o.adapter ? 'External' : o.type || s.type;
    const allow = o.allowManagementOS != null ? !!o.allowManagementOS : type === 'Internal' ? true : type === 'External' ? s.allowManagementOS || s.type !== 'External' : false;
    if (type !== s.type || (type === 'External' && (allow !== s.allowManagementOS || (o.adapter && lc(o.adapter) !== lc(s.adapter))))) {
      if (type === 'External') {
        const a = WS.net.adapter(o.adapter || s.adapter || 'Ethernet');
        if (!a) return fail('NotFound', `No MSFT_NetAdapter objects found with property 'Name' equal to '${o.adapter}'.  Verify the value of the property and retry.`);
        if (st().switches.some(x => x !== s && x.type === 'External' && lc(x.adapter) === lc(a.name))) return fail('InUse', `Ethernet port '${a.description}' bind failed: Cannot create a file when that file already exists. (0x800700B7).`);
        unplumb(s); s.type = 'External'; s.adapter = a.name; s.allowManagementOS = allow; plumb(s);
      } else { unplumb(s); s.type = type; s.adapter = null; s.allowManagementOS = type === 'Internal'; plumb(s); }
    }
    syncPeers();
    changed();
    return { ok: true, switch: s };
  }

  /* ================================================================ virtual hard disks and ISOs */
  const vhdKey = p => lc(WS.fs.full(WS.fs.expandEnv(p)));
  const vhd = path => (st() ? st().vhds[vhdKey(path)] || null : null);
  const vhdFileSize = v => (v.type === 'Fixed' ? v.size + (v.format === 'VHD' ? 512 : 4 * MB) : (v.os ? 9.6 * GB + (v.used || 0) : 4 * MB) + (v.growth || 0));
  /** newVhd({ path, sizeBytes, type: 'Dynamic'|'Fixed'|'Differencing', parent, blockSize }) -> { ok, vhd } */
  function newVhd(o = {}) {
    if (!running()) return NOT_INSTALLED();
    let path = WS.fs.full(WS.fs.expandEnv(String(o.path || '').trim()));
    const m = /\.(vhdx?|avhdx?)$/i.exec(path);
    if (!m) return fail('InvalidExtension', `Failed to create the virtual hard disk.\nThe system failed to create '${path}': The file name is not valid. A virtual hard disk file name must end in .vhd or .vhdx. (0x8007007B).`);
    if (WS.fs.exists(path)) return fail('Exists', `Failed to create the virtual hard disk.\nThe system failed to create '${path}': The file exists. (0x80070050).`);
    const dir = path.replace(/\\[^\\]+$/, '');
    if (!WS.fs.isDir(dir)) { try { WS.fs.ensureDir(dir); } catch (e) { return fail('PathNotFound', `Failed to create the virtual hard disk.\nThe system failed to create '${path}': The system cannot find the path specified. (0x80070003).`); } }
    const type = o.type || (o.parent ? 'Differencing' : 'Dynamic');
    let size = +o.sizeBytes || 0;
    let parent = null, os = null;
    if (type === 'Differencing') {
      const pv = vhd(o.parent);
      if (!pv || !WS.fs.exists(o.parent)) return fail('ParentNotFound', `Failed to create the virtual hard disk.\nThe system failed to create '${path}': The system cannot find the file specified. (0x80070002).`);
      parent = pv.path; size = pv.size; os = pv.os ? { ...pv.os } : null;
    } else {
      if (size < 3 * MB) return fail('InvalidSize', `Failed to create the virtual hard disk.\nThe size of the virtual hard disk must be at least 3 MB.`);
      if (/\.vhd$/i.test(path) && size > 2040 * GB) return fail('InvalidSize', 'Failed to create the virtual hard disk.\nThe maximum size of a VHD file is 2040 GB.');
      if (size > 64 * 1024 * GB) return fail('InvalidSize', 'Failed to create the virtual hard disk.\nThe maximum size of a VHDX file is 64 TB.');
    }
    const v = { path, format: /x$/i.test(m[1]) ? 'VHDX' : 'VHD', type, size, parent, os, blockSize: o.blockSize || (/x$/i.test(m[1]) ? 32 * MB : 2 * MB), id: U.guid().toUpperCase() };
    st().vhds[lc(path)] = v;
    WS.fs.writeFile(path, '', null, { size: vhdFileSize(v) });
    changed();
    return { ok: true, vhd: v };
  }
  function resizeVhd(path, sizeBytes) {
    const v = vhd(path);
    if (!v || !WS.fs.exists(path)) return fail('NotFound', `Failed to resize the virtual disk.\nThe system failed to resize '${path}': The system cannot find the file specified. (0x80070002).`);
    if (attachedTo(path).some(x => x.state !== 'Off' && v.format === 'VHD')) return fail('InUse', `Failed to resize the virtual disk.\nThe system failed to resize '${path}': The process cannot access the file because it is being used by another process. (0x80070020).`);
    if (+sizeBytes < v.size && v.os) return fail('Shrink', `Failed to resize the virtual disk.\nThe size specified for '${path}' is too small. The minimum size is ${Math.ceil((v.size * 0.9))} bytes.`);
    v.size = +sizeBytes;
    WS.fs.writeFile(v.path, '', null, { size: vhdFileSize(v) });
    changed();
    return { ok: true, vhd: v };
  }
  const attachedTo = path => (st() ? st().vms.filter(vm => vm.disks.some(d => d.path && vhdKey(d.path) === vhdKey(path))) : []);
  /** writeIso(path, { label, os }) lays down an installation ISO (labs). */
  function writeIso(path, o = {}) {
    WS.fs.ensureDir(path.replace(/\\[^\\]+$/, ''));
    WS.fs.writeFile(path, ISO_MARK + JSON.stringify({ label: o.label || 'SSS_X64FREE_EN-US_DV9', os: o.os || 'Windows Server 2025' }), null, { size: o.size || 5_965_168_640 });
  }
  function isoInfo(path) {
    if (!path) return null;
    let t;
    try { t = WS.fs.readFile(path); } catch (e) { return null; }
    if (!String(t).startsWith(ISO_MARK)) return { bootable: false };
    try { return { bootable: true, ...JSON.parse(t.slice(ISO_MARK.length)) }; } catch (e) { return { bootable: false }; }
  }

  /* ================================================================ virtual machines */
  const vms = () => (st() ? st().vms.slice() : []);
  /** By GUID or name (the first match: Hyper-V allows several VMs with one name). */
  const vm = x => (!st() || x == null ? null : typeof x === 'object' ? (st().vms.includes(x) ? x : vm(x.id)) : st().vms.find(v => lc(v.id) === lc(x)) || st().vms.find(v => lc(v.name) === lc(x)) || null);
  const vmsNamed = name => vms().filter(v => lc(v.name) === lc(name) || lc(v.id) === lc(name));
  const notFoundVM = name => fail('NotFound', `Hyper-V was unable to find a virtual machine with name "${name}".`);
  const configFile = v => `${v.path}\\Virtual Machines\\${v.id.toUpperCase()}`;
  function writeConfig(v) {
    try {
      WS.fs.ensureDir(`${v.path}\\Virtual Machines`);
      WS.fs.writeFile(configFile(v) + '.vmcx', '', null, { size: 66 * 1024 });
      WS.fs.writeFile(configFile(v) + '.vmgs', '', null, { size: 1024 * 1024 });
      if (!WS.fs.exists(configFile(v) + '.VMRS')) WS.fs.writeFile(configFile(v) + '.VMRS', '', null, { size: 48 * 1024 });
    } catch (e) { /* a path the user typed that can't be created: the VM still exists */ }
  }
  /**
   * newVM({ name, generation, memoryMB, dynamicMemory, path (store elsewhere: <path>\<name>), switch, newVhd: { path, sizeBytes } | vhdPath | noVhd,
   *         iso, bootDevice: 'CD'|'VHD'|'NetworkAdapter', cpu }) -> { ok, vm }
   */
  function newVM(o = {}) {
    if (!running()) return NOT_INSTALLED();
    const name = String(o.name == null ? 'New Virtual Machine' : o.name).trim();
    if (!name) return fail('InvalidName', 'The virtual machine name cannot be empty.');
    if (name.length > 100 || /[\\/:*?"<>|]/.test(name)) return fail('InvalidName', `The virtual machine name '${name}' is not valid. It cannot contain \\ / : * ? " < > |.`);
    const gen = +(o.generation || 1);
    if (gen !== 1 && gen !== 2) return fail('InvalidGeneration', 'The generation must be 1 or 2.');
    const mem = +(o.memoryMB || 1024);
    if (mem < 32 || mem > 240 * 1024 || mem % 2) return fail('InvalidMemory', `The amount of memory you set is not valid. Type a value between 32 MB and ${240 * 1024} MB${mem % 2 ? ', and use an even number' : ''}.`);
    if (o.switch && !sw(o.switch)) return fail('SwitchNotFound', `Hyper-V was unable to find a virtual switch with name "${o.switch}".`);
    const id = U.guid().toUpperCase();
    const path = o.path ? `${WS.fs.full(String(o.path).replace(/\\+$/, ''))}\\${name}` : host().vmPath;
    const v = {
      id, name, generation: gen, version: '12.0', path, state: 'Off', created: new Date().toISOString(),
      memory: { startup: mem, dynamic: !!o.dynamicMemory, minimum: o.dynamicMemory ? Math.min(512, mem) : mem, maximum: o.dynamicMemory ? 1048576 : mem, buffer: 20 },
      cpu: { count: +(o.cpu || 1), nested: false },
      disks: [], dvds: gen === 2 ? [] : [{ controller: 'IDE', number: 1, location: 0, path: null }],
      nics: [{ id: 'nic-' + U.uid(), name: 'Network Adapter', switch: o.switch ? sw(o.switch).name : null, mac: nextMac(), dynamicMac: true, vlan: null }],
      firmware: { secureBoot: gen === 2, template: 'MicrosoftWindows', bootOrder: [] }, bios: { order: ['CD', 'IDE', 'LegacyNetworkAdapter', 'Floppy'] }, tpm: false,
      integration: Object.fromEntries(INTEGRATION.map(n => [n, n !== 'Guest Service Interface'])), checkpointType: 'Production', automaticCheckpoints: false,
      autoStart: 'StartIfRunning', autoStartDelay: 0, autoStop: 'Save', notes: o.notes || '', guest: { phase: 'off' }, checkpoints: [], current: null
    };
    // the hard disk: a new one (the wizard's default), an existing one, or none
    if (o.newVhd) {
      const vp = o.newVhd.path || `${o.path ? path + '\\Virtual Hard Disks' : host().vhdPath}\\${name}.vhdx`;
      const r = newVhd({ path: vp, sizeBytes: o.newVhd.sizeBytes || 127 * GB, type: o.newVhd.type || 'Dynamic' });
      if (!r.ok) return r;
      v.disks.push({ controller: gen === 2 ? 'SCSI' : 'IDE', number: 0, location: 0, path: r.vhd.path });
    } else if (o.vhdPath) {
      if (!WS.fs.exists(o.vhdPath)) return fail('VhdNotFound', `The system cannot find the file specified. ('${o.vhdPath}')`);
      if (!vhd(o.vhdPath)) adoptVhd(o.vhdPath);
      v.disks.push({ controller: gen === 2 ? 'SCSI' : 'IDE', number: 0, location: 0, path: WS.fs.full(o.vhdPath) });
    }
    if (o.iso) {
      if (gen === 2) v.dvds.push({ controller: 'SCSI', number: 0, location: v.disks.length, path: WS.fs.full(o.iso) });
      else v.dvds[0].path = WS.fs.full(o.iso);
    }
    v.firmware.bootOrder = defaultBootOrder(v, o.bootDevice || (o.iso ? 'CD' : null));
    st().vms.push(v);
    writeConfig(v);
    changed();
    return { ok: true, vm: v };
  }
  /** Generation 2 boot entries: 'disk:0', 'dvd:0', 'net:0' (index into disks/dvds/nics). */
  function defaultBootOrder(v, first) {
    const e = [...v.dvds.map((d, i) => 'dvd:' + i), ...v.disks.map((d, i) => 'disk:' + i), ...v.nics.map((n, i) => 'net:' + i)];
    if (first === 'VHD' || first === 'disk') e.sort((a, b) => (a.startsWith('disk') ? -1 : 0) - (b.startsWith('disk') ? -1 : 0));
    if (first === 'NetworkAdapter' || first === 'net') e.sort((a, b) => (a.startsWith('net') ? -1 : 0) - (b.startsWith('net') ? -1 : 0));
    if (!first || first === 'CD' || first === 'dvd') e.sort((a, b) => (a.startsWith('dvd') ? -1 : 0) - (b.startsWith('dvd') ? -1 : 0));
    return e;
  }
  function syncBootOrder(v) {
    const valid = new Set([...v.dvds.map((d, i) => 'dvd:' + i), ...v.disks.map((d, i) => 'disk:' + i), ...v.nics.map((n, i) => 'net:' + i)]);
    v.firmware.bootOrder = v.firmware.bootOrder.filter(e => valid.has(e));
    for (const e of valid) if (!v.firmware.bootOrder.includes(e)) v.firmware.bootOrder.push(e);
  }
  /** A VHD file that exists on disk but was not made by this model (copied, lab-provided) is a blank dynamic disk. */
  function adoptVhd(path) {
    const st0 = WS.fs.stat(path);
    if (!st0) return null;
    const v = { path: st0.path, format: /x$/i.test(path) ? 'VHDX' : 'VHD', type: 'Dynamic', size: 127 * GB, parent: null, os: null, blockSize: 32 * MB, id: U.guid().toUpperCase() };
    st().vhds[lc(st0.path)] = v;
    return v;
  }
  function removeVM(x) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state !== 'Off' && v.state !== 'Saved') return fail('InvalidState', `The operation cannot be performed while the virtual machine is in its current state.\nThe virtual machine '${v.name}' must be turned off before it can be deleted.`);
    for (const c of v.checkpoints) removeAvhd(v, c);
    for (const ext of ['.vmcx', '.vmgs', '.VMRS']) { try { WS.fs.remove(configFile(v) + ext); } catch (e) { /* gone */ } }
    st().vms.splice(st().vms.indexOf(v), 1);
    delete rt[v.id];
    syncPeers();
    changed();
    return { ok: true };
  }
  function renameVM(x, newName) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const n = String(newName || '').trim();
    if (!n || /[\\/:*?"<>|]/.test(n)) return fail('InvalidName', `The virtual machine name '${n}' is not valid.`);
    v.name = n;
    changed();
    return { ok: true };
  }
  const offOnly = (v, what) => (v.state === 'Off' ? null : fail('InvalidState', `${what} cannot be changed while the virtual machine is running. Turn off the virtual machine '${v.name}' and try again.`));
  /** setVM(vm, { memory: {...}, cpu, notes, autoStart, autoStartDelay, autoStop, checkpointType, automaticCheckpoints, integration: {name: bool}, tpm, secureBoot, template, bootOrder, nested }) */
  function setVM(x, o = {}) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (o.memory) {
      const m = { ...v.memory, ...o.memory };
      if (o.memory.dynamic != null && !!o.memory.dynamic !== v.memory.dynamic) { const e = offOnly(v, 'Dynamic memory'); if (e) return e; }
      if (o.memory.startup != null && +o.memory.startup !== v.memory.startup && !v.memory.dynamic) { const e = offOnly(v, 'The startup memory'); if (e) return e; }
      for (const k of ['startup', 'minimum', 'maximum']) { m[k] = +m[k]; if (!(m[k] >= 32) || m[k] % 2) return fail('InvalidMemory', `The ${k} memory value is not valid. Type an even value of at least 32 MB.`); }
      if (m.dynamic) {
        if (m.minimum > m.startup) return fail('InvalidMemory', `The minimum amount of memory (${m.minimum} MB) cannot be greater than the startup memory (${m.startup} MB).`);
        if (m.maximum < m.startup) return fail('InvalidMemory', `The maximum amount of memory (${m.maximum} MB) cannot be less than the startup memory (${m.startup} MB).`);
      } else { m.minimum = m.maximum = m.startup; }
      v.memory = m;
    }
    if (o.cpu != null && +o.cpu !== v.cpu.count) {
      const e = offOnly(v, 'The number of virtual processors'); if (e) return e;
      if (!(+o.cpu >= 1) || +o.cpu > WS.proc.NCPU) return fail('InvalidCpu', `The number of virtual processors must be between 1 and ${WS.proc.NCPU} (the logical processors on this computer).`);
      v.cpu.count = +o.cpu;
    }
    if (o.nested != null) { const e = offOnly(v, 'Virtualization extensions'); if (e) return e; v.cpu.nested = !!o.nested; }
    if (o.secureBoot != null || o.template != null) {
      if (v.generation !== 2) return fail('Generation', 'Secure Boot is only available for generation 2 virtual machines.');
      const e = offOnly(v, 'Secure Boot'); if (e) return e;
      if (o.secureBoot != null) v.firmware.secureBoot = !!o.secureBoot;
      if (o.template != null) v.firmware.template = o.template;
    }
    if (o.tpm != null) { if (v.generation !== 2) return fail('Generation', 'A virtual TPM is only available for generation 2 virtual machines.'); const e = offOnly(v, 'The TPM'); if (e) return e; v.tpm = !!o.tpm; }
    if (o.bootOrder) { if (v.generation === 2) v.firmware.bootOrder = o.bootOrder.slice(); else v.bios.order = o.bootOrder.slice(); }
    for (const k of ['notes', 'autoStart', 'autoStartDelay', 'autoStop', 'checkpointType', 'automaticCheckpoints']) if (o[k] != null) v[k] = k === 'autoStartDelay' ? +o[k] : o[k];
    if (o.integration) for (const [k, on] of Object.entries(o.integration)) { const n = INTEGRATION.find(x => lc(x) === lc(k)); if (n) v.integration[n] = !!on; }
    if (o.name != null) { const r = renameVM(v, o.name); if (!r.ok) return r; }
    writeConfig(v);
    syncPeers();
    changed();
    return { ok: true, vm: v };
  }

  /* ---------------- hardware ---------------- */
  function nextSlot(v, controller) {
    const used = [...v.disks, ...v.dvds].filter(d => d.controller === controller);
    if (controller === 'IDE') { for (const [n, l] of [[0, 0], [0, 1], [1, 0], [1, 1]]) if (!used.some(d => d.number === n && d.location === l)) return { number: n, location: l }; return null; }
    for (let l = 0; l < 64; l++) if (!used.some(d => d.number === 0 && d.location === l)) return { number: 0, location: l };
    return null;
  }
  function addDisk(x, o = {}) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const path = o.path ? WS.fs.full(WS.fs.expandEnv(o.path)) : null;
    if (path && !WS.fs.exists(path)) return fail('VhdNotFound', `Failed to add device 'Virtual Hard Disk'.\nThe system cannot find the file specified. ('${path}') (0x80070002).`);
    const controller = o.controller || (v.generation === 2 ? 'SCSI' : 'IDE');
    if (v.generation === 2 && controller === 'IDE') return fail('Generation', 'Generation 2 virtual machines do not have IDE controllers.');
    if (controller === 'IDE' && v.state !== 'Off') return fail('InvalidState', 'A disk cannot be added to an IDE controller while the virtual machine is running.');
    if (path && attachedTo(path).some(a => a !== v)) return fail('InUse', `Failed to add device 'Virtual Hard Disk'.\nThe process cannot access the file because it is being used by another process. (0x80070020).`);
    if (path && !vhd(path)) adoptVhd(path);
    const slot = o.location != null ? { number: +(o.number || 0), location: +o.location } : nextSlot(v, controller);
    if (!slot) return fail('NoSlot', 'There is no free location on the controller.');
    const d = { controller, ...slot, path };
    v.disks.push(d);
    syncBootOrder(v); writeConfig(v); changed();
    return { ok: true, disk: d };
  }
  function removeDisk(x, i) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const d = v.disks[i];
    if (!d) return fail('NotFound', 'The specified hard drive was not found.');
    if (d.controller === 'IDE' && v.state !== 'Off') return fail('InvalidState', 'A disk on an IDE controller cannot be removed while the virtual machine is running.');
    v.disks.splice(i, 1);
    v.firmware.bootOrder = v.firmware.bootOrder.map(e => (e.startsWith('disk:') ? (+e.slice(5) === i ? null : +e.slice(5) > i ? 'disk:' + (+e.slice(5) - 1) : e) : e)).filter(Boolean);
    syncBootOrder(v); changed();
    return { ok: true };
  }
  function setDiskPath(x, i, path) {
    const v = vm(x); if (!v) return notFoundVM(x);
    const d = v.disks[i]; if (!d) return fail('NotFound', 'The specified hard drive was not found.');
    if (path && !WS.fs.exists(path)) return fail('VhdNotFound', `The system cannot find the file specified. ('${path}')`);
    if (path && !vhd(path)) adoptVhd(path);
    d.path = path ? WS.fs.full(path) : null;
    changed();
    return { ok: true };
  }
  /** setDvd(vm, path|null, index) - insert or eject an ISO (adds a DVD drive to a generation 2 VM that has none). */
  function setDvd(x, path, i = 0) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (path) {
      const full = WS.fs.full(WS.fs.expandEnv(path));
      if (!WS.fs.exists(full)) return fail('IsoNotFound', `Failed to add device 'Virtual CD/DVD Disk'.\nThe system cannot find the file specified. ('${full}') (0x80070002).`);
      if (!/\.iso$/i.test(full)) return fail('NotIso', `'${full}' is not a valid image file. Select an ISO file.`);
      path = full;
    }
    if (!v.dvds[i]) {
      if (!path) return { ok: true };
      const r = addDvd(v, path); return r;
    }
    v.dvds[i].path = path || null;
    changed();
    return { ok: true };
  }
  function addDvd(x, path) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const controller = v.generation === 2 ? 'SCSI' : 'IDE';
    if (controller === 'IDE' && v.state !== 'Off') return fail('InvalidState', 'A DVD drive cannot be added to an IDE controller while the virtual machine is running.');
    const slot = nextSlot(v, controller);
    if (!slot) return fail('NoSlot', 'There is no free location on the controller.');
    v.dvds.push({ controller, ...slot, path: path ? WS.fs.full(path) : null });
    syncBootOrder(v); changed();
    return { ok: true };
  }
  function removeDvd(x, i) {
    const v = vm(x); if (!v) return notFoundVM(x);
    if (!v.dvds[i]) return fail('NotFound', 'The specified DVD drive was not found.');
    v.dvds.splice(i, 1);
    v.firmware.bootOrder = v.firmware.bootOrder.map(e => (e.startsWith('dvd:') ? (+e.slice(4) === i ? null : +e.slice(4) > i ? 'dvd:' + (+e.slice(4) - 1) : e) : e)).filter(Boolean);
    syncBootOrder(v); changed();
    return { ok: true };
  }
  function addNic(x, o = {}) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state !== 'Off' && v.generation === 1) return fail('InvalidState', 'A network adapter cannot be added to a generation 1 virtual machine while it is running.');
    if (o.switch && !sw(o.switch)) return fail('SwitchNotFound', `Hyper-V was unable to find a virtual switch with name "${o.switch}".`);
    const n = { id: 'nic-' + U.uid(), name: o.name || 'Network Adapter', switch: o.switch ? sw(o.switch).name : null, mac: o.mac || nextMac(), dynamicMac: !o.mac, vlan: null };
    v.nics.push(n);
    syncBootOrder(v); syncPeers(); changed();
    return { ok: true, nic: n };
  }
  function removeNic(x, i) {
    const v = vm(x); if (!v) return notFoundVM(x);
    if (!v.nics[i]) return fail('NotFound', 'The specified network adapter was not found.');
    v.nics.splice(i, 1);
    v.firmware.bootOrder = v.firmware.bootOrder.map(e => (e.startsWith('net:') ? (+e.slice(4) === i ? null : +e.slice(4) > i ? 'net:' + (+e.slice(4) - 1) : e) : e)).filter(Boolean);
    syncBootOrder(v); syncPeers(); changed();
    return { ok: true };
  }
  /** connectNic(vm, index, switchName|null), setNic(vm, index, { vlan, mac, dynamicMac }) */
  function connectNic(x, i, switchName) {
    const v = vm(x); if (!v) return notFoundVM(x);
    const n = v.nics[i]; if (!n) return fail('NotFound', 'The specified network adapter was not found.');
    if (switchName && !sw(switchName)) return fail('SwitchNotFound', `Hyper-V was unable to find a virtual switch with name "${switchName}".`);
    n.switch = switchName ? sw(switchName).name : null;
    syncPeers(); changed();
    return { ok: true };
  }
  function setNic(x, i, o = {}) {
    const v = vm(x); if (!v) return notFoundVM(x);
    const n = v.nics[i]; if (!n) return fail('NotFound', 'The specified network adapter was not found.');
    if ('vlan' in o) { const id = o.vlan == null || o.vlan === '' ? null : +o.vlan; if (id != null && !(id >= 1 && id <= 4094)) return fail('InvalidVlan', 'The VLAN identifier must be between 1 and 4094.'); n.vlan = id; }
    if (o.mac != null) { const m = String(o.mac).replace(/[-:]/g, '').toUpperCase(); if (!/^[0-9A-F]{12}$/.test(m)) return fail('InvalidMac', `'${o.mac}' is not a valid MAC address.`); n.mac = m; n.dynamicMac = false; }
    if (o.dynamicMac) n.dynamicMac = true;
    if (o.name != null) n.name = o.name;
    syncPeers(); changed();
    return { ok: true };
  }

  /* ================================================================ power and the guest */
  let rt = {}; // per-VM runtime timers (not saved)
  const clearRt = v => { const r = rt[v.id]; if (r) { (r.timers || []).forEach(clearTimeout); } rt[v.id] = { timers: [] }; return rt[v.id]; };
  const timer = (v, fn, ms) => { const r = rt[v.id] || (rt[v.id] = { timers: [] }); r.timers.push(later(() => { if (vm(v.id) === v) fn(); }, ms)); };
  const bootDisk = v => {
    for (const e of v.generation === 2 ? v.firmware.bootOrder : biosEntries(v)) {
      if (e.startsWith('disk:')) { const d = v.disks[+e.slice(5)]; const x = d && d.path && vhd(d.path); if (x && x.os) return x; }
    }
    return null;
  };
  const osDisk = v => { for (const d of v.disks) { const x = d.path && vhd(d.path); if (x && x.os) return x; } return null; };
  const guestOs = v => { const d = osDisk(v); return d ? d.os : null; };
  /** Generation 1 BIOS order expressed as entries. */
  const biosEntries = v => v.bios.order.flatMap(k => (k === 'CD' ? v.dvds.map((d, i) => 'dvd:' + i) : k === 'IDE' ? v.disks.map((d, i) => 'disk:' + i) : k === 'LegacyNetworkAdapter' ? v.nics.map((n, i) => 'net:' + i) : []));
  const memoryInUse = except => vms().filter(v => v !== except && (v.state === 'Running' || v.state === 'Paused')).reduce((n, v) => n + v.memory.startup, 0);
  const memoryAvailable = except => host().memoryMB - memoryInUse(except);

  function startVM(x) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (!running()) return NOT_INSTALLED();
    if (v.state === 'Running') return fail('InvalidState', `The operation cannot be performed while the object is in its current state.\n'${v.name}' is already running.`);
    if (v.state === 'Paused') return resumeVM(v);
    const head = `'${v.name}' failed to start.\n\n`;
    if (v.state !== 'Saved' && memoryAvailable(v) < v.memory.startup)
      return fail('NotEnoughMemory', `${head}'${v.name}' failed to start. (Virtual machine ID ${v.id})\n\nNot enough memory in the system to start the virtual machine ${v.name} with ram size ${v.memory.startup} megabytes. (Virtual machine ID ${v.id})`);
    for (const d of v.disks) if (d.path && !WS.fs.exists(d.path)) return fail('VhdMissing', `${head}Synthetic SCSI Controller (Instance ID ...): Failed to Power on with Error 'The system cannot find the file specified.'\n\nFailed to open attachment '${d.path}'. Error: 'The system cannot find the file specified.'`);
    for (const d of v.dvds) if (d.path && !WS.fs.exists(d.path)) return fail('IsoMissing', `${head}Failed to open attachment '${d.path}'. Error: 'The system cannot find the file specified.'`);
    if (v.nics.some(n => n.switch && !sw(n.switch))) return fail('SwitchMissing', `${head}Could not find Ethernet switch '${v.nics.find(n => n.switch && !sw(n.switch)).switch}'.`);
    const fromSave = v.state === 'Saved';
    v.state = 'Running'; v.startedAt = fromSave && v.uptimeAtSave != null ? Date.now() - v.uptimeAtSave : Date.now(); delete v.uptimeAtSave;
    clearRt(v);
    if (fromSave) resumeGuest(v); else powerOn(v);
    syncPeers(); changed();
    return { ok: true };
  }
  /** Firmware: try each boot device in order. */
  function powerOn(v) {
    v.guest = { phase: 'post' };
    const order = v.generation === 2 ? v.firmware.bootOrder : biosEntries(v);
    const tried = [];
    const step = i => {
      if (v.state !== 'Running') return;
      const e = order[i];
      if (!e) { v.guest = { phase: 'bootfail', tried }; changed(); return; }
      const kind = e.split(':')[0], idx = +e.split(':')[1];
      if (kind === 'dvd') {
        const d = v.dvds[idx], iso = d && isoInfo(d.path);
        const label = v.generation === 2 ? `SCSI DVD    (${d ? d.number : 0},${d ? d.location : 1})` : 'CD/DVD';
        if (iso && iso.bootable) {
          if (v.generation === 2 && v.firmware.secureBoot && v.firmware.template !== 'MicrosoftWindows' && v.firmware.template !== 'MicrosoftUEFICertificateAuthority') { tried.push([label, 'The image\u2019s hash and certificate are not allowed (DB).']); return step(i + 1); }
          // "Press any key to boot from CD or DVD..." waits about five seconds, then the firmware moves on
          v.guest = { phase: 'presskey', iso: d.path, next: i + 1, tried };
          changed();
          timer(v, () => { if (v.guest.phase === 'presskey') { tried.push([label, 'The boot loader did not load an operating system.']); step(i + 1); } }, 5000);
          return;
        }
        tried.push([label, d && d.path ? 'The boot loader did not load an operating system.' : 'The boot loader did not load an operating system.']);
        return step(i + 1);
      }
      if (kind === 'disk') {
        const d = v.disks[idx], x = d && d.path && vhd(d.path);
        const label = v.generation === 2 ? `SCSI Disk   (${d ? d.number : 0},${d ? d.location : 0})` : 'Hard drive';
        if (x && x.os) {
          if (v.generation === 2 && v.firmware.secureBoot && v.firmware.template !== 'MicrosoftWindows') { tried.push([label, 'The image\u2019s hash and certificate are not allowed (DB).']); return step(i + 1); }
          v.guest = { phase: 'booting' }; changed();
          timer(v, () => { v.guest = { phase: x.os.setupDone ? 'locked' : 'oobe' }; syncPeers(); changed(); }, 3500);
          return;
        }
        tried.push([label, 'The boot loader did not load an operating system.']);
        return step(i + 1);
      }
      const n = v.nics[idx];
      tried.push([v.generation === 2 ? `Network Adapter (${n ? n.mac : ''})` : 'Network', 'A boot image was not found.']);
      step(i + 1);
    };
    timer(v, () => step(0), 600);
  }
  function resumeGuest(v) {
    const g = v.guest || { phase: 'off' };
    if (g.phase === 'installing') installTimers(v);
    if (g.phase === 'presskey') { g.phase = 'bootfail'; g.tried = g.tried || []; }
    changed();
  }
  /** VMConnect: a key at "Press any key to boot from CD or DVD..." starts Windows Setup. */
  function pressKey(x) {
    const v = vm(x);
    if (!v || v.state !== 'Running' || v.guest.phase !== 'presskey') return false;
    clearRt(v);
    v.guest = { phase: 'setup', step: 'loading', iso: v.guest.iso };
    changed();
    timer(v, () => { if (v.guest.phase === 'setup' && v.guest.step === 'loading') { v.guest.step = 'language'; changed(); } }, 2500);
    return true;
  }
  const EDITION_IDS = EDITIONS.map(e => e.id);
  /** Windows Setup steps: language -> keyboard -> option -> image -> license -> disk -> ready -> installing. */
  function setupStep(x, step, data = {}) {
    const v = vm(x);
    if (!v || v.state !== 'Running' || v.guest.phase !== 'setup') return fail('InvalidState', 'Windows Setup is not running.');
    const g = v.guest;
    if (step === 'image' && data.edition && !EDITION_IDS.includes(data.edition)) return fail('InvalidEdition', 'Select an image.');
    if (data.edition) g.edition = data.edition;
    if (step === 'install') {
      const target = v.disks.find(d => d.path && vhd(d.path));
      if (!target) return fail('NoDisk', 'Windows Setup couldn\u2019t find a drive to install Windows on. Make sure the drives are attached and turned on.');
      const x2 = vhd(target.path);
      if (x2.size < 32 * GB) return fail('DiskTooSmall', `Windows can\u2019t be installed on this drive. The drive is too small: Windows Server needs at least 32 GB (this one is ${Math.round(x2.size / GB)} GB).`);
      g.phase = 'installing'; g.progress = 0; g.target = x2.path; g.edition = g.edition || 'dc';
      changed();
      installTimers(v);
      return { ok: true };
    }
    g.step = step;
    changed();
    return { ok: true };
  }
  function installTimers(v) {
    clearRt(v);
    const tick = () => {
      if (v.state !== 'Running' || v.guest.phase !== 'installing') return;
      v.guest.progress = Math.min(100, (v.guest.progress || 0) + 4);
      changed();
      if (v.guest.progress < 100) { timer(v, tick, 500); return; }
      const ed = EDITIONS.find(e => e.id === v.guest.edition) || EDITIONS[3];
      const x = vhd(v.guest.target);
      x.os = { product: 'Windows Server 2025', edition: ed.name, desktop: ed.desktop, computerName: 'WIN-' + U.randomAlnum(11).toUpperCase(), setupDone: false, password: null, icmp: false, build: '26100.1742' };
      WS.fs.writeFile(x.path, '', null, { size: vhdFileSize(x) });
      // Setup restarts the VM; the firmware now finds the installed disk (Setup moves Windows Boot Manager first)
      if (v.generation === 2) { const di = v.disks.findIndex(d => d.path === x.path); v.firmware.bootOrder = ['disk:' + di, ...v.firmware.bootOrder.filter(e => e !== 'disk:' + di)]; }
      v.guest = { phase: 'booting' };
      changed();
      timer(v, () => { v.guest = { phase: 'oobe' }; syncPeers(); changed(); }, 3500);
    };
    timer(v, tick, 500);
  }
  /** The guest's "Customize settings" page (Administrator password, with Windows' complexity rules). */
  function guestSetPassword(x, password) {
    const v = vm(x), os = v && guestOs(v);
    if (!v || !os || v.guest.phase !== 'oobe') return fail('InvalidState', 'The guest is not at Customize settings.');
    const err = U.checkPassword(String(password || ''), { sam: 'Administrator' });
    if (err) return fail('PasswordPolicy', err);
    os.password = String(password); os.setupDone = true;
    v.guest = { phase: 'locked' };
    changed();
    return { ok: true };
  }
  function guestSignIn(x, password) {
    const v = vm(x), os = v && guestOs(v);
    if (!v || !os || v.guest.phase !== 'locked') return fail('InvalidState', 'The guest is not at the sign-in screen.');
    if (String(password) !== os.password) return fail('BadPassword', 'The password is incorrect. Try again.');
    v.guest = { phase: 'desktop' };
    changed();
    return { ok: true };
  }
  const guestUp = v => v.state === 'Running' && ['oobe', 'locked', 'desktop'].includes(v.guest.phase) && !!guestOs(v);

  function stopVM(x, o = {}) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state === 'Off') return o.quiet ? { ok: true } : fail('InvalidState', `The virtual machine '${v.name}' is already turned off.`);
    if (o.turnOff || v.state === 'Saved') {
      clearRt(v);
      if (v.state === 'Saved') { try { WS.fs.remove(configFile(v) + '.VMRS'); WS.fs.writeFile(configFile(v) + '.VMRS', '', null, { size: 48 * 1024 }); } catch (e) { /* none */ } }
      v.state = 'Off'; v.guest = { phase: 'off' }; delete v.startedAt;
      syncPeers(); changed();
      return { ok: true };
    }
    // a guest shutdown needs the Shutdown integration service and a running OS
    if (!guestUp(v) || !v.integration.Shutdown || v.state === 'Paused') {
      return fail('NoShutdown', `Failed to shut down the virtual machine '${v.name}'.\nThe virtual machine is not in a valid state to perform the operation. The operating system in the virtual machine is not running, or the Shutdown integration service is not available.`);
    }
    v.guest = { phase: 'shuttingdown' };
    changed();
    timer(v, () => { v.state = 'Off'; v.guest = { phase: 'off' }; delete v.startedAt; syncPeers(); changed(); }, 3000);
    return { ok: true, pending: true };
  }
  function saveVM(x) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state !== 'Running' && v.state !== 'Paused') return fail('InvalidState', `The operation cannot be performed while the object is in its current state.\n'${v.name}' is not running.`);
    (rt[v.id] && rt[v.id].timers || []).forEach(clearTimeout);
    v.uptimeAtSave = Date.now() - (v.startedAt || Date.now());
    v.state = 'Saved'; delete v.startedAt;
    try { WS.fs.writeFile(configFile(v) + '.VMRS', '', null, { size: v.memory.startup * MB }); } catch (e) { /* path */ }
    syncPeers(); changed();
    return { ok: true };
  }
  function pauseVM(x) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state !== 'Running') return fail('InvalidState', `The operation cannot be performed while the object is in its current state.\n'${v.name}' is not running.`);
    v.state = 'Paused';
    changed();
    return { ok: true };
  }
  function resumeVM(x) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state !== 'Paused') return fail('InvalidState', `The operation cannot be performed while the object is in its current state.\n'${v.name}' is not paused.`);
    v.state = 'Running';
    changed();
    return { ok: true };
  }
  /** Reset (VMConnect) / Restart-VM -Force: power cycle without a guest shutdown. */
  function resetVM(x) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.state !== 'Running') return fail('InvalidState', `The operation cannot be performed while the object is in its current state.\n'${v.name}' is not running.`);
    clearRt(v);
    v.startedAt = Date.now();
    powerOn(v);
    syncPeers(); changed();
    return { ok: true };
  }
  /** Ctrl+Alt+Delete from VMConnect: at a boot error or "Press any key", the firmware restarts the boot sequence. */
  function ctrlAltDel(x) {
    const v = vm(x);
    if (!v || v.state !== 'Running') return false;
    if (['bootfail', 'presskey', 'post'].includes(v.guest.phase)) { resetVM(v); return true; }
    if (v.guest.phase === 'locked') { v.guest.prompt = true; changed(); return true; }
    return false;
  }

  /* ================================================================ checkpoints */
  const checkpointName = v => { const d = new Date(); return `${v.name} - (${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} - ${U.fmtTime(d, true)})`; };
  const snapCopy = v => JSON.parse(JSON.stringify({ ...v, checkpoints: undefined, current: undefined }));
  function avhdPath(v, c, d) { return d.path.replace(/\.(a?vhdx?)$/i, '') + `_${c.id.toUpperCase()}.avhdx`; }
  function checkpointVM(x, name) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    if (v.checkpointType === 'Disabled') return fail('Disabled', `Checkpoint operation for '${v.name}' was cancelled. Checkpoints are disabled for this virtual machine.`);
    if (v.disks.some(d => d.path && vhd(d.path) && vhd(d.path).type === 'Fixed' && false)) return fail('Unsupported', 'unsupported');
    let type = v.checkpointType === 'Standard' ? 'Standard' : 'Production';
    if (type === 'Production' && v.state === 'Running' && !(guestUp(v) && v.integration.VSS)) {
      if (v.checkpointType === 'ProductionOnly') return fail('ProductionFailed', `Production checkpoints cannot be created for '${v.name}'. (Virtual machine ID ${v.id})\n\nThe operating system in the virtual machine is not running, or the Backup (volume shadow copy) integration service is not available.`);
      type = 'Standard';
    }
    const c = { id: U.guid(), name: name || checkpointName(v), parent: v.current, created: new Date().toISOString(), type: type === 'Production' ? 'Production' : 'Standard',
      snap: { config: snapCopy(v), state: type === 'Production' || v.state === 'Off' ? 'Off' : 'Saved', os: Object.fromEntries(v.disks.filter(d => d.path && vhd(d.path)).map(d => [lc(d.path), vhd(d.path).os ? { ...vhd(d.path).os } : null])) } };
    v.checkpoints.push(c);
    v.current = c.id;
    for (const d of v.disks) if (d.path) { try { WS.fs.writeFile(avhdPath(v, c, d), '', null, { size: 4 * MB }); } catch (e) { /* path */ } }
    changed();
    return { ok: true, checkpoint: c };
  }
  const checkpoint = (x, idOrName) => { const v = vm(x); return v ? v.checkpoints.find(c => lc(c.id) === lc(idOrName) || lc(c.name) === lc(idOrName)) || null : null; };
  function applyCheckpoint(x, idOrName) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const c = checkpoint(v, idOrName);
    if (!c) return fail('NotFound', `Hyper-V was unable to find a checkpoint with name "${idOrName}" for virtual machine '${v.name}'.`);
    if (v.state === 'Running' || v.state === 'Paused') { clearRt(v); }
    const keep = { id: v.id, name: v.name, checkpoints: v.checkpoints, path: v.path, created: v.created, notes: v.notes };
    const cfg = JSON.parse(JSON.stringify(c.snap.config));
    Object.assign(v, cfg, keep, { current: c.id });
    for (const [k, os] of Object.entries(c.snap.os)) if (st().vhds[k]) st().vhds[k].os = os ? { ...os } : null;
    v.state = c.snap.state;
    if (v.state === 'Off') v.guest = { phase: 'off' };
    delete v.startedAt;
    if (v.state === 'Saved') v.uptimeAtSave = v.uptimeAtSave || 0;
    syncPeers(); changed();
    return { ok: true };
  }
  function removeAvhd(v, c) { for (const d of v.disks) if (d.path) { try { WS.fs.remove(avhdPath(v, c, d)); } catch (e) { /* none */ } } }
  /** removeCheckpoint(vm, idOrName, { subtree }) - the differencing disks merge back. */
  function removeCheckpoint(x, idOrName, o = {}) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const c = checkpoint(v, idOrName);
    if (!c) return fail('NotFound', `Hyper-V was unable to find a checkpoint with name "${idOrName}" for virtual machine '${v.name}'.`);
    const doomed = new Set([c.id]);
    if (o.subtree) for (let more = true; more;) { more = false; for (const k of v.checkpoints) if (!doomed.has(k.id) && doomed.has(k.parent)) { doomed.add(k.id); more = true; } }
    for (const k of v.checkpoints) if (!doomed.has(k.id) && doomed.has(k.parent)) k.parent = c.parent;
    for (const k of v.checkpoints.filter(k => doomed.has(k.id))) removeAvhd(v, k);
    v.checkpoints = v.checkpoints.filter(k => !doomed.has(k.id));
    if (doomed.has(v.current)) v.current = c.parent && !doomed.has(c.parent) ? c.parent : null;
    changed();
    return { ok: true };
  }
  function renameCheckpoint(x, idOrName, name) {
    const v = vm(x); const c = v && checkpoint(v, idOrName);
    if (!c) return fail('NotFound', `Hyper-V was unable to find a checkpoint with name "${idOrName}".`);
    c.name = String(name || '').trim() || c.name;
    changed();
    return { ok: true };
  }

  /* ================================================================ export */
  function exportVM(x, dest) {
    const v = vm(x);
    if (!v) return notFoundVM(x);
    const root = `${WS.fs.full(String(dest).replace(/\\+$/, ''))}\\${v.name}`;
    if (WS.fs.exists(root + '\\Virtual Machines')) return fail('Exists', `Failed to export the virtual machine.\nA virtual machine export already exists at '${root}'. (0x80070050).`);
    WS.fs.ensureDir(root + '\\Virtual Machines'); WS.fs.ensureDir(root + '\\Virtual Hard Disks'); WS.fs.ensureDir(root + '\\Snapshots');
    WS.fs.writeFile(`${root}\\Virtual Machines\\${v.id.toUpperCase()}.vmcx`, '', null, { size: 66 * 1024 });
    WS.fs.writeFile(`${root}\\Virtual Machines\\${v.id.toUpperCase()}.vmgs`, '', null, { size: 1024 * 1024 });
    for (const d of v.disks) if (d.path && vhd(d.path)) {
      const to = `${root}\\Virtual Hard Disks\\${d.path.split('\\').pop()}`;
      const src = vhd(d.path);
      WS.fs.writeFile(to, '', null, { size: vhdFileSize(src) });
      st().vhds[lc(to)] = { ...JSON.parse(JSON.stringify(src)), path: to, id: U.guid().toUpperCase() };
    }
    changed();
    return { ok: true, path: root };
  }

  /* ================================================================ the guest on the network */
  /** Running guests with an OS on an external switch are DHCP clients on the lab LAN (WS.dhcp leases to them). */
  function syncPeers() {
    const n = WS.state.network;
    if (!n) return;
    const before = JSON.stringify(n.peers.filter(p => p.vmId).map(p => [p.vmId, p.name, p.mac, p.icmp]));
    n.peers = n.peers.filter(p => !p.vmId);
    if (st()) for (const v of st().vms) {
      if (!guestUp(v)) continue;
      const os = guestOs(v);
      v.nics.forEach((nic, i) => {
        const s = nic.switch && sw(nic.switch);
        if (!s || s.type !== 'External' || nic.vlan) return;
        n.peers.push({ name: os.computerName, ip: null, mac: macDashed(nic.mac), icmp: !!os.icmp, ttl: 128, dhcpClient: true, vmId: v.id, nic: i });
      });
    }
    const after = JSON.stringify(n.peers.filter(p => p.vmId).map(p => [p.vmId, p.name, p.mac, p.icmp]));
    if (before !== after) { if (WS.dhcp) WS.dhcp.refreshLeases(); else WS.store.changed('network'); }
  }
  /** Guest addresses as Get-VMNetworkAdapter reports them (Key-Value Pair Exchange must be on). */
  function guestIps(v, nicIndex) {
    if (!guestUp(v) || !v.integration['Key-Value Pair Exchange']) return [];
    const nic = v.nics[nicIndex], s = nic && nic.switch && sw(nic.switch);
    if (!s) return [];
    const p = WS.state.network.peers.find(x => x.vmId === v.id && x.nic === nicIndex);
    const ll = 'fe80::' + (U.hashStr(nic.mac) % 0xffff).toString(16) + ':' + (U.hashStr(nic.mac + 'b') % 0xffff).toString(16) + ':' + (U.hashStr(nic.mac + 'c') % 0xffff).toString(16) + ':' + (U.hashStr(nic.mac + 'd') % 0xffff).toString(16);
    const v4 = p && p.ip ? p.ip : '169.254.' + (1 + U.hashStr(nic.mac) % 254) + '.' + (1 + U.hashStr(nic.mac + 'y') % 254);
    return [v4, ll];
  }

  /* ---------------- vmwp.exe: one worker process per running VM ---------------- */
  if (WS.proc && WS.proc.addSource) WS.proc.addSource(add => {
    if (!st() || !WS.svc.isRunning('vmms')) return;
    for (const v of st().vms) {
      if (v.state !== 'Running' && v.state !== 'Paused') continue;
      add('vmwp:' + v.id + ':' + (v.startedAt || 0), { image: 'vmwp.exe', path: 'C:\\Windows\\System32\\vmwp.exe', description: 'Virtual Machine Worker Process', user: v.id.toUpperCase(), accountDomain: 'NT VIRTUAL MACHINE',
        kind: 'background', cpuBase: v.guest.phase === 'installing' ? 22 : guestUp(v) ? 1.5 : 0.4, memBase: 18400, threads: 30, handles: 900, parentKey: 'svc:vmms', status: v.state === 'Paused' ? 'Suspended' : 'Running',
        cmdLine: `"C:\\Windows\\System32\\vmwp.exe" ${v.id.toUpperCase()} 0x${(U.hashStr(v.id) >>> 0).toString(16)}` });
    }
  });

  /* ---------------- status texts ---------------- */
  /** Hyper-V Manager's State / Status / Assigned Memory / Uptime / CPU Usage columns. */
  function info(v) {
    const on = v.state === 'Running' || v.state === 'Paused';
    const up = on ? Date.now() - (v.startedAt || Date.now()) : 0;
    const hms = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const g = v.guest || {};
    const cpu = !on || v.state === 'Paused' ? 0 : g.phase === 'installing' ? 25 + (U.hashStr(String(Math.floor(Date.now() / 1000))) % 20) : g.phase === 'presskey' || g.phase === 'bootfail' ? 0 : g.phase === 'setup' ? 2 : 1;
    const heartbeat = !v.integration.Heartbeat ? 'Disabled' : !on ? '' : guestUp(v) ? 'OK' : 'No Contact';
    return {
      state: v.state, cpu, assignedMB: on ? v.memory.startup : 0, demandMB: on ? Math.round(v.memory.startup * (guestUp(v) ? 0.62 : 0.3)) : 0, uptime: hms(up), uptimeMs: up,
      status: g.phase === 'shuttingdown' ? 'Shutting down...' : v.state === 'Saved' ? '' : 'Operating normally', heartbeat
    };
  }

  WS.hv = {
    installed, running, host, setHost, setInstallOptions: o => { WS.state.hvInstall = o ? { ...o } : null; }, EDITIONS, INTEGRATION, DEFAULT_VM_PATH, DEFAULT_VHD_PATH,
    switches, switch: sw, newSwitch, removeSwitch, setSwitch, vnicName,
    vhd, vhds: () => (st() ? Object.values(st().vhds) : []), newVhd, resizeVhd, attachedTo, writeIso, isoInfo, vhdFileSize,
    vms, vm, vmsNamed, newVM, removeVM, renameVM, setVM, configFile,
    addDisk, removeDisk, setDiskPath, setDvd, addDvd, removeDvd, addNic, removeNic, connectNic, setNic, defaultBootOrder,
    start: startVM, stop: stopVM, save: saveVM, pause: pauseVM, resume: resumeVM, reset: resetVM, ctrlAltDel, pressKey, setupStep, guestSetPassword, guestSignIn,
    guestOs, guestUp, guestIps, memoryAvailable,
    checkpoint: checkpointVM, checkpoints: x => { const v = vm(x); return v ? v.checkpoints.slice() : []; }, findCheckpoint: checkpoint, applyCheckpoint, removeCheckpoint, renameCheckpoint,
    exportVM, info, syncPeers, macDashed,
    get timeScale() { return timeScale; }, set timeScale(v) { timeScale = v; }
  };
})();
