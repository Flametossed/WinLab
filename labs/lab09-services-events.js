/* Built-in lab: troubleshoot with Event Viewer, fix a service, and manage the event logs. */
WS.labs.register({
  id: 'lab09-services-events',
  title: 'Lab 09: Services and Event Viewer',
  difficulty: 'Beginner',
  minutes: 20,
  description: 'Users on DC01 cannot print, and the System log keeps filling up. Use Event Viewer to find out what changed, fix the service, and set up the logs for the next incident.',
  setup: (s, WS) => {
    WS.labs.fixtures.configured(s);
    WS.labs.withState(s, () => {
      WS.svc.stop('Spooler', { force: true });
      WS.svc.setStartup('Spooler', 'Disabled');
      WS.fs.ensureDir('C:\\Logs');
    });
  },
  objectives: [
    {
      id: 'find',
      text: 'In the System log, find the Service Control Manager event (7040) that shows when the Print Spooler start type was changed. Then set Print Spooler to start automatically and start it.',
      hint: 'Event Viewer > Windows Logs > System > Filter Current Log... with Event ID 7040. Then Services > Print Spooler > Properties > Startup type: Automatic > Apply > Start. Or: Set-Service Spooler -StartupType Automatic; Start-Service Spooler',
      check: { service: { name: 'Spooler', status: 'Running', startup: 'Automatic' } }
    },
    {
      id: 'harden',
      text: 'This server is not managed remotely through the registry: disable the Remote Registry service.',
      hint: 'Services > Remote Registry > Startup type: Disabled. Or: Set-Service RemoteRegistry -StartupType Disabled',
      check: { service: { name: 'RemoteRegistry', startup: 'Disabled' } }
    },
    {
      id: 'size',
      text: 'Increase the maximum size of the System log to 40,960 KB.',
      hint: 'Right-click System > Properties > Maximum log size (KB). Or: Limit-EventLog -LogName System -MaximumSize 40MB',
      check: { eventLog: { name: 'System', minMaxKB: 40960 } }
    },
    {
      id: 'archive',
      text: 'Save all events in the Application log to C:\\Logs\\Application.evtx, then clear the Application log.',
      hint: 'Right-click Application > Clear Log... > Save and Clear, and save the file in C:\\Logs.',
      check: { all: [{ file: { path: 'C:\\Logs\\Application.evtx' } }, { event: { log: 'System', id: 104, contains: 'Application' } }] }
    },
    {
      id: 'view',
      text: 'Create a custom view named "Service errors" that shows Critical and Error events from the System log.',
      hint: 'Custom Views > Create Custom View... > Critical and Error, By log: System > OK, then type the name.',
      check: { customView: { name: 'Service errors', logs: ['System'], levels: ['Critical', 'Error'] } }
    }
  ]
});
