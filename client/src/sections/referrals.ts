/**
 * REFERRALS section — ported from ReferralsScene. The player's invite link
 * (address or custom alias, same `?ref=` format the landing page captures),
 * live earnings read from the gacha contract, a claim for pending ETH and a
 * short explanation of the program. Holds no authority: the split is
 * enforced on-chain by the gacha.
 */
import { formatEther } from "viem";
import type { SectionModule } from "./overlay";
import { referralStats, claimReferral } from "../web3/gacha";
import { signMessage } from "../web3/wallet";
import { GACHA_ENABLED, SERVER_URL, EXPLORER_URL } from "../config";
import { shortError } from "../util";

const ALIAS_RE = /^[a-zA-Z0-9_-]{3,20}$/;

/** The message the wallet signs to prove ownership when claiming an alias. */
function aliasClaimMessage(alias: string, address: string): string {
  return `MinerBlast referral alias\nalias: ${alias.toLowerCase()}\naddress: ${address.toLowerCase()}`;
}

function ensureStyle(): void {
  if (document.head.querySelector('style[data-section="referrals"]')) return;
  const style = document.createElement("style");
  style.dataset.section = "referrals";
  style.textContent = `
    .ref-intro { text-align: center; margin: 0 0 4px; color: var(--muted-lt); }
    .ref-pct { text-align: center; margin: 0 0 14px; min-height: 26px; font-weight: 700; }
    .ref-block { margin: 0 0 18px; }
    .ref-block h3 { margin: 0 0 10px; }
    .ref-link-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .ref-link { flex: 1 1 auto; display: block; padding: 8px 12px; font-size: 15px; color: var(--cyan); background: #101624; border: 2px solid var(--border); word-break: break-all; user-select: all; }
    .ref-alias { min-width: 180px; padding: 8px 10px; font: inherit; font-size: 16px; color: var(--text); background: #101624; border: 2px solid var(--border); outline: none; }
    .ref-alias:focus { border-color: var(--orange); }
    .ref-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center; margin: 4px 0 16px; }
    .ref-stats .label { color: var(--muted); font-size: 15px; margin-bottom: 6px; }
    .ref-stats .big-number { font-size: 16px; }
    .ref-stats .big-number.eth { color: var(--gold); }
    .ref-stats .big-number.inv { color: var(--text); }
    .ref-stats .big-number.pend { color: #81c784; }
    .ref-claim { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 22px; }
    .ref-tx { color: var(--muted-lt); font-size: 15px; word-break: break-all; }
    .ref-tx a { color: var(--gold); }
    .ref-how ol { margin: 6px 0 0; padding-left: 22px; }
    .ref-how li { margin-bottom: 4px; }
    @media (max-width: 640px) {
      .ref-stats { grid-template-columns: 1fr; }
      .ref-alias { flex: 1 1 100%; }
    }
  `;
  document.head.append(style);
}

export const section: SectionModule = {
  title: "REFERRALS",
  needsLogin: true,
  mount(ctx) {
    ensureStyle();
    let mounted = true;
    let alias: string | null = null;
    let link = "";
    let copyTimer: ReturnType<typeof setTimeout> | null = null;
    const root = ctx.root;

    const addr = ctx.address();
    if (!addr) {
      root.innerHTML = `
        <div class="section-empty">
          <p>Your wallet is not attached to this session — reconnect it to load your invite link.</p>
          <button class="btn btn-gold" type="button" id="ref-login"><span class="icon icon-wallet"></span>Connect wallet</button>
        </div>`;
      root.querySelector("#ref-login")!.addEventListener("click", ctx.requestLogin);
      ctx.status("Wallet not connected.", "err");
      return () => { mounted = false; };
    }

    root.innerHTML = `
      <p class="ref-intro">Invite friends — earn a share of the ETH they spend on chests.</p>
      <p class="ref-pct ok" id="ref-pct"></p>

      <div class="plate ref-block">
        <h3><span class="icon icon-gift icon-sm"></span> YOUR INVITE LINK</h3>
        <div class="ref-link-row"><code class="ref-link" id="ref-link">loading…</code></div>
        <div class="section-toolbar">
          <button class="btn btn-sm btn-green" type="button" id="ref-copy" disabled>Copy link</button>
          <input class="ref-alias" id="ref-alias" type="text" maxlength="20" autocomplete="off" spellcheck="false" placeholder="custom name (3-20 chars)">
          <button class="btn btn-sm btn-blue" type="button" id="ref-set-alias">Set custom name</button>
        </div>
      </div>

      <div class="plate ref-block">
        <h3><span class="icon icon-coin icon-sm"></span> YOUR EARNINGS</h3>
        <div class="ref-stats">
          <div><div class="label">ETH earned</div><div class="big-number eth" id="ref-earned">—</div></div>
          <div><div class="label">Invites</div><div class="big-number inv" id="ref-invites">—</div></div>
          <div><div class="label">Pending</div><div class="big-number pend" id="ref-pending">—</div></div>
        </div>
        <div class="ref-claim">
          <button class="btn btn-green" type="button" id="ref-claim" hidden><span class="icon icon-coin"></span>Claim pending ETH</button>
          <span class="ref-tx" id="ref-tx"></span>
        </div>
      </div>

      <div class="ref-how">
        <h3>HOW IT WORKS</h3>
        <ol>
          <li>Share your invite link. A friend who opens it gets your referral stored — the first link they open wins, and the binding is permanent.</li>
          <li>When they buy a chest or a pack in the Shop, the gacha contract sends you a share of the ETH they spend, automatically.</li>
          <li>ETH that could not be pushed to your wallet piles up as <b>Pending</b> — claim it here any time.</li>
          <li>Set a custom name to share a friendlier link; your wallet signs the claim, no transaction needed.</li>
        </ol>
      </div>`;

    const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    const linkEl = $<HTMLElement>("ref-link");
    const copyBtn = $<HTMLButtonElement>("ref-copy");
    const aliasInput = $<HTMLInputElement>("ref-alias");
    const aliasBtn = $<HTMLButtonElement>("ref-set-alias");
    const claimBtn = $<HTMLButtonElement>("ref-claim");
    const txEl = $<HTMLElement>("ref-tx");

    const fail = (err: unknown, prefix: string): void => {
      const msg = (err as Error).message;
      if (msg === "session expired") {
        ctx.requestLogin();
        return;
      }
      ctx.status(`${prefix}: ${shortError(err, 120)}`, "err");
    };

    const refresh = async (): Promise<void> => {
      // load the wallet's current alias so the link can use it
      try {
        const r = await fetch(`${SERVER_URL}/referrals/alias/${addr}`);
        alias = (await r.json()).alias ?? null;
      } catch {
        alias = null;
      }
      if (!mounted) return;
      const handle = alias ?? addr;
      link = `${location.origin}/?ref=${handle}`;
      linkEl.textContent = link;
      copyBtn.disabled = false;
      if (alias && !aliasInput.value) aliasInput.value = alias;

      if (!GACHA_ENABLED) {
        $("ref-pct").textContent = "";
        ctx.status("Referral rewards go live with the $BLAST launch — your link already works.");
        return;
      }
      try {
        const s = await referralStats();
        if (!mounted) return;
        $("ref-earned").textContent = Number(formatEther(s.earnedWei)).toFixed(4);
        $("ref-invites").textContent = String(s.invites);
        $("ref-pending").textContent = Number(formatEther(s.pendingWei)).toFixed(4);
        $("ref-pct").textContent = `You earn ${(s.bps / 100).toFixed(0)}% of every chest your invites buy.`;
        claimBtn.hidden = s.pendingWei <= 0n;
      } catch (err) {
        if (!mounted) return;
        fail(err, "Could not load your stats");
      }
    };

    const onCopy = async (): Promise<void> => {
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        if (!mounted) return;
        copyBtn.textContent = "Copied!";
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => { if (mounted) copyBtn.textContent = "Copy link"; }, 1200);
      } catch {
        if (!mounted) return;
        ctx.status("Clipboard unavailable — select the link above to copy it.");
      }
    };

    const onSetAlias = async (): Promise<void> => {
      const next = aliasInput.value.trim();
      if (!ALIAS_RE.test(next)) {
        ctx.status("Name must be 3-20 letters, digits, - or _", "err");
        aliasInput.focus();
        return;
      }
      aliasBtn.disabled = true;
      try {
        ctx.status("Sign the name claim in your wallet...");
        const signature = await signMessage(aliasClaimMessage(next, addr));
        const res = await fetch(`${SERVER_URL}/referrals/alias`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: addr, alias: next, signature }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `HTTP ${res.status}`);
        }
        if (!mounted) return;
        ctx.status(`Your custom link is ready! Share /?ref=${next}`, "ok");
        await refresh();
      } catch (err) {
        if (!mounted) return;
        fail(err, "Could not set name");
      } finally {
        if (mounted) aliasBtn.disabled = false;
      }
    };

    const onClaim = async (): Promise<void> => {
      claimBtn.disabled = true;
      txEl.textContent = "";
      try {
        ctx.status("Confirm the claim in your wallet...");
        const hash = await claimReferral();
        if (!mounted) return;
        ctx.status("Claimed! ETH sent to your wallet.", "ok");
        txEl.innerHTML = `tx ${ctx.esc(hash.slice(0, 10))}… · <a href="${ctx.esc(`${EXPLORER_URL}/tx/${hash}`)}" target="_blank" rel="noopener">view on explorer</a>`;
        await refresh();
      } catch (err) {
        if (!mounted) return;
        fail(err, "Claim failed");
      } finally {
        if (mounted) claimBtn.disabled = false;
      }
    };

    copyBtn.addEventListener("click", () => void onCopy());
    aliasBtn.addEventListener("click", () => void onSetAlias());
    aliasInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void onSetAlias(); });
    claimBtn.addEventListener("click", () => void onClaim());

    void refresh();

    return () => {
      mounted = false;
      if (copyTimer) clearTimeout(copyTimer);
    };
  },
};
