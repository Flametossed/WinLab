/* Window manager: create / drag / resize / minimize / maximize / snap / close / focus.
 * WS.wm.create({app, title, icon(svg string), width, height, x, y, resizable}) -> win
 * win.body is the content element. WS.wm.on('change', fn) fires for taskbar updates.
 * Snapping: win.snap is { x, y, w, h } (fractions of the desktop) while snapped; wm.snap(win, rect) / wm.unsnap(win).
 * WS.snap (js/core/snap.js) supplies the drag preview, snap layouts, Snap Assist and the Win+arrow keys. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h;
  const listeners = [];
  let z = 100, cascade = 0;

  const GLYPH = {
    min: '<svg viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
    max: '<svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>',
    restore: '<svg viewBox="0 0 10 10"><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" fill="none" stroke="currentColor"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>'
  };
  const pct = f => (Math.round(f * 1e5) / 1e3) + '%';

  const wm = {
    windows: [],
    active: null,
    on(fn) { listeners.push(fn); },
    emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
    layer() { return document.getElementById('windows'); },
    find(app) { return wm.windows.find(w => w.app === app); },

    create(opts) {
      const layer = wm.layer();
      const W = layer.clientWidth || window.innerWidth, H = layer.clientHeight || window.innerHeight - 48;
      const width = Math.min(opts.width || 800, W - 20), height = Math.min(opts.height || 560, H - 20);
      const x = opts.x != null ? opts.x : Math.max(10, (W - width) / 2 - 60 + (cascade % 6) * 28);
      const y = opts.y != null ? opts.y : Math.max(10, (H - height) / 2 - 40 + (cascade % 6) * 28);
      cascade++;

      const titleEl = h('div.win-title', opts.title || '');
      const btnMin = h('button.min', { html: GLYPH.min, title: 'Minimize' });
      const btnMax = h('button.max', { html: GLYPH.max, title: 'Maximize' });
      const btnClose = h('button.close', { html: GLYPH.close, title: 'Close' });
      const bar = h('div.win-titlebar',
        h('div.win-icon', { html: opts.icon || '' }), titleEl,
        h('div.win-caption', opts.resizable === false ? null : btnMin, opts.resizable === false ? null : btnMax, btnClose));
      const body = h('div.win-body');
      const el = h('div.win', { style: { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' } }, bar, body);
      if (opts.resizable !== false) ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(d => el.appendChild(h('div.rz.' + d, { dataset: { dir: d } })));

      const win = {
        id: WS.util.uid('win'), app: opts.app || 'app', title: opts.title || '', icon: opts.icon || '',
        el, body, bar, btnMax, resizable: opts.resizable !== false, minimized: false, maximized: false, snap: null, prev: null, closeHandlers: [],
        setTitle(t) { win.title = t; titleEl.textContent = t; wm.emit(); },
        focus() { wm.focus(win); },
        close() { wm.close(win); },
        minimize() { win.minimized = true; el.classList.add('min'); if (wm.active === win) wm.active = null; wm.emit(); },
        restore() { win.minimized = false; el.classList.remove('min'); wm.focus(win); },
        /** Maximize, or go back to where the window was: its snap zone if it was snapped, else its floating size. */
        toggleMax() {
          if (win.maximized) {
            win.maximized = false; el.classList.remove('max'); btnMax.innerHTML = GLYPH.max; btnMax.title = 'Maximize';
            if (win.snap) place(win, win.snap); else Object.assign(el.style, win.prev);
          } else {
            saveFloat(win);
            Object.assign(el.style, { left: '0px', top: '0px', width: '100%', height: '100%' });
            win.maximized = true; el.classList.add('max'); btnMax.innerHTML = GLYPH.restore; btnMax.title = 'Restore Down';
          }
          wm.emit();
        },
        onClose(fn) { win.closeHandlers.push(fn); },
        /** Subscribe to a store topic; auto-unsubscribed on close. */
        listen(topic, fn) { const off = WS.store.on('change:' + topic, fn); win.onClose(off); }
      };

      btnMin.addEventListener('click', e => { e.stopPropagation(); win.minimize(); });
      btnMax.addEventListener('click', e => { e.stopPropagation(); if (WS.snap) WS.snap.closeLayouts(); win.toggleMax(); });
      // win.canClose() -> false | Promise<bool> lets an app ask first (Notepad's "Do you want to save changes"); closeAll skips it
      btnClose.addEventListener('click', async e => { e.stopPropagation(); if (win.canClose && !(await win.canClose())) return; win.close(); });
      el.addEventListener('pointerdown', () => wm.focus(win), true);
      bar.addEventListener('dblclick', e => { if (!e.target.closest('button') && opts.resizable !== false) win.toggleMax(); });
      makeDraggable(win, bar);
      makeResizable(win);
      if (WS.snap && win.resizable) WS.snap.attach(win);

      layer.appendChild(el);
      wm.windows.push(win);
      if (opts.maximized) win.toggleMax();
      wm.focus(win);
      return win;
    },

    focus(win) {
      if (win.minimized) { win.minimized = false; win.el.classList.remove('min'); }
      win.el.style.zIndex = ++z;
      wm.windows.forEach(w => w.el.classList.toggle('active', w === win));
      wm.active = win;
      wm.emit();
    },

    close(win) {
      win.closeHandlers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
      win.el.remove();
      wm.windows = wm.windows.filter(w => w !== win);
      if (wm.active === win) {
        wm.active = null;
        const top = wm.windows.filter(w => !w.minimized).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
        if (top) wm.focus(top);
      }
      wm.emit();
    },

    closeAll() { wm.windows.slice().forEach(w => wm.close(w)); },

    /** Snap a window into rect ({ x, y, w, h }, fractions of the desktop). Its floating size is kept for restoring. */
    snap(win, rect) {
      if (!win.resizable) return false;
      saveFloat(win);
      if (win.maximized) { win.maximized = false; win.el.classList.remove('max'); win.btnMax.innerHTML = GLYPH.max; win.btnMax.title = 'Maximize'; }
      if (win.minimized) { win.minimized = false; win.el.classList.remove('min'); }
      win.snap = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      place(win, win.snap);
      wm.focus(win);
      return true;
    },
    /** Back to the floating size and position the window had before it was snapped or maximized. */
    unsnap(win) {
      if (win.maximized) { win.maximized = false; win.el.classList.remove('max'); win.btnMax.innerHTML = GLYPH.max; win.btnMax.title = 'Maximize'; }
      win.snap = null;
      win.el.classList.remove('snapped');
      if (win.prev) Object.assign(win.el.style, win.prev);
      wm.emit();
    },
    /** Snapped windows that are on screen. */
    snapped() { return wm.windows.filter(w => w.snap && !w.maximized && !w.minimized); }
  };

  function saveFloat(win) {
    if (win.maximized || win.snap) return;
    const s = win.el.style;
    win.prev = { left: s.left, top: s.top, width: s.width, height: s.height };
  }
  function place(win, r) {
    Object.assign(win.el.style, { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });
    win.el.classList.add('snapped');
  }
  /** Leave the maximized/snapped state for a floating one without moving (used when a snapped window's outer edge is resized). */
  function floatHere(win) {
    const el = win.el;
    const r = { left: el.offsetLeft + 'px', top: el.offsetTop + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px' };
    win.snap = null; el.classList.remove('snapped');
    Object.assign(el.style, r);
  }

  function makeDraggable(win, bar) {
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const el = win.el, layer = wm.layer();
      const sx = e.clientX, sy = e.clientY;
      let started = false, ox = 0, oy = 0;
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers can't be captured */ }
      const begin = () => {
        started = true;
        const lr = layer.getBoundingClientRect();
        if (win.maximized || win.snap) {
          // Restore the floating size under the cursor, keeping the grab point proportional (as Windows does).
          const r = el.getBoundingClientRect();
          const ratio = (sx - r.left) / r.width, grabY = Math.min(sy - r.top, 31);
          win.snap = null; el.classList.remove('snapped');
          if (win.maximized) win.toggleMax(); else if (win.prev) Object.assign(el.style, win.prev);
          el.style.left = (sx - lr.left - el.offsetWidth * ratio) + 'px';
          el.style.top = Math.max(0, sy - lr.top - grabY) + 'px';
          wm.emit();
        }
        ox = el.offsetLeft; oy = el.offsetTop;
        if (WS.snap) WS.snap.dragStart(win);
      };
      const move = ev => {
        if (!started) { if (Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return; begin(); }
        const lr = layer.getBoundingClientRect();
        const nx = ox + ev.clientX - sx;
        const ny = Math.max(0, Math.min(layer.clientHeight - 32, oy + ev.clientY - sy));
        el.style.left = Math.max(-el.offsetWidth + 80, Math.min(layer.clientWidth - 80, nx)) + 'px';
        el.style.top = ny + 'px';
        if (WS.snap) WS.snap.dragMove(win, ev.clientX - lr.left, ev.clientY - lr.top);
      };
      const up = ev => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        if (!started) return;
        const lr = layer.getBoundingClientRect();
        if (WS.snap) WS.snap.dragEnd(win, ev.clientX - lr.left, ev.clientY - lr.top, ev.type === 'pointercancel');
        else if (ev.clientY - lr.top <= 1 && !win.maximized) win.toggleMax(); // drag to top edge = maximize
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }

  function makeResizable(win) {
    win.el.querySelectorAll('.rz').forEach(handle => {
      handle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const el = win.el, dir = handle.dataset.dir;
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers can't be captured */ }
        let move;
        const shared = win.snap && sharedEdges(win, dir);
        if (shared) {
          // An edge between snapped windows moves every window on it, as Windows does for windows snapped side by side.
          const layer = wm.layer(), W = layer.clientWidth, H = layer.clientHeight;
          move = ev => {
            const lr = layer.getBoundingClientRect();
            for (const s of shared) {
              const vert = s.axis === 'x';
              const f = vert ? (ev.clientX - lr.left) / W : (ev.clientY - lr.top) / H;
              const minF = vert ? 240 / W : 120 / H;
              const lo = Math.max(...s.before.map(w => w.snap[s.axis] + minF)), hi = Math.min(...s.after.map(w => w.snap[s.axis] + w.snap[s.size] - minF));
              const v = Math.max(lo, Math.min(hi, f));
              for (const w of s.before) { w.snap[s.size] = v - w.snap[s.axis]; place(w, w.snap); }
              for (const w of s.after) { w.snap[s.size] = w.snap[s.axis] + w.snap[s.size] - v; w.snap[s.axis] = v; place(w, w.snap); }
            }
          };
        } else {
          if (win.snap) floatHere(win);
          const s = { x: e.clientX, y: e.clientY, l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
          move = ev => {
            const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
            if (dir.includes('e')) el.style.width = Math.max(240, s.w + dx) + 'px';
            if (dir.includes('s')) el.style.height = Math.max(120, s.h + dy) + 'px';
            if (dir.includes('w')) { const w = Math.max(240, s.w - dx); el.style.width = w + 'px'; el.style.left = (s.l + s.w - w) + 'px'; }
            if (dir.includes('n')) { const hh = Math.max(120, s.h - dy); el.style.height = hh + 'px'; el.style.top = Math.max(0, s.t + s.h - hh) + 'px'; }
          };
        }
        const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    });
  }

  /** For a snapped window's resize handle: the snapped windows on each edge it moves (before/after the edge), or null when
   * an edge is on the screen's border or has no neighbour (then the window simply stops being snapped). */
  function sharedEdges(win, dir) {
    const eq = (a, b) => Math.abs(a - b) < 0.002;
    const r = win.snap, others = wm.snapped().filter(w => w !== win);
    const out = [];
    for (const d of dir) {
      const axis = d === 'e' || d === 'w' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h';
      const edge = d === 'e' || d === 's' ? r[axis] + r[size] : r[axis];
      if (eq(edge, 0) || eq(edge, 1)) return null;
      const before = [win, ...others].filter(w => eq(w.snap[axis] + w.snap[size], edge)), after = [win, ...others].filter(w => eq(w.snap[axis], edge));
      if (!before.length || !after.length) return null;
      out.push({ axis, size, before, after });
    }
    return out;
  }

  WS.wm = wm;
})();
