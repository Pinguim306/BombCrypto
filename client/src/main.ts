// polyfill de Buffer para o pacote siwe no navegador
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;

import Phaser from "phaser";
import { ConnectScene } from "./scenes/ConnectScene";
import { MiningScene } from "./scenes/MiningScene";
import { MarketScene } from "./scenes/MarketScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 800,
  height: 600,
  backgroundColor: "#10141f",
  pixelArt: true, // mantém os sprites nítidos ao escalar
  scene: [ConnectScene, MiningScene, MarketScene],
});
