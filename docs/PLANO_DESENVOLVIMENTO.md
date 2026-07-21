# Plano de Desenvolvimento — Projeto "MinerBlast" (codinome)

Jogo play-to-earn no estilo *bomber mining*, inspirado nas mecânicas do BombCrypto,
construído para a **Robinhood Chain**.

---

## 1. Escopo e posicionamento legal

**O que replicamos:** as mecânicas e sistemas do jogo (mineração idle com heróis, stamina,
raridades, modos de jogo, economia de token/NFT). Mecânicas de jogo não são protegidas por
copyright.

**O que NÃO replicamos:** nome, logotipo, arte, sprites, animações, sons, música, textos do
whitepaper e identidade visual do BombCrypto — tudo isso é propriedade da Senspark e será
substituído por assets 100% originais. O código também será escrito do zero (o GitHub da
Senspark serve apenas como referência de arquitetura pública, não como fonte de código).

**Nome:** "MinerBlast" é codinome de trabalho. Antes do lançamento: pesquisa de
disponibilidade de marca e domínio. Evitar qualquer nome que remeta a "Bomb Crypto" ou
"Robinhood" (a marca da chain pertence à Robinhood Markets — usar apenas como referência
factual de plataforma, ex.: "built on Robinhood Chain", conforme diretrizes de marca deles).

---

## 2. A plataforma: Robinhood Chain

| Item | Situação (jul/2026) |
|---|---|
| Tecnologia | L2 Ethereum baseada em **Arbitrum Orbit / Nitro** — totalmente **EVM-compatível** |
| Testnet pública | No ar desde **10/02/2026** (4M+ transações na primeira semana) |
| Mainnet | Previsto para **o final de 2026** (fase 2 do rollout) |
| Infra parceira | Alchemy, Chainlink, LayerZero, Allium, TRM |
| Ecossistema | Robinhood patrocina buildathons Arbitrum Open House 2026 (US$ 1M) |

**Implicações para o projeto:**
- EVM-compatível → Solidity + tooling padrão (Foundry, viem/wagmi) funciona sem adaptação.
- Desenvolvemos e lançamos **primeiro na testnet** (beta pública), migrando ao mainnet no lançamento.
- Chainlink presente na chain → podemos usar **VRF** para aleatoriedade de gacha/chests (com
  fallback commit-reveal caso VRF não esteja disponível na testnet no início).
- Foco da chain em RWA/finanças → um jogo é diferencial no ecossistema; vale inscrever o
  projeto nos buildathons do Arbitrum Open House para visibilidade e grants.

---

## 3. Game Design — mecânicas de referência

Sistemas equivalentes aos do jogo original, com nomes e números próprios:

### 3.1 Heróis (NFT ERC-721)
- **Atributos:** Poder (dano de mineração), Velocidade (intervalo entre bombas), Stamina
  (energia máxima), Alcance da explosão, Nº de bombas simultâneas, e habilidades especiais
  sorteadas (ex.: caminhar por blocos, bônus em baús, escudo, cura).
- **Raridades (6 níveis):** Comum, Raro, Super Raro, Épico, Lendário, Mítico — cada nível
  com faixas de atributos e multiplicador de recompensa maiores.
- **Nível/Upgrade:** fusão de heróis + token para subir nível (queima de supply, sink importante).
- **Aquisição:** compra de baús (gacha) com o token do jogo; probabilidades públicas on-chain.

### 3.2 Modos de jogo
1. **Mineração do Tesouro** (modo principal, idle): o jogador posiciona até 15 heróis num
   mapa de blocos; eles mineram automaticamente, gastando stamina. Blocos escondem
   recompensas (token, fragmentos de baú, chaves). Funciona com o cliente fechado
   (simulação server-side).
2. **Aventura** (ativo, estilo bomber clássico): fases com inimigos, obstáculos e chefes;
   custo de entrada em chaves; recompensas maiores.
3. **Arena PVP** (fase posterior): partidas 1v1 com apostas de token e ranking por temporada.
4. **Eventos/temporadas:** mapas especiais, chefes mundiais, missões diárias (retenção).

### 3.3 Stamina e Casas (NFT)
- Herói minerando gasta stamina; ao zerar, precisa descansar.
- **Casas (ERC-721):** aceleram a recuperação de stamina; capacidade e velocidade variam
  por raridade da casa. Compradas com token ou no marketplace.

### 3.4 Economia
- **Token do jogo (ERC-20)** — codinome `$BLAST`: ganho minerando/jogando; gasto em baús,
  upgrades, casas, entradas de PVP e taxas.
- **Sinks (queima/travamento):** parte das taxas de gacha, upgrade e marketplace é queimada;
  staking com lock para reduzir pressão vendedora.
- **Faucets controlados:** emissão diária de recompensas limitada por pool com decaimento
  (evitar hiperinflação — principal causa de morte de jogos P2E).
- **Marketplace:** compra/venda de heróis e casas com taxa (ex.: 4% — metade queimada,
  metade para tesouraria).
- **Claim de recompensas:** ganhos acumulam off-chain no servidor; o jogador faz *claim*
  on-chain com voucher assinado (EIP-712) pelo servidor — barato, seguro e anti-bot.

### 3.5 Tokenomics (esboço inicial — refinar com simulação)
| Alocação | % |
|---|---|
| Recompensas de jogo (emissão em 5+ anos, com decaimento) | 45% |
| Tesouraria / ecossistema | 20% |
| Equipe (vesting 3 anos, cliff 1 ano) | 15% |
| Liquidez (DEX na Robinhood Chain) | 10% |
| Marketing / parcerias / airdrops | 10% |

---

## 4. Arquitetura técnica

```
┌─────────────┐   WebSocket/REST   ┌──────────────────┐
│  Cliente     │◄──────────────────►│  Servidor do jogo │
│  Phaser 3    │                    │  (autoritativo)   │
│  + wagmi     │                    │  NestJS+PG+Redis  │
└──────┬──────┘                    └────────┬─────────┘
       │ tx (mint, claim,                    │ assina vouchers EIP-712
       │ marketplace)                        │ lê eventos (indexer)
       ▼                                     ▼
┌──────────────────────────────────────────────────────┐
│           Robinhood Chain (testnet → mainnet)         │
│  Token │ Heroes │ Houses │ Gacha │ Vault │ Market     │
└──────────────────────────────────────────────────────┘
```

### 4.1 Smart contracts (Solidity 0.8.x + Foundry + OpenZeppelin)
| Contrato | Padrão | Função |
|---|---|---|
| `BlastToken` | ERC-20 | Token do jogo; mint restrito ao `RewardVault`; burnable |
| `Heroes` | ERC-721 | Heróis; atributos em struct on-chain packed; mint via `Gacha` |
| `Houses` | ERC-721 | Casas de recuperação de stamina |
| `Gacha` | — | Venda de baús; aleatoriedade via Chainlink VRF (fallback commit-reveal); probabilidades públicas |
| `RewardVault` | — | Claim de recompensas com voucher EIP-712 assinado pelo servidor; nonce anti-replay; limites diários |
| `Marketplace` | — | Listagem/venda de NFTs; taxa configurável; proteção contra reentrância |
| `Staking` | — | Lock de token com recompensas; multiplicadores in-game para stakers |
| `HeroUpgrade` | — | Fusão/queima de heróis + token para subir nível |

Princípios: contratos mínimos e auditáveis; parâmetros ajustáveis via timelock + multisig;
sem upgradability nos contratos de ativos (token/NFT), upgradable com transparência apenas
na camada de lógica (Gacha/Vault) se necessário.

### 4.2 Cliente (jogo)
- **Phaser 3 + TypeScript + Vite** — jogo 2D web (desktop + mobile browser); é o mesmo perfil
  técnico do original (Cocos2d web) e permite iteração rápida.
- **Carteira:** wagmi/viem + WalletConnect; login por SIWE (Sign-In with Ethereum).
- Arte original em pixel art (contratar artista ou gerar base própria) — estilo definido no
  media kit *próprio* do projeto.

### 4.3 Servidor autoritativo (anti-cheat)
- **NestJS (Node/TS) + PostgreSQL + Redis**; WebSocket para o estado da mineração.
- Toda a simulação de mineração/combate roda **no servidor**; o cliente apenas renderiza.
  (Lição do P2E: cliente nunca decide recompensa.)
- Serviço de assinatura de vouchers (chave em KMS/HSM), limites de claim por conta/dia,
  detecção de bots (fingerprint, rate limit, análise de padrões).

### 4.4 Indexação e infra
- Indexer de eventos (Ponder ou subgraph, conforme suporte da chain; Alchemy está na chain).
- Deploy: Docker + IaC; testnet RPC via Alchemy.
- CI: build + testes de contratos (forge test, cobertura, slither) + testes do servidor.

---

## 5. Fases de desenvolvimento

### Fase 0 — Fundações (1–2 semanas)
- Monorepo (pnpm workspaces), CI, ambientes; acesso ao RPC da testnet Robinhood Chain.
- Game Design Document detalhado com balanceamento numérico (planilha de economia).
- **Entrega:** repo estruturado + GDD + simulação de economia em planilha/script.

### Fase 1 — Contratos core (2–3 semanas)
- `BlastToken`, `Heroes`, `Gacha`, `RewardVault`; testes forge com cobertura >90%; fuzzing.
- Deploy na testnet da Robinhood Chain + scripts de deploy reproduzíveis.
- **Entrega:** contratos na testnet, verificados, com testes.

### Fase 2 — Loop principal jogável (3–4 semanas)
- Cliente Phaser: tela de mineração, seleção de heróis, HUD de stamina/recompensas.
- Servidor: simulação da mineração, persistência, WebSocket, SIWE.
- Integração: comprar baú → mintar herói → minerar → acumular → claim on-chain.
- **Entrega:** *vertical slice* jogável ponta a ponta na testnet.

### Fase 3 — Economia completa (2–3 semanas)
- Casas + recuperação de stamina; upgrade/fusão de heróis; staking; missões diárias.
- Painel interno de métricas econômicas (emissão, queima, DAU).
- **Entrega:** loop econômico completo com sinks e faucets ativos.

### Fase 4 — Marketplace e modo Aventura (3–4 semanas)
- Marketplace on-chain + UI; modo Aventura (fases, inimigos, chefes).
- **Entrega:** beta pública na testnet (aproveitar visibilidade dos buildathons Arbitrum/Robinhood).

### Fase 5 — Hardening e auditoria (3–4 semanas, paralelo ao beta)
- Auditoria externa dos contratos; bug bounty; testes de carga do servidor; anti-bot.
- Ajustes de balanceamento com dados reais do beta.
- **Entrega:** relatório de auditoria + correções.

### Fase 6 — Lançamento mainnet (quando o mainnet da chain abrir, fim de 2026)
- TGE do token + liquidez em DEX da chain; migração/snapshot do beta (decidir se progresso
  do testnet vira airdrop); PVP e temporadas pós-lançamento.

**Total estimado até beta público: ~3–4 meses; mainnet alinhado ao lançamento da chain.**

---

## 6. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Espiral deflacionária de P2E** (token só cai) | Emissão com decaimento, sinks fortes, foco em diversão antes de rendimento, simulação econômica desde a Fase 0 |
| Mainnet da chain atrasar | Beta roda em testnet; plano B: lançar em Arbitrum One e migrar via bridge |
| VRF indisponível na testnet | Commit-reveal como fallback já implementado |
| Bots drenando recompensas | Servidor autoritativo, limites de claim, detecção comportamental, custo de entrada (gacha) |
| Confusão de marca (Senspark/Robinhood) | Nome, arte e textos 100% originais; revisão jurídica antes do lançamento |
| Exploit em contrato | Auditoria externa, fuzzing, bounty, timelock+multisig, limites de mint no Vault |

---

## 7. Questões em aberto (decidir antes da Fase 1)

1. Nome definitivo e identidade visual (contratar artista para o media kit próprio).
2. Um token ou dois (recompensa + governança)? Recomendação inicial: **um só**, simplifica economia.
3. Progresso do beta testnet: reset total, airdrop proporcional, ou migração 1:1?
4. Orçamento para auditoria (referência: US$ 15–40k para o escopo listado).
5. Participar dos buildathons Arbitrum Open House 2026 (inscrição, prazos).
