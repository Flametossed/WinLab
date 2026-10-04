/* Active Directory Domain Services Configuration Wizard ("Promote this server to a domain controller").
 * New forest only (the lab has no other DC to join): the "existing domain" options fail the way they do when the
 * domain can't be contacted. Install runs WS.ad.installForest - the same call Install-ADDSForest will make - then
 * signs out and restarts, as the real wizard does. WS.sm.addsConfig(opts); opts.onCreate(w) for tests. */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons, F = () => WS.ui.f;

  const LEVELS = [['Win2016', 'Windows Server 2016'], ['Win2025', 'Windows Server 2025']];
  const levelName = id => LEVELS.find(l => l[0] === id)[1];
  const DELEGATION = d => `A delegation for this DNS server cannot be created because the authoritative parent zone cannot be found or it does not run Windows DNS server. If you are integrating with an existing DNS infrastructure, you should manually create a delegation to this DNS server in the parent zone to ensure reliable name resolution from outside the domain "${d}". Otherwise, no action is required.`;

  /** Yellow / red / green information bar with "Show more". */
  function banner(kind, text) {
    const t = h('div.t.clip', text);
    const more = h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); WS.ui.msgbox({ title: 'Active Directory Domain Services Configuration Wizard', icon: kind === 'err' ? 'error' : kind === 'ok' ? 'info' : 'warning', message: text, width: 520 }); } }, 'Show more');
    return h('div.wz-banner' + (kind ? '.' + kind : ''), h('span', { html: kind === 'err' ? I.eventError : kind === 'ok' ? I.enable : I.eventWarning }), t, more);
  }

  function launch(opts = {}) {
    const existing = WS.wm.find('addsconfig');
    if (existing) { existing.restore(); return null; }
    if (WS.sys.isDC()) { WS.ui.msgbox({ title: 'Active Directory Domain Services Configuration Wizard', icon: 'info', message: `${WS.sys.name} is already a domain controller for ${WS.state.system.domain}.` }); return null; }
    const title = 'Active Directory Domain Services Configuration Wizard';
    const d = { op: 'existing', domain: '', forestMode: 'Win2025', domainMode: 'Win2025', dns: true, dsrm: '', dsrm2: '', netbios: '', netbiosFor: '',
      db: 'C:\\Windows\\NTDS', log: 'C:\\Windows\\NTDS', sysvol: 'C:\\Windows\\SYSVOL' };

    const pages = [
      {
        id: 'deploy', nav: 'Deployment Configuration', title: 'Deployment Configuration',
        render: () => {
          const host = h('div');
          const radio = (op, text) => F().radio('op', text, d.op === op, { onChange: v => { if (v) { d.op = op; paint(); } } });
          const paint = () => {
            U.clear(host);
            if (d.op === 'forest') {
              const inp = F().text({ value: d.domain, onInput: v => { d.domain = v.trim(); } });
              host.appendChild(F().row('Root domain name:', inp, { labelWidth: 130 }));
              setTimeout(() => inp.focus(), 0);
            } else {
              const inp = F().text({ value: d.domain, onInput: v => { d.domain = v.trim(); } });
              if (d.op === 'child') {
                host.appendChild(F().row('Select domain type:', F().select(['Child Domain', 'Tree Domain'], 'Child Domain', { width: 200 }), { labelWidth: 130 }));
                host.appendChild(F().row('Parent domain name:', h('span', { style: 'display:flex;gap:6px;flex:1' }, inp, F().button('Select...', () => notFound())), { labelWidth: 130 }));
                host.appendChild(F().row('New domain name:', F().text(), { labelWidth: 130 }));
              } else host.appendChild(F().row('Domain:', h('span', { style: 'display:flex;gap:6px;flex:1' }, inp, F().button('Select...', () => notFound())), { labelWidth: 130 }));
              host.appendChild(h('div.wz-section', 'Supply the credentials to perform this operation'));
              host.appendChild(h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('span', '<No credentials provided>'), F().button('Change...', () => notFound())));
            }
          };
          const notFound = () => WS.ui.msgbox({ title: 'Deployment Configuration', icon: 'error', message: 'No other Active Directory domain or forest can be contacted from this server.', detail: 'This lab has a single server. Choose "Add a new forest" to create the first domain controller.' });
          paint();
          return h('div.wz-text', h('div.wz-section', { style: 'margin-top:0' }, 'Select the deployment operation'),
            radio('existing', 'Add a domain controller to an existing domain'), radio('child', 'Add a new domain to an existing forest'), radio('forest', 'Add a new forest'),
            h('div.wz-section', 'Specify the domain information for this operation'), host);
        },
        validate: () => {
          if (d.op === 'forest') return WS.ad.validateDomainName(d.domain);
          if (!d.domain) return 'You must specify the domain name.';
          return `Verification of replica failed. The specified domain "${d.domain}" either does not exist or could not be contacted.`;
        }
      },
      {
        id: 'options', nav: 'Domain Controller Options', title: 'Domain Controller Options',
        render: () => {
          const forest = F().select(LEVELS.map(([v, l]) => ({ value: v, label: l })), d.forestMode, { width: 220 });
          const domainSel = h('span');
          const paintDomain = () => {
            const allowed = LEVELS.filter(([v]) => v >= d.forestMode);
            if (!allowed.some(([v]) => v === d.domainMode)) d.domainMode = allowed[0][0];
            U.clear(domainSel);
            domainSel.appendChild(F().select(allowed.map(([v, l]) => ({ value: v, label: l })), d.domainMode, { width: 220, onChange: v => { d.domainMode = v; } }));
          };
          forest.addEventListener('change', () => { d.forestMode = forest.value; paintDomain(); });
          paintDomain();
          const pw = F().text({ password: true, value: d.dsrm, onInput: v => { d.dsrm = v; } });
          const pw2 = F().text({ password: true, value: d.dsrm2, onInput: v => { d.dsrm2 = v; } });
          return h('div.wz-text',
            h('div.wz-section', { style: 'margin-top:0' }, 'Select functional level of the new forest and root domain'),
            F().row('Forest functional level:', forest, { labelWidth: 160 }),
            F().row('Domain functional level:', domainSel, { labelWidth: 160 }),
            h('div.wz-section', 'Specify domain controller capabilities'),
            F().checkbox('Domain Name System (DNS) server', d.dns, { onChange: v => { d.dns = v; } }),
            F().checkbox('Global Catalog (GC)', true, { disabled: true }),
            F().checkbox('Read only domain controller (RODC)', false, { disabled: true }),
            h('div.wz-section', 'Type the Directory Services Restore Mode (DSRM) password'),
            F().row('Password:', pw, { labelWidth: 120 }), F().row('Confirm password:', pw2, { labelWidth: 120 }));
        },
        validate: () => {
          if (!d.dsrm) return 'You must specify a Directory Services Restore Mode (DSRM) password.';
          if (d.dsrm !== d.dsrm2) return 'The passwords do not match.';
          if (U.checkPassword(d.dsrm, { minLength: 7 })) return 'The Directory Services Restore Mode (DSRM) password does not meet the requirements of the password policy. Use a password of at least 7 characters that contains three of the following: uppercase letters, lowercase letters, numbers, and symbols.';
          return null;
        }
      },
      {
        id: 'dns', nav: 'DNS Options', title: 'DNS Options', rerender: true, skip: () => !d.dns,
        render: () => h('div.wz-text', banner('', DELEGATION(d.domain)), h('div.wz-section', 'Specify DNS delegation options'), F().checkbox('Create DNS delegation', false, { disabled: true }))
      },
      {
        id: 'additional', nav: 'Additional Options', title: 'Additional Options', rerender: true,
        render: () => {
          const inp = F().text({ value: d.netbiosFor === d.domain ? d.netbios : '...', disabled: d.netbiosFor !== d.domain, onInput: v => { d.netbios = v.trim().toUpperCase(); } });
          if (d.netbiosFor !== d.domain) setTimeout(() => { d.netbios = WS.ad.defaultNetbios(d.domain); d.netbiosFor = d.domain; inp.value = d.netbios; inp.disabled = false; }, 700);
          return h('div.wz-text', h('div', { style: 'margin-bottom:8px' }, 'Verify the NetBIOS name assigned to the domain and change it if necessary'), F().row('The NetBIOS domain name:', inp, { labelWidth: 170 }));
        },
        validate: () => {
          const nb = d.netbios;
          if (!nb || d.netbiosFor !== d.domain) return 'The NetBIOS domain name is still being verified. Try again in a moment.';
          if (nb.length > 15 || /[.\\/:*?"<>|,~!@#$%^&'(){}_ ]/.test(nb)) return `The NetBIOS domain name "${nb}" is not valid. The name can be at most 15 characters and cannot contain periods or special characters.`;
          return null;
        }
      },
      {
        id: 'paths', nav: 'Paths', title: 'Paths',
        render: () => {
          const pathRow = (label, key) => {
            const inp = F().text({ value: d[key], onInput: v => { d[key] = v.trim(); } });
            const browse = F().button('...', async () => { const p = await WS.ui.filePicker({ mode: 'folder', path: d[key], prompt: 'Select a folder' }); if (p) { d[key] = p; inp.value = p; } });
            browse.style.minWidth = '30px';
            return F().row(label, h('span', { style: 'display:flex;gap:6px;flex:1' }, inp, browse), { labelWidth: 120 });
          };
          return h('div.wz-text', h('div.wz-section', { style: 'margin-top:0' }, 'Specify the location of the AD DS database, log files, and SYSVOL'),
            pathRow('Database folder:', 'db'), pathRow('Log files folder:', 'log'), pathRow('SYSVOL folder:', 'sysvol'));
        },
        validate: () => {
          for (const k of ['db', 'log', 'sysvol']) {
            const p = d[k];
            const v = /^[A-Za-z]:\\/.test(p) && WS.storage.volume(p[0]);
            if (!v || !['NTFS', 'ReFS'].includes(v.fs) || (k === 'sysvol' && v.fs !== 'NTFS')) return `The path "${p}" is not valid. Specify a folder on a local fixed NTFS volume.`;
          }
          return null;
        }
      },
      {
        id: 'review', nav: 'Review Options', title: 'Review Options', rerender: true,
        render: () => h('div.wz-text', h('div', { style: 'margin-bottom:6px' }, 'Review your selections:'), h('div.wz-review', reviewText()),
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' }, h('span', 'These settings can be exported to a Windows PowerShell script to automate additional installations'), F().button('View script', viewScript)))
      },
      {
        id: 'prereq', nav: 'Prerequisites Check', title: 'Prerequisites Check', finish: true, rerender: true,
        render: w => { w.data.prereqHost = h('div'); return h('div.wz-text', w.data.prereqHost); },
        enter: w => runPrereq(w)
      },
      {
        id: 'install', nav: 'Installation', title: 'Installation', rerender: true,
        render: w => { w.data.log = h('div.wz-results'); w.data.bar = h('div.pbar-fill'); return h('div.wz-text', h('div', 'Progress'), h('div.wz-progress', h('div.pbar', w.data.bar)), w.data.log); },
        enter: w => runInstall(w)
      },
      { id: 'results', nav: 'Results', title: 'Results', render: () => h('div') }
    ];

    function reviewText() {
      return [
        'Configure this server as the first Active Directory domain controller in a new forest.',
        '',
        `The new domain name is "${d.domain}". This is also the name of the new forest.`,
        '',
        `The NetBIOS name of the domain: ${d.netbios}`,
        '',
        `Forest Functional Level: ${levelName(d.forestMode)}`,
        '',
        `Domain Functional Level: ${levelName(d.domainMode)}`,
        '',
        'Additional Options:',
        '',
        '  Global catalog: Yes',
        '',
        `  DNS Server: ${d.dns ? 'Yes' : 'No'}`,
        '',
        '  Create DNS Delegation: No',
        '',
        `Database folder: ${d.db}`,
        '',
        `Log file folder: ${d.log}`,
        '',
        `SYSVOL folder: ${d.sysvol}`,
        '',
        d.dns ? 'The DNS Server service will be configured on this computer.\n\nThis computer will be configured to use this DNS server as its preferred DNS server.\n' : null,
        'The password of the new domain Administrator will be the same as the password of the local Administrator of this computer.'
      ].filter(x => x !== null).join('\n');
    }
    function script() {
      return ['#', '# Windows PowerShell script for AD DS Deployment', '#', '', 'Import-Module ADDSDeployment', 'Install-ADDSForest `',
        '-CreateDnsDelegation:$false `', `-DatabasePath "${d.db}" \``, `-DomainMode "${d.domainMode}" \``, `-DomainName "${d.domain}" \``,
        `-DomainNetbiosName "${d.netbios}" \``, `-ForestMode "${d.forestMode}" \``, `-InstallDns:$${d.dns} \``, `-LogPath "${d.log}" \``,
        '-NoRebootOnCompletion:$false `', `-SysvolPath "${d.sysvol}" \``, '-Force:$true', ''].join('\r\n');
    }
    function viewScript() {
      const name = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\' + U.randomAlnum(8) + '.tmp.ps1';
      try { WS.fs.writeFile(name, script()); } catch (e) { /* temp folder missing is harmless */ }
      const ta = F().textarea({ value: script(), readOnly: true, rows: 18 });
      ta.classList.add('wz-mono');
      WS.ui.dialog({ title: name.replace(/^.*\\/, '') + ' - Notepad', width: 620, content: h('div.w32', ta), buttons: [{ label: 'Close', primary: true }] });
    }

    async function runPrereq(w) {
      const host = w.data.prereqHost;
      w.setFinish(false);
      U.clear(host);
      host.appendChild(h('div', 'Prerequisites need to be validated before Active Directory Domain Services is installed on this computer'));
      const bar = h('div.pbar-fill');
      host.appendChild(h('div.wz-progress', h('div.pbar', bar)));
      for (const pct of [25, 55, 85, 100]) { bar.style.width = pct + '%'; await U.sleep(250); }
      const r = WS.ad.prereqCheck({ domainName: d.domain, netbios: d.netbios, safeModePassword: d.dsrm, installDns: d.dns });
      w.data.prereq = r;
      U.clear(host);
      host.appendChild(r.errors.length
        ? banner('err', 'Prerequisites Check failed. Fix the errors shown below and then click Rerun prerequisites check.')
        : banner('ok', "All prerequisite checks passed successfully. Click 'Install' to begin installation."));
      host.appendChild(h('a.lnk', { href: '#', onClick: e => { e.preventDefault(); runPrereq(w); } }, 'Rerun prerequisites check'));
      const res = h('div.wz-results');
      for (const t of r.errors) res.appendChild(h('div.it', h('span', { html: I.eventError }), h('div', t)));
      for (const t of r.warnings) res.appendChild(h('div.it', h('span', { html: I.eventWarning }), h('div', t)));
      host.appendChild(h('div.wz-section', 'View results'));
      host.appendChild(res);
      host.appendChild(h('p', { style: 'margin-top:8px' }, 'If you click Install, the server will be restarted automatically at the end of the promotion operation.'));
      w.setFinish(!r.errors.length);
    }

    async function runInstall(w) {
      const log = w.data.log, bar = w.data.bar;
      const say = (t, icon) => { log.appendChild(h('div.it', icon ? h('span', { html: icon }) : h('span', { style: 'width:16px' }), h('div', t))); log.scrollTop = log.scrollHeight; };
      w.busy(true);
      const dn = d.domain.split('.').map(p => 'DC=' + p).join(',');
      const steps = ['Determining DNS Settings...', 'Validating environment and user input...', 'All tests completed successfully', 'Installing new forest...',
        'Configuring the local computer to host Active Directory Domain Services', `Creating directory partition: CN=Schema,CN=Configuration,${dn}`, `Creating directory partition: CN=Configuration,${dn}`];
      let pct = 0;
      for (const s of steps) { say(s); pct += 10; bar.style.width = pct + '%'; await U.sleep(300); }
      const r = WS.ad.installForest({ domainName: d.domain, netbios: d.netbios, safeModePassword: d.dsrm, forestMode: d.forestMode, domainMode: d.domainMode,
        installDns: d.dns, databasePath: d.db, logPath: d.log, sysvolPath: d.sysvol, noReboot: true });
      if (!r.ok) {
        bar.style.background = '#c42b1c';
        say('The operation failed because:', I.eventError); say(r.error);
        w.busy(false);
        return;
      }
      for (const s of [d.dns ? 'Configuring the DNS Server service on this computer...' : null, 'Securing machine\\domain controller...', 'The server was successfully configured as a domain controller'].filter(Boolean)) { say(s); pct += 10; bar.style.width = Math.min(100, pct) + '%'; await U.sleep(300); }
      bar.style.width = '100%';
      say('This server was successfully configured as a domain controller', I.enable);
      say('Your computer is about to be restarted.');
      WS.sm.notify({ title: 'Post-deployment Configuration', message: `Active Directory Domain Services configuration succeeded on ${WS.sys.name}.`, status: 'done', actions: [] });
      await U.sleep(400);
      const notice = WS.ui.msgbox({ title: "You're about to be signed out", icon: 'warning', message: 'Your computer will restart because Active Directory Domain Services was installed or removed.', buttons: ['Close'] });
      await Promise.race([notice, U.sleep(opts.restartDelay != null ? opts.restartDelay : 10000)]);
      if (opts.noRestart) return;
      WS.ui.closeMenu();
      document.querySelectorAll('#dialogs .dlg-shade').forEach(s => s.remove());
      WS.shell.restart();
    }

    return WS.ui.wizard({ title, style: 'server', asWindow: true, app: 'addsconfig', icon: I.domain, width: 820, height: 600,
      destination: 'TARGET SERVER\n' + WS.sys.fqdn(), pages, data: d, onFinish: () => null,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, d); } });
  }

  WS.sm.addsConfig = launch;
})();
