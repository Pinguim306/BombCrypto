import { createPublicClient, http, type Address } from "viem";
import { MARKET_ADDRESS, TOKEN_ADDRESS, RPC_URL, MARKET_ENABLED } from "../config";
import { walletClient, connectedAddress, ensureChain } from "./wallet";

const MARKET_ABI = [
  {
    type: "function",
    name: "nextListingId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "listings",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [],
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
] as const;

const ERC721_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export interface MarketListing {
  id: bigint;
  seller: Address;
  collection: Address;
  tokenId: bigint;
  price: bigint;
}

const publicClient = MARKET_ENABLED
  ? createPublicClient({ transport: http(RPC_URL) })
  : null;

/** Active listings, scanning the ids (small scale; an indexer takes over later). */
export async function fetchListings(): Promise<MarketListing[]> {
  if (!publicClient) throw new Error("marketplace requires a configured chain");
  const next = (await publicClient.readContract({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    functionName: "nextListingId",
  })) as bigint;

  const result: MarketListing[] = [];
  for (let id = 1n; id < next; id++) {
    const [seller, collection, tokenId, price, active] = (await publicClient.readContract({
      address: MARKET_ADDRESS,
      abi: MARKET_ABI,
      functionName: "listings",
      args: [id],
    })) as readonly [Address, Address, bigint, bigint, boolean];
    if (active) result.push({ id, seller, collection, tokenId, price });
  }
  return result;
}

function requireWallet() {
  const client = walletClient();
  const account = connectedAddress();
  if (!client || !account) throw new Error("wallet not connected");
  return { client, account };
}

/** Waits for a tx to be mined and confirms it did not revert. */
async function awaitTx(hash: `0x${string}`, what: string): Promise<void> {
  if (!publicClient) throw new Error("marketplace requires a configured chain");
  const rc = await publicClient.waitForTransactionReceipt({ hash, timeout: 240_000 });
  if (rc.status !== "success") throw new Error(`the ${what} transaction reverted on-chain`);
}

/** Approves the NFT and creates the listing (2 transactions). */
export async function listNft(collection: Address, tokenId: bigint, priceWei: bigint) {
  const { client, account } = requireWallet();
  await ensureChain();
  const approveHash = await client.writeContract({
    address: collection,
    abi: ERC721_ABI,
    functionName: "approve",
    args: [MARKET_ADDRESS, tokenId],
    account,
    chain: null,
  });
  await awaitTx(approveHash, "NFT approve"); // must mine before list()
  const listHash = await client.writeContract({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    functionName: "list",
    args: [collection, tokenId, priceWei],
    account,
    chain: null,
  });
  await awaitTx(listHash, "listing");
  return listHash;
}

/** Ensures BLAST allowance and buys the listing. */
export async function buyListing(listing: MarketListing) {
  const { client, account } = requireWallet();
  await ensureChain();
  if (!publicClient) throw new Error("marketplace requires a configured chain");

  const allowance = (await publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, MARKET_ADDRESS],
  })) as bigint;

  if (allowance < listing.price) {
    const approveHash = await client.writeContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [MARKET_ADDRESS, listing.price],
      account,
      chain: null,
    });
    await awaitTx(approveHash, "BLAST approve"); // must mine before buy()
  }
  const buyHash = await client.writeContract({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    functionName: "buy",
    args: [listing.id],
    account,
    chain: null,
  });
  await awaitTx(buyHash, "purchase");
  return buyHash;
}

export async function cancelListing(id: bigint) {
  const { client, account } = requireWallet();
  await ensureChain();
  return client.writeContract({
    address: MARKET_ADDRESS,
    abi: MARKET_ABI,
    functionName: "cancel",
    args: [id],
    account,
    chain: null,
  });
}
