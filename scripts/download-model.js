#!/usr/bin/env node
// Cross-platform replacement for download-model.sh. Downloads the bundled
// Whisper small model from Hugging Face into resources/models/ggml-small.bin
// if it isn't already present. Runs on macOS, Windows, and Linux without
// depending on bash, curl, or wget.

const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
const MODEL_DIR = path.resolve(__dirname, '..', 'resources', 'models');
const MODEL_FILE = path.join(MODEL_DIR, 'ggml-small.bin');

if (fs.existsSync(MODEL_FILE) && fs.statSync(MODEL_FILE).size > 0) {
  console.log(`Model already exists at ${MODEL_FILE}`);
  process.exit(0);
}

fs.mkdirSync(MODEL_DIR, { recursive: true });

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let started = Date.now();
    let downloaded = 0;
    let total = 0;
    let lastLogged = 0;

    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        return download(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }

      total = parseInt(res.headers['content-length'] || '0', 10);
      console.log(`Downloading ggml-small.bin (~${(total / 1024 / 1024).toFixed(0)} MB)...`);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        if (now - lastLogged > 1000 && total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(1);
          const mb = (downloaded / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  ${pct}% — ${mb} MB`);
          lastLogged = now;
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        process.stdout.write('\n');
        console.log(`Done. Model saved to ${dest} (${elapsed}s)`);
        resolve();
      });

      file.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

download(MODEL_URL, MODEL_FILE).catch((err) => {
  console.error('Model download failed:', err.message);
  process.exit(1);
});
