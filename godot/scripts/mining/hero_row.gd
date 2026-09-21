class_name HeroRow
extends Control
## One hero list row (Phaser container at (38, 128 + i*74), 190x60): rarity
## frame, portrait with lamp/rarity glow, swinging pick, name, mode line,
## stamina bar (+ghost) and label. Updated in place via bind(); the "work" and
## "rest" loops live in the AnimationPlayer (built in code), the one-shots
## (hover / press / exhausted / throw / flourish) are tweens on other
## properties so they never interrupt the loop.

signal pressed(hero_id: String)

const HERO_TEX: Array[Texture2D] = [
	preload("res://assets/sprites/hero_0.png"), preload("res://assets/sprites/hero_1.png"),
	preload("res://assets/sprites/hero_2.png"), preload("res://assets/sprites/hero_3.png"),
	preload("res://assets/sprites/hero_4.png"), preload("res://assets/sprites/hero_5.png"),
]
const PICK_TEX: Texture2D = preload("res://assets/sprites/pick.png")
const ZZZ_TEX: Texture2D = preload("res://assets/fx/zzz.png")
const BAR_W := 124.0
const FRAME_BG := Color("101624")
const WORK_COLOR := Color("a5d6a7")
const REST_COLOR := Color("90a4ae")
const FLOURISH_COLOR := Color("a5d6a7")
const PORTRAIT_POS := Vector2(0, -4)
const PORTRAIT_CENTER := Vector2(27, 27)
const BODY_SCALE := Vector2(0.85, 0.85)
# rarity glow alpha / pulse per §6.7: [base, amplitude, period]
const GLOW: Array = [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.18, 0.0, 0.0], [0.35, 0.10, 2.0], [0.32, 0.08, 1.4], [0.40, 0.10, 0.9]]

@export var bar_seconds := 0.35
@export var ghost_lag := 0.4
@export var hover_scale := 1.05
@export var press_scale := 0.96

@onready var frame: Panel = $Frame
@onready var rarity_glow: Sprite2D = $RarityGlow
@onready var portrait: Node2D = $Portrait
@onready var body: Sprite2D = $Portrait/Body
@onready var lamp_glow: Sprite2D = $Portrait/LampGlow
@onready var pick: Sprite2D = $Pick
@onready var house_icon: Sprite2D = $HouseIcon
@onready var name_label: Label = $NameLabel
@onready var mode_icon: TextureRect = $ModeLine/ModeIcon
@onready var mode_label: Label = $ModeLine/ModeLabel
@onready var home_icon: TextureRect = $ModeLine/HomeIcon
@onready var stamina_ghost: ColorRect = $StaminaGhost
@onready var stamina_bar: ColorRect = $StaminaBar
@onready var stamina_label: Label = $StaminaLabel
@onready var exhaust_flash: ColorRect = $ExhaustFlash
@onready var anim: AnimationPlayer = $Anim

var hero_id := ""
var row_index := 0
var hero: HeroModel = null
var _mode := ""
var _stamina := -1
var _rarity := -1
var _hover := false
var _frame_sb: StyleBoxFlat
var _glow_tw: Tween
var _bar_tw: Tween
var _ghost_tw: Tween
var _hover_tw: Tween
var _frame_tw: Tween
var _flash_tw: Tween
var _throw_tw: Tween
var _fade_tw: Tween


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_frame_sb = StyleBoxFlat.new()
	_frame_sb.bg_color = FRAME_BG
	_frame_sb.set_border_width_all(2)
	_frame_sb.border_color = Config.RARITY_COLORS[0]
	frame.add_theme_stylebox_override("panel", _frame_sb)
	_build_animations()
	mouse_entered.connect(_on_enter)
	mouse_exited.connect(_on_exit)


# ---------------------------------------------------------------- binding

## Renders a hero into this row. A new hero id restarts the loop without a
## blend; a mode change cross-blends; stamina reaching 0 plays "exhausted".
func bind(h: HeroModel) -> void:
	var first := h.id != hero_id
	var prev_mode := _mode
	var prev_stamina := _stamina
	hero = h
	hero_id = h.id
	_mode = h.mode
	_stamina = h.stamina
	name_label.text = Fmt.hero_name(h)
	mode_label.text = Fmt.mode_label(h)
	mode_label.add_theme_color_override("font_color", WORK_COLOR if h.is_working() else REST_COLOR)
	mode_icon.texture = PICK_TEX if h.is_working() else ZZZ_TEX
	home_icon.visible = h.is_housed()
	house_icon.visible = h.is_housed()
	stamina_label.text = Fmt.stamina_line(h)
	if h.rarity != _rarity or first:
		_rarity = h.rarity
		body.texture = HERO_TEX[clampi(h.rarity, 0, HERO_TEX.size() - 1)]
		_frame_sb.border_color = _rarity_color()
		_frame_sb.set_border_width_all(3 if h.rarity >= 4 else 2)
		_set_glow(h.rarity)
	_set_stamina(h.stamina_ratio(), first)
	if first or prev_mode != h.mode:
		if first or not Config.fx_enabled:
			anim.play(&"work" if h.is_working() else &"rest")
		else:
			anim.play(&"work" if h.is_working() else &"rest", 0.2)
	if not first and prev_stamina > 0 and h.stamina <= 0:
		play_exhausted()


func show_row() -> void:
	if _fade_tw != null and _fade_tw.is_valid():
		_fade_tw.kill()
	visible = true
	modulate.a = 1.0


func hide_row() -> void:
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


## Where this row's bombs start (design: world (65, 152 + row*74)).
func throw_origin() -> Vector2:
	return global_position + Vector2(27, 24)


func _rarity_color() -> Color:
	return Config.RARITY_COLORS[clampi(_rarity, 0, Config.RARITY_COLORS.size() - 1)]


func _set_stamina(ratio: float, snap: bool) -> void:
	var w := BAR_W * clampf(ratio, 0.0, 1.0)
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


func _set_glow(r: int) -> void:
	if _glow_tw != null and _glow_tw.is_valid():
		_glow_tw.kill()
	var c := _rarity_color()
	var spec: Array = GLOW[clampi(r, 0, GLOW.size() - 1)]
	var base: float = spec[0]
	var amp: float = spec[1]
	var period: float = spec[2]
	if Config.reduced_motion:
		rarity_glow.modulate = Color(c, 0.0)
		return
	rarity_glow.modulate = Color(c, base)
	if amp <= 0.0 or period <= 0.0 or not Config.fx_enabled:
		return
	_glow_tw = create_tween().set_loops()
	_glow_tw.tween_property(rarity_glow, "modulate:a", base + amp, period * 0.5).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_glow_tw.tween_property(rarity_glow, "modulate:a", base - amp, period * 0.5).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


# ---------------------------------------------------------------- one-shots

func play_throw() -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	if _throw_tw != null and _throw_tw.is_valid():
		_throw_tw.kill()
	_throw_tw = create_tween()
	_throw_tw.tween_property(body, "scale", BODY_SCALE * Vector2(1.1, 0.9), 0.08).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_throw_tw.tween_property(body, "scale", BODY_SCALE, 0.1).set_trans(Tween.TRANS_SINE)


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


## Mine-all: frame flash #a5d6a7 for 0.3 s (rows are staggered by HeroList).
func play_flourish() -> void:
	if not Config.fx_enabled:
		return
	if _frame_tw != null and _frame_tw.is_valid():
		_frame_tw.kill()
	_frame_sb.border_color = FLOURISH_COLOR
	_frame_tw = create_tween()
	_frame_tw.tween_property(_frame_sb, "border_color", _rarity_color(), 0.3).set_delay(0.1)


func _on_enter() -> void:
	_hover = true
	if hero_id == "":
		return
	_portrait_scale_to(hover_scale, 0.08)
	_frame_to(_rarity_color().lerp(Color.WHITE, 0.45), 0.08)
	Sfx.play(&"ui_hover")


func _on_exit() -> void:
	_hover = false
	_portrait_scale_to(1.0, 0.1)
	_frame_to(_rarity_color(), 0.1)


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
		_portrait_scale_to(press_scale, 0.05)
		Sfx.play(&"ui_click")
		pressed.emit(hero_id)   # Phaser opens the popup on pointerdown
	else:
		_portrait_scale_to(hover_scale if _hover else 1.0, 0.1)


func _portrait_scale_to(s: float, t: float) -> void:
	if _hover_tw != null and _hover_tw.is_valid():
		_hover_tw.kill()
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	_hover_tw = create_tween()
	_hover_tw.tween_method(func(v: float) -> void:
		portrait.scale = Vector2(v, v)
		portrait.position = PORTRAIT_POS - PORTRAIT_CENTER * (v - 1.0), portrait.scale.x, s, t) \
		.set_trans(Tween.TRANS_SINE)


func _frame_to(c: Color, t: float) -> void:
	if _frame_tw != null and _frame_tw.is_valid():
		_frame_tw.kill()
	if not Config.fx_enabled:
		_frame_sb.border_color = c
		return
	_frame_tw = create_tween()
	_frame_tw.tween_property(_frame_sb, "border_color", c, t)


# ---------------------------------------------------------------- animations

func _build_animations() -> void:
	var lib := AnimationLibrary.new()
	# "work": Phaser bob (body y -4 -> 0) + pick swing (-35 -> 30) + lamp breathing
	var work := Animation.new()
	work.length = 0.84
	work.loop_mode = Animation.LOOP_LINEAR
	_track(work, "Portrait/Body:position:y", [[0.0, 0.0], [0.42, 4.0], [0.84, 0.0]])
	_track(work, "Pick:rotation_degrees", [[0.0, -35.0], [0.42, 30.0], [0.84, -35.0]])
	_track(work, "Pick:modulate:a", [[0.0, 1.0]])
	_track(work, "Portrait/LampGlow:scale", [[0.0, Vector2(0.42, 0.42)], [0.42, Vector2(0.5, 0.5)], [0.84, Vector2(0.42, 0.42)]])
	_track(work, "Portrait/LampGlow:modulate:a", [[0.0, 0.55]])
	lib.add_animation(&"work", work)
	# "rest": pick parked at 15° and dimmed, lamp low
	var rest := Animation.new()
	rest.length = 0.3
	_track(rest, "Portrait/Body:position:y", [[0.0, 0.0]])
	_track(rest, "Pick:rotation_degrees", [[0.0, 15.0]])
	_track(rest, "Pick:modulate:a", [[0.0, 0.55]])
	_track(rest, "Portrait/LampGlow:scale", [[0.0, Vector2(0.45, 0.45)]])
	_track(rest, "Portrait/LampGlow:modulate:a", [[0.0, 0.25]])
	lib.add_animation(&"rest", rest)
	anim.add_animation_library(&"", lib)


func _track(a: Animation, path: String, keys: Array) -> void:
	var t := a.add_track(Animation.TYPE_VALUE)
	a.track_set_path(t, NodePath(path))
	a.track_set_interpolation_type(t, Animation.INTERPOLATION_CUBIC if keys.size() > 2 else Animation.INTERPOLATION_LINEAR)
	for k: Array in keys:
		a.track_insert_key(t, float(k[0]), k[1])
