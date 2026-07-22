import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { GameModule } from "./game/game.module";
import { RewardsModule } from "./rewards/rewards.module";
import { AdminModule } from "./admin/admin.module";
import { ReferralsModule } from "./referrals/referrals.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [AuthModule, GameModule, RewardsModule, AdminModule, ReferralsModule],
  controllers: [HealthController],
})
export class AppModule {}
