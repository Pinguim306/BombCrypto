class_name HeroCards
extends Control
## The roster column: four HeroCard slots updated in place and keyed by hero
## id, plus the pager (`../Pager`) shown only when the team does not fit on
## one page (Config.PER_PAGE).

signal hero_pressed(hero_id: String)

const PAGER_ON := Color("ffca28")
const PAGER_OFF := Color("546e7a")

@onready var pager: Control = get_node("../Pager")
@onready var prev_btn: Button = get_node("../Pager/PrevBtn")
@onready var page_label: Label = get_node("../Pager/PageLabel")
@onready var next_btn: Button = get_node("../Pager/NextBtn")

var cards: Array[HeroCard] = []
var pages := 1
var _heroes: Array[HeroModel] = []


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	for i in Config.PER_PAGE:
		var c: HeroCard = get_node("Card%d" % i)
		c.card_index = i
		c.visible = false
		c.pressed.connect(func(id: String) -> void: hero_pressed.emit(id))
		cards.append(c)
	prev_btn.pressed.connect(_prev)
	next_btn.pressed.connect(_next)
	pager.visible = false


## Renders the current page; empty slots fade out.
func set_heroes(heroes: Array[HeroModel]) -> void:
	_heroes = heroes
	var per := Config.PER_PAGE
	pages = maxi(1, ceili(float(heroes.size()) / float(per)))
	if GameState.hero_page >= pages:
		GameState.set_hero_page(pages - 1)
	var page := GameState.hero_page
	for i in cards.size():
		var idx := page * per + i
		if idx < heroes.size():
			cards[i].show_card()
			cards[i].bind(heroes[idx])
		else:
			cards[i].hide_card()
	pager.visible = pages > 1
	page_label.text = Fmt.pager(page, pages)
	prev_btn.add_theme_color_override("font_color", PAGER_ON if page > 0 else PAGER_OFF)
	next_btn.add_theme_color_override("font_color", PAGER_ON if page < pages - 1 else PAGER_OFF)


## The visible card bound to a hero id, or null (hero on another page).
func card_for(id: String) -> HeroCard:
	for c: HeroCard in cards:
		if c.visible and c.hero_id == id:
			return c
	return null


## Mine-all: the cards that just started working flash, 80 ms apart.
func play_mine_all_flourish(ids: Array[String]) -> void:
	if not Config.fx_enabled:
		return
	var tw := create_tween()
	var k := 0
	for c: HeroCard in cards:
		if c.visible and ids.has(c.hero_id):
			if k > 0 and Config.juice_scale() > 0.0:
				tw.tween_interval(0.08)
			tw.tween_callback(c.play_flourish)
			k += 1
	if k == 0:
		tw.kill()


func _prev() -> void:
	if GameState.hero_page > 0:
		GameState.set_hero_page(GameState.hero_page - 1)
		set_heroes(_heroes)
		Sfx.play(&"ui_click")


func _next() -> void:
	if GameState.hero_page < pages - 1:
		GameState.set_hero_page(GameState.hero_page + 1)
		set_heroes(_heroes)
		Sfx.play(&"ui_click")
