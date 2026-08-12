#!/usr/bin/env node
/**
 * Builds every app icon, and the social card, from the real artwork.
 *
 *   npm run gen:icons
 *
 * Two sources, because the two jobs are genuinely different:
 *
 *  - The ICON is the drawn mark in public/fav-icon.png — a square, flat-ground
 *    picture of the bus, which is what survives being shrunk to the 16px square
 *    a browser tab actually paints. Every icon here is that one image at a
 *    different size, so the tab, the home screen and the app switcher agree.
 *  - The SOCIAL CARD is the full illustration, 1200x630, because that is the one
 *    place the whole scene fits. The name is set across it in white.
 *
 * Icons come in two variants per size, cropped differently by the platform:
 *
 *  - "any"      — shown as-is, edge to edge.
 *  - "maskable" — Android clips it to a circle or squircle and keeps only the
 *                 central ~80%. The bus already runs to both edges of the mark,
 *                 so these are inset and the gap filled with the same ground
 *                 colour, or the clip would slice its nose and tail off.
 *
 * The favicon files are written to src/app/, NOT public/. That is Next's file
 * convention, and it is the reason a new icon actually appears: the convention
 * emits <link> tags with a content hash in the URL, so a rebuilt icon is a new
 * URL rather than a cache hit on the old one. Do not add an `icons` field to the
 * metadata in layout.tsx — it overrides all of this. See the note there.
 *
 * Uses sharp, which ships with Next, so there is nothing extra to install.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const APP = join(ROOT, "src", "app");

/** The drawn mark. Square, flat ground, reads at any size. */
const MARK = join(PUBLIC, "fav-icon.png");

/**
 * The still illustration, kept in assets/ rather than public/ because nothing
 * serves it any more — the page itself plays public/melody-wheels.mp4, which is
 * this same scene with the wheels turning. It stays in the repo because the
 * social card is built from it: a video frame is not something sharp can read.
 */
const BACKDROP = join(ROOT, "assets", "melody-wheels-backdrop.png");

/** The name, as the social card carries it. Matches SITE.name. */
const NAME = "Melody Wheels";

/**
 * The mark's own ground colour, sampled from a corner rather than hard-coded, so
 * replacing fav-icon.png with a differently-coloured mark needs no edit here.
 * It fills the inset on the maskable variants and flattens any transparency —
 * a PNG with an alpha channel shows through as black on some Android launchers.
 */
async function groundColour() {
  const { data } = await sharp(MARK)
    .extract({ left: 1, top: 1, width: 8, height: 8 })
    .resize(1, 1)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2], alpha: 1 };
}

/**
 * The mark at `size`, inset by `pad` (a share of the width per side) with the
 * gap filled in the ground colour.
 *
 * `contain` rather than `cover` for the inset case: the point is to show the
 * whole mark inside the safe zone, and cropping to fill would defeat that.
 */
async function icon(size, pad, ground) {
  const inner = Math.round(size * (1 - pad * 2));
  const resized = await sharp(MARK)
    .resize(inner, inner, { fit: "contain", background: ground })
    .toBuffer();

  const margin = Math.round((size - inner) / 2);
  return sharp(resized)
    .extend({
      top: margin,
      bottom: size - inner - margin,
      left: margin,
      right: size - inner - margin,
      background: ground,
    })
    .flatten({ background: ground })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const ground = await groundColour();
console.log(`  ground  rgb(${ground.r},${ground.g},${ground.b}) sampled from fav-icon.png\n`);

const TARGETS = [
  // Referenced from src/app/manifest.ts. Shown as-is, edge to edge.
  { dir: PUBLIC, file: "icon-192.png", size: 192, pad: 0 },
  { dir: PUBLIC, file: "icon-512.png", size: 512, pad: 0 },
  // Clipped to a circle/squircle: inset so the clip has room to take.
  { dir: PUBLIC, file: "icon-192-maskable.png", size: 192, pad: 0.12 },
  { dir: PUBLIC, file: "icon-512-maskable.png", size: 512, pad: 0.12 },
  /*
   * These two are the file-convention pair, and the reason the tab updates:
   * Next emits their <link> tags with a content hash in the URL.
   * icon.png is the favicon; apple-icon.png is the iOS home-screen icon, which
   * iOS rounds itself — so it gets a token inset rather than the full maskable
   * one, and never an alpha channel.
   */
  { dir: APP, file: "icon.png", size: 192, pad: 0 },
  { dir: APP, file: "apple-icon.png", size: 180, pad: 0.04 },
];

for (const target of TARGETS) {
  const png = await icon(target.size, target.pad, ground);
  writeFileSync(join(target.dir, target.file), png);
  const where = target.dir === APP ? "src/app/" : "public/";
  console.log(
    `  ${(where + target.file).padEnd(30)} ${target.size}px  ${Math.round(png.length / 1024)}KB`,
  );
}

/**
 * The name, set in white, rendered at a share of the card's width.
 *
 * Drawn oversized and then trimmed to its own ink, so the ratio means the width
 * of the letters themselves rather than of a canvas with unknown padding.
 *
 * The face is whatever serif the renderer resolves, not the site's Instrument
 * Serif: sharp rasterises through its own font stack and cannot reach a font
 * that next/font fetches at build time. The shapes are close enough at this
 * size, and the alternative is shipping a font file to render one line of type.
 */
async function wordmark(width, widthRatio) {
  const target = Math.round(width * widthRatio);

  /*
   * The canvas is deliberately far wider than the type can ever be.
   *
   * At 1800px it was NOT: "Melody Wheels" sets to roughly 1820px at this size,
   * so the final letter fell outside the viewport and was clipped away — and
   * because `trim` then cropped to the clipped bitmap, the result looked
   * deliberate rather than broken, at every output size. Give the glyphs room and
   * let `trim` find their real edges.
   */
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="3600" height="600">
       <text x="1800" y="400" text-anchor="middle" fill="#ffffff"
             font-family="Georgia, 'Times New Roman', serif" font-size="280">${NAME}</text>
     </svg>`,
  );

  return sharp(svg).trim().resize({ width: target, fit: "inside" }).png().toBuffer();
}

/**
 * The social card, 1200x630.
 *
 * Wide rather than square, so it takes the illustration almost uncropped — this
 * is the one place the full scene fits. Written as a static file rather than
 * rendered per request: a card is fetched by a crawler once and then cached
 * essentially forever, so paying to draw it at runtime buys nothing, and a
 * runtime failure would bake a blank card into every social platform's cache.
 */
async function socialCard() {
  const width = 1200;
  const height = 630;

  const base = await sharp(BACKDROP).resize(width, height, { fit: "cover" }).toBuffer();
  // 0.52, not the 0.6 an eleven-letter name was first drawn at: the ratio is the
  // width of the SET LINE, so a longer name at the same ratio simply crowds the
  // frame. Re-check this by eye if the name changes length again.
  const mark = await wordmark(width, 0.52);

  const wash = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
       <defs>
         <radialGradient id="s" cx="50%" cy="48%" r="70%">
           <stop offset="0%"   stop-color="#000" stop-opacity="0.58"/>
           <stop offset="100%" stop-color="#000" stop-opacity="0.30"/>
         </radialGradient>
       </defs>
       <rect width="${width}" height="${height}" fill="url(#s)"/>
     </svg>`,
  );

  return (
    sharp(base)
      .composite([
        { input: wash, blend: "over" },
        { input: mark, gravity: "center" },
      ])
      // JPEG, not PNG: this is a painted scene with thousands of colours and no
      // transparency, which is the case PNG is worst at — it came out at 1.3MB
      // against roughly a tenth of that here, with nothing visible lost. Some
      // platforms are strict about card weight, and a rejected card shows
      // nothing at all.
      .jpeg({ quality: 86, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer()
  );
}

const card = await socialCard();
writeFileSync(join(APP, "opengraph-image.jpg"), card);
console.log(`  src/app/opengraph-image.jpg    1200x630  ${Math.round(card.length / 1024)}KB`);

console.log(`
Done. Next serves src/app/icon.png, src/app/apple-icon.png and
src/app/opengraph-image.jpg by file convention — each with a hashed URL, so the
new icons replace whatever a browser had cached. The public/icon-*.png files are
referenced from src/app/manifest.ts.`);
