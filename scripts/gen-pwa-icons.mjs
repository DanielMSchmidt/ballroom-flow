#!/usr/bin/env node
// Generate the PWA manifest icons (US-050) — deterministic, dependency-free.
// =================================================================
// Draws the app mark — four vertical "choreo" bars (the Choreo tab glyph) on
// the brand blue — straight into RGBA pixels and encodes minimal PNGs with
// node:zlib (no sharp/imagemagick in the toolchain, and a binary asset needs a
// regenerable source — same rule as the seed generators: regenerate, don't
// hand-edit). Rerun with `node scripts/gen-pwa-icons.mjs`; output is stable
// for a given (size, palette) so CI can diff-check it.
//
// Outputs (apps/web/public/, copied to dist/ by Vite):
//   pwa-192.png            192×192  manifest icon (any)
//   pwa-512.png            512×512  manifest icon (any)
//   pwa-512-maskable.png   512×512  full-bleed with the mark inside the safe
//                                   zone (maskable — Android adaptive icons)
//   apple-touch-icon.png   180×180  iOS home-screen icon
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "apps", "web", "public");

// Brand palette (styles/tokens.css / the manifest theme_color).
const BG = [0x2f, 0x5d, 0x8f, 0xff]; // --bf-accent-ish deep blue
const FG = [0xe9, 0xe6, 0xdf, 0xff]; // warm paper (the app background)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines, filter byte 0 per row
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Paint the mark: BG fill (rounded corners unless maskable/full-bleed), then
 *  four FG bars of staggered heights — the "choreo" glyph. */
function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : Math.round(size * 0.18);
  const set = (x, y, c) => {
    for (let i = 0; i < 4; i++) px[(y * size + x) * 4 + i] = c[i];
  };
  const insideRounded = (x, y) => {
    if (radius === 0) return true;
    const cx = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
    const cy = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
    if (cx === x && cy === y) return true;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRounded(x, y)) set(x, y, BG);
    }
  }
  // Four bars centered in the (maskable-safe) inner 60% box, staggered like a
  // rise-and-fall phrase: heights 0.55, 0.85, 0.7, 1.0 of the box.
  const box = maskable ? size * 0.52 : size * 0.6; // maskable safe zone ≈ 80% circle
  const barW = Math.round(box * 0.14);
  const gap = Math.round(box * 0.12);
  const heights = [0.55, 0.85, 0.7, 1.0].map((h) => Math.round(box * h));
  const totalW = barW * 4 + gap * 3;
  const left = Math.round((size - totalW) / 2);
  const baseline = Math.round(size / 2 + box / 2);
  heights.forEach((h, i) => {
    const x0 = left + i * (barW + gap);
    for (let y = baseline - h; y < baseline; y++) {
      for (let x = x0; x < x0 + barW; x++) set(x, y, FG);
    }
  });
  return encodePng(size, px);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "pwa-192.png"), drawIcon(192));
writeFileSync(join(outDir, "pwa-512.png"), drawIcon(512));
writeFileSync(join(outDir, "pwa-512-maskable.png"), drawIcon(512, { maskable: true }));
writeFileSync(join(outDir, "apple-touch-icon.png"), drawIcon(180));
console.log(`wrote 4 icons to ${outDir}`);
