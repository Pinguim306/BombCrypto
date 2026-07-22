# Robinhood Chain MAINNET Deployment (production)

Deployed 2026-07-22. This is the live production environment.

## Network

| | |
|---|---|
| Network | Robinhood Chain (mainnet) |
| RPC URL | `https://rpc.mainnet.chain.robinhood.com` |
| Chain ID | `4663` |
| Explorer | <https://robinhoodchain.blockscout.com> |

## Contract addresses

| Contract | Address |
|---|---|
| **$BLAST (pons launchpad)** | `0xda0a11c09ac6d95ce6677c8eb5972ff13d4c9b3f` |
| Heroes | `0x10413d00F51672F71AACE3852ad816Ff19552623` |
| **Gacha v2 (ETH-priced + referrals, LIVE)** | `0xe76C420e3C5190d88483D992D6123346b7a05803` |
| Gacha v1 (ETH-priced, retired — MINTER revoked) | `0xE941C5972d5ECaf4528C26cA3012B095F215618d` |
| RewardVault | `0x6161BFd8e0180427a5Caa24257F285b109806CCf` |
| Houses | `0x0d1da4Cdc6ED4878F813c40F29F162458dfDF3f9` |
| HeroUpgrade | `0x0B2eEd0e5cDd161029178A7b1D2aE287d8987ac3` |
| Staking | `0xde03aA6c7A7c4FB0E36A9530a89961fdA8d86bb4` |
| Marketplace | `0x9fbB9f44838ef1eCE68f7eD7F70171A80007CcD6` |

## Wallets and roles

- **Admin (DEFAULT_ADMIN_ROLE on all 6 managed contracts)**: the owner
  wallet — deployer admin was renounced in the go-live transaction batch.
- **Treasury** (chest ETH + market fees): the owner wallet.
- **Voucher signer** (`SIGNER_ROLE` on the vault only): the deploy key,
  stored solely in the game server's environment. Damage from a leak is
  bounded by the on-chain daily cap; rotatable by the admin wallet.

## Economy (on-chain, admin-tunable)

| Setting | Value |
|---|---|
| Chest / 10-pack | 0.005 ETH / 0.04 ETH |
| Minimum withdrawal | 30,000 BLAST |
| Claim cooldown | 24 h |
| Global daily payout cap | 1,000,000 BLAST |
| House prices | 200 / 500 / 1,200 / 3,000 / 8,000 / 20,000 BLAST |
| Vault funding plan | 60M BLAST day one + pons creator fees (70% of the 1% pool fee) |

## Go-live verification (real transactions)

- Chest #1 bought for 0.005 ETH:
  `0xeb1b78c05506a78f5d9978ee6453f4b51124c9e1eaaf97bd8c3cae8a5ab89b13`
- Chest #1 opened → **Hero #1 (Rare)** minted:
  `0xbe0a166ce91b47af41ba9ee485bdd9121bf8a20a732c4473ea4f2b8bdfe4cbb2`
- Chest payment confirmed in the treasury balance.

## Hosting

- Client: Vercel — <https://minerblast.fun> (env via project settings)
- Server: Railway — `minerblastserver-production.up.railway.app`
  (`MIN_CLAIM_BLAST=30000`, `CLAIM_COOLDOWN_HOURS=24` mirror the vault)
- Demo mode is disabled in production; new accounts start with 0 heroes.

## Referrals (Gacha v2, migrated 2026-07-22)

- Referrers earn **15%** (admin-tunable up to a 30% on-chain cap) of the ETH
  spent by players they invite, paid in the same purchase tx. Bind-once,
  self-referral pays nothing, push payout with a `claimReferral` pull
  fallback. Contract admin: the owner wallet.
- Migration: GachaV2 deployed, owner granted `MINTER_ROLE` to it on Heroes
  and revoked it from v1 (zero unopened v1 chests, so no grace window).
  `VITE_GACHA_ADDRESS` flipped to v2. v1 is retired (can still be read but
  can no longer mint).
- Player link: `minerblast.fun/?ref=<address>`; earnings page at
  `minerblast.fun/referrals.html`.
