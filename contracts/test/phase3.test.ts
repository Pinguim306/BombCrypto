import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { BlastToken, Heroes, Houses, HeroUpgrade, Staking } from "../typechain-types";

const HOUSE_PRICES: [bigint, bigint, bigint, bigint, bigint, bigint] = [
  ethers.parseEther("200"),
  ethers.parseEther("500"),
  ethers.parseEther("1200"),
  ethers.parseEther("3000"),
  ethers.parseEther("8000"),
  ethers.parseEther("20000"),
];
const UPGRADE_BASE_FEE = ethers.parseEther("50");
const APR_BPS = 1200;
const DEAD = "0x000000000000000000000000000000000000dEaD"; // 12% p.a.

async function deployFixture() {
  const [admin, treasury, player] = await ethers.getSigners();

  const blast = (await ethers.deployContract("BlastToken", [admin.address])) as BlastToken;
  const heroes = (await ethers.deployContract("Heroes", [admin.address, "ipfs://base/"])) as Heroes;
  const houses = (await ethers.deployContract("Houses", [
    await blast.getAddress(),
    treasury.address,
    HOUSE_PRICES,
    admin.address,
  ])) as Houses;
  const upgrade = (await ethers.deployContract("HeroUpgrade", [
    await heroes.getAddress(),
    await blast.getAddress(),
    UPGRADE_BASE_FEE,
  ])) as HeroUpgrade;
  const staking = (await ethers.deployContract("Staking", [
    await blast.getAddress(),
    APR_BPS,
    admin.address,
  ])) as Staking;

  // admin acts as minter to set up test scenarios
  await heroes.grantRole(await heroes.MINTER_ROLE(), admin.address);
  await heroes.grantRole(await heroes.UPGRADER_ROLE(), await upgrade.getAddress());
  await blast.transfer(player.address, ethers.parseEther("100000"));

  return { blast, heroes, houses, upgrade, staking, admin, treasury, player };
}

function heroAttrs(rarity: number, level = 1) {
  return {
    rarity, level, power: 10, speed: 10, stamina: 20,
    blastRange: 1, bombCount: 1, abilities: 0,
  };
}

describe("Houses", () => {
  it("sells a house with 50% burn, treasury payout and per-rarity attributes", async () => {
    const { blast, houses, treasury, player } = await loadFixture(deployFixture);
    const price = HOUSE_PRICES[2];
    await blast.connect(player).approve(await houses.getAddress(), price);

    const deadBefore = await blast.balanceOf(DEAD);
    await houses.connect(player).buyHouse(2);

    expect(await blast.balanceOf(DEAD)).to.equal(deadBefore + price / 2n);
    expect(await blast.balanceOf(treasury.address)).to.equal(price / 2n);
    expect(await houses.ownerOf(1)).to.equal(player.address);

    const attrs = await houses.attributesOf(1);
    expect(attrs.rarity).to.equal(2);
    expect(attrs.capacity).to.equal(6); // 2 + 2*2
    expect(attrs.regenBoostBps).to.equal(5000); // 2000 + 2*1500
  });

  it("rejects a rarity with zero price", async () => {
    const { houses, admin, player } = await loadFixture(deployFixture);
    await houses.connect(admin).setPrice(0, 0);
    await expect(houses.connect(player).buyHouse(0)).to.be.revertedWith(
      "Houses: rarity unavailable"
    );
  });
});

describe("HeroUpgrade", () => {
  it("fuses a hero: burns the sacrifice + fee and levels up the target", async () => {
    const { blast, heroes, upgrade, admin, player } = await loadFixture(deployFixture);
    await heroes.connect(admin).mint(player.address, heroAttrs(1, 2)); // target id 1
    await heroes.connect(admin).mint(player.address, heroAttrs(1)); // sacrifice id 2

    const fee = UPGRADE_BASE_FEE * 2n; // baseFee * level 2
    await blast.connect(player).approve(await upgrade.getAddress(), fee);
    const deadBefore = await blast.balanceOf(DEAD);

    await upgrade.connect(player).fuse(1, 2);

    expect(await blast.balanceOf(DEAD)).to.equal(deadBefore + fee); // fee 100% burned
    expect((await heroes.attributesOf(1)).level).to.equal(3);
    await expect(heroes.ownerOf(2)).to.be.revertedWithCustomError(heroes, "ERC721NonexistentToken");
  });

  it("rejects mismatched rarities, max level and a third party's hero", async () => {
    const { blast, heroes, upgrade, admin, player, treasury } = await loadFixture(deployFixture);
    await heroes.connect(admin).mint(player.address, heroAttrs(1)); // 1
    await heroes.connect(admin).mint(player.address, heroAttrs(2)); // 2
    await heroes.connect(admin).mint(player.address, heroAttrs(0, 4)); // 3: Common at max level
    await heroes.connect(admin).mint(player.address, heroAttrs(0)); // 4
    await heroes.connect(admin).mint(treasury.address, heroAttrs(1)); // 5: owned by someone else

    await blast.connect(player).approve(await upgrade.getAddress(), ethers.parseEther("10000"));

    await expect(upgrade.connect(player).fuse(1, 2)).to.be.revertedWith(
      "Upgrade: rarity mismatch"
    );
    await expect(upgrade.connect(player).fuse(3, 4)).to.be.revertedWith("Upgrade: max level");
    await expect(upgrade.connect(player).fuse(1, 5)).to.be.revertedWith(
      "Upgrade: not sacrifice owner"
    );
  });
});

describe("Staking", () => {
  it("stake with 30-day lock: blocks early withdrawal and pays reward from the pool", async () => {
    const { blast, staking, admin, player } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("10000");

    await blast.connect(admin).approve(await staking.getAddress(), ethers.parseEther("1000"));
    await staking.connect(admin).fundRewards(ethers.parseEther("1000"));

    await blast.connect(player).approve(await staking.getAddress(), amount);
    await staking.connect(player).stake(amount);

    await expect(staking.connect(player).withdraw(0)).to.be.revertedWith("Staking: still locked");

    await network.provider.send("evm_increaseTime", [30 * 86400]);
    await network.provider.send("evm_mine");

    const balBefore = await blast.balanceOf(player.address);
    await staking.connect(player).withdraw(0);
    const received = (await blast.balanceOf(player.address)) - balBefore;

    // reward ≈ 10000 * 12% * (30/365) ≈ 98.6 BLAST
    const expectedReward = (amount * 1200n * BigInt(30 * 86400)) / (10000n * BigInt(365 * 86400));
    expect(received).to.be.closeTo(amount + expectedReward, ethers.parseEther("1"));

    await expect(staking.connect(player).withdraw(0)).to.be.revertedWith("Staking: already withdrawn");
  });

  it("an empty pool limits the reward but the principal is returned in full", async () => {
    const { blast, staking, player } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("500");
    await blast.connect(player).approve(await staking.getAddress(), amount);
    await staking.connect(player).stake(amount);

    await network.provider.send("evm_increaseTime", [30 * 86400]);
    await network.provider.send("evm_mine");

    const balBefore = await blast.balanceOf(player.address);
    await staking.connect(player).withdraw(0);
    expect((await blast.balanceOf(player.address)) - balBefore).to.equal(amount);
  });
});

describe("Heroes (Enumerable)", () => {
  it("lists a player's heroes without an indexer", async () => {
    const { heroes, admin, player } = await loadFixture(deployFixture);
    await heroes.connect(admin).mint(player.address, heroAttrs(0));
    await heroes.connect(admin).mint(player.address, heroAttrs(3));

    expect(await heroes.balanceOf(player.address)).to.equal(2);
    expect(await heroes.tokenOfOwnerByIndex(player.address, 0)).to.equal(1);
    expect(await heroes.tokenOfOwnerByIndex(player.address, 1)).to.equal(2);
  });
});
