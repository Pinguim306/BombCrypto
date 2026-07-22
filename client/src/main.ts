// Buffer polyfill for the siwe package in the browser
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;

import Phaser from "phaser";
import { ConnectScene } from "./scenes/ConnectScene";
import { MiningScene } from "./scenes/MiningScene";
import { MarketScene } from "./scenes/MarketScene";
import { ShopScene } from "./scenes/ShopScene";
import { HeroesScene } from "./scenes/HeroesScene";
import { TOKEN_ADDRESS, captureReferralFromUrl } from "./config";

// Store a ?ref=0x... referral link (first link wins) before anything else.
captureReferralFromUrl();

// Crisp text: render every Text object at 2x internal resolution so glyphs
// stay sharp when Scale.FIT upsizes the 800x600 stage. (Sprites keep their
// pixel look via per-texture NEAREST filtering in art/pixelart.ts.)
const factoryProto = Phaser.GameObjects.GameObjectFactory.prototype as any;
const originalText = factoryProto.text;
factoryProto.text = function (x: number, y: number, content?: any, style?: any) {
  return originalText.call(this, x, y, content, { resolution: 2, ...(style ?? {}) });
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#10141f",
  scale: {
    // FIT scales the whole 800x600 stage to the window, so nothing is
    // ever cropped on small screens (the canvas shrinks instead).
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  scene: [ConnectScene, MiningScene, ShopScene, MarketScene, HeroesScene],
});

// Site header -> in-game navigation. Ignored until the player logs in.
const GAME_SCENES = ["mining", "shop", "market", "heroes"];
let navLock = false; // two nav clicks in one frame would leave two scenes active
window.addEventListener("mb-nav", (e) => {
  if (navLock) return;
  const target = (e as CustomEvent<string>).detail;
  const active = game.scene.getScenes(true).map((s) => s.scene.key);
  const current = GAME_SCENES.find((k) => active.includes(k));
  if (!current) return; // still on the connect screen
  const dest = target === "play" ? "mining" : target;
  if (GAME_SCENES.includes(dest) && dest !== current) {
    navLock = true;
    setTimeout(() => (navLock = false), 150);
    game.scene.getScene(current).scene.start(dest);
  }
});

// Wallet chip -> disconnect: tear down the wallet session (WalletConnect
// included), clear the JWT and reload to the connect screen.
window.addEventListener("mb-disconnect", async () => {
  sessionStorage.removeItem("mb.jwt");
  const { disconnectWallet } = await import("./web3/wallet");
  await disconnectWallet().catch(() => {});
  location.reload();
});

// Footer network line: name from env, test-asset disclaimer only on testnet.
const netName = (import.meta.env.VITE_NETWORK_NAME as string | undefined) ?? "Robinhood Chain";
const netNameEl = document.getElementById("net-name");
if (netNameEl) netNameEl.textContent = netName;
const disclaimerEl = document.getElementById("net-disclaimer");
if (disclaimerEl && /testnet/i.test(netName)) {
  disclaimerEl.textContent = " · rewards and NFTs are test assets with no real value";
}

// $BLAST contract address chip in the header (set VITE_BLAST_CA at deploy
// time — e.g. on Vercel — once the launchpad token goes live). `||`, not
// `??`: a present-but-empty env var must still fall back to the game token.
const ca = ((import.meta.env.VITE_BLAST_CA as string | undefined) ?? "").trim() || TOKEN_ADDRESS;
const caChip = document.getElementById("blast-ca");
if (caChip && ca && !/^0x0{40}$/.test(ca)) {
  const caText = document.getElementById("blast-ca-text");
  if (caText) caText.textContent = `${ca.slice(0, 8)}…${ca.slice(-6)}`;
  caChip.style.display = "";
  caChip.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ca);
      if (caText) {
        const prev = caText.textContent;
        caText.textContent = "copied!";
        setTimeout(() => (caText.textContent = prev), 1200);
      }
    } catch {
      /* clipboard unavailable; the address is still visible */
    }
  });
}
