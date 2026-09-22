@tool
class_name Ribbon
extends Control
## Red ribbon title banner (ui/ribbon.png, 9-slice) with centred pixel text.
## The control's rect is the ribbon; `text` is the title.

@export var text: String = "TITLE":
	set(v):
		text = v
		if _label != null:
			_label.text = v
@export var font_size: int = 8:
	set(v):
		font_size = v
		if _label != null:
			_label.add_theme_font_size_override("font_size", v)

var _np: NinePatchRect
var _label: Label


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _ready() -> void:
	_np = get_node_or_null("Patch") as NinePatchRect
	if _np == null:
		_np = NinePatchRect.new()
		_np.name = "Patch"
		_np.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_np)
	Sheets.nine_patch(_np, "ui/ribbon.png", 24)
	_label = get_node_or_null("Text") as Label
	if _label == null:
		_label = Label.new()
		_label.name = "Text"
		_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_label)
	_label.theme_type_variation = &"PixelLabel"
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.add_theme_color_override("font_color", Color("fff3d6"))
	_label.add_theme_color_override("font_outline_color", Color("5a0f0f"))
	_label.add_theme_constant_override("outline_size", 3)
	_label.add_theme_font_size_override("font_size", font_size)
	_label.text = text
	resized.connect(_layout)
	_layout()


func _layout() -> void:
	if _np == null:
		return
	_np.position = Vector2.ZERO
	_np.size = size
	_label.position = Vector2(20, -1)
	_label.size = Vector2(size.x - 40, size.y)
