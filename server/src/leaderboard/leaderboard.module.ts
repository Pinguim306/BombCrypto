import { Module } from "@nestjs/common";
import { GameModule } from "../game/game.module";
import { LeaderboardController } from "./leaderboard.controller";

@Module({
  imports: [GameModule], // exports PersistenceService
  controllers: [LeaderboardController],
})
export class LeaderboardModule {}
