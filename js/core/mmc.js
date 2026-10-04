/* MMC frame: the Microsoft Management Console shell every .msc tool reuses.
 *
 * WS.mmc.create({ app, title, icon, width, height, maximized, nodes, select, topics, actionsPane: 'more' | 'full', treeWidth (px),
 *                 fileMenu(mmc), viewMenu(mmc), onClose })  -> mmc
 *   nodes: array or () => array of scope (console tree) nodes:
 *     { id, label, icon, iconOpen, children, hasChildren, expanded, description,
 *       menu(mmc) -> items           snap-in items for the node's context menu / Action menu
 *       properties(mmc)              adds Properties
 *       view: viewDef | (node, mmc) => viewDef }
 *   viewDef (result pane):
 *     list:   { columns, rows(), getId, icon(row), multi, sortKey, sortDir, emptyText, rowClass,
 *               menu(rows, mmc) -> items, properties(row, mmc), onActivate(row, mmc) (default: properties),
 *               delete(rows, mmc), rename(row, mmc), toolbar: [{icon, title, action(rows, mmc), enabled(rows, mmc)}],
 *               extended(rows, mmc) -> node  (adds the Extended/Standard tabs and the left description panel),
 *               header(mmc) -> string | node  (a title line above the list, e.g. Event Viewer's "System  Number of events: 52"),
 *               preview(rows, mmc) -> node | null  (a resizable pane below the list, repainted on every selection change),
 *               hasProperties(row) -> bool (default: every row has Properties when view.properties is set),
 *               exportList: false (no Export List... for this list, as in Event Viewer),
 *               status(rows, mmc) -> string, itemLabel(row) -> Actions pane heading }
 *     custom: { render(container, mmc) -> { refresh?() } , menu, toolbar, status }
 *   topics: store topics that refresh the console (e.g. ['services']).
 * mmc: { win, tree, list, current(), select(id), selectPath(ids), refresh(), selection(), setStatus(text),
 *        contextFor(target), showTree(bool), showActions(bool) }
 * Menus get the standard MMC entries appended (View, Refresh, Export List..., Properties, Help). */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons;

  /** Remove leading, trailing and doubled separators (and falsy entries). */
  function tidy(items) {
    const out = [];
    for (const it of items.filter(Boolean)) {
      if (it.separator && (!out.length || out[out.length - 1].separator)) continue;
      out.push(it);
    }
    while (out.length && out[out.length - 1].separator) out.pop();
    return out;
  }

  function create(o) {
    const win = WS.wm.create({ app: o.app, title: o.title, icon: o.icon || I.mmc, width: o.width || 980, height: o.height || 640, maximized: o.maximized });
    const opts = { tree: o.showTree !== false, actions: o.showActions !== false, toolbar: true, status: true, menus: true, snapinToolbars: true, descBar: false };
    let current = null, view = null, list = null, custom = null, focusPane = 'scope';
    let extendedMode = true, previewHeight = 0;
    const history = [], future = [];
    const sortMemory = {};

    const root = h('div.mmc');
    const menuHost = h('div.mmc-menus');
    const toolHost = h('div.mmc-tools');
    const treePane = h('div.mmc-tree', o.treeWidth ? { style: { width: o.treeWidth + 'px' } } : null);
    const resultPane = h('div.mmc-result');
    const descBar = h('div.mmc-desc');
    const resultBody = h('div.mmc-rbody');
    const resultTabs = h('div.mmc-rtabs');
    const actionsPane = h('div.mmc-actions');
    const status = h('div.mmc-status');
    const split1 = h('div.mmc-split'), split2 = h('div.mmc-split');
    resultPane.appendChild(descBar); resultPane.appendChild(resultBody); resultPane.appendChild(resultTabs);
    root.appendChild(menuHost); root.appendChild(toolHost);
    root.appendChild(h('div.mmc-main', treePane, split1, resultPane, split2, actionsPane));
    root.appendChild(status);
    win.body.appendChild(root);

    const mmc = {
      win, get tree() { return tree; }, get list() { return list; },
      current: () => current, view: () => view,
      select: id => { tree.select(id); },
      selectPath: ids => tree.reveal(ids),
      refresh, selection, setStatus: t => { status.textContent = t || ''; },
      showTree: v => { opts.tree = !!v; layout(); }, showActions: v => { opts.actions = !!v; layout(); },
      contextFor, scopeMenu, resultMenu, back, forward, up
    };

    /* ---------------- scope tree ---------------- */
    const tree = WS.ui.tree({
      nodes: o.nodes,
      onSelect: n => { if (current && current.id !== n.id) { history.push(current.id); future.length = 0; } showNode(n); },
      onContext: (n, x, y, kb) => { focusPane = 'scope'; WS.ui.contextMenu(x, y, scopeMenu(n), { keyboard: kb }); },
      onActivate: () => false
    });
    treePane.appendChild(tree.el);
    tree.el.addEventListener('focus', () => { focusPane = 'scope'; paintChrome(); });
    tree.el.addEventListener('pointerdown', () => { focusPane = 'scope'; });

    function resolveView(n) { return n ? (typeof n.view === 'function' ? n.view(n, mmc) : n.view) || null : null; }
    function selection() { return list ? list.selected() : []; }
    /** Properties applies to exactly one row whose view has properties (view.hasProperties(row) can exclude rows, e.g. DNS folders). */
    const hasProps = rows => !!(view && view.properties && rows.length === 1 && (!view.hasProperties || view.hasProperties(rows[0])));

    function showNode(n) {
      if (list && current) sortMemory[current.id] = { key: list.sortKey, dir: list.sortDir };
      current = n;
      view = resolveView(n);
      U.clear(resultBody);
      list = null; custom = null;
      if (view && view.render) {
        custom = view.render(resultBody, mmc) || {};
      } else if (view && view.columns) {
        const mem = sortMemory[n.id] || {};
        list = WS.ui.listView({
          columns: view.columns, getId: view.getId, icon: view.icon, multi: view.multi !== false, emptyText: view.emptyText || 'There are no items to show in this view.',
          rowClass: view.rowClass, sortKey: mem.key !== undefined ? mem.key : view.sortKey, sortDir: mem.dir || view.sortDir,
          rows: () => (view && view.rows ? view.rows() : []),
          onSelect: () => { paintChrome(); },
          onActivate: row => activate(row),
          onContext: (rows, x, y, kb) => { focusPane = 'result'; WS.ui.contextMenu(x, y, rows.length ? resultMenu(rows) : backgroundMenu(), { keyboard: kb }); },
          onKey: (e, rows) => {
            if (e.key === 'Delete' && view.delete && rows.length) { view.delete(rows, mmc); return true; }
            if (e.key === 'F2' && view.rename && rows.length === 1) { view.rename(rows[0], mmc); return true; }
            if (e.key === 'Enter' && e.altKey && hasProps(rows.slice(0, 1))) { view.properties(rows[0], mmc); return true; }
            return false;
          }
        });
        list.el.addEventListener('focus', () => { focusPane = 'result'; paintChrome(); });
        list.el.addEventListener('pointerdown', () => { focusPane = 'result'; });
        const wrap = h('div.mmc-listwrap');
        if (view.extended) { wrap.appendChild(h('div.mmc-ext')); }
        wrap.appendChild(list.el);
        if (view.header) resultBody.appendChild(h('div.mmc-lhead'));
        resultBody.appendChild(wrap);
        if (view.preview) {
          const pv = h('div.mmc-preview', { style: { height: (previewHeight || 230) + 'px' } });
          const hs = h('div.mmc-hsplit');
          resultBody.appendChild(hs); resultBody.appendChild(pv);
          dragPreview(hs, pv);
        }
      } else {
        resultBody.appendChild(h('div.mmc-empty', view && view.emptyText || 'There are no items to show in this view.'));
      }
      paintChrome();
    }
    function activate(row) {
      if (!view) return;
      if (view.onActivate) view.onActivate(row, mmc);
      else if (view.properties) view.properties(row, mmc);
    }

    /* ---------------- menus ---------------- */
    const viewItems = () => tidy([
      ...(o.viewMenu ? o.viewMenu(mmc) : []),
      { separator: true },
      { label: 'Customi&ze...', action: customize }
    ]);
    const helpItem = () => ({ label: '&Help', action: help });
    function scopeMenu(n) {
      const v = resolveView(n);
      return tidy([
        ...(n.menu ? n.menu(mmc) : []),
        { separator: true },
        { label: '&View', items: viewItems },
        { label: 'New &Window from Here', disabled: true },
        { separator: true },
        { label: 'Re&fresh', action: refresh },
        v && v.columns && v.exportList !== false ? { label: 'Export &List...', action: exportList } : null,
        { separator: true },
        n.properties ? { label: 'P&roperties', action: () => n.properties(mmc) } : null,
        { separator: true },
        helpItem()
      ]);
    }
    function resultMenu(rows) {
      return tidy([
        ...(view && view.menu ? view.menu(rows, mmc) : []),
        { separator: true },
        hasProps(rows) ? { label: 'P&roperties', default: !view.onActivate, action: () => view.properties(rows[0], mmc) } : null,
        { separator: true },
        helpItem()
      ]);
    }
    function backgroundMenu() {
      return tidy([
        ...(view && view.menu ? view.menu([], mmc) : []),
        { separator: true },
        { label: 'Re&fresh', action: refresh },
        view && view.columns && view.exportList !== false ? { label: 'Export &List...', action: exportList } : null,
        { separator: true },
        { label: '&View', items: viewItems },
        { separator: true },
        helpItem()
      ]);
    }
    /** What the Action menu shows: the selected result items if the result pane has focus, else the scope node. */
    function contextFor(target) {
      const rows = selection();
      if ((target || focusPane) === 'result' && rows.length) return resultMenu(rows);
      return current ? scopeMenu(current) : [];
    }

    const bar = WS.ui.menuBar([
      { label: '&File', items: () => tidy([
        ...(o.fileMenu ? o.fileMenu(mmc) : []),
        { separator: true },
        { label: '&Options...', disabled: true },
        { separator: true },
        { label: 'E&xit', action: () => win.close() }
      ]) },
      { label: '&Action', items: () => contextFor() },
      { label: '&View', items: viewItems },
      { label: '&Help', items: () => [
        { label: '&Help Topics', action: help },
        { separator: true },
        { label: '&About Microsoft Management Console...', action: about }
      ] }
    ]);
    menuHost.appendChild(bar.el);

    /* ---------------- toolbar ---------------- */
    let tb = null;
    function buildToolbar() {
      const vt = view && view.toolbar && opts.snapinToolbars ? view.toolbar : [];
      const rows = () => selection();
      tb = WS.ui.toolbar([
        { icon: I.back, title: 'Back', action: back, enabled: () => history.length > 0 },
        { icon: I.forward, title: 'Forward', action: forward, enabled: () => future.length > 0 },
        { icon: I.up, title: 'Up One Level', action: up, enabled: () => !!(current && tree.parent(current.id)) },
        { icon: I.showTree, title: 'Show/Hide Console Tree', action: () => { opts.tree = !opts.tree; layout(); }, checked: () => opts.tree },
        { separator: true },
        { icon: I.properties, title: 'Properties', action: () => { const r = rows(); if (focusPane === 'result' && hasProps(r)) view.properties(r[0], mmc); else if (current && current.properties) current.properties(mmc); },
          enabled: () => (focusPane === 'result' && hasProps(rows())) || !!(current && current.properties && (focusPane !== 'result' || !rows().length)) },
        { icon: I.refresh, title: 'Refresh', action: refresh },
        { icon: I.exportList, title: 'Export List', action: exportList, enabled: () => !!list && view.exportList !== false },
        { separator: true },
        { icon: I.help, title: 'Help', action: help },
        { icon: I.showActions, title: 'Show/Hide Action Pane', action: () => { opts.actions = !opts.actions; layout(); }, checked: () => opts.actions },
        vt.length ? { separator: true } : null,
        ...vt.map(b => ({ icon: b.icon, title: b.title, action: () => b.action(rows(), mmc), enabled: () => (b.enabled ? !!b.enabled(rows(), mmc) : true) }))
      ]);
      U.clear(toolHost);
      toolHost.appendChild(tb);
    }

    /* ---------------- actions pane ---------------- */
    const collapsed = new Set();
    function renderActions() {
      U.clear(actionsPane);
      if (!current) return;
      const section = (key, title, items) => {
        const sec = h('div.act-sec');
        const isOpen = !collapsed.has(key);
        sec.appendChild(h('div.act-head', { onClick: () => { if (isOpen) collapsed.add(key); else collapsed.delete(key); renderActions(); } },
          h('span.act-title', title), h('span.act-tog', isOpen ? '▲' : '▼')));
        if (isOpen) for (const it of items) {
          if (it.separator) continue;
          const row = h('div.act-item' + (it.disabled ? '.disabled' : ''), h('span.act-ic', { html: it.icon || '' }), h('span.act-lbl', WS.ui.plain(it.label)), it.items ? h('span.act-more', { html: I.chevronRight }) : null);
          row.addEventListener('click', () => {
            if (it.disabled) return;
            if (it.items) { const r = row.getBoundingClientRect(); WS.ui.contextMenu(r.left, r.bottom, typeof it.items === 'function' ? it.items() : it.items); }
            else if (it.action) it.action();
          });
          sec.appendChild(row);
        }
        actionsPane.appendChild(sec);
      };
      const full = (current.actionsPane || o.actionsPane) === 'full';
      const scopeItems = full ? scopeMenu(current).filter(it => !/^&?Help$/.test(it.label || '')) : [{ label: 'More Actions', items: () => scopeMenu(current) }];
      section('scope', current.label, scopeItems);
      const rows = selection();
      if (rows.length && view) {
        const label = rows.length > 1 ? 'Selected Items' : view.itemLabel ? view.itemLabel(rows[0]) : String(view.columns[0].value ? view.columns[0].value(rows[0]) : rows[0][view.columns[0].key]);
        const items = full ? resultMenu(rows).filter(it => !/^&?Help$/.test(it.label || '')) : [{ label: 'More Actions', items: () => resultMenu(rows) }];
        section('item', label, items);
      }
    }

    /* ---------------- chrome refresh ---------------- */
    function paintChrome() {
      buildToolbar();
      renderActions();
      // extended view panel + tabs
      const ext = resultBody.querySelector('.mmc-ext');
      U.clear(resultTabs);
      if (view && view.extended && list) {
        if (ext) {
          ext.style.display = extendedMode ? '' : 'none';
          if (extendedMode) { U.clear(ext); const c = view.extended(list.selected(), mmc); if (c) ext.appendChild(c); }
        }
        for (const [label, on] of [['Extended', true], ['Standard', false]]) {
          resultTabs.appendChild(h('div.mmc-rtab' + (extendedMode === on ? '.sel' : ''), { onClick: () => { extendedMode = on; paintChrome(); } }, label));
        }
        resultTabs.style.display = '';
      } else resultTabs.style.display = 'none';
      const lhead = resultBody.querySelector('.mmc-lhead');
      if (lhead && view && view.header) {
        const c = view.header(mmc);
        U.clear(lhead);
        if (c instanceof Node) lhead.appendChild(c); else lhead.textContent = c == null ? '' : String(c);
      }
      const pv = resultBody.querySelector('.mmc-preview');
      if (pv && view && view.preview) {
        const c = list ? view.preview(list.selected(), mmc) : null;
        U.clear(pv);
        if (c) pv.appendChild(c);
      }
      descBar.textContent = current && current.description ? current.description : '';
      const rows = selection();
      status.textContent = view && view.status ? view.status(rows, mmc) || '' : '';
      layout();
    }
    function layout() {
      treePane.style.display = opts.tree ? '' : 'none';
      split1.style.display = opts.tree ? '' : 'none';
      actionsPane.style.display = opts.actions ? '' : 'none';
      split2.style.display = opts.actions ? '' : 'none';
      toolHost.style.display = opts.toolbar ? '' : 'none';
      status.style.display = opts.status ? '' : 'none';
      menuHost.style.display = opts.menus ? '' : 'none';
      descBar.style.display = opts.descBar && descBar.textContent ? '' : 'none';
      if (tb) tb.update();
    }

    function refresh() {
      const id = current && current.id;
      tree.refresh();
      let n = id ? tree.node(id) : null;
      if (!n) {
        const fallback = (id && history.slice().reverse().map(x => tree.node(x)).find(Boolean)) || tree.node((typeof o.nodes === 'function' ? o.nodes() : o.nodes)[0].id);
        if (fallback) { tree.select(fallback.id, { silent: true }); showNode(fallback); }
        return;
      }
      current = n;
      const nv = resolveView(n);
      const sameShape = view && nv && !!view.columns === !!nv.columns && !!view.render === !!nv.render;
      if (!sameShape) { showNode(n); return; }
      view = nv;
      if (list) list.refresh();
      if (custom && custom.refresh) custom.refresh();
      paintChrome();
    }

    /* ---------------- navigation ---------------- */
    function back() { const id = history.pop(); if (!id) return; if (current) future.push(current.id); navigateSilently(id); }
    function forward() { const id = future.pop(); if (!id) return; if (current) history.push(current.id); navigateSilently(id); }
    function up() { const p = current && tree.parent(current.id); if (p) tree.select(p.id); }
    function navigateSilently(id) { const n = tree.node(id); if (!n) return; tree.select(id, { silent: true }); showNode(n); }

    /* ---------------- standard commands ---------------- */
    function customize() {
      const c = {
        tree: WS.ui.f.checkbox('Console tree', opts.tree),
        menus: WS.ui.f.checkbox('Standard menus (Action and View)', opts.menus),
        toolbar: WS.ui.f.checkbox('Standard toolbar', opts.toolbar),
        status: WS.ui.f.checkbox('Status bar', opts.status),
        descBar: WS.ui.f.checkbox('Description bar', opts.descBar),
        actions: WS.ui.f.checkbox('Action pane', opts.actions),
        snapinToolbars: WS.ui.f.checkbox('Toolbars', opts.snapinToolbars)
      };
      const content = h('div.w32',
        h('div', { style: 'margin-bottom:6px' }, 'Select or clear the check boxes to show or hide items in the console window.'),
        WS.ui.f.group('MMC', c.tree, c.menus, c.toolbar, c.status, c.descBar, c.actions),
        WS.ui.f.group('Snap-in', c.snapinToolbars));
      WS.ui.dialog({ title: 'Customize View', width: 380, content, buttons: [{ label: 'OK', primary: true, value: 'ok' }] }).then(() => {
        for (const k of Object.keys(c)) opts[k] = c[k].checked;
        buildToolbar(); layout();
      });
    }
    async function exportList() {
      if (!list) return;
      const path = await WS.ui.filePicker({ mode: 'save', title: 'Export List', defaultName: (current.label || 'list').replace(/[\\/:*?"<>|]/g, ''),
        filters: [{ label: 'Text (Tab Delimited)(*.txt)', ext: ['.txt'] }, { label: 'Text (Comma Delimited)(*.csv)', ext: ['.csv'] }] });
      if (!path) return;
      const csv = /\.csv$/i.test(path);
      const cols = list.columns();
      const cell = (c, r) => { const v = c.render ? c.render(r) : (c.value ? c.value(r) : r[c.key]); const s = v instanceof Node ? v.textContent : v == null ? '' : String(v); return csv && /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const sep = csv ? ',' : '\t';
      const text = [cols.map(c => c.label).join(sep), ...list.rows().map(r => cols.map(c => cell(c, r)).join(sep))].join('\r\n') + '\r\n';
      try { WS.fs.writeFile(path, text); } catch (e) { WS.ui.msgbox({ title: 'Export List', message: e.message, icon: 'error' }); }
    }
    function help() { WS.ui.msgbox({ title: o.title, icon: 'info', message: 'Help is not available in the lab simulator.', detail: 'Use the Lab Guide for hints about the current lab.' }); }
    function about() {
      WS.ui.msgbox({ title: 'About Microsoft Management Console', icon: 'info', message: `Microsoft Management Console\nVersion 3.0 (OS Build ${WS.state.system.build})`,
        detail: 'Windows Server 2025 Lab Simulator. A training mock-up; not affiliated with or endorsed by Microsoft.' });
    }

    /* ---------------- splitters ---------------- */
    function dragSplit(splitEl, pane, side) {
      splitEl.addEventListener('pointerdown', e => {
        e.preventDefault();
        const start = e.clientX, w0 = pane.offsetWidth;
        splitEl.setPointerCapture(e.pointerId);
        const move = ev => { pane.style.width = U.clamp(w0 + (side === 'left' ? ev.clientX - start : start - ev.clientX), 120, 520) + 'px'; };
        const upH = () => { splitEl.removeEventListener('pointermove', move); splitEl.removeEventListener('pointerup', upH); };
        splitEl.addEventListener('pointermove', move);
        splitEl.addEventListener('pointerup', upH);
      });
    }
    dragSplit(split1, treePane, 'left');
    dragSplit(split2, actionsPane, 'right');
    /** The list/preview splitter (Event Viewer); the height is kept while the console is open. */
    function dragPreview(splitEl, pane) {
      splitEl.addEventListener('pointerdown', e => {
        e.preventDefault();
        const start = e.clientY, h0 = pane.offsetHeight;
        splitEl.setPointerCapture(e.pointerId);
        const max = Math.max(120, resultBody.offsetHeight - 80);
        const move = ev => { previewHeight = U.clamp(h0 + start - ev.clientY, 60, max); pane.style.height = previewHeight + 'px'; };
        const upH = () => { splitEl.removeEventListener('pointermove', move); splitEl.removeEventListener('pointerup', upH); };
        splitEl.addEventListener('pointermove', move);
        splitEl.addEventListener('pointerup', upH);
      });
    }

    /* ---------------- keyboard + live refresh ---------------- */
    root.addEventListener('keydown', e => {
      if (WS.ui.menusOpen()) return;
      if (e.key === 'F5') { e.preventDefault(); refresh(); }
      else if (e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); up(); }
      else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); back(); }
      else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); forward(); }
    });
    let pending = null;
    const schedule = () => { clearTimeout(pending); pending = setTimeout(() => { if (win.el.isConnected) refresh(); }, 30); };
    for (const t of o.topics || []) win.listen(t, schedule);
    if (o.onClose) win.onClose(o.onClose);

    const roots = typeof o.nodes === 'function' ? o.nodes() : o.nodes;
    const firstId = o.select || (roots[0] && roots[0].id);
    if (Array.isArray(firstId)) tree.reveal(firstId); else if (firstId) tree.select(firstId);
    if (!current && roots[0]) { tree.select(roots[0].id); }
    setTimeout(() => (list ? list.focus() : tree.focus()), 30);
    return mmc;
  }

  WS.mmc = { create, tidy };
})();
