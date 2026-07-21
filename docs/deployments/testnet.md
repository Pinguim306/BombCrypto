# Robinhood Chain Testnet Deployment (v2 — launchpad economy)

Deployed on 2026-07-21. Supersedes the v1 deployment (which used a mintable
token); v2 reflects the production economy: BLAST issued externally
(launchpad), pre-funded reward vault, and dead-address burns.

## Network

| | |
|---|---|
| Network | Robinhood Chain Testnet |
| RPC URL | `https://rpc.testnet.chain.robinhood.com/rpc` |
| Chain ID | `46630` |
| Currency | ETH |

## Contract addresses (v2)

| Contract | Address |
|---|---|
| BlastToken (dev stand-in, 1B fixed) | `0xc18aA7B1e455d7694319F5578844107104619787` |
| Heroes | `0x3DfF06CAFaD28459c694eEf39Fc5a96d137e6387` |
| Gacha (ETH-priced, v2) | `0x0B69B0D6d294560c95a29727FD9674029Ac5da78` |
| RewardVault (pre-funded) | `0x612B9718efB3e3760e9868b2eaf8F50A2c4F372C` |
| Houses | `0xd93506b0A2176a08158E5D088F2535adada41364` |
| HeroUpgrade | `0x3f1209c82f65127F4Cb0Ed998683DE60486d8432` |
| Staking | `0x83ECE78224b1E20662394C68E17582C4d3aeA586` |
| Marketplace | `0x812f08AA82D284a7D4353D63089EAC1B4712c268` |

Admin/treasury/signer (test only): `0x35Cd3B0e29a6B8739c065Ec2da668272EFbCd7DE`

## Economy model (production = launchpad)

- **BLAST is issued by the launchpad (ponsfamily.com)** with a fixed supply of
  1 billion. On mainnet, pass its address via `TOKEN_ADDRESS` to the deploy
  script — no game contract can ever mint it.
- **RewardVault is pre-funded**: the project buys a share of the supply and
  deposits it via `vault.fund()`; launchpad **creator fees** keep topping it
  up. Claims are paid by transfer from this balance. Vault runway =
  `vaultBalance / daily payouts` — monitor it.
- **Burns are dead-address transfers** (`0x…dEaD`) so any standard ERC-20
  works: gacha 50%, house purchases 50%, upgrade fees 100%, half of the 4%
  marketplace fee.

## Gacha pricing (ETH) and reward scaling

- Chest: **0.005 ETH**; promo pack: **10 chests for 0.04 ETH** (20% off).
  All ETH is forwarded to the treasury (used to buy BLAST back / fund the
  vault). Admin-tunable via `setPrices`.
- In-game rewards run at **7.5x the original rate** (5x for the ETH-pricing
  shift, then +50%): mining pays 0.15 BLAST per HP and adventure stages pay
  18.75 / 52.5 / 135 BLAST base. Final calibration after TGE.
- The old BLAST-priced gacha (`0x74F8...Bb85`) had its MINTER_ROLE revoked.

## Withdrawal (claim) rules

On-chain in the vault and mirrored by the server (`MIN_CLAIM_BLAST`,
`CLAIM_COOLDOWN_HOURS` — the pairs must match):

| Setting | Testnet beta | Production recommendation |
|---|---|---|
| Minimum per withdrawal | 750 BLAST | **60,000 BLAST** (owner's target +50%; ~2-3 days at current rates) |
| Cooldown between withdrawals | 1 h | **24 h** |
| Global daily payout cap | 500,000 BLAST | tune from beta data |

At current rates a starter team earns roughly 750–1,100 BLAST/hour of
active play, keeping the 60,000 production target reachable in ~2–3 days
of engaged play. It remains a one-transaction admin change (`setMinClaim`).

## Verified on-chain (v2)

- ETH gacha flow: chest bought for **0.005 ETH** (forwarded to the
  treasury), Hero #2 minted (Common, power 16, speed 17, stamina 28).
- Vault funded with 45,000,000 BLAST at deploy.
- Claim of 2.36 BLAST paid **from the vault balance** (no minting):
  tx `0x1cf6423079edbf3e7d4df8e7e02eb00431ba7a90bbb1fa02b6e9287c9ba78862`;
  vault balance moved 45,000,000 → 44,999,997.64.
- Beta limits left active: minClaim 750 BLAST, cooldown 3600s.

## Arbitrum/Orbit gotcha (important)

Inside contracts, `block.number` and `blockhash()` refer to **L1 block
numbers**, while the RPC reports L2 block numbers. The Gacha reveal delay of
2 blocks ≈ ~24s and the 256-block reveal window ≈ ~51 min. Off-chain code
must poll with a static call instead of comparing RPC block numbers (see
`contracts/script/smoke-testnet.ts`).

## Server / client configuration

Server (`server/.env`):

```
CHAIN_ID=46630
RPC_URL=https://rpc.testnet.chain.robinhood.com/rpc
VAULT_ADDRESS=0x612B9718efB3e3760e9868b2eaf8F50A2c4F372C
HEROES_ADDRESS=0x3DfF06CAFaD28459c694eEf39Fc5a96d137e6387
HOUSES_ADDRESS=0xd93506b0A2176a08158E5D088F2535adada41364
SIGNER_KEY=<key with SIGNER_ROLE — never commit>
MIN_CLAIM_BLAST=750
CLAIM_COOLDOWN_HOURS=1
NODE_USE_ENV_PROXY=1   # only needed behind an env proxy
```

Client (`client/.env`):

```
VITE_CHAIN_ID=46630
VITE_RPC_URL=https://rpc.testnet.chain.robinhood.com/rpc
VITE_TOKEN_ADDRESS=0xc18aA7B1e455d7694319F5578844107104619787
VITE_VAULT_ADDRESS=0x612B9718efB3e3760e9868b2eaf8F50A2c4F372C
VITE_MARKET_ADDRESS=0x812f08AA82D284a7D4353D63089EAC1B4712c268
VITE_HEROES_ADDRESS=0x3DfF06CAFaD28459c694eEf39Fc5a96d137e6387
VITE_HOUSES_ADDRESS=0xd93506b0A2176a08158E5D088F2535adada41364
VITE_GACHA_ADDRESS=0x0B69B0D6d294560c95a29727FD9674029Ac5da78
```

Indexer env: `RPC_URL`, `VAULT_ADDRESS`, `HEROES_ADDRESS`, `MARKET_ADDRESS`
as above.
