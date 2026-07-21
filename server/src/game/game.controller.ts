import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, AuthedRequest } from "../auth/jwt.guard";
import { GameService } from "./game.service";

@Controller("game")
@UseGuards(JwtAuthGuard)
export class GameController {
  constructor(private readonly game: GameService) {}

  @Get("state")
  state(@Req() req: AuthedRequest) {
    return this.game.state(req.player!);
  }

  @Post("heroes/:id/mode")
  setMode(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: { mode?: string }) {
    if (body?.mode !== "work" && body?.mode !== "rest") {
      throw new BadRequestException("mode deve ser work ou rest");
    }
    return this.game.setMode(req.player!, id, body.mode);
  }

  @Post("heroes/:id/adventure")
  adventure(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: { stageId?: number }
  ) {
    if (typeof body?.stageId !== "number") {
      throw new BadRequestException("stageId numerico e obrigatorio");
    }
    return this.game.goAdventure(req.player!, id, body.stageId);
  }

  @Post("heroes/:id/house")
  setHouse(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: { houseId?: string | null }
  ) {
    if (body === undefined || body.houseId === undefined) {
      throw new BadRequestException("houseId (string ou null) e obrigatorio");
    }
    return this.game.setHouse(req.player!, id, body.houseId);
  }
}
