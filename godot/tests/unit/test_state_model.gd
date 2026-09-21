extends RefCounted
## StateModel.parse validation + helpers, against the committed fixtures.

const T := preload("res://tests/test_runner.gd")


static func _fixture(name: String) -> Dictionary:
	var text := FileAccess.get_file_as_string("res://resources/fixtures/state_%s.json" % name)
	var d: Variant = JSON.parse_string(text)
	return d if typeof(d) == TYPE_DICTIONARY else {}


func test_parse_default_fixture() -> void:
	var d := _fixture("default")
	T.not_ok(d.is_empty(), "fixture loads")
	var s := StateModel.parse(d)
	T.not_null(s, "parses: " + StateModel.last_error)
	if s == null:
		return
	T.eq(StateModel.last_error, "", "no error")
	T.eq(s.pending_str, "123.456789", "pending string kept")
	T.approx(s.pending, 123.456789, 1e-9, "pending float")
	T.eq(s.maps_cleared, 3, "maps cleared")
	T.eq(s.chain_sync, false, "chain sync")
	T.eq(s.min_blast, 30000, "min blast")
	T.eq(s.cooldown_hours, 24, "cooldown")
	T.eq(s.attempts_today, 2, "attempts")
	T.eq(s.stages.size(), 3, "stages")
	T.eq(s.stages[1].name, "Deep Mine", "stage name")
	T.eq(s.stages[2].reward_blast, "67.50", "reward string kept")
	T.eq(s.stages[2].min_rarity, 3, "min rarity")
	T.eq(s.stages[1].stamina_cost, 14, "stamina cost")
	T.eq(s.blocks.size(), 40, "40 blocks")
	T.eq(s.houses.size(), 1, "houses")
	T.eq(s.houses[0].id, "dev-house", "house id")
	T.eq(s.houses[0].occupants, 1, "occupants")
	T.eq(s.heroes.size(), 3, "heroes")
	# JSON numbers arrive as float; every numeric field must be an int after parse
	T.eq(typeof(s.heroes[0].power), TYPE_INT, "power is int")
	T.eq(typeof(s.blocks[3].hp), TYPE_INT, "hp is int")
	T.eq(typeof(s.min_blast), TYPE_INT, "min_blast is int")
	T.eq(typeof(s.houses[0].regen_boost_bps), TYPE_INT, "bps is int")
	T.eq(s.heroes[0].bomb_interval_ms, 3419, "bomb interval from DTO")
	T.ok(s.received_at_ms >= 0, "received_at set")


func test_helpers() -> void:
	var s := StateModel.parse(_fixture("default"))
	if not T.not_null(s, "parses"):
		return
	T.not_null(s.hero("chain-27"), "hero by id")
	T.eq(s.hero("chain-27").house_id, "dev-house", "housed hero")
	T.eq(s.hero("chain-41").house_id, "", "null houseId -> empty string")
	T.ok(s.hero("chain-27").is_housed(), "is_housed")
	T.is_null(s.hero("nope"), "missing hero")
	T.eq(s.first_alive_index(), 3, "first alive (0-2 dead)")
	T.eq(s.working_heroes().size(), 2, "working heroes")
	T.eq(s.working_heroes()[0].id, "chain-12", "working order preserved")
	T.not_null(s.free_house(), "free house")
	T.eq(s.free_house().id, "dev-house", "dev-house has a slot")
	s.houses[0].occupants = 2
	T.is_null(s.free_house(), "no free house when full")
	T.not_ok(s.can_claim(), "not claimable")
	T.eq(s.alive_count(), 37, "alive count")
	T.not_null(s.stage(2), "stage by id")
	T.is_null(s.stage(7), "missing stage")
	T.approx(s.team_rate(), Rules.team_rate(s.heroes), 1e-9, "team rate")


func test_other_fixtures() -> void:
	for name: String in ["empty", "rich", "claimable", "exhausted", "almost_cleared"]:
		var s := StateModel.parse(_fixture(name))
		T.not_null(s, "%s parses: %s" % [name, StateModel.last_error])
		if s == null:
			continue
		T.eq(s.blocks.size(), 40, "%s has 40 blocks" % name)
		T.eq(s.min_blast, 30000, "%s claim rules" % name)
		T.eq(s.stages.size(), 3, "%s stages" % name)
	var empty := StateModel.parse(_fixture("empty"))
	T.eq(empty.heroes.size(), 0, "empty has no heroes")
	T.eq(empty.houses.size(), 0, "empty has no houses")
	T.is_null(empty.free_house(), "empty free house")
	T.eq(empty.working_heroes().size(), 0, "empty working")
	var rich := StateModel.parse(_fixture("rich"))
	T.eq(rich.heroes.size(), 9, "rich has 9 heroes (pager)")
	T.eq(rich.houses.size(), 2, "rich houses")
	var claimable := StateModel.parse(_fixture("claimable"))
	T.ok(claimable.can_claim(), "claimable >= min")
	T.eq(claimable.pending_str, "30500.000000", "claimable pending")
	var exhausted := StateModel.parse(_fixture("exhausted"))
	T.eq(exhausted.working_heroes().size(), 0, "exhausted all resting")
	for h: HeroModel in exhausted.heroes:
		T.eq(h.stamina, 0, "exhausted stamina 0")
	var almost := StateModel.parse(_fixture("almost_cleared"))
	T.eq(almost.alive_count(), 1, "almost cleared: 1 alive")
	T.eq(almost.first_alive_index(), 39, "last block alive")


func test_invalid_inputs() -> void:
	T.is_null(StateModel.parse(null), "null")
	T.ne(StateModel.last_error, "", "error set for null")
	T.is_null(StateModel.parse("string"), "string")
	T.is_null(StateModel.parse([1, 2]), "array")
	T.is_null(StateModel.parse({}), "empty dict")

	var d := _fixture("default")
	var bad := d.duplicate(true)
	(bad["blocks"] as Array).pop_back()
	T.is_null(StateModel.parse(bad), "39 blocks")
	T.contains(StateModel.last_error, "blocks", "error mentions blocks")

	bad = d.duplicate(true)
	bad.erase("claimRules")
	T.is_null(StateModel.parse(bad), "missing claimRules")
	T.contains(StateModel.last_error, "claimRules", "error mentions claimRules")

	bad = d.duplicate(true)
	bad.erase("adventure")
	T.is_null(StateModel.parse(bad), "missing adventure")

	bad = d.duplicate(true)
	bad.erase("heroes")
	T.is_null(StateModel.parse(bad), "missing heroes")

	bad = d.duplicate(true)
	bad.erase("houses")
	T.is_null(StateModel.parse(bad), "missing houses")

	bad = d.duplicate(true)
	(bad["heroes"] as Array)[0]["mode"] = "sleep"
	T.is_null(StateModel.parse(bad), "bad mode")
	T.contains(StateModel.last_error, "mode", "error mentions mode")

	bad = d.duplicate(true)
	(bad["heroes"] as Array)[0]["power"] = "41"
	T.is_null(StateModel.parse(bad), "string power")

	bad = d.duplicate(true)
	(bad["blocks"] as Array)[5] = {"hp": "x", "maxHp": 10}
	T.is_null(StateModel.parse(bad), "string hp")

	bad = d.duplicate(true)
	bad["claimRules"] = {"minBlast": "30000", "cooldownHours": 24}
	T.is_null(StateModel.parse(bad), "string minBlast")

	bad = d.duplicate(true)
	bad["pendingBlast"] = "abc"
	T.is_null(StateModel.parse(bad), "non-numeric pending")

	bad = d.duplicate(true)
	(bad["heroes"] as Array)[0]["houseId"] = 5
	T.is_null(StateModel.parse(bad), "numeric houseId")


func test_lenient_inputs() -> void:
	var d := _fixture("default")
	var ok := d.duplicate(true)
	ok["pendingBlast"] = 12.5
	var s := StateModel.parse(ok)
	T.not_null(s, "numeric pendingBlast tolerated")
	T.eq(s.pending_str, "12.500000", "numeric pending normalised")
	ok = d.duplicate(true)
	(ok["heroes"] as Array)[0].erase("bombIntervalMs")
	s = StateModel.parse(ok)
	T.not_null(s, "missing bombIntervalMs tolerated")
	T.eq(s.heroes[0].bomb_interval_ms, 3419, "computed from speed 17")
	ok = d.duplicate(true)
	ok.erase("mapsCleared")
	ok.erase("chainSync")
	s = StateModel.parse(ok)
	T.not_null(s, "optional scalars default")
	T.eq(s.maps_cleared, 0, "mapsCleared default")


func test_round_trip_from_mock_server() -> void:
	var server := Scenarios.build("default")
	var dto := server.state_dto()
	var s := StateModel.parse(dto)
	T.not_null(s, "mock DTO parses: " + StateModel.last_error)
	if s == null:
		return
	T.eq(s.pending_str, "123.456789", "pending round trip")
	T.eq(s.heroes.size(), 3, "heroes round trip")
	T.eq(s.hero("chain-27").house_id, "dev-house", "house round trip")
	# and through JSON (floats everywhere) too
	var s2 := StateModel.parse(JSON.parse_string(JSON.stringify(dto)))
	T.not_null(s2, "JSON round trip parses")
	T.eq(typeof(s2.heroes[0].stamina), TYPE_INT, "int after JSON")
