/* SConfig: console-only configuration over the shared server models. */
(function () {
  'use strict';
  const WS = window.WS;
  WS.term.sconfig = async function (io) {
    const read = async prompt => {
      const value = await io.readLine({ prompt });
      if (value === null) throw new WS.ps.PipelineStopped();
      return value.trim();
    };
    const report = r => {
      io.writeLine(r.ok ? 'Configuration updated successfully.' : r.error);
      for (const warning of r.warnings || []) io.writeLine('WARNING: ' + warning);
      return r.ok;
    };
    const save = (key, value) => { WS.state.system[key] = value; WS.store.changed('system'); };
    const restart = async () => {
      if (/^y(es)?$/i.test(await read('Restart now? (Y/N): '))) {
        io.session.exited = true;
        WS.shell.restart();
        return true;
      }
      return false;
    };
    async function network() {
      for (;;) {
        io.writeLine('\nAvailable network adapters:');
        for (const a of WS.net.ipconfig().adapters) io.writeLine(`  ${a.ifIndex}) ${a.name}   ${a.ip || ''}   ${a.status}`);
        const choice = await read('Select network adapter index (Enter to return): ');
        if (!choice) return;
        const a = WS.net.adapters().find(x => String(x.ifIndex) === choice);
        if (!a) { io.writeLine('Invalid adapter index.'); continue; }
        for (;;) {
          const detail = WS.net.ipconfig().adapters.find(x => x.ifIndex === a.ifIndex);
          io.writeLine(`\nNetwork adapter: ${a.name}\n  IP address: ${detail.ip}\n  Subnet mask: ${detail.mask}\n  Default gateway: ${detail.gateway || ''}\n  DHCP enabled: ${a.dhcp ? 'Yes' : 'No'}\n  DNS servers: ${detail.dnsServers.join(', ')}`);
          io.writeLine('\n  1) Set network adapter address\n  2) Set DNS servers\n  3) Clear DNS server settings\n  4) Return to main menu');
          const item = await read('Select an option (Enter to return): ');
          if (!item || item === '4') return;
          if (item === '1') {
            const mode = (await read('Select (D)HCP or (S)tatic IP address: ')).toUpperCase();
            if (mode === 'D') report(WS.net.setDhcp(a.ifIndex));
            else if (mode === 'S') {
              const ip = await read('Enter static IP address: ');
              const mask = await read('Enter subnet mask (default 255.255.255.0): ') || '255.255.255.0';
              const gateway = await read('Enter default gateway (Enter for none): ');
              report(WS.net.setStatic(a.ifIndex, { ip, mask, gateway }));
            } else io.writeLine('Invalid selection.');
          } else if (item === '2') {
            const first = await read('Enter preferred DNS server: ');
            const second = await read('Enter alternate DNS server (Enter for none): ');
            report(WS.net.setDnsServers(a.ifIndex, [first, second].filter(Boolean)));
          } else if (item === '3') report(WS.net.setDnsServers(a.ifIndex, null));
          else io.writeLine('Invalid selection.');
        }
      }
    }
    try {
      for (;;) {
        if (io.session.exited || io.cancelled()) return 0;
        if (io.console) io.console.clear();
        const s = WS.state.system;
        io.writeLine(`\n  Welcome to ${s.edition}\n\n  Server Configuration\n  ====================\n\n   1) Domain/workgroup:            ${s.domain ? 'Domain: ' + s.domain : 'Workgroup: ' + s.workgroup}\n   2) Computer name:               ${s.computerName}${s.pendingComputerName ? ' (pending: ' + s.pendingComputerName + ')' : ''}\n   3) Add local administrator\n   4) Remote management:           ${s.remoteMgmt ? 'Enabled' : 'Disabled'}\n   5) Update setting:              ${s.updateSetting || 'Download only'}\n   6) Install updates\n   7) Remote desktop:              ${s.rdpEnabled ? 'Enabled' + (s.rdpNla ? ' (NLA required)' : '') : 'Disabled'}\n   8) Network settings\n   9) Date and time\n  10) Telemetry setting:           ${s.telemetrySetting || 'Required'}\n  11) Windows activation\n  12) Log off user\n  13) Restart server\n  14) Shut down server\n  15) Exit to command line (${io.kind === 'cmd' ? 'CMD' : 'PowerShell'})\n`);
        const item = await read('Enter number to select an option: ');
        if (item === '15') return 0;
        if (item === '1') {
          if (WS.sys.isDC()) io.writeLine('The domain membership of a domain controller cannot be changed.');
          else {
            const mode = (await read('Join (D)omain or (W)orkgroup: ')).toUpperCase();
            if (mode === 'W') { if (report(WS.sys.setWorkgroup(await read('Enter workgroup name: '))) && await restart()) return 0; }
            else if (mode === 'D') io.writeLine('Joining an existing domain is not modeled yet. To create a new forest, install AD DS and use Install-ADDSForest.');
            else io.writeLine('Invalid selection.');
          }
        } else if (item === '2') {
          if (report(WS.sys.rename(await read('Enter new computer name: '))) && await restart()) return 0;
        } else if (item === '3') report(WS.local.addMember('Administrators', await read('Enter account name: ')));
        else if (item === '4') {
          io.writeLine('\n  1) Enable remote management\n  2) Disable remote management\n  3) Configure server response to ping');
          const opt = await read('Select an option (Enter to return): ');
          if (opt === '1' || opt === '2') { save('remoteMgmt', opt === '1'); io.writeLine('Remote management ' + (opt === '1' ? 'enabled.' : 'disabled.')); }
          else if (opt === '3') {
            const mode = (await read('Allow ping? (Y/N): ')).toUpperCase();
            if (mode === 'Y' || mode === 'N') report(WS.fw.setEnabled('FPS-ICMP4-ERQ-In', mode === 'Y'));
            else io.writeLine('Invalid selection.');
          }
        } else if (item === '5') {
          const mode = (await read('Updates: (A)utomatic, (D)ownload only, (M)anual: ')).toUpperCase();
          const setting = { A: 'Automatic', D: 'Download only', M: 'Manual' }[mode];
          if (setting) { save('updateSetting', setting); io.writeLine('Update setting saved (simulated).'); }
          else io.writeLine('Invalid selection.');
        } else if (item === '6') {
          const mode = (await read('Search for (A)ll updates or (R)ecommended updates: ')).toUpperCase();
          if (mode === 'A' || mode === 'R') {
            save('lastUpdateSearch', { filter: mode, time: new Date().toISOString() });
            // the same Windows Update model as Settings > Windows Update
            io.writeLine('\n  Searching for updates...');
            const r = await WS.wu.check();
            const items = WS.wu.state().items.filter(i => i.state === 'pending' && (mode === 'A' || i.kind));
            if (!r.ok) io.writeLine(`  Unable to search for updates (${r.code}). Check the network connection and DNS settings.`);
            else if (!items.length) io.writeLine('  No applicable updates found.');
            else {
              io.writeLine(`\n  ${items.length} update(s) found:\n` + items.map((x, i) => `   ${i + 1}) ${x.title}`).join('\n'));
              const c = (await read('\n  Select an option:\n  (A)ll updates\n  (N)o updates\n\n  Enter selection: ')).toUpperCase();
              if (c === 'A') {
                io.writeLine('  Downloading and installing updates...');
                const res = await WS.wu.install();
                io.writeLine(res.restartRequired ? '  Updates installed. Restart the server to finish installing them.' : '  Updates installed.');
              }
            }
          } else io.writeLine('Invalid selection.');
        } else if (item === '7') {
          const mode = (await read('Remote desktop: (E)nable or (D)isable: ')).toUpperCase();
          if (mode === 'D') report(WS.sys.setRemoteDesktop(false));
          else if (mode === 'E') {
            const nla = await read('1) Require Network Level Authentication\n2) Allow clients with any version of Remote Desktop\nSelect an option: ');
            if (nla === '1' || nla === '2') report(WS.sys.setRemoteDesktop(true, nla === '1'));
            else io.writeLine('Invalid selection.');
          } else io.writeLine('Invalid selection.');
        } else if (item === '8') await network();
        else if (item === '9') io.launch('timedate');
        else if (item === '10') {
          const mode = await read('Telemetry: 1) Required  2) Optional (Enter to return): ');
          if (mode === '1' || mode === '2') { save('telemetrySetting', mode === '1' ? 'Required' : 'Optional'); io.writeLine('Telemetry setting saved (simulated).'); }
        } else if (item === '11') {
          io.writeLine('\n  1) Display license information\n  2) Activate Windows\n  3) Install product key');
          const mode = await read('Select an option (Enter to return): ');
          if (mode === '1') io.writeLine(`${s.edition}\nLicense status: ${s.activationStatus || 'Evaluation'} (simulated)`);
          else if (mode === '2') io.writeLine('Online activation is not available in the lab simulator.');
          else if (mode === '3') {
            const productKey = await read('Enter product key: ');
            if (/^([A-Z0-9]{5}-){4}[A-Z0-9]{5}$/i.test(productKey)) { save('productKey', productKey.toUpperCase()); io.writeLine('Product key saved (simulated).'); }
            else io.writeLine('The product key is invalid.');
          }
        } else if (['12', '13', '14'].includes(item)) {
          const action = { 12: 'Log off', 13: 'Restart', 14: 'Shut down' }[item];
          if (/^y(es)?$/i.test(await read(`${action}? (Y/N): `))) {
            io.session.exited = true;
            if (item === '12') { WS.wm.closeAll(); WS.shell.lock(); }
            else if (item === '13') WS.shell.restart();
            else WS.shell.shutdown();
            return 0;
          }
        } else io.writeLine('Invalid selection. Enter a number from 1 to 15.');
        if (io.session.exited) return 0;
        await read('Press Enter to continue: ');
      }
    } catch (e) {
      if (e instanceof WS.ps.PipelineStopped) return 0;
      throw e;
    }
  };
})();
