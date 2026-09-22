/**
 * RANK section — the public leaderboards, ported from LeaderboardScene.
 * Two boards: top miners (total hero power, from the server) and top
 * referrers (ETH earned, read from the gacha contract). Public: no login.
 */
import { formatEther } from "viem";
import type { SectionModule, SectionContext } from "./overlay";
import { api, type MinerRow } from "../net/api";
import { topReferrers, type ReferrerRow } from "../web3/gacha";
import { GACHA_ENABLED } from "../config";

type Board = "miners" | "referrers";

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function ensureStyle(): void {
  if (document.head.querySelector('style[data-section="rank"]')) return;
  const style = document.createElement("style");
  style.dataset.section = "rank";
  style.textContent = `
    .rank-tabs { justify-content: center; margin-bottom: 18px; }
    .rank-table { margin: 6px 0 0; }
    .rank-table th:first-child, .rank-table td.pos { width: 64px; text-align: center; }
    .rank-table td.pos { font-family: var(--font-pixel); font-size: 11px; color: var(--muted); }
    .rank-table td.pos.top { color: var(--gold); }
    .rank-table td.pos.top::before { content: ""; display: inline-block; width: 16px; height: 16px; margin-right: 6px; vertical-align: -2px; background: url(/art/ui/icon_star.png) 0 0 / 16px 16px no-repeat; image-rendering: pixelated; }
    .rank-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .rank-table td.val { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
    .rank-table td.val.power { color: var(--cyan); }
    .rank-table td.val.eth { color: #81c784; }
    .rank-table td.who .alias { color: var(--text); font-weight: 700; }
    .rank-table td.who .addr { color: var(--muted-lt); font-family: "Courier New", monospace; font-size: 15px; }
    .rank-table tr.me td { background: rgba(255,202,40,.14); box-shadow: inset 4px 0 0 var(--gold); }
    .rank-table tr.me td.who::after { content: "you"; margin-left: 10px; padding: 1px 8px; font-size: 12px; color: #2e1a00; background: var(--gold); border-radius: 4px; vertical-align: 1px; }
    .rank-note { text-align: center; color: var(--muted); margin: 8px 0 0; font-size: 15px; }
    @media (max-width: 640px) { .rank-table th, .rank-table td { padding: 6px 8px; font-size: 15px; } }
  `;
  document.head.append(style);
}

function minersTable(ctx: SectionContext, rows: MinerRow[], me: string | null): string {
  return `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Miner</th><th>Heroes</th><th>Power</th></tr></thead>
      <tbody>
        ${rows.map((m, i) => {
          const mine = me !== null && m.address.toLowerCase() === me;
          return `
          <tr class="${mine ? "me" : ""}">
            <td class="pos${i < 3 ? " top" : ""}">${i + 1}</td>
            <td class="who">${m.alias ? `<span class="alias">${ctx.esc(m.alias)}</span>` : `<span class="addr" title="${ctx.esc(m.address)}">${ctx.esc(short(m.address))}</span>`}</td>
            <td class="num">${ctx.esc(m.heroes)}</td>
            <td class="val power">${ctx.esc(m.power.toLocaleString("en-US"))}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <p class="rank-note">Ranked by the total power of every hero a miner owns.</p>`;
}

function referrersTable(ctx: SectionContext, rows: ReferrerRow[], me: string | null): string {
  return `
    <table class="rank-table">
      <thead><tr><th>#</th><th>Referrer</th><th>Invites</th><th>ETH earned</th></tr></thead>
      <tbody>
        ${rows.map((r, i) => {
          const mine = me !== null && r.address.toLowerCase() === me;
          return `
          <tr class="${mine ? "me" : ""}">
            <td class="pos${i < 3 ? " top" : ""}">${i + 1}</td>
            <td class="who"><span class="addr" title="${ctx.esc(r.address)}">${ctx.esc(short(r.address))}</span></td>
            <td class="num">${ctx.esc(r.invites)}</td>
            <td class="val eth">${ctx.esc(Number(formatEther(r.earnedWei)).toFixed(4))}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <p class="rank-note">Ranked by referral ETH earned on-chain; ties by invites.</p>`;
}

export const section: SectionModule = {
  title: "RANK",
  needsLogin: false,
  mount(ctx) {
    ensureStyle();
    let mounted = true;
    let board: Board = "miners";
    let gen = 0;
    const cache: { miners?: MinerRow[]; referrers?: ReferrerRow[] } = {};
    const root = ctx.root;

    root.innerHTML = `
      <div class="section-toolbar rank-tabs">
        <button class="btn btn-sm btn-green" type="button" data-board="miners"><span class="icon icon-pick"></span>Top Miners</button>
        <button class="btn btn-sm btn-gray" type="button" data-board="referrers"><span class="icon icon-gift"></span>Top Referrers</button>
      </div>
      <div id="rank-board"></div>`;
    const boardEl = root.querySelector<HTMLElement>("#rank-board")!;
    const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-board]"));

    const me = (): string | null => ctx.address()?.toLowerCase() ?? null;

    const paintTabs = (): void => {
      tabs.forEach((t) => {
        const active = t.dataset.board === board;
        t.classList.toggle("btn-green", active);
        t.classList.toggle("btn-gray", !active);
      });
    };

    const show = (b: Board): void => {
      if (!mounted) return;
      if (b === "miners") {
        const rows = cache.miners!;
        boardEl.innerHTML = rows.length
          ? minersTable(ctx, rows, me())
          : `<div class="section-empty">No miners on the board yet.</div>`;
      } else {
        const rows = cache.referrers!;
        boardEl.innerHTML = rows.length
          ? referrersTable(ctx, rows, me())
          : `<div class="section-empty">No referrers on the board yet.</div>`;
      }
    };

    const load = async (): Promise<void> => {
      const g = ++gen;
      paintTabs();
      ctx.status("");
      if (board === "referrers" && !GACHA_ENABLED) {
        boardEl.innerHTML = `<div class="section-empty">Referrer stats go live with the $BLAST launch.</div>`;
        return;
      }
      if (cache[board]) {
        show(board);
        return;
      }
      boardEl.innerHTML = `<div class="section-empty">Loading…</div>`;
      try {
        if (board === "miners") {
          const { miners } = await api.topMiners();
          if (!mounted || g !== gen) return;
          cache.miners = miners;
        } else {
          const refs = await topReferrers(15);
          if (!mounted || g !== gen) return;
          cache.referrers = refs;
        }
        show(board);
      } catch (err) {
        if (!mounted || g !== gen) return;
        const msg = (err as Error).message;
        if (msg === "session expired") {
          ctx.requestLogin();
          return;
        }
        boardEl.innerHTML = `
          <div class="section-empty err">
            <p>Could not load the board.</p>
            <button class="btn btn-sm btn-gray" type="button" data-retry>Retry</button>
          </div>`;
        ctx.status(`error: ${msg}`, "err");
      }
    };

    const onClick = (e: Event): void => {
      const target = e.target as HTMLElement;
      const tab = target.closest<HTMLElement>("button[data-board]");
      if (tab) {
        const b = tab.dataset.board as Board;
        if (b !== board) {
          board = b;
          void load();
        }
        return;
      }
      if (target.closest("[data-retry]")) void load();
    };
    root.addEventListener("click", onClick);

    void load();

    return () => {
      mounted = false;
      root.removeEventListener("click", onClick);
    };
  },
};
