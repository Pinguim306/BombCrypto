class_name StageModel
extends RefCounted
## Typed row for one StageDto (adventure stage).

var id: int = 0
var name: String = ""
var stamina_cost: int = 0
var min_rarity: int = 0
var reward_blast: String = "0.00"   # kept as the server's 2-decimal string
