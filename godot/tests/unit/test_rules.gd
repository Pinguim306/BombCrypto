extends RefCounted
## Rules: tiers, dead variants, crack levels, rates, claim gate, grid geometry.

const T := preload("res://tests/test_runner.gd")


static func _hero(power: int, speed: int, mode: String) -> HeroModel:
	var h := HeroModel.new()
	h.power = power
	h.speed = speed
	h.mode = mode
	return h


func test_block_tier() -> void:
	T.eq(Rules.block_tier(20), 0, "20")
	T.eq(Rules.block_tier(49), 0, "49")
	T.eq(Rules.block_tier(50), 1, "50")
	T.eq(Rules.block_tier(89), 1, "89")
	T.eq(Rules.block_tier(90), 2, "90")
	T.eq(Rules.block_tier(119), 2, "119")


func test_dead_variant() -> void:
	var crystals: Array[int] = []
	for i in 40:
		if Rules.dead_variant(i) == "block_dead2":
			crystals.append(i)
		else:
			T.eq(Rules.dead_variant(i), "block_dead", "plain dead %d" % i)
	T.eq(crystals, [1, 6, 11, 16, 21, 26, 31, 36], "crystal indices")


func test_crack_level() -> void:
	T.eq(Rules.crack_level(100, 100), 0, "full")
	T.eq(Rules.crack_level(66, 100), 0, ".66 exactly")
	T.eq(Rules.crack_level(65, 100), 1, ".65")
	T.eq(Rules.crack_level(33, 100), 1, ".33 exactly")
	T.eq(Rules.crack_level(32, 100), 2, ".32")
	T.eq(Rules.crack_level(0, 100), 0, "dead -> 0")
	T.eq(Rules.crack_level(5, 0), 0, "invalid max")
	var b := BlockModel.new()
	b.hp = 6
	b.max_hp = 27
	T.eq(b.crack_level(), 2, "block model delegates")
	T.eq(b.tier(), 0, "block tier")
	T.approx(b.ratio(), 6.0 / 27.0, 1e-9, "ratio")
	T.ok(b.alive(), "alive")
	b.hp = 0
	T.not_ok(b.alive(), "dead")


func test_rates() -> void:
	T.approx(Rules.hero_rate(_hero(41, 39, "work")), 3846.825, 1e-6, "hero rate")
	T.approx(Rules.hero_rate(_hero(10, 0, "rest")), 675.0, 1e-6, "hero rate speed 0")
	T.eq(Rules.hero_rate(null), 0.0, "null hero")
	var team: Array[HeroModel] = [_hero(41, 39, "work"), _hero(14, 17, "rest"), _hero(31, 28, "work")]
	T.approx(Rules.team_rate(team), 3846.825 + 67.5 * 31 * 1.28, 1e-6, "team rate only work")
	var idle: Array[HeroModel] = [_hero(41, 39, "rest")]
	T.eq(Rules.team_rate(idle), 0.0, "idle team")


func test_can_claim() -> void:
	T.ok(Rules.can_claim(30000.0, 30000), "equal")
	T.ok(Rules.can_claim(30500.0, 30000), "above")
	T.not_ok(Rules.can_claim(29999.999, 30000), "below")


func test_geometry() -> void:
	T.eq(Rules.BLOCK_COUNT, 40, "block count")


func test_bomb_interval_and_first_alive() -> void:
	T.eq(Rules.bomb_interval_ms(0), 4000, "speed 0")
	T.eq(Rules.bomb_interval_ms(39), 2878, "speed 39")
	T.eq(Rules.bomb_interval_ms(17), 3419, "speed 17")
	var blocks: Array[BlockModel] = []
	for i in 5:
		var b := BlockModel.new()
		b.hp = 0 if i < 3 else 10
		b.max_hp = 10
		blocks.append(b)
	T.eq(Rules.first_alive(blocks), 3, "first alive")
	blocks[3].hp = 0
	blocks[4].hp = 0
	T.eq(Rules.first_alive(blocks), -1, "none alive")
	T.eq(Rules.rarity_name(3), "Epic", "rarity name")
	T.eq(Rules.rarity_name(42), "Common", "rarity name out of range")
