import Phaser from "phaser";
import { formatEther, parseEther, type Address } from "viem";
import {
  fetchListings,
  listNft,
  buyListing,
  cancelListing,
  MarketListing,
} from "../web3/market";
import { connectedAddress } from "../web3/wallet";
import { api, HeroDto } from "../net/api";
import { HEROES_ADDRESS, MARKET_ENABLED } from "../config";
import { registerPixelArt } from "../art/pixelart";
import { drawPanel, drawRibbon, makeButton } from "../art/ui";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];

/**
 * Visual NFT marketplace: browse active listings as cards, buy, list the
 * player's own on-chain heroes and cancel listings.
 */
export class MarketScene extends Phaser.Scene {
  private cards: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super("market");
  }

  create() {
    registerPixelArt(this);
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    drawRibbon(this, 400, 34, "MARKET", 200);
    makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f })
      .onClick(() => this.scene.start("mining"));

    this.status = this.add.text(24, 566, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae", wordWrap: { width: 750 },
    });

    drawPanel(this, 24, 64, 752, 300); // listings
    drawPanel(this, 24, 374, 752, 172); // sell
    this.add.text(40, 74, "ACTIVE LISTINGS", {
      fontFamily: "monospace", fontSize: "14px", color: "#eceff1", fontStyle: "bold",
    });
    this.add.text(40, 384, "SELL MY HEROES", {
      fontFamily: "monospace", fontSize: "14px", color: "#eceff1", fontStyle: "bold",
    });

    if (!MARKET_ENABLED) {
      this.status.setColor("#ffcc80").setText("The player market opens at the $BLAST launch — coming soon!");
      return;
    }
    this.refresh();
  }

  private clearCards() {
    this.cards.forEach((c) => c.destroy());
    this.cards = [];
  }

  private async refresh() {
    this.status.setColor("#90a4ae").setText("Loading listings...");
    try {
      const [listings, state] = await Promise.all([fetchListings(), api.state()]);
      this.renderListings(listings);
      this.renderMyHeroes(state.heroes);
      this.status.setText("");
    } catch (err) {
      if ((err as Error).message === "session expired") {
        this.scene.start("connect");
        return;
      }
      this.status.setColor("#ef9a9a").setText(`Error: ${(err as Error).message}`);
    }
  }

  private renderListings(listings: MarketListing[]) {
    this.clearCards();
    const me = connectedAddress()?.toLowerCase();

    if (listings.length === 0) {
      this.cards.push(this.add.text(40, 100, "No active listings yet.", {
        fontFamily: "monospace", fontSize: "13px", color: "#78909c",
      }));
      return;
    }

    listings.slice(0, 10).forEach((l, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = 40 + col * 146;
      const y = 100 + row * 122;
      const mine = l.seller.toLowerCase() === me;
      const isHero = l.collection.toLowerCase() === HEROES_ADDRESS.toLowerCase();

      drawPanel(this, x, y, 138, 112, 0x1c2536);
      this.cards.push(this.add.image(x + 69, y + 34, isHero ? "hero-2" : "house").setScale(1.1));
      this.cards.push(this.add.text(x + 69, y + 62, `${isHero ? "Hero" : "House"} #${l.tokenId}`, {
        fontFamily: "monospace", fontSize: "11px", color: "#eceff1",
      }).setOrigin(0.5));
      this.cards.push(this.add.image(x + 30, y + 80, "coin").setScale(0.45));
      this.cards.push(this.add.text(x + 44, y + 74, Number(formatEther(l.price)).toLocaleString("en-US"), {
        fontFamily: "monospace", fontSize: "11px", color: "#ffca28",
      }));

      const btn = makeButton(this, x + 69, y + 98, mine ? "Cancel" : "Buy", {
        width: 120, height: 22, color: mine ? 0xc62828 : 0x2e7d32, fontSize: "11px",
      });
      btn.onClick(() => (mine ? this.onCancel(l) : this.onBuy(l)));
      this.cards.push(btn.container);
    });
  }

  private renderMyHeroes(heroes: HeroDto[]) {
    const chainHeroes = heroes.filter((h) => h.id.startsWith("chain-"));
    if (chainHeroes.length === 0) {
      this.cards.push(this.add.text(40, 410, "No on-chain heroes to sell (dev heroes cannot be listed).", {
        fontFamily: "monospace", fontSize: "13px", color: "#78909c",
      }));
      return;
    }

    chainHeroes.slice(0, 5).forEach((h, i) => {
      const tokenId = BigInt(h.id.slice("chain-".length));
      const x = 40 + i * 146;
      const y = 408;
      drawPanel(this, x, y, 138, 118, 0x1c2536);
      this.cards.push(this.add.image(x + 69, y + 34, `hero-${h.rarity}`).setScale(1.1));
      this.cards.push(this.add.text(x + 69, y + 62, `#${tokenId} ${RARITY_NAMES[h.rarity]}`, {
        fontFamily: "monospace", fontSize: "10px", color: "#eceff1",
      }).setOrigin(0.5));
      this.cards.push(this.add.text(x + 69, y + 78, `pwr ${h.power}`, {
        fontFamily: "monospace", fontSize: "10px", color: "#90a4ae",
      }).setOrigin(0.5));

      const btn = makeButton(this, x + 69, y + 102, "Sell", {
        width: 120, height: 24, color: 0x3949ab, fontSize: "11px",
      });
      btn.onClick(() => this.onList(tokenId));
      this.cards.push(btn.container);
    });
  }

  private async onList(tokenId: bigint) {
    const input = window.prompt(`Price in BLAST for hero #${tokenId}:`, "1000");
    if (!input) return;
    let priceWei: bigint;
    try {
      priceWei = parseEther(input);
      if (priceWei <= 0n) throw new Error();
    } catch {
      this.status.setColor("#ef9a9a").setText("Invalid price.");
      return;
    }
    try {
      this.status.setColor("#90a4ae").setText("Approve the NFT and the listing in your wallet (2 transactions)...");
      await listNft(HEROES_ADDRESS as Address, tokenId, priceWei);
      this.status.setColor("#a5d6a7").setText("Listing sent!");
      this.refresh();
    } catch (err) {
      this.status.setColor("#ef9a9a").setText(`Listing failed: ${(err as Error).message}`);
    }
  }

  private async onBuy(l: MarketListing) {
    try {
      this.status.setColor("#90a4ae").setText("Confirm approve + purchase in your wallet...");
      await buyListing(l);
      this.status.setColor("#a5d6a7").setText("Purchase sent!");
      this.refresh();
    } catch (err) {
      this.status.setColor("#ef9a9a").setText(`Purchase failed: ${(err as Error).message}`);
    }
  }

  private async onCancel(l: MarketListing) {
    try {
      this.status.setColor("#90a4ae").setText("Confirm the cancellation in your wallet...");
      await cancelListing(l.id);
      this.status.setColor("#a5d6a7").setText("Cancellation sent!");
      this.refresh();
    } catch (err) {
      this.status.setColor("#ef9a9a").setText(`Cancel failed: ${(err as Error).message}`);
    }
  }
}
