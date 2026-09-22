class_name Fx
extends Node2D
## Game-feel layer of the mine: bomb / explosion / float-text pools, reacting
## to BombSim.bomb_thrown (via the hero actors) and to server diffs, plus the
## hit-stop / light / shake combos. Nothing here is required for correctness;
## every effect is skipped when Config.fx_enabled is false.

const BOMB_SCENE: PackedScene = preload("res://scenes/mine/bomb.tscn")
const EXPLOSION_SCENE: PackedScene = preload("res://scenes/mine/explosion.tscn")
const FLOAT_SCENE: PackedScene = preload("res://scenes/mine/floating_text.tscn")
const MAX_BOMBS := 8
const MAX_EXPLOSIONS := 8
const MAX_FLOATS := 12
const COALESCE_WINDOW_MS := 100
const COALESCE_MAX := 4
const LIGHT_BASE := Color("ffe082")
const FLOAT_GAIN := Color("ffca28")
const FLOAT_HIT := Color("ffab91")

@export var flight_min_seconds := 0.3
@export var flight_max_seconds := 0.55
@export var flight_px_per_second := 260.0
@export var hit_shake := 0.3
@export var death_shake := 0.55
@export var regen_shake := 0.4
@export var hitstop_seconds := 0.045

var active := true
var field: BlockField
var actors: HeroActors
var bombs_layer: Node2D
var overlay: Node2D
var pending_label: Control
var vein_light: PointLight2D

@onready var explosions_node: Node2D = $Explosions

var _bombs: Array[Bomb] = []
var _explosions: Array[Explosion] = []
var _floats: Array[FloatingText] = []
var _land_times: Array[int] = []
var _glow_tw: Tween


func setup(p_field: BlockField, p_actors: HeroActors, p_bombs: Node2D, p_overlay: Node2D, p_pending: Control, p_vein: PointLight2D) -> void:
	field = p_field
	actors = p_actors
	bombs_layer = p_bombs
	overlay = p_overlay
	pending_label = p_pending
	vein_light = p_vein
	if not field.tile_died.is_connected(_on_tile_died):
		field.tile_died.connect(_on_tile_died)


# ---------------------------------------------------------------- bombs

## BombSim.bomb_thrown: the hero's actor walks into range and releases; the
## bomb flies to the block and the hit is applied on landing.
func on_bomb_thrown(hero_id: String, cell_index: int, dmg: int) -> void:
	if not active or not Config.fx_enabled or field == null:
		return
	actors.request_throw(hero_id, cell_index, _launch.bind(cell_index, dmg))


func _launch(from: Vector2, cell_index: int, dmg: int) -> void:
	if not active or not is_inside_tree():
		return
	var to := Layout.block_center(cell_index)
	var dur := clampf(from.distance_to(to) / flight_px_per_second, flight_min_seconds, flight_max_seconds)
	var bomb := _get_bomb()
	if bomb == null:
		_on_land(cell_index, dmg)   # pool exhausted: apply the hit without the flight
		return
	bomb.throw(from, to, dur, _on_land.bind(cell_index, dmg))


func _on_land(cell_index: int, dmg: int) -> void:
	if not active or not is_inside_tree():
		return
	var t := field.tile(cell_index)
	if t == null:
		return
	var tier := t.tier
	var pos := Layout.block_center(cell_index)
	var max_hp := t.max_hp
	var died := field.hit(cell_index, dmg)       # a death emits tile_died -> _on_tile_died
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
	Juice.flash_light(pos, LIGHT_BASE.lerp(ore, 0.4), 2.2, 0.18)
	Juice.shake(hit_shake)


## More than COALESCE_MAX landings inside 100 ms share one light/shake.
func _coalesced() -> bool:
	var now := Time.get_ticks_msec()
	while not _land_times.is_empty() and now - _land_times[0] > COALESCE_WINDOW_MS:
		_land_times.remove_at(0)
	_land_times.append(now)
	return _land_times.size() > COALESCE_MAX


func _on_tile_died(index: int, last_dmg: int) -> void:
	if not Config.fx_enabled:
		return
	var t := field.tile(index)
	var tier := t.tier if t != null else 0
	var pos := Layout.block_center(index)
	var ore: Color = Config.ORE[clampi(tier, 0, Config.ORE.size() - 1)]
	Juice.hitstop(hitstop_seconds)
	Juice.flash_light(pos, LIGHT_BASE.lerp(ore, 0.4), 3.6, 0.25)
	Juice.shake(death_shake)
	float_text(pos, "+%s" % Fmt.blast2(float(last_dmg) * Config.BLAST_PER_HP), FLOAT_GAIN)
	if pending_label != null:
		Juice.punch_scale(pending_label, 0.12, 0.25)
	Sfx.play(&"crumble")
	Sfx.play(&"explode_big")


# ---------------------------------------------------------------- diffs

## Server truth arrived: the field already snapped; here only the big moments.
func on_diff(d: StateDiff, _s: StateModel) -> void:
	if not Config.fx_enabled or d.first:
		return
	if d.map_regenerated:
		field.play_spawn_all(0.02)
		Juice.toast("NEW VEIN DISCOVERED")
		Juice.shake(regen_shake)
		_pulse_vein_light()
		Sfx.play(&"map_regen")


func _pulse_vein_light() -> void:
	if vein_light == null or not vein_light.enabled or Config.juice_scale() <= 0.0:
		return
	if _glow_tw != null and _glow_tw.is_valid():
		_glow_tw.kill()
	var base := vein_light.energy
	_glow_tw = create_tween()
	_glow_tw.tween_property(vein_light, "energy", base + 0.7, 0.3).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_glow_tw.tween_property(vein_light, "energy", base, 0.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


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
	if actors != null:
		actors.clear_queues()


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
