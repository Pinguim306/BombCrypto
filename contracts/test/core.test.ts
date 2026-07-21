import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { BlastToken, Heroes, Gacha, RewardVault } from "../typechain-types";

const CHEST_PRICE = ethers.parseEther("100");
const DAILY_CAP = ethers.parseEther("10000");
const MIN_CLAIM = ethers.parseEther("10");
const COOLDOWN = 24 * 3600;
const VAULT_FUNDS = ethers.parseEther("100000");
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function deployFixture() {
  const [admin, treasury, player, other] = await ethers.getSigners();

  const blast = (await ethers.deployContract("BlastToken", [admin.address])) as BlastToken;
  const heroes = (await ethers.deployContract("Heroes", [
    admin.address,
    "https://api.minerblast.example/heroes/",
  ])) as Heroes;
  const gacha = (await ethers.deployContract("Gacha", [
    await blast.getAddress(),
    await heroes.getAddress(),
    treasury.address,
    CHEST_PRICE,
    admin.address,
  ])) as Gacha;
  const vault = (await ethers.deployContract("RewardVault", [
    await blast.getAddress(),
    DAILY_CAP,
    MIN_CLAIM,
    COOLDOWN,
    admin.address,
  ])) as RewardVault;

  await heroes.grantRole(await heroes.MINTER_ROLE(), await gacha.getAddress());
  await vault.grantRole(await vault.SIGNER_ROLE(), admin.address);

  // the vault never mints: it is pre-funded (launchpad share + creator fees)
  await blast.approve(await vault.getAddress(), VAULT_FUNDS);
  await vault.fund(VAULT_FUNDS);

  // fund the player to buy chests
  await blast.transfer(player.address, ethers.parseEther("1000"));

  return { blast, heroes, gacha, vault, admin, treasury, player, other };
}

async function signClaim(
  vault: RewardVault,
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
  player: string,
  amount: bigint,
  nonce: bigint,
  deadline: number
) {
  const domain = {
    name: "MinerBlastVault",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await vault.getAddress(),
  };
  const types = {
    Claim: [
      { name: "player", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return signer.signTypedData(domain, types, { player, amount, nonce, deadline });
}

describe("BlastToken (dev stand-in)", () => {
  it("mints the full fixed supply of 1B to the holder and has no mint function", async () => {
    const { blast, admin } = await loadFixture(deployFixture);
    expect(await blast.totalSupply()).to.equal(ethers.parseEther("1000000000"));
    expect(await blast.balanceOf(admin.address)).to.equal(
      ethers.parseEther("1000000000") - VAULT_FUNDS - ethers.parseEther("1000")
    );
    expect((blast as any).mint).to.equal(undefined);
  });
});

describe("Heroes", () => {
  it("blocks direct mint without MINTER_ROLE", async () => {
    const { heroes, other } = await loadFixture(deployFixture);
    const attrs = {
      rarity: 0, level: 1, power: 10, speed: 10, stamina: 20,
      blastRange: 1, bombCount: 1, abilities: 0,
    };
    await expect(heroes.connect(other).mint(other.address, attrs)).to.be.revertedWithCustomError(
      heroes,
      "AccessControlUnauthorizedAccount"
    );
  });
});

describe("Gacha", () => {
  it("buys and opens a chest: 50% to the dead address, treasury paid, hero minted", async () => {
    const { blast, heroes, gacha, treasury, player } = await loadFixture(deployFixture);

    await blast.connect(player).approve(await gacha.getAddress(), CHEST_PRICE);
    const deadBefore = await blast.balanceOf(DEAD);

    await gacha.connect(player).buyChest(ethers.id("my-salt"));
    expect(await blast.balanceOf(DEAD)).to.equal(deadBefore + CHEST_PRICE / 2n);
    expect(await blast.balanceOf(treasury.address)).to.equal(CHEST_PRICE / 2n);

    await network.provider.send("hardhat_mine", ["0x3"]);
    await gacha.connect(player).openChest(1);

    expect(await heroes.ownerOf(1)).to.equal(player.address);
    const attrs = await heroes.attributesOf(1);
    expect(attrs.rarity).to.be.lessThanOrEqual(5);
    expect(attrs.level).to.equal(1);
    expect(attrs.power).to.be.greaterThan(0);
  });

  it("prevents opening before the reveal block and by anyone other than the buyer", async () => {
    const { blast, gacha, player, other } = await loadFixture(deployFixture);
    await blast.connect(player).approve(await gacha.getAddress(), CHEST_PRICE);
    await gacha.connect(player).buyChest(ethers.id("salt"));

    await expect(gacha.connect(player).openChest(1)).to.be.revertedWith(
      "Gacha: wait for reveal block"
    );
    await network.provider.send("hardhat_mine", ["0x3"]);
    await expect(gacha.connect(other).openChest(1)).to.be.revertedWith(
      "Gacha: not the buyer"
    );
  });

  it("allows reroll after the blockhash expires (>256 blocks)", async () => {
    const { blast, gacha, heroes, player } = await loadFixture(deployFixture);
    await blast.connect(player).approve(await gacha.getAddress(), CHEST_PRICE);
    await gacha.connect(player).buyChest(ethers.id("salt"));

    await network.provider.send("hardhat_mine", ["0x105"]); // 261 blocks
    await expect(gacha.connect(player).openChest(1)).to.be.revertedWith(
      "Gacha: reveal expired, use reroll"
    );
    await gacha.connect(player).reroll(1);
    await network.provider.send("hardhat_mine", ["0x3"]);
    await gacha.connect(player).openChest(1);
    expect(await heroes.ownerOf(1)).to.equal(player.address);
  });
});

describe("RewardVault (pre-funded)", () => {
  it("pays a valid claim from the funded balance, increments the nonce and rejects replay", async () => {
    const { blast, vault, admin, player } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("50");
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 2 * COOLDOWN;

    const sig = await signClaim(vault, admin, player.address, amount, 0n, deadline);
    const balBefore = await blast.balanceOf(player.address);
    const vaultBefore = await vault.vaultBalance();

    await vault.connect(player).claim(amount, deadline, sig);
    expect(await blast.balanceOf(player.address)).to.equal(balBefore + amount);
    expect(await vault.vaultBalance()).to.equal(vaultBefore - amount);
    expect(await vault.nonces(player.address)).to.equal(1n);

    // past the cooldown, replaying the old voucher still fails: nonce moved on
    await network.provider.send("evm_increaseTime", [COOLDOWN]);
    await network.provider.send("evm_mine");
    await expect(vault.connect(player).claim(amount, deadline, sig)).to.be.revertedWith(
      "Vault: invalid signature"
    );
  });

  it("rejects claims below the minimum", async () => {
    const { vault, admin, player } = await loadFixture(deployFixture);
    const amount = MIN_CLAIM - 1n;
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const sig = await signClaim(vault, admin, player.address, amount, 0n, deadline);
    await expect(vault.connect(player).claim(amount, deadline, sig)).to.be.revertedWith(
      "Vault: below minimum claim"
    );
  });

  it("enforces the per-player claim cooldown", async () => {
    const { vault, admin, player } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("50");
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 2 * COOLDOWN;

    const sig0 = await signClaim(vault, admin, player.address, amount, 0n, deadline);
    await vault.connect(player).claim(amount, deadline, sig0);

    const sig1 = await signClaim(vault, admin, player.address, amount, 1n, deadline);
    await expect(vault.connect(player).claim(amount, deadline, sig1)).to.be.revertedWith(
      "Vault: claim cooldown active"
    );

    await network.provider.send("evm_increaseTime", [COOLDOWN]);
    await network.provider.send("evm_mine");
    await vault.connect(player).claim(amount, deadline, sig1);
    expect(await vault.nonces(player.address)).to.equal(2n);
  });

  it("rejects a signature from someone without SIGNER_ROLE and expired vouchers", async () => {
    const { vault, admin, player, other } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("50");
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;

    const badSig = await signClaim(vault, other, player.address, amount, 0n, now + 3600);
    await expect(vault.connect(player).claim(amount, now + 3600, badSig)).to.be.revertedWith(
      "Vault: invalid signature"
    );

    const expiredSig = await signClaim(vault, admin, player.address, amount, 0n, now - 1);
    await expect(vault.connect(player).claim(amount, now - 1, expiredSig)).to.be.revertedWith(
      "Vault: voucher expired"
    );
  });

  it("enforces the daily cap and resets it the next day", async () => {
    const { vault, admin, player, other } = await loadFixture(deployFixture);
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 90000;

    const sig1 = await signClaim(vault, admin, player.address, DAILY_CAP, 0n, deadline);
    await vault.connect(player).claim(DAILY_CAP, deadline, sig1);

    const amount = ethers.parseEther("10");
    const sig2 = await signClaim(vault, admin, other.address, amount, 0n, deadline);
    await expect(vault.connect(other).claim(amount, deadline, sig2)).to.be.revertedWith(
      "Vault: daily cap reached"
    );

    await network.provider.send("evm_increaseTime", [86400]);
    await network.provider.send("evm_mine");
    await vault.connect(other).claim(amount, deadline, sig2);
    expect(await vault.nonces(other.address)).to.equal(1n);
  });

  it("reverts when the vault is underfunded and admin can withdraw/refill", async () => {
    const { blast, vault, admin, player } = await loadFixture(deployFixture);
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;

    // drain the vault (admin rebalancing)
    await vault.connect(admin).withdraw(admin.address, await vault.vaultBalance());
    expect(await vault.vaultBalance()).to.equal(0n);

    const amount = ethers.parseEther("50");
    const sig = await signClaim(vault, admin, player.address, amount, 0n, deadline);
    await expect(vault.connect(player).claim(amount, deadline, sig)).to.be.revertedWithCustomError(
      blast,
      "ERC20InsufficientBalance"
    );

    // creator fees top the vault back up and the claim goes through
    await blast.approve(await vault.getAddress(), amount);
    await vault.fund(amount);
    await vault.connect(player).claim(amount, deadline, sig);
  });
});
