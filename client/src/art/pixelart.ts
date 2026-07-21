import Phaser from "phaser";

/**
 * Original procedural art for MinerBlast (v2 — outlined & shaded).
 *
 * All sprites are drawn pixel by pixel from character maps designed here
 * (no external assets). Final art from an artist will replace these
 * textures without code changes: just keep the same texture keys.
 */

type Palette = Record<string, number>;

/** Draws a pixel map and registers it as texture `key`. */
function makeTexture(
  scene: Phaser.Scene,
  key: string,
  rows: string[],
  palette: Palette,
  pixelSize = 1
): void {
  if (scene.textures.exists(key)) return;
  const width = Math.max(...rows.map((r) => r.length));
  const g = scene.add.graphics();
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (color === undefined) return; // '.' and unknowns = transparent
      g.fillStyle(color, 1);
      g.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
    });
  });
  g.generateTexture(key, width * pixelSize, rows.length * pixelSize);
  g.destroy();
}

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

export const RARITY_COLORS = [0x9e9e9e, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xffa726, 0xef5350];

/**
 * Miner hero — 16x16, dark outline, shaded helmet with head-lamp and a
 * glowing visor. The pickaxe is a separate `pick` texture so the scene can
 * swing it while the hero works. K outline, L lamp, l lamp glow, H helmet,
 * h helmet shade, V visor, E eyes, B body, b body shade, G gear.
 */
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

/** Pickaxe — 10x10 diagonal, steel head and wooden handle. */
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

/** Progressive crack overlays for damaged blocks (transparent elsewhere). */
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

/** Explosion frames — expanding burst (w flash, Y core, O mid, R outer). */
const BOOM_FRAMES: string[][] = [
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

/**
 * Ore block — 16x16 with beveled edges (light top-left, dark bottom-right)
 * and clustered ore veins with highlights. T top bevel, D dark bevel,
 * S stone, s stone shade, O ore, o ore highlight.
 */
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

/** Depleted block — collapsed rubble over dark stone. */
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

/** Round bomb — shine, rim light and a lit fuse. K body, k rim, W shine,
 *  F fuse spark, f fuse cord. */
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

/** Rest house — shaded roof, walls, door and a lit window. */
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

/** Sparkle star for explosions/rewards. */
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

/** Treasure chest (closed) — wooden body, gold bands, lock. K outline,
 *  W wood, w wood shade, G gold band, g gold shade, L lock, . transparent. */
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

/** BLAST coin — gold disc with a bold "B". K outline, G gold, g shade,
 *  H highlight, B letter. */
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

/** ETH diamond — for ETH-priced buttons. K outline, D diamond, d shade, H shine. */
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

/** Block hardness (0 soft, 1 medium, 2 hard) from max HP. */
export function blockTier(maxHp: number): number {
  return maxHp >= 90 ? 2 : maxHp >= 50 ? 1 : 0;
}

/** Deterministic PRNG (mulberry32) for the cave background speckles. */
function localRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32x32 cave rock tile: subtle speckled darkness behind the mining grid. */
function caveRows(): string[] {
  const rand = localRng(77);
  const rows: string[] = [];
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

const ORE_BY_TIER = [0xffca28, 0x4fc3f7, 0xef5350]; // gold, ice, magma

/** Generates all game textures (idempotent per scene/game). */
export function registerPixelArt(scene: Phaser.Scene): void {
  const P = 4; // pixel scale

  for (let rarity = 0; rarity < 6; rarity++) {
    const c = RARITY_COLORS[rarity];
    makeTexture(scene, `hero-${rarity}`, HERO_MAP, {
      K: 0x10141f, // outline
      L: 0xffee58, // head-lamp
      l: 0xfff9c4, // lamp glow
      H: c,
      h: shade(c, 0.72),
      V: 0x1d2731,
      E: 0x80deea,
      B: shade(c, 0.62),
      b: shade(c, 0.45),
      G: 0x37474f,
      X: 0xcfd8dc, // pick head
      P: 0x8d6e63, // pick handle
    }, P);
  }

  for (let tier = 0; tier < 3; tier++) {
    const stone = [0x8d6e63, 0x78909c, 0x5d4037][tier];
    const ore = ORE_BY_TIER[tier];
    makeTexture(scene, `block-${tier}`, BLOCK_MAP, {
      T: shade(stone, 1.25),
      D: shade(stone, 0.45),
      S: stone,
      s: shade(stone, 0.8),
      O: ore,
      o: shade(ore, 1.35),
    }, P);
  }

  makeTexture(scene, "block-dead", DEAD_BLOCK_MAP, {
    D: 0x1c2333,
    K: 0x263238,
    C: 0x10141f,
    r: 0x37474f, // rubble
  }, P);

  makeTexture(scene, "bomb", BOMB_MAP, {
    F: 0xffa726,
    f: 0xff7043,
    K: 0x212121,
    k: 0x000000,
    W: 0x607d8b,
  }, 2);

  makeTexture(scene, "house", HOUSE_MAP, {
    R: 0xbf360c,
    r: 0xe64a19,
    W: 0xbcaaa4,
    Y: 0xffe082, // lit window
    D: 0x4e342e,
    d: 0x6d4c41,
  }, 2);

  makeTexture(scene, "spark", SPARK_MAP, { Y: 0xffee58, y: 0xfff9c4 }, 2);

  makeTexture(scene, "chest", CHEST_MAP, {
    K: 0x10141f,
    W: 0x8d6e63,
    w: 0x6d4c41,
    G: 0xffca28,
    g: 0xf9a825,
    L: 0x455a64,
  }, 4);

  makeTexture(scene, "coin", COIN_MAP, {
    K: 0x8d6a10,
    G: 0xffca28,
    g: 0xf9a825,
    H: 0xfff59d,
    B: 0x6d4c00,
  }, 3);

  makeTexture(scene, "eth", ETH_MAP, {
    K: 0x1a2233,
    D: 0x627eea,
    d: 0x3c5ac8,
    H: 0xb6c4f5,
  }, 3);

  makeTexture(scene, "pick", PICK_MAP, {
    K: 0x10141f,
    X: 0xcfd8dc,
    P: 0x8d6e63,
  }, 3);

  makeTexture(scene, "crack-1", CRACK_LIGHT_MAP, { C: 0x10141f }, 4);
  makeTexture(scene, "crack-2", CRACK_HEAVY_MAP, { C: 0x10141f }, 4);

  BOOM_FRAMES.forEach((frame, i) =>
    makeTexture(scene, `boom-${i}`, frame, {
      w: 0xfff9c4,
      W: 0xffffff,
      Y: 0xffee58,
      O: 0xffa726,
      R: 0xef5350,
    }, 3)
  );

  makeTexture(scene, "cave", caveRows(), {
    c: 0x141a27,
    d: 0x111624,
    k: 0x1c2434,
  }, 2);
}
