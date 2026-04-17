import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Power, RotateCcw, X, Check, AlertCircle, Send, Smile, Paperclip, Bold, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ipc, type HotkeyConfig } from '@/lib/ipc';

function getDefaultHotkey(platformName: string): HotkeyConfig {
  if (platformName === 'windows') {
    return { names: ['LEFT CTRL', 'LEFT ALT'], label: 'Left Control (^) + Left Alt' };
  }
  return { names: ['LEFT ALT'], label: 'Left Option (⌥)' };
}

// ─── Coloured keyword chip ────────────────────────────────────────────────────
function Chip({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        backgroundColor: bg,
        color: fg,
        borderRadius: 7,
        padding: '0.04em 0.26em',
        whiteSpace: 'nowrap',
        display: 'inline',
      }}
    >
      {children}
    </span>
  );
}

// ─── Single permission row ────────────────────────────────────────────────────
function PermissionRow({
  imgSrc,
  label,
  description,
  granted,
  waiting,
  onGrant,
}: {
  imgSrc: string;
  label: string;
  description: string;
  granted: boolean;
  waiting: boolean;
  onGrant: () => void;
}) {
  return (
    <div
      className={cn('flex items-center gap-3.5 transition-colors', !granted && 'cursor-pointer')}
      style={{ borderRadius: 8, padding: '1px 0' }}
      onClick={!granted ? onGrant : undefined}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
        <img src={imgSrc} alt={label} className="w-8 h-8 object-contain" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: '#111111' }}>{label}</div>
        <div
          className={cn('text-[11px] mt-0.5 font-medium')}
          style={{ color: granted ? '#16a34a' : waiting ? '#d97706' : '#777777' }}
        >
          {description}
        </div>
      </div>
      <AnimatePresence mode="wait">
        {granted ? (
          <motion.div
            key="granted"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 14, stiffness: 300 }}
            className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center shrink-0"
          >
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </motion.div>
        ) : (
          <motion.button
            key="allow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={(e) => { e.stopPropagation(); onGrant(); }}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold shrink-0 hover:opacity-80 transition-opacity"
            style={{ background: '#111111', color: '#ffffff' }}
          >
            Allow
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Step 0: Welcome + Permissions (merged) ───────────────────────────────────
function WelcomePermissionsStep({
  onRestart,
  onNext,
  platformName,
}: {
  onRestart: () => void;
  onNext: () => void;
  platformName: string;
}) {
  const [micGranted, setMicGranted] = useState(false);
  const [accGranted, setAccGranted] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const accPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollAccess = useCallback(() => {
    if (!ipc?.checkAccessibility) return;
    if (accPollRef.current) clearInterval(accPollRef.current);
    accPollRef.current = setInterval(async () => {
      const ok = await ipc.checkAccessibility();
      if (ok) {
        setAccGranted(true);
        setShowInstructions(false);
        clearInterval(accPollRef.current!);
        const restart = await ipc.checkNeedsRestart();
        if (restart) setNeedsRestart(true);
      }
    }, 1500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        setMicGranted(true);
      } catch { /* ignore */ }
      if (ipc?.checkAccessibility) {
        const ok = await ipc.checkAccessibility();
        if (ok) {
          setAccGranted(true);
          if (ipc?.checkNeedsRestart) {
            const restart = await ipc.checkNeedsRestart();
            if (restart) setNeedsRestart(true);
          }
        }
      }
      pollAccess();
    })();
    return () => { if (accPollRef.current) clearInterval(accPollRef.current); };
  }, [pollAccess]);

  const grantMic = async () => {
    if (micGranted) return;
    try {
      if (ipc?.requestMicPermission) {
        const granted = await ipc.requestMicPermission();
        if (granted) setMicGranted(true);
      }
    } catch { /* ignore */ }
  };

  const grantAccessibility = () => {
    if (accGranted) return;
    // promptAccessibility (isTrustedAccessibilityClient(true)) adds the app to
    // the macOS accessibility list AND triggers a system alert. We call it first
    // so the app entry appears, then open System Settings directly — calling both
    // simultaneously would show a modal alert while System Settings is already
    // opening, which is confusing. The small timeout lets the prompt register
    // before we navigate away to System Settings.
    if (ipc?.promptAccessibility) ipc.promptAccessibility();
    setTimeout(() => {
      if (ipc?.openAccessibilitySettings) ipc.openAccessibilitySettings();
    }, 300);
    setShowInstructions(true);
    pollAccess();
  };

  if (needsRestart) {
    return (
      <motion.div
        key="restart"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ type: 'spring', damping: 26, stiffness: 240, mass: 0.9 }}
        className="flex flex-col flex-1 items-center justify-center text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center mb-4">
          <Power className="w-6 h-6 text-blue-500" strokeWidth={1.8} />
        </div>
        <h2 className="text-[18px] font-bold mb-2" style={{ color: '#111111' }}>One sec — quick restart</h2>
        <p className="text-[13px] leading-relaxed max-w-[260px] mb-6" style={{ color: '#666666' }}>
          {platformName === 'macos'
            ? 'macOS needs a restart to activate your hotkey after granting Accessibility. Totally normal!'
            : 'A quick restart may be needed after changing system permission settings.'}
        </p>
        <button
          onClick={() => { if (ipc?.restartApp) ipc.restartApp(); }}
          className="w-full h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          style={{ background: '#111111', color: '#ffffff' }}
        >
          <RotateCcw className="w-3.5 h-3.5" strokeWidth={2.5} /> Restart Now
        </button>
        <button
          onClick={() => { if (accPollRef.current) clearInterval(accPollRef.current); onRestart(); }}
          className="mt-3 text-[12px] transition-colors"
          style={{ color: '#bbbbbb' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#888888')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#bbbbbb')}
        >
          I'll restart later →
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="welcome-perms"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col flex-1 overflow-y-auto min-h-0"
    >
      {/* Logo */}
      <div className="flex justify-start mb-5">
        <img
          src={`${import.meta.env.BASE_URL}onboarding-logo.svg`}
          alt="Tellaflow"
          style={{ height: 44, width: 'auto' }}
        />
      </div>

      {/* Headline */}
      <h1 className="text-[26px] font-bold tracking-tight leading-snug mb-2" style={{ color: '#111111' }}>
        Your voice just got <Chip bg="#EA5228" fg="#fff">superpowers  ⚡</Chip>
      </h1>

      {/* Chips paragraph */}
      <p className="text-[24px] font-semibold leading-[1.9] mb-7" style={{ color: '#111111' }}>
        Dictate into{' '}
        <Chip bg="#0097e6" fg="#fff">every app</Chip>
        {' '}on your computer. Works{' '}
        <Chip bg="#1345eb" fg="#fff">offline</Chip>
        , sends{' '}
        <Chip bg="#3a3a3c" fg="#f7f5f3">zero data</Chip>
        , and is{' '}
        <Chip bg="#e8c700" fg="#1d1d1f">3× faster</Chip>
        {' '}than typing.
      </p>

      {/* Permissions — well design matching settings page */}
      <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 16, padding: 4 }}>
        {/* Well header label */}
        <div style={{ padding: '8px 14px 6px' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#aaaaaa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Two quick things before takeoff 🚀
          </span>
        </div>
        {/* Well card */}
        <div style={{ background: '#ffffff', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)' }}>
          {/* Row 1 */}
          <div style={{ padding: '11px 14px', borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
            <PermissionRow
              imgSrc={`${import.meta.env.BASE_URL}permission-mic.png`}
              label="Microphone"
              description={micGranted ? 'Access granted' : 'Required to hear your voice'}
              granted={micGranted}
              waiting={false}
              onGrant={grantMic}
            />
          </div>
          {/* Row 2 */}
          <div style={{ padding: '11px 14px' }}>
            <PermissionRow
              imgSrc={`${import.meta.env.BASE_URL}permission-accessibility.png`}
              label="Accessibility"
              description={
                accGranted
                  ? 'Access granted'
                  : showInstructions
                  ? 'Waiting — check System Settings'
                  : 'Required to paste text'
              }
              granted={accGranted}
              waiting={showInstructions && !accGranted}
              onGrant={grantAccessibility}
            />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showInstructions && !accGranted && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="rounded-xl px-3.5 py-2.5 border border-blue-200 bg-blue-50 overflow-hidden"
          >
            <p className="text-[11px] leading-relaxed" style={{ color: '#444444' }}>
              {platformName === 'macos'
                ? (
                  <>
                    In System Settings, find{' '}
                    <span className="font-semibold" style={{ color: '#1d6aba' }}>Tellaflow</span>{' '}
                    (or <span className="font-semibold" style={{ color: '#1d6aba' }}>Electron</span> in dev) and toggle{' '}
                    <span className="font-semibold" style={{ color: '#111111' }}>ON</span>.
                  </>
                )
                : (
                  <>
                    In Windows Settings, open Accessibility and make sure Tellaflow can send input to other apps.
                  </>
                )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden sentinel for parent to advance */}
      <button
        id="__permissions-next"
        className="hidden"
        onClick={() => { if (accPollRef.current) clearInterval(accPollRef.current); onNext(); }}
      />
    </motion.div>
  );
}

// ─── Step 1: Playground — model check + dry-run dictation ────────────────────
type ModelCheckState = 'loading' | 'ready' | 'failed';
type RecordState = 'idle' | 'recording' | 'transcribing';

interface ChatMessage {
  id: number;
  text: string;
  fromBot: boolean;
  suggestions?: string[];
}

const SEED_MESSAGES: ChatMessage[] = [
  { id: 1, fromBot: true,  text: 'Hey, welcome to Tellaflow! 👋 I\'m your voice assistant.' },
  { id: 2, fromBot: true,  text: 'You can dictate into any app — emails, docs, chats, anywhere.' },
  { id: 3, fromBot: true,  text: 'Give it a go right now. Hold your hotkey, say one of these, then release:',
    suggestions: ['Hey, this is pretty cool!', 'Meeting at 3 PM tomorrow.', 'The weather is nice today.'] },
];

function PlaygroundStep({ hotkeyHint }: { hotkeyHint: string }) {
  const [modelState, setModelState] = useState<ModelCheckState>('loading');
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>(SEED_MESSAGES);
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recordStateRef = useRef<RecordState>('idle');
  // Stable handler ref — updated when modelState changes, read by the IPC listener below
  const onTextRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => { recordStateRef.current = recordState; }, [recordState]);

  // Keep the handler ref current. When modelState isn't ready, disable it so a
  // late-arriving event doesn't mutate state unexpectedly.
  useEffect(() => {
    if (modelState !== 'ready') {
      onTextRef.current = null;
      return;
    }
    onTextRef.current = (text) => {
      recordStateRef.current = 'idle';
      setRecordState('idle');
      if (text.trim()) {
        setDraft((prev) => (prev ? prev + ' ' + text : text));
      }
    };
  }, [modelState]);

  // Register the IPC listener EXACTLY ONCE with [] deps so React StrictMode's
  // cleanup-and-remount cycle cannot accidentally remove it mid-recording.
  // The handler itself lives in onTextRef so it always has fresh state.
  useEffect(() => {
    if (!ipc?.onPlaygroundText) return;
    ipc.onPlaygroundText((text) => { onTextRef.current?.(text); });
    return () => { if (ipc?.offPlaygroundText) ipc.offPlaygroundText(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTest = useCallback(() => {
    setModelState('loading');
    if (!ipc?.runModelTest) { setModelState('ready'); return; }
    ipc.runModelTest()
      .then((result) => {
        if (result.success || result.skipped) {
          setModelState('ready');
          if (ipc?.setPlaygroundMode) ipc.setPlaygroundMode(true);
        } else {
          setModelState('failed');
        }
      })
      .catch(() => setModelState('failed'));
  }, []);

  // Run model test on mount; turn off playground mode on unmount.
  // Does NOT touch the IPC listener — that's owned by the effect above.
  useEffect(() => {
    runTest();
    return () => { if (ipc?.setPlaygroundMode) ipc.setPlaygroundMode(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Alt-key → start/stop recording.
  // recordStateRef is updated synchronously here (before React re-renders) so the
  // guard never sees a stale value on rapid repeated presses.
  useEffect(() => {
    if (modelState !== 'ready') return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || recordStateRef.current !== 'idle') return;
      if (e.key === 'Alt') {
        e.preventDefault();
        recordStateRef.current = 'recording';
        setRecordState('recording');
        inputRef.current?.focus();
        if (ipc?.clickStartRecording) ipc.clickStartRecording();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && recordStateRef.current === 'recording') {
        recordStateRef.current = 'transcribing';
        setRecordState('transcribing');
        if (ipc?.clickFinishRecording) ipc.clickFinishRecording();
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [modelState]);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: Date.now(), text, fromBot: false }]);
    setDraft('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  if (modelState === 'loading') {
    return (
      <motion.div
        key="playground-loading"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="flex flex-col flex-1 items-center justify-center gap-5 py-16"
      >
        <div className="text-center">
          <p className="text-[14px] font-semibold mb-0.5" style={{ color: '#111111' }}>Warming up the engine…</p>
          <p className="text-[12px]" style={{ color: '#666666' }}>Running a quick test with the model</p>
        </div>

        {/* Progress bar */}
        <div className="w-[220px] h-[5px] rounded-full overflow-hidden" style={{ background: '#e8e8e8' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: '#111111' }}
            initial={{ width: '0%' }}
            animate={{ width: ['0%', '60%', '75%', '88%', '95%'] }}
            transition={{
              duration: 6,
              ease: 'easeOut',
              times: [0, 0.35, 0.6, 0.82, 1],
            }}
          />
        </div>
      </motion.div>
    );
  }

  if (modelState === 'failed') {
    return (
      <motion.div
        key="playground-failed"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="flex flex-col flex-1 items-center justify-center gap-4 py-16 text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-red-500" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-[14px] font-semibold" style={{ color: '#111111' }}>Model check failed</p>
          <p className="text-[12px] mt-1 leading-relaxed max-w-[220px]" style={{ color: '#666666' }}>
            Couldn't start the transcription engine. Make sure a model is downloaded in Settings.
          </p>
        </div>
        <button
          onClick={runTest}
          className="px-5 py-2 rounded-xl text-[13px] font-semibold hover:opacity-80 transition-opacity"
          style={{ background: '#111111', color: '#ffffff' }}
        >
          Try again
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="playground-ready"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col flex-1 min-h-0"
    >
      {/* Logo */}
      <div className="flex justify-start mb-4">
        <img
          src={`${import.meta.env.BASE_URL}onboarding-logo.svg`}
          alt="Tellaflow"
          style={{ height: 44, width: 'auto' }}
        />
      </div>

      {/* Heading */}
      <h2 className="text-[22px] font-bold tracking-tight mb-0.5">
        <span className="text-[22px] font-bold tracking-tight">
          Try it live 🎙️
        </span>
      </h2>
      <p className="text-[12.5px] mb-3" style={{ color: '#555555' }}>
        Hold{' '}
        <kbd
          className="font-mono font-semibold px-1.5 py-0.5 rounded-md text-[11px] not-italic"
          style={{
            background: '#ebebeb',
            border: '1px solid #d0d0d0',
            borderBottom: '2px solid #c0c0c0',
            color: '#111111',
            boxShadow: '0 1px 0 rgba(0,0,0,0.08)',
          }}
        >
          {hotkeyHint}
        </kbd>
        {' '}and speak — your words will appear below.
      </p>

      {/* Slack-style chat */}
      <div
        className="flex flex-col flex-1 rounded-xl overflow-hidden min-h-0"
        style={{ background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)' }}
      >
        {/* ── Workspace strip (Slack aubergine) ── */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 shrink-0"
          style={{ background: '#4A154B' }}
        >
          <div
            className="w-4 h-4 rounded-sm flex items-center justify-center shrink-0"
            style={{ background: '#ffffff22' }}
          >
            <span className="text-[7px] font-black text-white leading-none">TF</span>
          </div>
          <span className="text-[11px] font-extrabold text-white leading-none">Tellaflow Workspace</span>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#2BAC76' }} />
            <span className="text-[10px] font-medium" style={{ color: '#ffffff99' }}>Active</span>
          </div>
        </div>

        {/* ── Channel header ── */}
        <div
          className="flex items-center gap-1.5 px-3.5 py-2 shrink-0"
          style={{ borderBottom: '1px solid #e8e8e8', background: '#ffffff' }}
        >
          <Hash className="w-[15px] h-[15px] shrink-0" style={{ color: '#1d1c1d' }} strokeWidth={2.5} />
          <span className="text-[13px] font-extrabold text-[#1d1c1d]">playground</span>
          <div className="w-px h-3.5 mx-1.5 shrink-0" style={{ background: '#dddddd' }} />
          <span className="text-[11.5px] text-[#616061] truncate">Try dictating here</span>
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto min-h-0 py-1.5" style={{ background: '#ffffff' }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="flex gap-2.5 px-3.5 py-1.5"
              style={{ transition: 'background 80ms' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f8f8')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Slack-style rounded-square avatar */}
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: msg.fromBot ? '#4A154B' : '#e05c1a' }}
              >
                <span className="text-[9px] text-white font-black leading-none">
                  {msg.fromBot ? 'TF' : 'You'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-[2px]">
                  <span className="text-[12.5px] font-extrabold text-[#1d1c1d] leading-none">
                    {msg.fromBot ? 'Tellaflow' : 'You'}
                  </span>
                  <span className="text-[10.5px] leading-none" style={{ color: '#aaaaaa' }}>Today</span>
                </div>
                <p className="text-[12.5px] leading-[1.46875] text-[#1d1c1d] break-words">{msg.text}</p>

                {/* Suggestion chips — shown on the guiding bot message */}
                {msg.suggestions && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.suggestions.map((s) => (
                      <span
                        key={s}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium leading-none"
                        style={{ background: '#f4f0f4', border: '1px solid #c9a8cb', color: '#4A154B' }}
                      >
                        <span style={{ fontSize: 9 }}>🎙</span> {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Transcribing → "Tellaflow is typing…" */}
          <AnimatePresence>
            {recordState === 'transcribing' && (
              <motion.div
                key="typing"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="flex items-center gap-2.5 px-3.5 py-1.5"
              >
                <div
                  className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: '#4A154B' }}
                >
                  <span className="text-[9px] text-white font-black leading-none">TF</span>
                </div>
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-[5px] h-[5px] rounded-full"
                      style={{ background: '#aaaaaa' }}
                      animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
                    />
                  ))}
                  <span className="text-[11px] ml-1" style={{ color: '#616061' }}>Tellaflow is typing…</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>

        {/* ── Slack composer ── */}
        <div className="shrink-0 px-3 pb-2.5 pt-1.5">
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid #c9c9c9' }}
          >
            {/* Recording waveform — above the textarea */}
            <AnimatePresence>
              {recordState === 'recording' && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    className="flex items-center gap-2 px-3 py-1.5"
                    style={{ background: '#fff0f3', borderBottom: '1px solid #ffd6e0' }}
                  >
                    <motion.div
                      animate={{ scale: [1, 1.3, 1] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: '#e01e5a' }}
                    />
                    <div className="flex items-center gap-[3px]">
                      {[0.5, 1.0, 0.7, 1.0, 0.6, 0.9, 0.55].map((h, i) => (
                        <motion.div
                          key={i}
                          className="w-[2.5px] rounded-full"
                          style={{ height: 12, transformOrigin: 'center', background: '#e01e5a' }}
                          animate={{ scaleY: [h * 0.3, h, h * 0.4, h * 0.9, h * 0.3] }}
                          transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.08, ease: 'easeInOut' }}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] font-semibold" style={{ color: '#e01e5a' }}>
                      Listening... release {hotkeyHint} to finish
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={draft}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              onBlur={() => {
                // Re-focus after a tick so hotkey events always reach the window
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              placeholder={`Hold ${hotkeyHint} and speak, or type here...`}
              className="w-full bg-transparent resize-none outline-none leading-relaxed px-3 pt-2.5 pb-1"
              style={{ fontSize: 13, color: '#1d1c1d', minHeight: 36, maxHeight: 72 }}
              rows={1}
            />

            {/* Toolbar */}
            <div
              className="flex items-center justify-between px-2.5 py-1.5"
              style={{ borderTop: '1px solid #eeeeee' }}
            >
              <div className="flex items-center gap-0.5">
                {[Bold, Paperclip, Smile].map((Icon, i) => (
                  <div
                    key={i}
                    className="w-7 h-7 rounded flex items-center justify-center"
                    style={{ color: '#aaaaaa' }}
                  >
                    <Icon className="w-[14px] h-[14px]" strokeWidth={1.8} />
                  </div>
                ))}
              </div>

              <AnimatePresence>
                {draft.trim() ? (
                  <motion.button
                    key="send-active"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 320 }}
                    onClick={sendMessage}
                    className="w-7 h-7 rounded flex items-center justify-center hover:opacity-80 transition-opacity"
                    style={{ background: '#007a5a' }}
                  >
                    <Send className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                  </motion.button>
                ) : (
                  <div key="send-inactive" className="w-7 h-7 rounded flex items-center justify-center" style={{ color: '#cccccc' }}>
                    <Send className="w-3.5 h-3.5" strokeWidth={2} />
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function OnboardingApp() {
  const [step, setStep] = useState<number | null>(null);
  const [platformName, setPlatformName] = useState('macos');

  useEffect(() => {
    if (!ipc?.getPlatform) return;
    ipc.getPlatform().then((name) => setPlatformName(name || 'macos')).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkExistingPermissions() {
      let micOk = false;
      let accOk = false;
      try { if (ipc?.checkMicPermission) micOk = await ipc.checkMicPermission(); } catch { /* ignore */ }
      try { if (ipc?.checkAccessibility) accOk = await ipc.checkAccessibility(); } catch { /* ignore */ }
      // Skip straight to playground if permissions are already granted
      if (!cancelled) setStep(micOk && accOk ? 1 : 0);
    }
    checkExistingPermissions();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => { if (ipc?.dismissOnboarding) ipc.dismissOnboarding(); };
  const hotkeyHint = platformName === 'windows' ? 'Alt' : 'Option';
  const defaultHotkey = getDefaultHotkey(platformName);

  const finish = () => {
    if (ipc?.setHotkey) ipc.setHotkey(defaultHotkey);
    if (ipc?.completeOnboarding) ipc.completeOnboarding();
  };

  const handlePrimary = () => {
    if (step === 0) {
      const btn = document.getElementById('__permissions-next') as HTMLButtonElement | null;
      btn?.click();
      return;
    }
    if (step === 1) finish();
  };

  const primaryLabel = step === 0 ? 'Continue →' : 'Launch Tellaflow 🚀';

  if (step === null) return null;

  return (
    <div
      className="h-screen w-screen overflow-hidden select-none flex flex-col"
      style={{
        borderRadius: 20,
        background: '#f7f7f7',
        color: '#111111',
        // Force this window into light mode regardless of system appearance.
        // colorScheme tells the browser (scrollbars, form controls, etc.) to stay light.
        colorScheme: 'light',
        // Tailwind CSS variable overrides — prevent dark: variants from applying
        '--foreground': '#111111',
        '--card-foreground': '#111111',
        '--popover-foreground': '#111111',
        '--muted-foreground': '#666666',
        '--border': '#e2e2e2',
        '--card': '#ffffff',
        '--muted': '#f2f2f2',
        '--background': '#f7f7f7',
        '--sidebar': '#f7f7f7',
        '--input': '#e2e2e2',
        '--ring': '#bbbbbb',
        '--accent': '#f2f2f2',
        '--accent-foreground': '#111111',
        '--secondary': '#f2f2f2',
        '--secondary-foreground': '#111111',
        '--primary': '#111111',
        '--primary-foreground': '#ffffff',
      } as React.CSSProperties}
    >
      {/* Drag strip */}
      <div
        className="absolute inset-x-0 top-0 h-8 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Close button */}
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-black/8 hover:bg-black/12 flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title="Close"
      >
        <X className="w-3.5 h-3.5" style={{ color: '#555555' }} strokeWidth={2.5} />
      </button>

      {/* Content area */}
      <div
        className="flex-1 flex flex-col px-8 pt-10 pb-2 min-h-0 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <AnimatePresence mode="wait" initial={false}>
          {step === 0 && (
            <WelcomePermissionsStep
              key="step-0"
              onRestart={() => setStep(1)}
              onNext={() => setStep(1)}
              platformName={platformName}
            />
          )}
          {step === 1 && <PlaygroundStep key="step-1" hotkeyHint={hotkeyHint} />}
        </AnimatePresence>
      </div>

      {/* Bottom actions */}
      <div
        className="px-8 pb-7 pt-3 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handlePrimary}
          className="w-full h-11 rounded-xl text-[13px] font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
          style={{ background: '#111111', color: '#ffffff' }}
        >
          {primaryLabel}
        </button>

      </div>
    </div>
  );
}
