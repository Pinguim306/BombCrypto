extends Node
## Root controller: applies the host config, wires host events into
## GameState, swaps the active screen by phase, and tells the host page when
## Godot is up (mb.ready()). F1 toggles the dev panel outside the web build.

const MINING_SCENE_PATH := "res://scenes/mine/mine.tscn"
const DEBUG_PANEL_PATH := "res://scenes/ui/debug_panel.tscn"

@onready var screens: Node = $Screens
@onready var waiting: Control = $Screens/Waiting
@onready var waiting_label: Label = $Screens/Waiting/Label
@onready var waiting_cave: TextureRect = $Screens/Waiting/Cave
@onready var waiting_logo: TextureRect = $Screens/Waiting/Logo
@onready var waiting_hero: AnimatedSprite2D = $Screens/Waiting/Hero
@onready var loader: CanvasLayer = $Loader
@onready var loader_logo: TextureRect = $Loader/Logo
@onready var loader_walker: AnimatedSprite2D = $Loader/Walker
@onready var overlay: CanvasLayer = $Overlay

var _mining: Node = null
var _debug_panel: Control = null


func _ready() -> void:
	_dress()
	Config.apply_host_config(Backend.config())
	GameState.phase_changed.connect(_on_phase)
	GameState.state_applied.connect(_on_state_applied)
	Backend.host_event.connect(GameState._on_host_event)
	if Backend.mock_fallback_on_web:
		Juice.toast("MOCK BACKEND (demo data)", 6.0)
	GameState.start()
	_on_phase(GameState.phase, GameState.Phase.BOOT)
	Backend.notify_ready()   # last: the host hides its loader on this


## Title / loader dressing: logo, dimmed cave, an idle hero and a walker.
func _dress() -> void:
	waiting_cave.texture = Sheets.texture("env/map_bg.png")
	waiting_logo.texture = Sheets.texture("ui/logo.png")
	loader_logo.texture = Sheets.texture("ui/logo.png")
	waiting_hero.sprite_frames = Sheets.frames("chars/hero_2.png")
	waiting_hero.play(&"idle")
	loader_walker.sprite_frames = Sheets.frames("chars/hero_4.png")
	loader_walker.play(&"walk")


func _on_phase(p: int, _prev: int) -> void:
	match p:
		GameState.Phase.LOADING, GameState.Phase.LIVE, GameState.Phase.DEGRADED, \
		GameState.Phase.OFFLINE, GameState.Phase.HIDDEN:
			_ensure_mining()
			waiting.visible = false
			loader.visible = GameState.state == null
		GameState.Phase.LOGGED_OUT, GameState.Phase.SESSION_EXPIRED:
			_free_mining()
			waiting_label.text = "session expired — sign in again" \
				if p == GameState.Phase.SESSION_EXPIRED else "connect your wallet above to start mining"
			waiting.visible = true
			loader.visible = false
		_:
			pass


func _on_state_applied(_s: StateModel, _d: StateDiff) -> void:
	loader.visible = false


func _ensure_mining() -> void:
	if _mining != null and is_instance_valid(_mining):
		return
	var packed: PackedScene = load(MINING_SCENE_PATH)
	if packed == null:
		push_error("mining scene missing: " + MINING_SCENE_PATH)
		return
	_mining = packed.instantiate()
	screens.add_child(_mining)


func _free_mining() -> void:
	if _mining != null and is_instance_valid(_mining):
		_mining.queue_free()
	_mining = null


func _unhandled_input(event: InputEvent) -> void:
	if not Config.dev_tools:
		return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F1:
		_toggle_debug_panel()


func _toggle_debug_panel() -> void:
	if _debug_panel == null or not is_instance_valid(_debug_panel):
		var packed: PackedScene = load(DEBUG_PANEL_PATH)
		if packed == null:
			return
		_debug_panel = packed.instantiate()
		overlay.add_child(_debug_panel)
		return
	_debug_panel.visible = not _debug_panel.visible
