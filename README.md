# Projeto "MinerBlast" (codinome) — Jogo P2E para Robinhood Chain

Jogo play-to-earn inspirado nas mecânicas do gênero *bomber mining* (popularizado pelo BombCrypto),
construído do zero para a **Robinhood Chain** (L2 EVM baseada em Arbitrum Orbit).

> **Aviso de propriedade intelectual:** este projeto replica *mecânicas de jogo* (que não são
> protegidas por copyright), mas **não** utiliza nome, marca, arte, sprites, sons ou textos do
> BombCrypto original — todos os assets e a identidade visual serão originais. "MinerBlast" é um
> codinome de trabalho; o nome final passará por verificação de marca.

## Documentação

- [Plano de Desenvolvimento](docs/PLANO_DESENVOLVIMENTO.md) — visão completa: mecânicas, arquitetura, contratos, tokenomics, fases e riscos.

## Estrutura do monorepo

```
contracts/   # Smart contracts Solidity (Hardhat + OpenZeppelin)
client/      # Cliente do jogo (Phaser 3 + TypeScript + Vite)
server/      # Backend autoritativo (NestJS, simulação server-side)
indexer/     # Indexação de eventos on-chain (Fase 3)
docs/        # Documentação e game design
```

## Como rodar (dev)

```bash
pnpm install

# contratos: compilar e testar
pnpm --filter @minerblast/contracts test

# servidor (porta 3000)
pnpm --filter @minerblast/server build && pnpm --filter @minerblast/server start

# cliente (porta 5173)
pnpm --filter @minerblast/client dev
```

Fluxo do vertical slice: conectar carteira → login SIWE → heróis de dev mineram
no servidor (simulação autoritativa) → saldo pendente acumula → "Sacar BLAST"
emite voucher EIP-712 → transação `claim` no RewardVault minta o token.

Variáveis de ambiente: ver `contracts/.env.example` e `server/.env.example`.

## Status

- ✅ Fase 0/1 — plano, monorepo e contratos core (BLAST, Heroes, Gacha, RewardVault) com testes
- ✅ Fase 2 — loop principal jogável: motor de mineração server-side, auth SIWE, vouchers EIP-712 e cliente Phaser
- ✅ Fase 3 — economia completa: contratos Houses/HeroUpgrade/Staking, persistência SQLite,
  casas acelerando regeneração, reconciliação de vouchers, sync on-chain de heróis e métricas admin
- ✅ Fase 4 — Marketplace on-chain com escrow e taxa (4%, metade queimada), modo Aventura
  com 3 estágios e limite diário, indexer de eventos e UI de aventura no cliente
- ⏭ Fase 5 — arte original (artista), auditoria externa, anti-bot, deploy na testnet da
  Robinhood Chain e beta público
