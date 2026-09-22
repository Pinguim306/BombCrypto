/**
 * environment.mjs — MinerBlast env/ placeholder art (see CONTRACT.md, env/).
 *
 * 3/4 top-down cave: 48 px tiles, blocks with a lit top face (rows 0–13) and a
 * front face (rows 14–47), low-contrast floor so sprites pop, rock borders lit
 * from the top-left. Everything is seeded (`rng`) — same input, same bytes.
 */
import { join } from "node:path";
import { Canvas, OUTLINE, ramp, mix, shade, rng, sheet, savePng } from "./lib.mjs";

const T = 48;
const MAP_COLS = 12, MAP_ROWS = 8;
const MAP_W = MAP_COLS * T, MAP_H = MAP_ROWS * T;

// ---------------------------------------------------------------- palettes

/** Cave floor: navy-brown, deliberately narrow value range. */
const FL = {
  dark2: 0x1f1c27,
  dark: 0x262330,
  base: 0x2b2834,
  light: 0x302d3a,
  light2: 0x373341,
  pebble: 0x3e3949,
};
/** Cave rock (border, wall band, boulders, stalactites). */
const ROCK = { ...ramp(0x6b5545), seam: 0x241c22 };
const ROCK_COOL = { ...ramp(0x5d4e4c), seam: 0x241c22 };
const WOOD = { dark2: 0x3d2412, dark: 0x6b3f1c, base: 0x8b5a2b, light: 0xa0673a, light2: 0xc98b4b };
const GOLD = { dark2: 0x7a4c05, dark: 0xb8860b, base: 0xffca28, light: 0xffe082, light2: 0xfff6c8 };
const CYAN = { dark2: 0x00505a, dark: 0x0097a7, base: 0x26c6da, light: 0x80eaff, light2: 0xe0ffff };
const PURPLE = { dark2: 0x4a1a6b, dark: 0x7b1fa2, base: 0xab47bc, light: 0xd98cf0, light2: 0xf6e0ff };

// ---------------------------------------------------------------- private helpers

/** Speckle fill: each pixel picks from `tones` with the given weights (must sum ≤ 1; remainder = tones[0]). */
function speckle(c, x, y, w, h, tones, weights, r) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = r();
    let acc = 0, tone = tones[0];
    for (let k = 1; k < tones.length; k++) { acc += weights[k - 1]; if (v < acc) { tone = tones[k]; break; } }
    c.set(x + i, y + j, tone);
  }
}

/** Point-in-ellipse test matching Canvas.ellipse's coverage rule. */
function inEllipse(x, y, cx, cy, rx, ry) {
  const nx = (x + 0.5 - cx) / (rx + 0.5), ny = (y + 0.5 - cy) / (ry + 0.5);
  return nx * nx + ny * ny <= 1;
}

/**
 * Shaded boulder blob: ellipse with a light rim on the top-left, a dark rim on
 * the bottom-right, speckled body. `mask` (optional Uint8Array w*h) records coverage.
 */
function shadeBlob(c, cx, cy, rx, ry, pal, r, { mask = null, tone = 1, clipY = Infinity } = {}) {
  const base = tone === 1 ? pal.base : mix(pal.base, tone > 1 ? pal.light : pal.dark, Math.abs(tone - 1));
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    if (y > clipY) break;
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      if (!inEllipse(x, y, cx, cy, rx, ry)) continue;
      const tl = !inEllipse(x - 1, y - 1, cx, cy, rx, ry) || !inEllipse(x, y - 1, cx, cy, rx, ry) || !inEllipse(x - 1, y, cx, cy, rx, ry);
      const br = !inEllipse(x + 1, y + 1, cx, cy, rx, ry) || !inEllipse(x + 1, y, cx, cy, rx, ry) || !inEllipse(x, y + 1, cx, cy, rx, ry);
      let col;
      if (br && !tl) col = pal.dark;
      else if (tl && !br) col = pal.light;
      else if (tl && br) col = base;
      else { const v = r(); col = v < 0.08 ? pal.dark : v < 0.14 ? pal.light : base; }
      c.set(x, y, col);
      if (mask && c.inside(x, y)) mask[y * c.w + x] = 1;
    }
  }
}

/** Random-walk crack: returns a list of polylines [[x,y],...] incl. branches. */
function crackPaths(r, x, y, len, angle, depth, out = []) {
  const pts = [[Math.round(x), Math.round(y)]];
  let cx = x, cy = y, a = angle;
  for (let i = 0; i < len; i++) {
    a += (r() - 0.5) * 0.7;
    if (r.chance(0.1)) a += (r.chance(0.5) ? 1 : -1) * 0.8;   // occasional kink
    // keep the general heading: pull back toward the initial angle
    a += (angle - a) * 0.12;
    cx += Math.cos(a) * 1.1; cy += Math.sin(a) * 1.1;
    pts.push([Math.round(cx), Math.round(cy)]);
    if (depth > 0 && i > 2 && i < len - 2 && r.chance(0.14)) {
      crackPaths(r, cx, cy, Math.max(3, Math.floor(len * (0.3 + r() * 0.3))), a + (r.chance(0.5) ? 1 : -1) * (0.6 + r() * 0.5), depth - 1, out);
    }
  }
  out.push(pts);
  return out;
}

/** Faceted boulder from a polygon: lit top facet + top-left rim, dark bottom-right rim, cracks. */
function boulder(c, pts, pal, r, { cracks = 1 } = {}) {
  const m = new Canvas(c.w, c.h);
  m.polygon(pts, 0xffffff);
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inside = (x, y) => m.alpha(x, y) > 0;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (!inside(x, y)) continue;
    const tl = !inside(x - 1, y) || !inside(x, y - 1);
    const br = !inside(x + 1, y) || !inside(x, y + 1);
    const top = y < y0 + (y1 - y0) * 0.38;
    let col;
    if (br && !tl) col = pal.dark2;
    else if (tl && !br) col = top ? pal.light2 : pal.light;
    else if (tl && br) col = pal.base;
    else {
      const v = r();
      col = top ? (v < 0.1 ? pal.base : pal.light) : (v < 0.08 ? pal.dark : v < 0.13 ? pal.light : pal.base);
      if (!top && !inside(x, y + 2)) col = pal.dark;   // second shadow row at the bottom
    }
    c.set(x, y, col);
  }
  // facet line between the top and the side + a crack or two
  for (let k = 0; k < cracks; k++) {
    const sx = pts[0][0] + r.int(2, 6), sy = y0 + Math.floor((y1 - y0) * 0.4) + r.int(-1, 2);
    const paths = crackPaths(r, sx, sy, r.int(5, 8), 0.9 + r() * 0.6, 0);
    for (const p of paths) for (let i = 0; i + 1 < p.length; i++) if (inside(p[i + 1][0], p[i + 1][1]) && inside(p[i][0], p[i][1])) c.line(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], pal.dark2);
  }
}

/** Paints crack polylines: dark groove + 1 px lit edge on the bottom-right side. */
function paintCracks(c, paths, { dark = 0x0d0b12, darkA = 235, light = 0xffffff, lightA = 55, thickStart = false } = {}) {
  const grooves = new Canvas(c.w, c.h);
  for (const pts of paths) {
    for (let i = 0; i + 1 < pts.length; i++) grooves.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], dark);
    if (thickStart) { const [sx, sy] = pts[0]; grooves.set(sx + 1, sy, dark); grooves.set(sx, sy + 1, dark); }
  }
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (grooves.alpha(x, y) === 0) continue;
    c.set(x, y, dark, darkA);
  }
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (grooves.alpha(x, y) === 0) continue;
    if (grooves.alpha(x + 1, y) === 0) c.set(x + 1, y, light, lightA);
    else if (grooves.alpha(x, y + 1) === 0) c.set(x, y + 1, light, lightA);
  }
}

/** Soft drop shadow ellipse (drawn after outlines so it is not outlined). */
function groundShadow(c, cx, cy, rx, ry, a = 80) {
  c.ellipse(cx, cy, rx, ry, 0x000000, a);
}

/** Draws `src` into `dst` at (x, y) after outlining a copy — keeps sprites' 1 px outline. */
function outlined(src) {
  const c = Canvas.from(src);
  c.outline(OUTLINE);
  return c;
}

// ---------------------------------------------------------------- floor

function floorTile(seed, { pebbles = [2, 4], cracks = 1, seams = true } = {}) {
  const r = rng(seed);
  const c = new Canvas(T, T);
  speckle(c, 0, 0, T, T, [FL.base, FL.dark, FL.light], [0.10, 0.12], r);
  // mottled patches (2–4 px wide, 1–2 tall) — flagstone feel without contrast
  const n = r.int(5, 9);
  for (let i = 0; i < n; i++) {
    const w = r.int(2, 5), h = r.int(1, 2);
    c.fillRect(r.int(0, T - w), r.int(0, T - h), w, h, r.chance(0.5) ? FL.dark : FL.light);
  }
  // pebbles: lit top, shadow below
  const np = r.int(pebbles[0], pebbles[1]);
  for (let i = 0; i < np; i++) {
    const px = r.int(2, T - 5), py = r.int(2, T - 5), w = r.int(2, 3);
    c.hline(px, px + w - 1, py, FL.pebble);
    c.hline(px, px + w - 1, py + 1, FL.light);
    c.hline(px + 1, px + w, py + 2, FL.dark2);
  }
  // hairline cracks
  for (let i = 0; i < cracks; i++) {
    if (!r.chance(0.75)) continue;
    const paths = crackPaths(r, r.int(6, T - 6), r.int(6, T - 6), r.int(6, 12), r() * Math.PI * 2, 1);
    for (const pts of paths) for (let k = 0; k + 1 < pts.length; k++) c.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], FL.dark2);
  }
  // faint tile seam on the top/left edge so the grid reads very subtly
  if (seams) { c.hline(0, T - 1, 0, FL.dark, 70); c.vline(0, 0, T - 1, FL.dark, 70); }
  return c;
}

function crystalCluster(c, x, y, pal, r, shards) {
  // shards: [{dx, w, h}] — tall diamonds, lit left facet, dark right facet, bright core
  const sorted = [...shards].sort((a, b) => b.h - a.h);
  const tmp = new Canvas(c.w, c.h);
  for (const s of sorted) {
    const cx = x + s.dx, top = y - s.h, hw = Math.floor(s.w / 2);
    tmp.polygon([[cx, top], [cx + hw + 1, y - Math.floor(s.h * 0.3)], [cx + hw + 1, y + 1], [cx - hw, y + 1], [cx - hw, y - Math.floor(s.h * 0.3)]], pal.dark);
    tmp.polygon([[cx, top], [cx + 1, y - Math.floor(s.h * 0.3)], [cx + 1, y + 1], [cx - hw, y + 1], [cx - hw, y - Math.floor(s.h * 0.3)]], pal.base);
    // lit left facet edge
    tmp.line(cx - hw, y - Math.floor(s.h * 0.3), cx, top, pal.light);
    // bright core
    const coreY = top + Math.max(2, Math.floor(s.h * 0.35));
    tmp.set(cx, coreY, pal.light2); tmp.set(cx, coreY + 1, pal.light);
    tmp.set(cx - 1, coreY + 1, pal.light);
  }
  tmp.outline(mix(pal.dark2, OUTLINE, 0.5));
  c.blit(tmp, 0, 0);
}

function floorCrystalTile() {
  const c = floorTile(4242, { pebbles: [1, 2], cracks: 0 });
  const r = rng(77);
  // glow halo on the floor
  for (let k = 3; k >= 1; k--) c.ellipse(30, 36, 8 + k * 2, 4 + k, CYAN.base, 14);
  crystalCluster(c, 30, 38, CYAN, r, [{ dx: 0, w: 5, h: 12 }, { dx: -5, w: 4, h: 7 }, { dx: 5, w: 4, h: 8 }, { dx: -8, w: 3, h: 4 }]);
  return c;
}

function crater() {
  const c = new Canvas(T, T);
  const r = rng(909);
  const cx = 24, cy = 28, rx = 20, ry = 13;
  // ash ring (slightly lighter, greyish) fading out, then the dark scorched bowl
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    const d = Math.sqrt(nx * nx + ny * ny) + (r() - 0.5) * 0.12;
    if (d > 1.05) continue;
    if (d > 0.72) {
      // ash rim: grey-brown dust, strongest around d≈0.85
      const t = 1 - Math.abs(d - 0.86) / 0.2;
      if (t > 0) c.set(x, y, 0x4a4048, Math.round(t * 120));
    } else {
      const a = Math.min(1, (0.72 - d) / 0.45 + 0.35);
      c.set(x, y, mix(0x241a1e, 0x07060a, Math.min(1, a)), Math.round(a * 215));
    }
  }
  // short radial cracks inside the bowl
  const paths = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + 0.4 + r() * 0.5;
    crackPaths(r, cx + Math.cos(ang) * 3, cy + Math.sin(ang) * 2, r.int(5, 8), ang, 0, paths);
  }
  const clipped = paths.map((p) => p.filter(([x, y]) => ((x + 0.5 - cx) / (rx * 0.8)) ** 2 + ((y + 0.5 - cy) / (ry * 0.8)) ** 2 <= 1));
  paintCracks(c, clipped.filter((p) => p.length > 1), { dark: 0x000000, darkA: 200, lightA: 0 });
  // rubble bits in the ash ring
  for (let i = 0; i < 12; i++) {
    const ang = r() * Math.PI * 2, d = 0.78 + r() * 0.22;
    const px = Math.round(cx + Math.cos(ang) * rx * d), py = Math.round(cy + Math.sin(ang) * ry * d);
    c.set(px, py, 0x5a5058, 200); c.set(px + 1, py, 0x2c2430, 200);
  }
  return c;
}

// ---------------------------------------------------------------- ore blocks

const TOP_H = 14;

const BLOCK_PAL = [
  { top: ramp(0xa58a76), front: ramp(0x7e6152), name: "stone" },
  { top: ramp(0xbdd6e6), front: ramp(0x7f9bb5), name: "ice" },
  { top: ramp(0x5a5262), front: ramp(0x352f3c), name: "basalt" },
];

/** Cobble/chunk texture on a face: rounded chunks with lit top edge and dark bottom edge. */
function chunkTexture(c, x0, y0, w, h, pal, r, { count = 7, minW = 6, maxW = 12, minH = 4, maxH = 7, contrast = 1 } = {}) {
  const lo = mix(pal.base, pal.dark, 0.3 * contrast), hi = mix(pal.base, pal.light, 0.3 * contrast);
  for (let i = 0; i < count; i++) {
    const cw = r.int(minW, maxW), ch = r.int(minH, maxH);
    const cx = x0 + r.int(0, w - cw), cy = y0 + r.int(0, h - ch);
    const tone = r.chance(0.5) ? lo : hi;
    if (r.chance(0.5)) {
      // rounded chunk
      c.roundRect(cx, cy, cw, ch, tone, 2);
      c.hline(cx + 2, cx + cw - 3, cy, mix(tone, pal.light, 0.45 * contrast));
      c.hline(cx + 2, cx + cw - 3, cy + ch - 1, mix(tone, pal.dark, 0.55 * contrast));
    } else {
      // pebble-ish ellipse
      c.ellipse(cx + cw / 2, cy + ch / 2, cw / 2 - 0.5, ch / 2 - 0.5, tone);
      c.hline(cx + 2, cx + cw - 3, cy, mix(tone, pal.light, 0.4 * contrast));
      c.hline(cx + 2, cx + cw - 3, cy + ch - 1, mix(tone, pal.dark, 0.5 * contrast));
    }
    c.set(cx + cw - 1, cy + Math.floor(ch / 2), mix(tone, pal.dark, 0.4 * contrast));
  }
}

function nugget(c, x, y, w, h, pal, r) {
  const tmp = new Canvas(c.w, c.h);
  tmp.roundRect(x, y, w, h, pal.base, 1);
  if (r.chance(0.6)) tmp.set(x + w - 1, y - 1, pal.base);   // a lump on the top-right
  tmp.hline(x + 1, x + w - 2, y, pal.light);
  tmp.set(x + 1, y + 1, pal.light2); tmp.set(x + 2, y + 1, pal.light2);
  tmp.hline(x + 1, x + w - 1, y + h - 1, pal.dark);
  tmp.vline(x + w - 1, y + 1, y + h - 2, pal.dark);
  tmp.outline(pal.dark2);
  c.blit(tmp, 0, 0);
}

function blockBase(kind) {
  const P = BLOCK_PAL[kind];
  const r = rng(700 + kind * 13);
  const c = new Canvas(T, T);
  // faces
  c.fillRect(0, 0, T, TOP_H, P.top.base);
  c.fillRect(0, TOP_H, T, T - TOP_H, P.front.base);
  // subtle darkening toward the bottom of the front face (ground contact)
  for (let y = 36; y < 46; y++) c.hline(2, 45, y, P.front.dark, Math.round(((y - 35) / 10) * 70));
  return { c, P, r };
}

function finishBlock(c, P) {
  // top face bevel: lit top-left, shaded bottom-right
  c.hline(1, 46, 1, P.top.light2);
  c.hline(2, 45, 2, P.top.light);
  c.vline(1, 1, 12, P.top.light2);
  c.vline(2, 2, 11, P.top.light);
  c.vline(46, 1, 12, P.top.dark);
  c.hline(1, 46, 12, P.top.dark);
  // edge between faces + front lip
  c.hline(0, 47, 13, P.front.dark2);
  c.hline(1, 46, 14, P.front.light2);
  c.hline(2, 45, 15, P.front.light);
  c.vline(1, 14, 45, P.front.light);
  c.vline(46, 14, 45, P.front.dark);
  c.hline(1, 46, 45, P.front.dark);
  c.hline(1, 46, 46, P.front.dark2);
  c.strokeRect(0, 0, T, T, OUTLINE);
  return c;
}

function blockStone() {
  const { c, P, r } = blockBase(0);
  chunkTexture(c, 2, 16, 44, 28, P.front, r, { count: 9 });
  chunkTexture(c, 2, 2, 44, 10, P.top, r, { count: 5, minH: 3, maxH: 5, contrast: 0.7 });
  // gold nuggets — a few big ones on the front, small glints on top
  nugget(c, 8, 22, 6, 5, GOLD, r);
  nugget(c, 27, 30, 7, 5, GOLD, r);
  nugget(c, 34, 19, 5, 4, GOLD, r);
  nugget(c, 14, 36, 5, 4, GOLD, r);
  nugget(c, 30, 5, 4, 3, GOLD, r);
  nugget(c, 12, 6, 3, 3, GOLD, r);
  // sparkle
  c.set(10, 21, 0xffffff); c.set(29, 29, 0xffffff);
  return finishBlock(c, P);
}

function blockIce() {
  const { c, P, r } = blockBase(1);
  chunkTexture(c, 2, 16, 44, 28, P.front, r, { count: 7, minW: 8, maxW: 16, contrast: 0.8 });
  chunkTexture(c, 2, 2, 44, 10, P.top, r, { count: 4, minH: 3, maxH: 5, contrast: 0.6 });
  // frost glints
  for (let i = 0; i < 5; i++) { const x = r.int(4, 40), y = r.int(17, 43); c.hline(x, x + r.int(1, 3), y, 0xffffff, 110); }
  // crystals (front cluster + a small one top)
  crystalCluster(c, 15, 43, CYAN, r, [{ dx: 0, w: 5, h: 13 }, { dx: -6, w: 4, h: 7 }, { dx: 5, w: 4, h: 9 }]);
  crystalCluster(c, 37, 41, CYAN, r, [{ dx: 0, w: 5, h: 9 }, { dx: -5, w: 3, h: 5 }]);
  crystalCluster(c, 30, 11, CYAN, r, [{ dx: 0, w: 3, h: 6 }, { dx: 4, w: 3, h: 4 }]);
  c.set(15, 33, 0xffffff); c.set(37, 34, 0xffffff);
  return finishBlock(c, P);
}

function blockBasalt() {
  const { c, P, r } = blockBase(2);
  chunkTexture(c, 2, 16, 44, 28, P.front, r, { count: 8, contrast: 0.55 });
  chunkTexture(c, 2, 2, 44, 10, P.top, r, { count: 5, minH: 3, maxH: 5, contrast: 0.5 });
  // magma cracks: 1 px glowing groove, hot core segments, faint dark-red halo
  const paths = [];
  crackPaths(r, 5, 24, 26, 0.3, 2, paths);
  crackPaths(r, 42, 44, 18, Math.PI + 1.0, 1, paths);
  crackPaths(r, 20, 3, 12, 0.35, 0, paths);
  const glow = new Canvas(T, T);
  for (const pts of paths) for (let i = 0; i + 1 < pts.length; i++) glow.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0xff6d00);
  // dark scorched edge on one side, faint halo around
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (glow.alpha(x, y) === 0) continue;
    if (glow.alpha(x, y + 1) === 0) c.set(x, y + 1, 0x140c10, 200);
    if (glow.alpha(x + 1, y) === 0) c.set(x + 1, y, 0x140c10, 160);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (glow.alpha(x + dx, y + dy) === 0) c.set(x + dx, y + dy, 0xb71c1c, 45);
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (glow.alpha(x, y) === 0) continue;
    // hot core: yellow near the start of the main crack, orange elsewhere, with bright pulses
    const hot = ((x * 3 + y * 5) % 7) < 2;
    c.set(x, y, hot ? 0xffd54f : 0xff6d00);
  }
  // embers + a glowing pool where the main crack starts
  c.fillRect(4, 24, 3, 2, 0xffab40); c.set(5, 24, 0xffe57f);
  for (let i = 0; i < 7; i++) c.set(r.int(3, 44), r.int(17, 44), r.chance(0.5) ? 0xff9100 : 0xffd54f, 200);
  return finishBlock(c, P);
}

function crackOverlay(heavy) {
  const c = new Canvas(T, T);
  const r = rng(heavy ? 313 : 311);
  const paths = [];
  crackPaths(r, 22, 2, 34, Math.PI / 2 + 0.25, heavy ? 2 : 1, paths);
  crackPaths(r, 6, 26, 20, 0.3, 1, paths);
  if (heavy) {
    crackPaths(r, 44, 16, 24, Math.PI - 0.6, 1, paths);
    crackPaths(r, 14, 46, 14, -1.2, 1, paths);
  }
  paintCracks(c, paths, { darkA: heavy ? 240 : 225, lightA: 60, thickStart: heavy });
  if (heavy) {
    // chips: small wedges knocked out along the cracks (dark, with a lit edge on the right)
    const all = paths.flat().filter(([x, y]) => x > 3 && y > 3 && x < 43 && y < 43);
    for (let i = 0; i < 8; i++) {
      const [px, py] = all[r.int(0, all.length - 1)];
      const s = r.int(1, 2);
      const dir = r.chance(0.5) ? 1 : -1;
      c.polygon([[px, py], [px + (s + 1) * dir, py], [px, py + s + 1]], 0x0d0b12, 235);
      c.line(px + (s + 1) * dir, py, px, py + s + 1, 0xffffff, 60);
    }
    // widen the main crack near its start (chunk missing)
    c.fillRect(21, 2, 3, 3, 0x0d0b12, 240);
    c.set(24, 3, 0xffffff, 60); c.set(23, 5, 0xffffff, 60);
  }
  return c;
}

// ---------------------------------------------------------------- decorations

function rock(kind) {
  const c = new Canvas(24, 20);
  const r = rng(500 + kind);
  const body = new Canvas(24, 20);
  if (kind === 0) {
    // one big angular boulder
    boulder(body, [[2, 12], [5, 5], [11, 2], [17, 3], [22, 8], [23, 14], [20, 18], [5, 18], [1, 16]], ROCK, r, { cracks: 2 });
  } else {
    // a flatter slab with a smaller rock leaning on it
    boulder(body, [[1, 13], [6, 8], [14, 6], [22, 9], [23, 15], [20, 18], [3, 18]], ROCK_COOL, r, { cracks: 1 });
    boulder(body, [[3, 11], [6, 4], [11, 3], [14, 7], [13, 12], [5, 13]], ROCK_COOL, r, { cracks: 0 });
  }
  body.outline(OUTLINE);
  groundShadow(c, 12, 18, 11, 2, 70);
  c.blit(body, 0, 0);
  return c;
}

function mushroom() {
  const c = new Canvas(16, 16);
  const r = rng(601);
  const body = new Canvas(16, 16);
  // stem
  body.fillRect(6, 8, 4, 6, 0xd7ccc8);
  body.vline(6, 8, 13, 0xefebe9);
  body.vline(9, 8, 13, 0xa1887f);
  body.hline(6, 9, 13, 0x8d6e63);
  // cap
  body.ellipse(8, 6, 6.5, 3.5, PURPLE.base);
  body.ellipse(8, 5, 6, 2.5, PURPLE.light);
  body.hline(3, 12, 8, PURPLE.dark);
  body.hline(2, 13, 7, PURPLE.dark);
  body.ellipse(8, 5.5, 5.5, 2.3, PURPLE.base);
  body.hline(4, 11, 3, PURPLE.light);
  body.set(5, 4, PURPLE.light2); body.set(6, 4, PURPLE.light2);
  body.set(9, 5, PURPLE.light2); body.set(11, 6, PURPLE.light2); body.set(4, 6, PURPLE.light2);
  body.outline(OUTLINE);
  // glow halo (soft, unoutlined)
  for (let k = 2; k >= 1; k--) c.ellipse(8, 6, 7 + k, 4 + k, PURPLE.light, 22);
  groundShadow(c, 8, 14, 4, 1, 70);
  c.blit(body, 0, 0);
  return c;
}

function bones() {
  const c = new Canvas(24, 12);
  const body = new Canvas(24, 12);
  const BONE = 0xe8e0d0, BONE_D = 0xb8ad98, BONE_L = 0xfff8ea;
  // skull (left)
  body.ellipse(5, 5, 4.5, 4, BONE);
  body.fillRect(2, 7, 7, 3, BONE);
  body.hline(2, 8, 10, BONE_D);
  body.set(3, 5, OUTLINE); body.set(4, 5, OUTLINE); body.set(6, 5, OUTLINE); body.set(7, 5, OUTLINE);
  body.set(3, 6, OUTLINE); body.set(7, 6, OUTLINE);
  body.set(5, 7, BONE_D);
  body.set(3, 9, BONE_D); body.set(5, 9, BONE_D); body.set(7, 9, BONE_D);
  body.hline(2, 8, 2, BONE_L); body.set(1, 4, BONE_L);
  // crossed bones (right)
  body.line(11, 3, 21, 9, BONE); body.line(11, 4, 21, 10, BONE_D);
  body.line(21, 3, 11, 9, BONE); body.line(21, 4, 11, 10, BONE_D);
  for (const [x, y] of [[10, 3], [21, 3], [10, 9], [21, 9]]) { body.fillRect(x, y - 1, 2, 2, BONE); body.set(x, y - 1, BONE_L); body.set(x + 1, y + 1, BONE_D); }
  body.outline(OUTLINE);
  groundShadow(c, 12, 10, 11, 1.5, 60);
  c.blit(body, 0, 0);
  return c;
}

function crystal(kind) {
  const c = new Canvas(24, 32);
  const pal = kind === 0 ? CYAN : PURPLE;
  const r = rng(650 + kind);
  for (let k = 3; k >= 1; k--) c.ellipse(12, 27, 8 + k * 1.5, 3 + k * 0.7, pal.base, 16);
  const body = new Canvas(24, 32);
  // small rocky base
  shadeBlob(body, 12, 27, 9, 3, ROCK_COOL, r);
  crystalCluster(body, 12, 27, pal, r, [{ dx: 0, w: 7, h: 24 }, { dx: -6, w: 5, h: 13 }, { dx: 6, w: 5, h: 15 }, { dx: -9, w: 3, h: 6 }, { dx: 9, w: 3, h: 7 }]);
  body.outline(OUTLINE);
  groundShadow(c, 12, 29, 10, 2, 70);
  c.blit(body, 0, 0);
  return c;
}

function stalactiteShape(c, x, topY, w, h, pal, r) {
  // cone hanging from topY, tip at topY+h-1
  const hw = w / 2, cx = x + hw;
  for (let j = 0; j < h; j++) {
    const t = j / (h - 1);
    const rw = Math.max(0.5, hw * (1 - t) * (1 - t * 0.15));
    const x0 = Math.round(cx - rw), x1 = Math.round(cx + rw) - 1;
    for (let px = x0; px <= x1; px++) {
      const f = (px - x0) / Math.max(1, x1 - x0);
      let col = f < 0.3 ? pal.light : f > 0.75 ? pal.dark : pal.base;
      if (j === h - 1) col = pal.dark;
      if (j % 5 === 4 && f > 0.2) col = mix(col, pal.dark, 0.5);   // subtle drip rings
      if (r() < 0.025) col = pal.dark;
      c.set(px, topY + j, col);
    }
  }
  // drip at the tip
  c.set(Math.round(cx) - (w % 2 ? 0 : 1), topY + h, pal.light);
}

function stalactite() {
  const c = new Canvas(16, 24);
  const r = rng(660);
  stalactiteShape(c, 2, 0, 12, 22, ROCK, r);
  c.outline(OUTLINE);
  // glossy drip highlight
  c.set(5, 3, ROCK.light2); c.set(5, 4, ROCK.light2); c.set(6, 8, ROCK.light2);
  return c;
}

function sign() {
  const c = new Canvas(32, 24);
  const body = new Canvas(32, 24);
  // post
  body.fillRect(14, 8, 4, 15, WOOD.dark);
  body.vline(14, 8, 22, WOOD.base);
  body.vline(17, 8, 22, WOOD.dark2);
  // board (two planks) with a pointed right end
  body.polygon([[2, 2], [26, 2], [30, 8], [26, 14], [2, 14]], WOOD.light2);
  body.hline(2, 27, 8, WOOD.dark);           // plank seam
  body.polygon([[2, 9], [27, 9], [30, 8], [26, 14], [2, 14]], WOOD.light);
  body.hline(3, 25, 2, 0xdba86a);            // top lit edge
  body.hline(3, 25, 13, WOOD.dark);
  body.vline(2, 3, 13, 0xdba86a);
  // grain + scratched "text"
  body.hline(5, 9, 4, WOOD.base); body.hline(12, 20, 5, WOOD.base); body.hline(6, 15, 11, WOOD.dark);
  body.hline(18, 23, 11, WOOD.dark);
  // nails
  for (const [x, y] of [[4, 3], [24, 3], [4, 12], [24, 12]]) body.set(x, y, 0x9e9e9e);
  body.outline(OUTLINE);
  groundShadow(c, 16, 22, 6, 1.5, 70);
  c.blit(body, 0, 0);
  return c;
}

// ---------------------------------------------------------------- house

function house() {
  const c = new Canvas(96, 80);
  const body = new Canvas(96, 80);
  const r = rng(808);
  const TILE_P = ramp(0xc62828);
  const LOG = { seam: 0x3d2412, dark: 0x7a4a26, base: 0xa0673a, light: 0xbb7c4a, light2: 0xd49a5f };

  // --- log walls (x 14..81, y 34..71)
  const WX0 = 14, WX1 = 81, WY0 = 34;
  const logRows = [34, 40, 46, 52, 58, 64];
  logRows.forEach((y, i) => {
    body.fillRect(WX0, y, WX1 - WX0 + 1, 6, LOG.base);
    body.hline(WX0, WX1, y, LOG.light);
    body.hline(WX0, WX1, y + 1, LOG.light2, 90);
    body.hline(WX0, WX1, y + 4, LOG.dark);
    body.hline(WX0, WX1, y + 5, LOG.seam);
    // knots / grain
    for (let k = 0; k < 3; k++) { const gx = WX0 + 4 + r.int(0, WX1 - WX0 - 10); body.hline(gx, gx + r.int(3, 8), y + 2 + r.int(0, 1), LOG.dark, 120); }
    // protruding log ends (alternate sides, cross-stacked)
    const left = i % 2 === 0;
    const ex = left ? WX0 - 3 : WX1 + 1;
    body.fillRect(ex, y, 3, 6, LOG.base);
    body.hline(ex, ex + 2, y, LOG.light);
    body.hline(ex, ex + 2, y + 4, LOG.dark);
    body.hline(ex, ex + 2, y + 5, LOG.seam);
    // end grain ring on the cut face
    const rx = left ? ex : ex + 2;
    body.set(rx, y + 2, LOG.light2); body.set(rx, y + 3, LOG.dark);
  });
  // foundation stones
  body.fillRect(WX0 - 1, 70, WX1 - WX0 + 3, 3, 0x6f6a72);
  body.hline(WX0 - 1, WX1 + 1, 70, 0x8a858f);
  body.hline(WX0 - 1, WX1 + 1, 72, 0x4a4650);
  for (let x = WX0 + 2; x < WX1; x += 7) body.vline(x, 70, 72, 0x4a4650);

  // --- roof (trapezoid: ridge y 6, eave y 36)
  const RY0 = 6, RY1 = 36;
  const xL = (y) => 30 - (26 * (y - RY0)) / (RY1 - RY0);
  const xR = (y) => 65 + (26 * (y - RY0)) / (RY1 - RY0);
  for (let y = RY0; y <= RY1; y++) body.hline(Math.round(xL(y)), Math.round(xR(y)), y, TILE_P.base);
  // tile rows: dark scallop line + lit tile tops, alternating offset
  for (let row = 0, y = RY0 + 5; y <= RY1 - 1; row++, y += 5) {
    const x0 = Math.round(xL(y)), x1 = Math.round(xR(y));
    body.hline(x0, x1, y, TILE_P.dark);
    const off = row % 2 ? 3 : 0;
    for (let x = x0 + off; x <= x1; x += 6) {
      if (y - 1 >= RY0) body.set(x, y - 1, TILE_P.dark);     // scallop notch (tile gap above the seam)
      body.set(x, y, TILE_P.dark2);
      if (x + 1 <= x1 && y + 1 <= RY1) body.hline(x + 1, Math.min(x + 3, x1), y + 1, TILE_P.light);  // lit tile shoulder
      if (x + 1 <= x1 && y + 1 <= RY1) body.set(x + 1, y + 1, TILE_P.light2);
      if (x + 5 <= x1 && y + 2 <= RY1 - 1) body.vline(x + 5, y + 1, y + 3, TILE_P.dark);    // tile side shadow
    }
  }
  // slanted edges: lit left, shaded right
  for (let y = RY0; y <= RY1; y++) { body.set(Math.round(xL(y)), y, TILE_P.light2); body.set(Math.round(xL(y)) + 1, y, TILE_P.light); body.set(Math.round(xR(y)), y, TILE_P.dark2); body.set(Math.round(xR(y)) - 1, y, TILE_P.dark); }
  // ridge cap
  body.fillRect(28, RY0 - 2, 40, 3, TILE_P.dark);
  body.hline(29, 66, RY0 - 2, TILE_P.light2);
  body.hline(28, 67, RY0, TILE_P.dark2);
  for (let x = 30; x <= 66; x += 6) body.set(x, RY0 - 1, TILE_P.dark2);
  // eave underside + shadow onto the wall
  body.hline(3, 92, RY1, 0x5a3a1c);
  body.hline(3, 92, RY1 + 1, 0x3d2412);
  body.hline(WX0 - 3, WX1 + 3, RY1 + 2, OUTLINE, 110);
  body.hline(WX0 - 3, WX1 + 3, RY1 + 3, OUTLINE, 60);

  // --- chimney (top-right, sits on the roof slope)
  const CH = { base: 0x8a8a92, light: 0xaeaeb6, dark: 0x5c5c66, mortar: 0x4a4a54 };
  body.fillRect(70, 4, 9, 17, CH.base);
  for (let y = 7; y < 21; y += 3) { body.hline(70, 78, y, CH.mortar); }
  for (let y = 5; y < 21; y += 3) { const off = ((y - 5) / 3) % 2 ? 2 : 5; body.set(70 + off, y, CH.mortar); body.set(70 + off, y + 1, CH.mortar); }
  body.vline(70, 4, 20, CH.light);
  body.vline(78, 4, 20, CH.dark);
  body.fillRect(69, 2, 11, 3, CH.dark);
  body.hline(69, 79, 2, CH.light);
  body.hline(71, 77, 3, 0x1a1a22);   // opening

  // --- door (arched, planks, knob, step)
  const DX0 = 39, DX1 = 52, DY0 = 50, DY1 = 69;
  // frame
  body.fillRect(DX0 - 1, DY0 + 2, 16, DY1 - DY0 - 1, WOOD.light2);
  body.hline(DX0, DX1, DY0 + 1, WOOD.light2); body.hline(DX0 + 2, DX1 - 2, DY0, WOOD.light2);
  body.set(DX0 + 1, DY0, WOOD.light2); body.set(DX1 - 1, DY0, WOOD.light2);
  // door
  const DOOR = { base: 0x5d3a1c, dark: 0x3e2410, light: 0x7a4e26 };
  body.fillRect(DX0, DY0 + 3, DX1 - DX0 + 1, DY1 - DY0 - 2, DOOR.base);
  body.hline(DX0 + 1, DX1 - 1, DY0 + 2, DOOR.base);
  body.hline(DX0 + 2, DX1 - 2, DY0 + 1, DOOR.base);
  body.hline(DX0 + 4, DX1 - 4, DY0 + 1, DOOR.light);
  for (const x of [DX0 + 4, DX0 + 9]) body.vline(x, DY0 + 3, DY1, DOOR.dark);
  body.vline(DX0, DY0 + 3, DY1, DOOR.dark);
  body.hline(DX0, DX1, DY1, DOOR.dark);
  body.hline(DX0 + 1, DX1 - 1, DY0 + 10, DOOR.dark);   // cross brace
  body.hline(DX0 + 1, DX1 - 1, DY0 + 11, DOOR.light, 120);
  body.set(DX1 - 3, DY0 + 12, GOLD.base); body.set(DX1 - 2, DY0 + 12, GOLD.light); body.set(DX1 - 3, DY0 + 13, GOLD.dark);
  // step
  body.fillRect(DX0 - 2, 70, 18, 3, 0x8a858f);
  body.hline(DX0 - 2, DX1 + 3, 70, 0xa7a2ad);
  body.hline(DX0 - 2, DX1 + 3, 72, 0x4a4650);

  // --- window (warm)
  const WNX0 = 60, WNY0 = 46, WNW = 14, WNH = 12;
  body.fillRect(WNX0 - 1, WNY0 - 1, WNW + 2, WNH + 2, WOOD.dark2);
  body.fillRect(WNX0, WNY0, WNW, WNH, 0xffb300);
  body.fillRect(WNX0, WNY0, 6, 5, 0xffe082);
  body.fillRect(WNX0, WNY0, 3, 2, 0xfff6c8);
  body.fillRect(WNX0 + 7, WNY0 + 6, 7, 6, 0xf59300);
  body.vline(WNX0 + 6, WNY0, WNY0 + WNH - 1, WOOD.dark2);
  body.hline(WNX0, WNX0 + WNW - 1, WNY0 + 5, WOOD.dark2);
  // sill
  body.hline(WNX0 - 2, WNX0 + WNW + 1, WNY0 + WNH + 1, WOOD.light2);
  body.hline(WNX0 - 2, WNX0 + WNW + 1, WNY0 + WNH + 2, WOOD.dark);
  // light spill on the logs
  body.strokeRect(WNX0 - 3, WNY0 - 3, WNW + 6, WNH + 6, 0xffb300, 45);
  body.strokeRect(WNX0 - 2, WNY0 - 2, WNW + 4, WNH + 4, 0xffb300, 70);

  // --- bushes at the corners
  const BUSH = ramp(0x2e7d32);
  for (const [bx, by] of [[13, 70], [84, 70]]) {
    body.ellipse(bx, by, 5, 3, BUSH.base);
    body.ellipse(bx - 1, by - 1, 3, 1.5, BUSH.light);
    body.hline(bx - 3, bx + 4, by + 2, BUSH.dark);
    body.set(bx + 2, by - 1, 0xef5350); body.set(bx - 3, by + 1, 0xef5350);
  }
  // lantern by the door
  body.vline(DX0 - 4, 54, 56, WOOD.dark2);
  body.fillRect(DX0 - 5, 57, 3, 4, GOLD.dark);
  body.set(DX0 - 4, 58, GOLD.light2); body.set(DX0 - 4, 59, GOLD.base);

  body.outline(OUTLINE);
  groundShadow(c, 48, 74, 44, 4, 85);
  c.blit(body, 0, 0);
  return { c, window: [WNX0 + WNW / 2, WNY0 + WNH / 2], chimney: [74, 2] };
}

// ---------------------------------------------------------------- map background + wall band

function rockChunks(c, mask, r, chunks, pal) {
  for (const k of chunks) shadeBlob(c, k.cx, k.cy, k.rx, k.ry, pal, r, { mask, tone: k.tone ?? 1 });
}

function mapBackground(sprites) {
  const c = new Canvas(MAP_W, MAP_H);
  // baked floor, seeded per tile
  for (let row = 0; row < MAP_ROWS; row++) for (let col = 0; col < MAP_COLS; col++) {
    c.blit(floorTile(1000 + row * MAP_COLS + col, { pebbles: [1, 3] }), col * T, row * T);
  }
  // --- rock border (outer 12 px, irregular inner edge, top-left lit)
  const B = 12;
  const r = rng(2024);
  const mask = new Uint8Array(MAP_W * MAP_H);
  const seam = new Canvas(MAP_W, MAP_H);
  seam.fillRect(0, 0, MAP_W, B, ROCK.seam); seam.fillRect(0, MAP_H - B, MAP_W, B, ROCK.seam);
  seam.fillRect(0, 0, B, MAP_H, ROCK.seam); seam.fillRect(MAP_W - B, 0, B, MAP_H, ROCK.seam);
  c.blit(seam, 0, 0);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (x < B || y < B || x >= MAP_W - B || y >= MAP_H - B) mask[y * MAP_W + x] = 1;
  const chunks = [];
  // top & bottom rows of chunks
  for (let x = -6; x < MAP_W + 6; x += r.int(6, 12)) {
    const big = r.chance(0.3);
    chunks.push({ cx: x + r.int(-1, 1), cy: r.int(2, 6), rx: big ? r.int(8, 11) : r.int(4, 7), ry: big ? r.int(6, 8) : r.int(3, 6), tone: big ? 1.15 : 1.05 });
    chunks.push({ cx: x + r.int(-1, 1), cy: MAP_H - r.int(3, 7), rx: big ? r.int(8, 11) : r.int(4, 7), ry: big ? r.int(6, 8) : r.int(3, 6), tone: big ? 0.95 : 0.85 });
  }
  for (let y = -6; y < MAP_H + 6; y += r.int(6, 12)) {
    const big = r.chance(0.3);
    chunks.push({ cx: r.int(2, 6), cy: y + r.int(-1, 1), rx: big ? r.int(6, 8) : r.int(3, 6), ry: big ? r.int(8, 11) : r.int(4, 7), tone: big ? 1.1 : 1.0 });
    chunks.push({ cx: MAP_W - r.int(3, 7), cy: y + r.int(-1, 1), rx: big ? r.int(6, 8) : r.int(3, 6), ry: big ? r.int(8, 11) : r.int(4, 7), tone: big ? 0.95 : 0.88 });
  }
  // draw big ones first so the smaller ones sit on top
  chunks.sort((a, b) => b.rx * b.ry - a.rx * a.ry);
  rockChunks(c, mask, r, chunks, ROCK);
  // a few small pebbles wedged in the seams
  for (let i = 0; i < 60; i++) {
    const side = r.int(0, 3);
    const cx = side < 2 ? r.int(2, MAP_W - 3) : side === 2 ? r.int(1, 8) : MAP_W - r.int(2, 9);
    const cy = side === 0 ? r.int(1, 8) : side === 1 ? MAP_H - r.int(2, 9) : r.int(2, MAP_H - 3);
    shadeBlob(c, cx, cy, r.int(1, 2), r.int(1, 2), ROCK_COOL, r, { mask });
  }
  // rock edge: dark line where rock meets floor + 2 px soft shadow on the floor
  const isRock = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && mask[y * MAP_W + x] === 1;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (isRock(x, y)) continue;
    let d = 9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isRock(x + dx, y + dy)) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
    if (d === 1) c.set(x, y, OUTLINE, 200);
    else if (d === 2) c.set(x, y, OUTLINE, 70);
  }
  // --- sparse decorations in the margins (cols 0–1, 10–11, rows 0, 6–7), never in the block area
  const spots = [
    [sprites.rock_1, 20, 22], [sprites.mushroom, 62, 30], [sprites.bones, 300, 26], [sprites.crystal_0, 470, 8],
    [sprites.rock_0, 14, 130], [sprites.mushroom, 70, 190], [sprites.crystal_1, 40, 250],
    [sprites.rock_0, 520, 70], [sprites.bones, 540, 150], [sprites.mushroom, 500, 215], [sprites.rock_1, 546, 232],
    [sprites.mushroom, 130, 302], [sprites.rock_0, 250, 330], [sprites.bones, 360, 306], [sprites.crystal_0, 420, 328],
    [sprites.rock_1, 160, 344], [sprites.mushroom, 300, 352], [sprites.rock_0, 40, 340], [sprites.crystal_1, 540, 320],
  ];
  for (const [spr, x, y] of spots) c.blit(spr, x, y);
  return c;
}

function wallBand() {
  const c = new Canvas(MAP_W, 28);
  const r = rng(3030);
  const mask = new Uint8Array(MAP_W * 28);
  // solid rock mass rows 0..17 with an irregular lower edge
  c.fillRect(0, 0, MAP_W, 17, ROCK.seam);
  for (let y = 0; y < 17; y++) for (let x = 0; x < MAP_W; x++) mask[y * MAP_W + x] = 1;
  const chunks = [];
  for (let x = -6; x < MAP_W + 6; x += r.int(8, 13)) {
    chunks.push({ cx: x, cy: r.int(2, 5), rx: r.int(6, 9), ry: r.int(4, 6), tone: 1.12 });
    chunks.push({ cx: x + r.int(2, 5), cy: r.int(10, 14), rx: r.int(5, 8), ry: r.int(3, 5), tone: 0.95 });
  }
  chunks.sort((a, b) => b.rx * b.ry - a.rx * a.ry);
  rockChunks(c, mask, r, chunks, ROCK);
  // stalactites hanging from the lower edge
  for (let x = 6; x < MAP_W - 10; x += r.int(22, 40)) {
    const w = r.int(4, 8), h = r.int(6, 12);
    stalactiteShape(c, x, 14, w, h, ROCK, r);
  }
  c.outline(OUTLINE);
  // extra: darker seam line under the lit chunks so the mass reads as one wall
  return c;
}

// ---------------------------------------------------------------- entry point

export function generateEnvironment(outDir) {
  const out = {};
  const save = (name, canvas, extra = {}) => {
    savePng(join(outDir, name), canvas);
    out[name] = { w: canvas.w, h: canvas.h, frames: extra.frames ?? 1, ...(extra.extra ? { extra: extra.extra } : {}) };
  };

  // decorations first (map_bg reuses them)
  const sprites = {
    rock_0: rock(0), rock_1: rock(1), mushroom: mushroom(), bones: bones(),
    crystal_0: crystal(0), crystal_1: crystal(1),
  };

  save("block_0.png", blockStone());
  save("block_1.png", blockIce());
  save("block_2.png", blockBasalt());
  save("crack_1.png", crackOverlay(false));
  save("crack_2.png", crackOverlay(true));
  save("floor.png", sheet([floorTile(11), floorTile(12, { pebbles: [3, 5] }), floorTile(13, { cracks: 2 }), floorTile(14, { pebbles: [1, 2], cracks: 0 })]), { frames: 4 });
  save("floor_crystal.png", floorCrystalTile());
  save("crater.png", crater());
  save("map_bg.png", mapBackground(sprites));
  save("wall_band.png", wallBand());
  const h = house();
  save("house.png", h.c, { extra: { window: h.window, chimney: h.chimney } });
  save("rock_0.png", sprites.rock_0);
  save("rock_1.png", sprites.rock_1);
  save("mushroom.png", sprites.mushroom);
  save("bones.png", sprites.bones);
  save("crystal_0.png", sprites.crystal_0);
  save("crystal_1.png", sprites.crystal_1);
  save("stalactite.png", stalactite());
  save("sign.png", sign());
  return out;
}
