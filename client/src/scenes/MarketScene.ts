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
import { api } from "../net/api";
import { HEROES_ADDRESS, MARKET_ENABLED } from "../config";

/**
 * NFT marketplace: browses active listings straight from the contract, buys,
 * lists the player's own on-chain heroes and cancels listings.
 * Requires a configured chain (VITE_RPC_URL + addresses); without it the
 * scene shows the notice and goes back.
 */
export class MarketScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("market");
  }

  create() {
    const { width } = this.scale;

    this.add.text(20, 20, "MARKET — MinerBlast", {
      fontFamily: "monospace",
      fontSize: "22px",
      color: "#ffb74d",
      fontStyle: "bold",
    });

    const back = this.add
      .text(width - 140, 20, "[ Back ]", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#4fc3f7",
        backgroundColor: "#1c2333",
        padding: { x: 10, y: 6 },
      })
      .setInteractive({ useHandCursor: true });
    back.on("pointerdown", () => this.scene.start("mining"));

    this.statusText = this.add.text(20, 560, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#90a4ae",
      wordWrap: { width: 760 },
    });

    if (!MARKET_ENABLED) {
      this.add.text(
        20,
        80,
        "Market unavailable: set VITE_RPC_URL and the contract\naddresses to trade NFTs.",
        { fontFamily: "monospace", fontSize: "15px", color: "#ef9a9a" }
      );
      return;
    }

    this.refresh();
  }

  private clearRows() {
    this.rows.forEach((r) => r.destroy());
    this.rows = [];
  }

  private async refresh() {
    this.statusText.setColor("#90a4ae").setText("loading listings...");
    try {
      const [listings, state] = await Promise.all([fetchListings(), api.state()]);
      this.renderListings(listings);
      this.renderMyHeroes(state.heroes.map((h) => h.id));
      this.statusText.setText("");
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`error: ${(err as Error).message}`);
    }
  }

  private renderListings(listings: MarketListing[]) {
    this.clearRows();
    const me = connectedAddress()?.toLowerCase();

    this.rows.push(
      this.add.text(20, 64, "ACTIVE LISTINGS", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#b0bec5",
      })
    );

    if (listings.length === 0) {
      this.rows.push(
        this.add.text(20, 90, "no active listings", {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#78909c",
        })
      );
    }

    listings.slice(0, 10).forEach((l, i) => {
      const y = 90 + i * 30;
      const mine = l.seller.toLowerCase() === me;
      const kind = l.collection.toLowerCase() === HEROES_ADDRESS.toLowerCase() ? "Hero" : "House";
      this.rows.push(
        this.add.text(20, y, `${kind} #${l.tokenId}  ${formatEther(l.price)} BLAST`, {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#eceff1",
        })
      );
      const action = this.add
        .text(360, y, mine ? "[ Cancel ]" : "[ Buy ]", {
          fontFamily: "monospace",
          fontSize: "13px",
          color: mine ? "#ef9a9a" : "#4fc3f7",
          backgroundColor: "#1c2333",
          padding: { x: 8, y: 3 },
        })
        .setInteractive({ useHandCursor: true });
      action.on("pointerdown", () => (mine ? this.onCancel(l) : this.onBuy(l)));
      this.rows.push(action);
    });
  }

  /** The player's on-chain heroes (ids "chain-<tokenId>" from the server). */
  private renderMyHeroes(heroIds: string[]) {
    const chainHeroes = heroIds.filter((id) => id.startsWith("chain-"));

    this.rows.push(
      this.add.text(20, 420, "SELL MY HEROES", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#b0bec5",
      })
    );

    if (chainHeroes.length === 0) {
      this.rows.push(
        this.add.text(20, 446, "no on-chain heroes (dev mode does not allow selling)", {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#78909c",
        })
      );
      return;
    }

    chainHeroes.slice(0, 3).forEach((id, i) => {
      const tokenId = BigInt(id.slice("chain-".length));
      const btn = this.add
        .text(20 + i * 180, 446, `[ Sell hero #${tokenId} ]`, {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#a5d6a7",
          backgroundColor: "#1c2333",
          padding: { x: 8, y: 4 },
        })
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => this.onList(tokenId));
      this.rows.push(btn);
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
      this.statusText.setColor("#ef9a9a").setText("invalid price");
      return;
    }
    try {
      this.statusText.setColor("#90a4ae").setText("approve the NFT and the listing in your wallet (2 tx)...");
      await listNft(HEROES_ADDRESS as Address, tokenId, priceWei);
      this.statusText.setColor("#a5d6a7").setText("listing sent");
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`listing failed: ${(err as Error).message}`);
    }
  }

  private async onBuy(l: MarketListing) {
    try {
      this.statusText.setColor("#90a4ae").setText("confirm approve + purchase in your wallet...");
      await buyListing(l);
      this.statusText.setColor("#a5d6a7").setText("purchase sent");
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`purchase failed: ${(err as Error).message}`);
    }
  }

  private async onCancel(l: MarketListing) {
    try {
      this.statusText.setColor("#90a4ae").setText("confirm the cancellation in your wallet...");
      await cancelListing(l.id);
      this.statusText.setColor("#a5d6a7").setText("cancellation sent");
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`cancel failed: ${(err as Error).message}`);
    }
  }
}
