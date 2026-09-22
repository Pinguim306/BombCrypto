@tool
class_name TexButton
extends Button
## Chunky textured button: 9-slice faces from assets/art/ui/btn_<colour>.png
## (normal / hover = brightened / pressed = the _down variant, content pushed
## 3 px) with the pixel title font, an optional icon and the same scale
## juice + sounds as the rest of the HUD. Fires `pressed` on release inside.

const COLOURS := ["green", "blue", "red", "gray", "gold", "teal"]
const OUTLINE := Color("10141f")
const DOWN_SHIFT := 3

@export_enum("green", "blue", "red", "gray", "gold", "teal") var color_name: String = "green":
	set(v):
		color_name = v
		_restyle()
@export var label: String = "Button":
	set(v):
		label = v
		text = v
@export var icon_texture: Texture2D:
	set(v):
		icon_texture = v
		icon = v
@export var font_size: int = 12:
	set(v):
		font_size = v
		add_theme_font_size_override("font_size", v)
@export var text_color: Color = Color.WHITE:
	set(v):
		text_color = v
		_recolor()

var _tw: Tween


func _init() -> void:
	theme_type_variation = &"TexButton"
	focus_mode = Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	expand_icon = false
	icon_alignment = HORIZONTAL_ALIGNMENT_LEFT
	alignment = HORIZONTAL_ALIGNMENT_CENTER
	clip_text = false


func _ready() -> void:
	text = label
	icon = icon_texture
	add_theme_font_size_override("font_size", font_size)
	add_theme_constant_override("outline_size", 3)
	add_theme_constant_override("h_separation", 6)
	add_theme_constant_override("icon_max_width", 20)
	add_theme_color_override("font_outline_color", OUTLINE)
	_recolor()
	_restyle()
	pivot_offset = size / 2.0
	resized.connect(func() -> void: pivot_offset = size / 2.0)
	mouse_entered.connect(_on_enter)
	mouse_exited.connect(_on_exit)
	button_down.connect(_on_down)
	button_up.connect(_on_up)


## Places the button so its face is centred on `c`.
func set_center(c: Vector2) -> void:
	position = c - size / 2.0


func set_enabled(on: bool) -> void:
	disabled = not on


func set_label(t: String) -> void:
	label = t


func _recolor() -> void:
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		add_theme_color_override(state, text_color)
	add_theme_color_override("font_disabled_color", Color(text_color, 0.55))
	add_theme_color_override("icon_disabled_color", Color(1, 1, 1, 0.55))


func _restyle() -> void:
	if not is_node_ready() and not Engine.is_editor_hint():
		return
	var c := color_name if color_name in COLOURS else "green"
	var up := "ui/btn_%s.png" % c
	var down := "ui/btn_%s_down.png" % c
	var normal := Sheets.stylebox(up, 12)
	_content(normal, 0)
	var hover := Sheets.stylebox(up, 12)
	hover.modulate_color = Color(1.12, 1.12, 1.12)
	_content(hover, 0)
	var pressed := Sheets.stylebox(down, 12)
	_content(pressed, DOWN_SHIFT)
	var disabled_sb := Sheets.stylebox(up, 12)
	disabled_sb.modulate_color = Color(0.62, 0.62, 0.62, 0.85)
	_content(disabled_sb, 0)
	add_theme_stylebox_override("normal", normal)
	add_theme_stylebox_override("hover", hover)
	add_theme_stylebox_override("pressed", pressed)
	add_theme_stylebox_override("hover_pressed", pressed)
	add_theme_stylebox_override("disabled", disabled_sb)
	add_theme_stylebox_override("focus", StyleBoxEmpty.new())


## The bottom margin holds the 4 px edge, so content is centred on the face.
func _content(sb: StyleBoxTexture, shift: int) -> void:
	sb.content_margin_left = 8
	sb.content_margin_right = 8
	sb.content_margin_top = 4 + shift
	sb.content_margin_bottom = 8 - shift


func _on_enter() -> void:
	if not disabled:
		_scale_to(1.03, 0.08)
		_sfx(&"ui_hover")


func _on_exit() -> void:
	_scale_to(1.0, 0.1)


func _on_down() -> void:
	if not disabled:
		_scale_to(0.97, 0.06)


func _on_up() -> void:
	if not disabled:
		_pop()
		_sfx(&"ui_click")


func _scale_to(s: float, t: float) -> void:
	if Engine.is_editor_hint() or not is_inside_tree():
		return
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_tw = create_tween()
	_tw.tween_property(self, "scale", Vector2.ONE * s, t).set_trans(Tween.TRANS_SINE)


func _pop() -> void:
	if Engine.is_editor_hint() or not is_inside_tree():
		return
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_tw = create_tween()
	_tw.tween_property(self, "scale", Vector2.ONE * 1.06, 0.06)
	_tw.tween_property(self, "scale", Vector2.ONE, 0.09)


func _sfx(sound: StringName) -> void:
	if Engine.is_editor_hint() or not is_inside_tree():
		return
	var sfx := get_node_or_null("/root/Sfx")
	if sfx != null:
		sfx.call("play", sound)
