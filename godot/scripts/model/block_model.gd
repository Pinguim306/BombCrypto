class_name BlockModel
extends RefCounted
## One mining block {hp, maxHp}. Helpers delegate to Rules so the thresholds live in one place.

var hp: int = 0
var max_hp: int = 1


func alive() -> bool:
	return hp > 0


func ratio() -> float:
	if max_hp <= 0:
		return 0.0
	return clampf(float(hp) / float(max_hp), 0.0, 1.0)


func tier() -> int:
	return Rules.block_tier(max_hp)


func crack_level() -> int:
	return Rules.crack_level(hp, max_hp)
