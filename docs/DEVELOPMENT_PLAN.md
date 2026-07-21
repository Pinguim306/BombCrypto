# Development Plan — Project "MinerBlast" (codename)

A play-to-earn *bomber mining* game inspired by BombCrypto's mechanics,
built for **Robinhood Chain**.

---

## 1. Scope and legal positioning

**What we replicate:** the game's mechanics and systems (idle mining with heroes,
stamina, rarities, game modes, token/NFT economy). Game mechanics are not protected
by copyright.

**What we do NOT replicate:** the name, logo, art, sprites, animations, sounds, music,
whitepaper texts, and visual identity of BombCrypto — all of that is Senspark's property
and is replaced by 100% original assets. The code is also written from scratch (Senspark's
GitHub serves only as a public architecture reference, not as a source of code).

**Name:** "MinerBlast" is a working codename. Before launch: trademark and domain
availability search. Avoid any name evoking "Bomb Crypto" or "Robinhood" (the chain's
brand belongs to Robinhood Markets — use it only as a factual platform reference, e.g.
"built on Robinhood Chain", per their brand guidelines).

---

## 2. The platform: Robinhood Chain

| Item | Situation (Jul 2026) |
|---|---|
| Technology | Ethereum L2 based on **Arbitrum Orbit / Nitro** — fully **EVM-compatible** |
| Public testnet | Live since **2026-02-10** (4M+ transactions in the first week) |
| Mainnet | Expected **late 2026** (phase 2 of the rollout) |
| Infra partners | Alchemy, Chainlink, LayerZero, Allium, TRM |
| Ecosystem | Robinhood sponsors Arbitrum Open House 2026 buildathons (US$ 1M) |

**Implications for the project:**
- EVM-compatible → Solidity + standard tooling (Hardhat/Foundry, viem/wagmi) works as-is.
- We develop and launch **on testnet first** (public beta), migrating to mainnet at launch.
- Chainlink present on the chain → we can use **VRF** for gacha/chest randomness (with a
  commit-reveal fallback if VRF is not available on testnet at first).
- The chain focuses on RWA/finance → a game is a differentiator in the ecosystem; worth
  entering the Arbitrum Open House buildathons for visibility and grants.

---

## 3. Game Design — reference mechanics

Systems equivalent to the original game's, with our own names and numbers:

### 3.1 Heroes (ERC-721 NFT)
- **Attributes:** Power (mining damage), Speed (interval between bombs), Stamina
  (max energy), Blast range, Simultaneous bombs, and randomly rolled special abilities
  (e.g., walk through blocks, chest bonus, shield, heal).
- **Rarities (6 tiers):** Common, Rare, Super Rare, Epic, Legend, Mythic — each tier
  with higher attribute ranges and reward multipliers.
- **Level/Upgrade:** hero fusion + token to level up (supply burn, an important sink).
- **Acquisition:** chest purchases (gacha) with the game token; probabilities public on-chain.

### 3.2 Game modes
1. **Treasure Mining** (main mode, idle): the player places up to 15 heroes on a block
   map; they mine automatically, spending stamina. Blocks hide rewards (token, chest
   fragments, keys). Works with the client closed (server-side simulation).
2. **Adventure** (active, classic bomber style): stages with enemies, obstacles, and
   bosses; entry cost in keys; bigger rewards.
3. **PVP Arena** (later phase): 1v1 matches with token stakes and seasonal ranking.
4. **Events/seasons:** special maps, world bosses, daily missions (retention).

### 3.3 Stamina and Houses (NFT)
- A mining hero spends stamina; at zero, it must rest.
- **Houses (ERC-721):** speed up stamina recovery; capacity and speed vary by house
  rarity. Bought with the token or on the marketplace.

### 3.4 Economy
- **Game token (ERC-20)** — codename `$BLAST`: earned by mining/playing; spent on chests,
  upgrades, houses, PVP entries, and fees.
- **Sinks (burn/lock):** part of gacha, upgrade, and marketplace fees is burned; staking
  with a lock to reduce sell pressure.
- **Controlled faucets:** daily reward emission bounded by a decaying pool (avoiding
  hyperinflation — the main killer of P2E games).
- **Marketplace:** buy/sell heroes and houses with a fee (e.g., 4% — half burned,
  half to the treasury).
- **Reward claims:** earnings accrue off-chain on the server; the player claims on-chain
  with a server-signed voucher (EIP-712) — cheap, safe, and anti-bot.

### 3.5 Tokenomics (launchpad model — DECIDED)
- **$BLAST is issued by a launchpad (ponsfamily.com)** with a fixed supply of
  **1 billion**; the game contracts never mint it.
- The project **buys a share of the supply** and deposits it into the
  pre-funded **RewardVault**; **launchpad creator fees** keep topping the
  vault up over time.
- All in-game "burns" (gacha, houses, upgrade fees, marketplace fee share)
  transfer to the dead address `0x…dEaD`, so they work with any ERC-20.
- **Withdrawal rules** (on-chain, admin-tunable): minimum accumulated amount
  per claim + per-player cooldown + global daily payout cap. Production
  target: **30,000 BLAST minimum, 24h cooldown** (testnet beta runs
  375 / 1h), calibrated against current earn rates (~375-550 BLAST/hour
  for a starter team).
- Key health metric: **vault runway** = vault balance / daily payouts —
  tracked via /admin/metrics and topped up from creator fees.

---

## 4. Technical architecture

```
┌─────────────┐   WebSocket/REST   ┌──────────────────┐
│  Client      │◄──────────────────►│  Game server      │
│  Phaser 3    │                    │  (authoritative)  │
│  + wagmi     │                    │  NestJS+PG+Redis  │
└──────┬──────┘                    └────────┬─────────┘
       │ tx (mint, claim,                    │ signs EIP-712 vouchers
       │ marketplace)                        │ reads events (indexer)
       ▼                                     ▼
┌──────────────────────────────────────────────────────┐
│           Robinhood Chain (testnet → mainnet)         │
│  Token │ Heroes │ Houses │ Gacha │ Vault │ Market     │
└──────────────────────────────────────────────────────┘
```

### 4.1 Smart contracts (Solidity 0.8.x + Hardhat + OpenZeppelin)
| Contract | Standard | Role |
|---|---|---|
| `BlastToken` | ERC-20 | Launchpad-issued in production (fixed 1B supply); dev stand-in for testnet |
| `Heroes` | ERC-721 | Heroes; packed on-chain attribute struct; minted via `Gacha` |
| `Houses` | ERC-721 | Stamina-recovery houses |
| `Gacha` | — | Chest sales; randomness via Chainlink VRF (commit-reveal fallback); public odds |
| `RewardVault` | — | Pre-funded vault; EIP-712 voucher claims; min claim + cooldown + daily cap |
| `Marketplace` | — | NFT listing/sales; configurable fee; reentrancy protection |
| `Staking` | — | Token lock with rewards; in-game multipliers for stakers |
| `HeroUpgrade` | — | Hero fusion/burn + token to level up |

Principles: minimal, auditable contracts; parameters adjustable via timelock + multisig;
no upgradability on asset contracts (token/NFT), transparent upgradability only on the
logic layer (Gacha/Vault) if needed.

### 4.2 Client (game)
- **Phaser 3 + TypeScript + Vite** — 2D web game (desktop + mobile browser); same
  technical profile as the original (web-based) and fast to iterate.
- **Wallet:** viem + WalletConnect; SIWE login (Sign-In with Ethereum).
- Original pixel art (hire an artist or generate our own base) — style defined in the
  project's *own* media kit.

### 4.3 Authoritative server (anti-cheat)
- **NestJS (Node/TS) + PostgreSQL + Redis**; WebSocket for mining state.
- All mining/combat simulation runs **on the server**; the client only renders.
  (P2E lesson: the client never decides rewards.)
- Voucher-signing service (key in KMS/HSM), per-account/day claim limits, bot detection
  (fingerprinting, rate limiting, pattern analysis).

### 4.4 Indexing and infra
- Event indexer (Ponder or subgraph, per chain support; Alchemy is on the chain).
- Deploy: Docker + IaC; testnet RPC via Alchemy.
- CI: contract build + tests (coverage, slither) + server tests.

---

## 5. Development phases

### Phase 0 — Foundations (1–2 weeks)
- Monorepo (pnpm workspaces), CI, environments; Robinhood Chain testnet RPC access.
- Detailed Game Design Document with numeric balancing (economy spreadsheet).
- **Deliverable:** structured repo + GDD + economy simulation.

### Phase 1 — Core contracts (2–3 weeks)
- `BlastToken`, `Heroes`, `Gacha`, `RewardVault`; tests with >90% coverage; fuzzing.
- Deployment to the Robinhood Chain testnet + reproducible deploy scripts.
- **Deliverable:** verified contracts on testnet, with tests.

### Phase 2 — Playable core loop (3–4 weeks)
- Phaser client: mining screen, hero selection, stamina/reward HUD.
- Server: mining simulation, persistence, WebSocket, SIWE.
- Integration: buy chest → mint hero → mine → accrue → claim on-chain.
- **Deliverable:** end-to-end playable vertical slice on testnet.

### Phase 3 — Full economy (2–3 weeks)
- Houses + stamina recovery; hero upgrade/fusion; staking; daily missions.
- Internal economic metrics dashboard (emission, burn, DAU).
- **Deliverable:** complete economic loop with active sinks and faucets.

### Phase 4 — Marketplace and Adventure mode (3–4 weeks)
- On-chain marketplace + UI; Adventure mode (stages, enemies, bosses).
- **Deliverable:** public testnet beta (leveraging Arbitrum/Robinhood buildathon visibility).

### Phase 5 — Hardening and audit (3–4 weeks, parallel to beta)
- External contract audit; bug bounty; server load tests; anti-bot.
- Balancing adjustments with real beta data.
- **Deliverable:** audit report + fixes.

### Phase 6 — Mainnet launch (when the chain's mainnet opens, late 2026)
- Token TGE + DEX liquidity on the chain; beta migration/snapshot (decide whether testnet
  progress becomes an airdrop); PVP and seasons post-launch.

**Estimated total to public beta: ~3–4 months; mainnet aligned with the chain's launch.**

---

## 6. Risks and mitigation

| Risk | Mitigation |
|---|---|
| **P2E death spiral** (token only falls) | Decaying emission, strong sinks, fun-first before yield, economy simulation from Phase 0 |
| Chain mainnet slips | Beta runs on testnet; plan B: launch on Arbitrum One and migrate via bridge |
| VRF unavailable on testnet | Commit-reveal fallback already implemented |
| Bots draining rewards | Authoritative server, claim limits, behavioral detection, entry cost (gacha) |
| Brand confusion (Senspark/Robinhood) | 100% original name, art, and texts; legal review before launch |
| Contract exploit | External audit, fuzzing, bounty, timelock+multisig, mint caps in the Vault |

---

## 7. Decisions and open questions

**Decided:**
1. ✅ Name: **MinerBlast** (pending only formal trademark clearance before launch).
2. ✅ **Single-token** economy: $BLAST.

**Open:**
3. Testnet beta progress: full reset, proportional airdrop, or 1:1 migration?
4. Audit budget (reference: US$ 15–40k for the listed scope).
5. Enter the Arbitrum Open House 2026 buildathons (registration, deadlines).
