'use strict';

/**
 * App-context detection for adaptive grammar tone and formatting.
 *
 * Classifies the frontmost application into a category and returns
 * the appropriate tone/formatting hints for grammar correction.
 */

const APP_CATEGORIES = {
  code: {
    apps: [
      'Code', 'Visual Studio Code', 'Xcode', 'IntelliJ IDEA', 'WebStorm',
      'PyCharm', 'Sublime Text', 'Atom', 'Nova', 'TextMate', 'Vim', 'Neovim',
      'Terminal', 'iTerm2', 'Warp', 'Alacritty', 'kitty', 'Cursor',
    ],
    tone: 'technical',
    formatting: 'code', // preserve technical terms, no smart quotes
  },
  email: {
    apps: ['Mail', 'Outlook', 'Spark', 'Airmail', 'Superhuman', 'Gmail'],
    tone: 'formal',
    formatting: 'prose',
  },
  chat: {
    apps: [
      'Slack', 'Discord', 'Messages', 'Telegram', 'WhatsApp', 'Signal',
      'Microsoft Teams', 'Zoom',
    ],
    tone: 'casual',
    formatting: 'chat', // shorter, no formal punctuation
  },
  writing: {
    apps: [
      'Pages', 'Google Docs', 'Microsoft Word', 'Notion', 'Obsidian',
      'Bear', 'Ulysses', 'iA Writer', 'Scrivener', 'Craft',
    ],
    tone: 'formal',
    formatting: 'prose',
  },
  notes: {
    apps: ['Notes', 'Stickies', 'TextEdit', 'Typora'],
    tone: 'casual',
    formatting: 'prose',
  },
};

const DEFAULT_CONTEXT = { category: 'general', tone: null, formatting: 'prose' };

/**
 * Classify the frontmost app and return context hints.
 *
 * Matching is case-insensitive and uses includes so that partial matches
 * work (e.g. "Google Chrome" will match an entry containing "Chrome").
 *
 * @param {string} appName - The name of the frontmost application.
 * @returns {{ category: string, tone: string|null, formatting: string }}
 */
function getAppContext(appName) {
  if (!appName || typeof appName !== 'string') {
    return { ...DEFAULT_CONTEXT };
  }

  const normalised = appName.toLowerCase();

  for (const [category, info] of Object.entries(APP_CATEGORIES)) {
    const matched = info.apps.some((entry) => {
      const entryLower = entry.toLowerCase();
      // Check both directions: app name contains the entry OR entry contains app name
      return normalised.includes(entryLower) || entryLower.includes(normalised);
    });

    if (matched) {
      return { category, tone: info.tone, formatting: info.formatting };
    }
  }

  return { ...DEFAULT_CONTEXT };
}

/**
 * Determine the effective tone to use for grammar correction.
 *
 * If app-context awareness is enabled and the detected app has a specific
 * tone, use that. Otherwise fall back to the user's configured tone.
 *
 * @param {string} appName - The name of the frontmost application.
 * @param {string} userTone - The user's configured grammar tone.
 * @param {boolean} appContextEnabled - Whether app-context detection is active.
 * @returns {string} The tone to use.
 */
function getEffectiveTone(appName, userTone, appContextEnabled) {
  if (!appContextEnabled) {
    return userTone;
  }

  const ctx = getAppContext(appName);
  return ctx.tone || userTone;
}

module.exports = {
  APP_CATEGORIES,
  getAppContext,
  getEffectiveTone,
};
