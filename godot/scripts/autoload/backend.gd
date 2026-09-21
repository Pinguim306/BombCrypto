extends Node
## Backend autoload — façade that picks the transport once at startup:
##   * WebBackend  — web build with a host page that installed window.mb
##   * MockBackend — editor / native / headless, `--mock`, or host `?mock=1`
## Everything else (GameState, scenes) only ever talks to this façade.

signal host_event(ev: Dictionary)

var impl: BackendBase
## Page link kept next to a MockBackend on web (?mock=1) so the host still
## gets ready()/nav()/openExplorer(); null when the mock runs without a host.
var _host: WebBackend = null
## True when Mock was picked on a real web build WITHOUT the host asking for
## it (window.mb missing) — main.gd shows a loud warning so it never ships silently.
var mock_fallback_on_web := false


func _ready() -> void:
	var host_cfg: Dictionary = {}
	if Config.is_web and WebBackend.available():
		var wb := WebBackend.new()
		wb.name = "WebBackend"
		host_cfg = wb.config()   # readable before entering the tree
		var host_mock := bool(host_cfg.get("mock", false))
		if host_mock or Config.mock_forced:
			# demo data (?mock=1): keep the page link for ready()/nav()/openExplorer()
			# only — host session/visibility events must not fight the mock
			wb.attach_listener = false
			_host = wb
			add_child(wb)
		else:
			add_child(wb)
			impl = wb
	if impl == null:
		var mb := MockBackend.new()
		mb.name = "MockBackend"
		add_child(mb)
		mb.set_scenario(Config.scenario)
		impl = mb
		mock_fallback_on_web = Config.is_web and _host == null and not Config.mock_forced
		if mock_fallback_on_web:
			push_error("window.mb missing on web: falling back to the MOCK backend (demo data)")
	if Config.is_web:
		print("Backend: transport=", "web" if impl is WebBackend else "mock",
			" host_link=", _host != null, " host_mock=", host_cfg.get("mock", false))
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
	(_host if _host != null else impl).notify_ready()

func nav(target: String) -> void:
	(_host if _host != null else impl).nav(target)

func open_explorer(hash: String) -> void:
	(_host if _host != null else impl).open_explorer(hash)
