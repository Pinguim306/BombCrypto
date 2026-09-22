/**
 * Page routing between the two clients.
 *
 *   /              the Godot mine (src/game.ts) — the main game
 *   /classic.html  the Phaser client (src/classic.ts): shop, market, heroes,
 *                  rank, referrals, daily, and the original mining scene
 *
 * The Godot page hosts only the mine, so its header sends every other
 * section to the classic page with `?go=<scene>`; the classic page's PLAY
 * button and its "Back" buttons return to the Godot mine when the visit
 * started from there.
 */
export const CLASSIC_PAGE = "/classic.html";
export const GAME_SCENES = ["mining", "shop", "market", "heroes", "leaderboard", "referrals", "daily"] as const;
export type GameScene = (typeof GAME_SCENES)[number];

/** `?go=<scene>` on the classic page, or null when absent / unknown. */
export function requestedScene(): GameScene | null {
  const go = new URLSearchParams(location.search).get("go");
  return go && (GAME_SCENES as readonly string[]).includes(go) ? (go as GameScene) : null;
}

/** URL of a classic-page section. */
export function classicUrl(scene: string): string {
  return `${CLASSIC_PAGE}?go=${encodeURIComponent(scene)}`;
}

/** Leaves the classic page for the Godot mine. */
export function goToMine(): void {
  location.href = "/";
}

/**
 * "Back" from a classic section: to the Godot mine when the visit came from
 * it (`?go=` set), otherwise to the classic mining scene (someone who opened
 * /classic.html on purpose stays in the classic client).
 */
export function backToMine(scene: Phaser.Scene): void {
  if (requestedScene()) goToMine();
  else scene.scene.start("mining");
}
