class_name Envelope
extends RefCounted
## Result of every backend call: {ok, data} or {ok:false, error, code}
## (mirrors client/src/bridge/envelope.ts; codes listed in design Appendix A).

var ok: bool = false
var data: Variant = null
var error: String = ""
var code: String = ""


static func success(d: Variant) -> Envelope:
	var e := Envelope.new()
	e.ok = true
	e.data = d
	return e


static func fail(c: String, msg: String) -> Envelope:
	var e := Envelope.new()
	e.ok = false
	e.code = c
	e.error = msg
	return e


## Parses an envelope JSON string. Anything that is not a dictionary with an "ok" key
## becomes fail("parse", first 120 chars of the input).
static func from_json(s: String) -> Envelope:
	var json := JSON.new()   # instance parse(): no engine error spam on malformed input
	if json.parse(s) != OK or typeof(json.data) != TYPE_DICTIONARY:
		return fail("parse", s.left(120))
	var d: Dictionary = json.data
	if not d.has("ok"):
		return fail("parse", s.left(120))
	if d["ok"] == true:
		return success(d.get("data"))
	var c: Variant = d.get("code")
	var msg: Variant = d.get("error")
	return fail(
		c if typeof(c) == TYPE_STRING and c != "" else "unknown",
		msg if typeof(msg) == TYPE_STRING else "unknown error"
	)


func to_dict() -> Dictionary:
	if ok:
		return {"ok": true, "data": data}
	return {"ok": false, "error": error, "code": code}


func _to_string() -> String:
	return "Envelope(ok)" if ok else "Envelope(%s: %s)" % [code, error]
