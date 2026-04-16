/**
 * browser.js — Native macOS browser control via osascript
 *
 * Controls Safari and Chrome without needing an extension.
 * For deep page interaction (click, fill, read DOM) the Chrome extension
 * bridge (ws-bridge.js) is used via the browser_ext_* tools.
 */

const { execFile, exec } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const execAsync     = promisify(exec);

async function osa(script) {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 10000 });
  return stdout.trim();
}

function escapeForOsa(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Fetch the first YouTube watch URL for a query using curl — no extension or
 * "Allow JavaScript from Apple Events" required.
 */
async function fetchFirstYoutubeUrl(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const { stdout } = await execAsync(
    `curl -s -L --max-time 12 -H "User-Agent: Mozilla/5.0" -H "Accept-Language: en-US" "${url}" | grep -o '"videoId":"[a-zA-Z0-9_-]*"' | head -1`,
    { timeout: 15000 }
  );
  const match = stdout.trim().match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  if (!match) throw new Error('Could not find a video in YouTube search results');
  return `https://www.youtube.com/watch?v=${match[1]}`;
}

/**
 * Resolve which browser to use. Prefers Chrome if running, else Safari.
 */
async function resolveBrowser(preferred) {
  if (preferred) return preferred;
  try {
    const running = await osa(
      'tell application "System Events" to get name of every process whose background only is false'
    );
    if (running.includes('Google Chrome')) return 'Google Chrome';
    if (running.includes('Safari')) return 'Safari';
    return 'Safari'; // default
  } catch {
    return 'Safari';
  }
}

module.exports = {
  name: 'Browser',
  description: 'Control Safari and Chrome: open URLs, search, manage tabs, interact with pages',
  tools: [
    // ── Navigation ──────────────────────────────────────────────────────────────

    {
      name: 'open_url',
      description:
        'Open a URL in Safari or Chrome. Creates a new tab if the browser is already open. ' +
        'Use this for "go to X", "open X website", "navigate to X".',
      parameters: {
        url:     { type: 'string', description: 'Full URL including https://, e.g. "https://google.com"' },
        browser: { type: 'string', description: 'Browser to use: "Safari" or "Google Chrome". Auto-detects if omitted.' },
      },
      async execute({ url, browser }) {
        const b = await resolveBrowser(browser);
        const safeUrl = escapeForOsa(url);
        if (b === 'Google Chrome') {
          await osa(`
            tell application "Google Chrome"
              activate
              if (count every window) = 0 then
                make new window
              end if
              set URL of active tab of front window to "${safeUrl}"
            end tell`);
        } else {
          await osa(`
            tell application "Safari"
              activate
              if (count every window) = 0 then
                make new window
              end if
              set URL of current tab of front window to "${safeUrl}"
            end tell`);
        }
        return `Opened ${url} in ${b}`;
      },
    },

    {
      name: 'search_google',
      description:
        'Search Google in the default browser. Use when the user says "search for X" or "look up X" without a specific site.',
      parameters: {
        query:   { type: 'string', description: 'Search query' },
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ query, browser }) {
        const encoded = encodeURIComponent(query);
        const url = `https://www.google.com/search?q=${encoded}`;
        const b = await resolveBrowser(browser);
        const safeUrl = escapeForOsa(url);
        if (b === 'Google Chrome') {
          await osa(`
            tell application "Google Chrome"
              activate
              if (count every window) = 0 then make new window
              set URL of active tab of front window to "${safeUrl}"
            end tell`);
        } else {
          await osa(`
            tell application "Safari"
              activate
              if (count every window) = 0 then make new window
              set URL of current tab of front window to "${safeUrl}"
            end tell`);
        }
        return `Searching Google for "${query}" in ${b}`;
      },
    },

    {
      name: 'search_youtube',
      description:
        'Search YouTube for a song, video, or channel. ' +
        'ALWAYS use this first when user says "play X on YouTube" or "find X on YouTube". ' +
        'After this, call youtube_click_first_result to open and play the first video.',
      parameters: {
        query:   { type: 'string', description: 'Song, video, or playlist name, e.g. "lofi hip hop"' },
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ query, browser }) {
        const encoded = encodeURIComponent(query);
        const url = `https://www.youtube.com/results?search_query=${encoded}`;
        const b = await resolveBrowser(browser);
        const safeUrl = escapeForOsa(url);
        if (b === 'Google Chrome') {
          await osa(`
            tell application "Google Chrome"
              activate
              if (count every window) = 0 then make new window
              set URL of active tab of front window to "${safeUrl}"
            end tell`);
        } else {
          await osa(`
            tell application "Safari"
              activate
              if (count every window) = 0 then make new window
              set URL of current tab of front window to "${safeUrl}"
            end tell`);
        }
        return `Opened YouTube search for "${query}" in ${b}. Now call youtube_click_first_result to play.`;
      },
    },

    {
      name: 'open_new_tab',
      description: 'Open a new blank tab in the browser.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        if (b === 'Google Chrome') {
          await osa(`tell application "Google Chrome" to activate\ntell application "Google Chrome" to make new tab at end of tabs of front window`);
        } else {
          await osa(`tell application "Safari" to activate\ntell application "Safari" to make new tab at end of tabs of front window`);
        }
        return `Opened new tab in ${b}`;
      },
    },

    {
      name: 'get_current_url',
      description: 'Get the URL of the currently active tab.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        let url;
        if (b === 'Google Chrome') {
          url = await osa(`tell application "Google Chrome" to get URL of active tab of front window`);
        } else {
          url = await osa(`tell application "Safari" to get URL of current tab of front window`);
        }
        return url || '(no URL)';
      },
    },

    {
      name: 'get_page_title',
      description: 'Get the title of the currently active browser tab.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        let title;
        if (b === 'Google Chrome') {
          title = await osa(`tell application "Google Chrome" to get title of active tab of front window`);
        } else {
          title = await osa(`tell application "Safari" to get name of current tab of front window`);
        }
        return title || '(no title)';
      },
    },

    {
      name: 'browser_back',
      description: 'Navigate back in the browser history (like pressing the back button).',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        await osa(`
          tell application "${b}" to activate
          tell application "System Events" to key code 123 using command down`);
        return `Went back in ${b}`;
      },
    },

    {
      name: 'browser_reload',
      description: 'Reload the current page.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        if (b === 'Google Chrome') {
          await osa(`tell application "Google Chrome" to reload active tab of front window`);
        } else {
          await osa(`tell application "Safari" to activate\ntell application "System Events" to keystroke "r" using command down`);
        }
        return `Reloaded page in ${b}`;
      },
    },

    // ── Tab management ─────────────────────────────────────────────────────────

    {
      name: 'list_tabs',
      description: 'List all open tabs in the browser with their titles and URLs.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        let result;
        if (b === 'Google Chrome') {
          result = await osa(`
            tell application "Google Chrome"
              set output to ""
              set i to 1
              repeat with t in tabs of front window
                set output to output & i & ". " & title of t & " — " & URL of t & "\\n"
                set i to i + 1
              end repeat
              return output
            end tell`);
        } else {
          result = await osa(`
            tell application "Safari"
              set output to ""
              set i to 1
              repeat with t in tabs of front window
                set output to output & i & ". " & name of t & " — " & URL of t & "\\n"
                set i to i + 1
              end repeat
              return output
            end tell`);
        }
        return result.trim() || 'No tabs open';
      },
    },

    {
      name: 'close_tab',
      description: 'Close the current active tab.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        await osa(`
          tell application "${b}" to activate
          tell application "System Events" to keystroke "w" using command down`);
        return `Closed tab in ${b}`;
      },
    },

    // ── Page interaction via JavaScript ─────────────────────────────────────────

    {
      name: 'run_js_in_page',
      description:
        'Run JavaScript in the current browser tab and return the result. ' +
        'Use for reading page content, clicking elements, filling forms. ' +
        'Requires "Allow JavaScript from Apple Events" to be enabled in Safari Developer menu, or Chrome with DevTools Protocol.',
      parameters: {
        script:  { type: 'string', description: 'JavaScript code to execute in the page' },
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ script, browser }) {
        const b = await resolveBrowser(browser);
        const safeScript = escapeForOsa(script);
        let result;
        if (b === 'Google Chrome') {
          result = await osa(`tell application "Google Chrome" to execute active tab of front window javascript "${safeScript}"`);
        } else {
          result = await osa(`tell application "Safari" to do JavaScript "${safeScript}" in current tab of front window`);
        }
        return result || '(no return value)';
      },
    },

    {
      name: 'get_page_text',
      description:
        'Get the visible text content of the current browser tab page. ' +
        'Useful for reading search results, articles, etc.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        const script = 'document.body.innerText.trim().slice(0, 4000)';
        const safeScript = escapeForOsa(script);
        let result;
        if (b === 'Google Chrome') {
          result = await osa(`tell application "Google Chrome" to execute active tab of front window javascript "${safeScript}"`);
        } else {
          result = await osa(`tell application "Safari" to do JavaScript "${safeScript}" in current tab of front window`);
        }
        return result || '(no text content)';
      },
    },

    {
      name: 'click_element',
      description:
        'Click an element on the page by CSS selector. ' +
        'Examples: "#submit-button", "button.play-btn", "a[href*=youtube]".',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
        browser:  { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ selector, browser }) {
        const b = await resolveBrowser(browser);
        const script = `(function(){var el=document.querySelector('${selector.replace(/'/g, "\\'")}');if(!el)return 'Element not found: ${selector}';el.click();return 'Clicked: '+el.textContent.trim().slice(0,80);})()`;
        const safeScript = escapeForOsa(script);
        let result;
        if (b === 'Google Chrome') {
          result = await osa(`tell application "Google Chrome" to execute active tab of front window javascript "${safeScript}"`);
        } else {
          result = await osa(`tell application "Safari" to do JavaScript "${safeScript}" in current tab of front window`);
        }
        return result || 'Done';
      },
    },

    {
      name: 'fill_input',
      description: 'Fill a text input or search box on the page with a value.',
      parameters: {
        selector: { type: 'string', description: 'CSS selector of the input element' },
        value:    { type: 'string', description: 'Text to type into the input' },
        browser:  { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ selector, value, browser }) {
        const b = await resolveBrowser(browser);
        const safeValue = value.replace(/'/g, "\\'");
        const safeSelector = selector.replace(/'/g, "\\'");
        const script = `(function(){var el=document.querySelector('${safeSelector}');if(!el)return 'Not found';el.focus();el.value='${safeValue}';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return 'Filled';})()`;
        const safeScript = escapeForOsa(script);
        let result;
        if (b === 'Google Chrome') {
          result = await osa(`tell application "Google Chrome" to execute active tab of front window javascript "${safeScript}"`);
        } else {
          result = await osa(`tell application "Safari" to do JavaScript "${safeScript}" in current tab of front window`);
        }
        return result || 'Done';
      },
    },

    // ── YouTube specific ────────────────────────────────────────────────────────

    {
      name: 'youtube_play_pause',
      description: 'Play or pause a video that is ALREADY open on YouTube. Do NOT use this to start a new video — use search_youtube + youtube_click_first_result instead.',
      parameters: {
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ browser } = {}) {
        const b = await resolveBrowser(browser);
        const script = `(function(){var v=document.querySelector('video');if(!v)return 'No video found';if(v.paused){v.play();return 'Playing'}else{v.pause();return 'Paused'}})()`;
        const safeScript = escapeForOsa(script);
        let result;
        if (b === 'Google Chrome') {
          result = await osa(`tell application "Google Chrome" to execute active tab of front window javascript "${safeScript}"`);
        } else {
          result = await osa(`tell application "Safari" to do JavaScript "${safeScript}" in current tab of front window`);
        }
        return result || 'Done';
      },
    },

    {
      name: 'youtube_click_first_result',
      description:
        'After calling search_youtube, navigate to and start playing the first video result. ' +
        'Works without any extension by using an HTTP request to find the video URL.',
      parameters: {
        query:   { type: 'string', description: 'The same search query passed to search_youtube. Used to find the first result via HTTP.' },
        browser: { type: 'string', description: 'Browser to use. Auto-detects if omitted.' },
      },
      async execute({ query = '', browser } = {}) {
        const b = await resolveBrowser(browser);

        // ── Strategy 1: extension (most reliable) ──────────────────────────
        try {
          const wsBridge = require('../ws-bridge');
          if (wsBridge.isExtensionConnected()) {
            await new Promise(r => setTimeout(r, 1500));
            const result = await wsBridge.sendToExtension('yt_play_first_result', {});
            return `Playing (via extension): ${result}`;
          }
        } catch { /* extension not available */ }

        // ── Strategy 2: HTTP fetch the video URL and navigate directly ─────
        // This is the most reliable fallback — no JS injection needed
        if (query) {
          try {
            const videoUrl = await fetchFirstYoutubeUrl(query);
            const safeUrl = escapeForOsa(videoUrl);
            if (b === 'Google Chrome') {
              // Chrome is already open from search_youtube — just update the URL
              await osa(`
                tell application "Google Chrome"
                  activate
                  set URL of active tab of front window to "${safeUrl}"
                end tell`);
            } else {
              await osa(`
                tell application "Safari"
                  activate
                  set URL of current tab of front window to "${safeUrl}"
                end tell`);
            }
            // Wait for page to load, then press Space to play
            await new Promise(r => setTimeout(r, 3000));
            await osa(`
              tell application "${b}" to activate
              tell application "System Events" to keystroke "k"`);
            return `Playing video in ${b}: ${videoUrl}`;
          } catch (fetchErr) {
            console.warn('[browser] HTTP fetch failed:', fetchErr.message);
          }
        }

        // ── Strategy 3: JS injection (requires "Allow JS from Apple Events") ─
        try {
          await new Promise(r => setTimeout(r, 1500));
          const script = `(function(){var el=document.querySelector('ytd-video-renderer a#video-title,a#video-title');if(!el)return 'No results found';var t=el.textContent.trim().slice(0,80);el.click();return 'Playing: '+t;})()`;
          const safeScript = escapeForOsa(script);
          let result;
          if (b === 'Google Chrome') {
            result = await osa(`tell application "Google Chrome" to execute active tab of front window javascript "${safeScript}"`);
          } else {
            result = await osa(`tell application "Safari" to do JavaScript "${safeScript}" in current tab of front window`);
          }
          if (result && !result.includes('No results') && !result.includes('Error')) return result;
        } catch { /* JS injection not available */ }

        // ── Strategy 4: keyboard navigation fallback ───────────────────────
        await new Promise(r => setTimeout(r, 2000));
        await osa(`
          tell application "${b}" to activate
          delay 0.3
          tell application "System Events"
            -- YouTube keyboard: Tab enough times to reach first video then Enter
            repeat 7 times
              key code 48
              delay 0.08
            end repeat
            key code 36
          end tell`);
        return `Attempted keyboard navigation to first YouTube result in ${b}`;
      },
    },
  ],
};
