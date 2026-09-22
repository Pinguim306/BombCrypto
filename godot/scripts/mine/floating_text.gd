class_name FloatingText
extends Label
## Pooled rising label ("+0.83", "-12") for the Hud FxOverlay layer.

const OUTLINE := Color("0a0e18")

var busy := false
var _tw: Tween


func _ready() -> void:
	visible = false
	z_index = 100
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	add_theme_color_override("font_outline_color", OUTLINE)
	add_theme_constant_override("outline_size", 2)


func show_at(pos: Vector2, txt: String, color: Color) -> void:
	if _tw != null and _tw.is_valid():
		_tw.kill()
	busy = true
	text = txt
	add_theme_color_override("font_color", color)
	reset_size()
	visible = true
	modulate.a = 1.0
	var start := pos - Vector2(size.x * 0.5, 10.0)
	position = start
	if not Config.fx_enabled:
		_done()
		return
	_tw = create_tween().set_parallel(true)
	_tw.tween_property(self, "position:y", start.y - 40.0 * maxf(0.25, Config.juice_scale()), 0.85) \
		.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	_tw.tween_property(self, "modulate:a", 0.0, 0.5).set_delay(0.35)
	_tw.chain().tween_callback(_done)


func stop() -> void:
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_done()


func _done() -> void:
	busy = false
	visible = false
