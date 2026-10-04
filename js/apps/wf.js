/* Windows Defender Firewall with Advanced Security (wf.msc). Rules and profiles are read and changed only through WS.fw,
 * the model New-NetFirewallRule, Set-NetFirewallProfile and netsh advfirewall use, so every tool agrees.
 * Tree: <root> > Inbound Rules | Outbound Rules | Connection Security Rules | Monitoring > Firewall |
 *       Connection Security Rules | Security Associations > Main Mode | Quick Mode. The root and Monitoring are overview pages.
 *   WS.wf.launch({ select }) -> win; win.wf = controller { mmc, open(nodeId), filter(dir), setFilter(dir, { profile, state, group }), clearFilters(dir) }
 *   newRule(direction, opts) -> Promise<rule | rules[] | null>   New Inbound/Outbound Rule Wizard (Program, Port, Predefined, Custom)
 *   ruleProperties(name, opts) -> Promise<bool>                   General | Programs and Services | Remote Computers | Protocols and Ports |
 *                                                                 Scope | Advanced | Local Principals | Remote Users
 *   firewallProperties(opts) -> Promise<bool>                     Domain / Private / Public Profile | IPsec Settings
 *   setEnabled(names, on), deleteRules(names), exportPolicy(opts), importPolicy(opts), restoreDefaults()
 * Dialogs take opts.onCreate with the live wizard / sheet / frame; controls carry data-field names for tests.
 * Not modelled: connection security (IPsec) rules and security associations (always empty), authorized users/computers,
 * interface types, ICMP type settings, application packages and services. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = WS.ui.f, FWM = WS.fw;
  const TITLE = 'Windows Defender Firewall with Advanced Security';
  const ROOT = `${TITLE} on Local Computer`;
  const PROFILES = ['Domain', 'Private', 'Public'];
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const ICON = {
    app: s16('<path d="M8 1.2l5.6 2v4.2c0 3.4-2.3 6.1-5.6 7.4C4.7 13.5 2.4 10.8 2.4 7.4V3.2z" fill="#d9772b" stroke="#a24f12" stroke-width=".7"/><path d="M4 6h8M4 9h8M8 3.5v10" stroke="#f3c08f" stroke-width=".9"/>'),
    inbound: s16('<rect x="1.5" y="2.5" width="9" height="11" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3.5 5.5h5M3.5 8h5M3.5 10.5h3" stroke="#8a97a6"/><path d="M15.5 8H10.5M12.6 5.9L10.4 8l2.2 2.1" fill="none" stroke="#2f7fd8" stroke-width="1.5"/>'),
    outbound: s16('<rect x="1.5" y="2.5" width="9" height="11" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3.5 5.5h5M3.5 8h5M3.5 10.5h3" stroke="#8a97a6"/><path d="M10.4 8h5M13.4 5.9L15.6 8l-2.2 2.1" fill="none" stroke="#2f7fd8" stroke-width="1.5"/>'),
    consec: s16('<rect x="1.5" y="2.5" width="9" height="11" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3.5 5.5h5M3.5 8h5" stroke="#8a97a6"/><rect x="9.5" y="8.5" width="5.5" height="5" rx=".8" fill="#c99a00"/><path d="M10.8 8.5V7a1.5 1.5 0 0 1 3 0v1.5" fill="none" stroke="#c99a00" stroke-width="1.1"/>'),
    monitor: s16('<rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="#5b6b7d"/><rect x="2.6" y="3.6" width="10.8" height="6.8" fill="#9fc1e3"/><path d="M4 8.5l2-2 2 1.5 3-3" fill="none" stroke="#0f7b0f" stroke-width="1.2"/><path d="M6 14h4M8 11.5V14" stroke="#5b6b7d" stroke-width="1.2"/>'),
    sa: s16('<circle cx="5" cy="8" r="3.5" fill="#fff" stroke="#6b7c8f"/><circle cx="11" cy="8" r="3.5" fill="#fff" stroke="#6b7c8f"/><path d="M5 8h6" stroke="#c99a00" stroke-width="1.6"/>'),
    ok: s16('<path d="M8 1.2l5.6 2v4.2c0 3.4-2.3 6.1-5.6 7.4C4.7 13.5 2.4 10.8 2.4 7.4V3.2z" fill="#0f7b0f"/><path d="M5.2 8l2 2 3.6-3.8" fill="none" stroke="#fff" stroke-width="1.5"/>'),
    off: s16('<path d="M8 1.2l5.6 2v4.2c0 3.4-2.3 6.1-5.6 7.4C4.7 13.5 2.4 10.8 2.4 7.4V3.2z" fill="#c42b1c"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.5"/>'),
    block: s16('<circle cx="8" cy="8" r="6.3" fill="#c42b1c"/><path d="M4.6 8h6.8" stroke="#fff" stroke-width="2"/>'),
    allow: s16('<circle cx="8" cy="8" r="6.3" fill="#0f7b0f"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.6"/>')
  };
  const field = (name, control) => { const input = control.input || control; input.dataset.field = name; input.setAttribute('aria-label', name); return control; };
  const err = (r, title = TITLE) => WS.ui.msgbox({ title, icon: 'error', message: typeof r === 'string' ? r : r.error, detail: r.detail });
  const ask = (message, title = TITLE) => WS.ui.msgbox({ title, icon: 'warning', message, buttons: ['Yes', 'No'] }).then(a => a === 'Yes');
  const SEP = { separator: true };
  const profText = p => (p === 'Any' ? 'All' : p);
  const rule = name => FWM.rules().find(r => r.name === name) || null;
  const full = r => FWM.ruleDefaults(r);
  const ruleIcon = r => (!r.enabled ? I.ruleOff : r.action === 'Block' ? I.ruleBlock : I.ruleAllow);
  const PORT_EXAMPLE = 'Example: 80, 443, 5000-5010';
  const portsOk = v => String(v).split(',').every(x => /^\d+(-\d+)?$/.test(x.trim()) && x.trim().split('-').every(n => +n <= 65535));

  /* ================================================================ commands */
  function setEnabled(names, on) { for (const n of [].concat(names)) FWM.setEnabled(n, on); return { ok: true }; }
  async function deleteRules(names) {
    names = [].concat(names);
    if (!names.length) return false;
    if (!(await ask(names.length === 1 ? 'Are you sure you want to delete this rule?' : `Are you sure you want to delete these ${names.length} rules?`))) return false;
    for (const n of names) FWM.removeRule(n);
    return true;
  }
  async function exportPolicy(opts = {}) {
    const path = await WS.ui.filePicker({ mode: 'save', title: 'Save As', path: 'C:\\Users\\Administrator\\Documents', defaultName: 'Policy.wfw', filters: [{ label: 'Policy Files (*.wfw)', ext: ['.wfw'] }], onCreate: opts.onPicker });
    if (!path) return null;
    try { WS.fs.writeFile(path, FWM.exportPolicy()); } catch (e) { await err(e.message); return null; }
    await WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'Policy successfully exported.' });
    return path;
  }
  async function importPolicy(opts = {}) {
    if (!(await ask('Importing a policy will overwrite all of the current Windows Defender Firewall with Advanced Security settings on this computer. Do you want to continue?'))) return null;
    const path = await WS.ui.filePicker({ mode: 'open', title: 'Open', path: 'C:\\Users\\Administrator\\Documents', filters: [{ label: 'Policy Files (*.wfw)', ext: ['.wfw'] }], onCreate: opts.onPicker });
    if (!path) return null;
    let r;
    try { r = FWM.importPolicy(WS.fs.readFile(path)); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r.ok) { await err(r); return null; }
    await WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'Policy successfully imported.' });
    return path;
  }
  async function restoreDefaults() {
    if (!(await ask('Restoring the default policy will remove all Windows Defender Firewall with Advanced Security settings that you have configured since Windows was installed. This may cause some applications to stop working.\n\nAre you sure you want to restore the default policy?'))) return false;
    FWM.restoreDefaults();
    return true;
  }

  /* ================================================================ address lists (Scope tab, wizard Scope page) */
  function addrList(key, value, o = {}) {
    const g = U.uid('scope');
    let items = value === 'Any' ? [] : String(value).split(',').filter(Boolean);
    const any = field(key + '-any', F.radio(g, `Any IP address`, value === 'Any', { disabled: o.disabled }));
    const these = field(key + '-these', F.radio(g, 'These IP addresses:', value !== 'Any', { disabled: o.disabled }));
    const box = field(key + '-list', h('select.inp.wf-addr', { size: 4 }));
    const add = field(key + '-add', F.button('Add...', async () => {
      const v = await WS.ui.inputBox({ title: 'IP Address', prompt: 'This IP address or subnet (for example 192.168.1.20, 192.168.1.0/24 or 192.168.1.100-192.168.1.150), or a predefined set such as LocalSubnet:',
        validate: x => (FWM.validAddr(x.trim()) && !/^any$/i.test(x.trim()) ? null : 'The IP address or subnet is not valid. Enter a valid IP address or subnet.') });
      if (v == null) return;
      if (!items.some(x => x.toLowerCase() === v.trim().toLowerCase())) items.push(v.trim());
      paint(); change();
    }));
    const remove = field(key + '-remove', F.button('Remove', () => { const i = box.selectedIndex; if (i < 0) return; items.splice(i, 1); paint(); change(); }));
    const change = () => { if (o.onChange) o.onChange(); };
    function paint() {
      U.clear(box);
      for (const x of items) box.appendChild(h('option', { value: x }, x));
      const on = these.checked && !o.disabled;
      box.disabled = !on; add.disabled = !on; remove.disabled = !on || box.selectedIndex < 0;
    }
    box.addEventListener('change', paint);
    [any, these].forEach(r => r.input.addEventListener('change', () => { paint(); change(); }));
    paint();
    return {
      el: h('div.wf-scope', any, these, h('div.wf-scoperow', box, h('div.wf-btncol', add, remove))),
      value: () => (any.checked || !items.length ? 'Any' : items.join(',')),
      add: v => { items.push(v); these.checked = true; paint(); change(); },
      valid: () => any.checked || items.length > 0
    };
  }

  /* ================================================================ New Rule Wizard */
  function newRule(direction, opts = {}) {
    const inbound = direction !== 'Outbound';
    const dir = inbound ? 'Inbound' : 'Outbound';
    const W = `New ${dir} Rule Wizard`, g = U.uid('nrw'), c = {};
    const groups = [...new Set(FWM.rules({ direction: dir }).map(r => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const data = { type: 'program', program: 'all', path: '', protocol: inbound ? 'TCP' : 'TCP', portsAll: false, ports: '', remoteAll: true, remotePorts: '', group: groups[0] || '',
      picked: null, local: 'Any', remote: 'Any', action: 'Allow', profiles: PROFILES.slice(), name: '', description: '' };
    const radio = (key, value, label, o = {}) => field(key + '-' + value, F.radio(g + key, label, data[key] === value, { disabled: o.disabled, onChange: v => { if (v) { data[key] = value; if (o.on) o.on(); } } }));
    const is = (...types) => () => !types.includes(data.type);
    const pages = [
      { id: 'type', title: 'Rule Type', subtitle: 'Select the type of firewall rule to create.',
        render: () => {
          c.group = field('group', F.select(groups, data.group, { width: 300, onChange: v => { data.group = v; data.picked = null; } }));
          const paint = () => { c.group.disabled = data.type !== 'predefined'; };
          const opt = (k, label, desc, extra) => h('div.wf-opt', radio('type', k, label, { on: paint }), extra || null, h('div.wf-optdesc', desc));
          setTimeout(paint, 0);
          return h('div.wf-wz', h('p.wf-p', 'What type of rule would you like to create?'),
            opt('program', 'Program', 'Rule that controls connections for a program.'),
            opt('port', 'Port', 'Rule that controls connections for a TCP or UDP port.'),
            opt('predefined', 'Predefined:', 'Rule that controls connections for a Windows experience.', h('div.wf-indent', c.group)),
            opt('custom', 'Custom', 'Custom rule.'));
        },
        validate: () => (data.type === 'predefined' && !data.group ? 'There are no predefined rule groups for this direction.' : null) },
      { id: 'program', title: 'Program', subtitle: 'Specify the full program path and executable name of the program that this rule matches.', skip: is('program', 'custom'),
        render: () => {
          c.path = field('path', F.text({ width: 300 }));
          const browse = field('browse', F.button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'open', title: 'Open', path: 'C:\\Program Files', filters: [{ label: 'Programs (*.exe)', ext: ['.exe'] }, { label: 'All Files (*.*)', ext: ['*'] }] }); if (p) { c.path.value = p; c.this.checked = true; data.program = 'this'; paint(); } }));
          c.all = radio('program', 'all', 'All programs', { on: () => paint() });
          c.this = radio('program', 'this', 'This program path:', { on: () => paint() });
          const paint = () => { c.path.disabled = browse.disabled = data.program !== 'this'; };
          paint();
          return h('div.wf-wz', h('p.wf-p', 'Does this rule apply to all programs or a specific program?'),
            c.all, h('div.wf-optdesc', 'Rule applies to all connections on the computer that match other rule properties.'),
            c.this, h('div.wf-indent.wf-line', c.path, browse), h('div.wf-indent.wf-note', 'Example: c:\\path\\program.exe\n%ProgramFiles%\\browser\\browser.exe'));
        },
        validate: () => {
          data.path = c.path.value.trim();
          if (data.program === 'this' && !data.path) return 'Specify the path to a program, or select All programs.';
          if (data.program === 'this' && !/\.exe$/i.test(data.path)) return 'The program path must be the full path to an executable (.exe) file.';
          return null;
        } },
      { id: 'ports', title: 'Protocol and Ports', subtitle: 'Specify the protocols and ports to which this rule applies.', skip: is('port', 'custom'), rerender: true,
        render: () => {
          const lw = { labelWidth: 120 };
          if (data.type === 'port') {
            c.ports = field('ports', F.text({ value: data.ports, width: 220 }));
            const paint = () => { c.ports.disabled = data.portsAll; };
            const all = field('ports-all', F.radio(g + 'pa', `All ${inbound ? 'local' : 'remote'} ports`, data.portsAll, { onChange: v => { if (v) { data.portsAll = true; paint(); } } }));
            const some = field('ports-some', F.radio(g + 'pa', `Specific ${inbound ? 'local' : 'remote'} ports:`, !data.portsAll, { onChange: v => { if (v) { data.portsAll = false; paint(); } } }));
            paint();
            return h('div.wf-wz', h('p.wf-p', 'Does this rule apply to TCP or UDP?'), h('div.wf-indent', radio('protocol', 'TCP', 'TCP'), radio('protocol', 'UDP', 'UDP')),
              h('p.wf-p', `Does this rule apply to all ${inbound ? 'local' : 'remote'} ports or specific ${inbound ? 'local' : 'remote'} ports?`),
              h('div.wf-indent', all, h('div.wf-line', some, c.ports), h('div.wf-note.wf-indent2', PORT_EXAMPLE)));
          }
          const PROTOS = ['Any', 'TCP', 'UDP', 'ICMPv4', 'ICMPv6'];
          const NUM = { Any: '', TCP: '6', UDP: '17', ICMPv4: '1', ICMPv6: '58' };
          if (!PROTOS.includes(data.protocol)) data.protocol = 'Any';
          c.proto = field('protocol', F.select(PROTOS, data.protocol, { width: 160 }));
          c.num = F.value(NUM[data.protocol]);
          c.lsel = field('localport-kind', F.select([{ value: 'all', label: 'All Ports' }, { value: 'some', label: 'Specific Ports' }], data.portsAll ? 'all' : data.ports ? 'some' : 'all', { width: 160 }));
          c.lports = field('localports', F.text({ value: data.ports, width: 200 }));
          c.rsel = field('remoteport-kind', F.select([{ value: 'all', label: 'All Ports' }, { value: 'some', label: 'Specific Ports' }], data.remotePorts ? 'some' : 'all', { width: 160 }));
          c.rports = field('remoteports', F.text({ value: data.remotePorts, width: 200 }));
          const paint = () => {
            const ports = ['TCP', 'UDP'].includes(c.proto.value);
            c.num.textContent = NUM[c.proto.value];
            c.lsel.disabled = c.rsel.disabled = !ports;
            c.lports.disabled = !ports || c.lsel.value !== 'some'; c.rports.disabled = !ports || c.rsel.value !== 'some';
          };
          [c.proto, c.lsel, c.rsel].forEach(x => x.addEventListener('change', paint));
          paint();
          return h('div.wf-wz', h('p.wf-p', 'To which ports and protocols does this rule apply?'),
            F.row('Protocol type:', c.proto, lw), F.row('Protocol number:', c.num, lw),
            F.row('Local port:', c.lsel, lw), h('div.wf-portbox', c.lports, h('div.wf-note', PORT_EXAMPLE)),
            F.row('Remote port:', c.rsel, lw), h('div.wf-portbox', c.rports, h('div.wf-note', PORT_EXAMPLE)),
            F.row('Internet Control Message Protocol (ICMP) settings:', F.button('Customize...', () => {}, { disabled: true }), { labelWidth: 290 }));
        },
        validate: () => {
          if (data.type === 'port') {
            data.ports = c.ports.value.trim();
            if (!data.portsAll && !data.ports) return 'Specify at least one port, or select All local ports.';
            if (!data.portsAll && !portsOk(data.ports)) return 'The port value is not valid. Specify a port number or a range of port numbers, such as 80 or 5000-5010.';
            return null;
          }
          data.protocol = c.proto.value;
          const ports = ['TCP', 'UDP'].includes(data.protocol);
          data.portsAll = !ports || c.lsel.value === 'all'; data.ports = data.portsAll ? '' : c.lports.value.trim();
          data.remoteAll = !ports || c.rsel.value === 'all'; data.remotePorts = data.remoteAll ? '' : c.rports.value.trim();
          for (const v of [data.portsAll ? null : data.ports, data.remoteAll ? null : data.remotePorts]) {
            if (v === '') return 'Specify at least one port, or select All Ports.';
            if (v != null && !portsOk(v)) return 'The port value is not valid. Specify a port number or a range of port numbers, such as 80 or 5000-5010.';
          }
          return null;
        } },
      { id: 'scope', title: 'Scope', subtitle: 'Specify the local and remote IP addresses to which this rule applies.', skip: is('custom'),
        render: () => {
          c.local = addrList('local', data.local); c.remote = addrList('remote', data.remote);
          return h('div.wf-wz', h('div.wf-sechead', 'Which local IP addresses does this rule apply to?'), c.local.el, h('div.wf-sechead', 'Which remote IP addresses does this rule apply to?'), c.remote.el);
        },
        validate: () => {
          if (!c.local.valid() || !c.remote.valid()) return 'Add at least one IP address, or select Any IP address.';
          data.local = c.local.value(); data.remote = c.remote.value(); return null;
        } },
      { id: 'predefined', title: 'Predefined Rules', subtitle: 'Select the rules to be created for this experience.', skip: is('predefined'), rerender: true,
        render: () => {
          const rows = FWM.rules({ direction: dir, group: data.group });
          if (!data.picked) data.picked = new Set(rows.map(r => r.name));
          const list = h('div.wf-predef', h('div.wf-prow.head', h('span'), h('span', 'Rule Exists'), h('span', 'Name'), h('span', 'Profile'), h('span', 'Description')),
            ...rows.map(r => {
              const cb = field('pre-' + r.name, h('input', { type: 'checkbox', checked: data.picked.has(r.name), onChange: () => { if (cb.checked) data.picked.add(r.name); else data.picked.delete(r.name); } }));
              return h('div.wf-prow', h('span', cb), h('span', 'Yes'), h('span', r.displayName), h('span', profText(r.profile)), h('span', r.description || ''));
            }));
          return h('div.wf-wz', h('p.wf-p', 'Which rules would you like to create?'),
            h('p.wf-note', 'The following rules define network connectivity requirements for the selected predefined group. Checked rules will be created. If a rule already exists and is checked, the contents of the existing rule will be overwritten.'), list);
        },
        validate: () => (data.picked && data.picked.size ? null : 'Select at least one rule to create.') },
      { id: 'action', title: 'Action', subtitle: 'Specify the action to be taken when a connection matches the conditions specified in the rule.',
        render: () => h('div.wf-wz', h('p.wf-p', 'What action should be taken when a connection matches the specified conditions?'),
          h('div.wf-opt', radio('action', 'Allow', 'Allow the connection'), h('div.wf-optdesc', 'This includes connections that are protected with IPsec as well as those are not.')),
          h('div.wf-opt', radio('action', 'Secure', 'Allow the connection if it is secure', { disabled: true }), h('div.wf-optdesc', 'This includes only connections that have been authenticated by using IPsec. Connections will be secured using the settings in IPsec properties and rules in the Connection Security Rule node.'), h('div.wf-indent', F.button('Customize...', () => {}, { disabled: true }))),
          h('div.wf-opt', radio('action', 'Block', 'Block the connection'))) },
      { id: 'profile', title: 'Profile', subtitle: 'Specify the profiles for which this rule applies.', skip: is('program', 'port', 'custom'),
        render: () => {
          const DESC = { Domain: 'Applies when a computer is connected to its corporate domain.', Private: 'Applies when a computer is connected to a private network location, such as a home or work place.', Public: 'Applies when a computer is connected to a public network location.' };
          c.prof = {};
          return h('div.wf-wz', h('p.wf-p', 'When does this rule apply?'), ...PROFILES.map(p => h('div.wf-opt', c.prof[p] = field('profile-' + p, F.checkbox(p, true)), h('div.wf-optdesc', DESC[p]))));
        },
        validate: () => { data.profiles = PROFILES.filter(p => c.prof[p].checked); return data.profiles.length ? null : 'You must select at least one profile for the rule.'; } },
      { id: 'name', title: 'Name', subtitle: 'Specify the name and description of this rule.', skip: is('program', 'port', 'custom'),
        render: () => {
          c.name = field('name', F.text({ width: 340 })); c.desc = field('description', F.textarea({ rows: 4, width: 340 }));
          return h('div.wf-wz', F.stack('Name:', c.name), F.stack('Description (optional):', c.desc));
        },
        validate: () => { data.name = c.name.value.trim(); data.description = c.desc.value; return data.name ? null : 'You must enter a name for the rule.'; } }
    ];
    let created = null;
    return WS.ui.wizard({ title: W, style: 'steps', icon: ICON.app, width: 700, height: 520, data, pages,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, data); },
      onFinish: () => {
        const action = data.action === 'Block' ? 'Block' : 'Allow';
        if (data.type === 'predefined') {
          for (const n of data.picked) { const r = FWM.setRule(n, { enabled: true, action }); if (!r.ok) return r; }
          created = [...data.picked];
          return true;
        }
        // a Port rule matches local ports inbound and remote ports outbound; a Custom rule sets both explicitly
        const spec = data.portsAll ? null : data.ports;
        const ports = data.type === 'custom' ? { localPort: spec, remotePort: data.remoteAll ? null : data.remotePorts }
          : data.type === 'port' ? (inbound ? { localPort: spec } : { remotePort: spec }) : {};
        const r = FWM.newRule({
          displayName: data.name, description: data.description, direction: dir, action, enabled: true, profile: data.profiles,
          protocol: data.type === 'program' ? 'Any' : data.protocol, ...ports,
          localAddress: data.local, remoteAddress: data.remote,
          program: (data.type === 'program' || data.type === 'custom') && data.program === 'this' ? data.path : 'Any'
        });
        if (!r.ok) return r;
        created = r.rule;
        return true;
      } }).then(res => (res.finished ? created : null));
  }

  /* ================================================================ rule Properties */
  function ruleProperties(name, opts = {}) {
    const r0 = rule(name);
    if (!r0) return Promise.resolve(false);
    const r = full(r0), pre = !!r0.builtin, g = U.uid('rp'), c = {};
    const lw = { labelWidth: 110 };
    const apply = props => { const res = FWM.setRule(r0.name, props); return res.ok ? null : res; };
    const tabs = [
      { label: 'General', render: () => {
        c.name = field('name', F.text({ value: r.displayName, readOnly: pre }));
        c.desc = field('description', F.textarea({ value: r.description, rows: 3, readOnly: pre }));
        c.enabled = field('enabled', F.checkbox('Enabled', r.enabled));
        c.allow = field('action-Allow', F.radio(g + 'a', 'Allow the connection', r.action === 'Allow'));
        c.secure = field('action-Secure', F.radio(g + 'a', 'Allow the connection if it is secure', false, { disabled: true }));
        c.block = field('action-Block', F.radio(g + 'a', 'Block the connection', r.action === 'Block'));
        return h('div', pre ? h('div.wf-banner', h('span', { html: WS.ui.icons.info }), h('span', 'This is a predefined rule and some of its properties cannot be modified.')) : null,
          F.group('General', F.row('Name:', c.name, lw), F.row('Description:', c.desc, lw), c.enabled),
          F.group('Action', c.allow, c.secure, h('div.wf-indent', F.button('Customize...', () => {}, { disabled: true })), c.block));
      },
      apply: () => apply({ ...(pre ? {} : { displayName: c.name.value, description: c.desc.value }), enabled: c.enabled.checked, action: c.block.checked ? 'Block' : 'Allow' }) },
      { label: 'Programs and Services', render: () => {
        const prog = r.program && r.program !== 'Any';
        c.progAll = field('program-all', F.radio(g + 'p', 'All programs that meet the specified conditions', !prog, { disabled: pre }));
        c.progThis = field('program-this', F.radio(g + 'p', 'This program:', prog, { disabled: pre }));
        c.path = field('program', F.text({ value: prog ? r.program : '', disabled: pre || !prog, width: 260 }));
        const paint = () => { c.path.disabled = pre || !c.progThis.checked; };
        [c.progAll, c.progThis].forEach(x => x.input.addEventListener('change', paint));
        return h('div', F.group('Programs', c.progAll, c.progThis, h('div.wf-indent.wf-line', c.path, F.button('Browse...', () => {}, { disabled: true }))),
          F.group('Application Packages', h('div.wf-tool', h('span', 'Specify application packages to which this rule applies.'), F.button('Settings...', () => {}, { disabled: true }))),
          F.group('Services', h('div.wf-tool', h('span', 'Specify services to which this rule applies.'), F.button('Settings...', () => {}, { disabled: true }))));
      },
      apply: () => {
        if (pre) return null;
        if (c.progThis.checked && !/\.exe$/i.test(c.path.value.trim())) return 'The program path must be the full path to an executable (.exe) file.';
        return apply({ program: c.progThis.checked ? c.path.value.trim() : 'Any' });
      } },
      { label: 'Remote Computers', render: () => h('div', F.group('Authorized computers', F.checkbox('Only allow connections from these computers:', false, { disabled: true })),
        F.group('Exceptions', F.checkbox('Skip this rule for connections from these computers:', false, { disabled: true })), F.note('Authorized computers apply only to connections secured with IPsec, which the lab does not model.')) },
      { label: 'Protocols and Ports', render: () => {
        const PROTOS = ['Any', 'TCP', 'UDP', 'ICMPv4', 'ICMPv6'];
        c.proto = field('protocol', F.select(PROTOS, r.protocol, { width: 150, disabled: pre }));
        const kind = v => (v === 'Any' ? 'all' : 'some');
        c.lkind = field('localport-kind', F.select([{ value: 'all', label: 'All Ports' }, { value: 'some', label: 'Specific Ports' }], kind(r.localPort), { width: 150, disabled: pre }));
        c.lports = field('localports', F.text({ value: r.localPort === 'Any' ? '' : r.localPort, width: 200, disabled: pre }));
        c.rkind = field('remoteport-kind', F.select([{ value: 'all', label: 'All Ports' }, { value: 'some', label: 'Specific Ports' }], kind(r.remotePort), { width: 150, disabled: pre }));
        c.rports = field('remoteports', F.text({ value: r.remotePort === 'Any' ? '' : r.remotePort, width: 200, disabled: pre }));
        const paint = () => {
          if (pre) return;
          const ports = ['TCP', 'UDP'].includes(c.proto.value);
          c.lkind.disabled = c.rkind.disabled = !ports;
          c.lports.disabled = !ports || c.lkind.value !== 'some'; c.rports.disabled = !ports || c.rkind.value !== 'some';
        };
        [c.proto, c.lkind, c.rkind].forEach(x => x.addEventListener('change', paint));
        paint();
        const lw2 = { labelWidth: 120 };
        return h('div', F.group('Protocols and ports', F.row('Protocol type:', c.proto, lw2),
          F.row('Local port:', c.lkind, lw2), h('div.wf-portbox', c.lports, h('div.wf-note', PORT_EXAMPLE)),
          F.row('Remote port:', c.rkind, lw2), h('div.wf-portbox', c.rports, h('div.wf-note', PORT_EXAMPLE)),
          F.row('Internet Control Message Protocol (ICMP) settings:', F.button('Customize...', () => {}, { disabled: true }), { labelWidth: 280 })));
      },
      apply: () => {
        if (pre) return null;
        const ports = ['TCP', 'UDP'].includes(c.proto.value);
        const lp = ports && c.lkind.value === 'some' ? c.lports.value.trim() : 'Any', rp = ports && c.rkind.value === 'some' ? c.rports.value.trim() : 'Any';
        if (lp === '' || rp === '') return 'Specify at least one port, or select All Ports.';
        return apply({ protocol: c.proto.value, localPort: lp, remotePort: rp });
      } },
      { label: 'Scope', render: sh => {
        c.local = addrList('local', r.localAddress, { onChange: () => sh.setDirty() });
        c.remote = addrList('remote', r.remoteAddress, { onChange: () => sh.setDirty() });
        return h('div', F.group('Local IP address', c.local.el), F.group('Remote IP address', c.remote.el));
      },
      apply: () => (!c.local.valid() || !c.remote.valid() ? 'Add at least one IP address, or select Any IP address.' : apply({ localAddress: c.local.value(), remoteAddress: c.remote.value() })) },
      { label: 'Advanced', render: () => {
        const has = p => r.profile === 'Any' || r.profile.split(/,\s*/).includes(p);
        c.prof = Object.fromEntries(PROFILES.map(p => [p, field('profile-' + p, F.checkbox(p, has(p)))]));
        const EDGE = [['Block', 'Block edge traversal'], ['Allow', 'Allow edge traversal'], ['DeferToUser', 'Defer to user'], ['DeferToApp', 'Defer to application']];
        c.edge = field('edge', F.select(EDGE.map(([value, label]) => ({ value, label })), r.edgeTraversal, { width: 200, disabled: r.direction === 'Outbound' }));
        return h('div', F.group('Profiles', h('div.wf-line', ...PROFILES.map(p => c.prof[p]))),
          F.group('Interface types', h('div.wf-tool', h('span', 'Specify the interface types to which this rule applies.'), F.button('Customize...', () => {}, { disabled: true }))),
          F.group('Edge traversal', h('div.wf-note', 'Edge traversal allows the computer to accept unsolicited inbound packets that have passed through an edge device such as a Network Address Translation (NAT) router or firewall.'), c.edge));
      },
      apply: () => {
        const ps = PROFILES.filter(p => c.prof[p].checked);
        if (!ps.length) return 'You must select at least one profile for the rule.';
        return apply({ profile: ps, ...(r.direction === 'Inbound' ? { edgeTraversal: c.edge.value } : {}) });
      } },
      { label: 'Local Principals', render: () => h('div', F.group('Authorized users', F.checkbox('Only allow connections from these users:', false, { disabled: true })), F.note('User-based rules need IPsec authentication, which the lab does not model.')) },
      { label: 'Remote Users', render: () => h('div', F.group('Authorized users', F.checkbox('Only allow connections from these users:', false, { disabled: true })), F.note('User-based rules need IPsec authentication, which the lab does not model.')) }
    ];
    return WS.ui.propertySheet({ title: `${r.displayName} Properties`, width: 470, errorTitle: TITLE, tabs, initialTab: opts.tab ? Math.max(0, tabs.findIndex(t => t.label === opts.tab)) : 0, onCreate: opts.onCreate });
  }

  /* ================================================================ firewall Properties (the profiles) */
  function firewallProperties(opts = {}) {
    const draft = Object.fromEntries(PROFILES.map(p => [p, { ...FWM.profile(p) }]));
    const ipg = U.uid('ips');
    const DESC = { Domain: 'Specify behavior for when a computer is connected to its corporate domain.', Private: 'Specify behavior for when a computer is connected to a private network location.', Public: 'Specify behavior for when a computer is connected to a public network location.' };
    const tab = p => ({ label: `${p} Profile`, render: sh => {
      const d = draft[p];
      const state = field(`${p}-state`, F.select([{ value: 'on', label: 'On (recommended)' }, { value: 'off', label: 'Off' }], d.enabled ? 'on' : 'off', { width: 170 }));
      const inb = field(`${p}-inbound`, F.select([{ value: 'Block', label: 'Block (default)' }, { value: 'BlockAll', label: 'Block all connections' }, { value: 'Allow', label: 'Allow' }], d.blockAll ? 'BlockAll' : d.inbound, { width: 170 }));
      const outb = field(`${p}-outbound`, F.select([{ value: 'Allow', label: 'Allow (default)' }, { value: 'Block', label: 'Block' }], d.outbound, { width: 170 }));
      const paint = () => { inb.disabled = outb.disabled = state.value === 'off'; };
      state.addEventListener('change', paint); paint();
      const read = () => { d.enabled = state.value === 'on'; d.blockAll = inb.value === 'BlockAll'; d.inbound = inb.value === 'Allow' ? 'Allow' : 'Block'; d.outbound = outb.value; };
      [state, inb, outb].forEach(x => x.addEventListener('change', read));
      const lw = { labelWidth: 140 };
      return h('div', h('p.wf-p', DESC[p]),
        F.group('State', F.row('Firewall state:', state, lw), h('div.wf-indent', F.row('Inbound connections:', inb, lw), F.row('Outbound connections:', outb, lw)),
          F.row('Protected network connections:', F.button('Customize...', () => {}, { disabled: true }), { labelWidth: 200 })),
        F.group('Settings', h('div.wf-tool', h('span', 'Specify settings that control Windows Defender Firewall behavior.'), field(`${p}-settings`, F.button('Customize...', () => settingsDialog(p, d, sh, opts))))),
        F.group('Logging', h('div.wf-tool', h('span', 'Specify logging settings for troubleshooting.'), field(`${p}-logging`, F.button('Customize...', () => loggingDialog(p, d, sh, opts))))));
    },
    apply: () => {
      const d = draft[p];
      return FWM.setProfile(p, { enabled: d.enabled, inbound: d.inbound, blockAll: d.blockAll, outbound: d.outbound, notify: d.notify, logDropped: d.logDropped, logAllowed: d.logAllowed, logFile: d.logFile, logMaxKB: d.logMaxKB });
    } });
    return WS.ui.propertySheet({ title: `${ROOT} Properties`, width: 460, errorTitle: TITLE, onCreate: opts.onCreate,
      initialTab: opts.profile ? PROFILES.indexOf(opts.profile) : Math.max(0, PROFILES.indexOf(FWM.activeProfile())),
      tabs: [...PROFILES.map(tab), { label: 'IPsec Settings', render: () => h('div',
        F.group('IPsec defaults', h('div.wf-tool', h('span', 'Specify settings used by IPsec to establish secured connections.'), F.button('Customize...', () => {}, { disabled: true }))),
        F.group('IPsec exemptions', h('div', 'Exempting ICMP from all IPsec rules can simplify troubleshooting of network connectivity issues.'), F.row('Exempt ICMP from IPsec:', F.select(['No (default)', 'Yes'], 'No (default)', { disabled: true }), { labelWidth: 160 })),
        F.group('IPsec tunnel authorization', F.radio(ipg, 'None', true, { disabled: true }), F.radio(ipg, 'Advanced', false, { disabled: true }))) }] });
  }
  function settingsDialog(p, d, sh, opts) {
    const notify = field('notify', F.select([{ value: 'no', label: 'No (default)' }, { value: 'yes', label: 'Yes' }], d.notify ? 'yes' : 'no', { width: 140 }));
    const content = h('div.w32.wf-form', h('p.wf-p', `Specify settings for the ${p} Profile.`),
      F.group('Firewall settings', h('div', 'Display notifications to the user when a program is blocked from receiving inbound connections.'), F.row('Display a notification:', notify, { labelWidth: 150 })),
      F.group('Unicast response', h('div', 'Allow unicast response to multicast or broadcast network traffic.'), F.row('Allow unicast response:', F.select(['Yes (default)'], 'Yes (default)', { disabled: true }), { labelWidth: 150 })),
      F.group('Rule merging', h('div', 'Merging of rules created by local administrators with rules distributed through Group Policy. These settings can only be modified through Group Policy.'),
        F.row('Apply local firewall rules:', F.value('Yes'), { labelWidth: 220 }), F.row('Apply local connection security rules:', F.value('Yes'), { labelWidth: 220 })));
    return WS.ui.dialog({ title: `Customize Settings for the ${p} Profile`, width: 440, content, onCreate: opts.onSettings, buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true }] })
      .then(a => { if (a === 'ok' && d.notify !== (notify.value === 'yes')) { d.notify = notify.value === 'yes'; sh.setDirty(); } });
  }
  function loggingDialog(p, d, sh, opts) {
    const name = field('logfile', F.text({ value: d.logFile, width: 270 }));
    const size = field('logsize', F.number({ value: d.logMaxKB, min: 1, max: 32767, width: 90 }));
    const drop = field('logdropped', F.select([{ value: 'no', label: 'No (default)' }, { value: 'yes', label: 'Yes' }], d.logDropped ? 'yes' : 'no', { width: 140 }));
    const ok = field('logallowed', F.select([{ value: 'no', label: 'No (default)' }, { value: 'yes', label: 'Yes' }], d.logAllowed ? 'yes' : 'no', { width: 140 }));
    const browse = F.button('Browse...', async () => { const f = await WS.ui.filePicker({ mode: 'save', title: 'Save As', path: 'C:\\Windows\\System32\\LogFiles\\Firewall', defaultName: 'pfirewall.log', filters: [{ label: 'Log Files (*.log)', ext: ['.log'] }] }); if (f) name.value = f; });
    const lw = { labelWidth: 170 };
    const content = h('div.w32.wf-form', F.group('Name', h('div.wf-line', name, browse)),
      F.group('Size limit (KB)', size),
      F.row('Log dropped packets:', drop, lw), F.row('Log successful connections:', ok, lw),
      h('p.wf-note', 'If you are configuring the log file name on Group Policy object, ensure that the Windows Defender Firewall service account has write permissions to the folder containing the log file.'),
      h('p.wf-note', 'Default path for the log file is %windir%\\system32\\logfiles\\firewall\\pfirewall.log.'));
    const frame = WS.ui.modal({ title: `Customize Logging Settings for the ${p} Profile`, width: 450, className: 'w32-dlg wf-dlg', closeValue: null });
    frame.body.appendChild(content);
    const okBtn = h('button.btn.primary', { onClick: async () => {
      const kb = +size.value;
      if (!(Number.isInteger(kb) && kb >= 1 && kb <= 32767)) { await err('The log file size limit must be between 1 and 32767 KB.'); return; }
      if (!name.value.trim()) { await err('Specify a name for the log file.'); return; }
      Object.assign(d, { logFile: name.value.trim(), logMaxKB: kb, logDropped: drop.value === 'yes', logAllowed: ok.value === 'yes' });
      sh.setDirty();
      frame.close(true);
    } }, 'OK');
    frame.footer.append(okBtn, h('button.btn', { onClick: () => frame.close(null) }, 'Cancel'));
    frame.onEnter = () => okBtn.click(); frame.onEscape = () => frame.close(null);
    if (opts.onLogging) opts.onLogging(frame);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }

  /* ================================================================ console */
  function profileBlock(p, active) {
    const d = FWM.profile(p);
    const line = (icon, text) => h('div.wf-sline', h('span.wf-sic', { html: icon }), h('span', text));
    return h('div.wf-prof',
      h('div.wf-ptitle', h('span.wf-pic', { html: d.enabled ? ICON.ok : ICON.off }), `${p} Profile${active ? ' is Active' : ''}`),
      d.enabled ? h('div.wf-plines',
        line(ICON.allow, 'Windows Defender Firewall is on.'),
        line(d.inbound === 'Allow' && !d.blockAll ? ICON.allow : ICON.block, d.blockAll ? 'All inbound connections are blocked, including those that match a rule.' : d.inbound === 'Allow' ? 'Inbound connections that do not match a rule are allowed.' : 'Inbound connections that do not match a rule are blocked.'),
        line(d.outbound === 'Block' ? ICON.block : ICON.allow, d.outbound === 'Block' ? 'Outbound connections that do not match a rule are blocked.' : 'Outbound connections that do not match a rule are allowed.'))
        : h('div.wf-plines', line(ICON.block, 'Windows Defender Firewall is off.')));
  }
  function launch(opts = {}) {
    const ctl = { filters: { Inbound: {}, Outbound: {} } };
    let mmc;
    const section = (title, ...body) => h('div.wf-sec', h('div.wf-sech', title), h('div.wf-secb', ...body));
    const page = paint => ({ render: host => { const draw = () => { U.clear(host); host.appendChild(h('div.wf-page.w32', ...paint())); }; draw(); return { refresh: draw }; } });
    const go = id => ctl.open(id);
    const rootPage = page(() => [
      h('div.wf-title', h('span', { html: ICON.app }), ROOT),
      h('p', 'Windows Defender Firewall with Advanced Security provides network security for Windows computers.'),
      section('Overview', ...PROFILES.map(p => profileBlock(p, FWM.activeProfile() === p)), h('div.wf-links', F.link('Windows Defender Firewall Properties', () => firewallProperties()))),
      section('Getting Started',
        h('div.wf-gs', h('b', 'Authenticate communications between computers'), h('p', 'Create connection security rules to specify how and when connections between computers are authenticated and protected by using Internet Protocol security (IPsec).'), F.link('Connection Security Rules', () => go('wf-consec'))),
        h('div.wf-gs', h('b', 'View and create firewall rules'), h('p', 'Create firewall rules to allow or block connections to specified programs or ports. You can also allow a connection only if it is authenticated, or if it comes from an authorized user, group, or computer. By default, inbound connections are blocked unless they match a rule that allows them, and outbound connections are allowed unless they match a rule that blocks them.'),
          h('div.wf-links', F.link('Inbound Rules', () => go('wf-in')), F.link('Outbound Rules', () => go('wf-out')))),
        h('div.wf-gs', h('b', 'View current firewall and IPsec policy and activity'), h('p', 'View information about currently applied firewall and connection security rules and security associations for active network connections.'), F.link('Monitoring', () => go('wf-mon'))))
    ]);
    const monPage = page(() => {
      const p = FWM.activeProfile(), d = FWM.profile(p);
      const row = (k, v) => h('div.wf-kv', h('span', k), h('span', v));
      return [h('div.wf-title', h('span', { html: ICON.monitor }), 'Monitoring'),
        section('Firewall State', profileBlock(p, true)),
        section('General Settings', row('Display a notification when a program is blocked:', d.notify ? 'Yes' : 'No'), row('Apply local firewall rules:', 'Yes'), row('Apply local connection security rules:', 'Yes')),
        section('Logging Settings', row('File name:', d.logFile), row('File maximum size (KB):', String(d.logMaxKB)), row('Log dropped packets:', d.logDropped ? 'Yes' : 'No'), row('Log successful connections:', d.logAllowed ? 'Yes' : 'No')),
        h('div.wf-links', F.link('View active firewall rules', () => go('wf-mon-fw')), F.link('View active connection security rules', () => go('wf-mon-consec')), F.link('View security associations', () => go('wf-mon-sa')))];
    });
    const COLS = [
      { key: 'displayName', label: 'Name', width: 300 }, { key: 'group', label: 'Group', width: 190 }, { key: 'profile', label: 'Profile', width: 90, value: r => profText(r.profile) },
      { key: 'enabled', label: 'Enabled', width: 60, value: r => (r.enabled ? 'Yes' : 'No') }, { key: 'action', label: 'Action', width: 60 }, { key: 'override', label: 'Override', width: 60, value: () => 'No' },
      { key: 'program', label: 'Program', width: 110, value: r => full(r).program }, { key: 'localAddress', label: 'Local Address', width: 100, value: r => full(r).localAddress },
      { key: 'remoteAddress', label: 'Remote Address', width: 110, value: r => full(r).remoteAddress }, { key: 'protocol', label: 'Protocol', width: 70 },
      { key: 'localPort', label: 'Local Port', width: 80 }, { key: 'remotePort', label: 'Remote Port', width: 80, value: r => full(r).remotePort },
      { key: 'users', label: 'Authorized Users', width: 110, value: () => 'Any' }, { key: 'computers', label: 'Authorized Computers', width: 130, value: () => 'Any' }
    ];
    const applies = (r, p) => r.profile === 'Any' || r.profile.split(/,\s*/).includes(p);
    function filtered(dir) {
      const f = ctl.filters[dir];
      return FWM.rules({ direction: dir }).filter(r => (!f.profile || applies(r, f.profile)) && (!f.state || r.enabled === (f.state === 'enabled')) && (!f.group || r.group === f.group));
    }
    const filterMenu = dir => {
      const f = ctl.filters[dir], set = (k, v) => ctl.setFilter(dir, { ...f, [k]: v });
      const groups = [...new Set(FWM.rules({ direction: dir }).map(r => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return [
        f.profile || f.state || f.group ? { label: 'Clear All &Filters', action: () => ctl.clearFilters(dir) } : null,
        { label: 'Filter by &Profile', items: () => [...PROFILES.map(p => ({ label: `Filter by ${p} Profile`, radio: true, checked: f.profile === p, action: () => set('profile', p) })), SEP, { label: 'All Profiles', radio: true, checked: !f.profile, action: () => set('profile', null) }] },
        { label: 'Filter by &State', items: () => [{ label: 'Filter by Enabled', radio: true, checked: f.state === 'enabled', action: () => set('state', 'enabled') }, { label: 'Filter by Disabled', radio: true, checked: f.state === 'disabled', action: () => set('state', 'disabled') }, SEP, { label: 'All States', radio: true, checked: !f.state, action: () => set('state', null) }] },
        { label: 'Filter by &Group', items: () => [...groups.map(gr => ({ label: `Filter by ${gr}`, radio: true, checked: f.group === gr, action: () => set('group', gr) })), SEP, { label: 'All Groups', radio: true, checked: !f.group, action: () => set('group', null) }] }
      ];
    };
    const rulesView = dir => ({
      columns: COLS, rows: () => filtered(dir), getId: r => r.name, icon: ruleIcon, sortKey: 'displayName', multi: true, itemLabel: r => r.displayName,
      header: () => { const f = ctl.filters[dir], parts = [f.profile && `${f.profile} profile`, f.state && (f.state === 'enabled' ? 'Enabled' : 'Disabled'), f.group].filter(Boolean); return parts.length ? `Filtered by: ${parts.join(', ')}` : ''; },
      menu: rows => {
        if (!rows.length) return nodeMenu(dir);
        const allOn = rows.every(r => r.enabled), allOff = rows.every(r => !r.enabled);
        return [
          !allOn ? { label: '&Enable Rule', action: () => setEnabled(rows.map(r => r.name), true) } : null,
          !allOff ? { label: 'Disa&ble Rule', action: () => setEnabled(rows.map(r => r.name), false) } : null,
          SEP, { label: 'Cu&t', disabled: true }, { label: '&Copy', disabled: true }, { label: '&Delete', action: () => deleteRules(rows.map(r => r.name)) }
        ];
      },
      properties: r => ruleProperties(r.name), delete: rows => deleteRules(rows.map(r => r.name)),
      toolbar: [
        { icon: I.newItem, title: 'New Rule...', action: () => newRule(dir) },
        { icon: I.enable, title: 'Enable Rule', action: rows => setEnabled(rows.map(r => r.name), true), enabled: rows => rows.some(r => !r.enabled) },
        { icon: I.disable, title: 'Disable Rule', action: rows => setEnabled(rows.map(r => r.name), false), enabled: rows => rows.some(r => r.enabled) },
        { icon: I.delete, title: 'Delete', action: rows => deleteRules(rows.map(r => r.name)), enabled: rows => rows.length > 0 }
      ]
    });
    const nodeMenu = dir => [{ label: '&New Rule...', action: () => ctl.newRule(dir) }, SEP, ...filterMenu(dir)];
    const empty = cols => ({ columns: cols.map(([label, width]) => ({ key: label, label, width })), rows: () => [], getId: r => r.id, multi: false, emptyText: 'There are no items to show in this view.' });
    const activeRules = () => FWM.rules({ enabled: true }).filter(r => applies(r, FWM.activeProfile()));
    const nodes = () => [{
      id: 'wf-root', label: ROOT, icon: ICON.app, expanded: true, view: rootPage, actionsPane: 'full', properties: () => firewallProperties(),
      menu: () => [{ label: '&Import Policy...', action: () => importPolicy() }, { label: 'E&xport Policy...', action: () => exportPolicy() }, { label: '&Restore Default Policy', action: () => restoreDefaults() }, { label: 'Diagnose / Re&pair', disabled: true }],
      children: () => [
        { id: 'wf-in', label: 'Inbound Rules', icon: ICON.inbound, view: rulesView('Inbound'), actionsPane: 'full', menu: () => nodeMenu('Inbound') },
        { id: 'wf-out', label: 'Outbound Rules', icon: ICON.outbound, view: rulesView('Outbound'), actionsPane: 'full', menu: () => nodeMenu('Outbound') },
        { id: 'wf-consec', label: 'Connection Security Rules', icon: ICON.consec, actionsPane: 'full', menu: () => [{ label: '&New Rule...', action: () => WS.apps.notImplemented('New Connection Security Rule Wizard') }],
          view: empty([['Name', 220], ['Enabled', 70], ['Endpoint 1', 120], ['Endpoint 2', 120], ['Authentication mode', 150], ['Authentication method', 150], ['Group', 150]]) },
        { id: 'wf-mon', label: 'Monitoring', icon: ICON.monitor, view: monPage, actionsPane: 'full', children: () => [
          { id: 'wf-mon-fw', label: 'Firewall', icon: ICON.app, actionsPane: 'full',
            view: { columns: [{ key: 'displayName', label: 'Name', width: 300 }, { key: 'direction', label: 'Direction', width: 70 }, ...COLS.slice(2).filter(x => !['enabled', 'users', 'computers'].includes(x.key))],
              rows: activeRules, getId: r => r.name, icon: ruleIcon, sortKey: 'displayName', multi: true, properties: r => ruleProperties(r.name), itemLabel: r => r.displayName } },
          { id: 'wf-mon-consec', label: 'Connection Security Rules', icon: ICON.consec, actionsPane: 'full', view: empty([['Name', 220], ['Endpoint 1', 120], ['Endpoint 2', 120], ['Authentication mode', 150]]) },
          { id: 'wf-mon-sa', label: 'Security Associations', icon: ICON.sa, actionsPane: 'full', view: empty([['Name', 200]]), children: () => [
            { id: 'wf-mon-mm', label: 'Main Mode', icon: ICON.sa, actionsPane: 'full', view: empty([['Local Address', 120], ['Remote Address', 120], ['1st Authentication Method', 170], ['1st Authentication Local ID', 170], ['Encryption', 90], ['Integrity', 90]]) },
            { id: 'wf-mon-qm', label: 'Quick Mode', icon: ICON.sa, actionsPane: 'full', view: empty([['Local Address', 120], ['Remote Address', 120], ['Local Port', 80], ['Remote Port', 80], ['Protocol', 70], ['AH Integrity', 90], ['ESP Integrity', 90], ['ESP Confidentiality', 120]]) }] }] }
      ]
    }];
    const PATHS = { 'wf-root': ['wf-root'], 'wf-in': ['wf-root', 'wf-in'], 'wf-out': ['wf-root', 'wf-out'], 'wf-consec': ['wf-root', 'wf-consec'], 'wf-mon': ['wf-root', 'wf-mon'],
      'wf-mon-fw': ['wf-root', 'wf-mon', 'wf-mon-fw'], 'wf-mon-consec': ['wf-root', 'wf-mon', 'wf-mon-consec'], 'wf-mon-sa': ['wf-root', 'wf-mon', 'wf-mon-sa'],
      'wf-mon-mm': ['wf-root', 'wf-mon', 'wf-mon-sa', 'wf-mon-mm'], 'wf-mon-qm': ['wf-root', 'wf-mon', 'wf-mon-sa', 'wf-mon-qm'] };
    Object.assign(ctl, {
      open(id) { const p = PATHS[id]; if (!p) return false; mmc.selectPath(p); return true; },
      filter: dir => ({ ...ctl.filters[dir] }),
      setFilter(dir, f) { ctl.filters[dir] = { profile: f.profile || null, state: f.state || null, group: f.group || null }; mmc.refresh(); },
      clearFilters(dir) { ctl.filters[dir] = {}; mmc.refresh(); },
      async newRule(dir, o = {}) {
        const r = await newRule(dir, o);
        if (r && !Array.isArray(r) && mmc.list && mmc.current().id === (dir === 'Outbound' ? 'wf-out' : 'wf-in')) { mmc.refresh(); if (mmc.list.rows().some(x => x.name === r.name)) mmc.list.select([r.name]); }
        return r;
      }
    });
    mmc = WS.mmc.create({ app: 'wf', title: TITLE, icon: ICON.app, width: 1240, height: 720, actionsPane: 'full', treeWidth: 300, nodes, topics: ['firewall', 'system', 'features', 'network'] });
    ctl.mmc = mmc;
    mmc.win.wf = ctl;
    if (opts.select) ctl.open(opts.select);
    return mmc.win;
  }

  WS.wf = { launch, newRule, ruleProperties, firewallProperties, setEnabled, deleteRules, exportPolicy, importPolicy, restoreDefaults, ICON };
  WS.apps.register({ id: 'wf', name: TITLE, icon: ICON.app, launch, keywords: ['wf.msc', 'firewall', 'advanced security', 'windows defender firewall'] });
})();
