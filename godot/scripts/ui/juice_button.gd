@tool
class_name JuiceButton
extends Button
## Chunky 3D pixel button (ui.ts makeButton): dark outline, bottom shadow
## edge, hover lightening, pressed "push down", plus scale juice on hover /
## press / release. The theme's JuiceButton variation gives Button empty
## StyleBoxes, so _draw() paints the body; the icon (nearest) and the label
## (linear) are child nodes so text stays smooth under fractional scaling.
## Fires `pressed` on release inside, like the Phaser button.

const BOLD: FontFile = preload("res://assets/fonts/DejaVuSansMono-Bold.ttf")
const OUTLINE := Color("0a0e18")

@export var color: Color = Color("2e7d32"):
	set(v):
		color = v
		queue_redraw()
@export var label: String = "Button":
	set(v):
		label = v
		_layout()
@export var icon_texture: Texture2D:
	set(v):
		icon_texture = v
		_layout()
@export var icon_scale: float = 0.6:
	set(v):
		icon_scale = v
		_layout()
@export var edge: int = 4
@export var font_size: int = 13:
	set(v):
		font_size = v
		_layout()
@export var text_color: Color = Color.WHITE:
	set(v):
		text_color = v
		_layout()

var _hover := false
var _down := false
var _tw: Tween
var _icon: TextureRect
var _lbl: Label


func _init() -> void:
	theme_type_variation = &"JuiceButton"
	text = ""
	focus_mode = Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func _ready() -> void:
	_icon = get_node_or_null("Icon") as TextureRect
	if _icon == null:
		_icon = TextureRect.new()
		_icon.name = "Icon"
		_icon.stretch_mode = TextureRect.STRETCH_SCALE
		_icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_icon.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_icon)
	_lbl = get_node_or_null("Text") as Label
	if _lbl == null:
		_lbl = Label.new()
		_lbl.name = "Text"
		_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		_lbl.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
		_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_lbl)
	pivot_offset = size / 2.0
	resized.connect(func() -> void:
		pivot_offset = size / 2.0
		_layout()
		queue_redraw())
	mouse_entered.connect(_on_enter)
	mouse_exited.connect(_on_exit)
	button_down.connect(_on_down)
	button_up.connect(_on_up)
	_layout()


## Places the button so its FACE is centred on `c` (Phaser makeButton(x, y)).
func set_center(c: Vector2) -> void:
	position = c - Vector2(size.x / 2.0, (size.y - edge) / 2.0)


func set_enabled(on: bool) -> void:
	disabled = not on
	_layout()
	queue_redraw()


func set_label(t: String) -> void:
	label = t


func _layout() -> void:
	if _icon == null or _lbl == null:
		return
	var w := size.x
	var h := size.y - edge
	var off := float(edge - 1) if (_down and not disabled) else 0.0
	var tsize: Vector2 = BOLD.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	var isz := Vector2.ZERO
	var iw := 0.0
	if icon_texture != null:
		isz = icon_texture.get_size() * icon_scale
		iw = isz.x + 6.0
	var x0 := (w - (iw + tsize.x)) / 2.0
	var cy := off + h / 2.0
	var alpha := 0.4 if disabled else 1.0
	_icon.visible = icon_texture != null
	if icon_texture != null:
		_icon.texture = icon_texture
		_icon.size = isz
		_icon.position = Vector2(x0, cy - isz.y / 2.0)
	_icon.modulate.a = alpha
	_lbl.text = label
	_lbl.add_theme_font_override("font", BOLD)
	_lbl.add_theme_font_size_override("font_size", font_size)
	_lbl.add_theme_color_override("font_color", text_color)
	_lbl.size = Vector2(tsize.x + 4.0, h)
	_lbl.position = Vector2(x0 + iw, off)
	_lbl.modulate.a = alpha


func _draw() -> void:
	var w := size.x
	var h := size.y - edge
	var c := color
	var alpha := 0.4 if disabled else 1.0
	var off := 0.0
	if _down and not disabled:
		c = UiDraw.shade(color, 0.9)
		off = float(edge - 1)
	elif _hover and not disabled:
		c = UiDraw.shade(color, 1.18)
	UiDraw.rounded(self, Rect2(-2, -2, w + 4, h + edge + 2), Color(OUTLINE, alpha), 10)
	UiDraw.rounded(self, Rect2(0, edge, w, h), Color(UiDraw.shade(color, 0.45), alpha), 8)   # bottom shadow edge
	UiDraw.rounded(self, Rect2(0, off, w, h), Color(c, alpha), 8)                             # face
	UiDraw.rounded(self, Rect2(3, off + 3, w - 6, 4), Color(1, 1, 1, 0.18 * alpha), 2)         # top highlight


func _on_enter() -> void:
	_hover = true
	queue_redraw()
	if not disabled:
		_scale_to(1.03, 0.08)
		_sfx(&"ui_hover")


func _on_exit() -> void:
	_hover = false
	_down = false
	_layout()
	queue_redraw()
	_scale_to(1.0, 0.1)


func _on_down() -> void:
	if disabled:
		return
	_down = true
	_layout()
	queue_redraw()
	_scale_to(0.97, 0.06)


func _on_up() -> void:
	_down = false
	_layout()
	queue_redraw()
	if not disabled:
		_pop()
		_sfx(&"ui_click")


func _scale_to(s: float, t: float) -> void:
	if Engine.is_editor_hint():
		return
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_tw = create_tween()
	_tw.tween_property(self, "scale", Vector2.ONE * s, t).set_trans(Tween.TRANS_SINE)


func _pop() -> void:
	if Engine.is_editor_hint():
		return
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_tw = create_tween()
	_tw.tween_property(self, "scale", Vector2.ONE * 1.06, 0.06)
	_tw.tween_property(self, "scale", Vector2.ONE, 0.09)


func _sfx(sound: StringName) -> void:
	# @tool script: resolve the autoload by path so the editor never needs it
	if Engine.is_editor_hint() or not is_inside_tree():
		return
	var sfx := get_node_or_null("/root/Sfx")
	if sfx != null:
		sfx.call("play", sound)
