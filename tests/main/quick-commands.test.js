// Instant commands: what is matched (and what is left for the AI), and the
// system calls each one makes.
import { describe, it, expect } from 'vitest';
import { matchQuickCommand, planQuickRequest, createQuickCommands, normalize, QUICK_COMMANDS } from '../../src/main/jarvis/quick-commands.js';

describe('matchQuickCommand', () => {
  const cases = [
    ['Take a screenshot.', { id: 'screenshot' }],
    ['Hey, can you take a screenshot please?', { id: 'screenshot' }],
    ['screenshot', { id: 'screenshot' }],
    ['capture my screen', { id: 'screenshot' }],
    ['screenshot an area', { id: 'screenshot-area' }],
    ['take a screenshot of the window', { id: 'screenshot-window' }],
    ['Open Safari', { id: 'open-app', app: 'Safari' }],
    ['launch visual studio code', { id: 'open-app', app: 'Visual Studio Code' }],
    ['switch to Slack', { id: 'open-app', app: 'Slack' }],
    ['open the notes app', { id: 'open-app', app: 'Notes' }],
    ['open music', { id: 'open-app', app: 'Music' }],
    ['open textedit', { id: 'open-app', app: 'TextEdit' }],
    ['open chrome', { id: 'open-app', app: 'Google Chrome' }],
    ['open downloads', { id: 'open-folder', folder: 'Downloads' }],
    ['open my documents folder', { id: 'open-folder', folder: 'Documents' }],
    ['go to github dot com', { id: 'open-url', url: 'https://github.com' }],
    ['open youtube.com', { id: 'open-url', url: 'https://youtube.com' }],
    ['google best pizza near me', { id: 'web-search', engine: 'google', query: 'best pizza near me' }],
    ['search youtube for lofi beats', { id: 'web-search', engine: 'youtube', query: 'lofi beats' }],
    ['Pause the music.', { id: 'media', command: 'pause' }],
    ['pause', { id: 'media', command: 'pause' }],
    ['play', { id: 'media', command: 'play' }],
    ['resume spotify', { id: 'media', command: 'play' }],
    ['skip this song', { id: 'media', command: 'next' }],
    ['next track', { id: 'media', command: 'next' }],
    ['previous song', { id: 'media', command: 'previous' }],
    ['volume up', { id: 'volume', command: 'up' }],
    ['turn the volume down', { id: 'volume', command: 'down' }],
    ['set volume to 30%', { id: 'volume', command: 'set', level: 30 }],
    ['set the volume to 250', { id: 'volume', command: 'set', level: 100 }],
    ['mute', { id: 'volume', command: 'mute' }],
    ['unmute the sound', { id: 'volume', command: 'unmute' }],
    ['lock my screen', { id: 'lock' }],
    ['turn off the display', { id: 'display-sleep' }],
    ['What time is it?', { id: 'time' }],
    ["What's the date today?", { id: 'date' }],
  ];
  for (const [said, want] of cases) {
    it(`"${said}"`, () => expect(matchQuickCommand(said)).toMatchObject(want));
  }

  // Anything with more to it is the AI's: a clause more, a thing that is not an
  // app's name, an app the desktop tier always asks about, a question.
  const forTheAi = [
    'what is the weather in mumbai',
    'open Notes and start a grocery list',
    'open a new tab',
    'open the file I was working on',
    'open my last email',
    'open terminal',
    'open system settings',
    'switch to 1Password',
    'play something relaxing',
    'play despacito on spotify',
    'continue',
    'stop',
    'take a screenshot and send it to Sam',
    'go to the settings page',
    'quit Safari',
    'delete this file',
    '',
  ];
  for (const said of forTheAi) {
    it(`leaves "${said}" to the AI`, () => expect(matchQuickCommand(said)).toBeNull());
  }

  it('strips wrapping words but nothing inside the command', () => {
    expect(normalize('Okay, could you please open Safari for me?')).toBe('open safari');
    expect(normalize('Jarvis, mute now.')).toBe('mute');
  });

  it('lists something to say for every command', () => {
    for (const c of QUICK_COMMANDS) {
      expect(c.say).toBeTruthy();
      expect(c.does).toBeTruthy();
    }
  });
});

function runners(over = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      platform: 'darwin',
      homeDir: '/Users/me',
      now: () => new Date(2026, 9, 20, 14, 3, 9),
      exec: async (file, args) => { calls.push([file, ...args]); return ''; },
      appleScript: async (body, argv = []) => { calls.push(['as', body, ...argv]); return '58'; },
      jxa: async (_src, argv = []) => { calls.push(['jxa', ...argv]); return ''; },
      runningApps: async () => [],
      ...over,
    },
  };
}

describe('createQuickCommands', () => {
  it('saves a screenshot to the Desktop under the name macOS uses', async () => {
    const { calls, deps } = runners();
    const q = createQuickCommands(deps);
    const r = await q.run(q.match('take a screenshot'));
    expect(r).toMatchObject({ ok: true, text: 'Screenshot saved to your Desktop.' });
    expect(calls).toEqual([['screencapture', '-x', '/Users/me/Desktop/Screenshot 2026-10-20 at 14.03.09.png']]);
  });

  it('opens an app by name with `open -a`, and reports a failure instead of throwing', async () => {
    const { calls, deps } = runners({ exec: async (file, args) => { calls.push([file, ...args]); throw new Error("Unable to find application named 'Fooapp'"); } });
    const q = createQuickCommands(deps);
    const r = await q.run(q.match('open fooapp'));
    expect(calls).toEqual([['open', '-a', 'Fooapp']]);
    expect(r).toEqual({ ok: false, error: "Unable to find application named 'Fooapp'" });
  });

  it('sends play/pause to the running player, and media keys when there is none', async () => {
    const withSpotify = runners({ runningApps: async () => ['Finder', 'Spotify', 'Music'] });
    let q = createQuickCommands(withSpotify.deps);
    expect(await q.run(q.match('pause the music'))).toMatchObject({ ok: true, text: 'Paused Spotify and Music.' });
    expect(await q.run(q.match('next song'))).toMatchObject({ ok: true, text: 'Skipped to the next track.' });
    expect(withSpotify.calls).toEqual([
      ['as', 'tell application "Spotify" to pause'],
      ['as', 'tell application "Music" to pause'],
      ['as', 'tell application "Spotify" to next track'],
    ]);
    const none = runners();
    q = createQuickCommands(none.deps);
    expect(await q.run(q.match('pause'))).toMatchObject({ ok: true, text: 'Pressed play/pause.' });
    expect(none.calls).toEqual([['jxa', '16']]);
  });

  it('passes the volume level as argv, never as script source', async () => {
    const { calls, deps } = runners();
    const q = createQuickCommands(deps);
    expect(await q.run(q.match('set volume to 30'))).toMatchObject({ ok: true, text: 'Volume set to 30%.' });
    expect(calls[0][1]).not.toMatch(/30/);
    expect(calls[0][2]).toBe('30');
    expect(await q.run(q.match('volume up'))).toMatchObject({ ok: true, text: 'Volume up — 58%.' });
  });

  it('URL-encodes a web search', async () => {
    const { calls, deps } = runners();
    const q = createQuickCommands(deps);
    await q.run(q.match('google cats & dogs'));
    expect(calls).toEqual([['open', 'https://www.google.com/search?q=cats%20%26%20dogs']]);
  });

  it('answers the time and date without the OS', async () => {
    const { calls, deps } = runners();
    const q = createQuickCommands(deps);
    expect(await q.run(q.match('what time is it'))).toEqual({ ok: true, text: "It's 2:03 PM." });
    expect(await q.run(q.match("what's the date"))).toEqual({ ok: true, text: "It's Tuesday, October 20, 2026." });
    expect(calls).toEqual([]);
  });

  it('off a Mac, only the commands that need no OS match', () => {
    const q = createQuickCommands(runners({ platform: 'linux' }).deps);
    expect(q.match('take a screenshot')).toBeNull();
    expect(q.match('what time is it')).toMatchObject({ id: 'time' });
  });
});

describe('planQuickRequest (mixed requests)', () => {
  const ids = (p) => p && { steps: p.steps.map((s) => s.id + (s.app ? `:${s.app}` : s.command ? `:${s.command}` : s.url ? `:${s.url}` : '')), rest: p.rest };
  const cases = [
    ['Open Spotify and play my liked songs', { steps: ['open-app:Spotify'], rest: 'play my liked songs' }],
    ['Open Safari and go to github.com', { steps: ['open-app:Safari', 'open-url:https://github.com'], rest: null }],
    ['pause the music and lock my screen', { steps: ['media:pause', 'lock'], rest: null }],
    ['take a screenshot and send it to Sam', { steps: ['screenshot'], rest: 'send it to sam' }],
    ['Open Notes, then start a new note called groceries', { steps: ['open-app:Notes'], rest: 'start a new note called groceries' }],
    ['what time is it and what is the weather in mumbai', { steps: ['time'], rest: 'what is the weather in mumbai' }],
    ['Hey, open Safari, then go to youtube.com and search for lofi', { steps: ['open-app:Safari', 'open-url:https://youtube.com'], rest: 'search for lofi' }],
    // A whole-utterance match wins: "and" inside a query is not a step break.
    ['google salt and pepper', { steps: ['web-search'], rest: null }],
    ['search youtube for rock and roll', { steps: ['web-search'], rest: null }],
  ];
  for (const [said, want] of cases) {
    it(`"${said}"`, () => expect(ids(planQuickRequest(said))).toEqual(want));
  }

  it('aims "play" at the player it just opened', () => {
    expect(planQuickRequest('open spotify and play').steps[1]).toEqual({ id: 'media', command: 'play', player: 'Spotify' });
  });

  // Only a LEADING run of instant clauses is taken: order matters.
  for (const said of ['find the email from Sam and take a screenshot', 'open terminal and run ls', 'play my liked songs', 'summarize this page then lock my screen']) {
    it(`leaves "${said}" whole to the AI`, () => expect(planQuickRequest(said)).toBeNull());
  }

  it('reads "github dot com" as an address but not a sentence that ends in one', () => {
    expect(matchQuickCommand('go to github dot com')).toEqual({ id: 'open-url', url: 'https://github.com' });
    expect(matchQuickCommand('open safari and go to github.com')).toBeNull();
  });

  it('off a Mac, the remainder starts at the first command it cannot run', () => {
    const q = createQuickCommands(runners({ platform: 'linux' }).deps);
    expect(q.plan('what time is it and open safari')).toEqual({ steps: [{ id: 'time' }], rest: 'open safari' });
  });

  it('sends "play" straight to the player it names', async () => {
    const { calls, deps } = runners({ runningApps: async () => [] });
    const q = createQuickCommands(deps);
    expect(await q.run({ id: 'media', command: 'play', player: 'Spotify' })).toMatchObject({ ok: true, text: 'Playing Spotify.' });
    expect(calls).toEqual([['as', 'tell application "Spotify" to play']]);
  });
});
