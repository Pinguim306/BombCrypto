import Phaser from "phaser";

/** Draws a rounded UI panel (dark fill + subtle border) behind content. */
export function drawPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0x161d2e, 0.92);
  g.fillRoundedRect(x, y, width, height, 8);
  g.lineStyle(2, 0x2a3550, 1);
  g.strokeRoundedRect(x, y, width, height, 8);
  return g;
}
