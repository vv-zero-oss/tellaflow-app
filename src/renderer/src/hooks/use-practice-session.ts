import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { scoreEchoRound } from '@/lib/practice-scoring';
import type { PracticeDeck, PracticeDeckRound } from '@/components/practice/practice-types';
import {
  playPracticeFail,
  playPracticePass,
  playPracticeRoundTick,
  setPracticeSfxMuted,
} from '@/components/practice/practice-sfx';

export type PracticeRoundState = 'idle' | 'listening' | 'transcribing' | 'scored';

type SessionPhase = 'playing' | 'summary';

export function usePracticeSession(deck: PracticeDeck) {
  const [phase, setPhase] = useState<SessionPhase>('playing');
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundState, setRoundState] = useState<PracticeRoundState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastScore, setLastScore] = useState<ReturnType<typeof scoreEchoRound> | null>(null);
  const [sessionScoreSum, setSessionScoreSum] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [burst, setBurst] = useState<'none' | 'pass' | 'fail'>('none');
  const [sfxMuted, setSfxMuted] = useState(() => {
    try {
      return localStorage.getItem('tellaflow-practice-sfx-muted') === '1';
    } catch {
      return false;
    }
  });
  /** Rounds finished with a score — drives session progress (not round index / Speak). */
  const [completedRounds, setCompletedRounds] = useState(0);

  const round: PracticeDeckRound | undefined = deck.rounds[roundIndex];
  const onTextRef = useRef<(text: string) => void>(() => {});
  const roundStateRef = useRef(roundState);
  const roundIndexRef = useRef(roundIndex);
  roundIndexRef.current = roundIndex;
  /** Keep in sync every render; also set synchronously before IPC that can emit practice-text before the next paint. */
  roundStateRef.current = roundState;

  useLayoutEffect(() => {
    if (!ipc?.setPracticeMode) return;
    ipc.setPracticeMode(true);
    return () => {
      ipc.setPracticeMode(false);
    };
  }, []);

  useEffect(() => {
    if (!ipc?.onPracticeText) return;
    const handler = (text: string) => {
      onTextRef.current(text);
    };
    const dispose = ipc.onPracticeText(handler);
    return () => {
      dispose();
    };
  }, []);

  useEffect(() => {
    onTextRef.current = (text: string) => {
      if (roundStateRef.current !== 'transcribing') return;
      const i = roundIndexRef.current;
      const r = deck.rounds[i];
      if (!r) return;
      setLastTranscript(text);
      const threshold = r.passThreshold ?? 0.85;
      const scored = scoreEchoRound(r.target, text, threshold);
      setLastScore(scored);
      setRoundState('scored');
      setCompletedRounds(i + 1);
      setSessionScoreSum((s) => s + Math.round(scored.wordAccuracy * 100));
      if (scored.pass) {
        setStreak((k) => {
          const n = k + 1;
          setBestStreak((b) => Math.max(b, n));
          return n;
        });
        setBurst('pass');
        playPracticePass();
      } else {
        setStreak(0);
        setBurst('fail');
        playPracticeFail();
      }
      setTimeout(() => setBurst('none'), 400);
      roundStateRef.current = 'scored';
    };
  }, [deck.rounds]);

  useEffect(() => {
    if (roundState !== 'listening' || !ipc?.onPracticeAudioLevel) return;
    const off = ipc.onPracticeAudioLevel((level) => {
      setAudioLevel(typeof level === 'number' ? level : 0);
    });
    return () => {
      off?.();
    };
  }, [roundState]);

  const startSpeak = useCallback(() => {
    if (roundState !== 'idle' || !round) return;
    // Main must route ASR to practice-text before capture finishes (useEffect is too late).
    if (ipc?.setPracticeMode) ipc.setPracticeMode(true);
    setRoundState('listening');
    roundStateRef.current = 'listening';
    setAudioLevel(0);
    ipc.clickStartRecording();
  }, [round, roundState]);

  const stopSpeak = useCallback(() => {
    if (roundState !== 'listening') return;
    if (ipc?.setPracticeMode) ipc.setPracticeMode(true);
    setRoundState('transcribing');
    roundStateRef.current = 'transcribing';
    setAudioLevel(0);
    ipc.clickFinishRecording();
  }, [roundState]);

  const nextRound = useCallback(() => {
    if (roundState !== 'scored') return;
    if (roundIndex >= deck.rounds.length - 1) {
      setPhase('summary');
      roundStateRef.current = 'idle';
      return;
    }
    setRoundIndex((i) => i + 1);
    setRoundState('idle');
    roundStateRef.current = 'idle';
    setLastTranscript('');
    setLastScore(null);
    playPracticeRoundTick();
  }, [deck.rounds.length, roundIndex, roundState]);

  const restartSession = useCallback(() => {
    if (roundStateRef.current === 'listening' || roundStateRef.current === 'transcribing') {
      ipc.clickCancelRecording();
    }
    setPhase('playing');
    setRoundIndex(0);
    setRoundState('idle');
    roundStateRef.current = 'idle';
    setCompletedRounds(0);
    setLastTranscript('');
    setLastScore(null);
    setSessionScoreSum(0);
    setStreak(0);
    setBestStreak(0);
    setAudioLevel(0);
    setBurst('none');
    playPracticeRoundTick();
  }, []);

  /** Dev / QA only: jump to a round index without speaking (import.meta.env.DEV). */
  const devGoToRound = useCallback(
    (index: number) => {
      if (typeof import.meta !== 'undefined' && !import.meta.env.DEV) return;
      const i = Math.max(0, Math.min(deck.rounds.length - 1, Math.floor(index)));
      setPhase('playing');
      setRoundIndex(i);
      setRoundState('idle');
      roundStateRef.current = 'idle';
      setCompletedRounds(i);
      setLastTranscript('');
      setLastScore(null);
      setAudioLevel(0);
      setBurst('none');
      playPracticeRoundTick();
    },
    [deck.rounds.length],
  );

  const toggleSfxMute = useCallback(() => {
    setSfxMuted((m) => {
      const next = !m;
      setPracticeSfxMuted(next);
      return next;
    });
  }, []);

  return {
    phase,
    round,
    roundIndex,
    completedRounds,
    totalRounds: deck.rounds.length,
    roundState,
    lastTranscript,
    lastScore,
    sessionScoreSum,
    streak,
    bestStreak,
    audioLevel,
    burst,
    sfxMuted,
    startSpeak,
    stopSpeak,
    nextRound,
    restartSession,
    devGoToRound,
    toggleSfxMute,
  };
}
