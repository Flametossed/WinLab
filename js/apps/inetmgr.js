/* Internet Information Services (IIS) Manager (inetmgr): the Connections tree (Start Page, the server, Application
 * Pools, Sites with their folders, virtual directories and applications), the Features View / Content View in the
 * middle with an address bar of breadcrumbs, and the Actions pane. Everything goes through WS.iis and WS.certs, so a
 * site added here shows up in Get-IISSite, appcmd and Edge, and the other way round.
 *
 * Working feature pages: Default Document, Directory Browsing, Server Certificates (Create Self-Signed Certificate),
 * Worker Processes, Logging, MIME Types and Authentication (read-only), plus the Application Pools and Sites lists,
 * View Applications / View Virtual Directories. The other feature icons open a page saying they are not modelled.
 * Dialogs: Add Website, Site Bindings with Add/Edit Site Binding, Edit Site, Select Application Pool, Add/Edit
 * Application Pool, Add Virtual Directory, Add Application, Add Default Document, Create Self-Signed Certificate.
 *
 *   WS.apps.launch('inetmgr', { node, page }) -> win; win.inetmgr = { select(nodeId), open(page), node(), page(),
 *     setView('features'|'content'), actions() -> [labels], act(label), list() (the center list view or null), tree }
 *   Node ids: 'start', 'server', 'pools', 'sites', 's:<id>', 's:<id>:/path'. Pages: 'home', 'defaultDocument',
 *     'directoryBrowse', 'certs', 'workers', 'logging', 'mime', 'auth', 'apps', 'vdirs', or another feature key.
 *   WS.inetmgr = { addWebsite, bindings, bindingDialog, editSite, addPool, editPool, addVdir, addApp, selfSigned }
 *     (each takes { onCreate(frame, api) } for tests; api.set(field, value), api.ok(), api.cancel()). */
(function () {
  'use strict';
  const WS = window.WS, h = WS.h, U = WS.util, I = WS.icons, F = () => WS.ui.f;
  const IIS = () => WS.iis;
  const TITLE = 'Internet Information Services (IIS) Manager';
  const lc = s => String(s == null ? '' : s).toLowerCase();

  /* ================================================================ icons (original drawings) */
  const s16 = b => `<svg viewBox="0 0 16 16">${b}</svg>`;
  const s32 = b => `<svg viewBox="0 0 32 32">${b}</svg>`;
  const globe = (x = 0, y = 0, r = 6.5) => `<circle cx="${8 + x}" cy="${8 + y}" r="${r}" fill="#3a8ee6" stroke="#1d5fa8"/><path d="M${8 + x - r} ${8 + y}h${2 * r}M${8 + x} ${8 + y - r}c-3 3-3 ${2 * r - 6} 0 ${2 * r}M${8 + x} ${8 + y - r}c3 3 3 ${2 * r - 6} 0 ${2 * r}" fill="none" stroke="#cfe6ff" stroke-width=".8"/>`;
  const IC = {
    app: `<svg viewBox="0 0 32 32"><rect x="2" y="4" width="28" height="24" rx="2" fill="#2b6cb0"/><rect x="2" y="4" width="28" height="5" rx="2" fill="#1a4f86"/><circle cx="16" cy="19" r="7" fill="#58a6ff"/><path d="M9 19h14M16 12c-3 3-3 11 0 14M16 12c3 3 3 11 0 14" fill="none" stroke="#e8f3ff" stroke-width="1.1"/></svg>`,
    start: s16('<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#fff" stroke="#5b7fa8"/><path d="M1.5 5h13" stroke="#5b7fa8"/><path d="M4 8h8M4 10.5h5" stroke="#9ab"/>'),
    pools: s16('<rect x="1.5" y="3" width="13" height="3.5" rx=".8" fill="#7fb04a" stroke="#4f7b25"/><rect x="1.5" y="8.5" width="13" height="3.5" rx=".8" fill="#7fb04a" stroke="#4f7b25"/><circle cx="4" cy="4.8" r=".8" fill="#fff"/><circle cx="4" cy="10.3" r=".8" fill="#fff"/>'),
    pool: s16('<rect x="1.5" y="5" width="13" height="5" rx="1" fill="#7fb04a" stroke="#4f7b25"/><circle cx="4" cy="7.5" r="1" fill="#fff"/>'),
    poolStopped: s16('<rect x="1.5" y="5" width="13" height="5" rx="1" fill="#b9c2b0" stroke="#7d8775"/><circle cx="4" cy="7.5" r="1" fill="#fff"/><rect x="9" y="9" width="6" height="6" rx="1" fill="#c42b1c"/>'),
    sites: s16('<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder-back)"/><path d="M1 6h14v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder)"/>' + globe(2, 2, 3.6)),
    site: s16(globe()),
    siteStopped: s16(globe() + '<rect x="9" y="9" width="6" height="6" rx="1" fill="#c42b1c"/>'),
    vdir: s16('<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder-back)"/><path d="M1 6h14v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder)"/><rect x="1.5" y="9" width="5.5" height="5.5" fill="#fff" stroke="#555" stroke-width=".7"/><path d="M3 13l2.5-2.5M3.5 10.5h2v2" fill="none" stroke="#1d5fa8" stroke-width="1"/>'),
    appNode: s16('<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder-back)"/>' + globe(0, 1, 5.5)),
    cert: s16('<rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="#fffbe6" stroke="#b38f00"/><path d="M3.5 5h6M3.5 7h4" stroke="#b38f00"/><circle cx="11.5" cy="10" r="2.5" fill="#e0a800"/><path d="M10.3 12.2l-.8 3 2-1 2 1-.8-3" fill="#e0a800"/>'),
    back: s16('<circle cx="8" cy="8" r="7" fill="#2f74c0"/><path d="M9.5 4.5L6 8l3.5 3.5" fill="none" stroke="#fff" stroke-width="1.6"/>'),
    fwd: s16('<circle cx="8" cy="8" r="7" fill="#2f74c0"/><path d="M6.5 4.5L10 8l-3.5 3.5" fill="none" stroke="#fff" stroke-width="1.6"/>'),
    help: s16('<circle cx="8" cy="8" r="6.5" fill="#2f74c0"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.7c-.5.3-.8.6-.8 1.2v.4" fill="none" stroke="#fff" stroke-width="1.3"/><circle cx="8" cy="11.6" r=".8" fill="#fff"/>'),
    refresh: I.refresh, newConn: s16('<rect x="2" y="3" width="9" height="7" rx="1" fill="#e8eef5" stroke="#5b7fa8"/><path d="M5 12.5h3M6.5 10v2.5" stroke="#5b7fa8"/><path d="M12 9v6M9 12h6" stroke="#2a8d2a" stroke-width="1.6"/>'),
    up: I.up, del: I.delete
  };
  /* Feature icons: a coloured tile with a glyph (32 x 32). */
  const tile = (c, glyph) => s32(`<rect x="2" y="2" width="28" height="28" rx="4" fill="${c}"/>${glyph}`);
  const W = 'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const FI = {
    auth: tile('#6b5bb5', `<circle cx="16" cy="12" r="4" ${W}/><path d="M9 24c1-4 4-6 7-6s6 2 7 6" ${W}/>`),
    compression: tile('#2f8f83', `<path d="M16 6v8M12 10l4 4 4-4M16 26v-8M12 22l4-4 4 4" ${W}/>`),
    defaultDocument: tile('#2f74c0', `<path d="M10 6h9l4 4v16H10z" ${W}/><path d="M13 15h7M13 19h7" ${W}/>`),
    directoryBrowse: tile('#c98b16', `<path d="M7 10h7l2 2h9v11H7z" ${W}/><path d="M11 17h10M11 20h7" ${W}/>`),
    errorPages: tile('#c0392b', `<path d="M16 7l10 17H6z" ${W}/><path d="M16 13v5M16 21v.5" ${W}/>`),
    handlers: tile('#566573', `<path d="M8 10h6v6H8zM18 16h6v6h-6zM14 13h4v6" ${W}/>`),
    headers: tile('#1f7a8c', `<path d="M8 9h16M8 14h12M8 19h16M8 24h9" ${W}/>`),
    logging: tile('#7a5c3a', `<path d="M10 6h12v20H10z" ${W}/><path d="M13 11h6M13 15h6M13 19h4" ${W}/>`),
    mime: tile('#8e44ad', `<path d="M9 8h6v6H9zM17 18h6v6h-6z" ${W}/><path d="M15 11h5v7" ${W}/>`),
    modules: tile('#34495e', `<path d="M8 8h7v7H8zM17 8h7v7h-7zM8 17h7v7H8zM17 17h7v7h-7z" ${W}/>`),
    outputCache: tile('#16a085', `<path d="M8 10c0-2 16-2 16 0v12c0 2-16 2-16 0z" ${W}/><path d="M8 10c0 2 16 2 16 0M8 16c0 2 16 2 16 0" ${W}/>`),
    requestFiltering: tile('#2c3e50', `<path d="M7 8h18l-7 8v8l-4-2v-6z" ${W}/>`),
    certs: tile('#b7950b', `<path d="M7 8h18v12H7z" ${W}/><circle cx="20" cy="19" r="3" ${W}/><path d="M18 22l-1 4 3-2 3 2-1-4" ${W}/>`),
    workers: tile('#27ae60', `<path d="M8 22V12M13 22V8M18 22v-6M23 22V10" ${W}/>`),
    configEditor: tile('#5d6d7e', `<path d="M8 8h16v16H8z" ${W}/><path d="M11 12h4M11 16h10M11 20h7" ${W}/>`),
    delegation: tile('#7f8c8d', `<circle cx="11" cy="12" r="3" ${W}/><circle cx="21" cy="20" r="3" ${W}/><path d="M13 14l6 4" ${W}/>`),
    sharedConfig: tile('#5b7fa8', `<path d="M8 9h9v7H8zM15 17h9v7h-9z" ${W}/><path d="M12 16v4h3" ${W}/>`)
  };
  const FEATURES = {
    auth: ['Authentication', FI.auth, 'IIS'], compression: ['Compression', FI.compression, 'IIS'], defaultDocument: ['Default Document', FI.defaultDocument, 'IIS'],
    directoryBrowse: ['Directory Browsing', FI.directoryBrowse, 'IIS'], errorPages: ['Error Pages', FI.errorPages, 'IIS'], handlers: ['Handler Mappings', FI.handlers, 'IIS'],
    headers: ['HTTP Response Headers', FI.headers, 'IIS'], logging: ['Logging', FI.logging, 'IIS'], mime: ['MIME Types', FI.mime, 'IIS'], modules: ['Modules', FI.modules, 'IIS'],
    outputCache: ['Output Caching', FI.outputCache, 'IIS'], requestFiltering: ['Request Filtering', FI.requestFiltering, 'IIS'], certs: ['Server Certificates', FI.certs, 'IIS'],
    workers: ['Worker Processes', FI.workers, 'IIS'], configEditor: ['Configuration Editor', FI.configEditor, 'Management'], delegation: ['Feature Delegation', FI.delegation, 'Management'],
    sharedConfig: ['Shared Configuration', FI.sharedConfig, 'Management']
  };
  const DESC = {
    auth: 'Configure authentication settings for sites and applications.', compression: 'Configure settings to compress responses.',
    defaultDocument: 'Configure default files to return when clients do not specify a file in a request.', directoryBrowse: 'Configure information to display in a directory listing.',
    errorPages: 'Configure pages to return when errors occur.', handlers: 'Specify resources, such as DLLs and managed code, that handle responses for specific request types.',
    headers: 'Configure HTTP headers that are added to responses from the Web server.', logging: 'Configure how IIS logs requests on the Web server.',
    mime: 'Configure extensions and associated content types that are served as static files.', modules: 'Configure native and managed code modules that process requests made to the Web server.',
    outputCache: 'Specify rules for caching served content in the output cache.', requestFiltering: 'Configure filtering rules.',
    certs: 'Request and manage certificates for Web sites that use SSL.', workers: 'View information about worker processes and currently executing requests.',
    configEditor: 'Edit configuration sections and attributes.', delegation: 'Configure the default delegation state for features at lower levels of the configuration hierarchy.',
    sharedConfig: 'Configure shared configuration files to use with multiple IIS servers.'
  };
  const SERVER_FEATURES = ['auth', 'compression', 'defaultDocument', 'directoryBrowse', 'errorPages', 'handlers', 'headers', 'logging', 'mime', 'modules', 'outputCache', 'requestFiltering', 'certs', 'workers', 'configEditor', 'delegation', 'sharedConfig'];
  const SITE_FEATURES = ['auth', 'compression', 'defaultDocument', 'directoryBrowse', 'errorPages', 'handlers', 'headers', 'logging', 'mime', 'modules', 'outputCache', 'requestFiltering', 'configEditor'];

  /* ================================================================ dialog helpers */
  const field = (name, el) => { (el.input || el).dataset.field = name; return el; };
  /** A modal form with OK/Cancel; submit() returns false (stay), { ok: false, error } (message, stay) or anything to close. */
  function formDialog(o) {
    const frame = WS.ui.modal({ title: o.title, width: o.width || 460, className: 'w32-dlg im-dlg', closeValue: null });
    frame.body.appendChild(h('div.w32.im-form', o.content));
    let busy = false;
    const ok = h('button.btn.primary', { onClick: () => submit() }, o.okLabel || 'OK');
    const submit = async () => {
      if (busy || ok.disabled) return;
      busy = true;
      try {
        const r = await o.submit();
        if (r && r.ok === false) await WS.ui.msgbox({ title: o.errorTitle || o.title, icon: 'error', message: r.error });
        else if (r !== false) frame.close(r === undefined ? true : r);
      } finally { busy = false; }
    };
    frame.footer.append(ok, h('button.btn', { onClick: () => { if (!busy) frame.close(null); } }, 'Cancel'));
    frame.onEnter = () => submit();
    frame.onEscape = () => { if (!busy) frame.close(null); };
    const api = {
      frame, ok: submit, cancel: () => frame.close(null), okButton: ok,
      field: n => frame.body.querySelector(`[data-field="${n}"]`),
      set(n, v) { const el = api.field(n); if (!el) throw new Error('No field ' + n); if (el.type === 'checkbox') el.checked = !!v; else el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', { bubbles: true })); return api; }
    };
    if (o.validate) { const upd = () => { ok.disabled = !o.validate(); }; frame.body.addEventListener('input', upd); frame.body.addEventListener('change', upd); upd(); api.revalidate = upd; }
    if (o.onCreate) o.onCreate(frame, api);
    WS.ui.focusFirst(frame);
    return frame.promise;
  }
  const errBox = (message, detail) => WS.ui.msgbox({ title: TITLE, icon: 'error', message, detail });
  const opError = r => errBox('There was an error while performing this operation.', `Details:\n\n${r.error}`);
  const confirmRemove = text => WS.ui.msgbox({ title: 'Confirm Remove', icon: 'question', message: text, buttons: ['Yes', 'No'] }).then(b => b === 'Yes');
  const ipChoices = () => [{ value: '*', label: 'All Unassigned' }, ...WS.net.ownIps().filter(ip => ip !== '127.0.0.1').map(ip => ({ value: ip, label: ip }))];
  const certChoices = () => [{ value: '', label: 'Not selected' }, ...WS.certs.list().map(c => ({ value: c.thumbprint, label: c.friendlyName || c.subject.replace(/^CN=/, '') }))];
  const browsePath = async input => { const p = await WS.ui.filePicker({ mode: 'folder', path: input.value || 'C:\\' }); if (p) { input.value = p; input.dispatchEvent(new Event('input', { bubbles: true })); } };
  const pathCheck = p => { const x = WS.fs.expandEnv(p); return WS.fs.isDir(x); };

  /** The binding block shared by Add Website and Add/Edit Site Binding. */
  function bindingFields(b = {}) {
    const type = field('type', F().select(['http', 'https'], b.protocol || 'http', { width: 80 }));
    const ip = field('ip', F().select(ipChoices(), b.ip || '*', { width: 170 }));
    const port = field('port', F().text({ value: b.port != null ? b.port : 80, width: 60 }));
    const host = field('host', F().text({ value: b.host || '', width: 390 }));
    const sni = field('sni', F().checkbox('Require Server Name Indication', !!b.sni));
    const cert = field('cert', F().select(certChoices(), b.cert || '', { width: 280 }));
    const view = F().button('View...', () => { const c = WS.certs.get(cert.value); if (c) certDetails(c); }, { disabled: true });
    cert.addEventListener('change', () => { view.disabled = !cert.value; });
    const sslRow = h('div.im-ssl', sni, h('div.im-row', h('label.flabel', 'SSL certificate:'), cert, F().button('Select...', () => cert.focus()), view));
    let lastProto = type.value;
    const sync = () => {
      const https = type.value === 'https';
      sslRow.hidden = !https;
      if (type.value !== lastProto) { if (port.value === '80' && https) port.value = '443'; else if (port.value === '443' && !https) port.value = '80'; lastProto = type.value; }
    };
    type.addEventListener('change', sync);
    sync();
    const el = h('div.im-binding',
      h('div.im-row3', h('div', h('label.flabel', 'Type:'), type), h('div', h('label.flabel', 'IP address:'), ip), h('div', h('label.flabel', 'Port:'), port)),
      h('div', h('label.flabel', 'Host name:'), host), sslRow,
      h('div.im-example', 'Example: www.contoso.com or marketing.contoso.com'));
    return { el, value: () => ({ protocol: type.value, ip: ip.value, port: port.value.trim(), host: host.value.trim(), cert: type.value === 'https' ? cert.value || null : null, sni: type.value === 'https' && sni.checked }), type, port, host, cert };
  }
  function checkBindingInput(b) {
    if (!/^\d+$/.test(b.port) || +b.port < 1 || +b.port > 65535) return { ok: false, error: 'The specified port is invalid. The port must be a number between 1 and 65535.' };
    if (b.protocol === 'https' && !b.cert) return { ok: false, error: 'You must specify a certificate.' };
    return IIS().checkBinding({ ...b, port: +b.port });
  }
  async function duplicatePrompt(b, except, title) {
    const others = IIS().conflicts({ ...b, port: +b.port, host: lc(b.host) }, except);
    if (!others.length) return true;
    return (await WS.ui.msgbox({ title, icon: 'warning', buttons: ['Yes', 'No'], message: `The binding '${IIS().bindingInfo({ ip: b.ip, port: b.port, host: lc(b.host) })}' is assigned to another site. If you assign the same binding to this site, you will only be able to start one of the sites. Are you sure that you want to add this duplicate binding?` })) === 'Yes';
  }

  /* ================================================================ dialogs */
  function selectPool(current, o = {}) {
    const pick = field('pool', F().select(IIS().pools().map(p => p.name), current, { width: 300 }));
    const info = h('div.im-poolinfo');
    const upd = () => { const p = IIS().pool(pick.value); info.textContent = p ? `.NET CLR Version: ${p.runtime ? p.runtime.replace(/^v/, '') : 'No Managed Code'}\nPipeline mode: ${p.pipeline}` : ''; };
    pick.addEventListener('change', upd); upd();
    return formDialog({ title: 'Select Application Pool', width: 360, onCreate: o.onCreate, content: h('div', h('label.flabel', 'Application pool:'), pick, h('div.flabel', { style: 'margin-top:10px' }, 'Properties:'), info), submit: () => pick.value });
  }
  function poolPicker(initial) {
    const input = field('pool', F().text({ value: initial, width: 165, readOnly: true }));
    const btn = F().button('Select...', async () => { const v = await selectPool(input.value); if (v) { input.value = v; input.dataset.chosen = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); } });
    return { input, el: h('div.im-inline', input, btn) };
  }
  function pathPicker(name, initial = '') {
    const input = field(name, F().text({ value: initial, width: 340 }));
    return { input, el: h('div.im-inline', input, F().button('...', () => browsePath(input))) };
  }
  const passThrough = () => h('div', h('label.flabel', 'Pass-through authentication'), h('div.im-inline', F().button('Connect as...', () => WS.ui.msgbox({ title: 'Connect As', icon: 'info', message: 'Path credentials: Application user (pass-through authentication).\n\nSpecific users are not modelled in the lab simulator.' })),
    F().button('Test Settings...', () => WS.ui.msgbox({ title: 'Test Connection', icon: 'info', message: 'Authentication: The server is configured to use pass-through authentication with the built-in account to access the specified physical path.\n\nAuthorization: The path is accessible to the application pool identity.' }))));

  async function addWebsite(o = {}) {
    if (!IIS().installed()) return null;
    const name = field('name', F().text({ width: 250 }));
    const pool = poolPicker('');
    const path = pathPicker('path');
    const b = bindingFields({ protocol: 'http', ip: '*', port: 80 });
    const start = field('start', F().checkbox('Start Website immediately', true));
    name.addEventListener('input', () => { if (!pool.input.dataset.chosen) pool.input.value = name.value.trim(); });
    return formDialog({ title: 'Add Website', width: 560, onCreate: o.onCreate,
      validate: () => name.value.trim() && path.input.value.trim(),
      content: h('div',
        h('div.im-row2', h('div', h('label.flabel', 'Site name:'), name), h('div', h('label.flabel', 'Application pool:'), pool.el)),
        F().group('Content Directory', h('label.flabel', 'Physical path:'), path.el, passThrough()),
        F().group('Binding', b.el), start),
      submit: async () => {
        const bind = b.value();
        const c = checkBindingInput(bind); if (!c.ok) return c;
        const n = name.value.trim();
        if (IIS().site(n)) return { ok: false, error: 'A site with this name already exists.' };
        if (!(await duplicatePrompt(bind, null, 'Add Website'))) return false;
        const chosen = pool.input.dataset.chosen ? pool.input.value : null;
        const r = IIS().newSite({ name: n, physicalPath: path.input.value.trim(), bindings: [{ ...bind, port: +bind.port }], createPool: !chosen, pool: chosen || undefined, start: start.checked });
        if (!r.ok) return r;
        return r.site;
      } });
  }

  function bindingDialog(siteName, index, o = {}) {
    const s = IIS().site(siteName); if (!s) return null;
    const editing = index != null;
    const b = bindingFields(editing ? s.bindings[index] : { protocol: 'http', ip: '*', port: 80 });
    const title = editing ? 'Edit Site Binding' : 'Add Site Binding';
    return formDialog({ title, width: 520, onCreate: o.onCreate, content: b.el,
      submit: async () => {
        const v = b.value();
        const c = checkBindingInput(v); if (!c.ok) return c;
        if (!(await duplicatePrompt(v, s, title))) return false;
        const r = editing ? IIS().setBinding(s.name, index, { ...v, port: +v.port }) : IIS().addBinding(s.name, { ...v, port: +v.port });
        if (!r.ok && r.code === 'Exists') return { ok: false, error: 'A duplicate binding already exists.' };
        return r.ok ? true : r;
      } });
  }
  const browseUrl = b => { const host = b.host || (b.ip === '*' ? 'localhost' : b.ip); const def = b.protocol === 'https' ? 443 : 80; return `${b.protocol}://${host}${b.port === def ? '' : ':' + b.port}/`; };
  function bindings(siteName, o = {}) {
    const s = IIS().site(siteName); if (!s) return null;
    const frame = WS.ui.modal({ title: 'Site Bindings', width: 620, className: 'w32-dlg im-dlg', closeValue: null });
    const lv = WS.ui.listView({
      columns: [{ key: 'protocol', label: 'Type', width: 60 }, { key: 'host', label: 'Host Name', width: 170 }, { key: 'port', label: 'Port', width: 50, type: 'num' }, { key: 'ip', label: 'IP Address', width: 100, value: r => r.ip }, { key: 'info', label: 'Binding Informa...', width: 120, value: r => (r.protocol === 'https' && r.sni ? 'SNI' : '') }],
      rows: () => s.bindings.map((b, i) => ({ ...b, i })), getId: r => r.i,
      onSelect: () => upd(), onActivate: () => edit()
    });
    lv.el.classList.add('im-blist');
    const btn = (label, fn) => h('button.btn', { onClick: fn }, label);
    const sel = () => lv.selected()[0];
    const edit = async () => { const r = sel(); if (!r) return; await bindingDialog(s.name, r.i); lv.refresh(); upd(); };
    const bAdd = btn('Add...', async () => { await bindingDialog(s.name, null); lv.refresh(); upd(); });
    const bEdit = btn('Edit...', edit);
    const bRemove = btn('Remove', async () => { const r = sel(); if (!r) return; if (!(await confirmRemove('Are you sure that you want to remove the selected binding?'))) return; IIS().removeBinding(s.name, { protocol: r.protocol, info: IIS().bindingInfo(r) }); lv.refresh(); upd(); });
    const bBrowse = btn('Browse', () => { const r = sel(); if (r) WS.apps.launch('edge', { url: browseUrl(r) }); });
    const upd = () => { const r = sel(); bEdit.disabled = bRemove.disabled = bBrowse.disabled = !r; };
    frame.body.appendChild(h('div.w32.im-bindings', lv.el, h('div.im-bbtns', bAdd, bEdit, bRemove, bBrowse)));
    frame.footer.append(h('button.btn.primary', { onClick: () => frame.close(true) }, 'Close'));
    frame.onEscape = () => frame.close(true);
    upd();
    if (o.onCreate) o.onCreate(frame, { list: lv, add: () => bAdd.click(), edit: () => bEdit.click(), remove: () => bRemove.click(), close: () => frame.close(true) });
    return frame.promise;
  }

  function editSite(siteName, o = {}) {
    const s = IIS().site(siteName); if (!s) return null;
    const pool = poolPicker(IIS().rootPool(s)); pool.input.dataset.chosen = '1';
    const path = pathPicker('path', IIS().rootPath(s));
    return formDialog({ title: 'Edit Site', width: 560, onCreate: o.onCreate, validate: () => path.input.value.trim(),
      content: h('div', h('div.im-row2', h('div', h('label.flabel', 'Site name:'), F().text({ value: s.name, width: 250, readOnly: true })), h('div', h('label.flabel', 'Application pool:'), pool.el)),
        h('label.flabel', 'Physical path:'), path.el, passThrough()),
      submit: () => IIS().setSite(s.name, { physicalPath: path.input.value.trim(), pool: pool.input.value }) });
  }
  function poolForm(o = {}, p) {
    const name = field('name', F().text({ value: p ? p.name : '', width: 300, readOnly: !!p }));
    const clr = field('clr', F().select([{ value: 'v4.0', label: '.NET CLR Version v4.0.30319' }, { value: '', label: 'No Managed Code' }], p ? p.runtime : 'v4.0', { width: 300 }));
    const mode = field('mode', F().select(['Integrated', 'Classic'], p ? p.pipeline : 'Integrated', { width: 140 }));
    const start = field('start', F().checkbox('Start application pool immediately', p ? p.state === 'Started' : true, { disabled: !!p }));
    return formDialog({ title: p ? 'Edit Application Pool' : 'Add Application Pool', width: 360, onCreate: o.onCreate, validate: () => name.value.trim(),
      content: h('div', h('label.flabel', 'Name:'), name, h('label.flabel', '.NET CLR version:'), clr, h('label.flabel', 'Managed pipeline mode:'), mode, start),
      submit: () => (p ? IIS().setPool(p.name, { runtime: clr.value, pipeline: mode.value }) : IIS().newPool({ name: name.value.trim(), runtime: clr.value, pipeline: mode.value, start: start.checked })) });
  }
  const addPool = (o = {}) => poolForm(o, null);
  const editPool = (name, o = {}) => { const p = IIS().pool(name); return p ? poolForm(o, p) : null; };

  function addChild(kind, siteName, parentPath, o = {}) {
    const s = IIS().site(siteName); if (!s) return null;
    const alias = field('alias', F().text({ width: 300 }));
    const path = pathPicker('path');
    const app = IIS().apps(s.name).filter(a => a.path === '/' || lc(parentPath).startsWith(lc(a.path))).pop() || { pool: IIS().rootPool(s) };
    const pool = poolPicker(app.pool); pool.input.dataset.chosen = '1';
    return formDialog({ title: kind === 'app' ? 'Add Application' : 'Add Virtual Directory', width: 500, onCreate: o.onCreate, validate: () => alias.value.trim() && path.input.value.trim(),
      content: h('div', h('div.im-row2', h('div', h('label.flabel', 'Site name:'), h('div.im-static', s.name)), h('div', h('label.flabel', 'Path:'), h('div.im-static', parentPath))),
        h('div.im-row2', h('div', h('label.flabel', 'Alias:'), alias), kind === 'app' ? h('div', h('label.flabel', 'Application pool:'), pool.el) : null),
        h('div.im-example', kind === 'app' ? 'Example: sales' : 'Example: images'), h('label.flabel', 'Physical path:'), path.el, passThrough()),
      submit: () => {
        const p = (parentPath === '/' ? '' : parentPath) + '/' + alias.value.trim();
        return kind === 'app' ? IIS().addApp(s.name, { path: p, physicalPath: path.input.value.trim(), pool: pool.input.value }) : IIS().addVdir(s.name, { path: p, physicalPath: path.input.value.trim() });
      } });
  }
  const addVdir = (site, parent, o) => addChild('vdir', site, parent || '/', o);
  const addApp = (site, parent, o) => addChild('app', site, parent || '/', o);

  function selfSigned(o = {}) {
    const name = field('name', F().text({ width: 380 }));
    const store = field('store', F().select([{ value: 'my', label: 'Personal' }, { value: 'webhosting', label: 'Web Hosting' }], 'my', { width: 200 }));
    return formDialog({ title: 'Create Self-Signed Certificate', width: 460, onCreate: o.onCreate, validate: () => name.value.trim(),
      content: h('div', h('div.im-wizhead', 'Specify Friendly Name'), h('p', 'Specify a file name for the certificate request. This information can be sent to a certificate authority for signing:'),
        h('label.flabel', 'Specify a friendly name for the certificate:'), name, h('label.flabel', { style: 'margin-top:10px' }, 'Select a certificate store for the new certificate:'), store),
      submit: () => WS.certs.createSelfSigned({ friendlyName: name.value.trim(), store: store.value }) });
  }
  function certDetails(c) {
    const fmt = d => U.fmtDate(new Date(d));
    return WS.ui.dialog({ title: 'Certificate', width: 420, content: h('div.w32.im-cert',
      h('div.im-certhead', h('span', { html: IC.cert }), h('b', 'Certificate Information')),
      h('p', c.selfSigned ? 'This CA Root certificate is not trusted. To enable trust, install this certificate in the Trusted Root Certification Authorities store.' : 'This certificate is intended for the following purpose(s):'),
      h('div.im-certrow', h('b', 'Issued to: '), c.subject.replace(/^CN=/, '')), h('div.im-certrow', h('b', 'Issued by: '), c.issuer.replace(/^CN=/, '')),
      h('div.im-certrow', h('b', 'Valid from '), fmt(c.notBefore), h('b', ' to '), fmt(c.notAfter)), h('div.im-certrow', 'You have a private key that corresponds to this certificate.'),
      h('div.im-certrow', h('b', 'Thumbprint: '), c.thumbprint)) });
  }
  function addDefaultDoc(scope, o = {}) {
    const name = field('name', F().text({ width: 300 }));
    return formDialog({ title: 'Add Default Document', width: 340, onCreate: o.onCreate, validate: () => name.value.trim(), content: h('div', h('label.flabel', 'Name:'), name),
      submit: () => { const r = IIS().addDefaultDoc(scope, name.value.trim(), 0); return r.ok ? true : { ok: false, error: r.code === 'Exists' ? 'The specified default document already exists.' : r.error }; } });
  }

  /* ================================================================ the window */
  function launch(args = {}) {
    const win = WS.wm.create({ app: 'inetmgr', title: TITLE, icon: IC.app, width: 1180, height: 720 });
    let nodeId = args.node || 'start', page = args.page || null, viewMode = 'features';
    const hist = [], fwd = [];
    const nodeLabel = () => `${WS.sys.name} (${WS.sys.netbiosDomain()}\\Administrator)`;

    /* ---- tree ---- */
    const siteOf = id => { const m = /^s:(\d+)/.exec(id || ''); return m ? IIS().site(+m[1]) : null; };
    const pathOf = id => { const m = /^s:\d+:(\/.*)$/.exec(id || ''); return m ? m[1] : '/'; };
    const scopeOf = id => { const s = siteOf(id); if (!s) return null; const p = pathOf(id); return p === '/' ? s.name : s.name + p; };
    function childNodes(s, path) {
      const prefix = path === '/' ? '/' : path + '/';
      const out = new Map();
      // virtual directories and applications directly below this path
      for (const v of s.vdirs) {
        if (v.path === '/' || !lc(v.path).startsWith(lc(prefix))) continue;
        const rest = v.path.slice(prefix.length);
        if (!rest || rest.includes('/')) continue;
        const isApp = s.apps.some(a => lc(a.path) === lc(v.path));
        out.set(lc(rest), { name: rest, kind: isApp ? 'app' : 'vdir', path: v.path });
      }
      // physical folders
      const phys = IIS().mapPath(s, path);
      try { if (phys && WS.fs.isDir(phys)) for (const x of WS.fs.list(phys)) if (x.type === 'dir' && !out.has(lc(x.name))) out.set(lc(x.name), { name: x.name, kind: 'folder', path: prefix + x.name }); } catch (e) { /* missing */ }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(c => ({
        id: `s:${s.id}:${c.path}`, label: c.name, icon: c.kind === 'app' ? IC.appNode : c.kind === 'vdir' ? IC.vdir : I.folder, data: c, children: () => childNodes(s, c.path)
      }));
    }
    const tree = WS.ui.tree({
      nodes: () => [
        { id: 'start', label: 'Start Page', icon: IC.start },
        IIS().installed() ? { id: 'server', label: nodeLabel(), icon: I.server, expanded: true, children: () => [
          { id: 'pools', label: 'Application Pools', icon: IC.pools },
          { id: 'sites', label: 'Sites', icon: IC.sites, expanded: true, children: () => IIS().sites().map(s => ({ id: 's:' + s.id, label: s.name, icon: IIS().siteState(s) === 'Started' ? IC.site : IC.siteStopped, children: () => childNodes(s, '/') })) }] } : null
      ],
      onSelect: n => navigate(n.id, null),
      onContext: (n, x, y) => { navigate(n.id, null); WS.ui.contextMenu(x, y, contextItems(n.id)); }
    });

    /* ---- layout ---- */
    const crumbs = h('div.im-crumbs');
    const btnBack = h('button.im-nav', { html: IC.back, title: 'Back', onClick: () => goBack() });
    const btnFwd = h('button.im-nav', { html: IC.fwd, title: 'Forward', onClick: () => goForward() });
    const addr = h('div.im-addr', btnBack, btnFwd, crumbs, h('div.im-addr-r', h('button.im-tool', { html: IC.refresh, title: 'Refresh', onClick: () => refresh() }), h('button.im-tool', { html: IC.help, title: 'Help', onClick: helpBox })));
    const menu = WS.ui.menuBar([
      { label: '&File', items: () => [{ label: 'Connect to a Server...', disabled: true }, { label: 'Connect to a Site...', disabled: true }, { label: 'Connect to an Application...', disabled: true }, { separator: true }, { label: 'E&xit', action: () => win.close() }] },
      { label: '&View', items: () => [{ label: '&Features View', radio: true, checked: viewMode === 'features', action: () => setView('features') }, { label: '&Content View', radio: true, checked: viewMode === 'content', disabled: !siteOf(nodeId), action: () => setView('content') }, { separator: true }, { label: '&Refresh', shortcut: 'F5', action: () => refresh() }] },
      { label: '&Help', items: () => [{ label: '&IIS Help', action: helpBox }, { label: 'IIS on MSDN Online', disabled: true }, { label: 'IIS.NET Online', disabled: true }, { separator: true }, { label: '&About Internet Information Services (IIS) Manager', action: () => WS.ui.msgbox({ title: 'About Internet Information Services (IIS) Manager', icon: 'info', message: 'Internet Information Services (IIS) Manager\nVersion 10.0.26100.1\n\nLab Simulator: not affiliated with Microsoft.' }) }] }
    ]);
    const conn = h('div.im-conn', h('div.im-panehead', 'Connections'), h('div.im-conntb', h('button.im-tool', { html: IC.newConn, title: 'Create New Connection', disabled: true }), h('button.im-tool', { html: IC.up, title: 'Up', onClick: () => { const p = parentOf(nodeId); if (p) navigate(p, null); } }), h('button.im-tool', { html: IC.del, title: 'Delete Connection', disabled: true })), tree.el);
    const center = h('div.im-center');
    const tabs = h('div.im-tabs');
    const centerWrap = h('div.im-centerwrap', center, tabs);
    const actions = h('div.im-actions');
    const status = h('div.im-status', 'Ready');
    win.body.append(h('div.im', menu.el || menu, addr, h('div.im-main', conn, centerWrap, h('div.im-actwrap', h('div.im-panehead', 'Actions'), actions)), status));
    let list = null;

    function parentOf(id) {
      if (id === 'pools' || id === 'sites') return 'server';
      if (/^s:\d+$/.test(id)) return 'sites';
      const m = /^(s:\d+):(.*)\/[^/]+$/.exec(id);
      if (m) return m[2] ? `${m[1]}:${m[2]}` : m[1];
      return null;
    }
    function navigate(id, pg, o = {}) {
      if (!o.noHistory && (id !== nodeId || pg !== page)) { hist.push({ nodeId, page, viewMode }); fwd.length = 0; }
      nodeId = id; page = pg; if (!o.keepView) viewMode = 'features';
      render();
    }
    function goBack() { const e = hist.pop(); if (!e) return; fwd.push({ nodeId, page, viewMode }); nodeId = e.nodeId; page = e.page; viewMode = e.viewMode; render(); }
    function goForward() { const e = fwd.pop(); if (!e) return; hist.push({ nodeId, page, viewMode }); nodeId = e.nodeId; page = e.page; viewMode = e.viewMode; render(); }
    function setView(v) { if (v === 'content' && !siteOf(nodeId)) return; viewMode = v; page = null; render(); }
    function refresh() { tree.refresh(); render(); }
    function helpBox() { WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'IIS Manager help is not available in the lab simulator.' }); }

    function breadcrumbs() {
      const parts = [];
      if (nodeId === 'start') parts.push(['Start Page', 'start']);
      else {
        parts.push([WS.sys.name, 'server']);
        if (nodeId === 'pools') parts.push(['Application Pools', 'pools']);
        const s = siteOf(nodeId);
        if (nodeId === 'sites' || s) parts.push(['Sites', 'sites']);
        if (s) { parts.push([s.name, 's:' + s.id]); let acc = ''; for (const seg of pathOf(nodeId).split('/').filter(Boolean)) { acc += '/' + seg; parts.push([seg, `s:${s.id}:${acc}`]); } }
      }
      U.clear(crumbs);
      crumbs.append(h('span.im-crumb-ico', { html: nodeId === 'start' ? IC.start : I.server }));
      for (const [label, id] of parts) crumbs.append(h('span.im-sep', '\u25B8'), h('a.im-crumb', { href: '#', onClick: e => { e.preventDefault(); navigate(id, null); } }, label));
      crumbs.append(h('span.im-sep', '\u25B8'));
      btnBack.disabled = !hist.length; btnFwd.disabled = !fwd.length;
    }

    /* ---- center pages ---- */
    const pageHead = (icon, title, desc) => h('div.im-phead', h('span.im-pico', { html: icon }), h('div', h('h1', title), desc ? h('div.im-pdesc', desc) : null));
    function render() {
      if (!IIS().installed() && nodeId !== 'start') { nodeId = 'start'; page = null; }
      breadcrumbs();
      if (tree.selected() !== nodeId && tree.node(nodeId)) tree.select(nodeId, { silent: true });
      else if (!tree.node(nodeId)) { const parts = []; let p = nodeId; while (p) { parts.unshift(p); p = parentOf(p); } tree.reveal(parts); }
      U.clear(center); U.clear(tabs); list = null;
      const s = siteOf(nodeId);
      if (s && viewMode === 'content') renderContent(s);
      else if (page && page !== 'home') renderFeature(page);
      else if (nodeId === 'start') renderStart();
      else if (nodeId === 'pools') renderPools();
      else if (nodeId === 'sites') renderSites();
      else renderHome();
      if (nodeId === 'server' || s) {
        const t = (label, v) => h('button.im-tab' + ((viewMode === v && (!page || page === 'home' || v === 'features')) ? '.on' : ''), { onClick: () => setView(v), disabled: v === 'content' && !s }, label);
        tabs.append(t('Features View', 'features'), t('Content View', 'content'));
      }
      renderActions();
    }
    function renderStart() {
      center.append(h('div.im-startpage',
        h('div.im-sp-banner', h('span', { html: IC.app }), h('div', h('div.im-sp-t1', 'Internet Information Services'), h('div.im-sp-t2', 'Application Server Manager'))),
        h('div.im-sp-cols',
          h('div', h('h3', 'Recent connections'), h('table.im-sp-recent', h('tr', h('th', 'Name'), h('th', 'Server')), IIS().installed() ? h('tr', h('td', h('a', { href: '#', onClick: e => { e.preventDefault(); navigate('server', null); } }, WS.sys.name)), h('td', 'localhost')) : null)),
          h('div', h('h3', 'Connection tasks'), h('div', h('a', { href: '#', onClick: e => { e.preventDefault(); if (IIS().installed()) navigate('server', null); } }, 'Connect to localhost')), h('div.im-dim', 'Connect to a server...'), h('div.im-dim', 'Connect to a site...'), h('div.im-dim', 'Connect to an application...')),
          h('div', h('h3', 'Online resources'), h('div.im-dim', 'IIS News and Information'), h('div.im-dim', 'IIS Downloads'), h('div.im-dim', 'IIS Forums'))),
        IIS().installed() ? null : h('p.im-dim', 'Web Server (IIS) is not installed on this server.')));
    }
    function renderHome() {
      const s = siteOf(nodeId);
      const title = s ? `${pathOf(nodeId) === '/' ? s.name : pathOf(nodeId).split('/').pop()} Home` : `${WS.sys.name} Home`;
      const keys = s ? SITE_FEATURES : SERVER_FEATURES;
      const filter = h('input.inp.im-filter', { placeholder: '', spellcheck: false });
      const grid = h('div.im-grid');
      const draw = () => {
        U.clear(grid);
        const q = lc(filter.value);
        for (const area of ['IIS', 'Management']) {
          const items = keys.filter(k => FEATURES[k][2] === area && lc(FEATURES[k][0]).includes(q));
          if (!items.length) continue;
          grid.append(h('div.im-area', area));
          grid.append(h('div.im-icons', ...items.map(k => h('div.im-fi', { tabIndex: 0, dataset: { feature: k }, title: DESC[k], onDblclick: () => navigate(nodeId, k, { keepView: true }), onKeydown: e => { if (e.key === 'Enter') navigate(nodeId, k, { keepView: true }); },
            onClick: e => { grid.querySelectorAll('.im-fi.sel').forEach(x => x.classList.remove('sel')); e.currentTarget.classList.add('sel'); selectedFeature = k; renderActions(); } },
          h('span.im-fiic', { html: FEATURES[k][1] }), h('span.im-fil', FEATURES[k][0])))));
        }
      };
      filter.addEventListener('input', draw);
      selectedFeature = null;
      center.append(pageHead(s ? IC.site : I.server, title), h('div.im-filterbar', h('label', 'Filter:'), filter, h('button.btn.btn-sm', { onClick: draw }, 'Go'), h('button.btn.btn-sm', { onClick: () => { filter.value = ''; draw(); } }, 'Show All'), h('span.im-groupby', 'Group by: Area')), grid);
      draw();
    }
    let selectedFeature = null;
    let lastSel = null; // the selection survives a redraw of the same page (model changes repaint everything)
    function listPage(icon, title, desc, opts) {
      const key = nodeId + '|' + page + '|' + viewMode;
      list = WS.ui.listView({ ...opts, onSelect: rows => { lastSel = { key, ids: rows.map(opts.getId) }; renderActions(); }, onContext: (rows, x, y) => { const items = opts.menu ? opts.menu(rows) : []; if (items.length) WS.ui.contextMenu(x, y, items); } });
      list.el.classList.add('im-list');
      if (lastSel && lastSel.key === key && lastSel.ids.length) { const l = list; setTimeout(() => { if (list === l) l.select(lastSel.ids); }, 0); }
      center.append(...[pageHead(icon, title, desc), opts.filterBar === false ? null : h('div.im-filterbar', h('label', 'Filter:'), h('input.inp.im-filter'), h('button.btn.btn-sm', 'Go'), h('button.btn.btn-sm', 'Show All'), h('span.im-groupby', 'Group by: No Grouping')), list.el].filter(Boolean));
      return list;
    }
    function renderPools() {
      listPage(IC.pools, 'Application Pools', 'This page lets you view and manage the list of application pools on the server. Application pools are associated with worker processes, contain one or more applications, and provide isolation among different applications.', {
        columns: [{ key: 'name', label: 'Name', width: 180 }, { key: 'status', label: 'Status', width: 80, value: p => IIS().poolState(p) }, { key: 'clr', label: '.NET CLR Version', width: 110, value: p => p.runtime || 'No Managed Code' },
          { key: 'mode', label: 'Managed Pipeline Mode', width: 140, value: p => p.pipeline }, { key: 'identity', label: 'Identity', width: 160, value: p => p.identity }, { key: 'apps', label: 'Applications', width: 90, type: 'num', value: p => IIS().appsUsing(p.name).length }],
        rows: () => IIS().pools(), getId: p => p.name, icon: p => (IIS().poolState(p) === 'Started' ? IC.pool : IC.poolStopped), sortKey: 'name',
        onActivate: p => editPool(p.name).then(() => refresh()), menu: rows => poolMenu(rows[0])
      });
    }
    const bindingCol = s => s.bindings.map(IIS().bindingLabel).join(',');
    function renderSites() {
      listPage(IC.sites, 'Sites', null, {
        columns: [{ key: 'name', label: 'Name', width: 180 }, { key: 'id', label: 'ID', width: 50, type: 'num' }, { key: 'status', label: 'Status', width: 80, value: s => IIS().siteState(s) },
          { key: 'binding', label: 'Binding', width: 280, value: bindingCol }, { key: 'path', label: 'Path', width: 220, value: s => IIS().rootPath(s) }],
        rows: () => IIS().sites(), getId: s => s.id, icon: s => (IIS().siteState(s) === 'Started' ? IC.site : IC.siteStopped), sortKey: 'id',
        onActivate: s => navigate('s:' + s.id, null), menu: rows => (rows[0] ? siteMenu(rows[0]) : [{ label: 'Add Website...', action: () => addWebsite().then(r => { if (r) refresh(); }) }])
      });
    }
    function renderContent(s) {
      const path = pathOf(nodeId);
      const phys = IIS().mapPath(s, path);
      let rows = [];
      try { rows = phys && WS.fs.isDir(phys) ? WS.fs.list(phys) : []; } catch (e) { rows = []; }
      listPage(s ? IC.site : I.folder, `/${s.name}${path === '/' ? '' : path}`, null, {
        filterBar: true, columns: [{ key: 'name', label: 'Name', width: 260 }, { key: 'type', label: 'Type', width: 160, value: r => (r.type === 'dir' ? 'File folder' : WS.ui.fileTypeName ? WS.ui.fileTypeName(r.name) : 'File') }],
        rows, getId: r => r.name, icon: r => (r.type === 'dir' ? I.folder : I.file),
        onActivate: r => { if (r.type === 'dir') { navigate(`s:${s.id}:${(path === '/' ? '' : path)}/${r.name}`, null); viewMode = 'content'; render(); } else WS.apps.launch('edge', { url: browseUrl(s.bindings[0] || { protocol: 'http', ip: '*', port: 80 }).replace(/\/$/, '') + (path === '/' ? '' : path) + '/' + r.name }); }
      });
    }

    /* ---- feature pages ---- */
    function renderFeature(key) {
      const scope = nodeId === 'server' ? null : scopeOf(nodeId);
      const where = scope || WS.sys.name;
      if (key === 'apps' || key === 'vdirs') return renderChildren(key);
      if (key === 'defaultDocument') {
        const dd = IIS().defaultDocs(scope);
        listPage(FI.defaultDocument, 'Default Document', 'Use this feature to specify the default file(s) to return when a client does not request a specific file. Set default documents in order of priority.', {
          filterBar: false, sortKey: null, columns: [{ key: 'value', label: 'Name', width: 220 }, { key: 'entry', label: 'Entry Type', width: 120, value: r => (r.local ? 'Local' : 'Inherited') }],
          rows: () => IIS().defaultDocs(scope).files, getId: r => lc(r.value), icon: () => I.file, menu: rows => ddMenu(scope, rows[0])
        });
        if (!dd.enabled) center.insertBefore(h('div.im-alert', 'The default document feature is disabled.'), list.el);
        return;
      }
      if (key === 'directoryBrowse') {
        const d = IIS().dirBrowse(scope);
        const flags = lc(d.showFlags);
        const boxes = [['Time', 'time'], ['Size', 'size'], ['Extension', 'extension'], ['Date', 'date'], ['Long date', 'longdate']].map(([l, k]) => field('db-' + k, F().checkbox(l, flags.split(/,\s*/).includes(k), { disabled: !d.enabled })));
        center.append(pageHead(FI.directoryBrowse, 'Directory Browsing', 'Use this feature to specify the information that displays in a directory listing.'), h('div.im-dbform', ...boxes));
        dbBoxes = boxes;
        return;
      }
      if (key === 'certs') {
        listPage(FI.certs, 'Server Certificates', 'Use this feature to request and manage certificates that the Web server can use with websites configured for SSL.', {
          columns: [{ key: 'name', label: 'Name', width: 150, value: c => c.friendlyName }, { key: 'to', label: 'Issued To', width: 150, value: c => c.subject.replace(/^CN=/, '') }, { key: 'by', label: 'Issued By', width: 150, value: c => c.issuer.replace(/^CN=/, '') },
            { key: 'exp', label: 'Expiration Date', width: 140, type: 'date', value: c => U.fmtDateTime(new Date(c.notAfter), false) }, { key: 'hash', label: 'Certificate Hash', width: 290, value: c => c.thumbprint }, { key: 'store', label: 'Certificate Store', width: 110, value: c => (WS.certs.storeOf(c.thumbprint) === 'my' ? 'My' : 'WebHosting') }],
          rows: () => WS.certs.list(), getId: c => c.thumbprint, icon: () => IC.cert, onActivate: c => certDetails(c), menu: rows => certMenu(rows[0])
        });
        return;
      }
      if (key === 'workers') {
        listPage(FI.workers, 'Worker Processes', 'Use this feature to view information about worker processes and currently executing requests.', {
          columns: [{ key: 'pool', label: 'Application Pool Name', width: 200, value: w => w.pool.name }, { key: 'pid', label: 'Process ID', width: 90, type: 'num', value: w => w.proc.pid }, { key: 'state', label: 'State', width: 80, value: () => 'Running' },
            { key: 'cpu', label: 'CPU %', width: 60, type: 'num', value: () => 0 }, { key: 'pb', label: 'Private Bytes (KB)', width: 120, type: 'num', value: w => w.proc.memBase }, { key: 'vb', label: 'Virtual Bytes (KB)', width: 120, type: 'num', value: w => 2203318 + w.proc.memBase }],
          rows: () => IIS().workers(), getId: w => w.proc.pid, icon: () => IC.pool, emptyText: ''
        });
        return;
      }
      if (key === 'mime') {
        listPage(FI.mime, 'MIME Types', 'Use this feature to manage the list of file name extensions and associated content types that are served as static files by the Web server.', {
          columns: [{ key: 'ext', label: 'Extension', width: 120 }, { key: 'type', label: 'MIME Type', width: 360 }, { key: 'entry', label: 'Entry Type', width: 100, value: () => (scope ? 'Inherited' : 'Local') }],
          rows: () => Object.entries(IIS().MIME).map(([ext, type]) => ({ ext: '.' + ext, type })), getId: r => r.ext, icon: () => I.file, sortKey: 'ext'
        });
        return;
      }
      if (key === 'auth') {
        const rows = [{ name: 'Anonymous Authentication', status: 'Enabled', type: '' }];
        if (WS.features.isInstalled('Web-Asp-Net45')) rows.push({ name: 'ASP.NET Impersonation', status: 'Disabled', type: '' }, { name: 'Forms Authentication', status: 'Disabled', type: 'HTTP 302 Login/Redirect' });
        if (WS.features.isInstalled('Web-Basic-Auth')) rows.push({ name: 'Basic Authentication', status: 'Disabled', type: 'HTTP 401 Challenge' });
        if (WS.features.isInstalled('Web-Windows-Auth')) rows.push({ name: 'Windows Authentication', status: 'Disabled', type: 'HTTP 401 Challenge' });
        listPage(FI.auth, 'Authentication', null, { columns: [{ key: 'name', label: 'Name', width: 220 }, { key: 'status', label: 'Status', width: 90 }, { key: 'type', label: 'Response Type', width: 200 }], rows, getId: r => r.name, icon: () => FI.auth, sortKey: 'name' });
        return;
      }
      if (key === 'logging') {
        const s = siteOf(nodeId);
        const dir = '%SystemDrive%\\inetpub\\logs\\LogFiles';
        center.append(pageHead(FI.logging, 'Logging', 'Use this feature to configure how IIS logs requests on the Web server.'),
          h('div.w32.im-logform', s ? null : F().row('One log file per:', F().select(['Site', 'Server'], 'Site', { disabled: true }), { labelWidth: 150 }),
            F().group('Log File', F().row('Format:', h('div.im-inline', F().select(['W3C', 'IIS', 'NCSA', 'Custom'], 'W3C', { disabled: true }), F().button('Select Fields...', () => WS.ui.msgbox({ title: 'W3C Logging Fields', icon: 'info', message: 'Date, Time, Server IP Address, Method, URI Stem, URI Query, Server Port, User Name, Client IP Address, User Agent, Referer, Protocol Status, Protocol Substatus, Win32 Status, Time Taken' }))), { labelWidth: 100 }),
              F().row('Directory:', F().text({ value: dir, width: 340, readOnly: true }), { labelWidth: 100 }), F().row('Encoding:', F().select(['UTF-8', 'ANSI'], 'UTF-8', { disabled: true }), { labelWidth: 100 })),
            F().group('Log Event Destination', F().radio('logdest', 'Log file only', true, { disabled: true }), F().radio('logdest', 'ETW event only', false, { disabled: true }), F().radio('logdest', 'Both log file and ETW event', false, { disabled: true })),
            F().group('Log File Rollover', F().radio('roll', 'Schedule:', true, { disabled: true }), F().select(['Daily'], 'Daily', { disabled: true }), F().checkbox('Use local time for file naming and rollover', false, { disabled: true })),
            F().note(s ? `This site logs to ${dir}\\W3SVC${s.id}.` : 'Settings are read-only in the lab simulator.')));
        return;
      }
      center.append(pageHead(FEATURES[key] ? FEATURES[key][1] : FI.configEditor, FEATURES[key] ? FEATURES[key][0] : key, DESC[key]), h('div.im-na', `${FEATURES[key] ? FEATURES[key][0] : key} is not modelled in the lab simulator (${where}).`));
    }
    let dbBoxes = null;
    function renderChildren(kind) {
      const s = siteOf(nodeId);
      if (kind === 'apps') {
        listPage(IC.appNode, 'Applications', 'This page lets you view and manage the list of applications. Applications are associated with an application pool and run in the worker processes for that application pool.', {
          columns: [{ key: 'path', label: 'Virtual Path', width: 180 }, { key: 'pool', label: 'Application Pool', width: 160 }, { key: 'phys', label: 'Physical Path', width: 260, value: a => (s.vdirs.find(v => lc(v.path) === lc(a.path)) || {}).physicalPath }],
          rows: () => (s ? s.apps : []), getId: a => a.path, icon: () => IC.appNode
        });
      } else {
        listPage(IC.vdir, 'Virtual Directories', 'This page lets you view and manage virtual directories for an application. Virtual directories map to a physical directory on the local computer or a remote computer.', {
          columns: [{ key: 'path', label: 'Virtual Path', width: 200 }, { key: 'physicalPath', label: 'Physical Path', width: 320 }],
          rows: () => (s ? s.vdirs.filter(v => v.path !== '/' && !s.apps.some(a => lc(a.path) === lc(v.path))) : []), getId: v => v.path, icon: () => IC.vdir
        });
      }
    }

    /* ---- actions ---- */
    const A = (label, action, o = {}) => ({ label, action, ...o });
    function siteMenu(s) {
      const started = IIS().siteState(s) === 'Started';
      return [
        A('Explore', () => explore(s, '/')), A('Edit Permissions...', editPerms),
        { separator: true }, A('Add Application...', () => addApp(s.name, '/').then(refresh)), A('Add Virtual Directory...', () => addVdir(s.name, '/').then(refresh)), A('Edit Bindings...', () => bindings(s.name).then(refresh)),
        { label: 'Manage Website', items: () => [A('Restart', () => siteOp(s, 'restart')), A('Start', () => siteOp(s, 'start'), { disabled: started }), A('Stop', () => siteOp(s, 'stop'), { disabled: !started }), { separator: true }, A('Browse', () => browseSite(s)), A('Advanced Settings...', () => advanced(s))] },
        { separator: true }, A('Refresh', refresh), A('Remove', () => removeSite(s)), A('Rename', () => renameSite(s)), { separator: true }, A('Switch to Content View', () => { navigate('s:' + s.id, null); setView('content'); })
      ];
    }
    function poolMenu(p) {
      if (!p) return [A('Add Application Pool...', () => addPool().then(refresh)), A('Refresh', refresh)];
      const started = IIS().poolState(p) === 'Started';
      return [A('Add Application Pool...', () => addPool().then(refresh)), A('Set Application Pool Defaults...', notModelled), { separator: true },
        A('Start', () => poolOp(p, 'start'), { disabled: started }), A('Stop', () => poolOp(p, 'stop'), { disabled: !started }), A('Recycle...', () => poolOp(p, 'recycle'), { disabled: !started }), { separator: true },
        A('Basic Settings...', () => editPool(p.name).then(refresh)), A('Recycling...', notModelled), A('Advanced Settings...', () => poolAdvanced(p)), A('Rename', () => renamePool(p)), { separator: true },
        A('Remove', () => removePool(p)), A('View Applications', () => WS.ui.msgbox({ title: 'Applications', icon: 'info', message: IIS().appsUsing(p.name).map(x => x.site.name + x.app.path).join('\n') || 'No applications use this application pool.' }))];
    }
    function ddMenu(scope, r) {
      const dd = IIS().defaultDocs(scope);
      const files = dd.files, i = r ? files.findIndex(f => lc(f.value) === lc(r.value)) : -1;
      return [A('Add...', () => addDefaultDoc(scope).then(render)), A('Remove', async () => { if (!r || !(await confirmRemove('Are you sure that you want to remove the selected entry?'))) return; IIS().removeDefaultDoc(scope, r.value); render(); }, { disabled: !r }),
        A('Move Up', () => { IIS().moveDefaultDoc(scope, r.value, -1); render(); list && list.select([lc(r.value)]); }, { disabled: !r || i <= 0 }),
        A('Move Down', () => { IIS().moveDefaultDoc(scope, r.value, 1); render(); list && list.select([lc(r.value)]); }, { disabled: !r || i < 0 || i >= files.length - 1 }),
        A(dd.enabled ? 'Disable' : 'Enable', () => { IIS().setDefaultDocEnabled(scope, !dd.enabled); render(); }),
        scope ? A('Revert To Parent', async () => { if ((await WS.ui.msgbox({ title: 'Revert To Parent', icon: 'question', buttons: ['Yes', 'No'], message: 'Reverting to the parent configuration will remove all local configuration settings for this feature. Are you sure that you want to revert to the parent configuration?' })) !== 'Yes') return; IIS().revertDefaultDocs(scope); render(); }, { disabled: !IIS().hasLocal(scope, 'defaultDocument') }) : null];
    }
    function certMenu(c) {
      return [A('Import...', notModelled), A('Create Certificate Request...', notModelled), A('Complete Certificate Request...', notModelled), A('Create Domain Certificate...', notModelled), A('Create Self-Signed Certificate...', () => selfSigned().then(render)),
        c ? { separator: true } : null, c ? A('View...', () => certDetails(c)) : null, c ? A('Export...', notModelled) : null, c ? A('Renew...', notModelled) : null,
        c ? A('Remove', async () => { if (!(await confirmRemove('Are you sure that you want to remove the selected certificate?'))) return; WS.certs.remove(c.thumbprint); render(); }) : null];
    }
    const notModelled = () => WS.ui.msgbox({ title: TITLE, icon: 'info', message: 'This action is not modelled in the lab simulator.' });
    const editPerms = () => notModelled();
    function explore(s, path) { const p = IIS().mapPath(s, path); if (p && WS.fs.isDir(p)) WS.apps.launch('explorer', { path: p }); else errBox(`The path '${p}' does not exist.`); }
    function browseSite(s, b) { b = b || s.bindings[0]; if (b) WS.apps.launch('edge', { url: browseUrl(b) }); }
    async function siteOp(s, op) {
      if (op === 'restart') { const r1 = IIS().stopSite(s.name); if (!r1.ok) { await siteError(r1); return; } }
      const r = op === 'stop' ? IIS().stopSite(s.name) : IIS().startSite(s.name);
      if (!r.ok) await siteError(r);
      refresh();
    }
    const siteError = r => (r.code === 'ServiceStopped' ? errBox(r.error) : opError(r));
    async function poolOp(p, op) {
      const r = op === 'start' ? IIS().startPool(p.name) : op === 'stop' ? IIS().stopPool(p.name) : IIS().recyclePool(p.name);
      if (!r.ok) await (r.code === 'ServiceStopped' ? errBox(r.error) : opError(r));
      refresh();
    }
    async function removeSite(s) { if (!(await confirmRemove('Are you sure that you want to remove the selected site?'))) return; IIS().removeSite(s.name); navigate('sites', null); tree.refresh(); }
    async function removePool(p) { if (!(await confirmRemove('Are you sure that you want to remove the selected application pool?'))) return; IIS().removePool(p.name); refresh(); }
    async function renameSite(s) { const n = await WS.ui.inputBox({ title: 'Rename', prompt: 'Site name:', value: s.name, validate: v => { const r = IIS().setSite(s.name, { name: v.trim() }); return r.ok ? null : r.error; } }); if (n) refresh(); }
    async function renamePool(p) { const n = await WS.ui.inputBox({ title: 'Rename', prompt: 'Application pool name:', value: p.name, validate: v => { const r = IIS().setPool(p.name, { name: v.trim() }); return r.ok ? null : r.error; } }); if (n) refresh(); }
    function advanced(s) {
      const rows = [['(General)', ''], ['Application Pool', IIS().rootPool(s)], ['Bindings', s.bindings.map(b => `${b.protocol}:${IIS().bindingInfo(b)}`).join(',')], ['ID', s.id], ['Name', s.name], ['Physical Path', IIS().rootPath(s)],
        ['Physical Path Credentials', ''], ['Physical Path Credentials Logon Type', 'ClearText'], ['Start Automatically', s.autoStart ? 'True' : 'False'], ['(Behavior)', ''], ['Enabled Protocols', 'http'], ['Limits', ''], ['Logging', `%SystemDrive%\\inetpub\\logs\\LogFiles\\W3SVC${s.id}`]];
      return WS.ui.dialog({ title: 'Advanced Settings', width: 460, content: h('div.w32', h('table.im-adv', ...rows.map(([k, v]) => h('tr' + (v === '' && /^\(/.test(k) ? '.im-advgrp' : ''), h('td', k), h('td', String(v)))))) });
    }
    function poolAdvanced(p) {
      const rows = [['(General)', ''], ['.NET CLR Version', p.runtime || 'No Managed Code'], ['Enable 32-Bit Applications', 'False'], ['Managed Pipeline Mode', p.pipeline], ['Name', p.name], ['Queue Length', '1000'], ['Start Mode', 'OnDemand'],
        ['(Process Model)', ''], ['Identity', p.identity], ['Idle Time-out (minutes)', '20'], ['Load User Profile', 'True'], ['Maximum Worker Processes', '1'], ['(Recycling)', ''], ['Regular Time Interval (minutes)', '1740']];
      return WS.ui.dialog({ title: 'Advanced Settings', width: 460, content: h('div.w32', h('table.im-adv', ...rows.map(([k, v]) => h('tr' + (v === '' && /^\(/.test(k) ? '.im-advgrp' : ''), h('td', k), h('td', String(v)))))) });
    }

    /** The Actions pane for the current node/page: [{ title, items: [{ label, action, disabled }] }] */
    function sections() {
      const s = siteOf(nodeId);
      const scope = nodeId === 'server' ? null : scopeOf(nodeId);
      const sel = list ? list.selected()[0] : null;
      const help = { title: null, items: [A('Help', helpBox)] };
      if (!IIS().installed() || nodeId === 'start') return [help];
      if (page === 'defaultDocument') {
        const items = ddMenu(scope, sel).filter(Boolean);
        return [...(!IIS().defaultDocs(scope).enabled ? [{ alert: 'The default document feature is disabled.' }] : []), { title: null, items }, help];
      }
      if (page === 'directoryBrowse') {
        const d = IIS().dirBrowse(scope);
        const apply = () => { const flags = (dbBoxes || []).map((b, i) => (b.checked ? ['Time', 'Size', 'Extension', 'Date', 'LongDate'][i] : null)).filter(Boolean); const order = ['Date', 'Time', 'Size', 'Extension', 'LongDate']; IIS().setDirBrowse(scope, { showFlags: order.filter(x => flags.includes(x)).join(', ') }); render(); status.textContent = 'The changes have been successfully saved.'; };
        return [...(!d.enabled ? [{ alert: 'Directory browsing has been disabled.' }] : []), { title: null, items: [A('Apply', apply, { disabled: !d.enabled }), A('Cancel', render, { disabled: !d.enabled }), A(d.enabled ? 'Disable' : 'Enable', () => { IIS().setDirBrowse(scope, { enabled: !d.enabled }); render(); status.textContent = `Directory browsing has been ${d.enabled ? 'disabled' : 'enabled'}.`; })] }, help];
      }
      if (page === 'certs') return [{ title: null, items: certMenu(sel).filter(Boolean) }, help];
      if (page === 'logging') return [{ title: null, items: [A('Apply', null, { disabled: true }), A('Cancel', null, { disabled: true }), A('Disable', null, { disabled: true }), A('View Log Files...', () => { const dir = s ? `C:\\inetpub\\logs\\LogFiles\\W3SVC${s.id}` : 'C:\\inetpub\\logs\\LogFiles'; WS.fs.ensureDir(dir); WS.apps.launch('explorer', { path: dir }); })] }, help];
      if (page && page !== 'home' && page !== 'apps' && page !== 'vdirs') return [help];
      if (nodeId === 'server') {
        const running = IIS().w3svc();
        return [{ title: 'Manage Server', items: [A('Restart', async () => { WS.svc.stop('W3SVC'); WS.svc.start('W3SVC'); refresh(); }, { disabled: !running }), A('Start', () => { WS.svc.start('W3SVC'); refresh(); }, { disabled: running }), A('Stop', () => { WS.svc.stop('W3SVC'); refresh(); }, { disabled: !running }),
          A('View Application Pools', () => navigate('pools', null)), A('View Sites', () => navigate('sites', null))] },
        ...(selectedFeature ? [{ title: null, items: [A('Open Feature', () => navigate(nodeId, selectedFeature, { keepView: true }))] }] : []), help];
      }
      if (nodeId === 'pools') {
        const items = [A('Add Application Pool...', () => addPool().then(refresh)), A('Set Application Pool Defaults...', notModelled)];
        if (!sel) return [{ title: null, items }, help];
        const started = IIS().poolState(sel) === 'Started';
        return [{ title: null, items }, { title: 'Application Pool Tasks', items: [A('Start', () => poolOp(sel, 'start'), { disabled: started }), A('Stop', () => poolOp(sel, 'stop'), { disabled: !started }), A('Recycle...', () => poolOp(sel, 'recycle'), { disabled: !started })] },
          { title: 'Edit Application Pool', items: [A('Basic Settings...', () => editPool(sel.name).then(refresh)), A('Recycling...', notModelled), A('Advanced Settings...', () => poolAdvanced(sel)), A('Rename', () => renamePool(sel))] },
          { title: null, items: [A('Remove', () => removePool(sel)), A('View Applications', () => WS.ui.msgbox({ title: 'Applications', icon: 'info', message: IIS().appsUsing(sel.name).map(x => x.site.name + x.app.path).join('\n') || 'No applications use this application pool.' }))] }, help];
      }
      if (nodeId === 'sites' && !sel) return [{ title: null, items: [A('Add Website...', () => addWebsite().then(r => { if (r) refresh(); })), A('Set Website Defaults...', notModelled)] }, help];
      const site = nodeId === 'sites' ? sel : s;
      if (site && (pathOf(nodeId) === '/' || nodeId === 'sites')) {
        const started = IIS().siteState(site) === 'Started';
        return [
          ...(nodeId === 'sites' ? [{ title: null, items: [A('Add Website...', () => addWebsite().then(r => { if (r) refresh(); })), A('Set Website Defaults...', notModelled)] }] : []),
          { title: null, items: [A('Explore', () => explore(site, '/')), A('Edit Permissions...', editPerms)] },
          { title: 'Edit Site', items: [A('Bindings...', () => bindings(site.name).then(refresh)), A('Basic Settings...', () => editSite(site.name).then(refresh)), A('View Applications', () => navigate('s:' + site.id, 'apps')), A('View Virtual Directories', () => navigate('s:' + site.id, 'vdirs'))] },
          ...(nodeId === 'sites' ? [{ title: null, items: [A('Remove', () => removeSite(site))] }] : []),
          { title: 'Manage Website', icon: true, items: [A('Restart', () => siteOp(site, 'restart'), { disabled: !started }), A('Start', () => siteOp(site, 'start'), { disabled: started }), A('Stop', () => siteOp(site, 'stop'), { disabled: !started })] },
          { title: 'Browse Website', items: site.bindings.map(b => A(`Browse ${b.ip}:${b.port} (${b.protocol})`, () => browseSite(site, b), { disabled: !started })).concat([A('Advanced Settings...', () => advanced(site))]) },
          { title: 'Configure', items: [A('Limits...', notModelled), A('HSTS...', notModelled)] }, help];
      }
      if (s) { // folder, virtual directory or application below a site
        const path = pathOf(nodeId);
        const isApp = s.apps.some(a => lc(a.path) === lc(path)), isVdir = s.vdirs.some(v => lc(v.path) === lc(path));
        return [{ title: null, items: [A('Explore', () => explore(s, path)), A('Edit Permissions...', editPerms)] },
          { title: null, items: [A('Add Application...', () => addApp(s.name, path).then(refresh)), A('Add Virtual Directory...', () => addVdir(s.name, path).then(refresh)),
            isApp ? A('Remove', async () => { if (!(await confirmRemove('Are you sure that you want to remove the selected application?'))) return; IIS().removeApp(s.name, path); navigate(parentOf(nodeId), null); }) : null,
            !isApp && isVdir ? A('Remove', async () => { if (!(await confirmRemove('Are you sure that you want to remove the selected virtual directory?'))) return; IIS().removeVdir(s.name, path); navigate(parentOf(nodeId), null); }) : null,
            !isApp ? A('Convert to Application', () => { const r = IIS().addApp(s.name, { path, physicalPath: IIS().mapPath(s, path), pool: IIS().rootPool(s) }); if (!r.ok) opError(r); refresh(); }) : null].filter(Boolean) },
          { title: 'Manage Folder', items: [A(`Browse ${(s.bindings[0] || {}).ip || '*'}:${(s.bindings[0] || {}).port || 80} (${(s.bindings[0] || {}).protocol || 'http'})`, () => WS.apps.launch('edge', { url: browseUrl(s.bindings[0]).replace(/\/$/, '') + path + '/' }))] }, help];
      }
      return [help];
    }
    function renderActions() {
      U.clear(actions);
      for (const sec of sections()) {
        if (sec.alert) { actions.append(h('div.im-asec', h('div.im-ahead', 'Alerts'), h('div.im-alertbox', h('span', { html: WS.ui.icons.info }), sec.alert))); continue; }
        const box = h('div.im-asec', sec.title ? h('div.im-ahead', sec.title) : null);
        for (const it of sec.items.filter(x => x && !x.separator)) box.append(h('a.im-act' + (it.disabled ? '.disabled' : ''), { href: '#', dataset: { action: WS.ui.plain ? WS.ui.plain(it.label) : it.label }, onClick: e => { e.preventDefault(); if (!it.disabled && it.action) it.action(); } }, it.label));
        actions.append(box);
      }
    }
    function contextItems(id) {
      const s = siteOf(id);
      if (id === 'server') return [A('Start', () => { WS.svc.start('W3SVC'); refresh(); }, { disabled: IIS().w3svc() }), A('Stop', () => { WS.svc.stop('W3SVC'); refresh(); }, { disabled: !IIS().w3svc() }), { separator: true }, A('Add Website...', () => addWebsite().then(r => { if (r) refresh(); })), A('Refresh', refresh)];
      if (id === 'pools') return [A('Add Application Pool...', () => addPool().then(refresh)), A('Refresh', refresh)];
      if (id === 'sites') return [A('Add Website...', () => addWebsite().then(r => { if (r) refresh(); })), A('Refresh', refresh)];
      if (s && pathOf(id) === '/') return siteMenu(s);
      if (s) return [A('Explore', () => explore(s, pathOf(id))), { separator: true }, A('Add Application...', () => addApp(s.name, pathOf(id)).then(refresh)), A('Add Virtual Directory...', () => addVdir(s.name, pathOf(id)).then(refresh)), { separator: true }, A('Refresh', refresh), A('Switch to Content View', () => setView('content'))];
      return [];
    }

    for (const topic of ['iis', 'services', 'certs', 'features', 'fs']) win.listen(topic, () => { tree.refresh(); if (topic !== 'fs' || viewMode === 'content' || !page) render(); });
    win.el.addEventListener('keydown', e => { if (e.key === 'F5') { e.preventDefault(); refresh(); } if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); } if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); } });
    win.inetmgr = {
      tree, select: id => navigate(id, null), open: pg => navigate(nodeId, pg, { keepView: true }), node: () => nodeId, page: () => page, setView, list: () => list, refresh,
      actions: () => [...actions.querySelectorAll('.im-act')].map(a => (a.classList.contains('disabled') ? '~' : '') + a.textContent),
      act(label) { const a = [...actions.querySelectorAll('.im-act')].find(x => x.textContent === label); if (!a) throw new Error('No action ' + label + ' in ' + win.inetmgr.actions().join('|')); a.click(); },
      center: () => center, alerts: () => [...actions.querySelectorAll('.im-alertbox')].map(x => x.textContent), dbBoxes: () => dbBoxes
    };
    if (IIS().installed() && !args.node) nodeId = 'server';
    render();
    return win;
  }

  WS.apps.register({ id: 'inetmgr', name: TITLE, icon: IC.app, singleton: true, keywords: ['iis', 'inetmgr', 'internet information services', 'web server', 'iis manager'],
    launch, reuse: (w, args) => { if (args && args.node) w.inetmgr.select(args.node); if (args && args.page) w.inetmgr.open(args.page); } });
  WS.inetmgr = { addWebsite, bindings, bindingDialog, editSite, addPool, editPool, addVdir, addApp, selfSigned, addDefaultDoc, selectPool, ICON: IC.app };
})();
