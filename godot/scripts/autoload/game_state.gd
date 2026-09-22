extends Node
## GameState autoload — the only stateful brain of the client. Owns the
## server state (StateModel), the poll loop, every mutation, and the status
## messages. Scenes render from `state_applied` and call the action methods;
## they never talk to the Backend directly.
##
## Concurrency rules: one poll in flight at a time (one-shot timer re-armed
## after each response), every continuation is generation-guarded (`_gen`)
## and results are sequenced (`_seq` / `_applied_seq`) so a slow response can
## never overwrite a newer one.

enum Phase { BOOT, LOGGED_OUT, LOADING, LIVE, DEGRADED, OFFLINE, HIDDEN, SESSION_EXPIRED }
enum Kind { NEUTRAL, SUCCESS, ERROR, KEEP }

signal phase_changed(phase: int, prev: int)
signal state_applied(state: StateModel, diff: StateDiff)
signal status(msg: String, kind: int)
signal busy_changed(busy: bool, action: String)
signal net_changed(failures: int, next_retry_ms: int)
signal daily_badge_changed(can_claim: bool)
signal claim_progress(step: String)
signal _wake   # internal: cuts a sleep short / resumes a hidden loop

const ACTIVE_PHASES := [Phase.LOADING, Phase.LIVE, Phase.DEGRADED, Phase.OFFLINE, Phase.HIDDEN]

var phase: int = Phase.BOOT
var state: StateModel = null
var busy := false
var selected_stage := 0
var hero_page := 0
var daily_can_claim := false
var last_claim_hash := ""
var poll_ms: int = Config.POLL_MS

var _gen := 0
var _seq := 0
var _applied_seq := 0
var _failures := 0
var _hidden := false
var _online := true
var _inflight := false
var _hold_poll := false   # a mutation whose DTO will refresh us is in flight
var _next_delay_ms: int = Config.POLL_MS
var _last_daily_ms := 0


## One-shot waiter: fires once on the first of several signals (timer or wake).
class Waiter extends RefCounted:
	signal fired
	var _done := false
	func fire() -> void:
		if _done:
			return
		_done = true
		fired.emit()


# ---------------------------------------------------------------- lifecycle

func start() -> void:
	var sess := Backend.session()
	if bool(sess.get("loggedIn", false)):
		_enter_loading()
	else:
		_set_phase(Phase.LOGGED_OUT)


## Host says the wallet just signed in (or replayed an existing session).
func on_logged_in() -> void:
	if phase in ACTIVE_PHASES:
		return   # already polling
	_enter_loading()


func _enter_loading() -> void:
	_gen += 1
	_failures = 0
	_inflight = false
	_next_delay_ms = poll_ms
	_set_phase(Phase.LOADING)
	_poll_loop(_gen)


## Polls right away unless a request is already in flight.
func refresh_now() -> void:
	if _inflight:
		return
	_next_delay_ms = 0
	_wake.emit()


func pause() -> void:
	_hidden = true
	if phase in [Phase.LOADING, Phase.LIVE, Phase.DEGRADED, Phase.OFFLINE]:
		_set_phase(Phase.HIDDEN)


func resume() -> void:
	_hidden = false
	if phase == Phase.HIDDEN:
		_set_phase(Phase.LIVE)
	_wake.emit()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_IN and phase in ACTIVE_PHASES:
		refresh_now()   # backup for hosts that never relay visibility


# ---------------------------------------------------------------- poll loop

func _poll_loop(gen: int) -> void:
	while gen == _gen and phase in ACTIVE_PHASES:
		if _hidden or not _online:
			await _wake
			if gen != _gen:
				return
			continue
		if _hold_poll:
			await _sleep(200)   # a mutation is in flight; its DTO refreshes us
			continue
		_seq += 1
		var seq := _seq
		_inflight = true
		var env: Envelope = await Backend.state()
		_inflight = false
		if gen != _gen:
			return
		_handle_poll(env, seq)
		if _next_delay_ms > 0:
			await _sleep(_next_delay_ms)


func _sleep(ms: int) -> void:
	var w := Waiter.new()
	get_tree().create_timer(ms / 1000.0).timeout.connect(w.fire)
	_wake.connect(w.fire, CONNECT_ONE_SHOT)
	await w.fired
	if _wake.is_connected(w.fire):
		_wake.disconnect(w.fire)


func _handle_poll(env: Envelope, seq: int) -> void:
	if env.ok:
		if seq < _applied_seq:
			return   # superseded by a mutation's fresher DTO — not a failure
		if _apply(env.data, seq, "poll"):
			_failures = 0
			_set_phase(Phase.LIVE)
			_next_delay_ms = poll_ms
			net_changed.emit(0, 0)
			if Time.get_ticks_msec() - _last_daily_ms > Config.DAILY_REFRESH_MS:
				_refresh_daily()
			return
		env = Envelope.fail("parse", "bad state from server")   # counts as a failed poll
	if env.code == "session_expired":
		_on_session_expired()
		return
	_failures += 1
	_set_phase(Phase.OFFLINE if _failures >= Config.OFFLINE_AFTER_FAILURES else Phase.DEGRADED)
	# KEEP (no shake/sound): the NetBanner carries the retry feedback; _apply
	# already reported a parse failure
	if env.code != "parse":
		status.emit("error: " + env.error, Kind.KEEP)
	_next_delay_ms = Config.BACKOFF_MS[mini(_failures, Config.BACKOFF_MS.size() - 1)] + randi_range(0, 250)
	net_changed.emit(_failures, _next_delay_ms)


## Applies a server DTO if it is newer than the last applied one.
func _apply(dict: Variant, seq: int, _source: String) -> bool:
	if seq < _applied_seq:
		return false
	var next: StateModel = StateModel.parse(dict)
	if next == null:
		push_error("bad state from server: " + StateModel.last_error)
		status.emit("error: bad state from server", Kind.ERROR)
		return false
	_applied_seq = seq
	var diff: StateDiff = StateDiff.compute(state, next)
	state = next
	state_applied.emit(state, diff)
	return true


func _on_session_expired() -> void:
	_end_session(true)
	Backend.nav("login")


## Leaves the active phases and drops everything scoped to the old session,
## so a re-login never renders (or fires diff FX against) another wallet's data.
func _end_session(expired: bool) -> void:
	_gen += 1
	selected_stage = 0
	hero_page = 0
	state = null
	last_claim_hash = ""
	if daily_can_claim:
		daily_can_claim = false
		daily_badge_changed.emit(false)
	if expired:
		_set_phase(Phase.SESSION_EXPIRED)
		status.emit("error: session expired", Kind.ERROR)
	else:
		_set_phase(Phase.LOGGED_OUT)


func _set_phase(p: int) -> void:
	if p == phase:
		return
	var prev := phase
	phase = p
	phase_changed.emit(p, prev)
	if p == Phase.LIVE and prev == Phase.LOADING:
		_refresh_daily()


# ---------------------------------------------------------------- actions

## Runs one mutation at a time; applies the DTO it returns (top-level or `.state`).
## `hold_poll` pauses polling until that DTO lands; claim returns no DTO and may
## sit in the wallet for minutes, so it keeps the poll loop running.
func _run(action: String, fn: Callable, hold_poll := true) -> Envelope:
	if busy:
		status.emit("please wait…", Kind.NEUTRAL)
		return Envelope.fail("busy", "busy")
	busy = true
	_hold_poll = hold_poll
	busy_changed.emit(true, action)
	_seq += 1
	var seq := _seq
	var env: Envelope = await fn.call()
	if not is_inside_tree():
		return env
	busy = false
	_hold_poll = false
	busy_changed.emit(false, action)
	if env.ok and env.data is Dictionary:
		var d: Dictionary = env.data
		if d.has("heroes"):
			_apply(d, seq, action)
		elif d.has("state") and d["state"] is Dictionary and (d["state"] as Dictionary).has("heroes"):
			_apply(d["state"], seq, action)
		_next_delay_ms = poll_ms
	elif not env.ok and env.code == "session_expired":
		_on_session_expired()
	return env


func set_hero_mode(hero_id: String, mode: String) -> void:
	var env := await _run("set_mode", func() -> Envelope: return await Backend.set_mode(hero_id, mode))
	if env.code == "busy":
		return
	if env.ok:
		status.emit("", Kind.KEEP)
		Sfx.play(&"hero_work" if mode == "work" else &"hero_rest")
	else:
		status.emit("error: " + env.error, Kind.ERROR)


func mine_all() -> void:
	var env := await _run("mine_all", func() -> Envelope: return await Backend.set_team_mode("work"))
	if env.code == "busy":
		return
	if env.ok:
		var changed := 0
		if env.data is Dictionary:
			changed = int((env.data as Dictionary).get("changed", 0))
		status.emit(Fmt.mine_all_msg(changed), Kind.SUCCESS)
	else:
		status.emit("error: " + env.error, Kind.ERROR)


func toggle_house(hero_id: String) -> void:
	if state == null:
		return
	var hero: HeroModel = state.hero(hero_id)
	if hero == null:
		return
	var target_house := ""
	if hero.house_id == "":
		var free: HouseModel = state.free_house()
		if free == null:
			status.emit("no house with a free slot", Kind.ERROR)
			return
		target_house = free.id
	var env := await _run("set_house", func() -> Envelope: return await Backend.set_house(hero_id, target_house))
	if env.code == "busy":
		return
	if env.ok:
		status.emit("hero sheltered" if target_house != "" else "hero left the house", Kind.SUCCESS)
	else:
		status.emit("error: " + env.error, Kind.ERROR)


func go_adventure(hero_id: String, stage_id: int) -> void:
	if busy:
		status.emit("please wait…", Kind.NEUTRAL)
		return
	status.emit("expedition in progress...", Kind.NEUTRAL)
	var env := await _run("adventure", func() -> Envelope: return await Backend.adventure(hero_id, stage_id))
	if env.code == "busy":
		return
	if not env.ok:
		status.emit("adventure: " + env.error, Kind.ERROR)
		return
	var d: Dictionary = env.data if env.data is Dictionary else {}
	var chance := int(d.get("successChance", 0))
	var stage_name := str(d.get("stage", ""))
	if bool(d.get("success", false)):
		status.emit(Fmt.victory_msg(stage_name, int(d.get("rewardMicro", 0)), chance), Kind.SUCCESS)
		Sfx.play(&"coin")
	else:
		status.emit(Fmt.defeat_msg(stage_name, chance), Kind.ERROR)


func claim() -> void:
	if busy:
		status.emit("please wait…", Kind.NEUTRAL)
		return
	status.emit("issuing voucher...", Kind.NEUTRAL)
	claim_progress.emit("voucher")
	var env := await _run("claim", func() -> Envelope: return await Backend.claim(false), false)
	if env.code == "busy":
		return
	if env.ok:
		var d: Dictionary = env.data if env.data is Dictionary else {}
		last_claim_hash = str(d.get("hash", ""))
		status.emit("claim sent: " + Fmt.short_hash(last_claim_hash), Kind.SUCCESS)
		Sfx.play(&"claim_sent")
	else:
		status.emit("claim failed: " + env.error, Kind.ERROR)
		Sfx.play(&"ui_error")
	refresh_now()


func select_stage(id: int) -> void:
	selected_stage = id


func set_hero_page(p: int) -> void:
	hero_page = maxi(0, p)


func hero(id: String) -> HeroModel:
	return state.hero(id) if state != null else null


func first_alive_index() -> int:
	return state.first_alive_index() if state != null else -1


## Display-only estimate of pending BLAST between polls: the server keeps
## accruing power*0.075 per bomb for every working hero. Clamped to two
## polls' worth of income so a stalled poll never runs away.
func predicted_pending() -> float:
	if state == null:
		return 0.0
	var now := Time.get_ticks_msec()
	var elapsed_ms: int = maxi(0, now - state.received_at_ms)
	var income := 0.0
	var rate_per_ms := 0.0
	for h: HeroModel in state.working_heroes():
		if h.stamina < 1 or h.bomb_interval_ms <= 0:
			continue
		var bombs: int = int(floor(float(elapsed_ms) / float(h.bomb_interval_ms)))
		income += float(mini(bombs, h.stamina)) * float(h.power) * Config.BLAST_PER_HP
		rate_per_ms += (float(h.power) * Config.BLAST_PER_HP) / float(h.bomb_interval_ms)
	var cap: float = rate_per_ms * float(poll_ms) * 2.0
	return state.pending + minf(income, cap)


# ---------------------------------------------------------------- daily badge

func _refresh_daily() -> void:
	_last_daily_ms = Time.get_ticks_msec()
	var gen := _gen
	var env: Envelope = await Backend.daily_status()
	if gen != _gen or not env.ok or not (env.data is Dictionary):
		return
	daily_can_claim = bool((env.data as Dictionary).get("canClaim", false))
	daily_badge_changed.emit(daily_can_claim)


# ---------------------------------------------------------------- host events

func _on_host_event(ev: Dictionary) -> void:
	match str(ev.get("type", "")):
		"visibility":
			if bool(ev.get("hidden", false)):
				pause()
			else:
				resume()
				refresh_now()
				_refresh_daily()
		"online":
			_online = bool(ev.get("online", true))
			if not _online:
				if phase in ACTIVE_PHASES:
					_set_phase(Phase.OFFLINE)
				net_changed.emit(maxi(_failures, Config.OFFLINE_AFTER_FAILURES), 5000)
			else:
				_failures = 0
				refresh_now()
		"session":
			if bool(ev.get("loggedIn", false)):
				on_logged_in()
			else:
				var reason := str(ev.get("reason", ""))
				_end_session(reason == "expired")
				# ask the page for its login UI — except on disconnect, where the
				# page reloads itself (the host event lands BEFORE the envelope, so
				# the poll path's own handler never runs for this generation)
				if reason != "disconnect":
					Backend.nav("login")
		"claim":
			var step := str(ev.get("step", ""))
			claim_progress.emit(step)
			if step == "wallet":
				status.emit("confirm the claim transaction in your wallet...", Kind.NEUTRAL)
			elif step == "sent" and ev.has("hash"):
				# keep the hash even if the claim() call itself timed out meanwhile
				last_claim_hash = str(ev.get("hash", ""))
		_:
			pass   # nav / wallet: handled by the host page itself
