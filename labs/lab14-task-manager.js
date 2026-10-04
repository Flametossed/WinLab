/* Built-in lab: troubleshoot a slow server with Task Manager (or Get-Process / tasklist / taskkill). */
WS.labs.register({
  id: 'lab14-task-manager',
  title: 'Lab 14: Processes and Task Manager',
  difficulty: 'Intermediate',
  minutes: 20,
  description: 'Users say DC01 has become slow since a vendor visit. Use Task Manager to find what is using the CPU and memory, deal with a program that has stopped responding, and stop the culprits from coming back.',
  setup: (s, WS) => {
    WS.labs.fixtures.configured(s);
    WS.labs.withState(s, () => {
      const exe = (path, size) => { WS.fs.ensureDir(path.replace(/\\[^\\]+$/, '')); WS.fs.writeFile(path, 'MZ', null, { size }); };
      exe('C:\\Program Files\\Fabrikam\\DataSync\\datasync.exe', 2318336);
      exe('C:\\Program Files\\Contoso\\UpdateHelper\\cupdsvc.exe', 1187840);
      exe('C:\\Program Files\\Contoso\\Reports\\reportgen.exe', 3407872);
      exe('C:\\Program Files\\Contoso\\Search\\indexer.exe', 905216);
      // a startup app that pins two processors as soon as an administrator signs in
      WS.proc.addStartup({ id: 'datasync', name: 'DataSync Agent', publisher: 'Fabrikam, Inc.', command: '"C:\\Program Files\\Fabrikam\\DataSync\\datasync.exe" /background', location: 'HKLM', enabled: true, impact: 'High' });
      WS.proc.addCustom({ id: 'datasync', image: 'datasync.exe', path: 'C:\\Program Files\\Fabrikam\\DataSync\\datasync.exe', description: 'DataSync Agent', company: 'Fabrikam, Inc.', version: '7.4.1.0', cpu: 48, mem: 96400, disk: 1.8, net: 0.6, threads: 9, startWith: 'startup:datasync' });
      // a service whose process leaks memory; its recovery settings restart it after it is ended
      WS.svc.define({ name: 'ContosoUpdate', display: 'Contoso Update Helper', startup: 'Automatic', status: 'Running', logon: 'Local System', desc: 'Keeps Contoso line-of-business applications up to date.', path: '"C:\\Program Files\\Contoso\\UpdateHelper\\cupdsvc.exe"', recovery: 'restart', restartMs: 5000 });
      WS.proc.addCustom({ id: 'cupdsvc', image: 'cupdsvc.exe', path: 'C:\\Program Files\\Contoso\\UpdateHelper\\cupdsvc.exe', description: 'Contoso Update Helper Service', company: 'Contoso Ltd.', version: '3.2.0.114', cpu: 2, mem: 412000, leakKBps: 1400, threads: 24, startWith: 'service:ContosoUpdate' });
      // a hung reporting tool and a background indexer
      WS.proc.addCustom({ id: 'reportgen', image: 'reportgen.exe', path: 'C:\\Program Files\\Contoso\\Reports\\reportgen.exe', description: 'Contoso Report Generator', company: 'Contoso Ltd.', version: '2.0.3.0', cpu: 0, mem: 218500, threads: 14, status: 'Not responding', startWith: 'boot' });
      WS.proc.addCustom({ id: 'indexer', image: 'indexer.exe', path: 'C:\\Program Files\\Contoso\\Search\\indexer.exe', description: 'Contoso Search Indexer', company: 'Contoso Ltd.', version: '5.1.0.7', cpu: 11, mem: 64200, disk: 3.2, threads: 6, startWith: 'boot' });
    });
  },
  objectives: [
    {
      id: 'cpu',
      text: 'The server is slow. Find the process that is using the most CPU and end it.',
      hint: 'Task Manager (Ctrl+Shift+Esc, or right-click the taskbar) > Processes > click the CPU column to sort > select DataSync Agent > End task. Or: Get-Process | Sort-Object CPU -Descending | Select-Object -First 5, then Stop-Process -Name datasync (or taskkill /im datasync.exe /f).',
      check: { process: { name: 'datasync.exe', running: false } }
    },
    {
      id: 'startup',
      text: 'Ending it only lasts until the next sign-in. Stop DataSync Agent from starting automatically.',
      hint: 'Task Manager > Startup apps > DataSync Agent > Disable. Get-CimInstance Win32_StartupCommand lists the startup commands.',
      check: { startupApp: { name: 'DataSync Agent', enabled: false } }
    },
    {
      id: 'dump',
      text: 'reportgen.exe has stopped responding. Before you end it, create a memory dump file of it for the vendor.',
      hint: 'Task Manager > Details > right-click reportgen.exe (Status: Not responding) > Create memory dump file. The dump goes to C:\\Users\\Administrator\\AppData\\Local\\Temp.',
      check: { file: { path: 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\reportgen.DMP' } }
    },
    {
      id: 'hung',
      text: 'Now end reportgen.exe.',
      hint: 'Details > reportgen.exe > End task > End process. Or: Stop-Process -Name reportgen -Force',
      check: { all: [{ process: { name: 'reportgen.exe', running: false } }, { file: { path: 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\reportgen.DMP' } }] }
    },
    {
      id: 'priority',
      text: 'The search indexer (indexer.exe) must keep running, but it should not compete with users. Set its priority to Below normal.',
      hint: 'Details > right-click indexer.exe > Set priority > Below normal > Change priority. Or: (Get-Process indexer).PriorityClass = "BelowNormal"',
      check: { process: { name: 'indexer.exe', priority: 'BelowNormal' } }
    },
    {
      id: 'leak',
      text: 'cupdsvc.exe keeps growing in memory, and ending it does not help. Find the service that runs it, then stop that service and disable it.',
      hint: 'Details > right-click cupdsvc.exe > Go to service(s), or: tasklist /svc /fi "imagename eq cupdsvc.exe". Then Services > right-click > Stop, and Services (services.msc) > Startup type: Disabled. Or: Stop-Service ContosoUpdate; Set-Service ContosoUpdate -StartupType Disabled',
      check: { service: { name: 'ContosoUpdate', status: 'Stopped', startup: 'Disabled' } }
    }
  ]
});
