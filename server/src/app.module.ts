import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { GameModule } from "./game/game.module";
import { RewardsModule } from "./rewards/rewards.module";
import { AdminModule } from "./admin/admin.module";

@Module({
  imports: [AuthModule, GameModule, RewardsModule, AdminModule],
})
export class AppModule {}
