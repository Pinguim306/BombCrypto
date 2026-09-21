class_name Fmt
## Every UI string of the mining screen, byte-for-byte the Phaser catalogue
## (client/src/scenes/MiningScene.ts). Glyph substitutions decided in the design:
## "⛏" -> [img] pick icon in the Mine-all message (bbcode), "⌂" -> house icon (HeroRow).

const PICK_IMG := "[img=12]res://assets/sprites/pick.png[/img]"
const MAX_HOUSE_LINES := 6
const HOUSES_HINT := ["No houses yet.", "Buy one in the Shop, then", "click a hero and Shelter it."]


## en-US grouping: 30000 -> "30,000" (negative numbers keep the sign).
static func thousands(n: int) -> String:
	var neg := n < 0
	var digits := str(absi(n))
	var out := ""
	var count := 0
	for i in range(digits.length() - 1, -1, -1):
		out = digits[i] + out
		count += 1
		if count % 3 == 0 and i > 0:
			out = "," + out
	return ("-" + out) if neg else out


## "%.2f"
static func blast2(f: float) -> String:
	return "%.2f" % f


## "12.34 BLAST · min 30,000"
static func pending_pill(pending: float, min_blast: int) -> String:
	return "%s BLAST · min %s" % [blast2(pending), thousands(min_blast)]


## "~4,230 BLAST/h" | "team idle · 0 BLAST/h"
static func rate_pill(rate: float) -> String:
	if rate > 0.0:
		return "~%s BLAST/h" % thousands(roundi(rate))
	return "team idle · 0 BLAST/h"


## "Epic P41 S39"
static func hero_name(h: HeroModel) -> String:
	return "%s P%d S%d" % [Rules.rarity_name(h.rarity), h.power, h.speed]


## "stamina 40/50"
static func stamina_line(h: HeroModel) -> String:
	return "stamina %d/%d" % [h.stamina, h.stamina_max]


## "mining" | "zZz resting" (the pick/house icons are separate nodes in HeroRow).
static func mode_label(h: HeroModel) -> String:
	return "mining" if h.mode == "work" else "zZz resting"


## "HOUSES:" + up to 6 lines "Common 1/2 · +20%", then "…and N more"; 3-line hint when empty.
static func houses_text(houses: Array[HouseModel]) -> String:
	var lines: Array[String] = ["HOUSES:"]
	if houses.is_empty():
		lines.append_array(HOUSES_HINT)
	else:
		var shown := mini(houses.size(), MAX_HOUSE_LINES)
		for i in shown:
			var h := houses[i]
			lines.append("%s %d/%d · +%s%%" % [Rules.rarity_name(h.rarity), h.occupants, h.capacity, bps_percent(h.regen_boost_bps)])
		var extra := houses.size() - MAX_HOUSE_LINES
		if extra > 0:
			lines.append("…and %d more" % extra)
	return "\n".join(lines)


## bps/100 printed like a JS number: 2000 -> "20", 2550 -> "25.5", 1234 -> "12.34".
static func bps_percent(bps: int) -> String:
	var neg := bps < 0
	var a := absi(bps)
	var whole := a / 100
	var frac := a % 100
	var s := ""
	if frac == 0:
		s = "%d" % whole
	elif frac % 10 == 0:
		s = "%d.%d" % [whole, frac / 10]
	else:
		s = "%d.%02d" % [whole, frac]
	return ("-" + s) if neg else s


## "▶ Shallow Cavern\n9.38 BLAST · 8 stam" (prefix only when selected)
static func stage_card(s: StageModel, selected: bool) -> String:
	return "%s%s\n%s BLAST · %d stam" % ["▶ " if selected else "", s.name, s.reward_blast, s.stamina_cost]


## "adventures today: 2/10   withdraw: min 30,000 BLAST, every 24h"
static func info_line(attempts: int, min_blast: int, cooldown_h: int) -> String:
	return "adventures today: %d/%d   withdraw: min %s BLAST, every %dh" % [attempts, Rules.DAILY_ATTEMPT_LIMIT, thousands(min_blast), cooldown_h]


## Popup stats block (4 lines, monospace column alignment as in Phaser).
static func hero_stats(h: HeroModel) -> String:
	var rate := roundi(Rules.hero_rate(h))
	return "Power    %d\nSpeed    %d\nStamina  %d/%d\nMines    ~%s BLAST/h" % [h.power, h.speed, h.stamina, h.stamina_max, thousands(rate)]


## "Status: mining" | "Status: resting"
static func status_line(h: HeroModel) -> String:
	return "Status: mining" if h.mode == "work" else "Status: resting"


## Pager label "1/3".
static func pager(page: int, pages: int) -> String:
	return "%d/%d" % [page + 1, pages]


## "1 hero sent to work! <pick>" | "3 heroes sent to work! <pick>" | idle message
static func mine_all_msg(changed: int) -> String:
	if changed > 0:
		return "%d hero%s sent to work! %s" % [changed, "es" if changed > 1 else "", PICK_IMG]
	return "everyone is already mining (or out of stamina)"


## "victory in Deep Mine! +30.19 BLAST (chance 57%)"
static func victory_msg(stage: String, reward_micro: int, chance: int) -> String:
	return "victory in %s! +%s BLAST (chance %d%%)" % [stage, blast2(reward_micro / 1000000.0), chance]


## "defeat in Deep Mine (chance was 57%) — half the stamina refunded"
static func defeat_msg(stage: String, chance: int) -> String:
	return "defeat in %s (chance was %d%%) — half the stamina refunded" % [stage, chance]


## "0x1234…abcd" (unchanged when 10 chars or shorter)
static func short_hash(h: String) -> String:
	if h.length() <= 10:
		return h
	return h.substr(0, 6) + "…" + h.substr(h.length() - 4, 4)


## Status-bar prefixes (GameState uses these to stay byte-identical with Phaser).
static func error_msg(m: String) -> String:
	return "error: " + m


static func adventure_error(m: String) -> String:
	return "adventure: " + m


static func claim_failed(m: String) -> String:
	return "claim failed: " + m


static func claim_sent(hash: String) -> String:
	return "claim sent: " + hash


## "connection problem — retrying in 4s"
static func net_banner(retry_ms: int) -> String:
	return "connection problem — retrying in %ds" % maxi(0, ceili(retry_ms / 1000.0))
