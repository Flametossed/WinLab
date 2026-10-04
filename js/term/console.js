/* Terminal console: the text surface shells write to and read lines from.
 *   new WS.term.Console({ scheme: 'ps' | 'cmd' })      a DOM console (Windows Terminal look)
 *   new WS.term.TextConsole({ inputs: [...] })          the same API with no DOM, for tests
 * API (both): write(text, style), writeLine(text, style), readLine({prompt, secure, history, complete, highlight}),
 *   readKey(), clear(), cols(), setProgress({activity, status, percent} | null), onInterrupt(fn), setTitle(t), text()
 * style: { fg, bg } using console colour names (Black, DarkBlue, DarkGreen, DarkCyan, DarkRed, DarkMagenta,
 *   DarkYellow, Gray, DarkGray, Blue, Green, Cyan, Red, Magenta, Yellow, White).
 * readLine resolves the typed string, or null when Ctrl+C cancels the line.
 * complete(line, cursor, reverse) -> { line, cursor } | null   (Tab / Shift+Tab)
 * highlight(line) -> [{ text, fg }]   (PSReadLine-style colouring of the input line) */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h;

  /** Windows Terminal "Campbell" colours, indexed by console colour name. */
  const COLORS = {
    Black: '#0C0C0C', DarkBlue: '#0037DA', DarkGreen: '#13A10E', DarkCyan: '#3A96DD', DarkRed: '#C50F1F', DarkMagenta: '#881798',
    DarkYellow: '#C19C00', Gray: '#CCCCCC', DarkGray: '#767676', Blue: '#3B78FF', Green: '#16C60C', Cyan: '#61D6D6',
    Red: '#E74856', Magenta: '#B4009E', Yellow: '#F9F1A5', White: '#F2F2F2'
  };
  const SCHEMES = { ps: { bg: '#012456', fg: '#CCCCCC' }, cmd: { bg: '#0C0C0C', fg: '#CCCCCC' } };
  const MAX_SPANS = 4000;
  const selections = new Set();
  function paintSelections() {
    if (!window.Highlight || !window.CSS || !CSS.highlights) return;
    const ranges = [...selections].map(io => io.selectionRange).filter(range => range && range.startContainer.isConnected && range.endContainer.isConnected && range.toString());
    if (ranges.length) CSS.highlights.set('terminal-selection', new Highlight(...ranges));
    else CSS.highlights.delete('terminal-selection');
  }

  class Console {
    constructor(o = {}) {
      this.scheme = SCHEMES[o.scheme] || SCHEMES.ps;
      this.el = h('div.term', { style: { background: this.scheme.bg, color: this.scheme.fg } });
      this.progressEl = h('div.term-progress', { style: { display: 'none' } });
      this.out = h('div.term-out');
      this.lineEl = h('div.term-line');
      this.scroll = h('div.term-scroll', { tabIndex: 0, 'aria-label': 'Terminal text' }, this.out, this.lineEl);
      this.kbd = h('textarea.term-kbd', { spellcheck: false, autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Terminal input' });
      this.el.appendChild(this.progressEl);
      this.el.appendChild(this.scroll);
      this.el.appendChild(this.kbd);
      this.reading = null;
      this.interruptHandlers = [];
      this.title = '';
      this.selectionRange = null;
      this.draggingSelection = false;
      this.scroll.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        this.clearSelection();
        this.draggingSelection = true;
      });
      this.selectionChanged = () => this.captureSelection();
      this.selectionReleased = e => {
        if (e.button !== 0 || !this.draggingSelection) return;
        this.captureSelection();
        this.draggingSelection = false;
        if (this.selectedText()) this.focus();
      };
      document.addEventListener('selectionchange', this.selectionChanged);
      document.addEventListener('pointerup', this.selectionReleased);
      this.el.addEventListener('mouseup', () => { if (this.selectedText()) this.scroll.focus({ preventScroll: true }); else this.focus(); });
      this.el.addEventListener('contextmenu', e => { e.preventDefault(); WS.ui.contextMenu(e.clientX, e.clientY, this.clipboardMenu()); });
      this.el.addEventListener('keydown', e => this.onKey(e));
      this.el.addEventListener('paste', e => {
        if (!e.clipboardData) return;
        e.preventDefault(); this.acceptPaste(e.clipboardData.getData('text'));
      });
      this.kbd.addEventListener('input', () => { if (this.kbd.value) { this.insert(this.kbd.value); this.kbd.value = ''; } });
    }

    focus(input = false) {
      // Focusing the hidden textarea collapses the browser's visible selection.
      // Keep focus on the text surface while selected output is being inspected.
      (input || !this.selectedText() ? this.kbd : this.scroll).focus({ preventScroll: true });
    }
    dispose() {
      this.disposed = true;
      const r = this.reading;
      this.reading = null;
      if (r) r.resolve(null);
      this.interruptHandlers = [];
      document.removeEventListener('selectionchange', this.selectionChanged);
      document.removeEventListener('pointerup', this.selectionReleased);
      this.clearSelection();
      if (this.clipboardDialog) this.clipboardDialog.close('Cancel');
      WS.util.clear(this.lineEl);
    }
    setTitle(t) { this.title = t; if (this.onTitle) this.onTitle(t); }
    onInterrupt(fn) { this.interruptHandlers.push(fn); return () => { this.interruptHandlers = this.interruptHandlers.filter(f => f !== fn); }; }

    /* ---------------- output ---------------- */
    write(text, style) {
      if (text == null || text === '') return;
      const span = document.createElement('span');
      span.textContent = String(text);
      if (style) {
        if (style.fg) span.style.color = COLORS[style.fg] || style.fg;
        if (style.bg) span.style.background = COLORS[style.bg] || style.bg;
      }
      this.out.appendChild(span);
      while (this.out.childNodes.length > MAX_SPANS) this.out.removeChild(this.out.firstChild);
      this.scrollDown();
    }
    writeLine(text, style) { this.write((text == null ? '' : String(text)) + '\n', style); }
    clear() { this.clearSelection(); WS.util.clear(this.out); this.scroll.scrollTop = 0; }
    scrollDown() { this.scroll.scrollTop = this.scroll.scrollHeight; }
    /** All text written so far (tests and copy). */
    text() { return this.out.textContent; }
    cols() {
      if (!this._cw) {
        const probe = h('span', { style: 'visibility:hidden;position:absolute;white-space:pre' }, 'MMMMMMMMMM');
        this.out.appendChild(probe);
        this._cw = probe.getBoundingClientRect().width / 10 || 8;
        probe.remove();
      }
      const w = this.scroll.clientWidth - 16;
      return Math.max(40, Math.floor(w / this._cw) - 1) || 120;
    }
    setProgress(p) {
      if (!p) { this.progressEl.style.display = 'none'; return; }
      const width = Math.max(20, this.cols() - 12);
      const fill = Math.round(width * Math.max(0, Math.min(100, p.percent || 0)) / 100);
      this.progressEl.textContent = `${p.activity || ''}\n    ${p.status || ''}\n    [${'o'.repeat(fill)}${' '.repeat(width - fill)}]`;
      this.progressEl.style.display = '';
    }

    /* ---------------- input ---------------- */
    readLine(o = {}) {
      if (this.disposed) return Promise.resolve(null);
      return new Promise(resolve => {
        this.reading = { o, resolve, buf: '', cur: 0, hist: o.history ? o.history.slice() : [], hi: -1, saved: '' };
        this.renderInput();
        this.focus();
      });
    }
    readKey() {
      if (this.disposed) return Promise.resolve(null);
      return new Promise(resolve => { this.reading = { key: true, resolve }; this.focus(); });
    }
    insert(text) {
      const r = this.reading;
      if (!r || r.key) return;
      text = String(text).replace(/\r\n?/g, '\n');
      r.buf = r.buf.slice(0, r.cur) + text + r.buf.slice(r.cur);
      r.cur += text.length;
      r.compl = null;
      this.renderInput();
    }
    renderInput() {
      const r = this.reading;
      WS.util.clear(this.lineEl);
      if (!r || r.key) return;
      const o = r.o;
      if (o.prompt) this.lineEl.appendChild(h('span', o.promptStyle ? { style: { color: COLORS[o.promptStyle.fg] || o.promptStyle.fg } } : null, o.prompt));
      const shown = o.secure ? '*'.repeat(r.buf.length) : r.buf;
      const segs = !o.secure && o.highlight ? o.highlight(shown) : [{ text: shown }];
      // split the coloured segments around the cursor
      let pos = 0;
      for (const s of segs) {
        const start = pos, end = pos + s.text.length;
        const add = (t, cls) => { if (!t && !cls) return; const sp = h('span' + (cls ? '.' + cls : ''), t); if (s.fg) sp.style.color = COLORS[s.fg] || s.fg; this.lineEl.appendChild(sp); };
        if (r.cur >= start && r.cur < end) {
          add(s.text.slice(0, r.cur - start));
          add(s.text[r.cur - start] === '\n' ? ' ' : s.text[r.cur - start], 'term-cur');
          if (s.text[r.cur - start] === '\n') add('\n');
          add(s.text.slice(r.cur - start + 1));
        } else add(s.text);
        pos = end;
      }
      if (r.cur >= shown.length) this.lineEl.appendChild(h('span.term-cur', ' '));
      this.scrollDown();
    }
    finishLine(value, echo) {
      const r = this.reading;
      this.reading = null;
      WS.util.clear(this.lineEl);
      // echo the line into the scrollback with its colours, as the console leaves it
      if (r.o.prompt) this.write(r.o.prompt, r.o.promptStyle);
      if (echo != null) this.write(echo);
      else if (r.o.secure) this.write('*'.repeat(r.buf.length));
      else if (r.o.highlight) for (const s of r.o.highlight(r.buf)) this.write(s.text, s.fg ? { fg: s.fg } : null);
      else this.write(r.buf);
      this.write('\n');
      if (value != null && r.o.history && !r.o.secure && value.trim() && r.o.history[r.o.history.length - 1] !== value) r.o.history.push(value);
      r.resolve(value);
    }
    onKey(e) {
      const r = this.reading;
      const k = e.key;
      if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'c') { e.preventDefault(); this.copy(); return; }
      if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'v') { e.preventDefault(); this.paste(); return; }
      if (e.ctrlKey && !e.altKey && k.toLowerCase() === 'v') {
        // Focus the editable target before the browser's native paste action, which
        // works even when script-based clipboard access is denied.
        this.focus(true); return;
      }
      if (e.ctrlKey && (k === 'c' || k === 'C')) {
        const sel = this.selectedText();
        if (sel) { e.preventDefault(); this.copy(sel); return; }
        e.preventDefault();
        if (r && !r.key) { this.finishLine(null, r.buf + '^C'); return; }
        if (r && r.key) { this.reading = null; r.resolve('\u0003'); return; }
        this.write('^C\n');
        this.interruptHandlers.forEach(fn => fn());
        return;
      }
      const editing = ['Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(k)
        || (k === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey)
        || (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey);
      if (editing && this.selectedText()) {
        this.clearSelection();
        this.focus(true);
        // Escape dismisses a selection before clearing a pending command.
        if (k === 'Escape') { e.preventDefault(); return; }
      }
      if (!r) { if (k.length === 1 || k === 'Enter') e.preventDefault(); return; }
      if (r.key) { if (['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return; e.preventDefault(); this.reading = null; r.resolve(k); return; }
      const word = (dir) => {
        let i = r.cur;
        if (dir < 0) { while (i > 0 && r.buf[i - 1] === ' ') i--; while (i > 0 && r.buf[i - 1] !== ' ') i--; }
        else { while (i < r.buf.length && r.buf[i] !== ' ') i++; while (i < r.buf.length && r.buf[i] === ' ') i++; }
        return i;
      };
      let handled = true;
      switch (k) {
        case 'Enter':
          if (e.shiftKey && r.o.multiline) { this.insert('\n'); break; }
          this.finishLine(r.buf); return;
        case 'Backspace':
          if (r.cur > 0) { const to = e.ctrlKey ? word(-1) : r.cur - 1; r.buf = r.buf.slice(0, to) + r.buf.slice(r.cur); r.cur = to; }
          break;
        case 'Delete': if (r.cur < r.buf.length) r.buf = r.buf.slice(0, r.cur) + r.buf.slice(r.cur + 1); break;
        case 'ArrowLeft': r.cur = e.ctrlKey ? word(-1) : Math.max(0, r.cur - 1); break;
        case 'ArrowRight': r.cur = e.ctrlKey ? word(1) : Math.min(r.buf.length, r.cur + 1); break;
        case 'Home': r.cur = 0; break;
        case 'End': r.cur = r.buf.length; break;
        case 'Escape': r.buf = ''; r.cur = 0; break;
        case 'ArrowUp': case 'ArrowDown': {
          if (!r.hist.length || r.o.secure) break;
          if (r.hi === -1) { r.saved = r.buf; r.hi = r.hist.length; }
          r.hi = Math.max(0, Math.min(r.hist.length, r.hi + (k === 'ArrowUp' ? -1 : 1)));
          r.buf = r.hi === r.hist.length ? r.saved : r.hist[r.hi];
          r.cur = r.buf.length;
          break;
        }
        case 'Tab': {
          if (e.ctrlKey || e.altKey || e.metaKey) return; // host tab-switch shortcuts
          if (!r.o.complete) break;
          const res = r.o.complete(r.buf, r.cur, e.shiftKey, r);
          if (res) { r.buf = res.line; r.cur = res.cursor; }
          this.renderInput();
          e.preventDefault();
          return;
        }
        default:
          if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.insert(k); return; }
          if (e.ctrlKey && (k === 'v' || k === 'V')) return; // let the paste event fire
          handled = false;
      }
      if (handled) { e.preventDefault(); if (k !== 'Tab') r.compl = null; this.renderInput(); }
    }
    captureSelection() {
      if (this.disposed) return;
      const selection = window.getSelection();
      // Read text from the Range: some Firefox profiles return '' from String(selection) for a real selection.
      if (!selection || !selection.rangeCount || selection.isCollapsed) return;
      if (!this.draggingSelection && !this.scroll.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0).cloneRange();
      if (!range.intersectsNode(this.scroll)) return;
      // A drag may end in padding or outside the console: retain just its terminal text.
      const bounds = document.createRange(); bounds.selectNodeContents(this.scroll);
      if (range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) range.setStart(bounds.startContainer, bounds.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) range.setEnd(bounds.endContainer, bounds.endOffset);
      if (!range.toString()) return;
      this.selectionRange = range;
      selections.add(this);
      paintSelections();
    }
    clearSelection() {
      this.selectionRange = null;
      selections.delete(this);
      paintSelections();
      const selection = window.getSelection();
      if (selection && (this.scroll.contains(selection.anchorNode) || this.scroll.contains(selection.focusNode))) selection.removeAllRanges();
    }
    selectedText() {
      this.captureSelection();
      const range = this.selectionRange;
      return range && range.startContainer.isConnected && range.endContainer.isConnected ? range.toString() : '';
    }
    selectAll() {
      const range = document.createRange();
      range.selectNodeContents(this.scroll);
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      this.captureSelection();
      this.scroll.focus({ preventScroll: true });
    }
    clipboardMenu() {
      // Menus may change focus; capture the selection before they open.
      const text = this.selectedText();
      return [
        { label: '&Copy', shortcut: 'Ctrl+Shift+C', disabled: !text, action: () => this.copy(text) },
        { label: '&Paste', shortcut: 'Ctrl+V', disabled: !this.reading || this.reading.key, action: () => this.paste() },
        { separator: true },
        { label: 'Select &all', action: () => this.selectAll() }
      ];
    }
    async clipboardBox(mode, text = '') {
      const input = h('textarea.inp', { rows: 7, value: text, readOnly: mode === 'copy', 'aria-label': mode === 'copy' ? 'Text to copy' : 'Text to paste', style: 'width:100%;resize:vertical;user-select:text' });
      const label = mode === 'copy' ? 'Copy terminal text' : 'Paste into terminal';
      let frame;
      const result = await WS.ui.dialog({
        title: label, width: 520,
        content: h('div.w32', h('p', mode === 'copy' ? 'Press Ctrl+C to copy this text.' : 'Press Ctrl+V in the box, then choose Paste. The command will wait for Enter.'), input),
        buttons: mode === 'copy' ? [{ label: 'Close', primary: true, cancel: true }] : [{ label: 'Paste', primary: true }, { label: 'Cancel', cancel: true }],
        onCreate: f => {
          frame = f; this.clipboardDialog = f;
          if (mode === 'copy') setTimeout(() => {
            if (this.clipboardDialog === frame) { input.focus(); input.select(); }
          }, 40);
        }
      });
      if (this.clipboardDialog === frame) this.clipboardDialog = null;
      return result === 'Paste' ? input.value : null;
    }
    async copy(text = this.selectedText()) {
      if (!text || this.disposed) return;
      try { await navigator.clipboard.writeText(text); return; } catch (e) { /* Try the user-activated copy fallback. */ }
      if (this.disposed) return;
      const input = h('textarea', { value: text, style: 'position:fixed;left:-10000px;top:0', 'aria-label': 'Copy terminal selection' });
      const selection = window.getSelection();
      const ranges = this.selectionRange ? [this.selectionRange.cloneRange()] : [];
      const focused = document.activeElement;
      document.body.appendChild(input); input.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch (e) { /* Show the text for manual copy. */ }
      input.remove();
      if (focused && focused.isConnected) focused.focus({ preventScroll: true });
      selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range));
      if (!copied && !this.disposed) {
        await this.clipboardBox('copy', text);
        if (!this.disposed) {
          selection.removeAllRanges();
          ranges.filter(range => range.startContainer.isConnected && range.endContainer.isConnected).forEach(range => selection.addRange(range));
          this.focus();
        }
      }
    }
    acceptPaste(text) {
      if (this.disposed || !this.reading || this.reading.key) return;
      this.clearSelection();
      this.insert(text); this.focus();
    }
    async paste() {
      const reading = this.reading;
      if (!reading || reading.key || this.disposed || this.pasting) return;
      this.pasting = true;
      try {
        let text;
        try { text = await navigator.clipboard.readText(); }
        catch (e) { if (this.disposed) return; text = await this.clipboardBox('paste'); }
        if (text !== null && this.reading === reading) this.acceptPaste(text);
      } finally { this.pasting = false; }
    }
  }

  /** Same API without a DOM: tests queue input lines and read the text back. */
  class TextConsole {
    constructor(o = {}) {
      this.buf = '';
      this.inputs = (o.inputs || []).slice();
      this.width = o.cols || 120;
      this.progress = null;
      this.interruptHandlers = [];
      this.title = '';
      this.prompts = [];
    }
    write(text) { if (text != null) this.buf += String(text); }
    writeLine(text) { this.write((text == null ? '' : text) + '\n'); }
    clear() { this.buf = ''; }
    text() { return this.buf; }
    cols() { return this.width; }
    setProgress(p) { this.progress = p; if (p) this.lastProgress = p; }
    setTitle(t) { this.title = t; }
    onInterrupt(fn) { this.interruptHandlers.push(fn); return () => {}; }
    focus() {}
    readLine(o = {}) {
      this.prompts.push(o.prompt || '');
      const v = this.inputs.length ? this.inputs.shift() : null;
      this.write((o.prompt || '') + (v == null ? '' : o.secure ? '*'.repeat(v.length) : v) + '\n');
      if (v != null && o.history && !o.secure && v.trim()) o.history.push(v);
      return Promise.resolve(v);
    }
    readKey() { return Promise.resolve(this.inputs.length ? this.inputs.shift() : 'Enter'); }
    /** Queue more input (e.g. answers to prompts). */
    feed(...lines) { this.inputs.push(...lines); }
  }

  WS.term = WS.term || {};
  WS.term.Console = Console;
  WS.term.TextConsole = TextConsole;
  WS.term.COLORS = COLORS;
})();
