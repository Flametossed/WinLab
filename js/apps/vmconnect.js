/* Virtual Machine Connection (vmconnect): one window per VM with the Action/Media menus, the toolbar and the guest's
 * screen: turned off, the firmware ("Press any key to boot from CD or DVD...", the boot summary), Windows Setup
 * (Server 2025's setup pages), Customize settings, the lock screen and sign-in, and a running guest (a desktop for
 * Desktop Experience, SConfig for Server Core). The screen follows WS.hv; nothing here keeps its own VM state.
 *   WS.apps.launch('vmconnect', { vm: id }) -> win; win.vmc = { vm(), screen(), key(), click(label), type(field, text) } */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons;
  const H = () => WS.hv;
  const s16 = b => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">${b}</svg>`;
  const TB = {
    cad: s16('<rect x="1" y="4" width="14" height="8" rx="1"/><path d="M4 8h8"/>'), start: '<svg viewBox="0 0 16 16"><path d="M4 2.5l9 5.5-9 5.5z" fill="#2a8d2a"/></svg>',
    off: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" fill="#c42b1c"/></svg>', shutdown: '<svg viewBox="0 0 16 16" fill="none" stroke="#c42b1c" stroke-width="1.6"><path d="M8 2v6M4.8 4.3a5 5 0 1 0 6.4 0"/></svg>',
    save: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="#2b5797"/><rect x="4.5" y="3" width="7" height="4" fill="#fff"/></svg>', pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10" fill="#c98b16"/><rect x="9.5" y="3" width="3" height="10" fill="#c98b16"/></svg>',
    reset: '<svg viewBox="0 0 16 16" fill="none" stroke="#2b5797" stroke-width="1.6"><path d="M13 8a5 5 0 1 1-1.5-3.6M12 1.8v2.8H9.2"/></svg>', checkpoint: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#fff" stroke="#2b5797" stroke-width="1.4"/><path d="M8 4.5V8l2.5 1.5" stroke="#2b5797" stroke-width="1.4" fill="none"/></svg>',
    revert: '<svg viewBox="0 0 16 16" fill="none" stroke="#2b5797" stroke-width="1.6"><path d="M3 8a5 5 0 1 0 1.5-3.6M4 1.8v2.8h2.8"/></svg>', enhanced: s16('<rect x="1.5" y="2.5" width="13" height="9" rx="1"/><path d="M5 14h6"/>')
  };
  const esc = U.esc;

  function launch(args = {}) {
    const id = args.vm;
    const existing = WS.wm.windows.find(w => w.app === 'vmconnect' && w.vmcId === id);
    if (existing) { existing.restore && existing.restore(); WS.wm.focus && WS.wm.focus(existing); return existing; }
    const v0 = H().vm(id);
    if (!v0) { WS.ui.msgbox({ title: 'Virtual Machine Connection', icon: 'error', message: 'The virtual machine could not be found.' }); return null; }
    const win = WS.wm.create({ app: 'vmconnect', title: `${v0.name} on ${WS.sys.name} - Virtual Machine Connection`, icon: WS.virtmgmt ? WS.virtmgmt.ICON : I.mmc, width: 900, height: 700 });
    win.vmcId = id;
    const vm = () => H().vm(id);
    const screen = h('div.vmc-screen', { tabIndex: 0 });
    const status = h('div.vmc-status');
    const tbBtn = (key, title, fn) => h('button.vmc-tb', { title, dataset: { act: key }, html: TB[key], onClick: () => fn() });
    const act = what => WS.virtmgmt.act(id, what);
    const toolbar = h('div.vmc-toolbar',
      tbBtn('cad', 'Ctrl+Alt+Delete', () => cad()), h('span.vmc-sep'),
      tbBtn('start', 'Start', () => act('start')), tbBtn('off', 'Turn Off', () => act('turnoff')), tbBtn('shutdown', 'Shut Down', () => act('shutdown')), tbBtn('save', 'Save', () => act('save')),
      tbBtn('pause', 'Pause', () => act(vm().state === 'Paused' ? 'resume' : 'pause')), tbBtn('reset', 'Reset', () => act('reset')), h('span.vmc-sep'),
      tbBtn('checkpoint', 'Checkpoint', () => act('checkpoint')), tbBtn('revert', 'Revert', () => act('revert')), h('span.vmc-sep'), tbBtn('enhanced', 'Enhanced session', () => {}));
    const menu = WS.ui.menuBar([
      { label: '&File', items: () => [{ label: '&Settings...', action: () => WS.virtmgmt.settings(id) }, { separator: true }, { label: 'E&xit', action: () => win.close() }] },
      { label: '&Action', items: () => { const v = vm(); const on = v.state === 'Running', off = v.state === 'Off' || v.state === 'Saved'; return [
        { label: 'Ctrl+Alt+&Delete', shortcut: 'Ctrl+Alt+End', disabled: !on, action: cad }, { separator: true },
        { label: '&Start', disabled: !off, action: () => act('start') }, { label: '&Turn Off...', disabled: off, action: () => act('turnoff') }, { label: 'Shut &Down...', disabled: !on, action: () => act('shutdown') },
        { label: 'Sa&ve', disabled: off, action: () => act('save') }, { label: v.state === 'Paused' ? 'Resu&me' : '&Pause', disabled: off, action: () => act(v.state === 'Paused' ? 'resume' : 'pause') }, { label: '&Reset...', disabled: !on, action: () => act('reset') },
        { separator: true }, { label: '&Checkpoint...', action: () => act('checkpoint') }, { label: 'Re&vert...', disabled: !v.current, action: () => act('revert') }, { separator: true }, { label: '&Insert Integration Services Setup Disk', disabled: true }]; } },
      { label: '&Media', items: () => { const v = vm(); return v.dvds.map((d, i) => ({ label: `&DVD Drive`, items: [{ label: '&Insert Disk...', action: async () => { const p = await WS.ui.filePicker({ mode: 'open', path: 'C:\\', filters: [{ label: 'Image files (*.iso)', ext: ['iso'] }] }); if (p) { const r = H().setDvd(id, p, i); if (!r.ok) WS.ui.msgbox({ title: 'Virtual Machine Connection', icon: 'error', message: r.error }); } } },
        { label: `&Eject ${d.path ? d.path.split('\\').pop() : ''}`, disabled: !d.path, action: () => H().setDvd(id, null, i) }] })).concat(v.dvds.length ? [] : [{ label: '(no DVD drive)', disabled: true }]); } },
      { label: '&Clipboard', items: () => [{ label: '&Type clipboard text', disabled: true }, { label: '&Capture screen', disabled: true }] },
      { label: '&View', items: () => [{ label: '&Full Screen Mode', disabled: true }, { label: '&Toolbar', checked: true }] },
      { label: '&Help', items: () => [{ label: '&About Virtual Machine Connection', action: () => WS.ui.msgbox({ title: 'About Virtual Machine Connection', icon: 'info', message: 'Virtual Machine Connection\nVersion 10.0.26100.1742\n\nLab Simulator: not affiliated with Microsoft.' }) }] }
    ]);
    win.body.append(h('div.vmc', menu.el || menu, toolbar, h('div.vmc-screenwrap', screen), status));

    function cad() { const v = vm(); if (!v || v.state !== 'Running') return; H().ctrlAltDel(id); }
    let lastKey = '';
    function paint() {
      const v = vm();
      if (!v) { win.close(); return; }
      win.setTitle(`${v.name} on ${WS.sys.name} - Virtual Machine Connection`);
      const g = v.guest || {};
      const key = v.state + '|' + g.phase + '|' + (g.step || '') + '|' + (g.phase === 'installing' ? g.progress : '') + '|' + (g.prompt ? 1 : 0) + '|' + v.name;
      status.textContent = `Status: ${v.state === 'Running' ? 'Running' : v.state === 'Paused' ? 'Paused' : v.state === 'Saved' ? 'Saved' : 'Off'}`;
      toolbar.querySelectorAll('.vmc-tb').forEach(b => {
        const a = b.dataset.act, on = v.state === 'Running', off = v.state === 'Off' || v.state === 'Saved';
        b.disabled = { cad: !on, start: !off, off, shutdown: !on, save: off, pause: off, reset: !on, checkpoint: false, revert: !v.current, enhanced: true }[a];
      });
      if (key === lastKey) return;
      lastKey = key;
      U.clear(screen);
      screen.className = 'vmc-screen';
      screen.append(render(v, g));
      if (v.state === 'Paused') screen.append(h('div.vmc-paused', 'Paused'));
    }
    const center = (...c) => h('div.vmc-center', ...c);
    function render(v, g) {
      if (v.state === 'Off') { screen.classList.add('vmc-offline'); return center(h('p', `The virtual machine '${v.name}' is turned off.`), h('p', `To start the virtual machine, select 'Start' from the Action menu.`), h('button.btn.vmc-startbtn', { onClick: () => act('start') }, 'Start')); }
      if (v.state === 'Saved') { screen.classList.add('vmc-offline'); return center(h('p', `The virtual machine '${v.name}' is saved.`), h('p', `To resume the virtual machine, select 'Start' from the Action menu.`), h('button.btn.vmc-startbtn', { onClick: () => act('start') }, 'Start')); }
      switch (g.phase) {
        case 'post': return h('div.vmc-post', v.generation === 2 ? h('div.vmc-hvlogo', 'Hyper-V') : h('pre', 'Microsoft Hyper-V\nVirtual Machine BIOS'));
        case 'presskey': return h('pre.vmc-text', 'Press any key to boot from CD or DVD..');
        case 'bootfail': return v.generation === 2
          ? h('div.vmc-summary', h('div.vmc-sumbox', h('div.vmc-sumtitle', 'Virtual Machine Boot Summary'), h('table', ...(g.tried || []).map((t, i) => h('tr', h('td', `${i + 1}. ${t[0]}`), h('td', t[1])))),
            h('p', 'No operating system was loaded. Your virtual machine may be configured incorrectly. Exit and re-configure your VM or click restart to retry the current boot sequence again.')))
          : h('pre.vmc-text', 'Boot failure. Reboot and Select proper Boot device\nor Insert Boot Media in selected Boot device\n_');
        case 'setup': return setupScreen(v, g);
        case 'installing': return setupFrame('Installing Windows Server', h('div', h('div.vmc-prog', h('div.vmc-progbar', { style: { width: (g.progress || 0) + '%' } })), h('p', `Progress: ${g.progress || 0}%`), h('p.vmc-dim', 'Your PC will restart several times. This might take a while.')), null);
        case 'booting': return h('div.vmc-booting', h('div.vmc-winlogo', h('i'), h('i'), h('i'), h('i')), h('div.vmc-spinner'));
        case 'shuttingdown': return h('div.vmc-lock', h('div.vmc-spinner'), h('div', 'Shutting down'));
        case 'oobe': return oobe(v);
        case 'locked': return lock(v, g);
        case 'desktop': return desktop(v);
        default: return center(h('p', ''));
      }
    }
    /* ---------------- Windows Setup ---------------- */
    function setupFrame(title, body, buttons) {
      return h('div.vmc-setup', h('div.vmc-setupwin', h('div.vmc-setuptitle', h('span.vmc-setuplogo', h('i'), h('i'), h('i'), h('i')), 'Windows Server 2025 Setup'), h('div.vmc-setupbody', h('h2', title), body), buttons ? h('div.vmc-setupbtns', ...buttons) : null));
    }
    const next = (step, data) => () => { const r = H().setupStep(id, step, data && data()); if (r && !r.ok) WS.ui.msgbox({ title: 'Windows Server Setup', icon: 'error', message: r.error }); };
    const btn = (label, fn, o = {}) => h('button.vmc-sbtn' + (o.primary ? '.primary' : ''), { disabled: !!o.disabled, dataset: { setup: label }, onClick: fn }, label);
    function setupScreen(v, g) {
      const s = g.step || 'loading';
      if (s === 'loading') return h('div.vmc-booting', h('div.vmc-winlogo', h('i'), h('i'), h('i'), h('i')), h('div.vmc-spinner'));
      if (s === 'language') return setupFrame('Select language settings', h('div', h('label', 'Select language'), h('select.vmc-sel', h('option', 'English (United States)')), h('label', 'Select time and currency format'), h('select.vmc-sel', h('option', 'English (United States)'))), [btn('Next', next('keyboard'), { primary: true })]);
      if (s === 'keyboard') return setupFrame('Select keyboard settings', h('div', h('label', 'Select keyboard or input method'), h('select.vmc-sel', h('option', 'US'))), [btn('Back', next('language')), btn('Next', next('option'), { primary: true })]);
      if (s === 'option') {
        const agree = h('input', { type: 'checkbox', dataset: { field: 'agree' } });
        const nb = btn('Next', next('image'), { primary: true, disabled: true });
        agree.addEventListener('change', () => { nb.disabled = !agree.checked; });
        return setupFrame('Select setup option', h('div', h('label.vmc-radio', h('input', { type: 'radio', name: 'opt', checked: true }), h('span', h('b', 'Install Windows Server'), h('br'), 'Use this option to install a new copy of Windows Server.')),
          h('label.vmc-radio', h('input', { type: 'radio', name: 'opt', disabled: true }), h('span', h('b', 'Repair my PC'), h('br'), 'Troubleshoot to repair an existing installation.')),
          h('label.vmc-chk', agree, h('span', 'I agree everything will be deleted including files, apps, and settings.'))), [btn('Back', next('keyboard')), nb]);
      }
      if (s === 'image') {
        let pick = g.edition || null;
        const nb = btn('Next', next('license', () => ({ edition: pick })), { primary: true, disabled: !pick });
        const rows = H().EDITIONS.map(e => h('div.vmc-img' + (pick === e.id ? '.sel' : ''), { dataset: { edition: e.id }, onClick: ev => { pick = e.id; ev.currentTarget.parentElement.querySelectorAll('.vmc-img').forEach(x => x.classList.toggle('sel', x === ev.currentTarget)); nb.disabled = false; H().setupStep(id, 'image', { edition: pick }); } }, e.name));
        return setupFrame('Select image', h('div', h('p', 'Select the image you want to install.'), h('div.vmc-imgs', ...rows)), [btn('Back', next('option')), nb]);
      }
      if (s === 'license') return setupFrame('Applicable notices and license terms', h('div', h('div.vmc-eula', 'MICROSOFT SOFTWARE LICENSE TERMS (lab simulator placeholder). This lab image is for training only. By selecting Accept, you agree to use it only for learning.')), [btn('Back', next('image')), btn('Decline', () => H().setupStep(id, 'image')), btn('Accept', next('disk'), { primary: true })]);
      if (s === 'disk') {
        const disks = v.disks.filter(d => d.path && H().vhd(d.path));
        const sizeGB = d => (H().vhd(d.path).size / 1024 ** 3).toFixed(1);
        return setupFrame('Select location to install Windows Server', h('div', disks.length ? h('table.vmc-disks', h('tr', h('th', 'Name'), h('th', 'Total size'), h('th', 'Free space'), h('th', 'Type')),
          ...disks.map((d, i) => h('tr.sel', h('td', `Disk ${i} Unallocated Space`), h('td', sizeGB(d) + ' GB'), h('td', sizeGB(d) + ' GB'), h('td', '')))) : h('p.vmc-warn', 'We couldn\u2019t find any drives. To get a storage driver, select Load driver.'),
          h('div.vmc-links', h('span', 'Load driver'), h('span', 'Delete partition'), h('span', 'Create partition'), h('span', 'Refresh'))), [btn('Back', next('license')), btn('Next', next('ready'), { primary: true, disabled: !disks.length })]);
      }
      if (s === 'ready') {
        const ed = (H().EDITIONS.find(e => e.id === g.edition) || H().EDITIONS[3]).name;
        return setupFrame('Ready to install', h('div', h('p', 'Installing'), h('ul', h('li', ed), h('li', 'Disk 0 Unallocated Space')), h('p.vmc-dim', 'Make sure you have saved your work before installing.')), [btn('Back', next('disk')), btn('Install', next('install'), { primary: true })]);
      }
      return center(h('p', ''));
    }
    /* ---------------- the installed guest ---------------- */
    function oobe(v) {
      const os = H().guestOs(v);
      const p1 = h('input.vmc-in', { type: 'password', dataset: { field: 'pw1' } }), p2 = h('input.vmc-in', { type: 'password', dataset: { field: 'pw2' } });
      const msg = h('div.vmc-err');
      const finish = () => {
        if (p1.value !== p2.value) { msg.textContent = 'The passwords don\u2019t match.'; return; }
        const r = H().guestSetPassword(id, p1.value);
        if (!r.ok) msg.textContent = r.error;
      };
      return h('div.vmc-oobe', h('h1', 'Customize settings'), h('p', 'Type a password for the built-in administrator account that you can use to sign in to this computer.'),
        h('div.vmc-row', h('label', 'User name'), h('input.vmc-in', { value: 'Administrator', disabled: true })), h('div.vmc-row', h('label', 'Password'), p1), h('div.vmc-row', h('label', 'Reenter password'), p2), msg,
        h('div.vmc-oobebtn', h('button.vmc-sbtn.primary', { dataset: { setup: 'Finish' }, onClick: finish }, 'Finish')), h('div.vmc-osname', os ? os.edition : ''));
    }
    function lock(v, g) {
      const os = H().guestOs(v);
      const d = new Date();
      if (!g.prompt) return h('div.vmc-lock', h('div.vmc-time', U.fmtTime(d)), h('div.vmc-date', U.fmtLongDate ? U.fmtLongDate(d) : d.toDateString()), h('div.vmc-hint', 'Press Ctrl+Alt+Delete to unlock.'));
      const pw = h('input.vmc-in', { type: 'password', placeholder: 'Password', dataset: { field: 'password' } });
      const msg = h('div.vmc-err');
      const go = () => { const r = H().guestSignIn(id, pw.value); if (!r.ok) { msg.textContent = r.error; pw.value = ''; } };
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      setTimeout(() => pw.focus(), 30);
      return h('div.vmc-lock.signin', h('div.vmc-avatar'), h('div.vmc-user', 'Administrator'), h('div.vmc-inline', pw, h('button.vmc-sbtn.primary', { dataset: { setup: 'Sign in' }, onClick: go }, '\u2192')), msg, h('div.vmc-osname', os ? os.computerName : ''));
    }
    function desktop(v) {
      const os = H().guestOs(v);
      const ip = H().guestIps(v, 0)[0] || '';
      if (!os.desktop) {
        return h('pre.vmc-console', `===============================================================================
                     Welcome to ${os.edition}
===============================================================================

  1)  Domain/workgroup:                   Workgroup: WORKGROUP
  2)  Computer name:                      ${os.computerName}
  3)  Add local administrator
  4)  Remote management:                  Enabled

  5)  Update setting:                     Download only
  6)  Install updates
  7)  Remote desktop:                     Disabled

  8)  Network settings
  9)  Date and time
  10) Telemetry setting:                  Required
  11) Windows activation

  12) Log off user
  13) Restart server
  14) Shut down server
  15) Exit to command line (PowerShell)

Enter number to select an option: _

  (IPv4 address: ${ip || 'none'})`);
      }
      return h('div.vmc-desk', h('div.vmc-deskwin', h('div.vmc-deskwt', 'Server Manager'), h('div.vmc-deskbody', h('h3', 'Local Server'), h('table.hv-kv', ...[['Computer name', os.computerName], ['Workgroup', 'WORKGROUP'], ['Ethernet', ip ? `${ip}, IPv6 enabled` : 'IPv4 address assigned by DHCP, IPv6 enabled'], ['Operating system version', os.edition.replace(/ \(Desktop Experience\)$/, '')], ['Windows Defender Firewall', 'Public: On']].map(([k, x]) => h('tr', h('td', k), h('td', x)))))),
        h('div.vmc-desktaskbar', h('span.vmc-deskstart', h('i'), h('i'), h('i'), h('i')), h('span.vmc-deskclock', U.fmtTime(new Date()))), h('div.vmc-deskmark', `${os.edition}\nBuild ${os.build}`));
    }

    /* ---------------- input ---------------- */
    screen.addEventListener('keydown', e => {
      const v = vm();
      if (!v || v.state !== 'Running') return;
      if (e.ctrlKey && e.altKey && (e.key === 'End' || e.key === 'Delete')) { e.preventDefault(); cad(); return; }
      if (v.guest.phase === 'presskey') { e.preventDefault(); H().pressKey(id); }
    });
    screen.addEventListener('mousedown', () => screen.focus());
    win.listen('hyperv', () => paint());
    const tick = setInterval(() => { if (vm() && vm().state === 'Running') paint(); }, 1000);
    win.onClose(() => clearInterval(tick));
    win.vmc = {
      vm, screen: () => screen, text: () => screen.textContent, key: () => { screen.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, cad,
      click(label) { const b = [...screen.querySelectorAll('button, [data-edition]')].find(x => x.textContent.trim() === label || x.dataset.setup === label || x.dataset.edition === label); if (!b) throw new Error('No button ' + label + ' in ' + screen.textContent.slice(0, 200)); b.click(); },
      type(field, text) { const el = screen.querySelector(`[data-field="${field}"]`); if (!el) throw new Error('No field ' + field); if (el.type === 'checkbox') { el.checked = !!text; el.dispatchEvent(new Event('change', { bubbles: true })); } else { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); } },
      toolbar: key => toolbar.querySelector(`[data-act="${key}"]`)
    };
    paint();
    setTimeout(() => screen.focus(), 50);
    return win;
  }

  WS.apps.register({ id: 'vmconnect', name: 'Virtual Machine Connection', icon: I.mmc, launch });
})();
