/* Run with ?quick=1 in a fresh browser profile. &shot=ps|cmd|sconfig leaves a terminal open. */
(async function () {
  'use strict';
  const WS = window.WS;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = new URLSearchParams(location.search).get('shot');
  const c = new WS.term.TextConsole(), ps = new WS.ps.Session({ console: c });
  async function run(line) {
    c.clear(); const capture = [], before = ps.errors.length;
    await ps.execute(line, { capture });
    t('PS ' + line, ps.errors.length === before && ps.lastSuccess, c.text());
    return capture;
  }
  async function bad(line, id) {
    c.clear(); const before = ps.errors.length;
    await ps.execute(line);
    t('PS error ' + line, ps.errors.length > before && c.text().includes(id), c.text());
  }
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  async function crun(line, contains, code = 0) {
    cmdc.clear(); await cmd.execute(line);
    t('CMD ' + line, cmd.lastExit === code && (!contains || cmdc.text().includes(contains)), cmdc.text());
    return cmdc.text();
  }
  async function config(inputs, ioOverride = {}) {
    const con = new WS.term.TextConsole({ inputs });
    const session = new WS.ps.Session({ console: con });
    const io = Object.assign(WS.term.makeIO(session), ioOverride);
    // Preserve menus in this test's transcript across SConfig clear operations.
    con.clear = () => {};
    const result = await WS.term.sconfig(io);
    t('SConfig returns successfully', result === 0);
    return { con, session };
  }
  const key = (el, name, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...opts }));
  async function enter(tab, line) { tab.console.insert(line); key(tab.console.kbd, 'Enter'); await wait(20); }
  try {
    await wait(100); WS.wm.closeAll();
    t('terminal registrations', ['terminal', 'powershell', 'cmd'].every(id => !!WS.apps.get(id)));
    ps.banner(); t('PowerShell banner', c.text().includes('Windows PowerShell'));
    t('PowerShell version', ps.getVar('PSVersionTable').get('PSVersion').startsWith('5.1.'));
    let out = await run('1 + 2 * 3'); t('arithmetic precedence', out[0] === 7, out);
    await run('$x = 10; $x += 2'); t('variable assignment', ps.getVar('x') === 12);
    out = await run('"Server: $env:COMPUTERNAME"'); t('environment interpolation', out[0].includes(WS.sys.name));
    out = await run('1..5 | Where-Object { $_ -gt 2 } | ForEach-Object { $_ * 2 }'); t('object pipeline scriptblocks', out.join() === '6,8,10', out);
    out = await run('3,1,2,2 | Sort-Object -Unique'); t('sort and unique', out.join() === '1,2,3', out);
    out = await run('1..5 | Measure-Object -Sum'); t('measure pipeline', out[0].Sum === 15 && out[0].Count === 5, out);
    await run('function Double($n) { $n * 2 }'); out = await run('Double 8'); t('function invocation', out[0] === 16, out);
    out = await run("@{Name='Test';Value=42} | ConvertTo-Json -Compress"); t('hashtable JSON', out[0].includes('42'), out);
    c.feed('answer'); out = await run("Read-Host 'Value'"); t('Read-Host input', out[0] === 'answer');
    c.feed('P@ssw0rd!'); out = await run('Read-Host -AsSecureString'); t('secure prompt masks input', out[0] instanceof WS.ps.SecureString && !c.text().includes('P@ssw0rd!'));
    await bad('No-SuchCommand', 'CommandNotFoundException');
    await bad('Get-Service -NoSuchParameter', 'NamedParameterNotFound');
    await bad('"unterminated', 'TerminatorExpectedAtEndOfString');
    c.clear(); out = []; await ps.execute('Get-Service NoSuchService -ErrorAction SilentlyContinue', { capture: out }); t('suppressed error output', c.text() === '' && out.length === 0 && !ps.lastSuccess);
    await run("New-Item C:\\TerminalLab -ItemType Directory"); t('PS creates directory', WS.fs.isDir('C:\\TerminalLab'));
    await run("Set-Content C:\\TerminalLab\\hello.txt -Value 'hello'");
    await run("Add-Content C:\\TerminalLab\\hello.txt -Value 'world'");
    out = await run('Get-Content C:\\TerminalLab\\hello.txt'); t('file contents shared with model', out.join('|').includes('hello|world'), out);
    await run("'redirected' > C:\\TerminalLab\\redirect.txt"); t('PS output redirection', WS.fs.readFile('C:\\TerminalLab\\redirect.txt').includes('redirected'));
    await run('Copy-Item C:\\TerminalLab\\hello.txt C:\\TerminalLab\\copy.txt');
    await run('Remove-Item C:\\TerminalLab\\copy.txt -WhatIf'); t('WhatIf preserves file', WS.fs.exists('C:\\TerminalLab\\copy.txt'));
    c.feed('n'); await run('Remove-Item C:\\TerminalLab\\copy.txt -Confirm'); t('confirmation decline preserves file', WS.fs.exists('C:\\TerminalLab\\copy.txt'));
    c.feed('y'); await run('Remove-Item C:\\TerminalLab\\copy.txt -Confirm'); t('confirmation accept removes file', !WS.fs.exists('C:\\TerminalLab\\copy.txt'));
    await run('Set-Location C:\\TerminalLab'); t('PS working directory', ps.cwd === 'C:\\TerminalLab');
    out = await run("Get-Service | Where-Object Status -eq 'Running' | Sort-Object Name | Select-Object -First 3 -Property Name,Status");
    t('property pipeline', out.length === 3 && out.every(x => x.Status === 'Running'), out);
    c.clear(); await ps.execute('Get-Service Spooler | Format-Table Name,Status'); t('table formatting', /Name\s+Status/.test(c.text()) && c.text().includes('Spooler'), c.text());
    c.clear(); await ps.execute('Get-Service Spooler | Format-List Name,Status'); t('list formatting', /Name\s+: Spooler/.test(c.text()), c.text());
    await run('Stop-Service Spooler'); t('service stopped', WS.svc.get('Spooler').status === 'Stopped');
    await run('Start-Service Spooler'); t('service started', WS.svc.get('Spooler').status === 'Running');
    await run('Set-Service Spooler -StartupType Manual'); t('service startup', WS.svc.get('Spooler').startup === 'Manual');
    await run("Rename-Computer -NewName TERM01"); t('rename requires restart', WS.state.system.pendingComputerName === 'TERM01');
    WS.sys.onBoot(); t('rename applied on boot', WS.sys.name === 'TERM01');
    const idx = WS.net.adapter().ifIndex;
    await run(`New-NetIPAddress -InterfaceIndex ${idx} -IPAddress 192.168.1.10 -PrefixLength 24 -DefaultGateway 192.168.1.1`);
    t('static IP from PS', WS.net.adapter().ip === '192.168.1.10' && !WS.net.adapter().dhcp);
    await run(`Set-DnsClientServerAddress -InterfaceIndex ${idx} -ServerAddresses 192.168.1.1`);
    t('DNS client from PS', WS.net.dnsServers().includes('192.168.1.1'));
    out = await run('Get-NetIPConfiguration'); t('IP configuration object', out.length > 0 && !!out[0].InterfaceAlias, out);
    await run("New-LocalUser helpdesk -Password (ConvertTo-SecureString 'P@ssw0rd!' -AsPlainText -Force)");
    t('local user model', !!WS.local.user('helpdesk'));
    await run('Add-LocalGroupMember Administrators -Member helpdesk'); t('local group membership', WS.local.group('Administrators').members.includes('helpdesk'));
    await run('New-SmbShare -Name TerminalLab -Path C:\\TerminalLab -FullAccess Administrators'); t('SMB share model', WS.smb.shares().some(x => x.name === 'TerminalLab'));
    await run('Set-Disk -Number 1 -IsOffline $false'); await run('Initialize-Disk -Number 1 -PartitionStyle GPT');
    await run('New-Partition -DiskNumber 1 -UseMaximumSize -DriveLetter E'); await run('Format-Volume -DriveLetter E -FileSystem NTFS -NewFileSystemLabel Data -Confirm:$false');
    t('storage pipeline creates volume', WS.storage.volumes().some(x => x.letter === 'E' && x.label === 'Data'));
    out = await run('Get-WinEvent -LogName System -MaxEvents 3'); t('event objects', out.length > 0 && out.length <= 3);
    await bad('Get-ADUser -Filter *', 'CommandNotFoundException');
    await run('Install-WindowsFeature AD-Domain-Services,DNS,DHCP -IncludeManagementTools');
    t('roles installed through PS', ['AD-Domain-Services', 'DNS', 'DHCP'].every(x => WS.features.isInstalled(x)));
    await run("Install-ADDSForest -DomainName terminal.local -SafeModeAdministratorPassword (ConvertTo-SecureString 'P@ssw0rd!' -AsPlainText -Force) -InstallDns -Force -NoRebootOnCompletion");
    t('forest promotion model', WS.sys.isDC() && WS.state.ad.domain === 'terminal.local');
    WS.sys.onBoot();
    await run('New-ADOrganizationalUnit -Name Training');
    await run("New-ADUser -Name 'Jane Smith' -SamAccountName jsmith -Path 'OU=Training,DC=terminal,DC=local' -AccountPassword (ConvertTo-SecureString 'P@ssw0rd!' -AsPlainText -Force) -Enabled $true");
    t('AD user model', !!WS.ad.get('jsmith', 'user') && WS.ad.get('jsmith', 'user').enabled);
    await run('New-ADGroup -Name LabStaff -GroupScope Global'); await run('Add-ADGroupMember LabStaff -Members jsmith');
    out = await run('Get-ADGroupMember LabStaff'); t('AD group membership', out.some(x => x.SamAccountName === 'jsmith'), out);
    await run('Set-ADUser jsmith -Department Training'); out = await run('Get-ADUser jsmith -Properties Department'); t('AD user properties', out[0].Department === 'Training', out);
    out = await run("Get-ADUser -Filter { Department -eq 'Training' } -Properties Department"); t('AD filter', out.some(x => x.SamAccountName === 'jsmith'), out);
    await run('Disable-ADAccount jsmith'); t('AD account disabled', !WS.ad.get('jsmith', 'user').enabled);
    await run('Enable-ADAccount jsmith'); t('AD account enabled', WS.ad.get('jsmith', 'user').enabled);
    await run('Add-DnsServerPrimaryZone -Name lab.test -ZoneFile lab.test.dns');
    await run('Add-DnsServerResourceRecordA -ZoneName lab.test -Name www -IPv4Address 192.168.1.20');
    out = await run('Get-DnsServerResourceRecord -ZoneName lab.test -Name www'); t('DNS record model', out.length === 1, out);
    await run('Set-DnsServerForwarder -IPAddress 8.8.8.8'); t('DNS forwarder model', WS.dns.forwarders().includes('8.8.8.8'));
    await run('Add-DhcpServerv4Scope -Name Lab -StartRange 192.168.1.100 -EndRange 192.168.1.200 -SubnetMask 255.255.255.0');
    await run('Add-DhcpServerv4ExclusionRange -ScopeId 192.168.1.0 -StartRange 192.168.1.100 -EndRange 192.168.1.110');
    await run('Set-DhcpServerv4OptionValue -ScopeId 192.168.1.0 -Router 192.168.1.1 -DnsServer 192.168.1.10 -DnsDomain terminal.local');
    await run('Add-DhcpServerv4Reservation -ScopeId 192.168.1.0 -IPAddress 192.168.1.150 -ClientId 00-15-5D-00-01-02 -Name CLIENT02');
    await run('Add-DhcpServerInDC'); t('DHCP authorized', WS.dhcp.authorized);
    out = await run('Get-DhcpServerv4Scope'); t('DHCP scope query', out.some(x => x.ScopeId === '192.168.1.0'), out);
    out = await run('Get-DhcpServerv4Reservation -ScopeId 192.168.1.0'); t('DHCP reservation query', out.some(x => x.IPAddress === '192.168.1.150'), out);
    out = await run('Get-DhcpServerv4OptionValue -ScopeId 192.168.1.0'); t('DHCP options query', out.some(x => x.OptionId === 3), out);
    await crun('ver', 'Microsoft Windows'); await crun('hostname', 'TERM01');
    await crun('ipconfig /all', '192.168.1.10'); await crun('ping -n 1 127.0.0.1', 'Reply from');
    await crun('nslookup www.lab.test 127.0.0.1', '192.168.1.20'); await crun('whoami', 'administrator');
    await crun('systeminfo', 'Windows Server 2025'); await crun('gpupdate /force', 'completed successfully');
    await crun('sc start Spooler', 'START_PENDING'); await crun('sc query Spooler', 'RUNNING'); await crun('net share', 'TerminalLab');
    await crun('cd /d C:\\TerminalLab'); t('CMD working directory', cmd.cwd === ps.cwd);
    await crun('type hello.txt', 'hello'); await crun('set LAB=works'); await crun('echo %LAB%', 'works');
    await crun('echo cmd-file > cmd.txt'); t('CMD redirection model', WS.fs.readFile('C:\\TerminalLab\\cmd.txt').includes('cmd-file'));
    await crun('echo needle | find "needle"', 'needle');
    await crun('nosuchcommand > error.txt 2>&1', null, 9009); t('CMD merges redirected errors', WS.fs.readFile('C:\\TerminalLab\\error.txt').includes("'nosuchcommand' is not recognized") && cmdc.text() === '');
    await crun('nosuchcommand > stdout.txt 2>nul', null, 9009); t('CMD suppresses stderr', cmdc.text() === '' && WS.fs.readFile('C:\\TerminalLab\\stdout.txt') === '');
    await crun('nosuchcommand 2> "stderr file.txt"', null, 9009); t('CMD redirects stderr to file', cmdc.text() === '' && WS.fs.readFile('C:\\TerminalLab\\stderr file.txt').includes('not recognized'));
    await crun('nosuchcommand 2>> "stderr file.txt"', null, 9009); t('CMD appends stderr to file', WS.fs.readFile('C:\\TerminalLab\\stderr file.txt').split('not recognized').length === 3);
    await crun('echo "a>b"', '"a>b"'); t('CMD quoted redirection remains literal', !WS.fs.exists('C:\\TerminalLab\\b'));
    await crun('nosuchcommand && echo wrong || echo recovered', 'recovered'); t('CMD conditional skipping', !cmdc.text().includes('wrong'));
    await crun('nosuchcommand', 'not recognized', 9009);
    await run('ipconfig /all'); t('native through PS', c.text().includes('192.168.1.10'));
    let complete = ps.complete('Get-Serv', 8, false, {}); t('command completion', complete.line === 'Get-Service', complete);
    complete = ps.complete('Get-Service -Na', 15, false, {}); t('parameter completion', complete.line === 'Get-Service -Name', complete);
    complete = cmd.complete('type hel', 8, false, {}); t('CMD path completion', complete.line.includes('hello.txt'), complete);
    // SConfig on a DC: rejected membership change and cancellation.
    let sc = await config(['1', '', '15']); t('SConfig refuses DC membership change', sc.con.text().includes('cannot be changed'));
    sc = await config([null]); t('SConfig Ctrl+C returns to shell', !sc.session.exited);
    // Return to a fresh standalone model for local/SConfig checks.
    WS.store.reset(); WS.state.system.adminPassword = 'P@ssw0rd!'; WS.sys.onBoot();
    WS.local.createUser('operator', { password: 'P@ssw0rd!' });
    await crun('net user terminaluser P@ssw0rd! /add', 'completed successfully'); t('CMD creates local user', !!WS.local.user('terminaluser'));
    await crun('net localgroup Administrators terminaluser /add', 'completed successfully'); t('CMD updates local group', WS.local.group('Administrators').members.includes('terminaluser'));
    await crun('netsh interface ipv4 set address name="Ethernet" static 192.168.1.30 255.255.255.0 192.168.1.1'); t('netsh sets static address', WS.net.adapter().ip === '192.168.1.30');
    await crun('netsh interface ipv4 set address Ethernet dhcp'); t('netsh positional DHCP', WS.net.adapter().dhcp);
    await crun('netsh interface ipv4 set dnsservers name=Ethernet static 8.8.8.8'); t('netsh mixed DNS arguments', WS.net.dnsServers().includes('8.8.8.8'));
    await crun('netsh interface ipv4 add dnsservers name=Ethernet 1.1.1.1 index=2'); t('netsh mixed DNS add', WS.net.dnsServers()[1] === '1.1.1.1');
    await crun('netsh interface ipv4 delete dnsservers name=Ethernet 1.1.1.1'); t('netsh DNS delete', !WS.net.dnsServers().includes('1.1.1.1'));
    sc = await config(['1', 'W', 'LABGROUP', 'N', '', '15']); t('SConfig workgroup', WS.state.system.workgroup === 'LABGROUP');
    await config(['2', 'CORE01', 'N', '', '15']); t('SConfig pending rename', WS.state.system.pendingComputerName === 'CORE01');
    await config(['3', 'operator', '', '15']); t('SConfig local admin', WS.local.group('Administrators').members.includes('operator'));
    await config(['4', '2', '', '15']); t('SConfig remote management', !WS.state.system.remoteMgmt);
    await config(['4', '3', 'Y', '', '15']); t('SConfig ping firewall', WS.fw.rules().find(x => x.name === 'FPS-ICMP4-ERQ-In').enabled);
    await config(['5', 'M', '', '6', 'R', 'N', '', '10', '2', '', '15']); t('SConfig stub state', WS.state.system.updateSetting === 'Manual' && WS.state.system.lastUpdateSearch.filter === 'R' && WS.state.system.telemetrySetting === 'Optional');
    await config(['7', 'E', '1', '', '15']); t('SConfig RDP with NLA', WS.state.system.rdpEnabled && WS.state.system.rdpNla);
    await config(['7', 'D', '', '15']); t('SConfig disable RDP', !WS.state.system.rdpEnabled);
    const ni = String(WS.net.adapter().ifIndex);
    await config(['8', ni, '1', 'S', '192.168.1.25', '255.255.255.0', '192.168.1.1', '2', '192.168.1.1', '8.8.8.8', '4', '', '15']);
    t('SConfig static address and DNS', WS.net.adapter().ip === '192.168.1.25' && WS.net.dnsServers().includes('8.8.8.8'));
    await config(['8', ni, '3', '1', 'D', '4', '', '15']); t('SConfig DHCP and clear DNS', WS.net.adapter().dhcp && WS.net.adapter().dnsDhcp);
    const previous = WS.net.adapter().ip;
    sc = await config(['8', ni, '1', 'S', 'bad-ip', '', '', '4', '', '15']); t('SConfig invalid IP leaves address unchanged', WS.net.adapter().ip === previous && sc.con.text().includes('not valid'));
    let launched = null; await config(['9', '', '15'], { launch: id => { launched = id; } }); t('SConfig date and time launcher', launched === 'timedate');
    sc = await config(['11', '1', '', '15']); t('SConfig evaluation status', sc.con.text().includes('Evaluation'));
    await config(['11', '3', 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', '', '15']); t('SConfig product key stub', !!WS.state.system.productKey);
    for (const [item, method] of [['12', 'lock'], ['13', 'restart'], ['14', 'shutdown']]) {
      const original = WS.shell[method]; let called = false;
      WS.shell[method] = () => { called = true; };
      try { sc = await config([item, 'Y']); t('SConfig ' + method, called && sc.session.exited); } finally { WS.shell[method] = original; }
    }
    // Real terminal widget: keyboard editing, session execution, independent tabs, lifecycle.
    const win = WS.apps.launch('terminal'); const host = win.terminal, tab = host.active;
    t('terminal window title', win.title === 'Administrator: Windows PowerShell');
    t('DOM console input prompt', tab.console.lineEl.textContent.includes('PS C:\\'));
    await enter(tab, '$tabValue = 99'); t('DOM input executes', tab.session.getVar('tabValue') === 99);
    key(tab.console.kbd, 'ArrowUp'); t('history recalls command', tab.console.reading.buf === '$tabValue = 99'); key(tab.console.kbd, 'Escape');
    tab.console.insert('Get-Serv'); key(tab.console.kbd, 'Tab'); t('Tab completes command in DOM', tab.console.reading.buf === 'Get-Service'); key(tab.console.kbd, 'Escape');
    tab.console.insert('abc'); key(tab.console.kbd, 'ArrowLeft'); key(tab.console.kbd, 'Backspace'); t('cursor editing', tab.console.reading.buf === 'ac');
    key(tab.console.kbd, 'c', { ctrlKey: true }); await wait(10); t('Ctrl+C cancels input', tab.console.reading && tab.console.reading.buf === '' && tab.console.text().includes('^C'));
    // Clipboard paths use an isolated fake clipboard, without altering the host clipboard.
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const execCommand = document.execCommand;
    let copied = '', clipboardInput = 'Write-Host pasted', blockClipboard = false;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(text) { if (blockClipboard) throw new Error('Clipboard denied'); copied = text; },
      async readText() { if (blockClipboard) throw new Error('Clipboard denied'); return clipboardInput; }
    } });
    try {
      const io = tab.console;
      io.writeLine('Copy this output');
      const range = document.createRange(); range.selectNodeContents(io.out.lastChild);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      io.el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      t('selected output retains keyboard focus', document.activeElement === io.scroll && io.selectedText().includes('Copy this output'));
      await wait(100); io.focus();
      t('output stays highlighted after idle and focus restoration', io.selectedText().includes('Copy this output') && document.activeElement === io.scroll);
      selection.removeAllRanges(); io.kbd.focus();
      t('terminal retains selection when browser clears it on focus', io.selectedText().includes('Copy this output'));
      t('retained selection has a visible browser highlight', !!CSS.highlights.get('terminal-selection') && CSS.highlights.get('terminal-selection').has(io.selectionRange));
      io.focus();
      io.scroll.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
      t('a fresh click clears the retained highlight', !io.selectedText() && !CSS.highlights.has('terminal-selection'));
      io.scroll.focus({ preventScroll: true });
      range.selectNodeContents(io.out.lastChild); selection.removeAllRanges(); selection.addRange(range); io.captureSelection(); io.focus();
      io.writeLine('New output while selected'); io.renderInput(); io.focus();
      t('new output and prompt rendering preserve output selection', io.selectedText().includes('Copy this output'));
      key(io.scroll, 'c', { ctrlKey: true }); await wait(10);
      t('Ctrl+C copies highlighted output without cancelling command', copied.includes('Copy this output') && io.reading.buf === '');
      copied = ''; key(io.scroll, 'c', { ctrlKey: true, shiftKey: true }); await wait(10);
      t('Ctrl+Shift+C copies selection', copied.includes('Copy this output'));
      t('copy leaves output highlighted', io.selectedText().includes('Copy this output'));
      io.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 450, clientY: 350 }));
      t('terminal context menu offers Copy Paste Select all', [...document.querySelectorAll('.menu .mi-label')].map(x => x.textContent).join('|') === 'Copy|Paste|Select all');
      WS.ui.closeMenu();
      key(io.scroll, 'v', { ctrlKey: true }); t('Ctrl+V focuses paste target after selection', document.activeElement === io.kbd);
      const data = new DataTransfer(); data.setData('text/plain', 'Write-Host native-paste');
      const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
      // Firefox ignores clipboardData in the constructor, so attach the data the way a real paste carries it.
      if (pasteEvent.clipboardData !== data) Object.defineProperty(pasteEvent, 'clipboardData', { value: data });
      io.kbd.dispatchEvent(pasteEvent);
      t('native clipboard paste inserts without executing', io.reading.buf === 'Write-Host native-paste' && !io.text().includes('PS C:\\Users\\Administrator> Write-Host native-paste'));
      key(io.kbd, 'Escape');
      key(io.kbd, 'v', { ctrlKey: true, shiftKey: true }); await wait(10);
      t('Ctrl+Shift+V pastes clipboard text', io.reading.buf === clipboardInput);
      key(io.kbd, 'Escape');
      const clipboardButtons = win.body.querySelectorAll('.term-clipboard');
      clipboardButtons[1].click(); await wait(10); t('visible Paste button inserts clipboard text', io.reading.buf === clipboardInput);
      key(io.kbd, 'Escape');
      blockClipboard = true;
      const pastePending = io.paste(); await wait(50);
      const pasteDialog = document.querySelector('#dialogs .dlg-shade:last-child');
      t('blocked clipboard opens usable paste box', !!pasteDialog && pasteDialog.textContent.includes('Paste into terminal'));
      pasteDialog.querySelector('textarea').value = 'Write-Host fallback';
      [...pasteDialog.querySelectorAll('button')].find(b => b.textContent === 'Paste').click(); await pastePending;
      t('paste box inserts text and returns focus', io.reading.buf === 'Write-Host fallback' && document.activeElement === io.kbd);
      key(io.kbd, 'Escape');
      const cancelPending = io.paste(); await wait(10);
      [...document.querySelector('#dialogs .dlg-shade:last-child').querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); await cancelPending;
      t('cancelled paste leaves command unchanged', io.reading.buf === '');
      document.execCommand = () => false;
      range.selectNodeContents(io.out.firstChild); selection.removeAllRanges(); selection.addRange(range);
      const copySelection = io.selectedText();
      const copyPending = io.copy(copySelection); await wait(50);
      const copyDialog = document.querySelector('#dialogs .dlg-shade:last-child');
      const copyBox = copyDialog.querySelector('textarea');
      t('blocked copy exposes selected text for native Ctrl+C', copyBox.value === copySelection && copyBox.selectionStart === 0 && copyBox.selectionEnd === copyBox.value.length && document.activeElement === copyBox);
      [...copyDialog.querySelectorAll('button')].find(b => b.textContent === 'Close').click(); await copyPending;
      t('copy fallback restores output highlight', io.selectedText() === copySelection && document.activeElement === io.scroll);
      io.reading.buf = 'pending command'; io.reading.cur = io.reading.buf.length; io.renderInput();
      key(io.scroll, 'Escape'); t('Escape deselects without clearing pending command', !io.selectedText() && io.reading.buf === 'pending command' && document.activeElement === io.kbd);
      key(io.kbd, 'Escape'); io.selectAll();
      key(io.scroll, 'x'); t('typing resumes command input and clears highlight', io.reading.buf === 'x' && !io.selectedText()); key(io.kbd, 'Escape');
      io.selectAll(); t('Select all selects terminal text', io.selectedText().includes('Windows PowerShell'));
      io.clearSelection(); io.focus();
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else delete navigator.clipboard;
      document.execCommand = execCommand;
    }
    const cmdtab = host.add('cmd'); t('CMD tab has independent profile', host.tabs.length === 2 && cmdtab.session.kind === 'cmd' && tab.page.hidden);
    await enter(cmdtab, 'echo tab-command'); t('CMD tab input executes', cmdtab.console.text().includes('tab-command'));
    host.select(tab); t('tab switch preserves PS state', tab.session.getVar('tabValue') === 99 && cmdtab.page.hidden && !tab.page.hidden);
    tab.console.insert('Get-Serv'); key(tab.console.kbd, 'Tab', { ctrlKey: true }); t('Ctrl+Tab switches tabs without editing input', host.active === cmdtab && tab.console.reading.buf === 'Get-Serv');
    key(tab.console.kbd, 'Escape');
    key(cmdtab.console.kbd, 't', { ctrlKey: true, shiftKey: true }); t('Ctrl+Shift+T adds tab', host.tabs.length === 3);
    t('new PowerShell tab isolates variables', host.active.session.getVar('tabValue') === null);
    const stopped = host.active; host.remove(stopped); await stopped.done; t('closing tab releases input', stopped.session.exited && !stopped.console.reading && host.tabs.length === 2);
    const nested = host.add('ps'); await enter(nested, 'cmd'); t('nested CMD opens a prompt', nested.console.lineEl.textContent.includes('>') && !nested.console.lineEl.textContent.startsWith('PS '));
    host.remove(nested); await nested.done; t('closing tab stops nested shell', nested.session.exited && !nested.console.reading);
    host.select(cmdtab); await enter(cmdtab, 'exit'); t('exit closes only CMD tab', host.tabs.length === 1 && host.active === tab);
    tab.console.setProgress({ activity: 'Testing', status: 'Working', percent: 50 }); t('progress is visible', tab.console.progressEl.style.display !== 'none'); tab.console.setProgress(null);
    await enter(tab, 'Not-ACommand'); t('PS errors rendered red', [...tab.console.out.querySelectorAll('span')].some(x => x.style.color === 'rgb(231, 72, 86)' && x.textContent.includes('CommandNotFoundException')));
    const secure = tab.console.reading;
    tab.console.selectAll();
    win.close(); await tab.done; t('window close stops all sessions', tab.session.exited && !tab.console.reading && host.tabs.length === 0 && !!secure);
    t('closing terminal releases its retained highlights', !CSS.highlights.has('terminal-selection'));
    // Every menu item and profile launcher is reachable.
    sc = await config(['15']); t('SConfig has 15 menu items', Array.from({ length: 15 }, (_, i) => new RegExp('\\n\\s*' + (i + 1) + '\\)').test(sc.con.text())).every(Boolean));
    const standalone = WS.apps.launch('cmd'); t('CMD app starts CMD profile', standalone.terminal.active.session.kind === 'cmd'); standalone.close();
    const preview = WS.apps.launch('powershell'); const ptab = preview.terminal.active;
    if (shot === 'cmd') { const ct = preview.terminal.add('cmd'); await enter(ct, 'ipconfig /all'); }
    else if (shot === 'sconfig') { ptab.console.insert('sconfig'); key(ptab.console.kbd, 'Enter'); await wait(20); }
    else { await enter(ptab, 'Get-Service | Select-Object -First 8'); preview.terminal.add('cmd'); preview.terminal.select(ptab); }
    t('terminal fits window', preview.terminal.active.console.el.getBoundingClientRect().height > 300 && preview.body.scrollHeight <= preview.body.clientHeight + 1);
  } catch (e) { t('uncaught exception', false, e.stack || e.message); console.error(e); }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
  document.body.dataset.result = `${pass} passed, ${fail} failed`;
})();
