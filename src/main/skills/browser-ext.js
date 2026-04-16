/**
 * browser-ext.js — Playwright-powered Chrome Extension Bridge
 *
 * Two tiers of tools:
 *
 *   TIER 1 — Low-level Playwright-like primitives (ext_click, ext_fill, …)
 *   TIER 2 — High-level site recipes: pre-built action sequences for Gmail,
 *             Outlook, YouTube, Spotify, Twitter/X, Facebook.
 *             LLM calls e.g. gmail_compose() instead of clicking selectors.
 *
 * Requires the Tellaflow Chrome extension (load /extension folder unpacked).
 */

function getBridge() { return require('../ws-bridge'); }

// ── Helper: send command to extension and return result string ────────────────

async function ext(action, params = {}) {
  return await getBridge().sendToExtension(action, params);
}

// ── Tier-2 recipe executor ────────────────────────────────────────────────────

async function runSiteAction(actionName, actionParams = {}) {
  return await ext('site_action', { action_name: actionName, params: actionParams });
}

// ── Build recipe tools from site-recipes.js ──────────────────────────────────

function buildRecipeTools() {
  const { SITE_RECIPES } = require('../site-recipes');
  const seen = new Set(); // de-duplicate cross-hostname actions (twitter.com / x.com)
  const tools = [];

  for (const [hostname, recipe] of Object.entries(SITE_RECIPES)) {
    for (const [actionName, def] of Object.entries(recipe.actions)) {
      if (seen.has(actionName)) continue;
      seen.add(actionName);

      tools.push({
        name: actionName,
        description: `[${recipe.label}] ${def.description}. Requires Chrome extension + being on ${hostname}.`,
        parameters: def.params || {},
        async execute(args) {
          return await runSiteAction(actionName, args);
        },
      });
    }
  }

  return tools;
}

// ── Module export ─────────────────────────────────────────────────────────────

module.exports = {
  name: 'Browser Extension',
  description:
    'Full Playwright-like Chrome tab control via the Tellaflow extension. ' +
    'Includes pre-built recipes for Gmail, Outlook, YouTube, Spotify, Twitter/X, Facebook. ' +
    'Use named recipe actions (gmail_compose, youtube_like, twitter_tweet, etc.) when on those sites.',

  get tools() {
    // Tier-1 primitives + Tier-2 recipe tools (built lazily so site-recipes.js is loaded after all modules init)
    return [...TIER1_TOOLS, ...buildRecipeTools()];
  },
};

// ── Tier-1: Low-level Playwright primitives ───────────────────────────────────

const TIER1_TOOLS = [

  // ── Navigation ──────────────────────────────────────────────────────────────

  {
    name: 'ext_navigate',
    description: 'Navigate the current Chrome tab to a URL. Waits for the page to finish loading.',
    parameters: { url: { type: 'string', description: 'Full URL e.g. "https://gmail.com"' } },
    async execute({ url }) { return await ext('navigate', { url }); },
  },

  {
    name: 'ext_get_url',
    description: 'Get the URL of the currently active Chrome tab.',
    parameters: {},
    async execute() { return await ext('get_url'); },
  },

  {
    name: 'ext_get_title',
    description: 'Get the page title of the active Chrome tab.',
    parameters: {},
    async execute() { return await ext('get_title'); },
  },

  // ── Reading page content ────────────────────────────────────────────────────

  {
    name: 'ext_get_text',
    description: 'Get the full visible text of the current Chrome tab (up to 10 000 chars).',
    parameters: {},
    async execute() { return await ext('get_text'); },
  },

  {
    name: 'ext_get_links',
    description: 'Get all hyperlinks on the current page (text + URL pairs).',
    parameters: {},
    async execute() { return await ext('get_links'); },
  },

  {
    name: 'ext_get_text_of',
    description: 'Get the text content of a specific element by CSS selector.',
    parameters: { selector: { type: 'string', description: 'CSS selector' } },
    async execute({ selector }) { return await ext('get_text_of', { selector }); },
  },

  {
    name: 'ext_get_attr',
    description: 'Get an attribute value from a DOM element.',
    parameters: {
      selector:  { type: 'string', description: 'CSS selector' },
      attribute: { type: 'string', description: 'Attribute name, e.g. "href" or "value"' },
    },
    async execute({ selector, attribute }) { return await ext('get_attr', { selector, attribute }); },
  },

  {
    name: 'ext_is_visible',
    description: 'Check whether a DOM element is visible on the page. Returns "true" or "false".',
    parameters: { selector: { type: 'string', description: 'CSS selector' } },
    async execute({ selector }) { return await ext('is_visible', { selector }); },
  },

  // ── Clicking ────────────────────────────────────────────────────────────────

  {
    name: 'ext_click',
    description:
      'Click an element by CSS selector. Scrolls into view first. ' +
      'Also supports :text("…"), :role("button","Name"), :aria("label") pseudo-selectors.',
    parameters: { selector: { type: 'string', description: 'CSS or pseudo selector' } },
    async execute({ selector }) { return await ext('click', { selector }); },
  },

  {
    name: 'ext_click_text',
    description: 'Click any clickable element (link, button) whose visible label contains a phrase.',
    parameters: { text: { type: 'string', description: 'Visible text to look for' } },
    async execute({ text }) { return await ext('click_text', { text }); },
  },

  // ── Typing / filling ────────────────────────────────────────────────────────

  {
    name: 'ext_fill',
    description:
      'Clear and fill a text input or textarea with a value. ' +
      'Fires input + change events. Use ext_type for contenteditable fields.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of input/textarea' },
      value:    { type: 'string', description: 'Value to set' },
    },
    async execute({ selector, value }) { return await ext('fill', { selector, value }); },
  },

  {
    name: 'ext_type',
    description:
      'Type text character-by-character into an element (input, textarea, or contenteditable). ' +
      'Best for rich-text editors like Gmail compose, Google Docs, Notion.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of element to type into' },
      text:     { type: 'string', description: 'Text to type' },
    },
    async execute({ selector, text }) { return await ext('type', { selector, text }); },
  },

  {
    name: 'ext_press',
    description: 'Press a keyboard key on the focused element or a specific element.',
    parameters: {
      key:      { type: 'string', description: 'Key name e.g. "Enter", "Tab", "Escape", "ArrowDown"' },
      selector: { type: 'string', description: 'Optional CSS selector. Defaults to currently focused element.' },
    },
    async execute({ key, selector } = {}) { return await ext('press', { key, selector }); },
  },

  // ── Form submission ─────────────────────────────────────────────────────────

  {
    name: 'ext_submit',
    description: 'Submit a form by pressing Enter on it, or clicking a submit button.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector of form or submit button. Default: "form".' },
    },
    async execute({ selector } = {}) { return await ext('submit', { selector: selector || 'form' }); },
  },

  // ── Scrolling ───────────────────────────────────────────────────────────────

  {
    name: 'ext_scroll',
    description: 'Scroll the page up or down.',
    parameters: {
      direction: { type: 'string', description: '"up" or "down"' },
      amount:    { type: 'string', description: 'Pixels to scroll (default 400)' },
    },
    async execute({ direction = 'down', amount = '400' } = {}) {
      return await ext('scroll', { direction, amount });
    },
  },

  {
    name: 'ext_scroll_to',
    description: 'Scroll a specific element into view.',
    parameters: { selector: { type: 'string', description: 'CSS selector of element to scroll to' } },
    async execute({ selector }) { return await ext('scroll_to', { selector }); },
  },

  // ── Waiting ─────────────────────────────────────────────────────────────────

  {
    name: 'ext_wait_for',
    description: 'Wait until an element matching a selector appears and is visible on the page.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector to wait for' },
      timeout:  { type: 'string', description: 'Max wait in ms (default 8000)' },
    },
    async execute({ selector, timeout = '8000' }) {
      return await ext('wait_for', { selector, timeout: parseInt(timeout) || 8000 });
    },
  },

  {
    name: 'ext_wait_ms',
    description: 'Pause for a specified number of milliseconds before continuing.',
    parameters: { ms: { type: 'string', description: 'Milliseconds to wait (e.g. "1000" = 1 second)' } },
    async execute({ ms = '500' }) { return await ext('wait_ms', { ms: parseInt(ms) || 500 }); },
  },

  // ── JavaScript ──────────────────────────────────────────────────────────────

  {
    name: 'ext_run_js',
    description: 'Execute arbitrary JavaScript in the current Chrome tab and return the result.',
    parameters: { script: { type: 'string', description: 'JavaScript expression or statement to run' } },
    async execute({ script }) { return await ext('run_js', { script }); },
  },

  // ── Tab management ──────────────────────────────────────────────────────────

  {
    name: 'ext_new_tab',
    description: 'Open a new Chrome tab, optionally navigating to a URL.',
    parameters: { url: { type: 'string', description: 'URL to open (optional)' } },
    async execute({ url } = {}) { return await ext('new_tab', { url }); },
  },

  {
    name: 'ext_list_tabs',
    description: 'List all open Chrome tabs with their titles and URLs.',
    parameters: {},
    async execute() { return await ext('list_tabs'); },
  },

  {
    name: 'ext_switch_tab',
    description: 'Switch Chrome focus to a specific tab by its 1-based number.',
    parameters: { index: { type: 'string', description: 'Tab number (1 = first)' } },
    async execute({ index }) { return await ext('switch_tab', { index }); },
  },

  {
    name: 'ext_close_tab',
    description: 'Close the currently active Chrome tab.',
    parameters: {},
    async execute() { return await ext('close_tab'); },
  },

  // ── Screenshot ──────────────────────────────────────────────────────────────

  {
    name: 'ext_screenshot',
    description: 'Take a screenshot of the current Chrome tab (returns size info).',
    parameters: {},
    async execute() { return await ext('screenshot'); },
  },

  // ── Site-aware action dispatcher (generic) ──────────────────────────────────

  {
    name: 'ext_site_action',
    description:
      'Execute a named recipe action for the current website. ' +
      'Use ext_get_site_actions first to see what\'s available on the current page.',
    parameters: {
      action_name: { type: 'string', description: 'Recipe action name, e.g. "gmail_compose" or "youtube_like"' },
      params:      { type: 'string', description: 'JSON string of parameters, e.g. \'{"email":"boss@co.com"}\'' },
    },
    async execute({ action_name, params: paramsJson = '{}' }) {
      let parsedParams = {};
      try { parsedParams = JSON.parse(paramsJson); } catch { /* ignore */ }
      return await ext('site_action', { action_name, params: parsedParams });
    },
  },

  {
    name: 'ext_get_site_actions',
    description:
      'List all available high-level recipe actions for the website currently open in Chrome. ' +
      'Call this before using ext_site_action to know what the current site supports.',
    parameters: {},
    async execute() { return await ext('get_site_actions'); },
  },

  // ── YouTube shortcuts (direct) ──────────────────────────────────────────────

  {
    name: 'ext_yt_play_first_result',
    description:
      'On a YouTube search results page, click the first video to play it. ' +
      'Pass the search query so a fallback can be used if the extension is not installed.',
    parameters: {
      query: { type: 'string', description: 'The search query used to find this video (used as fallback).' },
    },
    async execute({ query = '' } = {}) {
      // Try extension first
      const wsBridge = require('../ws-bridge');
      if (wsBridge.isExtensionConnected()) {
        return await ext('yt_play_first_result');
      }
      // Fallback: delegate to the browser skill's HTTP-based approach
      const browserSkill = require('./browser');
      const clickFirst = browserSkill.tools.find(t => t.name === 'youtube_click_first_result');
      if (clickFirst && query) {
        return await clickFirst.execute({ query });
      }
      throw new Error(
        'Chrome extension is not connected and no query provided for fallback. ' +
        'Load the /extension folder in Chrome → chrome://extensions → Load unpacked.'
      );
    },
  },

  {
    name: 'ext_yt_play_pause',
    description: 'Play or pause the video currently open in YouTube.',
    parameters: {},
    async execute() { return await ext('yt_play_pause'); },
  },
];
