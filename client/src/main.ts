// Buffer polyfill for the siwe package in the browser
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;

import Phaser from "phaser";
import { ConnectScene } from "./scenes/ConnectScene";
import { MiningScene } from "./scenes/MiningScene";
import { MarketScene } from "./scenes/MarketScene";
import { ShopScene } from "./scenes/ShopScene";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#10141f",
  pixelArt: true, // keeps sprites crisp when scaling
  scale: {
    // FIT scales the whole 800x600 stage to the window, so nothing is
    // ever cropped on small screens (the canvas shrinks instead).
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  scene: [ConnectScene, MiningScene, ShopScene, MarketScene],
});

// Site header -> in-game navigation. Ignored until the player logs in.
const GAME_SCENES = ["mining", "shop", "market"];
let navLock = false; // two nav clicks in one frame would leave two scenes active
window.addEventListener("mb-nav", (e) => {
  if (navLock) return;
  const target = (e as CustomEvent<string>).detail;
  const active = game.scene.getScenes(true).map((s) => s.scene.key);
  const current = GAME_SCENES.find((k) => active.includes(k));
  if (!current) return; // still on the connect screen
  const dest = target === "play" ? "mining" : target;
  if (GAME_SCENES.includes(dest) && dest !== current) {
    navLock = true;
    setTimeout(() => (navLock = false), 150);
    game.scene.getScene(current).scene.start(dest);
  }
});
