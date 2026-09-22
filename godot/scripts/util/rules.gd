class_name Rules
## Pure game rules shared by rendering, FX and the predictive bomb sim.
## Constants mirror server/src/game/engine.ts + adventure.ts and Config (kept local so
## this module never depends on an autoload).

const COLS := 8
const ROWS := 5
const BLOCK_COUNT := COLS * ROWS            # 40 (screen geometry lives in Layout)

const DAILY_ATTEMPT_LIMIT := 10             # adventure.ts:26
const BOMB_BASE_INTERVAL_MS := 4000         # engine.ts:42
const BLAST_PER_HP := 0.075                 # engine.ts:48 (75_000 micro)
const RATE_K := 67.5                        # BLAST/h per power at speed 0 (MiningScene.ts:20)

const RARITY_NAMES := ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"]


## Ore hardness tier of a block: >=90 -> 2 (magma), >=50 -> 1 (ice), else 0 (stone).
static func block_tier(max_hp: int) -> int:
	if max_hp >= 90:
		return 2
	if max_hp >= 50:
		return 1
	return 0


## Depleted floor variant: some cells reveal a glowing crystal (indices 1,6,...,36).
static func dead_variant(i: int) -> String:
	return "block_dead2" if (i * 7 + 3) % 5 == 0 else "block_dead"


## 0 (>=.66), 1 (<.66), 2 (<.33); 0 when dead or invalid.
static func crack_level(hp: int, max_hp: int) -> int:
	if hp <= 0 or max_hp <= 0:
		return 0
	var ratio := float(hp) / float(max_hp)
	if ratio < 0.33:
		return 2
	if ratio < 0.66:
		return 1
	return 0


## Display-only earnings estimate for one hero: 67.5 * power * (1 + speed/100) BLAST/h.
static func hero_rate(h: HeroModel) -> float:
	if h == null:
		return 0.0
	return RATE_K * h.power * (1.0 + h.speed / 100.0)


## Team estimate: sum over heroes in "work" mode.
static func team_rate(heroes: Array[HeroModel]) -> float:
	var sum := 0.0
	for h: HeroModel in heroes:
		if h.mode == "work":
			sum += hero_rate(h)
	return sum


static func can_claim(pending: float, min_blast: int) -> bool:
	return pending >= float(min_blast)


## Server bomb cadence for a speed value (engine.ts:79), rounded like the DTO.
static func bomb_interval_ms(speed: int) -> int:
	return roundi(BOMB_BASE_INTERVAL_MS / (1.0 + speed / 100.0))


## First alive block in row-major order, -1 when the map is cleared.
static func first_alive(blocks: Array[BlockModel]) -> int:
	for i in blocks.size():
		if blocks[i].hp > 0:
			return i
	return -1


static func rarity_name(r: int) -> String:
	if r < 0 or r >= RARITY_NAMES.size():
		return "Common"
	return RARITY_NAMES[r]
