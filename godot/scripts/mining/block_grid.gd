class_name BlockGrid
extends Node2D
## The 8x5 block grid at Phaser (258, 90): instances Cell00..Cell39 at
## (col*64, row*64) and forwards state / hits to the cells.

signal cell_died(index: int, last_dmg: int)

const CELL_SCENE: PackedScene = preload("res://scenes/mining/block_cell.tscn")

var cells: Array[BlockCell] = []
var blocks: Array[BlockModel] = []     # last server blocks


func _ready() -> void:
	for i in Rules.BLOCK_COUNT:
		var c: BlockCell = CELL_SCENE.instantiate()
		c.name = "Cell%02d" % i
		c.position = Vector2((i % Rules.COLS) * Rules.TILE, (i / Rules.COLS) * Rules.TILE)
		add_child(c)
		c.setup(i)
		c.died.connect(func(idx: int, dmg: int) -> void: cell_died.emit(idx, dmg))
		cells.append(c)


## Renders every cell from the server truth (idempotent).
func set_state(next: Array[BlockModel], animate: bool) -> void:
	blocks = next
	var n := mini(cells.size(), next.size())
	for i in n:
		cells[i].apply(next[i], animate)


## A predicted bomb landed on cell i. Returns true when the cell just died.
func hit(i: int, dmg: int, _rarity: int = 0) -> bool:
	var c := cell(i)
	if c == null:
		return false
	return c.play_hit(dmg)


func on_diff(d: StateDiff) -> void:
	if d.map_regenerated and not d.first:
		play_spawn_all(0.02)


## Fresh map: every cell pops in with a growing delay.
func regenerate(next: Array[BlockModel]) -> void:
	set_state(next, false)
	play_spawn_all(0.02)


func play_spawn_all(step: float) -> void:
	for i in cells.size():
		cells[i].play_spawn(i * step)


func cell(i: int) -> BlockCell:
	if i < 0 or i >= cells.size():
		return null
	return cells[i]


## Centre of cell i in the shared 800x600 space.
func cell_center(i: int) -> Vector2:
	return Rules.cell_center(i)


## First cell that is visually alive with predicted hp > 0 (row-major), -1 if none.
func first_predicted_alive() -> int:
	for i in cells.size():
		if cells[i].alive and cells[i].predicted_hp > 0:
			return i
	return -1
