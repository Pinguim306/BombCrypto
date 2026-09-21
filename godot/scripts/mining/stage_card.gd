class_name StageCard
extends Button
## Adventure stage card (Phaser 162x40 text with #1c2333 background, "▶ "
## prefix + amber colour when selected). The theme's StageCard variation gives
## Button empty StyleBoxes, so _draw() paints the card; the text is a child
## RichTextLabel with the Phaser padding (8, 6).

signal selected(stage_id: int)

const BG := Color("1c2333")
const SELECTED_TEXT := Color("ffb74d")
const NORMAL_TEXT := Color("b0bec5")
const SELECTED_BORDER := Color("ffb74d", 0.6)

var stage_id := -1
var is_selected := false
var _hover := false

@onready var text_label: RichTextLabel = $Text


func _init() -> void:
	theme_type_variation = &"StageCard"
	text = ""
	focus_mode = Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func _ready() -> void:
	pivot_offset = size / 2.0
	resized.connect(func() -> void:
		pivot_offset = size / 2.0
		queue_redraw())
	mouse_entered.connect(func() -> void:
		_hover = true
		queue_redraw())
	mouse_exited.connect(func() -> void:
		_hover = false
		queue_redraw())
	button_down.connect(func() -> void: selected.emit(stage_id))   # Phaser: pointerdown


func bind(s: StageModel, sel: bool) -> void:
	stage_id = s.id
	is_selected = sel
	text_label.text = Fmt.stage_card(s, sel)
	text_label.add_theme_color_override("default_color", SELECTED_TEXT if sel else NORMAL_TEXT)
	queue_redraw()


func _draw() -> void:
	var bg := UiDraw.shade(BG, 1.12) if (_hover and not disabled) else BG
	draw_rect(Rect2(Vector2.ZERO, size), bg)
	if is_selected:
		draw_rect(Rect2(0.5, 0.5, size.x - 1.0, size.y - 1.0), SELECTED_BORDER, false, 1.0)
