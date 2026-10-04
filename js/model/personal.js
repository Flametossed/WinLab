/* Per-user shell preferences (HKCU on Windows): Light/Dark mode for Windows and for apps, accent colour, transparency,
 * taskbar alignment and search, the desktop background, desktop icon view, notifications and the Run box history.
 *   WS.personal.get() -> prefs; set(patch) -> { ok, error }; managed(key) -> the policy name when Group Policy locks a setting;
 *   background() -> { kind, picture, color, policy } as the desktop shows it; backgroundCss(bg?) -> CSS background;
 *   apply() pushes the theme onto <html> (data-theme, data-apps-theme, --accent); addRun(text) records Run history;
 *   snap() -> the Multitasking snap options (set({ snap: { ... } }) changes them).
 * State: state.personal. */
(function () {
  'use strict';
  const WS = window.WS;

  /** Original abstract backgrounds (not Microsoft images). The file names are the ones Windows keeps in C:\Windows\Web\Wallpaper. */
  const PICTURES = [
    { id: 'img0', name: 'Windows (default)', file: 'C:\\Windows\\Web\\Wallpaper\\Windows\\img0.jpg',
      css: 'radial-gradient(ellipse 60% 45% at 62% 58%, rgba(120,190,255,.55), transparent 70%), radial-gradient(ellipse 40% 30% at 70% 52%, rgba(200,230,255,.45), transparent 70%), radial-gradient(ellipse 90% 70% at 30% 30%, #0b3a7a, transparent 75%), linear-gradient(160deg, #031a3d 0%, #0a3b82 55%, #062a5c 100%)' },
    { id: 'img19', name: 'Glow', file: 'C:\\Windows\\Web\\Wallpaper\\Windows\\img19.jpg',
      css: 'radial-gradient(ellipse 55% 50% at 50% 55%, rgba(214,160,255,.6), transparent 70%), radial-gradient(ellipse 80% 60% at 30% 30%, #3b1d7a, transparent 75%), linear-gradient(150deg, #120a33 0%, #3a1c78 60%, #1b0f45 100%)' },
    { id: 'img20', name: 'Sunrise', file: 'C:\\Windows\\Web\\Wallpaper\\Windows\\img20.jpg',
      css: 'radial-gradient(ellipse 60% 40% at 50% 80%, rgba(255,196,120,.75), transparent 70%), radial-gradient(ellipse 90% 60% at 50% 20%, #5a7fc4, transparent 80%), linear-gradient(180deg, #2c4f8f 0%, #d27c5a 75%, #f2b27a 100%)' },
    { id: 'img21', name: 'Flow', file: 'C:\\Windows\\Web\\Wallpaper\\Windows\\img21.jpg',
      css: 'radial-gradient(ellipse 70% 40% at 35% 60%, rgba(90,220,200,.55), transparent 70%), radial-gradient(ellipse 50% 40% at 75% 35%, rgba(60,140,220,.5), transparent 70%), linear-gradient(160deg, #052c2e 0%, #0d5458 55%, #06303f 100%)' }
  ];
  /** The Windows 11 colour swatches (Settings > Personalization > Colors and Background > Solid color). */
  const COLORS = ['#ffb900', '#ff8c00', '#f7630c', '#ca5010', '#da3b01', '#ef6950', '#d13438', '#ff4343', '#e74856', '#e81123', '#ea005e', '#c30052',
    '#e3008c', '#bf0077', '#c239b3', '#9a0089', '#0078d4', '#0063b1', '#8e8cd8', '#6b69d6', '#8764b8', '#744da9', '#b146c2', '#881798',
    '#0099bc', '#2d7d9a', '#00b7c3', '#038387', '#00b294', '#018574', '#00cc6a', '#10893e', '#7a7574', '#5d5a58', '#68768a', '#515c6b',
    '#567c73', '#486860', '#498205', '#107c10', '#767676', '#4c4a48', '#69797e', '#4a5459', '#647c64', '#525e54', '#847545', '#7e735f'];
  const DEFAULT_ACCENT = '#0067c0';
  /** Settings > System > Multitasking (HKCU\Control Panel\Desktop WindowArrangementActive and the Snap* values under Explorer\Advanced). */
  const SNAP_DEFAULTS = { enabled: true, hoverMax: true, dragTop: true, groups: true, assist: true, nearEdge: true, shake: false };

  WS.store.init('personal', s => {
    s.personal = {
      mode: 'light', appMode: 'light', accent: DEFAULT_ACCENT, accentOnTaskbar: false, transparency: true,
      taskbarAlign: 'left', taskbarSearch: 'box',
      background: { kind: 'picture', picture: 'img0', color: '#0063b1' },
      desktop: { showIcons: true, iconSize: 'medium', sortBy: 'name', autoArrange: true },
      notifications: true, dnd: false, runMru: [], snap: { ...SNAP_DEFAULTS }
    };
  });

  const P = () => WS.state.personal;
  const pol = (key, side = 'user') => !!(WS.gpo && WS.gpo.policyEnabled(side, key));
  /** Group Policy that locks a preference (Settings shows "Some of these settings are managed by your organization"). */
  function managed(key) {
    if (key === 'background' && (pol('NoChangingWallPaper') || policyWallpaper())) return policyWallpaper() ? 'Wallpaper' : 'NoChangingWallPaper';
    return null;
  }
  /** User policy Desktop Wallpaper: { file, style } or null. */
  function policyWallpaper() {
    if (!WS.gpo) return null;
    const file = WS.gpo.policyOption('user', 'Wallpaper', 'Wallpaper');
    return file != null && String(file).trim() ? { file: String(file).trim(), style: WS.gpo.policyOption('user', 'Wallpaper', 'WallpaperStyle') } : null;
  }

  const MODES = ['light', 'dark'], ALIGN = ['left', 'center'], SEARCH = ['hide', 'icon', 'label', 'box'], SIZES = ['large', 'medium', 'small'], SORT = ['name', 'size', 'type', 'modified'];
  function set(patch = {}) {
    const p = P();
    const bad = (list, v, what) => (v !== undefined && !list.includes(v) ? `'${v}' is not a valid ${what}.` : null);
    const err = bad(MODES, patch.mode, 'mode') || bad(MODES, patch.appMode, 'app mode') || bad(ALIGN, patch.taskbarAlign, 'taskbar alignment') || bad(SEARCH, patch.taskbarSearch, 'search setting');
    if (err) return { ok: false, error: err };
    if (patch.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.accent)) return { ok: false, error: `'${patch.accent}' is not a valid colour.` };
    if (patch.background) {
      if (managed('background')) return { ok: false, code: 'Managed', error: 'Your organization manages the desktop background.' };
      const b = { ...p.background, ...patch.background };
      if (!['picture', 'solid'].includes(b.kind) || (b.kind === 'picture' && !PICTURES.some(x => x.id === b.picture)) || !/^#[0-9a-f]{6}$/i.test(b.color)) return { ok: false, error: 'That background is not available.' };
      p.background = b;
    }
    if (patch.desktop) {
      const d = { ...p.desktop, ...patch.desktop };
      if (!SIZES.includes(d.iconSize) || !SORT.includes(d.sortBy)) return { ok: false, error: 'That desktop view is not available.' };
      p.desktop = d;
    }
    if (patch.snap) p.snap = { ...snap(), ...patch.snap };
    for (const k of ['mode', 'appMode', 'accent', 'accentOnTaskbar', 'transparency', 'taskbarAlign', 'taskbarSearch', 'notifications', 'dnd']) if (patch[k] !== undefined) p[k] = patch[k];
    if (p.mode === 'light') p.accentOnTaskbar = false; // only available in dark mode, as on Windows
    WS.store.changed('personal');
    apply();
    return { ok: true };
  }

  /** What the desktop shows: the policy wallpaper wins; a file that isn't one of the built-in pictures shows black, as Windows does. */
  function background() {
    const pw = policyWallpaper();
    if (pw) {
      const pic = PICTURES.find(x => x.file.toLowerCase() === pw.file.toLowerCase() || x.file.split('\\').pop().toLowerCase() === pw.file.split('\\').pop().toLowerCase());
      return pic && WS.fs.exists(pic.file) ? { kind: 'picture', picture: pic.id, policy: true } : { kind: 'solid', color: '#000000', policy: true };
    }
    return P().background;
  }
  function backgroundCss(bg = background()) {
    if (bg.kind === 'solid') return bg.color;
    return (PICTURES.find(x => x.id === bg.picture) || PICTURES[0]).css;
  }

  /** Push the preferences onto the page (theme attributes, accent, wallpaper). Safe to call any time. */
  function apply() {
    if (typeof document === 'undefined' || !WS.state || !WS.state.personal) return;
    const p = P(), root = document.documentElement;
    root.dataset.theme = p.mode;
    root.dataset.appsTheme = p.appMode;
    root.dataset.taskbarAlign = p.taskbarAlign;
    root.dataset.transparency = p.transparency ? 'on' : 'off';
    root.dataset.accentTaskbar = p.accentOnTaskbar ? 'on' : 'off';
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--accent-hover', shade(p.accent, 0.12));
    root.style.setProperty('--accent-dark', shade(p.accent, -0.45));
    const wp = document.getElementById('wallpaper');
    if (wp) wp.style.background = backgroundCss();
  }
  /** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)));
    return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
  }

  /** Snap preferences (older saved states have none: they get the defaults). */
  const snap = () => ({ ...SNAP_DEFAULTS, ...(P().snap || {}) });

  /** The Run box remembers what was typed, newest first (HKCU\...\Explorer\RunMRU keeps 26). */
  function addRun(text) {
    const t = String(text || '').trim();
    if (!t) return;
    const p = P();
    p.runMru = [t, ...(p.runMru || []).filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 26);
    WS.store.changed('personal');
  }

  WS.store.on('change:personal', apply);
  WS.store.on('change:gpresult', apply);
  WS.personal = { PICTURES, COLORS, DEFAULT_ACCENT, SNAP_DEFAULTS, get: () => P(), set, snap, managed, policyWallpaper, background, backgroundCss, apply, shade, addRun };
})();
