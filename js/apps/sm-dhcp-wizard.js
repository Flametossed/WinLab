/* DHCP Post-Install configuration wizard ("Complete DHCP configuration" on the notifications flag).
 * Commit runs WS.dhcp.completeConfiguration: security groups (domain or local), service restart and, on a domain
 * controller, authorization in AD unless "Skip AD authorization" is chosen. WS.sm.dhcpConfig(opts). */
(function () {
  'use strict';
  const WS = window.WS;
  const h = WS.h, U = WS.util, I = WS.icons, F = () => WS.ui.f;

  function launch(opts = {}) {
    const existing = WS.wm.find('dhcpconfig');
    if (existing) { existing.restore(); return null; }
    if (!WS.features.isInstalled('DHCP')) { WS.ui.msgbox({ title: 'DHCP Post-Install configuration wizard', icon: 'error', message: 'The DHCP Server role is not installed on this server.' }); return null; }
    const dc = WS.sys.isDC();
    const d = { auth: 'current' };
    const steps = () => [
      ['Security Groups creation', 'groups'],
      ['Restarting DHCP server service', 'restart'],
      dc ? ['Authorizing DHCP server', 'auth'] : null
    ].filter(Boolean);
    const stepList = status => h('div.wz-steps', ...steps().map(([label, key]) => h('div.st', h('span', label), h('b', status[key] || ''))));

    const pages = [
      {
        id: 'desc', nav: 'Description', title: 'Description',
        render: () => h('div.wz-text',
          h('p', 'The following steps will be performed to complete the installation of DHCP server on target computer:'),
          h('p', 'Create the following security groups for delegation of DHCP Server Administration.'),
          h('ul', h('li', 'DHCP Administrators'), h('li', 'DHCP Users')),
          h('p', 'Authorize DHCP server on target computer (if the computer is domain joined).'),
          h('p', "Click 'Next' to continue."))
      },
      {
        id: 'auth', nav: 'Authorization', title: 'Authorization', skip: () => !dc,
        render: () => {
          const user = `${WS.ad.netbios()}\\${(WS.session && WS.session.user) || 'Administrator'}`;
          const alt = F().text({ disabled: true });
          const radio = (key, text) => F().radio('dhcpauth', text, d.auth === key, { onChange: v => { if (v) { d.auth = key; alt.disabled = key !== 'alt'; } } });
          return h('div.wz-text',
            h('p', 'Specify the credentials to be used to authorize this DHCP server in AD DS.'),
            radio('current', "Use the following user's credentials"), h('div', { style: 'padding-left:22px' }, F().row('User Name:', F().text({ value: user, readOnly: true }), { labelWidth: 80 })),
            radio('alt', 'Use alternate credentials'), h('div', { style: 'padding-left:22px' }, F().row('User Name:', h('span', { style: 'display:flex;gap:6px;flex:1' }, alt, F().button('Specify...', () => {}, { disabled: true })), { labelWidth: 80 })),
            radio('skip', 'Skip AD authorization'));
        },
        validate: () => (d.auth === 'alt' ? 'Specify the alternate credentials, or choose another option.' : null)
      },
      {
        id: 'summary', nav: 'Summary', title: 'Summary', finish: true, rerender: true,
        render: () => h('div.wz-text', h('p', 'The status of the post-install configuration steps are indicated below:'), stepList({}), h('p', "Click 'Commit' to perform these steps."))
      },
      {
        id: 'done', navHidden: true, navAs: 'summary', title: 'Summary', rerender: true,
        render: () => h('div.wz-text', h('p', 'The status of the post-install configuration steps are indicated below:'), stepList(d.status || {}),
          d.error ? h('div.wz-banner.err', h('span', { html: I.eventError }), h('div.t', d.error)) : null)
      }
    ];
    return WS.ui.wizard({
      title: 'DHCP Post-Install configuration wizard', style: 'server', asWindow: true, app: 'dhcpconfig', icon: I.scope, width: 720, height: 520,
      destination: ' ', finishLabel: 'Commit', pages, data: d,
      onCreate: w => { if (opts.onCreate) opts.onCreate(w, d); },
      onFinish: async () => {
        await U.sleep(500);
        const authorize = dc && d.auth !== 'skip';
        const r = WS.dhcp.completeConfiguration({ authorize });
        d.status = r.ok
          ? { groups: 'Done', restart: 'Done', auth: authorize ? 'Done' : 'Skipped' }
          : { groups: 'Failed', restart: '', auth: '' };
        if (!r.ok) d.error = r.error;
        else WS.sm.notify({ title: 'DHCP post-deployment configuration', message: `DHCP Server configuration completed successfully on ${WS.sys.fqdn()}.`, status: 'done' });
        return null;
      }
    });
  }

  WS.sm.dhcpConfig = launch;
})();
