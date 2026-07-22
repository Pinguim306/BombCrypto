import Phaser from "phaser";
import { api, GameStateDto, HeroDto } from "../net/api";
import { claimVoucher } from "../web3/wallet";
import { registerPixelArt, blockTier, RARITY_COLORS } from "../art/pixelart";
import { drawPanel, drawRibbon, drawPill, makeButton, Button } from "../art/ui";

const COLS = 8;
const ROWS = 5;
const TILE = 64;
const GRID_X = 258;
const GRID_Y = 90;
const POLL_MS = 2000;

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];

// Display-only earnings estimate — MUST mirror server/src/game/engine.ts
// (BOMB_BASE_INTERVAL_MS and REWARD_MICRO_PER_HP). A working hero throws a
// bomb every 4000/(1+speed/100) ms and earns power * 0.075 BLAST per bomb:
// BLAST/hour = 67.5 * power * (1 + speed/100).
const teamBlastPerHour = (heroes: HeroDto[]): number =>
  heroes
    .filter((h) => h.mode === "work")
    .reduce((sum, h) => sum + 67.5 * h.power * (1 + h.speed / 100), 0);

/**
 * Main mining screen. All simulation happens on the server; this scene
 * only renders the state polled every POLL_MS and animates cosmetic bombs.
 * Clicking a hero opens the action popup (work/rest, shelter, adventure).
 */
export class MiningScene extends Phaser.Scene {
  private state?: GameStateDto;
  private blockSprites: Phaser.GameObjects.Image[] = [];
  private blockCracks: Phaser.GameObjects.Image[] = [];
  private blockBars: Phaser.GameObjects.Rectangle[] = [];
  private heroRows: Phaser.GameObjects.Container[] = [];
  private pendingText!: Phaser.GameObjects.Text;
  private rateText!: Phaser.GameObjects.Text;
  private housesText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private claimBtn!: Button;
  private heroPanel?: Phaser.GameObjects.Container;
  private stageButtons: Phaser.GameObjects.Text[] = [];
  private selectedStage = 0;
  private heroPage = 0;
  private pageWidgets: Phaser.GameObjects.GameObject[] = [];
  private pollTimer?: Phaser.Time.TimerEvent;
  private bombTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super("mining");
  }

  create() {
    // Scene instances are reused across restarts (header navigation), so
    // every GameObject list must start empty — stale entries would point at
    // destroyed objects and crash render() ("reading 'sys'").
    this.blockSprites = [];
    this.blockCracks = [];
    this.blockBars = [];
    this.heroRows = [];
    this.stageButtons = [];
    this.pageWidgets = [];
    this.heroPanel = undefined;
    this.state = undefined;
    this.heroPage = 0;

    registerPixelArt(this);
    if (!this.anims.exists("boom")) {
      this.anims.create({
        key: "boom",
        frames: [{ key: "boom-0" }, { key: "boom-1" }, { key: "boom-2" }],
        frameRate: 14,
        hideOnComplete: true,
      });
    }

    // cave backdrop behind the mining grid + side/status panels
    this.add
      .tileSprite(GRID_X - 10, GRID_Y - 10, COLS * TILE + 14, ROWS * TILE + 14, "cave")
      .setOrigin(0);
    drawPanel(this, 30, 62, 216, 356); // hero list
    drawPanel(this, 30, 424, 216, 120); // houses
    drawPanel(this, 30, 550, 740, 40); // status bar

    // section ribbon (the MinerBlast logo lives in the site header)
    drawRibbon(this, 400, 30, "TREASURE MINING");

    // pending BLAST pill counter
    this.pendingText = drawPill(this, GRID_X, 52, 262, "coin", "loading...");

    // team mining rate, aligned with the hero list column below it
    this.rateText = drawPill(this, 30, 20, 216, "pick", "...");

    // Shop/Market moved to the site header; only Claim stays in-game
    this.claimBtn = makeButton(this, 708, 34, "Claim", {
      width: 124, height: 36, color: 0x3949ab, icon: "coin", iconScale: 0.55,
    });
    this.claimBtn.onClick(() => this.onClaim());

    // daily-streak entry point, with a pulsing badge when a claim is ready
    const daily = makeButton(this, 585, 34, "Daily", {
      width: 110, height: 36, color: 0x00695c, fontSize: "13px",
    });
    daily.onClick(() => this.scene.start("daily"));
    api.dailyStatus().then((d) => {
      if (!this.sys.settings.active || !d.canClaim) return;
      const badge = this.add.circle(636, 18, 7, 0xff5252).setStrokeStyle(2, 0x0a0e18);
      const ping = this.add.text(636, 18, "!", {
        fontFamily: "monospace", fontSize: "11px", color: "#ffffff", fontStyle: "bold",
      }).setOrigin(0.5);
      this.tweens.add({ targets: [badge, ping], scale: 1.25, duration: 600, yoyo: true, repeat: -1 });
    }).catch(() => {});

    // one click sends the whole team to the blocks — lives right on top of
    // the hero list so the connection is obvious
    const workAll = makeButton(this, 138, 104, "Mine all", {
      width: 200, height: 22, color: 0x2e7d32, icon: "pick", iconScale: 0.4, fontSize: "12px",
    });
    workAll.onClick(async () => {
      try {
        workAll.setEnabled(false);
        const state = await api.setTeamMode("work");
        if (!this.sys.settings.active) return;
        this.state = state;
        this.render();
        this.statusText.setColor("#a5d6a7").setText(
          state.changed > 0
            ? `${state.changed} hero${state.changed > 1 ? "es" : ""} sent to work! ⛏`
            : "everyone is already mining (or out of stamina)"
        );
      } catch (err) {
        if (!this.sys.settings.active) return;
        this.statusText.setColor("#ef9a9a").setText(`error: ${(err as Error).message}`);
      } finally {
        if (this.sys.settings.active) workAll.setEnabled(true);
      }
    });

    this.statusText = this.add.text(38, 560, "", {
      fontFamily: "monospace",
      fontSize: "13px",
      color: "#90a4ae",
      wordWrap: { width: 724 },
    });

    // block grid (textures by ore hardness + progressive crack overlays)
    for (let i = 0; i < COLS * ROWS; i++) {
      const x = GRID_X + (i % COLS) * TILE;
      const y = GRID_Y + Math.floor(i / COLS) * TILE;
      const img = this.add
        .image(x, y, "block-0")
        .setOrigin(0)
        .setDisplaySize(TILE - 6, TILE - 6);
      const crack = this.add
        .image(x, y, "crack-1")
        .setOrigin(0)
        .setDisplaySize(TILE - 6, TILE - 6)
        .setVisible(false);
      const bar = this.add.rectangle(x, y + TILE - 12, TILE - 6, 5, 0xffc107).setOrigin(0);
      this.blockSprites.push(img);
      this.blockCracks.push(crack);
      this.blockBars.push(bar);
    }

    this.add.text(40, 72, "HEROES", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#90a4ae",
      fontStyle: "bold",
    });

    this.housesText = this.add.text(40, 436, "", {
      fontFamily: "monospace",
      fontSize: "11px",
      color: "#b0bec5",
      wordWrap: { width: 196 },
    });


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
      const state = await api.state();
      if (!this.sys.settings.active) return; // scene was left mid-request
      this.state = state;
      this.render();
    } catch (err) {
      if (!this.sys.settings.active) return;
      this.statusText.setText(`error: ${(err as Error).message}`);
      if ((err as Error).message === "session expired") this.scene.start("connect");
    }
  }

  private render() {
    if (!this.state) return;
    const pending = Number(this.state.pendingBlast);
    const min = this.state.claimRules.minBlast;
    this.pendingText.setText(`${pending.toFixed(2)} BLAST · min ${min.toLocaleString("en-US")}`);

    const rate = teamBlastPerHour(this.state.heroes);
    this.rateText.setText(
      rate > 0 ? `~${Math.round(rate).toLocaleString("en-US")} BLAST/h` : "team idle · 0 BLAST/h"
    );
    // claim button only active once the minimum is reached
    const canClaim = pending >= min;
    this.claimBtn.setEnabled(canClaim);
    this.claimBtn.setLabel(canClaim ? "Claim" : "Locked");

    this.state.blocks.forEach((b, i) => {
      const alive = b.hp > 0;
      // depleted floor varies per cell: some tiles reveal a glowing crystal
      const deadKey = (i * 7 + 3) % 5 === 0 ? "block-dead2" : "block-dead";
      const key = alive ? `block-${blockTier(b.maxHp)}` : deadKey;
      const sprite = this.blockSprites[i];
      if (sprite.texture.key !== key) {
        sprite.setTexture(key).setDisplaySize(TILE - 6, TILE - 6);
      }
      // cracks deepen as HP drops
      const ratio = b.hp / b.maxHp;
      const crack = this.blockCracks[i];
      if (alive && ratio < 0.66) {
        const crackKey = ratio < 0.33 ? "crack-2" : "crack-1";
        if (crack.texture.key !== crackKey) {
          crack.setTexture(crackKey).setDisplaySize(TILE - 6, TILE - 6);
        }
        crack.setVisible(true);
      } else {
        crack.setVisible(false);
      }
      this.blockBars[i].setVisible(alive).width = (TILE - 6) * (b.hp / b.maxHp);
    });

    const MAX_HOUSE_LINES = 6;
    let houseLines: string[];
    if (this.state.houses.length) {
      houseLines = this.state.houses
        .slice(0, MAX_HOUSE_LINES)
        .map((h) => `${RARITY_NAMES[h.rarity]} ${h.occupants}/${h.capacity} · +${h.regenBoostBps / 100}%`);
      const extra = this.state.houses.length - MAX_HOUSE_LINES;
      if (extra > 0) houseLines.push(`…and ${extra} more`);
    } else {
      houseLines = ["No houses yet.", "Buy one in the Shop, then", "click a hero and Shelter it."];
    }
    this.housesText.setText(["HOUSES:"].concat(houseLines).join("\n"));

    this.renderStages();

    this.renderHeroes(this.state.heroes);
  }

  /** Adventure stage selection buttons (used by the hero popup's Adventure). */
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
            // fixed size so the three cards keep even gutters on the 178 pitch,
            // regardless of text length or the ▶ selection prefix
            fixedWidth: 162,
            fixedHeight: 40,
          }
        )
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => {
        this.selectedStage = s.id;
        this.renderStages();
      });
      return btn;
    });
    const rules = this.state.claimRules;
    const attempts = this.add.text(
      GRID_X,
      GRID_Y + ROWS * TILE + 62,
      `adventures today: ${this.state.adventure.attemptsToday}/10   ` +
        `withdraw: min ${rules.minBlast.toLocaleString("en-US")} BLAST, every ${rules.cooldownHours}h`,
      { fontFamily: "monospace", fontSize: "11px", color: "#90a4ae" }
    );
    this.stageButtons.push(attempts);
  }

  private async goAdventure(h: HeroDto) {
    try {
      this.statusText.setColor("#90a4ae").setText("expedition in progress...");
      const r = await api.adventure(h.id, this.selectedStage);
      this.state = r.state;
      this.render();
      this.statusText
        .setColor(r.success ? "#a5d6a7" : "#ef9a9a")
        .setText(
          r.success
            ? `victory in ${r.stage}! +${(r.rewardMicro / 1_000_000).toFixed(2)} BLAST (chance ${r.successChance}%)`
            : `defeat in ${r.stage} (chance was ${r.successChance}%) — half the stamina refunded`
        );
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`adventure: ${(err as Error).message}`);
    }
  }

  private renderHeroes(heroes: HeroDto[]) {
    const PER_PAGE = 4;
    const pages = Math.max(1, Math.ceil(heroes.length / PER_PAGE));
    if (this.heroPage >= pages) this.heroPage = pages - 1;

    this.heroRows.forEach((c) => c.destroy());
    this.pageWidgets.forEach((w) => w.destroy());
    this.pageWidgets = [];

    // pager (only when the roster does not fit on one page)
    if (pages > 1) {
      const prev = this.add.text(166, 71, "◀", {
        fontFamily: "monospace", fontSize: "14px", color: this.heroPage > 0 ? "#4fc3f7" : "#37474f",
      }).setInteractive({ useHandCursor: true });
      prev.on("pointerdown", () => { if (this.heroPage > 0) { this.heroPage--; this.render(); } });
      const label = this.add.text(188, 73, `${this.heroPage + 1}/${pages}`, {
        fontFamily: "monospace", fontSize: "12px", color: "#90a4ae",
      });
      const next = this.add.text(218, 71, "▶", {
        fontFamily: "monospace", fontSize: "14px",
        color: this.heroPage < pages - 1 ? "#4fc3f7" : "#37474f",
      }).setInteractive({ useHandCursor: true });
      next.on("pointerdown", () => { if (this.heroPage < pages - 1) { this.heroPage++; this.render(); } });
      this.pageWidgets.push(prev, label, next);
    }

    const visible = heroes.slice(this.heroPage * PER_PAGE, this.heroPage * PER_PAGE + PER_PAGE);
    this.heroRows = visible.map((h, i) => {
      const y = 128 + i * 74;
      const c = this.add.container(38, y);
      // rarity-framed portrait
      const frame = this.add.rectangle(-3, -7, 58, 62, 0x101624)
        .setOrigin(0)
        .setStrokeStyle(2, RARITY_COLORS[h.rarity] ?? 0xffffff);
      c.add(frame);
      const body = this.add.image(0, -4, `hero-${h.rarity}`).setOrigin(0).setScale(0.85);
      const pick = this.add.image(46, 26, "pick").setOrigin(0.15, 0.85);
      if (h.mode === "work") {
        // mining bob + pickaxe swing while working
        this.tweens.add({ targets: body, y: 0, duration: 420, yoyo: true, repeat: -1 });
        pick.setAngle(-35);
        this.tweens.add({
          targets: pick,
          angle: 30,
          duration: 420,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      } else {
        pick.setAngle(15).setAlpha(0.55);
      }
      const name = this.add.text(64, 0, `${RARITY_NAMES[h.rarity]} P${h.power} S${h.speed}`, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#eceff1",
      });
      const housed = h.houseId ? " ⌂" : "";
      const mode = this.add.text(
        64,
        16,
        (h.mode === "work" ? "⛏ mining" : "zZz resting") + housed,
        {
          fontFamily: "monospace",
          fontSize: "12px",
          color: h.mode === "work" ? "#a5d6a7" : "#90a4ae",
        }
      );
      const barBg = this.add.rectangle(64, 36, 124, 8, 0x263238).setOrigin(0);
      const bar = this.add
        .rectangle(64, 36, 124 * (h.stamina / h.staminaMax), 8, 0x4fc3f7)
        .setOrigin(0);
      const stamina = this.add.text(64, 48, `stamina ${h.stamina}/${h.staminaMax}`, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#90a4ae",
      });

      const homeIcon = h.houseId
        ? this.add.image(40, 40, "house").setScale(0.6)
        : null;
      c.add([body, pick, name, mode, barBg, bar, stamina]);
      if (homeIcon) c.add(homeIcon);
      // children are top-left anchored; Phaser adds displayOrigin (95,30) to
      // the local pointer, so the hit rect is offset to cover local (0..190).
      c.setSize(190, 60);
      c.setInteractive(new Phaser.Geom.Rectangle(95, 30, 190, 60), Phaser.Geom.Rectangle.Contains);
      c.on("pointerdown", () => this.openHeroPanel(h));
      return c;
    });
  }

  private async toggleHero(h: HeroDto) {
    try {
      this.state = await api.setMode(h.id, h.mode === "work" ? "rest" : "work");
      this.render();
      this.statusText.setText("");
    } catch (err) {
      this.statusText.setText(`error: ${(err as Error).message}`);
    }
  }

  private async toggleHouse(h: HeroDto) {
    try {
      if (h.houseId) {
        this.state = await api.setHouse(h.id, null);
      } else {
        const free = this.state?.houses.find((x) => x.occupants < x.capacity);
        if (!free) {
          this.statusText.setText("no house with a free slot");
          return;
        }
        this.state = await api.setHouse(h.id, free.id);
      }
      this.render();
      this.statusText.setText("");
    } catch (err) {
      this.statusText.setText(`error: ${(err as Error).message}`);
    }
  }

  private closeHeroPanel() {
    this.heroPanel?.destroy();
    this.heroPanel = undefined;
  }

  /** Centered hero action panel: work/rest, shelter, adventure — no keyboard. */
  private openHeroPanel(h: HeroDto) {
    this.closeHeroPanel();
    const px = 230;
    const py = 150;
    const pw = 340;
    const ph = 300;
    const panel = this.add.container(0, 0).setDepth(100);

    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.5);
    bg.fillRect(0, 0, 800, 600); // dim backdrop
    bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, 800, 600), Phaser.Geom.Rectangle.Contains);
    bg.on("pointerdown", () => this.closeHeroPanel());
    panel.add(bg);

    const card = drawPanel(this, px, py, pw, ph);
    panel.add(card);

    const ribbon = drawRibbon(this, px + pw / 2, py + 4, `${RARITY_NAMES[h.rarity]} Hero`, 200);
    const hero = this.add.image(px + 70, py + 88, `hero-${h.rarity}`).setScale(2.0);
    const heroRate = Math.round(67.5 * h.power * (1 + h.speed / 100));
    const stats = this.add.text(px + 150, py + 46,
      `Power    ${h.power}\nSpeed    ${h.speed}\nStamina  ${h.stamina}/${h.staminaMax}\n` +
        `Mines    ~${heroRate.toLocaleString("en-US")} BLAST/h`,
      { fontFamily: "monospace", fontSize: "13px", color: "#eceff1", lineSpacing: 6 });
    const modeLine = this.add.text(px + 20, py + 156,
      h.mode === "work" ? "Status: mining" : "Status: resting",
      { fontFamily: "monospace", fontSize: "12px", color: h.mode === "work" ? "#a5d6a7" : "#90a4ae" });
    panel.add([ribbon, hero, stats, modeLine]);

    // action buttons
    const workBtn = makeButton(this, px + 90, py + 195, h.mode === "work" ? "Rest" : "Work", {
      width: 130, height: 38, color: h.mode === "work" ? 0x546e7a : 0x2e7d32,
    });
    workBtn.onClick(async () => { await this.toggleHero(h); this.closeHeroPanel(); });

    const houseBtn = makeButton(this, px + 240, py + 195, h.houseId ? "Leave House" : "Shelter", {
      width: 150, height: 38, color: 0x00838f, icon: "house", iconScale: 0.4,
    });
    houseBtn.onClick(async () => { await this.toggleHouse(h); this.closeHeroPanel(); });

    const advBtn = makeButton(this, px + 90, py + 245,
      `Adventure`, { width: 130, height: 38, color: 0x6a1b9a, icon: "bomb", iconScale: 0.6 });
    advBtn.onClick(async () => { await this.goAdventure(h); this.closeHeroPanel(); });

    const closeBtn = makeButton(this, px + 240, py + 245, "Close", { width: 150, height: 38, color: 0x37474f });
    closeBtn.onClick(() => this.closeHeroPanel());

    panel.add([workBtn.container, houseBtn.container, advBtn.container, closeBtn.container]);
    this.heroPanel = panel;
  }

  /** Cosmetic bomb on a live block — visual feedback between polls. */
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
        const boom = this.add.sprite(x, y, "boom-0");
        boom.play("boom");
        boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());
        const spark = this.add.image(x, y, "spark").setScale(0.5);
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
      this.statusText.setColor("#90a4ae").setText("issuing voucher...");
      const voucher = await api.voucher();
      this.statusText.setText("confirm the claim transaction in your wallet...");
      const tx = await claimVoucher(voucher);
      this.statusText.setColor("#a5d6a7").setText(`claim sent: ${tx}`);
      this.refresh();
    } catch (err) {
      this.statusText.setColor("#ef9a9a").setText(`claim failed: ${(err as Error).message}`);
      this.refresh();
    }
  }
}
