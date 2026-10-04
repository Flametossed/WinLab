// Cross-platform test runner: drives headless Firefox over WebDriver BiDi (no packages needed).
//   node tests/run-headless.mjs [suite ...] [--shot <mode>] [--jobs <n>] [--headed]
// With no suite it runs them all. Each suite gets a fresh Firefox profile, so tests never touch the
// user's lab state. Console output, a DOM dump and a screenshot go in .test-output/<suite>[-<shot>].*
// Firefox has no virtual time budget, so simulated delays run in real time (a few minutes for all).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SUITES = ['term', 'model', 'ui', 'sm', 'aduc', 'dns', 'dhcp', 'evt', 'disk', 'comp', 'fw', 'net', 'explorer', 'fss', 'gpo', 'tm', 'labs', 'shell', 'settings', 'iis', 'hv', 'gpp', 'snap'];
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', '.test-output');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const shot = opt('--shot');
const jobs = Math.max(1, Number(opt('--jobs')) || 3);
const headed = args.includes('--headed'); if (headed) args.splice(args.indexOf('--headed'), 1);
const suites = args.length ? args : SUITES;
for (const s of suites) if (!SUITES.includes(s)) { console.error('Unknown suite: ' + s + ' (one of ' + SUITES.join(', ') + ')'); process.exit(2); }
if (shot && suites.length !== 1) { console.error('Use --shot with a single suite.'); process.exit(2); }
if (shot && !/^[\w-]+$/.test(shot)) { console.error('Shot names are letters, digits, - and _.'); process.exit(2); }

const firefox = process.env.FIREFOX || [
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
  '/usr/bin/firefox',
].find(p => fs.existsSync(p));
if (!firefox) { console.error('Install Firefox (or set FIREFOX=<path>) to run the browser tests.'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));
let nextPort = 9400 + Math.floor(Math.random() * 400);

async function runSuite(suite) {
  const label = shot ? suite + '-' + shot : suite;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wslab-ff-'));
  const port = nextPort++;
  const ff = spawn(firefox, [...(headed ? [] : ['--headless']), '--no-remote', '--profile', profile, '--remote-debugging-port', String(port)],
    { stdio: 'ignore', windowsHide: true });
  const lines = [];
  let ws;
  try {
    for (let i = 0; i < 150 && !ws; i++) {
      try { const s = new WebSocket('ws://127.0.0.1:' + port + '/session'); await new Promise((res, rej) => { s.onopen = res; s.onerror = rej; }); ws = s; }
      catch { await delay(200); }
    }
    if (!ws) throw new Error('could not connect to Firefox');
    let id = 0; const pending = new Map();
    let done = null; const finished = new Promise(r => { done = r; });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.type === 'error' ? p.reject(new Error(m.error + ': ' + m.message)) : p.resolve(m.result); return; }
      if (m.method === 'log.entryAdded') {
        const p = m.params;
        const text = p.type === 'javascript' ? 'Uncaught ' + p.text + (p.stackTrace && p.stackTrace.callFrames[0] ? ' @ ' + p.stackTrace.callFrames[0].url.split('/').pop() + ':' + p.stackTrace.callFrames[0].lineNumber : '') : p.text;
        lines.push(text);
        if (/^RESULT \d+ passed, \d+ failed/.test(text)) done();
      }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
    await call('session.new', { capabilities: {} });
    await call('session.subscribe', { events: ['log.entryAdded'] });
    const ctx = (await call('browsingContext.create', { type: 'tab' })).context;
    await call('browsingContext.setViewport', { context: ctx, viewport: { width: 1600, height: 900 } });
    const url = pathToFileURL(path.join(here, suite + '-test.html')).href + '?quick=1' + (shot ? '&shot=' + shot : '');
    await call('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
    const timeout = Number(process.env.SUITE_TIMEOUT || 300) * 1000;
    const ok = await Promise.race([finished.then(() => true), delay(timeout).then(() => false)]);
    if (!ok) lines.push('TIMEOUT after ' + timeout / 1000 + 's');
    await delay(shot ? 600 : 150);
    const pic = await call('browsingContext.captureScreenshot', { context: ctx }).catch(() => null);
    if (pic) fs.writeFileSync(path.join(outDir, label + '.png'), Buffer.from(pic.data, 'base64'));
    const dom = await call('script.evaluate', { expression: 'document.documentElement.outerHTML', target: { context: ctx }, awaitPromise: false }).catch(() => null);
    if (dom && dom.result) fs.writeFileSync(path.join(outDir, label + '-dom.html'), dom.result.value);
    await call('session.end').catch(() => {});
  } catch (e) {
    lines.push('RUNNER ' + e.message);
  } finally {
    try { ws && ws.close(); } catch {}
    ff.kill();
    await delay(300);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  fs.writeFileSync(path.join(outDir, label + '.log'), lines.join('\n') + '\n');
  const result = lines.find(l => /^RESULT \d+ passed, \d+ failed/.test(l));
  const errors = lines.filter(l => /^(FAIL |Uncaught |TIMEOUT|RUNNER )|SimulatorError/.test(l));
  return { suite, result, errors, ok: !!result && /, 0 failed/.test(result) && !errors.length };
}

const queue = [...suites], results = [];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const r = await runSuite(queue.shift());
    results.push(r);
    console.log(r.suite + ': ' + (r.result || 'no RESULT line'));
    for (const e of r.errors) console.log('  ' + e);
  }
}));
const failed = results.filter(r => !r.ok);
const total = results.reduce((n, r) => n + Number((r.result || '').match(/RESULT (\d+)/)?.[1] || 0), 0);
console.log(failed.length ? 'FAILED: ' + failed.map(r => r.suite).join(', ') : 'All ' + results.length + ' suites passed (' + total + ' checks).');
process.exit(failed.length ? 1 : 0);
