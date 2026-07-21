import { createPublicClient, http, keccak256, toHex, parseEventLogs } from "viem";
import { GACHA_ADDRESS, RPC_URL, GACHA_ENABLED } from "../config";
import { walletClient, connectedAddress } from "./wallet";

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
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "buyPack",
    stateMutability: "payable",
    inputs: [{ name: "salt", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "openChest",
    stateMutability: "nonpayable",
    inputs: [{ name: "chestId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

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

export async function buyChest(valueWei: bigint): Promise<`0x${string}`> {
  const { client, account } = requireWallet();
  return client.writeContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "buyChest",
    args: [randomSalt()],
    value: valueWei,
    account,
    chain: null,
  });
}

export async function buyPack(valueWei: bigint): Promise<`0x${string}`> {
  const { client, account } = requireWallet();
  return client.writeContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "buyPack",
    args: [randomSalt()],
    value: valueWei,
    account,
    chain: null,
  });
}

/** The player's unopened chest ids (small-scale scan; indexer later). */
export async function myUnopenedChests(): Promise<bigint[]> {
  if (!publicClient) throw new Error("gacha requires a configured chain");
  const me = connectedAddress()?.toLowerCase();
  if (!me) return [];
  const next = (await publicClient.readContract({
    address: GACHA_ADDRESS,
    abi: GACHA_ABI,
    functionName: "nextChestId",
  })) as bigint;

  const ids: bigint[] = [];
  for (let id = 1n; id < next; id++) {
    const [buyer, , , opened] = (await publicClient.readContract({
      address: GACHA_ADDRESS,
      abi: GACHA_ABI,
      functionName: "chests",
      args: [id],
    })) as readonly [string, bigint, string, boolean];
    if (!opened && buyer.toLowerCase() === me) ids.push(id);
  }
  return ids;
}

/** True when the chest's reveal window is open (simulation succeeds). */
export async function canOpen(chestId: bigint): Promise<boolean> {
  if (!publicClient) return false;
  const account = connectedAddress();
  if (!account) return false;
  try {
    await publicClient.simulateContract({
      address: GACHA_ADDRESS,
      abi: GACHA_ABI,
      functionName: "openChest",
      args: [chestId],
      account,
    });
    return true;
  } catch {
    return false;
  }
}

export async function openChest(chestId: bigint): Promise<`0x${string}`> {
  const { client, account } = requireWallet();
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi: CHEST_OPENED_EVENT, logs: receipt.logs });
  const ev = logs.find((l) => l.eventName === "ChestOpened");
  if (!ev) throw new Error("chest opened but the reveal event was not found");
  return { heroId: ev.args.heroId, rarity: Number(ev.args.rarity) };
}
