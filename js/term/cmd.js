/* Command Prompt (cmd.exe): WS.term.CmdSession. Builtins work on WS.fs; everything else is a native program
 * from natives.js (ipconfig, ping, net, ...), so the same tools behave the same in CMD and PowerShell.
 * Supports %VAR% expansion, & && ||, pipes into find/findstr/more/sort, > >> 2> 2>&1 redirection, .bat/.cmd files. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  const NOT_RECOGNIZED = n => `'${n}' is not recognized as an internal or external command,\noperable program or batch file.`;
  const lc = s => String(s).toLowerCase();
  const pad2 = n => String(n).padStart(2, '0');
  const dirDate = d => { d = new Date(d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}  ${pad2(h)}:${pad2(d.getMinutes())} ${ap}`; };
  const serial = l => ({ C: '6A3C-2F1E', E: '9C12-77B0', F: '3E41-0A2D' }[l] || '1F2E-3D4C');

  /** Split a command line into words, honouring double quotes (quotes are removed). */
  function words(s) {
    const out = [];
    let cur = '', q = false, any = false;
    for (const ch of s) {
      if (ch === '"') { q = !q; any = true; continue; }
      if (!q && /\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; continue; }
      cur += ch; any = true;
    }
    if (cur || any) out.push(cur);
    return out;
  }
  /** Split on an unquoted separator regex (returns pieces and the separators found). */
  function splitTop(s, re) {
    const parts = [], seps = [];
    let cur = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') q = !q;
      if (!q && ch === '&' && s[i - 1] === '>' && /\d/.test(s[i + 1] || '')) { cur += ch; continue; }
      if (!q) { const m = s.slice(i).match(re); if (m && m.index === 0) { parts.push(cur); seps.push(m[0]); cur = ''; i += m[0].length - 1; continue; } }
      cur += ch;
    }
    parts.push(cur);
    return { parts, seps };
  }

  class CmdSession {
    constructor(o = {}) {
      this.console = o.console;
      this.kind = 'cmd';
      this.cwd = o.cwd || 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator');
      this.driveCwd = { [this.cwd[0].toUpperCase()]: this.cwd };
      this.env = {};
      this.lastExit = 0;
      this.exited = false;
      this.lineHistory = o.history || [];
      this.dirStack = [];
      this.cancelled = false;
      this.echoOn = true;
      if (this.console && this.console.onInterrupt) this.console.onInterrupt(() => { this.cancelled = true; });
    }
    write(t) { if (this.console) this.console.write(t); }
    writeLine(t) { this.write((t == null ? '' : t) + '\n'); }
    prompt() { return this.cwd + '>'; }
    banner() { if (this.disabledByPolicy()) return; this.writeLine(`Microsoft Windows [Version 10.0.${WS.state.system.build}]`); this.writeLine('(c) Microsoft Corporation. All rights reserved.'); this.writeLine(''); }
    /** User policy "Prevent access to the command prompt": 1 = scripts too, 2 = the interactive prompt only. */
    disabledByPolicy() { const v = WS.gpo && WS.gpo.policyOption('user', 'DisableCMD', 'DisableCMD'); return v === 1 || v === 2 ? v : 0; }
    async refuse() {
      this.writeLine('The command prompt has been disabled by your administrator.');
      this.writeLine('');
      this.write('Press any key to continue . . . ');
      if (this.console && this.console.readKey) await this.console.readKey();
      this.writeLine('');
      this.exited = true;
    }
    envVar(name) {
      const n = name.toUpperCase();
      const own = Object.keys(this.env).find(k => k.toUpperCase() === n);
      if (own) return this.env[own];
      switch (n) {
        case 'CD': return this.cwd;
        case 'ERRORLEVEL': return String(this.lastExit);
        case 'RANDOM': return String(U.randInt(0, 32767));
        case 'DATE': { const d = new Date(); return `${U.DAYS[d.getDay()].slice(0, 3)} ${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`; }
        case 'TIME': { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad2(Math.floor(d.getMilliseconds() / 10))}`; }
        default: { const env = WS.fs.env(); const k = Object.keys(env).find(x => x.toUpperCase() === n); return k ? env[k] : null; }
      }
    }
    expand(line) { return line.replace(/%([^%\s]+)%/g, (m, k) => { const v = this.envVar(k); return v == null ? m : v; }); }
    full(p) { return WS.fs.full(p, this.cwd); }

    async repl() {
      if (this.disabledByPolicy()) return this.refuse();
      while (!this.exited) {
        if (this.console.setTitle) this.console.setTitle('Administrator: Command Prompt');
        const line = await this.console.readLine({ prompt: this.prompt(), history: this.lineHistory, complete: (l, c, r, st) => this.complete(l, c, r, st) });
        if (line === null) { if (this.console.disposed || this.console instanceof WS.term.TextConsole) { this.exited = true; break; } continue; }
        if (!line.trim()) continue;
        await this.execute(line);
        if (!this.exited) this.writeLine('');
      }
    }
    async execute(line) {
      this.cancelled = false;
      const { parts, seps } = splitTop(this.expand(line), /^(&&|\|\||&)/);
      let skip = false;
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i].trim();
        if (!skip && seg) await this.runPipeline(seg);
        const sep = seps[i];
        if (sep === '&&') skip = this.lastExit !== 0;
        else if (sep === '||') skip = this.lastExit === 0;
        else skip = false;
        if (this.exited) return;
      }
    }
    async runPipeline(seg) {
      const stages = splitTop(seg, /^\|(?!\|)/).parts.map(s => s.trim());
      let input = null;
      for (let i = 0; i < stages.length; i++) {
        const last = i === stages.length - 1;
        const { cmd, redirs } = this.parseRedirs(stages[i]);
        const captured = [];
        let partial = '';
        const toFile = redirs.out;
        const sink = !last || toFile ? (t => { partial += t; const p = partial.split('\n'); partial = p.pop(); captured.push(...p.map(x => x.replace(/\r$/, ''))); }) : (t => this.write(t));
        let errorText = '';
        const errSink = redirs.errNull ? (() => {}) : redirs.errToOut ? sink : redirs.err ? (t => { errorText += t; }) : (t => this.write(t));
        if (redirs.inFile) { try { input = WS.fs.readFile(this.full(redirs.inFile)).split(/\r?\n/); } catch (e) { this.writeLine('The system cannot find the file specified.'); this.lastExit = 1; return; } }
        this.lastExit = await this.runCommand(cmd, { write: sink, error: errSink, input });
        if (redirs.err) {
          try { WS.fs.writeFile(this.full(redirs.err.path), errorText, null, { append: redirs.err.append }); }
          catch (e) { this.writeLine('The system cannot find the path specified.'); this.lastExit = 1; }
        }
        if (partial) captured.push(partial);
        if (toFile) {
          const path = this.full(toFile.path);
          if (/^nul$/i.test(toFile.path)) { input = null; continue; }
          try { WS.fs.writeFile(path, captured.join('\r\n') + (captured.length ? '\r\n' : ''), null, { append: toFile.append }); }
          catch (e) { this.writeLine(e.code === 'PathNotFound' ? 'The system cannot find the path specified.' : 'Access is denied.'); this.lastExit = 1; }
          input = null;
        } else input = captured;
      }
    }
    parseRedirs(stage) {
      const r = {};
      // Consume quoted strings as a unit so literal > and < remain part of the command.
      const cmd = stage.replace(/"[^"]*"|2>&1|[012]?(?:>>?|<)\s*(?:"[^"]*"|[^\s<>|&]+)/g, m => {
        if (m[0] === '"') return m;
        if (m === '2>&1') { r.errToOut = true; return ''; }
        const match = m.match(/^([012]?)(>>?|<)\s*(.*)$/);
        const path = match[3].replace(/^"|"$/g, '');
        if (match[2] === '<') r.inFile = path;
        else if (match[1] === '2') {
          r.errToOut = false;
          if (/^nul$/i.test(path)) r.errNull = true;
          else r.err = { path, append: match[2] === '>>' };
        } else r.out = { path, append: match[2] === '>>' };
        return '';
      });
      return { cmd: cmd.trim(), redirs: r };
    }

    async runCommand(cmdLine, o) {
      if (!cmdLine) return 0;
      const out = t => o.write(t);
      const line = t => o.write((t == null ? '' : t) + '\n');
      // drive change "E:"
      const dm = cmdLine.match(/^([a-zA-Z]):\s*$/);
      if (dm) {
        const d = dm[1].toUpperCase();
        if (WS.storage.isCdrom(d)) { line('The device is not ready.'); return 1; }
        if (!WS.fs.hasDrive(d)) { line('The system cannot find the drive specified.'); return 1; }
        if (!WS.fs.exists(d + ':\\')) { line(WS.netuse && WS.netuse.get(d) ? 'The network path was not found.' : 'The system cannot find the drive specified.'); return 1; }
        this.driveCwd[this.cwd[0].toUpperCase()] = this.cwd;
        this.cwd = this.driveCwd[d] || d + ':\\';
        return 0;
      }
      const m = cmdLine.match(/^@?\s*([^\s/"]+|"[^"]+")(.*)$/s);
      let name = m[1].replace(/^"|"$/g, '');
      let rest = m[2];
      // "cd.." "cd\" "echo." style
      const glued = name.match(/^(cd|chdir|echo|md|rd|dir)([.\\/:].*)$/i);
      if (glued && !/^(echo|cd)$/i.test(name)) { name = glued[1]; rest = glued[2] + rest; }
      const args = words(rest);
      const b = BUILTINS[lc(name)];
      if (b) return (await b.call(this, args, rest, { out, line, input: o.input })) || 0;
      // batch files
      const tryPaths = /\.(bat|cmd)$/i.test(name) ? [name] : [name + '.bat', name + '.cmd'];
      for (const p of tryPaths) {
        const full = this.full(p);
        if (WS.fs.exists(full) && !WS.fs.isDir(full)) return this.runBatch(full, args, o);
      }
      const nat = WS.term.native(name.replace(/^.*\\/, ''));
      if (nat && WS.term.reachable(nat, name, this.cwd, { searchCwd: true })) {
        const io = WS.term.makeIO(this, { write: o.write, error: o.error, input: o.input });
        try { return (await nat.run(args, io)) || 0; } catch (e) { console.error(e); line('The system cannot execute the specified program.'); return 1; }
      }
      o.error(NOT_RECOGNIZED(name) + '\n');
      return 9009;
    }
    async runBatch(path, args, o) {
      const text = WS.fs.readFile(path);
      const saveEcho = this.echoOn;
      let code = 0;
      for (const raw of text.split(/\r?\n/)) {
        let l = raw.trim();
        if (!l || /^(rem\b|::)/i.test(l)) continue;
        l = l.replace(/%(\d)/g, (mm, d) => (d === '0' ? path : args[+d - 1] || ''));
        if (/^@?echo\s+off$/i.test(l)) { this.echoOn = false; continue; }
        if (/^@?echo\s+on$/i.test(l)) { this.echoOn = true; continue; }
        const silent = l.startsWith('@');
        if (this.echoOn && !silent) o.write(`\n${this.prompt()}${l}\n`);
        await this.execute(l.replace(/^@/, ''));
        code = this.lastExit;
        if (this.exited) break;
      }
      this.echoOn = saveEcho;
      return code;
    }

    complete(lineText, cursor, reverse, st) {
      const c = st.compl;
      if (c && c.line === lineText && c.cursor === cursor && c.matches.length) { c.idx = (c.idx + (reverse ? -1 : 1) + c.matches.length) % c.matches.length; return this.applyCompletion(c); }
      let start = cursor;
      let inQ = false;
      for (let i = 0; i < cursor; i++) if (lineText[i] === '"') inQ = !inQ;
      if (inQ) start = lineText.lastIndexOf('"', cursor - 1);
      else while (start > 0 && lineText[start - 1] !== ' ') start--;
      const word = lineText.slice(start, cursor).replace(/"/g, '');
      const sep = word.lastIndexOf('\\');
      const dirPart = sep >= 0 ? word.slice(0, sep + 1) : '';
      const prefix = lc(sep >= 0 ? word.slice(sep + 1) : word);
      let items = [];
      try { items = WS.fs.list(dirPart ? this.full(dirPart) : this.cwd); } catch (e) { return null; }
      const matches = items.filter(x => lc(x.name).startsWith(prefix)).map(x => dirPart + x.name);
      if (!matches.length) return null;
      st.compl = { start, base: lineText, baseEnd: cursor, matches, idx: 0 };
      return this.applyCompletion(st.compl);
    }
    applyCompletion(c) {
      let m = c.matches[c.idx];
      if (/\s/.test(m)) m = `"${m}"`;
      const l = c.base.slice(0, c.start) + m + c.base.slice(c.baseEnd);
      c.line = l; c.cursor = c.start + m.length;
      return { line: l, cursor: c.cursor };
    }
  }

  /* ================================================================ builtins */
  function dirListing(session, args, o) {
    const flags = args.filter(a => /^\/\w/.test(a)).map(lc);
    const targets = args.filter(a => !/^\/\w/.test(a));
    const showHidden = flags.some(f => f.startsWith('/a'));
    const bare = flags.includes('/b');
    let target = targets[0] || '.';
    let pattern = null;
    let dir = session.full(target);
    if (/[*?]/.test(dir.replace(/^.*\\/, ''))) { pattern = dir.replace(/^.*\\/, ''); dir = dir.replace(/\\[^\\]*$/, '') || dir.slice(0, 3); if (/^[A-Z]:$/.test(dir)) dir += '\\'; }
    else if (WS.fs.exists(dir) && !WS.fs.isDir(dir)) { pattern = dir.replace(/^.*\\/, ''); dir = dir.replace(/\\[^\\]*$/, '') || dir.slice(0, 3); if (/^[A-Z]:$/.test(dir)) dir += '\\'; }
    const drive = dir[0].toUpperCase();
    if (WS.storage.isCdrom(drive)) { o.line('The device is not ready.'); return 1; }
    if (!WS.fs.isDir(dir)) {
      if (!bare) { const v = WS.storage.volume(drive); o.line(` Volume in drive ${drive} ${v && v.label ? 'is ' + v.label : 'has no label.'}`); o.line(` Volume Serial Number is ${serial(drive)}\n`); }
      o.line(WS.fs.isDir(dir.replace(/\\[^\\]*$/, '') || 'X:\\none') ? 'File Not Found' : 'The system cannot find the path specified.');
      return 1;
    }
    let items = WS.fs.list(dir, null, { hidden: showHidden });
    if (pattern) { const re = U.wildcardToRegex(pattern); items = items.filter(x => re.test(x.name)); }
    if (bare) { if (!items.length) { o.line('File Not Found'); return 1; } items.forEach(x => o.line(x.name)); return 0; }
    const v = WS.storage.volume(drive);
    o.line(` Volume in drive ${drive} ${v && v.label ? 'is ' + v.label : 'has no label.'}`);
    o.line(` Volume Serial Number is ${serial(drive)}\n`);
    o.line(` Directory of ${dir.replace(/\\$/, '').length === 2 ? dir : dir.replace(/\\$/, '')}\n`);
    if (!items.length && pattern) { o.line('File Not Found'); return 1; }
    const isRoot = /^[A-Z]:\\?$/i.test(dir);
    const self = WS.fs.stat(dir);
    let files = 0, bytes = 0, dirs = 0;
    if (!isRoot && !pattern) { o.line(`${dirDate(self.modified)}    <DIR>          .`); o.line(`${dirDate(self.modified)}    <DIR>          ..`); dirs += 2; }
    for (const it of items) {
      if (it.junction) { o.line(`${dirDate(it.modified)}    <JUNCTION>     ${it.name} [${it.junction.replace(/^\\\\\?\\/, '\\??\\')}]`); dirs++; }
      else if (it.type === 'dir') { o.line(`${dirDate(it.modified)}    <DIR>          ${it.name}`); dirs++; }
      else { o.line(`${dirDate(it.modified)}    ${it.size.toLocaleString('en-US').padStart(14)} ${it.name}`); files++; bytes += it.size; }
    }
    const free = v ? v.free : 0;
    o.line(`${String(files).padStart(16)} File(s) ${bytes.toLocaleString('en-US').padStart(14)} bytes`);
    o.line(`${String(dirs).padStart(16)} Dir(s)  ${free.toLocaleString('en-US').padStart(15)} bytes free`);
    return 0;
  }
  async function confirmYN(session, text) {
    const a = await session.console.readLine({ prompt: text });
    return !!a && /^y/i.test(a.trim());
  }
  function fsErr(o, e, file) {
    if (e.code === 'NotFound') o.line(file ? 'The system cannot find the file specified.' : 'The system cannot find the path specified.');
    else if (e.code === 'PathNotFound' || e.code === 'NoDrive') o.line('The system cannot find the path specified.');
    else if (e.code === 'AccessDenied') o.line('Access is denied.');
    else if (e.code === 'NotEmpty') o.line('The directory is not empty.');
    else if (e.code === 'InvalidName') o.line('The filename, directory name, or volume label syntax is incorrect.');
    else if (e.code === 'NotReady') o.line('The device is not ready.');
    else if (e.code === 'Exists') o.line('A duplicate file name exists, or the file\ncannot be found.');
    else o.line(e.message);
    return 1;
  }
  const BUILTINS = {
    cd(args, rest, o) {
      let a = args.slice();
      const d = a[0] && lc(a[0]) === '/d';
      if (d) a.shift();
      const target = a.join(' ').trim();
      if (!target) { o.line(this.cwd); return 0; }
      if (/^"?\\\\/.test(target)) { o.line(`"${target.replace(/"/g, '')}"\nCMD does not support UNC paths as current directories.`); return 1; }
      const p = this.full(target);
      if (WS.storage.isCdrom(p[0])) { o.line('The device is not ready.'); return 1; }
      if (!WS.fs.exists(p)) { o.line('The system cannot find the path specified.'); return 1; }
      if (!WS.fs.isDir(p)) { o.line('The directory name is invalid.'); return 1; }
      if (p[0].toUpperCase() !== this.cwd[0].toUpperCase() && !d) { this.driveCwd[p[0].toUpperCase()] = p; return 0; }
      this.cwd = p.length === 2 ? p + '\\' : p;
      this.driveCwd[this.cwd[0].toUpperCase()] = this.cwd;
      return 0;
    },
    cls() { if (this.console && this.console.clear) this.console.clear(); return 0; },
    dir(args, rest, o) { return dirListing(this, args, o); },
    echo(args, rest, o) {
      const t = rest.replace(/^\s/, '');
      if (/^\.\s*$/.test(rest) || rest === '.') { o.line(''); return 0; }
      if (/^[.:]/.test(rest)) { o.line(rest.slice(1)); return 0; }
      if (!t.trim()) { o.line(`ECHO is ${this.echoOn ? 'on' : 'off'}.`); return 0; }
      if (/^(on|off)$/i.test(t.trim())) { this.echoOn = lc(t.trim()) === 'on'; return 0; }
      o.line(t);
      return 0;
    },
    md(args, rest, o) {
      if (!args.length) { o.line('The syntax of the command is incorrect.'); return 1; }
      let code = 0;
      for (const a of args) {
        const p = this.full(a);
        if (WS.fs.exists(p)) { o.line(`A subdirectory or file ${a} already exists.`); code = 1; continue; }
        try { WS.fs.mkdir(p); } catch (e) { code = fsErr(o, e); }
      }
      return code;
    },
    rd(args, rest, o) {
      const s = args.some(a => lc(a) === '/s'), q = args.some(a => lc(a) === '/q');
      const targets = args.filter(a => !/^\/\w$/.test(a));
      if (!targets.length) { o.line('The syntax of the command is incorrect.'); return 1; }
      return (async () => {
        for (const t of targets) {
          const p = this.full(t);
          if (!WS.fs.exists(p)) { o.line('The system cannot find the file specified.'); return 2; }
          if (!WS.fs.isDir(p)) { o.line('The directory name is invalid.'); return 267; }
          if (s && !q && !(await confirmYN(this, `${t}, Are you sure (Y/N)? `))) continue;
          try { WS.fs.remove(p, null, { recursive: s }); } catch (e) { return fsErr(o, e); }
        }
        return 0;
      })();
    },
    async del(args, rest, o) {
      const q = args.some(a => lc(a) === '/q');
      const targets = args.filter(a => !/^\/\w$/.test(a));
      if (!targets.length) { o.line('The syntax of the command is incorrect.'); return 1; }
      for (const t of targets) {
        const p = this.full(t);
        if (WS.fs.isDir(p)) {
          if (!q && !(await confirmYN(this, `${p}\\*, Are you sure (Y/N)? `))) continue;
          for (const f of WS.fs.list(p).filter(x => x.type === 'file')) { try { WS.fs.remove(f.path); } catch (e) { o.line(`${f.path}\nAccess is denied.`); } }
          continue;
        }
        const dir = p.replace(/\\[^\\]*$/, '') || p.slice(0, 3);
        const pat = p.replace(/^.*\\/, '');
        let matches = [];
        try { const re = U.wildcardToRegex(pat); matches = WS.fs.list(dir).filter(x => x.type === 'file' && re.test(x.name)); } catch (e) { /* missing folder */ }
        if (!matches.length) { o.line(`Could Not Find ${p}`); continue; }
        for (const f of matches) { try { WS.fs.remove(f.path); } catch (e) { o.line(`${f.path}\nAccess is denied.`); } }
      }
      return 0;
    },
    async copy(args, rest, o) {
      const y = args.some(a => lc(a) === '/y');
      const [src, dst] = args.filter(a => !/^\/\w$/.test(a));
      if (!src) { o.line('The syntax of the command is incorrect.'); return 1; }
      const sp = this.full(src);
      const dir = sp.replace(/\\[^\\]*$/, '');
      let files = [];
      try { const re = U.wildcardToRegex(sp.replace(/^.*\\/, '')); files = WS.fs.isDir(sp) ? WS.fs.list(sp).filter(x => x.type === 'file') : WS.fs.list(dir).filter(x => x.type === 'file' && re.test(x.name)); } catch (e) { /* none */ }
      if (!files.length) { o.line('The system cannot find the file specified.\n        0 file(s) copied.'); return 1; }
      const dp = this.full(dst || '.');
      let n = 0;
      for (const f of files) {
        const target = WS.fs.isDir(dp) ? dp.replace(/\\$/, '') + '\\' + f.name : dp;
        if (WS.fs.exists(target) && !y) {
          const ans = await this.console.readLine({ prompt: `Overwrite ${target}? (Yes/No/All): ` });
          if (!ans || /^n/i.test(ans)) continue;
        }
        try { WS.fs.copy(f.path, target, null, { force: true }); if (files.length > 1) o.line(f.path); n++; } catch (e) { fsErr(o, e, true); }
      }
      o.line(`        ${n} file(s) copied.`);
      return n ? 0 : 1;
    },
    move(args, rest, o) {
      const [src, dst] = args.filter(a => !/^\/\w$/.test(a));
      if (!src || !dst) { o.line('The syntax of the command is incorrect.'); return 1; }
      try { WS.fs.move(this.full(src), this.full(dst), null, { force: args.some(a => lc(a) === '/y') }); }
      catch (e) { if (e.code === 'NotFound') { o.line('The system cannot find the file specified.'); return 1; } return fsErr(o, e); }
      o.line(WS.fs.isDir(this.full(dst)) && WS.fs.isDir(this.full(dst) + '\\' + src.replace(/^.*\\/, '')) ? '        1 dir(s) moved.' : '        1 file(s) moved.');
      return 0;
    },
    ren(args, rest, o) {
      if (args.length !== 2) { o.line('The syntax of the command is incorrect.'); return 1; }
      try { WS.fs.rename(this.full(args[0]), args[1]); } catch (e) { o.line('A duplicate file name exists, or the file\ncannot be found.'); return 1; }
      return 0;
    },
    type(args, rest, o) {
      if (!args.length) { o.line('The syntax of the command is incorrect.'); return 1; }
      for (const a of args) {
        const p = this.full(a);
        if (WS.fs.isDir(p)) { o.line('Access is denied.'); return 1; }
        try { const t = WS.fs.readFile(p); o.out(t.endsWith('\n') ? t.replace(/\r\n/g, '\n') : t.replace(/\r\n/g, '\n') + '\n'); }
        catch (e) { o.line('The system cannot find the file specified.'); return 1; }
      }
      return 0;
    },
    set(args, rest, o) {
      const t = rest.trim();
      const env = { ...WS.fs.env(), ...this.env };
      if (!t) { Object.keys(env).sort((a, b) => a.localeCompare(b)).forEach(k => { if (env[k] != null) o.line(`${k}=${env[k]}`); }); return 0; }
      const m = t.match(/^"?([^=]+?)=(.*?)"?$/);
      if (m) { if (m[2] === '') delete this.env[m[1]]; else this.env[m[1]] = m[2]; return 0; }
      const hits = Object.keys(env).filter(k => lc(k).startsWith(lc(t)) && env[k] != null);
      if (!hits.length) { o.line(`Environment variable ${t} not defined`); return 1; }
      hits.sort().forEach(k => o.line(`${k}=${env[k]}`));
      return 0;
    },
    ver(args, rest, o) { o.line(`\nMicrosoft Windows [Version 10.0.${WS.state.system.build}]`); return 0; },
    vol(args, rest, o) { const d = (args[0] || this.cwd)[0].toUpperCase(); const v = WS.storage.volume(d); o.line(` Volume in drive ${d} ${v && v.label ? 'is ' + v.label : 'has no label.'}\n Volume Serial Number is ${serial(d)}`); return 0; },
    title(args, rest) { if (this.console && this.console.setTitle) this.console.setTitle(rest.trim()); return 0; },
    exit(args) { this.exited = true; this.exitCode = +(args.find(a => /^\d+$/.test(a)) || 0); return this.exitCode; },
    path(args, rest, o) { o.line('PATH=' + this.envVar('PATH')); return 0; },
    date(args, rest, o) { if (args.map(lc).includes('/t')) { const d = new Date(); o.line(`${U.DAYS[d.getDay()].slice(0, 3)} ${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`); return 0; } o.line(`The current date is: ${this.envVar('DATE')}\nEnter the new date: (mm-dd-yy)`); return 0; },
    time(args, rest, o) { if (args.map(lc).includes('/t')) { o.line(U.fmtTime(new Date()).padStart(8, '0')); return 0; } o.line(`The current time is: ${this.envVar('TIME')}\nEnter the new time:`); return 0; },
    pushd(args, rest, o) {
      const target = args.join(' ').trim().replace(/"/g, '');
      // pushd \\server\share maps a temporary drive (from Z: down) and popd removes it again
      if (/^\\\\/.test(target) && WS.netuse) {
        const u = WS.netuse.uncParts(target);
        const r = u ? WS.netuse.connect('*', `\\\\${u.server}\\${u.share}`, { persistent: false }) : WS.netuse.resolveUnc(target);
        if (!r.ok) { o.line(r.error); return 1; }
        this.dirStack.push({ cwd: this.cwd, temp: r.letter });
        return BUILTINS.cd.call(this, ['/d', `${r.letter}:\\${u.rest.join('\\')}`], rest, o);
      }
      this.dirStack.push(this.cwd);
      return args.length ? BUILTINS.cd.call(this, ['/d', ...args], rest, o) : 0;
    },
    popd() {
      const p = this.dirStack.pop();
      if (p && typeof p === 'object') { this.cwd = p.cwd; if (WS.netuse && WS.netuse.get(p.temp)) WS.netuse.disconnect(p.temp); }
      else if (p) this.cwd = p;
      return 0;
    },
    attrib(args, rest, o) {
      const set = args.filter(a => /^[+-][rhsa]$/i.test(a));
      const files = args.filter(a => !/^[+-][rhsa]$/i.test(a) && !/^\//.test(a));
      const targets = files.length ? files : ['*'];
      for (const t of targets) {
        const p = this.full(t);
        const list = /[*?]/.test(t) ? WS.fs.list(p.replace(/\\[^\\]*$/, ''), null, { hidden: true }).filter(x => U.wildcardToRegex(p.replace(/^.*\\/, '')).test(x.name)) : [WS.fs.stat(p)].filter(Boolean);
        if (!list.length) { o.line(`File not found - ${p}`); return 1; }
        for (const f of list) {
          if (set.length) { let a = f.attrs; for (const s of set) { const c = s[1].toUpperCase(); a = s[0] === '+' ? (a.includes(c) ? a : a + c) : a.replace(c, ''); } WS.fs.setAttrs(f.path, a); continue; }
          const at = f.attrs + (f.type === 'file' ? 'A' : '');
          o.line(`${at.includes('A') ? 'A' : ' '}    ${at.includes('S') ? 'S' : ' '}${at.includes('H') ? 'H' : ' '}${at.includes('R') ? 'R' : ' '}        ${f.path}`);
        }
      }
      return 0;
    },
    tree(args, rest, o) {
      const root = this.full(args.find(a => !/^\//.test(a)) || '.');
      const files = args.map(lc).includes('/f');
      o.line(`Folder PATH listing${WS.storage.volume(root[0]) && WS.storage.volume(root[0]).label ? ' for volume ' + WS.storage.volume(root[0]).label : ''}\nVolume serial number is ${serial(root[0].toUpperCase())}`);
      o.line(root.length === 3 ? root.slice(0, 2) + '.' : root);
      let count = 0;
      const walk = (p, prefix, depth) => {
        if (depth > 6 || count > 400) return;
        const items = WS.fs.list(p).filter(x => files || x.type === 'dir');
        items.forEach((it, i) => {
          const last = i === items.length - 1;
          count++;
          o.line(prefix + (it.type === 'dir' ? (last ? '└───' : '├───') : '    ') + it.name);
          if (it.type === 'dir') walk(it.path, prefix + (last ? '    ' : '│   '), depth + 1);
        });
      };
      try { walk(root, '', 0); } catch (e) { o.line('Invalid path - ' + root); return 1; }
      if (!count) o.line('No subfolders exist \n');
      return 0;
    },
    start(args, rest, o) {
      const a = args.filter((x, i) => !(i === 0 && x === ''));
      const target = a.find(x => !/^\//.test(x));
      if (!target) { WS.apps.launch('cmd'); return 0; }
      if (/^(cmd|powershell)(\.exe)?$/i.test(target)) { WS.apps.launch(lc(target).replace(/\.exe$/, '')); return 0; }
      const nat = WS.term.native(target);
      if (nat && nat.launcher) return nat.run([], WS.term.makeIO(this, { write: o.out }));
      if (/^https?:/i.test(target)) { WS.apps.launch('edge', { url: target }); return 0; }
      const p = this.full(target);
      if (WS.fs.isDir(p)) { WS.apps.launch('explorer'); return 0; }
      o.line(`The system cannot find the file ${target}.`);
      return 1;
    },
    help(args, rest, o) {
      o.line('For more information on a specific command, type HELP command-name');
      for (const [k, v] of [['ATTRIB', 'Displays or changes file attributes.'], ['CD', 'Displays the name of or changes the current directory.'], ['CLS', 'Clears the screen.'], ['COPY', 'Copies one or more files to another location.'], ['DATE', 'Displays or sets the date.'], ['DEL', 'Deletes one or more files.'], ['DIR', 'Displays a list of files and subdirectories in a directory.'], ['ECHO', 'Displays messages, or turns command echoing on or off.'], ['EXIT', 'Quits the CMD.EXE program (command interpreter).'], ['FIND', 'Searches for a text string in a file or files.'], ['FINDSTR', 'Searches for strings in files.'], ['IPCONFIG', 'Displays all current TCP/IP network configuration values.'], ['MD', 'Creates a directory.'], ['MOVE', 'Moves one or more files from one directory to another directory.'], ['NET', 'Manages network resources, users, groups, services and shares.'], ['NETSH', 'Displays or modifies the network configuration.'], ['PING', 'Tests network connectivity.'], ['RD', 'Removes a directory.'], ['REN', 'Renames a file or files.'], ['SC', 'Displays or configures services (background processes).'], ['SET', 'Displays, sets, or removes Windows environment variables.'], ['SHUTDOWN', 'Allows proper local or remote shutdown of machine.'], ['START', 'Starts a separate window to run a specified program or command.'], ['SYSTEMINFO', 'Displays machine specific properties and configuration.'], ['TASKLIST', 'Displays all currently running tasks including services.'], ['TITLE', 'Sets the window title for a CMD.EXE session.'], ['TREE', 'Graphically displays the directory structure of a drive or path.'], ['TYPE', 'Displays the contents of a text file.'], ['VER', 'Displays the Windows version.'], ['VOL', 'Displays a disk volume label and serial number.']]) o.line(k.padEnd(14) + v);
      o.line('\nFor more information on tools see the command-line reference in the online help.');
      return 0;
    },
    rem() { return 0; }
  };
  Object.assign(BUILTINS, { chdir: BUILTINS.cd, mkdir: BUILTINS.md, rmdir: BUILTINS.rd, erase: BUILTINS.del, rename: BUILTINS.ren, '::': BUILTINS.rem });

  WS.term = WS.term || {};
  WS.term.CmdSession = CmdSession;
  WS.term.cmdWords = words;
})();
