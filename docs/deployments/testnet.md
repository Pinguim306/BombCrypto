# Robinhood Chain Testnet Deployment

Deployed on 2026-07-21 from commit `b63761c`.

## Network

| | |
|---|---|
| Network | Robinhood Chain Testnet |
| RPC URL | `https://rpc.testnet.chain.robinhood.com/rpc` |
| Chain ID | `46630` |
| Currency | ETH |

## Contract addresses

| Contract | Address |
|---|---|
| BlastToken | `0xee85422b82BC024b3FA520f02Ce36fda63e16B65` |
| Heroes | `0xC12CcC2d6454ad07aAC2F312b6c23893C4fFAe67` |
| Gacha | `0x59B4d40c9d27169B6F4b55F065f909414357fA2a` |
| RewardVault | `0xD6E710DA33D927686cC3cdB53387bA4acb795E1b` |
| Houses | `0x713Bb15aF24BEC45E38E6205e2bFBd0c59087D4E` |
| HeroUpgrade | `0x7af63224592c084Dcd4961F2b77854822F211A8b` |
| Staking | `0x990eabfa61C31e494b982da4662b1812d9c2a3d5` |
| Marketplace | `0x407ea31503a7d7C7eF0E633b499E3d3C828fEfCb` |

Admin/treasury/signer (test only): `0x35Cd3B0e29a6B8739c065Ec2da668272EFbCd7DE`

## Roles configured

- Gacha has `MINTER_ROLE` on Heroes
- HeroUpgrade has `UPGRADER_ROLE` on Heroes
- RewardVault has `MINTER_ROLE` on BlastToken
- The admin address has `SIGNER_ROLE` on RewardVault (test setup — production uses a
  dedicated KMS-held key)

## Smoke test (passed)

Full on-chain gacha flow executed via `contracts/script/smoke-testnet.ts`:
approve 100 BLAST → buyChest (50 BLAST burned, 50 to treasury) → wait for the
reveal block → openChest → **Hero #1 minted** (Common, power 18, speed 15,
stamina 38, range 1, bombs 2).

## Arbitrum/Orbit gotcha (important)

Inside contracts, `block.number` and `blockhash()` refer to **L1 block numbers**
(Arbitrum semantics), while the RPC reports L2 block numbers. Implications:

- The Gacha reveal delay of 2 blocks ≈ 2 L1 blocks (~24s), and the 256-block
  reveal window ≈ ~51 minutes.
- Off-chain code must never compare RPC block numbers against contract-stored
  ones; poll with a static call instead (see `smoke-testnet.ts`).

## Server / client configuration

Server (`server/.env`):

```
CHAIN_ID=46630
RPC_URL=https://rpc.testnet.chain.robinhood.com/rpc
VAULT_ADDRESS=0xD6E710DA33D927686cC3cdB53387bA4acb795E1b
HEROES_ADDRESS=0xC12CcC2d6454ad07aAC2F312b6c23893C4fFAe67
HOUSES_ADDRESS=0x713Bb15aF24BEC45E38E6205e2bFBd0c59087D4E
SIGNER_KEY=<key with SIGNER_ROLE — never commit>
NODE_USE_ENV_PROXY=1   # only needed behind an env proxy
```

Client (`client/.env`):

```
VITE_CHAIN_ID=46630
VITE_RPC_URL=https://rpc.testnet.chain.robinhood.com/rpc
VITE_TOKEN_ADDRESS=0xee85422b82BC024b3FA520f02Ce36fda63e16B65
VITE_VAULT_ADDRESS=0xD6E710DA33D927686cC3cdB53387bA4acb795E1b
VITE_MARKET_ADDRESS=0x407ea31503a7d7C7eF0E633b499E3d3C828fEfCb
VITE_HEROES_ADDRESS=0xC12CcC2d6454ad07aAC2F312b6c23893C4fFAe67
VITE_HOUSES_ADDRESS=0x713Bb15aF24BEC45E38E6205e2bFBd0c59087D4E
```

Indexer (`indexer` env): `RPC_URL`, `VAULT_ADDRESS`, `HEROES_ADDRESS`,
`MARKET_ADDRESS` as above.
