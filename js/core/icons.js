/* Icons: WS.icons.<name> is an inline SVG string (original simplified drawings, not Microsoft assets).
 * Gradients live once in a shared, never-hidden <defs> sprite (#ws-svg-defs) and are referenced as
 * url(#wsg-...). Icons must not define their own ids: a duplicate id inside an element that is later
 * hidden (display:none) breaks every other copy of the icon.
 * Shell icons are 32-unit; the console set (tree/list/toolbar/actions) is drawn on a 16-unit grid. */
(function () {
  'use strict';
  const WS = window.WS;

  const DEFS = `
    <linearGradient id="wsg-folder" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd768"/><stop offset="1" stop-color="#f2b631"/></linearGradient>
    <linearGradient id="wsg-folder-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9a917"/><stop offset="1" stop-color="#d79512"/></linearGradient>
    <linearGradient id="wsg-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9f0"/><stop offset="1" stop-color="#1f6fc4"/></linearGradient>
    <linearGradient id="wsg-gray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset="1" stop-color="#c9d0d8"/></linearGradient>
    <linearGradient id="wsg-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fd36f"/><stop offset="1" stop-color="#1f9b3b"/></linearGradient>
    <linearGradient id="wsg-disk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6eaef"/><stop offset="1" stop-color="#9aa6b3"/></linearGradient>`;
  function installDefs() {
    if (document.getElementById('ws-svg-defs')) return;
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.setAttribute('id', 'ws-svg-defs');
    holder.setAttribute('aria-hidden', 'true');
    holder.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    holder.innerHTML = '<defs>' + DEFS + '</defs>';
    document.body.insertBefore(holder, document.body.firstChild);
  }
  if (document.body) installDefs(); else document.addEventListener('DOMContentLoaded', installDefs);

  const s16 = body => `<svg viewBox="0 0 16 16">${body}</svg>`;
  const folderBody = '<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder-back)"/><path d="M1 6h14v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="url(#wsg-folder)"/>';
  const person = (fill, x = 0) => `<circle cx="${8 + x}" cy="5" r="2.8" fill="${fill}"/><path d="M${2.5 + x} 14.5c.4-3.4 2.6-5 5.5-5s5.1 1.6 5.5 5z" fill="${fill}"/>`;
  const badge = {
    down: '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M12 10.3v3.2M10.6 12.2l1.4 1.4 1.4-1.4" stroke="#fff" stroke-width="1" fill="none"/>',
    check: '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#0f7b0f"/><path d="M10.6 12.1l1 1 1.9-2" stroke="#fff" stroke-width="1" fill="none"/>',
    block: '<circle cx="12" cy="12" r="3.6" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#c42b1c"/><path d="M10.5 12h3" stroke="#fff" stroke-width="1.3"/>'
  };

  const I = {
    /* ---- shell (32-unit) ---- */
    winlogo: '<svg viewBox="0 0 32 32"><g fill="#0a7ce6"><rect x="2" y="2" width="13.4" height="13.4" rx="1"/><rect x="16.6" y="2" width="13.4" height="13.4" rx="1"/><rect x="2" y="16.6" width="13.4" height="13.4" rx="1"/><rect x="16.6" y="16.6" width="13.4" height="13.4" rx="1"/></g></svg>',
    winlogoWhite: '<svg viewBox="0 0 32 32"><g fill="#4cc2ff"><rect x="2" y="2" width="13.4" height="13.4"/><rect x="16.6" y="2" width="13.4" height="13.4"/><rect x="2" y="16.6" width="13.4" height="13.4"/><rect x="16.6" y="16.6" width="13.4" height="13.4"/></g></svg>',
    servermanager: '<svg viewBox="0 0 32 32"><rect x="7" y="3" width="18" height="26" rx="2" fill="#5b6b7d"/><rect x="9" y="6" width="14" height="4" rx="1" fill="#8fa3b8"/><rect x="9" y="12" width="14" height="4" rx="1" fill="#8fa3b8"/><rect x="9" y="18" width="14" height="4" rx="1" fill="#8fa3b8"/><circle cx="20.5" cy="8" r="1" fill="#4cff8a"/><circle cx="20.5" cy="14" r="1" fill="#4cff8a"/><circle cx="20.5" cy="20" r="1" fill="#4cc2ff"/></svg>',
    explorer: '<svg viewBox="0 0 32 32"><path d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#e8a317"/><path d="M3 12h26v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#ffc83d"/><rect x="3" y="12" width="26" height="3" fill="#3b9cff"/></svg>',
    powershell: '<svg viewBox="0 0 32 32"><path d="M7 5h22l-4 22H3z" fill="#1e5aa8"/><path d="M9.5 10l7 6-9 6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 22h6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    edge: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#1a8ad4"/><path d="M5 18c2-8 14-10 18-3 2 4-2 7-6 6 4 3 9 1 11-3-1 7-7 11-13 10C9 27 5 23 5 18z" fill="#3bd68b"/></svg>',
    recycle: '<svg viewBox="0 0 32 32"><path d="M8 8h16l-1.6 20H9.6z" fill="#cfe4f7" stroke="#6c8fb3"/><rect x="6" y="6" width="20" height="3" rx="1" fill="#9fc1e3"/><path d="M13 12v12M16 12v12M19 12v12" stroke="#6c8fb3"/></svg>',
    search: s16('<circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 10l4.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
    user: '<svg viewBox="0 0 32 32"><circle cx="16" cy="11" r="6" fill="#7a7a7a"/><path d="M4 30c1-7 6-10 12-10s11 3 12 10z" fill="#7a7a7a"/></svg>',
    power: s16('<path d="M8 1.5v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4.5 3.8a5.5 5.5 0 1 0 7 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
    net: s16('<rect x="1.5" y="2" width="13" height="9" rx="1" fill="none" stroke="currentColor"/><path d="M8 11v3M5 14h6" stroke="currentColor"/>'),
    vol: s16('<path d="M2 6h3l4-3v10L5 10H2z" fill="none" stroke="currentColor"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9" fill="none" stroke="currentColor"/>'),
    lab: '<svg viewBox="0 0 32 32"><path d="M5 5h10a3 3 0 0 1 3 3v19a3 3 0 0 0-3-3H5z" fill="#2f7fd8"/><path d="M27 5H17a3 3 0 0 0-1 1v21a3 3 0 0 1 2-3h9z" fill="#5aa2ee"/></svg>',
    info: s16('<circle cx="8" cy="8" r="7" fill="#0067c0"/><path d="M8 7v4.5" stroke="#fff" stroke-width="1.5"/><circle cx="8" cy="4.6" r=".9" fill="#fff"/>'),

    /* ---- console objects (16-unit) ---- */
    folder: s16(folderBody),
    folderOpen: s16('<path d="M1 3.5a1 1 0 0 1 1-1h4l1.5 1.5H13a1 1 0 0 1 1 1V7H1z" fill="url(#wsg-folder-back)"/><path d="M3 7h12.3l-2 6.3a1 1 0 0 1-1 .7H1.5L1 13z" fill="url(#wsg-folder)"/>'),
    container: s16(folderBody),
    ou: s16(folderBody + '<rect x="8.5" y="8" width="5" height="5" rx=".5" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/><path d="M9.6 9.5h2.8M9.6 11.2h2.8" stroke="#6b7c8f" stroke-width=".8"/>'),
    builtin: s16(folderBody + '<circle cx="11.3" cy="10.3" r="2.6" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/><circle cx="11.3" cy="10.3" r=".9" fill="#6b7c8f"/>'),
    domain: s16('<path d="M8 1.5l6 3.2v6.6L8 14.5l-6-3.2V4.7z" fill="url(#wsg-blue)"/><path d="M8 1.5v13M2 4.7l6 3.2 6-3.2" fill="none" stroke="#cfe4ff" stroke-width=".8"/>'),
    adRoot: s16('<rect x="2" y="2" width="12" height="12" rx="1.5" fill="url(#wsg-blue)"/><path d="M5 11l3-6 3 6M6.1 9h3.8" fill="none" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>'),
    savedQueries: s16(folderBody + '<circle cx="10.8" cy="9.8" r="2" fill="none" stroke="#5b6b7d" stroke-width="1"/><path d="M12.3 11.3l1.6 1.6" stroke="#5b6b7d" stroke-width="1.2"/>'),
    adUser: s16(person('#4a7fbd')),
    adUserDisabled: s16(person('#4a7fbd') + badge.down),
    adGroup: s16(person('#8aa9cc', 2.5) + person('#4a7fbd', -1.5)),
    adComputer: s16('<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" fill="url(#wsg-blue)"/><rect x="2.7" y="3.7" width="10.6" height="6.1" fill="#bfe0ff"/><path d="M6 13.5h4M8 11v2.5" stroke="#5b6b7d" stroke-width="1.3"/>'),
    adComputerDisabled: s16('<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" fill="url(#wsg-blue)"/><rect x="2.7" y="3.7" width="10.6" height="6.1" fill="#bfe0ff"/><path d="M6 13.5h4M8 11v2.5" stroke="#5b6b7d" stroke-width="1.3"/>' + badge.down),
    contact: s16('<rect x="2" y="1.5" width="12" height="13" rx="1" fill="#f1f4f8" stroke="#8a97a6"/><circle cx="8" cy="6" r="2" fill="#4a7fbd"/><path d="M4.5 11.5c.4-2 1.8-3 3.5-3s3.1 1 3.5 3z" fill="#4a7fbd"/>'),
    fsp: s16(person('#7a8a9c')),
    server: s16('<rect x="4" y="1" width="8" height="14" rx="1" fill="#5b6b7d"/><rect x="5.2" y="2.5" width="5.6" height="2" fill="#8fa3b8"/><rect x="5.2" y="5.5" width="5.6" height="2" fill="#8fa3b8"/><circle cx="9.8" cy="12.5" r=".8" fill="#4cff8a"/>'),
    computer: s16('<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" fill="#5b6b7d"/><rect x="2.7" y="3.7" width="10.6" height="6.1" fill="#4ea5ef"/><path d="M5.5 13.5h5M8 11v2.5" stroke="#5b6b7d" stroke-width="1.3"/>'),
    gear: s16('<path d="M8 1.2l1.2 1.7 2-.4.5 2 1.9.9-.8 1.9 1 1.7-1.8 1-.1 2.1-2-.1-1.2 1.6L7 12.3l-2 .4-.5-2-1.9-.9.8-1.9-1-1.7 1.8-1L3.3 3.1l2 .1z" fill="url(#wsg-gray)" stroke="#6b7c8f" stroke-width=".8" stroke-linejoin="round"/><circle cx="8" cy="7.6" r="2.2" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/>'),
    service: s16('<path d="M8 1.2l1.2 1.7 2-.4.5 2 1.9.9-.8 1.9 1 1.7-1.8 1-.1 2.1-2-.1-1.2 1.6L7 12.3l-2 .4-.5-2-1.9-.9.8-1.9-1-1.7 1.8-1L3.3 3.1l2 .1z" fill="url(#wsg-gray)" stroke="#6b7c8f" stroke-width=".8" stroke-linejoin="round"/><circle cx="8" cy="7.6" r="2.2" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/>'),
    services: s16('<path d="M6 1l.9 1.3 1.5-.3.4 1.5 1.4.7-.6 1.4.8 1.3-1.4.8-.1 1.6-1.5-.1-.9 1.2-.9-1.2-1.5.3-.4-1.5L2.2 8l.6-1.4L2 5.3l1.4-.8.1-1.6 1.5.1z" fill="url(#wsg-gray)" stroke="#6b7c8f" stroke-width=".7"/><circle cx="6" cy="5.7" r="1.5" fill="#fff" stroke="#6b7c8f" stroke-width=".7"/><path d="M11 7.5l.8 1.1 1.3-.2.3 1.3 1.2.6-.5 1.2.7 1.1-1.2.7-.1 1.4-1.3-.1-.8 1-.8-1-1.3.2-.3-1.3-1.2-.6.5-1.2-.7-1.1 1.2-.7.1-1.4 1.3.1z" fill="url(#wsg-gray)" stroke="#6b7c8f" stroke-width=".7"/><circle cx="11" cy="11.6" r="1.3" fill="#fff" stroke="#6b7c8f" stroke-width=".7"/>'),
    mmc: s16('<rect x="1" y="2" width="14" height="12" rx="1" fill="#fff" stroke="#5b6b7d"/><rect x="1" y="2" width="14" height="2.5" fill="#5b6b7d"/><rect x="2.5" y="6" width="3.5" height="6.5" fill="#cfe4f7"/><path d="M7.5 6.5h6M7.5 8.5h6M7.5 10.5h4" stroke="#8a97a6"/>'),
    drive: s16('<rect x="1" y="5" width="14" height="7" rx="1" fill="url(#wsg-disk)" stroke="#6b7c8f" stroke-width=".8"/><rect x="2.5" y="9.5" width="7" height="1" fill="#6b7c8f"/><circle cx="12.5" cy="10" r=".8" fill="#2fb34b"/>'),
    driveSystem: s16('<rect x="1" y="5" width="14" height="7" rx="1" fill="url(#wsg-disk)" stroke="#6b7c8f" stroke-width=".8"/><circle cx="12.5" cy="10" r=".8" fill="#2fb34b"/><g fill="#0a7ce6"><rect x="2.5" y="6.3" width="2.2" height="2.2"/><rect x="5" y="6.3" width="2.2" height="2.2"/><rect x="2.5" y="8.8" width="2.2" height="2.2"/><rect x="5" y="8.8" width="2.2" height="2.2"/></g>'),
    cdrom: s16('<circle cx="8" cy="8" r="6.5" fill="url(#wsg-gray)" stroke="#6b7c8f" stroke-width=".8"/><circle cx="8" cy="8" r="1.6" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/>'),
    disk: s16('<rect x="2" y="2" width="12" height="12" rx="1.2" fill="url(#wsg-disk)" stroke="#6b7c8f" stroke-width=".8"/><circle cx="8" cy="7.5" r="3.5" fill="#fff" stroke="#6b7c8f" stroke-width=".8"/><circle cx="8" cy="7.5" r=".9" fill="#6b7c8f"/>'),
    thisPC: s16('<rect x="1.5" y="2.5" width="13" height="8.5" rx="1" fill="#5b6b7d"/><rect x="2.7" y="3.7" width="10.6" height="6.1" fill="#4ea5ef"/><path d="M5.5 13.5h5M8 11v2.5" stroke="#5b6b7d" stroke-width="1.3"/>'),
    file: s16('<path d="M3 1h6.5L13 4.5V15H3z" fill="#fff" stroke="#8a97a6"/><path d="M9.5 1v3.5H13" fill="#e6eaef" stroke="#8a97a6"/>'),
    fileText: s16('<path d="M3 1h6.5L13 4.5V15H3z" fill="#fff" stroke="#8a97a6"/><path d="M9.5 1v3.5H13" fill="#e6eaef" stroke="#8a97a6"/><path d="M5 7h6M5 9h6M5 11h4" stroke="#8a97a6"/>'),
    fileExe: s16('<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#fff" stroke="#6b7c8f"/><rect x="1.5" y="2.5" width="13" height="2.5" fill="#4ea5ef"/>'),
    share: s16(folderBody + '<circle cx="11.5" cy="10.5" r="3" fill="#fff" stroke="#2f7fd8"/><path d="M10 10.5h3M11.5 9v3" stroke="#2f7fd8"/>'),
    zone: s16('<rect x="1.5" y="2" width="13" height="12" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M1.5 5h13" stroke="#6b7c8f"/><path d="M3.5 7.5h4M3.5 9.5h6M3.5 11.5h5" stroke="#2f7fd8"/>'),
    dnsServer: s16('<rect x="4" y="1" width="8" height="14" rx="1" fill="#5b6b7d"/><rect x="5.2" y="2.5" width="5.6" height="2" fill="#8fa3b8"/><text x="8" y="11.5" font-size="4.5" text-anchor="middle" fill="#fff" font-family="Segoe UI">DNS</text>'),
    record: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#8a97a6"/><path d="M4.5 5h7M4.5 8h7M4.5 11h4" stroke="#2f7fd8"/>'),
    scope: s16(folderBody + '<path d="M9 9h5v4H9z" fill="#fff" stroke="#2f7fd8" stroke-width=".8"/>'),
    lease: s16('<rect x="2" y="3" width="12" height="10" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4 6h8M4 8.5h8M4 11h5" stroke="#2fb34b"/>'),
    log: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 4.5h7M4.5 7h7M4.5 9.5h7M4.5 12h4" stroke="#8a97a6"/>'),
    eventInfo: s16('<circle cx="8" cy="8" r="6.5" fill="#0067c0"/><path d="M8 7v4.3" stroke="#fff" stroke-width="1.5"/><circle cx="8" cy="4.8" r=".9" fill="#fff"/>'),
    eventWarning: s16('<path d="M8 1.5L15 14H1z" fill="#f7c600" stroke="#c99a00" stroke-linejoin="round"/><path d="M8 6v4" stroke="#1b1b1b" stroke-width="1.4"/><circle cx="8" cy="12" r=".8" fill="#1b1b1b"/>'),
    eventError: s16('<circle cx="8" cy="8" r="6.5" fill="#c42b1c"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.5"/>'),
    eventCritical: s16('<circle cx="8" cy="8" r="6.5" fill="#8a1111"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#fff" stroke-width="1.5"/>'),
    auditSuccess: s16('<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#6b7c8f" stroke-width="1.3"/><rect x="3.5" y="7" width="9" height="7" rx="1" fill="#f2b631"/>'),
    auditFailure: s16('<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#6b7c8f" stroke-width="1.3"/><rect x="3.5" y="7" width="9" height="7" rx="1" fill="#f2b631"/>' + badge.block),
    shield: s16('<path d="M8 1l5.5 2v4.5c0 3.2-2.3 5.9-5.5 7-3.2-1.1-5.5-3.8-5.5-7V3z" fill="url(#wsg-blue)"/><path d="M8 1v13.5" stroke="#cfe4ff" stroke-width=".7"/>'),
    ruleAllow: s16('<path d="M8 1l5.5 2v4.5c0 3.2-2.3 5.9-5.5 7-3.2-1.1-5.5-3.8-5.5-7V3z" fill="url(#wsg-green)"/><path d="M5.2 8l2 2 3.6-3.8" fill="none" stroke="#fff" stroke-width="1.4"/>'),
    ruleBlock: s16('<path d="M8 1l5.5 2v4.5c0 3.2-2.3 5.9-5.5 7-3.2-1.1-5.5-3.8-5.5-7V3z" fill="#c42b1c"/><path d="M5.3 7.8h5.4" stroke="#fff" stroke-width="1.6"/>'),
    ruleOff: s16('<path d="M8 1l5.5 2v4.5c0 3.2-2.3 5.9-5.5 7-3.2-1.1-5.5-3.8-5.5-7V3z" fill="#c8ced6"/>'),
    adapter: s16('<rect x="1.5" y="3" width="13" height="8" rx="1" fill="url(#wsg-blue)"/><path d="M4 11v2.5M6.5 11v2.5M9 11v2.5M11.5 11v2.5" stroke="#5b6b7d" stroke-width="1.1"/>'),
    key: s16('<circle cx="5" cy="8" r="3.2" fill="none" stroke="#c99a00" stroke-width="1.6"/><path d="M8 8h6.5M12 8v2.5M14 8v2" stroke="#c99a00" stroke-width="1.6"/>'),
    gpo: s16('<rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 5h7M4.5 7.5h7" stroke="#8a97a6"/><path d="M6.5 10l1.6 1.8L11.5 8" fill="none" stroke="#0f7b0f" stroke-width="1.4"/>'),
    task: s16('<rect x="2" y="2.5" width="12" height="11.5" rx="1" fill="#fff" stroke="#6b7c8f"/><rect x="2" y="2.5" width="12" height="3" fill="#2f7fd8"/><path d="M4.5 8.5l1.3 1.3 2.4-2.6" fill="none" stroke="#0f7b0f" stroke-width="1.3"/>'),

    /* ---- commands (toolbar / Actions pane, 16-unit, monochrome-ish) ---- */
    back: s16('<circle cx="8" cy="8" r="6.8" fill="url(#wsg-blue)"/><path d="M9.5 4.5L6 8l3.5 3.5" fill="none" stroke="#fff" stroke-width="1.7"/>'),
    forward: s16('<circle cx="8" cy="8" r="6.8" fill="url(#wsg-blue)"/><path d="M6.5 4.5L10 8l-3.5 3.5" fill="none" stroke="#fff" stroke-width="1.7"/>'),
    up: s16(folderBody + '<path d="M8 13V8M5.8 10l2.2-2.2 2.2 2.2" fill="none" stroke="#1f6fc4" stroke-width="1.4"/>'),
    refresh: s16('<path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="#2f7fd8" stroke-width="1.6"/><path d="M12.6 1.6v3.6H9" fill="none" stroke="#2f7fd8" stroke-width="1.6"/>'),
    exportList: s16('<rect x="2" y="1.5" width="9" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4 5h5M4 7.5h5M4 10h3" stroke="#8a97a6"/><path d="M9 11h6M12.5 8.5L15 11l-2.5 2.5" fill="none" stroke="#2fb34b" stroke-width="1.4"/>'),
    help: s16('<circle cx="8" cy="8" r="6.8" fill="#2f7fd8"/><path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.6" fill="none" stroke="#fff" stroke-width="1.4"/><circle cx="8" cy="12" r=".9" fill="#fff"/>'),
    properties: s16('<rect x="2" y="1.5" width="12" height="13" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4.5 4.5h1.5M7.5 4.5h4M4.5 7.5h1.5M7.5 7.5h4M4.5 10.5h1.5M7.5 10.5h4" stroke="#2f7fd8" stroke-width="1.2"/>'),
    showTree: s16('<rect x="1.5" y="2" width="13" height="12" rx="1" fill="#fff" stroke="#6b7c8f"/><rect x="1.5" y="2" width="4.5" height="12" fill="#cfe4f7" stroke="#6b7c8f"/>'),
    showActions: s16('<rect x="1.5" y="2" width="13" height="12" rx="1" fill="#fff" stroke="#6b7c8f"/><rect x="10" y="2" width="4.5" height="12" fill="#cfe4f7" stroke="#6b7c8f"/>'),
    play: s16('<path d="M4.5 2.5v11l9-5.5z" fill="#2fb34b"/>'),
    stop: s16('<rect x="3.5" y="3.5" width="9" height="9" fill="#3a3a3a"/>'),
    pause: s16('<rect x="4" y="3" width="3" height="10" fill="#3a3a3a"/><rect x="9" y="3" width="3" height="10" fill="#3a3a3a"/>'),
    restart: s16('<rect x="2" y="4" width="2.5" height="8" fill="#3a3a3a"/><path d="M6 3v10l8-5z" fill="#2fb34b"/>'),
    delete: s16('<path d="M4 4l8 8M12 4l-8 8" stroke="#c42b1c" stroke-width="2.2" stroke-linecap="round"/>'),
    newItem: s16('<path d="M8 1.5l1.3 4.2 4.2 1.3-4.2 1.3L8 12.5 6.7 8.3 2.5 7l4.2-1.3z" fill="#f2b631"/>'),
    newUser: s16(person('#4a7fbd') + '<path d="M13 1v4M11 3h4" stroke="#0f7b0f" stroke-width="1.4"/>'),
    newGroup: s16(person('#8aa9cc', 2) + person('#4a7fbd', -1.5) + '<path d="M13 1v4M11 3h4" stroke="#0f7b0f" stroke-width="1.4"/>'),
    newOU: s16(folderBody + '<path d="M12 7v5M9.5 9.5h5" stroke="#0f7b0f" stroke-width="1.5"/>'),
    find: s16('<circle cx="6.5" cy="6.5" r="4.2" fill="#fff" stroke="#5b6b7d" stroke-width="1.4"/><path d="M9.6 9.6l4.6 4.6" stroke="#5b6b7d" stroke-width="2" stroke-linecap="round"/>'),
    filter: s16('<path d="M1.5 2.5h13L9.5 8.5v5l-3-1.5V8.5z" fill="url(#wsg-blue)"/>'),
    rename: s16('<rect x="1.5" y="5" width="13" height="6" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M4 6.5v3M3 6.5h2M3 9.5h2" stroke="#1b1b1b"/>'),
    view: s16('<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#fff" stroke="#6b7c8f"/><path d="M3.5 5.5h9M3.5 8h9M3.5 10.5h9" stroke="#8a97a6"/>'),
    link: s16('<path d="M6.5 9.5l3-3" stroke="#2f7fd8" stroke-width="1.5"/><path d="M7.5 4.5l1.3-1.3a2.5 2.5 0 0 1 3.5 3.5L11 8M8.5 11.5l-1.3 1.3a2.5 2.5 0 0 1-3.5-3.5L5 8" fill="none" stroke="#2f7fd8" stroke-width="1.5"/>'),
    move: s16('<path d="M2 8h11M10 5l3 3-3 3" fill="none" stroke="#2f7fd8" stroke-width="1.6"/>'),
    enable: s16('<circle cx="8" cy="8" r="6.5" fill="url(#wsg-green)"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.5"/>'),
    disable: s16('<circle cx="8" cy="8" r="6.5" fill="#8a97a6"/><path d="M4.8 8h6.4" stroke="#fff" stroke-width="1.6"/>'),
    resetPassword: s16('<circle cx="5" cy="8" r="3.2" fill="none" stroke="#c99a00" stroke-width="1.6"/><path d="M8 8h6.5M12 8v2.5" stroke="#c99a00" stroke-width="1.6"/>'),
    chevronRight: s16('<path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
    chevronDown: s16('<path d="M3.5 6L8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.3"/>'),
    check: s16('<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
    dot: s16('<circle cx="8" cy="8" r="2.6" fill="currentColor"/>')
  };

  /** Look up an icon by name, falling back to a plain document so missing names are visible but harmless. */
  I.get = name => I[name] || I.file;
  I.installDefs = installDefs;
  WS.icons = I;
})();
