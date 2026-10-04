/* Entry point. ?quick=1 skips boot/OOBE/lock and signs straight in (used for headless testing). */
(function () {
  'use strict';
  const WS = window.WS;
  WS.store.load();
  const params = new URLSearchParams(location.search);
  if (params.get('quick') === '1') {
    if (!WS.state.meta.oobeDone) { WS.state.system.adminPassword = 'P@ssw0rd!'; WS.state.meta.oobeDone = true; }
    WS.sys.onBoot();
    WS.shell.startSession('Administrator');
  } else {
    WS.shell.boot();
  }
})();
