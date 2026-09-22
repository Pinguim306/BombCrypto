@tool
class_name CounterPlate
extends Control
## Dark plate with a gold rim (ui/plate.png), an icon on the left, a big
## pixel-font value and a small muted sub-line. The value is a CounterLabel so
## the HUD can tween numbers into it and punch/flash it.

@export var icon_rel: String = "ui/icon_coin.png":
	set(v):
		icon_rel = v
		_apply()
@export var icon_size: int = 24:
	set(v):
		icon_size = v
		_apply()
@export var value_color: Color = Color("ffca28"):
	set(v):
		value_color = v
		_apply()
@export var value_size: int = 12
@export var sub_size: int = 13

var plate: NinePatchRect
var icon: TextureRect
var value_label: CounterLabel
var sub_label: Label


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _ready() -> void:
	plate = get_node_or_null("Plate") as NinePatchRect
	if plate == null:
		plate = NinePatchRect.new()
		plate.name = "Plate"
		plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(plate)
	icon = get_node_or_null("Icon") as TextureRect
	if icon == null:
		icon = TextureRect.new()
		icon.name = "Icon"
		icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		icon.stretch_mode = TextureRect.STRETCH_SCALE
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		add_child(icon)
	value_label = get_node_or_null("ValueLabel") as CounterLabel
	if value_label == null:
		value_label = CounterLabel.new()
		value_label.name = "ValueLabel"
		add_child(value_label)
	sub_label = get_node_or_null("SubLabel") as Label
	if sub_label == null:
		sub_label = Label.new()
		sub_label.name = "SubLabel"
		add_child(sub_label)
	Sheets.nine_patch(plate, "ui/plate.png", 10)
	resized.connect(_apply)
	_apply()


func set_text(t: String) -> void:
	if value_label != null:
		value_label.text = t


func set_sub(t: String) -> void:
	if sub_label != null:
		sub_label.text = t
		sub_label.visible = t != ""


func _apply() -> void:
	if plate == null:
		return
	plate.position = Vector2.ZERO
	plate.size = size
	var tex := Sheets.texture(icon_rel) if icon_rel != "" else null
	icon.texture = tex
	icon.visible = tex != null
	icon.size = Vector2(icon_size, icon_size)
	icon.position = Vector2(10, (size.y - icon_size) / 2.0)
	var x0 := 10.0 + (icon_size + 8.0 if tex != null else 0.0)
	value_label.theme_type_variation = &"PixelLabel"
	value_label.add_theme_font_size_override("font_size", value_size)
	value_label.add_theme_color_override("font_color", value_color)
	value_label.add_theme_color_override("font_outline_color", Color("10141f"))
	value_label.add_theme_constant_override("outline_size", 3)
	value_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	value_label.clip_text = true
	value_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var has_sub := sub_label.text != "" and sub_label.visible
	value_label.position = Vector2(x0, 2 if has_sub else 0)
	value_label.size = Vector2(size.x - x0 - 8, (size.y * 0.6) if has_sub else size.y)
	sub_label.add_theme_font_size_override("font_size", sub_size)
	sub_label.add_theme_color_override("font_color", Color("b0bec5"))
	sub_label.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	sub_label.clip_text = true
	sub_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sub_label.position = Vector2(x0, size.y * 0.55)
	sub_label.size = Vector2(size.x - x0 - 8, size.y * 0.45)
