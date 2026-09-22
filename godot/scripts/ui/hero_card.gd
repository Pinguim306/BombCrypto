class_name HeroCard
extends Control
## One roster card in the left column (144x82): gold portrait frame tinted by
## rarity, bust portrait, name, mode line with icon, stamina bar (+ghost) and
## label, house icon when sheltered. Updated in place via bind().

signal pressed(hero_id: String)

const BAR_W := 84.0
const WORK_COLOR := Color("a5d6a7")
const REST_COLOR := Color("90a4ae")
const STAMINA_HI := Color("66bb6a")
const STAMINA_MID := Color("ffca28")
const STAMINA_LO := Color("ef5350")
const FLOURISH := Color("fff3d6")

@export var bar_seconds := 0.35
@export var ghost_lag := 0.4

@onready var panel: NinePatchRect = $Panel
@onready var frame: TextureRect = $Frame
@onready var portrait: TextureRect = $Frame/Portrait
@onready var name_label: Label = $NameLabel
@onready var mode_icon: TextureRect = $ModeLine/ModeIcon
@onready var mode_label: Label = $ModeLine/ModeLabel
@onready var home_icon: TextureRect = $HomeIcon
@onready var bar_bg: ColorRect = $StaminaBg
@onready var stamina_ghost: ColorRect = $StaminaGhost
@onready var stamina_bar: ColorRect = $StaminaBar
@onready var stamina_label: Label = $StaminaLabel
@onready var exhaust_flash: ColorRect = $ExhaustFlash

var hero_id := ""
var card_index := 0
var hero: HeroModel = null
var _mode := ""
var _stamina := -1
var _rarity := -1
var _hover := false
var _bar_tw: Tween
var _ghost_tw: Tween
var _hover_tw: Tween
var _flash_tw: Tween
var _fade_tw: Tween
var _frame_tw: Tween

static var _pick_tex: Texture2D
static var _sleep_tex: Texture2D


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	Sheets.nine_patch(panel, "ui/panel_dark.png", 8)
	frame.texture = Sheets.texture("ui/portrait_frame.png")
	home_icon.texture = Sheets.texture("ui/icon_house.png")
	if _pick_tex == null:
		_pick_tex = Sheets.texture("ui/icon_pick.png")
		_sleep_tex = Sheets.texture("ui/icon_sleep.png")
	pivot_offset = size / 2.0
	mouse_entered.connect(_on_enter)
	mouse_exited.connect(_on_exit)


# ---------------------------------------------------------------- binding

## Renders a hero into this card. Stamina reaching 0 plays "exhausted".
func bind(h: HeroModel) -> void:
	var first := h.id != hero_id
	var prev_stamina := _stamina
	hero = h
	hero_id = h.id
	_mode = h.mode
	_stamina = h.stamina
	name_label.text = Fmt.hero_name(h)
	mode_label.text = Fmt.mode_label(h)
	mode_label.add_theme_color_override("font_color", WORK_COLOR if h.is_working() else REST_COLOR)
	mode_icon.texture = _pick_tex if h.is_working() else _sleep_tex
	home_icon.visible = h.is_housed()
	stamina_label.text = Fmt.stamina_line(h)
	if h.rarity != _rarity or first:
		_rarity = h.rarity
		portrait.texture = Sheets.texture("chars/portrait_%d.png" % clampi(h.rarity, 0, 5))
		frame.modulate = _rarity_color().lerp(Color.WHITE, 0.35)
	_set_stamina(h.stamina_ratio(), first)
	if not first and prev_stamina > 0 and h.stamina <= 0:
		play_exhausted()


func show_card() -> void:
	if _fade_tw != null and _fade_tw.is_valid():
		_fade_tw.kill()
	visible = true
	modulate.a = 1.0


func hide_card() -> void:
	if not visible:
		return
	hero_id = ""
	hero = null
	_mode = ""
	_stamina = -1
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		visible = false
		return
	if _fade_tw != null and _fade_tw.is_valid():
		_fade_tw.kill()
	_fade_tw = create_tween()
	_fade_tw.tween_property(self, "modulate:a", 0.0, 0.15)
	_fade_tw.tween_callback(func() -> void:
		visible = false
		modulate.a = 1.0)


func _rarity_color() -> Color:
	return Config.RARITY_COLORS[clampi(_rarity, 0, Config.RARITY_COLORS.size() - 1)]


func _set_stamina(ratio: float, snap: bool) -> void:
	var w := BAR_W * clampf(ratio, 0.0, 1.0)
	stamina_bar.color = STAMINA_HI if ratio > 0.5 else (STAMINA_MID if ratio > 0.2 else STAMINA_LO)
	if _bar_tw != null and _bar_tw.is_valid():
		_bar_tw.kill()
	if _ghost_tw != null and _ghost_tw.is_valid():
		_ghost_tw.kill()
	if snap or not Config.fx_enabled:
		stamina_bar.size.x = w
		stamina_ghost.size.x = w
		return
	_bar_tw = create_tween()
	_bar_tw.tween_property(stamina_bar, "size:x", w, bar_seconds).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	if w < stamina_ghost.size.x:
		_ghost_tw = create_tween()
		_ghost_tw.tween_interval(ghost_lag)
		_ghost_tw.tween_property(stamina_ghost, "size:x", w, bar_seconds).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	else:
		stamina_ghost.size.x = w


# ---------------------------------------------------------------- one-shots

func play_exhausted() -> void:
	Sfx.play(&"hero_exhausted")
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	if _flash_tw != null and _flash_tw.is_valid():
		_flash_tw.kill()
	exhaust_flash.color.a = 0.5
	_flash_tw = create_tween()
	_flash_tw.tween_property(exhaust_flash, "color:a", 0.0, 0.4)
	var base_x := position.x
	var shake := create_tween()
	for k in 3:
		shake.tween_property(self, "position:x", base_x + (3.0 if k % 2 == 0 else -3.0), 0.04)
	shake.tween_property(self, "position:x", base_x, 0.04)


## Mine-all: the frame flashes bright for 0.3 s (cards are staggered by HeroCards).
func play_flourish() -> void:
	if not Config.fx_enabled:
		return
	if _frame_tw != null and _frame_tw.is_valid():
		_frame_tw.kill()
	frame.modulate = FLOURISH
	_frame_tw = create_tween()
	_frame_tw.tween_property(frame, "modulate", _rarity_color().lerp(Color.WHITE, 0.35), 0.3).set_delay(0.1)


func _on_enter() -> void:
	_hover = true
	if hero_id == "":
		return
	_scale_to(1.03, 0.08)
	Sfx.play(&"ui_hover")


func _on_exit() -> void:
	_hover = false
	_scale_to(1.0, 0.1)


func _gui_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	if mb.button_index != MOUSE_BUTTON_LEFT:
		return
	if mb.pressed:
		if hero_id == "":
			return
		accept_event()
		_scale_to(0.97, 0.05)
		Sfx.play(&"ui_click")
		pressed.emit(hero_id)
	else:
		_scale_to(1.03 if _hover else 1.0, 0.1)


func _scale_to(s: float, t: float) -> void:
	if _hover_tw != null and _hover_tw.is_valid():
		_hover_tw.kill()
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	_hover_tw = create_tween()
	_hover_tw.tween_property(self, "scale", Vector2.ONE * s, t).set_trans(Tween.TRANS_SINE)
