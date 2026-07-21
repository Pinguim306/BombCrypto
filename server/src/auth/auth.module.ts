import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt.guard";

export const JWT_SECRET = process.env.JWT_SECRET ?? "minerblast-dev-secret";

@Module({
  imports: [JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: "24h" } })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
