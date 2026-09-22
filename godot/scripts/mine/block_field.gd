class_name BlockField
extends Node2D
## The 40 ore blocks on the map (8x5 inside the 12x8 tile grid), y-sorted
## together with the heroes. Renders from the server state, applies predicted
## hits from the bomb sim, and answers walkability questions for the actors.

signal tile_died(index: int, last_dmg: int)

const TILE_SCENE: PackedScene = preload("res://scenes/mine/block_tile.tscn")

var tiles: Array[BlockTile] = []


func _ready() -> void:
	y_sort_enabled = true
	for i in Layout.BLOCK_COUNT:
		var t: BlockTile = TILE_SCENE.instantiate()
		t.name = "Block%02d" % i
		add_child(t)
		t.setup(i)
		t.died.connect(_on_tile_died)
		tiles.append(t)


## Server truth for every block. `animate` = not the first render and FX on.
func set_state(blocks: Array[BlockModel], animate: bool) -> void:
	for i in mini(blocks.size(), tiles.size()):
		tiles[i].apply(blocks[i], animate)


## A predicted bomb hits block i. Returns true when it died visually.
func hit(i: int, dmg: int) -> bool:
	if i < 0 or i >= tiles.size():
		return false
	return tiles[i].play_hit(dmg)


func tile(i: int) -> BlockTile:
	return tiles[i] if i >= 0 and i < tiles.size() else null


## Visual aliveness of block i (false for indices outside the field).
func is_alive(i: int) -> bool:
	return i >= 0 and i < tiles.size() and tiles[i].alive


## A hero can stand on tile t: inside the map, not a prop, not an alive block.
func is_walkable(t: Vector2i) -> bool:
	if not Layout.in_map(t) or Layout.is_prop_tile(t):
		return false
	var b := Layout.block_at(t)
	return b == -1 or not tiles[b].alive


func play_spawn_all(step: float) -> void:
	for i in tiles.size():
		if tiles[i].alive:
			tiles[i].play_spawn(i * step)


func apply_config() -> void:
	for t in tiles:
		t.apply_config()


func _on_tile_died(i: int, last_dmg: int) -> void:
	tile_died.emit(i, last_dmg)
