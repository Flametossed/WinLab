/* Network Connections (ncpa.cpl), its dialogs and the Network and Sharing Center; use a fresh profile.
 * &shot=connections|status|details|props|ipv4|advanced|center stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, N = WS.net, NC = WS.ncpa;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const dlgText = () => (shade() ? shade().textContent : '');
  const title = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
  const button = (label, scope = shade()) => [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label + ' in ' + (scope || shade() || {}).textContent); b.click(); await wait(70); };
  const input = (key, scope = shade()) => scope.querySelector(`[data-field="${CSS.escape(key)}"]`);
  const fill = (key, value, scope) => {
    const el = input(key, scope); if (!el) throw new Error('Missing field: ' + key);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = value; else el.value = value;
    el.dispatchEvent(new Event(['checkbox', 'radio'].includes(el.type) || el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  const tab = async label => { const b = [...shade().querySelectorAll('.ps-tab')].find(x => x.textContent === label); if (!b) throw new Error('Missing tab: ' + label); b.click(); await wait(30); };
  const tabs = () => [...shade().querySelectorAll('.ps-tab')].filter(x => x.style.display !== 'none').map(x => x.textContent).join();
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const item = (items, name) => { const it = items.find(x => x && x.label && WS.ui.plain(x.label) === name); if (!it) throw new Error('Missing menu item: ' + name); return it; };
  const ps = new WS.ps.Session({ console: new WS.term.TextConsole() });
  const run = async cmd => { const out = []; await ps.execute(cmd, { capture: out }); return out; };
  const cmdc = new WS.term.TextConsole(), cmd = new WS.term.CmdSession({ console: cmdc });
  const crun = async line => { cmdc.clear(); await cmd.execute(line); return cmdc.text(); };
  const A = () => N.adapter();
  try {
    await wait(250);
    /* ---------------- Network Connections window ---------------- */
    t('ncpa.cpl and the Network and Sharing Center are registered', !!WS.apps.get('ncpa') && !!WS.apps.get('netcenter') && !!WS.term.native('ncpa.cpl'));
    const win = WS.apps.launch('ncpa'), c = win.ncpa; await wait(60);
    const tile = () => win.el.querySelector('.nc-tile');
    t('the Ethernet tile shows its network and adapter', tile().textContent === 'EthernetNetworkMicrosoft Hyper-V Network Adapter' && win.el.textContent.includes('1 item'));
    c.select('Ethernet'); await wait(30);
    t('selecting it fills the command bar', ['Disable this network device', 'Diagnose this connection', 'Rename this connection', 'View status of this connection', 'Change settings of this connection'].every(x => c.commands().includes(x)));
    const m = c.menu();
    t('right-click menu: Disable, Status, Diagnose, Bridge, Rename, Properties', ['Disable', 'Status', 'Diagnose', 'Bridge Connections', 'Rename', 'Properties'].every(x => m.some(i => i.label && WS.ui.plain(i.label) === x)) && item(m, 'Bridge Connections').disabled);
    if (stop('connections')) return;

    /* ---------------- Status and Details ---------------- */
    let busy = NC.status('Ethernet'); await wait(60);
    t('Ethernet Status: Internet, Enabled, 10.0 Gbps', title() === 'Ethernet Status' && dlgText().includes('IPv4 Connectivity:Internet') && dlgText().includes('Media State:Enabled') && dlgText().includes('Speed:10.0 Gbps') && dlgText().includes('Bytes:'));
    if (stop('status')) return;
    let det;
    const detBusy = NC.details('Ethernet', { onDetails: f => { det = f; } }); await wait(60);
    const dr = k => (det.rows.find(r => r[0] === k) || [])[1];
    t('Details: DHCP lease from the router', title() === 'Network Connection Details' && dr('DHCP Enabled') === 'Yes' && dr('IPv4 DHCP Server') === '192.168.1.1' && /^192\.168\.1\.1\d\d$/.test(dr('IPv4 Address')) && !!dr('Lease Obtained') && dr('Physical Address') === A().mac);
    if (stop('details')) return;
    await click('Close'); await detBusy; await click('Close'); await busy;

    /* ---------------- Ethernet Properties and IPv4 ---------------- */
    let pf, v4, adv;
    const hooks = { onCreate: f => { pf = f; }, onIpv4: f => { v4 = f; }, onAdvanced: f => { adv = f; } };
    busy = NC.properties('Ethernet', hooks); await wait(60);
    const binds = () => [...shade().querySelectorAll('.nc-bind')].map(x => x.textContent);
    t('Ethernet Properties: Networking and Sharing, the adapter and nine items', title() === 'Ethernet Properties' && tabs() === 'Networking,Sharing' && dlgText().includes('Microsoft Hyper-V Network Adapter') && binds().length === 9);
    t('items are checked except the Multiplexor protocol', input('bind-ms_tcpip').checked && input('bind-ms_tcpip6').checked && !input('bind-ms_implat').checked);
    pf.select('ms_tcpip'); await wait(20);
    t('selecting IPv4 shows its description and enables Properties', dlgText().includes('The default wide area network protocol') && !input('item-properties').disabled);
    if (stop('props')) return;
    let ipBusy = pf.openItem(); await wait(80);
    t('IPv4 Properties opens on DHCP with the Alternate Configuration tab', title() === 'Internet Protocol Version 4 (TCP/IPv4) Properties' && input('ip-auto').checked && input('dns-auto').checked && tabs() === 'General,Alternate Configuration');
    fill('ip-manual', true); await wait(20);
    t('a static address forces manual DNS and hides Alternate Configuration', input('dns-manual').checked && input('dns-auto').disabled && !input('ip').disabled && tabs() === 'General');
    await click('OK');
    t('a static address needs an IP address', dlgText().includes('You must enter an IP address.'));
    await click('OK');
    fill('ip', '192.168.1.10'); input('mask').dispatchEvent(new Event('focus'));
    t('the subnet mask fills in from the address class', input('mask').value === '255.255.255.0');
    fill('gateway', '10.0.0.1'); await click('OK');
    t('a gateway outside the subnet asks first', dlgText().includes('The default gateway is not on the same network segment'));
    await click('No');
    fill('ip', '192.168.1.0'); fill('gateway', '192.168.1.1'); await click('OK');
    t('the network address itself is refused', dlgText().includes('All of the bits in the host address portion of the IP address are set to 0'));
    await click('OK');
    fill('ip', '192.168.1.10'); fill('dns1', '192.168.1.1'); fill('dns2', '8.8.8.8');
    if (stop('ipv4')) return;
    await click('OK'); await ipBusy; await wait(40);
    t('after IPv4 OK, Cancel becomes Close and nothing is applied yet', pf.cancelBtn.textContent === 'Close' && A().dhcp);
    await click('OK'); await busy; await wait(60);
    t('OK applies the static address and DNS servers', !A().dhcp && A().ip === '192.168.1.10' && A().prefix === 24 && A().gateway === '192.168.1.1' && A().dnsServers.join() === '192.168.1.1,8.8.8.8');
    const ipc = await crun('ipconfig'), gip = await run('Get-NetIPAddress -AddressFamily IPv4');
    t('ipconfig and Get-NetIPAddress agree', /IPv4 Address[ .]*: 192.168.1.10/.test(ipc) && gip.some(o => o.IPAddress === '192.168.1.10' && o.PrefixOrigin === 'Manual'), { ipc: ipc.slice(0, 600), gip: gip.map(o => [o.IPAddress, o.PrefixOrigin]) });
    t('the tile still shows Network and the internet is reachable', tile().textContent.includes('Network') && NC.connectivity(A()) === 'Internet');

    /* ---------------- Advanced TCP/IP Settings ---------------- */
    busy = NC.properties('Ethernet', hooks); await wait(60);
    pf.select('ms_tcpip'); ipBusy = pf.openItem(); await wait(60);
    t('reopened IPv4 Properties shows the static settings', input('ip-manual').checked && input('ip').value === '192.168.1.10' && input('dns2').value === '8.8.8.8');
    input('advanced').click(); await wait(60);
    t('Advanced TCP/IP Settings: IP Settings, DNS, WINS', title() === 'Advanced TCP/IP Settings' && tabs() === 'IP Settings,DNS,WINS' && dlgText().includes('192.168.1.10255.255.255.0'));
    await tab('DNS');
    const dnsList = () => [...input('dns-list').options].map(o => o.value).join();
    t('DNS tab lists the servers in order', dnsList() === '192.168.1.1,8.8.8.8');
    input('dns-list').selectedIndex = 1; input('dns-up').click(); await wait(20);
    t('moving a server up changes the order', dnsList() === '8.8.8.8,192.168.1.1');
    const adding = (async () => { input('dns-add').click(); await wait(60); shade().querySelector('input').value = '1.1.1.1'; await click('Add'); })();
    await adding; await wait(20);
    fill('suffix', 'bad_suffix!');
    await click('OK');
    t('an invalid DNS suffix is refused', dlgText().includes('The DNS suffix is not valid.'));
    await click('OK');
    fill('suffix', 'lab.local'); fill('register', false);
    if (stop('advanced')) return;
    await click('OK'); await wait(60);
    t('the IPv4 page shows the new first two servers', input('dns1').value === '8.8.8.8' && input('dns2').value === '192.168.1.1');
    await click('OK'); await ipBusy; await wait(30);
    await click('Close'); await busy; await wait(60);
    t('Close applies: three DNS servers in order, the suffix, no DNS registration', A().dnsServers.join() === '8.8.8.8,192.168.1.1,1.1.1.1' && A().dnsSuffix === 'lab.local' && A().registerDns === false);
    const dc = (await run('Get-DnsClient -InterfaceAlias Ethernet'))[0];
    t('Get-DnsClient reports the suffix and registration', dc.ConnectionSpecificSuffix === 'lab.local' && dc.RegisterThisConnectionsAddress === false);

    /* ---------------- bindings ---------------- */
    busy = NC.properties('Ethernet', hooks); await wait(60);
    fill('bind-ms_tcpip6', false); await click('OK'); await busy; await wait(40);
    t('unbinding IPv6 removes the link-local address', !N.bound(A(), 'ms_tcpip6') && !(await crun('ipconfig')).includes('Link-local IPv6') && (await run('Get-NetAdapterBinding -Name Ethernet -ComponentID ms_tcpip6'))[0].Enabled === false);
    t('adapter helper checks bindings', WS.labs.evalCheck({ adapter: { bindings: { ms_tcpip6: false, ms_tcpip: true } } }, WS.state));
    await run('Disable-NetAdapterBinding -Name Ethernet -ComponentID ms_tcpip');
    t('without TCP/IPv4 ping fails with General failure', (await crun('ping -n 1 192.168.1.1')).includes('General failure') && NC.verdict(A())[0].includes('Internet Protocol Version 4 (TCP/IPv4)'));
    await run('Enable-NetAdapterBinding -Name Ethernet -ComponentID ms_tcpip,ms_tcpip6');
    t('Enable-NetAdapterBinding restores both', N.bound(A(), 'ms_tcpip') && N.bound(A(), 'ms_tcpip6') && (await crun('ping -n 1 192.168.1.1')).includes('Reply from 192.168.1.1'));

    /* ---------------- back to DHCP, with an alternate configuration ---------------- */
    WS.state.network.lan.dhcp.enabled = false;
    busy = NC.properties('Ethernet', hooks); await wait(60);
    pf.select('ms_tcpip'); ipBusy = pf.openItem(); await wait(60);
    fill('ip-auto', true); fill('dns-auto', true); await wait(20);
    t('choosing automatic brings Alternate Configuration back', tabs() === 'General,Alternate Configuration');
    await tab('Alternate Configuration');
    fill('alt-user', true); fill('alt-ip', '192.168.1.77'); fill('alt-mask', '255.255.255.0'); fill('alt-gateway', '192.168.1.1'); fill('alt-dns1', '192.168.1.1');
    await click('OK'); await ipBusy; await click('OK'); await busy; await wait(60);
    t('with no DHCP server the alternate configuration is used', A().dhcp && A().ip === '192.168.1.77' && A().gateway === '192.168.1.1' && A().dnsServers.join() === '192.168.1.1');
    N.setAlternate('Ethernet', null); await wait(30);
    t('without one Windows falls back to APIPA, shown as Unidentified network', /^169\.254\./.test(A().ip) && tile().textContent.includes('Unidentified network') && NC.connectivity(A()) === 'No network access');
    WS.state.network.lan.dhcp.enabled = true; N.renew('Ethernet'); await wait(40);
    t('renewing with the router back gives a DHCP lease', /^192\.168\.1\.1\d\d$/.test(A().ip));

    /* ---------------- rename, disable, diagnose ---------------- */
    c.rename('Ethernet'); await wait(60);
    const ren = win.el.querySelector('[data-field="rename"]'); ren.value = 'LAN';
    ren.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(60);
    t('inline rename renames the connection', !!N.adapter('LAN') && tile().textContent.startsWith('LAN'));
    await run('Rename-NetAdapter -Name LAN -NewName Ethernet'); await wait(40);
    t('Rename-NetAdapter shows in the window', tile().textContent.startsWith('Ethernet'));
    c.select('Ethernet'); item(c.menu(), 'Disable').action(); await wait(60);
    t('Disable greys the tile and offers Enable', tile().classList.contains('off') && tile().textContent.includes('Disabled') && !!c.menu().find(i => i.label && WS.ui.plain(i.label) === 'Enable') && item(c.menu(), 'Status').disabled);
    tile().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(60);
    t('double-clicking a disabled connection enables it', A().enabled);
    N.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.254' }); N.setDnsServers('Ethernet', ['192.168.1.1']); await wait(30);
    busy = NC.diagnose('Ethernet'); await wait(700);
    t('Diagnose finds the unavailable default gateway', dlgText().includes('The default gateway is not available'));
    await click('OK'); await busy;

    /* ---------------- Network and Sharing Center, Server Manager link ---------------- */
    const cen = WS.apps.launch('netcenter'); await wait(60);
    t('Network and Sharing Center shows the active network', cen.el.textContent.includes('View your active networks') && cen.el.textContent.includes('Public network') && cen.el.textContent.includes('Connections:Ethernet') && cen.el.textContent.includes('Change adapter settings'));
    N.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' }); await wait(40);
    t('and updates as the network changes', cen.el.textContent.includes('Access type:Internet'));
    if (stop('center')) return;
    cen.close(); win.close();
    const sm = WS.sm.open('local'); await wait(150);
    const link = [...sm.el.querySelectorAll('a, .sm-link, [class*=link]')].find(x => x.textContent.includes('192.168.1.10'));
    if (link) link.click(); await wait(60);
    t('Server Manager > Local Server > Ethernet opens Network Connections', !!link && !!WS.wm.find('ncpa'));
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
