import { Module } from "@nestjs/common";
import { GameModule } from "../game/game.module";
import { ReferralsController } from "./referrals.controller";

// GameModule exports PersistenceService (shared single SQLite handle).
@Module({
  imports: [GameModule],
  controllers: [ReferralsController],
})
export class ReferralsModule {}
