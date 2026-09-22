#!/usr/bin/env node
/**
 * export-web.mjs — headless Web export of the Godot client into the Vite
 * site (client/public/godot/). Zero dependencies (Node 18+).
 *
 *   GODOT_BIN=/path/to/godot node godot/tools/export-web.mjs            # content only (new .pck)
 *   GODOT_BIN=/path/to/godot node godot/tools/export-web.mjs --engine   # also the engine (new Godot version)
 *   ... --debug                                                          # debug engine build (local tuning)
 *
 * Output (served verbatim by Vite from client/public, cached per vercel.json):
 *   /godot/engine-<ver>/mb.{js,wasm,audio.worklet.js,audio.position.worklet.js}
 *   /godot/pck/mb-<sha8>.pck        content-hashed; the 2 newest are kept
 *   /godot/manifest.json            {engine, pck, sizes, gitSha, builtAt} — never cached
 *
 * Windows: prefer the *_console.exe so Godot's log reaches this script, e.g.
 *   set GODOT_BIN=C:\Users\Administrador\Downloads\Godot_v4.7.2-stable_win64_console.exe
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GODOT_DIR = join(ROOT, "godot");
const PUBLIC = join(ROOT, "client", "public", "godot");
const ENGINE_FILES = ["mb.js", "mb.wasm", "mb.audio.worklet.js", "mb.audio.position.worklet.js"];

const args = new Set(process.argv.slice(2));
const withEngine = args.has("--engine");
const debug = args.has("--debug");

export function findGodot() {
  if (process.env.GODOT_BIN) return process.env.GODOT_BIN;
  const which = process.platform === "win32" ? "where" : "which";
  for (const name of ["godot4", "godot"]) {
    const r = spawnSync(which, [name], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  console.error(
    "Godot not found. Set GODOT_BIN to the Godot 4.7.2 binary, e.g. on Windows:\n" +
    "  set GODOT_BIN=C:\\Users\\Administrador\\Downloads\\Godot_v4.7.2-stable_win64_console.exe"
  );
  process.exit(1);
}

/** Runs a command; fails on non-zero exit or any Godot ERROR / SCRIPT ERROR line. */
export function run(bin, argv, label) {
  console.log(`\n> ${label}`);
  const r = spawnSync(bin, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  const errors = out.split(/\r?\n/).filter((l) => /^(ERROR|SCRIPT ERROR):/.test(l.trim()));
  if (r.status !== 0 || errors.length) {
    console.error(out.split(/\r?\n/).slice(-40).join("\n"));
    console.error(`\n${label} FAILED (exit ${r.status}, ${errors.length} error line(s))`);
    process.exit(1);
  }
  return out;
}

const GODOT = findGodot();
// "4.7.2.stable.official.ed1daf0bf" → "4.7.2" (last line guards against banners)
const verLine = execFileSync(GODOT, ["--version"], { encoding: "utf8" }).trim().split(/\r?\n/).pop();
const version = verLine.split(".").slice(0, 3).join(".");
const debugSuffix = debug ? "-debug" : "";
const sha8 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);
// engine folder = engine-<version>-<sha8 of mb.wasm>[-debug]: content-addressed,
// so the immutable cache rule stays correct even for a same-version re-export
let engineDirName = null;

// 1. placeholder art (deterministic) and the export folder the editor must ignore
run(process.execPath, [join(GODOT_DIR, "tools", "gen-art.mjs")], "art");
mkdirSync(join(GODOT_DIR, "export"), { recursive: true });
writeFileSync(join(GODOT_DIR, "export", ".gdignore"), "");

// 2. import (fresh clones have no .godot/ cache; sidecars are committed)
run(GODOT, ["--headless", "--path", GODOT_DIR, "--import"], "import");

// 3. export
const outDir = join(GODOT_DIR, "export", "web");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (withEngine) {
  run(GODOT, ["--headless", "--path", GODOT_DIR, debug ? "--export-debug" : "--export-release", "Web",
    join(outDir, "mb.html")], `export engine+pck (${debug ? "debug" : "release"})`);
  engineDirName = `engine-${version}-${sha8(readFileSync(join(outDir, "mb.wasm")))}${debugSuffix}`;
  mkdirSync(join(PUBLIC, engineDirName), { recursive: true });
  for (const f of ENGINE_FILES) copyFileSync(join(outDir, f), join(PUBLIC, engineDirName, f));
} else {
  run(GODOT, ["--headless", "--path", GODOT_DIR, "--export-pack", "Web", join(outDir, "mb.pck")], "export pck");
  // reuse the newest engine folder exported for this Godot version
  const re = new RegExp(`^engine-${version.replace(/\./g, "\\.")}-[0-9a-f]{8}${debugSuffix}$`);
  const dirs = existsSync(PUBLIC) ? readdirSync(PUBLIC).filter((d) => re.test(d)) : [];
  dirs.sort((a, b) => statSync(join(PUBLIC, b)).mtimeMs - statSync(join(PUBLIC, a)).mtimeMs);
  engineDirName = dirs[0] ?? null;
}
if (!engineDirName || !existsSync(join(PUBLIC, engineDirName, "mb.wasm"))) {
  console.error(`engine files missing under ${PUBLIC} — run once with --engine`);
  process.exit(1);
}
const engineDir = join(PUBLIC, engineDirName);

// 4. content-hashed pck, keep the two newest
const pck = readFileSync(join(outDir, "mb.pck"));
const pckSha8 = sha8(pck);
const pckDir = join(PUBLIC, "pck");
mkdirSync(pckDir, { recursive: true });
const pckName = `mb-${pckSha8}.pck`;
writeFileSync(join(pckDir, pckName), pck);
const older = readdirSync(pckDir)
  .filter((f) => f.endsWith(".pck"))
  .map((f) => ({ f, t: statSync(join(pckDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)
  .slice(2);
for (const { f } of older) unlinkSync(join(pckDir, f));

// 5. manifest (keys are the exact fetch paths, used for the loader progress)
let gitSha = "unknown";
try { gitSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
const engineBase = `/godot/${engineDirName}/mb`;
const manifest = {
  engine: engineBase,
  pck: `/godot/pck/${pckName}`,
  sizes: { [`${engineBase}.wasm`]: statSync(join(engineDir, "mb.wasm")).size, [`/godot/pck/${pckName}`]: pck.length },
  gitSha,
  builtAt: new Date().toISOString(),
};
writeFileSync(join(PUBLIC, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nmanifest → ${join(PUBLIC, "manifest.json")}\n${JSON.stringify(manifest, null, 2)}`);
