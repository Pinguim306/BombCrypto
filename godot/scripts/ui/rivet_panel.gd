@tool
class_name RivetPanel
extends Control
## Ornate rounded panel reproducing client/src/art/ui.ts drawPanel(): dark
## outline, inner bevels and riveted corners. Pure _draw — no StyleBox theming,
## so an artist can restyle it in one place.

const OUTLINE := Color("0a0e18")
const BEVEL_LIGHT := Color("3a4a6b")
const BEVEL_DARK := Color("0f1420")
const BORDER := Color("2a3550")
const ACCENT := Color("e8952f")

@export var fill: Color = Color("161d2e"):
	set(v):
		fill = v
		queue_redraw()


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _ready() -> void:
	resized.connect(queue_redraw)


func _draw() -> void:
	var w := size.x
	var h := size.y
	UiDraw.rounded(self, Rect2(-2, -2, w + 4, h + 4), OUTLINE, 10)
	UiDraw.rounded(self, Rect2(0, 0, w, h), Color(fill, 0.97), 8)
	UiDraw.rounded(self, Rect2(3, 3, w - 6, 3), Color(BEVEL_LIGHT, 0.55), 2)
	UiDraw.rounded(self, Rect2(3, h - 6, w - 6, 3), Color(BEVEL_DARK, 0.8), 2)
	UiDraw.rounded_stroke(self, Rect2(0, 0, w, h), BORDER, 8, 2)
	var rivet := Color(ACCENT, 0.85)
	for p: Vector2 in [Vector2(5, 5), Vector2(w - 9, 5), Vector2(5, h - 9), Vector2(w - 9, h - 9)]:
		draw_rect(Rect2(p, Vector2(4, 4)), rivet)
