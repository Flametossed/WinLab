/* Snap (Windows 11 / Server 2025): drag a window to an edge (half), a corner (quarter) or the top (maximize) with a
 * preview; the snap layouts flyout on the maximize button (and Win+Z); the snap layouts bar at the top while dragging;
 * Snap Assist, which offers the other windows for the space left; Win+Left/Right/Up/Down; title bar window shake.
 *   WS.snap.LAYOUTS / ZONES; zone(win) -> 'max' | 'float' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br' | 'other';
 *   snapTo(win, name | rect, { assist }); key('left'|'right'|'up'|'down'); openLayouts(win, { keys }); closeLayouts();
 *   assist(layout, filled[], placed[]); closeAssist(); assisting() -> bool.
 * wm.js calls attach(win), dragStart(win), dragMove(win, x, y) and dragEnd(win, x, y, cancelled) (x, y are relative to the desktop).
 * The options are Settings > System > Multitasking (WS.personal.snap()). */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h;
  const r4 = (x, y, w, hh) => ({ x, y, w, h: hh });

  /** The six layouts Windows offers on a landscape screen, in its order. */
  const LAYOUTS = [
    [r4(0, 0, 0.5, 1), r4(0.5, 0, 0.5, 1)],
    [r4(0, 0, 2 / 3, 1), r4(2 / 3, 0, 1 / 3, 1)],
    [r4(0, 0, 1 / 3, 1), r4(1 / 3, 0, 1 / 3, 1), r4(2 / 3, 0, 1 / 3, 1)],
    [r4(0, 0, 0.5, 1), r4(0.5, 0, 0.5, 0.5), r4(0.5, 0.5, 0.5, 0.5)],
    [r4(0, 0, 0.5, 0.5), r4(0.5, 0, 0.5, 0.5), r4(0, 0.5, 0.5, 0.5), r4(0.5, 0.5, 0.5, 0.5)],
    [r4(0, 0, 0.25, 1), r4(0.25, 0, 0.5, 1), r4(0.75, 0, 0.25, 1)]
  ];
  /** Edge and corner zones, with the layout Snap Assist continues in. */
  const ZONES = {
    left: { rect: LAYOUTS[0][0], layout: 0, zone: 0 }, right: { rect: LAYOUTS[0][1], layout: 0, zone: 1 },
    tl: { rect: LAYOUTS[4][0], layout: 4, zone: 0 }, tr: { rect: LAYOUTS[4][1], layout: 4, zone: 1 },
    bl: { rect: LAYOUTS[4][2], layout: 4, zone: 2 }, br: { rect: LAYOUTS[4][3], layout: 4, zone: 3 }
  };
  const MARGIN = 6; // the preview and Snap Assist sit just inside their zone

  const prefs = () => (WS.personal && WS.state && WS.state.personal ? WS.personal.snap() : { enabled: true, hoverMax: true, dragTop: true, assist: true, nearEdge: true, shake: false });
  const desktop = () => document.getElementById('desktop');
  const dims = () => { const l = WS.wm.layer(); return { W: l.clientWidth, H: l.clientHeight }; };
  const eq = (a, b) => Math.abs(a - b) < 0.002;
  const same = (a, b) => eq(a.x, b.x) && eq(a.y, b.y) && eq(a.w, b.w) && eq(a.h, b.h);
  const pctBox = (r, m = 0) => ({ left: `calc(${r.x * 100}% + ${m}px)`, top: `calc(${r.y * 100}% + ${m}px)`, width: `calc(${r.w * 100}% - ${2 * m}px)`, height: `calc(${r.h * 100}% - ${2 * m}px)` });

  function zone(win) {
    if (win.maximized) return 'max';
    if (!win.snap) return 'float';
    return Object.keys(ZONES).find(k => same(ZONES[k].rect, win.snap)) || 'other';
  }

  /** A small picture of a layout; onZone(i, el) builds each zone. */
  function layoutBox(layout, cls, onZone) {
    const box = h('div.snap-layout' + (cls ? '.' + cls : ''));
    LAYOUTS[layout].forEach((r, i) => { const z = h('div.snap-lzone', { style: pctBox(r), dataset: { zone: i } }); box.appendChild(z); if (onZone) onZone(i, z); });
    return box;
  }

  /* ---------------- drag: preview, snap bar, shake ---------------- */
  let drag = null, preview = null, bar = null;
  function showPreview(win, rect) {
    if (!rect) { if (preview) preview.remove(); preview = null; return; }
    if (!preview) {
      preview = h('div.snap-preview');
      win.el.parentNode.insertBefore(preview, win.el); // same z-index, earlier in the layer: under the dragged window, over the rest
      Object.assign(preview.style, pctBox(rect, MARGIN), { zIndex: win.el.style.zIndex });
      preview.getBoundingClientRect(); // start the grow-in from here
      preview.classList.add('on');
    }
    Object.assign(preview.style, pctBox(rect, MARGIN));
  }

  function hideBar() { if (bar) bar.el.remove(); bar = null; }
  /** The snap layouts bar while dragging: a hint at the top centre that opens into the layouts when the pointer reaches it.
   * Returns { rect, layout, zone } over a zone, 'bar' over the open bar elsewhere, or null. */
  function updateBar(x, y) {
    const { W } = dims();
    const near = y < 120 && Math.abs(x - W / 2) < W * 0.3;
    if (!bar && !near) return null;
    if (!bar) {
      const el = h('div.snap-bar');
      desktop().appendChild(el);
      bar = { el, open: false };
    }
    const dr = desktop().getBoundingClientRect();
    if (!bar.open && y <= 30 && Math.abs(x - W / 2) < 170) {
      bar.open = true;
      bar.el.classList.add('open');
      LAYOUTS.forEach((_, i) => bar.el.appendChild(layoutBox(i, '', null)));
    }
    if (bar.open) {
      const br = bar.el.getBoundingClientRect();
      const inside = x >= br.left - dr.left - 30 && x <= br.right - dr.left + 30 && y <= br.bottom - dr.top + 30;
      if (!inside) { bar.open = false; bar.el.classList.remove('open'); bar.el.replaceChildren(); }
      else {
        let hit = null;
        bar.el.querySelectorAll('.snap-lzone').forEach(z => {
          const r = z.getBoundingClientRect();
          const on = x >= r.left - dr.left && x <= r.right - dr.left && y >= r.top - dr.top && y <= r.bottom - dr.top;
          z.classList.toggle('hot', on);
          if (on) { const layout = [...bar.el.children].indexOf(z.parentNode), i = +z.dataset.zone; hit = { rect: LAYOUTS[layout][i], layout, zone: i }; }
        });
        return hit || 'bar';
      }
    }
    if (!near) { hideBar(); return null; }
    return null;
  }

  function shake(x) {
    const s = drag.shake, now = performance.now();
    if (s.dir === 0) { if (Math.abs(x - s.ext) > 24) s.dir = Math.sign(x - s.ext); else return; }
    if (Math.sign(x - s.ext) === s.dir) { s.ext = x; return; }
    if (Math.abs(x - s.ext) < 24) return;
    s.dir = -s.dir; s.ext = x;
    s.turns = s.turns.filter(t => now - t < 900).concat(now);
    if (s.turns.length < 4 || s.done) return;
    s.done = true;
    // Shaking minimizes every other window; shaking again brings them back.
    const back = shaken && shaken.filter(w => WS.wm.windows.includes(w) && w.minimized);
    if (back && back.length) { back.forEach(w => { w.minimized = false; w.el.classList.remove('min'); }); shaken = null; WS.wm.focus(drag.win); }
    else { shaken = WS.wm.windows.filter(w => w !== drag.win && !w.minimized); shaken.forEach(w => w.minimize()); WS.wm.focus(drag.win); }
  }
  let shaken = null;

  function dragStart(win) {
    closeLayouts(); closeAssist();
    const st = win.el.style; // where it was before the drag: snapping or maximizing by dragging restores to here, as Windows does
    drag = { win, target: null, from: { left: st.left, top: st.top, width: st.width, height: st.height }, shake: { ext: null, dir: 0, turns: [], done: false } };
  }
  function dragMove(win, x, y) {
    if (!drag || drag.win !== win) return;
    const p = prefs();
    if (p.shake) { if (drag.shake.ext == null) drag.shake.ext = x; shake(x); }
    if (!p.enabled) return;
    const { W, H } = dims();
    let target = null;
    const fromBar = p.dragTop ? updateBar(x, y) : null;
    if (fromBar === 'bar') target = null;
    else if (fromBar) target = fromBar;
    else {
      const t = p.nearEdge ? 16 : 2, corner = Math.min(80, H / 6);
      if (x <= t) target = ZONES[y <= corner ? 'tl' : y >= H - corner ? 'bl' : 'left'];
      else if (x >= W - t) target = ZONES[y <= corner ? 'tr' : y >= H - corner ? 'br' : 'right'];
      else if (y <= (p.nearEdge ? 4 : 1)) target = { max: true, rect: r4(0, 0, 1, 1) };
    }
    drag.target = target;
    showPreview(win, target && target.rect);
  }
  function dragEnd(win, x, y, cancelled) {
    const t = drag && drag.win === win ? drag.target : null, from = drag && drag.from;
    drag = null;
    showPreview(win, null); hideBar();
    if (cancelled || !t) return;
    if (t.max) { if (!win.maximized) { win.toggleMax(); win.prev = from; } return; }
    WS.wm.snap(win, t.rect);
    win.prev = from;
    assist(t.layout, [t.zone], [win]);
  }

  /* ---------------- snap layouts flyout (maximize button, Win+Z) ---------------- */
  let fly = null;
  function closeLayouts() {
    if (!fly) return;
    clearTimeout(fly.timer);
    document.removeEventListener('keydown', fly.key, true);
    document.removeEventListener('pointerdown', fly.down, true);
    fly.el.remove(); fly = null;
  }
  function openLayouts(win, o = {}) {
    closeLayouts();
    if (!win || !win.resizable || !prefs().enabled) return null;
    const el = h('div.snap-flyout' + (o.keys ? '.keys' : ''));
    let chosen = null;
    LAYOUTS.forEach((_, li) => {
      const box = layoutBox(li, '', (i, z) => {
        z.addEventListener('click', e => { e.stopPropagation(); pick(li, i); });
        if (o.keys) z.appendChild(h('span.snap-num', String(i + 1)));
      });
      if (o.keys) box.appendChild(h('span.snap-num.layout', String(li + 1)));
      el.appendChild(box);
    });
    const pick = (li, i) => { closeLayouts(); snapTo(win, LAYOUTS[li][i], { layout: li, zone: i }); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayouts(); return; }
      const n = /^[1-9]$/.test(e.key) ? +e.key - 1 : -1;
      if (n < 0) return;
      e.preventDefault(); e.stopPropagation();
      if (chosen == null) { if (n < LAYOUTS.length) { chosen = n; el.classList.add('chosen'); el.children[n].classList.add('sel'); } }
      else if (n < LAYOUTS[chosen].length) pick(chosen, n);
    };
    const down = e => { if (!el.contains(e.target) && !(o.anchor && o.anchor.contains(e.target))) closeLayouts(); };
    fly = { el, win, key, down, timer: null };
    desktop().appendChild(el);
    // under the maximize button, kept on screen
    const dr = desktop().getBoundingClientRect(), br = win.btnMax.getBoundingClientRect();
    const left = Math.max(8, Math.min(dr.width - el.offsetWidth - 8, br.left + br.width / 2 - el.offsetWidth / 2 - dr.left));
    el.style.left = left + 'px';
    el.style.top = Math.max(8, Math.min(dr.height - el.offsetHeight - 8, br.bottom - dr.top + 4)) + 'px';
    el.addEventListener('pointerenter', () => clearTimeout(fly && fly.timer));
    el.addEventListener('pointerleave', () => { if (fly && !o.keys) fly.timer = setTimeout(closeLayouts, 300); });
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', down, true);
    return el;
  }
  /** Hovering the maximize button opens the layouts after a moment, as Windows does. */
  function attach(win) {
    let timer = null;
    win.btnMax.addEventListener('pointerenter', () => {
      const p = prefs();
      if (!p.enabled || !p.hoverMax || drag) return;
      if (fly && fly.win === win) { clearTimeout(fly.timer); return; }
      timer = setTimeout(() => openLayouts(win, { anchor: win.btnMax }), 450);
    });
    win.btnMax.addEventListener('pointerleave', () => { clearTimeout(timer); if (fly && fly.win === win && !fly.el.classList.contains('keys')) fly.timer = setTimeout(closeLayouts, 300); });
    win.btnMax.addEventListener('pointerdown', () => clearTimeout(timer));
  }

  /** Snap win to a named zone or a rect. Snap Assist follows unless o.assist === false. */
  function snapTo(win, where, o = {}) {
    const z = typeof where === 'string' ? ZONES[where] : null;
    const rect = z ? z.rect : where;
    if (!rect || !WS.wm.snap(win, rect)) return false;
    let layout = z ? z.layout : o.layout, at = z ? z.zone : o.zone;
    if (layout == null) { layout = LAYOUTS.findIndex(L => (at = L.findIndex(r => same(r, rect))) >= 0); }
    if (o.assist !== false && layout >= 0) assist(layout, [at], [win]);
    return true;
  }

  /* ---------------- Snap Assist ---------------- */
  let help = null;
  function assisting() { return !!help; }
  function closeAssist() {
    if (!help) return;
    document.removeEventListener('pointerdown', help.down, true);
    document.removeEventListener('keydown', help.key, true);
    help.els.forEach(e => e.remove());
    help = null;
  }
  /** Offer the other open windows for the zones of layout that aren't in filled. placed are the windows already in it. */
  function assist(layout, filled, placed) {
    closeAssist();
    if (!prefs().enabled || !prefs().assist) return;
    const zones = LAYOUTS[layout].map((r, i) => i).filter(i => !filled.includes(i));
    if (!zones.length || !WS.wm.windows.some(w => w.resizable && !placed.includes(w))) return;
    const down = e => { if (!help.els.some(x => x.contains(e.target))) closeAssist(); };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAssist(); return; }
      const thumbs = help.els[0] ? [...help.els[0].querySelectorAll('.snap-thumb')] : [];
      const at = thumbs.indexOf(document.activeElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Tab: e.shiftKey ? -1 : 1 }[e.key];
      if (step) { e.preventDefault(); e.stopPropagation(); const n = thumbs[(Math.max(at, 0) + (at < 0 ? 0 : step) + thumbs.length) % thumbs.length]; if (n) n.focus(); }
      if (e.key === 'Enter' && at >= 0) { e.preventDefault(); e.stopPropagation(); thumbs[at].click(); }
    };
    help = { layout, filled: filled.slice(), placed: placed.slice(), els: [], down, key };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    render();

    function render() {
      help.els.forEach(e => e.remove());
      help.els = [];
      const left = LAYOUTS[layout].map((r, i) => i).filter(i => !help.filled.includes(i));
      const list = WS.wm.windows.filter(w => w.resizable && !help.placed.includes(w)).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex);
      if (!left.length || !list.length) return closeAssist();
      const [cur, ...rest] = left;
      const rect = LAYOUTS[layout][cur];
      const panel = h('div.snap-assist', { style: pctBox(rect, MARGIN), dataset: { zone: cur } });
      const grid = h('div.snap-thumbs');
      panel.appendChild(grid);
      desktop().appendChild(panel);
      help.els.push(panel);
      for (const r of rest) { const p = h('div.snap-assist.waiting', { style: pctBox(LAYOUTS[layout][r], MARGIN) }); desktop().appendChild(p); help.els.push(p); }
      const { W, H } = dims();
      const zw = rect.w * W - 2 * MARGIN, zh = rect.h * H - 2 * MARGIN;
      const cols = Math.max(1, Math.min(list.length, Math.ceil(Math.sqrt(list.length * (zw / zh) / 1.6)))), rows = Math.ceil(list.length / cols);
      const tw = Math.max(90, Math.min(260, (zw - 40) / cols - 20)), th = Math.max(60, Math.min(tw * 0.75, (zh - 40) / rows - 50));
      for (const w of list) grid.appendChild(thumb(w, tw, th, () => {
        WS.wm.snap(w, rect);
        help.placed.push(w); help.filled.push(cur);
        render();
      }));
      const first = grid.querySelector('.snap-thumb');
      if (first) first.focus({ preventScroll: true });
    }
  }
  /** A window's thumbnail: icon and title above a scaled copy of the window. */
  function thumb(w, tw, th, onPick) {
    const { W, H } = dims();
    const size = v => (String(v).endsWith('%') ? null : parseFloat(v));
    let ww = w.el.offsetWidth, wh = w.el.offsetHeight;
    if (!ww || !wh) { // minimized: use the size it comes back at
      const s = w.maximized ? { width: '100%', height: '100%' } : w.el.style;
      ww = size(s.width) || (parseFloat(s.width) / 100 * W) || 800; wh = size(s.height) || (parseFloat(s.height) / 100 * H) || 560;
    }
    const scale = Math.min(tw / ww, th / wh);
    const copy = w.el.cloneNode(true);
    copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    copy.querySelectorAll('iframe, .rz').forEach(n => n.remove());
    copy.classList.remove('min', 'active');
    copy.setAttribute('inert', '');
    Object.assign(copy.style, { left: '0', top: '0', width: ww + 'px', height: wh + 'px', zIndex: '', transform: `scale(${scale})`, transformOrigin: '0 0', animation: 'none' });
    const t = h('div.snap-thumb', { tabindex: 0, dataset: { win: w.id, app: w.app } },
      h('div.snap-thumb-title', h('span.snap-thumb-icon', { html: w.icon || '' }), h('span', w.title)),
      h('div.snap-thumb-view', { style: { width: Math.round(ww * scale) + 'px', height: Math.round(wh * scale) + 'px' } }, copy));
    t.addEventListener('click', e => { e.stopPropagation(); onPick(); });
    return t;
  }

  /* ---------------- Win+arrow keys ---------------- */
  const KEYS = {
    left: { max: 'left', float: 'left', other: 'left', left: 'right', right: 'float', tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' },
    right: { max: 'right', float: 'right', other: 'right', right: 'left', left: 'float', tr: 'tl', tl: 'tr', br: 'bl', bl: 'br' },
    up: { float: 'max', other: 'max', left: 'tl', right: 'tr', bl: 'left', br: 'right', tl: 'max', tr: 'max' },
    down: { max: 'float', float: 'min', other: 'float', left: 'bl', right: 'br', tl: 'left', tr: 'right', bl: 'min', br: 'min' }
  };
  function key(dir, win = WS.wm.active) {
    if (!win || !win.resizable || win.minimized) return false;
    closeLayouts(); closeAssist();
    const p = prefs();
    let to = KEYS[dir][zone(win)];
    if (!to) return false;
    if (!p.enabled && !['max', 'float', 'min'].includes(to)) return false;
    if (!p.enabled && (dir === 'left' || dir === 'right')) return false;
    if (to === 'min') win.minimize();
    else if (to === 'max') { if (!win.maximized) win.toggleMax(); }
    else if (to === 'float') {
      if (win.maximized && win.snap) win.toggleMax(); // a maximized snapped window goes back to its zone
      else WS.wm.unsnap(win);
    } else snapTo(win, to);
    return true;
  }

  WS.snap = { LAYOUTS, ZONES, zone, snapTo, key, attach, dragStart, dragMove, dragEnd, openLayouts, closeLayouts, assist, closeAssist, assisting,
    layoutsOpen: () => !!fly };
})();
