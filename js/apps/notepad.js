/* Notepad (the classic Win32 Notepad that Windows Server ships): open, edit and save text files through WS.fs, so a file
 * saved here is what `type`, Get-Content and the lab's `file` check read. File / Edit / Format / View / Help menus,
 * "*name - Notepad" while modified, the "Do you want to save changes" prompt (on New, Open, Exit and the X button),
 * Find, Go To, Time/Date (F5), Word Wrap and the status bar.
 *   WS.apps.launch('notepad', { path }) -> win; win.notepad = { text(), setText(t), path(), dirty(), save(), saveAs(path), open(path), newFile(), exit() } */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, F = WS.ui.f;
  const ICON = '<svg viewBox="0 0 16 16"><rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#3a7bd5"/><path d="M2.5 4h11" stroke="#3a7bd5" stroke-width="1.6"/><path d="M4.5 7h7M4.5 9h7M4.5 11h5" stroke="#8a97a6"/></svg>';
  const FILTERS = [{ label: 'Text Documents (*.txt)', ext: ['.txt'] }, { label: 'All Files (*.*)', ext: ['*'] }];

  function launch(args = {}) {
    const win = WS.wm.create({ app: 'notepad', title: 'Untitled - Notepad', icon: ICON, width: 760, height: 520 });
    let path = null, saved = '', wrap = false, statusOn = true, lastFind = '';
    const ta = h('textarea.np-text', { spellcheck: false, wrap: 'off' });
    const status = h('div.np-status');
    const name = () => (path ? path.split('\\').pop() : 'Untitled');
    const dirty = () => ta.value !== saved;
    const paintTitle = () => win.setTitle(`${dirty() ? '*' : ''}${name()} - Notepad`);
    const paintStatus = () => {
      const before = ta.value.slice(0, ta.selectionStart), ln = before.split('\n').length, col = before.length - before.lastIndexOf('\n');
      status.textContent = `Ln ${ln}, Col ${col}      100%      Windows (CRLF)      UTF-8`;
      status.style.display = statusOn ? '' : 'none';
    };
    const err = (m, icon = 'error') => WS.ui.msgbox({ title: 'Notepad', icon, message: m });
    function load(p) {
      try { ta.value = WS.fs.readFile(p).replace(/\r\n/g, '\n'); } catch (e) { err(e.code === 'NotFound' || e.code === 'PathNotFound' ? `${p}\nCannot find the ${p} file.\n\nCheck the file name and try again.` : e.message); return false; }
      path = WS.fs.full(p); saved = ta.value; ta.selectionStart = ta.selectionEnd = 0; paintTitle(); paintStatus();
      return true;
    }
    function write(p) {
      try { WS.fs.writeFile(p, ta.value.replace(/\n/g, '\r\n')); }
      catch (e) { err(e.code === 'AccessDenied' ? `You don't have permission to save in this location. Contact the administrator to obtain permission.` : e.message); return false; }
      path = WS.fs.full(p); saved = ta.value; paintTitle();
      return true;
    }
    /** "Do you want to save changes to <name>?" -> true when it is safe to continue. */
    async function confirmDiscard() {
      if (!dirty()) return true;
      const a = await WS.ui.msgbox({ title: 'Notepad', icon: null, message: `Do you want to save changes to ${path || 'Untitled'}?`, buttons: ['Save', "Don't Save", 'Cancel'] });
      if (a === 'Cancel' || a == null) return false;
      return a === "Don't Save" ? true : save();
    }
    async function saveAs(target) {
      const p = target || await WS.ui.filePicker({ mode: 'save', title: 'Save As', path: path ? path.replace(/\\[^\\]+$/, '') : 'C:\\Users\\Administrator\\Documents', defaultName: path ? name() : '*.txt', filters: FILTERS });
      if (!p) return false;
      return write(/\.[^\\.]+$/.test(p) ? p : p + '.txt');
    }
    const save = () => (path ? write(path) : saveAs());
    async function open(target) {
      if (!(await confirmDiscard())) return false;
      const p = target || await WS.ui.filePicker({ mode: 'open', title: 'Open', path: path ? path.replace(/\\[^\\]+$/, '') : 'C:\\Users\\Administrator\\Documents', filters: FILTERS });
      return p ? load(p) : false;
    }
    async function newFile() { if (!(await confirmDiscard())) return false; path = null; ta.value = saved = ''; paintTitle(); paintStatus(); return true; }
    async function exit() { if (await confirmDiscard()) { win.close(); return true; } return false; }
    function insert(text) { const s = ta.selectionStart, e = ta.selectionEnd; ta.value = ta.value.slice(0, s) + text + ta.value.slice(e); ta.selectionStart = ta.selectionEnd = s + text.length; ta.dispatchEvent(new Event('input')); }
    async function find() {
      const v = await WS.ui.inputBox({ title: 'Find', prompt: 'Find what:', value: lastFind, okLabel: 'Find Next' });
      if (v == null || !v) return;
      lastFind = v; findNext();
    }
    function findNext() {
      if (!lastFind) return find();
      const i = ta.value.toLowerCase().indexOf(lastFind.toLowerCase(), ta.selectionEnd);
      if (i < 0) { err(`Cannot find "${lastFind}"`, 'info'); return; }
      ta.focus(); ta.setSelectionRange(i, i + lastFind.length); paintStatus();
    }
    async function goTo() {
      const lines = ta.value.split('\n');
      const v = await WS.ui.inputBox({ title: 'Go To Line', prompt: 'Line number:', value: '1', okLabel: 'Go To',
        validate: x => (+x >= 1 && +x <= lines.length && Number.isInteger(+x) ? null : 'The line number is beyond the total number of lines') });
      if (v == null) return;
      const pos = lines.slice(0, +v - 1).reduce((a, l) => a + l.length + 1, 0);
      ta.focus(); ta.setSelectionRange(pos, pos); paintStatus();
    }
    const stamp = () => `${U.fmtTime(new Date())} ${U.fmtDate ? U.fmtDate(new Date()) : new Date().toLocaleDateString('en-US')}`;
    const bar = WS.ui.menuBar([
      { label: '&File', items: () => [
        { label: '&New', shortcut: 'Ctrl+N', action: newFile }, { label: 'New &Window', shortcut: 'Ctrl+Shift+N', action: () => launch() },
        { label: '&Open...', shortcut: 'Ctrl+O', action: () => open() }, { label: '&Save', shortcut: 'Ctrl+S', action: () => save() }, { label: 'Save &As...', shortcut: 'Ctrl+Shift+S', action: () => saveAs() },
        { separator: true }, { label: 'Page Set&up...', disabled: true }, { label: '&Print...', shortcut: 'Ctrl+P', disabled: true }, { separator: true }, { label: 'E&xit', action: exit }] },
      { label: '&Edit', items: () => [
        { label: '&Undo', shortcut: 'Ctrl+Z', action: () => { ta.focus(); document.execCommand('undo'); } }, { separator: true },
        { label: 'Cu&t', shortcut: 'Ctrl+X', disabled: ta.selectionStart === ta.selectionEnd, action: () => { ta.focus(); document.execCommand('cut'); } },
        { label: '&Copy', shortcut: 'Ctrl+C', disabled: ta.selectionStart === ta.selectionEnd, action: () => { ta.focus(); document.execCommand('copy'); } },
        { label: '&Paste', shortcut: 'Ctrl+V', action: () => { ta.focus(); document.execCommand('paste'); } },
        { label: 'De&lete', shortcut: 'Del', disabled: ta.selectionStart === ta.selectionEnd, action: () => insert('') }, { separator: true },
        { label: '&Find...', shortcut: 'Ctrl+F', action: find }, { label: 'Find &Next', shortcut: 'F3', action: findNext }, { label: '&Go To...', shortcut: 'Ctrl+G', disabled: wrap, action: goTo }, { separator: true },
        { label: 'Select &All', shortcut: 'Ctrl+A', action: () => { ta.focus(); ta.select(); } }, { label: 'Time/&Date', shortcut: 'F5', action: () => insert(stamp()) }] },
      { label: 'F&ormat', items: () => [{ label: '&Word Wrap', checked: wrap, action: () => { wrap = !wrap; ta.wrap = wrap ? 'soft' : 'off'; ta.classList.toggle('wrap', wrap); } }, { label: '&Font...', disabled: true }] },
      { label: '&View', items: () => [{ label: '&Status Bar', checked: statusOn, action: () => { statusOn = !statusOn; paintStatus(); } }] },
      { label: '&Help', items: () => [{ label: '&About Notepad', action: () => WS.ui.msgbox({ title: 'About Notepad', icon: 'info', message: 'Microsoft Windows\nNotepad', detail: 'Windows Server 2025 Lab Simulator - a training mock-up, not affiliated with Microsoft.' }) }] }
    ]);
    win.body.appendChild(h('div.np', bar.el, ta, status));
    ta.addEventListener('input', () => { paintTitle(); paintStatus(); });
    ['keyup', 'click'].forEach(ev => ta.addEventListener(ev, paintStatus));
    ta.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (e.key === 'F5') { e.preventDefault(); insert(stamp()); }
      else if (e.key === 'F3') { e.preventDefault(); findNext(); }
      else if (e.ctrlKey && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); }
      else if (e.ctrlKey && k === 'o') { e.preventDefault(); open(); }
      else if (e.ctrlKey && k === 'n') { e.preventDefault(); if (e.shiftKey) launch(); else newFile(); }
      else if (e.ctrlKey && k === 'f') { e.preventDefault(); find(); }
      else if (e.ctrlKey && k === 'g') { e.preventDefault(); goTo(); }
    });
    win.canClose = confirmDiscard;
    win.notepad = { text: () => ta.value, setText: t => { ta.value = t; ta.dispatchEvent(new Event('input')); }, path: () => path, dirty, save, saveAs, open, newFile, exit };
    if (args.path) { if (!WS.fs.exists(args.path)) path = WS.fs.full(args.path); else load(args.path); }
    paintTitle(); paintStatus();
    setTimeout(() => ta.focus(), 30);
    return win;
  }

  WS.apps.register({ id: 'notepad', name: 'Notepad', icon: ICON, launch, keywords: ['notepad', 'text editor', 'txt'] });
})();
