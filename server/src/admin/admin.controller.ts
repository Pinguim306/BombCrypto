import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { GameService } from "../game/game.service";
import { PersistenceService } from "../storage/persistence.service";

/**
 * Métricas econômicas internas (Fase 3). Protegido por chave estática
 * ADMIN_KEY; a Fase 5 troca por auth de operador de verdade.
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
