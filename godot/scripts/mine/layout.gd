class_name Layout
## Geometry of the mine screen (960x540, 16:9). The map is 12x8 tiles of
## 48 px drawn in a 3/4 view. The 40 server blocks are shown as 20 ORE
## DEPOSITS scattered over the floor (BLOCKS_PER_DEPOSIT = 2: deposit d holds
## blocks 2d and 2d+1). Their tiles come from the art manifest
## (`env/map_bg.png` → extra.ore_tiles, written by tools/art/map.mjs, so the
## baked floor and the game agree), listed top-to-bottom / left-to-right —
## the server's row-major "first alive" order sweeps the map naturally.
## Everything else on screen is HUD, positioned in the scenes.
## Pure functions + constants (plus the cached tile table), so tests can use
## it without a scene tree.

const VIEW := Vector2i(960, 540)
const TILE := 48
const COLS := 12
const ROWS := 8
const MAP_ORIGIN := Vector2(160, 84)              # top-left of tile (0, 0) on screen
const MAP_SIZE := Vector2(COLS * TILE, ROWS * TILE)  # 576 x 384
const BLOCK_COUNT := 40
const BLOCKS_PER_DEPOSIT := 2
const DEPOSIT_COUNT := BLOCK_COUNT / BLOCKS_PER_DEPOSIT   # 20

## Fixed props on the map (tiles heroes never stand on) and sleeping spots.
const HOUSE_TILES: Array[Vector2i] = [Vector2i(10, 6), Vector2i(11, 6), Vector2i(10, 7), Vector2i(11, 7)]
const PORCH_TILES: Array[Vector2i] = [Vector2i(9, 6), Vector2i(9, 7), Vector2i(8, 6), Vector2i(8, 7), Vector2i(10, 5), Vector2i(11, 5)]
const CAMPFIRE_TILE := Vector2i(1, 6)
const CAMP_TILES: Array[Vector2i] = [
	Vector2i(0, 6), Vector2i(2, 6), Vector2i(1, 7), Vector2i(0, 7), Vector2i(2, 7),
	Vector2i(1, 5), Vector2i(0, 5), Vector2i(3, 6), Vector2i(3, 7), Vector2i(4, 7),
]
const SIGN_TILE := Vector2i(0, 0)

## Where a hero stands inside its tile (feet), and the throw range in tiles.
const HERO_FOOT := Vector2(24, 40)
const THROW_RANGE := 2                            # Chebyshev distance in tiles
const MAX_ACTORS := 24

## Fallback scatter (used only when the manifest is missing) — keep in sync
## with tools/art/map.mjs MAP_PATTERN.
const FALLBACK_PATTERN: Array[String] = [
	"S..#..#...#.",
	".#...#..#...",
	"...#...#...#",
	"#....#...#..",
	"..#...#....#",
	"cc..#..#.#pp",
	"cCcc.#..ppHH",
	"ccccc.#.ppHH",
]

static var _ore_tiles: Array[Vector2i] = []
static var _ore_index: Dictionary = {}     # Vector2i -> deposit index


## The 20 deposit tiles in server block order (deposit d = blocks 2d, 2d+1).
static func ore_tiles() -> Array[Vector2i]:
	if _ore_tiles.is_empty():
		_load_ore_tiles()
	return _ore_tiles


static func _load_ore_tiles() -> void:
	var out: Array[Vector2i] = []
	var raw: Variant = Sheets.extra("env/map_bg.png", "ore_tiles", null)
	if raw is Array:
		for v: Variant in raw:
			if v is Array and (v as Array).size() == 2:
				out.append(Vector2i(int((v as Array)[0]), int((v as Array)[1])))
	if out.size() != DEPOSIT_COUNT:
		push_warning("Layout: manifest ore_tiles has %d entries, using the fallback pattern" % out.size())
		out.clear()
		for y in FALLBACK_PATTERN.size():
			var row := FALLBACK_PATTERN[y]
			for x in row.length():
				if row[x] == "#":
					out.append(Vector2i(x, y))
	_ore_tiles = out
	_ore_index.clear()
	for i in out.size():
		_ore_index[out[i]] = i


## Deposit that shows server block i.
static func deposit_of(i: int) -> int:
	return i / BLOCKS_PER_DEPOSIT if i >= 0 else -1


## First server block of deposit d.
static func first_block(d: int) -> int:
	return d * BLOCKS_PER_DEPOSIT


static func deposit_tile(d: int) -> Vector2i:
	var tiles := ore_tiles()
	if d < 0 or d >= tiles.size():
		return Vector2i(-1, -1)
	return tiles[d]


## Tile of server block i (its deposit's tile).
static func block_tile(i: int) -> Vector2i:
	if i < 0 or i >= BLOCK_COUNT:
		return Vector2i(-1, -1)
	return deposit_tile(deposit_of(i))


## Deposit index of a tile, or -1 when the tile holds no deposit.
static func deposit_at(t: Vector2i) -> int:
	ore_tiles()
	return int(_ore_index.get(t, -1))


## First block index of the deposit on tile t, or -1.
static func block_at(t: Vector2i) -> int:
	var d := deposit_at(t)
	return first_block(d) if d >= 0 else -1


static func in_map(t: Vector2i) -> bool:
	return t.x >= 0 and t.y >= 0 and t.x < COLS and t.y < ROWS


## Screen position of a tile's top-left corner.
static func tile_origin(t: Vector2i) -> Vector2:
	return MAP_ORIGIN + Vector2(t.x * TILE, t.y * TILE)


static func tile_center(t: Vector2i) -> Vector2:
	return tile_origin(t) + Vector2(TILE / 2.0, TILE / 2.0)


## Position of a hero's feet standing on tile t (also its y-sort key).
static func hero_pos(t: Vector2i) -> Vector2:
	return tile_origin(t) + HERO_FOOT


## Tile under a screen position (may be outside the map: check in_map()).
static func tile_at(p: Vector2) -> Vector2i:
	var local := p - MAP_ORIGIN
	return Vector2i(floori(local.x / TILE), floori(local.y / TILE))


## Centre of deposit d's mound — where bombs land and explosions play.
static func deposit_center(d: int) -> Vector2:
	return tile_origin(deposit_tile(d)) + Vector2(24, 28)


## Same, addressed by server block i.
static func block_center(i: int) -> Vector2:
	return deposit_center(deposit_of(i))


## Top-left of deposit d's tile.
static func deposit_origin(d: int) -> Vector2:
	return tile_origin(deposit_tile(d))


static func block_origin(i: int) -> Vector2:
	return deposit_origin(deposit_of(i))


## Tiles that are never walkable (props), independent of the block state.
static func is_prop_tile(t: Vector2i) -> bool:
	return t in HOUSE_TILES or t == CAMPFIRE_TILE or t == SIGN_TILE


## Chebyshev distance in tiles.
static func tile_dist(a: Vector2i, b: Vector2i) -> int:
	return maxi(absi(a.x - b.x), absi(a.y - b.y))


## Tiles within `range` of `t` (excluding t itself), nearest first, then by a
## stable order so allocation is deterministic.
static func ring(t: Vector2i, range: int) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	for d in range(1, range + 1):
		for dy in range(-d, d + 1):
			for dx in range(-d, d + 1):
				if maxi(absi(dx), absi(dy)) != d:
					continue
				var q := t + Vector2i(dx, dy)
				if in_map(q):
					out.append(q)
	return out
