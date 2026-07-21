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

  await (await heroes.grantRole(await heroes.MINTER_ROLE(), await gacha.getAddress())).wait();
  await (await blast.grantRole(await blast.MINTER_ROLE(), await vault.getAddress())).wait();
  console.log("Roles configuradas: Gacha pode mintar heróis, Vault pode mintar BLAST.");
  console.log("Pendente: grantRole(SIGNER_ROLE) no Vault para a chave do servidor de jogo.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
