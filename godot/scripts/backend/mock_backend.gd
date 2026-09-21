class_name MockBackend
extends BackendBase
## Latency / fault-injection wrapper over MockServer. Selected by the Backend autoload in the
## editor, with --mock, or with ?mock=1 on the web. Advances the server's virtual clock every
## frame (real delta * server.time_scale).

const MOCK_ADDRESS := "0xMOCK"
const MOCK_TX_HASH := "0xabababababababababababababababababababababababababababababababab"
const CLAIM_DELAY_S := 1.5
const DEFAULT_LATENCY_MS := 120

var server: MockServer
var latency_ms := DEFAULT_LATENCY_MS
var offline := false
var logged_in := true
var fail_next: Dictionary = {}       # method -> {"code": String, "error": String}; consumed once
var flaky_pct := 0                   # % of calls that fail with a network error
var claim_outcome := "succeed"       # "succeed" | "user_rejected" | "cooldown" | "min"  (DebugPanel)
var scenario_name := "default"
var last_dto: Dictionary = {}        # last GameStateDto served (DebugPanel "dump last DTO")
var _acc_ms := 0.0
var _rng := RandomNumberGenerator.new()


func _init(scenario: String = "default") -> void:
	_rng.randomize()
	set_scenario(scenario)


func is_mock() -> bool:
	return true


func _process(delta: float) -> void:
	if server == null:
		return
	_acc_ms += delta * 1000.0
	var whole := int(_acc_ms)
	if whole > 0:
		_acc_ms -= whole
		server.advance(whole)


# ---- fault injection / host simulation --------------------------------------

## Applies the injected faults in the design's order, then runs `fn` against the server.
## `fn` returns the server Dictionary; `{"error": msg[, "code": c]}` becomes fail(c|"http", msg).
func _call(method: String, fn: Callable, extra_delay_s: float = 0.0, needs_session: bool = true) -> Envelope:
	var wait_s := latency_ms / 1000.0 + extra_delay_s
	if wait_s > 0.0:
		await _wait(wait_s)
	if offline:
		return Envelope.fail("network", "Failed to fetch")
	if needs_session and not logged_in:
		host_event.emit({"type": "session", "loggedIn": false, "reason": "expired"})
		return Envelope.fail("session_expired", "session expired")
	var key := _fail_key(method)
	if key != "":
		var inj: Dictionary = fail_next[key]
		fail_next.erase(key)
		return Envelope.fail(str(inj.get("code", "http")), str(inj.get("error", "injected failure")))
	if flaky_pct > 0 and _rng.randi_range(1, 100) <= flaky_pct:
		return Envelope.fail("network", "Failed to fetch")
	var r: Variant = fn.call()
	if typeof(r) == TYPE_DICTIONARY:
		var d: Dictionary = r
		if d.has("error"):
			return Envelope.fail(str(d.get("code", "http")), str(d["error"]))
		if d.has("heroes"):
			last_dto = d
		elif d.has("state") and typeof(d["state"]) == TYPE_DICTIONARY:
			last_dto = d["state"]
	return Envelope.success(r)


## Simulated latency. Uses the main loop's timer so it also works before the node is inside the
## tree (headless harnesses); returns immediately when no SceneTree exists.
func _wait(seconds: float) -> void:
	var tree: SceneTree = get_tree() if is_inside_tree() else (Engine.get_main_loop() as SceneTree)
	if tree == null:
		return
	await tree.create_timer(seconds).timeout


## fail_next keys may be snake_case ("set_mode"), camelCase ("setMode") or bridge names ("apiSetMode").
func _fail_key(method: String) -> String:
	var want := _norm_method(method)
	for k: Variant in fail_next.keys():
		if _norm_method(str(k)) == want:
			return str(k)
	return ""


static func _norm_method(m: String) -> String:
	var s := m.replace("_", "").to_lower()
	if s.begins_with("api") and s.length() > 3:
		s = s.substr(3)
	if s == "connect":
		s = "connectwallet"
	elif s == "disconnect":
		s = "disconnectwallet"
	return s


## Simulates the host page expiring the JWT (401): every call fails until restore_session().
func expire_session() -> void:
	logged_in = false
	host_event.emit({"type": "session", "loggedIn": false, "reason": "expired"})


func restore_session() -> void:
	logged_in = true
	host_event.emit({"type": "session", "loggedIn": true, "address": MOCK_ADDRESS, "reason": "login"})


## Injects any host -> Godot event (visibility, online, nav, session, claim...).
func emit_host(ev: Dictionary) -> void:
	host_event.emit(ev)


## Rebuilds the server from a fixture and applies the scenario preset (design §9).
func set_scenario(name: String) -> void:
	scenario_name = name
	server = Scenarios.build(name)
	latency_ms = DEFAULT_LATENCY_MS
	flaky_pct = 0
	offline = false
	logged_in = true
	fail_next.clear()
	last_dto = {}
	match name:
		"flaky":
			flaky_pct = 30
			latency_ms = 800
		"expired":
			logged_in = false


# ---- BackendBase API ----------------------------------------------------------

func state() -> Envelope:
	return await _call("state", server.state_dto)


func set_mode(hero_id: String, mode: String) -> Envelope:
	return await _call("set_mode", func() -> Dictionary: return server.set_mode(hero_id, mode))


func set_team_mode(mode: String) -> Envelope:
	return await _call("set_team_mode", func() -> Dictionary: return server.set_team_mode(mode))


func set_house(hero_id: String, house_id: String) -> Envelope:
	return await _call("set_house", func() -> Dictionary: return server.set_house(hero_id, house_id))


func adventure(hero_id: String, stage_id: int) -> Envelope:
	return await _call("adventure", func() -> Dictionary: return server.adventure(hero_id, stage_id))


func daily_status() -> Envelope:
	return await _call("daily_status", server.daily_status)


func claim_daily() -> Envelope:
	return await _call("claim_daily", server.claim_daily)


func voucher() -> Envelope:
	return await _call("voucher", server.voucher)


## Mock of the host `claim`: voucher -> wallet step -> tx hash after ~1.5 s, or the outcome
## chosen in the DebugPanel (user_rejected / cooldown / min).
func claim(wait_receipt: bool) -> Envelope:
	var extra := maxf(0.0, CLAIM_DELAY_S - latency_ms / 1000.0)
	return await _call("claim", _do_claim.bind(wait_receipt), extra)


func _do_claim(wait_receipt: bool) -> Dictionary:
	match claim_outcome:
		"cooldown":
			return {"error": "claim cooldown active — try again in ~37 min"}
		"min":
			return {"error": "minimum claim is %s BLAST" % Fmt.thousands(server.min_blast)}
	var v := server.voucher()
	if v.has("error"):
		return v
	host_event.emit({"type": "claim", "step": "wallet"})
	if claim_outcome == "user_rejected":
		return {"error": "User rejected the request.", "code": "user_rejected"}
	host_event.emit({"type": "claim", "step": "sent", "hash": MOCK_TX_HASH})
	server.mark_voucher_claimed()
	return {"hash": MOCK_TX_HASH, "amountWei": v["amount"], "receipt": "success" if wait_receipt else "not_awaited"}


func connect_wallet(kind: String) -> Envelope:
	return await _call("connect_wallet", func() -> Dictionary:
		host_event.emit({"type": "wallet", "address": MOCK_ADDRESS, "kind": kind})
		return {"address": MOCK_ADDRESS}, 0.0, false)


func sign_in() -> Envelope:
	return await _call("sign_in", func() -> Dictionary:
		logged_in = true
		host_event.emit({"type": "session", "loggedIn": true, "address": MOCK_ADDRESS, "reason": "login"})
		return {"address": MOCK_ADDRESS}, 0.0, false)


func reconnect() -> Envelope:
	return await _call("reconnect", func() -> Dictionary:
		return {"walletAddress": MOCK_ADDRESS, "tokenAddress": MOCK_ADDRESS, "loggedIn": logged_in, "mismatch": false}, 0.0, false)


func disconnect_wallet() -> Envelope:
	return await _call("disconnect_wallet", func() -> Dictionary:
		logged_in = false
		host_event.emit({"type": "session", "loggedIn": false, "address": null, "reason": "disconnect"})
		return {}, 0.0, false)


func config() -> Dictionary:
	return {
		"serverUrl": "mock",
		"chainId": MockServer.CHAIN_ID,
		"explorerUrl": "https://robinhoodchain.blockscout.com",
		"mobileWalletEnabled": false,
		"networkName": "Robinhood Chain (mock)",
		"mock": true,
		"reducedMotion": false,
		"buildId": "mock",
	}


func session() -> Dictionary:
	return {
		"hasToken": true,
		"tokenAddress": MOCK_ADDRESS,
		"walletAddress": MOCK_ADDRESS,
		"walletKind": "injected",
		"loggedIn": true,
	}


func notify_ready() -> void:
	pass


func nav(_target: String) -> void:
	pass


func open_explorer(_hash: String) -> void:
	pass
