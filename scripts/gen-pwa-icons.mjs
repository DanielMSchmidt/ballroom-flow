#!/usr/bin/env node
// Generate the PWA manifest icons (US-050) — deterministic, dependency-free.
// =================================================================
// Draws the app mark — the "woven W" brand mark (two dancers' paths
// interlocking into a W; see apps/web/src/ui/icons.tsx BrandMark and
// apps/web/public/favicon.svg, which share this exact geometry) on the brand
// blue — straight into RGBA pixels and encodes minimal PNGs with node:zlib
// (no sharp/imagemagick in the toolchain, and a binary asset needs a
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

// The mark in its 24-unit viewBox (identical to BrandMark / favicon.svg):
// left strand drawn whole, right strand broken around the crossing at (12,12)
// so the left path reads as passing over — the "weave".
const SEGMENTS = [
  [3.4, 6, 9.4, 18],
  [9.4, 18, 15.4, 6],
  [8.6, 6, 10.39, 9.58],
  [13.61, 16.02, 14.6, 18],
  [14.6, 18, 20.6, 6],
];
const STROKE = 2.4; // stroke-width in viewBox units (round caps)
const VIEW = 24;

/** Distance from point (px,py) to segment (x1,y1)-(x2,y2). */
function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const ex = px - (x1 + t * dx);
  const ey = py - (y1 + t * dy);
  return Math.sqrt(ex * ex + ey * ey);
}

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
 *  the woven-W strokes as anti-aliased round-capped capsules. */
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
  // Mark scale: the W spans ~18×16 of its 24-unit box. 0.78 fills the tile
  // like the favicon; the maskable safe zone (~80% circle) needs the mark's
  // half-diagonal (~12 units) inside 0.4·size, so it gets a smaller factor.
  const scale = (size * (maskable ? 0.62 : 0.78)) / VIEW;
  const half = size / 2;
  const r = (STROKE / 2) * scale; // stroke radius in pixels
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRounded(x, y)) continue;
      set(x, y, BG);
      // pixel center → viewBox units (mark centered on the icon)
      const ux = (x + 0.5 - half) / scale + VIEW / 2;
      const uy = (y + 0.5 - half) / scale + VIEW / 2;
      let d = Infinity;
      for (const s of SEGMENTS) d = Math.min(d, segDist(ux, uy, s));
      // coverage: 1px-wide anti-aliased edge around the capsule boundary
      const a = Math.max(0, Math.min(1, r - d * scale + 0.5));
      if (a === 0) continue;
      const c = [0, 0, 0, 0xff];
      for (let i = 0; i < 3; i++) c[i] = Math.round(BG[i] + (FG[i] - BG[i]) * a);
      set(x, y, c);
    }
  }
  return encodePng(size, px);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "pwa-192.png"), drawIcon(192));
writeFileSync(join(outDir, "pwa-512.png"), drawIcon(512));
writeFileSync(join(outDir, "pwa-512-maskable.png"), drawIcon(512, { maskable: true }));
writeFileSync(join(outDir, "apple-touch-icon.png"), drawIcon(180));
console.log(`wrote 4 icons to ${outDir}`);
