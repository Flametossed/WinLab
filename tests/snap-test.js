/* Window snapping: drag to an edge, corner or the top with the preview, Snap Assist, shared-edge resizing, restoring by
 * dragging, the snap layouts flyout (maximize button and Win+Z), the snap layouts bar, Win+arrow keys, title bar shake
 * and Settings > System > Multitasking.
 * &shot=preview|assist|corner|bar|flyout|keys|settings stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* not yet */ } await wait(50); } return false; };
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const layer = () => document.getElementById('windows');
  const L = () => layer().getBoundingClientRect();
  const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
  /** The window's box relative to the desktop. */
  const box = w => { const r = w.el.getBoundingClientRect(), l = L(); return { x: r.left - l.left, y: r.top - l.top, w: r.width, h: r.height }; };
  const ptr = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: L().left + x, clientY: L().top + y, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, pointerType: 'mouse' }));
  /** Press on the title bar and move through the points (desktop coordinates); release unless hold. */
  async function drag(win, points, hold) {
    const b = box(win), bar = win.bar;
    ptr(bar, 'pointerdown', b.x + Math.min(120, b.w / 3), b.y + 14);
    for (const [x, y] of points) { ptr(bar, 'pointermove', x, y); await wait(25); }
    if (!hold) { const [x, y] = points[points.length - 1]; ptr(bar, 'pointerup', x, y); await wait(60); }
  }
  const release = async (win, x, y) => { ptr(win.bar, 'pointerup', x, y); await wait(60); };
  const assistEl = () => document.querySelector('.snap-assist:not(.waiting)');
  const thumbs = () => [...document.querySelectorAll('.snap-assist .snap-thumb')];
  const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));

  try {
    await waitFor(() => WS.session && WS.session.loggedIn, 10000);
    await wait(300);
    WS.wm.closeAll();
    WS.apps.launch('notepad'); WS.apps.launch('control'); WS.apps.launch('explorer');
    await wait(200);
    const np = WS.wm.find('notepad'), cp = WS.wm.find('control'), ex = WS.wm.find('explorer');
    const { clientWidth: W, clientHeight: H } = layer();
    t('three resizable windows are open', !!np && !!cp && !!ex && np.resizable && cp.resizable && ex.resizable);

    /* ---------------- drag to the left edge ---------------- */
    const floatW = np.el.offsetWidth, floatH = np.el.offsetHeight;
    WS.wm.focus(np);
    await drag(np, [[300, 300], [100, 300], [0, 300]], true);
    const pv = document.querySelector('.snap-preview');
    t('dragging to the left edge shows the snap preview', !!pv);
    await wait(250);
    t('the preview covers the left half', !!pv && near(pv.offsetLeft, 6) && near(pv.offsetWidth, W / 2 - 12, 4) && near(pv.offsetHeight, H - 12, 4), pv && [pv.offsetLeft, pv.offsetWidth, pv.offsetHeight]);
    t('the preview sits under the dragged window', !!pv && pv.nextElementSibling === np.el && pv.style.zIndex === np.el.style.zIndex);
    if (stop('preview')) return;
    await release(np, 0, 300);
    t('releasing snaps the window to the left half', WS.snap.zone(np) === 'left' && near(box(np).x, 0) && near(box(np).w, W / 2) && near(box(np).h, H), box(np));
    t('the preview is gone', !document.querySelector('.snap-preview'));
    t('a snapped window is laid out in percentages (it follows the desktop size)', np.el.style.width.endsWith('%') && np.el.classList.contains('snapped'));

    /* ---------------- Snap Assist ---------------- */
    t('Snap Assist opens in the right half', !!assistEl() && near(assistEl().offsetLeft, W / 2 + 6, 3) && near(assistEl().offsetWidth, W / 2 - 12, 4));
    t('it offers the other two windows', thumbs().length === 2 && thumbs().some(x => x.dataset.app === 'control') && thumbs().some(x => x.dataset.app === 'explorer'));
    t('each thumbnail shows the title and a copy of the window', thumbs().every(x => x.querySelector('.snap-thumb-title').textContent.trim() && x.querySelector('.snap-thumb-view .win[inert]')));
    t('the copies carry no element ids', !document.querySelector('.snap-assist [id]'));
    t('the first thumbnail has the keyboard focus', document.activeElement === thumbs()[0]);
    if (stop('assist')) return;
    thumbs().find(x => x.dataset.app === 'control').click(); await wait(60);
    t('picking a thumbnail snaps that window into the right half', WS.snap.zone(cp) === 'right' && near(box(cp).x, W / 2) && near(box(cp).w, W / 2));
    t('Snap Assist closes when the layout is full', !document.querySelector('.snap-assist'));

    /* ---------------- shared edge ---------------- */
    const rz = np.el.querySelector('.rz.e');
    ptr(rz, 'pointerdown', W / 2, 300); ptr(rz, 'pointermove', W * 0.6, 300); ptr(rz, 'pointerup', W * 0.6, 300); await wait(30);
    t('resizing the edge between snapped windows moves both', near(box(np).w, W * 0.6, 3) && near(box(cp).x, W * 0.6, 3) && near(box(cp).x + box(cp).w, W, 2), [box(np), box(cp)]);
    t('...and both stay snapped', !!np.snap && !!cp.snap && near(np.snap.w, 0.6, 0.01) && near(cp.snap.x, 0.6, 0.01));

    /* ---------------- restore by dragging ---------------- */
    const b0 = box(np);
    ptr(np.bar, 'pointerdown', b0.x + 100, 14); ptr(np.bar, 'pointerup', b0.x + 100, 14); await wait(30);
    t('a click on a snapped title bar leaves it snapped', WS.snap.zone(np) !== 'float');
    await drag(np, [[b0.x + 110, 30], [500, 250]]);
    t('dragging a snapped window away restores its size', !np.snap && near(np.el.offsetWidth, floatW, 2) && near(np.el.offsetHeight, floatH, 2), [np.el.offsetWidth, floatW]);
    t('...under the pointer', box(np).x < 500 && box(np).x + box(np).w > 500 && box(np).y <= 250 && box(np).y + 32 >= 236, box(np));
    t('it has its rounded corners back', !np.el.classList.contains('snapped'));
    t('nothing is offered after a plain move', !document.querySelector('.snap-assist'));

    /* ---------------- corner ---------------- */
    WS.wm.unsnap(cp);
    await drag(np, [[300, 200], [0, 2]]);
    t('dragging to the top-left corner snaps to a quarter', WS.snap.zone(np) === 'tl' && near(box(np).w, W / 2) && near(box(np).h, H / 2));
    t('Snap Assist continues in the quadrant layout (one zone offered, two waiting)', !!assistEl() && document.querySelectorAll('.snap-assist.waiting').length === 2);
    if (stop('corner')) return;
    key('Escape'); await wait(30);
    t('Esc closes Snap Assist', !document.querySelector('.snap-assist'));
    const cpFrom = box(cp);
    await drag(cp, [[400, 400], [W - 1, H - 2]]);
    t('the bottom-right corner snaps to that quarter', WS.snap.zone(cp) === 'br');
    WS.wm.unsnap(cp);
    t('restoring it puts it back where the drag started, not where it ended', near(box(cp).x, cpFrom.x) && near(box(cp).y, cpFrom.y), [box(cp), cpFrom]);
    WS.snap.snapTo(cp, 'br', { assist: true });
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await wait(30);
    t('clicking elsewhere closes Snap Assist', !document.querySelector('.snap-assist'));

    /* ---------------- top edge ---------------- */
    await drag(ex, [[300, 300], [80, 100], [80, 0]], true);
    t('the top edge (away from the layouts bar) previews a maximized window', !!document.querySelector('.snap-preview') && near(document.querySelector('.snap-preview').offsetWidth, W - 12, 4));
    await release(ex, 80, 0);
    t('releasing there maximizes it', ex.maximized && WS.snap.zone(ex) === 'max');
    const b1 = box(ex);
    ptr(ex.bar, 'pointerdown', 400, 14); ptr(ex.bar, 'pointerup', 400, 14); await wait(30);
    t('a click on a maximized title bar leaves it maximized', ex.maximized && near(box(ex).w, b1.w));
    await drag(ex, [[410, 20], [600, 300]]);
    t('dragging it down restores it', !ex.maximized && ex.el.offsetWidth < W);

    /* ---------------- snap layouts bar ---------------- */
    await drag(ex, [[W / 2, 200], [W / 2, 80]], true);
    const sb = () => document.querySelector('.snap-bar');
    t('dragging toward the top centre shows the snap layouts hint', !!sb() && !sb().classList.contains('open'));
    ptr(ex.bar, 'pointermove', W / 2, 4); await wait(60);
    t('reaching it opens the six layouts', !!sb() && sb().classList.contains('open') && sb().querySelectorAll('.snap-layout').length === 6);
    const third = sb().querySelectorAll('.snap-layout')[2].querySelectorAll('.snap-lzone')[1].getBoundingClientRect();
    const tx = third.left + third.width / 2 - L().left, ty = third.top + third.height / 2 - L().top;
    ptr(ex.bar, 'pointermove', tx, ty); await wait(250);
    t('hovering a zone highlights it and previews it', sb().querySelector('.snap-lzone.hot') && near(document.querySelector('.snap-preview').offsetLeft, W / 3 + 6, 3));
    if (stop('bar')) return;
    await release(ex, tx, ty);
    t('dropping on it snaps the window to the middle third', !!ex.snap && near(box(ex).x, W / 3, 2) && near(box(ex).w, W / 3, 2) && !sb());
    t('Snap Assist offers the other windows in the next zone', !!assistEl() && near(assistEl().offsetLeft, 6, 3) && document.querySelectorAll('.snap-assist.waiting').length === 1);
    thumbs()[0].click(); await wait(60);
    t('...and then the last zone', !!assistEl() && near(assistEl().offsetLeft, 2 * W / 3 + 6, 3) && thumbs().length === 1);
    thumbs()[0].click(); await wait(60);
    t('three windows fill the three columns', [np, cp, ex].every(w => near(w.snap.w, 1 / 3, 0.01)) && !document.querySelector('.snap-assist'));

    /* ---------------- maximize button flyout ---------------- */
    WS.wm.focus(np);
    np.btnMax.dispatchEvent(new PointerEvent('pointerenter')); await wait(600);
    const fly = () => document.querySelector('.snap-flyout');
    t('hovering the maximize button opens the snap layouts', !!fly() && fly().querySelectorAll('.snap-layout').length === 6);
    const fr = fly() && fly().getBoundingClientRect(), mr = np.btnMax.getBoundingClientRect();
    t('it opens under the button', !!fr && fr.top >= mr.bottom - 1 && fr.top - mr.bottom < 12);
    if (stop('flyout')) return;
    fly().querySelectorAll('.snap-layout')[3].querySelectorAll('.snap-lzone')[2].click(); await wait(60);
    t('clicking a zone snaps the window there', !fly() && near(np.snap.x, 0.5) && near(np.snap.y, 0.5) && near(np.snap.h, 0.5));
    t('...and Snap Assist offers the rest of that layout', !!assistEl() && document.querySelectorAll('.snap-assist.waiting').length === 1);
    key('Escape'); await wait(30);
    np.btnMax.dispatchEvent(new PointerEvent('pointerenter')); await wait(100);
    np.btnMax.dispatchEvent(new PointerEvent('pointerleave')); await wait(500);
    t('a quick pass over the button opens nothing', !fly());

    /* ---------------- Win+Z ---------------- */
    WS.snap.openLayouts(np, { keys: true }); await wait(30);
    t('Win+Z numbers the layouts', !!fly() && fly().querySelectorAll('.snap-num.layout').length === 6);
    key('5'); await wait(30);
    t('a number picks a layout and numbers its zones', fly().classList.contains('chosen') && fly().querySelector('.snap-layout.sel') === fly().querySelectorAll('.snap-layout')[4]);
    if (stop('keys')) return;
    key('4'); await wait(60);
    t('a second number snaps to that zone', WS.snap.zone(np) === 'br' && !fly());
    key('Escape'); await wait(30);

    /* ---------------- maximize and restore keep the snap ---------------- */
    np.toggleMax();
    t('maximizing a snapped window fills the desktop', np.maximized && near(box(np).w, W));
    np.toggleMax();
    t('restoring it puts it back in its zone', WS.snap.zone(np) === 'br');

    /* ---------------- Win+arrow keys ---------------- */
    WS.wm.unsnap(np); WS.wm.focus(np);
    const seq = [];
    for (const k of ['left', 'left', 'left', 'right', 'up', 'down', 'down', 'up', 'up', 'up']) { WS.snap.key(k); WS.snap.closeAssist(); seq.push(np.minimized ? 'min' : WS.snap.zone(np)); }
    t('Win+Left, Left, Left: left half, right half, restored', seq.slice(0, 3).join() === 'left,right,float', seq);
    t('Win+Right: right half; Up: top-right quarter; Down, Down: right half, bottom-right quarter', seq.slice(3, 7).join() === 'right,tr,right,br', seq);
    t('Win+Up, Up, Up: right half, top-right quarter, maximized', seq.slice(7).join() === 'right,tr,max', seq);
    WS.snap.key('down');
    t('Win+Down on a maximized window goes back to its zone', WS.snap.zone(np) === 'tr');
    WS.wm.unsnap(np); WS.wm.focus(np);
    WS.snap.key('down');
    t('Win+Down on a floating window minimizes it', np.minimized);
    np.restore();
    WS.snap.key('right'); await wait(30);
    t('a Win+arrow snap is followed by Snap Assist', !!assistEl() && near(assistEl().offsetLeft, 6, 3));
    key('ArrowRight'); await wait(20);
    t('the arrow keys move between thumbnails', document.activeElement === thumbs()[1]);
    const pickApp = thumbs()[1].dataset.app;
    key('Enter'); await wait(60);
    t('Enter picks the focused one', WS.snap.zone(WS.wm.find(pickApp)) === 'left' && !document.querySelector('.snap-assist'));
    const dlg = WS.wm.create({ app: 'testdlg', title: 'Fixed', width: 300, height: 200, resizable: false });
    t('a window that cannot be resized does not snap', WS.snap.key('left') === false && !dlg.snap && !WS.wm.snap(dlg, WS.snap.ZONES.left.rect));
    dlg.close();

    /* ---------------- shake ---------------- */
    [np, cp, ex].forEach(w => WS.wm.unsnap(w));
    WS.wm.focus(np);
    const shakePath = [[400, 300], [460, 300], [400, 300], [460, 300], [400, 300], [460, 300], [400, 300]];
    await drag(np, shakePath);
    t('title bar shake is off by default', !cp.minimized && !ex.minimized);
    WS.personal.set({ snap: { shake: true } });
    await drag(np, shakePath);
    t('with it on, shaking minimizes the other windows', cp.minimized && ex.minimized && !np.minimized);
    await drag(np, shakePath);
    t('shaking again brings them back', !cp.minimized && !ex.minimized);
    WS.personal.set({ snap: { shake: false } });

    /* ---------------- Settings > System > Multitasking ---------------- */
    WS.apps.launch('settings', { page: 'multitasking' }); await wait(200);
    const st = WS.wm.find('settings');
    const pg = st.el;
    t('Settings has a Multitasking page with Snap windows', pg.textContent.includes('Snap windows') && pg.textContent.includes('Title bar window shake'));
    t('it lists the snap options, all on', ['hoverMax', 'dragTop', 'groups', 'assist', 'nearEdge'].every(f => pg.querySelector(`[data-field="snap-${f}"]`).checked));
    if (stop('settings')) return;
    const cb = pg.querySelector('[data-field="snap-assist"]');
    cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true }));
    t('clearing a box saves it', WS.personal.snap().assist === false);
    WS.wm.focus(np);
    WS.snap.key('left'); await wait(30);
    t('without the suggestion option no Snap Assist follows a snap', WS.snap.zone(np) === 'left' && !document.querySelector('.snap-assist'));
    WS.wm.unsnap(np);
    const hv = pg.querySelector('[data-field="snap-hoverMax"]');
    hv.checked = false; hv.dispatchEvent(new Event('change', { bubbles: true }));
    np.btnMax.dispatchEvent(new PointerEvent('pointerenter')); await wait(600);
    t('without the hover option the maximize button opens no layouts', !fly());
    np.btnMax.dispatchEvent(new PointerEvent('pointerleave'));
    pg.querySelector('[data-field="snap"]').click(); await wait(100);
    t('turning Snap windows off saves it and greys the options', WS.personal.snap().enabled === false && WS.wm.find('settings').el.querySelector('[data-field="snap-dragTop"]').disabled);
    WS.wm.focus(np);
    await drag(np, [[300, 300], [0, 300]], true);
    t('with Snap off, the edge shows no preview', !document.querySelector('.snap-preview'));
    await release(np, 0, 300);
    t('...and does not snap', !np.snap);
    t('Win+Left does nothing', WS.snap.key('left') === false && !np.snap);
    WS.snap.key('up');
    t('Win+Up still maximizes', np.maximized);
    np.toggleMax();
    WS.personal.set({ snap: { ...WS.personal.SNAP_DEFAULTS } });
    t('older saved states get the default options', (() => { const keep = WS.state.personal.snap; delete WS.state.personal.snap; const ok = WS.personal.snap().enabled === true && WS.personal.snap().shake === false; WS.state.personal.snap = keep; return ok; })());
  } catch (e) {
    t('no exception', false, String(e && e.stack || e));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
