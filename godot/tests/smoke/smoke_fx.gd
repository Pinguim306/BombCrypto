extends Node
## FX soak (headless): Config forces fx_enabled=false without a display, so
## the tween / bomb / explosion / popup / debug-panel code never runs in the
## plain smoke test. This scene turns FX back on after boot, runs main.tscn
## with the MockBackend at x30 virtual time (bombs land every few frames,
## blocks die, the map regenerates) and drives the actions; any SCRIPT ERROR
## in the output is a failure:
##
##   $GODOT --headless --path godot res://tests/smoke/smoke_fx.tscn 2>&1 | grep -E "SCRIPT ERROR|OK fx"

const MAIN_SCENE := "res://scenes/main.tscn"
const DEBUG_PANEL := "res://scenes/ui/debug_panel.tscn"

var _fails: Array[String] = []


func _ready() -> void:
	_run()


func _run() -> void:
	Config.fx_enabled = true
	Config.fancy_lights = true
	Config.reduced_motion = false
	await get_tree().process_frame
	var main: Node = (load(MAIN_SCENE) as PackedScene).instantiate()
	add_child(main)
	var mb := Backend.impl as MockBackend
	if mb == null:
		_fails.append("MockBackend expected")
		_finish()
		return
	mb.latency_ms = 0
	mb.server.time_scale = 3.0   # bombs every ~1 s of real time per hero; stamina lasts long enough
	await _wait(0.5)
	var mining: Mining = get_tree().get_first_node_in_group("mining") as Mining
	if mining == null or GameState.state == null:
		_fails.append("mining scene / state missing after boot")
		_finish()
		return
	print("fx soak: phase=%d heroes=%d" % [GameState.phase, GameState.state.heroes.size()])

	# predictive bombs + hits + deaths (headless frames are not 60 fps: wait wall-clock time)
	await _wait(6.0)
	var bombs: Node2D = mining.get_node("Hud/Root/Bombs")
	var explosions: Node2D = mining.get_node("World/Fx/Explosions")
	var dead_visual := 0
	for c: BlockCell in mining.grid.cells:
		if not c.alive:
			dead_visual += 1
	print("fx soak: bombs pooled=%d explosions pooled=%d dead cells=%d pending=%.2f" % [bombs.get_child_count(), explosions.get_child_count(), dead_visual, GameState.state.pending])
	if bombs.get_child_count() == 0:
		_fails.append("no bombs were thrown in predict mode")
	if explosions.get_child_count() == 0:
		_fails.append("no explosions played")

	# popup open / close with tweens, then an awaited action through it
	var h: HeroModel = GameState.state.heroes[0]
	mining.open_popup(h.id)
	await _frames(20)
	var popup: HeroPopup = mining.get_node("PopupLayer/Popup")
	if not popup.is_open:
		_fails.append("popup did not open with fx")
	popup._on_work_rest()
	await _frames(30)
	if popup.is_open:
		_fails.append("popup stayed open after the awaited action")
	mining.open_popup(h.id)
	await _frames(5)
	popup.close()
	await _frames(20)

	# mine-all flourish, stage select punch, claim gate punch, badge pulse
	GameState.mine_all()
	await _frames(30)
	mining._on_stage_selected(1)
	mb.server.set_pending(float(mb.server.min_blast) + 1.0)
	GameState.refresh_now()
	await _frames(30)
	var claim: JuiceButton = mining.get_node("Hud/Root/ClaimButton")
	if claim.label != "Claim":
		_fails.append("claim button did not unlock (label %s)" % claim.label)
	mining._on_badge(true)
	await _frames(10)

	# reconcile mode, hidden tab (pools cleared), online events, drain, clear map
	Config.bomb_mode = "reconcile"
	mining.apply_config()
	await _wait(4.0)
	mb.emit_host({"type": "visibility", "hidden": true})
	await _frames(10)
	mb.emit_host({"type": "visibility", "hidden": false})
	mb.emit_host({"type": "online", "online": false})
	await _frames(10)
	mb.emit_host({"type": "online", "online": true})
	await _frames(30)
	mb.server.clear_map()
	GameState.refresh_now()
	await _wait(3.0)   # the next server bomb regenerates the map -> spawn stagger + toast
	print("fx soak: maps_cleared=%d alive=%d" % [GameState.state.maps_cleared, GameState.state.alive_count()])
	mb.server.drain_stamina()
	GameState.refresh_now()
	await _wait(1.0)
	Config.bomb_mode = "predict"
	Config.reduced_motion = true
	mining.apply_config()
	await _frames(60)
	Config.reduced_motion = false
	mining.apply_config()

	# scenario swap (rows re-keyed, pager) + claim flow through the mock
	mb.set_scenario("rich")
	GameState.refresh_now()
	await _frames(60)
	mining.hero_list._next()
	await _frames(10)
	mining.hero_list._prev()
	mb.set_scenario("claimable")
	GameState.refresh_now()
	await _frames(30)
	GameState.claim()
	await _frames(150)

	# debug panel builds and its hooks run
	var panel: Control = (load(DEBUG_PANEL) as PackedScene).instantiate()
	add_child(panel)
	await _frames(5)
	for b: Node in _find_buttons(panel):
		if b is Button and not (b is CheckButton) and not (b is OptionButton) and (b as Button).text != "close":
			(b as Button).pressed.emit()
			await _frames(3)
	await _frames(60)
	panel.queue_free()

	# scene teardown (session expiry frees the mining scene) and re-login
	mb.expire_session()
	await _frames(30)
	mb.restore_session()
	await _frames(60)
	_finish()


func _find_buttons(n: Node) -> Array:
	var out: Array = []
	for c: Node in n.get_children():
		if c is Button:
			out.append(c)
		out.append_array(_find_buttons(c))
	return out


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _wait(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout


func _finish() -> void:
	if _fails.is_empty():
		print("OK fx soak")
		get_tree().quit(0)
	else:
		for f in _fails:
			printerr("FAIL " + f)
		get_tree().quit(1)
