/**
 * Shareable "I pulled a hero" card. Renders a branded pixel-art card to a
 * canvas and shares it (Web Share API on mobile, Twitter intent + download
 * fallback on desktop). Turns every good chest pull into free marketing.
 */
import { RARITY_COLORS } from "./art/pixelart";

const RARITY_NAMES = ["Common", "Rare", "Super Rare", "Epic", "Legendary", "Mythic"];

// 16x16 miner hero character map (mirrors art/pixelart.ts HERO_MAP).
const HERO_MAP = [
  "......KKK.......", ".....KlLlK......", "....KKKKKKK.....", "...KHHHHHHHK....",
  "..KHHHHHHHHHK...", "..KHhhhhhhhHK...", ".KHVVVVVVVVVHK..", ".KHVEEKVKEEVHK..",
  ".KHVVVVVVVVVHK..", "..KHhhhhhhhHK...", "...KHHHHHHHK....", "...KBBBBBBBK....",
  "..KGBbbbbbBGK...", "..KGBbbbbbBGK...", "...KBB.K.BBK....", "..KGGGK.KGGGK..",
];

function hex(v: number): string {
  return "#" + v.toString(16).padStart(6, "0");
}
function shade(v: number, f: number): number {
  const r = Math.min(255, Math.round(((v >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((v >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((v & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

function drawHero(ctx: CanvasRenderingContext2D, rarity: number, ox: number, oy: number, px: number) {
  const c = RARITY_COLORS[rarity] ?? 0xffffff;
  const pal: Record<string, string> = {
    K: hex(0x10141f), L: hex(0xffee58), l: hex(0xfff9c4), H: hex(c), h: hex(shade(c, 0.72)),
    V: hex(0x1d2731), E: hex(0x80deea), B: hex(shade(c, 0.62)), b: hex(shade(c, 0.45)), G: hex(0x37474f),
  };
  HERO_MAP.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = pal[ch];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(ox + x * px, oy + y * px, px, px);
      }
    });
  });
}

/** Renders the pull card to a canvas. Returns it (1200x675, 16:9). */
export function renderHeroCard(rarity: number, heroId: bigint | number): HTMLCanvasElement {
  const W = 1200, H = 675;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // background + starfield
  ctx.fillStyle = "#10141f";
  ctx.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = ["#1a2031", "#1e2639", "#151b2a"][i % 3];
    ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 2, 2);
  }

  // wordmark
  ctx.font = "bold 44px monospace";
  ctx.fillStyle = "#ffb74d"; ctx.textBaseline = "top";
  ctx.fillText("MINER", 60, 46);
  const w = ctx.measureText("MINER").width;
  ctx.fillStyle = "#4fc3f7";
  ctx.fillText("BLAST", 60 + w, 46);

  const rc = RARITY_COLORS[rarity] ?? 0xffffff;
  const color = hex(rc);

  // rarity-framed hero, centered-left
  const px = 14, hw = 16 * px, cx = 300, cy = 300;
  // glow
  const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 190);
  grad.addColorStop(0, `${color}55`); grad.addColorStop(1, "#10141f00");
  ctx.fillStyle = grad; ctx.fillRect(cx - 200, cy - 200, 400, 400);
  // frame
  ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.strokeRect(cx - hw / 2 - 16, cy - hw / 2 - 16, hw + 32, hw + 32);
  drawHero(ctx, rarity, cx - hw / 2, cy - hw / 2, px);

  // rarity headline
  ctx.textAlign = "left";
  ctx.font = "bold 72px monospace";
  ctx.fillStyle = color;
  ctx.fillText(RARITY_NAMES[rarity].toUpperCase(), 560, 210);
  ctx.font = "bold 40px monospace";
  ctx.fillStyle = "#eceff1";
  ctx.fillText(`HERO #${heroId}`, 560, 300);
  ctx.font = "24px monospace";
  ctx.fillStyle = "#b0bec5";
  ctx.fillText("just pulled on MinerBlast ⛏", 560, 360);

  // footer
  ctx.font = "bold 30px monospace";
  ctx.fillStyle = "#ffca28";
  ctx.fillText("minerblast.fun", 560, 470);
  ctx.font = "20px monospace";
  ctx.fillStyle = "#78909c";
  ctx.fillText("play-to-earn mining · Robinhood Chain", 560, 510);

  return canvas;
}

const canvasToBlob = (c: HTMLCanvasElement): Promise<Blob> =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("no blob"))), "image/png"));

/**
 * Shares the pull card: native share sheet with the image on capable devices,
 * otherwise downloads the PNG and opens a pre-filled X/Twitter post.
 */
export async function shareHeroPull(rarity: number, heroId: bigint | number): Promise<void> {
  const canvas = renderHeroCard(rarity, heroId);
  const text = `I just pulled a ${RARITY_NAMES[rarity]} hero on MinerBlast! ⛏️💥 Play & earn at minerblast.fun`;
  let blob: Blob | null = null;
  try {
    blob = await canvasToBlob(canvas);
  } catch {
    /* fall through to intent-only */
  }

  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (blob && nav.share && nav.canShare) {
    const file = new File([blob], "minerblast-hero.png", { type: "image/png" });
    if (nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], text });
        return;
      } catch {
        /* user cancelled or share failed: fall through */
      }
    }
  }

  // desktop fallback: download the image + open a pre-filled post
  if (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "minerblast-hero.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}
