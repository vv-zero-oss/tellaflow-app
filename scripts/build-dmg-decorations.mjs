#!/usr/bin/env node
/**
 * Build an SVG of scattered Lucide icons + bubbles for the DMG installer's
 * bottom decoration band. Style mirrors the WhatsApp installer (varied
 * sizes, organic layout, plenty of dots) but uses voice/text-themed icons
 * and the tellaflow brand orange.
 *
 * Usage: node build-dmg-decorations.mjs <width> <height> <out-svg-path>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const [, , widthArg, heightArg, outPath] = process.argv;
if (!widthArg || !heightArg || !outPath) {
  console.error("usage: build-dmg-decorations.mjs <w> <h> <out>");
  process.exit(2);
}
const W = parseInt(widthArg, 10);
const H = parseInt(heightArg, 10);

// Voice / text / dictation themed Lucide icons.
const ICON_NAMES = [
  "mic",
  "headphones",
  "message-circle",
  "type",
  "keyboard",
  "audio-waveform",
  "waves",
  "music-2",
  "languages",
  "sparkles",
  "zap",
  "captions",
  "pencil",
  "file-text",
  "quote",
  "volume-2",
  "star",
  "heart",
  "radio",
];

function loadIconNode(name) {
  const path = join(ROOT, "node_modules", "lucide-react", "dist", "esm", "icons", `${name}.js`);
  const src = readFileSync(path, "utf8");
  const m = src.match(/const __iconNode = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error(`couldn't extract __iconNode from ${name}`);
  // Object literals use unquoted keys — evaluate as JS, not JSON.
  // eslint-disable-next-line no-new-func
  return Function(`return ${m[1]};`)();
}

const ICONS = Object.fromEntries(
  ICON_NAMES.map((name) => [name, loadIconNode(name)])
);

function attrsToString(attrs) {
  return Object.entries(attrs)
    .filter(([k]) => k !== "key")
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
}

function iconToSvg(name, { x, y, size, opacity }) {
  const node = ICONS[name];
  const scale = size / 24;
  // Lucide stroke width is 2 in the 24x24 viewbox; we keep that constant
  // in *target* pixels regardless of scale, so even tiny icons stay legible.
  const targetStroke = Math.max(1.2, 1.6 / scale);
  let body = "";
  for (const [tag, attrs] of node) {
    body += `<${tag} ${attrsToString(attrs)} />`;
  }
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(4)}) translate(-12 -12)" stroke="#EA5228" stroke-width="${targetStroke.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${opacity.toFixed(3)}">${body}</g>`;
}

// Deterministic PRNG so the layout doesn't churn between builds.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xC0FFEE);
const range = (lo, hi) => lo + rand() * (hi - lo);

// Decoration band sits across the bottom ~28% of the canvas. The top edge is
// pushed below the icon-label baseline (labels sit ~y=270 logical → ~0.64 of
// 420) so the scatter doesn't crowd the Tellaflow / Applications captions.
const BAND_TOP = H * 0.68;
const BAND_BOTTOM = H * 0.99;

// ---- icons ---------------------------------------------------------------
const placements = [];
const slotCount = 13;
const slotW = W / slotCount;
// One icon per horizontal slot — keeps spacing readable while leaving room
// for jitter, producing a scattered but balanced row.
for (let i = 0; i < slotCount; i++) {
  const slotCx = (i + 0.5) * slotW;
  const x = slotCx + (rand() - 0.5) * slotW * 0.55;
  const y = BAND_TOP + rand() * (BAND_BOTTOM - BAND_TOP) * 0.78;
  const size = range(34, 70);
  const opacity = range(0.16, 0.28);
  const name = ICON_NAMES[Math.floor(rand() * ICON_NAMES.length)];
  placements.push({ name, x, y, size, opacity });
}

// ---- decorative bubbles --------------------------------------------------
const bubbles = [];
const numBubbles = 110;
for (let i = 0; i < numBubbles; i++) {
  const x = rand() * W;
  const y = BAND_TOP - 20 + rand() * (BAND_BOTTOM - BAND_TOP + 50);
  const r = range(1.2, 5.8);
  const filled = rand() < 0.55;
  const opacity = range(0.10, 0.24);
  bubbles.push({ x, y, r, filled, opacity });
}

// ---- assemble SVG --------------------------------------------------------
let body = "";
for (const b of bubbles) {
  if (b.filled) {
    body += `<circle cx="${b.x.toFixed(2)}" cy="${b.y.toFixed(2)}" r="${b.r.toFixed(2)}" fill="#EA5228" opacity="${b.opacity.toFixed(3)}" />`;
  } else {
    body += `<circle cx="${b.x.toFixed(2)}" cy="${b.y.toFixed(2)}" r="${b.r.toFixed(2)}" fill="none" stroke="#EA5228" stroke-width="1.2" opacity="${b.opacity.toFixed(3)}" />`;
  }
}
for (const p of placements) {
  body += iconToSvg(p.name, p);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`;
writeFileSync(outPath, svg);
console.log(`wrote ${outPath} (${W}x${H}, ${placements.length} icons, ${bubbles.length} bubbles)`);
