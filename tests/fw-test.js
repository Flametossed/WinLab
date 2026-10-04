/* Windows Defender Firewall with Advanced Security (wf.msc) and firewall.cpl browser workflow; use a fresh profile.
 * &shot=overview|inbound|wizard|ports|predefined|ruleprops|profiles|monitor|cpl|allowed|customize stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, FW = WS.fw, WF = WS.wf;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const title = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
  const button = (label, scope = shade()) => [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(70); };
  const input = (key, scope = shade()) => scope.querySelector(`[data-field="${CSS.escape(key)}"]`);
  const fill = (key, value, scope) => {
    const el = input(key, scope); if (!el) throw new Error('Missing field: ' + key);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(['checkbox', 'radio'].includes(el.type) || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const tab = async label => { const b = [...shade().querySelectorAll('.ps-tab')].find(x => x.textContent === label); if (!b) throw new Error('Missing tab: ' + label); b.click(); await wait(30); };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const item = (items, name) => { const it = items.find(x => x && x.label && WS.ui.plain(x.label) === name); if (!it) throw new Error('Missing menu item: ' + name + ' in ' + items.filter(x => x && x.label).map(x => WS.ui.plain(x.label)).join('|')); return it; };
  const has = (items, name) => items.some(x => x && x.label && WS.ui.plain(x.label) === name);
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async cmd => { const out = []; await ps.execute(cmd, { capture: out }); return out; };
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.text(); };
  const check = c => WS.labs.evalCheck(c, WS.state);
  const byName = n => FW.rules().find(r => r.displayName === n);
  try {
    await wait(250);
    /* ---------------- overview ---------------- */
    t('wf.msc and firewall.cpl are registered', !!WS.apps.get('wf') && !!WS.apps.get('firewall') && !!WS.term.native('wf.msc') && !!WS.term.native('firewall.cpl'));
    const win = WS.apps.launch('wf'), c = win.wf, mmc = c.mmc;
    await wait(80);
    const text = () => win.el.querySelector('.mmc-rbody').textContent;
    t('root is the overview for this computer', mmc.current().id === 'wf-root' && text().includes('Windows Defender Firewall with Advanced Security on Local Computer'));
    t('overview: Public profile is active, on, inbound blocked, outbound allowed', text().includes('Public Profile is Active') && text().includes('Windows Defender Firewall is on.') && text().includes('Inbound connections that do not match a rule are blocked.') && text().includes('Outbound connections that do not match a rule are allowed.'));
    t('tree: Inbound, Outbound, Connection Security Rules, Monitoring', ['Inbound Rules', 'Outbound Rules', 'Connection Security Rules', 'Monitoring'].every(x => win.el.querySelector('.mmc-tree').textContent.includes(x)));
    t('root menu: Import/Export/Restore Default Policy', ['Import Policy...', 'Export Policy...', 'Restore Default Policy'].every(x => has(mmc.scopeMenu(mmc.current()), x)));
    if (stop('overview')) return;

    /* ---------------- rule lists and filters ---------------- */
    c.open('wf-in'); await wait(60);
    const rows = () => mmc.list.rows();
    t('Inbound Rules lists every inbound rule', rows().length === FW.rules({ direction: 'Inbound' }).length && rows().every(r => r.direction === 'Inbound'));
    t('columns show Profile All and Enabled No for Remote Desktop', win.el.textContent.includes('Remote Desktop - User Mode (TCP-In)') && mmc.view().columns[2].value(byName('Remote Desktop - User Mode (TCP-In)')) === 'All');
    const nm = mmc.scopeMenu(mmc.current());
    t('Inbound Rules menu: New Rule..., Filter by Profile/State/Group', ['New Rule...', 'Filter by Profile', 'Filter by State', 'Filter by Group'].every(x => has(nm, x)));
    c.setFilter('Inbound', { state: 'enabled' }); await wait(40);
    t('Filter by Enabled shows only enabled rules, with a header', rows().length > 0 && rows().every(r => r.enabled) && text().includes('Filtered by: Enabled'));
    c.setFilter('Inbound', { group: 'Remote Desktop' }); await wait(40);
    t('Filter by group Remote Desktop', rows().length === 3 && rows().every(r => r.group === 'Remote Desktop'));
    t('Clear All Filters appears while filtered', has(mmc.scopeMenu(mmc.current()), 'Clear All Filters'));
    c.clearFilters('Inbound'); await wait(40);
    t('clearing restores the full list', rows().length === FW.rules({ direction: 'Inbound' }).length);
    if (stop('inbound')) return;
    const ping = () => check({ firewallAllows: { protocol: 'ICMPv4', from: 'CLIENT01' } });
    t('ping from CLIENT01 is blocked by default (the DUFRAG rule is not Echo Request)', !ping());
    const erq = rows().find(r => r.name === 'FPS-ICMP4-ERQ-In');
    mmc.list.select([erq.name]); await wait(20);
    const rm = mmc.view().menu([erq], mmc);
    t('disabled rule offers Enable Rule, Delete', has(rm, 'Enable Rule') && !has(rm, 'Disable Rule') && has(rm, 'Delete'));
    item(rm, 'Enable Rule').action(); await wait(60);
    t('Enable Rule turns on File and Printer Sharing (Echo Request) and ping is allowed', FW.rules().find(r => r.name === 'FPS-ICMP4-ERQ-In').enabled && ping());
    t('Get-NetFirewallRule agrees', (await run('Get-NetFirewallRule -Name FPS-ICMP4-ERQ-In'))[0].Enabled === 'True');

    /* ---------------- New Inbound Rule Wizard: Port ---------------- */
    let wz;
    let busy = c.newRule('Inbound', { onCreate: w => { wz = w; } }); await wait(80);
    t('wizard: New Inbound Rule Wizard with a Steps list', title() === 'New Inbound Rule Wizard' && wz.el.textContent.includes('Steps:') && wz.el.querySelector('.wz-step.cur').textContent === 'Rule Type');
    fill('type-port', true, wz.el); await wait(20);
    if (stop('wizard')) return;
    await click('Next >', wz.el);
    t('Port path steps: Rule Type, Protocol and Ports, Action, Profile, Name', [...wz.el.querySelectorAll('.wz-step')].map(x => x.textContent).join() === 'Rule Type,Protocol and Ports,Action,Profile,Name');
    await click('Next >', wz.el);
    t('specific ports are required', dlgText().includes('Specify at least one port'));
    await click('OK');
    fill('ports', '99999', wz.el); await click('Next >', wz.el);
    t('an out-of-range port is refused', dlgText().includes('The port value is not valid.'));
    await click('OK');
    fill('ports', '8080', wz.el);
    if (stop('ports')) return;
    await click('Next >', wz.el);
    t('Action page: Allow, Allow if secure (unavailable), Block', wz.page.id === 'action' && input('action-Allow', wz.el).checked && input('action-Secure', wz.el).disabled);
    await click('Next >', wz.el);
    fill('profile-Domain', false, wz.el); fill('profile-Private', false, wz.el); fill('profile-Public', false, wz.el); await click('Next >', wz.el);
    t('at least one profile is required', dlgText().includes('at least one profile'));
    await click('OK');
    fill('profile-Domain', true, wz.el); fill('profile-Private', true, wz.el); await click('Next >', wz.el);
    t('the last page has Finish', wz.page.id === 'name' && !!button('Finish', wz.el));
    await click('Finish', wz.el);
    t('a name is required', dlgText().includes('You must enter a name for the rule.'));
    await click('OK');
    fill('name', 'Contoso Web App', wz.el); fill('description', 'Port 8080 for the line-of-business app', wz.el);
    await click('Finish', wz.el); await busy; await wait(80);
    let web = byName('Contoso Web App');
    t('rule created: inbound TCP 8080, Domain and Private, Allow', web && web.direction === 'Inbound' && web.protocol === 'TCP' && web.localPort === '8080' && web.profile === 'Domain, Private' && web.action === 'Allow' && web.enabled);
    t('the console selects the new rule', mmc.list.selected().length === 1 && mmc.list.selected()[0].name === web.name);
    t('TCP 8080 stays blocked on the Public profile', !check({ firewallAllows: { protocol: 'TCP', port: 8080, from: 'CLIENT01' } }));
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    FW.setNetworkCategory('Private'); await wait(40);
    t('and is allowed once the network is Private', check({ firewallAllows: { protocol: 'TCP', port: 8080, from: 'CLIENT01' } }));
    t('firewallRule helper sees it', check({ firewallRule: { displayName: 'Contoso Web App', localPort: '8080', action: 'Allow', enabled: true } }));

    /* ---------------- Predefined, Program and Custom rules ---------------- */
    busy = c.newRule('Inbound', { onCreate: w => { wz = w; } }); await wait(60);
    fill('type-predefined', true, wz.el); fill('group', 'Remote Desktop', wz.el); await click('Next >', wz.el);
    t('Predefined Rules lists the group with Rule Exists', wz.page.id === 'predefined' && wz.el.textContent.includes('Remote Desktop - User Mode (UDP-In)') && wz.el.textContent.includes('Rule Exists'));
    t('Predefined path: Rule Type, Predefined Rules, Action', [...wz.el.querySelectorAll('.wz-step')].map(x => x.textContent).join() === 'Rule Type,Predefined Rules,Action');
    if (stop('predefined')) return;
    fill('pre-RemoteDesktop-Shadow-In-TCP', false, wz.el);
    await click('Next >', wz.el); await click('Finish', wz.el); await busy; await wait(60);
    t('checked predefined rules are enabled; the unchecked one is not', FW.rules().find(r => r.name === 'RemoteDesktop-UserMode-In-TCP').enabled && FW.rules().find(r => r.name === 'RemoteDesktop-UserMode-In-UDP').enabled && !FW.rules().find(r => r.name === 'RemoteDesktop-Shadow-In-TCP').enabled);
    t('RDP is now reachable from CLIENT01', check({ firewallAllows: { protocol: 'TCP', port: 3389, from: 'CLIENT01' } }));

    busy = c.newRule('Inbound', { onCreate: w => { wz = w; } }); await wait(60);
    await click('Next >', wz.el);
    fill('program-this', true, wz.el); await click('Next >', wz.el);
    t('This program needs a path', dlgText().includes('Specify the path to a program'));
    await click('OK');
    fill('path', 'C:\\Apps\\Inventory\\inventory.exe', wz.el); await click('Next >', wz.el); await click('Next >', wz.el); await click('Next >', wz.el);
    fill('name', 'Inventory Service', wz.el); await click('Finish', wz.el); await busy; await wait(40);
    const inv = byName('Inventory Service');
    t('program rule stores the program and matches only that program', inv && inv.program === 'C:\\Apps\\Inventory\\inventory.exe' && inv.protocol === 'Any' && FW.allows('Inbound', 'TCP', 9000, { program: 'C:\\Apps\\Inventory\\inventory.exe' }) && !FW.allows('Inbound', 'TCP', 9000, {}));

    busy = c.newRule('Outbound', { onCreate: w => { wz = w; } }); await wait(60);
    t('outbound wizard title', title() === 'New Outbound Rule Wizard');
    fill('type-custom', true, wz.el); await click('Next >', wz.el);
    t('Custom path: Rule Type, Program, Protocol and Ports, Scope, Action, Profile, Name', [...wz.el.querySelectorAll('.wz-step')].map(x => x.textContent).join() === 'Rule Type,Program,Protocol and Ports,Scope,Action,Profile,Name');
    await click('Next >', wz.el);
    fill('protocol', 'TCP', wz.el); fill('remoteport-kind', 'some', wz.el); fill('remoteports', '23', wz.el);
    await click('Next >', wz.el);
    t('Scope page has local and remote address lists', wz.page.id === 'scope' && !!input('local-any', wz.el) && !!input('remote-these', wz.el));
    await click('Next >', wz.el);
    fill('action-Block', true, wz.el); await click('Next >', wz.el); await click('Next >', wz.el);
    fill('name', 'Block Telnet', wz.el); await click('Finish', wz.el); await busy; await wait(40);
    const tel = byName('Block Telnet');
    t('custom outbound block rule on remote port 23', tel && tel.direction === 'Outbound' && tel.remotePort === '23' && tel.localPort === 'Any' && tel.action === 'Block');
    t('outbound Telnet is blocked, other outbound traffic still allowed', !FW.allows('Outbound', 'TCP', 23) && FW.allows('Outbound', 'TCP', 443));

    /* ---------------- rule Properties ---------------- */
    let sheet;
    busy = WF.ruleProperties(web.name, { onCreate: s => { sheet = s; } }); await wait(60);
    t('rule Properties has the eight tabs', [...shade().querySelectorAll('.ps-tab')].map(x => x.textContent).join() === 'General,Programs and Services,Remote Computers,Protocols and Ports,Scope,Advanced,Local Principals,Remote Users');
    fill('name', 'Contoso Web App (8080/8443)');
    await tab('Protocols and Ports'); fill('localports', '8080,8443');
    await tab('Scope'); fill('remote-these', true);
    if (stop('ruleprops')) return;
    const adding = (async () => { input('remote-add').click(); await wait(60); shade().querySelector('input').value = '192.168.1.0/24'; await click('OK'); })();
    await adding;
    await tab('Advanced'); fill('profile-Private', false);
    sheet.ok(); await busy; await wait(60);
    web = FW.rules().find(r => r.name === web.name);
    t('Properties applied: name, ports, remote scope, profile', web.displayName === 'Contoso Web App (8080/8443)' && web.localPort === '8080,8443' && web.remoteAddress === '192.168.1.0/24' && web.profile === 'Domain');
    FW.setRule(web.name, { profile: ['Domain', 'Private'] });
    t('scope: CLIENT01 is inside 192.168.1.0/24, 10.0.0.5 is not', FW.allows('Inbound', 'TCP', 8443, { from: '192.168.1.50' }) && !FW.allows('Inbound', 'TCP', 8443, { from: '10.0.0.5' }));
    busy = WF.ruleProperties('RemoteDesktop-UserMode-In-TCP'); await wait(60);
    t('a predefined rule says so and keeps its name read-only', dlgText().includes('This is a predefined rule and some of its properties cannot be modified.') && input('name').readOnly);
    await tab('Protocols and Ports');
    t('predefined protocol and ports cannot be changed', input('protocol').disabled && input('localports').disabled);
    await click('Cancel'); await busy;
    busy = WF.ruleProperties(web.name); await wait(60);
    await tab('Scope'); fill('remote-these', true);
    await tab('Protocols and Ports'); fill('localport-kind', 'some'); fill('localports', '70000');
    await click('OK'); await wait(60);
    t('invalid port in Properties is refused and the sheet stays open', dlgText().includes('The port is not valid') || dlgText().includes('not valid'));
    await click('OK'); await click('Cancel'); await busy;

    /* ---------------- firewall Properties (profiles) ---------------- */
    let lg;
    busy = WF.firewallProperties({ onCreate: s => { sheet = s; }, onLogging: f => { lg = f; } }); await wait(60);
    t('Properties opens on the active (Private) profile tab with four tabs', [...shade().querySelectorAll('.ps-tab')].map(x => x.textContent).join() === 'Domain Profile,Private Profile,Public Profile,IPsec Settings' && shade().querySelector('.ps-tab.sel').textContent === 'Private Profile');
    fill('Private-inbound', 'BlockAll');
    input('Private-logging').click(); await wait(60);
    t('logging dialog for the profile', title() === 'Customize Logging Settings for the Private Profile' && input('logfile').value.includes('pfirewall.log'));
    fill('logsize', '99999'); await click('OK');
    t('log size limit is validated', dlgText().includes('between 1 and 32767'));
    await click('OK');
    fill('logsize', '16384'); fill('logdropped', 'yes'); await click('OK');
    if (stop('profiles')) return;
    sheet.ok(); await busy; await wait(60);
    const pv = FW.profile('Private');
    t('Block all connections and logging applied', pv.blockAll && pv.logMaxKB === 16384 && pv.logDropped);
    t('Block all connections overrides the allow rules', !check({ firewallAllows: { protocol: 'TCP', port: 3389, from: 'CLIENT01' } }));
    t('Get-NetFirewallProfile reports it', (await run('Get-NetFirewallProfile -Name Private'))[0].AllowInboundRules === 'False' && (await run('Get-NetFirewallProfile -Name Private'))[0].LogMaxSizeKilobytes === 16384);
    t('netsh advfirewall show privateprofile reports it', (await crun('netsh advfirewall show privateprofile')).includes('BlockInboundAlways,AllowOutbound') && cmdc.text().includes('MaxFileSize                           16384'));
    t('firewallProfile helper', check({ firewallProfile: { name: 'Private', blockAll: true, logDropped: true, minLogMaxKB: 16384 } }));
    await run('Set-NetFirewallProfile -Profile Private -AllowInboundRules True'); await wait(30);
    t('Set-NetFirewallProfile -AllowInboundRules True clears it', !FW.profile('Private').blockAll);

    /* ---------------- Monitoring ---------------- */
    c.open('wf-mon'); await wait(60);
    t('Monitoring shows the active profile and logging settings', text().includes('Private Profile is Active') && text().includes('File maximum size (KB):16384') && text().includes('Log dropped packets:Yes'));
    c.open('wf-mon-fw'); await wait(60);
    t('Monitoring > Firewall lists enabled rules for the active profile', rows().length > 0 && rows().every(r => r.enabled && (r.profile === 'Any' || r.profile.includes('Private'))) && rows().some(r => r.name === web.name));
    c.open('wf-mon-mm'); await wait(40);
    t('security associations are empty', rows().length === 0);
    if (stop('monitor')) return;

    /* ---------------- PowerShell / netsh share the model ---------------- */
    await run('Set-NetFirewallRule -DisplayName "Block Telnet" -RemotePort 23,2323');
    t('Set-NetFirewallRule goes through the model', byName('Block Telnet').remotePort === '23,2323' && !FW.allows('Outbound', 'TCP', 2323));
    await run('Set-NetFirewallRule -DisplayName "Block Telnet" -RemoteAddress 999.1.1.1');
    t('an invalid address is refused', byName('Block Telnet').remoteAddress === 'Any' && ps.lastSuccess === false);
    t('netsh add rule with remoteip', (await crun('netsh advfirewall firewall add rule name="SQL" dir=in action=allow protocol=TCP localport=1433 remoteip=192.168.1.0/24')).includes('Ok.') && byName('SQL').remoteAddress === '192.168.1.0/24');
    t('netsh export writes a policy file', (await crun('netsh advfirewall export C:\\fw.wfw')).includes('Ok.') && WS.fs.exists('C:\\fw.wfw'));
    FW.removeRule(byName('SQL').name); await crun('netsh advfirewall import C:\\fw.wfw');
    t('netsh import restores it', !!byName('SQL'));
    busy = WF.restoreDefaults(); await wait(60);
    t('Restore Default Policy asks first', dlgText().includes('Are you sure you want to restore the default policy?'));
    await click('Yes'); await busy; await wait(60);
    t('defaults restored: custom rules gone, ICMP echo disabled again', !byName('SQL') && !byName('Block Telnet') && !FW.rules().find(r => r.name === 'FPS-ICMP4-ERQ-In').enabled && !FW.profile('Private').logDropped);
    win.close();

    /* ---------------- firewall.cpl ---------------- */
    const cpl = WS.apps.launch('firewall'), fc = cpl.firewallcpl; await wait(60);
    const ctext = () => cpl.el.textContent;
    t('control panel home: the private network is connected', ctext().includes('Help protect your PC with Windows Defender Firewall') && ctext().includes('Private networks') && ctext().includes('Connected') && ctext().includes('Windows Defender Firewall state:On'));
    t('left pane links', ['Allow an app or feature through Windows Defender Firewall', 'Turn Windows Defender Firewall on or off', 'Restore defaults', 'Advanced settings'].every(x => ctext().includes(x)));
    if (stop('cpl')) return;
    fc.go('allowed'); await wait(40);
    t('Allowed apps: boxes locked until Change settings', input('app-File and Printer Sharing-Private', cpl.el).disabled && ctext().includes('Allowed apps and features:'));
    fc.changeSettings(); await wait(30);
    fill('app-File and Printer Sharing-Private', true, cpl.el); await wait(30);
    t('ticking a profile ticks the app', input('app-File and Printer Sharing-on', cpl.el).checked);
    if (stop('allowed')) return;
    input('ok', cpl.el).click(); await wait(60);
    const fps = WS.firewallcpl.allowedApps().find(a => a.group === 'File and Printer Sharing');
    t('OK allows File and Printer Sharing on Private only', fps.Private && !fps.Public && !fps.Domain && FW.rules({ group: 'File and Printer Sharing' }).every(r => r.enabled && r.profile === 'Private'));
    t('SMB from CLIENT01 is allowed on the Private network', check({ firewallAllows: { protocol: 'TCP', port: 445, from: 'CLIENT01' } }) && check({ firewallAllows: { protocol: 'ICMPv4', from: 'CLIENT01' } }));
    fc.go('customize'); await wait(40);
    fill('Public-off', true, cpl.el);
    if (stop('customize')) return;
    input('ok', cpl.el).click(); await wait(60);
    t('turning off the Public firewall shows the warning', !FW.profile('Public').enabled && ctext().includes('Update your Firewall settings'));
    input('recommended', cpl.el).click(); await wait(60);
    t('Use recommended settings turns it back on', FW.profile('Public').enabled && !ctext().includes('Update your Firewall settings'));
    fc.go('restore'); await wait(30);
    busy = fc.restore(); await wait(60); await click('Yes'); await busy; await wait(40);
    t('Restore defaults through the control panel', !FW.rules({ group: 'File and Printer Sharing' }).some(r => r.enabled) && fc.page() === 'home');
    cpl.close();
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
