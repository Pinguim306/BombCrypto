import { ethers } from "hardhat";
import { writeFileSync } from "fs";

// One-shot production go-live: deploys the game contracts against the REAL
// launchpad $BLAST, wires every role, hands administration to the owner
// wallet and revokes it from the deployer — leaving the deployer key as the
// voucher signer only (damage bounded by the vault's daily cap).
//
//   TOKEN_ADDRESS=<pons $BLAST CA>  ADMIN_WALLET=<owner wallet> \
//   npx hardhat run script/golive.ts --network robinhoodMainnet
//
// Economics env (defaults = production values):
//   MIN_CLAIM=30000  CLAIM_COOLDOWN_S=86400  DAILY_MINT_CAP=1000000
//   CHEST_PRICE_ETH=0.005  PACK_PRICE_ETH=0.04  PACK_SIZE=10
//   TREASURY=<chest-ETH recipient; defaults to ADMIN_WALLET>
async function main() {
  const token = process.env.TOKEN_ADDRESS;
  const admin = process.env.ADMIN_WALLET;
  if (!token || !admin) throw new Error("TOKEN_ADDRESS and ADMIN_WALLET are required");

  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY ?? admin;
  console.log(`Deployer (signer-to-be): ${deployer.address}`);
  console.log(`Admin wallet:            ${admin}`);
  console.log(`Treasury:                ${treasury}`);

  // ---- sanity-check the launchpad token before spending anything
  const erc20 = new ethers.Contract(token, [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
  ], deployer);
  const [symbol, decimals, supply] = await Promise.all([
    erc20.symbol(), erc20.decimals(), erc20.totalSupply(),
  ]);
  console.log(`Token: ${symbol} · decimals ${decimals} · supply ${ethers.formatUnits(supply, decimals)}`);
  if (Number(decimals) !== 18) throw new Error("expected an 18-decimals token");
  if (ethers.formatUnits(supply, 18) !== "1000000000.0") {
    throw new Error(`expected the fixed 1B supply, got ${ethers.formatUnits(supply, 18)}`);
  }

  const chestPriceEth = ethers.parseEther(process.env.CHEST_PRICE_ETH ?? "0.005");
  const packPriceEth = ethers.parseEther(process.env.PACK_PRICE_ETH ?? "0.04");
  const packSize = Number(process.env.PACK_SIZE ?? 10);
  const dailyCap = ethers.parseEther(process.env.DAILY_MINT_CAP ?? "1000000");
  const minClaim = ethers.parseEther(process.env.MIN_CLAIM ?? "30000");
  const claimCooldown = Number(process.env.CLAIM_COOLDOWN_S ?? 86400);
  const baseURI = process.env.HERO_BASE_URI ?? "https://minerblastserver-production.up.railway.app/heroes/";

  // ---- deployments (same shapes as deploy.ts, minus the dev token)
  const heroes = await ethers.deployContract("Heroes", [deployer.address, baseURI]);
  await heroes.waitForDeployment();
  console.log(`Heroes:      ${await heroes.getAddress()}`);

  const gacha = await ethers.deployContract("Gacha", [
    await heroes.getAddress(), treasury, chestPriceEth, packPriceEth, packSize, deployer.address,
  ]);
  await gacha.waitForDeployment();
  console.log(`Gacha:       ${await gacha.getAddress()}`);

  const vault = await ethers.deployContract("RewardVault", [
    token, dailyCap, minClaim, claimCooldown, deployer.address,
  ]);
  await vault.waitForDeployment();
  console.log(`RewardVault: ${await vault.getAddress()}`);

  const housePrices = [200, 500, 1200, 3000, 8000, 20000].map((p) => ethers.parseEther(String(p)));
  const houses = await ethers.deployContract("Houses", [token, treasury, housePrices, deployer.address]);
  await houses.waitForDeployment();
  console.log(`Houses:      ${await houses.getAddress()}`);

  const upgrade = await ethers.deployContract("HeroUpgrade", [
    await heroes.getAddress(), token, ethers.parseEther(process.env.UPGRADE_BASE_FEE ?? "50"),
  ]);
  await upgrade.waitForDeployment();
  console.log(`HeroUpgrade: ${await upgrade.getAddress()}`);

  const staking = await ethers.deployContract("Staking", [
    token, Number(process.env.STAKING_APR_BPS ?? 1200), deployer.address,
  ]);
  await staking.waitForDeployment();
  console.log(`Staking:     ${await staking.getAddress()}`);

  const market = await ethers.deployContract("Marketplace", [token, treasury, deployer.address]);
  await market.waitForDeployment();
  console.log(`Marketplace: ${await market.getAddress()}`);

  // ---- wiring
  await (await market.setCollectionAllowed(await heroes.getAddress(), true)).wait();
  await (await market.setCollectionAllowed(await houses.getAddress(), true)).wait();
  await (await heroes.grantRole(await heroes.MINTER_ROLE(), await gacha.getAddress())).wait();
  await (await heroes.grantRole(await heroes.UPGRADER_ROLE(), await upgrade.getAddress())).wait();
  await (await vault.grantRole(await vault.SIGNER_ROLE(), deployer.address)).wait();
  console.log("Roles wired: gacha mints, upgrade fuses, deployer signs vouchers.");

  // ---- administration -> owner wallet; deployer keeps NO admin power.
  // Order matters: grant first, verify, then renounce.
  const adminRole = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
  const managed = [
    ["Heroes", heroes], ["Gacha", gacha], ["RewardVault", vault],
    ["Houses", houses], ["Staking", staking], ["Marketplace", market],
  ] as const;
  for (const [name, c] of managed) {
    await (await (c as any).grantRole(adminRole, admin)).wait();
    if (!(await (c as any).hasRole(adminRole, admin))) {
      throw new Error(`${name}: admin grant to ${admin} did not take effect — aborting before renounce`);
    }
  }
  console.log("Admin granted to the owner wallet on all 6 contracts.");
  for (const [name, c] of managed) {
    await (await (c as any).renounceRole(adminRole, deployer.address)).wait();
    console.log(`${name}: deployer admin renounced.`);
  }

  const out = {
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    token,
    heroes: await heroes.getAddress(),
    gacha: await gacha.getAddress(),
    vault: await vault.getAddress(),
    houses: await houses.getAddress(),
    upgrade: await upgrade.getAddress(),
    staking: await staking.getAddress(),
    market: await market.getAddress(),
    treasury,
    admin,
    signer: deployer.address,
  };
  const file = process.env.OUT_FILE ?? "golive-addresses.json";
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`ADDRESSES_JSON ${JSON.stringify(out)}`);
  console.log(`Written to ${file}. Next: vault.fund() from the owner wallet.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
