// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Heroes} from "./Heroes.sol";

/// @title MinerBlast hero gacha (ETH-priced)
/// @notice Chests are paid in native ETH: a single chest at `chestPriceWei`
///         or a discounted pack of `packSize` chests at `packPriceWei`.
///         All ETH is forwarded to the treasury (used to buy BLAST back and
///         fund the reward vault). Randomness is commit-reveal: the purchase
///         records a future block and opening uses its blockhash + the
///         buyer's salt. Mainnet plan: migrate to Chainlink VRF; commit-
///         reveal is the testnet fallback. Rarity odds are public on-chain.
contract Gacha is AccessControl, ReentrancyGuard {
    struct Chest {
        address buyer;
        uint64 revealBlock; // first block whose hash can reveal
        bytes32 salt;
        bool opened;
    }

    Heroes public immutable heroes;
    address public treasury;

    uint256 public chestPriceWei;
    uint256 public packPriceWei;
    uint8 public packSize;

    /// @dev Cumulative probability per rarity, in bps.
    ///      Common 52%, Rare 26%, SuperRare 12%, Epic 6.5%, Legend 3%, Mythic 0.5%
    uint16[6] public rarityCumBps = [5200, 7800, 9000, 9650, 9950, 10000];

    uint256 public nextChestId = 1;
    mapping(uint256 chestId => Chest) public chests;

    event ChestBought(uint256 indexed chestId, address indexed buyer, uint64 revealBlock);
    event PackBought(address indexed buyer, uint256 firstChestId, uint8 count);
    event ChestOpened(uint256 indexed chestId, address indexed buyer, uint256 heroId, uint8 rarity);
    event ChestRerolled(uint256 indexed chestId, uint64 newRevealBlock);

    constructor(
        Heroes heroes_,
        address treasury_,
        uint256 chestPriceWei_,
        uint256 packPriceWei_,
        uint8 packSize_,
        address admin
    ) {
        heroes = heroes_;
        treasury = treasury_;
        chestPriceWei = chestPriceWei_;
        packPriceWei = packPriceWei_;
        packSize = packSize_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Buys a single chest for `chestPriceWei` in ETH.
    function buyChest(bytes32 salt) external payable nonReentrant returns (uint256 chestId) {
        require(msg.value == chestPriceWei, "Gacha: wrong ETH amount");
        _forwardToTreasury();
        chestId = _createChest(salt);
    }

    /// @notice Buys a discounted pack of `packSize` chests for `packPriceWei`.
    function buyPack(bytes32 salt) external payable nonReentrant returns (uint256 firstChestId) {
        require(msg.value == packPriceWei, "Gacha: wrong ETH amount");
        _forwardToTreasury();
        firstChestId = nextChestId;
        for (uint8 i = 0; i < packSize; i++) {
            _createChest(salt);
        }
        emit PackBought(msg.sender, firstChestId, packSize);
    }

    /// @notice Opens the chest and mints the hero. Must be called within 256
    ///         blocks of the reveal block; afterwards use `reroll`.
    function openChest(uint256 chestId) external nonReentrant returns (uint256 heroId) {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: not the buyer");
        require(!c.opened, "Gacha: already opened");
        require(block.number > c.revealBlock, "Gacha: wait for reveal block");
        bytes32 bh = blockhash(c.revealBlock);
        require(bh != bytes32(0), "Gacha: reveal expired, use reroll");

        c.opened = true;
        uint256 rand = uint256(keccak256(abi.encodePacked(bh, c.salt, chestId, msg.sender)));

        uint8 rarity = _pickRarity(uint16(rand % 10000));
        Heroes.HeroAttributes memory attrs = _rollAttributes(rarity, rand);
        heroId = heroes.mint(msg.sender, attrs);
        emit ChestOpened(chestId, msg.sender, heroId, rarity);
    }

    /// @notice Renews the reveal block of a chest whose blockhash expired (>256 blocks).
    function reroll(uint256 chestId) external {
        Chest storage c = chests[chestId];
        require(c.buyer == msg.sender, "Gacha: not the buyer");
        require(!c.opened, "Gacha: already opened");
        require(block.number > c.revealBlock + 256, "Gacha: reveal still valid");
        c.revealBlock = uint64(block.number + 2);
        emit ChestRerolled(chestId, c.revealBlock);
    }

    function _createChest(bytes32 salt) private returns (uint256 chestId) {
        chestId = nextChestId++;
        chests[chestId] = Chest({
            buyer: msg.sender,
            revealBlock: uint64(block.number + 2),
            salt: salt,
            opened: false
        });
        emit ChestBought(chestId, msg.sender, uint64(block.number + 2));
    }

    function _forwardToTreasury() private {
        (bool ok, ) = treasury.call{value: msg.value}("");
        require(ok, "Gacha: treasury transfer failed");
    }

    function _pickRarity(uint16 roll) internal view returns (uint8) {
        for (uint8 i = 0; i < 6; i++) {
            if (roll < rarityCumBps[i]) return i;
        }
        return 0; // unreachable: rarityCumBps[5] == 10000
    }

    /// @dev Base attributes grow with rarity; pseudo-random variation within
    ///      the rarity band. Fine balancing comes from the GDD.
    function _rollAttributes(uint8 rarity, uint256 rand)
        internal
        pure
        returns (Heroes.HeroAttributes memory)
    {
        uint16 base = uint16(10 + uint16(rarity) * 15);
        return Heroes.HeroAttributes({
            rarity: rarity,
            level: 1,
            power: base + uint16((rand >> 16) % 10),
            speed: base + uint16((rand >> 32) % 10),
            stamina: (base + uint16((rand >> 48) % 10)) * 2,
            blastRange: uint8(1 + rarity / 2 + ((rand >> 64) % 2)),
            bombCount: uint8(1 + rarity / 3 + ((rand >> 72) % 2)),
            abilities: uint16((rand >> 80) & (uint16(1) << (rarity + 1)) - 1)
        });
    }

    // ---- administration (multisig + timelock in production) ----

    function setPrices(uint256 chestPriceWei_, uint256 packPriceWei_, uint8 packSize_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(packSize_ > 0, "Gacha: pack size zero");
        chestPriceWei = chestPriceWei_;
        packPriceWei = packPriceWei_;
        packSize = packSize_;
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "Gacha: zero treasury");
        treasury = treasury_;
    }
}
