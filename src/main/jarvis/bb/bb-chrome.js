/**
 * bb's framed app, dressed as part of Tellaflow: the app's own colours, type
 * and radius, its light or dark, and bb's product chrome that means nothing
 * here trimmed away.
 *
 * Adapted from canvas's `electron/bb/bb-chrome.ts`. The frame is cross-origin
 * (bb serves on 127.0.0.1:<port>), so the renderer cannot touch it; main finds
 * the frame by bb's own origin and runs this inside it through
 * `WebFrameMain.executeJavaScript` — one audited call, `webSecurity` stays on.
 *
 * **The colours are Tellaflow's live tokens, not a copy.** bb is a shadcn app
 * like this one, so both name their tokens the same (`--background`,
 * `--card`, `--primary`, `--border`, …). The Assistant page reads its own
 * computed values and hands them over; a theme change in Tellaflow is a theme
 * change in bb with nothing to keep in step by hand. bb's background takes
 * Tellaflow's CARD colour because the frame sits inside a card on that page.
 *
 * **CSS wherever a rule can be expressed as CSS.** bb is a history-router SPA:
 * one `<style>` in its head survives every route change and re-render.
 *
 * **Selector polarity** (canvas's rule): every trim states what it hides in
 * positive terms, so when bb's markup moves the rule stops matching and bb's
 * own chrome comes back — cosmetic, never an empty panel. Every selector is a
 * private-API dependency on the pinned bb-app (`BB_APP_VERSION`).
 */

/** Id of the injected sheet, and the marker that a document already has it. */
const BB_CHROME_STYLE_ID = '__tellaflow_bb_chrome';

/** bb's persisted theme setting ("light" | "dark" | "system"), applied by bb
 *  itself as a `dark` class on its `<html>` (bb-app 0.42.1). */
const BB_THEME_STORAGE_KEY = 'bb.theme';

/**
 * The tokens Tellaflow hands bb — the names both apps share. Anything else in
 * the payload is dropped, and every value is checked (`isSafeTokenValue`)
 * before it is written into a stylesheet, so a value can never close the rule
 * and start one of its own.
 */
const THEME_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
  'radius',
];

/** A colour or length as getComputedStyle reports it — no `;{}<>\` or quotes. */
function isSafeTokenValue(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 120 && /^[a-zA-Z0-9#%.,()/\s+-]+$/.test(v);
}

/** The theme sheet: Tellaflow's tokens on bb's `<html>`, in both of bb's
 *  modes (bb sets its own on `.dark`; `html:root` outranks it). */
function themeCss(tokens = {}) {
  const lines = [];
  for (const name of THEME_TOKENS) {
    // bb's page background is Tellaflow's card: the frame sits in a card.
    const source = name === 'background' ? tokens.card ?? tokens.background : tokens[name];
    if (isSafeTokenValue(source)) lines.push(`  --${name}: ${source.trim()} !important;`);
  }
  // bb draws its canvas and ink from these two in dark mode.
  const bg = tokens.card ?? tokens.background;
  if (isSafeTokenValue(bg)) lines.push(`  --canvas: ${bg.trim()} !important;`);
  if (isSafeTokenValue(tokens.foreground)) lines.push(`  --ink: ${tokens.foreground.trim()} !important;`);
  // Tellaflow's type: Inter (bb ships "Inter Variable" first; the stack keeps it).
  lines.push(`  --font-sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;`);
  if (!lines.length) return '';
  return `html:root, html:root.dark {\n${lines.join('\n')}\n}\nhtml, body { background: var(--background) !important; }`;
}

/* The plugin nav list (bb's "Extensions" and its tools hub): nothing there
   belongs in an assistant's chats. (canvas R1) */
const R1_PLUGIN_NAV = '[data-testid="plugin-nav-sidebar-items"] { display: none !important; }';

/* bb's self-update pill, labelled with the literal word "bb". The bundled bb
   is pinned, so "update bb" is not an action the person can take. Matched by
   testid, never href — the provider-update badge shares the route. (canvas R2) */
const R2_UPDATES = `[data-testid="sidebar-updates-badge-bb"],
[data-sidebar="menu-item"]:has([data-testid="sidebar-updates-badge-bb"]):not(:has([data-testid="sidebar-updates-badge-providers"])) { display: none !important; }`;

/* The composer's workspace pickers ("workspace", "Local"). The assistant's
   chats run in its own folder on this Mac; anything else these offer is a
   directory nothing here shows. (canvas R3) */
const R3_WORKSPACE = `[data-promptbox-icon-only-control][aria-label="Environment"],
[data-promptbox-icon-only-control][aria-label="Machine"],
[data-promptbox-icon-only-control][aria-label="Worktree"] { display: none !important; }`;

/* The mention menu opens upward with its own scroll — the composer sits near
   the bottom of a frame this height. (canvas R4) */
const R4_MENTION_MENU = `[data-promptbox-typeahead-menu] {
  top: auto !important;
  bottom: 100% !important;
  margin-top: 0 !important;
  margin-bottom: 8px !important;
  max-height: 50vh !important;
  overflow-y: auto !important;
}`;

/* Sent messages take the column's width instead of a ribbon at 70%. (canvas R5) */
const R5_USER_MESSAGE_WIDTH = `[data-message-column] > .ml-auto.max-w-\\[70\\%\\] {
  width: 100% !important;
  max-width: 100% !important;
  align-items: stretch !important;
}`;

function bbChromeCss(tokens) {
  return [themeCss(tokens), R1_PLUGIN_NAV, R2_UPDATES, R3_WORKSPACE, R4_MENTION_MENU, R5_USER_MESSAGE_WIDTH]
    .filter(Boolean)
    .join('\n\n') + '\n';
}

/**
 * The script, run inside bb's frame: the sheet (reused, rewritten only when
 * its text changed) and the theme — the class set now, and bb's own setting
 * written so its NEXT load starts in the right mode. Idempotent: it runs on
 * every frame load and every theme change.
 */
function buildBbChromeScript({ theme = 'light', tokens = {} } = {}) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  const css = bbChromeCss(tokens);
  return `(function () {
  var css = ${JSON.stringify(css)};
  var theme = ${JSON.stringify(mode)};
  var el = document.getElementById(${JSON.stringify(BB_CHROME_STYLE_ID)});
  if (!el) {
    el = document.createElement("style");
    el.id = ${JSON.stringify(BB_CHROME_STYLE_ID)};
    (document.head || document.documentElement).appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  try { window.localStorage.setItem(${JSON.stringify(BB_THEME_STORAGE_KEY)}, theme); } catch (err) { /* private mode */ }
  return { styled: true, theme: theme };
})()`;
}

module.exports = {
  BB_CHROME_STYLE_ID,
  BB_THEME_STORAGE_KEY,
  THEME_TOKENS,
  isSafeTokenValue,
  themeCss,
  bbChromeCss,
  buildBbChromeScript,
};
