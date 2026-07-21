import { ethers } from "hardhat";

// One-off migration on the Robinhood Chain testnet: deploys the ETH-priced
// Gacha, moves MINTER_ROLE from the old BLAST-priced gacha to it, and sets
// the vault minClaim proportionally to the current reward scaling (3.75x).
// Env: HEROES, OLD_GACHA, VAULT (addresses).
async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`ETH balance: ${ethers.formatEther(bal)}`);

  const HEROES = process.env.HEROES!;
  const OLD_GACHA = process.env.OLD_GACHA!;
  const VAULT = process.env.VAULT!;

  const gacha = await ethers.deployContract("Gacha", [
    HEROES,
    process.env.TREASURY ?? deployer.address,
    ethers.parseEther(process.env.CHEST_PRICE_ETH ?? "0.005"),
    ethers.parseEther(process.env.PACK_PRICE_ETH ?? "0.04"),
    Number(process.env.PACK_SIZE ?? 10),
    deployer.address,
  ]);
  await gacha.waitForDeployment();
  console.log(`New Gacha: ${await gacha.getAddress()}`);

  const heroes = await ethers.getContractAt("Heroes", HEROES);
  const minter = await heroes.MINTER_ROLE();
  await (await heroes.grantRole(minter, await gacha.getAddress())).wait();
  await (await heroes.revokeRole(minter, OLD_GACHA)).wait();
  console.log("MINTER_ROLE: granted to new gacha, revoked from old");

  const vault = await ethers.getContractAt("RewardVault", VAULT);
  await (await vault.setMinClaim(ethers.parseEther(process.env.MIN_CLAIM ?? "375"))).wait();
  console.log(`Vault minClaim: ${process.env.MIN_CLAIM ?? "375"} BLAST (3.75x rewards proportional)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
