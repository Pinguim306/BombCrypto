/**
 * lib.mjs — tiny zero-dependency pixel-art toolkit shared by the MinerBlast
 * art generators (Node 18+). Everything is deterministic: same inputs, same
 * bytes, so a re-run leaves git clean.
 *
 *   const c = new Canvas(32, 32);
 *   c.fillRect(4, 4, 24, 24, 0x8d6e63);
 *   c.outline(0x10141f);                 // 1 px dark outline around opaque pixels
 *   savePng("out.png", c);
 *
 * Colours are 0xRRGGBB ints; alpha is 0..255 (default opaque). `null` /
 * `undefined` colours are skipped (transparent), like the old character maps.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- colours

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rgb = (r, g, b) => ((clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)) >>> 0;
export const split = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
/** Multiplies a colour's brightness (0.8 = darker, 1.2 = lighter). */
export function shade(c, f) {
  const [r, g, b] = split(c);
  return rgb(r * f, g * f, b * f);
}
/** Linear blend a -> b by t (0..1). */
export function mix(a, b, t) {
  const [r1, g1, b1] = split(a), [r2, g2, b2] = split(b);
  return rgb(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
/** Pixel-art friendly ramp: darker + cooler shadows, lighter + warmer highlights. */
export function ramp(base) {
  return {
    dark2: mix(shade(base, 0.45), 0x1a2340, 0.35),
    dark: mix(shade(base, 0.68), 0x1a2340, 0.2),
    base,
    light: mix(shade(base, 1.25), 0xfff3d6, 0.15),
    light2: mix(shade(base, 1.5), 0xfff3d6, 0.35),
  };
}
export const OUTLINE = 0x10141f;   // the one dark outline used across the art

// ---------------------------------------------------------------- deterministic random

/** mulberry32 — the seed decides everything; never use Math.random() in art. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

// ---------------------------------------------------------------- canvas

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 4);
  }
  static from(other) {
    const c = new Canvas(other.w, other.h);
    other.px.copy(c.px);
    return c;
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  /** Sets one pixel (alpha-blended when a < 255). Null colour = no-op. */
  set(x, y, c, a = 255) {
    if (c == null || a <= 0) return;
    x |= 0; y |= 0;
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    const [r, g, b] = split(c);
    if (a >= 255) {
      this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255;
      return;
    }
    const da = this.px[i + 3] / 255, sa = a / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    this.px[i] = Math.round((r * sa + this.px[i] * da * (1 - sa)) / oa);
    this.px[i + 1] = Math.round((g * sa + this.px[i + 1] * da * (1 - sa)) / oa);
    this.px[i + 2] = Math.round((b * sa + this.px[i + 2] * da * (1 - sa)) / oa);
    this.px[i + 3] = Math.round(oa * 255);
  }
  /** Returns [r, g, b, a] or null when outside. */
  get(x, y) {
    if (!this.inside(x, y)) return null;
    const i = (y * this.w + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }
  alpha(x, y) { const p = this.get(x, y); return p ? p[3] : 0; }
  clear(c = null, a = 255) {
    this.px.fill(0);
    if (c != null) this.fillRect(0, 0, this.w, this.h, c, a);
  }
  fillRect(x, y, w, h, c, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
  }
  strokeRect(x, y, w, h, c, a = 255) {
    for (let i = 0; i < w; i++) { this.set(x + i, y, c, a); this.set(x + i, y + h - 1, c, a); }
    for (let j = 0; j < h; j++) { this.set(x, y + j, c, a); this.set(x + w - 1, y + j, c, a); }
  }
  /** Rectangle with the 4 corner pixels dropped (the classic pixel "rounded" look). r = 1 or 2. */
  roundRect(x, y, w, h, c, r = 1, a = 255) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const cx = Math.min(i, w - 1 - i), cy = Math.min(j, h - 1 - j);
        if (r >= 1 && cx === 0 && cy === 0) continue;
        if (r >= 2 && cx + cy < 2 && (cx === 0 || cy === 0)) continue;
        if (r >= 3 && cx + cy < 3 && (cx <= 1 || cy <= 1) && (cx === 0 || cy === 0 || cx + cy === 2)) continue;
        this.set(x + i, y + j, c, a);
      }
    }
  }
  hline(x0, x1, y, c, a = 255) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c, a); }
  vline(x, y0, y1, c, a = 255) { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c, a); }
  line(x0, y0, x1, y1, c, a = 255) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  /** Filled ellipse centred at (cx, cy) with radii rx, ry (pixel centres). */
  ellipse(cx, cy, rx, ry, c, a = 255) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / (rx + 0.5), ny = (y + 0.5 - cy) / (ry + 0.5);
        if (nx * nx + ny * ny <= 1) this.set(x, y, c, a);
      }
    }
  }
  circle(cx, cy, r, c, a = 255) { this.ellipse(cx, cy, r, r, c, a); }
  /** Filled convex/concave polygon (even-odd scanline) — pass [[x,y],...]. */
  polygon(pts, c, a = 255) {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const xs = [];
      const sy = y + 0.5;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c, a);
      }
    }
  }
  /** 1 px outline (4-neighbour) around every opaque pixel, drawn only on transparent pixels. */
  outline(c = OUTLINE, diagonal = false) {
    const src = Canvas.from(this);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.alpha(x, y) > 0) continue;
        const n = src.alpha(x - 1, y) > 0 || src.alpha(x + 1, y) > 0 || src.alpha(x, y - 1) > 0 || src.alpha(x, y + 1) > 0 ||
          (diagonal && (src.alpha(x - 1, y - 1) > 0 || src.alpha(x + 1, y - 1) > 0 || src.alpha(x - 1, y + 1) > 0 || src.alpha(x + 1, y + 1) > 0));
        if (n) this.set(x, y, c);
      }
    }
  }
  /** Replaces every opaque pixel's colour (keeps alpha) — for silhouettes / flashes. */
  tint(c) {
    const [r, g, b] = split(c);
    for (let i = 0; i < this.px.length; i += 4) if (this.px[i + 3] > 0) { this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; }
  }
  /** Multiplies alpha of every pixel. */
  fade(f) { for (let i = 3; i < this.px.length; i += 4) this.px[i] = Math.round(this.px[i] * f); }
  /** Copies `src` at (x, y) with optional horizontal/vertical flip and alpha multiplier. */
  blit(src, x, y, { flipH = false, flipV = false, alpha = 1 } = {}) {
    for (let j = 0; j < src.h; j++) {
      for (let i = 0; i < src.w; i++) {
        const p = src.get(flipH ? src.w - 1 - i : i, flipV ? src.h - 1 - j : j);
        if (!p || p[3] === 0) continue;
        this.set(x + i, y + j, rgb(p[0], p[1], p[2]), Math.round(p[3] * alpha));
      }
    }
  }
  /** Nearest-neighbour integer upscale. */
  scaled(k) {
    const out = new Canvas(this.w * k, this.h * k);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const p = this.get(x, y);
      if (p[3] === 0) continue;
      out.fillRect(x * k, y * k, k, k, rgb(p[0], p[1], p[2]), p[3]);
    }
    return out;
  }
  /** Sub-rectangle copy. */
  crop(x, y, w, h) {
    const out = new Canvas(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const p = this.get(x + i, y + j);
      if (p && p[3] > 0) out.set(i, j, rgb(p[0], p[1], p[2]), p[3]);
    }
    return out;
  }
  /** Shifts content by (dx, dy) — pixels leaving the canvas are lost. */
  shifted(dx, dy) {
    const out = new Canvas(this.w, this.h);
    out.blit(this, dx, dy);
    return out;
  }
  /**
   * Draws a character map: rows of equal-length strings, palette {char: colour}.
   * Unknown characters (and '.') are transparent. Optional integer scale.
   */
  drawMap(rows, palette, x = 0, y = 0, scale = 1) {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const c = palette[ch];
        if (c == null) return;
        this.fillRect(x + i * scale, y + j * scale, scale, scale, c);
      });
    });
    return this;
  }
  /** Vertical gradient fill of a rect (top colour -> bottom colour, optional dither). */
  gradientRect(x, y, w, h, top, bottom, { dither = 0, seed = 1 } = {}) {
    const r = rng(seed);
    for (let j = 0; j < h; j++) {
      let t = h <= 1 ? 0 : j / (h - 1);
      for (let i = 0; i < w; i++) {
        const tt = dither ? clamp(t + (r() - 0.5) * dither, 0, 1) : t;
        this.set(x + i, y + j, mix(top, bottom, tt));
      }
    }
  }
  /** Bounding box of opaque pixels, or null when empty. */
  bounds() {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.alpha(x, y) > 0) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

// ---------------------------------------------------------------- sheets + files

/** Lays frames (same size) out horizontally into one strip. */
export function sheet(frames) {
  const w = frames[0].w, h = frames[0].h;
  const out = new Canvas(w * frames.length, h);
  frames.forEach((f, i) => {
    if (f.w !== w || f.h !== h) throw new Error(`sheet: frame ${i} is ${f.w}x${f.h}, expected ${w}x${h}`);
    out.blit(f, i * w, 0);
  });
  return out;
}

export function savePng(path, canvas) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(canvas.w, canvas.h, canvas.px));
}

// ---------------------------------------------------------------- 5x7 pixel font (A-Z 0-9 + some punctuation)

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
  ",": ["00000", "00000", "00000", "00000", "00000", "00100", "01000"],
  ":": ["00000", "00100", "00000", "00000", "00000", "00100", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** Width in px of a string in the 5x7 font at the given scale (1 px spacing). */
export function textWidth(str, scale = 1) {
  return (str.length * 6 - 1) * scale;
}
/** Draws upper-cased text with the built-in 5x7 font; returns the width drawn. */
export function drawText(canvas, str, x, y, color, { scale = 1, outline = null } = {}) {
  const s = str.toUpperCase();
  let cx = x;
  const tmp = new Canvas(textWidth(s, scale) + 2, 7 * scale + 2);
  for (const ch of s) {
    const g = GLYPHS[ch] ?? GLYPHS["?"];
    tmp.drawMap(g.map((r) => r.replace(/1/g, "#").replace(/0/g, ".")), { "#": color }, cx - x + 1, 1, scale);
    cx += 6 * scale;
  }
  if (outline != null) tmp.outline(outline);
  canvas.blit(tmp, x - 1, y - 1);
  return cx - x;
}
