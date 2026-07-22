import { Controller, Get } from "@nestjs/common";
import { PersistenceService } from "../storage/persistence.service";

interface MinerRow {
  address: string;
  alias: string | null;
  heroes: number;
  power: number; // total power across owned heroes (investment proxy)
}

/** Public leaderboards (no auth). Miners come from stored game state; the
 *  referrer board is computed client-side from on-chain events. */
@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly store: PersistenceService) {}

  @Get("miners")
  topMiners(): { miners: MinerRow[] } {
    const rows: MinerRow[] = [];
    for (const { address, state } of this.store.allPlayerStates()) {
      let heroes: Array<{ power?: number }> = [];
      try {
        heroes = JSON.parse(state)?.mining?.heroes ?? [];
      } catch {
        continue;
      }
      if (!heroes.length) continue;
      const power = heroes.reduce((s, h) => s + (Number(h.power) || 0), 0);
      rows.push({ address, alias: this.store.aliasForAddress(address), heroes: heroes.length, power });
    }
    rows.sort((a, b) => b.power - a.power || b.heroes - a.heroes);
    return { miners: rows.slice(0, 15) };
  }
}
