/* Hyper-V: the model (switches and the host's adapters, VMs, disks, boot, Setup, the guest on the LAN, checkpoints,
 * automatic start/stop), the Hyper-V PowerShell module and vmconnect, Hyper-V Manager and Virtual Machine Connection.
 * Use a fresh profile. &shot=rolewizard|manager|newvm|nvmem|nvnet|nvdisk|nvinstall|settings|switches|external|vmc-off|vmc-presskey|vmc-bootfail|vmc-setup|vmc-installing|vmc-oobe|vmc-desktop|checkpoints|ps */
(async function () {
  'use strict';
  const WS = window.WS, H = () => WS.hv;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 4000) => { for (let i = 0; i < ms / 40; i++) { if (fn()) return true; await wait(40); } return !!fn(); };
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const title = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
  const button = (label, scope = shade()) => scope && [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label + ' in ' + ((scope || shade() || {}).textContent || '').slice(0, 300)); b.click(); await wait(80); };
  const shotMode = new URLSearchParams(location.search).get('shot');
  const shot = name => { if (shotMode !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async c => { const io = ps.console; io.clear(); await ps.execute(c); return io.buf; };
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.buf; };
  const GB = 1024 ** 3;
  try {
    await wait(300);
    H().timeScale = 0.05;
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.net.setDnsServers('Ethernet', ['192.168.1.1']);
    H().writeIso('C:\\ISO\\WindowsServer2025.iso');

    /* ---------------- install ---------------- */
    t('Hyper-V is not installed: no module, no state', WS.state.hyperv === null && /is not recognized/.test(await run('Get-VM')));
    // the Add Roles and Features Wizard's Hyper-V pages
    let rw, rx;
    WS.sm.addRoles({ onCreate: (wz, api) => { rw = wz; rx = api; } }); await wait(80);
    rx.toggle('Hyper-V', true); await wait(60);
    if (/Add features that are required/.test(dlgText())) await click('Add Features');
    rw.goto('hv:switches'); await wait(40);
    t('the roles wizard has Hyper-V’s Create Virtual Switches page listing Ethernet', rw.page.id === 'hv:switches' && /One virtual switch will be created for each network adapter you select/.test(rw.el.textContent) && /Microsoft Hyper-V Network Adapter/.test(rw.el.textContent));
    rw.goto('hv:stores'); await wait(40);
    t('...and Migration and Default Stores', /Virtual Machine Migration/.test([...rw.el.querySelectorAll('.wz-step')].map(x => x.textContent).join('|')) || /Migration/.test(rw.el.textContent) && /Default location for virtual hard disk files/.test(rw.el.textContent));
    if (shot('rolewizard')) return;
    button('Cancel', rw.el).click(); await wait(40);
    H().setInstallOptions({ adapters: ['Ethernet'], vhdPath: 'C:\\VHDs', vmPath: 'C:\\VMs' }); // what the Add Roles and Features Wizard's Hyper-V pages pass on
    const inst = WS.features.install(['Hyper-V'], { includeManagementTools: true });
    t('installing Hyper-V needs a restart', inst.restartNeeded === 'Yes' && WS.features.installState('Hyper-V') === 'InstallPending' && WS.state.hyperv === null);
    WS.sys.onBoot(); await wait(150);
    t('after the restart Hyper-V and vmms are running', H().installed() && WS.svc.isRunning('vmms'));
    const wsw = H().switch('Microsoft Hyper-V Network Adapter - Virtual Switch');
    t('the wizard’s choices apply after the restart: a shared external switch per adapter and the default stores', wsw && wsw.type === 'External' && wsw.allowManagementOS && WS.net.adapter('vEthernet (Microsoft Hyper-V Network Adapter - Virtual Switch)').ip === '192.168.1.10' && H().host().vhdPath === 'C:\\VHDs' && H().host().vmPath === 'C:\\VMs' && WS.state.hvInstall === null);
    H().removeSwitch(wsw.name); H().setHost({ vhdPath: H().DEFAULT_VHD_PATH, vmPath: H().DEFAULT_VM_PATH });
    t('the Hyper-V module and tools came with it', WS.features.isInstalled('Hyper-V-PowerShell') && WS.features.isInstalled('Hyper-V-Tools') && !/is not recognized/.test(await run('Get-VM')));

    /* ---------------- switches and the host's adapters ---------------- */
    let r = H().newSwitch({ name: 'Internal', type: 'Internal' });
    const vint = WS.net.adapter('vEthernet (Internal)');
    t('an Internal switch adds a vEthernet adapter with an APIPA address', r.ok && vint && /^169\.254\./.test(vint.ip) && vint.description === 'Hyper-V Virtual Ethernet Adapter');
    t('...and the LAN still routes through Ethernet', WS.net.adapter().name === 'Ethernet' && WS.net.ping('192.168.1.1', 1).ok);
    r = H().newSwitch({ name: 'Private', type: 'Private' });
    t('a Private switch touches nothing on the host', r.ok && !WS.net.adapter('vEthernet (Private)'));
    r = H().newSwitch({ name: 'LAN', adapter: 'Ethernet', allowManagementOS: true });
    const vlan = WS.net.adapter('vEthernet (LAN)'), eth = WS.net.adapter('Ethernet');
    t('an External switch moves the IP settings to vEthernet (LAN)', r.ok && vlan && vlan.ip === '192.168.1.10' && !vlan.dhcp && vlan.gateway === '192.168.1.1' && WS.net.adapter() === vlan && eth.ip === null);
    t('...the physical adapter keeps only the Hyper-V Extensible Virtual Switch binding', WS.net.bound(eth, 'vms_pp') && !WS.net.bound(eth, 'ms_tcpip') && WS.net.bindings('Ethernet').some(b => b.id === 'vms_pp' && b.enabled));
    t('...ipconfig no longer lists Ethernet, and the network still works', !WS.net.ipconfig().adapters.some(a => a.name === 'Ethernet') && WS.net.ping('192.168.1.1', 1).ok && WS.net.ownIps().includes('192.168.1.10'));
    t('a second external switch on the same adapter is refused', !H().newSwitch({ name: 'LAN2', adapter: 'Ethernet' }).ok && H().newSwitch({ name: 'lan', type: 'Private' }).code === 'Exists');
    t('removing the External switch gives the settings back', H().removeSwitch('LAN').ok && !WS.net.adapter('vEthernet (LAN)') && WS.net.adapter('Ethernet').ip === '192.168.1.10' && WS.net.bound(WS.net.adapter('Ethernet'), 'ms_tcpip'));
    H().newSwitch({ name: 'LAN', adapter: 'Ethernet', allowManagementOS: true });

    /* ---------------- VMs, disks ---------------- */
    r = H().newVM({ name: 'SRV01', generation: 2, memoryMB: 4096, path: 'C:\\Hyper-V', switch: 'LAN', newVhd: { sizeBytes: 60 * GB }, iso: 'C:\\ISO\\WindowsServer2025.iso' });
    const v = r.vm;
    t('New VM: generation 2 in C:\\Hyper-V\\SRV01 with its disk, DVD first in the boot order', r.ok && v.path === 'C:\\Hyper-V\\SRV01' && WS.fs.exists(H().configFile(v) + '.vmcx') && v.disks[0].path === 'C:\\Hyper-V\\SRV01\\Virtual Hard Disks\\SRV01.vhdx' && v.firmware.bootOrder[0] === 'dvd:0' && v.firmware.secureBoot);
    const x = H().vhd(v.disks[0].path);
    t('the new VHDX is dynamic, 60 GB, 4 MB on disk', x.type === 'Dynamic' && x.size === 60 * GB && WS.fs.stat(x.path).size === 4 * 1024 * 1024);
    r = H().start('SRV01');
    t('4096 MB does not fit in the memory the host has left', !r.ok && r.code === 'NotEnoughMemory' && /Not enough memory in the system to start the virtual machine SRV01 with ram size 4096 megabytes/.test(r.error));
    t('memory can\u2019t be static-changed while... it is off, so it can', H().setVM('SRV01', { memory: { startup: 1024, dynamic: true, minimum: 512, maximum: 2048 } }).ok && v.memory.dynamic && v.memory.startup === 1024);
    t('dynamic memory checks minimum <= startup <= maximum', H().setVM('SRV01', { memory: { minimum: 2048 } }).code === 'InvalidMemory');
    r = H().start('SRV01');
    t('the VM starts and shows "Press any key to boot from CD or DVD..."', r.ok && v.state === 'Running' && await until(() => v.guest.phase === 'presskey'));
    t('changing processors while running is refused', H().setVM('SRV01', { cpu: 2 }).code === 'InvalidState');
    t('a running VM is a vmwp.exe as NT VIRTUAL MACHINE\\<GUID>', WS.proc.list().some(p => p.image === 'vmwp.exe' && WS.proc.qualifiedUser(p) === 'NT VIRTUAL MACHINE\\' + v.id.toUpperCase()));
    t('missing the key press falls through to the boot summary', await until(() => v.guest.phase === 'bootfail') && v.guest.tried.length === 3 && /SCSI DVD/.test(v.guest.tried[0][0]) && /boot image was not found/.test(v.guest.tried[2][1]));
    H().ctrlAltDel('SRV01');
    t('Ctrl+Alt+Delete restarts the boot and the key press starts Setup', await until(() => v.guest.phase === 'presskey') && H().pressKey('SRV01') && v.guest.phase === 'setup');
    t('Setup loads its first page', await until(() => v.guest.step === 'language'));
    for (const s of ['keyboard', 'option']) H().setupStep('SRV01', s);
    H().setupStep('SRV01', 'image', { edition: 'dc' });
    for (const s of ['license', 'disk', 'ready']) H().setupStep('SRV01', s);
    r = H().setupStep('SRV01', 'install');
    t('Install starts copying files', r.ok && v.guest.phase === 'installing');
    t('Setup finishes, restarts and boots to Customize settings', await until(() => v.guest.phase === 'oobe', 9000) && x.os && x.os.edition === 'Windows Server 2025 Datacenter Evaluation (Desktop Experience)' && /^WIN-[A-Z0-9]{11}$/.test(x.os.computerName));
    t('the boot order now starts at the disk', v.firmware.bootOrder[0] === 'disk:0');
    t('a weak guest password is refused', H().guestSetPassword('SRV01', 'abc').code === 'PasswordPolicy');
    t('the guest password and sign-in work', H().guestSetPassword('SRV01', 'P@ssw0rd!').ok && v.guest.phase === 'locked' && !H().guestSignIn('SRV01', 'nope').ok && H().guestSignIn('SRV01', 'P@ssw0rd!').ok && v.guest.phase === 'desktop');
    await wait(150);
    const peer = WS.state.network.peers.find(p => p.vmId === v.id);
    t('the guest is on the LAN with an address from the router\u2019s DHCP', peer && /^192\.168\.1\.1\d\d$/.test(peer.ip) && peer.name === x.os.computerName && H().guestIps(v, 0)[0] === peer.ip);
    t('its name resolves by LLMNR; its firewall drops ping, as a new Windows install does', WS.net.resolve(peer.name).ip === peer.ip && !WS.net.ping(peer.name, 1).ok);
    x.os.icmp = true; H().syncPeers(); await wait(100);
    t('with ping allowed in the guest, ping works', WS.net.ping(peer.name, 1).ok);

    /* ---------------- checkpoints, power ---------------- */
    r = H().checkpoint('SRV01', 'Clean install');
    t('a production checkpoint of the running guest', r.ok && r.checkpoint.type === 'Production' && r.checkpoint.snap.state === 'Off' && WS.fs.list('C:\\Hyper-V\\SRV01\\Virtual Hard Disks').some(f => /\.avhdx$/.test(f.name)));
    H().setVM('SRV01', { checkpointType: 'Standard' });
    const c2 = H().checkpoint('SRV01').checkpoint;
    t('a standard checkpoint gets the default name and keeps the running state', /^SRV01 - \(\d+\/\d+\/\d{4} - \d+:\d\d:\d\d [AP]M\)$/.test(c2.name) && c2.snap.state === 'Saved' && c2.parent === r.checkpoint.id);
    r = H().stop('SRV01');
    t('Shut Down asks the guest and turns it off', r.ok && r.pending && await until(() => v.state === 'Off') && !WS.state.network.peers.some(p => p.vmId === v.id));
    x.os.computerName = 'CHANGED';
    t('applying the production checkpoint restores the disk, Off', H().applyCheckpoint('SRV01', 'Clean install').ok && v.state === 'Off' && x.os.computerName !== 'CHANGED');
    t('applying the standard checkpoint leaves the VM Saved', H().applyCheckpoint('SRV01', c2.id).ok && v.state === 'Saved');
    t('starting from Saved resumes the guest at the desktop', H().start('SRV01').ok && v.guest.phase === 'desktop');
    t('Pause and Resume', H().pause('SRV01').ok && v.state === 'Paused' && H().resume('SRV01').ok && v.state === 'Running');
    t('Save writes the memory to the .VMRS file', H().save('SRV01').ok && v.state === 'Saved' && WS.fs.stat(H().configFile(v) + '.VMRS').size === 1024 * 1024 * 1024);
    t('deleting the first checkpoint merges it; the child moves up', H().removeCheckpoint('SRV01', 'Clean install').ok && v.checkpoints.length === 1 && v.checkpoints[0].parent === null);
    t('Turn Off from Saved discards the saved state', H().stop('SRV01', { turnOff: true }).ok && v.state === 'Off');
    t('a VM without an OS cannot be shut down, only turned off', (() => { const n = H().newVM({ name: 'EMPTY', generation: 1, memoryMB: 512 }).vm; H().start(n.id); const r2 = H().stop(n.id); const ok = !r2.ok && r2.code === 'NoShutdown' && H().stop(n.id, { turnOff: true }).ok; H().removeVM(n.id); return ok; })());

    /* ---------------- automatic start and stop with the host ---------------- */
    H().setVM('SRV01', { autoStop: 'ShutDown', autoStart: 'Start' });
    H().start('SRV01'); await until(() => v.guest.phase === 'desktop' || v.guest.phase === 'locked' || v.guest.phase === 'booting');
    WS.sys.onShutdown(true); WS.sys.onBoot(); if (!WS.proc.sessionActive()) WS.proc.onLogon(); // the shell signs in again after a real restart
    t('host restart: Automatic Stop Action shut it down, Automatic Start Action started it again', await until(() => v.state === 'Running', 3000) && await until(() => v.guest.phase === 'locked', 6000));
    H().stop('SRV01', { turnOff: true });

    /* ---------------- PowerShell ---------------- */
    let o = await run('Get-VM');
    t('Get-VM', /Name\s+State\s+CPUUsage\(%\)\s+MemoryAssigned\(M\)\s+Uptime\s+Status\s+Version/.test(o) && /SRV01\s+Off\s+0\s+0\s+00:00:00\s+Operating normally\s+12\.0/.test(o), o);
    o = await run('Get-VM -Name NOPE');
    t('Get-VM on an unknown name', /Hyper-V was unable to find a virtual machine with name "NOPE"\./.test(o), o);
    o = await run('New-VM -Name SRV02 -MemoryStartupBytes 1GB -Generation 2 -NewVHDPath C:\\Hyper-V\\SRV02.vhdx -NewVHDSizeBytes 40GB -SwitchName LAN');
    const v2 = H().vm('SRV02');
    t('New-VM with a new VHD on a switch', v2 && v2.generation === 2 && v2.memory.startup === 1024 && v2.nics[0].switch === 'LAN' && H().vhd('C:\\Hyper-V\\SRV02.vhdx').size === 40 * GB && /SRV02\s+Off/.test(o), o);
    o = await run('Set-VMProcessor SRV02 -Count 2; Set-VMMemory SRV02 -DynamicMemoryEnabled $true -MinimumBytes 512MB -MaximumBytes 2GB; Get-VMMemory SRV02');
    t('Set-VMProcessor / Set-VMMemory / Get-VMMemory', v2.cpu.count === 2 && v2.memory.dynamic && /SRV02\s+True\s+512\s+1024\s+2048/.test(o), o);
    o = await run('Add-VMDvdDrive -VMName SRV02 -Path C:\\ISO\\WindowsServer2025.iso; Get-VMDvdDrive SRV02');
    t('Add-VMDvdDrive / Get-VMDvdDrive', /SRV02\s+SCSI\s+0\s+1\s+ISO\s+C:\\ISO\\WindowsServer2025.iso/.test(o), o);
    o = await run('$d = Get-VMDvdDrive SRV02; Set-VMFirmware SRV02 -FirstBootDevice $d; Get-VMFirmware SRV02');
    t('Set-VMFirmware -FirstBootDevice', v2.firmware.bootOrder[0] === 'dvd:0' && /SRV02\s+On\s+IPv4\s+\{DvdDrive, HardDiskDrive, VMNetworkAdapter\}/.test(o), o);
    o = await run('New-VHD -Path C:\\Hyper-V\\Data.vhdx -SizeBytes 10GB -Dynamic');
    t('New-VHD shows the disk', /VhdFormat\s+: VHDX/.test(o) && /VhdType\s+: Dynamic/.test(o) && /Size\s+: 10737418240/.test(o) && /FileSize\s+: 4194304/.test(o), o);
    o = await run('New-VHD -Path C:\\Hyper-V\\Data.vhdx -SizeBytes 10GB');
    t('New-VHD on an existing file', /The file exists\. \(0x80070050\)/.test(o), o);
    o = await run('Add-VMHardDiskDrive -VMName SRV02 -Path C:\\Hyper-V\\Data.vhdx; Get-VMHardDiskDrive SRV02');
    t('Add-VMHardDiskDrive / Get-VMHardDiskDrive', /SRV02\s+SCSI\s+0\s+2\s+C:\\Hyper-V\\Data.vhdx/.test(o) && (await run('(Get-VHD C:\\Hyper-V\\Data.vhdx).Attached')).trim() === 'True', o);
    o = await run('Get-VMSwitch');
    t('Get-VMSwitch', /Name\s+SwitchType\s+NetAdapterInterfaceDescription/.test(o) && /LAN\s+External\s+Microsoft Hyper-V Network Adapter/.test(o) && /Internal\s+Internal/.test(o), o);
    o = await run('New-VMSwitch -Name Lab -SwitchType Internal; Get-NetAdapter');
    t('New-VMSwitch -SwitchType Internal adds vEthernet (Lab)', H().switch('Lab') && /vEthernet \(Lab\)/.test(o), o);
    o = await run('Connect-VMNetworkAdapter -VMName SRV02 -SwitchName Lab; Get-VMNetworkAdapter SRV02');
    t('Connect-VMNetworkAdapter / Get-VMNetworkAdapter', v2.nics[0].switch === 'Lab' && /Network Adapter\s+False\s+SRV02\s+Lab\s+00155D010A[0-9A-F]{2}/.test(o), o);
    await run('Set-VMNetworkAdapterVlan -VMName SRV02 -Access -VlanId 20');
    t('Set-VMNetworkAdapterVlan', v2.nics[0].vlan === 20);
    o = await run('Remove-VMSwitch Lab -Force; Get-VMNetworkAdapter SRV02 | Select-Object -ExpandProperty SwitchName');
    t('Remove-VMSwitch disconnects the VMs on it', !H().switch('Lab') && !WS.net.adapter('vEthernet (Lab)') && v2.nics[0].switch === null);
    o = await run('Checkpoint-VM -Name SRV02 -SnapshotName "Before roles"; Get-VMSnapshot SRV02');
    t('Checkpoint-VM / Get-VMSnapshot', /SRV02\s+Before roles\s+Standard/.test(o) || /SRV02\s+Before roles\s+Production/.test(o), o);
    o = await run('Restore-VMSnapshot -VMName SRV02 -Name "Before roles" -Confirm:$false; Remove-VMSnapshot -VMName SRV02 -Name "Before roles"; (Get-VMSnapshot SRV02).Count');
    t('Restore-VMSnapshot / Remove-VMSnapshot', v2.checkpoints.length === 0, o);
    o = await run('Start-VM SRV01; (Get-VM SRV01).State');
    t('Start-VM', /Running/.test(o) && v.state === 'Running', o);
    o = await run('Stop-VM SRV01 -TurnOff; Set-VM SRV01 -AutomaticStartAction Nothing -AutomaticStopAction Save -ProcessorCount 2; Get-VM SRV01 | Select-Object Name,ProcessorCount,AutomaticStartAction,AutomaticStopAction | Format-List');
    t('Stop-VM -TurnOff / Set-VM', /ProcessorCount\s+: 2/.test(o) && /AutomaticStartAction\s+: Nothing/.test(o) && v.state === 'Off', o);
    o = await run('Get-VMIntegrationService SRV01');
    t('Get-VMIntegrationService lists the six services', /SRV01\s+Guest Service Interface\s+False/.test(o) && /SRV01\s+Heartbeat\s+True/.test(o), o);
    await run('Enable-VMIntegrationService -VMName SRV01 -Name "Guest Service Interface"');
    t('Enable-VMIntegrationService', v.integration['Guest Service Interface']);
    o = await run('Enable-VMTPM SRV02');
    t('Enable-VMTPM needs a key protector first', /key protector/.test(o) && !v2.tpm);
    await run('Set-VMKeyProtector -VMName SRV02 -NewLocalKeyProtector; Enable-VMTPM SRV02');
    t('...then works', v2.tpm);
    o = await run('Get-VMHost | Select-Object VirtualHardDiskPath,VirtualMachinePath | Format-List; Set-VMHost -VirtualMachinePath C:\\Hyper-V -VirtualHardDiskPath "C:\\Hyper-V\\Virtual Hard Disks"');
    t('Get-VMHost / Set-VMHost', /VirtualHardDiskPath : C:\\ProgramData\\Microsoft\\Windows\\Virtual Hard Disks/.test(o) && H().host().vmPath === 'C:\\Hyper-V', o);
    o = await run('Rename-VM SRV02 -NewName SRV03; Export-VM SRV03 -Path C:\\Export; Get-ChildItem C:\\Export\\SRV03 -Name');
    t('Rename-VM / Export-VM', H().vm('SRV03') && /Virtual Hard Disks/.test(o) && /Virtual Machines/.test(o), o);
    o = await run('Remove-VM SRV03 -Force; Test-Path C:\\Hyper-V\\SRV02.vhdx');
    t('Remove-VM keeps the virtual hard disk', !H().vm('SRV03') && /True/.test(o), o);
    if (shot('ps')) { WS.apps.launch('terminal'); return; }

    /* ---------------- Hyper-V Manager ---------------- */
    const setF = (root, name, value) => { const el = root.querySelector(`[data-field="${name}"]`); if (!el) throw new Error('No field ' + name); if (el.type === 'checkbox' || el.type === 'radio') { el.checked = value !== false; el.dispatchEvent(new Event('change', { bubbles: true })); } else { el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); } };
    const mwin = WS.apps.launch('virtmgmt'); await wait(150);
    const M = mwin.virtmgmt;
    t('Hyper-V Manager opens on the server with its VMs', M.current().id === 'hv-host' && M.list && M.list.rows().some(x => x.name === 'SRV01') && mwin.el.textContent.includes('Virtual Machines'));
    const acts = () => [...mwin.el.querySelectorAll('.act-item')].map(a => (a.classList.contains('disabled') ? '~' : '') + a.textContent.trim());
    t('the server actions: New, Hyper-V Settings..., Virtual Switch Manager..., Edit Disk...', ['New', 'Hyper-V Settings...', 'Virtual Switch Manager...', 'Edit Disk...', 'Inspect Disk...', 'Stop Service'].every(a => acts().includes(a)), acts());
    M.list.select([v.id]); await wait(60);
    t('selecting a VM: Connect..., Settings..., Start, Checkpoint, Export..., Rename..., Delete...', ['Connect...', 'Settings...', 'Start', 'Checkpoint', 'Export...', 'Rename...', 'Delete...'].every(a => acts().includes(a)), acts());
    t('the Checkpoints pane and the details pane', mwin.el.querySelector('.hv-cp') && mwin.el.textContent.includes(c2.name) && mwin.el.querySelector('.hv-details').textContent.includes('Configuration Version'));
    if (shot('manager')) return;
    // New Virtual Machine Wizard
    let wz, wd;
    let p = WS.virtmgmt.newVM({ onCreate: (w, d) => { wz = w; wd = d; } }); await wait(80);
    t('New Virtual Machine Wizard: Before You Begin, Finish already available', /This wizard helps you create a virtual machine/.test(wz.el.textContent) && !button('Finish', wz.el).disabled);
    wz.next(); await wait(60);
    setF(wz.el, 'name', 'WEB01'); setF(wz.el, 'elsewhere', true); setF(wz.el, 'location', 'C:\\Hyper-V\\');
    if (shot('newvm')) return;
    wz.next(); await wait(60);
    setF(wz.el, 'gen2', true);
    wz.next(); await wait(60);
    setF(wz.el, 'memory', 'lots');
    wz.next(); await wait(80);
    t('a memory value that is not a number is refused', /The amount of memory you specified is not valid/.test(dlgText()));
    await click('OK');
    setF(wz.el, 'memory', '1024'); setF(wz.el, 'dynamic', true);
    if (shot('nvmem')) return;
    wz.next(); await wait(60);
    setF(wz.el, 'switch', 'LAN');
    if (shot('nvnet')) return;
    wz.next(); await wait(60);
    t('the disk page proposes <name>.vhdx in <location>\\<name>\\Virtual Hard Disks', wz.el.querySelector('[data-field="vhdname"]').value === 'WEB01.vhdx' && wz.el.querySelector('[data-field="vhdlocation"]').value === 'C:\\Hyper-V\\WEB01\\Virtual Hard Disks\\');
    setF(wz.el, 'vhdsize', '40');
    if (shot('nvdisk')) return;
    wz.next(); await wait(60);
    setF(wz.el, 'install-iso', true); setF(wz.el, 'iso', 'C:\\ISO\\WindowsServer2025.iso');
    if (shot('nvinstall')) return;
    wz.next(); await wait(60);
    t('the summary lists the choices', /Generation 2/.test(wz.el.textContent) && /1024 MB \(Dynamic Memory\)/.test(wz.el.textContent) && /WEB01.vhdx/.test(wz.el.textContent) && /Will be installed from C:\\ISO\\WindowsServer2025.iso/.test(wz.el.textContent));
    button('Finish', wz.el).click(); const web = await p;
    t('Finish creates WEB01 as specified', web && web.generation === 2 && web.path === 'C:\\Hyper-V\\WEB01' && web.memory.dynamic && web.nics[0].switch === 'LAN' && H().vhd(web.disks[0].path).size === 40 * GB && web.dvds[0].path === 'C:\\ISO\\WindowsServer2025.iso' && web.firmware.bootOrder[0] === 'dvd:0');
    // Settings for WEB01
    let sf, sapi;
    p = WS.virtmgmt.settings(web.id, { onCreate: (f, a) => { sf = f; sapi = a; } }); await wait(80);
    t('Settings opens on Memory with the hardware and management lists', title() === `Settings for WEB01 on ${WS.sys.name}` && /Hardware/.test(sapi.left.textContent) && /Automatic Stop Action/.test(sapi.left.textContent) && /Enable Dynamic Memory/.test(sapi.right.textContent));
    sapi.select('processor'); setF(sapi.right, 'cpu', '2');
    sapi.select('autostart'); setF(sapi.right, 'as-Start', true);
    sapi.select('autostop'); setF(sapi.right, 'ast-ShutDown', true);
    sapi.select('integration'); setF(sapi.right, 'is-Guest Service Interface', true);
    sapi.select('nic:0'); setF(sapi.right, 'vlanon', true); setF(sapi.right, 'vlan', '10');
    if (shot('settings')) return;
    sapi.ok(); await p;
    t('OK applies processors, start/stop actions, integration services and the VLAN', web.cpu.count === 2 && web.autoStart === 'Start' && web.autoStop === 'ShutDown' && web.integration['Guest Service Interface'] && web.nics[0].vlan === 10);
    p = WS.virtmgmt.settings(web.id, { onCreate: (f, a) => { sapi = a; } }); await wait(60);
    sapi.select('nic:0'); setF(sapi.right, 'vlanon', false);
    sapi.select('firmware'); await wait(20);
    sapi.right.querySelectorAll('.hv-bootrow')[1].click(); sapi.right.querySelector('[data-field="moveup"]').click();
    sapi.ok(); await p;
    t('the VLAN is cleared and Firmware moves the hard drive first', web.nics[0].vlan === null && web.firmware.bootOrder[0] === 'disk:0');
    H().setVM(web.id, { bootOrder: ['dvd:0', 'disk:0', 'net:0'] });
    // Virtual Switch Manager
    let vapi;
    p = WS.virtmgmt.switchManager({ onCreate: (f, a) => { vapi = a; } }); await wait(80);
    t('Virtual Switch Manager lists the switches and the MAC address range', title() === `Virtual Switch Manager for ${WS.sys.name}` && /LAN/.test(shade().textContent) && /MAC Address Range/.test(shade().textContent));
    vapi.select('new'); shade().querySelector('.hv-type[data-type="Internal"]').click(); await wait(20);
    shade().querySelector('[data-field="create"]').click(); await wait(30);
    setF(vapi.right, 'name', 'Test');
    if (shot('switches')) return;
    await vapi.apply(); await wait(40);
    t('Create Virtual Switch + Apply makes an internal switch', H().switch('Test') && H().switch('Test').type === 'Internal' && !!WS.net.adapter('vEthernet (Test)'));
    const li = [...shade().querySelectorAll('.hv-litem')].find(x => x.textContent.startsWith('LAN')); li.click(); await wait(20);
    setF(vapi.right, 'share', false);
    const pa = vapi.apply(); await wait(80);
    t('changing an external switch asks before it can disrupt the network', /Pending changes may disrupt network connectivity/.test(dlgText()));
    if (shot('external')) { await click('No'); return; }
    await click('No'); await pa;
    t('...No leaves it alone', H().switch('LAN').allowManagementOS && WS.net.adapter('vEthernet (LAN)'));
    setF(vapi.right, 'share', true);
    const li2 = [...shade().querySelectorAll('.hv-litem')].find(x => x.textContent.startsWith('Test')); li2.click(); await wait(20);
    vapi.right.querySelector('[data-field="remove"]').click(); await wait(20);
    vapi.ok(); await p;
    t('Remove + OK deletes the switch and its host adapter', !H().switch('Test') && !WS.net.adapter('vEthernet (Test)') && H().switch('LAN').allowManagementOS);
    // Hyper-V Settings
    p = WS.virtmgmt.hostSettings({ onCreate: (f, a) => { vapi = a; } }); await wait(60);
    setF(shade(), 'vhdPath', 'D:\\VHDs'); vapi.ok(); await p;
    t('Hyper-V Settings changes the default virtual hard disk folder', H().host().vhdPath === 'D:\\VHDs');
    H().setHost({ vhdPath: 'C:\\Hyper-V\\Virtual Hard Disks' });

    /* ---------------- Virtual Machine Connection: install Windows ---------------- */
    const vwin = WS.virtmgmt.connect(web.id); await wait(80);
    const C = vwin.vmc;
    t('Connect: the VM is off, with a Start button', /The virtual machine 'WEB01' is turned off\./.test(C.text()) && vwin.el.textContent.includes('Status: Off'));
    if (shot('vmc-off')) return;
    C.click('Start'); await wait(60);
    t('Start from VMConnect', web.state === 'Running' && vwin.el.textContent.includes('Status: Running'));
    await until(() => web.guest.phase === 'presskey');
    await wait(60);
    t('the screen says "Press any key to boot from CD or DVD.."', /Press any key to boot from CD or DVD/.test(C.text()));
    if (shot('vmc-presskey')) return;
    C.key();
    t('a key starts Windows Setup', web.guest.phase === 'setup' && await until(() => web.guest.step === 'language') && await until(() => /Select language settings/.test(C.text())));
    C.click('Next'); await wait(60); C.click('Next'); await wait(60);
    t('Select setup option: Next waits for the agreement', /Select setup option/.test(C.text()) && C.screen().querySelector('[data-setup="Next"]').disabled);
    C.type('agree', true); C.click('Next'); await wait(60);
    C.click('dc-core'); await wait(30);
    if (shot('vmc-setup')) return;
    C.click('Next'); await wait(60);
    t('license terms, then the disk', /Applicable notices and license terms/.test(C.text()));
    C.click('Accept'); await wait(60);
    t('Select location to install shows Disk 0 at 40 GB', /Disk 0 Unallocated Space/.test(C.text()) && /40\.0 GB/.test(C.text()));
    C.click('Next'); await wait(60); C.click('Install'); await wait(80);
    t('Installing Windows Server', /Installing Windows Server/.test(C.text()) && web.guest.phase === 'installing');
    if (shot('vmc-installing')) return;
    t('Setup completes and restarts to Customize settings', await until(() => /Customize settings/.test(C.text()), 12000));
    if (shot('vmc-oobe')) return;
    C.type('pw1', 'Passw0rd!'); C.type('pw2', 'Passw0rd!x'); C.click('Finish'); await wait(40);
    t('mismatched passwords are caught', /The passwords don\u2019t match\./.test(C.text()));
    C.type('pw2', 'Passw0rd!'); C.click('Finish'); await wait(80);
    t('the lock screen asks for Ctrl+Alt+Delete', /Press Ctrl\+Alt\+Delete to unlock\./.test(C.text()));
    C.toolbar('cad').click(); await wait(80);
    C.type('password', 'Passw0rd!'); C.click('Sign in'); await wait(120);
    const wos = H().guestOs(web);
    t('Server Core signs in to SConfig with the computer name', web.guest.phase === 'desktop' && /Welcome to Windows Server 2025 Datacenter Evaluation/.test(C.text()) && C.text().includes(wos.computerName) && !wos.desktop);
    if (shot('vmc-desktop')) return;

    /* ---------------- actions from the manager ---------------- */
    let pr = WS.virtmgmt.act(web.id, 'checkpoint'); await wait(80);
    t('Checkpoint of a running guest is a production checkpoint', /Production checkpoint created successfully/.test(dlgText()) && web.checkpoints.length === 1 && web.checkpoints[0].type === 'Production');
    await click('OK'); await pr;
    H().setVM(v.id, { memory: { startup: 2048, dynamic: false } });
    pr = WS.virtmgmt.act(v.id, 'start'); await wait(80);
    t('a VM that does not fit in memory: "An error occurred while attempting to start the selected virtual machine(s)."', /An error occurred while attempting to start the selected virtual machine\(s\)\./.test(dlgText()) && /Not enough memory in the system/.test(dlgText()));
    await click('OK'); await pr;
    pr = WS.virtmgmt.act(web.id, 'turnoff'); await wait(80);
    t('Turn Off asks first', title() === 'Turn Off Machine' && /any unsaved data in the virtual machine will be lost/.test(dlgText()));
    await click('Turn Off'); await pr;
    t('...and turns it off; VMConnect follows', web.state === 'Off' && await until(() => /is turned off/.test(C.text())));
    M.refresh(); M.list.select([web.id]); await wait(60);
    const cpRow = mwin.el.querySelector('.hv-cptree .tv-row');
    t('the checkpoint tree shows the checkpoint and Now', !!cpRow && /Now/.test(mwin.el.querySelector('.hv-cptree').textContent));
    if (shot('checkpoints')) return;
    pr = WS.virtmgmt.applyDialog(web, web.checkpoints[0]); await wait(80);
    t('Apply Checkpoint offers Take Checkpoint and Apply / Apply / Cancel', title() === 'Apply Checkpoint' && !!button('Take Checkpoint and Apply') && !!button('Apply'));
    await click('Apply'); await pr;
    t('Apply restores the production checkpoint (the VM is off)', web.state === 'Off');
    o = await crun('vmconnect localhost SRV01');
    t('vmconnect localhost SRV01 opens a second connection window', WS.wm.windows.some(w => w.app === 'vmconnect' && w.vmcId === v.id));
    t('Task Manager sees mmc.exe virtmgmt.msc and vmconnect.exe', WS.proc.list().some(x => x.image === 'mmc.exe' && /virtmgmt\.msc/.test(x.cmdLine)) && WS.proc.list().some(x => x.image === 'vmconnect.exe'));
    t('Server Manager\u2019s Tools menu lists Hyper-V Manager', WS.sm.tools().some(x => x.label === 'Hyper-V Manager'));
    pr = WS.virtmgmt.act(web.id, 'delete'); await wait(80);
    t('Delete asks, mentioning that virtual hard disks are kept', /Virtual hard disks are not deleted/.test(dlgText()));
    await click('Delete'); await pr;
    t('...and deletes the VM; VMConnect closes', !H().vm(web.id) && WS.fs.exists('C:\\Hyper-V\\WEB01\\Virtual Hard Disks\\WEB01.vhdx') && await until(() => !WS.wm.windows.includes(vwin)));
  } catch (e) {
    fail++;
    console.log('FAIL exception :: ' + (e && e.stack || e));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
