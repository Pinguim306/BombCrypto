import Phaser from "phaser";

/**
 * MinerBlast UI kit — ornate pixel-style panels, ribbons, pills and chunky
 * 3D buttons. Original design in the game's own navy/orange identity.
 */

const C = {
  outline: 0x0a0e18,
  fill: 0x161d2e,
  bevelLight: 0x3a4a6b,
  bevelDark: 0x0f1420,
  accent: 0xe8952f,
};

/** Ornate rounded panel: dark outline, inner bevel and riveted corners. */
export function drawPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = C.fill
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // outer outline
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(x - 2, y - 2, width + 4, height + 4, 10);
  // body
  g.fillStyle(fill, 0.97);
  g.fillRoundedRect(x, y, width, height, 8);
  // bevel: light top edge, dark bottom edge
  g.fillStyle(C.bevelLight, 0.55);
  g.fillRoundedRect(x + 3, y + 3, width - 6, 3, 2);
  g.fillStyle(C.bevelDark, 0.8);
  g.fillRoundedRect(x + 3, y + height - 6, width - 6, 3, 2);
  // subtle border
  g.lineStyle(2, 0x2a3550, 1);
  g.strokeRoundedRect(x, y, width, height, 8);
  // riveted corner studs
  g.fillStyle(C.accent, 0.85);
  const s = 4;
  g.fillRect(x + 5, y + 5, s, s);
  g.fillRect(x + width - 9, y + 5, s, s);
  g.fillRect(x + 5, y + height - 9, s, s);
  g.fillRect(x + width - 9, y + height - 9, s, s);
  return g;
}

/** Banner-style title ribbon centered at (cx, y). Returns its container. */
export function drawRibbon(
  scene: Phaser.Scene,
  cx: number,
  y: number,
  text: string,
  width?: number
): Phaser.GameObjects.Container {
  const label = scene.add.text(0, 0, text, {
    fontFamily: "monospace",
    fontSize: "17px",
    color: "#221400",
    fontStyle: "bold",
  }).setOrigin(0.5);
  const w = width ?? Math.max(150, label.width + 56);
  const h = 32;

  const g = scene.add.graphics();
  // notched banner tails
  g.fillStyle(0xa05f10, 1);
  g.fillTriangle(-w / 2 - 14, 0, -w / 2 + 4, -h / 2, -w / 2 + 4, h / 2);
  g.fillTriangle(w / 2 + 14, 0, w / 2 - 4, -h / 2, w / 2 - 4, h / 2);
  // main band with outline + highlight
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 6);
  g.fillStyle(C.accent, 1);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 5);
  g.fillStyle(0xffcf80, 0.9);
  g.fillRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, 4, 2);

  const c = scene.add.container(cx, y, [g, label]);
  return c;
}

/** Dark pill counter (e.g. currency HUD). Returns the value text handle. */
export function drawPill(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  icon: string,
  initial = ""
): Phaser.GameObjects.Text {
  const h = 28;
  const g = scene.add.graphics();
  g.fillStyle(C.outline, 1);
  g.fillRoundedRect(x - 2, y - 2, width + 4, h + 4, 16);
  g.fillStyle(0x101624, 1);
  g.fillRoundedRect(x, y, width, h, 14);
  g.lineStyle(2, 0x2a3550, 1);
  g.strokeRoundedRect(x, y, width, h, 14);
  scene.add.image(x + 16, y + h / 2, icon).setScale(0.6);
  return scene.add.text(x + 32, y + h / 2, initial, {
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#ffca28",
    fontStyle: "bold",
  }).setOrigin(0, 0.5);
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

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/**
 * Chunky 3D pixel button: dark outline, bottom shadow edge, hover lightening
 * and a pressed "push down" state. Centered at (x, y).
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
  const edge = 4; // 3D bottom edge
  const container = scene.add.container(x, y);

  const bg = scene.add.graphics();
  const face = scene.add.container(0, 0); // face moves down when pressed

  const draw = (c: number, pressed: boolean, alpha = 1) => {
    bg.clear();
    const off = pressed ? edge - 1 : 0;
    // outline
    bg.fillStyle(C.outline, alpha);
    bg.fillRoundedRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + edge + 2, 10);
    // bottom shadow edge
    bg.fillStyle(shade(c, 0.45), alpha);
    bg.fillRoundedRect(-w / 2, -h / 2 + edge, w, h, 8);
    // face
    bg.fillStyle(c, alpha);
    bg.fillRoundedRect(-w / 2, -h / 2 + off, w, h, 8);
    // top highlight
    bg.fillStyle(0xffffff, 0.18 * alpha);
    bg.fillRoundedRect(-w / 2 + 3, -h / 2 + off + 3, w - 6, 4, 2);
    face.setY(off);
  };
  draw(color, false);

  const icon = opts.icon ? scene.add.image(0, 0, opts.icon).setScale(opts.iconScale ?? 0.6) : null;
  const text = scene.add.text(0, 0, label, {
    fontFamily: "monospace",
    fontSize: opts.fontSize ?? "13px",
    color: opts.textColor ?? "#ffffff",
    fontStyle: "bold",
  }).setOrigin(0.5);

  const layout = () => {
    const iw = icon ? icon.displayWidth + 6 : 0;
    text.setX(iw / 2);
    if (icon) icon.setX(-text.width / 2 - 3);
  };
  face.add(icon ? [icon, text] : [text]);
  container.add([bg, face]);
  layout();

  let enabled = true;
  let handler: (() => void) | null = null;

  container.setSize(w, h + edge);
  container.setInteractive(
    new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h + edge),
    Phaser.Geom.Rectangle.Contains
  );
  container.on("pointerover", () => {
    if (enabled) draw(shade(color, 1.18), false);
    scene.input.setDefaultCursor("pointer");
  });
  container.on("pointerout", () => {
    draw(color, false, enabled ? 1 : 0.4);
    scene.input.setDefaultCursor("default");
  });
  container.on("pointerdown", () => {
    if (!enabled) return;
    draw(shade(color, 0.9), true);
  });
  container.on("pointerup", () => {
    if (!enabled) return;
    draw(shade(color, 1.18), false);
    if (handler) handler();
  });

  return {
    container,
    setEnabled(on: boolean) {
      enabled = on;
      draw(color, false, on ? 1 : 0.4);
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
