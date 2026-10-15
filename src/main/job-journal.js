/**
 * Durable transcription job journal.
 *
 * Every recording is written to disk and logged here BEFORE transcription
 * starts. One small JSON file per job, written atomically (tmp + rename), so
 * a crash at any point leaves either the old or the new state, never a torn
 * file. Jobs that finish successfully are removed (the transcript lives in
 * history); jobs that fail, or that were in flight when the app died, stay
 * as `failed` so the user can retry or discard them from "Needs attention".
 */

const fsDefault = require('fs');
const path = require('path');

const INTERRUPTED_ERROR = 'Interrupted — the app quit or crashed before this finished.';
const RECOVERED_ERROR = 'Recovered recording — the app crashed before it was saved.';

function createJobJournal(dir, { fs = fsDefault, now = () => Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let seq = 0;

  function fileFor(id) {
    if (!/^[\w-]+$/.test(String(id))) throw new Error(`Invalid job id: ${id}`);
    return path.join(dir, `${id}.json`);
  }

  function write(job) {
    const file = fileFor(job.id);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(job));
    fs.renameSync(tmp, file);
    return job;
  }

  function get(id) {
    try {
      return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
    } catch {
      return null;
    }
  }

  function create({ audioPath, source = 'dictation', meta = {}, durationSec = null, id } = {}) {
    const t = now();
    const job = {
      id: id || `job-${t}-${process.pid}-${++seq}`,
      audioPath: audioPath || null,
      source,
      meta,
      durationSec,
      status: 'pending',
      attempts: 0,
      error: null,
      createdAt: t,
      updatedAt: t,
    };
    return write(job);
  }

  function update(id, patch) {
    const job = get(id);
    if (!job) return null;
    return write({ ...job, ...patch, id: job.id, updatedAt: now() });
  }

  function markProcessing(id) {
    const job = get(id);
    if (!job) return null;
    return write({ ...job, status: 'processing', attempts: job.attempts + 1, updatedAt: now() });
  }

  function markFailed(id, error) {
    return update(id, { status: 'failed', error: (error && error.message) || String(error || 'Transcription failed') });
  }

  /** Successful job: drop it from the journal (audio stays — history owns it). */
  function complete(id) {
    try { fs.unlinkSync(fileFor(id)); } catch {}
  }

  function remove(id, { deleteAudio = false } = {}) {
    const job = get(id);
    if (job && deleteAudio && job.audioPath) {
      try { fs.unlinkSync(job.audioPath); } catch {}
    }
    try { fs.unlinkSync(fileFor(id)); } catch {}
    return job;
  }

  function list({ status } = {}) {
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const jobs = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const job = get(name.slice(0, -5));
      if (job && (!status || job.status === status)) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Called at startup: anything still pending/processing was cut off by a crash. */
  function recoverInterrupted() {
    let n = 0;
    for (const job of list()) {
      if (job.status === 'pending' || job.status === 'processing') {
        write({ ...job, status: 'failed', error: INTERRUPTED_ERROR, updatedAt: now() });
        n++;
      }
    }
    // Clean up torn temp files from a crash mid-write.
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith('.tmp')) { try { fs.unlinkSync(path.join(dir, name)); } catch {} }
      }
    } catch {}
    return n;
  }

  /**
   * Adopt WAV files in `recordingsDir` that neither history nor the journal
   * knows about — written just before a hard crash. Files older than
   * `maxAgeMs` are left alone (the pruner handles them).
   */
  function adoptOrphans(recordingsDir, knownPaths, { maxAgeMs = 7 * 24 * 3600 * 1000, minBytes = 16044 } = {}) {
    const journalPaths = new Set(list().map((j) => j.audioPath).filter(Boolean));
    let names;
    try { names = fs.readdirSync(recordingsDir); } catch { return []; }
    const adopted = [];
    const t = now();
    for (const name of names) {
      if (!name.endsWith('.wav')) continue;
      const full = path.join(recordingsDir, name);
      if (knownPaths.has(full) || journalPaths.has(full)) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      // < 0.5 s of audio is noise, not a lost dictation.
      if (st.size < minBytes) continue;
      if (t - st.mtimeMs > maxAgeMs) continue;
      const durationSec = Math.round(((st.size - 44) / 32000) * 10) / 10;
      const job = create({ audioPath: full, source: 'recovered', durationSec });
      adopted.push(write({ ...job, status: 'failed', error: RECOVERED_ERROR, createdAt: Math.round(st.mtimeMs) }));
    }
    return adopted;
  }

  return { create, get, update, markProcessing, markFailed, complete, remove, list, recoverInterrupted, adoptOrphans, dir };
}

module.exports = { createJobJournal, INTERRUPTED_ERROR, RECOVERED_ERROR };
