import Phaser from "phaser";
import { formatEther } from "viem";
import { gachaPrices, buyChest, buyPack, myUnopenedChests, canOpen, openChest } from "../web3/gacha";
import { housePrices, buyHouse, blastBalance } from "../web3/houses";
import { GACHA_ENABLED, MARKET_ENABLED } from "../config";
import { registerPixelArt, RARITY_COLORS } from "../art/pixelart";
import { drawPanel, makeButton } from "../art/ui";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];

/** Visual shop: buy hero chests with ETH and stamina houses with BLAST. */
export class ShopScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;

  constructor() {
    super("shop");
  }

  create() {
    registerPixelArt(this);
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    this.add.text(24, 20, "SHOP", {
      fontFamily: "monospace", fontSize: "26px", color: "#ffb74d", fontStyle: "bold",
    });
    const back = makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f });
    back.onClick(() => this.scene.start("mining"));

    this.status = this.add.text(24, 566, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae", wordWrap: { width: 750 },
    });

    this.buildChests();
    this.buildHouses();
  }

  // ---------- CHESTS (ETH) ----------
  private buildChests() {
    drawPanel(this, 24, 64, 752, 200);
    this.add.text(44, 78, "HERO CHESTS", {
      fontFamily: "monospace", fontSize: "15px", color: "#eceff1", fontStyle: "bold",
    });
    this.add.text(44, 100, "Each chest reveals 1 hero. Odds: Common 52% · Rare 26% · S.Rare 12%\n" +
      "· Epic 6.5% · Legend 3% · Mythic 0.5%", {
      fontFamily: "monospace", fontSize: "11px", color: "#90a4ae", lineSpacing: 3,
    });

    // big chest art
    const chest = this.add.image(150, 190, "chest").setScale(1.4);
    this.tweens.add({ targets: chest, y: 184, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.add.image(150, 190, "spark").setScale(0.5).setAlpha(0.7);

    if (!GACHA_ENABLED) {
      this.add.text(300, 170, "Chain not configured.", {
        fontFamily: "monospace", fontSize: "13px", color: "#ef9a9a",
      });
      return;
    }

    gachaPrices().then((p) => {
      const single = makeButton(this, 420, 165, `Buy 1 Chest — ${formatEther(p.chestWei)} ETH`, {
        width: 300, height: 46, color: 0x2e7d32, icon: "eth", fontSize: "14px",
      });
      single.onClick(() => this.onBuyChest(p.chestWei, false));

      const pack = makeButton(this, 420, 222, `Buy ${p.packSize}-Pack — ${formatEther(p.packWei)} ETH  (save 20%)`, {
        width: 360, height: 46, color: 0xef6c00, icon: "eth", fontSize: "13px",
      });
      pack.onClick(() => this.onBuyChest(p.packWei, true));
    }).catch(() => {
      this.add.text(300, 170, "Shop unavailable.", {
        fontFamily: "monospace", fontSize: "13px", color: "#ef9a9a",
      });
    });
  }

  private async onBuyChest(valueWei: bigint, pack: boolean) {
    try {
      this.status.setColor("#90a4ae").setText("Confirm the purchase in your wallet...");
      await (pack ? buyPack(valueWei) : buyChest(valueWei));
      this.status.setColor("#ffcc80").setText("Chest bought! Waiting for the reveal window (~30s)...");
      await this.openPendingChests();
    } catch (err) {
      this.status.setColor("#ef9a9a").setText(`Purchase failed: ${(err as Error).message}`);
    }
  }

  private async openPendingChests() {
    for (let attempt = 0; attempt < 24; attempt++) {
      const pending = await myUnopenedChests().catch(() => [] as bigint[]);
      if (pending.length === 0) {
        this.status.setColor("#a5d6a7").setText("All chests opened! Your new heroes appear on the mining screen (~1 min).");
        return;
      }
      const ready: bigint[] = [];
      for (const id of pending) if (await canOpen(id)) ready.push(id);
      for (const id of ready) {
        this.status.setColor("#90a4ae").setText(`Opening chest #${id} — confirm in wallet...`);
        await openChest(id).catch((err) =>
          this.status.setColor("#ef9a9a").setText(`Open failed: ${(err as Error).message}`)
        );
      }
      if (ready.length === 0) await new Promise((r) => setTimeout(r, 5000));
    }
    this.status.setColor("#ffcc80").setText("Some chests are still pending — reopen the shop later to finish opening them.");
  }

  // ---------- HOUSES (BLAST) ----------
  private buildHouses() {
    drawPanel(this, 24, 276, 752, 270);
    this.add.text(44, 290, "STAMINA HOUSES", {
      fontFamily: "monospace", fontSize: "15px", color: "#eceff1", fontStyle: "bold",
    });
    this.add.text(44, 312, "Houses let sheltered heroes recover stamina faster. Paid in BLAST.", {
      fontFamily: "monospace", fontSize: "11px", color: "#90a4ae",
    });
    this.balanceText = this.add.text(540, 292, "", {
      fontFamily: "monospace", fontSize: "12px", color: "#ffca28",
    });

    if (!MARKET_ENABLED) {
      this.add.text(44, 350, "Chain not configured.", {
        fontFamily: "monospace", fontSize: "13px", color: "#ef9a9a",
      });
      return;
    }

    this.refreshBalance();
    housePrices().then((prices) => this.renderHouseCards(prices)).catch(() => {
      this.add.text(44, 350, "Could not load house prices.", {
        fontFamily: "monospace", fontSize: "13px", color: "#ef9a9a",
      });
    });
  }

  private async refreshBalance() {
    const bal = await blastBalance().catch(() => 0n);
    this.balanceText.setText(`Your balance: ${Number(formatEther(bal)).toLocaleString("en-US")} BLAST`);
  }

  private renderHouseCards(prices: bigint[]) {
    prices.forEach((priceWei, rarity) => {
      if (priceWei === 0n) return;
      const cardW = 118;
      const x = 44 + rarity * (cardW + 6);
      const y = 338;

      drawPanel(this, x, y, cardW, 190, 0x1c2536);
      const cx = x + cardW / 2;

      const house = this.add.image(cx, y + 46, "house").setScale(1.7);
      house.setTint(RARITY_COLORS[rarity]);

      this.add.text(cx, y + 88, RARITY_NAMES[rarity], {
        fontFamily: "monospace", fontSize: "12px", color: "#eceff1", fontStyle: "bold",
      }).setOrigin(0.5);

      const capacity = 2 + rarity * 2;
      const regen = 20 + rarity * 15;
      this.add.text(cx, y + 108, `+${regen}% regen`, {
        fontFamily: "monospace", fontSize: "10px", color: "#a5d6a7",
      }).setOrigin(0.5);
      this.add.text(cx, y + 122, `${capacity} hero slots`, {
        fontFamily: "monospace", fontSize: "10px", color: "#90a4ae",
      }).setOrigin(0.5);

      const priceLabel = Number(formatEther(priceWei)).toLocaleString("en-US");
      this.add.image(cx - 28, y + 144, "coin").setScale(0.55);
      this.add.text(cx - 14, y + 137, priceLabel, {
        fontFamily: "monospace", fontSize: "12px", color: "#ffca28",
      });

      const buy = makeButton(this, cx, y + 170, "Buy", { width: cardW - 16, height: 30, color: 0x3949ab, fontSize: "12px" });
      buy.onClick(() => this.onBuyHouse(rarity, priceWei));
    });
  }

  private async onBuyHouse(rarity: number, priceWei: bigint) {
    try {
      this.status.setColor("#90a4ae").setText("Approve BLAST and confirm the purchase in your wallet...");
      await buyHouse(rarity, priceWei);
      this.status.setColor("#a5d6a7").setText(`${RARITY_NAMES[rarity]} house bought! It appears on the mining screen (~1 min).`);
      this.refreshBalance();
    } catch (err) {
      this.status.setColor("#ef9a9a").setText(`House purchase failed: ${(err as Error).message}`);
    }
  }
}
