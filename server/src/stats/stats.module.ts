import { Module } from "@nestjs/common";
import { GameModule } from "../game/game.module";
import { StatsController } from "./stats.controller";

@Module({
  imports: [GameModule], // exports PersistenceService
  controllers: [StatsController],
})
export class StatsModule {}
