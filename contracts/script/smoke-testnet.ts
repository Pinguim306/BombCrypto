import { ethers } from "hardhat";

// End-to-end smoke test against a live deployment:
//   grants SIGNER_ROLE to the signer address, buys a chest, waits for the
//   reveal block, opens it, and prints the minted hero.
// NOTE (Arbitrum/Orbit): inside contracts block.number is the *L1* block
// number, which advances on its own (~12s); we poll with a static call
// until the reveal window opens instead of comparing RPC (L2) block numbers.
// Env: TOKEN, GACHA, HEROES, VAULT (addresses), SIGNER (address for role).
async function main() {
  const [deployer] = await ethers.getSigners();
  const token = await ethers.getContractAt("BlastToken", process.env.TOKEN!);
  const gacha = await ethers.getContractAt("Gacha", process.env.GACHA!);
  const heroes = await ethers.getContractAt("Heroes", process.env.HEROES!);
  const vault = await ethers.getContractAt("RewardVault", process.env.VAULT!);

  const signerAddr = process.env.SIGNER ?? deployer.address;
  const signerRole = await vault.SIGNER_ROLE();
  if (!(await vault.hasRole(signerRole, signerAddr))) {
    await (await vault.grantRole(signerRole, signerAddr)).wait();
    console.log(`SIGNER_ROLE granted to ${signerAddr}`);
  } else {
    console.log(`SIGNER_ROLE already granted to ${signerAddr}`);
  }

  const price = await gacha.chestPrice();
  console.log(`Chest price: ${ethers.formatEther(price)} BLAST`);
  await (await token.approve(await gacha.getAddress(), price)).wait();

  const buyTx = await gacha.buyChest(ethers.id(`smoke-${deployer.address}`));
  const buyRcpt = await buyTx.wait();
  const chestId = await gacha.nextChestId() - 1n;
  const chest = await gacha.chests(chestId);
  console.log(`Chest #${chestId} bought at block ${buyRcpt!.blockNumber}; reveal block ${chest.revealBlock}`);

  // poll until the L1-based reveal block has passed (up to ~3 min)
  for (let attempt = 0; ; attempt++) {
    try {
      await gacha.openChest.staticCall(chestId);
      break;
    } catch (err) {
      if (attempt >= 36) throw err;
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log("\nreveal window open");

  await (await gacha.openChest(chestId)).wait();
  const heroId = (await heroes.nextTokenId()) - 1n;
  const attrs = await heroes.attributesOf(heroId);
  console.log(
    `Hero #${heroId} minted! rarity=${attrs.rarity} level=${attrs.level} ` +
      `power=${attrs.power} speed=${attrs.speed} stamina=${attrs.stamina} ` +
      `range=${attrs.blastRange} bombs=${attrs.bombCount}`
  );
  console.log(`Owner: ${await heroes.ownerOf(heroId)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
