/* PowerShell output formatting (Out-Default / Format-Table / Format-List / Out-String).
 * Views per type name: WS.ps.view(typeName, { table: { columns: [{ label, value, width, align }], groupBy: { label, value } }
 *                                            | list: [prop | { label, value }] | custom: (items, width) => lines,
 *                                            listProps: [...] (Format-List default) })
 * Objects without a view: <= 4 properties -> table, otherwise list (PowerShell's rule).
 * formatOut(items, width) -> array of lines, with PowerShell's blank-line spacing. */
(function () {
  'use strict';
  const WS = window.WS;
  const PS = WS.ps;
  const { toStr, typeName, PSHashtable, ScriptBlock, SecureString, TypeRef } = PS;

  const views = {};
  const view = (type, def) => { views[type] = def; return def; };

  /** Text for a table cell or list value. */
  function cell(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return '{' + v.map(cell).join(', ') + '}';
    if (v instanceof Date) return PS.fmtDateTime(v);
    if (typeof v === 'number') return toStr(v);
    return toStr(v);
  }
  const visibleProps = o => Object.keys(o);
  const getter = c => (typeof c.value === 'function' ? c.value : o => PS.getProp(o, c.value || c.label));
  const trunc = (s, w) => (s.length > w ? (w > 3 ? s.slice(0, w - 3) + '...' : s.slice(0, w)) : s);

  /**
   * rows: objects; columns: [{ label, get(o) | value, width, align }]
   * o.autosize ignores fixed widths; o.hideHeaders; o.wrap.
   */
  function renderTable(rows, columns, width, o = {}) {
    const cols = columns.map(c => ({ ...c, get: c.get || getter(c) }));
    const data = rows.map(r => cols.map(c => cell(c.get(r))));
    const raw = rows.map(r => cols.map(c => c.get(r)));
    cols.forEach((c, i) => {
      if (!c.align) c.align = raw.length && raw.every(rw => typeof rw[i] === 'number' || rw[i] == null) && raw.some(rw => typeof rw[i] === 'number') ? 'right' : 'left';
      const labelW = Math.max(...String(c.label).split('\n').map(l => l.length));
      c.w = c.width && !o.autosize ? c.width : Math.max(labelW, ...data.map(d => d[i].length), 1);
    });
    // fit to the console: shrink the widest automatic columns, then drop what still doesn't fit
    const total = () => cols.reduce((a, c) => a + c.w, 0) + cols.length - 1;
    let guard = 0;
    while (total() > width && guard++ < 200) {
      const auto = cols.slice(0, -1).filter(c => !(c.width && !o.autosize) && c.w > 8);
      if (!auto.length) break;
      const widest = auto.reduce((a, b) => (b.w > a.w ? b : a));
      widest.w = Math.max(8, widest.w - Math.max(1, Math.ceil((total() - width) / auto.length)));
    }
    let shown = cols.length;
    while (shown > 1 && cols.slice(0, shown - 1).reduce((a, c) => a + c.w + 1, 0) + 4 > width) shown--;
    const used = cols.slice(0, shown - 1).reduce((a, c) => a + c.w + 1, 0);
    cols[shown - 1].w = Math.max(4, Math.min(cols[shown - 1].w, width - used - 1));
    const vis = cols.slice(0, shown);
    const pad = (s, c, last) => { s = trunc(s, c.w); return c.align === 'right' ? s.padStart(c.w) : last ? s : s.padEnd(c.w); };
    const lines = [];
    if (!o.hideHeaders) {
      const headLines = Math.max(...vis.map(c => String(c.label).split('\n').length));
      for (let k = 0; k < headLines; k++) {
        lines.push(vis.map((c, i) => { const parts = String(c.label).split('\n'); const t = parts[k - (headLines - parts.length)] || ''; return pad(t, c, i === vis.length - 1); }).join(' ').replace(/\s+$/, ''));
      }
      lines.push(vis.map((c, i) => { const lw = Math.max(...String(c.label).split('\n').map(l => l.length)); return pad('-'.repeat(Math.min(lw, c.w)), c, i === vis.length - 1); }).join(' ').replace(/\s+$/, ''));
    }
    for (const d of data) lines.push(vis.map((c, i) => pad(d[i], c, i === vis.length - 1)).join(' ').replace(/\s+$/, ''));
    return lines;
  }
  function renderList(objs, props) {
    const out = [];
    for (const o of objs) {
      const ps = (props || visibleProps(o)).map(p => (typeof p === 'string' ? { label: p, get: x => PS.getProp(x, p) } : { ...p, get: p.get || getter(p) }));
      const w = Math.max(...ps.map(p => p.label.length), 0);
      out.push('');
      for (const p of ps) {
        const v = cell(p.get(o));
        const lines = v.split('\n');
        out.push(`${p.label.padEnd(w)} : ${lines[0]}`.replace(/\s+$/, ''));
        for (const l of lines.slice(1)) out.push(' '.repeat(w + 3) + l);
      }
    }
    return out;
  }
  function hashtableRows(hs) {
    const rows = [];
    for (const h of hs) for (const [k, v] of h.entries()) rows.push({ Name: k, Value: v });
    return rows;
  }
  const isScalar = v => v == null || typeof v !== 'object' || v instanceof Date || v instanceof ScriptBlock || v instanceof SecureString || v instanceof TypeRef;

  function flatten(items) {
    const out = [];
    const walk = a => { for (const v of a) { if (Array.isArray(v)) walk(v); else out.push(v); } };
    walk(items);
    return out;
  }

  /** Lines for a type run using its view, or the default rule. */
  function formatRun(group, width) {
    const first = group[0];
    if (first && first.__fmt) return group.flatMap(g => g.lines);
    if (first instanceof PSHashtable) return ['', ...renderTable(hashtableRows(group), [{ label: 'Name', width: 30 }, { label: 'Value' }], width), '', ''];
    if (first instanceof PS.ErrorRecord) return group.map(r => PS.formatError(r));
    const v = views[typeName(first)];
    if (v && v.custom) return v.custom(group, width);
    if (v && v.table) {
      const t = v.table;
      if (t.groupBy) {
        const out = [];
        let cur = null, batch = [];
        const flush = () => { if (batch.length) { out.push('', '', `${' '.repeat(t.groupBy.indent == null ? 4 : t.groupBy.indent)}${t.groupBy.label}: ${cur}`, '', ...(t.groupBy.indent === 3 ? [] : ['']), ...renderTable(batch, t.columns, width)); batch = []; } };
        for (const o of group) { const g = t.groupBy.value(o); if (g !== cur) { flush(); cur = g; } batch.push(o); }
        flush();
        return [...out, '', ''];
      }
      return ['', ...renderTable(group, t.columns, width), '', ''];
    }
    if (v && v.list) return [...renderList(group, v.list), '', ''];
    const props = visibleProps(first);
    if (props.length && props.length <= 4) return ['', ...renderTable(group, props.map(p => ({ label: p, value: p })), width), '', ''];
    return [...renderList(group), '', ''];
  }

  function formatOut(items, width = 120) {
    const list = flatten(items);
    const lines = [];
    let i = 0;
    while (i < list.length) {
      const v = list[i];
      if (v === undefined || v === null) { i++; continue; }
      if (isScalar(v)) {
        if (v instanceof Date) lines.push('', `${WS.util.fmtLongDate(v)} ${WS.util.fmtTime(v, true)}`, '', '');
        else lines.push(...toStr(v).split(/\r?\n/));
        i++;
        continue;
      }
      const t = v.__fmt ? '__fmt' : typeName(v);
      let j = i + 1;
      while (j < list.length && list[j] != null && !isScalar(list[j]) && (list[j].__fmt ? '__fmt' : typeName(list[j])) === t) j++;
      lines.push(...formatRun(list.slice(i, j), width));
      i = j;
    }
    // PowerShell never ends output with more than two blank lines
    while (lines.length > 2 && lines[lines.length - 1] === '' && lines[lines.length - 2] === '' && lines[lines.length - 3] === '') lines.pop();
    return lines;
  }
  /** A pre-formatted block (Format-Table / Format-List output). */
  const fmtBlock = lines => { const o = { lines }; Object.defineProperty(o, '__fmt', { value: true }); Object.defineProperty(o, '__type', { value: 'Microsoft.PowerShell.Commands.Internal.Format.FormatStartData' }); return o; };

  Object.assign(PS, { views, view, cell, renderTable, renderList, formatOut, fmtBlock, visibleProps });
})();
