import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("nonce")
  nonce(@Body() body: { address?: string }) {
    if (!body?.address || !/^0x[0-9a-fA-F]{40}$/.test(body.address)) {
      throw new BadRequestException("invalid address");
    }
    return { nonce: this.auth.issueNonce(body.address) };
  }

  @Post("verify")
  async verify(@Body() body: { message?: string; signature?: string }) {
    if (!body?.message || !body?.signature) {
      throw new BadRequestException("message and signature are required");
    }
    return this.auth.verify(body.message, body.signature);
  }
}
