class_name BackendBase
extends Node
## Abstract coroutine API shared by WebBackend (JavaScriptBridge) and MockBackend.
## Every async method returns an Envelope and takes primitives only. The base implementation
## answers fail("unsupported", ...) so a missing override is visible instead of a crash.

signal host_event(ev: Dictionary)          # {"type": "session"|"wallet"|"nav"|"visibility"|"online"|"claim", ...}


func is_mock() -> bool:
	return false


# ---- async (coroutines in subclasses; base returns synchronously, still awaitable) ----

func state() -> Envelope:
	return _unsupported("state")


func set_mode(_hero_id: String, _mode: String) -> Envelope:
	return _unsupported("set_mode")


func set_team_mode(_mode: String) -> Envelope:
	return _unsupported("set_team_mode")


## house_id "" == leave the current house.
func set_house(_hero_id: String, _house_id: String) -> Envelope:
	return _unsupported("set_house")


func adventure(_hero_id: String, _stage_id: int) -> Envelope:
	return _unsupported("adventure")


func daily_status() -> Envelope:
	return _unsupported("daily_status")


func claim(_wait_receipt: bool) -> Envelope:
	return _unsupported("claim")


func connect_wallet(_kind: String) -> Envelope:
	return _unsupported("connect_wallet")


func sign_in() -> Envelope:
	return _unsupported("sign_in")


func reconnect() -> Envelope:
	return _unsupported("reconnect")


## Named *_wallet because `disconnect` is Object.disconnect(signal, callable) and cannot be overridden.
func disconnect_wallet() -> Envelope:
	return _unsupported("disconnect_wallet")


# ---- sync ----

func config() -> Dictionary:
	return {}


func session() -> Dictionary:
	return {}


# ---- Godot -> host, void ----

func notify_ready() -> void:
	pass


func nav(_target: String) -> void:
	pass


func open_explorer(_hash: String) -> void:
	pass


func _unsupported(method: String) -> Envelope:
	return Envelope.fail("unsupported", "%s is not implemented by %s" % [method, get_class()])
