class_name StateModel
extends RefCounted
## Validated, typed snapshot of a GameStateDto (design Appendix A).
## `parse()` is the ONLY place JSON numbers (always float after JSON.parse_string) are
## cast to int; wei/ids/pendingBlast/rewardBlast stay strings.

var pending_str: String = "0.000000"
var pending: float = 0.0
var maps_cleared: int = 0
var chain_sync: bool = false
var min_blast: int = 0
var cooldown_hours: int = 0
var attempts_today: int = 0
var stages: Array[StageModel] = []
var blocks: Array[BlockModel] = []
var houses: Array[HouseModel] = []
var heroes: Array[HeroModel] = []
var received_at_ms: int = 0

static var last_error: String = ""

const BLOCK_COUNT := 40
const _NUMERIC := [TYPE_INT, TYPE_FLOAT]


## Returns null (and sets last_error) on: not a Dictionary, blocks.size() != 40, missing
## claimRules/adventure/heroes/houses/blocks, or wrong field types.
static func parse(d: Variant) -> StateModel:
	last_error = ""
	if typeof(d) != TYPE_DICTIONARY:
		last_error = "state is not a Dictionary"
		return null
	var dict: Dictionary = d
	var s := StateModel.new()
	s.received_at_ms = Time.get_ticks_msec()

	# ---- pendingBlast (string; numbers tolerated) ----
	var pb: Variant = dict.get("pendingBlast")
	if typeof(pb) == TYPE_STRING:
		if not (pb as String).is_valid_float():
			last_error = "pendingBlast is not numeric: %s" % pb
			return null
		s.pending_str = pb
		s.pending = (pb as String).to_float()
	elif typeof(pb) in _NUMERIC:
		s.pending = float(pb)
		s.pending_str = "%.6f" % s.pending
	else:
		last_error = "missing pendingBlast"
		return null

	# ---- scalars ----
	var mc: Variant = dict.get("mapsCleared", 0)
	if not (typeof(mc) in _NUMERIC):
		last_error = "mapsCleared has wrong type"
		return null
	s.maps_cleared = int(mc)
	var cs: Variant = dict.get("chainSync", false)
	if typeof(cs) != TYPE_BOOL:
		last_error = "chainSync has wrong type"
		return null
	s.chain_sync = cs

	# ---- claimRules ----
	var cr: Variant = dict.get("claimRules")
	if typeof(cr) != TYPE_DICTIONARY:
		last_error = "missing claimRules"
		return null
	var min_b: Variant = (cr as Dictionary).get("minBlast")
	var cd_h: Variant = (cr as Dictionary).get("cooldownHours")
	if not (typeof(min_b) in _NUMERIC) or not (typeof(cd_h) in _NUMERIC):
		last_error = "claimRules.minBlast/cooldownHours must be numbers"
		return null
	s.min_blast = int(min_b)
	s.cooldown_hours = int(cd_h)

	# ---- adventure ----
	var adv: Variant = dict.get("adventure")
	if typeof(adv) != TYPE_DICTIONARY:
		last_error = "missing adventure"
		return null
	var at: Variant = (adv as Dictionary).get("attemptsToday")
	if not (typeof(at) in _NUMERIC):
		last_error = "adventure.attemptsToday must be a number"
		return null
	s.attempts_today = int(at)
	var st: Variant = (adv as Dictionary).get("stages")
	if typeof(st) != TYPE_ARRAY:
		last_error = "adventure.stages must be an array"
		return null
	for i in (st as Array).size():
		var sm := _parse_stage((st as Array)[i], i)
		if sm == null:
			return null
		s.stages.append(sm)

	# ---- blocks (exactly 40, row-major 8x5) ----
	var bl: Variant = dict.get("blocks")
	if typeof(bl) != TYPE_ARRAY:
		last_error = "missing blocks"
		return null
	if (bl as Array).size() != BLOCK_COUNT:
		last_error = "blocks.size() is %d, expected %d" % [(bl as Array).size(), BLOCK_COUNT]
		return null
	for i in BLOCK_COUNT:
		var bm := _parse_block((bl as Array)[i], i)
		if bm == null:
			return null
		s.blocks.append(bm)

	# ---- houses ----
	var ho: Variant = dict.get("houses")
	if typeof(ho) != TYPE_ARRAY:
		last_error = "missing houses"
		return null
	for i in (ho as Array).size():
		var hm := _parse_house((ho as Array)[i], i)
		if hm == null:
			return null
		s.houses.append(hm)

	# ---- heroes ----
	var he: Variant = dict.get("heroes")
	if typeof(he) != TYPE_ARRAY:
		last_error = "missing heroes"
		return null
	for i in (he as Array).size():
		var hr := _parse_hero((he as Array)[i], i)
		if hr == null:
			return null
		s.heroes.append(hr)

	return s


static func _parse_block(v: Variant, i: int) -> BlockModel:
	if typeof(v) != TYPE_DICTIONARY:
		last_error = "blocks[%d] is not a Dictionary" % i
		return null
	var hp: Variant = (v as Dictionary).get("hp")
	var mx: Variant = (v as Dictionary).get("maxHp")
	if not (typeof(hp) in _NUMERIC) or not (typeof(mx) in _NUMERIC):
		last_error = "blocks[%d].hp/maxHp must be numbers" % i
		return null
	var b := BlockModel.new()
	b.hp = int(hp)
	b.max_hp = int(mx)
	return b


static func _parse_stage(v: Variant, i: int) -> StageModel:
	if typeof(v) != TYPE_DICTIONARY:
		last_error = "stages[%d] is not a Dictionary" % i
		return null
	var d: Dictionary = v
	var id: Variant = d.get("id")
	var nm: Variant = d.get("name")
	var cost: Variant = d.get("staminaCost")
	var mr: Variant = d.get("minRarity")
	var rb: Variant = d.get("rewardBlast")
	if not (typeof(id) in _NUMERIC) or typeof(nm) != TYPE_STRING \
			or not (typeof(cost) in _NUMERIC) or not (typeof(mr) in _NUMERIC):
		last_error = "stages[%d] has wrong field types" % i
		return null
	var s := StageModel.new()
	s.id = int(id)
	s.name = nm
	s.stamina_cost = int(cost)
	s.min_rarity = int(mr)
	if typeof(rb) == TYPE_STRING:
		s.reward_blast = rb
	elif typeof(rb) in _NUMERIC:
		s.reward_blast = "%.2f" % float(rb)
	else:
		last_error = "stages[%d].rewardBlast must be a string" % i
		return null
	return s


static func _parse_house(v: Variant, i: int) -> HouseModel:
	if typeof(v) != TYPE_DICTIONARY:
		last_error = "houses[%d] is not a Dictionary" % i
		return null
	var d: Dictionary = v
	var id: Variant = d.get("id")
	if typeof(id) != TYPE_STRING:
		last_error = "houses[%d].id must be a string" % i
		return null
	var h := HouseModel.new()
	h.id = id
	for key: String in ["rarity", "capacity", "regenBoostBps", "occupants"]:
		var n: Variant = d.get(key, 0)
		if not (typeof(n) in _NUMERIC):
			last_error = "houses[%d].%s must be a number" % [i, key]
			return null
	h.rarity = int(d.get("rarity", 0))
	h.capacity = int(d.get("capacity", 0))
	h.regen_boost_bps = int(d.get("regenBoostBps", 0))
	h.occupants = int(d.get("occupants", 0))
	return h


static func _parse_hero(v: Variant, i: int) -> HeroModel:
	if typeof(v) != TYPE_DICTIONARY:
		last_error = "heroes[%d] is not a Dictionary" % i
		return null
	var d: Dictionary = v
	var id: Variant = d.get("id")
	if typeof(id) != TYPE_STRING or id == "":
		last_error = "heroes[%d].id must be a non-empty string" % i
		return null
	for key: String in ["rarity", "power", "speed", "stamina", "staminaMax"]:
		var n: Variant = d.get(key)
		if not (typeof(n) in _NUMERIC):
			last_error = "heroes[%d].%s must be a number" % [i, key]
			return null
	var mode: Variant = d.get("mode")
	if typeof(mode) != TYPE_STRING or not (mode in ["work", "rest"]):
		last_error = "heroes[%d].mode must be work or rest" % i
		return null
	var hid: Variant = d.get("houseId")
	var h := HeroModel.new()
	h.id = id
	h.rarity = int(d["rarity"])
	h.power = int(d["power"])
	h.speed = int(d["speed"])
	h.stamina = int(d["stamina"])
	h.stamina_max = int(d["staminaMax"])
	h.mode = mode
	if typeof(hid) == TYPE_STRING:
		h.house_id = hid
	elif hid == null:
		h.house_id = ""
	else:
		last_error = "heroes[%d].houseId must be a string or null" % i
		return null
	var bi: Variant = d.get("bombIntervalMs")
	if typeof(bi) in _NUMERIC:
		h.bomb_interval_ms = int(bi)
	elif bi == null:
		h.bomb_interval_ms = Rules.bomb_interval_ms(h.speed)
	else:
		last_error = "heroes[%d].bombIntervalMs must be a number" % i
		return null
	return h


## Hero by id, null if absent.
func hero(id: String) -> HeroModel:
	for h: HeroModel in heroes:
		if h.id == id:
			return h
	return null


func house(id: String) -> HouseModel:
	for h: HouseModel in houses:
		if h.id == id:
			return h
	return null


func stage(id: int) -> StageModel:
	for s: StageModel in stages:
		if s.id == id:
			return s
	return null


## Row-major first block with hp > 0, -1 if the map is cleared.
func first_alive_index() -> int:
	return Rules.first_alive(blocks)


func alive_count() -> int:
	var n := 0
	for b: BlockModel in blocks:
		if b.hp > 0:
			n += 1
	return n


func working_heroes() -> Array[HeroModel]:
	var out: Array[HeroModel] = []
	for h: HeroModel in heroes:
		if h.mode == "work":
			out.append(h)
	return out


## First house with occupants < capacity, else null.
func free_house() -> HouseModel:
	for h: HouseModel in houses:
		if h.occupants < h.capacity:
			return h
	return null


func can_claim() -> bool:
	return Rules.can_claim(pending, min_blast)


func team_rate() -> float:
	return Rules.team_rate(heroes)
