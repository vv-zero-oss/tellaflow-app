import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Music, Headphones,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ipc } from '@/lib/ipc';
import type { AudiobookRecord, AudiobookChunk } from '@/lib/ipc';
import { VoicePicker } from './VoicePicker';
import { getVoiceById, voiceAvatarColor, DEFAULT_VOICE_ID } from './voice-data';
import { MusicEngine } from './MusicEngine';

// How many seconds of pre-buffered audio before the player unlocks
const WARMUP_TARGET_SECS = 60;

// ── WAV encoder ──────────────────────────────────────────────────────────────

function float32ToWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bitsPerSample = 16;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, (sampleRate * bitsPerSample) / 8, true);
  view.setUint16(32, bitsPerSample / 8, true); view.setUint16(34, bitsPerSample, true);
  ws(36, 'data'); view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buffer;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  book: AudiobookRecord;
  onBack: () => void;
}

type SynthStatus = 'idle' | 'synthesizing' | 'ready' | 'error';
type WarmupState = 'processing' | 'ready' | 'error';

// ── Component ────────────────────────────────────────────────────────────────

export function AudiobookEditor({ book, onBack }: Props) {
  const [chunks, setChunks] = useState<AudiobookChunk[]>([]);
  const [activeIdx, setActiveIdx] = useState(book.currentChunk ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [synthStatus, setSynthStatus] = useState<SynthStatus>('idle');
  const [synthError, setSynthError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [musicOn, setMusicOn] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [voiceId, setVoiceId] = useState(book.voiceId || DEFAULT_VOICE_ID);

  // ── Warmup / pre-buffer ──────────────────────────────────────────────────
  const [warmup, setWarmup] = useState<WarmupState>('processing');
  const [readySecs, setReadySecs] = useState(0);
  const readySecsRef = useRef(0);
  const warmupDoneRef = useRef(false);
  // Track per-chunk durations so we know total available seconds
  const chunkDurationsRef = useRef<Map<number, number>>(new Map());
  const [isLegacyDecoder, setIsLegacyDecoder] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  // keyed by chunkIndex → object URL
  const audioUrls = useRef<Map<number, string>>(new Map());
  const pendingSynth = useRef<Set<number>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<MusicEngine | null>(null);
  const paragraphRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeIdxRef = useRef(activeIdx);
  activeIdxRef.current = activeIdx;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const voiceIdRef = useRef(voiceId);
  voiceIdRef.current = voiceId;

  // ── Check decoder quality on mount ───────────────────────────────────────
  useEffect(() => {
    ipc.getNeuTTSDecoderInfo().then(info => {
      if (info?.isLegacy) setIsLegacyDecoder(true);
    }).catch(() => {});
  }, []);

  // ── Load chunks then immediately start pre-buffering ────────────────────
  useEffect(() => {
    ipc.getAudiobookChunks(book.id).then(loaded => {
      setChunks(loaded);
      // Find the first non-chapter-header chunk at or after the saved position
      const startIdx = Math.max(0, book.currentChunk ?? 0);
      const firstContent = loaded.findIndex((c, i) => i >= startIdx && !c.isChapterStart);
      const idx = firstContent >= 0 ? firstContent : loaded.findIndex(c => !c.isChapterStart);
      if (idx >= 0) {
        synthesizeChunk(idx, loaded[idx].text);
      } else {
        // Nothing to synthesize (all chapter headers?)
        setWarmup('ready');
        warmupDoneRef.current = true;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // ── Music ───────────────────────────────────────────────────────────────
  useEffect(() => {
    musicRef.current = new MusicEngine();
    return () => musicRef.current?.dispose();
  }, []);

  useEffect(() => {
    if (musicOn) musicRef.current?.start();
    else musicRef.current?.stop();
  }, [musicOn]);

  // ── Audio element events ─────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      const next = activeIdxRef.current + 1;
      if (next < chunks.length) {
        goToChunk(next, true);
      }
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
    };
  }, [chunks.length]);

  // ── Save progress ────────────────────────────────────────────────────────
  useEffect(() => {
    ipc.updateAudiobookProgress(book.id, activeIdx);
  }, [book.id, activeIdx]);

  // ── Auto-scroll active paragraph ─────────────────────────────────────────
  useEffect(() => {
    const el = paragraphRefs.current.get(activeIdx);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIdx]);

  // ── Hide controls bar after inactivity ───────────────────────────────────
  function resetControlsTimer() {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (isPlayingRef.current) setShowControls(false);
    }, 4000);
  }

  // ── Core synth helpers (IPC-based) ────────────────────────────────────────

  async function synthesizeChunk(idx: number, text: string) {
    if (audioUrls.current.has(idx)) return;
    if (pendingSynth.current.has(idx)) return;

    pendingSynth.current.add(idx);
    setSynthStatus('synthesizing');
    console.log(`[AudiobookEditor] synthesizing chunk ${idx} via IPC, voice=${voiceIdRef.current}`);

    try {
      const result = await ipc.synthesizeChunk({ text, voiceName: voiceIdRef.current });
      console.log(`[AudiobookEditor] chunk ${idx} done: sampleRate=${result.sampleRate}, pcmLen=${result.pcmBase64.length}`);

      // Decode base64 PCM → Float32Array → WAV → blob URL
      const pcmBuf = Uint8Array.from(atob(result.pcmBase64), c => c.charCodeAt(0));
      const samples = new Float32Array(pcmBuf.buffer, pcmBuf.byteOffset, pcmBuf.byteLength / 4);
      const secs = samples.length / result.sampleRate;
      const wav = float32ToWav(samples, result.sampleRate);
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      audioUrls.current.set(idx, url);
      chunkDurationsRef.current.set(idx, secs);

      // Accumulate buffered seconds & check warmup gate
      readySecsRef.current += secs;
      setReadySecs(readySecsRef.current);
      console.log(`[AudiobookEditor] chunk ${idx} ready (${secs.toFixed(1)}s, total buffered ${readySecsRef.current.toFixed(1)}s)`);

      // Unlock player once we have ≥ WARMUP_TARGET_SECS or all chunks are done
      if (!warmupDoneRef.current) {
        const nextPlayable = idx + 1;
        const allDone = nextPlayable >= chunksRef.current.length ||
          chunksRef.current.slice(nextPlayable).every(c => c.isChapterStart);
        if (readySecsRef.current >= WARMUP_TARGET_SECS || allDone) {
          warmupDoneRef.current = true;
          setWarmup('ready');
        }
      }

      if (idx === activeIdxRef.current && !isPlayingRef.current && warmupDoneRef.current) {
        playUrl(url);
      }

      setSynthStatus('ready');
      // Continue pre-loading during warmup, then keep one chunk ahead during playback
      schedulePreload(idx + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AudiobookEditor] synthesize chunk ${idx} error:`, msg);
      setSynthError(msg);
      setSynthStatus('error');
      if (!warmupDoneRef.current) {
        warmupDoneRef.current = true;
        setWarmup('error');
      }
    } finally {
      pendingSynth.current.delete(idx);
    }
  }

  // Keep a ref to chunks so synthesizeChunk closures can read the latest value
  const chunksRef = useRef<AudiobookChunk[]>([]);
  chunksRef.current = chunks;

  function schedulePreload(nextIdx: number) {
    if (nextIdx >= chunksRef.current.length) return;
    const chunk = chunksRef.current[nextIdx];
    if (!chunk) return;
    if (chunk.isChapterStart) {
      // Skip chapter headers and continue to the next content chunk
      schedulePreload(nextIdx + 1);
      return;
    }
    setTimeout(() => synthesizeChunk(nextIdx, chunk.text), 100);
  }

  function playUrl(url: string) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = url;
    audio.playbackRate = speedRef.current;
    audio.volume = volumeRef.current;
    audio.play()
      .then(() => { setIsPlaying(true); setSynthStatus('ready'); })
      .catch(err => { setSynthError(err.message); setSynthStatus('error'); });
  }

  const goToChunk = useCallback((idx: number, autoPlay = false) => {
    setActiveIdx(idx);
    activeIdxRef.current = idx;
    const url = audioUrls.current.get(idx);

    if (url) {
      if (autoPlay || isPlayingRef.current) playUrl(url);
      else setIsPlaying(false);
    } else {
      const chunk = chunksRef.current[idx];
      if (chunk && !chunk.isChapterStart) synthesizeChunk(idx, chunk.text);
      if (autoPlay) setIsPlaying(false);
    }
    schedulePreload(idx + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePlayPause() {
    const audio = audioRef.current;
    resetControlsTimer();

    if (isPlaying) {
      audio?.pause();
      setIsPlaying(false);
      return;
    }

    const url = audioUrls.current.get(activeIdx);
    if (url) {
      playUrl(url);
    } else {
      const chunk = chunksRef.current[activeIdx];
      if (chunk && !chunk.isChapterStart) synthesizeChunk(activeIdx, chunk.text);
    }
  }

  function handleWarmupPlay() {
    // Called from the Processing screen once warmup is done
    const url = audioUrls.current.get(activeIdx);
    if (url) playUrl(url);
  }

  const selectedVoice = getVoiceById(voiceId);
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const totalChunks = chunks.length;
  const pct = totalChunks > 0 ? (activeIdx / totalChunks) * 100 : 0;

  // ── Processing / warmup screen ────────────────────────────────────────────
  if (warmup !== 'ready') {
    const progressPct = Math.min((readySecs / WARMUP_TARGET_SECS) * 100, 100);
    const isError = warmup === 'error';

    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-background">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 pt-10 pb-2 shrink-0 [-webkit-app-region:drag]">
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 shrink-0 [-webkit-app-region:no-drag] text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-sm font-medium truncate flex-1 [-webkit-app-region:no-drag] text-muted-foreground">
            {book.title}
          </span>
        </div>

        {/* Dimmed text preview */}
        <div className="flex-1 relative overflow-hidden">
          <div className="absolute inset-0 overflow-hidden pointer-events-none select-none opacity-20">
            <div className="mx-auto max-w-[600px] px-8 py-8 space-y-4">
              {chunks.slice(0, 12).map(c => (
                <p key={c.id} className={cn(
                  'leading-relaxed',
                  c.isChapterStart ? 'text-base font-bold pt-4' : 'text-sm',
                )}>
                  {c.text}
                </p>
              ))}
            </div>
          </div>

          {/* Processing card */}
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="w-full max-w-[340px] bg-background/95 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl p-6 space-y-5"
            >
              {/* Icon + title */}
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                  isError ? 'bg-destructive/10' : 'bg-foreground/[0.06]',
                )}>
                  <Headphones className={cn('w-5 h-5', isError ? 'text-destructive' : 'text-foreground/70')} />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {isError ? 'Processing failed' : 'Preparing audio'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isError
                      ? synthError || 'Something went wrong'
                      : readySecs < 5
                        ? 'Loading AI voice model…'
                        : `${formatTime(readySecs)} of audio ready`
                    }
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              {!isError && (
                <div className="space-y-1.5">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-foreground rounded-full"
                      animate={{ width: `${progressPct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>{formatTime(readySecs)} ready</span>
                    <span>target {formatTime(WARMUP_TARGET_SECS)}</span>
                  </div>
                </div>
              )}

              {/* Pulsing dots while processing */}
              {!isError && (
                <div className="flex items-center gap-1.5 justify-center">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-foreground/30"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
              )}

              {/* Legacy FP32 decoder warning */}
              {!isError && isLegacyDecoder && !upgrading && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2"
                >
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Slow decoder detected
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    You have the full-precision (782 MB) decoder. The optimised INT8 version (312 MB) is 4× faster.
                  </p>
                  <button
                    onClick={async () => {
                      setUpgrading(true);
                      await ipc.upgradeNeuTTSDecoder();
                    }}
                    className="w-full text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-1.5 transition-colors"
                  >
                    Switch to optimised decoder
                  </button>
                </motion.div>
              )}

              {!isError && upgrading && (
                <div className="text-xs text-center text-muted-foreground">
                  Downloading optimised decoder… check Audio Books → Models tab for progress.
                </div>
              )}

              {/* Error: retry or back */}
              {isError && (
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm" className="flex-1"
                    onClick={() => {
                      warmupDoneRef.current = false;
                      readySecsRef.current = 0;
                      setReadySecs(0);
                      setWarmup('processing');
                      setSynthError('');
                      audioUrls.current.clear();
                      pendingSynth.current.clear();
                      const idx = chunksRef.current.findIndex(c => !c.isChapterStart);
                      if (idx >= 0) synthesizeChunk(idx, chunksRef.current[idx].text);
                    }}
                  >
                    Retry
                  </Button>
                  <Button variant="ghost" size="sm" className="flex-1" onClick={onBack}>
                    Go back
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  if (showVoicePicker) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <VoicePicker
          selectedVoiceId={voiceId}
          selectedEngine="neutts"
          availableEngines={['neutts']}
          onSelect={(id) => {
            setVoiceId(id);
            voiceIdRef.current = id;
            audioUrls.current.clear();
            pendingSynth.current.clear();
            setSynthStatus('idle');
            setSynthError('');
          }}
          onClose={() => setShowVoicePicker(false)}
        />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden bg-background select-none"
      onMouseMove={resetControlsTimer}
      onClick={resetControlsTimer}
    >
      {/* ── Slim top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 pt-10 pb-2 shrink-0 [-webkit-app-region:drag]">
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 shrink-0 [-webkit-app-region:no-drag] text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </Button>

        <div className="flex-1 h-[3px] rounded-full bg-muted overflow-hidden [-webkit-app-region:no-drag]">
          <motion.div
            className="h-full bg-foreground/30 rounded-full"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <span className="text-[10px] text-muted-foreground [-webkit-app-region:no-drag] tabular-nums">
          {activeIdx + 1} / {totalChunks}
        </span>
      </div>

      {/* ── Reading area ─────────────────────────────────────────────── */}
      <ScrollArea className="flex-1 [-webkit-app-region:no-drag]">
        <div className="mx-auto max-w-[600px] px-8 py-8 pb-28 space-y-0">
          {chunks.map((chunk, idx) => {
            const isActive = idx === activeIdx;

            if (chunk.isChapterStart) {
              return (
                <div
                  key={chunk.id}
                  ref={el => { if (el) paragraphRefs.current.set(idx, el); else paragraphRefs.current.delete(idx); }}
                  onClick={() => goToChunk(idx)}
                  className={cn(
                    'cursor-pointer pt-10 pb-3 border-t border-border/30 first:border-0 first:pt-4',
                    isActive ? 'text-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground',
                  )}
                >
                  <h3 className="text-base font-bold tracking-tight">
                    {chunk.chapterTitle || chunk.text}
                  </h3>
                </div>
              );
            }

            return (
              <div
                key={chunk.id}
                ref={el => { if (el) paragraphRefs.current.set(idx, el); else paragraphRefs.current.delete(idx); }}
                onClick={() => goToChunk(idx)}
                className={cn(
                  'cursor-pointer py-1 px-3 -mx-3 rounded-lg transition-all duration-300',
                  isActive
                    ? 'text-foreground bg-foreground/[0.04]'
                    : 'text-muted-foreground/40 hover:text-muted-foreground/70',
                )}
              >
                <p className={cn(
                  'leading-[1.9] transition-all duration-300',
                  isActive ? 'text-[15px]' : 'text-[14px]',
                )}>
                  {chunk.text}
                </p>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* ── Floating player bar ───────────────────────────────────────── */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            key="player"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 w-full max-w-[520px] px-5"
          >
            <div className="bg-background/90 backdrop-blur-xl border border-border/60 rounded-2xl shadow-2xl px-4 py-3 space-y-2.5">

              {/* Status line */}
              {synthStatus === 'error' && (
                <p className="text-xs text-destructive text-center pb-0.5 truncate">{synthError}</p>
              )}

              {/* Seek bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right shrink-0">
                  {formatTime(currentTime)}
                </span>
                <Slider
                  value={[currentTime]}
                  max={duration || 1}
                  step={0.1}
                  onValueChange={([v]) => {
                    if (audioRef.current) { audioRef.current.currentTime = v; setCurrentTime(v); }
                  }}
                  className="flex-1"
                />
                <span className="text-[10px] text-muted-foreground tabular-nums w-7 shrink-0">
                  {formatTime(duration)}
                </span>
              </div>

              {/* Controls row */}
              <div className="flex items-center justify-between">

                {/* Left: voice + music */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowVoicePicker(true)}
                    className={cn(
                      'w-6 h-6 rounded-full bg-gradient-to-br shrink-0 transition-opacity hover:opacity-70',
                      voiceAvatarColor(selectedVoice?.name ?? 'V'),
                    )}
                    title={selectedVoice?.name ?? 'Select voice'}
                  />
                  <button
                    onClick={() => setMusicOn(m => !m)}
                    className={cn(
                      'p-1 rounded-md transition-colors',
                      musicOn ? 'text-foreground' : 'text-muted-foreground/40 hover:text-muted-foreground',
                    )}
                    title="Ambient music"
                  >
                    <Music className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Center: skip / play / skip */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => activeIdx > 0 && goToChunk(activeIdx - 1, isPlaying)}
                    disabled={activeIdx === 0}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    onClick={handlePlayPause}
                    className={cn(
                      'w-9 h-9 rounded-full flex items-center justify-center transition-colors',
                      'bg-foreground text-background hover:opacity-80',
                    )}
                  >
                    {isPlaying
                      ? <Pause className="w-4 h-4" />
                      : <Play className="w-4 h-4 ml-0.5" />
                    }
                  </button>

                  <button
                    onClick={() => activeIdx < totalChunks - 1 && goToChunk(activeIdx + 1, isPlaying)}
                    disabled={activeIdx >= totalChunks - 1}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Right: speed + volume */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                      setSpeed(next);
                      if (audioRef.current) audioRef.current.playbackRate = next;
                    }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground w-8 text-center transition-colors"
                  >
                    {speed}×
                  </button>

                  <button
                    onClick={() => {
                      const next = volume === 0 ? 1 : 0;
                      setVolume(next);
                      if (audioRef.current) audioRef.current.volume = next;
                    }}
                    className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    {volume === 0
                      ? <VolumeX className="w-3.5 h-3.5" />
                      : <Volume2 className="w-3.5 h-3.5" />
                    }
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio ref={audioRef} />
    </div>
  );
}
