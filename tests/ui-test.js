/* UI toolkit test. Open tests/ui-test.html?quick=1 in a throwaway browser profile (it changes the lab state).
 * Drives every component with real clicks/keys and logs PASS / FAIL / RESULT lines to the console.
 * &shot=<services|sheet|wizard|server|picker|folder|open|menu|tools> leaves that component open for a screenshot. */
(async function () {
  const WS = window.WS, h = WS.h;
  let pass = 0, fail = 0;
  const t = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !cond ? ' :: ' + JSON.stringify(extra) : '')); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = new URLSearchParams(location.search).get('shot');
  const topShade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const btn = (label, scope) => [...(scope || topShade()).querySelectorAll('button')].find(b => b.textContent.trim() === label);
  const click = el => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); el.click(); };
  const key = (target, k, o = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const menuLabels = () => [...document.querySelectorAll('#dialogs .menu.ctx')].map(m => [...m.querySelectorAll('.mi-label')].map(x => x.textContent));
  const host = (w = 600, ht = 400) => WS.wm.create({ app: 'uitest', title: 'UI Test', width: w, height: ht });

  try {
    await wait(100);
    WS.wm.closeAll();

    /* ---------------- context menu with submenu + keyboard ---------------- */
    let fired = null;
    WS.ui.contextMenu(200, 200, [
      { label: '&Open', action: () => { fired = 'open'; }, default: true },
      { label: 'Dis&abled', disabled: true },
      { separator: true },
      { label: 'All Tas&ks', items: [{ label: '&Start', action: () => { fired = 'start'; } }, { label: 'S&top', action: () => { fired = 'stop'; } }] },
      { label: '&Check me', checked: true, action: () => {} }
    ]);
    t('menu opens', menuLabels().length === 1 && menuLabels()[0].join('|') === 'Open|Disabled|All Tasks|Check me', menuLabels());
    t('mnemonic underline', !!document.querySelector('#dialogs .menu.ctx u.mn'));
    key(document, 'ArrowDown'); key(document, 'ArrowDown'); key(document, 'ArrowDown'); // Open -> Disabled -> All Tasks
    key(document, 'ArrowRight');
    t('submenu opens by keyboard', menuLabels().length === 2, menuLabels());
    key(document, 'ArrowDown'); key(document, 'Enter');
    await wait(10);
    t('submenu item activates', fired === 'stop' && menuLabels().length === 0, fired);
    WS.ui.contextMenu(10, 10, [{ label: '&Open', action: () => { fired = 'mn'; } }]);
    key(document, 'o'); await wait(10);
    t('mnemonic key activates', fired === 'mn');

    /* ---------------- menu bar ---------------- */
    const w1 = host();
    const mb = WS.ui.menuBar([{ label: '&File', items: [{ label: 'E&xit', action: () => { fired = 'exit'; } }] }, { label: '&Action', items: () => [{ label: 'Refresh' }] }]);
    w1.body.appendChild(mb.el);
    mb.el.querySelector('.mb-item').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    t('menubar opens File', menuLabels().length === 1 && menuLabels()[0][0] === 'Exit');
    key(document, 'ArrowRight');
    t('arrow moves to next menu', menuLabels()[0] && menuLabels()[0][0] === 'Refresh');
    key(document, 'Escape');
    t('escape closes', menuLabels().length === 0);
    key(document, 'f', { altKey: true });
    t('Alt+F opens File', menuLabels().length === 1);
    key(document, 'x'); await wait(10);
    t('menu item via mnemonic', fired === 'exit');
    w1.close();

    /* ---------------- list view ---------------- */
    const w2 = host(700, 400);
    let data = [{ id: 'a', name: 'Bravo', size: 10, ip: '10.0.0.9' }, { id: 'b', name: 'alpha', size: 2, ip: '10.0.0.10' }, { id: 'c', name: 'Charlie', size: 30, ip: '9.0.0.1' }];
    let selEvents = 0, activated = null, ctxRows = null;
    const lv = WS.ui.listView({ columns: [{ key: 'name', label: 'Name', width: 150 }, { key: 'size', label: 'Size', type: 'num', align: 'right' }, { key: 'ip', label: 'IP', type: 'ip' }],
      rows: () => data, multi: true, onSelect: () => selEvents++, onActivate: r => { activated = r.id; }, onContext: rows => { ctxRows = rows.map(r => r.id); } });
    w2.body.appendChild(lv.el); lv.el.style.flex = '1';
    t('sorted by first column (case-insensitive)', lv.rows().map(r => r.id).join('') === 'bac');
    click(lv.el.querySelectorAll('.lv-hc')[1]);
    t('click header sorts numeric', lv.rows().map(r => r.id).join('') === 'bac' && lv.sortKey === 'size');
    click(lv.el.querySelectorAll('.lv-hc')[1]);
    t('second click reverses', lv.rows().map(r => r.id).join('') === 'cab');
    click(lv.el.querySelectorAll('.lv-hc')[2]);
    t('ip sort', lv.rows().map(r => r.id).join('') === 'cab' || lv.rows()[0].ip === '9.0.0.1');
    lv.sortBy('name', 1);
    const rowsEl = () => [...lv.el.querySelectorAll('.lv-row')];
    rowsEl()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    rowsEl()[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, shiftKey: true }));
    t('shift-click range', lv.selected().length === 3);
    rowsEl()[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true }));
    t('ctrl-click toggles', lv.selected().map(r => r.id).join('') === 'bc');
    lv.select('a'); lv.focus();
    key(lv.el, 'ArrowDown');
    t('arrow down moves selection', lv.selected()[0].id === 'c');
    key(lv.el, 'Enter');
    t('enter activates', activated === 'c');
    key(lv.el, 'b');
    t('type-ahead', lv.selected()[0].id === 'a');
    data = data.concat([{ id: 'd', name: 'Delta', size: 1, ip: '1.1.1.1' }]);
    lv.refresh();
    t('selection survives refresh', lv.selected()[0].id === 'a' && lv.rows().length === 4);
    lv.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    t('context on background gives no rows', Array.isArray(ctxRows) && ctxRows.length === 0);
    t('selEvents fired', selEvents > 3);
    w2.close();

    /* ---------------- tree ---------------- */
    const w3 = host(400, 400);
    let treeSel = null;
    const tv = WS.ui.tree({ nodes: () => [{ id: 'r', label: 'Root', expanded: true, children: () => [{ id: 'x', label: 'X', children: [{ id: 'x1', label: 'X1' }] }, { id: 'y', label: 'Y' }] }], onSelect: n => { treeSel = n.id; } });
    w3.body.appendChild(tv.el);
    t('tree initial expanded', tv.el.querySelectorAll('.tv-row').length === 3);
    tv.select('x'); tv.focus();
    key(tv.el, 'ArrowRight');
    t('right expands', tv.isExpanded('x') && tv.el.querySelectorAll('.tv-row').length === 4);
    key(tv.el, 'ArrowRight');
    t('right again goes to child', treeSel === 'x1');
    tv.collapse('x');
    t('collapse moves selection to parent', treeSel === 'x' && tv.selected().id === 'x');
    key(tv.el, 'ArrowLeft');
    t('left goes to parent', treeSel === 'r');
    tv.reveal(['r', 'x', 'x1']);
    t('reveal path', treeSel === 'x1');
    w3.close();

    /* ---------------- property sheet ---------------- */
    let sheet, applies = 0;
    let nameIn;
    const sp = WS.ui.propertySheet({ title: 'Test Properties', onCreate: s => { sheet = s; }, tabs: [
      { label: 'General', render: () => { nameIn = WS.ui.f.text({ value: 'one' }); return WS.ui.f.row('Name:', nameIn); }, apply: () => { applies++; return nameIn.value === 'bad' ? 'The name is not valid.' : null; } },
      { label: 'Other', render: () => h('div', 'other tab') }
    ] });
    t('apply starts disabled', sheet.applyBtn.disabled);
    nameIn.value = 'bad'; nameIn.dispatchEvent(new Event('input', { bubbles: true }));
    t('edit enables apply', !sheet.applyBtn.disabled);
    sheet.applyBtn.click(); await wait(50);
    t('apply error shows message', topShade().textContent.includes('The name is not valid.'));
    btn('OK').click(); await wait(20);
    nameIn.value = 'good'; nameIn.dispatchEvent(new Event('input', { bubbles: true }));
    click(document.querySelectorAll('.ps-tab')[1]);
    t('second tab lazily rendered', document.querySelectorAll('.ps-page').length === 2);
    sheet.ok();
    t('OK applies and closes', (await sp) === true && applies === 2);

    /* ---------------- classic wizard ---------------- */
    let wz;
    const wp = WS.ui.wizard({ title: 'New Thing Wizard', icon: WS.icons.newItem, onCreate: w => { wz = w; }, data: { name: '' },
      pages: [
        { id: 'welcome', kind: 'welcome', title: 'Welcome to the New Thing Wizard', render: () => h('p', 'This wizard creates a thing.') },
        { id: 'name', title: 'Name', subtitle: 'Type a name for the thing.', render: w => { const i = WS.ui.f.text(); i.addEventListener('input', () => { w.data.name = i.value; }); w.data.input = i; return WS.ui.f.row('Name:', i); },
          validate: w => (w.data.name ? null : 'You must type a name.') },
        { id: 'skipme', title: 'Skipped', skip: () => true, render: () => h('div') },
        { id: 'done', kind: 'complete', title: 'Completing the New Thing Wizard', render: w => h('p', 'Name: ' + w.data.name), rerender: true }
      ],
      onFinish: w => { w.data.finished = true; return null; } });
    const wzBtn = l => btn(l, wz.el);
    t('wizard starts on welcome, back disabled', wz.page.id === 'welcome' && wzBtn('< Back').disabled);
    await wz.next();
    t('next to name page', wz.page.id === 'name');
    wz.next(); await wait(30);
    t('validation blocks', wz.page.id === 'name' && topShade().textContent.includes('You must type a name.'));
    btn('OK').click(); await wait(20);
    wz.data.input.value = 'Widget'; wz.data.input.dispatchEvent(new Event('input'));
    await wz.next();
    t('skip page skipped, finish shown', wz.page.id === 'done' && wzBtn('Finish') && wz.el.textContent.includes('Name: Widget'));
    wzBtn('Finish').click();
    const wr = await wp;
    t('wizard finished', wr.finished && wr.data.finished);

    /* ---------------- server-style wizard ---------------- */
    let sw;
    const swp = WS.ui.wizard({ title: 'Add Roles and Features Wizard', style: 'server', asWindow: true, app: 'wizard', onCreate: w => { sw = w; },
      pages: [
        { id: 'before', title: 'Before you begin', nav: 'Before You Begin', render: () => h('p', 'This wizard helps you install roles.') },
        { id: 'confirm', title: 'Confirm installation selections', nav: 'Confirmation', finish: true, render: () => h('p', 'Install?') },
        { id: 'results', title: 'Installation progress', nav: 'Results', render: () => h('p', 'Done.') }
      ],
      onFinish: async () => { await wait(20); return null; } });
    const swBtn = l => btn(l, sw.el);
    t('server wizard nav', sw.el.querySelectorAll('.wz-step').length === 3 && sw.el.querySelector('.wz-step.cur').textContent === 'Before You Begin');
    t('install disabled before confirmation', swBtn('Install').disabled);
    await sw.next();
    t('install enabled on confirmation, next disabled', !swBtn('Install').disabled && swBtn('Next >').disabled);
    swBtn('Install').click();
    await swp;
    await wait(40);
    t('results page after install, Close button', sw.page.id === 'results' && sw.done && !!swBtn('Close'));
    if (shot !== 'server') swBtn('Close').click();

    /* ---------------- object picker (local SAM) ---------------- */
    let pk;
    let pp = WS.ui.objectPicker({ types: ['user', 'group'], onCreate: p => { pk = p; } });
    t('picker title', topShade().textContent.includes('Select Users or Groups'));
    pk.setText('Admin');
    const cn = pk.checkNames();
    await wait(30);
    t('ambiguous name -> Multiple Names Found', topShade().textContent.includes('Multiple Names Found'));
    btn('OK').click();
    await cn;
    t('first match chosen', pk.readBox()[0].pick && pk.readBox()[0].pick.name === 'Administrator', pk.readBox());
    pk.box.appendChild(document.createTextNode('; guests'));
    pk.ok();
    let picked = await pp;
    t('picker returns resolved objects', picked && picked.length === 2 && picked[1].name === 'Guests' && picked[1].display === WS.sys.name + '\\Guests', picked && picked.map(p => p.display));
    pp = WS.ui.objectPicker({ types: ['user'], onCreate: p => { pk = p; } });
    pk.setText('nobody'); pk.ok(); await wait(30);
    t('unknown name -> Name Not Found', topShade().textContent.includes('Name Not Found'));
    btn('OK').click(); await wait(20);
    btn('Cancel').click();
    t('cancel returns null', (await pp) === null);

    /* ---------------- folder picker ---------------- */
    let fp;
    let fpp = WS.ui.filePicker({ mode: 'folder', path: 'C:\\Users', onCreate: p => { fp = p; } });
    t('browse for folder reveals path', fp.tree.selected() && fp.tree.selected().id === 'C:\\Users');
    fp.makeFolder();
    t('make new folder', WS.fs.exists('C:\\Users\\New folder') && fp.tree.selected().id === 'C:\\Users\\New folder');
    fp.ok();
    t('folder picker returns path', (await fpp) === 'C:\\Users\\New folder');

    /* ---------------- open / save dialog ---------------- */
    WS.fs.writeFile('C:\\Users\\Administrator\\Documents\\notes.txt', 'hi');
    let fd;
    fpp = WS.ui.filePicker({ mode: 'open', path: 'C:\\Users\\Administrator\\Documents', filters: [{ label: 'Text Documents (*.txt)', ext: ['.txt'] }, { label: 'All Files (*.*)', ext: [] }], onCreate: p => { fd = p; } });
    t('open dialog lists file', fd.list.rows().some(r => r.name === 'notes.txt'));
    fd.setName('missing.txt'); fd.ok(); await wait(30);
    t('open missing file warns', topShade().textContent.includes('File not found'));
    btn('OK').click(); await wait(20);
    fd.setName('notes.txt'); await fd.ok();
    t('open returns path', (await fpp) === 'C:\\Users\\Administrator\\Documents\\notes.txt');
    fpp = WS.ui.filePicker({ mode: 'save', path: 'C:\\Users\\Administrator\\Documents', filters: [{ label: 'Text Documents (*.txt)', ext: ['.txt'] }], onCreate: p => { fd = p; } });
    fd.setName('notes'); fd.ok(); await wait(30);
    t('save over existing asks to replace', topShade().textContent.includes('already exists'));
    btn('Yes').click();
    t('save adds extension', (await fpp) === 'C:\\Users\\Administrator\\Documents\\notes.txt');

    /* ---------------- MMC + Services ---------------- */
    const win = WS.apps.launch('services');
    await wait(60);
    const lvEl = win.el.querySelector('.lv');
    const svcRows = () => [...lvEl.querySelectorAll('.lv-row')];
    t('services list populated', svcRows().length > 50);
    t('mmc chrome present', !!win.el.querySelector('.menubar') && !!win.el.querySelector('.mmc-actions .act-head') && !!win.el.querySelector('.mmc-rtabs'));
    const spRow = svcRows().find(r => r.dataset.id === 'Spooler');
    spRow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    lvEl.focus(); await wait(10);
    t('extended panel shows service', win.el.querySelector('.mmc-ext h3').textContent === 'Print Spooler');
    t('actions pane item section', [...win.el.querySelectorAll('.act-title')].some(x => x.textContent === 'Print Spooler'));
    const tbStop = [...win.el.querySelectorAll('.tbtn')].find(b => b.title === 'Stop Service');
    t('toolbar stop enabled for running service', !tbStop.disabled);
    win.el.querySelectorAll('.mb-item')[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    t('Action menu has service verbs', (menuLabels()[0] || []).slice(0, 5).join('|') === 'Start|Stop|Pause|Resume|Restart', menuLabels());
    WS.ui.closeMenu();
    const stopP = WS.services.stopSvc(WS.svc.get('Spooler'));
    await wait(40);
    t('service control progress shown', topShade().textContent.includes('Windows is attempting to stop'));
    await stopP; await wait(80);
    t('spooler stopped and list refreshed', WS.svc.get('Spooler').status === 'Stopped' && svcRows().find(r => r.dataset.id === 'Spooler').textContent.includes('Stopped'));
    // RpcSs can't be stopped: the console says so with the Win32 error
    t('stop disabled for unstoppable service', !WS.svc.get('RpcSs').canStop);
    const lw = WS.services.stopSvc(WS.svc.get('RpcSs'));
    await wait(1000);
    t('unstoppable service fails cleanly', topShade() && topShade().textContent.includes('Error 1052'));
    btn('OK').click();
    await lw;
    // a service with running dependents asks before stopping them too
    const dep = WS.services.stopSvc(WS.svc.get('LanmanWorkstation'));
    await wait(30);
    const asked = topShade() && topShade().textContent.includes('Stop Other Services');
    if (asked) btn('No').click();
    await dep;
    t('dependents prompt (or none running)', asked || !WS.svc.dependents('LanmanWorkstation').some(d => d.status === 'Running'));
    let ps;
    const pp2 = WS.services.properties('Spooler', { onCreate: s => { ps = s; } });
    const sel = topShade().querySelector('select');
    t('properties startup shows Automatic', sel.value === 'Automatic');
    sel.value = 'Disabled'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    ps.ok();
    t('properties apply changes startup', (await pp2) === true && WS.svc.get('Spooler').startup === 'Disabled');
    const st = WS.services.startSvc(WS.svc.get('Spooler'));
    await wait(1000);
    t('disabled start shows error 1058', topShade() && topShade().textContent.includes('Error 1058'));
    btn('OK').click(); await st;
    WS.svc.setStartup('Spooler', 'Automatic');
    await wait(60);
    t('model change refreshes console', svcRows().find(r => r.dataset.id === 'Spooler').textContent.includes('Automatic'));
    const exp = [...win.el.querySelectorAll('.tbtn')].find(b => b.title === 'Export List');
    exp.click(); await wait(30);
    let fdlg = topShade();
    fdlg.querySelectorAll('input')[1].value = 'C:\\Users\\Administrator\\Documents\\services.txt';
    btn('Save').click(); await wait(30);
    t('export list writes tab-delimited file', WS.fs.exists('C:\\Users\\Administrator\\Documents\\services.txt') && WS.fs.readFile('C:\\Users\\Administrator\\Documents\\services.txt').startsWith('Name\tDescription\tStatus'));

    /* ---------------- start search + Server Manager Tools ---------------- */
    t('services registered for Start search', WS.apps.list().some(a => a.id === 'services'));
    const sm = WS.apps.launch('servermanager');
    await wait(30);
    const toolsEl = [...sm.el.querySelectorAll('.sm-menus span')].find(s => s.textContent === 'Tools');
    toolsEl.click();
    t('Tools menu lists Services', (menuLabels()[0] || []).includes('Services') && !(menuLabels()[0] || []).includes('DNS'));
    if (shot !== 'tools') WS.ui.closeMenu();

    /* ---------------- AD object picker ---------------- */
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
    WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'P@ssw0rd!', noReboot: true });
    WS.sys.onBoot();
    WS.ad.createUser({ givenName: 'John', sn: 'Smith', sam: 'jsmith', upn: 'jsmith', password: 'Pa$$w0rd123' });
    pp = WS.ui.objectPicker({ types: ['user', 'group', 'computer'], onCreate: p => { pk = p; } });
    t('AD picker title', topShade().textContent.includes('Select Users, Contacts, Computers, Service Accounts, or Groups'));
    pk.setText('jsmith; domain admins');
    await pk.checkNames();
    t('AD check names display', pk.box.textContent === 'John Smith (jsmith@contoso.local); Domain Admins', pk.box.textContent);
    if (shot !== 'picker') { pk.ok(); picked = await pp; t('AD picker returns principal', picked[0].principal === 'CONTOSO\\jsmith' && picked[0].id === WS.ad.get('jsmith').id); }
  } catch (e) {
    fail++;
    console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);

  /* ---------------- screenshot states ---------------- */
  try {
    if (shot === 'server') { const w = WS.wm.find('wizard'); if (w) w.focus(); }
    if (shot === 'services') { WS.wm.windows.filter(w => w.app !== 'services').forEach(w => w.close()); WS.services.properties('Spooler'); }
    if (shot === 'sheet') { WS.wm.closeAll(); WS.services.properties('Netlogon').then(() => {}); setTimeout(() => document.querySelectorAll('.ps-tab')[3].click(), 50); }
    if (shot === 'wizard') {
      WS.wm.closeAll();
      WS.ui.wizard({ title: 'New Object - Organizational Unit', icon: WS.icons.ou, pages: [{ id: 'a', title: 'Create in:  contoso.local/', render: () => h('div', WS.ui.f.stack('Name:', WS.ui.f.text()), WS.ui.f.checkbox('Protect container from accidental deletion', true)) }] });
    }
    if (shot === 'folder') { WS.wm.closeAll(); WS.ui.filePicker({ mode: 'folder', path: 'C:\\Windows\\System32', prompt: 'Select the folder to share.' }); }
    if (shot === 'open') { WS.wm.closeAll(); WS.ui.filePicker({ mode: 'open', path: 'C:\\Windows' }); }
    if (shot === 'menu') {
      const w = WS.apps.get('services') && WS.wm.find('services');
      const r = w.el.querySelector('.lv-row[data-id="Spooler"]');
      r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
      const b = r.getBoundingClientRect();
      r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + 60, clientY: b.top + 10 }));
      setTimeout(() => { const all = [...document.querySelectorAll('.menu.ctx .menu-item')].find(m => m.textContent.includes('All Tasks')); all.dispatchEvent(new PointerEvent('pointerenter')); }, 30);
    }
  } catch (e) { console.log('SHOT error ' + e.message); }
})();
