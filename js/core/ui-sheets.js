/* UI toolkit, part 3: property sheets and wizards.
 *
 * WS.ui.propertySheet({ title, tabs: [{ label, render(sheet) -> node, apply(sheet) }], width, height, initialTab, errorTitle })
 *   -> Promise<boolean>: true if anything was applied (OK or Apply). onCreate(sheet) gets the live sheet (show(i), ok(), setDirty()).
 *   Tabs render lazily the first time they are shown. Any input/change inside the sheet enables Apply
 *   (sheet.setDirty() does it by hand; give a control data-nodirty to opt out). OK/Apply call apply() on every
 *   rendered tab in order; apply returns null/undefined/{ok:true} for success, or an error string / {ok:false, error}:
 *   the sheet then shows that tab and an error box, and stays open ({ok:false, silent:true} stays open without the box).
 *
 * WS.ui.wizard({ title, icon, style: 'classic' | 'server' | 'steps', pages, data, onFinish(w), finishLabel,
 *                width, height, asWindow, app, destination })
 *   -> Promise<{ finished, data }>; onCreate(w) gets the live wizard object.
 *   page: { id, title, subtitle, nav (left-hand label, server style), kind: 'welcome' | 'complete' (classic watermark pages),
 *           render(w) -> node (once; set rerender: true to rebuild each visit), enter(w), validate(w) -> error string | false | null,
 *           skip(w) -> bool, finish: true (server style: the page where the Finish/"Install" button is enabled),
 *           sub: true (indented step), navHidden: true (no step of its own), navAs: id (highlight that page's step),
 *           nextLabel: 'Finish' (classic: rename Next on this page, e.g. where the work is done before a status page), noBack: true }
 *   w: { data, page, next(), back(), goto(id), setNext(bool), setFinish(bool), busy(bool), close(finished), done, el }
 *   Classic: < Back | Next > | Cancel, and Finish on the last page.
 *   Server (Add Roles and Features style): left step list, < Previous | Next > | <finishLabel> | Cancel. After onFinish
 *   succeeds, a page after the finish page (Results) is shown and Cancel becomes Close.
 *   finishAnywhere: true (server style, Hyper-V's wizards): Finish works on every page and closes the wizard. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util;

  const errorOf = r => (typeof r === 'string' ? r : r && r.ok === false ? (r.error || 'The operation failed.') : null);

  /* ================================================================ property sheet */
  function propertySheet(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 420, height: o.height, className: 'w32-dlg psheet', closeValue: false });
    const tabsEl = h('div.ps-tabs');
    const pagesEl = h('div.ps-pages');
    frame.body.appendChild(h('div.w32.ps', tabsEl, pagesEl));
    let cur = -1, dirty = false, applied = false;
    const sheet = {
      frame, data: o.data || {},
      setDirty() { dirty = true; applyBtn.disabled = false; },
      get dirty() { return dirty; },
      show,
      close: () => frame.close(applied)
    };
    const tabs = o.tabs.filter(Boolean).map(t => ({ ...t, el: null }));
    const tabBtns = tabs.map((t, i) => {
      const b = h('div.ps-tab', { onClick: () => show(i) }, t.label);
      tabsEl.appendChild(b);
      return b;
    });
    function show(i) {
      if (i === cur) return;
      cur = i;
      tabBtns.forEach((b, j) => b.classList.toggle('sel', j === i));
      for (const t of tabs) if (t.el) t.el.style.display = 'none';
      const t = tabs[i];
      if (!t.el) {
        t.el = h('div.ps-page');
        const content = t.render(sheet);
        if (content) t.el.appendChild(content);
        pagesEl.appendChild(t.el);
      }
      t.el.style.display = '';
      if (t.onShow) t.onShow(sheet);
    }
    frame.body.addEventListener('input', e => { if (!e.target.closest('[data-nodirty]')) sheet.setDirty(); }, true);
    frame.body.addEventListener('change', e => { if (!e.target.closest('[data-nodirty]')) sheet.setDirty(); }, true);

    async function applyAll() {
      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        if (!t.el || !t.apply) continue;
        let r;
        try { r = await t.apply(sheet); } catch (e) { r = e.message; }
        if (r && r.ok === false && r.silent) { show(i); return false; }   // the tab already explained (e.g. a declined confirmation)
        const err = errorOf(r);
        if (err) {
          show(i);
          await WS.ui.msgbox({ title: o.errorTitle || o.title, message: err, icon: 'error' });
          return false;
        }
      }
      dirty = false; applyBtn.disabled = true; applied = true;
      if (o.onApplied) o.onApplied(sheet);
      return true;
    }
    const okBtn = h('button.btn.primary', { onClick: async () => { if (!dirty || await applyAll()) frame.close(applied); } }, 'OK');
    const cancelBtn = h('button.btn', { onClick: () => frame.close(applied) }, 'Cancel');
    const applyBtn = h('button.btn', { disabled: true, onClick: () => applyAll() }, o.applyLabel || 'Apply');
    [okBtn, cancelBtn, applyBtn].forEach(b => frame.footer.appendChild(b));
    frame.onEnter = () => okBtn.click();
    frame.onEscape = () => frame.close(applied);
    frame.onKey = e => {
      if (e.key === 'Tab' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); show((cur + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length); return false; }
      return true;
    };
    sheet.applyBtn = applyBtn;
    sheet.ok = () => okBtn.click();
    if (o.onCreate) o.onCreate(sheet);
    show(Math.min(o.initialTab || 0, tabs.length - 1));
    WS.ui.focusFirst(frame, tabBtns[cur]);
    return frame.promise;
  }

  /* ================================================================ wizard */
  function wizard(o) {
    const style = o.style || 'classic';
    const server = style === 'server';
    const steps = style === 'steps';   // classic header and buttons plus a "Steps:" list (New Inbound Rule Wizard)
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const root = h('div.wz.' + (steps ? 'classic.steps' : style));
    let host;
    if (o.asWindow) {
      const win = WS.wm.create({ app: o.app || 'wizard', title: o.title, icon: o.icon || WS.icons.mmc, width: o.width || 800, height: o.height || 570 });
      win.body.appendChild(root);
      win.onClose(() => finishPromise(false));
      root.tabIndex = -1;
      root.addEventListener('keydown', e => onKey(e));
      host = { close: () => win.close(), win };
    } else {
      const frame = WS.ui.modal({ title: o.title, icon: o.icon, width: o.width || (server ? 800 : 500), height: o.height || (server ? 570 : 390), className: 'w32-dlg wz-dlg' });
      frame.footer.remove();
      frame.body.appendChild(root);
      frame.onEscape = () => cancel();
      frame.onKey = e => { onKey(e); return false; };
      host = { close: () => frame.close(), frame };
    }

    const w = {
      data: o.data || {}, page: null, done: false, el: root,
      next, back, goto, close: f => { finishPromise(!!f); host.close(); },
      setNext(v) { state.next = !!v; paintButtons(); },
      setFinish(v) { state.finish = !!v; paintButtons(); },
      busy(v) { state.busy = !!v; paintButtons(); },
      refreshNav: () => renderNav()
    };
    const state = { next: true, finish: true, busy: false };
    let settled = false;
    function finishPromise(finished) { if (!settled) { settled = true; resolve({ finished, data: w.data }); } }

    // layout
    const navEl = h('div.wz-nav');
    const headEl = h('div.wz-head');
    const contentEl = h('div.wz-content');
    const btnBack = h('button.btn', { onClick: () => back() }, server ? '< Previous' : '< Back');
    const btnNext = h('button.btn', { onClick: () => next() }, 'Next >');
    const btnFinish = h('button.btn', { onClick: () => finish() }, o.finishLabel || (server ? 'Install' : 'Finish'));
    const btnCancel = h('button.btn', { onClick: () => cancel() }, 'Cancel');
    const buttons = h('div.wz-buttons', btnBack, btnNext, server ? btnFinish : null, btnCancel);
    if (server) {
      const dest = o.destination != null ? o.destination : ('DESTINATION SERVER\n' + WS.sys.fqdn());
      root.appendChild(h('div.wz-top', h('div.wz-title'), h('div.wz-dest', dest)));
      root.appendChild(h('div.wz-main', navEl, contentEl));
    } else {
      root.appendChild(h('div.wz-main', headEl, steps ? h('div.wz-body', navEl, contentEl) : contentEl));
    }
    root.appendChild(buttons);

    const pages = o.pages.filter(Boolean);
    const active = () => pages.filter(p => !p.skip || !p.skip(w));
    const visited = new Set();
    let furthest = 0;

    function show(page) {
      w.page = page;
      visited.add(page.id);
      const list = active();
      furthest = Math.max(furthest, list.indexOf(page));
      state.next = true; state.finish = true;
      // content
      for (const p of pages) if (p._el) p._el.style.display = 'none';
      if (!page._el || page.rerender) {
        if (page._el) page._el.remove();
        page._el = h('div.wz-page' + (page.kind ? '.' + page.kind : ''));
        const c = page.render ? page.render(w) : null;
        if (!server && page.kind) {
          page._el.appendChild(h('div.wz-water'));
          page._el.appendChild(h('div.wz-wbody', h('h1', page.title || ''), c));
        } else if (c) page._el.appendChild(c);
        contentEl.appendChild(page._el);
      }
      page._el.style.display = '';
      // header / title
      if (server) {
        root.querySelector('.wz-title').textContent = page.title || '';
        renderNav();
      } else {
        U.clear(headEl);
        headEl.style.display = page.kind ? 'none' : '';
        if (!page.kind) headEl.appendChild(h('div.wz-htext', h('div.wz-ht', page.title || ''), h('div.wz-hs', page.subtitle || '')),);
        if (!page.kind && o.icon) headEl.appendChild(h('div.wz-hicon', { html: o.icon }));
        if (steps) renderNav();
      }
      if (page.enter) page.enter(w);
      paintButtons();
      setTimeout(() => {
        const f = page._el.querySelector('input:not([disabled]):not([type=radio]):not([type=checkbox]), textarea:not([readonly]), select:not([disabled])');
        if (f) f.focus(); else if (!btnNext.disabled) btnNext.focus(); else if (!btnFinish.disabled) btnFinish.focus();
      }, 30);
    }
    function renderNav() {
      if (!server && !steps) return;
      U.clear(navEl);
      if (steps) navEl.appendChild(h('div.wz-stitle', 'Steps:'));
      const list = active();
      list.forEach((p, i) => {
        if (p.navHidden) return;
        const cur = p === w.page || (w.page && w.page.navAs === p.id);
        const can = !steps && !w.done && !state.busy && (visited.has(p.id) && i <= furthest) && !cur;
        navEl.appendChild(h('div.wz-step' + (cur ? '.cur' : '') + (can ? '.can' : '') + (p.sub ? '.sub' : ''),
          { onClick: () => { if (can) goto(p.id); } }, p.nav || p.title));
      });
    }
    function paintButtons() {
      const list = active();
      const i = list.indexOf(w.page);
      const last = i === list.length - 1;
      const b = state.busy;
      btnBack.disabled = b || w.done || i <= 0 || !!(w.page && w.page.noBack);
      if (server) {
        btnNext.disabled = b || w.done || last || !state.next || !!(w.page && w.page.finish && !o.finishAnywhere);
        btnFinish.disabled = b || w.done || !(o.finishAnywhere || (w.page && w.page.finish)) || !state.finish;
      } else {
        const fin = last || (w.page && w.page.finish);
        btnNext.textContent = fin ? (o.finishLabel || 'Finish') : (w.page && w.page.nextLabel) || 'Next >';
        btnNext.disabled = b || !(fin ? state.finish : state.next);
      }
      btnCancel.textContent = w.done ? 'Close' : 'Cancel';
      btnCancel.disabled = b;
      renderNav();
    }
    async function validate() {
      const p = w.page;
      if (!p.validate) return true;
      let r;
      try { r = await p.validate(w); } catch (e) { r = e.message; }
      if (r === false) return false;
      const err = errorOf(r);
      if (err) { await WS.ui.msgbox({ title: o.title, message: err, icon: 'error' }); return false; }
      return true;
    }
    async function next() {
      if (state.busy) return;
      const list = active();
      const i = list.indexOf(w.page);
      if (!server && (i === list.length - 1 || w.page.finish)) return finish();
      if (btnNext.disabled) return;
      if (!(await validate())) return;
      const after = active(); // validation may change which pages apply
      const n = after[after.indexOf(w.page) + 1];
      if (n) show(n);
    }
    function back() {
      if (state.busy || w.done) return;
      const list = active();
      const p = list[list.indexOf(w.page) - 1];
      if (p) show(p);
    }
    function goto(id) { const p = active().find(x => x.id === id); if (p) show(p); }
    async function finish() {
      if (state.busy || w.done) return;
      if (!(await validate())) return;
      let r = null;
      if (o.onFinish) {
        state.busy = true; paintButtons();
        try { r = await o.onFinish(w); } catch (e) { r = e.message; }
        state.busy = false;
      }
      const err = errorOf(r);
      if (r === false || err) {
        if (err) await WS.ui.msgbox({ title: o.title, message: err, icon: 'error' });
        paintButtons();
        return;
      }
      finishPromise(true);
      const list = active();
      const after = list[list.indexOf(w.page) + 1];
      if (server && after && !o.finishAnywhere) { w.done = true; show(after); return; }
      host.close();
    }
    function cancel() {
      if (state.busy) return;
      finishPromise(w.done);
      host.close();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (e.key === 'Enter' && !['TEXTAREA', 'BUTTON'].includes(e.target.tagName) && !e.target.closest('.lv, .tv')) {
        e.preventDefault(); e.stopPropagation();
        if (server && (w.page.finish || (o.finishAnywhere && !btnFinish.disabled && btnNext.disabled))) { if (!btnFinish.disabled) finish(); }
        else if (!btnNext.disabled) next();
      }
    }

    w.promise = promise;
    if (o.onCreate) o.onCreate(w);
    const first = active()[0];
    if (first) show(first);
    return promise;
  }

  WS.ui.propertySheet = propertySheet;
  WS.ui.wizard = wizard;
})();
