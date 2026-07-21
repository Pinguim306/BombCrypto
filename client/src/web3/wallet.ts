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
    throw new Error("Nenhuma carteira encontrada. Instale uma carteira EVM (ex.: Rabby/MetaMask).");
  }
  client = createWalletClient({ transport: custom(window.ethereum) });
  const [addr] = await client.requestAddresses();
  account = addr;
  return addr;
}

/** Login SIWE: pega nonce no servidor, assina a mensagem e troca por JWT. */
export async function signIn(): Promise<void> {
  if (!client || !account) throw new Error("carteira nao conectada");
  const { nonce } = await api.nonce(account);
  const message = new SiweMessage({
    domain: window.location.host,
    address: account,
    statement: "Entrar no MinerBlast",
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

/** Envia a transação de claim do voucher para o RewardVault. */
export async function claimVoucher(voucher: VoucherDto): Promise<`0x${string}`> {
  if (!client || !account) throw new Error("carteira nao conectada");
  return client.writeContract({
    address: (voucher.vault as Address) ?? VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "claim",
    args: [BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature as `0x${string}`],
    account,
    chain: null,
  });
}
