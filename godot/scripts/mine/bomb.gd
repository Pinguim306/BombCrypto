class_name Bomb
extends Node2D
## Pooled bomb projectile (World/Bombs, above the actors). Flies along a
## quadratic bezier with an apex above the straight line, spins, drags a
## shadow on the ground line and a short trail, hops twice on landing and
## calls back so Fx applies the hit + explosion.

@export var apex_px := -70.0
@export var spins := 1.5
@export var trail_points := 7
@export var hop1_px := -7.0
@export var hop2_px := -3.0
@export var pause_seconds := 0.07

@onready var trail: Line2D = $Trail
@onready var shadow: Sprite2D = $Shadow
@onready var sprite: AnimatedSprite2D = $Sprite

var busy := false
var _from := Vector2.ZERO
var _to := Vector2.ZERO
var _points: PackedVector2Array = PackedVector2Array()
var _tw: Tween
var _on_land: Callable


func _ready() -> void:
	visible = false
	sprite.sprite_frames = Sheets.frames("chars/bomb.png", 10.0)
	shadow.texture = load("res://assets/fx/dust_8.png")


## Throws from `from` to `to` (screen coords); `on_land` is called once the
## bomb has settled (the caller applies the hit + explosion).
func throw(from: Vector2, to: Vector2, duration: float, on_land: Callable) -> void:
	_kill()
	busy = true
	visible = true
	_from = from
	_to = to
	_on_land = on_land
	position = from
	sprite.position = Vector2.ZERO
	sprite.rotation = 0.0
	sprite.play(&"default")
	shadow.position = Vector2.ZERO
	_points = PackedVector2Array()
	trail.clear_points()
	Sfx.play(&"bomb_throw")
	_tw = create_tween()
	_tw.tween_method(_step, 0.0, 1.0, maxf(0.05, duration)).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_tw.tween_callback(func() -> void:
		trail.clear_points()
		Sfx.play(&"bomb_land"))
	var j := Config.juice_scale()
	if j > 0.0:
		_tw.tween_property(sprite, "position:y", hop1_px * j, 0.05).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
		_tw.tween_property(sprite, "position:y", 0.0, 0.05).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
		_tw.tween_property(sprite, "position:y", hop2_px * j, 0.035)
		_tw.tween_property(sprite, "position:y", 0.0, 0.035)
	_tw.tween_interval(pause_seconds)
	_tw.tween_callback(_land)


func _step(t: float) -> void:
	var mid := (_from + _to) * 0.5 + Vector2(0.0, apex_px)
	var p := _from.lerp(mid, t).lerp(mid.lerp(_to, t), t)   # quadratic bezier
	var ground := _from.lerp(_to, t)
	position = p
	shadow.position = ground - p
	shadow.scale = Vector2(1.4, 0.6) * (1.0 - 0.4 * sin(t * PI))
	sprite.rotation_degrees = 360.0 * spins * t * (1.0 if _to.x >= _from.x else -1.0)
	_points.append(p)
	while _points.size() > trail_points:
		_points.remove_at(0)
	var local := PackedVector2Array()
	for q in _points:
		local.append(q - p)
	trail.points = local


func _land() -> void:
	busy = false
	visible = false
	sprite.stop()
	if _on_land.is_valid():
		_on_land.call()


## Cancels the flight (tab hidden / offline) without landing.
func stop() -> void:
	_kill()
	busy = false
	visible = false
	sprite.stop()


func _kill() -> void:
	if _tw != null and _tw.is_valid():
		_tw.kill()
