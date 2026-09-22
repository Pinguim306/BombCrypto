class_name NetBanner
extends Control
## Thin top strip shown while polling is failing: "connection problem —
## retrying in Ns". Driven by GameState.net_changed; hides on the next success.

var _bg: ColorRect
var _label: Label
var _until_ms := 0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	position = Vector2.ZERO
	size = Vector2(Layout.VIEW.x, 22)
	_bg = ColorRect.new()
	_bg.color = Color("b71c1c", 0.85)
	_bg.size = size
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_bg)
	_label = Label.new()
	_label.size = size
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.add_theme_font_size_override("font_size", 12)
	_label.add_theme_color_override("font_color", Color("ffcdd2"))
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_label)
	visible = false
	GameState.net_changed.connect(show_failures)


func show_failures(failures: int, next_ms: int) -> void:
	if failures <= 0:
		visible = false
		return
	_until_ms = Time.get_ticks_msec() + next_ms
	visible = true
	_update()


func _process(_delta: float) -> void:
	if visible:
		_update()


func _update() -> void:
	var s: int = maxi(0, int(ceil(float(_until_ms - Time.get_ticks_msec()) / 1000.0)))
	_label.text = "connection problem — retrying in %ds" % s
