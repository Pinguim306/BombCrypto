import Phaser from "phaser";
import { ConnectScene } from "./scenes/ConnectScene";
import { MiningScene } from "./scenes/MiningScene";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 800,
  height: 600,
  backgroundColor: "#10141f",
  scene: [ConnectScene, MiningScene],
});
