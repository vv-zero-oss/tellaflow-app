import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createJobJournal, INTERRUPTED_ERROR, RECOVERED_ERROR } from '../../src/main/job-journal.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tf-journal-'));
}

describe('job journal', () => {
  let dir;
  let journal;
  beforeEach(() => {
    dir = tmpdir();
    journal = createJobJournal(path.join(dir, 'jobs'));
  });

  it('creates pending jobs on disk and reads them back', () => {
    const job = journal.create({ audioPath: '/a.wav', source: 'dictation', meta: { x: 1 } });
    expect(job.status).toBe('pending');
    expect(journal.get(job.id)).toMatchObject({ audioPath: '/a.wav', meta: { x: 1 } });
    expect(fs.existsSync(path.join(dir, 'jobs', `${job.id}.json`))).toBe(true);
  });

  it('survives a "restart" (new journal instance on the same dir)', () => {
    const job = journal.create({ audioPath: '/a.wav' });
    journal.markProcessing(job.id);
    const reopened = createJobJournal(path.join(dir, 'jobs'));
    expect(reopened.get(job.id).status).toBe('processing');
    expect(reopened.get(job.id).attempts).toBe(1);
  });

  it('recoverInterrupted marks pending/processing jobs as failed', () => {
    const a = journal.create({ audioPath: '/a.wav' });
    const b = journal.create({ audioPath: '/b.wav' });
    journal.markProcessing(b.id);
    const c = journal.create({ audioPath: '/c.wav' });
    journal.markFailed(c.id, new Error('boom'));
    expect(journal.recoverInterrupted()).toBe(2);
    expect(journal.get(a.id)).toMatchObject({ status: 'failed', error: INTERRUPTED_ERROR });
    expect(journal.get(b.id).status).toBe('failed');
    expect(journal.get(c.id).error).toBe('boom');
  });

  it('removes torn .tmp files on recovery', () => {
    fs.writeFileSync(path.join(dir, 'jobs', 'job-x.json.tmp'), '{"half');
    journal.recoverInterrupted();
    expect(fs.existsSync(path.join(dir, 'jobs', 'job-x.json.tmp'))).toBe(false);
  });

  it('ignores corrupt job files instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'jobs', 'job-bad.json'), 'not json');
    journal.create({ audioPath: '/ok.wav' });
    expect(journal.list()).toHaveLength(1);
  });

  it('complete drops the entry but keeps audio; remove can delete audio', () => {
    const wav = path.join(dir, 'r.wav');
    fs.writeFileSync(wav, 'x');
    const a = journal.create({ audioPath: wav });
    journal.complete(a.id);
    expect(journal.get(a.id)).toBeNull();
    expect(fs.existsSync(wav)).toBe(true);
    const b = journal.create({ audioPath: wav });
    journal.remove(b.id, { deleteAudio: true });
    expect(fs.existsSync(wav)).toBe(false);
  });

  it('lists by status, newest first', () => {
    let t = 1000;
    const j = createJobJournal(path.join(dir, 'jobs2'), { now: () => (t += 10) });
    const a = j.create({ audioPath: '/a' });
    const b = j.create({ audioPath: '/b' });
    j.markFailed(a.id, 'x');
    j.markFailed(b.id, 'y');
    expect(j.list({ status: 'failed' }).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('never touches files outside the journal for path-traversal ids', () => {
    expect(journal.markFailed('../../etc/passwd', 'x')).toBeNull();
    expect(journal.get('../outside')).toBeNull();
    expect(() => journal.remove('../outside')).not.toThrow();
  });

  it('adopts orphaned recordings left by a hard crash', () => {
    const rec = path.join(dir, 'recordings');
    fs.mkdirSync(rec);
    const known = path.join(rec, 'known.wav');
    const orphan = path.join(rec, 'orphan.wav');
    const tiny = path.join(rec, 'tiny.wav');
    const journaled = path.join(rec, 'journaled.wav');
    for (const f of [known, orphan, journaled]) fs.writeFileSync(f, Buffer.alloc(44 + 32000 * 2));
    fs.writeFileSync(tiny, Buffer.alloc(100));
    journal.create({ audioPath: journaled });

    const adopted = journal.adoptOrphans(rec, new Set([known]));
    expect(adopted.map((j) => j.audioPath)).toEqual([orphan]);
    expect(adopted[0]).toMatchObject({ status: 'failed', source: 'recovered', error: RECOVERED_ERROR, durationSec: 2 });
    // Idempotent: second pass adopts nothing new.
    expect(journal.adoptOrphans(rec, new Set([known]))).toHaveLength(0);
  });
});
