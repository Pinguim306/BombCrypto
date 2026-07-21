import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { GameService } from "../game/game.service";
import { PersistenceService } from "../storage/persistence.service";

import { MIN_CLAIM_MICRO, MIN_CLAIM_BLAST, CLAIM_COOLDOWN_MS } from "../config";

const VAULT_ABI = ["function nonces(address player) view returns (uint256)"];

const VOUCHER_TTL_S = 3600;

export interface ClaimVoucher {
  amount: string; // in wei (1e18)
  nonce: string;
  deadline: number;
  signature: string;
  vault: string;
  chainId: number;
}

/**
 * Issues EIP-712 vouchers accepted by the RewardVault and persists them for
 * reconciliation:
 *  - a pending, non-expired voucher is re-presented (not debited again);
 *  - an expired voucher without a claim has its value refunded to the pending balance;
 *  - with RPC, the on-chain nonce marks older vouchers as claimed.
 * The signing key must have SIGNER_ROLE on the contract (KMS/HSM in production).
 */
@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);
  private readonly signer: Wallet;
  private readonly provider?: JsonRpcProvider;
  private readonly vaultAddress: string;
  private readonly chainId: number;

  constructor(
    private readonly game: GameService,
    private readonly persistence: PersistenceService
  ) {
    // Hardhat dev key #0 — NEVER use outside development
    const key =
      process.env.SIGNER_KEY ??
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    this.signer = new Wallet(key);
    this.vaultAddress = process.env.VAULT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
    this.chainId = Number(process.env.CHAIN_ID ?? 31337);
    if (process.env.RPC_URL) {
      this.provider = new JsonRpcProvider(process.env.RPC_URL);
    } else {
      this.logger.warn("RPC_URL missing — using local nonces (dev only)");
    }
  }

  async issueVoucher(player: string): Promise<ClaimVoucher> {
    await this.reconcile(player);

    // pending voucher still valid? re-present it instead of issuing another
    const pending = this.persistence.unclaimedVoucher(player);
    if (pending && pending.deadline > Math.floor(Date.now() / 1000)) {
      return {
        amount: pending.amountWei,
        nonce: pending.nonce,
        deadline: pending.deadline,
        signature: pending.signature,
        vault: this.vaultAddress,
        chainId: this.chainId,
      };
    }

    // claim cooldown: measured from the last issued voucher (re-presenting a
    // still-valid pending voucher above does not count as a new claim)
    const lastIssuedAt = this.persistence.lastVoucherAt(player);
    if (lastIssuedAt && Date.now() - lastIssuedAt < CLAIM_COOLDOWN_MS) {
      const remainingMin = Math.ceil((CLAIM_COOLDOWN_MS - (Date.now() - lastIssuedAt)) / 60_000);
      throw new BadRequestException(`claim cooldown active — try again in ~${remainingMin} min`);
    }

    const micro = await this.game.debitPending(player);
    if (micro < MIN_CLAIM_MICRO) {
      await this.game.refundPending(player, micro);
      throw new BadRequestException(
        `minimum claim is ${MIN_CLAIM_BLAST.toLocaleString("en-US")} BLAST`
      );
    }

    try {
      const amountWei = BigInt(micro) * 10n ** 12n; // micro (1e6) -> wei (1e18)
      const nonce = await this.nonceOf(player);
      const deadline = Math.floor(Date.now() / 1000) + VOUCHER_TTL_S;

      const signature = await this.signer.signTypedData(
        {
          name: "MinerBlastVault",
          version: "1",
          chainId: this.chainId,
          verifyingContract: this.vaultAddress,
        },
        {
          Claim: [
            { name: "player", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        { player, amount: amountWei, nonce, deadline }
      );

      this.persistence.saveVoucher({
        player,
        nonce: nonce.toString(),
        amountWei: amountWei.toString(),
        deadline,
        signature,
        claimed: 0,
        createdAt: Date.now(),
      });
      this.persistence.setLocalNonce(player, nonce + 1n);

      return {
        amount: amountWei.toString(),
        nonce: nonce.toString(),
        deadline,
        signature,
        vault: this.vaultAddress,
        chainId: this.chainId,
      };
    } catch (err) {
      await this.game.refundPending(player, micro);
      throw err;
    }
  }

  /**
   * Reconciliation: marks vouchers below the on-chain nonce as claimed and
   * refunds expired vouchers that were never claimed.
   */
  private async reconcile(player: string): Promise<void> {
    if (this.provider) {
      try {
        const vault = new Contract(this.vaultAddress, VAULT_ABI, this.provider);
        const chainNonce = (await vault.nonces(player)) as bigint;
        this.persistence.markClaimedBelow(player, chainNonce);
        this.persistence.setLocalNonce(player, chainNonce);
      } catch (err) {
        this.logger.warn(`reconcile failed for ${player}: ${(err as Error).message}`);
      }
    }

    const pending = this.persistence.unclaimedVoucher(player);
    if (pending && pending.deadline <= Math.floor(Date.now() / 1000)) {
      // expired without a claim: refund the value and discard the voucher
      this.persistence.deleteVoucher(player, pending.nonce);
      await this.game.refundPending(player, Number(BigInt(pending.amountWei) / 10n ** 12n));
      this.logger.log(`expired voucher refunded: ${player} nonce ${pending.nonce}`);
    }
  }

  private async nonceOf(player: string): Promise<bigint> {
    if (this.provider) {
      const vault = new Contract(this.vaultAddress, VAULT_ABI, this.provider);
      return (await vault.nonces(player)) as bigint;
    }
    return this.persistence.localNonce(player);
  }
}
