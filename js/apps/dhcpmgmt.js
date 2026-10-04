/* DHCP console (dhcpmgmt.msc). Every change goes through WS.dhcp - the model the DhcpServer cmdlets use - and the
 * DHCPServer service through WS.svc with the Services console's Service Control boxes, so the console and PowerShell
 * always agree. The tree follows the real snap-in:
 *   DHCP > <server FQDN> > IPv4 > Scope [id] name > Address Pool | Address Leases | Reservations > [ip] name | Scope Options | Policies
 *                               > Server Options | Policies | Filters > Allow | Deny
 *                        > IPv6 > Server Options
 * Not modelled (these open the "not built yet" window): failover, superscopes, multicast scopes, user/vendor classes,
 * predefined options, policies, bindings, backup/restore, authorized-server management, reservation options, IPv6 scopes.
 * WS.dhcpmgmt = { launch, newScope(opts), newExclusion(scopeId, opts), newReservation(scopeId, opts), newFilter(list, opts),
 *   configureOptions(scopeId | null, opts), scopeProperties(scopeId, opts), reservationProperties(scopeId, ip, opts),
 *   ipv4Properties(opts), serverProperties(opts), statistics(scopeId?, opts), reconcile(scopeId?, opts), addServer(opts),
 *   setActive(scopeId, active), deleteScope(scopeId), deleteReservation(scopeId, ip), deleteExclusions(scopeId, starts),
 *   deleteLeases(scopeId, ips), deleteOptions(scopeId | null, codes), deleteFilters(list, macs), authorize(), unauthorize(),
 *   service('start' | 'stop' | 'restart'), ICON }
 * Every dialog takes opts.onCreate(obj) and hands over the live wizard / property sheet / dialog frame; controls carry
 * data-field names (tests fill them and press the real buttons). Delete/Deactivate/Unauthorize ask first.
 * launch(opts) returns the window; win.dhcpmgmt is the controller { mmc, open(nodeId), path(nodeId), serverRemoved }. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, M = WS.dhcp;
  const TITLE = 'DHCP';
  const HELP = 'For more information about setting up a DHCP server, see online Help.';

  /* ---------------- icons (16-unit, drawn like icons.js; badges as the real snap-in shows state) ---------------- */
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const inner = svg => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
  const FOLDER = inner(I.folder);
  const BADGE = {
    check: '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#0f7b0f"/><path d="M10.6 12.1l1 1 1.9-2" stroke="#fff" stroke-width="1" fill="none"/>',
    down: '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M12 10.3v3.2M10.6 12.2l1.4 1.4 1.4-1.4" stroke="#fff" stroke-width="1" fill="none"/>',
    stop: '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M10.7 10.7l2.6 2.6M13.3 10.7l-2.6 2.6" stroke="#fff" stroke-width="1"/>'
  };
  const badge = (svg, b) => (b ? svg.replace(/<\/svg>$/, BADGE[b] + '</svg>') : svg);
  const dim = svg => s16('<g opacity=".5">' + inner(svg) + '</g>');
  const ipBox = v => s16(`<rect x="1" y="2.5" width="14" height="10" rx="1.5" fill="url(#wsg-blue)"/><text x="7.6" y="10.4" font-size="6.6" font-weight="700" text-anchor="middle" fill="#fff" font-family="Segoe UI, Arial, sans-serif">v${v}</text>`);
  const sheetGlyph = '<rect x="7.3" y="7.2" width="7" height="6.4" rx=".6" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/>';
  const ICON = {
    root: s16('<rect x="1.5" y="1.5" width="6" height="13" rx="1" fill="#5b6b7d"/><rect x="2.6" y="3" width="3.8" height="1.6" fill="#8fa3b8"/><rect x="2.6" y="5.8" width="3.8" height="1.6" fill="#8fa3b8"/><circle cx="5.5" cy="12.3" r=".7" fill="#4cff8a"/><path d="M7.5 8H10M10 3.5v9M10 3.5h2.5M10 8h2.5M10 12.5h2.5" fill="none" stroke="#2f7fd8" stroke-width="1.1"/><rect x="12.5" y="2.3" width="2.5" height="2.4" fill="#4ea5ef"/><rect x="12.5" y="6.8" width="2.5" height="2.4" fill="#4ea5ef"/><rect x="12.5" y="11.3" width="2.5" height="2.4" fill="#4ea5ef"/>'),
    server: I.server, ipv4: ipBox(4), ipv6: ipBox(6), scope: I.scope,
    pool: s16(FOLDER + '<rect x="7" y="8.3" width="7.5" height="4.6" rx=".6" fill="#fff" stroke="#2f7fd8" stroke-width=".8"/><path d="M8.3 10.6h4.9" stroke="#2f7fd8" stroke-width="1.3"/>'),
    leases: s16(FOLDER + sheetGlyph + '<path d="M8.4 9h4.8M8.4 10.5h4.8M8.4 12h2.8" stroke="#2fb34b" stroke-width=".9"/>'),
    reservations: s16(FOLDER + '<circle cx="9.4" cy="10.5" r="1.9" fill="#fff" stroke="#c99a00" stroke-width="1.1"/><path d="M11.3 10.5h3.3M13.6 10.5v1.7" stroke="#c99a00" stroke-width="1.1"/>'),
    options: s16(FOLDER + sheetGlyph + '<path d="M8.4 9h.9M10.1 9h3.1M8.4 10.5h.9M10.1 10.5h3.1M8.4 12h.9M10.1 12h3.1" stroke="#2f7fd8" stroke-width=".9"/>'),
    policies: s16(FOLDER + sheetGlyph + '<path d="M8.6 10.4l1.3 1.3 2.6-2.8" fill="none" stroke="#0f7b0f" stroke-width="1.1"/>'),
    filters: s16(FOLDER + '<path d="M7.2 7.8h7.3l-2.8 3v2.6l-1.7-.9v-1.7z" fill="url(#wsg-blue)" stroke="#1f5fa8" stroke-width=".5"/>'),
    allow: badge(I.filter, 'check'), deny: badge(I.filter, 'stop'), filterOff: badge(dim(I.filter), 'down'),
    range: s16('<rect x="1.5" y="4.5" width="13" height="7" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3.5 8h9" stroke="#2fb34b" stroke-width="2"/>'),
    exclusion: s16('<rect x="1.5" y="4.5" width="13" height="7" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3.5 8h9" stroke="#c42b1c" stroke-width="2"/>'),
    lease: I.computer,
    reservation: s16(inner(I.computer) + '<circle cx="10.6" cy="12.4" r="1.7" fill="#fff" stroke="#c99a00" stroke-width="1"/><path d="M12.3 12.4h3M14.3 12.4v1.5" stroke="#c99a00" stroke-width="1"/>'),
    option: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 4.5h1.2M7 4.5h4.5M4.5 7.5h1.2M7 7.5h4.5M4.5 10.5h1.2M7 10.5h4.5" stroke="#2f7fd8" stroke-width="1.1"/>'),
    serverOption: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 4.5h7M4.5 6.8h7" stroke="#8a97a6"/><rect x="8.3" y="8.3" width="4.4" height="6.2" rx=".5" fill="#5b6b7d"/><rect x="9" y="9.3" width="3" height=".9" fill="#8fa3b8"/><rect x="9" y="10.8" width="3" height=".9" fill="#8fa3b8"/><circle cx="11.6" cy="13.4" r=".45" fill="#4cff8a"/>'),
    mac: I.adapter
  };
  ICON.scopeInactive = badge(I.scope, 'down');

  /* ---------------- helpers ---------------- */
  const fqdn = () => WS.sys.fqdn().toLowerCase();
  const running = () => WS.svc.isRunning('DHCPServer');
  const unauthorized = () => WS.sys.isDC() && !M.authorized;
  const scopeLabel = s => `Scope [${s.id}] ${s.name}`;
  const resLabel = r => `[${r.ip}] ${r.name}`;
  const optName = code => `${U.pad(code, 3)} ${M.OPTIONS[code] ? M.OPTIONS[code].name : 'Option ' + code}`;
  const hex = n => '0x' + (Number(n) || 0).toString(16);
  const optValue = (code, v) => { const t = (M.OPTIONS[code] || {}).type; return t === 'byte' || t === 'long' ? hex([].concat(v)[0]) : [].concat(v).join(', '); };
  const uniqueId = mac => String(mac || '').replace(/-/g, '').toLowerCase();
  const macText = mac => String(mac || '').toLowerCase();
  const TYPE_LABEL = { Both: 'DHCP/BOOTP', Dhcp: 'DHCP', Bootp: 'BOOTP' };
  const soon = label => () => WS.apps.notImplemented(label);
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  /** A fixed-width address box (the real dialogs use the IP address control). */
  const ipText = (name, value) => { const el = field(name, F.text({ value })); el.classList.add('dhcp-ipf'); return el; };
  const lw = { labelWidth: 110 };
  const err = (r, title = TITLE) => WS.ui.msgbox({ title, icon: 'error', message: typeof r === 'string' ? r : r.error, detail: r.detail });
  const ask = (message, title = TITLE) => WS.ui.msgbox({ title, icon: 'warning', message, buttons: ['Yes', 'No'] }).then(a => a === 'Yes');
  const cancelled = { ok: false, cancelled: true };
  const classPrefix = ip => { const a = +ip.split('.')[0]; return a < 128 ? 8 : a < 192 ? 16 : 24; };
  const defaultPrefix = ip => { const lan = WS.state.network.lan; return U.inSubnet(ip, lan.network, lan.prefix) ? lan.prefix : classPrefix(ip); };
  /** The address prefix an IP address control shows for a new reservation ("192.168.1."). */
  const netPrefix = s => s.id.split('.').slice(0, Math.max(1, Math.floor(s.prefix / 8))).join('.') + '.';
  const splitLease = days => { const m = Math.round((+days || 0) * 1440); return { days: Math.floor(m / 1440), hours: Math.floor(m % 1440 / 60), minutes: m % 60 }; };
  /** Days / Hours / Minutes spinners -> { days } or { error }. */
  function leaseValue(c) {
    const d = +c.days.value || 0, hr = +c.hours.value || 0, mi = +c.minutes.value || 0;
    if (d < 0 || d > 999 || hr < 0 || hr > 23 || mi < 0 || mi > 59 || [d, hr, mi].some(x => x % 1)) return { error: 'The lease duration is not valid. Days must be between 0 and 999, hours between 0 and 23, and minutes between 0 and 59.' };
    if (!d && !hr && !mi) return { error: 'The lease duration must be at least one minute.' };
    return { days: d + hr / 24 + mi / 1440 };
  }
  function leaseGrid(c, v, disabled, prefix = '') {
    for (const [k, max] of [['days', 999], ['hours', 23], ['minutes', 59]]) c[k] = field(prefix + k, F.number({ value: v[k], min: 0, max, width: 58, disabled }));
    return h('div.dhcp-lease', h('label', 'Days:', c.days), h('label', 'Hours:', c.hours), h('label', 'Minutes:', c.minutes));
  }
  /** Result-pane text page (custom view); the content function is re-read on every refresh. */
  const info = content => ({ content, render: (host, mmc) => {
    const paint = () => { const v = mmc.view(); const [title, ...paras] = (v && v.content ? v.content : content)(); U.clear(host); host.appendChild(h('div.dhcp-info.w32', h('h3', title), ...paras.map(p => h('p', p)))); };
    paint();
    return { refresh: paint };
  } });

  /* ---------------- service control (Service Control progress, as services.msc) ---------------- */
  async function service(verb) {
    const svc = WS.svc.get('DHCPServer');
    if (!svc) return { ok: false };
    const S = WS.services;
    return verb === 'start' ? S.startSvc(svc) : verb === 'stop' ? S.stopSvc(svc) : S.restartSvc(svc);
  }
  async function authorize() { const r = M.authorize(); if (!r.ok) await err(r); return r; }
  async function unauthorize() {
    if (!(await ask(`Unauthorizing this DHCP server will stop it from leasing IP addresses to clients on the network.\n\nAre you sure you want to unauthorize the DHCP server ${fqdn()}?`))) return cancelled;
    const r = M.unauthorize(); if (!r.ok) await err(r); return r;
  }

  /* ---------------- scope commands ---------------- */
  async function setActive(id, active) {
    const s = M.scope(id); if (!s) return { ok: false };
    if (!active && !(await ask(`Deactivating this scope will prevent clients from obtaining or renewing IP address leases from it.\n\nDo you want to deactivate ${scopeLabel(s)}?`))) return cancelled;
    const r = M.setScope(id, { active: !!active }); if (!r.ok) await err(r); return r;
  }
  async function deleteScope(id) {
    const s = M.scope(id); if (!s) return { ok: false };
    const warn = s.active ? 'The scope is currently active. Clients that lease addresses from it will lose connectivity when they try to renew their leases.\n\n' : '';
    if (!(await ask(`${warn}Deleting a scope also deletes all of its address leases, reservations and scope options.\n\nDo you want to delete ${scopeLabel(s)}?`))) return cancelled;
    const r = M.removeScope(id); if (!r.ok) await err(r); return r;
  }
  /** Shared "ask, then remove each" for the result-pane Delete commands. */
  async function removeEach(question, keys, fn) {
    if (!keys.length || !(await ask(question))) return cancelled;
    for (const k of keys) { const r = fn(k); if (!r.ok) { await err(r); return r; } }
    return { ok: true };
  }
  const deleteExclusions = (id, starts) => removeEach(`Do you want to delete the selected exclusion range${starts.length > 1 ? 's' : ''}?`, starts, s => M.removeExclusion(id, s));
  const deleteLeases = (id, ips) => removeEach(`Do you want to delete the selected client lease${ips.length > 1 ? 's' : ''}?\n\nThe client keeps using its address until it renews the lease.`, ips, ip => M.removeLease(id, ip));
  const deleteOptions = (id, codes) => removeEach(`Do you want to delete the selected option${codes.length > 1 ? 's' : ''}?`, codes, c => M.removeOption(id, c));
  const deleteFilters = (list, macs) => removeEach(`Do you want to delete the selected filter${macs.length > 1 ? 's' : ''} from the ${list === 'allow' ? 'Allow' : 'Deny'} list?`, macs, m => M.removeFilter(m, list));
  function deleteReservation(id, ip) {
    const s = M.scope(id), r = s && s.reservations.find(x => x.ip === ip);
    return r ? removeEach(`Do you want to delete the reservation ${resLabel(r)}?`, [ip], x => M.removeReservation(id, x)) : Promise.resolve({ ok: false });
  }

  /* ---------------- Add / Close dialogs ---------------- */
  function addDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 400, className: 'w32-dlg dhcp-dlg', closeValue: 0 });
    frame.body.appendChild(h('div.w32.dhcp-form', o.content));
    let busy = false, added = 0;
    const add = async () => {
      if (busy) return;
      busy = true; addBtn.disabled = true;
      try {
        const r = await o.add();
        if (r && r.ok === false) { if (r.error) await err(r); } else { added++; if (o.reset) o.reset(); }
      } finally { busy = false; addBtn.disabled = false; }
    };
    const addBtn = h('button.btn.primary', { onClick: add }, 'Add');
    frame.footer.append(addBtn, h('button.btn', { onClick: () => frame.close(added) }, 'Close'));
    frame.onEnter = add; frame.onEscape = () => frame.close(added);
    frame.add = add;
    if (o.onCreate) o.onCreate(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }
  function newExclusion(id, opts = {}) {
    if (!M.scope(id)) return null;
    const start = ipText('start'), end = ipText('end');
    return addDialog({ title: 'Add Exclusion Range', width: 380, onCreate: opts.onCreate,
      content: h('div', F.note('Type the IP address range that you want to exclude. If you want to exclude a single address, type an address in Start IP address only.'),
        F.row('Start IP address:', start, lw), F.row('End IP address:', end, lw)),
      add: () => M.addExclusion(id, start.value.trim(), end.value.trim() || start.value.trim()),
      reset: () => { start.value = ''; end.value = ''; start.focus(); } });
  }
  function newReservation(id, opts = {}) {
    const s = M.scope(id); if (!s) return null;
    const g = U.uid('nr');
    const name = field('name', F.text()), ip = ipText('ip', netPrefix(s)), mac = field('mac', F.text({ maxLength: 17 })), desc = field('description', F.text());
    const types = ['Both', 'Dhcp', 'Bootp'].map(t => field('type' + t, F.radio(g, { Both: 'Both', Dhcp: 'DHCP', Bootp: 'BOOTP' }[t], t === 'Both')));
    return addDialog({ title: 'New Reservation', width: 400, onCreate: opts.onCreate,
      content: h('div', F.note('Provide information for a reserved client.'), F.row('Reservation name:', name, lw), F.row('IP address:', ip, lw),
        F.row('MAC address:', mac, lw), F.row('Description:', desc, lw), F.group('Supported types', ...types)),
      add: () => {
        if (!name.value.trim()) return { ok: false, error: 'You must enter a name for the reservation.' };
        return M.addReservation(id, { name: name.value.trim(), ip: ip.value.trim(), mac: mac.value.trim(), description: desc.value.trim(), type: ['Both', 'Dhcp', 'Bootp'][types.findIndex(t => t.checked)] });
      },
      reset: () => { name.value = ''; ip.value = netPrefix(M.scope(id) || s); mac.value = ''; desc.value = ''; types[0].checked = true; name.focus(); } });
  }
  function newFilter(list, opts = {}) {
    const key = String(list).toLowerCase() === 'deny' ? 'deny' : 'allow';
    const mac = field('mac', F.text({ maxLength: 17 })), desc = field('description', F.text());
    return addDialog({ title: 'New Filter', width: 380, onCreate: opts.onCreate,
      content: h('div', F.note(`Type the MAC address of the client to add to the ${key === 'allow' ? 'Allow' : 'Deny'} list.`), F.row('MAC address:', mac, { labelWidth: 90 }), F.row('Description:', desc, { labelWidth: 90 })),
      add: () => M.addFilter(key, mac.value.trim(), desc.value.trim()),
      reset: () => { mac.value = ''; desc.value = ''; mac.focus(); } });
  }

  /* ---------------- IP address array editor (options Data entry, wizard Router / DNS / WINS pages) ---------------- */
  function dnsAnswers(ip) { return WS.net.ownIps().includes(ip) || WS.net.queryServer(ip, WS.state.system.domain || 'www.microsoft.com', 'A').status !== 'timeout'; }
  function ipList(values, o = {}) {
    const list = values.slice(), k = o.key || 'ip', title = o.title || TITLE;
    const server = o.resolve ? field(k + 'Server', F.text()) : null, ip = field(k + 'Ip', F.text());
    const box = field(k + 'List', h('select.inp.dhcp-ips', { size: o.rows || 4 }));
    box.setAttribute('data-nodirty', '');
    const btn = (label, fn) => field(k + label, F.button(label, fn, { disabled: true }));
    const addB = btn('Add', () => add()), remB = btn('Remove', () => remove()), upB = btn('Up', () => move(-1)), downB = btn('Down', () => move(1));
    const resB = server ? btn('Resolve', () => resolve()) : null;
    let off = !!o.disabled;
    const paintBtns = () => {
      const i = box.selectedIndex;
      [server, ip, box].forEach(x => { if (x) x.disabled = off; });
      addB.disabled = off || !ip.value.trim(); if (resB) resB.disabled = off || !server.value.trim();
      remB.disabled = off || i < 0; upB.disabled = off || i <= 0; downB.disabled = off || i < 0 || i >= list.length - 1;
    };
    const paint = sel => { U.clear(box); for (const x of list) box.appendChild(h('option', { value: x }, x)); box.selectedIndex = sel == null ? -1 : list.indexOf(sel); paintBtns(); };
    const notify = () => { if (o.onChange) o.onChange(list.slice()); };
    async function add() {
      const v = ip.value.trim();
      if (!U.isValidIp(v)) { await err(`${v || 'The value'} is not a valid IP address.`, title); return false; }
      if (list.includes(v)) { await err('The IP address is already in the list.', title); return false; }
      if (o.dns && !dnsAnswers(v) && !(await ask(`The following IP address does not belong to a valid DNS server:\n\n${v}\n\nDo you still want to add it?`, title))) return false;
      list.push(v); ip.value = ''; paint(v); notify(); return true;
    }
    async function resolve() {
      const name = server.value.trim(), r = WS.net.resolve(name);
      if (!r.ok) { await err(`Unable to resolve the name ${name}. Make sure that the name is spelled correctly, or type the IP address.`, title); return false; }
      ip.value = r.ip; paintBtns(); return true;
    }
    function remove() { const i = box.selectedIndex; if (i < 0) return; const [v] = list.splice(i, 1); ip.value = v; paint(list[Math.min(i, list.length - 1)]); notify(); }
    function move(d) { const i = box.selectedIndex, j = i + d; if (i < 0 || j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; paint(list[j]); notify(); }
    ip.addEventListener('input', paintBtns); if (server) server.addEventListener('input', paintBtns); box.addEventListener('change', paintBtns);
    const right = h('div.dhcp-ipcol', h('label.flabel', 'IP address:'), h('div.dhcp-line', ip, addB), h('div.dhcp-line.top', box, h('div.dhcp-btncol', remB, upB, downB)));
    const el = server ? h('div.dhcp-iped.two', h('div.dhcp-srvcol', h('label.flabel', 'Server name:'), server, h('div.dhcp-resolve', resB)), right) : h('div.dhcp-iped', right);
    paint();
    return { el, values: () => list.slice(), add, resolve, remove, move, select: v => paint(v), setDisabled: v => { off = !!v; paintBtns(); }, ip, server, box };
  }

  /* ---------------- New Scope Wizard (Wizard 97) ---------------- */
  function newScope(opts = {}) {
    if (!M.isInstalled()) return null;
    const W = 'New Scope Wizard', g = U.uid('nsw'), c = {};
    const own = WS.net.primaryIp();
    const d = { name: '', description: '', start: '', end: '', prefix: null, exclusions: [], delay: 0, leaseDays: 8, configure: 'yes', routers: [],
      domain: WS.state.system.domain || '', dns: WS.features.isInstalled('DNS') && own ? [own] : [], wins: [], activate: 'yes', scope: null };
    const radio = (key, value, label) => field(key + '-' + value, F.radio(g + key, label, d[key] === value, { onChange: v => { if (v) d[key] = value; } }));
    const lwz = { labelWidth: 100 };
    const exText = e => (e.start === e.end ? `Address ${e.start}` : `${e.start} to ${e.end}`);
    const optional = () => d.configure !== 'yes';
    const pages = [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the New Scope Wizard',
        render: () => h('div.dhcp-wtext', h('p', 'This wizard helps you set up a scope for distributing IP addresses to computers on your network.'), h('p', 'To continue, click Next.')) },
      { id: 'name', title: 'Scope Name', subtitle: 'You have to provide an identifying scope name. You also have the option of providing a description.',
        render: w => {
          c.name = field('name', F.text()); c.description = field('description', F.text());
          c.name.addEventListener('input', () => w.setNext(!!c.name.value.trim()));
          return h('div.dhcp-wz', F.note('Type a name and description for this scope. This information helps you quickly identify how the scope is to be used on your network.'),
            F.row('Name:', c.name, { labelWidth: 80 }), F.row('Description:', c.description, { labelWidth: 80 }));
        },
        enter: w => w.setNext(!!c.name.value.trim()),
        validate: () => { d.name = c.name.value.trim(); d.description = c.description.value.trim(); return d.name ? null : 'You must enter a name for the scope.'; } },
      { id: 'range', title: 'IP Address Range', subtitle: 'You define the scope address range by identifying a set of consecutive IP addresses.',
        render: () => {
          c.start = ipText('start'); c.end = ipText('end');
          c.length = field('length', F.number({ min: 8, max: 30, width: 58 })); c.mask = ipText('mask');
          let touched = false;
          c.start.addEventListener('input', () => { const v = c.start.value.trim(); if (!touched && U.isValidIp(v)) { const p = defaultPrefix(v); c.length.value = p; c.mask.value = U.prefixToMask(p); } });
          c.length.addEventListener('input', () => { touched = true; const p = +c.length.value; c.mask.value = p >= 1 && p <= 32 ? U.prefixToMask(p) : ''; });
          c.mask.addEventListener('input', () => { touched = true; const p = U.maskToPrefix(c.mask.value.trim()); if (p > 0) c.length.value = p; });
          return h('div.dhcp-wz',
            F.group('Configuration settings for DHCP Server', F.note('Enter the range of addresses that the scope distributes.'), F.row('Start IP address:', c.start, lwz), F.row('End IP address:', c.end, lwz)),
            F.group('Configuration settings that propagate to DHCP Client', F.row('Length:', c.length, lwz), F.row('Subnet mask:', c.mask, lwz)));
        },
        validate: () => {
          d.start = c.start.value.trim(); d.end = c.end.value.trim(); d.prefix = +c.length.value;
          if (c.mask.value.trim() && U.maskToPrefix(c.mask.value.trim()) !== d.prefix) return 'The subnet mask is not valid.';
          const bad = M.checkScope({ name: d.name, start: d.start, end: d.end, prefix: d.prefix });
          return bad ? bad.error : null;
        } },
      { id: 'exclusions', title: 'Add Exclusions and Delay', subtitle: 'Exclusions are addresses or a range of addresses that are not distributed by the server. A delay is the time duration by which the server will delay the transmission of a DHCPOFFER message.',
        render: () => {
          c.exStart = field('exStart', F.text({ width: 140 })); c.exEnd = field('exEnd', F.text({ width: 140 }));
          c.exList = field('exList', h('select.inp.dhcp-ips', { size: 5 }));
          c.delay = field('delay', F.number({ value: 0, min: 0, max: 1000, width: 64 }));
          const paint = () => { U.clear(c.exList); d.exclusions.forEach((e, i) => c.exList.appendChild(h('option', { value: i }, exText(e)))); rem.disabled = true; };
          const add = field('exAdd', F.button('Add', async () => {
            const a = c.exStart.value.trim(), b = c.exEnd.value.trim() || a;
            const bad = M.checkExclusion({ start: d.start, end: d.end, exclusions: d.exclusions }, a, b);
            if (bad) { await err(bad, W); return; }
            d.exclusions.push({ start: a, end: b }); d.exclusions.sort((x, y) => U.ipCompare(x.start, y.start));
            c.exStart.value = ''; c.exEnd.value = ''; paint();
          }));
          const rem = field('exRemove', F.button('Remove', () => { const i = c.exList.selectedIndex; if (i < 0) return; const [e] = d.exclusions.splice(i, 1); c.exStart.value = e.start; c.exEnd.value = e.end === e.start ? '' : e.end; paint(); }, { disabled: true }));
          c.exList.addEventListener('change', () => { rem.disabled = c.exList.selectedIndex < 0; });
          paint();
          return h('div.dhcp-wz', F.note('Type the IP address range that you want to exclude. If you want to exclude a single address, type an address in Start IP address only.'),
            h('div.dhcp-exrow', h('div', h('label.flabel', 'Start IP address:'), c.exStart), h('div', h('label.flabel', 'End IP address:'), c.exEnd), add),
            h('label.flabel', 'Excluded address range:'), h('div.dhcp-line.top', c.exList, h('div.dhcp-btncol', rem)),
            F.row('Subnet delay in milli second:', c.delay, { labelWidth: 170 }));
        },
        validate: () => {
          d.delay = +c.delay.value || 0;
          if (d.delay < 0 || d.delay > 1000 || d.delay % 1) return 'The subnet delay must be between 0 and 1000 milliseconds.';
          const out = d.exclusions.find(e => !U.inSubnet(e.start, d.start, d.prefix) || U.ipToInt(e.start) < U.ipToInt(d.start) || U.ipToInt(e.end) > U.ipToInt(d.end));
          return out ? `The exclusion range ${exText(out)} is not within the scope address range. Remove it, or go back and change the range.` : null;
        } },
      { id: 'lease', title: 'Lease Duration', subtitle: 'The lease duration specifies how long a client can use an IP address from this scope.',
        render: () => h('div.dhcp-wz',
          F.note('Lease durations should typically be equal to the average time the computer is connected to the same physical network. For mobile networks that consist mainly of portable computers or dial-up clients, shorter lease durations can be useful.'),
          F.note('Likewise, for a stable network that consists mainly of desktop computers at fixed locations, longer lease durations are more appropriate.'),
          F.note('Set the duration for scope leases when distributed by this server.'), h('div', 'Limited to:'), leaseGrid(c, { days: 8, hours: 0, minutes: 0 })),
        validate: () => { const v = leaseValue(c); if (v.error) return v.error; d.leaseDays = v.days; return null; } },
      { id: 'options', title: 'Configure DHCP Options', subtitle: 'You have to configure the most common DHCP options before clients can use the scope.',
        render: () => h('div.dhcp-wz',
          F.note('When clients obtain an address, they are given DHCP options such as the IP addresses of routers (default gateways), DNS servers, and WINS settings for that scope.'),
          F.note('The settings you select here are for this scope and override settings configured in the Server Options folder for this server.'),
          F.note('Do you want to configure the DHCP options for this scope now?'),
          radio('configure', 'yes', 'Yes, I want to configure these options now'), radio('configure', 'no', 'No, I will configure these options later')) },
      { id: 'router', title: 'Router (Default Gateway)', subtitle: 'You can specify the routers, or default gateways, to be distributed by this scope.', skip: optional,
        render: () => { c.routers = ipList(d.routers, { key: 'router', title: W, rows: 5, onChange: v => { d.routers = v; } }); return h('div.dhcp-wz', F.note('To add an IP address for a router used by clients, enter the address below.'), c.routers.el); } },
      { id: 'dns', title: 'Domain Name and DNS Servers', subtitle: 'The Domain Name System (DNS) maps and translates domain names used by clients on your network.', skip: optional,
        render: () => {
          c.domain = field('domain', F.text({ value: d.domain }));
          c.dns = ipList(d.dns, { key: 'dns', resolve: true, dns: true, title: W, onChange: v => { d.dns = v; } });
          return h('div.dhcp-wz', F.note('You can specify the parent domain you want the client computers on your network to use for DNS name resolution.'),
            F.row('Parent domain:', c.domain, { labelWidth: 90 }), F.note('To configure scope clients to use DNS servers on your network, enter the IP addresses for those servers.'), c.dns.el);
        },
        validate: () => { d.domain = c.domain.value.trim(); return null; } },
      { id: 'wins', title: 'WINS Servers', subtitle: 'Computers running Windows can use WINS servers to convert NetBIOS computer names to IP addresses.', skip: optional,
        render: () => {
          c.wins = ipList(d.wins, { key: 'wins', resolve: true, title: W, onChange: v => { d.wins = v; } });
          return h('div.dhcp-wz', F.note('Entering server IP addresses here enables Windows clients to query WINS before they use broadcasts to register and resolve NetBIOS names.'), c.wins.el,
            F.note('To change this behavior for Windows DHCP clients modify option 046, WINS/NBT Node Type, in Scope Options.'));
        } },
      { id: 'activate', title: 'Activate Scope', subtitle: 'Clients can obtain address leases only if a scope is activated.', skip: optional,
        render: () => h('div.dhcp-wz', F.note('Do you want to activate this scope now?'), radio('activate', 'yes', 'Yes, I want to activate this scope now'), radio('activate', 'no', 'No, I will activate this scope later')) },
      { id: 'complete', kind: 'complete', title: 'Completing the New Scope Wizard',
        render: () => h('div.dhcp-wtext', h('p', 'You have successfully completed the New Scope Wizard.'), h('p', 'To close this wizard, click Finish.')) }
    ];
    return WS.ui.wizard({ title: W, style: 'classic', icon: ICON.scope, width: 560, height: 470, data: d, pages, onCreate: w => { if (opts.onCreate) opts.onCreate(w, d); },
      onFinish: () => {
        const r = M.addScope({ name: d.name, description: d.description, start: d.start, end: d.end, prefix: d.prefix, leaseDays: d.leaseDays, active: false });
        if (!r.ok) return r;
        const id = r.scope.id, undo = x => { M.removeScope(id); return x; };
        for (const e of d.exclusions) { const x = M.addExclusion(id, e.start, e.end); if (!x.ok) return undo(x); }
        if (d.delay) M.setScope(id, { delay: d.delay });
        if (d.configure === 'yes') {
          for (const [code, v] of [[3, d.routers], [6, d.dns], [44, d.wins]]) if (v.length) { const x = M.setOption(id, code, v); if (!x.ok) return undo(x); }
          if (d.domain) M.setOption(id, 15, d.domain);
        }
        M.setScope(id, { active: d.configure === 'yes' && d.activate === 'yes' });
        d.scope = M.scope(id);
        return { ok: true };
      } });
  }

  /* ---------------- Scope Options / Server Options ---------------- */
  function configureOptions(id, opts = {}) {
    if (id != null && !M.scope(id)) return null;
    const title = id == null ? 'Server Options' : 'Scope Options';
    const saved = () => (id == null ? M.serverOptions() : M.scope(id).options);
    const first = saved(), codes = Object.keys(M.OPTIONS).map(Number).sort((a, b) => a - b);
    const on = new Set(Object.keys(first).map(Number).filter(x => M.OPTIONS[x]));
    const draft = {};
    for (const x of codes) draft[x] = x in first ? first[x] : M.OPTIONS[x].type === 'ip[]' ? [] : M.OPTIONS[x].type === 'string' ? '' : 0;
    let sel = M.OPTIONS[opts.select] ? +opts.select : codes[0], sheet, listEl, entry, editor = null;
    const rows = {};
    const typeOf = x => M.OPTIONS[x].type;
    function select(x) { sel = x; for (const k of codes) rows[k].classList.toggle('sel', k === x); scrollTo(rows[x]); paintEntry(); }
    const scrollTo = r => { const top = r.offsetTop - 22; if (top < listEl.scrollTop) listEl.scrollTop = top; else if (r.offsetTop + r.offsetHeight > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = r.offsetTop + r.offsetHeight - listEl.clientHeight; };
    function paintEntry() {
      U.clear(entry); editor = null;
      const x = sel, t = typeOf(x), enabled = on.has(x);
      if (t === 'ip[]') {
        editor = ipList([].concat(draft[x]), { key: 'opt', resolve: true, dns: x === 6, title, disabled: !enabled, onChange: v => { draft[x] = v; sheet.setDirty(); } });
        entry.appendChild(editor.el);
      } else {
        const input = field('optValue', F.text({ value: t === 'string' ? draft[x] : typeof draft[x] === 'number' ? hex(draft[x]) : draft[x], disabled: !enabled }));
        input.addEventListener('input', () => { draft[x] = input.value; });
        entry.appendChild(F.stack(t === 'string' ? 'String value:' : t === 'byte' ? 'Byte:' : 'Long:', input));
      }
    }
    function toggle(x, value) { if (value) on.add(x); else on.delete(x); rows[x].querySelector('input').checked = value; sheet.setDirty(); select(x); }
    return WS.ui.propertySheet({ title, width: 460, errorTitle: TITLE, onCreate: s => { sheet = s; s.select = select; s.toggle = toggle; s.editor = () => editor; if (opts.onCreate) opts.onCreate(s); },
      tabs: [
        { label: 'General', render: () => {
          listEl = h('div.dhcp-optlist', { tabIndex: 0 }, h('div.dhcp-opthead', h('span', 'Available Options'), h('span', 'Description')));
          for (const x of codes) {
            const box = field('opt-' + x, h('input', { type: 'checkbox', checked: on.has(x) }));
            box.addEventListener('change', () => toggle(x, box.checked));
            rows[x] = h('div.dhcp-optrow', { dataset: { code: x }, onClick: e => { if (e.target !== box) select(x); } }, h('span.dhcp-optname', box, h('span', optName(x))), h('span.dhcp-optdesc', M.OPTIONS[x].description || ''));
            listEl.appendChild(rows[x]);
          }
          listEl.addEventListener('keydown', e => {
            const i = codes.indexOf(sel);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); select(codes[U.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, codes.length - 1)]); }
            else if (e.key === ' ') { e.preventDefault(); toggle(sel, !on.has(sel)); }
          });
          entry = h('div.dhcp-entry');
          select(sel);
          return h('div.dhcp-form', listEl, F.group('Data entry', entry));
        }, apply: () => {
          const cur = saved();
          for (const x of codes) {
            if (on.has(x)) {
              const t = typeOf(x), v = draft[x];
              if (t === 'ip[]' && ![].concat(v).length) return `Option ${optName(x)} requires at least one IP address. Add an IP address, or clear the check box for this option.`;
              if (t === 'string' && !String(v).trim()) return `Enter a value for option ${optName(x)}, or clear the check box for this option.`;
              if (JSON.stringify(v) !== JSON.stringify(cur[x])) { const r = M.setOption(id, x, v); if (!r.ok) return r; }
            } else if (x in cur) { const r = M.removeOption(id, x); if (!r.ok) return r; }
          }
          return null;
        } },
        { label: 'Advanced', render: () => h('div.dhcp-form',
          F.row('Vendor class:', F.select(['DHCP Standard Options', 'Microsoft Windows 2000 Options', 'Microsoft Options'], 'DHCP Standard Options', { disabled: true })),
          F.row('User class:', F.select(['Default User Class', 'Default BOOTP Class', 'Default Network Access Protection Class', 'Default Routing and Remote Access Class'], 'Default User Class', { disabled: true })),
          F.note('Options for vendor and user classes are not modelled in this lab. Use the General tab for the DHCP Standard Options.')) }
      ] });
  }

  /* ---------------- property sheets ---------------- */
  function dnsTab(level) {
    const g = U.uid('dns'), off = { disabled: true };
    return h('div.dhcp-form',
      F.checkbox('Enable DNS dynamic updates according to the settings below:', true, off),
      h('div.dhcp-indent', F.radio(g, 'Dynamically update DNS records only if requested by the DHCP clients', true, off), F.radio(g, 'Always dynamically update DNS records', false, off)),
      F.checkbox('Discard A and PTR records when lease is deleted', true, off),
      F.checkbox('Dynamically update DNS records for DHCP clients that do not request updates (for example, clients running Windows NT 4.0)', false, off),
      F.checkbox('Disable dynamic updates for DNS PTR records', false, off),
      F.group('Name Protection', F.note(`DHCP name protection is disabled at the ${level} level.`), h('div.dhcp-right', F.button('Configure...', () => {}, off))));
  }
  function scopeProperties(id, opts = {}) {
    const s = M.scope(id); if (!s) return null;
    const c = {}, g = U.uid('sp');
    return WS.ui.propertySheet({ title: `${scopeLabel(s)} Properties`, width: 440, errorTitle: TITLE, onCreate: opts.onCreate, initialTab: opts.tab === 'Advanced' ? 2 : opts.tab === 'DNS' ? 1 : 0,
      tabs: [
        { label: 'General', render: () => {
          c.name = field('name', F.text({ value: s.name })); c.start = ipText('start', s.start); c.end = ipText('end', s.end);
          c.limited = field('limited', F.radio(g, 'Limited to:', !s.leaseUnlimited)); c.unlimited = field('unlimited', F.radio(g, 'Unlimited', !!s.leaseUnlimited));
          c.description = field('description', F.text({ value: s.description }));
          const grid = leaseGrid(c, splitLease(s.leaseDays), !!s.leaseUnlimited);
          const paint = () => [c.days, c.hours, c.minutes].forEach(x => { x.disabled = c.unlimited.checked; });
          c.limited.input.addEventListener('change', paint); c.unlimited.input.addEventListener('change', paint);
          return h('div.dhcp-form', F.row('Scope name:', c.name, lw), F.row('Start IP address:', c.start, lw), F.row('End IP address:', c.end, lw),
            F.row('Length:', F.number({ value: s.prefix, disabled: true, width: 58 }), lw), F.row('Subnet mask:', Object.assign(F.text({ value: s.mask || U.prefixToMask(s.prefix), readOnly: true }), { className: 'inp dhcp-ipf' }), lw),
            F.group('Lease duration for DHCP clients', c.limited, grid, c.unlimited), F.row('Description:', c.description, lw));
        }, apply: () => {
          const name = c.name.value.trim(), start = c.start.value.trim(), end = c.end.value.trim();
          if (!name) return 'You must enter a name for the scope.';
          if (!U.isValidIp(start) || !U.isValidIp(end)) return 'The IP address is not valid.';
          if (start === s.id || end === U.broadcastOf(s.id, s.prefix)) return 'The range of IP addresses includes the subnet ID or the broadcast address. Enter a valid range of IP addresses.';
          const props = { name, description: c.description.value, start, end, leaseUnlimited: c.unlimited.checked };
          if (!c.unlimited.checked) { const v = leaseValue(c); if (v.error) return v.error; props.leaseDays = v.days; }
          return M.setScope(id, props);
        } },
        { label: 'DNS', render: () => dnsTab('scope') },
        { label: 'Advanced', render: () => {
          const t = s.type || 'Dhcp', tg = g + 't', bg = g + 'b';
          [c.dhcp, c.bootp, c.both] = [['Dhcp', 'DHCP only'], ['Bootp', 'BOOTP only'], ['Both', 'Both']].map(([v, l]) => field('type' + v, F.radio(tg, l, t === v)));
          c.delay = field('delay', F.number({ value: s.delay || 0, min: 0, max: 1000, width: 64 }));
          const bootp = [F.radio(bg, 'Limited to:', true), leaseGrid({}, { days: 30, hours: 0, minutes: 0 }, true, 'bootp'), F.radio(bg, 'Unlimited', false)];
          const paint = () => { const off = c.dhcp.checked; bootp[0].input.disabled = bootp[2].input.disabled = off; bootp.forEach(x => x.classList.toggle('disabled', off)); };
          [c.dhcp, c.bootp, c.both].forEach(x => x.input.addEventListener('change', paint));
          setTimeout(paint, 0);
          return h('div.dhcp-form', F.group('Assign IP addresses dynamically to clients of:', c.dhcp, c.bootp, c.both), F.group('Lease duration for BOOTP clients', ...bootp),
            F.row('Delay in milli seconds:', c.delay, { labelWidth: 140 }));
        }, apply: () => {
          const type = c.bootp.checked ? 'Bootp' : c.both.checked ? 'Both' : 'Dhcp', delay = +c.delay.value || 0;
          return type === (s.type || 'Dhcp') && delay === (s.delay || 0) ? null : M.setScope(id, { type, delay });
        } }
      ] });
  }
  function reservationProperties(id, ip, opts = {}) {
    const s = M.scope(id), r = s && s.reservations.find(x => x.ip === ip); if (!r) return null;
    const c = {}, g = U.uid('rp');
    return WS.ui.propertySheet({ title: `${resLabel(r)} Properties`, width: 420, errorTitle: TITLE, onCreate: opts.onCreate,
      tabs: [
        { label: 'General', render: () => {
          c.name = field('name', F.text({ value: r.name })); c.mac = field('mac', F.text({ value: r.mac, maxLength: 17 })); c.description = field('description', F.text({ value: r.description }));
          c.types = ['Both', 'Dhcp', 'Bootp'].map(t => field('type' + t, F.radio(g, { Both: 'Both', Dhcp: 'DHCP', Bootp: 'BOOTP' }[t], (r.type || 'Both') === t)));
          return h('div.dhcp-form', h('div.dhcp-header', h('span', { html: ICON.reservation }), resLabel(r)), F.row('Reservation name:', c.name, lw), F.row('IP address:', F.text({ value: r.ip, readOnly: true }), lw),
            F.row('MAC address:', c.mac, lw), F.row('Description:', c.description, lw), F.group('Supported types', ...c.types));
        }, apply: () => {
          if (!c.name.value.trim()) return 'You must enter a name for the reservation.';
          return M.setReservation(id, ip, { name: c.name.value.trim(), mac: c.mac.value.trim(), description: c.description.value.trim(), type: ['Both', 'Dhcp', 'Bootp'][c.types.findIndex(t => t.checked)] });
        } },
        { label: 'DNS', render: () => dnsTab('scope') }
      ] });
  }
  function ipv4Properties(opts = {}) {
    if (!M.isInstalled()) return null;
    const c = {}, off = { disabled: true }, tabs = ['General', 'DNS', 'Filters', 'Failover', 'Advanced'];
    return WS.ui.propertySheet({ title: 'IPv4 Properties', width: 440, errorTitle: TITLE, onCreate: opts.onCreate, initialTab: Math.max(0, tabs.indexOf(opts.tab)),
      tabs: [
        { label: 'General', render: () => h('div.dhcp-form',
          F.checkbox('Automatically update statistics every:', false, off), h('div.dhcp-lease.dhcp-indent', h('label', 'Hours:', F.number({ value: 0, width: 58, disabled: true })), h('label', 'Minutes:', F.number({ value: 10, width: 58, disabled: true }))),
          F.checkbox('Enable DHCP audit logging', true, off), F.note('Audit logging records server activity in a file every day.'),
          F.checkbox('Show the BOOTP table folder', false, off)) },
        { label: 'DNS', render: () => dnsTab('server') },
        { label: 'Filters', render: () => {
          const f = M.filters();
          c.allow = field('allowEnabled', F.checkbox('Enable Allow list', f.allowEnabled)); c.deny = field('denyEnabled', F.checkbox('Enable Deny list', f.denyEnabled));
          return h('div.dhcp-form', F.note('Use MAC address filters to control which clients this server leases addresses to. Add the filters themselves in the Allow and Deny folders under Filters.'),
            F.group('Allow', F.note('When the Allow list is enabled, the server leases addresses only to clients whose MAC addresses are in the Allow list.'), c.allow),
            F.group('Deny', F.note('When the Deny list is enabled, the server does not lease addresses to clients whose MAC addresses are in the Deny list.'), c.deny));
        }, apply: () => {
          const f = M.filters();
          return f.allowEnabled === c.allow.checked && f.denyEnabled === c.deny.checked ? null : M.setFilterList({ allow: c.allow.checked, deny: c.deny.checked });
        } },
        { label: 'Failover', render: () => h('div.dhcp-form', F.note('Failover relationships on this server:'), h('div.dhcp-box', F.note('This server has no failover relationships.')),
          h('div.dhcp-right', F.button('Add...', soon('Configure Failover')), F.button('Edit...', () => {}, off), F.button('Delete', () => {}, off))) },
        { label: 'Advanced', render: () => h('div.dhcp-form',
          F.row('Conflict detection attempts:', F.number({ value: 0, width: 58, disabled: true }), { labelWidth: 160 }),
          F.stack('Audit log file path:', h('div.dhcp-line', F.text({ value: 'C:\\Windows\\system32\\dhcp', readOnly: true }), F.button('Browse...', () => {}, off))),
          F.row('Change server connection bindings:', F.button('Bindings...', soon('Server Bindings')), { labelWidth: 220 }),
          F.row('DNS dynamic update registration credentials:', F.button('Credentials...', () => {}, off), { labelWidth: 220 })) }
      ] });
  }
  function serverProperties(opts = {}) {
    if (!M.isInstalled()) return null;
    return WS.ui.propertySheet({ title: `${fqdn()} Properties`, width: 420, errorTitle: TITLE, onCreate: opts.onCreate,
      tabs: [{ label: 'General', render: () => h('div.dhcp-form', h('div.dhcp-header', h('span', { html: ICON.server }), fqdn()),
        F.stack('Database path:', F.text({ value: 'C:\\Windows\\system32\\dhcp', readOnly: true })), F.stack('Backup path:', F.text({ value: 'C:\\Windows\\system32\\dhcp\\backup', readOnly: true })),
        F.row('DHCP Server service:', F.value(running() ? 'Running' : 'Stopped')), WS.sys.isDC() ? F.row('Authorization:', F.value(M.authorized ? 'Authorized in Active Directory' : 'Not authorized')) : null) }] });
  }

  /* ---------------- Display Statistics, Reconcile, Add Server ---------------- */
  function statRows(id) {
    const st = M.statistics(id); if (!st) return [];
    const pct = n => (st.totalAddresses ? Math.floor(n * 100 / st.totalAddresses) : 0);
    const up = Math.max(0, Math.floor((Date.now() - new Date(st.startTime).getTime()) / 1000));
    const rows = id ? [] : [['Start Time', U.fmtDateTime(st.startTime)], ['Up Time', `${Math.floor(up / 86400)} Days, ${Math.floor(up % 86400 / 3600)} Hours, ${Math.floor(up % 3600 / 60)} Minutes, ${up % 60} Seconds`],
      ['Discovers', st.discovers], ['Offers', st.offers], ['Delayed Offers', st.delayedOffers], ['Requests', st.requests], ['Acks', st.acks], ['Nacks', st.nacks],
      ['Declines', st.declines], ['Releases', st.releases], ['Total Scopes', st.totalScopes], ['Scopes with delay configured', st.scopesWithDelay]];
    rows.push(['Total Addresses', st.totalAddresses], ['In Use', `${st.inUse} (${pct(st.inUse)}%)`], ['Available', `${st.available} (${pct(st.available)}%)`]);
    return rows.map(([label, value]) => ({ label, value: String(value) }));
  }
  function statistics(id, opts = {}) {
    if (!running() || (id != null && !M.scope(id))) return null;
    const list = WS.ui.listView({ columns: [{ key: 'label', label: 'Description', width: 190 }, { key: 'value', label: 'Details', width: 270 }], rows: () => statRows(id), getId: r => r.label, sortKey: null, multi: false });
    list.el.classList.add('dhcp-stats');
    const frame = WS.ui.modal({ title: id ? `Scope ${id} Statistics` : `Server ${fqdn()} Statistics`, width: 520, className: 'w32-dlg dhcp-dlg' });
    frame.body.appendChild(h('div.w32', list.el));
    frame.footer.append(h('button.btn', { onClick: () => list.refresh() }, 'Refresh'), h('button.btn.primary', { onClick: () => frame.close() }, 'Close'));
    frame.onEscape = frame.onEnter = () => frame.close();
    frame.list = list;
    if (opts.onCreate) opts.onCreate(frame);
    return frame.promise;
  }
  async function reconcile(id, opts = {}) {
    const s = id != null ? M.scope(id) : null; if (id != null && !s) return false;
    const a = await WS.ui.dialog({ title: s ? 'Reconcile' : 'Reconcile All Scopes', width: 420, onCreate: opts.onCreate,
      content: h('div.w32', F.note(s ? `Scope: ${scopeLabel(s)}` : `Server: ${fqdn()} (all IPv4 scopes)`),
        F.note('Inconsistencies found in the DHCP database are reconciled with the information in the registry. To check the database for inconsistencies, click Verify.')),
      buttons: [{ label: 'Verify', primary: true }, { label: 'Cancel', cancel: true }] });
    if (a !== 'Verify') return false;
    await WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'The database is consistent.' });
    return true;
  }
  async function addServer(opts = {}) {
    const g = U.uid('as');
    const thisOne = field('thisServer', F.radio(g, 'This server:', true)), name = field('name', F.text());
    const authorizedOne = field('authorizedServer', F.radio(g, 'This authorized DHCP server:', false, { disabled: !WS.sys.isDC() }));
    const list = field('authorizedList', h('select.inp.dhcp-ips', { size: 4 }, ...(M.authorized && WS.sys.isDC() ? [h('option', { value: fqdn() }, `${fqdn()}    ${WS.net.primaryIp() || ''}`)] : [])));
    const a = await WS.ui.dialog({ title: 'Add Server', width: 420, onCreate: opts.onCreate,
      content: h('div.w32.dhcp-form', F.note('Select a server you want to add to your console.'), thisOne, h('div.dhcp-line.dhcp-indent', name, F.button('Browse...', () => {}, { disabled: true })), authorizedOne, h('div.dhcp-indent', list)),
      buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
    if (a !== 'OK') return { ok: false, cancelled: true };
    const target = (thisOne.checked ? name.value : list.value || '').trim().toLowerCase();
    const me = [WS.sys.name.toLowerCase(), fqdn(), WS.net.primaryIp(), 'localhost', '127.0.0.1'];
    if (!target || !me.includes(target) || !M.isInstalled()) { await err(`The DHCP server ${target || '(none)'} cannot be contacted. The RPC server is unavailable.`); return { ok: false }; }
    if (opts.console) opts.console.setRemoved(false);
    return { ok: true };
  }

  /* ---------------- console tree and result panes ---------------- */
  function pathTo(id) {
    const srv = ['dhcp-root', 'dhcp-srv'], v4 = [...srv, 'dhcp-v4'];
    if (id === 'dhcp-root') return ['dhcp-root'];
    if (id === 'dhcp-srv') return srv;
    if (id.startsWith('dhcp-v6')) return id === 'dhcp-v6' ? [...srv, id] : [...srv, 'dhcp-v6', id];
    if (id === 'dhcp-v4') return v4;
    const m = id.match(/^dhcp-(scope|pool|leases|res|resv|sopt|spol):([\d.]+)/);
    if (m) { const p = [...v4, 'dhcp-scope:' + m[2]]; if (m[1] === 'scope') return p; if (m[1] === 'resv') p.push('dhcp-res:' + m[2]); return [...p, id]; }
    if (id === 'dhcp-allow' || id === 'dhcp-deny') return [...v4, 'dhcp-filters', id];
    return [...v4, id];
  }

  function consoleNodes(ctl) {
    const shown = () => M.isInstalled() && !ctl.serverRemoved;
    const serverIcon = () => badge(I.server, !running() ? 'stop' : unauthorized() ? 'down' : 'check');
    /** A result pane that lists child nodes (the real snap-in's "Contents of ..." views). */
    const folderView = (column, kids, extra = [], more = {}) => ({ columns: [{ key: 'label', label: column, width: 300 }, ...extra], rows: kids, getId: n => n.id, icon: n => n.icon, sortKey: null,
      onActivate: n => ctl.open(n.id), itemLabel: n => n.label,
      menu: rows => (rows.length === 1 ? [...(rows[0].menu ? rows[0].menu() : []), { separator: true }, rows[0].properties ? { label: 'P&roperties', action: () => rows[0].properties() } : null] : []),
      ...more });
    const text = (...lines) => info(() => lines);

    const root = () => ({ id: 'dhcp-root', label: 'DHCP', icon: ICON.root, expanded: true, children: () => (shown() ? [server()] : []),
      menu: () => [{ label: '&Add Server...', action: () => addServer({ console: ctl }) }, WS.sys.isDC() ? { label: '&Manage authorized servers...', action: soon('Manage Authorized Servers') } : null],
      view: () => (shown() ? folderView('Contents of DHCP', () => [server()]) : text('Add a DHCP Server', 'To manage a DHCP server, you must first add it to the console.',
        'To add a DHCP server, on the Action menu, click Add Server.', HELP)) });

    const server = () => ({ id: 'dhcp-srv', label: fqdn(), icon: serverIcon(), expanded: true, children: () => (running() ? [v4(), v6()] : []),
      menu: serverMenu, properties: () => serverProperties(),
      view: () => (!running() ? info(() => ['Cannot find the DHCP Server', `The DHCP console cannot connect to the DHCP Server service on ${fqdn()}. The RPC server is unavailable.`,
        'Make sure that the DHCP Server service is running. To start it, on the Action menu, point to All Tasks, and then click Start.', HELP])
        : unauthorized() ? text('Authorize the DHCP Server', 'Before a DHCP server can issue IP addresses, it must be authorized in Active Directory.',
          'Authorizing a DHCP server is a security precaution that ensures that only authorized DHCP servers run on your network.',
          'To authorize this DHCP server, on the Action menu, click Authorize.',
          'Authorization may take a few moments to complete. For a status update, either press F5 to refresh the console window, or on the Action menu, click Refresh.', HELP)
          : folderView('Contents of DHCP Server', () => [v4(), v6()], [{ key: 'status', label: 'Status', width: 120 }])) });
    function serverMenu() {
      const run = running();
      return [
        { label: 'Add/Remove &Bindings...', disabled: !run, action: soon('Server Bindings') },
        { separator: true },
        { label: '&Backup...', disabled: !run, action: soon('DHCP Backup') },
        { label: 'Rest&ore...', disabled: !run, action: soon('DHCP Restore') },
        { separator: true },
        WS.sys.isDC() ? (M.authorized ? { label: 'Unauthori&ze', disabled: !run, action: () => unauthorize() } : { label: 'Authori&ze', disabled: !run, action: () => authorize() }) : null,
        { separator: true },
        { label: 'Define &User Classes...', disabled: !run, action: soon('Define User Classes') },
        { label: 'Define &Vendor Classes...', disabled: !run, action: soon('Define Vendor Classes') },
        { label: 'Reconcile &All Scopes...', disabled: !run, action: () => reconcile() },
        { label: 'Set &Predefined Options...', disabled: !run, action: soon('Predefined Options and Values') },
        { separator: true },
        { label: 'All Tas&ks', items: () => [
          { label: '&Start', disabled: run, action: () => service('start') },
          { label: 'S&top', disabled: !run, action: () => service('stop') },
          { label: '&Pause', disabled: true },
          { label: 'R&esume', disabled: true },
          { label: 'Rest&art', disabled: !run, action: () => service('restart') }] },
        { separator: true },
        { label: '&Delete', icon: I.delete, action: () => ctl.removeServer() }
      ];
    }

    const v4 = () => ({ id: 'dhcp-v4', label: 'IPv4', icon: badge(ICON.ipv4, unauthorized() ? 'down' : 'check'), status: '',
      children: () => [...M.scopes().map(scope), options(null), policies('dhcp-v4pol'), filters()],
      menu: () => [
        { label: 'Display &Statistics...', action: () => statistics() },
        { separator: true },
        { label: 'New Sco&pe...', icon: I.newItem, action: () => newScope() },
        { label: 'New Su&perscope...', disabled: !M.scopes().length, action: soon('New Superscope Wizard') },
        { label: 'New &Multicast Scope...', action: soon('New Multicast Scope Wizard') },
        { separator: true },
        { label: 'Con&figure Failover...', disabled: !M.scopes().length, action: soon('Configure Failover') },
        { label: 'Replicate Failover Scopes...', disabled: true },
        { separator: true },
        { label: 'Define &User Classes...', action: soon('Define User Classes') },
        { label: 'Define &Vendor Classes...', action: soon('Define Vendor Classes') },
        { label: '&Reconcile All Scopes...', action: () => reconcile() },
        { label: 'Set Predefined &Options...', action: soon('Predefined Options and Values') }
      ],
      properties: () => ipv4Properties(),
      view: () => (M.scopes().length ? folderView('Contents of DHCP Server', () => [...M.scopes().map(scope), options(null), policies('dhcp-v4pol'), filters()],
        [{ key: 'status', label: 'Status', width: 110 }, { key: 'description', label: 'Description', width: 220 }],
        { delete: rows => { const sc = rows.filter(n => n.scopeId); if (sc.length === 1) deleteScope(sc[0].scopeId); } })
        : text('Add a Scope', 'A scope is a range of IP addresses assigned to computers requesting a dynamic IP address. You must create and configure a scope before dynamic IP addresses can be assigned.',
          'To add a new scope, on the Action menu, click New Scope.', HELP)) });

    const v6 = () => ({ id: 'dhcp-v6', label: 'IPv6', icon: badge(ICON.ipv6, unauthorized() ? 'down' : 'check'), status: '',
      children: () => [{ id: 'dhcp-v6opt', label: 'Server Options', icon: ICON.options, menu: () => [{ label: 'Configure &Options...', action: soon('Server Options (IPv6)') }],
        view: { columns: optionColumns, rows: () => [], getId: r => r.id } }],
      menu: () => [
        { label: 'Display &Statistics...', action: soon('IPv6 Statistics') },
        { separator: true },
        { label: 'New Sco&pe...', action: soon('New Scope Wizard (IPv6)') },
        { separator: true },
        { label: 'Define &User Classes...', action: soon('Define User Classes') },
        { label: 'Define &Vendor Classes...', action: soon('Define Vendor Classes') },
        { label: 'Set Predefined &Options...', action: soon('Predefined Options and Values') }
      ],
      properties: soon('IPv6 Properties'),
      view: () => text('Add a Scope', 'A scope is a range of IPv6 addresses assigned to computers requesting a dynamic IPv6 address. You must create and configure a scope before dynamic IPv6 addresses can be assigned.',
        'To add a new scope, on the Action menu, click New Scope.', HELP) });

    const scope = s => ({ id: 'dhcp-scope:' + s.id, scopeId: s.id, label: scopeLabel(s), icon: s.active ? ICON.scope : ICON.scopeInactive,
      status: s.active ? '** Active **' : '** Inactive **', description: s.description,
      children: () => scopeKids(s.id), menu: () => scopeMenu(s.id), properties: () => scopeProperties(s.id),
      view: () => folderView('Contents of Scope', () => scopeKids(s.id)) });
    function scopeMenu(id) {
      const s = M.scope(id); if (!s) return [];
      return [
        { label: 'Display &Statistics...', action: () => statistics(id) },
        { separator: true },
        { label: 'Con&figure Failover...', action: soon('Configure Failover') },
        { separator: true },
        { label: '&Reconcile...', action: () => reconcile(id) },
        s.active ? { label: 'De&activate', action: () => setActive(id, false) } : { label: '&Activate', action: () => setActive(id, true) },
        { separator: true },
        { label: '&Delete', icon: I.delete, action: () => deleteScope(id) }
      ];
    }
    const scopeKids = id => {
      const s = M.scope(id); if (!s) return [];
      return [
        { id: 'dhcp-pool:' + id, label: 'Address Pool', icon: ICON.pool, menu: () => [{ label: 'New &Exclusion Range...', action: () => newExclusion(id) }], view: () => poolView(id) },
        { id: 'dhcp-leases:' + id, label: 'Address Leases', icon: ICON.leases, view: () => leasesView(id) },
        reservations(id), options(id), policies('dhcp-spol:' + id)
      ];
    };

    const poolView = id => ({
      columns: [{ key: 'start', label: 'Start IP Address', width: 130, type: 'ip' }, { key: 'end', label: 'End IP Address', width: 130, type: 'ip' }, { key: 'description', label: 'Description', width: 280 }],
      rows: () => { const s = M.scope(id); return s ? [{ id: 'range', start: s.start, end: s.end, description: 'Address range for distribution' },
        ...s.exclusions.slice().sort((a, b) => U.ipCompare(a.start, b.start)).map(e => ({ id: 'ex:' + e.start, start: e.start, end: e.end, exclusion: true, description: 'IP Addresses excluded from distribution' }))] : []; },
      getId: r => r.id, icon: r => (r.exclusion ? ICON.exclusion : ICON.range), sortKey: null, itemLabel: r => `${r.start} - ${r.end}`,
      menu: rows => (rows.length ? [{ label: '&Delete', icon: I.delete, disabled: !rows.every(r => r.exclusion), action: () => deleteExclusions(id, rows.map(r => r.start)) }]
        : [{ label: 'New &Exclusion Range...', action: () => newExclusion(id) }]),
      delete: rows => { if (rows.every(r => r.exclusion)) deleteExclusions(id, rows.map(r => r.start)); },
      toolbar: [{ icon: I.newItem, title: 'New Exclusion Range', action: () => newExclusion(id) }]
    });

    function leaseRows(id) {
      const s = M.scope(id); if (!s) return [];
      const base = (ip, mac) => ({ id: ip, ip, uid: uniqueId(mac), nap: 'N/A', probation: 'N/A', filter: { allow: 'Allow', deny: 'Deny' }[M.filterOf(mac)] || 'None' });
      const rows = s.leases.map(l => {
        const r = s.reservations.find(x => x.ip === l.ip && x.mac === l.mac);
        return { ...base(l.ip, l.mac), lease: l, reservation: r || null, name: r ? r.name : l.hostname, type: r ? TYPE_LABEL[r.type || 'Both'] : 'DHCP', description: r ? r.description : '',
          expires: r ? 'Reservation (active)' : l.expires ? U.fmtDateTime(l.expires) : 'Unlimited' };
      });
      for (const r of s.reservations) if (!rows.some(x => x.ip === r.ip)) rows.push({ ...base(r.ip, r.mac), reservation: r, name: r.name, type: TYPE_LABEL[r.type || 'Both'], description: r.description, expires: 'Reservation (inactive)' });
      return rows;
    }
    const leasesView = id => ({
      columns: [{ key: 'ip', label: 'Client IP Address', width: 120, type: 'ip' }, { key: 'name', label: 'Name', width: 170 }, { key: 'expires', label: 'Lease Expiration', width: 150 },
        { key: 'type', label: 'Type', width: 92 }, { key: 'uid', label: 'Unique ID', width: 110 }, { key: 'description', label: 'Description', width: 110 },
        { key: 'nap', label: 'Network Access Protection', width: 150 }, { key: 'probation', label: 'Probation Expiration', width: 120 }, { key: 'filter', label: 'Filter', width: 60 }],
      rows: () => leaseRows(id), getId: r => r.id, icon: r => (r.reservation ? ICON.reservation : ICON.lease), sortKey: 'ip', itemLabel: r => r.ip,
      menu: rows => {
        if (!rows.length) return [];
        const r = rows[0], one = rows.length === 1;
        return [
          { label: 'Add to &Reservation', disabled: !one || !!r.reservation || !r.lease, action: async () => { const x = M.addReservation(id, { ip: r.ip, mac: r.lease.mac, name: r.name }); if (!x.ok) await err(x); } },
          { label: 'Add to &Filter', disabled: !one, items: () => ['allow', 'deny'].map(k => ({ label: k === 'allow' ? '&Allow' : '&Deny', action: async () => {
            const x = M.addFilter(k, (r.lease || r.reservation).mac, r.name); if (!x.ok) await err(x); } })) },
          { separator: true },
          { label: '&Delete', icon: I.delete, disabled: rows.some(x => !x.lease), action: () => deleteLeases(id, rows.map(x => x.ip)) }
        ];
      },
      delete: rows => { if (rows.every(x => x.lease)) deleteLeases(id, rows.map(x => x.ip)); }
    });

    const reservations = id => ({ id: 'dhcp-res:' + id, label: 'Reservations', icon: ICON.reservations, children: () => resKids(id),
      menu: () => [{ label: 'New &Reservation...', icon: I.newItem, action: () => newReservation(id) }],
      view: () => (resKids(id).length ? folderView('Reservations', () => resKids(id), [], { delete: rows => { if (rows.length === 1) deleteReservation(id, rows[0].ip); } })
        : text('Add a Reservation', 'A reservation ensures that a DHCP client is always assigned the same IP address.', 'To add a reservation, on the Action menu, click New Reservation.', HELP)) });
    const resKids = id => { const s = M.scope(id); return s ? s.reservations.slice().sort((a, b) => U.ipCompare(a.ip, b.ip)).map(r => reservation(id, r)) : []; };
    const reservation = (id, r) => ({ id: `dhcp-resv:${id}:${r.ip}`, ip: r.ip, label: resLabel(r), icon: ICON.reservation,
      menu: () => [{ label: 'Configure &Options...', action: soon('Reservation Options') }, { separator: true }, { label: '&Delete', icon: I.delete, action: () => deleteReservation(id, r.ip) }],
      properties: () => reservationProperties(id, r.ip), view: () => optionsView(id, true) });

    const options = id => ({ id: id ? 'dhcp-sopt:' + id : 'dhcp-v4opt', label: id ? 'Scope Options' : 'Server Options', icon: ICON.options,
      menu: () => [{ label: 'Configure &Options...', action: () => configureOptions(id) }], view: () => optionsView(id, false) });
    function optionRows(id, inherited) {
      const server = M.serverOptions(), own = id ? (M.scope(id) || { options: {} }).options : server, rows = [];
      const add = (code, v, level) => rows.push({ id: String(code), code: +code, name: optName(code), vendor: 'Standard', value: optValue(code, v), policy: 'None', level });
      for (const [code, v] of Object.entries(own)) add(code, v, !id ? 'server' : inherited ? 'inherited' : 'scope');
      if (id) for (const [code, v] of Object.entries(server)) if (!(code in own)) add(code, v, 'inherited');
      return rows;
    }
    function optionsView(id, readOnly) {
      const mine = r => !readOnly && r.level !== 'inherited';
      return { columns: optionColumns, rows: () => optionRows(id, readOnly), getId: r => r.id, sortKey: 'name', itemLabel: r => r.name,
        icon: r => (r.level === 'scope' ? ICON.option : ICON.serverOption),
        menu: rows => (readOnly ? [] : rows.length ? [{ label: '&Delete', icon: I.delete, disabled: !rows.every(mine), action: () => deleteOptions(id, rows.map(r => r.code)) }]
          : [{ label: 'Configure &Options...', action: () => configureOptions(id) }]),
        properties: readOnly ? null : r => configureOptions(id, { select: r.code }),
        delete: rows => { if (!readOnly && rows.every(mine)) deleteOptions(id, rows.map(r => r.code)); } };
    }

    const policies = nid => ({ id: nid, label: 'Policies', icon: ICON.policies, menu: () => [{ label: 'New &Policy...', action: soon('DHCP Policy Configuration Wizard') }],
      view: { columns: [{ key: 'name', label: 'Policy Name', width: 160 }, { key: 'order', label: 'Processing Order', width: 110 }, { key: 'level', label: 'Level', width: 80 },
        { key: 'state', label: 'State', width: 80 }, { key: 'description', label: 'Description', width: 200 }], rows: () => [], getId: r => r.name } });

    const filters = () => ({ id: 'dhcp-filters', label: 'Filters', icon: ICON.filters, children: () => [filterList('allow'), filterList('deny')],
      properties: () => ipv4Properties({ tab: 'Filters' }),
      view: () => folderView('Contents of Filters', () => [filterList('allow'), filterList('deny')], [{ key: 'status', label: 'Status', width: 110 }]) });
    const filterList = key => {
      const enabled = M.filters()[key + 'Enabled'], L = key === 'allow' ? 'Allow' : 'Deny';
      return { id: 'dhcp-' + key, label: L, icon: enabled ? ICON[key] : ICON.filterOff, status: enabled ? 'Enabled' : 'Disabled',
        menu: () => [{ label: 'New &Filter...', icon: I.newItem, action: () => newFilter(key) }, enabled ? { label: '&Disable', action: () => M.setFilterList({ [key]: false }) } : { label: '&Enable', action: () => M.setFilterList({ [key]: true }) }],
        view: () => ({ columns: [{ key: 'mac', label: 'MAC Address', width: 160 }, { key: 'description', label: 'Description', width: 300 }],
          rows: () => M.filters()[key].map(f => ({ id: f.mac, mac: macText(f.mac), description: f.description })), getId: r => r.id, icon: () => ICON.mac, sortKey: 'mac', itemLabel: r => r.mac,
          menu: rows => (rows.length ? [{ label: '&Delete', icon: I.delete, action: () => deleteFilters(key, rows.map(r => r.id)) }] : [{ label: 'New &Filter...', action: () => newFilter(key) }]),
          delete: rows => deleteFilters(key, rows.map(r => r.id)),
          status: () => (enabled ? `The ${L} list is enabled.` : `The ${L} list is disabled.`) }) };
    };
    return () => [root()];
  }
  const optionColumns = [{ key: 'name', label: 'Option Name', width: 200 }, { key: 'vendor', label: 'Vendor', width: 90 }, { key: 'value', label: 'Value', width: 240 }, { key: 'policy', label: 'Policy Name', width: 110 }];

  function launch(opts = {}) {
    let mmc, removed = false;
    const ctl = {
      get mmc() { return mmc; }, get serverRemoved() { return removed; },
      path: pathTo, open: id => mmc.selectPath(pathTo(id)),
      setRemoved(v) { removed = !!v; mmc.refresh(); },
      async removeServer() {
        if (!(await ask(`Do you want to remove the server ${fqdn()} from the console?\n\nThis removes the server from this console only. The DHCP Server service keeps running.`))) return cancelled;
        ctl.setRemoved(true); return { ok: true };
      }
    };
    mmc = WS.mmc.create({ app: 'dhcpmgmt', title: TITLE, icon: ICON.root, width: 1200, height: 680, treeWidth: 280, topics: ['dhcp', 'services', 'features', 'system', 'network'],
      nodes: consoleNodes(ctl), select: 'dhcp-root' });
    mmc.win.dhcpmgmt = ctl;
    if (opts.onCreate) opts.onCreate(ctl);
    return mmc.win;
  }

  WS.dhcpmgmt = { launch, newScope, newExclusion, newReservation, newFilter, configureOptions, scopeProperties, reservationProperties, ipv4Properties, serverProperties,
    statistics, reconcile, addServer, setActive, deleteScope, deleteReservation, deleteExclusions, deleteLeases, deleteOptions, deleteFilters, authorize, unauthorize, service, ICON };
  WS.apps.register({ id: 'dhcpmgmt', name: 'DHCP', icon: ICON.root, launch, keywords: ['dhcpmgmt.msc', 'dhcp', 'scope'] });
})();
