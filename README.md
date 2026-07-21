# MinerBlast (codename) — P2E Game for Robinhood Chain

A play-to-earn game inspired by the *bomber mining* genre mechanics (popularized by
BombCrypto), built from scratch for **Robinhood Chain** (an Arbitrum Orbit-based EVM L2).

> **Intellectual property notice:** this project replicates *game mechanics* (which are
> not protected by copyright) but does **not** use the name, brand, art, sprites, sounds,
> or texts of the original BombCrypto — all assets and visual identity are original.
> "MinerBlast" is a working codename; the final name will go through trademark clearance.

## Documentation

- [Development Plan](docs/DEVELOPMENT_PLAN.md) — full picture: mechanics, architecture, contracts, tokenomics, phases, and risks.

## Monorepo structure

```
contracts/   # Solidity smart contracts (Hardhat + OpenZeppelin)
client/      # Game client (Phaser 3 + TypeScript + Vite)
server/      # Authoritative backend (NestJS, server-side simulation)
indexer/     # On-chain event indexing
docs/        # Documentation and game design
```

## Running locally (dev)

```bash
pnpm install

# contracts: compile and test
pnpm --filter @minerblast/contracts test

# server (port 3000)
pnpm --filter @minerblast/server build && pnpm --filter @minerblast/server start

# client (port 5173)
pnpm --filter @minerblast/client dev
```

Vertical-slice flow: connect wallet → SIWE login → dev heroes mine on the server
(authoritative simulation) → pending balance accrues → "Claim BLAST" issues an
EIP-712 voucher → the `claim` transaction on the RewardVault mints the token.

Environment variables: see `contracts/.env.example`, `server/.env.example`, and
`client/.env.example`.

## Status

- ✅ Phase 0/1 — plan, monorepo, and core contracts (BLAST, Heroes, Gacha, RewardVault) with tests
- ✅ Phase 2 — playable core loop: server-side mining engine, SIWE auth, EIP-712 vouchers, Phaser client
- ✅ Phase 3 — full economy: Houses/HeroUpgrade/Staking contracts, SQLite persistence,
  houses boosting stamina regen, voucher reconciliation, on-chain hero sync, admin metrics
- ✅ Phase 4 — on-chain Marketplace with escrow and fee (4%, half burned), Adventure mode
  with 3 stages and a daily limit, event indexer, adventure UI in the client
- ✅ Phase 4.5 — Market scene in the client: browse/buy listings, sell on-chain heroes,
  and cancel, straight from the contracts via viem
- ✅ Original procedural pixel art (code-generated placeholder set, artist-ready texture keys)
- ⏭ Phase 5 — final art (artist), external audit, anti-bot, Robinhood Chain testnet
  deployment, and public beta
