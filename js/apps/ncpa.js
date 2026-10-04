/* Network Connections (ncpa.cpl) and the Network and Sharing Center. Every setting goes through WS.net - the model
 * New-NetIPAddress, Set-DnsClientServerAddress, netsh and sconfig use - so ipconfig and Get-NetIPAddress agree at once.
 *   ncpa:      the adapter window (tiles, command bar, right-click: Disable/Enable, Status, Diagnose, Rename, Properties)
 *   status(name)       "Ethernet Status" (Details..., Properties, Disable, Diagnose)
 *   details(name)      "Network Connection Details"
 *   properties(name)   "Ethernet Properties": Networking (bindings, Configure...) | Sharing. IPv4/IPv6 and binding changes are
 *                      staged and applied when this dialog closes with OK, as on Windows; after a protocol dialog is OK'd,
 *                      Cancel becomes Close (and still applies, as Windows does).
 *   ipv4(state, opts)  "Internet Protocol Version 4 (TCP/IPv4) Properties": General | Alternate Configuration; Advanced...
 *   advanced(state)    "Advanced TCP/IP Settings": IP Settings | DNS | WINS
 *   diagnose(name)     Windows Network Diagnostics' verdict
 * All dialogs take opts.onCreate(frame) and controls carry data-field names for tests. App ids: ncpa, netcenter. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, F = WS.ui.f, N = WS.net;
  const TCPIP = 'Microsoft TCP/IP';
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const NIC = (screen, cable, badge = '') => s16(`<rect x="1.5" y="2" width="9" height="7" rx=".8" fill="#5b6b7d"/><rect x="2.5" y="3" width="7" height="5" fill="${screen}"/><path d="M6 9v2.5h7.5V7" fill="none" stroke="${cable}" stroke-width="1.4"/><rect x="11.5" y="4.5" width="4" height="3" rx=".5" fill="${cable}"/>${badge}`);
  const XB = '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M10.7 10.7l2.6 2.6M13.3 10.7l-2.6 2.6" stroke="#fff" stroke-width="1"/>';
  const ICON = { app: NIC('#9fc1e3', '#2f7fd8'), on: NIC('#9fc1e3', '#2f7fd8'), off: NIC('#c8c8c8', '#9a9a9a'), unplugged: NIC('#9fc1e3', '#2f7fd8', XB),
    item: s16('<rect x="2" y="3" width="12" height="9" rx="1" fill="#e8eef6" stroke="#6b7c8f"/><path d="M4 6h8M4 8.5h5" stroke="#2f7fd8"/>'), proto: s16('<circle cx="8" cy="8" r="5.5" fill="#2fb34b"/><path d="M5 8h6M8 5v6" stroke="#fff" stroke-width="1.3"/>'),
    service: s16('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="#f2b631"/><path d="M5 8h6" stroke="#fff" stroke-width="1.6"/>'), client: s16('<circle cx="8" cy="5.5" r="2.6" fill="#2f7fd8"/><path d="M3 14c0-3 2.2-5 5-5s5 2 5 5z" fill="#2f7fd8"/>'),
    sent: s16('<rect x="1" y="3" width="8" height="6" rx=".7" fill="#5b6b7d"/><rect x="2" y="4" width="6" height="4" fill="#9fc1e3"/><path d="M3 12h4M5 9v3" stroke="#5b6b7d"/>'),
    shield: s16('<path d="M8 1.5l5 2v4c0 3-2 5.4-5 6.6-3-1.2-5-3.6-5-6.6v-4z" fill="#2f7fd8"/><path d="M8 1.5v12.6c3-1.2 5-3.6 5-6.6v-4z" fill="#f2b631"/>') };
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = (msg, title = TCPIP) => WS.ui.msgbox({ title, icon: 'error', message: msg });
  const ipBox = (name, value, o = {}) => { const el = field(name, F.text({ value: value || '', width: 140, disabled: o.disabled, maxLength: 15 })); el.classList.add('nc-ip'); return el; };
  const classful = ip => { const a = +String(ip).split('.')[0]; return a < 128 ? '255.0.0.0' : a < 192 ? '255.255.0.0' : '255.255.255.0'; };
  /** Windows fills the subnet mask from the address class when you click into an empty mask box. */
  const autoMask = (ipEl, maskEl) => maskEl.addEventListener('focus', () => { if (!maskEl.value.trim() && U.isValidIp(ipEl.value.trim())) maskEl.value = classful(ipEl.value.trim()); });

  /** A small tabbed dialog with OK/Cancel (no Apply), as the network dialogs have. */
  function tabDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 420, className: 'w32-dlg nc-dlg psheet', closeValue: null });
    const tabsEl = h('div.ps-tabs'), pagesEl = h('div.ps-pages');
    frame.body.appendChild(h('div.w32.ps', tabsEl, pagesEl));
    const tabs = o.tabs.filter(Boolean).map(t => ({ ...t, el: null }));
    let cur = -1;
    const btns = tabs.map((t, i) => { const b = h('div.ps-tab', { onClick: () => show(i) }, t.label); tabsEl.appendChild(b); return b; });
    function show(i) {
      if (i === cur) return;
      cur = i;
      btns.forEach((b, j) => b.classList.toggle('sel', j === i));
      tabs.forEach(t => { if (t.el) t.el.style.display = 'none'; });
      const t = tabs[i];
      if (!t.el) { t.el = h('div.ps-page', t.render()); pagesEl.appendChild(t.el); }
      t.el.style.display = '';
    }
    let busy = false;
    const ok = async () => { if (busy) return; busy = true; try { const r = await o.ok(); if (r !== false) frame.close(r === undefined ? true : r); } finally { busy = false; } };
    const okBtn = h('button.btn.primary', { onClick: ok }, 'OK');
    const cancelBtn = h('button.btn', { onClick: () => (o.cancel ? o.cancel(frame) : frame.close(null)) }, 'Cancel');
    frame.footer.append(okBtn, cancelBtn);
    frame.onEnter = ok; frame.onEscape = () => cancelBtn.click();
    Object.assign(frame, { ok, show: label => show(Math.max(0, tabs.findIndex(t => t.label === label))), okBtn, cancelBtn, tabEls: btns });
    show(Math.max(0, tabs.findIndex(t => t.label === o.initialTab)));
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /* ================================================================ status, details, diagnose */
  function connectivity(a) {
    if (!a.enabled) return 'Disabled';
    if (!N.usable(a) || !a.ip || /^169\.254\./.test(a.ip) || a.ip === '0.0.0.0') return 'No network access';
    if (N.ping('8.8.8.8', 1).ok) return 'Internet';
    return 'No Internet access';
  }
  /** The network name Windows shows under the connection name. */
  function networkName(a) {
    if (!a.enabled) return 'Disabled';
    if (!a.connected) return 'Network cable unplugged';
    if (!N.usable(a) || !a.ip || /^169\.254\./.test(a.ip)) return 'Unidentified network';
    return WS.sys.isDC() && WS.state.system.domain ? WS.state.system.domain : 'Network';
  }
  const uptime = () => Math.max(1, Math.floor((Date.now() - new Date(WS.state.system.lastBoot || Date.now() - 600e3)) / 1000));
  const hms = s => { const d = Math.floor(s / 86400), r = s % 86400; const t = [Math.floor(r / 3600), Math.floor(r % 3600 / 60), r % 60].map(x => String(x).padStart(2, '0')).join(':'); return d ? `${d} day${d > 1 ? 's' : ''} ${t}` : t; };
  function status(name, opts = {}) {
    const a = N.adapter(name);
    if (!a) return Promise.resolve(null);
    const frame = WS.ui.modal({ title: `${a.name} Status`, width: 380, className: 'w32-dlg nc-dlg psheet', closeValue: null });
    const s = uptime(), sent = 182340 + s * 913, recv = 524117 + s * 2287;
    const v6 = 'No network access';   // the lab network has no IPv6 router
    const row = (k, v) => h('div.nc-kv', h('span', k), h('span', v));
    const content = h('div.w32.ps', h('div.ps-tabs', h('div.ps-tab.sel', 'General')), h('div.ps-pages', h('div.ps-page',
      F.group('Connection', row('IPv4 Connectivity:', connectivity(a)), row('IPv6 Connectivity:', v6), row('Media State:', a.enabled ? 'Enabled' : 'Disabled'),
        row('Duration:', hms(s)), row('Speed:', String(a.linkSpeed || '10 Gbps').replace(/^(\d+) /, '$1.0 ')),
        h('div.nc-btnrow', field('details', F.button('Details...', () => details(a.name, opts))))),
      F.group('Activity', h('div.nc-activity', h('span', 'Sent'), h('span.nc-actic', { html: ICON.sent }), h('span', 'Received')),
        h('div.nc-activity', h('span', 'Bytes:'), h('span', sent.toLocaleString('en-US')), h('span', recv.toLocaleString('en-US')))),
      h('div.nc-btnrow.left', field('properties', h('button.btn.btn-sm', { onClick: () => { frame.close('properties'); properties(a.name, opts); } }, h('span.nc-uac', { html: ICON.shield }), 'Properties')),
        field('disable', h('button.btn.btn-sm', { onClick: () => { N.setEnabled(a.name, false); frame.close('disabled'); } }, h('span.nc-uac', { html: ICON.shield }), 'Disable')),
        field('diagnose', F.button('Diagnose', () => diagnose(a.name)))))));
    frame.body.appendChild(content);
    frame.footer.append(h('button.btn', { onClick: () => frame.close(null) }, 'Close'));
    frame.onEscape = () => frame.close(null); frame.onEnter = () => frame.close(null);
    if (opts.onStatus) opts.onStatus(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }
  function details(name, opts = {}) {
    const a = N.adapter(name);
    const v4 = N.bound(a, 'ms_tcpip') && a.ip && a.ip !== '0.0.0.0';
    const when = t => (t ? `${U.fmtLongDate(t)} ${U.fmtTime(t, true)}` : '');
    const rows = [
      ['Connection-specific DN...', a.dnsSuffix || ''], ['Description', a.description], ['Physical Address', a.mac], ['DHCP Enabled', a.dhcp ? 'Yes' : 'No'],
      ...(v4 ? [['IPv4 Address', a.ip], ['IPv4 Subnet Mask', U.prefixToMask(a.prefix)]] : []),
      ...(v4 && a.dhcp && a.leaseObtained ? [['Lease Obtained', when(a.leaseObtained)], ['Lease Expires', when(a.leaseExpires)]] : []),
      ['IPv4 Default Gateway', v4 ? a.gateway || '' : ''], ...(a.dhcp && a.dhcpServer ? [['IPv4 DHCP Server', a.dhcpServer]] : []),
      ['IPv4 DNS Servers', (a.dnsServers || []).join('\n')], ['IPv4 WINS Server', ''], ['NetBIOS over Tcpip En...', 'Yes'],
      ...(N.bound(a, 'ms_tcpip6') ? [['Link-local IPv6 Address', a.linkLocal6], ['IPv6 Default Gateway', ''], ['IPv6 DNS Server', '']] : [])
    ];
    const text = rows.map(([k, v]) => `${k}\t${String(v).replace(/\n/g, ', ')}`).join('\r\n');
    const list = h('div.nc-details', h('div.nc-drow.head', h('span', 'Property'), h('span', 'Value')), ...rows.map(([k, v]) => h('div.nc-drow', h('span', k), h('span', { style: 'white-space:pre-line' }, v))));
    const frame = WS.ui.modal({ title: 'Network Connection Details', width: 420, className: 'w32-dlg nc-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32', h('div', 'Network Connection Details:'), list));
    frame.footer.append(h('button.btn', { onClick: () => { if (WS.eventvwr) WS.eventvwr.copyText(text); } }, 'Copy'), h('button.btn.primary', { onClick: () => frame.close(null) }, 'Close'));
    frame.onEscape = () => frame.close(null); frame.onEnter = () => frame.close(null);
    frame.rows = rows;
    if (opts.onDetails) opts.onDetails(frame);
    return frame.promise;
  }
  /** Windows Network Diagnostics, reduced to its verdict for the lab network. */
  function verdict(a) {
    if (!a.enabled) return [`${a.name} is disabled`, `Enable the network adapter "${a.name}".`];
    if (!N.bound(a, 'ms_tcpip')) return [`The "Internet Protocol Version 4 (TCP/IPv4)" item is not enabled for ${a.name}`, 'Enable TCP/IPv4 in the connection\'s properties.'];
    if (N.status(a) === 'Duplicate') return ['An IP address conflict was detected', `Another computer on the network is using ${a.ip}. Use a different IP address.`];
    if (!a.ip || /^169\.254\./.test(a.ip)) return [`"${a.name}" doesn't have a valid IP configuration`, a.dhcp ? 'Windows could not get an address from a DHCP server.' : 'Check the IP address and subnet mask.'];
    if (!a.gateway || !N.ping(a.gateway, 1).ok) return ['The default gateway is not available', a.gateway ? `${a.gateway} is not responding.` : 'No default gateway is configured.'];
    if (!(a.dnsServers || []).length) return ["Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding", 'No DNS servers are configured for this connection.'];
    if (!N.resolve('www.microsoft.com').ok) return ["Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding", `The DNS server ${a.dnsServers[0]} did not answer.`];
    return null;
  }
  async function diagnose(name, opts = {}) {
    const a = N.adapter(name);
    const p = WS.ui.progress({ title: 'Windows Network Diagnostics', text: 'Detecting problems...' });
    for (const pct of [30, 70, 100]) { p.set(pct); await U.sleep(150); }
    p.close();
    const v = verdict(a);
    await WS.ui.msgbox({ title: 'Windows Network Diagnostics', icon: v ? 'warning' : 'info', message: v ? `Problems found\n\n${v[0]}` : "Troubleshooting couldn't identify the problem", detail: v ? v[1] : 'The network connection appears to be working.' });
    return v;
  }

  /* ================================================================ IPv4 / Advanced / IPv6 */
  /** The editable IPv4 state of an adapter (a draft the dialogs pass around until Ethernet Properties applies it). */
  function ipv4State(a) {
    return { dhcp: a.dhcp, ip: a.dhcp ? '' : a.ip, mask: a.dhcp ? '' : U.prefixToMask(a.prefix), gateway: a.dhcp ? '' : a.gateway || '', dnsAuto: a.dnsDhcp, dns: a.dnsDhcp ? [] : (a.dnsServers || []).slice(),
      validate: false, alt: a.altConfig ? { ip: a.altConfig.ip, mask: U.prefixToMask(a.altConfig.prefix), gateway: a.altConfig.gateway || '', dns: (a.altConfig.dns || []).slice() } : null,
      suffix: a.suffixConfigured ? a.dnsSuffix : '', register: a.registerDns !== false };
  }
  function ipv4(st, opts = {}) {
    const d = JSON.parse(JSON.stringify(st));
    const g = U.uid('v4'), c = {};
    const lw = { labelWidth: 170 };
    const general = () => {
      c.auto = field('ip-auto', F.radio(g + 'ip', 'Obtain an IP address automatically', d.dhcp));
      c.manual = field('ip-manual', F.radio(g + 'ip', 'Use the following IP address:', !d.dhcp));
      c.ip = ipBox('ip', d.ip); c.mask = ipBox('mask', d.mask); c.gw = ipBox('gateway', d.gateway); autoMask(c.ip, c.mask);
      c.dnsAuto = field('dns-auto', F.radio(g + 'dns', 'Obtain DNS server address automatically', d.dnsAuto));
      c.dnsManual = field('dns-manual', F.radio(g + 'dns', 'Use the following DNS server addresses:', !d.dnsAuto));
      c.dns1 = ipBox('dns1', d.dns[0]); c.dns2 = ipBox('dns2', d.dns[1]);
      c.validate = field('validate', F.checkbox('Validate settings upon exit', d.validate));
      const paint = () => {
        const man = c.manual.checked;
        [c.ip, c.mask, c.gw].forEach(x => { x.disabled = !man; });
        // a static address needs static DNS servers: Windows forces the second group to manual
        if (man) { c.dnsManual.checked = true; c.dnsAuto.input.disabled = true; } else c.dnsAuto.input.disabled = false;
        [c.dns1, c.dns2].forEach(x => { x.disabled = !c.dnsManual.checked; });
        // Windows hides the Alternate Configuration tab while a static address is selected
        if (dlg && dlg.tabEls[1]) dlg.tabEls[1].style.display = man ? 'none' : '';
      };
      [c.auto, c.manual, c.dnsAuto, c.dnsManual].forEach(x => x.input.addEventListener('change', paint));
      setTimeout(paint, 0);
      return h('div', h('p.nc-p', 'You can get IP settings assigned automatically if your network supports this capability. Otherwise, you need to ask your network administrator for the appropriate IP settings.'),
        h('div.nc-box', c.auto, c.manual, h('div.nc-indent', F.row('IP address:', c.ip, lw), F.row('Subnet mask:', c.mask, lw), F.row('Default gateway:', c.gw, lw))),
        h('div.nc-box', c.dnsAuto, c.dnsManual, h('div.nc-indent', F.row('Preferred DNS server:', c.dns1, lw), F.row('Alternate DNS server:', c.dns2, lw))),
        h('div.nc-line', c.validate, field('advanced', F.button('Advanced...', async () => { read(); const r = await advanced(d, opts); if (r) { Object.assign(d, r); c.dns1.value = d.dns[0] || ''; c.dns2.value = d.dns[1] || ''; if (d.dns.length) c.dnsManual.checked = true; paint(); } }))));
    };
    let dlg = null;
    const alternate = () => {
      const ag = U.uid('alt'), al = d.alt || { ip: '', mask: '', gateway: '', dns: [] };
      c.apipa = field('alt-apipa', F.radio(ag, 'Automatic private IP address', !d.alt));
      c.user = field('alt-user', F.radio(ag, 'User configured', !!d.alt));
      c.aip = ipBox('alt-ip', al.ip); c.amask = ipBox('alt-mask', al.mask); c.agw = ipBox('alt-gateway', al.gateway); autoMask(c.aip, c.amask);
      c.adns1 = ipBox('alt-dns1', al.dns[0]); c.adns2 = ipBox('alt-dns2', al.dns[1]);
      const paint = () => { [c.aip, c.amask, c.agw, c.adns1, c.adns2].forEach(x => { x.disabled = !c.user.checked; }); };
      [c.apipa, c.user].forEach(x => x.input.addEventListener('change', paint));
      paint();
      return h('div', h('p.nc-p', 'If this computer is used on more than one network, enter the alternate IP settings below.'), c.apipa, c.user,
        h('div.nc-indent', F.row('IP address:', c.aip, lw), F.row('Subnet mask:', c.amask, lw), F.row('Default gateway:', c.agw, lw), F.row('Preferred DNS server:', c.adns1, lw), F.row('Alternate DNS server:', c.adns2, lw)));
    };
    function read() {
      d.dhcp = c.auto.checked; d.ip = c.ip.value.trim(); d.mask = c.mask.value.trim(); d.gateway = c.gw.value.trim();
      d.dnsAuto = c.dnsAuto.checked && d.dhcp;
      const typed = [c.dns1.value.trim(), c.dns2.value.trim()].filter(Boolean);
      d.dns = d.dnsAuto ? [] : [...typed, ...d.dns.slice(2).filter(x => !typed.includes(x))];
      d.validate = c.validate.checked;
      if (c.user) d.alt = c.user.checked ? { ip: c.aip.value.trim(), mask: c.amask.value.trim(), gateway: c.agw.value.trim(), dns: [c.adns1.value.trim(), c.adns2.value.trim()].filter(Boolean) } : null;
    }
    async function ok() {
      read();
      if (!d.dhcp) {
        if (!d.ip) { await err('You must enter an IP address.'); return false; }
        if (!d.mask) { await err('The subnet mask is missing. You must enter a subnet mask.'); return false; }
        const chk = N.checkStatic({ ip: d.ip, mask: d.mask, gateway: d.gateway });
        if (!chk.ok) { await err(chk.error); return false; }
        for (const w of chk.warnings) if ((await WS.ui.msgbox({ title: TCPIP, icon: 'warning', message: w, buttons: ['Yes', 'No'] })) !== 'Yes') return false;
      }
      const badDns = d.dns.find(x => !U.isValidIp(x));
      if (badDns) { await err(`The DNS server address ${badDns} is not valid.`); return false; }
      if (d.dhcp && d.alt) {
        if (!U.isValidIp(d.alt.ip) || !(U.maskToPrefix(d.alt.mask) > 0)) { await err('The alternate configuration needs a valid IP address and subnet mask.'); return false; }
      }
      return d;
    }
    return tabDialog({ title: 'Internet Protocol Version 4 (TCP/IPv4) Properties', width: 420, onCreate: f => { dlg = f; if (opts.onIpv4) opts.onIpv4(f); }, ok,
      tabs: [{ label: 'General', render: general }, { label: 'Alternate Configuration', render: alternate }] });
  }
  /** Advanced TCP/IP Settings: the IP list (one address in the lab), the full DNS server order, the suffix, DNS registration. */
  function advanced(st, opts = {}) {
    const d = { dns: st.dns.slice(), suffix: st.suffix || '', register: st.register !== false };
    const c = {};
    const listBox = (key, rows) => field(key, h('select.inp.nc-list', { size: 4 }, ...rows.map(r => h('option', { value: r }, r))));
    const ipTab = () => {
      const ips = st.dhcp ? [['DHCP Enabled', '']] : st.ip ? [[st.ip, st.mask]] : [];
      const gws = !st.dhcp && st.gateway ? [[st.gateway, 'Automatic']] : [];
      const table = (cols, rows) => h('div.nc-table', h('div.nc-trow.head', ...cols.map(x => h('span', x))), ...rows.map(r => h('div.nc-trow', ...r.map(x => h('span', x)))));
      return h('div', F.group('IP addresses', table(['IP address', 'Subnet mask'], ips), h('div.nc-btnrow', F.button('Add...', () => {}, { disabled: true }), F.button('Edit...', () => {}, { disabled: true }), F.button('Remove', () => {}, { disabled: true }))),
        F.group('Default gateways:', table(['Gateway', 'Metric'], gws), h('div.nc-btnrow', F.button('Add...', () => {}, { disabled: true }), F.button('Edit...', () => {}, { disabled: true }), F.button('Remove', () => {}, { disabled: true }))),
        F.checkbox('Automatic metric', true, { disabled: true }), F.row('Interface metric:', F.text({ disabled: true, width: 60 }), { labelWidth: 110 }),
        F.note('The lab adapter has a single IPv4 address. Add extra addresses with New-NetIPAddress is not modelled.'));
    };
    const dnsTab = () => {
      c.list = listBox('dns-list', d.dns);
      const paint = () => { U.clear(c.list); d.dns.forEach(x => c.list.appendChild(h('option', { value: x }, x))); };
      const sel = () => c.list.selectedIndex;
      const addDns = async (i) => {
        const v = await WS.ui.inputBox({ title: 'TCP/IP DNS Server', prompt: 'DNS server:', value: i != null ? d.dns[i] : '', okLabel: i != null ? 'OK' : 'Add', validate: x => (U.isValidIp(x.trim()) ? null : 'The DNS server address is not valid. Enter a valid IP address.') });
        if (v == null) return;
        if (i != null) d.dns[i] = v.trim(); else if (!d.dns.includes(v.trim())) d.dns.push(v.trim());
        paint();
      };
      const move = k => { const i = sel(), j = i + k; if (i < 0 || j < 0 || j >= d.dns.length) return; [d.dns[i], d.dns[j]] = [d.dns[j], d.dns[i]]; paint(); c.list.selectedIndex = j; };
      const g = U.uid('suf');
      c.suffix = field('suffix', F.text({ value: d.suffix, width: 250 }));
      c.register = field('register', F.checkbox("Register this connection's addresses in DNS", d.register));
      return h('div', h('div', 'DNS server addresses, in order of use:'),
        h('div.nc-line.top', c.list, h('div.nc-col', field('dns-up', F.button('▲', () => move(-1))), field('dns-down', F.button('▼', () => move(1))))),
        h('div.nc-btnrow', field('dns-add', F.button('Add...', () => addDns())), F.button('Edit...', () => { if (sel() >= 0) addDns(sel()); }), field('dns-remove', F.button('Remove', () => { const i = sel(); if (i >= 0) { d.dns.splice(i, 1); paint(); } }))),
        h('p.nc-p', 'The following three settings are applied to all connections with TCP/IP enabled. For resolution of unqualified names:'),
        F.radio(g, 'Append primary and connection specific DNS suffixes', true), h('div.nc-indent', F.checkbox('Append parent suffixes of the primary DNS suffix', true, { disabled: true })),
        F.radio(g, 'Append these DNS suffixes (in order):', false, { disabled: true }),
        F.row('DNS suffix for this connection:', c.suffix, { labelWidth: 190 }), c.register, F.checkbox("Use this connection's DNS suffix in DNS registration", false, { disabled: true }));
    };
    const winsTab = () => h('div', h('div', 'WINS addresses, in order of use:'), h('select.inp.nc-list', { size: 4, disabled: true }),
      h('div.nc-btnrow', F.button('Add...', () => {}, { disabled: true }), F.button('Edit...', () => {}, { disabled: true }), F.button('Remove', () => {}, { disabled: true })),
      F.checkbox('Enable LMHOSTS lookup', true, { disabled: true }), h('div.nc-p', 'NetBIOS setting'),
      F.radio(U.uid('nb'), 'Default:', true, { disabled: true }), h('div.nc-indent.nc-note', 'Use NetBIOS setting from the DHCP server. If static IP address is used or the DHCP server does not provide NetBIOS setting, enable NetBIOS over TCP/IP.'));
    return tabDialog({ title: 'Advanced TCP/IP Settings', width: 440, onCreate: opts.onAdvanced, initialTab: opts.advancedTab,
      tabs: [{ label: 'IP Settings', render: ipTab }, { label: 'DNS', render: dnsTab }, { label: 'WINS', render: winsTab }],
      ok: async () => {
        const suffix = c.suffix ? c.suffix.value.trim() : d.suffix;
        if (suffix && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(suffix)) { await err('The DNS suffix is not valid. It can contain only letters, digits, hyphens and periods.'); return false; }
        return { dns: d.dns.slice(), suffix, register: c.register ? c.register.checked : d.register };
      } });
  }
  function ipv6(opts = {}) {
    const g = U.uid('v6');
    const lw = { labelWidth: 170 };
    return tabDialog({ title: 'Internet Protocol Version 6 (TCP/IPv6) Properties', width: 420, onCreate: opts.onIpv6, ok: () => true,
      tabs: [{ label: 'General', render: () => h('div', h('p.nc-p', 'You can get IPv6 settings assigned automatically if your network supports this capability. Otherwise, you need to ask your network administrator for the appropriate IPv6 settings.'),
        h('div.nc-box', F.radio(g + 'a', 'Obtain an IPv6 address automatically', true), F.radio(g + 'a', 'Use the following IPv6 address:', false, { disabled: true }),
          h('div.nc-indent', F.row('IPv6 address:', F.text({ disabled: true }), lw), F.row('Subnet prefix length:', F.text({ disabled: true, width: 60 }), lw), F.row('Default gateway:', F.text({ disabled: true }), lw))),
        h('div.nc-box', F.radio(g + 'd', 'Obtain DNS server address automatically', true), F.radio(g + 'd', 'Use the following DNS server addresses:', false, { disabled: true })),
        F.note('The lab network is IPv4-only: IPv6 uses its link-local address.')) }] });
  }

  /* ================================================================ Ethernet Properties */
  function properties(name, opts = {}) {
    const a = N.adapter(name);
    if (!a) return Promise.resolve(null);
    const pend = { bindings: Object.fromEntries(N.bindings(a.name).map(b => [b.id, b.enabled])), ipv4: null, committed: false };
    let sel = null, listEl = null, descEl = null, propBtn = null, frameRef = null;
    const kindIcon = { client: ICON.client, service: ICON.service, protocol: ICON.proto };
    const paintList = () => {
      U.clear(listEl);
      for (const b of N.bindings(a.name)) {
        const cb = field('bind-' + b.id, h('input', { type: 'checkbox', checked: pend.bindings[b.id], onChange: e => { pend.bindings[b.id] = e.target.checked; } }));
        listEl.appendChild(h('div.nc-bind' + (sel === b.id ? '.sel' : ''), { dataset: { id: b.id }, onPointerdown: e => { if (e.target !== cb) { sel = b.id; paintSel(); } }, onDblclick: () => { sel = b.id; openItem(); } },
          cb, h('span.nc-bic', { html: kindIcon[b.kind] }), h('span', b.name)));
      }
      paintSel();
    };
    const paintSel = () => {
      listEl.querySelectorAll('.nc-bind').forEach(x => x.classList.toggle('sel', x.dataset.id === sel));
      const b = N.bindings(a.name).find(x => x.id === sel);
      descEl.textContent = b ? b.description : '';
      propBtn.disabled = !b || !['ms_tcpip', 'ms_tcpip6', 'ms_pacer'].includes(b.id);
    };
    async function openItem() {
      if (sel === 'ms_tcpip') {
        const r = await ipv4(pend.ipv4 || ipv4State(a), opts);
        if (r) { pend.ipv4 = r; pend.committed = true; if (frameRef) frameRef.cancelBtn.textContent = 'Close'; }
      } else if (sel === 'ms_tcpip6') await ipv6(opts);
      else if (sel === 'ms_pacer') await WS.ui.msgbox({ title: 'QoS Packet Scheduler', icon: 'info', message: 'The QoS Packet Scheduler has no settings to configure.' });
    }
    async function apply() {
      for (const [id, on] of Object.entries(pend.bindings)) if (N.bound(a, id) !== on) { const r = N.setBinding(a.name, id, on); if (!r.ok) { await err(r.error, 'Network Connections'); return false; } }
      const d = pend.ipv4;
      if (d) {
        let r = d.dhcp ? N.setDhcp(a.name) : N.setStatic(a.name, { ip: d.ip, mask: d.mask, gateway: d.gateway });
        if (r.ok) r = d.dnsAuto && d.dhcp ? N.setDnsServers(a.name, null) : N.setDnsServers(a.name, d.dns);
        if (r.ok) r = N.setDnsClient(a.name, { suffix: d.suffix, register: d.register });
        if (r.ok && d.dhcp) r = N.setAlternate(a.name, d.alt ? { ip: d.alt.ip, mask: d.alt.mask, gateway: d.alt.gateway, dns: d.alt.dns } : null);
        if (!r.ok) { await err(r.error); return false; }
        if (d.validate) await diagnose(a.name);
      }
      return true;
    }
    const networking = () => {
      listEl = h('div.nc-binds', { tabIndex: 0 });
      descEl = h('div.nc-desc');
      propBtn = field('item-properties', F.button('Properties', () => openItem(), { disabled: true }));
      const dev = WS.compmgmt && WS.compmgmt.devices().find(x => x.name === 'Network adapters');
      setTimeout(paintList, 0);
      return h('div', h('div', 'Connect using:'),
        h('div.nc-using', h('span.nc-bic', { html: ICON.on }), h('span', a.description)),
        h('div.nc-btnrow.right', F.button('Configure...', () => { if (dev) WS.compmgmt.deviceProperties(a.description, dev); })),
        h('div', 'This connection uses the following items:'), listEl,
        h('div.nc-btnrow', F.button('Install...', () => WS.apps.notImplemented('Select Network Feature Type')), F.button('Uninstall', () => {}, { disabled: true }), propBtn),
        F.group('Description', descEl));
    };
    const sharing = () => h('div', F.group('Internet Connection Sharing', F.checkbox("Allow other network users to connect through this computer's Internet connection", false, { disabled: true }),
      h('div.nc-note', 'Internet Connection Sharing needs a second network adapter, which the lab server does not have.')));
    return tabDialog({ title: `${a.name} Properties`, width: 400, tabs: [{ label: 'Networking', render: networking }, { label: 'Sharing', render: sharing }],
      onCreate: f => { frameRef = f; Object.assign(f, { select: id => { sel = id; paintSel(); }, openItem, pending: pend }); if (opts.onCreate) opts.onCreate(f); },
      ok: () => apply(),
      // after a protocol dialog was OK'd, Windows relabels Cancel to Close and still keeps the change
      cancel: async f => { if (pend.committed) { if (await apply()) f.close(true); } else f.close(null); } });
  }

  /* ================================================================ the Network Connections window */
  function launch() {
    const win = WS.wm.create({ app: 'ncpa', title: 'Network Connections', icon: ICON.app, width: 860, height: 520 });
    let sel = null, renaming = null;
    const cmd = h('div.nc-cmd'), items = h('div.nc-items', { tabIndex: 0 }), statusBar = h('div.nc-statusbar');
    win.body.appendChild(h('div.cp.nc',
      h('div.cp-bar', h('div.cp-crumbs', h('span', 'Control Panel'), h('span.cp-sep', '>'), h('span', 'Network and Internet'), h('span.cp-sep', '>'), h('span', 'Network Connections'))),
      cmd, items, statusBar));
    const adapter = () => (sel ? N.adapter(sel) : null);
    const menu = a => [
      { label: a.enabled ? 'Disa&ble' : 'E&nable', icon: ICON.shield, action: () => N.setEnabled(a.name, !a.enabled) },
      { label: 'Stat&us', default: a.enabled, disabled: !a.enabled, action: () => status(a.name) },
      { label: 'Dia&gnose', action: () => diagnose(a.name) },
      { separator: true },
      { label: 'Bridge Connections', disabled: true },
      { separator: true },
      { label: 'Create &Shortcut', disabled: true }, { label: '&Delete', disabled: true }, { label: 'Rena&me', action: () => rename(a.name) },
      { separator: true },
      { label: 'P&roperties', icon: ICON.shield, action: () => properties(a.name) }
    ];
    function rename(name) { renaming = name; paint(); }
    function paint() {
      U.clear(items);
      for (const a of N.adapters()) {
        const icon = !a.enabled ? ICON.off : !a.connected ? ICON.unplugged : ICON.on;
        const label = renaming === a.name
          ? (() => {
            const inp = field('rename', h('input.inp.nc-rename', { value: a.name }));
            const done = async commit => {
              if (renaming !== a.name) return;
              renaming = null;
              if (commit && inp.value.trim() !== a.name) { const r = N.rename(a.name, inp.value); if (!r.ok) await WS.ui.msgbox({ title: 'Network Connections', icon: 'error', message: r.error }); else sel = inp.value.trim(); }
              paint();
            };
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } e.stopPropagation(); });
            inp.addEventListener('blur', () => done(true));
            setTimeout(() => { inp.focus(); inp.select(); }, 20);
            return inp;
          })()
          : h('b', a.name);
        items.appendChild(h('div.nc-tile' + (sel === a.name ? '.sel' : '') + (a.enabled ? '' : '.off'), { dataset: { name: a.name },
          onPointerdown: () => { if (sel !== a.name) { sel = a.name; paint(); } },
          onDblclick: () => (a.enabled ? status(a.name) : N.setEnabled(a.name, true)),
          onContextmenu: e => { e.preventDefault(); sel = a.name; paint(); WS.ui.contextMenu(e.clientX, e.clientY, menu(a)); } },
        h('span.nc-tic', { html: icon }), h('div.nc-ttext', label, h('div', networkName(a)), h('div.nc-dim', a.description))));
      }
      paintCmd();
    }
    function paintCmd() {
      U.clear(cmd);
      const a = adapter();
      const btn = (text, fn, shield) => h('button.nc-cbtn', { onClick: fn }, shield ? h('span.nc-uac', { html: ICON.shield }) : null, text);
      cmd.appendChild(h('button.nc-cbtn', { onClick: e => WS.ui.popupMenu(e.currentTarget, () => [{ label: 'Rena&me', disabled: !a, action: () => a && rename(a.name) }, { label: 'P&roperties', disabled: !a, action: () => a && properties(a.name) }, { separator: true }, { label: '&Close', action: () => win.close() }]) }, 'Organize ▾'));
      if (a) {
        cmd.append(btn(a.enabled ? 'Disable this network device' : 'Enable this network device', () => N.setEnabled(a.name, !a.enabled), true),
          btn('Diagnose this connection', () => diagnose(a.name)), btn('Rename this connection', () => rename(a.name)));
        if (a.enabled) cmd.append(btn('View status of this connection', () => status(a.name)));
        cmd.append(btn('Change settings of this connection', () => properties(a.name), true));
      }
      statusBar.textContent = `${N.adapters().length} item${N.adapters().length === 1 ? '' : 's'}${a ? '   1 item selected' : ''}`;
    }
    items.addEventListener('pointerdown', e => { if (!e.target.closest('.nc-tile')) { sel = null; paint(); } });
    items.addEventListener('keydown', e => {
      const a = adapter();
      if (!a) return;
      if (e.key === 'F2') { e.preventDefault(); rename(a.name); } else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); properties(a.name); } else if (e.key === 'Enter') { e.preventDefault(); if (a.enabled) status(a.name); }
    });
    win.listen('network', () => { if (!renaming) paint(); });
    win.listen('system', () => { if (!renaming) paint(); });
    win.ncpa = { select: n => { sel = n; paint(); }, rename, menu: () => (adapter() ? menu(adapter()) : []), commands: () => [...cmd.querySelectorAll('button')].map(b => b.textContent) };
    paint();
    return win;
  }

  /* ================================================================ Network and Sharing Center */
  function launchCenter() {
    const win = WS.wm.create({ app: 'netcenter', title: 'Network and Sharing Center', icon: ICON.app, width: 920, height: 560 });
    const nav = h('div.cp-nav'), main = h('div.cp-main');
    win.body.appendChild(h('div.cp', h('div.cp-bar', h('div.cp-crumbs', h('span', 'Control Panel'), h('span.cp-sep', '>'), h('span', 'Network and Internet'), h('span.cp-sep', '>'), h('span', 'Network and Sharing Center'))), h('div.cp-body', nav, main)));
    const link = (text, fn, shield) => h('a.cp-link', { href: '#', onClick: e => { e.preventDefault(); fn(); } }, shield ? h('span.cp-uac', { html: ICON.shield }) : null, text);
    nav.append(link('Control Panel Home', () => WS.apps.launch('control')), link('Change adapter settings', () => WS.apps.launch('ncpa')),
      link('Change advanced sharing settings', () => WS.apps.notImplemented('Advanced sharing settings')), link('Media streaming options', () => WS.apps.notImplemented('Media streaming options')),
      h('div.cp-see', 'See also'), link('Internet Options', () => WS.apps.notImplemented('Internet Options')), link('Windows Defender Firewall', () => WS.apps.launch('firewall')));
    const paint = () => {
      U.clear(main);
      const a = N.adapter();
      const kind = { Domain: 'Domain network', Private: 'Private network', Public: 'Public network' }[WS.fw.activeProfile()];
      const connected = a.enabled && a.connected;
      main.append(h('h1.cp-h1', 'View your basic network information and set up connections'),
        h('div.nc-sech', 'View your active networks'),
        connected ? h('div.nc-active', h('div', h('b', networkName(a)), h('div', kind)),
          h('div.nc-acc', h('div.nc-kv', h('span', 'Access type:'), h('span', connectivity(a))), h('div.nc-kv', h('span', 'Connections:'), h('span', F.link(a.name, () => status(a.name))))))
          : h('p', 'You are currently not connected to any networks.'),
        h('div.nc-sech', 'Change your networking settings'),
        h('div.nc-task', link('Set up a new connection or network', () => WS.apps.notImplemented('Set Up a Connection or Network')), h('div.nc-dim', 'Set up a broadband, dial-up, or VPN connection; or set up a router or access point.')),
        h('div.nc-task', link('Troubleshoot problems', () => diagnose(a.name)), h('div.nc-dim', 'Diagnose and repair network problems, or get troubleshooting information.')));
    };
    win.listen('network', paint); win.listen('firewall', paint);
    paint();
    return win;
  }

  WS.ncpa = { launch, launchCenter, status, details, properties, ipv4, ipv4State, advanced, ipv6, diagnose, verdict, connectivity, networkName, ICON };
  WS.apps.register({ id: 'ncpa', name: 'Network Connections', icon: ICON.app, launch, keywords: ['ncpa.cpl', 'network connections', 'adapter', 'ip address', 'ethernet', 'ipv4'] });
  WS.apps.register({ id: 'netcenter', name: 'Network and Sharing Center', icon: ICON.app, launch: launchCenter, keywords: ['network and sharing center', 'network', 'sharing center'] });
})();
