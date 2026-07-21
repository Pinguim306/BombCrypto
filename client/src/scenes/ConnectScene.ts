import Phaser from "phaser";
import { connectWallet, signIn } from "../web3/wallet";
import { hasToken } from "../net/api";
import { registerPixelArt } from "../art/pixelart";

/** Initial screen: connect the wallet and sign the SIWE login. */
export class ConnectScene extends Phaser.Scene {
  constructor() {
    super("connect");
  }

  create() {
    const { width, height } = this.scale;
    registerPixelArt(this);

    // showcase of heroes of the 6 rarities under the title
    for (let r = 0; r < 6; r++) {
      this.add.image(width / 2 + (r - 2.5) * 70, height * 0.44, `hero-${r}`);
    }
    this.add.image(width / 2 - 180, height * 0.29, "bomb");
    this.add.image(width / 2 + 180, height * 0.29, "spark");

    this.add
      .text(width / 2, height * 0.3, "MINERBLAST", {
        fontFamily: "monospace",
        fontSize: "56px",
        color: "#ffb74d",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.3 + 46, "explosive mining on Robinhood Chain", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#90a4ae",
      })
      .setOrigin(0.5);

    if (hasToken()) {
      this.scene.start("mining");
      return;
    }

    const button = this.add
      .text(width / 2, height * 0.55, "[ Connect wallet ]", {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#4fc3f7",
        backgroundColor: "#1c2333",
        padding: { x: 18, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const status = this.add
      .text(width / 2, height * 0.68, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ef9a9a",
        wordWrap: { width: width * 0.8 },
        align: "center",
      })
      .setOrigin(0.5);

    button.on("pointerdown", async () => {
      try {
        status.setColor("#90a4ae").setText("connecting...");
        await connectWallet();
        status.setText("sign the login message in your wallet...");
        await signIn();
        this.scene.start("mining");
      } catch (err) {
        status.setColor("#ef9a9a").setText((err as Error).message);
      }
    });
  }
}
