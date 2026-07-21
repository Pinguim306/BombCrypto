import { Module } from "@nestjs/common";
import { GameModule } from "../game/game.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [GameModule],
  controllers: [AdminController],
})
export class AdminModule {}
