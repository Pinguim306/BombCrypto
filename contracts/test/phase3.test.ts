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
const APR_BPS = 1200; // 12% a.a.

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

  // admin atua como minter para preparar cenários de teste
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
  it("vende casa com queima de 50%, tesouraria e atributos por raridade", async () => {
    const { blast, houses, treasury, player } = await loadFixture(deployFixture);
    const price = HOUSE_PRICES[2];
    await blast.connect(player).approve(await houses.getAddress(), price);

    const supplyBefore = await blast.totalSupply();
    await houses.connect(player).buyHouse(2);

    expect(await blast.totalSupply()).to.equal(supplyBefore - price / 2n);
    expect(await blast.balanceOf(treasury.address)).to.equal(price / 2n);
    expect(await houses.ownerOf(1)).to.equal(player.address);

    const attrs = await houses.attributesOf(1);
    expect(attrs.rarity).to.equal(2);
    expect(attrs.capacity).to.equal(6); // 2 + 2*2
    expect(attrs.regenBoostBps).to.equal(5000); // 2000 + 2*1500
  });

  it("rejeita raridade com preço zerado", async () => {
    const { houses, admin, player } = await loadFixture(deployFixture);
    await houses.connect(admin).setPrice(0, 0);
    await expect(houses.connect(player).buyHouse(0)).to.be.revertedWith(
      "Houses: raridade indisponivel"
    );
  });
});

describe("HeroUpgrade", () => {
  it("funde herói: queima sacrifício + taxa e sobe o nível do alvo", async () => {
    const { blast, heroes, upgrade, admin, player } = await loadFixture(deployFixture);
    await heroes.connect(admin).mint(player.address, heroAttrs(1, 2)); // alvo id 1
    await heroes.connect(admin).mint(player.address, heroAttrs(1)); // sacrifício id 2

    const fee = UPGRADE_BASE_FEE * 2n; // baseFee * nível 2
    await blast.connect(player).approve(await upgrade.getAddress(), fee);
    const supplyBefore = await blast.totalSupply();

    await upgrade.connect(player).fuse(1, 2);

    expect(await blast.totalSupply()).to.equal(supplyBefore - fee); // taxa 100% queimada
    expect((await heroes.attributesOf(1)).level).to.equal(3);
    await expect(heroes.ownerOf(2)).to.be.revertedWithCustomError(heroes, "ERC721NonexistentToken");
  });

  it("rejeita raridades diferentes, nível máximo e herói de terceiros", async () => {
    const { blast, heroes, upgrade, admin, player, treasury } = await loadFixture(deployFixture);
    await heroes.connect(admin).mint(player.address, heroAttrs(1)); // 1
    await heroes.connect(admin).mint(player.address, heroAttrs(2)); // 2
    await heroes.connect(admin).mint(player.address, heroAttrs(0, 4)); // 3: Comum no nível máx
    await heroes.connect(admin).mint(player.address, heroAttrs(0)); // 4
    await heroes.connect(admin).mint(treasury.address, heroAttrs(1)); // 5: de outro dono

    await blast.connect(player).approve(await upgrade.getAddress(), ethers.parseEther("10000"));

    await expect(upgrade.connect(player).fuse(1, 2)).to.be.revertedWith(
      "Upgrade: raridades diferentes"
    );
    await expect(upgrade.connect(player).fuse(3, 4)).to.be.revertedWith("Upgrade: nivel maximo");
    await expect(upgrade.connect(player).fuse(1, 5)).to.be.revertedWith(
      "Upgrade: nao e dono do sacrificio"
    );
  });
});

describe("Staking", () => {
  it("stake com lock de 30 dias: bloqueia saque antecipado e paga recompensa do pool", async () => {
    const { blast, staking, admin, player } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("10000");

    await blast.connect(admin).approve(await staking.getAddress(), ethers.parseEther("1000"));
    await staking.connect(admin).fundRewards(ethers.parseEther("1000"));

    await blast.connect(player).approve(await staking.getAddress(), amount);
    await staking.connect(player).stake(amount);

    await expect(staking.connect(player).withdraw(0)).to.be.revertedWith("Staking: em lock");

    await network.provider.send("evm_increaseTime", [30 * 86400]);
    await network.provider.send("evm_mine");

    const balBefore = await blast.balanceOf(player.address);
    await staking.connect(player).withdraw(0);
    const received = (await blast.balanceOf(player.address)) - balBefore;

    // recompensa ≈ 10000 * 12% * (30/365) ≈ 98.6 BLAST
    const expectedReward = (amount * 1200n * BigInt(30 * 86400)) / (10000n * BigInt(365 * 86400));
    expect(received).to.be.closeTo(amount + expectedReward, ethers.parseEther("1"));

    await expect(staking.connect(player).withdraw(0)).to.be.revertedWith("Staking: ja sacado");
  });

  it("pool vazio limita a recompensa mas o principal volta inteiro", async () => {
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
  it("lista os heróis de um jogador sem indexer", async () => {
    const { heroes, admin, player } = await loadFixture(deployFixture);
    await heroes.connect(admin).mint(player.address, heroAttrs(0));
    await heroes.connect(admin).mint(player.address, heroAttrs(3));

    expect(await heroes.balanceOf(player.address)).to.equal(2);
    expect(await heroes.tokenOfOwnerByIndex(player.address, 0)).to.equal(1);
    expect(await heroes.tokenOfOwnerByIndex(player.address, 1)).to.equal(2);
  });
});
