/**
 * Tellaflow's assistant — canvas's Jarvis, without the editor and without a
 * voice of its own.
 *
 * The command key's words arrive here. One warm, HIDDEN bb thread answers them
 * (bb/mascot-thread.js); its text streams onto the voice island as it is
 * written (no TTS — the island is the voice); the reply's ```mascot block is
 * validated (mascot-actions.js) and run (mascot-dispatch.js) against the
 * desktop through Peekaboo (desktop/os-actions.js); and a desktop task carries
 * on as the computer-use loop until it is done, refused or stopped. Bigger jobs
 * go to a VISIBLE bb chat in the assistant's workspace, which the Assistant
 * page frames — that is where the user talks to bb directly, with every thread.
 *
 * Four rules from canvas that this module keeps:
 *
 *  1. **The newest utterance wins.** Every turn takes a generation; Stop, a new
 *     request and switching off bump it, and every write (island, dispatch,
 *     confirmation) is gated on it. A superseded turn is silent.
 *  2. **Nothing claims what did not happen.** What each action really did goes
 *     into the transcript and the next turn's WHAT YOUR LAST REPLY'S ACTIONS
 *     DID; a desktop step is checked by a fresh look, never by the model's word.
 *  3. **The half-written fence never reaches the island** — `splitMascotReply`
 *     cuts a trailing partial fence from every streamed frame.
 *  4. **Confirmations are scoped to the turn.** "Run the rest of this task"
 *     dies with the turn, and is never offered on a forced confirmation.
 */

const path = require('path');
const fs = require('fs');

const { createMascotThreads } = require('./bb/mascot-thread');
const { ensureBbServer, currentBbServer, stopBbServer } = require('./bb/supervisor');
const { createProjectMap } = require('./bb/project-map');
const workspace = require('./bb/workspace-url');
const { splitMascotReply, parseMascotActions } = require('./mascot-reply');
const { isOsAction, TERMINAL_ACTIONS } = require('./mascot-actions');
const { runMascotActions } = require('./mascot-dispatch');
const { buildMascotStanding, buildMascotTurn } = require('./mascot-prompt');
const loopParts = require('./desktop-loop');
const { buildRewriteStanding } = require('./rewrite');

/** Turns of conversation kept for re-seeding a rotated thread. */
const MAX_TRANSCRIPT = 40;
/** A still older than this is not "the screen right now". */
const SCREEN_SHOT_TTL_MS = 12_000;
/** Island answers rest after a reading time of their length. */
function readingTime(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.min(30_000, Math.max(8000, words * 350));
}

/** Actions that end a desktop task when a step emits them. */
const TERMINAL_LOOP_ENDS = new Set(['delegate_to_agent', 'end_turn']);

const CONFIRM_YES = 'Do it';
const CONFIRM_ALL = 'Run the rest';
const CONFIRM_NO = 'No';

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Why a forced confirmation asks, in the user's terms. */
const FORCED_WHY = [
  [/^quit$/, 'Quitting can lose unsaved work, so this always asks.'],
  [/^destructive menu path$/, "This can't be undone, so it always asks."],
  [/^destructive shortcut$/, 'That shortcut quits or deletes, so it always asks.'],
  [/^denylisted app/, 'That app holds passwords or system settings, so it always asks.'],
  [/^opens a program$/, 'Opening it runs a program, so this always asks.'],
];

/**
 * The confirmation card: the step as the title, its payload (text to type, an
 * address, a file) quoted in full underneath, and — for one that always asks
 * — why, in a footnote. The payload is never summarised: a confirmation that
 * shows a preview is a click the user was talked into.
 */
function confirmCard(action, seen, reason) {
  const described = loopParts.describeOsAction(action, seen);
  const [head, ...rest] = described.split('\n\n');
  const quote = rest.join('\n\n').replace(/^“|”$/g, '');
  const title = `${head.replace(/:$/, '').replace(/^Type this$/, 'Type this text')}?`;
  const why = reason ? FORCED_WHY.find(([re]) => re.test(reason))?.[1] ?? 'This one always asks.' : null;
  return { title, body: '', ...(quote ? { quote } : {}), ...(why ? { footnote: why } : {}) };
}

/**
 * @param {object} deps
 * @param {{ show(state: string, opts?: object): void, rest(): void }} deps.island
 * @param {() => { desktopActions?: boolean, fullAccess?: boolean, screenVision?: boolean, provider?: string }} deps.getSettings
 * @param {() => Promise<object|null>} [deps.getContext]   where the user was when they pressed the key
 * @param {object} deps.os                                   desktop/os-actions.js (or a fake)
 * @param {string} deps.workspaceDir                         the folder the assistant's bb project lives in
 * @param {string} [deps.rewriteDir]                         the rewrite thread's own bb project (default: beside the workspace)
 * @param {() => boolean} [deps.rewriteEnabled]              warm the rewrite thread too
 * @param {(entry: object) => void} [deps.record]            transcript lines, for history and the page
 * @param {(threadUrl: string) => void} [deps.openChat]      show a bb chat on the Assistant page
 * @param {() => void} [deps.openAccessibility]              System Settings › Accessibility
 * @param {() => void} [deps.openSettings]                   Tellaflow › Settings › Assistant
 * @param {object} [deps.bb]                                 test seams: { ensureServer, createThreads(emit), workspace }
 */
function createJarvis(deps) {
  const log = deps.log || ((...a) => console.log('[assistant]', ...a));
  const island = deps.island;
  const os = deps.os;
  const ensureServer = deps.bb?.ensureServer || ((o) => ensureBbServer({ log: (m) => log(m), ...o }));
  const ws = deps.bb?.workspace || workspace;
  const settings = () => deps.getSettings() || {};
  const wsDeps = () => ({
    ensureServer,
    modelChoice: async () => modelChoice(),
  });

  let maps = new WeakMap();
  function projectMap(client) {
    let map = maps.get(client);
    if (!map) { map = createProjectMap(client); maps.set(client, map); }
    return map;
  }

  async function modelChoice() {
    const p = settings().provider;
    return p && p !== 'auto' ? { providerId: p } : null;
  }

  function workspaceDir() {
    try { fs.mkdirSync(deps.workspaceDir, { recursive: true }); } catch {}
    return deps.workspaceDir;
  }

  // ── State ────────────────────────────────────────────────────────────────
  let generation = 0;
  let active = null;        // { gen, turnId, request, prose, status, said[], latch, stopped }
  let loop = null;          // { goal, steps, failures }
  let pending = null;       // { kind: 'confirm'|'ask', resolve, options? }
  let lastChat = null;      // the visible chat work last went into
  let lastChatUrl = null;
  const transcript = [];    // { role: 'user'|'mascot', text, actions? }
  let seenHeld = null;      // { result, at }
  let shot = null;          // { path, at }
  let backend = { state: 'idle', error: null };
  let nextTurn = 1;
  let settleTurn = null;    // resolves the turn in flight's wait

  const isLive = (gen) => () => gen === generation;

  function setBackend(state, error = null) {
    backend = { state, error };
    deps.onStatus?.(backend);
  }

  function pushTranscript(entry) {
    transcript.push(entry);
    while (transcript.length > MAX_TRANSCRIPT) transcript.shift();
    try { deps.record?.(entry); } catch {}
  }

  // ── The brain ────────────────────────────────────────────────────────────
  const listeners = new Map(); // turnId → fn
  const emitBrain = (event) => listeners.get(event.turnId)?.(event);
  const threads = deps.bb?.createThreads ? deps.bb.createThreads(emitBrain) : createMascotThreads({
    client: async () => (await ensureServer()).client,
    resolve: async (cwd) => {
      const server = await ensureServer();
      return projectMap(server.client).resolve(cwd);
    },
    modelChoice,
    fallbackCwd: () => workspaceDir(),
    emit: emitBrain,
    log: (m, d) => log(m, d ?? ''),
  });

  // ── The rewrite thread ───────────────────────────────────────────────────
  // Rewrites (jarvis/rewrite.js) run on a hidden thread of their own, in a bb
  // project of their own: the assistant's conversation never sees them, and
  // the Assistant page (which frames the workspace project) never lists them.
  const rewriteListeners = new Map(); // turnId → fn
  const rewriteWaits = new Set();     // settles each rewrite in flight on a stop
  const emitRewrite = (event) => rewriteListeners.get(event.turnId)?.(event);
  const rewriteThreads = deps.bb?.createRewriteThreads ? deps.bb.createRewriteThreads(emitRewrite) : createMascotThreads({
    client: async () => (await ensureServer()).client,
    resolve: async (cwd) => {
      const server = await ensureServer();
      return projectMap(server.client).resolve(cwd);
    },
    modelChoice,
    fallbackCwd: () => rewriteDir(),
    emit: emitRewrite,
    log: (m, d) => log(`rewrite: ${m}`, d ?? ''),
  });
  let nextRewrite = 1;
  const REWRITE_RETRY_MS = deps.rewriteRetryMs ?? 2000;

  function rewriteDir() {
    const dir = deps.rewriteDir || path.join(path.dirname(deps.workspaceDir), 'rewrite');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    return dir;
  }

  /** bb errors that pass: a cold provider, a thread still provisioning. */
  const TRANSIENT_REWRITE = /\b(503|409)\b|Provisioning thread failed|Environment unavailable|operation was aborted|not ready/i;

  /** One rewrite: the prompt in, the whole answer out. A newer one stops it.
   *  A rewrite carries no conversation, so a failed thread is dropped (the
   *  next one starts clean) and a transient bb error is tried again. */
  async function rewrite(prompt, onWaking) {
    let outcome = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, REWRITE_RETRY_MS));
      outcome = await rewriteOnce(prompt, onWaking);
      if (outcome.ok || outcome.message === 'stopped') return outcome;
      log('rewrite failed:', outcome.message);
      await rewriteThreads.reset().catch(() => {});
      if (!TRANSIENT_REWRITE.test(outcome.message || '')) return outcome;
    }
    return outcome;
  }

  async function rewriteOnce(prompt, onWaking) {
    const turnId = `r${nextRewrite++}`;
    const finished = new Promise((resolve) => {
      rewriteListeners.set(turnId, (event) => {
        if (event.kind === 'waking') onWaking?.();
        else if (event.kind === 'done') resolve({ ok: true, text: event.text });
        else if (event.kind === 'error') resolve({ ok: false, message: event.message });
        else if (event.kind === 'question') resolve({ ok: false, message: 'The AI asked a question instead of rewriting.' });
      });
    });
    rewriteThreads.turn({ turnId, cwd: rewriteDir(), standing: buildRewriteStanding(), prompt }).catch((err) => {
      rewriteListeners.get(turnId)?.({ turnId, kind: 'error', message: String(err?.message || err) });
    });
    // A stopped turn is silent, so a stop settles the wait from here.
    let settle;
    const stopped = new Promise((resolve) => { settle = resolve; rewriteWaits.add(resolve); });
    const outcome = await Promise.race([finished, stopped]);
    rewriteListeners.delete(turnId);
    rewriteWaits.delete(settle);
    return outcome;
  }

  async function stopRewrite() {
    for (const settle of rewriteWaits) settle({ ok: false, message: 'stopped' });
    rewriteWaits.clear();
    await rewriteThreads.stop().catch(() => {});
  }

  /** Start bb and make the thread before the user's first words arrive: a cold
   *  thread is ~14 s to its first token, a warm one ~1.5 s (canvas measured). */
  async function warm() {
    // The thread's warm is registered at once, before bb is even up: a command
    // that arrives while bb starts then waits for this thread instead of making
    // a second one beside it — bb fails both ("Provisioning thread failed",
    // measured here exactly as canvas measured it).
    const warming = threads.warm(workspaceDir(), buildMascotStanding(transcript));
    try {
      setBackend('starting');
      await ensureServer();
      setBackend('ready');
    } catch (err) {
      setBackend('error', String(err?.message || err));
    }
    const r = await warming;
    if (!r.ok) log('warm failed:', r.error);
    // After the assistant's own thread, never beside it: two threads made at
    // once is what bb refuses.
    if (deps.rewriteEnabled?.()) {
      const rw = await rewriteThreads.warm(rewriteDir(), buildRewriteStanding());
      if (!rw.ok) log('rewrite warm failed:', rw.error);
    }
    return r;
  }

  // ── The island ───────────────────────────────────────────────────────────
  function showReply(gen, extra = {}) {
    if (gen !== generation || !active) return;
    const said = active.said.length ? active.said.join(' ') : '';
    const text = [active.prose, said].filter(Boolean).join(active.prose && said ? '\n\n' : '');
    island.show('reply', {
      content: {
        reply: {
          title: clip(active.request, 140),
          text,
          status: active.status || null,
          working: !!active.working,
          chat: !!lastChatUrl && active.delegated,
          ...(loop && loop.steps > 0 ? { step: loop.steps + 1 } : active.lastStep ? { step: active.lastStep } : {}),
          // An answer in words (not a desktop task, not a hand-off) can be
          // typed into the app the user was in, or copied.
          canInsert: !active.working && !active.done && !active.delegated && !active.ranOs && !!deps.insertText,
          ...(active.copied ? { copied: true } : {}),
          ...extra,
        },
      },
      ...(extra.autoRestMs ? { autoRestMs: extra.autoRestMs } : {}),
    });
  }

  function settleReply(gen) {
    if (gen !== generation || !active) return;
    active.working = false;
    active.status = null;
    // A finished desktop task with no words of its own shows its summary.
    if (!active.prose && active.done) active.prose = active.done;
    const text = [active.prose, ...active.said].join(' ');
    if (!text.trim()) { island.rest(); return; }
    active.answer = text;
    try { deps.saveAnswer?.({ request: active.request, text }); } catch {}
    showReply(gen, { autoRestMs: readingTime(text), done: !!active.done });
  }

  // ── The desktop capability the dispatcher drives ─────────────────────────
  function heldSeen() {
    if (!seenHeld) return null;
    const ageMs = Date.now() - seenHeld.at;
    if (ageMs > loopParts.OS_SEEN_TTL_MS) return null;
    return { result: seenHeld.result, ageMs };
  }

  async function osSee(app) {
    const r = await os.osSee(app).catch((e) => ({ ok: false, elements: [], error: String(e?.message || e) }));
    if (r.ok) seenHeld = { result: r, at: Date.now() };
    return r;
  }

  function osCtx(gen) {
    if (!settings().desktopActions) return null;
    return {
      status: () => os.getOsStatus(),
      see: (app) => osSee(app),
      act: (action) => os.osAct(action),
      inspect: (what) => os.osInspect(what),
      point: async (bounds) => {
        say(gen, `It's at ${Math.round(bounds.x + bounds.width / 2)}, ${Math.round(bounds.y + bounds.height / 2)} on your screen.`);
      },
      lastSeen: () => heldSeen()?.result ?? null,
      invalidateSeen: () => { seenHeld = null; },
      confirm: (action, opts) => confirm(gen, action, opts),
    };
  }

  function say(gen, text) {
    if (gen !== generation || !active) return;
    active.said.push(text);
    showReply(gen);
  }

  /** Ask the user, on the island. Auto-approves a plain confirmation when
   *  actions run without asking or the turn's "run the rest" latch is set;
   *  NEVER a forced one. */
  function confirm(gen, action, opts = {}) {
    if (gen !== generation) return Promise.resolve(false);
    const forced = !!opts.forced;
    if (!forced && (settings().fullAccess || active?.latch)) return Promise.resolve(true);
    const card = confirmCard(action, heldSeen()?.result ?? null, forced ? opts.reason : null);
    return new Promise((resolve) => {
      settlePending();
      pending = {
        kind: 'confirm',
        resolve: (answer) => {
          if (answer === CONFIRM_ALL && !forced && active) active.latch = true;
          resolve(answer === CONFIRM_YES || (answer === CONFIRM_ALL && !forced));
        },
      };
      island.show('approval', {
        content: {
          notice: {
            ...card,
            primary: CONFIRM_YES,
            secondary: forced ? null : CONFIRM_ALL,
            tertiary: CONFIRM_NO,
          },
        },
      });
    });
  }

  function askUser(gen, { question, options }) {
    if (gen !== generation) return Promise.resolve(null);
    return new Promise((resolve) => {
      settlePending();
      pending = { kind: 'ask', resolve, options: options || [] };
      island.show('ask', { content: { ask: { question, options: (options || []).slice(0, 4) } } });
    });
  }

  function settlePending(answer = null) {
    const p = pending;
    pending = null;
    p?.resolve(answer);
  }

  async function agentChats() {
    try {
      const threadsNow = await ws.listWorkspaceThreads(workspaceDir(), wsDeps());
      return threadsNow.map((t) => ({ id: t.id, title: t.title ?? null, createdAt: t.createdAt ?? 0 }));
    } catch {
      return [];
    }
  }

  async function delegate(task, chat) {
    try {
      const r = chat
        ? await ws.sendToWorkspaceThread(workspaceDir(), chat, task, wsDeps())
        : await ws.startWorkspaceThread(workspaceDir(), task, wsDeps());
      lastChat = r.threadId;
      lastChatUrl = r.url;
      return { ok: true, chat: r.threadId, created: !chat };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  // ── A turn ───────────────────────────────────────────────────────────────

  /** The still and the look, taken while the brain wakes. Never awaited past
   *  what the turn can afford, and only behind the user's switches. */
  async function precapture() {
    const s = settings();
    const jobs = [];
    if (s.screenVision !== false && (!shot || Date.now() - shot.at > 2000)) {
      jobs.push(os.captureScreen().then((r) => { if (r?.ok && r.path) shot = { path: r.path, at: Date.now() }; }).catch(() => {}));
    }
    if (s.desktopActions) {
      jobs.push(os.getOsStatus().then((st) => (st.supported && st.accessibility ? osSee() : null)).catch(() => {}));
    }
    await Promise.all(jobs);
  }

  function describeResults(actions, results) {
    return actions.slice(0, results.length).map((a, i) => {
      const r = results[i];
      const note = r?.note ? ` → ${r.note}` : '';
      return `${a.type}${r?.ok ? '' : ' FAILED'}${note}`;
    });
  }

  /**
   * One turn: prompt → stream → actions → (the loop's next step).
   * @param {string} said
   * @param {{ step?: boolean, answer?: boolean, before?: object|null }} [opts]
   */
  async function runTurn(said, opts = {}) {
    const gen = generation;
    const live = isLive(gen);
    let message = said;
    if (loop && !opts.step && !opts.answer) {
      // Talking over a desktop task REDIRECTS it.
      message = `While you were working through the desktop task "${loop.goal}", the user said: "${said}". Do what they say now — carry on differently, or stop with end_turn if they want it stopped.`;
      loop.goal = `${loop.goal} (then: ${said})`;
      loop.failures = 0;
    }

    active.status = opts.step ? 'Checking the screen…' : 'Thinking…';
    active.working = true;
    showReply(gen);

    const capture = precapture();
    const chatsP = agentChats();
    let context = null;
    try { context = deps.getContext ? await deps.getContext() : null; } catch {}
    await capture;
    if (!live()) return;
    const chats = await chatsP;
    const held = heldSeen();
    const desktop = !!settings().desktopActions;
    const screenshotPath = held?.result?.screenshotPath
      || (shot && Date.now() - shot.at < SCREEN_SHOT_TTL_MS ? shot.path : null);
    const before = held?.result ?? null;

    const prompt = buildMascotTurn({
      context,
      screenshotPath,
      agentChats: chats,
      lastChat,
      osElements: desktop && held ? loopParts.serializeOsElements(held.result, undefined, held.ageMs) : null,
      desktop,
      history: transcript,
      message,
    });
    if (!opts.step) pushTranscript({ role: 'user', text: said, at: Date.now() });

    const turnId = `t${nextTurn++}`;
    active.turnId = turnId;
    const finished = new Promise((resolve) => {
      // Stop settles the wait too: a stopped turn's brain goes silent, and a
      // promise left waiting on it would hold this request open forever.
      settleTurn = resolve;
      listeners.set(turnId, (event) => {
        if (!live()) return;
        switch (event.kind) {
          case 'waking':
            active.status = 'Waking up — the first answer takes a few extra seconds…';
            showReply(gen);
            break;
          case 'text': {
            if (active.fresh) { active.fresh = false; active.said = []; }
            active.prose = splitMascotReply(event.text).prose;
            active.status = null;
            showReply(gen);
            break;
          }
          case 'tool':
            active.status = `Using ${clip(event.name, 30)}…`;
            showReply(gen);
            break;
          case 'question':
            active.question = { question: event.question, options: event.options };
            break;
          case 'done':
            resolve({ ok: true, text: event.text });
            break;
          case 'error':
            resolve({ ok: false, message: event.message });
            break;
          default:
            break;
        }
      });
    });
    threads.turn({ turnId, cwd: workspaceDir(), standing: buildMascotStanding(transcript), prompt }).catch((err) => {
      listeners.get(turnId)?.({ turnId, kind: 'error', message: String(err?.message || err) });
    });
    const outcome = await finished;
    listeners.delete(turnId);
    if (settleTurn === null || !live()) return;
    settleTurn = null;
    if (!live()) return;

    if (!outcome.ok) {
      active.working = false;
      loop = null;
      pushTranscript({ role: 'mascot', text: `(error: ${outcome.message})`, actions: [] });
      showError(gen, outcome.message);
      return;
    }

    const split = splitMascotReply(outcome.text || '');
    const prose = split.prose;
    const actions = split.fence ? parseMascotActions(split.fence) : [];
    active.prose = prose;
    const results = actions.length
      ? await runMascotActions(actions, {
        os: osCtx(gen),
        isLive: live,
        say: (t) => say(gen, t),
        askUser: (q) => askUser(gen, q),
        agentChats: () => chats,
        delegate,
        onDelegated: () => { if (active) active.delegated = true; },
        offerSettings: () => { if (active) active.offerAccessibility = true; },
        offerHelper: () => { if (active) active.offerHelper = true; },
        beforeAction: (a) => {
          const caption = loopParts.stepCaption(a);
          if (caption && active) { active.status = caption; showReply(gen); }
        },
      })
      : [];
    if (!live()) return;

    const notes = describeResults(actions, results);
    // A native question is the turn's ask_user.
    let answer = null;
    if (active.question) {
      const q = active.question;
      active.question = null;
      answer = await askUser(gen, q);
      if (!live()) return;
      notes.push(`ask_user → ${answer ?? '(no answer)'}`);
    }

    const ran = actions.slice(0, results.length);
    if (ran.some(isOsAction)) active.ranOs = true;
    const askIdx = ran.findIndex((a) => a.type === 'ask_user');
    if (askIdx >= 0) answer = results[askIdx]?.note ?? null;

    const next = await stepTheLoop(said, ran, results, before, notes, live);
    pushTranscript({ role: 'mascot', text: prose, actions: notes, at: Date.now() });
    if (!live()) return;

    // The last step's words stay on the island until the next step's arrive,
    // so the card never blanks between steps.
    if (answer) {
      active.fresh = true;
      await runTurn(answer, { answer: true });
      return;
    }
    if (next) {
      active.fresh = true;
      active.latch = false;
      await runTurn(next, { step: true });
      return;
    }
    if (active.offerHelper && deps.installHelper) {
      active.setup = 'helper';
      island.show('setup', {
        content: {
          notice: {
            title: 'Install the desktop helper',
            body: 'To see and use your other apps, Tellaflow needs a small helper (Peekaboo). It downloads once and is checked before it runs.',
            primary: 'Install',
            primaryAction: 'install-helper',
            secondary: 'Later',
          },
        },
      });
      return;
    }
    if (active.offerAccessibility) {
      island.show('setup', {
        content: {
          notice: {
            title: 'Allow Accessibility',
            body: 'Tellaflow needs Accessibility to click and type in your other apps.',
            footnote: 'Turn on Tellaflow in System Settings › Privacy & Security › Accessibility, then ask again.',
            primary: 'Open System Settings',
            secondary: 'Later',
          },
        },
      });
      active.setup = 'accessibility';
      return;
    }
    settleReply(gen);
  }

  /** canvas's `stepTheLoop`: decide whether the desktop task goes on, verify
   *  the step by a fresh look, and return the next step's message or null. */
  async function stepTheLoop(said, ran, results, before, notes, live) {
    const hadOs = ran.some(isOsAction);
    const last = ran[ran.length - 1]?.type;
    const done = ran.find((a) => a.type === 'task_done');
    if (done) {
      if (active && loop) active.lastStep = loop.steps + 1;
      loop = null;
      if (active) active.done = done.summary;
      return null;
    }
    if (last === 'ask_user') return null;
    if (!hadOs || !settings().desktopActions || (last && TERMINAL_LOOP_ENDS.has(last))) {
      loop = null;
      return null;
    }
    const osRan = ran.map((a, i) => ({ a, r: results[i] })).filter((x) => isOsAction(x.a));
    // A REFUSAL ends the task; a failed ACT is what a fresh look can fix.
    const refused = osRan.some((x) => x.r && !x.r.ok && x.r.note !== 'cancelled' && !loopParts.retryableFailure(x.r.note));
    if (refused) {
      loop = null;
      return null;
    }
    const acted = osRan.some((x) => loopParts.ACTING_OS.has(x.a.type));
    const looked = osRan.some((x) => x.a.type === 'os_see');
    const pointed = osRan.some((x) => x.a.type === 'os_point');
    if (!loop && !acted && (!looked || pointed)) return null;
    if (!loop) loop = { goal: said, steps: 0, failures: 0 };
    const me = loop;
    me.steps += 1;
    const failedAction = ran.some((a, i) => isOsAction(a) && !results[i]?.ok && results[i]?.note !== 'cancelled');
    const after = await osSee();
    if (!live() || loop !== me) return null;
    const check = loopParts.verifyStep(ran, results, before, after.ok ? after : null);
    if (check) notes.push(check.ok ? `step check: ${check.note}` : `step check FAILED: ${check.note}`);
    if (failedAction || (check && !check.ok)) me.failures += 1;
    else if (check?.ok) me.failures = 0;
    if (me.failures >= 2) {
      loop = null;
      if (active) active.said.push("I couldn't get that to work, so I've stopped.");
      return null;
    }
    return loopParts.nextStepMessage(me.goal, me.steps);
  }

  function showError(gen, message) {
    if (gen !== generation) return;
    const text = String(message || 'Something went wrong.');
    const signIn = /sign ?in|log ?in|unauthenticated|not authenticated|credential|api key|unauthor|provider_unavailable|unable to load models/i.test(text);
    const noNode = /needs Node/i.test(text);
    const unreachable = /isn't running|did not become ready|ECONNREFUSED|fetch failed/i.test(text);
    if (active) active.setup = signIn ? 'sign-in' : null;
    island.show('error', {
      content: {
        notice: noNode
          ? { title: 'The assistant couldn’t start', body: 'Its Node runtime is missing from this copy of Tellaflow. Reinstalling Tellaflow fixes it.', primary: 'Try again', secondary: 'Dismiss' }
          : signIn
            ? {
              title: 'Sign in to your AI',
              body: 'The assistant runs on an AI you’re signed in to on this Mac — Claude Code or Codex. No API keys.',
              footnote: 'Sign in opens Terminal for it; your browser finishes the sign-in. Then ask again.',
              primary: deps.signIn ? 'Sign in' : 'Open Settings',
              primaryAction: deps.signIn ? 'sign-in' : 'open-settings',
              secondary: 'Settings',
              secondaryAction: 'open-settings',
            }
            : unreachable
              ? { title: 'The assistant isn’t running', body: 'It stopped or couldn’t start. Trying again restarts it.', footnote: clip(text, 140), primary: 'Try again', secondary: 'Dismiss' }
              : { title: 'That didn’t work', body: clip(text, 220), primary: 'Try again', secondary: 'Dismiss' },
      },
    });
  }

  // ── Public ───────────────────────────────────────────────────────────────

  /** A request from the command key (or typed). The newest wins. */
  async function ask(request, { source = 'voice' } = {}) {
    const text = String(request || '').trim();
    if (!text) return;
    // Spoken while the island holds a question: that is the answer (a question
    // with no options has no other way to be answered from the island).
    if (pending?.kind === 'ask' && active) {
      settlePending(text);
      return;
    }
    const gen = ++generation;
    settlePending();
    const settle = settleTurn;
    settleTurn = null;
    settle?.({ ok: false, message: 'superseded' });
    await threads.stop().catch(() => {});
    if (gen !== generation) return;
    // A new request while a task runs is handled inside runTurn as a redirect;
    // after a finished task it starts fresh.
    active = { gen, request: text, prose: '', said: [], status: 'Thinking…', working: true, latch: false, source };
    showReply(gen);
    try {
      await runTurn(text);
    } catch (err) {
      log('turn failed:', err);
      showError(gen, String(err?.message || err));
    }
  }

  /** Stop everything: the turn, the loop, any open question. */
  async function stop() {
    generation++;
    loop = null;
    settlePending();
    const settle = settleTurn;
    settleTurn = null;
    settle?.({ ok: false, message: 'stopped' });
    active = null;
    await threads.stop().catch(() => {});
  }

  /** Island buttons that belong to the assistant. Returns true if handled,
   *  or `{ retry }` when the request should run again. */
  function action(name) {
    if (pending?.kind === 'confirm') {
      if (name === 'approve') { settlePending(CONFIRM_YES); return true; }
      if (name === 'edit') { settlePending(CONFIRM_ALL); return true; }
      if (name === 'cancel' || name === 'dismiss') { settlePending(CONFIRM_NO); return true; }
    }
    if (pending?.kind === 'ask') {
      const m = /^answer:(\d)$/.exec(name);
      if (m) { settlePending(pending.options[Number(m[1])] ?? null); return true; }
      if (name === 'dismiss') { settlePending(null); void stop(); island.rest(); return true; }
    }
    if (!active) return false;
    switch (name) {
      case 'stop':
        void stop();
        island.rest();
        return true;
      case 'open-chat':
        if (lastChatUrl) deps.openChat?.(lastChatUrl);
        island.rest();
        return true;
      case 'retry': {
        const { request } = active;
        active = null;
        return { retry: request };
      }
      case 'open-settings':
        if (active.setup === 'accessibility') deps.openAccessibility?.();
        else deps.openSettings?.();
        active = null;
        island.rest();
        return true;
      case 'sign-in':
        deps.signIn?.();
        active = null;
        island.rest();
        return true;
      case 'insert': {
        const text = active.answer;
        if (text && deps.insertText) {
          active = null;
          deps.insertText(text);
        }
        return true;
      }
      case 'copy':
        if (active.answer) {
          deps.copyText?.(active.answer);
          active.copied = true;
          showReply(generation, { autoRestMs: 4000 });
        }
        return true;
      case 'install-helper':
        void installHelperThenRetry();
        return true;
      case 'dismiss':
      case 'later':
        void stop();
        island.rest();
        return true;
      default:
        return false;
    }
  }

  /** The helper, installed from the island, with its progress there; then
   *  the request that needed it runs again. */
  async function installHelperThenRetry() {
    const request = active?.request;
    const show = (progress, footnote) => island.show('setup', {
      content: { notice: { title: 'Installing the desktop helper…', body: '', progress, footnote, primary: null, secondary: null } },
    });
    show(0, 'Downloading…');
    try {
      await deps.installHelper((received, total) => {
        if (total) show(Math.min(1, received / total), `Downloading… ${Math.round((received / total) * 100)}%`);
      });
    } catch (err) {
      island.show('error', {
        content: { notice: { title: 'The helper didn’t install', body: clip(String(err?.message || err), 180), primary: 'Try again', primaryAction: 'install-helper', secondary: 'Dismiss' } },
      });
      return;
    }
    if (request) await ask(request);
  }

  async function providers() {
    const server = await ensureServer();
    const [list, state] = await Promise.all([
      server.client.providers().catch(() => []),
      server.client.providerStates().catch(() => null),
    ]);
    const stateById = new Map();
    for (const row of Array.isArray(state?.providers) ? state.providers : []) {
      if (row && typeof row.providerId === 'string') stateById.set(row.providerId, row);
    }
    return (Array.isArray(list) ? list : [])
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => {
        const row = stateById.get(p.id) || {};
        return {
          id: p.id,
          label: typeof p.displayName === 'string' && p.displayName ? p.displayName : p.id,
          status: typeof row.status === 'string' ? row.status : 'unknown',
          loginCommand: typeof row.loginCommand === 'string' ? row.loginCommand : null,
          accountEmail: typeof row.accountEmail === 'string' ? row.accountEmail : null,
        };
      });
  }

  async function status() {
    const server = currentBbServer();
    let osStatus = null;
    try { osStatus = await os.getOsStatus(); } catch {}
    return {
      backend: server ? { state: 'ready', error: null, origin: server.client.origin } : backend,
      desktop: osStatus,
    };
  }

  /** The URL the Assistant page frames: bb's own app for the workspace. */
  async function workspaceUrl(threadId) {
    return ws.bbWorkspaceUrl(workspaceDir(), wsDeps(), threadId, !threadId);
  }

  async function reset() {
    await stop();
    transcript.length = 0;
    await threads.reset().catch(() => {});
    await rewriteThreads.reset().catch(() => {});
  }

  async function dispose() {
    await stop();
    await stopRewrite();
    await stopBbServer().catch(() => {});
  }

  return {
    ask,
    stop,
    warm,
    rewrite,
    stopRewrite,
    action,
    status,
    providers,
    workspaceUrl,
    reset,
    dispose,
    isActive: () => !!active,
    transcript: () => transcript.slice(),
  };
}

module.exports = { createJarvis, CONFIRM_YES, CONFIRM_ALL, CONFIRM_NO };
