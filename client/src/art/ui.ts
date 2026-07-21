import Phaser from "phaser";

/** Draws a rounded UI panel (dark fill + subtle border) behind content. */
export function drawPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = 0x161d2e
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(fill, 0.92);
  g.fillRoundedRect(x, y, width, height, 8);
  g.lineStyle(2, 0x2a3550, 1);
  g.strokeRoundedRect(x, y, width, height, 8);
  return g;
}

export interface ButtonOpts {
  width?: number;
  height?: number;
  color?: number; // background
  textColor?: string;
  fontSize?: string;
  icon?: string; // texture key drawn left of the label
  iconScale?: number;
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setEnabled(on: boolean): void;
  setLabel(text: string): void;
  onClick(fn: () => void): void;
}

/**
 * A rounded, filled button with hover feedback and an optional icon.
 * Centered at (x, y). Returns handles to tweak it later.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  opts: ButtonOpts = {}
): Button {
  const w = opts.width ?? 150;
  const h = opts.height ?? 40;
  const color = opts.color ?? 0x2e7d32;
  const container = scene.add.container(x, y);

  const bg = scene.add.graphics();
  const draw = (c: number, alpha = 1) => {
    bg.clear();
    bg.fillStyle(c, alpha);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    bg.lineStyle(2, 0xffffff, 0.14);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
  };
  draw(color);

  const icon = opts.icon ? scene.add.image(0, 0, opts.icon).setScale(opts.iconScale ?? 0.6) : null;
  const text = scene.add.text(0, 0, label, {
    fontFamily: "monospace",
    fontSize: opts.fontSize ?? "13px",
    color: opts.textColor ?? "#ffffff",
    fontStyle: "bold",
  }).setOrigin(0.5);

  // lay out icon + text side by side, centered
  const layout = () => {
    const iw = icon ? icon.displayWidth + 6 : 0;
    text.setX(iw / 2);
    if (icon) icon.setX(-text.width / 2 - 3);
  };
  container.add(icon ? [bg, icon, text] : [bg, text]);
  layout();

  let enabled = true;
  let handler: (() => void) | null = null;

  container.setSize(w, h);
  container.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
  container.on("pointerover", () => { if (enabled) draw(color, 0.75); scene.input.setDefaultCursor("pointer"); });
  container.on("pointerout", () => { draw(color, enabled ? 1 : 0.4); scene.input.setDefaultCursor("default"); });
  container.on("pointerdown", () => { if (enabled && handler) handler(); });

  return {
    container,
    setEnabled(on: boolean) {
      enabled = on;
      draw(color, on ? 1 : 0.4);
    },
    setLabel(t: string) {
      text.setText(t);
      layout();
    },
    onClick(fn: () => void) {
      handler = fn;
    },
  };
}
