extends Node
## Backend autoload — façade that picks the transport once at startup:
##   * WebBackend  — web build with a host page that installed window.mb
##   * MockBackend — editor / native / headless, `--mock`, or host `?mock=1`
## Everything else (GameState, scenes) only ever talks to this façade.

signal host_event(ev: Dictionary)

var impl: BackendBase
## True when Mock was picked on a real web build WITHOUT the host asking for
## it (window.mb missing) — main.gd shows a loud warning so it never ships silently.
var mock_fallback_on_web := false


func _ready() -> void:
	var host_cfg: Dictionary = {}
	if Config.is_web and not Config.mock_forced and WebBackend.available():
		var wb := WebBackend.new()
		wb.name = "WebBackend"
		add_child(wb)
		host_cfg = wb.config()
		if bool(host_cfg.get("mock", false)):
			wb.queue_free()          # host asked for demo data (?mock=1)
		else:
			impl = wb
	if impl == null:
		var mb := MockBackend.new()
		mb.name = "MockBackend"
		add_child(mb)
		mb.set_scenario(Config.scenario)
		impl = mb
		mock_fallback_on_web = Config.is_web and not Config.mock_forced \
			and not bool(host_cfg.get("mock", false))
		if mock_fallback_on_web:
			push_error("window.mb missing on web: falling back to the MOCK backend (demo data)")
	impl.host_event.connect(func(ev: Dictionary) -> void: host_event.emit(ev))


func is_mock() -> bool:
	return impl != null and impl.is_mock()


# ---- one-line forwards of the BackendBase API ----

func state() -> Envelope:
	return await impl.state()

func set_mode(hero_id: String, mode: String) -> Envelope:
	return await impl.set_mode(hero_id, mode)

func set_team_mode(mode: String) -> Envelope:
	return await impl.set_team_mode(mode)

func set_house(hero_id: String, house_id: String) -> Envelope:
	return await impl.set_house(hero_id, house_id)

func adventure(hero_id: String, stage_id: int) -> Envelope:
	return await impl.adventure(hero_id, stage_id)

func daily_status() -> Envelope:
	return await impl.daily_status()

func claim(wait_receipt: bool) -> Envelope:
	return await impl.claim(wait_receipt)

func connect_wallet(kind: String) -> Envelope:
	return await impl.connect_wallet(kind)

func sign_in() -> Envelope:
	return await impl.sign_in()

func reconnect() -> Envelope:
	return await impl.reconnect()

## Named *_wallet: `disconnect` is Object.disconnect(signal, callable).
func disconnect_wallet() -> Envelope:
	return await impl.disconnect_wallet()

func config() -> Dictionary:
	return impl.config()

func session() -> Dictionary:
	return impl.session()

func notify_ready() -> void:
	impl.notify_ready()

func nav(target: String) -> void:
	impl.nav(target)

func open_explorer(hash: String) -> void:
	impl.open_explorer(hash)
