/**
 * Automatic meeting notes.
 *
 * While a meeting is detected, the microphone is captured in ~30 s chunks
 * (same capture page as long-form dictation, in "meeting" mode). Every chunk:
 *   1. is appended to one growing meeting WAV (durable even if we crash),
 *   2. goes through the crash-safe job journal as its own job,
 *   3. is transcribed locally and appended to a single growing
 *      "Meeting notes" history entry.
 * A chunk that fails stays in "Needs attention"; retrying it slots the text
 * back into the right place in the meeting entry.
 */

const fs = require('fs');
const path = require('path');
const { createWavWriter } = require('./audio-utils');

const SILENCE_RMS = 0.004;

function rms(pcm) {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / (pcm.length || 1));
}

function formatClock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderMeetingText(meta) {
  const head = `Meeting notes — ${meta.app || 'Meeting'} · ${new Date(meta.startedAt).toLocaleString()}`;
  const segs = Object.entries(meta.segments || {})
    .map(([seq, s]) => ({ seq: Number(seq), ...s }))
    .filter((s) => s.text)
    .sort((a, b) => a.seq - b.seq)
    .map((s) => `[${formatClock(s.at)}] ${s.text}`);
  const body = segs.length ? segs.join('\n\n') : (meta.endedAt ? '(No speech captured.)' : '(Listening…)');
  return `${head}\n\n${body}`;
}

function createMeetingNotes({ pipeline, history, dir, recordingsDir, onUpdate = () => {}, log = console, now = () => Date.now() }) {
  fs.mkdirSync(dir, { recursive: true });
  let session = null;

  const metaFile = (id) => path.join(dir, `${id}.json`);

  function readMeta(id) {
    try { return JSON.parse(fs.readFileSync(metaFile(id), 'utf8')); } catch { return null; }
  }

  function writeMeta(meta) {
    const f = metaFile(meta.id);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(meta));
    fs.renameSync(`${f}.tmp`, f);
  }

  function refreshEntry(meta) {
    if (meta.historyId == null) return;
    try { history.updateEntryText(meta.historyId, renderMeetingText(meta)); } catch (err) { log.warn?.('[meeting] update entry failed:', err.message); }
    onUpdate(meta);
  }

  function start({ app, reason } = {}) {
    if (session) return session.meta;
    const startedAt = now();
    const id = `meeting-${startedAt}`;
    const audioPath = path.join(recordingsDir, `${id}.wav`);
    const writer = createWavWriter(audioPath);
    const meta = { id, app: app || 'Meeting', reason: reason || null, startedAt, endedAt: null, audioPath, segments: {}, historyId: null };
    meta.historyId = history.addEntry(renderMeetingText(meta), audioPath, { kind: 'meeting', timestamp: startedAt });
    writeMeta(meta);
    session = { meta, writer, nextSeq: 0, chain: Promise.resolve() };
    onUpdate(meta);
    log.log?.(`[meeting] notes started for ${meta.app}`);
    return meta;
  }

  /** Called for each ~30 s chunk while the meeting runs. Chunks are processed in order. */
  function addChunk(pcm) {
    const s = session;
    if (!s || !pcm || pcm.length === 0) return Promise.resolve();
    const seq = s.nextSeq++;
    const at = now() - Math.round((pcm.length / 16000) * 1000);
    try { s.writer.append(pcm); } catch (err) { log.warn?.('[meeting] append failed:', err.message); }
    if (rms(pcm) < SILENCE_RMS) return Promise.resolve(); // silence: keep audio, skip transcription

    const job = pipeline.saveRecording(pcm, { source: 'meeting', meta: { meetingId: s.meta.id, seq, at } });
    s.chain = s.chain.then(async () => {
      try {
        const { text } = await pipeline.runJob(job.id, { pcm });
        addSegment(s.meta.id, seq, text, at);
        pipeline.finishJob(job.id, { keepAudio: false }); // the meeting WAV has it
      } catch (err) {
        log.warn?.(`[meeting] chunk ${seq} failed — kept for retry:`, err.message);
      }
    });
    return s.chain;
  }

  function addSegment(meetingId, seq, text, at) {
    const meta = session && session.meta.id === meetingId ? session.meta : readMeta(meetingId);
    if (!meta) return false;
    meta.segments[seq] = { text: (text || '').trim(), at: at || now() };
    writeMeta(meta);
    refreshEntry(meta);
    return true;
  }

  async function stop() {
    const s = session;
    if (!s) return null;
    session = null;
    await s.chain.catch(() => {});
    try { s.writer.finalize(); } catch {}
    s.meta.endedAt = now();
    writeMeta(s.meta);
    refreshEntry(s.meta);
    log.log?.(`[meeting] notes finished (${Object.keys(s.meta.segments).length} segments)`);
    return s.meta;
  }

  return { start, addChunk, addSegment, stop, isActive: () => !!session, getActive: () => session?.meta || null, readMeta };
}

module.exports = { createMeetingNotes, renderMeetingText };
