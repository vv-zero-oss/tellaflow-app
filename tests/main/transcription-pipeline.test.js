import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPipeline, splitForTranscription } from '../../src/main/transcription-pipeline.js';
import { createJobJournal } from '../../src/main/job-journal.js';
import { decodeWavToPcm } from '../../src/main/audio-utils.js';

const quiet = { log() {}, warn() {}, error() {} };

function tone(seconds, amp = 0.3) {
  const n = Math.round(seconds * 16000);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin(i / 7);
  return a;
}

describe('splitForTranscription', () => {
  it('keeps short clips whole', () => {
    const p = tone(40);
    expect(splitForTranscription(p)).toHaveLength(1);
  });

  it('splits long clips into ~30 s pieces that cover every sample', () => {
    const p = tone(185);
    const pieces = splitForTranscription(p);
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    expect(pieces.reduce((s, x) => s + x.length, 0)).toBe(p.length);
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.length / 16000).toBeGreaterThan(27);
      expect(piece.length / 16000).toBeLessThan(33);
    }
  });

  it('moves the cut into a nearby silence', () => {
    const p = tone(70);
    // silence from 30.5 s to 31 s
    p.fill(0, Math.round(30.5 * 16000), 31 * 16000);
    const [first] = splitForTranscription(p);
    const cutSec = first.length / 16000;
    expect(cutSec).toBeGreaterThanOrEqual(30.5);
    expect(cutSec).toBeLessThanOrEqual(31);
  });
});

describe('transcription pipeline', () => {
  let dir;
  let journal;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-pipe-'));
    journal = createJobJournal(path.join(dir, 'jobs'));
  });

  function make(service, extra = {}) {
    return createPipeline({ service, journal, recordingsDir: path.join(dir, 'rec'), log: quiet, ...extra });
  }

  it('saves audio + journal entry before transcribing', () => {
    const p = make({ transcribe: async () => 'never' });
    const job = p.saveRecording(tone(2));
    expect(fs.existsSync(job.audioPath)).toBe(true);
    expect(decodeWavToPcm(job.audioPath).length).toBe(32000);
    expect(journal.get(job.id)).toMatchObject({ status: 'pending', durationSec: 2 });
  });

  it('runs a job: transcribe → post-process → finish', async () => {
    const p = make(
      { transcribe: async (pcm) => `heard ${pcm.length}` },
      { postProcess: async (t) => t.toUpperCase() },
    );
    const job = p.saveRecording(tone(1));
    const res = await p.runJob(job.id, { pcm: tone(1) });
    expect(res.text).toBe('HEARD 16000');
    p.finishJob(job.id);
    expect(journal.get(job.id)).toBeNull();
    expect(fs.existsSync(job.audioPath)).toBe(true); // history owns it now
  });

  it('a failed transcription keeps the audio as a failed job, and a retry recovers it', async () => {
    let broken = true;
    const service = { transcribe: async () => { if (broken) throw new Error('Transcription engine crashed'); return 'second time lucky'; } };
    const p = make(service);
    const job = p.saveRecording(tone(1.5));
    await expect(p.runJob(job.id, { pcm: tone(1.5) })).rejects.toThrow(/crashed/);
    expect(journal.get(job.id)).toMatchObject({ status: 'failed', error: 'Transcription engine crashed', attempts: 1 });
    expect(fs.existsSync(job.audioPath)).toBe(true);

    // "App restarts" — new journal/pipeline on the same dirs, retry reads the WAV.
    broken = false;
    const journal2 = createJobJournal(path.join(dir, 'jobs'));
    const p2 = createPipeline({ service, journal: journal2, recordingsDir: path.join(dir, 'rec'), log: quiet });
    const res = await p2.runJob(job.id);
    expect(res.text).toBe('second time lucky');
    expect(journal2.get(job.id).attempts).toBe(2);
  });

  it('uses precomputed raw text from streaming sessions without re-transcribing', async () => {
    let calls = 0;
    const p = make({ transcribe: async () => { calls++; return 'x'; } });
    const job = p.saveRecording(tone(1));
    const res = await p.runJob(job.id, { rawText: 'already done' });
    expect(res.text).toBe('already done');
    expect(calls).toBe(0);
  });

  it('transcribes long recordings window by window', async () => {
    const sizes = [];
    const p = make({ transcribe: async (pcm) => { sizes.push(pcm.length); return `w${sizes.length}`; } });
    const text = await p.transcribePcm(tone(150));
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...sizes) / 16000).toBeLessThan(33);
    expect(text.startsWith('w1 w2 w3')).toBe(true);
  });

  it('finishJob with keepAudio=false deletes the WAV (silence / playground)', async () => {
    const p = make({ transcribe: async () => '' });
    const job = p.saveRecording(tone(1));
    const res = await p.runJob(job.id, { pcm: tone(1) });
    expect(res.text).toBe('');
    p.finishJob(job.id, { keepAudio: false });
    expect(fs.existsSync(job.audioPath)).toBe(false);
  });
});
