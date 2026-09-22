class_name HeroPopup
extends Control
## Centred hero action card: animated portrait in a gold frame, stats plate,
## work/rest, shelter, adventure, close. Opens for a captured hero id,
## live-updates from every state (closes if the hero disappears) and closes
## after each awaited action.

const WORK_COLOR := Color("a5d6a7")
const REST_COLOR := Color("90a4ae")
const DIM_ALPHA := 0.55
const GLOW_ALPHA: Array[float] = [0.0, 0.0, 0.18, 0.35, 0.32, 0.4]

@export var open_seconds := 0.22
@export var close_seconds := 0.12
@export var slide_px := 24.0

@onready var dim: ColorRect = $Dim
@onready var card: NinePatchRect = $Card
@onready var ribbon: Ribbon = $Ribbon
@onready var portrait: Node2D = $Portrait
@onready var body: AnimatedSprite2D = $Portrait/Body
@onready var portrait_frame: Sprite2D = $Portrait/Frame
@onready var rarity_glow: Sprite2D = $Portrait/RarityGlow
@onready var stats_plate: NinePatchRect = $StatsPlate
@onready var stats: Label = $Stats
@onready var status_line: Label = $StatusLine
@onready var work_rest_btn: TexButton = $WorkRestBtn
@onready var shelter_btn: TexButton = $ShelterBtn
@onready var adventure_btn: TexButton = $AdventureBtn
@onready var close_btn: TexButton = $CloseBtn

var hero_id := ""
var is_open := false
var _gen := 0
var _bases: Dictionary = {}     # CanvasItem -> resting position
var _tw: Tween


func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	Sheets.nine_patch(card, "ui/panel_wood.png", 12)
	Sheets.nine_patch(stats_plate, "ui/panel_dark.png", 8)
	portrait_frame.texture = Sheets.texture("ui/frame_gold.png")
	shelter_btn.icon_texture = Sheets.texture("ui/icon_house.png")
	adventure_btn.icon_texture = Sheets.texture("ui/icon_adventure.png")
	close_btn.icon_texture = Sheets.texture("ui/icon_close.png")
	dim.gui_input.connect(_on_dim_input)
	work_rest_btn.pressed.connect(_on_work_rest)
	shelter_btn.pressed.connect(_on_shelter)
	adventure_btn.pressed.connect(_on_adventure)
	close_btn.pressed.connect(close)
	for n: CanvasItem in _content():
		_bases[n] = n.get("position")


func _content() -> Array:
	return [card, ribbon, portrait, stats_plate, stats, status_line, work_rest_btn, shelter_btn, adventure_btn, close_btn]


func open(id: String) -> void:
	var s: StateModel = GameState.state
	if s == null or s.hero(id) == null:
		return
	_gen += 1
	hero_id = id
	is_open = true
	rebind(s)
	_set_buttons(true)
	visible = true
	Sfx.play(&"popup_open")
	_kill()
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		_reset_positions()
		dim.color.a = DIM_ALPHA
		portrait.scale = Vector2.ONE
		modulate.a = 1.0
		return
	dim.color.a = 0.0
	modulate.a = 1.0
	for n: CanvasItem in _content():
		n.set("position", (_bases[n] as Vector2) + Vector2(0, slide_px))
		n.modulate.a = 0.0
	portrait.scale = Vector2.ONE * 0.9
	_tw = create_tween().set_parallel(true)
	_tw.tween_property(dim, "color:a", DIM_ALPHA, 0.15)
	for n: CanvasItem in _content():
		_tw.tween_property(n, "position", _bases[n], open_seconds).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		_tw.tween_property(n, "modulate:a", 1.0, open_seconds * 0.6)
	_tw.tween_property(portrait, "scale", Vector2.ONE, open_seconds).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## Live update from the latest state; closes when the hero is gone.
func rebind(s: StateModel) -> void:
	if not is_open or s == null:
		return
	var h: HeroModel = s.hero(hero_id)
	if h == null:
		close()
		return
	ribbon.text = "%s Hero" % Rules.rarity_name(h.rarity)
	var r := clampi(h.rarity, 0, 5)
	var sf := Sheets.frames("chars/hero_%d.png" % r)
	if body.sprite_frames != sf:
		body.sprite_frames = sf
	body.play(&"sleep" if not h.is_working() else &"idle")
	var rc: Color = Config.RARITY_COLORS[r]
	rarity_glow.modulate = Color(rc, 0.0 if Config.reduced_motion else GLOW_ALPHA[r])
	portrait_frame.modulate = rc.lerp(Color.WHITE, 0.35)
	stats.text = Fmt.hero_stats(h)
	status_line.text = Fmt.status_line(h)
	status_line.add_theme_color_override("font_color", WORK_COLOR if h.is_working() else REST_COLOR)
	work_rest_btn.set_label("Rest" if h.is_working() else "Work")
	work_rest_btn.color_name = "gray" if h.is_working() else "green"
	work_rest_btn.icon_texture = Sheets.texture("ui/icon_sleep.png" if h.is_working() else "ui/icon_pick.png")
	shelter_btn.set_label("Leave House" if h.is_housed() else "Shelter")


func close() -> void:
	if not is_open:
		return
	is_open = false
	_gen += 1
	var g := _gen
	Sfx.play(&"popup_close")
	_kill()
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		visible = false
		return
	_tw = create_tween().set_parallel(true)
	_tw.tween_property(dim, "color:a", 0.0, close_seconds)
	for n: CanvasItem in _content():
		_tw.tween_property(n, "position", (_bases[n] as Vector2) + Vector2(0, slide_px * 0.5), close_seconds).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
		_tw.tween_property(n, "modulate:a", 0.0, close_seconds)
	_tw.chain().tween_callback(func() -> void:
		if g == _gen:
			visible = false
			_reset_positions())


func _reset_positions() -> void:
	for n: CanvasItem in _content():
		n.set("position", _bases[n])
		n.modulate.a = 1.0


func _kill() -> void:
	if _tw != null and _tw.is_valid():
		_tw.kill()


func _set_buttons(on: bool) -> void:
	work_rest_btn.set_enabled(on)
	shelter_btn.set_enabled(on)
	adventure_btn.set_enabled(on)


func _on_dim_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and (event as InputEventMouseButton).pressed:
		accept_event()
		close()


# ---- actions: capture the id, await GameState, close if still this popup ----

func _on_work_rest() -> void:
	var id := hero_id
	var g := _gen
	var h: HeroModel = GameState.hero(id)
	if h == null:
		close()
		return
	_set_buttons(false)
	await GameState.set_hero_mode(id, "rest" if h.is_working() else "work")
	_after_action(g)


func _on_shelter() -> void:
	var id := hero_id
	var g := _gen
	_set_buttons(false)
	await GameState.toggle_house(id)
	_after_action(g)


func _on_adventure() -> void:
	var id := hero_id
	var g := _gen
	_set_buttons(false)
	await GameState.go_adventure(id, GameState.selected_stage)
	_after_action(g)


func _after_action(g: int) -> void:
	if not is_inside_tree() or g != _gen:
		return
	_set_buttons(true)
	close()
