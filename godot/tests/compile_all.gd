extends Node
## Compiles every .gd under res:// (except tests/, tools/, export/) with the
## project's AUTOLOADS PRESENT — run as a scene, not with `-s`, because Godot
## only instantiates autoloads for a real main loop:
##
##   godot --headless --path godot res://tests/compile_all.tscn
##
## Prints "OK compiled <n>" and exits 0, or the failing paths and exits 1
## (Godot also prints a SCRIPT ERROR line per failure).

const SKIP := ["res://tests/", "res://tools/", "res://export/"]


func _ready() -> void:
	var files: Array[String] = []
	_walk("res://", files)
	files.sort()
	var failed: Array[String] = []
	for p in files:
		# CACHE_MODE_REUSE: autoloads and their helpers are already live; a
		# script with errors loads as an invalid GDScript (can_instantiate false)
		var res: Resource = ResourceLoader.load(p, "GDScript", ResourceLoader.CACHE_MODE_REUSE)
		var gd := res as GDScript
		if gd == null:
			failed.append(p + " (load failed)")
		elif not gd.can_instantiate():
			failed.append(p + " (compile error)")
	if failed.is_empty():
		print("OK compiled %d scripts" % files.size())
		get_tree().quit(0)
	else:
		for f in failed:
			print("FAIL " + f)
		print("FAILED %d of %d scripts" % [failed.size(), files.size()])
		get_tree().quit(1)


func _walk(dir: String, out: Array[String]) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	d.list_dir_begin()
	var name := d.get_next()
	while name != "":
		var path := dir.path_join(name)
		if d.current_is_dir():
			if not name.begins_with(".") and not SKIP.has(path + "/"):
				_walk(path, out)
		elif name.ends_with(".gd"):
			out.append(path)
		name = d.get_next()
	d.list_dir_end()
