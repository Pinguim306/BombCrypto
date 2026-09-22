class_name Sheets
## Sprite-sheet helpers over godot/assets/art/manifest.json (written by
## tools/gen-art.mjs). Strips are horizontal: frame i at x = i * w. Final
## art replaces a PNG by file name; frame counts and animation ranges live in
## the manifest, so a longer walk cycle is a manifest edit, not a code change.

const MANIFEST_PATH := "res://assets/art/manifest.json"
const ART := "res://assets/art/"

static var _manifest: Dictionary = {}
static var _loaded := false
static var _frames_cache: Dictionary = {}     # path -> SpriteFrames
static var _atlas_cache: Dictionary = {}      # "path#i" -> AtlasTexture


static func manifest() -> Dictionary:
	if not _loaded:
		_loaded = true
		var text := FileAccess.get_file_as_string(MANIFEST_PATH)
		var parsed: Variant = JSON.parse_string(text) if text != "" else null
		if parsed is Dictionary and (parsed as Dictionary).has("files"):
			_manifest = (parsed as Dictionary)["files"]
		else:
			push_warning("Sheets: art manifest missing or invalid (%s)" % MANIFEST_PATH)
	return _manifest


## Manifest entry for "chars/hero_0.png" (relative to assets/art), {} if absent.
static func entry(rel: String) -> Dictionary:
	var m := manifest()
	return m.get(rel, {}) as Dictionary


static func texture(rel: String) -> Texture2D:
	return load(ART + rel) as Texture2D


## Frame i of a strip as an AtlasTexture (cached).
static func frame(rel: String, i: int) -> AtlasTexture:
	var key := "%s#%d" % [rel, i]
	if _atlas_cache.has(key):
		return _atlas_cache[key]
	var tex := texture(rel)
	var e := entry(rel)
	var w := int(e.get("w", tex.get_width() if tex != null else 0))
	var h := int(e.get("h", tex.get_height() if tex != null else 0))
	var n := int(e.get("frames", 1))
	var at := AtlasTexture.new()
	at.atlas = tex
	at.region = Rect2(clampi(i, 0, maxi(0, n - 1)) * w, 0, w, h)
	_atlas_cache[key] = at
	return at


static func frame_count(rel: String) -> int:
	return int(entry(rel).get("frames", 1))


static func frame_size(rel: String) -> Vector2i:
	var e := entry(rel)
	return Vector2i(int(e.get("w", 0)), int(e.get("h", 0)))


## SpriteFrames for a strip: one animation per manifest `anims` key (with
## `fps`), or a single looping "default" over every frame at `default_fps`.
static func frames(rel: String, default_fps := 8.0) -> SpriteFrames:
	if _frames_cache.has(rel):
		return _frames_cache[rel]
	var e := entry(rel)
	var n := int(e.get("frames", 1))
	var sf := SpriteFrames.new()
	sf.remove_animation(&"default")
	var anims: Dictionary = e.get("anims", {})
	var fps: Dictionary = e.get("fps", {})
	if anims.is_empty():
		anims = {"default": range(n)}
	for name: String in anims.keys():
		var sn := StringName(name)
		sf.add_animation(sn)
		sf.set_animation_speed(sn, float(fps.get(name, default_fps)))
		sf.set_animation_loop(sn, name != "throw")
		for idx: Variant in anims[name]:
			sf.add_frame(sn, frame(rel, int(idx)))
	_frames_cache[rel] = sf
	return sf


## Nine-slice margins [l, t, r, b] from the manifest (fallback: uniform m).
static func margins(rel: String, fallback := 8) -> Array[int]:
	var e := entry(rel)
	var out: Array[int] = []
	var m: Variant = e.get("margins", null)
	if m is Array and (m as Array).size() == 4:
		for v: Variant in m:
			out.append(int(v))
	else:
		out.assign([fallback, fallback, fallback, fallback])
	return out


## StyleBoxTexture for a 9-slice PNG (buttons, panels as Control styles).
static func stylebox(rel: String, fallback_margin := 8) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = texture(rel)
	var m := margins(rel, fallback_margin)
	sb.texture_margin_left = m[0]
	sb.texture_margin_top = m[1]
	sb.texture_margin_right = m[2]
	sb.texture_margin_bottom = m[3]
	sb.axis_stretch_horizontal = StyleBoxTexture.AXIS_STRETCH_MODE_TILE
	sb.axis_stretch_vertical = StyleBoxTexture.AXIS_STRETCH_MODE_TILE
	return sb


## Configures a NinePatchRect from a 9-slice PNG.
static func nine_patch(np: NinePatchRect, rel: String, fallback_margin := 8) -> void:
	np.texture = texture(rel)
	var m := margins(rel, fallback_margin)
	np.patch_margin_left = m[0]
	np.patch_margin_top = m[1]
	np.patch_margin_right = m[2]
	np.patch_margin_bottom = m[3]
	np.axis_stretch_horizontal = NinePatchRect.AXIS_STRETCH_MODE_TILE
	np.axis_stretch_vertical = NinePatchRect.AXIS_STRETCH_MODE_TILE


## `extra` block of an entry (e.g. house window / chimney positions).
static func extra(rel: String, key: String, fallback: Variant = null) -> Variant:
	var ex: Variant = entry(rel).get("extra", {})
	if ex is Dictionary and (ex as Dictionary).has(key):
		return (ex as Dictionary)[key]
	return fallback
