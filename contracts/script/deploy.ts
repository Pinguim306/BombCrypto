import { ethers } from "hardhat";

// Deploys the game contracts on the Robinhood Chain testnet:
//   npx hardhat run script/deploy.ts --network robinhoodTestnet
// Requires ROBINHOOD_TESTNET_RPC and DEPLOYER_KEY in the environment.
//
// Token: in production BLAST is issued by the launchpad (ponsfamily.com) —
// set TOKEN_ADDRESS to use it. Without TOKEN_ADDRESS a dev stand-in token
// (fixed 1B supply, minted to the deployer) is deployed instead.
//
// Vault economics (all admin-tunable later):
//   MIN_CLAIM   — minimum accumulated BLAST per withdrawal (default 10000)
//   CLAIM_COOLDOWN_S — seconds between withdrawals per player (default 86400)
//   DAILY_MINT_CAP   — global daily payout ceiling (default 500000)
//   VAULT_FUND  — BLAST to deposit into the vault right away (default 0)
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const chestPrice = ethers.parseEther(process.env.CHEST_PRICE ?? "100");
  const dailyCap = ethers.parseEther(process.env.DAILY_MINT_CAP ?? "500000");
  const minClaim = ethers.parseEther(process.env.MIN_CLAIM ?? "10000");
  const claimCooldown = Number(process.env.CLAIM_COOLDOWN_S ?? 86400);
  const vaultFund = ethers.parseEther(process.env.VAULT_FUND ?? "0");
  const treasury = process.env.TREASURY ?? deployer.address;
  const baseURI = process.env.HERO_BASE_URI ?? "https://api.minerblast.example/heroes/";

  let blastAddress: string;
  if (process.env.TOKEN_ADDRESS) {
    blastAddress = process.env.TOKEN_ADDRESS;
    console.log(`BlastToken:  ${blastAddress} (existing launchpad token)`);
  } else {
    const blast = await ethers.deployContract("BlastToken", [deployer.address]);
    await blast.waitForDeployment();
    blastAddress = await blast.getAddress();
    console.log(`BlastToken:  ${blastAddress} (dev stand-in, 1B fixed supply)`);
  }

  const heroes = await ethers.deployContract("Heroes", [deployer.address, baseURI]);
  await heroes.waitForDeployment();
  console.log(`Heroes:      ${await heroes.getAddress()}`);

  const gacha = await ethers.deployContract("Gacha", [
    blastAddress,
    await heroes.getAddress(),
    treasury,
    chestPrice,
    deployer.address,
  ]);
  await gacha.waitForDeployment();
  console.log(`Gacha:       ${await gacha.getAddress()}`);

  const vault = await ethers.deployContract("RewardVault", [
    blastAddress,
    dailyCap,
    minClaim,
    claimCooldown,
    deployer.address,
  ]);
  await vault.waitForDeployment();
  console.log(`RewardVault: ${await vault.getAddress()} (minClaim=${ethers.formatEther(minClaim)}, cooldown=${claimCooldown}s)`);

  const housePrices = [200, 500, 1200, 3000, 8000, 20000].map((p) => ethers.parseEther(String(p)));
  const houses = await ethers.deployContract("Houses", [
    blastAddress,
    treasury,
    housePrices,
    deployer.address,
  ]);
  await houses.waitForDeployment();
  console.log(`Houses:      ${await houses.getAddress()}`);

  const upgrade = await ethers.deployContract("HeroUpgrade", [
    await heroes.getAddress(),
    blastAddress,
    ethers.parseEther(process.env.UPGRADE_BASE_FEE ?? "50"),
  ]);
  await upgrade.waitForDeployment();
  console.log(`HeroUpgrade: ${await upgrade.getAddress()}`);

  const staking = await ethers.deployContract("Staking", [
    blastAddress,
    Number(process.env.STAKING_APR_BPS ?? 1200),
    deployer.address,
  ]);
  await staking.waitForDeployment();
  console.log(`Staking:     ${await staking.getAddress()}`);

  const market = await ethers.deployContract("Marketplace", [
    blastAddress,
    treasury,
    deployer.address,
  ]);
  await market.waitForDeployment();
  console.log(`Marketplace: ${await market.getAddress()}`);

  await (await market.setCollectionAllowed(await heroes.getAddress(), true)).wait();
  await (await market.setCollectionAllowed(await houses.getAddress(), true)).wait();
  await (await heroes.grantRole(await heroes.MINTER_ROLE(), await gacha.getAddress())).wait();
  await (await heroes.grantRole(await heroes.UPGRADER_ROLE(), await upgrade.getAddress())).wait();
  console.log("Roles: Gacha mints heroes, HeroUpgrade fuses/burns.");

  if (vaultFund > 0n) {
    const token = await ethers.getContractAt("BlastToken", blastAddress);
    await (await token.approve(await vault.getAddress(), vaultFund)).wait();
    await (await vault.fund(vaultFund)).wait();
    console.log(`Vault funded with ${ethers.formatEther(vaultFund)} BLAST.`);
  } else {
    console.log("Pending: fund the vault (launchpad share + creator fees) via vault.fund().");
  }
  console.log("Pending: grantRole(SIGNER_ROLE) on the Vault for the game server key.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
