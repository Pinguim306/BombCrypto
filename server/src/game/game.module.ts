import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GameController } from "./game.controller";
import { GameService } from "./game.service";
import { ChainService } from "./chain.service";
import { PersistenceService } from "../storage/persistence.service";

@Module({
  imports: [AuthModule],
  controllers: [GameController],
  providers: [GameService, ChainService, PersistenceService],
  exports: [GameService, PersistenceService],
})
export class GameModule {}
