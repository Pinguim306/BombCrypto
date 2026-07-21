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
 * Miner hero — 16x16, dark outline, shaded helmet with head-lamp, glowing
 * visor and a pickaxe on the back. K outline, L lamp, l lamp glow,
 * H helmet, h helmet shade, V visor, E eyes, B body, b body shade,
 * G gear (gloves/boots), X pick head, P pick handle.
 */
const HERO_MAP = [
  "......KKK.......",
  ".....KlLlK......",
  "....KKKKKKK.....",
  "...KHHHHHHHK.X..",
  "..KHHHHHHHHHKXP.",
  "..KHhhhhhhhHKP..",
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

/** Block hardness (0 soft, 1 medium, 2 hard) from max HP. */
export function blockTier(maxHp: number): number {
  return maxHp >= 90 ? 2 : maxHp >= 50 ? 1 : 0;
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
}
