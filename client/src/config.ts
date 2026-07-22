// Defaults are the public Robinhood Chain MAINNET parameters, so a deploy
// with no env configured still targets the right network. Each deployment
// (local dev, testnet beta) overrides via VITE_* env. `||` on purpose:
// a present-but-empty env var must still fall back.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? "").trim() || "http://localhost:3000";
export const CHAIN_ID = Number((import.meta.env.VITE_CHAIN_ID ?? "").trim() || 4663);
export const RPC_URL = (import.meta.env.VITE_RPC_URL ?? "").trim() || "https://rpc.mainnet.chain.robinhood.com";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const VAULT_ADDRESS = (import.meta.env.VITE_VAULT_ADDRESS ?? ZERO) as `0x${string}`;
export const TOKEN_ADDRESS = (import.meta.env.VITE_TOKEN_ADDRESS ?? ZERO) as `0x${string}`;
export const MARKET_ADDRESS = (import.meta.env.VITE_MARKET_ADDRESS ?? ZERO) as `0x${string}`;
export const HEROES_ADDRESS = (import.meta.env.VITE_HEROES_ADDRESS ?? ZERO) as `0x${string}`;
export const HOUSES_ADDRESS = (import.meta.env.VITE_HOUSES_ADDRESS ?? ZERO) as `0x${string}`;
export const GACHA_ADDRESS = (import.meta.env.VITE_GACHA_ADDRESS ?? ZERO) as `0x${string}`;

/** WalletConnect Cloud (Reown) project id — mobile wallets. Optional:
 *  without it the connect screen only offers browser-extension wallets. */
export const WC_PROJECT_ID = ((import.meta.env.VITE_WC_PROJECT_ID as string | undefined) ?? "").trim();

/** Marketplace requires a configured chain (RPC + addresses). */
export const MARKET_ENABLED = RPC_URL !== "" && MARKET_ADDRESS !== ZERO && TOKEN_ADDRESS !== ZERO;

/** Gacha requires a configured chain (RPC + address). */
export const GACHA_ENABLED = RPC_URL !== "" && GACHA_ADDRESS !== ZERO;

/**
 * Referral capture: a `?ref=0x...` link parameter is stored once (first link
 * wins, matching the contract's bind-once) and passed with every chest buy
 * until the referrer is bound on-chain. Ignores malformed and self addresses.
 */
const REF_KEY = "mb.ref";
export function captureReferralFromUrl(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && /^0x[0-9a-fA-F]{40}$/.test(ref) && !localStorage.getItem(REF_KEY)) {
      localStorage.setItem(REF_KEY, ref);
    }
  } catch {
    /* no storage / no window */
  }
}
export function storedReferrer(): `0x${string}` {
  try {
    const ref = localStorage.getItem(REF_KEY);
    if (ref && /^0x[0-9a-fA-F]{40}$/.test(ref)) return ref as `0x${string}`;
  } catch {
    /* ignore */
  }
  return ZERO;
}
