class_name Explosion
extends Node2D
## Pooled explosion (World layer, lit + shaken): the 3-frame "boom" sprite
## scaling 1 -> 1.35, an additive ring (Phaser spark parity: .3 -> 1.7, fading
## over .25 s), plus sparks and smoke from the shared particle presets.

@export var boom_scale_to := 1.35
@export var ring_from := 0.3
@export var ring_to := 1.7
@export var ring_seconds := 0.25

@onready var smoke: CPUParticles2D = $Smoke
@onready var ring: Sprite2D = $Ring
@onready var boom: AnimatedSprite2D = $Boom
@onready var sparks: CPUParticles2D = $Sparks

var busy := false
var started_ms := 0
var _tw: Tween
var _sparks_amount := 14
var _smoke_amount := 6


func _ready() -> void:
	visible = false
	_sparks_amount = sparks.amount
	_smoke_amount = smoke.amount
	boom.animation_finished.connect(func() -> void: boom.visible = false)


func play(pos: Vector2, tier: int) -> void:
	_kill()
	global_position = pos
	visible = true
	busy = true
	started_ms = Time.get_ticks_msec()
	var ore: Color = Config.ORE[clampi(tier, 0, Config.ORE.size() - 1)]
	var j := Config.juice_scale()
	boom.visible = true
	boom.scale = Vector2.ONE
	boom.frame = 0
	boom.play(&"boom")
	ring.visible = true
	ring.scale = Vector2.ONE * ring_from
	ring.modulate = Color(ore.lerp(Color.WHITE, 0.5), 1.0)
	_tw = create_tween().set_parallel(true)
	_tw.tween_property(boom, "scale", Vector2.ONE * lerpf(1.0, boom_scale_to, maxf(0.3, j)), 3.0 / 14.0)
	_tw.tween_property(ring, "scale", Vector2.ONE * ring_to, ring_seconds).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	_tw.tween_property(ring, "modulate:a", 0.0, ring_seconds)
	var pm := 0.3 if Config.reduced_motion else 1.0
	sparks.amount = maxi(1, int(_sparks_amount * pm))
	smoke.amount = maxi(1, int(_smoke_amount * pm))
	sparks.restart()
	smoke.restart()
	_tw.chain().tween_interval(0.9)
	_tw.chain().tween_callback(_done)


func stop() -> void:
	_kill()
	sparks.emitting = false
	smoke.emitting = false
	_done()


func _done() -> void:
	busy = false
	visible = false
	ring.visible = false


func _kill() -> void:
	if _tw != null and _tw.is_valid():
		_tw.kill()
