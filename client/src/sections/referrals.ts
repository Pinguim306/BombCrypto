import type { SectionModule } from "./overlay";

/** REFERRALS — being rebuilt for the new mine; until then it opens in the classic client. */
export const section: SectionModule = {
  title: "REFERRALS",
  mount(ctx) {
    ctx.root.innerHTML = `<div class="section-empty">
      <p>REFERRALS is being rebuilt for the new mine. Meanwhile it opens in the classic client.</p>
      <a class="btn btn-blue" href="/classic.html?go=referrals">Open REFERRALS</a>
    </div>`;
  },
};
