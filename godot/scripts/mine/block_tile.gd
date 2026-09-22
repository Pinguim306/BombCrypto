class_name BlockTile
extends Node2D
## One ore deposit on the map: an organic mound (env/ore_<tier>_<variant>.png,
## a 3-frame strip: intact / cracked / heavily damaged) that shows
## Layout.BLOCKS_PER_DEPOSIT consecutive server blocks — its hp bar and damage
## frame follow the SUM of their hp, it is alive while any of them is, and it
## dies (crater, sometimes a crystal) when the last one goes. The node sits at
## the BOTTOM edge of its tile so the y-sorted Actors layer draws heroes
## standing below it in front, and heroes above it behind.
##
## The predictive bomb sim drives `play_hit(sub, dmg)` between polls (sub =
## which of the deposit's blocks was hit); `apply()` snaps to the server truth
## on every poll and reconciles silently when they differ.

signal died(index: int, last_dmg: int)

const DEAD_GRACE_POLLS := 2                       # keep a predicted death while the server catches up
const SPRITE_CENTER := Vector2(24, -24)           # sprite centre relative to the node (tile bottom-left)
const HP_BAR_POS := Vector2(4, -8)

@export var flash_alpha := 0.7
@export var flash_seconds := 0.07
@export var squash := Vector2(1.12, 0.88)
@export var stretch := Vector2(0.97, 1.03)
@export var squash_seconds := 0.28
@export var jitter_px := 2.0
@export var death_seconds := 0.2
@export var death_debris := 40
@export var spawn_seconds := 0.3

@onready var pivot: Node2D = $Pivot
@onready var body: Sprite2D = $Pivot/Body
@onready var crack: Sprite2D = $Pivot/Crack
@onready var flash: Sprite2D = $Pivot/Flash
@onready var ore_glow: Sprite2D = $Pivot/OreGlow
@onready var crater: Sprite2D = $Crater
@onready var crystal: Sprite2D = $Crystal
@onready var crystal_glow: Sprite2D = $Crystal/Glow
@onready var hp_bar: HpBar = $HpBar
@onready var debris: CPUParticles2D = $Debris

var index := -1                # deposit index (0..19)
var current_key := ""          # "block_<tier>" | "dead" | "dead_crystal"
var damage_level := 0          # frame of the ore strip currently shown (0..2)
var hp := 0                    # server hp (sum over the deposit's blocks)
var max_hp := 1                # sum of max hp
var block_max: Array[int] = [] # per block, server maxHp
var predicted: Array[int] = [] # per block, visual hp (server hp minus predicted bombs)
var tier := 0
var alive := false             # visual state
var _crack_level := 0
var _sim_dead := false         # died from a predicted bomb, not yet confirmed
var _dead_grace := 0
var _glow_tw: Tween
var _hit_tw: Tween
var _jitter_tw: Tween
var _flash_tw: Tween
var _death_tw: Tween
var _spawn_tw: Tween


func setup(i: int) -> void:
	index = i
	position = Layout.deposit_origin(i) + Vector2(0, Layout.TILE)
	crystal.visible = false
	crater.visible = false
	crystal_glow.visible = false
	crater.texture = Sheets.texture("env/crater.png")
	crystal.texture = Sheets.texture("env/floor_crystal.png")
	crack.visible = false   # damage is baked into the ore strip frames
	block_max.resize(Layout.BLOCKS_PER_DEPOSIT)
	predicted.resize(Layout.BLOCKS_PER_DEPOSIT)
	block_max.fill(1)
	predicted.fill(0)


## Visual hp of the deposit (sum of the predicted per-block hp).
func predicted_hp() -> int:
	var s := 0
	for v in predicted:
		s += v
	return s


## Strip for this deposit: tier picks the ore, the index picks the silhouette variant.
func _ore_rel(t: int) -> String:
	return "env/ore_%d_%d.png" % [clampi(t, 0, 2), index % 2]


func _set_frame(level: int) -> void:
	damage_level = clampi(level, 0, 2)
	var tex := Sheets.frame(_ore_rel(tier), damage_level)
	body.texture = tex
	flash.texture = tex


## Renders the server truth for the deposit's blocks. `animate` = not the
## first render and FX enabled.
func apply(blocks: Array[BlockModel], animate: bool) -> void:
	var fx := animate and Config.fx_enabled
	var sum_hp := 0
	var sum_max := 0
	var top_max := 0
	var fresh := false
	for k in blocks.size():
		var m := blocks[k]
		if k < block_max.size() and m.max_hp != block_max[k]:
			fresh = true
		sum_hp += m.hp
		sum_max += maxi(1, m.max_hp)
		top_max = maxi(top_max, m.max_hp)
	hp = sum_hp
	max_hp = maxi(1, sum_max)
	var now_alive := sum_hp > 0
	if now_alive:
		if not alive and current_key != "":
			# visual dead, server alive: a predicted death the server has not confirmed yet
			if _sim_dead and not fresh and fx and _dead_grace < DEAD_GRACE_POLLS:
				_dead_grace += 1
				_snap_blocks(blocks)
				return
			_revive()
		_set_alive_visuals(blocks, top_max, fx)
	else:
		if alive:
			if fx:
				play_death(maxi(1, predicted_hp()))   # remaining visual hp = the last hit
			else:
				_set_dead_visuals()
		else:
			_set_dead_visuals()
		_sim_dead = false
		_dead_grace = 0
	_snap_blocks(blocks)


func _snap_blocks(blocks: Array[BlockModel]) -> void:
	for k in mini(blocks.size(), predicted.size()):
		block_max[k] = maxi(1, blocks[k].max_hp)
		predicted[k] = blocks[k].hp


func _set_alive_visuals(blocks: Array[BlockModel], top_max: int, fx: bool) -> void:
	var t := Rules.block_tier(top_max)
	var key := "block_%d" % t
	if key != current_key:
		current_key = key
		_crack_level = -1   # new tier / revived: force the strip frame to load
	if t != tier or not alive:
		tier = t
		_set_tier_fx(t)
	alive = true
	body.visible = true
	crater.visible = false
	crystal.visible = false
	crystal_glow.visible = false
	var sum_hp := 0
	var sum_max := 0
	for m in blocks:
		sum_hp += m.hp
		sum_max += maxi(1, m.max_hp)
	_set_crack(Rules.crack_level(sum_hp, sum_max), fx)
	hp_bar.visible = true
	hp_bar.set_ratio(float(sum_hp) / float(maxi(1, sum_max)), fx)


func _set_dead_visuals() -> void:
	var key := _dead_key()
	if key != current_key:
		current_key = key
	alive = false
	body.visible = false
	flash.modulate.a = 0.0
	crater.visible = true
	crater.modulate.a = 1.0
	crystal.visible = key == "dead_crystal"
	crystal.modulate.a = 1.0
	crystal_glow.visible = crystal.visible and Config.fx_enabled
	crack.visible = false
	_crack_level = 0
	hp_bar.visible = false
	_glow_off()


func _dead_key() -> String:
	return "dead_crystal" if Rules.dead_variant(index) == "block_dead2" else "dead"


func _revive() -> void:
	_kill_all()
	alive = false
	_sim_dead = false
	_dead_grace = 0
	current_key = ""          # force the body texture swap
	body.visible = true
	body.scale = Vector2.ONE
	body.rotation = 0.0
	body.modulate.a = 1.0
	crater.visible = false
	crystal.visible = false
	crystal_glow.visible = false
	pivot.scale = Vector2.ONE
	pivot.position = SPRITE_CENTER


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
			ore_glow.modulate = Color(ore, 0.10)
		2:
			ore_glow.modulate = Color(ore, 0.14)
			_glow_tw = create_tween().set_loops()
			_glow_tw.tween_property(ore_glow, "modulate:a", 0.30, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
			_glow_tw.tween_property(ore_glow, "modulate:a", 0.14, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		_:
			ore_glow.modulate = Color(ore, 0.0)


func _glow_off() -> void:
	if _glow_tw != null and _glow_tw.is_valid():
		_glow_tw.kill()
	ore_glow.modulate.a = 0.0


## Damage stage: swaps the ore strip frame (a brief flash sells the change).
func _set_crack(level: int, fx: bool) -> void:
	var changed := level != _crack_level or damage_level != level or body.texture == null
	_crack_level = level
	if not changed:
		return
	_set_frame(level)
	if fx and Config.juice_scale() > 0.0 and level > 0:
		if _flash_tw != null and _flash_tw.is_valid():
			_flash_tw.kill()
		flash.modulate.a = 0.5
		_flash_tw = create_tween()
		_flash_tw.tween_property(flash, "modulate:a", 0.0, 0.12)


## A predicted bomb landed on the deposit's block `sub` for `dmg`. Returns
## true when the deposit just died (its last block went to 0).
func play_hit(sub: int, dmg: int) -> bool:
	if not alive:
		return false
	sub = clampi(sub, 0, predicted.size() - 1)
	predicted[sub] = maxi(0, predicted[sub] - dmg)
	var left := predicted_hp()
	if left <= 0:
		play_death(dmg)
		return true
	hp_bar.set_ratio(float(left) / float(max_hp), true)
	_set_crack(Rules.crack_level(left, max_hp), true)
	var j := Config.juice_scale()
	if not Config.fx_enabled or j <= 0.0:
		return false
	if _flash_tw != null and _flash_tw.is_valid():
		_flash_tw.kill()
	flash.modulate.a = flash_alpha
	_flash_tw = create_tween()
	_flash_tw.tween_property(flash, "modulate:a", 0.0, flash_seconds)
	if _hit_tw != null and _hit_tw.is_valid():
		_hit_tw.kill()
	var sq := Vector2.ONE.lerp(squash, j)
	var st := Vector2.ONE.lerp(stretch, j)
	_hit_tw = create_tween()
	_hit_tw.tween_property(pivot, "scale", sq, squash_seconds * 0.18)
	_hit_tw.tween_property(pivot, "scale", st, squash_seconds * 0.28)
	_hit_tw.tween_property(pivot, "scale", Vector2.ONE, squash_seconds * 0.54).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)
	if _jitter_tw != null and _jitter_tw.is_valid():
		_jitter_tw.kill()
	_jitter_tw = create_tween()
	var amp := jitter_px * j
	for k in 3:
		_jitter_tw.tween_property(pivot, "position", SPRITE_CENTER + Vector2(amp if k % 2 == 0 else -amp, 0), 0.03)
	_jitter_tw.tween_property(pivot, "position", SPRITE_CENTER, 0.03)
	return false


## Deposit death: the mound shrinks away, debris bursts, the crater fades in
## (and the crystal rises on the crystal variant). Emits `died`.
func play_death(last_dmg: int) -> void:
	if not alive:
		return
	alive = false
	_sim_dead = true
	predicted.fill(0)
	current_key = _dead_key()
	hp_bar.visible = false
	crack.visible = false
	_crack_level = 0
	_glow_off()
	if _hit_tw != null and _hit_tw.is_valid():
		_hit_tw.kill()
	if _jitter_tw != null and _jitter_tw.is_valid():
		_jitter_tw.kill()
	pivot.scale = Vector2.ONE
	pivot.position = SPRITE_CENTER
	var with_crystal := current_key == "dead_crystal"
	var j := Config.juice_scale()
	if Config.fx_enabled and j > 0.0:
		if _death_tw != null and _death_tw.is_valid():
			_death_tw.kill()
		crater.visible = true
		crater.modulate.a = 0.0
		crystal.visible = with_crystal
		crystal.modulate.a = 0.0
		crystal.position = Vector2(24, -18)
		_death_tw = create_tween().set_parallel(true)
		_death_tw.tween_property(body, "scale", Vector2(1.1, 0.0), death_seconds).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
		_death_tw.tween_property(body, "rotation_degrees", (10.0 if index % 2 == 0 else -10.0), death_seconds)
		_death_tw.tween_property(crater, "modulate:a", 1.0, 0.3)
		if with_crystal:
			_death_tw.tween_property(crystal, "position:y", -24.0, 0.35).set_delay(0.1).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			_death_tw.tween_property(crystal, "modulate:a", 1.0, 0.25).set_delay(0.1)
		_death_tw.chain().tween_callback(func() -> void:
			body.visible = false
			body.scale = Vector2.ONE
			body.rotation = 0.0
			crystal.position = Vector2(24, -24)
			crystal_glow.visible = with_crystal and Config.fx_enabled)
		debris.amount = maxi(4, int(death_debris * (0.3 if Config.reduced_motion else 1.0)))
		debris.restart()
	else:
		_set_dead_visuals()
	died.emit(index, last_dmg)


## Map regeneration / scene enter: the mound pops in after `delay` seconds.
func play_spawn(delay: float) -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	if _hit_tw != null and _hit_tw.is_valid():
		_hit_tw.kill()
	if _spawn_tw != null and _spawn_tw.is_valid():
		_spawn_tw.kill()
	pivot.scale = Vector2(1.0, 0.0)
	hp_bar.modulate.a = 0.0
	_spawn_tw = create_tween()
	_spawn_tw.tween_interval(maxf(0.0, delay))
	_spawn_tw.tween_property(pivot, "scale", Vector2.ONE, spawn_seconds).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_spawn_tw.parallel().tween_property(hp_bar, "modulate:a", 1.0, spawn_seconds)
	_spawn_tw.parallel().tween_callback(func() -> void:
		if alive:
			debris.amount = 6
			debris.restart())


## Silent catch-up (reconcile): moves the bar/frame without hit FX.
func set_predicted_hp(sub: int, v: int) -> void:
	sub = clampi(sub, 0, predicted.size() - 1)
	predicted[sub] = clampi(v, 0, block_max[sub])
	if not alive:
		return
	var left := predicted_hp()
	hp_bar.set_ratio(float(left) / float(max_hp), true)
	_set_crack(Rules.crack_level(left, max_hp), false)


## Lights / glows toggled from the dev panel / host config.
func apply_config() -> void:
	crystal_glow.visible = crystal.visible and not alive and Config.fx_enabled


func _kill_all() -> void:
	for tw: Tween in [_hit_tw, _jitter_tw, _flash_tw, _death_tw, _spawn_tw]:
		if tw != null and tw.is_valid():
			tw.kill()
	flash.modulate.a = 0.0
	hp_bar.modulate.a = 1.0
