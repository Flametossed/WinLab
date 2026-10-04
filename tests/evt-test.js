/* Event Viewer browser workflow; use a fresh profile (it rewrites the lab state).
 * &shot=log|xml|security|props|filter|filtered|logprops|create|subs|roles|overview stops there for a screenshot. */
(async function () {
  'use strict';
  const WS = window.WS, E = WS.evt, V = WS.eventvwr;
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shade = () => [...document.querySelectorAll('#dialogs .dlg-shade')].pop();
  const button = (label, scope = shade()) => scope && [...scope.querySelectorAll('button')].find(x => x.textContent.trim() === label);
  const click = async (label, scope) => { const b = button(label, scope); if (!b) throw new Error('Missing button: ' + label); b.click(); await wait(70); };
  const dlgTitle = () => (shade() ? shade().querySelector('.dlg-ttext').textContent : '');
  const stop = name => { if (new URLSearchParams(location.search).get('shot') !== name) return false; console.log(`RESULT ${pass} passed, ${fail} failed`); return true; };
  const io = new WS.term.TextConsole(), ps = new WS.ps.Session({ console: io });
  const run = async cmd => { const cap = []; await ps.execute(cmd, { capture: cap }); return cap; };
  const docs = 'C:\\Users\\Administrator\\Documents\\';
  try {
    await wait(250);
    WS.wm.windows.slice().forEach(w => w.close());
    const win = WS.apps.launch('eventvwr'), c = win.eventvwr, mmc = c.mmc, el = win.el;
    await wait(120);
    const treeLabels = () => [...el.querySelectorAll('.mmc-tree .tv-lbl')].map(x => x.textContent);
    const acts = i => { const s = el.querySelectorAll('.mmc-actions .act-sec')[i]; return s ? [...s.querySelectorAll('.act-lbl')].map(x => x.textContent) : []; };
    const actHead = i => { const s = el.querySelectorAll('.mmc-actions .act-sec')[i]; return s ? s.querySelector('.act-title').textContent : ''; };
    const head = () => (el.querySelector('.mmc-lhead') || {}).textContent || '';
    const h2 = () => (el.querySelector('.ev-hfilter') || {}).textContent || '';
    const pv = () => el.querySelector('.mmc-preview');
    const rows = () => mmc.list.rows();
    const rowEl = rec => el.querySelector(`.mmc-listwrap .lv-row[data-id="${rec}"]`);
    const pick = async rec => { rowEl(rec).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); await wait(40); };
    const go = async id => { c.select(id); await wait(90); };

    /* ---------------- console, tree and Overview */
    t('registered console with the real title and keywords', win.app === 'eventvwr' && win.title === 'Event Viewer' && WS.apps.get('eventvwr').keywords.includes('eventvwr.msc'));
    t('root node is Event Viewer (Local)', mmc.current().id === 'ev-root' && treeLabels()[0] === 'Event Viewer (Local)');
    t('top-level nodes as in Windows', ['Custom Views', 'Windows Logs', 'Applications and Services Logs', 'Subscriptions'].every(n => treeLabels().includes(n)) && !treeLabels().includes('Saved Logs'));
    const ov = el.querySelector('.ev-ov');
    t('Overview and Summary page with its sections', !!ov && ['Overview and Summary', 'Last refreshed:', 'Summary of Administrative Events', 'Recently Viewed Nodes', 'Log Summary'].every(s => ov.textContent.includes(s)));
    t('Overview paragraph uses the real wording', ov.textContent.includes('The Administrative Events custom view contains all the administrative events, regardless of source.'));
    t('root Actions pane lists the snap-in actions', ['Open Saved Log...', 'Create Custom View...', 'Import Custom View...', 'Connect to Another Computer...'].every(a => acts(0).includes(a)));
    await go('ev-wl'); mmc.tree.expand('ev-wl'); await wait(40);
    t('Windows Logs holds the five logs in order', ['Application', 'Security', 'Setup', 'System', 'Forwarded Events'].join() === mmc.list.rows().map(r => r.name).join(), mmc.list.rows().map(r => r.name));
    t('Windows Logs list shows Type and Number of Events', mmc.list.columns().map(x => x.label).join() === 'Name,Type,Number of Events,Size' && el.querySelector('.mmc-listwrap').textContent.includes('Administrative'));
    await go('ev-asl'); mmc.tree.expand('ev-asl'); await wait(40);
    const asl = mmc.list.rows().map(r => r.name);
    t('Applications and Services Logs on a workgroup server', ['Hardware Events', 'Key Management Service', 'Microsoft', 'Windows PowerShell'].every(n => asl.includes(n)) && !asl.includes('DNS Server') && !asl.includes('Directory Service'), asl);
    await go('Microsoft-Windows-PowerShell/Operational');
    t('Microsoft > Windows > PowerShell > Operational is reachable', mmc.current().id === 'ev-log:Microsoft-Windows-PowerShell/Operational' && treeLabels().includes('Windows') && treeLabels().includes('Operational'));

    /* ---------------- System log list, header and preview */
    await go('System');
    t('System log columns', mmc.list.columns().map(x => x.label).join() === 'Level,Date and Time,Source,Event ID,Task Category');
    t('header shows log name and event count', head().includes('System') && head().includes(`Number of events: ${E.list('System').length.toLocaleString('en-US')}`), head());
    t('fresh lab has a realistic System history', [12, 6005, 6006, 6009, 1074, 10016, 19].every(id => E.list('System').some(e => e.id === id)) && E.list('Setup').some(e => e.id === 2 && e.source === 'Microsoft-Windows-Servicing'));
    t('newest event first', rows()[0].record === Math.max(...E.list('System').map(e => e.record)));
    t('newest event selected and previewed', mmc.selection().length === 1 && pv().textContent.includes(`Event ${rows()[0].id}, ${rows()[0].source}`));
    const before = E.list('System').length;
    WS.svc.stop('Spooler'); WS.svc.start('Spooler'); await wait(120);
    t('service events appear live', head().includes(`Number of events: ${(before + 2).toLocaleString('en-US')}`) && rows()[0].id === 7036 && rows()[0].message === 'The Print Spooler service entered the running state.');
    const top = rows()[0];
    await pick(top.record);
    t('Actions pane has the event section', actHead(1) === 'Event 7036, Service Control Manager' && ['Event Properties', 'Attach Task To This Event...', 'Copy', 'Save Selected Events...', 'Refresh'].join() === acts(1).join(), acts(1));
    t('log Actions in Event Viewer order', acts(0).slice(0, 10).join() === ['Open Saved Log...', 'Create Custom View...', 'Import Custom View...', 'Clear Log...', 'Filter Current Log...', 'Properties', 'Find...', 'Save All Events As...', 'Attach a Task To this Log...', 'View'].join(), acts(0));
    const general = pv().querySelector('.ev-general');
    t('General tab: message and field grid', general.querySelector('.ev-msg').textContent === top.message && ['Log Name:', 'Source:', 'Logged:', 'Event ID:', 'Task Category:', 'Level:', 'Keywords:', 'User:', 'Computer:', 'OpCode:', 'More Information:'].every(l => general.textContent.includes(l)));
    t('General tab values', ['Service Control Manager', '7036', 'Information', 'Classic', 'N/A', 'Info', 'Event Log Online Help', WS.util.fmtDateTime(top.time)].every(v => general.textContent.includes(v)));
    if (stop('log')) return;
    [...pv().querySelectorAll('.ev-tab')].find(x => x.textContent === 'Details').click(); await wait(30);
    t('Details tab starts in Friendly View', pv().querySelector('.ev-friendly') && ['System', 'Provider', '[ Name]', 'EventData', 'param1', 'Print Spooler'].every(s => pv().textContent.includes(s)));
    [...pv().querySelectorAll('.ev-dmodes .chk')].find(x => x.textContent === 'XML View').querySelector('input').click(); await wait(30);
    const xml = pv().querySelector('.ev-xml').textContent;
    t('XML View has the real event schema', xml.startsWith('<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">') && xml.includes('<Provider Name="Service Control Manager" Guid="{555908d1-a6d7-4695-8e1e-26931d2012f4}" EventSourceName="Service Control Manager" />') && xml.includes('<EventID Qualifiers="16384">7036</EventID>'));
    t('XML View System and EventData values', xml.includes('<Channel>System</Channel>') && xml.includes(`<EventRecordID>${top.record}</EventRecordID>`) && xml.includes('<Data Name="param1">Print Spooler</Data>') && xml.includes('<Data Name="param2">running</Data>') && xml.includes('<Binary>53007000'));
    t('event XML is well formed', !new DOMParser().parseFromString(V.eventXml(top), 'application/xml').querySelector('parsererror'));
    await pick(rows()[1].record);
    t('preview keeps the Details / XML View choice', !!pv().querySelector('.ev-xml'));
    if (stop('xml')) return;
    [...pv().querySelectorAll('.ev-tab')].find(x => x.textContent === 'General').click(); await wait(20);

    /* ---------------- Security log */
    t('local user created for audit', WS.local.createUser('evtuser', { password: 'Lab!Passw0rd2025' }).ok);
    await go('Security');
    t('Security log shows Keywords instead of Level', mmc.list.columns()[0].label === 'Keywords' && rows()[0].id === 4720 && el.querySelector('.mmc-listwrap .lv-row').textContent.includes('Audit Success'));
    await pick(rows()[0].record);
    t('audit preview: Level Information, Keywords Audit Success', /Level:\s*Information/.test(pv().querySelector('.ev-grid').textContent.replace(/Keywords/, ' Keywords')) && pv().textContent.includes('Audit Success') && pv().textContent.includes('User Account Management'));
    const axml = V.eventXml(rows()[0]);
    t('audit XML carries named EventData', axml.includes('<Data Name="TargetUserName">evtuser</Data>') && axml.includes('<Data Name="SubjectUserName">Administrator</Data>') && axml.includes('<Keywords>0x8020000000000000</Keywords>'));
    if (stop('security')) return;

    /* ---------------- Event Properties */
    await go('System');
    WS.evt.write('System', { id: 4199, source: 'Tcpip', level: 'Error', message: 'The system detected an address conflict for IP address 192.168.1.50 with the system having network hardware address 00-15-5D-01-02-03. Network operations on this system may be disrupted as a result.' });
    await wait(100);
    rowEl(rows()[0].record).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(60);
    t('double-click opens Event Properties', dlgTitle() === 'Event Properties - Event 4199, Tcpip' && shade().textContent.includes('address conflict'));
    const [upB, dnB] = shade().querySelectorAll('.ev-nav');
    t('previous arrow disabled on the newest event', upB.disabled && !dnB.disabled);
    dnB.click(); await wait(40);
    t('next arrow walks the list and moves the selection', dlgTitle() === `Event Properties - Event ${rows()[1].id}, ${rows()[1].source}` && mmc.selection()[0].record === rows()[1].record);
    upB.click(); await wait(40);
    t('previous arrow returns', dlgTitle() === 'Event Properties - Event 4199, Tcpip');
    [...shade().querySelectorAll('.ev-tab')].find(x => x.textContent === 'Details').click(); await wait(20);
    t('Event Properties has the Details tab', shade().textContent.includes('Friendly View') && shade().textContent.includes('XML View'));
    if (stop('props')) return;
    await click('Copy');
    t('Copy puts Event Viewer text on the clipboard', V.clipboard.startsWith('Log Name:      System\r\nSource:        Tcpip\r\n') && V.clipboard.includes('Level:         Error') && V.clipboard.includes('Event Xml:\r\n<Event xmlns='));
    await click('Close');
    t('Close dismisses Event Properties', !shade());

    /* ---------------- Filter Current Log */
    let dlg, p;
    p = c.filterCurrent({ onCreate: d => { dlg = d; } }); await wait(60);
    t('Filter Current Log dialog', dlgTitle() === 'Filter Current Log' && ['Logged:', 'Event level:', 'Critical', 'Warning', 'Verbose', 'Error', 'Information', 'By log', 'By source', 'Event logs:', 'Event sources:', 'Task category:', 'Keywords:', 'User:', 'Computer(s):'].every(s => shade().textContent.includes(s)));
    t('Filter defaults and the real ID help text', dlg.c.ids.value === '<All Event IDs>' && dlg.c.users.value === '<All Users>' && dlg.c.computers.value === '<All Computers>' && shade().textContent.includes('To exclude criteria, type a minus sign first. For example 1,3,5-99,-76'));
    t('By log is fixed to the current log', dlg.c.logs.input.disabled && dlg.c.logs.value.join() === 'System' && dlg.c.byLog.checked);
    t('Logged offers the real time ranges', [...dlg.c.time.options].map(o => o.textContent).join() === 'Any time,Last hour,Last 12 hours,Last 24 hours,Last 7 days,Last 30 days');
    dlg.c.levels.Error.checked = true; dlg.c.levels.Warning.checked = true;
    if (stop('filter')) return;
    await click('OK'); await p; await wait(60);
    const ew = rows();
    t('level filter keeps only errors and warnings', ew.length > 1 && ew.every(e => ['Error', 'Warning'].includes(e.level)), ew.map(e => e.level));
    t('filtered header line', h2() === `Filtered: Log: System; Levels: Error, Warning; Source: . Number of events: ${ew.length}` && head().includes(`Number of events: ${E.list('System').length}`), h2());
    t('Clear Filter appears in the actions', acts(0).includes('Clear Filter') && acts(0).includes('Save Filtered Log File As...'));
    if (stop('filtered')) return;
    await go('Application'); await go('System');
    t('filter stays on its node', !!h2() && rows().length === ew.length);
    c.clearFilter(); await wait(60);
    t('Clear Filter restores the whole log', !h2() && rows().length === E.list('System').length && !acts(0).includes('Clear Filter'));
    p = c.filterCurrent({ onCreate: d => { dlg = d; } }); await wait(60);
    dlg.c.ids.value = '7036,6005-6009,-6006';
    dlg.tab('XML'); await wait(20);
    t('XML tab shows the query with Select and Suppress', dlg.xml().includes('<Select Path="System">*[System[(EventID=7036  or  (EventID &gt;= 6005 and EventID &lt;= 6009) )]]</Select>') && dlg.xml().includes('<Suppress Path="System">*[System[(EventID=6006)]]</Suppress>'), dlg.xml());
    dlg.tab('Filter');
    await click('OK'); await p; await wait(60);
    const idr = rows().map(e => e.id);
    t('Event ID include, range and exclude', idr.length && idr.every(id => id === 7036 || (id >= 6005 && id <= 6009 && id !== 6006)) && idr.includes(7036) && idr.includes(6005) && !idr.includes(6006), [...new Set(idr)]);
    t('header shows the Event ID criteria', h2().includes('Event ID: 7036,6005-6009,-6006'));
    p = c.filterCurrent({ onCreate: d => { dlg = d; } }); await wait(60);
    t('filter dialog reopens with the current filter', dlg.c.ids.value === '7036,6005-6009,-6006');
    dlg.c.ids.value = '12a'; await click('OK');
    t('invalid Event IDs are refused', dlgTitle() === 'Event Viewer' && shade().textContent.includes('not valid'));
    await click('OK');
    t('filter dialog stays open after the error', dlgTitle() === 'Filter Current Log');
    dlg.clear();
    t('Clear resets the Filter tab', dlg.c.ids.value === '<All Event IDs>' && !dlg.c.levels.Error.checked);
    dlg.c.sources.open(); await wait(30);
    const scm = [...shade().querySelectorAll('.ev-ddpanel .chk')].find(x => x.textContent === 'Service Control Manager');
    t('Event sources drop-down lists the log sources', !!scm && [...shade().querySelectorAll('.ev-ddpanel .chk')].some(x => x.textContent === 'EventLog'));
    scm.querySelector('input').click(); await wait(30);
    t('checking a source fills the box', dlg.c.sources.value.join() === 'Service Control Manager');
    await click('OK'); await p; await wait(60);
    t('source filter', rows().length >= 2 && rows().every(e => e.source === 'Service Control Manager') && h2().includes('Source: Service Control Manager'));
    E.write('System', { id: 7777, source: 'LabTest', level: 'Warning', message: 'An old warning.', time: new Date(Date.now() - 3 * 864e5).toISOString() });
    c.setFilter('ev-log:System', { logs: ['System'], sources: ['LabTest'], time: '24h' }); await wait(60);
    t('Last 24 hours hides an older event', rows().length === 0);
    c.setFilter('ev-log:System', { logs: ['System'], sources: ['LabTest'], time: '7d' }); await wait(60);
    t('Last 7 days shows it', rows().length === 1 && rows()[0].id === 7777);
    c.clearFilter('ev-log:System'); await wait(40);

    /* ---------------- Find */
    await go('Application');
    await run('Write-EventLog -LogName Application -Source MyApp -EventId 1000 -EntryType Warning -Message "Disk C: is nearly full."'); await wait(120);
    t('Write-EventLog appears live in the open log', rows()[0].source === 'MyApp' && rows()[0].id === 1000 && rows()[0].level === 'Warning' && rows()[0].user === 'N/A');
    await pick(rows()[rows().length - 1].record);
    p = c.find({ onCreate: d => { dlg = d; } }); await wait(50);
    t('Find dialog', dlgTitle() === 'Find' && shade().textContent.includes('Find what:'));
    dlg.input.value = 'nearly full'; await click('Find Next');
    t('Find Next selects the matching event', mmc.selection()[0] && mmc.selection()[0].source === 'MyApp');
    dlg.input.value = 'zzz-no-such-text'; await click('Find Next');
    t('no match gives a message', dlgTitle() === 'Event Viewer' && shade().textContent.includes('Search string not found.'));
    await click('OK'); await click('Cancel'); await p;

    /* ---------------- Save All Events As / Save Selected Events / Copy */
    let path = await c.saveAll({ onPicker: pk => setTimeout(() => { pk.setName('app.csv'); pk.ok(); }, 20) });
    t('Save All Events As writes CSV through WS.fs', path === docs + 'app.csv' && WS.fs.readFile(path).startsWith('Level,Date and Time,Source,Event ID,Task Category\r\nWarning,') && WS.fs.readFile(path).includes('MyApp,1000'));
    path = await c.saveAll({ onPicker: pk => setTimeout(() => { pk.setName('app.txt'); pk.ok(); }, 20) });
    t('tab-delimited text export', WS.fs.readFile(path).split('\r\n')[0] === 'Level\tDate and Time\tSource\tEvent ID\tTask Category');
    await pick(rows()[0].record);
    path = await c.saveSelected({ onPicker: pk => setTimeout(() => { pk.setName('selected.xml'); pk.ok(); }, 20) });
    const sx = WS.fs.readFile(path);
    t('Save Selected Events writes event XML', sx.startsWith('<?xml version="1.0" encoding="utf-8" standalone="yes"?>') && (sx.match(/<Event xmlns=/g) || []).length === 1 && sx.includes('Disk C: is nearly full.'));
    mmc.contextFor('result').find(i => i.label === '&Copy').items()[1].action();
    t('Copy Details as XML', V.clipboard.startsWith('<Event xmlns="http://schemas.microsoft.com/win/2004/08/events/event">') && V.clipboard.includes('<Provider Name="MyApp" />'));

    /* ---------------- Clear Log */
    const appCount = E.list('Application').length;
    p = c.clearLog({ id: 'ev-log:Application' }); await wait(50);
    t('Clear Log asks to save first', dlgTitle() === 'Event Viewer' && shade().textContent.includes('Do you want to save "Application" before clearing it?') && !!button('Save and Clear') && !!button('Clear') && !!button('Cancel'));
    await click('Cancel');
    t('Cancel keeps the log', (await p) === null && E.list('Application').length === appCount);
    p = c.clearLog({ id: 'ev-log:Application' }); await wait(50); await click('Clear');
    t('Clear empties the log through WS.evt', (await p) === 'cleared' && E.list('Application').length === 0);
    await wait(60);
    t('cleared log view is empty', rows().length === 0 && head().includes('Number of events: 0'));
    const e104 = E.list('System')[0];
    t('clearing writes System event 104', e104.id === 104 && e104.source === 'Microsoft-Windows-Eventlog' && e104.message === 'The Application log file was cleared.' && /\\Administrator$/.test(e104.user));
    t('event 104 XML uses UserData', V.eventXml({ ...e104, log: 'System' }).includes('<LogFileCleared xmlns="http://manifests.microsoft.com/win/2004/08/windows/eventlog">') && V.eventXml({ ...e104, log: 'System' }).includes('<Channel>Application</Channel>'));
    await go('System');
    const sysCount = E.list('System').length;
    let disp = null;
    p = c.clearLog({ id: 'ev-log:System', onPicker: pk => setTimeout(() => { pk.setName('SystemBackup'); pk.ok(); }, 20), onDisplayInfo: f => { disp = f; } }); await wait(50);
    await click('Save and Clear'); await wait(80);
    t('Save and Clear asks for display information', dlgTitle() === 'Display Information' && !!disp);
    await click('OK');
    t('Save and Clear saves then clears', (await p) === 'saved' && E.list('System').length === 1 && E.list('System')[0].id === 104);
    const saved = E.parseFile(WS.fs.readFile(docs + 'SystemBackup.evtx'));
    t('saved .evtx holds the old events', saved && saved.log === 'System' && saved.events.length === sysCount);
    await go('Security');
    p = c.clearLog(); await wait(50); await click('Clear'); await p; await wait(60);
    t('clearing Security writes 1102', E.list('Security').length === 1 && E.list('Security')[0].id === 1102 && E.list('Security')[0].source === 'Microsoft-Windows-Eventlog' && E.keyword(E.list('Security')[0]) === 'Audit Success');
    await run('Clear-EventLog -LogName "Windows PowerShell"'); await wait(80);
    t('Clear-EventLog in PowerShell behaves the same', E.list('Windows PowerShell').length === 0 && E.list('System')[0].message === 'The Windows PowerShell log file was cleared.');

    /* ---------------- Log Properties */
    await go('System');
    let sheet;
    p = c.properties({ onCreate: s => { sheet = s; } }); await wait(60);
    const lp = shade();
    t('Log Properties title and path', dlgTitle() === 'Log Properties - System (Type: Administrative)' && [...lp.querySelectorAll('input')].some(i => i.value === '%SystemRoot%\\System32\\Winevt\\Logs\\System.evtx'));
    t('Log Properties fields', ['Full Name:', 'Log path:', 'Log size:', 'Created:', 'Modified:', 'Accessed:', 'Maximum log size ( KB ):', 'When maximum event log size is reached:', 'Overwrite events as needed (oldest events first)', 'Archive the log when full, do not overwrite events', 'Do not overwrite events ( Clear logs manually )'].every(s => lp.textContent.includes(s)) && /\d+ KB\([\d,]+ bytes\)/.test(lp.textContent));
    const enable = [...lp.querySelectorAll('.chk')].find(x => x.textContent === 'Enable logging');
    t('Enable logging is checked and locked for a classic log', enable.input.checked && enable.input.disabled);
    const maxIn = lp.querySelector('input[type=number]');
    t('maximum size shows the model value', +maxIn.value === 20480);
    maxIn.value = '40001'; maxIn.dispatchEvent(new Event('input', { bubbles: true }));
    [...lp.querySelectorAll('.chk')].find(x => x.textContent.startsWith('Do not overwrite')).input.click();
    if (stop('logprops')) return;
    await click('OK'); await p;
    const sp = E.logProps('System');
    t('Log Properties apply through the model (size rounded to 64 KB)', sp.maxKB === 40064 && sp.retention === 'manual' && WS.state.events.props.System.maxKB === 40064);
    let list = await run('Get-EventLog -List');
    const gsys = list.find(o => o.Log === 'System');
    t('Get-EventLog -List reports the new settings', gsys && gsys.MaximumKilobytes === 40064 && gsys.OverflowAction === 'DoNotOverwrite' && gsys.MinimumRetentionDays === -1 && gsys.Entries === E.list('System').length);
    t('Get-EventLog -List lists classic logs alphabetically', list.map(o => o.Log).join() === ['Application', 'HardwareEvents', 'Internet Explorer', 'Key Management Service', 'Security', 'System', 'Windows PowerShell'].join(), list.map(o => o.Log));
    await run('Limit-EventLog -LogName System -MaximumSize 64MB -OverflowAction OverwriteAsNeeded');
    t('Limit-EventLog changes the same settings', E.logProps('System').maxKB === 65536 && E.logProps('System').retention === 'overwrite');
    io.clear(); await run('Limit-EventLog -LogName System -MaximumSize 1000');
    t('Limit-EventLog validates the size range', io.text().includes('The 1000 argument is less than the minimum allowed range of 65536'));
    list = await run('Get-WinEvent -ListLog System');
    t('Get-WinEvent -ListLog agrees', list.length === 1 && list[0].LogMode === 'Circular' && list[0].MaximumSizeInBytes === 65536 * 1024 && list[0].LogFilePath === '%SystemRoot%\\System32\\Winevt\\Logs\\System.evtx');
    p = c.properties({ onCreate: s => { sheet = s; } }); await wait(60);
    t('Log Properties reopens with the PowerShell values', +shade().querySelector('input[type=number]').value === 65536 && [...shade().querySelectorAll('.chk')].find(x => x.textContent.startsWith('Overwrite events as needed')).input.checked);
    await click('Cancel'); await p;
    const dnsClient = 'Microsoft-Windows-DNS-Client/Operational';
    t('a disabled operational log drops events', E.write(dnsClient, { id: 3008, source: 'Microsoft-Windows-DNS-Client', message: 'DNS query is completed.' }) === null && E.list(dnsClient).length === 0);
    await go(dnsClient);
    p = c.properties({ onCreate: s => { sheet = s; } }); await wait(60);
    const en2 = [...shade().querySelectorAll('.chk')].find(x => x.textContent === 'Enable logging');
    t('operational log: Type Operational, Enable logging editable', dlgTitle() === 'Log Properties - Operational (Type: Operational)' && !en2.input.disabled && !en2.input.checked);
    en2.input.click(); await click('OK'); await p;
    t('enabling the log through Log Properties', E.logProps(dnsClient).enabled && !!E.write(dnsClient, { id: 3008, source: 'Microsoft-Windows-DNS-Client', message: 'DNS query is completed.' }));
    await go('Setup');
    p = c.properties(); await wait(60);
    t('Setup is an Operational log of 1028 KB', dlgTitle() === 'Log Properties - Setup (Type: Operational)' && +shade().querySelector('input[type=number]').value === 1028);
    await click('Cancel'); await p;

    /* ---------------- Open Saved Log */
    const sl = await c.openSavedLog({ onPicker: pk => setTimeout(() => { pk.setName(docs + 'SystemBackup.evtx'); pk.ok(); }, 20), onCreate: d => setTimeout(() => d.ok(), 20) });
    await wait(80);
    t('Open Saved Log adds Saved Logs in the tree', !!sl && treeLabels().includes('Saved Logs') && mmc.current().id === 'ev-saved:' + sl.id);
    t('saved log shows the saved events', rows().length === saved.events.length && head().includes('SystemBackup'));
    t('saved log cannot be cleared', !acts(0).includes('Clear Log...') && acts(0).includes('Delete'));

    /* ---------------- custom views */
    E.write('System', { id: 4199, source: 'Tcpip', level: 'Error', message: 'The system detected an address conflict for IP address 192.168.1.60 with the system having network hardware address 00-15-5D-01-02-04. Network operations on this system may be disrupted as a result.' });
    E.write('Application', { id: 1000, source: 'MyApp', level: 'Warning', message: 'Disk C: is nearly full.' });
    await go('ev-cvb:admin');
    const adm = rows();
    t('Administrative Events: Critical, Error and Warning from all logs', adm.length > 0 && adm.every(e => ['Critical', 'Error', 'Warning'].includes(e.level)) && adm.some(e => e.id === 4199 && e.log === 'System') && adm.some(e => e.source === 'MyApp' && e.log === 'Application'));
    t('custom view actions', ['Filter Current Custom View...', 'Properties', 'Duplicate Custom View...', 'Export Custom View...', 'Save All Events in Custom View As...'].every(a => acts(0).includes(a)), acts(0));
    p = c.createCustomView({ onCreate: d => { dlg = d; }, onSave: d => setTimeout(() => { d.name.value = 'Service errors'; d.description.value = 'Errors from System and Application'; d.ok(); }, 20) }); await wait(60);
    t('Create Custom View enables By log / By source', dlgTitle() === 'Create Custom View' && !dlg.c.byLog.input.disabled && !dlg.c.logs.input.disabled);
    await click('OK');
    t('a custom view needs a log', dlgTitle() === 'Event Viewer' && shade().textContent.includes('Select at least one event log.'));
    await click('OK');
    dlg.c.logs.open(); await wait(30);
    [...shade().querySelectorAll('.ev-ddpanel .chk')].find(x => x.textContent === 'System').querySelector('input').click(); await wait(20);
    [...shade().querySelectorAll('.ev-ddpanel .chk')].find(x => x.textContent === 'Application').querySelector('input').click(); await wait(20);
    dlg.c.levels.Error.checked = true; dlg.c.levels.Critical.checked = true;
    if (stop('create')) return;
    await click('OK'); await wait(80);
    const cv = await p; await wait(80);
    const stored = E.customViews().find(v => v.name === 'Service errors');
    t('custom view saved in state.events.customViews', !!cv && !!stored && stored.filter.logs.join() === 'System,Application' && stored.filter.levels.join() === 'Critical,Error');
    t('new custom view is selected under Custom Views', mmc.current().id === 'ev-cv:' + stored.id && treeLabels().includes('Service errors') && rows().every(e => ['Critical', 'Error'].includes(e.level)) && rows().some(e => e.id === 4199));
    path = await V.exportCustomView(stored, { onPicker: pk => setTimeout(() => { pk.setName('service-errors.xml'); pk.ok(); }, 20) });
    t('Export Custom View writes a ViewerConfig file', WS.fs.readFile(path).startsWith('<ViewerConfig><QueryConfig><QueryParams><Simple><Channel>System,Application</Channel>') && WS.fs.readFile(path).includes('<Name>Service errors</Name>'));
    const imp = await c.importCustomView({ onPicker: pk => setTimeout(() => { pk.setName(path); pk.ok(); }, 20), onCreate: d => setTimeout(() => { d.name.value = 'Imported errors'; d.ok(); }, 20) });
    await wait(80);
    t('Import Custom View recreates the filter', !!imp && imp.filter.levels.join() === 'Critical,Error' && imp.filter.logs.join() === 'System,Application' && mmc.current().id === 'ev-cv:' + imp.id);
    p = c.remove(c.info()); await wait(50); await click('Yes'); await p; await wait(60);
    t('Delete removes a custom view', !E.customViews().some(v => v.id === imp.id) && !treeLabels().includes('Imported errors'));

    /* ---------------- Subscriptions */
    await go('ev-sub'); await wait(30);
    t('Subscriptions asks to start the Windows Event Collector Service', dlgTitle() === 'Event Viewer' && shade().textContent.includes('The Windows Event Collector Service must be running and configured to manage subscriptions.'));
    if (stop('subs')) return;
    await click('No'); await wait(40);
    t('No leaves subscriptions unconfigured', !WS.state.eventvwr.collector && !el.querySelector('.mmc-rbody .lv'));
    await go('System'); await go('ev-sub'); await wait(30); await click('Yes'); await wait(80);
    t('Yes configures the collector and shows the list', WS.state.eventvwr.collector && !!el.querySelector('.mmc-rbody .lv') && acts(0).includes('Create Subscription...'));

    /* ---------------- roles: DNS Server, then a domain controller */
    t('DNS role installs', WS.features.install(['DNS'], { includeManagementTools: true }).ok);
    await wait(120);
    await go('ev-asl'); mmc.tree.expand('ev-asl'); await wait(40);
    t('DNS Server log appears once the role is installed', treeLabels().includes('DNS Server'));
    t('Server Roles gets a DNS Server view', E.logNames().includes('DNS Server') && (c.select('ev-cvb:role-DNS'), mmc.current().id === 'ev-cvb:role-DNS'));
    WS.dns.createZone({ name: 'lab.local' }); await wait(120);
    t('DNS Server role view shows zone event 770', rows().some(e => e.id === 770 && e.message.includes('lab.local')));
    WS.state.system.adminPassword = 'ForestP@ss2025!';
    WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
    WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
    WS.sys.onBoot();
    const promoted = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'RestoreP@ss2025!', noReboot: true });
    WS.sys.onBoot(); await wait(150);
    t('domain fixture promotes', promoted.ok, promoted);
    await go('ev-asl'); await wait(40);
    t('Directory Service and DFS Replication logs appear on a DC', treeLabels().includes('Directory Service') && treeLabels().includes('DFS Replication'));
    await go('ev-cvb:role-AD-Domain-Services');
    t('Active Directory Domain Services role view', mmc.current().id === 'ev-cvb:role-AD-Domain-Services' && rows().some(e => e.source === 'NTDS General') && rows().some(e => e.source === 'NETLOGON'));
    t('events now carry the DC name', E.list('System')[0].computer === WS.sys.fqdn() && /\.contoso\.local$/i.test(E.list('System')[0].computer));
    if (stop('roles')) return;

    /* ---------------- Overview after the work */
    await go('ev-root');
    const ovt = () => el.querySelector('.ev-ov').textContent;
    t('Recently Viewed Nodes lists the logs viewed', ovt().includes('Windows Logs\\System') && ovt().includes('Custom Views\\Administrative Events'));
    t('Log Summary lists logs with sizes and retention', ovt().includes('Overwrite events as necessary') && ovt().includes('Directory Service') && /\d+ KB\/\d+\.\d\d MB/.test(ovt()));
    const errRow = [...el.querySelectorAll('.ev-sumtype')].find(r => r.textContent.includes('Error'));
    t('Summary of Administrative Events counts errors', !!errRow && +errRow.querySelectorAll('.ev-td')[4].textContent >= 1);
    errRow.querySelector('.ev-xtog').click(); await wait(40);
    const item = [...el.querySelectorAll('.ev-sumitem')].find(r => r.textContent.includes('4199') && r.textContent.includes('Tcpip'));
    t('expanding a level lists Event ID, Source and Log', !!item && item.textContent.includes('System'));
    if (stop('overview')) return;
    item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(120);
    t('double-clicking a summary row opens the filtered log', mmc.current().id === 'ev-log:System' && rows().length >= 1 && rows().every(e => e.id === 4199 && e.source === 'Tcpip'));
    c.clearFilter(); await wait(40);
    c.setPreview(false); await wait(60);
    t('View > Preview Pane hides the preview', getComputedStyle(pv()).display === 'none' && !WS.state.eventvwr.preview);
    c.setPreview(true); await wait(40);

    /* ---------------- Event Properties with no console open (DNS Manager calls this) */
    win.close(); await wait(40);
    t('console closes cleanly', !el.isConnected && !V.consoles().length);
    const sysEvents = E.list('System');
    let pd;
    p = V.eventProperties('System', sysEvents[1].record, { onCreate: d => { pd = d; } }); await wait(60);
    t('eventProperties works without Event Viewer open', dlgTitle() === `Event Properties - Event ${sysEvents[1].id}, ${sysEvents[1].source}` && pd.entry.log === 'System');
    t('arrows walk the whole log by default', pd.prev() && pd.entry.record === sysEvents[0].record && !pd.prev() && pd.next() && pd.next() && pd.entry.record === sysEvents[2].record);
    pd.mode('xml'); await wait(20);
    t('dialog can show the XML View', shade().querySelector('.ev-xml').textContent.includes(`<EventRecordID>${sysEvents[2].record}</EventRecordID>`));
    pd.close(); await p;
    p = V.eventProperties('System', 999999); await wait(50);
    t('unknown record reports an error', dlgTitle() === 'Event Viewer' && shade().textContent.includes('could not be found'));
    await click('OK');
    t('returns null for an unknown record', (await p) === null);
    const w2 = WS.apps.launch('eventvwr', { select: 'DNS Server' }); await wait(120);
    t('launch can open straight to a log', w2.eventvwr.mmc.current().id === 'ev-log:DNS Server');
    w2.close();
  } catch (e) {
    fail++; console.log('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
  }
  console.log(`RESULT ${pass} passed, ${fail} failed`);
})();
