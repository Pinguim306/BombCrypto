export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
export const VAULT_ADDRESS = (import.meta.env.VITE_VAULT_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;
