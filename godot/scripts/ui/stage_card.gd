class_name StageCard
extends Button
## Adventure stage card in the EXPEDITION panel: dark inset plate, name +
## reward/stamina text, a gold frame when selected. Emits `selected` on
## press-down like the Phaser card.

signal selected(stage_id: int)

const SELECTED_TEXT := Color("ffb74d")
const NORMAL_TEXT := Color("cfd8dc")

var stage_id := -1
var is_selected := false

@onready var text_label: RichTextLabel = $Text
@onready var frame: NinePatchRect = $Frame


func _init() -> void:
	theme_type_variation = &"StageCard"
	text = ""
	focus_mode = Control.FOCUS_NONE
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func _ready() -> void:
	var normal := Sheets.stylebox("ui/panel_dark.png", 8)
	var hover := Sheets.stylebox("ui/panel_dark.png", 8)
	hover.modulate_color = Color(1.25, 1.25, 1.25)
	add_theme_stylebox_override("normal", normal)
	add_theme_stylebox_override("hover", hover)
	add_theme_stylebox_override("pressed", hover)
	add_theme_stylebox_override("hover_pressed", hover)
	add_theme_stylebox_override("disabled", normal)
	add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	Sheets.nine_patch(frame, "ui/frame_gold.png", 12)
	frame.visible = false
	pivot_offset = size / 2.0
	resized.connect(func() -> void: pivot_offset = size / 2.0)
	button_down.connect(func() -> void: selected.emit(stage_id))


func bind(s: StageModel, sel: bool) -> void:
	stage_id = s.id
	is_selected = sel
	text_label.text = Fmt.stage_card(s, sel)
	text_label.add_theme_color_override("default_color", SELECTED_TEXT if sel else NORMAL_TEXT)
	frame.visible = sel
