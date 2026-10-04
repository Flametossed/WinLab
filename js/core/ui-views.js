/* UI toolkit, part 2: tree view and list view (Win32 SysTreeView32 / SysListView32 "details" look).
 *
 * WS.ui.tree({ nodes, onSelect(node), onActivate(node), onContext(node, x, y), onExpand(node) })
 *   nodes: array or () => array. Node: { id (unique string), label, icon, iconOpen, children: array | () => array,
 *          hasChildren (skip resolving children just to draw the expander), expanded (initial), bold, data }
 *   -> { el, refresh(), select(id, {silent}), expand(id), collapse(id), reveal(path ids), selected(), node(id), focus() }
 *   Children are re-read on every refresh(), so trees over live model data stay current.
 *
 * WS.ui.listView({ columns, rows, getId, icon, multi, sortKey, sortDir, emptyText, rowClass, groupLabel,
 *                  onSelect(rows), onActivate(row), onContext(rows, x, y), onKey(e, rows) })
 *   emptyText: a string, a node, or () => either. groupLabel(rows) -> text for a group header row above the rows
 *   (Server Manager's "DC01 (4)"; there is only ever one group).
 *   columns: [{ key, label, width, align: 'right', type: 'text'|'num'|'date'|'ip', value(row), render(row) -> string|node }]
 *   rows: array or () => array.  Selection survives refresh() (matched by getId).
 *   -> { el, refresh(), selected(), select(ids), selectAll(), focus(), rows(), sortBy(key, dir) } */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util;

  /* ================================================================ tree */
  function tree(opts) {
    const el = h('div.tv', { tabIndex: 0 });
    const expanded = new Set();
    const initialDone = new Set();
    let selectedId = null;
    let byId = new Map(), parentOf = new Map(), visible = [];
    const resolve = x => (typeof x === 'function' ? x() : x || []).filter(Boolean);
    const kids = node => resolve(node.children);

    function render() {
      const top = el.scrollTop;
      U.clear(el);
      byId = new Map(); parentOf = new Map(); visible = [];
      const walk = (nodes, depth, parent) => {
        for (const n of nodes) {
          byId.set(n.id, n);
          if (parent) parentOf.set(n.id, parent.id);
          if (n.expanded && !initialDone.has(n.id)) { expanded.add(n.id); initialDone.add(n.id); }
          initialDone.add(n.id);
          const isOpen = expanded.has(n.id);
          const children = isOpen || n.hasChildren == null ? kids(n) : null;
          const hasKids = n.hasChildren != null ? n.hasChildren : children.length > 0;
          const row = h('div.tv-row' + (n.id === selectedId ? '.sel' : ''), { style: { paddingLeft: (4 + depth * 16) + 'px' }, dataset: { id: n.id } },
            h('span.tv-exp', { html: hasKids ? (isOpen ? WS.icons.chevronDown : WS.icons.chevronRight) : '' }),
            n.icon ? h('span.tv-ic', { html: isOpen && n.iconOpen ? n.iconOpen : n.icon }) : null,
            h('span.tv-lbl' + (n.bold ? '.b' : ''), n.label));
          el.appendChild(row);
          visible.push(n.id);
          if (isOpen && hasKids) walk(children, depth + 1, n);
        }
      };
      walk(resolve(opts.nodes), 0, null);
      if (selectedId && !byId.has(selectedId)) selectedId = null;
      el.scrollTop = top;
    }
    function rowOf(id) { return el.querySelector(`.tv-row[data-id="${CSS.escape(id)}"]`); }
    function select(id, o = {}) {
      if (!byId.has(id)) return;
      const changed = id !== selectedId;
      selectedId = id;
      el.querySelectorAll('.tv-row.sel').forEach(r => r.classList.remove('sel'));
      const r = rowOf(id);
      if (r) { r.classList.add('sel'); scrollIntoView(el, r); }
      if (changed && !o.silent && opts.onSelect) opts.onSelect(byId.get(id));
    }
    function toggle(id, open) {
      const n = byId.get(id);
      if (!n) return;
      const isOpen = expanded.has(id);
      if (open === undefined) open = !isOpen;
      if (open === isOpen) return;
      if (open) expanded.add(id); else expanded.delete(id);
      // collapsing a node that holds the selection moves the selection to it (as Windows does)
      if (!open && selectedId && isUnder(selectedId, id)) { render(); select(id); return; }
      render();
      if (open && opts.onExpand) opts.onExpand(n);
    }
    function isUnder(id, ancestor) { let p = parentOf.get(id); while (p) { if (p === ancestor) return true; p = parentOf.get(p); } return false; }

    el.addEventListener('pointerdown', e => {
      const row = e.target.closest('.tv-row');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('.tv-exp') && e.button === 0) { toggle(id); return; }
      if (e.button === 0 || e.button === 2) select(id);
    });
    el.addEventListener('dblclick', e => {
      const row = e.target.closest('.tv-row');
      if (!row || e.target.closest('.tv-exp')) return;
      const n = byId.get(row.dataset.id);
      if (opts.onActivate && opts.onActivate(n) === true) return;
      toggle(row.dataset.id);
    });
    el.addEventListener('contextmenu', e => {
      const row = e.target.closest('.tv-row');
      if (!row) return;
      e.preventDefault();
      if (opts.onContext) opts.onContext(byId.get(row.dataset.id), e.clientX, e.clientY);
    });
    el.addEventListener('keydown', e => {
      if (WS.ui.menusOpen()) return;
      const i = visible.indexOf(selectedId);
      const go = j => { if (visible[j]) select(visible[j]); };
      const n = byId.get(selectedId);
      let handled = true;
      switch (e.key) {
        case 'ArrowDown': go(i < 0 ? 0 : Math.min(visible.length - 1, i + 1)); break;
        case 'ArrowUp': go(Math.max(0, i - 1)); break;
        case 'Home': go(0); break;
        case 'End': go(visible.length - 1); break;
        case 'ArrowRight':
          if (!n) break;
          if (!expanded.has(n.id) && (n.hasChildren != null ? n.hasChildren : kids(n).length)) toggle(n.id, true);
          else { const k = kids(n)[0]; if (k && expanded.has(n.id)) select(k.id); }
          break;
        case 'ArrowLeft':
          if (!n) break;
          if (expanded.has(n.id)) toggle(n.id, false); else if (parentOf.get(n.id)) select(parentOf.get(n.id));
          break;
        case 'Enter': if (n && opts.onActivate) opts.onActivate(n); break;
        case 'ContextMenu': case 'F10':
          if (e.key === 'F10' && !e.shiftKey) { handled = false; break; }
          if (n && opts.onContext) { const r = rowOf(n.id).getBoundingClientRect(); opts.onContext(n, r.left + 20, r.bottom, true); }
          break;
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey) typeAhead(e.key); else handled = false;
      }
      if (handled) e.preventDefault();
    });
    let typed = '', typedAt = 0;
    function typeAhead(ch) {
      const now = Date.now();
      typed = now - typedAt > 800 ? ch.toLowerCase() : typed + ch.toLowerCase();
      typedAt = now;
      const start = Math.max(0, visible.indexOf(selectedId) + (typed.length === 1 ? 1 : 0));
      const order = [...visible.slice(start), ...visible.slice(0, start)];
      const hit = order.find(id => String(byId.get(id).label).toLowerCase().startsWith(typed));
      if (hit) select(hit);
    }

    render();
    return {
      el,
      refresh: render,
      select,
      expand: id => toggle(id, true),
      collapse: id => toggle(id, false),
      isExpanded: id => expanded.has(id),
      /** Expand every id in the path, then select the last one. */
      reveal(path) { for (const id of path.slice(0, -1)) { expanded.add(id); } render(); select(path[path.length - 1]); },
      selected: () => byId.get(selectedId) || null,
      node: id => byId.get(id) || null,
      parent: id => byId.get(parentOf.get(id)) || null,
      focus: () => el.focus()
    };
  }

  function scrollIntoView(container, row) {
    const head = container.querySelector('.lv-head');
    const top = row.offsetTop - (head ? head.offsetHeight : 0);
    if (top < container.scrollTop) container.scrollTop = top;
    else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight;
  }

  /* ================================================================ list view */
  const COMPARE = {
    text: (a, b) => String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, { sensitivity: 'base', numeric: true }),
    num: (a, b) => (Number(a) || 0) - (Number(b) || 0),
    date: (a, b) => (a ? new Date(a).getTime() : 0) - (b ? new Date(b).getTime() : 0),
    ip: (a, b) => (U.ipToInt(a) || 0) - (U.ipToInt(b) || 0)
  };

  function listView(opts) {
    const cols = opts.columns.map(c => ({ width: 120, type: 'text', ...c }));
    const getId = opts.getId || (r => r.id);
    const el = h('div.lv', { tabIndex: 0 });
    const head = h('div.lv-head');
    const body = h('div.lv-body');
    el.appendChild(head); el.appendChild(body);
    let data = [], view = [];
    let sel = new Set(), anchor = null, focusId = null;
    let sortKey = opts.sortKey !== undefined ? opts.sortKey : cols[0].key, sortDir = opts.sortDir || 1;
    const valueOf = (c, r) => (c.value ? c.value(r) : r[c.key]);

    function renderHead() {
      U.clear(head);
      cols.forEach((c, i) => {
        const cell = h('div.lv-hc' + (c.align === 'right' ? '.r' : ''), { style: { width: c.width + 'px' }, dataset: { col: i } },
          h('span.lv-hl', c.label),
          sortKey === c.key ? h('span.lv-sort', sortDir > 0 ? '˄' : '˅') : null,
          h('span.lv-grip'));
        cell.addEventListener('click', e => { if (e.target.closest('.lv-grip')) return; sortBy(c.key, sortKey === c.key ? -sortDir : 1); });
        cell.querySelector('.lv-grip').addEventListener('pointerdown', e => startResize(e, i));
        cell.querySelector('.lv-grip').addEventListener('dblclick', () => autoSize(i));
        head.appendChild(cell);
      });
      head.appendChild(h('div.lv-hc.fill'));
    }
    function startResize(e, i) {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startW = cols[i].width;
      const grip = e.target;
      grip.setPointerCapture(e.pointerId);
      const move = ev => { cols[i].width = Math.max(24, startW + ev.clientX - startX); applyWidth(i); };
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    }
    function applyWidth(i) { el.querySelectorAll(`[data-col="${i}"]`).forEach(c => { c.style.width = cols[i].width + 'px'; }); }
    function autoSize(i) {
      let w = 40;
      el.querySelectorAll(`[data-col="${i}"]`).forEach(c => { w = Math.max(w, c.scrollWidth + 12); });
      cols[i].width = Math.min(600, w); applyWidth(i);
    }

    function sortRows() {
      view = data.slice();
      const c = cols.find(x => x.key === sortKey);
      if (!c) return;
      const cmp = typeof c.sort === 'function' ? c.sort : COMPARE[c.type] || COMPARE.text;
      view.sort((a, b) => sortDir * cmp(valueOf(c, a), valueOf(c, b), a, b));
    }
    function renderBody() {
      U.clear(body);
      if (!view.length) { const e = typeof opts.emptyText === 'function' ? opts.emptyText() : opts.emptyText; body.appendChild(h('div.lv-empty', e || '')); return; }
      if (opts.groupLabel) body.appendChild(h('div.lv-group', opts.groupLabel(view)));
      for (const r of view) {
        const id = String(getId(r));
        const row = h('div.lv-row' + (sel.has(id) ? '.sel' : '') + (id === focusId ? '.focus' : ''), { dataset: { id } });
        if (opts.rowClass) String(opts.rowClass(r) || '').split(/\s+/).filter(Boolean).forEach(c => row.classList.add(c));
        cols.forEach((c, i) => {
          const content = c.render ? c.render(r) : valueOf(c, r);
          const cell = h('div.lv-c' + (c.align === 'right' ? '.r' : ''), { style: { width: c.width + 'px' }, dataset: { col: i } },
            i === 0 && opts.icon ? h('span.lv-ic', { html: opts.icon(r) || '' }) : null,
            content instanceof Node ? content : h('span.lv-t', content == null ? '' : String(content)));
          row.appendChild(cell);
        });
        body.appendChild(row);
      }
    }
    function refresh() {
      data = (typeof opts.rows === 'function' ? opts.rows() : opts.rows || []).filter(Boolean);
      const ids = new Set(data.map(r => String(getId(r))));
      const before = sel.size;
      sel = new Set([...sel].filter(id => ids.has(id)));
      if (focusId && !ids.has(focusId)) focusId = null;
      sortRows();
      const top = el.scrollTop;
      renderHead(); renderBody();
      el.scrollTop = top;
      if (sel.size !== before) fireSelect();
    }
    function sortBy(key, dir) { sortKey = key; sortDir = dir || 1; sortRows(); renderHead(); renderBody(); }
    const rowById = id => data.find(r => String(getId(r)) === id);
    const selectedRows = () => view.filter(r => sel.has(String(getId(r))));
    function fireSelect() { if (opts.onSelect) opts.onSelect(selectedRows()); }
    function paint() {
      body.querySelectorAll('.lv-row').forEach(r => { r.classList.toggle('sel', sel.has(r.dataset.id)); r.classList.toggle('focus', r.dataset.id === focusId); });
    }
    function setSel(ids, focus) {
      sel = new Set(ids.map(String));
      if (focus !== undefined) focusId = focus == null ? null : String(focus);
      paint();
      if (focusId) { const r = body.querySelector(`.lv-row[data-id="${CSS.escape(focusId)}"]`); if (r) scrollIntoView(el, r); }
      fireSelect();
    }
    const order = () => view.map(r => String(getId(r)));
    function clickRow(id, e) {
      if (opts.multi && e.shiftKey && anchor) {
        const o = order(); const a = o.indexOf(anchor), b = o.indexOf(id);
        const range = o.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSel(e.ctrlKey ? [...new Set([...sel, ...range])] : range, id);
      } else if (opts.multi && e.ctrlKey) {
        const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id);
        anchor = id; setSel([...s], id);
      } else { anchor = id; setSel([id], id); }
    }

    body.addEventListener('pointerdown', e => {
      const row = e.target.closest('.lv-row');
      if (!row) { if (e.button === 0 && !e.ctrlKey) setSel([], null); return; }
      if (e.button === 2) { if (!sel.has(row.dataset.id)) { anchor = row.dataset.id; setSel([row.dataset.id], row.dataset.id); } return; }
      if (e.button === 0) clickRow(row.dataset.id, e);
    });
    body.addEventListener('dblclick', e => {
      const row = e.target.closest('.lv-row');
      if (row && opts.onActivate) opts.onActivate(rowById(row.dataset.id));
    });
    el.addEventListener('contextmenu', e => {
      if (e.target.closest('.lv-head')) { e.preventDefault(); return; }
      e.preventDefault();
      const row = e.target.closest('.lv-row');
      if (!row && sel.size) setSel([], null);
      if (opts.onContext) opts.onContext(row ? selectedRows() : [], e.clientX, e.clientY);
    });
    el.addEventListener('keydown', e => {
      if (WS.ui.menusOpen()) return;
      const o = order();
      if (!o.length) return;
      const i = focusId ? o.indexOf(focusId) : -1;
      const page = Math.max(1, Math.floor(el.clientHeight / 22) - 1);
      const moveTo = j => {
        j = U.clamp(j, 0, o.length - 1);
        const id = o[j];
        if (opts.multi && e.shiftKey && anchor) { const a = o.indexOf(anchor); setSel(o.slice(Math.min(a, j), Math.max(a, j) + 1), id); }
        else if (opts.multi && e.ctrlKey) { focusId = id; paint(); }
        else { anchor = id; setSel([id], id); }
      };
      let handled = true;
      switch (e.key) {
        case 'ArrowDown': moveTo(i + 1); break;
        case 'ArrowUp': moveTo(i < 0 ? 0 : i - 1); break;
        case 'Home': moveTo(0); break;
        case 'End': moveTo(o.length - 1); break;
        case 'PageDown': moveTo(i + page); break;
        case 'PageUp': moveTo(i - page); break;
        case ' ': if (opts.multi && e.ctrlKey && focusId) { const s = new Set(sel); if (s.has(focusId)) s.delete(focusId); else s.add(focusId); setSel([...s]); } else handled = false; break;
        case 'Enter': if (opts.onActivate && sel.size) opts.onActivate(selectedRows()[0]); else handled = false; break;
        case 'ContextMenu':
          if (opts.onContext) { const r = body.querySelector('.lv-row.focus') || body.querySelector('.lv-row.sel'); const b = (r || el).getBoundingClientRect(); opts.onContext(selectedRows(), b.left + 30, r ? b.bottom : b.top + 30, true); }
          break;
        default:
          if (e.key === 'a' && e.ctrlKey && opts.multi) { setSel(o, focusId || o[0]); break; }
          if (e.key === 'F10' && e.shiftKey && opts.onContext) { const r = body.querySelector('.lv-row.focus'); const b = (r || el).getBoundingClientRect(); opts.onContext(selectedRows(), b.left + 30, b.bottom, true); break; }
          if (opts.onKey && opts.onKey(e, selectedRows()) === true) break;
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey) typeAhead(e.key); else handled = false;
      }
      if (handled) e.preventDefault();
    });
    let typed = '', typedAt = 0;
    function typeAhead(ch) {
      const now = Date.now();
      typed = now - typedAt > 800 ? ch.toLowerCase() : typed + ch.toLowerCase();
      typedAt = now;
      const o = order();
      const c0 = cols[0];
      const start = Math.max(0, o.indexOf(focusId) + (typed.length === 1 ? 1 : 0));
      const seq = [...view.slice(start), ...view.slice(0, start)];
      const hit = seq.find(r => String(valueOf(c0, r) == null ? '' : valueOf(c0, r)).toLowerCase().startsWith(typed));
      if (hit) { const id = String(getId(hit)); anchor = id; setSel([id], id); }
    }

    refresh();
    return {
      el, refresh, sortBy,
      selected: selectedRows,
      select(ids) { ids = [].concat(ids).map(String); anchor = ids[0] || null; setSel(ids, ids[ids.length - 1] || null); },
      selectAll() { setSel(order(), focusId); },
      rows: () => view.slice(),
      columns: () => cols,
      focus: () => el.focus(),
      get sortKey() { return sortKey; }, get sortDir() { return sortDir; }
    };
  }

  WS.ui.tree = tree;
  WS.ui.listView = listView;
})();
