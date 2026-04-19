const MUTE_KEY = 'tellaflow-practice-sfx-muted';

export function isPracticeSfxMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPracticeSfxMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    /* ignore */
  }
}

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (isPracticeSfxMuted()) return null;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(freq: number, duration: number, type: OscillatorType, gain = 0.08) {
  const ac = ctx();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  o.connect(g);
  g.connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + duration + 0.02);
}

export function playPracticeRoundTick() {
  beep(660, 0.05, 'sine', 0.04);
}

export function playPracticePass() {
  beep(880, 0.08, 'sine', 0.07);
  setTimeout(() => beep(1174, 0.12, 'sine', 0.06), 70);
}

export function playPracticeFail() {
  beep(220, 0.14, 'triangle', 0.07);
}
