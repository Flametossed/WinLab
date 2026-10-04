/* The host bar: a Hyper-V Virtual Machine Connection-style menu and toolbar above the VM screen. It is the "host"
 * side of the lab, so it is not part of the server: Ctrl+Alt+Delete, Start, Turn Off, Shut Down, Save, Pause, Reset,
 * Checkpoint and Revert (checkpoints are whole-lab snapshots kept by WS.store), fullscreen with keyboard lock (so the
 * Windows key reaches the VM in Chromium browsers), Type clipboard text, and for instructors File > Checkpoints...,
 * Export lab state... and Import lab state.... Whether the bar is collapsed is a per-browser preference (localStorage).
 *   WS.host = { state() -> 'Running'|'Off'|'Paused'|'Saved', cad(), start(), turnOff({ confirm }), shutDown({ confirm }),
 *     save(), pause(), resume(), reset({ confirm }), checkpoint(name?), revert({ confirm }), checkpoints(), exportState(),
 *     importState(text), fullscreen(), collapse(on), VM, HOST } */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util;
  const VM = 'WS2025-LAB', HOST = 'LABHOST';
  const PREF_KEY = 'ws2025lab.host.v1';
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const IC = {
    cad: s16('<rect x="1.5" y="4" width="13" height="8" rx="1.2" fill="#fff" stroke="#5b6b7d"/><path d="M4 7h1.5M7 7h2M10.5 7H12M4 9.5h8" stroke="#5b6b7d"/>'),
    start: s16('<circle cx="8" cy="8" r="6.5" fill="#2fb34b"/><path d="M6.3 5v6l5-3z" fill="#fff"/>'),
    off: s16('<circle cx="8" cy="8" r="6.5" fill="#c42b1c"/><rect x="5.3" y="5.3" width="5.4" height="5.4" fill="#fff"/>'),
    shutdown: s16('<circle cx="8" cy="8" r="6.5" fill="#d9772b"/><path d="M8 4.2v3.6M5.6 5.6a3.3 3.3 0 1 0 4.8 0" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>'),
    save: s16('<circle cx="8" cy="8" r="6.5" fill="#2f7fd8"/><path d="M5 5h6v6H5z" fill="none" stroke="#fff"/><path d="M6.5 5v2h3V5" fill="none" stroke="#fff"/>'),
    pause: s16('<circle cx="8" cy="8" r="6.5" fill="#e3a21a"/><path d="M6.3 5.2v5.6M9.7 5.2v5.6" stroke="#fff" stroke-width="1.6"/>'),
    reset: s16('<circle cx="8" cy="8" r="6.5" fill="#6b7c8f"/><path d="M11 8a3 3 0 1 1-.9-2.1" fill="none" stroke="#fff" stroke-width="1.3"/><path d="M10.6 3.8v2.4H8.2" fill="none" stroke="#fff" stroke-width="1.3"/>'),
    checkpoint: s16('<path d="M3 2h10v12l-5-3-5 3z" fill="#2fb34b"/><path d="M8 5v4M6 7h4" stroke="#fff" stroke-width="1.3"/>'),
    revert: s16('<path d="M3 2h10v12l-5-3-5 3z" fill="#6b7c8f"/><path d="M10 6.5H6.5M8 5l-1.5 1.5L8 8" fill="none" stroke="#fff" stroke-width="1.2"/>'),
    full: s16('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="#3a3a3a" stroke-width="1.3"/>'),
    collapse: s16('<path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
    expand: s16('<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
    vm: s16('<rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="#5b6b7d"/><rect x="3" y="4" width="10" height="6" fill="#4ea5ef"/><path d="M5.5 14h5M8 11.5V14" stroke="#5b6b7d" stroke-width="1.4"/>')
  };

  let vmState = null; // 'Paused' | 'Saved' | null (running or off)
  const prefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (e) { return {}; } };
  const savePrefs = p => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefs(), ...p })); } catch (e) { /* per-browser convenience only */ } };

  function state() {
    if (vmState) return vmState;
    return WS.shell && WS.shell.isOff && WS.shell.isOff() ? 'Off' : 'Running';
  }
  const running = () => state() === 'Running';

  /* ---------------- VM screen overlays (above everything in #screen, including dialogs) ---------------- */
  function vmOverlay(kind, text) {
    clearVmOverlay();
    document.getElementById('screen').appendChild(h('div.vmstate.' + kind, { id: 'vmstate' }, h('div.vmstate-text', text)));
  }
  function clearVmOverlay() { const el = document.getElementById('vmstate'); if (el) el.remove(); }

  /** Everything that stops the guest abruptly: the session ends and nothing is shut down cleanly. */
  function powerCut(kind) {
    vmState = null;
    clearVmOverlay();
    WS.sys.powerLoss(kind);
    if (WS.proc && WS.session.loggedIn) WS.proc.onLogoff();
    WS.ui.closeMenu();
    const dl = document.getElementById('dialogs');
    if (dl) U.clear(dl);
    WS.shell.closeFlyouts();
    WS.wm.closeAll();
    WS.session.loggedIn = false;
    WS.session.resume = false;
  }
  const confirmBox = (title, message, ok) => WS.ui.msgbox({ title, icon: 'question', message, buttons: [ok, 'Cancel'] }).then(r => r === ok);

  /* ---------------- actions ---------------- */
  function cad() {
    if (!running()) return false;
    if (WS.session.loggedIn) { WS.shell.secureScreen(); return true; }
    if (WS.shell.isLocked()) { WS.shell.unlock(); return true; }
    return false;
  }
  function start() {
    if (vmState === 'Saved') { vmState = null; clearVmOverlay(); paint(); return true; }
    if (state() !== 'Off') return false;
    WS.shell.boot();
    paint();
    return true;
  }
  async function turnOff(o = {}) {
    if (state() === 'Off') return false;
    if (o.confirm !== false && !(await confirmBox('Turn Off Machine', `Are you sure you want to turn off ${VM}?\n\nIf you turn off the virtual machine, any unsaved data in it will be lost.`, 'Turn Off'))) return false;
    powerCut('off');
    WS.shell.poweredOff();
    paint();
    return true;
  }
  async function shutDown(o = {}) {
    if (!running() || state() === 'Off') return false;
    if (o.confirm !== false && !(await confirmBox('Shut Down Machine', `Are you sure you want to shut down ${VM}?`, 'Shut Down'))) return false;
    // the Hyper-V Guest Shutdown service asks Windows to shut down cleanly
    WS.ui.closeMenu();
    if (WS.proc && WS.session.loggedIn) WS.proc.onLogoff();
    WS.shell.shutdownNow(false, { title: 'Other (Planned)', code: 0x80000000, comment: 'Hyper-V Guest Shutdown', process: 'C:\\Windows\\system32\\vmicsvc.exe', system: true });
    paint();
    return true;
  }
  function save() {
    if (!running()) return false;
    WS.store.save();
    vmState = 'Saved';
    vmOverlay('saved', `The virtual machine '${VM}' is saved.\nTo resume it, select Start from the Action menu.`);
    paint();
    return true;
  }
  function pause() { if (!running()) return false; vmState = 'Paused'; vmOverlay('paused', 'Paused'); paint(); return true; }
  function resume() { if (vmState !== 'Paused') return false; vmState = null; clearVmOverlay(); paint(); return true; }
  async function reset(o = {}) {
    if (state() === 'Off' || state() === 'Saved') return false;
    if (o.confirm !== false && !(await confirmBox('Reset Machine', `Are you sure you want to reset ${VM}?\n\nIf you reset the virtual machine, any unsaved data in it will be lost.`, 'Reset'))) return false;
    powerCut('reset');
    WS.shell.boot();
    paint();
    return true;
  }

  /* ---------------- checkpoints ---------------- */
  const checkpoints = () => WS.store.listCheckpoints();
  const defaultName = () => { const d = new Date(); return `${VM} - (${U.fmtDate(d)} - ${U.fmtTime(d, true)})`; };
  async function checkpoint(name) {
    let n = name;
    if (n == null) {
      n = await WS.ui.inputBox({ title: 'Checkpoint Name', prompt: 'Enter a name for the checkpoint:', value: defaultName(), okLabel: 'Yes',
        validate: v => (v.trim() ? null : 'Type a name for the checkpoint.') });
      if (n == null) return null;
    }
    try {
      WS.store.save();
      const cp = WS.store.createCheckpoint(n.trim());
      paint();
      if (name == null) await WS.ui.msgbox({ title: 'Production checkpoint created', icon: 'info', message: 'Production checkpoint created successfully.', detail: 'Applying it restarts the lab from the saved settings; open windows are not part of the checkpoint.' });
      return cp;
    } catch (e) {
      await WS.ui.msgbox({ title: 'Checkpoint', icon: 'error', message: 'The checkpoint could not be created.', detail: e.message });
      return null;
    }
  }
  /** Apply a checkpoint: the lab state comes back and the VM starts from it (latest one when no id is given). */
  async function revert(o = {}) {
    const list = checkpoints();
    const cp = o.id ? list.find(c => c.id === o.id) : list[list.length - 1];
    if (!cp) return false;
    if (o.confirm !== false) {
      const ok = o.id
        ? await confirmBox('Apply Checkpoint', `Are you sure you want to apply the checkpoint "${cp.name}"?\n\nThe current state of the virtual machine will be lost.`, 'Apply')
        : await confirmBox('Revert Virtual Machine', `Are you sure you want to revert ${VM}?\n\nThe current state of the virtual machine will be lost and it will return to the checkpoint "${cp.name}".`, 'Revert');
      if (!ok) return false;
    }
    powerCut('checkpoint');
    WS.store.applyCheckpoint(cp.id);
    delete WS.state.system.powerLoss; // applying a checkpoint isn't a crash
    WS.store.save();
    WS.shell.boot();
    paint();
    return true;
  }

  /** Restart the VM from a whole lab state (the Lab Guide's step snapshots), as applying a checkpoint does. */
  function restoreState(st) {
    powerCut('checkpoint');
    WS.store.applyState(st);
    delete WS.state.system.powerLoss;
    WS.store.save();
    WS.shell.boot();
    paint();
    return true;
  }

  async function manageCheckpoints(o = {}) {
    let lv;
    const rows = () => checkpoints().slice().reverse();
    lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 320 }, { key: 'created', label: 'Created', width: 150, type: 'date', render: r => U.fmtDateTime(r.created) }], rows, getId: r => r.id, icon: () => IC.checkpoint });
    lv.el.style.height = '200px';
    const sel = () => lv.selected()[0];
    const content = h('div.w32', h('div', { style: 'margin-bottom:6px' }, `Checkpoints of ${VM} (kept in this browser, up to 8):`), lv.el,
      h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        WS.ui.f.button('New...', async () => { await checkpoint(); lv.refresh(); }),
        WS.ui.f.button('Apply...', async () => { const c = sel(); if (c && await revert({ id: c.id })) frame.close('Close'); }),
        WS.ui.f.button('Delete', async () => { const c = sel(); if (!c) return; if (await confirmBox('Delete Checkpoint', `Are you sure you want to delete the checkpoint "${c.name}"?`, 'Delete')) { WS.store.deleteCheckpoint(c.id); lv.refresh(); paint(); } })));
    let frame;
    return WS.ui.dialog({ title: `Checkpoints - ${VM}`, width: 540, className: 'w32-dlg', content, buttons: [{ label: 'Close', primary: true, cancel: true }], onCreate: f => { frame = f; if (o.onCreate) o.onCreate({ frame, list: lv }); } });
  }

  /* ---------------- export / import the whole lab (instructors) ---------------- */
  function exportState() {
    WS.store.save();
    const text = WS.store.exportJSON();
    try {
      const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: `ws2025lab-${WS.sys.name}-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch (e) { /* the text is still returned */ }
    return text;
  }
  async function importState(text) {
    try { JSON.parse(text); } catch (e) { await WS.ui.msgbox({ title: 'Import lab state', icon: 'error', message: 'This file is not a lab state file.' }); return false; }
    powerCut('checkpoint');
    try { WS.store.importJSON(text); } catch (e) { await WS.ui.msgbox({ title: 'Import lab state', icon: 'error', message: 'This file could not be imported.', detail: e.message }); return false; }
    delete WS.state.system.powerLoss;
    WS.store.save();
    WS.shell.boot();
    paint();
    return true;
  }
  function pickImport() {
    const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.remove();
      if (!f) return;
      if (await confirmBox('Import lab state', `Replace the whole lab with "${f.name}"?\n\nThe current state of ${VM} will be lost and it will restart.`, 'Import')) importState(await f.text());
    });
    document.body.appendChild(file);
    file.click();
  }

  /* ---------------- fullscreen + keyboard lock ---------------- */
  async function fullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
      await document.documentElement.requestFullscreen();
      // Chromium: send the Windows key, Alt+Tab and Esc to the VM instead of the host (hold Esc to leave fullscreen)
      if (navigator.keyboard && navigator.keyboard.lock) { try { await navigator.keyboard.lock(); } catch (e) { /* not supported */ } }
      return true;
    } catch (e) { return false; }
  }

  /** Clipboard > Type clipboard text: types the host clipboard into whatever has focus in the VM. */
  async function typeClipboard() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { await WS.ui.msgbox({ title: 'Type clipboard text', icon: 'warning', message: 'The browser did not allow reading the clipboard.' }); return false; }
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (el && el.isContentEditable) { document.execCommand('insertText', false, text); return true; }
    return false;
  }

  function about() {
    return WS.ui.msgbox({ title: 'About Virtual Machine Connection', icon: 'info', width: 460, message: 'Windows Server 2025 Lab Simulator',
      detail: 'A browser-based training mock of Windows Server 2025 for lab and study use. It is not affiliated with, endorsed by, or sponsored by Microsoft. Windows, Windows Server and Hyper-V are trademarks of the Microsoft group of companies.' });
  }

  /* ---------------- the bar ---------------- */
  let bar, statusEl, btns = {};
  function menus() {
    const st = state(), cps = checkpoints().length;
    return {
      '&File': [
        { label: '&Checkpoints...', action: () => manageCheckpoints() },
        { separator: true },
        { label: '&Export lab state...', action: exportState },
        { label: '&Import lab state...', action: pickImport },
        { separator: true },
        { label: 'E&xit', disabled: true }
      ],
      '&Action': [
        { label: 'Ctrl+Alt+&Delete', shortcut: 'Ctrl+Alt+End', disabled: st !== 'Running', action: cad },
        { separator: true },
        { label: '&Start', disabled: !(st === 'Off' || st === 'Saved'), action: start },
        { label: '&Turn Off...', disabled: st === 'Off', action: () => turnOff() },
        { label: 'S&hut Down...', disabled: st !== 'Running', action: () => shutDown() },
        { label: 'Sa&ve', disabled: st !== 'Running', action: save },
        st === 'Paused' ? { label: '&Resume', action: resume } : { label: '&Pause', disabled: st !== 'Running', action: pause },
        { label: 'R&eset...', disabled: st === 'Off' || st === 'Saved', action: () => reset() },
        { separator: true },
        { label: '&Checkpoint...', action: () => checkpoint() },
        { label: 'Re&vert...', disabled: !cps, action: () => revert() }
      ],
      '&Clipboard': [{ label: '&Type clipboard text', disabled: st !== 'Running', action: typeClipboard }],
      '&View': [
        { label: '&Full Screen Mode', checked: !!document.fullscreenElement, action: fullscreen },
        { label: '&Toolbar', checked: !prefs().collapsed, action: () => collapse(!prefs().collapsed) }
      ],
      '&Help': [{ label: '&About Virtual Machine Connection', action: about }]
    };
  }
  function build() {
    if (document.getElementById('hostbar')) return;
    const menuEls = Object.keys(menus()).map(k => {
      const b = h('button.hb-menu', { dataset: { menu: k.replace('&', '') } }, h('span', { html: k.replace(/&(.)/, '<u>$1</u>') }));
      b.addEventListener('click', e => { e.stopPropagation(); WS.ui.popupMenu(b, menus()[k]); });
      return b;
    });
    const tool = (id, icon, title, fn) => (btns[id] = h('button.hb-tool', { html: icon, title, dataset: { tool: id }, onClick: e => { e.stopPropagation(); fn(); } }));
    statusEl = h('span.hb-status');
    bar = h('div', { id: 'hostbar' },
      h('span.hb-vm', { html: IC.vm }), h('span.hb-title', `${VM} on ${HOST}`),
      h('div.hb-menus', ...menuEls),
      h('div.hb-tools',
        tool('cad', IC.cad, 'Ctrl+Alt+Delete (Ctrl+Alt+End)', cad), h('span.hb-sep'),
        tool('start', IC.start, 'Start', start), tool('off', IC.off, 'Turn Off', () => turnOff()), tool('shutdown', IC.shutdown, 'Shut Down', () => shutDown()),
        tool('save', IC.save, 'Save', save), tool('pause', IC.pause, 'Pause', () => (vmState === 'Paused' ? resume() : pause())), tool('reset', IC.reset, 'Reset', () => reset()), h('span.hb-sep'),
        tool('checkpoint', IC.checkpoint, 'Checkpoint', () => checkpoint()), tool('revert', IC.revert, 'Revert', () => revert()), h('span.hb-sep'),
        tool('full', IC.full, 'Full Screen Mode', fullscreen)),
      h('span.hb-spacer'), statusEl,
      h('button.hb-collapse', { html: IC.collapse, title: 'Hide the toolbar', onClick: () => collapse(true) }));
    const tab = h('button', { id: 'hostbar-tab', html: IC.expand, title: `${VM} on ${HOST} - show the Virtual Machine Connection toolbar`, onClick: () => collapse(false) });
    document.body.insertBefore(tab, document.body.firstChild);
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('has-hostbar');
    collapse(!!prefs().collapsed, true);
    paint();
    setInterval(paint, 1000);
  }
  function collapse(on, quiet) {
    document.body.classList.toggle('hostbar-collapsed', !!on);
    if (!quiet) savePrefs({ collapsed: !!on });
    window.dispatchEvent(new Event('resize'));
  }
  function paint() {
    if (!bar) return;
    const st = state();
    statusEl.textContent = 'Status: ' + st;
    const dis = { cad: st !== 'Running' || !(WS.session.loggedIn || WS.shell.isLocked()), start: !(st === 'Off' || st === 'Saved'), off: st === 'Off', shutdown: st !== 'Running', save: st !== 'Running',
      pause: !(st === 'Running' || st === 'Paused'), reset: st === 'Off' || st === 'Saved', revert: !checkpoints().length, checkpoint: false, full: false };
    for (const [k, b] of Object.entries(btns)) b.disabled = !!dis[k];
    btns.pause.title = st === 'Paused' ? 'Resume' : 'Pause';
    btns.pause.classList.toggle('on', st === 'Paused');
  }

  WS.host = { VM, HOST, state, cad, start, turnOff, shutDown, save, pause, resume, reset, checkpoint, revert, restoreState, checkpoints, manageCheckpoints, exportState, importState, fullscreen, typeClipboard, collapse, about, paint };
  build();
})();
