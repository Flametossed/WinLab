/* Core PowerShell cmdlets: file system, pipeline/objects, formatting, output, help/discovery, variables,
 * services, roles and features, event logs, computer/system. All state changes go through the models. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;
  const PS = WS.ps;
  const { psobj, toStr, toBool, toArray, unwrap, getProp, cmdlet, view, ScriptBlock, PSHashtable, SecureString } = PS;

  const MGMT = 'Microsoft.PowerShell.Management';
  const UTIL = 'Microsoft.PowerShell.Utility';
  const CORE = 'Microsoft.PowerShell.Core';
  const SEC = 'Microsoft.PowerShell.Security';
  const wild = (pat, s) => PS.wildcardRe(pat).test(String(s));
  const hasWild = s => /[*?[]/.test(String(s));

  /* ================================================================ file system objects */
  function modeOf(st) {
    const a = st.attrs || '';
    return (st.type === 'dir' ? 'd' : '-') + (st.type === 'file' ? 'a' : '-') + (a.includes('R') ? 'r' : '-') + (a.includes('H') ? 'h' : '-') + (a.includes('S') ? 's' : '-') + '-';
  }
  function itemObj(st) {
    const parent = st.path.replace(/\\[^\\]+$/, '') || st.path.slice(0, 3);
    const p = { Mode: modeOf(st), LastWriteTime: new Date(st.modified), Length: st.type === 'file' ? st.size : null, Name: st.name, FullName: st.path,
      Extension: st.extension, CreationTime: new Date(st.created), LastAccessTime: new Date(st.modified), Attributes: st.type === 'dir' ? 'Directory' : 'Archive', PSIsContainer: st.type === 'dir',
      PSPath: 'Microsoft.PowerShell.Core\\FileSystem::' + st.path, PSParentPath: 'Microsoft.PowerShell.Core\\FileSystem::' + (parent.length === 2 ? parent + '\\' : parent), PSChildName: st.name, PSDrive: st.path[0], PSProvider: 'Microsoft.PowerShell.Core\\FileSystem',
      BaseName: st.type === 'file' && st.extension ? st.name.slice(0, -st.extension.length) : st.name };
    if (st.type === 'dir') { delete p.Length; p.Parent = parent.replace(/^.*\\/, ''); p.Root = st.path.slice(0, 3); }
    else { p.DirectoryName = parent.length === 2 ? parent + '\\' : parent; p.IsReadOnly = (st.attrs || '').includes('R'); }
    return psobj(st.type === 'dir' ? 'System.IO.DirectoryInfo' : 'System.IO.FileInfo', p, { str: st.name, hidden: { __parent: p.PSParentPath.replace(/^.*::/, '') } });
  }
  const dirView = {
    table: {
      groupBy: { label: 'Directory', value: o => o.__hidden.__parent },
      columns: [
        { label: 'Mode', width: 6, value: 'Mode' },
        { label: 'LastWriteTime', width: 25, align: 'right', value: o => `${U.fmtDate(o.LastWriteTime).padStart(10)} ${U.fmtTime(o.LastWriteTime).padStart(8)}` },
        { label: 'Length', width: 14, align: 'right', value: o => (o.Length == null ? '' : o.Length) },
        { label: 'Name', value: 'Name' }
      ]
    }
  };
  view('System.IO.FileInfo', dirView);
  view('System.IO.DirectoryInfo', dirView);
  view('System.Management.Automation.PathInfo', { table: { columns: [{ label: 'Path', value: 'Path' }] } });
  view('System.Collections.DictionaryEntry', { table: { columns: [{ label: 'Name', width: 30, value: 'Name' }, { label: 'Value', value: 'Value' }] } });

  function fsError(ctx, e, path, o = {}) {
    const map = {
      NotFound: ['ObjectNotFound', 'ItemNotFoundException', 'PathNotFound', `Cannot find path '${path}' because it does not exist.`],
      PathNotFound: ['ObjectNotFound', 'ItemNotFoundException', 'PathNotFound', `Cannot find path '${path}' because it does not exist.`],
      NoDrive: ['ObjectNotFound', 'DriveNotFoundException', 'DriveNotFound', e.message],
      NotReady: ['ReadError', 'IOException', 'GetChildItemIOError', 'The device is not ready.'],
      Exists: ['ResourceExists', 'IOException', 'DirectoryExist', e.message],
      AccessDenied: ['PermissionDenied', 'UnauthorizedAccessException', 'RemoveItemUnauthorizedAccessError', `Access to the path '${path}' is denied.`],
      NotEmpty: ['WriteError', 'IOException', 'DirectoryNotEmpty', `The directory is not empty.`],
      InvalidName: ['InvalidArgument', 'ArgumentException', 'InvalidName', 'Illegal characters in path.'],
      IsADirectory: ['PermissionDenied', 'UnauthorizedAccessException', 'GetContentReaderUnauthorizedAccessError', `Access to the path '${path}' is denied.`]
    };
    const [category, exception, id, message] = map[e.code] || ['NotSpecified', 'Exception', 'Error', e.message];
    const rec = { message, category, target: path, targetType: 'String', exception, id: `${o.id || id},${ctx.def.cls}` };
    if (o.terminating) ctx.throw(rec); else ctx.error(rec);
  }
  const resolve = (ctx, p) => ctx.resolvePath(String(p));
  /** Expand wildcards in a path argument to existing paths. */
  function expandPaths(ctx, p) {
    const full = resolve(ctx, p);
    if (!hasWild(full)) return [full];
    const dir = full.replace(/\\[^\\]*$/, '') || full.slice(0, 3);
    const pat = full.replace(/^.*\\/, '');
    try { return WS.fs.list(dir, null, { hidden: true }).filter(x => wild(pat, x.name)).map(x => x.path); } catch (e) { return []; }
  }

  cmdlet({ name: 'Get-Location', module: MGMT, synopsis: 'Gets information about the current working location or a location stack.',
    process(ctx) { ctx.out(ctx.session.getVar('PWD')); } });
  cmdlet({ name: 'Set-Location', module: MGMT, synopsis: 'Sets the current working location to a specified location.',
    params: { Path: { pos: 0, pipe: 'both' }, LiteralPath: {}, PassThru: { type: 'switch' } },
    process(ctx, p) {
      let target = p.Path == null ? ctx.session.getVar('HOME') : p.Path;
      if (/^env:\\?$/i.test(target)) ctx.throw({ message: 'The Environment provider is read-only in the lab simulator. Use Get-ChildItem Env: instead.', category: 'NotImplemented', target, exception: 'NotSupportedException', id: 'NotSupported,Microsoft.PowerShell.Commands.SetLocationCommand' });
      if (/^[a-z]{2,}:/i.test(target)) ctx.throw({ message: `Cannot find drive. A drive with the name '${target.split(':')[0]}' does not exist.`, category: 'ObjectNotFound', target: target.split(':')[0], exception: 'DriveNotFoundException', id: 'DriveNotFound,Microsoft.PowerShell.Commands.SetLocationCommand' });
      const path = resolve(ctx, target);
      const st = WS.fs.stat(path);
      if (!st) {
        if (WS.storage.isCdrom(path[0])) ctx.throw({ message: 'The device is not ready.', category: 'ReadError', target: path, exception: 'IOException', id: 'DriveNotReady,Microsoft.PowerShell.Commands.SetLocationCommand' });
        if (/^[a-z]:/i.test(path) && !WS.fs.hasDrive(path[0])) ctx.throw({ message: `Cannot find drive. A drive with the name '${path[0]}' does not exist.`, category: 'ObjectNotFound', target: path[0], exception: 'DriveNotFoundException', id: 'DriveNotFound,Microsoft.PowerShell.Commands.SetLocationCommand' });
        ctx.throw({ message: `Cannot find path '${path}' because it does not exist.`, category: 'ObjectNotFound', target: path, exception: 'ItemNotFoundException', id: 'PathNotFound,Microsoft.PowerShell.Commands.SetLocationCommand' });
      }
      if (st.type !== 'dir') ctx.throw({ message: `Cannot find path '${path}' because it does not exist.`, category: 'ObjectNotFound', target: path, exception: 'ItemNotFoundException', id: 'PathNotFound,Microsoft.PowerShell.Commands.SetLocationCommand' });
      ctx.session.cwd = path.length === 2 ? path + '\\' : path;
      if (p.PassThru) ctx.out(ctx.session.getVar('PWD'));
    } });
  cmdlet({ name: 'Push-Location', module: MGMT, params: { Path: { pos: 0 } },
    async process(ctx, p) { ctx.session.locStack.push(ctx.session.cwd); if (p.Path) await PS.findCmdlet('Set-Location').process(ctx, { Path: p.Path }); } });
  cmdlet({ name: 'Pop-Location', module: MGMT, process(ctx) { const l = ctx.session.locStack.pop(); if (l) ctx.session.cwd = l; } });

  cmdlet({ name: 'Get-ChildItem', module: MGMT, aliases: [], synopsis: 'Gets the items and child items in one or more specified locations.',
    params: { Path: { type: 'string[]', pos: 0, pipe: 'both', alias: ['FullName'] }, LiteralPath: { type: 'string[]', alias: ['PSPath'] }, Filter: { pos: 1 }, Include: { type: 'string[]' }, Exclude: { type: 'string[]' },
      Recurse: { type: 'switch', alias: ['s'] }, Depth: { type: 'int' }, Force: { type: 'switch' }, Name: { type: 'switch' }, Directory: { type: 'switch', alias: ['ad', 'd'] }, File: { type: 'switch', alias: ['af'] }, Hidden: { type: 'switch', alias: ['ah', 'h'] } },
    process(ctx, p) {
      const paths = p.Path || p.LiteralPath || ['.'];
      for (const raw of paths) {
        if (/^env:\\?\*?$/i.test(raw)) {
          const env = { ...WS.fs.env(), ...ctx.session.envOverrides };
          Object.keys(env).filter(k => env[k] != null).sort((a, b) => a.localeCompare(b)).forEach(k => ctx.out(psobj('System.Collections.DictionaryEntry', { Name: k, Value: env[k], Key: k })));
          continue;
        }
        if (/^(hklm|hkcu|cert|variable|alias|function|wsman):/i.test(raw)) {
          if (/^variable:/i.test(raw)) { for (let s = ctx.session.scope; s; s = s.parent) for (const v of s.vars.values()) ctx.out(psobj('System.Management.Automation.PSVariable', { Name: v.name, Value: v.value })); continue; }
          if (/^alias:/i.test(raw)) { for (const [k, v] of Object.entries(PS.aliases)) ctx.out(aliasObj(k, v)); continue; }
          const prov = (PS.providers || {})[raw.split(':')[0].toLowerCase()]; // other files add providers (cert: in ps-cmdlets-iis.js)
          if (prov) { prov.childItems(ctx, raw, p); continue; }
          ctx.error({ message: `The ${raw.split(':')[0].toUpperCase()} provider is not available in the lab simulator.`, category: 'NotImplemented', target: raw, exception: 'NotSupportedException', id: 'NotSupported,Microsoft.PowerShell.Commands.GetChildItemCommand' });
          continue;
        }
        let targets = hasWild(raw) ? null : [resolve(ctx, raw)];
        let pattern = p.Filter || null;
        if (!targets) { const full = resolve(ctx, raw); targets = [full.replace(/\\[^\\]*$/, '') || full.slice(0, 3)]; pattern = full.replace(/^.*\\/, ''); }
        for (const t of targets) {
          const st = WS.fs.stat(t);
          if (!st) { fsError(ctx, { code: WS.storage.isCdrom(t[0]) ? 'NotReady' : 'NotFound', message: '' }, t, { id: 'PathNotFound' }); continue; }
          if (st.type === 'file') { emit(st); continue; }
          const walk = (dir, depth) => {
            let items;
            try { items = WS.fs.list(dir, null, { hidden: p.Force || p.Hidden }); } catch (e) { fsError(ctx, e, dir); return; }
            for (const it of items) {
              const nameOk = (!pattern || wild(pattern, it.name)) && (!p.Include || p.Include.some(i => wild(i, it.name))) && !(p.Exclude && p.Exclude.some(x => wild(x, it.name)));
              if (nameOk && (!p.Hidden || it.hidden)) emit(it);
              if (p.Recurse && it.type === 'dir' && (p.Depth == null || depth < p.Depth)) walk(it.path, depth + 1);
            }
          };
          walk(st.path, 0);
        }
      }
      function emit(st) {
        if (p.Directory && st.type !== 'dir') return;
        if (p.File && st.type !== 'file') return;
        ctx.out(p.Name ? st.name : itemObj(st));
      }
    } });
  cmdlet({ name: 'Get-Item', module: MGMT, params: { Path: { type: 'string[]', pos: 0, pipe: 'both', mandatory: true }, Force: { type: 'switch' } },
    process(ctx, p) {
      for (const raw of p.Path) {
        if (/^env:/i.test(raw)) { const k = raw.slice(4).replace(/^\\/, ''); const v = ctx.session.getVar('env:' + k); if (v == null) ctx.error({ message: `Cannot find path '${raw}' because it does not exist.`, category: 'ObjectNotFound', target: raw, exception: 'ItemNotFoundException', id: 'PathNotFound,Microsoft.PowerShell.Commands.GetItemCommand' }); else ctx.out(psobj('System.Collections.DictionaryEntry', { Name: k, Value: v })); continue; }
        const paths = expandPaths(ctx, raw);
        if (!paths.length) { fsError(ctx, { code: 'NotFound' }, resolve(ctx, raw)); continue; }
        for (const path of paths) { const st = WS.fs.stat(path); if (st) ctx.out(itemObj(st)); else fsError(ctx, { code: 'NotFound' }, path); }
      }
    } });
  cmdlet({ name: 'Test-Path', module: MGMT, synopsis: 'Determines whether all elements of a path exist.',
    params: { Path: { type: 'string[]', pos: 0, pipe: 'both', mandatory: true }, PathType: { type: 'enum', values: ['Any', 'Container', 'Leaf'], enumType: 'Microsoft.PowerShell.Commands.TestPathType' }, IsValid: { type: 'switch' } },
    process(ctx, p) {
      for (const raw of p.Path) {
        if (/^env:/i.test(raw)) { ctx.out(ctx.session.getVar('env:' + raw.slice(4).replace(/^\\/, '')) != null); continue; }
        if (p.IsValid) { ctx.out(!/[<>"|?*]/.test(raw.replace(/^[A-Za-z]:/, ''))); continue; }
        const paths = expandPaths(ctx, raw);
        const sts = paths.map(x => WS.fs.stat(x)).filter(Boolean);
        ctx.out(sts.length > 0 && sts.every(st => !p.PathType || p.PathType === 'Any' || (p.PathType === 'Container' ? st.type === 'dir' : st.type === 'file')));
      }
    } });
  cmdlet({ name: 'New-Item', module: MGMT, shouldProcess: true, synopsis: 'Creates a new item.',
    params: { Path: { type: 'string[]', pos: 0, pipe: 'name' }, Name: { pipe: 'name' }, ItemType: { alias: ['Type'] }, Value: { type: 'object', pipe: 'value', pos: 1 }, Force: { type: 'switch' } },
    async process(ctx, p) {
      const bases = p.Path || ['.'];
      for (const b of bases) {
        const path = p.Name ? resolve(ctx, b).replace(/\\$/, '') + '\\' + p.Name : resolve(ctx, b);
        const type = String(p.ItemType || 'File').toLowerCase();
        if (!['file', 'directory', 'folder', 'dir', 'd', 'f'].includes(type) && type !== 'symboliclink') ctx.throw({ message: `The type is not a known type for the file system. Only "file","directory","Junction","HardLink" or "SymbolicLink" can be specified.`, category: 'InvalidArgument', target: '', exception: 'ArgumentException', id: 'Argument,Microsoft.PowerShell.Commands.NewItemCommand' });
        if (!(await ctx.confirm(type.startsWith('d') || type === 'folder' ? 'Create Directory' : 'Create File', `Destination: ${path}`))) continue;
        try {
          if (type.startsWith('d') || type === 'folder') {
            if (WS.fs.exists(path) && !p.Force) { ctx.error({ message: `An item with the specified name ${path} already exists.`, category: 'ResourceExists', target: path, targetType: 'String', exception: 'IOException', id: 'DirectoryExist,Microsoft.PowerShell.Commands.NewItemCommand' }); continue; }
            WS.fs.mkdir(path, null, { existOk: !!p.Force });
          } else {
            if (WS.fs.exists(path) && !p.Force) { ctx.error({ message: `The file '${path}' already exists.`, category: 'WriteError', target: path, targetType: 'String', exception: 'IOException', id: 'NewItemIOError,Microsoft.PowerShell.Commands.NewItemCommand' }); continue; }
            if (p.Force) WS.fs.ensureDir(path.replace(/\\[^\\]+$/, ''));
            WS.fs.writeFile(path, p.Value == null ? '' : toStr(p.Value));
          }
          ctx.out(itemObj(WS.fs.stat(path)));
        } catch (e) { if (e instanceof WS.fs.Error) fsError(ctx, e, path, { id: 'NewItemIOError' }); else throw e; }
      }
    } });
  cmdlet({ name: 'Remove-Item', module: MGMT, shouldProcess: true, synopsis: 'Deletes the specified items.',
    params: { Path: { type: 'string[]', pos: 0, pipe: 'both', mandatory: true, alias: ['FullName'] }, Recurse: { type: 'switch' }, Force: { type: 'switch' }, Include: { type: 'string[]' }, Exclude: { type: 'string[]' } },
    async process(ctx, p) {
      for (const raw of p.Path) {
        const paths = expandPaths(ctx, raw);
        if (!paths.length) { fsError(ctx, { code: 'NotFound' }, resolve(ctx, raw)); continue; }
        for (const path of paths) {
          const st = WS.fs.stat(path);
          if (!st) { fsError(ctx, { code: 'NotFound' }, path); continue; }
          let recurse = p.Recurse;
          if (st.type === 'dir' && !recurse && WS.fs.list(path, null, { hidden: true }).length) {
            if (!(await ctx.confirm('', '', { caption: 'Confirm', query: `The item at ${path} has children and the Recurse parameter was not specified. If you continue, all children will be removed with the item. Are you sure you want to continue?`, impact: 'High' }))) continue;
            recurse = true;
          } else if (!(await ctx.confirm(st.type === 'dir' ? 'Remove Directory' : 'Remove File', path))) continue;
          if (st.hidden && !p.Force && !hasWild(raw)) { ctx.error({ message: `You do not have sufficient access rights to perform this operation or the item is hidden, system, or read only.`, category: 'PermissionDenied', target: path, exception: 'IOException', id: 'RemoveFileSystemItemUnAuthorizedAccess,Microsoft.PowerShell.Commands.RemoveItemCommand' }); continue; }
          try { WS.fs.remove(path, null, { recursive: recurse }); } catch (e) { if (e instanceof WS.fs.Error) fsError(ctx, e, path); else throw e; }
        }
      }
    } });
  const copyMove = move => ({
    module: MGMT, shouldProcess: true,
    params: { Path: { type: 'string[]', pos: 0, pipe: 'both', mandatory: true, alias: ['FullName'] }, Destination: { pos: 1 }, Recurse: { type: 'switch' }, Force: { type: 'switch' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      const dest = resolve(ctx, p.Destination || '.');
      for (const raw of p.Path) {
        const paths = expandPaths(ctx, raw);
        if (!paths.length) { fsError(ctx, { code: 'NotFound' }, resolve(ctx, raw)); continue; }
        for (const path of paths) {
          if (!(await ctx.confirm(move ? 'Move Item' : 'Copy File', `Item: ${path} Destination: ${dest}`))) continue;
          try {
            if (move) WS.fs.move(path, dest, null, { force: p.Force }); else WS.fs.copy(path, dest, null, { recursive: p.Recurse, force: p.Force });
            if (p.PassThru) { const t = WS.fs.isDir(dest) && !WS.fs.isDir(path) ? dest + '\\' + path.replace(/^.*\\/, '') : dest; const st = WS.fs.stat(t); if (st) ctx.out(itemObj(st)); }
          } catch (e) { if (e instanceof WS.fs.Error) fsError(ctx, e, e.code === 'NotFound' ? path : dest, { id: e.code === 'Exists' ? (move ? 'MoveDirectoryItemIOError' : 'CopyDirectoryInfoItemIOError') : undefined }); else throw e; }
        }
      }
    }
  });
  cmdlet({ name: 'Copy-Item', synopsis: 'Copies an item from one location to another.', ...copyMove(false) });
  cmdlet({ name: 'Move-Item', synopsis: 'Moves an item from one location to another.', ...copyMove(true) });
  cmdlet({ name: 'Rename-Item', module: MGMT, shouldProcess: true, synopsis: 'Renames an item in a PowerShell provider namespace.',
    params: { Path: { pos: 0, pipe: 'both', mandatory: true, alias: ['FullName'] }, NewName: { pos: 1, mandatory: true }, Force: { type: 'switch' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      const path = resolve(ctx, p.Path);
      if (/[\\/]/.test(p.NewName)) ctx.throw({ message: 'Cannot rename the specified target, because it represents a path or device name.', category: 'InvalidArgument', target: p.NewName, exception: 'PSArgumentException', id: 'Argument,Microsoft.PowerShell.Commands.RenameItemCommand' });
      if (!(await ctx.confirm('Rename Item', `Item: ${path} Destination: ${path.replace(/[^\\]+$/, '')}${p.NewName}`))) return;
      try { WS.fs.rename(path, p.NewName); if (p.PassThru) ctx.out(itemObj(WS.fs.stat(path.replace(/[^\\]+$/, '') + p.NewName))); }
      catch (e) { if (e instanceof WS.fs.Error) fsError(ctx, e, path, { id: e.code === 'Exists' ? 'RenameItemIOError' : undefined }); else throw e; }
    } });
  cmdlet({ name: 'Get-Content', module: MGMT, synopsis: 'Gets the content of the item at the specified location.',
    params: { Path: { type: 'string[]', pos: 0, pipe: 'both', mandatory: true, alias: ['FullName', 'PSPath'] }, TotalCount: { type: 'long', alias: ['First', 'Head'] }, Tail: { type: 'int', alias: ['Last'] }, Raw: { type: 'switch' }, Encoding: {} },
    process(ctx, p) {
      for (const raw of p.Path) {
        const paths = expandPaths(ctx, raw);
        if (!paths.length) { fsError(ctx, { code: 'NotFound' }, resolve(ctx, raw)); continue; }
        for (const path of paths) {
          let text;
          try { text = WS.fs.readFile(path); } catch (e) { if (e instanceof WS.fs.Error) { fsError(ctx, e, path); continue; } throw e; }
          if (p.Raw) { ctx.out(text); continue; }
          let lines = text.split(/\r?\n/);
          if (lines.length && lines[lines.length - 1] === '') lines.pop();
          if (p.TotalCount != null) lines = lines.slice(0, p.TotalCount);
          if (p.Tail != null) lines = lines.slice(-p.Tail);
          ctx.outMany(lines);
        }
      }
    } });
  const setContent = append => ({
    module: MGMT, shouldProcess: true,
    params: { Path: { type: 'string[]', pos: 0, mandatory: true, alias: ['PSPath'] }, Value: { type: 'object[]', pos: 1, pipe: 'value' }, Force: { type: 'switch' }, NoNewline: { type: 'switch' }, Encoding: {}, PassThru: { type: 'switch' } },
    begin(ctx) { ctx.state.vals = []; },
    process(ctx, p) { if (p.Value) ctx.state.vals.push(...p.Value); ctx.state.p = p; },
    async end(ctx, p) {
      const vals = ctx.state.vals;
      const text = vals.map(toStr).join(p.NoNewline ? '' : '\r\n') + (p.NoNewline || !vals.length ? '' : '\r\n');
      for (const raw of p.Path) {
        const path = resolve(ctx, raw);
        if (!(await ctx.confirm(append ? 'Add Content' : 'Set Content', `Path: ${path}`))) continue;
        try {
          if (p.Force) WS.fs.ensureDir(path.replace(/\\[^\\]+$/, ''));
          if (append && WS.fs.exists(path)) { const cur = WS.fs.readFile(path); WS.fs.writeFile(path, (cur && !/\n$/.test(cur) ? '\r\n' : '') + text, null, { append: true }); }
          else WS.fs.writeFile(path, text);
          if (p.PassThru) ctx.outMany(vals);
        } catch (e) { if (e instanceof WS.fs.Error) fsError(ctx, e, path, { id: e.code === 'PathNotFound' ? 'GetContentWriterDirectoryNotFoundError' : undefined }); else throw e; }
      }
    }
  });
  cmdlet({ name: 'Set-Content', synopsis: 'Writes new content or replaces existing content in a file.', ...setContent(false) });
  cmdlet({ name: 'Add-Content', synopsis: 'Adds content to the specified items, such as adding words to a file.', ...setContent(true) });
  cmdlet({ name: 'Clear-Content', module: MGMT, params: { Path: { type: 'string[]', pos: 0, mandatory: true } }, process(ctx, p) { for (const raw of p.Path) { const path = resolve(ctx, raw); try { WS.fs.readFile(path); WS.fs.writeFile(path, ''); } catch (e) { fsError(ctx, e, path); } } } });
  cmdlet({ name: 'Out-File', module: UTIL, shouldProcess: true, synopsis: 'Sends output to a file.', acceptsInput: true,
    params: { FilePath: { pos: 0, mandatory: true, alias: ['Path'] }, Encoding: { pos: 1 }, Append: { type: 'switch' }, Force: { type: 'switch' }, NoClobber: { type: 'switch' }, Width: { type: 'int' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); else if (p.InputObject !== undefined) ctx.state.items.push(p.InputObject); },
    end(ctx, p) {
      const path = resolve(ctx, p.FilePath);
      if (p.NoClobber && WS.fs.exists(path)) ctx.throw({ message: `The file '${path}' already exists.`, category: 'ResourceExists', target: path, exception: 'IOException', id: 'NoClobber,Microsoft.PowerShell.Commands.OutFileCommand' });
      const lines = PS.formatOut(ctx.state.items, p.Width || 120);
      try { WS.fs.writeFile(path, lines.join('\r\n') + (lines.length ? '\r\n' : ''), null, { append: p.Append }); }
      catch (e) { fsError(ctx, e, path, { terminating: true, id: 'FileOpenFailure' }); }
    } });
  cmdlet({ name: 'Resolve-Path', module: MGMT, params: { Path: { type: 'string[]', pos: 0, mandatory: true } },
    process(ctx, p) { for (const raw of p.Path) { const ps = expandPaths(ctx, raw).filter(x => WS.fs.exists(x)); if (!ps.length) fsError(ctx, { code: 'NotFound' }, resolve(ctx, raw)); ps.forEach(x => ctx.out(psobj('System.Management.Automation.PathInfo', { Path: WS.fs.full(x), ProviderPath: WS.fs.full(x) }, { str: WS.fs.full(x) }))); } } });
  cmdlet({ name: 'Get-PSDrive', module: MGMT,
    process(ctx) {
      for (const l of WS.fs.drives()) {
        const v = WS.storage.volume(l);
        ctx.out(psobj('System.Management.Automation.PSDriveInfo', { Name: l, 'Used (GB)': v ? +(v.used / WS.storage.GB).toFixed(2) : null, 'Free (GB)': v ? +(v.free / WS.storage.GB).toFixed(2) : null, Provider: 'FileSystem', Root: l + ':\\', CurrentLocation: ctx.session.cwd[0] === l ? ctx.session.cwd.slice(3) : '' }));
      }
      // mapped network drives show the share they point at (DisplayRoot)
      for (const d of WS.netuse ? WS.netuse.list({ all: true }) : []) {
        const r = WS.netuse.resolveUnc(d.remote), v = r.ok ? WS.storage.volume(r.path[0]) : null;
        ctx.out(psobj('System.Management.Automation.PSDriveInfo', { Name: d.letter, 'Used (GB)': v ? +(v.used / WS.storage.GB).toFixed(2) : null, 'Free (GB)': v ? +(v.free / WS.storage.GB).toFixed(2) : null, Provider: 'FileSystem', Root: d.remote, DisplayRoot: d.remote, CurrentLocation: ctx.session.cwd[0] === d.letter ? ctx.session.cwd.slice(3) : '' }));
      }
      for (const [n, pr] of [['Alias', 'Alias'], ['Cert', 'Certificate'], ['Env', 'Environment'], ['Function', 'Function'], ['HKCU', 'Registry'], ['HKLM', 'Registry'], ['Variable', 'Variable'], ['WSMan', 'WSMan']]) ctx.out(psobj('System.Management.Automation.PSDriveInfo', { Name: n, 'Used (GB)': null, 'Free (GB)': null, Provider: pr, Root: n === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : n === 'HKCU' ? 'HKEY_CURRENT_USER' : n === 'Cert' ? '\\' : '', CurrentLocation: '' }));
    } });
  /** New-PSDrive: a FileSystem drive on a UNC path (-Persist makes it a mapped network drive that net use and File Explorer see). */
  const driveErr = (ctx, message, id, category = 'InvalidArgument') => ctx.error({ message, category, target: null, exception: 'IOException', id: `${id},Microsoft.PowerShell.Commands.NewPSDriveCommand` });
  cmdlet({ name: 'New-PSDrive', module: MGMT, aliases: ['mount', 'ndr'], shouldProcess: true, synopsis: 'Creates temporary and persistent drives that are associated with a location in an item data store.',
    params: { Name: { pos: 0, mandatory: true }, PSProvider: { pos: 1, mandatory: true }, Root: { pos: 2, mandatory: true }, Description: {}, Scope: {}, Persist: { type: 'switch' }, Credential: {} },
    process(ctx, p) {
      if (!/^filesystem$/i.test(String(p.PSProvider).replace(/^.*\\/, ''))) return ctx.error({ message: `Cannot find a provider with the name '${p.PSProvider}'.`, category: 'ObjectNotFound', target: p.PSProvider, exception: 'ProviderNotFoundException', id: 'ProviderNotFound,Microsoft.PowerShell.Commands.NewPSDriveCommand' });
      const name = String(p.Name).replace(/:$/, '');
      const root = String(p.Root);
      if (!/^\\\\/.test(root)) {
        if (p.Persist) return driveErr(ctx, 'When you use the Persist parameter, the root must be a file system location on a remote computer.', 'DriveRootNotNetworkPath');
        return ctx.error({ message: 'Only drives on a network share (\\\\server\\share) can be created in the lab simulator.', category: 'NotImplemented', target: root, exception: 'NotSupportedException', id: 'NotSupported,Microsoft.PowerShell.Commands.NewPSDriveCommand' });
      }
      if (p.Persist && !/^[a-z]$/i.test(name)) return driveErr(ctx, 'The drive name for a persistent drive must be a single letter.', 'DriveNameNotSupportedForPersistence');
      if (!/^[a-z]$/i.test(name)) return ctx.error({ message: 'Drive names other than a single letter are not supported in the lab simulator.', category: 'NotImplemented', target: name, exception: 'NotSupportedException', id: 'NotSupported,Microsoft.PowerShell.Commands.NewPSDriveCommand' });
      if (WS.fs.hasDrive(name)) return ctx.error({ message: `A drive with the name '${name.toUpperCase()}' already exists.`, category: 'ResourceExists', target: name, exception: 'SessionStateException', id: 'DriveAlreadyExists,Microsoft.PowerShell.Commands.NewPSDriveCommand' });
      const r = WS.netuse.connect(name, root, { persistent: !!p.Persist, psOnly: !p.Persist });
      if (!r.ok) return driveErr(ctx, r.error, r.code === 'NetPath' ? 'CouldNotMapNetworkDrive' : 'CouldNotMapNetworkDrive', r.code === 'InUse' ? 'ResourceExists' : 'InvalidOperation');
      const res = WS.netuse.resolveUnc(r.drive.remote), v = res.ok ? WS.storage.volume(res.path[0]) : null;
      ctx.out(psobj('System.Management.Automation.PSDriveInfo', { Name: r.letter, 'Used (GB)': v ? +(v.used / WS.storage.GB).toFixed(2) : null, 'Free (GB)': v ? +(v.free / WS.storage.GB).toFixed(2) : null, Provider: 'FileSystem', Root: r.drive.remote, DisplayRoot: r.drive.remote, CurrentLocation: '' }));
    } });
  cmdlet({ name: 'Remove-PSDrive', module: MGMT, aliases: ['rdr'], shouldProcess: true, params: { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, PSProvider: {}, Scope: {}, Force: { type: 'switch' } },
    process(ctx, p) {
      for (const raw of p.Name) {
        const n = String(raw).replace(/:$/, '');
        if (WS.netuse.get(n)) { WS.netuse.disconnect(n); continue; }
        if (WS.fs.drives().includes(n.toUpperCase()) || /^(alias|cert|env|function|hkcu|hklm|variable|wsman)$/i.test(n)) { ctx.error({ message: `Drive '${n}' cannot be removed because the provider 'Microsoft.PowerShell.Core\\${/^[a-z]$/i.test(n) ? 'FileSystem' : 'Registry'}' prevented it.`, category: 'InvalidOperation', target: n, exception: 'PSInvalidOperationException', id: 'DriveRemovalPreventedByProvider,Microsoft.PowerShell.Commands.RemovePSDriveCommand' }); continue; }
        ctx.error({ message: `Cannot find drive. A drive with the name '${n}' does not exist.`, category: 'ObjectNotFound', target: n, exception: 'DriveNotFoundException', id: 'DriveNotFound,Microsoft.PowerShell.Commands.RemovePSDriveCommand' });
      }
    } });
  view('System.Management.Automation.PSDriveInfo', { table: { columns: [{ label: 'Name', width: 8, value: 'Name' }, { label: 'Used (GB)', width: 9, align: 'right', value: o => (o['Used (GB)'] == null ? '' : o['Used (GB)'].toFixed(2)) }, { label: 'Free (GB)', width: 9, align: 'right', value: o => (o['Free (GB)'] == null ? '' : o['Free (GB)'].toFixed(2)) }, { label: 'Provider', width: 11, value: 'Provider' }, { label: 'Root', width: 26, value: 'Root' }, { label: 'CurrentLocation', align: 'right', value: 'CurrentLocation' }] } });

  /* ================================================================ objects in the pipeline */
  const OPS = ['EQ', 'NE', 'GT', 'GE', 'LT', 'LE', 'Like', 'NotLike', 'Match', 'NotMatch', 'Contains', 'NotContains', 'In', 'NotIn', 'CEQ', 'CNE', 'CLike', 'CMatch', 'Is', 'IsNot'];
  const opParams = Object.fromEntries(OPS.map(o => [o, { type: 'switch' }]));
  cmdlet({ name: 'Where-Object', module: CORE, acceptsInput: true, synopsis: 'Selects objects from a collection based on their property values.',
    params: { FilterScript: { type: 'object', pos: 0 }, Value: { type: 'object', pos: 1 }, InputObject: { type: 'object', pipe: 'value' }, ...opParams },
    async process(ctx, p, item) {
      if (item === undefined) item = p.InputObject;
      if (item === undefined) return;
      const f = p.FilterScript;
      if (f instanceof ScriptBlock) { if (toBool(unwrap(await ctx.invokeBlock(f, { under: item })))) ctx.out(item); return; }
      const prop = getProp(item, toStr(f));
      const op = OPS.find(o => p[o]);
      if (!op) { if (toBool(prop)) ctx.out(item); return; }
      const cs = op.startsWith('C') && op !== 'Contains';
      const map = { EQ: 'eq', NE: 'ne', GT: 'gt', GE: 'ge', LT: 'lt', LE: 'le', Like: 'like', NotLike: 'notlike', Match: 'match', NotMatch: 'notmatch', Contains: 'contains', NotContains: 'notcontains', In: 'in', NotIn: 'notin', CEQ: 'eq', CNE: 'ne', CLike: 'like', CMatch: 'match', Is: 'is', IsNot: 'isnot' };
      if (toBool(PS.binary(map[op], prop, p.Value, cs, ctx.session))) ctx.out(item);
    } });
  cmdlet({ name: 'ForEach-Object', module: CORE, acceptsInput: true, synopsis: 'Performs an operation against each item in a collection of input objects.',
    params: { Process: { type: 'object[]', pos: 0, alias: ['MemberName'] }, Begin: { type: 'scriptblock' }, End: { type: 'scriptblock' }, InputObject: { type: 'object', pipe: 'value' }, ArgumentList: { type: 'object[]', alias: ['Args'] } },
    async begin(ctx, p) { if (p.Begin) ctx.outMany(await ctx.invokeBlock(p.Begin)); },
    async process(ctx, p, item) {
      if (item === undefined) item = p.InputObject;
      for (const pr of p.Process || []) {
        if (pr instanceof ScriptBlock) ctx.outMany(await ctx.invokeBlock(pr, { under: item }));
        else {
          const name = toStr(pr);
          const v = getProp(item, name);
          if (v != null) { ctx.outMany(toArray(v)); continue; }
          try { const r = PS.callMethod(item, name, p.ArgumentList || [], ctx.session); if (r !== undefined) ctx.out(r); } catch (e) { /* PowerShell is silent when the member doesn't exist */ }
        }
      }
    },
    async end(ctx, p) { if (p.End) ctx.outMany(await ctx.invokeBlock(p.End)); } });

  /** Resolve -Property entries (names, wildcards, calculated hashtables) for an object. */
  async function selectProps(ctx, obj, props) {
    const out = [];
    for (const pr of props) {
      if (pr instanceof PSHashtable) {
        const label = toStr(pr.get('Name') || pr.get('n') || pr.get('Label') || pr.get('l'));
        const ex = pr.get('Expression') || pr.get('e');
        const value = ex instanceof ScriptBlock ? unwrap(await ctx.invokeBlock(ex, { under: obj })) : getProp(obj, toStr(ex));
        out.push([label || toStr(ex), value, pr]);
        continue;
      }
      if (pr instanceof ScriptBlock) { out.push([pr.toString().trim(), unwrap(await ctx.invokeBlock(pr, { under: obj }))]); continue; }
      const name = toStr(pr);
      if (hasWild(name)) { for (const k of PS.visibleProps(obj)) if (wild(name, k)) out.push([k, obj[k]]); continue; }
      const real = PS.isObj(obj) ? Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase()) : null;
      out.push([real || name, getProp(obj, name)]);
    }
    return out;
  }
  cmdlet({ name: 'Select-Object', module: UTIL, acceptsInput: true, synopsis: 'Selects objects or object properties.',
    params: { Property: { type: 'object[]', pos: 0 }, ExpandProperty: {}, First: { type: 'int' }, Last: { type: 'int' }, Skip: { type: 'int' }, Unique: { type: 'switch' }, Index: { type: 'int[]' }, ExcludeProperty: { type: 'string[]' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item === undefined) item = p.InputObject; if (item !== undefined) ctx.state.items.push(item); },
    async end(ctx, p) {
      let items = ctx.state.items;
      if (p.Skip) items = items.slice(p.Skip);
      if (p.Index) items = p.Index.map(i => items[i]).filter(x => x !== undefined);
      if (p.First != null || p.Last != null) items = [...(p.First != null ? items.slice(0, p.First) : []), ...(p.Last != null ? items.slice(-p.Last || items.length) : [])];
      for (const obj of items) {
        if (p.ExpandProperty) {
          const v = getProp(obj, p.ExpandProperty);
          if (v == null && !(PS.isObj(obj) && Object.keys(obj).some(k => k.toLowerCase() === p.ExpandProperty.toLowerCase()))) { ctx.error({ message: `Property "${p.ExpandProperty}" cannot be found.`, category: 'InvalidArgument', target: toStr(obj), targetType: PS.shortType(obj), exception: 'PSArgumentException', id: 'ExpandPropertyNotFound,Microsoft.PowerShell.Commands.SelectObjectCommand' }); continue; }
          ctx.outMany(toArray(v));
          continue;
        }
        if (!p.Property || typeof obj !== 'object' || obj === null) { ctx.out(obj); continue; }
        const pairs = await selectProps(ctx, obj, p.Property);
        const props = {};
        for (const [k, v] of pairs) if (!(p.ExcludeProperty || []).some(x => wild(x, k))) props[k] = v;
        ctx.out(psobj('Selected.' + PS.typeName(obj), props));
      }
      if (p.Unique) { const seen = new Set(); ctx.outputs = ctx.outputs.filter(o => { const k = typeof o === 'object' && o ? JSON.stringify(o) : String(o).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); }
    } });
  cmdlet({ name: 'Sort-Object', module: UTIL, acceptsInput: true, synopsis: 'Sorts objects by property values.',
    params: { Property: { type: 'object[]', pos: 0 }, Descending: { type: 'switch' }, Unique: { type: 'switch' }, CaseSensitive: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item === undefined) item = p.InputObject; if (item !== undefined) ctx.state.items.push(item); },
    async end(ctx, p) {
      const keys = [];
      for (const obj of ctx.state.items) {
        const k = [];
        for (const pr of p.Property || [null]) {
          if (pr == null) k.push([obj, false]);
          else if (pr instanceof ScriptBlock) k.push([unwrap(await ctx.invokeBlock(pr, { under: obj })), false]);
          else if (pr instanceof PSHashtable) { const ex = pr.get('Expression') || pr.get('e'); k.push([ex instanceof ScriptBlock ? unwrap(await ctx.invokeBlock(ex, { under: obj })) : getProp(obj, toStr(ex)), toBool(pr.get('Descending'))]); }
          else k.push([getProp(obj, toStr(pr)), false]);
        }
        keys.push({ obj, k });
      }
      const dir = p.Descending ? -1 : 1;
      keys.sort((a, b) => {
        for (let i = 0; i < a.k.length; i++) {
          const x = a.k[i][0], y = b.k[i][0];
          let c = x == null && y == null ? 0 : x == null ? -1 : y == null ? 1 : typeof x === 'number' && typeof y === 'number' ? x - y : x instanceof Date ? x - y : (p.CaseSensitive ? (toStr(x) < toStr(y) ? -1 : toStr(x) > toStr(y) ? 1 : 0) : toStr(x).localeCompare(toStr(y), undefined, { sensitivity: 'base', numeric: true }));
          if (a.k[i][1]) c = -c;
          if (c) return c * dir;
        }
        return 0;
      });
      let out = keys.map(x => x.obj);
      if (p.Unique) { const seen = new Set(); out = out.filter(o => { const s = toStr(o).toLowerCase(); if (seen.has(s)) return false; seen.add(s); return true; }); }
      ctx.outMany(out);
    } });
  view('Microsoft.PowerShell.Commands.GenericMeasureInfo', { list: ['Count', 'Average', 'Sum', 'Maximum', 'Minimum', 'Property'] });
  view('Microsoft.PowerShell.Commands.TextMeasureInfo', { table: { columns: [{ label: 'Lines', value: 'Lines', align: 'right' }, { label: 'Words', value: 'Words', align: 'right' }, { label: 'Characters', value: 'Characters', align: 'right' }, { label: 'Property', value: 'Property' }] } });
  cmdlet({ name: 'Measure-Object', module: UTIL, acceptsInput: true, synopsis: 'Calculates the numeric properties of objects, and the characters, words, and lines in string objects, such as files of text.',
    params: { Property: { type: 'string[]', pos: 0 }, Sum: { type: 'switch' }, Average: { type: 'switch' }, Maximum: { type: 'switch' }, Minimum: { type: 'switch' }, Line: { type: 'switch' }, Word: { type: 'switch' }, Character: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item === undefined) item = p.InputObject; if (item !== undefined) ctx.state.items.push(item); },
    end(ctx, p) {
      const items = ctx.state.items;
      if (p.Line || p.Word || p.Character) {
        const text = items.map(toStr);
        ctx.out(psobj('Microsoft.PowerShell.Commands.TextMeasureInfo', { Lines: p.Line ? text.length : null, Words: p.Word ? text.join(' ').split(/\s+/).filter(Boolean).length : null, Characters: p.Character ? text.join('').length : null, Property: null }));
        return;
      }
      for (const prop of p.Property || [null]) {
        const vals = prop ? items.map(o => getProp(o, prop)).filter(v => v != null) : items;
        const nums = vals.map(v => Number(v)).filter(n => !isNaN(n));
        ctx.out(psobj('Microsoft.PowerShell.Commands.GenericMeasureInfo', {
          Count: vals.length, Average: p.Average ? nums.reduce((a, b) => a + b, 0) / (nums.length || 1) : null, Sum: p.Sum ? nums.reduce((a, b) => a + b, 0) : null,
          Maximum: p.Maximum ? Math.max(...nums) : null, Minimum: p.Minimum ? Math.min(...nums) : null, Property: prop
        }));
      }
    } });
  view('Microsoft.PowerShell.Commands.GroupInfo', { table: { columns: [{ label: 'Count', width: 5, align: 'right', value: 'Count' }, { label: 'Name', width: 25, value: 'Name' }, { label: 'Group', value: o => o.Group }] } });
  view('Microsoft.PowerShell.Commands.GroupInfoNoElement', { table: { columns: [{ label: 'Count', width: 5, align: 'right', value: 'Count' }, { label: 'Name', value: 'Name' }] } });
  cmdlet({ name: 'Group-Object', module: UTIL, acceptsInput: true, synopsis: 'Groups objects that contain the same value for specified properties.',
    params: { Property: { type: 'object[]', pos: 0 }, NoElement: { type: 'switch' }, AsHashTable: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item === undefined) item = p.InputObject; if (item !== undefined) ctx.state.items.push(item); },
    async end(ctx, p) {
      const groups = new Map();
      for (const obj of ctx.state.items) {
        const vals = [];
        for (const pr of p.Property || [null]) vals.push(pr == null ? obj : pr instanceof ScriptBlock ? unwrap(await ctx.invokeBlock(pr, { under: obj })) : getProp(obj, toStr(pr)));
        const key = vals.map(toStr).join(', ');
        if (!groups.has(key.toLowerCase())) groups.set(key.toLowerCase(), { name: key, items: [] });
        groups.get(key.toLowerCase()).items.push(obj);
      }
      if (p.AsHashTable) { ctx.out(new PSHashtable([...groups.values()].map(g => [g.name, g.items]))); return; }
      for (const g of groups.values()) ctx.out(psobj(p.NoElement ? 'Microsoft.PowerShell.Commands.GroupInfoNoElement' : 'Microsoft.PowerShell.Commands.GroupInfo', p.NoElement ? { Count: g.items.length, Name: g.name } : { Count: g.items.length, Name: g.name, Group: g.items, Values: [g.name] }));
    } });
  cmdlet({ name: 'Get-Unique', module: UTIL, acceptsInput: true, params: { InputObject: { type: 'object', pipe: 'value' } },
    process(ctx, p, item) { if (item === undefined) return; const k = toStr(item); if (ctx.state.last !== k) ctx.out(item); ctx.state.last = k; } });
  cmdlet({ name: 'Get-Random', module: UTIL, acceptsInput: true, params: { Maximum: { type: 'object', pos: 0 }, Minimum: { type: 'object' }, Count: { type: 'int' }, InputObject: { type: 'object[]', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); else if (p.InputObject) ctx.state.items.push(...p.InputObject); },
    end(ctx, p) {
      const items = ctx.state.items;
      if (items.length) { const pool = items.slice(); const n = Math.min(p.Count || 1, pool.length); for (let i = 0; i < n; i++) ctx.out(pool.splice(U.randInt(0, pool.length - 1), 1)[0]); return; }
      const min = p.Minimum != null ? PS.toNum(p.Minimum) : 0, max = p.Maximum != null ? PS.toNum(p.Maximum) : 2147483647;
      ctx.out(U.randInt(min, max - 1));
    } });
  view('Microsoft.PowerShell.Commands.MemberDefinition', { table: { groupBy: { label: 'TypeName', value: o => o.TypeName, indent: 3 }, columns: [{ label: 'Name', width: 25, value: 'Name' }, { label: 'MemberType', width: 13, value: 'MemberType' }, { label: 'Definition', value: 'Definition' }] } });
  const METHODS = {
    'System.String': ['Clone', 'CompareTo', 'Contains', 'CopyTo', 'EndsWith', 'Equals', 'GetEnumerator', 'GetHashCode', 'GetType', 'IndexOf', 'IndexOfAny', 'Insert', 'IsNormalized', 'LastIndexOf', 'Normalize', 'PadLeft', 'PadRight', 'Remove', 'Replace', 'Split', 'StartsWith', 'Substring', 'ToCharArray', 'ToLower', 'ToLowerInvariant', 'ToString', 'ToUpper', 'ToUpperInvariant', 'Trim', 'TrimEnd', 'TrimStart'],
    'System.ServiceProcess.ServiceController': ['Close', 'Continue', 'CreateObjRef', 'Dispose', 'Equals', 'ExecuteCommand', 'GetHashCode', 'GetLifetimeService', 'GetType', 'InitializeLifetimeService', 'Pause', 'Refresh', 'Start', 'Stop', 'WaitForStatus', 'ToString'],
    'System.IO.FileInfo': ['AppendText', 'CopyTo', 'Create', 'CreateText', 'Delete', 'Equals', 'GetHashCode', 'GetType', 'MoveTo', 'Open', 'OpenRead', 'OpenText', 'OpenWrite', 'Refresh', 'Replace', 'ToString'],
    'System.IO.DirectoryInfo': ['Create', 'CreateSubdirectory', 'Delete', 'EnumerateDirectories', 'EnumerateFiles', 'Equals', 'GetDirectories', 'GetFiles', 'GetHashCode', 'GetType', 'MoveTo', 'Refresh', 'ToString'],
    'System.DateTime': ['Add', 'AddDays', 'AddHours', 'AddMinutes', 'AddMonths', 'AddSeconds', 'AddYears', 'CompareTo', 'Equals', 'GetHashCode', 'GetType', 'ToLongDateString', 'ToLongTimeString', 'ToShortDateString', 'ToShortTimeString', 'ToString', 'ToUniversalTime']
  };
  const jsType = v => (v == null ? 'System.Object' : typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'double') : typeof v === 'string' ? 'string' : v instanceof Date ? 'datetime' : Array.isArray(v) ? 'System.Object[]' : PS.typeName(v));
  cmdlet({ name: 'Get-Member', module: UTIL, acceptsInput: true, synopsis: 'Gets the properties and methods of objects.',
    params: { Name: { type: 'string[]', pos: 0 }, MemberType: { alias: ['Type'] }, InputObject: { type: 'object', pipe: 'value' }, Static: { type: 'switch' }, Force: { type: 'switch' } },
    begin(ctx) { ctx.state.types = new Map(); },
    process(ctx, p, item) {
      if (item === undefined) item = p.InputObject;
      if (item === undefined || item === null) return;
      const t = PS.typeName(item);
      if (!ctx.state.types.has(t)) ctx.state.types.set(t, item);
    },
    end(ctx, p) {
      if (!ctx.state.types.size) ctx.throw({ message: 'You must specify an object for the Get-Member cmdlet.', category: 'CloseError', exception: 'InvalidOperationException', id: 'NoObjectInGetMember,Microsoft.PowerShell.Commands.GetMemberCommand' });
      for (const [t, obj] of ctx.state.types) {
        const members = [];
        for (const m of METHODS[t] || ['Equals', 'GetHashCode', 'GetType', 'ToString']) members.push({ Name: m, MemberType: 'Method', Definition: `${m === 'ToString' ? 'string' : m === 'Equals' ? 'bool' : m === 'GetHashCode' ? 'int' : m === 'GetType' ? 'type' : 'void'} ${m}()` });
        if (typeof obj === 'string') members.push({ Name: 'Length', MemberType: 'Property', Definition: 'int Length {get;}' });
        else if (obj instanceof PSHashtable) members.push({ Name: 'Count', MemberType: 'Property', Definition: 'int Count {get;}' }, { Name: 'Keys', MemberType: 'Property', Definition: 'System.Collections.ICollection Keys {get;}' }, { Name: 'Values', MemberType: 'Property', Definition: 'System.Collections.ICollection Values {get;}' });
        else if (PS.isObj(obj)) for (const k of Object.keys(obj)) members.push({ Name: k, MemberType: t.startsWith('Selected.') || t === 'System.Management.Automation.PSCustomObject' ? 'NoteProperty' : 'Property', Definition: `${jsType(obj[k])} ${k} {get;${/^(Name|Status|DisplayName)$/.test(k) || t.startsWith('Selected.') ? 'set;' : ''}}` });
        members.sort((a, b) => a.Name.localeCompare(b.Name));
        for (const m of members) {
          if (p.Name && !p.Name.some(n => wild(n, m.Name))) continue;
          if (p.MemberType && !wild(p.MemberType, m.MemberType) && !(p.MemberType.toLowerCase() === 'properties' && /Property/.test(m.MemberType))) continue;
          ctx.out(psobj('Microsoft.PowerShell.Commands.MemberDefinition', { TypeName: t, Name: m.Name, MemberType: m.MemberType, Definition: m.Definition }));
        }
      }
    } });
  cmdlet({ name: 'Compare-Object', module: UTIL, params: { ReferenceObject: { type: 'object[]', pos: 0, mandatory: true }, DifferenceObject: { type: 'object[]', pos: 1, mandatory: true, pipe: 'value' }, Property: { type: 'object[]' }, IncludeEqual: { type: 'switch' }, ExcludeDifferent: { type: 'switch' } },
    process(ctx, p) {
      const key = o => (p.Property ? p.Property.map(pr => toStr(getProp(o, toStr(pr)))).join('|') : toStr(o)).toLowerCase();
      const ref = p.ReferenceObject.map(key), dif = p.DifferenceObject.map(key);
      const outObj = (o, side) => psobj('System.Management.Automation.PSCustomObject', { ...(p.Property ? Object.fromEntries(p.Property.map(pr => [toStr(pr), getProp(o, toStr(pr))])) : { InputObject: o }), SideIndicator: side });
      if (!p.ExcludeDifferent) { p.DifferenceObject.forEach((o, i) => { if (!ref.includes(dif[i])) ctx.out(outObj(o, '=>')); }); p.ReferenceObject.forEach((o, i) => { if (!dif.includes(ref[i])) ctx.out(outObj(o, '<=')); }); }
      if (p.IncludeEqual || p.ExcludeDifferent) p.ReferenceObject.forEach((o, i) => { if (dif.includes(ref[i])) ctx.out(outObj(o, '==')); });
    } });
  cmdlet({ name: 'Tee-Object', module: UTIL, acceptsInput: true, params: { FilePath: { pos: 0 }, Variable: {}, Append: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) { ctx.state.items.push(item); ctx.out(item); } },
    end(ctx, p) {
      if (p.Variable) ctx.session.setVar(p.Variable, unwrap(ctx.state.items.slice()));
      if (p.FilePath) { const lines = PS.formatOut(ctx.state.items, 120); WS.fs.writeFile(resolve(ctx, p.FilePath), lines.join('\r\n') + '\r\n', null, { append: p.Append }); }
    } });
  view('Microsoft.PowerShell.Commands.MatchInfo', { custom: items => ['', ...items.map(m => m.__line), ''] });
  cmdlet({ name: 'Select-String', module: UTIL, acceptsInput: true, synopsis: 'Finds text in strings and files.',
    params: { Pattern: { type: 'string[]', pos: 0, mandatory: true }, Path: { type: 'string[]', pos: 1 }, InputObject: { type: 'object', pipe: 'value' }, SimpleMatch: { type: 'switch' }, CaseSensitive: { type: 'switch' }, NotMatch: { type: 'switch' }, Quiet: { type: 'switch' } },
    process(ctx, p, item) {
      const test = line => p.Pattern.some(pat => (p.SimpleMatch ? (p.CaseSensitive ? line.includes(pat) : line.toLowerCase().includes(pat.toLowerCase())) : new RegExp(pat, p.CaseSensitive ? '' : 'i').test(line)));
      const emit = (line, n, path) => {
        const hit = test(line);
        if (p.NotMatch ? hit : !hit) return;
        if (p.Quiet) { ctx.state.any = true; return; }
        const shown = path ? `${path}:${n}:${line}` : line;
        ctx.out(psobj('Microsoft.PowerShell.Commands.MatchInfo', { IgnoreCase: !p.CaseSensitive, LineNumber: n, Line: line, Filename: path ? path.replace(/^.*\\/, '') : 'InputStream', Path: path || 'InputStream', Pattern: p.Pattern[0] }, { str: shown, hidden: { __line: shown } }));
      };
      if (item !== undefined) { toStr(item).split(/\r?\n/).forEach((l, i) => emit(l, i + 1, null)); return; }
      for (const raw of p.Path || []) {
        for (const path of expandPaths(ctx, raw)) {
          let text; try { text = WS.fs.readFile(path); } catch (e) { fsError(ctx, e, path); continue; }
          text.split(/\r?\n/).forEach((l, i) => emit(l, i + 1, path));
        }
      }
    },
    end(ctx, p) { if (p.Quiet) ctx.out(!!ctx.state.any); } });

  /* ================================================================ formatting cmdlets */
  async function fmtColumns(ctx, objs, props) {
    const first = objs[0];
    const v = first != null ? PS.views[PS.typeName(first)] : null;
    if (!props) {
      if (v && v.table) return { columns: v.table.columns, rows: objs, groupBy: v.table.groupBy };
      const names = v && (v.listProps || v.list) ? (v.listProps || v.list).map(x => (typeof x === 'string' ? x : x.label)) : first && typeof first === 'object' ? PS.visibleProps(first) : null;
      if (!names) return { columns: [{ label: 'Value', value: o => o }], rows: objs, scalar: true };
      return { columns: names.map(n => ({ label: n, value: n })), rows: objs };
    }
    const rows = [];
    let labels = null;
    for (const o of objs) {
      const pairs = await selectProps(ctx, o, props);
      if (!labels) labels = pairs.map(([k, , h]) => ({ label: k, width: h ? (h.get('Width') ? PS.toNum(h.get('Width')) : undefined) : undefined, align: h && h.get('Alignment') ? toStr(h.get('Alignment')).toLowerCase() : undefined }));
      rows.push(Object.fromEntries(pairs.map(([k, val]) => [k, val])));
    }
    return { columns: (labels || []).map(l => ({ ...l, value: l.label })), rows };
  }
  cmdlet({ name: 'Format-Table', module: UTIL, acceptsInput: true, aliases: [], synopsis: 'Formats the output as a table.',
    params: { Property: { type: 'object[]', pos: 0 }, AutoSize: { type: 'switch' }, HideTableHeaders: { type: 'switch' }, Wrap: { type: 'switch' }, GroupBy: { type: 'object' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item === undefined) item = p.InputObject; if (item !== undefined && item !== null) ctx.state.items.push(item); },
    async end(ctx, p) {
      const items = ctx.state.items;
      if (!items.length) return;
      const width = ctx.session.console ? ctx.session.console.cols() : 120;
      const props = p.Property ? (p.Property.length === 1 && toStr(p.Property[0]) === '*' && PS.isObj(items[0]) ? PS.visibleProps(items[0]) : p.Property) : null;
      const { columns, rows, groupBy } = await fmtColumns(ctx, items, props);
      const lines = [''];
      if (groupBy && !props) {
        let cur = null, batch = [];
        const flush = () => { if (batch.length) { lines.push('', `${' '.repeat(groupBy.indent == null ? 4 : groupBy.indent)}${groupBy.label}: ${cur}`, '', ...PS.renderTable(batch, columns, width, { autosize: p.AutoSize, hideHeaders: p.HideTableHeaders }), ''); batch = []; } };
        for (const r of rows) { const g = groupBy.value(r); if (g !== cur) { flush(); cur = g; } batch.push(r); }
        flush();
      } else lines.push(...PS.renderTable(rows, columns, width, { autosize: p.AutoSize, hideHeaders: p.HideTableHeaders }));
      lines.push('', '');
      ctx.out(PS.fmtBlock(lines));
    } });
  cmdlet({ name: 'Format-List', module: UTIL, acceptsInput: true, synopsis: 'Formats the output as a list of properties in which each property appears on a new line.',
    params: { Property: { type: 'object[]', pos: 0 }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item === undefined) item = p.InputObject; if (item !== undefined && item !== null) ctx.state.items.push(item); },
    async end(ctx, p) {
      const lines = [];
      for (const o of ctx.state.items) {
        if (typeof o !== 'object' || o instanceof Date) { lines.push('', toStr(o)); continue; }
        if (o instanceof PSHashtable) { for (const [k, v] of o.entries()) lines.push('', `Name  : ${k}`, `Value : ${PS.cell(v)}`); continue; }
        let pairs;
        if (!p.Property) {
          const v = PS.views[PS.typeName(o)];
          const names = v && (v.listProps || v.list) ? (v.listProps || v.list) : PS.visibleProps(o);
          pairs = names.map(n => (typeof n === 'string' ? [n, getProp(o, n)] : [n.label, (n.get || (x => (typeof n.value === 'function' ? n.value(x) : getProp(x, n.value || n.label))))(o)]));
        } else if (p.Property.length === 1 && toStr(p.Property[0]) === '*') pairs = PS.visibleProps(o).map(k => [k, o[k]]);
        else pairs = (await selectProps(ctx, o, p.Property)).map(([k, v]) => [k, v]);
        const w = Math.max(0, ...pairs.map(x => x[0].length));
        lines.push('');
        for (const [k, v] of pairs) {
          const t = PS.cell(v).split('\n');
          lines.push(`${k.padEnd(w)} : ${t[0]}`.replace(/\s+$/, ''));
          for (const l of t.slice(1)) lines.push(' '.repeat(w + 3) + l);
        }
      }
      if (lines.length) lines.push('', '');
      ctx.out(PS.fmtBlock(lines));
    } });
  cmdlet({ name: 'Format-Wide', module: UTIL, acceptsInput: true, params: { Property: { pos: 0 }, Column: { type: 'int' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); },
    end(ctx, p) {
      const cols = p.Column || 2;
      const width = ctx.session.console ? ctx.session.console.cols() : 120;
      const cw = Math.floor(width / cols);
      const names = ctx.state.items.map(o => toStr(p.Property ? getProp(o, p.Property) : (PS.isObj(o) ? (o.Name || toStr(o)) : o)));
      const lines = [''];
      for (let i = 0; i < names.length; i += cols) lines.push(names.slice(i, i + cols).map(n => n.slice(0, cw - 1).padEnd(cw)).join('').replace(/\s+$/, ''));
      lines.push('', '');
      ctx.out(PS.fmtBlock(lines));
    } });
  cmdlet({ name: 'Out-String', module: UTIL, acceptsInput: true, params: { Stream: { type: 'switch' }, Width: { type: 'int' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); },
    end(ctx, p) { const lines = PS.formatOut(ctx.state.items, p.Width || 120); if (p.Stream) ctx.outMany(lines); else ctx.out(lines.join('\r\n') + '\r\n'); } });
  cmdlet({ name: 'Out-Null', module: CORE, acceptsInput: true, params: { InputObject: { type: 'object', pipe: 'value' } }, process() {} });
  cmdlet({ name: 'Out-Host', module: CORE, acceptsInput: true, params: { Paging: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); },
    end(ctx) { ctx.session.display(ctx.state.items); } });
  cmdlet({ name: 'Out-Default', module: CORE, acceptsInput: true, params: { InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); },
    end(ctx) { ctx.session.display(ctx.state.items); } });
  cmdlet({ name: 'Out-GridView', module: UTIL, acceptsInput: true, params: { Title: {}, PassThru: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    process(ctx) { if (!ctx.state.warned) { ctx.state.warned = true; ctx.error({ message: 'Out-GridView is not available in the lab simulator. Use Format-Table or Out-String instead.', category: 'NotImplemented', exception: 'NotSupportedException', id: 'NotSupported,Microsoft.PowerShell.Commands.OutGridViewCommand' }); } } });

  /* ================================================================ CSV / JSON */
  const csvCell = v => { const s = toStr(v); return '"' + s.replace(/"/g, '""') + '"'; };
  function toCsvLines(items, noType) {
    if (!items.length) return [];
    const first = items[0];
    const props = PS.isObj(first) ? PS.visibleProps(first) : ['Length'];
    const lines = [];
    if (!noType) lines.push('#TYPE ' + PS.typeName(first));
    lines.push(props.map(csvCell).join(','));
    for (const o of items) lines.push(props.map(k => csvCell(PS.isObj(o) ? getProp(o, k) : toStr(o).length)).join(','));
    return lines;
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
      if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c;
    }
    if (cur || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
    const data = rows.filter(r => r.length && !(r.length === 1 && r[0] === '') && !/^#TYPE/.test(r[0]));
    if (!data.length) return [];
    const header = data[0];
    return data.slice(1).map(r => psobj('System.Management.Automation.PSCustomObject', Object.fromEntries(header.map((h, i) => [h, r[i] == null ? null : r[i]]))));
  }
  cmdlet({ name: 'Export-Csv', module: UTIL, shouldProcess: true, acceptsInput: true, params: { Path: { pos: 0, mandatory: true }, NoTypeInformation: { type: 'switch', alias: ['NTI'] }, Append: { type: 'switch' }, Encoding: {}, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; },
    process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); },
    end(ctx, p) { const path = resolve(ctx, p.Path); try { WS.fs.writeFile(path, toCsvLines(ctx.state.items, p.NoTypeInformation || p.Append).join('\r\n') + '\r\n', null, { append: p.Append }); } catch (e) { fsError(ctx, e, path, { terminating: true }); } } });
  cmdlet({ name: 'Import-Csv', module: UTIL, params: { Path: { type: 'string[]', pos: 0, mandatory: true }, Delimiter: { pos: 1 } },
    process(ctx, p) { for (const raw of p.Path) { const path = resolve(ctx, raw); try { ctx.outMany(parseCsv(WS.fs.readFile(path))); } catch (e) { fsError(ctx, e, path); } } } });
  cmdlet({ name: 'ConvertTo-Csv', module: UTIL, acceptsInput: true, params: { NoTypeInformation: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value' } },
    begin(ctx) { ctx.state.items = []; }, process(ctx, p, item) { if (item !== undefined) ctx.state.items.push(item); }, end(ctx, p) { ctx.outMany(toCsvLines(ctx.state.items, p.NoTypeInformation)); } });
  cmdlet({ name: 'ConvertFrom-Csv', module: UTIL, acceptsInput: true, params: { InputObject: { type: 'object', pipe: 'value', pos: 0 } },
    begin(ctx) { ctx.state.lines = []; }, process(ctx, p, item) { ctx.state.lines.push(...toArray(item !== undefined ? item : p.InputObject).map(toStr)); }, end(ctx) { ctx.outMany(parseCsv(ctx.state.lines.join('\n'))); } });
  function toJson(v, depth, ind) {
    const pad = '    '.repeat(ind);
    if (v == null) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof Date) return JSON.stringify(`\\/Date(${v.getTime()})\\/`).replace(/\\\\/g, '\\');
    if (depth < 0) return JSON.stringify(toStr(v));
    if (Array.isArray(v)) return v.length ? '[\r\n' + v.map(x => pad + '    ' + toJson(x, depth - 1, ind + 1)).join(',\r\n') + '\r\n' + pad + ']' : '[\r\n\r\n' + pad + ']';
    const entries = v instanceof PSHashtable ? v.entries() : PS.isObj(v) ? Object.entries(v) : [];
    return '{\r\n' + entries.map(([k, x]) => `${pad}    ${JSON.stringify(String(k))}:  ${toJson(x, depth - 1, ind + 1)}`).join(',\r\n') + '\r\n' + pad + '}';
  }
  cmdlet({ name: 'ConvertTo-Json', module: UTIL, acceptsInput: true, params: { InputObject: { type: 'object', pipe: 'value', pos: 0 }, Depth: { type: 'int' }, Compress: { type: 'switch' } },
    begin(ctx) { ctx.state.items = []; }, process(ctx, p, item) { ctx.state.items.push(item !== undefined ? item : p.InputObject); },
    end(ctx, p) { const v = ctx.state.items.length === 1 ? ctx.state.items[0] : ctx.state.items; let s = toJson(v, p.Depth || 2, 0); if (p.Compress) s = JSON.stringify(JSON.parse(s)); ctx.out(s); } });
  cmdlet({ name: 'ConvertFrom-Json', module: UTIL, acceptsInput: true, params: { InputObject: { pipe: 'value', pos: 0, mandatory: true } },
    process(ctx, p, item) {
      const text = toStr(item !== undefined ? item : p.InputObject);
      let v;
      try { v = JSON.parse(text); } catch (e) { ctx.throw({ message: `Invalid JSON primitive: ${text.slice(0, 20)}.`, category: 'NotSpecified', exception: 'ArgumentException', id: 'System.ArgumentException,Microsoft.PowerShell.Commands.ConvertFromJsonCommand' }); }
      const conv = x => (Array.isArray(x) ? x.map(conv) : x && typeof x === 'object' ? psobj('System.Management.Automation.PSCustomObject', Object.fromEntries(Object.entries(x).map(([k, y]) => [k, conv(y)]))) : x);
      ctx.out(conv(v));
    } });

  /* ================================================================ host I/O and utilities */
  cmdlet({ name: 'Write-Host', module: UTIL, acceptsInput: true, synopsis: 'Writes customized output to a host.',
    params: { Object: { type: 'object[]', pos: 0, pipe: 'value' }, NoNewline: { type: 'switch' }, Separator: { type: 'object' }, ForegroundColor: { type: 'enum', values: Object.keys(WS.term.COLORS), enumType: 'System.ConsoleColor' }, BackgroundColor: { type: 'enum', values: Object.keys(WS.term.COLORS), enumType: 'System.ConsoleColor' } },
    process(ctx, p) {
      const text = (p.Object || []).map(toStr).join(p.Separator == null ? ' ' : toStr(p.Separator));
      ctx.host(text + (p.NoNewline ? '' : '\n'), p.ForegroundColor || p.BackgroundColor ? { fg: p.ForegroundColor, bg: p.BackgroundColor } : null);
    } });
  cmdlet({ name: 'Write-Output', module: UTIL, acceptsInput: true, params: { InputObject: { type: 'object[]', pos: 0, pipe: 'value', mandatory: true }, NoEnumerate: { type: 'switch' } },
    process(ctx, p, item) { if (item !== undefined) ctx.out(item); else ctx.outMany(p.InputObject); } });
  cmdlet({ name: 'Write-Warning', module: UTIL, params: { Message: { pos: 0, mandatory: true, pipe: 'value' } }, process(ctx, p) { ctx.warn(p.Message); } });
  cmdlet({ name: 'Write-Verbose', module: UTIL, params: { Message: { pos: 0, mandatory: true, pipe: 'value' } }, process(ctx, p) { if (toStr(ctx.session.getVar('VerbosePreference')) === 'Continue' || ctx.params.Verbose) ctx.host('VERBOSE: ' + p.Message + '\n', { fg: 'Yellow', bg: 'Black' }); } });
  cmdlet({ name: 'Write-Debug', module: UTIL, params: { Message: { pos: 0, mandatory: true } }, process() {} });
  cmdlet({ name: 'Write-Information', module: UTIL, params: { MessageData: { type: 'object', pos: 0, mandatory: true } }, process(ctx, p) { ctx.host(toStr(p.MessageData) + '\n'); } });
  cmdlet({ name: 'Write-Error', module: UTIL, params: { Message: { pos: 0, mandatory: true, pipe: 'value' }, Category: {}, ErrorId: {}, TargetObject: { type: 'object' } },
    process(ctx, p) { ctx.error({ message: p.Message, category: p.Category || 'NotSpecified', target: p.TargetObject == null ? '' : toStr(p.TargetObject), exception: 'WriteErrorException', id: p.ErrorId || 'Microsoft.PowerShell.Commands.WriteErrorException' }); } });
  cmdlet({ name: 'Read-Host', module: UTIL, params: { Prompt: { type: 'object', pos: 0 }, AsSecureString: { type: 'switch' } },
    async process(ctx, p) { const v = await ctx.prompt(p.Prompt == null ? '' : toStr(p.Prompt) + ': ', { secure: p.AsSecureString }); ctx.out(p.AsSecureString ? new SecureString(v) : v); } });
  cmdlet({ name: 'Clear-Host', module: CORE, process(ctx) { if (ctx.session.console && ctx.session.console.clear) ctx.session.console.clear(); } });
  cmdlet({ name: 'Start-Sleep', module: UTIL, params: { Seconds: { type: 'double', pos: 0, alias: ['s'] }, Milliseconds: { type: 'int', alias: ['ms'] } },
    async process(ctx, p) { await ctx.sleep(Math.min(60000, (p.Seconds || 0) * 1000 + (p.Milliseconds || 0))); } });
  cmdlet({ name: 'Get-Date', module: UTIL, synopsis: 'Gets the current date and time.',
    params: { Date: { type: 'datetime', pos: 0, pipe: 'value' }, Format: {}, UFormat: {}, Year: { type: 'int' }, Month: { type: 'int' }, Day: { type: 'int' } },
    process(ctx, p) {
      const d = p.Date ? new Date(p.Date) : new Date();
      if (p.Year) d.setFullYear(p.Year); if (p.Month) d.setMonth(p.Month - 1); if (p.Day) d.setDate(p.Day);
      if (p.Format) ctx.out(PS.callMethod(d, 'ToString', [p.Format === 'd' ? 'M/d/yyyy' : p.Format === 't' ? 'h:mm tt' : p.Format === 'D' ? 'dddd, MMMM d, yyyy' : p.Format], ctx.session));
      else if (p.UFormat) ctx.out(p.UFormat.replace(/%([a-zA-Z])/g, (m, c) => ({ Y: d.getFullYear(), m: U.pad(d.getMonth() + 1), d: U.pad(d.getDate()), H: U.pad(d.getHours()), M: U.pad(d.getMinutes()), S: U.pad(d.getSeconds()), A: U.DAYS[d.getDay()], B: U.MONTHS[d.getMonth()] }[c] ?? m)));
      else ctx.out(d);
    } });
  const varObj = v => psobj('System.Management.Automation.PSVariable', { Name: v.name, Value: v.value });
  view('System.Management.Automation.PSVariable', { table: { columns: [{ label: 'Name', width: 30, value: 'Name' }, { label: 'Value', value: 'Value' }] } });
  cmdlet({ name: 'Get-Variable', module: UTIL, params: { Name: { type: 'string[]', pos: 0 }, ValueOnly: { type: 'switch' } },
    process(ctx, p) {
      const all = new Map();
      for (let s = ctx.session.scope; s; s = s.parent) for (const [k, v] of s.vars) if (!all.has(k)) all.set(k, v);
      for (const n of p.Name || ['*']) {
        const hits = [...all.values()].filter(v => wild(n, v.name)).sort((a, b) => a.name.localeCompare(b.name));
        if (!hits.length && !hasWild(n)) { const val = ctx.session.getVar(n); if (val != null) hits.push({ name: n, value: val }); else { ctx.error({ message: `Cannot find a variable with the name '${n}'.`, category: 'ObjectNotFound', target: n, exception: 'ItemNotFoundException', id: 'VariableNotFound,Microsoft.PowerShell.Commands.GetVariableCommand' }); continue; } }
        for (const v of hits) ctx.out(p.ValueOnly ? v.value : varObj(v));
      }
    } });
  cmdlet({ name: 'Set-Variable', module: UTIL, params: { Name: { pos: 0, mandatory: true }, Value: { type: 'object', pos: 1, pipe: 'value' }, Scope: {} },
    process(ctx, p) { ctx.session.setVar((p.Scope && /global/i.test(p.Scope) ? 'global:' : '') + p.Name, p.Value, ctx.scope); } });
  cmdlet({ name: 'New-Variable', module: UTIL, params: { Name: { pos: 0, mandatory: true }, Value: { type: 'object', pos: 1 } }, process(ctx, p) { ctx.session.setVar(p.Name, p.Value === undefined ? null : p.Value, ctx.scope); } });
  cmdlet({ name: 'Remove-Variable', module: UTIL, params: { Name: { type: 'string[]', pos: 0, mandatory: true } },
    process(ctx, p) { for (const n of p.Name) { let hit = false; for (let s = ctx.session.scope; s; s = s.parent) if (s.vars.delete(n.toLowerCase())) hit = true; if (!hit) ctx.error({ message: `Cannot find a variable with the name '${n}'.`, category: 'ObjectNotFound', target: n, exception: 'ItemNotFoundException', id: 'VariableNotFound,Microsoft.PowerShell.Commands.RemoveVariableCommand' }); } } });
  cmdlet({ name: 'Clear-Variable', module: UTIL, params: { Name: { type: 'string[]', pos: 0, mandatory: true } }, process(ctx, p) { for (const n of p.Name) ctx.session.setVar(n, null, ctx.scope); } });
  cmdlet({ name: 'Invoke-Expression', module: UTIL, params: { Command: { pos: 0, mandatory: true, pipe: 'value' } },
    async process(ctx, p) {
      let ast;
      try { ast = PS.parse(p.Command); } catch (e) { ctx.throw({ message: e.message, category: 'ParserError', exception: 'ParseException', id: e.id + ',Microsoft.PowerShell.Commands.InvokeExpressionCommand' }); }
      ctx.outMany(await ctx.session.evalStatements(ast.statements, ctx.scope));
    } });
  view('Microsoft.PowerShell.Commands.HistoryInfo', { table: { columns: [{ label: 'Id', width: 4, align: 'right', value: 'Id' }, { label: 'CommandLine', value: 'CommandLine' }] } });
  cmdlet({ name: 'Get-History', module: CORE, params: { Id: { type: 'int[]', pos: 0 }, Count: { type: 'int', pos: 1 } },
    process(ctx, p) {
      let h = ctx.session.history.slice(0, -1);
      if (p.Id) h = h.filter(x => p.Id.includes(x.Id));
      if (p.Count) h = h.slice(-p.Count);
      h.forEach(x => ctx.out(psobj('Microsoft.PowerShell.Commands.HistoryInfo', { Id: x.Id, CommandLine: x.CommandLine, ExecutionStatus: x.ExecutionStatus, StartExecutionTime: x.StartExecutionTime, EndExecutionTime: x.EndExecutionTime }, { str: x.CommandLine })));
    } });
  cmdlet({ name: 'Clear-History', module: CORE, process(ctx) { ctx.session.history.length = 0; } });
  cmdlet({ name: 'Invoke-History', module: CORE, params: { Id: { pos: 0 } },
    async process(ctx, p) {
      const h = ctx.session.history.slice(0, -1);
      const e = p.Id == null ? h[h.length - 1] : h.find(x => String(x.Id) === toStr(p.Id) || x.CommandLine.toLowerCase().startsWith(toStr(p.Id).toLowerCase()));
      if (!e) ctx.throw({ message: `Cannot locate the history for command line ${p.Id}.`, category: 'ObjectNotFound', exception: 'ArgumentException', id: 'InvokeHistoryNoHistoryForCommandline,Microsoft.PowerShell.Commands.InvokeHistoryCommand' });
      ctx.session.writeLine(e.CommandLine);
      const out = [];
      await ctx.session.execute(e.CommandLine, { capture: out, noHistory: true });
      ctx.outMany(out);
    } });

  /* ================================================================ discovery: commands, aliases, help, modules */
  const MODULES = {
    'Microsoft.PowerShell.Management': '3.1.0.0', 'Microsoft.PowerShell.Utility': '3.1.0.0', 'Microsoft.PowerShell.Core': '', 'Microsoft.PowerShell.Security': '3.0.0.0',
    ServerManager: '2.0.0.0', NetTCPIP: '1.0.0.0', NetAdapter: '2.0.0.0', DnsClient: '1.0.0.0', NetSecurity: '2.0.0.0', NetConnection: '1.0.0.0', SmbShare: '2.0.0.0', Storage: '2.0.0.0',
    'Microsoft.PowerShell.LocalAccounts': '1.0.0.0', ActiveDirectory: '1.0.1.0', ADDSDeployment: '1.0.0.0', DnsServer: '2.0.0.0', DhcpServer: '2.0.0.0', CimCmdlets: '1.0.0.0', International: '1.0.0.0',
    PKI: '1.0.0.0', IISAdministration: '1.1.0.0', WebAdministration: '1.0.0.0', 'Hyper-V': '2.0.0.0'
  };
  const MODULE_FEATURE = { ActiveDirectory: 'RSAT-AD-PowerShell', ADDSDeployment: 'AD-Domain-Services', DnsServer: 'RSAT-DNS-Server', DhcpServer: 'RSAT-DHCP', IISAdministration: 'Web-Scripting-Tools', WebAdministration: 'Web-Scripting-Tools', 'Hyper-V': 'Hyper-V-PowerShell' };
  view('System.Management.Automation.CommandInfo', { table: { columns: [{ label: 'CommandType', width: 15, value: 'CommandType' }, { label: 'Name', width: 50, value: o => o.DisplayName || o.Name }, { label: 'Version', width: 10, value: 'Version' }, { label: 'Source', value: 'Source' }] } });
  const cmdInfo = def => psobj('System.Management.Automation.CommandInfo', { CommandType: 'Cmdlet', Name: def.name, Version: def.version || MODULES[def.module] || '', Source: def.module === CORE ? '' : def.module, ModuleName: def.module, Verb: def.verb, Noun: def.noun }, { str: def.name });
  const aliasObj = (a, target) => psobj('System.Management.Automation.CommandInfo', { CommandType: 'Alias', Name: a, DisplayName: `${a} -> ${target}`, Version: '', Source: '', Definition: target, ReferencedCommand: target, ResolvedCommandName: target }, { str: a });
  cmdlet({ name: 'Get-Command', module: CORE, synopsis: 'Gets all commands.',
    params: { Name: { type: 'string[]', pos: 0 }, Module: { type: 'string[]' }, Verb: { type: 'string[]' }, Noun: { type: 'string[]' }, CommandType: {} },
    process(ctx, p) {
      const names = p.Name;
      const out = [];
      const defs = Object.values(PS.cmdlets).filter(PS.available);
      for (const d of defs) {
        if (names && !names.some(n => wild(n, d.name))) continue;
        if (p.Module && !p.Module.some(m => wild(m, d.module))) continue;
        if (p.Verb && !p.Verb.some(v => wild(v, d.verb))) continue;
        if (p.Noun && !p.Noun.some(v => wild(v, d.noun))) continue;
        out.push(cmdInfo(d));
      }
      if (names && !p.Module && !p.Verb && !p.Noun) {
        for (const n of names) {
          for (const [a, t] of Object.entries(PS.aliases)) if (wild(n, a) && (hasWild(n) || a.toLowerCase() === n.toLowerCase())) out.push(aliasObj(a, t));
          for (const nat of WS.term.nativeNames()) if (wild(n, nat) || wild(n, nat + '.exe')) out.push(psobj('System.Management.Automation.CommandInfo', { CommandType: 'Application', Name: nat + '.exe', Version: '10.0.26100.1', Source: `C:\\Windows\\system32\\${nat}.exe` }, { str: nat + '.exe' }));
          for (const fn of ctx.session.functions.values()) if (wild(n, fn.name)) out.push(psobj('System.Management.Automation.CommandInfo', { CommandType: 'Function', Name: fn.name, Version: '', Source: '' }, { str: fn.name }));
        }
      }
      if (!out.length && names) {
        for (const n of names.filter(x => !hasWild(x))) {
          ctx.error({ message: `The term '${n}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`, category: 'ObjectNotFound', target: n, exception: 'CommandNotFoundException', id: 'CommandNotFoundException,Microsoft.PowerShell.Commands.GetCommandCommand' });
        }
      }
      out.sort((a, b) => (a.CommandType === b.CommandType ? 0 : a.CommandType === 'Alias' ? -1 : b.CommandType === 'Alias' ? 1 : 0) || a.Name.localeCompare(b.Name));
      ctx.outMany(out);
    } });
  cmdlet({ name: 'Get-Alias', module: UTIL, params: { Name: { type: 'string[]', pos: 0 }, Definition: { type: 'string[]' } },
    process(ctx, p) {
      const all = Object.entries(PS.aliases).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [a, t] of all) {
        if (p.Name && !p.Name.some(n => wild(n, a))) continue;
        if (p.Definition && !p.Definition.some(n => wild(n, t))) continue;
        ctx.out(aliasObj(a, t));
      }
      if (p.Name) for (const n of p.Name) if (!hasWild(n) && !all.some(([a]) => a.toLowerCase() === n.toLowerCase())) ctx.error({ message: `This command cannot find a matching alias because an alias with the name '${n}' does not exist.`, category: 'ObjectNotFound', target: n, exception: 'ItemNotFoundException', id: 'ItemNotFoundException,Microsoft.PowerShell.Commands.GetAliasCommand' });
    } });
  function syntaxOf(def) {
    const parts = [def.name];
    const pos = def.specs.filter(s => s.pos != null).sort((a, b) => a.pos - b.pos);
    const named = def.specs.filter(s => s.pos == null);
    const tn = s => s.type === 'switch' ? '' : ` <${PS.specTypeName(s).replace(/^System\.(Management\.Automation\.)?/, '').replace(/^Security\./, '')}>`;
    for (const s of pos) parts.push(s.mandatory ? `[-${s.name}]${tn(s)}` : `[[-${s.name}]${tn(s)}]`);
    for (const s of named) parts.push(s.mandatory ? `-${s.name}${tn(s)}` : `[-${s.name}${tn(s)}]`);
    if (def.shouldProcess) parts.push('[-WhatIf]', '[-Confirm]');
    parts.push('[<CommonParameters>]');
    return parts.join(' ');
  }
  cmdlet({ name: 'Get-Help', module: CORE, synopsis: 'Displays information about PowerShell commands and concepts.',
    params: { Name: { pos: 0 }, Examples: { type: 'switch' }, Detailed: { type: 'switch' }, Full: { type: 'switch' }, Online: { type: 'switch' }, Parameter: {} },
    process(ctx, p) {
      if (!p.Name) {
        ctx.out(['', 'TOPIC', '    Windows PowerShell Help System', '', 'SHORT DESCRIPTION', '    Displays help about Windows PowerShell cmdlets and concepts.', '', 'LONG DESCRIPTION', '    Windows PowerShell Help describes Windows PowerShell cmdlets,', '    functions, scripts, and modules, and explains concepts, including', '    the elements of the Windows PowerShell language.', '', '  EXAMPLES:', '      Get-Help Get-Process     : Displays help about the Get-Process cmdlet.', '      Get-Help Get-*           : Displays a list of commands that begin with "Get-".', '      Get-Command              : Displays all commands available in this session.', ''].join('\n'));
        return;
      }
      let name = p.Name;
      if (PS.aliases[name.toLowerCase()]) name = PS.aliases[name.toLowerCase()];
      if (hasWild(name)) {
        const hits = Object.values(PS.cmdlets).filter(PS.available).filter(d => wild(name, d.name)).sort((a, b) => a.name.localeCompare(b.name));
        ctx.outMany(hits.map(d => psobj('HelpInfoShort', { Name: d.name, Category: 'Cmdlet', Module: d.module, Synopsis: d.synopsis || d.name })));
        return;
      }
      const def = PS.findCmdlet(name);
      if (!def) ctx.throw({ message: `Get-Help could not find ${p.Name} in a help file in this session. To download updated help topics type: "Update-Help". To get help online, search for the help topic in the TechNet library at https:/go.microsoft.com/fwlink/?LinkID=107116.`, category: 'ResourceUnavailable', target: '', exception: 'HelpNotFoundException', id: 'HelpNotFound,Microsoft.PowerShell.Commands.GetHelpCommand' });
      if (p.Online) { WS.ui.msgbox({ title: 'Get-Help', message: 'Online help is not available in the lab simulator.' }); return; }
      const aliases = Object.entries(PS.aliases).filter(([, t]) => t.toLowerCase() === def.name.toLowerCase()).map(([a]) => a);
      const lines = ['', 'NAME', '    ' + def.name, ''];
      if (def.synopsis) lines.push('SYNOPSIS', '    ' + def.synopsis, '');
      lines.push('', 'SYNTAX', '    ' + syntaxOf(def), '', '');
      if (p.Full || p.Detailed || p.Parameter) {
        lines.push('PARAMETERS');
        for (const s of def.specs.filter(x => !p.Parameter || wild(p.Parameter, x.name))) {
          lines.push(`    -${s.name}${s.type === 'switch' ? '' : ' <' + PS.specTypeName(s).replace(/^System\./, '') + '>'}`, '');
          if (p.Full || p.Parameter) lines.push(`        Required?                    ${s.mandatory ? 'true' : 'false'}`, `        Position?                    ${s.pos != null ? s.pos : 'named'}`, `        Accept pipeline input?       ${s.pipe ? 'true (' + (s.pipe === 'value' ? 'ByValue' : s.pipe === 'name' ? 'ByPropertyName' : 'ByValue, ByPropertyName') + ')' : 'false'}`, `        Accept wildcard characters?  false`, '');
        }
        lines.push('    <CommonParameters>', '        This cmdlet supports the common parameters: Verbose, Debug,', '        ErrorAction, ErrorVariable, WarningAction, WarningVariable,', '        OutBuffer, PipelineVariable, and OutVariable. For more information, see', '        about_CommonParameters (https:/go.microsoft.com/fwlink/?LinkID=113216).', '');
      }
      if (aliases.length) lines.push('ALIASES', ...aliases.map(a => '    ' + a), '', '');
      lines.push('REMARKS', '    Get-Help cannot find the Help files for this cmdlet on this computer. It is displaying only partial help.', '        -- To download and install Help files for the module that includes this cmdlet, use Update-Help.', `        -- To view the Help topic for this cmdlet online, type: "Get-Help ${def.name} -Online" or`, '           go to https://go.microsoft.com/fwlink/?LinkID=113332.', '', '');
      ctx.out(lines.join('\n'));
    } });
  view('HelpInfoShort', { table: { columns: [{ label: 'Name', width: 33, value: 'Name' }, { label: 'Category', width: 9, value: 'Category' }, { label: 'Module', width: 33, value: 'Module' }, { label: 'Synopsis', value: 'Synopsis' }] } });
  cmdlet({ name: 'Update-Help', module: CORE, params: { Module: { type: 'string[]', pos: 0 }, Force: { type: 'switch' } },
    async process(ctx) { for (let i = 0; i <= 100; i += 20) { ctx.progress({ activity: 'Updating Help for module Microsoft.PowerShell.Management', status: 'Locating Help Content...', percent: i }); await ctx.sleep(150); } } });
  view('System.Management.Automation.PSModuleInfo', { table: { columns: [{ label: 'ModuleType', width: 10, value: 'ModuleType' }, { label: 'Version', width: 10, value: 'Version' }, { label: 'Name', width: 35, value: 'Name' }, { label: 'ExportedCommands', value: 'ExportedCommands' }] } });
  const moduleAvailable = m => !MODULE_FEATURE[m] || WS.features.isInstalled(MODULE_FEATURE[m]);
  const modObj = m => psobj('System.Management.Automation.PSModuleInfo', { ModuleType: /^Microsoft\.PowerShell\./.test(m) ? 'Manifest' : 'Script', Version: MODULES[m], Name: m, ExportedCommands: Object.values(PS.cmdlets).filter(d => d.module === m).map(d => d.name).sort().slice(0, 6) }, { str: m });
  cmdlet({ name: 'Get-Module', module: CORE, params: { Name: { type: 'string[]', pos: 0 }, ListAvailable: { type: 'switch' } },
    process(ctx, p) {
      const loaded = ctx.session.loadedModules || (ctx.session.loadedModules = new Set(['Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Utility', 'PSReadline']));
      const names = Object.keys(MODULES).filter(m => m !== CORE && moduleAvailable(m) && (p.ListAvailable || loaded.has(m)));
      for (const m of names.sort()) if (!p.Name || p.Name.some(n => wild(n, m))) ctx.out(modObj(m));
    } });
  cmdlet({ name: 'Import-Module', module: CORE, params: { Name: { type: 'string[]', pos: 0, mandatory: true }, Force: { type: 'switch' }, PassThru: { type: 'switch' } },
    process(ctx, p) {
      for (const n of p.Name) {
        const m = Object.keys(MODULES).find(x => x.toLowerCase() === n.toLowerCase());
        if (!m || !moduleAvailable(m)) { ctx.error({ message: `The specified module '${n}' was not loaded because no valid module file was found in any module directory.`, category: 'ResourceUnavailable', target: n, exception: 'FileNotFoundException', id: 'Modules_ModuleNotFound,Microsoft.PowerShell.Commands.ImportModuleCommand' }); continue; }
        (ctx.session.loadedModules || (ctx.session.loadedModules = new Set())).add(m);
        if (p.PassThru) ctx.out(modObj(m));
      }
    } });
  cmdlet({ name: 'Remove-Module', module: CORE, params: { Name: { type: 'string[]', pos: 0, mandatory: true } }, process(ctx, p) { for (const n of p.Name) if (ctx.session.loadedModules) ctx.session.loadedModules.delete(n); } });
  cmdlet({ name: 'Get-ExecutionPolicy', module: SEC, params: { List: { type: 'switch' }, Scope: {} },
    process(ctx, p) {
      const pol = WS.state.system.executionPolicy || 'RemoteSigned';
      const mp = gpExecPolicy('computer'), up = gpExecPolicy('user');
      if (!p.List) { ctx.out(p.Scope ? { machinepolicy: mp, userpolicy: up, localmachine: pol }[String(p.Scope).toLowerCase()] || 'Undefined' : mp !== 'Undefined' ? mp : up !== 'Undefined' ? up : pol); return; }
      for (const [s, v] of [['MachinePolicy', mp], ['UserPolicy', up], ['Process', 'Undefined'], ['CurrentUser', 'Undefined'], ['LocalMachine', pol]]) ctx.out(psobj('System.Management.Automation.PSCustomObject', { Scope: s, ExecutionPolicy: v }));
    } });
  /** "Turn on Script Execution" (Group Policy) gives the MachinePolicy / UserPolicy scopes. */
  function gpExecPolicy(side) { const v = WS.gpo && WS.gpo.effective(side, 'EnableScripts'); return !v ? 'Undefined' : v.state === 'Enabled' ? v.options.ExecutionPolicy : 'Restricted'; }
  cmdlet({ name: 'Set-ExecutionPolicy', module: SEC, shouldProcess: true, params: { ExecutionPolicy: { type: 'enum', pos: 0, mandatory: true, values: ['Unrestricted', 'RemoteSigned', 'AllSigned', 'Restricted', 'Default', 'Bypass', 'Undefined'], enumType: 'Microsoft.PowerShell.ExecutionPolicy' }, Scope: {}, Force: { type: 'switch' } },
    async process(ctx, p) {
      if (!p.Force) {
        const a = await ctx.ask('\nExecution Policy Change', 'The execution policy helps protect you from scripts that you do not trust. Changing the execution policy might expose\nyou to the security risks described in the about_Execution_Policies help topic at\nhttps:/go.microsoft.com/fwlink/?LinkID=135170. Do you want to change the execution policy?', [['Y', 'Yes'], ['A', 'Yes to All'], ['N', 'No'], ['L', 'No to All'], ['S', 'Suspend']], 'N');
        if (!['Y', 'A'].includes(a)) return;
      }
      WS.state.system.executionPolicy = p.ExecutionPolicy === 'Default' ? 'RemoteSigned' : p.ExecutionPolicy;
      WS.store.changed('system');
      const mp = gpExecPolicy('computer'), up = gpExecPolicy('user');
      const eff = mp !== 'Undefined' ? mp : up;
      if (eff !== 'Undefined' && eff !== WS.state.system.executionPolicy) ctx.error({ message: `Windows PowerShell updated your execution policy successfully, but the setting is overridden by a policy defined at a more specific scope.  Due to the override, your shell will retain its current effective execution policy of ${eff}. Type "Get-ExecutionPolicy -List" to view your execution policy settings. For more information please see "Get-Help Set-ExecutionPolicy".`, category: 'PermissionDenied', target: '', exception: 'SecurityException', id: 'ExecutionPolicyOverride,Microsoft.PowerShell.Commands.SetExecutionPolicyCommand' });
    } });
  cmdlet({ name: 'ConvertTo-SecureString', module: SEC, synopsis: 'Converts plain text or encrypted strings to secure strings.',
    params: { String: { pos: 0, mandatory: true, pipe: 'value' }, AsPlainText: { type: 'switch' }, Force: { type: 'switch' }, Key: { type: 'object' } },
    process(ctx, p) {
      if (p.AsPlainText && !p.Force) ctx.throw({ message: 'The system cannot protect plain text input. To suppress this warning and convert the plain text to a SecureString, reissue the command specifying the Force parameter. For more information ,type: get-help ConvertTo-SecureString.', category: 'InvalidArgument', exception: 'ArgumentException', id: 'ImportSecureString_InvalidArgument,Microsoft.PowerShell.Commands.ConvertToSecureStringCommand' });
      if (!p.AsPlainText) {
        const m = /^01000000d08c9ddf(.*)$/i.exec(p.String);
        if (!m) ctx.throw({ message: 'Input string was not in a correct format.', category: 'InvalidArgument', exception: 'FormatException', id: 'ImportSecureString_InvalidArgument,Microsoft.PowerShell.Commands.ConvertToSecureStringCommand' });
        ctx.out(new SecureString(decodeURIComponent(m[1].replace(/(..)/g, '%$1'))));
        return;
      }
      ctx.out(new SecureString(p.String));
    } });
  cmdlet({ name: 'ConvertFrom-SecureString', module: SEC, params: { SecureString: { type: 'securestring', pos: 0, mandatory: true, pipe: 'value' } },
    process(ctx, p) { ctx.out('01000000d08c9ddf' + [...unescape(encodeURIComponent(p.SecureString.value))].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')); } });
  view('System.Management.Automation.PSCredential', { table: { columns: [{ label: 'UserName', width: 30, value: 'UserName' }, { label: 'Password', value: () => 'System.Security.SecureString' }] } });
  cmdlet({ name: 'Get-Credential', module: SEC, params: { UserName: { pos: 0, alias: ['Credential'] }, Message: {} },
    async process(ctx, p) {
      const user = WS.ui.f.text({ value: p.UserName || '' });
      const pw = WS.ui.f.text({ password: true });
      const r = await WS.ui.dialog({ title: 'Windows PowerShell credential request.', width: 380, className: 'w32-dlg',
        content: WS.h('div.w32', WS.h('div', { style: 'margin-bottom:8px' }, p.Message || 'Enter your credentials.'), WS.ui.f.row('User name:', user, { labelWidth: 80 }), WS.ui.f.row('Password:', pw, { labelWidth: 80 })),
        buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', cancel: true, value: null }] });
      if (r !== 'ok') ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: Credential.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'CouldNotAutoImportMissingMandatoryParameter,Microsoft.PowerShell.Commands.GetCredentialCommand' });
      ctx.out(psobj('System.Management.Automation.PSCredential', { UserName: user.value, Password: new SecureString(pw.value) }, { methods: { GetNetworkCredential() { return psobj('System.Net.NetworkCredential', { UserName: user.value, Password: pw.value, Domain: '' }); } } }));
    } });

  /* ================================================================ services */
  const startTypeOf = s => (s.startType === 'AutomaticDelayedStart' ? 'Automatic' : s.startType);
  function svcObj(s) {
    return psobj('System.ServiceProcess.ServiceController', {
      Name: s.name, RequiredServices: s.dependsOn, CanPauseAndContinue: false, CanShutdown: s.status === 'Running' && s.canStop, CanStop: s.canStop, DisplayName: s.display,
      DependentServices: s.dependents, MachineName: '.', ServiceName: s.name, ServicesDependedOn: s.dependsOn, ServiceHandle: null, Status: s.status,
      ServiceType: WS.services && /svchost/i.test(WS.services.pathOf(s.name)) ? 'Win32ShareProcess' : 'Win32OwnProcess', StartType: startTypeOf(s), Site: null, Container: null
    }, { str: 'System.ServiceProcess.ServiceController', methods: {
      Start() { const r = WS.svc.start(s.name); if (!r.ok) throw PS.rtError(`Exception calling "Start" with "0" argument(s): "Cannot start service ${s.name} on computer '.'."`, { category: 'NotSpecified', exception: 'MethodInvocationException', id: 'InvalidOperationException' }); },
      Stop() { const r = WS.svc.stop(s.name); if (!r.ok) throw PS.rtError(`Exception calling "Stop" with "0" argument(s): "Cannot stop ${s.name} service on computer '.'."`, { category: 'NotSpecified', exception: 'MethodInvocationException', id: 'InvalidOperationException' }); },
      Refresh() {}, WaitForStatus() {}
    } });
  }
  view('System.ServiceProcess.ServiceController', {
    table: { columns: [{ label: 'Status', width: 8, value: 'Status' }, { label: 'Name', width: 18, value: 'Name' }, { label: 'DisplayName', value: 'DisplayName' }] },
    listProps: ['Name', 'DisplayName', 'Status', 'DependentServices', 'ServicesDependedOn', 'CanPauseAndContinue', 'CanShutdown', 'CanStop', 'ServiceType']
  });
  function findServices(ctx, p, verbCls) {
    const out = [];
    if (p.InputObject) return toArray(p.InputObject).map(o => WS.svc.get(getProp(o, 'Name') || toStr(o))).filter(Boolean);
    const list = WS.svc.list();
    for (const n of p.Name || (p.DisplayName ? [] : ['*'])) {
      const hits = list.filter(s => wild(n, s.name) || (!hasWild(n) && s.display.toLowerCase() === n.toLowerCase()));
      if (!hits.length && !hasWild(n)) ctx.error({ message: `Cannot find any service with service name '${n}'.`, category: 'ObjectNotFound', target: n, targetType: 'String', exception: 'ServiceCommandException', id: `NoServiceFoundForGivenName,Microsoft.PowerShell.Commands.${verbCls}Command` });
      out.push(...hits);
    }
    for (const n of p.DisplayName || []) {
      const hits = list.filter(s => wild(n, s.display));
      if (!hits.length && !hasWild(n)) ctx.error({ message: `Cannot find any service with display name '${n}'.`, category: 'ObjectNotFound', target: n, targetType: 'String', exception: 'ServiceCommandException', id: `NoServiceFoundForGivenDisplayName,Microsoft.PowerShell.Commands.${verbCls}Command` });
      out.push(...hits);
    }
    const seen = new Set();
    return out.filter(s => !seen.has(s.name) && seen.add(s.name));
  }
  const svcParams = { Name: { type: 'string[]', pos: 0, pipe: 'both', alias: ['ServiceName'] }, DisplayName: { type: 'string[]' }, InputObject: { type: 'object[]', pipe: 'value', accepts: v => PS.typeName(v) === 'System.ServiceProcess.ServiceController' }, Include: { type: 'string[]' }, Exclude: { type: 'string[]' }, PassThru: { type: 'switch' }, Force: { type: 'switch' } };
  cmdlet({ name: 'Get-Service', module: MGMT, synopsis: 'Gets the services on a local or remote computer.',
    params: { Name: svcParams.Name, DisplayName: svcParams.DisplayName, InputObject: svcParams.InputObject, ComputerName: { type: 'string[]', alias: ['Cn'] }, DependentServices: { type: 'switch', alias: ['DS'] }, RequiredServices: { type: 'switch', alias: ['SDO', 'ServicesDependedOn'] }, Include: svcParams.Include, Exclude: svcParams.Exclude },
    process(ctx, p) {
      for (const s of findServices(ctx, p, 'GetService')) {
        if (p.Exclude && p.Exclude.some(x => wild(x, s.name))) continue;
        if (p.DependentServices) { WS.svc.dependents(s.name).forEach(d => ctx.out(svcObj(d))); continue; }
        if (p.RequiredServices) { s.dependsOn.map(n => WS.svc.get(n)).filter(Boolean).forEach(d => ctx.out(svcObj(d))); continue; }
        ctx.out(svcObj(s));
      }
    } });
  const svcFail = (ctx, s, r, verb, cls) => ctx.error({
    message: r.code === 'ServiceHasDependentServices' ? r.error : `Service '${s.display} (${s.name})' cannot be ${verb === 'start' ? 'started' : 'stopped'} due to the following error: ${verb === 'start' ? `Cannot start service ${s.name}` : `Cannot stop ${s.name} service`} on computer '.'.`,
    category: r.code === 'ServiceHasDependentServices' ? 'InvalidOperation' : verb === 'start' ? 'OpenError' : 'CloseError', target: 'System.ServiceProcess.ServiceController', targetType: 'ServiceController', exception: 'ServiceCommandException',
    id: `${r.code === 'ServiceHasDependentServices' ? 'ServiceHasDependentServices' : verb === 'start' ? 'CouldNotStartService' : 'CouldNotStopService'},Microsoft.PowerShell.Commands.${cls}Command` });
  cmdlet({ name: 'Start-Service', module: MGMT, shouldProcess: true, synopsis: 'Starts one or more stopped services.', params: svcParams,
    async process(ctx, p) {
      for (const s of findServices(ctx, p, 'StartService')) {
        if (!(await ctx.confirm('Start-Service', `${s.display} (${s.name})`))) continue;
        const r = WS.svc.start(s.name);
        if (!r.ok) { svcFail(ctx, s, r, 'start', 'StartService'); continue; }
        if (p.PassThru) ctx.out(svcObj(WS.svc.get(s.name)));
      }
    } });
  cmdlet({ name: 'Stop-Service', module: MGMT, shouldProcess: true, synopsis: 'Stops one or more running services.', params: { ...svcParams, NoWait: { type: 'switch' } },
    async process(ctx, p) {
      for (const s of findServices(ctx, p, 'StopService')) {
        if (!(await ctx.confirm('Stop-Service', `${s.display} (${s.name})`))) continue;
        const r = WS.svc.stop(s.name, { force: p.Force });
        if (!r.ok) { svcFail(ctx, s, r, 'stop', 'StopService'); continue; }
        if (p.PassThru) ctx.out(svcObj(WS.svc.get(s.name)));
      }
    } });
  cmdlet({ name: 'Restart-Service', module: MGMT, shouldProcess: true, synopsis: 'Stops and then starts one or more services.', params: svcParams,
    async process(ctx, p) {
      for (const s of findServices(ctx, p, 'RestartService')) {
        if (!(await ctx.confirm('Restart-Service', `${s.display} (${s.name})`))) continue;
        if (s.status === 'Running') { const r = WS.svc.stop(s.name, { force: p.Force }); if (!r.ok) { svcFail(ctx, s, r, 'stop', 'RestartService'); continue; } }
        ctx.warn(`Waiting for service '${s.display} (${s.name})' to start...`);
        const r = WS.svc.start(s.name);
        if (!r.ok) { svcFail(ctx, s, r, 'start', 'RestartService'); continue; }
        if (p.PassThru) ctx.out(svcObj(WS.svc.get(s.name)));
      }
    } });
  cmdlet({ name: 'Set-Service', module: MGMT, shouldProcess: true, synopsis: 'Starts, stops, and suspends a service, and changes its properties.',
    params: { Name: { pos: 0, pipe: 'both', alias: ['ServiceName', 'SN'] }, InputObject: svcParams.InputObject, DisplayName: {}, Description: {}, StartupType: { type: 'enum', values: ['Automatic', 'Manual', 'Disabled', 'Boot', 'System'], enumType: 'System.ServiceProcess.ServiceStartMode', alias: ['StartMode', 'SM', 'ST'] },
      Status: { type: 'enum', values: ['Running', 'Stopped', 'Paused'], enumType: 'System.String' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      const name = p.InputObject ? getProp(toArray(p.InputObject)[0], 'Name') : p.Name;
      const s = WS.svc.get(name || '');
      if (!s) { ctx.error({ message: `Service ${name} was not found on computer '.'.`, category: 'ObjectNotFound', target: '.', exception: 'InvalidOperationException', id: 'InvalidOperationException,Microsoft.PowerShell.Commands.SetServiceCommand' }); return; }
      if (!(await ctx.confirm('Set-Service', `${s.display} (${s.name})`))) return;
      if (p.StartupType) { if (['Boot', 'System'].includes(p.StartupType)) ctx.throw({ message: 'The parameter is incorrect.', category: 'InvalidArgument', exception: 'Win32Exception', id: 'CouldNotSetService,Microsoft.PowerShell.Commands.SetServiceCommand' }); WS.svc.setStartup(s.name, p.StartupType); }
      if (p.Status === 'Running') { const r = WS.svc.start(s.name); if (!r.ok) svcFail(ctx, s, r, 'start', 'SetService'); }
      if (p.Status === 'Stopped') { const r = WS.svc.stop(s.name); if (!r.ok) ctx.error({ message: `Service '${s.display} (${s.name})' cannot be configured due to the following error: ${r.code === 'ServiceHasDependentServices' ? 'it has dependent services' : 'Access is denied'}`, category: 'PermissionDenied', target: 'System.ServiceProcess.ServiceController', targetType: 'ServiceController', exception: 'ServiceCommandException', id: 'CouldNotStopService,Microsoft.PowerShell.Commands.SetServiceCommand' }); }
      if (p.PassThru) ctx.out(svcObj(WS.svc.get(s.name)));
    } });
  cmdlet({ name: 'New-Service', module: MGMT, params: { Name: { pos: 0, mandatory: true }, BinaryPathName: { pos: 1, mandatory: true } },
    process(ctx) { ctx.error({ message: 'Creating new services is not available in the lab simulator.', category: 'NotImplemented', exception: 'NotSupportedException', id: 'NotSupported,Microsoft.PowerShell.Commands.NewServiceCommand' }); } });

  /* ================================================================ roles and features */
  const FEAT_TYPE = n => n.type;
  function featObj(n) {
    const depth = n.depth + 1;
    const path = []; for (let x = n; x; x = x.parent && WS.catalog.features.get(x.parent)) path.unshift(x.name);
    return psobj('Microsoft.Windows.ServerManager.Commands.Feature', {
      DisplayName: n.name, Name: n.id, Installed: WS.features.isInstalled(n.id), InstallState: WS.features.installState(n.id), FeatureType: FEAT_TYPE(n), Path: path.join('\\'), Depth: depth,
      DependsOn: [], Parent: n.parent, ServerComponentDescriptor: 'ServerComponent_' + n.id.replace(/-/g, '_'), SubFeatures: n.children.map(c => c.id), SystemService: n.services, Notification: [],
      BestPracticesModelId: null, EventQuery: null, PostConfigurationNeeded: !!n.postConfig, AdditionalInfo: { MajorVersion: 10, MinorVersion: 0, NumericId: U.hashStr(n.id) % 1000, InstallName: n.id }, Description: n.desc
    }, { str: n.id });
  }
  view('Microsoft.Windows.ServerManager.Commands.Feature', {
    custom: items => {
      const lines = ['', 'Display Name'.padEnd(55) + ' ' + 'Name'.padEnd(26) + ' ' + 'Install State'.padStart(13), '------------'.padEnd(55) + ' ' + '----'.padEnd(26) + ' ' + '-------------'.padStart(13)];
      for (const f of items) {
        const mark = f.InstallState === 'Installed' ? '[X]' : f.InstallState === 'InstallPending' ? '[X]' : '[ ]';
        const left = ('    '.repeat(f.Depth - 1) + mark + ' ' + f.DisplayName);
        lines.push(`${(left.length > 55 ? left.slice(0, 52) + '...' : left).padEnd(55)} ${f.Name.padEnd(26)} ${f.InstallState.padStart(13)}`.replace(/\s+$/, ''));
      }
      return [...lines, '', ''];
    },
    listProps: ['Name', 'DisplayName', 'Description', 'Installed', 'InstallState', 'FeatureType', 'Path', 'Depth', 'DependsOn', 'Parent', 'ServerComponentDescriptor', 'SubFeatures', 'SystemService', 'Notification', 'BestPracticesModelId', 'EventQuery', 'PostConfigurationNeeded', 'AdditionalInfo']
  });
  view('Microsoft.Windows.ServerManager.Commands.FeatureOperationResult', { table: { columns: [{ label: 'Success', width: 7, value: 'Success' }, { label: 'Restart Needed', width: 14, value: 'RestartNeeded' }, { label: 'Exit Code', width: 14, value: 'ExitCode' }, { label: 'Feature Result', value: o => o.FeatureResult } ] } });
  cmdlet({ name: 'Get-WindowsFeature', module: 'ServerManager', version: '2.0.0.0', cls: 'Microsoft.Windows.ServerManager.Commands.GetWindowsFeatureCommand', synopsis: 'Gets information about Windows Server roles, role services, and features that are available for installation and installed on a specified server.',
    params: { Name: { type: 'string[]', pos: 0, pipe: 'both' }, ComputerName: { alias: ['Cn'] }, Vhd: {}, LogPath: {} },
    process(ctx, p) {
      const all = WS.catalog.features.all();
      const names = p.Name || ['*'];
      for (const n of all) if (names.some(x => wild(x, n.id) || (!hasWild(x) && n.name.toLowerCase() === x.toLowerCase()))) ctx.out(featObj(n));
    } });
  const featResult = n => psobj('Microsoft.Windows.ServerManager.Commands.FeatureResult', { DisplayName: n.name, Name: n.id, Id: U.hashStr(n.id) % 1000, Message: '', RestartNeeded: n.reboot, SkipReason: 'NotSkipped', Success: true }, { str: n.name });
  async function featureOp(ctx, p, install, item) {
    const names = item !== undefined ? [getProp(item, 'Name') || toStr(item)] : p.Name;
    const r0 = install ? WS.features.plan(names, { includeManagementTools: p.IncludeManagementTools, includeAllSubFeature: p.IncludeAllSubFeature }) : null;
    if (r0 && r0.missing.length) ctx.throw({ message: `ArgumentNotValid: The role, role service, or feature name is not valid: '${r0.missing.join("', '")}'. The name was not found.`, category: 'InvalidArgument', target: r0.missing[0], targetType: 'String', exception: 'Exception', id: `NameDoesNotExist,Microsoft.Windows.ServerManager.Commands.${install ? 'Add' : 'Remove'}WindowsFeatureCommand` });
    if (!(await ctx.confirm(install ? 'Install' : 'Uninstall', names.join(', ')))) return;
    const steps = [0, 12, 27, 44, 61, 78, 93];
    for (const pct of steps) { ctx.progress({ activity: install ? 'Start Installation...' : 'Start Removal...', status: `${pct}%`, percent: pct }); await ctx.sleep(220); }
    const r = install ? WS.features.install(names, { includeManagementTools: p.IncludeManagementTools, includeAllSubFeature: p.IncludeAllSubFeature, restart: p.Restart }) : WS.features.uninstall(names, { includeManagementTools: p.IncludeManagementTools, restart: p.Restart });
    if (!r.ok) ctx.throw({ message: r.error, category: 'InvalidOperation', target: '', exception: 'Exception', id: `RemoveWindowsFeature,Microsoft.Windows.ServerManager.Commands.${install ? 'Add' : 'Remove'}WindowsFeatureCommand` });
    if (r.restartNeeded === 'Yes') ctx.warn(`You must restart this server to finish the ${install ? 'installation' : 'removal'} process.`);
    ctx.out(psobj('Microsoft.Windows.ServerManager.Commands.FeatureOperationResult', { Success: r.success, RestartNeeded: r.restartNeeded, FeatureResult: (r.featureResult || []).map(featResult), ExitCode: r.exitCode }));
  }
  const featOpParams = { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, InputObject: { type: 'object', pipe: 'value', accepts: v => PS.typeName(v) === 'Microsoft.Windows.ServerManager.Commands.Feature' }, IncludeManagementTools: { type: 'switch' }, Restart: { type: 'switch' }, ComputerName: { alias: ['Cn'] }, LogPath: {}, Source: { type: 'string[]' }, Vhd: {}, Credential: { type: 'object' }, ConfigurationFilePath: {} };
  cmdlet({ name: 'Install-WindowsFeature', module: 'ServerManager', version: '2.0.0.0', cls: 'Microsoft.Windows.ServerManager.Commands.AddWindowsFeatureCommand', shouldProcess: true, synopsis: 'Installs one or more roles, role services, or features on either the local or a specified remote server that is running Windows Server.',
    params: { ...featOpParams, IncludeAllSubFeature: { type: 'switch' } },
    async process(ctx, p, item) { await featureOp(ctx, p, true, item && PS.typeName(item) === 'Microsoft.Windows.ServerManager.Commands.Feature' ? item : undefined); } });
  cmdlet({ name: 'Uninstall-WindowsFeature', module: 'ServerManager', version: '2.0.0.0', cls: 'Microsoft.Windows.ServerManager.Commands.RemoveWindowsFeatureCommand', shouldProcess: true, synopsis: 'Uninstalls specified Windows Server roles, role services, and features from a computer that is running Windows Server.',
    params: { ...featOpParams, Remove: { type: 'switch' } },
    async process(ctx, p, item) { await featureOp(ctx, p, false, item && PS.typeName(item) === 'Microsoft.Windows.ServerManager.Commands.Feature' ? item : undefined); } });

  /* ================================================================ event logs */
  const LOGNAME = l => WS.evt.logNames().find(x => x.toLowerCase() === String(l).toLowerCase());
  function eventObj(e, log) {
    return psobj('System.Diagnostics.EventLogEntry', { Index: e.record, Time: new Date(e.time), TimeGenerated: new Date(e.time), TimeWritten: new Date(e.time), EntryType: e.level === 'Audit Success' ? 'SuccessAudit' : e.level === 'Audit Failure' ? 'FailureAudit' : e.level, Source: e.source, InstanceID: e.id, EventID: e.id, Message: e.message, Category: e.task, MachineName: e.computer, UserName: e.user === 'N/A' ? null : e.user, Log: log }, { str: 'System.Diagnostics.EventLogEntry' });
  }
  view('System.Diagnostics.EventLogEntry', { table: { columns: [
    { label: 'Index', width: 8, align: 'right', value: 'Index' },
    { label: 'Time', width: 12, value: o => `${U.MONTHS[o.Time.getMonth()].slice(0, 3)} ${U.pad(o.Time.getDate())} ${U.pad(o.Time.getHours())}:${U.pad(o.Time.getMinutes())}` },
    { label: 'EntryType', width: 11, value: 'EntryType' }, { label: 'Source', width: 20, value: 'Source' }, { label: 'InstanceID', width: 12, align: 'right', value: 'InstanceID' },
    { label: 'Message', value: o => String(o.Message).split('\n')[0] }
  ] }, listProps: ['Index', 'EntryType', 'InstanceID', 'Message', 'Category', 'CategoryNumber', 'ReplacementStrings', 'Source', 'TimeGenerated', 'TimeWritten', 'UserName'] });
  view('System.Diagnostics.EventLog', { table: { columns: [{ label: '  Max(K)', width: 8, align: 'right', value: o => o.MaximumKilobytes.toLocaleString('en-US') }, { label: 'Retain', width: 6, align: 'right', value: 'MinimumRetentionDays' }, { label: 'OverflowAction', width: 18, value: 'OverflowAction' }, { label: 'Entries', width: 10, align: 'right', value: o => o.Entries.toLocaleString('en-US') }, { label: 'Log', value: 'Log' }] } });
  /** Classic (Get-EventLog) logs, alphabetically, with the sizes and retention set in Event Viewer or Limit-EventLog. */
  const classicLogs = () => WS.evt.logNames().map(WS.evt.logProps).filter(l => l && l.classic).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const CLASSIC = l => classicLogs().find(x => x.name.toLowerCase() === String(l).toLowerCase());
  const eventLogObj = l => psobj('System.Diagnostics.EventLog', { Entries: l.entries, Log: l.name, LogDisplayName: l.display, MachineName: '.', MaximumKilobytes: l.maxKB, MinimumRetentionDays: l.minimumRetentionDays, OverflowAction: l.overflowAction, EnableRaisingEvents: false, Source: '' }, { str: l.name });
  cmdlet({ name: 'Get-EventLog', module: MGMT, synopsis: 'Gets the events in an event log, or a list of the event logs, on the local computer or remote computers.',
    params: { LogName: { pos: 0, alias: ['LN'] }, InstanceId: { type: 'long', pos: 1 }, Newest: { type: 'int' }, EntryType: { type: 'enum[]', values: ['Error', 'Information', 'FailureAudit', 'SuccessAudit', 'Warning'], enumType: 'System.String' }, Source: { type: 'string[]' }, Message: {}, After: { type: 'datetime' }, Before: { type: 'datetime' }, List: { type: 'switch' }, ComputerName: { alias: ['Cn'] } },
    process(ctx, p) {
      if (p.List || !p.LogName) {
        for (const l of classicLogs()) ctx.out(eventLogObj(l));
        return;
      }
      const log = LOGNAME(p.LogName);
      if (!log) ctx.throw({ message: `The event log '${p.LogName}' on computer '.' does not exist.`, category: 'NotSpecified', target: '', exception: 'InvalidOperationException', id: 'System.InvalidOperationException,Microsoft.PowerShell.Commands.GetEventLogCommand' });
      let list = WS.evt.list(log);
      if (p.InstanceId != null) list = list.filter(e => e.id === p.InstanceId);
      if (p.EntryType) list = list.filter(e => p.EntryType.includes(e.level === 'Audit Success' ? 'SuccessAudit' : e.level === 'Audit Failure' ? 'FailureAudit' : e.level));
      if (p.Source) list = list.filter(e => p.Source.some(s => wild(s, e.source)));
      if (p.Message) list = list.filter(e => wild(p.Message, e.message));
      if (p.After) list = list.filter(e => new Date(e.time) > p.After);
      if (p.Before) list = list.filter(e => new Date(e.time) < p.Before);
      if (p.Newest) list = list.slice(0, p.Newest);
      if (!list.length && (p.InstanceId != null || p.EntryType || p.Source)) ctx.error({ message: 'No matches found', category: 'ObjectNotFound', target: '', exception: 'ArgumentException', id: 'GetEventLogNoEntriesFound,Microsoft.PowerShell.Commands.GetEventLogCommand' });
      list.forEach(e => ctx.out(eventObj(e, log)));
    } });
  const LEVEL_NUM = { Critical: 1, Error: 2, Warning: 3, Information: 4, Verbose: 5, 'Audit Success': 0, 'Audit Failure': 0 };
  function winEventObj(e, log) {
    return psobj('System.Diagnostics.Eventing.Reader.EventLogRecord', { Message: e.message, Id: e.id, Version: 0, Qualifiers: null, Level: LEVEL_NUM[e.level], Task: 0, Opcode: 0, Keywords: e.level.startsWith('Audit') ? -9214364837600034816 : -9223372036854775808, RecordId: e.record, ProviderName: e.source, ProviderId: null, LogName: log, ProcessId: 4, ThreadId: 0, MachineName: e.computer, UserId: null, TimeCreated: new Date(e.time), LevelDisplayName: e.level.startsWith('Audit') ? 'Information' : e.level, OpcodeDisplayName: 'Info', TaskDisplayName: e.task, KeywordsDisplayNames: e.level.startsWith('Audit') ? [e.level] : ['Classic'] }, { str: 'System.Diagnostics.Eventing.Reader.EventLogRecord' });
  }
  view('System.Diagnostics.Eventing.Reader.EventLogRecord', { table: { groupBy: { label: 'ProviderName', value: o => o.ProviderName }, columns: [{ label: 'TimeCreated', width: 22, value: 'TimeCreated' }, { label: 'Id', width: 10, align: 'right', value: 'Id' }, { label: 'LevelDisplayName', width: 16, value: 'LevelDisplayName' }, { label: 'Message', value: o => String(o.Message).split('\n')[0] }] },
    listProps: ['TimeCreated', 'ProviderName', 'Id', 'Message'] });
  cmdlet({ name: 'Get-WinEvent', module: 'Microsoft.PowerShell.Diagnostics', version: '3.0.0.0', synopsis: 'Gets events from event logs and event tracing log files on local and remote computers.',
    params: { LogName: { type: 'string[]', pos: 0 }, MaxEvents: { type: 'long' }, FilterHashtable: { type: 'hashtable' }, ListLog: { type: 'string[]' }, Oldest: { type: 'switch' }, ProviderName: { type: 'string[]' } },
    process(ctx, p) {
      if (p.ListLog) {
        for (const pat of p.ListLog) {
          const hits = WS.evt.logNames().filter(l => wild(pat, l)).map(WS.evt.logProps);
          if (!hits.length && !hasWild(pat)) ctx.error({ message: `There is not an event log on the localhost computer that matches "${pat}".`, category: 'ObjectNotFound', target: pat, exception: 'Exception', id: 'NoMatchingLogsFound,Microsoft.PowerShell.Commands.GetWinEventCommand' });
          for (const l of hits) ctx.out(psobj('System.Diagnostics.Eventing.Reader.EventLogConfiguration', { FileSize: l.sizeBytes, IsLogFull: false, LastAccessTime: new Date(l.modified), LastWriteTime: new Date(l.modified), OldestRecordNumber: l.entries ? WS.evt.list(l.name).slice(-1)[0].record : 0, RecordCount: l.entries, LogName: l.name, LogType: l.type, LogIsolation: l.name === 'Security' ? 'Custom' : 'Application', IsEnabled: l.enabled, IsClassicLog: l.classic, SecurityDescriptor: 'O:BAG:SYD:(A;;0x2;;;S-1-15-2-1)(A;;0xf0007;;;SY)(A;;0x7;;;BA)(A;;0x7;;;SO)(A;;0x3;;;IU)(A;;0x3;;;SU)(A;;0x3;;;S-1-5-3)(A;;0x3;;;S-1-5-33)(A;;0x1;;;S-1-5-32-573)', LogFilePath: l.path, MaximumSizeInBytes: l.maxKB * 1024, LogMode: l.logMode, OwningProviderName: '', ProviderNames: [] }, { str: l.name }));
        }
        return;
      }
      let logs = p.LogName || [];
      let ids = null, level = null, start = null, provider = p.ProviderName || null;
      if (p.FilterHashtable) {
        const f = p.FilterHashtable;
        if (f.has('LogName')) logs = toArray(f.get('LogName')).map(toStr);
        if (f.has('Id')) ids = toArray(f.get('Id')).map(Number);
        if (f.has('Level')) level = toArray(f.get('Level')).map(Number);
        if (f.has('StartTime')) start = new Date(f.get('StartTime'));
        if (f.has('ProviderName')) provider = toArray(f.get('ProviderName')).map(toStr);
      }
      if (!logs.length) logs = WS.evt.logNames();
      const out = [];
      for (const l of logs) {
        const log = LOGNAME(l);
        if (!log) { ctx.error({ message: `There is not an event log on the localhost computer that matches "${l}".`, category: 'ObjectNotFound', target: l, exception: 'Exception', id: 'NoMatchingLogsFound,Microsoft.PowerShell.Commands.GetWinEventCommand' }); continue; }
        for (const e of WS.evt.list(log)) {
          if (ids && !ids.includes(e.id)) continue;
          if (level && !level.includes(LEVEL_NUM[e.level])) continue;
          if (start && new Date(e.time) < start) continue;
          if (provider && !provider.some(x => wild(x, e.source))) continue;
          out.push(winEventObj(e, log));
        }
      }
      out.sort((a, b) => b.TimeCreated - a.TimeCreated || b.RecordId - a.RecordId);
      if (p.Oldest) out.reverse();
      const sliced = p.MaxEvents ? out.slice(0, p.MaxEvents) : out;
      if (!sliced.length) ctx.error({ message: 'No events were found that match the specified selection criteria.', category: 'ObjectNotFound', target: '', exception: 'Exception', id: 'NoMatchingEventsFound,Microsoft.PowerShell.Commands.GetWinEventCommand' });
      ctx.outMany(sliced);
    } });
  cmdlet({ name: 'Clear-EventLog', module: MGMT, shouldProcess: true, params: { LogName: { type: 'string[]', pos: 0, mandatory: true } },
    async process(ctx, p) { for (const l of p.LogName) { const log = LOGNAME(l); if (!log) { ctx.error({ message: `The Log name "${l}" does not exist in the computer "localhost".`, category: 'InvalidOperation', exception: 'InvalidOperationException', id: 'Microsoft.PowerShell.Commands.ClearEventLogCommand' }); continue; } if (await ctx.confirm('Clear-EventLog', log)) WS.evt.clear(log); } } });
  cmdlet({ name: 'Write-EventLog', module: MGMT, params: { LogName: { pos: 0, mandatory: true }, Source: { pos: 1, mandatory: true }, EventId: { type: 'int', pos: 3, mandatory: true }, EntryType: { values: ['Error', 'Warning', 'Information'], type: 'enum' }, Message: { pos: 4, mandatory: true }, Category: { type: 'int' } },
    process(ctx, p) { const log = LOGNAME(p.LogName); if (!log) ctx.throw({ message: `The Log name "${p.LogName}" does not exist in the computer "localhost".`, category: 'InvalidOperation', exception: 'InvalidOperationException', id: 'Microsoft.PowerShell.Commands.WriteEventLogCommand' }); WS.evt.write(log, { id: p.EventId, source: p.Source, level: p.EntryType || 'Information', message: p.Message, task: p.Category ? `(${p.Category})` : 'None' }); } });
  view('System.Diagnostics.Eventing.Reader.EventLogConfiguration', { table: { columns: [{ label: 'LogMode', width: 9, value: 'LogMode' }, { label: 'MaximumSizeInBytes', width: 18, align: 'right', value: 'MaximumSizeInBytes' }, { label: 'RecordCount', width: 11, align: 'right', value: 'RecordCount' }, { label: 'LogName', value: 'LogName' }] },
    listProps: ['LogName', 'LogType', 'LogMode', 'IsEnabled', 'IsClassicLog', 'LogFilePath', 'MaximumSizeInBytes', 'FileSize', 'RecordCount', 'LastWriteTime'] });
  cmdlet({ name: 'Limit-EventLog', module: MGMT, shouldProcess: true, synopsis: 'Sets the event log properties that limit the size of the event log and the age of its entries.',
    params: { LogName: { type: 'string[]', pos: 0, mandatory: true, alias: ['LN'] }, MaximumSize: { type: 'long' }, OverflowAction: { type: 'enum', values: ['OverwriteAsNeeded', 'OverwriteOlder', 'DoNotOverwrite'], enumType: 'System.Diagnostics.OverflowAction' }, RetentionDays: { type: 'int', alias: ['MRD'] }, ComputerName: { type: 'string[]', alias: ['CN'] } },
    async process(ctx, p) {
      const range = (name, v, min, max) => { if (v != null && (v < min || v > max)) ctx.throw({ message: `Cannot validate argument on parameter '${name}'. The ${v} argument is ${v < min ? 'less than the minimum' : 'greater than the maximum'} allowed range of ${v < min ? min : max}. Supply an argument that is ${v < min ? 'greater than or equal to ' + min : 'less than or equal to ' + max} and then try the command again.`, category: 'InvalidData', target: '', exception: 'ParameterBindingValidationException', id: 'ParameterArgumentValidationError,Microsoft.PowerShell.Commands.LimitEventLogCommand' }); };
      range('MaximumSize', p.MaximumSize, 65536, 4294901760); range('RetentionDays', p.RetentionDays, 1, 365);
      for (const name of p.LogName) {
        const l = CLASSIC(name);
        if (!l) { ctx.error({ message: `The event log '${name}' on computer '.' does not exist.`, category: 'InvalidOperation', target: '', exception: 'InvalidOperationException', id: 'Microsoft.PowerShell.Commands.LimitEventLogCommand' }); continue; }
        if (!(await ctx.confirm('Limit-EventLog', l.name))) continue;
        const o = {};
        if (p.MaximumSize != null) o.maxKB = Math.ceil(p.MaximumSize / 65536) * 64;
        if (p.OverflowAction === 'OverwriteAsNeeded') Object.assign(o, { retention: 'overwrite', retainDays: 0 });
        else if (p.OverflowAction === 'DoNotOverwrite') Object.assign(o, { retention: 'manual', retainDays: 0 });
        else if (p.OverflowAction === 'OverwriteOlder' || p.RetentionDays != null) Object.assign(o, { retention: 'manual', retainDays: p.RetentionDays || l.retainDays || 7 });
        const r = WS.evt.setLogProps(l.name, o);
        if (!r.ok) ctx.error({ message: r.error, category: 'InvalidOperation', target: l.name, exception: 'InvalidOperationException', id: 'Microsoft.PowerShell.Commands.LimitEventLogCommand' });
      }
    } });

  /* ================================================================ computer / system */
  cmdlet({ name: 'Restart-Computer', module: MGMT, shouldProcess: true, synopsis: 'Restarts the operating system on local and remote computers.', params: { ComputerName: { type: 'string[]', pos: 0 }, Force: { type: 'switch' }, Wait: { type: 'switch' } },
    async process(ctx) { if (await ctx.confirm('Restart-Computer', WS.sys.name)) setTimeout(() => WS.shell.restart(), 300); } });
  cmdlet({ name: 'Stop-Computer', module: MGMT, shouldProcess: true, synopsis: 'Stops (shuts down) local and remote computers.', params: { ComputerName: { type: 'string[]', pos: 0 }, Force: { type: 'switch' } },
    async process(ctx) { if (await ctx.confirm('Stop-Computer', WS.sys.name)) setTimeout(() => WS.shell.shutdown(), 300); } });
  cmdlet({ name: 'Rename-Computer', module: MGMT, shouldProcess: true, synopsis: 'Renames a computer.', params: { NewName: { pos: 0, mandatory: true }, Restart: { type: 'switch' }, Force: { type: 'switch' }, PassThru: { type: 'switch' }, DomainCredential: { type: 'object' }, LocalCredential: { type: 'object' } },
    async process(ctx, p) {
      if (!(await ctx.confirm('Rename-Computer', `Name: ${WS.sys.name}`))) return;
      if (p.NewName.toUpperCase() === WS.sys.name.toUpperCase()) ctx.throw({ message: `Skip computer '${WS.sys.name}' with new name '${p.NewName}' because the new name is the same as the current name.`, category: 'InvalidArgument', target: p.NewName, exception: 'InvalidOperationException', id: 'NewNameIsOldName,Microsoft.PowerShell.Commands.RenameComputerCommand' });
      const r = WS.sys.rename(p.NewName);
      if (!r.ok) ctx.throw({ message: `Skip computer '${WS.sys.name}' with new name '${p.NewName}' because the new name is not valid. The new computer name entered is not properly formatted. Standard names may contain letters (a-z, A-Z), numbers (0-9), and hyphens (-), but no spaces or periods (.). The name may not consist entirely of digits, and may not be longer than 63 characters.`, category: 'InvalidArgument', target: p.NewName, exception: 'InvalidOperationException', id: 'InvalidNewName,Microsoft.PowerShell.Commands.RenameComputerCommand' });
      if (p.PassThru) ctx.out(psobj('Microsoft.PowerShell.Commands.RenameComputerChangeInfo', { HasSucceeded: true, OldComputerName: WS.sys.name, NewComputerName: p.NewName.toUpperCase() }));
      if (p.Restart) setTimeout(() => WS.shell.restart(), 300);
      else ctx.warn(`The changes will take effect after you restart the computer ${WS.sys.name}.`);
    } });
  cmdlet({ name: 'Add-Computer', module: MGMT, shouldProcess: true, params: { DomainName: { pos: 0, mandatory: true, alias: ['DN', 'Domain'] }, Credential: { type: 'object' }, Restart: { type: 'switch' }, Force: { type: 'switch' }, OUPath: {} },
    process(ctx, p) {
      if (WS.sys.isDC()) ctx.throw({ message: `Cannot add computer '${WS.sys.name}' to domain '${p.DomainName}' because it is already in that domain.`, category: 'InvalidOperation', target: WS.sys.name, exception: 'InvalidOperationException', id: 'AddComputerToSameDomain,Microsoft.PowerShell.Commands.AddComputerCommand' });
      ctx.throw({ message: `Computer '${WS.sys.name}' failed to join domain '${p.DomainName}' from its current workgroup '${WS.state.system.workgroup}' with following error message: The specified domain either does not exist or could not be contacted.`, category: 'OperationStopped', target: WS.sys.name, exception: 'InvalidOperationException', id: 'FailToJoinDomainFromWorkgroup,Microsoft.PowerShell.Commands.AddComputerCommand' });
    } });
  const tzObj = t => psobj('System.TimeZoneInfo', { Id: t.id, DisplayName: t.display, StandardName: t.id, DaylightName: t.id.replace('Standard', 'Daylight'), BaseUtcOffset: (t.display.match(/UTC([+-]\d\d:\d\d)?/) || [])[1] || '00:00:00', SupportsDaylightSavingTime: !/^(UTC|.*Arizona|.*Saskatchewan)/.test(t.display) }, { str: t.display });
  view('System.TimeZoneInfo', { list: ['Id', 'DisplayName', 'StandardName', 'DaylightName', 'BaseUtcOffset', 'SupportsDaylightSavingTime'] });
  cmdlet({ name: 'Get-TimeZone', module: MGMT, params: { Name: { type: 'string[]', pos: 0 }, Id: { type: 'string[]' }, ListAvailable: { type: 'switch' } },
    process(ctx, p) {
      if (p.ListAvailable || p.Name || p.Id) { WS.sys.timeZones.filter(t => (!p.Name || p.Name.some(n => wild(n, t.id) || wild(n, t.display))) && (!p.Id || p.Id.some(n => wild(n, t.id)))).forEach(t => ctx.out(tzObj(t))); return; }
      ctx.out(tzObj(WS.sys.timeZone()));
    } });
  cmdlet({ name: 'Set-TimeZone', module: MGMT, shouldProcess: true, params: { Id: { pos: 0 }, Name: {}, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      const key = p.Id || p.Name;
      const t = WS.sys.timeZones.find(z => z.id.toLowerCase() === String(key).toLowerCase() || z.display.toLowerCase() === String(key).toLowerCase() || (p.Name && wild(p.Name, z.id)));
      if (!t) ctx.throw({ message: `The time zone ID '${key}' was not found on the local computer.`, category: 'InvalidArgument', target: key, exception: 'TimeZoneNotFoundException', id: 'TimeZoneNotFound,Microsoft.PowerShell.Commands.SetTimeZoneCommand' });
      if (!(await ctx.confirm('Set-TimeZone', t.display))) return;
      WS.sys.setTimeZone(t.id);
      if (p.PassThru) ctx.out(tzObj(t));
    } });
  cmdlet({ name: 'Get-ComputerInfo', module: MGMT, params: { Property: { type: 'string[]', pos: 0 } },
    async process(ctx, p) {
      ctx.progress({ activity: 'Get-ComputerInfo', status: 'Loading computer information', percent: 50 });
      await ctx.sleep(400);
      const s = WS.state.system;
      const info = psobj('Microsoft.PowerShell.Commands.ComputerInfo', {
        WindowsBuildLabEx: '26100.1.amd64fre.ge_release.240331-1435', WindowsCurrentVersion: '6.3', WindowsEditionId: 'ServerDatacenterEval', WindowsInstallationType: 'Server', WindowsInstallDateFromRegistry: new Date(s.installDate),
        WindowsProductName: 'Windows Server 2025 Datacenter Evaluation', WindowsRegisteredOwner: 'Windows User', WindowsSystemRoot: 'C:\\Windows', WindowsVersion: '2009',
        BiosManufacturer: 'Microsoft Corporation', BiosVersion: 'VRTUAL - 4001628', CsDNSHostName: s.computerName, CsDomain: s.domain || s.workgroup, CsDomainRole: WS.sys.isDC() ? 'PrimaryDomainController' : 'StandaloneServer',
        CsManufacturer: 'Microsoft Corporation', CsModel: 'Virtual Machine', CsName: s.computerName, CsNumberOfLogicalProcessors: 4, CsPartOfDomain: !!s.domain, CsTotalPhysicalMemory: 4294430720, CsWorkgroup: s.workgroup,
        OsName: 'Microsoft Windows Server 2025 Datacenter Evaluation', OsType: 'WINNT', OsVersion: '10.0.26100', OsBuildNumber: '26100', OsArchitecture: '64-bit', OsLanguage: 'en-US', OsLastBootUpTime: new Date(s.lastBoot || new Date()),
        OsProductType: WS.sys.isDC() ? 'DomainController' : 'Server', OsSystemDrive: 'C:', OsWindowsDirectory: 'C:\\Windows', TimeZone: s.timeZone, LogonServer: '\\\\' + s.computerName, HyperVisorPresent: true
      });
      ctx.out(p.Property ? psobj('Selected.Microsoft.PowerShell.Commands.ComputerInfo', Object.fromEntries(Object.keys(info).filter(k => p.Property.some(x => wild(x, k))).map(k => [k, info[k]]))) : info);
    } });
  /* ---------------- processes (WS.proc) ---------------- */
  const K = n => Math.round(n / 1024);
  const procCols = [{ label: 'Handles', width: 7, align: 'right', value: 'Handles' }, { label: 'NPM(K)', width: 7, align: 'right', value: o => K(o.NPM) }, { label: 'PM(K)', width: 8, align: 'right', value: o => K(o.PM) },
    { label: 'WS(K)', width: 10, align: 'right', value: o => K(o.WS) }, { label: 'CPU(s)', width: 10, align: 'right', value: o => (o.CPU == null ? '' : o.CPU.toFixed(2)) }, { label: 'Id', width: 6, align: 'right', value: 'Id' },
    { label: 'SI', width: 3, align: 'right', value: 'SI' }, { label: 'ProcessName', value: 'ProcessName' }];
  view('System.Diagnostics.Process', { table: { columns: procCols }, list: ['Id', 'Handles', 'CPU', 'SI', 'Name'] });
  view('System.Diagnostics.Process#IncludeUserName', { table: { columns: [procCols[0], procCols[3], procCols[4], procCols[5], { label: 'UserName', width: 22, value: 'UserName' }, procCols[7]] }, list: ['Id', 'Handles', 'CPU', 'SI', 'Name', 'UserName'] });
  const isProcObj = v => /^System\.Diagnostics\.Process/.test(PS.typeName(v) || '');
  const procLabel = p => `${p.name} (${p.pid})`;
  function procObj(p, withUser) {
    const lv = WS.proc.live(p);
    const ws = Math.round(lv.memKB * 1024 * (p.key === 'idle' ? 1 : 1.18)), pm = Math.round(lv.memKB * 1024);
    const sys = p.key === 'idle' || p.key === 'system' || p.key === 'registry';
    const pr = p.key === 'idle' ? null : p.priority;
    const props = {
      Name: p.name, Id: p.pid, PriorityClass: p.protected ? null : pr, FileVersion: p.protected || sys ? null : p.version || '10.0.26100.1 (WinBuild.160101.0800)',
      HandleCount: p.handles, WorkingSet: ws, PagedMemorySize: pm, PrivateMemorySize: pm, VirtualMemorySize: 2203318222848 % 4294967296, TotalProcessorTime: p.key === 'idle' ? null : lv.cpuSeconds,
      SI: p.session, Handles: p.handles, VM: 2203318222848 + p.threads * 1048576, WS: ws, PM: pm, NPM: (8 + U.hashStr(p.image) % 40) * 1024,
      Path: p.protected || sys ? null : p.path, Company: p.protected || sys ? null : p.company, CPU: p.key === 'idle' ? null : Math.round(lv.cpuSeconds * 1000) / 1000,
      ProductVersion: p.protected || sys ? null : p.version || '10.0.26100.1', Description: p.protected || sys ? null : p.description, Product: p.protected || sys ? null : (p.company === 'Microsoft Corporation' ? 'Microsoft® Windows® Operating System' : p.description),
      BasePriority: pr ? WS.proc.PRIORITIES[pr].base : 0, HasExited: false, MachineName: '.', MainWindowHandle: p.windows.length ? 65536 + p.pid * 2 : 0, MainWindowTitle: p.windows.length ? p.windows[0].title : '',
      ProcessName: p.name, ProcessorAffinity: p.protected ? null : p.affinity, Responding: p.status !== 'Not responding', SessionId: p.session, StartTime: p.protected || sys ? null : p.started,
      Threads: Array.from({ length: Math.min(p.threads, 64) }, (_, i) => psobj('System.Diagnostics.ProcessThread', { Id: p.pid + 4 * (i + 1) }, { str: 'System.Diagnostics.ProcessThread' })),
      WorkingSet64: ws, PagedMemorySize64: pm, PrivateMemorySize64: pm, VirtualMemorySize64: 2203318222848 + p.threads * 1048576, NonpagedSystemMemorySize64: (8 + U.hashStr(p.image) % 40) * 1024
    };
    if (withUser) props.UserName = sys && p.key !== 'system' ? null : WS.proc.qualifiedUser(p);
    const find = () => WS.proc.get(p.pid);
    const check = r => { if (!r.ok) throw new Error(r.code === 'AccessDenied' ? 'Access is denied' : r.error); };
    return psobj(withUser ? 'System.Diagnostics.Process#IncludeUserName' : 'System.Diagnostics.Process', props, {
      str: `System.Diagnostics.Process (${p.name})`,
      setters: { PriorityClass: v => check(WS.proc.setPriority(p.pid, toStr(v))), ProcessorAffinity: v => check(WS.proc.setAffinity(p.pid, +v)) },
      methods: {
        Kill() { if (!find()) throw new Error('No process is associated with this object.'); check(WS.proc.kill(p.pid, {})); return null; },
        CloseMainWindow() { const q = find(); if (!q || !q.windows.length) return false; WS.proc.kill(p.pid, { force: false }); return true; },
        Refresh() { return null; }, WaitForExit() { return true; }
      } });
  }
  function procList() { return WS.proc.list().sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.pid - b.pid); }
  const notFoundId = (ctx, id, verb) => ctx.error({ message: `Cannot find a process with the process identifier ${id}.`, category: 'ObjectNotFound', target: id, targetType: 'Int32', exception: 'ProcessCommandException', id: `NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.${verb}ProcessCommand` });
  const notFoundName = (ctx, n, verb) => ctx.error({ message: `Cannot find a process with the name "${n}". Verify the process name and call the cmdlet again.`, category: 'ObjectNotFound', target: n, targetType: 'String', exception: 'ProcessCommandException', id: `NoProcessFoundForGivenName,Microsoft.PowerShell.Commands.${verb}ProcessCommand` });
  /** Processes chosen by -Name / -Id / -InputObject, with the cmdlet's not-found errors. */
  function pickProcs(ctx, p, verb) {
    const all = procList();
    if (p.InputObject) return p.InputObject.map(o => all.find(x => x.pid === o.Id)).filter(Boolean);
    if (p.Id) { const out = []; for (const id of p.Id) { const hit = all.find(x => x.pid === id); if (hit) out.push(hit); else notFoundId(ctx, id, verb); } return out; }
    const out = [];
    for (const n of p.Name || ['*']) {
      const hits = all.filter(x => wild(n, x.name));
      if (!hits.length && !hasWild(n)) notFoundName(ctx, n, verb);
      hits.forEach(h => { if (!out.includes(h)) out.push(h); });
    }
    return out;
  }
  cmdlet({ name: 'Get-Process', module: MGMT, synopsis: 'Gets the processes that are running on the local computer.',
    params: { Name: { type: 'string[]', pos: 0, pipe: 'name', alias: ['ProcessName'] }, Id: { type: 'int[]', pipe: 'name', alias: ['PID'] }, InputObject: { type: 'object[]', pipe: 'value', accepts: isProcObj },
      IncludeUserName: { type: 'switch' }, ComputerName: { type: 'string[]', alias: ['Cn'] }, Module: { type: 'switch' }, FileVersionInfo: { type: 'switch', alias: ['FV', 'FVI'] } },
    process(ctx, p) {
      for (const q of pickProcs(ctx, p, 'Get')) {
        if (p.FileVersionInfo || p.Module) {
          if (q.protected || !q.path) { ctx.error({ message: `Cannot enumerate the modules of the "${q.name}" process.`, category: 'PermissionDenied', target: `System.Diagnostics.Process (${q.name})`, targetType: 'Process', exception: 'ProcessCommandException', id: 'CouldNotEnumerateModules,Microsoft.PowerShell.Commands.GetProcessCommand' }); continue; }
          ctx.out(psobj('System.Diagnostics.FileVersionInfo', { ProductVersion: q.version || '10.0.26100.1', FileVersion: q.version || '10.0.26100.1 (WinBuild.160101.0800)', FileName: q.path, FileDescription: q.description, CompanyName: q.company }));
          continue;
        }
        ctx.out(procObj(q, p.IncludeUserName));
      }
    } });
  view('System.Diagnostics.FileVersionInfo', { table: { columns: [{ label: 'ProductVersion', width: 16, value: 'ProductVersion' }, { label: 'FileVersion', width: 16, value: o => String(o.FileVersion).slice(0, 16) }, { label: 'FileName', value: 'FileName' }] } });
  cmdlet({ name: 'Stop-Process', module: MGMT, shouldProcess: true, synopsis: 'Stops one or more running processes.',
    params: { Id: { type: 'int[]', pos: 0, pipe: 'name' }, Name: { type: 'string[]', pipe: 'name', alias: ['ProcessName'] }, InputObject: { type: 'object[]', pipe: 'value', accepts: isProcObj }, PassThru: { type: 'switch' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      const me = (WS.session && WS.session.user) || 'Administrator';
      for (const q of pickProcs(ctx, p, 'Stop')) {
        if (!WS.proc.get(q.pid)) continue;
        // a process the current user doesn't own asks first unless -Force (as Stop-Process does)
        const owned = q.user.toLowerCase() === me.toLowerCase();
        if (!(await ctx.confirm('Stop-Process', procLabel(q), owned || p.Force ? {} : { impact: 'High', query: `Are you sure you want to perform the Stop-Process operation on the following item: ${q.name}(${q.pid})?` }))) continue;
        if (q.pid === 0 || q.key === 'system' || q.key === 'registry' || q.protected) {
          ctx.error({ message: `Cannot stop process "${procLabel(q)}" because of the following error: Access is denied`, category: 'CloseError', target: `System.Diagnostics.Process (${q.name})`, targetType: 'Process', exception: 'ProcessCommandException', id: 'CouldNotStopProcess,Microsoft.PowerShell.Commands.StopProcessCommand' });
          continue;
        }
        const obj = p.PassThru ? procObj(q) : null;
        const r = WS.proc.kill(q.pid, {});
        if (!r.ok) { ctx.error({ message: `Cannot stop process "${procLabel(q)}" because of the following error: ${r.error.replace(/\.$/, '')}`, category: 'CloseError', target: `System.Diagnostics.Process (${q.name})`, targetType: 'Process', exception: 'ProcessCommandException', id: 'CouldNotStopProcess,Microsoft.PowerShell.Commands.StopProcessCommand' }); continue; }
        if (obj) { obj.HasExited = true; ctx.out(obj); }
        if (r.crashed) return;
      }
    } });
  cmdlet({ name: 'Start-Process', module: MGMT, synopsis: 'Starts one or more processes on the local computer.',
    params: { FilePath: { type: 'string', pos: 0, mandatory: true, alias: ['PSPath', 'Path'] }, ArgumentList: { type: 'string[]', pos: 1, alias: ['Args'] }, PassThru: { type: 'switch' }, Verb: { type: 'string' },
      WindowStyle: { type: 'string' }, Wait: { type: 'switch' }, NoNewWindow: { type: 'switch' }, WorkingDirectory: { type: 'string' }, Credential: { type: 'object' } },
    process(ctx, p) {
      const text = p.FilePath + (p.ArgumentList ? ' ' + p.ArgumentList.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ') : '');
      const r = WS.term.resolveLaunch(/\s/.test(p.FilePath) && !p.ArgumentList ? `"${p.FilePath}"` : text, ctx.session.cwd);
      if (!r) ctx.throw({ message: 'This command cannot be run due to the error: The system cannot find the file specified.', category: 'InvalidOperation', exception: 'InvalidOperationException', id: 'InvalidOperationException,Microsoft.PowerShell.Commands.StartProcessCommand' });
      const before = new Set(WS.proc.list().map(x => x.pid));
      WS.term.launchResolved(r);
      if (!p.PassThru) return;
      const started = WS.proc.list().filter(x => !before.has(x.pid) && x.kind === 'app' && !x.tab).pop() || WS.proc.list().filter(x => x.appId === r.app).pop();
      if (started) ctx.out(procObj(started));
    } });
  view('System.Management.ManagementObject#root\\cimv2\\Win32_QuickFixEngineering', { table: { columns: [{ label: 'Source', width: 13, value: 'Source' }, { label: 'Description', width: 15, value: 'Description' }, { label: 'HotFixID', width: 11, value: 'HotFixID' }, { label: 'InstalledBy', width: 20, value: 'InstalledBy' }, { label: 'InstalledOn', value: o => U.fmtDate(o.InstalledOn) }] } });
  cmdlet({ name: 'Get-HotFix', module: MGMT, params: { Id: { type: 'string[]', pos: 0 } },
    process(ctx, p) {
      for (const x of WS.wu.hotfixes()) if (!p.Id || p.Id.some(i => wild(i, x.kb))) ctx.out(psobj('System.Management.ManagementObject#root\\cimv2\\Win32_QuickFixEngineering', { Source: WS.sys.name, Description: x.kind, HotFixID: x.kb, InstalledBy: x.by, InstalledOn: x.installedOn }));
    } });
  /* CIM / WMI classes students commonly query */
  const CIM = {
    win32_operatingsystem: () => [psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_OperatingSystem', { SystemDirectory: 'C:\\Windows\\system32', Organization: '', BuildNumber: '26100', RegisteredUser: 'Windows User', SerialNumber: '00454-40000-00001-AA000', Version: '10.0.26100', Caption: 'Microsoft Windows Server 2025 Datacenter Evaluation', OSArchitecture: '64-bit', CSName: WS.sys.name, LastBootUpTime: new Date(WS.state.system.lastBoot || new Date()), InstallDate: new Date(WS.state.system.installDate), TotalVisibleMemorySize: 4193780, FreePhysicalMemory: 2366512, ProductType: WS.sys.isDC() ? 2 : 3 })],
    win32_computersystem: () => [psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_ComputerSystem', { Name: WS.sys.name, PrimaryOwnerName: 'Windows User', Domain: WS.state.system.domain || WS.state.system.workgroup, TotalPhysicalMemory: 4294430720, Model: 'Virtual Machine', Manufacturer: 'Microsoft Corporation', PartOfDomain: !!WS.state.system.domain, DomainRole: WS.sys.isDC() ? 5 : 2, Workgroup: WS.state.system.workgroup, NumberOfLogicalProcessors: 4 })],
    win32_logicaldisk: () => [...WS.fs.drives().map(l => { const v = WS.storage.volume(l); return psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_LogicalDisk', { DeviceID: l + ':', DriveType: 3, ProviderName: null, FreeSpace: v ? v.free : 0, Size: v ? v.size : 0, VolumeName: v ? v.label : '' }); }), psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_LogicalDisk', { DeviceID: 'D:', DriveType: 5, ProviderName: null, FreeSpace: null, Size: null, VolumeName: null })],
    win32_bios: () => [psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_BIOS', { SMBIOSBIOSVersion: 'Hyper-V UEFI Release v4.1', Manufacturer: 'Microsoft Corporation', Name: 'Hyper-V UEFI Release v4.1', SerialNumber: '6587-3459-1201-8879-6125-2187-35', Version: 'VRTUAL - 4001628' })],
    win32_processor: () => [psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Processor', { DeviceID: 'CPU0', Name: 'Intel(R) Xeon(R) CPU E5-2673 v4 @ 2.30GHz', Caption: 'Intel64 Family 6 Model 79 Stepping 1', MaxClockSpeed: 2295, SocketDesignation: 'None', Manufacturer: 'GenuineIntel', NumberOfCores: 4 })],
    win32_process: () => procList().sort((a, b) => a.started - b.started || a.pid - b.pid).map(q => { const lv = WS.proc.live(q); return psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Process', { ProcessId: q.pid, Name: q.key === 'idle' ? 'System Idle Process' : q.image, HandleCount: q.handles, WorkingSetSize: Math.round(lv.memKB * 1208), VirtualSize: 2203318222848 + q.threads * 1048576, ParentProcessId: q.ppid, CommandLine: q.protected || q.key === 'idle' || q.key === 'system' ? null : q.cmdLine || q.path, ExecutablePath: q.protected || q.key === 'idle' || q.key === 'system' ? null : q.path, SessionId: q.session, ThreadCount: q.threads, Priority: q.key === 'idle' ? 0 : WS.proc.PRIORITIES[q.priority].base, CreationDate: q.started, CSName: WS.sys.name, Caption: q.key === 'idle' ? 'System Idle Process' : q.image }); }),
    win32_startupcommand: () => WS.proc.startupApps().map(e => psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_StartupCommand', { Command: e.command, User: e.location === 'HKCU' ? `${WS.proc.accountDomain()}\\Administrator` : 'Public', Caption: e.name, Name: e.name, Location: e.location === 'HKCU' ? 'HKU\\S-1-5-21-3623811015-3361044348-30300820-500\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' : e.location === 'Startup' ? 'Startup' : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', UserSID: e.location === 'HKCU' ? 'S-1-5-21-3623811015-3361044348-30300820-500' : 'Public' })),
    win32_service: () => WS.svc.list().map(s => psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Service', { ProcessId: s.status === 'Running' ? WS.proc.pidOfService(s.name) : 0, Name: s.name, StartMode: s.startType === 'Automatic' || s.startType === 'AutomaticDelayedStart' ? 'Auto' : s.startType, State: s.status, Status: 'OK', DisplayName: s.display, StartName: s.logon === 'Local System' ? 'LocalSystem' : 'NT AUTHORITY\\' + s.logon.replace(/ /g, '') })),
    win32_networkadapterconfiguration: () => WS.net.adapters().map(a => psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_NetworkAdapterConfiguration', { DHCPEnabled: a.dhcp, IPAddress: [a.ip, a.linkLocal6.replace(/%\d+$/, '')], DefaultIPGateway: a.gateway ? [a.gateway] : null, DNSDomain: a.dnsSuffix || null, ServiceName: 'netvsc', Description: a.description, Index: 1, IPSubnet: [U.prefixToMask(a.prefix), '64'], DNSServerSearchOrder: a.dnsServers, MACAddress: a.mac.replace(/-/g, ':'), IPEnabled: a.enabled })),
    win32_useraccount: () => (WS.sys.isDC() ? WS.ad.search({ type: 'user' }).map(u => ({ name: u.sam, domain: WS.ad.netbios(), sid: u.sid, disabled: !u.enabled, full: u.displayName })) : WS.local.users().map(u => ({ name: u.name, domain: WS.sys.name, sid: u.sid, disabled: !u.enabled, full: u.fullName }))).map(u => psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_UserAccount', { AccountType: 512, Caption: `${u.domain}\\${u.name}`, Domain: u.domain, SID: u.sid, FullName: u.full || '', Name: u.name, Disabled: u.disabled })),
    win32_share: () => WS.smb.shares().map(s => psobj('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Share', { Name: s.name, Path: s.path, Description: s.description }))
  };
  const cimView = cols => ({ table: { columns: cols.map(c => (typeof c === 'string' ? { label: c, value: c } : c)) } });
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_OperatingSystem', cimView(['SystemDirectory', 'Organization', 'BuildNumber', 'RegisteredUser', 'SerialNumber', 'Version']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_ComputerSystem', cimView(['Name', 'PrimaryOwnerName', 'Domain', 'TotalPhysicalMemory', 'Model', 'Manufacturer']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_LogicalDisk', cimView(['DeviceID', 'DriveType', 'ProviderName', 'VolumeName', 'Size', 'FreeSpace']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Service', cimView(['ProcessId', 'Name', 'StartMode', 'State', 'Status', 'ExitCode']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Process', cimView(['ProcessId', 'Name', 'HandleCount', 'WorkingSetSize', 'VirtualSize']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_StartupCommand', cimView(['Command', 'User', 'Caption']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_NetworkAdapterConfiguration', cimView(['ServiceName', 'DHCPEnabled', 'Index', 'Description']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_UserAccount', cimView(['Name', 'Caption', 'AccountType', 'SID', 'Domain']));
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_BIOS', { list: ['SMBIOSBIOSVersion', 'Manufacturer', 'Name', 'SerialNumber', 'Version'] });
  view('Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Processor', cimView(['DeviceID', 'Name', 'Caption', 'MaxClockSpeed', 'SocketDesignation', 'Manufacturer']));
  const cimCmd = (name, module, cls) => cmdlet({ name, module, cls, params: { ClassName: { pos: 0, mandatory: true, alias: ['Class'] }, Filter: {}, Property: { type: 'string[]' }, ComputerName: { type: 'string[]' }, Namespace: {} },
    process(ctx, p) {
      const f = CIM[p.ClassName.toLowerCase()];
      if (!f) {
        if (name === 'Get-WmiObject') ctx.throw({ message: 'Invalid class "' + p.ClassName + '"', category: 'InvalidType', target: '', exception: 'ManagementException', id: 'GetWMIManagementException,Microsoft.PowerShell.Commands.GetWmiObjectCommand' });
        ctx.throw({ message: 'Invalid class ', category: 'MetadataError', target: `root\\cimv2:${p.ClassName}`, targetType: 'String', exception: 'CimException', id: 'HRESULT 0x80041010,Microsoft.Management.Infrastructure.CimCmdlets.GetCimInstanceCommand' });
      }
      let items = f();
      if (p.Filter) { const m = p.Filter.match(/^\s*(\w+)\s*=\s*['"]?([^'"]*)['"]?\s*$/); if (m) items = items.filter(o => toStr(getProp(o, m[1])).toLowerCase() === m[2].toLowerCase()); }
      ctx.outMany(items);
    } });
  cimCmd('Get-CimInstance', 'CimCmdlets', 'Microsoft.Management.Infrastructure.CimCmdlets.GetCimInstanceCommand');
  cimCmd('Get-WmiObject', MGMT, 'Microsoft.PowerShell.Commands.GetWmiObjectCommand');
  PS.aliases.gwmi = 'Get-WmiObject';
  PS.aliases.gcim = 'Get-CimInstance';
  cmdlet({ name: 'Enable-PSRemoting', module: CORE, shouldProcess: true, params: { Force: { type: 'switch' }, SkipNetworkProfileCheck: { type: 'switch' } },
    process(ctx) {
      WS.svc.setStartup('WinRM', 'Automatic'); WS.svc.start('WinRM');
      WS.state.system.remoteMgmt = true; WS.store.changed('system');
      ctx.host('WinRM is already set up to receive requests on this computer.\nWinRM is already set up for remote management on this computer.\n');
    } });
  cmdlet({ name: 'Test-WSMan', module: 'Microsoft.WSMan.Management', params: { ComputerName: { pos: 0 } },
    process(ctx) { if (!WS.svc.isRunning('WinRM')) ctx.throw({ message: 'The client cannot connect to the destination specified in the request. Verify that the service on the destination is running and is accepting requests.', category: 'InvalidOperation', exception: 'InvalidOperationException', id: 'WsManError,Microsoft.WSMan.Management.TestWSManCommand' }); ctx.out(psobj('System.Xml.XmlElement', { wsmid: 'http://schemas.dmtf.org/wbem/wsman/identity/1/wsmanidentity.xsd', ProtocolVersion: 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd', ProductVendor: 'Microsoft Corporation', ProductVersion: 'OS: 0.0.0 SP: 0.0 Stack: 3.0' })); } });

  PS.helpers = Object.assign(PS.helpers || {}, { itemObj, svcObj, featObj, fsError, expandPaths, wild, hasWild, selectProps });
})();
