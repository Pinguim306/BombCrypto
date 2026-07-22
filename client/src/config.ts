// Defaults are the public Robinhood Chain MAINNET parameters, so a deploy
// with no env configured still targets the right network. Each deployment
// (local dev, testnet beta) overrides via VITE_* env. `||` on purpose:
// a present-but-empty env var must still fall back.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? "").trim() || "http://localhost:3000";
export const CHAIN_ID = Number((import.meta.env.VITE_CHAIN_ID ?? "").trim() || 4663);
export const RPC_URL = (import.meta.env.VITE_RPC_URL ?? "").trim() || "https://rpc.mainnet.chain.robinhood.com";
/** Block explorer base (no trailing slash) — links on the public stats page. */
export const EXPLORER_URL =
  ((import.meta.env.VITE_EXPLORER_URL ?? "").trim() || "https://robinhoodchain.blockscout.com").replace(/\/$/, "");

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
 * Referral capture: a `?ref=...` link parameter (a 0x address OR a custom
 * alias like "coolminer") is stored once — first link wins, matching the
 * contract's bind-once. The raw handle is kept; it is resolved to an address
 * (via the server for aliases) lazily at purchase time.
 */
const REF_KEY = "mb.ref"; // resolved 0x address, once known
const REF_HANDLE_KEY = "mb.ref.handle"; // raw handle from the link
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ALIAS_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export function captureReferralFromUrl(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (!ref) return;
    if (localStorage.getItem(REF_KEY) || localStorage.getItem(REF_HANDLE_KEY)) return; // first link wins
    if (ADDR_RE.test(ref)) {
      localStorage.setItem(REF_KEY, ref);
      localStorage.setItem(REF_HANDLE_KEY, ref);
    } else if (ALIAS_RE.test(ref)) {
      localStorage.setItem(REF_HANDLE_KEY, ref);
    }
  } catch {
    /* no storage / no window */
  }
}

/**
 * The referrer address to pass to the gacha contract. Resolves a stored alias
 * to its address via the server (cached). Returns the zero address when there
 * is no referral or the alias is unknown.
 */
export async function resolveReferrer(): Promise<`0x${string}`> {
  try {
    const cached = localStorage.getItem(REF_KEY);
    if (cached && ADDR_RE.test(cached)) return cached as `0x${string}`;
    const handle = localStorage.getItem(REF_HANDLE_KEY);
    if (!handle) return ZERO;
    if (ADDR_RE.test(handle)) return handle as `0x${string}`;
    const res = await fetch(`${SERVER_URL}/referrals/resolve/${encodeURIComponent(handle)}`);
    const { address } = (await res.json()) as { address: string | null };
    if (address && ADDR_RE.test(address)) {
      localStorage.setItem(REF_KEY, address); // cache the resolution
      return address as `0x${string}`;
    }
  } catch {
    /* server unreachable / unknown alias: no referral */
  }
  return ZERO;
}
