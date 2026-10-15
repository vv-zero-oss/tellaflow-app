/**
 * Crash-safe transcription pipeline.
 *
 *   saveRecording()  — audio → WAV on disk → journal entry (status pending)
 *   runJob()         — journal: processing → worker transcription → post-process
 *   finishJob()      — success: drop the journal entry (history owns the audio)
 *   failJob()        — failure: journal keeps it as `failed` + audio for retry
 *
 * Dependencies are injected so the whole flow is unit-testable with a fake
 * transcription service and a temp directory.
 */

const fs = require('fs');
const path = require('path');
const { encodePcmToWav, decodeWavToPcm } = require('./audio-utils');

const SAMPLE_RATE = 16000;
// Clips longer than this are transcribed in ~30 s windows. Keeps worker
// memory flat for hour-long files and lets a crash cost one window, not all.
const LONG_CLIP_SEC = 120;
const WINDOW_SEC = 30;
const SPLIT_SEARCH_SEC = 2;

/**
 * Split PCM into ~windowSec pieces, moving each cut to the quietest 50 ms
 * frame within ±searchSec of the nominal boundary so words are not cut.
 */
function splitForTranscription(pcm, { windowSec = WINDOW_SEC, searchSec = SPLIT_SEARCH_SEC, sampleRate = SAMPLE_RATE } = {}) {
  const win = Math.floor(windowSec * sampleRate);
  if (pcm.length <= win * 1.5) return [pcm];
  const frame = Math.floor(sampleRate * 0.05);
  const search = Math.floor(searchSec * sampleRate);
  const pieces = [];
  let start = 0;
  while (pcm.length - start > win * 1.5) {
    const nominal = start + win;
    let bestCut = nominal;
    let bestEnergy = Infinity;
    for (let c = Math.max(start + frame, nominal - search); c <= Math.min(pcm.length - frame, nominal + search); c += frame) {
      let e = 0;
      for (let i = c; i < c + frame; i++) e += pcm[i] * pcm[i];
      if (e < bestEnergy) { bestEnergy = e; bestCut = c; }
    }
    pieces.push(pcm.subarray(start, bestCut));
    start = bestCut;
  }
  pieces.push(pcm.subarray(start));
  return pieces;
}

function createPipeline({
  service,
  journal,
  recordingsDir,
  preprocess = (pcm) => pcm,
  postProcess = async (text) => text,
  log = console,
  now = () => Date.now(),
}) {
  fs.mkdirSync(recordingsDir, { recursive: true });

  function newAudioPath(prefix = 'recording') {
    return path.join(recordingsDir, `${prefix}-${now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  }

  /** Persist audio + journal entry synchronously, before any transcription. */
  function saveRecording(pcm, { source = 'dictation', meta = {}, audioPath } = {}) {
    let savedPath = audioPath || null;
    if (!savedPath) {
      savedPath = newAudioPath(source === 'meeting' ? 'meeting-chunk' : 'recording');
      fs.writeFileSync(savedPath, encodePcmToWav(pcm, SAMPLE_RATE));
    }
    const job = journal.create({
      audioPath: savedPath,
      source,
      meta,
      durationSec: Math.round((pcm.length / SAMPLE_RATE) * 10) / 10,
    });
    return job;
  }

  async function transcribePcm(pcm, transcribeOpts) {
    const processed = preprocess(pcm);
    if (!processed || processed.length === 0) return '';
    if (processed.length / SAMPLE_RATE <= LONG_CLIP_SEC) {
      return ((await service.transcribe(processed, transcribeOpts)) || '').trim();
    }
    const parts = [];
    for (const piece of splitForTranscription(processed)) {
      const t = ((await service.transcribe(piece, transcribeOpts)) || '').trim();
      if (t) parts.push(t);
    }
    return parts.join(' ');
  }

  /**
   * Transcribe a journaled job. Returns { rawText, text } where text is
   * post-processed. Throws (after marking the job failed) on any error.
   * `rawText` may be precomputed (streaming sessions transcribe while
   * recording) — then only post-processing runs.
   */
  async function runJob(jobId, { pcm, rawText, transcribeOpts, context } = {}) {
    const job = journal.markProcessing(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    try {
      let raw = rawText;
      if (raw == null) {
        const samples = pcm || decodeWavToPcm(job.audioPath);
        raw = await transcribePcm(samples, transcribeOpts);
      }
      raw = (raw || '').trim();
      const text = raw ? ((await postProcess(raw, { job, context })) || '').trim() : '';
      return { job, rawText: raw, text };
    } catch (err) {
      journal.markFailed(jobId, err);
      log.warn?.(`[pipeline] job ${jobId} failed:`, err.message);
      throw err;
    }
  }

  /** Success: drop the journal entry. `keepAudio=false` also deletes the WAV (silence / playground). */
  function finishJob(jobId, { keepAudio = true } = {}) {
    if (keepAudio) journal.complete(jobId);
    else journal.remove(jobId, { deleteAudio: true });
  }

  function failJob(jobId, err) {
    return journal.markFailed(jobId, err);
  }

  return { saveRecording, runJob, finishJob, failJob, transcribePcm, newAudioPath };
}

module.exports = { createPipeline, splitForTranscription };
