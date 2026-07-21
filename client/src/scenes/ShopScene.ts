import Phaser from "phaser";
import { formatEther } from "viem";
import {
  gachaPrices, buyChest, buyPack, myUnopenedChests, canOpen, openChestAndReveal,
} from "../web3/gacha";
import { housePrices, buyHouse, blastBalance } from "../web3/houses";
import { GACHA_ENABLED, MARKET_ENABLED } from "../config";
import { registerPixelArt, RARITY_COLORS } from "../art/pixelart";
import { drawPanel, drawRibbon, makeButton } from "../art/ui";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];

/** Visual shop: buy hero chests with ETH and stamina houses with BLAST. */
export class ShopScene extends Phaser.Scene {
  private status!: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private pendingBtn?: ReturnType<typeof makeButton>;

  constructor() {
    super("shop");
  }

  create() {
    registerPixelArt(this);
    if (!this.anims.exists("boom")) {
      this.anims.create({
        key: "boom",
        frames: [{ key: "boom-0" }, { key: "boom-1" }, { key: "boom-2" }],
        frameRate: 14,
        hideOnComplete: true,
      });
    }
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    drawRibbon(this, 400, 34, "SHOP", 180);
    const back = makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f });
    back.onClick(() => this.scene.start("mining"));

    this.status = this.add.text(24, 566, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae", wordWrap: { width: 750 },
    });

    this.overlay = undefined;
    this.buildChests();
    this.buildHouses();
    if (GACHA_ENABLED) this.checkPendingChests();
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

    const loading = this.add.text(300, 170, "Loading prices...", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae",
    });
    gachaPrices().then((p) => {
      loading.destroy();
      const single = makeButton(this, 420, 165, `Buy 1 Chest — ${formatEther(p.chestWei)} ETH`, {
        width: 300, height: 46, color: 0x2e7d32, icon: "eth", fontSize: "14px",
      });
      single.onClick(() => this.onBuyChest(p.chestWei, false));

      const pack = makeButton(this, 420, 222, `Buy ${p.packSize}-Pack — ${formatEther(p.packWei)} ETH  (save 20%)`, {
        width: 360, height: 46, color: 0xef6c00, icon: "eth", fontSize: "13px",
      });
      pack.onClick(() => this.onBuyChest(p.packWei, true));
    }).catch(() => {
      loading.setColor("#ef9a9a").setText("Shop unavailable.");
    });
  }

  private async onBuyChest(valueWei: bigint, pack: boolean) {
    try {
      this.status.setColor("#90a4ae").setText("Confirm the purchase in your wallet...");
      await (pack ? buyPack(valueWei) : buyChest(valueWei));
      this.status.setText("");
      this.openRevealOverlay();
    } catch (err) {
      this.status.setColor("#ef9a9a").setText(`Purchase failed: ${(err as Error).message}`);
    }
  }

  /** Shows the pending-chests pill if the player still has unopened chests. */
  private async checkPendingChests() {
    const pending = await myUnopenedChests().catch(() => [] as bigint[]);
    if (!this.sys.settings.active || pending.length === 0) return;
    this.pendingBtn?.container.destroy();
    this.pendingBtn = makeButton(this, 640, 222, `Open ${pending.length} chest${pending.length > 1 ? "s" : ""}`, {
      width: 200, height: 40, color: 0x8d6e13, icon: "chest", iconScale: 0.4,
    });
    this.pendingBtn.onClick(() => this.openRevealOverlay());
  }

  /**
   * Chest-opening ceremony: a modal that walks the player through each
   * pending chest — reveal countdown, OPEN button, wallet confirmation and
   * the hero reveal with rarity colors. No more silent transactions.
   */
  private async openRevealOverlay() {
    if (this.overlay) return;
    const panel = this.add.container(0, 0).setDepth(200);
    this.overlay = panel;

    const dim = this.add.graphics();
    dim.fillStyle(0x000000, 0.72);
    dim.fillRect(0, 0, 800, 600);
    dim.setInteractive(new Phaser.Geom.Rectangle(0, 0, 800, 600), Phaser.Geom.Rectangle.Contains);
    panel.add(dim);

    const px = 220, py = 120, pw = 360, ph = 340;
    panel.add(drawPanel(this, px, py, pw, ph, 0x141b2c));
    panel.add(drawRibbon(this, 400, py + 4, "CHEST OPENING", 230));

    const chest = this.add.image(400, py + 130, "chest").setScale(1.8);
    const glow = this.add.image(400, py + 130, "spark").setScale(0.7).setAlpha(0.6);
    this.tweens.add({ targets: glow, angle: 360, duration: 5000, repeat: -1 });
    const info = this.add.text(400, py + 216, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#eceff1", align: "center",
      wordWrap: { width: pw - 40 },
    }).setOrigin(0.5, 0);
    panel.add([chest, glow, info]);

    const openBtn = makeButton(this, 400, py + 292, "OPEN CHEST", {
      width: 200, height: 44, color: 0x2e7d32, icon: "chest", iconScale: 0.45, fontSize: "15px",
    });
    const closeBtn = makeButton(this, px + pw - 24, py + 22, "X", { width: 34, height: 30, color: 0x37474f });
    let closed = false;
    closeBtn.onClick(() => { closed = true; panel.destroy(); this.overlay = undefined; this.checkPendingChests(); });
    panel.add([openBtn.container, closeBtn.container]);
    openBtn.setEnabled(false);

    const shake = () =>
      this.tweens.add({ targets: chest, angle: { from: -4, to: 4 }, duration: 90, yoyo: true, repeat: 5, onComplete: () => chest.setAngle(0) });

    // walk through every pending chest, one at a time
    let opened = 0;
    while (!closed && this.sys.settings.active) {
      const pending = await myUnopenedChests().catch(() => [] as bigint[]);
      if (closed || !this.sys.settings.active) return;
      if (pending.length === 0) {
        info.setColor("#a5d6a7").setText(
          opened > 0
            ? "All chests opened! Your heroes appear on the mining screen in ~1 min."
            : "No unopened chests."
        );
        openBtn.setEnabled(false);
        return;
      }
      const id = pending[0];
      const left = pending.length;
      info.setColor("#ffcc80").setText(`Chest #${id} (${left} left)\nThe chest is being prepared... ~30s`);
      openBtn.setEnabled(false);

      // wait for the on-chain reveal window
      while (!closed && this.sys.settings.active && !(await canOpen(id))) {
        shake();
        await new Promise((r) => setTimeout(r, 4000));
      }
      if (closed || !this.sys.settings.active) return;

      info.setColor("#eceff1").setText(`Chest #${id} is ready!`);
      openBtn.setEnabled(true);
      await new Promise<void>((resolve) => openBtn.onClick(resolve));
      if (closed || !this.sys.settings.active) return;
      openBtn.setEnabled(false);
      info.setColor("#90a4ae").setText("Confirm the transaction in your wallet...");

      try {
        const revealed = await openChestAndReveal(id);
        if (closed || !this.sys.settings.active) return;
        opened++;
        // reveal ceremony: boom + hero pops out of the chest
        const boom = this.add.sprite(400, py + 130, "boom-0").setDepth(201).setScale(1.6);
        boom.play("boom");
        boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());
        const heroImg = this.add.image(400, py + 130, `hero-${revealed.rarity}`).setDepth(201).setScale(0.4);
        panel.add(heroImg);
        this.tweens.add({ targets: heroImg, scale: 1.9, duration: 450, ease: "Back.easeOut" });
        const color = "#" + (RARITY_COLORS[revealed.rarity] ?? 0xffffff).toString(16).padStart(6, "0");
        info.setColor(color).setText(
          `${RARITY_NAMES[revealed.rarity].toUpperCase()} HERO #${revealed.heroId}!`
        );
        await new Promise((r) => setTimeout(r, 2600));
        heroImg.destroy();
      } catch (err) {
        if (closed || !this.sys.settings.active) return;
        info.setColor("#ef9a9a").setText(`Open failed: ${(err as Error).message}\nYou can try again.`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
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
    const loading = this.add.text(44, 350, "Loading house prices...", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae",
    });
    housePrices().then((prices) => {
      loading.destroy();
      this.renderHouseCards(prices);
    }).catch(() => {
      loading.setColor("#ef9a9a").setText("Could not load house prices.");
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
