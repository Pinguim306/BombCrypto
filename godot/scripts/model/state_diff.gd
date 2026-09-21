class_name StateDiff
extends RefCounted
## What changed between two consecutive StateModel snapshots. Consumed by Fx/BombSim/UI
## to animate only the deltas (rows and cells are updated in place).

var first: bool = false
var blocks_damaged: Array[int] = []        # alive in both, hp dropped
var blocks_destroyed: Array[int] = []      # alive -> dead
var blocks_revived: Array[int] = []        # dead -> alive, or alive with a different maxHp (fresh block)
var crack_changed: Array[int] = []         # alive in next and Rules.crack_level differs
var map_regenerated: bool = false
var heroes_added: Array[String] = []
var heroes_removed: Array[String] = []
var hero_mode_changed: Array[String] = []
var hero_stamina_changed: Array[String] = []
var pending_before: float = 0.0
var pending_after: float = 0.0
var claim_gate_changed: bool = false

const REGEN_REVIVED_THRESHOLD := 20


## Diff for the very first render: first=true, pending_before == pending_after.
## (Named `initial` because GDScript cannot declare both `var first` and `static func first`.)
static func initial(next: StateModel = null) -> StateDiff:
	var d := StateDiff.new()
	d.first = true
	if next != null:
		d.pending_before = next.pending
		d.pending_after = next.pending
	return d


## prev == null -> initial(). Otherwise an element-wise comparison.
static func compute(prev: StateModel, next: StateModel) -> StateDiff:
	if next == null:
		return initial()
	if prev == null:
		return initial(next)
	var d := StateDiff.new()
	d.pending_before = prev.pending
	d.pending_after = next.pending
	d.claim_gate_changed = Rules.can_claim(prev.pending, prev.min_blast) != Rules.can_claim(next.pending, next.min_blast)

	# ---- blocks ----
	var n := mini(prev.blocks.size(), next.blocks.size())
	for i in n:
		var a := prev.blocks[i]
		var b := next.blocks[i]
		var was_alive := a.hp > 0
		var is_alive := b.hp > 0
		if is_alive and (not was_alive or a.max_hp != b.max_hp):
			d.blocks_revived.append(i)
		elif was_alive and not is_alive:
			d.blocks_destroyed.append(i)
		elif was_alive and is_alive and b.hp < a.hp:
			d.blocks_damaged.append(i)
		if is_alive and a.crack_level() != b.crack_level():
			d.crack_changed.append(i)
	d.map_regenerated = prev.first_alive_index() == -1 or d.blocks_revived.size() >= REGEN_REVIVED_THRESHOLD
	if d.map_regenerated and next.first_alive_index() == -1:
		d.map_regenerated = false   # both cleared: nothing new to show

	# ---- heroes (keyed by id) ----
	var prev_by_id: Dictionary = {}
	for h: HeroModel in prev.heroes:
		prev_by_id[h.id] = h
	var seen: Dictionary = {}
	for h: HeroModel in next.heroes:
		seen[h.id] = true
		if not prev_by_id.has(h.id):
			d.heroes_added.append(h.id)
			continue
		var p: HeroModel = prev_by_id[h.id]
		if p.mode != h.mode:
			d.hero_mode_changed.append(h.id)
		if p.stamina != h.stamina:
			d.hero_stamina_changed.append(h.id)
	for h: HeroModel in prev.heroes:
		if not seen.has(h.id):
			d.heroes_removed.append(h.id)
	return d


func has_block_changes() -> bool:
	return not (blocks_damaged.is_empty() and blocks_destroyed.is_empty() and blocks_revived.is_empty())


func has_hero_changes() -> bool:
	return not (heroes_added.is_empty() and heroes_removed.is_empty() and hero_mode_changed.is_empty() and hero_stamina_changed.is_empty())


func pending_delta() -> float:
	return pending_after - pending_before
