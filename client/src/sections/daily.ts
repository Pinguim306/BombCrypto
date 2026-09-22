/**
 * DAILY REWARD section — ported from DailyScene. A 7-day streak strip that
 * grows the reward on consecutive days (missing a day resets it), with the
 * claim button and the post-claim state. Rewards credit pending BLAST.
 */
import type { SectionModule, SectionContext } from "./overlay";
import { api, type DailyStatusDto } from "../net/api";

const blast = (n: number) => n.toLocaleString("en-US");

function ensureStyle(): void {
  if (document.head.querySelector('style[data-section="daily"]')) return;
  const style = document.createElement("style");
  style.dataset.section = "daily";
  style.textContent = `
    .daily-intro { text-align: center; margin: 0 0 6px; color: var(--muted-lt); }
    .daily-streak { text-align: center; margin: 0 0 18px; min-height: 28px; font-size: 12px; color: #ff8a65; }
    .daily-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
    .daily-cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 4px 10px; background: #161d2e; border: 2px solid var(--border); border-radius: 8px; text-align: center; }
    .daily-cell.claimed { background: #1b3a24; border-color: #2e7d32; }
    .daily-cell.next { background: #3a2c10; border-color: var(--orange); border-width: 3px; padding: 11px 3px 9px; box-shadow: 0 0 14px rgba(232,149,47,.35); }
    .daily-cell.day7 { outline: 2px solid var(--gold); outline-offset: -6px; }
    .daily-cell.locked .sprite-coin { filter: saturate(.3) brightness(.6); animation: none; }
    .daily-cell .day { font-family: var(--font-pixel); font-size: 9px; color: var(--muted); }
    .daily-cell.day7 .day { color: var(--gold); }
    .daily-cell .amt { font-family: var(--font-pixel); font-size: 11px; color: var(--gold); margin-top: 4px; }
    .daily-cell .unit { font-size: 12px; color: #b0895a; letter-spacing: .5px; }
    .daily-cell .note { font-size: 12px; color: #81c784; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
    .daily-cell .badge { margin-top: auto; padding-top: 6px; font-size: 13px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; min-height: 24px; }
    .daily-cell.claimed .badge { color: #66bb6a; }
    .daily-cell.next .badge { color: var(--orange-lt); font-weight: 700; animation: daily-blink 1.2s ease-in-out infinite; }
    @keyframes daily-blink { 50% { opacity: .4; } }
    .daily-claim { display: flex; justify-content: center; margin: 26px 0 10px; }
    .daily-msg { text-align: center; min-height: 26px; margin: 0; color: var(--muted-lt); }
    .daily-msg.ok { color: #81c784; } .daily-msg.err { color: var(--err); } .daily-msg.gold { color: var(--gold); font-weight: 700; }
    .daily-rain { position: fixed; inset: 0; z-index: 70; pointer-events: none; overflow: hidden; }
    .daily-rain .sprite-coin { position: absolute; top: -40px; animation: coin-spin .9s steps(6) infinite, daily-fall var(--dur, 1.6s) cubic-bezier(.4,0,1,1) var(--delay, 0s) forwards; }
    @keyframes daily-fall { to { transform: translateY(110vh) rotate(var(--rot, 180deg)); } }
    @media (max-width: 720px) { .daily-strip { grid-template-columns: repeat(4, 1fr); } }
    @media (prefers-reduced-motion: reduce) { .daily-cell.next .badge { animation: none; } }
  `;
  document.head.append(style);
}

function cellMarkup(ctx: SectionContext, s: DailyStatusDto, i: number, filled: number, nextClaimable: number): string {
  const day = i + 1;
  const n = s.rewards.length;
  const claimed = day <= filled;
  const isNext = day === nextClaimable;
  const isDay7 = day === n;
  const state = claimed ? "claimed" : isNext ? "next" : "locked";
  const badge = claimed
    ? `<span class="badge">&#10003; claimed</span>`
    : isNext
      ? `<span class="badge">&#9660; today</span>`
      : `<span class="badge"><span class="icon icon-lock icon-sm"></span></span>`;
  return `
    <div class="daily-cell ${state}${isDay7 ? " day7" : ""}">
      <span class="day">${isDay7 ? "DAY 7" : `Day ${ctx.esc(day)}`}</span>
      <span class="sprite-coin"></span>
      <span class="amt">${ctx.esc(blast(s.rewards[i]))}</span>
      <span class="unit">BLAST</span>
      ${isDay7 ? `<span class="note"><span class="icon icon-gift icon-sm"></span>${ctx.esc(s.jackpotChance)}% jackpot</span>` : ""}
      ${badge}
    </div>`;
}

export const section: SectionModule = {
  title: "DAILY REWARD",
  needsLogin: true,
  mount(ctx) {
    ensureStyle();
    let mounted = true;
    let status: DailyStatusDto | null = null;
    let rain: HTMLElement | null = null;
    let rainTimer: ReturnType<typeof setTimeout> | null = null;
    const root = ctx.root;

    root.innerHTML = `
      <p class="daily-intro">Come back every day — the longer your streak, the bigger the reward.</p>
      <p class="daily-streak pixel" id="daily-streak"></p>
      <div class="daily-strip" id="daily-strip"><div class="section-empty" style="grid-column: 1 / -1">Loading…</div></div>
      <div class="daily-claim">
        <button class="btn btn-lg btn-green" type="button" id="daily-claim" disabled><span class="icon icon-gift"></span><span id="daily-claim-label">Claim daily reward</span></button>
      </div>
      <p class="daily-msg" id="daily-msg"></p>`;

    const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    const streakEl = $<HTMLElement>("daily-streak");
    const stripEl = $<HTMLElement>("daily-strip");
    const claimBtn = $<HTMLButtonElement>("daily-claim");
    const claimLabel = $<HTMLElement>("daily-claim-label");
    const msgEl = $<HTMLElement>("daily-msg");

    const setMsg = (text: string, kind: "" | "ok" | "err" | "gold" = ""): void => {
      msgEl.textContent = text;
      msgEl.className = `daily-msg${kind ? ` ${kind}` : ""}`;
    };

    const fail = (err: unknown): void => {
      const msg = (err as Error).message;
      if (msg === "session expired") {
        ctx.requestLogin();
        return;
      }
      setMsg(msg, "err");
      ctx.status(`error: ${msg}`, "err");
    };

    const render = (): void => {
      if (!mounted || !status) return;
      const s = status;
      // days already collected in the current cycle, and the next claimable day
      const filled = s.claimedToday ? s.nextDay : s.nextDay - 1;
      const nextClaimable = s.claimedToday || !s.canClaim ? 0 : s.nextDay;

      streakEl.textContent = s.streak > 0 ? `${s.streak}-day streak` : "Start your streak today!";
      stripEl.innerHTML = s.rewards.map((_, i) => cellMarkup(ctx, s, i, filled, nextClaimable)).join("");

      if (!s.hasHero) {
        claimBtn.disabled = true;
        claimLabel.textContent = "Get a hero to claim";
        setMsg("You need at least one hero — buy a chest in the Shop to join the streak.");
      } else if (s.claimedToday) {
        claimBtn.disabled = true;
        claimLabel.textContent = "Come back tomorrow";
        setMsg(`Day ${s.nextDay} claimed! Return tomorrow to keep your streak going.`, "ok");
      } else {
        claimBtn.disabled = !s.canClaim;
        const reward = s.rewards[s.nextDay - 1];
        claimLabel.textContent = `Claim Day ${s.nextDay} · ${blast(reward ?? 0)} BLAST`;
      }
    };

    const refresh = async (): Promise<void> => {
      try {
        const s = await api.dailyStatus();
        if (!mounted) return;
        status = s;
        render();
      } catch (err) {
        if (!mounted) return;
        stripEl.innerHTML = `<div class="section-empty err" style="grid-column: 1 / -1">Could not load your streak.</div>`;
        fail(err);
      }
    };

    /** Brief coin shower for a day-7 jackpot. */
    const celebrate = (): void => {
      if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      rain?.remove();
      rain = document.createElement("div");
      rain.className = "daily-rain";
      rain.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 24; i++) {
        const coin = document.createElement("span");
        coin.className = "sprite-coin";
        coin.style.left = `${5 + Math.random() * 90}%`;
        coin.style.setProperty("--dur", `${1.2 + Math.random()}s`);
        coin.style.setProperty("--delay", `${i * 40}ms`);
        coin.style.setProperty("--rot", `${Math.round(Math.random() * 360 - 180)}deg`);
        rain.append(coin);
      }
      document.body.append(rain);
      if (rainTimer) clearTimeout(rainTimer);
      rainTimer = setTimeout(() => { rain?.remove(); rain = null; }, 3400);
    };

    const claim = async (): Promise<void> => {
      claimBtn.disabled = true;
      setMsg("Claiming...");
      ctx.status("");
      try {
        const { claim } = await api.claimDaily();
        if (!mounted) return;
        if (claim.jackpot) {
          setMsg(`JACKPOT! ${blast(claim.totalBlast)} BLAST (incl. +${blast(claim.jackpotBlast)} bonus)!`, "gold");
          ctx.status(`Jackpot: ${blast(claim.totalBlast)} BLAST added to your pending balance.`, "ok");
          celebrate();
        } else {
          setMsg(`Claimed ${blast(claim.totalBlast)} BLAST! Added to your pending balance.`, "ok");
          ctx.status(`Claimed ${blast(claim.totalBlast)} BLAST.`, "ok");
        }
        const s = await api.dailyStatus();
        if (!mounted) return;
        status = s;
        render(); // strip + "Come back tomorrow"; the claim result stays on the status line
        if (claim.jackpot) {
          setMsg(`JACKPOT! ${blast(claim.totalBlast)} BLAST (incl. +${blast(claim.jackpotBlast)} bonus)!`, "gold");
        }
      } catch (err) {
        if (!mounted) return;
        claimBtn.disabled = false;
        fail(err);
      }
    };

    claimBtn.addEventListener("click", () => void claim());
    void refresh();

    return () => {
      mounted = false;
      if (rainTimer) clearTimeout(rainTimer);
      rain?.remove();
      rain = null;
    };
  },
};
