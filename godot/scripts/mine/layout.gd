class_name Layout
## Geometry of the mine screen (960x540, 16:9). The map is 12x8 tiles of
## 48 px drawn in a 3/4 view; the 40 server blocks (8x5, row-major) sit in
## the middle (cols 2..9, rows 1..5) and the margin tiles are floor the
## heroes walk on. Everything else on screen is HUD, positioned in the scenes.
## Pure functions + constants only, so tests can use it without a tree.

const VIEW := Vector2i(960, 540)
const TILE := 48
const COLS := 12
const ROWS := 8
const MAP_ORIGIN := Vector2(160, 84)              # top-left of tile (0, 0) on screen
const MAP_SIZE := Vector2(COLS * TILE, ROWS * TILE)  # 576 x 384

const BLOCK_COLS := 8
const BLOCK_ROWS := 5
const BLOCK_COL0 := 2
const BLOCK_ROW0 := 1
const BLOCK_COUNT := BLOCK_COLS * BLOCK_ROWS      # 40

## Fixed props on the map (tiles heroes never stand on).
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


## Tile (col, row) of server block i (row-major 8x5).
static func block_tile(i: int) -> Vector2i:
	return Vector2i(BLOCK_COL0 + i % BLOCK_COLS, BLOCK_ROW0 + i / BLOCK_COLS)


## Block index of a tile, or -1 when the tile is outside the block area.
static func block_at(t: Vector2i) -> int:
	var c := t.x - BLOCK_COL0
	var r := t.y - BLOCK_ROW0
	if c < 0 or c >= BLOCK_COLS or r < 0 or r >= BLOCK_ROWS:
		return -1
	return r * BLOCK_COLS + c


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


## Centre of block i's front face — where bombs land and explosions play.
static func block_center(i: int) -> Vector2:
	return tile_origin(block_tile(i)) + Vector2(24, 30)


## Top-left of block i's sprite.
static func block_origin(i: int) -> Vector2:
	return tile_origin(block_tile(i))


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
