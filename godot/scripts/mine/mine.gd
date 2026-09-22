class_name Mine
extends Node2D
## Mine screen controller: renders everything from GameState.state_applied
## (idempotent, in place), forwards clicks to the GameState actions, and
## layers the game feel on top (BombSim -> HeroActors -> Fx). The scene owns
## no game logic: reduced motion / --no-fx only remove the juice.
##
## Layout (960x540): wood top bar with the counters and Daily/Claim, roster
## cards + Mine-all on the left, the 12x8 tile map in the middle (heroes walk
## and throw, house bottom-right, campfire bottom-left), EXPEDITION + HOUSES
## panels on the right, status + info bar at the bottom.

const IDLE_TEXT := Color("90a4ae")
const VALUE_TEXT := Color("ffca28")
const RATE_RISE := Color("b3e5fc")
const PENDING_JUMP := 0.05        # BLAST: server ahead of the display by more than this -> punch
const AMBIENT := Color(0.7, 0.73, 0.88)
const DECOR: Array = []                  # [file, tile, dx, dy] — extra dressing; map_bg already bakes rocks/crystals

@export var pending_ease_seconds := 0.6
@export var predict_tick_seconds := 0.25

@onready var world: Node2D = $World
@onready var camera: Camera2D = $World/Camera
@onready var ambient: CanvasModulate = $World/Ambient
@onready var wall_band: Sprite2D = $World/Map/WallBand
@onready var floor_sprite: Sprite2D = $World/Map/Floor
@onready var decor: Node2D = $World/Map/Decor
@onready var house: Sprite2D = $World/Map/Actors/Props/House
@onready var chimney: CPUParticles2D = $World/Map/Actors/Props/House/Chimney
@onready var campfire: AnimatedSprite2D = $World/Map/Actors/Props/Campfire
@onready var sign_post: Sprite2D = $World/Map/Actors/Props/Sign
@onready var field: BlockField = $World/Map/Actors/Blocks
@onready var heroes: HeroActors = $World/Map/Actors/Heroes
@onready var torches: Node2D = $World/Map/Lights/Torches
@onready var camp_light: PointLight2D = $World/Map/Lights/CampLight
@onready var house_light: PointLight2D = $World/Map/Lights/HouseLight
@onready var vein_light: PointLight2D = $World/Map/Lights/VeinLight
@onready var flash_lights: Node2D = $World/Map/Lights/FlashLights
@onready var bombs: Node2D = $World/Bombs
@onready var fx: Fx = $World/Fx
@onready var hud_root: Control = $Hud/Root
@onready var top_bar: NinePatchRect = $Hud/Root/TopBar
@onready var logo: TextureRect = $Hud/Root/Logo
@onready var pending_plate: CounterPlate = $Hud/Root/PendingPlate
@onready var rate_plate: CounterPlate = $Hud/Root/RatePlate
@onready var daily_button: TexButton = $Hud/Root/DailyButton
@onready var daily_badge: Node2D = $Hud/Root/DailyBadge
@onready var daily_anim: AnimationPlayer = $Hud/Root/DailyBadge/Anim
@onready var claim_button: TexButton = $Hud/Root/ClaimButton
@onready var cards: HeroCards = $Hud/Root/Cards
@onready var mine_all_button: TexButton = $Hud/Root/MineAllButton
@onready var expedition_panel: NinePatchRect = $Hud/Root/ExpeditionPanel
@onready var expedition_ribbon: Ribbon = $Hud/Root/ExpeditionRibbon
@onready var stages: Control = $Hud/Root/Stages
@onready var houses_panel: NinePatchRect = $Hud/Root/HousesPanel
@onready var houses_ribbon: Ribbon = $Hud/Root/HousesRibbon
@onready var houses_text: RichTextLabel = $Hud/Root/HousesText
@onready var bottom_bar: NinePatchRect = $Hud/Root/BottomBar
@onready var status_bar: StatusBar = $Hud/Root/StatusText
@onready var info_line: Label = $Hud/Root/InfoLine
@onready var fx_overlay: Node2D = $Hud/Root/FxOverlay
@onready var popup: HeroPopup = $PopupLayer/Popup

var _gen := 0
var _bomb_sim := BombSim.new()
var _stage_cards: Array[StageCard] = []
var _rendered := false
var _can_claim := false
var _flourish_armed := false
var _pending_min := 0
var _pending_shown := 0.0
var _pending_server := 0.0   # last server truth (jump detection ignores the prediction)
var _pending_tw: Tween
var _predict_acc := 0.0
var _rate_shown := 0.0
var _rate_tw: Tween
var _flicker_t := 0.0


func _ready() -> void:
	add_to_group("mining")
	Juice.register_camera(camera)
	Juice.register_flash_pool(flash_lights)
	_dress_map()
	_dress_hud()
	claim_button.pressed.connect(_on_claim)
	daily_button.pressed.connect(_on_daily)
	mine_all_button.pressed.connect(_on_mine_all)
	claim_button.set_label("Locked")
	claim_button.set_enabled(false)
	pending_plate.set_text("loading...")
	pending_plate.set_sub("")
	rate_plate.set_text("...")
	for i in 3:
		var card: StageCard = stages.get_node("Stage%d" % i)
		card.selected.connect(_on_stage_selected)
		card.visible = false
		_stage_cards.append(card)
	cards.hero_pressed.connect(open_popup)
	heroes.setup(field)
	fx.setup(field, heroes, bombs, fx_overlay, pending_plate.value_label, vein_light)
	_bomb_sim.bomb_thrown.connect(fx.on_bomb_thrown)
	_build_badge_anim()
	apply_config()
	GameState.state_applied.connect(_render)
	GameState.status.connect(_on_status)
	GameState.busy_changed.connect(_set_buttons)
	GameState.daily_badge_changed.connect(_on_badge)
	GameState.claim_progress.connect(_on_claim_progress)
	GameState.phase_changed.connect(_on_phase)
	if GameState.daily_can_claim:
		_on_badge(true)
	if GameState.state != null:
		_render(GameState.state, StateDiff.initial(GameState.state))


func _exit_tree() -> void:
	_gen += 1
	_kill(_pending_tw)
	_kill(_rate_tw)
	fx.set_active(false)


func _process(delta: float) -> void:
	if not Config.fx_enabled or not fx.active or GameState.state == null:
		return
	_bomb_sim.tick(delta)
	_predict_acc += delta
	if _predict_acc >= predict_tick_seconds:
		_predict_acc = 0.0
		_ease_pending(GameState.predicted_pending(), predict_tick_seconds * 1.2)
	# torch / campfire flicker
	if Config.fancy_lights and Config.juice_scale() > 0.0:
		_flicker_t += delta
		var f := 0.85 + 0.15 * sin(_flicker_t * 9.0) * sin(_flicker_t * 3.7 + 1.0)
		for t in torches.get_children():
			var l := t.get_node_or_null("Light") as PointLight2D
			if l != null:
				l.energy = 0.9 * f
		camp_light.energy = 1.1 * (0.8 + 0.2 * sin(_flicker_t * 7.3 + 0.5) * sin(_flicker_t * 2.9))


# ---------------------------------------------------------------- dressing

## Static art: wall band, baked floor, house, campfire, sign, torches, decor.
func _dress_map() -> void:
	wall_band.texture = Sheets.texture("env/wall_band.png")
	wall_band.position = Layout.MAP_ORIGIN - Vector2(0, Sheets.frame_size("env/wall_band.png").y)
	floor_sprite.texture = Sheets.texture("env/map_bg.png")
	floor_sprite.position = Layout.MAP_ORIGIN
	# house: bottom-right 2x2 tiles, node at the bottom edge for y-sorting
	var house_tex := Sheets.texture("env/house.png")
	house.texture = house_tex
	var house_bottom := Layout.tile_origin(Vector2i(10, 7)) + Vector2(Layout.TILE, Layout.TILE)
	house.position = house_bottom
	house.offset = Vector2(-Layout.TILE, -house_tex.get_height())
	var chim: Variant = Sheets.extra("env/house.png", "chimney", [80, 6])
	chimney.position = house.offset + Vector2(float(chim[0]), float(chim[1]))
	chimney.texture = Sheets.texture("chars/smoke_puff.png")
	var win: Variant = Sheets.extra("env/house.png", "window", [30, 50])
	house_light.position = house_bottom + house.offset + Vector2(float(win[0]), float(win[1]))
	# campfire + sign
	campfire.sprite_frames = Sheets.frames("chars/campfire.png", 8.0)
	campfire.position = Layout.tile_origin(Layout.CAMPFIRE_TILE) + Vector2(24, 44)
	campfire.offset = Vector2(0, -16)
	campfire.play(&"default")
	camp_light.position = campfire.position + Vector2(0, -14)
	sign_post.texture = Sheets.texture("env/sign.png")
	sign_post.position = Layout.tile_origin(Layout.SIGN_TILE) + Vector2(24, 44)
	sign_post.offset = Vector2(0, -14)
	# torches on the wall band, above the map's top corners
	var torch_frames := Sheets.frames("chars/torch.png", 8.0)
	var xs := [Layout.MAP_ORIGIN.x + 60.0, Layout.MAP_ORIGIN.x + Layout.MAP_SIZE.x - 60.0]
	for i in torches.get_child_count():
		var t := torches.get_child(i) as Node2D
		var spr := t.get_node("Sprite") as AnimatedSprite2D
		spr.sprite_frames = torch_frames
		spr.play(&"default")
		spr.frame = i * 2
		t.position = Vector2(xs[mini(i, xs.size() - 1)], Layout.MAP_ORIGIN.y - 2.0)
	vein_light.position = Layout.tile_origin(Vector2i(6, 3)) + Vector2(0, 24)
	# margin decor (sprites drawn above the floor, below the actors)
	for d: Array in DECOR:
		var s := Sprite2D.new()
		s.texture = Sheets.texture(str(d[0]))
		s.position = Layout.tile_origin(d[1]) + Vector2(float(d[2]), float(d[3]))
		decor.add_child(s)


func _dress_hud() -> void:
	Sheets.nine_patch(top_bar, "ui/panel_wood.png", 12)
	Sheets.nine_patch(expedition_panel, "ui/panel_wood.png", 12)
	Sheets.nine_patch(houses_panel, "ui/panel_wood.png", 12)
	Sheets.nine_patch(bottom_bar, "ui/panel_wood.png", 12)
	logo.texture = Sheets.texture("ui/logo_small.png")
	daily_button.icon_texture = Sheets.texture("ui/icon_gift.png")
	claim_button.icon_texture = Sheets.texture("ui/icon_coin.png")
	mine_all_button.icon_texture = Sheets.texture("ui/icon_pick.png")
	($Hud/Root/DailyBadge/Badge as Sprite2D).texture = Sheets.texture("ui/badge.png")
	expedition_ribbon.text = "EXPEDITION"
	houses_ribbon.text = "HOUSES"


## Config flags changed (DebugPanel / host): lights, FX layer.
func apply_config() -> void:
	var lights := Config.fancy_lights and Config.fx_enabled
	ambient.color = AMBIENT if lights else Color.WHITE
	for t in torches.get_children():
		var l := t.get_node_or_null("Light") as PointLight2D
		if l != null:
			l.enabled = lights
	camp_light.enabled = lights
	house_light.enabled = lights
	vein_light.enabled = lights
	for light in flash_lights.get_children():
		if light is PointLight2D:
			(light as PointLight2D).enabled = lights
	for c in decor.get_children():
		var l := c.get_node_or_null("Light") as PointLight2D
		if l != null:
			l.enabled = lights
	chimney.emitting = Config.fx_enabled and not Config.reduced_motion
	field.apply_config()
	heroes.apply_config()
	var hidden := GameState.phase in [GameState.Phase.HIDDEN, GameState.Phase.OFFLINE]
	fx.set_active(Config.fx_enabled and not hidden)
	if GameState.state != null and fx.active:
		_bomb_sim.on_state(GameState.state, StateDiff.initial(GameState.state))


# ---------------------------------------------------------------- render

## Idempotent and total: every widget is set from the state, then the diff
## drives the feel (BombSim snap, actors, Fx big moments, flourishes).
func _render(s: StateModel, d: StateDiff) -> void:
	var first := not _rendered or d.first
	var animate := _rendered and Config.fx_enabled
	_render_pending(s, first)
	_render_rate(s, first)
	_render_claim(s, first)
	field.set_state(s.blocks, animate)
	houses_text.text = Fmt.houses_text(s.houses)
	_render_stages(s)
	info_line.text = Fmt.info_line(s.attempts_today, s.min_blast, s.cooldown_hours)
	cards.set_heroes(s.heroes)
	heroes.sync(s, d)
	popup.rebind(s)
	_bomb_sim.on_state(s, d)
	fx.on_diff(d, s)
	if _flourish_armed and not GameState.busy:
		_flourish_armed = false
		var ids: Array[String] = []
		for id: String in d.hero_mode_changed:
			var h: HeroModel = s.hero(id)
			if h != null and h.is_working():
				ids.append(id)
		if not ids.is_empty():
			cards.play_mine_all_flourish(ids)
			heroes.play_hop(ids)
	if not _rendered:
		_rendered = true
		_play_enter_animation()


func _fmt_pending(v: float) -> String:
	return Fmt.blast2(v) + " BLAST"


func _render_pending(s: StateModel, first: bool) -> void:
	_pending_min = s.min_blast
	pending_plate.set_sub("min %s to claim" % Fmt.thousands(s.min_blast))
	var label: CounterLabel = pending_plate.value_label
	if first or not Config.fx_enabled:
		_kill(_pending_tw)
		_pending_shown = s.pending
		_pending_server = s.pending
		label.value = s.pending
		label.text = _fmt_pending(s.pending)
		return
	var jump := s.pending - _pending_server
	_pending_server = s.pending
	_ease_pending(s.pending, pending_ease_seconds)
	if jump > PENDING_JUMP:
		Juice.punch_scale(label, 0.12, 0.25)
		label.flash(Color("fff9c4"))
		Sfx.play(&"coin")
	elif jump < -PENDING_JUMP:
		label.flash(Color("ef9a9a"))   # claim debit


## Eases the pending counter toward a value (server truth or prediction).
func _ease_pending(target: float, seconds: float) -> void:
	var label: CounterLabel = pending_plate.value_label
	label.value = target
	if not Config.fx_enabled:
		_pending_shown = target
		label.text = _fmt_pending(target)
		return
	if absf(target - _pending_shown) < 0.0005:
		return
	_kill(_pending_tw)
	_pending_tw = create_tween()
	_pending_tw.tween_method(_set_pending_shown, _pending_shown, target, seconds) \
		.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


func _set_pending_shown(v: float) -> void:
	_pending_shown = v
	pending_plate.value_label.text = _fmt_pending(v)


func _render_rate(s: StateModel, first: bool) -> void:
	var rate := Rules.team_rate(s.heroes)
	var label: CounterLabel = rate_plate.value_label
	label.add_theme_color_override("font_color", VALUE_TEXT if rate > 0.0 else IDLE_TEXT)
	rate_plate.set_sub("team rate" if rate > 0.0 else "team idle")
	if first or not Config.fx_enabled or absf(rate - _rate_shown) < 0.5:
		_kill(_rate_tw)
		_rate_shown = rate
		label.text = Fmt.rate_pill(rate)
		return
	if rate > _rate_shown:
		label.flash(RATE_RISE)
	_kill(_rate_tw)
	_rate_tw = Juice.count_to(label, _rate_shown, rate, 0.5, func(v: float) -> String: return Fmt.rate_pill(v))
	_rate_shown = rate


func _render_claim(s: StateModel, first: bool) -> void:
	var can := Rules.can_claim(s.pending, s.min_blast)
	claim_button.set_label("Claim" if can else "Locked")
	claim_button.icon_texture = Sheets.texture("ui/icon_coin.png" if can else "ui/icon_lock.png")
	claim_button.set_enabled(can and not GameState.busy)
	if can and not _can_claim and not first and Config.fx_enabled:
		Juice.punch_scale(claim_button, 0.12, 0.25)
	_can_claim = can


func _render_stages(s: StateModel) -> void:
	for i in _stage_cards.size():
		var card := _stage_cards[i]
		if i < s.stages.size():
			card.visible = true
			card.bind(s.stages[i], s.stages[i].id == GameState.selected_stage)
		else:
			card.visible = false


# ---------------------------------------------------------------- input / actions

## Clicking a hero on the map opens its card.
func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton):
		return
	var mb := event as InputEventMouseButton
	if not mb.pressed or mb.button_index != MOUSE_BUTTON_LEFT or popup.is_open:
		return
	var a := heroes.actor_at(world.get_local_mouse_position())
	if a != null and a.hero_id != "":
		get_viewport().set_input_as_handled()
		Sfx.play(&"ui_click")
		open_popup(a.hero_id)


func open_popup(hero_id: String) -> void:
	popup.open(hero_id)


func _on_mine_all() -> void:
	GameState.mine_all()


func _on_claim() -> void:
	GameState.claim()


func _on_daily() -> void:
	Sfx.play(&"ui_click")
	Backend.nav("daily")


func _on_stage_selected(id: int) -> void:
	GameState.select_stage(id)
	Sfx.play(&"ui_click")
	if GameState.state != null:
		_render_stages(GameState.state)
	if Config.fx_enabled:
		for card in _stage_cards:
			if card.visible and card.stage_id == id:
				Juice.punch_scale(card, 0.05, 0.18)


# ---------------------------------------------------------------- GameState signals

func _on_status(msg: String, kind: int) -> void:
	status_bar.show_msg(msg, kind)
	if msg.begins_with("claim sent:") and GameState.last_claim_hash != "":
		status_bar.set_link(GameState.last_claim_hash)


func _set_buttons(busy: bool, action: String) -> void:
	mine_all_button.set_enabled(not busy)
	claim_button.set_enabled(_can_claim and not busy)
	if busy and action == "mine_all":
		_flourish_armed = true


func _on_badge(can: bool) -> void:
	daily_badge.visible = can
	if can and Config.fx_enabled and Config.juice_scale() > 0.0:
		daily_anim.play(&"pulse")
	else:
		daily_anim.stop()
		daily_badge.scale = Vector2.ONE


func _on_claim_progress(step: String) -> void:
	if step == "sent" and Config.fx_enabled:
		Juice.punch_scale(claim_button, 0.12, 0.25)


func _on_phase(p: int, _prev: int) -> void:
	match p:
		GameState.Phase.HIDDEN, GameState.Phase.OFFLINE:
			fx.set_active(false)
			_bomb_sim.reset()
		GameState.Phase.LIVE, GameState.Phase.DEGRADED, GameState.Phase.LOADING:
			if not fx.active and Config.fx_enabled:
				fx.set_active(true)
		_:
			pass


# ---------------------------------------------------------------- feel

## Panels fade + slide 12 px with a 60 ms stagger, ribbons drop in with a
## bounce, blocks pop in 15 ms apart, counters count up from 0.
func _play_enter_animation() -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	var items: Array = [top_bar, logo, pending_plate, rate_plate, daily_button, claim_button,
		cards, mine_all_button, expedition_panel, stages, houses_panel, houses_text, bottom_bar, status_bar, info_line]
	for i in items.size():
		var n: Control = items[i]
		var base: Vector2 = n.position
		n.position = base + Vector2(0, 12)
		n.modulate.a = 0.0
		var tw := create_tween().set_parallel(true)
		tw.tween_property(n, "position", base, 0.25).set_delay(i * 0.04).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.tween_property(n, "modulate:a", 1.0, 0.25).set_delay(i * 0.04)
	for r: Ribbon in [expedition_ribbon, houses_ribbon]:
		var ry := r.position.y
		r.position.y = ry - 30.0
		r.modulate.a = 0.0
		var rtw := create_tween().set_parallel(true)
		rtw.tween_property(r, "position:y", ry, 0.45).set_delay(0.2).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
		rtw.tween_property(r, "modulate:a", 1.0, 0.2).set_delay(0.2)
	field.play_spawn_all(0.015)
	if GameState.state != null:
		var s: StateModel = GameState.state
		_pending_shown = 0.0
		_ease_pending(s.pending, 0.8)
		var rate := Rules.team_rate(s.heroes)
		if rate > 0.0:
			_kill(_rate_tw)
			_rate_tw = Juice.count_to(rate_plate.value_label, 0.0, rate, 0.8, func(v: float) -> String: return Fmt.rate_pill(v))


func _build_badge_anim() -> void:
	var lib := AnimationLibrary.new()
	var pulse := Animation.new()
	pulse.length = 0.6
	pulse.loop_mode = Animation.LOOP_PINGPONG
	var t := pulse.add_track(Animation.TYPE_VALUE)
	pulse.track_set_path(t, NodePath(".:scale"))
	pulse.track_insert_key(t, 0.0, Vector2.ONE)
	pulse.track_insert_key(t, 0.6, Vector2(1.25, 1.25))
	lib.add_animation(&"pulse", pulse)
	daily_anim.add_animation_library(&"", lib)


func _kill(tw: Tween) -> void:
	if tw != null and tw.is_valid():
		tw.kill()
