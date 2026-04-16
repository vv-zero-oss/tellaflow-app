// Site → example commands mapping
const SITE_EXAMPLES = {
  'mail.google.com':    ['"Compose email to boss@company.com"', '"Search for emails from John"', '"Reply to this email"', '"Archive this email"'],
  'outlook.live.com':   ['"Compose new email in Outlook"', '"Send email to team"', '"Search inbox for invoices"'],
  'www.youtube.com':    ['"Play lofi hip hop on YouTube"', '"Like this video"', '"Subscribe to this channel"', '"Seek forward 30 seconds"'],
  'open.spotify.com':   ['"Play next song on Spotify"', '"Like this track"', '"Toggle shuffle"', '"Search for The Beatles"'],
  'twitter.com':        ['"Tweet: Hello world"', '"Like the first tweet"', '"Search for AI news on Twitter"'],
  'x.com':              ['"Tweet: Hello world"', '"Like the first tweet"', '"Follow this profile"'],
  'www.facebook.com':   ['"Post: Excited about the new update"', '"Like this post"', '"Search for friends"'],
};

const SITE_LABELS = {
  'mail.google.com':    'Gmail',
  'outlook.live.com':   'Outlook',
  'www.youtube.com':    'YouTube',
  'open.spotify.com':   'Spotify',
  'twitter.com':        'Twitter / X',
  'x.com':              'Twitter / X',
  'www.facebook.com':   'Facebook',
};

chrome.runtime.sendMessage({ type: 'get_status' }, async (response) => {
  const dot      = document.getElementById('dot');
  const status   = document.getElementById('status');
  const panel    = document.getElementById('site-panel');
  const siteName = document.getElementById('site-name');
  const recipeList = document.getElementById('recipe-list');
  const exCmds   = document.getElementById('example-cmds');
  const footer   = document.getElementById('footer');

  const connected = response?.connected ?? false;
  const sites     = response?.recipeSites ?? [];

  if (connected) {
    dot.classList.add('connected');
    status.textContent = 'Connected to Tellaflow agent ✓';

    // Detect current tab URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        const label    = SITE_LABELS[hostname];
        const examples = SITE_EXAMPLES[hostname];

        if (label) {
          panel.classList.add('visible');
          siteName.textContent = label;

          // Fetch actions from background
          chrome.tabs.sendMessage(tab.id, { type: 'pw_evaluate', script: '"ready"' }, () => {});
          const actionResult = await new Promise(resolve => {
            chrome.runtime.sendMessage({ id: 'popup-'+Date.now(), action: 'get_site_actions', params: {} }, resolve);
          }).catch(() => null);

          if (actionResult && !actionResult.error) {
            // Parse the text-format action list and render
            const lines = String(actionResult.result || actionResult).split('\n').filter(l => l.includes('•'));
            recipeList.innerHTML = lines.slice(0, 8).map(line => {
              const match = line.match(/•\s+(\S+?)\s*(?:\(([^)]*)\))?\s*—\s*(.+)/);
              if (!match) return '';
              const [, name, params, desc] = match;
              return `<div class="recipe-item"><span class="name">${name}</span>${params ? `(${params})` : ''} — ${desc}</div>`;
            }).join('');
          } else {
            // Fallback: show from SITE_RECIPES keys
            recipeList.innerHTML = sites
              .filter(s => s === hostname)
              .slice(0, 6)
              .map(s => `<div class="recipe-item"><span class="name">${s}</span></div>`)
              .join('') || '<div class="recipe-item" style="color:#666">Ask "what can I do here?"</div>';
          }

          // Update example commands
          if (examples) {
            exCmds.innerHTML = examples.map(e => `<div class="cmd">${e}</div>`).join('');
          }
        }
      } catch {}
    }
  } else {
    status.textContent = 'Not connected — open Tellaflow app';
    footer.textContent = 'ws://localhost:9009 — waiting for agent…';
  }
});
