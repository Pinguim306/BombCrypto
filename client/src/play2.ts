// Buffer polyfill for the siwe package in the browser
import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;

import { TOKEN_ADDRESS, captureReferralFromUrl } from "./config";
import { MOBILE_WALLET_ENABLED, type WalletKind } from "./web3/wallet";
import { createBridge, type BridgeOptions } from "./bridge/mb";

/*
 * Host page for the Godot v2 client (docs/godot-v2-design.md §10.3). The
 * page owns everything outside the canvas: wallet/SIWE login, the site
 * header, the loader and the `window.mb` bridge Godot talks to. Boot order
 * matters — `window.mb` must exist before the engine script is even injected
 * (Appendix A, ordering guarantees).
 */

// Store a ?ref=0x... referral link (first link wins) before anything else.
captureReferralFromUrl();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const gameEl = $<HTMLDivElement>("game")!;
const canvas = $<HTMLCanvasElement>("godot-canvas")!;
const loader = $<HTMLDivElement>("loader")!;
const loaderBar = loader.querySelector<HTMLElement>(".bar i")!;
const loaderText = $<HTMLSpanElement>("loader-text")!;
const overlay = $<HTMLDivElement>("connect-overlay")!;
const connectStatus = $<HTMLParagraphElement>("connect-status")!;

const params = new URLSearchParams(location.search);
const mock = params.get("mock") === "1"; // Godot picks its MockBackend; no wallet, no server
const netName = (import.meta.env.VITE_NETWORK_NAME as string | undefined) ?? "Robinhood Chain";

function isLoggedIn(): boolean {
  // through window.mb, so a test override of sessionJson() is honoured
  try {
    return JSON.parse(window.mb.sessionJson()).loggedIn === true;
  } catch {
    return false;
  }
}

function showOverlay() {
  setStatus("", false);
  overlay.hidden = false;
}

function setStatus(text: string, error: boolean) {
  connectStatus.textContent = text;
  connectStatus.classList.toggle("error", error);
}

// ---- bridge (before anything Godot-related) ----
let godotReady = false; // set by Godot's ready(): the boot watchdog stands down
const bridgeOpts: BridgeOptions = {
  mock,
  networkName: netName,
  buildId: "", // filled in from the manifest below
  host: {
    onReady() {
      godotReady = true;
      loader.hidden = true;
      // demo data (?mock=1) has no wallet session to ask for
      if (!mock && !isLoggedIn()) showOverlay();
    },
    showLogin: showOverlay,
  },
};
window.mb = createBridge(bridgeOpts);
// Playwright hook: fakes for apiState & co. merged over the real bridge.
Object.assign(window.mb, window.__mbTestOverrides ?? {});

// ---- connect overlay ----
let connecting = false;
async function connect(kind: WalletKind) {
  if (connecting) return;
  connecting = true;
  const buttons = overlay.querySelectorAll<HTMLButtonElement>("button[data-kind]");
  buttons.forEach((b) => (b.disabled = true));
  try {
    setStatus(kind === "walletconnect" ? "scan the QR with your wallet app..." : "connecting...", false);
    await window.mb.connect({ kind });
    setStatus("sign the login message in your wallet...", false);
    await window.mb.signIn({}); // emits {"type":"session","loggedIn":true,"reason":"login"} to Godot
    setStatus("", false);
    overlay.hidden = true;
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    connecting = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
overlay.querySelectorAll<HTMLButtonElement>("button[data-kind]").forEach((b) => {
  const kind = b.dataset.kind as WalletKind;
  if (kind === "walletconnect") b.hidden = !MOBILE_WALLET_ENABLED;
  b.addEventListener("click", () => connect(kind));
});

// ---- site header (duplicate of main.ts; the Phaser entry stays untouched) ----

// Wallet chip -> disconnect: tear down the wallet session (WalletConnect
// included), clear the JWT and reload to the connect screen.
window.addEventListener("mb-disconnect", async () => {
  sessionStorage.removeItem("mb.jwt");
  const { disconnectWallet } = await import("./web3/wallet");
  await disconnectWallet().catch(() => {});
  location.reload();
});

// Header nav: the bridge already relayed the target to Godot; the Godot page
// only hosts mining, so every other section still lives on the Phaser page.
window.addEventListener("mb-nav", (e) => {
  const target = (e as CustomEvent<string>).detail;
  if (target !== "play") location.href = "/";
});

// Footer network line: name from env, test-asset disclaimer only on testnet.
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

// ---- canvas sizing ----
// canvasResizePolicy 0: the page owns the backing-store size. Render at the
// device pixel ratio so pixel art stays crisp on HiDPI; Godot's stretch mode
// maps its 960×540 viewport onto whatever size we give it.
function fit() {
  const w = gameEl.clientWidth;
  const h = gameEl.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}
new ResizeObserver(fit).observe(gameEl);
window.addEventListener("resize", fit); // DPR changes (zoom / monitor move) come through here
fit();

// ---- engine boot ----
interface Manifest {
  engine: string; // "/godot/engine-4.7.2/mb" → +".js" / +".wasm"
  pck: string;
  sizes: Record<string, number>;
  gitSha?: string;
  builtAt?: string;
}

function setLoader(text: string) {
  loaderText.textContent = text;
}

function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

type ManifestResult = { manifest: Manifest | null; reason: "ok" | "missing" | "unreachable" };

async function fetchManifest(): Promise<ManifestResult> {
  try {
    // never cached: it is the only mutable file of the deploy (engine + pck are hashed)
    const res = await fetch("/godot/manifest.json", { cache: "no-store" });
    if (res.status === 404) return { manifest: null, reason: "missing" };
    if (!res.ok) return { manifest: null, reason: "unreachable" };
    return { manifest: (await res.json()) as Manifest, reason: "ok" };
  } catch {
    return { manifest: null, reason: "unreachable" };
  }
}

/**
 * The vendored engine loader never rejects when WebAssembly instantiation
 * fails after the 39 MB download (it only surfaces as an unhandled rejection),
 * so race the start against that event and against a boot that stalls once
 * the download is complete. `ready()` from Godot counts as success.
 */
function bootFailure(dl: { doneAt: number }, isReady: () => boolean): Promise<never> {
  return new Promise<never>((_, reject) => {
    window.addEventListener("unhandledrejection", (e) => {
      if (isReady()) return;
      e.preventDefault();
      const reason = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
      reject(/CompileError|RangeError|LinkError/.test(reason.name) ? new Error(START_FAILED) : reason);
    });
    const timer = setInterval(() => {
      if (isReady()) clearInterval(timer);
      else if (dl.doneAt && Date.now() - dl.doneAt > 60_000) reject(new Error(START_FAILED));
    }, 1000);
  });
}
const START_FAILED = "the game failed to start — reload the page or try another browser";

async function boot() {
  const { manifest, reason } = await fetchManifest();
  if (!manifest || !manifest.engine || !manifest.pck) {
    setLoader(reason === "unreachable"
      ? "can't reach the game files — check your connection and reload"
      : "game build not deployed yet");
    return;
  }
  bridgeOpts.buildId = manifest.gitSha ?? "";

  // The engine loader is a plain script (never bundled: it is ~39 MB of wasm
  // behind it and versioned by folder), so `Engine` only exists after this.
  await loadScript(`${manifest.engine}.js`);

  const missing = Engine.getMissingFeatures({ threads: false });
  if (missing.length) {
    setLoader(`this browser cannot run the game: ${missing.join(", ")}`);
    return;
  }

  const dl = { doneAt: 0 };
  const engine = new Engine({
    executable: manifest.engine,
    mainPack: manifest.pck,
    canvas,
    canvasResizePolicy: 0,
    focusCanvas: false, // the page keeps focus until the player clicks the canvas
    serviceWorker: "",
    fileSizes: manifest.sizes ?? {},
    onProgress(current, total) {
      if (total > 0) {
        loaderBar.style.width = `${Math.min(100, Math.round((current / total) * 100))}%`;
        setLoader(`loading the mine… ${Math.round(current / 1048576)} / ${Math.round(total / 1048576)} MB`);
        if (current >= total && !dl.doneAt) dl.doneAt = Date.now();
      }
    },
    onPrint: console.log,
    onPrintError: console.error,
    onExit(code) {
      loader.hidden = false;
      setLoader(`the game exited (code ${code}) — reload the page`);
    },
  });

  // Godot boots while the wallet re-attaches: `ready()` may land before or
  // after `reconnect()` resolves, and the session listener replay covers
  // both orders. In mock mode there is no wallet to reconnect.
  const started = engine.startGame();
  if (!mock) void window.mb.reconnect({});
  await Promise.race([started, bootFailure(dl, () => godotReady)]);
}

boot().catch((err) => {
  console.error("[play2] boot failed", err);
  if (godotReady) return; // the game is up; whatever failed was not the boot
  loader.hidden = false;
  setLoader(err instanceof Error ? err.message : String(err));
});
