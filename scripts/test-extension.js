#!/usr/bin/env node
/**
 * test-extension.js — 20 Chrome extension DOM engine unit tests
 *
 * Tests the content.js engine logic directly in Node.js by simulating
 * a minimal DOM environment using jsdom.
 *
 * Usage:
 *   npm install --save-dev jsdom    # once
 *   node scripts/test-extension.js
 */

const path = require('path');
const fs   = require('fs');

// ── jsdom setup ───────────────────────────────────────────────────────────────

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch {
  console.error('\x1b[31m  jsdom is required: npm install --save-dev jsdom\x1b[0m');
  process.exit(1);
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const D = s => `\x1b[2m${s}\x1b[0m`;

// ── Create a DOM with the engine injected ─────────────────────────────────────

function createDom(html = '<html><body></body></html>') {
  const dom = new JSDOM(html, { url: 'https://example.com', runScripts: 'dangerously', resources: 'usable' });
  const { window } = dom;

  // Stub chrome.runtime API used by content.js
  window.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
      lastError: null,
    },
  };

  // Inject the engine
  const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
  const script = window.document.createElement('script');
  script.textContent = contentSrc;
  window.document.head.appendChild(script);

  return { window, document: window.document };
}

/**
 * Run a sequence of engine steps against a DOM and return all results.
 * @param {object} window — jsdom window with content.js already injected
 * @param {Array}  steps  — [{fn, args}] engine steps
 * @param {object} params — param interpolation map
 */
async function runSteps(window, steps, params = {}) {
  // Access the engine through the global tellaflow listener
  // We'll directly invoke by calling engine functions via eval in the window
  const results = [];
  for (const step of steps) {
    try {
      const result = await window.eval(`
        (async () => {
          const e = window.__tellaflowEngine;
          if (!e) throw new Error('Engine not exposed');
          return e.runStep(${JSON.stringify(step)}, ${JSON.stringify(params)});
        })()
      `);
      results.push({ ok: true, result: String(result ?? '') });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  return results;
}

// Expose engine globally so tests can reach it
function exposeEngine(window) {
  window.eval(`
    // Re-inject with engine exposed globally
    window.__tellaflowEngineLoaded = false;
  `);

  // Patch content.js to expose engine
  const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');
  const patched = contentSrc.replace(
    '})(); // end engine',
    '})();\n  window.__tellaflowEngine = engine; // expose for tests'
  ).replace(
    `}; // end engine`,
    `};\n  window.__tellaflowEngine = engine; // expose for tests`
  );

  window.eval(patched);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const TESTS = [

  {
    id:    1,
    label: 'resolve() — CSS selector finds element',
    async run() {
      const { window } = createDom('<button id="submit-btn">Submit</button>');
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve('#submit-btn')`);
      return { pass: el !== null && el.textContent === 'Submit', detail: 'Found #submit-btn button' };
    },
  },

  {
    id:    2,
    label: 'resolve() — :text("…") finds by text content',
    async run() {
      const { window } = createDom('<button>Click me</button><span>Other</span>');
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve(':text("Click me")')`);
      return { pass: el !== null && el.tagName === 'BUTTON', detail: 'Found button by text' };
    },
  },

  {
    id:    3,
    label: 'resolve() — :label("…") finds input by label',
    async run() {
      const { window } = createDom(`
        <label for="email-input">Email address</label>
        <input id="email-input" type="email" />
      `);
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve(':label("Email address")')`);
      return { pass: el !== null && el.id === 'email-input', detail: 'Found input by label' };
    },
  },

  {
    id:    4,
    label: 'resolve() — :placeholder("…") finds by placeholder',
    async run() {
      const { window } = createDom(`<input placeholder="Search here..." />`);
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve(':placeholder("Search here")')`);
      return { pass: el !== null && el.tagName === 'INPUT', detail: 'Found input by placeholder' };
    },
  },

  {
    id:    5,
    label: 'resolve() — :role("button","…") finds by ARIA role + name',
    async run() {
      const { window } = createDom(`
        <div role="button" aria-label="Close dialog">×</div>
        <div role="button" aria-label="Open menu">☰</div>
      `);
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve(':role("button","Close dialog")')`);
      return { pass: el !== null && el.getAttribute('aria-label') === 'Close dialog', detail: 'Found by role+name' };
    },
  },

  {
    id:    6,
    label: 'resolve() — :testid("…") finds by data-testid',
    async run() {
      const { window } = createDom(`<input data-testid="username-field" />`);
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve(':testid("username-field")')`);
      return { pass: el !== null && el.dataset.testid === 'username-field', detail: 'Found by testid' };
    },
  },

  {
    id:    7,
    label: 'resolve() — comma-separated fallback tries next selector',
    async run() {
      const { window } = createDom(`<button class="submit-btn">Go</button>`);
      exposeEngine(window);
      const el = window.eval(`window.__tellaflowEngine.resolve('#non-existent, .submit-btn')`);
      return { pass: el !== null && el.className === 'submit-btn', detail: 'Fell back to second selector' };
    },
  },

  {
    id:    8,
    label: 'fill() — sets input value + dispatches events',
    async run() {
      const { window } = createDom(`<input id="name" type="text" />`);
      exposeEngine(window);
      let inputFired = false;
      window.document.getElementById('name').addEventListener('input', () => { inputFired = true; });
      await window.eval(`window.__tellaflowEngine.fill('#name', 'Hello World')`);
      const val = window.document.getElementById('name').value;
      return { pass: val === 'Hello World' && inputFired, detail: `value="${val}", input event: ${inputFired}` };
    },
  },

  {
    id:    9,
    label: 'fill() — works on contenteditable div',
    async run() {
      const { window } = createDom(`<div id="editor" contenteditable="true"></div>`);
      exposeEngine(window);
      await window.eval(`window.__tellaflowEngine.fill('#editor', 'Draft content')`);
      const txt = window.document.getElementById('editor').textContent;
      return { pass: txt === 'Draft content', detail: `contenteditable value="${txt}"` };
    },
  },

  {
    id:    10,
    label: 'click() — fires mouse events and calls .click()',
    async run() {
      const { window } = createDom(`<button id="btn">OK</button>`);
      exposeEngine(window);
      let clicked = false;
      window.document.getElementById('btn').addEventListener('click', () => { clicked = true; });
      await window.eval(`window.__tellaflowEngine.click('#btn')`);
      return { pass: clicked, detail: 'click event fired' };
    },
  },

  {
    id:    11,
    label: 'clickText() — finds element by text and clicks it',
    async run() {
      const { window } = createDom(`<button>Cancel</button><button>Confirm</button>`);
      exposeEngine(window);
      let clicked = null;
      window.document.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => { clicked = b.textContent; });
      });
      await window.eval(`window.__tellaflowEngine.clickText('Confirm')`);
      return { pass: clicked === 'Confirm', detail: `Clicked: "${clicked}"` };
    },
  },

  {
    id:    12,
    label: 'selectOption() — selects by value',
    async run() {
      const { window } = createDom(`
        <select id="color">
          <option value="red">Red</option>
          <option value="blue">Blue</option>
          <option value="green">Green</option>
        </select>
      `);
      exposeEngine(window);
      await window.eval(`window.__tellaflowEngine.selectOption('#color', 'blue')`);
      const val = window.document.getElementById('color').value;
      return { pass: val === 'blue', detail: `selected value="${val}"` };
    },
  },

  {
    id:    13,
    label: 'selectOption() — selects by display text',
    async run() {
      const { window } = createDom(`
        <select id="size"><option value="s">Small</option><option value="l">Large</option></select>
      `);
      exposeEngine(window);
      await window.eval(`window.__tellaflowEngine.selectOption('#size', 'Large')`);
      const val = window.document.getElementById('size').value;
      return { pass: val === 'l', detail: `selected by text, value="${val}"` };
    },
  },

  {
    id:    14,
    label: 'check() / uncheck() — checkbox toggle',
    async run() {
      const { window } = createDom(`<input id="agree" type="checkbox" />`);
      exposeEngine(window);
      await window.eval(`window.__tellaflowEngine.check('#agree')`);
      const checked = window.document.getElementById('agree').checked;
      await window.eval(`window.__tellaflowEngine.uncheck('#agree')`);
      const unchecked = window.document.getElementById('agree').checked;
      return { pass: checked === true && unchecked === false, detail: `checked=${checked}, then unchecked=${unchecked}` };
    },
  },

  {
    id:    15,
    label: 'clear() — empties input value',
    async run() {
      const { window } = createDom(`<input id="search" value="old text" />`);
      exposeEngine(window);
      await window.eval(`window.__tellaflowEngine.clear('#search')`);
      const val = window.document.getElementById('search').value;
      return { pass: val === '', detail: `value after clear="${val}"` };
    },
  },

  {
    id:    16,
    label: 'getText() — returns element text',
    async run() {
      const { window } = createDom(`<h1 id="title">Hello World</h1>`);
      exposeEngine(window);
      const text = window.eval(`window.__tellaflowEngine.getText('#title')`);
      return { pass: text === 'Hello World', detail: `getText returned "${text}"` };
    },
  },

  {
    id:    17,
    label: 'getAttribute() — returns attribute value',
    async run() {
      const { window } = createDom(`<a id="link" href="https://example.com">Visit</a>`);
      exposeEngine(window);
      const href = window.eval(`window.__tellaflowEngine.getAttribute('#link', 'href')`);
      return { pass: href === 'https://example.com', detail: `href="${href}"` };
    },
  },

  {
    id:    18,
    label: 'isVisible() — returns false for hidden element',
    async run() {
      const { window } = createDom(`<div id="hidden" style="display:none">Secret</div>`);
      exposeEngine(window);
      const vis = window.eval(`window.__tellaflowEngine.isVisible('#hidden')`);
      return { pass: vis === false, detail: `hidden element isVisible=${vis}` };
    },
  },

  {
    id:    19,
    label: 'readMessages() — extracts messages from chat-like structure',
    async run() {
      const { window } = createDom(`
        <div class="message-list">
          <div class="message">Hello there</div>
          <div class="message">How are you?</div>
          <div class="message">I'm fine thanks</div>
        </div>
      `);
      exposeEngine(window);
      const msgs = window.eval(`window.__tellaflowEngine.readMessages({ limit: 10 })`);
      return { pass: typeof msgs === 'string' && msgs.length > 0, detail: `got ${msgs.split('\n').length} lines` };
    },
  },

  {
    id:    20,
    label: 'runRecipe() — executes multi-step sequence with params',
    async run() {
      const { window } = createDom(`
        <input id="username" type="text" />
        <input id="password" type="password" />
        <button id="login">Log In</button>
      `);
      exposeEngine(window);

      let loginClicked = false;
      window.document.getElementById('login').addEventListener('click', () => { loginClicked = true; });

      const steps = [
        { fn: 'fill', args: ['#username', '{{user}}'] },
        { fn: 'fill', args: ['#password', '{{pass}}'] },
        { fn: 'click', args: ['#login'] },
      ];
      const params = { user: 'alice@example.com', pass: 'secret123' };

      const result = await window.eval(`
        window.__tellaflowEngine.runRecipe(
          ${JSON.stringify(steps)},
          ${JSON.stringify(params)}
        )
      `);

      const username = window.document.getElementById('username').value;
      const pass     = window.document.getElementById('password').value;

      return {
        pass: result.success && username === 'alice@example.com' && pass === 'secret123' && loginClicked,
        detail: `user="${username}", loginClicked=${loginClicked}`,
      };
    },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${B('Tellaflow Extension Engine Tests')} ${D(`(${TESTS.length} tests)`)}\n`);

  let passed = 0, failed = 0;

  for (const test of TESTS) {
    try {
      const { pass, detail } = await test.run();
      if (pass) {
        console.log(`  ${G('✓')} Test ${test.id}: ${test.label} ${D(detail ? `(${detail})` : '')}`);
        passed++;
      } else {
        console.log(`  ${R('✗')} Test ${test.id}: ${test.label}`);
        console.log(`    ${R('Expected: pass=true, got: ' + detail)}`);
        failed++;
      }
    } catch (err) {
      console.log(`  ${R('✗')} Test ${test.id}: ${test.label}`);
      console.log(`    ${R('Error: ' + err.message)}`);
      if (process.env.DEBUG) console.error(err);
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  ${G(passed + ' passed')}, ${failed > 0 ? R(failed + ' failed') : D('0 failed')} / ${TESTS.length} total\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
