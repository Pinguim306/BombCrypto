class_name DebugPanel
extends Control
## F1 developer panel (design §9). Only meaningful with the MockBackend
## (editor / --mock / ?mock=1): scenario, latency, fault injection, host
## event injection, virtual clock, server hooks, claim outcome, bomb mode and
## the FX flags. Built in code so the .tscn stays a one-node shell.

const LATENCIES: Array[int] = [0, 300, 3000]
const FAIL_METHODS: Array[String] = ["state", "setMode", "claim"]
const CLAIM_OUTCOMES: Array[String] = ["succeed", "user_rejected", "cooldown", "min"]
const BOMB_MODES: Array[String] = ["predict", "reconcile"]
const FONT_SIZE := 11

var _mb: MockBackend = null
var _log: Label
var _vbox: VBoxContainer


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	if Backend.impl is MockBackend:
		_mb = Backend.impl as MockBackend
	var panel := PanelContainer.new()
	panel.name = "Panel"
	panel.position = Vector2(462, 6)
	panel.custom_minimum_size = Vector2(332, 0)
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(panel)
	_vbox = VBoxContainer.new()
	_vbox.add_theme_constant_override("separation", 3)
	panel.add_child(_vbox)

	var title := _label("DEBUG (F1)  —  %s" % ("MockBackend" if _mb != null else "real backend: server hooks disabled"))
	title.add_theme_color_override("font_color", Color("ffcf80"))
	_vbox.add_child(title)

	if _mb != null:
		_build_mock_rows()
	_build_client_rows()

	var bottom := _row("")
	_button(bottom, "dump last DTO", _dump_dto)
	_button(bottom, "close", func() -> void: visible = false)
	_log = _label("")
	_log.add_theme_color_override("font_color", Color("a5d6a7"))
	_log.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_log.custom_minimum_size = Vector2(320, 0)
	_vbox.add_child(_log)


# ---------------------------------------------------------------- rows

func _build_mock_rows() -> void:
	var r := _row("scenario")
	var opt := OptionButton.new()
	opt.add_theme_font_size_override("font_size", FONT_SIZE)
	for n: String in Scenarios.NAMES:
		opt.add_item(n)
	opt.select(maxi(0, Scenarios.NAMES.find(_mb.scenario_name)))
	opt.item_selected.connect(func(i: int) -> void:
		var n: String = Scenarios.NAMES[i]
		_mb.set_scenario(n)
		GameState.refresh_now()
		_say("scenario: " + n))
	r.add_child(opt)

	r = _row("latency")
	for ms: int in LATENCIES:
		_button(r, "%d ms" % ms, func() -> void:
			_mb.latency_ms = ms
			_say("latency %d ms" % ms))

	r = _row("fail next")
	for m: String in FAIL_METHODS:
		_button(r, m, func() -> void:
			_mb.fail_next[m] = {"code": "http", "error": "injected failure (%s)" % m}
			_say("next %s call fails" % m))

	r = _row("network")
	_check(r, "offline (fetch fails)", _mb.offline, func(on: bool) -> void:
		_mb.offline = on
		_say("mock offline: %s" % on))
	_button(r, "event: offline", func() -> void: _mb.emit_host({"type": "online", "online": false}))
	_button(r, "event: online", func() -> void: _mb.emit_host({"type": "online", "online": true}))

	r = _row("session / tab")
	_button(r, "expire session", func() -> void:
		_mb.expire_session()
		_say("session expired"))
	_button(r, "restore", func() -> void:
		_mb.restore_session()
		_say("session restored"))
	_button(r, "hide tab", func() -> void: _mb.emit_host({"type": "visibility", "hidden": true}))
	_button(r, "show tab", func() -> void: _mb.emit_host({"type": "visibility", "hidden": false}))

	r = _row("clock")
	_button(r, "+10 min", func() -> void:
		_mb.server.jump(600_000)
		GameState.refresh_now()
		_say("virtual clock +10 min"))
	_button(r, "x1", func() -> void:
		_mb.server.time_scale = 1.0
		_say("time scale x1"))
	_button(r, "x10", func() -> void:
		_mb.server.time_scale = 10.0
		_say("time scale x10"))

	r = _row("map")
	_button(r, "kill first block", func() -> void:
		var i := GameState.first_alive_index()
		if i >= 0:
			_mb.server.kill_block(i)
			GameState.refresh_now()
		_say("killed block %d" % i))
	_button(r, "clear map", func() -> void:
		_mb.server.clear_map()
		GameState.refresh_now()
		_say("map cleared (regen on the next bomb)"))

	r = _row("pending")
	_button(r, "+1000", func() -> void:
		_mb.server.add_pending(1000.0)
		GameState.refresh_now()
		_say("pending +1000"))
	_button(r, "set to min+1", func() -> void:
		_mb.server.set_pending(float(_mb.server.min_blast) + 1.0)
		GameState.refresh_now()
		_say("pending = min + 1"))

	r = _row("heroes")
	_button(r, "drain stamina", func() -> void:
		_mb.server.drain_stamina()
		GameState.refresh_now()
		_say("stamina drained"))
	_button(r, "add 5 heroes", func() -> void:
		_mb.server.add_heroes(5)
		GameState.refresh_now()
		_say("5 heroes added"))

	r = _row("claim outcome")
	var co := OptionButton.new()
	co.add_theme_font_size_override("font_size", FONT_SIZE)
	for n: String in CLAIM_OUTCOMES:
		co.add_item(n)
	co.select(maxi(0, CLAIM_OUTCOMES.find(_mb.claim_outcome)))
	co.item_selected.connect(func(i: int) -> void:
		_mb.claim_outcome = CLAIM_OUTCOMES[i]
		_say("claim outcome: " + _mb.claim_outcome))
	r.add_child(co)


func _build_client_rows() -> void:
	var r := _row("bomb mode")
	var bm := OptionButton.new()
	bm.add_theme_font_size_override("font_size", FONT_SIZE)
	for n: String in BOMB_MODES:
		bm.add_item(n)
	bm.select(maxi(0, BOMB_MODES.find(Config.bomb_mode)))
	bm.item_selected.connect(func(i: int) -> void:
		Config.bomb_mode = BOMB_MODES[i]
		_apply_config()
		_say("bomb mode: " + Config.bomb_mode))
	r.add_child(bm)

	r = _row("feel")
	_check(r, "FX", Config.fx_enabled, func(on: bool) -> void:
		Config.fx_enabled = on
		_apply_config()
		_say("fx: %s" % on))
	_check(r, "reduced motion", Config.reduced_motion, func(on: bool) -> void:
		Config.reduced_motion = on
		_apply_config()
		_say("reduced motion: %s" % on))
	_check(r, "fancy lights", Config.fancy_lights, func(on: bool) -> void:
		Config.fancy_lights = on
		_apply_config()
		_say("fancy lights: %s" % on))


# ---------------------------------------------------------------- helpers

func _apply_config() -> void:
	get_tree().call_group("mining", "apply_config")


func _dump_dto() -> void:
	if _mb == null:
		_say("no MockBackend")
		return
	print("---- last DTO (%s) ----" % _mb.scenario_name)
	print(JSON.stringify(_mb.last_dto, "  "))
	_say("last DTO printed to the Output panel")


func _say(msg: String) -> void:
	if _log != null:
		_log.text = msg


func _row(title: String) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 4)
	if title != "":
		var l := _label(title)
		l.custom_minimum_size = Vector2(84, 0)
		h.add_child(l)
	_vbox.add_child(h)
	return h


func _label(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", FONT_SIZE)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _button(row: HBoxContainer, text: String, fn: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", FONT_SIZE)
	b.pressed.connect(fn)
	row.add_child(b)
	return b


func _check(row: HBoxContainer, text: String, initial: bool, fn: Callable) -> CheckButton:
	var c := CheckButton.new()
	c.text = text
	c.button_pressed = initial
	c.focus_mode = Control.FOCUS_NONE
	c.add_theme_font_size_override("font_size", FONT_SIZE)
	c.toggled.connect(fn)
	row.add_child(c)
	return c
