import { createPublicClient, http, type PublicClient } from "viem";
import { RPC_URL } from "../config";

export type ClaimReceipt = "success" | "reverted" | "timeout";

let publicClient: PublicClient | null = null;

/**
 * Waits for the claim tx to be mined and reports how it ended. Mirrors
 * gacha.ts confirmTx but never throws: the bridge already has the hash at
 * this point, so an RPC hiccup or a slow chain must not turn a sent claim
 * into an "error" — Godot shows the hash and lets the player check the
 * explorer instead. A reverted receipt resolves normally in viem, hence the
 * explicit status check.
 */
export async function waitForClaim(hash: `0x${string}`): Promise<ClaimReceipt> {
  publicClient ??= createPublicClient({ transport: http(RPC_URL) });
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
    return receipt.status === "success" ? "success" : "reverted";
  } catch {
    return "timeout";
  }
}
