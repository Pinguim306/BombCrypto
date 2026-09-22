import type { SectionModule } from "./overlay";

/** SHOP — being rebuilt for the new mine; until then it opens in the classic client. */
export const section: SectionModule = {
  title: "SHOP",
  mount(ctx) {
    ctx.root.innerHTML = `<div class="section-empty">
      <p>SHOP is being rebuilt for the new mine. Meanwhile it opens in the classic client.</p>
      <a class="btn btn-blue" href="/classic.html?go=shop">Open SHOP</a>
    </div>`;
  },
};
