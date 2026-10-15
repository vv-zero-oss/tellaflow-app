import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMeetingNotes, renderMeetingText } from '../../src/main/meeting-notes.js';
import { createPipeline } from '../../src/main/transcription-pipeline.js';
import { createJobJournal } from '../../src/main/job-journal.js';
import { decodeWavToPcm } from '../../src/main/audio-utils.js';

const quiet = { log() {}, warn() {}, error() {} };

function speech(seconds, amp = 0.2) {
  const a = new Float32Array(Math.round(seconds * 16000));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(i / 5);
  return a;
}

function fakeHistory() {
  const rows = new Map();
  let id = 0;
  return {
    rows,
    addEntry(text, audioPath, opts) { rows.set(++id, { text, audioPath, ...opts }); return id; },
    updateEntryText(i, text) { rows.get(i).text = text; },
  };
}

describe('meeting notes', () => {
  let dir;
  let journal;
  let history;
  let behaviour;
  let notes;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-meet-'));
    journal = createJobJournal(path.join(dir, 'jobs'));
    history = fakeHistory();
    let n = 0;
    behaviour = (pcm) => `segment ${++n} (${Math.round(pcm.length / 16000)}s)`;
    const pipeline = createPipeline({
      service: { transcribe: async (pcm) => behaviour(pcm) },
      journal,
      recordingsDir: path.join(dir, 'rec'),
      log: quiet,
    });
    notes = createMeetingNotes({ pipeline, history, dir: path.join(dir, 'meetings'), recordingsDir: path.join(dir, 'rec'), log: quiet });
  });

  it('builds one growing entry from 30 s chunks and keeps one meeting WAV', async () => {
    const meta = notes.start({ app: 'Zoom' });
    expect(history.rows.get(meta.historyId)).toMatchObject({ kind: 'meeting' });
    expect(history.rows.get(meta.historyId).text).toMatch(/Listening/);

    await notes.addChunk(speech(30));
    await notes.addChunk(speech(30));
    await notes.addChunk(speech(12));
    const done = await notes.stop();

    const text = history.rows.get(meta.historyId).text;
    expect(text).toMatch(/^Meeting notes — Zoom/);
    expect(text.indexOf('segment 1')).toBeLessThan(text.indexOf('segment 2'));
    expect(text).toMatch(/segment 3 \(12s\)/);
    // full meeting audio survives; chunk WAVs and journal entries are cleaned up
    expect(decodeWavToPcm(done.audioPath).length).toBe(72 * 16000);
    expect(journal.list()).toHaveLength(0);
    expect(fs.readdirSync(path.join(dir, 'rec'))).toEqual([path.basename(done.audioPath)]);
  });

  it('skips silent chunks but still records them', async () => {
    const meta = notes.start({ app: 'Meet' });
    await notes.addChunk(new Float32Array(16000 * 30));
    await notes.stop();
    expect(history.rows.get(meta.historyId).text).toMatch(/No speech captured/);
    expect(decodeWavToPcm(meta.audioPath).length).toBe(30 * 16000);
  });

  it('a failed chunk stays in Needs attention and slots back in on retry', async () => {
    const meta = notes.start({ app: 'Teams' });
    await notes.addChunk(speech(30));
    behaviour = () => { throw new Error('Transcription engine crashed'); };
    await notes.addChunk(speech(30));
    behaviour = () => 'third part';
    await notes.addChunk(speech(30));
    await notes.stop();

    const [failed] = journal.list({ status: 'failed' });
    expect(failed).toMatchObject({ source: 'meeting', meta: { meetingId: meta.id, seq: 1 } });
    expect(fs.existsSync(failed.audioPath)).toBe(true);

    // retry (what index.js does for a meeting job)
    behaviour = () => 'recovered middle';
    const pipeline = createPipeline({ service: { transcribe: async () => behaviour() }, journal, recordingsDir: path.join(dir, 'rec'), log: quiet });
    const { text } = await pipeline.runJob(failed.id);
    notes.addSegment(meta.id, failed.meta.seq, text, failed.meta.at);
    const body = history.rows.get(meta.historyId).text;
    expect(body.indexOf('segment 1')).toBeLessThan(body.indexOf('recovered middle'));
    expect(body.indexOf('recovered middle')).toBeLessThan(body.indexOf('third part'));
  });
});

describe('renderMeetingText', () => {
  it('orders segments by sequence number', () => {
    const t = renderMeetingText({ app: 'Zoom', startedAt: 0, endedAt: 1, segments: { 2: { text: 'b', at: 0 }, 1: { text: 'a', at: 0 } } });
    expect(t.indexOf('] a')).toBeLessThan(t.indexOf('] b'));
  });
});
