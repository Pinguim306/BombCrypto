extends Node
## Smoke test for the mine screen. Run it as a SCENE so the autoloads
## (Config / GameState / Backend / Juice / Sfx) exist — a `-s` script cannot
## reference autoload singletons at compile time:
##
##   $GODOT --headless --path godot res://tests/smoke/smoke_mining.tscn -- --no-fx --scenario=default
##
## Instantiates mine.tscn, feeds it the default fixture through the same
## GameState.state_applied path the game uses, runs ~120 frames and asserts:
## 20 deposits (2 server blocks each) at their scattered Layout positions,
## damage frame per Rules.crack_level of the summed hp, HpBar widths ==
## 40*sum(hp)/sum(maxHp),
## dead tiles showing crater (+crystal per Rules.dead_variant), one hero actor
## per hero standing on a walkable tile (sleeping when resting), roster cards
## bound to the first heroes, popup open()/close(), and that rendering twice
## (plus a real diff) is idempotent. Prints "OK smoke" and exits 0.

const FIXTURE := "res://resources/fixtures/state_default.json"
const MINE_SCENE := "res://scenes/mine/mine.tscn"
const EPS := 0.001

var _fails: Array[String] = []
var _checks := 0


func _ready() -> void:
	_run()


func _run() -> void:
	await get_tree().process_frame
	var packed: PackedScene = load(MINE_SCENE)
	if packed == null:
		_fail("cannot load " + MINE_SCENE)
		_finish()
		return
	var mine: Mine = packed.instantiate() as Mine
	if mine == null:
		_fail("mine.tscn root is not a Mine")
		_finish()
		return
	add_child(mine)
	await get_tree().process_frame

	var model := _fixture()
	if model == null:
		_finish()
		return
	_apply(model, StateDiff.initial(model))
	await _frames(120)
	_check_all(mine, model, "first render")
	_check_popup(mine, model)

	# rendering the same data again must change nothing
	var model2 := _fixture()
	_apply(model2, StateDiff.compute(model, model2))
	await _frames(10)
	_check_all(mine, model2, "second render")

	# a real server diff: one deposit dies (both blocks), one is damaged, a hero rests
	var model3 := _fixture()
	model3.blocks[6].hp = 0
	model3.blocks[7].hp = 0
	model3.blocks[8].hp = 5
	model3.heroes[0].mode = "rest"
	_apply(model3, StateDiff.compute(model2, model3))
	await _frames(10)
	_check_all(mine, model3, "third render (diff)")

	# a hero leaves the team: its actor and card go away
	var model4 := _fixture()
	model4.blocks[6].hp = 0
	model4.blocks[7].hp = 0
	model4.blocks[8].hp = 5
	model4.heroes[0].mode = "rest"
	var gone_id := model4.heroes[model4.heroes.size() - 1].id
	model4.heroes.remove_at(model4.heroes.size() - 1)
	_apply(model4, StateDiff.compute(model3, model4))
	await _frames(10)
	_check_all(mine, model4, "fourth render (hero removed)")
	_ok(mine.heroes.actor(gone_id) == null, "removed hero has no actor")
	_finish()


# ---------------------------------------------------------------- checks

func _check_all(mine: Mine, m: StateModel, label: String) -> void:
	_check_blocks(mine, m, label)
	_check_actors(mine, m, label)
	_check_cards(mine, m, label)
	_check_hud(mine, m, label)


func _check_blocks(mine: Mine, m: StateModel, label: String) -> void:
	var field: BlockField = mine.get_node("World/Map/Actors/Blocks")
	var per := Layout.BLOCKS_PER_DEPOSIT
	_eq(field.get_child_count(), Layout.DEPOSIT_COUNT, "%s: %d deposits" % [label, Layout.DEPOSIT_COUNT])
	_eq(field.tiles.size(), Layout.DEPOSIT_COUNT, "%s: deposit refs" % label)
	for d in mini(Layout.DEPOSIT_COUNT, field.tiles.size()):
		var t: BlockTile = field.tiles[d]
		var sum_hp := 0
		var sum_max := 0
		var top_max := 0
		for k in per:
			var b: BlockModel = m.blocks[d * per + k]
			sum_hp += b.hp
			sum_max += b.max_hp
			top_max = maxi(top_max, b.max_hp)
		_eq(t.name, "Deposit%02d" % d, "%s: deposit %d name" % [label, d])
		_eq(t.index, d, "%s: deposit %d index" % [label, d])
		_eq(t.position, Layout.deposit_origin(d) + Vector2(0, Layout.TILE), "%s: deposit %d position" % [label, d])
		_eq(t.alive, sum_hp > 0, "%s: deposit %d alive" % [label, d])
		_eq(t.hp, sum_hp, "%s: deposit %d hp sum" % [label, d])
		var hp_bar: HpBar = t.get_node("HpBar")
		var body: Sprite2D = t.get_node("Pivot/Body")
		var crater: Sprite2D = t.get_node("Crater")
		var crystal: Sprite2D = t.get_node("Crystal")
		if sum_hp > 0:
			var tier := Rules.block_tier(top_max)
			_eq(t.current_key, "block_%d" % tier, "%s: deposit %d texture key" % [label, d])
			var atlas := body.texture as AtlasTexture
			_ok(atlas != null, "%s: deposit %d body is a strip frame" % [label, d])
			if atlas != null:
				_eq(atlas.atlas.resource_path.get_file(), "ore_%d_%d.png" % [tier, d % 2], "%s: deposit %d ore strip" % [label, d])
				var level := Rules.crack_level(sum_hp, sum_max)
				_eq(t.damage_level, level, "%s: deposit %d damage level" % [label, d])
				_eq(atlas.region.position.x, float(level * 48), "%s: deposit %d damage frame" % [label, d])
			_ok(body.visible and not crater.visible and not crystal.visible, "%s: deposit %d shows the mound" % [label, d])
			_ok(hp_bar.visible, "%s: deposit %d hp bar visible" % [label, d])
			_approx(hp_bar.fill_width(), 40.0 * float(sum_hp) / float(sum_max), "%s: deposit %d hp width" % [label, d])
		else:
			var with_crystal := Rules.dead_variant(d) == "block_dead2"
			_eq(t.current_key, "dead_crystal" if with_crystal else "dead", "%s: deposit %d dead key" % [label, d])
			_ok(not body.visible and crater.visible, "%s: deposit %d shows the crater" % [label, d])
			_eq(crystal.visible, with_crystal, "%s: deposit %d crystal" % [label, d])
			_ok(not hp_bar.visible, "%s: deposit %d hp bar hidden" % [label, d])
	for d in [1, 6, 11, 16]:
		_eq(Rules.dead_variant(d), "block_dead2", "dead_variant(%d)" % d)
	# every block index maps to a deposit on a real tile
	for i in Layout.BLOCK_COUNT:
		_ok(Layout.in_map(Layout.block_tile(i)), "%s: block %d has a deposit tile" % [label, i])


func _check_actors(mine: Mine, m: StateModel, label: String) -> void:
	var actors: HeroActors = mine.get_node("World/Map/Actors/Heroes")
	var expected := mini(m.heroes.size(), Layout.MAX_ACTORS)
	_eq(actors.actors.size(), expected, "%s: one actor per hero" % label)
	var tiles_seen: Dictionary = {}
	for i in expected:
		var h := m.heroes[i]
		var a: HeroActor = actors.actor(h.id)
		if a == null:
			_fail("%s: hero %s has no actor" % [label, h.id])
			continue
		_eq(a.hero_id, h.id, "%s: actor %d id" % [label, i])
		_eq(a.rarity, h.rarity, "%s: actor %d rarity" % [label, i])
		_ok(Layout.in_map(a.tile), "%s: actor %d on the map" % [label, i])
		_ok(mine.field.is_walkable(a.target_tile), "%s: actor %d spot walkable" % [label, i])
		_ok(not tiles_seen.has(a.target_tile), "%s: actor %d spot not shared" % [label, i])
		tiles_seen[a.target_tile] = true
		var sf := (a.get_node("Sprite") as AnimatedSprite2D).sprite_frames
		_ok(sf != null and sf.has_animation(&"walk") and sf.has_animation(&"throw"), "%s: actor %d has hero frames" % [label, i])
		if not h.is_working():
			_eq(a.state, HeroActor.State.SLEEP, "%s: resting hero %d sleeps" % [label, i])
			_eq((a.get_node("Sprite") as AnimatedSprite2D).animation, &"sleep", "%s: resting hero %d sleep anim" % [label, i])
		else:
			_ok(a.state != HeroActor.State.SLEEP, "%s: working hero %d is awake" % [label, i])


func _check_cards(mine: Mine, m: StateModel, label: String) -> void:
	var list: HeroCards = mine.get_node("Hud/Root/Cards")
	_eq(list.cards.size(), 4, "%s: 4 cards" % label)
	var per := Config.PER_PAGE
	for i in list.cards.size():
		var card: HeroCard = list.cards[i]
		_eq(card.name, "Card%d" % i, "%s: card %d name" % [label, i])
		if i < mini(per, m.heroes.size()):
			var h := m.heroes[i]
			_ok(card.visible, "%s: card %d visible" % [label, i])
			_eq(card.hero_id, h.id, "%s: card %d hero id" % [label, i])
			_eq((card.get_node("NameLabel") as Label).text, Fmt.hero_name(h), "%s: card %d name label" % [label, i])
			_eq((card.get_node("ModeLine/ModeLabel") as Label).text, Fmt.mode_label(h), "%s: card %d mode label" % [label, i])
			_eq((card.get_node("StaminaLabel") as Label).text, Fmt.stamina_line(h), "%s: card %d stamina label" % [label, i])
			_approx((card.get_node("StaminaBar") as ColorRect).size.x, HeroCard.BAR_W * h.stamina_ratio(), "%s: card %d stamina width" % [label, i])
			_eq((card.get_node("HomeIcon") as TextureRect).visible, h.is_housed(), "%s: card %d home icon" % [label, i])
			_eq(_tex_name(card.get_node("Frame/Portrait") as TextureRect), "portrait_%d" % h.rarity, "%s: card %d portrait" % [label, i])
		else:
			_ok(not card.visible, "%s: card %d hidden" % [label, i])
	_eq((mine.get_node("Hud/Root/Pager") as Control).visible, m.heroes.size() > per, "%s: pager visibility" % label)


func _check_hud(mine: Mine, m: StateModel, label: String) -> void:
	var pending: CounterPlate = mine.get_node("Hud/Root/PendingPlate")
	_eq(pending.value_label.text, Fmt.blast2(m.pending) + " BLAST", "%s: pending plate" % label)
	_eq(pending.sub_label.text, "min %s to claim" % Fmt.thousands(m.min_blast), "%s: pending sub" % label)
	var rate: CounterPlate = mine.get_node("Hud/Root/RatePlate")
	_eq(rate.value_label.text, Fmt.rate_pill(Rules.team_rate(m.heroes)), "%s: rate plate" % label)
	var claim: TexButton = mine.get_node("Hud/Root/ClaimButton")
	var can := Rules.can_claim(m.pending, m.min_blast)
	_eq(claim.label, "Claim" if can else "Locked", "%s: claim label" % label)
	_eq(claim.disabled, not can, "%s: claim gate" % label)
	_eq((mine.get_node("Hud/Root/InfoLine") as Label).text, Fmt.info_line(m.attempts_today, m.min_blast, m.cooldown_hours), "%s: info line" % label)
	_eq((mine.get_node("Hud/Root/HousesText") as RichTextLabel).text, Fmt.houses_text(m.houses), "%s: houses text" % label)
	for i in 3:
		var card: StageCard = mine.get_node("Hud/Root/Stages/Stage%d" % i)
		if i < m.stages.size():
			_ok(card.visible, "%s: stage %d visible" % [label, i])
			_eq(card.stage_id, m.stages[i].id, "%s: stage %d id" % [label, i])
			var sel := m.stages[i].id == GameState.selected_stage
			_eq(card.is_selected, sel, "%s: stage %d selected" % [label, i])
			_eq((card.get_node("Frame") as NinePatchRect).visible, sel, "%s: stage %d gold frame" % [label, i])
			_eq((card.get_node("Text") as RichTextLabel).text, Fmt.stage_card(m.stages[i], sel), "%s: stage %d text" % [label, i])
		else:
			_ok(not card.visible, "%s: stage %d hidden" % [label, i])
	_eq((mine.get_node("Hud/Root/ExpeditionRibbon") as Ribbon).text, "EXPEDITION", "%s: expedition ribbon" % label)
	_eq((mine.get_node("Hud/Root/HousesRibbon") as Ribbon).text, "HOUSES", "%s: houses ribbon" % label)
	_ok((mine.get_node("Hud/Root/TopBar") as NinePatchRect).texture != null, "%s: top bar textured" % label)
	_ok((mine.get_node("World/Map/Floor") as Sprite2D).texture != null, "%s: floor textured" % label)
	_ok((mine.get_node("World/Map/Actors/Props/House") as Sprite2D).texture != null, "%s: house textured" % label)


func _check_popup(mine: Mine, m: StateModel) -> void:
	var popup: HeroPopup = mine.get_node("PopupLayer/Popup")
	_ok(not popup.visible, "popup hidden initially")
	if m.heroes.is_empty():
		return
	var h := m.heroes[0]
	mine.open_popup(h.id)
	_ok(popup.visible and popup.is_open, "popup open() shows it")
	_eq(popup.hero_id, h.id, "popup captured hero id")
	_eq((popup.get_node("Stats") as Label).text, Fmt.hero_stats(h), "popup stats")
	_eq((popup.get_node("StatusLine") as Label).text, Fmt.status_line(h), "popup status line")
	_eq((popup.get_node("Ribbon") as Ribbon).text, "%s Hero" % Rules.rarity_name(h.rarity), "popup ribbon")
	_eq((popup.get_node("WorkRestBtn") as TexButton).label, "Rest" if h.is_working() else "Work", "popup work/rest label")
	_eq((popup.get_node("ShelterBtn") as TexButton).label, "Leave House" if h.is_housed() else "Shelter", "popup shelter label")
	_ok((popup.get_node("Portrait/Body") as AnimatedSprite2D).sprite_frames != null, "popup portrait animated")
	popup.close()
	_ok(not popup.visible and not popup.is_open, "popup close() hides it")
	mine.open_popup(h.id)
	var gone := _fixture()
	gone.heroes.remove_at(0)
	popup.rebind(gone)
	_ok(not popup.is_open, "popup closes when its hero is gone")
	mine.open_popup("no-such-hero")
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


func _tex_name(item: CanvasItem) -> String:
	var tex: Texture2D = item.get("texture")
	if tex == null:
		return ""
	return tex.resource_path.get_file().get_basename()


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
