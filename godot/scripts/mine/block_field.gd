class_name BlockField
extends Node2D
## The ore deposits on the map (Layout.DEPOSIT_COUNT mounds scattered over the
## 12x8 tile grid, each showing BLOCKS_PER_DEPOSIT consecutive server blocks),
## y-sorted together with the heroes. Renders from the server state, applies
## predicted hits from the bomb sim, and answers walkability questions for
## the actors.

signal tile_died(index: int, last_dmg: int)   # deposit index

const TILE_SCENE: PackedScene = preload("res://scenes/mine/block_tile.tscn")

var tiles: Array[BlockTile] = []


func _ready() -> void:
	y_sort_enabled = true
	for d in Layout.DEPOSIT_COUNT:
		var t: BlockTile = TILE_SCENE.instantiate()
		t.name = "Deposit%02d" % d
		add_child(t)
		t.setup(d)
		t.died.connect(_on_tile_died)
		tiles.append(t)


## Server truth for every block. `animate` = not the first render and FX on.
func set_state(blocks: Array[BlockModel], animate: bool) -> void:
	var per := Layout.BLOCKS_PER_DEPOSIT
	for d in tiles.size():
		var group: Array[BlockModel] = []
		for k in per:
			var i := d * per + k
			if i < blocks.size():
				group.append(blocks[i])
		if not group.is_empty():
			tiles[d].apply(group, animate)


## A predicted bomb hits server block i. Returns true when its deposit died visually.
func hit(i: int, dmg: int) -> bool:
	var d := Layout.deposit_of(i)
	if d < 0 or d >= tiles.size():
		return false
	return tiles[d].play_hit(i % Layout.BLOCKS_PER_DEPOSIT, dmg)


## Deposit d, or null.
func deposit(d: int) -> BlockTile:
	return tiles[d] if d >= 0 and d < tiles.size() else null


## The deposit showing server block i, or null.
func tile(i: int) -> BlockTile:
	return deposit(Layout.deposit_of(i))


## Server maxHp of block i (for the "-dmg" float text threshold).
func block_max_hp(i: int) -> int:
	var t := tile(i)
	if t == null:
		return 1
	return t.block_max[i % Layout.BLOCKS_PER_DEPOSIT]


## Visual aliveness of the deposit showing block i.
func is_alive(i: int) -> bool:
	var t := tile(i)
	return t != null and t.alive


## A hero can stand on tile t: inside the map, not a prop, not a live deposit.
func is_walkable(t: Vector2i) -> bool:
	if not Layout.in_map(t) or Layout.is_prop_tile(t):
		return false
	var d := Layout.deposit_at(t)
	return d == -1 or not tiles[d].alive


func play_spawn_all(step: float) -> void:
	for d in tiles.size():
		if tiles[d].alive:
			tiles[d].play_spawn(d * step)


func apply_config() -> void:
	for t in tiles:
		t.apply_config()


func _on_tile_died(d: int, last_dmg: int) -> void:
	tile_died.emit(d, last_dmg)
