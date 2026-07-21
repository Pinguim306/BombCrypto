import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { GameService } from "../game/game.service";
import { PersistenceService } from "../storage/persistence.service";

const VAULT_ABI = ["function nonces(address player) view returns (uint256)"];

/** Saque mínimo: 1 BLAST (evita spam de claims minúsculos). */
const MIN_CLAIM_MICRO = 1_000_000;
const VOUCHER_TTL_S = 3600;

export interface ClaimVoucher {
  amount: string; // em wei (1e18)
  nonce: string;
  deadline: number;
  signature: string;
  vault: string;
  chainId: number;
}

/**
 * Emite vouchers EIP-712 aceitos pelo RewardVault e os persiste para
 * reconciliação:
 *  - voucher pendente e não expirado é reapresentado (não debita de novo);
 *  - voucher expirado sem claim tem o valor estornado ao saldo pendente;
 *  - com RPC, o nonce on-chain marca como sacados os vouchers antigos.
 * A chave assinante deve ter SIGNER_ROLE no contrato (KMS/HSM em produção).
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
    // chave de dev nº 0 do Hardhat — NUNCA usar fora de desenvolvimento
    const key =
      process.env.SIGNER_KEY ??
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    this.signer = new Wallet(key);
    this.vaultAddress = process.env.VAULT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
    this.chainId = Number(process.env.CHAIN_ID ?? 31337);
    if (process.env.RPC_URL) {
      this.provider = new JsonRpcProvider(process.env.RPC_URL);
    } else {
      this.logger.warn("RPC_URL ausente — usando nonces locais (somente dev)");
    }
  }

  async issueVoucher(player: string): Promise<ClaimVoucher> {
    await this.reconcile(player);

    // voucher pendente ainda válido? reapresenta em vez de emitir outro
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

    const micro = await this.game.debitPending(player);
    if (micro < MIN_CLAIM_MICRO) {
      await this.game.refundPending(player, micro);
      throw new BadRequestException("saldo minimo de 1 BLAST para sacar");
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
   * Reconciliação: marca como sacados os vouchers abaixo do nonce on-chain e
   * estorna vouchers expirados que nunca foram sacados.
   */
  private async reconcile(player: string): Promise<void> {
    if (this.provider) {
      try {
        const vault = new Contract(this.vaultAddress, VAULT_ABI, this.provider);
        const chainNonce = (await vault.nonces(player)) as bigint;
        this.persistence.markClaimedBelow(player, chainNonce);
        this.persistence.setLocalNonce(player, chainNonce);
      } catch (err) {
        this.logger.warn(`reconcile falhou para ${player}: ${(err as Error).message}`);
      }
    }

    const pending = this.persistence.unclaimedVoucher(player);
    if (pending && pending.deadline <= Math.floor(Date.now() / 1000)) {
      // expirou sem claim: estorna o valor e descarta o voucher
      this.persistence.deleteVoucher(player, pending.nonce);
      await this.game.refundPending(player, Number(BigInt(pending.amountWei) / 10n ** 12n));
      this.logger.log(`voucher expirado estornado: ${player} nonce ${pending.nonce}`);
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
