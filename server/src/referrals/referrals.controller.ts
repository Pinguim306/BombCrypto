import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { verifyMessage, getAddress } from "ethers";
import { PersistenceService } from "../storage/persistence.service";

const ALIAS_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Message the wallet signs to prove ownership when claiming an alias. */
export function aliasClaimMessage(alias: string, address: string): string {
  return `MinerBlast referral alias\nalias: ${alias.toLowerCase()}\naddress: ${address.toLowerCase()}`;
}

/**
 * Off-chain referral aliases: a vanity handle (e.g. "coolminer") that maps to
 * a wallet address so players can share a link without exposing their address.
 * The on-chain referral payment always uses the resolved address.
 */
@Controller("referrals")
export class ReferralsController {
  constructor(private readonly store: PersistenceService) {}

  /** Claims/updates an alias, proven by a wallet signature. */
  @Post("alias")
  async setAlias(@Body() body: { address?: string; alias?: string; signature?: string }) {
    const { address, alias, signature } = body ?? {};
    if (!address || !alias || !signature) throw new BadRequestException("address, alias and signature are required");
    if (!ADDRESS_RE.test(address)) throw new BadRequestException("invalid address");
    if (!ALIAS_RE.test(alias)) throw new BadRequestException("alias must be 3-20 letters, digits, - or _");
    if (ADDRESS_RE.test(alias) || /^0x/i.test(alias)) throw new BadRequestException("alias cannot look like an address");

    let signer: string;
    try {
      signer = verifyMessage(aliasClaimMessage(alias, address), signature);
    } catch {
      throw new BadRequestException("invalid signature");
    }
    if (signer.toLowerCase() !== address.toLowerCase()) {
      throw new BadRequestException("signature does not match the address");
    }

    const result = this.store.setAlias(address, alias);
    if (result === "taken") throw new BadRequestException("that alias is already taken");
    return { ok: true, alias };
  }

  /** The alias currently owned by an address (for showing the player's link). */
  @Get("alias/:address")
  aliasOf(@Param("address") address: string) {
    if (!ADDRESS_RE.test(address)) throw new BadRequestException("invalid address");
    return { alias: this.store.aliasForAddress(address) };
  }

  /** Resolves an alias OR a raw address to a checksummed address (or null). */
  @Get("resolve/:handle")
  resolve(@Param("handle") handle: string) {
    if (ADDRESS_RE.test(handle)) return { address: getAddress(handle) };
    const addr = this.store.addressForAlias(handle);
    return { address: addr ? getAddress(addr) : null };
  }
}
