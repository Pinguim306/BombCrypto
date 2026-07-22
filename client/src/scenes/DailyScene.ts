import Phaser from "phaser";
import { api, DailyStatusDto } from "../net/api";
import { registerPixelArt } from "../art/pixelart";
import { drawPanel, drawRibbon, makeButton, Button } from "../art/ui";

/** Daily login streak, in-game tab. A 7-day track that grows the reward on
 *  consecutive days; missing a day resets it. Rewards credit pending BLAST. */
export class DailyScene extends Phaser.Scene {
  private status?: DailyStatusDto;
  private cells: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private streakText!: Phaser.GameObjects.Text;
  private claimBtn!: Button;

  constructor() {
    super("daily");
  }

  create() {
    this.cells = [];
    registerPixelArt(this);
    this.add.tileSprite(0, 0, 800, 600, "cave").setOrigin(0).setAlpha(0.5);

    drawRibbon(this, 400, 34, "DAILY REWARD", 240);
    const back = makeButton(this, 740, 34, "Back", { width: 90, height: 34, color: 0x37474f });
    back.onClick(() => this.scene.start("mining"));

    this.add.text(400, 80, "Come back every day — the longer your streak, the bigger the reward.", {
      fontFamily: "monospace", fontSize: "13px", color: "#b0bec5",
    }).setOrigin(0.5);
    this.streakText = this.add.text(400, 104, "", {
      fontFamily: "monospace", fontSize: "15px", color: "#ff8a65", fontStyle: "bold",
    }).setOrigin(0.5);

    this.claimBtn = makeButton(this, 400, 470, "Claim daily reward", {
      width: 300, height: 46, color: 0x2e7d32, fontSize: "16px",
    });
    this.claimBtn.onClick(() => this.claim());

    this.statusText = this.add.text(400, 524, "", {
      fontFamily: "monospace", fontSize: "14px", color: "#90a4ae", wordWrap: { width: 720 },
    }).setOrigin(0.5);

    this.refresh();
  }

  private async refresh() {
    this.statusText.setColor("#90a4ae").setText("Loading...");
    try {
      const s = await api.dailyStatus();
      if (!this.sys.settings.active) return;
      this.status = s;
      this.statusText.setText("");
      this.render();
    } catch (err) {
      if (!this.sys.settings.active) return;
      if ((err as Error).message === "session expired") {
        this.scene.start("connect");
        return;
      }
      this.statusText.setColor("#ef9a9a").setText(`Error: ${(err as Error).message}`);
    }
  }

  private render() {
    if (!this.status) return;
    this.cells.forEach((c) => c.destroy());
    this.cells = [];
    const s = this.status;

    // days already collected in the current cycle, and the next claimable day
    const filled = s.claimedToday ? s.nextDay : s.nextDay - 1;
    const nextClaimable = s.claimedToday || !s.canClaim ? 0 : s.nextDay;

    this.streakText.setText(s.streak > 0 ? `🔥 ${s.streak}-day streak` : "Start your streak today!");

    const n = s.rewards.length; // 7
    const cellW = 96, gap = 8;
    const startX = (800 - (n * cellW + (n - 1) * gap)) / 2;
    const y = 150, h = 150;

    s.rewards.forEach((blast, i) => {
      const day = i + 1;
      const x = startX + i * (cellW + gap);
      const cx = x + cellW / 2;
      const claimed = day <= filled;
      const isNext = day === nextClaimable;
      const isDay7 = day === n;

      const fill = claimed ? 0x1b3a24 : isNext ? 0x3a2c10 : 0x161d2e;
      const g = this.add.graphics();
      g.fillStyle(0x0a0e18, 1);
      g.fillRoundedRect(x - 2, y - 2, cellW + 4, h + 4, 10);
      g.fillStyle(fill, 1);
      g.fillRoundedRect(x, y, cellW, h, 8);
      const border = claimed ? 0x2e7d32 : isNext ? 0xe8952f : 0x2a3550;
      g.lineStyle(isNext ? 3 : 2, border, 1);
      g.strokeRoundedRect(x, y, cellW, h, 8);
      if (isDay7) {
        g.lineStyle(2, 0xffca28, 0.9);
        g.strokeRoundedRect(x + 4, y + 4, cellW - 8, h - 8, 6);
      }
      this.cells.push(g);

      // day label
      this.cells.push(this.add.text(cx, y + 20, isDay7 ? "DAY 7" : `Day ${day}`, {
        fontFamily: "monospace", fontSize: "13px",
        color: isDay7 ? "#ffca28" : "#90a4ae", fontStyle: "bold",
      }).setOrigin(0.5));

      // coin + reward
      this.cells.push(this.add.image(cx, y + 58, "coin").setScale(0.85));
      this.cells.push(this.add.text(cx, y + 88, blast.toLocaleString("en-US"), {
        fontFamily: "monospace", fontSize: "15px", color: "#ffca28", fontStyle: "bold",
      }).setOrigin(0.5));
      this.cells.push(this.add.text(cx, y + 105, "BLAST", {
        fontFamily: "monospace", fontSize: "10px", color: "#b0895a",
      }).setOrigin(0.5));

      // day-7 jackpot note (own row, above the badge)
      if (isDay7) {
        this.cells.push(this.add.text(cx, y + 120, `${s.jackpotChance}% 🎁 jackpot`, {
          fontFamily: "monospace", fontSize: "10px", color: "#81c784", fontStyle: "bold",
        }).setOrigin(0.5));
      }

      // state badge (bottom row)
      if (claimed) {
        this.cells.push(this.add.text(cx, y + 138, "✓ claimed", {
          fontFamily: "monospace", fontSize: "10px", color: "#66bb6a",
        }).setOrigin(0.5));
      } else if (isNext) {
        const glow = this.add.text(cx, y + 138, "▼ today", {
          fontFamily: "monospace", fontSize: "11px", color: "#ffb74d", fontStyle: "bold",
        }).setOrigin(0.5);
        this.tweens.add({ targets: glow, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
        this.cells.push(glow);
      }
    });

    // claim button state
    if (!s.hasHero) {
      this.claimBtn.setEnabled(false);
      this.claimBtn.setLabel("Get a hero to claim");
      this.statusText.setColor("#90a4ae").setText("You need at least one hero — buy a chest in the Shop to join the streak.");
    } else if (s.claimedToday) {
      this.claimBtn.setEnabled(false);
      this.claimBtn.setLabel("Come back tomorrow");
      this.statusText.setColor("#81c784").setText(`Day ${s.nextDay} claimed! Return tomorrow to keep your streak going.`);
    } else {
      this.claimBtn.setEnabled(true);
      this.claimBtn.setLabel(`Claim Day ${s.nextDay} · ${s.rewards[s.nextDay - 1].toLocaleString("en-US")} BLAST`);
    }
  }

  private async claim() {
    try {
      this.claimBtn.setEnabled(false);
      this.statusText.setColor("#90a4ae").setText("Claiming...");
      const { claim } = await api.claimDaily();
      if (!this.sys.settings.active) return;
      if (claim.jackpot) {
        this.statusText.setColor("#ffca28").setText(
          `💰 JACKPOT! ${claim.totalBlast.toLocaleString("en-US")} BLAST (incl. +${claim.jackpotBlast.toLocaleString("en-US")} bonus)!`
        );
        this.celebrate();
      } else {
        this.statusText.setColor("#81c784").setText(
          `🎉 Claimed ${claim.totalBlast.toLocaleString("en-US")} BLAST! Added to your pending balance.`
        );
      }
      await this.refresh();
    } catch (err) {
      if (!this.sys.settings.active) return;
      this.claimBtn.setEnabled(true);
      this.statusText.setColor("#ef9a9a").setText(`${(err as Error).message}`);
    }
  }

  /** Brief coin shower for a day-7 jackpot. */
  private celebrate() {
    for (let i = 0; i < 24; i++) {
      const coin = this.add.image(Phaser.Math.Between(60, 740), -20, "coin").setScale(0.7);
      this.tweens.add({
        targets: coin,
        y: 640,
        angle: Phaser.Math.Between(-180, 180),
        duration: Phaser.Math.Between(1200, 2200),
        delay: i * 40,
        ease: "Cubic.easeIn",
        onComplete: () => coin.destroy(),
      });
    }
  }
}
