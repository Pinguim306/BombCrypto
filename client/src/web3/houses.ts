import { createPublicClient, http } from "viem";
import { HOUSES_ADDRESS, TOKEN_ADDRESS, RPC_URL, MARKET_ENABLED } from "../config";
import { walletClient, connectedAddress, ensureChain } from "./wallet";

const HOUSES_ABI = [
  {
    type: "function",
    name: "prices",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "buyHouse",
    stateMutability: "nonpayable",
    inputs: [{ name: "rarity", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const publicClient = MARKET_ENABLED ? createPublicClient({ transport: http(RPC_URL) }) : null;

function requireWallet() {
  const client = walletClient();
  const account = connectedAddress();
  if (!client || !account) throw new Error("wallet not connected");
  return { client, account };
}

/** Price (in wei) of each house rarity, index 0..5. 0 = not for sale. */
export async function housePrices(): Promise<bigint[]> {
  if (!publicClient) throw new Error("houses require a configured chain");
  const prices: bigint[] = [];
  for (let r = 0n; r < 6n; r++) {
    const p = (await publicClient.readContract({
      address: HOUSES_ADDRESS,
      abi: HOUSES_ABI,
      functionName: "prices",
      args: [r],
    })) as bigint;
    prices.push(p);
  }
  return prices;
}

/** Player's BLAST balance (wei). */
export async function blastBalance(): Promise<bigint> {
  if (!publicClient) return 0n;
  const account = connectedAddress();
  if (!account) return 0n;
  return (await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  })) as bigint;
}

/** Ensures BLAST allowance, then buys a house of the given rarity. */
export async function buyHouse(rarity: number, priceWei: bigint): Promise<`0x${string}`> {
  const { client, account } = requireWallet();
  await ensureChain();
  if (!publicClient) throw new Error("houses require a configured chain");

  const allowance = (await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, HOUSES_ADDRESS],
  })) as bigint;

  if (allowance < priceWei) {
    // the approve MUST be mined before buyHouse, or the purchase reverts
    // with an insufficient-allowance error
    const approveHash = await client.writeContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [HOUSES_ADDRESS, priceWei],
      account,
      chain: null,
    });
    const rc = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 240_000 });
    if (rc.status !== "success") throw new Error("the BLAST approve transaction reverted");
  }
  const buyHash = await client.writeContract({
    address: HOUSES_ADDRESS,
    abi: HOUSES_ABI,
    functionName: "buyHouse",
    args: [rarity],
    account,
    chain: null,
  });
  const buyRc = await publicClient.waitForTransactionReceipt({ hash: buyHash, timeout: 240_000 });
  if (buyRc.status !== "success") throw new Error("the house purchase reverted on-chain");
  return buyHash;
}
