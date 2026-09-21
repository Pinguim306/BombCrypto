class_name Fx
extends Node2D
## Game-feel layer of the mining screen: pools (bombs 6, explosions 8, float
## texts 12), reacts to BombSim.bomb_thrown and to server diffs, and owns the
## hit-stop / light / shake / float-text combos. Nothing here is required for
## correctness; every effect is skipped when Config.fx_enabled is false.

const BOMB_SCENE: PackedScene = preload("res://scenes/mining/bomb.tscn")
const EXPLOSION_SCENE: PackedScene = preload("res://scenes/mining/explosion.tscn")
const FLOAT_SCENE: PackedScene = preload("res://scenes/mining/floating_text.tscn")
const MAX_BOMBS := 6
const MAX_EXPLOSIONS := 8
const MAX_FLOATS := 12
const OFFPAGE_ORIGIN := Vector2(240, 300)     # heroes not on the current page throw from here
const COALESCE_WINDOW_MS := 100
const COALESCE_MAX := 4
const LIGHT_BASE := Color("ffe082")
const FLOAT_GAIN := Color("ffca28")
const FLOAT_HIT := Color("ffab91")

@export var flight_seconds := 0.55
@export var flight_max_fraction := 0.35       # of the hero's bomb interval
@export var hit_shake := 0.35
@export var death_shake := 0.6
@export var regen_shake := 0.4
@export var hitstop_seconds := 0.045

var active := true
var grid: BlockGrid
var hero_list: HeroList
var bombs_layer: Node2D
var overlay: Node2D
var pending_pill: Pill
var cave_glow: PointLight2D

@onready var explosions_node: Node2D = $Explosions

var _bombs: Array[Bomb] = []
var _explosions: Array[Explosion] = []
var _floats: Array[FloatingText] = []
var _land_times: Array[int] = []
var _glow_tw: Tween


func setup(p_grid: BlockGrid, p_hero_list: HeroList, p_bombs: Node2D, p_overlay: Node2D, p_pill: Pill, p_cave_glow: PointLight2D) -> void:
	grid = p_grid
	hero_list = p_hero_list
	bombs_layer = p_bombs
	overlay = p_overlay
	pending_pill = p_pill
	cave_glow = p_cave_glow
	if not grid.cell_died.is_connected(_on_cell_died):
		grid.cell_died.connect(_on_cell_died)


# ---------------------------------------------------------------- bombs

## BombSim.bomb_thrown: a hero row throws at a cell; the hit is applied on landing.
func on_bomb_thrown(hero_id: String, cell_index: int, dmg: int) -> void:
	if not active or not Config.fx_enabled or grid == null:
		return
	var from := OFFPAGE_ORIGIN
	var interval := Rules.BOMB_BASE_INTERVAL_MS
	var h: HeroModel = GameState.hero(hero_id)
	if h != null:
		interval = maxi(250, h.bomb_interval_ms)
	var row: HeroRow = hero_list.row_for(hero_id) if hero_list != null else null
	if row != null:
		from = row.throw_origin()
		row.play_throw()
	var to := Rules.cell_center(cell_index)
	var dur := minf(flight_seconds, flight_max_fraction * float(interval) / 1000.0)
	var bomb := _get_bomb()
	if bomb == null:
		_on_land(cell_index, dmg)   # pool exhausted: apply the hit without the flight
		return
	bomb.throw(from, to, dur, _on_land.bind(cell_index, dmg))


func _on_land(cell_index: int, dmg: int) -> void:
	if not active or not is_inside_tree():
		return
	var c := grid.cell(cell_index)
	if c == null:
		return
	var tier := c.tier
	var pos := Rules.cell_center(cell_index)
	var max_hp := c.max_hp
	var died := grid.hit(cell_index, dmg)       # a death emits cell_died -> _on_cell_died
	_explode(pos, tier, not died)
	if not died and dmg >= int(ceil(0.2 * float(max_hp))):
		float_text(pos, "-%d" % dmg, FLOAT_HIT)
	Sfx.play(&"explode")


func _explode(pos: Vector2, tier: int, with_juice: bool) -> void:
	var e := _get_explosion()
	if e != null:
		e.play(pos, tier)
	if not with_juice:
		return
	if _coalesced():
		return
	var ore: Color = Config.ORE[clampi(tier, 0, Config.ORE.size() - 1)]
	Juice.flash_light(pos, LIGHT_BASE.lerp(ore, 0.4), 2.4, 0.18)
	Juice.shake(hit_shake)


## More than COALESCE_MAX landings inside 100 ms share one light/shake.
func _coalesced() -> bool:
	var now := Time.get_ticks_msec()
	while not _land_times.is_empty() and now - _land_times[0] > COALESCE_WINDOW_MS:
		_land_times.remove_at(0)
	_land_times.append(now)
	return _land_times.size() > COALESCE_MAX


func _on_cell_died(index: int, last_dmg: int) -> void:
	if not Config.fx_enabled:
		return
	var c := grid.cell(index)
	var tier := c.tier if c != null else 0
	var pos := Rules.cell_center(index)
	var ore: Color = Config.ORE[clampi(tier, 0, Config.ORE.size() - 1)]
	Juice.hitstop(hitstop_seconds)
	Juice.flash_light(pos, LIGHT_BASE.lerp(ore, 0.4), 4.0, 0.25)
	Juice.shake(death_shake)
	float_text(pos, "+%s" % Fmt.blast2(float(last_dmg) * Config.BLAST_PER_HP), FLOAT_GAIN)
	if pending_pill != null and pending_pill.value_label != null:
		Juice.punch_scale(pending_pill.value_label, 0.12, 0.25)
	Sfx.play(&"crumble")
	Sfx.play(&"explode_big")


# ---------------------------------------------------------------- diffs

## Server truth arrived: the grid already snapped; here only the big moments.
func on_diff(d: StateDiff, _s: StateModel) -> void:
	if not Config.fx_enabled or d.first:
		return
	if d.map_regenerated:
		grid.play_spawn_all(0.02)
		Juice.toast("NEW VEIN DISCOVERED")
		Juice.shake(regen_shake)
		_pulse_cave_glow()
		Sfx.play(&"map_regen")


func _pulse_cave_glow() -> void:
	if cave_glow == null or not cave_glow.enabled or Config.juice_scale() <= 0.0:
		return
	if _glow_tw != null and _glow_tw.is_valid():
		_glow_tw.kill()
	_glow_tw = create_tween()
	_glow_tw.tween_property(cave_glow, "energy", 0.9, 0.3).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_glow_tw.tween_property(cave_glow, "energy", 0.3, 0.5).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


## HIDDEN / OFFLINE: clear the pools so nothing bursts after resume.
func set_active(on: bool) -> void:
	active = on
	if on:
		return
	for b: Bomb in _bombs:
		b.stop()
	for e: Explosion in _explosions:
		e.stop()
	for f: FloatingText in _floats:
		f.stop()
	_land_times.clear()


# ---------------------------------------------------------------- float text

func float_text(pos: Vector2, txt: String, color: Color) -> void:
	if not Config.fx_enabled or overlay == null:
		return
	var f := _get_float()
	if f != null:
		f.show_at(pos, txt, color)


# ---------------------------------------------------------------- pools

func _get_bomb() -> Bomb:
	for b: Bomb in _bombs:
		if not b.busy:
			return b
	if _bombs.size() >= MAX_BOMBS or bombs_layer == null:
		return null
	var nb: Bomb = BOMB_SCENE.instantiate()
	nb.name = "Bomb%d" % _bombs.size()
	bombs_layer.add_child(nb)
	_bombs.append(nb)
	return nb


func _get_explosion() -> Explosion:
	for e: Explosion in _explosions:
		if not e.busy:
			return e
	if _explosions.size() < MAX_EXPLOSIONS:
		var ne: Explosion = EXPLOSION_SCENE.instantiate()
		ne.name = "Explosion%d" % _explosions.size()
		explosions_node.add_child(ne)
		_explosions.append(ne)
		return ne
	# all busy: recycle the oldest
	var oldest: Explosion = _explosions[0]
	for e: Explosion in _explosions:
		if e.started_ms < oldest.started_ms:
			oldest = e
	oldest.stop()
	return oldest


func _get_float() -> FloatingText:
	for f: FloatingText in _floats:
		if not f.busy:
			return f
	if _floats.size() < MAX_FLOATS:
		var nf: FloatingText = FLOAT_SCENE.instantiate()
		nf.name = "Float%d" % _floats.size()
		overlay.add_child(nf)
		_floats.append(nf)
		return nf
	var f0: FloatingText = _floats[0]
	f0.stop()
	return f0
