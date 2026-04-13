const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makePNG(width, height, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(body));
    return Buffer.concat([len, t, data, c]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0; // filter: None
    pixels.copy(raw, y * rowLen + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawMicrophone(size) {
  const px = Buffer.alloc(size * size * 4, 0);
  const s = size / 22;

  function set(x, y, alpha) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    if (px[i + 3] < alpha) {
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = alpha;
    }
  }

  function fillEllipse(cx, cy, rx, ry, alpha) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) set(x, y, alpha);
      }
    }
  }

  function fillRect(x1, y1, x2, y2, alpha) {
    for (let y = Math.round(y1); y <= Math.round(y2); y++)
      for (let x = Math.round(x1); x <= Math.round(x2); x++)
        set(x, y, alpha);
  }

  function strokeArc(cx, cy, r, startAngle, endAngle, thickness, alpha) {
    const steps = Math.max(200, Math.ceil(r * 20));
    for (let i = 0; i <= steps; i++) {
      const angle = startAngle + (endAngle - startAngle) * (i / steps);
      const px = cx + r * Math.cos(angle);
      const py = cy + r * Math.sin(angle);
      fillEllipse(px, py, thickness / 2, thickness / 2, alpha);
    }
  }

  const cx = size / 2;

  // Mic capsule body (rounded rectangle / capsule shape)
  const capsuleW = 2.8 * s;
  const capsuleTop = 2 * s;
  const capsuleBottom = 10 * s;
  const capsuleMid = (capsuleTop + capsuleBottom) / 2;
  fillRect(cx - capsuleW, capsuleTop + capsuleW, cx + capsuleW, capsuleBottom - capsuleW, 255);
  fillEllipse(cx, capsuleTop + capsuleW, capsuleW, capsuleW, 255);
  fillEllipse(cx, capsuleBottom - capsuleW, capsuleW, capsuleW, 255);

  // U-shaped holder arc
  const arcCy = 8 * s;
  const arcR = 5 * s;
  const thick = 1.3 * s;
  strokeArc(cx, arcCy, arcR, 0, Math.PI, thick, 255);

  // Vertical sides connecting to capsule
  const sideTop = 5.5 * s;
  fillRect(cx - arcR - thick / 2, sideTop, cx - arcR + thick / 2, arcCy, 255);
  fillRect(cx + arcR - thick / 2, sideTop, cx + arcR + thick / 2, arcCy, 255);

  // Stem (vertical line from bottom of arc down)
  const stemTop = arcCy + arcR;
  const stemBottom = 17 * s;
  fillRect(cx - thick / 2, stemTop, cx + thick / 2, stemBottom, 255);

  // Base (horizontal line)
  const baseW = 3.2 * s;
  fillRect(cx - baseW, stemBottom - thick / 2, cx + baseW, stemBottom + thick / 2, 255);

  return px;
}

const outDir = path.join(__dirname, '..', 'resources');

const px22 = drawMicrophone(22);
const png22 = makePNG(22, 22, px22);
fs.writeFileSync(path.join(outDir, 'trayIconTemplate.png'), png22);
console.log('Created trayIconTemplate.png:', png22.length, 'bytes');

const px44 = drawMicrophone(44);
const png44 = makePNG(44, 44, px44);
fs.writeFileSync(path.join(outDir, 'trayIconTemplate@2x.png'), png44);
console.log('Created trayIconTemplate@2x.png:', png44.length, 'bytes');
