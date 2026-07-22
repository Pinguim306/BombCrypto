import { ethers } from "hardhat";
import { writeFileSync } from "fs";

// Deploys GachaV2 (referral-enabled) on mainnet pointing at the EXISTING
// Heroes + treasury, hands its admin to the owner wallet and renounces the
// deployer. Does NOT touch Heroes' MINTER_ROLE — that grant/revoke is signed
// by the owner wallet afterward (see the migration page). Buying works
// immediately; opening needs the MINTER grant.
//
//   HEROES=<addr> TREASURY=<addr> ADMIN_WALLET=<owner> \
//   CHEST_PRICE_ETH=0.005 PACK_PRICE_ETH=0.04 PACK_SIZE=10 \
//   npx hardhat run script/deploy-gachav2.ts --network robinhoodMainnet
async function main() {
  const heroesAddr = process.env.HEROES;
  const treasury = process.env.TREASURY;
  const admin = process.env.ADMIN_WALLET;
  if (!heroesAddr || !treasury || !admin) throw new Error("HEROES, TREASURY, ADMIN_WALLET required");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  const gacha = await ethers.deployContract("GachaV2", [
    heroesAddr,
    treasury,
    ethers.parseEther(process.env.CHEST_PRICE_ETH ?? "0.005"),
    ethers.parseEther(process.env.PACK_PRICE_ETH ?? "0.04"),
    Number(process.env.PACK_SIZE ?? 10),
    deployer.address,
  ]);
  await gacha.waitForDeployment();
  const addr = await gacha.getAddress();
  console.log(`GachaV2: ${addr}`);

  // hand admin to the owner wallet, then renounce the deployer's admin
  const adminRole = ethers.ZeroHash;
  await (await (gacha as any).grantRole(adminRole, admin)).wait();
  if (!(await (gacha as any).hasRole(adminRole, admin))) throw new Error("admin grant failed");
  await (await (gacha as any).renounceRole(adminRole, deployer.address)).wait();
  console.log(`Admin -> ${admin}; deployer renounced.`);

  const out = { gachaV2: addr, heroes: heroesAddr, treasury, admin, signer: deployer.address };
  writeFileSync(process.env.OUT_FILE ?? "gachav2-address.json", JSON.stringify(out, null, 2));
  console.log(`GACHAV2_JSON ${JSON.stringify(out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
