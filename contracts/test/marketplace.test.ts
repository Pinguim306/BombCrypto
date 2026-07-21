import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { BlastToken, Heroes, Marketplace } from "../typechain-types";

const PRICE = ethers.parseEther("1000");

async function deployFixture() {
  const [admin, treasury, seller, buyer] = await ethers.getSigners();

  const blast = (await ethers.deployContract("BlastToken", [admin.address])) as BlastToken;
  const heroes = (await ethers.deployContract("Heroes", [admin.address, "ipfs://base/"])) as Heroes;
  const market = (await ethers.deployContract("Marketplace", [
    await blast.getAddress(),
    treasury.address,
    admin.address,
  ])) as Marketplace;

  await market.setCollectionAllowed(await heroes.getAddress(), true);
  await heroes.grantRole(await heroes.MINTER_ROLE(), admin.address);
  await heroes.mint(seller.address, {
    rarity: 2, level: 1, power: 40, speed: 40, stamina: 80,
    blastRange: 2, bombCount: 1, abilities: 0,
  });
  await blast.transfer(buyer.address, ethers.parseEther("5000"));

  return { blast, heroes, market, admin, treasury, seller, buyer };
}

describe("Marketplace", () => {
  it("lists with escrow, sells with a 4% fee (half burned) and delivers the NFT", async () => {
    const { blast, heroes, market, treasury, seller, buyer } = await loadFixture(deployFixture);

    await heroes.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(await heroes.getAddress(), 1, PRICE);
    expect(await heroes.ownerOf(1)).to.equal(await market.getAddress()); // escrow

    const fee = (PRICE * 400n) / 10000n; // 40 BLAST
    const burn = fee / 2n;
    await blast.connect(buyer).approve(await market.getAddress(), PRICE);

    const supplyBefore = await blast.totalSupply();
    const sellerBefore = await blast.balanceOf(seller.address);
    const treasuryBefore = await blast.balanceOf(treasury.address);

    await market.connect(buyer).buy(1);

    expect(await heroes.ownerOf(1)).to.equal(buyer.address);
    expect(await blast.totalSupply()).to.equal(supplyBefore - burn);
    expect(await blast.balanceOf(treasury.address)).to.equal(treasuryBefore + fee - burn);
    expect(await blast.balanceOf(seller.address)).to.equal(sellerBefore + PRICE - fee);
  });

  it("seller cancels and recovers the NFT; third parties cannot cancel", async () => {
    const { heroes, market, seller, buyer } = await loadFixture(deployFixture);
    await heroes.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(await heroes.getAddress(), 1, PRICE);

    await expect(market.connect(buyer).cancel(1)).to.be.revertedWith("Market: not the seller");
    await market.connect(seller).cancel(1);
    expect(await heroes.ownerOf(1)).to.equal(seller.address);

    await expect(market.connect(buyer).buy(1)).to.be.revertedWith("Market: listing inactive");
  });

  it("rejects a disallowed collection and buying one's own listing", async () => {
    const { blast, heroes, market, admin, seller } = await loadFixture(deployFixture);

    await market.connect(admin).setCollectionAllowed(await heroes.getAddress(), false);
    await heroes.connect(seller).approve(await market.getAddress(), 1);
    await expect(
      market.connect(seller).list(await heroes.getAddress(), 1, PRICE)
    ).to.be.revertedWith("Market: collection not allowed");

    await market.connect(admin).setCollectionAllowed(await heroes.getAddress(), true);
    await market.connect(seller).list(await heroes.getAddress(), 1, PRICE);
    await blast.connect(seller).approve(await market.getAddress(), PRICE);
    await expect(market.connect(seller).buy(1)).to.be.revertedWith("Market: cannot buy own listing");
  });
});
