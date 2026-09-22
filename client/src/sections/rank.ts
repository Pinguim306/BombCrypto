import type { SectionModule } from "./overlay";

/** RANK — being rebuilt for the new mine; until then it opens in the classic client. */
export const section: SectionModule = {
  title: "RANK",
  mount(ctx) {
    ctx.root.innerHTML = `<div class="section-empty">
      <p>RANK is being rebuilt for the new mine. Meanwhile it opens in the classic client.</p>
      <a class="btn btn-blue" href="/classic.html?go=leaderboard">Open RANK</a>
    </div>`;
  },
};
