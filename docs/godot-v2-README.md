# MinerBlast v2 — Godot 4.7 web client (prototype)

The `godot/` folder is a **second client** for the live MinerBlast game, built
with Godot 4.7.2 and exported to the Web. It runs in parallel with the Phaser
client that is live on minerblast.fun — nothing in `server/` or `contracts/`
changes, and the Phaser pages are untouched. The design is in
[`godot-v2-design.md`](./godot-v2-design.md).

Milestone 1 = the **Mining screen** (ore grid, heroes throwing bombs, pending
BLAST, work/rest, "Mine all", claim) with a much richer game feel: bomb arcs,
explosions with 2D light flashes, particles, screen shake, tweened counters.

## How it fits together

```
client/play2.html + src/play2.ts    host page: wallet / SIWE / REST stay in TypeScript
        │   window.mb  (client/src/bridge/mb.ts — the only thing Godot talks to)
        ▼
client/public/godot/                engine (mb.js + mb.wasm) + content pack (mb-<sha>.pck)
        ▲
godot/  (this project)              scenes, GDScript, sprites — exported headless by
                                    `pnpm godot:export`
```

* Godot never issues HTTP requests; every call goes through `window.mb.invoke(...)`
  (see `docs/godot-v2-design.md` Appendix A for the contract).
* In the **editor** there is no browser, so the game runs on a **mock backend**
  (`scripts/backend/mock_backend.gd` + `mock_server.gd`, a port of the server's
  mining rules with a virtual clock). Press **F1** for the dev panel (scenarios,
  latency, failures, clock, FX toggles).

## Opening the project in Godot 4.7.2 (Windows)

1. Clone/pull the repo. You already have `Godot_v4.7.2-stable_win64.exe`.
2. Launch Godot → **Import** → pick `<repo>\godot\project.godot` → **Import & Edit**
   (the first import generates the `.godot/` cache; it is git-ignored).
3. Press **F5** (Play). The mining screen starts with mock data
   (`resources/fixtures/state_default.json`). **F1** opens the dev panel;
   **F6** on `scenes/mining/mining.tscn` runs that scene alone.
4. Tweak anything visually (colours, animation tracks, particle presets under
   `resources/particles/`), save, commit — the same files drive the web build.

Handy command-line flags (Project → Project Settings is not needed; pass them
after `--` when running from a terminal): `--scenario=rich|empty|claimable|exhausted|almost_cleared|flaky|expired`,
`--no-fx`, `--bomb-mode=reconcile`, `--dev`.

## Sprites

The pixel art is generated from the same character maps as the Phaser client:

```
pnpm godot:sprites        # node godot/tools/gen-sprites.mjs --fx
```

writes `godot/assets/sprites/*.png` (baked at the Phaser scale, so a Sprite2D at
scale 1 matches the current layout 1:1) and `godot/assets/fx/*.png` (particle
and glow textures). Artist-made art replaces these PNGs **by file name** — no
code changes needed. The run is deterministic (re-running leaves git clean).

## Tests (headless)

```
GODOT_BIN=<path-to-godot> pnpm godot:test
```

1. `tests/compile_all.tscn` — compiles every script **with the autoloads
   present** (Godot's `--check-only` cannot see autoload singletons);
2. `tests/test_runner.gd` — unit tests for the models, formatting rules,
   envelope parsing and the mock server;
3. `tests/smoke/` — instantiates the mining scene with mock data and asserts
   the layout (cells, HP bars, rows, popup).

## Web export

Export templates: in the editor, **Editor → Manage Export Templates → Download
and Install** (4.7.2). Then:

```
set GODOT_BIN=C:\Users\Administrador\Downloads\Godot_v4.7.2-stable_win64_console.exe
pnpm godot:export:engine      # first time / new Godot version: engine + pack
pnpm godot:export             # afterwards: content pack only (fast)
```

`godot/tools/export-web.mjs` regenerates sprites, imports, exports with the
**nothreads** Web preset (no SharedArrayBuffer / COOP-COEP headers needed —
that keeps WalletConnect's modal working), and writes:

```
client/public/godot/engine-4.7.2-<sha8>/mb.{js,wasm,audio.worklet.js,audio.position.worklet.js}
client/public/godot/pck/mb-<sha8>.pck          (content-hashed; 2 newest kept)
client/public/godot/manifest.json              {engine, pck, sizes, gitSha, builtAt}
```

Both folders are content-addressed (the engine one by the hash of `mb.wasm`), so
the immutable cache rules in `vercel.json` stay correct across re-exports; only
`manifest.json` changes per deploy and is served `no-cache`.

Vite serves `client/public/` verbatim, so `pnpm --filter @minerblast/client dev`
and opening `http://localhost:5173/play2.html` runs the real thing
(`?mock=1` runs it with demo data, no wallet). `vercel.json` already carries the
cache rules (`engine-*` and `pck/*` immutable, `manifest.json` no-cache).

**Weight, honestly:** `mb.wasm` is ~39.5 MB raw / ~10 MB gzip (Vercel serves
brotli, ~7–8 MB) versus ~1.5 MB / 360 KB for the Phaser bundle. Desktop is
fine; the phone experience is the thing to measure with this prototype before
migrating the other screens.

## Repository layout

```
godot/
  project.godot, export_presets.cfg, icon.svg
  assets/   sprites/ fx/ fonts/ (DejaVu Sans Mono — glyph fallback via DejaVu Sans)
  resources/ theme/ anim/ light/ particles/ fixtures/
  scenes/   main.tscn, mining/*.tscn, ui/*.tscn
  scripts/  autoload/ (Config, Juice, Sfx, Backend, GameState) backend/ model/ util/ ui/ mining/ main.gd
  tests/    compile_all, unit/, smoke/
  tools/    gen-sprites.mjs, export-web.mjs, run-tests.mjs
```
