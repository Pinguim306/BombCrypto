extends RefCounted
## MockServer vs server/src/game/{engine,adventure,streak}.ts, game.service.ts and
## rewards/rewards.service.ts. Virtual clock starts at a fixed instant for determinism.

const T := preload("res://tests/test_runner.gd")
const START_MS := 1_758_000_000_000   # 2025-09-16T05:20:00Z, mid-day so day rollovers are explicit
const DAY := 86_400_000
const HOUR := 3_600_000


static func _fixture(name: String) -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_string("res://resources/fixtures/state_%s.json" % name))


static func _server(name: String = "default") -> MockServer:
	return MockServer.from_dto(_fixture(name), 1, START_MS)


## Bare server: full map (seed 5), no heroes/houses, pending 0.
static func _bare() -> MockServer:
	var s := MockServer.new(5, START_MS)
	s.blocks = MockServer.generate_map(5)
	return s


static func _hero(dto: Dictionary, id: String) -> Dictionary:
	for h: Dictionary in dto["heroes"]:
		if h["id"] == id:
			return h
	return {}


func test_mulberry32_parity_with_fixture() -> void:
	# state_default.json blocks were generated with engine.ts generateMap(7)
	var expected: Array = _fixture("default")["blocks"]
	var got := MockServer.generate_map(7)
	T.eq(got.size(), 40, "40 blocks")
	for i in 40:
		T.eq(got[i].max_hp, int(expected[i]["maxHp"]), "maxHp[%d] matches node mulberry32" % i)
		T.eq(got[i].hp, got[i].max_hp, "fresh block full")


func test_map_tiers_in_range() -> void:
	var counts := [0, 0, 0]
	for seed in range(100, 130):
		for b: MockServer.EngineBlock in MockServer.generate_map(seed):
			T.ok(b.max_hp >= 20 and b.max_hp <= 119, "maxHp in 20..119")
			counts[Rules.block_tier(b.max_hp)] += 1
	T.ok(counts[0] > counts[1] and counts[1] > counts[2], "tier distribution 60/30/10-ish: %s" % [counts])


func test_state_dto_shape() -> void:
	var s := _server()
	var d := s.state_dto()
	for key: String in ["pendingBlast", "mapsCleared", "chainSync", "claimRules", "adventure", "blocks", "houses", "heroes"]:
		T.ok(d.has(key), "has " + key)
	T.eq(d["pendingBlast"], "123.456789", "pendingBlast 6 decimals")
	T.eq(typeof(d["pendingBlast"]), TYPE_STRING, "pendingBlast is a string")
	T.eq(d["claimRules"], {"minBlast": 30000, "cooldownHours": 24}, "claim rules")
	T.eq(d["adventure"]["attemptsToday"], 2, "attempts")
	T.eq((d["adventure"]["stages"] as Array).size(), 3, "stages")
	T.eq(d["adventure"]["stages"][0], {"id": 0, "name": "Shallow Cavern", "staminaCost": 8, "minRarity": 0, "rewardBlast": "9.38"}, "stage 0")
	T.eq(d["adventure"]["stages"][2]["rewardBlast"], "67.50", "stage 2 reward")
	T.eq((d["blocks"] as Array).size(), 40, "blocks")
	T.eq(d["blocks"][3], {"hp": 6, "maxHp": 27}, "block 3")
	T.eq(d["houses"][0], {"id": "dev-house", "rarity": 0, "capacity": 2, "regenBoostBps": 2000, "occupants": 1}, "house dto")
	var h := _hero(d, "chain-27")
	T.eq(h, {"id": "chain-27", "rarity": 1, "power": 31, "speed": 28, "stamina": 44, "staminaMax": 60, "mode": "work", "houseId": "dev-house", "bombIntervalMs": 3125}, "hero dto")
	T.is_null(_hero(d, "chain-41")["houseId"], "unhoused -> null")
	T.eq(_hero(d, "chain-12")["bombIntervalMs"], 3419, "interval rounded")
	T.not_null(StateModel.parse(d), "DTO validates: " + StateModel.last_error)
	T.eq(MockServer.micro_to_blast_str(9_375_000, 2), "9.38", "toFixed(2) half up")
	T.eq(MockServer.micro_to_blast_str(26_250_000, 2), "26.25", "toFixed(2)")
	T.eq(MockServer.micro_to_blast_str(0, 6), "0.000000", "zero")
	T.eq(MockServer.micro_to_blast_str(30_500_000_000, 6), "30500.000000", "large")
	T.eq(MockServer.blast_str_to_micro("123.456789"), 123_456_789, "parse micro")
	T.eq(MockServer.blast_str_to_micro("30500"), 30_500_000_000, "parse whole")
	T.eq(MockServer.blast_str_to_micro("9.38"), 9_380_000, "parse short fraction")


func test_work_loop_first_alive_and_reward() -> void:
	var s := _bare()
	s.add_hero("a", 0, 10, 0, 3.0, 40, "work")   # interval 4000 ms, 3 bombs of stamina
	var max0 := s.blocks[0].max_hp
	s.advance(3999)
	T.eq(s.blocks[0].hp, max0, "no bomb before the interval")
	s.advance(1)
	T.eq(s.blocks[0].hp, max0 - 10, "first bomb hits block 0 for min(power, hp)")
	T.eq(s.pending_micro, 10 * 75_000, "0.75 BLAST per 10 hp")
	T.eq(s.state_dto()["pendingBlast"], "0.750000", "pending string")
	T.eq(_hero(s.state_dto(), "a")["stamina"], 2, "stamina -1 per bomb")
	s.advance(8000)
	T.eq(s.blocks[0].hp, max0 - 30, "three bombs total")
	T.eq(_hero(s.state_dto(), "a")["mode"], "rest", "auto-rest at stamina < 1")
	T.eq(_hero(s.state_dto(), "a")["stamina"], 0, "stamina 0")
	s.advance(40_000)
	T.eq(s.blocks[0].hp, max0 - 30, "no bombs while resting")


func test_cadence_survives_frequent_observation() -> void:
	# advanced every ~16 ms (MockBackend._process) and polled every 2 s, bombs must still land
	# every bombIntervalMs (the real server resets simulatedTo on each advance — see mock_server.gd)
	var s := _bare()
	s.add_hero("a", 0, 10, 0, 40.0, 40, "work")
	var max0 := s.blocks[0].max_hp
	for i in 250:   # 250 * 16 ms = 4000 ms
		s.advance(16)
	T.eq(s.blocks[0].hp, max0 - 10, "exactly one bomb after 4000 ms of 16 ms steps")
	for i in 125:
		s.advance(16)
	T.eq(s.blocks[0].hp, max0 - 10, "none at 6000 ms")
	for i in 125:
		s.advance(16)
	T.eq(s.blocks[0].hp, max0 - 20, "second bomb at 8000 ms")


func test_damage_capped_and_targets_advance() -> void:
	var s := _bare()
	s.blocks[0].hp = 4
	s.add_hero("a", 0, 10, 0, 40.0, 40, "work")
	s.advance(4000)
	T.eq(s.blocks[0].hp, 0, "block 0 destroyed")
	T.eq(s.pending_micro, 4 * 75_000, "reward = actual damage (4), not power")
	var max1 := s.blocks[1].max_hp
	s.advance(4000)
	T.eq(s.blocks[1].hp, max1 - 10, "next bomb targets the next alive block")


func test_speed_interval() -> void:
	var s := _bare()
	s.add_hero("a", 0, 5, 100, 40.0, 40, "work")   # 4000/(1+1) = 2000 ms
	s.advance(6000)
	T.eq(s.blocks[0].hp, s.blocks[0].max_hp - 15, "3 bombs at speed 100 in 6 s")
	T.eq(_hero(s.state_dto(), "a")["bombIntervalMs"], 2000, "interval dto")


func test_hero_order_by_id() -> void:
	# both heroes hit block 0 (hp 5): the lexicographically first id lands first and earns 5, the other 0
	var s := _bare()
	s.blocks[0].hp = 5
	s.add_hero("zeta", 0, 10, 0, 40.0, 40, "work")
	s.add_hero("alpha", 0, 10, 0, 40.0, 40, "work")
	s.advance(4000)
	T.eq(s.blocks[0].hp, 0, "block 0 dead")
	T.eq(s.blocks[1].hp, s.blocks[1].max_hp - 10, "second hero moved on to block 1")
	T.eq(s.pending_micro, 15 * 75_000, "5 + 10 hp of reward")


func test_rest_regen_and_boost() -> void:
	var s := _bare()
	s.add_hero("a", 0, 10, 0, 0.0, 40, "rest")
	s.advance(600_000)   # 10 min of a 20 min full rest
	T.eq(_hero(s.state_dto(), "a")["stamina"], 20, "half regenerated")
	s.advance(600_000)
	T.eq(_hero(s.state_dto(), "a")["stamina"], 40, "full")
	s.advance(600_000)
	T.eq(_hero(s.state_dto(), "a")["stamina"], 40, "capped at max")
	var b := _bare()
	b.add_house("dev-house", 0, 2, 2000)
	b.add_hero("a", 0, 10, 0, 0.0, 40, "rest", "dev-house")
	b.advance(600_000)
	T.eq(_hero(b.state_dto(), "a")["stamina"], 24, "+20% boost: 20 * 1.2")
	T.eq(_hero(b.state_dto(), "a")["houseId"], "dev-house", "housed")
	T.eq(b.state_dto()["houses"][0]["occupants"], 1, "occupants counted")


func test_map_regeneration() -> void:
	var s := _server("almost_cleared")   # 39 dead, block 39 hp 5, heroes working
	T.eq(s.maps_cleared, 7, "fixture maps cleared")
	s.clear_map()
	T.eq(s.alive_count(), 0, "cleared")
	s.advance(4000)   # every hero's interval < 4000 ms and > 2000 ms: exactly one bomb each
	T.eq(s.maps_cleared, 8, "mapsCleared++ on regen")
	T.ok(s.alive_count() >= 38, "fresh map; 3 bombs on block 0 may spill into block 1")
	T.ok(s.blocks[0].hp < s.blocks[0].max_hp, "first bomb after regen hits block 0")
	var dealt := 0
	for b: MockServer.EngineBlock in s.blocks:
		dealt += b.max_hp - b.hp
	T.ok(dealt > 0 and dealt <= 14 + 31 + 41, "damage capped by hp (excess never spills): %d" % dealt)
	var d := s.state_dto()
	T.eq(_hero(d, "chain-12")["stamina"], 25, "chain-12 threw once (26 -> 25)")
	T.eq(_hero(d, "chain-27")["stamina"], 54, "chain-27 threw once (55 -> 54)")
	T.eq(_hero(d, "chain-41")["stamina"], 46, "chain-41 threw once (47 -> 46)")
	T.eq(d["mapsCleared"], 8, "dto mapsCleared")
	T.ok(StateModel.parse(d).alive_count() >= 38, "dto alive")
	T.eq(d["pendingBlast"], MockServer.micro_to_blast_str(2_310_125_000 + dealt * 75_000, 6), "reward = actual damage * 0.075")


func test_set_mode() -> void:
	var s := _server()
	T.eq(s.set_mode("nope", "work"), {"error": "Not Found"}, "unknown hero")
	T.eq(s.set_mode("chain-12", "sleep"), {"error": "mode must be work or rest"}, "bad mode")
	var d := s.set_mode("chain-41", "work")
	T.not_ok(d.has("error"), "ok")
	T.eq(_hero(d, "chain-41")["mode"], "work", "now working")
	s.drain_stamina()
	T.eq(s.set_mode("chain-41", "work"), {"error": "insufficient stamina"}, "exhausted -> error")
	d = s.set_mode("chain-41", "rest")
	T.eq(_hero(d, "chain-41")["mode"], "rest", "rest always allowed")


func test_set_team_mode() -> void:
	var s := _server()   # chain-12 work, chain-27 work, chain-41 rest
	var d := s.set_team_mode("work")
	T.eq(d["changed"], 1, "one hero flipped")
	T.not_null(StateModel.parse(d), "dto + changed still validates")
	d = s.set_team_mode("work")
	T.eq(d["changed"], 0, "everyone already mining")
	d = s.set_team_mode("rest")
	T.eq(d["changed"], 3, "all rested")
	s.heroes[0].stamina = 0.0
	d = s.set_team_mode("work")
	T.eq(d["changed"], 2, "exhausted hero skipped, not an error")
	T.eq(_hero(d, "chain-12")["mode"], "rest", "exhausted stays resting")
	T.eq(s.set_team_mode("x"), {"error": "mode must be work or rest"}, "bad mode")


func test_set_house() -> void:
	var s := _server()   # dev-house capacity 2, chain-27 inside
	T.eq(s.set_house("nope", "dev-house"), {"error": "hero not found"}, "hero not found")
	T.eq(s.set_house("chain-12", "villa"), {"error": "house not found"}, "house not found")
	var d := s.set_house("chain-12", "dev-house")
	T.eq(_hero(d, "chain-12")["houseId"], "dev-house", "housed")
	T.eq(d["houses"][0]["occupants"], 2, "2 occupants")
	T.eq(s.set_house("chain-41", "dev-house"), {"error": "house is full"}, "full")
	d = s.set_house("chain-27", "dev-house")
	T.not_ok(d.has("error"), "re-housing an occupant is not 'full'")
	d = s.set_house("chain-27", "")
	T.is_null(_hero(d, "chain-27")["houseId"], "left")
	T.eq(d["houses"][0]["occupants"], 1, "1 occupant")
	T.eq(s._hero("chain-27").regen_boost_bps, 0, "boost cleared")
	T.eq(s._hero("chain-12").regen_boost_bps, 2000, "boost applied")


func test_adventure_gates() -> void:
	var s := _server()
	T.eq(s.adventure("nope", 0), {"error": "hero not found"}, "hero not found")
	T.eq(s.adventure("chain-12", 9), {"error": "stage not found"}, "stage not found")
	T.eq(s.adventure("chain-12", 2), {"error": "stage requires rarity 3+"}, "rarity gate")
	T.eq(s.adventure("chain-12", 1), {"error": "stage requires rarity 1+"}, "rarity gate 1")
	s._hero("chain-12").stamina = 7.0
	T.eq(s.adventure("chain-12", 0), {"error": "insufficient stamina for the adventure"}, "stamina gate (cost 8)")
	s.attempts_today = 10
	T.eq(s.adventure("chain-41", 0), {"error": "daily adventure limit reached"}, "daily limit")
	s.jump(DAY)
	s.forced_rand = 0.99
	var r := s.adventure("chain-41", 0)
	T.not_ok(r.has("error"), "limit resets on a new day")
	T.eq(r["attemptsLeft"], 9, "attempts reset then consumed")
	T.eq(r["state"]["adventure"]["attemptsToday"], 1, "dto attemptsToday")


func test_adventure_outcomes() -> void:
	var s := _server()   # chain-41: Epic P41 -> effective 59.45; Deep Mine difficulty 60
	var chance := 59.45 / (59.45 + 60.0)
	s.forced_rand = chance - 0.001
	var win := s.adventure("chain-41", 1)
	T.eq(win["success"], true, "win")
	T.eq(win["stage"], "Deep Mine", "stage name")
	T.eq(win["staminaSpent"], 14, "full cost")
	T.eq(win["rewardMicro"], roundi(26_250_000 * 1.45), "reward with rarity bonus")
	T.eq(win["successChance"], 50, "chance rounded to %")
	T.eq(win["attemptsLeft"], 7, "10 - 3")
	T.eq(_hero(win["state"], "chain-41")["stamina"], 26, "40 - 14")
	T.eq(win["state"]["pendingBlast"], MockServer.micro_to_blast_str(123_456_789 + roundi(26_250_000 * 1.45), 6), "pending credited")
	T.not_null(StateModel.parse(win["state"]), "result state validates")

	s.forced_rand = chance + 0.001
	var loss := s.adventure("chain-41", 1)
	T.eq(loss["success"], false, "loss")
	T.eq(loss["rewardMicro"], 0, "no reward")
	T.eq(loss["staminaSpent"], 7, "ceil(14 * .5) refunded half")
	T.eq(_hero(loss["state"], "chain-41")["stamina"], 19, "26 - 7")
	T.eq(loss["attemptsLeft"], 6, "attempts")

	# a defeat that drains stamina below 1 flips the hero to rest
	s._hero("chain-41").stamina = 22.0
	s._hero("chain-41").mode = "work"
	s.forced_rand = 0.0
	var r := s.adventure("chain-41", 2)
	T.eq(r["success"], true, "forced win")
	T.eq(_hero(r["state"], "chain-41")["mode"], "rest", "auto-rest after spending all stamina")
	T.eq(Fmt.victory_msg(r["stage"], r["rewardMicro"], r["successChance"]), "victory in Volcanic Core! +97.88 BLAST (chance 33%)", "status text")


func test_daily_streak() -> void:
	var s := _server()
	var st := s.daily_status()
	T.eq(st, {"claimedToday": false, "streak": 0, "nextDay": 1, "hasHero": true, "canClaim": true,
		"rewards": [2000, 3000, 4000, 6000, 8000, 12000, 20000], "jackpotChance": 25, "jackpotBlast": 40000}, "fresh status")
	s.forced_rand = 0.9
	var c := s.claim_daily()
	T.eq(c["claim"], {"count": 1, "baseBlast": 2000, "jackpot": false, "jackpotBlast": 0, "totalBlast": 2000, "rewardMicro": 2_000_000_000}, "day 1 claim")
	T.eq(c["state"]["pendingBlast"], "2123.456789", "pending credited")
	T.eq(s.claim_daily(), {"error": "daily reward already claimed today — come back tomorrow"}, "double claim")
	st = s.daily_status()
	T.eq(st["claimedToday"], true, "claimed today")
	T.eq(st["canClaim"], false, "cannot claim")
	T.eq(st["streak"], 1, "streak 1")
	T.eq(st["nextDay"], 1, "nextDay stays on the claimed day")
	s.jump(DAY)
	st = s.daily_status()
	T.eq(st["claimedToday"], false, "new day")
	T.eq(st["streak"], 1, "streak kept")
	T.eq(st["nextDay"], 2, "next is day 2")
	s.forced_rand = 0.9
	T.eq(s.claim_daily()["claim"]["count"], 2, "day 2")
	s.jump(2 * DAY)   # missed a day
	st = s.daily_status()
	T.eq(st["streak"], 0, "lapsed")
	T.eq(st["nextDay"], 1, "restart")
	# day 7 jackpot
	for i in 7:
		s.forced_rand = 0.9
		s.claim_daily()
		s.jump(DAY)
	s.streak_count = 6
	s.streak_day = MockServer.current_day(s.now_ms) - 1
	s.forced_rand = 0.1
	var j := s.claim_daily()
	T.eq(j["claim"]["count"], 7, "day 7")
	T.eq(j["claim"]["jackpot"], true, "jackpot hit")
	T.eq(j["claim"]["totalBlast"], 60000, "20000 + 40000")
	var e := _server("empty")
	T.eq(e.daily_status()["canClaim"], false, "no hero -> cannot claim")
	T.eq(e.daily_status()["hasHero"], false, "hasHero false")
	T.eq(e.claim_daily(), {"error": "you need at least one hero to claim the daily reward"}, "no hero claim error")


func test_voucher_minimum() -> void:
	var s := _server()   # 123.456789 < 30,000
	T.eq(s.voucher(), {"error": "minimum claim is 30,000 BLAST"}, "min error")
	T.eq(s.state_dto()["pendingBlast"], "123.456789", "refunded, nothing debited")
	T.eq(s.last_voucher_at_ms, 0, "no cooldown started")
	s.min_blast = 375
	s.set_pending(374.999999)
	T.eq(s.voucher(), {"error": "minimum claim is 375 BLAST"}, "testnet min text")


func test_voucher_issue_represent_cooldown() -> void:
	var s := _server("claimable")   # 30500 pending
	s.set_team_mode("rest")         # no mining income during the time jumps below
	var v := s.voucher()
	T.not_ok(v.has("error"), "issued")
	T.eq(v["amount"], "30500000000000000000000", "30500 BLAST in wei (micro * 1e12)")
	T.eq(v["nonce"], "0", "nonce string")
	T.eq(v["deadline"], START_MS / 1000 + 3600, "deadline now + 1h")
	T.eq(v["chainId"], 4663, "chain id")
	T.eq(v["vault"], MockServer.VAULT_ADDRESS, "vault")
	T.ok(String(v["signature"]).begins_with("0x") and String(v["signature"]).length() == 132, "signature shape")
	T.eq(s.state_dto()["pendingBlast"], "0.000000", "pending debited")
	# re-presented within the TTL, no second debit even with new pending
	s.add_pending(500.0)
	var again := s.voucher()
	T.eq(again, v, "same voucher re-presented")
	T.eq(s.state_dto()["pendingBlast"], "500.000000", "no second debit")
	# after the claim confirms, the cooldown applies to the next voucher
	s.mark_voucher_claimed()
	s.add_pending(31000.0)
	T.eq(s.voucher(), {"error": "claim cooldown active — try again in ~1440 min"}, "cooldown 24h")
	s.jump(61_000)
	T.eq(s.voucher(), {"error": "claim cooldown active — try again in ~1439 min"}, "cooldown ceil minutes")
	s.jump(24 * HOUR)
	var third := s.voucher()
	T.eq(third["nonce"], "1", "next nonce after the cooldown")
	T.eq(third["amount"], "31500000000000000000000", "31500 BLAST")


func test_voucher_expired_refund() -> void:
	var s := _server("claimable")
	s.set_team_mode("rest")
	var v := s.voucher()
	T.not_ok(v.has("error"), "issued")
	s.jump(3601 * 1000)   # voucher expired unclaimed
	T.eq(s.voucher().get("error", ""), "claim cooldown active — try again in ~1380 min", "refund + cooldown still counted")
	T.eq(s.state_dto()["pendingBlast"], "30500.000000", "expired voucher refunded")


func test_hooks() -> void:
	var s := _server()
	s.kill_block(5)
	T.eq(s.blocks[5].hp, 0, "kill_block")
	s.kill_block(99)
	s.add_pending(1000.5)
	T.eq(s.state_dto()["pendingBlast"], "1123.956789", "add_pending")
	s.set_pending(30001.0)
	T.eq(s.state_dto()["pendingBlast"], "30001.000000", "set_pending")
	s.drain_stamina()
	for h: Dictionary in s.state_dto()["heroes"]:
		T.eq(h["stamina"], 0, "drained")
		T.eq(h["mode"], "rest", "resting")
	s.add_heroes(5)
	T.eq(s.heroes.size(), 8, "+5 heroes")
	var ids: Dictionary = {}
	for h: MockServer.EngineHero in s.heroes:
		ids[h.id] = true
		T.ok(h.rarity >= 0 and h.rarity <= 5, "rarity range")
		T.ok(h.stamina_max > 0, "stamina max")
	T.eq(ids.size(), 8, "unique ids")
	T.not_null(StateModel.parse(s.state_dto()), "dto still validates")
	s.clear_map()
	T.eq(s.alive_count(), 0, "clear_map")


func test_time_scale_and_jump() -> void:
	var s := _bare()
	s.time_scale = 10.0
	s.advance(1000)
	T.eq(s.now_ms, START_MS + 10_000, "advance scales")
	s.jump(500)
	T.eq(s.now_ms, START_MS + 10_500, "jump does not scale")


func test_scenarios_build() -> void:
	for name: String in Scenarios.NAMES:
		var srv := Scenarios.build(name)
		T.not_null(srv, name + " builds")
		var d := srv.state_dto()
		T.not_null(StateModel.parse(d), "%s dto validates: %s" % [name, StateModel.last_error])
	T.eq(Scenarios.build("empty").heroes.size(), 0, "empty")
	T.eq(Scenarios.build("rich").heroes.size(), 9, "rich")
	T.eq(Scenarios.build("flaky").state_dto()["pendingBlast"], "123.456789", "flaky uses default fixture")
	T.eq(Scenarios.build("expired").heroes.size(), 3, "expired uses default fixture")
	T.eq(Scenarios.fixture_path("flaky"), "res://resources/fixtures/state_default.json", "alias path")
	T.eq(Scenarios.build("claimable").state_dto()["pendingBlast"], "30500.000000", "claimable")
	T.eq(Scenarios.build("almost_cleared").alive_count(), 1, "almost cleared")
	T.not_ok(Scenarios.is_valid("bogus"), "unknown name")
	T.eq(Scenarios.build("bogus").heroes.size(), 3, "unknown falls back to default")


func test_reset_default_fallback() -> void:
	var s := MockServer.new(3, START_MS)
	s.reset_default()
	T.eq(s.heroes.size(), 3, "3 dev heroes")
	T.eq(s.houses.size(), 1, "dev house")
	T.eq(s.blocks.size(), 40, "map")
	T.not_null(StateModel.parse(s.state_dto()), "validates")
