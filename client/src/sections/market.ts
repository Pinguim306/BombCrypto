import type { SectionModule } from "./overlay";

/** MARKET — being rebuilt for the new mine; until then it opens in the classic client. */
export const section: SectionModule = {
  title: "MARKET",
  mount(ctx) {
    ctx.root.innerHTML = `<div class="section-empty">
      <p>MARKET is being rebuilt for the new mine. Meanwhile it opens in the classic client.</p>
      <a class="btn btn-blue" href="/classic.html?go=market">Open MARKET</a>
    </div>`;
  },
};
