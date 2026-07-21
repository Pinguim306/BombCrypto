import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GameModule } from "../game/game.module";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";

@Module({
  imports: [AuthModule, GameModule],
  controllers: [RewardsController],
  providers: [RewardsService],
})
export class RewardsModule {}
