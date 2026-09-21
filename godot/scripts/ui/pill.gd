@tool
class_name Pill
extends Control
## Dark pill counter (ui.ts drawPill): position = top-left, 28 px tall, an
## icon on the left and a bold value label. The label is a CounterLabel so
## the mining HUD can tween numbers into it.

const BOLD: FontFile = preload("res://assets/fonts/DejaVuSansMono-Bold.ttf")
const H := 28.0

@export var width: int = 200:
	set(v):
		width = v
		_layout()
		queue_redraw()
@export var icon: Texture2D:
	set(v):
		icon = v
		queue_redraw()
@export var icon_scale: float = 0.6
@export var text_color: Color = Color("ffca28"):
	set(v):
		text_color = v
		_layout()

var value_label: CounterLabel


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST   # the pixel icon


func _ready() -> void:
	value_label = get_node_or_null("ValueLabel") as CounterLabel
	if value_label == null:
		value_label = CounterLabel.new()
		value_label.name = "ValueLabel"
		add_child(value_label)
	_layout()


func _layout() -> void:
	custom_minimum_size = Vector2(width, H)
	size = Vector2(width, H)
	if value_label == null:
		return
	value_label.position = Vector2(32, 0)
	value_label.size = Vector2(width - 40, H)
	value_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	value_label.clip_text = true
	value_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	value_label.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR   # smooth text
	value_label.add_theme_font_override("font", BOLD)
	value_label.add_theme_font_size_override("font_size", 14)
	value_label.add_theme_color_override("font_color", text_color)


func set_text(t: String) -> void:
	if value_label != null:
		value_label.text = t


func _draw() -> void:
	var w := float(width)
	UiDraw.rounded(self, Rect2(-2, -2, w + 4, H + 4), Color("0a0e18"), 16)
	UiDraw.rounded(self, Rect2(0, 0, w, H), Color("101624"), 14)
	UiDraw.rounded_stroke(self, Rect2(0, 0, w, H), Color("2a3550"), 14, 2)
	if icon != null:
		var s := icon.get_size() * icon_scale
		draw_texture_rect(icon, Rect2(Vector2(16, H / 2.0) - s / 2.0, s), false)
