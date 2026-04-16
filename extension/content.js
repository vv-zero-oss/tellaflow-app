/**
 * content.js — Tellaflow Complete Playwright-like DOM Engine v3
 *
 * Injected into every page. Provides a full automation engine matching
 * the core Playwright API: locators, interactions, assertions, waiting,
 * form control, reading, and recipe execution.
 *
 * Selector strategies (can mix via comma fallback):
 *   CSS selectors (standard)           '#id', '.class', 'input[type=email]'
 *   :text("…")                         find by visible text content
 *   :text-is("…")                      exact text match
 *   :placeholder("…")                  find by placeholder attribute
 *   :label("…")                        find input associated with a <label>
 *   :role("button","Submit")           find by ARIA role + accessible name
 *   :aria("label text")                find by aria-label
 *   :testid("my-id")                   find by data-testid or data-test-id
 *   :nth(n)                            nth match (0-based) of previous
 *   :has(:text("…"))                   CSS :has equivalent
 */

(function () {
  if (window.__tellaflowEngineLoaded) return;
  window.__tellaflowEngineLoaded = true;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function closest(el, roles) {
    while (el && el !== document.body) {
      if (roles.includes(el.getAttribute('role'))) return el;
      el = el.parentElement;
    }
    return null;
  }

  /** Fill a React / Vue controlled input by patching the native setter */
  function nativeFill(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    );
    if (nativeInputValueSetter) {
      nativeInputValueSetter.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Simulate typing via keyboard events (needed for contenteditable) */
  function simulateType(el, text, delay = 0) {
    const chars = [...text];
    function typeNext(i) {
      if (i >= chars.length) return Promise.resolve();
      const ch = chars[i];
      el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true, cancelable: true }));
        if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
          document.execCommand('insertText', false, ch);
      } else {
        el.value += ch;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
      if (delay > 0) return new Promise(r => setTimeout(() => typeNext(i + 1).then(r), delay));
      return typeNext(i + 1);
    }
    return typeNext(0);
  }

  // ── Selector Engine ────────────────────────────────────────────────────────

  const engine = {

    /**
     * Resolve a selector string to a single DOM element.
     * Supports comma-separated selectors (tries each in order).
     * Supports all Playwright-like pseudo-selectors.
     */
    resolve(selector, root = document) {
      if (!selector) return null;

      // Try comma-separated alternatives
      const parts = splitSelector(selector);
      for (const part of parts) {
        const el = engine._resolveSingle(part.trim(), root);
        if (el) return el;
      }
      return null;
    },

    resolveAll(selector, root = document) {
      const parts = splitSelector(selector);
      const seen = new Set();
      const results = [];
      for (const part of parts) {
        for (const el of engine._resolveAllSingle(part.trim(), root)) {
          if (!seen.has(el)) { seen.add(el); results.push(el); }
        }
      }
      return results;
    },

    _resolveSingle(sel, root) {
      // :nth(n) modifier
      const nthMatch = sel.match(/^(.+):nth\((\d+)\)$/);
      if (nthMatch) {
        const els = engine._resolveAllSingle(nthMatch[1], root);
        return els[parseInt(nthMatch[2], 10)] || null;
      }

      // :text("…") — contains text
      const textContains = sel.match(/^:text\("(.+?)"\)$/i);
      if (textContains) return findByText(textContains[1], false, root);

      // :text-is("…") — exact text
      const textExact = sel.match(/^:text-is\("(.+?)"\)$/i);
      if (textExact) return findByText(textExact[1], true, root);

      // :placeholder("…")
      const phMatch = sel.match(/^:placeholder\("(.+?)"\)$/i);
      if (phMatch) {
        const ph = phMatch[1].toLowerCase();
        return Array.from(root.querySelectorAll('input,textarea,[contenteditable]'))
          .find(el => (el.placeholder || '').toLowerCase().includes(ph)) || null;
      }

      // :label("…") — find input associated with label text
      const labelMatch = sel.match(/^:label\("(.+?)"\)$/i);
      if (labelMatch) return findByLabel(labelMatch[1], root);

      // :role("role","name") — find by ARIA role + optional accessible name
      const roleMatch = sel.match(/^:role\("(\w[\w-]*)"\s*(?:,\s*"([^"]+)")?\)$/i);
      if (roleMatch) return findByRole(roleMatch[1], roleMatch[2] || '', root);

      // :aria("label") — find by aria-label / aria-labelledby
      const ariaMatch = sel.match(/^:aria\("([^"]+)"\)$/i);
      if (ariaMatch) {
        const needle = ariaMatch[1].toLowerCase();
        return Array.from(root.querySelectorAll('[aria-label],[aria-labelledby]'))
          .find(el => {
            const lbl = el.getAttribute('aria-label') || '';
            return lbl.toLowerCase().includes(needle);
          }) || null;
      }

      // :testid("…") — data-testid or data-test-id
      const testidMatch = sel.match(/^:testid\("([^"]+)"\)$/i);
      if (testidMatch) {
        const id = testidMatch[1];
        return root.querySelector(`[data-testid="${id}"],[data-test-id="${id}"],[data-cy="${id}"],[data-e2e="${id}"]`);
      }

      // Standard CSS
      try { return root.querySelector(sel); } catch { return null; }
    },

    _resolveAllSingle(sel, root) {
      const textContains = sel.match(/^:text\("(.+?)"\)$/i);
      if (textContains) return findAllByText(textContains[1], false, root);

      const textExact = sel.match(/^:text-is\("(.+?)"\)$/i);
      if (textExact) return findAllByText(textExact[1], true, root);

      const roleMatch = sel.match(/^:role\("(\w[\w-]*)"\s*(?:,\s*"([^"]+)")?\)$/i);
      if (roleMatch) return findAllByRole(roleMatch[1], roleMatch[2] || '', root);

      try { return Array.from(root.querySelectorAll(sel)); } catch { return []; }
    },

    // ── Waiting ────────────────────────────────────────────────────────────

    waitFor(selector, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const el = engine.resolve(selector);
          // Accept any connected element — offsetParent may be null in test environments
          if (el && el.isConnected) return resolve(el);
          if (Date.now() - start > timeout) return reject(new Error(`waitFor timeout (${timeout}ms): "${selector}"`));
          setTimeout(tick, 150);
        };
        tick();
      });
    },

    waitMs: (ms) => new Promise(r => setTimeout(r, ms)),

    waitForNavigation(timeout = 10000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const startUrl = location.href;
        const tick = () => {
          if (location.href !== startUrl) return resolve(location.href);
          if (Date.now() - start > timeout) return reject(new Error('waitForNavigation timeout'));
          setTimeout(tick, 200);
        };
        setTimeout(tick, 300);
      });
    },

    waitForSelector(selector, opts = {}) {
      return engine.waitFor(selector, opts.timeout || 10000);
    },

    // ── Interaction ────────────────────────────────────────────────────────

    async click(selector, opts = {}) {
      const el = opts.noWait
        ? engine.resolve(selector)
        : await engine.waitFor(selector, opts.timeout || 8000);
      if (!el) throw new Error(`click: not found: "${selector}"`);
      await scrollIntoView(el);
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, button: 0 }));
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await engine.waitMs(50);
      return `Clicked: "${el.getAttribute('aria-label') || el.textContent.trim().slice(0, 60) || selector}"`;
    },

    async clickText(text, opts = {}) {
      const needle = text.toLowerCase();
      const tags = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],label,span,div,p,li';
      const el = Array.from(document.querySelectorAll(tags))
        .find(e => {
          const t = e.textContent.trim().toLowerCase();
          return opts.exact ? t === needle : t.includes(needle);
        });
      if (!el) throw new Error(`clickText: no element with text "${text}"`);
      await scrollIntoView(el);
      el.click();
      return `Clicked text: "${el.textContent.trim().slice(0, 60)}"`;
    },

    async fill(selector, value, opts = {}) {
      const el = await engine.waitFor(selector, opts.timeout || 8000);
      if (!el) throw new Error(`fill: not found: "${selector}"`);
      el.focus();
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        nativeFill(el, value);
      } else if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
        el.focus();
        el.textContent = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        // Try execCommand first (proper browser); always set textContent as fallback
        try { document.execCommand('insertText', false, value); } catch { /* ignore */ }
        // If execCommand didn't actually insert the text (e.g. jsdom), set directly
        if (!el.textContent || !el.textContent.includes(value)) el.textContent = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return `Filled: "${value.slice(0, 40)}"`;
    },

    async type(selector, text, opts = {}) {
      const delay = typeof opts === 'number' ? opts : (opts.delay ?? 30);
      const el = await engine.waitFor(selector, 8000);
      if (!el) throw new Error(`type: not found: "${selector}"`);
      el.focus();
      await simulateType(el, text, delay);
      return `Typed ${text.length} chars`;
    },

    async press(key, selector = null) {
      const target = selector
        ? (engine.resolve(selector) || document.activeElement)
        : document.activeElement;
      const keyMap = {
        Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
        Tab:   { key: 'Tab',   code: 'Tab',   keyCode: 9 },
        Escape:{ key: 'Escape',code: 'Escape',keyCode: 27 },
        Space: { key: ' ',     code: 'Space', keyCode: 32 },
        Backspace:{ key:'Backspace',code:'Backspace',keyCode:8 },
        ArrowDown:{ key:'ArrowDown',code:'ArrowDown',keyCode:40 },
        ArrowUp:  { key:'ArrowUp',  code:'ArrowUp',  keyCode:38 },
      };
      const opts = { ...(keyMap[key] || { key, code: key }), bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown',  opts));
      target.dispatchEvent(new KeyboardEvent('keypress', opts));
      target.dispatchEvent(new KeyboardEvent('keyup',    opts));
      if (key === 'Enter' && target.form) target.form.dispatchEvent(new Event('submit', { bubbles: true }));
      return `Pressed ${key}`;
    },

    async hover(selector) {
      const el = await engine.waitFor(selector, 6000);
      await scrollIntoView(el);
      ['mousemove','mouseover','mouseenter'].forEach(t =>
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true })));
      await engine.waitMs(200);
      return `Hovered: "${selector}"`;
    },

    async selectOption(selector, value) {
      const el = await engine.waitFor(selector, 6000);
      if (el.tagName !== 'SELECT') throw new Error(`selectOption: element is not a <select>`);
      const opts = Array.from(el.options);
      // Match by value, text, or index
      const opt = opts.find(o => o.value === value || o.text === value || String(opts.indexOf(o)) === String(value));
      if (!opt) throw new Error(`selectOption: option "${value}" not found`);
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return `Selected: "${opt.text}"`;
    },

    async check(selector, checked = true) {
      const el = await engine.waitFor(selector, 6000);
      if (el.type !== 'checkbox' && el.type !== 'radio') throw new Error(`check: element is not a checkbox/radio`);
      if (el.checked !== checked) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return checked ? 'Checked' : 'Unchecked';
    },

    async uncheck(selector) {
      return engine.check(selector, false);
    },

    async focus(selector) {
      const el = await engine.waitFor(selector, 6000);
      el.focus();
      return `Focused: "${selector}"`;
    },

    async clear(selector) {
      const el = await engine.waitFor(selector, 6000);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        nativeFill(el, '');
      } else if (el.isContentEditable) {
        el.innerHTML = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return 'Cleared';
    },

    async scrollTo(selector) {
      const el = await engine.waitFor(selector, 6000);
      await scrollIntoView(el);
      return `Scrolled to "${selector}"`;
    },

    async dragTo(fromSelector, toSelector) {
      const from = await engine.waitFor(fromSelector, 6000);
      const to   = await engine.waitFor(toSelector, 6000);
      const fromRect = from.getBoundingClientRect();
      const toRect   = to.getBoundingClientRect();
      const fromXY = { clientX: fromRect.x + fromRect.width / 2, clientY: fromRect.y + fromRect.height / 2 };
      const toXY   = { clientX: toRect.x + toRect.width / 2,     clientY: toRect.y + toRect.height / 2 };
      from.dispatchEvent(new MouseEvent('mousedown', { ...fromXY, bubbles: true }));
      from.dispatchEvent(new MouseEvent('dragstart', { ...fromXY, bubbles: true }));
      to.dispatchEvent(new MouseEvent('dragover',  { ...toXY, bubbles: true }));
      to.dispatchEvent(new MouseEvent('drop',      { ...toXY, bubbles: true }));
      from.dispatchEvent(new MouseEvent('dragend', { ...fromXY, bubbles: true }));
      return `Dragged to "${toSelector}"`;
    },

    async submit(selector) {
      const el = engine.resolve(selector);
      const form = el ? el.closest('form') : document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        const submitBtn = form.querySelector('[type=submit]');
        if (submitBtn) submitBtn.click();
        return 'Form submitted';
      }
      throw new Error('submit: no form found');
    },

    // ── Reading ────────────────────────────────────────────────────────────

    getText(selector) {
      const el = engine.resolve(selector);
      return el ? el.textContent.trim() : null;
    },

    getAttribute(selector, attr) {
      const el = engine.resolve(selector);
      return el ? el.getAttribute(attr) : null;
    },

    getAll(selector) {
      return engine.resolveAll(selector).map(el => ({
        text:      el.textContent.trim().slice(0, 300),
        href:      el.getAttribute('href') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        id:        el.id || null,
        value:     el.value || null,
      }));
    },

    isVisible(selector) {
      const el = engine.resolve(selector);
      return el ? isVisible(el) : false;
    },

    isChecked(selector) {
      const el = engine.resolve(selector);
      return el ? el.checked === true : false;
    },

    inputValue(selector) {
      const el = engine.resolve(selector);
      if (!el) return null;
      return el.value ?? el.textContent.trim() ?? null;
    },

    pageText() {
      return document.body.innerText.trim().slice(0, 15000);
    },

    pageTitle() {
      return document.title;
    },

    pageUrl() {
      return location.href;
    },

    links() {
      return Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 200)
        .map(a => ({ text: a.textContent.trim().slice(0, 100), href: a.href }))
        .filter(l => l.text && l.href.startsWith('http'));
    },

    /** Extract messages from a chat interface (Slack, Discord, WhatsApp Web, etc.) */
    readMessages(opts = {}) {
      const limit = opts.limit || 20;
      const selectors = [
        // Slack web
        '[data-qa="virtual-list-item"] .c-message__body',
        '[data-qa="message_content"]',
        // Discord web
        '[class*="messageContent"]',
        '[data-list-item-id*="chat-messages"] [id*="message-content"]',
        // WhatsApp web
        '[class*="message-in"] .copyable-text',
        '[class*="message-out"] .copyable-text',
        // Generic chat
        '[role="log"] [role="listitem"]',
        '[role="feed"] article',
        '.message','.msg','.chat-message','.post',
      ];
      for (const sel of selectors) {
        try {
          const els = Array.from(document.querySelectorAll(sel)).slice(-limit);
          if (els.length > 0) {
            return els.map(e => e.textContent.trim()).filter(Boolean).join('\n');
          }
        } catch {}
      }
      // Fallback: any element that looks like a message list
      const feed = document.querySelector('[role="log"],[role="feed"],[class*="message-list"],[class*="chat-list"]');
      if (feed) {
        return Array.from(feed.querySelectorAll('*'))
          .filter(e => e.children.length === 0 && e.textContent.trim().length > 10)
          .slice(-limit)
          .map(e => e.textContent.trim())
          .join('\n');
      }
      return '';
    },

    /** Read structured form fields: {label, value, type, required} */
    readForm(selector = 'form') {
      const form = engine.resolve(selector);
      if (!form) return [];
      const fields = [];
      form.querySelectorAll('input,textarea,select').forEach(el => {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
        const labelEl = form.querySelector(`label[for="${el.id}"]`) ||
          el.closest('label') ||
          el.previousElementSibling;
        fields.push({
          label:    labelEl ? labelEl.textContent.trim() : (el.placeholder || el.name || el.id || ''),
          type:     el.type || el.tagName.toLowerCase(),
          value:    el.value || '',
          required: el.required,
          name:     el.name,
        });
      });
      return fields;
    },

    async evaluate(script) {
      // eslint-disable-next-line no-eval
      return String(eval(script) ?? '');
    },

    // ── Screenshot ────────────────────────────────────────────────────────

    screenshot() {
      // Use html2canvas if available, else return null
      if (typeof html2canvas === 'function') {
        return html2canvas(document.body).then(c => c.toDataURL());
      }
      return Promise.resolve(null);
    },

    // ── Recipe executor ───────────────────────────────────────────────────

    async runStep(step, params) {
      const resolve = (v) => {
        if (typeof v !== 'string') return v;
        return v.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? '');
      };
      const { fn, args = [] } = step;
      const a = args.map(resolve);

      switch (fn) {
        case 'click':          return engine.click(a[0], { timeout: Number(a[1]) || 8000 });
        case 'clickText':      return engine.clickText(a[0], { exact: a[1] === 'true' });
        case 'fill':           return engine.fill(a[0], a[1]);
        case 'type':           return engine.type(a[0], a[1], { delay: Number(a[2]) || 30 });
        case 'press':          return engine.press(a[0], a[1] || null);
        case 'hover':          return engine.hover(a[0]);
        case 'selectOption':   return engine.selectOption(a[0], a[1]);
        case 'check':          return engine.check(a[0]);
        case 'uncheck':        return engine.uncheck(a[0]);
        case 'focus':          return engine.focus(a[0]);
        case 'clear':          return engine.clear(a[0]);
        case 'submit':         return engine.submit(a[0] || 'form');
        case 'waitFor':        return engine.waitFor(a[0], Number(a[1]) || 10000);
        case 'waitMs':         return engine.waitMs(Number(a[0]) || 500);
        case 'waitForNav':     return engine.waitForNavigation(Number(a[0]) || 10000);
        case 'scrollTo':       return engine.scrollTo(a[0]);
        case 'dragTo':         return engine.dragTo(a[0], a[1]);
        case 'evaluate':       return engine.evaluate(a[0]);
        case 'getText':        return engine.getText(a[0]) ?? '';
        case 'getAttribute':   return engine.getAttribute(a[0], a[1]) ?? '';
        case 'isVisible':      return String(engine.isVisible(a[0]));
        case 'isChecked':      return String(engine.isChecked(a[0]));
        case 'inputValue':     return engine.inputValue(a[0]) ?? '';
        case 'readMessages':   return engine.readMessages({ limit: Number(a[0]) || 20 });
        case 'pageText':       return engine.pageText();
        case 'pageTitle':      return engine.pageTitle();
        case 'pageUrl':        return engine.pageUrl();
        default: throw new Error(`Unknown engine fn: ${fn}`);
      }
    },

    async runRecipe(steps, params = {}) {
      const results = [];
      for (const step of steps) {
        try {
          const r = await engine.runStep(step, params);
          results.push({ fn: step.fn, ok: true, result: String(r ?? '') });
        } catch (err) {
          if (step.optional) {
            results.push({ fn: step.fn, ok: false, skipped: true });
          } else {
            results.push({ fn: step.fn, ok: false, error: err.message });
            return { success: false, results, error: err.message };
          }
        }
      }
      return { success: true, results };
    },
  }; // end engine

  // ── Helpers ──────────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function scrollIntoView(el) {
    try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch { /* jsdom */ }
    return new Promise(r => setTimeout(r, 150));
  }

  function findByText(needle, exact, root = document) {
    const lower = needle.toLowerCase();
    const tags = 'a,button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],label,span,div,p,li,td,th';
    return Array.from(root.querySelectorAll(tags)).find(el => {
      const t = el.textContent.trim().toLowerCase();
      return exact ? t === lower : t.includes(lower);
    }) || null;
  }

  function findAllByText(needle, exact, root = document) {
    const lower = needle.toLowerCase();
    const tags = 'a,button,[role="button"],[role="link"],span,div,p,li';
    return Array.from(root.querySelectorAll(tags)).filter(el => {
      const t = el.textContent.trim().toLowerCase();
      return exact ? t === lower : t.includes(lower);
    });
  }

  function findByLabel(needle, root = document) {
    const lower = needle.toLowerCase();
    // Look for <label> elements whose text contains the needle
    const labels = Array.from(root.querySelectorAll('label')).filter(
      l => l.textContent.trim().toLowerCase().includes(lower)
    );
    for (const label of labels) {
      // Explicit for= association
      if (label.htmlFor) {
        const inp = root.getElementById(label.htmlFor);
        if (inp) return inp;
      }
      // Implicit wrapping
      const inp = label.querySelector('input,textarea,select');
      if (inp) return inp;
    }
    // Fallback: aria-label on the input itself
    return Array.from(root.querySelectorAll('input,textarea,select,[contenteditable]')).find(
      el => (el.getAttribute('aria-label') || '').toLowerCase().includes(lower)
    ) || null;
  }

  function findByRole(role, name, root = document) {
    const lowerName = (name || '').toLowerCase();
    const nativeRoleMap = {
      button:   'button,[role="button"]',
      link:     'a,[role="link"]',
      textbox:  'input:not([type=checkbox]):not([type=radio]):not([type=submit]),[role="textbox"],textarea',
      checkbox: 'input[type=checkbox],[role="checkbox"]',
      radio:    'input[type=radio],[role="radio"]',
      combobox: 'select,[role="combobox"]',
      listbox:  'select,[role="listbox"]',
      option:   'option,[role="option"]',
      tab:      '[role="tab"]',
      dialog:   '[role="dialog"]',
      navigation:'nav,[role="navigation"]',
      search:   '[role="search"]',
      main:     'main,[role="main"]',
      banner:   'header,[role="banner"]',
    };
    const selStr = nativeRoleMap[role] || `[role="${role}"]`;
    const candidates = Array.from(root.querySelectorAll(selStr));
    if (!lowerName) return candidates[0] || null;
    return candidates.find(el => {
      const accName = (
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') && (() => {
          const ref = root.getElementById(el.getAttribute('aria-labelledby'));
          return ref ? ref.textContent.trim() : '';
        })() ||
        el.textContent.trim() ||
        el.value || ''
      ).toLowerCase();
      return accName.includes(lowerName);
    }) || null;
  }

  function findAllByRole(role, name, root = document) {
    const result = findByRole(role, name, root);
    return result ? [result] : [];
  }

  /**
   * Split a selector on commas but respect parentheses (e.g. :role("btn","Name")).
   */
  function splitSelector(sel) {
    const parts = [];
    let depth = 0, current = '';
    for (const ch of sel) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  // ── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'page_ping') {
      sendResponse({ ok: true, url: location.href, title: document.title });
      return false;
    }

    if (msg.type === 'pw_exec') {
      engine.runStep(msg.step, msg.params || {})
        .then(r => sendResponse({ ok: true,  result: String(r ?? '') }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === 'pw_recipe') {
      engine.runRecipe(msg.steps, msg.params || {})
        .then(r => sendResponse({ ok: r.success, result: JSON.stringify(r) }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === 'pw_get_text') {
      sendResponse({ ok: true, result: engine.pageText() });
      return false;
    }

    if (msg.type === 'pw_get_links') {
      sendResponse({ ok: true, result: JSON.stringify(engine.links()) });
      return false;
    }

    if (msg.type === 'pw_evaluate') {
      engine.evaluate(msg.script)
        .then(r => sendResponse({ ok: true,  result: r }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === 'pw_read_messages') {
      sendResponse({ ok: true, result: engine.readMessages({ limit: msg.limit || 20 }) });
      return false;
    }

    if (msg.type === 'pw_read_form') {
      sendResponse({ ok: true, result: JSON.stringify(engine.readForm(msg.selector)) });
      return false;
    }

    if (msg.type === 'pw_get_info') {
      sendResponse({
        ok: true,
        result: JSON.stringify({
          url:   location.href,
          title: document.title,
          forms: document.forms.length,
        }),
      });
      return false;
    }

    return false;
  });

  // Expose engine globally for test runners
  window.__tellaflowEngine = engine;

  // Announce readiness to background
  chrome.runtime.sendMessage({ type: 'page_ready', url: location.href, title: document.title });
})();
