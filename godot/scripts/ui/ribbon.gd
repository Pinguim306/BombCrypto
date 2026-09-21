@tool
class_name Ribbon
extends Control
## Banner-style title ribbon (ui.ts drawRibbon). The node's position is the
## ribbon's CENTRE, like the Phaser container; it draws around (0, 0).

const BOLD: FontFile = preload("res://assets/fonts/DejaVuSansMono-Bold.ttf")
const H := 32.0
const FONT_SIZE := 17

@export var text: String = "RIBBON":
	set(v):
		text = v
		queue_redraw()
@export var fixed_width: int = 0:
	set(v):
		fixed_width = v
		queue_redraw()


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func width() -> float:
	if fixed_width > 0:
		return float(fixed_width)
	var tw: float = BOLD.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE).x
	return maxf(150.0, tw + 56.0)


func _draw() -> void:
	var w := width()
	var hw := w / 2.0
	var hh := H / 2.0
	# notched banner tails
	var tail := Color("a05f10")
	draw_colored_polygon(PackedVector2Array([Vector2(-hw - 14, 0), Vector2(-hw + 4, -hh), Vector2(-hw + 4, hh)]), tail)
	draw_colored_polygon(PackedVector2Array([Vector2(hw + 14, 0), Vector2(hw - 4, -hh), Vector2(hw - 4, hh)]), tail)
	# main band with outline + highlight
	UiDraw.rounded(self, Rect2(-hw - 2, -hh - 2, w + 4, H + 4), Color("0a0e18"), 6)
	UiDraw.rounded(self, Rect2(-hw, -hh, w, H), Color("e8952f"), 5)
	UiDraw.rounded(self, Rect2(-hw + 3, -hh + 3, w - 6, 4), Color("ffcf80", 0.9), 2)
	# label centred on the band (draw_string's position is the baseline)
	var asc: float = BOLD.get_ascent(FONT_SIZE)
	var desc: float = BOLD.get_descent(FONT_SIZE)
	draw_string(BOLD, Vector2(-hw, (asc - desc) / 2.0), text, HORIZONTAL_ALIGNMENT_CENTER, w, FONT_SIZE, Color("221400"))
