class_name TestRunner
extends SceneTree
## Headless unit-test runner (design §12 step 4):
##   $GODOT --headless --path godot -s res://tests/test_runner.gd
## Discovers res://tests/unit/test_*.gd — each `extends RefCounted` with `test_*` methods that
## call the static assert helpers below — prints "OK <n> tests" and exits 0, or lists every
## failure and exits 1.

const UNIT_DIR := "res://tests/unit"

static var failures: Array[String] = []
static var checks: int = 0
static var current: String = ""


func _initialize() -> void:
	var files := _discover()
	if files.is_empty():
		printerr("no tests found in %s" % UNIT_DIR)
		quit(1)
		return
	var total := 0
	var failed := 0
	for path: String in files:
		var script: GDScript = load(path)
		if script == null or not script.can_instantiate():
			failures.append("%s: failed to load" % path)
			failed += 1
			continue
		var names: Array[String] = []
		for m: Dictionary in script.get_script_method_list():
			var n: String = m["name"]
			if n.begins_with("test_") and not names.has(n):
				names.append(n)
		names.sort()
		for name: String in names:
			var inst: Object = script.new()
			current = "%s::%s" % [path.get_file(), name]
			var before := failures.size()
			inst.call(name)
			total += 1
			if failures.size() > before:
				failed += 1
	if failures.is_empty():
		print("OK %d tests (%d checks)" % [total, checks])
		quit(0)
	else:
		for f: String in failures:
			printerr("FAIL " + f)
		print("FAILED %d of %d tests (%d checks)" % [failed, total, checks])
		quit(1)


func _discover() -> Array[String]:
	var out: Array[String] = []
	for f: String in DirAccess.get_files_at(UNIT_DIR):
		var name := f
		if name.ends_with(".remap"):
			name = name.trim_suffix(".remap")
		if name.begins_with("test_") and (name.ends_with(".gd") or name.ends_with(".gdc")):
			var p := "%s/%s" % [UNIT_DIR, name.trim_suffix(".gdc") if name.ends_with(".gdc") else name]
			if name.ends_with(".gdc"):
				p = "%s/%s.gd" % [UNIT_DIR, name.trim_suffix(".gdc")]
			if not out.has(p):
				out.append(p)
	out.sort()
	return out


# ---- assert helpers (static, so test files stay plain RefCounted) ---------------

static func _record(msg: String) -> void:
	failures.append("%s: %s" % [current, msg])


static func ok(cond: bool, msg: String = "") -> bool:
	checks += 1
	if not cond:
		_record("expected true" + ((" — " + msg) if msg != "" else ""))
	return cond


static func not_ok(cond: bool, msg: String = "") -> bool:
	return ok(not cond, msg)


static func eq(actual: Variant, expected: Variant, msg: String = "") -> bool:
	checks += 1
	if typeof(actual) != typeof(expected) and not (_is_num(actual) and _is_num(expected)):
		_record("%s: type mismatch, expected %s (%s) got %s (%s)" % [msg, str(expected), type_string(typeof(expected)), str(actual), type_string(typeof(actual))])
		return false
	if actual != expected:
		_record("%s: expected %s got %s" % [msg, var_to_str(expected), var_to_str(actual)])
		return false
	return true


static func ne(actual: Variant, unexpected: Variant, msg: String = "") -> bool:
	checks += 1
	if actual == unexpected:
		_record("%s: expected something other than %s" % [msg, var_to_str(unexpected)])
		return false
	return true


static func approx(actual: float, expected: float, eps: float = 1e-6, msg: String = "") -> bool:
	checks += 1
	if absf(actual - expected) > eps:
		_record("%s: expected ~%f got %f" % [msg, expected, actual])
		return false
	return true


static func is_null(v: Variant, msg: String = "") -> bool:
	checks += 1
	if v != null:
		_record("%s: expected null got %s" % [msg, str(v)])
		return false
	return true


static func not_null(v: Variant, msg: String = "") -> bool:
	checks += 1
	if v == null:
		_record("%s: expected non-null" % msg)
		return false
	return true


static func contains(s: String, sub: String, msg: String = "") -> bool:
	checks += 1
	if not s.contains(sub):
		_record("%s: expected \"%s\" to contain \"%s\"" % [msg, s, sub])
		return false
	return true


static func fail(msg: String) -> void:
	checks += 1
	_record(msg)


static func _is_num(v: Variant) -> bool:
	return typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT
