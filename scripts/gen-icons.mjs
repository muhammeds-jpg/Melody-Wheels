#!/usr/bin/env node
/**
 * Builds every app icon from the real artwork.
 *
 *   npm run gen:icons
 *
 * The icon is a square crop of the backdrop illustration with the gold logo
 * centred on it, so a tab, a home-screen shortcut and a shared link all carry
 * the same picture the site opens with. It replaces a hand-drawn green disc that
 * had nothing to do with the brand.
 *
 * Two variants per size, because they are cropped differently by the platform:
 *
 *  - "any"      — shown as-is. The logo can run close to the edges.
 *  - "maskable" — Android clips it to a circle or squircle and keeps only the
 *                 central ~80%. The illustration is happy to bleed off, but the
 *                 logo has to sit inside that safe zone or its ends get sliced.
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
const BACKDROP = join(PUBLIC, "pattu-vandi-backdrop.png");
const LOGO = join(PUBLIC, "pattu-vandi-logo.svg");

/**
 * A square crop of the illustration.
 *
 * Taken from the full height and centred horizontally, which lands on the bus —
 * the thing the picture is actually about. `zoom` above 1 tightens in, for the
 * small sizes where a wide view turns to mush.
 */
async function squareBackdrop(size, zoom = 1) {
  const meta = await sharp(BACKDROP).metadata();
  const side = Math.round(Math.min(meta.width, meta.height) / zoom);
  return sharp(BACKDROP)
    .extract({
      left: Math.round((meta.width - side) / 2),
      top: Math.round((meta.height - side) / 2),
      width: side,
      height: side,
    })
    .resize(size, size, { fit: "cover" })
    .toBuffer();
}

/**
 * A scrim under the logo.
 *
 * The illustration is busy and mid-toned, and gold type laid straight onto it
 * disappears into the bus. Darkening the middle a little buys the contrast back
 * without flattening the picture into a grey square.
 */
function scrim(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <defs>
         <radialGradient id="s" cx="50%" cy="50%" r="72%">
           <stop offset="0%"   stop-color="#000" stop-opacity="0.62"/>
           <stop offset="55%"  stop-color="#000" stop-opacity="0.42"/>
           <stop offset="100%" stop-color="#000" stop-opacity="0.20"/>
         </radialGradient>
       </defs>
       <rect width="${size}" height="${size}" fill="url(#s)"/>
     </svg>`,
  );
}

/** The logo rendered at a share of the icon's width. */
async function logoAt(size, widthRatio) {
  const target = Math.round(size * widthRatio);
  return sharp(LOGO, { density: 600 })
    .resize({ width: target, fit: "inside" })
    .png()
    .toBuffer();
}

async function compose({ size, logoRatio, zoom }) {
  const [base, logo] = await Promise.all([
    squareBackdrop(size, zoom),
    logoAt(size, logoRatio),
  ]);

  return sharp(base)
    .composite([
      { input: scrim(size), blend: "over" },
      // `gravity: center` rather than computed offsets: the logo's rendered
      // height depends on how sharp rounds the aspect ratio, and centring by
      // hand drifts a pixel or two at some sizes.
      { input: logo, gravity: "center" },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const TARGETS = [
  // Shown as-is; the logo may run wide.
  { file: "icon-192.png", size: 192, logoRatio: 0.82, zoom: 1.15 },
  { file: "icon-512.png", size: 512, logoRatio: 0.8, zoom: 1 },
  // Clipped to a circle/squircle: the logo stays inside the central 80%.
  { file: "icon-192-maskable.png", size: 192, logoRatio: 0.6, zoom: 1.15 },
  { file: "icon-512-maskable.png", size: 512, logoRatio: 0.58, zoom: 1 },
  // iOS rounds the corners itself, so treat it as partly masked.
  { file: "apple-touch-icon.png", size: 180, logoRatio: 0.72, zoom: 1.15 },
];

for (const target of TARGETS) {
  const png = await compose(target);
  writeFileSync(join(PUBLIC, target.file), png);
  console.log(`  ${target.file.padEnd(26)} ${target.size}px  ${Math.round(png.length / 1024)}KB`);
}

/**
 * The favicon. Zoomed in hard and with a proportionally larger logo, because a
 * browser tab renders this at 16px — a wide view of a busy illustration becomes
 * an indistinct smudge at that size, while a tight crop still reads as warm gold
 * on dark.
 */
const favicon = await compose({ size: 96, logoRatio: 0.88, zoom: 1.6 });
writeFileSync(join(ROOT, "src", "app", "icon.png"), favicon);
console.log(`  src/app/icon.png           96px  ${Math.round(favicon.length / 1024)}KB`);

/**
 * The social card, 1200x630.
 *
 * Wide rather than square, so it takes the illustration almost uncropped — this
 * is the one place the full scene fits. Written as a static PNG rather than
 * rendered per request: a card is fetched by a crawler once and then cached
 * essentially forever, so paying to draw it at runtime buys nothing, and a
 * runtime failure would bake a blank card into every social platform's cache.
 */
async function socialCard() {
  const width = 1200;
  const height = 630;

  const base = await sharp(BACKDROP).resize(width, height, { fit: "cover" }).toBuffer();
  const logo = await sharp(LOGO, { density: 600 })
    .resize({ width: Math.round(width * 0.6), fit: "inside" })
    .png()
    .toBuffer();

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
        { input: logo, gravity: "center" },
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
writeFileSync(join(ROOT, "src", "app", "opengraph-image.jpg"), card);
console.log(
  `  src/app/opengraph-image.jpg 1200x630  ${Math.round(card.length / 1024)}KB`,
);

console.log(`
Done. Next serves src/app/icon.png and src/app/opengraph-image.jpg by file
convention; the rest are referenced from src/app/manifest.ts.`);
