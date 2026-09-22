/**
 * SHOP section — port of the classic ShopScene: hero chests (ETH) with the
 * chest-opening ceremony (countdown, open, reroll, hero reveal + share),
 * stamina houses (BLAST) and the live "recent pulls" ticker.
 */
import { formatEther } from "viem";
import type { SectionContext, SectionModule } from "./overlay";
import {
  gachaPrices, buyChest, buyPack, myUnopenedChests, chestStatus, rerollChest, openChestAndReveal,
  recentPulls, type RecentPull,
} from "../web3/gacha";
import { housePrices, buyHouse, blastBalance } from "../web3/houses";
import { GACHA_ENABLED, MARKET_ENABLED } from "../config";
import { sleep, shortError } from "../util";
import { shareHeroPull } from "../share";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];
const TICKER_NAMES = ["Common", "Rare", "Super Rare", "Epic", "Legendary", "Mythic"];

const CSS = `
.shop h2 { margin: 0 0 6px; font-size: 12px; }
.shop .shop-block { margin-bottom: 22px; }
.shop .shop-block > p { margin: 0 0 12px; }
.shop .shop-block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.shop .shop-ticker {
  display: flex; align-items: center; gap: 10px; margin: 0 0 16px; padding: 6px 16px; border-radius: 18px; min-height: 34px;
  background: #0a0e18; border: 2px solid var(--border); font-size: 15px; color: var(--muted);
}
.shop .shop-ticker[hidden] { display: none; }
.shop .shop-ticker .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #00e676; animation: shop-pulse 1.4s ease-in-out infinite; flex: 0 0 auto; }
.shop .shop-ticker .live { font-family: var(--font-pixel); font-size: 9px; color: #00e676; flex: 0 0 auto; }
.shop .shop-ticker .line { flex: 1 1 auto; text-align: center; color: var(--rarity, var(--muted)); font-weight: 700; animation: shop-fade .3s ease-out; }
.shop .shop-ticker .line .icon { width: 20px; height: 20px; background-size: 20px 20px; margin-right: 6px; }
@keyframes shop-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@keyframes shop-fade { from { opacity: 0; } to { opacity: 1; } }
.shop .shop-chests { display: flex; align-items: center; gap: 22px 30px; flex-wrap: wrap; padding: 6px 4px 10px; }
.shop .shop-chests .sprite-chest { flex: 0 0 auto; animation: shop-bob 1.3s ease-in-out infinite; }
@keyframes shop-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
.shop .shop-actions { display: flex; flex-direction: column; gap: 22px; align-items: flex-start; flex: 1 1 260px; }
.shop .shop-pending { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; flex: 0 1 260px; }
.shop .shop-pending .ids { display: flex; flex-wrap: wrap; gap: 4px; }
.shop .shop-reveal { margin: 14px 0 6px; text-align: center; }
.shop .shop-reveal[hidden] { display: none; }
.shop .shop-reveal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.shop .shop-reveal-head .pixel { color: var(--gold); font-size: 12px; }
.shop .shop-reveal-stage { position: relative; height: 230px; display: grid; place-items: center; }
.shop .shop-reveal-stage .sprite-chest { transform: scale(1.5); }
.shop .shop-reveal-stage .sprite-chest.shake { animation: shop-shake .09s linear 6 alternate; }
@keyframes shop-shake { from { transform: scale(1.5) rotate(-4deg); } to { transform: scale(1.5) rotate(4deg); } }
.shop .shop-reveal-stage .hero { position: absolute; left: 50%; top: 50%; margin: -32px 0 0 -32px; transform: scale(3); animation: shop-pop .4s cubic-bezier(.34,1.56,.64,1); filter: drop-shadow(0 0 14px var(--rarity, transparent)); }
@keyframes shop-pop { from { transform: scale(1.1); opacity: 0; } to { transform: scale(3); opacity: 1; } }
.shop .shop-reveal-info { min-height: 52px; margin: 6px 0 14px; font-size: 17px; white-space: pre-line; color: var(--muted-lt); }
.shop .shop-reveal-info.warn { color: #ffcc80; } .shop .shop-reveal-info.err { color: var(--err); } .shop .shop-reveal-info.ok { color: var(--ok); }
.shop .shop-reveal-info .rarity-name { font-family: var(--font-pixel); font-size: 14px; line-height: 1.8; }
.shop .shop-reveal-actions { display: flex; justify-content: center; align-items: center; gap: 26px; flex-wrap: wrap; padding: 4px 0 10px; }
.shop .shop-reveal-actions button[hidden] { display: none; }
.shop .shop-houses .item-card .sprite-house { filter: drop-shadow(0 0 8px var(--rarity)); }
.shop .shop-houses .item-card .price { display: flex; align-items: center; gap: 6px; }
.shop .shop-houses .item-card .btn { margin-top: 4px; }
.shop .shop-note { color: #ffcc80; }
`;

function injectCss(): void {
  if (document.head.querySelector('style[data-section="shop"]')) return;
  const style = document.createElement("style");
  style.dataset.section = "shop";
  style.textContent = CSS;
  document.head.append(style);
}

const fmtBlast = (wei: bigint): string =>
  Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const shortAddr = (addr: string): string => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export const section: SectionModule = {
  title: "SHOP",
  needsLogin: true,
  mount(ctx: SectionContext) {
    injectCss();
    let mounted = true;
    let busy = false;
    let tickerTimer: number | undefined;
    let closeCeremony: (() => void) | null = null;
    const { esc } = ctx;
    const root = ctx.root;

    root.innerHTML = `
      <div class="shop">
        <div class="shop-ticker" id="shop-ticker" hidden>
          <span class="live-dot"></span><span class="live">LIVE</span><span class="line" id="shop-ticker-line"></span>
        </div>

        <section class="shop-block">
          <h2>HERO CHESTS</h2>
          <p class="muted">Each chest reveals 1 hero. Odds: Common 52% · Rare 26% · S.Rare 12% · Epic 6.5% · Legend 3% · Mythic 0.5%</p>
          <div class="shop-chests">
            <span class="sprite-chest"></span>
            <div class="shop-actions" id="shop-actions"><span class="muted">Loading prices...</span></div>
            <div class="shop-pending" id="shop-pending"></div>
          </div>
          <div class="shop-reveal panel-dark" id="shop-reveal" hidden></div>
        </section>

        <section class="shop-block">
          <div class="shop-block-head">
            <h2>STAMINA HOUSES</h2>
            <span class="gold" id="shop-balance"></span>
          </div>
          <p class="muted">Houses let sheltered heroes recover stamina faster. Paid in BLAST.</p>
          <div class="shop-houses grid-cards" id="shop-houses"><span class="muted">Loading house prices...</span></div>
        </section>
      </div>`;

    const $ = <T extends HTMLElement = HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
    const actionsEl = $("shop-actions");
    const pendingEl = $("shop-pending");
    const revealEl = $("shop-reveal");
    const housesEl = $("shop-houses");
    const balanceEl = $("shop-balance");

    /** Locks every purchase button while a transaction is in flight. */
    const setBusy = (b: boolean) => {
      busy = b;
      root.querySelectorAll<HTMLButtonElement>("button[data-lock]").forEach((el) => { el.disabled = b; });
    };
    const requireWallet = (): boolean => {
      if (ctx.address()) return true;
      ctx.status("Wallet not connected — reconnect your wallet to buy.", "err");
      return false;
    };

    // ---------- CHESTS (ETH) ----------
    if (!GACHA_ENABLED) {
      actionsEl.innerHTML = `
        <div><div class="shop-note">Chest sales open at the $BLAST launch.</div>
        <div class="muted">Follow the announcements — coming very soon!</div></div>`;
    } else {
      gachaPrices().then((p) => {
        if (!mounted) return;
        actionsEl.innerHTML = `
          <button class="btn btn-green" type="button" id="shop-buy-chest" data-lock>
            <span class="icon icon-star"></span>Buy 1 Chest — ${esc(formatEther(p.chestWei))} ETH
          </button>
          <button class="btn btn-gold" type="button" id="shop-buy-pack" data-lock>
            <span class="icon icon-gift"></span>Buy ${esc(p.packSize)}-Pack — ${esc(formatEther(p.packWei))} ETH (save 20%)
          </button>`;
        $("shop-buy-chest").addEventListener("click", () => void onBuyChest(p.chestWei, false));
        $("shop-buy-pack").addEventListener("click", () => void onBuyChest(p.packWei, true));
        if (busy) setBusy(true);
      }).catch(() => {
        if (mounted) actionsEl.innerHTML = `<span class="err">Shop unavailable.</span>`;
      });
      void checkPendingChests();
    }

    async function onBuyChest(valueWei: bigint, pack: boolean) {
      if (busy || !requireWallet()) return;
      setBusy(true);
      try {
        // buyChest/buyPack resolve only after the tx is MINED, so the reveal
        // panel's first on-chain read is guaranteed to see the new chest
        ctx.status("Confirm the purchase in your wallet, then wait a moment for it to confirm...");
        await (pack ? buyPack(valueWei) : buyChest(valueWei));
        if (!mounted) return;
        setBusy(false);
        ctx.status("Purchase confirmed!", "ok");
        void openRevealPanel();
      } catch (err) {
        if (!mounted) return;
        setBusy(false);
        ctx.status(`Purchase failed: ${shortError(err)}`, "err");
      }
    }

    /** Lists the player's unopened chests with an "Open N chests" button. */
    async function checkPendingChests() {
      const pending = await myUnopenedChests().catch(() => [] as bigint[]);
      if (!mounted) return;
      if (pending.length === 0) {
        pendingEl.innerHTML = "";
        return;
      }
      const ids = pending.map((id) => `<span class="tag">#${esc(id)}</span>`).join("");
      pendingEl.innerHTML = `
        <div class="muted">Unopened chests (${esc(pending.length)}):</div>
        <div class="ids">${ids}</div>
        <button class="btn btn-gold btn-sm" type="button" id="shop-open-pending" data-lock>
          <span class="icon icon-gift"></span>Open ${esc(pending.length)} chest${pending.length > 1 ? "s" : ""}
        </button>`;
      $("shop-open-pending").addEventListener("click", () => void openRevealPanel());
      if (busy) setBusy(true);
    }

    /**
     * Chest-opening ceremony: walks the player through each pending chest —
     * reveal countdown, OPEN button, wallet confirmation and the hero reveal
     * with rarity colours. Same call order as the classic scene.
     */
    async function openRevealPanel() {
      if (closeCeremony) return;
      if (!requireWallet()) return;
      let closed = false;
      let waiters: (() => void)[] = [];
      revealEl.hidden = false;
      revealEl.innerHTML = `
        <div class="shop-reveal-head">
          <span class="pixel">CHEST OPENING</span>
          <button class="btn btn-gray btn-sm" type="button" id="rv-close" aria-label="Close"><span class="icon icon-close"></span></button>
        </div>
        <div class="shop-reveal-stage"><span class="sprite-chest" id="rv-chest"></span><span id="rv-hero" hidden></span></div>
        <div class="shop-reveal-info" id="rv-info"></div>
        <div class="shop-reveal-actions">
          <button class="btn btn-green" type="button" id="rv-open" disabled><span class="icon icon-gift"></span><span id="rv-open-label">OPEN CHEST</span></button>
          <button class="btn btn-blue btn-sm" type="button" id="rv-share" hidden><span class="icon icon-star"></span><span id="rv-share-label">Share</span></button>
        </div>`;
      const chest = $("rv-chest");
      const heroEl = $("rv-hero");
      const info = $("rv-info");
      const openBtn = $<HTMLButtonElement>("rv-open");
      const openLabel = $("rv-open-label");
      const closeBtn = $<HTMLButtonElement>("rv-close");
      const shareBtn = $<HTMLButtonElement>("rv-share");
      const shareLabel = $("rv-share-label");

      const setInfo = (text: string, kind: "" | "warn" | "err" | "ok" = "") => {
        info.className = `shop-reveal-info${kind ? ` ${kind}` : ""}`;
        info.textContent = text;
      };
      const shake = () => {
        chest.classList.remove("shake");
        void chest.offsetWidth; // restart the animation
        chest.classList.add("shake");
      };
      // resolves on the next click of the OPEN/REROLL button, or when the
      // panel closes (so the loop below can exit instead of dangling)
      const waitOpenClick = () =>
        new Promise<void>((resolve) => {
          const onClick = () => { openBtn.removeEventListener("click", onClick); resolve(); };
          waiters.push(onClick);
          openBtn.addEventListener("click", onClick);
        });

      const finish = () => {
        if (closed) return;
        closed = true;
        closeCeremony = null;
        waiters.forEach((w) => w());
        waiters = [];
        if (!mounted) return;
        revealEl.hidden = true;
        revealEl.innerHTML = "";
        void checkPendingChests();
      };
      closeCeremony = finish;
      closeBtn.addEventListener("click", finish);

      // "Share your pull" — hidden until a hero is revealed; shares the best
      // pull of the session
      let best: { rarity: number; heroId: bigint } | null = null;
      shareBtn.addEventListener("click", () => { if (best) void shareHeroPull(best.rarity, best.heroId); });

      // true once this panel must stop touching the DOM: closed via X or the
      // section was unmounted
      const dead = () => closed || !mounted;

      // walk through every pending chest, one at a time
      let opened = 0;
      while (!dead()) {
        const pending = await myUnopenedChests().catch(() => [] as bigint[]);
        if (dead()) return;
        if (pending.length === 0) {
          setInfo(
            opened > 0
              ? "All chests opened! Your heroes appear on the mining screen in ~1 min."
              : "No unopened chests.",
            "ok"
          );
          openBtn.disabled = true;
          return;
        }
        const id = pending[0];
        const remaining = pending.length;
        setInfo(`Chest #${id} (${remaining} left)\nFair draw in progress...`, "warn");
        openBtn.disabled = true;
        openLabel.textContent = "OPEN CHEST";

        // Wait for the on-chain reveal window with an honest countdown.
        // The draw block does not exist yet at purchase time (that is the
        // fairness guarantee), which takes ~2 parent-chain blocks (~25s).
        const EXPECTED_S = 25;
        let status = await chestStatus(id);
        let waited = 0;
        while (!dead() && status === "waiting" && waited < 180) {
          const eta = EXPECTED_S - waited;
          setInfo(
            `Chest #${id} (${remaining} left)\n` +
              (eta > 0 ? `Fair draw in progress... ~${eta}s` : "Almost there — finalizing the draw..."),
            "warn"
          );
          if (waited % 4 === 0) shake();
          await sleep(1000);
          if (dead()) return;
          waited++;
          // ask the chain every 3s; the button unlocks the moment it is ready
          if (waited % 3 === 0) status = await chestStatus(id);
        }
        if (dead()) return;

        if (status === "unavailable") {
          // opened from another tab or wallet switched — rescan the list
          await sleep(2000);
          continue;
        }

        if (status === "waiting") {
          setInfo(`Chest #${id} is taking longer than usual.\nStill waiting — you can close and come back later.`, "warn");
          continue;
        }

        if (status === "expired") {
          // blockhash gone (>256 blocks since purchase): the chest needs a
          // reroll tx to get a fresh reveal block before it can be opened
          setInfo(`Chest #${id}'s reveal window expired.\nReroll it (a quick transaction) to prepare it again.`, "warn");
          openLabel.textContent = "REROLL";
          openBtn.disabled = false;
          await waitOpenClick();
          if (dead()) return;
          openBtn.disabled = true;
          closeBtn.disabled = true;
          setBusy(true);
          setInfo("Confirm the reroll in your wallet...");
          ctx.status("Confirm the reroll in your wallet...");
          try {
            await rerollChest(id);
            if (!mounted) return;
            setBusy(false);
            if (dead()) return;
            closeBtn.disabled = false;
            ctx.status("Reroll confirmed.", "ok");
          } catch (err) {
            if (!mounted) return;
            setBusy(false);
            if (dead()) return;
            closeBtn.disabled = false;
            setInfo(`Reroll failed: ${shortError(err)}\nYou can try again.`, "err");
            ctx.status(`Reroll failed: ${(err as Error).message}`, "err");
            await sleep(3000);
          }
          continue;
        }

        // status === "ready"
        setInfo(`Chest #${id} is ready!`);
        openBtn.disabled = false;
        await waitOpenClick();
        if (dead()) return;
        openBtn.disabled = true;
        // closing while the tx is in the wallet would let a second panel
        // submit a duplicate openChest for the same id — lock the X until done
        closeBtn.disabled = true;
        setBusy(true);
        setInfo("Confirm the transaction in your wallet...");
        ctx.status("Confirm the transaction in your wallet...");

        try {
          const revealed = await openChestAndReveal(id);
          if (!mounted) return;
          setBusy(false);
          if (dead()) return;
          closeBtn.disabled = false;
          opened++;
          // reveal ceremony: the chest opens and the hero pops out, 3x
          const r = revealed.rarity;
          const name = RARITY_NAMES[r] ?? "Hero";
          chest.classList.add("open");
          heroEl.className = `hero hero-${esc(r)} rarity-${esc(r)}`;
          heroEl.hidden = false;
          info.className = "shop-reveal-info";
          info.innerHTML = `<span class="rarity-${esc(r)} rarity-name">${esc(name.toUpperCase())} HERO #${esc(revealed.heroId)}!</span>`;
          ctx.status(`Chest #${id} opened: ${name} hero #${revealed.heroId}!`, "ok");
          // keep the best pull of the session for the share card
          if (!best || r > best.rarity) {
            best = { rarity: r, heroId: revealed.heroId };
            shareLabel.textContent = `Share ${name}`;
            shareBtn.hidden = false;
          }
          await sleep(2600);
          if (dead()) return;
          heroEl.hidden = true;
          chest.classList.remove("open");
        } catch (err) {
          if (!mounted) return;
          setBusy(false);
          if (dead()) return;
          closeBtn.disabled = false;
          setInfo(`Open failed: ${shortError(err)}\nYou can try again.`, "err");
          ctx.status(`Open failed: ${(err as Error).message}`, "err");
          await sleep(3000);
        }
      }
    }

    // ---------- HOUSES (BLAST) ----------
    if (!MARKET_ENABLED) {
      housesEl.innerHTML = `<span class="shop-note">House sales open at the $BLAST launch.</span>`;
    } else {
      void refreshBalance();
      housePrices().then((prices) => {
        if (!mounted) return;
        renderHouseCards(prices);
      }).catch(() => {
        if (mounted) housesEl.innerHTML = `<span class="err">Could not load house prices.</span>`;
      });
    }

    async function refreshBalance() {
      const bal = await blastBalance().catch(() => 0n);
      if (!mounted) return;
      balanceEl.textContent = `Your balance: ${fmtBlast(bal)} BLAST`;
    }

    function renderHouseCards(prices: bigint[]) {
      const cards = prices.map((priceWei, rarity) => {
        if (priceWei === 0n) return "";
        const capacity = 2 + rarity * 2;
        const regen = 20 + rarity * 15;
        return `
          <div class="item-card rarity-${esc(rarity)}">
            <span class="sprite-house"></span>
            <div class="title rarity-name">${esc(RARITY_NAMES[rarity] ?? `Rarity ${rarity}`)}</div>
            <div class="sub"><span class="ok">+${esc(regen)}% regen</span> · ${esc(capacity)} hero slots</div>
            <div class="price"><span class="sprite-coin"></span>${esc(fmtBlast(priceWei))}</div>
            <button class="btn btn-blue btn-sm" type="button" data-house="${esc(rarity)}" data-lock>Buy</button>
          </div>`;
      }).join("");
      housesEl.innerHTML = cards || `<span class="muted">No houses for sale right now.</span>`;
      housesEl.querySelectorAll<HTMLButtonElement>("button[data-house]").forEach((btn) => {
        const rarity = Number(btn.dataset.house);
        btn.addEventListener("click", () => void onBuyHouse(rarity, prices[rarity]));
      });
      if (busy) setBusy(true);
    }

    async function onBuyHouse(rarity: number, priceWei: bigint) {
      if (busy || !requireWallet()) return;
      setBusy(true);
      try {
        ctx.status("Approve BLAST and confirm the purchase in your wallet...");
        await buyHouse(rarity, priceWei);
        if (!mounted) return;
        setBusy(false);
        ctx.status(`${RARITY_NAMES[rarity]} house bought! It appears on the mining screen (~1 min).`, "ok");
        void refreshBalance();
      } catch (err) {
        if (!mounted) return;
        setBusy(false);
        ctx.status(`House purchase failed: ${shortError(err)}`, "err");
      }
    }

    // ---------- LIVE TICKER ----------
    void (async () => {
      if (!GACHA_ENABLED) return;
      const tickerEl = $("shop-ticker");
      const line = $("shop-ticker-line");
      const data = await recentPulls(20).catch(() => [] as RecentPull[]);
      if (!mounted) return;
      // surface the rares preferentially, but keep everything so the strip lives
      const rares = data.filter((p) => p.rarity >= 2);
      const pulls = rares.length >= 3 ? rares : data;
      if (pulls.length === 0) return; // stays hidden
      let idx = 0;
      const render = () => {
        const p = pulls[idx % pulls.length];
        const name = TICKER_NAMES[p.rarity] ?? "hero";
        const icon = p.rarity >= 4 ? "icon-star" : p.rarity >= 2 ? "icon-gift" : "icon-pick";
        line.className = `line rarity-${esc(p.rarity)}`;
        line.innerHTML = `<span class="icon ${icon}"></span>${esc(shortAddr(p.buyer))} pulled a ${esc(name)} hero!`;
      };
      render();
      tickerEl.hidden = false;
      tickerTimer = window.setInterval(() => {
        if (!mounted) return;
        idx = (idx + 1) % pulls.length;
        render();
      }, 3200);
    })();

    return () => {
      mounted = false;
      if (tickerTimer !== undefined) window.clearInterval(tickerTimer);
      if (closeCeremony) closeCeremony();
    };
  },
};
