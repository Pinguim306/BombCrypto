class_name HpBar
extends Node2D
## HP bar under a grid cell (Phaser: a 58x5 amber rectangle). Draws a dark
## background, a red "ghost" that lags 0.4 s behind damage, and the amber fill.
## `ratio` is the target, `shown` the drawn fraction; without FX both snap.

const W := 58.0
const H := 5.0
const BG := Color("263238", 0.7)
const GHOST := Color("ef5350")
const FILL := Color("ffc107")
const PULSE_BELOW := 0.33
const GHOST_LAG := 0.4

var ratio := 1.0
var shown := 1.0:
	set(v):
		shown = v
		queue_redraw()
var ghost := 1.0:
	set(v):
		ghost = v
		queue_redraw()

var _fill_alpha := 1.0
var _pulse := false
var _t := 0.0
var _tw: Tween
var _ghost_tw: Tween


func _ready() -> void:
	set_process(false)
	queue_redraw()


## Sets the target fraction. `animate` tweens the fill (0.25 s) and lets the
## ghost lag behind; otherwise everything snaps (first render, headless).
func set_ratio(r: float, animate: bool) -> void:
	r = clampf(r, 0.0, 1.0)
	ratio = r
	_kill()
	if not animate or not Config.fx_enabled:
		shown = r
		ghost = r
		_update_pulse()
		return
	_tw = create_tween()
	_tw.tween_property(self, "shown", r, 0.25).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	if r < ghost:
		_ghost_tw = create_tween()
		_ghost_tw.tween_interval(GHOST_LAG)
		_ghost_tw.tween_property(self, "ghost", r, 0.25).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	else:
		ghost = r
	_update_pulse()


## Drawn width of the amber fill in pixels (58 * shown).
func fill_width() -> float:
	return W * shown


func _kill() -> void:
	if _tw != null and _tw.is_valid():
		_tw.kill()
	if _ghost_tw != null and _ghost_tw.is_valid():
		_ghost_tw.kill()


func _update_pulse() -> void:
	var want := ratio > 0.0 and ratio < PULSE_BELOW and Config.fx_enabled and Config.juice_scale() > 0.0
	if want == _pulse:
		return
	_pulse = want
	set_process(_pulse)
	if not _pulse:
		_fill_alpha = 1.0
		queue_redraw()


func _process(delta: float) -> void:
	_t += delta
	# 2 Hz pulse between alpha 1.0 and 0.6
	_fill_alpha = 0.8 + 0.2 * sin(_t * TAU * 2.0)
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(0, 0, W, H), BG)
	if ghost > shown:
		draw_rect(Rect2(0, 0, W * ghost, H), GHOST)
	if shown > 0.0:
		draw_rect(Rect2(0, 0, W * shown, H), Color(FILL, _fill_alpha))
