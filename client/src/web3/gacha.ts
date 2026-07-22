import { createPublicClient, http, keccak256, toHex, parseEventLogs } from "viem";
import { GACHA_ADDRESS, RPC_URL, GACHA_ENABLED, storedReferrer } from "../config";
import { walletClient, connectedAddress, ensureChain } from "./wallet";

const CHEST_OPENED_EVENT = [
  {
    type: "event",
    name: "ChestOpened",
    inputs: [
      { indexed: true, name: "chestId", type: "uint256" },
      { indexed: true, name: "buyer", type: "address" },
      { indexed: false, name: "heroId", type: "uint256" },
      { indexed: false, name: "rarity", type: "uint8" },
    ],
  },
] as const;

const CHEST_BOUGHT_EVENT = {
  type: "event",
  name: "ChestBought",
  inputs: [
    { indexed: true, name: "chestId", type: "uint256" },
    { indexed: true, name: "buyer", type: "address" },
    { indexed: false, name: "revealBlock", type: "uint64" },
  ],
} as const;

const GACHA_ABI = [
  {
    type: "function",
    name: "chestPriceWei",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "packPriceWei",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "packSize",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "nextChestId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "chests",
    stateMutability: "view",
    inputs: [{ name: "chestId", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "revealBlock", type: "uint64" },
      { name: "salt", type: "bytes32" },
      { name: "opened", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "buyChest",
    stateMutability: "payable",
    inputs: [{ name: "salt", type: "bytes32" }, { name: "referrer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "buyPack",
    stateMutability: "payable",
    inputs: [{ name: "salt", type: "bytes32" }, { name: "referrer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "openChest",
    stateMutability: "nonpayable",
    inputs: [{ name: "chestId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "reroll",
    stateMutability: "nonpayable",
    inputs: [{ name: "chestId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "referralEarned",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingReferral",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "referralBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "claimReferral",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

const REFERRER_BOUND_EVENT = {
  type: "event",
  name: "ReferrerBound",
  inputs: [
    { indexed: true, name: "player", type: "address" },
    { indexed: true, name: "referrer", type: "address" },
  ],
} as const;

const publicClient = GACHA_ENABLED ? createPublicClient({ transport: http(RPC_URL) }) : null;

function requireWallet() {
  const client = walletClient();
  const account = connectedAddress();
  if (!client || !account) throw new Error("wallet not connected");
  return { client, account };
}

function randomSalt(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return keccak256(toHex(bytes));
}

/**
 * Waits for a tx to be mined and verifies it did not revert. A receipt with
 * status "reverted" resolves normally in viem, so it must be checked here —
 * otherwise reverted opens would surface as "event not found".
 */
async function confirmTx(hash: `0x${string}`, what: string) {
  if (!publicClient) throw new Error("gacha requires a configured chain");
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
  } catch {
    throw new Error(`the ${what} transaction is taking long to confirm — check your wallet activity before retrying`);
  }
  if (receipt.status !== "success") {
    throw new Error(`the ${what} transaction reverted on-chain`);
  }
  return receipt;
}

export interface GachaPrices {
  chestWei: bigint;
  packWei: bigint;
  packSize: number;
}

export async function gachaPrices(): Promise<GachaPrices> {
  if (!publicClient) throw new Error("gacha requires a configured chain");
  const [chestWei, packWei, packSize] = await Promise.all([
    publicClient.readContract({ address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "chestPriceWei" }),
    publicClient.readContract({ address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "packPriceWei" }),
    publicClient.readContract({ address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "packSize" }),
  ]);
  return { chestWei: chestWei as bigint, packWei: packWei as bigint, packSize: Number(packSize) };
}

/** Buys one chest and only resolves once the purchase is mined, so callers
 *  can immediately query the new chest on-chain. */
export async function buyChest(valueWei: bigint): Promise<void> {
  const { client, account } = requireWallet();
  await ensureChain();
  const hash = await client.writeContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "buyChest",
    args: [randomSalt(), storedReferrer()],
    value: valueWei,
    account,
    chain: null,
  });
  await confirmTx(hash, "purchase");
}

export async function buyPack(valueWei: bigint): Promise<void> {
  const { client, account } = requireWallet();
  await ensureChain();
  const hash = await client.writeContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "buyPack",
    args: [randomSalt(), storedReferrer()],
    value: valueWei,
    account,
    chain: null,
  });
  await confirmTx(hash, "purchase");
}

async function unopenedFromIds(ids: bigint[], me: string): Promise<bigint[]> {
  const unopened: bigint[] = [];
  // bounded parallelism: friendly to public RPCs
  const CHUNK = 20;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const states = await Promise.all(
      chunk.map((id) =>
        publicClient!.readContract({
          address: GACHA_ADDRESS,
          abi: GACHA_ABI,
          functionName: "chests",
          args: [id],
        }) as Promise<readonly [string, bigint, string, boolean]>
      )
    );
    states.forEach(([buyer, , , opened], j) => {
      if (!opened && buyer.toLowerCase() === me) unopened.push(chunk[j]);
    });
  }
  return unopened.sort((a, b) => (a < b ? -1 : 1));
}

export interface ReferralStats {
  earnedWei: bigint; // lifetime referral ETH earned
  pendingWei: bigint; // referral ETH owed but not yet pushed (claimable)
  invites: number; // players bound to this referrer
  bps: number; // current referral share in basis points
}

/** Reads the connected wallet's referral stats from the gacha contract. */
export async function referralStats(): Promise<ReferralStats> {
  if (!publicClient) throw new Error("gacha requires a configured chain");
  const account = connectedAddress();
  if (!account) return { earnedWei: 0n, pendingWei: 0n, invites: 0, bps: 1500 };
  const [earned, pending, bps] = await Promise.all([
    publicClient.readContract({ address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "referralEarned", args: [account] }),
    publicClient.readContract({ address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "pendingReferral", args: [account] }),
    publicClient.readContract({ address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "referralBps" }),
  ]);
  let invites = 0;
  try {
    const logs = await publicClient.getLogs({
      address: GACHA_ADDRESS, event: REFERRER_BOUND_EVENT,
      args: { referrer: account }, fromBlock: 0n, toBlock: "latest",
    });
    invites = new Set(logs.map((l) => l.args.player!.toLowerCase())).size;
  } catch {
    /* log range unsupported: leave invites at 0 */
  }
  return { earnedWei: earned as bigint, pendingWei: pending as bigint, invites, bps: Number(bps) };
}

/** Withdraws referral ETH that could not be pushed automatically. */
export async function claimReferral(): Promise<`0x${string}`> {
  const { client, account } = requireWallet();
  await ensureChain();
  const hash = await client.writeContract({
    address: GACHA_ADDRESS, abi: GACHA_ABI, functionName: "claimReferral", account, chain: null,
  });
  await confirmTx(hash, "referral claim");
  return hash;
}

/** The player's unopened chest ids, via the indexed ChestBought event —
 *  one log query instead of scanning every chest ever sold. */
export async function myUnopenedChests(): Promise<bigint[]> {
  if (!publicClient) throw new Error("gacha requires a configured chain");
  const account = connectedAddress();
  if (!account) return [];
  const me = account.toLowerCase();

  try {
    const logs = await publicClient.getLogs({
      address: GACHA_ADDRESS,
      event: CHEST_BOUGHT_EVENT,
      args: { buyer: account },
      fromBlock: 0n,
      toBlock: "latest",
    });
    const ids = [...new Set(logs.map((l) => l.args.chestId!))];
    return unopenedFromIds(ids, me);
  } catch {
    // RPC without a usable eth_getLogs range: fall back to the full scan
    const next = (await publicClient.readContract({
      address: GACHA_ADDRESS,
      abi: GACHA_ABI,
      functionName: "nextChestId",
    })) as bigint;
    const all: bigint[] = [];
    for (let id = 1n; id < next; id++) all.push(id);
    return unopenedFromIds(all, me);
  }
}

export type ChestStatus = "ready" | "waiting" | "expired" | "unavailable";

/**
 * Where the chest stands in the commit-reveal flow. "expired" means the
 * reveal blockhash is gone (>256 blocks) and the chest needs a reroll tx;
 * "unavailable" covers already-opened / not-the-buyer / no wallet.
 */
export async function chestStatus(chestId: bigint): Promise<ChestStatus> {
  if (!publicClient) return "unavailable";
  const account = connectedAddress();
  if (!account) return "unavailable";
  try {
    await publicClient.simulateContract({
      address: GACHA_ADDRESS,
      abi: GACHA_ABI,
      functionName: "openChest",
      args: [chestId],
      account,
    });
    return "ready";
  } catch (err) {
    const msg = String((err as Error).message ?? "");
    if (msg.includes("reveal expired")) return "expired";
    if (msg.includes("already opened") || msg.includes("not the buyer")) return "unavailable";
    // "wait for reveal block" and transient RPC errors both mean: try later
    return "waiting";
  }
}

/** Renews an expired chest's reveal block (Gacha.reroll). Resolves when mined. */
export async function rerollChest(chestId: bigint): Promise<void> {
  const { client, account } = requireWallet();
  await ensureChain();
  const hash = await client.writeContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "reroll",
    args: [chestId],
    account,
    chain: null,
  });
  await confirmTx(hash, "reroll");
}

export async function openChest(chestId: bigint): Promise<`0x${string}`> {
  const { client, account } = requireWallet();
  await ensureChain();
  return client.writeContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "openChest",
    args: [chestId],
    account,
    chain: null,
  });
}

export interface RevealedHero {
  heroId: bigint;
  rarity: number;
}

/**
 * Opens a chest and waits for the transaction to confirm, then decodes the
 * ChestOpened event so the UI can reveal which hero was minted.
 */
export async function openChestAndReveal(chestId: bigint): Promise<RevealedHero> {
  if (!publicClient) throw new Error("gacha requires a configured chain");
  const hash = await openChest(chestId);
  const receipt = await confirmTx(hash, "open");
  const logs = parseEventLogs({ abi: CHEST_OPENED_EVENT, logs: receipt.logs });
  const ev = logs.find((l) => l.eventName === "ChestOpened");
  if (!ev) throw new Error("chest opened but the reveal event was not found");
  return { heroId: ev.args.heroId, rarity: Number(ev.args.rarity) };
}
