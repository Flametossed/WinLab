/* PowerShell Hyper-V module (installed with "Hyper-V Module for Windows PowerShell", feature Hyper-V-PowerShell):
 * VMs, switches, virtual hard disks, hardware, firmware, integration services, checkpoints, the host, plus the
 * native vmconnect.exe. Everything goes through WS.hv, so Hyper-V Manager shows the same objects. */
(function () {
  'use strict';
  const WS = window.WS, U = WS.util, PS = WS.ps;
  const { psobj, toStr, toBool, cmdlet, view } = PS;
  const { wild, hasWild } = PS.helpers;
  const H = () => WS.hv;
  const MB = 1024 ** 2, GB = 1024 ** 3;
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const MOD = 'Hyper-V';
  const cls = n => `Microsoft.HyperV.PowerShell.Commands.${n.replace('-', '')}`;
  const hv = def => cmdlet({ module: MOD, version: '2.0.0.0', feature: 'Hyper-V-PowerShell', ...def });

  /* ---------------- errors ---------------- */
  function need(ctx) {
    if (!H().running()) ctx.throw({ message: `Hyper-V encountered an error trying to access an object on computer '${WS.sys.name}' because the object was not found. The object might have been deleted, or you might not have permission to perform the task. Verify that the Virtual Machine Management service on the computer is running.`, category: 'ObjectNotFound', target: '', exception: 'VirtualizationException', id: `ObjectNotFound,${cls(ctx.name)}` });
  }
  const fail = (ctx, r, target, terminating = false) => {
    const rec = { message: r.error, category: r.code === 'NotFound' || /NotFound$/.test(r.code || '') ? 'ObjectNotFound' : r.code === 'InvalidState' ? 'InvalidOperation' : r.code === 'NotEnoughMemory' ? 'NotSpecified' : 'InvalidArgument',
      target: target || '', exception: 'VirtualizationException', id: `${r.code === 'NotFound' ? 'InvalidParameter' : r.code === 'InvalidState' ? 'InvalidState' : 'OperationFailed'},${cls(ctx.name)}` };
    if (terminating) ctx.throw(rec); else ctx.error(rec);
  };
  const notFoundVm = (ctx, name) => ctx.error({ message: `Hyper-V was unable to find a virtual machine with name "${name}".`, category: 'InvalidArgument', target: name, exception: 'VirtualizationException', id: `InvalidParameter,${cls(ctx.name)}` });

  /* ---------------- objects ---------------- */
  const timespan = ms => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${ms ? '.' + String(ms % 1000).padStart(3, '0') + '0000' : ''}`; };
  const tag = (o, k, v) => { Object.defineProperty(o, k, { value: v }); return o; };
  function vmObj(v) {
    const i = H().info(v);
    return tag(psobj('Microsoft.HyperV.PowerShell.VirtualMachine', {
      Name: v.name, State: v.state, CpuUsage: i.cpu, MemoryAssigned: i.assignedMB * MB, MemoryDemand: i.demandMB * MB, MemoryStartup: v.memory.startup * MB, MemoryMinimum: v.memory.minimum * MB, MemoryMaximum: v.memory.maximum * MB,
      DynamicMemoryEnabled: v.memory.dynamic, Uptime: timespan(i.uptimeMs), Status: i.status, Version: v.version, Generation: v.generation, ProcessorCount: v.cpu.count,
      Id: v.id.toLowerCase(), VMId: v.id.toLowerCase(), VMName: v.name, Path: v.path, ConfigurationLocation: v.path, CheckpointType: v.checkpointType, AutomaticCheckpointsEnabled: v.automaticCheckpoints,
      AutomaticStartAction: v.autoStart, AutomaticStartDelay: v.autoStartDelay, AutomaticStopAction: v.autoStop, Notes: v.notes, Heartbeat: i.heartbeat === 'OK' ? 'OkApplicationsUnknown' : null,
      ParentSnapshotName: (v.checkpoints.find(c => c.id === v.current) || {}).name || null, ComputerName: WS.sys.name,
      NetworkAdapters: v.nics.map((n, k) => nicObj(v, n, k)), HardDrives: v.disks.map((d, k) => diskObj(v, d, k)), DVDDrives: v.dvds.map((d, k) => dvdObj(v, d, k))
    }, { str: `VirtualMachine (Name = '${v.name}') [Id = '${v.id.toLowerCase()}']` }), '__vmId', v.id);
  }
  view('Microsoft.HyperV.PowerShell.VirtualMachine', { table: { columns: [
    { label: 'Name', value: 'Name' }, { label: 'State', value: 'State' }, { label: 'CPUUsage(%)', value: 'CpuUsage', align: 'left' }, { label: 'MemoryAssigned(M)', value: o => Math.round(o.MemoryAssigned / MB), align: 'left' },
    { label: 'Uptime', value: o => String(o.Uptime).replace(/\..*$/, '') }, { label: 'Status', value: 'Status' }, { label: 'Version', value: 'Version' }] } });
  const switchObj = s => tag(psobj('Microsoft.HyperV.PowerShell.VMSwitch', {
    Name: s.name, SwitchType: s.type, NetAdapterInterfaceDescription: s.type === 'External' ? (WS.net.adapter(s.adapter) || {}).description || '' : '', AllowManagementOS: s.allowManagementOS, Notes: s.notes, Id: s.id, ComputerName: WS.sys.name
  }, { str: `VMSwitch (Name = '${s.name}') [Id = '${s.id}']` }), '__switch', s.name);
  view('Microsoft.HyperV.PowerShell.VMSwitch', { table: { columns: [{ label: 'Name', value: 'Name' }, { label: 'SwitchType', value: 'SwitchType' }, { label: 'NetAdapterInterfaceDescription', value: 'NetAdapterInterfaceDescription' }] } });
  const nicObj = (v, n, k) => tagged(v, n, k);
  const tagged = (v, n, k) => tag(tag(psobj('Microsoft.HyperV.PowerShell.VMNetworkAdapter', {
    Name: n.name, IsManagementOs: false, VMName: v.name, SwitchName: n.switch, MacAddress: n.mac, DynamicMacAddressEnabled: n.dynamicMac, Status: v.state === 'Running' ? '{Ok}' : '{}',
    IPAddresses: H().guestIps(v, k), Connected: !!n.switch, VlanSetting: n.vlan ? `Access ${n.vlan}` : 'Untagged', VMId: v.id.toLowerCase()
  }, { str: `VMNetworkAdapter (Name = '${n.name}', VMName = '${v.name}') [VMId = '${v.id.toLowerCase()}']` }), '__vmId', v.id), '__nic', k);
  view('Microsoft.HyperV.PowerShell.VMNetworkAdapter', { table: { columns: [{ label: 'Name', value: 'Name' }, { label: 'IsManagementOs', value: 'IsManagementOs' }, { label: 'VMName', value: 'VMName' }, { label: 'SwitchName', value: 'SwitchName' },
    { label: 'MacAddress', value: 'MacAddress' }, { label: 'Status', value: 'Status' }, { label: 'IPAddresses', value: o => `{${o.IPAddresses.join(', ')}}` }] } });
  const diskObj = (v, d, k) => tag(tag(psobj('Microsoft.HyperV.PowerShell.HardDiskDrive', { VMName: v.name, ControllerType: d.controller, ControllerNumber: d.number, ControllerLocation: d.location, DiskNumber: null, Path: d.path, Name: 'Hard Drive' }, { str: 'HardDiskDrive' }), '__vmId', v.id), '__disk', k);
  view('Microsoft.HyperV.PowerShell.HardDiskDrive', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'ControllerType', value: 'ControllerType' }, { label: 'ControllerNumber', value: 'ControllerNumber', align: 'left' }, { label: 'ControllerLocation', value: 'ControllerLocation', align: 'left' }, { label: 'DiskNumber', value: 'DiskNumber' }, { label: 'Path', value: 'Path' }] } });
  const dvdObj = (v, d, k) => tag(tag(psobj('Microsoft.HyperV.PowerShell.DvdDrive', { VMName: v.name, ControllerType: d.controller, ControllerNumber: d.number, ControllerLocation: d.location, DvdMediaType: d.path ? 'ISO' : 'None', Path: d.path, Name: 'DVD Drive' }, { str: 'DvdDrive' }), '__vmId', v.id), '__dvd', k);
  view('Microsoft.HyperV.PowerShell.DvdDrive', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'ControllerType', value: 'ControllerType' }, { label: 'ControllerNumber', value: 'ControllerNumber', align: 'left' }, { label: 'ControllerLocation', value: 'ControllerLocation', align: 'left' }, { label: 'DvdMediaType', value: 'DvdMediaType' }, { label: 'Path', value: 'Path' }] } });
  function vhdObj(x) {
    const attached = H().attachedTo(x.path).length > 0;
    return psobj('Microsoft.Vhd.PowerShell.VirtualHardDisk', {
      ComputerName: WS.sys.name, Path: x.path, VhdFormat: x.format, VhdType: x.type, FileSize: Math.round(H().vhdFileSize(x)), Size: x.size, MinimumSize: x.os ? Math.round(x.size * 0.27) : null, LogicalSectorSize: 512,
      PhysicalSectorSize: x.format === 'VHDX' ? 4096 : 512, BlockSize: x.type === 'Fixed' ? 0 : x.blockSize, ParentPath: x.parent || '', DiskIdentifier: x.id, FragmentationPercentage: 0, Alignment: 1, Attached: attached,
      DiskNumber: null, IsPMEMCompatible: false, AddressAbstractionType: 'None', Number: null
    }, { str: x.path });
  }
  view('Microsoft.Vhd.PowerShell.VirtualHardDisk', { list: ['ComputerName', 'Path', 'VhdFormat', 'VhdType', 'FileSize', 'Size', 'MinimumSize', 'LogicalSectorSize', 'PhysicalSectorSize', 'BlockSize', 'ParentPath', 'DiskIdentifier', 'FragmentationPercentage', 'Alignment', 'Attached', 'DiskNumber', 'IsPMEMCompatible', 'AddressAbstractionType', 'Number'] });
  const fmtCreated = iso => new Date(iso);
  const snapObj = (v, c) => tag(psobj('Microsoft.HyperV.PowerShell.VMSnapshot', {
    VMName: v.name, Name: c.name, SnapshotType: c.type, CreationTime: fmtCreated(c.created), ParentSnapshotName: (v.checkpoints.find(k => k.id === c.parent) || {}).name || null, Id: c.id, IsDeleted: false, State: c.snap.state
  }, { str: `VMSnapshot (Name = '${c.name}', VMName = '${v.name}') [Id = '${c.id}']` }), '__snap', [v.id, c.id]);
  view('Microsoft.HyperV.PowerShell.VMSnapshot', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'Name', value: 'Name' }, { label: 'SnapshotType', value: 'SnapshotType' }, { label: 'CreationTime', value: 'CreationTime' }, { label: 'ParentSnapshotName', value: 'ParentSnapshotName' }] } });

  /* ---------------- which VMs a call means: -Name (wildcards), -VM (objects), -VMName ---------------- */
  const VMP = { Name: { type: 'string[]', pos: 0, alias: ['VMName'], pipe: 'name' }, VM: { type: 'object[]', pipe: 'value' }, ComputerName: { type: 'string[]' } };
  function targets(ctx, p, o = {}) {
    if (p.VM) return [].concat(p.VM).map(x => H().vm(x && x.__vmId ? x.__vmId : toStr(x))).filter(Boolean);
    const names = p.Name || p.VMName ? [].concat(p.Name || p.VMName).map(toStr) : null;
    if (!names) { if (o.all) return H().vms(); ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: Name.', category: 'InvalidArgument', target: '', exception: 'ParameterBindingException', id: `MissingMandatoryParameter,${cls(ctx.name)}` }); }
    const out = [];
    for (const n of names) {
      const hit = H().vms().filter(v => (hasWild(n) ? wild(n, v.name) : lc(v.name) === lc(n) || lc(v.id) === lc(n)));
      if (!hit.length && !hasWild(n)) notFoundVm(ctx, n);
      out.push(...hit);
    }
    return [...new Set(out)];
  }

  /* ================================================================ VMs */
  hv({ name: 'Get-VM', synopsis: 'Gets the virtual machines from one or more Hyper-V hosts.', params: { ...VMP, Id: {} },
    process(ctx, p) { need(ctx); (p.Id ? [H().vm(toStr(p.Id))].filter(Boolean) : targets(ctx, p, { all: true })).forEach(v => ctx.out(vmObj(v))); } });
  hv({ name: 'New-VM', shouldProcess: true, synopsis: 'Creates a new virtual machine.',
    params: { Name: { pos: 0 }, MemoryStartupBytes: { type: 'long', pos: 1 }, BootDevice: { type: 'enum', values: ['Floppy', 'CD', 'IDE', 'LegacyNetworkAdapter', 'NetworkAdapter', 'VHD'] }, Generation: { type: 'int' },
      NewVHDPath: {}, NewVHDSizeBytes: { type: 'long' }, VHDPath: {}, NoVHD: { type: 'switch' }, Path: {}, SwitchName: {}, Version: {}, Force: { type: 'switch' }, Prerelease: { type: 'switch' } },
    async process(ctx, p) {
      need(ctx);
      if (p.NewVHDPath && !p.NewVHDSizeBytes) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters. NewVHDSizeBytes is required with NewVHDPath.', category: 'InvalidArgument', target: '', exception: 'ParameterBindingException', id: `AmbiguousParameterSet,${cls(ctx.name)}` });
      if (!(await ctx.confirm('New-VM', p.Name || 'New Virtual Machine'))) return;
      const nv = p.NewVHDPath ? { path: ctx.resolvePath(toStr(p.NewVHDPath)), sizeBytes: +p.NewVHDSizeBytes } : null;
      const r = H().newVM({ name: p.Name, generation: p.Generation || 1, memoryMB: p.MemoryStartupBytes ? Math.round(+p.MemoryStartupBytes / MB) : 1024, path: p.Path ? ctx.resolvePath(toStr(p.Path)) : null,
        switch: p.SwitchName, newVhd: nv, vhdPath: p.VHDPath ? ctx.resolvePath(toStr(p.VHDPath)) : null, bootDevice: p.BootDevice });
      if (!r.ok) return fail(ctx, r, p.Name, true);
      ctx.out(vmObj(r.vm));
    } });
  hv({ name: 'Remove-VM', shouldProcess: true, impact: 'High', synopsis: 'Deletes a virtual machine.', params: { ...VMP, Force: { type: 'switch' } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, p)) {
        if (!p.Force && !(await ctx.confirm('Remove-VM', v.name, { impact: 'High', query: `Are you sure you want to perform this action?\nRemove-VM will remove virtual machine "${v.name}".` }))) continue;
        const r = H().removeVM(v.id); if (!r.ok) fail(ctx, r, v.name);
      }
    } });
  hv({ name: 'Rename-VM', shouldProcess: true, params: { ...VMP, NewName: { pos: 1, mandatory: true }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) { need(ctx); for (const v of targets(ctx, p)) { const r = H().renameVM(v.id, p.NewName); if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(vmObj(v)); } } });
  const power = (name, syn, fn, extra = {}) => hv({ name, shouldProcess: true, synopsis: syn, params: { ...VMP, Passthru: { type: 'switch', alias: ['PassThru'] }, AsJob: { type: 'switch' }, ...extra },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, p)) {
        const r = await fn(ctx, p, v);
        if (r && !r.ok) { fail(ctx, r, v.name); continue; }
        if (p.Passthru) ctx.out(vmObj(v));
      }
    } });
  power('Start-VM', 'Starts a virtual machine.', async (ctx, p, v) => { ctx.progress({ activity: 'Start-VM', status: `Starting virtual machine '${v.name}'`, percent: 50 }); await ctx.sleep(300); return H().start(v.id); });
  power('Stop-VM', 'Shuts down, turns off, or saves a virtual machine.', async (ctx, p, v) => {
    if (p.Save) return H().save(v.id);
    if (p.TurnOff) return H().stop(v.id, { turnOff: true });
    if (v.state === 'Running' && !H().guestUp(v)) {
      if (!p.Force) return { ok: false, code: 'NoShutdown', error: `The virtual machine '${v.name}' is not in a state where it can be shut down. The operating system is not running or the Shutdown integration service is not available. Use -TurnOff to turn it off.` };
      return H().stop(v.id, { turnOff: true });
    }
    const r = H().stop(v.id);
    if (r.ok && r.pending) { for (let i = 0; i < 80 && H().vm(v.id) && H().vm(v.id).state !== 'Off'; i++) await ctx.sleep(100); }
    return r;
  }, { Force: { type: 'switch' }, TurnOff: { type: 'switch' }, Save: { type: 'switch' } });
  power('Save-VM', 'Saves a virtual machine.', (ctx, p, v) => H().save(v.id));
  power('Suspend-VM', 'Suspends, or pauses, a virtual machine.', (ctx, p, v) => H().pause(v.id));
  power('Resume-VM', 'Resumes a suspended (paused) virtual machine.', (ctx, p, v) => H().resume(v.id));
  power('Restart-VM', 'Restarts a virtual machine.', async (ctx, p, v) => {
    if (!p.Force && !(await ctx.confirm('Restart-VM', v.name, { impact: 'High', query: `Are you sure you want to perform this action?\nRestart-VM will restart virtual machine "${v.name}".` }))) return { ok: true };
    return H().reset(v.id);
  }, { Force: { type: 'switch' }, Type: {} });
  hv({ name: 'Set-VM', shouldProcess: true, synopsis: 'Configures a virtual machine.',
    params: { ...VMP, ProcessorCount: { type: 'long' }, MemoryStartupBytes: { type: 'long' }, MemoryMinimumBytes: { type: 'long' }, MemoryMaximumBytes: { type: 'long' }, DynamicMemory: { type: 'switch' }, StaticMemory: { type: 'switch' },
      AutomaticStartAction: { type: 'enum', values: ['Nothing', 'StartIfRunning', 'Start'] }, AutomaticStartDelay: { type: 'int' }, AutomaticStopAction: { type: 'enum', values: ['TurnOff', 'Save', 'ShutDown'] },
      CheckpointType: { type: 'enum', values: ['Disabled', 'Production', 'ProductionOnly', 'Standard'] }, AutomaticCheckpointsEnabled: { type: 'bool' }, Notes: {}, NewVMName: {}, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, p)) {
        const o = {};
        const mem = {};
        if (p.DynamicMemory) mem.dynamic = true; if (p.StaticMemory) mem.dynamic = false;
        for (const [k, f] of [['MemoryStartupBytes', 'startup'], ['MemoryMinimumBytes', 'minimum'], ['MemoryMaximumBytes', 'maximum']]) if (p[k] != null) mem[f] = Math.round(+p[k] / MB);
        if (Object.keys(mem).length) o.memory = mem;
        if (p.ProcessorCount != null) o.cpu = +p.ProcessorCount;
        for (const [k, f] of [['AutomaticStartAction', 'autoStart'], ['AutomaticStartDelay', 'autoStartDelay'], ['AutomaticStopAction', 'autoStop'], ['CheckpointType', 'checkpointType'], ['Notes', 'notes'], ['NewVMName', 'name']]) if (p[k] != null) o[f] = p[k];
        if (p.AutomaticCheckpointsEnabled != null) o.automaticCheckpoints = !!p.AutomaticCheckpointsEnabled;
        const r = H().setVM(v.id, o);
        if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(vmObj(v));
      }
    } });
  hv({ name: 'Set-VMMemory', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM, DynamicMemoryEnabled: { type: 'bool' }, StartupBytes: { type: 'long' }, MinimumBytes: { type: 'long' }, MaximumBytes: { type: 'long' }, Buffer: { type: 'int' } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) {
        const m = {};
        if (p.DynamicMemoryEnabled != null) m.dynamic = !!p.DynamicMemoryEnabled;
        if (p.StartupBytes != null) m.startup = Math.round(+p.StartupBytes / MB);
        if (p.MinimumBytes != null) m.minimum = Math.round(+p.MinimumBytes / MB);
        if (p.MaximumBytes != null) m.maximum = Math.round(+p.MaximumBytes / MB);
        if (p.Buffer != null) m.buffer = +p.Buffer;
        const r = H().setVM(v.id, { memory: m }); if (!r.ok) fail(ctx, r, v.name);
      }
    } });
  view('Microsoft.HyperV.PowerShell.VMMemory', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'DynamicMemoryEnabled', value: 'DynamicMemoryEnabled' }, { label: 'Minimum(M)', value: 'Minimum', align: 'left' }, { label: 'Startup(M)', value: 'Startup', align: 'left' }, { label: 'Maximum(M)', value: 'Maximum', align: 'left' }] } });
  hv({ name: 'Get-VMMemory', params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM },
    process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) ctx.out(psobj('Microsoft.HyperV.PowerShell.VMMemory', { VMName: v.name, DynamicMemoryEnabled: v.memory.dynamic, Minimum: v.memory.minimum, Startup: v.memory.startup, Maximum: v.memory.maximum, Buffer: v.memory.buffer })); } });
  hv({ name: 'Set-VMProcessor', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM, Count: { type: 'long' }, ExposeVirtualizationExtensions: { type: 'bool' } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) {
        const r = H().setVM(v.id, { ...(p.Count != null ? { cpu: +p.Count } : {}), ...(p.ExposeVirtualizationExtensions != null ? { nested: !!p.ExposeVirtualizationExtensions } : {}) });
        if (!r.ok) fail(ctx, r, v.name);
      }
    } });
  view('Microsoft.HyperV.PowerShell.VMProcessor', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'Count', value: 'Count', align: 'left' }, { label: 'CompatibilityForMigrationEnabled', value: 'CompatibilityForMigrationEnabled' }, { label: 'CompatibilityForOlderOperatingSystemsEnabled', value: 'CompatibilityForOlderOperatingSystemsEnabled' }] } });
  hv({ name: 'Get-VMProcessor', params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM },
    process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) ctx.out(psobj('Microsoft.HyperV.PowerShell.VMProcessor', { VMName: v.name, Count: v.cpu.count, CompatibilityForMigrationEnabled: false, CompatibilityForOlderOperatingSystemsEnabled: false, ExposeVirtualizationExtensions: v.cpu.nested })); } });

  /* ---------------- firmware, security, integration services ---------------- */
  const bootEntryObj = (v, e) => {
    const [k, i] = e.split(':');
    const d = k === 'disk' ? v.disks[+i] : k === 'dvd' ? v.dvds[+i] : v.nics[+i];
    const desc = k === 'disk' ? 'HardDiskDrive' : k === 'dvd' ? 'DvdDrive' : 'VMNetworkAdapter';
    return tag(psobj('Microsoft.HyperV.PowerShell.VMBootSource', { BootType: k === 'net' ? 'Network' : 'Drive', Description: k === 'net' ? `EFI Network (${d ? d.mac : ''})` : `EFI ${k === 'disk' ? 'SCSI Device' : 'SCSI Device'}`, Device: desc, FirmwarePath: '' }, { str: desc }), '__entry', e);
  };
  view('Microsoft.HyperV.PowerShell.VMFirmware', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'SecureBoot', value: 'SecureBoot' }, { label: 'PreferredNetworkBootProtocol', value: () => 'IPv4' }, { label: 'BootOrder', value: o => `{${o.BootOrder.map(b => b.Device).join(', ')}}` }] } });
  hv({ name: 'Get-VMFirmware', params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM },
    process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) {
        if (v.generation !== 2) { ctx.error({ message: `The operation cannot be performed because the virtual machine '${v.name}' is not a generation 2 virtual machine.`, category: 'InvalidOperation', target: v.name, exception: 'VirtualizationException', id: `InvalidOperation,${cls(ctx.name)}` }); continue; }
        ctx.out(psobj('Microsoft.HyperV.PowerShell.VMFirmware', { VMName: v.name, SecureBoot: v.firmware.secureBoot ? 'On' : 'Off', SecureBootTemplate: v.firmware.template, BootOrder: v.firmware.bootOrder.map(e => bootEntryObj(v, e)) }));
      }
    } });
  hv({ name: 'Set-VMFirmware', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM, EnableSecureBoot: { type: 'enum', values: ['On', 'Off'] }, SecureBootTemplate: { values: ['MicrosoftWindows', 'MicrosoftUEFICertificateAuthority', 'OpenSourceShieldedVM'] }, FirstBootDevice: { type: 'object' }, BootOrder: { type: 'object[]' } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) {
        const o = {};
        if (p.EnableSecureBoot) o.secureBoot = p.EnableSecureBoot === 'On';
        if (p.SecureBootTemplate) o.template = toStr(p.SecureBootTemplate);
        const entryOf = x => (x && x.__entry) || (x && x.__disk != null ? 'disk:' + x.__disk : x && x.__dvd != null ? 'dvd:' + x.__dvd : x && x.__nic != null ? 'net:' + x.__nic : null);
        if (p.FirstBootDevice) { const e = entryOf(p.FirstBootDevice); if (e) o.bootOrder = [e, ...v.firmware.bootOrder.filter(x => x !== e)]; }
        if (p.BootOrder) o.bootOrder = [].concat(p.BootOrder).map(entryOf).filter(Boolean);
        const r = H().setVM(v.id, o); if (!r.ok) fail(ctx, r, v.name);
      }
    } });
  hv({ name: 'Set-VMKeyProtector', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM, NewLocalKeyProtector: { type: 'switch' } },
    process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) v.keyProtector = true; WS.store.changed('hyperv'); } });
  for (const [n, on] of [['Enable-VMTPM', true], ['Disable-VMTPM', false]]) hv({ name: n, shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0, alias: ['Name'] }, VM: VMP.VM },
    process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) {
        if (on && !v.keyProtector) { ctx.error({ message: `Failed to add device 'Microsoft Virtual TPM'.\nThe key protector for the virtual machine '${v.name}' could not be unwrapped. Use Set-VMKeyProtector first. (0x80070057).`, category: 'InvalidOperation', target: v.name, exception: 'VirtualizationException', id: `InvalidOperation,${cls(ctx.name)}` }); continue; }
        const r = H().setVM(v.id, { tpm: on }); if (!r.ok) fail(ctx, r, v.name);
      }
    } });
  view('Microsoft.HyperV.PowerShell.VMIntegrationComponent', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'Name', value: 'Name' }, { label: 'Enabled', value: 'Enabled' }, { label: 'PrimaryStatusDescription', value: 'PrimaryStatusDescription' }, { label: 'SecondaryStatusDescription', value: 'SecondaryStatusDescription' }] } });
  hv({ name: 'Get-VMIntegrationService', params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, Name: { type: 'string[]' } },
    process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) for (const n of H().INTEGRATION) {
        if (p.Name && !p.Name.some(x => wild(toStr(x), n))) continue;
        const up = v.integration[n] && H().guestUp(v);
        ctx.out(psobj('Microsoft.HyperV.PowerShell.VMIntegrationComponent', { VMName: v.name, Name: n, Enabled: v.integration[n], PrimaryStatusDescription: v.state !== 'Running' || !v.integration[n] ? null : up ? 'OK' : 'No Contact', SecondaryStatusDescription: null }));
      }
    } });
  for (const [n, on] of [['Enable-VMIntegrationService', true], ['Disable-VMIntegrationService', false]]) hv({ name: n, shouldProcess: true, params: { Name: { type: 'string[]', pos: 0, mandatory: true }, VMName: { type: 'string[]', pos: 1 }, VM: VMP.VM },
    process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) for (const s of p.Name) {
        const hit = H().INTEGRATION.filter(x => wild(toStr(s), x) || lc(x) === lc(s) || (lc(s) === 'guest service interface' && x === 'Guest Service Interface'));
        if (!hit.length) { ctx.error({ message: `Hyper-V was unable to find an integration service with name "${s}".`, category: 'InvalidArgument', target: s, exception: 'VirtualizationException', id: `InvalidParameter,${cls(ctx.name)}` }); continue; }
        H().setVM(v.id, { integration: Object.fromEntries(hit.map(x => [x, on])) });
      }
    } });

  /* ---------------- disks and DVD ---------------- */
  const vmNameParams = { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM };
  hv({ name: 'Get-VMHardDiskDrive', params: { ...vmNameParams, ControllerType: {}, ControllerNumber: { type: 'int' }, ControllerLocation: { type: 'int' } },
    process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) v.disks.forEach((d, k) => { if ((!p.ControllerType || lc(p.ControllerType) === lc(d.controller)) && (p.ControllerLocation == null || d.location === p.ControllerLocation)) ctx.out(diskObj(v, d, k)); }); } });
  hv({ name: 'Add-VMHardDiskDrive', shouldProcess: true, params: { ...vmNameParams, Path: { pos: 1 }, ControllerType: { pos: 2 }, ControllerNumber: { type: 'int' }, ControllerLocation: { type: 'int' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) {
        const r = H().addDisk(v.id, { path: p.Path ? ctx.resolvePath(toStr(p.Path)) : null, controller: p.ControllerType ? toStr(p.ControllerType).toUpperCase() === 'IDE' ? 'IDE' : 'SCSI' : null, number: p.ControllerNumber, location: p.ControllerLocation });
        if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(diskObj(v, r.disk, v.disks.indexOf(r.disk)));
      }
    } });
  hv({ name: 'Remove-VMHardDiskDrive', shouldProcess: true, params: { VMHardDiskDrive: { type: 'object[]', pipe: 'value', pos: 0 }, VMName: {}, ControllerType: {}, ControllerNumber: { type: 'int' }, ControllerLocation: { type: 'int' } },
    async process(ctx, p) {
      need(ctx);
      const items = p.VMHardDiskDrive ? [].concat(p.VMHardDiskDrive).map(x => [x.__vmId, x.__disk]) : (() => { const v = H().vm(p.VMName); return v ? v.disks.map((d, k) => [v.id, k, d]).filter(([, , d]) => (!p.ControllerType || lc(d.controller) === lc(p.ControllerType)) && (p.ControllerLocation == null || d.location === p.ControllerLocation)) : []; })();
      for (const [id, k] of items.sort((a, b) => b[1] - a[1])) { const r = H().removeDisk(id, k); if (!r.ok) fail(ctx, r, ''); }
    } });
  hv({ name: 'Get-VMDvdDrive', params: vmNameParams,
    process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) v.dvds.forEach((d, k) => ctx.out(dvdObj(v, d, k))); } });
  hv({ name: 'Add-VMDvdDrive', shouldProcess: true, params: { ...vmNameParams, Path: { pos: 1 }, ControllerNumber: { type: 'int' }, ControllerLocation: { type: 'int' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) { const r = H().addDvd(v.id, p.Path ? ctx.resolvePath(toStr(p.Path)) : null); if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(dvdObj(v, v.dvds[v.dvds.length - 1], v.dvds.length - 1)); } } });
  hv({ name: 'Set-VMDvdDrive', shouldProcess: true, params: { ...vmNameParams, Path: { pos: 1 }, VMDvdDrive: { type: 'object[]', pipe: 'value' }, ControllerNumber: { type: 'int' }, ControllerLocation: { type: 'int' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      need(ctx);
      const items = p.VMDvdDrive ? [].concat(p.VMDvdDrive).map(x => [H().vm(x.__vmId), x.__dvd]) : targets(ctx, { VM: p.VM, Name: p.VMName }).map(v => [v, p.ControllerLocation != null ? v.dvds.findIndex(d => d.location === p.ControllerLocation) : 0]);
      for (const [v, k] of items) {
        if (!v) continue;
        const path = p.Path == null || toStr(p.Path) === '' ? null : ctx.resolvePath(toStr(p.Path));
        const r = v.dvds[k] ? H().setDvd(v.id, path, k) : { ok: false, code: 'NotFound', error: `Hyper-V was unable to find a DVD drive on virtual machine '${v.name}'. Use Add-VMDvdDrive.` };
        if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(dvdObj(v, v.dvds[k], k));
      }
    } });
  hv({ name: 'Remove-VMDvdDrive', shouldProcess: true, params: { VMDvdDrive: { type: 'object[]', pipe: 'value', pos: 0 }, VMName: {}, ControllerNumber: { type: 'int' }, ControllerLocation: { type: 'int' } },
    async process(ctx, p) {
      need(ctx);
      const items = p.VMDvdDrive ? [].concat(p.VMDvdDrive).map(x => [x.__vmId, x.__dvd]) : (() => { const v = H().vm(p.VMName); return v ? v.dvds.map((d, k) => [v.id, k, d]).filter(([, , d]) => p.ControllerLocation == null || d.location === p.ControllerLocation) : []; })();
      for (const [id, k] of items.sort((a, b) => b[1] - a[1])) { const r = H().removeDvd(id, k); if (!r.ok) fail(ctx, r, ''); }
    } });

  /* ---------------- virtual hard disks ---------------- */
  hv({ name: 'New-VHD', shouldProcess: true, synopsis: 'Creates one or more new virtual hard disks.',
    params: { Path: { type: 'string[]', pos: 0, mandatory: true }, SizeBytes: { type: 'long', pos: 1 }, Dynamic: { type: 'switch' }, Fixed: { type: 'switch' }, Differencing: { type: 'switch' }, ParentPath: {}, BlockSizeBytes: { type: 'long' }, LogicalSectorSizeBytes: { type: 'int' }, PhysicalSectorSizeBytes: { type: 'int' } },
    async process(ctx, p) {
      need(ctx);
      for (const raw of p.Path) {
        const path = ctx.resolvePath(toStr(raw));
        if (!p.ParentPath && !p.SizeBytes) ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: SizeBytes.', category: 'InvalidArgument', target: '', exception: 'ParameterBindingException', id: `MissingMandatoryParameter,${cls(ctx.name)}` });
        if (!(await ctx.confirm('New-VHD', path))) continue;
        if (p.Fixed) { ctx.progress({ activity: 'Creating the virtual hard disk', status: path, percent: 60 }); await ctx.sleep(400); }
        const r = H().newVhd({ path, sizeBytes: p.SizeBytes, type: p.ParentPath || p.Differencing ? 'Differencing' : p.Fixed ? 'Fixed' : 'Dynamic', parent: p.ParentPath ? ctx.resolvePath(toStr(p.ParentPath)) : null, blockSize: p.BlockSizeBytes });
        if (!r.ok) { fail(ctx, r, path); continue; }
        ctx.out(vhdObj(r.vhd));
      }
    } });
  hv({ name: 'Get-VHD', synopsis: 'Gets the virtual hard disk object associated with a virtual hard disk.', params: { Path: { type: 'string[]', pos: 0, pipe: 'name' }, VMId: {} },
    process(ctx, p) {
      need(ctx);
      for (const raw of p.Path || []) {
        const path = ctx.resolvePath(toStr(raw));
        let x = H().vhd(path);
        if (!x && WS.fs.exists(path) && /\.a?vhdx?$/i.test(path)) x = { path: WS.fs.full(path), format: /x$/i.test(path) ? 'VHDX' : 'VHD', type: 'Dynamic', size: 127 * GB, parent: null, os: null, blockSize: 32 * MB, id: '00000000-0000-0000-0000-000000000000' };
        if (!x || !WS.fs.exists(path)) { ctx.error({ message: `Getting the mounted storage instance for the path '${path}' failed.\nThe system cannot find the file specified.`, category: 'ObjectNotFound', target: path, exception: 'VirtualizationException', id: `ObjectNotFound,${cls(ctx.name)}` }); continue; }
        ctx.out(vhdObj(x));
      }
    } });
  hv({ name: 'Resize-VHD', shouldProcess: true, params: { Path: { type: 'string[]', pos: 0, mandatory: true }, SizeBytes: { type: 'long', pos: 1 }, ToMinimumSize: { type: 'switch' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) { need(ctx); for (const raw of p.Path) { const path = ctx.resolvePath(toStr(raw)); const x = H().vhd(path); const r = H().resizeVhd(path, p.ToMinimumSize && x ? Math.ceil(x.size * 0.9) : p.SizeBytes); if (!r.ok) fail(ctx, r, path); else if (p.Passthru) ctx.out(vhdObj(r.vhd)); } } });

  /* ---------------- switches and network adapters ---------------- */
  hv({ name: 'Get-VMSwitch', synopsis: 'Gets virtual switches from one or more virtual Hyper-V hosts.', params: { Name: { type: 'string[]', pos: 0, alias: ['SwitchName'] }, SwitchType: { type: 'enum', values: ['Internal', 'Private', 'External'] } },
    process(ctx, p) {
      need(ctx);
      const list = H().switches().filter(s => (!p.Name || p.Name.some(n => wild(toStr(n), s.name))) && (!p.SwitchType || s.type === p.SwitchType));
      if (p.Name && !list.length && !p.Name.some(n => hasWild(toStr(n)))) return ctx.error({ message: `Hyper-V was unable to find a virtual switch with name "${p.Name[0]}".`, category: 'InvalidArgument', target: p.Name[0], exception: 'VirtualizationException', id: `InvalidParameter,${cls(ctx.name)}` });
      list.forEach(s => ctx.out(switchObj(s)));
    } });
  hv({ name: 'New-VMSwitch', shouldProcess: true, synopsis: 'Creates a new virtual switch on one or more virtual machine hosts.',
    params: { Name: { pos: 0, mandatory: true, alias: ['SwitchName'] }, SwitchType: { type: 'enum', values: ['Internal', 'Private'] }, NetAdapterName: {}, NetAdapterInterfaceDescription: { alias: ['InterfaceDescription'] }, AllowManagementOS: { type: 'bool' }, Notes: {}, EnableEmbeddedTeaming: { type: 'bool' } },
    async process(ctx, p) {
      need(ctx);
      if ((p.NetAdapterName || p.NetAdapterInterfaceDescription) && p.SwitchType) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', target: '', exception: 'ParameterBindingException', id: `AmbiguousParameterSet,${cls(ctx.name)}` });
      if (!p.NetAdapterName && !p.NetAdapterInterfaceDescription && !p.SwitchType) ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: SwitchType.', category: 'InvalidArgument', target: '', exception: 'ParameterBindingException', id: `MissingMandatoryParameter,${cls(ctx.name)}` });
      const adapter = p.NetAdapterName ? toStr(p.NetAdapterName) : p.NetAdapterInterfaceDescription ? (WS.net.adapters().find(a => lc(a.description) === lc(p.NetAdapterInterfaceDescription)) || { name: toStr(p.NetAdapterInterfaceDescription) }).name : null;
      if (!(await ctx.confirm('New-VMSwitch', p.Name))) return;
      if (adapter) { ctx.progress({ activity: 'New-VMSwitch', status: 'Creating the external virtual switch', percent: 50 }); await ctx.sleep(600); }
      const r = H().newSwitch({ name: p.Name, type: adapter ? 'External' : p.SwitchType, adapter, allowManagementOS: p.AllowManagementOS == null ? true : !!p.AllowManagementOS, notes: p.Notes });
      if (!r.ok) return fail(ctx, r, p.Name, true);
      ctx.out(switchObj(r.switch));
    } });
  hv({ name: 'Remove-VMSwitch', shouldProcess: true, impact: 'High', params: { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      need(ctx);
      for (const n of p.Name) {
        const s = H().switch(toStr(n)); if (!s) { ctx.error({ message: `Hyper-V was unable to find a virtual switch with name "${n}".`, category: 'InvalidArgument', target: n, exception: 'VirtualizationException', id: `InvalidParameter,${cls(ctx.name)}` }); continue; }
        if (!p.Force && !(await ctx.confirm('Remove-VMSwitch', s.name, { impact: 'High', query: `Are you sure you want to perform this action?\nRemove-VMSwitch will remove the virtual switch "${s.name}".` }))) continue;
        H().removeSwitch(s.name);
      }
    } });
  hv({ name: 'Set-VMSwitch', shouldProcess: true, params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, SwitchType: { type: 'enum', values: ['Internal', 'Private'] }, NetAdapterName: {}, AllowManagementOS: { type: 'bool' }, Notes: {} },
    async process(ctx, p) {
      need(ctx);
      const r = H().setSwitch(toStr(p.Name), { ...(p.SwitchType ? { type: p.SwitchType } : {}), ...(p.NetAdapterName ? { adapter: toStr(p.NetAdapterName) } : {}), ...(p.AllowManagementOS != null ? { allowManagementOS: !!p.AllowManagementOS } : {}), ...(p.Notes != null ? { notes: p.Notes } : {}) });
      if (!r.ok) fail(ctx, r, p.Name, true);
    } });
  hv({ name: 'Rename-VMSwitch', shouldProcess: true, params: { Name: { pos: 0, mandatory: true }, NewName: { pos: 1, mandatory: true } },
    process(ctx, p) { need(ctx); const r = H().setSwitch(toStr(p.Name), { name: toStr(p.NewName) }); if (!r.ok) fail(ctx, r, p.Name, true); } });
  function nicsFor(ctx, p) {
    if (p.VMNetworkAdapter) return [].concat(p.VMNetworkAdapter).map(x => [H().vm(x.__vmId), x.__nic]).filter(([v]) => v);
    return targets(ctx, { VM: p.VM, Name: p.VMName }).flatMap(v => v.nics.map((n, k) => [v, k]).filter(([, k]) => !p.Name || lc(v.nics[k].name) === lc(p.Name) || wild(toStr(p.Name), v.nics[k].name)));
  }
  hv({ name: 'Get-VMNetworkAdapter', params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, Name: {}, All: { type: 'switch' }, ManagementOS: { type: 'switch' } },
    process(ctx, p) {
      need(ctx);
      if (p.ManagementOS || p.All) for (const s of H().switches().filter(s => s.allowManagementOS)) { const a = WS.net.adapter(H().vnicName(s.name)); if (a) ctx.out(psobj('Microsoft.HyperV.PowerShell.VMNetworkAdapter', { Name: s.name, IsManagementOs: true, VMName: '', SwitchName: s.name, MacAddress: a.mac.replace(/-/g, ''), Status: '{Ok}', IPAddresses: [a.ip].filter(Boolean) })); }
      if (p.ManagementOS) return;
      for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) v.nics.forEach((n, k) => { if (!p.Name || wild(toStr(p.Name), n.name)) ctx.out(tagged(v, n, k)); });
    } });
  hv({ name: 'Add-VMNetworkAdapter', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, SwitchName: {}, Name: {}, StaticMacAddress: {}, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName })) { const r = H().addNic(v.id, { switch: p.SwitchName, name: p.Name, mac: p.StaticMacAddress ? toStr(p.StaticMacAddress).replace(/[-:]/g, '').toUpperCase() : null }); if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(tagged(v, r.nic, v.nics.indexOf(r.nic))); } } });
  hv({ name: 'Remove-VMNetworkAdapter', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, Name: {}, VMNetworkAdapter: { type: 'object[]', pipe: 'value' } },
    async process(ctx, p) { need(ctx); for (const [v, k] of nicsFor(ctx, p).sort((a, b) => b[1] - a[1])) { const r = H().removeNic(v.id, k); if (!r.ok) fail(ctx, r, v.name); } } });
  hv({ name: 'Connect-VMNetworkAdapter', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, Name: {}, SwitchName: { mandatory: true }, VMNetworkAdapter: { type: 'object[]', pipe: 'value' } },
    async process(ctx, p) { need(ctx); for (const [v, k] of nicsFor(ctx, p)) { const r = H().connectNic(v.id, k, toStr(p.SwitchName)); if (!r.ok) fail(ctx, r, v.name); } } });
  hv({ name: 'Disconnect-VMNetworkAdapter', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, Name: {}, VMNetworkAdapter: { type: 'object[]', pipe: 'value' } },
    async process(ctx, p) { need(ctx); for (const [v, k] of nicsFor(ctx, p)) H().connectNic(v.id, k, null); } });
  hv({ name: 'Set-VMNetworkAdapter', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, Name: {}, StaticMacAddress: {}, DynamicMacAddress: { type: 'switch' }, VMNetworkAdapter: { type: 'object[]', pipe: 'value' } },
    async process(ctx, p) { need(ctx); for (const [v, k] of nicsFor(ctx, p)) { const r = H().setNic(v.id, k, { ...(p.StaticMacAddress ? { mac: toStr(p.StaticMacAddress) } : {}), ...(p.DynamicMacAddress ? { dynamicMac: true } : {}) }); if (!r.ok) fail(ctx, r, v.name); } } });
  hv({ name: 'Set-VMNetworkAdapterVlan', shouldProcess: true, params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM, VMNetworkAdapterName: {}, Access: { type: 'switch' }, Untagged: { type: 'switch' }, VlanId: { type: 'int' }, VMNetworkAdapter: { type: 'object[]', pipe: 'value' } },
    async process(ctx, p) { need(ctx); for (const [v, k] of nicsFor(ctx, { ...p, Name: p.VMNetworkAdapterName })) { const r = H().setNic(v.id, k, { vlan: p.Untagged ? null : p.VlanId }); if (!r.ok) fail(ctx, r, v.name); } } });
  view('Microsoft.HyperV.PowerShell.VMNetworkAdapterVlanSetting', { table: { columns: [{ label: 'VMName', value: 'VMName' }, { label: 'VMNetworkAdapterName', value: 'VMNetworkAdapterName' }, { label: 'Mode', value: 'Mode' }, { label: 'VlanList', value: 'VlanList' }] } });
  hv({ name: 'Get-VMNetworkAdapterVlan', params: { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM },
    process(ctx, p) { need(ctx); for (const v of targets(ctx, { VM: p.VM, Name: p.VMName }, { all: true })) v.nics.forEach(n => ctx.out(psobj('Microsoft.HyperV.PowerShell.VMNetworkAdapterVlanSetting', { VMName: v.name, VMNetworkAdapterName: n.name, Mode: n.vlan ? 'Access' : 'Untagged', VlanList: n.vlan || '' }))); } });

  /* ---------------- checkpoints ---------------- */
  const SNAP = { VMName: { type: 'string[]', pos: 0 }, VM: VMP.VM };
  for (const n of ['Checkpoint-VM']) hv({ name: n, shouldProcess: true, synopsis: 'Creates a checkpoint of a virtual machine.', params: { ...VMP, SnapshotName: { pos: 1, alias: ['CheckpointName'] }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, p)) {
        ctx.progress({ activity: 'Checkpoint-VM', status: `Creating checkpoint of '${v.name}'`, percent: 50 }); await ctx.sleep(300);
        const r = H().checkpoint(v.id, p.SnapshotName ? toStr(p.SnapshotName) : null);
        if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(snapObj(v, r.checkpoint));
      }
    } });
  const snapsFor = (ctx, p) => {
    if (p.VMSnapshot) return [].concat(p.VMSnapshot).map(x => x.__snap).filter(Boolean).map(([vid, cid]) => [H().vm(vid), H().findCheckpoint(vid, cid)]).filter(([v, c]) => v && c);
    return targets(ctx, { VM: p.VM, Name: p.VMName }, { all: !p.VMName }).flatMap(v => v.checkpoints.filter(c => !p.Name || wild(toStr(p.Name), c.name)).map(c => [v, c]));
  };
  for (const n of ['Get-VMSnapshot', 'Get-VMCheckpoint']) hv({ name: n, params: { ...SNAP, Name: { pos: 1 }, SnapshotType: {} },
    process(ctx, p) { need(ctx); for (const [v, c] of snapsFor(ctx, p)) if (!p.SnapshotType || lc(p.SnapshotType) === lc(c.type)) ctx.out(snapObj(v, c)); } });
  for (const n of ['Restore-VMSnapshot', 'Restore-VMCheckpoint']) hv({ name: n, shouldProcess: true, impact: 'High', params: { ...SNAP, Name: { pos: 1 }, VMSnapshot: { type: 'object[]', pipe: 'value' }, Confirm: { type: 'switch' } },
    async process(ctx, p) {
      need(ctx);
      const list = snapsFor(ctx, p);
      if (!list.length && p.Name) ctx.error({ message: `Hyper-V was unable to find a checkpoint with name "${p.Name}".`, category: 'InvalidArgument', target: p.Name, exception: 'VirtualizationException', id: `InvalidParameter,${cls(ctx.name)}` });
      for (const [v, c] of list) {
        if (!(await ctx.confirm(n, c.name, { impact: 'High', query: `Are you sure you want to perform this action?\n${n} will restore checkpoint "${c.name}".` }))) continue;
        const r = H().applyCheckpoint(v.id, c.id); if (!r.ok) fail(ctx, r, v.name);
      }
    } });
  for (const n of ['Remove-VMSnapshot', 'Remove-VMCheckpoint']) hv({ name: n, shouldProcess: true, params: { ...SNAP, Name: { pos: 1 }, VMSnapshot: { type: 'object[]', pipe: 'value' }, IncludeAllChildSnapshots: { type: 'switch' } },
    async process(ctx, p) { need(ctx); for (const [v, c] of snapsFor(ctx, p)) { if (!H().findCheckpoint(v.id, c.id)) continue; const r = H().removeCheckpoint(v.id, c.id, { subtree: p.IncludeAllChildSnapshots }); if (!r.ok) fail(ctx, r, v.name); } } });
  for (const n of ['Rename-VMSnapshot', 'Rename-VMCheckpoint']) hv({ name: n, shouldProcess: true, params: { ...SNAP, Name: { pos: 1 }, NewName: { mandatory: true }, VMSnapshot: { type: 'object[]', pipe: 'value' } },
    process(ctx, p) { need(ctx); for (const [v, c] of snapsFor(ctx, p)) H().renameCheckpoint(v.id, c.id, toStr(p.NewName)); } });
  hv({ name: 'Export-VM', shouldProcess: true, params: { ...VMP, Path: { pos: 1, mandatory: true }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      need(ctx);
      for (const v of targets(ctx, p)) {
        for (let i = 0; i <= 100; i += 25) { ctx.progress({ activity: 'Export-VM', status: `Exporting virtual machine '${v.name}'`, percent: i }); await ctx.sleep(120); }
        const r = H().exportVM(v.id, ctx.resolvePath(toStr(p.Path))); if (!r.ok) fail(ctx, r, v.name); else if (p.Passthru) ctx.out(vmObj(v));
      }
    } });

  /* ---------------- the host ---------------- */
  view('Microsoft.HyperV.PowerShell.VMHost', { list: ['ComputerName', 'LogicalProcessorCount', 'MemoryCapacity', 'VirtualHardDiskPath', 'VirtualMachinePath', 'MacAddressMinimum', 'MacAddressMaximum', 'NumaSpanningEnabled', 'EnableEnhancedSessionMode', 'FullyQualifiedDomainName'] });
  hv({ name: 'Get-VMHost', params: { ComputerName: { type: 'string[]' } },
    process(ctx) { need(ctx); const h = H().host(); ctx.out(psobj('Microsoft.HyperV.PowerShell.VMHost', { ComputerName: WS.sys.name, LogicalProcessorCount: WS.proc.NCPU, MemoryCapacity: 4294430720, VirtualHardDiskPath: h.vhdPath, VirtualMachinePath: h.vmPath,
      MacAddressMinimum: h.macMin, MacAddressMaximum: h.macMax, NumaSpanningEnabled: h.numaSpanning, EnableEnhancedSessionMode: h.enhancedSession, FullyQualifiedDomainName: WS.sys.fqdn() }, { str: WS.sys.name })); } });
  hv({ name: 'Set-VMHost', shouldProcess: true, params: { VirtualHardDiskPath: {}, VirtualMachinePath: {}, NumaSpanningEnabled: { type: 'bool' }, EnableEnhancedSessionMode: { type: 'bool' }, Passthru: { type: 'switch', alias: ['PassThru'] } },
    async process(ctx, p) {
      need(ctx);
      const r = H().setHost({ ...(p.VirtualHardDiskPath ? { vhdPath: ctx.resolvePath(toStr(p.VirtualHardDiskPath)) } : {}), ...(p.VirtualMachinePath ? { vmPath: ctx.resolvePath(toStr(p.VirtualMachinePath)) } : {}),
        ...(p.NumaSpanningEnabled != null ? { numaSpanning: !!p.NumaSpanningEnabled } : {}), ...(p.EnableEnhancedSessionMode != null ? { enhancedSession: !!p.EnableEnhancedSessionMode } : {}) });
      if (!r.ok) fail(ctx, r, '', true);
    } });

  /* ================================================================ vmconnect.exe */
  WS.term.defineNative('vmconnect', (argv, io) => {
    const args = argv.filter(a => !/^-/.test(a));
    if (!args.length || argv.some(a => /^[/-]\?$/.test(a))) { io.launch('virtmgmt', 'Hyper-V Manager'); return 0; }
    const name = args[1] || args[0];
    const v = H() && H().vm(name);
    if (!v) { WS.ui.msgbox({ title: 'Virtual Machine Connection', icon: 'error', message: `The virtual machine '${name}' could not be found on server '${args[0]}'.` }); return 1; }
    WS.apps.launch('vmconnect', { vm: v.id });
    return 0;
  }, { feature: 'Hyper-V-Tools' });
})();
