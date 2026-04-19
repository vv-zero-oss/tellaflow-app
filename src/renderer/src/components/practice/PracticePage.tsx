import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Layers, Mic, RotateCcw, Square, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UsageCard } from '@/components/ui/usage-card';
import { usePracticeSession } from '@/hooks/use-practice-session';
import { useConfig } from '@/hooks/use-config';
import { usePermissions } from '@/hooks/use-permissions';
import { useStatus } from '@/hooks/use-status';
import { PracticePixiStage } from '@/components/practice/PracticePixiStage';
import {
  PracticeNotoEmoji,
  practiceFailNotoId,
  practicePassNotoId,
} from '@/components/practice/practice-noto-emoji';
import type { PracticeDeck, PracticeDeckRound } from '@/components/practice/practice-types';
import { playPracticeRoundTick } from '@/components/practice/practice-sfx';
import { cn } from '@/lib/utils';

import defaultDeck from '@/components/practice/decks/default-echo.json';

const deck = defaultDeck as PracticeDeck;

const isDev = typeof import.meta !== 'undefined' && import.meta.env.DEV;

function statusLabel(s: string) {
  switch (s) {
    case 'idle':
      return 'Ready';
    case 'listening':
      return 'Listening…';
    case 'transcribing':
      return 'Transcribing…';
    case 'scored':
      return 'Result';
    default:
      return s;
  }
}

function TinderCardPeek({ round, depth }: { round: PracticeDeckRound; depth: number }) {
  const inset = 6 + depth * 8;
  return (
    <div
      className="pointer-events-none absolute overflow-hidden rounded-[20px] border border-border/50 bg-muted/35 shadow-sm select-none"
      style={{
        top: 4 + depth * 9,
        left: inset,
        right: inset,
        height: 88,
        zIndex: 5 - depth,
        transform: `scale(${0.94 - depth * 0.028})`,
        opacity: 0.36 + (2 - depth) * 0.18,
      }}
    >
      <div className="flex h-full items-center justify-center px-4 py-2">
        <p className="line-clamp-2 text-center text-[11px] font-medium leading-snug text-muted-foreground">{round.target}</p>
      </div>
    </div>
  );
}

type Mood = { id: string; alt: string; title: string; subtitle: string };

function practiceMood(
  roundState: string,
  roundIndex: number,
  lastScore: { pass: boolean } | null | undefined,
): Mood {
  if (roundState === 'scored') {
    if (lastScore?.pass) {
      const id = practicePassNotoId(roundIndex);
      return { id, alt: 'Nice echo', title: 'Round complete', subtitle: 'You nailed it' };
    }
    if (lastScore && !lastScore.pass) {
      const id = practiceFailNotoId(roundIndex);
      return { id, alt: 'Keep practicing', title: 'Almost', subtitle: 'Try once more' };
    }
    return { id: '1f916', alt: '🤖', title: 'Scoring', subtitle: 'One moment…' };
  }
  if (roundState === 'listening') {
    return { id: '1f644', alt: '🙄', title: 'Listening', subtitle: 'Speak clearly, then release' };
  }
  if (roundState === 'transcribing') {
    return { id: '1f916', alt: '🤖', title: 'Transcribing', subtitle: 'Turning audio into text' };
  }
  return { id: '1f3c1', alt: '🏁', title: 'Your turn', subtitle: 'Hold hotkey or tap Speak' };
}

export function PracticePage() {
  const reduceMotion = useReducedMotion() ?? false;
  const { config } = useConfig();
  const { mic, accessibility } = usePermissions();
  const { status } = useStatus();
  const session = usePracticeSession(deck);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);

  const focusTranscript = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  useEffect(() => {
    playPracticeRoundTick();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' && session.phase === 'playing') {
        e.preventDefault();
        if (session.roundState === 'idle') session.startSpeak();
        else if (session.roundState === 'listening') session.stopSpeak();
      }
    };
    // Capture so Space never inserts into the focused transcript field.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [session]);

  useLayoutEffect(() => {
    if (session.phase !== 'playing') return;
    const id = requestAnimationFrame(() => {
      focusTranscript();
    });
    return () => cancelAnimationFrame(id);
  }, [session.phase, session.roundIndex, session.roundState, session.lastTranscript, focusTranscript]);

  const progressPct =
    session.phase === 'summary'
      ? 100
      : Math.round((session.completedRounds / Math.max(1, session.totalRounds)) * 100);

  const pillCount = Math.min(Math.max(session.totalRounds, 8), 14);

  const mood = useMemo(
    () => practiceMood(session.roundState, session.roundIndex, session.lastScore ?? undefined),
    [session.roundState, session.roundIndex, session.lastScore],
  );

  if (session.phase === 'summary') {
    const avg = session.totalRounds ? Math.round(session.sessionScoreSum / session.totalRounds) : 0;
    return (
      <div
        data-practice-root
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background [-webkit-app-region:drag]"
      >
        <header className="shrink-0 border-b border-border/50 px-4 pb-3 pt-[50px] [-webkit-app-region:no-drag]">
          <div className="mx-auto flex max-w-lg items-start gap-3">
            <PracticeNotoEmoji id="1f973" alt="Party" size={48} />
            <div className="min-w-0 flex-1 pt-0.5">
              <h1 className="text-[16px] font-black tracking-tight text-foreground">Session complete</h1>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Echo Ladder — {deck.title}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mt-0.5 h-9 w-9 shrink-0 rounded-full"
              aria-label="Reset practice and start over"
              title="Reset"
              onClick={session.restartSession}
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
            </Button>
          </div>
        </header>
        <div className="shrink-0 px-4 pt-3 [-webkit-app-region:no-drag]">
          <div className="mx-auto max-w-lg">
            <UsageCard
              title="Session"
              percentage={100}
              pillCount={pillCount}
              accentColor="#f97316"
              icon={<Layers className="h-3.5 w-3.5 shrink-0 opacity-70" />}
            />
          </div>
        </div>
        <ScrollArea className="min-h-0 min-w-0 flex-1 [-webkit-app-region:no-drag]">
          <div className="mx-auto max-w-lg space-y-3 px-4 py-4 pb-10">
            <div className="rounded-2xl bg-card p-6 shadow-xxl select-none" style={{ boxShadow: 'var(--card-shadow)' }}>
              <div className="text-center">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Average accuracy</p>
                <p className="mt-1 text-[36px] font-black leading-none tabular-nums" style={{ color: '#22c55e' }}>
                  {avg}%
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <div className="rounded-2xl bg-muted/40 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Best streak</p>
                  <p className="mt-0.5 text-[22px] font-black tabular-nums text-foreground">{session.bestStreak}</p>
                </div>
                <div className="rounded-2xl bg-muted/40 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Rounds</p>
                  <p className="mt-0.5 text-[22px] font-black tabular-nums text-foreground">{session.totalRounds}</p>
                </div>
              </div>
            </div>
            <Button
              type="button"
              className="h-12 w-full rounded-full text-[13px] font-bold shadow-xxl"
              style={{ background: '#EDFF47', color: 'rgba(0,0,0,0.85)' }}
              onClick={session.restartSession}
            >
              Play again
            </Button>
          </div>
        </ScrollArea>
      </div>
    );
  }

  const round = session.round;
  if (!round) return null;

  const peekDepths = [2, 1] as const;
  const showScored = session.roundState === 'scored' && session.lastScore;

  return (
    <div
      data-practice-root
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background [-webkit-app-region:drag]"
    >
      {/* Top: title + progress — fixed height band */}
      <header className="shrink-0 border-b border-border/40 bg-background/95 px-4 pb-2 pt-[48px] backdrop-blur-sm [-webkit-app-region:no-drag]">
        <div className="mx-auto flex max-w-lg items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-black tracking-tight text-foreground">Practice</h1>
            <p className="truncate text-[11px] text-muted-foreground">{deck.title}</p>
          </div>
          <span className="mt-0.5 shrink-0 rounded-full border border-border/80 bg-muted/50 px-2.5 py-1 text-[11px] font-bold tabular-nums text-foreground">
            {session.roundIndex + 1}/{session.totalRounds}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full"
              aria-label="Reset practice session"
              title="Reset session"
              onClick={session.restartSession}
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full"
              aria-label={session.sfxMuted ? 'Unmute practice sounds' : 'Mute practice sounds'}
              onClick={session.toggleSfxMute}
            >
              {session.sfxMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="mx-auto mt-2 max-w-lg">
          <UsageCard
            title="Session"
            percentage={progressPct}
            pillCount={pillCount}
            accentColor="#f97316"
            icon={<Layers className="h-3.5 w-3.5 shrink-0 opacity-70" />}
          />
        </div>
      </header>

      {/* Main card — fills remaining space */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-3 [-webkit-app-region:no-drag]">
        <div className="relative mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
          <div className="relative min-h-0 flex-1 pt-10">
            {peekDepths.map((depth) => {
              const idx = session.roundIndex + depth;
              if (idx >= deck.rounds.length) return null;
              const r = deck.rounds[idx];
              return <TinderCardPeek key={r.id} round={r} depth={depth} />;
            })}

            <motion.div
              key={session.roundIndex}
              initial={reduceMotion ? false : { scale: 0.98, y: 8, opacity: 0 }}
              animate={reduceMotion ? false : { scale: 1, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card shadow-xl [transform:translateZ(0)]"
              style={{ boxShadow: '0 20px 40px -16px oklch(0 0 0 / 14%), var(--card-shadow)' }}
            >
              <div className="flex shrink-0 items-center gap-3 overflow-hidden rounded-t-2xl bg-muted/25 px-4 py-2.5">
                <PracticeNotoEmoji id={mood.id} alt={mood.alt} size={44} />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{mood.title}</p>
                  <p className="truncate text-[12px] font-semibold text-foreground">{mood.subtitle}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{statusLabel(session.roundState)}</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-card px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Say this</p>
                <p className="mt-1.5 text-xl font-black leading-snug tracking-tight text-foreground sm:text-2xl">{round.target}</p>
                {round.hint ? <p className="mt-2 text-[11px] font-medium text-muted-foreground">{round.hint}</p> : null}

                <div className="mt-4 overflow-hidden rounded-xl bg-muted/30 shadow-inner">
                  <PracticePixiStage
                    audioLevel={session.roundState === 'listening' ? session.audioLevel : 0}
                    burst={session.burst}
                    reduceMotion={reduceMotion}
                    heightClass="h-[88px]"
                  />
                </div>

                <div className="mt-4">
                  <label htmlFor="practice-transcript" className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Your transcript
                  </label>
                  <textarea
                    id="practice-transcript"
                    ref={transcriptRef}
                    readOnly
                    rows={4}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    aria-live="polite"
                    aria-label="Transcript from your recording; compare with the phrase above"
                    value={session.lastTranscript}
                    placeholder={
                      session.roundState === 'listening'
                        ? 'Listening… your words will appear here after Stop.'
                        : session.roundState === 'transcribing'
                          ? 'Transcribing…'
                          : session.roundState === 'scored'
                            ? ''
                            : 'Tap Speak, then Stop — your transcript appears here for comparison.'
                    }
                    className={cn(
                      'mt-1.5 w-full resize-none rounded-xl border border-border/50 bg-background/80 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground shadow-inner outline-none ring-offset-background transition-[box-shadow,ring]',
                      'placeholder:font-sans placeholder:text-[13px] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
                      session.roundState === 'scored' && session.lastScore?.pass && 'border-[#22c55e]/45',
                      session.roundState === 'scored' && session.lastScore && !session.lastScore.pass && 'border-[#f97316]/50',
                    )}
                  />
                </div>

                {showScored && (
                  <div
                    className={cn(
                      'mt-4 select-none rounded-xl border-2 bg-muted/25 p-3',
                      session.lastScore!.pass ? 'border-[#22c55e]/60' : 'border-[#f97316]/75',
                    )}
                  >
                    <p className="text-[13px] font-black text-foreground">
                      {session.lastScore!.pass ? 'Nice echo!' : 'Keep practicing'}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                      Accuracy: {Math.round(session.lastScore!.wordAccuracy * 100)}% · WER {session.lastScore!.wer.toFixed(2)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {session.lastScore!.refTokens.map((t, i) => (
                        <span
                          key={`${t}-${i}`}
                          className={cn(
                            'rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                            session.lastScore!.matchedRefIndices.has(i)
                              ? 'bg-[#22c55e]/20 text-foreground'
                              : 'bg-destructive/15 text-destructive line-through',
                          )}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 overflow-hidden rounded-b-2xl bg-muted/35 px-4 py-3">
                {showScored ? (
                  <Button
                    type="button"
                    className="h-11 w-full rounded-full text-[13px] font-bold shadow-xxl"
                    style={
                      session.lastScore!.pass
                        ? { background: '#22c55e', color: '#fff' }
                        : { background: '#EDFF47', color: 'rgba(0,0,0,0.85)' }
                    }
                    onClick={session.nextRound}
                  >
                    {session.roundIndex >= session.totalRounds - 1 ? 'See results' : 'Next round'}
                  </Button>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="lg"
                      disabled={session.roundState !== 'idle' || !mic}
                      className={cn(
                        'h-11 min-w-[8.5rem] flex-1 rounded-full text-[13px] font-bold shadow-xxl sm:flex-none',
                        session.roundState === 'idle' && 'hover:opacity-95',
                      )}
                      style={
                        session.roundState === 'idle'
                          ? { background: '#EDFF47', color: 'rgba(0,0,0,0.85)' }
                          : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
                      }
                      onClick={session.startSpeak}
                    >
                      <Mic className="mr-2 h-5 w-5" />
                      Speak
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      variant="secondary"
                      disabled={session.roundState !== 'listening'}
                      className="h-11 min-w-[7.5rem] flex-1 rounded-full text-[13px] font-bold shadow-xxl sm:flex-none"
                      onClick={session.stopSpeak}
                    >
                      <Square className="mr-2 h-4 w-4" />
                      Stop
                    </Button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </main>

      <footer className="shrink-0 space-y-2 border-t border-border/50 bg-muted/15 px-4 py-2.5 [-webkit-app-region:no-drag]">
        <div className="mx-auto max-w-lg space-y-1.5">
          <p className="line-clamp-2 text-center text-[10px] font-medium leading-snug text-muted-foreground">
            <span className="text-foreground/80">Hotkey</span> {config.hotkey?.label ?? 'Configure in Settings'} ·{' '}
            <span className="text-foreground/80">Space</span> start/stop when this page is focused
          </p>
          {(!mic || !accessibility) && (
            <p className="text-center text-[10px] text-amber-600 dark:text-amber-400">
              {!mic ? 'Microphone permission needed. ' : ''}
              {!accessibility ? 'Accessibility needed for dictation.' : ''}
            </p>
          )}
          {isDev && (
            <details className="rounded-lg border border-amber-500/35 bg-amber-500/[0.07] text-[10px] text-amber-950 dark:text-amber-100">
              <summary className="cursor-pointer select-none px-2 py-1.5 font-bold uppercase tracking-wide">
                Dev · jump round
              </summary>
              <div className="flex items-center justify-center gap-2 border-t border-amber-500/20 px-2 py-2">
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 rounded-full"
                  aria-label="Previous round"
                  onClick={() => session.devGoToRound(session.roundIndex - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[3.5rem] text-center font-mono text-[11px] font-semibold tabular-nums">
                  {session.roundIndex + 1}/{session.totalRounds}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="h-8 w-8 rounded-full"
                  aria-label="Next round"
                  onClick={() => session.devGoToRound(session.roundIndex + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </details>
          )}
          <p className="text-center text-[9px] text-muted-foreground/80">Status: {status}</p>
        </div>
      </footer>
    </div>
  );
}
