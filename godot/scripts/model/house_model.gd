class_name HouseModel
extends RefCounted
## Typed row for one HouseDto.

var id: String = ""
var rarity: int = 0
var capacity: int = 0
var regen_boost_bps: int = 0
var occupants: int = 0


func has_free_slot() -> bool:
	return occupants < capacity
