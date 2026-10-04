/* Control Panel applets reached from Server Manager's Local Server page:
 *   sysdm.cpl  "System Properties"  (Computer Name, Hardware, Advanced, Remote) + "Computer Name/Domain Changes"
 *   timedate.cpl "Date and Time"    (time zone)
 * Both are property sheets over WS.sys, so the same settings change from sconfig / PowerShell later. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, F = () => WS.ui.f, I = WS.icons;

  const PC = '<svg viewBox="0 0 32 32"><rect x="3" y="5" width="26" height="17" rx="1.5" fill="#5b6b7d"/><rect x="5" y="7" width="22" height="13" fill="#4ea5ef"/><path d="M11 27h10M16 22v5" stroke="#5b6b7d" stroke-width="2.4"/></svg>';

  /* ================================================================ System Properties */
  let open = false;
  async function sysdm(args = {}) {
    if (open) return null;
    open = true;
    let restartNeeded = false;
    const s = WS.state.system;
    const tabIndex = { name: 0, hardware: 1, advanced: 2, remote: 3 }[args.tab] || 0;
    let descIn, nameTab, rdpNone, rdpAllow, nla;
    const paintName = () => {
      if (!nameTab) return;
      nameTab.querySelector('.full').textContent = WS.sys.fqdn() + (s.domain ? '' : '');
      nameTab.querySelector('.memberLabel').textContent = s.domain ? 'Domain:' : 'Workgroup:';
      nameTab.querySelector('.member').textContent = s.domain || s.workgroup;
      nameTab.querySelector('.pending').style.display = s.pendingComputerName || s.pendingReboot.includes('rename') ? '' : 'none';
    };
    const stub = name => () => WS.ui.msgbox({ title: 'System Properties', message: `${name} is not available in the lab simulator.` });
    const r = await WS.ui.propertySheet({
      title: 'System Properties', width: 420, initialTab: tabIndex,
      tabs: [
        {
          label: 'Computer Name',
          render: () => {
            descIn = F().text({ value: s.description || '' });
            nameTab = h('div',
              h('div.ps-headline', h('span', { html: PC }), h('div', 'Windows uses the following information to identify your computer on the network.')),
              F().row('Computer description:', descIn, { labelWidth: 130 }),
              h('div', { style: 'padding-left:138px;color:#555;margin-top:-4px' }, 'For example: "IIS Production Server" or "Accounting Server".'),
              F().row('Full computer name:', h('span.full'), { labelWidth: 130 }),
              F().row(h('span.memberLabel'), h('span.member'), { labelWidth: 130 }),
              h('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:18px' },
                h('div', { style: 'flex:1' }, 'To rename this computer or change its domain or workgroup, click Change.'),
                F().button('Change...', async () => { if (await nameDialog()) { restartNeeded = true; paintName(); } })),
              h('div.pending', { style: 'display:none;margin-top:22px;gap:8px;align-items:center' }, h('span', { html: I.eventWarning, style: 'display:inline-block;width:16px;vertical-align:middle;margin-right:6px' }), 'Changes will take effect after you restart this computer.'));
            setTimeout(paintName, 0);
            return nameTab;
          },
          apply: () => { if ((s.description || '') !== descIn.value) { s.description = descIn.value; WS.store.changed('system'); } return null; }
        },
        {
          label: 'Hardware',
          render: () => h('div',
            F().group('Device Manager', h('p', 'The Device Manager lists all the hardware devices installed on your computer. Use the Device Manager to change the properties of any device.'), h('div', { style: 'text-align:right' }, F().button('Device Manager', () => WS.apps.notImplemented('Device Manager')))),
            F().group('Device Installation Settings', h('p', 'Choose whether Windows downloads manufacturers\' apps and custom icons available for your devices.'), h('div', { style: 'text-align:right' }, F().button('Device Installation Settings', stub('Device Installation Settings')))))
        },
        {
          label: 'Advanced',
          render: () => h('div',
            h('p', { style: 'margin-top:0' }, 'You must be logged on as an Administrator to make most of these changes.'),
            F().group('Performance', h('p', 'Visual effects, processor scheduling, memory usage, and virtual memory'), h('div', { style: 'text-align:right' }, F().button('Settings...', stub('Performance Options')))),
            F().group('User Profiles', h('p', 'Desktop settings related to your sign-in'), h('div', { style: 'text-align:right' }, F().button('Settings...', stub('User Profiles')))),
            F().group('Startup and Recovery', h('p', 'System startup, system failure, and debugging information'), h('div', { style: 'text-align:right' }, F().button('Settings...', stub('Startup and Recovery')))),
            h('div', { style: 'text-align:right' }, F().button('Environment Variables...', stub('Environment Variables'))))
        },
        {
          label: 'Remote',
          render: () => {
            rdpNone = F().radio('rdp', "Don't allow remote connections to this computer", !s.rdpEnabled);
            rdpAllow = F().radio('rdp', 'Allow remote connections to this computer', s.rdpEnabled);
            nla = F().checkbox('Allow connections only from computers running Remote Desktop with Network Level Authentication (recommended)', s.rdpNla !== false, { disabled: !s.rdpEnabled });
            const sync = () => { nla.input.disabled = !rdpAllow.checked; nla.classList.toggle('disabled', !rdpAllow.checked); };
            rdpNone.input.addEventListener('change', sync); rdpAllow.input.addEventListener('change', sync);
            return h('div',
              F().group('Remote Assistance', F().checkbox('Allow Remote Assistance connections to this computer', false), h('div', { style: 'text-align:right' }, F().button('Advanced...', stub('Remote Assistance Settings')))),
              F().group('Remote Desktop', h('div', { style: 'margin-bottom:4px' }, 'Choose an option, and then specify who can connect.'), rdpNone, rdpAllow, h('div', { style: 'padding-left:20px' }, nla),
                h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' }, F().link('Help me choose', stub('Help')), F().button('Select Users...', rdpUsers))));
          },
          apply: () => {
            const want = rdpAllow.checked;
            if (want !== !!s.rdpEnabled || nla.checked !== (s.rdpNla !== false)) WS.sys.setRemoteDesktop(want, nla.checked);
            return null;
          }
        }
      ]
    });
    open = false;
    if (restartNeeded) {
      const c = await WS.ui.msgbox({ title: 'Microsoft Windows', icon: 'warning', message: 'You must restart your computer to apply these changes', detail: 'Before restarting, save any open files and close all programs.', buttons: ['Restart Now', 'Restart Later'] });
      if (c === 'Restart Now') WS.shell.restart();
    }
    return r;
  }

  /** "Computer Name/Domain Changes". Resolves true when something changed (a restart is then required). */
  async function nameDialog() {
    const s = WS.state.system;
    const isDC = WS.sys.isDC();
    if (isDC) {
      const ok = await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', icon: 'warning', message: 'Changing the name of a domain controller may cause it to become temporarily unavailable to users and computers.', detail: 'For information about renaming domain controllers, including alternate renaming methods, see Help.', buttons: ['OK', 'Cancel'] });
      if (ok !== 'OK') return false;
    }
    const nameIn = F().text({ value: s.pendingComputerName || s.computerName, maxLength: 63 });
    const full = h('div', { style: 'padding:2px 0' });
    const domIn = F().text({ value: s.domain || '', disabled: isDC });
    const wgIn = F().text({ value: s.workgroup || '', disabled: isDC });
    const rDom = F().radio('memb', 'Domain:', isDC, { disabled: isDC });
    const rWg = F().radio('memb', 'Workgroup:', !isDC, { disabled: isDC });
    const sync = () => { if (isDC) return; domIn.disabled = !rDom.checked; wgIn.disabled = !rWg.checked; };
    rDom.input.addEventListener('change', sync); rWg.input.addEventListener('change', sync); sync();
    const updateFull = () => { full.textContent = nameIn.value.trim().toUpperCase() + (s.domain ? '.' + s.domain : ''); };
    nameIn.addEventListener('input', updateFull); updateFull();
    const content = h('div.w32',
      h('div', { style: 'margin-bottom:10px' }, 'You can change the name and the membership of this computer. Changes might affect access to network resources.'),
      F().stack('Computer name:', nameIn),
      h('div', 'Full computer name:'), full,
      h('div', { style: 'text-align:right' }, F().button('More...', () => WS.ui.msgbox({ title: 'DNS Suffix and NetBIOS Computer Name', message: `Primary DNS suffix of this computer:\n${s.domain || ''}\n\nNetBIOS computer name:\n${(s.pendingComputerName || s.computerName).slice(0, 15)}` }))),
      F().group('Member of', rDom, h('div', { style: 'padding-left:20px' }, domIn), rWg, h('div', { style: 'padding-left:20px' }, wgIn)));
    for (;;) {
      const r = await WS.ui.dialog({ title: 'Computer Name/Domain Changes', content, width: 380, className: 'w32-dlg', buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
      if (r !== 'OK') return false;
      const newName = nameIn.value.trim();
      const nameChanged = newName.toUpperCase() !== (s.pendingComputerName || s.computerName);
      if (!isDC && rDom.checked) {
        const d = domIn.value.trim();
        if (!d) { await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', icon: 'error', message: 'The domain name cannot be blank.' }); continue; }
        await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', icon: 'error', width: 470, message: `An Active Directory Domain Controller (AD DC) for the domain "${d}" could not be contacted.`, detail: 'Ensure that the domain name is typed correctly.\n\nIf the name is correct, click Details for troubleshooting information.' });
        continue;
      }
      const newWg = isDC ? '' : wgIn.value.trim().toUpperCase();
      const wgChanged = !isDC && newWg && newWg !== s.workgroup;
      if (!nameChanged && !wgChanged) return false;
      if (nameChanged) {
        const res = WS.sys.rename(newName);
        if (!res.ok) { await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', message: res.error, icon: 'error' }); continue; }
      }
      if (wgChanged) {
        const res = WS.sys.setWorkgroup(newWg);
        if (!res.ok) { await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', message: res.error, icon: 'error' }); continue; }
        await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', message: `Welcome to the ${newWg} workgroup.` });
      }
      await WS.ui.msgbox({ title: 'Computer Name/Domain Changes', message: 'You must restart your computer to apply these changes.', detail: 'Before restarting, save any open files and close all programs.' });
      return true;
    }
  }

  /** "Remote Desktop Users": members of the (local or domain Builtin) Remote Desktop Users group. */
  async function rdpUsers() {
    const dc = WS.sys.isDC();
    const members = () => dc ? WS.ad.members('Remote Desktop Users').map(m => ({ id: m.id, label: `${WS.ad.netbios()}\\${m.sam || m.name}` }))
      : (WS.local.group('Remote Desktop Users') || { members: [] }).members.map(m => ({ id: m, label: m.includes('\\') ? m : `${WS.sys.name}\\${m}` }));
    let lv;
    const refresh = () => lv.refresh();
    lv = WS.ui.listView({ columns: [{ key: 'label', label: 'Name', width: 300 }], rows: members, getId: r => r.id, multi: true, icon: () => I.adUser });
    lv.el.style.height = '150px';
    const add = async () => {
      const picked = await WS.ui.objectPicker({ types: ['user', 'group'] });
      for (const p of picked || []) {
        const r = dc ? WS.ad.addMember('Remote Desktop Users', { id: p.id }) : WS.local.addMember('Remote Desktop Users', p.name);
        if (!r.ok && r.code !== 'AlreadyMember' && r.code !== 'MemberExists') await WS.ui.msgbox({ title: 'Remote Desktop Users', icon: 'error', message: r.error });
      }
      refresh();
    };
    const remove = () => {
      for (const m of lv.selected()) { if (dc) WS.ad.removeMember('Remote Desktop Users', { id: m.id }); else WS.local.removeMember('Remote Desktop Users', m.id); }
      refresh();
    };
    await WS.ui.dialog({ title: 'Remote Desktop Users', width: 380, className: 'w32-dlg',
      content: h('div.w32', h('div', { style: 'margin-bottom:6px' }, 'The users listed below can connect to this computer, and any members of the Administrators group can connect even if they are not listed.'), lv.el,
        h('div', { style: 'margin:6px 0' }, `${dc ? WS.ad.netbios() : WS.sys.name}\\Administrator already has access.`),
        h('div', { style: 'display:flex;gap:8px' }, F().button('Add...', add), F().button('Remove', remove))),
      buttons: [{ label: 'OK', primary: true }, { label: 'Cancel', cancel: true }] });
  }

  /* ================================================================ Date and Time */
  async function timedate() {
    const tzLabel = h('div', WS.state.system.timeZone);
    const now = h('div', { style: 'font-size:14px;margin:6px 0' });
    const tick = () => { const d = WS.sys.now(); now.textContent = `Date: ${WS.util.fmtLongDate(d)}\nTime: ${WS.util.fmtTime(d, true)}`; };
    tick();
    const timer = setInterval(tick, 1000);
    await WS.ui.propertySheet({
      title: 'Date and Time', width: 420,
      tabs: [
        { label: 'Date and Time', render: () => h('div',
          h('div', { style: 'white-space:pre-line' }, now),
          h('div', { style: 'text-align:right' }, F().button('Change date and time...', () => WS.ui.msgbox({ title: 'Date and Time', message: 'The system clock follows the host computer in the lab simulator.' }))),
          F().group('Time zone', tzLabel, h('div', { style: 'text-align:right;margin-top:6px' }, F().button('Change time zone...', async () => { if (await timeZoneDialog()) { tzLabel.textContent = WS.state.system.timeZone; tick(); } })))) },
        { label: 'Additional Clocks', render: () => h('div', F().note('Additional clocks can display the time in other time zones.'), F().checkbox('Show this clock', false, { disabled: true })) },
        { label: 'Internet Time', render: () => h('div', h('p', WS.sys.isDC() ? 'This computer is set to automatically synchronize its time using the domain hierarchy.' : "This computer is set to automatically synchronize with 'time.windows.com'."), h('div', { style: 'text-align:right' }, F().button('Change settings...', () => WS.ui.msgbox({ title: 'Internet Time Settings', message: 'Time synchronization is not modelled in the lab simulator.' })))) }
      ]
    });
    clearInterval(timer);
  }
  async function timeZoneDialog() {
    const sel = F().select(WS.sys.timeZones.map(t => ({ value: t.id, label: t.display })), WS.state.system.timeZoneId, { width: 360 });
    const r = await WS.ui.dialog({ title: 'Time Zone Settings', width: 420, className: 'w32-dlg',
      content: h('div.w32', h('div', { style: 'margin-bottom:6px' }, 'Set the time zone:'), F().row('Time zone:', sel, { labelWidth: 70 }), F().checkbox('Automatically adjust clock for Daylight Saving Time', true)),
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }] });
    if (r !== 'ok') return false;
    WS.sys.setTimeZone(sel.value);
    return true;
  }

  WS.apps.register({ id: 'sysdm', name: 'System Properties', icon: I.computer, launch: sysdm, keywords: ['sysdm.cpl', 'rename', 'computer name', 'remote desktop'] });
  WS.apps.register({ id: 'timedate', name: 'Date and Time', icon: I.task, launch: timedate, keywords: ['timedate.cpl', 'time zone', 'clock'] });
  WS.cpl = { sysdm, nameDialog, rdpUsers, timedate, timeZoneDialog };
})();
