/* PowerShell cmdlets: networking (NetTCPIP, NetAdapter, DnsClient, NetConnection, NetSecurity, Test-Connection,
 * Test-NetConnection, Resolve-DnsName), local accounts, storage and SMB shares. CIM-based cmdlets report errors the
 * way CIM does ("No MSFT_x objects found...", "Windows System Error n"). */
(function () {
  'use strict';
  const WS = window.WS;
  const U = WS.util;
  const PS = WS.ps;
  const { psobj, toStr, toBool, toArray, getProp, cmdlet, view } = PS;
  const { wild, hasWild } = PS.helpers;
  const GB = 1024 ** 3;
  const sizeText = b => (b == null ? '' : b >= GB ? (b / GB).toFixed(2) + ' GB' : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(2) + ' MB' : b + ' B');

  /* ---------------- CIM-style errors ---------------- */
  function notFound(ctx, cls, prop, value) {
    ctx.error({ message: `No ${cls} objects found with property '${prop}' equal to '${value}'.  Verify the value of the property and retry.`, category: 'ObjectNotFound', target: value, targetType: 'String', exception: 'CimJobException', id: `CmdletizationQuery_NotFound_${prop},${ctx.name}` });
  }
  function cimError(ctx, message, o = {}) {
    const ns = o.ns || 'ROOT/StandardCimv2';
    const rec = { message, category: o.category || 'InvalidArgument', target: o.cls, targetType: `${ns}/${o.cls}`, exception: 'CimException', id: `Windows System Error ${o.code || 87},${ctx.name}` };
    if (o.terminating) ctx.throw(rec); else ctx.error(rec);
  }

  /* ================================================================ adapters and IP */
  function adaptersFor(ctx, p, cls = 'MSFT_NetAdapter') {
    const all = WS.net.adapters();
    if (p.InterfaceIndex != null) { const a = all.filter(x => toArray(p.InterfaceIndex).includes(x.ifIndex)); if (!a.length) notFound(ctx, cls, 'InterfaceIndex', p.InterfaceIndex); return a; }
    const names = p.InterfaceAlias || p.Name;
    if (names == null) return all;
    const out = [];
    for (const n of toArray(names)) {
      const hits = all.filter(a => wild(n, a.name));
      if (!hits.length) notFound(ctx, cls, p.InterfaceAlias ? 'InterfaceAlias' : 'Name', n);
      out.push(...hits);
    }
    return out;
  }
  const LOOP = { name: 'Loopback Pseudo-Interface 1', ifIndex: 1 };
  function ipObjs(a) {
    const out = [];
    const mk = (ip, fam, prefix, origin, state, alias, idx, store) => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetIPAddress', {
      IPAddress: ip, InterfaceIndex: idx, InterfaceAlias: alias, AddressFamily: fam, Type: 'Unicast', PrefixLength: prefix, PrefixOrigin: origin, SuffixOrigin: origin === 'Dhcp' ? 'Dhcp' : origin === 'WellKnown' ? (fam === 'IPv6' && ip.startsWith('fe80') ? 'Link' : 'WellKnown') : origin,
      AddressState: state, ValidLifetime: origin === 'Dhcp' ? '23:59:12' : 'Infinite ([TimeSpan]::MaxValue)', PreferredLifetime: origin === 'Dhcp' ? '23:59:12' : 'Infinite ([TimeSpan]::MaxValue)', SkipAsSource: false, PolicyStore: store || 'ActiveStore'
    }, { str: ip });
    if (a.enabled && WS.net.status(a) !== 'Disconnected') {
      if (WS.net.bound(a, 'ms_tcpip6')) out.push(mk(a.linkLocal6.replace(/%\d+$/, ''), 'IPv6', 64, 'WellKnown', 'Preferred', a.name, a.ifIndex));
      if (a.ip && a.ip !== '0.0.0.0' && WS.net.bound(a, 'ms_tcpip')) out.push(mk(a.ip, 'IPv4', a.prefix, /^169\.254/.test(a.ip) ? 'WellKnown' : a.dhcp ? 'Dhcp' : 'Manual', WS.net.status(a) === 'Duplicate' ? 'Duplicate' : 'Preferred', a.name, a.ifIndex));
    }
    return out;
  }
  const ipList = ['IPAddress', 'InterfaceIndex', 'InterfaceAlias', 'AddressFamily', 'Type', 'PrefixLength', 'PrefixOrigin', 'SuffixOrigin', 'AddressState', 'ValidLifetime', 'PreferredLifetime', 'SkipAsSource', 'PolicyStore'];
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetIPAddress', { list: ipList });
  cmdlet({ name: 'Get-NetIPAddress', module: 'NetTCPIP', synopsis: 'Gets the IP address configuration.',
    params: { IPAddress: { type: 'string[]', pos: 0 }, InterfaceAlias: { type: 'string[]', alias: ['ifAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] }, AddressFamily: { type: 'enum[]', values: ['IPv4', 'IPv6'], enumType: 'AddressFamily' }, PrefixOrigin: { type: 'string[]' } },
    process(ctx, p) {
      const loop = [
        psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetIPAddress', { IPAddress: '::1', InterfaceIndex: 1, InterfaceAlias: LOOP.name, AddressFamily: 'IPv6', Type: 'Unicast', PrefixLength: 128, PrefixOrigin: 'WellKnown', SuffixOrigin: 'WellKnown', AddressState: 'Preferred', ValidLifetime: 'Infinite ([TimeSpan]::MaxValue)', PreferredLifetime: 'Infinite ([TimeSpan]::MaxValue)', SkipAsSource: false, PolicyStore: 'ActiveStore' }, { str: '::1' }),
        psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetIPAddress', { IPAddress: '127.0.0.1', InterfaceIndex: 1, InterfaceAlias: LOOP.name, AddressFamily: 'IPv4', Type: 'Unicast', PrefixLength: 8, PrefixOrigin: 'WellKnown', SuffixOrigin: 'WellKnown', AddressState: 'Preferred', ValidLifetime: 'Infinite ([TimeSpan]::MaxValue)', PreferredLifetime: 'Infinite ([TimeSpan]::MaxValue)', SkipAsSource: false, PolicyStore: 'ActiveStore' }, { str: '127.0.0.1' })
      ];
      let all = [];
      const adapters = p.InterfaceAlias || p.InterfaceIndex ? adaptersFor(ctx, p, 'MSFT_NetIPAddress') : WS.net.adapters();
      for (const a of adapters) all.push(...ipObjs(a));
      if (!p.InterfaceAlias && !p.InterfaceIndex) all.push(...loop);
      if (p.InterfaceAlias && p.InterfaceAlias.some(n => wild(n, LOOP.name))) all.push(...loop);
      all.sort((x, y) => (x.AddressFamily === y.AddressFamily ? 0 : x.AddressFamily === 'IPv6' ? -1 : 1));
      if (p.AddressFamily) all = all.filter(x => p.AddressFamily.includes(x.AddressFamily));
      if (p.PrefixOrigin) all = all.filter(x => p.PrefixOrigin.some(o => wild(o, x.PrefixOrigin)));
      if (p.IPAddress) {
        for (const ip of p.IPAddress) { const hits = all.filter(x => wild(ip, x.IPAddress)); if (!hits.length && !hasWild(ip)) notFound(ctx, 'MSFT_NetIPAddress', 'IPAddress', ip); ctx.outMany(hits); }
        return;
      }
      ctx.outMany(all);
    } });
  cmdlet({ name: 'New-NetIPAddress', module: 'NetTCPIP', synopsis: 'Creates and configures an IP address.', shouldProcess: true,
    params: { IPAddress: { pos: 0, mandatory: true, alias: ['LocalAddress'] }, InterfaceAlias: { alias: ['ifAlias'], pipe: 'name' }, InterfaceIndex: { type: 'int', alias: ['ifIndex'], pipe: 'name' }, PrefixLength: { type: 'int', alias: ['Length'] }, DefaultGateway: {}, AddressFamily: { type: 'enum', values: ['IPv4', 'IPv6'], enumType: 'AddressFamily' }, Type: {}, PolicyStore: {}, SkipAsSource: { type: 'bool' }, ValidLifetime: {}, PreferredLifetime: {} },
    async process(ctx, p) {
      if (p.InterfaceAlias == null && p.InterfaceIndex == null) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,New-NetIPAddress' });
      const a = adaptersFor(ctx, p, 'MSFT_NetIPInterface')[0];
      if (!a) return;
      if (!U.isValidIp(p.IPAddress)) return cimError(ctx, `The parameter is incorrect.\n`, { cls: 'MSFT_NetIPAddress', code: 87 });
      if (!a.dhcp && a.ip === p.IPAddress) return cimError(ctx, 'Instance MSFT_NetIPAddress already exists', { cls: 'MSFT_NetIPAddress', code: 5010, category: 'ResourceExists' });
      if (!a.dhcp && a.gateway && p.DefaultGateway) return cimError(ctx, 'Instance DefaultGateway already exists', { cls: 'MSFT_NetRoute', code: 1, category: 'InvalidArgument' });
      if (!(await ctx.confirm('New', `NetIPAddress -IPv4Address ${p.IPAddress} -PrefixLength ${p.PrefixLength || 24} -InterfaceIndex ${a.ifIndex}`))) return;
      const r = WS.net.setStatic(a.name, { ip: p.IPAddress, prefix: p.PrefixLength || 24, gateway: p.DefaultGateway || (a.dhcp ? null : a.gateway) });
      if (!r.ok) return cimError(ctx, r.error, { cls: 'MSFT_NetIPAddress', code: 87 });
      const objs = ipObjs(WS.net.adapter(a.name)).filter(x => x.AddressFamily === 'IPv4');
      for (const store of ['ActiveStore', 'PersistentStore']) for (const o of objs) ctx.out(psobj(PS.typeName(o), { ...o, PolicyStore: store }, { str: o.IPAddress }));
    } });
  cmdlet({ name: 'Remove-NetIPAddress', module: 'NetTCPIP', shouldProcess: true, impact: 'High', synopsis: 'Removes an IP address and its configuration.',
    params: { IPAddress: { type: 'string[]', pos: 0, pipe: 'name' }, InterfaceAlias: { type: 'string[]', alias: ['ifAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] }, AddressFamily: {}, PrefixLength: { type: 'int' }, DefaultGateway: {}, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      const adapters = p.InterfaceAlias || p.InterfaceIndex ? adaptersFor(ctx, p, 'MSFT_NetIPAddress') : WS.net.adapters();
      for (const a of adapters) {
        if (!a.ip || (p.IPAddress && !p.IPAddress.includes(a.ip))) { if (p.IPAddress) notFound(ctx, 'MSFT_NetIPAddress', 'IPAddress', p.IPAddress.join(',')); continue; }
        if (p.AddressFamily && /6/.test(p.AddressFamily)) continue;
        if (!(await ctx.confirm('Delete', `NetIPAddress -IPv4Address ${a.ip} -InterfaceIndex ${a.ifIndex} -Store Active`, { impact: 'High' }))) continue;
        a.ip = null; if (p.DefaultGateway) a.gateway = null;
        WS.store.changed('network');
      }
    } });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetIPInterface', { table: { columns: [
    { label: 'ifIndex', width: 7, align: 'right', value: 'ifIndex' }, { label: 'InterfaceAlias', width: 31, value: 'InterfaceAlias' }, { label: 'AddressFamily', width: 13, value: 'AddressFamily' },
    { label: 'NlMtu(Bytes)', width: 12, align: 'right', value: 'NlMtu' }, { label: 'InterfaceMetric', width: 15, align: 'right', value: 'InterfaceMetric' }, { label: 'Dhcp', width: 8, value: 'Dhcp' },
    { label: 'ConnectionState', width: 15, value: 'ConnectionState' }, { label: 'PolicyStore', value: 'PolicyStore' }] } });
  cmdlet({ name: 'Get-NetIPInterface', module: 'NetTCPIP', params: { InterfaceAlias: { type: 'string[]', pos: 0, alias: ['ifAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] }, AddressFamily: { type: 'enum', values: ['IPv4', 'IPv6'] } },
    process(ctx, p) {
      const rows = [];
      for (const a of adaptersFor(ctx, p, 'MSFT_NetIPInterface')) for (const fam of ['IPv6', 'IPv4']) rows.push({ ifIndex: a.ifIndex, InterfaceAlias: a.name, AddressFamily: fam, NlMtu: 1500, InterfaceMetric: 15, Dhcp: fam === 'IPv4' && a.dhcp ? 'Enabled' : fam === 'IPv6' ? 'Enabled' : 'Disabled', ConnectionState: WS.net.status(a) === 'Up' ? 'Connected' : 'Disconnected', PolicyStore: 'ActiveStore' });
      if (!p.InterfaceAlias && !p.InterfaceIndex) for (const fam of ['IPv6', 'IPv4']) rows.push({ ifIndex: 1, InterfaceAlias: LOOP.name, AddressFamily: fam, NlMtu: 4294967295, InterfaceMetric: 75, Dhcp: 'Disabled', ConnectionState: 'Connected', PolicyStore: 'ActiveStore' });
      for (const r of rows) if (!p.AddressFamily || p.AddressFamily === r.AddressFamily) ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetIPInterface', r));
    } });
  cmdlet({ name: 'Set-NetIPInterface', module: 'NetTCPIP', shouldProcess: true, params: { InterfaceAlias: { type: 'string[]', pos: 0, alias: ['ifAlias'], pipe: 'name' }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'], pipe: 'name' }, AddressFamily: {}, Dhcp: { type: 'enum', values: ['Enabled', 'Disabled'], enumType: 'Dhcp' }, InterfaceMetric: { type: 'int' }, NlMtuBytes: { type: 'int' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      for (const a of adaptersFor(ctx, p, 'MSFT_NetIPInterface')) {
        if (!(await ctx.confirm('Set', `NetIPInterface -InterfaceIndex ${a.ifIndex} -Store Active`))) continue;
        if (p.Dhcp === 'Enabled') WS.net.setDhcp(a.name);
        if (p.Dhcp === 'Disabled' && a.dhcp) { if (a.ip && !/^169\.254/.test(a.ip)) WS.net.setStatic(a.name, { ip: a.ip, prefix: a.prefix, gateway: a.gateway }); else { a.dhcp = false; WS.store.changed('network'); } }
      }
    } });
  view('NetIPConfiguration', { list: ['InterfaceAlias', 'InterfaceIndex', 'InterfaceDescription', 'NetProfile.Name', 'IPv4Address', 'IPv6DefaultGateway', 'IPv4DefaultGateway', 'DNSServer'] });
  cmdlet({ name: 'Get-NetIPConfiguration', module: 'NetTCPIP', synopsis: 'Gets IP network configuration.', aliases: ['gip'],
    params: { InterfaceAlias: { pos: 0, alias: ['ifAlias'] }, InterfaceIndex: { type: 'int', alias: ['ifIndex'] }, Detailed: { type: 'switch' }, All: { type: 'switch' } },
    process(ctx, p) {
      for (const a of adaptersFor(ctx, p, 'MSFT_NetIPInterface')) {
        if (!a.enabled) continue;
        const o = {
          InterfaceAlias: a.name, InterfaceIndex: a.ifIndex, InterfaceDescription: a.description, 'NetProfile.Name': WS.sys.isDC() ? WS.state.system.domain : 'Network',
          IPv4Address: a.ip || '', IPv6DefaultGateway: '', IPv4DefaultGateway: a.gateway || '', DNSServer: (a.dnsServers.length ? a.dnsServers : ['fec0:0:0:ffff::1', 'fec0:0:0:ffff::2', 'fec0:0:0:ffff::3']).join('\n')
        };
        if (p.Detailed) Object.assign(o, { ComputerName: WS.sys.name, 'NetAdapter.LinkLayerAddress': a.mac, 'NetAdapter.Status': WS.net.status(a), 'NetProfile.NetworkCategory': WS.fw.activeProfile() === 'Domain' ? 'DomainAuthenticated' : WS.fw.activeProfile(), 'NetIPv4Interface.DHCP': a.dhcp ? 'Enabled' : 'Disabled' });
        ctx.out(psobj('NetIPConfiguration', o));
      }
    } });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetAdapter', { table: { columns: [
    { label: 'Name', width: 25, value: 'Name' }, { label: 'InterfaceDescription', width: 39, value: 'InterfaceDescription' }, { label: 'ifIndex', width: 7, align: 'right', value: 'ifIndex' },
    { label: 'Status', width: 12, value: 'Status' }, { label: 'MacAddress', width: 21, value: 'MacAddress' }, { label: 'LinkSpeed', align: 'right', value: 'LinkSpeed' }] } });
  const adapterObj = a => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetAdapter', { Name: a.name, InterfaceDescription: a.description, ifIndex: a.ifIndex, Status: a.enabled ? (WS.net.status(a) === 'Disconnected' ? 'Disconnected' : 'Up') : 'Disabled', MacAddress: a.mac, LinkSpeed: a.enabled ? a.linkSpeed : '0 bps', MediaConnectionState: a.connected ? 'Connected' : 'Disconnected', AdminStatus: a.enabled ? 'Up' : 'Down', InterfaceAlias: a.name, InterfaceIndex: a.ifIndex, DriverDescription: a.description }, { str: a.name });
  cmdlet({ name: 'Get-NetAdapter', module: 'NetAdapter', version: '2.0.0.0', synopsis: 'Gets the basic network adapter properties.', params: { Name: { type: 'string[]', pos: 0, alias: ['ifAlias', 'InterfaceAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] }, Physical: { type: 'switch' } },
    process(ctx, p) { adaptersFor(ctx, p).forEach(a => ctx.out(adapterObj(a))); } });
  const adapterSet = (name, fn, verb) => cmdlet({ name, module: 'NetAdapter', version: '2.0.0.0', shouldProcess: true, impact: verb === 'Disable' ? 'High' : 'Medium', params: { Name: { type: 'string[]', pos: 0, pipe: 'name', alias: ['ifAlias', 'InterfaceAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] }, NewName: { pos: 1 }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      for (const a of adaptersFor(ctx, p)) {
        if (!(await ctx.confirm(verb, `${verb}-NetAdapter '${a.name}'`, { impact: verb === 'Disable' ? 'High' : 'Medium' }))) continue;
        const r = fn(a, p);
        if (r && !r.ok) cimError(ctx, r.error, { cls: 'MSFT_NetAdapter', code: 183 });
        else if (p.PassThru) ctx.out(adapterObj(WS.net.adapter(p.NewName || a.name)));
      }
    } });
  adapterSet('Rename-NetAdapter', (a, p) => WS.net.rename(a.name, p.NewName), 'Rename');
  adapterSet('Disable-NetAdapter', a => WS.net.setEnabled(a.name, false), 'Disable');
  adapterSet('Enable-NetAdapter', a => WS.net.setEnabled(a.name, true), 'Enable');
  adapterSet('Restart-NetAdapter', a => { WS.net.setEnabled(a.name, true); if (a.dhcp) WS.net.renew(a.name); return { ok: true }; }, 'Restart');

  /* bindings: Ethernet Properties > "This connection uses the following items" */
  const bindingObj = (a, b) => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetAdapterBindingSettingData', { Name: a.name, DisplayName: b.name, ComponentID: b.id, Enabled: b.enabled }, { str: b.id });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetAdapterBindingSettingData', { table: { columns: [
    { label: 'Name', width: 23, value: 'Name' }, { label: 'DisplayName', width: 48, value: 'DisplayName' }, { label: 'ComponentID', width: 12, value: 'ComponentID' }, { label: 'Enabled', value: o => (o.Enabled ? 'True' : 'False') }] } });
  const bindingSel = { Name: { type: 'string[]', pos: 0, alias: ['ifAlias', 'InterfaceAlias'] }, ComponentID: { type: 'string[]' }, DisplayName: { type: 'string[]' }, AllBindings: { type: 'switch' }, PassThru: { type: 'switch' } };
  function bindingsFor(ctx, p) {
    const out = [];
    for (const a of adaptersFor(ctx, p)) for (const b of WS.net.bindings(a.name)) {
      if (p.ComponentID && !p.ComponentID.some(x => wild(x, b.id))) continue;
      if (p.DisplayName && !p.DisplayName.some(x => wild(x, b.name))) continue;
      out.push({ a, b });
    }
    if ((p.ComponentID || p.DisplayName) && !out.length) notFound(ctx, 'MSFT_NetAdapterBindingSettingData', p.ComponentID ? 'ComponentID' : 'DisplayName', (p.ComponentID || p.DisplayName)[0]);
    return out;
  }
  cmdlet({ name: 'Get-NetAdapterBinding', module: 'NetAdapter', version: '2.0.0.0', synopsis: 'Gets a list of bindings for a network adapter.', params: bindingSel,
    process(ctx, p) { bindingsFor(ctx, p).forEach(({ a, b }) => ctx.out(bindingObj(a, b))); } });
  for (const [verb, on] of [['Enable', true], ['Disable', false]]) cmdlet({ name: `${verb}-NetAdapterBinding`, module: 'NetAdapter', version: '2.0.0.0', shouldProcess: true, params: bindingSel,
    async process(ctx, p) {
      for (const { a, b } of bindingsFor(ctx, p)) {
        if (!(await ctx.confirm(verb, `${b.name} on ${a.name}`))) continue;
        const r = WS.net.setBinding(a.name, b.id, on);
        if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_NetAdapterBindingSettingData', code: 87 });
        else if (p.PassThru) ctx.out(bindingObj(a, WS.net.bindings(a.name).find(x => x.id === b.id)));
      }
    } });

  /* per-connection DNS client settings (Advanced TCP/IP Settings > DNS) */
  const dnsClientObj = a => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_DNSClient', { InterfaceAlias: a.name, InterfaceIndex: a.ifIndex, ConnectionSpecificSuffix: a.dnsSuffix || '', ConnectionSpecificSuffixSearchList: [], RegisterThisConnectionsAddress: a.registerDns !== false, UseSuffixWhenRegistering: false }, { str: a.name });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_DNSClient', { table: { columns: [
    { label: 'InterfaceAlias', width: 28, value: 'InterfaceAlias' }, { label: 'Interface\nIndex', width: 9, align: 'right', value: 'InterfaceIndex' }, { label: 'ConnectionSpecificSuffix', width: 24, value: 'ConnectionSpecificSuffix' },
    { label: 'ConnectionSpecificSuffix\nSearchList', width: 24, value: () => '{}' }, { label: 'RegisterThis\nConn.sAddress', width: 13, value: o => (o.RegisterThisConnectionsAddress ? 'True' : 'False') }, { label: 'UseSuffixWhen\nRegistering', value: o => (o.UseSuffixWhenRegistering ? 'True' : 'False') }] } });
  const dnsClientSel = { InterfaceAlias: { type: 'string[]', pos: 0, alias: ['ifAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] } };
  const dnsClientAdapters = (ctx, p) => adaptersFor(ctx, { Name: p.InterfaceAlias || (p.InterfaceIndex ? p.InterfaceIndex.map(i => (WS.net.adapter(i) || {}).name || String(i)) : null) });
  cmdlet({ name: 'Get-DnsClient', module: 'DnsClient', params: dnsClientSel, process(ctx, p) { dnsClientAdapters(ctx, p).forEach(a => ctx.out(dnsClientObj(a))); } });
  cmdlet({ name: 'Set-DnsClient', module: 'DnsClient', shouldProcess: true, params: { ...dnsClientSel, ConnectionSpecificSuffix: {}, RegisterThisConnectionsAddress: { type: 'bool' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      for (const a of dnsClientAdapters(ctx, p)) {
        if (!(await ctx.confirm('Set', a.name))) continue;
        const r = WS.net.setDnsClient(a.name, { ...(p.ConnectionSpecificSuffix != null ? { suffix: p.ConnectionSpecificSuffix } : {}), ...(p.RegisterThisConnectionsAddress != null ? { register: p.RegisterThisConnectionsAddress } : {}) });
        if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_DNSClient', code: 87 });
        else if (p.PassThru) ctx.out(dnsClientObj(a));
      }
    } });

  /* ================================================================ DNS client */
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_DNSClientServerAddress', { table: { columns: [
    { label: 'InterfaceAlias', width: 28, value: 'InterfaceAlias' }, { label: 'Interface\nIndex', width: 9, align: 'right', value: 'InterfaceIndex' },
    { label: 'Address\nFamily', width: 7, value: o => (o.AddressFamily === 2 ? 'IPv4' : 'IPv6') }, { label: 'ServerAddresses', value: 'ServerAddresses' }] } });
  cmdlet({ name: 'Get-DnsClientServerAddress', module: 'DnsClient', synopsis: 'Gets DNS server IP addresses from the TCP/IP properties on an interface.', params: { InterfaceAlias: { type: 'string[]', pos: 0, alias: ['ifAlias'] }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'] }, AddressFamily: { type: 'enum[]', values: ['IPv4', 'IPv6'] } },
    process(ctx, p) {
      const mk = (alias, idx, fam, servers) => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_DNSClientServerAddress', { InterfaceAlias: alias, InterfaceIndex: idx, AddressFamily: fam === 'IPv4' ? 2 : 23, ServerAddresses: servers });
      const rows = [];
      for (const a of adaptersFor(ctx, p, 'MSFT_DNSClientServerAddress')) { rows.push(mk(a.name, a.ifIndex, 'IPv4', a.dnsServers.slice()), mk(a.name, a.ifIndex, 'IPv6', [])); }
      if (!p.InterfaceAlias && !p.InterfaceIndex) rows.push(mk(LOOP.name, 1, 'IPv4', []), mk(LOOP.name, 1, 'IPv6', ['fec0:0:0:ffff::1', 'fec0:0:0:ffff::2', 'fec0:0:0:ffff::3']));
      ctx.outMany(rows.filter(r => !p.AddressFamily || p.AddressFamily.includes(r.AddressFamily === 2 ? 'IPv4' : 'IPv6')));
    } });
  cmdlet({ name: 'Set-DnsClientServerAddress', module: 'DnsClient', shouldProcess: true, synopsis: 'Sets DNS server addresses associated with the TCP/IP properties on an interface.',
    params: { InterfaceAlias: { type: 'string[]', pos: 0, alias: ['ifAlias'], pipe: 'name' }, InterfaceIndex: { type: 'int[]', alias: ['ifIndex'], pipe: 'name' }, ServerAddresses: { type: 'string[]', alias: ['Addresses'] }, ResetServerAddresses: { type: 'switch' }, Validate: { type: 'switch' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      if (!p.ServerAddresses && !p.ResetServerAddresses) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,Set-DnsClientServerAddress' });
      for (const a of adaptersFor(ctx, p, 'MSFT_DNSClientServerAddress')) {
        if (!(await ctx.confirm('Set', `DNSClientServerAddress ${a.name}`))) continue;
        const bad = (p.ServerAddresses || []).find(x => !U.isValidIp(x));
        if (bad) { cimError(ctx, `The parameter is incorrect.`, { cls: 'MSFT_DNSClientServerAddress', code: 87 }); continue; }
        const r = WS.net.setDnsServers(a.name, p.ResetServerAddresses ? null : p.ServerAddresses);
        if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_DNSClientServerAddress', code: 87 });
      }
    } });
  cmdlet({ name: 'Clear-DnsClientCache', module: 'DnsClient', process() {} });
  cmdlet({ name: 'Register-DnsClient', module: 'DnsClient', process() {} });
  cmdlet({ name: 'Get-DnsClientCache', module: 'DnsClient', process() {} });
  const dnsRecView = cols => ({ table: { columns: [{ label: 'Name', width: 46, value: 'Name' }, { label: 'Type', width: 5, value: 'Type' }, { label: 'TTL', width: 5, align: 'right', value: 'TTL' }, { label: 'Section', width: 10, value: 'Section' }, ...cols] } });
  view('Microsoft.DnsClient.Commands.DnsRecord_A', dnsRecView([{ label: 'IPAddress', value: 'IPAddress' }]));
  view('Microsoft.DnsClient.Commands.DnsRecord_PTR', dnsRecView([{ label: 'NameHost', value: 'NameHost' }]));
  view('Microsoft.DnsClient.Commands.DnsRecord_CNAME', dnsRecView([{ label: 'NameHost', value: 'NameHost' }]));
  view('Microsoft.DnsClient.Commands.DnsRecord_NS', dnsRecView([{ label: 'NameHost', value: 'NameHost' }]));
  view('Microsoft.DnsClient.Commands.DnsRecord_MX', dnsRecView([{ label: 'NameExchange', value: 'NameExchange' }, { label: 'Preference', value: 'Preference' }]));
  view('Microsoft.DnsClient.Commands.DnsRecord_SRV', dnsRecView([{ label: 'NameTarget', value: 'NameTarget' }, { label: 'Priority', value: 'Priority' }, { label: 'Weight', value: 'Weight' }, { label: 'Port', value: 'Port' }]));
  view('Microsoft.DnsClient.Commands.DnsRecord_SOA', { list: ['Name', 'Type', 'TTL', 'Section', 'PrimaryServer', 'NameAdministrator', 'SerialNumber'] });
  cmdlet({ name: 'Resolve-DnsName', module: 'DnsClient', synopsis: 'Performs a DNS name query resolution for the specified name.',
    params: { Name: { pos: 0, mandatory: true, pipe: 'both' }, Type: { pos: 1, type: 'enum', values: ['A', 'AAAA', 'ANY', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT', 'A_AAAA'] }, Server: { type: 'string[]' }, DnsOnly: { type: 'switch' }, NoHostsFile: { type: 'switch' } },
    process(ctx, p) {
      let type = p.Type || 'A_AAAA';
      let name = p.Name.replace(/\.$/, '');
      if (U.isValidIp(name)) { name = name.split('.').reverse().join('.') + '.in-addr.arpa'; type = 'PTR'; }
      const fail = (msg, code) => ctx.error({ message: `${p.Name} : ${msg}`, category: msg === 'DNS name does not exist' ? 'ResourceUnavailable' : 'OperationTimeout', target: p.Name, exception: 'Win32Exception', id: `${code},Microsoft.DnsClient.Commands.ResolveDnsName` });
      if ((type === 'A' || type === 'A_AAAA') && !p.Server && !p.DnsOnly) {
        const r = WS.net.resolve(name);
        if (!r.ok) return fail(r.error === 'timeout' ? 'This operation returned because the timeout period expired' : 'DNS name does not exist', r.error === 'timeout' ? 'ERROR_TIMEOUT' : 'DNS_ERROR_RCODE_NAME_ERROR');
        for (const al of r.aliases || []) ctx.out(psobj('Microsoft.DnsClient.Commands.DnsRecord_CNAME', { Name: al, Type: 'CNAME', TTL: 3600, Section: 'Answer', NameHost: r.name }));
        for (const ip of r.addresses) ctx.out(psobj('Microsoft.DnsClient.Commands.DnsRecord_A', { Name: r.name, Type: 'A', TTL: r.source === 'dns' ? 1200 : 0, Section: 'Answer', IPAddress: ip, IP4Address: ip }));
        return;
      }
      const server = p.Server ? p.Server[0] : WS.net.dnsServers()[0];
      if (!server) return fail('This operation returned because the timeout period expired', 'ERROR_TIMEOUT');
      const suffixes = [WS.state.system.domain].filter(Boolean);
      const cands = name.includes('.') ? [name] : [...suffixes.map(s => name + '.' + s), name];
      let r = null;
      for (const c of cands) { r = WS.net.queryServer(U.isValidIp(server) ? server : (WS.net.resolve(server).ip || server), c, type === 'A_AAAA' ? 'A' : type); if (r.status !== 'nxdomain') break; }
      if (r.status === 'timeout') return fail('This operation returned because the timeout period expired', 'ERROR_TIMEOUT');
      if (r.status === 'nxdomain' || !r.records.length) return fail('DNS name does not exist', 'DNS_ERROR_RCODE_NAME_ERROR');
      for (const rec of r.records) {
        const d = typeof rec.data === 'string' ? rec.data.replace(/\.$/, '') : rec.data;
        const base = { Name: rec.name.replace(/\.$/, ''), Type: rec.type, TTL: rec.ttl || 3600, Section: 'Answer' };
        const extra = { A: { IPAddress: d }, PTR: { NameHost: d }, CNAME: { NameHost: d }, NS: { NameHost: d }, MX: { NameExchange: d, Preference: rec.preference }, SRV: { NameTarget: d, Priority: rec.priority, Weight: rec.weight, Port: rec.port }, SOA: rec.type === 'SOA' ? { PrimaryServer: d.primary.replace(/\.$/, ''), NameAdministrator: d.responsible.replace(/\.$/, ''), SerialNumber: d.serial || 1 } : {}, TXT: { Strings: [d] } }[rec.type] || {};
        ctx.out(psobj('Microsoft.DnsClient.Commands.DnsRecord_' + rec.type, { ...base, ...extra }));
      }
    } });

  /* ================================================================ connectivity tests */
  view('System.Management.ManagementObject#root\\cimv2\\Win32_PingStatus', { table: { columns: [{ label: 'Source', width: 13, value: 'PSComputerName' }, { label: 'Destination', width: 15, value: 'Address' }, { label: 'IPV4Address', width: 16, value: 'IPV4Address' }, { label: 'IPV6Address', width: 40, value: 'IPV6Address' }, { label: 'Bytes', width: 8, value: 'BufferSize' }, { label: 'Time(ms)', value: 'ResponseTime' }] } });
  cmdlet({ name: 'Test-Connection', module: 'Microsoft.PowerShell.Management', synopsis: 'Sends ICMP echo request packets, or pings, to one or more computers.',
    params: { ComputerName: { type: 'string[]', pos: 0, mandatory: true, alias: ['CN', 'IPAddress', '__SERVER', 'Server', 'Destination'], pipe: 'both' }, Count: { type: 'int' }, Quiet: { type: 'switch' }, BufferSize: { type: 'int', alias: ['Size', 'Bytes', 'BS'] }, Delay: { type: 'int' }, Source: { type: 'string[]' } },
    async process(ctx, p) {
      for (const target of p.ComputerName) {
        const first = WS.net.ping(target, 1);
        if (first.error) {
          if (p.Quiet) { ctx.out(false); continue; }
          ctx.error({ message: `Testing connection to computer '${target}' failed: No such host is known`, category: 'ResourceUnavailable', target, targetType: 'String', exception: 'PingException', id: 'TestConnectionException,Microsoft.PowerShell.Commands.TestConnectionCommand' });
          continue;
        }
        let okCount = 0;
        for (let i = 0; i < (p.Count || 4); i++) {
          if (i) await ctx.sleep(Math.min(5000, (p.Delay || 1) * 1000));
          const r = WS.net.ping(first.ip, 1).lines[0];
          if (r.ok) {
            okCount++;
            if (!p.Quiet) ctx.out(psobj('System.Management.ManagementObject#root\\cimv2\\Win32_PingStatus', { PSComputerName: WS.sys.name, Address: target, IPV4Address: first.ip, IPV6Address: '', BufferSize: p.BufferSize || 32, ResponseTime: r.time, StatusCode: 0 }));
          }
        }
        if (p.Quiet) ctx.out(okCount > 0);
        else if (!okCount) ctx.error({ message: `Testing connection to computer '${target}' failed: Error due to lack of resources`, category: 'ResourceUnavailable', target, targetType: 'String', exception: 'PingException', id: 'TestConnectionException,Microsoft.PowerShell.Commands.TestConnectionCommand' });
      }
    } });
  const PORT_SVC = { 80: 'W3SVC', 443: 'W3SVC', 3389: 'TermService', 445: 'LanmanServer', 139: 'LanmanServer', 53: 'DNS', 389: 'NTDS', 636: 'NTDS', 3268: 'NTDS', 88: 'Kdc', 5985: 'WinRM', 135: 'RpcSs', 9389: 'ADWS' };
  const COMMON_PORTS = { HTTP: 80, RDP: 3389, SMB: 445, WINRM: 5985 };
  function tcpTest(ip, port) {
    const route = WS.net.route(ip);
    if (route === 'local') {
      if (WS.iis && WS.iis.listening(port, ip)) return true; // any started IIS site's binding (80, 443, 8080...)
      if (port === 80 || port === 443) return false;
      const svc = PORT_SVC[port];
      if (port === 3389 && !WS.state.system.rdpEnabled) return false;
      return !!svc && WS.svc.isRunning(svc);
    }
    if (route === 'direct') { const peer = WS.state.network.peers.find(x => x.ip === ip); if (!peer) return false; // the router answers DNS and its web admin page; the client PC firewall blocks everything inbound
      return peer.name === 'ROUTER' && [53, 80, 443].includes(port); }
    if (route === 'routed') { const h = WS.net.INTERNET.find(x => x.ip === ip); return !!h && WS.state.network.lan.internet && ([80, 443].includes(port) || (h.dns && port === 53)); }
    return false;
  }
  view('TestNetConnectionResult', { custom: items => items.flatMap(o => { const keys = Object.keys(o); const w = Math.max(...keys.map(k => k.length)); return ['', ...keys.map(k => `${k.padEnd(w)} : ${PS.cell(o[k])}`.replace(/\s+$/, '')), '']; }).concat(['']) });
  cmdlet({ name: 'Test-NetConnection', module: 'NetTCPIP', synopsis: 'Displays diagnostic information for a connection.', aliases: ['TNC'],
    params: { ComputerName: { pos: 0, alias: ['RemoteAddress', 'cn'] }, Port: { type: 'int', alias: ['RemotePort'] }, CommonTCPPort: { type: 'enum', values: ['HTTP', 'RDP', 'SMB', 'WINRM'] }, InformationLevel: { type: 'enum', values: ['Quiet', 'Detailed'] }, TraceRoute: { type: 'switch' } },
    async process(ctx, p) {
      const target = p.ComputerName || 'internetbeacon.msedge.net';
      const port = p.Port || (p.CommonTCPPort ? COMMON_PORTS[p.CommonTCPPort] : null);
      ctx.progress({ activity: `Test-NetConnection - ${target}`, status: port ? 'Attempting TCP connect' : 'Ping/ICMP test', percent: 40 });
      await ctx.sleep(600);
      const a = WS.net.adapter();
      const r = WS.net.resolve(target);
      if (!r.ok) {
        ctx.warn(`Name resolution of ${target} failed`);
        if (p.InformationLevel === 'Quiet') { ctx.out(false); return; }
        ctx.out(psobj('TestNetConnectionResult', { ComputerName: target, RemoteAddress: '', InterfaceAlias: '', SourceAddress: '', PingSucceeded: false }));
        return;
      }
      const o = { ComputerName: target, RemoteAddress: r.ip };
      if (port) {
        const ok = tcpTest(r.ip, port);
        if (!ok) { const ping = WS.net.ping(r.ip, 1); ctx.warn(`TCP connect to (${r.ip} : ${port}) failed`); if (!ping.ok) ctx.warn(`Ping to ${r.ip} failed with status: TimedOut`); }
        if (p.InformationLevel === 'Quiet') { ctx.out(ok); return; }
        Object.assign(o, { RemotePort: port, InterfaceAlias: a.name, SourceAddress: a.ip, TcpTestSucceeded: ok });
      } else {
        const ping = WS.net.ping(r.ip, 1);
        if (!ping.ok) ctx.warn(`Ping to ${target} failed with status: ${/unreachable|General/.test(ping.lines[0].text) ? 'DestinationHostUnreachable' : 'TimedOut'}`);
        if (p.InformationLevel === 'Quiet') { ctx.out(ping.ok); return; }
        Object.assign(o, { InterfaceAlias: a.name, SourceAddress: a.ip, PingSucceeded: ping.ok, 'PingReplyDetails (RTT)': ping.ok ? `${ping.lines[0].time} ms` : '0 ms' });
        if (p.TraceRoute) o.TraceRoute = [WS.net.route(r.ip) === 'routed' ? a.gateway : null, r.ip].filter(Boolean).join('\n');
      }
      ctx.out(psobj('TestNetConnectionResult', o));
    } });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetConnectionProfile', { list: ['Name', 'InterfaceAlias', 'InterfaceIndex', 'NetworkCategory', 'DomainAuthenticationKind', 'IPv4Connectivity', 'IPv6Connectivity'] });
  const profileObj = () => { const a = WS.net.adapter(); const cat = WS.sys.isDC() ? 'DomainAuthenticated' : WS.state.firewall.networkCategory; return psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/StandardCimv2/MSFT_NetConnectionProfile', { Name: WS.sys.isDC() ? WS.state.system.domain : 'Network', InterfaceAlias: a.name, InterfaceIndex: a.ifIndex, NetworkCategory: cat, DomainAuthenticationKind: WS.sys.isDC() ? 'Ldap' : 'None', IPv4Connectivity: WS.net.ping('8.8.8.8', 1).ok ? 'Internet' : a.ip && !/^169/.test(a.ip) ? 'LocalNetwork' : 'NoTraffic', IPv6Connectivity: 'NoTraffic' }); };
  cmdlet({ name: 'Get-NetConnectionProfile', module: 'NetConnection', params: { InterfaceAlias: { alias: ['ifAlias'] }, InterfaceIndex: { type: 'int', alias: ['ifIndex'] }, NetworkCategory: {} }, process(ctx) { ctx.out(profileObj()); } });
  cmdlet({ name: 'Set-NetConnectionProfile', module: 'NetConnection', shouldProcess: true, params: { InterfaceAlias: { alias: ['ifAlias'], pipe: 'name' }, InterfaceIndex: { type: 'int', alias: ['ifIndex'], pipe: 'name' }, Name: {}, NetworkCategory: { type: 'enum', values: ['Public', 'Private', 'DomainAuthenticated'], enumType: 'NetworkCategory' }, PassThru: { type: 'switch' } },
    async process(ctx, p) {
      if (!p.NetworkCategory) return;
      if (!(await ctx.confirm('Set', 'MSFT_NetConnectionProfile'))) return;
      if (p.NetworkCategory === 'DomainAuthenticated') return cimError(ctx, "Unable to set NetworkCategory to 'DomainAuthenticated'. This NetworkCategory type will be set automatically when authenticated to a domain network.", { cls: 'MSFT_NetConnectionProfile', code: 87 });
      const r = WS.fw.setNetworkCategory(p.NetworkCategory);
      if (!r.ok) cimError(ctx, r.error + ' 2) The user does not have permissions to change this setting.', { cls: 'MSFT_NetConnectionProfile', code: 5 });
    } });

  /* ================================================================ firewall */
  const ruleObj = r => psobj('Microsoft.Management.Infrastructure.CimInstance#root/StandardCimv2/MSFT_NetFirewallRule', {
    Name: r.name, DisplayName: r.displayName, Description: r.description || '', DisplayGroup: r.group || '', Group: r.group ? '@FirewallAPI.dll,-' + (U.hashStr(r.group) % 40000) : '', Enabled: r.enabled ? 'True' : 'False',
    Profile: r.profile, Platform: [], Direction: r.direction, Action: r.action, EdgeTraversalPolicy: 'Block', LooseSourceMapping: false, LocalOnlyMapping: false, Owner: '', PrimaryStatus: 'OK',
    Status: 'The rule was parsed successfully from the store. (65536)', EnforcementStatus: 'NotApplicable', PolicyStoreSource: 'PersistentStore', PolicyStoreSourceType: 'Local', RemoteDynamicKeywordAddresses: []
  }, { str: r.name, hidden: { __rule: r } });
  view('Microsoft.Management.Infrastructure.CimInstance#root/StandardCimv2/MSFT_NetFirewallRule', { list: ['Name', 'DisplayName', 'Description', 'DisplayGroup', 'Group', 'Enabled', 'Profile', 'Platform', 'Direction', 'Action', 'EdgeTraversalPolicy', 'LooseSourceMapping', 'LocalOnlyMapping', 'Owner', 'PrimaryStatus', 'Status', 'EnforcementStatus', 'PolicyStoreSource', 'PolicyStoreSourceType', 'RemoteDynamicKeywordAddresses'] });
  function findRules(ctx, p) {
    let rules = WS.fw.rules();
    if (p.InputObject) return toArray(p.InputObject).map(o => (o.__hidden && o.__hidden.__rule) || WS.fw.find(getProp(o, 'Name'))[0]).filter(Boolean);
    if (p.Name) { const out = []; for (const n of p.Name) { const hits = rules.filter(r => wild(n, r.name)); if (!hits.length && !hasWild(n)) notFound(ctx, 'MSFT_NetFirewallRule', 'Name', n); out.push(...hits); } rules = out; }
    if (p.DisplayName) { const out = []; for (const n of p.DisplayName) { const hits = rules.filter(r => wild(n, r.displayName)); if (!hits.length && !hasWild(n)) notFound(ctx, 'MSFT_NetFirewallRule', 'DisplayName', n); out.push(...hits); } rules = out; }
    if (p.DisplayGroup) { const out = []; for (const n of p.DisplayGroup) { const hits = rules.filter(r => wild(n, r.group)); if (!hits.length && !hasWild(n)) notFound(ctx, 'MSFT_NetFirewallRule', 'DisplayGroup', n); out.push(...hits); } rules = out; }
    if (p.Enabled) rules = rules.filter(r => String(r.enabled) === String(p.Enabled).toLowerCase());
    if (p.Direction) rules = rules.filter(r => r.direction === p.Direction);
    if (p.Action) rules = rules.filter(r => r.action === p.Action);
    return rules;
  }
  const ruleSel = { Name: { type: 'string[]', pos: 0, alias: ['ID'], pipe: 'name' }, DisplayName: { type: 'string[]' }, DisplayGroup: { type: 'string[]' }, InputObject: { type: 'object[]', pipe: 'value', accepts: v => /MSFT_NetFirewallRule/.test(PS.typeName(v)) }, PassThru: { type: 'switch' } };
  cmdlet({ name: 'Get-NetFirewallRule', module: 'NetSecurity', version: '2.0.0.0', synopsis: 'Retrieves firewall rules from the target computer.',
    params: { ...ruleSel, Enabled: { type: 'enum', values: ['True', 'False'] }, Direction: { type: 'enum', values: ['Inbound', 'Outbound'] }, Action: { type: 'enum', values: ['Allow', 'Block'] }, All: { type: 'switch' } },
    process(ctx, p) { findRules(ctx, p).forEach(r => ctx.out(ruleObj(r))); } });
  const toggle = (name, on) => cmdlet({ name, module: 'NetSecurity', version: '2.0.0.0', shouldProcess: true, params: ruleSel,
    async process(ctx, p) {
      for (const r of findRules(ctx, p)) {
        if (!(await ctx.confirm(on ? 'Enable' : 'Disable', r.displayName))) continue;
        WS.fw.setEnabled(r.name, on);
        if (p.PassThru) ctx.out(ruleObj(r));
      }
    } });
  toggle('Enable-NetFirewallRule', true);
  toggle('Disable-NetFirewallRule', false);
  cmdlet({ name: 'Set-NetFirewallRule', module: 'NetSecurity', version: '2.0.0.0', shouldProcess: true,
    params: { ...ruleSel, Enabled: { type: 'enum', values: ['True', 'False'] }, Action: { type: 'enum', values: ['Allow', 'Block'] }, NewDisplayName: {}, Profile: {}, Description: {}, Protocol: {},
      LocalPort: { type: 'string[]' }, RemotePort: { type: 'string[]' }, LocalAddress: { type: 'string[]' }, RemoteAddress: { type: 'string[]' }, Program: {}, Service: {}, EdgeTraversalPolicy: { type: 'enum', values: ['Block', 'Allow', 'DeferToUser', 'DeferToApp'] } },
    async process(ctx, p) {
      const props = {};
      if (p.Enabled) props.enabled = p.Enabled === 'True';
      if (p.Action) props.action = p.Action;
      if (p.NewDisplayName) props.displayName = p.NewDisplayName;
      if (p.Profile) props.profile = p.Profile;
      if (p.Description != null) props.description = p.Description;
      if (p.Protocol) props.protocol = p.Protocol;
      if (p.LocalPort) props.localPort = p.LocalPort.join(',');
      if (p.RemotePort) props.remotePort = p.RemotePort.join(',');
      if (p.LocalAddress) props.localAddress = p.LocalAddress.join(',');
      if (p.RemoteAddress) props.remoteAddress = p.RemoteAddress.join(',');
      if (p.Program) props.program = p.Program;
      if (p.Service) props.service = p.Service;
      if (p.EdgeTraversalPolicy) props.edgeTraversal = p.EdgeTraversalPolicy;
      for (const r of findRules({ ...ctx, error: ctx.error }, { Name: p.Name, DisplayName: p.DisplayName, DisplayGroup: p.DisplayGroup, InputObject: p.InputObject })) {
        if (!(await ctx.confirm('Set', r.displayName))) continue;
        const res = WS.fw.setRule(r.name, props);
        if (!res.ok) { cimError(ctx, res.error, { cls: 'MSFT_NetFirewallRule', code: 87, ns: 'root/StandardCimv2' }); continue; }
        if (p.PassThru) ctx.out(ruleObj(r));
      }
    } });
  cmdlet({ name: 'New-NetFirewallRule', module: 'NetSecurity', version: '2.0.0.0', shouldProcess: true, synopsis: 'Creates a new inbound or outbound firewall rule and adds the rule to the target computer.',
    params: { DisplayName: { mandatory: true }, Name: {}, Direction: { type: 'enum', values: ['Inbound', 'Outbound'] }, Action: { type: 'enum', values: ['Allow', 'Block', 'NotConfigured'] }, Protocol: {}, LocalPort: { type: 'string[]' }, RemotePort: { type: 'string[]' }, RemoteAddress: { type: 'string[]' }, LocalAddress: { type: 'string[]' }, Program: {}, Service: {}, Profile: { type: 'string[]' }, Enabled: { type: 'enum', values: ['True', 'False'] }, Group: {}, Description: {} },
    async process(ctx, p) {
      if (!(await ctx.confirm('New', p.DisplayName))) return;
      const r = WS.fw.newRule({ displayName: p.DisplayName, name: p.Name, direction: p.Direction, action: p.Action, protocol: p.Protocol ? String(p.Protocol).toUpperCase().replace('ICMPV4', 'ICMPv4').replace('ICMPV6', 'ICMPv6') : 'Any', localPort: p.LocalPort ? p.LocalPort.join(',') : null, remotePort: p.RemotePort ? p.RemotePort.join(',') : null, remoteAddress: p.RemoteAddress ? p.RemoteAddress.join(',') : null, localAddress: p.LocalAddress ? p.LocalAddress.join(',') : null, program: p.Program, service: p.Service, profile: p.Profile, enabled: p.Enabled !== 'False', group: p.Group, description: p.Description });
      if (!r.ok) return cimError(ctx, r.error, { cls: 'MSFT_NetFirewallRule', code: 87, ns: 'root/StandardCimv2' });
      ctx.out(ruleObj(r.rule));
    } });
  cmdlet({ name: 'Remove-NetFirewallRule', module: 'NetSecurity', version: '2.0.0.0', shouldProcess: true, params: ruleSel,
    async process(ctx, p) { for (const r of findRules(ctx, p)) { if (await ctx.confirm('Delete', r.displayName)) WS.fw.removeRule(r.name); } } });
  const fwProfileObj = (n, pr) => psobj('Microsoft.Management.Infrastructure.CimInstance#root/StandardCimv2/MSFT_NetFirewallProfile', {
    Name: n, Enabled: pr.enabled ? 'True' : 'False', DefaultInboundAction: pr.inbound === 'Allow' ? 'Allow' : 'NotConfigured', DefaultOutboundAction: pr.outbound === 'Block' ? 'Block' : 'NotConfigured', AllowInboundRules: pr.blockAll ? 'False' : 'NotConfigured', AllowLocalFirewallRules: 'NotConfigured',
    AllowLocalIPsecRules: 'NotConfigured', AllowUserApps: 'NotConfigured', AllowUserPorts: 'NotConfigured', AllowUnicastResponseToMulticast: 'NotConfigured', NotifyOnListen: pr.notify ? 'True' : 'False', EnableStealthModeForIPsec: 'NotConfigured',
    LogFileName: pr.logFile || WS.fw.LOG_FILE, LogMaxSizeKilobytes: pr.logMaxKB || 4096, LogAllowed: pr.logAllowed ? 'True' : 'False', LogBlocked: pr.logDropped ? 'True' : 'False', LogIgnored: 'NotConfigured', DisabledInterfaceAliases: ['NotConfigured'] });
  cmdlet({ name: 'Get-NetFirewallProfile', module: 'NetSecurity', version: '2.0.0.0', params: { Name: { type: 'string[]', pos: 0, alias: ['Profile'] }, PolicyStore: {} },
    process(ctx, p) { for (const n of ['Domain', 'Private', 'Public']) if (!p.Name || p.Name.some(x => wild(x, n))) ctx.out(fwProfileObj(n, WS.fw.profile(n))); } });
  cmdlet({ name: 'Set-NetFirewallProfile', module: 'NetSecurity', version: '2.0.0.0', shouldProcess: true,
    params: { Profile: { type: 'string[]', pos: 0, alias: ['Name'] }, All: { type: 'switch' }, Enabled: { type: 'enum', values: ['True', 'False', 'NotConfigured'] }, DefaultInboundAction: { type: 'enum', values: ['Allow', 'Block', 'NotConfigured'] }, DefaultOutboundAction: { type: 'enum', values: ['Allow', 'Block', 'NotConfigured'] }, LogBlocked: { type: 'enum', values: ['True', 'False', 'NotConfigured'] },
      LogAllowed: { type: 'enum', values: ['True', 'False', 'NotConfigured'] }, LogFileName: {}, LogMaxSizeKilobytes: { type: 'int' }, NotifyOnListen: { type: 'enum', values: ['True', 'False', 'NotConfigured'] }, AllowInboundRules: { type: 'enum', values: ['True', 'False', 'NotConfigured'] } },
    async process(ctx, p) {
      const names = p.All || !p.Profile ? ['Domain', 'Private', 'Public'] : p.Profile.flatMap(x => x.split(',')).map(x => x.trim());
      for (const n0 of names) {
        const n = ['Domain', 'Private', 'Public'].find(x => x.toLowerCase() === n0.toLowerCase());
        if (!n) { notFound(ctx, 'MSFT_NetFirewallProfile', 'Name', n0); continue; }
        if (!(await ctx.confirm('Set', n))) continue;
        WS.fw.setProfile(n, { ...(p.Enabled && p.Enabled !== 'NotConfigured' ? { enabled: p.Enabled === 'True' } : {}), ...(p.DefaultInboundAction ? { inbound: p.DefaultInboundAction } : {}), ...(p.DefaultOutboundAction ? { outbound: p.DefaultOutboundAction } : {}), ...(p.LogBlocked ? { logDropped: p.LogBlocked === 'True' } : {}),
          ...(p.LogAllowed ? { logAllowed: p.LogAllowed === 'True' } : {}), ...(p.LogFileName ? { logFile: p.LogFileName } : {}), ...(p.LogMaxSizeKilobytes != null ? { logMaxKB: p.LogMaxSizeKilobytes } : {}),
          ...(p.NotifyOnListen ? { notify: p.NotifyOnListen === 'True' } : {}), ...(p.AllowInboundRules && p.AllowInboundRules !== 'NotConfigured' ? { blockAll: p.AllowInboundRules === 'False' } : {}) });
      }
    } });

  /* ================================================================ local accounts */
  const LA = 'Microsoft.PowerShell.LocalAccounts';
  const dcCheck = ctx => { if (!WS.local.available()) ctx.throw({ message: 'This command cannot be run on a domain controller. Use the ActiveDirectory module cmdlets (for example Get-ADUser) instead.', category: 'InvalidOperation', exception: 'InvalidOperationException', id: `InvalidOperation,Microsoft.PowerShell.Commands.${ctx.name.replace('-', '')}Command` }); };
  const userObj = u => psobj('Microsoft.PowerShell.Commands.LocalUser', { AccountExpires: null, Description: u.description, Enabled: u.enabled, FullName: u.fullName, PasswordChangeableDate: u.passwordLastSet ? new Date(u.passwordLastSet) : null, PasswordExpires: u.neverExpires ? null : new Date(Date.now() + 42 * 864e5), UserMayChangePassword: !u.cannotChange, PasswordRequired: true, PasswordLastSet: u.passwordLastSet ? new Date(u.passwordLastSet) : null, LastLogon: u.lastLogon ? new Date(u.lastLogon) : null, Name: u.name, SID: u.sid, PrincipalSource: 'Local', ObjectClass: 'User' }, { str: u.name });
  const groupObj = g => psobj('Microsoft.PowerShell.Commands.LocalGroup', { Description: g.description, Name: g.name, SID: g.sid, PrincipalSource: 'Local', ObjectClass: 'Group' }, { str: g.name });
  view('Microsoft.PowerShell.Commands.LocalUser', { table: { columns: [{ label: 'Name', width: 18, value: 'Name' }, { label: 'Enabled', width: 7, value: 'Enabled' }, { label: 'Description', value: 'Description' }] } });
  view('Microsoft.PowerShell.Commands.LocalGroup', { table: { columns: [{ label: 'Name', width: 35, value: 'Name' }, { label: 'Description', value: 'Description' }] } });
  view('Microsoft.PowerShell.Commands.LocalPrincipal', { table: { columns: [{ label: 'ObjectClass', width: 11, value: 'ObjectClass' }, { label: 'Name', width: 29, value: 'Name' }, { label: 'PrincipalSource', value: 'PrincipalSource' }] } });
  const laErr = (ctx, r, target) => {
    const map = { UserExists: ['ResourceExists', 'UserExistsException', 'UserExists'], GroupExists: ['ResourceExists', 'GroupExistsException', 'GroupExists'], UserNotFound: ['ObjectNotFound', 'UserNotFoundException', 'UserNotFound'], GroupNotFound: ['ObjectNotFound', 'GroupNotFoundException', 'GroupNotFound'], InvalidPassword: ['InvalidOperation', 'InvalidPasswordException', 'InvalidPassword'], MemberExists: ['ResourceExists', 'MemberExistsException', 'MemberExists'], MemberNotFound: ['ObjectNotFound', 'MemberNotFoundException', 'MemberNotFound'], PrincipalNotFound: ['ObjectNotFound', 'PrincipalNotFoundException', 'PrincipalNotFound'] };
    const [category, exception, id] = map[r.code] || ['InvalidOperation', 'InvalidOperationException', 'InvalidOperation'];
    const msg = r.code === 'InvalidPassword' ? 'Unable to update the password. The value provided for the new password does not meet the length, complexity, or history requirements of the domain.' : r.code === 'UserExists' ? `User ${target} already exists.` : r.code === 'GroupExists' ? `Group ${target} already exists.` : r.code === 'MemberExists' ? r.error.replace(/^(.*?)\\/, '$1\\') : r.error;
    ctx.error({ message: msg, category, target, targetType: 'String', exception, id: `${id},Microsoft.PowerShell.Commands.${ctx.name.replace('-', '')}Command` });
  };
  cmdlet({ name: 'Get-LocalUser', module: LA, version: '1.0.0.0', synopsis: 'Gets local user accounts.', params: { Name: { type: 'string[]', pos: 0, pipe: 'both' }, SID: { type: 'string[]' } },
    process(ctx, p) {
      dcCheck(ctx);
      for (const n of p.Name || ['*']) {
        const hits = WS.local.users().filter(u => wild(n, u.name));
        if (!hits.length && !hasWild(n)) laErr(ctx, { code: 'UserNotFound', error: `User ${n} was not found.` }, n);
        hits.forEach(u => ctx.out(userObj(u)));
      }
    } });
  cmdlet({ name: 'New-LocalUser', module: LA, version: '1.0.0.0', shouldProcess: true, synopsis: 'Creates a local user account.',
    params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, Password: { type: 'securestring', mandatory: true, set: 'Password' }, NoPassword: { type: 'switch', set: 'NoPassword' }, FullName: {}, Description: {}, AccountNeverExpires: { type: 'switch' }, PasswordNeverExpires: { type: 'switch' }, UserMayNotChangePassword: { type: 'switch' }, Disabled: { type: 'switch' } },
    async process(ctx, p) {
      dcCheck(ctx);
      if (!(await ctx.confirm('Create local user', p.Name))) return;
      const r = WS.local.createUser(p.Name, { password: p.NoPassword ? null : p.Password ? p.Password.value : null, noPassword: !!p.NoPassword, fullName: p.FullName, description: p.Description, neverExpires: p.PasswordNeverExpires, cannotChange: p.UserMayNotChangePassword, enabled: !p.Disabled });
      if (!r.ok) return laErr(ctx, r, p.Name);
      ctx.out(userObj(r.user));
    } });
  const userTarget = (ctx, p) => { const n = p.Name || (p.InputObject && getProp(p.InputObject, 'Name')); const u = WS.local.user(n || ''); if (!u) laErr(ctx, { code: 'UserNotFound', error: `User ${n} was not found.` }, n); return u; };
  const localUserParams = { Name: { pos: 0, pipe: 'name' }, InputObject: { type: 'object', pipe: 'value', accepts: v => PS.typeName(v) === 'Microsoft.PowerShell.Commands.LocalUser' } };
  cmdlet({ name: 'Remove-LocalUser', module: LA, version: '1.0.0.0', shouldProcess: true, params: localUserParams,
    async process(ctx, p) { dcCheck(ctx); const u = userTarget(ctx, p); if (u && (await ctx.confirm('Remove local user', u.name))) { const r = WS.local.deleteUser(u.name); if (!r.ok) laErr(ctx, r, u.name); } } });
  cmdlet({ name: 'Rename-LocalUser', module: LA, version: '1.0.0.0', shouldProcess: true, params: { ...localUserParams, NewName: { pos: 1, mandatory: true } },
    async process(ctx, p) { dcCheck(ctx); const u = userTarget(ctx, p); if (u && (await ctx.confirm('Rename local user', u.name))) { const r = WS.local.renameUser(u.name, p.NewName); if (!r.ok) laErr(ctx, r, p.NewName); } } });
  cmdlet({ name: 'Set-LocalUser', module: LA, version: '1.0.0.0', shouldProcess: true, params: { ...localUserParams, Password: { type: 'securestring' }, Description: {}, FullName: {}, PasswordNeverExpires: { type: 'bool' }, UserMayChangePassword: { type: 'bool' }, AccountNeverExpires: { type: 'switch' } },
    async process(ctx, p) {
      dcCheck(ctx);
      const u = userTarget(ctx, p);
      if (!u || !(await ctx.confirm('Modify local user', u.name))) return;
      if (p.Password) { const r = WS.local.setPassword(u.name, p.Password.value); if (!r.ok) return laErr(ctx, r, u.name); }
      const props = {};
      if (p.Description != null) props.description = p.Description;
      if (p.FullName != null) props.fullName = p.FullName;
      if (p.PasswordNeverExpires != null) props.neverExpires = p.PasswordNeverExpires;
      if (p.UserMayChangePassword != null) props.cannotChange = !p.UserMayChangePassword;
      WS.local.setUser(u.name, props);
    } });
  for (const [verb, on] of [['Enable', true], ['Disable', false]]) {
    cmdlet({ name: `${verb}-LocalUser`, module: LA, version: '1.0.0.0', shouldProcess: true, params: { Name: { type: 'string[]', pos: 0, pipe: 'name' }, InputObject: localUserParams.InputObject },
      async process(ctx, p) { dcCheck(ctx); for (const n of p.Name || [getProp(p.InputObject, 'Name')]) { const u = userTarget(ctx, { Name: n }); if (u && (await ctx.confirm(`${verb} local user`, u.name))) WS.local.setUser(u.name, { enabled: on }); } } });
  }
  cmdlet({ name: 'Get-LocalGroup', module: LA, version: '1.0.0.0', synopsis: 'Gets the local security groups.', params: { Name: { type: 'string[]', pos: 0, pipe: 'both' } },
    process(ctx, p) {
      dcCheck(ctx);
      for (const n of p.Name || ['*']) {
        const hits = WS.local.groups().filter(g => wild(n, g.name));
        if (!hits.length && !hasWild(n)) laErr(ctx, { code: 'GroupNotFound', error: `Group ${n} was not found.` }, n);
        hits.forEach(g => ctx.out(groupObj(g)));
      }
    } });
  cmdlet({ name: 'New-LocalGroup', module: LA, version: '1.0.0.0', shouldProcess: true, params: { Name: { pos: 0, mandatory: true }, Description: {} },
    async process(ctx, p) { dcCheck(ctx); if (!(await ctx.confirm('Create local group', p.Name))) return; const r = WS.local.createGroup(p.Name, p.Description); if (!r.ok) return laErr(ctx, r, p.Name); ctx.out(groupObj(r.group)); } });
  cmdlet({ name: 'Remove-LocalGroup', module: LA, version: '1.0.0.0', shouldProcess: true, params: { Name: { pos: 0, mandatory: true } },
    async process(ctx, p) { dcCheck(ctx); if (!(await ctx.confirm('Remove local group', p.Name))) return; const r = WS.local.deleteGroup(p.Name); if (!r.ok) laErr(ctx, r, p.Name); } });
  const memberCmd = (name, add) => cmdlet({ name, module: LA, version: '1.0.0.0', shouldProcess: true, params: { Group: { pos: 0, alias: ['Name'], mandatory: true }, Member: { type: 'object[]', pos: 1, mandatory: true, pipe: 'value' } },
    async process(ctx, p) {
      dcCheck(ctx);
      const g = WS.local.group(toStr(getProp(p.Group, 'Name') || p.Group));
      if (!g) return laErr(ctx, { code: 'GroupNotFound', error: `Group ${p.Group} was not found.` }, p.Group);
      for (const m of p.Member) {
        const n = toStr(getProp(m, 'Name') || m);
        if (!(await ctx.confirm(add ? 'Add member' : 'Remove member', `${n} ${add ? 'to' : 'from'} ${g.name}`))) continue;
        const r = add ? WS.local.addMember(g.name, n) : WS.local.removeMember(g.name, n);
        if (!r.ok) laErr(ctx, r.code === 'MemberExists' ? { code: 'MemberExists', error: `${WS.sys.name}\\${n.replace(/^.*\\/, '')} is already a member of group ${g.name}.` } : r.code === 'PrincipalNotFound' ? { code: 'PrincipalNotFound', error: `Principal ${n} was not found.` } : r, r.code === 'PrincipalNotFound' ? n : g.name);
      }
    } });
  memberCmd('Add-LocalGroupMember', true);
  memberCmd('Remove-LocalGroupMember', false);
  cmdlet({ name: 'Get-LocalGroupMember', module: LA, version: '1.0.0.0', params: { Group: { pos: 0, alias: ['Name'], mandatory: true }, Member: { pos: 1 } },
    process(ctx, p) {
      dcCheck(ctx);
      const g = WS.local.group(toStr(p.Group));
      if (!g) return laErr(ctx, { code: 'GroupNotFound', error: `Group ${p.Group} was not found.` }, p.Group);
      for (const m of g.members) {
        if (p.Member && !wild(p.Member, m)) continue;
        const isGroup = !!WS.local.group(m) || /^NT AUTHORITY\\/i.test(m);
        ctx.out(psobj('Microsoft.PowerShell.Commands.LocalPrincipal', { ObjectClass: isGroup ? 'Group' : 'User', Name: m.includes('\\') ? m : `${WS.sys.name}\\${m}`, PrincipalSource: m.includes('\\') && !/^NT AUTHORITY/i.test(m) ? 'ActiveDirectory' : 'Local', SID: (WS.local.user(m) || WS.local.group(m) || {}).sid || 'S-1-5-11' }, { str: m }));
      }
    } });

  /* ================================================================ storage */
  const ST = 'Storage';
  const diskObj = d => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Disk', {
    Number: d.number, FriendlyName: d.space ? (WS.spaces.spaceOfDisk(d.number) || {}).name || d.model : d.model, SerialNumber: d.serial || '', HealthStatus: d.space ? (WS.spaces.spaceOfDisk(d.number) || {}).healthStatus || 'Healthy' : 'Healthy',
    OperationalStatus: d.online ? 'Online' : 'Offline', Size: d.size, PartitionStyle: d.style,
    IsOffline: !d.online, IsReadOnly: d.readOnly, IsBoot: d.boot, IsSystem: d.boot, NumberOfPartitions: d.partitions.length, AllocatedSize: d.size - d.unallocated, BusType: d.space ? 'Spaces' : 'SCSI', Path: `\\\\?\\scsi#disk&ven_msft&prod_virtual_disk#5&${d.number}`, OfflineReason: d.online ? null : 'Policy', UniqueId: '60022480' + U.hashStr('disk' + d.number).toString(16)
  }, { str: `Disk ${d.number}` });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Disk', { table: { columns: [
    { label: 'Number', width: 6, align: 'right', value: 'Number' }, { label: 'Friendly Name', width: 20, value: 'FriendlyName' }, { label: 'Serial Number', width: 14, value: 'SerialNumber' }, { label: 'HealthStatus', width: 12, value: 'HealthStatus' },
    { label: 'OperationalStatus', width: 17, value: 'OperationalStatus' }, { label: 'Total Size', width: 10, align: 'right', value: o => sizeText(o.Size).replace('.00 ', ' ') }, { label: 'Partition\nStyle', value: 'PartitionStyle' }] } });
  const findDisk = (ctx, n) => { const d = WS.storage.disks().find(x => x.number === +n); if (!d) notFound(ctx, 'MSFT_Disk', 'Number', n); return d; };
  const diskNums = (p, item) => (item && getProp(item, 'Number') != null && !p.Number ? [getProp(item, 'Number')] : p.Number != null ? toArray(p.Number) : null);
  cmdlet({ name: 'Get-Disk', module: ST, version: '2.0.0.0', synopsis: 'Gets one or more disks visible to the operating system.', params: { Number: { type: 'int[]', pos: 0, alias: ['DeviceId'] }, FriendlyName: { type: 'string[]' },
    VirtualDisk: { type: 'object', pipe: 'value', accepts: v => /MSFT_VirtualDisk/.test(PS.typeName(v)) } },
    process(ctx, p) {
      if (p.VirtualDisk) { const v = WS.spaces.space(getProp(p.VirtualDisk, 'FriendlyName')); const d = v && WS.storage.disks().find(x => x.number === v.disk); if (d) ctx.out(diskObj(d)); return; }
      const disks = WS.storage.disks(); if (!p.Number) { disks.forEach(d => ctx.out(diskObj(d))); return; } for (const n of p.Number) { const d = findDisk(ctx, n); if (d) ctx.out(diskObj(d)); } } });
  cmdlet({ name: 'Set-Disk', module: ST, version: '2.0.0.0', params: { Number: { type: 'int', pos: 0, pipe: 'name' }, InputObject: { type: 'object', pipe: 'value', accepts: v => /MSFT_Disk/.test(PS.typeName(v)) }, IsOffline: { type: 'bool' }, IsReadOnly: { type: 'bool' } },
    process(ctx, p, item) {
      const n = item ? getProp(item, 'Number') : p.Number;
      const d = findDisk(ctx, n);
      if (!d) return;
      if (p.IsOffline != null) { const r = WS.storage.setOnline(n, !p.IsOffline); if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_Disk', ns: 'ROOT/Microsoft/Windows/Storage', code: 5, category: 'PermissionDenied' }); }
      if (p.IsReadOnly != null) { const r = WS.storage.setReadOnly(n, p.IsReadOnly); if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_Disk', ns: 'ROOT/Microsoft/Windows/Storage', code: 5, category: 'PermissionDenied' }); }
    } });
  cmdlet({ name: 'Initialize-Disk', module: ST, version: '2.0.0.0', synopsis: 'Initializes a RAW disk for first time use, enabling the disk to be formatted and used to store data.', params: { Number: { type: 'int[]', pos: 0, pipe: 'name' }, InputObject: { type: 'object', pipe: 'value', accepts: v => /MSFT_Disk/.test(PS.typeName(v)) }, PartitionStyle: { type: 'enum', values: ['MBR', 'GPT'] }, PassThru: { type: 'switch' } },
    process(ctx, p, item) {
      for (const n of diskNums(p, item) || []) {
        const r = WS.storage.initialize(n, p.PartitionStyle || 'GPT');
        if (!r.ok) { cimError(ctx, r.code === 'AlreadyInitialized' ? 'The disk has already been initialized.' : r.code === 'Offline' ? 'The disk is offline.' : r.error, { cls: 'MSFT_Disk', ns: 'ROOT/Microsoft/Windows/Storage', code: r.code === 'AlreadyInitialized' ? 41001 : 41004, category: 'InvalidOperation' }); continue; }
        if (p.PassThru) ctx.out(diskObj(WS.storage.disks().find(x => x.number === n)));
      }
    } });
  cmdlet({ name: 'Clear-Disk', module: ST, version: '2.0.0.0', shouldProcess: true, impact: 'High', params: { Number: { type: 'int[]', pos: 0, pipe: 'name' }, RemoveData: { type: 'switch' }, RemoveOEM: { type: 'switch' }, InputObject: { type: 'object', pipe: 'value', accepts: v => /MSFT_Disk/.test(PS.typeName(v)) } },
    async process(ctx, p, item) { for (const n of diskNums(p, item) || []) { if (!(await ctx.confirm('Clear-Disk', `Disk ${n}`, { impact: 'High', query: `Are you sure you want to perform this action?\nThis will erase all data on disk ${n} "Msft Virtual Disk".` }))) continue; const r = WS.storage.clearDisk(n); if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_Disk', ns: 'ROOT/Microsoft/Windows/Storage', code: 5 }); } } });
  const partObj = (d, pt) => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Partition', {
    DiskNumber: d.number, PartitionNumber: pt.number, DriveLetter: pt.letter || '', Offset: pt.offset, Size: pt.size, Type: pt.type, IsBoot: pt.letter === 'C', IsSystem: pt.type === 'System', IsActive: false, IsHidden: pt.type !== 'Basic', GptType: pt.type === 'Basic' ? '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}' : '{e3c9e316-0b5c-4db8-817d-f92df00215ae}', AccessPaths: (WS.storage.volumeAt(d.number, pt.number) || {}).accessPaths || [], DiskPath: `\\\\?\\scsi#disk&ven_msft&prod_virtual_disk#5&${d.number}`
  }, { str: `Partition ${pt.number}` });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Partition', { table: { groupBy: { label: 'DiskPath', value: o => o.DiskPath, indent: 3 }, columns: [
    { label: 'PartitionNumber', width: 15, value: 'PartitionNumber' }, { label: 'DriveLetter', width: 11, value: 'DriveLetter' }, { label: 'Offset', width: 13, value: 'Offset' }, { label: 'Size', width: 33, align: 'right', value: o => sizeText(o.Size) }, { label: 'Type', value: 'Type' }] } });
  cmdlet({ name: 'Get-Partition', module: ST, version: '2.0.0.0', params: { DiskNumber: { type: 'int[]', pos: 0, alias: ['Number'], pipe: 'name' }, PartitionNumber: { type: 'int[]', pos: 1 }, DriveLetter: { type: 'string[]' } },
    process(ctx, p) {
      for (const d of WS.storage.disks()) {
        if (p.DiskNumber && !p.DiskNumber.includes(d.number)) continue;
        for (const pt of d.partitions) {
          if (p.PartitionNumber && !p.PartitionNumber.includes(pt.number)) continue;
          if (p.DriveLetter && !p.DriveLetter.some(l => String(l).toUpperCase() === pt.letter)) continue;
          ctx.out(partObj(d, pt));
        }
      }
      if (p.DriveLetter) for (const l of p.DriveLetter) if (!WS.storage.byLetter(l)) notFound(ctx, 'MSFT_Partition', 'DriveLetter', l);
    } });
  cmdlet({ name: 'New-Partition', module: ST, version: '2.0.0.0', synopsis: 'Creates a new partition on an existing Disk object.',
    params: { DiskNumber: { type: 'int', pos: 0, alias: ['Number'], pipe: 'name' }, InputObject: { type: 'object', pipe: 'value', accepts: v => /MSFT_Disk/.test(PS.typeName(v)) }, Size: { type: 'uint64' }, UseMaximumSize: { type: 'switch' }, DriveLetter: {}, AssignDriveLetter: { type: 'switch' }, GptType: {}, MbrType: {}, IsActive: { type: 'switch' } },
    process(ctx, p, item) {
      const n = item ? getProp(item, 'Number') : p.DiskNumber;
      if (n == null) ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: DiskNumber.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'MissingMandatoryParameter,New-Partition' });
      if (!p.Size && !p.UseMaximumSize) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,New-Partition' });
      const r = WS.storage.newPartition(n, { size: p.UseMaximumSize ? 'max' : p.Size, letter: p.DriveLetter ? String(p.DriveLetter) : p.AssignDriveLetter ? 'auto' : null });
      if (!r.ok) return cimError(ctx, r.code === 'NotEnoughSpace' ? 'Not enough available capacity' : r.code === 'Offline' ? 'The disk is offline.' : r.code === 'NotInitialized' ? 'The disk has not been initialized.' : r.code === 'LetterInUse' ? 'The requested access path is already in use.' : r.error, { cls: 'MSFT_Disk', ns: 'ROOT/Microsoft/Windows/Storage', code: r.code === 'NotEnoughSpace' ? 40000 : 41000, category: 'NotSpecified' });
      ctx.out(partObj(WS.storage.disks().find(x => x.number === n), r.partition));
    } });
  cmdlet({ name: 'Remove-Partition', module: ST, version: '2.0.0.0', shouldProcess: true, impact: 'High', params: { DiskNumber: { type: 'int', pos: 0, pipe: 'name' }, PartitionNumber: { type: 'int', pos: 1, pipe: 'name' }, DriveLetter: { pipe: 'name' } },
    async process(ctx, p) {
      let n = p.DiskNumber, pn = p.PartitionNumber;
      if (p.DriveLetter) { const h = WS.storage.byLetter(p.DriveLetter); if (!h) return notFound(ctx, 'MSFT_Partition', 'DriveLetter', p.DriveLetter); n = h.disk.number; pn = h.part.number; }
      if (!(await ctx.confirm('Remove-Partition', `Disk ${n} partition ${pn}`, { impact: 'High', query: `Are you sure you want to perform this action?\nThis will erase all data on disk ${n} partition ${pn}.` }))) return;
      const r = WS.storage.deletePartition(n, pn);
      if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_Partition', ns: 'ROOT/Microsoft/Windows/Storage', code: 42008, category: 'PermissionDenied' });
    } });
  const volObj = v => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Volume', {
    DriveLetter: v.letter || '', FriendlyName: v.label || (v.type === 'Recovery' ? '' : ''), FileSystemType: v.fs || 'Unknown', DriveType: 'Fixed', HealthStatus: 'Healthy', OperationalStatus: 'OK', SizeRemaining: v.free, Size: v.size, FileSystemLabel: v.label, FileSystem: v.fs, Path: v.path, DedupMode: 'NotAvailable', AllocationUnitSize: v.au || 4096
  }, { str: v.letter ? v.letter + ':' : 'Volume' });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Volume', { table: { columns: [
    { label: 'DriveLetter', width: 11, value: 'DriveLetter' }, { label: 'FriendlyName', width: 12, value: 'FriendlyName' }, { label: 'FileSystemType', width: 14, value: 'FileSystemType' }, { label: 'DriveType', width: 9, value: 'DriveType' },
    { label: 'HealthStatus', width: 12, value: 'HealthStatus' }, { label: 'OperationalStatus', width: 17, value: 'OperationalStatus' }, { label: 'SizeRemaining', width: 13, align: 'right', value: o => sizeText(o.SizeRemaining) }, { label: 'Size', align: 'right', value: o => sizeText(o.Size) }] } });
  cmdlet({ name: 'Get-Volume', module: ST, version: '2.0.0.0', params: { DriveLetter: { type: 'string[]', pos: 0 }, FileSystemLabel: { type: 'string[]' } },
    process(ctx, p) {
      const vols = WS.storage.volumes();
      if (p.DriveLetter) { for (const l of p.DriveLetter) { const v = vols.find(x => x.letter === String(l).toUpperCase()); if (v) ctx.out(volObj(v)); else notFound(ctx, 'MSFT_Volume', 'DriveLetter', l); } return; }
      const cd = WS.storage.cdrom();
      if (cd && cd.letter) ctx.out(psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_Volume', { DriveLetter: cd.letter, FriendlyName: '', FileSystemType: 'Unknown', DriveType: 'CD-ROM', HealthStatus: 'Healthy', OperationalStatus: 'Unknown', SizeRemaining: 0, Size: 0 }));
      vols.filter(v => !p.FileSystemLabel || p.FileSystemLabel.some(x => wild(x, v.label))).forEach(v => ctx.out(volObj(v)));
    } });
  cmdlet({ name: 'Format-Volume', module: ST, version: '2.0.0.0', shouldProcess: true, synopsis: 'Formats one or more existing volumes or a new volume on an existing partition.',
    params: { DriveLetter: { type: 'string[]', pos: 0, pipe: 'name' }, Partition: { type: 'object', pipe: 'value', accepts: v => /MSFT_Partition/.test(PS.typeName(v)) }, FileSystem: { type: 'enum', values: ['FAT', 'FAT32', 'exFAT', 'NTFS', 'ReFS'] }, NewFileSystemLabel: {}, AllocationUnitSize: { type: 'int' }, Full: { type: 'switch' }, Force: { type: 'switch' } },
    async process(ctx, p, item) {
      let targets = [];
      if (item && /MSFT_Partition/.test(PS.typeName(item))) {
        const d = WS.storage.disk(item.DiskNumber); const pt = d && d.partitions.find(x => x.number === item.PartitionNumber);
        if (pt) targets.push({ disk: d, part: pt });
      } else for (const l of p.DriveLetter || []) { const h = WS.storage.byLetter(l); if (!h) notFound(ctx, 'MSFT_Volume', 'DriveLetter', l); else targets.push(h); }
      for (const t of targets) {
        if (!(await ctx.confirm('Format-Volume', t.part.letter ? `${t.part.letter}:` : `Partition ${t.part.number}`, { impact: 'Medium' }))) continue;
        ctx.progress({ activity: 'Formatting volume', status: '', percent: 60 });
        await ctx.sleep(400);
        const r = WS.storage.format(t, { fs: p.FileSystem || 'NTFS', label: p.NewFileSystemLabel || '', au: p.AllocationUnitSize });
        if (!r.ok) { cimError(ctx, r.error, { cls: 'MSFT_Volume', ns: 'ROOT/Microsoft/Windows/Storage', code: 42002, category: 'NotSpecified' }); continue; }
        ctx.out(volObj(r.volume));
      }
    } });
  cmdlet({ name: 'Set-Volume', module: ST, version: '2.0.0.0', params: { DriveLetter: { pos: 0, pipe: 'name' }, NewFileSystemLabel: {} },
    process(ctx, p) { const r = WS.storage.setLabel(p.DriveLetter, p.NewFileSystemLabel || ''); if (!r.ok) notFound(ctx, 'MSFT_Volume', 'DriveLetter', p.DriveLetter); } });
  cmdlet({ name: 'Set-Partition', module: ST, version: '2.0.0.0', params: { DriveLetter: { pos: 0, pipe: 'name' }, NewDriveLetter: {}, DiskNumber: { type: 'int' }, PartitionNumber: { type: 'int' }, IsOffline: { type: 'bool' } },
    process(ctx, p) {
      if (p.NewDriveLetter) {
        const r = p.DriveLetter ? WS.storage.setLetter(p.DriveLetter, p.NewDriveLetter) : WS.storage.assignLetter(p.DiskNumber, p.PartitionNumber, p.NewDriveLetter);
        if (!r.ok) cimError(ctx, r.code === 'LetterInUse' ? 'The requested access path is already in use.' : r.error, { cls: 'MSFT_Partition', ns: 'ROOT/Microsoft/Windows/Storage', code: 42002 });
      }
    } });
  /** The partition a Storage cmdlet names: -DiskNumber/-PartitionNumber, -DriveLetter, or a piped MSFT_Partition. */
  function partitionArg(ctx, p, item) {
    if (item && /MSFT_Partition/.test(PS.typeName(item))) return { n: item.DiskNumber, pn: item.PartitionNumber };
    if (p.DriveLetter) { const h = WS.storage.byLetter(p.DriveLetter); if (!h) { notFound(ctx, 'MSFT_Partition', 'DriveLetter', p.DriveLetter); return null; } return { n: h.disk.number, pn: h.part.number }; }
    if (p.DiskNumber == null || p.PartitionNumber == null) { ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet' }); return null; }
    return { n: p.DiskNumber, pn: p.PartitionNumber };
  }
  const accessParams = { DiskNumber: { type: 'int', pipe: 'name' }, PartitionNumber: { type: 'int', pipe: 'name' }, DriveLetter: {}, AccessPath: { pos: 0 }, InputObject: { type: 'object', pipe: 'value', accepts: v => /MSFT_Partition/.test(PS.typeName(v)) } };
  const accessError = (ctx, r) => cimError(ctx, r.code === 'NotEmpty' || r.code === 'PathNotFound' || r.code === 'InvalidPath' || r.code === 'NotNtfs' || r.code === 'SameVolume' ? 'The access path is not valid.' : r.code === 'InUse' ? 'The requested access path is already in use.' : r.error,
    { cls: 'MSFT_Partition', ns: 'ROOT/Microsoft/Windows/Storage', code: r.code === 'InUse' || r.code === 'LetterInUse' ? 42002 : 42012, category: 'InvalidArgument' });
  cmdlet({ name: 'Add-PartitionAccessPath', module: ST, version: '2.0.0.0', synopsis: 'Adds an access path such as a drive letter or folder to a partition.', params: { ...accessParams, AssignDriveLetter: { type: 'switch' }, PassThru: { type: 'switch' } },
    process(ctx, p, item) {
      const t = partitionArg(ctx, p, item); if (!t) return;
      if (!p.AccessPath && !p.AssignDriveLetter) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,Add-PartitionAccessPath' });
      const r = p.AssignDriveLetter ? WS.storage.assignLetter(t.n, t.pn, 'auto') : WS.storage.addAccessPath(t.n, t.pn, String(p.AccessPath));
      if (!r.ok) return accessError(ctx, r);
      if (p.PassThru) ctx.out(partObj(WS.storage.disk(t.n), WS.storage.disk(t.n).partitions.find(x => x.number === t.pn)));
    } });
  cmdlet({ name: 'Remove-PartitionAccessPath', module: ST, version: '2.0.0.0', synopsis: 'Removes an access path such as a drive letter or folder from a partition.', params: { ...accessParams, PassThru: { type: 'switch' } },
    process(ctx, p, item) {
      const t = partitionArg(ctx, p, item); if (!t) return;
      if (!p.AccessPath) ctx.throw({ message: "Cannot process command because of one or more missing mandatory parameters: AccessPath.", category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'MissingMandatoryParameter,Remove-PartitionAccessPath' });
      const r = WS.storage.removeAccessPath(t.n, t.pn, String(p.AccessPath));
      if (!r.ok) return accessError(ctx, r);
      if (p.PassThru) ctx.out(partObj(WS.storage.disk(t.n), WS.storage.disk(t.n).partitions.find(x => x.number === t.pn)));
    } });
  cmdlet({ name: 'Resize-Partition', module: ST, version: '2.0.0.0', params: { DriveLetter: { pos: 0, pipe: 'name' }, Size: { type: 'uint64', pos: 1, mandatory: true } },
    process(ctx, p) { const r = WS.storage.resize(p.DriveLetter, p.Size); if (!r.ok) cimError(ctx, r.error, { cls: 'MSFT_Partition', ns: 'ROOT/Microsoft/Windows/Storage', code: 40002, category: 'NotSpecified' }); } });
  cmdlet({ name: 'Get-PartitionSupportedSize', module: ST, version: '2.0.0.0', params: { DriveLetter: { pos: 0, pipe: 'name' } },
    process(ctx, p) { const s = WS.storage.supportedSize(p.DriveLetter); if (!s) return notFound(ctx, 'MSFT_Partition', 'DriveLetter', p.DriveLetter); ctx.out(psobj('Microsoft.Management.Infrastructure.CimMethodResult', { SizeMin: s.min, SizeMax: s.max })); } });

  /* ================================================================ Storage Spaces (WS.spaces) */
  const NS_ST = 'ROOT/Microsoft/Windows/Storage';
  const T_PD = 'Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_PhysicalDisk';
  const T_POOL = 'Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_StoragePool';
  const T_VD = 'Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_VirtualDisk';
  const T_SS = 'Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/Storage/MSFT_StorageSubSystem';
  const isType = re => v => re.test(PS.typeName(v));
  const shortSize = b => sizeText(b).replace('.00 ', ' ');
  const ssName = () => `Windows Storage on ${WS.sys.name}`;
  const pdObj = d => psobj(T_PD, {
    Number: d.deviceId === '' ? null : +d.deviceId, DeviceId: d.deviceId, FriendlyName: d.friendlyName, SerialNumber: '', UniqueId: d.uniqueId, MediaType: d.mediaType, CanPool: d.canPool,
    CannotPoolReason: d.cannotPoolReason, OperationalStatus: d.operationalStatus, HealthStatus: d.healthStatus, Usage: d.usageLabel, Size: d.size, AllocatedSize: d.allocated, BusType: d.busType,
    PhysicalLocation: `Integrated : Adapter 0 : Port 0 : Target 0 : LUN ${d.number}`, SpindleSpeed: 0, IsIndicationEnabled: false
  }, { str: d.friendlyName });
  view(T_PD, { table: { columns: [
    { label: 'Number', width: 6, align: 'right', value: 'Number' }, { label: 'FriendlyName', width: 17, value: 'FriendlyName' }, { label: 'SerialNumber', width: 12, value: 'SerialNumber' },
    { label: 'MediaType', width: 11, value: 'MediaType' }, { label: 'CanPool', width: 7, value: 'CanPool' }, { label: 'OperationalStatus', width: 18, value: 'OperationalStatus' },
    { label: 'HealthStatus', width: 12, value: 'HealthStatus' }, { label: 'Usage', width: 13, value: 'Usage' }, { label: 'Size', align: 'right', value: o => shortSize(o.Size) }] } });
  const poolObj = p => psobj(T_POOL, {
    FriendlyName: p.name, OperationalStatus: p.operationalStatus, HealthStatus: p.healthStatus, IsPrimordial: p.primordial, IsReadOnly: p.readOnly, Size: p.size, AllocatedSize: p.allocated,
    Description: p.description, ResiliencySettingNameDefault: 'Mirror', ProvisioningTypeDefault: 'Fixed', LogicalSectorSize: 512, PhysicalSectorSize: 4096, Version: p.primordial ? '' : 'Windows Server 2025'
  }, { str: p.name });
  view(T_POOL, { table: { columns: [
    { label: 'FriendlyName', width: 14, value: 'FriendlyName' }, { label: 'OperationalStatus', width: 17, value: 'OperationalStatus' }, { label: 'HealthStatus', width: 12, value: 'HealthStatus' },
    { label: 'IsPrimordial', width: 12, value: 'IsPrimordial' }, { label: 'IsReadOnly', width: 10, value: 'IsReadOnly' }, { label: 'Size', width: 8, align: 'right', value: o => shortSize(o.Size) },
    { label: 'AllocatedSize', align: 'right', value: o => shortSize(o.AllocatedSize) }] } });
  const vdObj = v => psobj(T_VD, {
    FriendlyName: v.name, ResiliencySettingName: v.layout, FaultDomainRedundancy: v.redundancy, OperationalStatus: v.operationalStatus, HealthStatus: v.healthStatus, Size: v.size,
    FootprintOnPool: v.footprint, StorageEfficiency: (v.efficiency * 100).toFixed(2) + '%', AllocatedSize: v.allocated, NumberOfDataCopies: v.copies, PhysicalDiskRedundancy: v.redundancy,
    NumberOfColumns: v.columns, ProvisioningType: v.provisioning, UniqueId: v.uniqueId, IsManualAttach: false, IsSnapshot: false, Usage: 'Data', DetachedReason: v.operationalStatus === 'Detached' ? 'Majority Disks Unhealthy' : 'None'
  }, { str: v.name });
  view(T_VD, { table: { columns: [
    { label: 'FriendlyName', width: 12, value: 'FriendlyName' }, { label: 'ResiliencySettingName', width: 21, value: 'ResiliencySettingName' }, { label: 'FaultDomainRedundancy', width: 21, value: 'FaultDomainRedundancy' },
    { label: 'OperationalStatus', width: 17, value: 'OperationalStatus' }, { label: 'HealthStatus', width: 12, value: 'HealthStatus' }, { label: 'Size', width: 7, align: 'right', value: o => shortSize(o.Size) },
    { label: 'FootprintOnPool', width: 15, align: 'right', value: o => shortSize(o.FootprintOnPool) }, { label: 'StorageEfficiency', align: 'right', value: 'StorageEfficiency' }] } });
  const ssObj = () => psobj(T_SS, { FriendlyName: ssName(), HealthStatus: 'Healthy', OperationalStatus: 'OK', Model: 'Windows Storage', Manufacturer: 'Microsoft Corporation', UniqueId: '{S:' + WS.sys.name + '}' }, { str: ssName() });
  view(T_SS, { table: { columns: [{ label: 'FriendlyName', width: 30, value: 'FriendlyName' }, { label: 'HealthStatus', width: 12, value: 'HealthStatus' }, { label: 'OperationalStatus', value: 'OperationalStatus' }] } });
  const spErr = (ctx, r, cls) => cimError(ctx, r.error, { cls, ns: NS_ST, code: r.code === 'NotEnoughSpace' || r.code === 'NotEnoughDisks' ? 40001 : r.code === 'Exists' ? 41000 : r.code === 'InUse' ? 49000 : 40000, category: r.code === 'NotFound' ? 'ObjectNotFound' : 'InvalidOperation' });
  /** -PhysicalDisks objects (or disk numbers) -> physical disk numbers. */
  function pdNumbers(list) {
    const all = WS.spaces.physicalDisks();
    return toArray(list).map(x => (typeof x === 'number' ? x : (all.find(d => d.uniqueId === getProp(x, 'UniqueId')) || {}).number)).filter(n => n != null);
  }
  /** The pool a cmdlet names: -StoragePoolFriendlyName / -FriendlyName, or a piped MSFT_StoragePool. */
  function poolArg(ctx, name, item) {
    const n = item && /MSFT_StoragePool/.test(PS.typeName(item)) ? getProp(item, 'FriendlyName') : name;
    if (n == null) { ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: StoragePoolFriendlyName.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'MissingMandatoryParameter' }); return null; }
    const p = WS.spaces.pool(n);
    if (!p) { if (!/^primordial$/i.test(n)) notFound(ctx, 'MSFT_StoragePool', 'FriendlyName', n); else cimError(ctx, 'The operation is not supported on a primordial storage pool.', { cls: 'MSFT_StoragePool', ns: NS_ST, code: 1, category: 'InvalidOperation' }); return null; }
    return p;
  }
  /** Virtual disks a cmdlet names: -FriendlyName (wildcards) or a piped MSFT_VirtualDisk. */
  function vdArgs(ctx, names, item) {
    if (item && /MSFT_VirtualDisk/.test(PS.typeName(item))) { const v = WS.spaces.space(getProp(item, 'FriendlyName')); return v ? [v] : []; }
    const all = WS.spaces.spaces();
    if (names == null) return all;
    const out = [];
    for (const n of toArray(names)) { const hit = all.filter(v => wild(n, v.name)); if (!hit.length && !hasWild(n)) notFound(ctx, 'MSFT_VirtualDisk', 'FriendlyName', n); out.push(...hit); }
    return out;
  }
  const pdPipe = { type: 'object', pipe: 'value', accepts: isType(/MSFT_PhysicalDisk/) }, poolPipe = { type: 'object', pipe: 'value', accepts: isType(/MSFT_StoragePool/) }, vdPipe = { type: 'object', pipe: 'value', accepts: isType(/MSFT_VirtualDisk/) };

  cmdlet({ name: 'Get-StorageSubSystem', module: ST, version: '2.0.0.0', synopsis: 'Gets one or more storage subsystem objects.', params: { FriendlyName: { type: 'string[]', pos: 0 } },
    process(ctx, p) {
      if (p.FriendlyName && !p.FriendlyName.some(n => wild(n, ssName()))) return notFound(ctx, 'MSFT_StorageSubSystem', 'FriendlyName', p.FriendlyName[0]);
      ctx.out(ssObj());
    } });
  cmdlet({ name: 'Get-PhysicalDisk', module: ST, version: '2.0.0.0', synopsis: 'Gets a list of all PhysicalDisk objects visible across any available Storage Management Providers.',
    params: { FriendlyName: { type: 'string[]', pos: 0 }, UniqueId: { type: 'string[]' }, CanPool: { type: 'bool' }, Usage: {}, HealthStatus: {}, DeviceNumber: { type: 'int[]' }, StoragePool: poolPipe, VirtualDisk: vdPipe },
    process(ctx, p) {
      let list = WS.spaces.physicalDisks();
      if (p.StoragePool) { const name = getProp(p.StoragePool, 'FriendlyName'); list = getProp(p.StoragePool, 'IsPrimordial') ? list.filter(d => !d.pool) : list.filter(d => d.pool && d.pool.toLowerCase() === String(name).toLowerCase()); }
      if (p.VirtualDisk) { const v = WS.spaces.space(getProp(p.VirtualDisk, 'FriendlyName')); list = v ? list.filter(d => v.disks.includes(d.number)) : []; }
      if (p.FriendlyName) list = list.filter(d => p.FriendlyName.some(n => wild(n, d.friendlyName)));
      if (p.UniqueId) list = list.filter(d => p.UniqueId.some(n => wild(n, d.uniqueId)));
      if (p.DeviceNumber) list = list.filter(d => p.DeviceNumber.includes(d.number) && !d.failed);
      if (p.CanPool != null) list = list.filter(d => d.canPool === !!p.CanPool);
      if (p.Usage) list = list.filter(d => d.usage.toLowerCase() === String(p.Usage).toLowerCase().replace('-', ''));
      if (p.HealthStatus) list = list.filter(d => d.healthStatus.toLowerCase() === String(p.HealthStatus).toLowerCase());
      if (!list.length && p.FriendlyName && !p.FriendlyName.some(hasWild)) return notFound(ctx, 'MSFT_PhysicalDisk', 'FriendlyName', p.FriendlyName[0]);
      list.forEach(d => ctx.out(pdObj(d)));
    } });
  cmdlet({ name: 'Set-PhysicalDisk', module: ST, version: '2.0.0.0', synopsis: 'Sets attributes on a specific physical disk.',
    params: { InputObject: pdPipe, UniqueId: {}, FriendlyName: { pos: 0 }, Usage: { type: 'enum', values: ['AutoSelect', 'ManualSelect', 'HotSpare', 'Retired', 'Journal'] }, MediaType: { type: 'enum', values: ['Unspecified', 'HDD', 'SSD', 'SCM'] } },
    process(ctx, p, item) {
      let nums;
      if (item || p.InputObject) nums = pdNumbers([item || p.InputObject]);
      else if (p.UniqueId) nums = pdNumbers(WS.spaces.physicalDisks().filter(d => wild(p.UniqueId, d.uniqueId)).map(d => d.number));
      else if (p.FriendlyName) { const hit = WS.spaces.physicalDisks().filter(d => wild(p.FriendlyName, d.friendlyName)); if (hit.length > 1) return cimError(ctx, 'More than one physical disk has this friendly name. Use -UniqueId or pipe the disk from Get-PhysicalDisk.', { cls: 'MSFT_PhysicalDisk', ns: NS_ST, code: 87 }); nums = hit.map(d => d.number); }
      if (!nums || !nums.length) return notFound(ctx, 'MSFT_PhysicalDisk', p.UniqueId ? 'UniqueId' : 'FriendlyName', p.UniqueId || p.FriendlyName);
      for (const n of nums) { const r = WS.spaces.setDisk(n, { usage: p.Usage, mediaType: p.MediaType }); if (!r.ok) spErr(ctx, r, 'MSFT_PhysicalDisk'); }
    } });
  cmdlet({ name: 'Get-StoragePool', module: ST, version: '2.0.0.0', synopsis: 'Gets a specific storage pool, or a set of StoragePool objects either from all storage subsystems or from a specific storage subsystem.',
    params: { FriendlyName: { type: 'string[]', pos: 0 }, IsPrimordial: { type: 'bool' }, PhysicalDisk: pdPipe, VirtualDisk: vdPipe },
    process(ctx, p) {
      let list = [WS.spaces.primordial(), ...WS.spaces.pools()];
      if (p.PhysicalDisk) { const d = WS.spaces.physicalDisk(pdNumbers([p.PhysicalDisk])[0]); list = list.filter(x => (d && d.pool ? x.name === d.pool : x.primordial)); }
      if (p.VirtualDisk) { const v = WS.spaces.space(getProp(p.VirtualDisk, 'FriendlyName')); list = list.filter(x => v && x.name === v.pool); }
      if (p.IsPrimordial != null) list = list.filter(x => x.primordial === !!p.IsPrimordial);
      if (p.FriendlyName) {
        for (const n of p.FriendlyName) if (!hasWild(n) && !list.some(x => wild(n, x.name))) notFound(ctx, 'MSFT_StoragePool', 'FriendlyName', n);
        list = list.filter(x => p.FriendlyName.some(n => wild(n, x.name)));
      }
      list.forEach(x => ctx.out(poolObj(x)));
    } });
  cmdlet({ name: 'New-StoragePool', module: ST, version: '2.0.0.0', synopsis: 'Creates a new storage pool using a group of physical disks.',
    params: { FriendlyName: { mandatory: true }, StorageSubSystemFriendlyName: { pos: 0 }, StorageSubSystemName: {}, StorageSubSystemUniqueId: {}, InputObject: { type: 'object', pipe: 'value', accepts: isType(/MSFT_StorageSubSystem/) },
      PhysicalDisks: { type: 'object[]', mandatory: true }, Description: {}, ResiliencySettingNameDefault: {}, ProvisioningTypeDefault: {}, LogicalSectorSizeDefault: { type: 'long' } },
    process(ctx, p, item) {
      const ss = p.StorageSubSystemFriendlyName || p.StorageSubSystemName;
      if (!item && !p.StorageSubSystemUniqueId && ss == null) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,New-StoragePool' });
      if (ss != null && !wild(ss, ssName()) && !wild(ss, 'Windows Storage')) return notFound(ctx, 'MSFT_StorageSubSystem', 'FriendlyName', ss);
      const r = WS.spaces.newPool({ name: p.FriendlyName, disks: pdNumbers(p.PhysicalDisks), description: p.Description });
      if (!r.ok) return spErr(ctx, r, 'MSFT_StorageSubSystem');
      ctx.out(poolObj(r.pool));
    } });
  cmdlet({ name: 'Set-StoragePool', module: ST, version: '2.0.0.0', params: { FriendlyName: { pos: 0 }, InputObject: poolPipe, NewFriendlyName: {}, Description: {} },
    process(ctx, p, item) { const pool = poolArg(ctx, p.FriendlyName, item || p.InputObject); if (!pool) return; const r = WS.spaces.setPool(pool.name, { newName: p.NewFriendlyName, description: p.Description }); if (!r.ok) spErr(ctx, r, 'MSFT_StoragePool'); } });
  cmdlet({ name: 'Remove-StoragePool', module: ST, version: '2.0.0.0', shouldProcess: true, impact: 'High', params: { FriendlyName: { pos: 0 }, InputObject: poolPipe },
    async process(ctx, p, item) {
      const pool = poolArg(ctx, p.FriendlyName, item || p.InputObject); if (!pool) return;
      if (!(await ctx.confirm('Remove-StoragePool', pool.name, { impact: 'High', query: `Are you sure you want to perform this action?\nThis will remove the StoragePool "${pool.name}".` }))) return;
      const r = WS.spaces.removePool(pool.name); if (!r.ok) spErr(ctx, r, 'MSFT_StoragePool');
    } });
  cmdlet({ name: 'Add-PhysicalDisk', module: ST, version: '2.0.0.0', synopsis: 'Adds a physical disk to the specified storage pool or manually assigns a physical disk to a specific virtual disk.',
    params: { StoragePoolFriendlyName: {}, InputObject: poolPipe, PhysicalDisks: { type: 'object[]', mandatory: true }, Usage: { type: 'enum', values: ['AutoSelect', 'ManualSelect', 'HotSpare', 'Journal'] } },
    process(ctx, p, item) {
      const pool = poolArg(ctx, p.StoragePoolFriendlyName, item || p.InputObject); if (!pool) return;
      const r = WS.spaces.addDisks(pool.name, pdNumbers(p.PhysicalDisks), p.Usage); if (!r.ok) spErr(ctx, r, 'MSFT_StoragePool');
    } });
  cmdlet({ name: 'Remove-PhysicalDisk', module: ST, version: '2.0.0.0', shouldProcess: true, impact: 'High', params: { StoragePoolFriendlyName: {}, InputObject: poolPipe, PhysicalDisks: { type: 'object[]', mandatory: true } },
    async process(ctx, p, item) {
      const pool = poolArg(ctx, p.StoragePoolFriendlyName, item || p.InputObject); if (!pool) return;
      for (const n of pdNumbers(p.PhysicalDisks)) {
        if (!(await ctx.confirm('Remove-PhysicalDisk', `Msft Virtual Disk`, { impact: 'High', query: `Are you sure you want to perform this action?\nRemoving a physical disk will cause problems with the fault tolerance capabilities of StoragePool "${pool.name}".` }))) continue;
        const r = WS.spaces.removeDisk(pool.name, n); if (!r.ok) spErr(ctx, r, 'MSFT_StoragePool');
      }
    } });
  cmdlet({ name: 'New-VirtualDisk', module: ST, version: '2.0.0.0', synopsis: 'Creates a new virtual disk in the specified storage pool.',
    params: { StoragePoolFriendlyName: {}, InputObject: poolPipe, FriendlyName: { mandatory: true }, ResiliencySettingName: { type: 'enum', values: ['Simple', 'Mirror', 'Parity'] },
      NumberOfDataCopies: { type: 'int' }, PhysicalDiskRedundancy: { type: 'int' }, ProvisioningType: { type: 'enum', values: ['Thin', 'Fixed'] }, Size: { type: 'uint64' }, UseMaximumSize: { type: 'switch' },
      NumberOfColumns: { type: 'int' }, Interleave: { type: 'long' }, StorageTiers: { type: 'object[]' }, StorageTierSizes: { type: 'object[]' } },
    process(ctx, p, item) {
      const pool = poolArg(ctx, p.StoragePoolFriendlyName, item || p.InputObject); if (!pool) return;
      if (p.StorageTiers) return cimError(ctx, 'Storage tiers are not available in the lab simulator.', { cls: 'MSFT_StoragePool', ns: NS_ST, code: 1, category: 'NotImplemented' });
      if (!p.Size && !p.UseMaximumSize) ctx.throw({ message: 'Parameter set cannot be resolved using the specified named parameters.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'AmbiguousParameterSet,New-VirtualDisk' });
      const layout = p.ResiliencySettingName || 'Mirror';
      const red = layout === 'Mirror' ? (p.NumberOfDataCopies ? p.NumberOfDataCopies - 1 : p.PhysicalDiskRedundancy || 1) : layout === 'Parity' ? p.PhysicalDiskRedundancy || 1 : 0;
      const r = WS.spaces.newSpace({ pool: pool.name, name: p.FriendlyName, layout, redundancy: red, provisioning: p.ProvisioningType || 'Fixed', size: p.UseMaximumSize ? 'max' : p.Size });
      if (!r.ok) return spErr(ctx, r, 'MSFT_StoragePool');
      ctx.out(vdObj(r.space));
    } });
  cmdlet({ name: 'Get-VirtualDisk', module: ST, version: '2.0.0.0', synopsis: 'Returns a list of VirtualDisk objects, across all storage pools, across all providers, or optionally a filtered subset based on provided criteria.',
    params: { FriendlyName: { type: 'string[]', pos: 0 }, StoragePool: poolPipe, PhysicalDisk: pdPipe, Disk: { type: 'object', pipe: 'value', accepts: isType(/MSFT_Disk/) } },
    process(ctx, p) {
      let list = vdArgs(ctx, p.FriendlyName, null);
      if (p.StoragePool) list = list.filter(v => v.pool.toLowerCase() === String(getProp(p.StoragePool, 'FriendlyName')).toLowerCase());
      if (p.PhysicalDisk) { const n = pdNumbers([p.PhysicalDisk])[0]; list = list.filter(v => v.disks.includes(n)); }
      if (p.Disk) list = list.filter(v => v.disk === getProp(p.Disk, 'Number'));
      list.forEach(v => ctx.out(vdObj(v)));
    } });
  cmdlet({ name: 'Remove-VirtualDisk', module: ST, version: '2.0.0.0', shouldProcess: true, impact: 'High', params: { FriendlyName: { type: 'string[]', pos: 0 }, InputObject: vdPipe },
    async process(ctx, p, item) {
      for (const v of vdArgs(ctx, p.FriendlyName, item || p.InputObject)) {
        if (!(await ctx.confirm('Remove-VirtualDisk', v.name, { impact: 'High', query: `Are you sure you want to perform this action?\nThis will remove the VirtualDisk "${v.name}".` }))) continue;
        const r = WS.spaces.removeSpace(v.name); if (!r.ok) spErr(ctx, r, 'MSFT_VirtualDisk');
      }
    } });
  cmdlet({ name: 'Resize-VirtualDisk', module: ST, version: '2.0.0.0', params: { FriendlyName: { pos: 0 }, InputObject: vdPipe, Size: { type: 'uint64', mandatory: true } },
    process(ctx, p, item) { for (const v of vdArgs(ctx, p.FriendlyName, item || p.InputObject)) { const r = WS.spaces.resizeSpace(v.name, p.Size); if (!r.ok) spErr(ctx, r, 'MSFT_VirtualDisk'); } } });
  cmdlet({ name: 'Repair-VirtualDisk', module: ST, version: '2.0.0.0', synopsis: 'Repairs a virtual disk.', params: { FriendlyName: { type: 'string[]', pos: 0 }, InputObject: vdPipe, AsJob: { type: 'switch' } },
    async process(ctx, p, item) {
      for (const v of vdArgs(ctx, p.FriendlyName, item || p.InputObject)) {
        ctx.progress({ activity: 'Repair-VirtualDisk', status: `Repairing ${v.name}`, percent: 50 });
        await ctx.sleep(300);
        const r = WS.spaces.repair(v.name); if (!r.ok) spErr(ctx, r, 'MSFT_VirtualDisk');
      }
    } });
  cmdlet({ name: 'Get-StorageJob', module: ST, version: '2.0.0.0', synopsis: 'Returns information about long-running Storage module jobs, such as a repair task.', params: { Name: { type: 'string[]', pos: 0 } }, process() {} });

  /* ================================================================ SMB */
  const SMB = 'SmbShare';
  const principals = ['Everyone', 'Authenticated Users', 'Administrators', 'Users', 'Guests', 'SYSTEM', 'NETWORK SERVICE', 'LOCAL SERVICE', 'INTERACTIVE', 'CREATOR OWNER', 'Backup Operators', 'Remote Desktop Users'];
  /** Validate an account the way SMB does (otherwise "No mapping between account names and security IDs was done."). */
  function accountExists(a) {
    const n = String(a).replace(/^(BUILTIN|NT AUTHORITY|[^\\]+)\\/i, '');
    if (principals.some(x => x.toLowerCase() === n.toLowerCase())) return true;
    if (WS.sys.isDC()) return !!WS.ad.resolveIdentity(n) || !!WS.ad.get(n);
    return !!WS.local.user(n) || !!WS.local.group(n);
  }
  const shareObj = s => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/SMB/MSFT_SmbShare', { Name: s.name, ScopeName: '*', Path: s.path, Description: s.description, CurrentUsers: 0, ShareState: 'Online', FolderEnumerationMode: s.folderEnumerationMode || 'Unrestricted', CachingMode: s.cachingMode || 'Manual', ConcurrentUserLimit: s.concurrentUserLimit || 0, EncryptData: !!s.encryptData, Special: !!s.special }, { str: s.name });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/SMB/MSFT_SmbShare', { table: { columns: [{ label: 'Name', width: 6, value: 'Name' }, { label: 'ScopeName', width: 9, value: 'ScopeName' }, { label: 'Path', width: 33, value: 'Path' }, { label: 'Description', value: 'Description' }] } });
  const accessObj = (s, a) => psobj('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/SMB/MSFT_SmbShareAccessControlEntry', { Name: s.name, ScopeName: '*', AccountName: /\\/.test(a.account) || /^(Everyone)$/i.test(a.account) ? a.account : (WS.sys.isDC() ? WS.ad.netbios() : (principals.includes(a.account) ? 'BUILTIN' : WS.sys.name)) + '\\' + a.account, AccessControlType: a.type, AccessRight: a.right });
  view('Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/SMB/MSFT_SmbShareAccessControlEntry', { table: { columns: [{ label: 'Name', width: 6, value: 'Name' }, { label: 'ScopeName', width: 9, value: 'ScopeName' }, { label: 'AccountName', width: 25, value: 'AccountName' }, { label: 'AccessControlType', width: 17, value: 'AccessControlType' }, { label: 'AccessRight', value: 'AccessRight' }] } });
  const smbErr = (ctx, msg, code, category = 'NotSpecified') => cimError(ctx, msg, { cls: 'MSFT_SMBShare', ns: 'ROOT/Microsoft/Windows/SMB', code, category });
  cmdlet({ name: 'Get-SmbShare', module: SMB, version: '2.0.0.0', synopsis: 'Retrieves the Server Message Block (SMB) shares on the computer.', params: { Name: { type: 'string[]', pos: 0, pipe: 'name' }, Special: { type: 'bool' } },
    process(ctx, p) {
      for (const n of p.Name || ['*']) {
        const hits = WS.smb.shares().filter(s => wild(n, s.name));
        if (!hits.length && !hasWild(n)) notFound(ctx, 'MSFT_SMBShare', 'Name', n);
        hits.forEach(s => ctx.out(shareObj(s)));
      }
    } });
  cmdlet({ name: 'New-SmbShare', module: SMB, version: '2.0.0.0', shouldProcess: true, synopsis: 'Creates an SMB share.',
    params: { Name: { pos: 0, mandatory: true }, Path: { pos: 1, mandatory: true }, Description: {}, FullAccess: { type: 'string[]' }, ChangeAccess: { type: 'string[]' }, ReadAccess: { type: 'string[]' }, NoAccess: { type: 'string[]' }, FolderEnumerationMode: { type: 'enum', values: ['AccessBased', 'Unrestricted'] }, CachingMode: {}, ConcurrentUserLimit: { type: 'int' }, EncryptData: { type: 'bool' }, ContinuouslyAvailable: { type: 'bool' }, Temporary: { type: 'switch' } },
    async process(ctx, p) {
      for (const a of [...(p.FullAccess || []), ...(p.ChangeAccess || []), ...(p.ReadAccess || []), ...(p.NoAccess || [])]) if (!accountExists(a)) return smbErr(ctx, 'No mapping between account names and security IDs was done.', 1332);
      if (!(await ctx.confirm('New-SmbShare', p.Name))) return;
      const r = WS.smb.newShare({ name: p.Name, path: ctx.resolvePath(p.Path), description: p.Description, fullAccess: p.FullAccess, changeAccess: p.ChangeAccess, readAccess: p.ReadAccess, noAccess: p.NoAccess, folderEnumerationMode: p.FolderEnumerationMode, cachingMode: p.CachingMode, concurrentUserLimit: p.ConcurrentUserLimit, encryptData: p.EncryptData });
      if (!r.ok) return smbErr(ctx, r.code === 'Exists' ? 'The name has already been shared.' : r.code === 'PathNotFound' ? 'The system cannot find the file specified.' : r.error, r.code === 'Exists' ? 2118 : r.code === 'PathNotFound' ? 2 : 87, r.code === 'Exists' ? 'ResourceExists' : r.code === 'PathNotFound' ? 'ObjectNotFound' : 'InvalidArgument');
      ctx.out(shareObj(r.share));
    } });
  cmdlet({ name: 'Remove-SmbShare', module: SMB, version: '2.0.0.0', shouldProcess: true, impact: 'High', params: { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      for (const n of p.Name) {
        const s = WS.smb.get(n);
        if (!s) { notFound(ctx, 'MSFT_SMBShare', 'Name', n); continue; }
        if (!p.Force && !(await ctx.confirm('Remove-Share', `*,${s.name}`, { impact: 'High', query: `Are you sure you want to perform this action?\nPerforming operation 'Remove-Share' on Target '*,${s.name}'.` }))) continue;
        const r = WS.smb.removeShare(s.name);
        if (!r.ok) smbErr(ctx, r.error, 5, 'PermissionDenied');
      }
    } });
  cmdlet({ name: 'Set-SmbShare', module: SMB, version: '2.0.0.0', shouldProcess: true, params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, Description: {}, FolderEnumerationMode: { type: 'enum', values: ['AccessBased', 'Unrestricted'] }, CachingMode: {}, ConcurrentUserLimit: { type: 'int' }, EncryptData: { type: 'bool' }, Force: { type: 'switch' } },
    async process(ctx, p) {
      const s = WS.smb.get(p.Name);
      if (!s) return notFound(ctx, 'MSFT_SMBShare', 'Name', p.Name);
      if (!p.Force && !(await ctx.confirm('Modify', `*,${s.name}`, { impact: 'High', query: `Are you sure you want to perform this action?\nPerforming operation 'Modify' on Target '*,${s.name}'.` }))) return;
      WS.smb.setShare(s.name, { ...(p.Description != null ? { description: p.Description } : {}), ...(p.FolderEnumerationMode ? { folderEnumerationMode: p.FolderEnumerationMode } : {}), ...(p.CachingMode ? { cachingMode: p.CachingMode } : {}), ...(p.ConcurrentUserLimit != null ? { concurrentUserLimit: p.ConcurrentUserLimit } : {}), ...(p.EncryptData != null ? { encryptData: !!p.EncryptData } : {}) });
    } });
  cmdlet({ name: 'Get-SmbShareAccess', module: SMB, version: '2.0.0.0', params: { Name: { type: 'string[]', pos: 0, mandatory: true, pipe: 'name' } },
    process(ctx, p) { for (const n of p.Name) { const s = WS.smb.get(n); if (!s) { notFound(ctx, 'MSFT_SMBShare', 'Name', n); continue; } s.access.forEach(a => ctx.out(accessObj(s, a))); } } });
  const accessCmd = (name, fn, needRight) => cmdlet({ name, module: SMB, version: '2.0.0.0', shouldProcess: true, impact: 'High',
    params: { Name: { pos: 0, mandatory: true, pipe: 'name' }, AccountName: { type: 'string[]', mandatory: true }, ...(needRight ? { AccessRight: { type: 'enum', values: ['Full', 'Change', 'Read', 'Custom'], enumType: 'Microsoft.PowerShell.Cmdletization.GeneratedTypes.SmbShare.ShareAccessRight' } } : {}), Force: { type: 'switch' } },
    async process(ctx, p) {
      const s = WS.smb.get(p.Name);
      if (!s) return notFound(ctx, 'MSFT_SMBShare', 'Name', p.Name);
      if (needRight && !p.AccessRight) ctx.throw({ message: 'Cannot process command because of one or more missing mandatory parameters: AccessRight.', category: 'InvalidArgument', exception: 'ParameterBindingException', id: 'MissingMandatoryParameter,' + name });
      for (const a of p.AccountName) if (!accountExists(a)) return smbErr(ctx, 'No mapping between account names and security IDs was done.', 1332);
      if (!p.Force && !(await ctx.confirm('Modify', `*,${s.name}`, { impact: 'High', query: `Are you sure you want to perform this action?\nPerforming operation 'Modify' on Target '*,${s.name}'.` }))) return;
      for (const a of p.AccountName) fn(s.name, a, p.AccessRight);
      WS.smb.get(s.name).access.forEach(a => ctx.out(accessObj(s, a)));
    } });
  accessCmd('Grant-SmbShareAccess', (n, a, r) => WS.smb.grantAccess(n, a, r), true);
  accessCmd('Revoke-SmbShareAccess', (n, a) => WS.smb.revokeAccess(n, a), false);
  accessCmd('Block-SmbShareAccess', (n, a) => WS.smb.blockAccess(n, a), false);
  accessCmd('Unblock-SmbShareAccess', (n, a) => { const s = WS.smb.get(n); s.access = s.access.filter(x => !(x.type === 'Deny' && x.account.toLowerCase() === a.toLowerCase())); WS.store.changed('smb'); }, false);
  /* SMB mappings (the client side): the same connections as net use and Group Policy Drive Maps */
  const MAPCLS = 'Microsoft.Management.Infrastructure.CimInstance#ROOT/Microsoft/Windows/SMB/MSFT_SmbMapping';
  const mapObj = d => psobj(MAPCLS, { Status: WS.netuse.status(d), LocalPath: d.letter + ':', RemotePath: d.remote, RequireIntegrity: false, RequirePrivacy: false, UseWriteThrough: false, UserName: WS.sys.isDC() ? `${WS.ad.netbios()}\\Administrator` : `${WS.sys.name}\\Administrator`, Persistent: !!d.persistent }, { str: d.letter + ':' });
  view(MAPCLS, { table: { columns: [{ label: 'Status', width: 12, value: 'Status' }, { label: 'Local Path', width: 10, value: 'LocalPath' }, { label: 'Remote Path', value: 'RemotePath' }] } });
  const mapErr = (ctx, r) => cimError(ctx, r.error, { cls: 'MSFT_SmbMapping', ns: 'ROOT/Microsoft/Windows/SMB', code: r.sys, category: r.code === 'InUse' ? 'ResourceExists' : r.code === 'NotFound' ? 'ObjectNotFound' : 'NotSpecified' });
  const mappingsFor = p => WS.netuse.list().filter(d => (!p.LocalPath || wild(String(p.LocalPath).replace(/:?$/, ':'), d.letter + ':')) && (!p.RemotePath || wild(p.RemotePath, d.remote)));
  cmdlet({ name: 'Get-SmbMapping', module: SMB, version: '2.0.0.0', synopsis: 'Retrieves the SMB client directory mappings created for a server.', params: { LocalPath: { pos: 0 }, RemotePath: { pos: 1 } },
    process(ctx, p) {
      const hits = mappingsFor(p);
      if (!hits.length && (p.LocalPath || p.RemotePath) && !hasWild(String(p.LocalPath || p.RemotePath))) return notFound(ctx, 'MSFT_SmbMapping', p.LocalPath ? 'LocalPath' : 'RemotePath', p.LocalPath || p.RemotePath);
      hits.forEach(d => ctx.out(mapObj(d)));
    } });
  cmdlet({ name: 'New-SmbMapping', module: SMB, version: '2.0.0.0', shouldProcess: true, synopsis: 'Creates an SMB mapping.',
    params: { LocalPath: { pos: 0 }, RemotePath: { pos: 1, mandatory: true }, UserName: {}, Password: {}, Persistent: { type: 'bool' }, SaveCredentials: { type: 'switch' }, HomeFolder: { type: 'switch' }, RequireIntegrity: { type: 'bool' }, RequirePrivacy: { type: 'bool' }, UseWriteThrough: { type: 'bool' } },
    process(ctx, p) {
      const letter = p.LocalPath ? String(p.LocalPath).replace(/:$/, '') : null;
      const r = WS.netuse.connect(letter, p.RemotePath, { persistent: !!p.Persistent });
      if (!r.ok) return mapErr(ctx, r);
      if (r.drive) ctx.out(mapObj(r.drive));
    } });
  cmdlet({ name: 'Remove-SmbMapping', module: SMB, version: '2.0.0.0', shouldProcess: true, params: { LocalPath: { pos: 0 }, RemotePath: { pos: 1 }, Force: { type: 'switch' }, UpdateProfile: { type: 'switch' } },
    async process(ctx, p) {
      const hits = mappingsFor(p);
      if (!hits.length) return notFound(ctx, 'MSFT_SmbMapping', p.LocalPath ? 'LocalPath' : 'RemotePath', p.LocalPath || p.RemotePath || '*');
      for (const d of hits) {
        if (!p.Force && !(await ctx.confirm('Remove-SmbMapping', `${d.letter}:,${d.remote}`, { impact: 'High', query: `Are you sure you want to perform this action?\nPerforming operation 'Remove-SmbMapping' on Target '${d.letter}:,${d.remote}'.` }))) continue;
        WS.netuse.disconnect(d.letter);
      }
    } });
  cmdlet({ name: 'Get-SmbSession', module: SMB, version: '2.0.0.0', process() {} });
  cmdlet({ name: 'Get-SmbConnection', module: SMB, version: '2.0.0.0', process() {} });

  PS.helpers.accountExists = accountExists;
})();
