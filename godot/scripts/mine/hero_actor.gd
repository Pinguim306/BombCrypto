class_name HeroActor
extends Node2D
## One hero walking on the map. The node sits at the hero's FEET (its y-sort
## key). Frames come from chars/hero_<rarity>.png (idle / walk / throw /
## sleep, see the art manifest); the sheet faces right, so facing left is a
## flip. Purely visual: HeroActors decides where it goes and when it throws.

signal arrived
signal throw_done

enum State { IDLE, WALK, THROW, SLEEP }

const WALK_SPEED := 110.0          # px/s, raised when a throw is due sooner
const RELEASE_AT := 0.1            # s into the throw animation when the bomb leaves the hand
const THROW_SECONDS := 0.3
const SPRITE_POS := Vector2(0, -14)   # 32x32 frame, feet baseline at y=30 -> node origin
const HAND := Vector2(10, -22)

@onready var shadow: Sprite2D = $Shadow
@onready var sprite: AnimatedSprite2D = $Sprite
@onready var lamp: PointLight2D = $Lamp
@onready var zzz: AnimatedSprite2D = $Zzz
@onready var bolt: Sprite2D = $Bolt
@onready var dust: CPUParticles2D = $Dust

var hero_id := ""
var tile := Vector2i.ZERO
var target_tile := Vector2i.ZERO       # reserved spot (== tile when standing)
var state: int = State.IDLE
var rarity := -1
var mode := ""
var stamina := 0
var facing := 1                        # 1 right, -1 left
var lamp_wanted := false
var _gen := 0
var _walk_tw: Tween
var _fade_tw: Tween


func _ready() -> void:
	shadow.texture = Sheets.texture("chars/hero_shadow.png")
	shadow.position = Vector2(0, -1)
	sprite.position = SPRITE_POS
	zzz.sprite_frames = Sheets.frames("chars/zzz.png", 3.0)
	zzz.visible = false
	bolt.texture = Sheets.texture("ui/icon_bolt.png")
	bolt.visible = false
	lamp.enabled = false


## Renders a HeroModel: rarity picks the sheet, mode/stamina the idle extras.
func bind(h: HeroModel) -> void:
	hero_id = h.id
	mode = h.mode
	stamina = h.stamina
	if h.rarity != rarity:
		rarity = h.rarity
		sprite.sprite_frames = Sheets.frames("chars/hero_%d.png" % clampi(rarity, 0, 5))
		_play_state_anim()
	bolt.visible = h.is_working() and h.stamina < 1 and state != State.SLEEP


## Puts the actor on a tile without walking.
func place(t: Vector2i) -> void:
	_kill_walk()
	tile = t
	target_tile = t
	position = Layout.hero_pos(t)
	if state == State.WALK:
		state = State.IDLE
	_play_state_anim()


func is_busy() -> bool:
	return state == State.WALK or state == State.THROW


## Walks tile by tile along `path` (excluding the current tile), taking at
## most `max_seconds` in total. Emits `arrived` (also when the path is empty).
func walk(path: Array[Vector2i], max_seconds: float) -> void:
	_kill_walk()
	if path.is_empty():
		arrived.emit()
		return
	_gen += 1
	var g := _gen
	state = State.WALK
	zzz.visible = false
	bolt.visible = false
	sprite.play(&"walk")
	dust.emitting = Config.fx_enabled and not Config.reduced_motion
	var total := 0.0
	var prev := position
	for t in path:
		total += prev.distance_to(Layout.hero_pos(t))
		prev = Layout.hero_pos(t)
	var speed := maxf(WALK_SPEED, total / maxf(0.15, max_seconds))
	sprite.speed_scale = clampf(speed / WALK_SPEED, 1.0, 2.0)
	_walk_tw = create_tween()
	prev = position
	for t in path:
		var to := Layout.hero_pos(t)
		var seg := prev.distance_to(to)
		var dir := to - prev
		_walk_tw.tween_callback(_face.bind(dir))
		_walk_tw.tween_property(self, "position", to, seg / speed)
		_walk_tw.tween_callback(func() -> void: tile = t)
		prev = to
	_walk_tw.tween_callback(func() -> void:
		if g != _gen:
			return
		tile = path[path.size() - 1]
		target_tile = tile
		state = State.IDLE
		sprite.speed_scale = 1.0
		dust.emitting = false
		_play_state_anim()
		arrived.emit())


## Plays the throw pose towards `target_pos`; `on_release(hand_pos)` fires
## when the bomb leaves the hand. Emits `throw_done` afterwards.
func throw_at(target_pos: Vector2, on_release: Callable) -> void:
	_gen += 1
	var g := _gen
	state = State.THROW
	zzz.visible = false
	_face(target_pos - position)
	sprite.speed_scale = 1.0
	sprite.play(&"throw")
	if Config.fx_enabled and Config.juice_scale() > 0.0:
		get_tree().create_timer(RELEASE_AT).timeout.connect(func() -> void:
			if g == _gen and is_inside_tree():
				on_release.call(hand_pos()))
		get_tree().create_timer(THROW_SECONDS).timeout.connect(func() -> void:
			if g != _gen or not is_inside_tree():
				return
			state = State.IDLE
			_play_state_anim()
			throw_done.emit())
	else:
		on_release.call(hand_pos())
		state = State.IDLE
		_play_state_anim()
		throw_done.emit()


func sleep() -> void:
	_kill_walk()
	_gen += 1
	state = State.SLEEP
	bolt.visible = false
	zzz.visible = Config.fx_enabled
	if zzz.visible:
		zzz.play(&"default")
	sprite.play(&"sleep")
	_set_lamp(false)


func wake() -> void:
	if state == State.SLEEP:
		state = State.IDLE
	_play_state_anim()
	_set_lamp(lamp_wanted)


## Where thrown bombs start.
func hand_pos() -> Vector2:
	return position + Vector2(HAND.x * facing, HAND.y)


## Head-lamp light (only a few actors get one: the GL renderer caps lights).
func set_lamp_wanted(on: bool) -> void:
	lamp_wanted = on
	_set_lamp(on and state != State.SLEEP)


func _set_lamp(on: bool) -> void:
	lamp.enabled = on and Config.fancy_lights and Config.fx_enabled


func spawn_in() -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		modulate.a = 1.0
		return
	modulate.a = 0.0
	scale = Vector2(1.0, 0.6)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(self, "modulate:a", 1.0, 0.25)
	tw.tween_property(self, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## Fades out and frees the node.
func fade_out() -> void:
	_kill_walk()
	_gen += 1
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		queue_free()
		return
	_fade_tw = create_tween()
	_fade_tw.tween_property(self, "modulate:a", 0.0, 0.2)
	_fade_tw.tween_callback(queue_free)


## Mine-all flourish: a little hop.
func hop() -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0 or state == State.WALK:
		return
	var tw := create_tween()
	tw.tween_property(sprite, "position:y", SPRITE_POS.y - 6.0, 0.1).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	tw.tween_property(sprite, "position:y", SPRITE_POS.y, 0.12).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)


func _face(dir: Vector2) -> void:
	if absf(dir.x) < 0.5:
		return
	facing = 1 if dir.x > 0.0 else -1
	sprite.flip_h = facing < 0
	zzz.position.x = 12.0 * facing


func _play_state_anim() -> void:
	if sprite.sprite_frames == null:
		return
	match state:
		State.SLEEP:
			sprite.play(&"sleep")
		State.WALK:
			sprite.play(&"walk")
		State.THROW:
			pass
		_:
			sprite.play(&"idle")
			# desync idle loops between heroes
			sprite.frame = hash(hero_id) % maxi(1, sprite.sprite_frames.get_frame_count(&"idle"))


func _kill_walk() -> void:
	if _walk_tw != null and _walk_tw.is_valid():
		_walk_tw.kill()
	dust.emitting = false
	sprite.speed_scale = 1.0
