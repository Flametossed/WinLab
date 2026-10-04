/* PowerShell runtime: values, evaluator, parameter binding, errors, sessions.
 *
 * Cmdlets register with WS.ps.cmdlet(def):
 *   { name, module, version, cls, feature (only exists while that feature is installed), shouldProcess, impact,
 *     params: { Name: { type, pos, mandatory, pipe: 'value'|'name'|'both', alias: [], values: [], enumType, dflt } },
 *     begin(ctx, p), process(ctx, p, item), end(ctx, p), synopsis }
 *   types: string, string[], int, int[], long, double, bool, switch, object, object[], scriptblock, hashtable,
 *          securestring, datetime, enum (with values)
 *   ctx: out(v), error(rec), throw(rec), warn(t), verbose(t), host(text, style), progress(p), confirm(action, target, o),
 *        prompt(label, o), invokeBlock(sb, {under, args}), session, scope, cmdlet name, params.
 * Error records: { message, category, target, targetType, exception, id } -> printed in PowerShell 5.1 format.
 * A session (WS.ps.Session) runs a REPL on a console (WS.term.Console / TextConsole). */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;
  const PS = WS.ps;

  /* ================================================================ values */
  class PSHashtable {
    constructor(entries) { this.m = new Map(); if (entries) for (const [k, v] of entries) this.set(k, v); }
    set(k, v) { this.m.set(String(k).toLowerCase(), [k, v]); }
    get(k) { const e = this.m.get(String(k).toLowerCase()); return e ? e[1] : null; }
    has(k) { return this.m.has(String(k).toLowerCase()); }
    delete(k) { this.m.delete(String(k).toLowerCase()); }
    keys() { return [...this.m.values()].map(e => e[0]); }
    values() { return [...this.m.values()].map(e => e[1]); }
    entries() { return [...this.m.values()]; }
    get size() { return this.m.size; }
  }
  class ScriptBlock {
    constructor(node, session) { this.node = node; this.session = session; }
    toString() { return this.node.text; }
  }
  class SecureString {
    constructor(v) { Object.defineProperty(this, 'value', { value: String(v), enumerable: false }); }
    get Length() { return this.value.length; }
    toString() { return 'System.Security.SecureString'; }
  }
  class TypeRef { constructor(name) { this.name = name; } toString() { return this.name; } }

  /** Build a typed PowerShell object. o.str: ToString text or function; o.methods: { Name(args) };
   * o.setters: { Name(value) } for writable properties backed by a model (a thrown Error becomes the exception text). */
  function psobj(type, props, o = {}) {
    const obj = Object.assign({}, props);
    Object.defineProperty(obj, '__type', { value: type });
    if (o.str !== undefined) Object.defineProperty(obj, '__str', { value: o.str });
    if (o.methods) Object.defineProperty(obj, '__methods', { value: o.methods });
    if (o.hidden) Object.defineProperty(obj, '__hidden', { value: o.hidden });
    if (o.setters) Object.defineProperty(obj, '__setters', { value: o.setters });
    return obj;
  }
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PSHashtable) && !(v instanceof Date) && !(v instanceof ScriptBlock) && !(v instanceof SecureString) && !(v instanceof TypeRef);

  function typeName(v) {
    if (v == null) return null;
    if (typeof v === 'string') return 'System.String';
    if (typeof v === 'number') return Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? 'System.Int64' : 'System.Int32') : 'System.Double';
    if (typeof v === 'boolean') return 'System.Boolean';
    if (Array.isArray(v)) return 'System.Object[]';
    if (v instanceof PSHashtable) return 'System.Collections.Hashtable';
    if (v instanceof ScriptBlock) return 'System.Management.Automation.ScriptBlock';
    if (v instanceof SecureString) return 'System.Security.SecureString';
    if (v instanceof Date) return 'System.DateTime';
    if (v instanceof TypeRef) return 'System.RuntimeType';
    return v.__type || 'System.Management.Automation.PSCustomObject';
  }
  const shortType = v => (typeName(v) || 'Object').replace(/^.*[.#/]/, '');

  function fmtDateTime(d) { return `${U.fmtDate(d)} ${U.fmtTime(d, true)}`; }
  function toStr(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
    if (Array.isArray(v)) return v.map(toStr).join(' ');
    if (v instanceof Date) return fmtDateTime(v);
    if (v instanceof PSHashtable) return 'System.Collections.Hashtable';
    if (v instanceof ScriptBlock || v instanceof SecureString || v instanceof TypeRef) return v.toString();
    if (v.__str !== undefined) return typeof v.__str === 'function' ? v.__str() : v.__str;
    if (!v.__type || v.__type === 'System.Management.Automation.PSCustomObject') return '@{' + Object.keys(v).map(k => `${k}=${toStr(v[k])}`).join('; ') + '}';
    return v.__type;
  }
  function toBool(v) {
    if (v == null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length === 0 ? false : v.length === 1 ? toBool(v[0]) : true;
    return true;
  }
  const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const unwrap = arr => (arr.length === 0 ? null : arr.length === 1 ? arr[0] : arr);
  function toNum(v, typeLabel = 'System.Int32') {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v == null || v === '') return 0;
    const s = toStr(v).trim();
    const n = PS.NUM_RE.test(s) ? PS.toNumber(s) : /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
    if (isNaN(n)) throw rtError(`Cannot convert value "${toStr(v)}" to type "${typeLabel}". Error: "Input string was not in a correct format."`, { category: 'InvalidArgument', id: 'InvalidCastFromStringToInteger' });
    return n;
  }

  /* ================================================================ errors */
  class ErrorRecord {
    constructor(o) {
      this.message = o.message;
      this.category = o.category || 'NotSpecified';
      this.target = o.target == null ? '' : String(o.target);
      this.targetType = o.targetType || (o.target != null && o.target !== '' ? 'String' : '');
      this.exception = o.exception || 'RuntimeException';
      this.id = o.id || o.exception || 'RuntimeException';
      this.activity = o.activity || '';
      this.pos = o.pos || null;
      this.parse = !!o.parse;
      this.Exception = psobj('System.' + this.exception, { Message: this.message }, { str: this.message });
      this.CategoryInfo = psobj('System.Management.Automation.ErrorCategoryInfo', { Category: this.category, Activity: this.activity, Reason: this.exception, TargetName: this.target, TargetType: this.targetType },
        { str: () => this.categoryText() });
      this.FullyQualifiedErrorId = this.id;
      this.TargetObject = o.target == null ? null : o.target;
      Object.defineProperty(this, '__type', { value: 'System.Management.Automation.ErrorRecord' });
      Object.defineProperty(this, '__str', { value: this.message });
    }
    categoryText() { return `${this.category}: (${this.target}:${this.targetType}) [${this.activity}], ${this.exception}`; }
  }
  class PSRuntimeError extends Error { constructor(record) { super(record.message); this.record = record; } }
  class FlowSignal { constructor(kind, value) { this.kind = kind; this.value = value; } }
  class PipelineStopped extends Error { constructor() { super('The pipeline has been stopped.'); } }
  function rtError(message, o = {}) { return new PSRuntimeError(new ErrorRecord({ message, ...o })); }

  /** "At line:1 char:5 / + text / + ~~~~" block. */
  function positionLines(pos) {
    if (!pos || pos.src == null) return [];
    const src = pos.src;
    const before = src.slice(0, pos.start);
    const line = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineEnd = src.indexOf('\n', pos.start) < 0 ? src.length : src.indexOf('\n', pos.start);
    const col = pos.start - lineStart + 1;
    const text = src.slice(lineStart, lineEnd);
    const len = Math.max(1, Math.min(pos.end == null ? 1 : pos.end, lineEnd) - pos.start);
    return [`At ${pos.file ? pos.file + ':' + line : 'line:' + line} char:${col}`, '+ ' + text, '+ ' + ' '.repeat(col - 1) + '~'.repeat(len)];
  }
  function formatError(rec) {
    const lines = [];
    if (rec.parse) {
      lines.push(...positionLines(rec.pos), rec.message);
    } else {
      lines.push((rec.activity ? rec.activity + ' : ' : '') + rec.message, ...positionLines(rec.pos));
    }
    lines.push(`    + CategoryInfo          : ${rec.categoryText()}`);
    lines.push(`    + FullyQualifiedErrorId : ${rec.id}`);
    lines.push(' ');
    return lines.join('\n');
  }

  /* ================================================================ operators */
  function wildcardRe(p, cs) {
    const re = String(p).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + re + '$', cs ? '' : 'i');
  }
  function eq(a, b, cs) {
    if (a == null || b == null) return a == null && b == null;
    if (typeof a === 'number') { const n = typeof b === 'number' ? b : Number(toStr(b).trim()); return toStr(b).trim() !== '' && n === a; }
    if (typeof a === 'boolean') return toBool(b) === a;
    if (typeof a === 'string') return cs ? a === toStr(b) : a.toLowerCase() === toStr(b).toLowerCase();
    if (a instanceof Date) return b instanceof Date ? a.getTime() === b.getTime() : false;
    return a === b;
  }
  function cmp(a, b) {
    if (typeof a === 'number') return a - toNum(b, 'System.Double');
    if (a instanceof Date) return a.getTime() - (b instanceof Date ? b : new Date(toStr(b))).getTime();
    if (a == null) return b == null ? 0 : -1;
    return toStr(a).localeCompare(toStr(b), undefined, { sensitivity: 'base' });
  }
  function formatOp(fmt, args) {
    args = toArray(args);
    return String(fmt).replace(/\{(\d+)(?:,(-?\d+))?(?::([^}]+))?\}/g, (m, i, w, f) => {
      let v = args[+i];
      let s;
      if (f && typeof v === 'number') {
        const fm = f.match(/^([NnFfDdPpXx])(\d*)$/);
        if (fm) {
          const d = fm[2] === '' ? (/[Nn]|[Ff]|[Pp]/.test(fm[1]) ? 2 : 0) : +fm[2];
          const k = fm[1].toUpperCase();
          s = k === 'N' ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : k === 'F' ? v.toFixed(d) : k === 'D' ? String(Math.trunc(v)).padStart(d, '0') : k === 'P' ? (v * 100).toFixed(d) + ' %' : Math.trunc(v).toString(16).toUpperCase().padStart(d, '0');
        } else if (/^0+(\.0+)?$/.test(f)) { const dec = (f.split('.')[1] || '').length; s = v.toFixed(dec).padStart(f.split('.')[0].length + (dec ? dec + 1 : 0), '0'); }
      }
      if (s === undefined) s = toStr(v);
      if (w) s = +w < 0 ? s.padEnd(-w) : s.padStart(+w);
      return s;
    });
  }
  function binary(op, a, b, cs, session) {
    switch (op) {
      case '+':
        if (Array.isArray(a)) return a.concat(toArray(b));
        if (a instanceof PSHashtable) { const r = new PSHashtable(a.entries()); for (const [k, v] of toArray(b)[0].entries()) { if (r.has(k)) throw rtError(`Item has already been added. Key in dictionary: '${k}'  Key being added: '${k}'`, { category: 'OperationStopped', exception: 'ArgumentException', id: 'System.ArgumentException' }); r.set(k, v); } return r; }
        if (typeof a === 'string') return a + toStr(b);
        if (a instanceof Date) return new Date(a.getTime() + toNum(b) / 1e4);
        if (a == null) return b;
        return toNum(a) + toNum(b, typeName(a));
      case '-': return toNum(a, 'System.Int32') - toNum(b, typeName(a) || 'System.Int32');
      case '*':
        if (typeof a === 'string') return a.repeat(Math.max(0, toNum(b)));
        if (Array.isArray(a)) { let r = []; for (let i = 0; i < toNum(b); i++) r = r.concat(a); return r; }
        return toNum(a) * toNum(b);
      case '/': { const d = toNum(b); if (d === 0) throw rtError('Attempted to divide by zero.', { category: 'NotSpecified', exception: 'RuntimeException', id: 'RuntimeException' }); return toNum(a) / d; }
      case '%': return toNum(a) % toNum(b);
      case 'and': return toBool(a) && toBool(b);
      case 'or': return toBool(a) || toBool(b);
      case 'xor': return toBool(a) !== toBool(b);
      case 'band': return toNum(a) & toNum(b);
      case 'bor': return toNum(a) | toNum(b);
      case 'bxor': return toNum(a) ^ toNum(b);
      case 'f': return formatOp(toStr(a), b);
      case 'join': return toArray(a).map(toStr).join(toStr(b));
      case 'split': return toStr(a).split(new RegExp(toStr(toArray(b)[0]), cs ? '' : 'i'));
      case 'replace': {
        const [pat, rep] = toArray(b);
        return Array.isArray(a) ? a.map(x => toStr(x).replace(new RegExp(toStr(pat), cs ? 'g' : 'gi'), toStr(rep))) : toStr(a).replace(new RegExp(toStr(pat), cs ? 'g' : 'gi'), toStr(rep));
      }
      case 'is': case 'isnot': {
        const t = b instanceof TypeRef ? b.name : toStr(b);
        const r = matchesType(a, t);
        return op === 'is' ? r : !r;
      }
      case 'as': try { return cast(b instanceof TypeRef ? b.name : toStr(b), a, session); } catch (e) { return null; }
      case 'contains': case 'notcontains': { const r = toArray(a).some(x => eq(x, b, cs)); return op === 'contains' ? r : !r; }
      case 'in': case 'notin': { const r = toArray(b).some(x => eq(x, a, cs)); return op === 'in' ? r : !r; }
      default: break;
    }
    // comparison operators: arrays on the left filter
    const test = x => {
      switch (op) {
        case 'eq': return eq(x, b, cs);
        case 'ne': return !eq(x, b, cs);
        case 'gt': return cmp(x, b) > 0;
        case 'ge': return cmp(x, b) >= 0;
        case 'lt': return cmp(x, b) < 0;
        case 'le': return cmp(x, b) <= 0;
        case 'like': return wildcardRe(toStr(b), cs).test(toStr(x));
        case 'notlike': return !wildcardRe(toStr(b), cs).test(toStr(x));
        case 'match': case 'notmatch': {
          let re;
          try { re = new RegExp(toStr(b), cs ? '' : 'i'); } catch (e) { throw rtError(`Invalid regular expression pattern: ${toStr(b)}.`, { category: 'InvalidOperation', exception: 'RuntimeException', id: 'InvalidRegularExpression' }); }
          const m = toStr(x).match(re);
          if (m && session && !Array.isArray(a)) session.setVar('Matches', new PSHashtable(m.map((g, i) => [i, g])));
          return op === 'match' ? !!m : !m;
        }
        default: throw rtError(`Unexpected operator '-${op}'.`, { category: 'ParserError', id: 'UnexpectedToken' });
      }
    };
    if (Array.isArray(a)) return a.filter(test);
    return test(a);
  }
  function matchesType(v, t) {
    const n = String(t).toLowerCase().replace(/^system\./, '');
    const tn = (typeName(v) || '').toLowerCase().replace(/^system\./, '');
    const alias = { int: 'int32', long: 'int64', string: 'string', bool: 'boolean', double: 'double', array: 'object[]', hashtable: 'collections.hashtable', datetime: 'datetime', pscustomobject: 'management.automation.pscustomobject', scriptblock: 'management.automation.scriptblock' };
    return tn === (alias[n] || n) || (n === 'object' && v != null) || (n === 'array' && Array.isArray(v));
  }

  /* ================================================================ casts, members, statics */
  function cast(typeName, v, session) {
    const t = String(typeName).toLowerCase().replace(/^system\./, '').trim();
    switch (t) {
      case 'int': case 'int32': case 'int64': case 'long': case 'uint32': case 'uint64': case 'byte': case 'int16': {
        const n = toNum(v, 'System.' + ({ int: 'Int32', long: 'Int64' }[t] || t.replace(/^\w/, c => c.toUpperCase())));
        return Math.round(n);
      }
      case 'double': case 'decimal': case 'single': case 'float': return toNum(v, 'System.Double');
      case 'string': return toStr(v);
      case 'bool': case 'boolean': return toBool(v);
      case 'char': return toStr(v).charAt(0);
      case 'array': case 'object[]': case 'string[]': case 'int[]': { const a = toArray(v); return t === 'string[]' ? a.map(toStr) : t === 'int[]' ? a.map(x => cast('int', x)) : a; }
      case 'hashtable': case 'collections.hashtable': if (v instanceof PSHashtable) return v; break;
      case 'ordered': if (v instanceof PSHashtable) return v; break;
      case 'pscustomobject': case 'psobject': case 'management.automation.pscustomobject':
        if (v instanceof PSHashtable) return psobj('System.Management.Automation.PSCustomObject', Object.fromEntries(v.entries()));
        return v;
      case 'datetime': { if (v instanceof Date) return v; const d = new Date(toStr(v)); if (isNaN(d)) throw rtError(`Cannot convert value "${toStr(v)}" to type "System.DateTime". Error: "String was not recognized as a valid DateTime."`, { category: 'InvalidArgument', id: 'InvalidCastParseTargetInvocationWithFormatProvider' }); return d; }
      case 'ipaddress': case 'net.ipaddress': {
        const s = toStr(v);
        if (!U.isValidIp(s)) throw rtError(`Cannot convert value "${s}" to type "System.Net.IPAddress". Error: "An invalid IP address was specified."`, { category: 'InvalidArgument', id: 'InvalidCastParseTargetInvocation' });
        return psobj('System.Net.IPAddress', { IPAddressToString: s, AddressFamily: 'InterNetwork' }, { str: s });
      }
      case 'scriptblock': if (v instanceof ScriptBlock) return v; return new ScriptBlock(PS.parse('{' + toStr(v) + '}').statements[0].elements[0].expr, session);
      case 'securestring': case 'security.securestring':
        if (v instanceof SecureString) return v;
        throw rtError(`Cannot convert the "${toStr(v)}" value of type "${typeName(v)}" to type "System.Security.SecureString".`, { category: 'InvalidArgument', id: 'ConvertToFinalInvalidCastException' });
      case 'void': return undefined;
      case 'regex': return toStr(v);
      default: break;
    }
    if (!STATICS[t] && !/^(guid|math|environment|convert|io\.path|net\.dns)$/.test(t)) throw rtError(`Unable to find type [${typeName}].`, { category: 'InvalidOperation', target: typeName, targetType: 'TypeName', id: 'TypeNotFound' });
    return v;
  }
  const STATICS = {
    math: { round: (x, d) => { const f = 10 ** (d || 0); return Math.round(toNum(x, 'System.Double') * f) / f; }, floor: x => Math.floor(toNum(x)), ceiling: x => Math.ceil(toNum(x)), abs: x => Math.abs(toNum(x)), max: (a, b) => Math.max(toNum(a), toNum(b)), min: (a, b) => Math.min(toNum(a), toNum(b)), pow: (a, b) => Math.pow(toNum(a), toNum(b)), sqrt: x => Math.sqrt(toNum(x)), truncate: x => Math.trunc(toNum(x)), pi: Math.PI, e: Math.E },
    datetime: { now: () => new Date(), today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, parse: s => cast('datetime', s) },
    environment: { machinename: () => WS.sys.name, username: () => (WS.session && WS.session.user) || 'Administrator', userdomainname: () => WS.sys.netbiosDomain(), newline: '\r\n', osversion: () => psobj('System.OperatingSystem', { Platform: 'Win32NT', Version: '10.0.26100.0', VersionString: 'Microsoft Windows NT 10.0.26100.0' }, { str: 'Microsoft Windows NT 10.0.26100.0' }), currentdirectory: () => 'C:\\Windows\\system32', systemdirectory: 'C:\\Windows\\system32', is64bitoperatingsystem: true, processorcount: 4 },
    string: { join: (s, arr) => toArray(arr).map(toStr).join(toStr(s)), isnullorempty: s => s == null || toStr(s) === '', isnullorwhitespace: s => s == null || toStr(s).trim() === '', empty: '', format: (f, ...a) => formatOp(toStr(f), a.length === 1 ? a[0] : a), concat: (...a) => a.map(toStr).join('') },
    guid: { newguid: () => psobj('System.Guid', { Guid: U.guid() }, { str: function () { return this.Guid; } }) },
    'net.dns': { gethostname: () => WS.sys.name, gethostaddresses: n => { const r = WS.net.resolve(toStr(n)); if (!r.ok) throw rtError(`Exception calling "GetHostAddresses" with "1" argument(s): "No such host is known"`, { category: 'NotSpecified', exception: 'MethodInvocationException', id: 'SocketException' }); return r.addresses.map(a => cast('ipaddress', a)); } },
    'io.path': { combine: (...p) => p.map(toStr).join('\\').replace(/\\+/g, '\\'), getfilename: p => toStr(p).replace(/^.*\\/, ''), getextension: p => { const m = toStr(p).match(/\.[^.\\]*$/); return m ? m[0] : ''; }, getdirectoryname: p => toStr(p).replace(/\\[^\\]*$/, ''), gettemppath: () => 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\' },
    convert: { toint32: x => Math.trunc(toNum(x)), tostring: x => toStr(x), toboolean: x => toBool(x), tobase64string: x => btoa(toStr(x)) },
    int: { maxvalue: 2147483647, minvalue: -2147483648 }, int32: { maxvalue: 2147483647, minvalue: -2147483648 }
  };
  STATICS['system.math'] = STATICS.math;

  function getProp(obj, name) {
    if (obj == null) return null;
    const n = String(name).toLowerCase();
    if (obj instanceof PSHashtable) {
      if (obj.has(name)) return obj.get(name);
      if (n === 'count') return obj.size;
      if (n === 'keys') return obj.keys();
      if (n === 'values') return obj.values();
      return null;
    }
    if (typeof obj === 'string') return n === 'length' ? obj.length : null;
    if (Array.isArray(obj)) {
      if (n === 'count' || n === 'length') return obj.length;
      const out = [];
      for (const x of obj) { const v = getProp(x, name); if (v != null) { if (Array.isArray(v)) out.push(...v); else out.push(v); } }
      return out.length === 1 ? out[0] : out;
    }
    if (obj instanceof Date) {
      const d = obj;
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), dayofweek: U.DAYS[d.getDay()], dayofyear: Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), ticks: d.getTime() * 1e4 + 621355968000000000, millisecond: d.getMilliseconds() }[n] ?? null;
    }
    if (obj instanceof SecureString) return n === 'length' ? obj.Length : null;
    if (typeof obj === 'number' || typeof obj === 'boolean') return null;
    if (typeof obj === 'object') {
      if (name in obj) return obj[name];
      const k = Object.keys(obj).find(x => x.toLowerCase() === n);
      if (k) return obj[k];
      if (obj.__hidden) { const hk = Object.keys(obj.__hidden).find(x => x.toLowerCase() === n); if (hk) return obj.__hidden[hk]; }
      if (n === 'pstypenames') return [typeName(obj)];
    }
    return null;
  }
  function setProp(obj, name, value) {
    if (obj instanceof PSHashtable) { obj.set(name, value); return; }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const k = Object.keys(obj).find(x => x.toLowerCase() === String(name).toLowerCase());
      const setter = obj.__setters && Object.keys(obj.__setters).find(x => x.toLowerCase() === String(name).toLowerCase());
      if (setter) {
        try { obj.__setters[setter](value); } catch (e) { throw rtError(`Exception setting "${setter}": "${e.message}"`, { category: 'NotSpecified', id: 'ExceptionWhenSetting' }); }
        if (k) obj[k] = value;
        return;
      }
      if (k || obj.__type === 'System.Management.Automation.PSCustomObject' || !obj.__type) { obj[k || name] = value; return; }
      throw rtError(`'${name}' is a ReadOnly property.`, { category: 'InvalidOperation', id: 'PropertyAssignmentException' });
    }
    throw rtError(`The property '${name}' cannot be found on this object. Verify that the property exists and can be set.`, { category: 'InvalidOperation', id: 'PropertyNotFound' });
  }
  function callMethod(obj, name, args, session) {
    const n = String(name).toLowerCase();
    const noMethod = () => rtError(`Method invocation failed because [${typeName(obj)}] does not contain a method named '${name}'.`, { category: 'InvalidOperation', target: '', exception: 'RuntimeException', id: 'MethodNotFound' });
    if (obj == null) throw rtError('You cannot call a method on a null-valued expression.', { category: 'InvalidOperation', id: 'InvokeMethodOnNull' });
    if (n === 'tostring' && !(typeof obj === 'number' && args.length)) return (obj instanceof Date && args.length) ? dateFormat(obj, toStr(args[0])) : toStr(obj);
    if (n === 'gettype') return new TypeRef(typeName(obj));
    if (n === 'equals') return eq(obj, args[0]);
    if (typeof obj === 'string') {
      const s = obj;
      const a = args.map(x => toStr(x));
      switch (n) {
        case 'toupper': case 'toupperinvariant': return s.toUpperCase();
        case 'tolower': case 'tolowerinvariant': return s.toLowerCase();
        case 'trim': return a.length ? s.replace(new RegExp(`^[${a[0].replace(/[\]\\^-]/g, '\\$&')}]+|[${a[0].replace(/[\]\\^-]/g, '\\$&')}]+$`, 'g'), '') : s.trim();
        case 'trimstart': return s.replace(/^\s+/, '');
        case 'trimend': return a.length ? s.replace(new RegExp(`[${a[0].replace(/[\]\\^-]/g, '\\$&')}]+$`), '') : s.replace(/\s+$/, '');
        case 'split': return a.length ? s.split(new RegExp('[' + a.join('').replace(/[\]\\^-]/g, '\\$&') + ']')) : s.split(/\s/);
        case 'replace': return s.split(a[0]).join(a[1] == null ? '' : a[1]);
        case 'contains': return s.includes(a[0]);
        case 'startswith': return s.startsWith(a[0]);
        case 'endswith': return s.endsWith(a[0]);
        case 'substring': return args.length > 1 ? s.substr(toNum(args[0]), toNum(args[1])) : s.slice(toNum(args[0]));
        case 'indexof': return s.indexOf(a[0]);
        case 'lastindexof': return s.lastIndexOf(a[0]);
        case 'padleft': return s.padStart(toNum(args[0]), a[1] || ' ');
        case 'padright': return s.padEnd(toNum(args[0]), a[1] || ' ');
        case 'insert': return s.slice(0, toNum(args[0])) + a[1] + s.slice(toNum(args[0]));
        case 'remove': return s.slice(0, toNum(args[0])) + (args.length > 1 ? s.slice(toNum(args[0]) + toNum(args[1])) : '');
        case 'tochararray': return s.split('');
        case 'compareto': return s.localeCompare(a[0]);
        default: throw noMethod();
      }
    }
    if (Array.isArray(obj)) {
      if (n === 'contains') return obj.some(x => eq(x, args[0], true));
      if (n === 'indexof') return obj.findIndex(x => eq(x, args[0], true));
      if (n === 'add') throw rtError('Exception calling "Add" with "1" argument(s): "Collection was of a fixed size."', { category: 'NotSpecified', exception: 'MethodInvocationException', id: 'NotSupportedException' });
      // method on every element (member enumeration)
      return obj.map(x => callMethod(x, name, args, session));
    }
    if (obj instanceof PSHashtable) {
      switch (n) {
        case 'add': if (obj.has(args[0])) throw rtError(`Exception calling "Add" with "2" argument(s): "Item has already been added. Key in dictionary: '${toStr(args[0])}'  Key being added: '${toStr(args[0])}'"`, { category: 'NotSpecified', exception: 'MethodInvocationException', id: 'ArgumentException' }); obj.set(args[0], args[1]); return undefined;
        case 'remove': obj.delete(args[0]); return undefined;
        case 'containskey': return obj.has(args[0]);
        case 'containsvalue': return obj.values().some(v => eq(v, args[0]));
        case 'clear': obj.m.clear(); return undefined;
        default: throw noMethod();
      }
    }
    if (obj instanceof Date) {
      const add = ms => new Date(obj.getTime() + ms);
      switch (n) {
        case 'adddays': return add(toNum(args[0], 'System.Double') * 864e5);
        case 'addhours': return add(toNum(args[0], 'System.Double') * 36e5);
        case 'addminutes': return add(toNum(args[0], 'System.Double') * 6e4);
        case 'addseconds': return add(toNum(args[0], 'System.Double') * 1e3);
        case 'addmonths': { const d = new Date(obj); d.setMonth(d.getMonth() + toNum(args[0])); return d; }
        case 'addyears': { const d = new Date(obj); d.setFullYear(d.getFullYear() + toNum(args[0])); return d; }
        case 'toshortdatestring': return U.fmtDate(obj);
        case 'tolongdatestring': return U.fmtLongDate(obj);
        case 'toshorttimestring': return U.fmtTime(obj);
        case 'tolongtimestring': return U.fmtTime(obj, true);
        case 'touniversaltime': return obj;
        default: throw noMethod();
      }
    }
    if (typeof obj === 'number') {
      if (n === 'tostring') return args.length ? formatOp('{0:' + toStr(args[0]) + '}', [obj]) : toStr(obj);
      throw noMethod();
    }
    if (obj instanceof SecureString) throw noMethod();
    if (obj.__methods) {
      const k = Object.keys(obj.__methods).find(x => x.toLowerCase() === n);
      if (k) return obj.__methods[k].apply(obj, args);
    }
    throw noMethod();
  }
  function dateFormat(d, f) {
    const p = U.pad;
    return f.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt/g, t => ({
      yyyy: d.getFullYear(), yy: p(d.getFullYear() % 100), MMMM: U.MONTHS[d.getMonth()], MMM: U.MONTHS[d.getMonth()].slice(0, 3), MM: p(d.getMonth() + 1), M: d.getMonth() + 1,
      dddd: U.DAYS[d.getDay()], ddd: U.DAYS[d.getDay()].slice(0, 3), dd: p(d.getDate()), d: d.getDate(), HH: p(d.getHours()), H: d.getHours(),
      hh: p(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12, mm: p(d.getMinutes()), m: d.getMinutes(), ss: p(d.getSeconds()), s: d.getSeconds(), tt: d.getHours() < 12 ? 'AM' : 'PM'
    }[t]));
  }

  /* ================================================================ registries */
  const cmdlets = {};
  const ALIASES = {
    '%': 'ForEach-Object', '?': 'Where-Object', ac: 'Add-Content', cat: 'Get-Content', cd: 'Set-Location', chdir: 'Set-Location', clc: 'Clear-Content', clear: 'Clear-Host', cls: 'Clear-Host',
    copy: 'Copy-Item', cp: 'Copy-Item', cpi: 'Copy-Item', del: 'Remove-Item', dir: 'Get-ChildItem', echo: 'Write-Output', erase: 'Remove-Item', fc: 'Format-Custom', fl: 'Format-List',
    foreach: 'ForEach-Object', ft: 'Format-Table', fw: 'Format-Wide', gal: 'Get-Alias', gc: 'Get-Content', gci: 'Get-ChildItem', gcm: 'Get-Command', gdr: 'Get-PSDrive', ghy: 'Get-History',
    gi: 'Get-Item', gl: 'Get-Location', gm: 'Get-Member', gp: 'Get-ItemProperty', gps: 'Get-Process', group: 'Group-Object', gsv: 'Get-Service', gu: 'Get-Unique', gv: 'Get-Variable',
    h: 'Get-History', history: 'Get-History', iex: 'Invoke-Expression', ii: 'Invoke-Item', kill: 'Stop-Process', ls: 'Get-ChildItem', man: 'help', saps: 'Start-Process', start: 'Start-Process', spps: 'Stop-Process', md: 'mkdir', measure: 'Measure-Object',
    mi: 'Move-Item', move: 'Move-Item', mv: 'Move-Item', ni: 'New-Item', popd: 'Pop-Location', ps: 'Get-Process', pushd: 'Push-Location', pwd: 'Get-Location', r: 'Invoke-History',
    rd: 'Remove-Item', ren: 'Rename-Item', ri: 'Remove-Item', rm: 'Remove-Item', rmdir: 'Remove-Item', rni: 'Rename-Item', sajb: 'Start-Job', sasv: 'Start-Service', sc: 'Set-Content',
    select: 'Select-Object', set: 'Set-Variable', si: 'Set-Item', sl: 'Set-Location', sleep: 'Start-Sleep', sort: 'Sort-Object', spsv: 'Stop-Service', sv: 'Set-Variable', type: 'Get-Content',
    where: 'Where-Object', write: 'Write-Output', curl: 'Invoke-WebRequest', wget: 'Invoke-WebRequest', iwr: 'Invoke-WebRequest', tee: 'Tee-Object', compare: 'Compare-Object', diff: 'Compare-Object',
    epal: 'Export-Alias', epcsv: 'Export-Csv', ipcsv: 'Import-Csv', ogv: 'Out-GridView', oh: 'Out-Host', rv: 'Remove-Variable', clv: 'Clear-Variable', ihy: 'Invoke-History', nv: 'New-Variable',
    'Add-WindowsFeature': 'Install-WindowsFeature', 'Remove-WindowsFeature': 'Uninstall-WindowsFeature', sls: 'Select-String', shcm: 'Show-Command', ise: 'powershell_ise', rvpa: 'Resolve-Path'
  };
  const aliases = {};
  for (const [k, v] of Object.entries(ALIASES)) aliases[k.toLowerCase()] = v;

  const COMMON = [
    { name: 'Verbose', alias: ['vb'], type: 'switch' }, { name: 'Debug', alias: ['db'], type: 'switch' },
    { name: 'ErrorAction', alias: ['ea'], type: 'enum', values: ['SilentlyContinue', 'Stop', 'Continue', 'Inquire', 'Ignore', 'Suspend'], enumType: 'System.Management.Automation.ActionPreference' },
    { name: 'WarningAction', alias: ['wa'], type: 'enum', values: ['SilentlyContinue', 'Stop', 'Continue', 'Inquire', 'Ignore', 'Suspend'], enumType: 'System.Management.Automation.ActionPreference' },
    { name: 'InformationAction', alias: ['infa'], type: 'string' }, { name: 'ErrorVariable', alias: ['ev'], type: 'string' }, { name: 'WarningVariable', alias: ['wv'], type: 'string' },
    { name: 'InformationVariable', alias: ['iv'], type: 'string' }, { name: 'OutVariable', alias: ['ov'], type: 'string' }, { name: 'OutBuffer', alias: ['ob'], type: 'int' }, { name: 'PipelineVariable', alias: ['pv'], type: 'string' }
  ];
  const SHOULD = [{ name: 'WhatIf', alias: ['wi'], type: 'switch' }, { name: 'Confirm', alias: ['cf'], type: 'switch' }];

  /** Register a cmdlet. */
  function cmdlet(def) {
    const [verb, noun] = def.name.split('-');
    def.verb = verb; def.noun = noun;
    def.module = def.module || 'Microsoft.PowerShell.Utility';
    def.version = def.version || '3.1.0.0';
    def.cls = def.cls || `Microsoft.PowerShell.Commands.${verb}${noun}Command`;
    def.specs = Object.entries(def.params || {}).map(([name, s]) => ({ name, alias: [], ...s, type: s.type || 'string' }));
    cmdlets[def.name.toLowerCase()] = def;
    for (const a of def.aliases || []) aliases[a.toLowerCase()] = def.name;
    return def;
  }
  const available = def => !def.feature || [].concat(def.feature).some(f => WS.features.isInstalled(f));
  function findCmdlet(name) {
    const d = cmdlets[String(name).toLowerCase()];
    return d && available(d) ? d : null;
  }

  /* ================================================================ session */
  class Session {
    constructor(o = {}) {
      this.console = o.console;
      this.kind = 'ps';
      this.cwd = o.cwd || ('C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator'));
      this.globals = new Map();
      this.scope = { vars: this.globals, parent: null };
      this.functions = new Map();
      this.history = [];
      this.lineHistory = o.history || [];
      this.errors = [];
      this.lastSuccess = true;
      this.lastExit = 0;
      this.exited = false;
      this.envOverrides = {};
      this.locStack = [];
      this.cancelled = false;
      this.onExit = o.onExit || null;
      this.errorSink = null;
      this.src = '';
      if (this.console) this.console.onInterrupt(() => { this.cancelled = true; });
      for (const [k, v] of Object.entries({ true: true, false: false, null: null, ErrorActionPreference: 'Continue', ConfirmPreference: 'High', WarningPreference: 'Continue', VerbosePreference: 'SilentlyContinue',
        OFS: ' ', PSEdition: 'Desktop', MaximumHistoryCount: 4096, PROFILE: `C:\\Users\\Administrator\\Documents\\WindowsPowerShell\\Microsoft.PowerShell_profile.ps1`, PSHOME: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0', ShellId: 'Microsoft.PowerShell' })) this.globals.set(k.toLowerCase(), { name: k, value: v });
    }

    /* ---- variables ---- */
    findVar(name) {
      for (let s = this.scope; s; s = s.parent) { const v = s.vars.get(name.toLowerCase()); if (v) return v; }
      return null;
    }
    getVar(raw) {
      let name = raw.replace(/^(global|script|local|private|variable):/i, '');
      const lower = name.toLowerCase();
      if (/^env:/i.test(name)) {
        const k = name.slice(4);
        const ov = Object.keys(this.envOverrides).find(x => x.toLowerCase() === k.toLowerCase());
        if (ov) return this.envOverrides[ov];
        const env = WS.fs.env();
        const ek = Object.keys(env).find(x => x.toLowerCase() === k.toLowerCase());
        return ek ? env[ek] : null;
      }
      switch (lower) {
        case '?': return this.lastSuccess;
        case 'lastexitcode': { const v = this.findVar('LASTEXITCODE'); return v ? v.value : null; }
        case 'pwd': return psobj('System.Management.Automation.PathInfo', { Drive: this.cwd[0], Provider: 'Microsoft.PowerShell.Core\\FileSystem', ProviderPath: this.cwd, Path: this.cwd }, { str: this.cwd });
        case 'home': return 'C:\\Users\\' + ((WS.session && WS.session.user) || 'Administrator');
        case 'error': return this.errors.slice();
        case 'psitem': name = '_'; break;
        case 'host': return psobj('System.Management.Automation.Internal.Host.InternalHost', { Name: 'ConsoleHost', Version: '5.1.26100.1742', InstanceId: '7c2b5f1d-0000-4000-8000-000000000001', CurrentCulture: 'en-US', CurrentUICulture: 'en-US' });
        case 'psversiontable': return new PSHashtable([['PSVersion', '5.1.26100.1742'], ['PSEdition', 'Desktop'], ['PSCompatibleVersions', ['1.0', '2.0', '3.0', '4.0', '5.0', '5.1.26100.1742']], ['BuildVersion', '10.0.26100.1742'], ['CLRVersion', '4.0.30319.42000'], ['WSManStackVersion', '3.0'], ['PSRemotingProtocolVersion', '2.3'], ['SerializationVersion', '1.1.0.1']]);
        case 'pid': return this.pid || 4724; // the terminal tab's powershell.exe (WS.proc); 4724 for a session with no tab
        case 'executioncontext': return null;
        default: break;
      }
      const v = this.findVar(name === '_' ? '_' : name);
      return v ? v.value : null;
    }
    setVar(raw, value, scope) {
      const name = raw.replace(/^(global|script|local|private|variable):/i, '');
      if (/^env:/i.test(name)) { this.envOverrides[name.slice(4)] = value == null ? '' : toStr(value); return; }
      const lower = name.toLowerCase();
      if (['true', 'false', 'null', '?', 'home', 'host', 'pid', 'psversiontable'].includes(lower)) throw rtError(`Cannot overwrite variable ${name} because it is read-only or constant.`, { category: 'WriteError', target: name, exception: 'SessionStateUnauthorizedAccessException', id: 'VariableNotWritable' });
      if (/^global:/i.test(raw)) { this.globals.set(lower, { name, value }); return; }
      // like PowerShell, an assignment creates or updates the variable in the current scope
      const s = scope || this.scope;
      const existing = s.vars.get(lower);
      s.vars.set(lower, { name: existing ? existing.name : name, value });
    }
    get errorAction() { return toStr(this.getVar('ErrorActionPreference')) || 'Continue'; }

    /* ---- console I/O ---- */
    write(text, style) { if (this.console) this.console.write(text, style); }
    writeLine(text, style) { this.write((text == null ? '' : text) + '\n', style); }
    writeErrorRecord(rec) {
      this.errors.unshift(rec);
      if (this.errors.length > 256) this.errors.length = 256;
      if (this.errorSink) { this.errorSink.push(rec); return; }
      this.write(formatError(rec) + '\n', { fg: 'Red', bg: 'Black' });
    }
    display(items) {
      const lines = PS.formatOut(items, this.console ? this.console.cols() : 120);
      if (lines.length) this.write(lines.join('\n') + '\n');
    }
    prompt() { return 'PS ' + (/^\\\\/.test(this.cwd) ? 'Microsoft.PowerShell.Core\\FileSystem::' : '') + this.cwd + '> '; }
    checkCancel() { if (this.cancelled || (this.console && this.console.disposed)) { this.cancelled = false; throw new PipelineStopped(); } }

    /* ---- REPL ---- */
    banner() {
      this.writeLine('Windows PowerShell');
      this.writeLine('Copyright (C) Microsoft Corporation. All rights reserved.');
      this.writeLine('');
      this.writeLine('Install the latest PowerShell for new features and improvements! https://aka.ms/PSWindows');
      this.writeLine('');
    }
    async repl() {
      let buffer = '';
      while (!this.exited) {
        const prompt = buffer ? '>> ' : this.prompt();
        if (!buffer && this.console.setTitle) this.console.setTitle('Administrator: Windows PowerShell');
        const line = await this.console.readLine({ prompt, history: this.lineHistory, complete: (l, c, rev, st) => this.complete(l, c, rev, st), highlight: PS.highlight });
        if (line === null) { if (this.console.disposed || this.console instanceof WS.term.TextConsole) { this.exited = true; break; } buffer = ''; continue; }
        const src = buffer ? buffer + '\n' + line : line;
        if (!src.trim()) { buffer = ''; continue; }
        if (buffer && !line.trim()) { buffer = ''; await this.execute(src); continue; }
        try { PS.parse(src); } catch (e) { if (e instanceof PS.ParseError && e.incomplete) { buffer = src; continue; } }
        buffer = '';
        await this.execute(src);
      }
    }
    /** Run source text the way the console does: errors printed, output formatted. */
    async execute(src, o = {}) {
      this.cancelled = false;
      const entry = { Id: this.history.length + 1, CommandLine: src, StartExecutionTime: new Date(), EndExecutionTime: null, ExecutionStatus: 'Completed' };
      if (!o.noHistory) this.history.push(entry);
      let ast;
      try { ast = PS.parse(src); }
      catch (e) {
        if (!(e instanceof PS.ParseError)) throw e;
        this.writeErrorRecord(new ErrorRecord({ message: e.message, category: 'ParserError', target: '', targetType: '', exception: 'ParentContainsErrorRecordException', id: e.id, parse: true, pos: { src, start: e.pos, end: e.pos + 1 } }));
        this.lastSuccess = false;
        entry.ExecutionStatus = 'Failed';
        return;
      }
      const prevSrc = this.src;
      this.src = src;
      try {
        if (ast.statements.length) {
          for (const st of ast.statements) {
            const out = await this.runTop(st);
            if (out && out.length && !o.capture) this.display(out);
            if (o.capture && out) o.capture.push(...out);
            if (this.exited) break;
          }
        }
      } finally { this.src = prevSrc; entry.EndExecutionTime = new Date(); if (this.console) this.console.setProgress(null); }
    }
    async runTop(st) {
      try {
        return await this.evalStatement(st, this.scope, { top: true });
      } catch (e) {
        return this.handleTopError(e);
      }
    }
    handleTopError(e) {
      if (e instanceof FlowSignal) {
        if (e.kind === 'exit') { this.exit(e.value); return []; }
        return e.kind === 'return' ? toArray(e.value) : [];
      }
      if (e instanceof PipelineStopped) { this.lastSuccess = false; return []; }
      if (e instanceof PSRuntimeError) { this.writeErrorRecord(e.record); this.lastSuccess = false; return []; }
      console.error(e);
      this.writeErrorRecord(new ErrorRecord({ message: 'Internal simulator error: ' + e.message, category: 'NotSpecified', exception: 'RuntimeException', id: 'SimulatorError' }));
      this.lastSuccess = false;
      return [];
    }
    exit(code) {
      this.exited = true;
      this.exitCode = code == null ? 0 : toNum(unwrap(toArray(code)));
      if (this.onExit) this.onExit(this.exitCode);
    }

    /* ================================================================ statements */
    async evalBlock(block, scope) {
      const out = [];
      for (const st of block.statements) out.push(...await this.evalStatement(st, scope));
      return out;
    }
    async evalStatement(st, scope, o = {}) {
      this.checkCancel();
      switch (st.type) {
        case 'Pipeline': return this.runPipeline(st, scope, o);
        case 'Assign': await this.assign(st, scope); return [];
        case 'If': {
          for (const c of st.clauses) if (toBool(unwrap(await this.evalStatement(c.cond, scope)))) return this.evalBlock(c.body, scope);
          return st.elseBlock ? this.evalBlock(st.elseBlock, scope) : [];
        }
        case 'Foreach': {
          const items = await this.evalStatement(st.collection, scope);
          const out = [];
          for (const item of items) {
            this.checkCancel();
            this.setVar(st.variable, item, scope);
            try { out.push(...await this.evalBlock(st.body, scope)); }
            catch (e) { if (e instanceof FlowSignal && e.kind === 'break') break; if (e instanceof FlowSignal && e.kind === 'continue') continue; throw e; }
          }
          return out;
        }
        case 'For': case 'While': case 'Do': {
          const out = [];
          if (st.type === 'For' && st.init) await this.evalStatement(st.init, scope);
          let guard = 0;
          for (;;) {
            this.checkCancel();
            if (++guard > 100000) throw rtError('The loop ran too many times for the lab simulator.', { category: 'OperationStopped', id: 'LoopLimit' });
            if (st.type !== 'Do' && st.cond && !toBool(unwrap(await this.evalStatement(st.cond, scope)))) break;
            try { out.push(...await this.evalBlock(st.body, scope)); }
            catch (e) { if (e instanceof FlowSignal && e.kind === 'break') break; if (!(e instanceof FlowSignal && e.kind === 'continue')) throw e; }
            if (st.type === 'For' && st.step) await this.evalStatement(st.step, scope);
            if (st.type === 'Do') { const c = toBool(unwrap(await this.evalStatement(st.cond, scope))); if (st.until ? c : !c) break; }
          }
          return out;
        }
        case 'Try': {
          const out = [];
          try { out.push(...await this.evalBlock(st.body, scope)); }
          catch (e) {
            if (!(e instanceof PSRuntimeError) || !st.catches.length) throw e;
            const c = st.catches.find(k => !k.types.length || k.types.some(t => e.record.exception.toLowerCase().includes(t.replace(/^.*\./, '').toLowerCase()))) || null;
            if (!c) throw e;
            this.setVar('_', e.record, scope);
            out.push(...await this.evalBlock(c.body, scope));
          } finally { if (st.fin) out.push(...await this.evalBlock(st.fin, scope)); }
          return out;
        }
        case 'Function': this.functions.set(st.name.toLowerCase(), st); return [];
        case 'Flow': {
          if (st.kind === 'break' || st.kind === 'continue') throw new FlowSignal(st.kind);
          const value = st.value ? await this.evalStatement(st.value, scope) : [];
          if (st.kind === 'throw') {
            const v = unwrap(value);
            if (v instanceof ErrorRecord) throw new PSRuntimeError(v);
            const msg = v == null ? 'ScriptHalted' : toStr(v);
            throw new PSRuntimeError(new ErrorRecord({ message: msg, category: 'OperationStopped', target: msg, targetType: 'String', exception: 'RuntimeException', id: msg, pos: { src: this.src, start: st.start, end: st.end } }));
          }
          throw new FlowSignal(st.kind, st.kind === 'exit' ? unwrap(value) : value);
        }
        default: throw rtError(`Unsupported statement ${st.type}.`, { id: 'NotSupported' });
      }
    }
    async assign(st, scope) {
      let value;
      const v = st.value;
      if (v.type === 'Pipeline' || v.type === 'If' || v.type === 'Foreach' || v.type === 'Try') value = unwrap(await this.evalStatement(v, scope));
      else if (v.type === 'Assign') { await this.assign(v, scope); value = await this.evalExpr(v.target, scope); }
      else value = unwrap(await this.evalStatement(v, scope));
      const t = st.target;
      if (st.op !== '=') {
        const cur = await this.evalExpr(t, scope);
        value = binary({ '+=': '+', '-=': '-', '*=': '*', '/=': '/' }[st.op], cur, value, false, this);
      }
      await this.setTarget(t, value, scope);
    }
    async setTarget(t, value, scope) {
      if (t.type === 'Var') return this.setVar(t.name, value, scope);
      if (t.type === 'Cast') { return this.setTarget(t.expr, cast(t.typeName, value, this), scope); }
      if (t.type === 'Member') { const obj = await this.evalExpr(t.obj, scope); return setProp(obj, typeof t.name === 'string' ? t.name : toStr(await this.evalExpr(t.name, scope)), value); }
      if (t.type === 'Index') {
        const obj = await this.evalExpr(t.obj, scope);
        const idx = await this.evalExpr(t.index, scope);
        if (obj instanceof PSHashtable) { obj.set(idx, value); return; }
        if (Array.isArray(obj)) {
          let i = toNum(idx); if (i < 0) i += obj.length;
          if (i < 0 || i >= obj.length) throw rtError('Index was outside the bounds of the array.', { category: 'OperationStopped', exception: 'IndexOutOfRangeException', id: 'System.IndexOutOfRangeException' });
          obj[i] = value; return;
        }
        throw rtError(`Unable to index into an object of type ${typeName(obj)}.`, { category: 'InvalidOperation', id: 'CannotIndex' });
      }
      throw rtError('The assignment expression is not valid. The input to an assignment operator must be an object that is able to accept assignments, such as a variable or a property.', { category: 'ParserError', id: 'InvalidLeftHandSide' });
    }

    /* ================================================================ expressions */
    async evalExpr(e, scope) {
      switch (e.type) {
        case 'Literal': return e.value;
        case 'String': { let s = ''; for (const p of e.parts) s += typeof p === 'string' ? p : toStr(p.type === 'SubExpr' ? unwrap(await this.evalStatements(p.statements, scope)) : await this.evalExpr(p, scope)); return s; }
        case 'Var': return this.getVar(e.name);
        case 'Array': { const out = []; for (const it of e.items) out.push(await this.evalExpr(it, scope)); return out; }
        case 'ArraySub': return this.evalStatements(e.statements, scope);
        case 'SubExpr': return unwrap(await this.evalStatements(e.statements, scope));
        case 'Paren': {
          const inner = e.inner;
          if (inner.type === 'Assign') { await this.assign(inner, scope); return this.evalExpr(inner.target, scope); }
          return unwrap(await this.evalStatement(inner, scope));
        }
        case 'Hash': { const h = new PSHashtable(); for (const en of e.entries) h.set(toStr(await this.evalExpr(en.key, scope)), unwrap(await this.evalStatement(en.value, scope))); return h; }
        case 'ScriptBlock': return new ScriptBlock(e, this);
        case 'TypeLit': return new TypeRef(e.name);
        case 'Cast': return cast(e.typeName, await this.evalExpr(e.expr, scope), this);
        case 'Unary': {
          const v = await this.evalExpr(e.operand, scope);
          switch (e.op) {
            case 'not': return !toBool(v);
            case 'neg': return -toNum(v);
            case 'pos': return toNum(v);
            case 'bnot': return ~toNum(v);
            case 'split': return toStr(v).split(/\s+/).filter(Boolean);
            case 'join': return toArray(v).map(toStr).join('');
            default: return v;
          }
        }
        case 'PreInc': case 'PostInc': {
          const cur = toNum(await this.evalExpr(e.operand, scope));
          const next = e.op === '++' ? cur + 1 : cur - 1;
          await this.setTarget(e.operand, next, scope);
          return e.type === 'PreInc' ? next : cur;
        }
        case 'Binary': {
          if (e.op === 'and') return toBool(await this.evalExpr(e.left, scope)) && toBool(await this.evalExpr(e.right, scope));
          if (e.op === 'or') return toBool(await this.evalExpr(e.left, scope)) || toBool(await this.evalExpr(e.right, scope));
          return binary(e.op, await this.evalExpr(e.left, scope), await this.evalExpr(e.right, scope), e.cs, this);
        }
        case 'Range': {
          const a = toNum(await this.evalExpr(e.from, scope)), b = toNum(await this.evalExpr(e.to, scope));
          if (Math.abs(b - a) > 100000) throw rtError('The range is too large for the lab simulator.', { category: 'InvalidOperation', id: 'RangeTooBig' });
          const out = []; for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) out.push(i); return out;
        }
        case 'Member': {
          if (e.isStatic) return this.staticMember(e.obj, typeof e.name === 'string' ? e.name : toStr(await this.evalExpr(e.name, scope)), null);
          const obj = await this.evalExpr(e.obj, scope);
          const name = typeof e.name === 'string' ? e.name : toStr(await this.evalExpr(e.name, scope));
          return getProp(obj, name);
        }
        case 'Invoke': {
          const args = [];
          for (const a of e.args) args.push(await this.evalExpr(a, scope));
          const name = typeof e.name === 'string' ? e.name : toStr(await this.evalExpr(e.name, scope));
          if (e.isStatic) return this.staticMember(e.obj, name, args);
          const obj = await this.evalExpr(e.obj, scope);
          if (obj instanceof ScriptBlock && /^invoke(returnasis)?$/i.test(name)) return unwrap(await this.invokeBlock(obj, { args, scope }));
          return callMethod(obj, name, args, this);
        }
        case 'Index': {
          const obj = await this.evalExpr(e.obj, scope);
          const idx = await this.evalExpr(e.index, scope);
          if (obj == null) throw rtError('Cannot index into a null array.', { category: 'InvalidOperation', id: 'NullArray' });
          if (obj instanceof PSHashtable) return Array.isArray(idx) ? idx.map(k => obj.get(k)) : obj.get(idx);
          const arr = typeof obj === 'string' ? obj.split('') : Array.isArray(obj) ? obj : [obj];
          const one = i => { let n = toNum(i); if (n < 0) n += arr.length; return arr[n] === undefined ? null : arr[n]; };
          return Array.isArray(idx) ? idx.map(one) : one(idx);
        }
        case 'Pipeline': return unwrap(await this.runPipeline(e, scope));
        default: throw rtError(`Unsupported expression ${e.type}.`, { id: 'NotSupported' });
      }
    }
    async evalStatements(statements, scope) {
      const out = [];
      for (const st of statements) out.push(...await this.evalStatement(st, scope));
      return out;
    }
    staticMember(typeNode, name, args) {
      const t = (typeNode.name || toStr(typeNode)).toLowerCase().replace(/^system\./, '');
      const table = STATICS[t];
      if (!table) throw rtError(`Unable to find type [${typeNode.name}].`, { category: 'InvalidOperation', target: typeNode.name, targetType: 'TypeName', id: 'TypeNotFound' });
      const k = Object.keys(table).find(x => x === name.toLowerCase());
      if (!k) throw rtError(args ? `Method invocation failed because [${typeNode.name}] does not contain a method named '${name}'.` : `The property '${name}' cannot be found on type [${typeNode.name}].`, { category: 'InvalidOperation', id: args ? 'MethodNotFound' : 'PropertyNotFound' });
      const m = table[k];
      if (typeof m === 'function') return args ? m(...args) : m();
      return m;
    }

    /* ================================================================ pipelines and commands */
    async runPipeline(pipe, scope, o = {}) {
      const redirs = pipe.redirs || [];
      const isNull = r => r.target && r.target.type === 'Var' && r.target.name.toLowerCase() === 'null';
      const suppressErr = redirs.find(r => r.stream === '2' && (isNull(r) || r.target));
      const mergeErr = redirs.some(r => r.stream === '2' && r.merge);
      const prevSink = this.errorSink;
      const sink = suppressErr || mergeErr ? [] : null;
      if (sink) this.errorSink = sink;
      let items;
      let ok = true;
      try {
        for (let i = 0; i < pipe.elements.length; i++) {
          this.checkCancel();
          const el = pipe.elements[i];
          const last = i === pipe.elements.length - 1;
          if (el.type === 'ExprElement') {
            if (i > 0) throw rtError('Expressions are only allowed as the first element of a pipeline.', { category: 'ParserError', exception: 'ParentContainsErrorRecordException', id: 'ExpressionsMustBeFirstInPipeline', pos: { src: this.src, start: el.start, end: el.end } });
            const v = await this.evalExpr(el.expr, scope);
            items = v === undefined ? [] : Array.isArray(v) ? v.slice() : [v];
            if (v === null && pipe.elements.length === 1) items = []; // a bare $null writes nothing
          } else {
            const r = await this.invokeCommand(el, scope, items, { stream: last && o.top && !redirs.some(x => x.stream === '1' || x.stream === '*'), position: i + 1, total: pipe.elements.length });
            items = r.out;
            if (!r.ok) ok = false;
          }
        }
      } finally { this.errorSink = prevSink; }
      if (mergeErr && sink) items = (items || []).concat(sink);
      for (const r of redirs) {
        if (r.merge || r.stream === '2') { if (r.stream === '2' && !isNull(r) && sink && sink.length) await this.redirectToFile(r, sink.map(x => formatError(x)), scope); continue; }
        if (isNull(r)) { items = []; continue; }
        await this.redirectToFile(r, PS.formatOut(items || [], 120), scope);
        items = [];
      }
      this.lastSuccess = ok && !(sink && sink.length && !mergeErr);
      return items || [];
    }
    async redirectToFile(r, lines, scope) {
      const target = toStr(await this.evalExpr(r.target, scope));
      const path = this.resolvePath(target);
      const text = lines.join('\r\n') + (lines.length ? '\r\n' : '');
      try { WS.fs.writeFile(path, text, null, { append: r.append }); }
      catch (e) { throw rtError(`Could not find a part of the path '${path}'.`, { category: 'OpenError', target: path, exception: 'DirectoryNotFoundException', id: 'FileOpenFailure,Microsoft.PowerShell.Commands.OutFileCommand' }); }
    }
    resolvePath(p) { return WS.fs.full(p.replace(/^~(?=\\|\/|$)/, this.getVar('HOME')), this.cwd); }

    resolveCommand(name) {
      let n = String(name);
      const lower = n.toLowerCase();
      if (aliases[lower]) n = aliases[lower];
      const fn = this.functions.get(n.toLowerCase());
      if (fn) return { kind: 'function', fn, name: n };
      const def = findCmdlet(n);
      if (def) return { kind: 'cmdlet', def, name: def.name };
      if (n.toLowerCase() === 'mkdir' || n.toLowerCase() === 'help' || n.toLowerCase() === 'prompt' || n.toLowerCase() === 'cd..' || n.toLowerCase() === 'cd\\') return { kind: 'builtinFn', name: n.toLowerCase() };
      if (/\.ps1$/i.test(n) || /[\\/]/.test(n)) {
        const path = this.resolvePath(n);
        if (/\.ps1$/i.test(path) && WS.fs.exists(path)) return { kind: 'script', path };
        if (/^\./.test(n) || /[\\/]/.test(n)) {
          const base = path.replace(/^.*\\/, '');
          const nat = WS.term.native(base);
          if (nat && (WS.fs.exists(path) || (nat.dir && WS.term.reachable(nat, path, this.cwd)))) return { kind: 'native', nat, name: base };
        }
        return null;
      }
      const nat = WS.term.native(n);
      if (nat) {
        if (nat.inCwdOnly || nat.dir) return null;
        return { kind: 'native', nat, name: n };
      }
      // a script or exe in the current folder needs .\ in PowerShell
      return null;
    }
    async invokeCommand(node, scope, input, o) {
      let name = node.name;
      if (node.nameExpr) {
        const v = await this.evalExpr(node.nameExpr, scope);
        if (v instanceof ScriptBlock) {
          const args = [];
          for (const a of node.args) args.push(a.kind === 'arg' ? await this.evalExpr(a.value, scope) : '-' + a.name);
          return { out: await this.invokeBlock(v, { args, scope, input, dot: node.dot }), ok: true };
        }
        name = toStr(v);
      }
      const pos = { src: this.src, start: node.start, end: node.end };
      const cmd = this.resolveCommand(name);
      if (!cmd) {
        const inCwd = WS.fs.exists(this.resolvePath(name)) || WS.fs.exists(this.resolvePath(name + '.ps1'));
        const extra = inCwd ? `\n\nSuggestion [3,General]: The command ${name} was not found, but does exist in the current location. Windows PowerShell does not load commands from the current location by default. If you trust this command, instead type: ".\\${name}". See "get-help about_Command_Precedence" for more details.` : '';
        throw new PSRuntimeError(new ErrorRecord({ message: `The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.${extra}`,
          activity: name, category: 'ObjectNotFound', target: name, targetType: 'String', exception: 'CommandNotFoundException', id: 'CommandNotFoundException', pos }));
      }
      // evaluate arguments
      const args = [];
      for (const a of node.args) {
        if (a.kind === 'param') args.push({ kind: 'param', name: a.name, explicit: !!a.explicit, value: a.explicit ? await this.evalExpr(a.value, scope) : undefined, raw: a });
        else if (a.kind === 'splat') {
          const v = this.getVar(a.name);
          if (v instanceof PSHashtable) for (const [k, val] of v.entries()) args.push({ kind: 'param', name: k, explicit: true, value: val });
          else for (const x of toArray(v)) args.push({ kind: 'arg', value: x });
        } else args.push({ kind: 'arg', value: await this.evalExpr(a.value, scope), raw: a });
      }
      switch (cmd.kind) {
        case 'cmdlet': return this.invokeCmdlet(cmd.def, args, input, { ...o, pos, scope, node });
        case 'function': return { out: await this.invokeFunction(cmd.fn, args, input, scope), ok: true };
        case 'builtinFn': return this.invokeBuiltinFn(cmd.name, args, input, { ...o, pos, scope });
        case 'script': return { out: await this.runScript(cmd.path, args, scope), ok: true };
        case 'native': return this.invokeNative(cmd, args, input, { ...o, pos });
        default: return { out: [], ok: true };
      }
    }
    async invokeBuiltinFn(name, args, input, o) {
      if (name === 'mkdir') return this.invokeCmdlet(findCmdlet('New-Item'), [{ kind: 'param', name: 'ItemType', explicit: true, value: 'Directory' }, ...args], input, o);
      if (name === 'help') return this.invokeCmdlet(findCmdlet('Get-Help'), args, input, o);
      if (name === 'cd..' || name === 'cd\\') return this.invokeCmdlet(findCmdlet('Set-Location'), [{ kind: 'arg', value: name.slice(2) }], input, o);
      if (name === 'prompt') return { out: [this.prompt()], ok: true };
      return { out: [], ok: true };
    }
    async invokeFunction(fn, args, input, scope) {
      const s = { vars: new Map(), parent: scope };
      const params = fn.params || [];
      const bound = new Set();
      const extra = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.kind === 'param') {
          const p = params.find(x => x.name.toLowerCase() === a.name.toLowerCase()) || params.find(x => x.name.toLowerCase().startsWith(a.name.toLowerCase()));
          if (!p) { extra.push('-' + a.name); continue; }
          let v = a.value;
          if (!a.explicit) { const nx = args[i + 1]; if (nx && nx.kind === 'arg' && !/^switch$/i.test(p.type || '')) { v = nx.value; i++; } else v = true; }
          s.vars.set(p.name.toLowerCase(), { name: p.name, value: p.type ? cast(p.type, v, this) : v });
          bound.add(p.name.toLowerCase());
        } else extra.push(a.value);
      }
      const positional = [...extra];
      const rest = [];
      for (const p of params) {
        if (bound.has(p.name.toLowerCase())) continue;
        if (positional.length && !(typeof positional[0] === 'string' && positional[0].startsWith('-'))) { const v = positional.shift(); s.vars.set(p.name.toLowerCase(), { name: p.name, value: p.type ? cast(p.type, v, this) : v }); }
        else s.vars.set(p.name.toLowerCase(), { name: p.name, value: p.def ? await this.evalExpr(p.def, s) : null });
      }
      rest.push(...positional);
      s.vars.set('args', { name: 'args', value: rest });
      s.vars.set('input', { name: 'input', value: input || [] });
      const prev = this.scope;
      this.scope = s;
      try { return await this.evalBlock({ statements: fn.body.node ? fn.body.node.statements : fn.body.statements }, s); }
      catch (e) { if (e instanceof FlowSignal && e.kind === 'return') return toArray(e.value); throw e; }
      finally { this.scope = prev; }
    }
    /** Invoke a script block: under = $_, args = $args. */
    async invokeBlock(sb, o = {}) {
      const s = o.dot ? (o.scope || this.scope) : { vars: new Map(), parent: o.scope || this.scope };
      if (o.under !== undefined) s.vars.set('_', { name: '_', value: o.under });
      s.vars.set('args', { name: 'args', value: o.args || [] });
      if (o.input) s.vars.set('input', { name: 'input', value: o.input });
      const node = sb.node;
      if (node.params) {
        const args = (o.args || []).slice();
        for (const p of node.params) s.vars.set(p.name.toLowerCase(), { name: p.name, value: args.length ? args.shift() : p.def ? await this.evalExpr(p.def, s) : null });
      }
      const prev = this.scope;
      this.scope = s;
      try { return await this.evalStatements(node.statements, s); }
      catch (e) { if (e instanceof FlowSignal && e.kind === 'return') return toArray(e.value); throw e; }
      finally { this.scope = prev; }
    }
    async runScript(path, args, scope) {
      let text;
      try { text = WS.fs.readFile(path); } catch (e) { throw rtError(`The term '${path}' is not recognized as the name of a cmdlet, function, script file, or operable program.`, { category: 'ObjectNotFound', id: 'CommandNotFoundException' }); }
      let ast;
      try { ast = PS.parse(text); } catch (e) {
        if (e instanceof PS.ParseError) throw new PSRuntimeError(new ErrorRecord({ message: e.message, category: 'ParserError', exception: 'ParentContainsErrorRecordException', id: e.id, parse: true, pos: { src: text, start: e.pos, end: e.pos + 1, file: path } }));
        throw e;
      }
      const s = { vars: new Map(), parent: this.globals === scope.vars ? scope : this.scope };
      s.vars.set('args', { name: 'args', value: args.filter(a => a.kind === 'arg').map(a => a.value) });
      s.vars.set('psscriptroot', { name: 'PSScriptRoot', value: path.replace(/\\[^\\]*$/, '') });
      s.vars.set('pscommandpath', { name: 'PSCommandPath', value: path });
      if (ast.params) {
        const pos = args.filter(a => a.kind === 'arg').map(a => a.value);
        for (const p of ast.params) {
          const named = args.find(a => a.kind === 'param' && a.name.toLowerCase() === p.name.toLowerCase());
          let v = named ? (named.explicit ? named.value : args[args.indexOf(named) + 1] && args[args.indexOf(named) + 1].value) : pos.length ? pos.shift() : p.def ? await this.evalExpr(p.def, s) : null;
          s.vars.set(p.name.toLowerCase(), { name: p.name, value: v });
        }
      }
      const prevSrc = this.src, prev = this.scope;
      this.src = text; this.scope = s;
      const out = [];
      try {
        for (const st of ast.statements) {
          try { out.push(...await this.evalStatement(st, s)); }
          catch (e) {
            if (e instanceof FlowSignal && e.kind === 'return') { out.push(...toArray(e.value)); break; }
            if (e instanceof PSRuntimeError && e.record.pos && !e.record.pos.file) e.record.pos.file = path;
            throw e;
          }
        }
      } finally { this.src = prevSrc; this.scope = prev; }
      return out;
    }
    async invokeNative(cmd, args, input, o) {
      const argv = [];
      for (const a of args) {
        if (a.kind === 'param') argv.push('-' + a.name + (a.explicit ? ':' + toStr(a.value) : ''));
        else for (const v of toArray(a.value)) argv.push(toStr(v));
      }
      const captured = [];
      let partial = '';
      const stream = o.stream;
      const io = WS.term.makeIO(this, {
        write: t => { if (stream) this.write(t); else { partial += t; const parts = partial.split('\n'); partial = parts.pop(); captured.push(...parts.map(x => x.replace(/\r$/, ''))); } },
        error: t => this.write(t),
        input: input ? input.map(toStr) : null
      });
      let code = 0;
      try { code = await cmd.nat.run(argv, io) || 0; }
      finally { if (partial) captured.push(partial); }
      this.setVar('global:LASTEXITCODE', code);
      return { out: captured, ok: code === 0 };
    }

    /* ---------------- cmdlet binding ---------------- */
    async invokeCmdlet(def, args, input, o) {
      const specs = def.specs.concat(COMMON, def.shouldProcess ? SHOULD : []);
      const activity = def.name;
      const bindErr = (message, id, extra = {}) => new PSRuntimeError(new ErrorRecord({ message, activity, category: 'InvalidArgument', exception: 'ParameterBindingException', id: `${id},${def.cls}`, pos: o.pos, ...extra }));
      const find = name => {
        const n = name.toLowerCase();
        const exact = specs.find(s => s.name.toLowerCase() === n || (s.alias || []).some(a => a.toLowerCase() === n));
        if (exact) return exact;
        const c = specs.filter(s => s.name.toLowerCase().startsWith(n));
        if (c.length === 1) return c[0];
        if (c.length > 1) throw bindErr(`Parameter cannot be processed because the parameter name '${name}' is ambiguous. Possible matches include: ${c.map(s => '-' + s.name).join(' ')}.`, 'AmbiguousParameter');
        throw bindErr(`A parameter cannot be found that matches parameter name '${name}'.`, 'NamedParameterNotFound');
      };
      const params = {};
      const positional = [];
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.kind !== 'param') { positional.push(a.value); continue; }
        const s = find(a.name);
        if (s.type === 'switch') { params[s.name] = a.explicit ? toBool(a.value) : true; continue; }
        if (a.explicit) { params[s.name] = this.convertParam(s, a.value, bindErr); continue; }
        const nx = args[i + 1];
        if (!nx || nx.kind === 'param') {
          throw bindErr(`Missing an argument for parameter '${s.name}'. Specify a parameter of type '${specTypeName(s)}' and try again.`, 'MissingArgument');
        }
        params[s.name] = this.convertParam(s, nx.value, bindErr);
        i++;
      }
      const posSpecs = def.specs.filter(s => s.pos != null).sort((a, b) => a.pos - b.pos);
      for (const v of positional) {
        const s = posSpecs.find(x => !(x.name in params));
        if (!s) throw bindErr(`A positional parameter cannot be found that accepts argument '${toStr(v)}'.`, 'PositionalParameterNotFound');
        params[s.name] = this.convertParam(s, v, bindErr);
      }
      // mandatory parameters: prompt like PowerShell does
      const pipeSpecs = def.specs.filter(s => s.pipe);
      const missing = def.specs.filter(s => s.mandatory && !(s.name in params) && !(input && input.length && s.pipe) && (!s.set || !def.specs.some(x => x.set && x.set !== s.set && x.name in params)));
      if (missing.length) {
        if (!this.console || o.noPrompt) throw bindErr(`Cannot process command because of one or more missing mandatory parameters: ${missing.map(m => m.name).join(' ')}.`, 'MissingMandatoryParameter');
        this.writeLine(`\ncmdlet ${def.name} at command pipeline position ${o.position || 1}`);
        this.writeLine('Supply values for the following parameters:');
        for (const s of missing) {
          if (/\[\]$/.test(s.type)) {
            const vals = [];
            for (let k = 0; ; k++) {
              const line = await this.console.readLine({ prompt: `${s.name}[${k}]: ` });
              if (line === null) throw new PipelineStopped();
              if (line === '') break;
              vals.push(line);
            }
            if (!vals.length) throw bindErr(`Cannot bind argument to parameter '${s.name}' because it is an empty array.`, 'ParameterArgumentValidationErrorEmptyArrayNotAllowed', { category: 'InvalidData' });
            params[s.name] = this.convertParam(s, vals, bindErr);
          } else {
            const line = await this.console.readLine({ prompt: `${s.name}: `, secure: s.type === 'securestring' });
            if (line === null) throw new PipelineStopped();
            if (line === '') throw bindErr(`Cannot bind argument to parameter '${s.name}' because it is an empty string.`, 'ParameterArgumentValidationErrorEmptyStringNotAllowed', { category: 'InvalidData' });
            params[s.name] = s.type === 'securestring' ? new SecureString(line) : this.convertParam(s, line, bindErr);
          }
        }
      }
      // run
      const ctx = this.makeCtx(def, params, o);
      const ea = params.ErrorAction || this.errorAction;
      ctx.ea = ea;
      try {
        if (def.begin) await def.begin(ctx, params);
        const proc = def.process || def.run;
        if (input === undefined) {
          if (proc) await proc.call(def, ctx, params, undefined);
        } else {
          for (const item of input) {
            this.checkCancel();
            let p = params;
            if (pipeSpecs.length) {
              p = { ...params };
              let bound = false;
              for (const s of pipeSpecs) {
                if (s.name in params) continue;
                if (s.pipe === 'value' || s.pipe === 'both') {
                  if (s.accepts && !s.accepts(item)) continue;
                  try { p[s.name] = this.convertParam(s, item, bindErr); bound = true; break; } catch (e) { if (s.pipe === 'value') continue; }
                }
                if (s.pipe === 'name' || s.pipe === 'both') {
                  const v = isObj(item) || item instanceof PSHashtable ? [s.name, ...(s.alias || [])].map(nm => getProp(item, nm)).find(x => x != null) : undefined;
                  if (v != null) { p[s.name] = this.convertParam(s, v, bindErr); bound = true; }
                }
              }
              if (!bound && !def.specs.some(s => s.pipe && s.name in params)) {
                ctx.error({ message: 'The input object cannot be bound to any parameters for the command either because the command does not take pipeline input or the input and its properties do not match any of the parameters that take pipeline input.', category: 'InvalidArgument', target: toStr(item), targetType: shortType(item), exception: 'ParameterBindingException', id: `InputObjectNotBound,${def.cls}` });
                continue;
              }
            } else if (!def.acceptsInput) {
              ctx.error({ message: 'The input object cannot be bound to any parameters for the command either because the command does not take pipeline input or the input and its properties do not match any of the parameters that take pipeline input.', category: 'InvalidArgument', target: toStr(item), targetType: shortType(item), exception: 'ParameterBindingException', id: `InputObjectNotBound,${def.cls}` });
              continue;
            }
            if (proc) await proc.call(def, ctx, p, item);
          }
        }
        if (def.end) await def.end(ctx, params);
      } catch (e) {
        if (e instanceof PSRuntimeError && !e.record.activity) { e.record.activity = def.name; e.record.CategoryInfo.Activity = def.name; }
        if (e instanceof PSRuntimeError && !e.record.pos) e.record.pos = o.pos;
        throw e;
      } finally { if (ctx.progressShown && this.console) this.console.setProgress(null); }
      if (params.OutVariable) this.setVar(params.OutVariable, unwrap(ctx.outputs));
      return { out: ctx.outputs, ok: !ctx.hadError };
    }
    convertParam(s, v, bindErr) {
      const t = s.type;
      const conv = (label, fn) => { try { return fn(); } catch (e) { throw bindErr(`Cannot bind parameter '${s.name}'. Cannot convert value "${toStr(v)}" to type "${label}". Error: "${e.record ? e.record.message.replace(/^.*Error: "|"$/g, '') : e.message}"`, 'CannotConvertArgumentNoMessage'); } };
      switch (t) {
        case 'string': if (Array.isArray(v) && v.length > 1 && !s.join) return v.map(toStr).join(' '); return toStr(Array.isArray(v) ? v[0] : v);
        case 'string[]': return toArray(v).map(toStr);
        case 'int': case 'long': case 'uint64': case 'double': {
          const label = { int: 'System.Int32', long: 'System.Int64', uint64: 'System.UInt64', double: 'System.Double' }[t];
          return conv(label, () => { const n = toNum(Array.isArray(v) ? v[0] : v, label); return t === 'double' ? n : Math.round(n); });
        }
        case 'int[]': return toArray(v).map(x => conv('System.Int32', () => Math.round(toNum(x))));
        case 'bool': case 'switch': return toBool(v);
        case 'scriptblock':
          if (v instanceof ScriptBlock) return v;
          throw bindErr(`Cannot bind parameter '${s.name}'. Cannot convert the "${toStr(v)}" value of type "${typeName(v)}" to type "System.Management.Automation.ScriptBlock".`, 'CannotConvertArgumentNoMessage');
        case 'securestring':
          if (v instanceof SecureString) return v;
          throw bindErr(`Cannot bind parameter '${s.name}'. Cannot convert the "${toStr(v)}" value of type "${typeName(v)}" to type "System.Security.SecureString".`, 'CannotConvertArgumentNoMessage');
        case 'hashtable':
          if (v instanceof PSHashtable) return v;
          throw bindErr(`Cannot bind parameter '${s.name}'. Cannot convert the "${toStr(v)}" value of type "${typeName(v)}" to type "System.Collections.Hashtable".`, 'CannotConvertArgumentNoMessage');
        case 'datetime': return conv('System.DateTime', () => cast('datetime', v));
        case 'enum': case 'enum[]': {
          const one = x => {
            const sv = toStr(x);
            const hit = s.values.find(e => e.toLowerCase() === sv.toLowerCase());
            if (hit) return hit;
            if (s.enumType) throw bindErr(`Cannot bind parameter '${s.name}'. Cannot convert value "${sv}" to type "${s.enumType}". Error: "Unable to match the identifier name ${sv} to a valid enumerator name. Specify one of the following enumerator names and try again:\n${s.values.join(', ')}"`, 'CannotConvertArgumentNoMessage');
            throw bindErr(`Cannot validate argument on parameter '${s.name}'. The argument "${sv}" does not belong to the set "${s.values.join(',')}" specified by the ValidateSet attribute. Supply an argument that is in the set and then try the command again.`, 'ParameterArgumentValidationError', { category: 'InvalidData' });
          };
          return t === 'enum[]' ? toArray(v).map(one) : one(Array.isArray(v) ? v[0] : v);
        }
        case 'object[]': return toArray(v);
        default: return v;
      }
    }
    makeCtx(def, params, o) {
      const session = this;
      const ctx = {
        session, def, name: def.name, params, scope: o.scope || this.scope, outputs: [], hadError: false, state: {}, pos: o.pos,
        out(v) { if (v === undefined) return; ctx.outputs.push(v); },
        outMany(arr) { for (const v of arr) ctx.out(v); },
        error(r) {
          ctx.hadError = true;
          const rec = r instanceof ErrorRecord ? r : new ErrorRecord({ activity: def.name, pos: o.pos, ...r });
          if (!rec.pos) rec.pos = o.pos;
          const ea = ctx.ea || session.errorAction;
          if (ea === 'Stop') throw new PSRuntimeError(rec);
          if (ea === 'Ignore') return;
          if (ea === 'SilentlyContinue') { session.errors.unshift(rec); return; }
          session.writeErrorRecord(rec);
        },
        throw(r) { throw new PSRuntimeError(r instanceof ErrorRecord ? r : new ErrorRecord({ activity: def.name, pos: o.pos, ...r })); },
        /** Turn a model { ok:false, error } into an error record. */
        fail(res, extra = {}) { ctx.error({ message: res.error || 'The operation failed.', category: 'NotSpecified', exception: 'Exception', id: def.name, ...extra }); },
        warn(t) { const wa = params.WarningAction || toStr(session.getVar('WarningPreference')); if (wa === 'SilentlyContinue' || wa === 'Ignore') return; session.write('WARNING: ' + t + '\n', { fg: 'Yellow', bg: 'Black' }); },
        verbose(t) { if (params.Verbose) session.write('VERBOSE: ' + t + '\n', { fg: 'Yellow', bg: 'Black' }); },
        host(text, style) { session.write(text, style); },
        progress(p) { ctx.progressShown = true; if (session.console) session.console.setProgress(p); },
        async sleep(ms) { await U.sleep(ms); session.checkCancel(); },
        async confirm(action, target, co = {}) {
          if (params.WhatIf) { session.writeLine(`What if: Performing the operation "${action}" on target "${target}".`); return false; }
          if (ctx.yesToAll) return true;
          if (ctx.noToAll) return false;
          const impact = { Low: 1, Medium: 2, High: 3 }[co.impact || def.impact || 'Medium'];
          const pref = { None: 0, Low: 1, Medium: 2, High: 3 }[toStr(session.getVar('ConfirmPreference'))] || 3;
          const ask = params.Confirm === true || (params.Confirm !== false && impact >= pref);
          if (!ask || !session.console) return true;
          for (;;) {
            session.writeLine('');
            session.writeLine(co.caption || 'Confirm');
            session.writeLine(co.query || 'Are you sure you want to perform this action?');
            if (!co.query) session.writeLine(`Performing the operation "${action}" on target "${target}".`);
            const ans = await session.console.readLine({ prompt: '[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"): ' });
            if (ans === null) throw new PipelineStopped();
            const a = ans.trim().toLowerCase();
            if (a === '' || a === 'y') return true;
            if (a === 'a') { ctx.yesToAll = true; return true; }
            if (a === 'n' || a === 's') return false;
            if (a === 'l') { ctx.noToAll = true; return false; }
            if (a === '?') session.writeLine('Y - Continue with only the next step of the operation.\nA - Continue with all the steps of the operation.\nN - Skip this operation and proceed with the next operation.\nL - Skip this operation and all subsequent operations.\nS - Pause the current pipeline and return to the command prompt. Type "exit" to resume the pipeline.');
          }
        },
        /** Yes/No style prompt with custom choices (Install-ADDSForest, Read-Host...). */
        async ask(caption, message, choices, dflt) {
          if (!session.console) return dflt;
          for (;;) {
            if (caption) session.writeLine(caption);
            if (message) session.writeLine(message);
            const line = await session.console.readLine({ prompt: choices.map(c => `[${c[0]}] ${c[1]}`).join('  ') + `  [?] Help (default is "${dflt}"): ` });
            if (line === null) throw new PipelineStopped();
            const a = line.trim().toUpperCase() || dflt;
            if (choices.some(c => c[0] === a)) return a;
          }
        },
        async prompt(label, po = {}) {
          if (!session.console) return null;
          const line = await session.console.readLine({ prompt: label, secure: po.secure });
          if (line === null) throw new PipelineStopped();
          return line;
        },
        async invokeBlock(sb, bo = {}) { return session.invokeBlock(sb, { scope: ctx.scope, ...bo }); },
        resolvePath: p => session.resolvePath(p)
      };
      return ctx;
    }

    /* ---------------- tab completion ---------------- */
    complete(line, cursor, reverse, st) {
      const c = st.compl;
      if (c && c.line === line && c.cursor === cursor && c.matches.length) {
        c.idx = (c.idx + (reverse ? -1 : 1) + c.matches.length) % c.matches.length;
        return this.applyCompletion(c);
      }
      let start = cursor;
      let inQuote = null;
      for (let i = 0; i < cursor; i++) { const ch = line[i]; if (inQuote) { if (ch === inQuote) inQuote = null; } else if (ch === '"' || ch === "'") inQuote = ch; }
      if (inQuote) start = line.lastIndexOf(inQuote, cursor - 1);
      else while (start > 0 && !/[\s|;(){}=,]/.test(line[start - 1])) start--;
      const word = line.slice(start, cursor).replace(/^["']|["']$/g, '');
      const before = line.slice(0, start);
      const elStart = Math.max(before.lastIndexOf('|'), before.lastIndexOf(';'), before.lastIndexOf('('), before.lastIndexOf('{')) + 1;
      const elText = before.slice(elStart).trim();
      let matches = [];
      if (word.startsWith('-') && elText) {
        const cmdName = elText.split(/\s+/)[0];
        const cmd = this.resolveCommand(cmdName);
        if (cmd && cmd.kind === 'cmdlet') {
          const names = cmd.def.specs.map(s => s.name).concat(COMMON.map(s => s.name), cmd.def.shouldProcess ? ['WhatIf', 'Confirm'] : []);
          matches = names.filter(n => n.toLowerCase().startsWith(word.slice(1).toLowerCase())).map(n => '-' + n);
        }
      } else if (word.startsWith('$')) {
        const names = new Set();
        for (let s = this.scope; s; s = s.parent) for (const v of s.vars.values()) names.add(v.name);
        ['env:COMPUTERNAME', 'env:USERNAME', 'env:USERDOMAIN', 'env:PATH', 'PSVersionTable', 'HOME', 'PWD', 'Error', 'LASTEXITCODE', 'Host', 'PROFILE'].forEach(n => names.add(n));
        matches = [...names].filter(n => n.toLowerCase().startsWith(word.slice(1).toLowerCase())).sort().map(n => '$' + n);
      } else if (!elText && !/[\\/:]/.test(word)) {
        const set = new Set();
        for (const d of Object.values(cmdlets)) if (available(d)) set.add(d.name);
        for (const n of this.functions.keys()) set.add(n);
        for (const n of WS.term.nativeNames()) set.add(n + '.exe');
        matches = [...set].filter(n => n.toLowerCase().startsWith(word.toLowerCase())).sort((a, b) => a.localeCompare(b));
        if (!matches.length) matches = this.pathMatches(word, true);
      } else matches = this.pathMatches(word, false);
      if (!matches.length) return null;
      st.compl = { start, end: cursor, matches, idx: 0, base: line, baseEnd: cursor, line: null, cursor: null };
      return this.applyCompletion(st.compl);
    }
    applyCompletion(c) {
      let m = c.matches[c.idx];
      if (/\s/.test(m) && !/^['"]/.test(m)) m = `'${m}'`;
      const line = c.base.slice(0, c.start) + m + c.base.slice(c.baseEnd);
      c.line = line; c.cursor = c.start + m.length;
      return { line, cursor: c.cursor };
    }
    pathMatches(word, execOnly) {
      const sep = Math.max(word.lastIndexOf('\\'), word.lastIndexOf('/'));
      const dirPart = sep >= 0 ? word.slice(0, sep + 1) : '';
      const prefix = (sep >= 0 ? word.slice(sep + 1) : word).toLowerCase();
      const dir = dirPart ? this.resolvePath(dirPart) : this.cwd;
      let items = [];
      try { items = WS.fs.list(dir); } catch (e) { return []; }
      return items.filter(x => x.name.toLowerCase().startsWith(prefix) && (!execOnly || x.type === 'dir' || /\.(ps1|exe|cmd|bat)$/i.test(x.name)))
        .map(x => (dirPart || (execOnly ? '.\\' : '')) + x.name);
    }
  }
  function specTypeName(s) {
    return { string: 'System.String', 'string[]': 'System.String[]', int: 'System.Int32', long: 'System.Int64', uint64: 'System.UInt64', double: 'System.Double', bool: 'System.Boolean', scriptblock: 'System.Management.Automation.ScriptBlock', securestring: 'System.Security.SecureString', hashtable: 'System.Collections.Hashtable', datetime: 'System.DateTime', 'object[]': 'System.Object[]', object: 'System.Object', enum: s.enumType || 'System.String', 'enum[]': (s.enumType || 'System.String') + '[]', 'int[]': 'System.Int32[]' }[s.type] || 'System.Object';
  }

  Object.assign(PS, {
    Session, PSHashtable, ScriptBlock, SecureString, TypeRef, ErrorRecord, PSRuntimeError, PipelineStopped, FlowSignal,
    psobj, typeName, shortType, toStr, toBool, toArray, unwrap, toNum, cast, getProp, callMethod, formatError, binary, eq, cmp, formatOp, wildcardRe,
    cmdlet, cmdlets, aliases, findCmdlet, available, specTypeName, fmtDateTime, COMMON, isObj, rtError
  });
})();
