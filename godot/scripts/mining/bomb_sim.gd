class_name BombSim
extends RefCounted
## Predictive bomb timers (design §4/§13): mirrors the server work loop so the
## explosions land on the block the server actually damages.
##   predict   — per working hero with stamina >= 1, one throw per bombIntervalMs
##               at the first predicted-alive block for min(power, hp); every poll
##               snaps predicted hp back to the server truth.
##   reconcile — zero-mismatch fallback: after each poll, replays the damage the
##               server reported as ceil(drop / avg power) throws (cap 3) spread
##               over 1.8 s, round-robin over the working heroes.
## The sim never feeds gating logic: it only drives visuals.

signal bomb_thrown(hero_id: String, cell_index: int, dmg: int)

const RECONCILE_SPREAD_MS := 1800
const RECONCILE_CAP := 3
const MIN_INTERVAL_MS := 250

var predicted_hp: Array[int] = []
var next_at: Dictionary = {}          # hero_id -> msec of the next throw
var _state: StateModel = null
var _prev: StateModel = null
var _thrown: Dictionary = {}          # hero_id -> throws since the last poll (<= stamina)
var _queue: Array[Dictionary] = []    # reconcile: {at, hero, cell, dmg}
var _rr := 0
var _rng := RandomNumberGenerator.new()


func _init() -> void:
	_rng.randomize()


## Snaps predicted hp to the server; arms timers only for heroes that just
## started working / appeared; drops resting or removed heroes.
func on_state(s: StateModel, d: StateDiff) -> void:
	_prev = _state
	_state = s
	predicted_hp.resize(s.blocks.size())
	for i in s.blocks.size():
		predicted_hp[i] = s.blocks[i].hp
	_thrown.clear()
	var now := Time.get_ticks_msec()
	var keep: Dictionary = {}
	for h: HeroModel in s.heroes:
		if not h.is_working() or h.stamina < 1:
			continue
		keep[h.id] = true
		var fresh := d.first or not next_at.has(h.id) or d.heroes_added.has(h.id) or d.hero_mode_changed.has(h.id)
		if fresh:
			var interval := maxi(MIN_INTERVAL_MS, h.bomb_interval_ms)
			# the server's phase is unknown: start somewhere inside the interval so heroes desync
			next_at[h.id] = now + int(interval * _rng.randf_range(0.35, 1.0))
	for id: Variant in next_at.keys():
		if not keep.has(id):
			next_at.erase(id)
	if Config.bomb_mode == "reconcile":
		reconcile_schedule(d, s)
	else:
		_queue.clear()


func tick(_delta: float) -> void:
	if _state == null:
		return
	var now := Time.get_ticks_msec()
	if Config.bomb_mode == "reconcile":
		_tick_queue(now)
		return
	for h: HeroModel in _state.heroes:
		if not next_at.has(h.id) or not h.is_working() or h.stamina < 1:
			continue
		var due: int = next_at[h.id]
		if now < due:
			continue
		var interval := maxi(MIN_INTERVAL_MS, h.bomb_interval_ms)
		if now - due > interval:
			next_at[h.id] = now + interval   # long stall (hidden tab): no burst
			continue
		var thrown: int = _thrown.get(h.id, 0)
		if thrown >= h.stamina:
			next_at[h.id] = due + interval   # out of stamina until the server says otherwise
			continue
		var target := _first_predicted_alive()
		if target == -1:
			next_at[h.id] = now + interval   # map cleared: wait for the server regen
			continue
		var dmg := mini(h.power, predicted_hp[target])
		predicted_hp[target] -= dmg
		_thrown[h.id] = thrown + 1
		next_at[h.id] = due + interval
		bomb_thrown.emit(h.id, target, dmg)


## Reconcile mode: turn the server's reported damage into a few visual throws.
func reconcile_schedule(d: StateDiff, s: StateModel) -> void:
	if _prev == null or d.first:
		return
	var workers := s.working_heroes()
	if workers.is_empty():
		workers = s.heroes
	if workers.is_empty():
		return
	var avg_power := 0.0
	for h: HeroModel in workers:
		avg_power += float(h.power)
	avg_power = maxf(1.0, avg_power / float(workers.size()))
	var now := Time.get_ticks_msec()
	var cells: Array[int] = []
	cells.append_array(d.blocks_damaged)
	cells.append_array(d.blocks_destroyed)
	for i: int in cells:
		if i >= _prev.blocks.size() or i >= s.blocks.size():
			continue
		var drop := _prev.blocks[i].hp - s.blocks[i].hp
		if drop <= 0:
			continue
		var n := clampi(ceili(float(drop) / avg_power), 1, RECONCILE_CAP)
		var per := ceili(float(drop) / float(n))
		var left := drop
		for k in n:
			var dmg := mini(per, left)
			left -= dmg
			var hero: HeroModel = workers[_rr % workers.size()]
			_rr += 1
			_queue.append({
				"at": now + int(float(k) / float(n) * RECONCILE_SPREAD_MS) + _rng.randi_range(0, 120),
				"hero": hero.id,
				"cell": i,
				"dmg": dmg,
			})


func _tick_queue(now: int) -> void:
	var i := 0
	while i < _queue.size():
		var item: Dictionary = _queue[i]
		if now >= int(item["at"]):
			_queue.remove_at(i)
			bomb_thrown.emit(str(item["hero"]), int(item["cell"]), int(item["dmg"]))
		else:
			i += 1


func reset() -> void:
	next_at.clear()
	_thrown.clear()
	_queue.clear()


func _first_predicted_alive() -> int:
	for i in predicted_hp.size():
		if predicted_hp[i] > 0:
			return i
	return -1
