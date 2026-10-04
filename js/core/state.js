/* State store: one JSON-serialisable object (WS.state) persisted to localStorage.
 * Model modules register initializers that build their slice of the default state,
 * and call WS.store.changed('topic') after mutating it. UI code subscribes with
 * WS.store.on('change:topic', fn) (or win.listen(topic, fn) inside a window). */
(function () {
  'use strict';
  const WS = window.WS;
  const KEY = 'ws2025lab.state.v1';
  const CP_KEY = 'ws2025lab.checkpoints.v1';

  const listeners = {};
  const initializers = []; // [{key, fn}]
  let pendingTopics = new Set();
  let flushTimer = null;
  let saveTimer = null;
  let persistenceOk = true;

  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => off(evt, fn); }
  function off(evt, fn) { const l = listeners[evt]; if (!l) return; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  function emit(evt, data) {
    const l = listeners[evt];
    if (!l) return;
    for (const fn of l.slice()) {
      try { fn(data); } catch (e) { console.error('listener error for', evt, e); }
    }
  }

  /** Register a default-state builder for a top-level key. fn(state) must set state[key]. */
  function init(key, fn) { initializers.push({ key, fn }); }

  function createDefault() {
    const s = { meta: { version: 1, created: new Date().toISOString(), oobeDone: false, setupDone: false, bootCount: 0 } };
    for (const { key, fn } of initializers) { if (s[key] === undefined) fn(s); }
    return s;
  }

  /** Fill in any slices missing from a loaded (older) state. */
  function ensure(s) {
    s.meta = s.meta || { version: 1 };
    for (const { key, fn } of initializers) { if (s[key] === undefined) fn(s); }
    return s;
  }

  function load() {
    let s = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) s = JSON.parse(raw);
    } catch (e) { persistenceOk = false; s = null; }
    WS.state = s ? ensure(s) : createDefault();
    return WS.state;
  }

  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(KEY, JSON.stringify(WS.state)); persistenceOk = true; }
    catch (e) { persistenceOk = false; }
  }

  /** Mark one or more topics as changed. Listeners fire on the next microtask-ish tick, batched. */
  function changed(...topics) {
    for (const t of topics.flat()) if (t) pendingTopics.add(t);
    if (!flushTimer) flushTimer = setTimeout(flush, 0);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function flush() {
    flushTimer = null;
    const topics = [...pendingTopics];
    pendingTopics = new Set();
    for (const t of topics) emit('change:' + t, t);
    emit('change', topics);
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    WS.state = createDefault();
    saveNow();
  }

  function exportJSON() { return JSON.stringify(WS.state, null, 2); }
  function importJSON(text) {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object' || !s.meta) throw new Error('Not a lab state file.');
    WS.state = ensure(s);
    saveNow();
  }

  /* ---------- checkpoints (Hyper-V style snapshots of the whole lab) ---------- */
  function listCheckpoints() {
    try { return JSON.parse(localStorage.getItem(CP_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveCheckpoints(list) {
    try { localStorage.setItem(CP_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function createCheckpoint(name) {
    const list = listCheckpoints();
    const cp = { id: WS.util.uid('cp'), name: name || ('Checkpoint ' + WS.util.fmtDateTime(new Date())), created: new Date().toISOString(), state: WS.util.deepClone(WS.state) };
    list.push(cp);
    while (list.length > 8) list.shift();
    if (!saveCheckpoints(list)) throw new Error('Browser storage is full. Delete an older checkpoint first.');
    return cp;
  }
  function applyCheckpoint(id) {
    const cp = listCheckpoints().find(c => c.id === id);
    if (!cp) throw new Error('Checkpoint not found.');
    WS.state = ensure(WS.util.deepClone(cp.state));
    saveNow();
  }
  /** Replace the whole lab state (a lab step snapshot); the caller restarts the VM. */
  function applyState(st) { WS.state = ensure(WS.util.deepClone(st)); saveNow(); }
  function deleteCheckpoint(id) { saveCheckpoints(listCheckpoints().filter(c => c.id !== id)); }

  WS.store = {
    on, off, emit, init, createDefault, ensure, load, save: saveNow, changed, reset,
    exportJSON, importJSON, listCheckpoints, createCheckpoint, applyCheckpoint, deleteCheckpoint, applyState,
    get persistenceOk() { return persistenceOk; }
  };

  /* Session info is runtime-only (not persisted). */
  WS.session = { loggedIn: false, user: null, domain: null, logonTime: null };
})();
