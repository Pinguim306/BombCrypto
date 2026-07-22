/**
 * Public transparency dashboard (stats.html). Reads the live economy state
 * straight from Robinhood Chain — no wallet, no trust required. Off-chain
 * aggregates (miner count) come from the game server's public /stats.
 */
import { createPublicClient, http, formatUnits } from "viem";
import {
  RPC_URL, EXPLORER_URL, SERVER_URL,
  VAULT_ADDRESS, TOKEN_ADDRESS, HEROES_ADDRESS, GACHA_ADDRESS, HOUSES_ADDRESS, MARKET_ADDRESS,
} from "./config";

const ZERO = "0x0000000000000000000000000000000000000000";
const $ = (id: string) => document.getElementById(id)!;

const client = createPublicClient({ transport: http(RPC_URL) });

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
const VAULT_ABI = [
  { type: "function", name: "blast", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const VAULT_FUNDED = {
  type: "event", name: "VaultFunded",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
  ],
} as const;
const HEROES_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;
const REWARD_CLAIMED = {
  type: "event", name: "RewardClaimed",
  inputs: [
    { indexed: true, name: "player", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "nonce", type: "uint256" },
  ],
} as const;
const CHEST_OPENED = {
  type: "event", name: "ChestOpened",
  inputs: [
    { indexed: true, name: "chestId", type: "uint256" },
    { indexed: true, name: "buyer", type: "address" },
    { indexed: false, name: "heroId", type: "uint256" },
    { indexed: false, name: "rarity", type: "uint8" },
  ],
} as const;

/** Compact formatting: 46,000,000 → "46.0M", 12,500 → "12.5K". */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function set(id: string, value: string) {
  $(id).textContent = value;
}

async function loadChain() {
  // the authoritative payout token is whatever the vault holds
  let token = TOKEN_ADDRESS as `0x${string}`;
  try {
    token = await client.readContract({ address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "blast" }) as `0x${string}`;
  } catch { /* fall back to the configured token */ }

  let decimals = 18;
  try {
    decimals = Number(await client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }));
  } catch { /* assume 18 */ }
  const toBlast = (wei: bigint) => Number(formatUnits(wei, decimals));

  // vault balance — the trust anchor
  try {
    const bal = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [VAULT_ADDRESS] }) as bigint;
    set("vault", compact(toBlast(bal)));
  } catch { set("vault", "—"); }

  // total ever deposited into the vault (VaultFunded events) — context for the balance
  try {
    const logs = await client.getLogs({ address: VAULT_ADDRESS, event: VAULT_FUNDED, fromBlock: 0n, toBlock: "latest" });
    const funded = logs.reduce((s, l) => s + ((l.args as { amount?: bigint }).amount ?? 0n), 0n);
    if (funded > 0n) set("vault-sub", `of ${compact(toBlast(funded))} ever deposited`);
  } catch { /* leave the sub blank */ }

  // $BLAST total supply
  try {
    const sup = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "totalSupply" }) as bigint;
    set("supply", compact(toBlast(sup)));
  } catch { set("supply", "—"); }

  // heroes minted (ERC721Enumerable.totalSupply)
  try {
    const minted = await client.readContract({ address: HEROES_ADDRESS, abi: HEROES_ABI, functionName: "totalSupply" }) as bigint;
    set("heroes", compact(Number(minted)));
  } catch { set("heroes", "—"); }

  // chests opened + total BLAST paid — from event logs (guarded; some RPCs cap ranges)
  try {
    const logs = await client.getLogs({ address: GACHA_ADDRESS, event: CHEST_OPENED, fromBlock: 0n, toBlock: "latest" });
    set("chests", compact(logs.length));
  } catch { set("chests", "—"); }

  try {
    const logs = await client.getLogs({ address: VAULT_ADDRESS, event: REWARD_CLAIMED, fromBlock: 0n, toBlock: "latest" });
    const total = logs.reduce((s, l) => s + ((l.args as { amount?: bigint }).amount ?? 0n), 0n);
    set("paid", compact(toBlast(total)));
  } catch { set("paid", "—"); }

  return token;
}

async function loadServer() {
  try {
    const r = await fetch(`${SERVER_URL}/stats`);
    const s = await r.json();
    set("miners", compact(Number(s.players ?? 0)));
  } catch { set("miners", "—"); }
}

function renderContracts(token: string) {
  const rows: [string, string][] = [
    ["$BLAST token", token],
    ["Reward Vault", VAULT_ADDRESS],
    ["Gacha (chests)", GACHA_ADDRESS],
    ["Heroes NFT", HEROES_ADDRESS],
    ["Houses NFT", HOUSES_ADDRESS],
    ["Marketplace", MARKET_ADDRESS],
  ];
  const html = rows
    .filter(([, addr]) => addr && addr.toLowerCase() !== ZERO)
    .map(([name, addr]) =>
      `<a class="contract" href="${EXPLORER_URL}/address/${addr}" target="_blank" rel="noopener">
        <span class="name">${name}</span>
        <span class="addr">${addr.slice(0, 8)}…${addr.slice(-6)}</span>
        <span class="go">↗</span>
      </a>`)
    .join("");
  $("contracts").innerHTML = html || `<span class="addr">Contracts appear here once the chain is configured.</span>`;
}

async function refresh() {
  $("stat-status").textContent = "loading…";
  const [token] = await Promise.all([loadChain(), loadServer()]);
  renderContracts(token);
  $("updated").textContent = new Date().toLocaleTimeString();
  $("stat-status").textContent = "";
}

refresh();
setInterval(refresh, 30_000);
