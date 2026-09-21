class_name Mining
extends Node2D
## Mining screen controller (design §3/§4): renders everything from
## GameState.state_applied (idempotent, in place), forwards clicks to the
## GameState actions, and layers the game feel on top (BombSim -> Fx). The
## scene owns no game logic: reduced motion / --no-fx only remove the juice.

const IDLE_TEXT := Color("90a4ae")
const VALUE_TEXT := Color("ffca28")
const RATE_RISE := Color("b3e5fc")
const PENDING_JUMP := 0.05        # BLAST: server ahead of the display by more than this -> punch

@export var pending_ease_seconds := 0.6
@export var predict_tick_seconds := 0.25

@onready var world: Node2D = $World
@onready var camera: Camera2D = $World/Camera
@onready var cave_glow: PointLight2D = $World/CaveGlow
@onready var grid: BlockGrid = $World/Grid
@onready var flash_lights: Node2D = $World/FlashLights
@onready var fx: Fx = $World/Fx
@onready var hud_root: Control = $Hud/Root
@onready var hero_panel: RivetPanel = $Hud/Root/HeroPanel
@onready var houses_panel: RivetPanel = $Hud/Root/HousesPanel
@onready var status_panel: RivetPanel = $Hud/Root/StatusPanel
@onready var hero_list: HeroList = $Hud/Root/HeroPanel/Rows
@onready var mine_all_button: JuiceButton = $Hud/Root/HeroPanel/MineAllButton
@onready var houses_text: RichTextLabel = $Hud/Root/HousesPanel/HousesText
@onready var status_bar: StatusBar = $Hud/Root/StatusPanel/StatusText
@onready var title_ribbon: Ribbon = $Hud/Root/TitleRibbon
@onready var pending_pill: Pill = $Hud/Root/PendingPill
@onready var rate_pill: Pill = $Hud/Root/RatePill
@onready var claim_button: JuiceButton = $Hud/Root/ClaimButton
@onready var daily_button: JuiceButton = $Hud/Root/DailyButton
@onready var daily_badge: Node2D = $Hud/Root/DailyBadge
@onready var daily_anim: AnimationPlayer = $Hud/Root/DailyBadge/Anim
@onready var stages: Control = $Hud/Root/Stages
@onready var info_line: Label = $Hud/Root/InfoLine
@onready var bombs: Node2D = $Hud/Root/Bombs
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
var _pending_tw: Tween
var _predict_acc := 0.0
var _rate_shown := 0.0
var _rate_tw: Tween


func _ready() -> void:
	add_to_group("mining")
	Juice.register_camera(camera)
	Juice.register_flash_pool(flash_lights)
	# buttons: Phaser makeButton(x, y) positions the face centre
	claim_button.set_center(Vector2(708, 34))
	daily_button.set_center(Vector2(585, 34))
	mine_all_button.set_center(Vector2(108, 42))   # local to HeroPanel (world 138, 104)
	claim_button.pressed.connect(_on_claim)
	daily_button.pressed.connect(_on_daily)
	mine_all_button.pressed.connect(_on_mine_all)
	claim_button.set_label("Locked")
	claim_button.set_enabled(false)
	pending_pill.set_text("loading...")
	rate_pill.set_text("...")
	for i in 3:
		var card: StageCard = stages.get_node("Stage%d" % i)
		card.selected.connect(_on_stage_selected)
		card.visible = false
		_stage_cards.append(card)
	hero_list.hero_pressed.connect(open_popup)
	fx.setup(grid, hero_list, bombs, fx_overlay, pending_pill, cave_glow)
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
	# Juice.count_to tweens live on the autoload and capture our labels: stop them with us
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


## Config flags changed (DebugPanel): lights, FX layer.
func apply_config() -> void:
	cave_glow.enabled = Config.fancy_lights and Config.fx_enabled
	var hidden := GameState.phase in [GameState.Phase.HIDDEN, GameState.Phase.OFFLINE]
	fx.set_active(Config.fx_enabled and not hidden)
	if GameState.state != null and fx.active:
		_bomb_sim.on_state(GameState.state, StateDiff.initial(GameState.state))


# ---------------------------------------------------------------- render

## Idempotent and total: every widget is set from the state, then the diff
## drives the feel (BombSim snap, Fx big moments, flourishes).
func _render(s: StateModel, d: StateDiff) -> void:
	var first := not _rendered or d.first
	var animate := _rendered and Config.fx_enabled
	_render_pending(s, first)
	_render_rate(s, first)
	_render_claim(s, first)
	grid.set_state(s.blocks, animate)
	houses_text.text = Fmt.houses_text(s.houses)
	_render_stages(s)
	info_line.text = Fmt.info_line(s.attempts_today, s.min_blast, s.cooldown_hours)
	hero_list.set_heroes(s.heroes)
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
			hero_list.play_mine_all_flourish(ids)
	if not _rendered:
		_rendered = true
		_play_enter_animation()


func _fmt_pending(v: float) -> String:
	return Fmt.pending_pill(v, _pending_min)


func _render_pending(s: StateModel, first: bool) -> void:
	_pending_min = s.min_blast
	var label: CounterLabel = pending_pill.value_label
	if first or not Config.fx_enabled:
		_kill(_pending_tw)
		_pending_shown = s.pending
		label.value = s.pending
		label.text = _fmt_pending(s.pending)
		return
	var jump := s.pending - _pending_shown
	_ease_pending(s.pending, pending_ease_seconds)
	if jump > PENDING_JUMP:
		Juice.punch_scale(label, 0.12, 0.25)
		label.flash(Color("fff9c4"))
		Sfx.play(&"coin")
	elif jump < -PENDING_JUMP:
		label.flash(Color("ef9a9a"))   # claim debit


## Eases the pending counter toward a value (server truth or prediction).
func _ease_pending(target: float, seconds: float) -> void:
	var label: CounterLabel = pending_pill.value_label
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
	pending_pill.value_label.text = _fmt_pending(v)


func _render_rate(s: StateModel, first: bool) -> void:
	var rate := Rules.team_rate(s.heroes)
	var label: CounterLabel = rate_pill.value_label
	label.add_theme_color_override("font_color", VALUE_TEXT if rate > 0.0 else IDLE_TEXT)
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


# ---------------------------------------------------------------- actions

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

## §6.12: panels fade + slide 12 px with a 60 ms stagger, the ribbon drops
## in with a bounce, cells pop in 15 ms apart, pills count up from 0.
func _play_enter_animation() -> void:
	if not Config.fx_enabled or Config.juice_scale() <= 0.0:
		return
	var items: Array = [rate_pill, hero_panel, pending_pill, houses_panel, stages, info_line, status_panel, daily_button, claim_button]
	for i in items.size():
		var n: Control = items[i]
		var base: Vector2 = n.position
		n.position = base + Vector2(0, 12)
		n.modulate.a = 0.0
		var tw := create_tween().set_parallel(true)
		tw.tween_property(n, "position", base, 0.25).set_delay(i * 0.06).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.tween_property(n, "modulate:a", 1.0, 0.25).set_delay(i * 0.06)
	var ribbon_y := title_ribbon.position.y
	title_ribbon.position.y = -30.0
	var rtw := create_tween()
	rtw.tween_property(title_ribbon, "position:y", ribbon_y, 0.45).set_delay(0.1).set_trans(Tween.TRANS_BOUNCE).set_ease(Tween.EASE_OUT)
	grid.play_spawn_all(0.015)
	if GameState.state != null:
		var s: StateModel = GameState.state
		_pending_shown = 0.0
		_ease_pending(s.pending, 0.8)
		var rate := Rules.team_rate(s.heroes)
		if rate > 0.0:
			_kill(_rate_tw)
			_rate_tw = Juice.count_to(rate_pill.value_label, 0.0, rate, 0.8, func(v: float) -> String: return Fmt.rate_pill(v))


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


func _alive(g: int) -> bool:
	return g == _gen and is_inside_tree()
