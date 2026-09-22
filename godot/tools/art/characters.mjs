/**
 * characters.mjs — MinerBlast placeholder character art (chars/ section of
 * CONTRACT.md). Heroes are composed from parts (head, hair, headgear, torso,
 * arms, legs, backpack) so the 11 frames are the same character moved around,
 * then outlined once. Deterministic: only `rng(seed)` from lib.mjs.
 */
import { join } from "node:path";
import { Canvas, OUTLINE, ramp, mix, shade, rng, sheet, savePng } from "./lib.mjs";

// ---------------------------------------------------------------- palette

const RARITY = [0x9e9e9e, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xffa726, 0xef5350];
const GOLD = 0xffca28, GOLD_D = 0xc79100, GOLD_L = 0xfff3b0;
const WOOD = 0x8b5a2b, WOOD_M = 0xa0673a, WOOD_L = 0xc98b4b, WOOD_D = 0x5d3a1a;
const RED = 0xc62828;
const BOOT = 0x4e342e, BOOT_L = 0x6d4c41, BOOT_D = 0x33221c;
const EYE = 0x141a27, WHITE = 0xffffff;
const NAVY = 0x141a27;

const HEROES = [
  { skin: 0xf1c27d, hair: 0x6d4c41, gear: "cap" },
  { skin: 0xc68642, hair: 0x2b1d14, gear: "bandana" },
  { skin: 0xffdbac, hair: 0xb5651d, gear: "helmet" },
  { skin: 0xe0ac69, hair: 0x3e2723, gear: "hood" },
  { skin: 0xf6d5a8, hair: 0xf2c14e, gear: "crown" },
  { skin: 0xe8a598, hair: 0xff8f00, gear: "demon" },
];

// ---------------------------------------------------------------- small helpers (private)

/** 2 px thick line (2x2 brush). */
function thickLine(c, x0, y0, x1, y1, col) {
  c.line(x0, y0, x1, y1, col);
  c.line(x0 + 1, y0, x1 + 1, y1, col);
  c.line(x0, y0 + 1, x1, y1 + 1, col);
  c.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1, col);
}
function px(c, pts, col, a = 255) { for (const [x, y] of pts) c.set(x, y, col, a); }

// ---------------------------------------------------------------- hero parts

/**
 * Head with face + hair + headgear. `hx, hy` = top-left of the skin box
 * (14x12 small, 20x17 big/portrait). Facing right.
 */
function drawHead(c, idx, hx, hy, { eyes = "open", mouth = "smile", big = false } = {}) {
  const hero = HEROES[idx];
  const sk = ramp(hero.skin);
  const hr = ramp(hero.hair);
  const w = big ? 20 : 14, h = big ? 17 : 12;

  // skin
  c.roundRect(hx, hy, w, h, sk.base, 2);
  if (big) { px(c, [[hx + 2, hy], [hx + w - 3, hy], [hx + 2, hy + h - 1], [hx + w - 3, hy + h - 1], [hx, hy + 2], [hx + w - 1, hy + 2], [hx, hy + h - 3], [hx + w - 1, hy + h - 3]], null); }
  // shadow side (right) and chin
  c.vline(hx + w - 1, hy + 3, hy + h - 4, sk.dark);
  c.hline(hx + 2, hx + w - 3, hy + h - 1, sk.dark2);
  c.hline(hx + w - 3, hx + w - 2, hy + h - 2, sk.dark);
  c.set(hx + 1, hy + h - 2, sk.dark);
  // highlight top-left
  c.hline(hx + 2, hx + (big ? 6 : 4), hy + 1, sk.light);
  c.set(hx + 1, hy + 2, sk.light);

  // hair: top + back of head + bangs
  const hairRows = big ? 4 : 3;
  c.roundRect(hx, hy, w, hairRows, hr.base, 1);
  c.hline(hx + 2, hx + w - 4, hy, hr.light);
  c.fillRect(hx, hy + hairRows, big ? 3 : 2, big ? 8 : 5, hr.dark);
  c.set(hx, hy + hairRows + (big ? 8 : 5), hr.dark);
  if (big) px(c, [[hx + 3, hy + 4], [hx + 4, hy + 4], [hx + 5, hy + 4], [hx + 8, hy + 4], [hx + 9, hy + 4], [hx + 13, hy + 4], [hx + 14, hy + 4], [hx + 4, hy + 5], [hx + 13, hy + 5], [hx + 17, hy + 4]], hr.base);
  else px(c, [[hx + 2, hy + 3], [hx + 3, hy + 3], [hx + 6, hy + 3], [hx + 9, hy + 3], [hx + 10, hy + 3], [hx + 12, hy + 3]], hr.base);

  // eyes (facing right => shifted to the front)
  const ew = big ? 3 : 2, eh = big ? 3 : 2;
  const ey = hy + (big ? 7 : 5);
  const ex = [hx + (big ? 8 : 6), hx + (big ? 14 : 10)];
  if (eyes === "open") {
    for (const x of ex) {
      c.fillRect(x, ey, ew, eh, EYE);
      c.set(x, ey, WHITE);
      if (big) c.set(x, ey + 1, 0xcfd8dc);
    }
  } else {
    for (const x of ex) c.hline(x, x + ew - 1, ey + 1, EYE); // closed: 1 px line
    if (big) for (const x of ex) c.hline(x, x + ew - 1, ey + 2, sk.dark);
  }
  // blush
  c.set(hx + (big ? 6 : 5), ey + eh + 1, mix(sk.base, 0xff6b8a, 0.45));
  c.set(hx + w - 2, ey + eh, mix(sk.base, 0xff6b8a, 0.45));
  // mouth
  const my = hy + (big ? 13 : 9);
  const mx = hx + (big ? 12 : 9);
  const MOUTH = 0x7a3b2e;
  if (mouth === "smile") {
    c.hline(mx, mx + (big ? 2 : 1), my, MOUTH);
    if (big) { c.set(mx - 1, my - 1, MOUTH); c.set(mx + 3, my - 1, MOUTH); }
  } else if (mouth === "open") {
    c.fillRect(mx, my - 1, 2, 2, MOUTH);
    c.set(mx, my - 1, 0xd35a5a);
  } else if (mouth === "grit") {
    c.hline(mx - 1, mx + 1, my, MOUTH);
  } else if (mouth === "sleep") {
    c.set(mx + 1, my, MOUTH);
  }

  drawHeadgear(c, idx, hx, hy, big);
}

/** Headgear per rarity, positioned relative to the head box. */
function drawHeadgear(c, idx, hx, hy, big) {
  const o = ramp(RARITY[idx]);
  const hero = HEROES[idx];
  const hr = ramp(hero.hair);
  const w = big ? 20 : 14;
  switch (hero.gear) {
    case "cap": { // soft brown cloth cap with a short brim at the front
      const cr = ramp(WOOD_M);
      if (!big) {
        c.roundRect(hx, hy - 2, w, 4, cr.base, 2);
        c.hline(hx + 2, hx + 10, hy - 2, cr.light);
        c.hline(hx + 1, hx + 12, hy + 1, cr.dark);
        c.hline(hx + 10, hx + 15, hy + 1, cr.dark2); // brim
        c.set(hx + 15, hy + 2, cr.dark2);
        c.set(hx + 6, hy - 3, cr.dark); // button
      } else {
        c.roundRect(hx, hy - 3, w, 6, cr.base, 2);
        c.hline(hx + 3, hx + 14, hy - 3, cr.light);
        c.hline(hx + 2, hx + 15, hy - 2, cr.light);
        c.hline(hx + 1, hx + 18, hy + 2, cr.dark);
        c.hline(hx + 14, hx + 22, hy + 2, cr.dark2);
        c.hline(hx + 19, hx + 22, hy + 3, cr.dark2);
        c.fillRect(hx + 8, hy - 4, 2, 1, cr.dark);
      }
      break;
    }
    case "bandana": { // rarity-green bandana with a knot tail at the back + goggles on the forehead
      const LENS = 0x4dd0e1, LENS_L = 0xb2ebf2, LENS_D = 0x00838f, FRAME = 0x37474f;
      if (!big) {
        c.roundRect(hx, hy - 1, w, 5, o.base, 2);
        c.hline(hx + 2, hx + 9, hy - 1, o.light);
        c.hline(hx, hx + 13, hy + 3, o.dark);
        c.fillRect(hx - 3, hy + 1, 3, 2, o.dark); // knot
        px(c, [[hx - 3, hy + 3], [hx - 4, hy + 4], [hx - 4, hy + 5]], o.base); // tail
        c.hline(hx + 1, hx + 12, hy, FRAME); // strap
        for (const lx of [hx + 4, hx + 8]) {
          c.fillRect(lx, hy - 1, 3, 3, LENS);
          c.set(lx, hy - 1, LENS_L);
          c.hline(lx, lx + 2, hy + 1, LENS_D);
        }
        c.set(hx + 7, hy, FRAME);
      } else {
        c.roundRect(hx, hy - 2, w, 7, o.base, 2);
        c.hline(hx + 3, hx + 13, hy - 2, o.light);
        c.hline(hx + 2, hx + 15, hy - 1, o.light);
        c.hline(hx, hx + 19, hy + 4, o.dark);
        c.fillRect(hx - 4, hy + 1, 4, 3, o.dark);
        px(c, [[hx - 4, hy + 4], [hx - 5, hy + 5], [hx - 5, hy + 6], [hx - 6, hy + 7]], o.base);
        c.hline(hx + 1, hx + 18, hy + 1, FRAME);
        for (const lx of [hx + 6, hx + 11]) {
          c.fillRect(lx, hy - 1, 4, 4, LENS);
          c.fillRect(lx, hy - 1, 2, 1, LENS_L);
          c.set(lx, hy, LENS_L);
          c.hline(lx, lx + 3, hy + 2, LENS_D);
          c.strokeRect(lx - 1, hy - 2, 6, 6, FRAME);
        }
      }
      break;
    }
    case "helmet": { // rounded mining helmet in rarity blue + head-lamp
      const LAMP = 0x455a64, BULB = 0xffee58, GLOW = 0xfff59d;
      if (!big) {
        c.roundRect(hx - 1, hy - 3, w + 2, 6, o.base, 2);
        c.hline(hx + 2, hx + 10, hy - 3, o.light);
        c.hline(hx + 1, hx + 12, hy - 2, o.light);
        c.vline(hx + 14, hy - 1, hy + 1, o.dark);
        c.hline(hx - 1, hx + 15, hy + 2, o.dark); // brim
        c.fillRect(hx + 9, hy - 2, 3, 2, LAMP);
        c.set(hx + 11, hy - 2, BULB); c.set(hx + 11, hy - 1, BULB);
        c.set(hx + 12, hy - 2, GLOW, 150); c.set(hx + 12, hy - 1, GLOW, 150);
      } else {
        c.roundRect(hx - 2, hy - 4, w + 4, 8, o.base, 2);
        c.hline(hx + 3, hx + 14, hy - 4, o.light);
        c.hline(hx + 1, hx + 16, hy - 3, o.light);
        c.hline(hx, hx + 4, hy - 2, o.light);
        c.vline(hx + 21, hy - 2, hy + 2, o.dark);
        c.hline(hx - 2, hx + 22, hy + 3, o.dark);
        c.fillRect(hx + 13, hy - 3, 4, 3, LAMP);
        c.fillRect(hx + 16, hy - 3, 1, 3, BULB); c.set(hx + 15, hy - 3, BULB);
        c.fillRect(hx + 17, hy - 3, 1, 3, GLOW, 150);
      }
      break;
    }
    case "hood": { // purple hood with small bone horns
      const BONE = 0xf5f0e1, BONE_D = 0xcfc3b4;
      if (!big) {
        c.roundRect(hx - 1, hy - 2, w + 2, 5, o.dark, 2); // top
        c.hline(hx + 1, hx + 9, hy - 2, o.base);
        c.hline(hx, hx + 4, hy - 1, o.base);
        c.fillRect(hx - 1, hy + 2, 3, 10, o.dark); // back
        c.vline(hx - 1, hy + 2, hy + 10, o.base);
        c.vline(hx + 2, hy + 3, hy + 10, o.dark2); // inner shadow
        c.fillRect(hx + 13, hy + 2, 2, 3, o.dark); // front rim
        c.set(hx + 13, hy + 5, o.dark2);
        // horns
        px(c, [[hx + 2, hy - 3], [hx + 1, hy - 4]], BONE);
        px(c, [[hx + 11, hy - 3], [hx + 12, hy - 4]], BONE);
        px(c, [[hx + 2, hy - 4], [hx + 11, hy - 4]], BONE_D);
      } else {
        c.roundRect(hx - 2, hy - 3, w + 4, 7, o.dark, 2);
        c.hline(hx + 1, hx + 12, hy - 3, o.base);
        c.hline(hx - 1, hx + 6, hy - 2, o.base);
        c.fillRect(hx - 2, hy + 3, 4, 14, o.dark);
        c.vline(hx - 2, hy + 3, hy + 15, o.base);
        c.vline(hx + 2, hy + 4, hy + 15, o.dark2);
        c.fillRect(hx + 19, hy + 3, 3, 4, o.dark);
        c.set(hx + 19, hy + 7, o.dark2);
        px(c, [[hx + 3, hy - 4], [hx + 3, hy - 5], [hx + 2, hy - 6], [hx + 2, hy - 5]], BONE);
        px(c, [[hx + 16, hy - 4], [hx + 16, hy - 5], [hx + 17, hy - 6], [hx + 17, hy - 5]], BONE);
        px(c, [[hx + 4, hy - 4], [hx + 15, hy - 4]], BONE_D);
      }
      break;
    }
    case "crown": { // gold crown with a red gem; blond hair shows under it
      const GEM = 0xe53935, GEM_L = 0xff8a80;
      if (!big) {
        c.fillRect(hx + 1, hy - 2, 12, 3, GOLD);
        c.hline(hx + 1, hx + 12, hy, GOLD_D);
        px(c, [[hx + 1, hy - 3], [hx + 2, hy - 3], [hx + 1, hy - 4], [hx + 6, hy - 3], [hx + 7, hy - 3], [hx + 6, hy - 4], [hx + 7, hy - 4], [hx + 11, hy - 3], [hx + 12, hy - 3], [hx + 12, hy - 4]], GOLD);
        px(c, [[hx + 2, hy - 2], [hx + 7, hy - 4], [hx + 12, hy - 2]], GOLD_L);
        c.fillRect(hx + 6, hy - 1, 2, 1, GEM); c.set(hx + 6, hy - 1, GEM_L);
        c.hline(hx + 1, hx + 12, hy + 1, hr.base); // hair fringe under crown
      } else {
        c.fillRect(hx + 1, hy - 3, 18, 4, GOLD);
        c.hline(hx + 1, hx + 18, hy, GOLD_D);
        for (const bx of [hx + 1, hx + 9, hx + 17]) {
          c.fillRect(bx, hy - 5, 2, 2, GOLD);
          c.set(bx + (bx === hx + 1 ? 0 : 1), hy - 6, GOLD);
        }
        px(c, [[hx + 2, hy - 3], [hx + 9, hy - 6], [hx + 17, hy - 3], [hx + 3, hy - 2]], GOLD_L);
        c.fillRect(hx + 9, hy - 2, 2, 2, GEM); c.set(hx + 9, hy - 2, GEM_L);
        c.hline(hx + 1, hx + 18, hy + 1, hr.base);
      }
      break;
    }
    case "demon": { // flame hair + dark curved horns
      const pal = { y: 0xffee58, o: 0xff8f00, r: 0xe64a19, w: 0xfff8c4 };
      const HORN = 0xa1887f, HORN_L = 0xd7ccc8;
      if (!big) {
        c.drawMap([
          "....y......y....",
          "...ywy....yyy...",
          "..yoo..y..oyo.y.",
          ".yooo.yyy.oooyy.",
          ".oooooooooooooo.",
          ".rooooooooooooor",
        ], pal, hx - 1, hy - 4);
        px(c, [[hx - 1, hy + 4], [hx - 1, hy + 3], [hx - 2, hy + 2], [hx - 2, hy + 1], [hx - 2, hy]], HORN);
        px(c, [[hx + 14, hy + 4], [hx + 14, hy + 3], [hx + 15, hy + 2], [hx + 15, hy + 1], [hx + 15, hy]], HORN);
        px(c, [[hx - 2, hy], [hx + 15, hy]], HORN_L);
      } else {
        c.drawMap([
          ".....y..........y.....",
          "....ywy....y...yyy....",
          "....yyy...yyy..ywy....",
          "...yooy..yywy..yooy...",
          "..yooo...yooo.yooooy..",
          "..yooooy.oooo.ooooooy.",
          ".yooooooooooooooooooy.",
          ".ooooooooooooooooooooo",
          ".roooooooooooooooooooo",
          ".rrooooooooooooooooorr",
        ], pal, hx - 1, hy - 7);
        for (const [x, d] of [[hx - 1, -1], [hx + 20, 1]]) {
          px(c, [[x, hy + 6], [x, hy + 5], [x, hy + 4], [x + d, hy + 3], [x + d, hy + 2], [x + d, hy + 1], [x + 2 * d, hy], [x + 2 * d, hy - 1]], HORN);
          px(c, [[x + d, hy + 3], [x + 2 * d, hy - 1]], HORN_L);
        }
      }
      break;
    }
  }
}

/** One boot+pants leg. top = first pants row; feet at y=30 unless raised. */
function drawLeg(c, o, x, top, isBack, raise = 0) {
  const pants = isBack ? o.dark2 : o.dark;
  const boot = isBack ? BOOT_D : BOOT;
  const bootL = isBack ? BOOT : BOOT_L;
  const footY = 30 - raise;
  c.fillRect(x, top, 3, footY - 2 - top, pants); // pants down to boot top-1
  c.fillRect(x, footY - 2, 3, 3, boot); // boot 3 rows
  c.fillRect(x + 3, footY - 1, 1, 2, boot); // toe
  c.set(x, footY - 2, bootL);
  c.set(x + 1, footY - 2, bootL);
}

/** Arm: 2 px sleeve from the shoulder to the hand, hand 2x2 at (hx, hy). */
function drawArm(c, sx, sy, hx, hy, sleeve, skin) {
  thickLine(c, sx, sy, hx, hy, sleeve);
  c.fillRect(hx, hy, 2, 2, skin);
}

function drawBackpack(c, x, y) {
  c.roundRect(x, y, 4, 9, WOOD, 1);
  c.fillRect(x, y, 4, 2, WOOD_M); // flap
  c.set(x, y, null);
  c.set(x + 1, y + 1, WOOD_L);
  c.set(x + 1, y + 4, GOLD_D); // buckle
  c.vline(x + 3, y + 2, y + 7, WOOD_D);
}

/** Small bomb held in the hand (wind-up frame). Centre (cx, cy), r 3. */
function drawMiniBomb(c, cx, cy) {
  c.circle(cx, cy, 3, 0x263238);
  px(c, [[cx - 1, cy - 2], [cx - 2, cy - 1], [cx - 1, cy - 1]], 0x607d8b);
  c.set(cx - 2, cy - 2, 0x90a4ae);
  c.fillRect(cx + 1, cy - 4, 2, 1, 0x455a64); // cap
  px(c, [[cx + 3, cy - 4], [cx + 4, cy - 5]], WOOD_L); // fuse
  c.set(cx + 4, cy - 6, 0xffee58);
  c.set(cx + 5, cy - 6, 0xff8f00);
  c.set(cx + 5, cy - 5, 0xffee58);
}

/**
 * Compose one hero frame. pose:
 *  bob: +1 body down (idle/recover), -1 body up (walk passing)
 *  legs: stand | strideA | passA | strideB | passB | sit
 *  backArm/frontArm: hand position offsets or named pose
 */
function heroFrame(idx, pose) {
  const c = new Canvas(32, 32);
  const hero = HEROES[idx];
  const o = ramp(RARITY[idx]);
  const sk = ramp(hero.skin);
  const bob = pose.bob ?? 0;
  const hdx = pose.headDx ?? 0;
  const hdy = (pose.headDy ?? 0) + bob;
  const sleeveBack = o.dark, sleeveFront = o.base;
  const hasCape = hero.gear === "crown";

  if (pose.legs === "sit") {
    // sitting, knees up in front (facing right)
    const chest = pose.chest ?? 0; // -1 = chest risen
    const ty = 21 + chest;
    if (hasCape) {
      c.fillRect(8, 22, 4, 8, RED);
      c.vline(8, 24, 29, shade(RED, 0.7));
      c.hline(6, 8, 29, RED); c.set(7, 30, shade(RED, 0.7)); c.set(6, 30, RED);
    } else {
      drawBackpack(c, 6, 21);
    }
    // torso (shirt, belt, hips)
    c.fillRect(11, ty, 10, 27 - ty, o.base);
    c.fillRect(19, ty, 2, 27 - ty, o.dark);
    c.hline(12, 14, ty, o.light);
    c.hline(11, 20, 27, BOOT);
    c.set(16, 27, GOLD);
    c.fillRect(11, 28, 10, 3, o.dark);
    // legs: thigh + knee block, boot pointing right
    c.roundRect(18, 23, 6, 8, o.dark, 1);
    c.fillRect(18, 23, 2, 5, o.dark2);
    c.hline(20, 22, 23, o.base);
    c.fillRect(21, 28, 3, 3, BOOT);
    c.set(24, 29, BOOT); c.set(24, 30, BOOT);
    c.set(21, 28, BOOT_L); c.set(22, 28, BOOT_L);
    if (hasCape) c.fillRect(11, ty + 1, 10, 2, RED);
    // back arm hidden; front arm resting across the knee
    drawArm(c, 20, ty + 2, 22, 24, sleeveFront, sk.base);
    drawHead(c, idx, 10, ty - 11 + 0, { eyes: "closed", mouth: "sleep" });
    c.outline(OUTLINE);
    return c;
  }

  // --- standing / walking / throwing ---------------------------------
  const legTop = 25 + bob; // first pants row, hips cover it
  const ty = 17 + bob; // shirt top
  const shY = 19 + bob; // shoulder row

  // cape (hero 4) behind everything
  if (hasCape) {
    const capeDx = pose.capeDx ?? 0;
    c.fillRect(7 + capeDx, ty + 1, 5, 10, RED);
    c.polygon([[7 + capeDx, ty + 8], [4 + capeDx, ty + 12], [12, ty + 12], [12, ty + 8]], RED);
    c.vline(12, ty + 1, ty + 11, shade(RED, 0.65));
    c.vline(7 + capeDx, ty + 2, ty + 9, shade(RED, 1.15));
  } else if (pose.legs !== "sit") {
    drawBackpack(c, 6 + (pose.packDx ?? 0), 18 + bob);
  }

  // legs
  switch (pose.legs) {
    case "strideA": drawLeg(c, o, 10, legTop, true); drawLeg(c, o, 19, legTop, false); break;
    case "passA": drawLeg(c, o, 13, legTop, true); drawLeg(c, o, 17, legTop, false, 2); break;
    case "strideB": drawLeg(c, o, 18, legTop, true); drawLeg(c, o, 11, legTop, false); break;
    case "passB": drawLeg(c, o, 12, legTop, true, 2); drawLeg(c, o, 16, legTop, false); break;
    default: drawLeg(c, o, 12, legTop, true); drawLeg(c, o, 17, legTop, false);
  }

  // torso: shirt, belt with buckle, hips
  c.fillRect(11, ty, 10, 6, o.base);
  c.fillRect(19, ty, 2, 6, o.dark);
  c.hline(12, 14, ty + 1, o.light);
  c.set(11, ty + 2, o.light);
  c.hline(11, 20, ty + 6, BOOT); // belt
  c.set(16, ty + 6, GOLD); c.set(17, ty + 6, GOLD_D);
  c.fillRect(11, ty + 7, 10, 1, o.dark); // hips
  if (hasCape) {
    c.fillRect(11, ty + 1, 10, 2, RED); // cape collar
    c.hline(11, 20, ty + 2, shade(RED, 0.7));
    // belt pouch instead of a backpack
    c.fillRect(18, ty + 6, 3, 3, WOOD_M); c.set(19, ty + 6, WOOD_L); c.set(20, ty + 8, WOOD_D);
  } else {
    c.line(12, ty, 17, ty + 5, o.dark2); // backpack strap
  }

  // back arm
  const ba = pose.backArm ?? "down";
  const drawBack = () => {
    if (ba === "down") drawArm(c, 9, shY, 9, shY + 4, sleeveBack, sk.base);
    else if (ba === "fwd") drawArm(c, 9, shY, 11, shY + 3, sleeveBack, sk.base);
    else if (ba === "back") drawArm(c, 9, shY, 7, shY + 3, sleeveBack, sk.base);
    else if (ba === "windup") { drawArm(c, 9, shY - 1, 4, 10, sleeveFront, sk.base); drawMiniBomb(c, 5, 7); }
  };
  if (ba === "windup") drawBack();

  // head (hair, face, headgear)
  drawHead(c, idx, 9 + hdx, 6 + hdy, { eyes: pose.eyes ?? "open", mouth: pose.mouth ?? "smile" });

  if (ba !== "windup") drawBack();

  // front arm
  const fa = pose.frontArm ?? "down";
  if (fa === "down") drawArm(c, 21, shY, 21, shY + 4, sleeveFront, sk.base);
  else if (fa === "fwd") drawArm(c, 21, shY, 23, shY + 3, sleeveFront, sk.base);
  else if (fa === "back") drawArm(c, 21, shY, 19, shY + 3, sleeveFront, sk.base);
  else if (fa === "throw") {
    drawArm(c, 21, shY - 1, 26, shY - 2, sleeveFront, sk.base);
    // motion streaks where the bomb left the hand
    px(c, [[29, shY - 3], [30, shY - 4], [29, shY], [30, shY + 1]], 0xffffff, 170);
  } else if (fa === "recover") drawArm(c, 21, shY, 24, shY + 3, sleeveFront, sk.base);

  c.outline(OUTLINE);
  return c;
}

const HERO_POSES = [
  { legs: "stand" }, // 0 idle
  { legs: "stand", bob: 1, packDx: 0 }, // 1 idle breathe
  { legs: "strideA", backArm: "fwd", frontArm: "back", capeDx: -1 }, // 2 walk contact
  { legs: "passA", bob: -1 }, // 3 walk passing (up)
  { legs: "strideB", backArm: "back", frontArm: "fwd", capeDx: -1 }, // 4 walk contact
  { legs: "passB", bob: -1 }, // 5 walk passing (up)
  { legs: "stand", backArm: "windup", headDx: -1, mouth: "grit", capeDx: 1 }, // 6 wind-up
  { legs: "strideA", backArm: "back", frontArm: "throw", headDx: 1, mouth: "open", capeDx: -2 }, // 7 release
  { legs: "stand", bob: 1, frontArm: "recover", mouth: "smile" }, // 8 recover
  { legs: "sit", chest: 0 }, // 9 sleep
  { legs: "sit", chest: -1 }, // 10 sleep breathe
];

const HERO_ANIMS = { idle: [0, 1], walk: [2, 3, 4, 5], throw: [6, 7, 8], sleep: [9, 10] };
const HERO_FPS = { idle: 2, walk: 8, throw: 10, sleep: 1.5 };

export function heroStrip(idx) {
  return sheet(HERO_POSES.map((p) => heroFrame(idx, p)));
}

/** Portrait: bust, head fills ~70 % of the 32x32. */
function portrait(idx) {
  const c = new Canvas(32, 32);
  const o = ramp(RARITY[idx]);
  const hero = HEROES[idx];
  // shoulders / chest
  c.roundRect(3, 25, 26, 7, o.base, 2);
  c.fillRect(22, 25, 7, 7, o.dark);
  c.hline(5, 9, 26, o.light);
  if (hero.gear === "crown") { c.fillRect(3, 25, 26, 3, RED); c.hline(3, 28, 27, shade(RED, 0.7)); }
  else { c.line(8, 25, 11, 31, o.dark2); c.line(24, 25, 21, 31, o.dark2); } // backpack straps
  drawHead(c, idx, 6, 8, { big: true });
  c.outline(OUTLINE);
  return c;
}

// ---------------------------------------------------------------- props

function heroShadow() {
  const c = new Canvas(20, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 20; x++) {
    const nx = (x + 0.5 - 10) / 10, ny = (y + 0.5 - 4) / 4;
    const d = nx * nx + ny * ny;
    if (d < 0.55) c.set(x, y, 0x000000, 110);
    else if (d < 1) c.set(x, y, 0x000000, 55);
  }
  return c;
}

function bombFrame(spark) {
  const c = new Canvas(24, 24);
  const cx = 11, cy = 13;
  c.circle(cx, cy, 8, 0x37474f);
  // bottom-right shadow + top-left crescent highlight
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    if (!c.alpha(x, y)) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 6.2 * 6.2 && dx + dy > 1.5) c.set(x, y, 0x1a1f24);
    else if (dx + dy > 0.5) c.set(x, y, 0x263238);
    if (d2 > 4.2 * 4.2 && d2 < 6.6 * 6.6 && dx + dy < -5) c.set(x, y, 0x607d8b);
    if (d2 > 5 * 5 && d2 < 6.6 * 6.6 && dx + dy < -7.5) c.set(x, y, 0x90a4ae);
  }
  c.set(cx - 2, cy - 4, 0xcfd8dc); c.set(cx - 3, cy - 3, 0xcfd8dc); // glint
  // cap + fuse (top-right)
  c.fillRect(cx + 2, cy - 10, 4, 2, 0x455a64);
  c.set(cx + 2, cy - 10, 0x78909c);
  c.fillRect(cx + 3, cy - 11, 2, 1, 0x37474f);
  px(c, [[cx + 5, cy - 12], [cx + 6, cy - 13], [cx + 7, cy - 13]], WOOD_L);
  px(c, [[cx + 5, cy - 11], [cx + 6, cy - 12]], WOOD);
  const sx = cx + 8, sy = cy - 14;
  if (spark) {
    c.drawMap([
      "...y...",
      ".y.w.y.",
      "..www..",
      "yww#wwy",
      "..www..",
      ".y.w.y.",
      "...y...",
    ], { y: 0xffee58, w: 0xffee58, "#": 0xffffff }, sx - 2, sy - 3);
    px(c, [[sx, sy - 1], [sx + 2, sy - 1], [sx, sy + 1], [sx + 2, sy + 1]], 0xff8f00);
    px(c, [[sx + 1, sy - 3], [sx + 1, sy + 3], [sx - 2, sy], [sx + 4, sy]], 0xfff8c4, 200);
  } else {
    px(c, [[sx, sy], [sx + 1, sy]], 0xff8f00);
    c.set(sx + 1, sy + 1, 0xe64a19);
    c.set(sx, sy - 1, 0xff8f00, 150);
  }
  c.outline(OUTLINE);
  return c;
}

/** Cartoon explosion. 6 frames, growing and turning into smoke. */
function boomFrame(i) {
  const c = new Canvas(64, 64);
  const r = rng(9100 + i * 131);
  const cx = 32, cy = 33;
  const puffs = (R, n, col, { spread = 0.6, size = 0.5, fill = true, a = 255, dy = 0 } = {}) => {
    if (fill) c.circle(cx, cy + dy, R * 0.6, col, a);
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.9;
      const d = R * spread * (0.75 + r() * 0.5);
      const pr = Math.max(2, R * size * (0.7 + r() * 0.6));
      c.circle(cx + Math.cos(ang) * d, cy + dy + Math.sin(ang) * d * 0.9, pr, col, a);
    }
  };
  const W = 0xffffff, Y = 0xffee58, YL = 0xfff59d, O = 0xff8f00, OR = 0xff5722, RD = 0xe53935, DR = 0xb71c1c, G1 = 0x616161, G2 = 0x8d8d8d, G3 = 0xb0b0b0;
  switch (i) {
    case 0: { // core flash: white star burst
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + 0.2;
        const len = k % 2 ? 11 : 16;
        c.line(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len, YL);
      }
      puffs(12, 6, Y, { spread: 0.5, size: 0.45 });
      puffs(8, 5, W, { spread: 0.45, size: 0.5 });
      break;
    }
    case 1: {
      puffs(18, 7, RD, { spread: 0.6, size: 0.5 });
      puffs(14, 6, O, { spread: 0.55, size: 0.5 });
      puffs(9, 5, Y, { spread: 0.5, size: 0.5 });
      c.circle(cx, cy, 4, W);
      break;
    }
    case 2: {
      puffs(25, 8, DR, { spread: 0.62, size: 0.48 });
      puffs(22, 7, RD, { spread: 0.58, size: 0.48 });
      puffs(16, 6, O, { spread: 0.55, size: 0.5 });
      puffs(9, 5, Y, { spread: 0.5, size: 0.45 });
      c.circle(cx - 3, cy - 3, 2.5, YL);
      break;
    }
    case 3: {
      puffs(29, 9, DR, { spread: 0.62, size: 0.45 });
      puffs(24, 8, RD, { spread: 0.6, size: 0.42 });
      puffs(17, 6, OR, { spread: 0.6, size: 0.4, fill: false });
      puffs(12, 5, O, { spread: 0.6, size: 0.35, fill: false });
      puffs(8, 4, Y, { spread: 0.7, size: 0.3, fill: false });
      // first smoke curling off the top edge
      for (const [ox, oy, pr] of [[-14, -22, 4], [-6, -25, 5], [4, -26, 4], [12, -22, 4], [18, -16, 3], [-20, -14, 3]]) c.circle(cx + ox, cy + oy, pr, G1);
      break;
    }
    case 4: {
      puffs(30, 9, G1, { spread: 0.65, size: 0.42 });
      puffs(22, 7, G2, { spread: 0.7, size: 0.35, fill: false });
      puffs(14, 4, OR, { spread: 0.7, size: 0.28, fill: false });
      puffs(9, 3, O, { spread: 0.8, size: 0.2, fill: false });
      // holes
      for (let k = 0; k < 4; k++) c.circle(cx + (r() - 0.5) * 26, cy + (r() - 0.5) * 26, 3 + r() * 3, null);
      break;
    }
    case 5: {
      puffs(31, 8, G1, { spread: 0.78, size: 0.34, fill: false, dy: -3 });
      puffs(28, 7, G2, { spread: 0.7, size: 0.3, fill: false, dy: -4 });
      puffs(20, 5, G3, { spread: 0.75, size: 0.22, fill: false, dy: -5 });
      c.circle(cx + 6, cy - 6, 4, G2);
      c.circle(cx - 9, cy + 3, 3, G2);
      break;
    }
  }
  if (i === 4) punchHoles(c, r, 4, 3);
  if (i === 5) punchHoles(c, r, 7, 4);
  c.outline(OUTLINE);
  if (i === 4) c.fade(0.88);
  if (i === 5) c.fade(0.6);
  return c;
}
/** Transparent gaps inside a smoke frame. */
function punchHoles(c, r, n, maxR) {
  for (let k = 0; k < n; k++) {
    const hx = 32 + (r() - 0.5) * 30, hy = 33 + (r() - 0.5) * 30, hr = 2 + r() * maxR;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const dx = x + 0.5 - hx, dy = y + 0.5 - hy;
      if (dx * dx + dy * dy <= hr * hr) { const i = (y * 64 + x) * 4; c.px[i + 3] = 0; }
    }
  }
}

/** Gold coin spin frame. rx = horizontal radius; back = reverse side (no "B"). */
function coinFrame(rx, back) {
  const c = new Canvas(16, 16);
  const cx = 8, cy = 8, ry = 6.5;
  if (rx <= 1) { // edge-on
    c.fillRect(7, 1, 3, 14, GOLD_D);
    c.vline(8, 2, 13, GOLD);
    c.set(8, 2, GOLD_L); c.set(8, 3, GOLD_L);
    c.outline(OUTLINE);
    return c;
  }
  c.ellipse(cx - 0.5, cy - 0.5, rx, ry, GOLD_D);
  c.ellipse(cx - 0.5, cy - 0.5, rx - 1, ry - 1, GOLD);
  // highlight top-left arc
  c.ellipse(cx - 0.5 - Math.min(1, rx / 5), cy - 1.5, rx - 1.5, ry - 1.5, GOLD_L);
  c.ellipse(cx - 0.5, cy - 0.3, rx - 1.6, ry - 1.9, GOLD);
  // shadow bottom-right rim
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const nx = (x + 0.5 - cx + 0.5) / (rx + 0.5), ny = (y + 0.5 - cy + 0.5) / (ry + 0.5);
    const d = nx * nx + ny * ny;
    if (d <= 1 && d > 0.72 && nx + ny > 0.3) c.set(x, y, shade(GOLD_D, 0.85));
  }
  if (!back) {
    if (rx >= 6) c.drawMap(["###.", "#..#", "#..#", "###.", "#..#", "#..#", "###."], { "#": GOLD_D }, 6, 4);
    else if (rx >= 4) c.drawMap(["##.", "#.#", "##.", "#.#", "##."], { "#": GOLD_D }, 7, 5);
    else c.vline(8, 5, 10, GOLD_D);
  } else {
    // back side: a small mine-cart pick mark (diamond) instead of the "B"
    if (rx >= 4) c.drawMap([".#.", "#.#", "#.#", "#.#", ".#."], { "#": GOLD_D }, 7, 5);
    else px(c, [[8, 5], [8, 6], [8, 9], [8, 10]], GOLD_D);
  }
  c.outline(OUTLINE);
  return c;
}

function coinBig() {
  const c = new Canvas(32, 32);
  const cx = 15.5, cy = 15.5;
  c.circle(cx, cy, 14.5, GOLD_D);
  c.circle(cx, cy, 13, GOLD);
  c.circle(cx - 1.5, cy - 1.5, 11.5, GOLD_L);
  c.circle(cx, cy, 10.8, GOLD);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const dx = x + 0.5 - cx - 0.5, dy = y + 0.5 - cy - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 13 && d > 10.5 && dx + dy > 3) c.set(x, y, shade(GOLD_D, 0.85));
  }
  c.circle(cx, cy, 10, GOLD_D, 0);
  // inner rim ring
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const dx = x + 0.5 - cx - 0.5, dy = y + 0.5 - cy - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 11 && d > 10) c.set(x, y, mix(GOLD, GOLD_D, 0.5));
  }
  // chunky "B" (8x11), 2 px strokes, darker bottom-right edge
  c.drawMap([
    "#######.",
    "##....##",
    "##....##",
    "##....##",
    "#######.",
    "##....##",
    "##....##",
    "##....##",
    "##....##",
    "#######.",
  ], { "#": GOLD_D }, 12, 11);
  c.drawMap([
    "........",
    ".......#",
    ".......#",
    ".......#",
    "........",
    ".......#",
    ".......#",
    ".......#",
    ".......#",
    "..#####.",
  ], { "#": shade(GOLD_D, 0.75) }, 12, 11);
  c.outline(OUTLINE);
  return c;
}

function chest(open) {
  const c = new Canvas(32, 32);
  const wd = ramp(WOOD_M);
  // body
  c.fillRect(4, 13, 24, 16, wd.base);
  c.fillRect(24, 13, 4, 16, wd.dark);
  c.hline(4, 27, 17, wd.dark); c.hline(4, 27, 21, wd.dark); c.hline(4, 27, 25, wd.dark);
  c.hline(5, 12, 14, wd.light);
  c.hline(4, 27, 28, WOOD_D);
  if (!open) {
    // lid
    c.roundRect(4, 8, 24, 6, wd.base, 2);
    c.hline(6, 25, 8, wd.light); c.hline(5, 26, 9, wd.light);
    c.fillRect(24, 10, 4, 4, wd.dark);
    c.hline(4, 27, 13, WOOD_D);
    // gold bands
    for (const bx of [8, 22]) { c.fillRect(bx, 8, 2, 21, GOLD); c.vline(bx + 1, 9, 28, GOLD_D); c.set(bx, 8, null); c.set(bx, 8, GOLD_D); }
    // lock
    c.fillRect(14, 12, 4, 4, GOLD); c.set(17, 12, GOLD_D); c.set(17, 15, GOLD_D); c.set(14, 15, GOLD_D);
    c.set(15, 13, OUTLINE); c.set(16, 14, OUTLINE); c.set(15, 14, OUTLINE);
  } else {
    // open lid: seen from inside, tilted back
    c.roundRect(4, 1, 24, 7, wd.dark, 2);
    c.fillRect(6, 3, 20, 4, WOOD_D);
    c.hline(6, 25, 7, shade(WOOD_D, 0.8));
    for (const bx of [8, 22]) { c.fillRect(bx, 1, 2, 2, GOLD); c.fillRect(bx, 14, 2, 15, GOLD); c.vline(bx + 1, 15, 28, GOLD_D); }
    // glow from inside + coins
    c.fillRect(5, 8, 22, 6, 0xffee58);
    c.hline(5, 26, 8, 0xfff8c4); c.hline(5, 26, 9, 0xfff8c4);
    c.fillRect(5, 12, 22, 2, GOLD);
    for (const [gx, gy] of [[7, 11], [11, 10], [15, 11], [19, 10], [23, 11], [9, 12], [17, 12]]) { c.fillRect(gx, gy, 3, 2, GOLD); c.set(gx, gy, GOLD_L); c.set(gx + 2, gy + 1, GOLD_D); }
    // sparkles
    px(c, [[3, 6], [29, 5], [16, 0], [10, 0], [22, 0]], 0xfff8c4, 220);
    px(c, [[2, 5], [30, 4], [16, 1]], 0xffee58, 150);
    c.fillRect(14, 13, 4, 3, GOLD); c.set(15, 14, OUTLINE); c.set(16, 14, OUTLINE);
  }
  c.outline(OUTLINE);
  return c;
}

/**
 * Flickering flame: layered tongues (red > orange > yellow > pale core) whose
 * width/tip wobble comes from `seed`. cx = centre x, base = bottom row, h = height.
 */
function drawFlame(c, cx, base, w, h, seed) {
  const r = rng(seed);
  const layers = [
    { col: 0xe64a19, s: 1.0 },
    { col: 0xff8f00, s: 0.78 },
    { col: 0xffca28, s: 0.56 },
    { col: 0xffee58, s: 0.38 },
    { col: 0xfff8c4, s: 0.18 },
  ];
  const phase = r() * 6.28, amp = 0.6 + r() * 1.4, lean = (r() - 0.5) * 2;
  const noise = Array.from({ length: h + 2 }, () => (r() - 0.5));
  for (const L of layers) {
    const lh = Math.max(2, Math.round(h * L.s));
    const hw = (w / 2) * L.s;
    for (let i = 0; i < lh; i++) {
      const t = i / lh; // 0 base .. 1 tip
      const width = hw * Math.pow(1 - t, 0.75) * (1 + noise[i] * 0.5) + (t < 0.15 ? 0 : 0.2);
      const off = Math.sin(t * 2.6 + phase) * amp * t + lean * t * 2;
      const y = base - i;
      const x0 = Math.round(cx + off - width), x1 = Math.round(cx + off + width);
      if (x1 >= x0) c.hline(x0, x1, y, L.col);
    }
    // occasional detached tip
    if (L.s < 1 && r() < 0.5) {
      const tipY = base - lh - 1 - Math.floor(r() * 2);
      const tipX = Math.round(cx + Math.sin(phase + 1) * amp + lean * 2 + (r() - 0.5) * 3);
      c.set(tipX, tipY, L.col);
      if (r() < 0.5) c.set(tipX, tipY - 1, L.col);
    }
  }
}

function torchFrame(i) {
  const c = new Canvas(16, 32);
  // wall plate + bracket
  c.fillRect(4, 27, 8, 4, 0x455a64);
  c.hline(5, 10, 27, 0x607d8b);
  c.fillRect(6, 23, 4, 4, 0x37474f);
  c.fillRect(5, 22, 6, 2, 0x546e7a);
  c.hline(6, 9, 22, 0x78909c);
  // handle
  c.fillRect(7, 12, 2, 12, WOOD);
  c.vline(7, 12, 23, WOOD_M);
  // wrapped head
  c.fillRect(6, 10, 4, 4, WOOD_L);
  c.hline(6, 9, 11, WOOD_M);
  c.hline(6, 9, 13, WOOD);
  drawFlame(c, 7.5, 10, 8, 10 + (i % 2), 500 + i * 17);
  // sparks
  const r = rng(600 + i * 7);
  for (let k = 0; k < 2; k++) c.set(4 + Math.floor(r() * 8), 1 + Math.floor(r() * 5), k ? 0xffee58 : 0xff8f00, 200);
  c.outline(OUTLINE);
  return c;
}

function campfireFrame(i) {
  const c = new Canvas(32, 32);
  // stones ring
  const ST = 0x78909c, ST_D = 0x546e7a, ST_L = 0x9fb3bd;
  const stones = [[3, 26, 5, 4], [8, 28, 4, 3], [24, 26, 5, 4], [20, 28, 4, 3], [13, 29, 6, 2]];
  for (const [x, y, w, h] of stones) {
    c.roundRect(x, y, w, h, ST, 1);
    c.hline(x + 1, x + w - 2, y, ST_L);
    c.set(x + w - 1, y + h - 1, ST_D); c.set(x + w - 1, y + h - 2, ST_D);
  }
  // logs
  c.fillRect(7, 24, 18, 3, WOOD_M);
  c.hline(8, 23, 24, WOOD_L);
  c.hline(7, 24, 26, WOOD_D);
  c.fillRect(6, 24, 2, 3, WOOD_D); c.fillRect(24, 24, 2, 3, WOOD_D);
  c.polygon([[9, 24], [12, 21], [14, 21], [22, 24], [22, 26], [19, 26]], WOOD);
  c.line(12, 22, 20, 25, WOOD_L);
  // embers
  px(c, [[12, 24], [17, 25], [21, 24]], 0xff8f00);
  // flame
  drawFlame(c, 16, 23, 14, 15 + (i % 2) * 2 - (i === 3 ? 1 : 0), 700 + i * 23);
  // sparks
  const r = rng(800 + i * 11);
  for (let k = 0; k < 3; k++) c.set(10 + Math.floor(r() * 12), 2 + Math.floor(r() * 6), k === 0 ? 0xff8f00 : 0xffee58, 220);
  c.outline(OUTLINE);
  return c;
}

function zzzFrame(i) {
  const c = new Canvas(16, 16);
  const pal = { z: 0x81d4fa, l: 0xe1f5fe };
  const maps = [
    ["lzzz", "..z.", ".z..", "zzzz"],
    ["lzzzzz", "....z.", "...z..", "..z...", ".z....", "zzzzzz"],
    ["llzzzzzz", "lzzzzzzz", ".....zz.", "....zz..", "...zz...", "..zz....", "zzzzzzzz", "zzzzzzzz"],
  ];
  const x = [2, 4, 5][i], y = [9, 5, 1][i];
  c.drawMap(maps[i], pal, x, y);
  c.outline(OUTLINE);
  return c;
}

function smokePuff() {
  const c = new Canvas(12, 12);
  const r = rng(4242);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const dx = x + 0.5 - 6, dy = y + 0.5 - 6;
    const d = Math.sqrt(dx * dx + dy * dy) / 6 + (r() - 0.5) * 0.12;
    if (d > 1) continue;
    const a = Math.round(Math.min(1, (1 - d) * 1.8) * 255);
    c.set(x, y, d < 0.45 ? 0xcfd8dc : 0xb0bec5, a);
  }
  c.set(4, 4, 0xeceff1, 255);
  return c;
}

// ---------------------------------------------------------------- entry point

export function generateCharacters(outDir) {
  const out = {};
  const put = (name, canvas, frames, extra = {}) => {
    savePng(join(outDir, name), canvas);
    out[name] = { w: canvas.w / frames, h: canvas.h, frames, ...extra };
  };

  for (let i = 0; i < 6; i++) {
    put(`hero_${i}.png`, heroStrip(i), 11, { anims: HERO_ANIMS, fps: HERO_FPS });
    put(`portrait_${i}.png`, portrait(i), 1);
  }
  put("hero_shadow.png", heroShadow(), 1);
  put("bomb.png", sheet([bombFrame(true), bombFrame(false)]), 2);
  put("boom.png", sheet([0, 1, 2, 3, 4, 5].map(boomFrame)), 6);
  put("coin.png", sheet([[6.5, false], [5, false], [3, false], [1, false], [3, true], [5, true]].map(([rx, b]) => coinFrame(rx, b))), 6);
  put("coin_big.png", coinBig(), 1);
  put("chest.png", chest(false), 1);
  put("chest_open.png", chest(true), 1);
  put("campfire.png", sheet([0, 1, 2, 3].map(campfireFrame)), 4);
  put("torch.png", sheet([0, 1, 2, 3].map(torchFrame)), 4);
  put("zzz.png", sheet([0, 1, 2].map(zzzFrame)), 3);
  put("smoke_puff.png", smokePuff(), 1);
  return out;
}
