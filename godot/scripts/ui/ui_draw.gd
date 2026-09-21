class_name UiDraw
extends RefCounted
## Drawing helpers shared by the @tool UI kit (rounded rects via StyleBoxFlat,
## the 8-bit `shade()` used by client/src/art/ui.ts).


static func rounded(ci: CanvasItem, rect: Rect2, color: Color, radius: float) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(int(radius))
	sb.anti_aliasing = true
	ci.draw_style_box(sb, rect)


static func rounded_stroke(ci: CanvasItem, rect: Rect2, color: Color, radius: float, width: float) -> void:
	var sb := StyleBoxFlat.new()
	sb.draw_center = false
	sb.border_color = color
	sb.set_border_width_all(int(width))
	sb.set_corner_radius_all(int(radius))
	sb.anti_aliasing = true
	ci.draw_style_box(sb, rect)


## Per-channel multiply rounded in 8-bit space, exactly like ui.ts shade().
static func shade(c: Color, f: float) -> Color:
	return Color(
		minf(255.0, roundf(c.r * 255.0 * f)) / 255.0,
		minf(255.0, roundf(c.g * 255.0 * f)) / 255.0,
		minf(255.0, roundf(c.b * 255.0 * f)) / 255.0,
		c.a)
