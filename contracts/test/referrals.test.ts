import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { Heroes, GachaV2 } from "../typechain-types";

const CHEST_PRICE = ethers.parseEther("0.005");
const PACK_PRICE = ethers.parseEther("0.04");
const PACK_SIZE = 10;

async function fixture() {
  const [admin, treasury, buyer, referrer, other] = await ethers.getSigners();
  const heroes = (await ethers.deployContract("Heroes", [
    admin.address,
    "https://api.minerblast.example/heroes/",
  ])) as Heroes;
  const gacha = (await ethers.deployContract("GachaV2", [
    await heroes.getAddress(),
    treasury.address,
    CHEST_PRICE,
    PACK_PRICE,
    PACK_SIZE,
    admin.address,
  ])) as GachaV2;
  await heroes.grantRole(await heroes.MINTER_ROLE(), await gacha.getAddress());
  return { admin, treasury, buyer, referrer, other, heroes, gacha };
}

describe("GachaV2 referrals", () => {
  it("pays 15% to the referrer and 85% to the treasury on a chest buy", async () => {
    const { gacha, treasury, buyer, referrer } = await loadFixture(fixture);
    const treBefore = await ethers.provider.getBalance(treasury.address);
    const refBefore = await ethers.provider.getBalance(referrer.address);

    await gacha
      .connect(buyer)
      ["buyChest(bytes32,address)"](ethers.id("s1"), referrer.address, { value: CHEST_PRICE });

    const refCut = (CHEST_PRICE * 1500n) / 10000n;
    expect(await ethers.provider.getBalance(referrer.address)).to.equal(refBefore + refCut);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treBefore + (CHEST_PRICE - refCut));
    expect(await gacha.referralEarned(referrer.address)).to.equal(refCut);
    expect(await gacha.referrerOf(buyer.address)).to.equal(referrer.address);
  });

  it("splits a pack purchase the same way", async () => {
    const { gacha, treasury, buyer, referrer } = await loadFixture(fixture);
    const treBefore = await ethers.provider.getBalance(treasury.address);
    const refBefore = await ethers.provider.getBalance(referrer.address);
    await gacha
      .connect(buyer)
      ["buyPack(bytes32,address)"](ethers.id("p1"), referrer.address, { value: PACK_PRICE });
    const refCut = (PACK_PRICE * 1500n) / 10000n;
    expect(await ethers.provider.getBalance(referrer.address)).to.equal(refBefore + refCut);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treBefore + (PACK_PRICE - refCut));
  });

  it("binds the referrer once and ignores later different referrers", async () => {
    const { gacha, buyer, referrer, other } = await loadFixture(fixture);
    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("a"), referrer.address, { value: CHEST_PRICE });
    // second buy names a different referrer — must still pay the bound one
    const refBefore = await ethers.provider.getBalance(referrer.address);
    const otherBefore = await ethers.provider.getBalance(other.address);
    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("b"), other.address, { value: CHEST_PRICE });
    const refCut = (CHEST_PRICE * 1500n) / 10000n;
    expect(await ethers.provider.getBalance(referrer.address)).to.equal(refBefore + refCut);
    expect(await ethers.provider.getBalance(other.address)).to.equal(otherBefore); // unchanged
    expect(await gacha.referrerOf(buyer.address)).to.equal(referrer.address);
  });

  it("treats self-referral as no referral (100% to treasury)", async () => {
    const { gacha, treasury, buyer } = await loadFixture(fixture);
    const treBefore = await ethers.provider.getBalance(treasury.address);
    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("s"), buyer.address, { value: CHEST_PRICE });
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treBefore + CHEST_PRICE);
    expect(await gacha.referrerOf(buyer.address)).to.equal(ethers.ZeroAddress);
  });

  it("sends 100% to treasury with no referrer (both overloads)", async () => {
    const { gacha, treasury, buyer } = await loadFixture(fixture);
    let treBefore = await ethers.provider.getBalance(treasury.address);
    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("z"), ethers.ZeroAddress, { value: CHEST_PRICE });
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treBefore + CHEST_PRICE);
    treBefore = await ethers.provider.getBalance(treasury.address);
    await gacha.connect(buyer)["buyChest(bytes32)"](ethers.id("z2"), { value: CHEST_PRICE });
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treBefore + CHEST_PRICE);
  });

  it("falls back to a pull balance when the referrer rejects ETH", async () => {
    const { gacha, treasury, buyer } = await loadFixture(fixture);
    // a contract with no payable receive → push fails, amount becomes pending
    const rejecter = await ethers.deployContract("Heroes", [
      buyer.address,
      "x",
    ]); // any contract without a payable fallback
    const refAddr = await rejecter.getAddress();
    const treBefore = await ethers.provider.getBalance(treasury.address);

    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("f"), refAddr, { value: CHEST_PRICE });
    const refCut = (CHEST_PRICE * 1500n) / 10000n;
    expect(await gacha.pendingReferral(refAddr)).to.equal(refCut);
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treBefore + (CHEST_PRICE - refCut));
    expect(await ethers.provider.getBalance(refAddr)).to.equal(0n); // not pushed
  });

  it("lets the admin change the referral bps up to the 30% cap", async () => {
    const { gacha, admin, treasury, buyer, referrer } = await loadFixture(fixture);
    await expect(gacha.connect(admin).setReferralBps(3001)).to.be.revertedWith("Gacha: referral over cap");
    await gacha.connect(admin).setReferralBps(3000);
    const refBefore = await ethers.provider.getBalance(referrer.address);
    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("c"), referrer.address, { value: CHEST_PRICE });
    expect(await ethers.provider.getBalance(referrer.address)).to.equal(refBefore + (CHEST_PRICE * 3000n) / 10000n);
  });

  it("still opens chests and mints heroes (mechanics unchanged)", async () => {
    const { gacha, heroes, buyer, referrer } = await loadFixture(fixture);
    await gacha.connect(buyer)["buyChest(bytes32,address)"](ethers.id("open"), referrer.address, { value: CHEST_PRICE });
    await network.provider.send("hardhat_mine", ["0x3"]);
    await gacha.connect(buyer).openChest(1);
    expect(await heroes.balanceOf(buyer.address)).to.equal(1n);
  });
});
