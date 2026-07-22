import { createWalletClient, custom, type WalletClient, type Address } from "viem";
import { SiweMessage } from "siwe";
import { api, setToken } from "../net/api";
import { CHAIN_ID, RPC_URL, VAULT_ADDRESS } from "../config";
import type { VoucherDto } from "../net/api";

declare global {
  interface Window {
    ethereum?: any;
  }
}

let client: WalletClient | null = null;
let account: Address | null = null;
let provider: any = null; // the active EIP-1193 provider

export function connectedAddress(): Address | null {
  return account;
}

export function walletClient(): WalletClient | null {
  return client;
}

const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
const CHAIN_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

/**
 * Guarantees the wallet is on Robinhood Chain BEFORE any transaction.
 * Without this, a wallet sitting on another network (e.g. Base) would send
 * real ETH to our contract addresses on that network — where no contract
 * exists — and the funds would be lost. Switches automatically and offers
 * to add the chain when the wallet does not know it.
 */
export async function ensureChain(): Promise<void> {
  if (!provider) throw new Error("wallet not connected");
  const current = await provider.request({ method: "eth_chainId" });
  if (parseInt(current, 16) === CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (err: any) {
    // 4902: the wallet does not have the chain yet
    if (err?.code === 4902 || /unrecognized|not.*added|4902/i.test(String(err?.message ?? ""))) {
      await provider.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } else {
      throw new Error("please switch your wallet to Robinhood Chain and try again");
    }
  }
  const after = await provider.request({ method: "eth_chainId" });
  if (parseInt(after, 16) !== CHAIN_ID) {
    throw new Error("wrong network: switch your wallet to Robinhood Chain");
  }
}

export async function connectWallet(): Promise<Address> {
  if (!window.ethereum) {
    throw new Error("No wallet found. Install an EVM wallet (e.g. Rabby/MetaMask).");
  }
  provider = window.ethereum;
  client = createWalletClient({ transport: custom(provider) });
  const [addr] = await client.requestAddresses();
  account = addr;
  await ensureChain(); // land on Robinhood Chain from the very start
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
    provider = window.ethereum;
    client = createWalletClient({ transport: custom(provider) });
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
  await ensureChain();
  return client.writeContract({
    address: (voucher.vault as Address) ?? VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "claim",
    args: [BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature as `0x${string}`],
    account,
    chain: null,
  });
}
