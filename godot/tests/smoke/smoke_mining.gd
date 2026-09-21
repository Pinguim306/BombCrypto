extends Node
## Smoke test for the mining screen (design §12 step 4). Run it as a SCENE so
## the autoloads (Config / GameState / Backend / Juice / Sfx) exist — a `-s`
## script cannot reference autoload singletons at compile time:
##
##   $GODOT --headless --path godot res://tests/smoke/smoke_mining.tscn -- --no-fx --scenario=default
##
## Instantiates mining.tscn, feeds it the default fixture through the same
## GameState.state_applied path the game uses, runs ~120 frames and asserts:
## 40 cells with HpBar widths == 58*hp/maxHp, dead-variant textures per
## Rules.dead_variant, rows bound to the first heroes, popup open()/close(),
## and that rendering twice (plus a real diff) is idempotent.
## Prints "OK smoke" and exits 0, or the failures and exits 1.

const FIXTURE := "res://resources/fixtures/state_default.json"
const MINING_SCENE := "res://scenes/mining/mining.tscn"
const EPS := 0.001

var _fails: Array[String] = []
var _checks := 0


func _ready() -> void:
	_run()


func _run() -> void:
	await get_tree().process_frame
	var packed: PackedScene = load(MINING_SCENE)
	if packed == null:
		_fail("cannot load " + MINING_SCENE)
		_finish()
		return
	var mining: Mining = packed.instantiate() as Mining
	if mining == null:
		_fail("mining.tscn root is not a Mining")
		_finish()
		return
	add_child(mining)
	await get_tree().process_frame

	var model := _fixture()
	if model == null:
		_finish()
		return
	_apply(model, StateDiff.initial(model))
	await _frames(120)
	_check_all(mining, model, "first render")
	_check_popup(mining, model)

	# rendering the same data again must change nothing
	var model2 := _fixture()
	_apply(model2, StateDiff.compute(model, model2))
	await _frames(10)
	_check_all(mining, model2, "second render")

	# a real server diff: one block dies, one is damaged, a hero rests
	var model3 := _fixture()
	model3.blocks[3].hp = 0
	model3.blocks[4].hp = 5
	model3.heroes[0].mode = "rest"
	_apply(model3, StateDiff.compute(model2, model3))
	await _frames(10)
	_check_all(mining, model3, "third render (diff)")
	_finish()


# ---------------------------------------------------------------- checks

func _check_all(mining: Mining, m: StateModel, label: String) -> void:
	_check_cells(mining, m, label)
	_check_rows(mining, m, label)
	_check_hud(mining, m, label)


func _check_cells(mining: Mining, m: StateModel, label: String) -> void:
	var grid: BlockGrid = mining.get_node("World/Grid")
	_eq(grid.get_child_count(), 40, "%s: 40 cells" % label)
	_eq(grid.cells.size(), 40, "%s: 40 cell refs" % label)
	for i in mini(40, grid.cells.size()):
		var c: BlockCell = grid.cells[i]
		var b: BlockModel = m.blocks[i]
		_eq(c.name, "Cell%02d" % i, "%s: cell %d name" % [label, i])
		_eq(c.index, i, "%s: cell %d index" % [label, i])
		_eq(c.alive, b.alive(), "%s: cell %d alive" % [label, i])
		var hp_bar: HpBar = c.get_node("HpBar")
		if b.alive():
			var expected := "block_%d" % Rules.block_tier(b.max_hp)
			_eq(c.current_key, expected, "%s: cell %d texture key" % [label, i])
			_eq(_tex_name(c.get_node("Pivot/Body")), expected, "%s: cell %d Body texture" % [label, i])
			_ok(c.get_node("Pivot/Body").visible and not c.get_node("Pivot/Dead").visible, "%s: cell %d shows the body" % [label, i])
			_ok(hp_bar.visible, "%s: cell %d hp bar visible" % [label, i])
			_approx(hp_bar.fill_width(), 58.0 * float(b.hp) / float(b.max_hp), "%s: cell %d hp width" % [label, i])
			var crack: Sprite2D = c.get_node("Pivot/Crack")
			var level := Rules.crack_level(b.hp, b.max_hp)
			_eq(crack.visible, level > 0, "%s: cell %d crack visible" % [label, i])
			if level > 0:
				_eq(_tex_name(crack), "crack_%d" % level, "%s: cell %d crack texture" % [label, i])
		else:
			var expected := Rules.dead_variant(i)
			_eq(c.current_key, expected, "%s: cell %d dead key" % [label, i])
			_eq(_tex_name(c.get_node("Pivot/Dead")), expected, "%s: cell %d Dead texture" % [label, i])
			_ok(c.get_node("Pivot/Dead").visible and not c.get_node("Pivot/Body").visible, "%s: cell %d shows the dead floor" % [label, i])
			_ok(not hp_bar.visible, "%s: cell %d hp bar hidden" % [label, i])
	# the deterministic crystal pattern (indices 1, 6, ..., 36)
	for i in [1, 6, 11, 16, 21, 26, 31, 36]:
		_eq(Rules.dead_variant(i), "block_dead2", "dead_variant(%d)" % i)


func _check_rows(mining: Mining, m: StateModel, label: String) -> void:
	var list: HeroList = mining.get_node("Hud/Root/HeroPanel/Rows")
	_eq(list.rows.size(), 4, "%s: 4 rows" % label)
	var per := Config.PER_PAGE
	for i in list.rows.size():
		var row: HeroRow = list.rows[i]
		_eq(row.name, "Row%d" % i, "%s: row %d name" % [label, i])
		if i < mini(per, m.heroes.size()):
			var h := m.heroes[i]
			_ok(row.visible, "%s: row %d visible" % [label, i])
			_eq(row.hero_id, h.id, "%s: row %d hero id" % [label, i])
			_eq((row.get_node("NameLabel") as Label).text, Fmt.hero_name(h), "%s: row %d name label" % [label, i])
			_eq((row.get_node("ModeLine/ModeLabel") as Label).text, Fmt.mode_label(h), "%s: row %d mode label" % [label, i])
			_eq((row.get_node("StaminaLabel") as Label).text, Fmt.stamina_line(h), "%s: row %d stamina label" % [label, i])
			_approx((row.get_node("StaminaBar") as ColorRect).size.x, 124.0 * h.stamina_ratio(), "%s: row %d stamina width" % [label, i])
			_eq((row.get_node("ModeLine/HomeIcon") as TextureRect).visible, h.is_housed(), "%s: row %d home icon" % [label, i])
			# "rest" is a one-shot (0.3 s): current_animation clears when it ends, assigned_animation stays
			_eq(String((row.get_node("Anim") as AnimationPlayer).assigned_animation), "work" if h.is_working() else "rest", "%s: row %d animation" % [label, i])
		else:
			_ok(not row.visible, "%s: row %d hidden" % [label, i])
	_eq((mining.get_node("Hud/Root/HeroPanel/Pager") as Control).visible, m.heroes.size() > per, "%s: pager visibility" % label)


func _check_hud(mining: Mining, m: StateModel, label: String) -> void:
	var pending: Pill = mining.get_node("Hud/Root/PendingPill")
	_eq(pending.value_label.text, Fmt.pending_pill(m.pending, m.min_blast), "%s: pending pill" % label)
	var rate: Pill = mining.get_node("Hud/Root/RatePill")
	_eq(rate.value_label.text, Fmt.rate_pill(Rules.team_rate(m.heroes)), "%s: rate pill" % label)
	var claim: JuiceButton = mining.get_node("Hud/Root/ClaimButton")
	var can := Rules.can_claim(m.pending, m.min_blast)
	_eq(claim.label, "Claim" if can else "Locked", "%s: claim label" % label)
	_eq(claim.disabled, not can, "%s: claim gate" % label)
	_eq((mining.get_node("Hud/Root/InfoLine") as Label).text, Fmt.info_line(m.attempts_today, m.min_blast, m.cooldown_hours), "%s: info line" % label)
	_eq((mining.get_node("Hud/Root/HousesPanel/HousesText") as RichTextLabel).text, Fmt.houses_text(m.houses), "%s: houses text" % label)
	for i in 3:
		var card: StageCard = mining.get_node("Hud/Root/Stages/Stage%d" % i)
		if i < m.stages.size():
			_ok(card.visible, "%s: stage %d visible" % [label, i])
			_eq(card.stage_id, m.stages[i].id, "%s: stage %d id" % [label, i])
			var sel := m.stages[i].id == GameState.selected_stage
			_eq(card.is_selected, sel, "%s: stage %d selected" % [label, i])
			_eq((card.get_node("Text") as RichTextLabel).text, Fmt.stage_card(m.stages[i], sel), "%s: stage %d text" % [label, i])
		else:
			_ok(not card.visible, "%s: stage %d hidden" % [label, i])
	_eq((mining.get_node("Hud/Root/TitleRibbon") as Ribbon).text, "TREASURE MINING", "%s: ribbon" % label)


func _check_popup(mining: Mining, m: StateModel) -> void:
	var popup: HeroPopup = mining.get_node("PopupLayer/Popup")
	_ok(not popup.visible, "popup hidden initially")
	if m.heroes.is_empty():
		return
	var h := m.heroes[0]
	mining.open_popup(h.id)
	_ok(popup.visible and popup.is_open, "popup open() shows it")
	_eq(popup.hero_id, h.id, "popup captured hero id")
	_eq((popup.get_node("Stats") as Label).text, Fmt.hero_stats(h), "popup stats")
	_eq((popup.get_node("StatusLine") as Label).text, Fmt.status_line(h), "popup status line")
	_eq((popup.get_node("Ribbon") as Ribbon).text, "%s Hero" % Rules.rarity_name(h.rarity), "popup ribbon")
	_eq((popup.get_node("WorkRestBtn") as JuiceButton).label, "Rest" if h.is_working() else "Work", "popup work/rest label")
	_eq((popup.get_node("ShelterBtn") as JuiceButton).label, "Leave House" if h.is_housed() else "Shelter", "popup shelter label")
	popup.close()
	_ok(not popup.visible and not popup.is_open, "popup close() hides it")
	# a hero that disappears closes an open popup on rebind
	mining.open_popup(h.id)
	var gone := _fixture()
	gone.heroes.remove_at(0)
	popup.rebind(gone)
	_ok(not popup.is_open, "popup closes when its hero is gone")
	mining.open_popup("no-such-hero")
	_ok(not popup.visible, "popup ignores unknown hero ids")


# ---------------------------------------------------------------- plumbing

func _apply(m: StateModel, d: StateDiff) -> void:
	GameState.state = m
	GameState.state_applied.emit(m, d)


func _fixture() -> StateModel:
	var text := FileAccess.get_file_as_string(FIXTURE)
	if text.is_empty():
		_fail("cannot read " + FIXTURE)
		return null
	var m := StateModel.parse(JSON.parse_string(text))
	if m == null:
		_fail("fixture does not parse: " + StateModel.last_error)
	return m


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _tex_name(sprite: Sprite2D) -> String:
	if sprite == null or sprite.texture == null:
		return ""
	return sprite.texture.resource_path.get_file().get_basename()


func _ok(cond: bool, msg: String) -> void:
	_checks += 1
	if not cond:
		_fail(msg)


func _eq(actual: Variant, expected: Variant, msg: String) -> void:
	_checks += 1
	if actual != expected:
		_fail("%s: expected %s got %s" % [msg, var_to_str(expected), var_to_str(actual)])


func _approx(actual: float, expected: float, msg: String) -> void:
	_checks += 1
	if absf(actual - expected) > EPS:
		_fail("%s: expected ~%f got %f" % [msg, expected, actual])


func _fail(msg: String) -> void:
	_fails.append(msg)


func _finish() -> void:
	if _fails.is_empty():
		print("OK smoke (%d checks)" % _checks)
		get_tree().quit(0)
	else:
		for f in _fails:
			printerr("FAIL " + f)
		print("FAILED smoke: %d of %d checks" % [_fails.size(), _checks])
		get_tree().quit(1)
