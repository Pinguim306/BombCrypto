extends RefCounted
## Envelope parsing of the bridge JSON contract.

const T := preload("res://tests/test_runner.gd")


func test_success_from_json() -> void:
	var e := Envelope.from_json('{"ok":true,"data":{"changed":2,"heroes":[]}}')
	T.ok(e.ok, "ok")
	T.eq(e.error, "", "no error")
	T.eq(e.code, "", "no code")
	T.eq(typeof(e.data), TYPE_DICTIONARY, "data dict")
	T.eq(int(e.data["changed"]), 2, "data content")


func test_success_null_data() -> void:
	var e := Envelope.from_json('{"ok":true,"data":null}')
	T.ok(e.ok, "ok with null data")
	T.is_null(e.data, "null data")


func test_failure_from_json() -> void:
	var e := Envelope.from_json('{"ok":false,"error":"session expired","code":"session_expired"}')
	T.not_ok(e.ok, "not ok")
	T.eq(e.error, "session expired", "error")
	T.eq(e.code, "session_expired", "code")
	T.is_null(e.data, "no data")


func test_failure_defaults() -> void:
	var e := Envelope.from_json('{"ok":false}')
	T.not_ok(e.ok, "not ok")
	T.eq(e.code, "unknown", "code default")
	T.eq(e.error, "unknown error", "error default")


func test_parse_errors() -> void:
	var e := Envelope.from_json("not json at all")
	T.not_ok(e.ok, "invalid json")
	T.eq(e.code, "parse", "parse code")
	T.eq(e.error, "not json at all", "raw text")
	e = Envelope.from_json("[1,2,3]")
	T.eq(e.code, "parse", "array is not an envelope")
	e = Envelope.from_json('{"data":1}')
	T.eq(e.code, "parse", "missing ok")
	var long := "x".repeat(300)
	e = Envelope.from_json(long)
	T.eq(e.error.length(), 120, "truncated to 120")
	e = Envelope.from_json("")
	T.eq(e.code, "parse", "empty string")


func test_constructors() -> void:
	var f := Envelope.fail("network", "Failed to fetch")
	T.not_ok(f.ok, "fail")
	T.eq(f.code, "network", "fail code")
	T.eq(f.error, "Failed to fetch", "fail error")
	T.eq(f.to_dict(), {"ok": false, "error": "Failed to fetch", "code": "network"}, "fail dict")
	var s := Envelope.success({"a": 1})
	T.ok(s.ok, "success")
	T.eq(s.to_dict(), {"ok": true, "data": {"a": 1}}, "success dict")
	var round := Envelope.from_json(JSON.stringify(s.to_dict()))
	T.ok(round.ok, "round trip")
	T.eq(int(round.data["a"]), 1, "round trip data")
