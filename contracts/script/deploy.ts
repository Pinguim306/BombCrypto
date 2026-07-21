import { ethers } from "hardhat";

// Deploy dos contratos core na testnet da Robinhood Chain:
//   npx hardhat run script/deploy.ts --network robinhoodTestnet
// Requer ROBINHOOD_TESTNET_RPC e DEPLOYER_KEY no ambiente.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const chestPrice = ethers.parseEther(process.env.CHEST_PRICE ?? "100");
  const dailyCap = ethers.parseEther(process.env.DAILY_MINT_CAP ?? "500000");
  const treasury = process.env.TREASURY ?? deployer.address;
  const baseURI = process.env.HERO_BASE_URI ?? "https://api.minerblast.example/heroes/";

  const blast = await ethers.deployContract("BlastToken", [deployer.address]);
  await blast.waitForDeployment();
  console.log(`BlastToken:  ${await blast.getAddress()}`);

  const heroes = await ethers.deployContract("Heroes", [deployer.address, baseURI]);
  await heroes.waitForDeployment();
  console.log(`Heroes:      ${await heroes.getAddress()}`);

  const gacha = await ethers.deployContract("Gacha", [
    await blast.getAddress(),
    await heroes.getAddress(),
    treasury,
    chestPrice,
    deployer.address,
  ]);
  await gacha.waitForDeployment();
  console.log(`Gacha:       ${await gacha.getAddress()}`);

  const vault = await ethers.deployContract("RewardVault", [
    await blast.getAddress(),
    dailyCap,
    deployer.address,
  ]);
  await vault.waitForDeployment();
  console.log(`RewardVault: ${await vault.getAddress()}`);

  const housePrices = [200, 500, 1200, 3000, 8000, 20000].map((p) => ethers.parseEther(String(p)));
  const houses = await ethers.deployContract("Houses", [
    await blast.getAddress(),
    treasury,
    housePrices,
    deployer.address,
  ]);
  await houses.waitForDeployment();
  console.log(`Houses:      ${await houses.getAddress()}`);

  const upgrade = await ethers.deployContract("HeroUpgrade", [
    await heroes.getAddress(),
    await blast.getAddress(),
    ethers.parseEther(process.env.UPGRADE_BASE_FEE ?? "50"),
  ]);
  await upgrade.waitForDeployment();
  console.log(`HeroUpgrade: ${await upgrade.getAddress()}`);

  const staking = await ethers.deployContract("Staking", [
    await blast.getAddress(),
    Number(process.env.STAKING_APR_BPS ?? 1200),
    deployer.address,
  ]);
  await staking.waitForDeployment();
  console.log(`Staking:     ${await staking.getAddress()}`);

  const market = await ethers.deployContract("Marketplace", [
    await blast.getAddress(),
    treasury,
    deployer.address,
  ]);
  await market.waitForDeployment();
  console.log(`Marketplace: ${await market.getAddress()}`);

  await (await market.setCollectionAllowed(await heroes.getAddress(), true)).wait();
  await (await market.setCollectionAllowed(await houses.getAddress(), true)).wait();
  await (await heroes.grantRole(await heroes.MINTER_ROLE(), await gacha.getAddress())).wait();
  await (await heroes.grantRole(await heroes.UPGRADER_ROLE(), await upgrade.getAddress())).wait();
  await (await blast.grantRole(await blast.MINTER_ROLE(), await vault.getAddress())).wait();
  console.log("Roles: Gacha minta heróis, HeroUpgrade funde/queima, Vault minta BLAST.");
  console.log("Pendente: grantRole(SIGNER_ROLE) no Vault para a chave do servidor de jogo.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
