/* Microsoft Edge (a lab mock): tabs, back/forward/refresh, an address bar that takes URLs, host names, paths and search
 * text. Every request goes through the lab network: the name is resolved with WS.net.resolve (hosts file, DNS servers,
 * LLMNR), then routed with WS.net.route. A request to one of this server's own addresses goes to WS.iis.request, which
 * picks the site by binding (protocol, address, port, host header) and returns its content, a directory listing, a
 * 301 courtesy redirect, HTTP.sys's 400/503 pages or IIS's detailed errors. HTTPS uses the binding's certificate: a
 * self-signed one gives "Your connection isn't private" until Advanced > Continue (remembered for the session).
 * Pages render without scripts (a sandboxed frame); links inside them navigate the tab. Other lab machines refuse or
 * time out, and reachable Internet sites show a lab page (external sites are not simulated). file:/// shows local files.
 *   WS.apps.launch('edge', { url }) -> win (opens a tab in a running Edge); win.edge = { go(text), url(), title(), back(),
 *     forward(), refresh(), newTab(url), closeTab(i), tabs(), active(), text(), frameDoc() }
 *   WS.edge.serve(url, { ignoreCert }) -> { kind: 'html'|'text'|'image'|'iis-error'|'cert'|'error'|'internal'|'redirect',
 *     title, status, code, html?, text?, location? } (no UI; tests, lab checks and Invoke-WebRequest use it) */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons;
    const VERSION = '130.0.2849.68';
  const s16 = b => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2">${b}</svg>`;
  const IC = {
    back: s16('<path d="M13 8H3M7 4L3 8l4 4"/>'), fwd: s16('<path d="M3 8h10M9 4l4 4-4 4"/>'), refresh: s16('<path d="M13 8a5 5 0 1 1-1.5-3.6M12 1.8v2.8H9.2"/>'),
    stop: s16('<path d="M4 4l8 8M12 4l-8 8"/>'), home: s16('<path d="M2.5 7.5L8 3l5.5 4.5V13H9.5V9.5h-3V13h-4z"/>'), info: s16('<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5v.1"/>'),
    lock: s16('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'), star: s16('<path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/>'),
    more: s16('<circle cx="3.5" cy="8" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="12.5" cy="8" r=".6" fill="currentColor"/>'),
    plus: s16('<path d="M8 3v10M3 8h10"/>'), close: s16('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'), search: s16('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.5 3.5"/>'),
    page: s16('<path d="M4 1.5h5.5L12.5 4.5V14.5H4z"/>'), file: s16('<path d="M4 1.5h5.5L12.5 4.5V14.5H4z"/><path d="M9.5 1.5v3h3"/>'),
    folder: s16('<path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>'),
    sad: '<svg viewBox="0 0 64 64" fill="none" stroke="#5d5d5d" stroke-width="2"><path d="M14 6h26l12 12v40H14z"/><path d="M40 6v12h12"/><circle cx="26" cy="32" r="1.6" fill="#5d5d5d"/><circle cx="40" cy="32" r="1.6" fill="#5d5d5d"/><path d="M25 45c4-4 12-4 16 0"/></svg>'
  };

  /* ================================================================ the request pipeline (no UI) */
  const esc = U.esc;
  const winPath = urlPath => decodeURIComponent(urlPath).replace(/\//g, '\\');
  const extOf = p => (/\.([^.\\/]+)$/.exec(p) || [])[1] || '';
  const TEXT_EXT = new Set(['txt', 'css', 'js', 'xml', 'json', 'log', 'csv', 'md', 'config']);
  const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg']);

  /** What the address bar turns text into: a URL, or a search. */
  function normalize(text) {
    const t = String(text || '').trim();
    if (!t) return 'edge://newtab';
    if (/^(edge|about):/i.test(t)) return t.toLowerCase().replace(/^about:/, 'edge://').replace(/^edge:\/\/(blank)?$/, 'edge://newtab');
    if (/^[a-z]:\\/i.test(t) || /^\\\\/.test(t)) return 'file:///' + t.replace(/\\/g, '/').replace(/ /g, '%20');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
    // a host (with optional port and path): localhost, names with a dot, IP addresses, or single-label names that resolve
    const m = /^([^\s/?#:]+)(:\d+)?([/?#].*)?$/.exec(t);
    if (m && !/\s/.test(t) && (/^localhost$/i.test(m[1]) || m[1].includes('.') || U.isValidIp(m[1]) || m[2] || WS.net.resolve(m[1]).ok)) return 'http://' + t;
    return 'https://www.bing.com/search?q=' + encodeURIComponent(t).replace(/%20/g, '+');
  }

  function serve(url, o = {}) {
    if (/^edge:\/\//i.test(url)) return internal(url);
    let u;
    try { u = new URL(url); } catch (e) { return error('ERR_INVALID_URL', url, 'Hmm\u2026 can\u2019t reach this page', [`${esc(url)} isn\u2019t a valid web address.`]); }
    if (u.protocol === 'file:') return file(u);
    if (!/^https?:$/.test(u.protocol)) return error('ERR_UNKNOWN_URL_SCHEME', u.href, 'Hmm\u2026 can\u2019t reach this page', ['The web page might be temporarily down or it may have moved permanently to a new web address.']);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const anyUp = WS.net.adapters().some(a => WS.net.usable(a) && a.ip);
    const isLocalName = /^localhost$/i.test(host) || host === '127.0.0.1' || host === '::1';
    if (!anyUp && !isLocalName) return error('ERR_INTERNET_DISCONNECTED', host, 'You\u2019re not connected', ['Try:', ['Checking the network cables, modem, and router', 'Reconnecting to Wi-Fi', 'Running Windows Network Diagnostics']]);
    const r = WS.net.resolve(host);
    if (!r.ok) {
      return r.error === 'timeout'
        ? error('DNS_PROBE_FINISHED_BAD_CONFIG', host, 'Hmm\u2026 can\u2019t reach this page', [`<b>${esc(host)}</b>\u2019s server IP address could not be found.`, 'Try:', ['Checking the connection', 'Checking the proxy, firewall, and DNS configuration', 'Running Windows Network Diagnostics']])
        : error('DNS_PROBE_FINISHED_NXDOMAIN', host, 'Hmm\u2026 can\u2019t reach this page', [`Check if there is a typo in <b>${esc(host)}</b>.`, 'If spelling is correct, try running Windows Network Diagnostics.']);
    }
    const route = WS.net.route(r.ip);
    if (route === 'local') return iis(u, r, o);
    if (route === 'direct') {
      const peer = WS.state.network.peers.find(p => p.ip === r.ip);
      return peer
        ? error('ERR_CONNECTION_REFUSED', host, 'Hmm\u2026 can\u2019t reach this page', [`<b>${esc(host)}</b> refused to connect.`, 'Try:', ['Checking the connection', 'Checking the proxy and the firewall']])
        : error('ERR_CONNECTION_TIMED_OUT', host, 'Hmm\u2026 can\u2019t reach this page', [`<b>${esc(host)}</b> took too long to respond.`, 'Try:', ['Checking the connection', 'Checking the proxy and the firewall', 'Running Windows Network Diagnostics']]);
    }
    const inet = route === 'routed' && WS.state.network.lan.internet && WS.net.INTERNET.some(x => x.ip === r.ip);
    if (!inet) return error('ERR_CONNECTION_TIMED_OUT', host, 'Hmm\u2026 can\u2019t reach this page', [`<b>${esc(host)}</b> took too long to respond.`, 'Try:', ['Checking the connection', 'Checking the proxy and the firewall', 'Running Windows Network Diagnostics']]);
    return external(u, r);
  }

  function error(code, host, title, lines) {
    const body = lines.map(l => (Array.isArray(l) ? `<ul>${l.map(x => `<li>${x}</li>`).join('')}</ul>` : `<p>${l}</p>`)).join('');
    return { kind: 'error', title: host, status: 0, code, html: `<h1>${title}</h1>${body}<div class="ed-code">${code}</div>` };
  }

  /* ---- IIS on this server: WS.iis.request does what HTTP.sys and IIS do (sites, bindings, host headers, pools...) ---- */
  const proceeded = new Set(); // hosts whose certificate warning was bypassed this session ("Continue to ... (unsafe)")
  function iis(u, r, o = {}) {
    const host = u.hostname, https = u.protocol === 'https:';
    const res = WS.iis.request({ protocol: u.protocol, host, ip: r.ip, port: u.port, path: u.pathname + u.search });
    if (res.kind === 'refused') return error('ERR_CONNECTION_REFUSED', host, 'Hmm\u2026 can\u2019t reach this page', [`<b>${esc(host)}</b> refused to connect.`, 'Try:', ['Checking the connection', 'Checking the proxy and the firewall']]);
    if (res.kind === 'reset') return error('ERR_CONNECTION_RESET', host, 'Hmm\u2026 can\u2019t reach this page', ['The connection was reset.', 'Try:', ['Checking the connection', 'Checking the proxy and the firewall', 'Running Windows Network Diagnostics']]);
    let insecure = false;
    if (https && res.cert) {
      const nameOk = WS.certs.covers(res.cert, host);
      if (!o.ignoreCert && !proceeded.has(host.toLowerCase())) return Object.assign(certError(host, res.cert, nameOk ? 'NET::ERR_CERT_AUTHORITY_INVALID' : 'NET::ERR_CERT_COMMON_NAME_INVALID'), { raw: res });
      insecure = true;
    }
    const base = { status: res.status, phys: res.phys, site: res.site && res.site.name, insecure, raw: res };
    if (res.status === 301 && res.location) return { ...base, kind: 'redirect', location: res.location, title: res.title };
    if (res.detailed) return { ...base, kind: 'iis-error', title: res.title, code: `HTTP ${res.sub}`, html: /<body[^>]*>([\s\S]*)<\/body>/i.exec(res.body)[1] };
    const type = res.contentType || '';
    if (type === 'text/html') return { ...base, kind: 'html', title: res.title || host + u.pathname, html: res.body, code: res.status !== 200 ? `HTTP ${res.status}` : undefined, listing: !!res.listing };
    if (/^text\/|javascript|json/.test(type)) return { ...base, kind: 'text', title: res.title, text: res.body };
    if (/^image\//.test(type)) return { ...base, kind: 'image', title: `${res.title} (image)` };
    return { ...base, kind: 'internal', title: res.title, html: `<p class="ed-dim">${esc(res.title)} was downloaded to C:\\Users\\Administrator\\Downloads (${esc(U.fmtBytes(res.size || 0))}).</p>` };
  }
  function certError(host, cert, code) {
    const why = code === 'NET::ERR_CERT_COMMON_NAME_INVALID'
      ? `This server couldn\u2019t prove that it\u2019s <b>${esc(host)}</b>; its security certificate is from <b>${esc(cert.subject.replace(/^CN=/, ''))}</b>. This may be caused by a misconfiguration or an attacker intercepting your connection.`
      : `This server couldn\u2019t prove that it\u2019s <b>${esc(host)}</b>; its security certificate is not trusted by your computer\u2019s operating system. This may be caused by a misconfiguration or an attacker intercepting your connection.`;
    return { kind: 'cert', title: 'Privacy error', status: 0, code, host, html: `<h1>Your connection isn\u2019t private</h1><p>Attackers might be trying to steal your information from <b>${esc(host)}</b> (for example, passwords, messages, or credit cards).</p><div class="ed-code">${code}</div>`, advanced: why };
  }
  const titleOf = html => { const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || ''); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };

  /* ---- the Internet: reachable, but not simulated ---- */
  function external(u, r) {
    const q = u.searchParams.get('q');
    const a = WS.net.adapter();
    const how = r.source === 'dns' ? `resolved by the DNS server ${r.server}` : r.source === 'hosts' ? 'from the hosts file' : 'resolved';
    const html = `<div class="ed-ext"><div class="ed-ext-badge">Lab Simulator</div><h1>${esc(q != null ? `Search: ${q}` : u.hostname)}</h1>
<p>Your server reached <b>${esc(u.hostname)}</b> (${esc(r.ip)}, ${esc(how)}) through the default gateway ${esc(a.gateway || '')}.</p>
<p>Websites on the Internet aren\u2019t part of the lab simulator, so there is nothing to show here. Name resolution and routing worked, which is usually what a lab is checking.</p></div>`;
    return { kind: 'external', title: q != null ? `${q} - Search` : u.hostname, status: 200, html, ip: r.ip };
  }

  /* ---- file:/// ---- */
  function file(u) {
    let p = decodeURIComponent(u.pathname).replace(/^\/([a-z]:)/i, '$1').replace(/\//g, '\\');
    if (/^[a-z]:$/i.test(p)) p += '\\';
    const st = WS.fs.stat(p);
    const name = p.split('\\').filter(Boolean).pop() || p;
    if (!st) return error('ERR_FILE_NOT_FOUND', name, 'Hmm\u2026 can\u2019t find this file', ['It may have been moved, edited, or deleted.']);
    if (st.type === 'dir') {
      const items = WS.fs.list(p);
      const url = x => 'file:///' + x.path.replace(/\\/g, '/');
      const up = p.replace(/\\[^\\]+\\?$/, '') || p;
      const html = `<h1 class="ed-index">Index of ${esc(p.replace(/\\/g, '/'))}</h1>
${/^[a-z]:\\$/i.test(p) ? '' : `<p><a href="file:///${esc((/^[a-z]:$/i.test(up) ? up + '\\' : up).replace(/\\/g, '/'))}">[parent directory]</a></p>`}
<table class="ed-index-t"><tr><th>Name</th><th>Size</th><th>Date Modified</th></tr>${items.map(x => `<tr><td><a href="${esc(url(x))}">${esc(x.name)}${x.type === 'dir' ? '/' : ''}</a></td><td>${x.type === 'dir' ? '' : esc(U.fmtBytes(x.size))}</td><td>${esc(U.fmtDateTime(x.modified, false))}</td></tr>`).join('')}</table>`;
      return { kind: 'internal', title: p.replace(/\\/g, '/'), status: 200, html };
    }
    const ext = extOf(p).toLowerCase();
    if (/^(htm|html)$/.test(ext)) { const html = WS.fs.readFile(p); return { kind: 'html', title: titleOf(html) || name, status: 200, html, phys: p }; }
    if (TEXT_EXT.has(ext) || ext === 'ps1' || ext === 'ini' || ext === 'inf' || !ext) return { kind: 'text', title: name, status: 200, text: WS.fs.readFile(p), phys: p };
    if (IMG_EXT.has(ext)) return { kind: 'image', title: name, status: 200, phys: p };
    return { kind: 'internal', title: name, status: 200, html: `<p class="ed-dim">${esc(name)} can\u2019t be shown in Microsoft Edge.</p>` };
  }

  /* ---- edge:// pages ---- */
  function internal(url) {
    const page = url.replace(/^edge:\/\//i, '').replace(/\/$/, '').toLowerCase();
    if (page === 'newtab') return { kind: 'newtab', title: 'New tab', status: 200 };
    if (page === 'version') {
      const s = WS.state.system;
      const rows = [['Microsoft Edge', `${VERSION} (Official build) (64-bit)`], ['Revision', 'c8e3ac3b2a1f6d1a9a5b8a9e3b2d0c4e1f6a7b8c'], ['OS', `Windows Server 2025 Version 24H2 (Build ${s.build})`],
        ['JavaScript', 'V8 13.0.245.16'], ['User agent', `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/${VERSION}`],
        ['Command-line', '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --flag-switches-begin --flag-switches-end'],
        ['Executable path', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'], ['Profile path', 'C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default']];
      return { kind: 'internal', title: 'About Version', status: 200, html: `<table class="ed-version">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>` };
    }
    if (page === 'settings' || page.startsWith('settings/')) {
      return { kind: 'internal', title: 'Settings', status: 200, html: `<h1>Settings</h1><p class="ed-dim">Appearance follows the app mode in Windows Settings &gt; Personalization &gt; Colors.</p><p class="ed-dim">Microsoft Edge ${VERSION} (Official build) (64-bit)</p>` };
    }
    return error('ERR_INVALID_URL', url, 'Hmm\u2026 can\u2019t reach this page', [`${esc(url)} isn\u2019t a valid page.`]);
  }

  /* ================================================================ the window */
  const FRAME_CSS = 'body{font:14px/1.45 "Segoe UI",system-ui,sans-serif;margin:8px;color:#1b1b1b;background:#fff}';
  function launch(args = {}) {
    const win = WS.wm.create({ app: 'edge', title: 'New tab - Microsoft Edge', icon: I.edge, width: 1100, height: 700 });
    win.el.classList.add('themed');
    const tabsEl = h('div.ed-tabs');
    const addr = h('input.ed-addr', { spellcheck: false, placeholder: 'Search or enter web address' });
    addr.dataset.field = 'address';
    const siteIco = h('span.ed-site', { html: IC.info });
    const btnBack = h('button.ed-btn', { html: IC.back, title: 'Back (Alt+Left arrow)', onClick: () => back() });
    const btnFwd = h('button.ed-btn', { html: IC.fwd, title: 'Forward (Alt+Right arrow)', onClick: () => forward() });
    const btnRefresh = h('button.ed-btn', { html: IC.refresh, title: 'Refresh (F5)', onClick: () => refresh() });
    const view = h('div.ed-view');
    const root = h('div.ed', h('div.ed-tabbar', tabsEl, h('button.ed-newtab', { html: IC.plus, title: 'New tab', onClick: () => newTab() })),
      h('div.ed-bar', btnBack, btnFwd, btnRefresh, h('button.ed-btn', { html: IC.home, title: 'Home', onClick: () => go('edge://newtab') }),
        h('div.ed-addrbox', siteIco, addr, h('span.ed-star', { html: IC.star, title: 'Add this page to favorites' })),
        h('button.ed-btn', { html: IC.more, title: 'Settings and more', onClick: e => WS.ui.popupMenu(e.currentTarget, [
          { label: 'New tab', action: () => newTab() }, { separator: true }, { label: 'Settings', action: () => newTab('edge://settings') }, { label: 'About Microsoft Edge', action: () => newTab('edge://version') }, { separator: true }, { label: 'Close Microsoft Edge', action: () => win.close() }]) })),
      view);
    win.body.appendChild(root);
    const tabs = [];
    let active = -1;
    const tab = () => tabs[active];

    function newTab(url) {
      tabs.push({ id: U.uid('tab'), history: [], idx: -1, title: 'New tab', result: null });
      active = tabs.length - 1;
      go(url || 'edge://newtab');
      if (!url) setTimeout(() => { const s = view.querySelector('.ed-nt-search'); if (s) s.focus(); }, 30);
      return active;
    }
    function closeTab(i = active) {
      tabs.splice(i, 1);
      if (!tabs.length) { win.close(); return; }
      active = Math.min(active, tabs.length - 1);
      paint();
    }
    function go(text, o = {}) {
      const url = normalize(text);
      const t = tab();
      if (!o.noHistory) { t.history = t.history.slice(0, t.idx + 1); t.history.push(url); t.idx = t.history.length - 1; }
      load();
      return url;
    }
    function load() {
      const t = tab();
      let url = t.history[t.idx];
      let res;
      try {
        res = serve(url);
        for (let hops = 0; res.kind === 'redirect' && hops < 10; hops++) { url = t.history[t.idx] = res.location; res = serve(url); }
        if (res.kind === 'redirect') res = error('ERR_TOO_MANY_REDIRECTS', url, 'This page isn\u2019t working', [`<b>${esc(url)}</b> redirected you too many times.`]);
      } catch (e) { console.error(e); res = error('ERR_FAILED', url, 'Hmm\u2026 can\u2019t reach this page', ['Something went wrong.']); }
      t.result = res; t.title = res.title; t.url = url;
      paint();
    }
    function back() { const t = tab(); if (t.idx > 0) { t.idx--; load(); } }
    function forward() { const t = tab(); if (t.idx < t.history.length - 1) { t.idx++; load(); } }
    function refresh() { load(); }

    function paintTabs() {
      U.clear(tabsEl);
      tabs.forEach((t, i) => tabsEl.append(h('div.ed-tab' + (i === active ? '.active' : ''), { dataset: { tab: i }, title: t.title, onClick: () => { active = i; paint(); } },
        h('span.ed-tico', { html: t.result && t.result.kind === 'newtab' ? IC.page : IC.file }), h('span.ed-ttl', t.title),
        h('button.ed-tx', { html: IC.close, title: 'Close tab', onClick: e => { e.stopPropagation(); closeTab(i); } }))));
    }
    function paint() {
      const t = tab();
      paintTabs();
      const res = t.result;
      addr.value = !t.url || t.url === 'edge://newtab' ? '' : t.url;
      const secure = /^https:/.test(t.url || '') && !['error', 'cert'].includes(res.kind) && !res.insecure;
      siteIco.innerHTML = secure ? IC.lock : IC.info;
      siteIco.title = secure ? 'Connection is secure' : /^https?:/.test(t.url || '') ? 'Your connection to this site isn\u2019t secure' : '';
      siteIco.classList.toggle('ed-notsecure', /^https:/.test(t.url || '') && !secure);
      btnBack.disabled = t.idx <= 0;
      btnFwd.disabled = t.idx >= t.history.length - 1;
      win.setTitle(`${t.title} - Microsoft Edge`);
      U.clear(view);
      view.className = 'ed-view ed-' + res.kind;
      if (res.kind === 'newtab') view.append(newTabPage());
      else if (res.kind === 'html') view.append(frame(res.html, true));
      else if (res.kind === 'text') view.append(frame(`<pre style="white-space:pre-wrap;font:13px Consolas,monospace;margin:0">${esc(res.text)}</pre>`));
      else if (res.kind === 'image') view.append(h('div.ed-img', h('div.ed-imgbox', 'Image'), h('div.ed-dim', res.phys)));
      else if (res.kind === 'cert') {
        const adv = h('div.ed-adv', { hidden: true, html: `<p>${res.advanced}</p>` }, h('a.ed-proceed', { href: '#', onClick: e => { e.preventDefault(); proceeded.add(res.host.toLowerCase()); load(); } }, `Continue to ${res.host} (unsafe)`));
        view.append(h('div.ed-err.ed-certerr', h('div.ed-errico', { html: IC.sad }), h('div.ed-errbody', { html: res.html },
          h('div.ed-errbtns', h('button.ed-errbtn.ed-secondary', { onClick: () => { adv.hidden = !adv.hidden; } }, 'Advanced'), h('button.ed-errbtn', { onClick: back }, 'Go back')), adv)));
      }
      else if (res.kind === 'error') view.append(h('div.ed-err', h('div.ed-errico', { html: IC.sad }), h('div.ed-errbody', { html: res.html }, h('button.ed-errbtn', { onClick: refresh }, 'Refresh'))));
      else view.append(h('div.ed-doc', { html: res.html }));
      // links inside an internal page (file:/// listings) navigate the tab
      view.querySelectorAll('.ed-doc a[href]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.getAttribute('href')); }));
    }
    /** A page from disk: a sandboxed frame (no scripts); clicks on its links navigate the tab. */
    function frame(html, isPage) {
      const f = h('iframe.ed-frame', { sandbox: 'allow-same-origin', title: tab().title });
      f.srcdoc = isPage ? html : `<!doctype html><html><head><style>${FRAME_CSS}</style></head><body>${html}</body></html>`;
      f.addEventListener('load', () => {
        const doc = f.contentDocument;
        if (!doc) return;
        doc.addEventListener('click', e => {
          const a = e.target.closest && e.target.closest('a[href]');
          if (!a) return;
          e.preventDefault();
          const href = a.getAttribute('href');
          if (/^#/.test(href)) return;
          let next;
          try { next = new URL(href, tab().url).href; } catch (err) { next = href; }
          go(next);
        });
      });
      return f;
    }
    function newTabPage() {
      const s = h('input.ed-nt-search', { placeholder: 'Search the web', spellcheck: false });
      s.dataset.field = 'search';
      s.addEventListener('keydown', e => { if (e.key === 'Enter' && s.value.trim()) go(s.value); });
      const quick = [['localhost', 'http://localhost'], ['Edge version', 'edge://version'], ['This PC (C:)', 'file:///C:/']];
      return h('div.ed-nt', h('div.ed-nt-box', h('span', { html: IC.search }), s),
        h('div.ed-nt-quick', ...quick.map(([l, u]) => h('button.ed-nt-tile', { dataset: { url: u }, onClick: () => go(u) }, h('span.ed-nt-ico', l[0].toUpperCase()), h('span', l)))));
    }

    addr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(addr.value); addr.blur(); } if (e.key === 'Escape') { paint(); addr.select(); } });
    addr.addEventListener('focus', () => setTimeout(() => addr.select(), 0));
    win.el.addEventListener('keydown', e => {
      if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) { e.preventDefault(); refresh(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); forward(); }
      else if ((e.ctrlKey && e.key.toLowerCase() === 'l') || (e.altKey && e.key.toLowerCase() === 'd')) { e.preventDefault(); addr.focus(); }
    });
    // a page that depends on the model (IIS, files, DNS) updates when it changes and the user refreshes; IIS starting is common in labs
    win.edge = { go, url: () => tab().url, title: () => tab().title, back, forward, refresh, newTab, closeTab, tabs: () => tabs.map(t => ({ title: t.title, url: t.url })), active: () => active,
      result: () => tab().result, text: () => { const f = view.querySelector('iframe'); return f && f.contentDocument ? f.contentDocument.body.textContent : view.textContent; }, frameDoc: () => { const f = view.querySelector('iframe'); return f ? f.contentDocument : null; } };
    newTab(args.url ? normalize(args.url) : null);
    return win;
  }

  WS.apps.register({ id: 'edge', name: 'Microsoft Edge', icon: I.edge, singleton: true, keywords: ['edge', 'browser', 'internet', 'web', 'msedge', 'http'],
    launch, reuse: (w, args) => { if (args.url) w.edge.newTab(normalize(args.url)); } });
  WS.edge = { serve, normalize, VERSION, proceeded };
})();
