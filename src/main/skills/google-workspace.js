/**
 * google-workspace.js — Google Sheets, Forms, Docs, Calendar, Drive
 *
 * All operations require the Chrome extension to be connected and the
 * respective Google service to be open in the active tab (or opened automatically).
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function ext(action, params = {}) {
  const wsBridge = require('../ws-bridge');
  if (!wsBridge.isExtensionConnected()) {
    throw new Error(
      'Chrome extension is not connected. Install the Tellaflow extension and open Google Workspace in Chrome.'
    );
  }
  return wsBridge.sendToExtension(action, params);
}

async function openGoogle(service, urlHint = '') {
  const wsBridge = require('../ws-bridge');
  if (!wsBridge.isExtensionConnected()) throw new Error('Chrome extension not connected');
  const currentUrl = await wsBridge.sendToExtension('get_url', {});
  if (currentUrl && currentUrl.includes(service)) return;
  if (urlHint) {
    await wsBridge.sendToExtension('navigate', { url: urlHint });
    await sleep(2000);
  }
}

module.exports = {
  name: 'GoogleWorkspace',
  description: 'Interact with Google Sheets, Forms, Docs, Calendar, Drive via the Chrome extension',
  tools: [

    // ── Sheets ──────────────────────────────────────────────────────────────

    {
      name: 'sheets_open',
      description: 'Open a Google Sheet by URL or name. Use "new" to create a new spreadsheet.',
      parameters: {
        url:  { type: 'string', description: 'Spreadsheet URL or "new" to create a blank one' },
        name: { type: 'string', description: 'Optional: spreadsheet name (used to search Drive)' },
      },
      async execute({ url, name }) {
        if (url === 'new' || (!url && !name)) {
          await ext('navigate', { url: 'https://sheets.new' });
          await sleep(2000);
          return 'Opened new Google Sheet';
        }
        if (url && url.startsWith('http')) {
          await ext('navigate', { url });
          await sleep(2000);
          return `Opened spreadsheet: ${url}`;
        }
        // Search Drive
        const driveUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(name || url)}`;
        await ext('navigate', { url: driveUrl });
        await sleep(1500);
        return `Searching Drive for "${name || url}"`;
      },
    },

    {
      name: 'sheets_read_cell',
      description: 'Read the value of a cell in the currently open Google Sheet (e.g. A1, B3)',
      parameters: {
        cell: { type: 'string', description: 'Cell reference e.g. "A1", "C5"' },
      },
      async execute({ cell }) {
        return ext('site_action', {
          action_name: 'sheets_read_cell',
          params: { cell },
        });
      },
    },

    {
      name: 'sheets_write_cell',
      description: 'Write a value to a specific cell in the currently open Google Sheet',
      parameters: {
        cell:  { type: 'string', description: 'Cell reference e.g. "B2"' },
        value: { type: 'string', description: 'Value to write into the cell' },
      },
      async execute({ cell, value }) {
        await ext('site_action', { action_name: 'sheets_write_cell', params: { cell, value } });
        return `Wrote "${value}" to cell ${cell}`;
      },
    },

    {
      name: 'sheets_add_row',
      description: 'Append a row of comma-separated values to the Google Sheet',
      parameters: {
        values: { type: 'string', description: 'Comma-separated values e.g. "Alice,30,Engineer"' },
      },
      async execute({ values }) {
        // Navigate to the first empty row and write values
        const cells = values.split(',').map(v => v.trim());
        // Use Ctrl+End to go to last row, then go to next row
        await ext('run_js', {
          script: `
            (function() {
              // Focus the sheet and navigate to an empty row
              var app = document.querySelector('.grid-scrollable-wrapper');
              if (app) app.click();
            })()
          `,
        });
        await sleep(300);
        await ext('press', { key: 'End', selector: null });
        await sleep(200);
        // Type each value and Tab between
        for (let i = 0; i < cells.length; i++) {
          await ext('run_js', {
            script: `document.activeElement.textContent = ${JSON.stringify(cells[i])}; document.activeElement.dispatchEvent(new Event('input', {bubbles: true}))`,
          });
          await ext('press', { key: i < cells.length - 1 ? 'Tab' : 'Enter' });
          await sleep(100);
        }
        return `Appended row: ${values.slice(0, 80)}`;
      },
    },

    // ── Forms ────────────────────────────────────────────────────────────────

    {
      name: 'forms_open',
      description: 'Open a Google Form by URL. Opens the fill-out view.',
      parameters: {
        url: { type: 'string', description: 'Google Form URL' },
      },
      async execute({ url }) {
        await ext('navigate', { url });
        await sleep(2000);
        return `Opened form: ${url}`;
      },
    },

    {
      name: 'forms_fill_field',
      description: 'Fill a field in a Google Form by its label text',
      parameters: {
        label: { type: 'string', description: 'Field label text e.g. "Your name"' },
        value: { type: 'string', description: 'Value to enter' },
      },
      async execute({ label, value }) {
        await ext('site_action', { action_name: 'forms_fill_field', params: { label, value } });
        return `Filled "${label}" = "${value}"`;
      },
    },

    {
      name: 'forms_fill_all',
      description: 'Fill multiple fields in a Google Form at once',
      parameters: {
        fields: { type: 'string', description: 'JSON string: [{"label":"Name","value":"Alice"},...]' },
      },
      async execute({ fields }) {
        let parsed;
        try { parsed = JSON.parse(fields); } catch { return 'Invalid fields JSON'; }
        for (const { label, value } of parsed) {
          try {
            await ext('site_action', { action_name: 'forms_fill_field', params: { label, value } });
            await sleep(200);
          } catch (e) {
            console.warn(`[workspace] forms_fill_all: skipping "${label}":`, e.message);
          }
        }
        return `Filled ${parsed.length} form fields`;
      },
    },

    {
      name: 'forms_submit',
      description: 'Submit the currently open Google Form',
      parameters: {},
      async execute() {
        await ext('site_action', { action_name: 'forms_submit', params: {} });
        return 'Form submitted';
      },
    },

    // ── Docs ─────────────────────────────────────────────────────────────────

    {
      name: 'docs_open',
      description: 'Open a Google Doc by URL. Use "new" to create a blank document.',
      parameters: {
        url: { type: 'string', description: 'Google Doc URL or "new"' },
      },
      async execute({ url }) {
        const target = url === 'new' ? 'https://docs.new' : url;
        await ext('navigate', { url: target });
        await sleep(2000);
        return `Opened Google Doc: ${target}`;
      },
    },

    {
      name: 'docs_read',
      description: 'Read the text content of the currently open Google Doc',
      parameters: {},
      async execute() {
        return ext('get_text', {});
      },
    },

    {
      name: 'docs_type',
      description: 'Type text into the currently open Google Doc at the cursor position',
      parameters: {
        text: { type: 'string', description: 'Text to type' },
      },
      async execute({ text }) {
        await ext('click', { selector: '.kix-appview-editor,[contenteditable="true"]' });
        await sleep(200);
        await ext('type', { selector: '.kix-appview-editor,[contenteditable="true"]', text, delay: 15 });
        return `Typed ${text.length} chars into Google Doc`;
      },
    },

    // ── Calendar ─────────────────────────────────────────────────────────────

    {
      name: 'calendar_open',
      description: 'Open Google Calendar in the browser',
      parameters: {},
      async execute() {
        await ext('navigate', { url: 'https://calendar.google.com' });
        await sleep(2000);
        return 'Opened Google Calendar';
      },
    },

    {
      name: 'calendar_create_event',
      description: 'Create a new Google Calendar event',
      parameters: {
        title: { type: 'string', description: 'Event title/name' },
        date:  { type: 'string', description: 'Date/time e.g. "tomorrow 3pm", "next Monday", "June 15"' },
      },
      async execute({ title, date }) {
        await openGoogle('calendar.google.com', 'https://calendar.google.com');
        await ext('site_action', { action_name: 'calendar_create_event', params: { title, date } });
        return `Created event "${title}" on ${date}`;
      },
    },

    {
      name: 'calendar_read_today',
      description: 'Read today\'s Google Calendar events',
      parameters: {},
      async execute() {
        await openGoogle('calendar.google.com', 'https://calendar.google.com');
        return ext('site_action', { action_name: 'calendar_read_today', params: {} });
      },
    },

    // ── Drive ────────────────────────────────────────────────────────────────

    {
      name: 'drive_search',
      description: 'Search Google Drive for files by name or content',
      parameters: {
        query: { type: 'string', description: 'Search query' },
      },
      async execute({ query }) {
        await ext('navigate', { url: `https://drive.google.com/drive/search?q=${encodeURIComponent(query)}` });
        await sleep(2000);
        return `Searching Drive for "${query}"`;
      },
    },

    {
      name: 'drive_open_file',
      description: 'Open a file in Google Drive by name (searches Drive and opens the first match)',
      parameters: {
        name: { type: 'string', description: 'File name to search for and open' },
      },
      async execute({ name }) {
        await ext('navigate', { url: `https://drive.google.com/drive/search?q=${encodeURIComponent(name)}` });
        await sleep(2000);
        // Click first result
        await ext('click', { selector: '[data-target="doc"], [aria-label*="Open file"], .KF4T6b:first-child' });
        await sleep(1000);
        return `Opened file "${name}" from Drive`;
      },
    },

  ],
};
