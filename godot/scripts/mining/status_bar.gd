class_name StatusBar
extends RichTextLabel
## The status line at the bottom (Phaser statusText, 13 px, colour per
## message kind). KEEP leaves the colour as it was; ERROR shakes; SUCCESS
## flashes a green underline; every message slides up 6 px and fades in.
## set_link(hash) makes the text clickable -> Backend.open_explorer(hash)
## (called from the click callback, as the popup blocker requires).

const NEUTRAL_COLOR := Color("90a4ae")
const SUCCESS_COLOR := Color("a5d6a7")
const ERROR_COLOR := Color("ef9a9a")

@export var slide_px := 6.0
@export var slide_seconds := 0.2

var _color: Color = Color("90a4ae")
var _plain := ""
var _link := ""
var _base_pos := Vector2.ZERO
var _tw: Tween
var _underline: ColorRect


func _ready() -> void:
	bbcode_enabled = true
	scroll_active = false
	fit_content = false
	mouse_filter = Control.MOUSE_FILTER_PASS
	_base_pos = position
	meta_clicked.connect(_on_meta)
	_underline = ColorRect.new()
	_underline.name = "Underline"
	_underline.color = Color("a5d6a7", 0.0)
	_underline.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_underline.position = Vector2(0, size.y - 2)
	_underline.size = Vector2(size.x, 2)
	add_child(_underline)


func show_msg(msg: String, kind: int) -> void:
	_link = ""
	match kind:
		GameState.Kind.NEUTRAL:
			_color = NEUTRAL_COLOR
		GameState.Kind.SUCCESS:
			_color = SUCCESS_COLOR
		GameState.Kind.ERROR:
			_color = ERROR_COLOR
		_:
			pass   # KEEP: colour unchanged
	_plain = msg
	_refresh()
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		position = _base_pos
		modulate.a = 1.0
		return
	if _tw != null and _tw.is_valid():
		_tw.kill()
	_tw = create_tween()
	position = _base_pos + Vector2(0, slide_px)
	modulate.a = 0.0
	_tw.set_parallel(true)
	_tw.tween_property(self, "position", _base_pos, slide_seconds).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	_tw.tween_property(self, "modulate:a", 1.0, slide_seconds)
	if kind == GameState.Kind.ERROR and msg != "":
		var shake := create_tween()
		for k in 3:
			shake.tween_property(self, "position:x", _base_pos.x + (3.0 if k % 2 == 0 else -3.0), 0.04)
		shake.tween_property(self, "position:x", _base_pos.x, 0.04)
		Sfx.play(&"ui_error")
	elif kind == GameState.Kind.SUCCESS and msg != "":
		_underline.color.a = 0.8
		var ul := create_tween()
		ul.tween_property(_underline, "color:a", 0.0, 0.4)


## Makes the current text clickable (claim hash -> explorer).
func set_link(hash: String) -> void:
	_link = hash
	_refresh()


func _refresh() -> void:
	var body := _plain
	if _link != "":
		body = "[url=%s]%s[/url]" % [_link, _plain]
	text = "[color=#%s]%s[/color]" % [_color.to_html(false), body]


func _on_meta(meta: Variant) -> void:
	var h := str(meta)
	if h != "":
		Backend.open_explorer(h)
