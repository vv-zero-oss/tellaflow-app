/**
 * Meeting detection (opt-in).
 *
 * Polls cheap, local signals every few seconds and decides whether the user
 * is in a call:
 *   - Zoom:   the `CptHost` helper process only exists during a meeting;
 *             window titles "Zoom Meeting" / "Zoom Webinar".
 *   - Teams:  window titles containing "Meeting" / "Call" / "| Microsoft Teams" call views.
 *   - Slack:  huddle window titles ("Huddle", "huddle with …").
 *   - Webex / Around / Tuple / Discord voice windows.
 *   - Browser tabs (Chrome-family + Safari, only if already running):
 *     meet.google.com/abc-defg-hij, teams.microsoft.com/…/meetup-join,
 *     teams.live.com/meet, *.zoom.us/wc/…, app.slack.com/huddle, whereby.com/…
 *
 * Debounced: a meeting must be seen on 2 consecutive polls to start and be
 * absent for 3 consecutive polls (~15 s) to end, so tab switches or a window
 * briefly closing don't chop the recording.
 */

const MEETING_URL_PATTERNS = [
  { re: /^https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}(?:[/?#]|$)/i, app: 'Google Meet' },
  { re: /^https:\/\/teams\.(?:microsoft|live)\.com\/(?:[^?#]*\/)?(?:meetup-join|meet)\//i, app: 'Microsoft Teams' },
  { re: /^https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:wc|j|s)\/\d+/i, app: 'Zoom' },
  { re: /^https:\/\/app\.slack\.com\/huddle\//i, app: 'Slack huddle' },
  { re: /^https:\/\/(?:[\w-]+\.)?whereby\.com\/[\w-]+/i, app: 'Whereby' },
  { re: /^https:\/\/(?:[\w-]+\.)?webex\.com\/(?:meet|wbxmjs|webappng)/i, app: 'Webex' },
  { re: /^https:\/\/(?:app\.)?around\.co\/r\//i, app: 'Around' },
];

const WINDOW_RULES = [
  { app: 'zoom.us', re: /^(?:zoom meeting|zoom webinar|zoom workplace.*meeting)/i, label: 'Zoom' },
  { app: 'Slack', re: /\bhuddle\b/i, label: 'Slack huddle' },
  // New Teams call windows: "Meeting with Jane | Microsoft Teams", "Call with Bob | …",
  // "Meeting in General | …". Plain chat windows don't use these prefixes.
  { app: 'Microsoft Teams', re: /^(?:meeting|call)\s+(?:with|in)\b|^meeting compact view/i, label: 'Microsoft Teams' },
  { app: 'Microsoft Teams (work or school)', re: /^(?:meeting|call)\s+(?:with|in)\b|^meeting compact view/i, label: 'Microsoft Teams' },
  { app: 'Webex', re: /\bmeeting\b|personal room/i, label: 'Webex' },
  { app: 'Around', re: /.+/, label: 'Around' },
  { app: 'Tuple', re: /\bcall\b|pairing/i, label: 'Tuple' },
  { app: 'Discord', re: /\bvoice\b|\bcall\b|stage/i, label: 'Discord call' },
];

const MEETING_PROCESSES = [
  { name: 'CptHost', label: 'Zoom' },        // Zoom in-meeting helper
  { name: 'aomhost', label: 'Zoom' },        // Zoom audio/video helper (newer clients)
];

function matchMeetingUrl(url) {
  for (const p of MEETING_URL_PATTERNS) if (p.re.test(url)) return p.app;
  return null;
}

/**
 * Pure decision from one poll's signals.
 * @param {{processes?: string[], windows?: Record<string, string[]>, tabs?: string[]}} s
 * @returns {{inMeeting: boolean, app: string|null, reason: string|null}}
 */
function detectMeeting({ processes = [], windows = {}, tabs = [] } = {}) {
  const procSet = new Set(processes);
  for (const p of MEETING_PROCESSES) {
    if (procSet.has(p.name)) return { inMeeting: true, app: p.label, reason: `process ${p.name}` };
  }
  for (const rule of WINDOW_RULES) {
    const titles = windows[rule.app] || [];
    const hit = titles.find((t) => rule.re.test(t));
    if (hit) return { inMeeting: true, app: rule.label, reason: `window "${hit}"` };
  }
  for (const url of tabs) {
    const app = matchMeetingUrl(url);
    if (app) return { inMeeting: true, app, reason: `tab ${url.split('?')[0]}` };
  }
  return { inMeeting: false, app: null, reason: null };
}

const WATCHED_WINDOW_APPS = [...new Set(WINDOW_RULES.map((r) => r.app))];
const BROWSERS = ['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge', 'Vivaldi', 'Chromium', 'Safari'];

/**
 * Polling loop. OS access injected for testability:
 *   listRunningApps(), getWindowTitles(app), getBrowserTabUrls(browser), listProcessNames()
 */
function createMeetingDetector({
  probes,
  onStart,
  onEnd,
  pollMs = 5000,
  startAfter = 2,
  endAfter = 3,
  checkBrowsers = () => true,
  timers = { setTimeout, clearTimeout },
  log = console,
}) {
  let timer = null;
  let running = false;
  let active = null; // { app, reason, since }
  let hits = 0;
  let misses = 0;
  let lastApp = null;

  async function gatherSignals() {
    const [processes, apps] = await Promise.all([probes.listProcessNames(), probes.listRunningApps()]);
    const running = new Set(apps);
    const windows = {};
    await Promise.all(
      WATCHED_WINDOW_APPS.filter((a) => running.has(a)).map(async (a) => { windows[a] = await probes.getWindowTitles(a); }),
    );
    let tabs = [];
    if (checkBrowsers()) {
      const lists = await Promise.all(BROWSERS.filter((b) => running.has(b)).map((b) => probes.getBrowserTabUrls(b)));
      tabs = lists.flat();
    }
    return { processes, windows, tabs };
  }

  async function poll() {
    if (!running) return;
    let result = { inMeeting: false, app: null, reason: null };
    try {
      result = detectMeeting(await gatherSignals());
    } catch (err) {
      log.warn?.('[meeting] poll failed:', err.message);
    }
    if (!running) return;
    if (result.inMeeting) {
      misses = 0;
      hits = lastApp === result.app ? hits + 1 : 1;
      lastApp = result.app;
      if (!active && hits >= startAfter) {
        active = { app: result.app, reason: result.reason, since: Date.now() };
        try { onStart(active); } catch (err) { log.warn?.('[meeting] onStart failed:', err.message); }
      }
    } else {
      hits = 0;
      lastApp = null;
      if (active && ++misses >= endAfter) {
        const ended = active;
        active = null;
        misses = 0;
        try { onEnd(ended); } catch (err) { log.warn?.('[meeting] onEnd failed:', err.message); }
      }
    }
    schedule();
  }

  function schedule() {
    if (!running) return;
    timer = timers.setTimeout(poll, pollMs);
    timer?.unref?.();
  }

  function start() {
    if (running) return;
    running = true;
    hits = 0;
    misses = 0;
    schedule();
  }

  function stop() {
    running = false;
    if (timer) timers.clearTimeout(timer);
    timer = null;
    if (active) {
      const ended = active;
      active = null;
      try { onEnd(ended); } catch {}
    }
  }

  return { start, stop, poll, isRunning: () => running, getActive: () => active };
}

module.exports = { detectMeeting, matchMeetingUrl, createMeetingDetector, MEETING_URL_PATTERNS };
