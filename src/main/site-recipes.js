/**
 * site-recipes.js
 *
 * Mirror of the recipe definitions in extension/background.js, kept here so
 * the Electron main process can:
 *   1. Know which action names / parameters exist per site
 *   2. Auto-generate LLM tool descriptions at runtime
 *   3. Inject only the relevant recipes when the agent detects a known URL
 *
 * Key: exact hostname as returned by `new URL(url).hostname`
 */

const SITE_RECIPES = {

  'mail.google.com': {
    label: 'Gmail',
    actions: {
      gmail_compose:        { description: 'Open the Gmail compose window',                            params: {} },
      gmail_set_recipient:  { description: 'Set the To email address in the compose window',           params: { email: { type: 'string', description: 'Recipient email address' } } },
      gmail_set_subject:    { description: 'Set the email subject line',                               params: { subject: { type: 'string', description: 'Subject text' } } },
      gmail_set_body:       { description: 'Type the email body text',                                 params: { body: { type: 'string', description: 'Body content' } } },
      gmail_send:           { description: 'Send the currently composed email',                        params: {} },
      gmail_search:         { description: 'Search Gmail inbox',                                       params: { query: { type: 'string', description: 'Search query e.g. "from:boss"' } } },
      gmail_open_first:     { description: 'Open the first email in the current list',                 params: {} },
      gmail_reply:          { description: 'Reply to the currently open email',                        params: {} },
      gmail_archive:        { description: 'Archive the currently open email',                         params: {} },
      gmail_delete:         { description: 'Delete / trash the currently open email',                  params: {} },
      gmail_label:          { description: 'Apply a label to the current email',                       params: { label: { type: 'string', description: 'Label name to apply' } } },
    },
  },

  'outlook.live.com': {
    label: 'Outlook',
    actions: {
      outlook_compose:       { description: 'Open a new email compose window in Outlook',              params: {} },
      outlook_set_recipient: { description: 'Set the To recipient email address in Outlook',           params: { email: { type: 'string', description: 'Recipient email address' } } },
      outlook_set_subject:   { description: 'Set the email subject in Outlook',                        params: { subject: { type: 'string', description: 'Subject text' } } },
      outlook_set_body:      { description: 'Set the email body in Outlook',                           params: { body: { type: 'string', description: 'Body text' } } },
      outlook_send:          { description: 'Send the current email in Outlook',                       params: {} },
      outlook_search:        { description: 'Search emails in Outlook',                                params: { query: { type: 'string', description: 'Search term' } } },
      outlook_reply:         { description: 'Reply to the currently open email in Outlook',            params: {} },
    },
  },

  'outlook.office.com': {
    label: 'Outlook (Office 365)',
    actions: {
      outlook_compose:       { description: 'Open a new email compose window',                         params: {} },
      outlook_set_recipient: { description: 'Set the To recipient',                                    params: { email: { type: 'string', description: 'Email address' } } },
      outlook_set_subject:   { description: 'Set the subject',                                         params: { subject: { type: 'string', description: 'Subject' } } },
      outlook_set_body:      { description: 'Set the body',                                            params: { body: { type: 'string', description: 'Body text' } } },
      outlook_send:          { description: 'Send the email',                                          params: {} },
      outlook_reply:         { description: 'Reply to the open email',                                 params: {} },
    },
  },

  'www.youtube.com': {
    label: 'YouTube',
    actions: {
      youtube_play_pause:       { description: 'Play or pause the current YouTube video',              params: {} },
      youtube_like:             { description: 'Like the current YouTube video',                       params: {} },
      youtube_dislike:          { description: 'Dislike the current YouTube video',                    params: {} },
      youtube_subscribe:        { description: 'Subscribe to the channel of the current video',        params: {} },
      youtube_mute:             { description: 'Toggle mute on the current video',                     params: {} },
      youtube_fullscreen:       { description: 'Toggle fullscreen',                                    params: {} },
      youtube_seek_forward:     { description: 'Seek video forward by N seconds',                      params: { seconds: { type: 'string', description: 'Seconds (default 10)' } } },
      youtube_seek_back:        { description: 'Seek video back by N seconds',                         params: { seconds: { type: 'string', description: 'Seconds (default 10)' } } },
      youtube_set_volume:       { description: 'Set YouTube video volume (0–100)',                     params: { level: { type: 'string', description: 'Volume 0–100' } } },
      youtube_play_first_result:{ description: 'Click the first video in YouTube search results',      params: {} },
      youtube_search:           { description: 'Search YouTube for a query',                           params: { query: { type: 'string', description: 'Search query e.g. "lofi hip hop"' } } },
      youtube_add_to_queue:     { description: 'Add the first search result to the watch queue',       params: {} },
      youtube_comment:          { description: 'Post a comment on the current YouTube video',          params: { text: { type: 'string', description: 'Comment text' } } },
    },
  },

  'open.spotify.com': {
    label: 'Spotify',
    actions: {
      spotify_play_pause:        { description: 'Play or pause the current track in Spotify Web Player', params: {} },
      spotify_next:              { description: 'Skip to the next track in Spotify',                   params: {} },
      spotify_previous:          { description: 'Go to the previous track in Spotify',                 params: {} },
      spotify_like:              { description: 'Save / heart the current track in Spotify',           params: {} },
      spotify_shuffle:           { description: 'Toggle shuffle mode in Spotify',                      params: {} },
      spotify_repeat:            { description: 'Toggle repeat mode in Spotify',                       params: {} },
      spotify_set_volume:        { description: 'Set Spotify volume 0–100',                            params: { level: { type: 'string', description: 'Volume 0–100' } } },
      spotify_search:            { description: 'Search Spotify for a song, artist, or playlist',      params: { query: { type: 'string', description: 'Search query e.g. "The Beatles"' } } },
      spotify_play_first_result: { description: 'Play the first result after a Spotify search',        params: {} },
    },
  },

  'twitter.com': buildTwitterMeta(),
  'x.com':       buildTwitterMeta(),

  'www.facebook.com': {
    label: 'Facebook',
    actions: {
      facebook_post:    { description: 'Create and publish a new Facebook post',                       params: { text: { type: 'string', description: 'Post text' } } },
      facebook_like:    { description: 'Like the most prominent content on the page',                  params: {} },
      facebook_comment: { description: 'Leave a comment on the current Facebook post',                 params: { text: { type: 'string', description: 'Comment text' } } },
      facebook_share:   { description: 'Share the current Facebook post',                              params: {} },
      facebook_search:  { description: 'Search Facebook',                                              params: { query: { type: 'string', description: 'Search query' } } },
    },
  },

  'app.slack.com': {
    label: 'Slack',
    actions: {
      slack_open_dm:      { description: 'Open a direct message with a person by name',                params: { name: { type: 'string', description: 'Person name or username' } } },
      slack_open_channel: { description: 'Navigate to a Slack channel by name',                        params: { channel: { type: 'string', description: 'Channel name without #, e.g. "general"' } } },
      slack_send_message: { description: 'Type and send a message in the current Slack channel or DM', params: { message: { type: 'string', description: 'Message text to send' } } },
      slack_read_messages:{ description: 'Read the last N messages in the current channel or DM',      params: { count: { type: 'string', description: 'Number of messages to read' } } },
      slack_search:       { description: 'Search Slack for messages, files, or channels',              params: { query: { type: 'string', description: 'Search query' } } },
      slack_set_status:   { description: 'Set your Slack status',                                      params: { emoji: { type: 'string', description: 'Emoji code' }, text: { type: 'string', description: 'Status text' } } },
      slack_react:        { description: 'Add an emoji reaction to the last message',                  params: { emoji: { type: 'string', description: 'Emoji name e.g. "thumbsup"' } } },
    },
  },

  'discord.com': {
    label: 'Discord',
    actions: {
      discord_open_server:  { description: 'Navigate to a Discord server by name',                     params: { server: { type: 'string', description: 'Server name' } } },
      discord_open_channel: { description: 'Open a text channel by name',                              params: { channel: { type: 'string', description: 'Channel name' } } },
      discord_send_message: { description: 'Send a message in the current Discord channel',            params: { message: { type: 'string', description: 'Message text' } } },
      discord_read_messages:{ description: 'Read recent messages in the current channel',              params: { count: { type: 'string', description: 'Number of messages' } } },
      discord_react:        { description: 'Add an emoji reaction to the last message',                params: { emoji: { type: 'string', description: 'Emoji' } } },
      discord_search:       { description: 'Search messages in the current server',                    params: { query: { type: 'string', description: 'Search query' } } },
    },
  },

  'docs.google.com': {
    label: 'Google Docs / Sheets / Forms',
    actions: {
      sheets_read_cell:   { description: 'Read the value of a cell (e.g. A1) in Google Sheets',       params: { cell: { type: 'string', description: 'Cell reference e.g. "A1"' } } },
      sheets_write_cell:  { description: 'Write a value to a specific cell in Google Sheets',          params: { cell: { type: 'string', description: 'Cell reference' }, value: { type: 'string', description: 'Value to write' } } },
      forms_fill_field:   { description: 'Fill a Google Form field by label name',                     params: { label: { type: 'string', description: 'Field label' }, value: { type: 'string', description: 'Value to enter' } } },
      forms_submit:       { description: 'Submit the current Google Form',                             params: {} },
      docs_read:          { description: 'Read the text content of the current Google Doc',            params: {} },
      docs_find_replace:  { description: 'Find and replace text in a Google Doc',                      params: { find: { type: 'string', description: 'Text to find' }, replace: { type: 'string', description: 'Replacement' } } },
    },
  },

  'calendar.google.com': {
    label: 'Google Calendar',
    actions: {
      calendar_create_event: { description: 'Create a new calendar event',                            params: { title: { type: 'string', description: 'Event title' }, date: { type: 'string', description: 'Date/time e.g. "tomorrow 3pm"' } } },
      calendar_read_today:   { description: 'Read today\'s calendar events',                          params: {} },
    },
  },

  'github.com': {
    label: 'GitHub',
    actions: {
      github_search:       { description: 'Search GitHub for repos, issues, or code',                 params: { query: { type: 'string', description: 'Search query' } } },
      github_create_pr:    { description: 'Click New Pull Request on the current repo',               params: {} },
      github_open_issue:   { description: 'Navigate to the Issues tab of the current repo',           params: {} },
      github_create_issue: { description: 'Create a new GitHub issue with title and body',            params: { title: { type: 'string', description: 'Issue title' }, body: { type: 'string', description: 'Issue body' } } },
    },
  },

  'www.notion.so': {
    label: 'Notion',
    actions: {
      notion_new_page:  { description: 'Create a new Notion page',                                    params: { title: { type: 'string', description: 'Page title' } } },
      notion_add_text:  { description: 'Add text to the current Notion page',                         params: { text: { type: 'string', description: 'Text to add' } } },
      notion_search:    { description: 'Search Notion pages and databases',                            params: { query: { type: 'string', description: 'Search query' } } },
    },
  },
};

function buildTwitterMeta() {
  return {
    label: 'Twitter / X',
    actions: {
      twitter_compose:  { description: 'Open the compose box and type a tweet/post',                   params: { text: { type: 'string', description: 'Tweet text (max 280 chars)' } } },
      twitter_send:     { description: 'Post/send the composed tweet',                                 params: {} },
      twitter_tweet:    { description: 'Compose and post a tweet in one step',                         params: { text: { type: 'string', description: 'Tweet text (max 280 chars)' } } },
      twitter_like:     { description: 'Like the first tweet in the timeline',                         params: {} },
      twitter_retweet:  { description: 'Retweet the first tweet in the timeline',                      params: {} },
      twitter_reply:    { description: 'Reply to the first tweet in the timeline',                     params: { text: { type: 'string', description: 'Reply text' } } },
      twitter_follow:   { description: 'Follow the profile currently shown on screen',                 params: {} },
      twitter_search:   { description: 'Search Twitter/X for a query',                                 params: { query: { type: 'string', description: 'Search query' } } },
    },
  };
}

/**
 * Returns a flat list of LLM-ready tool definitions for a given hostname.
 * These are injected into the agent's toolset when the browser is on that site.
 */
function getToolsForHostname(hostname) {
  const recipe = SITE_RECIPES[hostname];
  if (!recipe) return [];

  return Object.entries(recipe.actions).map(([name, def]) => {
    const properties = {};
    const required = [];
    for (const [paramName, paramDef] of Object.entries(def.params || {})) {
      properties[paramName] = { type: paramDef.type || 'string', description: paramDef.description };
      required.push(paramName);
    }
    return {
      name,
      description: `[${recipe.label}] ${def.description}`,
      parameters: def.params || {},
      // execute is bound at runtime by browser-ext.js
      _isRecipe: true,
      _hostname: hostname,
    };
  });
}

/**
 * Returns a human-readable summary of available actions for all known sites.
 * Useful for the LLM's system context.
 */
function getRecipeSummary() {
  const lines = ['## Browser Site Actions (use site_action tool when on these sites)'];
  for (const [host, recipe] of Object.entries(SITE_RECIPES)) {
    // De-duplicate twitter.com / x.com
    if (host === 'x.com') continue;
    lines.push(`\n### ${recipe.label} (${host})`);
    for (const [name, def] of Object.entries(recipe.actions)) {
      const params = Object.keys(def.params || {});
      lines.push(`  ${name}${params.length ? `(${params.join(', ')})` : ''}: ${def.description}`);
    }
  }
  return lines.join('\n');
}

module.exports = { SITE_RECIPES, getToolsForHostname, getRecipeSummary };
