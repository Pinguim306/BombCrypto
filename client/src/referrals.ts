/**
 * Referrals page (referrals.html). Standalone: connect the wallet, show the
 * player's personal referral link and live earnings (read from the gacha
 * contract), and claim any pending referral ETH. Holds no authority.
 */
import { formatEther } from "viem";
import { connectWallet, connectedAddress, reconnectSilently, signMessage } from "./web3/wallet";
import { referralStats, claimReferral } from "./web3/gacha";
import { GACHA_ENABLED, SERVER_URL } from "./config";

const $ = (id: string) => document.getElementById(id)!;

/** Alias the connected wallet currently owns (server-side vanity handle). */
let currentAlias: string | null = null;

/** The message the wallet signs to prove ownership when claiming an alias. */
function aliasClaimMessage(alias: string, address: string): string {
  return `MinerBlast referral alias\nalias: ${alias.toLowerCase()}\naddress: ${address.toLowerCase()}`;
}

function status(msg: string, cls = "") {
  const el = $("ref-status");
  el.textContent = msg;
  el.className = cls;
}

function shortErr(e: unknown): string {
  return String((e as Error)?.message ?? e ?? "error").split("\n")[0].slice(0, 120);
}

async function render() {
  const addr = connectedAddress();
  if (!addr) {
    $("ref-connected").style.display = "none";
    $("ref-disconnected").style.display = "";
    return;
  }
  $("ref-connected").style.display = "";
  $("ref-disconnected").style.display = "none";

  // load the wallet's current alias so the link can use it
  try {
    const r = await fetch(`${SERVER_URL}/referrals/alias/${addr}`);
    currentAlias = (await r.json()).alias ?? null;
  } catch {
    currentAlias = null;
  }
  const handle = currentAlias ?? addr;
  ($("ref-link") as HTMLInputElement).value = `${location.origin}/?ref=${handle}`;
  if (currentAlias) ($("ref-alias") as HTMLInputElement).value = currentAlias;

  if (!GACHA_ENABLED) {
    status("Referral rewards go live with the $BLAST launch — your link already works.", "");
    return;
  }
  try {
    const s = await referralStats();
    $("ref-earned").textContent = Number(formatEther(s.earnedWei)).toFixed(4);
    $("ref-invites").textContent = String(s.invites);
    $("ref-pending").textContent = Number(formatEther(s.pendingWei)).toFixed(4);
    const pct = `${(s.bps / 100).toFixed(0)}%`;
    $("ref-pct").textContent = pct;
    $("ref-pct2").textContent = pct;
    $("ref-claim-wrap").style.display = s.pendingWei > 0n ? "" : "none";
    status("", "");
  } catch (e) {
    status(`Could not load your stats: ${shortErr(e)}`, "err");
  }
}

$("ref-connect").addEventListener("click", async () => {
  try {
    status("connecting...");
    await connectWallet();
    status("", "");
    await render();
  } catch (e) {
    status(shortErr(e), "err");
  }
});

$("ref-set-alias").addEventListener("click", async () => {
  const addr = connectedAddress();
  if (!addr) return;
  const alias = ($("ref-alias") as HTMLInputElement).value.trim();
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(alias)) {
    status("Name must be 3-20 letters, digits, - or _", "err");
    return;
  }
  try {
    ($("ref-set-alias") as HTMLButtonElement).disabled = true;
    status("sign the name claim in your wallet...");
    const signature = await signMessage(aliasClaimMessage(alias, addr));
    const res = await fetch(`${SERVER_URL}/referrals/alias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr, alias, signature }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `HTTP ${res.status}`);
    }
    status(`Your custom link is ready! Share minerblast.fun/?ref=${alias}`, "ok");
    await render();
  } catch (e) {
    status(`Could not set name: ${shortErr(e)}`, "err");
  } finally {
    ($("ref-set-alias") as HTMLButtonElement).disabled = false;
  }
});

$("ref-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(($("ref-link") as HTMLInputElement).value);
    const b = $("ref-copy");
    const prev = b.textContent;
    b.textContent = "Copied!";
    setTimeout(() => (b.textContent = prev), 1200);
  } catch {
    /* clipboard unavailable; the link is selectable */
  }
});

$("ref-claim").addEventListener("click", async () => {
  try {
    ($("ref-claim") as HTMLButtonElement).disabled = true;
    status("confirm the claim in your wallet...");
    await claimReferral();
    status("claimed! ETH sent to your wallet.", "ok");
    await render();
  } catch (e) {
    status(`Claim failed: ${shortErr(e)}`, "err");
  } finally {
    ($("ref-claim") as HTMLButtonElement).disabled = false;
  }
});

// auto-attach if the wallet already authorized this site
reconnectSilently().finally(render);
