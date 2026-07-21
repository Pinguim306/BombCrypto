import Phaser from "phaser";

/**
 * Original procedural art for MinerBlast.
 *
 * All sprites are drawn pixel by pixel from character maps defined here
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
  const g = scene.add.graphics();
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (color === undefined) return; // '.' and unknowns = transparent
      g.fillStyle(color, 1);
      g.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
    });
  });
  g.generateTexture(key, rows[0].length * pixelSize, rows.length * pixelSize);
  g.destroy();
}

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

export const RARITY_COLORS = [0x9e9e9e, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xffa726, 0xef5350];

/** Miner with helmet and visor — 14x16, colors by rarity. */
const HERO_MAP = [
  "......LL......",
  "......LL......",
  "....HHHHHH....",
  "...HHHHHHHH...",
  "..HHHHHHHHHH..",
  "..HVVVVVVVVH..",
  "..HVEEVVEEVH..",
  "..HVVVVVVVVH..",
  "...HHHHHHHH...",
  "....BBBBBB....",
  "..GBBBBBBBBG..",
  "..GBBBBBBBBG..",
  "...BBBBBBBB...",
  "....BB..BB....",
  "...GGG..GGG...",
  "..............",
];

/** Ore block — 16x16; O = ore vein colored by hardness. */
const BLOCK_MAP = [
  "DDDDDDDDDDDDDDDD",
  "DSSSSSSSSSSSSSSD",
  "DSSSSSOOSSSSSSSD",
  "DSSSSOOOOSSSSSSD",
  "DSSSSSOOSSSSSSSD",
  "DSSSSSSSSSSOOSSD",
  "DSSSSSSSSSOOOOSD",
  "DSSOOSSSSSSOOSSD",
  "DSOOOOSSSSSSSSSD",
  "DSSOOSSSSSSSSSSD",
  "DSSSSSSSOOSSSSSD",
  "DSSSSSSOOOOSSSSD",
  "DSSSSSSSOOSSSSSD",
  "DSSOOSSSSSSSSSSD",
  "DSSSSSSSSSSSSSSD",
  "DDDDDDDDDDDDDDDD",
];

/** Depleted block — cracks over dark stone. */
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
  "DKKKKKKKKKKKKKKD",
  "DKKCKKKKKKKKKKKD",
  "DKKKKKKKKKKCKKKD",
  "DKKKKKKKKKKKKKKD",
  "DDDDDDDDDDDDDDDD",
];

/** Round bomb with fuse. */
const BOMB_MAP = [
  "......FF....",
  ".....FF.....",
  "....KK......",
  "..KKKKKKK...",
  ".KKKKKKKKK..",
  ".KKWWKKKKK..",
  "KKWWKKKKKKK.",
  "KKWKKKKKKKK.",
  ".KKKKKKKKK..",
  ".KKKKKKKKK..",
  "..KKKKKKK...",
  "............",
];

/** Rest house — roof, wall and door. */
const HOUSE_MAP = [
  "......RR......",
  ".....RRRR.....",
  "....RRRRRR....",
  "...RRRRRRRR...",
  "..RRRRRRRRRR..",
  ".RRRRRRRRRRRR.",
  "..WWWWWWWWWW..",
  "..WWWWWWWWWW..",
  "..WWWDDDWWWW..",
  "..WWWDDDWWWW..",
  "..WWWDDDWWWW..",
  "..............",
];

/** Sparkle star for explosions/rewards. */
const SPARK_MAP = [
  "....Y....",
  "....Y....",
  "..Y.Y.Y..",
  "...YYY...",
  "YYYYYYYYY",
  "...YYY...",
  "..Y.Y.Y..",
  "....Y....",
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
      L: 0xffee58, // helmet lamp
      H: c,
      V: 0x263238,
      E: 0x80deea,
      B: shade(c, 0.65),
      G: 0x37474f,
    }, P);
  }

  for (let tier = 0; tier < 3; tier++) {
    const stone = [0x8d6e63, 0x78909c, 0x5d4037][tier];
    makeTexture(scene, `block-${tier}`, BLOCK_MAP, {
      D: shade(stone, 0.55),
      S: stone,
      O: ORE_BY_TIER[tier],
    }, P);
  }

  makeTexture(scene, "block-dead", DEAD_BLOCK_MAP, {
    D: 0x1c2333,
    K: 0x263238,
    C: 0x10141f,
  }, P);

  makeTexture(scene, "bomb", BOMB_MAP, {
    F: 0xffa726,
    K: 0x212121,
    W: 0x546e7a,
  }, 2);

  makeTexture(scene, "house", HOUSE_MAP, {
    R: 0xbf360c,
    W: 0xbcaaa4,
    D: 0x4e342e,
  }, 2);

  makeTexture(scene, "spark", SPARK_MAP, { Y: 0xffee58 }, 2);
}
