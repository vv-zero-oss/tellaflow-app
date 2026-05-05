/**
 * Shared download manager with resume, redirect, progress, pause/cancel support.
 * Replaces duplicated download logic across grammar.js, models.js, etc.
 */
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');

const MAX_REDIRECTS = 10;

class DownloadManager {
  constructor() {
    this.active = {};   // id → { request, response, writeStream, downloaded }
    this.paused = new Set();
  }

  /**
   * Start or resume a download.
   * @param {string} id - Unique identifier for this download
   * @param {object} opts
   * @param {string} opts.url - Source URL
   * @param {string} opts.dest - Final destination path
   * @param {number} [opts.expectedBytes] - Expected file size (for progress %)
   * @param {function} [opts.onProgress] - ({ id, downloaded, total, percent }) => void
   * @param {function} [opts.onComplete] - (destPath) => void
   * @param {function} [opts.onError] - (error) => void
   */
  start(id, { url, dest, expectedBytes = 0, onProgress, onComplete, onError }) {
    if (this.active[id]) {
      onError?.(new Error(`Already downloading: ${id}`));
      return;
    }

    if (fs.existsSync(dest)) {
      onComplete?.(dest);
      return;
    }

    this.paused.delete(id);

    const tmpPath = dest + '.tmp';
    let startByte = 0;
    try { startByte = fs.statSync(tmpPath).size; } catch {}

    this._doRequest(id, { url, dest, tmpPath, expectedBytes, startByte, redirectCount: 0, onProgress, onComplete, onError });
  }

  _doRequest(id, ctx) {
    const { url, dest, tmpPath, expectedBytes, startByte, redirectCount, onProgress, onComplete, onError } = ctx;

    if (redirectCount > MAX_REDIRECTS) {
      delete this.active[id];
      onError?.(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
      return;
    }

    const headers = {};
    if (startByte > 0) headers['Range'] = `bytes=${startByte}-`;

    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        this._doRequest(id, { ...ctx, url: res.headers.location, redirectCount: redirectCount + 1 });
        return;
      }

      // Range not satisfiable — restart from 0
      if (res.statusCode === 416) {
        try { fs.unlinkSync(tmpPath); } catch {}
        this._doRequest(id, { ...ctx, startByte: 0, redirectCount: redirectCount + 1 });
        return;
      }

      if (res.statusCode !== 200 && res.statusCode !== 206) {
        delete this.active[id];
        onError?.(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }

      // Determine total size
      let totalBytes;
      let resumeFrom = startByte;
      if (res.statusCode === 206) {
        const range = res.headers['content-range'];
        totalBytes = range
          ? parseInt(range.match(/\/(\d+)$/)?.[1] ?? expectedBytes, 10)
          : resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
      } else {
        totalBytes = parseInt(res.headers['content-length'], 10) || expectedBytes;
        resumeFrom = 0;
      }

      let downloadedBytes = res.statusCode === 206 ? resumeFrom : 0;
      const flags = res.statusCode === 206 ? 'a' : 'w';
      const ws = fs.createWriteStream(tmpPath, { flags });

      this.active[id] = { request: req, response: res, writeStream: ws, downloaded: downloadedBytes };

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (this.active[id]) this.active[id].downloaded = downloadedBytes;
        onProgress?.({
          id,
          downloaded: downloadedBytes,
          total: totalBytes,
          percent: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
        });
      });

      res.pipe(ws);

      ws.on('finish', () => {
        if (this.paused.has(id)) return;
        delete this.active[id];
        try {
          fs.renameSync(tmpPath, dest);
          onComplete?.(dest);
        } catch (err) {
          onError?.(err);
        }
      });

      ws.on('error', (err) => {
        delete this.active[id];
        try { fs.unlinkSync(tmpPath); } catch {}
        onError?.(err);
      });

      res.on('error', (err) => {
        delete this.active[id];
        onError?.(err);
      });
    });

    req.on('error', (err) => {
      delete this.active[id];
      onError?.(err);
    });
  }

  /**
   * Pause an active download (keeps .tmp for resume).
   */
  pause(id) {
    const dl = this.active[id];
    if (!dl) return false;
    this.paused.add(id);
    try { dl.response.unpipe(dl.writeStream); } catch {}
    try { dl.response.destroy(); } catch {}
    try { dl.request.destroy(); } catch {}
    try { dl.writeStream.end(); } catch {}
    delete this.active[id];
    return true;
  }

  /**
   * Cancel a download and remove the .tmp file.
   */
  cancel(id, tmpPath) {
    this.pause(id);
    this.paused.delete(id);
    if (tmpPath) try { fs.unlinkSync(tmpPath); } catch {}
  }

  /**
   * Get current downloaded bytes for an active download.
   */
  getProgress(id) {
    return this.active[id]?.downloaded ?? 0;
  }

  /**
   * Check if a download is active.
   */
  isActive(id) {
    return id in this.active;
  }

  /**
   * Get partial file size for a paused download.
   */
  getPartialSize(tmpPath) {
    try { return fs.statSync(tmpPath).size; } catch { return 0; }
  }

  /**
   * Stop all active downloads (for app quit).
   */
  stopAll() {
    for (const id of Object.keys(this.active)) {
      this.pause(id);
    }
  }
}

// Singleton instance shared across the app
const downloadManager = new DownloadManager();

module.exports = { DownloadManager, downloadManager };
