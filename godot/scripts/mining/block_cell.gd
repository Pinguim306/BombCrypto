class_name BlockCell
extends Node2D
## One 58x58 mining block (Phaser: image + crack overlay + hp bar). Renders
## from a BlockModel; textures are swapped only when the key changes. The
## predictive bomb sim drives `play_hit()` between polls, `apply()` snaps to
## the server truth on every poll and reconciles silently when the two differ.

signal died(index: int, last_dmg: int)

const BODY_SCALE := Vector2(0.90625, 0.90625)   # 64 px texture -> 58 px
const PIVOT := Vector2(29, 29)
const DEAD_GRACE_POLLS := 2                       # keep a predicted death while the server catches up
const TEX: Dictionary = {
	"block_0": preload("res://assets/sprites/block_0.png"),
	"block_1": preload("res://assets/sprites/block_1.png"),
	"block_2": preload("res://assets/sprites/block_2.png"),
	"block_dead": preload("res://assets/sprites/block_dead.png"),
	"block_dead2": preload("res://assets/sprites/block_dead2.png"),
	"crack_1": preload("res://assets/sprites/crack_1.png"),
	"crack_2": preload("res://assets/sprites/crack_2.png"),
}

# ---- game-feel numbers (design §6.3-6.5) ----
@export var flash_alpha := 0.8
@export var flash_seconds := 0.06
@export var squash := Vector2(1.14, 0.86)
@export var stretch := Vector2(0.96, 1.04)
@export var squash_seconds := 0.28
@export var jitter_px := 2.0
@export var death_seconds := 0.18
@export var death_rise_px := 6.0
@export var death_debris := 48
@export var spawn_seconds := 0.3

@onready var pivot: Node2D = $Pivot
@onready var body: Sprite2D = $Pivot/Body
@onready var crack: Sprite2D = $Pivot/Crack
@onready var ore_glow: Sprite2D = $Pivot/OreGlow
@onready var flash: Sprite2D = $Pivot/Flash
@onready var dead: Sprite2D = $Pivot/Dead
@onready var hp_bar: HpBar = $HpBar
@onready var debris: CPUParticles2D = $Debris

var index := -1
var current_key := ""      # texture key currently shown ("block_1", "block_dead2", ...)
var hp := 0                # server hp
var max_hp := 1
var predicted_hp := 0      # visual hp (server hp minus predicted bombs)
var tier := 0
var alive := false         # visual state
var _crack_level := 0
var _sim_dead := false     # died from a predicted bomb, not yet confirmed
var _dead_grace := 0
var _glow_tw: Tween
var _hit_tw: Tween
var _jitter_tw: Tween
var _flash_tw: Tween
var _death_tw: Tween
var _spawn_tw: Tween


func setup(i: int) -> void:
	index = i


## Renders the server truth. `animate` = not the first render and FX enabled.
func apply(m: BlockModel, animate: bool) -> void:
	var fx := animate and Config.fx_enabled
	var fresh := m.max_hp != max_hp
	hp = m.hp
	max_hp = maxi(1, m.max_hp)
	var now_alive := m.alive()
	if now_alive:
		if not alive and current_key != "":
			# visual dead, server alive: a predicted death the server has not confirmed yet
			if _sim_dead and not fresh and fx and _dead_grace < DEAD_GRACE_POLLS:
				_dead_grace += 1
				predicted_hp = m.hp
				return
			_revive()
		_set_alive_visuals(m, fx)
	else:
		if alive:
			if fx:
				play_death(maxi(1, predicted_hp))   # remaining visual hp = the last hit
			else:
				_set_dead_visuals()
		else:
			_set_dead_visuals()
		_sim_dead = false
		_dead_grace = 0
	predicted_hp = m.hp


func _set_alive_visuals(m: BlockModel, fx: bool) -> void:
	var t := Rules.block_tier(m.max_hp)
	var key := "block_%d" % t
	if key != current_key:
		body.texture = TEX[key]
		current_key = key
	if t != tier or not alive:
		tier = t
		_set_tier_fx(t)
	alive = true
	body.visible = true
	dead.visible = false
	_set_crack(Rules.crack_level(m.hp, m.max_hp), fx)
	hp_bar.visible = true
	hp_bar.set_ratio(m.ratio(), fx)


func _set_dead_visuals() -> void:
	var key := Rules.dead_variant(index)
	if key != current_key:
		dead.texture = TEX[key]
		current_key = key
	alive = false
	body.visible = false
	dead.visible = true
	dead.position = Vector2.ZERO
	dead.modulate.a = 1.0
	crack.visible = false
	_crack_level = 0
	hp_bar.visible = false
	_glow_off()


func _revive() -> void:
	_kill_all()
	alive = false
	_sim_dead = false
	_dead_grace = 0
	current_key = ""          # force the body texture swap
	body.visible = true
	body.scale = BODY_SCALE
	body.rotation = 0.0
	body.modulate.a = 1.0
	dead.visible = false
	pivot.scale = Vector2.ONE
	pivot.position = PIVOT


## Ore glow (tier 1 ice static, tier 2 magma pulse) + debris colours per tier.
func _set_tier_fx(t: int) -> void:
	var stone: Color = Config.STONE[t]
	var ore: Color = Config.ORE[t]
	var init := Gradient.new()
	init.offsets = PackedFloat32Array([0.0, 1.0])
	init.colors = PackedColorArray([stone, ore])
	debris.color_initial_ramp = init
	var fade := Gradient.new()
	fade.offsets = PackedFloat32Array([0.0, 0.7, 1.0])
	fade.colors = PackedColorArray([Color.WHITE, Color.WHITE, Color(1, 1, 1, 0)])
	debris.color_ramp = fade
	_glow_off()
	if not Config.fx_enabled or Config.reduced_motion:
		ore_glow.modulate = Color(ore, 0.0)
		return
	match t:
		1:
			ore_glow.modulate = Color(ore, 0.12)
		2:
			ore_glow.modulate = Color(ore, 0.15)
			_glow_tw = create_tween().set_loops()
			_glow_tw.tween_property(ore_glow, "modulate:a", 0.35, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
			_glow_tw.tween_property(ore_glow, "modulate:a", 0.15, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_:
			ore_glow.modulate = Color(ore, 0.0)


func _glow_off() -> void:
	if _glow_tw != null and _glow_tw.is_valid():
		_glow_tw.kill()
	ore_glow.modulate.a = 0.0


func _set_crack(level: int, fx: bool) -> void:
	if level == _crack_level:
		return
	_crack_level = level
	if level <= 0:
		crack.visible = false
		return
	crack.texture = TEX["crack_%d" % level]
	crack.visible = true
	if fx and Config.juice_scale() > 0.0:
		crack.modulate = Color(1, 1, 1, 0)
		var tw := create_tween()
		tw.tween_property(crack, "modulate:a", 1.0, 0.15)
	else:
		crack.modulate = Color.WHITE


## A predicted bomb landed for `dmg`. Returns true when the block just died.
func play_hit(dmg: int) -> bool:
	if not alive:
		return false
	predicted_hp = maxi(0, predicted_hp - dmg)
	if predicted_hp <= 0:
		play_death(dmg)
		return true
	hp_bar.set_ratio(float(predicted_hp) / float(max_hp), true)
	_set_crack(Rules.crack_level(predicted_hp, max_hp), true)
	var j := Config.juice_scale()
	if not Config.fx_enabled or j <= 0.0:
		return false
	# white flash
	if _flash_tw != null and _flash_tw.is_valid():
		_flash_tw.kill()
	flash.modulate.a = flash_alpha
	_flash_tw = create_tween()
	_flash_tw.tween_property(flash, "modulate:a", 0.0, flash_seconds)
	# squash / stretch / settle (elastic out)
	if _hit_tw != null and _hit_tw.is_valid():
		_hit_tw.kill()
	var sq := Vector2.ONE.lerp(squash, j)
	var st := Vector2.ONE.lerp(stretch, j)
	_hit_tw = create_tween()
	_hit_tw.tween_property(pivot, "scale", sq, squash_seconds * 0.18)
	_hit_tw.tween_property(pivot, "scale", st, squash_seconds * 0.28)
	_hit_tw.tween_property(pivot, "scale", Vector2.ONE, squash_seconds * 0.54).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)
	# +-2 px jitter x3
	if _jitter_tw != null and _jitter_tw.is_valid():
		_jitter_tw.kill()
	_jitter_tw = create_tween()
	var amp := jitter_px * j
	for k in 3:
		_jitter_tw.tween_property(pivot, "position", PIVOT + Vector2(amp if k % 2 == 0 else -amp, 0), 0.03)
	_jitter_tw.tween_property(pivot, "position", PIVOT, 0.03)
	return false


## Block death visuals: body shrinks and tilts, the dead floor rises in, debris
## bursts. Emits `died` so Fx can add hit-stop, light, shake and float text.
func play_death(last_dmg: int) -> void:
	if not alive:
		return
	alive = false
	_sim_dead = true
	predicted_hp = 0
	var key := Rules.dead_variant(index)
	dead.texture = TEX[key]
	current_key = key
	hp_bar.visible = false
	crack.visible = false
	_crack_level = 0
	_glow_off()
	if _hit_tw != null and _hit_tw.is_valid():
		_hit_tw.kill()
	if _jitter_tw != null and _jitter_tw.is_valid():
		_jitter_tw.kill()
	pivot.scale = Vector2.ONE
	pivot.position = PIVOT
	var j := Config.juice_scale()
	if Config.fx_enabled and j > 0.0:
		if _death_tw != null and _death_tw.is_valid():
			_death_tw.kill()
		dead.visible = true
		dead.position = Vector2(0, death_rise_px)
		dead.modulate.a = 0.0
		_death_tw = create_tween().set_parallel(true)
		_death_tw.tween_property(body, "scale", Vector2.ZERO, death_seconds).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
		_death_tw.tween_property(body, "rotation_degrees", (15.0 if index % 2 == 0 else -15.0), death_seconds)
		_death_tw.tween_property(dead, "position:y", 0.0, 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		_death_tw.tween_property(dead, "modulate:a", 1.0, 0.3)
		_death_tw.chain().tween_callback(func() -> void:
			body.visible = false
			body.scale = BODY_SCALE
			body.rotation = 0.0)
		debris.amount = maxi(4, int(death_debris * (0.3 if Config.reduced_motion else 1.0)))
		debris.restart()
	else:
		body.visible = false
		dead.visible = true
		dead.position = Vector2.ZERO
		dead.modulate.a = 1.0
	died.emit(index, last_dmg)


## Map regeneration / scene enter: the cell pops in after `delay` seconds.
func play_spawn(delay: float) -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	if _hit_tw != null and _hit_tw.is_valid():
		_hit_tw.kill()
	if _spawn_tw != null and _spawn_tw.is_valid():
		_spawn_tw.kill()
	pivot.scale = Vector2.ZERO
	hp_bar.modulate.a = 0.0
	_spawn_tw = create_tween()
	_spawn_tw.tween_interval(maxf(0.0, delay))
	_spawn_tw.tween_property(pivot, "scale", Vector2.ONE, spawn_seconds).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_spawn_tw.parallel().tween_property(hp_bar, "modulate:a", 1.0, spawn_seconds)
	_spawn_tw.parallel().tween_callback(func() -> void:
		if alive:
			debris.amount = 8
			debris.restart())


## Silent catch-up (reconcile): moves the bar/cracks without hit FX.
func set_predicted_hp(v: int) -> void:
	predicted_hp = clampi(v, 0, max_hp)
	if not alive:
		return
	hp_bar.set_ratio(float(predicted_hp) / float(max_hp), true)
	_set_crack(Rules.crack_level(predicted_hp, max_hp), false)


func _kill_all() -> void:
	for tw: Tween in [_hit_tw, _jitter_tw, _flash_tw, _death_tw, _spawn_tw]:
		if tw != null and tw.is_valid():
			tw.kill()
	flash.modulate.a = 0.0
	hp_bar.modulate.a = 1.0
