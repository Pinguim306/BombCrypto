import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

export interface AuthedRequest {
  headers: Record<string, string | undefined>;
  player?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers["authorization"];
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7));
      req.player = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException("invalid or expired token");
    }
  }
}
