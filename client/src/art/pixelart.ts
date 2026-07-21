import Phaser from "phaser";

/**
 * Arte procedural original do MinerBlast.
 *
 * Todos os sprites são desenhados pixel a pixel a partir de mapas de
 * caracteres definidos aqui (nenhum asset externo). A arte final de um
 * artista substituirá estas texturas sem mudanças de código: basta manter
 * as mesmas chaves de textura.
 */

type Palette = Record<string, number>;

/** Desenha um mapa de pixels e registra como textura `key`. */
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
      if (color === undefined) return; // '.' e desconhecidos = transparente
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

/** Minerador com capacete e visor — 14x16, cores por raridade. */
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

/** Bloco de minério — 16x16; O = veio de minério colorido por dureza. */
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

/** Bloco esgotado — rachaduras sobre pedra escura. */
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

/** Bomba redonda com pavio. */
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

/** Casinha de descanso — telhado, parede e porta. */
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

/** Estrela de brilho para explosões/recompensas. */
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

/** Dureza do bloco (0 macio, 1 médio, 2 duro) a partir do HP máximo. */
export function blockTier(maxHp: number): number {
  return maxHp >= 90 ? 2 : maxHp >= 50 ? 1 : 0;
}

const ORE_BY_TIER = [0xffca28, 0x4fc3f7, 0xef5350]; // ouro, gelo, magma

/** Gera todas as texturas do jogo (idempotente por cena/jogo). */
export function registerPixelArt(scene: Phaser.Scene): void {
  const P = 4; // escala do pixel

  for (let rarity = 0; rarity < 6; rarity++) {
    const c = RARITY_COLORS[rarity];
    makeTexture(scene, `hero-${rarity}`, HERO_MAP, {
      L: 0xffee58, // luz do capacete
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
