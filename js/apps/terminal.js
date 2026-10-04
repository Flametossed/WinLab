/* Windows Terminal host: independent PowerShell 5.1 and CMD sessions per tab. */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h;
  function launch(args = {}) {
    const win = WS.wm.create({ app: 'terminal', title: 'Windows Terminal', icon: WS.icons.powershell, width: 1000, height: 620 });
    win.el.classList.add('terminal-window');
    const tabs = [], strip = h('div.term-tabs', { role: 'tablist', 'aria-label': 'Terminal profiles' });
    const pages = h('div.term-pages');
    let active = null, closed = false;
    function select(tab) {
      active = tab;
      for (const t of tabs) {
        t.button.setAttribute('aria-selected', String(t === tab));
        t.page.hidden = t !== tab;
      }
      win.setTitle(tab.console.title || tab.title);
      tab.console.focus();
    }
    function stop(tab) {
      tab.session.exited = true;
      tab.session.cancelled = true;
      tab.console.dispose();
    }
    function remove(tab) {
      const i = tabs.indexOf(tab);
      if (i < 0 || closed) return;
      stop(tab);
      tabs.splice(i, 1);
      tab.header.remove(); tab.page.remove();
      if (!tabs.length) win.close();
      else if (active === tab) select(tabs[Math.min(i, tabs.length - 1)]);
    }
    function add(kind = 'ps') {
      if (closed) return;
      const title = kind === 'cmd' ? 'Administrator: Command Prompt' : 'Administrator: Windows PowerShell';
      const io = new WS.term.Console({ scheme: kind });
      const session = kind === 'cmd' ? new WS.term.CmdSession({ console: io }) : new WS.ps.Session({ console: io });
      const tab = { title, kind, key: WS.util.uid('tab'), console: io, session, page: h('div.term-page', { role: 'tabpanel' }, io.el) };
      tab.button = h('button.term-tab', { role: 'tab', onClick: () => select(tab) }, h('span.term-profile', kind === 'cmd' ? '>_' : 'PS'), kind === 'cmd' ? 'Command Prompt' : 'Windows PowerShell');
      tab.header = h('div.term-tab-wrap', tab.button, h('button.term-tab-close', { title: 'Close tab', 'aria-label': 'Close ' + title, onClick: () => remove(tab) }, '×'));
      tab.header.classList.toggle('term-tab-cmd', kind === 'cmd');
      tabs.push(tab); strip.insertBefore(tab.header, plus); pages.appendChild(tab.page);
      // each tab is its own powershell.exe / cmd.exe process (Task Manager, Get-Process, $PID)
      if (WS.proc) session.pid = tab.pid = WS.proc.pidFor('tab:' + tab.key);
      io.onTitle = t => { if (active === tab && !closed) win.setTitle(t); };
      select(tab);
      session.banner();
      tab.done = session.repl().catch(e => { if (!closed && tabs.includes(tab)) { io.writeLine('Terminal error: ' + e.message, { fg: 'Red' }); console.error(e); } }).finally(() => remove(tab));
      return tab;
    }
    const plus = h('button.term-add', { title: 'New PowerShell tab (Ctrl+Shift+T)', 'aria-label': 'New PowerShell tab', onClick: () => add('ps') }, '+');
    const dropdown = h('button.term-dropdown', { title: 'Select profile', 'aria-label': 'Select terminal profile', onClick: () => WS.ui.popupMenu(dropdown, [
      { label: 'Windows PowerShell', action: () => add('ps') },
      { label: 'Command Prompt', action: () => add('cmd') }
    ]) }, '⌄');
    const copy = h('button.term-clipboard', { title: 'Copy selected text (Ctrl+Shift+C)', onPointerdown: e => e.preventDefault(), onClick: () => active.console.copy() }, 'Copy');
    const paste = h('button.term-clipboard', { title: 'Paste (Ctrl+V or Ctrl+Shift+V)', onPointerdown: e => e.preventDefault(), onClick: () => active.console.paste() }, 'Paste');
    strip.append(plus, dropdown, copy, paste); win.body.append(strip, pages);
    win.body.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); add('ps'); }
      else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); remove(active); }
      else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); select(tabs[(tabs.indexOf(active) + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]); }
    });
    win.onClose(() => { closed = true; tabs.forEach(stop); tabs.length = 0; });
    win.terminal = { tabs, add, select, remove, get active() { return active; } };
    win.procs = () => tabs.map(t => ({ key: t.key, kind: t.kind, title: t.console.title || t.title, close: () => remove(t) }));
    add(args.profile === 'cmd' ? 'cmd' : 'ps');
    return win;
  }
  for (const [id, name, profile, keywords] of [
    ['terminal', 'Windows Terminal', 'ps', ['terminal', 'wt', 'console']],
    ['powershell', 'Windows PowerShell', 'ps', ['powershell', 'ps', 'console', 'sconfig']],
    ['cmd', 'Command Prompt', 'cmd', ['cmd', 'command', 'console']]
  ]) WS.apps.register({ id, name, icon: WS.icons.powershell, keywords, launch: args => launch({ ...args, profile: id === 'terminal' ? args.profile : profile }) });
})();
