/**
 * Tellaflow Agent Bridge — Background Service Worker
 *
 * WebSocket bridge between the Electron app and the active Chrome tab.
 * Provides a full Playwright-like automation API plus predefined site recipes.
 *
 * Protocol:  ← { id, action, params }   from Electron
 *            → { id, result } | { id, error }
 *
 * Site Recipes: pre-built step sequences for Gmail, Outlook, YouTube,
 *               Spotify, Twitter/X, Facebook — so the LLM gets high-level
 *               action names instead of CSS selectors.
 */

const WS_PORT = 9009;
const RECONNECT_DELAY_MS = 3000;

let ws = null;
let connected = false;

// ── Site Recipe Definitions ──────────────────────────────────────────────────
// Each recipe action is a list of engine steps (see content.js for fn names).
// {{param}} placeholders are interpolated at execution time.

const SITE_RECIPES = {

  // ── Gmail ──────────────────────────────────────────────────────────────────
  'mail.google.com': {
    label: 'Gmail',
    actions: {

      gmail_compose: {
        description: 'Open the Gmail compose window',
        params: {},
        steps: [
          { fn: 'click', args: ['[gh="cm"], :aria("Compose")'] },
          { fn: 'waitFor', args: ['.Am.Al.editable, [aria-label="Message Body"]', 6000] },
        ],
      },

      gmail_set_recipient: {
        description: 'Set the To email address in the compose window',
        params: { email: 'Recipient email address' },
        steps: [
          { fn: 'focus',  args: ['[name="to"], input[aria-label="To"]'] },
          { fn: 'type',   args: ['[name="to"], input[aria-label="To"]', '{{email}}', 30] },
          { fn: 'press',  args: ['Tab'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      gmail_set_subject: {
        description: 'Set the email subject line',
        params: { subject: 'Subject text' },
        steps: [
          { fn: 'click', args: ['[name="subjectbox"], input[aria-label="Subject"]'] },
          { fn: 'fill',  args: ['[name="subjectbox"], input[aria-label="Subject"]', '{{subject}}'] },
        ],
      },

      gmail_set_body: {
        description: 'Type the email body text',
        params: { body: 'Email body content' },
        steps: [
          { fn: 'click', args: ['.Am.Al.editable, [aria-label="Message Body"]'] },
          { fn: 'type',  args: ['.Am.Al.editable, [aria-label="Message Body"]', '{{body}}', 20] },
        ],
      },

      gmail_send: {
        description: 'Send the currently composed email',
        params: {},
        steps: [
          { fn: 'click', args: ['[aria-label^="Send"], div[aria-label^="Send ‪"]'] },
          { fn: 'waitMs', args: [1000] },
        ],
      },

      gmail_search: {
        description: 'Search Gmail inbox for emails matching a query',
        params: { query: 'Search query, e.g. "from:boss meeting"' },
        steps: [
          { fn: 'click', args: ['input[aria-label="Search mail"], input[name="q"]'] },
          { fn: 'clear', args: ['input[aria-label="Search mail"], input[name="q"]'] },
          { fn: 'type',  args: ['input[aria-label="Search mail"], input[name="q"]', '{{query}}', 20] },
          { fn: 'press', args: ['Enter'] },
          { fn: 'waitMs', args: [1500] },
        ],
      },

      gmail_open_first: {
        description: 'Open the first email in the current list',
        params: {},
        steps: [
          { fn: 'click',  args: ['tr.zA:first-of-type, [role="row"]:first-child'] },
          { fn: 'waitMs', args: [1000] },
        ],
      },

      gmail_reply: {
        description: 'Reply to the currently open email',
        params: {},
        steps: [
          { fn: 'click',  args: ['button[aria-label^="Reply"], :aria("Reply")'] },
          { fn: 'waitFor', args: ['.Am.Al.editable', 5000] },
        ],
      },

      gmail_archive: {
        description: 'Archive the currently open email',
        params: {},
        steps: [
          { fn: 'click', args: ['button[aria-label="Archive"], :aria("Archive")'] },
          { fn: 'waitMs', args: [500] },
        ],
      },

      gmail_mark_read: {
        description: 'Mark the current email as read',
        params: {},
        steps: [
          { fn: 'click',    args: ['button[aria-label="Mark as read"], :aria("Mark as read")'], optional: true },
          { fn: 'waitMs',   args: [300] },
        ],
      },

      gmail_delete: {
        description: 'Delete / move to trash the currently open email',
        params: {},
        steps: [
          { fn: 'click',  args: ['button[aria-label="Delete"], :aria("Delete")'] },
          { fn: 'waitMs', args: [500] },
        ],
      },

      gmail_label: {
        description: 'Apply a label to the current email',
        params: { label: 'Label name to apply' },
        steps: [
          { fn: 'click',    args: [':aria("Labels")'] },
          { fn: 'waitMs',   args: [500] },
          { fn: 'clickText', args: ['{{label}}'] },
          { fn: 'waitMs',   args: [300] },
        ],
      },
    },
  },

  // ── Outlook ────────────────────────────────────────────────────────────────
  'outlook.live.com': {
    label: 'Outlook',
    actions: {

      outlook_compose: {
        description: 'Open a new email compose window in Outlook',
        params: {},
        steps: [
          { fn: 'click',   args: ['button[aria-label*="New message"], button[aria-label*="New mail"], :aria("New message")'] },
          { fn: 'waitFor', args: ['[aria-label*="To"]', 6000] },
        ],
      },

      outlook_set_recipient: {
        description: 'Set the To recipient email address',
        params: { email: 'Recipient email address' },
        steps: [
          { fn: 'focus', args: ['input[aria-label*="To"], [aria-label*="To recipients"]'] },
          { fn: 'type',  args: ['input[aria-label*="To"], [aria-label*="To recipients"]', '{{email}}', 30] },
          { fn: 'press', args: ['Tab'] },
          { fn: 'waitMs', args: [500] },
        ],
      },

      outlook_set_subject: {
        description: 'Set the email subject',
        params: { subject: 'Subject text' },
        steps: [
          { fn: 'click', args: ['input[aria-label*="Subject"], [aria-label*="Subject"]'] },
          { fn: 'fill',  args: ['input[aria-label*="Subject"]', '{{subject}}'] },
        ],
      },

      outlook_set_body: {
        description: 'Set the email body text',
        params: { body: 'Body text to type' },
        steps: [
          { fn: 'click', args: ['[aria-label*="Message body"], div[contenteditable="true"]'] },
          { fn: 'type',  args: ['[aria-label*="Message body"], div[contenteditable="true"]', '{{body}}', 20] },
        ],
      },

      outlook_send: {
        description: 'Send the current email in Outlook',
        params: {},
        steps: [
          { fn: 'click',  args: ['button[aria-label*="Send"], :aria("Send")'] },
          { fn: 'waitMs', args: [1000] },
        ],
      },

      outlook_search: {
        description: 'Search emails in Outlook',
        params: { query: 'Search term' },
        steps: [
          { fn: 'click', args: ['input[aria-label*="Search mail"], input[placeholder*="Search"]'] },
          { fn: 'clear', args: ['input[aria-label*="Search mail"], input[placeholder*="Search"]'] },
          { fn: 'type',  args: ['input[aria-label*="Search mail"], input[placeholder*="Search"]', '{{query}}', 25] },
          { fn: 'press', args: ['Enter'] },
          { fn: 'waitMs', args: [1500] },
        ],
      },

      outlook_reply: {
        description: 'Reply to the currently open email in Outlook',
        params: {},
        steps: [
          { fn: 'click',   args: ['button[aria-label*="Reply"], :aria("Reply")'] },
          { fn: 'waitFor', args: ['div[contenteditable="true"]', 5000] },
        ],
      },
    },
  },

  // office.com variant
  'outlook.office.com': { label: 'Outlook (Office 365)', actions: {} },

  // ── YouTube ────────────────────────────────────────────────────────────────
  'www.youtube.com': {
    label: 'YouTube',
    actions: {

      youtube_play_pause: {
        description: 'Play or pause the current YouTube video',
        params: {},
        steps: [
          { fn: 'evaluate', args: [
            'const v = document.querySelector("video"); if(v){ v.paused ? v.play() : v.pause(); v.paused ? "Paused" : "Playing"; } else "No video"'
          ] },
        ],
      },

      youtube_like: {
        description: 'Like the current YouTube video',
        params: {},
        steps: [
          { fn: 'click', args: ['button[aria-label^="like this video"], button[title="I like this"]'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      youtube_dislike: {
        description: 'Dislike the current YouTube video',
        params: {},
        steps: [
          { fn: 'click', args: ['button[aria-label^="Dislike"], button[title="I dislike this"]'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      youtube_subscribe: {
        description: 'Subscribe to the channel of the current video',
        params: {},
        steps: [
          { fn: 'click',  args: ['button[aria-label*="Subscribe"], ytd-subscribe-button-renderer button'] },
          { fn: 'waitMs', args: [500] },
        ],
      },

      youtube_mute: {
        description: 'Toggle mute on the current YouTube video',
        params: {},
        steps: [
          { fn: 'click', args: ['.ytp-mute-button, button.ytp-mute-button'] },
        ],
      },

      youtube_fullscreen: {
        description: 'Toggle fullscreen for the current YouTube video',
        params: {},
        steps: [
          { fn: 'click', args: ['.ytp-fullscreen-button'] },
        ],
      },

      youtube_seek_forward: {
        description: 'Seek the video forward by N seconds (default 10)',
        params: { seconds: 'Number of seconds to seek forward (default 10)' },
        steps: [
          { fn: 'evaluate', args: [
            'const v=document.querySelector("video"); if(v){ v.currentTime += ({{seconds}}||10); "Seeked +" + ({{seconds}}||10) + "s"; } else "No video"'
          ] },
        ],
      },

      youtube_seek_back: {
        description: 'Seek the video back by N seconds (default 10)',
        params: { seconds: 'Number of seconds to seek back (default 10)' },
        steps: [
          { fn: 'evaluate', args: [
            'const v=document.querySelector("video"); if(v){ v.currentTime -= ({{seconds}}||10); "Seeked -" + ({{seconds}}||10) + "s"; } else "No video"'
          ] },
        ],
      },

      youtube_set_volume: {
        description: 'Set YouTube video volume from 0 to 100',
        params: { level: 'Volume level 0–100' },
        steps: [
          { fn: 'evaluate', args: [
            'const v=document.querySelector("video"); if(v){ v.volume={{level}}/100; "Volume set to {{level}}%"; } else "No video"'
          ] },
        ],
      },

      youtube_play_first_result: {
        description: 'Click the first video in YouTube search results to start playing it',
        params: {},
        steps: [
          { fn: 'waitFor', args: ['ytd-video-renderer a#video-title, a#video-title', 8000] },
          { fn: 'waitMs',  args: [500] },
          { fn: 'click',   args: ['ytd-video-renderer a#video-title, a#video-title'] },
          { fn: 'waitMs',  args: [2000] },
        ],
      },

      youtube_search: {
        description: 'Search YouTube for a query',
        params: { query: 'Search query, e.g. "lofi hip hop"' },
        steps: [
          { fn: 'click',  args: ['input#search, input[name="search_query"]'] },
          { fn: 'clear',  args: ['input#search, input[name="search_query"]'] },
          { fn: 'fill',   args: ['input#search, input[name="search_query"]', '{{query}}'] },
          { fn: 'press',  args: ['Enter'] },
          { fn: 'waitMs', args: [1500] },
        ],
      },

      youtube_add_to_queue: {
        description: 'Add the first search result to the watch queue',
        params: {},
        steps: [
          { fn: 'hover',  args: ['ytd-video-renderer:first-of-type'] },
          { fn: 'waitMs', args: [400] },
          { fn: 'click',  args: ['ytd-video-renderer:first-of-type button[aria-label*="Add to queue"]'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      youtube_comment: {
        description: 'Post a comment on the current YouTube video',
        params: { text: 'Comment text to post' },
        steps: [
          { fn: 'scrollTo', args: ['#comments'] },
          { fn: 'click',    args: ['#simplebox-placeholder, [aria-label*="Add a comment"]'] },
          { fn: 'waitFor',  args: ['#contenteditable-root, #simple-box div[contenteditable]', 5000] },
          { fn: 'type',     args: ['#contenteditable-root, #simple-box div[contenteditable]', '{{text}}', 20] },
          { fn: 'waitMs',   args: [300] },
          { fn: 'click',    args: ['#submit-button, button[aria-label="Comment"]'] },
          { fn: 'waitMs',   args: [800] },
        ],
      },
    },
  },

  // ── Spotify ────────────────────────────────────────────────────────────────
  'open.spotify.com': {
    label: 'Spotify',
    actions: {

      spotify_play_pause: {
        description: 'Play or pause the current track in Spotify Web Player',
        params: {},
        steps: [
          { fn: 'click', args: ['button[data-testid="control-button-playpause"], button[aria-label*="Play"], button[aria-label*="Pause"]'] },
        ],
      },

      spotify_next: {
        description: 'Skip to the next track in Spotify',
        params: {},
        steps: [
          { fn: 'click', args: ['button[data-testid="control-button-skip-forward"], button[aria-label*="Next"]'] },
        ],
      },

      spotify_previous: {
        description: 'Go to the previous track in Spotify',
        params: {},
        steps: [
          { fn: 'click', args: ['button[data-testid="control-button-skip-back"], button[aria-label*="Previous"]'] },
        ],
      },

      spotify_like: {
        description: 'Save / like (heart) the currently playing Spotify track',
        params: {},
        steps: [
          { fn: 'click', args: ['button[data-testid="add-button"], button[aria-label*="Save to Your Library"], button[aria-label*="Add to Liked"]'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      spotify_shuffle: {
        description: 'Toggle shuffle mode in Spotify',
        params: {},
        steps: [
          { fn: 'click', args: ['button[data-testid="control-button-shuffle"], button[aria-label*="Shuffle"]'] },
        ],
      },

      spotify_repeat: {
        description: 'Toggle repeat mode in Spotify (off → track → playlist → off)',
        params: {},
        steps: [
          { fn: 'click', args: ['button[data-testid="control-button-repeat"], button[aria-label*="Repeat"]'] },
        ],
      },

      spotify_set_volume: {
        description: 'Set Spotify volume (0–100)',
        params: { level: 'Volume level 0–100' },
        steps: [
          { fn: 'evaluate', args: [
            '(function(){ const s=document.querySelector("[data-testid=\'volume-bar\'] input,[aria-label*=\'Volume\'] input"); if(s){ s.value={{level}}; s.dispatchEvent(new Event("change",{bubbles:true})); return "Volume "+{{level}}; } return "Slider not found"; })()'
          ] },
        ],
      },

      spotify_search: {
        description: 'Search for a song, artist, or playlist in Spotify',
        params: { query: 'Search query, e.g. "The Beatles" or "lofi playlist"' },
        steps: [
          { fn: 'click',  args: ['a[href="/search"], [aria-label*="Search"]'] },
          { fn: 'waitFor', args: ['input[data-testid="search-input"], input[placeholder*="Artists"]', 5000] },
          { fn: 'clear',  args: ['input[data-testid="search-input"], input[placeholder*="Artists"]'] },
          { fn: 'type',   args: ['input[data-testid="search-input"], input[placeholder*="Artists"]', '{{query}}', 25] },
          { fn: 'waitMs', args: [1500] },
        ],
      },

      spotify_play_first_result: {
        description: 'Play the first search result in Spotify',
        params: {},
        steps: [
          { fn: 'waitFor', args: ['[data-testid="top-result-card"] button[aria-label*="Play"], .search-results button[aria-label*="Play"]', 6000] },
          { fn: 'click',   args: ['[data-testid="top-result-card"] button[aria-label*="Play"], .search-results button[aria-label*="Play"]'] },
        ],
      },
    },
  },

  // ── Twitter / X ────────────────────────────────────────────────────────────
  'twitter.com': buildTwitterRecipes(),
  'x.com':       buildTwitterRecipes(),

  // ── Facebook ───────────────────────────────────────────────────────────────
  'www.facebook.com': {
    label: 'Facebook',
    actions: {

      facebook_post: {
        description: 'Create and publish a new Facebook post',
        params: { text: 'Post text to publish' },
        steps: [
          { fn: 'click',   args: ['[aria-label*="What\'s on your mind"], [data-testid*="status-attachment-mentions"], div[role="button"][tabindex="0"]:has([aria-placeholder*="What"])'] },
          { fn: 'waitFor', args: ['[aria-label*="What\'s on your mind"][contenteditable], [contenteditable][aria-placeholder]', 5000] },
          { fn: 'type',    args: ['[aria-label*="What\'s on your mind"][contenteditable], [contenteditable][aria-placeholder]', '{{text}}', 20] },
          { fn: 'waitMs',  args: [500] },
          { fn: 'click',   args: ['button[aria-label="Post"], :aria("Post")'] },
          { fn: 'waitMs',  args: [1000] },
        ],
      },

      facebook_like: {
        description: 'Like the most prominent content on the current Facebook page',
        params: {},
        steps: [
          { fn: 'click',  args: ['[aria-label="Like"], div[aria-label*="Like"]'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      facebook_comment: {
        description: 'Leave a comment on the current Facebook post',
        params: { text: 'Comment text' },
        steps: [
          { fn: 'click',   args: ['[aria-label*="Write a comment"], [placeholder*="Write a comment"]'] },
          { fn: 'waitFor', args: ['[aria-label*="Write a comment"][contenteditable]', 5000] },
          { fn: 'type',    args: ['[aria-label*="Write a comment"][contenteditable]', '{{text}}', 20] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [500] },
        ],
      },

      facebook_share: {
        description: 'Share the current Facebook post',
        params: {},
        steps: [
          { fn: 'click',  args: ['[aria-label="Share"], button[aria-label*="Share"]'] },
          { fn: 'waitMs', args: [500] },
          { fn: 'click',  args: [':text("Share now"), :text("Share Now")'], optional: true },
          { fn: 'waitMs', args: [500] },
        ],
      },

      facebook_search: {
        description: 'Search Facebook',
        params: { query: 'Search query' },
        steps: [
          { fn: 'click',  args: ['input[aria-label*="Search Facebook"]'] },
          { fn: 'clear',  args: ['input[aria-label*="Search Facebook"]'] },
          { fn: 'type',   args: ['input[aria-label*="Search Facebook"]', '{{query}}', 25] },
          { fn: 'press',  args: ['Enter'] },
          { fn: 'waitMs', args: [1500] },
        ],
      },
    },
  },
};

function buildTwitterRecipes() {
  return {
    label: 'Twitter / X',
    actions: {

      twitter_compose: {
        description: 'Open the compose box and write a tweet/post',
        params: { text: 'Tweet text to write (max 280 chars)' },
        steps: [
          { fn: 'click',   args: ['a[href="/compose/tweet"], a[data-testid="SideNav_NewTweet_Button"], :aria("Tweet"), :aria("Post")'] },
          { fn: 'waitFor', args: ['div[data-testid="tweetTextarea_0"], div[role="textbox"][aria-label*="Tweet"]', 6000] },
          { fn: 'type',    args: ['div[data-testid="tweetTextarea_0"], div[role="textbox"]', '{{text}}', 25] },
          { fn: 'waitMs',  args: [300] },
        ],
      },

      twitter_send: {
        description: 'Send / post the composed tweet',
        params: {},
        steps: [
          { fn: 'click',  args: ['button[data-testid="tweetButtonInline"], button[data-testid="tweetButton"]'] },
          { fn: 'waitMs', args: [1000] },
        ],
      },

      twitter_tweet: {
        description: 'Compose and immediately post a tweet in one step',
        params: { text: 'Tweet text (max 280 chars)' },
        steps: [
          { fn: 'click',   args: ['a[href="/compose/tweet"], a[data-testid="SideNav_NewTweet_Button"], :aria("Tweet"), :aria("Post")'] },
          { fn: 'waitFor', args: ['div[data-testid="tweetTextarea_0"]', 6000] },
          { fn: 'type',    args: ['div[data-testid="tweetTextarea_0"]', '{{text}}', 25] },
          { fn: 'waitMs',  args: [300] },
          { fn: 'click',   args: ['button[data-testid="tweetButtonInline"], button[data-testid="tweetButton"]'] },
          { fn: 'waitMs',  args: [1000] },
        ],
      },

      twitter_like: {
        description: 'Like the first tweet in the timeline or the currently focused tweet',
        params: {},
        steps: [
          { fn: 'click',  args: ['article:first-of-type button[data-testid="like"], button[data-testid="like"]'] },
          { fn: 'waitMs', args: [300] },
        ],
      },

      twitter_retweet: {
        description: 'Retweet the first tweet in the timeline',
        params: {},
        steps: [
          { fn: 'click',    args: ['article:first-of-type button[data-testid="retweet"]'] },
          { fn: 'waitMs',   args: [400] },
          { fn: 'clickText', args: ['Retweet'] },
          { fn: 'waitMs',   args: [500] },
        ],
      },

      twitter_reply: {
        description: 'Reply to the first tweet in the timeline',
        params: { text: 'Reply text' },
        steps: [
          { fn: 'click',   args: ['article:first-of-type button[data-testid="reply"]'] },
          { fn: 'waitFor', args: ['div[data-testid="tweetTextarea_0"]', 6000] },
          { fn: 'type',    args: ['div[data-testid="tweetTextarea_0"]', '{{text}}', 25] },
          { fn: 'click',   args: ['button[data-testid="tweetButtonInline"]'] },
          { fn: 'waitMs',  args: [800] },
        ],
      },

      twitter_follow: {
        description: 'Follow the profile currently shown on screen',
        params: {},
        steps: [
          { fn: 'click',  args: ['button[data-testid*="follow"]:not([aria-label*="Unfollow"])'] },
          { fn: 'waitMs', args: [500] },
        ],
      },

      twitter_search: {
        description: 'Search Twitter/X for a query',
        params: { query: 'Search query, e.g. "AI news" or "#GPT4"' },
        steps: [
          { fn: 'click',  args: ['a[aria-label="Search and explore"], [data-testid="AppTabBar_Explore_Link"]'] },
          { fn: 'waitFor', args: ['input[data-testid="SearchBox_Search_Input"]', 5000] },
          { fn: 'click',  args: ['input[data-testid="SearchBox_Search_Input"]'] },
          { fn: 'clear',  args: ['input[data-testid="SearchBox_Search_Input"]'] },
          { fn: 'type',   args: ['input[data-testid="SearchBox_Search_Input"]', '{{query}}', 25] },
          { fn: 'press',  args: ['Enter'] },
          { fn: 'waitMs', args: [1500] },
        ],
      },
    },
  };

  // ── Slack ────────────────────────────────────────────────────────────────────
  SITE_RECIPES['app.slack.com'] = {
    label: 'Slack',
    actions: {
      slack_open_dm: {
        description: 'Open a direct message with a person by name',
        params: { name: 'Person name or username' },
        steps: [
          { fn: 'click',   args: ['button[aria-label="Direct messages"], a[href*="/direct-messages"]'], optional: true },
          { fn: 'waitMs',  args: [400] },
          { fn: 'click',   args: ['button[data-qa="new-dm-button"], button[aria-label*="New message"]'], optional: true },
          { fn: 'waitFor', args: ['[data-qa="recipient_input"], input[placeholder*="person"]', 6000] },
          { fn: 'type',    args: ['[data-qa="recipient_input"], input[placeholder*="person"]', '{{name}}', 30] },
          { fn: 'waitMs',  args: [800] },
          { fn: 'click',   args: [':text("{{name}}")'], optional: true },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [800] },
        ],
      },
      slack_open_channel: {
        description: 'Navigate to a Slack channel by name',
        params: { channel: 'Channel name without #, e.g. "general"' },
        steps: [
          { fn: 'click',   args: ['[data-qa="channel-browser-button"], a[aria-label*="Browse channels"]'], optional: true },
          { fn: 'click',   args: ['button[data-qa="jump-to-channel-button"], [aria-label*="Jump to"]'], optional: true },
          { fn: 'waitFor', args: ['[data-qa="jump_to_input_field"], input[placeholder*="Jump to"]', 5000] },
          { fn: 'type',    args: ['[data-qa="jump_to_input_field"], input[placeholder*="Jump to"]', '#{{channel}}', 30] },
          { fn: 'waitMs',  args: [700] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [1000] },
        ],
      },
      slack_send_message: {
        description: 'Type and send a message in the current Slack channel or DM',
        params: { message: 'Message text to send' },
        steps: [
          { fn: 'click',   args: ['[data-qa="message_input"] [contenteditable="true"], .ql-editor, [aria-label*="message input"]'] },
          { fn: 'waitFor', args: ['[data-qa="message_input"] [contenteditable="true"], .ql-editor', 5000] },
          { fn: 'type',    args: ['[data-qa="message_input"] [contenteditable="true"], .ql-editor', '{{message}}', 20] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [500] },
        ],
      },
      slack_read_messages: {
        description: 'Read the last N messages in the current channel or DM',
        params: { count: 'Number of messages to read (default 10)' },
        steps: [
          { fn: 'readMessages', args: ['{{count}}'] },
        ],
      },
      slack_search: {
        description: 'Search Slack for messages, files, or channels',
        params: { query: 'Search query' },
        steps: [
          { fn: 'click',   args: ['button[data-qa="search-button"], [aria-label*="Search"]'] },
          { fn: 'waitFor', args: ['[data-qa="search_input"], input[placeholder*="Search"]', 5000] },
          { fn: 'clear',   args: ['[data-qa="search_input"], input[placeholder*="Search"]'] },
          { fn: 'type',    args: ['[data-qa="search_input"], input[placeholder*="Search"]', '{{query}}', 25] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [1500] },
        ],
      },
      slack_set_status: {
        description: 'Set your Slack status emoji and text',
        params: { emoji: 'Emoji e.g. :palm_tree:', text: 'Status text e.g. "On vacation"' },
        steps: [
          { fn: 'click',   args: ['button[data-qa="my-status-button"], [aria-label*="status"]'] },
          { fn: 'waitMs',  args: [500] },
          { fn: 'click',   args: ['[data-qa="status_emoji_picker_btn"], button[aria-label*="emoji"]'], optional: true },
          { fn: 'fill',    args: ['[data-qa="status_input"], input[placeholder*="Update your status"]', '{{text}}'] },
          { fn: 'click',   args: [':text("Save"), button[data-qa="save_status_btn"]'] },
          { fn: 'waitMs',  args: [500] },
        ],
      },
      slack_react: {
        description: 'Add an emoji reaction to the last message',
        params: { emoji: 'Emoji name without colons e.g. "thumbsup"' },
        steps: [
          { fn: 'hover',   args: ['[data-qa="virtual-list-item"]:last-child, .c-message_kit__message:last-child'] },
          { fn: 'click',   args: ['button[data-qa="add-reaction"], [aria-label*="Add reaction"]'] },
          { fn: 'waitMs',  args: [400] },
          { fn: 'type',    args: ['[data-qa="emoji-search-input"], input[placeholder*="Search"]', '{{emoji}}', 25] },
          { fn: 'waitMs',  args: [500] },
          { fn: 'click',   args: ['[data-qa="emoji-search-result"]:first-child, button[data-stringify-emoji]'] },
          { fn: 'waitMs',  args: [300] },
        ],
      },
    },
  };

  // ── Discord ──────────────────────────────────────────────────────────────────
  SITE_RECIPES['discord.com'] = {
    label: 'Discord',
    actions: {
      discord_open_server: {
        description: 'Navigate to a Discord server by name',
        params: { server: 'Server name' },
        steps: [
          { fn: 'clickText', args: ['{{server}}'] },
          { fn: 'waitMs',    args: [800] },
        ],
      },
      discord_open_channel: {
        description: 'Open a text channel by name in the current server',
        params: { channel: 'Channel name without #' },
        steps: [
          { fn: 'clickText', args: ['{{channel}}'] },
          { fn: 'waitMs',    args: [600] },
        ],
      },
      discord_send_message: {
        description: 'Type and send a message in the current Discord channel',
        params: { message: 'Message text' },
        steps: [
          { fn: 'click',   args: ['[role="textbox"][aria-label*="Message"], div[contenteditable][data-slate-editor]'] },
          { fn: 'type',    args: ['[role="textbox"][aria-label*="Message"], div[contenteditable][data-slate-editor]', '{{message}}', 20] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [400] },
        ],
      },
      discord_read_messages: {
        description: 'Read recent messages in the current Discord channel',
        params: { count: 'Number of messages to read' },
        steps: [
          { fn: 'readMessages', args: ['{{count}}'] },
        ],
      },
      discord_react: {
        description: 'Add an emoji reaction to the last message',
        params: { emoji: 'Emoji e.g. 👍' },
        steps: [
          { fn: 'hover',     args: ['[class*="message"]:last-child li:last-child'] },
          { fn: 'click',     args: ['button[aria-label*="Add Reaction"], [class*="addReaction"]'] },
          { fn: 'waitMs',    args: [400] },
          { fn: 'type',      args: ['input[placeholder*="Search emoji"]', '{{emoji}}', 20] },
          { fn: 'waitMs',    args: [500] },
          { fn: 'click',     args: ['[class*="emojiItem"]:first-child'] },
          { fn: 'waitMs',    args: [300] },
        ],
      },
      discord_search: {
        description: 'Search messages in the current server',
        params: { query: 'Search query' },
        steps: [
          { fn: 'click',  args: ['[class*="search"] button, [aria-label*="Search"]'] },
          { fn: 'waitFor', args: ['[class*="searchBar"] input, input[placeholder*="Search"]', 5000] },
          { fn: 'type',   args: ['[class*="searchBar"] input, input[placeholder*="Search"]', '{{query}}', 25] },
          { fn: 'press',  args: ['Enter'] },
          { fn: 'waitMs', args: [1500] },
        ],
      },
    },
  };

  // ── Google Sheets ────────────────────────────────────────────────────────────
  SITE_RECIPES['docs.google.com'] = {
    label: 'Google Docs / Sheets / Forms',
    actions: {
      sheets_read_cell: {
        description: 'Read the value of a cell in Google Sheets (e.g. A1)',
        params: { cell: 'Cell reference e.g. "A1", "B3"' },
        steps: [
          { fn: 'click',    args: ['[id="t-name-box"], .cell-input'] },
          { fn: 'clear',    args: ['[id="t-name-box"], .cell-input'] },
          { fn: 'type',     args: ['[id="t-name-box"], .cell-input', '{{cell}}', 20] },
          { fn: 'press',    args: ['Enter'] },
          { fn: 'waitMs',   args: [400] },
          { fn: 'getText',  args: ['[id="t-formula-bar-input"], .cell-input'] },
        ],
      },
      sheets_write_cell: {
        description: 'Write a value to a specific cell in Google Sheets',
        params: { cell: 'Cell reference e.g. "B2"', value: 'Value to write' },
        steps: [
          { fn: 'click',    args: ['[id="t-name-box"], .cell-input'] },
          { fn: 'clear',    args: ['[id="t-name-box"], .cell-input'] },
          { fn: 'type',     args: ['[id="t-name-box"], .cell-input', '{{cell}}', 20] },
          { fn: 'press',    args: ['Enter'] },
          { fn: 'waitMs',   args: [300] },
          { fn: 'type',     args: ['.waffle-focusproxy, [id="t-formula-bar-input"]', '{{value}}', 15] },
          { fn: 'press',    args: ['Enter'] },
          { fn: 'waitMs',   args: [300] },
        ],
      },
      forms_fill_field: {
        description: 'Fill a field in a Google Form by label name',
        params: { label: 'Field label text', value: 'Value to enter' },
        steps: [
          { fn: 'click',  args: [':label("{{label}}")'] },
          { fn: 'fill',   args: [':label("{{label}}")','{{value}}'] },
        ],
      },
      forms_submit: {
        description: 'Submit the current Google Form',
        params: {},
        steps: [
          { fn: 'click',   args: ['[aria-label="Submit"], :text("Submit")'] },
          { fn: 'waitMs',  args: [1500] },
        ],
      },
      docs_read: {
        description: 'Read the text content of the current Google Doc',
        params: {},
        steps: [
          { fn: 'pageText', args: [] },
        ],
      },
      docs_find_replace: {
        description: 'Find and replace text in a Google Doc',
        params: { find: 'Text to find', replace: 'Replacement text' },
        steps: [
          { fn: 'press',   args: ['h', ':role("button","Find and replace")'], optional: true },
          { fn: 'evaluate', args: ['(function(){var e=new KeyboardEvent("keydown",{key:"h",ctrlKey:true,bubbles:true});document.activeElement.dispatchEvent(e);"ok"})()'] },
          { fn: 'waitFor', args: ['input[aria-label*="Find"], [aria-label*="Search"]', 4000] },
          { fn: 'fill',    args: ['input[aria-label*="Find"]', '{{find}}'] },
          { fn: 'fill',    args: ['input[aria-label*="Replace"], [aria-label*="Replace with"]', '{{replace}}'] },
          { fn: 'click',   args: [':text("Replace all")'] },
          { fn: 'waitMs',  args: [500] },
        ],
      },
    },
  };

  // ── Google Calendar ──────────────────────────────────────────────────────────
  SITE_RECIPES['calendar.google.com'] = {
    label: 'Google Calendar',
    actions: {
      calendar_create_event: {
        description: 'Create a new calendar event with a title',
        params: { title: 'Event title', date: 'Date/time e.g. "tomorrow 3pm"' },
        steps: [
          { fn: 'click',   args: ['button[aria-label*="Create"], [data-view*="create"]'] },
          { fn: 'waitFor', args: ['[aria-label*="Event title"], input[placeholder*="Add title"]', 5000] },
          { fn: 'fill',    args: ['[aria-label*="Event title"], input[placeholder*="Add title"]', '{{title}}'] },
          { fn: 'click',   args: ['button[aria-label*="Save"], :text("Save")'] },
          { fn: 'waitMs',  args: [1000] },
        ],
      },
      calendar_read_today: {
        description: 'Read the events on today\'s calendar',
        params: {},
        steps: [
          { fn: 'click',   args: ['button[aria-label*="Today"]'] },
          { fn: 'waitMs',  args: [500] },
          { fn: 'getText', args: ['[role="main"]'] },
        ],
      },
    },
  };

  // ── GitHub ───────────────────────────────────────────────────────────────────
  SITE_RECIPES['github.com'] = {
    label: 'GitHub',
    actions: {
      github_search: {
        description: 'Search GitHub for repos, issues, or code',
        params: { query: 'Search query' },
        steps: [
          { fn: 'click',   args: ['[data-target="qbsearch-input.inputButton"], button.header-search-button'] },
          { fn: 'waitFor', args: ['input[name="q"], #query-builder-test', 5000] },
          { fn: 'fill',    args: ['input[name="q"], #query-builder-test', '{{query}}'] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [1500] },
        ],
      },
      github_create_pr: {
        description: 'Click the "New pull request" button on the current repo',
        params: {},
        steps: [
          { fn: 'click',   args: [':text("New pull request"), a[href*="/compare"]'] },
          { fn: 'waitMs',  args: [1000] },
        ],
      },
      github_open_issue: {
        description: 'Navigate to the Issues tab of the current repo',
        params: {},
        steps: [
          { fn: 'click',   args: ['a[data-content="Issues"], :text("Issues")'] },
          { fn: 'waitMs',  args: [800] },
        ],
      },
      github_create_issue: {
        description: 'Create a new GitHub issue with title and body',
        params: { title: 'Issue title', body: 'Issue description' },
        steps: [
          { fn: 'click',   args: ['a[href$="/issues/new"], :text("New issue")'] },
          { fn: 'waitFor', args: ['input#issue_title', 5000] },
          { fn: 'fill',    args: ['input#issue_title', '{{title}}'] },
          { fn: 'fill',    args: ['textarea#issue_body', '{{body}}'] },
          { fn: 'click',   args: ['button[data-disable-with*="Submitting"],:text("Submit new issue")'] },
          { fn: 'waitMs',  args: [1500] },
        ],
      },
    },
  };

  // ── Notion ───────────────────────────────────────────────────────────────────
  SITE_RECIPES['www.notion.so'] = {
    label: 'Notion',
    actions: {
      notion_new_page: {
        description: 'Create a new Notion page',
        params: { title: 'Page title' },
        steps: [
          { fn: 'click',   args: [':text("New page"), [aria-label*="New page"]'] },
          { fn: 'waitFor', args: ['[placeholder="Untitled"], [data-content-editable-leaf]', 5000] },
          { fn: 'type',    args: ['[placeholder="Untitled"]', '{{title}}', 20] },
          { fn: 'press',   args: ['Enter'] },
          { fn: 'waitMs',  args: [300] },
        ],
      },
      notion_add_text: {
        description: 'Add text to the current Notion page',
        params: { text: 'Text to add' },
        steps: [
          { fn: 'click',   args: ['[contenteditable="true"]:last-of-type'] },
          { fn: 'type',    args: ['[contenteditable="true"]:last-of-type', '{{text}}', 15] },
          { fn: 'press',   args: ['Enter'] },
        ],
      },
      notion_search: {
        description: 'Search Notion pages and databases',
        params: { query: 'Search query' },
        steps: [
          { fn: 'click',   args: ['[placeholder*="Search"], button[aria-label*="Search"]'] },
          { fn: 'waitFor', args: ['input[placeholder*="Search"]', 5000] },
          { fn: 'type',    args: ['input[placeholder*="Search"]', '{{query}}', 25] },
          { fn: 'waitMs',  args: [800] },
        ],
      },
    },
  };
}

// ── WebSocket bridge ─────────────────────────────────────────────────────────

function connect() {
  try {
    ws = new WebSocket(`ws://localhost:${WS_PORT}`);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    console.log('[tellaflow] Connected to Electron agent');
    ws.send(JSON.stringify({ type: 'hello', agent: 'chrome-extension', version: '2.0.0' }));
    updateBadge(true);
  };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (!msg.id || !msg.action) return;

    try {
      const result = await handleAction(msg.action, msg.params || {});
      ws.send(JSON.stringify({ id: msg.id, result }));
    } catch (err) {
      ws.send(JSON.stringify({ id: msg.id, error: err.message || String(err) }));
    }
  };

  ws.onclose = () => { connected = false; updateBadge(false); scheduleReconnect(); };
  ws.onerror = () => { connected = false; updateBadge(false); };
}

function scheduleReconnect() { setTimeout(connect, RECONNECT_DELAY_MS); }

function updateBadge(ok) {
  chrome.action.setBadgeText({ text: ok ? '●' : '' });
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#22c55e' : '#ef4444' });
}

// ── Tab utilities ─────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  return tab;
}

async function execInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results?.[0]?.result;
}

/** Send a message to the content script in a tab, with fallback to executeScript if content script isn't loaded yet */
async function msgTab(tabId, message, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Content script timeout')), timeoutMs);
    chrome.tabs.sendMessage(tabId, message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        // Content script may not be loaded — inject it then retry
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        }).then(() => {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, message, (r2) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(r2);
            });
          }, 200);
        }).catch(e => reject(e));
        return;
      }
      if (!response) reject(new Error('No response from content script'));
      else if (response.ok) resolve(response.result);
      else reject(new Error(response.error || 'Content script error'));
    });
  });
}

function waitForLoad(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 800);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ── Action router ─────────────────────────────────────────────────────────────

async function handleAction(action, params) {
  switch (action) {

    // ── Navigation ──────────────────────────────────────────────────────────
    case 'navigate': {
      const tab = await getActiveTab();
      await chrome.tabs.update(tab.id, { url: params.url });
      await waitForLoad(tab.id);
      return `Navigated to ${params.url}`;
    }

    case 'get_url': {
      const tab = await getActiveTab();
      return tab.url;
    }

    case 'get_title': {
      const tab = await getActiveTab();
      return tab.title;
    }

    // ── Page content ─────────────────────────────────────────────────────────
    case 'get_text': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, { type: 'pw_get_text' });
    }

    case 'get_links': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, { type: 'pw_get_links' });
    }

    // ── Low-level DOM ops (each maps to a single engine.fn call) ────────────
    case 'click':
    case 'click_text':
    case 'fill':
    case 'type':
    case 'press':
    case 'hover':
    case 'select_option':
    case 'focus':
    case 'clear':
    case 'wait_for':
    case 'wait_ms':
    case 'scroll_to':
    case 'get_text_of':
    case 'get_attr':
    case 'is_visible': {
      const tab = await getActiveTab();
      const fnMap = {
        click:       'click',
        click_text:  'clickText',
        fill:        'fill',
        type:        'type',
        press:       'press',
        hover:       'hover',
        select_option: 'selectOption',
        focus:       'focus',
        clear:       'clear',
        wait_for:    'waitFor',
        wait_ms:     'waitMs',
        scroll_to:   'scrollTo',
        get_text_of: 'getText',
        get_attr:    'getAttribute',
        is_visible:  'isVisible',
      };
      const fn = fnMap[action];
      const argMap = {
        click:        [params.selector],
        click_text:   [params.text],
        fill:         [params.selector, params.value],
        type:         [params.selector, params.text, params.delay],
        press:        [params.key, params.selector],
        hover:        [params.selector],
        select_option:[params.selector, params.value],
        focus:        [params.selector],
        clear:        [params.selector],
        wait_for:     [params.selector, params.timeout],
        wait_ms:      [params.ms],
        scroll_to:    [params.selector],
        get_text_of:  [params.selector],
        get_attr:     [params.selector, params.attribute],
        is_visible:   [params.selector],
      };
      return await msgTab(tab.id, { type: 'pw_exec', step: { fn, args: argMap[action] }, params: {} });
    }

    case 'run_js': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, { type: 'pw_evaluate', script: params.script });
    }

    case 'read_messages': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, { type: 'pw_read_messages', limit: params.limit || 20 });
    }

    case 'read_form': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, { type: 'pw_read_form', selector: params.selector || 'form' });
    }

    case 'check':
    case 'uncheck':
    case 'submit':
    case 'drag_to':
    case 'wait_for_nav':
    case 'is_checked':
    case 'input_value': {
      const tab = await getActiveTab();
      const fnMap2 = {
        check: 'check', uncheck: 'uncheck', submit: 'submit',
        drag_to: 'dragTo', wait_for_nav: 'waitForNavigation',
        is_checked: 'isChecked', input_value: 'inputValue',
      };
      const argMap2 = {
        check:        [params.selector],
        uncheck:      [params.selector],
        submit:       [params.selector],
        drag_to:      [params.from, params.to],
        wait_for_nav: [params.timeout],
        is_checked:   [params.selector],
        input_value:  [params.selector],
      };
      return await msgTab(tab.id, {
        type: 'pw_exec',
        step: { fn: fnMap2[action], args: argMap2[action] },
        params: {},
      });
    }

    case 'get_page_info': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, { type: 'pw_get_info' });
    }

    // ── Recipe execution ────────────────────────────────────────────────────
    case 'site_action': {
      const tab = await getActiveTab();
      const hostname = new URL(tab.url).hostname;
      const recipeSet = SITE_RECIPES[hostname];
      if (!recipeSet) throw new Error(`No recipes for ${hostname}`);
      const action_def = recipeSet.actions[params.action_name];
      if (!action_def) throw new Error(`Unknown recipe action: ${params.action_name} for ${hostname}`);
      const result = await msgTab(tab.id, { type: 'pw_recipe', steps: action_def.steps, params: params.params || {} }, 30000);
      return result;
    }

    case 'get_site_actions': {
      const tab = await getActiveTab();
      const hostname = new URL(tab.url).hostname;
      const recipeSet = SITE_RECIPES[hostname];
      if (!recipeSet) return `No recipes available for ${hostname}`;
      const lines = [`Available actions for ${recipeSet.label} (${hostname}):`];
      for (const [name, def] of Object.entries(recipeSet.actions)) {
        const paramNames = Object.keys(def.params || {});
        lines.push(`  • ${name}${paramNames.length ? `(${paramNames.join(', ')})` : ''} — ${def.description}`);
      }
      return lines.join('\n');
    }

    // ── YouTube shortcuts ────────────────────────────────────────────────────
    case 'yt_play_first_result': {
      await new Promise(r => setTimeout(r, 1500));
      const tab = await getActiveTab();
      return await msgTab(tab.id, {
        type: 'pw_recipe',
        steps: SITE_RECIPES['www.youtube.com'].actions.youtube_play_first_result.steps,
        params: {},
      });
    }

    case 'yt_play_pause': {
      const tab = await getActiveTab();
      return await msgTab(tab.id, {
        type: 'pw_recipe',
        steps: SITE_RECIPES['www.youtube.com'].actions.youtube_play_pause.steps,
        params: {},
      });
    }

    // ── Tab management ──────────────────────────────────────────────────────
    case 'new_tab': {
      const tab = await chrome.tabs.create({ url: params.url || 'about:blank', active: true });
      if (params.url) await waitForLoad(tab.id);
      return `Opened new tab: ${params.url || 'blank'}`;
    }

    case 'close_tab': {
      const tab = await getActiveTab();
      await chrome.tabs.remove(tab.id);
      return 'Tab closed';
    }

    case 'list_tabs': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return tabs.map((t, i) => `${i + 1}. ${t.title} — ${t.url}`).join('\n') || 'No tabs';
    }

    case 'switch_tab': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const idx = (parseInt(params.index) || 1) - 1;
      const tab = tabs[idx];
      if (!tab) return `Tab ${params.index} not found`;
      await chrome.tabs.update(tab.id, { active: true });
      return `Switched to: ${tab.title}`;
    }

    case 'screenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      return dataUrl ? `data:image/png (${dataUrl.length} chars)` : 'Screenshot failed';
    }

    // ── Scroll ───────────────────────────────────────────────────────────────
    case 'scroll': {
      const tab = await getActiveTab();
      const dir = params.direction || 'down';
      const amt = parseInt(params.amount) || 400;
      await execInTab(tab.id, (d, a) => window.scrollBy(0, d === 'up' ? -a : a), [dir, amt]);
      return `Scrolled ${dir} by ${amt}px`;
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ── Popup status ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'get_status') {
    sendResponse({ connected, recipeSites: Object.keys(SITE_RECIPES) });
  }
  return false;
});

// ── Init ─────────────────────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
