/**
 * Referrals page (referrals.html). Standalone: connect the wallet, show the
 * player's personal referral link and live earnings (read from the gacha
 * contract), and claim any pending referral ETH. Holds no authority.
 */
import { formatEther } from "viem";
import { connectWallet, connectedAddress, reconnectSilently } from "./web3/wallet";
import { referralStats, claimReferral } from "./web3/gacha";
import { GACHA_ENABLED } from "./config";

const $ = (id: string) => document.getElementById(id)!;

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

  const link = `${location.origin}/?ref=${addr}`;
  ($("ref-link") as HTMLInputElement).value = link;

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
