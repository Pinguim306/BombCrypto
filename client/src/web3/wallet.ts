import { createWalletClient, custom, type WalletClient, type Address } from "viem";
import { SiweMessage } from "siwe";
import { api, setToken } from "../net/api";
import { CHAIN_ID, VAULT_ADDRESS } from "../config";
import type { VoucherDto } from "../net/api";

declare global {
  interface Window {
    ethereum?: any;
  }
}

let client: WalletClient | null = null;
let account: Address | null = null;

export function connectedAddress(): Address | null {
  return account;
}

export function walletClient(): WalletClient | null {
  return client;
}

export async function connectWallet(): Promise<Address> {
  if (!window.ethereum) {
    throw new Error("No wallet found. Install an EVM wallet (e.g. Rabby/MetaMask).");
  }
  client = createWalletClient({ transport: custom(window.ethereum) });
  const [addr] = await client.requestAddresses();
  account = addr;
  // update the site header's wallet chip
  window.dispatchEvent(new CustomEvent("mb-wallet", { detail: addr }));
  return addr;
}

/**
 * Re-attaches the wallet after a page reload with a live session (JWT saved).
 * Uses eth_accounts (no popup); returns null if the site is not authorized.
 * Without this, claims/marketplace would fail with "wallet not connected"
 * after any reload.
 */
export async function reconnectSilently(): Promise<Address | null> {
  if (!window.ethereum) return null;
  try {
    const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
    if (!accounts || accounts.length === 0) return null;
    client = createWalletClient({ transport: custom(window.ethereum) });
    account = accounts[0] as Address;
    window.dispatchEvent(new CustomEvent("mb-wallet", { detail: account }));
    return account;
  } catch {
    return null;
  }
}

/** SIWE login: gets a nonce from the server, signs the message and exchanges it for a JWT. */
export async function signIn(): Promise<void> {
  if (!client || !account) throw new Error("wallet not connected");
  const { nonce } = await api.nonce(account);
  const message = new SiweMessage({
    domain: window.location.host,
    address: account,
    statement: "Sign in to MinerBlast",
    uri: window.location.origin,
    version: "1",
    chainId: CHAIN_ID,
    nonce,
  }).prepareMessage();
  const signature = await client.signMessage({ account, message });
  const { token } = await api.verify(message, signature);
  setToken(token);
}

const VAULT_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/** Sends the voucher claim transaction to the RewardVault. */
export async function claimVoucher(voucher: VoucherDto): Promise<`0x${string}`> {
  if (!client || !account) throw new Error("wallet not connected");
  return client.writeContract({
    address: (voucher.vault as Address) ?? VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "claim",
    args: [BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature as `0x${string}`],
    account,
    chain: null,
  });
}
