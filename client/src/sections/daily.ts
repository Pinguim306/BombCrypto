import type { SectionModule } from "./overlay";

/** DAILY — being rebuilt for the new mine; until then it opens in the classic client. */
export const section: SectionModule = {
  title: "DAILY",
  mount(ctx) {
    ctx.root.innerHTML = `<div class="section-empty">
      <p>DAILY is being rebuilt for the new mine. Meanwhile it opens in the classic client.</p>
      <a class="btn btn-blue" href="/classic.html?go=daily">Open DAILY</a>
    </div>`;
  },
};
