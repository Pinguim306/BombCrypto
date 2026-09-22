extends Camera2D
## Trauma-based screen shake (Juice.shake adds trauma): the offset is
## max_offset * trauma² * noise so small hits barely move and big ones kick.
## Camera stays at the origin (anchor top-left, no zoom) so World and Hud
## share the 960x540 space; only `offset` moves.

@export var max_offset := 6.0
@export var decay := 1.6       # trauma lost per second
@export var frequency := 28.0  # noise samples per second

var trauma := 0.0
var _t := 0.0
var _noise := FastNoiseLite.new()


func _ready() -> void:
	anchor_mode = Camera2D.ANCHOR_MODE_FIXED_TOP_LEFT
	position = Vector2.ZERO
	_noise.seed = 1337
	_noise.frequency = 1.0
	make_current()


func add_trauma(amount: float) -> void:
	trauma = clampf(trauma + amount, 0.0, 1.0)


func _process(delta: float) -> void:
	if trauma <= 0.0:
		if offset != Vector2.ZERO:
			offset = Vector2.ZERO
		return
	_t += delta * frequency
	var s := trauma * trauma * max_offset
	offset = Vector2(_noise.get_noise_2d(_t, 0.0), _noise.get_noise_2d(0.0, _t)) * s
	trauma = maxf(trauma - decay * delta, 0.0)
