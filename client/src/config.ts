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

/** Marketplace requires a configured chain (RPC + addresses). */
export const MARKET_ENABLED = RPC_URL !== "" && MARKET_ADDRESS !== ZERO && TOKEN_ADDRESS !== ZERO;

/** Gacha requires a configured chain (RPC + address). */
export const GACHA_ENABLED = RPC_URL !== "" && GACHA_ADDRESS !== ZERO;
