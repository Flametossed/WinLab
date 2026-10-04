/* Add Roles and Features Wizard / Remove Roles and Features Wizard (Server Manager > Manage).
 * Both run on WS.ui.wizard (server style, own window) and install through WS.features, so the result is the
 * same as Install-WindowsFeature / Uninstall-WindowsFeature: services start, firewall rules appear, post-deployment
 * tasks show up on the notifications flag.
 * WS.sm.addRoles(opts) / WS.sm.removeRoles(opts); opts.onCreate(w) hands tests the live wizard. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons, F = () => WS.ui.f;
  const C = WS.catalog.features;

  const PERMANENT = new Set(['FileAndStorage-Services', 'Storage-Services']);
  const SHARED_TOOLS = new Set(['RSAT', 'RSAT-Role-Tools', 'RSAT-AD-Tools', 'RSAT-Feature-Tools']);
  const ORDER = new Map(C.all().map((f, i) => [f.id, i]));
  const byOrder = (a, b) => ORDER.get(a) - ORDER.get(b);
  const inst = id => WS.features.isInstalled(id) || WS.features.installState(id) === 'InstallPending';
  const ancestors = n => { const out = []; let p = n.parent && C.get(n.parent); while (p) { out.push(p); p = p.parent && C.get(p.parent); } return out; };
  const descendants = n => n.children.flatMap(c => [c, ...descendants(c)]);

  /** Role introduction pages (text as the real wizard shows it). Other roles get their catalog description. */
  const ROLE_PAGES = {
    'AD-Domain-Services': { nav: 'AD DS', title: 'Active Directory Domain Services',
      text: 'Active Directory Domain Services (AD DS) stores information about users, computers, and other devices on the network. AD DS helps administrators securely manage this information and facilitates resource sharing and collaboration between users.',
      notes: ['To help ensure that users can still log on to the network in the case of a server outage, install a minimum of two domain controllers for a domain.',
        'AD DS requires a DNS server to be installed on the network. If you do not have a DNS server installed, you will be prompted to install the DNS Server role on this machine.',
        'Microsoft Entra ID, a separate online service, can provide simplified identity and access management, security reporting, single sign-on to cloud and on-premises web apps.'] },
    DNS: { nav: 'DNS Server', title: 'DNS Server',
      text: 'Domain Name System (DNS) provides a standard method for associating names with numeric Internet addresses. This makes it possible for users to refer to network computers by using easy-to-remember names instead of a long series of numbers. In addition, DNS provides a hierarchical namespace, ensuring that each host name will be unique across a local or wide-area network. Windows DNS services can be integrated with Dynamic Host Configuration Protocol (DHCP) services on Windows, eliminating the need to add DNS records as computers are added to the network.',
      notes: ['Integrating DNS server with Active Directory Domain Services automatically replicates DNS data along with other Active Directory directory service data, making it easier to manage DNS.',
        'Active Directory Domain Services requires a DNS server to be installed on the network. If you are installing a domain controller, you can also install the DNS Server role using Active Directory Domain Services Installation Wizard by selecting the Active Directory Domain Services role.'] },
    DHCP: { nav: 'DHCP Server', title: 'DHCP Server',
      text: 'Dynamic Host Configuration Protocol allows servers to assign, or lease, IP addresses to computers and other devices that are enabled as DHCP clients. Deploying a DHCP server on the network provides computers and other TCP/IP-based network devices with valid IP addresses and the additional configuration parameters these devices need, called DHCP options. This allows computers and devices to connect to other network resources, such as DNS servers, WINS servers, and routers.',
      notes: ['You should configure at least one static IP address on this computer.', 'Before you install DHCP Server, you should plan your subnets, scopes, and exclusions. Store the plan in a safe place for later reference.'] },
    'Web-Server': { nav: 'Web Server Role (IIS)', title: 'Web Server Role (IIS)',
      text: 'Web servers are computers that let you share information over the Internet, or through intranets and extranets. The Web Server role includes Internet Information Services (IIS) 10.0 with enhanced security, simplified management, and a unified Web platform that integrates IIS, ASP.NET, and Windows Communication Foundation.',
      notes: ['The default installation for the Web Server (IIS) role includes the installation of role services that enable you to serve static content, make minor customizations (such as default documents and HTTP errors), monitor and log server activity, and configure static content compression.'] },
    'Hyper-V': { nav: 'Hyper-V', title: 'Hyper-V',
      text: 'Hyper-V allows you to virtualize server workloads by running those workloads on virtual machines. You can use virtual machines to consolidate multiple workloads on one physical server, to improve server availability, and to increase the efficiency in developing and testing software.',
      notes: ['Before you install this role, you should identify which network connections on this server you want to use for setting up virtual switches.', 'After you install Hyper-V, you can use Hyper-V Manager to create and configure your virtual machines.'] }
  };
  const POST_NOTE = {
    'AD-Domain-Services': ['Additional steps are required to make this machine a domain controller.', 'Promote this server to a domain controller', () => WS.sm.addsConfig()],
    DHCP: ['Additional steps are required to complete DHCP configuration.', 'Complete DHCP configuration', () => WS.sm.dhcpConfig()]
  };

  const BEFORE = {
    add: ['This wizard helps you install roles, role services, or features. You determine which roles, role services, or features to install based on the computing needs of your organization, such as sharing documents, or hosting a website.',
      'To remove roles, role services, or features:', 'Start the Remove Roles and Features Wizard'],
    remove: ['This wizard helps you remove roles, role services, or features. You determine which roles, role services, or features to remove based on the computing needs of your organization, such as sharing documents, or hosting a website.',
      'To add roles, role services, or features:', 'Start the Add Roles and Features Wizard']
  };

  /* ---------------------------------------------------------------- checkbox feature tree */
  function featureTree(roots, m) {
    const el = h('div.ftree', { tabIndex: 0 });
    const expanded = new Set(m.expanded || []);
    let focusId = null;
    function render() {
      const top = el.scrollTop;
      U.clear(el);
      const walk = (nodes, depth) => {
        for (const n of nodes) {
          const open = expanded.has(n.id);
          const box = h('input', { type: 'checkbox', checked: m.checked(n), disabled: m.disabled(n) });
          box.indeterminate = m.indeterminate(n);
          box.addEventListener('click', async e => { e.preventDefault(); if (box.disabled) return; focus(n); await m.toggle(n, !m.checked(n)); render(); });
          const row = h('div.ft-row' + (n.id === focusId ? '.focus' : '') + (m.disabled(n) ? '.dis' : ''), { style: { paddingLeft: (4 + depth * 18) + 'px' }, dataset: { id: n.id } },
            h('span.ft-exp', { html: n.children.length ? (open ? I.chevronDown : I.chevronRight) : '' }), box, h('span', m.label(n)));
          row.querySelector('.ft-exp').addEventListener('click', () => { if (open) expanded.delete(n.id); else expanded.add(n.id); render(); });
          row.addEventListener('click', e => { if (!e.target.closest('input, .ft-exp')) focus(n); });
          el.appendChild(row);
          if (open && n.children.length) walk(n.children, depth + 1);
        }
      };
      walk(roots, 0);
      el.scrollTop = top;
    }
    function focus(n) {
      focusId = n.id;
      el.querySelectorAll('.ft-row.focus').forEach(r => r.classList.remove('focus'));
      const r = el.querySelector(`.ft-row[data-id="${CSS.escape(n.id)}"]`);
      if (r) r.classList.add('focus');
      if (m.onFocus) m.onFocus(n);
    }
    render();
    return { el, refresh: render, expand: id => { expanded.add(id); render(); } };
  }
  function installedCount(n) {
    const d = descendants(n);
    return { total: d.length, done: d.filter(x => inst(x.id)).length };
  }

  /* ---------------------------------------------------------------- dialogs */
  /** "Add features that are required for <role>?" -> { includeMgmt } or null (Cancel). */
  async function requiredDialog(node, required, mgmt) {
    const listEl = h('div.wz-list', { style: 'min-height:150px;max-height:220px' });
    const include = F().checkbox('Include management tools (if applicable)', true);
    const paint = () => {
      U.clear(listEl);
      const ids = new Set([...required, ...(include.checked ? mgmt : [])]);
      // show each item with its (not necessarily selected) ancestors for context, as the real list does
      const shown = new Set();
      for (const id of ids) { shown.add(id); ancestors(C.get(id)).forEach(a => shown.add(a.id)); }
      for (const id of [...shown].sort(byOrder)) {
        const n = C.get(id);
        const tool = mgmt.includes(id) && !n.children.length;
        listEl.appendChild(h('div.wz-li', { style: { paddingLeft: (n.depth * 16) + 'px', color: ids.has(id) ? '' : '#555' } }, (tool ? '[Tools] ' : '') + n.name));
      }
    };
    include.input.addEventListener('change', paint);
    paint();
    const r = await WS.ui.dialog({ title: 'Add Roles and Features Wizard', width: 470, className: 'w32-dlg',
      content: h('div.w32', h('div', { style: 'font-size:15px;margin-bottom:8px' }, `Add features that are required for ${node.name}?`),
        h('div', { style: 'margin-bottom:8px' }, 'The following tools are required to manage this feature, but do not have to be installed on the same server.'),
        listEl, include),
      buttons: [{ label: 'Add Features', primary: true, value: 'add' }, { label: 'Cancel', cancel: true, value: null }] });
    return r === 'add' ? { includeMgmt: include.checked } : null;
  }
  async function removeDialog(node, required, mgmt) {
    const listEl = h('div.wz-list', { style: 'min-height:120px;max-height:220px' });
    const include = F().checkbox('Remove management tools (if applicable)', true);
    const paint = () => {
      U.clear(listEl);
      const ids = [...new Set([...required, ...(include.checked ? mgmt : [])])].sort(byOrder);
      for (const id of ids) { const n = C.get(id); listEl.appendChild(h('div.wz-li', { style: { paddingLeft: (n.depth * 16) + 'px' } }, (mgmt.includes(id) && !n.children.length ? '[Tools] ' : '') + n.name)); }
      if (!ids.length) listEl.appendChild(h('div.wz-li', { style: 'color:#555' }, 'No other features need to be removed.'));
    };
    include.input.addEventListener('change', paint);
    paint();
    const r = await WS.ui.dialog({ title: 'Remove Roles and Features Wizard', width: 470, className: 'w32-dlg',
      content: h('div.w32', h('div', { style: 'font-size:15px;margin-bottom:8px' }, `Remove features that require ${node.name}?`),
        h('div', { style: 'margin-bottom:8px' }, `The following features require ${node.name} and must also be removed.`), listEl, include),
      buttons: [{ label: 'Remove Features', primary: true, value: 'rm' }, { label: 'Cancel', cancel: true, value: null }] });
    return r === 'rm' ? { includeMgmt: include.checked } : null;
  }
  function validationDialog(mode, details, link) {
    return WS.ui.dialog({ title: mode === 'add' ? 'Add Roles and Features Wizard' : 'Remove Roles and Features Wizard', width: 500, className: 'w32-dlg',
      content: h('div.w32', h('div', { style: 'font-size:15px;margin-bottom:8px' }, 'Validation Results'),
        h('div', { style: 'margin-bottom:8px' }, `The validation process found problems on the server from which you want to ${mode === 'add' ? 'install' : 'remove'} features. The selected features are not compatible with the current configuration of the selected server. Click OK to select different features.`),
        h('div.wz-list', { style: 'min-height:80px' }, h('div', { style: 'display:flex;gap:6px' }, h('span', { html: I.eventError, style: 'width:16px;flex:none' }), h('div', details, link ? h('div', { style: 'margin-top:4px' }, h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); link[1](); } }, link[0])) : null)))),
      buttons: [{ label: 'OK', primary: true }] });
  }

  /* ---------------------------------------------------------------- the wizard */
  function launch(mode, opts = {}) {
    const app = mode === 'add' ? 'addroles' : 'removeroles';
    const existing = WS.wm.find(app);
    if (existing) { existing.restore(); return null; }
    const title = mode === 'add' ? 'Add Roles and Features Wizard' : 'Remove Roles and Features Wizard';
    const sel = new Set();   // add mode: ids to install
    const rem = new Set();   // remove mode: ids to remove
    let descEl, rolesTree, featTree, svcTrees = {};
    const smState = WS.state.servermanager;

    /* ---- selection rules ---- */
    const checked = n => (mode === 'add' ? inst(n.id) || sel.has(n.id) : inst(n.id) && !rem.has(n.id));
    const disabled = n => {
      if (mode === 'add') { const c = installedCount(n); return inst(n.id) && (!n.children.length || c.done === c.total); }
      return !WS.features.isInstalled(n.id) || PERMANENT.has(n.id) || WS.features.installState(n.id) === 'UninstallPending';
    };
    const indeterminate = n => {
      if (!n.children.length || !checked(n)) return false;
      const d = descendants(n);
      return d.some(x => checked(x)) ? !d.every(x => checked(x)) : false;
    };
    const label = n => {
      if (mode === 'remove') return n.name;
      if (!inst(n.id)) return n.name;
      if (!n.children.length) return n.name + ' (Installed)';
      const c = installedCount(n);
      return c.done === c.total ? n.name + ' (Installed)' : `${n.name} (${c.done} of ${c.total} installed)`;
    };
    function requiredOf(n) {
      const base = WS.features.plan([n.id]).toInstall;
      const withMgmt = WS.features.plan([n.id], { includeManagementTools: true }).toInstall;
      const anc = ancestors(n).map(a => a.id).filter(id => !inst(id) && !sel.has(id));
      const mgmt = withMgmt.filter(id => !base.includes(id) && !sel.has(id) && !inst(id));
      return { anc, mgmt };
    }
    async function toggleAdd(n, on) {
      if (!on) { [n, ...descendants(n)].forEach(x => sel.delete(x.id)); refreshAll(); return; }
      if (n.staticIp && WS.net.adapter().dhcp) {
        const r = await WS.ui.msgbox({ title, icon: 'warning', width: 470, message: 'Validation Results',
          detail: `This computer has dynamically assigned IP addresses. For reliable ${n.name} operation, you should use only static IP addresses.`, buttons: ['Continue', 'Cancel'] });
        if (r !== 'Continue') return;
      }
      const { anc, mgmt } = requiredOf(n);
      let includeMgmt = false;
      if (anc.length || mgmt.length) {
        const r = await requiredDialog(n, anc, mgmt);
        if (!r) return;
        includeMgmt = r.includeMgmt;
      }
      sel.add(n.id);
      anc.forEach(id => sel.add(id));
      if (includeMgmt) mgmt.forEach(id => sel.add(id));
      if (n.kind === 'role' && n.depth === 0) (n.defaultChildren || []).forEach(id => { if (!inst(id)) { sel.add(id); ancestors(C.get(id)).forEach(a => { if (!inst(a.id)) sel.add(a.id); }); } });
      else descendants(n).forEach(x => { if (!inst(x.id)) sel.add(x.id); });
      refreshAll();
    }
    async function toggleRemove(n, on) {
      if (on) { [n, ...descendants(n), ...ancestors(n)].forEach(x => rem.delete(x.id)); refreshAll(); return; }
      if (n.id === 'AD-Domain-Services' && WS.sys.isDC()) {
        await validationDialog('remove', 'The Active Directory domain controller needs to be demoted before the AD DS role can be removed.', ['Demote this domain controller', () => WS.apps.notImplemented('Demote this domain controller')]);
        return;
      }
      const children = descendants(n).filter(x => WS.features.isInstalled(x.id) && !rem.has(x.id)).map(x => x.id);
      const stillUsed = id => C.roots.role.concat(C.roots.feature).some(r => r.id !== n.id && WS.features.isInstalled(r.id) && !rem.has(r.id) && r.mgmt.includes(id));
      const mgmt = n.mgmt.filter(id => WS.features.isInstalled(id) && !SHARED_TOOLS.has(id) && !rem.has(id) && !stillUsed(id));
      let includeMgmt = false;
      if (children.length || mgmt.length) {
        const r = await removeDialog(n, children, mgmt);
        if (!r) return;
        includeMgmt = r.includeMgmt;
      }
      rem.add(n.id);
      children.forEach(id => rem.add(id));
      if (includeMgmt) mgmt.forEach(id => { rem.add(id); descendants(C.get(id)).forEach(d => rem.add(d.id)); });
      refreshAll();
    }
    const model = (onFocus) => ({ checked, disabled, indeterminate, label, toggle: mode === 'add' ? toggleAdd : toggleRemove, onFocus,
      expanded: C.all().filter(n => n.children.length && n.depth === 0 && inst(n.id) && installedCount(n).done < installedCount(n).total).map(n => n.id) });
    const showDesc = n => { if (descEl) descEl.textContent = n.desc; };
    function refreshAll() { [rolesTree, featTree, ...Object.values(svcTrees)].forEach(t => t && t.refresh()); }

    /* ---- what will happen ---- */
    const changes = () => (mode === 'add' ? [...sel].filter(id => !inst(id)) : [...rem].filter(id => WS.features.isInstalled(id))).sort(byOrder);
    function changeList(withNotes, idList) {
      const ids = idList || changes();
      const shown = new Set();
      for (const id of ids) { shown.add(id); ancestors(C.get(id)).forEach(a => shown.add(a.id)); }
      const out = h('div.wz-list');
      for (const id of [...shown].sort(byOrder)) {
        const n = C.get(id);
        const li = h('div.wz-li', { style: { paddingLeft: (n.depth * 16) + 'px' } }, n.name);
        const note = withNotes && mode === 'add' && POST_NOTE[id];
        if (note) li.appendChild(h('div', h('div.note', note[0]), h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); note[2](); } }, note[1])));
        out.appendChild(li);
      }
      if (!ids.length) out.appendChild(h('div.wz-li', { style: 'color:#555' }, mode === 'add' ? 'No roles, role services, or features are selected for installation.' : 'No roles, role services, or features are selected for removal.'));
      return out;
    }

    /* ---- pages ---- */
    const textPage = paras => h('div.wz-text', ...paras.map(p => (p instanceof Node ? p : h('p', p))));
    /* Hyper-V's own pages: Virtual Switches, Migration, Default Stores (applied by WS.hv when the role is installed). */
    const hvOpts = { adapters: [], migration: false, auth: 'CredSSP', vhdPath: 'C:\\ProgramData\\Microsoft\\Windows\\Virtual Hard Disks', vmPath: 'C:\\ProgramData\\Microsoft\\Windows\\Hyper-V' };
    function hyperVPages(skip) {
      const physical = () => WS.net.adapters().filter(a => !/^vEthernet/i.test(a.name));
      return [
        { id: 'hv:switches', nav: 'Virtual Switches', sub: true, title: 'Create Virtual Switches', skip,
          render: () => h('div.wz-text', h('p', 'Virtual machines require virtual switches to communicate with other computers. After you install this role, you can create virtual machines and attach them to a virtual switch.'),
            h('p', 'One virtual switch will be created for each network adapter you select. We recommend that you create at least one virtual switch now to provide virtual machines with connectivity to a physical network. You can add, remove, and modify your virtual switches later by using the Virtual Switch Manager.'),
            h('div.wz-coltitle', 'Network adapters:'), h('table.wz-hvnics', h('tr', h('th', 'Name'), h('th', 'Description')), ...physical().map(a => h('tr', h('td', F().checkbox(a.name, hvOpts.adapters.includes(a.name), { onChange: on => { hvOpts.adapters = on ? [...new Set([...hvOpts.adapters, a.name])] : hvOpts.adapters.filter(x => x !== a.name); } })), h('td', a.description)))),
            h('p', { style: 'margin-top:10px' }, 'We recommend that you reserve one network adapter for remote access to this server. To reserve a network adapter, do not select it for use with a virtual switch.')) },
        { id: 'hv:migration', nav: 'Migration', sub: true, title: 'Virtual Machine Migration', skip,
          render: () => h('div.wz-text', h('p', 'Hyper-V can be configured to send and receive live migrations of virtual machines on this server. Configuring Hyper-V now enables any available network on this server to be used for live migrations. If you want to dedicate specific networks for live migration, use Hyper-V settings after you install the role.'),
            F().checkbox('Allow this server to send and receive live migrations of virtual machines', hvOpts.migration, { onChange: on => { hvOpts.migration = on; } }),
            h('div.wz-coltitle', { style: 'margin-top:10px' }, 'Authentication protocol'), h('p', 'Select the protocol you want to use to authenticate live migrations.'),
            F().radio('hvauth', 'Use Credential Security Support Provider (CredSSP)', true, { onChange: on => { if (on) hvOpts.auth = 'CredSSP'; } }), h('p.wz-hint', 'This protocol is less secure than Kerberos, but does not require you to set up constrained delegation. To perform a live migration, you must be logged on to the source server.'),
            F().radio('hvauth', 'Use Kerberos', false, { onChange: on => { if (on) hvOpts.auth = 'Kerberos'; } }), h('p.wz-hint', 'This protocol is more secure but requires you to set up constrained delegation in your environment to perform tasks such as live migration when you are not logged on to the server.')) },
        { id: 'hv:stores', nav: 'Default Stores', sub: true, title: 'Default Stores', skip,
          render: () => {
            const field = (label, key) => { const t = F().text({ value: hvOpts[key], width: 380, onInput: v => { hvOpts[key] = v; } }); t.dataset.field = key; return h('div', { style: 'margin:8px 0' }, h('div', label), h('div', { style: 'display:flex;gap:6px' }, t, F().button('Browse...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: t.value }); if (p) t.value = hvOpts[key] = p; }))); };
            return h('div.wz-text', h('p', 'Hyper-V uses default locations to store virtual hard disk files and virtual machine configuration files, unless you specify different locations when you create the files. You can change these default locations now, or you can change them later by modifying Hyper-V settings.'),
              field('Default location for virtual hard disk files:', 'vhdPath'), field('Default location for virtual machine configuration files:', 'vmPath'));
          } }
      ];
    }
    const roleIds = C.roots.role.map(r => r.id);
    const rolePages = mode !== 'add' ? [] : roleIds.flatMap(id => {
      const n = C.get(id);
      const info = ROLE_PAGES[id] || { nav: WS.sm.shortName(id), title: n.name, text: n.desc, notes: [] };
      const pages = [{
        id: 'role:' + id, nav: info.nav, title: info.title, skip: () => !sel.has(id) || inst(id),
        render: () => textPage([info.text, info.notes && info.notes.length ? h('div', h('div.wz-section', 'Things to note:'), h('ul', ...info.notes.map(t => h('li', t)))) : null].filter(Boolean))
      }];
      if (id === 'Hyper-V') pages.push(...hyperVPages(() => !sel.has(id) || inst(id)));
      if (n.children.length && id !== 'FileAndStorage-Services') {
        pages.push({
          id: 'rs:' + id, nav: 'Role Services', sub: true, title: 'Select role services', skip: () => !sel.has(id) || inst(id),
          render: () => {
            const d = h('div.wz-desc', n.children[0].desc);
            svcTrees[id] = featureTree(n.children, { ...model(x => { d.textContent = x.desc; }), expanded: [] });
            return h('div.wz-cols', h('div', h('div.wz-coltitle', `Select the role services to install for ${n.name}`), h('div', 'Role services'), svcTrees[id].el), h('div', h('div.wz-coltitle', 'Description'), d));
          },
          enter: () => svcTrees[id] && svcTrees[id].refresh()
        });
      }
      return pages;
    });

    const pages = [
      {
        id: 'before', nav: 'Before You Begin', title: 'Before you begin', skip: w => w.data.skipBefore,
        render: () => {
          const skipBox = F().checkbox('Skip this page by default', smState.skipBeforeYouBegin, { onChange: v => { smState.skipBeforeYouBegin = v; WS.store.changed('servermanager'); } });
          const [intro, otherLead, otherLink] = BEFORE[mode];
          return h('div.wz-text', { style: 'display:flex;flex-direction:column;height:100%' },
            h('p', intro), h('p', otherLead, h('br'), h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); w0.close(false); (mode === 'add' ? WS.sm.removeRoles : WS.sm.addRoles)(); } }, otherLink)),
            h('p', 'Before you continue, verify that the following tasks have been completed:'),
            h('ul', h('li', 'The Administrator account has a strong password'), h('li', 'Network settings, such as static IP addresses, are configured'), h('li', 'The most current security updates from Windows Update are installed')),
            h('p', 'If you must verify that any of the preceding prerequisites have been completed, close the wizard, complete the steps, and then run the wizard again.'),
            h('p', 'To continue, click Next.'), h('div', { style: 'margin-top:auto' }, skipBox));
        }
      },
      mode === 'add' ? {
        id: 'type', nav: 'Installation Type', title: 'Select installation type',
        render: w => {
          w.data.rRole = F().radio('itype', 'Role-based or feature-based installation', true);
          w.data.rRds = F().radio('itype', 'Remote Desktop Services installation', false);
          return h('div.wz-text', h('p', 'Select the installation type. You can install roles and features on a running physical computer or virtual machine, or on an offline virtual hard disk (VHD).'),
            w.data.rRole, h('p', { style: 'padding-left:22px;color:#555' }, 'Configure a single server by adding roles, role services, and features.'),
            w.data.rRds, h('p', { style: 'padding-left:22px;color:#555' }, 'Install required role services for Virtual Desktop Infrastructure (VDI) to create a virtual machine-based or session-based desktop deployment.'));
        },
        validate: w => (w.data.rRds.checked ? 'Remote Desktop Services installation is not available in the lab simulator. Choose Role-based or feature-based installation.' : null)
      } : null,
      {
        id: 'server', nav: 'Server Selection', title: mode === 'add' ? 'Select destination server' : 'Select destination server',
        render: w => {
          w.data.rPool = F().radio('ssel', 'Select a server from the server pool', true);
          w.data.rVhd = F().radio('ssel', 'Select a virtual hard disk', false);
          const lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 200 }, { key: 'ip', label: 'IP Address', width: 150 }, { key: 'os', label: 'Operating System', width: 300 }],
            rows: () => [{ id: 'local', name: WS.sys.fqdn(), ip: WS.net.primaryIp() || '', os: 'Microsoft Windows Server 2025 Datacenter Evaluation' }], multi: false });
          lv.el.style.height = '150px'; lv.el.style.border = '1px solid #ababab';
          setTimeout(() => lv.select('local'), 0);
          return h('div.wz-text', h('p', `Select a server or a virtual hard disk on which to ${mode === 'add' ? 'install' : 'remove'} roles and features.`), w.data.rPool, w.data.rVhd,
            h('div.wz-section', 'Server Pool'), F().row('Filter:', F().text({ width: 220 }), { labelWidth: 40 }), lv.el, h('div', { style: 'margin:4px 0 10px' }, '1 Computer(s) found'),
            h('p', { style: 'color:#555' }, `This page shows servers that are running Windows Server 2012 or a newer release of Windows Server, and that have been added by using the Add Servers command in Server Manager. Offline servers and newly-added servers from which data collection is still incomplete are not shown.`));
        },
        validate: w => (w.data.rVhd.checked ? 'Installing roles and features on a virtual hard disk is not available in the lab simulator.' : null)
      },
      {
        id: 'roles', nav: 'Server Roles', title: mode === 'add' ? 'Select server roles' : 'Remove server roles',
        render: () => {
          descEl = h('div.wz-desc', C.roots.role[0].desc);
          rolesTree = featureTree(C.roots.role, model(showDesc));
          return h('div.wz-cols', h('div', h('div.wz-coltitle', mode === 'add' ? 'Select one or more roles to install on the selected server.' : 'To remove one or more installed roles from the selected server, clear their check boxes.'), h('div', 'Roles'), rolesTree.el),
            h('div', h('div.wz-coltitle', 'Description'), descEl));
        },
        enter: () => rolesTree && rolesTree.refresh()
      },
      {
        id: 'features', nav: 'Features', title: mode === 'add' ? 'Select features' : 'Remove features',
        render: () => {
          const d = h('div.wz-desc', C.roots.feature[0].desc);
          featTree = featureTree(C.roots.feature, model(n => { d.textContent = n.desc; }));
          return h('div.wz-cols', h('div', h('div.wz-coltitle', mode === 'add' ? 'Select one or more features to install on the selected server.' : 'To remove one or more installed features from the selected server, clear their check boxes.'), h('div', 'Features'), featTree.el),
            h('div', h('div.wz-coltitle', 'Description'), d));
        },
        enter: () => featTree && featTree.refresh()
      },
      ...rolePages,
      {
        id: 'confirm', nav: 'Confirmation', title: mode === 'add' ? 'Confirm installation selections' : 'Confirm removal selections', finish: true, rerender: true,
        render: w => {
          const auto = F().checkbox('Restart the destination server automatically if required', !!w.data.autoRestart, { onChange: async v => {
            if (!v) { w.data.autoRestart = false; return; }
            const r = await WS.ui.msgbox({ title, icon: 'question', message: 'If a restart is required, the destination server restarts automatically, without additional notifications. Do you want to allow automatic restarts?', buttons: ['Yes', 'No'] });
            w.data.autoRestart = r === 'Yes';
            auto.checked = w.data.autoRestart;
          } });
          return h('div.wz-text', h('p', mode === 'add' ? 'To install the following roles, role services, or features on selected server, click Install.' : 'To remove the following roles, role services, or features from selected server, click Remove.'),
            auto, h('div', { style: 'height:6px' }), changeList(false),
            h('div', { style: 'margin-top:8px' }, h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); exportConfig(); } }, 'Export configuration settings')),
            mode === 'add' ? h('div', h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); WS.ui.msgbox({ title: 'Specify Alternate Source Path', message: 'All installation files are available locally in the lab simulator. No alternate source path is needed.' }); } }, 'Specify an alternate source path')) : null);
        },
        enter: w => w.setFinish(changes().length > 0)
      },
      {
        id: 'results', nav: 'Results', title: mode === 'add' ? 'Installation progress' : 'Removal progress', rerender: true,
        render: w => {
          const bar = h('div.pbar-fill');
          const status = h('div', mode === 'add' ? 'Feature installation' : 'Feature removal');
          const msg = h('div', { style: 'margin:4px 0 8px' }, `${mode === 'add' ? 'Installation' : 'Removal'} started on ${WS.sys.fqdn()}`);
          const listHost = h('div', changeList(false));
          w.data.results = { bar, msg, listHost };
          return h('div.wz-text', h('div', 'View installation progress'), h('div.wz-progress', h('div.pbar', bar)), status, msg, listHost,
            h('p', { style: 'margin-top:10px;color:#555' }, 'You can close this wizard without interrupting running tasks. View task progress or open this page again by clicking Notifications in the command bar, and then Task Details.'),
            h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); exportConfig(); } }, 'Export configuration settings'));
        },
        enter: w => runJob(w)
      }
    ];
    let w0 = null;
    function exportConfig() {
      const ids = changes();
      WS.ui.filePicker({ mode: 'save', title: 'Export Configuration Settings', defaultName: 'DeploymentConfigTemplate', filters: [{ label: 'XML file (*.xml)', ext: ['.xml'] }] }).then(path => {
        if (!path) return;
        const xml = '<?xml version="1.0" encoding="utf-8"?>\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">\r\n' +
          ids.map(id => `  <Obj><Props><S N="Name">${id}</S><S N="DisplayName">${U.esc(C.get(id).name)}</S></Props></Obj>`).join('\r\n') + '\r\n</Objs>\r\n';
        try { WS.fs.writeFile(path, xml); } catch (e) { WS.ui.msgbox({ title, icon: 'error', message: e.message }); }
      });
    }

    /** Runs the install/removal with a progress bar; keeps going if the wizard is closed. */
    async function runJob(w) {
      const ids = changes();
      const r = w.data.results;
      for (const pct of [12, 30, 48, 66, 82]) { r.bar.style.width = pct + '%'; await U.sleep(260); }
      if (mode === 'add' && ids.includes('Hyper-V') && WS.hv) WS.hv.setInstallOptions({ ...hvOpts });
      const res = mode === 'add' ? WS.features.install(ids) : WS.features.uninstall(ids);
      r.bar.style.width = '100%';
      const server = WS.sys.fqdn();
      let text, status = 'done';
      const posts = mode === 'add' && ids.some(id => POST_NOTE[id]);
      if (!res.ok) { text = `${mode === 'add' ? 'Installation' : 'Removal'} of one or more roles, role services, or features failed.\n${res.error}`; status = 'error'; r.bar.style.background = '#c42b1c'; }
      else if (res.restartNeeded === 'Yes') { text = `Restart pending. You must restart the destination server to finish ${mode === 'add' ? 'installation' : 'removal'}.`; status = 'warning'; }
      else if (posts) text = `Configuration required. Installation succeeded on ${server}.`;
      else text = `${mode === 'add' ? 'Installation' : 'Removal'} succeeded on ${server}.`;
      r.msg.textContent = text;
      r.msg.style.whiteSpace = 'pre-line';
      U.clear(r.listHost); r.listHost.appendChild(changeList(res.ok, ids));
      WS.sm.notify({ title: mode === 'add' ? 'Feature installation' : 'Feature removal', message: text, status, actions: [{ label: mode === 'add' ? 'Add Roles and Features' : 'Remove Roles and Features', fn: () => (mode === 'add' ? WS.sm.addRoles() : WS.sm.removeRoles()) }] });
      w.data.finished = res;
      if (res.ok && res.restartNeeded === 'Yes' && w.data.autoRestart) setTimeout(() => WS.shell.restart(), 600);
    }

    const promise = WS.ui.wizard({ title, style: 'server', asWindow: true, app, icon: I.mmc, width: 820, height: 600,
      finishLabel: mode === 'add' ? 'Install' : 'Remove', data: { skipBefore: !!smState.skipBeforeYouBegin }, pages: pages.filter(Boolean),
      onCreate: w => { w0 = w; if (opts.onCreate) opts.onCreate(w, { sel, rem, toggle: (id, on) => (mode === 'add' ? toggleAdd : toggleRemove)(C.get(id), on), changes }); },
      onFinish: () => null });
    return promise;
  }

  WS.sm.addRoles = opts => launch('add', opts);
  WS.sm.removeRoles = opts => launch('remove', opts);
})();
