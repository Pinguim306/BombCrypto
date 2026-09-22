# MinerBlast v2 art contract (placeholder generation + final art hand-off)

Every file below is a PNG with a transparent background, drawn at **1× pixel
scale** (no upscaling inside the file), nearest-neighbour filtered in Godot.
Artist-made or AI-made final art replaces a file **by name and size**; the
scene never needs to change. Strips are horizontal (frame i at x = i * w).

Style pillars (the whole set must read as one game):

* chunky, saturated, slightly cartoon pixel art; **1 px dark outline**
  (`OUTLINE = 0x10141f`) around every sprite; light from the **top-left**,
  cool shadows / warm highlights (`ramp()` in `lib.mjs`);
* palette: cave navy `#141a27`, rock `#5d4a3a..#8d6e63`, gold `#ffca28`,
  wood `#8b5a2b / #a0673a / #c98b4b`, blood-red ribbon `#c62828`,
  rarity colours `9e9e9e 66bb6a 42a5f5 ab47bc ffa726 ef5350`;
* heroes have big heads (~45 % of height), short legs, expressive eyes;
* nothing is copied from any existing game: original silhouettes,
  headgear and props.

Output root: `godot/assets/art/`. Sub-folders `chars/`, `env/`, `ui/`.
The generator writes `godot/assets/art/manifest.json` with one entry per
file: `{ w, h, frames, anims?, fps?, margins?, extra? }`.

## chars/ (characters.mjs)

| file | size | frames | notes |
|---|---|---|---|
| `hero_{0..5}.png` | 32×32 ×11 | idle 0–1 · walk 2–5 · throw 6–8 · sleep 9–10 | faces **right**; feet baseline y=30, centred x=16; outfit = rarity colour; headgear per rarity: 0 cloth cap · 1 bandana+goggles · 2 mining helmet with head-lamp · 3 hooded with small horns · 4 gold crown + cape · 5 demon horns + flame hair. Backpack/pouch on all. Throw: wind-up (arm back), release (arm forward, bomb gone), recover. Sleep: sitting, eyes closed, 2-frame breathing. |
| `portrait_{0..5}.png` | 32×32 | 1 | bust close-up for HUD cards (head fills ~70 %) |
| `hero_shadow.png` | 20×8 | 1 | soft black ellipse, alpha ≈ 110 |
| `bomb.png` | 24×24 ×2 | fuse spark on/off | round black bomb, grey highlight, short fuse top-right |
| `boom.png` | 64×64 ×6 | 0 core flash … 5 smoke | white → yellow → orange → red → grey puffs, expanding, then dissipating |
| `coin.png` | 16×16 ×6 | spin | gold coin with a "B", edge-on at frame 3 |
| `coin_big.png` | 32×32 | 1 | HUD coin |
| `chest.png` / `chest_open.png` | 32×32 | 1 | wooden chest with gold bands; open = lid up + glow |
| `campfire.png` | 32×32 ×4 | flame loop | logs + stones, flames 4 frames |
| `torch.png` | 16×32 ×4 | flame loop | wall torch (bracket at bottom, flame top) |
| `zzz.png` | 16×16 ×3 | z grows | light blue "z" |
| `smoke_puff.png` | 12×12 | 1 | soft grey blob, alpha edge (chimney particles) |

Manifest `anims` for heroes: `{ idle: [0,1], walk: [2,3,4,5], throw: [6,7,8], sleep: [9,10] }`,
`fps: { idle: 2, walk: 8, throw: 10, sleep: 1.5 }`.

## env/ (environment.mjs)

The map is **12×8 tiles of 48 px** (576×384) in a 3/4 top-down view. The 40
server blocks are **ore deposits scattered over the floor** (tiles listed in
`map.mjs` → `MAP_PATTERN`, exported to the manifest as
`env/map_bg.png` → `extra.ore_tiles`, in server block order).

| file | size | frames | notes |
|---|---|---|---|
| `ore_{tier}_{variant}.png` (ore.mjs) | 48×48 ×3 | 0 intact · 1 cracked · 2 heavily damaged | organic mound sitting on the floor (no square/cube): 0 brown stone + gold nuggets · 1 blue-grey ice + cyan crystal cluster · 2 dark basalt + glowing magma grooves; variant 0/1 differ in silhouette (block index % 2) |
| `floor.png` | 48×48 ×4 | variants | dark cave floor (navy-brown), pebbles / cracks, low contrast so blocks and heroes pop |
| `floor_crystal.png` | 48×48 | 1 | floor with a small glowing cyan crystal cluster |
| `crater.png` | 48×48 | 1 | scorched decal, alpha (dead block floor) |
| `map_bg.png` | 576×384 | 1 | baked floor (seeded variation) with a **rock border**: outer 12 px of every side is rock wall (top-left lit); sparse rocks / mushrooms / bones only on tiles that hold no deposit. `extra.ore_tiles` = the 40 deposit tiles. |
| `wall_band.png` | 576×28 | 1 | rock wall band with stalactites, drawn above the map (y = -28) |
| `house.png` | 96×80 | 1 | cute cabin: log walls, red tiled roof, chimney top-right, door, warm window. Manifest `extra: { window: [x,y], chimney: [x,y] }` (local px). |
| `rock_{0,1}.png` | 24×20 | 1 | boulders |
| `mushroom.png` | 16×16 | 1 | glowing cave mushroom |
| `bones.png` | 24×12 | 1 | skull + bones |
| `crystal_{0,1}.png` | 24×32 | 1 | cyan / purple crystal clusters (bright core) |
| `stalactite.png` | 16×24 | 1 | single stalactite |
| `sign.png` | 32×24 | 1 | wooden signpost |

## ui/ (ui.mjs)

9-slice PNGs; margins listed in the manifest (`margins: [l, t, r, b]`).

| file | size | notes |
|---|---|---|
| `panel_wood.png` | 48×48, margins 12 | wood planks, dark rim, brass corner rivets |
| `panel_dark.png` | 48×48, margins 8 | dark navy inset (list / stats background) |
| `frame_gold.png` | 48×48, margins 12 | ornate gold frame, transparent centre |
| `plate.png` | 48×32, margins 10 | dark rounded plate with a gold rim (counters) |
| `btn_{green,blue,red,gray,gold,teal}.png` | 48×40, margins [12,12,12,16] | chunky button: rounded face, top highlight, **4 px darker bottom edge** |
| `btn_{colour}_down.png` | 48×40 | pressed: face moved 3 px down, edge 1 px |
| `ribbon.png` | 96×32, margins 24 | red ribbon banner with gold trim and folded tails |
| `portrait_frame.png` | 40×40 | gold frame, transparent 32×32 centre at (4,4) |
| `bar_frame.png` | 24×10, margins 3 | dark bar frame (fills are ColorRects inside) |
| `badge.png` | 20×20 | red round badge with dark outline |
| `icon_{pick,coin,bolt,house,bomb,star,lock,gift,adventure,arrow_l,arrow_r,close,sleep,wallet}.png` | 16×16 | flat icons with outline |
| `logo.png` | 288×64 | "MINERBLAST" chunky gold pixel letters, dark outline, pick + bomb accents |
| `logo_small.png` | 144×32 | same, for the top bar |

## Generators

* `godot/tools/art/lib.mjs` — canvas, outline, ramp, rng, sheet, 5×7 font.
* `godot/tools/art/characters.mjs` → `export function generateCharacters(outDir)`
* `godot/tools/art/map.mjs` — the 12×8 map pattern (deposits, camp, porch, props) + `validate()`
* `godot/tools/art/environment.mjs` → `export function generateEnvironment(outDir)`
* `godot/tools/art/ore.mjs` → `export function generateOre(outDir)` (into env/)
* `godot/tools/art/ui.mjs` → `export function generateUi(outDir)`
* `godot/tools/gen-art.mjs` runs all three, writes the manifest and, with
  `--preview <dir>`, a 3× contact sheet per module for eyeballing.

Each generator returns `{ [relativePath]: manifestEntry }` and must be
**deterministic** (seeded `rng()` only).
