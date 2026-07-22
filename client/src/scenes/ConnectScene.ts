import Phaser from "phaser";
import { connectWallet, signIn, reconnectSilently, MOBILE_WALLET_ENABLED, type WalletKind } from "../web3/wallet";
import { hasToken, clearToken, tokenAddress } from "../net/api";
import { registerPixelArt } from "../art/pixelart";
import { drawPanel, makeButton } from "../art/ui";
import { attachPullTicker } from "./pullTicker";

/** Initial screen: connect the wallet and sign the SIWE login. */
export class ConnectScene extends Phaser.Scene {
  constructor() {
    super("connect");
  }

  create() {
    const { width, height } = this.scale;
    registerPixelArt(this);

    // cave backdrop + title panel
    this.add.tileSprite(0, 0, width, height, "cave").setOrigin(0).setAlpha(0.6);
    drawPanel(this, width / 2 - 260, height * 0.18, 520, 330);

    // showcase of heroes of the 6 rarities under the title, bobbing gently.
    // Kept below the tagline (0.46) so the 64px sprites never rise into it.
    for (let r = 0; r < 6; r++) {
      const hero = this.add.image(width / 2 + (r - 2.5) * 70, height * 0.46, `hero-${r}`);
      this.tweens.add({
        targets: hero,
        y: height * 0.46 - 6,
        duration: 700 + r * 90,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    const bomb = this.add.image(width / 2 - 180, height * 0.29, "bomb");
    this.tweens.add({ targets: bomb, angle: 8, duration: 900, yoyo: true, repeat: -1 });
    const spark = this.add.image(width / 2 + 180, height * 0.29, "spark");
    this.tweens.add({ targets: spark, angle: 360, duration: 6000, repeat: -1 });

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
      // Page reload with a live session: silently re-attach the wallet.
      // CRITICAL: only enter if the wallet's current account matches the
      // account the session was issued for — otherwise purchases would go
      // out from one account while the game shows another one's heroes.
      reconnectSilently().then((addr) => {
        const sessionAddr = tokenAddress();
        if (addr && sessionAddr && addr.toLowerCase() !== sessionAddr.toLowerCase()) {
          clearToken(); // wallet switched accounts: force a fresh login
          this.scene.restart();
        } else {
          this.scene.start("mining"); // matching account, or wallet locked (view-only)
        }
      });
      return;
    }

    const status = this.add
      .text(width / 2, height * 0.72, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ef9a9a",
        wordWrap: { width: width * 0.8 },
        align: "center",
      })
      .setOrigin(0.5);

    const connect = async (kind: WalletKind) => {
      try {
        status.setColor("#90a4ae").setText(kind === "walletconnect" ? "scan the QR with your wallet app..." : "connecting...");
        await connectWallet(kind);
        status.setColor("#90a4ae").setText("sign the login message in your wallet...");
        await signIn();
        this.scene.start("mining");
      } catch (err) {
        status.setColor("#ef9a9a").setText((err as Error).message);
      }
    };

    // Browser-extension wallet + (when configured) a mobile WalletConnect option
    if (MOBILE_WALLET_ENABLED) {
      const browser = makeButton(this, width / 2 - 110, height * 0.58, "Browser Wallet", {
        width: 200, height: 48, color: 0x1c2333, textColor: "#4fc3f7", fontSize: "16px",
      });
      browser.onClick(() => connect("injected"));
      const mobile = makeButton(this, width / 2 + 110, height * 0.58, "Mobile Wallet", {
        width: 200, height: 48, color: 0x2e7d32, icon: "coin", iconScale: 0.5, fontSize: "16px",
      });
      mobile.onClick(() => connect("walletconnect"));
      this.add.text(width / 2, height * 0.58 + 42, "browser extension  ·  QR / mobile app", {
        fontFamily: "monospace", fontSize: "11px", color: "#546e7a",
      }).setOrigin(0.5);
    } else {
      const button = this.add
        .text(width / 2, height * 0.58, "[ Connect wallet ]", {
          fontFamily: "monospace", fontSize: "24px", color: "#4fc3f7",
          backgroundColor: "#1c2333", padding: { x: 18, y: 12 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      button.on("pointerdown", () => connect("injected"));
    }

    // live activity ticker — recent hero pulls across all players (social proof)
    attachPullTicker(this, width / 2, height * 0.92, 560, {
      emptyText: "Be the first to pull a Legendary hero!",
    });
  }
}
