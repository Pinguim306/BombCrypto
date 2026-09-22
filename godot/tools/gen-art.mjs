#!/usr/bin/env node
/**
 * gen-art.mjs — renders MinerBlast's placeholder pixel art (characters,
 * environment, UI) to godot/assets/art/ and writes the manifest. Zero deps.
 *
 *   node godot/tools/gen-art.mjs                    # all modules
 *   node godot/tools/gen-art.mjs --only chars       # chars | env | ui
 *   node godot/tools/gen-art.mjs --preview <dir>    # also 3x contact sheets for eyeballing
 *
 * See godot/tools/art/CONTRACT.md for the file list. Deterministic: a re-run
 * leaves git clean.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { Canvas, savePng, drawText, OUTLINE } from "./art/lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "godot", "assets", "art");
const ART = join(ROOT, "godot", "tools", "art");

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const previewDir = argv.includes("--preview") ? argv[argv.indexOf("--preview") + 1] : null;

const MODULES = [
  { key: "chars", file: "characters.mjs", fn: "generateCharacters", sub: "chars" },
  { key: "env", file: "environment.mjs", fn: "generateEnvironment", sub: "env" },
  { key: "ui", file: "ui.mjs", fn: "generateUi", sub: "ui" },
];

mkdirSync(OUT, { recursive: true });
const manifestPath = join(OUT, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { generator: "godot/tools/gen-art.mjs", files: {} };
manifest.generator = "godot/tools/gen-art.mjs";
manifest.files ??= {};

for (const m of MODULES) {
  if (only && only !== m.key) continue;
  const path = join(ART, m.file);
  if (!existsSync(path)) {
    console.log(`(skip ${m.key}: ${m.file} not written yet)`);
    continue;
  }
  const mod = await import(pathToFileURL(path).href);
  const outDir = join(OUT, m.sub);
  mkdirSync(outDir, { recursive: true });
  const entries = mod[m.fn](outDir);
  // drop stale entries of this module, then merge
  for (const k of Object.keys(manifest.files)) if (k.startsWith(m.sub + "/")) delete manifest.files[k];
  let n = 0;
  for (const [rel, entry] of Object.entries(entries)) {
    manifest.files[`${m.sub}/${rel}`] = entry;
    n++;
  }
  console.log(`${m.key}: ${n} files → ${outDir}`);
  if (previewDir) writePreview(m, entries, outDir);
}

// stable key order so the manifest diff stays readable
const sorted = { generator: manifest.generator, files: {} };
for (const k of Object.keys(manifest.files).sort()) sorted.files[k] = manifest.files[k];
writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + "\n");
console.log(`manifest → ${manifestPath} (${Object.keys(sorted.files).length} files)`);

/** 3x contact sheet: every file of the module, labelled, on a checker background. */
function writePreview(m, entries, outDir) {
  const files = Object.keys(entries).sort();
  const decoded = files.map((f) => ({ name: f, png: decodePng(readFileSync(join(outDir, f))) }));
  const colW = 200, pad = 6;
  const cols = 3;
  const rows = [];
  let y = 0;
  for (let i = 0; i < decoded.length; i += cols) {
    const group = decoded.slice(i, i + cols);
    const h = Math.max(...group.map((d) => d.png.h)) + 14;
    rows.push({ y, group, h });
    y += h + pad;
  }
  const W = Math.max(colW * cols, ...decoded.map((d) => d.png.w + 8));
  const c = new Canvas(W, y + pad);
  for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) c.set(xx, yy, ((xx >> 3) + (yy >> 3)) & 1 ? 0x2a3142 : 0x232938);
  for (const r of rows) {
    let x = pad;
    for (const d of r.group) {
      const wide = d.png.w > colW - pad;
      c.blit(d.png, x, r.y + 12);
      drawText(c, d.name.replace(".png", ""), x, r.y + 2, 0xffffff, { outline: OUTLINE });
      x += wide ? d.png.w + pad : colW;
    }
  }
  mkdirSync(previewDir, { recursive: true });
  const out = join(previewDir, `${m.key}.png`);
  savePng(out, c.scaled(3));
  console.log(`preview → ${out}`);
}

/** Minimal PNG decoder for our own 8-bit RGBA, non-interlaced, single-IDAT files. */
export function decodePng(buf) {
  let pos = 8;
  let w = 0, h = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  if (colorType !== 6) throw new Error("decodePng: only RGBA supported");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const c = new Canvas(w, h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4] : 0, b = prev[i], cc = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
      line[i] = v & 0xff;
    }
    line.copy(c.px, y * stride);
    prev = line;
  }
  return c;
}
