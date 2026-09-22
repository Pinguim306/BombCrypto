/**
 * Site chrome shared by every page: the wood header (pixel logo, PLAY, the
 * section buttons, wallet chip, DOCS menu), the $BLAST contract strip and
 * the footer. Rendered into `#site-header` / `#site-footer` mounts so the
 * markup lives in one place; styles are in /site.css.
 *
 *   mountChrome({ page: "game" })  section buttons dispatch `mb-nav` events
 *                                  (the game page opens the section overlays)
 *   mountChrome({ page: "doc" })   section buttons link to `/?go=<section>`
 */
import { TOKEN_ADDRESS } from "../config";

export type SectionName = "shop" | "market" | "heroes" | "leaderboard" | "referrals" | "daily";
export const SECTIONS: { key: SectionName; label: string }[] = [
  { key: "daily", label: "DAILY" },
  { key: "referrals", label: "REFERRALS" },
  { key: "leaderboard", label: "RANK" },
  { key: "heroes", label: "HEROES" },
  { key: "market", label: "MARKET" },
  { key: "shop", label: "SHOP" },
];

export interface ChromeOptions {
  page: "game" | "doc";
}

export function navEvent(target: string): void {
  window.dispatchEvent(new CustomEvent("mb-nav", { detail: target }));
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function mountChrome(opts: ChromeOptions): void {
  const header = document.getElementById("site-header") ?? prependMount("site-header");
  const footer = document.getElementById("site-footer") ?? appendMount("site-footer");
  const onGame = opts.page === "game";
  const navItems = SECTIONS.map((s) =>
    onGame
      ? `<button type="button" data-nav="${s.key}">${s.label}</button>`
      : `<a href="/?go=${s.key}">${s.label}</a>`
  ).join("");

  header.innerHTML = `
    <header class="site-header">
      <a class="logo" href="/" aria-label="MinerBlast">
        <span class="sprite-bomb bomb" aria-hidden="true"></span>
        <img src="/art/ui/logo_small.png" alt="MinerBlast" width="288" height="64" />
      </a>
      ${onGame ? `<button class="btn btn-gold btn-play" type="button" data-nav="play">PLAY</button>` : `<a class="btn btn-gold btn-play" href="/">PLAY</a>`}
      <nav>
        ${navItems}
        <button class="wallet-chip" id="wallet-chip" type="button" title="Click to disconnect"${onGame ? "" : " hidden"}><span class="icon icon-sm icon-wallet"></span><span class="wallet-text">WALLET</span></button>
        <div class="dropdown" id="docs-dd">
          <button class="docs-btn" id="docs-btn" type="button" aria-haspopup="true" aria-expanded="false">DOCS ▾</button>
          <div class="docs-menu">
            <a href="/stats.html">STATS</a>
            <a href="/whitepaper.html">WHITEPAPER</a>
            <a href="/guide.html">GUIDE</a>
          </div>
        </div>
      </nav>
    </header>
    <div class="ca-strip" id="blast-ca" title="Click to copy the contract address">
      <span class="ca-label">$BLAST CA:</span>
      <span class="ca-text" id="blast-ca-text"></span>
      <span class="ca-copy">⧉</span>
    </div>`;

  const netName = (import.meta.env.VITE_NETWORK_NAME as string | undefined) ?? "Robinhood Chain";
  const disclaimer = /testnet/i.test(netName) ? " · rewards and NFTs are test assets with no real value" : "";
  footer.innerHTML = `
    <footer class="site-footer">
      <b>MinerBlast</b> — built on <span id="net-name">${netName}</span><span id="net-disclaimer">${disclaimer}</span>
      · <a href="/guide.html">how to play</a> · <a href="/whitepaper.html">whitepaper</a> · <a href="/stats.html">stats</a>
    </footer>`;

  // section / play buttons (game page): dispatch to the page controller
  header.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => navEvent(b.dataset.nav ?? "play"))
  );

  // DOCS dropdown: toggle on click, close on outside click
  const docsDd = header.querySelector<HTMLElement>("#docs-dd")!;
  const docsBtn = header.querySelector<HTMLElement>("#docs-btn")!;
  docsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = docsDd.classList.toggle("open");
    docsBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => {
    docsDd.classList.remove("open");
    docsBtn.setAttribute("aria-expanded", "false");
  });

  // wallet chip: filled by the `mb-wallet` event, click = disconnect
  const chip = header.querySelector<HTMLButtonElement>("#wallet-chip")!;
  const chipText = chip.querySelector<HTMLElement>(".wallet-text")!;
  window.addEventListener("mb-wallet", (e) => {
    const a = String((e as CustomEvent<string>).detail ?? "");
    if (!a) return;
    chipText.textContent = shortAddress(a);
    chip.classList.add("connected");
  });
  chip.addEventListener("click", () => {
    if (!chip.classList.contains("connected")) return;
    if (confirm("Disconnect this wallet from MinerBlast?")) window.dispatchEvent(new CustomEvent("mb-disconnect"));
  });

  // $BLAST contract address strip (VITE_BLAST_CA at deploy time, else the game token)
  const ca = ((import.meta.env.VITE_BLAST_CA as string | undefined) ?? "").trim() || TOKEN_ADDRESS;
  const strip = header.querySelector<HTMLElement>("#blast-ca")!;
  if (ca && !/^0x0{40}$/.test(ca)) {
    const caText = strip.querySelector<HTMLElement>("#blast-ca-text")!;
    caText.textContent = `${ca.slice(0, 8)}…${ca.slice(-6)}`;
    strip.classList.add("visible");
    strip.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(ca);
        const prev = caText.textContent;
        caText.textContent = "copied!";
        setTimeout(() => (caText.textContent = prev), 1200);
      } catch {
        /* clipboard unavailable; the address is still visible */
      }
    });
  }
}

function prependMount(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.prepend(el);
  return el;
}

function appendMount(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.append(el);
  return el;
}
