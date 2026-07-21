# Projeto "MinerBlast" (codinome) — Jogo P2E para Robinhood Chain

Jogo play-to-earn inspirado nas mecânicas do gênero *bomber mining* (popularizado pelo BombCrypto),
construído do zero para a **Robinhood Chain** (L2 EVM baseada em Arbitrum Orbit).

> **Aviso de propriedade intelectual:** este projeto replica *mecânicas de jogo* (que não são
> protegidas por copyright), mas **não** utiliza nome, marca, arte, sprites, sons ou textos do
> BombCrypto original — todos os assets e a identidade visual serão originais. "MinerBlast" é um
> codinome de trabalho; o nome final passará por verificação de marca.

## Documentação

- [Plano de Desenvolvimento](docs/PLANO_DESENVOLVIMENTO.md) — visão completa: mecânicas, arquitetura, contratos, tokenomics, fases e riscos.

## Estrutura planejada do monorepo

```
contracts/   # Smart contracts Solidity (Foundry)
client/      # Cliente do jogo (Phaser 3 + TypeScript + Vite)
server/      # Backend autoritativo (NestJS + PostgreSQL + Redis)
indexer/     # Indexação de eventos on-chain
docs/        # Documentação e game design
```

## Status

📋 Fase de planejamento — ver o plano de desenvolvimento para o roadmap completo.
