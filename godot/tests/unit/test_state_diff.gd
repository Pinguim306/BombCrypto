extends RefCounted
## StateDiff.compute: block/hero deltas, claim gate, map regeneration rule.

const T := preload("res://tests/test_runner.gd")


static func _fixture(name: String) -> Dictionary:
	var text := FileAccess.get_file_as_string("res://resources/fixtures/state_%s.json" % name)
	return JSON.parse_string(text)


static func _state(name: String = "default") -> StateModel:
	return StateModel.parse(_fixture(name))


static func _clone(s: StateModel) -> StateModel:
	var c := StateModel.new()
	c.pending_str = s.pending_str
	c.pending = s.pending
	c.maps_cleared = s.maps_cleared
	c.chain_sync = s.chain_sync
	c.min_blast = s.min_blast
	c.cooldown_hours = s.cooldown_hours
	c.attempts_today = s.attempts_today
	c.stages = s.stages
	for b: BlockModel in s.blocks:
		var nb := BlockModel.new()
		nb.hp = b.hp
		nb.max_hp = b.max_hp
		c.blocks.append(nb)
	c.houses = s.houses
	for h: HeroModel in s.heroes:
		c.heroes.append(h.duplicate_model())
	return c


func test_first() -> void:
	var s := _state()
	var d := StateDiff.compute(null, s)
	T.ok(d.first, "prev null -> first")
	T.eq(d.pending_after, s.pending, "pending after")
	T.eq(d.pending_before, s.pending, "pending before == after on first")
	T.not_ok(d.map_regenerated, "no regen on first")
	T.eq(d.blocks_damaged.size(), 0, "no block deltas on first")
	T.ok(StateDiff.initial().first, "static initial()")
	T.ok(StateDiff.compute(s, null).first, "next null -> first")


func test_no_change() -> void:
	var a := _state()
	var b := _clone(a)
	var d := StateDiff.compute(a, b)
	T.not_ok(d.first, "not first")
	T.not_ok(d.has_block_changes(), "no block changes")
	T.not_ok(d.has_hero_changes(), "no hero changes")
	T.not_ok(d.map_regenerated, "no regen")
	T.not_ok(d.claim_gate_changed, "gate unchanged")
	T.eq(d.crack_changed.size(), 0, "no crack changes")


func test_block_deltas() -> void:
	var a := _state()
	var b := _clone(a)
	b.blocks[6].hp = 30          # 70 -> 30 (crack 0 -> 1)
	b.blocks[3].hp = 0           # 6 -> 0 destroyed
	b.blocks[0].hp = 21          # 0 -> 21 revived
	b.blocks[5].hp = 21          # unchanged
	var d := StateDiff.compute(a, b)
	T.eq(d.blocks_damaged, [6], "damaged")
	T.eq(d.blocks_destroyed, [3], "destroyed")
	T.eq(d.blocks_revived, [0], "revived")
	T.eq(d.crack_changed, [6], "crack changed on 6 only")
	T.not_ok(d.map_regenerated, "one revive is not a regen")
	T.ok(d.has_block_changes(), "has block changes")


func test_fresh_block_counts_as_revived() -> void:
	var a := _state()
	var b := _clone(a)
	b.blocks[6].max_hp = 95      # same index, new block with a different maxHp (regen mid-poll)
	b.blocks[6].hp = 95
	var d := StateDiff.compute(a, b)
	T.eq(d.blocks_revived, [6], "different maxHp while alive -> revived")


func test_map_regenerated_from_cleared_prev() -> void:
	var a := _state("almost_cleared")
	var b := _clone(a)
	a.blocks[39].hp = 0          # prev fully cleared (server hadn't regenerated yet)
	for i in 40:
		b.blocks[i].hp = b.blocks[i].max_hp
	b.blocks[0].hp -= 5
	var d := StateDiff.compute(a, b)
	T.ok(d.map_regenerated, "prev.first_alive == -1 -> regenerated")
	T.eq(d.blocks_revived.size(), 40, "all revived")


func test_map_regenerated_from_revive_count() -> void:
	var a := _state("almost_cleared")   # 39 dead, one alive
	var b := _clone(a)
	for i in 40:
		b.blocks[i].hp = b.blocks[i].max_hp
	var d := StateDiff.compute(a, b)
	T.ok(d.map_regenerated, ">= 20 revived -> regenerated")
	T.eq(d.blocks_revived.size(), 39, "39 dead revived; block 39 healed with the same maxHp is not a revive")
	T.eq(d.blocks_damaged.size(), 0, "healing is not damage")
	# fewer than 20 revived and prev had alive blocks -> not a regen
	var c := _clone(a)
	for i in 10:
		c.blocks[i].hp = c.blocks[i].max_hp
	d = StateDiff.compute(a, c)
	T.not_ok(d.map_regenerated, "10 revived is not a regen")
	T.eq(d.blocks_revived.size(), 10, "10 revived")


func test_both_cleared_is_not_regen() -> void:
	var a := _state("almost_cleared")
	a.blocks[39].hp = 0
	var b := _clone(a)
	var d := StateDiff.compute(a, b)
	T.not_ok(d.map_regenerated, "both cleared: nothing to animate")


func test_hero_deltas() -> void:
	var a := _state()
	var b := _clone(a)
	b.heroes[0].mode = "rest"            # chain-12 work -> rest
	b.heroes[1].stamina = 43             # chain-27 44 -> 43
	b.heroes.remove_at(2)                # chain-41 removed
	var extra := HeroModel.new()
	extra.id = "chain-99"
	extra.mode = "work"
	b.heroes.append(extra)
	var d := StateDiff.compute(a, b)
	T.eq(d.hero_mode_changed, ["chain-12"], "mode changed")
	T.eq(d.hero_stamina_changed, ["chain-27"], "stamina changed")
	T.eq(d.heroes_removed, ["chain-41"], "removed")
	T.eq(d.heroes_added, ["chain-99"], "added")
	T.ok(d.has_hero_changes(), "has hero changes")


func test_pending_and_claim_gate() -> void:
	var a := _state()
	var b := _clone(a)
	b.pending = 30000.0
	b.pending_str = "30000.000000"
	var d := StateDiff.compute(a, b)
	T.approx(d.pending_before, 123.456789, 1e-9, "before")
	T.eq(d.pending_after, 30000.0, "after")
	T.approx(d.pending_delta(), 30000.0 - 123.456789, 1e-6, "delta")
	T.ok(d.claim_gate_changed, "gate opened")
	var c := _clone(b)
	c.pending = 0.0
	d = StateDiff.compute(b, c)
	T.ok(d.claim_gate_changed, "gate closed after claim debit")
	T.ok(d.pending_delta() < 0.0, "negative delta")
	d = StateDiff.compute(b, _clone(b))
	T.not_ok(d.claim_gate_changed, "still open")
