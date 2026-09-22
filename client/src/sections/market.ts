/**
 * MARKET section — port of the classic MarketScene: browse active listings
 * as cards, buy, list the player's own on-chain heroes/houses and cancel
 * own listings.
 */
import { formatEther, parseEther, type Address } from "viem";
import type { SectionContext, SectionModule } from "./overlay";
import { fetchListings, listNft, buyListing, cancelListing, type MarketListing } from "../web3/market";
import { api, type HeroDto, type HouseDto } from "../net/api";
import { HEROES_ADDRESS, HOUSES_ADDRESS, MARKET_ENABLED } from "../config";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];

const CSS = `
.market h2 { margin: 0 0 8px; font-size: 12px; }
.market .market-block { margin-bottom: 24px; }
.market .market-block > p { margin: 0 0 12px; }
.market .section-toolbar { justify-content: space-between; margin-bottom: 14px; }
.market .section-toolbar h2 { margin: 0; }
.market .item-card .price { display: flex; align-items: center; gap: 6px; }
.market .item-card .seller { font-size: 14px; color: var(--muted); }
.market .item-card .seller.mine { color: var(--ok); }
.market .item-card .btn { margin-top: 4px; }
.market .item-card .sprite-house { filter: drop-shadow(0 0 8px var(--rarity, transparent)); }
.market .mk-price { display: flex; align-items: center; gap: 6px; font-size: 15px; color: var(--muted-lt); }
.market .mk-price input {
  width: 110px; padding: 4px 8px; font-family: var(--font-body); font-size: 16px; color: var(--text);
  background: #101624; border: 2px solid var(--border); border-radius: 4px; text-align: right;
}
.market .mk-price input:focus { outline: none; border-color: var(--gold); }
.market .grid-cards .section-empty { grid-column: 1 / -1; }
`;

function injectCss(): void {
  if (document.head.querySelector('style[data-section="market"]')) return;
  const style = document.createElement("style");
  style.dataset.section = "market";
  style.textContent = CSS;
  document.head.append(style);
}

const fmtBlast = (wei: bigint): string => Number(formatEther(wei)).toLocaleString("en-US");
const shortAddr = (addr: string): string => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/** An NFT of the player's that can be listed. */
interface Sellable {
  collection: Address;
  tokenId: bigint;
  kind: "hero" | "house";
  rarity: number;
  sub: string;
}

/** On-chain house ids come as `house-<tokenId>` (or `chain-house-<tokenId>`). */
function houseTokenId(id: string): bigint | null {
  const m = /^(?:chain-)?house-(\d+)$/.exec(id);
  return m ? BigInt(m[1]) : null;
}

export const section: SectionModule = {
  title: "MARKET",
  needsLogin: true,
  mount(ctx: SectionContext) {
    injectCss();
    let mounted = true;
    let busy = false;
    const { esc } = ctx;
    const root = ctx.root;

    root.innerHTML = `
      <div class="market">
        <section class="market-block">
          <div class="section-toolbar">
            <h2>ACTIVE LISTINGS</h2>
            <button class="btn btn-gray btn-sm" type="button" id="mk-refresh" data-lock>Refresh</button>
          </div>
          <div class="grid-cards" id="mk-listings"><div class="section-empty">loading…</div></div>
        </section>
        <section class="market-block">
          <h2>SELL MY NFTS</h2>
          <p class="muted">Set a price in BLAST and list one of your on-chain heroes or houses (dev items cannot be listed).</p>
          <div class="grid-cards" id="mk-mine"><div class="section-empty">loading…</div></div>
        </section>
      </div>`;

    const listingsEl = root.querySelector<HTMLElement>("#mk-listings")!;
    const mineEl = root.querySelector<HTMLElement>("#mk-mine")!;
    const refreshBtn = root.querySelector<HTMLButtonElement>("#mk-refresh")!;

    const setBusy = (b: boolean) => {
      busy = b;
      root.querySelectorAll<HTMLButtonElement>("button[data-lock]").forEach((el) => { el.disabled = b; });
    };
    const requireWallet = (): boolean => {
      if (ctx.address()) return true;
      ctx.status("Wallet not connected — reconnect your wallet to trade.", "err");
      return false;
    };

    if (!MARKET_ENABLED) {
      listingsEl.innerHTML = `<div class="section-empty">The player market opens at the $BLAST launch — coming soon!</div>`;
      mineEl.innerHTML = `<div class="section-empty">Listing opens with the market.</div>`;
      refreshBtn.disabled = true;
      ctx.status("The player market opens at the $BLAST launch — coming soon!");
      return () => { mounted = false; };
    }

    let listings: MarketListing[] = [];
    let sellables: Sellable[] = [];

    refreshBtn.addEventListener("click", () => void refresh());
    void refresh();

    async function refresh() {
      if (busy) return;
      ctx.status("Loading listings...");
      try {
        const [ls, state] = await Promise.all([fetchListings(), api.state()]);
        if (!mounted) return;
        listings = ls;
        renderListings();
        renderMine(state.heroes, state.houses);
        ctx.status("");
      } catch (err) {
        if (!mounted) return;
        if ((err as Error).message === "session expired") {
          ctx.requestLogin();
          return;
        }
        listingsEl.innerHTML = `<div class="section-empty err">Could not load the market.</div>`;
        ctx.status(`Error: ${(err as Error).message}`, "err");
      }
    }

    function renderListings() {
      const me = ctx.address()?.toLowerCase();
      if (listings.length === 0) {
        listingsEl.innerHTML = `<div class="section-empty">No active listings yet.</div>`;
        return;
      }
      listingsEl.innerHTML = listings.map((l, i) => {
        const mine = l.seller.toLowerCase() === me;
        const isHero = l.collection.toLowerCase() === HEROES_ADDRESS.toLowerCase();
        const isHouse = !isHero && l.collection.toLowerCase() === HOUSES_ADDRESS.toLowerCase();
        const kind = isHero ? "Hero" : isHouse ? "House" : "NFT";
        const art = isHero ? `<span class="hero hero-2 walk"></span>` : `<span class="sprite-house"></span>`;
        return `
          <div class="item-card">
            ${art}
            <div class="title">${esc(kind)} #${esc(l.tokenId)}</div>
            <div class="sub">listing #${esc(l.id)}</div>
            <div class="seller${mine ? " mine" : ""}">${mine ? "your listing" : `seller ${esc(shortAddr(l.seller))}`}</div>
            <div class="price"><span class="sprite-coin"></span>${esc(fmtBlast(l.price))} BLAST</div>
            <button class="btn ${mine ? "btn-red" : "btn-green"} btn-sm" type="button" data-act="${mine ? "cancel" : "buy"}" data-i="${esc(i)}" data-lock>${mine ? "Cancel" : "Buy"}</button>
          </div>`;
      }).join("");
      listingsEl.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
        const l = listings[Number(btn.dataset.i)];
        btn.addEventListener("click", () => void (btn.dataset.act === "cancel" ? onCancel(l) : onBuy(l)));
      });
      if (busy) setBusy(true);
    }

    function renderMine(heroes: HeroDto[], houses: HouseDto[]) {
      sellables = [];
      for (const h of heroes) {
        if (!h.id.startsWith("chain-")) continue; // dev heroes cannot be listed
        sellables.push({
          collection: HEROES_ADDRESS as Address,
          tokenId: BigInt(h.id.slice("chain-".length)),
          kind: "hero",
          rarity: h.rarity,
          sub: `pwr ${h.power} · spd ${h.speed} · sta ${h.staminaMax}`,
        });
      }
      for (const h of houses ?? []) {
        const tokenId = houseTokenId(h.id);
        if (tokenId === null) continue;
        sellables.push({
          collection: HOUSES_ADDRESS as Address,
          tokenId,
          kind: "house",
          rarity: h.rarity,
          sub: `${h.capacity} hero slots · +${h.regenBoostBps / 100}% regen`,
        });
      }
      if (sellables.length === 0) {
        mineEl.innerHTML = `<div class="section-empty">No on-chain heroes or houses to sell (dev items cannot be listed).</div>`;
        return;
      }
      mineEl.innerHTML = sellables.map((s, i) => {
        const art = s.kind === "hero"
          ? `<span class="portrait portrait-${esc(s.rarity)}"></span>`
          : `<span class="sprite-house"></span>`;
        return `
          <div class="item-card rarity-${esc(s.rarity)}">
            ${art}
            <div class="title">${s.kind === "hero" ? "Hero" : "House"} #${esc(s.tokenId)} <span class="rarity-name">${esc(RARITY_NAMES[s.rarity] ?? "")}</span></div>
            <div class="sub">${esc(s.sub)}</div>
            <label class="mk-price"><input type="number" min="0" step="any" value="1000" id="mk-price-${esc(i)}" aria-label="Price in BLAST"> BLAST</label>
            <button class="btn btn-blue btn-sm" type="button" data-sell="${esc(i)}" data-lock>Sell</button>
          </div>`;
      }).join("");
      mineEl.querySelectorAll<HTMLButtonElement>("button[data-sell]").forEach((btn) => {
        const i = Number(btn.dataset.sell);
        btn.addEventListener("click", () => {
          const input = mineEl.querySelector<HTMLInputElement>(`#mk-price-${i}`);
          void onList(sellables[i], input?.value ?? "");
        });
      });
      if (busy) setBusy(true);
    }

    async function onList(s: Sellable, input: string) {
      if (busy || !requireWallet()) return;
      let priceWei: bigint;
      try {
        priceWei = parseEther(input.trim());
        if (priceWei <= 0n) throw new Error();
      } catch {
        ctx.status("Invalid price.", "err");
        return;
      }
      setBusy(true);
      try {
        ctx.status("Approve the NFT and the listing in your wallet (2 transactions)...");
        await listNft(s.collection, s.tokenId, priceWei);
        if (!mounted) return;
        setBusy(false);
        ctx.status("Listing sent!", "ok");
        void refresh();
      } catch (err) {
        if (!mounted) return;
        setBusy(false);
        ctx.status(`Listing failed: ${(err as Error).message}`, "err");
      }
    }

    async function onBuy(l: MarketListing) {
      if (busy || !requireWallet()) return;
      setBusy(true);
      try {
        ctx.status("Confirm approve + purchase in your wallet...");
        await buyListing(l);
        if (!mounted) return;
        setBusy(false);
        ctx.status("Purchase sent!", "ok");
        void refresh();
      } catch (err) {
        if (!mounted) return;
        setBusy(false);
        ctx.status(`Purchase failed: ${(err as Error).message}`, "err");
      }
    }

    async function onCancel(l: MarketListing) {
      if (busy || !requireWallet()) return;
      setBusy(true);
      try {
        ctx.status("Confirm the cancellation in your wallet...");
        await cancelListing(l.id);
        if (!mounted) return;
        setBusy(false);
        ctx.status("Cancellation sent!", "ok");
        void refresh();
      } catch (err) {
        if (!mounted) return;
        setBusy(false);
        ctx.status(`Cancel failed: ${(err as Error).message}`, "err");
      }
    }

    return () => { mounted = false; };
  },
};
