/**
 * HEROES section — the full roster as cards over the running mine. Ported
 * from the classic HeroesScene (roster + work/rest) plus the hero popup of
 * MiningScene (shelter / leave house, adventure with a stage pick, houses).
 * Talks to the server through src/net/api.ts only.
 */
import type { SectionModule, SectionContext, StatusKind } from "./overlay";
import { api, type GameStateDto, type HeroDto, type HouseDto, type StageDto } from "../net/api";

const RARITY_NAMES = ["Common", "Rare", "S.Rare", "Epic", "Legend", "Mythic"];
const PER_PAGE = 12;
const MAX_ADVENTURES = 10; // per day, as the mine HUD shows it

/** Estimated mining rate of one working hero, BLAST per hour. */
const rate = (h: HeroDto) => 67.5 * h.power * (1 + h.speed / 100);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const rarityName = (r: number) => RARITY_NAMES[r] ?? `Rarity ${r}`;

function ensureStyle(): void {
  if (document.head.querySelector('style[data-section="heroes"]')) return;
  const style = document.createElement("style");
  style.dataset.section = "heroes";
  style.textContent = `
    .heroes-summary { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 0 0 12px; }
    .heroes-summary .tag b { color: var(--text); }
    .heroes-summary .tag.gold b { color: var(--gold); }
    .heroes-stages { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin: 4px 0 16px; padding: 10px 12px; background: rgba(0,0,0,.22); border: 2px solid var(--outline); }
    .heroes-stages .stage { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 12px; cursor: pointer; color: var(--muted-lt); background: #1c2333; border: 2px solid var(--border); font: inherit; font-size: 14px; line-height: 1.3; }
    .heroes-stages .stage:hover { border-color: var(--orange); }
    .heroes-stages .stage.selected { color: var(--orange-lt); border-color: var(--orange); background: #2a2210; }
    .heroes-stages .stage .name { font-family: var(--font-pixel); font-size: 9px; }
    .hero-card { position: relative; gap: 6px; }
    .hero-card .portrait-frame { line-height: 0; }
    .hero-card.working .portrait { filter: none; }
    .hero-card.resting .portrait { filter: saturate(.55) brightness(.85); }
    .hero-card .title { margin-top: 2px; font-size: 16px; }
    .hero-card .stat-row { width: 100%; text-align: left; font-size: 15px; gap: 2px 10px; padding: 0 4px; }
    .hero-card .stat-row dd { text-align: right; color: var(--text); }
    .hero-card .bar { width: 100%; margin-top: 2px; }
    .hero-card .hero-tags { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; min-height: 26px; }
    .hero-card .tag.work { color: var(--ok); border-color: #2e7d32; }
    .hero-card .tag.rest { color: var(--muted); }
    .hero-card .tag.house { color: var(--cyan); }
    .hero-card .hero-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; margin-top: 10px; }
    .hero-card .hero-actions .btn { min-width: 96px; }
    .heroes-pager { display: flex; justify-content: center; align-items: center; gap: 22px; margin: 22px 0 8px; }
    .heroes-pager .page { font-family: var(--font-pixel); font-size: 11px; color: var(--text); }
    .heroes-houses { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px 20px; margin-top: 6px; }
    .house-row { display: flex; align-items: center; gap: 12px; padding: 6px 10px; background: rgba(0,0,0,.22); border: 2px solid var(--outline); }
    .house-row .sprite-house { flex: 0 0 auto; transform: scale(.66); transform-origin: left center; margin-right: -30px; }
    .house-row .sub { color: var(--muted-lt); font-size: 15px; }
    .house-row .bar { width: 120px; margin-top: 4px; }
    @media (max-width: 640px) { .heroes-stages .stage { flex: 1 1 100%; } }
  `;
  document.head.append(style);
}

function stageMarkup(ctx: SectionContext, s: StageDto, selected: boolean): string {
  return `
    <button class="stage${selected ? " selected" : ""}" type="button" data-action="stage" data-stage="${ctx.esc(s.id)}">
      <span class="name">${selected ? "&#9654; " : ""}${ctx.esc(s.name)}</span>
      <span>${ctx.esc(s.rewardBlast)} BLAST &middot; ${ctx.esc(s.staminaCost)} stam${s.minRarity > 0 ? ` &middot; ${ctx.esc(rarityName(s.minRarity))}+` : ""}</span>
    </button>`;
}

function heroCard(ctx: SectionContext, h: HeroDto, houses: HouseDto[], hasStage: boolean): string {
  const working = h.mode === "work";
  const pct = h.staminaMax > 0 ? Math.max(0, Math.min(100, (h.stamina / h.staminaMax) * 100)) : 0;
  const idLabel = h.id.startsWith("chain-") ? `NFT #${h.id.slice(6)}` : "dev hero";
  const house = h.houseId ? houses.find((x) => x.id === h.houseId) : undefined;
  const id = ctx.esc(h.id);
  return `
    <div class="item-card hero-card rarity-${ctx.esc(h.rarity)} ${working ? "working" : "resting"}">
      <span class="portrait-frame"><span class="portrait portrait-${ctx.esc(h.rarity)}"></span></span>
      <div class="title rarity-name">${ctx.esc(rarityName(h.rarity))}</div>
      <div class="sub">${ctx.esc(idLabel)}</div>
      <dl class="stat-row">
        <dt>Power</dt><dd>${ctx.esc(h.power)}</dd>
        <dt>Speed</dt><dd>${ctx.esc(h.speed)}</dd>
        <dt>Stamina</dt><dd>${ctx.esc(h.stamina)} / ${ctx.esc(h.staminaMax)}</dd>
        <dt>Mines</dt><dd>~${ctx.esc(fmt(rate(h)))} BLAST/h</dd>
      </dl>
      <div class="bar" style="--w:${ctx.esc(pct.toFixed(0))}%; --bar:#4fc3f7"><i></i></div>
      <div class="hero-tags">
        <span class="tag ${working ? "work" : "rest"}">${working ? "mining" : "resting"}</span>
        ${h.houseId ? `<span class="tag house">sheltered${house ? ` &middot; ${ctx.esc(rarityName(house.rarity))} house` : ""}</span>` : ""}
      </div>
      <div class="hero-actions">
        <button class="btn btn-sm ${working ? "btn-gray" : "btn-green"}" type="button" data-action="mode" data-hero="${id}">
          ${working ? `<span class="icon icon-sleep"></span>Rest` : `<span class="icon icon-bolt"></span>Work`}
        </button>
        <button class="btn btn-sm btn-teal" type="button" data-action="house" data-hero="${id}">
          <span class="icon icon-house"></span>${h.houseId ? "Leave" : "Shelter"}
        </button>
        <button class="btn btn-sm btn-blue" type="button" data-action="adventure" data-hero="${id}"${hasStage ? "" : " disabled"}>
          <span class="icon icon-adventure"></span>Adventure
        </button>
      </div>
    </div>`;
}

function houseRow(ctx: SectionContext, h: HouseDto): string {
  const pct = h.capacity > 0 ? Math.min(100, (h.occupants / h.capacity) * 100) : 0;
  return `
    <div class="house-row rarity-${ctx.esc(h.rarity)}">
      <span class="sprite-house"></span>
      <div>
        <div><b class="rarity-name">${ctx.esc(rarityName(h.rarity))} house</b></div>
        <div class="sub">${ctx.esc(h.occupants)} / ${ctx.esc(h.capacity)} heroes &middot; +${ctx.esc(h.regenBoostBps / 100)}% stamina regen</div>
        <div class="bar" style="--w:${ctx.esc(pct.toFixed(0))}%; --bar:#26a69a"><i></i></div>
      </div>
    </div>`;
}

export const section: SectionModule = {
  title: "HEROES",
  needsLogin: true,
  mount(ctx) {
    ensureStyle();
    let mounted = true;
    let busy = false;
    let state: GameStateDto | null = null;
    let page = 0;
    let stageId: number | null = null;
    const root = ctx.root;

    root.innerHTML = `<div class="section-empty">Loading heroes…</div>`;

    const fail = (err: unknown, prefix = "error"): void => {
      const msg = (err as Error).message;
      if (msg === "session expired") {
        ctx.requestLogin();
        return;
      }
      ctx.status(`${prefix}: ${msg}`, "err");
    };

    const render = (): void => {
      if (!mounted || !state) return;
      const heroes = state.heroes;
      if (heroes.length === 0) {
        root.innerHTML = `
          <div class="section-empty">
            <span class="hero hero-0"></span>
            <p>No heroes yet — buy a chest in the Shop!</p>
          </div>`;
        return;
      }
      const stages = state.adventure.stages;
      if (stageId === null || !stages.some((s) => s.id === stageId)) stageId = stages[0]?.id ?? null;
      const working = heroes.filter((h) => h.mode === "work");
      const perHour = working.reduce((sum, h) => sum + rate(h), 0);
      const pages = Math.max(1, Math.ceil(heroes.length / PER_PAGE));
      if (page >= pages) page = pages - 1;
      const visible = heroes.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

      root.innerHTML = `
        <div class="heroes-summary">
          <span class="tag">team <b>${ctx.esc(heroes.length)}</b> hero${heroes.length === 1 ? "" : "es"}</span>
          <span class="tag">working <b>${ctx.esc(working.length)}</b></span>
          <span class="tag gold"><span class="icon icon-coin icon-sm"></span> ~<b>${ctx.esc(fmt(perHour))}</b> BLAST/h</span>
          <span class="muted">adventures today: ${ctx.esc(state.adventure.attemptsToday)}/${MAX_ADVENTURES}</span>
        </div>
        ${stages.length ? `
        <div class="heroes-stages">
          <span class="muted"><span class="icon icon-adventure icon-sm"></span> Adventure stage:</span>
          ${stages.map((s) => stageMarkup(ctx, s, s.id === stageId)).join("")}
        </div>` : ""}
        <div class="grid-cards">
          ${visible.map((h) => heroCard(ctx, h, state!.houses, stageId !== null)).join("")}
        </div>
        ${pages > 1 ? `
        <div class="heroes-pager">
          <button class="btn btn-sm btn-gray" type="button" data-action="prev" aria-label="Previous page"${page > 0 ? "" : " disabled"}><span class="icon icon-arrow-l"></span></button>
          <span class="page">${ctx.esc(page + 1)} / ${ctx.esc(pages)}</span>
          <button class="btn btn-sm btn-gray" type="button" data-action="next" aria-label="Next page"${page < pages - 1 ? "" : " disabled"}><span class="icon icon-arrow-r"></span></button>
        </div>` : ""}
        <h3><span class="icon icon-house icon-sm"></span> HOUSES</h3>
        ${state.houses.length
          ? `<div class="heroes-houses">${state.houses.map((h) => houseRow(ctx, h)).join("")}</div>`
          : `<p class="muted">No houses yet. Buy one in the Shop, then Shelter a hero — sheltered heroes regain stamina faster.</p>`}
      `;
      if (busy) setBusy(true); // a page/stage change mid-action keeps the actions locked
    };

    const setBusy = (b: boolean): void => {
      busy = b;
      root.querySelectorAll<HTMLButtonElement>("button[data-hero]").forEach((el) => (el.disabled = b));
    };

    /** Runs one server action; on success the fresh state replaces ours and
     *  the optional message becomes the status line. */
    const act = async (label: string, run: () => Promise<{ state: GameStateDto; msg?: string; kind?: StatusKind }>): Promise<void> => {
      if (busy) return;
      setBusy(true);
      ctx.status(label);
      try {
        const r = await run();
        if (!mounted) return;
        state = r.state;
        busy = false;
        render();
        ctx.status(r.msg ?? "", r.kind ?? "neutral");
      } catch (err) {
        if (!mounted) return;
        setBusy(false);
        fail(err);
      }
    };

    const onClick = (e: Event): void => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!btn || !state || btn.hasAttribute("disabled")) return;
      const action = btn.dataset.action;
      if (action === "prev") { page = Math.max(0, page - 1); render(); return; }
      if (action === "next") { page += 1; render(); return; }
      if (action === "stage") { stageId = Number(btn.dataset.stage); render(); return; }
      const hero = state.heroes.find((h) => h.id === btn.dataset.hero);
      if (!hero) return;
      if (action === "mode") {
        const working = hero.mode === "work";
        void act(working ? "Sending hero to rest..." : "Sending hero to work...", async () => ({
          state: await api.setMode(hero.id, working ? "rest" : "work"),
        }));
      } else if (action === "house") {
        if (hero.houseId) {
          void act("Leaving the house...", async () => ({ state: await api.setHouse(hero.id, null) }));
        } else {
          const free = state.houses.find((x) => x.occupants < x.capacity);
          if (!free) {
            ctx.status(state.houses.length ? "no house with a free slot" : "no houses yet — buy one in the Shop", "err");
            return;
          }
          void act("Sheltering hero...", async () => ({ state: await api.setHouse(hero.id, free.id) }));
        }
      } else if (action === "adventure") {
        if (stageId === null) return;
        const sid = stageId;
        void act("Expedition in progress...", async () => {
          const r = await api.adventure(hero.id, sid);
          return {
            state: r.state,
            kind: r.success ? "ok" : "err",
            msg: r.success
              ? `Victory in ${r.stage}! +${(r.rewardMicro / 1_000_000).toFixed(2)} BLAST (chance ${r.successChance}%) — ${r.attemptsLeft} attempts left today`
              : `Defeat in ${r.stage} (chance was ${r.successChance}%) — half the stamina refunded`,
          };
        });
      }
    };
    root.addEventListener("click", onClick);

    void (async () => {
      try {
        const s = await api.state();
        if (!mounted) return;
        state = s;
        render();
        ctx.status("");
      } catch (err) {
        if (!mounted) return;
        root.innerHTML = `<div class="section-empty err">Could not load your heroes.</div>`;
        fail(err);
      }
    })();

    return () => {
      mounted = false;
      root.removeEventListener("click", onClick);
    };
  },
};
