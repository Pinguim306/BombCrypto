#!/usr/bin/env node
/**
 * run-tests.mjs — Godot-side checks, all headless (Node 18+, zero deps):
 *   1. `--check-only` on every .gd under godot/ (parse + compile);
 *   2. the unit test runner (tests/test_runner.gd);
 *   3. the mining smoke test (tests/smoke/smoke_mining.gd) when present.
 * Exit 1 on the first failure. Any "SCRIPT ERROR" / "ERROR:" line fails a step.
 *
 *   GODOT_BIN=/path/to/godot node godot/tools/run-tests.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GODOT_DIR = join(ROOT, "godot");

function findGodot() {
  if (process.env.GODOT_BIN) return process.env.GODOT_BIN;
  const which = process.platform === "win32" ? "where" : "which";
  for (const name of ["godot4", "godot"]) {
    const r = spawnSync(which, [name], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  }
  console.error("Godot not found — set GODOT_BIN.");
  process.exit(1);
}

const GODOT = findGodot();
const godot = (argv) => {
  const r = spawnSync(GODOT, ["--headless", "--path", GODOT_DIR, ...argv], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  const errors = out.split(/\r?\n/).filter((l) => /^(ERROR|SCRIPT ERROR):/.test(l.trim()));
  return { status: r.status, out, errors };
};

// 1. compile every script WITH the autoloads present (a real main loop: run
//    the compile_all scene; `--check-only -s` cannot see autoload singletons)
{
  const { status, out, errors } = godot(["res://tests/compile_all.tscn"]);
  const tail = out.trim().split(/\r?\n/).filter((l) => /^(OK compiled|FAIL|SCRIPT ERROR)/.test(l)).slice(-30).join("\n");
  console.log(`compile:\n${tail}`);
  if (status !== 0 || errors.length || !/OK compiled \d+/.test(out)) {
    console.error("compile FAILED");
    process.exit(1);
  }
}

// 2. unit tests
{
  const { status, out, errors } = godot(["-s", "res://tests/test_runner.gd"]);
  const tail = out.trim().split(/\r?\n/).slice(-15).join("\n");
  console.log(`\nunit tests:\n${tail}`);
  if (status !== 0 || errors.length || !/\bOK \d+ tests?\b/.test(out)) {
    console.error("unit tests FAILED");
    process.exit(1);
  }
}

// 3. smoke tests — run as SCENES (positional path) so autoloads + MockBackend exist
const SMOKES = [
  ["res://tests/smoke/smoke_mining.tscn", ["--", "--no-fx", "--scenario=default"]],
  ["res://tests/smoke/smoke_fx.tscn", []],
];
for (const [scene, extra] of SMOKES) {
  if (!existsSync(join(GODOT_DIR, scene.replace("res://", "")))) continue;
  const { status, out, errors } = godot([scene, ...extra]);
  const tail = out.trim().split(/\r?\n/).slice(-12).join("\n");
  console.log(`\n${scene}:\n${tail}`);
  if (status !== 0 || errors.length || !/\bOK\b/.test(out)) {
    console.error(`smoke FAILED: ${scene}`);
    process.exit(1);
  }
}
console.log("\nall Godot checks passed");
