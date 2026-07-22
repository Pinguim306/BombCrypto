import Phaser from "phaser";
import { formatEther } from "viem";
import { api, MinerRow } from "../net/api";
import { topReferrers, ReferrerRow } from "../web3/gacha";
import { GACHA_ENABLED } from "../config";
import { registerPixelArt } from "../art/pixelart";
import { drawPanel, drawRibbon, makeButton, Button } from "../art/ui";

type Board = "miners" | "referrers";

/** Public leaderboards, in-game tab. Two boards: top miners (by total hero
 *  power, from the server) and top referrers (by ETH earned, on-chain). */
export class LeaderboardScene extends Phaser.Scene {
  private rows: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;
  private board: Board = "miners";
  private tabMiners!: Button;
  private tabRefs!: Button;

  constructor() {
    super("leaderboard");
  }

  create() {
    this.rows = [];
    this.board = "miners";
    registerPixelArt(this);
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    drawRibbon(this, 400, 34, "LEADERBOARDS", 240);
    const back = makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f });
    back.onClick(() => this.scene.start("mining"));

    // board switch tabs
    this.tabMiners = makeButton(this, 250, 84, "Top Miners", { width: 190, height: 36, color: 0x2e7d32 });
    this.tabMiners.onClick(() => this.select("miners"));
    this.tabRefs = makeButton(this, 470, 84, "Top Referrers", { width: 190, height: 36, color: 0x37474f });
    this.tabRefs.onClick(() => this.select("referrers"));

    drawPanel(this, 60, 118, 680, 420);

    this.status = this.add.text(400, 566, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae", wordWrap: { width: 720 },
    }).setOrigin(0.5);

    this.refresh();
  }

  private select(board: Board) {
    if (this.board === board) return;
    this.board = board;
    this.tabMiners.setColor(board === "miners" ? 0x2e7d32 : 0x37474f);
    this.tabRefs.setColor(board === "referrers" ? 0x2e7d32 : 0x37474f);
    this.refresh();
  }

  private clearRows() {
    this.rows.forEach((r) => r.destroy());
    this.rows = [];
  }

  private async refresh() {
    this.clearRows();
    this.status.setColor("#90a4ae").setText("Loading...");
    if (this.board === "miners") {
      await this.loadMiners();
    } else {
      await this.loadReferrers();
    }
  }

  private short(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  private header(cols: [string, number][]) {
    cols.forEach(([label, x]) => {
      this.rows.push(this.add.text(x, 138, label, {
        fontFamily: "monospace", fontSize: "12px", color: "#78909c", fontStyle: "bold",
      }));
    });
    this.rows.push(this.add.rectangle(80, 158, 640, 2, 0x2a3550).setOrigin(0));
  }

  // 15 rows must fit between the header divider (y=158) and the panel
  // bottom (y=538): 24px pitch → last row at 170 + 14*24 = 506.
  private rowY(i: number): number {
    return 170 + i * 24;
  }

  private async loadMiners() {
    try {
      const { miners } = await api.topMiners();
      if (!this.sys.settings.active) return;
      this.status.setText("");
      this.header([["#", 84], ["MINER", 130], ["HEROES", 490], ["POWER", 600]]);
      if (miners.length === 0) {
        this.rows.push(this.add.text(400, 320, "No miners on the board yet.", {
          fontFamily: "monospace", fontSize: "15px", color: "#90a4ae",
        }).setOrigin(0.5));
        return;
      }
      miners.forEach((m, i) => this.drawMinerRow(m, i));
    } catch (err) {
      if (!this.sys.settings.active) return;
      this.status.setColor("#ef9a9a").setText(`Error: ${(err as Error).message}`);
    }
  }

  private drawMinerRow(m: MinerRow, i: number) {
    const y = this.rowY(i);
    const rank = i + 1;
    const medal = rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : `${rank}`;
    this.rows.push(this.add.text(84, y, medal, {
      fontFamily: "monospace", fontSize: "15px", color: "#ffca28", fontStyle: "bold",
    }).setOrigin(0, 0.5));
    const name = m.alias ?? this.short(m.address);
    this.rows.push(this.add.text(130, y, name, {
      fontFamily: "monospace", fontSize: "14px", color: m.alias ? "#eceff1" : "#b0bec5",
    }).setOrigin(0, 0.5));
    this.rows.push(this.add.text(490, y, String(m.heroes), {
      fontFamily: "monospace", fontSize: "14px", color: "#eceff1",
    }).setOrigin(0, 0.5));
    this.rows.push(this.add.text(600, y, String(m.power), {
      fontFamily: "monospace", fontSize: "14px", color: "#4fc3f7", fontStyle: "bold",
    }).setOrigin(0, 0.5));
  }

  private async loadReferrers() {
    if (!GACHA_ENABLED) {
      this.status.setColor("#90a4ae").setText("Referrer stats go live with the $BLAST launch.");
      return;
    }
    try {
      const refs = await topReferrers(15);
      if (!this.sys.settings.active) return;
      this.status.setText("");
      this.header([["#", 84], ["REFERRER", 130], ["INVITES", 460], ["ETH EARNED", 580]]);
      if (refs.length === 0) {
        this.rows.push(this.add.text(400, 320, "No referrers on the board yet.", {
          fontFamily: "monospace", fontSize: "15px", color: "#90a4ae",
        }).setOrigin(0.5));
        return;
      }
      refs.forEach((r, i) => this.drawRefRow(r, i));
    } catch (err) {
      if (!this.sys.settings.active) return;
      this.status.setColor("#ef9a9a").setText(`Error: ${(err as Error).message}`);
    }
  }

  private drawRefRow(r: ReferrerRow, i: number) {
    const y = this.rowY(i);
    const rank = i + 1;
    const medal = rank <= 3 ? ["🥇", "🥈", "🥉"][rank - 1] : `${rank}`;
    this.rows.push(this.add.text(84, y, medal, {
      fontFamily: "monospace", fontSize: "15px", color: "#ffca28", fontStyle: "bold",
    }).setOrigin(0, 0.5));
    this.rows.push(this.add.text(130, y, this.short(r.address), {
      fontFamily: "monospace", fontSize: "14px", color: "#b0bec5",
    }).setOrigin(0, 0.5));
    this.rows.push(this.add.text(460, y, String(r.invites), {
      fontFamily: "monospace", fontSize: "14px", color: "#eceff1",
    }).setOrigin(0, 0.5));
    this.rows.push(this.add.text(580, y, Number(formatEther(r.earnedWei)).toFixed(4), {
      fontFamily: "monospace", fontSize: "14px", color: "#81c784", fontStyle: "bold",
    }).setOrigin(0, 0.5));
  }
}
