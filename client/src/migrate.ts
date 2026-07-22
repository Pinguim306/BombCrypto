/**
 * Gacha v2 migration panel (migrate.html). Lets the owner/admin wallet grant
 * MINTER_ROLE on Heroes to GachaV2 and revoke it from GachaV1. Standalone,
 * mainnet-hardcoded; holds no authority (every action is wallet-signed and
 * the Heroes contract checks the caller's admin role).
 */
import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";
import { CHAIN_ID, RPC_URL } from "./config";

const HEROES = "0x10413d00F51672F71AACE3852ad816Ff19552623" as Address;
const GACHA_V1 = "0xE941C5972d5ECaf4528C26cA3012B095F215618d" as Address;
const GACHA_V2 = "0xe76C420e3C5190d88483D992D6123346b7a05803" as Address;

const HEROES_ABI = [
  { type: "function", name: "MINTER_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "DEFAULT_ADMIN_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  { type: "function", name: "revokeRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
] as const;

const pub = createPublicClient({ transport: http(RPC_URL) });
const $ = (id: string) => document.getElementById(id)!;
let account: Address | null = null;
let wallet: ReturnType<typeof createWalletClient> | null = null;
let MINTER: `0x${string}` | null = null;

function status(msg: string, cls = "") {
  $("status").textContent = msg;
  $("status").className = cls;
}
function badge(id: string, ok: boolean, yes = "yes", no = "no") {
  const el = $(id);
  el.textContent = ok ? yes : no;
  el.className = ok ? "ok-badge" : "bad-badge";
}

async function refresh() {
  MINTER = (await pub.readContract({ address: HEROES, abi: HEROES_ABI, functionName: "MINTER_ROLE" })) as `0x${string}`;
  const [v2, v1] = await Promise.all([
    pub.readContract({ address: HEROES, abi: HEROES_ABI, functionName: "hasRole", args: [MINTER, GACHA_V2] }),
    pub.readContract({ address: HEROES, abi: HEROES_ABI, functionName: "hasRole", args: [MINTER, GACHA_V1] }),
  ]);
  badge("v2-minter", v2 as boolean, "yes ✓", "not yet");
  badge("v1-minter", v1 as boolean, "yes", "no ✓");
  if (account) {
    const adminRole = (await pub.readContract({ address: HEROES, abi: HEROES_ABI, functionName: "DEFAULT_ADMIN_ROLE" })) as `0x${string}`;
    const isAdmin = (await pub.readContract({ address: HEROES, abi: HEROES_ABI, functionName: "hasRole", args: [adminRole, account] })) as boolean;
    badge("is-admin", isAdmin, "yes ✓", "NO — wrong wallet");
    ($("grant") as HTMLButtonElement).disabled = !isAdmin || (v2 as boolean);
    ($("revoke") as HTMLButtonElement).disabled = !isAdmin || !(v1 as boolean);
  }
}

async function ensureChain(provider: any) {
  const hex = `0x${CHAIN_ID.toString(16)}`;
  if (parseInt(await provider.request({ method: "eth_chainId" }), 16) === CHAIN_ID) return;
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
}

$("connect").addEventListener("click", async () => {
  try {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("no wallet extension found");
    await ensureChain(eth);
    wallet = createWalletClient({ transport: custom(eth) });
    [account] = await wallet.requestAddresses();
    $("acct").textContent = account.slice(0, 8) + "…" + account.slice(-6);
    status("connected", "ok");
    await refresh();
  } catch (e) {
    status(String((e as Error).message).split("\n")[0], "err");
  }
});

async function send(fn: "grantRole" | "revokeRole", target: Address, label: string) {
  try {
    if (!wallet || !account || !MINTER) throw new Error("connect first");
    status(`confirm: ${label} in your wallet...`);
    const hash = await wallet.writeContract({
      address: HEROES, abi: HEROES_ABI, functionName: fn, args: [MINTER, target], account, chain: null,
    });
    status(`${label} sent, waiting... ${hash}`);
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${label} reverted`);
    status(`${label} confirmed ✓`, "ok");
    await refresh();
  } catch (e) {
    status(`${label} failed: ${String((e as Error).message).split("\n")[0]}`, "err");
  }
}

$("grant").addEventListener("click", () => send("grantRole", GACHA_V2, "Grant MINTER to GachaV2"));
$("revoke").addEventListener("click", () => send("revokeRole", GACHA_V1, "Revoke MINTER from GachaV1"));

refresh().catch(() => status("could not read chain state", "err"));
