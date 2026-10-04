/* Windows Server 2025 Lab Simulator - core utilities
 * Everything hangs off the global WS namespace. No build step, no modules,
 * so the app works from file:// as well as any static web server. */
(function () {
  'use strict';
  const WS = window.WS = window.WS || {};

  const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'multiple',
    'tabIndex', 'htmlFor', 'indeterminate', 'spellcheck', 'autofocus', 'placeholder', 'type', 'name', 'title', 'src', 'href', 'rows', 'cols', 'maxLength', 'min', 'max', 'step']);

  /** Element builder: h('div.cls1.cls2', {attrs}, ...children) */
  function h(tag, attrs, ...children) {
    let el;
    if (tag instanceof Node) el = tag;
    else {
      const parts = String(tag).split('.');
      el = parts[0] === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(parts[0] || 'div');
      if (parts.length > 1) el.setAttribute('class', parts.slice(1).join(' '));
    }
    if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false && !PROP_KEYS.has(k)) continue;
        if (k === 'class' || k === 'className') {
          const cur = el.getAttribute('class');
          el.setAttribute('class', (cur ? cur + ' ' : '') + v);
        } else if (k === 'style') {
          if (typeof v === 'string') el.style.cssText += ';' + v; else Object.assign(el.style, v);
        } else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROP_KEYS.has(k)) { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) append(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
    return el;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let uidCounter = 0;
  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + (++uidCounter).toString(36) + Math.random().toString(36).slice(2, 6); }

  function guid() {
    const hex = () => Math.floor(Math.random() * 16).toString(16);
    const s = n => Array.from({ length: n }, hex).join('');
    return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${s(3)}-${s(12)}`;
  }

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad(n, w = 2, ch = '0') { return String(n).padStart(w, ch); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
  function deepClone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function randomAlnum(n, upper = true) {
    const chars = upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' : 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function randomMac(prefix = '00-15-5D') {
    const b = () => pad(randInt(0, 255).toString(16).toUpperCase());
    return `${prefix}-${b()}-${b()}-${b()}`;
  }

  /* ---------- formatting ---------- */
  function fmtBytes(n, digits) {
    if (n == null || isNaN(n)) return '';
    const u = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    if (i === 0) return n + ' bytes';
    const d = digits != null ? digits : (n >= 100 ? 0 : n >= 10 ? 1 : 2);
    return n.toFixed(d).replace(/\.0+$/, '') + ' ' + u[i];
  }
  /** Explorer style size: "12 KB" (always KB, rounded up) */
  function fmtKB(n) { return (n == null) ? '' : Math.max(1, Math.ceil(n / 1024)).toLocaleString('en-US') + ' KB'; }

  function toDate(d) { return d instanceof Date ? d : new Date(d); }
  function fmtDate(d) { d = toDate(d); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; }
  function fmtTime(d, secs) {
    d = toDate(d);
    let hh = d.getHours(); const ap = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12 || 12;
    return `${hh}:${pad(d.getMinutes())}${secs ? ':' + pad(d.getSeconds()) : ''} ${ap}`;
  }
  function fmtDateTime(d, secs = true) { return `${fmtDate(d)} ${fmtTime(d, secs)}`; }
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function fmtLongDate(d) { d = toDate(d); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }

  /* ---------- networking helpers ---------- */
  function isValidIp(ip) {
    if (typeof ip !== 'string') return false;
    const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    return m.slice(1).every(o => +o >= 0 && +o <= 255 && String(+o) === o);
  }
  function ipToInt(ip) {
    if (!isValidIp(ip)) return NaN;
    return ip.split('.').reduce((a, o) => ((a << 8) + (+o)) >>> 0, 0) >>> 0;
  }
  function intToIp(n) { n = n >>> 0; return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  function prefixToMask(p) { p = +p; if (!(p >= 0 && p <= 32)) return ''; return intToIp(p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0); }
  function maskToPrefix(mask) {
    const n = ipToInt(mask);
    if (isNaN(n)) return -1;
    const inv = (~n) >>> 0;
    if ((inv & (inv + 1)) !== 0) return -1; // not contiguous
    let p = 0; for (let i = 31; i >= 0; i--) { if ((n >>> i) & 1) p++; else break; }
    return p;
  }
  function isValidMask(mask) { return maskToPrefix(mask) > 0; }
  function networkOf(ip, prefix) { return intToIp((ipToInt(ip) & ipToInt(prefixToMask(prefix))) >>> 0); }
  function broadcastOf(ip, prefix) { return intToIp((ipToInt(networkOf(ip, prefix)) | (~ipToInt(prefixToMask(prefix)) >>> 0)) >>> 0); }
  function inSubnet(ip, net, prefix) { return isValidIp(ip) && networkOf(ip, prefix) === networkOf(net, prefix); }
  function ipCompare(a, b) { return ipToInt(a) - ipToInt(b); }
  /** 192.168.1.0/24 -> 1.168.192.in-addr.arpa */
  function reverseZoneName(network, prefix) {
    const octets = network.split('.');
    const n = Math.max(1, Math.min(3, Math.floor(prefix / 8)));
    return octets.slice(0, n).reverse().join('.') + '.in-addr.arpa';
  }

  /* ---------- names & passwords ---------- */
  function validateComputerName(name) {
    name = String(name || '').trim();
    if (!name) return 'The computer name cannot be blank.';
    if (name.length > 15) return `The new computer name "${name}" is too long. The name may contain at most 15 characters.`;
    if (/^\d+$/.test(name)) return `The new computer name "${name}" contains only numbers. Computer names cannot contain only numbers.`;
    if (/[^A-Za-z0-9-]/.test(name)) return `The new computer name "${name}" contains characters that are not allowed. Standard characters include letters (A-Z, a-z), digits (0-9), and hyphens (-).`;
    if (name.startsWith('-') || name.endsWith('-')) return `The new computer name "${name}" is not valid. Names cannot begin or end with a hyphen.`;
    return null;
  }

  /** Windows default complexity rules. Returns null when OK, else an error message. */
  function checkPassword(pw, opts = {}) {
    const minLen = opts.minLength != null ? opts.minLength : 7;
    const complexity = opts.complexity !== false;
    pw = pw || '';
    const generic = opts.message || 'The password does not meet the password policy requirements. Check the minimum password length, password complexity and password history requirements.';
    if (pw.length < minLen) return generic;
    if (complexity) {
      let cats = 0;
      if (/[A-Z]/.test(pw)) cats++;
      if (/[a-z]/.test(pw)) cats++;
      if (/[0-9]/.test(pw)) cats++;
      if (/[^A-Za-z0-9]/.test(pw)) cats++;
      if (cats < 3 || pw.length < 6) return generic;
      const names = [opts.sam, opts.displayName].filter(Boolean);
      for (const n of names) {
        if (n.length >= 3 && pw.toLowerCase().includes(n.toLowerCase())) return generic;
      }
    }
    return null;
  }

  function wildcardToRegex(pattern) {
    const re = String(pattern).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + re + '$', 'i');
  }

  /** Simple pseudo-random but stable number from a string. */
  function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

  function downloadText(filename, text, mime = 'application/json') {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  WS.util = {
    h, append, clear, esc, uid, guid, randInt, pick, clamp, pad, sleep, debounce, deepClone, randomAlnum, randomMac,
    fmtBytes, fmtKB, fmtDate, fmtTime, fmtDateTime, fmtLongDate, DAYS, MONTHS,
    isValidIp, ipToInt, intToIp, prefixToMask, maskToPrefix, isValidMask, networkOf, broadcastOf, inSubnet, ipCompare, reverseZoneName,
    validateComputerName, checkPassword, wildcardToRegex, hashStr, downloadText
  };
  WS.h = h;
})();
