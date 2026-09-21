class_name HeroModel
extends RefCounted
## Typed row for one HeroDto (see docs/godot-v2-design.md Appendix A).

var id: String = ""
var rarity: int = 0
var power: int = 0
var speed: int = 0
var stamina: int = 0
var stamina_max: int = 0
var mode: String = "rest"          # "work" | "rest"
var house_id: String = ""          # "" == null (not sheltered)
var bomb_interval_ms: int = 4000


func is_working() -> bool:
	return mode == "work"


func is_housed() -> bool:
	return house_id != ""


func stamina_ratio() -> float:
	if stamina_max <= 0:
		return 0.0
	return clampf(float(stamina) / float(stamina_max), 0.0, 1.0)


func duplicate_model() -> HeroModel:
	var h := HeroModel.new()
	h.id = id
	h.rarity = rarity
	h.power = power
	h.speed = speed
	h.stamina = stamina
	h.stamina_max = stamina_max
	h.mode = mode
	h.house_id = house_id
	h.bomb_interval_ms = bomb_interval_ms
	return h
