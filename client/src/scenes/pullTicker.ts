import Phaser from "phaser";
import { recentPulls, RecentPull } from "../web3/gacha";
import { RARITY_COLORS } from "../art/pixelart";
import { GACHA_ENABLED } from "../config";

const RARITY_NAMES = ["Common", "Rare", "Super Rare", "Epic", "Legendary", "Mythic"];

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export interface PullTicker {
  destroy(): void;
}

/**
 * A compact "live activity" line that cycles through recent hero pulls across
 * all players — social proof / FOMO. Auto-hides when the chain has no pulls
 * yet (or is unconfigured). Reads on-chain ChestOpened events directly.
 *
 * `emptyText` (optional) is shown when there are no pulls instead of hiding —
 * useful on the landing screen so the strip is never blank.
 */
export function attachPullTicker(
  scene: Phaser.Scene,
  cx: number,
  y: number,
  width: number,
  opts: { emptyText?: string } = {}
): PullTicker {
  const g = scene.add.graphics();
  g.fillStyle(0x0a0e18, 0.85);
  g.fillRoundedRect(cx - width / 2, y - 15, width, 30, 15);
  g.lineStyle(2, 0x2a3550, 1);
  g.strokeRoundedRect(cx - width / 2, y - 15, width, 30, 15);

  const dot = scene.add.circle(cx - width / 2 + 18, y, 4, 0x00e676);
  const label = scene.add.text(cx - width / 2 + 32, y, "LIVE", {
    fontFamily: "monospace", fontSize: "11px", color: "#00e676", fontStyle: "bold",
  }).setOrigin(0, 0.5);
  // seed with the placeholder so the strip is never blank while the first
  // on-chain read is in flight
  const line = scene.add.text(cx + 14, y, opts.emptyText ?? "", {
    fontFamily: "monospace", fontSize: "13px", color: "#78909c",
  }).setOrigin(0.5, 0.5);

  const objs = [g, dot, label, line];
  let pulls: RecentPull[] = [];
  let idx = 0;
  let cycle: Phaser.Time.TimerEvent | undefined;
  let pulseTween: Phaser.Tweens.Tween | undefined;
  let alive = true;

  // pulsing "live" dot
  pulseTween = scene.tweens.add({
    targets: dot, alpha: 0.3, duration: 700, yoyo: true, repeat: -1,
  });

  const showEmpty = () => {
    if (opts.emptyText) {
      line.setColor("#78909c").setText(opts.emptyText);
    } else {
      objs.forEach((o) => o.setVisible(false));
    }
  };

  const renderCurrent = () => {
    if (!alive || pulls.length === 0) return;
    const p = pulls[idx % pulls.length];
    const name = RARITY_NAMES[p.rarity] ?? "hero";
    const color = "#" + (RARITY_COLORS[p.rarity] ?? 0xcfd8dc).toString(16).padStart(6, "0");
    const emoji = p.rarity >= 4 ? "🏆" : p.rarity >= 2 ? "✨" : "⛏️";
    line.setColor(color).setText(`${emoji} ${short(p.buyer)} pulled a ${name} hero!`);
    // brief fade-in on each change
    line.setAlpha(0);
    scene.tweens.add({ targets: line, alpha: 1, duration: 300 });
  };

  const advance = () => {
    if (!alive || pulls.length === 0) return;
    idx = (idx + 1) % pulls.length;
    renderCurrent();
  };

  const load = async () => {
    if (!GACHA_ENABLED) {
      showEmpty();
      return;
    }
    const data = await recentPulls(20);
    if (!alive || !scene.sys.settings.active) return;
    // surface the rares preferentially, but keep everything so the strip lives
    const rares = data.filter((p) => p.rarity >= 2);
    pulls = (rares.length >= 3 ? rares : data);
    if (pulls.length === 0) {
      showEmpty();
      return;
    }
    idx = 0;
    renderCurrent();
    cycle = scene.time.addEvent({ delay: 3200, loop: true, callback: advance });
  };

  load();

  return {
    destroy() {
      alive = false;
      cycle?.remove();
      pulseTween?.stop();
      objs.forEach((o) => o.destroy());
    },
  };
}
