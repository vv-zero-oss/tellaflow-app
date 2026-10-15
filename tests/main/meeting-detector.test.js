import { describe, it, expect } from 'vitest';
import { detectMeeting, matchMeetingUrl, createMeetingDetector } from '../../src/main/meeting-detector.js';

describe('matchMeetingUrl', () => {
  it.each([
    ['https://meet.google.com/abc-defg-hij', 'Google Meet'],
    ['https://meet.google.com/abc-defg-hij?authuser=1', 'Google Meet'],
    ['https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc', 'Microsoft Teams'],
    ['https://teams.live.com/meet/9384', 'Microsoft Teams'],
    ['https://us02web.zoom.us/wc/123456789/join', 'Zoom'],
    ['https://zoom.us/j/123456789', 'Zoom'],
    ['https://app.slack.com/huddle/T123/C456', 'Slack huddle'],
  ])('%s → %s', (url, app) => {
    expect(matchMeetingUrl(url)).toBe(app);
  });

  it.each([
    'https://meet.google.com/',
    'https://meet.google.com/landing',
    'https://calendar.google.com/calendar/u/0/r',
    'https://zoom.us/pricing',
    'https://app.slack.com/client/T123/C456',
  ])('ignores %s', (url) => {
    expect(matchMeetingUrl(url)).toBeNull();
  });
});

describe('detectMeeting', () => {
  it('detects Zoom from its in-meeting helper process', () => {
    expect(detectMeeting({ processes: ['zoom.us', 'CptHost'] })).toMatchObject({ inMeeting: true, app: 'Zoom' });
    expect(detectMeeting({ processes: ['zoom.us'] }).inMeeting).toBe(false);
  });

  it('detects a Slack huddle window', () => {
    expect(detectMeeting({ windows: { Slack: ['general - Acme - Slack', 'Huddle in #design'] } })).toMatchObject({ inMeeting: true, app: 'Slack huddle' });
    expect(detectMeeting({ windows: { Slack: ['general - Acme - Slack'] } }).inMeeting).toBe(false);
  });

  it('detects Teams call windows but not ordinary chats', () => {
    expect(detectMeeting({ windows: { 'Microsoft Teams': ['Meeting with Dana | Microsoft Teams'] } }).inMeeting).toBe(true);
    expect(detectMeeting({ windows: { 'Microsoft Teams': ['Chat | Weekly meeting notes | Microsoft Teams'] } }).inMeeting).toBe(false);
  });

  it('detects Google Meet in a browser tab', () => {
    expect(detectMeeting({ tabs: ['https://mail.google.com/', 'https://meet.google.com/xyz-abcd-efg'] })).toMatchObject({ inMeeting: true, app: 'Google Meet' });
  });
});

describe('meeting detector loop', () => {
  function harness(signals) {
    const events = [];
    const timers = { setTimeout: () => 1, clearTimeout: () => {} };
    let i = 0;
    const probes = {
      listProcessNames: async () => signals[Math.min(i, signals.length - 1)].processes || [],
      listRunningApps: async () => ['Google Chrome'],
      getWindowTitles: async () => [],
      getBrowserTabUrls: async () => signals[Math.min(i, signals.length - 1)].tabs || [],
    };
    const d = createMeetingDetector({ probes, timers, onStart: (m) => events.push(['start', m.app]), onEnd: (m) => events.push(['end', m.app]), log: { warn() {} } });
    d.start();
    return { d, events, async step(n = 1) { for (let k = 0; k < n; k++) { await d.poll(); i++; } } };
  }

  it('debounces start (2 polls) and end (3 polls)', async () => {
    const meet = { tabs: ['https://meet.google.com/abc-defg-hij'] };
    const none = {};
    const h = harness([meet, meet, meet, none, none, meet, none, none, none]);
    await h.step(1);
    expect(h.events).toEqual([]);
    await h.step(1);
    expect(h.events).toEqual([['start', 'Google Meet']]);
    await h.step(3); // meet, none, none → still active
    expect(h.events).toEqual([['start', 'Google Meet']]);
    await h.step(1); // meet again resets misses
    await h.step(3); // three misses → end
    expect(h.events).toEqual([['start', 'Google Meet'], ['end', 'Google Meet']]);
  });

  it('stop() ends an active meeting', async () => {
    const meet = { processes: ['CptHost'] };
    const h = harness([meet, meet]);
    await h.step(2);
    h.d.stop();
    expect(h.events).toEqual([['start', 'Zoom'], ['end', 'Zoom']]);
  });
});
