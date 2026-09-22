class_name HeroActors
extends Node2D
## Puts the team on the map: one HeroActor per hero (up to Layout.MAX_ACTORS),
## y-sorted with the blocks. Working heroes walk to a free tile within throw
## range of the block the bomb sim targets and throw from there; resting
## heroes sit by the campfire (or on the house porch when sheltered) and
## sleep. Standing tiles are reserved so two heroes never share one; paths
## are BFS over walkable tiles (floor, dead blocks), so nobody walks through
## the ore wall. All of this is presentation: GameState/BombSim stay the truth.

const ACTOR_SCENE: PackedScene = preload("res://scenes/mine/hero_actor.tscn")
const OFFSCREEN_ORIGIN := Vector2(120, 300)     # heroes beyond MAX_ACTORS throw from the left edge
const LAMPS := 4                                # actors with a head-lamp light
const MAX_QUEUE := 2

var field: BlockField
var actors: Dictionary = {}       # hero_id -> HeroActor
var _spots: Dictionary = {}       # Vector2i -> hero_id (reserved standing tiles)
var _queues: Dictionary = {}      # hero_id -> Array[Dictionary{block, cb}]
var _order: Array[String] = []    # creation order (lamps go to the first LAMPS)


func _ready() -> void:
	y_sort_enabled = true


func setup(p_field: BlockField) -> void:
	field = p_field


# ---------------------------------------------------------------- state sync

## Creates / binds / removes actors from the server state; moves resting
## heroes to their sleeping spots and evicts anyone the map regrew under.
func sync(s: StateModel, d: StateDiff) -> void:
	var seen: Dictionary = {}
	var n := 0
	for h: HeroModel in s.heroes:
		if n >= Layout.MAX_ACTORS:
			break
		n += 1
		seen[h.id] = true
		var a: HeroActor = actors.get(h.id)
		var fresh := a == null
		if fresh:
			a = _spawn(h)
		var prev_mode := a.mode
		a.bind(h)
		if fresh or prev_mode != h.mode or d.first:
			if h.is_working():
				a.wake()
			else:
				_go_rest(a, h)
		elif not h.is_working() and a.state != HeroActor.State.SLEEP and not a.is_busy():
			_go_rest(a, h)
	for id: String in actors.keys().duplicate():
		if not seen.has(id):
			_despawn(id)
	# the map regenerated (or a block came back) under someone's feet
	for a: HeroActor in actors.values():
		if a.state != HeroActor.State.WALK and not field.is_walkable(a.tile):
			_evict(a)
	_refresh_lamps()


func _spawn(h: HeroModel) -> HeroActor:
	var a: HeroActor = ACTOR_SCENE.instantiate()
	a.name = "Hero_" + h.id.validate_node_name()
	a.hero_id = h.id   # reservations are keyed by id: set it before the first _reserve()
	add_child(a)
	actors[h.id] = a
	_order.append(h.id)
	var spot := _rest_spot(h, null)
	if spot == Vector2i(-1, -1):
		spot = _nearest_free(Layout.CAMPFIRE_TILE, null)
	a.place(spot)
	_reserve(a, spot)
	a.arrived.connect(_on_actor_free.bind(h.id))
	a.throw_done.connect(_on_actor_free.bind(h.id))
	a.spawn_in()
	return a


func _despawn(id: String) -> void:
	var a: HeroActor = actors.get(id)
	if a == null:
		return
	_release(a)
	actors.erase(id)
	_queues.erase(id)
	_order.erase(id)
	a.fade_out()


func _go_rest(a: HeroActor, h: HeroModel) -> void:
	var spot := _rest_spot(h, a)
	if spot == Vector2i(-1, -1):
		a.sleep()
		return
	if spot == a.tile:
		a.sleep()
		return
	_reserve(a, spot)
	var path := _bfs(a.tile, spot)
	if path.is_empty():
		a.place(spot)
		a.sleep()
		return
	a.walk(path, 1.6)
	var id := h.id
	a.arrived.connect(func() -> void:
		var cur: HeroActor = actors.get(id)
		if cur == a and a.mode == "rest" and a.state != HeroActor.State.WALK:
			a.sleep(), CONNECT_ONE_SHOT)


## Sleeping spot: porch when sheltered, campfire otherwise; nearest free.
func _rest_spot(h: HeroModel, a: HeroActor) -> Vector2i:
	var prefer: Array[Vector2i] = []
	if h.is_housed():
		prefer.append_array(Layout.PORCH_TILES)
		prefer.append_array(Layout.CAMP_TILES)
	else:
		prefer.append_array(Layout.CAMP_TILES)
		prefer.append_array(Layout.PORCH_TILES)
	for t in prefer:
		if _free_for(t, a):
			return t
	return _nearest_free(Layout.CAMPFIRE_TILE, a)


func _evict(a: HeroActor) -> void:
	var to := _nearest_free(a.tile, a)
	if to == Vector2i(-1, -1):
		return
	_reserve(a, to)
	var was_sleeping := a.state == HeroActor.State.SLEEP
	var path := _bfs_from_blocked(a.tile, to)
	if path.is_empty():
		a.place(to)
		if was_sleeping:
			a.sleep()
		return
	a.walk(path, 0.6)
	if was_sleeping:
		a.arrived.connect(func() -> void:
			if a.mode == "rest":
				a.sleep(), CONNECT_ONE_SHOT)


# ---------------------------------------------------------------- throws

## BombSim says hero `id` throws at block `block_index` now. The actor walks
## into range if needed, then `on_release(origin)` fires with the hand position
## (immediately, from the map edge, for heroes without an actor).
func request_throw(id: String, block_index: int, on_release: Callable) -> void:
	var a: HeroActor = actors.get(id)
	if a == null or not is_instance_valid(a):
		on_release.call(OFFSCREEN_ORIGIN)
		return
	if a.is_busy():
		var q: Array = _queues.get(id, [])
		if q.size() >= MAX_QUEUE:
			on_release.call(a.hand_pos())   # too far behind: throw from wherever we are
			return
		q.append({"block": block_index, "cb": on_release})
		_queues[id] = q
		return
	_perform_throw(a, id, block_index, on_release)


func _perform_throw(a: HeroActor, id: String, block_index: int, on_release: Callable) -> void:
	var target := Layout.block_tile(block_index)
	var in_range := Layout.tile_dist(a.tile, target) <= Layout.THROW_RANGE and field.is_walkable(a.tile)
	if in_range:
		a.throw_at(Layout.block_center(block_index), on_release)
		return
	var spot := _throw_spot(target, a)
	if spot == Vector2i(-1, -1) or spot == a.tile:
		a.throw_at(Layout.block_center(block_index), on_release)
		return
	var path := _bfs(a.tile, spot)
	if path.is_empty():
		a.place(spot)
		_reserve(a, spot)
		a.throw_at(Layout.block_center(block_index), on_release)
		return
	_reserve(a, spot)
	var interval := 4000
	var h: HeroModel = GameState.hero(id)
	if h != null:
		interval = h.bomb_interval_ms
	a.walk(path, clampf(0.6 * interval / 1000.0, 0.4, 1.6))
	a.arrived.connect(func() -> void:
		if is_instance_valid(a) and actors.get(id) == a:
			a.throw_at(Layout.block_center(block_index), on_release)
		else:
			on_release.call(OFFSCREEN_ORIGIN), CONNECT_ONE_SHOT)


## Walkable, unreserved tile within throw range of `target`, nearest to the
## actor; (-1, -1) when the ring is full.
func _throw_spot(target: Vector2i, a: HeroActor) -> Vector2i:
	var best := Vector2i(-1, -1)
	var best_score := 1e9
	for t in Layout.ring(target, Layout.THROW_RANGE):
		if not _free_for(t, a):
			continue
		# prefer standing beside/below the target (in front of the wall) and close to where we are
		var score := float(Layout.tile_dist(t, target)) * 10.0 + float(Layout.tile_dist(t, a.tile)) + (0.0 if t.y >= target.y else 3.0)
		if score < best_score:
			best_score = score
			best = t
	return best


func _on_actor_free(id: String) -> void:
	var a: HeroActor = actors.get(id)
	if a == null or a.is_busy():
		return
	var q: Array = _queues.get(id, [])
	if q.is_empty():
		return
	var next: Dictionary = q.pop_front()
	_queues[id] = q
	_perform_throw(a, id, int(next["block"]), next["cb"])


# ---------------------------------------------------------------- tiles

func _free_for(t: Vector2i, a: HeroActor) -> bool:
	if not field.is_walkable(t):
		return false
	var owner: Variant = _spots.get(t, null)
	return owner == null or (a != null and owner == a.hero_id)


func _reserve(a: HeroActor, t: Vector2i) -> void:
	_release(a)
	_spots[t] = a.hero_id
	a.target_tile = t


func _release(a: HeroActor) -> void:
	for t: Vector2i in _spots.keys().duplicate():
		if _spots[t] == a.hero_id:
			_spots.erase(t)


## Nearest free tile to `from` (BFS distance), (-1, -1) if none.
func _nearest_free(from: Vector2i, a: HeroActor) -> Vector2i:
	var best := Vector2i(-1, -1)
	var best_d := 1e9
	for y in Layout.ROWS:
		for x in Layout.COLS:
			var t := Vector2i(x, y)
			if not _free_for(t, a):
				continue
			var d := Vector2(t - from).length()
			if d < best_d:
				best_d = d
				best = t
	return best


## 4-neighbour BFS over walkable tiles; returns the path EXCLUDING `from`, or
## [] when unreachable. Other heroes are not obstacles (they pass through).
func _bfs(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	return _bfs_impl(from, to, false)


## Same, but the start tile may be blocked (evictions after a map regen).
func _bfs_from_blocked(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	return _bfs_impl(from, to, true)


func _bfs_impl(from: Vector2i, to: Vector2i, start_blocked_ok: bool) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	if from == to:
		return out
	if not start_blocked_ok and not field.is_walkable(from):
		return out
	var prev: Dictionary = {from: from}
	var queue: Array[Vector2i] = [from]
	var found := false
	while not queue.is_empty():
		var cur: Vector2i = queue.pop_front()
		if cur == to:
			found = true
			break
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var nx: Vector2i = cur + d
			if prev.has(nx) or not field.is_walkable(nx):
				continue
			prev[nx] = cur
			queue.append(nx)
	if not found:
		return out
	var t := to
	while t != from:
		out.push_front(t)
		t = prev[t]
	return out


# ---------------------------------------------------------------- misc

## Actor under a screen position (for clicks), or null.
func actor_at(p: Vector2) -> HeroActor:
	var best: HeroActor = null
	var best_d := 18.0
	for a: HeroActor in actors.values():
		var d := (a.position + Vector2(0, -16)).distance_to(p)
		if d < best_d:
			best_d = d
			best = a
	return best


func actor(id: String) -> HeroActor:
	return actors.get(id)


## Mine-all flourish: the heroes that just started working hop, staggered.
func play_hop(ids: Array[String]) -> void:
	var nodes: Array = []
	for id in ids:
		var a: HeroActor = actors.get(id)
		if a != null:
			nodes.append(a)
	Juice.stagger(nodes, func(n: Variant) -> void: (n as HeroActor).hop(), 0.06)


func apply_config() -> void:
	_refresh_lamps()


func _refresh_lamps() -> void:
	var i := 0
	for id in _order:
		var a: HeroActor = actors.get(id)
		if a == null:
			continue
		a.set_lamp_wanted(i < LAMPS)
		i += 1


## HIDDEN / OFFLINE: drop queued throws so nothing bursts on resume.
func clear_queues() -> void:
	_queues.clear()
