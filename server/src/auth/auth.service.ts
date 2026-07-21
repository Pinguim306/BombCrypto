import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { SiweMessage, generateNonce } from "siwe";

interface PendingNonce {
  nonce: string;
  expiresAt: number;
}

const NONCE_TTL_MS = 5 * 60_000;

@Injectable()
export class AuthService {
  private nonces = new Map<string, PendingNonce>();

  constructor(private readonly jwt: JwtService) {}

  issueNonce(address: string): string {
    const nonce = generateNonce();
    this.nonces.set(address.toLowerCase(), { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
    return nonce;
  }

  async verify(message: string, signature: string): Promise<{ token: string; address: string }> {
    let siwe: SiweMessage;
    try {
      siwe = new SiweMessage(message);
    } catch {
      throw new UnauthorizedException("mensagem SIWE invalida");
    }

    const pending = this.nonces.get(siwe.address.toLowerCase());
    if (!pending || pending.expiresAt < Date.now() || pending.nonce !== siwe.nonce) {
      throw new UnauthorizedException("nonce invalido ou expirado");
    }

    const result = await siwe.verify({ signature, nonce: pending.nonce }).catch(() => null);
    if (!result || !result.success) {
      throw new UnauthorizedException("assinatura SIWE invalida");
    }

    this.nonces.delete(siwe.address.toLowerCase());
    const address = siwe.address;
    const token = await this.jwt.signAsync({ sub: address });
    return { token, address };
  }
}
