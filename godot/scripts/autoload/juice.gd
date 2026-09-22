extends Node
## Juice autoload — screen shake, hit-stop, light flashes, punches, floating
## text, counters and toasts. Every amount is multiplied by Config.juice_scale()
## so "reduced motion" turns the whole layer down with a single flag, and
## nothing here is required for correctness: scenes render from state, then
## call Juice for feel.

const MAX_FLOATS := 12
const OUTLINE := Color("0a0e18")

var _camera: Camera2D = null          # Camera2D with camera_shake.gd (add_trauma)
var _flash_pool: Node2D = null        # PointLight2D children, reused round-robin
var _flash_i := 0
var _hitstop_until_ms := 0
var _floats: Array[Label] = []
var _toast_layer: CanvasLayer
var _toast: Label = null
var _toast_tw: Tween = null


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_toast_layer = CanvasLayer.new()
	_toast_layer.layer = 50
	add_child(_toast_layer)


func register_camera(cam: Camera2D) -> void:
	_camera = cam


func register_flash_pool(pool: Node2D) -> void:
	_flash_pool = pool
	_flash_i = 0


## Adds trauma to the registered camera (offset = 6px * trauma² * noise).
func shake(trauma_add: float) -> void:
	if is_instance_valid(_camera) and _camera.has_method("add_trauma"):
		_camera.call("add_trauma", trauma_add * Config.juice_scale())


## Brief Engine.time_scale dip. Overlapping calls coalesce to the longest stop.
func hitstop(seconds: float, scale := 0.05) -> void:
	if Config.juice_scale() == 0.0:
		return
	var until := Time.get_ticks_msec() + int(seconds * 1000.0)
	if until <= _hitstop_until_ms:
		return
	_hitstop_until_ms = until
	Engine.time_scale = scale
	# process_always + ignore_time_scale so the timer itself is not slowed
	var t := get_tree().create_timer(seconds, true, false, true)
	t.timeout.connect(func() -> void:
		if Time.get_ticks_msec() >= _hitstop_until_ms - 1:
			Engine.time_scale = 1.0)


## Pooled PointLight2D flash at a world position, decaying to zero.
func flash_light(pos: Vector2, color: Color, energy: float, seconds: float) -> void:
	if _flash_pool == null or not Config.fx_enabled or not Config.fancy_lights:
		return
	var n := _flash_pool.get_child_count()
	if n == 0:
		return
	var light := _flash_pool.get_child(_flash_i % n) as PointLight2D
	_flash_i += 1
	if light == null:
		return
	light.global_position = pos
	light.color = color
	light.energy = energy * Config.juice_scale()
	var tw := light.create_tween()   # bound to the light node
	tw.tween_property(light, "energy", 0.0, seconds).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)


## Quick scale pop on any Node2D/Control (both expose `scale`). Punches on
## the same node are exclusive and remember the true resting scale, so
## overlapping punches (two block deaths inside 200 ms) never compound.
func punch_scale(node: CanvasItem, amount := 0.12, seconds := 0.18) -> Tween:
	# get_meta() with a null default still errors when the key is absent
	if node.has_meta("punch_tw"):
		var prev: Variant = node.get_meta("punch_tw")
		if prev is Tween and (prev as Tween).is_valid():
			(prev as Tween).kill()
			node.set("scale", node.get_meta("punch_base"))   # restore before re-reading
	var base: Vector2 = node.get("scale")
	node.set_meta("punch_base", base)
	var tw := node.create_tween()   # bound to the node: dies with it
	node.set_meta("punch_tw", tw)
	tw.tween_property(node, "scale", base * (1.0 + amount * Config.juice_scale()), seconds * 0.35) \
		.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(node, "scale", base, seconds * 0.65).set_trans(Tween.TRANS_SINE)
	tw.tween_callback(func() -> void:
		if is_instance_valid(node):
			node.remove_meta("punch_tw"))
	return tw


## Rising, fading label ("+0.83", "-12") spawned under `layer`. Capped at MAX_FLOATS.
func float_text(layer: Node2D, pos: Vector2, text: String, color: Color) -> void:
	if not Config.fx_enabled or layer == null:
		return
	if _floats.size() >= MAX_FLOATS:
		var old: Label = _floats.pop_front()
		if is_instance_valid(old):
			old.queue_free()
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", OUTLINE)
	l.add_theme_constant_override("outline_size", 3)
	l.z_index = 100
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(l)
	l.position = pos - Vector2(l.size.x * 0.5, 10.0)
	_floats.append(l)
	var tw := l.create_tween()   # bound to the label: freeing it kills the tween
	tw.set_parallel(true)
	tw.tween_property(l, "position:y", pos.y - 40.0, 0.85).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(l, "modulate:a", 0.0, 0.5).set_delay(0.35)
	tw.chain().tween_callback(func() -> void:
		_floats.erase(l)
		if is_instance_valid(l):
			l.queue_free())


## Tweens a number and formats it into a Label via `fmt(value: float) -> String`.
func count_to(label: Label, from: float, to: float, seconds: float, fmt: Callable) -> Tween:
	var tw := label.create_tween()   # bound to the label
	tw.tween_method(func(v: float) -> void:
		if is_instance_valid(label):
			label.text = str(fmt.call(v)), from, to, seconds) \
		.set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	return tw


## Calls fn(node) on each node with a growing delay.
func stagger(nodes: Array, fn: Callable, step := 0.04) -> void:
	for i in nodes.size():
		var n: Variant = nodes[i]
		if i == 0 or Config.juice_scale() == 0.0:
			fn.call(n)
		else:
			get_tree().create_timer(i * step).timeout.connect(func() -> void:
				if is_instance_valid(n):
					fn.call(n))


## Top-centre banner text ("NEW VEIN DISCOVERED"); a new toast replaces the old one.
func toast(text: String, seconds := 3.0) -> void:
	# kill the previous tween BEFORE freeing its label, otherwise its
	# callback would run against a freed capture
	if _toast_tw != null and _toast_tw.is_valid():
		_toast_tw.kill()
	if is_instance_valid(_toast):
		_toast.queue_free()
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", 16)
	l.add_theme_color_override("font_color", Color("ffcf80"))
	l.add_theme_color_override("font_outline_color", OUTLINE)
	l.add_theme_constant_override("outline_size", 4)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	l.size = Vector2(Layout.VIEW.x, 30)
	l.position = Vector2(0, 58)
	l.modulate.a = 0.0
	_toast_layer.add_child(l)
	_toast = l
	var tw := l.create_tween()   # bound to the label: dies with it
	_toast_tw = tw
	tw.tween_property(l, "modulate:a", 1.0, 0.2)
	tw.tween_property(l, "position:y", 64.0, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_interval(seconds)
	tw.tween_property(l, "modulate:a", 0.0, 0.3)
	tw.tween_callback(func() -> void:
		if is_instance_valid(l):
			l.queue_free())
