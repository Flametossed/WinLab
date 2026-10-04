/* Starting points shared by the built-in labs. Each takes the lab's fresh state s (see WS.labs.start) and builds it
 * with the real model functions, so a lab begins exactly where the earlier labs leave a student. */
(function () {
  'use strict';
  const WS = window.WS;
  /** DC01 with a static address 192.168.1.10/24 and the router as its DNS server: what Lab 01 produces. */
  function configured(s) {
    WS.labs.withState(s, () => {
      s.system.computerName = 'DC01';
      s.system.workgroup = 'WORKGROUP';
      WS.net.setStatic('Ethernet', { ip: '192.168.1.10', prefix: 24, gateway: '192.168.1.1' });
      WS.net.setDnsServers('Ethernet', ['192.168.1.1']);
    });
  }
  /** DC01 promoted to the first domain controller of contoso.local (AD DS + DNS), as Lab 02 leaves it. */
  function domainController(s) {
    configured(s);
    WS.labs.withState(s, () => {
      WS.features.install(['AD-Domain-Services'], { includeManagementTools: true });
      const r = WS.ad.installForest({ domainName: 'contoso.local', safeModePassword: 'Restore-P@ss2025', noReboot: true });
      if (!r.ok) throw new Error(r.error);
    });
  }
  WS.labs.fixtures = { configured, domainController };
})();
