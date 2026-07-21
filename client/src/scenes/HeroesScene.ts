import Phaser from "phaser";
import { api, GameStateDto, HeroDto } from "../net/api";
import { registerPixelArt, RARITY_COLORS } from "../art/pixelart";
import { drawPanel, drawRibbon, makeButton } from "../art/ui";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];
const PER_PAGE = 8; // 4 x 2 cards

/** Full roster view: every hero the player owns, as cards with actions. */
export class HeroesScene extends Phaser.Scene {
  private state?: GameStateDto;
  private cards: Phaser.GameObjects.GameObject[] = [];
  private status!: Phaser.GameObjects.Text;
  private page = 0;

  constructor() {
    super("heroes");
  }

  create() {
    registerPixelArt(this);
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    drawRibbon(this, 400, 34, "MY HEROES", 220);
    const back = makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f });
    back.onClick(() => this.scene.start("mining"));

    this.status = this.add.text(24, 566, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#90a4ae", wordWrap: { width: 750 },
    });

    this.refresh();
  }

  private async refresh() {
    this.status.setColor("#90a4ae").setText("Loading heroes...");
    try {
      const state = await api.state();
      if (!this.sys.settings.active) return;
      this.state = state;
      this.status.setText("");
      this.render();
    } catch (err) {
      if (!this.sys.settings.active) return;
      if ((err as Error).message === "session expired") {
        this.scene.start("connect");
        return;
      }
      this.status.setColor("#ef9a9a").setText(`Error: ${(err as Error).message}`);
    }
  }

  private render() {
    if (!this.state) return;
    this.cards.forEach((c) => c.destroy());
    this.cards = [];

    const heroes = this.state.heroes;
    if (heroes.length === 0) {
      this.cards.push(this.add.text(400, 280, "No heroes yet — buy a chest in the Shop!", {
        fontFamily: "monospace", fontSize: "15px", color: "#90a4ae",
      }).setOrigin(0.5));
      return;
    }

    const pages = Math.max(1, Math.ceil(heroes.length / PER_PAGE));
    if (this.page >= pages) this.page = pages - 1;
    const visible = heroes.slice(this.page * PER_PAGE, this.page * PER_PAGE + PER_PAGE);

    visible.forEach((h, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 26 + col * 190;
      const y = 78 + row * 226;
      this.cards.push(this.drawHeroCard(h, x, y));
    });

    // pager
    if (pages > 1) {
      const prev = makeButton(this, 320, 548, "◀", { width: 46, height: 30, color: 0x37474f });
      prev.setEnabled(this.page > 0);
      prev.onClick(() => { this.page--; this.render(); });
      const label = this.add.text(400, 548, `${this.page + 1} / ${pages}`, {
        fontFamily: "monospace", fontSize: "14px", color: "#eceff1",
      }).setOrigin(0.5);
      const next = makeButton(this, 480, 548, "▶", { width: 46, height: 30, color: 0x37474f });
      next.setEnabled(this.page < pages - 1);
      next.onClick(() => { this.page++; this.render(); });
      this.cards.push(prev.container, label, next.container);
    }

    this.cards.push(this.add.text(400, 520, `${heroes.length} hero${heroes.length > 1 ? "es" : ""} total`, {
      fontFamily: "monospace", fontSize: "12px", color: "#78909c",
    }).setOrigin(0.5));
  }

  private drawHeroCard(h: HeroDto, x: number, y: number): Phaser.GameObjects.Container {
    const w = 178, hgt = 214;
    const c = this.add.container(0, 0);
    const panel = drawPanel(this, x, y, w, hgt, 0x1a2234);
    c.add(panel);

    // rarity-colored portrait frame
    const frame = this.add.rectangle(x + w / 2, y + 52, 76, 76, 0x101624)
      .setStrokeStyle(3, RARITY_COLORS[h.rarity] ?? 0xffffff);
    const portrait = this.add.image(x + w / 2, y + 52, `hero-${h.rarity}`).setScale(1.05);
    c.add([frame, portrait]);

    const color = "#" + (RARITY_COLORS[h.rarity] ?? 0xffffff).toString(16).padStart(6, "0");
    c.add(this.add.text(x + w / 2, y + 100, RARITY_NAMES[h.rarity], {
      fontFamily: "monospace", fontSize: "14px", color, fontStyle: "bold",
    }).setOrigin(0.5));

    const idLabel = h.id.startsWith("chain-") ? `NFT #${h.id.slice(6)}` : "dev hero";
    c.add(this.add.text(x + w / 2, y + 117, idLabel, {
      fontFamily: "monospace", fontSize: "10px", color: "#78909c",
    }).setOrigin(0.5));

    c.add(this.add.text(x + 14, y + 132, `Power ${h.power} · Speed ${h.speed}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#eceff1",
    }));

    // stamina bar
    const barW = w - 28;
    c.add(this.add.rectangle(x + 14, y + 150, barW, 8, 0x263238).setOrigin(0));
    c.add(this.add.rectangle(x + 14, y + 150, barW * (h.stamina / h.staminaMax), 8, 0x4fc3f7).setOrigin(0));
    c.add(this.add.text(x + 14, y + 161, `stamina ${h.stamina}/${h.staminaMax}${h.houseId ? "  ⌂ sheltered" : ""}`, {
      fontFamily: "monospace", fontSize: "10px", color: "#90a4ae",
    }));

    const working = h.mode === "work";
    const btn = makeButton(this, x + w / 2, y + 192, working ? "Rest" : "Work", {
      width: w - 28, height: 28, color: working ? 0x546e7a : 0x2e7d32, fontSize: "12px",
    });
    btn.onClick(async () => {
      try {
        this.status.setColor("#90a4ae").setText(working ? "Sending hero to rest..." : "Sending hero to work...");
        const state = await api.setMode(h.id, working ? "rest" : "work");
        if (!this.sys.settings.active) return;
        this.state = state;
        this.status.setText("");
        this.render();
      } catch (err) {
        if (!this.sys.settings.active) return;
        this.status.setColor("#ef9a9a").setText(`Error: ${(err as Error).message}`);
      }
    });
    c.add(btn.container);
    return c;
  }
}
