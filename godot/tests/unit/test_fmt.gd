extends RefCounted
## Fmt strings vs the Phaser catalogue (client/src/scenes/MiningScene.ts).

const T := preload("res://tests/test_runner.gd")


static func _hero(rarity: int, power: int, speed: int, stamina: int, stamina_max: int, mode := "work", house := "") -> HeroModel:
	var h := HeroModel.new()
	h.id = "chain-1"
	h.rarity = rarity
	h.power = power
	h.speed = speed
	h.stamina = stamina
	h.stamina_max = stamina_max
	h.mode = mode
	h.house_id = house
	return h


static func _house(rarity: int, occupants: int, capacity: int, bps: int) -> HouseModel:
	var h := HouseModel.new()
	h.id = "h-%d" % occupants
	h.rarity = rarity
	h.occupants = occupants
	h.capacity = capacity
	h.regen_boost_bps = bps
	return h


func test_thousands() -> void:
	T.eq(Fmt.thousands(30000), "30,000", "30000")
	T.eq(Fmt.thousands(999), "999", "999")
	T.eq(Fmt.thousands(1000), "1,000", "1000")
	T.eq(Fmt.thousands(1000000), "1,000,000", "1e6")
	T.eq(Fmt.thousands(0), "0", "zero")
	T.eq(Fmt.thousands(-1234), "-1,234", "negative")
	T.eq(Fmt.thousands(375), "375", "testnet min")


func test_blast2_and_pills() -> void:
	T.eq(Fmt.blast2(123.456789), "123.46", "blast2")
	T.eq(Fmt.blast2(0.0), "0.00", "blast2 zero")
	T.eq(Fmt.pending_pill(12.34, 30000), "12.34 BLAST · min 30,000", "pending pill")
	T.eq(Fmt.pending_pill(123.456789, 375), "123.46 BLAST · min 375", "pending pill testnet")
	T.eq(Fmt.rate_pill(4230.4), "~4,230 BLAST/h", "rate pill")
	T.eq(Fmt.rate_pill(0.0), "team idle · 0 BLAST/h", "rate idle")
	T.eq(Fmt.rate_pill(3846.825), "~3,847 BLAST/h", "rate rounding")


func test_hero_strings() -> void:
	var h := _hero(3, 41, 39, 40, 50)
	T.eq(Fmt.hero_name(h), "Epic P41 S39", "hero name")
	T.eq(Fmt.stamina_line(h), "stamina 40/50", "stamina line")
	T.eq(Fmt.hero_stats(h), "Power    41\nSpeed    39\nStamina  40/50\nMines    ~3,847 BLAST/h", "hero stats")
	T.eq(Fmt.status_line(h), "Status: mining", "status mining")
	T.eq(Fmt.mode_label(h), "mining", "mode label")
	h.mode = "rest"
	T.eq(Fmt.status_line(h), "Status: resting", "status resting")
	T.eq(Fmt.mode_label(h), "zZz resting", "mode label rest")
	T.eq(Fmt.hero_name(_hero(5, 92, 88, 1, 2)), "Mythic P92 S88", "mythic")
	T.eq(Fmt.hero_name(_hero(9, 1, 1, 1, 1)), "Common P1 S1", "unknown rarity falls back")


func test_houses_text() -> void:
	var none: Array[HouseModel] = []
	T.eq(Fmt.houses_text(none), "HOUSES:\nNo houses yet.\nBuy one in the Shop, then\nclick a hero and Shelter it.", "hint")
	var one: Array[HouseModel] = [_house(0, 1, 2, 2000)]
	T.eq(Fmt.houses_text(one), "HOUSES:\nCommon 1/2 · +20%", "one house")
	var two: Array[HouseModel] = [_house(0, 1, 2, 2000), _house(2, 3, 3, 3550)]
	T.eq(Fmt.houses_text(two), "HOUSES:\nCommon 1/2 · +20%\nS.Rare 3/3 · +35.5%", "fractional percent")
	var many: Array[HouseModel] = []
	for i in 8:
		many.append(_house(1, i, 2, 1000))
	var lines := Fmt.houses_text(many).split("\n")
	T.eq(lines.size(), 8, "6 lines + header + more")
	T.eq(lines[0], "HOUSES:", "header")
	T.eq(lines[6], "Rare 5/2 · +10%", "6th house")
	T.eq(lines[7], "…and 2 more", "overflow line")
	T.eq(Fmt.bps_percent(2000), "20", "bps 2000")
	T.eq(Fmt.bps_percent(2550), "25.5", "bps 2550")
	T.eq(Fmt.bps_percent(1234), "12.34", "bps 1234")
	T.eq(Fmt.bps_percent(5), "0.05", "bps 5")
	T.eq(Fmt.bps_percent(0), "0", "bps 0")


func test_stage_card_and_info_line() -> void:
	var s := StageModel.new()
	s.id = 0
	s.name = "Shallow Cavern"
	s.stamina_cost = 8
	s.min_rarity = 0
	s.reward_blast = "9.38"
	T.eq(Fmt.stage_card(s, true), "▶ Shallow Cavern\n9.38 BLAST · 8 stam", "selected card")
	T.eq(Fmt.stage_card(s, false), "Shallow Cavern\n9.38 BLAST · 8 stam", "unselected card")
	s.name = "Volcanic Core"
	s.reward_blast = "67.50"
	s.stamina_cost = 22
	T.eq(Fmt.stage_card(s, false), "Volcanic Core\n67.50 BLAST · 22 stam", "keeps trailing zero")
	T.eq(Fmt.info_line(2, 30000, 24), "adventures today: 2/10   withdraw: min 30,000 BLAST, every 24h", "info line")
	T.eq(Fmt.info_line(0, 375, 1), "adventures today: 0/10   withdraw: min 375 BLAST, every 1h", "info line testnet")


func test_status_messages() -> void:
	T.eq(Fmt.mine_all_msg(1), "1 hero sent to work! [img=12]res://assets/sprites/pick.png[/img]", "one hero")
	T.eq(Fmt.mine_all_msg(3), "3 heroes sent to work! [img=12]res://assets/sprites/pick.png[/img]", "plural")
	T.eq(Fmt.mine_all_msg(0), "everyone is already mining (or out of stamina)", "none")
	T.eq(Fmt.victory_msg("Deep Mine", 30187500, 57), "victory in Deep Mine! +30.19 BLAST (chance 57%)", "victory")
	T.eq(Fmt.victory_msg("Shallow Cavern", 9375000, 36), "victory in Shallow Cavern! +9.38 BLAST (chance 36%)", "victory 2")
	T.eq(Fmt.defeat_msg("Deep Mine", 57), "defeat in Deep Mine (chance was 57%) — half the stamina refunded", "defeat")
	T.eq(Fmt.error_msg("insufficient stamina"), "error: insufficient stamina", "error prefix")
	T.eq(Fmt.adventure_error("stage requires rarity 3+"), "adventure: stage requires rarity 3+", "adventure prefix")
	T.eq(Fmt.claim_failed("User rejected the request."), "claim failed: User rejected the request.", "claim failed")
	T.eq(Fmt.claim_sent("0xabc"), "claim sent: 0xabc", "claim sent")
	T.eq(Fmt.net_banner(4000), "connection problem — retrying in 4s", "net banner")
	T.eq(Fmt.net_banner(2500), "connection problem — retrying in 3s", "net banner ceil")
	T.eq(Fmt.pager(0, 3), "1/3", "pager")


func test_short_hash() -> void:
	T.eq(Fmt.short_hash("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd"), "0x1234…abcd", "short hash")
	T.eq(Fmt.short_hash("0x12"), "0x12", "short input untouched")
	T.eq(Fmt.short_hash(""), "", "empty")
