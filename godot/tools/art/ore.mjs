/**
 * ore.mjs — MinerBlast ore deposits (env/ore_{tier}_{variant}.png).
 *
 * The 40 server "blocks" are drawn as organic ore mounds scattered over the
 * 3/4 top-down cave floor (48 px tiles). Every file is a strip of 3 frames
 * (48×48 each): 0 intact · 1 lightly damaged · 2 heavily damaged.
 *
 *   tier 0  stone + gold nuggets          tier 1  ice + cyan crystals
 *   tier 2  basalt + glowing magma grooves
 *   variant 0  taller, lopsided mound     variant 1  wider, lower mound
 *
 * A mound is the union of 4–6 seeded irregular polygons ("lobes") stacked
 * back-to-front; each front chunk gets a lit top-left rim and a dark seam in
 * the chunk behind it, so the pile reads as faceted rock lit from the
 * top-left. Damage is cumulative: bites are cut out of the silhouette (the
 * outline is re-applied), cracks grow, gems fall off, rubble lands on the
 * floor. Deterministic: everything comes from `rng(seed)`.
 */
import { join } from "node:path";
import { Canvas, OUTLINE, ramp, mix, rng, sheet, savePng, clamp } from "./lib.mjs";

const T = 48;

// ---------------------------------------------------------------- palettes

const GOLD = { dark2: 0x7a4c05, dark: 0xb8860b, base: 0xffca28, light: 0xffe082, light2: 0xfff3b0 };
const CRYSTAL = { dark2: 0x0b4d73, dark: 0x1e8ac4, base: 0x4fc3f7, light: 0xb3ecff, light2: 0xecfbff };
const MAGMA = { core: 0xffca28, hot: 0xff7043, ember: 0xffab40, emberHot: 0xffe082, scorch: 0x140c10 };
const CRACK_DARK = 0x0d0b12;

/** Rock tone ladder: dark2 dark base mid light light2 (bottom/shadow → top/lit). */
function rockPal(topHex, botHex, midMix = 1) {
  const top = ramp(topHex), bot = ramp(botHex);
  return { dark2: bot.dark2, dark: bot.dark, base: bot.base, mid: mix(bot.base, top.base, midMix), light: top.light, light2: top.light2 };
}

const TIERS = [
  { name: "stone", pal: rockPal(0x8d6e63, 0x7e6152), verts: 5, jitter: 0.22 },
  { name: "ice", pal: { ...rockPal(0xbdd6e6, 0x7f9bb5, 0.5), light: 0xbdd6e6, light2: 0xe4f1f8 }, verts: 3, jitter: 0.28 },
  { name: "basalt", pal: rockPal(0x5a5262, 0x352f3c), verts: 3, jitter: 0.27 },
];

// ---------------------------------------------------------------- silhouettes

/**
 * Lobes per variant, listed back → front (drawn in this order, later ones
 * overlap earlier ones). {cx, cy, rx, ry} ellipse-ish; polygonised with
 * seeded radial jitter so no two tiers share an outline.
 */
const LOBES = [
  // variant 0: taller, lopsided — peak left of centre (top y≈9), base y≈41, width ≈38
  [
    { cx: 19, cy: 21, rx: 12, ry: 11.5 },   // peak
    { cx: 32, cy: 26, rx: 9, ry: 8 },       // right shoulder
    { cx: 24, cy: 31, rx: 19, ry: 10.5 },   // main body
    { cx: 34, cy: 36, rx: 8.5, ry: 5.5 },   // front-right chunk
    { cx: 13, cy: 36, rx: 7.5, ry: 5.5 },   // front-left chunk
  ],
  // variant 1: wider, lower — two humps (top y≈14), base y≈40, width ≈42
  [
    { cx: 16, cy: 24, rx: 10, ry: 9.5 },    // left hump
    { cx: 31, cy: 22, rx: 9.5, ry: 8.5 },   // right hump (the higher one)
    { cx: 41, cy: 31, rx: 5.5, ry: 5 },     // right bump
    { cx: 24, cy: 31, rx: 21, ry: 9 },      // main body
    { cx: 29, cy: 37, rx: 10, ry: 4.5 },    // front-right slab
    { cx: 11, cy: 36, rx: 7, ry: 4.5 },     // front-left chunk
  ],
];

/** Irregular polygon around an ellipse: vertex count grows with size (no long flat runs), radius jittered by ±jitter/2. */
function lobePolygon(l, extra, jitter, r) {
  const n = Math.round(extra + (l.rx + l.ry) / 3.2);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = ((k + r() * 0.35) / n) * Math.PI * 2;
    const rad = 1 + (r() - 0.5) * jitter;
    pts.push([l.cx + Math.cos(a) * l.rx * rad, l.cy + Math.sin(a) * l.ry * rad]);
  }
  return pts;
}

function inEllipse(x, y, cx, cy, rx, ry) {
  const nx = (x + 0.5 - cx) / (rx + 0.5), ny = (y + 0.5 - cy) / (ry + 0.5);
  return nx * nx + ny * ny <= 1;
}

/** Owner map: for each pixel the index of the front-most lobe covering it, or -1. */
function ownerMap(polys, bites) {
  const owner = new Int8Array(T * T).fill(-1);
  polys.forEach((pts, i) => {
    const m = new Canvas(T, T);
    m.polygon(pts, 0xffffff);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (m.alpha(x, y) > 0) owner[y * T + x] = i;
  });
  for (const b of bites) {
    for (let y = Math.floor(b.y - b.ry) - 1; y <= Math.ceil(b.y + b.ry) + 1; y++) {
      for (let x = Math.floor(b.x - b.rx) - 1; x <= Math.ceil(b.x + b.rx) + 1; x++) {
        if (x >= 0 && y >= 0 && x < T && y < T && inEllipse(x, y, b.x, b.y, b.rx, b.ry)) owner[y * T + x] = -1;
      }
    }
  }
  return owner;
}

const own = (owner, x, y) => (x >= 0 && y >= 0 && x < T && y < T ? owner[y * T + x] : -1);

function ownerBounds(owner) {
  let x0 = T, y0 = T, x1 = -1, y1 = -1;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (owner[y * T + x] >= 0) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** True when (x, y) and its 4 neighbours are all inside the mound (keeps gems off the rim). */
function deepInside(owner, x, y, d = 1) {
  for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (own(owner, x + dx, y + dy) < 0) return false;
  return true;
}

/** Boundary pixels of the mound (inside, with an outside 4-neighbour). */
function edgePixels(owner) {
  const out = [];
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (own(owner, x, y) < 0) continue;
    if (own(owner, x - 1, y) < 0 || own(owner, x + 1, y) < 0 || own(owner, x, y - 1) < 0 || own(owner, x, y + 1) < 0) out.push([x, y]);
  }
  return out;
}

// ---------------------------------------------------------------- texture helpers (env look)

/**
 * Chunk markers: rounded cobbles laid over the body; the shader shifts the tone
 * ladder by the marker (lo/hi body, lit top edge, dark bottom edge) so the
 * cobbles follow the mound's own lighting gradient.
 */
const MARK = { lo: 0x000001, hi: 0x000002, edgeL: 0x000003, edgeD: 0x000004 };
function chunkMarks(c, r, { count = 6, minW = 4, maxW = 9, minH = 3, maxH = 5 } = {}) {
  for (let i = 0; i < count; i++) {
    const cw = r.int(minW, maxW), ch = r.int(minH, maxH);
    const cx = r.int(4, T - 4 - cw), cy = r.int(10, T - 8 - ch);
    const tone = r.chance(0.5) ? MARK.lo : MARK.hi;
    if (r.chance(0.5)) c.roundRect(cx, cy, cw, ch, tone, 2);
    else c.ellipse(cx + cw / 2, cy + ch / 2, cw / 2 - 0.5, ch / 2 - 0.5, tone);
    c.hline(cx + 2, cx + cw - 3, cy, MARK.edgeL);
    c.hline(cx + 2, cx + cw - 3, cy + ch - 1, MARK.edgeD);
    c.set(cx + cw - 1, cy + Math.floor(ch / 2), MARK.edgeD);
  }
}

/** Random-walk crack polyline (gentle wobble, pulled back toward its heading). */
function crackPath(r, x, y, len, angle, { wobble = 0.55, pull = 0.15, step = 1.15 } = {}) {
  const pts = [[Math.round(x), Math.round(y)]];
  let cx = x, cy = y, a = angle;
  for (let i = 0; i < len; i++) {
    a += (r() - 0.5) * wobble;
    if (r.chance(0.1)) a += (r.chance(0.5) ? 1 : -1) * 0.75;   // occasional kink
    a += (angle - a) * pull;
    cx += Math.cos(a) * step; cy += Math.sin(a) * step;
    pts.push([Math.round(cx), Math.round(cy)]);
  }
  return pts;
}

/** Splits a path into the runs (≥ 2 points) that lie inside the mound, `d` px away from its edge. */
function clipRuns(pts, owner, d = 0) {
  const runs = [];
  let run = [];
  for (const p of pts) {
    const ok = d > 0 ? deepInside(owner, p[0], p[1], d) : own(owner, p[0], p[1]) >= 0;
    if (ok) run.push(p);
    else { if (run.length > 1) runs.push(run); run = []; }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Paints crack polylines: dark groove + 1 px lit edge on the bottom-right (the wall facing the light). */
function paintCracks(c, owner, paths, { dark = CRACK_DARK, darkA = 235, light = 0xffffff, lightA = 60, thickStart = false } = {}) {
  const grooves = new Canvas(T, T);
  for (const pts of paths) {
    for (let i = 0; i + 1 < pts.length; i++) grooves.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], dark);
    if (thickStart) { const [sx, sy] = pts[0]; if (own(owner, sx + 1, sy) >= 0) grooves.set(sx + 1, sy, dark); if (own(owner, sx, sy + 1) >= 0) grooves.set(sx, sy + 1, dark); }
  }
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (grooves.alpha(x, y) > 0) c.set(x, y, dark, darkA);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (grooves.alpha(x, y) === 0) continue;
    if (grooves.alpha(x + 1, y) === 0 && own(owner, x + 1, y) >= 0) c.set(x + 1, y, light, lightA);
    else if (grooves.alpha(x, y + 1) === 0 && own(owner, x, y + 1) >= 0) c.set(x, y + 1, light, lightA);
  }
}

/** Gold nugget (env look): rounded lump, lit top, dark bottom-right, dark2 outline. */
function nugget(c, x, y, w, h, pal, lump) {
  const tmp = new Canvas(T, T);
  tmp.roundRect(x, y, w, h, pal.base, 1);
  if (lump) tmp.set(x + w - 1, y - 1, pal.base);
  tmp.hline(x + 1, x + w - 2, y, pal.light);
  tmp.set(x + 1, y + 1, pal.light2); if (w > 4) tmp.set(x + 2, y + 1, pal.light2);
  tmp.hline(x + 1, x + w - 1, y + h - 1, pal.dark);
  tmp.vline(x + w - 1, y + 1, y + h - 2, pal.dark);
  tmp.outline(pal.dark2);
  c.blit(tmp, 0, 0);
}

/**
 * Crystal cluster (env look): tall diamonds with a lit left facet, dark right
 * facet and a bright core. Its dark-cyan outline is only painted where it sits
 * over rock; where a shard rises into the open the sprite's single outline
 * pass takes over (no double outline).
 */
function crystalCluster(c, x, y, pal, shards) {
  const sorted = [...shards].sort((a, b) => b.h - a.h);
  const tmp = new Canvas(T, T);
  for (const s of sorted) {
    const cx = x + s.dx, top = y - s.h, hw = Math.floor(s.w / 2);
    const sh = Math.floor(s.h * 0.3);
    if (s.broken) {
      // snapped shard: a stump with a jagged, dark break surface and no bright core
      tmp.polygon([[cx - hw, top + 1], [cx + 1, top], [cx + hw + 1, top + 2], [cx + hw + 1, y + 1], [cx - hw, y + 1]], pal.dark);
      tmp.polygon([[cx - hw, top + 1], [cx + 1, top], [cx + 1, y + 1], [cx - hw, y + 1]], pal.base);
      for (let i = -hw; i <= hw; i++) tmp.set(cx + i, top + (i <= 0 ? 1 : 2) - (i % 2 === 0 ? 0 : 1), pal.dark2);
      tmp.set(cx + 1, top, pal.dark2);
      tmp.set(cx - hw, top + 2, pal.light);
      continue;
    }
    tmp.polygon([[cx, top], [cx + hw + 1, y - sh], [cx + hw + 1, y + 1], [cx - hw, y + 1], [cx - hw, y - sh]], pal.dark);
    tmp.polygon([[cx, top], [cx + 1, y - sh], [cx + 1, y + 1], [cx - hw, y + 1], [cx - hw, y - sh]], pal.base);
    tmp.line(cx - hw, y - sh, cx, top, pal.light);
    const coreY = top + Math.max(2, Math.floor(s.h * 0.35));
    tmp.set(cx, coreY, pal.light2); tmp.set(cx, coreY + 1, pal.light);
    tmp.set(cx - 1, coreY + 1, pal.light);
  }
  const ol = Canvas.from(tmp);
  ol.outline(mix(pal.dark2, OUTLINE, 0.5));
  for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) {
    const p = ol.get(xx, yy);
    if (p[3] === 0) continue;
    if (tmp.alpha(xx, yy) > 0 || c.alpha(xx, yy) > 0) c.set(xx, yy, (p[0] << 16) | (p[1] << 8) | p[2], p[3]);
  }
}

// ---------------------------------------------------------------- plan (per tier × variant)

function makePlan(tier, variant) {
  const seed = 9100 + tier * 31 + variant * 7;
  const r = rng(seed);
  const tp = TIERS[tier];
  const polys = LOBES[variant].map((l) => lobePolygon(l, tp.verts, tp.jitter, r));
  const noise = new Float32Array(T * T);
  for (let i = 0; i < noise.length; i++) noise[i] = r();

  const intact = ownerMap(polys, []);
  const b = ownerBounds(intact);
  const h = b.y1 - b.y0, w = b.x1 - b.x0;
  const cx = (b.x0 + b.x1) / 2, cy = b.y0 + h * 0.6;

  // --- crystal clusters (tier 1) are placed first: bites must keep clear of their bases
  const clusters = [];
  if (tier === 1) {
    // main cluster on the highest lobe (survives to frame 2 as a stump), a small one on a shoulder (knocked off in frame 2)
    const peak = variant === 0 ? [19, b.y0 + 5] : [31, b.y0 + 5];
    clusters.push({
      x: peak[0], y: peak[1],
      shards: [{ dx: 0, w: 5, h: r.int(11, 13) }, { dx: -5, w: 4, h: r.int(6, 8) }, { dx: 5, w: 4, h: r.int(7, 9) }, { dx: -8, w: 3, h: r.int(3, 5) }],
      breakAt: 0, keep: 11,
    });
    const side = variant === 0 ? [34, b.y0 + h * 0.55] : [13, b.y0 + h * 0.5];
    clusters.push({ x: Math.round(side[0]), y: Math.round(side[1]), shards: [{ dx: 0, w: 4, h: r.int(6, 8) }, { dx: 4, w: 3, h: r.int(3, 5) }], fragile: true, keep: 5 });
  }
  const keepOut = clusters.map((cl) => ({ x: cl.x, y: cl.y - 2, d: cl.keep }));

  // --- bites: edge points on the upper 60 %, spread left/right/top; the centre sits 1 px
  // outside the silhouette so the cut reads as a notch, not a hole
  const edge = edgePixels(intact).filter(([x, y]) => y < b.y0 + h * 0.62 && y > b.y0 + 1 && keepOut.every((k) => Math.hypot(x - k.x, y - k.y) >= k.d));
  const pickEdge = (pred, taken, minDist) => {
    const cands = edge.filter(([x, y]) => pred(x, y) && taken.every(([tx, ty]) => Math.hypot(x - tx, y - ty) >= minDist));
    return cands.length ? cands[r.int(0, cands.length - 1)] : null;
  };
  const taken = [];
  const bites = [];
  const sides = variant === 0 ? ["right", "top", "left", "right"] : ["left", "top", "right", "left"];
  for (const side of sides) {
    const pred = side === "left" ? (x, y) => x < cx - 7 && y > b.y0 + h * 0.15
      : side === "right" ? (x, y) => x > cx + 7 && y > b.y0 + h * 0.15
        : (x, y) => y < b.y0 + h * 0.28 && Math.abs(x - cx) < 12;
    const p = pickEdge(pred, taken, 10);
    if (!p) continue;
    taken.push(p);
    const k = bites.length;
    const nx = p[0] - cx, ny = p[1] - cy, nl = Math.hypot(nx, ny) || 1;
    bites.push({ x: p[0] + (nx / nl) * 1.2, y: p[1] + (ny / nl) * 1.2, r1: k < 2 ? 3 : 0, r2: k < 2 ? r.int(4, 5) : r.int(3, 4), from: side });
  }
  const lightOwner = ownerMap(polys, bites.filter((bt) => bt.r1 > 0).map((bt) => ({ x: bt.x, y: bt.y, rx: bt.r1, ry: bt.r1 * 0.85 })));

  // --- cracks: from bites inward, plus one from the top running down and one across (frame 2)
  const cracks = [];
  bites.forEach((bt, i) => {
    const ang = Math.atan2(cy - bt.y, cx - bt.x) + (r() - 0.5) * 0.5;
    cracks.push({ pts: crackPath(r, bt.x, bt.y, r.int(11, 14), ang), frame: i < 2 ? 1 : 2 });
    if (i < 2 && r.chance(0.7)) {
      const p = cracks[cracks.length - 1].pts;
      const mid = p[Math.floor(p.length * 0.5)];
      cracks.push({ pts: crackPath(r, mid[0], mid[1], r.int(5, 7), ang + (r.chance(0.5) ? 1 : -1) * (0.7 + r() * 0.4)), frame: 2 });
    }
  });
  cracks.push({ pts: crackPath(r, cx + r.int(-5, 5), b.y0 + 2, r.int(9, 12), Math.PI / 2 + (r() - 0.5) * 0.8), frame: 1 });
  cracks.push({ pts: crackPath(r, cx + (variant ? -9 : 9), b.y0 + h * 0.5, r.int(7, 10), (variant ? -0.3 : Math.PI + 0.3) + (r() - 0.5) * 0.4), frame: 2 });

  // --- gold nuggets (tier 0): all of them survive the light-damage silhouette; fragile ones fall off in frame 2
  const nuggets = [];
  if (tier === 0) {
    const n = r.int(5, 6);
    let tries = 0;
    while (nuggets.length < n && tries++ < 300) {
      const w = r.int(4, 7), hh = r.int(3, 5);
      const x = r.int(b.x0 + 3, b.x1 - 3 - w), y = r.int(b.y0 + 3, b.y1 - 4 - hh);
      if (!rectInside(lightOwner, x - 2, y - 2, w + 4, hh + 4)) continue;
      if (nuggets.some((g) => x < g.x + g.w + 3 && x + w + 3 > g.x && y < g.y + g.h + 3 && y + hh + 3 > g.y)) continue;
      nuggets.push({ x, y, w, h: hh, lump: r.chance(0.6), fragile: nuggets.length > 0 && r.chance(0.45) });
    }
  }

  // --- magma grooves (tier 2): a long one across the lower half, a short one dropping from the top (goes cold in frame 2), one from the right
  const grooves = [];
  if (tier === 2) {
    grooves.push({ pts: crackPath(r, b.x0 + 7, b.y0 + h * 0.62, 30, (r() - 0.5) * 0.4 - 0.15, { wobble: 0.5, pull: 0.1 }), fragile: false });
    grooves.push({ pts: crackPath(r, cx + r.int(-4, 4), b.y0 + 5, 13, Math.PI / 2 + (variant ? 0.5 : -0.5) + (r() - 0.5) * 0.4, { wobble: 0.5, pull: 0.12 }), fragile: true });
    grooves.push({ pts: crackPath(r, b.x1 - 5, b.y0 + h * 0.78, 12, Math.PI + 0.35 + (r() - 0.5) * 0.4, { wobble: 0.5, pull: 0.12 }), fragile: false });
  }
  const embers = [];
  for (let i = 0; i < 7; i++) embers.push({ x: r.int(b.x0 + 3, b.x1 - 3), y: r.int(b.y0 + 4, b.y1 - 3), hot: r.chance(0.4) });
  const glints = [];
  for (let i = 0; i < 8; i++) glints.push({ x: r.int(b.x0 + 3, b.x1 - 5), y: r.int(b.y0 + 3, b.y1 - 6), w: r.int(1, 3) });
  const sheen = [];
  for (let i = 0; i < 3; i++) sheen.push({ x: r.int(b.x0 + 3, cx - 2), y: r.int(b.y0 + 5, b.y0 + h * 0.4) });

  // --- rubble around the base (frame 2)
  const rubble = [];
  for (let i = 0; i < 9; i++) {
    const left = r.chance(0.5);
    rubble.push({ x: left ? b.x0 - r.int(0, 5) : b.x1 + r.int(0, 5), y: b.y1 - r.int(-3, 3), big: r.chance(0.4) });
  }
  rubble.push({ x: r.int(b.x0 + 6, cx - 4), y: b.y1 + r.int(2, 4), big: true });
  rubble.push({ x: r.int(cx + 4, b.x1 - 6), y: b.y1 + r.int(2, 4), big: false });

  // chunk marker layer (shared by all frames)
  const marks = new Canvas(T, T);
  chunkMarks(marks, r, { count: tier === 1 ? 5 : 7, minW: tier === 1 ? 6 : 4, maxW: tier === 1 ? 11 : 9 });

  return { tier, variant, seed, pal: tp.pal, polys, noise, bites, cracks, nuggets, clusters, grooves, embers, glints, sheen, rubble, marks, bounds: b };
}

// ---------------------------------------------------------------- rendering

const LADDER = (p) => [p.dark2, p.dark, p.base, p.mid, p.light, p.light2];

function renderFrame(plan, frame) {
  const { pal, tier } = plan;
  const bites = plan.bites.map((b) => ({ x: b.x, y: b.y, rx: frame === 1 ? b.r1 : frame === 2 ? b.r2 : 0, ry: (frame === 1 ? b.r1 : frame === 2 ? b.r2 : 0) * 0.85 })).filter((b) => b.rx > 0);
  const owner = ownerMap(plan.polys, bites);
  const { x0, y0, x1, y1 } = ownerBounds(owner);
  const ladder = LADDER(pal);
  const body = new Canvas(T, T);

  // --- rock body
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const o = own(owner, x, y);
    if (o < 0) continue;
    const oL = own(owner, x - 1, y), oU = own(owner, x, y - 1), oR = own(owner, x + 1, y), oD = own(owner, x, y + 1);
    const t = (y - y0) / Math.max(1, y1 - y0), u = (x - x0) / Math.max(1, x1 - x0);
    const outerTL = oL < 0 || oU < 0, outerBR = oR < 0 || oD < 0;
    let col;
    if (outerBR && !outerTL) col = pal.dark2;
    else if (outerTL && !outerBR) col = t < 0.45 ? pal.light2 : pal.light;
    else if (outerTL && outerBR) col = pal.base;
    else if (oR > o || oD > o) col = pal.dark2;                       // crevice behind a front chunk
    else if (oL < o || oU < o) col = t < 0.5 ? pal.light : pal.mid;   // lit rim of a front chunk
    else if (oR < o || oD < o) col = pal.dark;                        // shaded rim of a front chunk
    else {
      let idx = 4.0 - 3.1 * t - 0.6 * u;
      const m = plan.marks.get(x, y);
      if (m && m[3] > 0) {
        const mk = m[2];
        idx += mk === 1 ? -0.7 : mk === 2 ? 0.7 : mk === 3 ? 1.0 : -1.0;
      }
      idx += (plan.noise[y * T + x] - 0.5) * 0.9;
      col = ladder[clamp(Math.round(idx), 0, 5)];
      if (!deepInside(owner, x, y, 2) && !deepInside(owner, x, y + 1, 1) && t > 0.5) col = mix(col, pal.dark, 0.5);   // 2nd shadow row on the ground side
    }
    body.set(x, y, col);
  }

  // --- damage cracks (under the gems: an intact nugget never has a crack painted across it)
  if (frame >= 1) {
    const paths = plan.cracks.filter((c) => c.frame <= frame).flatMap((c) => clipRuns(c.pts, owner)).filter((p) => p.length > 2);
    paintCracks(body, owner, paths, { lightA: tier === 2 ? 115 : 70, darkA: frame === 2 ? 240 : 225, thickStart: frame === 2 });
  }

  // --- tier features
  if (tier === 0) {
    const nugs = plan.nuggets.filter((g) => !(frame === 2 && g.fragile) && rectInside(owner, g.x - 1, g.y - 2, g.w + 2, g.h + 3));
    for (const g of nugs) nugget(body, g.x, g.y, g.w, g.h, GOLD, g.lump);
    // sparkles: a white glint on the two biggest nuggets, a small + on the first
    const byArea = [...nugs].sort((a, b) => b.w * b.h - a.w * a.h);
    byArea.slice(0, frame === 2 ? 1 : 2).forEach((g, i) => {
      body.set(g.x, g.y - 1, 0xffffff);
      if (i === 0 && frame < 2) { body.set(g.x - 1, g.y - 1, GOLD.light2); body.set(g.x, g.y - 2, GOLD.light2); }
    });
  }
  if (tier === 1) {
    for (const g of plan.glints) if (deepInside(owner, g.x, g.y, 1) && deepInside(owner, g.x + g.w, g.y, 1)) body.hline(g.x, g.x + g.w, g.y, 0xffffff, 130);
    // icy sheen: short diagonal light strokes just inside the lit top-left rim
    for (const s of plan.sheen) if (deepInside(owner, s.x, s.y, 1) && deepInside(owner, s.x + 2, s.y - 2, 1)) { body.set(s.x, s.y, pal.light2); body.set(s.x + 1, s.y - 1, pal.light2); body.set(s.x + 2, s.y - 2, 0xffffff, 200); }
    for (const cl of plan.clusters) {
      if (!rectInside(owner, cl.x - 3, cl.y - 1, 7, 3)) continue;          // base broken away
      if (cl.fragile && frame === 2) continue;                              // knocked off
      let shards = cl.shards.map((s) => ({ ...s, broken: false }));
      if (frame === 2 && cl.breakAt != null) {
        // heavy damage: the tallest shard is snapped to a stump, the smallest one is gone
        shards = shards.slice(0, -1);
        shards[0] = { ...shards[0], h: Math.max(4, Math.round(shards[0].h * 0.45)), broken: true };
      }
      crystalCluster(body, cl.x, cl.y, CRYSTAL, shards);
    }
  }
  if (tier === 2) {
    const glow = new Canvas(T, T);
    const cold = new Canvas(T, T);
    for (const g of plan.grooves) {
      const cut = frame === 2 && g.fragile ? Math.floor(g.pts.length * 0.45) : g.pts.length;
      const idx = new Map(g.pts.map((p, i) => [p, i]));
      for (const pts of clipRuns(g.pts, owner, 1)) {
        if (pts.length < 3) continue;
        for (let i = 0; i + 1 < pts.length; i++) (idx.get(pts[i]) < cut ? glow : cold).line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], MAGMA.hot);
      }
    }
    // faint warm halo (2 px, alpha-blended), scorched edge below/right of the groove
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if (glow.alpha(x, y) === 0) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d === 0 || glow.alpha(x + dx, y + dy) > 0 || own(owner, x + dx, y + dy) < 0) continue;
        body.set(x + dx, y + dy, MAGMA.hot, d === 1 ? 70 : 28);
      }
    }
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if (glow.alpha(x, y) === 0) continue;
      if (glow.alpha(x, y + 1) === 0 && own(owner, x, y + 1) >= 0) body.set(x, y + 1, MAGMA.scorch, 150);
      if (glow.alpha(x + 1, y) === 0 && own(owner, x + 1, y) >= 0) body.set(x + 1, y, MAGMA.scorch, 110);
    }
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if (cold.alpha(x, y) > 0 && glow.alpha(x, y) === 0) body.set(x, y, CRACK_DARK, 220);
      if (glow.alpha(x, y) === 0) continue;
      const hot = ((x * 3 + y * 5) % 7) < 2;
      body.set(x, y, hot ? MAGMA.core : MAGMA.hot);
    }
    const embers = plan.embers.slice(0, frame === 2 ? 4 : 7);
    for (const e of embers) if (deepInside(owner, e.x, e.y, 1) && glow.alpha(e.x, e.y) === 0) body.set(e.x, e.y, e.hot ? MAGMA.emberHot : MAGMA.ember, 210);
  }

  body.outline(OUTLINE);

  // --- compose: ground shadow, body, rubble
  const c = new Canvas(T, T);
  const ib = plan.bounds;
  c.ellipse((ib.x0 + ib.x1) / 2 + 1, ib.y1 + 1, (ib.x1 - ib.x0) / 2 + 1.5, 3.2, 0x000000, 90);
  c.blit(body, 0, 0);
  if (frame === 2) {
    const gem = tier === 0 ? [GOLD.base, GOLD.dark2] : tier === 1 ? [CRYSTAL.base, CRYSTAL.dark2] : [MAGMA.ember, MAGMA.scorch];
    const clear = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (body.alpha(xx, yy) > 0) return false; return true; };
    plan.rubble.forEach((rb, i) => {
      const isGem = i === plan.rubble.length - 1 || i === 2;
      const [lit, dk] = isGem ? gem : [rb.big ? pal.mid : pal.base, pal.dark];
      if (rb.big) {
        // tiny outlined chunk: lit top row, dark bottom row
        if (!clear(rb.x - 1, rb.y - 1, 4, 4)) return;
        c.hline(rb.x, rb.x + 1, rb.y, lit); c.hline(rb.x, rb.x + 1, rb.y + 1, dk);
        c.hline(rb.x, rb.x + 1, rb.y - 1, OUTLINE); c.hline(rb.x, rb.x + 1, rb.y + 2, OUTLINE);
        c.vline(rb.x - 1, rb.y, rb.y + 1, OUTLINE); c.vline(rb.x + 2, rb.y, rb.y + 1, OUTLINE);
      } else {
        if (!clear(rb.x, rb.y, 2, 2)) return;
        c.set(rb.x, rb.y, lit); c.set(rb.x + 1, rb.y, OUTLINE); c.set(rb.x, rb.y + 1, OUTLINE);
      }
    });
  }
  return c;
}

function rectInside(owner, x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (own(owner, xx, yy) < 0) return false;
  return true;
}

// ---------------------------------------------------------------- entry points

/** All six strips as Canvas objects: { "ore_0_0.png": Canvas(144×48), ... }. */
export function oreStrips() {
  const out = {};
  for (let tier = 0; tier < 3; tier++) for (let variant = 0; variant < 2; variant++) {
    const plan = makePlan(tier, variant);
    out[`ore_${tier}_${variant}.png`] = sheet([renderFrame(plan, 0), renderFrame(plan, 1), renderFrame(plan, 2)]);
  }
  return out;
}

export function generateOre(outDir) {
  const out = {};
  for (const [name, strip] of Object.entries(oreStrips())) {
    savePng(join(outDir, name), strip);
    out[name] = { w: T, h: T, frames: 3 };
  }
  return out;
}
