/**
 * ui.mjs — MinerBlast ui/ placeholder art (see CONTRACT.md, ui/).
 *
 * 9-slice panels (all detail lives in the margins, the centre is a plain
 * repeatable fill), chunky buttons, a red ribbon, 16×16 icons and the
 * "MINERBLAST" logo in a custom bold pixel face. Deterministic (`rng` only).
 */
import { join } from "node:path";
import { Canvas, OUTLINE, ramp, mix, rng, savePng } from "./lib.mjs";

// ---------------------------------------------------------------- palette

const GOLD = { dark2: 0x7a4c05, dark: 0xb8860b, base: 0xffca28, light: 0xffe082, light2: 0xfff6c8 };
const WOOD = { seam: 0x3d2412, rimDark: 0x2e1a0c, rim: 0x4a2f18, rimLight: 0x6b4423, dark: 0x7a4a26, grain: 0x8b5a2b, base: 0xa0673a, light: 0xbb7c4a, light2: 0xd49a5f };
const NAVY = { outline: OUTLINE, rim: 0x334060, shadow: 0x0c1019, shadow2: 0x121828, base: 0x1a2233, light: 0x263049 };
const RED = ramp(0xc62828);
const STEEL = { dark: 0x607d8b, base: 0xb0bec5, light: 0xeceff1 };

const BTN_COLORS = { green: 0x43a047, blue: 0x1e88e5, red: 0xe53935, gray: 0x7d848f, gold: 0xf9a825, teal: 0x00897b };

// ---------------------------------------------------------------- 9-slice panels

function panelWood() {
  const c = new Canvas(48, 48);
  const r = rng(101);
  // boards: top 3..9, seam 10, middle 11..36 (lit top row 11, dark bottom row 36), seam 37, bottom 38..44
  c.fillRect(3, 3, 42, 42, WOOD.base);
  const board = (y0, y1) => {
    c.fillRect(3, y0, 42, y1 - y0 + 1, WOOD.base);
    c.hline(3, 44, y0, WOOD.light);
    c.hline(3, 44, y1, WOOD.dark);
  };
  board(3, 9); board(11, 36); board(38, 44);
  c.hline(3, 44, 10, WOOD.seam); c.hline(3, 44, 37, WOOD.seam);
  // middle board: very gentle vertical gradient (stretches cleanly)
  for (let y = 12; y <= 35; y++) c.hline(3, 44, y, mix(0xa46b3c, 0x9c6236, (y - 12) / 23));
  // grain dashes on the top/bottom boards (horizontal → safe in the top/bottom edges)
  for (const [y0, y1] of [[4, 8], [39, 43]]) {
    for (let i = 0; i < 6; i++) {
      const x = r.int(4, 36), len = r.int(3, 9), y = r.int(y0, y1);
      c.hline(x, Math.min(43, x + len), y, r.chance(0.6) ? WOOD.grain : WOOD.light, 150);
    }
    // a knot
    const kx = r.int(14, 30), ky = y0 + 2;
    c.hline(kx, kx + 2, ky, WOOD.dark); c.set(kx + 1, ky, WOOD.grain); c.hline(kx - 1, kx + 3, ky + 1, WOOD.grain, 120);
  }
  // left/right bevel of the boards (vertical lines → safe in the side edges)
  c.vline(3, 3, 44, WOOD.light, 160);
  c.vline(44, 3, 44, WOOD.dark, 160);
  // dark rim (2 px) + outline
  c.strokeRect(1, 1, 46, 46, WOOD.rim);
  c.strokeRect(2, 2, 44, 44, WOOD.rim);
  c.hline(1, 46, 1, WOOD.rimLight); c.vline(1, 1, 46, WOOD.rimLight);
  c.hline(1, 46, 46, WOOD.rimDark); c.vline(46, 1, 46, WOOD.rimDark);
  c.strokeRect(0, 0, 48, 48, OUTLINE);
  // brass corner rivets (inside the 12 px corners)
  for (const [x, y] of [[4, 4], [41, 4], [4, 41], [41, 41]]) rivet(c, x, y);
  return { c, margins: [12, 12, 12, 12] };
}

function rivet(c, x, y) {
  // 3×3 dome with a dark ring
  c.strokeRect(x - 1, y - 1, 5, 5, WOOD.seam);
  c.set(x - 1, y - 1, null); // corners of the ring stay wood
  c.fillRect(x, y, 3, 3, GOLD.base);
  c.set(x, y, GOLD.light2); c.set(x + 1, y, GOLD.light); c.set(x, y + 1, GOLD.light);
  c.set(x + 2, y + 2, GOLD.dark); c.set(x + 2, y + 1, GOLD.dark); c.set(x + 1, y + 2, GOLD.dark);
  // restore ring corners to plain wood (rounder rivet)
  for (const [dx, dy] of [[-1, -1], [3, -1], [-1, 3], [3, 3]]) c.set(x + dx, y + dy, WOOD.base);
}

function panelDark() {
  const c = new Canvas(48, 48);
  c.fillRect(0, 0, 48, 48, NAVY.base);
  // inset: shadow on the top/left, soft light on the bottom/right
  c.hline(2, 45, 2, NAVY.shadow); c.vline(2, 2, 45, NAVY.shadow);
  c.hline(3, 45, 3, NAVY.shadow2); c.vline(3, 3, 45, NAVY.shadow2);
  c.hline(2, 45, 45, NAVY.light); c.vline(45, 2, 45, NAVY.light);
  c.strokeRect(1, 1, 46, 46, NAVY.rim);
  c.strokeRect(0, 0, 48, 48, OUTLINE);
  return { c, margins: [8, 8, 8, 8] };
}

function frameGold() {
  const c = new Canvas(48, 48);
  const W = 9; // border width incl. both outlines
  // profiles from the outer edge inward (top/left = lit, bottom/right = shaded)
  // outer bead (lit), a dark groove, the wide flat band, then the inner lip (shaded)
  const lit = [OUTLINE, GOLD.dark, GOLD.light2, GOLD.light, GOLD.dark2, GOLD.base, GOLD.base, GOLD.dark, OUTLINE];
  const shaded = [OUTLINE, GOLD.dark2, GOLD.dark, GOLD.base, GOLD.dark2, GOLD.base, GOLD.light, GOLD.light2, OUTLINE];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const dl = x, dt = y, dr = 47 - x, db = 47 - y;
    const d = Math.min(dl, dt, dr, db);
    if (d >= W) continue;                     // transparent centre
    // which edge owns this pixel (mitre at the corners)
    let col;
    if (dt <= dl && dt <= dr && dt <= db) col = lit[dt];
    else if (dl <= dr && dl <= db) col = lit[dl];
    else if (db <= dr) col = shaded[db];
    else col = shaded[dr];
    c.set(x, y, col);
  }
  // corner ornaments: raised square boss with a ruby, flanked by small studs along both edges
  for (const [x, y, sx, sy] of [[1, 1, 1, 1], [38, 1, -1, 1], [1, 38, 1, -1], [38, 38, -1, -1]]) {
    c.roundRect(x, y, 9, 9, GOLD.dark, 2);
    c.roundRect(x + 1, y + 1, 7, 7, GOLD.base, 2);
    c.hline(x + 2, x + 6, y + 1, GOLD.light2); c.vline(x + 1, y + 2, y + 6, GOLD.light2);
    c.hline(x + 2, x + 6, y + 7, GOLD.dark2); c.vline(x + 7, y + 2, y + 6, GOLD.dark2);
    c.fillRect(x + 3, y + 3, 3, 3, 0xb71c1c);
    c.set(x + 3, y + 3, 0xff8a80); c.set(x + 4, y + 4, 0xe53935);
    c.strokeRect(x - 1, y - 1, 11, 11, OUTLINE);
    // tiny bead at the inner corner of the boss (toward the frame's centre) — stays inside the 12 px corner
    const bx = sx > 0 ? x + 10 : x - 2, by = sy > 0 ? y + 10 : y - 2;
    c.set(bx, by, GOLD.light2);
  }
  c.strokeRect(0, 0, 48, 48, OUTLINE);
  // clear anything that leaked into the transparent centre
  for (let y = W; y < 48 - W; y++) for (let x = W; x < 48 - W; x++) { const i = (y * 48 + x) * 4; c.px[i] = c.px[i + 1] = c.px[i + 2] = c.px[i + 3] = 0; }
  return { c, margins: [12, 12, 12, 12] };
}

function plate() {
  const c = new Canvas(48, 32);
  c.roundRect(0, 0, 48, 32, OUTLINE, 3);
  c.roundRect(1, 1, 46, 30, GOLD.dark, 3);
  c.roundRect(2, 2, 44, 28, GOLD.base, 2);
  // gold bevel: lit top/left, dark bottom/right
  c.hline(3, 44, 1, GOLD.light); c.vline(1, 3, 28, GOLD.light);
  c.hline(3, 44, 30, GOLD.dark2); c.vline(46, 3, 28, GOLD.dark2);
  c.hline(4, 43, 2, GOLD.light2);
  // dark inset
  c.roundRect(3, 3, 42, 26, NAVY.base, 2);
  c.hline(4, 43, 3, NAVY.shadow); c.vline(3, 4, 27, NAVY.shadow);
  c.hline(5, 42, 4, NAVY.shadow2);
  c.hline(4, 43, 28, NAVY.light); c.vline(44, 4, 27, NAVY.light);
  return { c, margins: [10, 10, 10, 10] };
}

// ---------------------------------------------------------------- buttons

function button(color, down) {
  const c = new Canvas(48, 40);
  const P = ramp(color);
  const faceY = down ? 4 : 1, faceH = 34, edgeH = down ? 1 : 4;
  const body = new Canvas(48, 40);
  // bottom edge block, then face on top
  body.roundRect(1, faceY, 46, faceH + edgeH, P.dark2, 3);
  const face = new Canvas(48, 40);
  face.roundRect(1, faceY, 46, faceH, 0xffffff, 3);
  const inside = (x, y) => face.alpha(x, y) > 0;
  for (let y = faceY; y < faceY + faceH; y++) for (let x = 1; x < 47; x++) {
    if (!inside(x, y)) continue;
    const t = (y - faceY) / (faceH - 1);
    let col = t < 0.55 ? mix(P.light, P.base, t / 0.55) : mix(P.base, P.dark, (t - 0.55) / 0.45 * 0.6);
    const top = !inside(x, y - 1) || !inside(x, y - 2), left = !inside(x - 1, y);
    const bottom = !inside(x, y + 1), right = !inside(x + 1, y);
    if (bottom) col = P.dark;
    else if (top) col = !inside(x, y - 1) ? P.light2 : P.light;
    else if (left) col = P.light;
    else if (right) col = P.dark;
    body.set(x, y, col);
  }
  // gloss stripe under the top bevel
  body.hline(5, 42, faceY + 3, P.light2, 90);
  // edge: slightly darker last row
  body.hline(3, 44, faceY + faceH + edgeH - 1, mix(P.dark2, OUTLINE, 0.35));
  body.outline(OUTLINE);
  c.blit(body, 0, 0);
  return { c, margins: [12, 12, 12, 16] };
}

// ---------------------------------------------------------------- ribbon / frames / misc

function ribbon() {
  const c = new Canvas(96, 32);
  const body = new Canvas(96, 32);
  // tails (behind): swallow-tailed, darker red, folded where they meet the band
  const tail = (mirror) => {
    const X = (x) => (mirror ? 95 - x : x);
    body.polygon([[X(0), 9], [X(15), 9], [X(15), 30], [X(0), 30], [X(7), 19.5]].map(([x, y]) => [mirror ? x + 1 : x, y]), RED.dark);
    // deep V notch: dark inner edge, then a gold trim line following the band's trim
    for (let y = 9; y <= 30; y++) {
      const notch = Math.round(7 * (1 - Math.abs(y - 19.5) / 10.5));
      body.set(X(notch), y, RED.dark2);
      body.set(X(notch + 1), y, RED.dark2);
    }
    body.hline(X(1), X(14), 9, RED.base);
    body.hline(X(1), X(14), 10, GOLD.dark);
    body.hline(X(4), X(14), 28, GOLD.dark);
    body.hline(X(2), X(14), 29, RED.dark2);
    body.hline(X(1), X(14), 30, RED.dark2);
    // fold shadow where the tail goes behind the band
    body.fillRect(X(mirror ? 15 : 12), 9, 4, 22, RED.dark2);
  };
  tail(false); tail(true);
  // main band x 12..83, y 5..26
  body.fillRect(12, 5, 72, 22, RED.base);
  for (let y = 8; y <= 22; y++) body.hline(12, 83, y, mix(RED.light, RED.base, (y - 8) / 14));
  body.hline(12, 83, 5, RED.light2);
  body.hline(12, 83, 6, GOLD.base);
  body.hline(12, 83, 7, GOLD.dark);
  body.hline(12, 83, 23, GOLD.dark);
  body.hline(12, 83, 24, GOLD.base);
  body.hline(12, 83, 25, RED.dark);
  body.hline(12, 83, 26, RED.dark2);
  // band ends: a lit left edge, shaded right edge
  body.vline(12, 5, 26, RED.light); body.vline(83, 5, 26, RED.dark);
  body.outline(OUTLINE);
  c.blit(body, 0, 0);
  return { c, margins: [24, 8, 24, 8] };
}

function portraitFrame() {
  const c = new Canvas(40, 40);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const d = Math.min(x, y, 39 - x, 39 - y);
    if (d >= 4) continue;
    const litSide = (x <= y && x <= 39 - y) || (y <= x && y <= 39 - x);   // left or top
    const prof = litSide ? [OUTLINE, GOLD.dark, GOLD.light, GOLD.dark2] : [OUTLINE, GOLD.dark2, GOLD.base, GOLD.dark2];
    c.set(x, y, prof[d]);
  }
  // inner dark line all round so the portrait separates from the gold
  c.strokeRect(3, 3, 34, 34, GOLD.dark2);
  // corner bosses
  for (const [x, y] of [[1, 1], [36, 1], [1, 36], [36, 36]]) {
    c.fillRect(x, y, 3, 3, GOLD.base);
    c.set(x, y, GOLD.light2); c.set(x + 2, y + 2, GOLD.dark);
  }
  c.strokeRect(0, 0, 40, 40, OUTLINE);
  return { c };
}

function barFrame() {
  const c = new Canvas(24, 10);
  c.roundRect(0, 0, 24, 10, OUTLINE, 1);
  c.roundRect(1, 1, 22, 8, NAVY.rim, 1);
  c.fillRect(2, 2, 20, 6, NAVY.shadow);
  c.hline(2, 21, 7, NAVY.base);
  return { c, margins: [3, 3, 3, 3] };
}

function badge() {
  const c = new Canvas(20, 20);
  const body = new Canvas(20, 20);
  const R = ramp(0xe53935);
  body.circle(9.5, 9.5, 8.5, R.dark);
  body.circle(9.5, 9.5, 8.5, R.base);
  for (let y = 12; y < 19; y++) for (let x = 1; x < 19; x++) if (body.alpha(x, y) && body.alpha(x, y + 1 + (y - 12) / 2 | 0) === 0) body.set(x, y, R.dark);
  body.ellipse(9.5, 15, 6, 2.5, R.dark);
  body.circle(9.5, 9.5, 6, R.base);
  body.ellipse(7, 6, 3, 1.5, R.light);
  body.set(5, 5, R.light2); body.set(6, 4, R.light2);
  body.outline(OUTLINE);
  c.blit(body, 0, 0);
  return { c };
}

// ---------------------------------------------------------------- icons (14×14 maps, blitted at 1,1, outlined)

const ICON_PAL = {
  W: 0xffffff, S: STEEL.light, s: STEEL.base, d: STEEL.dark,
  w: 0xa0673a, v: 0xc98b4b, c: 0x5d3a1c, q: 0xb71c1c,
  g: GOLD.base, G: 0xfff176, y: GOLD.dark, Y: GOLD.light2,
  r: 0xe53935, R: 0xff8a80, b: 0x42a5f5, B: 0x90caf9, n: 0x1a2233,
  k: 0x3a3f4c, l: 0x7d879a, K: OUTLINE, o: 0xff9100, O: 0xffe57f,
  t: 0xf5e6c8, T: 0xcdbf9f, e: 0x66bb6a, E: 0xa5d6a7, m: 0x9fa8da, M: 0xc5cae9,
};

const ICONS = {
  pick: [
    "....sSS.......",
    "...sSSSs......",
    "...sSSSSs.....",
    "....dSSSSs....",
    ".....dSSSSs...",
    "......dSSSSs..",
    ".....v.dSSSSs.",
    "....vw..dSSSd.",
    "...vw....dSSd.",
    "..vw......dSd.",
    ".vw........d..",
    "vw............",
    "w.............",
    "..............",
  ],
  bolt: [
    "........gGGg..",
    ".......gGGg...",
    "......gGGg....",
    ".....gGGg.....",
    "....gGGGGGGg..",
    "...gGGGGGGg...",
    "......gGGy....",
    ".....gGGy.....",
    "....gGGy......",
    "...gGGy.......",
    "..gGGy........",
    ".gGy..........",
    "gy............",
    "..............",
  ],
  house: [
    "......rr......",
    ".....rRRr.....",
    "....rRRRRr....",
    "...rRRRRRRr...",
    "..rRRRRRRRRr..",
    ".rRRRRRRRRRRr.",
    "qqqqqqqqqqqqqq",
    ".vwwwwwwwwwwv.",
    ".vwwwwwccwwwv.",
    ".vwBbwwccwwwv.",
    ".vwbbwwccgwwv.",
    ".vwwwwwccwwwv.",
    ".vwwwwwccwwwv.",
    "..............",
  ],
  bomb: [
    "..........OoO.",
    ".........coOo.",
    "........cc.O..",
    ".......cc.....",
    "....kkllkk....",
    "...klSlkkkk...",
    "..klSlkkkkkk..",
    "..kllkkkkkkk..",
    "..klkkkkkkkn..",
    "..kkkkkkkknn..",
    "...kkkkkknn...",
    "....knnnnn....",
    "..............",
    "..............",
  ],
  star: [
    "......g.......",
    ".....gGg......",
    ".....gGg......",
    "....gGGGg.....",
    "ggggGGGGGgggg.",
    ".gGGGGGGGGGg..",
    "..gGGGGGGGg...",
    "...gGGGGGg....",
    "...gGGGGGg....",
    "..gGGgygGGg...",
    "..gGg.y.gGg...",
    ".gy.......yg..",
    "..............",
    "..............",
  ],
  lock: [
    "....ssss......",
    "...sSSSSs.....",
    "..sS....Ss....",
    "..sS....Ss....",
    "..sS....Ss....",
    ".ggggggggggg..",
    ".gYYGGGGGGgy..",
    ".gYGGGKGGGgy..",
    ".gGGGKKKGGgy..",
    ".gGGGGKGGGgy..",
    ".gGGGGKGGGgy..",
    ".ggggggggggy..",
    "..yyyyyyyyy...",
    "..............",
  ],
  gift: [
    "....gg..gg....",
    "...gGg..gGg...",
    "....ggggg.....",
    ".gggggYYggggg.",
    ".gGGGGYYGGGGg.",
    ".rrrrrGGrrrrr.",
    ".rRRRrGGrRRRr.",
    ".rRRRrGGrRRRr.",
    ".rrrrrGGrrrrr.",
    ".rrrrrGGrrrrr.",
    ".rrrrrGGrrrrr.",
    ".qqqqqggqqqqq.",
    "..............",
    "..............",
  ],
  adventure: [
    "..............",
    ".tttttttttttt.",
    ".tTKtttttttTt.",
    ".ttt.Ktttttt..",
    ".ttttt.KtBbtt.",
    ".tttttttKbbtt.",
    ".tttttttt.Ktt.",
    ".ttttttttt.Kt.",
    ".tttttttrtKrt.",
    ".ttttttttrrtt.",
    ".tttttttrtrrt.",
    ".tTttttttttTt.",
    ".tttttttttttt.",
    "..............",
  ],
  arrow_l: [
    "..............",
    ".....WW.......",
    "....WWW.......",
    "...WWWW.......",
    "..WWWWWWWWWWW.",
    ".WWWWWWWWWWWW.",
    "WWWWWWWWWWWWW.",
    ".WWWWWWWWWWWW.",
    "..WWWWWWWWWWW.",
    "...SSSS.......",
    "....SSS.......",
    ".....SS.......",
    "..............",
    "..............",
  ],
  close: [
    "..............",
    ".WW.......WW..",
    ".WWW.....WWW..",
    "..WWW...WWW...",
    "...WWW.WWW....",
    "....WWWWW.....",
    ".....WWW......",
    "....WWWWW.....",
    "...WWW.WWW....",
    "..WWW...WWW...",
    ".WWW.....WWW..",
    ".SS.......SS..",
    "..............",
    "..............",
  ],
  wallet: [
    "..............",
    "....EeEeEeE...",
    "....eEeEeEe...",
    ".wwwwwwwwwwww.",
    ".wvvvvvvvvvvw.",
    ".wvvvvvvvvvvw.",
    ".wvvvvvvvvvvw.",
    ".wwwwwwwwwwww.",
    ".wcccccccccww.",
    ".wcccccccccgw.",
    ".wcccccccccgw.",
    ".wcccccccccww.",
    ".wwwwwwwwwwww.",
    "..............",
  ],
};

function iconFromMap(rows, extra = null) {
  const c = new Canvas(16, 16);
  c.drawMap(rows, ICON_PAL, 1, 1);
  if (extra) extra(c);
  c.outline(OUTLINE);
  return c;
}

function iconCoin() {
  const c = new Canvas(16, 16);
  c.circle(8, 8, 6.5, GOLD.dark);
  c.circle(7.5, 7.5, 6, GOLD.base);
  c.circle(8, 8, 4.5, GOLD.dark);
  c.circle(7.7, 7.7, 3.7, GOLD.base);
  // shine
  c.set(4, 4, GOLD.light2); c.set(5, 3, GOLD.light2); c.set(3, 5, GOLD.light2); c.set(6, 3, GOLD.light); c.set(3, 6, GOLD.light);
  // "B" mark
  c.drawMap(["##.", "#.#", "##.", "#.#", "##."], { "#": GOLD.dark }, 7, 6);
  c.outline(OUTLINE);
  return c;
}

function iconSleep() {
  const c = new Canvas(16, 16);
  const body = new Canvas(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const inA = ((x + 0.5 - 6.5) / 6) ** 2 + ((y + 0.5 - 8) / 6) ** 2 <= 1;
    const inB = ((x + 0.5 - 9) / 5) ** 2 + ((y + 0.5 - 7) / 5) ** 2 <= 1;
    if (inA && !inB) body.set(x, y, ICON_PAL.M);
  }
  // shade the inner edge of the crescent
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (body.alpha(x, y) && body.alpha(x + 1, y) === 0 && x > 4) body.set(x, y, ICON_PAL.m);
  body.set(2, 8, 0xffffff); body.set(3, 6, 0xffffff);
  // z z
  body.drawMap(["###", "..#", ".#.", "#..", "###"], { "#": 0xe3f2fd }, 10, 2);
  body.drawMap(["##", ".#", "#.", "##"], { "#": 0xe3f2fd }, 12, 9);
  body.outline(OUTLINE);
  c.blit(body, 0, 0);
  return c;
}

function icons() {
  const out = {};
  out.pick = iconFromMap(ICONS.pick.map((row, i) => (i < 13 ? ICONS.pick[i] : row)));
  out.coin = iconCoin();
  out.bolt = iconFromMap(ICONS.bolt);
  out.house = iconFromMap(ICONS.house);
  out.bomb = iconFromMap(ICONS.bomb);
  out.star = iconFromMap(ICONS.star);
  out.lock = iconFromMap(ICONS.lock);
  out.gift = iconFromMap(ICONS.gift);
  out.adventure = iconFromMap(ICONS.adventure);
  out.arrow_l = iconFromMap(ICONS.arrow_l);
  const ar = new Canvas(16, 16); ar.blit(out.arrow_l, 0, 0, { flipH: true }); out.arrow_r = ar;
  out.close = iconFromMap(ICONS.close);
  out.sleep = iconSleep();
  out.wallet = iconFromMap(ICONS.wallet);
  return out;
}

// ---------------------------------------------------------------- logo

/** Bold 7×10 display face (2-unit stems) — only the letters the logo needs. */
const BIG = {
  M: ["##...##", "###.###", "#######", "##.#.##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##"],
  I: [".####.", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", ".####."],
  N: ["##...##", "###..##", "####.##", "##.####", "##..###", "##...##", "##...##", "##...##", "##...##", "##...##"],
  E: ["#######", "#######", "##.....", "##.....", "######.", "######.", "##.....", "##.....", "#######", "#######"],
  R: ["######.", "#######", "##...##", "##...##", "#######", "######.", "##.##..", "##..##.", "##...##", "##...##"],
  B: ["######.", "#######", "##...##", "##...##", "######.", "######.", "##...##", "##...##", "#######", "######."],
  L: ["##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "#######", "#######"],
  A: [".#####.", "#######", "##...##", "##...##", "#######", "#######", "##...##", "##...##", "##...##", "##...##"],
  S: [".######", "#######", "##.....", "##.....", ".#####.", "..#####", ".....##", ".....##", "#######", "######."],
  T: ["#######", "#######", "..###..", "..###..", "..###..", "..###..", "..###..", "..###..", "..###..", "..###.."],
};
/** Compact 5×9 face (1-unit stems) for the small logo. */
const SMALL = {
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#", "#...#", "#...#"],
  E: ["#####", "#....", "#....", "#....", "####.", "#....", "#....", "#....", "#####"],
  R: ["####.", "#...#", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "#...#", "####.", "#...#", "#...#", "#...#", "####."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  A: [".###.", "#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#", "#...#"],
  S: [".####", "#....", "#....", "#....", ".###.", "....#", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
};

function textWidthPx(text, font, s, gap) {
  let w = 0;
  for (const ch of text) w += font[ch][0].length * s + gap;
  return w - gap;
}

/** Gold bevelled letters with a dark outline and a drop shadow. Returns the x after the text. */
function drawLogoText(c, text, font, x0, y0, s, gap) {
  const mask = new Canvas(c.w, c.h);
  let x = x0;
  for (const ch of text) {
    const g = font[ch];
    g.forEach((row, j) => [...row].forEach((p, i) => { if (p === "#") mask.fillRect(x + i * s, y0 + j * s, s, s, 0xffffff); }));
    x += g[0].length * s + gap;
  }
  const h = font[text[0]].length * s;
  const inside = (px, py) => mask.alpha(px, py) > 0;
  const body = new Canvas(c.w, c.h);
  const tb = Math.max(1, Math.round(s / 2));
  for (let py = y0; py < y0 + h; py++) for (let px = x0; px < x; px++) {
    if (!inside(px, py)) continue;
    const t = (py - y0) / (h - 1);
    let col = t < 0.5 ? mix(0xffd54f, GOLD.base, t * 2) : mix(GOLD.base, 0xf4a41f, (t - 0.5) * 2);
    let topEdge = 0;
    for (let k = 1; k <= tb; k++) if (!inside(px, py - k)) { topEdge = k; break; }
    let botEdge = false;
    for (let k = 1; k <= tb; k++) if (!inside(px, py + k)) botEdge = true;
    const leftEdge = !inside(px - 1, py), rightEdge = !inside(px + 1, py);
    if (botEdge) col = GOLD.dark;
    else if (topEdge) col = topEdge === 1 ? GOLD.light2 : GOLD.light;
    else if (leftEdge) col = GOLD.light;
    else if (rightEdge) col = GOLD.dark;
    body.set(px, py, col);
  }
  // mid-line highlight for extra chunk (only where the letter continues above/below)
  const midY = y0 + Math.floor(h * 0.42);
  for (let px = x0; px < x; px++) if (inside(px, midY) && inside(px, midY - tb - 1) && inside(px, midY + tb + 1)) body.set(px, midY, GOLD.light, 110);
  body.outline(OUTLINE);
  const shadow = Canvas.from(body);
  shadow.tint(0x2a1a05);
  c.blit(shadow, s - 1, s, { alpha: 0.9 });
  c.blit(body, 0, 0);
  return x - gap;
}

function bigBomb(c, x, y) {
  // ~30×34 bomb with a lit fuse (y is the top of the spark; body below)
  const b = new Canvas(c.w, c.h);
  const cx = x + 14, cy = y + 21;
  b.circle(cx, cy, 12.5, 0x3a3f4c);
  b.ellipse(cx + 1, cy + 3, 10.5, 8.5, 0x2b2f3a);
  b.circle(cx - 1, cy - 1, 10.5, 0x3a3f4c);
  b.ellipse(cx - 5, cy - 6, 4, 3, 0x7d879a);
  b.ellipse(cx - 6, cy - 7, 2.5, 1.5, 0xaeb6c4);
  b.set(cx - 7, cy - 8, 0xdfe4ec);
  // cap + fuse
  b.fillRect(cx - 1, cy - 15, 7, 4, 0x6b7484); b.hline(cx - 1, cx + 5, cy - 15, 0x9aa3b3); b.hline(cx - 1, cx + 5, cy - 12, 0x4a5060);
  b.line(cx + 2, cy - 16, cx + 6, cy - 20, 0x8d6e63); b.line(cx + 3, cy - 16, cx + 7, cy - 20, 0x8d6e63);
  b.line(cx + 6, cy - 20, cx + 11, cy - 19, 0x8d6e63); b.line(cx + 6, cy - 21, cx + 11, cy - 20, 0xa1887f);
  // spark
  b.fillRect(cx + 10, cy - 22, 5, 5, 0xff9100);
  b.fillRect(cx + 11, cy - 21, 3, 3, 0xffe57f); b.set(cx + 12, cy - 20, 0xffffff);
  b.set(cx + 12, cy - 24, 0xffca28); b.set(cx + 16, cy - 20, 0xffca28); b.set(cx + 8, cy - 20, 0xffca28); b.set(cx + 12, cy - 16, 0xffca28);
  b.set(cx + 16, cy - 24, 0xff9100); b.set(cx + 8, cy - 24, 0xff9100);
  b.outline(OUTLINE);
  const sh = Canvas.from(b); sh.tint(0x2a1a05); c.blit(sh, 2, 3, { alpha: 0.9 });
  c.blit(b, 0, 0);
}

/**
 * The MinerBlast lockup: the big bomb, a breath of space, then the wordmark
 * alone (no pick, no second bomb). 206×40 at 1×; the site header shows it at
 * 2×, the connect overlay at 3× and the Godot title/loader in a 2× box.
 */
function logo() {
  const s = 2, gap = 2;
  const tw = textWidthPx("MINERBLAST", BIG, s, gap);
  const bombW = 32, space = 12;
  const c = new Canvas(bombW + space + tw + 6, 40);
  bigBomb(c, 1, 2);
  drawLogoText(c, "MINERBLAST", BIG, bombW + space, 9, s, gap);
  return c;
}

/** Same lockup for the in-game top bar: the 16 px bomb icon, a gap, the small wordmark. */
function logoSmall(iconSet) {
  const c = new Canvas(144, 32);
  const s = 2, gap = 2;
  const tw = textWidthPx("MINERBLAST", SMALL, s, gap);
  const bombW = 16, space = 6;
  const x0 = Math.floor((144 - (bombW + space + tw)) / 2);
  c.blit(iconSet.bomb, x0, 7);
  drawLogoText(c, "MINERBLAST", SMALL, x0 + bombW + space, 9, s, gap);
  return c;
}

// ---------------------------------------------------------------- entry point

export function generateUi(outDir) {
  const out = {};
  const save = (name, item) => {
    const canvas = item.c ?? item;
    savePng(join(outDir, name), canvas);
    const entry = { w: canvas.w, h: canvas.h, frames: 1 };
    if (item.margins) entry.margins = item.margins;
    if (item.extra) entry.extra = item.extra;
    out[name] = entry;
  };

  save("panel_wood.png", panelWood());
  save("panel_dark.png", panelDark());
  save("frame_gold.png", frameGold());
  save("plate.png", plate());
  for (const [name, color] of Object.entries(BTN_COLORS)) {
    save(`btn_${name}.png`, button(color, false));
    save(`btn_${name}_down.png`, button(color, true));
  }
  save("ribbon.png", ribbon());
  save("portrait_frame.png", portraitFrame());
  save("bar_frame.png", barFrame());
  save("badge.png", badge());
  const ic = icons();
  for (const [name, canvas] of Object.entries(ic)) save(`icon_${name}.png`, canvas);
  save("logo.png", logo());
  save("logo_small.png", logoSmall(ic));
  return out;
}
