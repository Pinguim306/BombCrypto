# pons Launchpad Integration — $BLAST TGE Reference

$BLAST launches on [pons](https://ponsfamily.com/launchpad) (docs:
<https://docs.ponsfamily.com/>). This file condenses everything MinerBlast
needs from their documentation, verified against the chain on 2026-07-21.

## Network (Robinhood Chain MAINNET — live)

| | |
|---|---|
| Chain ID | **4663** (`0x1237` — verified via `eth_chainId`) |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | <https://robinhoodchain.blockscout.com> |
| Native asset | ETH |
| WETH (quote token) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |

## pons contracts (all on Robinhood Chain mainnet)

| Contract | Address | Notes |
|---|---|---|
| Active Factory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` | launches from block 8991118 |
| Active Locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` | fee custody for current launches |
| Legacy Factory | `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` | from block 8600612 |
| Legacy Locker | `0x31ca5E101941A93A7DD6d0497928700625CF54B5` | |
| Uniswap V3 Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | |
| Position Manager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` | |
| Swap Router | `0xCaf681a66D020601342297493863E78C959E5cb2` | |
| Quoter V2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | |
| PONS reference token | `0x39dBED3a2bd333467115dE45665cC57F813C4571` | graduated token for validating integrations |

## How a pons launch works

- One transaction mints a **fixed 1,000,000,000 supply**, creates a
  Uniswap V3 pool against WETH (1% fee tier) with **locked liquidity**, and
  opens trading immediately — **no bonding curve**. Launch fee: 0.0005 ETH.
- Creator sets name, symbol, logo, description, socials and the **fee
  recipient wallet** at creation.
- **Anti-snipe window**: on the launch block only the creator's atomic
  initial buy executes; for the rest of the short restriction window each
  wallet is capped at **5% of supply held** and **5.5% cumulative pool
  buys**. Sells and wallet-to-wallet transfers are never restricted; all
  limits vanish when the window ends.
- **Graduation** is cosmetic: it marks 4.2 WETH of paired principal
  (`graduationStatus(token)` → `(pairedPrincipal, threshold, graduated)`).
  Trading continues in the same pool.

## Token contract compatibility (VERIFIED — no game changes needed)

The verified source of `PonsLauncherToken` (Blockscout, compiler 0.8.30) is
a plain OpenZeppelin ERC-20:

- Whole supply minted **once in the constructor**; no mint function after.
- **No transfer tax / fee-on-transfer, no blacklist, no pause, no owner.**
- The only custom logic is the launch-window cap on *pool buys*
  (`_update` checks `block.number <= restrictionEndBlock`); afterwards the
  token "behaves as a plain ERC-20" (their words, and the code agrees).
- Extra read functions: `logo()`, `description()`, `socials()`,
  `liquidityPool()`, `getTokenInfo()`, `maxWalletLimit()`, `maxTxLimit()`.

Consequences for MinerBlast: **RewardVault, Marketplace, Houses, Staking
and HeroUpgrade work unchanged** (transfer amounts arrive exactly as sent;
`safeTransfer` semantics hold). The launch-guide question "fee-on-transfer
or blacklist mechanics?" is answered: none.

## Creator fees (the vault top-up engine)

- Pool fee is 1%; the creator/protocol split is **snapshotted at launch
  and never changes**. Current factory: **70% creator / 30% protocol**.
- Fees accrue (in $BLAST and WETH) inside the token's locked position.
  The creator can claim any time via the pons interface; unclaimed fees
  may be auto-claimed by pons automation and routed to the payout wallet.
- `locker.feeRedirects(token)` returns the payout wallet override —
  request a redirect to point payouts at the **treasury Safe** instead of
  the deployer hot wallet.
- `locker.tokenProtocolFeeShares(token)` returns the protocol share in
  effect for the token.

## Integration hooks (indexer / future UI)

- `TokenLaunched` event, active factory, topic
  `0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a`
  (token, deployer, pool, restrictions end block).
- Uniswap V3 `Swap` event on the token's pool, topic
  `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`;
  buy/sell side from the sign of the paired-token amount.
- `factory.getLaunchedToken(token)` →
  `(isToken0, pairedToken, poolFee, supply, restrictionsEndBlock)`.
- Live price: pool `slot0().sqrtPriceX96` → `ratio = sqrtPriceX96 / 2^96`,
  `token1PerToken0 = ratio²`, invert if $BLAST is not token0 — usable
  later for a "$BLAST price" chip in the site header.

## $BLAST launch playbook on pons

1. Create the token at `ponsfamily.com/launchpad/create` (0.0005 ETH fee)
   with the final name/symbol/logo/socials and the treasury as fee
   recipient. The address it deploys **is the mainnet `TOKEN_ADDRESS`**
   for our contract deploy and `VITE_BLAST_CA` for the site header.
2. Use the **creator's atomic initial buy** in the launch transaction to
   secure the first tranche of the rewards-vault allocation (the launch
   block is creator-only; caps of 5% per wallet / 5.5% total apply for
   the rest of the window).
3. After the restriction window, continue buying the remaining vault
   allocation **in tranches** (each buy walks the V3 curve up — spreading
   purchases limits the average entry price).
4. `blast.approve(vault, X)` + `vault.fund(X)` from the treasury; size X
   for months of runway at the daily cap, per the launch guide.
5. Creator fees (70% of the pool's 1%) become the vault's ongoing top-up:
   claim via pons UI (or automation) → treasury → `vault.fund()`.

## Attribution rules (from their terms)

Write "pons" in lowercase with a link to the app; do not imply
partnership, endorsement or official status without a written agreement;
their public infrastructure has no availability guarantee.
