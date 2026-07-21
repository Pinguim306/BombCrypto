import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { GameService } from "../game/game.service";
import { PersistenceService } from "../storage/persistence.service";

/**
 * Internal economic metrics (Phase 3). Protected by a static ADMIN_KEY;
 * Phase 5 replaces it with real operator auth.
 */
@Controller("admin")
export class AdminController {
  constructor(
    private readonly game: GameService,
    private readonly persistence: PersistenceService
  ) {}

  @Get("metrics")
  metrics(@Headers("x-admin-key") key?: string) {
    const expected = process.env.ADMIN_KEY;
    if (!expected || key !== expected) throw new UnauthorizedException();

    const vouchers = this.persistence.voucherStats();
    return {
      players: this.persistence.playerCount(),
      pendingMicroBlastInMemory: this.game.totalPendingMicro(),
      vouchersIssued: vouchers.issued,
      vouchersClaimed: vouchers.claimed,
      totalIssuedWei: vouchers.issuedWei,
      generatedAt: new Date().toISOString(),
    };
  }
}
