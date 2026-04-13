const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { getDb } = require('./db');
const { sendToMainWindow } = require('./main-window');

// ─── DB setup ────────────────────────────────────────────────────────────────

function ensureTables() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS audiobooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      source_url TEXT,
      total_chunks INTEGER NOT NULL DEFAULT 0,
      current_chunk INTEGER NOT NULL DEFAULT 0,
      voice_id TEXT NOT NULL DEFAULT 'dave',
      engine TEXT NOT NULL DEFAULT 'neutts',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audiobook_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL REFERENCES audiobooks(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      audio_path TEXT,
      is_chapter_start INTEGER NOT NULL DEFAULT 0,
      chapter_title TEXT,
      UNIQUE(book_id, chunk_index)
    );
  `);
}

// ─── TTS model registry (delegated to neutts.js) ────────────────────────────
// The old kokoro/orpheus registry is replaced by NeuTTS. Status is forwarded
// from neutts.getDownloadStatus() so the UI model cards still work.

function getTtsModelCacheDir() {
  return path.join(app.getPath('userData'), 'tts-models');
}

function getModelsStatus() {
  try {
    const neutts = require('./neutts');
    return neutts.getDownloadStatus();
  } catch {
    return {};
  }
}

// ─── PDF parsing ─────────────────────────────────────────────────────────────

async function parsePdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  const title = data.info?.Title || path.basename(filePath, '.pdf');
  const author = data.info?.Author || '';
  const text = data.text || '';

  return { title, author, text };
}

// ─── EPUB parsing ─────────────────────────────────────────────────────────────

function parseEpub(filePath) {
  return new Promise((resolve, reject) => {
    const yauzl = require('yauzl');

    yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(err);

      const fileContents = {};

      zipfile.readEntry();

      zipfile.on('error', reject);

      zipfile.on('entry', (entry) => {
        const name = entry.fileName;
        const isText = name.endsWith('.xhtml') || name.endsWith('.html') ||
                       name.endsWith('.htm') || name.endsWith('.opf') ||
                       name.endsWith('.ncx') || name === 'META-INF/container.xml';

        if (isText) {
          zipfile.openReadStream(entry, (err2, stream) => {
            if (err2) { zipfile.readEntry(); return; }
            const chunks = [];
            stream.on('data', c => chunks.push(c));
            stream.on('end', () => {
              fileContents[name] = Buffer.concat(chunks).toString('utf8');
              zipfile.readEntry();
            });
            stream.on('error', () => zipfile.readEntry());
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        try {
          zipfile.close();
          const result = extractEpubContent(fileContents, filePath);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  });
}

function extractEpubContent(files, filePath) {
  // 1. Read META-INF/container.xml to find the OPF file path
  const containerXml = files['META-INF/container.xml'] || '';
  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  const opfPath = opfMatch?.[1] || '';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Parse OPF for title, author, and spine reading order
  const opfContent = files[opfPath] || '';
  const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const authorMatch = opfContent.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  const title = titleMatch?.[1]?.trim() || path.basename(filePath, '.epub');
  const author = authorMatch?.[1]?.trim() || '';

  // Build spine order from <spine> + <manifest>
  // Extract id/href from each <item> regardless of attribute order
  const manifestItems = {};
  const itemTagRe = /<item\s([^>]*\/?>) */gi;
  let m;
  while ((m = itemTagRe.exec(opfContent)) !== null) {
    const attrs = m[1];
    const id   = attrs.match(/\bid="([^"]+)"/)?.[1];
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifestItems[id] = href;
  }

  const spineItems = [];
  const spineRe = /<itemref\s+idref="([^"]+)"/gi;
  while ((m = spineRe.exec(opfContent)) !== null) {
    const href = manifestItems[m[1]];
    if (href && /\.(xhtml|html|htm)$/i.test(href)) {
      spineItems.push(opfDir + href);
    }
  }

  // 3. Fallback: all xhtml files sorted by name if no spine
  const xhtmlFiles = spineItems.length > 0
    ? spineItems
    : Object.keys(files).filter(k => k.endsWith('.xhtml') || k.endsWith('.htm') || k.endsWith('.html')).sort();

  // 4. Extract plain text from each content file, preserving paragraph structure
  const textParts = [];
  for (const filePath of xhtmlFiles) {
    const html = files[filePath];
    if (!html) continue;

    // Convert block elements to double newlines for paragraph preservation
    const cleaned = html
      .replace(/<(h[1-6]|p|div|br|section|article|blockquote)[^>]*>/gi, '\n\n')
      .replace(/<\/?(html|head|body|section|article|aside|nav|header|footer|main)[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')          // strip remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#x?[0-9a-f]+;/gi, ' ')
      .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
      .replace(/\n{3,}/g, '\n\n')       // max two newlines
      .trim();

    if (cleaned.length > 30) textParts.push(cleaned);
  }

  const text = textParts.join('\n\n');
  return { title, author, text };
}

// ─── Text splitting ───────────────────────────────────────────────────────────

const CHAPTER_RE = /^(chapter\s+\w+|part\s+\w+|prologue|epilogue|introduction|preface)\b/i;
// ~60 words ≈ 24 s of audio → fits within the 400-token output budget per TTS call
const CHUNK_WORDS = 60;

function chunkText(fullText) {
  // Split into paragraphs
  const paragraphs = fullText
    .split(/\n{2,}/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 10);

  const chunks = [];
  let buffer = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;
    const isChapter = CHAPTER_RE.test(para);

    if (isChapter || wordCount + words > CHUNK_WORDS) {
      if (buffer.length > 0) {
        chunks.push({ text: buffer.join(' '), isChapterStart: false, chapterTitle: null });
        buffer = [];
        wordCount = 0;
      }
    }

    if (isChapter) {
      chunks.push({ text: para, isChapterStart: true, chapterTitle: para });
    } else {
      buffer.push(para);
      wordCount += words;
    }
  }

  if (buffer.length > 0) {
    chunks.push({ text: buffer.join(' '), isChapterStart: false, chapterTitle: null });
  }

  return chunks;
}

// ─── URL fetching ─────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Tellaflow/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function extractTextFromHtml(html) {
  // Minimal HTML → text extraction
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n\n')
    .trim();

  // Try to extract title from <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Imported Book';

  return { title, author: '', text };
}

// ─── Audiobook DB helpers ─────────────────────────────────────────────────────

function getAudiobooks() {
  const db = getDb();
  return db.prepare(`
    SELECT id, title, author, file_path as filePath, source_url as sourceUrl,
           total_chunks as totalChunks, current_chunk as currentChunk,
           voice_id as voiceId, engine, created_at as createdAt, updated_at as updatedAt
    FROM audiobooks ORDER BY updated_at DESC
  `).all();
}

function createAudiobookRecord({ title, author, text, filePath, sourceUrl, voiceId, engine }) {
  const db = getDb();
  const chunks = chunkText(text);

  const insert = db.prepare(`
    INSERT INTO audiobooks (title, author, file_path, source_url, total_chunks, voice_id, engine)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertChunk = db.prepare(`
    INSERT INTO audiobook_chunks (book_id, chunk_index, text, is_chapter_start, chapter_title)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    const result = insert.run(title, author || '', filePath || null, sourceUrl || null, chunks.length, voiceId || 'dave', engine || 'neutts');
    const bookId = result.lastInsertRowid;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      insertChunk.run(bookId, i, c.text, c.isChapterStart ? 1 : 0, c.chapterTitle || null);
    }
    return bookId;
  });

  const bookId = insertMany();

  return db.prepare(`
    SELECT id, title, author, file_path as filePath, source_url as sourceUrl,
           total_chunks as totalChunks, current_chunk as currentChunk,
           voice_id as voiceId, engine, created_at as createdAt, updated_at as updatedAt
    FROM audiobooks WHERE id = ?
  `).get(bookId);
}

function getChunks(bookId) {
  const db = getDb();
  return db.prepare(`
    SELECT id, book_id as bookId, chunk_index as chunkIndex, text,
           audio_path as audioPath, is_chapter_start as isChapterStart, chapter_title as chapterTitle
    FROM audiobook_chunks WHERE book_id = ? ORDER BY chunk_index
  `).all(bookId);
}

function updateProgress(bookId, chunkIndex) {
  const db = getDb();
  db.prepare(`UPDATE audiobooks SET current_chunk = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(chunkIndex, bookId);
}

function deleteAudiobookRecord(id) {
  const db = getDb();
  // Clean up cached audio files
  const chunks = db.prepare(`SELECT audio_path FROM audiobook_chunks WHERE book_id = ? AND audio_path IS NOT NULL`).all(id);
  for (const c of chunks) {
    try { fs.unlinkSync(c.audio_path); } catch (_) {}
  }
  db.prepare(`DELETE FROM audiobooks WHERE id = ?`).run(id);
}

// ─── Audio cache helpers ──────────────────────────────────────────────────────

function getAudioCacheDir() {
  const dir = path.join(app.getPath('userData'), 'audiobook-cache');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── IPC registration ─────────────────────────────────────────────────────────

function registerIpc() {
  ensureTables();
  fs.mkdirSync(getTtsModelCacheDir(), { recursive: true });

  // Audiobook CRUD
  ipcMain.handle('get-audiobooks', () => getAudiobooks());

  ipcMain.handle('create-audiobook', (_, opts) => {
    const book = createAudiobookRecord(opts);
    sendToMainWindow('audiobooks-changed', getAudiobooks());
    return book;
  });

  ipcMain.handle('delete-audiobook', (_, id) => {
    deleteAudiobookRecord(id);
    sendToMainWindow('audiobooks-changed', getAudiobooks());
  });

  ipcMain.handle('get-audiobook-chunks', (_, bookId) => getChunks(bookId));

  ipcMain.handle('update-audiobook-progress', (_, { bookId, chunkIndex }) => {
    updateProgress(bookId, chunkIndex);
  });

  // File picker
  ipcMain.handle('pick-pdf-file', async () => {
    const { getMainWindow } = require('./main-window');
    const win = getMainWindow?.() || null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Select a document',
      filters: [
        { name: 'Documents', extensions: ['epub', 'pdf', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.epub') {
      try {
        const parsed = await parseEpub(filePath);
        console.log(`EPUB parsed: "${parsed.title}" by "${parsed.author}", ${parsed.text.length} chars`);
        return { ...parsed, filePath };
      } catch (err) {
        console.error('EPUB parse error:', err);
        return null;
      }
    }

    if (ext === '.pdf') {
      try {
        return { ...await parsePdf(filePath), filePath };
      } catch (err) {
        console.error('PDF parse error:', err);
        return null;
      }
    }

    if (ext === '.txt') {
      const text = fs.readFileSync(filePath, 'utf8');
      const title = path.basename(filePath, '.txt');
      return { title, author: '', text, filePath };
    }

    return null;
  });

  // URL import
  ipcMain.handle('fetch-url-text', async (_, url) => {
    try {
      const html = await fetchUrl(url);
      return extractTextFromHtml(html);
    } catch (err) {
      console.error('URL fetch error:', err);
      return null;
    }
  });

  // Synthesize a chunk — delegates to neutts worker, returns { pcmBase64, sampleRate }
  ipcMain.handle('synthesize-chunk', async (_, { text, voiceName }) => {
    const neutts = require('./neutts');
    console.log(`[audiobook] synthesize-chunk IPC: voice=${voiceName} textLen=${text?.length}`);
    return neutts.synthesize(text, voiceName);
  });
}

module.exports = { registerIpc };
