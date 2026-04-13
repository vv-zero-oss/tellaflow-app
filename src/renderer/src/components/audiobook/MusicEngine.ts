/**
 * Procedural ambient music engine using Tone.js (Web Audio API).
 * Generates non-intrusive drone + gentle percussion behind narration.
 */
export class MusicEngine {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private lfoNodes: OscillatorNode[] = [];
  private isStarted = false;

  private masterGain = 0.08; // Keep it subtle behind voice

  constructor() {}

  async start() {
    if (this.isStarted) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0;
    this.gainNode.connect(this.ctx.destination);

    this.buildDroneLayer();
    this.buildPadLayer();

    // Fade in
    this.gainNode.gain.linearRampToValueAtTime(this.masterGain, this.ctx.currentTime + 3);
    this.isStarted = true;
  }

  stop() {
    if (!this.ctx || !this.gainNode) return;
    const endTime = this.ctx.currentTime + 2;
    this.gainNode.gain.linearRampToValueAtTime(0, endTime);
    setTimeout(() => this.cleanup(), 2500);
  }

  dispose() {
    this.cleanup();
  }

  setMood(mood: 'calm' | 'tense' | 'warm' | 'epic') {
    // Future: re-tune oscillators based on LLM-extracted mood tags
    if (!this.ctx || !this.gainNode) return;
    const g = mood === 'epic' ? 0.14 : mood === 'tense' ? 0.1 : 0.08;
    this.gainNode.gain.linearRampToValueAtTime(g, this.ctx.currentTime + 1.5);
  }

  private buildDroneLayer() {
    if (!this.ctx || !this.gainNode) return;

    // Root drone — D2 (73.4 Hz) with slight detuning for warmth
    const frequencies = [73.4, 73.4 * 1.5, 73.4 * 2, 73.4 * 3]; // root + fifth + octaves
    const detunes = [0, 4, -3, 6];
    const gains = [0.6, 0.3, 0.25, 0.15];

    frequencies.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const oscGain = this.ctx!.createGain();
      const lfo = this.ctx!.createOscillator();
      const lfoGain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detunes[i];

      // Slow vibrato LFO
      lfo.type = 'sine';
      lfo.frequency.value = 0.15 + i * 0.04;
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);

      oscGain.gain.value = gains[i];
      osc.connect(oscGain);
      oscGain.connect(this.gainNode!);

      osc.start();
      lfo.start();

      this.oscillators.push(osc);
      this.lfoNodes.push(lfo);
    });
  }

  private buildPadLayer() {
    if (!this.ctx || !this.gainNode) return;

    // High pad — A4 (440 Hz), very quiet & filtered
    const padOsc = this.ctx.createOscillator();
    const padGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    padOsc.type = 'triangle';
    padOsc.frequency.value = 220;
    padGain.gain.value = 0.12;

    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 1.2;

    // Slow tremolo
    const tremolo = this.ctx.createOscillator();
    const tremoloGain = this.ctx.createGain();
    tremolo.type = 'sine';
    tremolo.frequency.value = 0.08;
    tremoloGain.gain.value = 0.06;
    tremolo.connect(tremoloGain);
    tremoloGain.connect(padGain.gain);

    padOsc.connect(filter);
    filter.connect(padGain);
    padGain.connect(this.gainNode);

    padOsc.start();
    tremolo.start();

    this.oscillators.push(padOsc, tremolo);
  }

  private cleanup() {
    this.oscillators.forEach(osc => { try { osc.stop(); } catch (_) {} });
    this.lfoNodes.forEach(lfo => { try { lfo.stop(); } catch (_) {} });
    this.oscillators = [];
    this.lfoNodes = [];
    try { this.ctx?.close(); } catch (_) {}
    this.ctx = null;
    this.gainNode = null;
    this.isStarted = false;
  }
}
