class_name CounterLabel
extends Label
## Label whose number tweens toward its target (Juice.count_to), punching on
## increase and flashing red on decrease. `fmt(v: float) -> String` formats it.

var value := 0.0
var _tw: Tween


func _ready() -> void:
	pivot_offset = size / 2.0
	resized.connect(func() -> void: pivot_offset = size / 2.0)


func set_value(v: float, fmt: Callable, seconds := 0.6, punch := true) -> void:
	var from := value
	value = v
	if _tw != null and _tw.is_valid():
		_tw.kill()
	if Engine.is_editor_hint() or absf(v - from) < 0.000001:
		text = str(fmt.call(v))
		return
	_tw = Juice.count_to(self, from, v, seconds, fmt)
	if v > from:
		if punch:
			Juice.punch_scale(self, 0.12, 0.25)
		flash(Color("fff9c4"))
	elif v < from:
		flash(Color("ef9a9a"))


## Brief colour flash that settles back to the label's own colour.
func flash(c: Color) -> void:
	modulate = c
	var tw := create_tween()
	tw.tween_property(self, "modulate", Color.WHITE, 0.35)
