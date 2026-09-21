class_name WebBackend
extends BackendBase
## Web transport: every call goes through the host page's window.mb bridge
## (client/src/bridge/mb.ts). Godot never issues HTTP itself. See
## docs/godot-v2-design.md §8 and Appendix A for the contract.
##
## Mechanism: mb.invoke(reqId, method, argsJson, cb) returns immediately; the
## page resolves the Promise and calls cb(reqId, envelopeJson) exactly once.
## Results arrive in completion order, so every call is correlated by reqId.

var _mb: JavaScriptObject
# ONE persistent callback for all invoke results and one host→Godot listener.
# They must stay referenced for the whole session or the JS side is collected.
var _cb: JavaScriptObject
var _listener: JavaScriptObject
var _pending: Dictionary = {}      # req_id: String -> Pending
var _seq := 0


class Pending extends RefCounted:
	signal done(env: Envelope)


## True only on a web build whose host page installed window.mb (version 1).
static func available() -> bool:
	if not OS.has_feature("web"):
		return false
	var r: Variant = JavaScriptBridge.eval(
		"typeof window.mb === 'object' && window.mb !== null && window.mb.version === 1", true)
	return r == true


func _ready() -> void:
	_mb = JavaScriptBridge.get_interface("mb")
	_cb = JavaScriptBridge.create_callback(_on_result)
	_listener = JavaScriptBridge.create_callback(_on_host_event)
	_mb.setListener(_listener)   # the host replays the latest {"type":"session"} event


func _invoke(method: String, args: Dictionary = {}, timeout_ms: int = Config.REQUEST_TIMEOUT_MS) -> Envelope:
	_seq += 1
	var id := "%d" % _seq
	var p := Pending.new()
	_pending[id] = p
	_mb.invoke(id, method, JSON.stringify(args), _cb)
	# watchdog: a host promise that never settles (wallet hang, tab frozen)
	# becomes a synthetic timeout; a late real result is then ignored by id
	var timer := get_tree().create_timer(timeout_ms / 1000.0)
	timer.timeout.connect(func() -> void:
		if _pending.has(id):
			_pending.erase(id)
			p.done.emit(Envelope.fail("timeout", method + " timed out")))
	var env: Envelope = await p.done
	return env


# JS callback args arrive as ONE Array: a[0] = reqId, a[1] = envelope JSON.
func _on_result(a: Array) -> void:
	if a.size() < 2:
		return
	var id := str(a[0])
	var p: Pending = _pending.get(id)
	if p == null:
		return   # late or duplicate result → ignored
	_pending.erase(id)
	var env := Envelope.from_json(str(a[1]))
	if not env.ok and env.code == "session_expired":
		host_event.emit({"type": "session", "loggedIn": false, "reason": "expired"})
	p.done.emit(env)


func _on_host_event(a: Array) -> void:
	if a.is_empty():
		return
	var ev: Variant = JSON.parse_string(str(a[0]))
	if typeof(ev) == TYPE_DICTIONARY:
		host_event.emit(ev)


# ---- BackendBase API ----

func state() -> Envelope:
	return await _invoke("apiState")

func set_mode(hero_id: String, mode: String) -> Envelope:
	return await _invoke("apiSetMode", {"heroId": hero_id, "mode": mode})

func set_team_mode(mode: String) -> Envelope:
	return await _invoke("apiSetTeamMode", {"mode": mode})

func set_house(hero_id: String, house_id: String) -> Envelope:
	return await _invoke("apiSetHouse", {"heroId": hero_id, "houseId": house_id})

func adventure(hero_id: String, stage_id: int) -> Envelope:
	return await _invoke("apiAdventure", {"heroId": hero_id, "stageId": stage_id})

func daily_status() -> Envelope:
	return await _invoke("apiDailyStatus")

func claim(wait_receipt: bool) -> Envelope:
	return await _invoke("claim", {"waitForReceipt": wait_receipt}, Config.CLAIM_TIMEOUT_MS)

func connect_wallet(kind: String) -> Envelope:
	return await _invoke("connect", {"kind": kind}, Config.CLAIM_TIMEOUT_MS)

func sign_in() -> Envelope:
	return await _invoke("signIn", {}, Config.CLAIM_TIMEOUT_MS)

func reconnect() -> Envelope:
	return await _invoke("reconnect")

func disconnect_wallet() -> Envelope:
	return await _invoke("disconnect")

func config() -> Dictionary:
	var c: Variant = JSON.parse_string(str(_mb.configJson()))
	return c if c is Dictionary else {}

func session() -> Dictionary:
	var s: Variant = JSON.parse_string(str(_mb.sessionJson()))
	return s if s is Dictionary else {}

func notify_ready() -> void:
	_mb.ready()

func nav(target: String) -> void:
	_mb.nav(target)

## Call only from an input callback: window.open needs user activation.
func open_explorer(hash: String) -> void:
	_mb.openExplorer(hash)
