import { Controller, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, AuthedRequest } from "../auth/jwt.guard";
import { RewardsService } from "./rewards.service";

@Controller("rewards")
@UseGuards(JwtAuthGuard)
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Post("voucher")
  voucher(@Req() req: AuthedRequest) {
    return this.rewards.issueVoucher(req.player!);
  }
}
