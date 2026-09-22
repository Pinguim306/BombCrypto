extends RefCounted
## Layout geometry: block tiles, screen positions, walk rings.

const T := preload("res://tests/test_runner.gd")


func test_block_tiles() -> void:
	T.eq(Layout.block_tile(0), Vector2i(2, 1), "block 0 tile")
	T.eq(Layout.block_tile(7), Vector2i(9, 1), "block 7 tile (end of row 0)")
	T.eq(Layout.block_tile(8), Vector2i(2, 2), "block 8 wraps to row 1")
	T.eq(Layout.block_tile(39), Vector2i(9, 5), "block 39 tile")
	for i in Layout.BLOCK_COUNT:
		T.eq(Layout.block_at(Layout.block_tile(i)), i, "block_at inverts block_tile %d" % i)
	T.eq(Layout.block_at(Vector2i(0, 0)), -1, "margin tile is not a block")
	T.eq(Layout.block_at(Vector2i(1, 3)), -1, "left margin")
	T.eq(Layout.block_at(Vector2i(10, 3)), -1, "right margin")
	T.eq(Layout.block_at(Vector2i(5, 6)), -1, "bottom margin")
	T.eq(Layout.block_at(Vector2i(5, 0)), -1, "top margin")


func test_screen_positions() -> void:
	T.eq(Layout.tile_origin(Vector2i(0, 0)), Layout.MAP_ORIGIN, "tile 0,0 origin")
	T.eq(Layout.tile_origin(Vector2i(11, 7)) + Vector2(48, 48), Layout.MAP_ORIGIN + Layout.MAP_SIZE, "last tile ends at the map corner")
	T.eq(Layout.block_origin(0), Layout.MAP_ORIGIN + Vector2(96, 48), "block 0 origin")
	T.eq(Layout.block_center(0), Layout.MAP_ORIGIN + Vector2(120, 78), "block 0 front-face centre")
	T.eq(Layout.hero_pos(Vector2i(1, 6)), Layout.MAP_ORIGIN + Vector2(72, 328), "hero feet on tile 1,6")
	T.eq(Layout.tile_at(Layout.tile_center(Vector2i(4, 3))), Vector2i(4, 3), "tile_at inverts tile_center")
	T.eq(Layout.tile_at(Layout.MAP_ORIGIN - Vector2(1, 1)), Vector2i(-1, -1), "outside above-left")
	T.ok(not Layout.in_map(Vector2i(12, 0)), "col 12 outside")
	T.ok(not Layout.in_map(Vector2i(0, 8)), "row 8 outside")
	T.ok(Layout.in_map(Vector2i(11, 7)), "last tile inside")
	T.ok(Layout.MAP_ORIGIN.x + Layout.MAP_SIZE.x <= Layout.VIEW.x, "map fits horizontally")
	T.ok(Layout.MAP_ORIGIN.y + Layout.MAP_SIZE.y <= Layout.VIEW.y, "map fits vertically")


func test_props_and_rings() -> void:
	for t in Layout.HOUSE_TILES:
		T.ok(Layout.is_prop_tile(t), "house tile is a prop")
		T.eq(Layout.block_at(t), -1, "house never overlaps the blocks")
	T.ok(Layout.is_prop_tile(Layout.CAMPFIRE_TILE), "campfire is a prop")
	for t in Layout.CAMP_TILES + Layout.PORCH_TILES:
		T.ok(not Layout.is_prop_tile(t), "sleeping spot %s is walkable" % t)
		T.eq(Layout.block_at(t), -1, "sleeping spot %s is off the block area" % t)
	T.eq(Layout.tile_dist(Vector2i(2, 1), Vector2i(4, 4)), 3, "chebyshev distance")
	var ring := Layout.ring(Vector2i(0, 0), 1)
	T.eq(ring.size(), 3, "corner ring of 1 has 3 tiles")
	var ring2 := Layout.ring(Vector2i(5, 4), 2)
	T.eq(ring2.size(), 24, "full ring of 2 has 24 tiles")
	T.eq(Layout.tile_dist(ring2[0], Vector2i(5, 4)), 1, "nearest tiles come first")
	T.eq(Layout.tile_dist(ring2[ring2.size() - 1], Vector2i(5, 4)), 2, "farthest tiles come last")
	T.ok(not ring2.has(Vector2i(5, 4)), "ring excludes the centre")
