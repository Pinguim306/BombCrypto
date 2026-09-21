#!/usr/bin/env node
/**
 * gen-sprites.mjs — renders MinerBlast's procedural pixel art to PNG files
 * for the Godot client. Zero dependencies (Node 18+):
 *
 *   node godot/tools/gen-sprites.mjs
 *
 * The character maps and palettes mirror client/src/art/pixelart.ts (the
 * Phaser client draws the same maps at runtime). Each sprite is written at
 * the same pixel scale Phaser uses for it, so a Sprite2D at scale 1 in Godot
 * matches the Phaser layout 1:1. Final artist-made art replaces these PNGs
 * by file name — no code changes needed.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sprites");

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Encodes an RGBA buffer (width*height*4) as an 8-bit RGBA PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- rendering

function shade(color, factor) {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Draws a character map with a palette at an integer pixel scale. Unknown
 *  characters (including '.') are transparent, like the Phaser version. */
function render(rows, palette, scale) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const W = w * scale, H = h * scale;
  const px = Buffer.alloc(W * H * 4); // zero = transparent
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = palette[ch];
      if (c === undefined) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * W + (x * scale + dx)) * 4;
          px[i] = (c >> 16) & 0xff;
          px[i + 1] = (c >> 8) & 0xff;
          px[i + 2] = c & 0xff;
          px[i + 3] = 255;
        }
      }
    });
  });
  return { W, H, px, nativeW: w, nativeH: h };
}

// ---------------------------------------------------------------- maps (verbatim from pixelart.ts)

export const RARITY_COLORS = [0x9e9e9e, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xffa726, 0xef5350];

const HERO_MAP = [
  "......KKK.......",
  ".....KlLlK......",
  "....KKKKKKK.....",
  "...KHHHHHHHK....",
  "..KHHHHHHHHHK...",
  "..KHhhhhhhhHK...",
  ".KHVVVVVVVVVHK..",
  ".KHVEEKVKEEVHK..",
  ".KHVVVVVVVVVHK..",
  "..KHhhhhhhhHK...",
  "...KHHHHHHHK....",
  "...KBBBBBBBK....",
  "..KGBbbbbbBGK...",
  "..KGBbbbbbBGK...",
  "...KBB.K.BBK....",
  "..KGGGK.KGGGK...",
];

const PICK_MAP = [
  "......KXX.",
  ".....KXXXK",
  "....KXXKK.",
  "...KXXK...",
  "..KPXK.X..",
  ".KPPK..XK.",
  "KPPK......",
  "KPK.......",
  "KK........",
  "..........",
];

const CRACK_LIGHT_MAP = [
  "................",
  "................",
  "......C.........",
  ".....C..........",
  "......C.........",
  ".......C........",
  "......C.........",
  "................",
  "..........C.....",
  ".........C......",
  "..........C.....",
  "................",
  "................",
  "................",
  "................",
  "................",
];

const CRACK_HEAVY_MAP = [
  "................",
  "..C.............",
  "...C..C.....C...",
  "....CC.....C....",
  "...C..C...C.....",
  "..C....C.C......",
  ".C......C.......",
  "........C.C.....",
  ".....C.C...C....",
  "....C.C.....C...",
  "...C...C.....C..",
  "..C.....C.....C.",
  ".C.......C......",
  "..........C.....",
  "................",
  "................",
];

const BOOM_FRAMES = [
  [
    "...Y...",
    "..YwY..",
    ".YwwwY.",
    "YwwWwwY",
    ".YwwwY.",
    "..YwY..",
    "...Y...",
  ],
  [
    "....O......",
    "..O.Y.O....",
    ".O.YwY.O...",
    "..YwwwY....",
    "O.YwWwY..O.",
    "..YwwwY....",
    ".O.YwY.O...",
    "..O.Y.O....",
    "....O......",
    "...........",
    "...........",
  ],
  [
    ".....R.........",
    "...R...R...R...",
    "..R..O.O..R....",
    ".....O.O.......",
    "..R.O...O.R....",
    ".R..........R..",
    "....O...O......",
    ".R...O.O....R..",
    "..R.......R....",
    "...R...R.......",
    ".....R.........",
    "...............",
    "...............",
    "...............",
    "...............",
  ],
];

const BLOCK_MAP = [
  "TTTTTTTTTTTTTTTD",
  "TSSSSSSSSSSSSSsD",
  "TSSSSSoOSSSSSSsD",
  "TSSSSOOOOSSSSSsD",
  "TSSSSsOOsSSSSSsD",
  "TSsSSSSSSSSoOSsD",
  "TSSSSSSSSSOOOosD",
  "TSSoOSSSSSsOOssD",
  "TSOOOoSSSSSSSSsD",
  "TSsOOsSSSSSSSSsD",
  "TSSSSSSSoOSSSSsD",
  "TSSSSSSOOOoSSSsD",
  "TSSSSSSsOOsSSSsD",
  "TSsOOoSSSSSSSSsD",
  "TssssssssssssssD",
  "DDDDDDDDDDDDDDDD",
];

const DEAD_BLOCK_MAP = [
  "DDDDDDDDDDDDDDDD",
  "DKKKKKKKKKKKKKKD",
  "DKKKCKKKKKKKKKKD",
  "DKKKKCKKKKKCKKKD",
  "DKKKKKCKKKCKKKKD",
  "DKKKKKKCKCKKKKKD",
  "DKKKKKKKCKKKKKKD",
  "DKKKKKKCKCKKKKKD",
  "DKKKKKCKKKCKKKKD",
  "DKKKKCKKKKKCKKKD",
  "DKKKCKKKKKKKCKKD",
  "DKKrKKKKKKKKKKKD",
  "DKrrrKKKKKrKKKKD",
  "DKrrrrKKKrrrKKKD",
  "DrrrrrrKrrrrrKKD",
  "DDDDDDDDDDDDDDDD",
];

const DEAD_CRYSTAL_MAP = [
  "DDDDDDDDDDDDDDDD",
  "DKKKKKKKKKKKKKKD",
  "DKKKCKKKKKKKKKKD",
  "DKKKKKKKKKKCKKKD",
  "DKKKKKKKKKKKKKKD",
  "DKKKKKKKKXKKKKKD",
  "DKKKKKKKXXxKKKKD",
  "DKKKKKKKXxxKKKKD",
  "DKKKKKKXXxxxKKKD",
  "DKKKKKKKxxKKKKKD",
  "DKKKCKKKKKKKCKKD",
  "DKKKKKKKKKKKKKKD",
  "DKKrKKKKKKKKKKKD",
  "DKrrrKKKKKrKKKKD",
  "DrrrrrKKKrrrKKKD",
  "DDDDDDDDDDDDDDDD",
];

const BOMB_MAP = [
  ".......Ff.....",
  "......fF......",
  ".....ff.......",
  "....KKK.......",
  "..KKKKKKKK....",
  ".KKWWKKKKKK...",
  ".KWWKKKKKKKk..",
  "KKWKKKKKKKKKk.",
  "KKKKKKKKKKKKk.",
  "KKKKKKKKKKKkk.",
  ".KKKKKKKKKkk..",
  ".KKKKKKKkkk...",
  "..KKkkkkk.....",
  "..............",
];

const HOUSE_MAP = [
  "......RR......",
  ".....RRRR.....",
  "....RRrrRR....",
  "...RRrrrrRR...",
  "..RRrrrrrrRR..",
  ".RRrrrrrrrrRR.",
  "..WWWWWWWWWW..",
  "..WYYWWWWWWW..",
  "..WYYWWDDDWW..",
  "..WWWWWDdDWW..",
  "..WWWWWDdDWW..",
  "..............",
];

const SPARK_MAP = [
  "....Y....",
  "....y....",
  "..y.Y.y..",
  "...YYY...",
  "YyYYYYYyY",
  "...YYY...",
  "..y.Y.y..",
  "....y....",
  "....Y....",
];

const CHEST_MAP = [
  "................",
  "...KKKKKKKKKK...",
  "..KGGGGGGGGGGK..",
  ".KGggggggggggGK.",
  ".KWKKKKKKKKKKWK.",
  ".KWWWWWWWWWWWWK.",
  ".KWwwwwwwwwwwWK.",
  "KGGGGGGGGGGGGGGK",
  "KGgggggLLgggggGK",
  "KWWWWWWLLWWWWWWK",
  "KWwwwwwLLwwwwwWK",
  "KWwwwwwwwwwwwwWK",
  "KWwwwwwwwwwwwwWK",
  "KKKKKKKKKKKKKKKK",
  "................",
  "................",
];

const COIN_MAP = [
  "....KKKK....",
  "..KKGGGGKK..",
  ".KGHHGGGGGK.",
  ".KGHGBBBGGK.",
  "KGGGGBGBGGGK",
  "KGGGGBBBGGGK",
  "KGGGGBGBGGGK",
  ".KGGGBBBGGK.",
  ".KGGGGGGGgK.",
  "..KKGggggK..",
  "....KKKK....",
  "............",
];

const ETH_MAP = [
  "....KK....",
  "...KHHK...",
  "..KHDDdK..",
  ".KHDDDddK.",
  "KHDDDDdddK",
  ".KDDDDddK.",
  "..KDDddK..",
  "...KDdK...",
  "....KK....",
  "..........",
];

/** Deterministic PRNG (mulberry32) — same seed as the Phaser cave tile. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function caveRows() {
  const rand = mulberry32(77);
  const rows = [];
  for (let y = 0; y < 32; y++) {
    let row = "";
    for (let x = 0; x < 32; x++) {
      const r = rand();
      row += r < 0.05 ? "k" : r < 0.11 ? "d" : "c";
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- sprite list

const ORE_BY_TIER = [0xffca28, 0x4fc3f7, 0xef5350]; // gold, ice, magma
const STONE_BY_TIER = [0x8d6e63, 0x78909c, 0x5d4037];

const SPRITES = [];

for (let rarity = 0; rarity < 6; rarity++) {
  const c = RARITY_COLORS[rarity];
  SPRITES.push({ name: `hero_${rarity}`, source: "HERO_MAP", rows: HERO_MAP, scale: 4, palette: {
    K: 0x10141f, L: 0xffee58, l: 0xfff9c4, H: c, h: shade(c, 0.72), V: 0x1d2731, E: 0x80deea,
    B: shade(c, 0.62), b: shade(c, 0.45), G: 0x37474f, X: 0xcfd8dc, P: 0x8d6e63,
  } });
}
for (let tier = 0; tier < 3; tier++) {
  const stone = STONE_BY_TIER[tier], ore = ORE_BY_TIER[tier];
  SPRITES.push({ name: `block_${tier}`, source: "BLOCK_MAP", rows: BLOCK_MAP, scale: 4, palette: {
    T: shade(stone, 1.25), D: shade(stone, 0.45), S: stone, s: shade(stone, 0.8), O: ore, o: shade(ore, 1.35),
  } });
}
SPRITES.push({ name: "block_dead", source: "DEAD_BLOCK_MAP", rows: DEAD_BLOCK_MAP, scale: 4, palette: {
  D: 0x1c2333, K: 0x263238, C: 0x10141f, r: 0x37474f,
} });
SPRITES.push({ name: "block_dead2", source: "DEAD_CRYSTAL_MAP", rows: DEAD_CRYSTAL_MAP, scale: 4, palette: {
  D: 0x1c2333, K: 0x263238, C: 0x10141f, r: 0x37474f, X: 0x80deea, x: 0x26a6b8,
} });
SPRITES.push({ name: "bomb", source: "BOMB_MAP", rows: BOMB_MAP, scale: 2, palette: {
  F: 0xffa726, f: 0xff7043, K: 0x212121, k: 0x000000, W: 0x607d8b,
} });
SPRITES.push({ name: "house", source: "HOUSE_MAP", rows: HOUSE_MAP, scale: 2, palette: {
  R: 0xbf360c, r: 0xe64a19, W: 0xbcaaa4, Y: 0xffe082, D: 0x4e342e, d: 0x6d4c41,
} });
SPRITES.push({ name: "spark", source: "SPARK_MAP", rows: SPARK_MAP, scale: 2, palette: { Y: 0xffee58, y: 0xfff9c4 } });
SPRITES.push({ name: "chest", source: "CHEST_MAP", rows: CHEST_MAP, scale: 4, palette: {
  K: 0x10141f, W: 0x8d6e63, w: 0x6d4c41, G: 0xffca28, g: 0xf9a825, L: 0x455a64,
} });
SPRITES.push({ name: "coin", source: "COIN_MAP", rows: COIN_MAP, scale: 3, palette: {
  K: 0x8d6a10, G: 0xffca28, g: 0xf9a825, H: 0xfff59d, B: 0x6d4c00,
} });
SPRITES.push({ name: "eth", source: "ETH_MAP", rows: ETH_MAP, scale: 3, palette: {
  K: 0x1a2233, D: 0x627eea, d: 0x3c5ac8, H: 0xb6c4f5,
} });
SPRITES.push({ name: "pick", source: "PICK_MAP", rows: PICK_MAP, scale: 3, palette: { K: 0x10141f, X: 0xcfd8dc, P: 0x8d6e63 } });
SPRITES.push({ name: "crack_1", source: "CRACK_LIGHT_MAP", rows: CRACK_LIGHT_MAP, scale: 4, palette: { C: 0x10141f } });
SPRITES.push({ name: "crack_2", source: "CRACK_HEAVY_MAP", rows: CRACK_HEAVY_MAP, scale: 4, palette: { C: 0x10141f } });
BOOM_FRAMES.forEach((frame, i) =>
  SPRITES.push({ name: `boom_${i}`, source: `BOOM_FRAMES[${i}]`, rows: frame, scale: 3, palette: {
    w: 0xfff9c4, W: 0xffffff, Y: 0xffee58, O: 0xffa726, R: 0xef5350,
  } })
);
SPRITES.push({ name: "cave", source: "caveRows() seed 77", rows: caveRows(), scale: 2, palette: {
  c: 0x141a27, d: 0x111624, k: 0x1c2434,
} });

// ---------------------------------------------------------------- main

mkdirSync(OUT, { recursive: true });
const manifest = { generatedFrom: "client/src/art/pixelart.ts", generator: "godot/tools/gen-sprites.mjs", sprites: {} };
for (const s of SPRITES) {
  const { W, H, px, nativeW, nativeH } = render(s.rows, s.palette, s.scale);
  const file = `${s.name}.png`;
  writeFileSync(join(OUT, file), encodePng(W, H, px));
  manifest.sprites[s.name] = { file, width: W, height: H, scale: s.scale, nativeWidth: nativeW, nativeHeight: nativeH, source: s.source };
  console.log(`${file.padEnd(18)} ${String(W).padStart(3)}x${String(H).padEnd(3)} (native ${nativeW}x${nativeH} @${s.scale}x)`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${SPRITES.length} sprites → ${OUT}`);

// ---------------------------------------------------------------- FX textures
// Procedural helper textures for the Godot effects layer (particles, glows,
// rings). Always regenerated — deterministic, so a re-run leaves git clean;
// `--fx` is accepted for compatibility with the tool scripts.

const FX_OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "fx");
mkdirSync(FX_OUT, { recursive: true });

/** Builds a W×H RGBA buffer from a per-pixel function returning [r, g, b, a] (0..255). */
function pixels(W, H, fn) {
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * W + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return px;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** Soft radial white blob: alpha = (1 - d/r)^power. */
const radial = (size, power) => pixels(size, size, (x, y) => {
  const c = (size - 1) / 2;
  const d = Math.hypot(x - c, y - c) / (size / 2);
  return [255, 255, 255, Math.round(255 * Math.pow(clamp01(1 - d), power))];
});

const FX = [
  ["px_1", 1, 1, () => [255, 255, 255, 255]],
  ["debris_4", 4, 4, (x, y) => (x === 3 && y === 3 ? [200, 200, 200, 255] : [255, 255, 255, 255])],
  ["dust_8", 8, 8, (x, y) => [255, 255, 255,
    Math.round(255 * Math.pow(clamp01(1 - Math.hypot(x - 3.5, y - 3.5) / 4), 1.5))]],
  // ~2 px soft ring at radius 29 (of 32) — scaled up by the explosion tween
  ["ring_64", 64, 64, (x, y) => [255, 255, 255,
    Math.round(255 * clamp01(1 - Math.abs(Math.hypot(x - 31.5, y - 31.5) - 29) / 1.5))]],
];
for (const [name, W, H, fn] of FX) {
  writeFileSync(join(FX_OUT, `${name}.png`), encodePng(W, H, pixels(W, H, fn)));
}
writeFileSync(join(FX_OUT, "glow_64.png"), encodePng(64, 64, radial(64, 1.8)));
writeFileSync(join(FX_OUT, "glow_128.png"), encodePng(128, 128, radial(128, 1.8)));
{
  // native-size coin for particle bursts
  const { W, H, px } = render(COIN_MAP, { K: 0x8d6a10, G: 0xffca28, g: 0xf9a825, H: 0xfff59d, B: 0x6d4c00 }, 1);
  writeFileSync(join(FX_OUT, "coin_small.png"), encodePng(W, H, px));
}
{
  // "z" glyph for resting heroes (replaces the ⛏/⌂-style text glyphs)
  const ZZZ = ["ZZZZZ..", "....Z..", "...Z...", "..Z....", ".Z.....", "ZZZZZ..", "......."];
  const { W, H, px } = render(ZZZ, { Z: 0x90a4ae }, 1);
  writeFileSync(join(FX_OUT, "zzz.png"), encodePng(W, H, px));
}
console.log(`8 fx textures → ${FX_OUT}`);
