extends RefCounted
## Layout geometry: block tiles, screen positions, walk rings.

const T := preload("res://tests/test_runner.gd")


func test_block_tiles() -> void:
	var tiles := Layout.ore_tiles()
	T.eq(tiles.size(), Layout.DEPOSIT_COUNT, "20 deposits")
	T.eq(Layout.DEPOSIT_COUNT * Layout.BLOCKS_PER_DEPOSIT, Layout.BLOCK_COUNT, "deposits cover the 40 blocks")
	for i in Layout.BLOCK_COUNT:
		T.eq(Layout.block_tile(i), tiles[i / Layout.BLOCKS_PER_DEPOSIT], "block %d sits on its deposit's tile" % i)
		T.eq(Layout.deposit_of(i), i / Layout.BLOCKS_PER_DEPOSIT, "deposit_of(%d)" % i)
	T.eq(Layout.first_block(3), 6, "first block of deposit 3")
	var seen: Dictionary = {}
	for i in tiles.size():
		var t := tiles[i]
		T.ok(Layout.in_map(t), "deposit %d inside the map" % i)
		T.ok(not seen.has(t), "deposit %d tile unique" % i)
		seen[t] = true
		T.ok(not Layout.is_prop_tile(t), "deposit %d not on a prop" % i)
		T.ok(not (t in Layout.CAMP_TILES) and not (t in Layout.PORCH_TILES), "deposit %d not on a sleeping spot" % i)
		T.eq(Layout.deposit_at(t), i, "deposit_at inverts deposit_tile %d" % i)
		T.eq(Layout.block_at(t), Layout.first_block(i), "block_at gives the deposit's first block %d" % i)
		if i > 0:
			var p := tiles[i - 1]
			T.ok(p.y < t.y or (p.y == t.y and p.x < t.x), "deposit %d comes after %d in row-major order" % [i, i - 1])
	T.eq(Layout.block_at(Layout.SIGN_TILE), -1, "sign tile is not a deposit")
	T.eq(Layout.block_at(Layout.CAMPFIRE_TILE), -1, "campfire tile is not a deposit")
	T.eq(Layout.block_tile(40), Vector2i(-1, -1), "out of range block index")
	T.eq(Layout.deposit_tile(20), Vector2i(-1, -1), "out of range deposit index")


func test_floor_connected() -> void:
	# every floor tile is reachable from the camp with all deposits alive, and
	# every deposit has a floor tile right next to it to stand on
	var free: Dictionary = {}
	for y in Layout.ROWS:
		for x in Layout.COLS:
			var t := Vector2i(x, y)
			if not Layout.is_prop_tile(t) and Layout.block_at(t) == -1:
				free[t] = true
	var seen: Dictionary = {Layout.CAMP_TILES[0]: true}
	var queue: Array[Vector2i] = [Layout.CAMP_TILES[0]]
	while not queue.is_empty():
		var cur: Vector2i = queue.pop_front()
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var n: Vector2i = cur + d
			if free.has(n) and not seen.has(n):
				seen[n] = true
				queue.append(n)
	T.eq(seen.size(), free.size(), "all floor tiles reachable from the camp")
	for i in Layout.DEPOSIT_COUNT:
		var t := Layout.deposit_tile(i)
		var ok := false
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			if free.has(t + d):
				ok = true
		T.ok(ok, "deposit %d has a floor tile beside it" % i)


func test_screen_positions() -> void:
	T.eq(Layout.tile_origin(Vector2i(0, 0)), Layout.MAP_ORIGIN, "tile 0,0 origin")
	T.eq(Layout.tile_origin(Vector2i(11, 7)) + Vector2(48, 48), Layout.MAP_ORIGIN + Layout.MAP_SIZE, "last tile ends at the map corner")
	var t0 := Layout.deposit_tile(0)
	T.eq(Layout.block_origin(0), Layout.tile_origin(t0), "block 0 origin is its deposit's tile origin")
	T.eq(Layout.block_origin(1), Layout.tile_origin(t0), "block 1 shares deposit 0")
	T.eq(Layout.block_center(0), Layout.tile_origin(t0) + Vector2(24, 28), "block 0 centre")
	T.eq(Layout.deposit_center(0), Layout.block_center(1), "deposit centre == its blocks' centre")
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
		T.eq(Layout.block_at(t), -1, "house never overlaps a deposit")
	T.ok(Layout.is_prop_tile(Layout.CAMPFIRE_TILE), "campfire is a prop")
	for t in Layout.CAMP_TILES + Layout.PORCH_TILES:
		T.ok(not Layout.is_prop_tile(t), "sleeping spot %s is walkable" % t)
		T.eq(Layout.block_at(t), -1, "sleeping spot %s holds no deposit" % t)
	T.eq(Layout.tile_dist(Vector2i(2, 1), Vector2i(4, 4)), 3, "chebyshev distance")
	var ring := Layout.ring(Vector2i(0, 0), 1)
	T.eq(ring.size(), 3, "corner ring of 1 has 3 tiles")
	var ring2 := Layout.ring(Vector2i(5, 4), 2)
	T.eq(ring2.size(), 24, "full ring of 2 has 24 tiles")
	T.eq(Layout.tile_dist(ring2[0], Vector2i(5, 4)), 1, "nearest tiles come first")
	T.eq(Layout.tile_dist(ring2[ring2.size() - 1], Vector2i(5, 4)), 2, "farthest tiles come last")
	T.ok(not ring2.has(Vector2i(5, 4)), "ring excludes the centre")
