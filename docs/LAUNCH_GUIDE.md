# MinerBlast — Launch Guide

Two stages: **A. public hosting of the testnet beta** (players can join today)
and **B. mainnet deployment** (real token, real money — gated by hardening).

---

## A. Public hosting (testnet beta)

### A.1 What needs to run

| Component | What it is | Recommended hosting |
|---|---|---|
| Game server | NestJS API (auth, mining sim, vouchers) — needs **Node 22+** (built-in `node:sqlite`) and a **persistent disk** for `minerblast.db` | Railway / Render / Fly.io (hobby tier), or a small VPS (Hetzner/DigitalOcean, ~US$5–10/mo) with systemd or PM2 |
| Game client | Static files (`client/dist` from `pnpm build`) | Cloudflare Pages / Vercel / Netlify (free tier) |
| Indexer | Long-running Node process polling chain events | Same host as the server (second process) |

The server is a single stateful process (in-memory player cache + SQLite), so
run **one instance** — no horizontal scaling yet. That is fine for a beta.

### A.2 Accounts / purchases needed

1. **Domain** (e.g. `minerblast.xyz`, ~US$10/yr) + DNS on Cloudflare (free,
   gives HTTPS + DDoS protection + caching for the client).
2. **Hosting account** for the server (Railway/Render/Fly/VPS).
3. **RPC**: the public testnet RPC works to start; an **Alchemy** key (free
   tier) is more reliable under player load — Alchemy already supports
   Robinhood Chain.
4. Optional: **UptimeRobot/BetterStack** (free) for uptime alerts, and
   **Plausible/Umami** for privacy-friendly analytics on the client.

### A.3 Keys (do this before going public)

Today the testnet uses ONE key for everything. For a public beta, split:

| Key | Purpose | Where it lives |
|---|---|---|
| Signer | Signs claim vouchers (`SIGNER_ROLE` on the vault) | Fresh wallet; only in the server host's secret store (`SIGNER_KEY`) |
| Admin | `DEFAULT_ADMIN_ROLE` on contracts (tune params) | Hardware wallet or at least a wallet never stored on servers |
| Treasury | Receives gacha ETH and marketplace fees | Separate wallet (multisig later) |

Steps: create the signer wallet → `vault.grantRole(SIGNER_ROLE, signer)` →
`vault.revokeRole(SIGNER_ROLE, oldKey)` → update `SIGNER_KEY` on the host.
Also generate a strong `JWT_SECRET` and `ADMIN_KEY` (32+ random bytes each).

### A.4 Server deployment steps

```bash
# on the host (Node 22+)
git clone <repo> && cd BombCrypto
corepack enable && pnpm install
pnpm --filter @minerblast/server build

# /home/user/BombCrypto/server/.env  (from .env.example)
#   PORT=3000
#   CORS_ORIGIN=https://app.minerblast.xyz   <- the client's domain, exactly
#   JWT_SECRET=<random>
#   ADMIN_KEY=<random>
#   SIGNER_KEY=<dedicated signer key>
#   CHAIN_ID=46630
#   RPC_URL=<testnet RPC (Alchemy recommended)>
#   VAULT_ADDRESS / HEROES_ADDRESS / HOUSES_ADDRESS = current testnet addresses
#   MIN_CLAIM_BLAST=750  CLAIM_COOLDOWN_HOURS=1   <- MUST mirror the vault
#   DATABASE_PATH=/data/minerblast.db            <- on the persistent volume

pnpm --filter @minerblast/server start   # behind systemd/PM2 + auto-restart
```

Put a reverse proxy with HTTPS in front (Caddy is the simplest: 2-line
config, automatic Let's Encrypt), e.g. `api.minerblast.xyz → localhost:3000`.

**Backups:** cron a daily copy of `minerblast.db` off the host. It holds
pending balances and issued vouchers — losing it wrongs players.

### A.5 Client deployment steps

```bash
# client/.env.production
#   VITE_SERVER_URL=https://api.minerblast.xyz
#   VITE_CHAIN_ID=46630
#   VITE_RPC_URL=<same RPC>
#   VITE_*_ADDRESS=<current testnet addresses, incl. VITE_GACHA_ADDRESS>
pnpm --filter @minerblast/client build   # deploy client/dist to Pages/Vercel
```

### A.6 Player onboarding (the beta's real bottleneck)

- Players need **testnet ETH for gas + 0.005 ETH per chest**. Provide a
  faucet path: link the official Robinhood Chain testnet faucet on the
  connect screen, or run a small drip faucet from a funded wallet
  (e.g. 0.01 ETH per new address, once).
- The wallet must have the network added — add a "Add Robinhood Chain
  Testnet" button (EIP-3085 `wallet_addEthereumChain`) to the connect
  screen; it is a ~15-line client change.
- Mobile: current login is injected-wallet only (desktop extensions). For
  mobile play, add WalletConnect later.

### A.7 Beta go-live checklist

- [ ] Dedicated signer key on the host; old key revoked from `SIGNER_ROLE`
- [ ] Strong `JWT_SECRET` / `ADMIN_KEY`; `.env` never committed
- [ ] `CORS_ORIGIN` = exact client URL
- [ ] Vault funded and `minClaim`/`CLAIM_COOLDOWN` matching server env
- [ ] Daily payout cap set to a value you can afford to lose (bot worst-case)
- [ ] SQLite on a persistent volume + daily backup
- [ ] Uptime monitor on `/auth/nonce` + a weekly look at `/admin/metrics`
      (vault runway = vault balance ÷ daily payouts)
- [ ] Faucet/onboarding path tested with a fresh wallet end to end

---

## B. Mainnet deployment

### B.1 Hard prerequisites (in order)

1. **Robinhood Chain mainnet live** (expected late 2026) — chain id, RPC and
   explorer URLs published.
2. **TGE on the launchpad (ponsfamily.com)** — the real $BLAST address.
   Confirm with the launchpad: standard ERC-20? any fee-on-transfer or
   blacklist mechanics? (fee-on-transfer would require vault/marketplace
   adjustments — check BEFORE deploying).
3. **External audit** of the 8 contracts (scope is small and stable;
   reference budget US$15–40k). Fix findings, re-test, publish the report.
4. **Wallet architecture:**
   - Admin: **Safe multisig** (2/3 or 3/5) — receives `DEFAULT_ADMIN_ROLE`
     on every contract after deployment; deployer renounces.
   - Treasury: second Safe (gacha ETH + fees + creator fees).
   - Signer: hot key in a KMS/secret manager, only `SIGNER_ROLE`.
5. **Gacha randomness**: migrate commit-reveal → **Chainlink VRF** (Chainlink
   is a Robinhood Chain partner). Commit-reveal is acceptable for testnet
   only; with real money, sequencer-adjacent actors shouldn't be trusted.
6. **Server data**: migrate SQLite → **PostgreSQL** (the persistence layer is
   already isolated behind one service class) and move the host to a plan
   with real CPU/RAM + log retention. Add rate limiting and basic bot
   heuristics before real yield exists.
7. **Legal**: trademark check for the final name, Terms of Service +
   gacha-odds disclosure (published odds are already on-chain — link them),
   and a jurisdiction review for P2E/gacha rules in target markets.

### B.2 Deployment sequence (runbook)

```bash
# 1. deploy game contracts pointing at the REAL token
TOKEN_ADDRESS=<launchpad BLAST> \
MIN_CLAIM=60000 CLAIM_COOLDOWN_S=86400 DAILY_MINT_CAP=<affordable> \
CHEST_PRICE_ETH=0.005 PACK_PRICE_ETH=0.04 PACK_SIZE=10 \
TREASURY=<treasury Safe> \
npx hardhat run script/deploy.ts --network robinhoodMainnet

# 2. verify all contracts on the explorer (source + args)

# 3. roles
#    - vault.grantRole(SIGNER_ROLE, <KMS signer>)
#    - every contract: grantRole(DEFAULT_ADMIN_ROLE, <admin Safe>)
#                      renounceRole(DEFAULT_ADMIN_ROLE, deployer)

# 4. fund the vault: buy the supply share on the launchpad, then
#    blast.approve(vault, X) + vault.fund(X) from the treasury Safe
#    (size X for months of runway at the daily cap, not the whole share)

# 5. point server + client envs at mainnet addresses; fresh database
#    (testnet progress does not migrate — announce this in advance)
#    Client on Vercel: root dir client/, build "pnpm build", output dist/;
#    set env vars and REDEPLOY (they are baked into the build):
#      VITE_NETWORK_NAME="Robinhood Chain Mainnet"
#      VITE_CHAIN_ID / VITE_RPC_URL = mainnet params
#      VITE_BLAST_CA = official launchpad $BLAST address
#      VITE_TOKEN/VAULT/GACHA/HEROES/HOUSES/MARKET_ADDRESS = mainnet deploy
#      VITE_SERVER_URL = https://api.<domain>
#    Server env: MIN_CLAIM_BLAST=60000, CLAIM_COOLDOWN_HOURS=24 (mirror the
#    vault), SIGNER_KEY from the secret manager, fresh JWT_SECRET/ADMIN_KEY

# 6. dry run with the team: buy chest -> mine -> adventure -> claim ->
#    marketplace list/buy, all with real transactions, before announcing
```

### B.3 Launch-day / post-launch operations

- **Watch vault runway daily** (`/admin/metrics`): balance ÷ payouts. Top up
  from creator fees; if runway shrinks fast, lower the daily cap first,
  investigate second.
- Watch emissions vs. burns (dead-address balance is public) and gacha
  revenue vs. rewards paid — the loop only sustains if ETH revenue +
  creator fees ≥ vault outflow at the price players sell at.
- Keep `setMinClaim`/`setChestPrice`/`setPrices` adjustments **small and
  announced** — silent nerfs destroy P2E communities faster than bugs.
- Incident plan: signer key leak → revoke `SIGNER_ROLE` (one tx) and the
  daily cap already bounds the damage; server down → mining state is
  lazy-simulated, so downtime does not lose player progress.

### B.4 Rough cost summary

| Item | One-off | Recurring |
|---|---|---|
| Domain | — | ~US$10/yr |
| Beta hosting (server+client) | — | US$0–15/mo |
| Production hosting (Postgres, bigger host) | — | US$30–80/mo |
| RPC (Alchemy growth tier, if needed) | — | US$0–50/mo |
| External audit | US$15–40k | — |
| Bug bounty pool | US$5–20k (optional but recommended) | — |
| Vault funding | your chosen % of supply at TGE | creator fees top-ups |
