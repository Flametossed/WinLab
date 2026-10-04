/* System model: computer identity, domain role, time zone, Remote Desktop, restart handling.
 * Other model modules hook into boot/shutdown with WS.sys.on('boot' | 'shutdown', fn).
 * State: state.system. */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;

  /* Windows time zone display names -> IANA ids (subset; add more as needed). */
  const TIME_ZONES = [
    ['Dateline Standard Time', '(UTC-12:00) International Date Line West', 'Etc/GMT+12'],
    ['Hawaiian Standard Time', '(UTC-10:00) Hawaii', 'Pacific/Honolulu'],
    ['Alaskan Standard Time', '(UTC-09:00) Alaska', 'America/Anchorage'],
    ['Pacific Standard Time', '(UTC-08:00) Pacific Time (US & Canada)', 'America/Los_Angeles'],
    ['US Mountain Standard Time', '(UTC-07:00) Arizona', 'America/Phoenix'],
    ['Mountain Standard Time', '(UTC-07:00) Mountain Time (US & Canada)', 'America/Denver'],
    ['Central Standard Time', '(UTC-06:00) Central Time (US & Canada)', 'America/Chicago'],
    ['Eastern Standard Time', '(UTC-05:00) Eastern Time (US & Canada)', 'America/New_York'],
    ['Atlantic Standard Time', '(UTC-04:00) Atlantic Time (Canada)', 'America/Halifax'],
    ['E. South America Standard Time', '(UTC-03:00) Brasilia', 'America/Sao_Paulo'],
    ['UTC', '(UTC) Coordinated Universal Time', 'Etc/UTC'],
    ['GMT Standard Time', '(UTC+00:00) Dublin, Edinburgh, Lisbon, London', 'Europe/London'],
    ['W. Europe Standard Time', '(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna', 'Europe/Berlin'],
    ['Romance Standard Time', '(UTC+01:00) Brussels, Copenhagen, Madrid, Paris', 'Europe/Paris'],
    ['South Africa Standard Time', '(UTC+02:00) Harare, Pretoria', 'Africa/Johannesburg'],
    ['FLE Standard Time', '(UTC+02:00) Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius', 'Europe/Helsinki'],
    ['Russian Standard Time', '(UTC+03:00) Moscow, St. Petersburg', 'Europe/Moscow'],
    ['Arabian Standard Time', '(UTC+04:00) Abu Dhabi, Muscat', 'Asia/Dubai'],
    ['India Standard Time', '(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi', 'Asia/Kolkata'],
    ['SE Asia Standard Time', '(UTC+07:00) Bangkok, Hanoi, Jakarta', 'Asia/Bangkok'],
    ['China Standard Time', '(UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi', 'Asia/Shanghai'],
    ['Singapore Standard Time', '(UTC+08:00) Kuala Lumpur, Singapore', 'Asia/Singapore'],
    ['Tokyo Standard Time', '(UTC+09:00) Osaka, Sapporo, Tokyo', 'Asia/Tokyo'],
    ['AUS Eastern Standard Time', '(UTC+10:00) Canberra, Melbourne, Sydney', 'Australia/Sydney'],
    ['New Zealand Standard Time', '(UTC+12:00) Auckland, Wellington', 'Pacific/Auckland']
  ].map(([id, display, iana]) => ({ id, display, iana }));

  WS.store.init('system', s => {
    s.system = {
      computerName: 'WIN-' + U.randomAlnum(11),
      pendingComputerName: null,
      workgroup: 'WORKGROUP',
      domain: null,              // FQDN once the server is a domain controller, e.g. 'contoso.local'
      domainRole: 'StandaloneServer', // StandaloneServer | PrimaryDomainController
      edition: 'Windows Server 2025 Datacenter Evaluation',
      version: '10.0.26100',
      build: '26100.1742',
      timeZone: '(UTC-08:00) Pacific Time (US & Canada)',
      timeZoneId: 'Pacific Standard Time',
      rdpEnabled: false,
      rdpNla: true,
      remoteMgmt: true,
      adminPassword: null,
      installDate: new Date().toISOString(),
      pendingReboot: []
    };
  });

  const hooks = { boot: [], shutdown: [] };
  function runHooks(kind, arg) {
    for (const fn of hooks[kind]) { try { fn(arg); } catch (e) { console.error(kind + ' hook failed', e); } }
  }
  function requireReboot(tag) {
    const p = WS.state.system.pendingReboot;
    if (!p.includes(tag)) { p.push(tag); WS.store.changed('system'); }
  }

  WS.sys = {
    timeZones: TIME_ZONES,
    get name() { return WS.state.system.computerName; },
    isDC: () => WS.state.system.domainRole === 'PrimaryDomainController',
    /** Full DNS name: DC01.contoso.local, or just DC01 in a workgroup. */
    fqdn() { const s = WS.state.system; return s.domain ? `${s.computerName}.${s.domain}` : s.computerName; },
    /** NetBIOS domain name (CONTOSO) or the workgroup. */
    netbiosDomain() { const s = WS.state.system; return s.domain ? (WS.state.ad && WS.state.ad.netbios) || s.domain.split('.')[0].toUpperCase() : s.workgroup; },
    restartPending: () => WS.state.system.pendingReboot.length > 0,
    requireReboot,
    on(kind, fn) { hooks[kind].push(fn); },

    rename(newName) {
      const err = U.validateComputerName(newName);
      if (err) return { ok: false, error: err };
      WS.state.system.pendingComputerName = newName.toUpperCase();
      requireReboot('rename');
      WS.store.changed('system');
      return { ok: true, restartRequired: true };
    },
    setWorkgroup(name) {
      name = String(name || '').trim().toUpperCase();
      if (!name) return { ok: false, error: 'The workgroup name cannot be blank.' };
      if (name.length > 15 || /[\\/:*?"<>|,]/.test(name)) return { ok: false, error: `The new workgroup name "${name}" is not valid.` };
      if (WS.sys.isDC()) return { ok: false, error: 'The domain membership of a domain controller cannot be changed.' };
      WS.state.system.workgroup = name;
      requireReboot('rename');
      WS.store.changed('system');
      return { ok: true, restartRequired: true };
    },
    setTimeZone(idOrDisplay) {
      const tz = TIME_ZONES.find(t => t.id.toLowerCase() === String(idOrDisplay).toLowerCase() || t.display === idOrDisplay);
      if (!tz) return { ok: false, error: `The time zone '${idOrDisplay}' was not found.` };
      const s = WS.state.system;
      s.timeZoneId = tz.id; s.timeZone = tz.display;
      WS.store.changed('system');
      return { ok: true };
    },
    timeZone() { return TIME_ZONES.find(t => t.id === WS.state.system.timeZoneId) || TIME_ZONES[3]; },
    /** The wall-clock time in the server's time zone, as a Date whose local fields (getHours()...) read that time.
     * The taskbar clock, lock screen, calendar and Settings use it; event and file timestamps still use the browser's zone. */
    now(d = new Date()) {
      try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: WS.sys.timeZone().iana, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
          .formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
        return new Date(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
      } catch (e) { return d; }
    },
    /** The VM lost power without shutting down (VMConnect's Turn Off or Reset): the next boot logs 41/6008 and asks why. */
    powerLoss(kind) {
      WS.state.system.powerLoss = { kind, time: new Date().toISOString() };
      WS.store.save();
    },
    /** Enable/disable Remote Desktop: also flips the firewall rule group and the TermService service. */
    setRemoteDesktop(enabled, nla) {
      const s = WS.state.system;
      s.rdpEnabled = !!enabled;
      if (nla != null) s.rdpNla = !!nla;
      if (WS.fw) WS.fw.setGroupEnabled('Remote Desktop', !!enabled);
      if (WS.svc) {
        if (enabled) { WS.svc.setStartup('TermService', 'Manual'); WS.svc.start('TermService'); WS.svc.start('UmRdpService'); }
      }
      WS.store.changed('system');
      return { ok: true };
    },

    /** Called by the shell during boot: applies changes that were waiting on a restart, then runs boot hooks. */
    onBoot() {
      const sys = WS.state.system;
      const oldName = sys.computerName;
      if (sys.pendingComputerName) { sys.computerName = sys.pendingComputerName; sys.pendingComputerName = null; }
      sys.pendingReboot = [];
      WS.state.meta.bootCount = (WS.state.meta.bootCount || 0) + 1;
      sys.lastBoot = new Date().toISOString();
      runHooks('boot', { renamedFrom: oldName !== sys.computerName ? oldName : null });
      WS.store.changed('system');
    },
    /** Called by the shell before it shuts down or restarts. */
    /** reason: { title, code, planned, comment } from the Shutdown Event Tracker (none: "No title for this reason could be found"). */
    onShutdown(restart, reason) {
      runHooks('shutdown', { restart: !!restart, user: WS.session && WS.session.user, reason: reason || null });
      WS.store.save();
    }
  };
})();
