/* Lab Guide: pick a lab, start it (reverts the server to the lab's start point), watch objectives tick off, and go back
 * to an earlier step (WS.labs.snapshots) after a mistake: "Go back to here" on a completed step, or Undo... for the list.
 * WS.labGuide.goBack(id, { confirm }) and undoDialog({ onCreate }) are what the buttons call (tests use them).
 * Next lab starts the lab after the active one in the list (WS.labGuide.nextLab(id)), with the usual confirmation. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons;

  const CHECK = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="#0f7b0f"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  /** A snapshot's time on the server's clock (the taskbar's time zone, not the browser's). */
  const serverTime = iso => U.fmtTime(WS.sys.now ? WS.sys.now(new Date(iso)) : new Date(iso));
  const OPEN = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="#8a8a8a" stroke-width="1.2"/></svg>';

  function launch() {
    const W = document.getElementById('windows').clientWidth;
    const win = WS.wm.create({ app: 'lab', title: 'Lab Guide', icon: I.lab, width: 400, height: 600, x: W - 420, y: 20 });
    const root = h('div.lab');
    win.body.appendChild(root);

    function render() {
      U.clear(root);
      const p = WS.labs.progress();
      if (p) renderActive(p); else renderList();
    }

    function renderActive(p) {
      const pct = Math.round((p.doneCount / p.total) * 100);
      root.appendChild(h('div.lab-head',
        h('div.lab-kicker', 'Active lab'),
        h('h2', p.lab.title),
        p.lab.description ? h('p.lab-desc', p.lab.description) : null,
        h('div.lab-bar', h('div', { style: { width: pct + '%' } })),
        h('div.lab-count', `${p.doneCount} of ${p.total} objectives complete`)));
      const list = h('div.lab-objs');
      const snaps = WS.labs.snapshots.list();
      // the snapshot taken when an objective completed (the latest one if it completed more than once after going back)
      const snapFor = id => snaps.filter(x => x.objectives.includes(id)).pop() || null;
      p.items.forEach((o, i) => {
        const hint = o.hint ? h('div.lab-hint', { style: 'display:none' }, o.hint) : null;
        const sn = o.done ? snapFor(o.id) : null;
        list.appendChild(h('div.lab-obj' + (o.done ? '.done' : ''), { dataset: { objective: o.id } },
          h('span.lab-mark', { html: o.done ? CHECK : OPEN }),
          h('div',
            h('div.lab-text', `${i + 1}. ${o.text}`),
            h('div.lab-links',
              hint ? h('a.lab-hintlink', { href: '#', onClick: e => { e.preventDefault(); hint.style.display = hint.style.display ? '' : 'none'; } }, 'Hint') : null,
              sn ? h('a.lab-hintlink.lab-back', { href: '#', title: `Return the server to how it was when step ${i + 1} was completed (${serverTime(sn.created)})`, onClick: e => { e.preventDefault(); goBack(sn.id); } }, 'Go back to here') : null),
            hint)));
      });
      root.appendChild(list);
      const complete = p.doneCount === p.total;
      if (complete) root.appendChild(h('div.lab-complete', 'Lab complete. Nice work!'));
      const next = nextLab(p.lab.id);
      root.appendChild(h('div.lab-actions.lab-run',
        next ? h('button.btn' + (complete ? '.primary' : ''), { dataset: { action: 'next-lab' }, title: `Start ${next.title}`, onClick: () => startLab(next) }, 'Next lab') : null,
        h('button.btn', { disabled: snaps.length < 1, title: 'Go back to the start of the lab or to an earlier step', onClick: () => undoDialog() }, 'Undo…'),
        h('button.btn', { onClick: async () => {
          const r = await WS.ui.msgbox({ title: 'Restart lab', icon: 'warning', message: 'Revert the server to the start of this lab?', detail: 'All changes made since the lab started will be lost. The server will restart.', buttons: ['Revert', 'Cancel'] });
          if (r === 'Revert') WS.labs.start(p.lab.id);
        } }, 'Restart lab'),
        h('button.btn', { onClick: () => WS.labs.stop() }, 'End lab')));
    }

    function renderList() {
      root.appendChild(h('div.lab-head', h('h2', 'Labs'),
        h('p.lab-desc', 'Starting a lab reverts this server to the lab’s starting point and restarts it. Your Administrator password is kept.')));
      const labs = WS.labs.list();
      if (!labs.length) root.appendChild(h('p.muted', 'No labs installed.'));
      for (const lab of labs) {
        root.appendChild(h('div.lab-card',
          h('div.lab-card-title', lab.title),
          h('div.lab-meta', `${lab.difficulty} · ~${lab.minutes} min · ${lab.objectives.length} objectives${lab.custom ? ' · imported' : ''}`),
          lab.description ? h('div.lab-card-desc', lab.description) : null,
          h('div.lab-card-actions',
            h('button.btn.primary', { onClick: () => startLab(lab) }, 'Start lab'),
            lab.custom ? h('button.btn', { onClick: () => { WS.labs.removeCustom(lab.id); render(); } }, 'Remove') : null)));
      }
      const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        const r = WS.labs.importJSON(await f.text());
        file.value = '';
        if (!r.ok) WS.ui.msgbox({ title: 'Import lab', icon: 'error', message: 'This lab file could not be imported.', detail: r.error });
        render();
      });
      root.appendChild(h('div.lab-actions', file, h('button.btn', { onClick: () => file.click() }, 'Import lab file…')));
    }

    async function startLab(lab) {
      const r = await WS.ui.msgbox({ title: 'Start lab', icon: 'question', message: `Start “${lab.title}”?`, detail: 'The server will be reverted to the lab’s starting point and restarted. Current changes will be lost.', buttons: ['Start', 'Cancel'] });
      if (r !== 'Start') return;
      const res = WS.labs.start(lab.id);
      if (!res.ok) WS.ui.msgbox({ title: 'Start lab', icon: 'error', message: res.error });
    }

    win.listen('lab', render);
    win.labGuide = { render };
    render();
    return win;
  }

  /** The lab after this one in the Lab Guide's list (the built-in labs in order, then imported ones), or null after the last. */
  function nextLab(id) {
    const all = WS.labs.list(), i = all.findIndex(l => l.id === id);
    return i >= 0 ? all[i + 1] || null : null;
  }

  /* ---------------------------------------------------------------- going back to a step */
  /** What reverting to a snapshot undoes: the objectives completed after it. */
  function lostSteps(x) {
    const p = WS.labs.progress(); if (!p) return [];
    const st = WS.labs.snapshots.get(x.id);
    const kept = st ? st.state.lab.completed || {} : {};
    return p.items.map((o, i) => ({ n: i + 1, o })).filter(e => e.o.done && !kept[e.o.id]);
  }
  async function goBack(id, o = {}) {
    const x = WS.labs.snapshots.list().find(s => s.id === id);
    if (!x) { await WS.ui.msgbox({ title: 'Go back', icon: 'error', message: 'That step snapshot is no longer available.' }); return false; }
    const label = WS.labs.snapshots.label(x);
    if (o.confirm !== false) {
      const lost = lostSteps(x);
      const detail = (x.kind === 'start' ? 'The server returns to the lab’s starting point.' : `The server returns to how it was at ${serverTime(x.created)}, when ${label.toLowerCase().replace(/ complete$/, '')} ${/^Steps/.test(label) ? 'were' : 'was'} completed.`) +
        ' Everything you did after that is lost' + (lost.length ? `, and step${lost.length > 1 ? 's' : ''} ${lost.map(e => e.n).join(', ')} will be open again` : '') + '. The server will restart.';
      const r = await WS.ui.msgbox({ title: 'Go back', icon: 'warning', message: x.kind === 'start' ? 'Go back to the start of the lab?' : `Go back to “${label}”?`, detail, buttons: ['Go back', 'Cancel'] });
      if (r !== 'Go back') return false;
    }
    const res = WS.labs.snapshots.revert(id);
    if (!res.ok) { await WS.ui.msgbox({ title: 'Go back', icon: 'error', message: res.error }); return false; }
    return true;
  }
  /** Undo...: every snapshot of this lab run, newest first, with Go back. */
  function undoDialog(o = {}) {
    const rows = () => WS.labs.snapshots.list().slice().reverse();
    const lv = WS.ui.listView({ columns: [{ key: 'label', label: 'Point', width: 200, value: x => WS.labs.snapshots.label(x) }, { key: 'created', label: 'Time', width: 90, type: 'date', render: x => serverTime(x.created) },
      { key: 'done', label: 'Steps done', width: 80, type: 'num', align: 'right', value: x => x.done }], rows, getId: x => x.id, multi: false, sortKey: null, icon: x => (x.kind === 'start' ? OPEN : CHECK) });
    lv.el.style.height = '200px'; lv.el.style.border = '1px solid #d9d9d9';
    let frame = null;
    const go = async () => { const x = lv.selected()[0]; if (!x) return; if (await goBack(x.id, o)) { try { if (frame) frame.close('Close'); } catch (e) { /* the restart already closed it */ } } };
    lv.el.addEventListener('dblclick', () => go());
    const backBtn = WS.ui.f.button('Go back…', go);
    const content = h('div.w32', h('div', { style: 'margin-bottom:6px' }, 'A snapshot of the server is saved when the lab starts and each time you complete a step. Pick the point to go back to:'), lv.el,
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' }, h('span.fnote', WS.labs.snapshots.backend === 'memory' ? 'Snapshots are kept until the page is reloaded (browser storage is unavailable).' : 'Snapshots are kept in this browser until the lab ends.'), backBtn));
    const rs = rows(); if (rs.length) setTimeout(() => lv.select([rs[0].id]), 0);
    return WS.ui.dialog({ title: 'Go back to a step', width: 460, className: 'w32-dlg', content, buttons: [{ label: 'Close', primary: true, cancel: true }],
      onCreate: f => { frame = f; if (o.onCreate) o.onCreate({ frame, list: lv, go }); } });
  }
  WS.labGuide = { goBack, undoDialog, nextLab };

  WS.apps.register({ id: 'lab', name: 'Lab Guide', icon: I.lab, singleton: true, launch });
})();
