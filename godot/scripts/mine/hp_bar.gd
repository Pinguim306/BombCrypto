class_name HpBar
extends Node2D
## HP bar on a block's front face (40x4). Draws a dark background, a red
## "ghost" that lags 0.4 s behind damage, and the amber fill. `ratio` is the
## target, `shown` the drawn fraction; without FX both snap.

const BG := Color("10141f", 0.85)
const GHOST := Color("ef5350")
const FILL := Color("ffc107")
const PULSE_BELOW := 0.33
const GHOST_LAG := 0.4

@export var w := 40.0
@export var h := 4.0

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


## Drawn width of the amber fill in pixels (w * shown).
func fill_width() -> float:
	return w * shown


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
	_fill_alpha = 0.8 + 0.2 * sin(_t * TAU * 2.0)
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(-1, -1, w + 2, h + 2), BG)
	if ghost > shown:
		draw_rect(Rect2(0, 0, w * ghost, h), GHOST)
	if shown > 0.0:
		draw_rect(Rect2(0, 0, w * shown, h), Color(FILL, _fill_alpha))
		draw_rect(Rect2(0, 0, w * shown, 1), Color(1, 1, 1, 0.35 * _fill_alpha))
