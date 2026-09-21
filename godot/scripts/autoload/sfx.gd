extends Node
## Sfx autoload — sound hooks used by the scenes. The library is EMPTY in M1
## (no audio streams shipped yet), so every play() is a no-op until streams
## are registered; scene code can already call the hooks by name.
##
## Hook names in use: bomb_throw, bomb_land, explode, explode_big, crumble,
## coin, counter_tick, ui_hover, ui_click, ui_error, claim_sent, hero_work,
## hero_rest, hero_exhausted, map_regen, popup_open, popup_close.

const POOL_SIZE := 8

var library: Dictionary = {}          # StringName -> AudioStream
## Browsers only start audio after a user gesture inside the canvas.
var audio_unlocked := false
var _players: Array[AudioStreamPlayer] = []


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in POOL_SIZE:
		var p := AudioStreamPlayer.new()
		p.bus = "Master"
		add_child(p)
		_players.append(p)


func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton or event is InputEventScreenTouch or event is InputEventKey:
		audio_unlocked = true


## Plays a named stream on a free player with a little pitch variation.
func play(sound: StringName, pitch_jitter := 0.06) -> void:
	var stream: AudioStream = library.get(sound)
	if stream == null or not audio_unlocked:
		return
	for p in _players:
		if not p.playing:
			p.stream = stream
			p.pitch_scale = 1.0 + randf_range(-pitch_jitter, pitch_jitter)
			p.play()
			return
	# all busy: steal the first one
	_players[0].stream = stream
	_players[0].play()


func register(sound: StringName, stream: AudioStream) -> void:
	library[sound] = stream
