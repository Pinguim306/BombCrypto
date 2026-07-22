# Referrals — Implementation Plan (NOT yet implemented)

Goal: whoever refers a player earns **15% of the ETH that player spends on
chests** (singles and packs). This document is the agreed plan; no code has
been written yet.

## 1. Core design decision: pay on-chain, in ETH, at purchase time

Two viable architectures were considered:

| | A. On-chain split (recommended) | B. Off-chain accrual |
|---|---|---|
| How | Gacha v2 splits every chest payment: 15% referrer / 85% treasury, in the same tx | Server watches ChestBought events, credits 15% in BLAST, pays via voucher |
| Trust | Trustless, visible on the explorer — marketing-grade transparency | Players must trust the server's math |
| Payout asset | ETH (what was spent) | BLAST (from the vault — mixes reward budgets) |
| Cost to build | New Gacha contract + migration | Server/indexer work only |
| Risk | Contract redeploy + role migration | Vault drain if the crediting logic has bugs |

**Recommendation: A.** Referral money is marketing spend from chest revenue
(treasury's 100% becomes 85% on referred purchases); it should not leak from
the player-reward vault, and "the contract pays instantly" is itself a
selling point for the referral program.

## 2. Contract changes (Gacha v2)

New storage & API (delta over the current Gacha):

```solidity
uint16  public referralBps = 1500;                 // 15%, admin-tunable, hard cap 2000
mapping(address player => address) public referrerOf;   // set once, first purchase
mapping(address referrer => uint256) public referralEarned;   // lifetime stat (for UI)

function buyChest(bytes32 salt, address referrer) external payable ...
function buyPack(bytes32 salt, address referrer) external payable ...
event ReferralPaid(address indexed referrer, address indexed buyer, uint256 amountWei);
event ReferrerBound(address indexed player, address indexed referrer);
```

Rules:
- **Bind once**: the first purchase with a non-zero `referrer` permanently
  binds it (`referrerOf[buyer]`). Later purchases pay the bound referrer even
  if the client passes zero/another address. Passing `address(0)` and having
  no binding → 100% to treasury (unchanged behavior).
- **Self-referral blocked** (`referrer != msg.sender`). A player using a
  second wallet to self-refer is economically a 15% self-discount; accepted
  and documented (industry norm — not worth heavy sybil defenses at launch).
- **Payout = push with pull fallback**: try `call{value}` to the referrer
  with a gas stipend; if it fails (weird contract wallets), credit
  `pendingReferral[referrer]` withdrawable via `claimReferral()`. Never lets
  a broken referrer address block a purchase. `nonReentrant` stays on all
  buy paths.
- Admin knobs (owner wallet only): `setReferralBps` (≤ 2000 = 20% cap baked
  into the contract), everything else unchanged from current Gacha.
- Unit tests: bind-once, split math (single + pack), self-ref revert, zero
  ref, push-failure → pull path, bps change, reroll/open unaffected.

## 3. Client changes

- **Link capture**: `minerblast.fun/?ref=0xADDR` → validate address →
  `localStorage["mb.ref"]` (survives navigation; first link wins, or last —
  decide: FIRST wins, matching the contract's bind-once).
- **Buy flow**: `buyChest/buyPack` pass `localStorage["mb.ref"] ?? 0x0`.
  After the first confirmed purchase the binding is on-chain; the stored
  value becomes irrelevant.
- **Referrals panel** (new section in the site or Shop scene):
  - "Your referral link" + copy button (`minerblast.fun/?ref=<connected addr>`);
  - Lifetime earnings (`referralEarned(addr)` read) and number of players
    bound to you (from `ReferrerBound` logs);
  - Short explainer: "Earn 15% in ETH of every chest your invites buy — paid
    instantly by the contract."
- Guide/whitepaper sections updated.

## 4. Server / indexer (optional, phase 2)

Nothing is required for payouts (fully on-chain). Nice-to-haves:
- `/referrals/stats` endpoint aggregating `ReferralPaid` logs (leaderboard,
  totals) for a landing-page widget;
- The indexer already ingests gacha events — extend for the two new events.

## 5. Migration runbook (the sensitive part)

The current Gacha holds MINTER_ROLE on Heroes and is referenced by the site.
Steps (same shape as the tested testnet swap in `contracts/script/swap-gacha.ts`):

1. Deploy Gacha v2 (deployer key; constructor mirrors current prices +
   referralBps) — **no admin needed**.
2. **Owner-wallet signatures required** (admin was renounced by the deployer):
   - `Heroes.grantRole(MINTER_ROLE, gachaV2)`
   - `Heroes.revokeRole(MINTER_ROLE, gachaV1)`
   Prepared as two click-by-click transactions for the owner (Blockscout
   write tab or a one-off page like /admin.html).
3. Verify v2 (Sourcify) + update `VITE_GACHA_ADDRESS` (Vercel env → redeploy).
4. Grace window: v1 keeps working for opening ALREADY-BOUGHT chests (openChest
   needs no MINTER? — it mints, so it DOES: keep v1's MINTER_ROLE until all
   v1 chests are opened or rerolled, then revoke. The site can read pending
   chests from both addresses during the window.)
5. Update docs (deployments/mainnet.md, whitepaper odds page unchanged) and
   announce.

⚠️ Step 4 nuance discovered in planning: revoking v1's MINTER_ROLE
immediately would brick unopened v1 chests. The plan keeps BOTH gachas
minter for a announced window (e.g. 7 days), with the client opening from
both, then the owner revokes v1.

## 6. Economics impact

- Treasury take on referred purchases: 0.005 ETH → 0.00425 ETH (single);
  0.04 → 0.034 (pack). Non-referred purchases unchanged.
- Referral spend is bounded: at most 15% of gross chest revenue, only when
  a referral exists — pure CAC paid on realized revenue.
- No vault/BLAST impact; claim rules untouched.

## 7. Abuse & edge cases

| Case | Handling |
|---|---|
| Self-referral same wallet | Reverts |
| Self-referral second wallet | Allowed by design = 15% discount; monitor volume |
| Referrer is a contract that reverts on receive | Pull fallback (`claimReferral`) |
| Ref link changed after binding | Contract ignores; bind-once |
| Referrer never played | Allowed at launch (grows top of funnel); can later gate "must own ≥1 hero" via setter if farmed |
| ref param + old client (no param) | New ABI is additive; old cached clients would break on buy → force-refresh via Vercel redeploy; keep function overloads `buyChest(bytes32)` delegating with referrer=0 for backward compat |

## 8. Rollout phases & effort

| Phase | Scope | Effort |
|---|---|---|
| 1 | Gacha v2 contract + unit tests + testnet deploy & E2E | ~half a day |
| 2 | Client: ref capture, buy params, Referrals panel | ~half a day |
| 3 | Mainnet migration (deploy, owner signatures, env flip, grace window) | ~1 hour + 7-day window |
| 4 | Stats endpoint + leaderboard widget (optional) | ~half a day, later |

## 9. Open questions for the owner (decide before build)

1. 15% fixed or admin-tunable (plan assumes tunable with 20% hard cap)?
2. Applies to packs too (plan assumes YES, same 15%)?
3. Referrer eligibility gate at launch: none (plan) or "must own a hero"?
4. Referrals panel placement: site header page or in-game Shop tab?
5. Launch timing: before or after the current player-growth push (migration
   causes a ~minutes buy-pause + 7-day dual-gacha window)?
