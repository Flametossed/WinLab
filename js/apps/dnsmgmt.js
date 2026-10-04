/* DNS Manager (dnsmgmt.msc). Every change goes through WS.dns - the model the DnsServer cmdlets, dnscmd and nslookup use.
 * WS.dnsmgmt: { launch, newZone({ reverse }), newHost(zone, folder), newRecord(type, zone, folder), otherRecords(zone, folder),
 *   newDomain(zone, folder), newDelegation(zone, folder), newConditionalForwarder(), recordProperties(zone, record),
 *   zoneProperties(zone, { tab }), serverProperties({ tab }), conditionalForwarderProperties(name), editForwarders(list),
 *   deleteRows(zone, folder, rows), deleteZone(zone), launchNslookup() }
 * folder is a sub-domain relative to the zone ('' = the zone itself). Every dialog takes opts.onCreate(live object, api).
 * launch() returns the window; win.dnsmgmt = { mmc, advanced, setAdvanced(bool), locate(zone, folder) }. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, N = WS.dns;
  const TITLE = 'DNS Manager';

  const s16 = body => `<svg viewBox="0 0 16 16">${body}</svg>`;
  const down = '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M12 10.3v3.2M10.6 12.2l1.4 1.4 1.4-1.4" stroke="#fff" stroke-width="1" fill="none"/>';
  const pause = '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c99a00"/><path d="M11.1 10.6v2.8M12.9 10.6v2.8" stroke="#fff" stroke-width="1"/>';
  const ICON = {
    dns: s16('<circle cx="8" cy="8" r="6.5" fill="url(#wsg-blue)"/><path d="M1.5 8h13M8 1.5c-2.6 2-2.6 11 0 13M8 1.5c2.6 2 2.6 11 0 13M2.7 4.6h10.6M2.7 11.4h10.6" fill="none" stroke="#cfe4ff" stroke-width=".8"/>'),
    server: I.dnsServer,
    serverDown: I.dnsServer.replace('</svg>', down + '</svg>'),
    zonePaused: I.zone.replace('</svg>', pause + '</svg>'),
    delegation: s16('<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="#9aa4ae"/><path d="M1 6h14v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="#c8ced6"/>'),
    forwarder: I.zone.replace('</svg>', '<path d="M8.5 12.5h6M12.3 10.3l2.2 2.2-2.2 2.2" fill="none" stroke="#0f7b0f" stroke-width="1.3"/></svg>')
  };
  const TYPE_LABEL = { A: 'Host (A)', AAAA: 'IPv6 Host (AAAA)', CNAME: 'Alias (CNAME)', MX: 'Mail Exchanger (MX)', NS: 'Name Server (NS)', PTR: 'Pointer (PTR)',
    SRV: 'Service Location (SRV)', TXT: 'Text (TXT)', SOA: 'Start of Authority (SOA)' };
  const REP_LABEL = { Forest: 'All DNS servers in this forest', Domain: 'All DNS servers in this domain', Legacy: 'All domain controllers in this domain' };
  const DYN_LABEL = { None: 'None', NonsecureAndSecure: 'Nonsecure and secure', Secure: 'Secure only' };
  const SAME = '(same as parent folder)';
  const zoneType = z => (z.adIntegrated ? 'Active Directory-Integrated Primary' : 'Standard Primary');
  const join = (name, rel) => [name, rel].filter(Boolean).join('.');
  const fqdn = (zn, rel) => join(rel, zn) + '.';
  const stamp = r => { if (!r.timestamp) return 'static'; const d = new Date(r.timestamp); d.setMinutes(0, 0, 0); return U.fmtDateTime(d); };
  const dataText = (z, r) => r.type === 'SOA' ? `[${z.serial || 1}], ${r.data.primary}, ${r.data.responsible}` : r.type === 'MX' ? `[${r.preference}]  ${r.data}`
    : r.type === 'SRV' ? `[${r.priority}][${r.weight}][${r.port}] ${r.data}` : String(r.data);
  const installed = () => N.isInstalled();
  const running = () => installed() && WS.svc.isRunning('DNS');
  const zoneIcon = z => (z.paused ? ICON.zonePaused : I.zone);
  const error = (message, title = 'DNS') => WS.ui.msgbox({ title, icon: 'error', message });
  /** Model errors are written for PowerShell; DNS Manager words them its own way. */
  const friendly = r => String(r.error || '').replace(/^Failed to create resource record \S+ in zone \S+ on server \S+\. /, 'The resource record cannot be created. ')
    .replace(/^Failed to create zone (\S+) on server \S+\. /, 'The zone $1 cannot be created. ');
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  function radios(name, options, value, onChange) {
    const group = U.uid(name);
    return options.map(([v, label, o]) => {
      const r = F.radio(group, label, v === value, o || {});
      r.input.dataset.field = name + ':' + v;
      r.input.addEventListener('change', () => { if (r.checked) onChange(v); });
      return r;
    });
  }

  /* ---------------- zone layout: sub-domain folders and the records under them ---------------- */
  /** Every sub-domain of the zone that shows as a folder (lowercase -> name as registered). */
  function folderSet(z) {
    const set = new Map();
    const ancestors = name => { const p = name.split('.'); for (let i = 1; i < p.length; i++) { const f = p.slice(i).join('.'); if (!set.has(f.toLowerCase())) set.set(f.toLowerCase(), f); } };
    for (const r of z.records) if (r.name !== '@') { ancestors(r.name); if (r.type === 'NS' && !set.has(r.name.toLowerCase())) set.set(r.name.toLowerCase(), r.name); }
    for (const d of N.zoneInfo(z).domains) { if (!set.has(d.toLowerCase())) set.set(d.toLowerCase(), d); ancestors(d); }
    return set;
  }
  const isDelegation = (z, rel) => !!rel && z.records.some(r => r.type === 'NS' && r.name.toLowerCase() === rel.toLowerCase());
  function childFolders(z, rel) {
    const out = [], low = rel.toLowerCase();
    for (const [key, name] of folderSet(z)) {
      const head = !rel ? name : key.endsWith('.' + low) ? name.slice(0, name.length - rel.length - 1) : null;
      if (head && !head.includes('.')) out.push({ kind: 'folder', rel: name, label: head, delegation: isDelegation(z, name) });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }
  function recordsAt(z, rel) {
    const set = folderSet(z), low = rel.toLowerCase();
    return z.records.filter(r => {
      const n = r.name.toLowerCase();
      if (!rel) return n === '@' || (!n.includes('.') && !set.has(n));
      if (n === low) return true;
      if (!n.endsWith('.' + low)) return false;
      return !n.slice(0, n.length - low.length - 1).includes('.') && !set.has(n);
    }).map(r => ({ kind: 'record', rec: r, label: (rel ? r.name.toLowerCase() === low : r.name === '@') ? SAME : rel ? r.name.slice(0, r.name.length - rel.length - 1) : r.name }));
  }
  const recKey = r => [r.type, r.name.toLowerCase(), r.type === 'SOA' ? '' : String(r.data).toLowerCase(), r.preference, r.priority, r.weight, r.port].join('|');
  const rowId = row => row.kind === 'folder' ? 'f:' + row.rel.toLowerCase() : 'r:' + recKey(row.rec);
  const rank = row => (row.kind === 'folder' ? 0 : row.label === SAME ? 1 : 2);
  /** The folder a record lives in, relative to its zone. */
  const folderOf = (z, rec) => {
    if (rec.name === '@') return '';
    const set = folderSet(z);
    if (set.has(rec.name.toLowerCase())) return set.get(rec.name.toLowerCase());
    const i = rec.name.indexOf('.');
    return i < 0 ? '' : set.get(rec.name.slice(i + 1).toLowerCase()) || rec.name.slice(i + 1);
  };
  const leafOf = (z, rec) => { const f = folderOf(z, rec); return rec.name === '@' || rec.name.toLowerCase() === f.toLowerCase() ? '' : f ? rec.name.slice(0, rec.name.length - f.length - 1) : rec.name; };

  /* ---------------- small dialog helpers ---------------- */
  /** Enter in an "add an IP address" line adds the address instead of pressing OK. */
  const guardEnter = frame => { const prev = frame.onKey; frame.onKey = e => (e.key === 'Enter' && e.target.closest && e.target.closest('.dns-addip') ? false : prev ? prev(e) : true); };
  /** OK/Cancel dialog; submit() returns {ok:false, error} to keep it open, false to stay silently, anything else closes. */
  function formDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 420, className: 'w32-dlg dns-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32.dns-form', o.content));
    let busy = false;
    const submit = async () => {
      if (busy || ok.disabled) return;
      busy = true;
      try {
        const r = await o.submit();
        if (r && r.ok === false) await error(friendly(r), o.errorTitle || 'DNS');
        else if (r !== false) frame.close(r == null ? true : r);
      } finally { busy = false; }
    };
    const ok = h('button.btn.primary', { onClick: submit }, o.okLabel || 'OK');
    frame.footer.append(ok, h('button.btn', { onClick: () => { if (!busy) frame.close(null); } }, 'Cancel'));
    frame.onEnter = submit;
    frame.onEscape = () => { if (!busy) frame.close(null); };
    // Enter in an "add an IP address" line adds the address instead of pressing OK
    guardEnter(frame);
    frame.okBtn = ok;
    if (o.onCreate) o.onCreate(frame, o.api);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }
  /** A one-tab sheet, as DNS Manager's New Resource Record dialog looks. */
  /** The read-only settings box on a wizard's Completing page. */
  const summary = (rows, note) => h('div.dns-summary', h('div.dns-sumgrid', ...rows.flatMap(([k, v]) => [h('span', k), h('span', v)])), note ? h('p', note) : null);
  const tabbed = (label, content) => h('div.ps.dns-onetab', h('div.ps-tabs', h('div.ps-tab.sel', label)), h('div.ps-pages', h('div.ps-page', content)));
  async function confirm(message, extra) {
    const content = h('div.w32', h('div.msgbox', h('div.msgbox-icon', { html: WS.ui.icons.warning }), h('div.msgbox-text', h('div', { style: 'white-space:pre-line' }, message), extra || null)));
    return (await WS.ui.dialog({ title: 'DNS', width: 440, content, buttons: [{ label: 'Yes', primary: true }, { label: 'No', cancel: true }] })) === 'Yes';
  }

  const UNITS = [['days', 86400], ['hours', 3600], ['minutes', 60], ['seconds', 1]];
  /** "Refresh interval: [15] [minutes]" */
  function interval(name, seconds) {
    const [u, m] = UNITS.find(([, s]) => seconds >= s && seconds % s === 0) || UNITS[3];
    const num = field(name, F.number({ value: seconds / m, min: 0, width: 70 }));
    const unit = field(name + 'Unit', F.select(UNITS.map(x => x[0]), u, { width: 90 }));
    return { el: h('div.dns-inline', num, unit), get value() { return Math.round((+num.value || 0) * UNITS.find(x => x[0] === unit.value)[1]); } };
  }
  /** "Time to live (TTL): [0] :[1] :[0] :[0] (DDDDD:HH.MM.SS)" */
  function ttlInput(name, seconds) {
    const parts = [Math.floor(seconds / 86400), Math.floor(seconds % 86400 / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
      .map((v, i) => field(name + i, F.number({ value: v, min: 0, max: [49710, 23, 59, 59][i], width: i ? 44 : 60 })));
    return { el: h('div.dns-inline', parts[0], ':', parts[1], ':', parts[2], ':', parts[3], h('span', '(DDDDD:HH.MM.SS)')),
      get value() { return parts.reduce((a, p, i) => a + (+p.value || 0) * [86400, 3600, 60, 1][i], 0); } };
  }

  /** IP Address | Server FQDN | Validated list with the "<Click here to add...>" line (Edit Forwarders, conditional forwarders). */
  function ipList(initial, opts = {}) {
    const probe = ip => {
      const q = WS.net.queryServer(ip, 'www.microsoft.com', 'A');
      return { ip, fqdn: WS.net.reverse(ip, ip) || '<Unable to resolve>', validated: q.status === 'timeout' ? 'A timeout occurred during validation.' : 'OK' };
    };
    let rows = initial.map(probe);
    const list = WS.ui.listView({ columns: [{ key: 'ip', label: 'IP Address', width: 115 }, { key: 'fqdn', label: 'Server FQDN', width: 170 }, { key: 'validated', label: 'Validated', width: 230 }],
      rows: () => rows, getId: r => r.ip, sortKey: null, multi: true, onSelect: paint });
    list.el.classList.add('dns-iplist'); list.el.setAttribute('data-nodirty', '');
    const input = field('addIp', F.text({ placeholder: '<Click here to add an IP Address or DNS Name>' }));
    input.classList.add('dns-addip');
    input.setAttribute('data-nodirty', '');
    const del = F.button('Delete', () => { const gone = new Set(list.selected().map(r => r.ip)); rows = rows.filter(r => !gone.has(r.ip)); list.refresh(); changed(); }, { disabled: true });
    const move = dir => () => {
      const r = list.selected()[0]; if (!r) return;
      const i = rows.indexOf(r), j = i + dir; if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [rows[j], rows[i]]; list.refresh(); list.select([r.ip]); changed();
    };
    const upBtn = F.button('Up', move(-1), { disabled: true }), downBtn = F.button('Down', move(1), { disabled: true });
    function paint() { const n = list.selected().length; del.disabled = !n; upBtn.disabled = downBtn.disabled = n !== 1; }
    const changed = () => { paint(); if (opts.onChange) opts.onChange(); };
    async function add(text) {
      const t = String(text == null ? input.value : text).trim();
      if (!t) return false;
      let ips = [t];
      if (!U.isValidIp(t)) {
        const r = WS.net.resolve(t);
        if (!r.ok) { await error(`The name ${t} could not be resolved to an IP address.`); return false; }
        ips = r.addresses;
      }
      for (const ip of ips) if (!rows.some(r => r.ip === ip)) rows.push(probe(ip));
      input.value = ''; list.refresh(); changed();
      return true;
    }
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
    input.addEventListener('blur', () => { if (input.value.trim()) add(); });
    const el = h('div.dns-ipbox', h('div.dns-ipmain', list.el, input), h('div.dns-ipbtns', del, upBtn, downBtn));
    return { el, list, add, values: () => rows.map(r => r.ip), rows: () => rows.slice() };
  }

  /* ---------------- New Zone Wizard ---------------- */
  /** opts.reverse: true/false when started from a lookup-zone folder (skips the Forward or Reverse page). */
  function newZone(opts = {}) {
    if (!installed()) return null;
    const dc = WS.sys.isDC(), domain = WS.state.system.domain || '';
    const d = { kind: 'primary', ad: dc, rep: 'Domain', reverse: !!opts.reverse, ipv6: false, name: '', useNetId: true, netId: '', revName: '',
      file: '', fileEdited: false, existing: false, existingName: '', dyn: dc ? 'Secure' : 'None' };
    const c = {};
    const zoneName = () => d.reverse ? (d.useNetId ? revFromNet(d.netId) : d.revName.trim().toLowerCase()) : d.name.trim().replace(/\.$/, '').toLowerCase();
    const revFromNet = net => { const o = String(net).trim().split('.').filter(x => x !== ''); return o.length ? o.reverse().join('.') + '.in-addr.arpa' : ''; };
    const p = (...t) => t.map(x => h('p', x));
    return WS.ui.wizard({ title: 'New Zone Wizard', icon: I.zone, width: 520, height: 420, onCreate: opts.onCreate, pages: [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the New Zone Wizard',
        render: () => h('div', ...p('This wizard helps you create a new zone for your DNS server.', 'A zone translates DNS names to related data, such as IP addresses or network services.', 'To continue, click Next.')) },
      { id: 'type', title: 'Zone Type', subtitle: 'The DNS server supports various types of zones and storage.', render: () => {
        const [pri, sec, stub] = radios('type', [['primary', 'Primary zone'], ['secondary', 'Secondary zone'], ['stub', 'Stub zone']], d.kind, v => { d.kind = v; });
        c.ad = field('ad', F.checkbox('Store the zone in Active Directory (available only if DNS server is a writeable domain controller)', d.ad, { disabled: !dc }));
        c.ad.input.addEventListener('change', () => { d.ad = c.ad.checked; });
        return h('div.dns-form', h('div', 'Select the type of zone you want to create:'),
          pri, h('div.dns-sub', 'Creates a copy of a zone that can be updated directly on this server.'),
          sec, h('div.dns-sub', 'Creates a copy of a zone that exists on another server. This option helps balance the processing load of primary servers and provides fault tolerance.'),
          stub, h('div.dns-sub', 'Creates a copy of a zone containing only Name Server (NS), Start of Authority (SOA), and possibly glue Host (A) records. A server containing a stub zone is not authoritative for that zone.'),
          F.sep(), c.ad);
      }, validate: () => d.kind !== 'primary' ? 'A secondary or stub zone needs a master DNS server that hosts the zone. There is no other DNS server on the lab network, so create a primary zone.' : null },
      { id: 'replication', title: 'Active Directory Zone Replication Scope', subtitle: 'You can select how you want DNS data replicated throughout your network.', skip: () => !d.ad,
        render: () => h('div.dns-form', h('div', 'Select how you want zone data replicated:'),
          ...radios('rep', [['Forest', `To all DNS servers running on domain controllers in this forest: ${domain}`], ['Domain', `To all DNS servers running on domain controllers in this domain: ${domain}`],
            ['Legacy', `To all domain controllers in this domain (for Windows 2000 compatibility): ${domain}`], ['Custom', 'To all domain controllers specified in the scope of this directory partition:', { disabled: true }]], d.rep, v => { d.rep = v; }),
          h('div.dns-sub', F.select([''], '', { disabled: true, width: 300 }))) },
      { id: 'direction', title: 'Forward or Reverse Lookup Zone', subtitle: 'You can use this zone to translate DNS names into IP addresses or IP addresses into DNS names.', skip: () => opts.reverse != null,
        render: () => {
          const [fwd, rev] = radios('direction', [[false, 'Forward lookup zone'], [true, 'Reverse lookup zone']], d.reverse, v => { d.reverse = v; });
          return h('div.dns-form', h('div', 'Choose whether you want to create a forward lookup zone or reverse lookup zone.'),
            fwd, h('div.dns-sub', 'A forward lookup zone translates DNS names to IP addresses and provides information about available network services.'),
            rev, h('div.dns-sub', 'A reverse lookup zone translates an IP address into a DNS name.'));
        } },
      { id: 'name', title: 'Zone Name', subtitle: 'What is the name of the new zone?', skip: () => d.reverse, render: w => {
        c.name = field('zoneName', F.text({ value: d.name }));
        c.name.addEventListener('input', () => { d.name = c.name.value; w.setNext(!!d.name.trim()); });
        return h('div.dns-form', ...p('The zone name specifies the portion of the DNS namespace for which this server is authoritative. It might be your organization\'s domain name (for example, microsoft.com) or a portion of the domain name (for example, newzone.microsoft.com). The zone name is not the name of the DNS server.'),
          F.stack('Zone name:', c.name));
      }, enter: w => w.setNext(!!d.name.trim()) },
      { id: 'family', title: 'Reverse Lookup Zone Name', subtitle: 'Choose whether you want to create a reverse lookup zone for IPv4 addresses or IPv6 addresses.', skip: () => !d.reverse,
        render: () => h('div.dns-form', ...radios('family', [[false, 'IPv4 Reverse Lookup Zone'], [true, 'IPv6 Reverse Lookup Zone']], d.ipv6, v => { d.ipv6 = v; })),
        validate: () => d.ipv6 ? 'The lab network uses IPv4 only. Choose IPv4 Reverse Lookup Zone.' : null },
      { id: 'revname', title: 'Reverse Lookup Zone Name', subtitle: 'A reverse lookup zone translates IP addresses into DNS names.', skip: () => !d.reverse, render: w => {
        c.netId = field('networkId', F.text({ value: d.netId }));
        c.revName = field('reverseName', F.text({ value: d.revName, disabled: d.useNetId }));
        const sync = () => { d.netId = c.netId.value; if (d.useNetId) { c.revName.value = revFromNet(d.netId); d.revName = c.revName.value; } w.setNext(!!zoneName()); };
        c.netId.addEventListener('input', sync);
        c.revName.addEventListener('input', () => { d.revName = c.revName.value; w.setNext(!!zoneName()); });
        const [byNet, byName] = radios('revmode', [[true, 'Network ID:'], [false, 'Reverse lookup zone name:']], d.useNetId, v => { d.useNetId = v; c.netId.disabled = !v; c.revName.disabled = v; sync(); });
        return h('div.dns-form', h('div', 'To identify the reverse lookup zone, type the network ID or the name of the zone.'),
          byNet, h('div.dns-sub', c.netId, h('p', 'The network ID is the portion of the IP addresses that belongs to this zone. Enter the network ID in its normal (not reversed) order.'),
            h('p', 'If you use a zero in the network ID, it will appear in the zone name. For example, network ID 10 would create zone 10.in-addr.arpa, and network ID 10.0 would create zone 0.10.in-addr.arpa.')),
          byName, h('div.dns-sub', c.revName));
      }, enter: w => w.setNext(!!zoneName()), validate: () => {
        if (d.useNetId && !/^\d{1,3}(\.\d{1,3}){0,2}$/.test(d.netId.trim()) || d.useNetId && d.netId.split('.').some(o => +o > 255)) return 'The network ID is not valid. Type one to three octets of an IPv4 network ID, for example 192.168.1.';
        if (!/^(\d{1,3}\.){1,3}in-addr\.arpa$/.test(zoneName())) return 'The reverse lookup zone name is not valid. It must end with in-addr.arpa.';
        return null;
      } },
      { id: 'file', title: 'Zone File', subtitle: 'You can create a new zone file or use a file copied from another DNS server.', skip: () => d.ad, render: () => {
        c.file = field('file', F.text({ value: d.file }));
        c.file.addEventListener('input', () => { d.file = c.file.value; d.fileEdited = true; });
        c.existing = field('existingFile', F.text({ value: d.existingName, disabled: !d.existing }));
        c.existing.addEventListener('input', () => { d.existingName = c.existing.value; });
        const [create, use] = radios('filemode', [[false, 'Create a new file with this file name:'], [true, 'Use this existing file:']], d.existing, v => { d.existing = v; c.file.disabled = v; c.existing.disabled = !v; });
        return h('div.dns-form', h('div', 'Do you want to create a new zone file or use an existing file that you have copied from another DNS server?'),
          create, h('div.dns-sub', c.file), use, h('div.dns-sub', c.existing,
            h('p', 'To use this existing file, ensure that it has been copied to the folder %SystemRoot%\\system32\\dns on this server, and then click Next.')));
      }, enter: () => { if (!d.fileEdited) { d.file = zoneName() + '.dns'; c.file.value = d.file; } if (!d.existingName) { d.existingName = zoneName() + '.dns'; c.existing.value = d.existingName; } },
      validate: () => (d.existing ? !d.existingName.trim() : !d.file.trim()) ? 'Type a zone file name.' : null },
      { id: 'dynamic', title: 'Dynamic Update', subtitle: 'You can specify that this DNS zone accepts secure, nonsecure, or no dynamic updates.', render: () => {
        c.dyn = radios('dynamic', [['Secure', 'Allow only secure dynamic updates (recommended for Active Directory)'], ['NonsecureAndSecure', 'Allow both nonsecure and secure dynamic updates'], ['None', 'Do not allow dynamic updates']], d.dyn, v => { d.dyn = v; });
        return h('div.dns-form', ...p('Dynamic updates enable DNS client computers to register and dynamically update their resource records with a DNS server whenever changes occur.'),
          h('div', 'Select the type of dynamic updates you want to allow:'),
          c.dyn[0], h('div.dns-sub', 'This option is available only for Active Directory-integrated zones.'),
          c.dyn[1], h('div.dns-sub', 'Dynamic updates of resource records are accepted from any client.', h('div.dns-warn', 'This option is a significant security vulnerability because updates can be accepted from untrusted sources.')),
          c.dyn[2], h('div.dns-sub', 'Dynamic updates of resource records are not accepted by this zone. You must update these records manually.'));
      }, enter: () => {
        c.dyn[0].input.disabled = !d.ad; c.dyn[0].classList.toggle('disabled', !d.ad);
        if (!d.ad && d.dyn === 'Secure') d.dyn = 'None';
        c.dyn.forEach(r => { r.checked = r.input.dataset.field === 'dynamic:' + d.dyn; });
      } },
      { id: 'complete', kind: 'complete', title: 'Completing the New Zone Wizard', rerender: true, render: () => {
        const lines = [['Name:', zoneName()], ['Type:', d.ad ? 'Active Directory-Integrated Primary' : 'Standard Primary'], ['Lookup type:', d.reverse ? 'Reverse' : 'Forward']];
        if (!d.ad) lines.push(['File name:', d.existing ? d.existingName : d.file]);
        return h('div', h('p', 'You have successfully completed the New Zone Wizard. You specified the following settings:'),
          summary(lines, 'Note: You should now add records to the zone or ensure that records are updated dynamically. You can then verify name resolution using nslookup.'),
          h('p', 'To close this wizard and create the new zone, click Finish.'));
      } }
    ], onFinish: w => {
      const r = N.createZone({ name: zoneName(), adIntegrated: d.ad, replication: d.ad ? d.rep : undefined, dynamicUpdate: d.dyn,
        file: d.ad ? undefined : (d.existing ? d.existingName : d.file).trim(), existingFile: !d.ad && d.existing });
      if (r.ok) w.data.zone = r.zone.name;
      return r.ok ? r : { ok: false, error: friendly(r) };
    } });
  }

  /* ---------------- records ---------------- */
  /** New Host: stays open after each Add Host, as in DNS Manager (Cancel becomes Done). */
  function newHost(zn, rel = '', opts = {}) {
    const z = N.zone(zn); if (!z) return null;
    const name = field('name', F.text()), fq = F.text({ readOnly: true }), ip = field('ip', F.text());
    const ptr = field('ptr', F.checkbox('Create associated pointer (PTR) record', false));
    const auth = field('auth', F.checkbox('Allow any authenticated user to update DNS records with the same owner name', false, { disabled: !z.adIntegrated }));
    const paint = () => { fq.value = fqdn(zn, join(name.value.trim(), rel)); };
    name.addEventListener('input', paint); paint();
    const frame = WS.ui.modal({ title: 'New Host', width: 400, className: 'w32-dlg dns-dlg', closeValue: false });
    frame.body.appendChild(h('div.w32.dns-form', F.stack('Name (uses parent domain name if blank):', name), F.stack('Fully qualified domain name (FQDN):', fq), F.stack('IP address:', ip), ptr, auth));
    let added = 0, busy = false;
    const doneBtn = h('button.btn', { onClick: () => frame.close(added) }, 'Cancel');
    async function submit() {
      if (busy) return;
      busy = true;
      try {
        const value = ip.value.trim(), host = fq.value.replace(/\.$/, '');
        const r = N.addRecord(zn, { name: join(name.value.trim(), rel) || '@', type: value.includes(':') ? 'AAAA' : 'A', data: value, createPtr: ptr.checked });
        if (!r.ok) { await error(friendly(r)); return; }
        added++;
        doneBtn.textContent = 'Done';
        if (r.warning) await WS.ui.msgbox({ title: 'DNS', icon: 'warning', message: r.warning });
        else await WS.ui.msgbox({ title: 'DNS', icon: 'info', message: `The host record ${host} was successfully created.` });
        name.value = ''; ip.value = ''; paint();
        setTimeout(() => name.focus(), 40);
      } finally { busy = false; }
    }
    frame.footer.append(h('button.btn.primary', { onClick: submit }, 'Add Host'), doneBtn);
    frame.onEnter = submit; frame.onEscape = () => frame.close(added);
    if (opts.onCreate) opts.onCreate(frame, { submit });
    WS.ui.focusFirst(frame, name);
    return frame.promise;
  }

  /** Browse... next to a host-name box: pick a host or alias record from the forward lookup zones. */
  function browseHost(target) {
    const rows = N.zones().filter(z => !z.reverse).flatMap(z => z.records.filter(r => ['A', 'AAAA', 'CNAME'].includes(r.type)).map(r => ({ id: z.name + '|' + recKey(r), fqdn: (r.name === '@' ? z.name : r.name + '.' + z.name) + '.', type: TYPE_LABEL[r.type], data: String(r.data) })));
    const list = WS.ui.listView({ columns: [{ key: 'fqdn', label: 'Name', width: 230 }, { key: 'type', label: 'Type', width: 110 }, { key: 'data', label: 'Data', width: 130 }],
      rows, getId: r => r.id, icon: () => I.record, multi: false, onActivate: r => { target.value = r.fqdn; frame.close(); } });
    list.el.classList.add('dns-browse');
    let frame;
    WS.ui.dialog({ title: 'Browse', width: 520, content: h('div.w32', h('div', 'Records:'), list.el), buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }], onCreate: f => { frame = f; } })
      .then(v => { const r = list.selected()[0]; if (v === 'OK' && r) target.value = r.fqdn; });
  }
  const hostBox = (key, value) => { const t = field(key, F.text({ value })); return { input: t, el: h('div.dns-inline', t, F.button('Browse...', () => browseHost(t))) }; };

  /** The fields for one record type. rec = existing record (Properties: names read-only), else a new one in zone/rel. */
  function recordForm(type, zn, rel, rec) {
    const z = N.zone(zn), edit = !!rec, ad = z.adIntegrated;
    const leaf = rec ? leafOf(z, rec) : '';
    const nameBox = field('name', F.text({ value: leaf, readOnly: edit, disabled: edit }));
    const fq = F.text({ readOnly: true });
    const paint = () => { fq.value = type === 'SRV' ? '' : fqdn(zn, join(nameBox.value.trim(), rel)); };
    nameBox.addEventListener('input', paint); paint();
    const authBox = !edit && ad ? field('auth', F.checkbox('Allow any authenticated user to update all DNS records with the same name. This setting applies only to DNS records for a new name.', false)) : null;
    const name = () => join(nameBox.value.trim(), rel) || '@';
    let el, payload;
    if (type === 'A' || type === 'AAAA') {
      const ip = field('ip', F.text({ value: rec ? rec.data : '' }));
      const hasPtr = !!(rec && N.findPtr(zn, rec));
      const ptr = field('ptr', F.checkbox(edit ? 'Update associated pointer (PTR) record' : 'Create associated pointer (PTR) record', hasPtr));
      el = h('div', F.stack('Host (uses parent domain if left blank):', nameBox), F.stack('Fully qualified domain name (FQDN):', fq), F.stack('IP address:', ip), type === 'A' ? ptr : null, authBox);
      payload = () => ({ name: name(), type, data: ip.value.trim(), createPtr: type === 'A' && ptr.checked });
    } else if (type === 'CNAME') {
      const target = hostBox('target', rec ? rec.data : '');
      el = h('div', F.stack('Alias name (uses parent domain if left blank):', nameBox), F.stack('Fully qualified domain name (FQDN):', fq),
        F.stack('Fully qualified domain name (FQDN) for target host:', target.el), authBox);
      payload = () => ({ name: name(), type, data: target.input.value.trim() });
    } else if (type === 'MX') {
      const host = hostBox('mailServer', rec ? rec.data : ''), pref = field('preference', F.number({ value: rec ? rec.preference : 10, min: 0, max: 65535 }));
      el = h('div', F.stack('Host or child domain:', nameBox),
        F.note('By default, DNS uses the parent domain name when creating a Mail Exchange record. You can specify a host or child name, but in most deployments, the above field is left blank.'),
        F.stack('Fully qualified domain name (FQDN):', fq), F.stack('Fully qualified domain name (FQDN) of mail server:', host.el), F.row('Mail server priority:', pref, { labelWidth: 130 }), authBox);
      payload = () => ({ name: name(), type, data: host.input.value.trim(), preference: pref.value });
    } else if (type === 'PTR') {
      const octs = zn.replace(/\.in-addr\.arpa$/, '').split('.').reverse();
      const ipText = rec ? octs.concat(rec.name.split('.').reverse()).join('.') : octs.join('.') + '.';
      const ip = field('ip', F.text({ value: ipText, readOnly: edit, disabled: edit }));
      const host = hostBox('host', rec ? rec.data : '');
      const paintPtr = () => { const v = ip.value.trim(); fq.value = U.isValidIp(v) ? v.split('.').reverse().join('.') + '.in-addr.arpa' : ''; };
      ip.addEventListener('input', paintPtr); paintPtr();
      el = h('div', F.stack('Host IP Address:', ip), F.stack('Fully qualified domain name (FQDN):', fq), F.stack('Host name:', host.el), authBox);
      payload = () => {
        const v = ip.value.trim();
        if (!U.isValidIp(v) || !N.reverseCovers(zn, v)) return { ok: false, error: `The IP address ${v} is not valid for the ${zn} reverse lookup zone.` };
        return { name: rec ? rec.name : N.ptrName(zn, v), type, data: host.input.value.trim() };
      };
    } else if (type === 'SRV') {
      const parts = rec ? leaf.split('.') : [];
      const service = field('service', F.text({ value: parts[0] || '', readOnly: edit, disabled: edit }));
      const dl = h('datalist', { id: U.uid('srv') }, ...['_finger', '_ftp', '_http', '_kerberos', '_ldap', '_msdcs', '_nntp', '_pop3', '_telnet'].map(v => h('option', { value: v })));
      service.setAttribute('list', dl.id);
      const proto = field('protocol', F.select(['_tcp', '_udp'], parts[1] || '_tcp', { disabled: edit, width: 120 }));
      const num = (k, v) => field(k, F.number({ value: v, min: 0, max: 65535 }));
      const pri = num('priority', rec ? rec.priority : 0), wt = num('weight', rec ? rec.weight : 0), port = num('port', rec ? rec.port : 0);
      const host = field('host', F.text({ value: rec ? rec.data : '' }));
      el = h('div', F.row('Domain:', F.value(join(rel, zn)), { labelWidth: 150 }), F.row('Service:', h('div.dns-inline', service, dl), { labelWidth: 150 }), F.row('Protocol:', proto, { labelWidth: 150 }),
        F.row('Priority:', pri, { labelWidth: 150 }), F.row('Weight:', wt, { labelWidth: 150 }), F.row('Port number:', port, { labelWidth: 150 }), F.stack('Host offering this service:', host), authBox);
      payload = () => {
        if (!/^_[A-Za-z0-9-]+$/.test(service.value.trim())) return { ok: false, error: 'The service name is not valid. Service names begin with an underscore, for example _ldap.' };
        return { name: rec ? rec.name : join(service.value.trim() + '.' + proto.value, rel), type, data: host.value.trim(), priority: pri.value, weight: wt.value, port: port.value === '' ? -1 : +port.value };
      };
    } else if (type === 'TXT') {
      const text = field('text', F.textarea({ value: rec ? rec.data : '', rows: 5 }));
      el = h('div', F.stack('Record name (uses parent domain if left blank):', nameBox), F.stack('Fully qualified domain name (FQDN):', fq), F.stack('Text:', text), authBox);
      payload = () => (text.value.trim() ? { name: name(), type, data: text.value } : { ok: false, error: 'Type the text for this record.' });
    } else if (type === 'NS') {
      const host = hostBox('host', rec ? rec.data : '');
      el = h('div', F.stack('Fully qualified domain name (FQDN):', fq), F.stack('Server fully qualified domain name (FQDN):', host.el));
      payload = () => ({ name: name(), type, data: host.input.value.trim() });
    }
    return { el, payload };
  }

  /** New Resource Record (Alias, MX, PTR, SRV, TXT, AAAA ...). */
  function newRecord(type, zn, rel = '', opts = {}) {
    if (!N.zone(zn) || !TYPE_LABEL[type]) return null;
    const form = recordForm(type, zn, rel, null);
    return formDialog({ title: 'New Resource Record', width: 430, onCreate: opts.onCreate, content: tabbed(TYPE_LABEL[type], h('div.dns-form', form.el)),
      submit: () => { const p = form.payload(); return p.ok === false ? p : N.addRecord(zn, p); } });
  }

  const OTHER_TYPES = [
    ['CNAME', 'Alias (CNAME) record. (RFC 1035) Maps an alias domain name to another primary or canonical name.'],
    ['A', 'Host (A) record. (RFC 1035) Maps a DNS domain name to an Internet Protocol (IP) version 4 32-bit address.'],
    ['AAAA', 'IPv6 Host (AAAA) record. (RFC 3596) Maps a DNS domain name to an Internet Protocol (IP) version 6 128-bit address.'],
    ['MX', 'Mail Exchanger (MX) record. (RFC 1035) Routes mail to a specified mail exchange server for a DNS domain name, using a 16-bit preference value.'],
    ['PTR', 'Pointer (PTR) record. (RFC 1035) Maps the reverse DNS name of a computer\'s IP address to the forward name of that computer.'],
    ['SRV', 'Service Location (SRV) record. (RFC 2052) Lets administrators use several servers for a single DNS domain, move services between hosts, and designate primary and backup hosts.'],
    ['TXT', 'Text (TXT) record. (RFC 1035) Holds a string of characters that serves as descriptive text to be associated with a specific DNS domain name.']
  ];
  /** Resource Record Type: pick a type, then Create Record... opens its dialog. */
  function otherRecords(zn, rel = '', opts = {}) {
    const z = N.zone(zn); if (!z) return null;
    const types = OTHER_TYPES.filter(([t]) => z.reverse ? t !== 'A' && t !== 'AAAA' && t !== 'MX' : t !== 'PTR');
    let current = types[0][0];
    const desc = h('div.dns-desc');
    const list = WS.ui.listView({ columns: [{ key: 'label', label: 'Select a resource record type:', width: 330 }], rows: types.map(([t]) => ({ id: t, label: TYPE_LABEL[t] })),
      getId: r => r.id, sortKey: 'label', multi: false, onSelect: rows => { if (rows[0]) { current = rows[0].id; desc.textContent = types.find(x => x[0] === current)[1]; } }, onActivate: () => create() });
    list.el.classList.add('dns-typelist');
    const frame = WS.ui.modal({ title: 'Resource Record Type', width: 400, className: 'w32-dlg dns-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32.dns-form', list.el, h('div', 'Description:'), desc));
    const create = () => (current === 'A' ? newHost(zn, rel, opts.inner) : newRecord(current, zn, rel, opts.inner));
    frame.footer.append(F.button('Create Record...', create), h('button.btn', { onClick: () => frame.close(true) }, 'Done'), h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEscape = () => frame.close(null);
    list.select([current]);
    if (opts.onCreate) opts.onCreate(frame, { select: t => list.select([t]), create });
    WS.ui.focusFirst(frame, list.el);
    return frame.promise;
  }

  function newDomain(zn, rel = '', opts = {}) {
    const name = field('domain', F.text());
    return formDialog({ title: 'New DNS Domain', width: 380, onCreate: opts.onCreate, content: h('div', F.stack('Type the new DNS domain name:', name)),
      submit: () => (name.value.trim() ? N.addDomain(zn, join(name.value.trim(), rel)) : false) });
  }

  /** New Delegation Wizard: NS records for the child domain (plus a glue A record when the server is inside it). */
  function newDelegation(zn, rel = '', opts = {}) {
    const d = { name: '', servers: [] };
    let list, sub;
    return WS.ui.wizard({ title: 'New Delegation Wizard', icon: I.zone, width: 520, height: 420, onCreate: opts.onCreate, pages: [
      { id: 'welcome', kind: 'welcome', title: 'Welcome to the New Delegation Wizard', render: () => h('div', h('p', 'This wizard helps you delegate authority for a subdomain to another DNS server. The DNS server that you delegate to must host the subdomain as a zone.'), h('p', 'To continue, click Next.')) },
      { id: 'name', title: 'Delegated Domain Name', subtitle: 'Authority for the DNS domain you supply will be delegated to a different zone.', render: w => {
        const name = field('delegated', F.text()), fq = F.text({ readOnly: true });
        const paint = () => { d.name = name.value.trim(); fq.value = join(d.name, join(rel, zn)); w.setNext(!!d.name); };
        name.addEventListener('input', paint); paint();
        return h('div.dns-form', h('div', 'Specify the name of the DNS domain you want to delegate.'), F.stack('Delegated domain:', name), F.stack('Fully qualified domain name (FQDN):', fq));
      }, enter: w => w.setNext(!!d.name) },
      { id: 'servers', title: 'Name Servers', subtitle: 'You can select one or more name servers to host the delegated zone.', render: w => {
        const server = field('nsName', F.text()), ip = field('nsIp', F.text());
        list = WS.ui.listView({ columns: [{ key: 'fqdn', label: 'Server Fully Qualified Domain Name (FQDN)', width: 250 }, { key: 'ip', label: 'IP Address', width: 120 }], rows: () => d.servers, getId: r => r.fqdn, sortKey: null });
        list.el.classList.add('dns-nslist');
        sub = async () => {
          const f = server.value.trim().replace(/\.$/, '');
          if (!f || !/^[A-Za-z0-9.-]+$/.test(f) || (ip.value.trim() && !U.isValidIp(ip.value.trim()))) { await error('Type a valid server name and IP address.'); return; }
          d.servers.push({ fqdn: f + '.', ip: ip.value.trim() }); server.value = ''; ip.value = ''; list.refresh(); w.setNext(true);
        };
        w.data.addServer = (name, address) => { server.value = name; ip.value = address || ''; return sub(); };
        return h('div.dns-form', h('div', 'Specify the names and IP addresses of the DNS servers you want to have host the delegated zone.'), list.el,
          F.row('Server FQDN:', server, { labelWidth: 90 }), F.row('IP address:', h('div.dns-inline', ip, F.button('Add', () => sub())), { labelWidth: 90 }));
      }, enter: w => w.setNext(d.servers.length > 0) },
      { id: 'complete', kind: 'complete', title: 'Completing the New Delegation Wizard', rerender: true,
        render: () => h('div', h('p', 'You have successfully completed the New Delegation Wizard. You specified the following settings:'), summary([['Delegated domain:', join(d.name, join(rel, zn))], ...d.servers.map((s, i) => [i ? '' : 'Name servers:', s.fqdn + (s.ip ? ' [' + s.ip + ']' : '')])]), h('p', 'To close this wizard and create the delegation, click Finish.')) }
    ], onFinish: () => {
      const child = join(d.name, rel);
      for (const s of d.servers) {
        const r = N.addRecord(zn, { name: child, type: 'NS', data: s.fqdn }); if (!r.ok) return { ok: false, error: friendly(r) };
        const glue = s.fqdn.replace(/\.$/, '').toLowerCase(), suffix = '.' + zn;
        if (s.ip && glue.endsWith(suffix)) N.addRecord(zn, { name: glue.slice(0, -suffix.length), type: 'A', data: s.ip });
      }
      return { ok: true };
    } });
  }

  /** Record Properties. SOA and the zone's own NS records open the zone's property sheet, as DNS Manager does. */
  function recordProperties(zn, rec, opts = {}) {
    const z = N.zone(zn); if (!z || !rec) return null;
    if (rec.type === 'SOA') return zoneProperties(zn, { ...opts, tab: 'Start of Authority (SOA)' });
    if (rec.type === 'NS' && rec.name === '@') return zoneProperties(zn, { ...opts, tab: 'Name Servers' });
    let match = { name: rec.name, type: rec.type, data: rec.data }, current = rec;
    const rel = folderOf(z, rec), leaf = leafOf(z, rec);
    const form = recordForm(rec.type, zn, rel, rec);
    const ttl = ttlInput('ttl', rec.ttl || 3600);
    const advanced = opts.advanced;
    const stale = advanced ? field('stale', F.checkbox('Delete this record when it becomes stale', !!rec.timestamp, { disabled: true })) : null;
    return WS.ui.propertySheet({ title: (leaf || (rel ? rel.split('.')[0] : SAME)) + ' Properties', width: 420, errorTitle: 'DNS', onCreate: opts.onCreate, tabs: [{
      label: TYPE_LABEL[rec.type] || rec.type,
      render: () => h('div.dns-form', form.el, advanced ? h('div', F.sep(), stale, F.row('Record time stamp:', F.value(rec.timestamp ? stamp(rec) : ''), { labelWidth: 120 }), F.stack('Time to live (TTL):', ttl.el)) : null),
      apply: () => {
        const p = form.payload();
        if (p.ok === false) return p;
        const old = current.type === 'A' ? N.findPtr(zn, current) : null;
        if (old && p.data !== current.data && p.createPtr) N.removeRecord(old.zone, { name: old.record.name, type: 'PTR', data: old.record.data });
        const r = N.setRecord(zn, match, { data: p.data, preference: p.preference, priority: p.priority, weight: p.weight, port: p.port, ttl: advanced ? ttl.value : current.ttl, createPtr: p.createPtr && !(old && p.data === current.data) });
        if (!r.ok) return { ok: false, error: friendly(r) };
        current = r.record; match = { name: r.record.name, type: r.record.type, data: r.record.data };
        if (r.warning) WS.ui.msgbox({ title: 'DNS', icon: 'warning', message: r.warning });
        return { ok: true };
      } }] });
  }

  /* ---------------- zones ---------------- */
  function changeZoneType(zn, opts = {}) {
    const z = N.zone(zn);
    const ad = field('ad', F.checkbox('Store the zone in Active Directory (available only if DNS server is a domain controller)', z.adIntegrated, { disabled: !WS.sys.isDC() }));
    let kind = 'primary';
    return formDialog({ title: 'Change Zone Type', width: 440, onCreate: opts.onCreate,
      content: h('div', h('div', 'Select a zone type:'), ...radios('ztype', [['primary', 'Primary zone'], ['secondary', 'Secondary zone'], ['stub', 'Stub zone']], kind, v => { kind = v; }),
        h('div.dns-sub', 'Primary: Stores a copy of the zone that can be updated directly. Secondary: Stores a copy of an existing zone. Stub: Stores a copy of a zone containing only NS, SOA, and possibly glue A records.'), F.sep(), ad),
      submit: async () => {
        if (kind !== 'primary') return { ok: false, error: 'There is no other DNS server on the lab network to act as the master server, so the zone must stay a primary zone.' };
        if (ad.checked === z.adIntegrated) return true;
        const q = ad.checked ? `Do you want to store the zone ${zn} in Active Directory?` : `Do you want the zone ${zn} to be stored in a zone file instead of Active Directory? The zone data will be removed from Active Directory.`;
        if (!(await confirm(q))) return false;
        return N.setZone(zn, { adIntegrated: ad.checked });
      } });
  }
  function changeReplication(zn, opts = {}) {
    let rep = N.zone(zn).replication || 'Domain';
    const domain = WS.state.system.domain || '';
    return formDialog({ title: 'Change Zone Replication Scope', width: 470, onCreate: opts.onCreate,
      content: h('div', h('div', 'Choose how you want zone data to be replicated.'), ...radios('zrep', [['Forest', `To all DNS servers running on domain controllers in this forest: ${domain}`],
        ['Domain', `To all DNS servers running on domain controllers in this domain: ${domain}`], ['Legacy', `To all domain controllers in this domain (for Windows 2000 compatibility): ${domain}`]], rep, v => { rep = v; })),
      submit: () => N.setZone(zn, { replication: rep }) });
  }
  function agingDialog(title, aging, opts = {}) {
    const on = field('scavenge', F.checkbox('Scavenge stale resource records', aging.enabled));
    const nr = interval('noRefresh', aging.noRefresh * 3600), rf = interval('refresh', aging.refresh * 3600);
    return formDialog({ title, width: 430, onCreate: opts.onCreate, content: h('div', on,
      F.group('No-refresh interval', F.note('The time between the most recent refresh of a record time stamp and the moment when the time stamp may be refreshed again.'), F.row('No-refresh interval:', nr.el, { labelWidth: 120 })),
      F.group('Refresh interval', F.note('The time between the earliest moment when a record time stamp can be refreshed and the earliest moment when the record can be scavenged. The refresh interval must be longer than the maximum record refresh period.'), F.row('Refresh interval:', rf.el, { labelWidth: 120 }))),
      submit: () => opts.apply({ enabled: on.checked, noRefresh: Math.max(1, Math.round(nr.value / 3600)), refresh: Math.max(1, Math.round(rf.value / 3600)) }) });
  }

  /** Zone Properties: General, Start of Authority (SOA), Name Servers, Zone Transfers. opts.tab picks the first tab. */
  function zoneProperties(zn, opts = {}) {
    const z0 = N.zone(zn); if (!z0) return null;
    const z = () => N.zone(zn);
    const tabs = [];
    let sheet;
    tabs.push({ label: 'General', render: () => {
      const status = F.value(''), type = F.value(''), rep = F.value(''), pauseBtn = F.button('Pause', togglePause);
      const repRow = F.row('Replication:', h('div.dns-inline', rep, F.button('Change...', () => changeReplication(zn).then(paint))), { labelWidth: 110 });
      const file = field('file', F.text({ value: z0.file || '' }));
      const fileRow = F.row('Zone file name:', file, { labelWidth: 110 }), adNote = F.note('Data is stored in Active Directory.');
      const dyn = field('dynamicUpdate', F.select([], ''));
      const warn = h('div.dns-warn', 'Allowing nonsecure dynamic updates is a significant security vulnerability because updates can be accepted from untrusted sources.');
      [pauseBtn].forEach(b => b.setAttribute('data-nodirty', ''));
      let lastDyn = z0.dynamicUpdate;
      function paint() {
        const zz = z();
        status.textContent = zz.paused ? 'Paused' : 'Running'; pauseBtn.textContent = zz.paused ? 'Start' : 'Pause';
        type.textContent = zoneType(zz); rep.textContent = zz.adIntegrated ? REP_LABEL[zz.replication] || zz.replication : '';
        repRow.style.display = zz.adIntegrated ? '' : 'none'; fileRow.style.display = zz.adIntegrated ? 'none' : ''; adNote.style.display = zz.adIntegrated ? '' : 'none';
        if (!zz.adIntegrated && !file.value) file.value = zz.file || '';
        U.clear(dyn);
        for (const v of zz.adIntegrated ? ['None', 'NonsecureAndSecure', 'Secure'] : ['None', 'NonsecureAndSecure']) dyn.appendChild(h('option', { value: v, selected: v === (lastDyn === 'Secure' && !zz.adIntegrated ? 'None' : lastDyn) }, DYN_LABEL[v]));
        lastDyn = dyn.value;
        warn.style.display = dyn.value === 'NonsecureAndSecure' ? '' : 'none';
      }
      function togglePause() { N.setZone(zn, { paused: !z().paused }); paint(); }
      dyn.addEventListener('change', async () => {
        if (dyn.value === 'NonsecureAndSecure' && lastDyn !== 'NonsecureAndSecure') {
          const ans = await WS.ui.msgbox({ title: 'DNS', icon: 'warning', buttons: ['Yes', 'No'], message: 'Allowing nonsecure dynamic updates is a significant security vulnerability because updates can be accepted from untrusted sources.\n\nDo you want to continue?' });
          if (ans !== 'Yes') { dyn.value = lastDyn; return; }
        }
        lastDyn = dyn.value; warn.style.display = dyn.value === 'NonsecureAndSecure' ? '' : 'none';
      });
      paint();
      tabs[0].paint = paint;
      tabs[0].controls = { dyn, file };
      return h('div.dns-form', h('div.dns-head', h('span', { html: zoneIcon(z0) }), zn),
        F.row('Status:', h('div.dns-inline', status, pauseBtn), { labelWidth: 110 }),
        F.row('Type:', h('div.dns-inline', type, F.button('Change...', () => changeZoneType(zn).then(paint))), { labelWidth: 110 }),
        repRow, fileRow, adNote, F.row('Dynamic updates:', dyn, { labelWidth: 110 }), warn,
        F.sep(), h('div.dns-inline', h('span', { style: 'flex:1' }, 'To set aging/scavenging properties, click Aging.'), F.button('Aging...', () => agingDialog('Zone Aging/Scavenging Properties', N.zoneInfo(z()).aging, { apply: a => N.setZone(zn, { aging: a }) }))));
    }, apply: () => {
      const { dyn, file } = tabs[0].controls, zz = z(), props = {};
      if (dyn.value !== zz.dynamicUpdate) props.dynamicUpdate = dyn.value;
      if (!zz.adIntegrated && file.value.trim() !== zz.file) props.file = file.value.trim();
      return Object.keys(props).length ? N.setZone(zn, props) : null;
    } });
    tabs.push({ label: 'Start of Authority (SOA)', render: () => {
      const soa = z0.records.find(r => r.type === 'SOA'), c = {};
      c.serial = field('serial', F.number({ value: z0.serial || 1, min: 0, width: 110 }));
      c.primary = field('primary', F.text({ value: soa.data.primary })); c.responsible = field('responsible', F.text({ value: soa.data.responsible }));
      for (const k of ['refresh', 'retry', 'expire', 'minimum']) c[k] = interval(k, soa.data[k]);
      c.ttl = ttlInput('soaTtl', soa.ttl || 3600);
      tabs[1].controls = c; tabs[1].serial = z0.serial || 1;
      const inc = F.button('Increment', () => { c.serial.value = (+c.serial.value || 0) + 1; sheet.setDirty(); });
      return h('div.dns-form', F.row('Serial number:', h('div.dns-inline', c.serial, inc), { labelWidth: 150 }),
        F.stack('Primary server:', h('div.dns-inline', c.primary, F.button('Browse...', () => browseHost(c.primary)))),
        F.stack('Responsible person:', h('div.dns-inline', c.responsible, F.button('Browse...', () => {}, { disabled: true }))),
        F.row('Refresh interval:', c.refresh.el, { labelWidth: 150 }), F.row('Retry interval:', c.retry.el, { labelWidth: 150 }),
        F.row('Expires after:', c.expire.el, { labelWidth: 150 }), F.row('Minimum (default) TTL:', c.minimum.el, { labelWidth: 150 }),
        F.row('TTL for this record:', c.ttl.el, { labelWidth: 150 }));
    }, apply: () => {
      const c = tabs[1].controls, soa = { primary: c.primary.value, responsible: c.responsible.value, ttl: c.ttl.value };
      for (const k of ['refresh', 'retry', 'expire', 'minimum']) soa[k] = c[k].value;
      if (+c.serial.value !== tabs[1].serial) soa.serial = +c.serial.value;
      const r = N.setZone(zn, { soa });
      if (r.ok) { tabs[1].serial = z().serial; c.serial.value = z().serial; }
      return r;
    } });
    tabs.push({ label: 'Name Servers', render: () => {
      let draft = z0.records.filter(r => r.type === 'NS' && r.name === '@').map(r => r.data);
      const ipOf = f => { const a = N.query(f, 'A'); return a.records.filter(x => x.type === 'A').map(x => x.data).join(', ') || (WS.net.resolve(f).addresses || []).join(', ') || 'Unknown'; };
      const list = WS.ui.listView({ columns: [{ key: 'fqdn', label: 'Server Fully Qualified Domain Name (FQDN)', width: 250 }, { key: 'ip', label: 'IP Address', width: 120 }],
        rows: () => draft.map(f => ({ fqdn: f, ip: `[${ipOf(f)}]` })), getId: r => r.fqdn, sortKey: null, onSelect: () => { remove.disabled = !list.selected().length; } });
      list.el.classList.add('dns-nslist'); list.el.setAttribute('data-nodirty', '');
      const add = async () => {
        const name = field('nsServer', F.text());
        const ok = await formDialog({ title: 'New Name Server Record', width: 420, content: h('div', F.note('Enter a server name and one or more IP addresses. Both are required to identify the name server.'), F.stack('Server fully qualified domain name (FQDN):', name)),
          submit: () => { const v = name.value.trim(); return /^[A-Za-z0-9.-]+$/.test(v) ? { ok: true, value: v.replace(/\.?$/, '.') } : { ok: false, error: 'Type the fully qualified domain name of the name server.' }; } });
        if (ok && ok.value && !draft.some(f => f.toLowerCase() === ok.value.toLowerCase())) { draft.push(ok.value.toLowerCase()); list.refresh(); sheet.setDirty(); }
      };
      const remove = F.button('Remove', () => { const gone = new Set(list.selected().map(r => r.fqdn)); draft = draft.filter(f => !gone.has(f)); list.refresh(); sheet.setDirty(); }, { disabled: true });
      tabs[2].draft = () => draft;
      return h('div.dns-form', h('div', 'To add name servers to the list, click Add.'), h('div', 'Name servers:'), list.el,
        h('div.dns-buttons', F.button('Add...', add), F.button('Edit...', () => {}, { disabled: true }), remove),
        F.note('* represents an IP address retrieved as the result of a DNS query and may not represent actual records stored on this server.'));
    }, apply: () => {
      const want = tabs[2].draft().map(f => f.toLowerCase()), have = z().records.filter(r => r.type === 'NS' && r.name === '@').map(r => r.data.toLowerCase());
      if (!want.length) return { ok: false, error: 'A zone must contain at least one name server (NS) record.' };
      for (const f of want.filter(f => !have.includes(f))) { const r = N.addRecord(zn, { name: '@', type: 'NS', data: f }); if (!r.ok) return { ok: false, error: friendly(r) }; }
      for (const f of have.filter(f => !want.includes(f))) { const r = N.removeRecord(zn, { name: '@', type: 'NS', data: f }); if (!r.ok) return r; }
      return { ok: true };
    } });
    tabs.push({ label: 'Zone Transfers', render: () => {
      const info = N.zoneInfo(z0);
      let mode = info.transfers === 'None' ? 'NameServers' : info.transfers, servers = info.transferList;
      const allow = field('allowTransfers', F.checkbox('Allow zone transfers:', info.transfers !== 'None'));
      const opts3 = radios('xfer', [['Any', 'To any server'], ['NameServers', 'Only to servers listed on the Name Servers tab'], ['List', 'Only to the following servers']], mode, v => { mode = v; });
      const listBox = h('div.dns-xferlist');
      const paintList = () => { U.clear(listBox); for (const ip of servers) listBox.appendChild(h('div', ip)); };
      const edit = F.button('Edit...', () => editServerList('Allow Zone Transfers', servers).then(v => { if (v) { servers = v; paintList(); sheet.setDirty(); } }));
      const paint = () => { for (const r of opts3) { r.input.disabled = !allow.checked; r.classList.toggle('disabled', !allow.checked); } edit.disabled = !allow.checked || mode !== 'List'; };
      allow.input.addEventListener('change', paint); opts3.forEach(r => r.input.addEventListener('change', paint));
      paintList(); setTimeout(paint, 0);
      tabs[3].value = () => ({ transfers: allow.checked ? mode : 'None', transferList: servers });
      return h('div.dns-form', h('p', 'A zone transfer sends a copy of the zone to the servers that request a copy.'), allow, h('div.dns-sub', ...opts3, h('div.dns-sub', listBox, edit)),
        F.sep(), h('div.dns-inline', h('span', { style: 'flex:1' }, 'To specify secondary servers to be notified of zone updates, click Notify.'), F.button('Notify...', () => {}, { disabled: true })));
    }, apply: () => {
      const v = tabs[3].value(), info = N.zoneInfo(z());
      return v.transfers === info.transfers && JSON.stringify(v.transferList) === JSON.stringify(info.transferList) ? null : N.setZone(zn, v);
    } });
    const initial = Math.max(0, tabs.findIndex(t => t.label === opts.tab));
    return WS.ui.propertySheet({ title: zn + ' Properties', width: 470, errorTitle: 'DNS', initialTab: initial, tabs, onCreate: s => { sheet = s; if (opts.onCreate) opts.onCreate(s); } });
  }
  function editServerList(title, initial, opts = {}) {
    const box = ipList(initial);
    return formDialog({ title, width: 600, onCreate: opts.onCreate, api: box, content: h('div', h('div', 'IP addresses of the servers:'), box.el),
      submit: async () => { if (box.list.el.isConnected) await box.add(); return { ok: true, value: box.values() }; } }).then(r => (r && r.value) || null);
  }

  /* ---------------- server ---------------- */
  /** Edit Forwarders: resolves to the new list (or null on Cancel). */
  function editForwarders(initial, opts = {}) {
    const box = ipList(initial);
    const timeout = field('timeout', F.number({ value: 3, min: 1, max: 15 }));
    return formDialog({ title: 'Edit Forwarders', width: 620, onCreate: opts.onCreate, api: box, content: h('div', h('div', 'IP addresses of forwarding servers:'), box.el,
      F.row('Number of seconds before forward queries time out:', timeout, { labelWidth: 290 }),
      F.note('The server FQDN will not be available if the appropriate reverse lookup zones and entries are not configured.')),
      submit: async () => { await box.add(); return { ok: true, value: box.values() }; } }).then(r => (r && r.value) || null);
  }

  let monitorResults = [];
  /** Server Properties: Interfaces, Forwarders, Advanced, Root Hints, Event Logging, Monitoring. */
  function serverProperties(opts = {}) {
    if (!installed()) return null;
    const tabs = [];
    let sheet, forwarders = N.forwarders();
    const ips = WS.net.ownIps();
    tabs.push({ label: 'Interfaces', render: () => h('div.dns-form', h('p', 'Select the IP addresses that will serve DNS requests. The server can listen for DNS queries on all IP addresses defined on this computer, or you can limit it to selected IP addresses.'),
      h('div', 'Listen on:'), ...radios('listen', [['all', 'All IP addresses'], ['some', 'Only the following IP addresses:', { disabled: true }]], 'all', () => {}),
      h('div.dns-sub.dns-xferlist', ...ips.map(ip => F.checkbox(ip, true, { disabled: true })), F.checkbox((WS.net.adapter().linkLocal6 || 'fe80::').replace(/%\d+$/, ''), true, { disabled: true }))) });
    tabs.push({ label: 'Forwarders', render: () => {
      const list = WS.ui.listView({ columns: [{ key: 'ip', label: 'IP Address', width: 130 }, { key: 'fqdn', label: 'Server FQDN', width: 220 }], getId: r => r.ip, sortKey: null,
        rows: () => forwarders.map(ip => ({ ip, fqdn: WS.net.reverse(ip, ip) || '<Unable to resolve>' })) });
      list.el.classList.add('dns-nslist'); list.el.setAttribute('data-nodirty', '');
      const hints = field('useRootHints', F.checkbox('Use root hints if no forwarders are available', N.useRootHints()));
      tabs[1].hints = hints;
      return h('div.dns-form', h('p', 'Forwarders are DNS servers that this server can use to resolve DNS queries for records that this server cannot resolve.'), list.el, hints,
        h('div.dns-buttons', F.button('Edit...', () => editForwarders(forwarders).then(v => { if (v) { forwarders = v; list.refresh(); sheet.setDirty(); } }))),
        F.note('Note: If conditional forwarders are defined for a given domain, they will be used instead of server-level forwarders. To create or view conditional forwarders, navigate to the Conditional Forwarders node in the scope tree.'));
    }, apply: () => {
      if (JSON.stringify(forwarders) !== JSON.stringify(N.forwarders())) { const r = N.setForwarders(forwarders); if (!r.ok) return r; }
      return tabs[1].hints.checked !== N.useRootHints() ? N.setUseRootHints(tabs[1].hints.checked) : null;
    } });
    tabs.push({ label: 'Advanced', render: () => h('div.dns-form', F.row('Server version number:', F.value('10.0 26100 (0x6604)'), { labelWidth: 150 }),
      h('div', 'Server options:'), h('div.dns-xferlist', ...[['Disable recursion (also disables forwarders)', false], ['Enable BIND secondaries', false], ['Fail on load if bad zone data', false],
        ['Enable round robin', true], ['Enable netmask ordering', true], ['Secure cache against pollution', true]].map(([l, v]) => F.checkbox(l, v, { disabled: true }))),
      F.row('Name checking:', F.select(['Multibyte (UTF8)'], 'Multibyte (UTF8)', { disabled: true, width: 220 }), { labelWidth: 150 }),
      F.row('Load zone data on startup:', F.select(['From Active Directory and registry'], 'From Active Directory and registry', { disabled: true, width: 220 }), { labelWidth: 150 }),
      F.checkbox('Enable automatic scavenging of stale records', false, { disabled: true }), F.row('Scavenging period:', h('div.dns-inline', F.number({ value: 7, disabled: true }), F.select(['days'], 'days', { disabled: true })), { labelWidth: 150 }),
      F.note('These server options keep their default values in the lab.')) });
    tabs.push({ label: 'Root Hints', render: () => {
      const list = WS.ui.listView({ columns: [{ key: 'name', label: 'Server Fully Qualified Domain Name (FQDN)', width: 250 }, { key: 'ip', label: 'IP Address', width: 130 }],
        rows: N.ROOT_HINTS.map(r => ({ ...r, ip: `[${r.ip}]` })), getId: r => r.name, sortKey: null });
      list.el.classList.add('dns-roots');
      return h('div.dns-form', h('p', 'Root hints resolve queries for zones that do not exist on the local DNS server. They are only used if forwarders are not configured or fail to respond.'),
        h('div', 'Name servers:'), list.el, h('div.dns-buttons', ...['Add...', 'Edit...', 'Remove'].map(l => F.button(l, () => {}, { disabled: true })), F.button('Copy from Server...', () => {}, { disabled: true })));
    } });
    tabs.push({ label: 'Event Logging', render: () => {
      let level = N.eventLogging();
      tabs[4].value = () => level;
      return h('div.dns-form', h('div', 'Log the following events:'), ...radios('evlog', [['None', 'No events'], ['Errors', 'Errors only'], ['ErrorsAndWarnings', 'Errors and warnings'], ['All', 'All events']], level, v => { level = v; }));
    }, apply: () => (tabs[4].value() !== N.eventLogging() ? N.setEventLogging(tabs[4].value()) : null) });
    tabs.push({ label: 'Monitoring', render: () => {
      const simple = field('simple', F.checkbox('A simple query against this DNS server', false)), recursive = field('recursive', F.checkbox('A recursive query to other DNS servers', false));
      [simple, recursive].forEach(c => c.setAttribute('data-nodirty', ''));
      const results = WS.ui.listView({ columns: [{ key: 'date', label: 'Date', width: 90 }, { key: 'time', label: 'Time', width: 90 }, { key: 'simple', label: 'Simple Query', width: 100 }, { key: 'recursive', label: 'Recursive Query', width: 110 }],
        rows: () => monitorResults, getId: r => r.id, sortKey: null });
      results.el.classList.add('dns-nslist');
      const test = F.button('Test Now', () => {
        if (!simple.checked && !recursive.checked) return;
        const now = new Date(), self = WS.net.primaryIp() || '127.0.0.1';
        const simpleOk = running() && WS.net.queryServer('127.0.0.1', WS.sys.fqdn(), 'A').status !== 'timeout';
        const rec = WS.net.queryServer('127.0.0.1', 'www.microsoft.com', 'A');
        monitorResults.unshift({ id: U.uid('mon'), date: U.fmtDate(now), time: U.fmtTime(now, true), simple: simple.checked ? (simpleOk ? 'Pass' : 'Fail') : '', recursive: recursive.checked ? (running() && rec.status === 'ok' ? 'Pass' : 'Fail') : '', self });
        results.refresh();
      });
      test.setAttribute('data-nodirty', '');
      tabs[5].api = { simple, recursive, test, results };
      return h('div.dns-form', h('p', 'To verify the configuration of the server, you can perform manual or automatic testing.'), h('div', 'Select a test type:'), simple, recursive,
        h('div.dns-buttons', test), F.checkbox('Perform automatic testing at the following interval:', false, { disabled: true }), h('div', 'Test results:'), results.el);
    } });
    const initial = Math.max(0, tabs.findIndex(t => t.label === opts.tab));
    return WS.ui.propertySheet({ title: WS.sys.name + ' Properties', width: 500, errorTitle: 'DNS', initialTab: initial, tabs, onCreate: s => { sheet = s; s.tabs = tabs; guardEnter(s.frame); if (opts.onCreate) opts.onCreate(s); } });
  }

  /* ---------------- conditional forwarders ---------------- */
  function newConditionalForwarder(opts = {}) {
    if (!installed()) return null;
    const domain = field('domain', F.text()), box = ipList([]);
    const dc = WS.sys.isDC();
    const store = field('storeInAd', F.checkbox('Store this conditional forwarder in Active Directory, and replicate it as follows:', false, { disabled: !dc }));
    const rep = field('replication', F.select([{ value: 'Forest', label: 'All DNS servers in this forest' }, { value: 'Domain', label: 'All DNS servers in this domain' }, { value: 'Legacy', label: 'All domain controllers in this domain (for Windows 2000 compatibility)' }], 'Forest', { disabled: true, width: 380 }));
    store.input.addEventListener('change', () => { rep.disabled = !store.checked; });
    const timeout = field('timeout', F.number({ value: 5, min: 1, max: 15 }));
    return formDialog({ title: 'New Conditional Forwarder', width: 620, onCreate: opts.onCreate, api: box, content: h('div', F.stack('DNS Domain:', domain), h('div', 'IP addresses of the master servers:'), box.el,
      store, h('div.dns-sub', rep), F.row('Number of seconds before forward queries time out:', timeout, { labelWidth: 290 }),
      F.note('The server FQDN will not be available if the appropriate reverse lookup zones and entries are not configured.')),
      submit: async () => { await box.add(); return N.addConditionalForwarder({ name: domain.value, masters: box.values(), adIntegrated: store.checked, replication: rep.value, timeout: timeout.value }); } });
  }
  function conditionalForwarderProperties(name, opts = {}) {
    const cf = N.conditionalForwarder(name); if (!cf) return null;
    let box;
    return WS.ui.propertySheet({ title: cf.name + ' Properties', width: 620, errorTitle: 'DNS', onCreate: s => { guardEnter(s.frame); if (opts.onCreate) opts.onCreate(s); }, tabs: [{ label: 'General', render: s => {
      box = ipList(cf.masters, { onChange: () => s.setDirty() });
      return h('div.dns-form', F.row('Type:', F.value(cf.adIntegrated ? 'Active Directory-Integrated Conditional Forwarder' : 'Conditional Forwarder'), { labelWidth: 90 }),
        cf.adIntegrated ? F.row('Replication:', F.value(REP_LABEL[cf.replication]), { labelWidth: 90 }) : null, h('div', 'IP addresses of the master servers:'), box.el);
    }, apply: async () => { await box.add(); return N.setConditionalForwarder(cf.name, { masters: box.values() }); } }] });
  }

  /* ---------------- delete ---------------- */
  async function deleteRows(zn, rel, rows) {
    const z = N.zone(zn); if (!z || !rows.length) return { ok: false };
    const folders = rows.filter(r => r.kind === 'folder'), recs = rows.filter(r => r.kind === 'record');
    if (recs.some(r => r.rec.type === 'SOA')) { await error('The Start of Authority (SOA) record cannot be deleted.'); return { ok: false }; }
    for (const f of folders) {
      if (!(await confirm(`Do you want to delete the domain ${f.label} and all of the records it contains?`))) return { ok: false, cancelled: true };
      const r = N.removeDomain(zn, f.rel); if (!r.ok) { await error(r.error); return r; }
    }
    if (!recs.length) return { ok: true };
    const ptrs = recs.map(r => N.findPtr(zn, r.rec)).filter(Boolean);
    const ptrBox = ptrs.length ? field('deletePtr', F.checkbox(ptrs.length > 1 ? 'Delete the associated pointer (PTR) records' : 'Delete the associated pointer (PTR) record', true)) : null;
    const q = recs.length === 1 ? `Do you want to delete the record ${recs[0].label} from the server?` : 'Do you want to delete the selected records from the server?';
    if (!(await confirm(q, ptrBox ? h('div', { style: 'margin-top:10px' }, ptrBox) : null))) return { ok: false, cancelled: true };
    for (const row of recs) {
      const r = N.removeRecord(zn, { name: row.rec.name, type: row.rec.type, data: typeof row.rec.data === 'string' ? row.rec.data : undefined });
      if (!r.ok) { await error(r.error); return r; }
    }
    if (ptrBox && ptrBox.checked) for (const p of ptrs) N.removeRecord(p.zone, { name: p.record.name, type: 'PTR', data: p.record.data });
    return { ok: true };
  }
  async function deleteZone(zn) {
    const z = N.zone(zn); if (!z) return { ok: false };
    if (!(await confirm(`Do you want to delete the zone ${zn} from the server?`))) return { ok: false, cancelled: true };
    if (z.adIntegrated && !(await confirm(`The zone ${zn} is stored in Active Directory. Deleting it removes it from every DNS server that loads the zone from Active Directory.\n\nDo you want to delete the zone from Active Directory?`))) return { ok: false, cancelled: true };
    return N.removeZone(zn);
  }
  async function deleteForwarder(name) {
    if (!(await confirm(`Do you want to delete the conditional forwarder ${name} from the server?`))) return { ok: false, cancelled: true };
    return N.removeConditionalForwarder(name);
  }

  /** Launch nslookup: a Command Prompt running nslookup in interactive mode. */
  function launchNslookup() {
    const win = WS.apps.launch('cmd');
    const tab = win && win.terminal && win.terminal.active;
    if (!tab) return win;
    let tries = 0;
    const go = () => {
      const io = tab.console;
      if (io.disposed) return;
      if (!io.reading) { if (++tries < 50) setTimeout(go, 40); return; }
      io.insert('nslookup'); io.finishLine(io.reading.buf);
    };
    go();
    return win;
  }

  /* ---------------- the console ---------------- */
  async function serviceAction(verb) {
    const svc = WS.svc.get('DNS');
    if (!svc || !WS.services) return;
    if (verb === 'start') await WS.services.startSvc(svc);
    else if (verb === 'stop') await WS.services.stopSvc(svc);
    else await WS.services.restartSvc(svc);
  }
  function launch(opts = {}) {
    let advanced = false, mmc;
    const controller = { get mmc() { return mmc; }, get advanced() { return advanced; }, setAdvanced(v) { advanced = !!v; mmc.refresh(); }, locate };
    const zoneId = zn => 'z:' + zn.toLowerCase();
    const folderId = (zn, rel) => 'f:' + zn.toLowerCase() + '|' + rel.toLowerCase();
    function locate(zn, rel = '') {
      const z = N.zone(zn); if (!z) return;
      const path = ['dns', 'srv', z.reverse ? 'rlz' : 'flz', zoneId(z.name)];
      const labels = rel ? rel.split('.') : [];
      for (let i = labels.length - 1; i >= 0; i--) path.push(folderId(z.name, labels.slice(i).join('.')));
      mmc.selectPath(path);
    }
    const after = (promise, zn, rel) => { if (promise && promise.then) promise.then(() => { mmc.refresh(); }); return promise; };
    const newItems = (zn, rel) => {
      const z = N.zone(zn);
      return [
        ...(z.reverse ? [{ label: 'New &Pointer (PTR)...', action: () => after(newRecord('PTR', zn, rel)) }]
          : [{ label: 'New &Host (A or AAAA)...', action: () => after(newHost(zn, rel)) }]),
        { label: 'New &Alias (CNAME)...', action: () => after(newRecord('CNAME', zn, rel)) },
        z.reverse ? null : { label: 'New &Mail Exchanger (MX)...', action: () => after(newRecord('MX', zn, rel)) },
        { label: 'New &Domain...', action: () => after(newDomain(zn, rel)) },
        { label: 'New De&legation...', action: () => after(newDelegation(zn, rel)) },
        { label: '&Other New Records...', action: () => after(otherRecords(zn, rel)) }
      ];
    };
    const zoneMenu = zn => {
      const z = N.zone(zn); if (!z) return [];
      return [
        { label: '&Update Server Data File', disabled: z.adIntegrated, action: () => N.writeZoneFiles(zn) },
        { label: 'Re&load', action: async () => {
          const ok = await confirm(z.adIntegrated ? `Do you want to reload the zone ${zn} from Active Directory?` : `Reloading the zone ${zn} replaces its data with the contents of the zone file ${z.file}. Changes that have not been written to the file will be lost.\n\nDo you want to continue?`);
          if (ok) { const r = N.reloadZone(zn); if (!r.ok) error(r.error); }
        } },
        { separator: true }, ...newItems(zn, ''), { separator: true },
        { label: 'DNSSE&C', items: [{ label: '&Sign the Zone...', disabled: true }, { label: '&Properties', disabled: true }] },
        { separator: true },
        { label: '&Delete', icon: I.delete, action: () => after(deleteZone(zn)) }
      ];
    };
    const folderMenu = (zn, rel) => [...newItems(zn, rel), { separator: true }, { label: '&Delete', icon: I.delete, action: () => after(deleteRows(zn, rel, [{ kind: 'folder', rel, label: rel.split('.')[0] }])) }];
    const recordsView = (zn, rel) => ({
      columns: [
        { key: 'label', label: 'Name', width: 190, sort: (a, b, ra, rb) => rank(ra) - rank(rb) || String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true }) },
        { key: 'type', label: 'Type', width: 160, value: r => r.kind === 'folder' ? '' : TYPE_LABEL[r.rec.type] || r.rec.type },
        { key: 'data', label: 'Data', width: 250, value: r => r.kind === 'folder' ? '' : dataText(N.zone(zn), r.rec) },
        { key: 'stamp', label: 'Timestamp', width: 150, value: r => r.kind === 'folder' ? '' : stamp(r.rec) }
      ],
      rows: () => { const z = N.zone(zn); return z ? [...childFolders(z, rel), ...recordsAt(z, rel)] : []; },
      getId: rowId, sortKey: 'label', multi: true,
      icon: r => r.kind === 'folder' ? (r.delegation ? ICON.delegation : I.folder) : I.record,
      menu: rows => {
        if (!rows.length) return rel ? folderMenu(zn, rel).filter(x => !/Delete/.test(x.label || '')) : newItems(zn, '');
        if (rows.length === 1 && rows[0].kind === 'folder') return folderMenu(zn, rows[0].rel);
        return [{ label: '&Delete', icon: I.delete, disabled: rows.some(r => r.kind === 'record' && r.rec.type === 'SOA'), action: () => after(deleteRows(zn, rel, rows)) }];
      },
      hasProperties: r => r.kind === 'record',
      properties: r => (r.kind === 'record' ? after(recordProperties(zn, r.rec, { advanced })) : null),
      onActivate: r => (r.kind === 'folder' ? locate(zn, r.rel) : after(recordProperties(zn, r.rec, { advanced }))),
      delete: rows => after(deleteRows(zn, rel, rows)),
      itemLabel: r => r.label
    });
    const zoneRow = z => ({ id: z.name, name: z.name, type: zoneType(z), status: z.paused ? 'Paused' : 'Running', dnssec: 'Not Signed', key: '' });
    const zonesView = reverse => ({
      columns: [{ key: 'name', label: 'Name', width: 230 }, { key: 'type', label: 'Type', width: 230 }, { key: 'status', label: 'Status', width: 80 }, { key: 'dnssec', label: 'DNSSEC Status', width: 100 }, { key: 'key', label: 'Key Master', width: 100 }],
      rows: () => N.zones().filter(z => !!z.reverse === reverse).map(zoneRow), getId: r => r.id, icon: r => zoneIcon(N.zone(r.id) || {}),
      menu: rows => (rows.length === 1 ? zoneMenu(rows[0].id) : !rows.length ? [{ label: 'New &Zone...', action: () => after(newZone({ reverse })) }] : []),
      properties: r => after(zoneProperties(r.id)), onActivate: r => locate(r.id), delete: rows => { if (rows.length === 1) after(deleteZone(rows[0].id)); }, itemLabel: r => r.name
    });
    const folderList = items => ({ columns: [{ key: 'name', label: 'Name', width: 260 }], rows: () => items(), getId: r => r.id, icon: r => r.icon, onActivate: r => mmc.select(r.id) });
    const eventsView = {
      columns: [{ key: 'type', label: 'Type', width: 100, value: e => e.level }, { key: 'date', label: 'Date', width: 85, type: 'date', value: e => U.fmtDate(e.time), sort: (a, b, x, y) => x.record - y.record },
        { key: 'time', label: 'Time', width: 85, value: e => U.fmtTime(e.time, true), sort: (a, b, x, y) => x.record - y.record }, { key: 'source', label: 'Source', width: 140, value: () => 'DNS-Server-Service' },
        { key: 'task', label: 'Category', width: 80, value: e => e.task }, { key: 'id', label: 'Event', width: 60, type: 'num' }, { key: 'user', label: 'User', width: 70, value: () => 'N/A' }, { key: 'computer', label: 'Computer', width: 90, value: () => WS.sys.name }],
      rows: () => WS.evt.list('DNS Server'), getId: e => String(e.record), sortKey: 'date', sortDir: -1, multi: false,
      icon: e => ({ Error: I.eventError, Warning: I.eventWarning, Critical: I.eventCritical })[e.level] || I.eventInfo,
      properties: e => (WS.eventvwr && WS.eventvwr.eventProperties ? WS.eventvwr.eventProperties('DNS Server', e.record) : WS.ui.msgbox({ title: 'Event Properties', icon: 'info', message: `Event ${e.id}, ${e.source}`, detail: e.message })),
      itemLabel: e => `Event ${e.id}`
    };
    const serverDown = () => ({ render: host => {
      host.appendChild(h('div.dns-down.w32', h('div', { html: WS.ui.icons.error }), h('div',
        h('p', `The server ${WS.sys.name} could not be contacted. The error was: The RPC server is unavailable.`),
        !installed() ? h('p', 'The DNS Server role is not installed on this server. Install it with Server Manager (Manage > Add Roles and Features) or Install-WindowsFeature DNS.') : h('p', 'The DNS Server service is not running. To start it, right-click the server, point to All Tasks, and then click Start.'),
        !installed() ? F.button('Open Server Manager', () => WS.sm.open('dashboard')) : F.button('Start', () => serviceAction('start')))));
    } });
    const serverMenu = () => {
      const up = running(), svcRunning = installed() && WS.svc.isRunning('DNS');
      return [
        { label: 'Con&figure a DNS Server...', disabled: !up, action: () => WS.apps.notImplemented('Configure a DNS Server Wizard') },
        { label: 'New &Zone...', disabled: !up, action: () => after(newZone()) },
        { label: 'Set &Aging/Scavenging for All Zones...', disabled: !up, action: () => agingDialog('Server Aging/Scavenging Properties', { enabled: false, noRefresh: 168, refresh: 168 }, { apply: a => { for (const z of N.zones()) { const r = N.setZone(z.name, { aging: a }); if (!r.ok) return r; } return { ok: true }; } }) },
        { label: '&Scavenge Stale Resource Records', disabled: !up, action: async () => { if (await confirm('Do you want to scavenge all stale resource records on the server?')) N.scavenge(); } },
        { label: '&Update Server Data Files', disabled: !up, action: () => N.writeZoneFiles() },
        { label: '&Clear Cache', disabled: !up, action: () => N.clearCache() },
        { label: 'Launch &nslookup', action: launchNslookup },
        { separator: true },
        { label: 'All Tas&ks', disabled: !installed(), items: () => [
          { label: '&Start', disabled: svcRunning, action: () => serviceAction('start') },
          { label: 'S&top', disabled: !svcRunning, action: () => serviceAction('stop') },
          { label: '&Pause', disabled: true }, { label: 'R&esume', disabled: true },
          { label: 'Rest&art', disabled: !svcRunning, action: () => serviceAction('restart') }
        ] }
      ];
    };
    const zoneNode = z => ({ id: zoneId(z.name), label: z.name, icon: zoneIcon(z), children: () => { const zz = N.zone(z.name); return zz ? childFolders(zz, '').map(f => folderNode(z.name, f)) : []; },
      menu: () => zoneMenu(z.name), properties: () => after(zoneProperties(z.name)), view: () => recordsView(z.name, '') });
    const folderNode = (zn, f) => ({ id: folderId(zn, f.rel), label: f.label, icon: f.delegation ? ICON.delegation : I.folder,
      children: () => { const z = N.zone(zn); return z ? childFolders(z, f.rel).map(c => folderNode(zn, c)) : []; },
      menu: () => folderMenu(zn, f.rel), view: () => recordsView(zn, f.rel) });
    const lookupNode = reverse => ({ id: reverse ? 'rlz' : 'flz', label: reverse ? 'Reverse Lookup Zones' : 'Forward Lookup Zones', icon: I.folder,
      children: () => N.zones().filter(z => !!z.reverse === reverse).map(zoneNode), menu: () => [{ label: 'New &Zone...', action: () => after(newZone({ reverse })) }], view: () => zonesView(reverse) });
    const cfNode = () => ({ id: 'cf', label: 'Conditional Forwarders', icon: I.folder,
      menu: () => [{ label: 'New Conditional &Forwarder...', action: () => after(newConditionalForwarder()) }],
      view: { columns: [{ key: 'name', label: 'Name', width: 230 }, { key: 'type', label: 'Type', width: 300, value: c => c.adIntegrated ? 'Active Directory-Integrated Conditional Forwarder' : 'Conditional Forwarder' }],
        rows: () => N.conditionalForwarders(), getId: c => c.name, icon: () => ICON.forwarder,
        menu: rows => rows.length ? [{ label: '&Delete', icon: I.delete, disabled: rows.length !== 1, action: () => after(deleteForwarder(rows[0].name)) }] : [{ label: 'New Conditional &Forwarder...', action: () => after(newConditionalForwarder()) }],
        properties: c => after(conditionalForwarderProperties(c.name)), delete: rows => { if (rows.length === 1) after(deleteForwarder(rows[0].name)); }, itemLabel: c => c.name } });
    const children = () => [lookupNode(false), lookupNode(true),
      { id: 'tp', label: 'Trust Points', icon: I.folder, view: { columns: [{ key: 'name', label: 'Name', width: 230 }, { key: 'type', label: 'Type', width: 160 }, { key: 'data', label: 'Data', width: 200 }], rows: () => [], getId: r => r.name } },
      cfNode(),
      { id: 'logs', label: 'Global Logs', icon: I.folder, children: () => [{ id: 'dnsevents', label: 'DNS Events', icon: I.log, view: eventsView }], view: folderList(() => [{ id: 'dnsevents', name: 'DNS Events', icon: I.log }]) }];
    const serverNode = () => ({ id: 'srv', label: WS.sys.name, icon: running() ? ICON.server : ICON.serverDown, expanded: true,
      children: () => (running() ? children() : []), menu: serverMenu, properties: running() ? () => after(serverProperties()) : null,
      view: () => running() ? folderList(() => children().map(n => ({ id: n.id, name: n.label, icon: n.icon }))) : serverDown() });
    mmc = WS.mmc.create({ app: 'dnsmgmt', title: TITLE, icon: ICON.dns, width: 1240, height: 680, topics: ['dns', 'services', 'features', 'system', 'events', 'network'],
      select: 'dns',
      nodes: () => [{ id: 'dns', label: 'DNS', icon: ICON.dns, expanded: true, children: () => [serverNode()],
        menu: () => [{ label: '&Connect to DNS Server...', action: () => WS.apps.notImplemented('Connect to DNS Server') }],
        view: { columns: [{ key: 'name', label: 'Name', width: 260 }], rows: () => [{ id: 'srv', name: WS.sys.name }], getId: r => r.id, icon: () => (running() ? ICON.server : ICON.serverDown), onActivate: () => mmc.select('srv') } }],
      viewMenu: () => [{ label: '&Advanced', checked: advanced, action: () => controller.setAdvanced(!advanced) }] });
    mmc.win.dnsmgmt = controller;
    if (opts.onCreate) opts.onCreate(controller);
    return mmc.win;
  }

  WS.dnsmgmt = { launch, newZone, newHost, newRecord, otherRecords, newDomain, newDelegation, newConditionalForwarder, recordProperties, zoneProperties,
    serverProperties, conditionalForwarderProperties, editForwarders, editServerList, changeZoneType, changeReplication, deleteRows, deleteZone, deleteForwarder,
    launchNslookup, folderSet, childFolders, recordsAt, TYPE_LABEL, icons: ICON };
  WS.apps.register({ id: 'dnsmgmt', name: TITLE, icon: ICON.dns, launch, keywords: ['dns', 'dnsmgmt.msc', 'dns manager', 'zones'] });
})();
