/**
 * Withdrawal (claim) economics — shared between the game state endpoint and
 * the voucher issuer. Values are env-tunable and MUST mirror the on-chain
 * RewardVault settings (minClaim / claimCooldown), or claims the server
 * signs would revert on-chain.
 *
 * Production recommendation: 10,000 BLAST minimum + 24h cooldown.
 * Testnet uses lower values so testers can reach a claim in one session.
 */
export const MIN_CLAIM_BLAST = Number(process.env.MIN_CLAIM_BLAST ?? 10_000);
export const MIN_CLAIM_MICRO = Math.round(MIN_CLAIM_BLAST * 1_000_000);

export const CLAIM_COOLDOWN_HOURS = Number(process.env.CLAIM_COOLDOWN_HOURS ?? 24);
export const CLAIM_COOLDOWN_MS = CLAIM_COOLDOWN_HOURS * 3_600_000;
