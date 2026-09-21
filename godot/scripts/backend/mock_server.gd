class_name MockServer
extends RefCounted
## In-process port of the real server on a VIRTUAL clock, used by MockBackend (editor / ?mock=1).
##   engine.ts      — lazy work loop, rest regen, auto-rest, mulberry32 map generation (bit-exact)
##   adventure.ts   — daily limit, rarity/stamina gates, chance p/(p+difficulty), defeat refund
##   streak.ts      — daily login streak status/claim
##   game.service.ts — exact GameStateDto shape (pendingBlast 6-decimal string, floored stamina,
##                     bombIntervalMs rounded), setMode/setTeamMode/setHouse/adventure/daily
##   rewards.service.ts — voucher: re-present pending voucher, cooldown, min claim, debit/refund
## Every API method returns a Dictionary; server-side errors are `{"error": "<verbatim message>"}`.

# ---- balancing (engine.ts / adventure.ts / streak.ts / config.ts) ----
const BOMB_BASE_INTERVAL_MS := 4000
const REST_FULL_MS := 20 * 60_000
const MAP_COLS := 8
const MAP_ROWS := 5
const BLOCK_COUNT := MAP_COLS * MAP_ROWS
const REWARD_MICRO_PER_HP := 75_000
const DAILY_ATTEMPT_LIMIT := 10
const DEFEAT_STAMINA_REFUND := 0.5
const STREAK_BLAST := [2_000, 3_000, 4_000, 6_000, 8_000, 12_000, 20_000]
const STREAK_LEN := 7
const JACKPOT_CHANCE := 0.25
const JACKPOT_BLAST := 40_000
const VOUCHER_TTL_S := 3600
const DAY_MS := 86_400_000
const DEFAULT_MIN_BLAST := 30_000
const DEFAULT_COOLDOWN_HOURS := 24
const CHAIN_ID := 4663
const VAULT_ADDRESS := "0x0000000000000000000000000000000000000000"
const DEV_HOUSE := {"id": "dev-house", "rarity": 0, "capacity": 2, "regenBoostBps": 2000}

const STAGES := [
	{"id": 0, "name": "Shallow Cavern", "difficulty": 25, "staminaCost": 8, "rewardMicro": 9_375_000, "minRarity": 0},
	{"id": 1, "name": "Deep Mine", "difficulty": 60, "staminaCost": 14, "rewardMicro": 26_250_000, "minRarity": 1},
	{"id": 2, "name": "Volcanic Core", "difficulty": 120, "staminaCost": 22, "rewardMicro": 67_500_000, "minRarity": 3},
]

# ---- error strings (verbatim) ----
const ERR_MODE := "mode must be work or rest"
const ERR_NOT_FOUND := "Not Found"
const ERR_STAMINA := "insufficient stamina"
const ERR_HERO_NOT_FOUND := "hero not found"
const ERR_HOUSE_NOT_FOUND := "house not found"
const ERR_HOUSE_FULL := "house is full"
const ERR_STAGE_NOT_FOUND := "stage not found"
const ERR_ADV_LIMIT := "daily adventure limit reached"
const ERR_ADV_STAMINA := "insufficient stamina for the adventure"
const ERR_DAILY_NO_HERO := "you need at least one hero to claim the daily reward"
const ERR_DAILY_CLAIMED := "daily reward already claimed today — come back tomorrow"


## engine.ts EngineHero (fractional stamina, simulatedTo in ms).
class EngineHero extends RefCounted:
	var id: String = ""
	var rarity: int = 0
	var power: int = 1
	var speed: int = 0
	var stamina_max: int = 1
	var stamina: float = 0.0
	var mode: String = "rest"
	var simulated_to: float = 0.0
	var house_id: String = ""
	var regen_boost_bps: int = 0

	func interval_ms() -> float:
		return BOMB_BASE_INTERVAL_MS / (1.0 + speed / 100.0)

	func effective_power() -> float:
		return power * (1.0 + rarity * 0.15)


class EngineBlock extends RefCounted:
	var hp: int = 0
	var max_hp: int = 1

	func _init(p_max: int = 1, p_hp: int = -1) -> void:
		max_hp = p_max
		hp = p_max if p_hp < 0 else p_hp


class House extends RefCounted:
	var id: String = ""
	var rarity: int = 0
	var capacity: int = 0
	var regen_boost_bps: int = 0


## Bit-exact port of engine.ts rng(seed) (mulberry32) on 64-bit ints masked to 32 bits.
class Mulberry extends RefCounted:
	var a: int = 0

	func _init(seed: int) -> void:
		a = seed & 0xFFFFFFFF

	static func imul(x: int, y: int) -> int:
		return (x * y) & 0xFFFFFFFF

	func next() -> float:
		a = (a + 0x6d2b79f5) & 0xFFFFFFFF
		var t := imul(a ^ (a >> 15), 1 | a)
		t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
		return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


# ---- virtual clock ----
var now_ms: int = 0
var rng := RandomNumberGenerator.new()
var time_scale := 1.0
## When >= 0, the next adventure/daily roll uses this value instead of the RNG (tests, DebugPanel).
var forced_rand := -1.0

# ---- player state ----
var heroes: Array[EngineHero] = []
var blocks: Array[EngineBlock] = []
var houses: Array[House] = []
var stages: Array[Dictionary] = []
var map_seed: int = 1000
var maps_cleared: int = 0
var pending_micro: int = 0
var chain_sync := false
var min_blast: int = DEFAULT_MIN_BLAST
var cooldown_hours: int = DEFAULT_COOLDOWN_HOURS
var adventure_day: int = 0
var attempts_today: int = 0
var has_streak := false
var streak_day: int = 0
var streak_count: int = 0
var last_voucher_at_ms: int = 0        # 0 = never issued
var pending_voucher: Dictionary = {}   # {amountMicro, amountWei, nonce, deadline, signature}
var _next_nonce: int = 0
var _hero_counter: int = 0


func _init(seed: int = 1, start_ms: int = -1) -> void:
	rng.seed = seed
	map_seed = seed * 1000
	now_ms = start_ms if start_ms >= 0 else int(Time.get_unix_time_from_system() * 1000.0)
	adventure_day = current_day(now_ms)
	for s: Dictionary in STAGES:
		stages.append(s.duplicate())


## Convenience: a server pre-loaded from a GameStateDto dictionary (fixture).
static func from_dto(d: Dictionary, seed: int = 1, start_ms: int = -1) -> MockServer:
	var s := MockServer.new(seed, start_ms)
	if not s.load_state(d):
		s.reset_default()
	return s


static func current_day(ms: int) -> int:
	return ms / DAY_MS


## engine.ts generateMap: 60% 20-49, 30% 50-89, 10% 90-119 (tiers 0/1/2).
static func generate_map(seed: int) -> Array[EngineBlock]:
	var rand := Mulberry.new(seed)
	var out: Array[EngineBlock] = []
	for i in BLOCK_COUNT:
		var roll := rand.next()
		var max_hp: int
		if roll < 0.6:
			max_hp = 20 + floori(rand.next() * 30)
		elif roll < 0.9:
			max_hp = 50 + floori(rand.next() * 40)
		else:
			max_hp = 90 + floori(rand.next() * 30)
		out.append(EngineBlock.new(max_hp))
	return out


# =====================================================================
# Virtual time
# =====================================================================

## Moves the clock by real delta * time_scale and simulates up to it.
func advance(dt_ms: int) -> void:
	now_ms += int(round(dt_ms * time_scale))
	_simulate()


## Moves the clock by exactly dt_ms virtual milliseconds (DebugPanel "+10 min").
func jump(dt_ms: int) -> void:
	now_ms += dt_ms
	_simulate()


## engine.ts advance(): heroes in id order, each only if behind the clock.
func _simulate() -> void:
	var order := heroes.duplicate()
	order.sort_custom(func(a: EngineHero, b: EngineHero) -> bool: return a.id < b.id)
	for h: EngineHero in order:
		if h.simulated_to < now_ms:
			pending_micro += _advance_hero(h, now_ms)


## engine.ts advanceHero(): returns micro-BLAST earned in the period.
func _advance_hero(h: EngineHero, now: int) -> int:
	if h.mode == "rest":
		var dt := float(now) - h.simulated_to
		var boost := 1.0 + h.regen_boost_bps / 10000.0
		h.stamina = minf(float(h.stamina_max), h.stamina + (dt / REST_FULL_MS) * h.stamina_max * boost)
		h.simulated_to = now
		return 0
	var interval := h.interval_ms()
	var earned := 0
	while h.simulated_to + interval <= now and h.stamina >= 1.0:
		h.simulated_to += interval
		var target := _first_alive()
		if target == -1:
			maps_cleared += 1
			map_seed += 1
			blocks = generate_map(map_seed)
			target = 0
		var block := blocks[target]
		var damage := mini(h.power, block.hp)
		block.hp -= damage
		earned += damage * REWARD_MICRO_PER_HP
		h.stamina -= 1.0
	if h.stamina < 1.0:
		h.mode = "rest"   # out of stamina: automatically switches to rest
		h.simulated_to = now
	# DELIBERATE DEVIATION from engine.ts L127 (`hero.simulatedTo = now` after the loop): the
	# server discards the partial interval on every advance(), so a hero observed more often
	# than its bombIntervalMs never throws. The mock is advanced every frame and polled every
	# 2 s, so it keeps the remainder and throws at the exact cadence (design §9 / BombSim).
	return earned


func _first_alive() -> int:
	for i in blocks.size():
		if blocks[i].hp > 0:
			return i
	return -1


# =====================================================================
# DTO (game.service.ts state())
# =====================================================================

func state_dto() -> Dictionary:
	_simulate()
	var day := current_day(now_ms)
	var blocks_dto: Array = []
	for b: EngineBlock in blocks:
		blocks_dto.append({"hp": b.hp, "maxHp": b.max_hp})
	var houses_dto: Array = []
	for hs: House in houses:
		houses_dto.append({
			"id": hs.id, "rarity": hs.rarity, "capacity": hs.capacity,
			"regenBoostBps": hs.regen_boost_bps, "occupants": _occupants(hs.id, ""),
		})
	var heroes_dto: Array = []
	for h: EngineHero in heroes:
		heroes_dto.append({
			"id": h.id, "rarity": h.rarity, "power": h.power, "speed": h.speed,
			"stamina": floori(h.stamina), "staminaMax": h.stamina_max, "mode": h.mode,
			"houseId": h.house_id if h.house_id != "" else null,
			"bombIntervalMs": roundi(h.interval_ms()),
		})
	var stages_dto: Array = []
	for s: Dictionary in stages:
		stages_dto.append({
			"id": s["id"], "name": s["name"], "staminaCost": s["staminaCost"],
			"minRarity": s["minRarity"], "rewardBlast": micro_to_blast_str(int(s["rewardMicro"]), 2),
		})
	return {
		"pendingBlast": micro_to_blast_str(pending_micro, 6),
		"mapsCleared": maps_cleared,
		"chainSync": chain_sync,
		"claimRules": {"minBlast": min_blast, "cooldownHours": cooldown_hours},
		"adventure": {"attemptsToday": attempts_today if adventure_day == day else 0, "stages": stages_dto},
		"blocks": blocks_dto,
		"houses": houses_dto,
		"heroes": heroes_dto,
	}


## Exact decimal formatting from integer micro-BLAST ("123.456789" / "9.38"), no float rounding.
static func micro_to_blast_str(micro: int, decimals: int) -> String:
	var neg := micro < 0
	var a := absi(micro)
	var whole := a / 1_000_000
	var frac := a % 1_000_000
	var s := ""
	if decimals >= 6:
		s = "%d.%06d" % [whole, frac]
	else:
		# round half up to `decimals` places, like toFixed on a value with <= 6 decimals
		var div := 1
		for i in (6 - decimals):
			div *= 10
		var scaled := (a + div / 2) / div
		var unit := 1
		for i in decimals:
			unit *= 10
		s = ("%d." + "%0" + str(decimals) + "d") % [scaled / unit, scaled % unit]
	return ("-" + s) if neg else s


## "123.456789" -> 123456789 micro (exact, no float parsing).
static func blast_str_to_micro(s: String) -> int:
	var t := s.strip_edges()
	var neg := t.begins_with("-")
	if neg:
		t = t.substr(1)
	var parts := t.split(".", true, 1)
	var whole := 0
	if parts[0].is_valid_int():
		whole = parts[0].to_int()
	var frac_s := ""
	if parts.size() > 1:
		frac_s = parts[1]
	frac_s = (frac_s + "000000").substr(0, 6)
	var frac := frac_s.to_int() if frac_s.is_valid_int() else 0
	var micro := whole * 1_000_000 + frac
	return -micro if neg else micro


# =====================================================================
# Player actions
# =====================================================================

func set_mode(id: String, mode: String) -> Dictionary:
	if mode != "work" and mode != "rest":
		return {"error": ERR_MODE}
	_simulate()
	var h := _hero(id)
	if h == null:
		return {"error": ERR_NOT_FOUND}
	if mode == "work" and h.stamina < 1.0:
		return {"error": ERR_STAMINA}
	h.mode = mode
	h.simulated_to = now_ms
	return state_dto()


## "Mine all" / "rest all": skips exhausted heroes instead of failing. Adds `changed`.
func set_team_mode(mode: String) -> Dictionary:
	if mode != "work" and mode != "rest":
		return {"error": ERR_MODE}
	_simulate()
	var changed := 0
	for h: EngineHero in heroes:
		if mode == "work" and h.stamina < 1.0:
			continue
		if h.mode != mode:
			h.mode = mode
			h.simulated_to = now_ms
			changed += 1
	var d := state_dto()
	d["changed"] = changed
	return d


## house_id "" == leave the current house.
func set_house(id: String, house_id: String) -> Dictionary:
	_simulate()
	var h := _hero(id)
	if h == null:
		return {"error": ERR_HERO_NOT_FOUND}
	if house_id == "":
		h.house_id = ""
		h.regen_boost_bps = 0
	else:
		var hs := _house(house_id)
		if hs == null:
			return {"error": ERR_HOUSE_NOT_FOUND}
		if _occupants(house_id, h.id) >= hs.capacity:
			return {"error": ERR_HOUSE_FULL}
		h.house_id = house_id
		h.regen_boost_bps = hs.regen_boost_bps
	return state_dto()


## adventure.ts runAdventure + game.service.ts goAdventure (AdventureResultDto).
func adventure(id: String, stage_id: int) -> Dictionary:
	_simulate()
	var h := _hero(id)
	if h == null:
		return {"error": ERR_HERO_NOT_FOUND}
	var stage := _stage(stage_id)
	if stage.is_empty():
		return {"error": ERR_STAGE_NOT_FOUND}
	var day := current_day(now_ms)
	if adventure_day != day:
		adventure_day = day
		attempts_today = 0
	if attempts_today >= DAILY_ATTEMPT_LIMIT:
		return {"error": ERR_ADV_LIMIT}
	var min_rarity := int(stage["minRarity"])
	if h.rarity < min_rarity:
		return {"error": "stage requires rarity %d+" % min_rarity}
	var cost := int(stage["staminaCost"])
	if h.stamina < cost:
		return {"error": ERR_ADV_STAMINA}

	attempts_today += 1
	var p := h.effective_power()
	var chance := p / (p + float(stage["difficulty"]))
	var rand := _roll()
	var success := rand < chance
	var spent := cost if success else ceili(cost * (1.0 - DEFEAT_STAMINA_REFUND))
	h.stamina -= spent
	if h.stamina < 1.0:
		h.mode = "rest"
	var reward := roundi(int(stage["rewardMicro"]) * (1.0 + h.rarity * 0.15)) if success else 0
	pending_micro += reward
	return {
		"success": success,
		"stage": String(stage["name"]),
		"rewardMicro": reward,
		"staminaSpent": spent,
		"attemptsLeft": DAILY_ATTEMPT_LIMIT - attempts_today,
		"successChance": roundi(chance * 100.0),
		"state": state_dto(),
	}


## game.service.ts dailyStatus (DailyStatusDto).
func daily_status() -> Dictionary:
	var today := current_day(now_ms)
	var claimed := has_streak and streak_day == today
	var streak := streak_count if (has_streak and streak_day >= today - 1) else 0
	var next_day := streak_count if claimed else _next_count(today)
	return {
		"claimedToday": claimed,
		"streak": streak,
		"nextDay": next_day,
		"hasHero": heroes.size() > 0,
		"canClaim": (not claimed) and heroes.size() > 0,
		"rewards": STREAK_BLAST.duplicate(),
		"jackpotChance": roundi(JACKPOT_CHANCE * 100.0),
		"jackpotBlast": JACKPOT_BLAST,
	}


## game.service.ts claimDaily (DailyClaimDto).
func claim_daily() -> Dictionary:
	var today := current_day(now_ms)
	if heroes.is_empty():
		return {"error": ERR_DAILY_NO_HERO}
	if has_streak and streak_day == today:
		return {"error": ERR_DAILY_CLAIMED}
	var rand := _roll()
	var count := _next_count(today)
	var base_blast: int = STREAK_BLAST[count - 1]
	var jackpot := count == STREAK_LEN and rand < JACKPOT_CHANCE
	var jackpot_blast := JACKPOT_BLAST if jackpot else 0
	var total := base_blast + jackpot_blast
	_simulate()
	pending_micro += total * 1_000_000
	has_streak = true
	streak_day = today
	streak_count = count
	return {
		"claim": {
			"count": count, "baseBlast": base_blast, "jackpot": jackpot,
			"jackpotBlast": jackpot_blast, "totalBlast": total, "rewardMicro": total * 1_000_000,
		},
		"state": state_dto(),
	}


func _next_count(today: int) -> int:
	if has_streak and streak_day == today - 1:
		return 1 if streak_count >= STREAK_LEN else streak_count + 1
	return 1


## rewards.service.ts issueVoucher (VoucherDto): re-present a valid pending voucher,
## else cooldown check, else debit pending (refund + error below the minimum).
func voucher() -> Dictionary:
	var now_s := now_ms / 1000
	# reconcile: an expired, unclaimed voucher is refunded and discarded
	if not pending_voucher.is_empty() and int(pending_voucher["deadline"]) <= now_s:
		pending_micro += int(pending_voucher["amountMicro"])
		pending_voucher = {}
	if not pending_voucher.is_empty() and int(pending_voucher["deadline"]) > now_s:
		return _voucher_dto(pending_voucher)
	var cooldown_ms := cooldown_hours * 3_600_000
	if last_voucher_at_ms > 0 and now_ms - last_voucher_at_ms < cooldown_ms:
		var remaining_min := ceili((cooldown_ms - (now_ms - last_voucher_at_ms)) / 60_000.0)
		return {"error": "claim cooldown active — try again in ~%d min" % remaining_min}
	_simulate()
	var micro := pending_micro
	pending_micro = 0
	if micro < min_blast * 1_000_000:
		pending_micro += micro   # refund
		return {"error": "minimum claim is %s BLAST" % Fmt.thousands(min_blast)}
	var nonce := _next_nonce
	_next_nonce += 1
	pending_voucher = {
		"amountMicro": micro,
		"amountWei": micro_to_wei(micro),
		"nonce": str(nonce),
		"deadline": now_s + VOUCHER_TTL_S,
		"signature": _mock_signature(nonce, micro),
	}
	last_voucher_at_ms = now_ms
	return _voucher_dto(pending_voucher)


## Called by MockBackend after the (mock) claim transaction "confirms": the on-chain nonce
## would advance and the next reconcile marks the voucher claimed.
func mark_voucher_claimed() -> void:
	pending_voucher = {}


func _voucher_dto(v: Dictionary) -> Dictionary:
	return {
		"amount": String(v["amountWei"]),
		"nonce": String(v["nonce"]),
		"deadline": int(v["deadline"]),
		"signature": String(v["signature"]),
		"vault": VAULT_ADDRESS,
		"chainId": CHAIN_ID,
	}


## micro (1e6) -> wei (1e18) as a decimal string (exceeds int64, so append 12 zeros).
static func micro_to_wei(micro: int) -> String:
	if micro <= 0:
		return "0"
	return str(micro) + "000000000000"


func _mock_signature(nonce: int, micro: int) -> String:
	return "0x" + ("%064x" % nonce) + ("%064x" % micro) + "1b"


# =====================================================================
# Debug hooks (DebugPanel)
# =====================================================================

func kill_block(i: int) -> void:
	_simulate()
	if i >= 0 and i < blocks.size():
		blocks[i].hp = 0


func clear_map() -> void:
	_simulate()
	for b: EngineBlock in blocks:
		b.hp = 0


func add_pending(blast: float) -> void:
	_simulate()
	pending_micro = maxi(0, pending_micro + roundi(blast * 1_000_000.0))


func set_pending(blast: float) -> void:
	_simulate()
	pending_micro = maxi(0, roundi(blast * 1_000_000.0))


func drain_stamina() -> void:
	_simulate()
	for h: EngineHero in heroes:
		h.stamina = 0.0
		h.mode = "rest"
		h.simulated_to = now_ms


## Adds n resting heroes with dev-like attributes (ids "mock-N").
func add_heroes(n: int) -> void:
	_simulate()
	for i in n:
		_hero_counter += 1
		while _hero("mock-%d" % _hero_counter) != null:
			_hero_counter += 1
		var rarity := rng.randi_range(0, 5)
		var base := 10 + rarity * 15
		var h := EngineHero.new()
		h.id = "mock-%d" % _hero_counter
		h.rarity = rarity
		h.power = base + rng.randi_range(0, 9)
		h.speed = base + rng.randi_range(0, 9)
		h.stamina_max = (base + rng.randi_range(0, 9)) * 2
		h.stamina = float(h.stamina_max)
		h.mode = "rest"
		h.simulated_to = now_ms
		heroes.append(h)


## Programmatic hero insertion (tests / fixtures).
func add_hero(id: String, rarity: int, power: int, speed: int, stamina: float, stamina_max: int, mode: String = "rest", house_id: String = "") -> EngineHero:
	var h := EngineHero.new()
	h.id = id
	h.rarity = rarity
	h.power = power
	h.speed = speed
	h.stamina_max = stamina_max
	h.stamina = stamina
	h.mode = mode
	h.simulated_to = now_ms
	if house_id != "":
		var hs := _house(house_id)
		if hs != null:
			h.house_id = house_id
			h.regen_boost_bps = hs.regen_boost_bps
	heroes.append(h)
	return h


func add_house(id: String, rarity: int, capacity: int, regen_boost_bps: int) -> House:
	var hs := House.new()
	hs.id = id
	hs.rarity = rarity
	hs.capacity = capacity
	hs.regen_boost_bps = regen_boost_bps
	houses.append(hs)
	return hs


# =====================================================================
# Loading
# =====================================================================

## Loads a GameStateDto dictionary (fixture). Returns false (and pushes an error) when invalid.
func load_state(d: Dictionary) -> bool:
	var m := StateModel.parse(d)
	if m == null:
		push_error("MockServer.load_state: %s" % StateModel.last_error)
		return false
	heroes.clear()
	blocks.clear()
	houses.clear()
	stages.clear()
	for hm: HouseModel in m.houses:
		add_house(hm.id, hm.rarity, hm.capacity, hm.regen_boost_bps)
	for hr: HeroModel in m.heroes:
		add_hero(hr.id, hr.rarity, hr.power, hr.speed, float(hr.stamina), hr.stamina_max, hr.mode, hr.house_id)
	for b: BlockModel in m.blocks:
		blocks.append(EngineBlock.new(b.max_hp, b.hp))
	for sm: StageModel in m.stages:
		var difficulty := 25 + 35 * sm.id
		for s: Dictionary in STAGES:
			if int(s["id"]) == sm.id:
				difficulty = int(s["difficulty"])
		stages.append({
			"id": sm.id, "name": sm.name, "difficulty": difficulty, "staminaCost": sm.stamina_cost,
			"rewardMicro": blast_str_to_micro(sm.reward_blast), "minRarity": sm.min_rarity,
		})
	if stages.is_empty():
		for s: Dictionary in STAGES:
			stages.append(s.duplicate())
	pending_micro = blast_str_to_micro(m.pending_str)
	maps_cleared = m.maps_cleared
	chain_sync = m.chain_sync
	min_blast = m.min_blast
	cooldown_hours = m.cooldown_hours
	attempts_today = m.attempts_today
	adventure_day = current_day(now_ms)
	pending_voucher = {}
	last_voucher_at_ms = 0
	return true


## Fallback content when no fixture is available: fresh map, dev-house, 3 dev heroes.
func reset_default() -> void:
	heroes.clear()
	houses.clear()
	blocks = generate_map(map_seed)
	add_house(String(DEV_HOUSE["id"]), int(DEV_HOUSE["rarity"]), int(DEV_HOUSE["capacity"]), int(DEV_HOUSE["regenBoostBps"]))
	var rand := Mulberry.new(map_seed)
	var rarities := [0, 1, 2 + floori(rand.next() * 2)]
	for i in rarities.size():
		var rarity: int = rarities[i]
		var base := 10 + rarity * 15
		add_hero("dev-%d-%d" % [map_seed, i], rarity, base + floori(rand.next() * 10), base + floori(rand.next() * 10),
			float((base + floori(rand.next() * 10)) * 2), (base + floori(rand.next() * 10)) * 2)
	pending_micro = 0
	maps_cleared = 0
	attempts_today = 0


# =====================================================================
# Lookups
# =====================================================================

func _hero(id: String) -> EngineHero:
	for h: EngineHero in heroes:
		if h.id == id:
			return h
	return null


func _house(id: String) -> House:
	for hs: House in houses:
		if hs.id == id:
			return hs
	return null


func _stage(id: int) -> Dictionary:
	for s: Dictionary in stages:
		if int(s["id"]) == id:
			return s
	return {}


func _occupants(house_id: String, except_hero: String) -> int:
	var n := 0
	for h: EngineHero in heroes:
		if h.house_id == house_id and h.id != except_hero:
			n += 1
	return n


## 0..1 roll: forced_rand (once) or randomInt(1_000_000)/1_000_000 like the server.
func _roll() -> float:
	if forced_rand >= 0.0:
		var r := forced_rand
		forced_rand = -1.0
		return r
	return rng.randi_range(0, 999_999) / 1_000_000.0


func alive_count() -> int:
	var n := 0
	for b: EngineBlock in blocks:
		if b.hp > 0:
			n += 1
	return n
