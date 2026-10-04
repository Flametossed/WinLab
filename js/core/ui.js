/* UI toolkit, part 1: modal frames, dialogs, menus, toolbar, form helpers.
 *   WS.ui.modal({title, icon, width, height, className})      -> frame { box, body, footer, close(value), promise, ... }
 *   WS.ui.dialog({title, content, buttons, width, icon})        -> Promise<button value>
 *   WS.ui.msgbox({title, message, detail, icon, buttons})       -> Promise<button label>
 *   WS.ui.inputBox({title, prompt, value, validate})            -> Promise<string | null>
 *   WS.ui.progress({title, text})                               -> { set(pct, text), close() }
 *   WS.ui.contextMenu(x, y, items) / WS.ui.popupMenu(anchor, items)
 *   WS.ui.menuBar([{label: '&File', items: [...] | () => [...]}])  (Alt shows mnemonics; Alt+letter opens)
 *   WS.ui.toolbar([{icon, title, action, enabled, checked} | {separator: true}])  -> el with .update()
 *   WS.ui.f.*  Win32-style form controls (see bottom).
 * Menu item: {label ('&' marks the mnemonic), action, disabled, checked, radio, default (bold), icon, shortcut,
 *             items (submenu: array or function)} or {separator: true}. Falsy entries are skipped.
 * Views (tree, list view) are in ui-views.js; property sheets and wizards in ui-sheets.js; pickers in ui-pickers.js.
 * Everything modal sits on the top #dialogs layer, above the lock and sign-in screens. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util;

  const ICONS = {
    info: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#0067c0"/><path d="M16 14v9" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="9" r="1.9" fill="#fff"/></svg>',
    warning: '<svg viewBox="0 0 32 32"><path d="M16 3L30 28H2z" fill="#f7c600" stroke="#c99a00" stroke-linejoin="round"/><path d="M16 12v8" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="24" r="1.6" fill="#1b1b1b"/></svg>',
    error: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#c42b1c"/><path d="M11 11l10 10M21 11L11 21" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    question: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#0067c0"/><path d="M12 12.5a4 4 0 1 1 5.6 3.7c-1 .5-1.6 1.3-1.6 2.4v1" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="24" r="1.7" fill="#fff"/></svg>'
  };
  const CLOSE = '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>';

  function dialogLayer() {
    let el = document.getElementById('dialogs');
    if (!el) { el = h('div', { id: 'dialogs' }); document.getElementById('screen').appendChild(el); }
    return el;
  }

  /* ---------------------------------------------------------------- modal frame */
  /** A draggable modal window on the #dialogs layer. Enter/Escape call frame.onEnter / frame.onEscape. */
  function modal({ title, icon, width = 420, height, className, closeValue = null }) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const layer = dialogLayer();
    const shade = h('div.dlg-shade');
    const body = h('div.dlg-body');
    const footer = h('div.dlg-buttons');
    const titleText = h('span.dlg-ttext', title || '');
    const xBtn = h('button.dlg-x', { html: CLOSE, title: 'Close' });
    const bar = h('div.dlg-title', icon ? h('span.dlg-ticon', { html: icon }) : null, titleText, xBtn);
    const box = h('div.dlg' + (className ? '.' + className.split(' ').join('.') : ''), { style: { width: width + 'px', height: height ? height + 'px' : null } }, bar, body, footer);
    shade.appendChild(box);
    layer.appendChild(shade);
    dragBy(box, bar);
    let closed = false;
    const frame = {
      shade, box, bar, body, footer, promise,
      isTop: () => shade === layer.lastElementChild,
      setTitle(t) { titleText.textContent = t; },
      close(value) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        shade.remove();
        resolve(value);
      },
      onEscape: null, onEnter: null, onKey: null
    };
    xBtn.addEventListener('click', () => (frame.onEscape ? frame.onEscape() : frame.close(closeValue)));
    function onKey(e) {
      if (!frame.isTop() || openMenus.length) return; // only the top-most dialog handles keys
      if (frame.onKey && frame.onKey(e) === false) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); frame.onEscape ? frame.onEscape() : frame.close(closeValue); }
      else if (e.key === 'Enter' && frame.onEnter && !['TEXTAREA', 'BUTTON'].includes(e.target.tagName) && !e.target.isContentEditable && !e.target.closest('.lv, .tv')) {
        e.preventDefault(); e.stopPropagation(); frame.onEnter();
      }
    }
    document.addEventListener('keydown', onKey, true);
    // Clicking outside the dialog "dings" it, like a real modal window.
    shade.addEventListener('pointerdown', e => { if (e.target === shade) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); } });
    return frame;
  }
  function focusFirst(frame, preferred) {
    setTimeout(() => {
      const f = preferred || frame.body.querySelector('input:not([readonly]):not([disabled]):not([type=radio]):not([type=checkbox]), textarea:not([readonly]), [contenteditable=true]') || frame.footer.querySelector('.btn.primary:not(:disabled)') || frame.footer.querySelector('.btn');
      if (f) f.focus();
    }, 30);
  }

  /** Generic modal dialog. buttons: [{label, value?, primary?, cancel?, disabled?}] -> resolves with value (or label). */
  function dialog({ title, content, buttons = [{ label: 'OK', primary: true }], width = 420, icon, className, onCreate }) {
    const frame = modal({ title, icon, width, className });
    const val = b => (b.value !== undefined ? b.value : b.label);
    const cancelBtn = buttons.find(b => b.cancel) || buttons[buttons.length - 1];
    const btnEls = buttons.map(b => h('button.btn' + (b.primary ? '.primary' : ''), { disabled: !!b.disabled, onClick: () => frame.close(val(b)) }, b.label));
    btnEls.forEach(b => frame.footer.appendChild(b));
    if (content) frame.body.appendChild(content);
    frame.onEscape = () => frame.close(val(cancelBtn));
    const p = buttons.findIndex(b => b.primary);
    if (p >= 0) frame.onEnter = () => { if (!btnEls[p].disabled) btnEls[p].click(); };
    frame.buttons = btnEls;
    if (onCreate) onCreate(frame);
    focusFirst(frame);
    return frame.promise;
  }

  function msgbox({ title = 'Windows Server', message, detail, icon = 'info', buttons = ['OK'], width = 440 }) {
    const content = h('div.msgbox',
      icon ? h('div.msgbox-icon', { html: ICONS[icon] || '' }) : null,
      h('div.msgbox-text', h('div', { style: 'white-space:pre-line' }, message), detail ? h('div.msgbox-detail', { style: 'white-space:pre-line' }, detail) : null));
    return dialog({ title, width, content, buttons: buttons.map((label, i) => ({ label, primary: i === 0, cancel: i === buttons.length - 1 })) });
  }

  /** One-line text prompt. validate(value) may return an error string to keep the box open. */
  async function inputBox({ title, prompt, value = '', validate, width = 380, okLabel = 'OK' }) {
    const input = h('input.inp', { type: 'text', value, style: 'width:100%' });
    const content = h('div.w32', h('div', { style: 'margin-bottom:6px' }, prompt), input);
    for (;;) {
      setTimeout(() => input.select(), 40);
      const r = await dialog({ title, content, width, buttons: [{ label: okLabel, primary: true }, { label: 'Cancel', cancel: true }] });
      if (r !== okLabel) return null;
      const err = validate ? await validate(input.value) : null;
      if (!err) return input.value;
      await msgbox({ title, message: err, icon: 'error' });
    }
  }

  /** "Service Control"-style progress box. set(pct, text); close(). */
  function progress({ title, text, width = 420 }) {
    const frame = modal({ title, width, className: 'w32-dlg' });
    const label = h('div', { style: 'white-space:pre-line;margin-bottom:12px' }, text || '');
    const fill = h('div.pbar-fill');
    frame.body.appendChild(h('div.w32', label, h('div.pbar', fill)));
    const closeBtn = h('button.btn', { disabled: true }, 'Close');
    frame.footer.appendChild(closeBtn);
    frame.onEscape = () => {};
    return {
      set(pct, t) { fill.style.width = U.clamp(pct, 0, 100) + '%'; if (t != null) label.textContent = t; },
      close() { frame.close(); }
    };
  }

  function dragBy(box, bar) {
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      Object.assign(box.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', margin: 0 });
      bar.setPointerCapture(e.pointerId);
      const move = ev => { box.style.left = (ev.clientX - ox) + 'px'; box.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
  }

  /* ---------------------------------------------------------------- menus */
  /** '&File' -> <u>F</u>ile; '&&' is a literal ampersand. */
  function mnemonicLabel(label) {
    const s = String(label == null ? '' : label);
    const frag = document.createDocumentFragment();
    let key = null;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '&' && s[i + 1] === '&') { frag.appendChild(document.createTextNode('&')); i++; }
      else if (s[i] === '&' && i + 1 < s.length && key == null) { key = s[i + 1].toLowerCase(); frag.appendChild(h('u.mn', s[i + 1])); i++; }
      else frag.appendChild(document.createTextNode(s[i]));
    }
    return { frag, key, text: s.replace(/&&/g, '\u0000').replace(/&/g, '').replace(/\u0000/g, '&') };
  }
  const plain = label => mnemonicLabel(label).text;

  const openMenus = []; // stack of { el, items, index, rows, parentRow, onClose }
  let menuRoot = null;  // { onClose, bar? }
  function closeAllMenus(reason) {
    while (openMenus.length) openMenus.pop().el.remove();
    const r = menuRoot; menuRoot = null;
    if (r && r.onClose) r.onClose(reason);
  }
  function closeLevel(level) { while (openMenus.length > level) openMenus.pop().el.remove(); }

  function resolveItems(items) { return (typeof items === 'function' ? items() : items || []).filter(Boolean); }

  function buildMenu(items, level) {
    const el = h('div.menu.ctx');
    const entry = { el, items, index: -1, rows: [], level };
    items.forEach((it, i) => {
      if (it.separator) { el.appendChild(h('div.menu-sep')); entry.rows.push(null); return; }
      const lbl = mnemonicLabel(it.label);
      const mark = it.checked ? (it.radio ? WS.icons.dot : WS.icons.check) : (it.icon || '');
      const row = h('div.menu-item' + (it.disabled ? '.disabled' : '') + (it.default ? '.default' : ''),
        h('span.mi-icon', { html: mark }), h('span.mi-label', lbl.frag),
        it.shortcut ? h('span.mi-short', it.shortcut) : null,
        it.items ? h('span.mi-sub', { html: WS.icons.chevronRight }) : null);
      row.dataset.key = lbl.key || '';
      row.addEventListener('pointerenter', () => { setIndex(entry, i); scheduleSub(entry, i); });
      row.addEventListener('click', e => { e.stopPropagation(); activate(entry, i, true); });
      el.appendChild(row);
      entry.rows.push(row);
    });
    return entry;
  }
  let subTimer = null;
  function scheduleSub(entry, i) {
    clearTimeout(subTimer);
    const it = entry.items[i];
    subTimer = setTimeout(() => {
      if (!openMenus.includes(entry)) return;
      closeLevel(entry.level + 1);
      if (it && it.items && !it.disabled) openSub(entry, i, false);
    }, 220);
  }
  function setIndex(entry, i) {
    entry.index = i;
    entry.rows.forEach((r, j) => r && r.classList.toggle('hot', j === i));
  }
  function openSub(entry, i, keyboard) {
    const it = entry.items[i];
    const sub = resolveItems(it.items);
    if (!sub.length) return;
    closeLevel(entry.level + 1);
    const r = entry.rows[i].getBoundingClientRect();
    const m = showMenu(sub, r.right - 2, r.top - 5, entry.level + 1, { flipX: r.left });
    if (keyboard) moveIndex(m, 1);
  }
  function activate(entry, i, mouse) {
    const it = entry.items[i];
    if (!it || it.separator || it.disabled) return;
    if (it.items) { clearTimeout(subTimer); openSub(entry, i, !mouse); return; }
    closeAllMenus('activate');
    if (it.action) setTimeout(() => it.action(), 0);
  }
  function moveIndex(entry, dir) {
    const n = entry.items.length;
    if (!n) return;
    let i = entry.index;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!entry.items[i].separator) break;
    }
    setIndex(entry, i);
  }
  function showMenu(items, x, y, level, opt = {}) {
    const entry = buildMenu(items, level);
    dialogLayer().appendChild(entry.el);
    const W = window.innerWidth, H = window.innerHeight;
    const w = entry.el.offsetWidth, hgt = entry.el.offsetHeight;
    let left = x;
    if (left + w > W - 4) left = opt.flipX != null ? Math.max(4, opt.flipX - w + 2) : Math.max(4, W - w - 4);
    let top = y;
    if (top + hgt > H - 4) top = opt.anchorTop != null ? Math.max(4, opt.anchorTop - hgt) : Math.max(4, H - hgt - 4);
    entry.el.style.left = left + 'px';
    entry.el.style.top = top + 'px';
    openMenus.push(entry);
    return entry;
  }

  /** Right-click menu at a point. opts.onClose(reason) fires when it goes away. */
  function contextMenu(x, y, items, opts = {}) {
    closeAllMenus('replaced');
    const list = resolveItems(items);
    if (!list.length) return null;
    menuRoot = { onClose: opts.onClose };
    const m = showMenu(list, x, y, 0);
    if (opts.keyboard) moveIndex(m, 1);
    return m.el;
  }
  /** Drop-down menu under an element (menu bar titles, split buttons). */
  function popupMenu(anchor, items, opts = {}) {
    const r = anchor.getBoundingClientRect();
    closeAllMenus('replaced');
    const list = resolveItems(items);
    if (!list.length) return null;
    menuRoot = { onClose: opts.onClose, bar: opts.bar };
    const m = showMenu(list, r.left, r.bottom, 0, { anchorTop: r.top });
    if (opts.keyboard) moveIndex(m, 1);
    return m.el;
  }

  document.addEventListener('pointerdown', e => {
    if (!openMenus.length) return;
    if (openMenus.some(m => m.el.contains(e.target))) return;
    if (menuRoot && menuRoot.bar && menuRoot.bar.el.contains(e.target)) return; // the bar handles its own clicks
    closeAllMenus('outside');
  }, true);
  window.addEventListener('blur', () => closeAllMenus('blur'));

  document.addEventListener('keydown', e => {
    if (!openMenus.length) return;
    const top = openMenus[openMenus.length - 1];
    const k = e.key;
    let handled = true;
    if (k === 'ArrowDown') moveIndex(top, 1);
    else if (k === 'ArrowUp') moveIndex(top, -1);
    else if (k === 'ArrowRight') {
      const it = top.items[top.index];
      if (it && it.items && !it.disabled) openSub(top, top.index, true);
      else if (menuRoot && menuRoot.bar) menuRoot.bar.step(1);
    } else if (k === 'ArrowLeft') {
      if (openMenus.length > 1) closeLevel(openMenus.length - 1);
      else if (menuRoot && menuRoot.bar) menuRoot.bar.step(-1);
    } else if (k === 'Enter' || k === ' ') { if (top.index >= 0) activate(top, top.index, false); }
    else if (k === 'Escape') { if (openMenus.length > 1) closeLevel(openMenus.length - 1); else closeAllMenus('escape'); }
    else if (k === 'Tab') closeAllMenus('escape');
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) {
      const i = top.rows.findIndex(r => r && r.dataset.key === k.toLowerCase());
      if (i >= 0) { setIndex(top, i); activate(top, i, false); }
      else handled = false;
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ---------------------------------------------------------------- menu bar */
  const bars = new Set();
  /** Classic menu bar. Returns { el, open(index), close() }. */
  function menuBar(menus) {
    const el = h('div.menubar');
    const bar = { el, openIndex: -1, menus };
    const titles = menus.map((m, i) => {
      const lbl = mnemonicLabel(m.label);
      const t = h('div.mb-item', lbl.frag);
      t.dataset.key = lbl.key || '';
      t.addEventListener('pointerdown', e => { e.preventDefault(); if (bar.openIndex === i) close(); else open(i); });
      t.addEventListener('pointerenter', () => { if (bar.openIndex >= 0 && bar.openIndex !== i) open(i); });
      el.appendChild(t);
      return t;
    });
    function open(i, keyboard) {
      titles.forEach((t, j) => t.classList.toggle('open', j === i));
      bar.openIndex = i;
      popupMenu(titles[i], menus[i].items, { bar, keyboard, onClose: reason => {
        if (reason === 'replaced') return;
        titles.forEach(t => t.classList.remove('open'));
        bar.openIndex = -1;
      } });
    }
    function close() { closeAllMenus('bar'); titles.forEach(t => t.classList.remove('open')); bar.openIndex = -1; }
    bar.open = open; bar.close = close;
    bar.step = dir => open((bar.openIndex + dir + menus.length) % menus.length, true);
    bar.keyOpen = key => { const i = titles.findIndex(t => t.dataset.key === key); if (i >= 0) { open(i, true); return true; } return false; };
    bars.add(bar);
    // forget bars whose element left the document
    setTimeout(function sweep() { for (const b of bars) if (!b.el.isConnected && b !== bar) bars.delete(b); }, 0);
    return bar;
  }
  /* Alt shows mnemonic underlines; Alt+letter opens the active window's menu. */
  document.addEventListener('keydown', e => {
    if (e.key === 'Alt') { document.body.classList.add('show-keys'); return; }
    if (!e.altKey || openMenus.length || e.key.length !== 1) return;
    const active = WS.wm && WS.wm.active;
    if (!active || document.querySelector('#dialogs .dlg-shade')) return;
    for (const b of bars) {
      if (b.el.isConnected && active.el.contains(b.el) && b.keyOpen(e.key.toLowerCase())) { e.preventDefault(); return; }
    }
  });
  document.addEventListener('pointerdown', () => document.body.classList.remove('show-keys'), true);
  document.addEventListener('keyup', e => { if (e.key === 'Alt') e.preventDefault(); });

  /* ---------------------------------------------------------------- toolbar */
  /** items: [{icon, title, action, enabled: bool | () => bool, checked: () => bool} | {separator: true}] */
  function toolbar(items) {
    const el = h('div.toolbar');
    const btns = [];
    for (const it of items.filter(Boolean)) {
      if (it.separator) { el.appendChild(h('div.tb-sep')); continue; }
      const b = h('button.tbtn', { html: it.icon, title: it.title || '', onClick: () => { if (!b.disabled && it.action) it.action(); } });
      if (it.label) b.appendChild(h('span', it.label));
      el.appendChild(b);
      btns.push([b, it]);
    }
    el.update = () => {
      for (const [b, it] of btns) {
        b.disabled = typeof it.enabled === 'function' ? !it.enabled() : it.enabled === false;
        if (it.checked) b.classList.toggle('on', !!it.checked());
      }
    };
    el.update();
    return el;
  }

  /* ---------------------------------------------------------------- form helpers (Win32 look; wrap in .w32) */
  const f = {
    text(o = {}) {
      const el = h('input.inp', { type: o.password ? 'password' : 'text', value: o.value == null ? '' : o.value, readOnly: !!o.readOnly, disabled: !!o.disabled,
        placeholder: o.placeholder, maxLength: o.maxLength, style: o.width ? { width: typeof o.width === 'number' ? o.width + 'px' : o.width } : null, spellcheck: false });
      if (o.onInput) el.addEventListener('input', () => o.onInput(el.value));
      return el;
    },
    textarea(o = {}) {
      const el = h('textarea.inp', { rows: o.rows || 3, readOnly: !!o.readOnly, disabled: !!o.disabled, spellcheck: false, style: o.width ? { width: o.width + 'px' } : null });
      el.value = o.value || '';
      return el;
    },
    number(o = {}) { return h('input.inp.num', { type: 'number', value: o.value == null ? '' : o.value, min: o.min, max: o.max, disabled: !!o.disabled, style: { width: (o.width || 70) + 'px' } }); },
    /** options: ['A', 'B'] or [{value, label}] */
    select(options, value, o = {}) {
      const el = h('select.inp.sel', { disabled: !!o.disabled, style: o.width ? { width: o.width + 'px' } : null });
      for (const op of options) {
        const v = typeof op === 'object' ? op.value : op;
        el.appendChild(h('option', { value: v, selected: String(v) === String(value) }, typeof op === 'object' ? op.label : op));
      }
      if (o.onChange) el.addEventListener('change', () => o.onChange(el.value));
      return el;
    },
    checkbox(label, checked, o = {}) {
      const input = h('input', { type: 'checkbox', checked: !!checked, disabled: !!o.disabled });
      const el = h('label.chk' + (o.disabled ? '.disabled' : ''), input, h('span', label));
      el.input = input;
      Object.defineProperty(el, 'checked', { get: () => input.checked, set: v => { input.checked = !!v; } });
      if (o.onChange) input.addEventListener('change', () => o.onChange(input.checked));
      return el;
    },
    radio(name, label, checked, o = {}) {
      const input = h('input', { type: 'radio', name, checked: !!checked, disabled: !!o.disabled, value: o.value });
      const el = h('label.chk' + (o.disabled ? '.disabled' : ''), input, h('span', label));
      el.input = input;
      Object.defineProperty(el, 'checked', { get: () => input.checked, set: v => { input.checked = !!v; } });
      if (o.onChange) input.addEventListener('change', () => o.onChange(input.checked));
      return el;
    },
    /** Label + control on one line (label column width defaults to 110px). */
    row(label, control, o = {}) {
      return h('div.frow', h('label.flabel', { style: { width: (o.labelWidth || 110) + 'px' } }, label), h('div.fctl', control));
    },
    /** Label above control. */
    stack(label, control) { return h('div.fstack', h('label.flabel', label), control); },
    group(legend, ...children) { return h('fieldset.grp', legend ? h('legend', legend) : null, ...children); },
    button(label, action, o = {}) { const b = h('button.btn.btn-sm', { disabled: !!o.disabled, onClick: () => { if (!b.disabled) action(); } }, label); return b; },
    link(text, action) { return h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); action(); } }, text); },
    sep() { return h('hr.fsep'); },
    note(text) { return h('div.fnote', text); },
    /** Read-only value shown like a static label (property sheet "Service name:  Spooler"). */
    value(text) { return h('div.fvalue', text == null ? '' : String(text)); }
  };

  WS.ui = {
    modal, dialog, msgbox, inputBox, progress, focusFirst, dialogLayer,
    contextMenu, popupMenu, closeMenu: () => closeAllMenus('api'), menuBar, toolbar, mnemonicLabel, plain,
    f, icons: ICONS, menusOpen: () => openMenus.length > 0
  };
})();
