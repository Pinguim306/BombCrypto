import { createWalletClient, custom, type WalletClient, type Address } from "viem";
import { SiweMessage } from "siwe";
import { api, setToken } from "../net/api";
import { CHAIN_ID, RPC_URL, VAULT_ADDRESS, WC_PROJECT_ID } from "../config";
import type { VoucherDto } from "../net/api";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type WalletKind = "injected" | "walletconnect";
/** Whether the WalletConnect (mobile) option is available for this deploy. */
export const MOBILE_WALLET_ENABLED = WC_PROJECT_ID !== "";

let client: WalletClient | null = null;
let account: Address | null = null;
let provider: any = null; // the active EIP-1193 provider
let providerKind: WalletKind | null = null;
let wcProvider: any = null; // cached WalletConnect provider instance

export function connectedAddress(): Address | null {
  return account;
}

export function walletClient(): WalletClient | null {
  return client;
}

/** Lazily creates (and restores the session of) the WalletConnect provider. */
async function initWalletConnect(): Promise<any> {
  if (!WC_PROJECT_ID) throw new Error("Mobile wallet is not configured yet.");
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  wcProvider = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [CHAIN_ID],
    optionalChains: [CHAIN_ID],
    showQrModal: true,
    rpcMap: { [CHAIN_ID]: RPC_URL },
    metadata: {
      name: "MinerBlast",
      description: "Explosive play-to-earn mining on Robinhood Chain",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.png`],
    },
  });
  return wcProvider;
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

let watching = false;
/** Logs the session out the moment the wallet switches to another account —
 *  purchases must always come from the account the game is showing. */
function watchAccountChanges() {
  if (watching || typeof provider?.on !== "function") return;
  watching = true;
  provider.on("accountsChanged", (accs: string[]) => {
    const next = accs?.[0]?.toLowerCase();
    if (!next || (account && next !== account.toLowerCase())) {
      window.dispatchEvent(new Event("mb-disconnect"));
    }
  });
}

/** Connects a browser-extension wallet (default) or a mobile wallet via
 *  WalletConnect (QR / deeplink). */
export async function connectWallet(kind: WalletKind = "injected"): Promise<Address> {
  if (kind === "walletconnect") {
    const wc = await initWalletConnect();
    if (!wc.accounts?.length) await wc.connect(); // opens the QR / deeplink modal
    provider = wc;
  } else {
    if (!window.ethereum) {
      throw new Error("No wallet found. Install an EVM wallet (e.g. MetaMask/Rabby) or use Mobile.");
    }
    provider = window.ethereum;
  }
  providerKind = kind;
  client = createWalletClient({ transport: custom(provider) });
  const [addr] = await client.requestAddresses();
  account = addr;
  await ensureChain(); // land on Robinhood Chain from the very start
  watchAccountChanges();
  localStorage.setItem("mb.provider", kind);
  window.dispatchEvent(new CustomEvent("mb-wallet", { detail: addr }));
  return addr;
}

/**
 * Re-attaches the wallet after a page reload with a live session (JWT saved).
 * Restores whichever provider was last used (injected via eth_accounts, or a
 * persisted WalletConnect session). Returns null if nothing is authorized.
 */
export async function reconnectSilently(): Promise<Address | null> {
  const last = (() => { try { return localStorage.getItem("mb.provider"); } catch { return null; } })();
  try {
    if (last === "walletconnect" && WC_PROJECT_ID) {
      const wc = await initWalletConnect();
      if (!wc.accounts?.length) return null; // session expired
      provider = wc;
      providerKind = "walletconnect";
      client = createWalletClient({ transport: custom(provider) });
      account = wc.accounts[0] as Address;
      watchAccountChanges();
      window.dispatchEvent(new CustomEvent("mb-wallet", { detail: account }));
      return account;
    }
    if (!window.ethereum) return null;
    const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
    if (!accounts || accounts.length === 0) return null;
    provider = window.ethereum;
    providerKind = "injected";
    client = createWalletClient({ transport: custom(provider) });
    account = accounts[0] as Address;
    watchAccountChanges();
    window.dispatchEvent(new CustomEvent("mb-wallet", { detail: account }));
    return account;
  } catch {
    return null;
  }
}

/** Tears down the active session (WalletConnect included) before a reload. */
export async function disconnectWallet(): Promise<void> {
  try {
    if (providerKind === "walletconnect" && wcProvider?.disconnect) {
      await wcProvider.disconnect();
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem("mb.provider");
  } catch {
    /* ignore */
  }
  client = account = provider = providerKind = wcProvider = null;
}

/** Signs an arbitrary message with the connected wallet (personal_sign). */
export async function signMessage(message: string): Promise<string> {
  if (!client || !account) throw new Error("wallet not connected");
  return client.signMessage({ account, message });
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
