/**
 * Vault funding panel (admin.html). Standalone page: connect the owner
 * wallet, approve BLAST to the RewardVault and call fund(). Exists because
 * the chain's explorer verification service is flaky — this page needs no
 * explorer at all. It holds no secrets: every action is a wallet-signed
 * transaction that the contracts themselves authorize.
 */
import { createPublicClient, createWalletClient, custom, http, parseEther, formatEther, type Address } from "viem";
import { CHAIN_ID, RPC_URL, TOKEN_ADDRESS, VAULT_ADDRESS } from "./config";

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const VAULT = [
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
] as const;

const pub = createPublicClient({ transport: http(RPC_URL) });
const $ = (id: string) => document.getElementById(id)!;
let account: Address | null = null;
let wallet: ReturnType<typeof createWalletClient> | null = null;

function status(msg: string, cls = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = cls;
}

async function refresh() {
  const vb = await pub.readContract({ address: TOKEN_ADDRESS, abi: ERC20, functionName: "balanceOf", args: [VAULT_ADDRESS] });
  $("vault").textContent = Number(formatEther(vb)).toLocaleString("en-US") + " BLAST";
  if (!account) return;
  const [bal, allow] = await Promise.all([
    pub.readContract({ address: TOKEN_ADDRESS, abi: ERC20, functionName: "balanceOf", args: [account] }),
    pub.readContract({ address: TOKEN_ADDRESS, abi: ERC20, functionName: "allowance", args: [account, VAULT_ADDRESS] }),
  ]);
  $("bal").textContent = Number(formatEther(bal)).toLocaleString("en-US") + " BLAST";
  $("allow").textContent = Number(formatEther(allow)).toLocaleString("en-US") + " BLAST";
}

async function ensureChain(provider: any) {
  const hex = `0x${CHAIN_ID.toString(16)}`;
  const cur = await provider.request({ method: "eth_chainId" });
  if (parseInt(cur, 16) === CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (err: any) {
    if (err?.code === 4902 || /unrecognized|not.*added/i.test(String(err?.message ?? ""))) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [RPC_URL], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"] }],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } else throw err;
  }
}

$("connect").addEventListener("click", async () => {
  try {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("no wallet extension found");
    await ensureChain(eth);
    wallet = createWalletClient({ transport: custom(eth) });
    [account] = await wallet.requestAddresses();
    $("acct").textContent = account.slice(0, 8) + "…" + account.slice(-6);
    ($("approve") as HTMLButtonElement).disabled = false;
    ($("fund") as HTMLButtonElement).disabled = false;
    const cb = $("connect") as HTMLButtonElement;
    cb.disabled = true;
    cb.textContent = "Connected ✓";
    status("connected — check the balances, then Approve and Fund", "ok");
    await refresh();
  } catch (err) {
    status(String((err as Error).message).split("\n")[0].slice(0, 140), "err");
  }
});

function amountWei(): bigint {
  const raw = ($("amount") as HTMLInputElement).value.replace(/[,._\s]/g, "");
  if (!/^\d+$/.test(raw)) throw new Error("invalid amount");
  return parseEther(raw);
}

$("approve").addEventListener("click", async () => {
  try {
    if (!wallet || !account) throw new Error("connect first");
    status("confirm the approve in your wallet...");
    const hash = await wallet.writeContract({
      address: TOKEN_ADDRESS, abi: ERC20, functionName: "approve",
      args: [VAULT_ADDRESS, amountWei()], account, chain: null,
    });
    status("approve sent, waiting confirmation... " + hash);
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("approve reverted");
    status("approve confirmed ✓ — now click Fund", "ok");
    await refresh();
  } catch (err) {
    status(String((err as Error).message).split("\n")[0].slice(0, 140), "err");
  }
});

$("fund").addEventListener("click", async () => {
  try {
    if (!wallet || !account) throw new Error("connect first");
    status("confirm the fund in your wallet...");
    const hash = await wallet.writeContract({
      address: VAULT_ADDRESS, abi: VAULT, functionName: "fund",
      args: [amountWei()], account, chain: null,
    });
    status("fund sent, waiting confirmation... " + hash);
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("fund reverted (is the allowance enough?)");
    status("VAULT FUNDED ✓ player withdrawals are now live!", "ok");
    await refresh();
  } catch (err) {
    status(String((err as Error).message).split("\n")[0].slice(0, 140), "err");
  }
});

refresh().catch(() => status("could not read chain state", "err"));
