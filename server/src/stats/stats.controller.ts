import { Controller, Get } from "@nestjs/common";
import { PersistenceService } from "../storage/persistence.service";

/** Public, unauthenticated game stats for the transparency dashboard. The
 *  trust-anchor figures (vault balance, total paid out) are read on-chain by
 *  the client; this endpoint serves the off-chain aggregates only. */
@Controller("stats")
export class StatsController {
  constructor(private readonly store: PersistenceService) {}

  @Get()
  stats() {
    const v = this.store.voucherStats();
    return {
      players: this.store.playerCount(),
      vouchersIssued: v.issued,
      vouchersClaimed: v.claimed,
    };
  }
}
