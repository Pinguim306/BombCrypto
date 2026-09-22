/**
 * Section overlays on the game page: SHOP, MARKET, HEROES, RANK, REFERRALS
 * and DAILY open as a wood panel over the running mine (the Godot canvas
 * keeps polling underneath). Each section is a lazily imported module:
 *
 *   export const section: SectionModule = {
 *     title: "SHOP",
 *     needsLogin: true,
 *     async mount(ctx) { ... ctx.root.innerHTML = ...; return () => cleanup }
 *   }
 *
 * Sections reuse the TypeScript that already talks to the server
 * (src/net/api.ts) and the chain (src/web3/*), and style themselves with
 * the classes in /site.css (.btn, .panel-dark, .item-card, .portrait-<r>...).
 */
import { hasToken } from "../net/api";
import { connectedAddress } from "../web3/wallet";
import type { SectionName } from "../site/chrome";

export type StatusKind = "neutral" | "ok" | "err";

export interface SectionContext {
  /** Container to render into (already inside the scrollable panel body). */
  root: HTMLElement;
  /** Status line under the body: message + colour; "" clears it. */
  status(msg: string, kind?: StatusKind): void;
  /** JWT session present (the mine is logged in). */
  loggedIn(): boolean;
  /** Connected wallet address, or null. */
  address(): string | null;
  /** Closes the section and shows the wallet connect overlay. */
  requestLogin(): void;
  close(): void;
  /** Re-mounts the section (after an action changed what it shows). */
  reload(): void;
  /** Escapes text for innerHTML. */
  esc(s: unknown): string;
}

export interface SectionModule {
  title: string;
  /** Show the connect prompt instead of mounting when there is no session. */
  needsLogin?: boolean;
  mount(ctx: SectionContext): void | (() => void) | Promise<void | (() => void)>;
}

export interface OverlayHooks {
  requestLogin(): void;
}

const LOADERS: Record<SectionName, () => Promise<{ section: SectionModule }>> = {
  shop: () => import("./shop"),
  market: () => import("./market"),
  heroes: () => import("./heroes"),
  leaderboard: () => import("./rank"),
  referrals: () => import("./referrals"),
  daily: () => import("./daily"),
};

export function isSectionName(s: string): s is SectionName {
  return Object.prototype.hasOwnProperty.call(LOADERS, s);
}

let overlay: HTMLElement | null = null;
let body: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let cleanup: (() => void) | null = null;
let current: SectionName | null = null;
let gen = 0;
let hooks: OverlayHooks = { requestLogin() {} };

export function configureOverlay(h: OverlayHooks): void {
  hooks = h;
}

export function currentSection(): SectionName | null {
  return current;
}

function ensureDom(): void {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.id = "section-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="backdrop"></div>
    <div class="section-panel" role="dialog" aria-modal="true">
      <div class="section-head">
        <div class="ribbon"><span id="section-title">SECTION</span></div>
        <button class="btn btn-red btn-sm" type="button" id="section-close" aria-label="Close"><span class="icon icon-close"></span></button>
      </div>
      <div class="section-body" id="section-body"></div>
      <div class="section-status" id="section-status"></div>
    </div>`;
  document.body.append(overlay);
  body = overlay.querySelector("#section-body");
  statusEl = overlay.querySelector("#section-status");
  titleEl = overlay.querySelector("#section-title");
  overlay.querySelector(".backdrop")!.addEventListener("click", closeSection);
  overlay.querySelector("#section-close")!.addEventListener("click", closeSection);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.hidden) closeSection();
  });
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function openSection(name: SectionName): Promise<void> {
  ensureDom();
  const g = ++gen;
  runCleanup();
  current = name;
  overlay!.hidden = false;
  titleEl!.textContent = name.toUpperCase();
  body!.innerHTML = `<div class="section-empty">loading…</div>`;
  setStatus("", "neutral");
  let mod: { section: SectionModule };
  try {
    mod = await LOADERS[name]();
  } catch (err) {
    if (g !== gen) return;
    body!.innerHTML = `<div class="section-empty err">this section failed to load: ${esc((err as Error).message)}</div>`;
    return;
  }
  if (g !== gen) return;
  const section = mod.section;
  titleEl!.textContent = section.title;
  const ctx: SectionContext = {
    root: body!,
    status: setStatus,
    loggedIn: () => hasToken(),
    address: () => connectedAddress(),
    requestLogin() {
      closeSection();
      hooks.requestLogin();
    },
    close: closeSection,
    reload() {
      if (current === name) void openSection(name);
    },
    esc,
  };
  if (section.needsLogin && !ctx.loggedIn()) {
    body!.innerHTML = `
      <div class="section-empty">
        <p>Connect your wallet to open the ${esc(section.title.toLowerCase())}.</p>
        <button class="btn btn-gold" type="button" id="section-login"><span class="icon icon-wallet"></span>Connect wallet</button>
      </div>`;
    body!.querySelector("#section-login")!.addEventListener("click", ctx.requestLogin);
    return;
  }
  body!.innerHTML = "";
  try {
    const c = await section.mount(ctx);
    if (g !== gen) {
      if (typeof c === "function") c();
      return;
    }
    cleanup = typeof c === "function" ? c : null;
  } catch (err) {
    if (g !== gen) return;
    setStatus(`error: ${(err as Error).message}`, "err");
  }
}

export function closeSection(): void {
  if (!overlay || overlay.hidden) return;
  gen++;
  runCleanup();
  current = null;
  overlay.hidden = true;
  body!.innerHTML = "";
}

function runCleanup(): void {
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* a section's cleanup must never block closing */
    }
    cleanup = null;
  }
}

function setStatus(msg: string, kind: StatusKind = "neutral"): void {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = `section-status${kind === "neutral" ? "" : ` ${kind}`}`;
}
