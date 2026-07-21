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
 * Mercado de NFTs: navega listagens ativas direto do contrato, compra,
 * lista os próprios heróis on-chain e cancela listagens.
 * Requer chain configurada (VITE_RPC_URL + endereços); sem ela a cena
 * mostra o aviso e volta.
 */
export class MarketScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super("market");
  }

  create() {
    const { width } = this.scale;

    this.add.text(20, 20, "MERCADO — MinerBlast", {
      fontFamily: "monospace",
      fontSize: "22px",
      color: "#ffb74d",
      fontStyle: "bold",
    });

    const back = this.add
      .text(width - 140, 20, "[ Voltar ]", {
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
        "Mercado indisponível: configure VITE_RPC_URL e os endereços\ndos contratos para negociar NFTs.",
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
    this.statusText.setColor("#90a4ae").setText("carregando listagens...");
    try {
      const [listings, state] = await Promise.all([fetchListings(), api.state()]);
      this.renderListings(listings);
      this.renderMyHeroes(state.heroes.map((h) => h.id));
      this.statusText.setText("");
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`erro: ${(err as Error).message}`);
    }
  }

  private renderListings(listings: MarketListing[]) {
    this.clearRows();
    const me = connectedAddress()?.toLowerCase();

    this.rows.push(
      this.add.text(20, 64, "LISTAGENS ATIVAS", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#b0bec5",
      })
    );

    if (listings.length === 0) {
      this.rows.push(
        this.add.text(20, 90, "nenhuma listagem ativa", {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#78909c",
        })
      );
    }

    listings.slice(0, 10).forEach((l, i) => {
      const y = 90 + i * 30;
      const mine = l.seller.toLowerCase() === me;
      const kind = l.collection.toLowerCase() === HEROES_ADDRESS.toLowerCase() ? "Herói" : "Casa";
      this.rows.push(
        this.add.text(20, y, `${kind} #${l.tokenId}  ${formatEther(l.price)} BLAST`, {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#eceff1",
        })
      );
      const action = this.add
        .text(360, y, mine ? "[ Cancelar ]" : "[ Comprar ]", {
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

  /** Heróis on-chain do jogador (ids "chain-<tokenId>" vindos do servidor). */
  private renderMyHeroes(heroIds: string[]) {
    const chainHeroes = heroIds.filter((id) => id.startsWith("chain-"));

    this.rows.push(
      this.add.text(20, 420, "VENDER MEUS HERÓIS", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#b0bec5",
      })
    );

    if (chainHeroes.length === 0) {
      this.rows.push(
        this.add.text(20, 446, "nenhum herói on-chain (modo dev não permite vender)", {
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
        .text(20 + i * 180, 446, `[ Vender herói #${tokenId} ]`, {
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
    const input = window.prompt(`Preço em BLAST para o herói #${tokenId}:`, "1000");
    if (!input) return;
    let priceWei: bigint;
    try {
      priceWei = parseEther(input);
      if (priceWei <= 0n) throw new Error();
    } catch {
      this.statusText.setColor("#ef9a9a").setText("preço inválido");
      return;
    }
    try {
      this.statusText.setColor("#90a4ae").setText("aprove o NFT e a listagem na carteira (2 tx)...");
      await listNft(HEROES_ADDRESS as Address, tokenId, priceWei);
      this.statusText.setColor("#a5d6a7").setText("listagem enviada");
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`listar falhou: ${(err as Error).message}`);
    }
  }

  private async onBuy(l: MarketListing) {
    try {
      this.statusText.setColor("#90a4ae").setText("confirme approve + compra na carteira...");
      await buyListing(l);
      this.statusText.setColor("#a5d6a7").setText("compra enviada");
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`compra falhou: ${(err as Error).message}`);
    }
  }

  private async onCancel(l: MarketListing) {
    try {
      this.statusText.setColor("#90a4ae").setText("confirme o cancelamento na carteira...");
      await cancelListing(l.id);
      this.statusText.setColor("#a5d6a7").setText("cancelamento enviado");
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`cancelar falhou: ${(err as Error).message}`);
    }
  }
}
