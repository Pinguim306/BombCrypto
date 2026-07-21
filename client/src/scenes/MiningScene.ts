import Phaser from "phaser";
import { api, GameStateDto, HeroDto } from "../net/api";
import { claimVoucher } from "../web3/wallet";
import { registerPixelArt, blockTier } from "../art/pixelart";

const COLS = 8;
const ROWS = 5;
const TILE = 64;
const GRID_X = 240;
const GRID_Y = 90;
const POLL_MS = 2000;

const RARITY_NAMES = ["Comum", "Raro", "S.Raro", "Épico", "Lend.", "Mítico"];

/**
 * Tela principal de mineração. Toda a simulação acontece no servidor; esta
 * cena apenas renderiza o estado consultado a cada POLL_MS e anima bombas
 * cosméticas. Arte placeholder gerada por código (Fase 4: pixel art original).
 *
 * Interações: clique no herói alterna minerar/descansar; clique com a tecla
 * H pressionada abriga/desabriga o herói na primeira casa com vaga.
 */
export class MiningScene extends Phaser.Scene {
  private state?: GameStateDto;
  private blockSprites: Phaser.GameObjects.Image[] = [];
  private blockBars: Phaser.GameObjects.Rectangle[] = [];
  private heroRows: Phaser.GameObjects.Container[] = [];
  private pendingText!: Phaser.GameObjects.Text;
  private housesText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private stageButtons: Phaser.GameObjects.Text[] = [];
  private selectedStage = 0;
  private keyH!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private pollTimer?: Phaser.Time.TimerEvent;
  private bombTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super("mining");
  }

  create() {
    registerPixelArt(this);
    this.add.text(GRID_X, 24, "MINERBLAST — Mineração do Tesouro", {
      fontFamily: "monospace",
      fontSize: "22px",
      color: "#ffb74d",
      fontStyle: "bold",
    });

    this.pendingText = this.add.text(GRID_X, 54, "carregando...", {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#a5d6a7",
    });

    const market = this.add
      .text(GRID_X + 300, 50, "[ Mercado ]", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffcc80",
        backgroundColor: "#1c2333",
        padding: { x: 10, y: 6 },
      })
      .setInteractive({ useHandCursor: true });
    market.on("pointerdown", () => this.scene.start("market"));

    const claim = this.add
      .text(GRID_X + 420, 50, "[ Sacar BLAST ]", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#4fc3f7",
        backgroundColor: "#1c2333",
        padding: { x: 10, y: 6 },
      })
      .setInteractive({ useHandCursor: true });
    claim.on("pointerdown", () => this.onClaim());

    this.statusText = this.add.text(20, 560, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#90a4ae",
      wordWrap: { width: 760 },
    });

    // grade de blocos (texturas por dureza do minério)
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = GRID_X + (i % COLS) * TILE;
      const y = GRID_Y + Math.floor(i / COLS) * TILE;
      const img = this.add
        .image(x, y, "block-0")
        .setOrigin(0)
        .setDisplaySize(TILE - 6, TILE - 6);
      const bar = this.add.rectangle(x, y + TILE - 12, TILE - 6, 5, 0xffc107).setOrigin(0);
      this.blockSprites.push(img);
      this.blockBars.push(bar);
    }

    this.add.text(20, 70, "HERÓIS (clique: minerar/descansar; H+clique: casa; A+clique: aventura)", {
      fontFamily: "monospace",
      fontSize: "10px",
      color: "#90a4ae",
    });

    this.housesText = this.add.text(20, 430, "", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#b0bec5",
    });

    this.keyH = this.input.keyboard!.addKey("H");
    this.keyA = this.input.keyboard!.addKey("A");

    this.refresh();
    this.pollTimer = this.time.addEvent({ delay: POLL_MS, loop: true, callback: () => this.refresh() });
    this.bombTimer = this.time.addEvent({ delay: 900, loop: true, callback: () => this.cosmeticBomb() });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pollTimer?.remove();
      this.bombTimer?.remove();
    });
  }

  private async refresh() {
    try {
      this.state = await api.state();
      this.render();
    } catch (err) {
      this.statusText.setText(`erro: ${(err as Error).message}`);
      if ((err as Error).message === "sessao expirada") this.scene.start("connect");
    }
  }

  private render() {
    if (!this.state) return;
    this.pendingText.setText(
      `pendente: ${Number(this.state.pendingBlast).toFixed(4)} BLAST   mapas: ${this.state.mapsCleared}`
    );

    this.state.blocks.forEach((b, i) => {
      const alive = b.hp > 0;
      const key = alive ? `block-${blockTier(b.maxHp)}` : "block-dead";
      const sprite = this.blockSprites[i];
      if (sprite.texture.key !== key) {
        sprite.setTexture(key).setDisplaySize(TILE - 6, TILE - 6);
      }
      this.blockBars[i].setVisible(alive).width = (TILE - 6) * (b.hp / b.maxHp);
    });

    this.housesText.setText(
      ["CASAS:"]
        .concat(
          this.state.houses.map(
            (h) =>
              `${RARITY_NAMES[h.rarity]} — ${h.occupants}/${h.capacity} vagas, +${h.regenBoostBps / 100}% regen`
          )
        )
        .join("\n")
    );

    this.renderStages();

    this.renderHeroes(this.state.heroes);
  }

  /** Botões de seleção do estágio de aventura (usados com A+clique no herói). */
  private renderStages() {
    if (!this.state) return;
    this.stageButtons.forEach((b) => b.destroy());
    this.stageButtons = this.state.adventure.stages.map((s, i) => {
      const selected = this.selectedStage === s.id;
      const btn = this.add
        .text(
          GRID_X + i * 178,
          GRID_Y + ROWS * TILE + 14,
          `${selected ? "▶ " : ""}${s.name}\n${s.rewardBlast} BLAST · ${s.staminaCost} stam`,
          {
            fontFamily: "monospace",
            fontSize: "11px",
            color: selected ? "#ffb74d" : "#b0bec5",
            backgroundColor: "#1c2333",
            padding: { x: 8, y: 6 },
          }
        )
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => {
        this.selectedStage = s.id;
        this.renderStages();
      });
      return btn;
    });
    const attempts = this.add.text(
      GRID_X,
      GRID_Y + ROWS * TILE + 62,
      `aventuras hoje: ${this.state.adventure.attemptsToday}/10`,
      { fontFamily: "monospace", fontSize: "11px", color: "#90a4ae" }
    );
    this.stageButtons.push(attempts);
  }

  private async goAdventure(h: HeroDto) {
    try {
      this.statusText.setColor("#90a4ae").setText("expedição em andamento...");
      const r = await api.adventure(h.id, this.selectedStage);
      this.state = r.state;
      this.render();
      this.statusText
        .setColor(r.success ? "#a5d6a7" : "#ef9a9a")
        .setText(
          r.success
            ? `vitória em ${r.stage}! +${(r.rewardMicro / 1_000_000).toFixed(2)} BLAST (chance ${r.successChance}%)`
            : `derrota em ${r.stage} (chance era ${r.successChance}%) — metade da stamina devolvida`
        );
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`aventura: ${(err as Error).message}`);
    }
  }

  private renderHeroes(heroes: HeroDto[]) {
    this.heroRows.forEach((c) => c.destroy());
    this.heroRows = heroes.map((h, i) => {
      const y = 100 + i * 92;
      const c = this.add.container(20, y);
      const body = this.add.image(0, -4, `hero-${h.rarity}`).setOrigin(0).setScale(0.85);
      const name = this.add.text(54, 0, `${RARITY_NAMES[h.rarity]}  pwr ${h.power} spd ${h.speed}`, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#eceff1",
      });
      const housed = h.houseId ? " ⌂" : "";
      const mode = this.add.text(
        54,
        16,
        (h.mode === "work" ? "⛏ minerando" : "zZz descansando") + housed,
        {
          fontFamily: "monospace",
          fontSize: "12px",
          color: h.mode === "work" ? "#a5d6a7" : "#90a4ae",
        }
      );
      const barBg = this.add.rectangle(54, 36, 130, 8, 0x263238).setOrigin(0);
      const bar = this.add
        .rectangle(54, 36, 130 * (h.stamina / h.staminaMax), 8, 0x4fc3f7)
        .setOrigin(0);
      const stamina = this.add.text(54, 48, `stamina ${h.stamina}/${h.staminaMax}`, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#90a4ae",
      });

      const homeIcon = h.houseId
        ? this.add.image(40, 40, "house").setScale(0.6)
        : null;
      c.add([body, name, mode, barBg, bar, stamina]);
      if (homeIcon) c.add(homeIcon);
      c.setSize(190, 60);
      c.setInteractive(new Phaser.Geom.Rectangle(0, 0, 190, 60), Phaser.Geom.Rectangle.Contains);
      c.on("pointerdown", () => {
        if (this.keyA.isDown) return this.goAdventure(h);
        if (this.keyH.isDown) return this.toggleHouse(h);
        return this.toggleHero(h);
      });
      return c;
    });
  }

  private async toggleHero(h: HeroDto) {
    try {
      this.state = await api.setMode(h.id, h.mode === "work" ? "rest" : "work");
      this.render();
      this.statusText.setText("");
    } catch (err) {
      this.statusText.setText(`erro: ${(err as Error).message}`);
    }
  }

  private async toggleHouse(h: HeroDto) {
    try {
      if (h.houseId) {
        this.state = await api.setHouse(h.id, null);
      } else {
        const free = this.state?.houses.find((x) => x.occupants < x.capacity);
        if (!free) {
          this.statusText.setText("nenhuma casa com vaga");
          return;
        }
        this.state = await api.setHouse(h.id, free.id);
      }
      this.render();
      this.statusText.setText("");
    } catch (err) {
      this.statusText.setText(`erro: ${(err as Error).message}`);
    }
  }

  /** Bomba cosmética num bloco vivo — feedback visual entre polls. */
  private cosmeticBomb() {
    if (!this.state?.heroes.some((h) => h.mode === "work")) return;
    const alive = this.state.blocks.map((b, i) => (b.hp > 0 ? i : -1)).filter((i) => i >= 0);
    if (alive.length === 0) return;
    const i = alive[Math.floor(Math.random() * alive.length)];
    const x = GRID_X + (i % COLS) * TILE + TILE / 2 - 3;
    const y = GRID_Y + Math.floor(i / COLS) * TILE + TILE / 2 - 3;

    const bomb = this.add.image(x, y - 20, "bomb");
    this.tweens.add({
      targets: bomb,
      y,
      duration: 300,
      ease: "Bounce.easeOut",
      onComplete: () => {
        bomb.destroy();
        const blast = this.add.circle(x, y, 6, 0xffa726).setAlpha(0.9);
        const spark = this.add.image(x, y, "spark").setScale(0.5);
        this.tweens.add({
          targets: blast,
          radius: 26,
          alpha: 0,
          duration: 350,
          onComplete: () => blast.destroy(),
        });
        this.tweens.add({
          targets: spark,
          scale: 1.6,
          angle: 90,
          alpha: 0,
          duration: 380,
          onComplete: () => spark.destroy(),
        });
      },
    });
  }

  private async onClaim() {
    try {
      this.statusText.setColor("#90a4ae").setText("emitindo voucher...");
      const voucher = await api.voucher();
      this.statusText.setText("confirme a transação de claim na carteira...");
      const tx = await claimVoucher(voucher);
      this.statusText.setColor("#a5d6a7").setText(`claim enviado: ${tx}`);
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`claim falhou: ${(err as Error).message}`);
      this.refresh();
    }
  }
}
