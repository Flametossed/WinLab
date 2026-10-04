/* File system + SMB shares.
 *   WS.fs  - a virtual file tree per drive letter (File Explorer, Notepad, dir/cd/type/copy, Get-ChildItem,
 *            New-Item, Set-Content...). Methods throw WS.fs.Error with a .code
 *            ('NotFound' | 'PathNotFound' | 'Exists' | 'NotEmpty' | 'NotADirectory' | 'IsADirectory' |
 *             'InvalidName' | 'AccessDenied' | 'NotReady'); the GUI/CLI turns that into its own wording.
 *   WS.smb - SMB shares (New-SmbShare, net share, the Sharing tab). Creating the first share installs
 *            the File Server role service, as on real Windows.
 *   WS.netuse - mapped network drives (net use, New-PSDrive -Persist, New-SmbMapping, Group Policy Drive Maps).
 *            Paths may be UNC (\\server\share\dir) or start with a mapped letter; both resolve to this server's
 *            shares (other hosts fail with 'NetPath' / 'NetName', as SMB does).
 * State: fs.drives[<LETTER>] = dir node; smb.shares[]; netuse.drives[] (see WS.netuse below).
 * Node: { type: 'dir'|'file', name, children: {lowercase name: node}, content?, size?, attrs?: 'HSR', created, modified, protect? } */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  class FsError extends Error { constructor(code, message, path) { super(message); this.code = code; this.path = path; } }

  /* ---------------- default C: drive ---------------- */
  const HOSTS = `# Copyright (c) 1993-2009 Microsoft Corp.
#
# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.
#
# This file contains the mappings of IP addresses to host names. Each
# entry should be kept on an individual line. The IP address should
# be placed in the first column followed by the corresponding host name.
# The IP address and the host name should be separated by at least one
# space.
#
# Additionally, comments (such as these) may be inserted on individual
# lines or following the machine name denoted by a '#' symbol.
#
# For example:
#
#      102.54.94.97     rhino.acme.com          # source server
#       38.25.63.10     x.acme.com              # x client host

# localhost name resolution is handled within DNS itself.
#	127.0.0.1       localhost
#	::1             localhost
`;
  const NETWORKS = `# Copyright (c) 1993-1999 Microsoft Corp.
#
# This file contains network name/network number mappings for
# local networks. Network numbers are recognized in dotted decimal form.
#
# Format:
#
# <network name>  <network number>     [aliases...]  [#<comment>]
#
# For example:
#
#    loopback     127
#    campus       284.122.107
#    london       284.122.108

loopback                 127
`;
  const LMHOSTS = `# Copyright (c) 1993-1999 Microsoft Corp.
#
# This is a sample LMHOSTS file used by the Microsoft TCP/IP for Windows.
#
# This file contains the mappings of IP addresses to computernames
# (NetBIOS) names.  Each entry should be kept on an individual line.
# The IP address should be placed in the first column followed by the
# corresponding computername. The address and the computername
# should be separated by at least one space or tab. The "#" character
# is generally used to denote the start of a comment (see the exceptions
# below).
`;
  const WIN_INI = '; for 16-bit app support\r\n[fonts]\r\n[extensions]\r\n[mci extensions]\r\n[files]\r\n[Mail]\r\nMAPI=1\r\n';
  const SYSTEM_INI = '; for 16-bit app support\r\n[386Enh]\r\nwoafont=dosapp.fon\r\nEGA80WOA.FON=EGA80WOA.FON\r\nEGA40WOA.FON=EGA40WOA.FON\r\nCGA80WOA.FON=CGA80WOA.FON\r\nCGA40WOA.FON=CGA40WOA.FON\r\n\r\n[drivers]\r\nwave=mmdrv.dll\r\ntimer=timer.drv\r\n\r\n[mci]\r\n';

  // tiny tree DSL: D(name, attrs?, ...children), F(name, sizeOrText, attrs?)
  const D = (name, attrs, ...children) => {
    if (typeof attrs !== 'string' && attrs != null) { children.unshift(attrs); attrs = ''; }
    const node = { type: 'dir', name, children: {} };
    if (attrs) node.attrs = attrs;
    for (const c of children.flat()) if (c) node.children[c.name.toLowerCase()] = c;
    return node;
  };
  const F = (name, sizeOrText, attrs) => {
    const node = { type: 'file', name };
    if (typeof sizeOrText === 'string') node.content = sizeOrText; else node.size = sizeOrText || 0;
    if (attrs) node.attrs = attrs;
    return node;
  };
  const profile = name => D(name,
    D('AppData', 'H', D('Local', D('Microsoft'), D('Temp')), D('LocalLow'), D('Roaming', D('Microsoft'))),
    D('Contacts'), D('Desktop'), D('Documents'), D('Downloads'), D('Favorites'), D('Links'), D('Music'),
    D('Pictures'), D('Saved Games'), D('Searches'), D('Videos'), F('NTUSER.DAT', 786432, 'H'));

  function defaultC() {
    const sys32 = D('System32',
      D('config', D('systemprofile', 'H')), D('drivers', D('etc', F('hosts', HOSTS), F('lmhosts.sam', LMHOSTS), F('networks', NETWORKS),
        F('protocol', '# Copyright (c) 1993-2006 Microsoft Corp.\r\n#\r\n# This file contains the Internet protocols as defined by RFC 1700\r\n# (Assigned Numbers).\r\n\r\nip       0     IP       # Internet protocol\r\nicmp     1     ICMP     # Internet control message protocol\r\ntcp      6     TCP      # Transmission control protocol\r\nudp      17    UDP      # User datagram protocol\r\n'),
        F('services', '# Copyright (c) 1993-2004 Microsoft Corp.\r\n#\r\n# This file contains port numbers for well-known services defined by IANA\r\n\r\nftp-data          20/tcp                           #FTP, data\r\nftp               21/tcp                           #FTP. control\r\nssh               22/tcp                           #SSH Remote Login Protocol\r\ntelnet            23/tcp\r\nsmtp              25/tcp    mail                   #Simple Mail Transfer Protocol\r\ndomain            53/tcp                           #Domain Name Server\r\ndomain            53/udp                           #Domain Name Server\r\nbootps            67/udp    dhcps                  #Bootstrap Protocol Server\r\nbootpc            68/udp    dhcpc                  #Bootstrap Protocol Client\r\nhttp              80/tcp    www www-http           #World Wide Web\r\nkerberos          88/tcp    krb5 kerberos-sec      #Kerberos\r\nldap             389/tcp                           #Lightweight Directory Access Protocol\r\nhttps            443/tcp    MCom                   #HTTP over TLS/SSL\r\nmicrosoft-ds     445/tcp\r\nms-wbt-server   3389/tcp                           #MS WBT Server\r\n'))),
      D('en-US'), D('GroupPolicy', 'H'), D('LogFiles'), D('spool', D('PRINTERS'), D('drivers')), D('Tasks'), D('wbem'),
      D('WindowsPowerShell', D('v1.0', F('powershell.exe', 455680), F('powershell_ise.exe', 233472), D('Modules'))),
      F('cmd.exe', 323584), F('notepad.exe', 360448), F('mmc.exe', 2125824), F('ServerManager.exe', 1294336), F('taskmgr.exe', 1622016),
      F('ipconfig.exe', 36864), F('ping.exe', 22528), F('nslookup.exe', 98304), F('netsh.exe', 94208), F('net.exe', 61440), F('sc.exe', 73728),
      F('hostname.exe', 13312), F('whoami.exe', 77824), F('systeminfo.exe', 90112), F('gpupdate.exe', 32768), F('shutdown.exe', 28672),
      F('tasklist.exe', 106496), F('robocopy.exe', 135168), F('xcopy.exe', 49152), F('sconfig.cmd', 1311), F('SConfig.ps1', 0),
      F('services.msc', 92745), F('compmgmt.msc', 113256), F('devmgmt.msc', 145059), F('diskmgmt.msc', 47662), F('eventvwr.msc', 145127),
      F('lusrmgr.msc', 144909), F('perfmon.msc', 145313), F('taskschd.msc', 144967), F('WF.msc', 113256), F('certmgr.msc', 63070),
      F('ncpa.cpl', 3584), F('sysdm.cpl', 81920), F('firewall.cpl', 2560), F('appwiz.cpl', 610304), F('timedate.cpl', 75776), F('inetcpl.cpl', 113664),
      F('ntoskrnl.exe', 12500248), F('kernel32.dll', 778240), F('user32.dll', 1830400), F('winlogon.exe', 905216), F('lsass.exe', 89448), F('svchost.exe', 57528));
    return D('',
      D('$Recycle.Bin', 'HS'),
      D('PerfLogs'),
      D('Program Files', D('Common Files'), D('Internet Explorer'), D('ModifiableWindowsApps'), D('Windows Defender'),
        D('Windows Defender Advanced Threat Protection'), D('Windows Mail'), D('Windows Media Player'), D('Windows NT'),
        D('Windows Photo Viewer'), D('WindowsApps', 'H'), D('WindowsPowerShell', D('Modules'), D('Scripts'))),
      D('Program Files (x86)', D('Common Files'), D('Internet Explorer'), D('Microsoft'), D('Windows Defender'), D('Windows Mail'),
        D('Windows Media Player'), D('Windows NT'), D('Windows Photo Viewer'), D('WindowsPowerShell')),
      D('ProgramData', 'H', D('Microsoft'), D('Packages'), D('regid.1991-06.com.microsoft'), D('USOPrivate'), D('USOShared')),
      D('Recovery', 'HS'),
      D('System Volume Information', 'HS'),
      D('Users', profile('Administrator'), D('Default', 'H', D('AppData', 'H'), D('Desktop'), D('Documents'), D('Downloads')),
        D('Public', D('Desktop', 'H'), D('Documents'), D('Downloads'), D('Music'), D('Pictures'), D('Videos'))),
      D('Windows', D('appcompat'), D('apppatch'), D('assembly'), D('Boot'), D('Cursors'), D('debug'), D('Fonts'), D('Globalization'), D('Help'),
        D('IME'), D('INF'), D('Logs'), D('Media'), D('Microsoft.NET'), D('Panther'), D('PolicyDefinitions'), D('Prefetch'), D('Provisioning'),
        D('Registration'), D('Resources'), D('SchCache'), D('schemas'), D('security'), D('ServiceProfiles'), D('servicing'), D('Setup'),
        D('SoftwareDistribution'), D('Speech'), D('System'), sys32, D('SystemApps'), D('SystemResources'), D('SysWOW64'), D('Tasks'), D('Temp'),
        D('tracing'), D('Web', D('Wallpaper', D('Windows', F('img0.jpg', 452168), F('img19.jpg', 391246), F('img20.jpg', 418903), F('img21.jpg', 405517)))), D('WinSxS'),
        F('explorer.exe', 5345280), F('HelpPane.exe', 1068544), F('notepad.exe', 360448), F('regedit.exe', 371712),
        F('win.ini', WIN_INI), F('system.ini', SYSTEM_INI), F('bfsvc.exe', 103936)));
  }
  /** Folders that cannot be deleted or renamed (Access is denied). */
  const PROTECTED = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\users', 'c:\\programdata', 'c:\\users\\administrator', 'c:\\recovery', 'c:\\system volume information', 'c:\\$recycle.bin'];

  WS.store.init('fs', s => { s.fs = { drives: { C: defaultC() } }; });

  /* ---------------- paths ---------------- */
  const ENV = () => ({
    SYSTEMROOT: 'C:\\Windows', WINDIR: 'C:\\Windows', SYSTEMDRIVE: 'C:', PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    PROGRAMDATA: 'C:\\ProgramData', ALLUSERSPROFILE: 'C:\\ProgramData', PUBLIC: 'C:\\Users\\Public', USERNAME: (WS.session && WS.session.user) || 'Administrator',
    USERPROFILE: 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator'), HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\' + ((WS.session && WS.session.user) || 'Administrator'),
    APPDATA: 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator') + '\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator') + '\\AppData\\Local',
    TEMP: 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator') + '\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator') + '\\AppData\\Local\\Temp',
    COMPUTERNAME: WS.sys.name, USERDOMAIN: WS.sys.isDC() ? WS.sys.netbiosDomain() : WS.sys.name, USERDNSDOMAIN: WS.state.system.domain ? WS.state.system.domain.toUpperCase() : undefined,
    LOGONSERVER: '\\\\' + WS.sys.name, OS: 'Windows_NT', NUMBER_OF_PROCESSORS: '4', PROCESSOR_ARCHITECTURE: 'AMD64',
    COMSPEC: 'C:\\Windows\\system32\\cmd.exe', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
    PATH: 'C:\\Windows\\system32;C:\\Windows;C:\\Windows\\System32\\Wbem;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\;C:\\Windows\\System32\\OpenSSH\\'
  });
  /** Expand %VAR% (cmd) style environment variables. */
  const expandEnv = str => String(str).replace(/%([^%]+)%/g, (m, k) => { const v = ENV()[k.toUpperCase()]; return v != null ? v : m; });

  /** parse('..\\x', 'C:\\Users') -> { drive: 'C', parts: ['x'] }  (also accepts / separators) */
  function parse(path, cwd) {
    let p = String(path == null ? '' : path).trim().replace(/\//g, '\\');
    if (/^"(.*)"$/.test(p)) p = p.slice(1, -1);
    p = expandEnv(p);
    let drive, rest;
    const m = p.match(/^([A-Za-z]):(.*)$/);
    const unc = p.match(/^\\\\([^\\]+)(?:\\([^\\]*))?(.*)$/);
    const base = cwd ? parse(cwd) : { drive: 'C', parts: [] };
    if (unc) { drive = `\\\\${unc[1]}\\${unc[2] || ''}`; rest = unc[3] || '\\'; }
    else if (m) {
      drive = m[1].toUpperCase(); rest = m[2];
      if (!rest.startsWith('\\')) { // "C:foo" relative to that drive's cwd: treat as root-relative unless same drive
        rest = (base.drive === drive ? '\\' + base.parts.join('\\') + '\\' : '\\') + rest;
      }
    } else if (p.startsWith('\\')) { drive = base.drive; rest = p; }
    else { drive = base.drive; rest = '\\' + base.parts.join('\\') + '\\' + p; }
    const parts = [];
    for (const seg of rest.split('\\')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { parts.pop(); continue; }
      parts.push(seg.replace(/[. ]+$/, '') || seg);
    }
    return { drive, parts };
  }
  /** C:\dir, or \\server\share\dir for a UNC "drive" (parse() keeps \\server\share in drive). */
  const fmt = ({ drive, parts }) => (drive.length > 1 ? drive + (parts.length ? '\\' + parts.join('\\') : '') : drive + ':\\' + parts.join('\\'));
  /** Canonical full path with the real casing of existing items. */
  function full(path, cwd) {
    const p = parse(path, cwd);
    const out = [];
    let node;
    try { node = root(p.drive); } catch (e) { node = null; }
    if (p.drive.length > 1 && node) { const sh = uncParts(p.drive); const real = WS.smb.get(sh.share); if (real) p.drive = `\\\\${sh.server}\\${real.name}`; }
    for (const seg of p.parts) {
      const c = node && node.type === 'dir' ? node.children[seg.toLowerCase()] : null;
      out.push(c ? c.name : seg); node = c;
    }
    return fmt({ drive: p.drive, parts: out });
  }

  function root(drive) {
    if (drive.length > 1) return remoteRoot(drive);
    const r = WS.state.fs.drives[drive];
    if (!r) {
      const m = mappedDrive(drive);
      if (m) return remoteRoot(m.remote);
      if (WS.storage && WS.storage.isCdrom(drive)) throw new FsError('NotReady', 'The device is not ready.', drive + ':\\');
      throw new FsError('NoDrive', `Cannot find drive. A drive with the name '${drive}' does not exist.`, drive + ':\\');
    }
    return r;
  }
  function walk(path, cwd) {
    const p = parse(path, cwd);
    let node = root(p.drive), parent = null;
    for (let i = 0; i < p.parts.length; i++) {
      if (node.type !== 'dir') return { p, node: null, parent: null, missingParent: true };
      parent = node;
      node = node.children[p.parts[i].toLowerCase()];
      if (!node) return { p, node: null, parent: i === p.parts.length - 1 ? parent : null, missingParent: i < p.parts.length - 1 };
    }
    return { p, node, parent };
  }
  const INVALID = /[<>:"/\\|?*\x00-\x1f]/;
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  function checkName(name) {
    if (!name || INVALID.test(name) || RESERVED.test(name) || /^\.+$/.test(name)) throw new FsError('InvalidName', 'The filename, directory name, or volume label syntax is incorrect.', name);
  }
  const isProtected = (p) => PROTECTED.includes(fmt(p).toLowerCase());
  const touch = node => { node.modified = new Date().toISOString(); };
  const notFound = (p, file) => new FsError(file ? 'NotFound' : 'PathNotFound', `Cannot find path '${fmt(p)}' because it does not exist.`, fmt(p));
  const changed = () => WS.store.changed('fs');

  function sizeOf(node) {
    if (node.type === 'file') return node.size != null ? node.size : node.content != null ? new Blob([node.content]).size : 0;
    return Object.values(node.children).reduce((a, c) => a + sizeOf(c), 0);
  }
  function info(node, path) {
    const created = node.created || WS.state.system.installDate;
    return { type: node.type, name: node.name || path, path, size: node.type === 'file' ? sizeOf(node) : 0, created, modified: node.modified || created,
      attrs: node.attrs || '', hidden: /H/.test(node.attrs || ''), system: /S/.test(node.attrs || ''), readOnly: /R/.test(node.attrs || ''),
      extension: node.type === 'file' && node.name.includes('.') ? node.name.slice(node.name.lastIndexOf('.')) : '' };
  }

  function stat(path, cwd) {
    try { const w = walk(path, cwd); return w.node ? info(w.node, full(path, cwd)) : null; }
    catch (e) { if (e instanceof FsError) return null; throw e; }
  }
  function list(path, cwd, opts = {}) {
    const w = walk(path, cwd);
    if (!w.node) throw notFound(w.p);
    if (w.node.type !== 'dir') return [info(w.node, fmt(w.p))];
    const base = full(path, cwd).replace(/\\$/, '');
    return Object.values(w.node.children)
      .filter(c => opts.hidden || !/H/.test(c.attrs || ''))
      .map(c => info(c, base + '\\' + c.name))
      .sort((a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  /** mkdir creates missing parents (New-Item -ItemType Directory and cmd's md both do). */
  function mkdir(path, cwd, opts = {}) {
    const p = parse(path, cwd);
    let node = root(p.drive);
    let created = false;
    for (let i = 0; i < p.parts.length; i++) {
      const seg = p.parts[i];
      let next = node.children[seg.toLowerCase()];
      if (!next) {
        checkName(seg);
        next = node.children[seg.toLowerCase()] = { type: 'dir', name: seg, children: {}, created: new Date().toISOString() };
        touch(node); created = true;
      } else if (next.type !== 'dir') throw new FsError('Exists', `An item with the specified name ${fmt({ drive: p.drive, parts: p.parts.slice(0, i + 1) })} already exists.`, fmt(p));
      node = next;
    }
    if (!created && !opts.existOk) throw new FsError('Exists', `An item with the specified name ${full(path, cwd)} already exists.`, fmt(p));
    changed();
    return info(node, full(path, cwd));
  }
  function readFile(path, cwd) {
    const w = walk(path, cwd);
    if (!w.node) throw notFound(w.p, true);
    if (w.node.type === 'dir') throw new FsError('IsADirectory', `Access to the path '${fmt(w.p)}' is denied.`, fmt(w.p));
    return w.node.content != null ? w.node.content : '';
  }
  /** writeFile(path, text, cwd, { append, noClobber, size }) - the parent folder must exist. */
  function writeFile(path, text, cwd, opts = {}) {
    const w = walk(path, cwd);
    if (w.missingParent || !w.parent && !w.node) throw new FsError('PathNotFound', `Could not find a part of the path '${fmt(w.p)}'.`, fmt(w.p));
    if (w.node && w.node.type === 'dir') throw new FsError('IsADirectory', `Access to the path '${fmt(w.p)}' is denied.`, fmt(w.p));
    if (w.node && opts.noClobber) throw new FsError('Exists', `The file '${fmt(w.p)}' already exists.`, fmt(w.p));
    if (w.node && /R/.test(w.node.attrs || '')) throw new FsError('AccessDenied', `Access to the path '${fmt(w.p)}' is denied.`, fmt(w.p));
    let node = w.node;
    if (!node) {
      const name = w.p.parts[w.p.parts.length - 1];
      checkName(name);
      node = w.parent.children[name.toLowerCase()] = { type: 'file', name, content: '', created: new Date().toISOString() };
      touch(w.parent);
    }
    node.content = opts.append ? (node.content != null ? node.content : '') + text : String(text);
    delete node.size;
    if (opts.size) node.size = opts.size; // a stand-in file whose real size is larger than its text (memory dumps)
    touch(node);
    changed();
    return info(node, full(path, cwd));
  }
  function remove(path, cwd, opts = {}) {
    const w = walk(path, cwd);
    if (!w.node) throw notFound(w.p, true);
    if (!w.p.parts.length || isProtected(w.p) || /S/.test(w.node.attrs || '')) throw new FsError('AccessDenied', `Access to the path '${fmt(w.p)}' is denied.`, fmt(w.p));
    if (w.node.type === 'dir' && Object.keys(w.node.children).length && !opts.recursive) throw new FsError('NotEmpty', `The directory is not empty.`, fmt(w.p));
    delete w.parent.children[w.p.parts[w.p.parts.length - 1].toLowerCase()];
    touch(w.parent);
    changed();
  }

  /* ---------------- Recycle Bin (Explorer's Delete; Remove-Item and del still delete permanently, as on Windows) ---------------- */
  const bin = () => (WS.state.fs.recycle = WS.state.fs.recycle || []);
  function recycle(path, cwd) {
    const w = walk(path, cwd);
    if (!w.node) throw notFound(w.p, true);
    if (!w.p.parts.length || isProtected(w.p) || /S/.test(w.node.attrs || '')) throw new FsError('AccessDenied', `Access to the path '${fmt(w.p)}' is denied.`, fmt(w.p));
    const origin = fmt({ drive: w.p.drive, parts: w.p.parts.slice(0, -1) });
    const item = { id: U.guid(), name: w.node.name, origin, type: w.node.type, size: sizeOf(w.node), deleted: new Date().toISOString(), node: w.node };
    bin().push(item);
    delete w.parent.children[w.p.parts[w.p.parts.length - 1].toLowerCase()];
    touch(w.parent);
    changed();
    return item;
  }
  /** Restore to the original location (re-creating missing folders); a name now in use there throws Exists. */
  function restore(id) {
    const item = bin().find(x => x.id === id);
    if (!item) throw new FsError('NotFound', 'The item is no longer in the Recycle Bin.', id);
    const target = (item.origin.endsWith('\\') ? item.origin : item.origin + '\\') + item.name;
    if (stat(target)) throw new FsError('Exists', `There is already a file or folder with the name "${item.name}" in ${item.origin}.`, target);
    if (!/^[A-Z]:\\?$/i.test(item.origin)) mkdir(item.origin, null, { existOk: true });
    const w = walk(item.origin);
    w.node.children[item.name.toLowerCase()] = item.node;
    touch(w.node);
    WS.state.fs.recycle = bin().filter(x => x !== item);
    changed();
    return target;
  }
  function emptyRecycle(ids) {
    WS.state.fs.recycle = ids ? bin().filter(x => !ids.includes(x.id)) : [];
    changed();
  }
  function rename(path, newName, cwd) {
    const w = walk(path, cwd);
    if (!w.node) throw notFound(w.p, true);
    if (!w.p.parts.length || isProtected(w.p)) throw new FsError('AccessDenied', `Access to the path '${fmt(w.p)}' is denied.`, fmt(w.p));
    checkName(newName);
    const key = w.p.parts[w.p.parts.length - 1].toLowerCase();
    if (newName.toLowerCase() !== key && w.parent.children[newName.toLowerCase()]) throw new FsError('Exists', `Cannot create a file when that file already exists.`, newName);
    delete w.parent.children[key];
    w.node.name = newName;
    w.parent.children[newName.toLowerCase()] = w.node;
    touch(w.parent);
    changed();
  }
  /** copy/move: dst may be an existing folder (item goes inside it) or a new path. */
  function transfer(src, dst, cwd, move, opts = {}) {
    const s = walk(src, cwd);
    if (!s.node) throw notFound(s.p, true);
    if (move && (isProtected(s.p) || !s.p.parts.length)) throw new FsError('AccessDenied', `Access to the path '${fmt(s.p)}' is denied.`, fmt(s.p));
    if (s.node.type === 'dir' && !move && !opts.recursive && Object.keys(s.node.children).length) opts.shallow = true;
    let d = walk(dst, cwd);
    let parent, name;
    if (d.node && d.node.type === 'dir') { parent = d.node; name = s.node.name; }
    else if (d.parent) { parent = d.parent; name = d.p.parts[d.p.parts.length - 1]; }
    else throw new FsError('PathNotFound', `Could not find a part of the path '${fmt(d.p)}'.`, fmt(d.p));
    checkName(name);
    const srcFull = fmt(s.p).toLowerCase();
    if (s.node.type === 'dir' && (fmt(d.p).toLowerCase() + '\\').startsWith(srcFull + '\\')) throw new FsError('InvalidName', 'The destination folder is a subfolder of the source folder.', fmt(d.p));
    const existing = parent.children[name.toLowerCase()];
    if (existing && existing === s.node) return;
    if (existing && !opts.force) throw new FsError('Exists', `An item with the specified name ${fmt(d.p)}${d.node && d.node.type === 'dir' ? '\\' + name : ''} already exists.`, name);
    const clone = U.deepClone(s.node);
    clone.name = name;
    if (opts.shallow) clone.children = {};
    if (!move) { clone.created = new Date().toISOString(); }
    parent.children[name.toLowerCase()] = clone;
    touch(parent);
    if (move) { delete s.parent.children[s.p.parts[s.p.parts.length - 1].toLowerCase()]; touch(s.parent); }
    changed();
  }
  function setAttrs(path, attrs, cwd) {
    const w = walk(path, cwd);
    if (!w.node) throw notFound(w.p, true);
    w.node.attrs = [...new Set(String(attrs).toUpperCase().replace(/[^HSRA]/g, ''))].join('');
    changed();
  }

  /** Called by WS.storage when a volume is formatted or gets a letter. */
  function createDrive(letter) {
    WS.state.fs.drives[letter] = D('', D('System Volume Information', 'HS'), D('$RECYCLE.BIN', 'HS'));
    changed();
  }
  function moveDrive(from, to) { const d = WS.state.fs.drives; d[to] = d[from]; delete d[from]; changed(); }
  function removeDrive(letter) { delete WS.state.fs.drives[letter]; changed(); }

  WS.fs = {
    Error: FsError, parse, full, format: fmt, expandEnv, env: ENV, stat, exists: (p, cwd) => !!stat(p, cwd), isDir: (p, cwd) => { const s = stat(p, cwd); return !!s && s.type === 'dir'; },
    list, mkdir, readFile, writeFile, remove, rename, copy: (s, d, cwd, o) => transfer(s, d, cwd, false, o), move: (s, d, cwd, o) => transfer(s, d, cwd, true, o),
    setAttrs, du: (path, cwd) => { const w = walk(path, cwd); return w.node ? sizeOf(w.node) : 0; },
    drives: () => Object.keys(WS.state.fs.drives).sort(),
    /** A local volume or a mapped network drive (cd, Set-Location, Explorer). */
    hasDrive: l => !!WS.state.fs.drives[String(l).toUpperCase()] || !!mappedDrive(String(l).toUpperCase()),
    createDrive, moveDrive, removeDrive,
    recycle, restore, emptyRecycle, recycleBin: () => bin().map(({ node, ...x }) => x),
    /** Used by models (IIS, AD DS) to lay down folders/files without caring whether they exist. */
    ensureDir: path => mkdir(path, null, { existOk: true }),
    ensureFile: (path, text) => { if (!stat(path)) { mkdir(path.replace(/\\[^\\]+$/, ''), null, { existOk: true }); writeFile(path, text); } }
  };

  /* ================================================================ SMB shares */
  WS.store.init('smb', s => {
    s.smb = { shares: [
      { name: 'ADMIN$', path: 'C:\\Windows', description: 'Remote Admin', special: true, access: [] },
      { name: 'C$', path: 'C:\\', description: 'Default share', special: true, access: [] },
      { name: 'IPC$', path: '', description: 'Remote IPC', special: true, access: [] }
    ] };
  });
  const SH = () => WS.state.smb.shares;
  const ieq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const RIGHTS = ['Full', 'Change', 'Read'];
  const findShare = name => SH().find(s => ieq(s.name, name)) || null;

  /** newShare({ name, path, description, fullAccess[], changeAccess[], readAccess[], noAccess[] | access[], folderEnumerationMode, cachingMode, concurrentUserLimit (0 = maximum), encryptData }) */
  function newShare(o) {
    const name = String(o.name || '').trim();
    if (!name || name.length > 80 || /[\\/[\]:|<>+=;,?*"]/.test(name)) return { ok: false, error: 'The share name contains invalid characters.' };
    if (findShare(name)) return { ok: false, code: 'Exists', error: 'The name has already been shared.' };
    const st = stat(o.path);
    if (!st) return { ok: false, code: 'PathNotFound', error: 'The system cannot find the file specified.' };
    if (st.type !== 'dir') return { ok: false, error: 'The device or directory does not exist.' };
    // o.access (the GUI permission editors) gives the full list: [{ account, right, type }]
    const access = (o.access || []).map(e => ({ account: e.account, right: RIGHTS.find(x => ieq(x, e.right)) || 'Read', type: ieq(e.type || 'Allow', 'Deny') ? 'Deny' : 'Allow' }));
    for (const [key, right] of [['fullAccess', 'Full'], ['changeAccess', 'Change'], ['readAccess', 'Read']]) for (const a of [].concat(o[key] || [])) access.push({ account: a, right, type: 'Allow' });
    for (const a of [].concat(o.noAccess || [])) access.push({ account: a, right: 'Full', type: 'Deny' });
    if (!access.length) access.push({ account: 'Everyone', right: 'Read', type: 'Allow' });
    const share = { name, path: st.path, description: o.description || '', special: false, access, folderEnumerationMode: o.folderEnumerationMode || 'Unrestricted', cachingMode: o.cachingMode || 'Manual', concurrentUserLimit: +o.concurrentUserLimit || 0, encryptData: !!o.encryptData, created: new Date().toISOString() };
    SH().push(share);
    if (!WS.features.isInstalled('FS-FileServer')) WS.features.install(['FS-FileServer']);
    WS.store.changed('smb');
    return { ok: true, share };
  }
  function removeShare(name) {
    const s = findShare(name);
    if (!s) return { ok: false, code: 'NotFound', error: `No MSFT_SMBShare objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
    if (s.name === 'IPC$' || (WS.sys.isDC() && ['SYSVOL', 'NETLOGON'].includes(s.name.toUpperCase()))) return { ok: false, error: 'Access is denied.' };
    WS.state.smb.shares = SH().filter(x => x !== s);
    WS.store.changed('smb');
    return { ok: true };
  }
  function setShare(name, props) {
    const s = findShare(name);
    if (!s) return { ok: false, code: 'NotFound', error: `No MSFT_SMBShare objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
    for (const k of ['description', 'folderEnumerationMode', 'cachingMode', 'concurrentUserLimit', 'encryptData']) if (k in props) s[k] = props[k];
    WS.store.changed('smb');
    return { ok: true };
  }
  /** Replace a share's whole permission list (the Share Permissions editor): [{ account, right: Full|Change|Read, type: Allow|Deny }]. */
  function setAccess(name, entries) {
    const s = findShare(name);
    if (!s) return { ok: false, code: 'NotFound', error: `No MSFT_SMBShare objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
    if (s.special) return { ok: false, error: 'This has been shared for administrative purposes. The permissions cannot be set.' };
    const out = [];
    for (const e of entries || []) {
      const right = RIGHTS.find(x => ieq(x, e.right)), type = ['Allow', 'Deny'].find(x => ieq(x, e.type || 'Allow'));
      if (!e.account || !right || !type) return { ok: false, error: 'The parameter is incorrect.' };
      out.push({ account: e.account, right, type });
    }
    s.access = out;
    WS.store.changed('smb');
    return { ok: true };
  }
  /** Grant-SmbShareAccess: replaces any existing Allow entry for that account. */
  function grantAccess(name, account, right) {
    const s = findShare(name);
    if (!s) return { ok: false, code: 'NotFound', error: `No MSFT_SMBShare objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
    const r = RIGHTS.find(x => ieq(x, right));
    if (!r) return { ok: false, error: `Cannot bind parameter 'AccessRight'. Cannot convert value "${right}" to type "Microsoft.PowerShell.Cmdletization.GeneratedTypes.SmbShare.ShareAccessRight". Specify one of the following enumerator names and try again: Full, Change, Read, Custom` };
    s.access = s.access.filter(a => !(ieq(a.account, account) && a.type === 'Allow'));
    s.access.push({ account, right: r, type: 'Allow' });
    WS.store.changed('smb');
    return { ok: true };
  }
  function revokeAccess(name, account) {
    const s = findShare(name);
    if (!s) return { ok: false, code: 'NotFound', error: `No MSFT_SMBShare objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
    s.access = s.access.filter(a => !ieq(a.account, account));
    WS.store.changed('smb');
    return { ok: true };
  }
  function blockAccess(name, account) {
    const s = findShare(name);
    if (!s) return { ok: false, code: 'NotFound', error: `No MSFT_SMBShare objects found with property 'Name' equal to '${name}'. Verify the value of the property and retry.` };
    s.access = s.access.filter(a => !(ieq(a.account, account) && a.type === 'Deny'));
    s.access.push({ account, right: 'Full', type: 'Deny' });
    WS.store.changed('smb');
    return { ok: true };
  }

  WS.smb = {
    shares: () => SH().slice().sort((a, b) => a.name.localeCompare(b.name)),
    get: findShare, newShare, removeShare, setShare, setAccess, grantAccess, revokeAccess, blockAccess, RIGHTS,
    sharesFor: path => SH().filter(s => s.path && ieq(s.path.replace(/\\$/, ''), full(path).replace(/\\$/, '')))
  };

  /* ================================================================ network paths and mapped drives */
  WS.store.init('netuse', s => { s.netuse = { drives: [], remember: true }; });
  const NU = () => WS.state.netuse;
  // SMB errors: Win32 code (net use's "System error N"), HRESULT (Group Policy Preferences) and text
  const NETERR = {
    NetPath: { sys: 53, hr: '0x80070035', error: 'The network path was not found.' },
    NetName: { sys: 67, hr: '0x80070043', error: 'The network name cannot be found.' },
    InUse: { sys: 85, hr: '0x80070055', error: 'The local device name is already in use.' },
    NotFound: { sys: 2250, hr: '0x800708CA', error: 'The network connection could not be found.' },
    BadDevice: { sys: 1200, hr: '0x800704B0', error: 'The specified device name is invalid.' }
  };
  const netFail = code => ({ ok: false, code, ...NETERR[code] });
  /** '\\\\DC01\\Sales\\Team' -> { server: 'DC01', share: 'Sales', rest: ['Team'] } (null when it is not \\server\share). */
  function uncParts(remote) {
    const m = String(remote || '').trim().replace(/\//g, '\\').match(/^\\\\([^\\]+)\\([^\\]+)\\?(.*)$/);
    return m ? { server: m[1], share: m[2], rest: m[3].split('\\').filter(Boolean) } : null;
  }
  /** This server under any of its names: DC01, DC01.contoso.local, localhost, its addresses, or a name DNS resolves to it (contoso.local). */
  function isLocalServer(server) {
    const r = WS.net && WS.net.resolve ? WS.net.resolve(server) : { ok: ieq(server, WS.sys.name) };
    if (!r.ok) return false;
    return r.source === 'local' || /^127\./.test(r.ip || '') || r.ip === '::1' || (WS.net.ownIps ? WS.net.ownIps().includes(r.ip) : false);
  }
  /** resolveUnc('\\\\DC01\\Sales\\Team') -> { ok, path (local), share } or { ok: false, code: 'NetPath' | 'NetName', sys, hr, error } */
  function resolveUnc(remote) {
    const u = uncParts(remote);
    if (!u) return netFail('NetName');
    if (!isLocalServer(u.server)) return netFail(WS.net && WS.net.resolve(u.server).ok ? 'NetName' : 'NetPath');
    if (WS.svc && WS.svc.get('LanmanServer') && !WS.svc.isRunning('LanmanServer')) return netFail('NetPath');
    const share = findShare(u.share);
    if (!share || !share.path) return netFail('NetName');
    return { ok: true, share, server: u.server, path: share.path.replace(/\\$/, '') + (u.rest.length ? '\\' + u.rest.join('\\') : '') };
  }
  function remoteRoot(remote) {
    const r = resolveUnc(remote);
    if (!r.ok) throw new FsError(r.code, r.error, remote);
    const w = walk(r.path);
    if (!w.node || w.node.type !== 'dir') throw new FsError('NetName', NETERR.NetName.error, remote);
    return w.node;
  }
  function mappedDrive(letter) { const st = WS.state.netuse; return st ? st.drives.find(d => d.letter === letter) || null : null; }
  const letterTaken = l => !!WS.state.fs.drives[l] || (WS.storage && WS.storage.isCdrom(l)) || !!mappedDrive(l);
  /** connect(letter | '*' | null, remote, { persistent, label, hidden, source: 'user' | 'gpp', gpo, uid, from: first letter for '*' going up })
   *  '*' picks the highest free letter (net use *), or with o.from the first free one from that letter up (Drive Maps). */
  function connect(letter, remote, o = {}) {
    const u = uncParts(remote);
    if (!u) return netFail('NetName');
    let l = letter == null ? null : String(letter).replace(/:$/, '').toUpperCase();
    if (l === '*') {
      const all = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      l = (o.from ? all.filter(x => x >= String(o.from).toUpperCase()) : all.reverse()).find(x => !letterTaken(x)) || null;
      if (!l) return { ok: false, code: 'NoLetter', sys: 1223, hr: '0x800704C7', error: 'There are no more drive letters available.' };
    }
    if (l != null && !/^[A-Z]$/.test(l)) return netFail('BadDevice');
    if (l && letterTaken(l)) return netFail('InUse');
    const r = resolveUnc(remote);
    if (!r.ok) return r;
    const remoteText = `\\\\${u.server}\\${r.share.name}${u.rest.length ? '\\' + u.rest.join('\\') : ''}`;
    if (!l) return { ok: true, letter: null, remote: remoteText };   // a deviceless connection (net use \\server\share) checks the path only
    const d = { letter: l, remote: remoteText, label: o.label || '', persistent: o.persistent != null ? !!o.persistent : NU().remember, hidden: !!o.hidden,
      source: o.source || 'user', gpo: o.gpo || null, uid: o.uid || null, psOnly: !!o.psOnly, created: new Date().toISOString() };
    NU().drives.push(d);
    NU().drives.sort((a, b) => a.letter.localeCompare(b.letter));
    WS.store.changed('netuse');
    return { ok: true, letter: l, drive: d };
  }
  function disconnect(letter) {
    const l = String(letter || '').replace(/:$/, '').toUpperCase();
    const d = mappedDrive(l);
    if (!d) return netFail('NotFound');
    NU().drives = NU().drives.filter(x => x !== d);
    WS.store.changed('netuse');
    return { ok: true, drive: d };
  }
  function updateDrive(letter, props) {
    const d = mappedDrive(String(letter || '').replace(/:$/, '').toUpperCase());
    if (!d) return netFail('NotFound');
    for (const k of ['label', 'persistent', 'hidden', 'source', 'gpo', 'uid']) if (k in props) d[k] = props[k];
    WS.store.changed('netuse');
    return { ok: true, drive: d };
  }
  /** 'OK' while the share answers, 'Unavailable' once it is gone (net use's Status column). */
  const driveStatus = d => (resolveUnc(d.remote).ok ? 'OK' : 'Unavailable');
  /** Explorer's name for a mapped drive: "Sales (\\\\DC01) (S:)", or "<label> (S:)" when one was given. */
  function driveName(d) {
    const u = uncParts(d.remote);
    const tail = u.rest.length ? u.rest[u.rest.length - 1] : u.share;
    const parent = u.rest.length ? `\\\\${u.server}\\${[u.share, ...u.rest.slice(0, -1)].join('\\')}` : `\\\\${u.server}`;
    return `${d.label || `${tail} (${parent})`} (${d.letter}:)`;
  }
  // non-persistent connections end with the session; remembered ones come back at the next sign-in
  const dropSession = () => { if (NU().drives.some(d => !d.persistent)) { NU().drives = NU().drives.filter(d => d.persistent); WS.store.changed('netuse'); } };
  WS.sys.on('boot', dropSession);

  WS.netuse = {
    /** Mapped drives; o.all includes New-PSDrive drives without -Persist (PowerShell sees them, net use and Explorer do not). */
    list: (o = {}) => NU().drives.filter(d => o.all || !d.psOnly), get: l => mappedDrive(String(l || '').replace(/:$/, '').toUpperCase()), connect, disconnect, update: updateDrive,
    status: driveStatus, displayName: driveName, onLogoff: dropSession, resolveUnc, uncParts, isLocalServer, errors: NETERR,
    get remember() { return NU().remember; }, setRemember(on) { NU().remember = !!on; WS.store.changed('netuse'); }
  };

  // the File Server role service opens the SMB firewall rules
  WS.features.on('install', id => { if (id === 'FS-FileServer' && WS.fw) WS.fw.setGroupEnabled('File and Printer Sharing', true); });
  /* Web Server (IIS) lays down C:\inetpub with the default page that Edge shows at http://localhost (an original page, not Microsoft's). */
  const IISSTART = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\r\n<html xmlns="http://www.w3.org/1999/xhtml">\r\n<head>\r\n<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />\r\n<title>IIS Windows Server</title>\r\n<style type="text/css">\r\nbody { color:#000000; background-color:#0072C6; margin:0; font-family:"Segoe UI",sans-serif; }\r\n#container { margin-left:auto; margin-right:auto; text-align:center; padding-top:120px; }\r\nh1 { color:#ffffff; font-weight:300; font-size:64px; margin:0; }\r\np { color:#cde6fb; font-size:22px; letter-spacing:.3em; }\r\n.words { color:#9fd0f7; font-size:15px; line-height:2; }\r\n</style>\r\n</head>\r\n<body>\r\n<div id="container">\r\n<h1>Internet Information Services</h1>\r\n<p>WELCOME</p>\r\n<div class="words">Welcome &middot; Bienvenue &middot; Willkommen &middot; Bienvenido &middot; Benvenuto &middot; Welkom &middot; V&auml;lkommen &middot; Witamy &middot; Bem-vindo</div>\r\n</div>\r\n</body>\r\n</html>';
  function ensureInetpub() {
    for (const d of ['C:\\inetpub\\wwwroot', 'C:\\inetpub\\logs\\LogFiles', 'C:\\inetpub\\temp', 'C:\\inetpub\\custerr\\en-US', 'C:\\inetpub\\history']) mkdir(d, null, { existOk: true });
    if (!stat('C:\\inetpub\\wwwroot\\iisstart.htm')) writeFile('C:\\inetpub\\wwwroot\\iisstart.htm', IISSTART);
    if (!stat('C:\\inetpub\\wwwroot\\iisstart.png')) writeFile('C:\\inetpub\\wwwroot\\iisstart.png', '', null, { size: 98757 });
  }
  WS.features.on('install', id => { if (id === 'Web-Server') ensureInetpub(); });
  WS.sys.on('boot', () => { if (WS.features.isInstalled('Web-Server')) ensureInetpub(); });
})();
